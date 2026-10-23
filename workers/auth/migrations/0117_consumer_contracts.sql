-- Forward-only declaration intake, immutable contract evidence and transactional mail.
-- No historical consent is inferred and no existing credits/subscriptions are changed.
CREATE TABLE consumer_contract_snapshots (
  checkout_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, checkout_scope TEXT NOT NULL,
  terms_version TEXT NOT NULL, locale TEXT NOT NULL CHECK(locale IN ('en','de')),
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)), snapshot_hash TEXT NOT NULL,
  accepted_at TEXT NOT NULL
);
CREATE INDEX consumer_contract_snapshots_owner ON consumer_contract_snapshots(user_id,accepted_at);
CREATE TABLE consumer_contract_confirmations (
  checkout_id TEXT PRIMARY KEY REFERENCES consumer_contract_snapshots(checkout_id),
  provider_session_id TEXT UNIQUE NOT NULL, provider_event_id TEXT NOT NULL,
  document_json TEXT NOT NULL CHECK(json_valid(document_json)), document_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TRIGGER consumer_contract_snapshots_immutable BEFORE UPDATE ON consumer_contract_snapshots
BEGIN SELECT RAISE(ABORT,'consumer_contract_snapshot_immutable'); END;
CREATE TRIGGER consumer_contract_confirmations_immutable BEFORE UPDATE ON consumer_contract_confirmations
BEGIN SELECT RAISE(ABORT,'consumer_contract_confirmation_immutable'); END;
CREATE TABLE transactional_messages (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL, kind TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), payload_hash TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','sending','accepted','delivered','bounced','review_required')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 5),
  first_attempt_at TEXT, next_attempt_at TEXT, lease_token TEXT, lease_expires_at TEXT,
  provider_message_id TEXT, accepted_at TEXT, delivered_at TEXT, last_checked_at TEXT,
  error_code TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX transactional_messages_pending ON transactional_messages(state,next_attempt_at);
CREATE INDEX transactional_messages_source ON transactional_messages(source_id,kind);
CREATE TRIGGER transactional_messages_payload_immutable BEFORE UPDATE OF id,source_id,kind,payload_json,payload_hash,created_at ON transactional_messages
WHEN NEW.id IS NOT OLD.id OR NEW.source_id IS NOT OLD.source_id OR NEW.kind IS NOT OLD.kind
  OR NEW.payload_json IS NOT OLD.payload_json OR NEW.payload_hash IS NOT OLD.payload_hash OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT,'transactional_message_payload_immutable'); END;
CREATE TABLE consumer_declarations (
  id TEXT PRIMARY KEY, request_hash TEXT UNIQUE NOT NULL, input_hash TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('withdrawal','cancellation')),
  locale TEXT NOT NULL CHECK(locale IN ('en','de')), user_id TEXT,
  name TEXT NOT NULL, email TEXT NOT NULL, contract_reference TEXT NOT NULL,
  declaration_json TEXT NOT NULL CHECK(json_valid(declaration_json)),
  receipt_text TEXT NOT NULL, received_at TEXT NOT NULL, review_due_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'received' CHECK(state IN ('received','in_review','closed')),
  revision INTEGER NOT NULL DEFAULT 0, reviewed_by TEXT, reviewed_at TEXT, review_note TEXT,
  verified_user_id TEXT, provider_state TEXT NOT NULL DEFAULT 'not_requested',
  provider_result_json TEXT, updated_at TEXT NOT NULL
);
CREATE INDEX consumer_declarations_review ON consumer_declarations(state,review_due_at,id);
CREATE INDEX consumer_declarations_owner ON consumer_declarations(user_id,received_at);
CREATE TRIGGER consumer_declarations_evidence_immutable BEFORE UPDATE OF id,request_hash,input_hash,kind,locale,user_id,name,email,contract_reference,declaration_json,receipt_text,received_at,review_due_at ON consumer_declarations
BEGIN SELECT RAISE(ABORT,'consumer_declaration_evidence_immutable'); END;
CREATE TABLE consumer_declaration_reviews (
  id TEXT PRIMARY KEY, declaration_id TEXT NOT NULL REFERENCES consumer_declarations(id),
  actor_id TEXT NOT NULL, expected_revision INTEGER NOT NULL, action TEXT NOT NULL,
  input_hash TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(declaration_id,expected_revision)
);
