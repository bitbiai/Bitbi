const { test, expect } = require('@playwright/test');
const { MockD1, createAuthTestEnv } = require('./helpers/auth-worker-harness.js');
const { holdTwoBatches, load } = require('./q2-mfa-fixtures.cjs');

const USER = 'q2-mock-mfa-admin';
const NOW = '2026-09-06T12:00:00.000Z';
function database() {
  return new MockD1({ users: [{ id: USER }], adminMfaCredentials: [{
    admin_user_id: USER, secret_ciphertext: 'synthetic-ciphertext', secret_iv: 'synthetic-iv',
    pending_secret_ciphertext: null, pending_secret_iv: null, enabled_at: NOW,
    last_accepted_timestep: 10, created_at: NOW, updated_at: NOW,
  }] });
}

function claimAndCode(db, marker) {
  return [
    db.prepare('UPDATE admin_mfa_credentials SET mutation_token = ? WHERE admin_user_id = ? AND mutation_token IS NULL').bind(marker, USER),
    db.prepare(`INSERT INTO admin_mfa_recovery_codes (id,admin_user_id,code_hash,created_at)
      SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM admin_mfa_credentials WHERE admin_user_id = ? AND mutation_token = ?)`)
      .bind(`code-${marker}`, USER, `hash-${marker}`, NOW, USER, marker),
  ];
}

test('S01 MockD1 native bridge preserves NULL CAS, zero changes and only winning batch state', async () => {
  const db = database();
  const staleSnapshot = await db.prepare('SELECT mutation_token,last_accepted_timestep FROM admin_mfa_credentials WHERE admin_user_id = ?').bind(USER).first();
  expect(staleSnapshot).toEqual({ mutation_token: null, last_accepted_timestep: 10 });
  const results = await Promise.all([db.batch(claimAndCode(db, 'A')), db.batch(claimAndCode(db, 'B'))]);
  expect(results.map(batch => batch.map(result => result.meta.changes))).toEqual([[1, 1], [0, 0]]);
  expect(db.state.adminMfaCredentials[0].mutation_token).toBe('A');
  expect(db.state.adminMfaRecoveryCodes.map(row => row.id)).toEqual(['code-A']);
  expect(staleSnapshot.mutation_token).toBeNull();
  // Existing tests intentionally edit their fixture rows; the next native
  // query must import that edit, without mutating a returned read snapshot.
  db.state.adminMfaCredentials[0].last_accepted_timestep = 12;
  expect((await db.prepare('SELECT last_accepted_timestep FROM admin_mfa_credentials').first()).last_accepted_timestep).toBe(12);
});

test('S01 MockD1 native bridge rolls back later query failures and rejects missing schema/invalid SQL', async () => {
  for (const fault of ['forced', 'constraint', 'missing']) {
    const db = database();
    const before = JSON.parse(JSON.stringify(db.state));
    const statements = claimAndCode(db, 'A');
    if (fault === 'forced') db.failQueries.push('INSERT INTO admin_mfa_recovery_codes');
    if (fault === 'constraint') statements.push(db.prepare('INSERT INTO admin_mfa_recovery_codes (id,admin_user_id,code_hash,created_at) VALUES (?,?,?,?)').bind('duplicate', USER, 'hash-A', NOW));
    if (fault === 'missing') db.missingTables.add('admin_mfa_recovery_codes');
    await expect(db.batch(statements)).rejects.toThrow();
    expect(db.state).toEqual(before);
    expect(db.runCalls.length).toBeGreaterThanOrEqual(2);
  }
  const db = database();
  await expect(db.prepare('UPDATE admin_mfa_credentials SET invented_column = 1').run()).rejects.toThrow(/no such column/);
  await expect(db.prepare('INSERT INTO admin_mfa_failed_attempts (admin_user_id,updated_at) VALUES (?,?)').bind('absent-user', NOW).run()).rejects.toThrow(/FOREIGN KEY/);
  expect(db.state.adminMfaFailedAttempts).toEqual([]);
});

for (const method of ['recovery', 'totp']) {
  test(`S01 actual MFA library through native MockD1 bridge rejects concurrent ${method} replay`, async () => {
    const NativeDate = Date;
    globalThis.Date = class FixedDate extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [NOW])); }
      static now() { return NativeDate.parse(NOW); }
    };
    try {
      const mfa = await load('workers/auth/src/lib/admin-mfa.js');
      const user = { id: USER, email: 'q2-mock@example.invalid', role: 'admin', status: 'active' };
      const env = createAuthTestEnv({ users: [user] });
      const session = { user, sessionId: 'q2-mock-session' };
      const setup = await mfa.createAdminMfaSetup(env, user);
      const code = await mfa.generateTotpCode(setup.secret);
      await mfa.enableAdminMfa(env, session, { code }, { isSecure: true });
      env.DB.state.adminMfaCredentials[0].last_accepted_timestep -= 1;
      const body = method === 'recovery' ? { recovery_code: setup.recoveryCodes[0] } : { code };
      const barrier = holdTwoBatches(env.DB);
      const replies = await Promise.allSettled([
        mfa.verifyAdminMfa(env, session, body, { isSecure: true }),
        mfa.verifyAdminMfa(env, { ...session, sessionId: 'q2-mock-other-session' }, body, { isSecure: true }),
      ]);
      barrier.restore();
      expect(replies.filter(reply => reply.status === 'fulfilled')).toHaveLength(1);
      expect(replies.find(reply => reply.status === 'rejected').reason.status).toBe(409);
      expect(barrier.changes.sort()).toEqual([0, 1]);
      const winner = replies.find(reply => reply.status === 'fulfilled').value;
      expect(winner.status.verified).toBe(true);
      expect(winner.proof.cookies).toHaveLength(1);
      if (method === 'recovery') expect(env.DB.state.adminMfaRecoveryCodes.filter(row => row.used_at)).toHaveLength(1);
    } finally { globalThis.Date = NativeDate; }
  });
}
