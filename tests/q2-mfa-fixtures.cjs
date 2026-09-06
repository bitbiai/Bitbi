const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { SqliteD1Database, applyAuthMigrations } = require('./helpers/sqlite-d1.js');

const load = (name) => import(pathToFileURL(path.join(__dirname, '..', name)).href);
const MIGRATION = '0082_add_admin_mfa_mutation_guard.sql';
const NativeDate = Date;
const initialTime = Date.parse('2026-09-06T12:00:00.000Z');
const gate = () => {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
};

async function withMfaFixture(run, { enroll = true, filename = ':memory:' } = {}) {
  let time = initialTime;
  globalThis.Date = class TestDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [time])); }
    static now() { return time; }
  };
  const db = new SqliteD1Database({ filename });
  try {
    applyAuthMigrations(db, { through: MIGRATION });
    const [mfa, session, cookies, route, limiter] = await Promise.all([
      load('workers/auth/src/lib/admin-mfa.js'), load('workers/auth/src/lib/session.js'),
      load('workers/auth/src/lib/cookies.js'), load('workers/auth/src/routes/admin-mfa.js'),
      load('workers/auth/src/lib/public-rate-limiter-do.js'),
    ]);
    db.exec('CREATE TABLE q2_limiter_state (namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT, PRIMARY KEY(namespace, key))');
    const env = { DB: db, BITBI_ENV: 'production', APP_BASE_URL: 'https://bitbi.ai', ALLOW_LEGACY_SECURITY_SECRET_FALLBACK: 'false' };
    for (const name of ['SESSION_HASH_SECRET', 'PAGINATION_SIGNING_SECRET', 'ADMIN_MFA_ENCRYPTION_KEY', 'ADMIN_MFA_PROOF_SECRET', 'ADMIN_MFA_RECOVERY_HASH_SECRET', 'AI_SAVE_REFERENCE_SIGNING_SECRET']) {
      env[name] = `q2-synthetic-${name}-not-a-live-secret-00000000`;
    }
    // The real Durable Object algorithm, with native persisted KV and a
    // serialized request queue for each synthetic object. No allow-all limiter.
    const objects = new Map();
    env.PUBLIC_RATE_LIMITER = {
      idFromName: name => name,
      get(name) {
        if (!objects.has(name)) {
          const storage = {
            async get(key) {
              const row = await db.prepare('SELECT value FROM q2_limiter_state WHERE namespace = ? AND key = ?').bind(name, key).first();
              return row ? JSON.parse(row.value) : undefined;
            },
            async put(key, value) { await db.prepare('INSERT INTO q2_limiter_state VALUES (?, ?, ?) ON CONFLICT(namespace,key) DO UPDATE SET value = excluded.value').bind(name, key, JSON.stringify(value)).run(); },
            async setAlarm(value) { await this.put('__alarm', value); },
            async deleteAll() { await db.prepare('DELETE FROM q2_limiter_state WHERE namespace = ?').bind(name).run(); },
          };
          const object = new limiter.AuthPublicRateLimiterDurableObject({ storage }, env);
          let tail = Promise.resolve();
          objects.set(name, { fetch(url, init) {
            const result = tail.then(() => object.fetch(new Request(url, init)));
            tail = result.catch(() => {});
            return result;
          } });
        }
        return objects.get(name);
      },
    };
    const user = { id: 'q2-mfa-admin', email: 'q2-admin@example.invalid', role: 'admin', status: 'active' };
    await db.prepare('INSERT INTO users (id,email,password_hash,created_at,role,status,email_verified_at,verification_method) VALUES (?,?,?,?,?,?,?,?)')
      .bind(user.id, user.email, 'synthetic-unused', new Date().toISOString(), 'admin', 'active', new Date().toISOString(), 'email').run();
    const sessions = await Promise.all([session.createSession(env, user.id), session.createSession(env, user.id)]);
    const sessionCookie = (index = 0) => `${cookies.SECURE_SESSION_COOKIE_NAME}=${sessions[index].sessionToken}`;
    async function call(operation, body = {}, index = 0) {
      const request = new Request(`https://bitbi.ai/api/admin/mfa/${operation}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://bitbi.ai', Cookie: sessionCookie(index), 'CF-Connecting-IP': '192.0.2.12' }, body: JSON.stringify(body),
      });
      const response = await route.handleAdminMfa({ request, env, pathname: new URL(request.url).pathname, method: 'POST', isSecure: true, correlationId: 'q2-mfa-regression' });
      return { response, body: await response.json() };
    }
    const f = { db, env, user, mfa, session, cookies, sessions, sessionCookie, call,
      advance: ms => { time += ms; }, now: () => time,
      credential: () => mfa.loadAdminMfaCredential(env, user.id),
      recoveryRows: () => db.prepare('SELECT id, code_hash, used_at FROM admin_mfa_recovery_codes WHERE admin_user_id = ? ORDER BY id').bind(user.id).all(),
    };
    if (enroll) {
      const setup = await call('setup');
      if (setup.response.status !== 200) throw new Error(`Synthetic setup failed: ${setup.response.status}`);
      f.setup = setup.body.setup;
      const enabled = await call('enable', { code: await mfa.generateTotpCode(f.setup.secret) });
      if (enabled.response.status !== 200) throw new Error(`Synthetic enable failed: ${enabled.response.status}`);
      f.enabled = enabled;
      f.advance(30_000);
    }
    return await run(f);
  } finally {
    db.close();
    globalThis.Date = NativeDate;
  }
}

function holdNextBatch(db) {
  const original = db.batch.bind(db);
  const arrived = gate();
  const resume = gate();
  let used = false;
  db.batch = async statements => {
    if (!used) { used = true; arrived.release(); await resume.promise; }
    return original(statements);
  };
  return { arrived: arrived.promise, release: resume.release, restore: () => { db.batch = original; } };
}

function holdTwoBatches(db) {
  const original = db.batch.bind(db);
  const resume = gate();
  const changes = [];
  let arrivals = 0;
  db.batch = async statements => {
    arrivals += 1;
    if (arrivals <= 2) { if (arrivals === 2) resume.release(); await resume.promise; }
    const result = await original(statements);
    changes.push(result[0].meta.changes);
    return result;
  };
  return { changes, restore: () => { db.batch = original; } };
}

module.exports = { withMfaFixture, holdNextBatch, holdTwoBatches, load, MIGRATION, fs, path, SqliteD1Database, applyAuthMigrations };
