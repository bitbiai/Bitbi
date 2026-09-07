const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { SqliteD1Database, applyAuthMigrations } = require('./sqlite-d1.js');
const { createAuthTestEnv } = require('./auth-worker-harness.js');

const load = (file) => import(pathToFileURL(path.join(process.cwd(), file)).href);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const completed = () => Response.json({ ok: true, result: { status: 'succeeded',
  providerTaskId: 'q4-task', providerState: 'success', videoUrl: 'https://fixture.invalid/q4-video.mp4' } });

// The application clock/timers are deterministic. No elapsed-time assertion is
// inferred from waiting 121 real seconds; D1 statements still run in native SQLite.
function controlledClock() {
  const OriginalDate = global.Date;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  let now = OriginalDate.parse('2026-09-07T08:00:00.000Z');
  let nextId = 1;
  const timers = new Map();
  global.Date = class extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  global.setTimeout = (callback, delay = 0, ...args) => {
    const id = nextId++; timers.set(id, { at: now + Number(delay), callback, args }); return id;
  };
  global.clearTimeout = (id) => { if (!timers.delete(id)) originalClearTimeout(id); };
  return {
    async advance(ms, { runTimers = true } = {}) {
      const target = now + ms;
      if (runTimers) {
        let steps = 0;
        while (true) {
          const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
          if (!next) break;
          if (++steps > 100) throw new Error('Unexpected unbounded timer loop');
          const [id, timer] = next; timers.delete(id); now = timer.at;
          await timer.callback(...timer.args);
        }
      }
      now = target;
    },
    pending: () => timers.size,
    restore() { global.Date = OriginalDate; global.setTimeout = originalSetTimeout; global.clearTimeout = originalClearTimeout; },
  };
}

async function videoFixture(provider, { download, filename } = {}) {
  const db = new SqliteD1Database(filename ? { filename } : undefined);
  applyAuthMigrations(db, { through: '0083_add_r2_cleanup_reference_fence.sql' });
  const now = new Date().toISOString();
  const admin = { id: 'q4-video-admin', email: 'q4-video@example.invalid', role: 'admin' };
  await db.prepare('INSERT INTO users(id,email,password_hash,created_at,role) VALUES(?,?,?,?,?)')
    .bind(admin.id, admin.email, 'synthetic-unused', now, 'admin').run();
  for (const period of ['daily', 'monthly']) await db.prepare(
    "INSERT INTO platform_budget_limits(id,budget_scope,window_type,limit_units,created_at,updated_at) VALUES(?,'platform_admin_lab_budget',?,100000,?,?)")
    .bind(`q4-${period}`, period, now, now).run();
  await db.prepare("INSERT INTO admin_runtime_budget_switches(switch_key,enabled,reason,created_at,updated_at) VALUES('ENABLE_ADMIN_AI_VIDEO_JOB_BUDGET',1,'Synthetic Q4 fixture',?,?)").bind(now, now).run();
  const calls = { create: 0, poll: 0, download: 0, ack: 0, retry: [] };
  const env = createAuthTestEnv({ fetch: async (...args) => {
    calls.download += 1;
    return download ? download(...args) : new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'content-type': 'video/mp4' } });
  } });
  env.DB = db;
  env.AI_LAB = { async fetch(request) {
    const pathname = new URL(request.url).pathname;
    if (pathname.endsWith('/create')) calls.create += 1;
    else if (pathname.endsWith('/poll')) calls.poll += 1;
    else throw new Error(`Unexpected synthetic provider path ${pathname}`);
    return provider(request, calls);
  } };
  const jobs = await load('workers/auth/src/lib/ai-video-jobs.js');
  const worker = (await load('workers/auth/src/index.js')).default;
  const { job } = await jobs.createAdminAiVideoJob({ env, adminUser: admin,
    payload: { model: 'pixverse/v6', prompt: 'Synthetic Q4 video', duration: 5, aspect_ratio: '16:9', quality: '720p', generate_audio: true },
    idempotencyKey: 'q4-video-intent', correlationId: 'q4-video-fixture' });
  const message = env.AI_VIDEO_JOBS_QUEUE.messages.shift();
  return { env, db, jobs, worker, job, message, calls,
    row: () => db.prepare('SELECT * FROM ai_video_jobs_v2 WHERE id=?').bind(job.id).first(),
    usage: () => db.prepare('SELECT COUNT(*) AS count FROM platform_budget_usage_events WHERE source_job_id=?').bind(job.id).first(),
    async deliver(body = message) {
      await worker.queue({ queue: 'bitbi-ai-video-jobs', messages: [{ body, attempts: 1,
        ack() { calls.ack += 1; }, retry(options) { calls.retry.push(options); } }] }, env, {
        waitUntil() { throw new Error('Unexpected detached queue work'); },
      });
    },
  };
}

function interceptDatabase(db, intercept) {
  const prepare = db.prepare.bind(db);
  db.prepare = sql => {
    const wrap = statement => new Proxy(statement, { get(target, key) {
      if (key === 'bind') return (...args) => wrap(target.bind(...args));
      if (['run', 'first', 'all'].includes(key)) return () => intercept({ sql, bindings: target.bindings, method: key, execute: () => target[key]() });
      const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
    } });
    return wrap(prepare(sql));
  };
  return prepare;
}

module.exports = { videoFixture, deferred, completed, controlledClock, interceptDatabase };
