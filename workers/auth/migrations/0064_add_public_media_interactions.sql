-- Public media likes and profile follows.
-- Media likes are hard-deleted when the related public media is deleted or unpublished.

CREATE TABLE public_media_likes (
  id TEXT PRIMARY KEY,
  media_type TEXT NOT NULL CHECK (media_type IN ('mempics', 'memvids', 'memtracks')),
  media_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, media_type, media_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_public_media_likes_media_created
  ON public_media_likes(media_type, media_id, created_at DESC, id DESC);

CREATE INDEX idx_public_media_likes_user_created
  ON public_media_likes(user_id, created_at DESC, id DESC);

CREATE INDEX idx_public_media_likes_media
  ON public_media_likes(media_type, media_id);

CREATE TABLE profile_follows (
  id TEXT PRIMARY KEY,
  follower_user_id TEXT NOT NULL,
  followed_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  UNIQUE (follower_user_id, followed_user_id),
  CHECK (follower_user_id <> followed_user_id),
  FOREIGN KEY (follower_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (followed_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_profile_follows_followed_created
  ON profile_follows(followed_user_id, created_at DESC, id DESC);

CREATE INDEX idx_profile_follows_follower_created
  ON profile_follows(follower_user_id, created_at DESC, id DESC);
