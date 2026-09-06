const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

class SqliteD1Statement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.bindings = [];
  }

  bind(...bindings) {
    const statement = new SqliteD1Statement(this.database, this.sql);
    statement.bindings = bindings;
    return statement;
  }

  _statement() {
    return this.database.prepare(this.sql);
  }

  async first() {
    return this._statement().get(...this.bindings) || null;
  }

  async all() {
    return { results: this._statement().all(...this.bindings) };
  }

  async run() {
    return this.runSync();
  }

  runSync() {
    const statement = this._statement();
    // D1 batch also returns rows for SELECT/RETURNING statements.
    const returnsRows = statement.columns().length > 0;
    const changesBefore = returnsRows
      ? this.database.prepare('SELECT total_changes() AS total').get().total
      : null;
    const results = returnsRows ? statement.all(...this.bindings) : [];
    const result = returnsRows
      ? this.database.prepare('SELECT CASE WHEN total_changes() = ? THEN 0 ELSE changes() END AS changes, last_insert_rowid() AS lastInsertRowid').get(changesBefore)
      : statement.run(...this.bindings);
    return {
      success: true,
      results,
      meta: {
        changes: Number(result.changes || 0),
        last_row_id: Number(result.lastInsertRowid || 0),
      },
    };
  }
}

class SqliteD1Database {
  constructor({ filename = ':memory:' } = {}) {
    this.database = new DatabaseSync(filename);
    this.database.exec('PRAGMA foreign_keys = ON');
  }

  prepare(sql) {
    return new SqliteD1Statement(this.database, sql);
  }

  async batch(statements) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const results = [];
      for (const statement of statements) {
        // Do not yield while a transaction is open: another caller's reads or
        // writes must never execute inside this caller's uncommitted batch.
        results.push(statement.runSync());
      }
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  exec(sql) {
    this.database.exec(sql);
  }

  close() {
    this.database.close();
  }
}

function applyAuthMigrations(database, {
  through = null,
  migrationsDirectory = path.join(process.cwd(), 'workers/auth/migrations'),
} = {}) {
  const files = fs.readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  for (const file of files) {
    database.exec(fs.readFileSync(path.join(migrationsDirectory, file), 'utf8'));
    if (through && file === through) break;
  }
  return files;
}

module.exports = {
  SqliteD1Database,
  applyAuthMigrations,
};
