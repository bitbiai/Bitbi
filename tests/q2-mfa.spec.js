const { test, expect } = require('@playwright/test');
const { withMfaFixture, holdNextBatch, holdTwoBatches, load, MIGRATION, fs, path, SqliteD1Database, applyAuthMigrations } = require('./q2-mfa-fixtures.cjs');

// Native persistence + actual MFA route/crypto/session/throttle. The HTTP
// entry point and cookie round-trip are covered separately by q2-mfa-http.
test('S01 0082 migration preserves populated credentials and defaults old/new rows to NULL', async () => {
  const db = new SqliteD1Database();
  try {
    applyAuthMigrations(db, { through: '0028_add_admin_mfa_failed_attempts.sql' });
    db.exec("INSERT INTO users(id,email,password_hash,created_at) VALUES ('old','old@example.invalid','synthetic','2026-01-01'),('new','new@example.invalid','synthetic','2026-01-01')");
    db.exec("INSERT INTO admin_mfa_credentials(admin_user_id,secret_ciphertext,secret_iv,enabled_at,last_accepted_timestep,created_at,updated_at) VALUES ('old','encrypted-fixture','iv-fixture','2026-01-01',42,'2026-01-01','2026-01-01')");
    db.exec(fs.readFileSync(path.join(__dirname, '../workers/auth/migrations', MIGRATION), 'utf8'));
    const old = await db.prepare('SELECT secret_ciphertext,last_accepted_timestep,mutation_token FROM admin_mfa_credentials WHERE admin_user_id = ?').bind('old').first();
    expect(old).toEqual({ secret_ciphertext: 'encrypted-fixture', last_accepted_timestep: 42, mutation_token: null });
    db.exec("INSERT INTO admin_mfa_credentials(admin_user_id,created_at,updated_at) VALUES ('new','2026-01-01','2026-01-01')");
    expect((await db.prepare("SELECT mutation_token FROM admin_mfa_credentials WHERE admin_user_id='new'").first()).mutation_token).toBeNull();
  } finally { db.close(); }
});

for (const method of ['totp', 'recovery']) {
  test(`S01 ${method}: sequential and concurrent single use issues exactly one proof`, async () => {
    for (const concurrent of [false, true]) await withMfaFixture(async f => {
      const body = method === 'totp' ? { code: await f.mfa.generateTotpCode(f.setup.secret) } : { recovery_code: f.setup.recoveryCodes[0] };
      const barrier = concurrent ? holdTwoBatches(f.db) : null;
      const replies = concurrent ? await Promise.all([f.call('verify', body), f.call('verify', body, 1)]) : [await f.call('verify', body), await f.call('verify', body, 1)];
      barrier?.restore();
      expect(replies.filter(result => result.response.status === 200)).toHaveLength(1);
      expect(replies.filter(result => result.body.mfa?.verified === true)).toHaveLength(1);
      expect(replies.filter(result => result.response.headers.getSetCookie().length > 0)).toHaveLength(1);
      expect([400, 409]).toContain(replies.find(result => result.response.status !== 200).response.status);
      if (barrier) expect(barrier.changes.sort()).toEqual([0, 1]);
      if (method === 'recovery') expect((await f.recoveryRows()).results.filter(row => row.used_at)).toHaveLength(1);
    });
  });
}

test('S01 TOTP accepted timestep is monotonic across the full tolerated window', async () => withMfaFixture(async f => {
  const step = Math.floor(f.now() / 30_000);
  const future = await f.mfa.generateTotpCode(f.setup.secret, { step: step + 1 });
  expect((await f.call('verify', { code: future })).response.status).toBe(200);
  const older = await f.call('verify', { code: await f.mfa.generateTotpCode(f.setup.secret, { step }) });
  expect(older.body.code).toBe('ADMIN_MFA_CODE_REPLAYED');
  expect((await f.credential()).last_accepted_timestep).toBe(step + 1);
  f.advance(30_000);
  expect((await f.call('verify', { code: future })).response.status).toBe(400);
  expect((await f.call('verify', { code: await f.mfa.generateTotpCode(f.setup.secret, { step: step + 2 }) })).response.status).toBe(200);
  expect((await f.credential()).last_accepted_timestep).toBe(step + 2);
}));

