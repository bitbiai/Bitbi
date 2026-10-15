-- Durable production coordination. Allocations constrain the existing credit
-- gateway; they are not wallet debits or a second credit ledger.
ALTER TABLE canvas_projects ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE canvas_nodes ADD COLUMN creative_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE canvas_runs ADD COLUMN node_revision INTEGER;

CREATE TABLE canvas_agent_runs (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES canvas_projects(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id),
 request_key TEXT NOT NULL, input_json TEXT NOT NULL CHECK(json_valid(input_json)),
 status TEXT NOT NULL CHECK(status IN ('clarification_required','queued','planning','applying','running','exporting','paused','review_required','blocked','completed','cancelled','taken_over')),
 phase TEXT NOT NULL DEFAULT 'planning', expected_revision INTEGER NOT NULL,
 target_seconds REAL, tolerance_seconds REAL NOT NULL DEFAULT 0.5,
 budget_credits INTEGER, tariff_revision INTEGER, capability_revision TEXT,
 plan_json TEXT CHECK(plan_json IS NULL OR json_valid(plan_json)), result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
 error_code TEXT, lease_token TEXT, lease_until TEXT, next_attempt_at TEXT NOT NULL,
 rounds INTEGER NOT NULL DEFAULT 0, actions INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT NOT NULL,
 UNIQUE(user_id,request_key), CHECK(budget_credits IS NULL OR budget_credits BETWEEN 1 AND 100000)
);
CREATE UNIQUE INDEX canvas_agent_active_project ON canvas_agent_runs(project_id)
 WHERE status IN ('queued','planning','applying','running','exporting');
CREATE INDEX canvas_agent_due ON canvas_agent_runs(status,next_attempt_at);
CREATE TABLE canvas_agent_steps (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES canvas_agent_runs(id) ON DELETE CASCADE, step_key TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('plan','node','export','evaluate')), node_id TEXT,
 input_json TEXT NOT NULL CHECK(json_valid(input_json)),
 status TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('ready','accepted','completed','review_required','rejected')),
 allocation_credits INTEGER NOT NULL DEFAULT 0 CHECK(allocation_credits BETWEEN 0 AND 100000),
 usage_attempt_id TEXT, receipt_json TEXT CHECK(receipt_json IS NULL OR json_valid(receipt_json)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(run_id,step_key)
);
CREATE TABLE canvas_agent_controls (
 run_id TEXT NOT NULL REFERENCES canvas_agent_runs(id) ON DELETE CASCADE, request_key TEXT NOT NULL, action TEXT NOT NULL,
 created_at TEXT NOT NULL, PRIMARY KEY(run_id,request_key)
);
CREATE TRIGGER canvas_agent_allocation BEFORE INSERT ON canvas_agent_steps
WHEN NOT EXISTS(SELECT 1 FROM canvas_agent_runs r WHERE r.id=NEW.run_id
 AND r.budget_credits >= NEW.allocation_credits + COALESCE((SELECT SUM(allocation_credits) FROM canvas_agent_steps WHERE run_id=r.id),0)
 AND r.status IN ('queued','planning','applying','running','exporting'))
BEGIN SELECT RAISE(ABORT,'canvas_agent_budget_exceeded'); END;
CREATE TRIGGER canvas_agent_allocation_immutable BEFORE UPDATE OF allocation_credits,input_json,run_id,step_key,kind,node_id ON canvas_agent_steps
WHEN NEW.allocation_credits IS NOT OLD.allocation_credits OR NEW.input_json IS NOT OLD.input_json OR NEW.run_id IS NOT OLD.run_id
 OR NEW.step_key IS NOT OLD.step_key OR NEW.kind IS NOT OLD.kind OR NEW.node_id IS NOT OLD.node_id
BEGIN SELECT RAISE(ABORT,'canvas_agent_step_immutable'); END;

-- One existing gateway attempt per allocated operation. Normal manual usage is
-- unaffected. A queued operation must still be authorized at dispatch time.
CREATE UNIQUE INDEX canvas_agent_usage_identity ON member_ai_usage_attempts_v2(json_extract(metadata_json,'$.canvas_agent.step_id'))
 WHERE json_extract(metadata_json,'$.canvas_agent.step_id') IS NOT NULL;
