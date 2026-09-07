import assert from 'node:assert/strict';
import { providerUsage, providerCost } from './helpers/q4-memory-fixture.mjs';

export async function runMemoryTests(f) {
  let legacyConversation;
  await f.test('Q4 memory populated0086 migration: failed batch rolls back, final exact SQL applies', async () => {
    for (const migration of f.migrations.filter(m => Number(m.path.slice(0, 4)) <= 85)) await f.db.batch(migration.statements.map(sql => f.sql(sql)));
    const seed = await f.control('/q4-memory', { action: 'seed-legacy' });
    assert.equal(seed.status, 200); const identity = await seed.json(); legacyConversation = identity.conversationId;
    await f.sql(`INSERT INTO fable_chat_memory_checkpoints (id,conversation_id,admin_user_id,profile,summary_version,summarizer_model_id,summarizer_prompt_version,status,coverage_turn_order,input_fingerprint,usage_json,provider_cost_usd_micros,created_at,updated_at,expires_at)
      VALUES ('fbk_00860000000000000000000000000000',?,?,'standard',1,'@cf/qwen/qwen3-30b-a3b-fp8',1,'unknown',1,'q4-native-legacy','{"input_tokens":17}',19,'2026-09-07T00:00:00Z','2026-09-07T00:00:00Z','2026-09-07T00:00:01Z')`, legacyConversation, identity.actorId).run();
    const migration = f.migrations.find(m => m.path === '0086_add_fable_memory_source_revision.sql'); assert.ok(migration);
    await assert.rejects(f.db.batch([...migration.statements.map(sql => f.sql(sql)), f.sql('INSERT INTO q4_intentionally_missing_memory_table VALUES(1)')]), /no such table/i);
    assert.equal((await f.rows('PRAGMA table_info(fable_chat_memory_checkpoints)')).some(row => row.name === 'source_admin_revision_version'), false);
    await f.db.batch(migration.statements.map(sql => f.sql(sql)));
    const legacy = (await f.rows('SELECT source_admin_revision_version,usage_json,provider_cost_usd_micros FROM fable_chat_memory_checkpoints WHERE conversation_id=?', legacyConversation))[0];
    assert.equal(legacy.source_admin_revision_version, null); assert.equal(legacy.usage_json, '{"input_tokens":17}'); assert.equal(legacy.provider_cost_usd_micros,19);
    await assert.rejects(f.sql('UPDATE fable_chat_memory_checkpoints SET source_admin_revision_version=0 WHERE conversation_id=?', legacyConversation).run(), /Memory source revision is immutable/);
    assert.deepEqual(await f.rows('PRAGMA foreign_key_check'), []);
  });
  for (const kind of ['candidate-edit', 'running-edit', 'late-edit', 'selection-edit', 'grok-selection', 'append', 'batch-failure', 'ancestor-invalidation']) {
    await f.test(`Q4 native genuine memory/context graph: ${kind}`, async () => {
      const response = await f.control('/q4-memory', { kind }); assert.equal(response.status,200);
      const result = await response.json(); assert.equal(result.bounded,true);
      if (kind === 'candidate-edit' || kind === 'running-edit') {
        assert.equal(result.injected,true); assert.equal(result.providerCalls,0); assert.equal(result.appliedCheckpoint,null);
        assert.equal(result.status,kind === 'candidate-edit' ? null : 'failed');
      } else {
        assert.equal(result.providerCalls,kind === 'ancestor-invalidation' ? 3 : 1);
        assert.equal(result.budget.provider_cost_usd,providerCost);
        for (const key of Object.keys(providerUsage)) assert.equal(result.budget[key],providerUsage[key]);
      }
      if (kind === 'late-edit') {
        assert.equal(result.status,'failed'); assert.equal(result.hasStoredSummary,false);
        assert.equal(result.checkpointCostMicros,Math.round(providerCost*1e6));
      }
      if (['late-edit','selection-edit','grok-selection'].includes(kind)) {
        assert.equal(result.hasEditedRaw,true); assert.equal(result.appliedCheckpoint,null); assert.equal(result.hasHiddenMemory,false);
      }
      if (kind === 'ancestor-invalidation') { assert.equal(result.appliedCheckpoint,null); assert.equal(result.hasHiddenMemory,false); }
      if (kind === 'append') { assert.equal(result.keptOriginalCheckpoint,true); assert.equal(result.hasAppendedRaw,true); assert.equal(result.hasHiddenMemory,true); }
      if (kind === 'batch-failure') { assert.equal(result.status,'unknown'); assert.deepEqual(result.usage,{}); assert.equal(result.checkpointCostMicros,null); assert.equal(result.appliedCheckpoint,null); }
      assert.deepEqual(await f.rows('PRAGMA foreign_key_check'), []);
    });
  }
  await f.test('q4_restricted_recovery_preserves_memory_state_and_blocks_new_business_HTTP', async () => {
    const before = await f.rows('SELECT * FROM fable_chat_memory_checkpoints ORDER BY id');
    const recovery = await f.mf.getWorker('q2-restricted');
    const response = await recovery.fetch('https://bitbi.ai/api/admin/fable-chat/conversations/fbc_0123456789abcdef0123456789abcdef/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'release_access_restricted');
    assert.deepEqual(await f.rows('SELECT * FROM fable_chat_memory_checkpoints ORDER BY id'), before);
  });

}
