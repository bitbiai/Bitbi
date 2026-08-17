-- Provider-neutral Van Ark chat storage for Fable 5 and Grok 4.6.
-- D1 enforces foreign keys during migrations. Every table in the Fable-chat FK graph is
-- copied before any parent is dropped so ON DELETE actions cannot remove durable rows.

PRAGMA defer_foreign_keys = on;

CREATE TABLE fable_chat_conversations_0080 (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL,
  model_id TEXT NOT NULL DEFAULT 'anthropic/claude-fable-5',
  title TEXT NOT NULL,
  title_source TEXT NOT NULL DEFAULT 'automatic',
  turn_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  effort TEXT NOT NULL DEFAULT 'high' CHECK (effort IN ('low', 'medium', 'high', 'xhigh', 'max')),
  system_preset_id TEXT NOT NULL DEFAULT 'general'
    CHECK (system_preset_id IN ('general', 'coding', 'creative', 'precise')),
  system_preset_version INTEGER NOT NULL DEFAULT 1 CHECK (system_preset_version >= 1),
  thinking_display TEXT NOT NULL DEFAULT 'omitted'
    CHECK (thinking_display IN ('omitted', 'summarized')),
  prompt_cache_policy TEXT NOT NULL DEFAULT 'auto_5m'
    CHECK (prompt_cache_policy IN ('auto_5m', 'automatic')),
  prompt_cache_version INTEGER NOT NULL DEFAULT 1 CHECK (prompt_cache_version >= 1),
  settings_updated_at TEXT,
  web_search_enabled INTEGER NOT NULL DEFAULT 0 CHECK (web_search_enabled IN (0, 1)),
  memory_mode TEXT NOT NULL DEFAULT 'standard' CHECK (memory_mode IN ('standard', 'lite')),
  web_replay_pruned_through_turn_order INTEGER NOT NULL DEFAULT -1
    CHECK (web_replay_pruned_through_turn_order >= -1),
  web_replay_pruned_through_message_id TEXT,
  web_replay_pruned_at TEXT,
  web_replay_pruning_version INTEGER NOT NULL DEFAULT 1 CHECK (web_replay_pruning_version >= 1),
  admin_revision_version INTEGER NOT NULL DEFAULT 0 CHECK (admin_revision_version >= 0),
  admin_revision_updated_at TEXT,
  admin_replay_invalidated_from_turn_order INTEGER NOT NULL DEFAULT -1
    CHECK (admin_replay_invalidated_from_turn_order >= -1),
  web_fetch_enabled INTEGER NOT NULL DEFAULT 0 CHECK (web_fetch_enabled IN (0, 1)),
  web_search_settings_json TEXT NOT NULL
    DEFAULT '{"toolVersion":"web_search_20260318","contractVersion":3,"callerMode":"direct","responseInclusion":"full","domainFilterMode":"none","allowedDomains":[],"blockedDomains":[],"locationEnabled":false,"location":null}'
    CHECK (json_valid(web_search_settings_json)
      AND json_type(web_search_settings_json) = 'object'
      AND length(web_search_settings_json) <= 32768),
  fable_tool_choice TEXT NOT NULL DEFAULT 'auto'
    CHECK (fable_tool_choice IN ('auto', 'none', 'required')),
  prompt_cache_ttl TEXT NOT NULL DEFAULT '5m' CHECK (prompt_cache_ttl IN ('5m', '1h')),
  provider_settings_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(provider_settings_json)
      AND json_type(provider_settings_json) = 'object'
      AND length(provider_settings_json) <= 32768),
  provider_settings_version INTEGER NOT NULL DEFAULT 1 CHECK (provider_settings_version >= 1),
  FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (model_id IN ('anthropic/claude-fable-5', 'xai/grok-4.6')),
  CHECK (title_source IN ('automatic', 'manual')),
  CHECK (turn_count >= 0)
);

