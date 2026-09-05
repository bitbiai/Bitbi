const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { SqliteD1Database, applyAuthMigrations } = require('./sqlite-d1.js');
const { createAuthTestEnv } = require('./auth-worker-harness.js');

const load = (file) => import(pathToFileURL(path.join(process.cwd(), file)).href);
const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
};
const completed = () => Response.json({ ok: true, result: { status: 'succeeded',
  providerTaskId: 'local-task', providerState: 'success', videoUrl: 'https://fixture.invalid/video.mp4' } });

async function fixture(provider, { download } = {}) {
  const db = new SqliteD1Database();
  applyAuthMigrations(db);
  const now = new Date().toISOString();
  const admin = { id: 'queue-policy-admin', email: 'queue-policy@example.invalid', role: 'admin', status: 'active' };
  await db.prepare('INSERT INTO users (id,email,password_hash,created_at,role) VALUES (?,?,?,?,?)')
    .bind(admin.id, admin.email, 'local-unused', now, 'admin').run();
  for (const period of ['daily', 'monthly']) {
    await db.prepare("INSERT INTO platform_budget_limits (id,budget_scope,window_type,limit_units,created_at,updated_at) VALUES (?,'platform_admin_lab_budget',?,100000,?,?)")
      .bind(`queue-${period}`, period, now, now).run();
  }
  await db.prepare("INSERT INTO admin_runtime_budget_switches (switch_key, enabled, reason, created_at, updated_at) VALUES ('ENABLE_ADMIN_AI_VIDEO_JOB_BUDGET', 1, 'Local policy test fixture', ?, ?)").bind(now, now).run();
  const env = createAuthTestEnv({ fetch: download || (async () => new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'content-type': 'video/mp4' } })) });
  env.DB = db;
  const paths = [];
  env.AI_LAB = { fetch: async (request) => {
    paths.push(new URL(request.url).pathname);
    return provider(request, paths.length);
  } };
  const jobs = await load('workers/auth/src/lib/ai-video-jobs.js');
  const create = (key = 'queue-policy-key', prompt = 'Local queue policy fixture') => jobs.createAdminAiVideoJob({ env, adminUser: admin,
    payload: { model: 'pixverse/v6', prompt, duration: 5, aspect_ratio: '16:9', quality: '720p', generate_audio: true },
    idempotencyKey: key, correlationId: 'local-queue-policy' });
  const { job } = await create();
  const message = env.AI_VIDEO_JOBS_QUEUE.messages.shift();
  const row = () => db.prepare('SELECT * FROM ai_video_jobs WHERE id = ?').bind(job.id).first();
  const usage = () => db.prepare('SELECT COUNT(*) AS count FROM platform_budget_usage_events').first();
  const retryNow = () => db.prepare('UPDATE ai_video_jobs SET next_attempt_at = NULL, locked_until = NULL WHERE id = ?').bind(job.id).run();
  return { env, db, jobs, job, message, paths, row, usage, create, retryNow };
}

