const { test, expect } = require('@playwright/test');
const { startWorkerHttp } = require('./helpers/q2-http.js');
const { withMfaFixture, load } = require('./q2-mfa-fixtures.cjs');

test('S01 unused lower-window TOTP succeeds; outside-window and malformed proofs do not mutate it', async () => withMfaFixture(async f => {
  f.advance(60_000);
  const step = Math.floor(f.now() / 30_000);
  expect((await f.call('verify', { code: await f.mfa.generateTotpCode(f.setup.secret, { step: step - 1 }) })).response.status).toBe(200);
  const before = await f.credential();
  const codes = (await f.recoveryRows()).results;
  const cases = [
    [{ code: await f.mfa.generateTotpCode(f.setup.secret, { step: step - 2 }) }, 'ADMIN_MFA_INVALID_CODE'],
    [{ code: await f.mfa.generateTotpCode(f.setup.secret, { step: step + 2 }) }, 'ADMIN_MFA_INVALID_CODE'],
    [{ code: '12345' }, 'ADMIN_MFA_INVALID_CODE'],
    [{ code: 'not-a-totp' }, 'ADMIN_MFA_PROOF_REQUIRED'],
    [{ code: '123456', recovery_code: f.setup.recoveryCodes[0] }, 'ADMIN_MFA_AMBIGUOUS_PROOF'],
  ];
  for (const [body, code] of cases) {
    const reply = await f.call('verify', body);
    expect(reply.response.status).toBe(400);
    expect(reply.body.code).toBe(code);
    expect(reply.response.headers.getSetCookie()).toEqual([]);
    expect((await f.credential()).mutation_token).toBe(before.mutation_token);
    expect((await f.credential()).last_accepted_timestep).toBe(step - 1);
    expect((await f.recoveryRows()).results).toEqual(codes);
  }
}));

test('S01/S02 actual HTTP expired session is denied while the other active verified session remains usable', async () => withMfaFixture(async f => {
  const { default: worker } = await load('workers/auth/src/index.js');
  const verified = await f.call('verify', { recovery_code: f.setup.recoveryCodes[0] }, 1);
  expect(verified.response.status).toBe(200);
  const proof0 = f.enabled.response.headers.getSetCookie()[0].split(';')[0];
  const proof1 = verified.response.headers.getSetCookie()[0].split(';')[0];
  const cookie0 = `${f.sessionCookie()}; ${proof0}`;
  const cookie1 = `${f.sessionCookie(1)}; ${proof1}`;
  const otherBefore = await f.db.prepare('SELECT id,user_id,token_hash,expires_at FROM sessions WHERE id = ?').bind(f.sessions[1].sessionId).first();
  const http = await startWorkerHttp(worker, f.env);
  try {
    expect((await http.request('/api/admin/registration/status', { headers: { Cookie: cookie0 } })).status).toBe(200);
    await f.db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').bind(new Date(f.now() - 1).toISOString(), f.sessions[0].sessionId).run();
    const expired = await http.request('/api/admin/registration/status', { headers: { Cookie: cookie0 } });
    expect(expired.status).toBe(401);
    expect(expired.headers.get('cache-control')).toBe('no-store');
    expect(expired.headers.getSetCookie()).toEqual([]);
    expect((await http.request('/api/admin/registration/status', { headers: { Cookie: cookie1 } })).status).toBe(200);
    expect(await f.db.prepare('SELECT id,user_id,token_hash,expires_at FROM sessions WHERE id = ?').bind(f.sessions[1].sessionId).first()).toEqual(otherBefore);
  } finally { await http.close(); }
}));
