const { test, expect } = require('@playwright/test');
const { mkdirSync } = require('node:fs');
const { dirname } = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { startWorkerHttp } = require('./helpers/q2-http.js');
const { withMfaFixture, holdTwoBatches, load } = require('./q2-mfa-fixtures.cjs');

// Two actual HTTP clients use distinct real synthetic sessions. Both reach
// the real mutation batch before either commits. SQLite is file-backed;
// reopening proves durable state, not a response or an in-memory mock count.
for (const method of ['recovery', 'totp']) {
  test(`S01 HTTP ${method}: two consumers produce one durable proof and reject replay after commit`, async ({}, info) => {
    const filename = info.outputPath('mfa.sqlite');
    mkdirSync(dirname(filename), { recursive: true });
    let userId;
    let expectedStep;
    await withMfaFixture(async f => {
      userId = f.user.id;
      expectedStep = Math.floor(f.now() / 30_000);
      const { default: worker } = await load('workers/auth/src/index.js');
      const http = await startWorkerHttp(worker, f.env);
      const body = method === 'recovery' ? { recovery_code: f.setup.recoveryCodes[0] }
        : { code: await f.mfa.generateTotpCode(f.setup.secret) };
      const request = index => http.request('/api/admin/mfa/verify', {
        method: 'POST', headers: { Cookie: f.sessionCookie(index), Origin: 'https://bitbi.ai',
          'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.51' }, body: JSON.stringify(body),
      });
      const barrier = holdTwoBatches(f.db);
      try {
        const responses = await Promise.all([request(0), request(1)]);
        expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
        expect(barrier.changes.sort()).toEqual([0, 1]);
        expect(responses.filter(response => response.headers.getSetCookie().length === 1).length).toBe(1);
        const winner = responses.findIndex(response => response.status === 200);
        expect(responses[1 - winner].headers.getSetCookie()).toEqual([]);
        const proof = responses[winner].headers.getSetCookie()[0].split(';')[0];
        expect(proof.startsWith('__Host-bitbi_admin_mfa=')).toBe(true);
        expect((await http.request('/api/admin/registration/status', {
          headers: { Cookie: `${f.sessionCookie(winner)}; ${proof}` },
        })).status).toBe(200);
        expect((await http.request('/api/admin/registration/status', {
          headers: { Cookie: f.sessionCookie(1 - winner) },
        })).status).toBe(403);
        expect((await Promise.all(responses.map(response => response.json()))).filter(body => body.mfa?.verified === true).length).toBe(1);
        for (const response of responses) expect(response.headers.get('cache-control')).toBe('no-store');
        barrier.restore();
        const replay = await request(0);
        expect(replay.status).toBe(400);
        expect(replay.headers.getSetCookie()).toEqual([]);
      } finally { barrier.restore(); await http.close(); }
    }, { filename });
    const reopened = new DatabaseSync(filename, { readOnly: true });
    try {
      expect(reopened.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      if (method === 'recovery') {
        expect(reopened.prepare('SELECT COUNT(*) AS n FROM admin_mfa_recovery_codes WHERE admin_user_id = ? AND used_at IS NOT NULL').get(userId).n).toBe(1);
      } else {
        expect(reopened.prepare('SELECT last_accepted_timestep AS step FROM admin_mfa_credentials WHERE admin_user_id = ?').get(userId).step).toBe(expectedStep);
      }
    } finally { reopened.close(); }
  });
}
