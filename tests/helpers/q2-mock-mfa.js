const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const TABLES = [
  ['admin_mfa_credentials', 'adminMfaCredentials', 'admin_user_id'],
  ['admin_mfa_recovery_codes', 'adminMfaRecoveryCodes', 'id'],
  ['admin_mfa_failed_attempts', 'adminMfaFailedAttempts', 'admin_user_id'],
];
const MIGRATIONS = ['0027_add_admin_mfa.sql', '0028_add_admin_mfa_failed_attempts.sql', '0082_add_admin_mfa_mutation_guard.sql'];

function isMfaSql(query) {
  return /\badmin_mfa_(credentials|recovery_codes|failed_attempts)\b/.test(query);
}

function assertFaultPolicy(host, query) {
  if (host.failQueries.some(value => query.includes(value))) throw new Error('forced query failure');
  for (const [table] of TABLES) {
    if (host.missingTables.has(table) && query.includes(table)) throw new Error(`no such table: ${table}`);
  }
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

// This bridge is intentionally limited to MFA tables. SQL predicates, NULL
// comparisons, constraints and batches execute in native SQLite, using the
// actual migrations. Existing mutable fixture arrays remain the input/output
// contract; no crypto, route, auth or persistence success is synthesized.
function executeNativeMfa(host, entries, { batch = false } = {}) {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec('PRAGMA foreign_keys = ON; CREATE TABLE users (id TEXT PRIMARY KEY);');
    for (const migration of MIGRATIONS) {
      database.exec(fs.readFileSync(path.join(__dirname, '../../workers/auth/migrations', migration), 'utf8'));
    }
    const insertUser = database.prepare('INSERT INTO users(id) VALUES (?)');
    for (const row of host.state.users) insertUser.run(row.id);
    for (const [table, stateKey] of TABLES) {
      const columns = database.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name);
      const insert = database.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
      for (const row of host.state[stateKey]) insert.run(...columns.map(column => row[column] ?? null));
    }
    const results = [];
    database.exec('BEGIN IMMEDIATE');
    try {
      for (const { query, bindings, mode } of entries) {
        if (batch) host.runCalls.push({ query, bindings: JSON.parse(JSON.stringify(bindings)) });
        assertFaultPolicy(host, query);
        results.push(execute(database, query, bindings, mode));
      }
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
    if (entries.some(entry => entry.mode === 'run')) {
      for (const [table, stateKey, key] of TABLES) {
        const previous = new Map(host.state[stateKey].map(row => [row[key], row]));
        host.state[stateKey] = database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row => Object.assign(previous.get(row[key]) || {}, row));
      }
      host._lastChanges = results.at(-1)?.meta?.changes ?? host._lastChanges;
    }
    return batch ? results : results[0];
  } finally { database.close(); }
}

module.exports = { isMfaSql, executeNativeMfa };
