const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { SqliteD1Database, applyAuthMigrations } = require('./helpers/sqlite-d1');

const USER = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const IMAGE = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const KEY = `users/${USER}/folders/unsorted/fixture-generation.png`;
const CREATED = '2026-09-06T00:00:00.000Z';
const moduleUrl = (file) => pathToFileURL(path.join(process.cwd(), file)).href;

let lifecycle;
let worker;
let cleanup;
let textAssets;
test.beforeAll(async () => {
  lifecycle = await import(moduleUrl('workers/auth/src/routes/ai/lifecycle.js'));
  // The actual scheduled entry point and its normal import graph. No copied
  // consumer, source substitution, loader stub or fake SQL result is used.
  worker = (await import(moduleUrl('workers/auth/src/index.js'))).default;
  cleanup = await import(moduleUrl('workers/auth/src/lib/r2-cleanup.js'));
  textAssets = await import(moduleUrl('workers/auth/src/lib/ai-text-assets.js'));
});

function fixture() {
  const db = new SqliteD1Database();
  applyAuthMigrations(db);
  db.database.prepare('INSERT INTO users(id,email,password_hash,created_at) VALUES(?,?,?,?)')
    .run(USER, 'lifecycle@example.invalid', 'synthetic-unused', CREATED);
  db.database.prepare(`INSERT INTO ai_images
    (id,user_id,r2_key,prompt,model,size_bytes,created_at,derivatives_status,
     derivatives_version,thumb_key,medium_key)
    VALUES(?,?,?,?,?,?,?,'ready',1,?,?)`)
    .run(IMAGE, USER, KEY, 'Synthetic lifecycle fixture', 'fixture', 64, CREATED, `${KEY}.thumb`, `${KEY}.medium`);
  const objects = new Map([KEY, `${KEY}.thumb`, `${KEY}.medium`].map((key) => [key, new Uint8Array(64)]));
  const calls = { deletes: [], puts: [], provider: 0, queue: [], archive: 0, network: 0, private: 0 };
  const controls = { failDelete: false, allowPut: false, beforeDelete: null, beforePut: null };
  const unexpectedProvider = async () => { calls.provider += 1; throw new Error('Unexpected synthetic provider call'); };
  const bucket = {
    async delete(key) {
      calls.deletes.push(key);
      if (controls.failDelete) throw new Error('Synthetic R2 unavailable');
      if (controls.beforeDelete) await controls.beforeDelete(key);
      for (const item of Array.isArray(key) ? key : [key]) objects.delete(item);
    },
    async list({ prefix = '' } = {}) {
      return { objects: [...objects.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key, uploaded: new Date(CREATED), size: 64 })), truncated: false };
    },
    async get(key) { return objects.has(key) ? { body: objects.get(key), size: 64 } : null; },
    async head(key) { return objects.has(key) ? { key, size: 64 } : null; },
    async put(key, value, options = {}) {
      if (!controls.allowPut) throw new Error('Unexpected synthetic R2 write');
      calls.puts.push({ key, conditional: options.onlyIf?.get('If-None-Match') || null });
      if (controls.beforePut) await controls.beforePut(key);
      if (options.onlyIf?.get('If-None-Match') === '*' && objects.has(key)) return null;
      objects.set(key, new Uint8Array(await new Response(value).arrayBuffer()));
      return { key, size: objects.get(key).byteLength, etag: 'synthetic-etag' };
    },
  };
  const env = {
    DB: db, USER_IMAGES: bucket, BITBI_ENV: 'test', NEWS_PULSE_SOURCE_URLS: '',
    ENABLE_NEWS_PULSE_VISUAL_BUDGET: 'false',
    AI: { run: unexpectedProvider }, AI_LAB: { fetch: unexpectedProvider },
    IMAGES: { info: unexpectedProvider, input: unexpectedProvider },
    AI_IMAGE_DERIVATIVES_QUEUE: { async send(message) { calls.queue.push(message); } },
    AUDIT_ARCHIVE: Object.fromEntries(['get', 'head', 'put', 'delete', 'list'].map((method) => [method, async () => {
      calls.archive += 1; throw new Error('Unexpected synthetic archive operation');
    }])),
    PRIVATE_MEDIA: Object.fromEntries(['get', 'head', 'put', 'delete', 'list'].map((method) => [method, async () => {
      calls.private += 1; throw new Error('Unexpected synthetic private-media operation');
    }])),
    __TEST_FETCH: async () => { calls.network += 1; throw new Error('Unexpected synthetic fetch'); },
  };
  return { db, objects, calls, controls, env };
}

