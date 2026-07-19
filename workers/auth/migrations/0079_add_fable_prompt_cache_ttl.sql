-- Per-conversation Anthropic prompt-cache TTL with immutable turn snapshots.
-- Additive only. Existing conversations and historical turns remain on five minutes.

ALTER TABLE fable_chat_conversations
  ADD COLUMN prompt_cache_ttl TEXT NOT NULL DEFAULT '5m'
  CHECK (prompt_cache_ttl IN ('5m', '1h'));

ALTER TABLE fable_chat_turns
  ADD COLUMN prompt_cache_ttl TEXT NOT NULL DEFAULT '5m'
  CHECK (prompt_cache_ttl IN ('5m', '1h'));