test('S01 concurrent setup and setup/enable cannot mix pending secrets and recovery sets', async () => withMfaFixture(async f => {
  const barrier = holdTwoBatches(f.db);
  const setups = await Promise.all([f.call('setup'), f.call('setup', {}, 1)]);
  barrier.restore();
  expect(setups.map(result => result.response.status).sort()).toEqual([200, 409]);
  const winner = setups.find(result => result.response.status === 200).body.setup;
  const held = holdNextBatch(f.db);
  const enabling = f.call('enable', { code: await f.mfa.generateTotpCode(winner.secret) });
  await held.arrived;
  const replacement = await f.mfa.createAdminMfaSetup(f.env, f.user);
  held.release();
  expect((await enabling).response.status).toBe(409);
  held.restore();
  expect((await f.call('enable', { code: await f.mfa.generateTotpCode(replacement.secret) })).response.status).toBe(200);
  expect((await f.call('verify', { recovery_code: winner.recoveryCodes[0] })).response.status).toBe(400);
  expect((await f.call('verify', { recovery_code: replacement.recoveryCodes[0] })).response.status).toBe(200);
}, { enroll: false }));

test('S01 concurrent enable confirms one pending credential and issues one proof', async () => withMfaFixture(async f => {
  const setup = (await f.call('setup')).body.setup;
  const code = await f.mfa.generateTotpCode(setup.secret);
  const barrier = holdTwoBatches(f.db);
  const replies = await Promise.all([f.call('enable', { code }), f.call('enable', { code }, 1)]);
  barrier.restore();
  expect(replies.map(reply => reply.response.status).sort()).toEqual([200, 409]);
  expect(barrier.changes.sort()).toEqual([0, 1]);
  expect(replies.filter(reply => reply.response.headers.getSetCookie().length)).toHaveLength(1);
  expect((await f.recoveryRows()).results).toHaveLength(10);
  expect((await f.call('verify', { recovery_code: setup.recoveryCodes[0] })).response.status).toBe(200);
}, { enroll: false }));

for (const second of ['recovery-codes/regenerate', 'disable']) {
  test(`S01 simultaneous regeneration versus ${second} publishes only the winning state`, async () => withMfaFixture(async f => {
    const barrier = holdTwoBatches(f.db);
    const replies = await Promise.all([
      f.call('recovery-codes/regenerate', { recovery_code: f.setup.recoveryCodes[0] }),
      f.call(second, { recovery_code: f.setup.recoveryCodes[1] }, 1),
    ]);
    barrier.restore();
    expect(replies.map(reply => reply.response.status).sort()).toEqual([200, 409]);
    expect(barrier.changes.sort()).toEqual([0, 1]);
    expect(replies.find(reply => reply.response.status === 409).response.headers.getSetCookie()).toEqual([]);
    const winner = replies.findIndex(reply => reply.response.status === 200);
    if (winner === 1 && second === 'disable') {
      expect(await f.credential()).toBeNull();
      expect((await f.recoveryRows()).results).toEqual([]);
    } else {
      expect((await f.recoveryRows()).results).toHaveLength(10);
      expect((await f.call('verify', { recovery_code: replies[winner].body.recoveryCodes[0] })).response.status).toBe(200);
      expect((await f.call('verify', { recovery_code: f.setup.recoveryCodes[2] })).response.status).toBe(400);
    }
  }));
}

for (const competing of ['recovery-codes/regenerate', 'disable']) {
  test(`S01 pending verification cannot consume stale credential after ${competing}`, async () => withMfaFixture(async f => {
    const held = holdNextBatch(f.db);
    const pending = f.call('verify', { recovery_code: f.setup.recoveryCodes[0] });
    await held.arrived;
    const replacement = await f.call(competing, { recovery_code: f.setup.recoveryCodes[1] }, 1);
    expect(replacement.response.status).toBe(200);
    if (competing === 'disable') {
      const setup = await f.call('setup');
      expect((await f.call('enable', { code: await f.mfa.generateTotpCode(setup.body.setup.secret) })).response.status).toBe(200);
    }
    const before = await f.credential();
    const recoveryBefore = (await f.recoveryRows()).results;
    held.release();
    const stale = await pending;
    held.restore();
    expect(stale.response.status).toBe(409);
    expect(stale.response.headers.getSetCookie()).toEqual([]);
    expect((await f.credential()).mutation_token).toBe(before.mutation_token);
    expect((await f.recoveryRows()).results).toEqual(recoveryBefore);
  }));
}

