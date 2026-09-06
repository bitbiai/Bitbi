/* Actual unchanged c173 JS route + local SQLite; no remote resources. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { webcrypto, createHash } = require('node:crypto');
const os = require('node:os');
const { gunzipSync } = require('node:zlib');
const REPO = path.resolve(__dirname, '../..');
const FIXTURES = path.join(REPO, 'tests/release-transition/fixtures');
const MIGRATION = fs.readFileSync(path.join(REPO, 'workers/auth/migrations/0081_add_ai_dispatch_outcome_guards.sql'), 'utf8');
const { SqliteD1Database, applyAuthMigrations } = require(path.join(REPO, 'tests/helpers/sqlite-d1.js'));
const { createAuthTestEnv } = require(path.join(REPO, 'tests/helpers/auth-worker-harness.js'));
const imported = (base, relative, suffix = '') => import(pathToFileURL(path.join(base, relative)).href + suffix);
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jc1kAAAAASUVORK5CYII=';
const USER = 'release-legacy-route-user';
const defer = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

function extractLegacySource(t) {
  const manifest = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'c173-auth-image-route.manifest.json'), 'utf8'));
  const compressed = fs.readFileSync(path.join(FIXTURES, manifest.archive));
  const sha256 = (data) => createHash('sha256').update(data).digest('hex');
  assert.equal(sha256(compressed), manifest.archive_sha256, 'Frozen source archive must match its reviewed manifest.');
  const archive = JSON.parse(gunzipSync(compressed, { maxOutputLength: 1_000_000 }).toString('utf8'));
  assert.equal(archive.revision, manifest.revision);
  assert.deepEqual(Object.keys(archive.files).sort(), Object.keys(manifest.files).sort());
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bitbi-legacy-transition-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  // Match the Auth Worker's ES-module package boundary in this isolated tree.
  fs.writeFileSync(path.join(temporary, 'package.json'), '{"type":"module"}\n');
  for (const [relative, source] of Object.entries(archive.files)) {
    const target = path.resolve(temporary, relative);
    assert.ok(target.startsWith(temporary + path.sep), 'Archive paths must stay within the disposable fixture.');
    assert.equal(typeof source, 'string');
    const bytes = Buffer.from(source, 'utf8');
    assert.equal(bytes.length, manifest.files[relative].bytes);
    assert.equal(sha256(bytes), manifest.files[relative].sha256, `Preserve unchanged legacy source: ${relative}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
  return temporary;
}

async function setup(t, scenario) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('External fetch forbidden in local legacy transition fixture.'); };
  t.after(() => { globalThis.fetch = previousFetch; });
  const LEGACY = extractLegacySource(t);
  const DB = new SqliteD1Database();
  t.after(() => DB.close());
  applyAuthMigrations(DB, { migrationsDirectory: path.join(REPO, 'workers/auth/migrations'), through: '0080_add_provider_neutral_chat_and_grok_4_6.sql' });
  const now = new Date().toISOString();
  await DB.prepare(`INSERT INTO users (id,email,password_hash,created_at,status,role,updated_at,email_verified_at,verification_method)
    VALUES (?,?,?,?,?,?,?,?,?)`).bind(USER, 'legacy-route@example.invalid', 'local-fixture-only', now, 'active', 'user', now, now, 'email_verified').run();
  const paused = defer();
  const resume = defer();
  let providerCalls = 0;
  const env = createAuthTestEnv({ aiRun: async () => {
    providerCalls += 1;
    if (scenario.boundary === 'after-dispatch') { paused.resolve(); await resume.promise; }
    if (scenario.providerResult === 'failure') throw new Error('Local provider failed after migration.');
    return { image: PNG };
  } });
  env.DB = DB;
  const billing = await imported(LEGACY, 'workers/auth/src/lib/billing.js');
  await billing.grantMemberCredits({ env, userId: USER, amount: 100, createdByUserId: null,
    idempotencyKey: 'legacy-local-fixture-grant', source: 'local_fixture' });
  const token = 'synthetic-local-session';
  const session = await imported(LEGACY, 'workers/auth/src/lib/session.js');
  const hash = await session.hashSessionToken(env, token);
  await DB.prepare(`INSERT INTO sessions (id,user_id,token_hash,created_at,expires_at,last_seen_at)
    VALUES (?,?,?,?,?,?)`).bind('legacy-local-session-id', USER, hash, now,
      new Date(Date.now() + 3_600_000).toISOString(), now).run();
  const originalPrepare = DB.prepare.bind(DB);
  let capturedAttemptId;
  let pauseCount = 0;
  function wrap(statement, sql) {
    return {
      bind(...values) {
        const bound = wrap(statement.bind(...values), sql);
        bound.values = values;
        return bound;
      },
      first: (...args) => statement.first(...args),
      all: (...args) => statement.all(...args),
      async run(...args) {
        const marker = /UPDATE member_ai_usage_attempts\s+SET status = 'provider_running'/.test(sql);
        const insert = /INSERT INTO member_ai_usage_attempts\s*\(/.test(sql);
        const shouldPause = pauseCount === 0 && (
          (marker && ['before-marker', 'after-marker'].includes(scenario.boundary)) ||
          (insert && scenario.boundary === 'before-insert')
        );
        if (!shouldPause) return statement.run(...args);
        pauseCount += 1;
        capturedAttemptId = marker ? this.values[1] : this.values[0];
        if (scenario.boundary === 'after-marker') {
          const result = await statement.run(...args);
          paused.resolve();
          await resume.promise;
          return result;
        }
        paused.resolve();
        await resume.promise;
        return statement.run(...args);
      },
    };
  }
  DB.prepare = (sql) => wrap(originalPrepare(sql), sql);
  const route = await imported(LEGACY, 'workers/auth/src/routes/ai/images-write.js');
  const request = (key = 'same-legacy-logical-operation') => new Request('https://bitbi.ai/api/ai/generate-image', {
    method: 'POST', headers: { Cookie: `bitbi_session=${token}`, Origin: 'https://bitbi.ai',
      'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({ prompt: 'Synthetic local transition fixture', steps: 4 }),
  });
  const accounting = async () => Promise.all(['member_credit_ledger', 'member_credit_buckets', 'member_credit_bucket_events', 'member_usage_events']
    .map(async (table) => ({ table, rows: (await originalPrepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results })));
  const oldRequest = route.handleGenerateImage({ request: request(), env, correlationId: 'local-transition-fixture' });
  t.after(async () => { resume.resolve(); await oldRequest.catch(() => {}); });
  const waitPaused = async () => {
    const early = await Promise.race([paused.promise.then(() => ({ paused: true })), oldRequest.then(async (response) => ({ early: response.status, body: await response.text() }))]);
    assert.equal(early.paused, true, `Legacy route ended before the controlled boundary: ${JSON.stringify(early)}`);
  };
  return { DB, env, paused, resume, oldRequest, waitPaused, accounting, originalPrepare, request,
    providerCalls: () => providerCalls, capturedAttemptId: () => capturedAttemptId };
}

const scenarios = [
  { label: 'accepted old route paused before first attempt INSERT cannot create a post-migration operation', boundary: 'before-insert', expectedProviderCalls: 0 },
  { label: 'old route paused before its provider-running marker fails before dispatch', boundary: 'before-marker', expectedProviderCalls: 0 },
  { label: 'zero-row legacy marker must reject instead of silently continuing to the provider', boundary: 'before-marker', zeroRow: true, expectedProviderCalls: 0 },
  { label: 'already completed old marker may continue once; its migrated receipt blocks new work and settlement', boundary: 'after-marker', expectedProviderCalls: 1 },
  { label: 'old provider success arriving after migration cannot debit or overwrite its unresolved reservation', boundary: 'after-dispatch', providerResult: 'success', expectedProviderCalls: 1 },
  { label: 'old provider failure arriving after migration cannot release an unresolved reservation early', boundary: 'after-dispatch', providerResult: 'failure', expectedProviderCalls: 1 },
];

function register(test) {
for (const scenario of scenarios) {
  test('Release transition: ' + scenario.label, { timeout: 4000 }, async (t) => {
    const f = await setup(t, scenario);
    await f.waitPaused();
    const before = (await f.originalPrepare('SELECT * FROM member_ai_usage_attempts').all()).results;
    if (scenario.zeroRow) {
      // A competing old marker has already advanced this identity; the paused
      // unchanged helper's WHERE status='reserved' will match zero rows.
      await f.originalPrepare("UPDATE member_ai_usage_attempts SET status='provider_running', provider_status='running' WHERE id=?")
        .bind(before[0].id).run();
    }
    const accountingBefore = await f.accounting();
    f.DB.exec(MIGRATION);
    const migrated = (await f.originalPrepare('SELECT * FROM member_ai_usage_attempts').all()).results;
    const accountingAfterMigration = await f.accounting();
    const expectedAccounting = accountingBefore.map(({ table, rows }) => ({ table,
      rows: table === 'member_credit_ledger'
        ? rows.map((row) => Object.assign(Object.create(null), row, { ai_dispatch_token: null }))
        : rows,
    }));
    assert.deepEqual(accountingAfterMigration, expectedAccounting,
      'Migration preserves all old accounting values and adds only a null dispatch-token column to legacy ledger rows.');
    f.resume.resolve();
    const response = await f.oldRequest;
    // The controlled legacy request has completed. Current candidate batches
    // must use real native statements, not the legacy run-only pause wrapper.
    f.DB.prepare = f.originalPrepare;
    assert.equal(f.providerCalls(), scenario.expectedProviderCalls,
      'Provider invocation count must reflect the actual unchanged legacy route continuation.');
    assert.ok(response.status >= 500, 'A legacy writer must fail closed through its actual route error handling.');
    const after = (await f.originalPrepare('SELECT * FROM member_ai_usage_attempts').all()).results;
    assert.equal(after.length, migrated.length);
    if (before.length) {
      assert.equal(migrated[0].provider_outcome, 'unknown', 'Every prior potentially accepted identity is conservatively fenced.');
      assert.deepEqual(after, migrated, 'An old finalization/failure handler may not mutate migrated attempt state or its reservation.');
      assert.equal(after[0].billing_status, 'reserved');
      assert.equal(after[0].expires_at, before[0].expires_at);
      const current = await imported(REPO, 'workers/auth/src/lib/member-ai-usage-attempts.js');
      const duplicate = await current.beginMemberAiUsageAttempt({ env: f.env, userId: USER,
        featureKey: before[0].feature_key, operationKey: before[0].operation_key, route: before[0].route,
        idempotencyKey: before[0].idempotency_key, requestFingerprint: before[0].request_fingerprint,
        creditCost: before[0].credit_cost, quantity: before[0].quantity,
      });
      assert.equal(duplicate.kind, 'unresolved');
      assert.equal(duplicate.attempt.id, before[0].id);
      await assert.rejects(current.markMemberAiUsageAttemptProviderRunning(f.env, before[0].id));
      assert.equal(f.providerCalls(), scenario.expectedProviderCalls, 'Candidate replay cannot add a replacement dispatch.');
    }
    assert.deepEqual(await f.accounting(), accountingAfterMigration, 'No debit, refund, grant, bucket event or usage can be fabricated by the stale continuation.');
    assert.equal(f.env.USER_IMAGES.objects.size, 0);
    if (scenario.boundary === 'after-marker') {
      const route = await imported(REPO, 'workers/auth/src/routes/ai/images-write.js');
      const replay = await route.handleGenerateImage({ request: f.request(), env: f.env, correlationId: 'local-candidate-replay' });
      assert.equal(replay.status, 409);
      assert.equal(f.providerCalls(), 1, 'A replacement request for the old operation cannot call another provider.');
      const fresh = await route.handleGenerateImage({ request: f.request('explicit-new-logical-operation'), env: f.env,
        correlationId: 'local-candidate-new-operation' });
      assert.equal(fresh.status, 200, 'Explicitly new work remains possible under the existing member policy.');
      assert.equal(f.providerCalls(), 2, 'Exactly one new mock invocation belongs to the explicitly new operation.');
      const debits = (await f.originalPrepare('SELECT * FROM member_credit_ledger WHERE amount < 0').all()).results;
      assert.equal(debits.length, 1);
      const freshAttempt = await f.originalPrepare("SELECT * FROM member_ai_usage_attempts WHERE id <> ? AND status = 'succeeded'")
        .bind(before[0].id).first();
      assert.ok(freshAttempt);
      assert.equal(freshAttempt.billing_status, 'finalized');
      assert.equal(debits[0].idempotency_key, freshAttempt.idempotency_key);
      assert.equal(debits[0].ai_dispatch_token, freshAttempt.dispatch_token);
      assert.equal((await f.originalPrepare('SELECT * FROM member_ai_usage_attempts WHERE id = ?').bind(before[0].id).first()).provider_outcome, 'unknown');
    }
  });
}

}
module.exports = { register };