async function scheduled(f) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { f.calls.network += 1; throw new Error('No network in lifecycle tests'); };
  try {
    await worker.scheduled({ cron: '0 0 * * *' }, f.env, { waitUntil() { throw new Error('Unexpected unobserved scheduled task'); } });
  } finally {
    globalThis.fetch = originalFetch;
  }
  expect(f.calls.provider).toBe(0);
  expect(f.calls.network).toBe(0);
  expect(f.calls.archive).toBe(0);
  expect(f.calls.private).toBe(0);
  expect(f.calls.queue).toEqual([]);
  expect(f.db.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
}

function counts(f) {
  return {
    sources: f.db.database.prepare('SELECT COUNT(*) AS n FROM ai_images').get().n,
    cleanup: f.db.database.prepare('SELECT COUNT(*) AS n FROM r2_cleanup_queue').get().n,
  };
}

for (const operation of ['deleteAllUserAiAssets', 'deleteUserAiImage']) {
  test(`Q2 L01 ${operation}: source DELETE failure never releases cleanup to actual scheduled consumer`, async () => {
    const f = fixture();
    try {
      f.db.exec("CREATE TEMP TRIGGER q2_source_failure BEFORE DELETE ON ai_images BEGIN SELECT RAISE(ABORT, 'synthetic source failure'); END;");
      await expect(lifecycle[operation]({ env: f.env, userId: USER, imageId: IMAGE })).rejects.toThrow();
      expect(counts(f)).toEqual({ sources: 1, cleanup: 0 });
      await scheduled(f);
      expect(counts(f)).toEqual({ sources: 1, cleanup: 0 });
      expect(f.calls.deletes).toEqual([]);
      expect(f.objects.size).toBe(3);
    } finally { f.db.close(); }
  });
}

test('Q2 L01 zero-row source DELETE is not a positive cleanup release', async () => {
  const f = fixture();
  try {
    f.db.exec('CREATE TEMP TRIGGER q2_source_ignore BEFORE DELETE ON ai_images BEGIN SELECT RAISE(IGNORE); END;');
    await expect(lifecycle.deleteAllUserAiAssets({ env: f.env, userId: USER })).rejects.toThrow();
    expect(counts(f)).toEqual({ sources: 1, cleanup: 0 });
    await scheduled(f);
    expect(f.calls.deletes).toEqual([]);
    expect(f.objects.size).toBe(3);
  } finally { f.db.close(); }
});

test('Q2 L01 failure in a later account mutation rolls back sources and cleanup together', async () => {
  const f = fixture();
  try {
    f.db.exec('CREATE TABLE q2_additional_guard (value INTEGER CHECK(value = 1))');
    const additionalStatements = [{ statement: f.db.prepare('INSERT INTO q2_additional_guard VALUES (2)'), label: 'synthetic_account_mutation', category: 'account' }];
    await expect(lifecycle.deleteAllUserAiAssets({ env: f.env, userId: USER, additionalStatements })).rejects.toThrow();
    expect(counts(f)).toEqual({ sources: 1, cleanup: 0 });
    expect(f.db.database.prepare('SELECT COUNT(*) AS n FROM q2_additional_guard').get().n).toBe(0);
    await scheduled(f);
    expect(f.calls.deletes).toEqual([]);
    expect(f.objects.size).toBe(3);
  } finally { f.db.close(); }
});

