const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { MockD1, MockBucket } = require('./helpers/auth-worker-harness.js');

const USER = 'q2-lifecycle-bridge-owner';
const KEY = `users/${USER}/fixture.png`;
const NOW = '2026-09-06T12:00:00.000Z';
let cleanup;
let lifecycle;
test.beforeAll(async () => {
  cleanup = await import(pathToFileURL(path.join(process.cwd(), 'workers/auth/src/lib/r2-cleanup.js')).href);
  lifecycle = await import(pathToFileURL(path.join(process.cwd(), 'workers/auth/src/routes/ai/lifecycle.js')).href);
});

function queueRow(id = 1, status = 'q2_pending', key = KEY) {
  return { id, r2_key: key, status, created_at: NOW, attempts: 0, last_attempt_at: null };
}
function environment(seed = {}) {
  return { DB: new MockD1(seed), USER_IMAGES: new MockBucket({ [KEY]: { body: new Uint8Array([1, 2, 3]) } }) };
}

test('L01 MockD1 native source guards enforce empty counts, identity, NULL keys and folder scope', async () => {
  const db = new MockD1({ aiImages: [{ id: 'image', user_id: USER, folder_id: 'folder', r2_key: KEY }] });
  const guard = `SELECT CASE WHEN EXISTS (SELECT 1 FROM ai_images WHERE id = ? AND user_id = ? AND folder_id IS ?
    AND r2_key IS ? AND thumb_key IS ? AND medium_key IS ?) THEN 1 ELSE json_extract('[]', '$[') END`;
  const count = `SELECT CASE WHEN (SELECT COUNT(*) FROM ai_images WHERE user_id = ? AND folder_id IS ?) = ?
    THEN 1 ELSE json_extract('[]', '$[') END`;
  const before = await db.prepare(guard).bind('image', USER, 'folder', KEY, null, null).run();
  expect(before.meta.changes).toBe(0);
  for (const args of [
    ['missing', USER, 'folder', KEY, null, null],
    ['image', USER, null, KEY, null, null],
    ['image', USER, 'folder', KEY, '', null],
    ['image', 'foreign', 'folder', KEY, null, null],
  ]) await expect(db.prepare(guard).bind(...args).run()).rejects.toThrow();
  await expect(db.prepare(count).bind(USER, 'folder', 1).run()).resolves.toMatchObject({ meta: { changes: 0 } });
  await expect(db.prepare(count).bind(USER, 'empty-folder', 0).run()).resolves.toMatchObject({ meta: { changes: 0 } });
  await expect(db.prepare(count).bind(USER, 'folder', 0).run()).rejects.toThrow();
  db.state.aiImages.push({ id: 'second', user_id: USER, folder_id: 'folder', r2_key: `${KEY}.second` });
  await expect(db.prepare(count).bind(USER, 'folder', 1).run()).rejects.toThrow();
});

test('L01 MockD1 mixed lifecycle batch retains rollback and actual successful deletion', async () => {
  const env = environment({ aiImages: [{ id: 'image', user_id: USER, r2_key: KEY, size_bytes: 3, derivatives_status: 'ready' }] });
  const before = JSON.parse(JSON.stringify(env.DB.state));
  env.DB.failQueries.push('DELETE FROM ai_images WHERE user_id = ?');
  await expect(lifecycle.deleteAllUserAiAssets({ env, userId: USER })).rejects.toThrow();
  expect(env.DB.state).toEqual(before);
  expect(env.USER_IMAGES.deleteCalls).toEqual([]);
  env.DB.failQueries.length = 0;
  await expect(lifecycle.deleteAllUserAiAssets({ env, userId: USER })).resolves.toMatchObject({ deletedAiImagesCount: 1 });
  expect(env.DB.state.aiImages).toEqual([]);
  expect(env.DB.state.r2CleanupQueue).toEqual([]);
  expect(env.DB.state.r2ObjectTombstones).toEqual([{ r2_key: KEY, retired_at: expect.any(String) }]);
  expect(env.USER_IMAGES.deleteCalls).toEqual([KEY]);
});

test('L01 native bridge executes all 16 reference-view aliases and conditional live-state predicates', async () => {
  const aliases = [
    ['aiImages', { r2_key: KEY }], ['aiImages', { thumb_key: KEY }], ['aiImages', { medium_key: KEY }],
    ['aiTextAssets', { r2_key: KEY }], ['aiTextAssets', { poster_r2_key: KEY }],
    ['aiVideoJobs', { output_r2_key: KEY }], ['aiVideoJobs', { poster_r2_key: KEY }],
    ['homepageHeroVideoUploads', { r2_key: KEY }],
    ['homepageHeroVideoDerivatives', { file_r2_key: KEY }], ['homepageHeroVideoDerivatives', { poster_r2_key: KEY }],
    ['homepageHeroVideoDerivatives', { source_r2_key: KEY, status: 'processing' }],
    ['memvidStreamPreviews', { source_r2_key: KEY }],
    ['fableChatAttachments', { r2_key: KEY, state: 'attached', deleted_at: null }],
    ['newsPulseItems', { visual_object_key: KEY }],
    ['dataExportArchives', { r2_key: KEY, r2_bucket: 'USER_IMAGES' }],
    ['platformBudgetEvidenceArchives', { storage_key: KEY, storage_bucket: 'USER_IMAGES', deleted_at: null }],
  ];
  for (const [stateKey, row] of aliases) {
    const env = environment({ [stateKey]: [row], r2CleanupQueue: [queueRow()] });
    const result = await cleanup.processR2CleanupQueue(env, { now: NOW });
    expect(result, stateKey).toEqual({ deleted: 0, failed: 0, held: 1, dead: 0 });
    expect(env.DB.state.r2CleanupQueue[0].status, stateKey).toBe('q2_held');
    expect(env.DB.state.r2ObjectTombstones, stateKey).toEqual([]);
    expect(env.USER_IMAGES.deleteCalls, stateKey).toEqual([]);
  }
  for (const [stateKey, row] of [
    ['homepageHeroVideoDerivatives', { source_r2_key: KEY, status: 'completed' }],
    ['fableChatAttachments', { r2_key: KEY, state: 'attached', deleted_at: NOW }],
    ['fableChatAttachments', { r2_key: KEY, state: 'deleted', deleted_at: null }],
    ['dataExportArchives', { r2_key: KEY, r2_bucket: 'PRIVATE_MEDIA' }],
    ['platformBudgetEvidenceArchives', { storage_key: KEY, storage_bucket: 'USER_IMAGES', deleted_at: NOW }],
  ]) {
    const env = environment({ [stateKey]: [row], r2CleanupQueue: [queueRow()] });
    await expect(cleanup.processR2CleanupQueue(env, { now: NOW })).resolves.toEqual({ deleted: 1, failed: 0, held: 0, dead: 0 });
    expect(env.USER_IMAGES.deleteCalls, stateKey).toEqual([KEY]);
  }
});

