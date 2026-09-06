const { test, expect } = require('@playwright/test');
const { SqliteD1Database } = require('./helpers/sqlite-d1');

test('Q2 native D1 adapter: batches are atomic, isolated and return actual changes', async () => {
  const db = new SqliteD1Database();
  try {
    db.exec('CREATE TABLE proofs (id TEXT PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0 CHECK(used IN (0,1)))');
    await db.prepare('INSERT INTO proofs(id) VALUES (?)').bind('synthetic-proof').run();
    const pending = db.batch([
      db.prepare('UPDATE proofs SET used = 1 WHERE id = ? AND used = 0').bind('synthetic-proof'),
      db.prepare('UPDATE proofs SET used = 2 WHERE id = ?').bind('synthetic-proof'),
    ]);
    // A concurrent reader must see the rolled-back state, never the first write.
    const observed = await db.prepare('SELECT used FROM proofs').first();
    await expect(pending).rejects.toThrow(/CHECK constraint failed/);
    expect(observed.used).toBe(0);
    const results = await Promise.all([
      db.batch([db.prepare('UPDATE proofs SET used = 1 WHERE used = 0')]),
      db.batch([db.prepare('UPDATE proofs SET used = 1 WHERE used = 0')]),
    ]);
    expect(results.map((r) => r[0].meta.changes).sort()).toEqual([0, 1]);
    const rows = await db.batch([db.prepare('SELECT id, used FROM proofs')]);
    expect(rows[0].results).toEqual([{ id: 'synthetic-proof', used: 1 }]);
    expect(rows[0].meta.changes).toBe(0);
    const returning = await db.batch([db.prepare('UPDATE proofs SET used = 0 RETURNING used')]);
    expect(returning[0].results).toEqual([{ used: 0 }]);
    expect(returning[0].meta.changes).toBe(1);
  } finally {
    db.close();
  }
});
