-- Private owner-scoped Fable location profile.
-- Existing conversation activation flags remain unchanged; the newest valid saved
-- location per owner is promoted without rewriting historical conversation rows.

CREATE TABLE fable_chat_user_settings (
  admin_user_id TEXT PRIMARY KEY,
  web_search_location_json TEXT,
  location_revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (
    web_search_location_json IS NULL OR (
      json_valid(web_search_location_json)
      AND json_type(web_search_location_json) = 'object'
      AND length(web_search_location_json) <= 512
    )
  ),
  CHECK (location_revision >= 1)
);

INSERT INTO fable_chat_user_settings (
  admin_user_id, web_search_location_json, location_revision, created_at, updated_at
)
SELECT
  c.admin_user_id,
  json_extract(c.web_search_settings_json, '$.location'),
  1,
  COALESCE(c.settings_updated_at, c.updated_at, c.created_at),
  COALESCE(c.settings_updated_at, c.updated_at, c.created_at)
FROM fable_chat_conversations c
WHERE json_type(c.web_search_settings_json, '$.location') = 'object'
  AND c.id = (
    SELECT c2.id
      FROM fable_chat_conversations c2
     WHERE c2.admin_user_id = c.admin_user_id
       AND json_type(c2.web_search_settings_json, '$.location') = 'object'
     ORDER BY COALESCE(c2.settings_updated_at, c2.updated_at, c2.created_at) DESC,
              c2.id DESC
     LIMIT 1
  );
