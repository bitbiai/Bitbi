-- Project-owned dialogue is data, never production or billing authority.
-- Reuse the existing reasoning steps, queue, receipts and credit ledger.
ALTER TABLE canvas_agent_runs ADD COLUMN purpose TEXT NOT NULL DEFAULT 'production' CHECK(purpose IN ('production','briefing'));
ALTER TABLE canvas_agent_runs ADD COLUMN policy_json TEXT CHECK(policy_json IS NULL OR json_valid(policy_json));
ALTER TABLE canvas_agent_runs ADD COLUMN brief_revision INTEGER;
CREATE TRIGGER canvas_agent_purpose_immutable BEFORE UPDATE OF purpose,policy_json,brief_revision ON canvas_agent_runs
WHEN NEW.purpose IS NOT OLD.purpose OR NEW.policy_json IS NOT OLD.policy_json OR NEW.brief_revision IS NOT OLD.brief_revision
BEGIN SELECT RAISE(ABORT,'canvas_agent_identity_immutable'); END;
DROP INDEX canvas_agent_active_project;
CREATE UNIQUE INDEX canvas_agent_active_project ON canvas_agent_runs(project_id,purpose)
 WHERE status IN ('queued','planning','applying','running','exporting');

CREATE TABLE canvas_agent_conversations (
 project_id TEXT PRIMARY KEY REFERENCES canvas_projects(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id),
 revision INTEGER NOT NULL DEFAULT 0, brief_revision INTEGER NOT NULL DEFAULT 0,
 brief_json TEXT NOT NULL CHECK(json_valid(brief_json) AND length(brief_json)<=24000),
 state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','saved','cancelled')),
 draft TEXT NOT NULL DEFAULT '' CHECK(length(draft)<=6000),
 allowance_credits INTEGER NOT NULL DEFAULT 0 CHECK(allowance_credits BETWEEN 0 AND 100000),
 allowance_tariff INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE canvas_agent_turns (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES canvas_agent_conversations(project_id) ON DELETE CASCADE,
 request_key TEXT NOT NULL, input_json TEXT NOT NULL CHECK(json_valid(input_json)),
 run_id TEXT UNIQUE REFERENCES canvas_agent_runs(id),
 conversation_revision INTEGER NOT NULL, brief_revision INTEGER NOT NULL,
 user_text TEXT NOT NULL CHECK(length(user_text)<=6000), assistant_text TEXT CHECK(length(assistant_text)<=8000),
 state TEXT NOT NULL CHECK(state IN ('pending','completed','review_required','failed','cancelled','deleted')),
 error_code TEXT, policy_json TEXT CHECK(policy_json IS NULL OR json_valid(policy_json)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(project_id,request_key)
);
CREATE UNIQUE INDEX canvas_agent_turn_pending ON canvas_agent_turns(project_id) WHERE state='pending';
CREATE INDEX canvas_agent_turn_history ON canvas_agent_turns(project_id,created_at);
CREATE TABLE canvas_agent_conversation_actions (
 project_id TEXT NOT NULL REFERENCES canvas_agent_conversations(project_id) ON DELETE CASCADE,
 request_key TEXT NOT NULL, input_json TEXT NOT NULL CHECK(json_valid(input_json)),created_at TEXT NOT NULL,
 PRIMARY KEY(project_id,request_key)
);

-- A briefing ceiling is independently approved. Production still counts all
-- project costs, including briefing, exactly once through the existing view.
DROP TRIGGER canvas_agent_allocation;
CREATE TRIGGER canvas_agent_allocation BEFORE INSERT ON canvas_agent_steps
WHEN NOT EXISTS(SELECT 1 FROM canvas_agent_runs r WHERE r.id=NEW.run_id
 AND r.budget_credits>=NEW.allocation_credits+COALESCE((SELECT SUM(c.committed) FROM canvas_agent_step_costs c
   JOIN canvas_agent_runs owner ON owner.id=c.run_id WHERE c.project_id=r.project_id
   AND (r.purpose='production' OR owner.purpose='briefing')),0)
 AND r.status IN ('queued','planning','applying','running','exporting')
 AND (r.purpose='production' OR (NEW.kind='plan' AND EXISTS(SELECT 1 FROM canvas_agent_conversations v
   WHERE v.project_id=r.project_id AND v.state='active' AND v.allowance_credits=r.budget_credits
   AND v.allowance_tariff=r.tariff_revision)
   AND NOT EXISTS(SELECT 1 FROM canvas_agent_runs active WHERE active.project_id=r.project_id AND active.purpose='production'
     AND active.status IN ('queued','planning','applying','running','exporting','paused')
     AND active.budget_credits<NEW.allocation_credits+COALESCE((SELECT SUM(committed) FROM canvas_agent_step_costs WHERE project_id=r.project_id),0)))))
BEGIN SELECT RAISE(ABORT,'canvas_agent_budget_exceeded'); END;

DROP TRIGGER canvas_agent_usage_insert;
CREATE TRIGGER canvas_agent_usage_insert BEFORE INSERT ON member_ai_usage_attempts_v2
WHEN json_extract(NEW.metadata_json,'$.canvas_agent.step_id') IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM canvas_agent_steps s JOIN canvas_agent_runs r ON r.id=s.run_id
 JOIN canvas_projects p ON p.id=r.project_id JOIN users u ON u.id=r.user_id
 WHERE s.id=json_extract(NEW.metadata_json,'$.canvas_agent.step_id') AND r.user_id=NEW.user_id
 AND s.allocation_credits>=NEW.credit_cost AND p.deleted_at IS NULL
 AND (p.revision=r.expected_revision OR (r.purpose='briefing' AND s.kind='plan'
   AND EXISTS(SELECT 1 FROM canvas_agent_conversations v WHERE v.project_id=r.project_id AND v.state='active')))
 AND (r.purpose='production' OR EXISTS(SELECT 1 FROM canvas_agent_conversations v WHERE v.project_id=r.project_id
  AND v.state='active' AND v.allowance_tariff=r.tariff_revision
  AND v.allowance_credits>=COALESCE((SELECT SUM(c.committed) FROM canvas_agent_step_costs c
     JOIN canvas_agent_runs owner ON owner.id=c.run_id WHERE c.project_id=r.project_id AND owner.purpose='briefing'),0)))
 AND u.status='active' AND r.status IN ('planning','running') AND r.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
BEGIN SELECT RAISE(ABORT,'canvas_agent_authority_revoked'); END;
DROP TRIGGER canvas_agent_usage_dispatch;
CREATE TRIGGER canvas_agent_usage_dispatch BEFORE UPDATE OF provider_outcome ON member_ai_usage_attempts_v2
WHEN OLD.provider_outcome='not_dispatched' AND NEW.provider_outcome='dispatched'
 AND json_extract(NEW.metadata_json,'$.canvas_agent.step_id') IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM canvas_agent_steps s JOIN canvas_agent_runs r ON r.id=s.run_id JOIN canvas_projects p ON p.id=r.project_id
 JOIN users u ON u.id=r.user_id WHERE s.id=json_extract(NEW.metadata_json,'$.canvas_agent.step_id')
 AND r.user_id=NEW.user_id AND p.deleted_at IS NULL
 AND (p.revision=r.expected_revision OR (r.purpose='briefing' AND s.kind='plan'
   AND EXISTS(SELECT 1 FROM canvas_agent_conversations v WHERE v.project_id=r.project_id AND v.state='active')))
 AND (r.purpose='production' OR EXISTS(SELECT 1 FROM canvas_agent_conversations v WHERE v.project_id=r.project_id
  AND v.state='active' AND v.allowance_tariff=r.tariff_revision
  AND v.allowance_credits>=COALESCE((SELECT SUM(c.committed) FROM canvas_agent_step_costs c
     JOIN canvas_agent_runs owner ON owner.id=c.run_id WHERE c.project_id=r.project_id AND owner.purpose='briefing'),0)))
 AND u.status='active' AND r.status IN ('planning','running') AND r.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
BEGIN SELECT RAISE(ABORT,'canvas_agent_authority_revoked'); END;

DROP TRIGGER canvas_agent_manual_edit;
CREATE TRIGGER canvas_agent_manual_edit AFTER UPDATE OF revision,deleted_at ON canvas_projects
WHEN NEW.revision IS NOT OLD.revision OR NEW.deleted_at IS NOT OLD.deleted_at
BEGIN
 UPDATE canvas_agent_runs SET status='paused',error_code='canvas_agent_project_changed',lease_token=NULL,lease_until=NULL
 WHERE project_id=NEW.id AND (purpose='production' OR NEW.deleted_at IS NOT NULL)
 AND status IN ('queued','planning','running','exporting');
 DELETE FROM canvas_agent_conversations WHERE project_id=NEW.id AND NEW.deleted_at IS NOT NULL;
END;
