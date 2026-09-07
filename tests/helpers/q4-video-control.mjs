// Synthetic control adapter: imports the unchanged public queue entry and current
// product module; DB and R2 are native local bindings. This is not a serving bundle.
import worker from '../../workers/auth/src/index.js';
import { createAdminAiVideoJob } from '../../workers/auth/src/lib/ai-video-jobs.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const completed = () => Response.json({ ok: true, result: { status: 'succeeded',
  providerTaskId: 'q4-native-task', providerState: 'success', videoUrl: 'https://fixture.invalid/q4-native.mp4' } });
const check = (condition, message) => { if (!condition) throw new Error(message); };
const entered = (signal, task) => Promise.race([signal.promise, task.then(() => { throw new Error('Queue ended before expected controlled stage'); })]);

function clock() {
  const OriginalDate = globalThis.Date, set = globalThis.setTimeout, clear = globalThis.clearTimeout;
  let now = OriginalDate.parse('2026-09-07T08:00:00.000Z'), next = 0;
  const timers = new Map();
  globalThis.Date = class extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  globalThis.setTimeout = (callback, delay = 0) => { const id = ++next; timers.set(id, { at: now + Number(delay), callback }); return id; };
  globalThis.clearTimeout = id => { if (!timers.delete(id)) clear(id); };
  return { async advance(ms, runTimers = true) {
    const end = now + ms; let steps = 0;
    if (runTimers) while (true) {
      const entry = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry) break;
      if (++steps > 100) throw new Error('Unbounded synthetic clock loop');
      const [id, timer] = entry; timers.delete(id); now = timer.at; await timer.callback();
    }
    now = end;
  }, pending: () => timers.size,
  restore() { globalThis.Date = OriginalDate; globalThis.setTimeout = set; globalThis.clearTimeout = clear; } };
}

function wrapDb(db, intercept) {
  return { prepare(sql) {
    const wrap = (statement, bindings = []) => ({
      bind(...args) { return wrap(statement.bind(...args), args); },
      run: () => intercept({ sql, bindings, method: 'run', execute: () => statement.run() }),
      first: (...args) => intercept({ sql, bindings, method: 'first', execute: () => statement.first(...args) }),
      all: () => intercept({ sql, bindings, method: 'all', execute: () => statement.all() }),
    });
    return wrap(db.prepare(sql));
  }, batch: statements => db.batch(statements), exec: text => db.exec(text) };
}

