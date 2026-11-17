-- Forward-only; no inferred consent/backfill. Audit identities survive account deletion.
CREATE TABLE minimax_consent_current (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 granted_at TEXT, revoked_at TEXT, text_version TEXT NOT NULL,
 locale TEXT NOT NULL CHECK(locale IN ('en','de')),
 source TEXT NOT NULL CHECK(source IN ('register','first_use','settings')),
 updated_at TEXT NOT NULL
);
CREATE TABLE minimax_consent_events (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('grant','revoke')),
 text_version TEXT NOT NULL, locale TEXT NOT NULL CHECK(locale IN ('en','de')),
 source TEXT NOT NULL CHECK(source IN ('register','first_use','settings')),
 created_at TEXT NOT NULL
);
CREATE INDEX minimax_consent_events_owner ON minimax_consent_events(user_id,created_at);
-- Retention metadata is separate so proof itself is never changed. Active grants
-- have no deadline. A closed cycle expires at Jan 1 following three full years.
CREATE TABLE minimax_consent_retention (
 event_id TEXT PRIMARY KEY REFERENCES minimax_consent_events(id) ON DELETE CASCADE,
 retain_until TEXT NOT NULL
);
CREATE INDEX minimax_consent_retention_due ON minimax_consent_retention(retain_until);
CREATE TRIGGER minimax_consent_events_immutable BEFORE UPDATE ON minimax_consent_events
BEGIN SELECT RAISE(ABORT,'minimax_consent_event_immutable'); END;
CREATE TRIGGER minimax_consent_events_retention BEFORE DELETE ON minimax_consent_events
WHEN NOT EXISTS (SELECT 1 FROM minimax_consent_retention WHERE event_id=OLD.id AND retain_until<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))
BEGIN SELECT RAISE(ABORT,'minimax_consent_proof_retained'); END;
CREATE TRIGGER minimax_consent_close_cycle AFTER INSERT ON minimax_consent_events WHEN NEW.action='revoke'
BEGIN
 INSERT OR IGNORE INTO minimax_consent_retention(event_id,retain_until)
 SELECT id,strftime('%Y-01-01T00:00:00.000Z',NEW.created_at,'start of year','+4 years')
 FROM minimax_consent_events WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER minimax_consent_account_delete BEFORE DELETE ON users
BEGIN
 INSERT INTO minimax_consent_events(id,user_id,action,text_version,locale,source,created_at)
 SELECT lower(hex(randomblob(16))),user_id,'revoke',text_version,locale,'settings',strftime('%Y-%m-%dT%H:%M:%fZ','now')
 FROM minimax_consent_current WHERE user_id=OLD.id AND granted_at IS NOT NULL AND revoked_at IS NULL;
 INSERT OR IGNORE INTO minimax_consent_retention(event_id,retain_until)
 SELECT id,strftime('%Y-01-01T00:00:00.000Z','now','start of year','+4 years') FROM minimax_consent_events WHERE user_id=OLD.id;
 UPDATE minimax_consent_current SET revoked_at=COALESCE(revoked_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id=OLD.id;
END;
CREATE TRIGGER minimax_consent_account_deactivate BEFORE UPDATE OF status ON users WHEN NEW.status='deleted' AND OLD.status!='deleted'
BEGIN
 INSERT INTO minimax_consent_events(id,user_id,action,text_version,locale,source,created_at)
 SELECT lower(hex(randomblob(16))),user_id,'revoke',text_version,locale,'settings',strftime('%Y-%m-%dT%H:%M:%fZ','now')
 FROM minimax_consent_current WHERE user_id=OLD.id AND granted_at IS NOT NULL AND revoked_at IS NULL;
 INSERT OR IGNORE INTO minimax_consent_retention(event_id,retain_until)
 SELECT id,strftime('%Y-01-01T00:00:00.000Z','now','start of year','+4 years') FROM minimax_consent_events WHERE user_id=OLD.id;
 UPDATE minimax_consent_current SET revoked_at=COALESCE(revoked_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id=OLD.id;
END;
