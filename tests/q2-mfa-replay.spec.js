const { test, expect } = require('@playwright/test');
const { withMfaFixture } = require('./q2-mfa-fixtures.cjs');

// Baseline-sensitive scheduling only: each pair of actual native SELECTs
// finishes before either caller receives its own unchanged result. No SQL,
// authentication, clock policy or cryptographic result is fabricated.
function holdSnapshotPairs(db, needle, method, maximumReads) {
  const prepare = db.prepare.bind(db);
  let arrivals = 0;
  let release;
  let pair = new Promise(resolve => { release = resolve; });
  db.prepare = sql => {
    const statement = prepare(sql);
    if (!sql.includes(needle)) return statement;
    const bind = statement.bind.bind(statement);
    statement.bind = (...bindings) => {
      const bound = bind(...bindings);
      const read = bound[method].bind(bound);
      bound[method] = async () => {
        const result = await read();
        arrivals += 1;
        if (arrivals <= maximumReads) {
          const current = pair;
          if (arrivals % 2 === 0) {
            release();
            pair = new Promise(resolve => { release = resolve; });
          }
          await current;
        }
        return result;
      };
      return bound;
    };
    return statement;
  };
  return { count: () => arrivals, restore: () => { db.prepare = prepare; } };
}

for (const method of ['recovery', 'totp']) {
  test(`S01 baseline-sensitive ${method} concurrent actual route read snapshots issue only one proof`, async () => withMfaFixture(async f => {
    const body = method === 'recovery'
      ? { recovery_code: f.setup.recoveryCodes[0] }
      : { code: await f.mfa.generateTotpCode(f.setup.secret) };
    // TOTP has two credential reads per route: requireAdmin status followed
    // by verifyAdminMfa. Both pairs are synchronized; recovery validates once.
    const reads = method === 'recovery' ? 2 : 4;
    const barrier = holdSnapshotPairs(f.db,
      method === 'recovery' ? 'SELECT id, code_hash, used_at' : 'SELECT admin_user_id, secret_ciphertext, secret_iv',
      method === 'recovery' ? 'all' : 'first', reads);
    let replies;
    try { replies = await Promise.all([f.call('verify', body), f.call('verify', body, 1)]); }
    finally { barrier.restore(); }
    expect(barrier.count()).toBe(reads);
    expect(replies.filter(reply => reply.response.status === 200)).toHaveLength(1);
    expect(replies.filter(reply => reply.body.mfa?.verified === true)).toHaveLength(1);
    expect(replies.filter(reply => reply.response.headers.getSetCookie().length > 0)).toHaveLength(1);
    expect([400, 409]).toContain(replies.find(reply => reply.response.status !== 200).response.status);
    if (method === 'recovery') expect((await f.recoveryRows()).results.filter(row => row.used_at)).toHaveLength(1);
    else expect((await f.credential()).last_accepted_timestep).toBe(Math.floor(f.now() / 30_000));
  }));
}
