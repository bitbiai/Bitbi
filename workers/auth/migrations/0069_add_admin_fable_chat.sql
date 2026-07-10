-- Private platform-admin Fable chat conversations, transcript messages, and durable send attempts.
-- Additive only. Raw idempotency keys are never stored.

CREATE TABLE fable_chat_conversations (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL,
  model_id TEXT NOT NULL DEFAULT 'anthropic/claude-fable-5',
  title TEXT NOT NULL,
  title_source TEXT NOT NULL DEFAULT 'automatic',
  turn_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (model_id = 'anthropic/claude-fable-5'),
  CHECK (title_source IN ('automatic', 'manual')),
  CHECK (turn_count >= 0)
);

CREATE INDEX idx_fable_chat_conversations_admin_updated
  ON fable_chat_conversations(admin_user_id, deleted_at, updated_at DESC, id DESC);

-- Messages are the logical transcript. A logical message group remains stable when a
-- failed provider attempt is retried, while fable_chat_turns records each provider attempt.
CREATE TABLE fable_chat_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  message_group_id TEXT NOT NULL,
  admin_user_id TEXT NOT NULL,
  turn_order INTEGER NOT NULL,
  role TEXT NOT NULL,
  role_order INTEGER NOT NULL,
  content TEXT NOT NULL,
  state TEXT NOT NULL,
  model_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES fable_chat_conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (turn_order >= 0),
  CHECK (role IN ('user', 'assistant')),
  CHECK (role_order IN (0, 1)),
  CHECK (state IN ('pending', 'succeeded', 'failed', 'unknown')),
  CHECK (
    (role = 'user' AND role_order = 0 AND model_id IS NULL) OR
    (role = 'assistant' AND role_order = 1 AND model_id = 'anthropic/claude-fable-5')
  )
);

CREATE UNIQUE INDEX idx_fable_chat_messages_group_role
  ON fable_chat_messages(message_group_id, role);

CREATE UNIQUE INDEX idx_fable_chat_messages_conversation_order_role
  ON fable_chat_messages(conversation_id, turn_order, role);

CREATE INDEX idx_fable_chat_messages_conversation_turn
  ON fable_chat_messages(conversation_id, admin_user_id, turn_order, role_order, id);

CREATE TABLE fable_chat_turns (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  admin_user_id TEXT NOT NULL,
  idempotency_key_hash TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  user_message_id TEXT NOT NULL,
  assistant_message_id TEXT,
  retry_of_turn_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  model_id TEXT NOT NULL DEFAULT 'anthropic/claude-fable-5',
  context_included_turns INTEGER NOT NULL DEFAULT 0,
  context_omitted_turns INTEGER NOT NULL DEFAULT 0,
  context_character_count INTEGER NOT NULL DEFAULT 0,
  provider_model TEXT,
  stop_reason TEXT,
  stop_sequence TEXT,
  usage_json TEXT NOT NULL DEFAULT '{}',
  gateway_metadata_json TEXT NOT NULL DEFAULT '{}',
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES fable_chat_conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (user_message_id) REFERENCES fable_chat_messages(id) ON DELETE CASCADE,
  FOREIGN KEY (assistant_message_id) REFERENCES fable_chat_messages(id) ON DELETE SET NULL,
  FOREIGN KEY (retry_of_turn_id) REFERENCES fable_chat_turns(id) ON DELETE SET NULL,
  CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'unknown')),
  CHECK (model_id = 'anthropic/claude-fable-5'),
  CHECK (context_included_turns >= 0),
  CHECK (context_omitted_turns >= 0),
  CHECK (context_character_count >= 0),
  CHECK (retry_of_turn_id IS NULL OR retry_of_turn_id <> id)
);

CREATE UNIQUE INDEX idx_fable_chat_turns_conversation_idempotency
  ON fable_chat_turns(conversation_id, idempotency_key_hash);

CREATE UNIQUE INDEX idx_fable_chat_turns_active_user_message
  ON fable_chat_turns(user_message_id)
  WHERE status IN ('pending', 'running');

CREATE UNIQUE INDEX idx_fable_chat_turns_active_conversation
  ON fable_chat_turns(conversation_id)
  WHERE status IN ('pending', 'running');

CREATE INDEX idx_fable_chat_turns_conversation_created
  ON fable_chat_turns(conversation_id, admin_user_id, created_at DESC, id DESC);

CREATE INDEX idx_fable_chat_turns_active_expiry
  ON fable_chat_turns(status, expires_at)
  WHERE status IN ('pending', 'running');
