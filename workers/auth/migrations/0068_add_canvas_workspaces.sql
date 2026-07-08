-- BITBI Canvas: user-owned workflow projects, graph state, and run history.
-- Media bytes remain in the existing asset/R2 pipeline; Canvas stores metadata only.

CREATE TABLE canvas_projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  locale TEXT CHECK (locale IN ('en', 'de')),
  thumbnail_asset_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_canvas_projects_user_updated
  ON canvas_projects(user_id, deleted_at, updated_at DESC, id DESC);

CREATE TABLE canvas_nodes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN (
    'text_prompt',
    'text_generation',
    'image_generation',
    'video_generation',
    'music_generation',
    'asset_reference',
    'output_result',
    'note'
  )),
  title TEXT,
  x REAL NOT NULL,
  y REAL NOT NULL,
  width REAL,
  height REAL,
  model_id TEXT,
  config_json TEXT NOT NULL DEFAULT '{}',
  content_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT,
  asset_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (project_id) REFERENCES canvas_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_canvas_nodes_project_user
  ON canvas_nodes(project_id, user_id, deleted_at, created_at, id);

CREATE TABLE canvas_edges (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  source_node_id TEXT NOT NULL,
  target_node_id TEXT NOT NULL,
  label TEXT,
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (project_id) REFERENCES canvas_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (source_node_id) REFERENCES canvas_nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (target_node_id) REFERENCES canvas_nodes(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_canvas_edges_active_pair
  ON canvas_edges(project_id, user_id, source_node_id, target_node_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_canvas_edges_project_user
  ON canvas_edges(project_id, user_id, deleted_at, created_at, id);

CREATE TABLE canvas_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  input_json TEXT NOT NULL,
  output_json TEXT,
  asset_id TEXT,
  usage_attempt_id TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  deleted_at TEXT,
  FOREIGN KEY (project_id) REFERENCES canvas_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (node_id) REFERENCES canvas_nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_canvas_runs_user_idempotency
  ON canvas_runs(user_id, idempotency_key);

CREATE INDEX idx_canvas_runs_project_node_user
  ON canvas_runs(project_id, node_id, user_id, deleted_at, created_at DESC, id DESC);
