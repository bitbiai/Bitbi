-- Fable Web Search 20260318 high-level settings and immutable effective turn snapshots.
-- Existing conversations retain direct/full/no-filter/no-location/auto behavior.

ALTER TABLE fable_chat_conversations
  ADD COLUMN web_search_settings_json TEXT NOT NULL
  DEFAULT '{"toolVersion":"web_search_20260318","contractVersion":3,"callerMode":"direct","responseInclusion":"full","domainFilterMode":"none","allowedDomains":[],"blockedDomains":[],"locationEnabled":false,"location":null}'
  CHECK (
    json_valid(web_search_settings_json)
    AND json_type(web_search_settings_json) = 'object'
    AND length(web_search_settings_json) <= 32768
  );

ALTER TABLE fable_chat_conversations
  ADD COLUMN fable_tool_choice TEXT NOT NULL DEFAULT 'auto'
  CHECK (fable_tool_choice IN ('auto', 'none'));

ALTER TABLE fable_chat_turns
  ADD COLUMN web_search_effective_settings_json TEXT NOT NULL
  DEFAULT '{"toolVersion":"web_search_20250305","contractVersion":2,"callerMode":"direct","allowedCallers":["direct"],"responseInclusionPreference":"full","effectiveResponseInclusion":"full","domainFilterMode":"none","allowedDomains":[],"blockedDomains":[],"activeDomains":[],"locationEnabled":false,"location":null}'
  CHECK (
    json_valid(web_search_effective_settings_json)
    AND json_type(web_search_effective_settings_json) = 'object'
    AND length(web_search_effective_settings_json) <= 32768
  );

ALTER TABLE fable_chat_turns
  ADD COLUMN fable_tool_choice TEXT NOT NULL DEFAULT 'auto'
  CHECK (fable_tool_choice IN ('auto', 'none'));

CREATE INDEX idx_fable_chat_conversations_web_settings
  ON fable_chat_conversations(
    web_search_enabled, fable_tool_choice, settings_updated_at DESC, id DESC
  );