INSERT INTO fable_chat_conversations_0080 (
  id, admin_user_id, model_id, title, title_source, turn_count, created_at, updated_at,
  deleted_at, effort, system_preset_id, system_preset_version, thinking_display,
  prompt_cache_policy, prompt_cache_version, settings_updated_at, web_search_enabled,
  memory_mode, web_replay_pruned_through_turn_order, web_replay_pruned_through_message_id,
  web_replay_pruned_at, web_replay_pruning_version, admin_revision_version,
  admin_revision_updated_at, admin_replay_invalidated_from_turn_order, web_fetch_enabled,
  web_search_settings_json, fable_tool_choice, prompt_cache_ttl
)
SELECT
  id, admin_user_id, model_id, title, title_source, turn_count, created_at, updated_at,
  deleted_at, effort, system_preset_id, system_preset_version, thinking_display,
  prompt_cache_policy, prompt_cache_version, settings_updated_at, web_search_enabled,
  memory_mode, web_replay_pruned_through_turn_order, web_replay_pruned_through_message_id,
  web_replay_pruned_at, web_replay_pruning_version, admin_revision_version,
  admin_revision_updated_at, admin_replay_invalidated_from_turn_order, web_fetch_enabled,
  web_search_settings_json, fable_tool_choice, prompt_cache_ttl
FROM fable_chat_conversations;

CREATE TABLE fable_chat_messages_0080 (
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
  reasoning_summary TEXT,
  citations_json TEXT NOT NULL DEFAULT '[]',
  FOREIGN KEY (conversation_id) REFERENCES fable_chat_conversations_0080(id) ON DELETE CASCADE,
  FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (turn_order >= 0),
  CHECK (role IN ('user', 'assistant')),
  CHECK (role_order IN (0, 1)),
  CHECK (state IN ('pending', 'succeeded', 'failed', 'unknown')),
  CHECK (
    (role = 'user' AND role_order = 0 AND model_id IS NULL) OR
    (role = 'assistant' AND role_order = 1
      AND model_id IN ('anthropic/claude-fable-5', 'xai/grok-4.6'))
  )
);

INSERT INTO fable_chat_messages_0080 (
  id, conversation_id, message_group_id, admin_user_id, turn_order, role, role_order,
  content, state, model_id, metadata_json, created_at, updated_at, reasoning_summary,
  citations_json
)
SELECT
  id, conversation_id, message_group_id, admin_user_id, turn_order, role, role_order,
  content, state, model_id, metadata_json, created_at, updated_at, reasoning_summary,
  citations_json
FROM fable_chat_messages;