for (const operation of ['setup', 'enable', 'verify', 'disable', 'recovery-codes/regenerate']) {
  test(`S01 ${operation}: native statement failure rolls back its complete mutation and issues no proof`, async () => withMfaFixture(async f => {
    let setup = f.setup;
    if (operation === 'enable') setup = (await f.call('setup')).body.setup;
    const before = await f.credential();
    const codes = (await f.recoveryRows()).results;
    const table = operation === 'enable' ? 'admin_mfa_credentials' : 'admin_mfa_recovery_codes';
    const event = ['setup', 'recovery-codes/regenerate'].includes(operation) ? 'INSERT' : operation === 'disable' ? 'DELETE' : 'UPDATE';
    f.db.exec(`CREATE TRIGGER q2_mfa_fault BEFORE ${event} ON ${table} BEGIN SELECT RAISE(ABORT, 'synthetic MFA persistence failure'); END`);
    const body = operation === 'enable' ? { code: await f.mfa.generateTotpCode(setup.secret) } : { recovery_code: setup?.recoveryCodes[0] };
    const reply = await f.call(operation, body);
    expect(reply.response.status).toBe(503);
    expect(reply.response.headers.getSetCookie()).toEqual([]);
    expect(await f.credential()).toEqual(before);
    expect((await f.recoveryRows()).results).toEqual(codes);
    f.db.exec('DROP TRIGGER q2_mfa_fault');
    expect((await f.call(operation, body)).response.status).toBe(200);
  }, { enroll: !['setup', 'enable'].includes(operation) }));
}

test('S01 committed response loss never issues a proof or restores a consumed recovery code', async () => withMfaFixture(async f => {
  const batch = f.db.batch.bind(f.db);
  f.db.batch = async statements => { await batch(statements); throw new Error('Synthetic committed response loss'); };
  const body = { recovery_code: f.setup.recoveryCodes[0] };
  const uncertain = await f.call('verify', body);
  f.db.batch = batch;
  expect(uncertain.response.status).toBe(503);
  expect(uncertain.response.headers.getSetCookie()).toEqual([]);
  expect((await f.recoveryRows()).results.filter(row => row.used_at)).toHaveLength(1);
  expect((await f.call('verify', body)).response.status).toBe(400);
}));

test('S01 missing mutation confirmation fails closed even when native persistence committed', async () => withMfaFixture(async f => {
  const batch = f.db.batch.bind(f.db);
  f.db.batch = async statements => (await batch(statements)).map(result => ({ ...result, meta: {} }));
  const body = { recovery_code: f.setup.recoveryCodes[0] };
  const reply = await f.call('verify', body);
  f.db.batch = batch;
  expect(reply.response.status).toBe(503);
  expect(reply.body.code).toBe('ADMIN_MFA_UNAVAILABLE');
  expect(reply.response.headers.getSetCookie()).toEqual([]);
  expect((await f.recoveryRows()).results.filter(row => row.used_at)).toHaveLength(1);
  expect((await f.call('verify', body)).response.status).toBe(400);
}));

