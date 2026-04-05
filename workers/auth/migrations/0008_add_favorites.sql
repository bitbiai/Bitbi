-- Favorites: per-user bookmarks for gallery, soundlab, experiments
CREATE TABLE IF NOT EXISTS favorites (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT    NOT NULL,
    item_type  TEXT    NOT NULL CHECK(item_type IN ('gallery', 'soundlab', 'experiments')),
    item_id    TEXT    NOT NULL,
    title      TEXT    NOT NULL DEFAULT '',
    thumb_url  TEXT    NOT NULL DEFAULT '',
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, item_type, item_id)
);

CREATE INDEX idx_favorites_user ON favorites(user_id);
