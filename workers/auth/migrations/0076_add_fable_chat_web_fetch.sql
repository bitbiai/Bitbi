-- Server-owned Anthropic Web Fetch settings and content-free per-turn metadata.
-- Existing conversations and turns remain Fetch-disabled by default.

ALTER TABLE fable_chat_conversations
  ADD COLUMN web_fetch_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (web_fetch_enabled IN (0, 1));

ALTER TABLE fable_chat_turns
  ADD COLUMN web_fetch_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (web_fetch_enabled IN (0, 1));

ALTER TABLE fable_chat_turns
  ADD COLUMN web_fetch_tool_version TEXT NOT NULL DEFAULT 'web_fetch_20260318'
  CHECK (web_fetch_tool_version = 'web_fetch_20260318');

ALTER TABLE fable_chat_turns
  ADD COLUMN web_fetch_max_uses INTEGER NOT NULL DEFAULT 2
  CHECK (web_fetch_max_uses = 2);

ALTER TABLE fable_chat_turns
  ADD COLUMN web_fetch_max_content_tokens INTEGER NOT NULL DEFAULT 8000
  CHECK (web_fetch_max_content_tokens = 8000);

ALTER TABLE fable_chat_turns
  ADD COLUMN web_fetch_contract_version INTEGER NOT NULL DEFAULT 1
  CHECK (web_fetch_contract_version = 1);

ALTER TABLE fable_chat_turns
  ADD COLUMN web_fetch_direct_only INTEGER NOT NULL DEFAULT 1
  CHECK (web_fetch_direct_only = 1);

ALTER TABLE fable_chat_turns
  ADD COLUMN web_fetch_use_cache INTEGER NOT NULL DEFAULT 1
  CHECK (web_fetch_use_cache = 1);

ALTER TABLE fable_chat_turns
  ADD COLUMN web_fetch_request_count INTEGER NOT NULL DEFAULT 0
  CHECK (web_fetch_request_count BETWEEN 0 AND 2);

ALTER TABLE fable_chat_turns
  ADD COLUMN web_fetch_result_count INTEGER NOT NULL DEFAULT 0
  CHECK (web_fetch_result_count BETWEEN 0 AND 2);

ALTER TABLE fable_chat_turns
  ADD COLUMN web_fetch_error_result_count INTEGER NOT NULL DEFAULT 0
  CHECK (web_fetch_error_result_count BETWEEN 0 AND 2);

ALTER TABLE fable_chat_turns
  ADD COLUMN web_fetch_replay_pruned_pair_count INTEGER NOT NULL DEFAULT 0
  CHECK (web_fetch_replay_pruned_pair_count >= 0);

ALTER TABLE fable_chat_turns
  ADD COLUMN web_fetch_replay_pruned_estimated_tokens INTEGER NOT NULL DEFAULT 0
  CHECK (web_fetch_replay_pruned_estimated_tokens >= 0);

CREATE INDEX idx_fable_chat_conversations_web_fetch
  ON fable_chat_conversations(web_fetch_enabled, updated_at DESC, id DESC);

CREATE INDEX idx_fable_chat_turns_web_fetch
  ON fable_chat_turns(
    conversation_id, admin_user_id, web_fetch_enabled, created_at DESC, id DESC
  );