CREATE TABLE fable_chat_turns_0080 (
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
  effort TEXT NOT NULL DEFAULT 'high' CHECK (effort IN ('low', 'medium', 'high', 'xhigh', 'max')),
  effective_max_output_tokens INTEGER NOT NULL DEFAULT 16384
    CHECK (effective_max_output_tokens IN (8192, 16384, 32768)),
  system_preset_id TEXT NOT NULL DEFAULT 'general'
    CHECK (system_preset_id IN ('general', 'coding', 'creative', 'precise')),
  system_preset_version INTEGER NOT NULL DEFAULT 1 CHECK (system_preset_version >= 1),
  thinking_display TEXT NOT NULL DEFAULT 'omitted'
    CHECK (thinking_display IN ('omitted', 'summarized')),
  prompt_cache_policy TEXT NOT NULL DEFAULT 'auto_5m'
    CHECK (prompt_cache_policy IN ('auto_5m', 'automatic')),
  prompt_cache_version INTEGER NOT NULL DEFAULT 1 CHECK (prompt_cache_version >= 1),
  context_format_version TEXT NOT NULL DEFAULT 'native-anthropic-turns-v2',
  estimated_input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (estimated_input_tokens >= 0),
  effective_input_token_limit INTEGER NOT NULL DEFAULT 96000 CHECK (effective_input_token_limit > 0),
  context_estimator_version TEXT NOT NULL DEFAULT 'utf8-conservative-v1',
  cache_breakpoint_json TEXT NOT NULL DEFAULT '{}',
  settings_snapshot_json TEXT NOT NULL DEFAULT '{}',
  provider_duration_ms INTEGER CHECK (provider_duration_ms IS NULL OR provider_duration_ms >= 0),
  output_truncated INTEGER NOT NULL DEFAULT 0 CHECK (output_truncated IN (0, 1)),
  web_search_enabled INTEGER NOT NULL DEFAULT 0 CHECK (web_search_enabled IN (0, 1)),
  web_search_tool_version TEXT NOT NULL DEFAULT 'web_search_20250305'
    CHECK (web_search_tool_version = 'web_search_20250305'),
  web_search_max_uses INTEGER NOT NULL DEFAULT 1 CHECK (web_search_max_uses = 1),
  web_search_contract_version INTEGER NOT NULL DEFAULT 1 CHECK (web_search_contract_version = 1),
  web_search_request_count INTEGER NOT NULL DEFAULT 0 CHECK (web_search_request_count IN (0, 1)),
  web_search_result_count INTEGER NOT NULL DEFAULT 0 CHECK (web_search_result_count IN (0, 1)),
  web_search_effective_max_uses INTEGER NOT NULL DEFAULT 1
    CHECK (web_search_effective_max_uses BETWEEN 1 AND 10),
  web_search_effective_contract_version INTEGER NOT NULL DEFAULT 1
    CHECK (web_search_effective_contract_version IN (1, 2)),
  web_search_executed_request_count INTEGER NOT NULL DEFAULT 0
    CHECK (web_search_executed_request_count BETWEEN 0 AND 10),
  web_search_executed_result_count INTEGER NOT NULL DEFAULT 0
    CHECK (web_search_executed_result_count BETWEEN 0 AND 10),
  memory_mode TEXT NOT NULL DEFAULT 'standard' CHECK (memory_mode IN ('standard', 'lite')),
  memory_contract_version INTEGER NOT NULL DEFAULT 1 CHECK (memory_contract_version >= 1),
  memory_checkpoint_id TEXT,
  memory_checkpoint_version INTEGER NOT NULL DEFAULT 0 CHECK (memory_checkpoint_version >= 0),
  memory_coverage_turn_order INTEGER NOT NULL DEFAULT -1 CHECK (memory_coverage_turn_order >= -1),
  web_replay_pruning_version INTEGER NOT NULL DEFAULT 1 CHECK (web_replay_pruning_version >= 1),
  web_replay_pruned_through_turn_order INTEGER NOT NULL DEFAULT -1
    CHECK (web_replay_pruned_through_turn_order >= -1),
  web_replay_pruned_through_message_id TEXT,
  web_replay_pruned_at TEXT,
  web_replay_pruned_pair_count INTEGER NOT NULL DEFAULT 0 CHECK (web_replay_pruned_pair_count >= 0),
  web_replay_pruned_estimated_tokens INTEGER NOT NULL DEFAULT 0
    CHECK (web_replay_pruned_estimated_tokens >= 0),
  admin_revision_version INTEGER NOT NULL DEFAULT 0 CHECK (admin_revision_version >= 0),
  web_fetch_enabled INTEGER NOT NULL DEFAULT 0 CHECK (web_fetch_enabled IN (0, 1)),
  web_fetch_tool_version TEXT NOT NULL DEFAULT 'web_fetch_20260318'
    CHECK (web_fetch_tool_version = 'web_fetch_20260318'),
  web_fetch_max_uses INTEGER NOT NULL DEFAULT 2 CHECK (web_fetch_max_uses = 2),
  web_fetch_max_content_tokens INTEGER NOT NULL DEFAULT 8000 CHECK (web_fetch_max_content_tokens = 8000),
  web_fetch_contract_version INTEGER NOT NULL DEFAULT 1 CHECK (web_fetch_contract_version = 1),
  web_fetch_direct_only INTEGER NOT NULL DEFAULT 1 CHECK (web_fetch_direct_only = 1),
  web_fetch_use_cache INTEGER NOT NULL DEFAULT 1 CHECK (web_fetch_use_cache = 1),
  web_fetch_request_count INTEGER NOT NULL DEFAULT 0 CHECK (web_fetch_request_count BETWEEN 0 AND 2),
  web_fetch_result_count INTEGER NOT NULL DEFAULT 0 CHECK (web_fetch_result_count BETWEEN 0 AND 2),
  web_fetch_error_result_count INTEGER NOT NULL DEFAULT 0
    CHECK (web_fetch_error_result_count BETWEEN 0 AND 2),
  web_fetch_replay_pruned_pair_count INTEGER NOT NULL DEFAULT 0
    CHECK (web_fetch_replay_pruned_pair_count >= 0),
  web_fetch_replay_pruned_estimated_tokens INTEGER NOT NULL DEFAULT 0
    CHECK (web_fetch_replay_pruned_estimated_tokens >= 0),
  web_search_effective_settings_json TEXT NOT NULL
    DEFAULT '{"toolVersion":"web_search_20250305","contractVersion":2,"callerMode":"direct","allowedCallers":["direct"],"responseInclusionPreference":"full","effectiveResponseInclusion":"full","domainFilterMode":"none","allowedDomains":[],"blockedDomains":[],"activeDomains":[],"locationEnabled":false,"location":null}'
    CHECK (json_valid(web_search_effective_settings_json)
      AND json_type(web_search_effective_settings_json) = 'object'
      AND length(web_search_effective_settings_json) <= 32768),
  fable_tool_choice TEXT NOT NULL DEFAULT 'auto'
    CHECK (fable_tool_choice IN ('auto', 'none', 'required')),
  prompt_cache_ttl TEXT NOT NULL DEFAULT '5m' CHECK (prompt_cache_ttl IN ('5m', '1h')),
  provider_settings_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(provider_settings_json)
      AND json_type(provider_settings_json) = 'object'
      AND length(provider_settings_json) <= 32768),
  provider_settings_version INTEGER NOT NULL DEFAULT 1 CHECK (provider_settings_version >= 1),
  provider_state_format_version TEXT NOT NULL DEFAULT 'anthropic-content-v2',
  FOREIGN KEY (conversation_id) REFERENCES fable_chat_conversations_0080(id) ON DELETE CASCADE,
  FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (user_message_id) REFERENCES fable_chat_messages_0080(id) ON DELETE CASCADE,
  FOREIGN KEY (assistant_message_id) REFERENCES fable_chat_messages_0080(id) ON DELETE SET NULL,
  FOREIGN KEY (retry_of_turn_id) REFERENCES fable_chat_turns_0080(id) ON DELETE SET NULL,
  CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'unknown')),
  CHECK (model_id IN ('anthropic/claude-fable-5', 'xai/grok-4.6')),
  CHECK (context_included_turns >= 0),
  CHECK (context_omitted_turns >= 0),
  CHECK (context_character_count >= 0),
  CHECK (retry_of_turn_id IS NULL OR retry_of_turn_id <> id)
);

