-- Read-only explanations use the existing conversation allowance only after
-- explicit consent. Historical briefing approvals do not authorize automation.
ALTER TABLE canvas_agent_conversations ADD COLUMN diagnostic_allowance INTEGER NOT NULL DEFAULT 0 CHECK(diagnostic_allowance IN (0,1));
-- A separately audited decoder interpretation never edits a provider receipt.
ALTER TABLE canvas_agent_proposals ADD COLUMN interpretation_json TEXT CHECK(interpretation_json IS NULL OR json_valid(interpretation_json));
CREATE TRIGGER canvas_agent_proposal_interpretation_immutable BEFORE UPDATE OF interpretation_json ON canvas_agent_proposals
WHEN OLD.interpretation_json IS NOT NULL AND NEW.interpretation_json IS NOT OLD.interpretation_json
BEGIN SELECT RAISE(ABORT,'canvas_agent_interpretation_immutable'); END;

-- These rows project existing errors; they do not own production state, costs,
-- retries or notification read markers. Original receipts stay immutable.
CREATE TABLE canvas_agent_incident_rollout (
 id INTEGER PRIMARY KEY CHECK(id=1), introduced_at TEXT NOT NULL
);
INSERT INTO canvas_agent_incident_rollout VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
CREATE TABLE canvas_agent_incidents (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES canvas_projects(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id), source_key TEXT NOT NULL, source_notification_id TEXT NOT NULL,
 source_json TEXT NOT NULL CHECK(json_valid(source_json) AND length(source_json)<=4000),
 initial_context_json TEXT NOT NULL CHECK(json_valid(initial_context_json) AND length(initial_context_json)<=24000),
 context_json TEXT NOT NULL CHECK(json_valid(context_json) AND length(context_json)<=24000),
 state TEXT NOT NULL CHECK(state IN ('active','recovering','resolved')),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision BETWEEN 1 AND 3),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(project_id,source_key)
);
CREATE INDEX canvas_agent_incident_project ON canvas_agent_incidents(project_id,updated_at);
CREATE TRIGGER canvas_agent_incident_identity BEFORE UPDATE OF id,project_id,user_id,source_key,source_notification_id,source_json,initial_context_json ON canvas_agent_incidents
BEGIN SELECT RAISE(ABORT,'canvas_agent_incident_identity_immutable'); END;
CREATE TABLE canvas_agent_incident_explanations (
 incident_id TEXT NOT NULL REFERENCES canvas_agent_incidents(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 3),
 turn_id TEXT NOT NULL UNIQUE REFERENCES canvas_agent_turns(id),
 model_run_id TEXT UNIQUE REFERENCES canvas_agent_runs(id),
 state TEXT NOT NULL CHECK(state IN ('fallback','pending','model','failed','unknown','stale')),
 fallback_reason TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(incident_id,revision)
);
CREATE INDEX canvas_agent_incident_pending ON canvas_agent_incident_explanations(state,updated_at);
CREATE TRIGGER canvas_agent_incident_explanation_identity BEFORE UPDATE OF incident_id,revision,turn_id ON canvas_agent_incident_explanations
BEGIN SELECT RAISE(ABORT,'canvas_agent_incident_identity_immutable'); END;
-- Automatic diagnostic inference needs explicit, still-current consent at
-- allocation and dispatch. The normal billing triggers independently remain.
CREATE TRIGGER canvas_agent_incident_allocation BEFORE INSERT ON canvas_agent_steps
WHEN EXISTS(SELECT 1 FROM canvas_agent_runs r WHERE r.id=NEW.run_id AND json_extract(r.input_json,'$.kind')='incident_explanation')
AND NOT EXISTS(SELECT 1 FROM canvas_agent_runs r JOIN canvas_agent_incident_explanations x ON x.model_run_id=r.id
 JOIN canvas_agent_incidents i ON i.id=x.incident_id JOIN canvas_agent_conversations c ON c.project_id=i.project_id
 WHERE r.id=NEW.run_id AND c.diagnostic_allowance=1 AND c.state='active' AND i.revision=x.revision AND x.state='pending'
 AND NOT EXISTS(SELECT 1 FROM canvas_agent_runs production WHERE production.project_id=r.project_id AND production.purpose='production'
  AND production.budget_credits IS NOT NULL AND production.created_at=(SELECT MAX(latest.created_at) FROM canvas_agent_runs latest WHERE latest.project_id=r.project_id AND latest.purpose='production')
  AND production.budget_credits<NEW.allocation_credits+COALESCE((SELECT SUM(committed) FROM canvas_agent_step_costs WHERE project_id=r.project_id),0)))
