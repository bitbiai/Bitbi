-- Native Fable web-search settings, immutable attempt metadata, and safe public citations.
-- Additive only. Existing conversations default to search disabled and retain all transcript data.

ALTER TABLE fable_chat_conversations
  ADD COLUMN web_search_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (web_search_enabled IN (0, 1));

ALTER TABLE fable_chat_turns
  ADD COLUMN web_search_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (web_search_enabled IN (0, 1));

ALTER TABLE fable_chat_turns
  ADD COLUMN web_search_tool_version TEXT NOT NULL DEFAULT 'web_search_20250305'
  CHECK (web_search_tool_version = 'web_search_20250305');

ALTER TABLE fable_chat_turns
  ADD COLUMN web_search_max_uses INTEGER NOT NULL DEFAULT 1
  CHECK (web_search_max_uses = 1);

ALTER TABLE fable_chat_turns
  ADD COLUMN web_search_contract_version INTEGER NOT NULL DEFAULT 1
  CHECK (web_search_contract_version = 1);

ALTER TABLE fable_chat_turns
  ADD COLUMN web_search_request_count INTEGER NOT NULL DEFAULT 0
  CHECK (web_search_request_count IN (0, 1));

ALTER TABLE fable_chat_turns
  ADD COLUMN web_search_result_count INTEGER NOT NULL DEFAULT 0
  CHECK (web_search_result_count IN (0, 1));

ALTER TABLE fable_chat_messages
  ADD COLUMN citations_json TEXT NOT NULL DEFAULT '[]';

CREATE INDEX idx_fable_chat_turns_owner_web_search
  ON fable_chat_turns(conversation_id, admin_user_id, web_search_enabled, created_at DESC);
