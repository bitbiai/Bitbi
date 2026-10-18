-- Immediate production is an explicit, project-scoped user intention. It is
-- separate from both a dialogue allowance and the existing production ledger.
CREATE TABLE canvas_agent_start_intents (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES canvas_projects(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id), request_key TEXT NOT NULL,
 input_json TEXT NOT NULL CHECK(json_valid(input_json)),
 source_turn_id TEXT REFERENCES canvas_agent_turns(id),
 expected_revision INTEGER NOT NULL, source_brief_revision INTEGER NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0,
 state TEXT NOT NULL CHECK(state IN ('waiting','approval_required','authorized','started','blocked','cancelled')),
 scope_json TEXT CHECK(scope_json IS NULL OR json_valid(scope_json)),
 quote_json TEXT CHECK(quote_json IS NULL OR json_valid(quote_json)),
 authorization_json TEXT CHECK(authorization_json IS NULL OR json_valid(authorization_json)),
 run_id TEXT REFERENCES canvas_agent_runs(id), error_code TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT NOT NULL,
 UNIQUE(project_id,request_key)
);
CREATE UNIQUE INDEX canvas_agent_start_intent_active ON canvas_agent_start_intents(project_id)
 WHERE state IN ('waiting','approval_required','authorized');
CREATE INDEX canvas_agent_start_intent_recovery ON canvas_agent_start_intents(state,updated_at);
CREATE TRIGGER canvas_agent_start_intent_identity BEFORE UPDATE OF id,project_id,user_id,request_key,input_json,source_turn_id,expected_revision,source_brief_revision ON canvas_agent_start_intents
WHEN NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.user_id IS NOT OLD.user_id
 OR NEW.request_key IS NOT OLD.request_key OR NEW.input_json IS NOT OLD.input_json
 OR NEW.source_turn_id IS NOT OLD.source_turn_id OR NEW.expected_revision IS NOT OLD.expected_revision
 OR NEW.source_brief_revision IS NOT OLD.source_brief_revision
BEGIN SELECT RAISE(ABORT,'canvas_agent_start_intent_identity_immutable'); END;

-- User/manual stop decisions fence queued intentions too, including after a
-- late model callback or an ambiguous browser acknowledgement.
CREATE TRIGGER canvas_agent_start_intent_manual_edit AFTER UPDATE OF revision,deleted_at ON canvas_projects
WHEN NEW.revision IS NOT OLD.revision OR NEW.deleted_at IS NOT OLD.deleted_at
BEGIN
 UPDATE canvas_agent_start_intents SET state='cancelled',revision=revision+1,error_code='canvas_agent_project_changed',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE project_id=NEW.id AND state IN ('waiting','approval_required','authorized');
END;
CREATE TRIGGER canvas_agent_start_intent_briefing_stop AFTER UPDATE OF state ON canvas_agent_conversations
WHEN NEW.state IN ('saved','cancelled')
BEGIN
 UPDATE canvas_agent_start_intents SET state='cancelled',revision=revision+1,error_code='canvas_agent_conversation_stopped',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE project_id=NEW.project_id AND state IN ('waiting','approval_required','authorized');
END;
CREATE TRIGGER canvas_agent_start_intent_production_stop AFTER INSERT ON canvas_agent_controls
WHEN NEW.action IN ('pause','cancel','takeover')
BEGIN
 UPDATE canvas_agent_start_intents SET state='cancelled',revision=revision+1,error_code='canvas_agent_stopped',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE project_id=(SELECT project_id FROM canvas_agent_runs WHERE id=NEW.run_id)
 AND state IN ('waiting','approval_required','authorized');
END;

CREATE TABLE canvas_agent_action_receipts (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES canvas_projects(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id),
 turn_id TEXT NOT NULL REFERENCES canvas_agent_turns(id) ON DELETE CASCADE,
 ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 7),
 input_json TEXT NOT NULL CHECK(json_valid(input_json)),
 state TEXT NOT NULL CHECK(state IN ('proposed','executing','completed','confirmation_required','review_required','failed')),
 result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(turn_id,ordinal)
);
CREATE INDEX canvas_agent_action_recovery ON canvas_agent_action_receipts(state,updated_at);
CREATE INDEX canvas_agent_action_pending ON canvas_agent_action_receipts(updated_at)
 WHERE state='completed' AND json_extract(result_json,'$.pending')=1;
CREATE TRIGGER canvas_agent_action_identity BEFORE UPDATE OF id,project_id,user_id,turn_id,ordinal,input_json ON canvas_agent_action_receipts
WHEN NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.user_id IS NOT OLD.user_id
 OR NEW.turn_id IS NOT OLD.turn_id OR NEW.ordinal IS NOT OLD.ordinal OR NEW.input_json IS NOT OLD.input_json
BEGIN SELECT RAISE(ABORT,'canvas_agent_action_identity_immutable'); END;

-- A stop decision fences still-unapplied conversational proposals, including
-- confirmations opened before a manual stop. Accepted work keeps its receipts.
CREATE TRIGGER canvas_agent_actions_production_stop AFTER INSERT ON canvas_agent_controls
WHEN NEW.action IN ('pause','cancel','takeover')
BEGIN
 UPDATE canvas_agent_action_receipts SET state='failed',result_json='{"code":"canvas_agent_stopped"}',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE project_id=(SELECT project_id FROM canvas_agent_runs WHERE id=NEW.run_id)
 AND state IN ('proposed','confirmation_required')
 AND json_extract(input_json,'$.action.type') NOT IN ('production_pause','production_cancel','production_takeover','status','brief_summary','show_project','show_result','focus_node');
END;