test('Q2 L01 confirmed source deletion survives R2 failure and scheduled retry deletes only its objects', async () => {
  const f = fixture();
  try {
    f.objects.set('unrelated/retain.bin', new Uint8Array(12));
    f.controls.failDelete = true;
    const result = await lifecycle.deleteAllUserAiAssets({ env: f.env, userId: USER });
    expect(result.deletedAiImagesCount).toBe(1);
    expect(counts(f)).toEqual({ sources: 0, cleanup: 3 });
    expect(f.objects.size).toBe(4);
    f.controls.failDelete = false;
    await scheduled(f);
    expect(counts(f)).toEqual({ sources: 0, cleanup: 0 });
    expect([...f.objects.keys()]).toEqual(['unrelated/retain.bin']);
    const afterFirst = f.calls.deletes.length;
    await scheduled(f);
    expect(f.calls.deletes.length).toBe(afterFirst);
  } finally { f.db.close(); }
});

function insertTextReference(f, key, id = 'cccccccccccccccccccccccccccccccc', folderId = null) {
  f.db.database.prepare(`INSERT INTO ai_text_assets
    (id,user_id,r2_key,title,file_name,source_module,mime_type,size_bytes,created_at,folder_id)
    VALUES(?,?,?,'Synthetic reference','fixture.txt','text','text/plain',12,?,?)`).run(id, USER, key, CREATED, folderId);
  return id;
}

const FOLDER = 'ffffffffffffffffffffffffffffffff';
function prepareSnapshotScope(f, scope, initiallyEmpty = false) {
  if (initiallyEmpty) {
    f.db.database.prepare('DELETE FROM ai_images').run();
    f.objects.clear();
  }
  if (scope === 'folder') {
    f.db.database.prepare('INSERT INTO ai_folders(id,user_id,name,slug,created_at) VALUES(?,?,?,?,?)')
      .run(FOLDER, USER, 'Snapshot fixture', 'snapshot-fixture', CREATED);
    f.db.database.prepare('UPDATE ai_images SET folder_id = ? WHERE id = ?').run(FOLDER, IMAGE);
  }
  f.db.database.prepare('INSERT INTO user_asset_storage_usage(user_id,used_bytes,updated_at) VALUES(?,200,?)').run(USER, CREATED);
}

function insertSnapshotAsset(f, scope, kind, id) {
  const key = `users/${USER}/folders/snapshot-fixture/${id}.${kind === 'image' ? 'png' : 'txt'}`;
  const folderId = scope === 'folder' ? FOLDER : null;
  if (kind === 'image') {
    f.db.database.prepare(`INSERT INTO ai_images
      (id,user_id,folder_id,r2_key,prompt,model,size_bytes,created_at,derivatives_status,derivatives_version,thumb_key,medium_key)
      VALUES(?,?,?,?,'Synthetic concurrent asset','fixture',12,?,'ready',1,?,?)`)
      .run(id, USER, folderId, key, CREATED, `${key}.thumb`, `${key}.medium`);
    f.objects.set(`${key}.thumb`, new Uint8Array([21, 22]));
    f.objects.set(`${key}.medium`, new Uint8Array([23, 24]));
  } else insertTextReference(f, key, id, folderId);
  f.objects.set(key, new Uint8Array([17, 18, 19]));
}

function snapshotAssetState(f) {
  return {
    images: f.db.database.prepare('SELECT id,user_id,folder_id,r2_key,thumb_key,medium_key,size_bytes FROM ai_images ORDER BY id').all(),
    text: f.db.database.prepare('SELECT id,user_id,folder_id,r2_key,poster_r2_key,size_bytes FROM ai_text_assets ORDER BY id').all(),
    folders: f.db.database.prepare('SELECT id,user_id,status FROM ai_folders ORDER BY id').all(),
    quota: f.db.database.prepare('SELECT user_id,used_bytes FROM user_asset_storage_usage ORDER BY user_id').all(),
    objects: [...f.objects].map(([key, bytes]) => [key, [...bytes]]),
  };
}

