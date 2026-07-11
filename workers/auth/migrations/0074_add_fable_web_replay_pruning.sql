-- Durable, monotonic provider replay pruning for completed Fable web-search cycles.
-- Stored transcript messages and private provider evidence remain unchanged.

ALTER TABLE fable_chat_conversations
  ADD COLUMN web_replay_pruned_through_turn_order INTEGER NOT NULL DEFAULT -1
  CHECK (web_replay_pruned_through_turn_order >= -1);

ALTER TABLE fable_chat_conversations
  ADD COLUMN web_replay_pruned_through_message_id TEXT;

ALTER TABLE fable_chat_conversations
  ADD COLUMN web_replay_pruned_at TEXT;

ALTER TABLE fable_chat_conversations
  ADD COLUMN web_replay_pruning_version INTEGER NOT NULL DEFAULT 1
  CHECK (web_replay_pruning_version >= 1);

ALTER TABLE fable_chat_turns
  ADD COLUMN web_replay_pruning_version INTEGER NOT NULL DEFAULT 1
  CHECK (web_replay_pruning_version >= 1);

ALTER TABLE fable_chat_turns
  ADD COLUMN web_replay_pruned_through_turn_order INTEGER NOT NULL DEFAULT -1
  CHECK (web_replay_pruned_through_turn_order >= -1);

ALTER TABLE fable_chat_turns
  ADD COLUMN web_replay_pruned_through_message_id TEXT;

ALTER TABLE fable_chat_turns
  ADD COLUMN web_replay_pruned_at TEXT;

ALTER TABLE fable_chat_turns
  ADD COLUMN web_replay_pruned_pair_count INTEGER NOT NULL DEFAULT 0
  CHECK (web_replay_pruned_pair_count >= 0);

ALTER TABLE fable_chat_turns
  ADD COLUMN web_replay_pruned_estimated_tokens INTEGER NOT NULL DEFAULT 0
  CHECK (web_replay_pruned_estimated_tokens >= 0);

CREATE INDEX idx_fable_chat_conversations_owner_web_replay
  ON fable_chat_conversations(
    admin_user_id, web_replay_pruned_through_turn_order, web_replay_pruned_at, id
  );
