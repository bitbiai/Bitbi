-- Durable, private Standard/Lite rolling-memory checkpoints for administrator Fable chat.
-- Additive only. Existing conversations default to Standard and retain their full transcript.

ALTER TABLE fable_chat_conversations
  ADD COLUMN memory_mode TEXT NOT NULL DEFAULT 'standard'
  CHECK (memory_mode IN ('standard', 'lite'));

ALTER TABLE fable_chat_turns
  ADD COLUMN memory_mode TEXT NOT NULL DEFAULT 'standard'
  CHECK (memory_mode IN ('standard', 'lite'));

ALTER TABLE fable_chat_turns
  ADD COLUMN memory_contract_version INTEGER NOT NULL DEFAULT 1
  CHECK (memory_contract_version >= 1);

ALTER TABLE fable_chat_turns
  ADD COLUMN memory_checkpoint_id TEXT;

ALTER TABLE fable_chat_turns
  ADD COLUMN memory_checkpoint_version INTEGER NOT NULL DEFAULT 0
  CHECK (memory_checkpoint_version >= 0);

ALTER TABLE fable_chat_turns
  ADD COLUMN memory_coverage_turn_order INTEGER NOT NULL DEFAULT -1
  CHECK (memory_coverage_turn_order >= -1);

CREATE TABLE fable_chat_memory_checkpoints (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  admin_user_id TEXT NOT NULL,
  profile TEXT NOT NULL,
  summary_version INTEGER NOT NULL,
  summarizer_model_id TEXT NOT NULL DEFAULT '@cf/qwen/qwen3-30b-a3b-fp8',
  summarizer_prompt_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending',
  base_checkpoint_id TEXT,
  source_base_profile TEXT,
  source_base_checkpoint_id TEXT,
  hidden_summary_content TEXT,
  estimated_summary_tokens INTEGER,
  coverage_turn_order INTEGER NOT NULL DEFAULT -1,
  coverage_through_turn_id TEXT,
  coverage_through_message_id TEXT,
  source_start_turn_id TEXT,
  source_end_turn_id TEXT,
  source_start_turn_order INTEGER,
  source_end_turn_order INTEGER,
  source_turn_count INTEGER NOT NULL DEFAULT 0,
  estimated_input_tokens INTEGER NOT NULL DEFAULT 0,
  input_fingerprint TEXT NOT NULL,
  usage_json TEXT NOT NULL DEFAULT '{}',
  provider_duration_ms INTEGER,
  provider_cost_usd_micros INTEGER,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES fable_chat_conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (base_checkpoint_id) REFERENCES fable_chat_memory_checkpoints(id) ON DELETE SET NULL,
  FOREIGN KEY (source_base_checkpoint_id) REFERENCES fable_chat_memory_checkpoints(id) ON DELETE SET NULL,
  CHECK (profile IN ('standard', 'lite')),
  CHECK (summary_version >= 1),
  CHECK (summarizer_model_id = '@cf/qwen/qwen3-30b-a3b-fp8'),
  CHECK (summarizer_prompt_version >= 1),
  CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'unknown')),
  CHECK (source_base_profile IS NULL OR source_base_profile IN ('standard', 'lite')),
  CHECK (estimated_summary_tokens IS NULL OR estimated_summary_tokens >= 0),
  CHECK (coverage_turn_order >= -1),
  CHECK (source_start_turn_order IS NULL OR source_start_turn_order >= 0),
  CHECK (source_end_turn_order IS NULL OR source_end_turn_order >= 0),
  CHECK (source_turn_count >= 0),
  CHECK (estimated_input_tokens >= 0),
  CHECK (provider_duration_ms IS NULL OR provider_duration_ms >= 0),
  CHECK (provider_cost_usd_micros IS NULL OR provider_cost_usd_micros >= 0),
  CHECK (
    status <> 'succeeded' OR
    (hidden_summary_content IS NOT NULL AND estimated_summary_tokens IS NOT NULL
      AND coverage_through_turn_id IS NOT NULL AND coverage_through_message_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX idx_fable_chat_memory_checkpoint_version
  ON fable_chat_memory_checkpoints(conversation_id, admin_user_id, profile, summary_version);

CREATE UNIQUE INDEX idx_fable_chat_memory_checkpoint_fingerprint
  ON fable_chat_memory_checkpoints(conversation_id, admin_user_id, profile, input_fingerprint);

CREATE UNIQUE INDEX idx_fable_chat_memory_checkpoint_active
  ON fable_chat_memory_checkpoints(conversation_id, admin_user_id, profile)
  WHERE status IN ('pending', 'running');

CREATE INDEX idx_fable_chat_memory_checkpoint_current
  ON fable_chat_memory_checkpoints(
    conversation_id, admin_user_id, profile, status, summary_version DESC, id DESC
  );

CREATE INDEX idx_fable_chat_memory_checkpoint_expiry
  ON fable_chat_memory_checkpoints(status, expires_at)
  WHERE status IN ('pending', 'running');

CREATE INDEX idx_fable_chat_turns_owner_memory
  ON fable_chat_turns(
    conversation_id, admin_user_id, memory_mode, memory_checkpoint_version, created_at DESC
  );