test('L01 native claim batch rolls back later faults; missing reference schema never releases R2', async () => {
  for (const fault of ['late_claim', 'missing_view', 'missing_alias']) {
    const env = environment({ r2CleanupQueue: [queueRow()] });
    const before = JSON.parse(JSON.stringify(env.DB.state));
    if (fault === 'late_claim') env.DB.failQueries.push("UPDATE r2_cleanup_queue SET status = 'q2_deleting'");
    if (fault === 'missing_view') env.DB.missingTables.add('r2_cleanup_live_references');
    if (fault === 'missing_alias') env.DB.missingTables.add('news_pulse_items');
    await expect(cleanup.processR2CleanupQueue(env, { now: NOW })).rejects.toThrow();
    expect(env.DB.state).toEqual(before);
    expect(env.USER_IMAGES.deleteCalls).toEqual([]);
  }
});

test('L01 bridge preserves legacy hold, retry exhaustion, permanent tombstones and queue identities', async () => {
  const env = environment({ r2CleanupQueue: [queueRow(4, 'pending'), queueRow(5)] });
  env.USER_IMAGES.failDeleteKeys.add(KEY);
  for (let i = 0; i < 5; i += 1) await cleanup.processR2CleanupQueue(env, { now: NOW });
  expect(env.DB.state.r2CleanupQueue.map(row => [row.id, row.status, row.attempts]))
    .toEqual([[4, 'legacy_held', 0], [5, 'q2_dead', 5]]);
  await cleanup.processR2CleanupQueue(env, { now: NOW });
  expect(env.USER_IMAGES.deleteCalls).toHaveLength(5);
  await expect(env.DB.prepare('DELETE FROM r2_object_tombstones WHERE r2_key = ?').bind(KEY).run()).rejects.toThrow(/retirement_is_permanent/);
  await expect(env.DB.prepare('UPDATE r2_object_tombstones SET retired_at = ? WHERE r2_key = ?').bind('later', KEY).run()).rejects.toThrow(/retirement_is_permanent/);
  await expect(env.DB.prepare('SELECT invented_column FROM r2_object_tombstones').all()).rejects.toThrow(/no such column/);
  env.DB.state.aiTextAssets.push({ id: 'forbidden-revival', user_id: USER, r2_key: KEY });
  await expect(cleanup.processR2CleanupQueue(env, { now: NOW })).rejects.toThrow(/fixture contains a live reference to a retired key/);
  expect(env.USER_IMAGES.deleteCalls).toHaveLength(5);
  const db = new MockD1();
  const insert = () => db.prepare("INSERT INTO r2_cleanup_queue(r2_key,status,created_at) VALUES(?,'q2_pending',?)").bind(KEY, NOW).run();
  const first = await insert();
  await db.prepare('DELETE FROM r2_cleanup_queue WHERE id = ?').bind(first.meta.last_row_id).run();
  const second = await insert();
  expect(second.meta.last_row_id).toBeGreaterThan(first.meta.last_row_id);
});

test('L01 MockBucket create-only PUT returns null on collision, preserves bytes and rejects unmodeled conditions', async () => {
  const env = environment();
  await expect(cleanup.putNewManagedR2Object(env, KEY, new Uint8Array([8]))).rejects.toThrow(/already exists/);
  expect([...env.USER_IMAGES.objects.get(KEY).body]).toEqual([1, 2, 3]);
  await expect(cleanup.putNewManagedR2Object(env, `${KEY}.new`, new Uint8Array([9]))).resolves.toMatchObject({ key: `${KEY}.new` });
  await expect(env.USER_IMAGES.put(KEY, new Uint8Array([7]), { onlyIf: new Headers({ 'If-Match': 'invented' }) })).rejects.toThrow(/Unsupported/);
  expect([...env.USER_IMAGES.objects.get(KEY).body]).toEqual([1, 2, 3]);
  await env.USER_IMAGES.put(KEY, new Uint8Array([6]));
  expect([...env.USER_IMAGES.objects.get(KEY).body]).toEqual([6]);
  env.DB.state.r2ObjectTombstones.push({ r2_key: `${KEY}.retired`, retired_at: NOW });
  const puts = env.USER_IMAGES.putCalls.length;
  await expect(cleanup.putNewManagedR2Object(env, `${KEY}.retired`, new Uint8Array([4]))).rejects.toThrow(/retired/);
  expect(env.USER_IMAGES.putCalls).toHaveLength(puts);
});
