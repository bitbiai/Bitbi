// Standalone local workerd/D1 integration check. No Wrangler config is loaded.
// Run with Node 22 and --tooling-root pointing to an installed Auth package root.
// It creates only an ephemeral local D1 binding; providers and outbound requests
// are unavailable. The SQL splitter is the installed Wrangler migration splitter.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const option = process.argv.indexOf('--tooling-root');
const toolingRoot = option < 0 ? resolve(root, 'workers/auth') : resolve(process.argv[option + 1]);
const requireTool = createRequire(resolve(toolingRoot, 'package.json'));
const { Miniflare } = requireTool('miniflare');
const { unstable_splitSqlQuery: splitSql } = requireTool('wrangler');
assert.equal(typeof splitSql, 'function');
assert.equal(process.versions.node.split('.')[0], '22', 'Use the declared Node 22 toolchain.');

const migrationName = '0081_add_ai_dispatch_outcome_guards.sql';
const migrations = resolve(root, 'workers/auth/migrations');
const migrationSql = readFileSync(resolve(migrations, migrationName), 'utf8');
const now = new Date().toISOString();
const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
const user = 'd1-cutover-fixture-member';
const org = 'd1-cutover-fixture-org';
const tables = ['member_ai_usage_attempts', 'ai_usage_attempts', 'admin_ai_usage_attempts', 'ai_video_jobs'];
let outboundAttempts = 0;
const results = [];
const mf = new Miniflare({
  modules: true,
  compatibilityDate: '2026-07-10',
  script: 'export default { fetch() { return new Response("local D1 fixture only"); } };',
  d1Databases: ['DB'],
  d1Persist: false,
  outboundService: () => {
    outboundAttempts += 1;
    throw new Error('Outbound requests are forbidden in this local fixture.');
  },
});

async function check(name, fn) {
  await fn();
  results.push({ name, status: 'passed' });
  console.log(`PASS ${name}`);
}

