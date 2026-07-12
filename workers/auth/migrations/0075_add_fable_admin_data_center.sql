-- Domain-aware Admin management for Van Ark Fable data.
-- Original messages, provider attempts, provider blocks, fingerprints, and budget evidence
-- remain immutable. Effective transcript changes are represented by append-only revisions.

ALTER TABLE fable_chat_conversations
  ADD COLUMN admin_revision_version INTEGER NOT NULL DEFAULT 0
  CHECK (admin_revision_version >= 0);

ALTER TABLE fable_chat_conversations
  ADD COLUMN admin_revision_updated_at TEXT;

ALTER TABLE fable_chat_conversations
  ADD COLUMN admin_replay_invalidated_from_turn_order INTEGER NOT NULL DEFAULT -1
  CHECK (admin_replay_invalidated_from_turn_order >= -1);

ALTER TABLE fable_chat_turns
  ADD COLUMN admin_revision_version INTEGER NOT NULL DEFAULT 0
  CHECK (admin_revision_version >= 0);

CREATE TABLE fable_chat_admin_message_revisions (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  admin_user_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL,
  content TEXT NOT NULL,
  citations_json TEXT NOT NULL DEFAULT '[]',
  actor_admin_user_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES fable_chat_conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES fable_chat_messages(id) ON DELETE CASCADE,
  FOREIGN KEY (turn_id) REFERENCES fable_chat_turns(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_admin_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CHECK (revision_number >= 1),
  CHECK (length(content) BETWEEN 1 AND 400000),
  CHECK (length(citations_json) <= 65536),
  CHECK (length(reason) BETWEEN 3 AND 500)
);

CREATE UNIQUE INDEX idx_fable_chat_admin_message_revision_number
  ON fable_chat_admin_message_revisions(message_id, revision_number);

CREATE INDEX idx_fable_chat_admin_message_revision_current
  ON fable_chat_admin_message_revisions(
    conversation_id, admin_user_id, message_id, revision_number DESC, id DESC
  );

CREATE TABLE fable_chat_admin_turn_revisions (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  admin_user_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL,
  action TEXT NOT NULL,
  actor_admin_user_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES fable_chat_conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (turn_id) REFERENCES fable_chat_turns(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_admin_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CHECK (revision_number >= 1),
  CHECK (action IN ('delete', 'restore')),
  CHECK (length(reason) BETWEEN 3 AND 500)
);

CREATE UNIQUE INDEX idx_fable_chat_admin_turn_revision_number
  ON fable_chat_admin_turn_revisions(turn_id, revision_number);

CREATE INDEX idx_fable_chat_admin_turn_revision_current
  ON fable_chat_admin_turn_revisions(
    conversation_id, admin_user_id, turn_id, revision_number DESC, id DESC
  );

CREATE TABLE fable_chat_memory_checkpoint_invalidations (
  checkpoint_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  admin_user_id TEXT NOT NULL,
  actor_admin_user_id TEXT NOT NULL,
  invalidated_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  mutation_version INTEGER NOT NULL,
  FOREIGN KEY (checkpoint_id) REFERENCES fable_chat_memory_checkpoints(id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES fable_chat_conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_admin_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CHECK (length(reason) BETWEEN 3 AND 500),
  CHECK (mutation_version >= 1)
);

CREATE INDEX idx_fable_chat_memory_checkpoint_invalidations_owner
  ON fable_chat_memory_checkpoint_invalidations(
    conversation_id, admin_user_id, invalidated_at DESC, checkpoint_id
  );

-- This content-free claim is the durable compare-and-swap guard for Admin writes.
-- It intentionally survives conversation purge as immutable administrative evidence.
CREATE TABLE fable_chat_admin_mutation_claims (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  actor_admin_user_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  from_revision INTEGER NOT NULL,
  to_revision INTEGER NOT NULL,
  invalidated_from_turn_order INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (actor_admin_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CHECK (length(operation) BETWEEN 3 AND 80),
  CHECK (from_revision >= 0),
  CHECK (to_revision = from_revision + 1),
  CHECK (invalidated_from_turn_order IS NULL OR invalidated_from_turn_order >= 0)
);

CREATE UNIQUE INDEX idx_fable_chat_admin_mutation_claim_once
  ON fable_chat_admin_mutation_claims(conversation_id, from_revision);

CREATE INDEX idx_fable_chat_admin_mutation_claim_conversation
  ON fable_chat_admin_mutation_claims(conversation_id, created_at DESC, id DESC);

CREATE INDEX idx_fable_chat_admin_mutation_claim_replay
  ON fable_chat_admin_mutation_claims(
    conversation_id, invalidated_from_turn_order, to_revision
  ) WHERE invalidated_from_turn_order IS NOT NULL;

CREATE TABLE fable_chat_admin_write_receipts (
  id TEXT PRIMARY KEY,
  actor_admin_user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  idempotency_key_hash TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  result_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (actor_admin_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CHECK (length(operation) BETWEEN 3 AND 80),
  CHECK (length(idempotency_key_hash) = 64),
  CHECK (length(request_fingerprint) = 64),
  CHECK (length(result_json) <= 16384)
);

CREATE UNIQUE INDEX idx_fable_chat_admin_write_receipt_once
  ON fable_chat_admin_write_receipts(actor_admin_user_id, operation, idempotency_key_hash);

CREATE INDEX idx_fable_chat_admin_write_receipt_conversation
  ON fable_chat_admin_write_receipts(conversation_id, created_at DESC, id DESC);

CREATE INDEX idx_fable_chat_conversations_admin_data_center
  ON fable_chat_conversations(deleted_at, updated_at DESC, id DESC);
