-- Extend favorites to support member-published MemPics and public videos.
-- D1 (SQLite) does not support altering CHECK constraints in place, so recreate
-- the table and copy the existing data.

CREATE TABLE favorites_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  item_type TEXT NOT NULL CHECK(item_type IN ('gallery', 'mempics', 'soundlab', 'video', 'experiments')),
  item_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  thumb_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, item_type, item_id)
);

INSERT INTO favorites_new SELECT * FROM favorites;

DROP TABLE favorites;

ALTER TABLE favorites_new RENAME TO favorites;

CREATE INDEX idx_favorites_user ON favorites(user_id);