test('S01 purpose-key compatibility retains ciphertext/recovery/proof algorithms only with explicit legacy fallback', async () => withMfaFixture(async f => {
  const legacy = 'q2-synthetic-old-purpose-secret-only-000000000000';
  const names = ['ADMIN_MFA_ENCRYPTION_KEY', 'ADMIN_MFA_PROOF_SECRET', 'ADMIN_MFA_RECOVERY_HASH_SECRET'];
  const current = Object.fromEntries(names.map(name => [name, f.env[name]]));
  for (const name of names) f.env[name] = legacy;
  const setup = (await f.call('setup')).body.setup;
  const enabled = await f.call('enable', { code: await f.mfa.generateTotpCode(setup.secret) });
  expect(enabled.response.status).toBe(200);
  const proofCookie = enabled.response.headers.getSetCookie()[0].split(';')[0];
  const credentialBefore = await f.credential();
  Object.assign(f.env, current, { SESSION_SECRET: legacy, ALLOW_LEGACY_SECURITY_SECRET_FALLBACK: 'true' });
  const statusRequest = new Request('https://bitbi.ai/api/admin/mfa/status', { headers: { Cookie: `${f.sessionCookie()}; ${proofCookie}` } });
  const session = { user: f.user, sessionId: f.sessions[0].sessionId, request: statusRequest };
  expect((await f.mfa.getAdminMfaStatus(f.env, session, statusRequest)).verified).toBe(true);
  f.advance(30_000);
  expect((await f.call('verify', { code: await f.mfa.generateTotpCode(setup.secret) })).response.status).toBe(200);
  expect((await f.call('verify', { recovery_code: setup.recoveryCodes[0] })).response.status).toBe(200);
  expect((await f.credential()).secret_ciphertext).toBe(credentialBefore.secret_ciphertext);
  expect((await f.credential()).secret_iv).toBe(credentialBefore.secret_iv);
  f.env.ALLOW_LEGACY_SECURITY_SECRET_FALLBACK = 'false';
  expect((await f.mfa.getAdminMfaStatus(f.env, session, statusRequest)).verified).toBe(false);
  expect((await f.call('verify', { recovery_code: setup.recoveryCodes[1] })).response.status).toBe(400);
  f.advance(30_000);
  expect((await f.call('verify', { code: await f.mfa.generateTotpCode(setup.secret) })).response.status).toBe(503);
}, { enroll: false }));

test('S01 concurrent failures reach durable lockout; valid verification after expiry resets it', async () => withMfaFixture(async f => {
  const step = Math.floor(f.now() / 30_000);
  const valid = await Promise.all([-1, 0, 1].map(offset => f.mfa.generateTotpCode(f.setup.secret, { step: step + offset })));
  let invalid = '000000';
  while (valid.includes(invalid)) invalid = String(Number(invalid) + 1).padStart(6, '0');
  // All five real reads observe the unlocked state before validation resumes;
  // scheduling cannot turn this counter regression into fewer attempted codes.
  const prepare = f.db.prepare.bind(f.db);
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  let arrivals = 0;
  f.db.prepare = sql => {
    const statement = prepare(sql);
    if (!sql.includes('SELECT admin_user_id, failed_count')) return statement;
    const bind = statement.bind.bind(statement);
    statement.bind = (...bindings) => {
      const bound = bind(...bindings);
      const first = bound.first.bind(bound);
      bound.first = async () => {
        const result = await first();
        arrivals += 1;
        if (arrivals <= 5) { if (arrivals === 5) release(); await ready; }
        return result;
      };
      return bound;
    };
    return statement;
  };
  const replies = await Promise.all(Array.from({ length: 5 }, () => f.call('verify', { code: invalid })));
  f.db.prepare = prepare;
  expect(replies.every(reply => [400, 429].includes(reply.response.status))).toBe(true);
  expect((await f.db.prepare('SELECT failed_count FROM admin_mfa_failed_attempts WHERE admin_user_id = ?').bind(f.user.id).first()).failed_count).toBe(5);
  expect((await f.call('verify', { recovery_code: f.setup.recoveryCodes[0] })).response.status).toBe(429);
  f.advance(16 * 60_000);
  expect((await f.call('verify', { code: await f.mfa.generateTotpCode(f.setup.secret) })).response.status).toBe(200);
  expect(await f.db.prepare('SELECT 1 FROM admin_mfa_failed_attempts WHERE admin_user_id = ?').bind(f.user.id).first()).toBeNull();
}));

test('S02 json accepts all HeadersInit forms and retains distinct cookie/security headers', async () => {
  const { json } = await load('workers/auth/src/lib/response.js');
  for (const supplied of [new Headers([['Set-Cookie', 'first=; Max-Age=0'], ['Set-Cookie', 'second=; Max-Age=0']]), [['Set-Cookie', 'first=; Max-Age=0'], ['Set-Cookie', 'second=; Max-Age=0']]]) {
    const response = json({ ok: false }, { status: 403, headers: supplied });
    expect(response.headers.getSetCookie()).toEqual(['first=; Max-Age=0', 'second=; Max-Age=0']);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
  }
  expect(json({}, { headers: { 'Cache-Control': 'private, max-age=10', 'X-Q2': 'retained' } }).headers.get('cache-control')).toBe('private, max-age=10');
  expect(json({}, { headers: { 'X-Q2': 'retained' } }).headers.get('x-q2')).toBe('retained');
});
