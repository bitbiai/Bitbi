const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { SqliteD1Database, applyAuthMigrations } = require('./helpers/sqlite-d1');

const source = name => fs.readFileSync(path.join(__dirname, '../workers/auth/migrations', name), 'utf8');
const Q2 = '0083_add_r2_cleanup_reference_fence.sql';
function populatedBaseline() {
  const db = new SqliteD1Database();
  applyAuthMigrations(db, { through: '0082_add_admin_mfa_mutation_guard.sql' });
  db.exec(`INSERT INTO users(id,email,password_hash,created_at) VALUES ('q2-schema-user','schema@example.invalid','unused','2026-09-06');
    INSERT INTO ai_images(id,user_id,r2_key,prompt,model,size_bytes,created_at)
      VALUES ('q2-schema-image','q2-schema-user','users/q2-schema-user/original.png','Synthetic','fixture',64,'2026-09-06');
    INSERT INTO r2_cleanup_queue(r2_key,status,created_at) VALUES ('users/q2-schema-user/original.png','pending','2026-09-06');
    INSERT INTO admin_mfa_credentials(admin_user_id,last_accepted_timestep,created_at,updated_at,mutation_token)
      VALUES ('q2-schema-user',42,'2026-09-06','2026-09-06','persisted-marker');
    INSERT INTO admin_mfa_recovery_codes(id,admin_user_id,code_hash,created_at,used_at)
      VALUES ('q2-schema-consumed','q2-schema-user','synthetic-consumed-hash','2026-09-06','2026-09-06');`);
  return db;
}
function migrateAtomically(db) {
  db.exec('BEGIN IMMEDIATE');
  try { db.exec(source(Q2)); db.exec('COMMIT'); }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

test('Q2 0083 populated forward migration preserves sources/MFA, holds legacy receipts and retains 0081 writer fences', () => {
  const db = populatedBaseline();
  try {
    const image = db.database.prepare('SELECT * FROM ai_images').get();
    const mfa = db.database.prepare('SELECT * FROM admin_mfa_credentials').get();
    const used = db.database.prepare('SELECT * FROM admin_mfa_recovery_codes').get();
    migrateAtomically(db);
    expect(db.database.prepare('SELECT * FROM ai_images').get()).toEqual(image);
    expect(db.database.prepare('SELECT * FROM admin_mfa_credentials').get()).toEqual(mfa);
    expect(db.database.prepare('SELECT * FROM admin_mfa_recovery_codes').get()).toEqual(used);
    expect(db.database.prepare('SELECT status FROM r2_cleanup_queue').get().status).toBe('legacy_held');
    db.exec("INSERT INTO r2_cleanup_queue(r2_key,status,created_at) VALUES ('users/q2-schema-user/late.png','pending','2026-09-06')");
    expect(db.database.prepare("SELECT COUNT(*) AS n FROM r2_cleanup_queue WHERE status = 'pending'").get().n).toBe(0);
    expect(db.database.prepare('SELECT COUNT(*) AS n FROM r2_object_tombstones').get().n).toBe(0);
    for (const table of ['ai_usage_attempts','member_ai_usage_attempts','admin_ai_usage_attempts','ai_video_jobs']) {
      expect(() => db.exec(`UPDATE ${table} SET status = status WHERE 0`)).toThrow();
    }
    expect(db.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});

test('Q2 0083 late DDL failure rolls back the complete migration including legacy queue transition', () => {
  const db = populatedBaseline();
  try {
    // Collision at the final unchanged migration statement, not a modified
    // migration or disabled constraint. This simulates unexpected schema drift.
    db.exec('CREATE TRIGGER r2_l01_10_update AFTER UPDATE ON users BEGIN SELECT 1; END');
    const before = db.database.prepare('SELECT * FROM r2_cleanup_queue').all();
    expect(() => migrateAtomically(db)).toThrow(/already exists/);
    expect(db.database.prepare('SELECT * FROM r2_cleanup_queue').all()).toEqual(before);
    expect(db.database.prepare("SELECT name FROM sqlite_master WHERE name = 'r2_object_tombstones'").get()).toBeUndefined();
    expect(db.database.prepare('SELECT COUNT(*) AS n FROM ai_images').get().n).toBe(1);
    expect(db.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});

test('Q2 0082 preserves populated MFA credentials and already consumed proofs while adding a nullable mutation marker', () => {
  const db = new SqliteD1Database();
  try {
    applyAuthMigrations(db, { through: '0081_add_ai_dispatch_outcome_guards.sql' });
    db.exec(`INSERT INTO users(id,email,password_hash,created_at) VALUES ('q2-mfa-migration','migration@example.invalid','unused','2026-09-06');
      INSERT INTO admin_mfa_credentials(admin_user_id,secret_ciphertext,secret_iv,enabled_at,last_accepted_timestep,created_at,updated_at)
      VALUES ('q2-mfa-migration','synthetic-existing-ciphertext','synthetic-existing-iv','2026-09-06',42,'2026-09-06','2026-09-06');
      INSERT INTO admin_mfa_recovery_codes(id,admin_user_id,code_hash,created_at,used_at)
      VALUES ('q2-mfa-migration-used','q2-mfa-migration','synthetic-used-hash','2026-09-06','2026-09-06');`);
    const before = db.database.prepare('SELECT * FROM admin_mfa_credentials').get();
    const consumed = db.database.prepare('SELECT * FROM admin_mfa_recovery_codes').all();
    db.exec(source('0082_add_admin_mfa_mutation_guard.sql'));
    expect(db.database.prepare('SELECT * FROM admin_mfa_credentials').get()).toEqual({ ...before, mutation_token: null });
    expect(db.database.prepare('SELECT * FROM admin_mfa_recovery_codes').all()).toEqual(consumed);
    expect(db.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});
