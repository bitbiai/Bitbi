/* Real disposable SQLite; no fetch, credentials, provider, or cloud calls. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { webcrypto } = require('node:crypto');
const fs = require('node:fs');

const repo = path.resolve(process.env.BITBI_REL01_TEST_REPO || process.cwd());
const { SqliteD1Database, applyAuthMigrations } = require(path.join(repo, 'tests/helpers/sqlite-d1.js'));
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const load = (name, fresh = '') => import(pathToFileURL(path.join(repo, 'workers/auth/src/lib', name)).href + fresh);
const USER = 'rel01-sqlite-user';
const OTHER_USER = 'rel01-sqlite-other';
const ORG = 'org_' + 'a'.repeat(32);
const OTHER_ORG = 'org_' + 'b'.repeat(32);
const FEATURE = 'ai.image.generate';
const START = Date.parse('2026-09-05T04:00:00.000Z');
const COST = 10;

async function fixture(t, scope, { legacySchema = false } = {}) {
  const NativeDate = globalThis.Date;
  let current = START;
  globalThis.Date = class FixtureDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [current])); }
    static now() { return current; }
  };
  const DB = new SqliteD1Database();
  t.after(() => { DB.close(); globalThis.Date = NativeDate; });
  applyAuthMigrations(DB, { migrationsDirectory: path.join(repo, 'workers/auth/migrations'),
    ...(legacySchema ? { through: '0080_add_provider_neutral_chat_and_grok_4_6.sql' } : {}) });
  const env = { DB };
  for (const userId of [USER, OTHER_USER]) {
    await DB.prepare(`INSERT INTO users (id,email,password_hash,created_at,status,role,updated_at,email_verified_at)
      VALUES (?,?,?,?,?,?,?,?)`).bind(userId, `${userId}@example.invalid`, 'local-fixture-not-a-password',
      new Date().toISOString(), 'active', 'user', new Date().toISOString(), new Date().toISOString()).run();
  }
  for (const [organizationId, slug, owner] of [[ORG, 'rel01-one', USER], [OTHER_ORG, 'rel01-two', OTHER_USER]]) {
    await DB.prepare(`INSERT INTO organizations (id,name,slug,status,created_by_user_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?)`).bind(organizationId, slug, slug, 'active', owner, new Date().toISOString(), new Date().toISOString()).run();
  }
  const billing = await load('billing.js');
  for (const userId of [USER, OTHER_USER]) {
    await billing.grantMemberCredits({ env, userId, amount: 100, createdByUserId: null,
      idempotencyKey: `grant-${userId}`, source: 'local_fixture' });
  }
  for (const organizationId of [ORG, OTHER_ORG]) {
    await billing.grantOrganizationCredits({ env, organizationId, amount: 100,
      createdByUserId: null, idempotencyKey: `grant-${organizationId}`, source: 'local_fixture' });
  }
  const moduleName = scope === 'member' ? 'member-ai-usage-attempts.js' : 'ai-usage-attempts.js';
  let module = await load(moduleName);
  const prefix = scope === 'member' ? 'MemberAiUsageAttempt' : 'AiUsageAttempt';
  const table = (scope === 'member' ? 'member_ai_usage_attempts' : 'ai_usage_attempts') + (legacySchema ? '' : '_v2');
  const ledger = scope === 'member' ? 'member_credit_ledger' : 'credit_ledger';
  const usage = scope === 'member' ? 'member_usage_events' : 'usage_events';
  const ownerColumn = scope === 'member' ? 'user_id' : 'organization_id';
  const ownerValue = scope === 'member' ? USER : ORG;
  const defaults = { env, userId: USER, ...(scope === 'organization' ? { organizationId: ORG } : {}),
    featureKey: FEATURE, operationKey: 'member.image.generate', route: '/api/ai/generate-image',
    idempotencyKey: 'rel01-attempt-key', requestFingerprint: 'rel01-original-fingerprint', creditCost: COST, quantity: 1 };
  const call = (suffix, ...args) => module[`mark${prefix}${suffix}`](env, ...args);
  const begin = (overrides = {}) => module[`begin${prefix}`]({ ...defaults, ...overrides });
  const cleanup = (overrides = {}) => module[scope === 'member' ? 'cleanupExpiredMemberAiUsageAttempts' : 'cleanupExpiredAiUsageAttempts']({ env, now: new Date().toISOString(), dryRun: false, ...overrides });
  const row = (id) => DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first();
  const rows = () => DB.prepare(`SELECT * FROM ${table} ORDER BY id`).all().then((r) => r.results);
  const ledgerRows = () => DB.prepare(`SELECT * FROM ${ledger} WHERE ${ownerColumn} = ? ORDER BY rowid`).bind(ownerValue).all().then((r) => r.results);
  const usageRows = () => DB.prepare(`SELECT * FROM ${usage} WHERE ${ownerColumn} = ? ORDER BY rowid`).bind(ownerValue).all().then((r) => r.results);
  const balance = () => scope === 'member' ? billing.getMemberCreditBalance(env, USER) : billing.getCreditBalance(env, ORG);
  const charge = async (overrides = {}) => billing[scope === 'member' ? 'consumeMemberCredits' : 'consumeOrganizationCredits']({
    env, userId: USER, ...(scope === 'organization' ? { organizationId: ORG } : {}), featureKey: FEATURE,
    quantity: 1, credits: COST, idempotencyKey: defaults.idempotencyKey, requestFingerprint: defaults.requestFingerprint,
    source: 'local_fixture', aiDispatchToken: (await DB.prepare(`SELECT dispatch_token FROM ${table} WHERE idempotency_key = ? AND ${ownerColumn} = ?`).bind(overrides.idempotencyKey || defaults.idempotencyKey, overrides[scope === 'member' ? 'userId' : 'organizationId'] || ownerValue).first())?.dispatch_token || null, ...overrides });
  let providerCalls = 0;
  const dispatch = async (id) => { const token = await call('ProviderRunning', id); providerCalls += 1; return token; };
  return { DB, env, scope, table, defaults, begin, call, cleanup, row, rows, ledgerRows, usageRows, balance, charge, dispatch,
    providerCalls: () => providerCalls,
    now: () => new Date().toISOString(),
    advance: (milliseconds) => { current += milliseconds; },
    restart: async () => { module = await load(moduleName, `?rel01-restart=${scope}-${current}`); },
  };
}

function register(test) {
for (const scope of ['member', 'organization']) {
  test(`${scope}: ambiguous dispatched failure must not execute the provider twice`, async (t) => {
    const f = await fixture(t, scope);
    const initial = await f.begin();
    assert.equal(initial.kind, 'reserved');
    const token = await f.dispatch(initial.attempt.id);
    await f.call('ProviderFailed', initial.attempt.id, { dispatchToken: token, code: 'generation_timeout', message: 'Local provider kept running after timeout.' });
    const duplicate = await f.begin();
    if (duplicate.kind === 'reserved') await f.dispatch(duplicate.attempt.id);
    assert.equal(f.providerCalls(), 1, 'A transport timeout cannot authorize another provider execution.');
    assert.equal(duplicate.kind, 'unresolved');
    assert.equal(duplicate.attempt.id, initial.attempt.id);
    assert.equal((await f.rows()).length, 1);
    assert.equal((await f.usageRows()).length, 0);
    assert.equal((await f.ledgerRows()).filter((r) => r.amount < 0).length, 0);
    assert.equal(await f.balance(), 100);
  });

  test(`${scope}: only one concurrent dispatch claim may invoke a provider`, async (t) => {
    const f = await fixture(t, scope);
    const initial = await f.begin();
    const attempts = await Promise.allSettled([f.dispatch(initial.attempt.id), f.dispatch(initial.attempt.id)]);
    assert.equal(f.providerCalls(), 1, 'A zero-row dispatch claim must reject before provider invocation.');
    assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(attempts.filter((r) => r.status === 'rejected').length, 1);
    assert.equal(typeof attempts.find((r) => r.status === 'fulfilled').value, 'string');
    assert.equal((await f.rows()).length, 1);
    assert.equal((await f.usageRows()).length, 0);
  });

  test(`${scope}: concurrent duplicate reservation and conflicting payload preserve one identity`, async (t) => {
    const f = await fixture(t, scope);
    const [first, second] = await Promise.all([f.begin(), f.begin()]);
    assert.equal(first.attempt.id, second.attempt.id);
    assert.equal([first, second].filter((r) => r.kind === 'reserved').length, 1);
    assert.equal([first, second].filter((r) => r.kind === 'in_progress').length, 1);
    await assert.rejects(f.begin({ requestFingerprint: 'a-conflicting-payload' }), (e) => e.code === 'idempotency_conflict');
    assert.equal((await f.rows()).length, 1);
    assert.equal((await f.row(first.attempt.id)).request_fingerprint, f.defaults.requestFingerprint);
    assert.equal(f.providerCalls(), 0);
    assert.equal(await f.balance(), 100);
  });

  test(`${scope}: the same opaque key in another principal scope has a separate identity`, async (t) => {
    const f = await fixture(t, scope);
    const original = await f.begin();
    const other = await f.begin(scope === 'member'
      ? { userId: OTHER_USER }
      : { organizationId: OTHER_ORG, userId: OTHER_USER });
    assert.notEqual(original.attempt.id, other.attempt.id);
    assert.equal(other.kind, 'reserved');
    const firstRow = await f.row(original.attempt.id);
    const otherRow = await f.row(other.attempt.id);
    assert.equal(firstRow.user_id, USER);
    assert.equal(otherRow.user_id, OTHER_USER);
    if (scope === 'organization') {
      assert.equal(firstRow.organization_id, ORG);
      assert.equal(otherRow.organization_id, OTHER_ORG);
    }
    assert.equal((await f.rows()).length, 2);
    assert.equal(f.providerCalls(), 0);
  });

  test(`${scope}: unknown survives restart, metadata loss and one-time reservation expiry`, async (t) => {
    const f = await fixture(t, scope);
    const initial = await f.begin();
    const id = initial.attempt.id;
    const originalExpiry = (await f.row(id)).expires_at;
    const token = await f.dispatch(id);
    f.advance(5 * 60_000);
    await f.call('Unknown', id, { dispatchToken: token, code: 'generation_timeout', message: 'Local unresolved fixture.' });
    assert.equal((await f.row(id)).provider_outcome, 'unknown');
    assert.equal((await f.row(id)).billing_status, 'reserved');
    await assert.rejects(f.begin({ idempotencyKey: 'rel01-too-large-while-held', creditCost: 95 }), (e) => e.status === 402);
    // Dedicated outcome identity must survive an unrelated metadata rewrite/truncation.
    await f.DB.prepare(`UPDATE ${f.table} SET metadata_json = '{}' WHERE id = ?`).bind(id).run();
    await f.restart();
    const duplicate = await f.begin();
    assert.equal(duplicate.kind, 'unresolved');
    assert.equal(duplicate.attempt.id, id);
    assert.equal((await f.row(id)).expires_at, originalExpiry);
    f.advance(25 * 60_000 - 1);
    await f.cleanup();
    assert.equal((await f.row(id)).billing_status, 'reserved');
    f.advance(1);
    const firstCleanup = await f.cleanup();
    const released = await f.row(id);
    assert.equal(released.provider_outcome, 'unknown');
    assert.equal(released.billing_status, 'released');
    assert.ok(released.reservation_released_at, 'Release must be independently durable.');
    assert.equal(firstCleanup.reservationsReleasedCount, 1);
    const secondCleanup = await f.cleanup();
    assert.equal(secondCleanup.reservationsReleasedCount, 0);
    assert.equal((await f.row(id)).reservation_released_at, released.reservation_released_at);
    await f.restart();
    assert.equal((await f.begin()).kind, 'unresolved');
    assert.equal((await f.row(id)).expires_at, originalExpiry);
    assert.equal(f.providerCalls(), 1);
    assert.equal((await f.ledgerRows()).filter((r) => r.amount < 0).length, 0);
    assert.equal((await f.usageRows()).length, 0);
    assert.equal(await f.balance(), 100);
    const newOperation = await f.begin({ idempotencyKey: 'rel01-explicit-new-operation', creditCost: 100 });
    assert.equal(newOperation.kind, 'reserved', 'Released unknown hold must not consume future available credits.');
    assert.notEqual(newOperation.attempt.id, id);
  });

  test(`${scope}: unknown and released attempts cannot finalize or silently debit`, async (t) => {
    const f = await fixture(t, scope);
    const initial = await f.begin();
    const id = initial.attempt.id;
    const token = await f.dispatch(id);
    await f.call('Unknown', id, { dispatchToken: token, code: 'transport_lost' });
    await assert.rejects(f.call('Finalizing', id, { dispatchToken: token }));
    await assert.rejects(f.charge());
    assert.equal((await f.usageRows()).length, 0);
    assert.equal((await f.ledgerRows()).filter((r) => r.amount < 0).length, 0);
    assert.equal(await f.balance(), 100);
    f.advance(30 * 60_000);
    await f.cleanup();
    await assert.rejects(f.call('Finalizing', id, { dispatchToken: token }));
    await assert.rejects(f.call('Succeeded', id, { dispatchToken: token, resultStatus: 'unavailable', balanceAfter: 90 }));
    await assert.rejects(f.charge());
    const row = await f.row(id);
    assert.equal(row.provider_outcome, 'unknown');
    assert.equal(row.billing_status, 'released');
    assert.equal((await f.begin()).kind, 'unresolved');
    assert.equal((await f.usageRows()).length, 0);
    assert.equal((await f.ledgerRows()).filter((r) => r.amount < 0).length, 0);
    assert.equal(await f.balance(), 100, 'A late success must not create a new debit after release.');
    assert.equal(f.providerCalls(), 1);
  });

  test(`${scope}: wrong dispatch token cannot settle another claimant's attempt`, async (t) => {
    const f = await fixture(t, scope);
    const initial = await f.begin();
    const id = initial.attempt.id;
    const token = await f.dispatch(id);
    assert.equal(typeof token, 'string');
    assert.ok(token.length > 0);
    await assert.rejects(f.call('Finalizing', id, { dispatchToken: `${token}-stale` }));
    await assert.rejects(f.call('Succeeded', id, { dispatchToken: `${token}-stale`, resultStatus: 'unavailable' }));
    const row = await f.row(id);
    assert.equal(row.dispatch_token, token);
    assert.equal(row.provider_outcome, 'dispatched');
    assert.equal(row.billing_status, 'reserved');
    assert.equal((await f.usageRows()).length, 0);
    assert.equal(f.providerCalls(), 1);
  });

  test(`${scope}: confirmed success charges once, replays, expires without resubmission, and permits a new key`, async (t) => {
    const f = await fixture(t, scope);
    const initial = await f.begin();
    const id = initial.attempt.id;
    const token = await f.dispatch(id);
    await f.call('Finalizing', id, { dispatchToken: token });
    const charged = await f.charge();
    assert.equal(charged.creditBalance, 90);
    await f.call('Succeeded', id, { dispatchToken: token, resultStatus: 'unavailable', balanceAfter: 90, model: 'fixture/model' });
    const replay = await f.begin();
    assert.equal(replay.kind, 'completed');
    assert.equal(replay.attempt.id, id);
    const repeatedCharge = await f.charge();
    assert.equal(repeatedCharge.reused, true);
    assert.equal((await f.usageRows()).length, 1);
    assert.equal((await f.ledgerRows()).filter((r) => r.amount < 0).length, 1);
    assert.equal(await f.balance(), 90);
    f.advance(30 * 60_000 + 1);
    await f.cleanup();
    await f.restart();
    const expiredReplay = await f.begin();
    assert.equal(expiredReplay.kind, 'completed_expired');
    assert.equal(expiredReplay.attempt.id, id);
    assert.equal(f.providerCalls(), 1);
    const newOperation = await f.begin({ idempotencyKey: 'rel01-new-success-key' });
    assert.equal(newOperation.kind, 'reserved');
    assert.notEqual(newOperation.attempt.id, id);
    await f.dispatch(newOperation.attempt.id);
    assert.equal(f.providerCalls(), 2);
    assert.equal((await f.usageRows()).length, 1);
    assert.equal(await f.balance(), 90);
  });

  test(`${scope}: confirmed provider failure preserves identity and requires an explicit new operation`, async (t) => {
    const f = await fixture(t, scope);
    const initial = await f.begin();
    const id = initial.attempt.id;
    const token = await f.dispatch(id);
    await f.call('ProviderFailed', id, { dispatchToken: token, code: 'confirmed_provider_failure', confirmedOutcome: true });
    const row = await f.row(id);
    assert.equal(row.provider_outcome, 'failed');
    assert.equal(row.billing_status, 'released');
    assert.equal((await f.begin()).kind, 'confirmed_failed');
    const newOperation = await f.begin({ idempotencyKey: 'rel01-new-after-confirmed-failure' });
    assert.equal(newOperation.kind, 'reserved');
    assert.notEqual(newOperation.attempt.id, id);
    assert.equal(f.providerCalls(), 1);
    assert.equal((await f.usageRows()).length, 0);
    assert.equal(await f.balance(), 100);
  });

  test(`${scope}: proven pre-dispatch failure retries with the original deadline and no additional debit`, async (t) => {
    const f = await fixture(t, scope);
    const initial = await f.begin();
    const id = initial.attempt.id;
    const expiry = (await f.row(id)).expires_at;
    await f.call('ProviderFailed', id, { definitelyNotDispatched: true, code: 'local_validation_failed' });
    assert.equal((await f.row(id)).provider_outcome, 'not_dispatched');
    assert.equal((await f.row(id)).billing_status, 'released');
    f.advance(5 * 60_000);
    const retried = await f.begin();
    assert.equal(retried.kind, 'reserved');
    assert.equal(retried.attempt.id, id);
    assert.equal((await f.row(id)).expires_at, expiry);
    await f.dispatch(id);
    assert.equal(f.providerCalls(), 1);
    assert.equal((await f.rows()).length, 1);
    assert.equal((await f.usageRows()).length, 0);
    assert.equal(await f.balance(), 100);
  });

  test(`${scope}: pre-aborted dispatch never calls provider and releases a known non-dispatch`, async (t) => {
    const f = await fixture(t, scope);
    const initial = await f.begin();
    const caller = new AbortController();
    const reason = new DOMException('Local fixture cancellation before dispatch.', 'AbortError');
    caller.abort(reason);
    await assert.rejects(f.call('ProviderRunning', initial.attempt.id, { signal: caller.signal }), (e) => e === reason);
    const row = await f.row(initial.attempt.id);
    assert.equal(row.provider_outcome, 'not_dispatched');
    assert.equal(row.billing_status, 'released');
    assert.equal(f.providerCalls(), 0);
    assert.equal((await f.begin()).kind, 'reserved');
    assert.equal((await f.usageRows()).length, 0);
  });

  test(`${scope}: never-dispatched expired key cannot become a fresh operation`, async (t) => {
    const f = await fixture(t, scope);
    const initial = await f.begin();
    f.advance(30 * 60_000);
    await f.cleanup();
    await f.restart();
    const duplicate = await f.begin();
    assert.equal(duplicate.kind, 'key_expired');
    assert.equal(duplicate.attempt.id, initial.attempt.id);
    assert.equal((await f.rows()).length, 1);
    assert.equal(f.providerCalls(), 0);
    assert.equal((await f.usageRows()).length, 0);
  });

  test(`${scope}: late outcome evidence is fenced, bounded, first-write-only and never a settlement`, async (t) => {
    const f = await fixture(t, scope);
    const initial = await f.begin();
    const id = initial.attempt.id;
    const token = await f.dispatch(id);
    await f.call('Unknown', id, { dispatchToken: token, code: 'generation_timeout' });
    f.advance(30 * 60_000);
    await f.cleanup();
    assert.equal(await f.call('LateOutcome', id, { dispatchToken: `${token}-stale`, outcome: 'succeeded', code: 'stale' }), false);
    assert.equal((await f.row(id)).late_outcome, null);
    assert.equal(await f.call('LateOutcome', id, { dispatchToken: token, outcome: 'succeeded', code: 'late-success-' + 'x'.repeat(10_000) }), true);
    const first = await f.row(id);
    assert.equal(first.late_outcome, 'succeeded');
    assert.ok(first.late_evidence_json.length < 1024);
    assert.equal(JSON.parse(first.late_evidence_json).provider_cost, 'unreconciled');
    assert.equal(await f.call('LateOutcome', id, { dispatchToken: token, outcome: 'failed', code: 'contradictory-late-event' }), false);
    assert.equal((await f.row(id)).late_evidence_json, first.late_evidence_json);
    assert.equal((await f.row(id)).provider_outcome, 'unknown');
    assert.equal((await f.row(id)).billing_status, 'released');
    assert.equal((await f.begin()).kind, 'unresolved');
    assert.equal((await f.usageRows()).length, 0);
    assert.equal(await f.balance(), 100);
    assert.equal(f.providerCalls(), 1);
  });

  test(`${scope}: settlement trigger aborts and rolls back an entire real SQLite batch`, async (t) => {
    const f = await fixture(t, scope);
    const initial = await f.begin();
    const id = initial.attempt.id;
    const token = await f.dispatch(id);
    await f.call('Unknown', id, { dispatchToken: token, code: 'transport_lost' });
    const beforeMetadata = (await f.row(id)).metadata_json;
    const ledger = scope === 'member' ? 'member_credit_ledger' : 'credit_ledger';
    const ownerColumn = scope === 'member' ? 'user_id' : 'organization_id';
    const ownerValue = scope === 'member' ? USER : ORG;
    await assert.rejects(f.DB.batch([
      f.DB.prepare(`UPDATE ${f.table} SET metadata_json = ? WHERE id = ?`).bind('{"must_rollback":true}', id),
      f.DB.prepare(`INSERT INTO ${ledger} (id,${ownerColumn},amount,balance_after,entry_type,feature_key,source,idempotency_key,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).bind(`rejected-${scope}-debit`, ownerValue, -COST, 90, 'usage', FEATURE, 'local_fixture', f.defaults.idempotencyKey, f.now()),
    ]), /ai_attempt_settlement_forbidden/);
    assert.equal((await f.row(id)).metadata_json, beforeMetadata, 'The mutation before the rejected ledger insert must roll back too.');
    assert.equal((await f.ledgerRows()).filter((r) => r.amount < 0).length, 0);
    assert.equal((await f.usageRows()).length, 0);
    assert.equal(await f.balance(), 100);
  });

  test(`${scope}: settlement competing with cleanup at the deadline cannot charge or redispatch`, async (t) => {
    const f = await fixture(t, scope);
    const initial = await f.begin();
    const id = initial.attempt.id;
    const token = await f.dispatch(id);
    f.advance(30 * 60_000);
    const [settlement, cleanup] = await Promise.allSettled([
      f.call('Finalizing', id, { dispatchToken: token }),
      f.cleanup(),
    ]);
    assert.equal(settlement.status, 'rejected');
    assert.equal(cleanup.status, 'fulfilled');
    const row = await f.row(id);
    assert.equal(row.provider_outcome, 'unknown');
    assert.equal(row.billing_status, 'released');
    assert.ok(row.reservation_released_at);
    assert.equal(row.late_outcome, 'succeeded');
    await assert.rejects(f.charge());
    assert.equal((await f.begin()).kind, 'unresolved');
    assert.equal((await f.cleanup()).reservationsReleasedCount, 0);
    assert.equal((await f.usageRows()).length, 0);
    assert.equal((await f.ledgerRows()).filter((r) => r.amount < 0).length, 0);
    assert.equal(await f.balance(), 100);
    assert.equal(f.providerCalls(), 1);
  });

  test(`${scope}: confirmed-before-deadline settlement wins before cleanup and keeps exactly one debit`, async (t) => {
    const f = await fixture(t, scope);
    const initial = await f.begin();
    const id = initial.attempt.id;
    const token = await f.dispatch(id);
    f.advance(30 * 60_000 - 1);
    await f.call('Finalizing', id, { dispatchToken: token });
    f.advance(1);
    assert.equal((await f.charge()).creditBalance, 90);
    await f.cleanup();
    const pendingSuccess = await f.row(id);
    assert.equal(pendingSuccess.status, 'succeeded');
    assert.equal(pendingSuccess.billing_status, 'finalized');
    assert.equal(pendingSuccess.result_status, 'unavailable');
    assert.equal(pendingSuccess.provider_outcome, 'succeeded');
    assert.equal(pendingSuccess.reservation_released_at, null);
    await assert.rejects(f.call('Succeeded', id, { dispatchToken: token, resultStatus: 'unavailable', balanceAfter: 90 }));
    assert.equal((await f.begin()).kind, 'completed_expired');
    assert.equal((await f.charge()).reused, true);
    assert.equal((await f.ledgerRows()).filter((r) => r.amount < 0).length, 1);
    assert.equal((await f.usageRows()).length, 1);
    assert.equal(await f.balance(), 90);
    assert.equal(f.providerCalls(), 1);
  });

  test(`${scope}: cleanup winning before confirmed settlement prevents every debit in the batch`, async (t) => {
    const f = await fixture(t, scope);
    const initial = await f.begin();
    const id = initial.attempt.id;
    const token = await f.dispatch(id);
    f.advance(30 * 60_000 - 1);
    await f.call('Finalizing', id, { dispatchToken: token });
    f.advance(1);
    await f.cleanup();
    assert.equal((await f.row(id)).status, 'billing_failed');
    assert.equal((await f.row(id)).provider_outcome, 'succeeded', 'Known provider success must not become a claimed provider failure.');
    await assert.rejects(f.charge());
    await assert.rejects(f.call('Succeeded', id, { dispatchToken: token, resultStatus: 'unavailable', balanceAfter: 90 }));
    assert.equal((await f.begin()).kind, 'billing_failed');
    assert.equal((await f.ledgerRows()).filter((r) => r.amount < 0).length, 0);
    assert.equal((await f.usageRows()).length, 0);
    assert.equal(await f.balance(), 100);
    assert.equal(f.providerCalls(), 1);
  });

  test(`${scope}: committed debit reconciles after a reported billing crash without charging again`, async (t) => {
    const f = await fixture(t, scope);
    const initial = await f.begin();
    const id = initial.attempt.id;
    const token = await f.dispatch(id);
    await f.call('Finalizing', id, { dispatchToken: token });
    await f.charge();
    f.advance(1_000);
    await f.call('BillingFailed', id, { dispatchToken: token, code: 'local_post_debit_crash' });
    const recovered = await f.row(id);
    assert.equal(recovered.status, 'succeeded');
    assert.equal(recovered.billing_status, 'finalized');
    assert.equal(recovered.provider_outcome, 'succeeded');
    assert.equal(recovered.result_status, 'unavailable');
    assert.equal(recovered.balance_after, 90);
    assert.equal(recovered.reservation_released_at, null);
    assert.equal((await f.begin()).kind, 'completed');
    f.advance(1_000);
    await f.call('BillingFailed', id, { dispatchToken: token, code: 'duplicate_crash_notification' });
    assert.equal((await f.row(id)).completed_at, recovered.completed_at);
    assert.equal((await f.row(id)).status, 'succeeded');
    assert.equal((await f.ledgerRows()).filter((r) => r.amount < 0).length, 1);
    assert.equal((await f.usageRows()).length, 1);
    assert.equal(await f.balance(), 90);
    assert.equal(f.providerCalls(), 1);
  });

  test(`${scope}: committed debit cleanup advances a one-row batch to the next unknown hold`, async (t) => {
    const f = await fixture(t, scope);
    const first = await f.begin();
    const firstId = first.attempt.id;
    const token = await f.dispatch(firstId);
    await f.call('Finalizing', firstId, { dispatchToken: token });
    await f.charge();
    f.advance(1);
    const secondKey = 'rel01-later-unknown-cleanup';
    const second = await f.begin({ idempotencyKey: secondKey });
    const secondToken = await f.dispatch(second.attempt.id);
    await f.call('Unknown', second.attempt.id, { dispatchToken: secondToken, code: 'transport_lost' });
    f.advance(30 * 60_000);
    await f.restart();
    await f.cleanup({ limit: 1 });
    const recovered = await f.row(firstId);
    assert.equal(recovered.status, 'succeeded');
    assert.equal(recovered.billing_status, 'finalized');
    assert.equal(recovered.result_status, 'unavailable');
    assert.equal(recovered.balance_after, 90);
    assert.equal((await f.row(second.attempt.id)).billing_status, 'reserved');
    const nextBatch = await f.cleanup({ limit: 1 });
    const released = await f.row(second.attempt.id);
    assert.equal(nextBatch.reservationsReleasedCount, 1);
    assert.equal(released.provider_outcome, 'unknown');
    assert.equal(released.billing_status, 'released');
    assert.ok(released.reservation_released_at);
    assert.equal((await f.cleanup({ limit: 1 })).reservationsReleasedCount, 0);
    assert.equal((await f.row(second.attempt.id)).reservation_released_at, released.reservation_released_at);
    assert.equal((await f.begin()).kind, 'completed_expired');
    assert.equal((await f.begin({ idempotencyKey: secondKey })).kind, 'unresolved');
    assert.equal((await f.ledgerRows()).filter((r) => r.amount < 0).length, 1);
    assert.equal((await f.usageRows()).length, 1);
    assert.equal(await f.balance(), 90);
    assert.equal(f.providerCalls(), 2);
  });

  test(`${scope}: cleanup recovers legacy billing_failed with an existing confirmed debit`, async (t) => {
    const f = await fixture(t, scope);
    const initial = await f.begin();
    const id = initial.attempt.id;
    const token = await f.dispatch(id);
    await f.call('Finalizing', id, { dispatchToken: token });
    await f.charge();
    // Simulate the persisted state of earlier code after charging, not a new policy transition.
    await f.DB.prepare(`UPDATE ${f.table} SET status = 'billing_failed', billing_status = 'failed',
      result_status = 'none', completed_at = ?, error_code = 'legacy_post_debit_crash' WHERE id = ?`)
      .bind(f.now(), id).run();
    const originalTerminal = (await f.row(id)).completed_at;
    f.advance(30 * 60_000);
    await f.restart();
    await f.cleanup({ limit: 1 });
    const recovered = await f.row(id);
    assert.equal(recovered.status, 'succeeded');
    assert.equal(recovered.billing_status, 'finalized');
    assert.equal(recovered.provider_outcome, 'succeeded');
    assert.equal(recovered.result_status, 'unavailable');
    assert.equal(recovered.balance_after, 90);
    assert.equal(recovered.completed_at, originalTerminal);
    assert.equal((await f.begin()).kind, 'completed_expired');
    await f.cleanup({ limit: 1 });
    assert.equal((await f.row(id)).completed_at, originalTerminal);
    assert.equal((await f.ledgerRows()).filter((r) => r.amount < 0).length, 1);
    assert.equal((await f.usageRows()).length, 1);
    assert.equal(await f.balance(), 90);
    assert.equal(f.providerCalls(), 1);
  });

  test(`${scope}: unavailable success upgrades to stored once without changing its terminal timestamp`, async (t) => {
    const f = await fixture(t, scope);
    const initial = await f.begin();
    const id = initial.attempt.id;
    const token = await f.dispatch(id);
    await f.call('Finalizing', id, { dispatchToken: token });
    await f.charge();
    await f.call('Succeeded', id, { dispatchToken: token, resultStatus: 'unavailable', balanceAfter: 90 });
    const first = await f.row(id);
    f.advance(1000);
    const saved = { dispatchToken: token, resultStatus: 'stored', tempKey: `tmp/ai-generated/${USER}/local-fixture`,
      saveReference: 'local-fixture-unsigned-reference', mimeType: 'image/png', balanceAfter: 90 };
    await f.call('Succeeded', id, saved);
    const stored = await f.row(id);
    assert.equal(stored.result_status, 'stored');
    assert.equal(stored.result_temp_key, saved.tempKey);
    assert.equal(stored.result_save_reference, saved.saveReference);
    assert.equal(stored.completed_at, first.completed_at);
    assert.notEqual(stored.updated_at, first.updated_at);
    assert.equal((await f.begin()).kind, 'completed');
    await assert.rejects(f.call('Succeeded', id, { ...saved, tempKey: `tmp/ai-generated/${USER}/must-not-overwrite` }));
    assert.equal((await f.row(id)).result_temp_key, saved.tempKey);
    assert.equal((await f.row(id)).completed_at, first.completed_at);
    assert.equal((await f.ledgerRows()).filter((r) => r.amount < 0).length, 1);
    assert.equal((await f.usageRows()).length, 1);
    assert.equal(await f.balance(), 90);
    assert.equal(f.providerCalls(), 1);
  });

  test(`${scope}: stored replay upgrade rejects expired and unknown attempts`, async (t) => {
    const f = await fixture(t, scope);
    const initial = await f.begin();
    const id = initial.attempt.id;
    const token = await f.dispatch(id);
    await f.call('Finalizing', id, { dispatchToken: token });
    await f.charge();
    await f.call('Succeeded', id, { dispatchToken: token, resultStatus: 'unavailable', balanceAfter: 90 });
    const first = await f.row(id);
    f.advance(30 * 60_000);
    const saved = { dispatchToken: token, resultStatus: 'stored', tempKey: `tmp/ai-generated/${USER}/late-fixture`, saveReference: 'local-fixture-reference' };
    await assert.rejects(f.call('Succeeded', id, saved));
    assert.equal((await f.row(id)).result_status, 'unavailable');
    assert.equal((await f.row(id)).completed_at, first.completed_at);
    assert.equal((await f.begin()).kind, 'completed_expired');
    const unknown = await f.begin({ idempotencyKey: 'rel01-unknown-cannot-upgrade' });
    const unknownToken = await f.dispatch(unknown.attempt.id);
    await f.call('Unknown', unknown.attempt.id, { dispatchToken: unknownToken, code: 'transport_lost' });
    await assert.rejects(f.call('Succeeded', unknown.attempt.id, { ...saved, dispatchToken: unknownToken }));
    assert.equal((await f.row(unknown.attempt.id)).provider_outcome, 'unknown');
    assert.equal((await f.row(unknown.attempt.id)).result_status, 'none');
    assert.equal((await f.ledgerRows()).filter((r) => r.amount < 0).length, 1);
    assert.equal((await f.usageRows()).length, 1);
    assert.equal(await f.balance(), 90);
  });

  test(`${scope}: migration conservatively retains legacy dispatched keys and blocks stale redispatch SQL`, async (t) => {
    const f = await fixture(t, scope, { legacySchema: true });
    const id = `legacy-${scope}-attempt`;
    const columns = scope === 'member' ? 'id,user_id' : 'id,user_id,organization_id';
    const owners = scope === 'member' ? [id, USER] : [id, USER, ORG];
    const values = [...owners, FEATURE, 'member.image.generate', '/api/ai/generate-image',
      f.defaults.idempotencyKey, f.defaults.requestFingerprint, COST,
      'provider_failed', 'failed', 'released', f.now(), f.now(), new Date(START + 30 * 60_000).toISOString()];
    await f.DB.prepare(`INSERT INTO ${f.table} (${columns},feature_key,operation_key,route,idempotency_key,request_fingerprint,credit_cost,
      status,provider_status,billing_status,created_at,updated_at,expires_at)
      VALUES (${values.map(() => '?').join(',')})`).bind(...values).run();
    const migration = path.join(repo, 'workers/auth/migrations/0081_add_ai_dispatch_outcome_guards.sql');
    f.DB.exec(fs.readFileSync(migration, 'utf8'));
    const migrated = await f.row(id);
    assert.equal(migrated.provider_outcome, 'unknown');
    assert.equal(migrated.dispatch_token, `legacy:${id}`);
    assert.ok(migrated.reservation_released_at);
    assert.equal((await f.begin()).kind, 'unresolved');
    await assert.rejects(f.DB.prepare(`UPDATE ${f.table} SET status = 'reserved', provider_status = 'not_started', billing_status = 'reserved' WHERE id = ?`).bind(id).run(), /cannot modify .* because it is a view/);
    await assert.rejects(f.DB.prepare(`UPDATE ${f.table}_v2 SET status = 'reserved', provider_status = 'not_started', billing_status = 'reserved' WHERE id = ?`).bind(id).run(), /ai_attempt_redispatch_forbidden/);
    assert.equal((await f.row(id)).provider_outcome, 'unknown');
    assert.equal((await f.row(id)).billing_status, 'released');
    assert.equal((await f.rows()).length, 1);
    assert.equal(f.providerCalls(), 0);
  });
}

async function splitMemberBuckets(f) {
  await f.DB.prepare("UPDATE member_credit_buckets SET balance = CASE WHEN bucket_type = 'legacy_or_bonus' THEN 50 ELSE 0 END WHERE user_id = ?").bind(USER).run();
  const purchased = await f.DB.prepare("SELECT id FROM member_credit_buckets WHERE user_id = ? AND bucket_type = 'purchased'").bind(USER).first();
  if (purchased) await f.DB.prepare('UPDATE member_credit_buckets SET balance = 50 WHERE id = ?').bind(purchased.id).run();
  else await f.DB.prepare("INSERT INTO member_credit_buckets (id,user_id,bucket_type,balance,created_at,updated_at) VALUES (?,?,'purchased',50,?,?)").bind('local-race-purchased', USER, f.now(), f.now()).run();
}

for (const scenario of [
  { label: 'conflicting distinct settlements roll back the entire second debit', credits: 40, sameKey: false, expectedDebits: 1, eventBalances: [10] },
  { label: 'successful distinct settlements record actual serialized bucket balances', credits: 20, sameKey: false, expectedDebits: 2, eventBalances: [30, 10] },
  { label: 'same-key concurrent settlements keep one ledger and bucket debit', credits: 40, sameKey: true, expectedDebits: 1, eventBalances: [10] },
]) {
  test(`member bucket atomicity: ${scenario.label}`, { timeout: 3000 }, async (t) => {
    const f = await fixture(t, 'member');
    await splitMemberBuckets(f);
    const keys = [f.defaults.idempotencyKey, scenario.sameKey ? f.defaults.idempotencyKey : 'local-second-settlement'];
    const attempts = [];
    for (const key of [...new Set(keys)]) {
      const attempt = await f.begin({ idempotencyKey: key, creditCost: scenario.credits });
      const token = await f.call('ProviderRunning', attempt.attempt.id);
      await f.call('Finalizing', attempt.attempt.id, { dispatchToken: token });
      attempts.push({ id: attempt.attempt.id, token });
    }
    // Both callers plan first; D1 executes each complete batch atomically.
    // Serialize the local shim's batches to avoid an artificial nested transaction.
    const originalBatch = f.DB.batch.bind(f.DB);
    const plansReady = deferred();
    let arrived = 0;
    let queue = Promise.resolve();
    f.DB.batch = async (statements) => {
      if (++arrived === 2) plansReady.resolve();
      await plansReady.promise;
      const run = queue.then(() => originalBatch(statements));
      queue = run.catch(() => {});
      return run;
    };
    const outcomes = await Promise.allSettled(keys.map((idempotencyKey) => f.charge({ credits: scenario.credits, idempotencyKey })));
    f.DB.batch = originalBatch;
    const debits = (await f.ledgerRows()).filter((row) => row.amount < 0);
    const usage = await f.usageRows();
    const latest = await f.DB.prepare('SELECT balance_after FROM member_credit_ledger WHERE user_id = ? ORDER BY created_at DESC,rowid DESC LIMIT 1').bind(USER).first();
    const buckets = await f.DB.prepare('SELECT SUM(balance) AS total FROM member_credit_buckets WHERE user_id = ?').bind(USER).first();
    const events = await f.DB.prepare('SELECT amount,balance_after FROM member_credit_bucket_events WHERE user_id = ? AND amount < 0 ORDER BY rowid').bind(USER).all();
    assert.equal(debits.length, scenario.expectedDebits);
    assert.equal(usage.length, scenario.expectedDebits);
    assert.equal(latest.balance_after, 60);
    assert.equal(buckets.total, 60, 'Bucket balances must remain equal to the committed credit ledger.');
    assert.deepEqual(events.results.map((row) => row.balance_after), scenario.eventBalances);
    assert.equal(events.results.length, scenario.expectedDebits);
    assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, scenario.expectedDebits);
    if (!scenario.sameKey && scenario.credits === 40) {
      const failure = outcomes.find((outcome) => outcome.status === 'rejected');
      assert.equal(failure.reason.code, 'insufficient_member_credits');
      await f.call('BillingFailed', attempts[1].id, { dispatchToken: attempts[1].token });
      const receipt = await f.row(attempts[1].id);
      assert.equal(receipt.status, 'billing_failed', 'A rolled-back debit must not be reconciled as charged.');
      assert.equal(receipt.billing_status, 'failed');
      assert.equal(receipt.provider_outcome, 'succeeded');
      assert.equal((await f.ledgerRows()).filter((row) => row.amount < 0).length, 1);
    }
    assert.equal(f.providerCalls(), 0, 'Only bookkeeping claims are exercised; no provider function is called.');
  });
}

test('member bucket atomicity: a removed planned bucket aborts ledger and usage together', { timeout: 3000 }, async (t) => {
  const f = await fixture(t, 'member');
  await splitMemberBuckets(f);
  const first = await f.begin({ creditCost: 40 });
  const token = await f.call('ProviderRunning', first.attempt.id);
  await f.call('Finalizing', first.attempt.id, { dispatchToken: token });
  const originalBatch = f.DB.batch.bind(f.DB);
  f.DB.batch = async (statements) => {
    await f.DB.prepare("DELETE FROM member_credit_buckets WHERE user_id = ? AND bucket_type = 'legacy_or_bonus'").bind(USER).run();
    f.DB.batch = originalBatch;
    return originalBatch(statements);
  };
  await assert.rejects(f.charge({ credits: 40 }), (error) => error.code === 'insufficient_member_credits');
  assert.equal((await f.ledgerRows()).filter((row) => row.amount < 0).length, 0);
  assert.equal((await f.usageRows()).length, 0);
  const events = await f.DB.prepare('SELECT COUNT(*) AS count FROM member_credit_bucket_events WHERE user_id = ? AND amount < 0').bind(USER).first();
  assert.equal(events.count, 0);
  const balance = await f.DB.prepare('SELECT balance_after FROM member_credit_ledger WHERE user_id = ? ORDER BY created_at DESC,rowid DESC LIMIT 1').bind(USER).first();
  assert.equal(balance.balance_after, 100);
  assert.equal(f.providerCalls(), 0);
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function timeoutHelper(worker) {
  return import(pathToFileURL(path.join(repo, `workers/${worker}/src/lib/generation-timeout.js`)).href);
}

for (const worker of ['auth', 'ai']) {
  for (const lateOutcome of ['succeeded', 'failed']) {
    test(`${worker} helper: late provider ${lateOutcome} after timeout retains unknown and never re-dispatches`, { timeout: 3000 }, async (t) => {
      const f = await fixture(t, 'member');
      const helper = await timeoutHelper(worker);
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const initial = await f.begin();
      const id = initial.attempt.id;
      const token = await f.call('ProviderRunning', id);
      const originalExpiry = (await f.row(id)).expires_at;
      const provider = deferred();
      const started = deferred();
      const evidenceDone = deferred();
      let calls = 0;
      let providerSignal;
      const recordLate = async (outcome) => {
        try {
          await f.call('Unknown', id, { dispatchToken: token, code: 'generation_timeout' });
          await f.call('LateOutcome', id, { dispatchToken: token, outcome, code: 'local_delayed_provider' });
        } finally { evidenceDone.resolve(); }
      };
      const pending = helper.runWithGenerationTimeout((signal) => {
        calls += 1;
        providerSignal = signal;
        started.resolve();
        return provider.promise; // Deliberately ignores abort, like uncertain remote work.
      }, { timeoutMs: 10, onLateResult: () => recordLate('succeeded'), onLateError: () => recordLate('failed') });
      const outcome = pending.catch(async (error) => {
        await f.call('Unknown', id, { dispatchToken: token, code: error.code });
        return error;
      });
      await started.promise;
      f.advance(10);
      t.mock.timers.tick(10);
      const error = await outcome;
      assert.equal(error.code, 'generation_timeout');
      assert.equal(error.status, 504);
      assert.equal(providerSignal.aborted, true);
      assert.equal((await f.begin()).kind, 'unresolved');
      if (lateOutcome === 'succeeded') provider.resolve({ fixture: 'late output' });
      else provider.reject(new Error('Local delayed rejection.'));
      await evidenceDone.promise;
      const row = await f.row(id);
      assert.equal(calls, 1);
      assert.equal(row.provider_outcome, 'unknown');
      assert.equal(row.billing_status, 'reserved');
      assert.equal(row.expires_at, originalExpiry);
      assert.equal(row.late_outcome, lateOutcome);
      assert.equal((await f.usageRows()).length, 0);
      assert.equal((await f.ledgerRows()).filter((r) => r.amount < 0).length, 0);
      assert.equal(await f.balance(), 100);
    });
  }

  test(`${worker} helper: caller abort stays distinct from deadline while a late provider result remains unresolved`, { timeout: 3000 }, async (t) => {
    const f = await fixture(t, 'member');
    const helper = await timeoutHelper(worker);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const initial = await f.begin();
    const id = initial.attempt.id;
    const token = await f.call('ProviderRunning', id);
    const caller = new AbortController();
    const reason = new DOMException('Local caller canceled.', 'AbortError');
    const provider = deferred();
    const started = deferred();
    const evidenceDone = deferred();
    let calls = 0;
    let providerSignal;
    const pending = helper.runWithGenerationTimeout((signal) => {
      calls += 1;
      providerSignal = signal;
      started.resolve();
      return provider.promise;
    }, { signal: caller.signal, timeoutMs: 10, onLateResult: async () => {
      try {
        await f.call('Unknown', id, { dispatchToken: token, code: 'caller_cancelled' });
        await f.call('LateOutcome', id, { dispatchToken: token, outcome: 'succeeded' });
      } finally { evidenceDone.resolve(); }
    } });
    const outcome = pending.catch(async (error) => {
      await f.call('Unknown', id, { dispatchToken: token, code: 'caller_cancelled' });
      return error;
    });
    await started.promise;
    caller.abort(reason);
    assert.equal(await outcome, reason);
    assert.equal(helper.isGenerationTimeoutError(reason), false);
    assert.equal(providerSignal.aborted, true);
    assert.equal(providerSignal.reason, reason);
    assert.equal((await f.begin()).kind, 'unresolved');
    provider.resolve({ fixture: 'success after caller left' });
    await evidenceDone.promise;
    t.mock.timers.tick(100);
    assert.equal(calls, 1);
    assert.equal((await f.row(id)).provider_outcome, 'unknown');
    assert.equal((await f.row(id)).late_outcome, 'succeeded');
    assert.equal((await f.row(id)).billing_status, 'reserved');
    assert.equal((await f.usageRows()).length, 0);
    assert.equal(await f.balance(), 100);
  });

  test(`${worker} helper: normal helper success finalizes one debit and never invokes a late hook`, { timeout: 3000 }, async (t) => {
    const f = await fixture(t, 'member');
    const helper = await timeoutHelper(worker);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const initial = await f.begin();
    const id = initial.attempt.id;
    const token = await f.call('ProviderRunning', id);
    let calls = 0;
    let lateCalls = 0;
    const expected = { fixture: 'normal output' };
    const result = await helper.runWithGenerationTimeout(async () => { calls += 1; return expected; }, {
      timeoutMs: 10, onLateResult: () => { lateCalls += 1; }, onLateError: () => { lateCalls += 1; },
    });
    assert.equal(result, expected);
    await f.call('Finalizing', id, { dispatchToken: token });
    await f.charge();
    await f.call('Succeeded', id, { dispatchToken: token, resultStatus: 'unavailable', balanceAfter: 90 });
    t.mock.timers.tick(100);
    assert.equal(calls, 1);
    assert.equal(lateCalls, 0);
    assert.equal((await f.begin()).kind, 'completed');
    assert.equal((await f.ledgerRows()).filter((r) => r.amount < 0).length, 1);
    assert.equal((await f.usageRows()).length, 1);
    assert.equal(await f.balance(), 90);
  });
}

test('Auth finite download: stalled finite body retains its deadline, cancels the reader and releases its lock', { timeout: 3000 }, async (t) => {
  const helper = await timeoutHelper('auth');
  const { fetchRemoteAsset } = await load('ai-video-jobs.js');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let cancellations = 0;
  let calls = 0;
  let fetchSignal;
  const body = new ReadableStream({ cancel() { cancellations += 1; } });
  const response = new Response(body, { headers: { 'content-type': 'video/mp4' } });
  const outcome = fetchRemoteAsset({ __TEST_FETCH: async (_url, init) => {
    calls += 1;
    fetchSignal = init.signal;
    return response;
  } }, 'https://fixture.invalid/video.mp4', { maxBytes: 1024, allowedContentTypes: new Set(['video/mp4']), label: 'video_output' }).catch((e) => e);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(body.locked, true, 'The actual finite asset reader must be active before timeout.');
  t.mock.timers.tick(helper.BITBI_GENERATION_TIMEOUT_MS);
  const error = await outcome;
  assert.equal(error.code, 'generation_timeout');
  assert.equal(error.status, 504);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetchSignal.aborted, true);
  assert.equal(calls, 1);
  assert.equal(cancellations, 1);
  assert.equal(body.locked, false);
});

}
module.exports = { register };
