-- Cursor-pagination support for growth-safe list surfaces.
-- Adds the narrow metadata and indexes needed for:
-- - admin recent-avatar queries without R2 scans
-- - admin users keyset pagination
-- - member asset keyset pagination on ai_images

ALTER TABLE profiles ADD COLUMN avatar_updated_at TEXT;

UPDATE profiles
SET avatar_updated_at = (
  SELECT MAX(created_at)
  FROM user_activity_log
  WHERE user_id = profiles.user_id
    AND action IN ('upload_avatar', 'select_avatar_saved_asset')
)
WHERE COALESCE(has_avatar, 0) = 1;

UPDATE profiles
SET avatar_updated_at = updated_at
WHERE COALESCE(has_avatar, 0) = 1
  AND avatar_updated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_avatar_recent
  ON profiles(has_avatar, avatar_updated_at DESC, user_id DESC);

CREATE INDEX IF NOT EXISTS idx_users_created_id
  ON users(created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_ai_images_user_created_id
  ON ai_images(user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_ai_images_user_folder_created_id
  ON ai_images(user_id, folder_id, created_at DESC, id DESC);
