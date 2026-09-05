const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { SqliteD1Database, applyAuthMigrations } = require('../helpers/sqlite-d1.js');

const USER = 'transition-ledger-member';
const ORG = 'org_' + 'c'.repeat(32);
const KEY = 'transition-ledger-operation';
const CLAIM = 'transition-owned-dispatch';
const FEATURE = 'ai.image.generate';

async function fixture(scope) {
  const DB = new SqliteD1Database();
  // Real migration/ledger guards with disposable data; no cloud bindings.
  applyAuthMigrations(DB);
  const now = new Date().toISOString();
  await DB.prepare(`INSERT INTO users (id,email,password_hash,created_at,status,role,updated_at,email_verified_at)
    VALUES (?,?,?,?,?,?,?,?)`).bind(USER, 'transition-ledger@example.invalid', 'fixture-password-hash',
    now, 'active', 'user', now, now).run();
  await DB.prepare(`INSERT INTO organizations (id,name,slug,status,created_by_user_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?)`).bind(ORG, 'Transition fixture', 'transition-ledger', 'active', USER, now, now).run();
  const billing = await import(pathToFileURL(path.resolve('workers/auth/src/lib/billing.js')).href);
  const env = { DB };
  await billing.grantMemberCredits({ env, userId: USER, amount: 100,
    idempotencyKey: 'transition-member-grant', source: 'local_fixture' });
  await billing.grantOrganizationCredits({ env, organizationId: ORG, amount: 100,
    idempotencyKey: 'transition-org-grant', source: 'local_fixture' });
  const table = scope === 'member' ? 'member_credit_ledger' : 'credit_ledger';
  const usageTable = scope === 'member' ? 'member_usage_events' : 'usage_events';
  const charge = (overrides = {}) => billing[scope === 'member' ? 'consumeMemberCredits' : 'consumeOrganizationCredits']({
    env, userId: USER, ...(scope === 'organization' ? { organizationId: ORG } : {}),
    featureKey: FEATURE, credits: 10, quantity: 1, idempotencyKey: KEY,
    requestFingerprint: 'same-logical-request', source: 'local_fixture', ...overrides,
  });
  const requireClaim = () => DB.prepare(`INSERT INTO ${scope === 'member' ? 'member_ai_usage_attempts_v2' : 'ai_usage_attempts_v2'} (
    id, user_id, ${scope === 'organization' ? 'organization_id,' : ''}
    feature_key, operation_key, route, idempotency_key, request_fingerprint, credit_cost,
    status, provider_status, billing_status, provider_outcome, dispatch_token,
    created_at, updated_at, expires_at
  ) VALUES (?, ?, ${scope === 'organization' ? '?,' : ''} ?, ?, ?, ?, ?, ?,
    'finalizing', 'succeeded', 'reserved', 'succeeded', ?, ?, ?, ?)`)
    .bind('transition-attempt', USER, ...(scope === 'organization' ? [ORG] : []), FEATURE,
      'member.image.generate', '/api/ai/generate-image', KEY, 'same-logical-request', 10,
      CLAIM, now, now, new Date(Date.now() + 30 * 60_000).toISOString()).run();
  const state = async () => ({
    debits: (await DB.prepare(`SELECT amount, ai_dispatch_token FROM ${table} WHERE amount < 0`).all()).results,
    usage: (await DB.prepare(`SELECT COUNT(*) AS count FROM ${usageTable}`).first()).count,
    balance: scope === 'member' ? await billing.getMemberCreditBalance(env, USER) : await billing.getCreditBalance(env, ORG),
    buckets: scope === 'member'
      ? (await DB.prepare('SELECT COALESCE(SUM(balance),0) AS total FROM member_credit_buckets WHERE user_id = ?').bind(USER).first()).total
      : null,
    bucketDebits: scope === 'member'
      ? (await DB.prepare('SELECT COUNT(*) AS count FROM member_credit_bucket_events WHERE user_id = ? AND amount < 0').bind(USER).first()).count
      : null,
  });
  return { DB, charge, requireClaim, state };
}

for (const scope of ['member', 'organization']) {
  test(`${scope}: an owned dispatch token reaches exactly one debit and replay needs no new token`, async () => {
    const f = await fixture(scope);
    try {
      await f.requireClaim();
      expect((await f.charge({ aiDispatchToken: CLAIM })).reused).toBe(false);
      const charged = await f.state();
      expect(charged.debits).toEqual([{ amount: -10, ai_dispatch_token: CLAIM }]);
      expect(charged.usage).toBe(1);
      expect(charged.balance).toBe(90);
      if (scope === 'member') expect(charged.buckets).toBe(90);
      expect((await f.charge()).reused).toBe(true);
      expect(await f.state()).toEqual(charged);
    } finally { f.DB.close(); }
  });

  for (const token of [null, 'another-dispatch-owner']) {
    test(`${scope}: ${token === null ? 'missing' : 'wrong'} dispatch token cannot debit any accounting row`, async () => {
      const f = await fixture(scope);
      try {
        await f.requireClaim();
        const before = await f.state();
        await expect(f.charge({ aiDispatchToken: token })).rejects.toThrow('ai_attempt_settlement_forbidden');
        expect(await f.state()).toEqual(before);
      } finally { f.DB.close(); }
    });
  }

  test(`${scope}: unrelated consumption keeps a null token and existing charging behavior`, async () => {
    const f = await fixture(scope);
    try {
      expect((await f.charge()).creditBalance).toBe(90);
      const state = await f.state();
      expect(state.debits).toEqual([{ amount: -10, ai_dispatch_token: null }]);
      expect(state.usage).toBe(1);
      if (scope === 'member') expect(state.buckets).toBe(90);
    } finally { f.DB.close(); }
  });

  test(`${scope}: an already completed legacy debit replays after a new dispatch fence`, async () => {
    const f = await fixture(scope);
    try {
      await f.charge();
      const before = await f.state();
      await f.requireClaim();
      expect((await f.charge({ aiDispatchToken: 'obsolete-owner' })).reused).toBe(true);
      expect(await f.state()).toEqual(before);
    } finally { f.DB.close(); }
  });
}