try {
  const db = await mf.getD1Database('DB');
  const run = (sql, values = []) => db.prepare(sql).bind(...values).run();
  const first = (sql, values = []) => db.prepare(sql).bind(...values).first();
  const batchSql = (sql) => db.batch(splitSql(sql).map((statement) => db.prepare(statement)));
  const insertMember = async (table, id, status = 'reserved', provider = 'not_started') => run(
    `INSERT INTO ${table} (id,user_id,feature_key,operation_key,route,idempotency_key,
      request_fingerprint,credit_cost,quantity,status,provider_status,billing_status,
      created_at,updated_at,expires_at)
     VALUES (?,?,'ai.image.generate','member.image.generate','/api/ai/generate-image',
      ?,?,10,1,?,?,'reserved',?,?,?)`,
    [id, user, `${id}-key`, `${id}-fingerprint`, status, provider, now, now, expires],
  );
  const insertOrg = async (table, id, status = 'reserved', provider = 'not_started') => run(
    `INSERT INTO ${table} (id,organization_id,user_id,feature_key,operation_key,route,
      idempotency_key,request_fingerprint,credit_cost,quantity,status,provider_status,
      billing_status,created_at,updated_at,expires_at)
     VALUES (?,?,?,'ai.image.generate','organization.image.generate','/api/ai/generate-image',
      ?,?,10,1,?,?,'reserved',?,?,?)`,
    [id, org, user, `${id}-key`, `${id}-fingerprint`, status, provider, now, now, expires],
  );
  const ledgerStatement = ({ id, attempt, token, organization = false }) => {
    const table = organization ? 'credit_ledger' : 'member_credit_ledger';
    const ownerColumn = organization ? 'organization_id' : 'user_id';
    // Omitting ai_dispatch_token is the unchanged legacy INSERT shape.
    const tokenColumn = token === undefined ? '' : ',ai_dispatch_token';
    const tokenValue = token === undefined ? '' : ',?';
    return db.prepare(`INSERT INTO ${table}
      (id,${ownerColumn},amount,balance_after,entry_type,feature_key,source,
       idempotency_key,created_at${tokenColumn})
      VALUES (?,?,-10,90,'consume','ai.image.generate','local-fixture',?,?${tokenValue})`)
      .bind(id, organization ? org : user, `${attempt}-key`, now, ...(token === undefined ? [] : [token]));
  };
  const bucket = () => first('SELECT balance FROM member_credit_buckets WHERE id = ?', ['fixture-bucket']);
  const debitCount = async (table = 'member_credit_ledger') => (await first(`SELECT COUNT(*) AS count FROM ${table} WHERE amount < 0`)).count;

  await check('actual starting migrations 0001–0080 apply to local workerd D1', async () => {
    for (const name of readdirSync(migrations).filter((name) => name.endsWith('.sql') && name < migrationName).sort()) {
      try { await batchSql(readFileSync(resolve(migrations, name), 'utf8')); }
      catch (error) { throw new Error(`Starting migration ${name}: ${error.message}`, { cause: error }); }
    }
    await run('INSERT INTO users(id,email,password_hash,created_at) VALUES (?,?,?,?)',
      [user, 'fixture@example.invalid', 'not-a-real-password-hash', now]);
    await run('INSERT INTO organizations(id,name,slug,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?)',
      [org, 'Local fixture', 'd1-cutover-fixture', user, now, now]);
    await run(`INSERT INTO member_credit_ledger(id,user_id,amount,balance_after,entry_type,source,created_at)
      VALUES ('fixture-grant',?,100,100,'grant','local-fixture',?)`, [user, now]);
    await run(`INSERT INTO member_credit_buckets(id,user_id,bucket_type,balance,source,created_at,updated_at)
      VALUES ('fixture-bucket',?,'legacy_or_bonus',100,'local-fixture',?,?)`, [user, now, now]);
    await insertMember('member_ai_usage_attempts', 'legacy-confirmed', 'finalizing', 'succeeded');
    await insertMember('member_ai_usage_attempts', 'legacy-not-started');
    await insertOrg('ai_usage_attempts', 'legacy-org-confirmed', 'finalizing', 'succeeded');
    await insertOrg('ai_usage_attempts', 'legacy-org-not-started');
    await run('CREATE TABLE local_cutover_fk_probe(id TEXT PRIMARY KEY, attempt_id TEXT REFERENCES member_ai_usage_attempts(id))');
    await run("INSERT INTO local_cutover_fk_probe VALUES ('fixture-reference','legacy-confirmed')");
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
  });

  await check('failed migration batch atomically rolls back ALTERs, backfill, triggers and views', async () => {
    const statements = splitSql(migrationSql).map((sql) => db.prepare(sql));
    statements.push(db.prepare('INSERT INTO nonexistent_cutover_failure_table VALUES (1)'));
    await assert.rejects(db.batch(statements), /no such table/);
    assert.equal((await first("SELECT type FROM sqlite_master WHERE name='member_ai_usage_attempts'")).type, 'table');
    assert.equal(await first("SELECT name FROM sqlite_master WHERE name='member_ai_usage_attempts_v2'"), null);
    const columns = (await db.prepare('PRAGMA table_info(member_credit_ledger)').all()).results;
    assert.equal(columns.some((column) => column.name === 'ai_dispatch_token'), false);
    assert.equal((await bucket()).balance, 100);
    assert.equal(await debitCount(), 0);
  });

  await check('0081 batch succeeds with existing FK rows and preserves legacy read views', async () => {
    await batchSql(migrationSql);
    for (const table of tables) {
      assert.equal((await first('SELECT type FROM sqlite_master WHERE name = ?', [table])).type, 'view');
      assert.equal((await first('SELECT type FROM sqlite_master WHERE name = ?', [`${table}_v2`])).type, 'table');
      assert.ok(Array.isArray((await db.prepare(`SELECT * FROM ${table} LIMIT 1`).all()).results));
    }
    const fk = (await db.prepare('PRAGMA foreign_key_list(local_cutover_fk_probe)').all()).results;
    assert.equal(fk[0].table, 'member_ai_usage_attempts_v2');
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
    for (const [table, id] of [['member_ai_usage_attempts', 'legacy-not-started'], ['ai_usage_attempts', 'legacy-org-not-started']]) {
      const row = await first(`SELECT provider_outcome,dispatch_token FROM ${table} WHERE id=?`, [id]);
      assert.deepEqual(row, { provider_outcome: 'unknown', dispatch_token: `legacy:${id}` });
    }
    assert.equal((await first("SELECT provider_outcome FROM member_ai_usage_attempts WHERE id='legacy-confirmed'")).provider_outcome, 'succeeded');
  });

  await check('all four old write interfaces reject INSERT, DELETE and even zero-row UPDATE', async () => {
    for (const table of tables) {
      await assert.rejects(run(`UPDATE ${table} SET status=status WHERE id='absent-fixture'`), /cannot modify .* because it is a view/);
      await assert.rejects(run(`DELETE FROM ${table} WHERE id='absent-fixture'`), /cannot modify .* because it is a view/);
      await assert.rejects(run(`INSERT INTO ${table}(id) VALUES ('absent-fixture')`), /cannot modify .* because it is a view/);
    }
  });

  await check('old confirmed member settlement is rejected and preceding bucket update rolls back', async () => {
    await assert.rejects(db.batch([
      db.prepare("UPDATE member_credit_buckets SET balance=balance-10 WHERE id='fixture-bucket'"),
      ledgerStatement({ id: 'forbidden-legacy-debit', attempt: 'legacy-confirmed' }),
    ]), /ai_attempt_settlement_forbidden/);
    assert.equal((await bucket()).balance, 100);
    assert.equal(await debitCount(), 0);
    const row = await first("SELECT provider_outcome,billing_status FROM member_ai_usage_attempts_v2 WHERE id='legacy-confirmed'");
    assert.deepEqual(row, { provider_outcome: 'succeeded', billing_status: 'reserved' });
  });

  await check('old confirmed organization settlement without a dispatch token is rejected', async () => {
    await assert.rejects(ledgerStatement({ id: 'forbidden-org-debit', attempt: 'legacy-org-confirmed', organization: true }).run(), /ai_attempt_settlement_forbidden/);
    assert.equal(await debitCount('credit_ledger'), 0);
  });

  const { claimAiDispatch, confirmAiDispatchSuccess } = await import('../../workers/auth/src/lib/ai-dispatch-state.js');
  const { consumeMemberCredits } = await import('../../workers/auth/src/lib/billing.js');
  const env = { DB: db };
  await insertMember('member_ai_usage_attempts_v2', 'new-operation');
  let dispatchToken;
  await check('canonical dispatch claim is single-owner and wrong-token settlement rolls back', async () => {
    dispatchToken = await claimAiDispatch(env, 'member_ai_usage_attempts_v2', 'new-operation');
    await assert.rejects(claimAiDispatch(env, 'member_ai_usage_attempts_v2', 'new-operation'), /unresolved provider outcome/);
    await confirmAiDispatchSuccess(env, 'member_ai_usage_attempts_v2', 'new-operation', { dispatchToken });
    assert.equal((await first("SELECT provider_outcome FROM member_ai_usage_attempts_v2 WHERE id='new-operation'")).provider_outcome, 'succeeded');
    await assert.rejects(db.batch([
      db.prepare("UPDATE member_credit_buckets SET balance=balance-10 WHERE id='fixture-bucket'"),
      ledgerStatement({ id: 'wrong-token-debit', attempt: 'new-operation', token: 'incorrect-fixture-token' }),
    ]), /ai_attempt_settlement_forbidden/);
    assert.equal((await bucket()).balance, 100);
    assert.equal(await debitCount(), 0);
  });

  await check('D1 rolls back an admitted ledger INSERT when a later bucket CHECK fails', async () => {
    await assert.rejects(db.batch([
      ledgerStatement({ id: 'rolled-back-token-debit', attempt: 'new-operation', token: dispatchToken }),
      db.prepare("UPDATE member_credit_buckets SET balance=-1 WHERE id='fixture-bucket'"),
    ]), /CHECK constraint failed/);
    assert.equal(await debitCount(), 0);
    assert.equal((await bucket()).balance, 100);
  });

  await check('actual member billing helper accepts matching token once and replays without another debit', async () => {
    const input = { env, userId: user, featureKey: 'ai.image.generate', credits: 10,
      idempotencyKey: 'new-operation-key', requestFingerprint: 'new-operation-fingerprint', aiDispatchToken: dispatchToken };
    const charged = await consumeMemberCredits(input);
    assert.equal(charged.reused, false);
    const replay = await consumeMemberCredits(input);
    assert.equal(replay.reused, true);
    assert.equal(await debitCount(), 1);
    assert.equal((await bucket()).balance, 90);
    const ledger = await first('SELECT amount,ai_dispatch_token FROM member_credit_ledger WHERE amount < 0');
    assert.deepEqual(ledger, { amount: -10, ai_dispatch_token: dispatchToken });
    assert.equal((await first('SELECT COUNT(*) AS count FROM member_usage_events')).count, 1);
    assert.equal((await first('SELECT COUNT(*) AS count FROM member_credit_bucket_events WHERE amount < 0')).count, 1);
  });
  assert.equal(outboundAttempts, 0);
  console.log(JSON.stringify({ passed: results.length, failed: 0, skipped: 0, node: process.version,
    miniflare: requireTool('miniflare/package.json').version,
    wrangler: requireTool('wrangler/package.json').version,
    migration_sha256: createHash('sha256').update(migrationSql).digest('hex'),
    results, outbound_attempts: outboundAttempts,
    scope: 'Local workerd D1 with actual migration SQL and current Node-hosted billing/dispatch helpers; no production or provider execution.' }, null, 2));
} finally {
  await mf.dispose();
}