function registerQueueOutcomeContractTests() {
  test.describe('REL-01 queue outcome policy with real SQLite', () => {
    test('a stale in-flight R2 write cannot overwrite a newer published output', async () => {
      const putting = deferred(); const finish = deferred();
      const f = await fixture(async () => completed());
      const originalPut = f.env.USER_IMAGES.put.bind(f.env.USER_IMAGES);
      let staleKey;
      f.env.USER_IMAGES.put = async (key, body, options) => {
        staleKey = key; putting.resolve(); await finish.promise;
        return originalPut(key, body, options);
      };
      try {
        const first = f.jobs.processAiVideoJobMessage(f.env, f.message);
        await putting.promise;
        const newerToken = 'newer-local-processing-claim';
        // A newer claim uses the same key scheme as the writer under test.
        const newerKey = staleKey.includes('/attempts/')
          ? `users/${f.job.user_id}/video-jobs/${f.job.id}/attempts/${newerToken}/output.mp4`
          : staleKey;
        await originalPut(newerKey, new Uint8Array([9, 9]), { httpMetadata: { contentType: 'video/mp4' } });
        await f.db.prepare("UPDATE ai_video_jobs SET processing_token = ?, status = 'succeeded', output_r2_key = ?, output_url = ? WHERE id = ?")
          .bind(newerToken, newerKey, `/api/admin/ai/video-jobs/${f.job.id}/output`, f.job.id).run();
        finish.resolve();
        await first;
        const stored = await f.env.USER_IMAGES.get((await f.row()).output_r2_key);
        expect([...new Uint8Array(stored.body)]).toEqual([9, 9]);
        expect((await f.row()).processing_token).toBe(newerToken);
        expect((await f.usage()).count).toBe(0);
        expect(f.paths).toHaveLength(1);
      } finally { finish.resolve(); f.db.close(); }
    });

    test('cancellation between claim read and failed-result write cannot replace primary outcome', async () => {
      const f = await fixture(async () => Response.json({ ok: true, result: { status: 'failed', providerTaskId: 'local-failed-task' } }));
      const originalPrepare = f.db.prepare.bind(f.db);
      let claimReads = 0;
      f.db.prepare = (sql) => {
        const statement = originalPrepare(sql);
        if (sql !== 'SELECT status, processing_token, provider_outcome, locked_until FROM ai_video_jobs WHERE id = ?') return statement;
        return { bind(...bindings) {
          const bound = statement.bind(...bindings);
          return { async first() {
            const snapshot = await bound.first(); claimReads += 1;
            if (claimReads === 2) await originalPrepare("UPDATE ai_video_jobs SET status = 'cancelled', locked_until = NULL WHERE id = ?").bind(f.job.id).run();
            return snapshot;
          } };
        } };
      };
      try {
        await f.jobs.processAiVideoJobMessage(f.env, f.message);
        expect(await f.row()).toMatchObject({ status: 'cancelled', provider_outcome: 'dispatched', late_outcome: 'failed' });
        expect(f.paths).toHaveLength(1);
        expect((await f.usage()).count).toBe(0);
        expect(f.env.USER_IMAGES.objects.size).toBe(0);
      } finally { f.db.close(); }
    });

    test('normal success stores once and duplicate delivery creates no work or usage', async () => {
      const f = await fixture(async () => completed());
      try {
        expect(await f.jobs.processAiVideoJobMessage(f.env, f.message)).toMatchObject({ status: 'succeeded' });
        await f.jobs.processAiVideoJobMessage(f.env, f.message);
        expect(f.paths).toEqual(['/internal/ai/video-task/create']);
        expect(await f.row()).toMatchObject({ status: 'succeeded', provider_outcome: 'succeeded' });
        expect((await f.usage()).count).toBe(1);
        expect(f.env.USER_IMAGES.objects.size).toBe(1);
      } finally { f.db.close(); }
    });

    test('lost create response remains unknown across duplicate key, metadata truncation, and restart', async () => {
      const f = await fixture(async () => { throw new Error('local transport lost after possible dispatch'); });
      try {
        await f.jobs.processAiVideoJobMessage(f.env, f.message);
        const original = await f.row();
        expect(original).toMatchObject({ provider_outcome: 'unknown', status: 'processing' });
        expect(original.dispatch_token).toBeTruthy();
        await f.db.prepare("UPDATE ai_video_jobs SET budget_policy_json = '{}', locked_until = NULL, next_attempt_at = NULL WHERE id = ?").bind(f.job.id).run();
        const replay = await f.create();
        expect(replay.job.id).toBe(f.job.id);
        await f.jobs.processAiVideoJobMessage({ ...f.env }, f.message);
        expect(f.paths).toHaveLength(1);
        expect((await f.usage()).count).toBe(0);
        expect((await f.row()).platform_exposure_units).toBeGreaterThan(0);
        expect(f.env.USER_IMAGES.objects.size).toBe(0);
      } finally { f.db.close(); }
    });

    test('parallel duplicate delivery cannot claim a second create', async () => {
      const started = deferred(); const finish = deferred();
      const f = await fixture(async () => { started.resolve(); await finish.promise; return completed(); });
      try {
        const first = f.jobs.processAiVideoJobMessage(f.env, f.message);
        await started.promise;
        expect(await f.jobs.processAiVideoJobMessage(f.env, f.message)).toMatchObject({ status: 'noop' });
        finish.resolve(); await first;
        expect(f.paths).toHaveLength(1);
        expect((await f.usage()).count).toBe(1);
      } finally { finish.resolve(); f.db.close(); }
    });

    test('expired create lease becomes unknown; late success is evidence without R2 or usage', async () => {
      const started = deferred(); const finish = deferred();
      const f = await fixture(async () => { started.resolve(); await finish.promise; return completed(); });
      try {
        const first = f.jobs.processAiVideoJobMessage(f.env, f.message);
        await started.promise;
        await f.db.prepare("UPDATE ai_video_jobs SET locked_until = '2000-01-01T00:00:00.000Z' WHERE id = ?").bind(f.job.id).run();
        expect(await f.jobs.processAiVideoJobMessage(f.env, f.message)).toMatchObject({ status: 'noop', reason: 'provider_outcome_unknown' });
        finish.resolve(); await first;
        expect(await f.row()).toMatchObject({ provider_outcome: 'unknown', late_outcome: 'succeeded' });
        expect(f.paths).toHaveLength(1);
        expect(f.env.USER_IMAGES.objects.size).toBe(0);
        expect((await f.usage()).count).toBe(0);
        expect((await f.row()).late_evidence_json).not.toContain('fixture.invalid');
      } finally { finish.resolve(); f.db.close(); }
    });

    test('newer cancellation fences provider completion before R2 and platform event', async () => {
      const started = deferred(); const finish = deferred();
      const f = await fixture(async () => { started.resolve(); await finish.promise; return completed(); });
      try {
        const first = f.jobs.processAiVideoJobMessage(f.env, f.message);
        await started.promise;
        await f.db.prepare("UPDATE ai_video_jobs SET status = 'cancelled', locked_until = NULL WHERE id = ?").bind(f.job.id).run();
        finish.resolve(); await first;
        expect(await f.row()).toMatchObject({ status: 'cancelled', late_outcome: 'succeeded' });
        expect(f.env.USER_IMAGES.objects.size).toBe(0);
        expect((await f.usage()).count).toBe(0);
      } finally { finish.resolve(); f.db.close(); }
    });

    test('cancellation during output download blocks persistence and stale state writes', async () => {
      const downloading = deferred(); const finish = deferred();
      const f = await fixture(async () => completed(), { download: async () => {
        downloading.resolve(); await finish.promise;
        return new Response(new Uint8Array([1]), { headers: { 'content-type': 'video/mp4' } });
      } });
      try {
        const first = f.jobs.processAiVideoJobMessage(f.env, f.message);
        await downloading.promise;
        await f.db.prepare("UPDATE ai_video_jobs SET status = 'cancelled', locked_until = NULL WHERE id = ?").bind(f.job.id).run();
        finish.resolve(); await first;
        expect((await f.row()).status).toBe('cancelled');
        expect(f.env.USER_IMAGES.objects.size).toBe(0);
        expect((await f.usage()).count).toBe(0);
      } finally { finish.resolve(); f.db.close(); }
    });

    test('known successful output checkpoint retries ingest without another create or poll', async () => {
      let downloads = 0;
      const f = await fixture(async () => completed(), { download: async () => {
        downloads += 1;
        if (downloads === 1) throw new Error('local storage download outage');
        return new Response(new Uint8Array([1]), { headers: { 'content-type': 'video/mp4' } });
      } });
      try {
        expect(await f.jobs.processAiVideoJobMessage(f.env, f.message)).toMatchObject({ status: 'retry' });
        expect((await f.row()).provider_outcome).toBe('succeeded');
        await f.retryNow();
        expect(await f.jobs.processAiVideoJobMessage(f.env, f.message)).toMatchObject({ status: 'succeeded' });
        expect(f.paths).toEqual(['/internal/ai/video-task/create']);
        expect(downloads).toBe(2);
        expect((await f.usage()).count).toBe(1);
      } finally { f.db.close(); }
    });

    test('known pending task retries only same-provider poll; exhaustion stays unresolved', async () => {
      const f = await fixture(async () => Response.json({ ok: true, result: { status: 'provider_pending', providerTaskId: 'pending-task', retryAfterSeconds: 1 } }));
      try {
        await f.jobs.processAiVideoJobMessage(f.env, f.message);
        await f.retryNow();
        await f.jobs.processAiVideoJobMessage(f.env, f.message);
        await f.retryNow();
        await f.jobs.processAiVideoJobMessage(f.env, f.message);
        expect(f.paths).toEqual(['/internal/ai/video-task/create', '/internal/ai/video-task/poll', '/internal/ai/video-task/poll']);
        expect(await f.row()).toMatchObject({ provider_outcome: 'unknown', provider_task_id: 'pending-task' });
        expect((await f.usage()).count).toBe(0);
        await f.retryNow(); await f.jobs.processAiVideoJobMessage(f.env, f.message);
        expect(f.paths).toHaveLength(3);
      } finally { f.db.close(); }
    });

    test('confirmed failed task releases exposure but preserves same-key identity', async () => {
      const f = await fixture(async () => Response.json({ ok: true, result: { status: 'failed' } }));
      try {
        await f.jobs.processAiVideoJobMessage(f.env, f.message);
        expect(await f.row()).toMatchObject({ provider_outcome: 'failed', status: 'failed' });
        expect((await f.create()).job.id).toBe(f.job.id);
        await f.jobs.processAiVideoJobMessage(f.env, f.message);
        expect(f.paths).toHaveLength(1);
        expect((await f.usage()).count).toBe(0);
      } finally { f.db.close(); }
    });
  });
}

module.exports = { registerQueueOutcomeContractTests };
