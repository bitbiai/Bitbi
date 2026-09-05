/* Real disposable SQLite; only local Admin/provider-budget fixtures. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { webcrypto } = require('node:crypto');
const repo = path.resolve(process.env.BITBI_REL01_TEST_REPO || process.cwd());
const { SqliteD1Database, applyAuthMigrations } = require(path.join(repo, 'tests/helpers/sqlite-d1.js'));
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const ADMIN = 'rel01-admin-fixture';
const SCOPE = 'platform_admin_lab_budget';
const START = Date.parse('2026-08-31T23:59:00.000Z');
const load = (name, suffix = '') => import(pathToFileURL(path.join(repo, 'workers/auth/src/lib', name)).href + suffix);

async function fixture(t, { limitUnits = 100, units = 6 } = {}) {
  const NativeDate = globalThis.Date;
  let current = START;
  globalThis.Date = class FixtureDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [current])); }
    static now() { return current; }
  };
  const DB = new SqliteD1Database();
  t.after(() => { DB.close(); globalThis.Date = NativeDate; });
  applyAuthMigrations(DB, { migrationsDirectory: path.join(repo, 'workers/auth/migrations') });
  const env = { DB };
  const now = () => new Date().toISOString();
  await DB.prepare(`INSERT INTO users (id,email,password_hash,created_at,status,role,updated_at,email_verified_at)
    VALUES (?,?,?,?,?,?,?,?)`).bind(ADMIN, 'rel01-admin@example.invalid', 'local-fixture-not-a-password', now(), 'active', 'admin', now(), now()).run();
  let admin = await load('admin-ai-idempotency.js');
  const budget = await load('platform-budget-caps.js');
  for (const windowType of ['daily', 'monthly']) {
    await budget.upsertPlatformBudgetLimit(env, { budgetScope: SCOPE, windowType, limitUnits,
      reason: 'Local regression fixture only', adminUser: { id: ADMIN, role: 'admin' }, idempotencyKey: `local-cap-${windowType}` });
  }
  const defaults = { env, operationKey: 'admin.text.test', route: '/api/admin/ai/test-text', adminUserId: ADMIN,
    idempotencyKey: 'rel01-admin-operation', requestFingerprint: 'rel01-admin-original-fingerprint', providerFamily: 'ai_worker',
    modelKey: 'fixture/model', budgetScope: SCOPE, budgetPolicy: { estimated_cost_units: units }, callerPolicy: {}, metadata: {} };
  const begin = (overrides = {}) => admin.beginAdminAiIdempotencyAttempt({ ...defaults, ...overrides });
  const row = (id) => DB.prepare('SELECT * FROM admin_ai_usage_attempts WHERE id = ?').bind(id).first();
  const rows = () => DB.prepare('SELECT * FROM admin_ai_usage_attempts ORDER BY id').all().then((r) => r.results);
  const events = () => DB.prepare('SELECT * FROM platform_budget_usage_events ORDER BY id').all().then((r) => r.results);
  const call = (suffix, id, options = {}) => admin[`markAdminAiIdempotency${suffix}`](env, id, options);
  const cleanup = (overrides = {}) => admin.cleanupExpiredAdminAiUsageAttempts({ env, now: now(), dryRun: false, ...overrides });
  const check = (overrides = {}) => budget.checkPlatformBudgetCap(env, { budgetScope: SCOPE, operationKey: defaults.operationKey, units: 1, now: now(), ...overrides });
  const summary = (overrides = {}) => budget.getPlatformBudgetUsageSummary(env, { budgetScope: SCOPE, now: now(), ...overrides });
  const record = (overrides = {}) => budget.recordPlatformBudgetUsageEvent(env, { budgetScope: SCOPE, operationKey: defaults.operationKey,
    sourceRoute: defaults.route, actorUserId: ADMIN, units, now: now(), ...overrides });
  let calls = 0;
  const dispatch = async (id) => { const claim = await call('ProviderRunning', id); calls += 1; return claim; };
  return { DB, env, admin: () => admin, budget, defaults, begin, row, rows, events, call, cleanup, check, summary, record, dispatch,
    providerCalls: () => calls, now, advance: (ms) => { current += ms; },
    restart: async () => { admin = await load('admin-ai-idempotency.js', `?rel01-admin-restart=${current}`); } };
}

const windowOf = (check, type) => check.windows.find((w) => w.windowType === type);

function register(test) {
  for (const scenario of [
    { label: 'historical existing-output recovery adds no provider exposure', operation: 'admin.video.job.recover', estimate: 6, exposure: 0 },
    { label: 'historical paid fractional estimate rounds exposure upward', operation: 'admin.text.test', estimate: 1.5, exposure: 2 },
  ]) {
    test(`Admin SQLite migration 0081: ${scenario.label}`, async (t) => {
      const DB = new SqliteD1Database();
      t.after(() => DB.close());
      const migrationsDirectory = path.join(repo, 'workers/auth/migrations');
      applyAuthMigrations(DB, { migrationsDirectory, through: '0080_add_provider_neutral_chat_and_grok_4_6.sql' });
      const timestamp = new Date(START).toISOString();
      await DB.prepare(`INSERT INTO users (id,email,password_hash,created_at,status,role,updated_at,email_verified_at)
        VALUES (?,?,?,?,?,?,?,?)`).bind(ADMIN, 'rel01-migration@example.invalid', 'local-fixture-not-a-password', timestamp, 'active', 'admin', timestamp, timestamp).run();
      await DB.prepare(`INSERT INTO admin_ai_usage_attempts
        (id,operation_key,route,admin_user_id,idempotency_key_hash,request_fingerprint,provider_family,
         budget_scope,budget_policy_json,status,provider_status,created_at,updated_at,expires_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind('historical-admin-fixture', scenario.operation,
        '/api/admin/ai/local-migration-fixture', ADMIN, 'fixture-key-hash', 'fixture-request-fingerprint',
        'ai_worker', SCOPE, JSON.stringify({ estimated_cost_units: scenario.estimate }),
        'provider_running', 'running', timestamp, timestamp, '2026-09-01T23:59:00.000Z').run();
      const original = await DB.prepare('SELECT * FROM admin_ai_usage_attempts WHERE id = ?').bind('historical-admin-fixture').first();
      const readAccounting = async () => Promise.all(['credit_ledger', 'member_credit_ledger', 'platform_budget_usage_events']
        .map((table) => DB.prepare(`SELECT * FROM ${table} ORDER BY id`).all().then((result) => result.results)));
      const accountingBefore = await readAccounting();
      DB.exec(require('node:fs').readFileSync(path.join(migrationsDirectory, '0081_add_ai_dispatch_outcome_guards.sql'), 'utf8'));
      const migrated = await DB.prepare('SELECT * FROM admin_ai_usage_attempts WHERE id = ?').bind(original.id).first();
      assert.deepEqual(await readAccounting(), accountingBefore, 'Migration must not fabricate credit or successful provider-usage entries.');
      for (const key of ['id', 'operation_key', 'admin_user_id', 'idempotency_key_hash', 'request_fingerprint', 'status', 'provider_status', 'budget_policy_json']) {
        assert.equal(migrated[key], original[key], `Preserve historical ${key}.`);
      }
      assert.equal(migrated.provider_outcome, 'unknown');
      assert.equal(migrated.dispatch_token, `legacy:${original.id}`);
      assert.equal(migrated.platform_window_day, '2026-08-31');
      assert.equal(migrated.platform_window_month, '2026-08');
      assert.equal(migrated.platform_exposure_units, scenario.exposure);
    });
  }

  test('Admin SQLite: concurrent distinct dispatches atomically share the same platform capacity', async (t) => {
    const f = await fixture(t, { limitUnits: 10, units: 6 });
    const [a, b] = await Promise.all([f.begin({ idempotencyKey: 'admin-cap-a' }), f.begin({ idempotencyKey: 'admin-cap-b' })]);
    const claims = await Promise.allSettled([f.dispatch(a.attempt.id), f.dispatch(b.attempt.id)]);
    assert.equal(claims.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(claims.filter((r) => r.status === 'rejected').length, 1);
    assert.equal(claims.find((r) => r.status === 'rejected').reason.code, 'admin_ai_dispatch_not_claimed');
    assert.equal(f.providerCalls(), 1);
    const rows = await f.rows();
    assert.equal(rows.filter((r) => r.provider_outcome === 'dispatched').length, 1);
    assert.equal(rows.filter((r) => r.provider_outcome === 'not_dispatched').length, 1);
    assert.equal(rows.reduce((n, r) => n + r.platform_exposure_units, 0), 6);
    assert.equal((await f.check({ units: 4 })).allowed, true);
    const cap = await f.summary();
    for (const window of cap.windows) {
      assert.equal(window.usedUnits, 6);
      assert.equal(window.recordedUsageUnits, 0);
      assert.equal(window.unresolvedExposureUnits, 6);
    }
    await assert.rejects(f.check({ units: 5 }), (e) => e.code === 'platform_budget_cap_exceeded');
    assert.equal((await f.events()).length, 0);
  });

  test('Admin SQLite: one key stays unknown across duplicate requests, metadata erasure, restart and 24-hour expiry', async (t) => {
    const f = await fixture(t);
    const [a, b] = await Promise.all([f.begin(), f.begin()]);
    assert.equal(a.attempt.id, b.attempt.id);
    assert.equal([a, b].filter((r) => r.kind === 'created').length, 1);
    await assert.rejects(f.begin({ requestFingerprint: 'different-admin-payload' }), (e) => e.code === 'idempotency_conflict');
    const id = a.attempt.id;
    const claim = await f.dispatch(id);
    assert.equal(typeof claim.dispatchToken, 'string');
    const expiry = (await f.row(id)).expires_at;
    await f.call('ProviderFailed', id, { dispatchToken: claim.dispatchToken, code: 'generation_timeout' });
    assert.equal((await f.row(id)).provider_outcome, 'unknown');
    assert.equal((await f.begin()).kind, 'unresolved');
    await f.DB.prepare("UPDATE admin_ai_usage_attempts SET metadata_json = '{}', budget_policy_json = '{}' WHERE id = ?").bind(id).run();
    await f.restart();
    f.advance(24 * 60 * 60_000 + 1);
    await f.cleanup();
    await f.cleanup();
    const duplicate = await f.begin();
    assert.equal(duplicate.kind, 'unresolved');
    assert.equal(duplicate.attempt.id, id);
    assert.equal((await f.row(id)).provider_outcome, 'unknown');
    assert.equal((await f.row(id)).expires_at, expiry);
    await assert.rejects(f.dispatch(id));
    assert.equal(f.providerCalls(), 1);
    assert.equal((await f.rows()).length, 1);
    assert.equal((await f.events()).length, 0);
    assert.equal(windowOf(await f.check({ now: new Date(START).toISOString() }), 'monthly').usedUnits, 6);
  });

  test('Admin SQLite: one-row cleanup advances past an unknown dispatch to a later pending expiry', async (t) => {
    const f = await fixture(t);
    const first = await f.begin();
    await f.dispatch(first.attempt.id);
    f.advance(1);
    const pending = await f.begin({ idempotencyKey: 'rel01-admin-later-pending' });
    f.advance(24 * 60 * 60_000);
    await f.cleanup({ limit: 1 });
    const unknown = await f.row(first.attempt.id);
    assert.equal(unknown.provider_outcome, 'unknown');
    assert.equal((await f.row(pending.attempt.id)).status, 'pending');
    await f.cleanup({ limit: 1 });
    assert.equal((await f.row(pending.attempt.id)).status, 'expired', 'A durable unknown receipt must not monopolize the next cleanup batch.');
    assert.equal((await f.row(pending.attempt.id)).provider_outcome, 'not_dispatched');
    assert.equal((await f.cleanup({ limit: 1 })).scannedCount, 0);
    assert.equal((await f.row(first.attempt.id)).unknown_at, unknown.unknown_at);
    assert.equal((await f.begin()).kind, 'unresolved');
    assert.equal((await f.events()).length, 0);
    assert.equal(f.providerCalls(), 1);
    assert.equal(windowOf(await f.summary({ now: new Date(START).toISOString() }), 'monthly').unresolvedExposureUnits, 6);
  });

  test('Admin SQLite: an expired pending claim cannot start provider work before or after cleanup', async (t) => {
    const f = await fixture(t);
    const first = await f.begin();
    f.advance(24 * 60 * 60_000);
    await assert.rejects(f.dispatch(first.attempt.id), (e) => e.code === 'admin_ai_dispatch_not_claimed');
    await f.cleanup();
    assert.equal((await f.begin()).kind, 'expired');
    await assert.rejects(f.dispatch(first.attempt.id));
    assert.equal(f.providerCalls(), 0);
    assert.equal((await f.row(first.attempt.id)).provider_outcome, 'not_dispatched');
    assert.equal((await f.events()).length, 0);
  });

  test('Admin SQLite: wrong or missing token cannot finalize or borrow the stored claimant token', async (t) => {
    const f = await fixture(t);
    const first = await f.begin();
    const id = first.attempt.id;
    const claim = await f.dispatch(id);
    for (const options of [{ dispatchToken: `${claim.dispatchToken}-wrong` }, {}]) {
      await assert.rejects(f.call('Succeeded', id, options), (e) => e.code === 'admin_ai_outcome_unknown');
      assert.equal((await f.row(id)).provider_outcome, 'dispatched');
      assert.equal((await f.row(id)).late_outcome, null);
    }
    await f.call('ProviderFailed', id, { dispatchToken: `${claim.dispatchToken}-wrong`, confirmedFailure: true });
    assert.equal((await f.row(id)).provider_outcome, 'dispatched');
    await f.call('Succeeded', id, { dispatchToken: claim.dispatchToken, resultMetadata: { result_kind: 'text', text_length: 4 } });
    assert.equal((await f.begin()).kind, 'completed');
    assert.equal((await f.row(id)).provider_outcome, 'succeeded');
    await assert.rejects(f.dispatch(id));
    assert.equal(f.providerCalls(), 1);
    assert.equal((await f.events()).length, 0, 'Attempt completion alone must not invent a successful usage event.');
  });

  test('Admin SQLite: unknown late finalization records only first fenced evidence and no successful usage', async (t) => {
    const f = await fixture(t);
    const first = await f.begin();
    const id = first.attempt.id;
    const claim = await f.dispatch(id);
    await f.call('ProviderFailed', id, { dispatchToken: claim.dispatchToken, code: 'network_response_lost' });
    f.advance(24 * 60 * 60_000 + 1);
    await f.cleanup();
    await assert.rejects(f.call('Succeeded', id, { dispatchToken: `${claim.dispatchToken}-wrong` }), (e) => e.code === 'admin_ai_outcome_unknown');
    assert.equal((await f.row(id)).late_outcome, null);
    await assert.rejects(f.call('Succeeded', id, { dispatchToken: claim.dispatchToken }), (e) => e.code === 'admin_ai_outcome_unknown');
    const evidence = await f.row(id);
    assert.equal(evidence.provider_outcome, 'unknown');
    assert.equal(evidence.late_outcome, 'succeeded');
    assert.ok(evidence.late_evidence_json.length < 1024);
    await f.call('ProviderFailed', id, { dispatchToken: claim.dispatchToken, confirmedFailure: true, code: 'contradictory-late-error' });
    assert.equal((await f.row(id)).late_outcome, 'succeeded');
    assert.equal((await f.row(id)).late_evidence_json, evidence.late_evidence_json);
    assert.equal((await f.begin()).kind, 'unresolved');
    assert.equal((await f.events()).length, 0);
    assert.equal(f.providerCalls(), 1);
  });

  test('Platform SQLite: original dispatch period survives rollover and source-backed usage replaces exposure once', async (t) => {
    const f = await fixture(t);
    const first = await f.begin();
    const id = first.attempt.id;
    const claim = await f.dispatch(id);
    await f.call('ProviderFailed', id, { dispatchToken: claim.dispatchToken, code: 'generation_timeout' });
    f.advance(2 * 60_000);
    const historicalNow = new Date(START).toISOString();
    const historical = await f.summary({ now: historicalNow });
    const current = await f.summary();
    for (const type of ['daily', 'monthly']) {
      assert.equal(windowOf(historical, type).usedUnits, 6);
      assert.equal(windowOf(historical, type).recordedUsageUnits, 0);
      assert.equal(windowOf(historical, type).unresolvedExposureUnits, 6);
      assert.equal(windowOf(current, type).usedUnits, 0);
    }
    assert.equal((await f.row(id)).platform_window_day, '2026-08-31');
    assert.equal((await f.row(id)).platform_window_month, '2026-08');
    const record = await f.record({ sourceAttemptId: id });
    assert.equal(record.recorded, true);
    assert.equal(record.windowDay, '2026-08-31');
    assert.equal(record.windowMonth, '2026-08');
    assert.equal((await f.record({ sourceAttemptId: id })).recorded, false);
    const after = await f.summary({ now: historicalNow });
    for (const type of ['daily', 'monthly']) {
      assert.equal(windowOf(after, type).usedUnits, 6, 'Recorded usage and its matching exposure must not be added twice.');
      assert.equal(windowOf(after, type).recordedUsageUnits, 6);
      assert.equal(windowOf(after, type).unresolvedExposureUnits, 0);
      assert.equal(windowOf(await f.check(), type).usedUnits, 0);
    }
    assert.equal((await f.events()).length, 1);
    assert.equal((await f.row(id)).provider_outcome, 'unknown', 'Usage evidence alone must not rewrite provider reconciliation state.');
  });

  test('Platform SQLite: recording one attempt does not remove another unresolved exposure', async (t) => {
    const f = await fixture(t, { units: 3 });
    const [a, b] = await Promise.all([f.begin({ idempotencyKey: 'exposure-a' }), f.begin({ idempotencyKey: 'exposure-b' })]);
    const claimA = await f.dispatch(a.attempt.id);
    const claimB = await f.dispatch(b.attempt.id);
    await f.call('ProviderFailed', a.attempt.id, { dispatchToken: claimA.dispatchToken, code: 'transport_lost' });
    await f.call('ProviderFailed', b.attempt.id, { dispatchToken: claimB.dispatchToken, code: 'transport_lost' });
    await f.record({ sourceAttemptId: a.attempt.id });
    for (const window of (await f.summary()).windows) {
      assert.equal(window.usedUnits, 6);
      assert.equal(window.recordedUsageUnits, 3);
      assert.equal(window.unresolvedExposureUnits, 3);
    }
    assert.equal((await f.events()).length, 1);
    assert.equal(f.providerCalls(), 2);
  });

  test('Admin SQLite: confirmed Completed output rejection retains exposure without inventing successful usage', async (t) => {
    const f = await fixture(t, { units: 6 });
    const first = await f.begin();
    const id = first.attempt.id;
    const claim = await f.dispatch(id);
    await f.call('ProviderFailed', id, { dispatchToken: claim.dispatchToken, providerOutcome: 'succeeded',
      code: 'provider_output_validation_failed' });
    const receipt = await f.row(id);
    assert.equal(receipt.status, 'provider_failed');
    assert.equal(receipt.provider_status, 'succeeded');
    assert.equal(receipt.provider_outcome, 'succeeded');
    assert.equal(receipt.error_code, 'provider_output_validation_failed');
    assert.equal(receipt.result_status, 'none');
    const usage = windowOf(await f.summary(), 'daily');
    assert.equal(usage.usedUnits, 6);
    assert.equal(usage.recordedUsageUnits, 0);
    assert.equal(usage.unresolvedExposureUnits, 6);
    assert.equal((await f.events()).length, 0);
    assert.equal((await f.begin()).kind, 'terminal_failure');
    await assert.rejects(f.dispatch(id), (e) => e.code === 'admin_ai_dispatch_not_claimed');
    assert.equal(f.providerCalls(), 1);
    assert.equal((await f.rows()).length, 1);
  });

  test('Admin SQLite: confirmed failure releases exposure without inventing success or reusing the operation', async (t) => {
    const f = await fixture(t);
    const first = await f.begin();
    const claim = await f.dispatch(first.attempt.id);
    await f.call('ProviderFailed', first.attempt.id, { dispatchToken: claim.dispatchToken, confirmedFailure: true, code: 'confirmed_failure' });
    assert.equal((await f.row(first.attempt.id)).provider_outcome, 'failed');
    assert.equal((await f.begin()).kind, 'terminal_failure');
    for (const window of (await f.check()).windows) assert.equal(window.usedUnits, 0);
    const next = await f.begin({ idempotencyKey: 'explicit-new-admin-operation' });
    await f.dispatch(next.attempt.id);
    assert.equal(f.providerCalls(), 2);
    assert.equal((await f.events()).length, 0);
  });

  test('Platform SQLite: partial recorded usage retains unknown remainder while confirmed success replaces its estimate', async (t) => {
    const f = await fixture(t, { units: 6 });
    const unknown = await f.begin({ idempotencyKey: 'partial-unknown' });
    const unknownClaim = await f.dispatch(unknown.attempt.id);
    await f.call('ProviderFailed', unknown.attempt.id, { dispatchToken: unknownClaim.dispatchToken, code: 'partial-response-lost' });
    await f.record({ sourceAttemptId: unknown.attempt.id, units: 2 });
    for (const window of (await f.summary()).windows) {
      assert.equal(window.usedUnits, 6);
      assert.equal(window.recordedUsageUnits, 2);
      assert.equal(window.unresolvedExposureUnits, 4);
    }
    const succeeded = await f.begin({ idempotencyKey: 'partial-confirmed-success' });
    const successClaim = await f.dispatch(succeeded.attempt.id);
    await f.call('Succeeded', succeeded.attempt.id, { dispatchToken: successClaim.dispatchToken });
    await f.record({ sourceAttemptId: succeeded.attempt.id, units: 2 });
    for (const window of (await f.summary()).windows) {
      assert.equal(window.usedUnits, 8);
      assert.equal(window.recordedUsageUnits, 4);
      assert.equal(window.unresolvedExposureUnits, 4);
    }
    assert.equal((await f.row(unknown.attempt.id)).provider_outcome, 'unknown');
    assert.equal((await f.row(succeeded.attempt.id)).provider_outcome, 'succeeded');
    assert.equal((await f.events()).length, 2);
    assert.equal(f.providerCalls(), 2);
  });

  test('Admin SQLite: existing-output recovery claims zero provider exposure and needs no provider cap', async (t) => {
    const f = await fixture(t);
    f.DB.exec('DELETE FROM platform_budget_limits');
    const recovery = await f.begin({ operationKey: 'admin.video.job.recover', route: '/api/admin/ai/video-jobs/fixture/recover' });
    const claim = await f.call('ProviderRunning', recovery.attempt.id);
    assert.equal(typeof claim.dispatchToken, 'string');
    assert.equal((await f.row(recovery.attempt.id)).platform_exposure_units, 0);
    assert.equal((await f.events()).length, 0);
    assert.equal(f.providerCalls(), 0, 'This fixture exercises recovery bookkeeping without calling any provider.');
  });
}

module.exports = { register };
