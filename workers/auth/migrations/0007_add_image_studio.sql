-- Image Studio: folders, images, and generation log
-- Migration 0007

CREATE TABLE ai_folders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE(user_id, slug)
);

CREATE INDEX idx_ai_folders_user_id ON ai_folders(user_id);

CREATE TABLE ai_images (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  folder_id TEXT,
  r2_key TEXT NOT NULL,
  prompt TEXT NOT NULL,
  model TEXT NOT NULL,
  steps INTEGER,
  seed INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (folder_id) REFERENCES ai_folders(id) ON DELETE SET NULL
);

CREATE INDEX idx_ai_images_user_id ON ai_images(user_id);
CREATE INDEX idx_ai_images_folder_id ON ai_images(folder_id);

CREATE TABLE ai_generation_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_ai_generation_log_user_created ON ai_generation_log(user_id, created_at);