INSERT INTO fable_chat_turns_0080 (
  id, conversation_id, admin_user_id, idempotency_key_hash, request_fingerprint,
  user_message_id, assistant_message_id, retry_of_turn_id, status, model_id,
  context_included_turns, context_omitted_turns, context_character_count, provider_model,
  stop_reason, stop_sequence, usage_json, gateway_metadata_json, error_code, created_at,
  updated_at, completed_at, expires_at, effort, effective_max_output_tokens,
  system_preset_id, system_preset_version, thinking_display, prompt_cache_policy,
  prompt_cache_version, context_format_version, estimated_input_tokens,
  effective_input_token_limit, context_estimator_version, cache_breakpoint_json,
  settings_snapshot_json, provider_duration_ms, output_truncated, web_search_enabled,
  web_search_tool_version, web_search_max_uses, web_search_contract_version,
  web_search_request_count, web_search_result_count, web_search_effective_max_uses,
  web_search_effective_contract_version, web_search_executed_request_count,
  web_search_executed_result_count, memory_mode, memory_contract_version,
  memory_checkpoint_id, memory_checkpoint_version, memory_coverage_turn_order,
  web_replay_pruning_version, web_replay_pruned_through_turn_order,
  web_replay_pruned_through_message_id, web_replay_pruned_at,
  web_replay_pruned_pair_count, web_replay_pruned_estimated_tokens,
  admin_revision_version, web_fetch_enabled, web_fetch_tool_version, web_fetch_max_uses,
  web_fetch_max_content_tokens, web_fetch_contract_version, web_fetch_direct_only,
  web_fetch_use_cache, web_fetch_request_count, web_fetch_result_count,
  web_fetch_error_result_count, web_fetch_replay_pruned_pair_count,
  web_fetch_replay_pruned_estimated_tokens, web_search_effective_settings_json,
  fable_tool_choice, prompt_cache_ttl
)
SELECT
  id, conversation_id, admin_user_id, idempotency_key_hash, request_fingerprint,
  user_message_id, assistant_message_id, retry_of_turn_id, status, model_id,
  context_included_turns, context_omitted_turns, context_character_count, provider_model,
  stop_reason, stop_sequence, usage_json, gateway_metadata_json, error_code, created_at,
  updated_at, completed_at, expires_at, effort, effective_max_output_tokens,
  system_preset_id, system_preset_version, thinking_display, prompt_cache_policy,
  prompt_cache_version, context_format_version, estimated_input_tokens,
  effective_input_token_limit, context_estimator_version, cache_breakpoint_json,
  settings_snapshot_json, provider_duration_ms, output_truncated, web_search_enabled,
  web_search_tool_version, web_search_max_uses, web_search_contract_version,
  web_search_request_count, web_search_result_count, web_search_effective_max_uses,
  web_search_effective_contract_version, web_search_executed_request_count,
  web_search_executed_result_count, memory_mode, memory_contract_version,
  memory_checkpoint_id, memory_checkpoint_version, memory_coverage_turn_order,
  web_replay_pruning_version, web_replay_pruned_through_turn_order,
  web_replay_pruned_through_message_id, web_replay_pruned_at,
  web_replay_pruned_pair_count, web_replay_pruned_estimated_tokens,
  admin_revision_version, web_fetch_enabled, web_fetch_tool_version, web_fetch_max_uses,
  web_fetch_max_content_tokens, web_fetch_contract_version, web_fetch_direct_only,
  web_fetch_use_cache, web_fetch_request_count, web_fetch_result_count,
  web_fetch_error_result_count, web_fetch_replay_pruned_pair_count,
  web_fetch_replay_pruned_estimated_tokens, web_search_effective_settings_json,
  fable_tool_choice, prompt_cache_ttl
