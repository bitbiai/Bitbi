import assert from 'node:assert/strict';

export async function runVideoTests(f) {
  for (const migration of f.migrations) await f.db.batch(migration.statements.map(sql => f.db.prepare(sql)));
  for (const name of ['own-claim', 'slow-121', 'late-expired', 'cancelled', 'receipt-reply-lost', 'usage-before', 'pending-poll']) {
    await f.test(`q4_native_actual_queue_${name}`, async () => {
      const response = await f.control('/q4-video', { case: name });
      assert.equal(response.status, 200, `Control assertion failed for ${name}`);
      const result = await response.json();
      assert.equal(result.case, name); assert.equal(result.calls.create, 1);
      assert.equal(result.timers, 0); assert.equal(result.receipt.taskMatches, true);
      f.metrics.push(result);
      assert.deepEqual(await f.rows('PRAGMA foreign_key_check'), []);
      assert.equal(f.counters.outboundDenied, 0, 'No actual outbound request attempted');
      assert.equal(f.counters.serviceDenied, 0, 'Only explicit synthetic provider binding used');
    });
  }
  await f.test('q4_restricted_recovery_preserves_video_state_and_blocks_new_business_HTTP', async () => {
    const before = await f.rows('SELECT * FROM ai_video_jobs_v2 ORDER BY id');
    const recovery = await f.mf.getWorker('q2-restricted');
    const response = await recovery.fetch('https://bitbi.ai/api/admin/ai/video/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'release_access_restricted');
    assert.deepEqual(await f.rows('SELECT * FROM ai_video_jobs_v2 ORDER BY id'), before);
  });

}