function callSnapshotDeletion(f, scope) {
  return scope === 'folder'
    ? lifecycle.deleteUserAiFolder({ env: f.env, userId: USER, folderId: FOLDER })
    : lifecycle.deleteAllUserAiAssets({ env: f.env, userId: USER });
}

for (const scope of ['user', 'folder']) {
  for (const initiallyEmpty of [false, true]) {
    for (const kind of ['image', 'text']) {
      test(`Q2 L01 ${scope} snapshot ${initiallyEmpty ? 'empty' : 'image present'}: new ${kind} before atomic batch aborts without releasing cleanup`, async () => {
        const f = fixture();
        try {
          prepareSnapshotScope(f, scope, initiallyEmpty);
          const batch = f.db.batch.bind(f.db);
          let injected = false;
          let afterConcurrentWrite;
          f.db.batch = async (statements) => {
            // Insert before the entire real native transaction, after both
            // source queries. No partial batch commit or SQL result is mocked.
            if (!injected && statements.some((s) => /DELETE FROM ai_images WHERE (?:folder_id|user_id) = \?/.test(s.sql))) {
              injected = true;
              insertSnapshotAsset(f, scope, kind, 'dddddddddddddddddddddddddddddddd');
              afterConcurrentWrite = snapshotAssetState(f);
              // The route restores its earlier folder 'deleting' marker on failure.
              afterConcurrentWrite.folders.forEach((row) => { row.status = 'active'; });
            }
            return batch(statements);
          };
          await expect(callSnapshotDeletion(f, scope)).rejects.toThrow();
          expect(injected).toBe(true);
          expect(snapshotAssetState(f)).toEqual(afterConcurrentWrite);
          expect(counts(f).cleanup).toBe(0);
          expect(f.db.database.prepare('SELECT COUNT(*) AS n FROM r2_object_tombstones').get().n).toBe(0);
          await scheduled(f);
          expect(snapshotAssetState(f)).toEqual(afterConcurrentWrite);
          expect(f.calls.deletes).toEqual([]);
        } finally { f.db.close(); }
      });
    }
  }

  for (const kind of ['image', 'text']) {
    test(`Q2 L01 ${scope} snapshot: equal-count ${kind} identity replacement also aborts`, async () => {
      const f = fixture();
      try {
        prepareSnapshotScope(f, scope, true);
        insertSnapshotAsset(f, scope, kind, 'dddddddddddddddddddddddddddddddd');
        const batch = f.db.batch.bind(f.db);
        let injected = false;
        let afterConcurrentWrite;
        f.db.batch = async (statements) => {
          if (!injected && statements.some((s) => /DELETE FROM ai_images WHERE (?:folder_id|user_id) = \?/.test(s.sql))) {
            injected = true;
            f.db.database.prepare(`DELETE FROM ${kind === 'image' ? 'ai_images' : 'ai_text_assets'} WHERE id = ?`)
              .run('dddddddddddddddddddddddddddddddd');
            insertSnapshotAsset(f, scope, kind, 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
            afterConcurrentWrite = snapshotAssetState(f);
            afterConcurrentWrite.folders.forEach((row) => { row.status = 'active'; });
          }
          return batch(statements);
        };
        await expect(callSnapshotDeletion(f, scope)).rejects.toThrow();
        expect(injected).toBe(true);
        expect(snapshotAssetState(f)).toEqual(afterConcurrentWrite);
        expect(counts(f).cleanup).toBe(0);
        await scheduled(f);
        expect(f.calls.deletes).toEqual([]);
        expect(snapshotAssetState(f)).toEqual(afterConcurrentWrite);
      } finally { f.db.close(); }
    });
  }

  for (const initiallyEmpty of [false, true]) {
    test(`Q2 L01 ${scope} unchanged ${initiallyEmpty ? 'empty' : 'mixed'} snapshot remains deletable`, async () => {
      const f = fixture();
      try {
        prepareSnapshotScope(f, scope, initiallyEmpty);
        if (!initiallyEmpty) insertSnapshotAsset(f, scope, 'text', 'dddddddddddddddddddddddddddddddd');
        await callSnapshotDeletion(f, scope);
        expect(counts(f)).toEqual({ sources: 0, cleanup: 0 });
        expect(f.db.database.prepare('SELECT COUNT(*) AS n FROM ai_text_assets').get().n).toBe(0);
        expect(f.db.database.prepare('SELECT COUNT(*) AS n FROM ai_folders').get().n).toBe(0);
        expect(f.objects.size).toBe(0);
        expect(f.calls.deletes.length).toBe(initiallyEmpty ? 0 : 4);
        await scheduled(f);
        expect(f.calls.deletes.length).toBe(initiallyEmpty ? 0 : 4);
      } finally { f.db.close(); }
    });
  }
}

test('Q2 L01 disappearance or generation change before source batch does not release cleanup', async () => {
  for (const mutation of ['disappear', 'change_key']) {
    const f = fixture();
    try {
      const batch = f.db.batch.bind(f.db);
      let injected = false;
      f.db.batch = async (statements) => {
        if (!injected && statements.some((s) => s.sql.includes('INSERT INTO r2_cleanup_queue'))) {
          injected = true;
          if (mutation === 'disappear') f.db.database.prepare('DELETE FROM ai_images WHERE id = ?').run(IMAGE);
          else f.db.database.prepare('UPDATE ai_images SET r2_key = ? WHERE id = ?').run(`${KEY}.new`, IMAGE);
        }
        return batch(statements);
      };
      await expect(lifecycle.deleteAllUserAiAssets({ env: f.env, userId: USER })).rejects.toThrow();
      expect(injected).toBe(true);
      expect(counts(f).cleanup).toBe(0);
      await scheduled(f);
      expect(f.calls.deletes).toEqual([]);
      expect(f.objects.size).toBe(3);
    } finally { f.db.close(); }
  }
});

test('Q2 L01 retained cross-domain reference holds cleanup; deleting that last reference can release a new intent', async () => {
  const f = fixture();
  try {
    const id = insertTextReference(f, KEY);
    await lifecycle.deleteUserAiImage({ env: f.env, userId: USER, imageId: IMAGE });
    await scheduled(f);
    expect(f.objects.has(KEY)).toBe(true);
    expect(f.calls.deletes).not.toContain(KEY);
    expect(f.db.database.prepare('SELECT status FROM r2_cleanup_queue WHERE r2_key = ?').get(KEY).status).toBe('q2_held');
    expect(f.db.database.prepare('SELECT COUNT(*) AS n FROM r2_object_tombstones WHERE r2_key = ?').get(KEY).n).toBe(0);
    await lifecycle.deleteUserAiTextAsset({ env: f.env, userId: USER, assetId: id });
    expect(f.objects.has(KEY)).toBe(false);
    expect(f.db.database.prepare('SELECT COUNT(*) AS n FROM ai_text_assets WHERE id = ?').get(id).n).toBe(0);
    expect(f.db.database.prepare('SELECT COUNT(*) AS n FROM r2_object_tombstones WHERE r2_key = ?').get(KEY).n).toBe(1);
    // The earlier held record remains evidence; it is not silently upgraded.
    expect(f.db.database.prepare('SELECT status FROM r2_cleanup_queue WHERE r2_key = ?').get(KEY).status).toBe('q2_held');
  } finally { f.db.close(); }
});

test('Q2 L01 new reference immediately before claim is retained; after claim the DB rejects re-reference', async () => {
  for (const order of ['reference_first', 'claim_first']) {
    const f = fixture();
    try {
      f.controls.failDelete = true;
      // Capture the state after the source batch but before any retirement.
      const originalBatch = f.db.batch.bind(f.db);
      let referenceAttempted = false;
      f.db.batch = async (statements) => {
        if (!referenceAttempted && order === 'reference_first' && statements.some((s) => s.sql.includes('INSERT OR IGNORE INTO r2_object_tombstones'))) {
          referenceAttempted = true;
          insertTextReference(f, KEY);
        }
        return originalBatch(statements);
      };
      if (order === 'claim_first') {
        f.controls.failDelete = false;
        f.controls.beforeDelete = async (key) => {
          if (key !== KEY) return;
          referenceAttempted = true;
          expect(() => insertTextReference(f, key)).toThrow(/r2_object_key_retired/);
        };
      }
      await lifecycle.deleteAllUserAiAssets({ env: f.env, userId: USER });
      expect(referenceAttempted).toBe(true);
      f.controls.failDelete = false;
      await scheduled(f);
      expect(f.objects.has(KEY)).toBe(order === 'reference_first');
      if (order === 'reference_first') expect(f.calls.deletes).not.toContain(KEY);
      else {
        expect(() => insertTextReference(f, KEY)).toThrow(/r2_object_key_retired/);
        expect(() => f.db.database.prepare('DELETE FROM r2_object_tombstones WHERE r2_key = ?').run(KEY)).toThrow(/retirement_is_permanent/);
      }
    } finally { f.db.close(); }
  }
});

test('Q2 L01 legacy/unmanaged intents remain held and are never adopted as deletion receipts', async () => {
  const f = fixture();
  try {
    const legacy = 'legacy/operator-object.png';
    f.objects.set(legacy, new Uint8Array(8));
    for (const [key, status] of [[KEY, 'pending'], [legacy, 'q2_pending']]) {
      f.db.database.prepare('INSERT INTO r2_cleanup_queue(r2_key,status,created_at) VALUES(?,?,?)').run(key, status, CREATED);
    }
    // An old consumer's exact pending selector cannot see Q2 or legacy-held work.
    expect(f.db.database.prepare("SELECT COUNT(*) AS n FROM r2_cleanup_queue WHERE status = 'pending' AND attempts < 5").get().n).toBe(0);
    await scheduled(f);
    expect(f.calls.deletes).toEqual([]);
    expect(f.objects.has(KEY)).toBe(true);
    expect(f.objects.has(legacy)).toBe(true);
    expect(f.db.database.prepare('SELECT status FROM r2_cleanup_queue ORDER BY id').all().map((r) => r.status)).toEqual(['legacy_held', 'q2_held']);
  } finally { f.db.close(); }
});

test('Q2 L01 claim persistence or reference-query failure cannot fall through to R2 deletion', async () => {
  for (const fault of ['claim_failure', 'reference_failure']) {
    const f = fixture();
    try {
      f.db.database.prepare('DELETE FROM ai_images').run();
      f.db.database.prepare("INSERT INTO r2_cleanup_queue(r2_key,status,created_at) VALUES(?,'q2_pending',?)").run(KEY, CREATED);
      if (fault === 'claim_failure') f.db.exec("CREATE TEMP TRIGGER q2_claim_failure BEFORE INSERT ON r2_object_tombstones BEGIN SELECT RAISE(ABORT, 'synthetic claim failure'); END;");
      else f.db.exec('DROP VIEW r2_cleanup_live_references');
      await expect(scheduled(f)).rejects.toThrow();
      expect(f.calls.deletes).toEqual([]);
      expect(f.objects.has(KEY)).toBe(true);
      expect(f.db.database.prepare('SELECT COUNT(*) AS n FROM r2_object_tombstones').get().n).toBe(0);
    } finally { f.db.close(); }
  }
});

test('Q2 L01 actual R2 failure exhaustion is durable and does not retry dead work indefinitely', async () => {
  const f = fixture();
  try {
    f.controls.failDelete = true;
    await lifecycle.deleteAllUserAiAssets({ env: f.env, userId: USER });
    for (let i = 0; i < 4; i += 1) await scheduled(f);
    expect(f.db.database.prepare('SELECT status, attempts FROM r2_cleanup_queue ORDER BY id').all())
      .toEqual(Array.from({ length: 3 }, () => ({ status: 'q2_dead', attempts: 5 })));
    const attempts = f.calls.deletes.length;
    await scheduled(f);
    expect(f.calls.deletes.length).toBe(attempts);
    expect(f.objects.size).toBe(3);
    expect(f.db.database.prepare('SELECT COUNT(*) AS n FROM r2_object_tombstones').get().n).toBe(3);
  } finally { f.db.close(); }
});

test('Q2 L01 real text writer uses create-only storage, preserves collision bytes and cannot revive retired keys', async () => {
  for (const fault of ['none', 'collision', 'retire_during_put']) {
    const f = fixture();
    try {
      f.controls.allowPut = true;
      let writtenKey;
      f.controls.beforePut = async (key) => {
        writtenKey = key;
        if (fault === 'collision') f.objects.set(key, new Uint8Array([91, 92]));
        if (fault === 'retire_during_put') {
          f.db.database.prepare("INSERT INTO r2_cleanup_queue(r2_key,status,created_at) VALUES(?,'q2_pending',?)").run(key, CREATED);
          await cleanup.processR2CleanupQueue(f.env, { keys: [key] });
        }
      };
      const promise = textAssets.saveAdminAiTextAsset(f.env, { userId: USER, title: 'Q2', sourceModule: 'text', payload: { prompt: 'Fixture', output: 'Synthetic response' } });
      if (fault === 'none') await expect(promise).resolves.toMatchObject({ source_module: 'text' });
      else await expect(promise).rejects.toThrow();
      expect(writtenKey).toBeTruthy();
      expect(f.calls.puts[0].conditional).toBe('*');
      expect(f.db.database.prepare('SELECT COUNT(*) AS n FROM ai_text_assets WHERE r2_key = ?').get(writtenKey).n).toBe(fault === 'none' ? 1 : 0);
      if (fault === 'collision') {
        expect([...f.objects.get(writtenKey)]).toEqual([91, 92]);
        expect(f.calls.deletes).not.toContain(writtenKey);
      }
      if (fault === 'retire_during_put') {
        expect(f.db.database.prepare('SELECT COUNT(*) AS n FROM r2_object_tombstones WHERE r2_key = ?').get(writtenKey).n).toBe(1);
        expect(f.objects.has(writtenKey)).toBe(false);
      }
    } finally { f.db.close(); }
  }
});

test('Q2 L01 deterministic late poster PUT cannot attach to a retired generation', async () => {
  const f = fixture();
  try {
    const id = insertTextReference(f, `${KEY}.video`);
    const poster = `users/${USER}/derivatives/v1/${id}/poster.jpg`;
    f.db.database.prepare("INSERT INTO r2_cleanup_queue(r2_key,status,created_at) VALUES(?,'q2_pending',?)").run(poster, CREATED);
    await cleanup.processR2CleanupQueue(f.env, { keys: [poster] });
    f.controls.allowPut = true;
    f.objects.set('fixture/poster-source.jpeg', new Uint8Array([255, 216, 255, 1]));
    const result = await textAssets.copyVideoPosterToAiTextAsset(f.env, { userId: USER, assetId: id, sourceKey: 'fixture/poster-source.jpeg', contentType: 'image/jpeg' });
    expect(result).toBeNull();
    expect(f.calls.puts.map((p) => p.key)).toContain(poster);
    expect(f.db.database.prepare('SELECT poster_r2_key FROM ai_text_assets WHERE id = ?').get(id).poster_r2_key).toBeNull();
    // R2 and D1 have no common transaction: these unreferenced late bytes may
    // remain for separate orphan cleanup. This test does not call that a loss
    // of a referenced object or pretend the orphan has been reclaimed.
    expect(f.objects.has(poster)).toBe(true);
  } finally { f.db.close(); }
});
