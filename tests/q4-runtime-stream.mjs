import assert from 'node:assert/strict';
import { seedStreamJob, streamApi, claimStream, completionBody, STREAM_UID } from './helpers/q4-stream-fixture.mjs';
import { expectNativeRejection } from './helpers/q2-runtime/assertions.mjs';

export async function runStreamTests(f) {
  const { db, sql, rows, scalar, migrations, test, mf } = f;
  for (const m of migrations.filter(m => Number(m.path.slice(0, 4)) <= 83))
    await db.batch(m.statements.map(s => db.prepare(s)));
  const source = await seedStreamJob(db, 101);
  const migration = migrations.find(m => m.path.startsWith('0084_'));
  await test('q4_0084_native_failure_rolls_back_new_schema_and_preserves_populated_sources', async () => {
    const before = await rows('SELECT type,name,sql FROM sqlite_schema ORDER BY type,name');
    await expectNativeRejection(() => db.batch([...migration.statements.map(s => db.prepare(s)),
      db.prepare('INSERT INTO memvid_stream_upload_receipts(job_id) VALUES(NULL)')]), 'NOT NULL constraint failed');
    assert.deepEqual(await rows('SELECT type,name,sql FROM sqlite_schema ORDER BY type,name'), before);
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM ai_text_assets WHERE id=?', source.asset), 1);
    assert.deepEqual(await rows('PRAGMA foreign_key_check'), []);
  });
  await test('q4_final_additive_migrations_apply_to_populated_native_D1_without_replaying_jobs', async () => {
    const before = await rows('SELECT * FROM memvid_stream_previews');
    for (const m of migrations.filter(m => Number(m.path.slice(0, 4)) > 83))
      await db.batch(m.statements.map(s => db.prepare(s)));
    assert.deepEqual(await rows('SELECT * FROM memvid_stream_previews'), before);
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM memvid_stream_upload_receipts'), 0);
    assert.deepEqual(await rows('PRAGMA foreign_key_check'), []);
  });
  const worker = await mf.getWorker('q2-candidate');
  const api = streamApi((url, init) => worker.fetch(url, init));
  let job, upload;
  await test('q4_actual_Wrangler_HTTP_protocol_and_competing_claims_fail_closed', async () => {
    assert.equal((await api('jobs/claim', undefined, 'wrong')).status, 403);
    assert.equal((await api('jobs/claim')).body.data.receipt_protocol, 2);
    assert.equal((await api('jobs/claim', { limit: 1 })).status, 409);
    const claimed = (await Promise.all([claimStream(api), claimStream(api)])).filter(Boolean);
    assert.equal(claimed.length, 1); job = claimed[0];
    const begin = { phase: 'begin', claim_token: job.claim_token, source_fingerprint: job.source.fingerprint };
    upload = (await api(`jobs/${job.id}/receipt`, begin)).body.data;
    assert.ok(upload.upload_token);
    assert.equal((await api(`jobs/${job.id}/receipt`, begin)).status, 409);
    await api(`jobs/${job.id}/fail`, { claim_token: job.claim_token, error_code: 'upload_response_lost' });
    assert.equal(await claimStream(api), undefined);
  });
  await test('q4_native_known_receipt_is_idempotent_and_resumes_without_reissuing_upload_permit', async () => {
    const receipt = { upload_token: upload.upload_token, stream_uid: STREAM_UID, source_fingerprint: job.source.fingerprint };
    for (let i = 0; i < 2; i++) assert.equal((await api(`jobs/${job.id}/receipt`, receipt)).status, 200);
    assert.equal((await api(`jobs/${job.id}/receipt`, { ...receipt, stream_uid: 'f'.repeat(32) })).status, 409);
    job = await claimStream(api);
    assert.equal(job.stream_uid, STREAM_UID); assert.equal(job.repair_download, true);
    assert.equal((await api(`jobs/${job.id}/receipt`, { phase: 'begin', claim_token: job.claim_token, source_fingerprint: job.source.fingerprint })).status, 409);
  });
  await test('q4_native_receipt_and_complete_batch_fault_preserve_recoverable_UID', async () => {
    await sql("CREATE TRIGGER q4_native_complete_fault BEFORE UPDATE ON memvid_stream_previews BEGIN SELECT RAISE(ABORT,'q4_native_complete_fault'); END").run();
    await expectNativeRejection(() => api(`jobs/${job.id}/complete`, completionBody(job)), 'q4_native_complete_fault');
    assert.equal((await sql('SELECT phase,stream_uid FROM memvid_stream_upload_receipts WHERE job_id=?', job.id).first()).phase, 'received');
    await sql('DROP TRIGGER q4_native_complete_fault').run();
    for (let i = 0; i < 2; i++) assert.equal((await api(`jobs/${job.id}/complete`, completionBody(job))).status, 200);
    assert.equal((await api(`jobs/${job.id}/fail`, { claim_token: job.claim_token, error_code: 'late_fail' })).body.data.status, 'ready');
  });
  await test('q4_native_late_receipt_survives_source_delete_without_publication_or_delete', async () => {
    const removed = await seedStreamJob(db, 102); const retired = await claimStream(api);
    const permitted = (await api(`jobs/${retired.id}/receipt`, { phase: 'begin', claim_token: retired.claim_token, source_fingerprint: retired.source.fingerprint })).body.data;
    await sql('DELETE FROM ai_text_assets WHERE id=?', removed.asset).run();
    const result = await api(`jobs/${retired.id}/receipt`, { upload_token: permitted.upload_token, stream_uid: 'f'.repeat(32), source_fingerprint: retired.source.fingerprint });
    assert.equal(result.status, 200); assert.equal(result.body.data.retired, true);
    assert.equal((await api(`jobs/${retired.id}/complete`, completionBody(retired, 'f'.repeat(32)))).status, 409);
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM memvid_stream_upload_receipts WHERE job_id=? AND retired_at IS NOT NULL', retired.id), 1);
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM memvid_stream_previews WHERE id=?', retired.id), 0);
  });
  await test('q4_restricted_recovery_preserves_complete_and_retired_receipts_without_replaying_operations', async () => {
    const before = await rows('SELECT * FROM memvid_stream_upload_receipts ORDER BY job_id');
    const recovery = await mf.getWorker('q2-restricted');
    for (const path of ['jobs/claim', `jobs/${job.id}/receipt`, `jobs/${job.id}/complete`, `jobs/${job.id}/fail`]) {
      const result = await streamApi((url, init) => recovery.fetch(url, init))(path, completionBody(job));
      assert.equal(result.status, 503); assert.equal(result.body.code, 'release_access_restricted');
    }
    assert.deepEqual(await rows('SELECT * FROM memvid_stream_upload_receipts ORDER BY job_id'), before);
    assert.deepEqual(await rows('PRAGMA foreign_key_check'), []);
    assert.equal(f.counters.outboundDenied, 0, 'No provider request even attempted');
  });
}