FROM fable_chat_turns;

CREATE TABLE fable_chat_provider_messages_0080 (
  message_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  admin_user_id TEXT NOT NULL,
  model_id TEXT NOT NULL DEFAULT 'anthropic/claude-fable-5',
  content_blocks_json TEXT NOT NULL,
  serialized_bytes INTEGER NOT NULL,
  format_version TEXT NOT NULL DEFAULT 'anthropic-content-v1',
  created_at TEXT NOT NULL,
  FOREIGN KEY (message_id) REFERENCES fable_chat_messages_0080(id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES fable_chat_conversations_0080(id) ON DELETE CASCADE,
  FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (model_id = 'anthropic/claude-fable-5'),
  CHECK (serialized_bytes > 0)
);

INSERT INTO fable_chat_provider_messages_0080
SELECT * FROM fable_chat_provider_messages;

CREATE TABLE fable_chat_memory_checkpoints_0080 (
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
  FOREIGN KEY (conversation_id) REFERENCES fable_chat_conversations_0080(id) ON DELETE CASCADE,
  FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (base_checkpoint_id) REFERENCES fable_chat_memory_checkpoints_0080(id) ON DELETE SET NULL,
  FOREIGN KEY (source_base_checkpoint_id) REFERENCES fable_chat_memory_checkpoints_0080(id) ON DELETE SET NULL,
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
  CHECK (status <> 'succeeded' OR
    (hidden_summary_content IS NOT NULL AND estimated_summary_tokens IS NOT NULL
      AND coverage_through_turn_id IS NOT NULL AND coverage_through_message_id IS NOT NULL))
);

INSERT INTO fable_chat_memory_checkpoints_0080
SELECT * FROM fable_chat_memory_checkpoints;

CREATE TABLE fable_chat_admin_message_revisions_0080 (
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
  FOREIGN KEY (conversation_id) REFERENCES fable_chat_conversations_0080(id) ON DELETE CASCADE,
  FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES fable_chat_messages_0080(id) ON DELETE CASCADE,
  FOREIGN KEY (turn_id) REFERENCES fable_chat_turns_0080(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_admin_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CHECK (revision_number >= 1),
  CHECK (length(content) BETWEEN 1 AND 400000),
  CHECK (length(citations_json) <= 65536),
  CHECK (length(reason) BETWEEN 3 AND 500)
);

INSERT INTO fable_chat_admin_message_revisions_0080
SELECT * FROM fable_chat_admin_message_revisions;

CREATE TABLE fable_chat_admin_turn_revisions_0080 (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  admin_user_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL,
  action TEXT NOT NULL,
  actor_admin_user_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES fable_chat_conversations_0080(id) ON DELETE CASCADE,
  FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (turn_id) REFERENCES fable_chat_turns_0080(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_admin_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CHECK (revision_number >= 1),
  CHECK (action IN ('delete', 'restore')),
  CHECK (length(reason) BETWEEN 3 AND 500)
);

INSERT INTO fable_chat_admin_turn_revisions_0080
SELECT * FROM fable_chat_admin_turn_revisions;

CREATE TABLE fable_chat_memory_checkpoint_invalidations_0080 (
  checkpoint_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  admin_user_id TEXT NOT NULL,
  actor_admin_user_id TEXT NOT NULL,
  invalidated_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  mutation_version INTEGER NOT NULL,
  FOREIGN KEY (checkpoint_id) REFERENCES fable_chat_memory_checkpoints_0080(id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES fable_chat_conversations_0080(id) ON DELETE CASCADE,
  FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_admin_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CHECK (length(reason) BETWEEN 3 AND 500),
  CHECK (mutation_version >= 1)
);

INSERT INTO fable_chat_memory_checkpoint_invalidations_0080
SELECT * FROM fable_chat_memory_checkpoint_invalidations;

DROP TABLE fable_chat_memory_checkpoint_invalidations;
DROP TABLE fable_chat_admin_message_revisions;
DROP TABLE fable_chat_admin_turn_revisions;
DROP TABLE fable_chat_provider_messages;
DROP TABLE fable_chat_memory_checkpoints;
DROP TABLE fable_chat_turns;
DROP TABLE fable_chat_messages;
DROP TABLE fable_chat_conversations;

ALTER TABLE fable_chat_conversations_0080 RENAME TO fable_chat_conversations;
ALTER TABLE fable_chat_messages_0080 RENAME TO fable_chat_messages;
ALTER TABLE fable_chat_turns_0080 RENAME TO fable_chat_turns;
ALTER TABLE fable_chat_provider_messages_0080 RENAME TO fable_chat_provider_messages;
ALTER TABLE fable_chat_memory_checkpoints_0080 RENAME TO fable_chat_memory_checkpoints;
ALTER TABLE fable_chat_admin_message_revisions_0080 RENAME TO fable_chat_admin_message_revisions;
ALTER TABLE fable_chat_admin_turn_revisions_0080 RENAME TO fable_chat_admin_turn_revisions;
ALTER TABLE fable_chat_memory_checkpoint_invalidations_0080
  RENAME TO fable_chat_memory_checkpoint_invalidations;

CREATE INDEX idx_fable_chat_conversations_admin_updated
  ON fable_chat_conversations(admin_user_id, deleted_at, updated_at DESC, id DESC);
CREATE INDEX idx_fable_chat_conversations_owner_web_replay
  ON fable_chat_conversations(
    admin_user_id, web_replay_pruned_through_turn_order, web_replay_pruned_at, id
  );
CREATE INDEX idx_fable_chat_conversations_admin_data_center
  ON fable_chat_conversations(deleted_at, updated_at DESC, id DESC);
CREATE INDEX idx_fable_chat_conversations_web_fetch
  ON fable_chat_conversations(web_fetch_enabled, updated_at DESC, id DESC);
CREATE INDEX idx_fable_chat_conversations_web_settings
  ON fable_chat_conversations(
    web_search_enabled, fable_tool_choice, settings_updated_at DESC, id DESC
  );
CREATE INDEX idx_fable_chat_conversations_model_updated
  ON fable_chat_conversations(model_id, deleted_at, updated_at DESC, id DESC);

CREATE UNIQUE INDEX idx_fable_chat_messages_group_role
  ON fable_chat_messages(message_group_id, role);
CREATE UNIQUE INDEX idx_fable_chat_messages_conversation_order_role
  ON fable_chat_messages(conversation_id, turn_order, role);
CREATE INDEX idx_fable_chat_messages_conversation_turn
  ON fable_chat_messages(conversation_id, admin_user_id, turn_order, role_order, id);

CREATE UNIQUE INDEX idx_fable_chat_turns_conversation_idempotency
  ON fable_chat_turns(conversation_id, idempotency_key_hash);
CREATE UNIQUE INDEX idx_fable_chat_turns_active_user_message
  ON fable_chat_turns(user_message_id) WHERE status IN ('pending', 'running');
CREATE UNIQUE INDEX idx_fable_chat_turns_active_conversation
  ON fable_chat_turns(conversation_id) WHERE status IN ('pending', 'running');
CREATE INDEX idx_fable_chat_turns_conversation_created
  ON fable_chat_turns(conversation_id, admin_user_id, created_at DESC, id DESC);
CREATE INDEX idx_fable_chat_turns_active_expiry
  ON fable_chat_turns(status, expires_at) WHERE status IN ('pending', 'running');
CREATE INDEX idx_fable_chat_turns_owner_settings
  ON fable_chat_turns(conversation_id, admin_user_id, effort, system_preset_id, created_at DESC);
CREATE INDEX idx_fable_chat_turns_owner_web_search
  ON fable_chat_turns(conversation_id, admin_user_id, web_search_enabled, created_at DESC);
CREATE INDEX idx_fable_chat_turns_owner_memory
  ON fable_chat_turns(
    conversation_id, admin_user_id, memory_mode, memory_checkpoint_version, created_at DESC
  );
CREATE INDEX idx_fable_chat_turns_web_fetch
  ON fable_chat_turns(
    conversation_id, admin_user_id, web_fetch_enabled, created_at DESC, id DESC
  );
CREATE INDEX idx_fable_chat_turns_model_created
  ON fable_chat_turns(model_id, status, created_at DESC, id DESC);

CREATE INDEX idx_fable_chat_provider_messages_owner
  ON fable_chat_provider_messages(conversation_id, admin_user_id, message_id);

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

CREATE UNIQUE INDEX idx_fable_chat_admin_message_revision_number
  ON fable_chat_admin_message_revisions(message_id, revision_number);
CREATE INDEX idx_fable_chat_admin_message_revision_current
  ON fable_chat_admin_message_revisions(
    conversation_id, admin_user_id, message_id, revision_number DESC, id DESC
  );
CREATE UNIQUE INDEX idx_fable_chat_admin_turn_revision_number
  ON fable_chat_admin_turn_revisions(turn_id, revision_number);
CREATE INDEX idx_fable_chat_admin_turn_revision_current
  ON fable_chat_admin_turn_revisions(
    conversation_id, admin_user_id, turn_id, revision_number DESC, id DESC
  );
CREATE INDEX idx_fable_chat_memory_checkpoint_invalidations_owner
  ON fable_chat_memory_checkpoint_invalidations(
    conversation_id, admin_user_id, invalidated_at DESC, checkpoint_id
  );

CREATE TABLE fable_chat_provider_states (
  message_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  admin_user_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  state_json TEXT NOT NULL,
  serialized_bytes INTEGER NOT NULL,
  format_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (message_id) REFERENCES fable_chat_messages(id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES fable_chat_conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (model_id = 'xai/grok-4.6'),
  CHECK (json_valid(state_json) AND json_type(state_json) = 'object'),
  CHECK (serialized_bytes BETWEEN 2 AND 4194304),
  CHECK (format_version = 'openai-chat-completions-state-v1')
);

CREATE INDEX idx_fable_chat_provider_states_owner
  ON fable_chat_provider_states(conversation_id, admin_user_id, message_id);

CREATE TABLE fable_chat_attachments (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  message_id TEXT,
  admin_user_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  attached_at TEXT,
  expires_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (conversation_id) REFERENCES fable_chat_conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES fable_chat_messages(id) ON DELETE SET NULL,
  FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (model_id = 'xai/grok-4.6'),
  CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  CHECK (byte_size BETWEEN 1 AND 8388608),
  CHECK (width BETWEEN 1 AND 8192),
  CHECK (height BETWEEN 1 AND 8192),
  CHECK (state IN ('pending', 'attached', 'deleted')),
  CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*')
);

CREATE INDEX idx_fable_chat_attachments_owner
  ON fable_chat_attachments(conversation_id, admin_user_id, state, created_at DESC, id DESC);
CREATE INDEX idx_fable_chat_attachments_expiry
  ON fable_chat_attachments(state, expires_at) WHERE state IN ('pending', 'attached');

PRAGMA defer_foreign_keys = off;
