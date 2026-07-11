-- Effort-derived Fable web-search limits and full bounded execution counts.
-- Existing attempts retain their original one-search contract through deterministic defaults.

ALTER TABLE fable_chat_turns
  ADD COLUMN web_search_effective_max_uses INTEGER NOT NULL DEFAULT 1
  CHECK (web_search_effective_max_uses BETWEEN 1 AND 10);

ALTER TABLE fable_chat_turns
  ADD COLUMN web_search_effective_contract_version INTEGER NOT NULL DEFAULT 1
  CHECK (web_search_effective_contract_version IN (1, 2));

ALTER TABLE fable_chat_turns
  ADD COLUMN web_search_executed_request_count INTEGER NOT NULL DEFAULT 0
  CHECK (web_search_executed_request_count BETWEEN 0 AND 10);

ALTER TABLE fable_chat_turns
  ADD COLUMN web_search_executed_result_count INTEGER NOT NULL DEFAULT 0
  CHECK (web_search_executed_result_count BETWEEN 0 AND 10);