CREATE TRIGGER canvas_agent_usage_insert BEFORE INSERT ON member_ai_usage_attempts_v2
WHEN json_extract(NEW.metadata_json,'$.canvas_agent.step_id') IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM canvas_agent_steps s JOIN canvas_agent_runs r ON r.id=s.run_id
 JOIN canvas_projects p ON p.id=r.project_id JOIN users u ON u.id=r.user_id
 WHERE s.id=json_extract(NEW.metadata_json,'$.canvas_agent.step_id') AND r.user_id=NEW.user_id
 AND s.allocation_credits>=NEW.credit_cost AND p.deleted_at IS NULL AND p.revision=r.expected_revision
 AND u.status='active' AND r.status IN ('planning','running') AND r.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
BEGIN SELECT RAISE(ABORT,'canvas_agent_authority_revoked'); END;
CREATE TRIGGER canvas_agent_usage_dispatch BEFORE UPDATE OF provider_outcome ON member_ai_usage_attempts_v2
WHEN OLD.provider_outcome='not_dispatched' AND NEW.provider_outcome='dispatched'
 AND json_extract(NEW.metadata_json,'$.canvas_agent.step_id') IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM canvas_agent_steps s JOIN canvas_agent_runs r ON r.id=s.run_id JOIN canvas_projects p ON p.id=r.project_id
 JOIN users u ON u.id=r.user_id WHERE s.id=json_extract(NEW.metadata_json,'$.canvas_agent.step_id')
 AND r.user_id=NEW.user_id AND p.deleted_at IS NULL AND p.revision=r.expected_revision
 AND u.status='active' AND r.status IN ('planning','running') AND r.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
BEGIN SELECT RAISE(ABORT,'canvas_agent_authority_revoked'); END;

CREATE TRIGGER canvas_project_assembly_revision AFTER UPDATE OF assembly_json ON canvas_projects
WHEN NEW.assembly_json IS NOT OLD.assembly_json
BEGIN UPDATE canvas_projects SET revision=revision+1 WHERE id=NEW.id; END;
CREATE TRIGGER canvas_node_creative_revision AFTER UPDATE OF config_json,content_json,model_id,title,deleted_at ON canvas_nodes
WHEN NEW.config_json IS NOT OLD.config_json OR NEW.content_json IS NOT OLD.content_json OR NEW.model_id IS NOT OLD.model_id
 OR NEW.title IS NOT OLD.title OR NEW.deleted_at IS NOT OLD.deleted_at
BEGIN
 UPDATE canvas_nodes SET creative_revision=creative_revision+1 WHERE id=NEW.id;
 UPDATE canvas_projects SET revision=revision+1 WHERE id=NEW.project_id;
END;
CREATE TRIGGER canvas_node_insert_revision AFTER INSERT ON canvas_nodes
BEGIN UPDATE canvas_projects SET revision=revision+1 WHERE id=NEW.project_id; END;
CREATE TRIGGER canvas_edge_insert_revision AFTER INSERT ON canvas_edges
BEGIN
 UPDATE canvas_nodes SET creative_revision=creative_revision+1 WHERE id=NEW.target_node_id
 AND COALESCE(json_extract(NEW.config_json,'$.purpose'),'')!='export_background_music';
 UPDATE canvas_projects SET revision=revision+1 WHERE id=NEW.project_id;
END;
CREATE TRIGGER canvas_edge_edit_revision AFTER UPDATE OF config_json,source_node_id,target_node_id,deleted_at ON canvas_edges
WHEN NEW.config_json IS NOT OLD.config_json OR NEW.source_node_id IS NOT OLD.source_node_id OR NEW.target_node_id IS NOT OLD.target_node_id OR NEW.deleted_at IS NOT OLD.deleted_at
BEGIN
 UPDATE canvas_nodes SET creative_revision=creative_revision+1 WHERE id IN (OLD.target_node_id,NEW.target_node_id)
 AND (COALESCE(json_extract(OLD.config_json,'$.purpose'),'')!='export_background_music'
   OR COALESCE(json_extract(NEW.config_json,'$.purpose'),'')!='export_background_music');
 UPDATE canvas_projects SET revision=revision+1 WHERE id=NEW.project_id;
END;
CREATE TRIGGER canvas_agent_manual_edit AFTER UPDATE OF revision,deleted_at ON canvas_projects
WHEN NEW.revision IS NOT OLD.revision OR NEW.deleted_at IS NOT OLD.deleted_at
BEGIN
 UPDATE canvas_agent_runs SET status='paused',error_code='canvas_agent_project_changed',lease_token=NULL,lease_until=NULL
 WHERE project_id=NEW.id AND status IN ('queued','planning','running','exporting');
END;