async function executeCase(nativeEnv, name) {
  const time = clock(), started = deferred(), finish = deferred();
  const firstClaim = deferred(), firstRelease = deferred(), secondClaim = deferred(), secondRelease = deferred();
  const calls = { create: 0, poll: 0, download: 0, put: 0, ack: 0, retry: 0 };
  const db = nativeEnv.DB, id = `q4-native-video-${name}`;
  let running, duplicate, acquisitions = 0, fail = true, tokens = [], primary;
  try {
    const now = new Date().toISOString();
    const admin = { id, email: `${name}@example.invalid`, role: 'admin' };
    await db.prepare('INSERT INTO users(id,email,password_hash,created_at,role) VALUES(?,?,?,?,?)')
      .bind(id, admin.email, 'synthetic-unused', now, 'admin').run();
    for (const period of ['daily', 'monthly']) await db.prepare(
      "INSERT OR IGNORE INTO platform_budget_limits(id,budget_scope,window_type,limit_units,created_at,updated_at) VALUES(?,'platform_admin_lab_budget',?,100000,?,?)")
      .bind(`q4-native-${period}`, period, now, now).run();
    await db.prepare("INSERT OR IGNORE INTO admin_runtime_budget_switches(switch_key,enabled,reason,created_at,updated_at) VALUES('ENABLE_ADMIN_AI_VIDEO_JOB_BUDGET',1,'Synthetic Q4 native fixture',?,?)").bind(now, now).run();
    const messages = [];
    const env = { ...nativeEnv, AI_SERVICE_AUTH_SECRET: 'q4-native-synthetic-service-secret', ENABLE_ADMIN_AI_VIDEO_JOB_BUDGET: 'true',
      AI_VIDEO_JOBS_QUEUE: { async send(body) { messages.push(body); } },
      USER_IMAGES: { get: key => nativeEnv.USER_IMAGES.get(key), async put(...args) { calls.put++; return nativeEnv.USER_IMAGES.put(...args); } },
      __TEST_FETCH: async () => { calls.download++; return new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'content-type': 'video/mp4' } }); },
      AI_LAB: { async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path.endsWith('/create')) calls.create++;
        else if (path.endsWith('/poll')) calls.poll++;
        else throw new Error('Unexpected synthetic provider path');
        if (name === 'pending-poll' && calls.poll === 0) return Response.json({ ok: true,
          result: { status: 'provider_pending', providerTaskId: 'q4-native-task', retryAfterSeconds: 20 } });
        if (name === 'pending-poll') check((await request.json()).providerTaskId === 'q4-native-task', 'Poll must retain task identity');
        if (['slow-121', 'late-expired', 'cancelled'].includes(name)) { started.resolve(); await finish.promise; }
        return completed();
      } },
    };
    const created = await createAdminAiVideoJob({ env, adminUser: admin,
      payload: { model: 'pixverse/v6', prompt: 'Synthetic native Q4 video', duration: 5, aspect_ratio: '16:9', quality: '720p', generate_audio: true },
      idempotencyKey: id, correlationId: id });
    const jobId = created.job.id, message = messages.shift();
    const row = () => db.prepare('SELECT * FROM ai_video_jobs_v2 WHERE id=?').bind(jobId).first();
    env.DB = wrapDb(db, async ({ sql, bindings, method, execute }) => {
      if (name === 'usage-before' && fail && method === 'run' && sql.includes('INSERT OR IGNORE INTO platform_budget_usage_events')) {
        fail = false; throw new Error('Synthetic native pre-usage failure');
      }
      const result = await execute();
      if (name === 'receipt-reply-lost' && fail && method === 'run' && sql.includes("AND provider_result_json = '{}'")) {
        fail = false; throw new Error('Synthetic native receipt response lost');
      }
      if (name === 'own-claim' && method === 'run' && sql.includes("SET status = 'starting', attempt_count") && result.meta.changes) {
        tokens.push(bindings[0]); acquisitions++;
        if (acquisitions === 1) { firstClaim.resolve(); await firstRelease.promise; }
        else if (acquisitions === 2) { secondClaim.resolve(); await secondRelease.promise; }
      }
      return result;
    });
    const deliver = async (body = message) => worker.queue({ queue: 'bitbi-ai-video-jobs', messages: [{ body, attempts: 1,
      ack() { calls.ack++; }, retry() { calls.retry++; } }] }, env, { waitUntil() { throw new Error('Unexpected detached queue work'); } });
    if (name === 'own-claim') {
      running = deliver(); await entered(firstClaim, running);
      await db.prepare("UPDATE ai_video_jobs_v2 SET locked_until='2000-01-01T00:00:00.000Z' WHERE id=?").bind(jobId).run();
      duplicate = deliver(); await entered(secondClaim, duplicate);
      firstRelease.resolve(); await running;
      check(calls.create === 0 && tokens[0] !== tokens[1], 'Old invocation must not adopt new token');
      secondRelease.resolve(); await duplicate;
      check((await row()).processing_token === tokens[1], 'Only acquired second token may finalize');
    } else if (['slow-121', 'late-expired', 'cancelled'].includes(name)) {
      running = deliver(); await entered(started, running);
      if (name === 'cancelled') await db.prepare("UPDATE ai_video_jobs_v2 SET status='cancelled',locked_until=NULL WHERE id=?").bind(jobId).run();
      else await time.advance(121000, name === 'slow-121');
      if (name === 'late-expired') await deliver();
      finish.resolve(); await running;
      if (name !== 'slow-121') await deliver();
    } else {
      await deliver();
      if (name === 'pending-poll') { await time.advance(21000); await deliver(messages.shift()); }
      if (name === 'receipt-reply-lost') {
        await deliver(); check(calls.retry === 2 && calls.ack === 0, 'Retain delivery while known completion is locked');
        await time.advance(121000); await deliver();
      }
      if (name === 'usage-before') {
        check(calls.retry === 1 && calls.ack === 0, 'Usage failure cannot be acknowledged');
        check(await db.prepare('SELECT COUNT(*) AS n FROM platform_budget_usage_events WHERE source_job_id=?').bind(jobId).first('n') === 0, 'Failure precedes usage');
        await deliver(); await deliver();
      }
    }
    primary = await row();
    const receipt = JSON.parse(primary.provider_result_json), usage = await db.prepare('SELECT COUNT(*) AS n FROM platform_budget_usage_events WHERE source_job_id=?').bind(jobId).first('n');
    const blocked = ['late-expired', 'cancelled'].includes(name);
    check(calls.create === 1 && calls.poll === (name === 'pending-poll' ? 1 : 0), 'One create and only intentional poll');
    check(receipt.status === 'succeeded' && receipt.providerTaskId === 'q4-native-task', 'Durable dispatch receipt');
    check(calls.put === (blocked ? 0 : 1) && calls.download === (blocked ? 0 : 1), 'Fenced ingestion count');
    check(usage === (blocked ? 0 : 1), 'Exactly authorized usage count');
    check(blocked ? primary.status !== 'succeeded' : primary.status === 'succeeded', 'Primary result must retain policy');
    if (name === 'late-expired') check(primary.provider_outcome === 'unknown' && primary.late_outcome === 'succeeded', 'Late evidence cannot revive unknown');
    if (name === 'cancelled') check(primary.status === 'cancelled', 'Cancelled remains cancelled');
    check(time.pending() === 0, 'No detached renewal timer');
    if (!blocked) check((await nativeEnv.USER_IMAGES.get(primary.output_r2_key)).size === 4, 'Native R2 persisted expected synthetic bytes');
    const event = await db.prepare('SELECT units,window_day,window_month,source_job_id FROM platform_budget_usage_events WHERE source_job_id=?').bind(jobId).first();
    if (!blocked) check(event.units === primary.platform_exposure_units && event.window_day === primary.platform_window_day && event.window_month === primary.platform_window_month, 'Source exposure and settlement agree');
    return { case: name, calls, status: primary.status, providerOutcome: primary.provider_outcome,
      receipt: { status: receipt.status, taskMatches: receipt.providerTaskId === 'q4-native-task' }, usage,
      exposureUnits: primary.platform_exposure_units, timers: time.pending() };
  } finally {
    finish.resolve(); firstRelease.resolve(); secondRelease.resolve();
    await Promise.allSettled([running, duplicate].filter(Boolean)); time.restore();
  }
}

export default { async fetch(request, env) {
  if (request.method !== 'POST' || request.headers.get('x-q2-control') !== env.Q2_CONTROL_TOKEN) return new Response(null, { status: 403 });
  const { case: name } = await request.json();
  if (new URL(request.url).pathname !== '/q4-video' || !['own-claim', 'slow-121', 'late-expired', 'cancelled', 'receipt-reply-lost', 'usage-before', 'pending-poll'].includes(name)) return new Response(null, { status: 400 });
  return Response.json(await executeCase(env, name));
} };