BEGIN SELECT RAISE(ABORT,'canvas_agent_diagnostic_authority_required'); END;
-- An operator-reviewed continuation may accept an evidenced operational-only
-- brief update without rewriting the original run identity. Further changes
-- revoke new work; already accepted receipts can still settle normally.
CREATE TRIGGER canvas_agent_review_allocation BEFORE INSERT ON canvas_agent_steps
WHEN EXISTS(SELECT 1 FROM canvas_agent_proposals review JOIN canvas_agent_runs r ON r.id=review.run_id
 WHERE r.id=NEW.run_id AND json_extract(review.interpretation_json,'$.authority.strategy')='bounded-correction'
 AND NOT EXISTS(SELECT 1 FROM canvas_agent_conversations c WHERE c.project_id=r.project_id AND c.user_id=r.user_id
  AND c.state!='cancelled' AND c.brief_revision=json_extract(review.interpretation_json,'$.authority.effectiveBriefRevision')))
BEGIN SELECT RAISE(ABORT,'canvas_agent_recovery_brief_changed'); END;
CREATE TRIGGER canvas_agent_review_dispatch BEFORE UPDATE OF provider_outcome ON member_ai_usage_attempts_v2
WHEN OLD.provider_outcome='not_dispatched' AND NEW.provider_outcome='dispatched'
 AND EXISTS(SELECT 1 FROM canvas_agent_steps s JOIN canvas_agent_proposals review ON review.run_id=s.run_id
 JOIN canvas_agent_runs r ON r.id=s.run_id WHERE s.id=json_extract(NEW.metadata_json,'$.canvas_agent.step_id')
 AND json_extract(review.interpretation_json,'$.authority.strategy')='bounded-correction'
 AND NOT EXISTS(SELECT 1 FROM canvas_agent_conversations c WHERE c.project_id=r.project_id AND c.user_id=r.user_id
  AND c.state!='cancelled' AND c.brief_revision=json_extract(review.interpretation_json,'$.authority.effectiveBriefRevision')))
BEGIN SELECT RAISE(ABORT,'canvas_agent_recovery_brief_changed'); END;
CREATE TRIGGER canvas_agent_incident_dispatch BEFORE UPDATE OF provider_outcome ON member_ai_usage_attempts_v2
WHEN OLD.provider_outcome='not_dispatched' AND NEW.provider_outcome='dispatched'
AND EXISTS(SELECT 1 FROM canvas_agent_steps s JOIN canvas_agent_runs r ON r.id=s.run_id
 WHERE s.id=json_extract(NEW.metadata_json,'$.canvas_agent.step_id') AND json_extract(r.input_json,'$.kind')='incident_explanation')
AND NOT EXISTS(SELECT 1 FROM canvas_agent_steps s JOIN canvas_agent_runs r ON r.id=s.run_id
 JOIN canvas_agent_incident_explanations x ON x.model_run_id=r.id JOIN canvas_agent_incidents i ON i.id=x.incident_id
 JOIN canvas_agent_conversations c ON c.project_id=i.project_id JOIN canvas_agent_turns t ON t.id=x.turn_id
 WHERE s.id=json_extract(NEW.metadata_json,'$.canvas_agent.step_id') AND c.diagnostic_allowance=1 AND c.state='active'
 AND i.revision=x.revision AND x.state='pending' AND t.state='pending')
BEGIN SELECT RAISE(ABORT,'canvas_agent_diagnostic_authority_required'); END;
-- Redact private derived context with its project. Retain identifiers needed by
-- accepted receipts, just as the existing project-deletion trigger does for turns.
CREATE TRIGGER canvas_agent_incident_redact AFTER UPDATE OF deleted_at ON canvas_projects
WHEN NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL
BEGIN
 DELETE FROM canvas_agent_incident_explanations WHERE incident_id IN (SELECT id FROM canvas_agent_incidents WHERE project_id=NEW.id);
 DELETE FROM canvas_agent_incidents WHERE project_id=NEW.id;
END;
