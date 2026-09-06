const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// Only the columns consumed by snapshot guards and the actual 0083 reference
// view are projected. These are NOT replacements for the source-table schema
// or its writer constraints; q2-lifecycle.spec.js covers the complete schema.
const REFERENCES = [
  ['ai_images', 'aiImages', 'id,user_id,folder_id,r2_key,thumb_key,medium_key'],
  ['ai_text_assets', 'aiTextAssets', 'id,user_id,folder_id,r2_key,poster_r2_key'],
  ['ai_video_jobs_v2', 'aiVideoJobs', 'output_r2_key,poster_r2_key'],
  ['homepage_hero_video_uploads', 'homepageHeroVideoUploads', 'r2_key'],
  ['homepage_hero_video_derivatives', 'homepageHeroVideoDerivatives', 'file_r2_key,poster_r2_key,source_r2_key,status'],
  ['memvid_stream_previews', 'memvidStreamPreviews', 'source_r2_key'],
  ['fable_chat_attachments', 'fableChatAttachments', 'r2_key,deleted_at,state'],
  ['news_pulse_items', 'newsPulseItems', 'visual_object_key'],
  ['data_export_archives', 'dataExportArchives', 'r2_key,r2_bucket'],
  ['platform_budget_evidence_archives', 'platformBudgetEvidenceArchives', 'storage_key,storage_bucket,deleted_at'],
];

function isLifecycleSql(query) {
  if (/\br2_(cleanup_queue|object_tombstones|cleanup_live_references)\b/.test(query)) return true;
  return query.startsWith('SELECT CASE WHEN') && query.includes("json_extract('[]', '$[')")
    && /\bFROM (ai_images|ai_text_assets)\b/.test(query) && !/\bid IN \(/.test(query);
}

function execute(database, query, bindings, mode) {
  const statement = database.prepare(query);
  if (mode === 'first') return statement.get(...bindings) || null;
  if (mode === 'all') return { results: statement.all(...bindings) };
  const returnsRows = statement.columns().length > 0;
  const before = returnsRows ? database.prepare('SELECT total_changes() AS n').get().n : null;
  const results = returnsRows ? statement.all(...bindings) : [];
  const result = returnsRows
    ? database.prepare('SELECT CASE WHEN total_changes() = ? THEN 0 ELSE changes() END AS changes, last_insert_rowid() AS lastInsertRowid').get(before)
    : statement.run(...bindings);
  return { success: true, results, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
}

function seed(database, host) {
  for (const [table, stateKey, columnList] of REFERENCES) {
    const columns = columnList.split(',');
    database.exec(`CREATE TABLE ${table} (${columns.map(column => `${column} TEXT`).join(',')})`);
    const insert = database.prepare(`INSERT INTO ${table} VALUES (${columns.map(() => '?').join(',')})`);
    for (const row of host.state[stateKey] || []) insert.run(...columns.map(column => row[column] ?? null));
  }
  const migrations = path.join(__dirname, '../../workers/auth/migrations');
  database.exec(fs.readFileSync(path.join(migrations, '0010_add_r2_cleanup_queue.sql'), 'utf8'));
  const insertQueue = database.prepare('INSERT INTO r2_cleanup_queue(id,r2_key,status,created_at,attempts,last_attempt_at) VALUES(?,?,?,?,?,?)');
  for (const row of host.state.r2CleanupQueue) {
    insertQueue.run(row.id, row.r2_key, row.status ?? 'pending', row.created_at, row.attempts ?? 0, row.last_attempt_at ?? null);
  }
  // Retain AUTOINCREMENT identity after the previous last queue row was deleted.
  database.prepare("INSERT INTO sqlite_sequence(name,seq) SELECT 'r2_cleanup_queue',0 WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name='r2_cleanup_queue')").run();
  database.prepare("UPDATE sqlite_sequence SET seq=MAX(seq,?) WHERE name='r2_cleanup_queue'").run(host._cleanupSeq - 1);
  database.exec(fs.readFileSync(path.join(migrations, '0083_add_r2_cleanup_reference_fence.sql'), 'utf8'));
  const insertTombstone = database.prepare('INSERT INTO r2_object_tombstones(r2_key,retired_at) VALUES(?,?)');
  for (const row of host.state.r2ObjectTombstones) insertTombstone.run(row.r2_key, row.retired_at);
  // Mutable fixtures must not silently introduce a state forbidden by 0083.
  if (database.prepare('SELECT 1 FROM r2_object_tombstones t JOIN r2_cleanup_live_references r ON r.r2_key=t.r2_key LIMIT 1').get()) {
    throw new Error('r2_object_key_retired: fixture contains a live reference to a retired key');
  }
  const tableNames = new Set([...REFERENCES.map(([table]) => table), 'r2_cleanup_queue', 'r2_object_tombstones']);
  for (const name of host.missingTables) {
    const table = name === 'ai_video_jobs' ? 'ai_video_jobs_v2' : name;
    if (tableNames.has(table)) database.exec(`DROP TABLE ${table}`);
    if (table === 'r2_cleanup_live_references') database.exec('DROP VIEW r2_cleanup_live_references');
  }
}

// Pure cleanup claim batches execute without yielding in one native transaction.
// Mixed source/account batches retain MockD1's state snapshot/rollback semantics;
// this bridge does not turn those legacy mocks into native persistence evidence.
function executeNativeLifecycle(host, entries, { batch = false } = {}) {
  const database = new DatabaseSync(':memory:');
  try {
    seed(database, host);
    const results = [];
    database.exec('BEGIN IMMEDIATE');
    try {
      for (const { query, bindings, mode } of entries) {
        if (!isLifecycleSql(query)) throw new Error('Unsupported lifecycle bridge query');
        if (batch) host.runCalls.push({ query, bindings: JSON.parse(JSON.stringify(bindings)) });
        if (host.failQueries.some(value => query.includes(value))) throw new Error('forced query failure');
        results.push(execute(database, query, bindings, mode));
      }
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
    // Legacy pending fixtures are migrated to held, never upgraded to Q2 work.
    if (!host.missingTables.has('r2_cleanup_queue')) {
      const previous = new Map(host.state.r2CleanupQueue.map(row => [row.id, row]));
      host.state.r2CleanupQueue = database.prepare('SELECT * FROM r2_cleanup_queue ORDER BY id').all()
        .map(row => Object.assign(previous.get(row.id) || {}, row));
      host._cleanupSeq = Number(database.prepare("SELECT seq FROM sqlite_sequence WHERE name='r2_cleanup_queue'").get().seq) + 1;
    }
    if (!host.missingTables.has('r2_object_tombstones')) {
      host.state.r2ObjectTombstones = database.prepare('SELECT * FROM r2_object_tombstones ORDER BY rowid').all();
    }
    host._lastChanges = results.at(-1)?.meta?.changes ?? host._lastChanges;
    return batch ? results : results[0];
  } finally { database.close(); }
}

module.exports = { isLifecycleSql, executeNativeLifecycle };
