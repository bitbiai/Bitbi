-- Normalize user-owned table semantics.
-- Pure D1 child data should be removed with the parent user row.
-- R2-backed image metadata remains explicitly managed in route code.

PRAGMA defer_foreign_keys = on;

CREATE TABLE profiles_new (
    user_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL DEFAULT '',
    bio TEXT NOT NULL DEFAULT '',
    website TEXT NOT NULL DEFAULT '',
    youtube_url TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO profiles_new (user_id, display_name, bio, website, youtube_url, created_at, updated_at)
SELECT user_id, display_name, bio, website, youtube_url, created_at, updated_at
FROM profiles
WHERE user_id IN (SELECT id FROM users);

DROP TABLE profiles;
ALTER TABLE profiles_new RENAME TO profiles;

CREATE TABLE ai_generation_log_new (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO ai_generation_log_new (id, user_id, created_at)
SELECT id, user_id, created_at
FROM ai_generation_log
WHERE user_id IN (SELECT id FROM users);

DROP TABLE ai_generation_log;
ALTER TABLE ai_generation_log_new RENAME TO ai_generation_log;

CREATE INDEX IF NOT EXISTS idx_ai_generation_log_user_created
  ON ai_generation_log(user_id, created_at);
