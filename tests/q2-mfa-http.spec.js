const { test, expect } = require('@playwright/test');
const { createHmac } = require('node:crypto');
const { startWorkerHttp } = require('./helpers/q2-http.js');
const { withMfaFixture, load } = require('./q2-mfa-fixtures.cjs');

// Actual Node HTTP bytes -> unchanged Auth Worker.fetch -> actual guards,
// session/MFA/response helpers -> raw distinct Set-Cookie fields -> next HTTP
// Cookie request. Logical HTTPS deployment on isolated loopback, not real TLS
// or browser enforcement of Secure/HttpOnly/__Host cookie attributes.
function cookieJar() {
  const values = new Map();
  return {
    values,
    header: () => [...values].map(([name, value]) => `${name}=${value}`).join('; '),
    accept(response) {
      for (const cookie of response.headers.getSetCookie()) {
        const [pair] = cookie.split(';');
        const separator = pair.indexOf('=');
        const name = pair.slice(0, separator);
        if (/;\s*Max-Age=0(?:;|$)/i.test(cookie)) values.delete(name);
        else values.set(name, pair.slice(separator + 1));
      }
    },
  };
}

function assertPrivateHeaders(response) {
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('x-frame-options')).toBe('DENY');
  expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
}

function assertClearCookies(response, names) {
  const cookies = response.headers.getSetCookie();
  const rawCount = response.rawHeaders.filter((_, index) => index % 2 === 0 && response.rawHeaders[index].toLowerCase() === 'set-cookie').length;
  expect(rawCount).toBe(names.length);
  expect(cookies.map(cookie => cookie.split('=')[0]).sort()).toEqual([...names].sort());
  for (const cookie of cookies) {
    expect(cookie).toContain('Max-Age=0');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Secure');
    expect(cookie).not.toMatch(/Domain=/i);
  }
  assertPrivateHeaders(response);
}

const proofNames = ['__Host-bitbi_admin_mfa', 'bitbi_admin_mfa'];

test('S01/S02 full HTTP login, enrollment, proof, invalid/expired clear, recovery, disable, reenroll and logout', async () => withMfaFixture(async f => {
  const [{ default: worker }, { hashPassword }] = await Promise.all([load('workers/auth/src/index.js'), load('workers/auth/src/lib/passwords.js')]);
  const password = 'Q2 synthetic login password 123!';
  await f.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(password, f.env), f.user.id).run();
  const http = await startWorkerHttp(worker, f.env);
  const jar = cookieJar();
  const request = (path, body) => http.request(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Cookie: jar.header(), Origin: 'https://bitbi.ai', 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.20', 'x-bitbi-correlation-id': 'q2-http-chain' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    const login = await request('/api/login', { email: f.user.email, password });
    expect(login.status).toBe(200);
    assertPrivateHeaders(login);
    expect(login.headers.getSetCookie()).toHaveLength(3);
    jar.accept(login);
    expect(jar.values.has('__Host-bitbi_session')).toBe(true);
    const notEnrolled = await request('/api/admin/registration/status');
    expect(notEnrolled.status).toBe(403);
    assertClearCookies(notEnrolled, proofNames);
    jar.accept(notEnrolled);
    const setupResponse = await request('/api/admin/mfa/setup', {});
    expect(setupResponse.status).toBe(200);
    assertPrivateHeaders(setupResponse);
    const setup = (await setupResponse.json()).setup;
    const enable = await request('/api/admin/mfa/enable', { code: await f.mfa.generateTotpCode(setup.secret) });
    expect(enable.status).toBe(200);
    expect(enable.headers.get('x-bitbi-correlation-id')).toBe('q2-http-chain');
    jar.accept(enable);
    const originalProof = jar.values.get('__Host-bitbi_admin_mfa');
    const protectedRead = await request('/api/admin/registration/status');
    expect(protectedRead.status).toBe(200);
    assertPrivateHeaders(protectedRead);

    jar.values.set('__Host-bitbi_admin_mfa', 'malformed-synthetic-proof');
    jar.values.set('bitbi_admin_mfa', 'stale-synthetic-legacy-proof');
    const malformed = await request('/api/admin/registration/status');
    expect(malformed.status).toBe(403);
    expect((await malformed.json()).code).toBe('admin_mfa_invalid_or_expired');
    assertClearCookies(malformed, proofNames);
    expect(malformed.headers.get('x-bitbi-correlation-id')).toBe('q2-http-chain');
    jar.accept(malformed);
    expect(jar.values.has('__Host-bitbi_admin_mfa')).toBe(false);
    expect(jar.values.has('bitbi_admin_mfa')).toBe(false);

    const recovery = await request('/api/admin/mfa/verify', { recovery_code: setup.recoveryCodes[0] });
    expect(recovery.status).toBe(200);
    jar.accept(recovery);
    expect((await request('/api/admin/registration/status')).status).toBe(200);
    f.advance((f.mfa.ADMIN_MFA_PROOF_TTL_SECONDS + 1) * 1000);
    const expired = await request('/api/admin/registration/status');
    expect(expired.status).toBe(403);
    assertClearCookies(expired, proofNames);
    jar.accept(expired);
    const verify = await request('/api/admin/mfa/verify', { code: await f.mfa.generateTotpCode(setup.secret) });
    expect(verify.status).toBe(200);
    jar.accept(verify);
    const recentOldCredentialProof = jar.values.get('__Host-bitbi_admin_mfa');
    const disabled = await request('/api/admin/mfa/disable', { recovery_code: setup.recoveryCodes[1] });
    expect(disabled.status).toBe(200);
    assertClearCookies(disabled, proofNames);
    jar.accept(disabled);
    expect((await request('/api/admin/registration/status')).status).toBe(403);
    expect(await f.credential()).toBeNull();
    expect((await f.recoveryRows()).results).toHaveLength(0);

    const freshSetup = (await (await request('/api/admin/mfa/setup', {})).json()).setup;
    const reenabled = await request('/api/admin/mfa/enable', { code: await f.mfa.generateTotpCode(freshSetup.secret) });
    expect(reenabled.status).toBe(200);
    jar.accept(reenabled);
    const newProof = jar.values.get('__Host-bitbi_admin_mfa');
    expect(newProof).not.toBe(originalProof);
    jar.values.set('__Host-bitbi_admin_mfa', recentOldCredentialProof);
    const staleCredential = await request('/api/admin/registration/status');
    expect(staleCredential.status).toBe(403);
    assertClearCookies(staleCredential, proofNames);
    jar.values.set('__Host-bitbi_admin_mfa', newProof);
    expect((await request('/api/admin/registration/status')).status).toBe(200);
    const logout = await request('/api/logout', {});
    expect(logout.status).toBe(200);
    assertClearCookies(logout, ['__Host-bitbi_session', 'bitbi_session', ...proofNames]);
    jar.accept(logout);
    expect(jar.values.size).toBe(0);
    expect((await request('/api/admin/registration/status')).status).toBe(401);
  } finally { await http.close(); }
}, { enroll: false }));

