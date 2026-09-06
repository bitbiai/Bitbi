import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { referenceView, splitSql, sha256 } from './helpers/q2-runtime/sql.mjs';

// This deliberately minimal reference schema isolates relation semantics.
// q2-runtime-native.mjs separately validates actual migrations, FKs and triggers.
export async function runReferenceTests(f) {
  const { db, migrations, test, executionDir, counters } = f;
  const graph = JSON.parse(fs.readFileSync(new URL('./helpers/q2-runtime/reference-fixtures.json', import.meta.url), 'utf8'));
  const historical = JSON.parse(fs.readFileSync(new URL('./helpers/q2-runtime/historical-fixture.json', import.meta.url), 'utf8'));
  const frozen = fs.readFileSync(new URL('./helpers/q2-runtime/' + historical.fixture, import.meta.url), 'utf8');
  assert.equal(sha256(frozen), historical.sha256);
  assert.equal(graph.original_arm_sql.length, 16); assert.equal(graph.setup.fixture_rows.length, 50);
  const current = migrations.find(row => row.path.startsWith('0083_'));
  const view = referenceView(current.source);
  const indexes = splitSql(current.source).statements.filter(sql => /CREATE INDEX idx_r2_l01_/.test(sql));
  const native = async (sql, binds = []) => db.prepare(sql).bind(...binds).all();
  const plain = new DatabaseSync(path.join(executionDir, 'historical-oracle.sqlite'));
  try {
    for (const sql of [...graph.setup.tables, ...indexes, 'CREATE TABLE q2_perf_candidates(id INTEGER PRIMARY KEY,r2_key TEXT NOT NULL)']) {
      await db.prepare(sql).run(); plain.exec(sql);
    }
    await db.batch(graph.setup.inserts.map(row => db.prepare(row.sql).bind(...row.binds)));
    for (const row of graph.setup.inserts) plain.prepare(row.sql).run(...row.binds);
    const candidates = Array.from({ length: 50 }, (_, i) => i < 10 ? 'users/q2-view/arm-16' : `users/q2-view/missing-${i}`);
    await db.batch(candidates.map((key, i) => db.prepare('INSERT INTO q2_perf_candidates VALUES (?,?)').bind(i, key)));
    for (const [i, key] of candidates.entries()) plain.prepare('INSERT INTO q2_perf_candidates VALUES (?,?)').run(i, key);
    plain.exec(referenceView(frozen));
    await db.prepare(view).run();
    const sorted = rows => rows.map(row => row.r2_key).sort();
    const expected = graph.setup.fixture_rows.flatMap(row => row.expected_references);
    const direct = 'SELECT COUNT(*) AS n FROM q2_perf_candidates q WHERE NOT (' + graph.original_arm_sql.map(arm => `EXISTS (SELECT 1 FROM (${arm}) d WHERE d.r2_key=q.r2_key)`).join(' OR ') + ')';
    const correlated = 'SELECT COUNT(*) AS n FROM q2_perf_candidates q WHERE NOT EXISTS (SELECT 1 FROM r2_cleanup_live_references r WHERE r.r2_key=q.r2_key)';
    let previousScale = 0;
    for (const scale of [0, 1000, 5000]) {
      await test(`reference_view_all_16_arms_predicates_and_indexed_50_candidates_scale_${scale}`, async () => {
        for (let start = previousScale; start < scale; start += 50) {
          const batch = Array.from({ length: Math.min(50, scale - start) }, (_, i) => ({ id: `scale-${start + i}`, key: `users/q2-view/scale-${String(start + i).padStart(5, '0')}` }));
          await db.batch(batch.map(row => db.prepare('INSERT INTO ai_images(fixture_id,r2_key) VALUES (?,?)').bind(row.id, row.key)));
          for (const row of batch) { plain.prepare('INSERT INTO ai_images(fixture_id,r2_key) VALUES (?,?)').run(row.id, row.key); expected.push(row.key); }
        }
        previousScale = scale;
        const bag = [...expected].sort(), independent = [];
        assert.deepEqual(sorted(plain.prepare('SELECT r2_key FROM r2_cleanup_live_references').all()), bag);
        for (const arm of graph.original_arm_sql) independent.push(...(await native(arm)).results);
        assert.deepEqual(sorted(independent), bag, '16 separately executed historical arms must match explicit fixture expectations');
        assert.deepEqual(sorted((await native('SELECT r2_key FROM r2_cleanup_live_references')).results), bag);
        for (let n = 1; n <= 16; n += 1) {
          const key = `users/q2-view/arm-${String(n).padStart(2, '0')}`;
          assert.equal((await native('SELECT COUNT(*) AS n FROM r2_cleanup_live_references WHERE r2_key=?', [key])).results[0].n, 1, `Reference arm ${n}`);
        }
        for (const [predicate, bindings, count] of [
          ['r2_key=?', ['users/q2-view/duplicate'], 16], ['r2_key IS NULL', [], 0], ['r2_key=?', [''], 1],
          ['r2_key LIKE ?', ['users/q2-view/excluded-%'], 0],
        ]) assert.equal((await native(`SELECT COUNT(*) AS n FROM r2_cleanup_live_references WHERE ${predicate}`, bindings)).results[0].n, count);
        for (const [key, present] of [['users/q2-view/arm-16', 1], ['users/q2-view/never-referenced', 0]]) {
          assert.equal((await native('SELECT EXISTS(SELECT 1 FROM r2_cleanup_live_references WHERE r2_key=?) AS present', [key])).results[0].present, present);
          assert.equal((await native('SELECT r2_key FROM r2_cleanup_live_references WHERE r2_key=? LIMIT 1', [key])).results.length, present);
        }
        const control = await native(direct), measured = await native(correlated);
        assert.equal(control.results[0].n, 40); assert.equal(measured.results[0].n, 40);
        assert.equal(typeof measured.meta.rows_read, 'number'); assert.equal(typeof control.meta.rows_read, 'number');
        assert.ok(measured.meta.rows_read <= control.meta.rows_read, 'Reference view must preserve the indexed direct-EXISTS read bound at each scale');
        f.metrics.push({ scale, candidates: 50, referenceRows: bag.length, rowsRead: measured.meta.rows_read, directRowsRead: control.meta.rows_read });
        assert.equal(counters.outboundDenied, 0);
      });
    }
  } finally { plain.close(); }
}
