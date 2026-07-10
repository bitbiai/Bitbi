-- Advanced private Fable chat settings, context accounting, and provider continuity.
-- Additive only. Existing transcript content and lifecycle state remain unchanged.

ALTER TABLE fable_chat_conversations
  ADD COLUMN effort TEXT NOT NULL DEFAULT 'high'
  CHECK (effort IN ('medium', 'high', 'xhigh', 'max'));

ALTER TABLE fable_chat_conversations
  ADD COLUMN system_preset_id TEXT NOT NULL DEFAULT 'general'
  CHECK (system_preset_id IN ('general', 'coding', 'creative', 'precise'));

ALTER TABLE fable_chat_conversations
  ADD COLUMN system_preset_version INTEGER NOT NULL DEFAULT 1
  CHECK (system_preset_version >= 1);

ALTER TABLE fable_chat_conversations
  ADD COLUMN thinking_display TEXT NOT NULL DEFAULT 'omitted'
  CHECK (thinking_display IN ('omitted', 'summarized'));

ALTER TABLE fable_chat_conversations
  ADD COLUMN prompt_cache_policy TEXT NOT NULL DEFAULT 'auto_5m'
  CHECK (prompt_cache_policy = 'auto_5m');

ALTER TABLE fable_chat_conversations
  ADD COLUMN prompt_cache_version INTEGER NOT NULL DEFAULT 1
  CHECK (prompt_cache_version >= 1);

ALTER TABLE fable_chat_conversations
  ADD COLUMN settings_updated_at TEXT;

ALTER TABLE fable_chat_messages
  ADD COLUMN reasoning_summary TEXT;

ALTER TABLE fable_chat_turns
  ADD COLUMN effort TEXT NOT NULL DEFAULT 'high'
  CHECK (effort IN ('medium', 'high', 'xhigh', 'max'));

ALTER TABLE fable_chat_turns
  ADD COLUMN effective_max_output_tokens INTEGER NOT NULL DEFAULT 16384
  CHECK (effective_max_output_tokens IN (8192, 16384, 32768));

ALTER TABLE fable_chat_turns
  ADD COLUMN system_preset_id TEXT NOT NULL DEFAULT 'general'
  CHECK (system_preset_id IN ('general', 'coding', 'creative', 'precise'));

ALTER TABLE fable_chat_turns
  ADD COLUMN system_preset_version INTEGER NOT NULL DEFAULT 1
  CHECK (system_preset_version >= 1);

ALTER TABLE fable_chat_turns
  ADD COLUMN thinking_display TEXT NOT NULL DEFAULT 'omitted'
  CHECK (thinking_display IN ('omitted', 'summarized'));

ALTER TABLE fable_chat_turns
  ADD COLUMN prompt_cache_policy TEXT NOT NULL DEFAULT 'auto_5m'
  CHECK (prompt_cache_policy = 'auto_5m');

ALTER TABLE fable_chat_turns
  ADD COLUMN prompt_cache_version INTEGER NOT NULL DEFAULT 1
  CHECK (prompt_cache_version >= 1);

ALTER TABLE fable_chat_turns
  ADD COLUMN context_format_version TEXT NOT NULL DEFAULT 'native-anthropic-turns-v2';

ALTER TABLE fable_chat_turns
  ADD COLUMN estimated_input_tokens INTEGER NOT NULL DEFAULT 0
  CHECK (estimated_input_tokens >= 0);

ALTER TABLE fable_chat_turns
  ADD COLUMN effective_input_token_limit INTEGER NOT NULL DEFAULT 96000
  CHECK (effective_input_token_limit > 0);

ALTER TABLE fable_chat_turns
  ADD COLUMN context_estimator_version TEXT NOT NULL DEFAULT 'utf8-conservative-v1';

ALTER TABLE fable_chat_turns
  ADD COLUMN cache_breakpoint_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE fable_chat_turns
  ADD COLUMN settings_snapshot_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE fable_chat_turns
  ADD COLUMN provider_duration_ms INTEGER
  CHECK (provider_duration_ms IS NULL OR provider_duration_ms >= 0);

ALTER TABLE fable_chat_turns
  ADD COLUMN output_truncated INTEGER NOT NULL DEFAULT 0
  CHECK (output_truncated IN (0, 1));

CREATE TABLE fable_chat_provider_messages (
  message_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  admin_user_id TEXT NOT NULL,
  model_id TEXT NOT NULL DEFAULT 'anthropic/claude-fable-5',
  content_blocks_json TEXT NOT NULL,
  serialized_bytes INTEGER NOT NULL,
  format_version TEXT NOT NULL DEFAULT 'anthropic-content-v1',
  created_at TEXT NOT NULL,
  FOREIGN KEY (message_id) REFERENCES fable_chat_messages(id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES fable_chat_conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (model_id = 'anthropic/claude-fable-5'),
  CHECK (serialized_bytes > 0)
);

CREATE INDEX idx_fable_chat_provider_messages_owner
  ON fable_chat_provider_messages(conversation_id, admin_user_id, message_id);

CREATE INDEX idx_fable_chat_turns_owner_settings
  ON fable_chat_turns(conversation_id, admin_user_id, effort, system_preset_id, created_at DESC);
