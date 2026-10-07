-- Additive; legacy project positions, clips and exports stay untouched.
ALTER TABLE canvas_projects ADD COLUMN workspace_width INTEGER NOT NULL DEFAULT 2400 CHECK(workspace_width BETWEEN 64 AND 50000);
ALTER TABLE canvas_projects ADD COLUMN workspace_height INTEGER NOT NULL DEFAULT 1600 CHECK(workspace_height BETWEEN 64 AND 50000);
