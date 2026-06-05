-- Public Mempic/Memvid/Memtrack comments.
-- Comments are hard-deleted when the related public media is deleted or unpublished.

CREATE TABLE public_media_comments (
  id TEXT PRIMARY KEY,
  media_type TEXT NOT NULL CHECK (media_type IN ('mempics', 'memvids', 'memtracks')),
  media_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK (length(body) > 0 AND length(body) <= 1000),
  created_at TEXT NOT NULL,
  updated_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_public_media_comments_media_created
  ON public_media_comments(media_type, media_id, created_at DESC, id DESC);

CREATE INDEX idx_public_media_comments_user_created
  ON public_media_comments(user_id, created_at DESC);

CREATE INDEX idx_public_media_comments_media
  ON public_media_comments(media_type, media_id);