test('S01/S02 HTTP policies reject absent/wrong session, cross-origin/context, body faults and missing limiter', async () => withMfaFixture(async f => {
  const { default: worker } = await load('workers/auth/src/index.js');
  const http = await startWorkerHttp(worker, f.env);
  const base = { Cookie: f.sessionCookie(), Origin: 'https://bitbi.ai', 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.21' };
  try {
    expect((await http.request('/api/admin/mfa/status')).status).toBe(401);
    for (const headers of [{ ...base, Origin: 'https://outside.example.invalid' }, { ...base, 'Sec-Fetch-Site': 'cross-site' }, { Cookie: base.Cookie, 'Content-Type': 'application/json' }]) {
      expect((await http.request('/api/admin/mfa/verify', { method: 'POST', headers, body: '{}' })).status).toBe(403);
    }
    for (const [headers, body, status] of [[{ ...base, 'Content-Type': 'text/plain' }, '{}', 415], [base, '{', 400], [base, JSON.stringify({ code: 'x'.repeat(33 * 1024) }), 413]]) {
      const response = await http.request('/api/admin/mfa/verify', { method: 'POST', headers, body });
      expect(response.status).toBe(status);
      expect(response.headers.getSetCookie()).toEqual([]);
      assertPrivateHeaders(response);
    }
    const before = await f.credential();
    const limiter = f.env.PUBLIC_RATE_LIMITER;
    delete f.env.PUBLIC_RATE_LIMITER;
    const unavailable = await http.request('/api/admin/mfa/verify', { method: 'POST', headers: base, body: JSON.stringify({ recovery_code: f.setup.recoveryCodes[0] }) });
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.getSetCookie()).toEqual([]);
    expect((await f.credential()).mutation_token).toBe(before.mutation_token);
    f.env.PUBLIC_RATE_LIMITER = limiter;
    await f.db.prepare("UPDATE users SET role = 'user' WHERE id = ?").bind(f.user.id).run();
    expect((await http.request('/api/admin/mfa/status', { headers: base })).status).toBe(403);
    await f.db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(f.user.id).run();
    expect((await http.request('/api/admin/mfa/status', { headers: { Cookie: f.sessionCookie().replace('__Host-bitbi_session', 'bitbi_session') } })).status).toBe(403);
  } finally { await http.close(); }
  const insecure = await startWorkerHttp(worker, f.env, { origin: 'http://bitbi.ai' });
  try { expect((await insecure.request('/api/admin/mfa/status', { headers: base })).status).toBe(403); }
  finally { await insecure.close(); }
}));

test('S01 proof remains session-bound and rejects correctly signed unbound v1 proof after rollout', async () => withMfaFixture(async f => {
  const { default: worker } = await load('workers/auth/src/index.js');
  const http = await startWorkerHttp(worker, f.env);
  try {
    const proof = f.enabled.response.headers.getSetCookie()[0].split(';')[0];
    const mismatch = await http.request('/api/admin/registration/status', { headers: { Cookie: `${f.sessionCookie(1)}; ${proof}` } });
    expect(mismatch.status).toBe(403);
    assertClearCookies(mismatch, proofNames);
    const unsigned = { v: 1, t: 'admin_mfa_proof', uid: f.user.id, sid: f.sessions[0].sessionId, exp: f.now() + 60_000 };
    const stable = JSON.stringify(Object.fromEntries(Object.keys(unsigned).sort().map(key => [key, unsigned[key]])));
    const sig = createHmac('sha256', `admin-mfa-proof:${f.env.ADMIN_MFA_PROOF_SECRET}`).update(stable).digest('base64url');
    const legacy = Buffer.from(JSON.stringify({ ...unsigned, sig })).toString('base64url');
    const response = await http.request('/api/admin/registration/status', { headers: { Cookie: `${f.sessionCookie()}; __Host-bitbi_admin_mfa=${legacy}` } });
    expect(response.status).toBe(403);
    assertClearCookies(response, proofNames);
  } finally { await http.close(); }
}));
