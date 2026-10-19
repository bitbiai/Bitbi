-- Project-selected assistants affect new operations only. Historical runs retain Grok.
ALTER TABLE canvas_agent_conversations ADD COLUMN assistant_model_id TEXT NOT NULL DEFAULT 'xai/grok-4.7' CHECK(assistant_model_id IN ('xai/grok-4.7','anthropic/claude-fable-5'));
ALTER TABLE canvas_agent_conversations ADD COLUMN assistant_model_revision INTEGER NOT NULL DEFAULT 0 CHECK(assistant_model_revision>=0);
ALTER TABLE canvas_agent_runs ADD COLUMN model_id TEXT NOT NULL DEFAULT 'xai/grok-4.7' CHECK(model_id IN ('xai/grok-4.7','anthropic/claude-fable-5'));
ALTER TABLE canvas_agent_runs ADD COLUMN model_revision INTEGER NOT NULL DEFAULT 0 CHECK(model_revision>=0);
CREATE TRIGGER canvas_agent_run_model_immutable BEFORE UPDATE OF model_id,model_revision ON canvas_agent_runs
WHEN NEW.model_id IS NOT OLD.model_id OR NEW.model_revision IS NOT OLD.model_revision
BEGIN SELECT RAISE(ABORT,'canvas_agent_identity_immutable'); END;
CREATE TABLE canvas_agent_model_selections (
 project_id TEXT NOT NULL REFERENCES canvas_projects(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id), request_key TEXT NOT NULL,
 input_json TEXT NOT NULL CHECK(json_valid(input_json)), model_id TEXT NOT NULL,
 model_revision INTEGER NOT NULL CHECK(model_revision>=0), created_at TEXT NOT NULL,
 PRIMARY KEY(project_id,request_key)
);
CREATE TRIGGER canvas_agent_model_selection_immutable BEFORE UPDATE ON canvas_agent_model_selections
BEGIN SELECT RAISE(ABORT,'canvas_agent_model_selection_immutable'); END;

-- Snapshot both sides of the real CASCADE relationship before either rebuild.
-- No request, receipt, tariff or reconciliation history is reinterpreted.
CREATE TABLE canvas_model_0112_snapshot AS SELECT * FROM canvas_agent_model_operations;
CREATE TABLE canvas_review_0112_snapshot AS SELECT * FROM canvas_agent_settlement_reviews;
DROP TABLE canvas_agent_settlement_reviews;
DROP TABLE canvas_agent_model_operations;
-- One immutable paid identity per Canvas reasoning step. Transport timeouts do
-- not authorize a second submission. Receipts outlive the orchestration lease.
CREATE TABLE canvas_agent_model_operations (
 id TEXT PRIMARY KEY,
 step_id TEXT NOT NULL UNIQUE REFERENCES canvas_agent_steps(id) ON DELETE CASCADE,
 run_id TEXT NOT NULL REFERENCES canvas_agent_runs(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id),
 usage_attempt_id TEXT NOT NULL UNIQUE,
 dispatch_token TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('plan','evaluate')),
 model TEXT NOT NULL CHECK(model IN ('xai/grok-4.7','anthropic/claude-fable-5')),
 request_id TEXT NOT NULL,
 input_digest TEXT NOT NULL,
 context_json TEXT NOT NULL CHECK(json_valid(context_json)),
 caller_policy_json TEXT NOT NULL CHECK(json_valid(caller_policy_json)),
 state TEXT NOT NULL CHECK(state IN ('dispatching','pending','unknown','received','completed','rejected')),
 provider_run_id TEXT,
 response_json TEXT CHECK(response_json IS NULL OR json_valid(response_json)),
 receipt_json TEXT CHECK(receipt_json IS NULL OR json_valid(receipt_json)),
 diagnostic_json TEXT CHECK(diagnostic_json IS NULL OR json_valid(diagnostic_json)),
 error_code TEXT,
 reconcile_attempts INTEGER NOT NULL DEFAULT 0,
 dispatched_at TEXT NOT NULL, response_at TEXT, completed_at TEXT,
 next_attempt_at TEXT NOT NULL, receipt_deadline TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 receipt_protocol INTEGER NOT NULL DEFAULT 1 CHECK(receipt_protocol IN (1,2))
);
CREATE INDEX canvas_agent_model_due ON canvas_agent_model_operations(state,next_attempt_at);
CREATE TRIGGER canvas_agent_model_identity_immutable
BEFORE UPDATE OF id,step_id,run_id,user_id,usage_attempt_id,dispatch_token,kind,model,request_id,input_digest,context_json,caller_policy_json,dispatched_at,receipt_deadline ON canvas_agent_model_operations
WHEN NEW.id IS NOT OLD.id OR NEW.step_id IS NOT OLD.step_id OR NEW.run_id IS NOT OLD.run_id OR NEW.user_id IS NOT OLD.user_id
 OR NEW.usage_attempt_id IS NOT OLD.usage_attempt_id OR NEW.dispatch_token IS NOT OLD.dispatch_token OR NEW.kind IS NOT OLD.kind
 OR NEW.model IS NOT OLD.model OR NEW.request_id IS NOT OLD.request_id OR NEW.input_digest IS NOT OLD.input_digest
 OR NEW.context_json IS NOT OLD.context_json OR NEW.caller_policy_json IS NOT OLD.caller_policy_json OR NEW.dispatched_at IS NOT OLD.dispatched_at OR NEW.receipt_deadline IS NOT OLD.receipt_deadline
BEGIN SELECT RAISE(ABORT,'canvas_agent_model_identity_immutable'); END;
CREATE TRIGGER canvas_agent_model_receipt_immutable
BEFORE UPDATE OF provider_run_id,response_json,receipt_json,state ON canvas_agent_model_operations
WHEN (OLD.provider_run_id IS NOT NULL AND NEW.provider_run_id IS NOT OLD.provider_run_id)
 OR (OLD.response_json IS NOT NULL AND NEW.response_json IS NOT OLD.response_json)
 OR (OLD.receipt_json IS NOT NULL AND NEW.receipt_json IS NOT OLD.receipt_json)
 OR (OLD.state IN ('completed','rejected') AND NEW.state IS NOT OLD.state)
BEGIN SELECT RAISE(ABORT,'canvas_agent_model_receipt_immutable'); END;

CREATE TRIGGER canvas_agent_model_receipt_protocol_immutable BEFORE UPDATE OF receipt_protocol ON canvas_agent_model_operations
WHEN NEW.receipt_protocol IS NOT OLD.receipt_protocol
BEGIN SELECT RAISE(ABORT,'canvas_agent_model_identity_immutable'); END;
INSERT INTO canvas_agent_model_operations SELECT * FROM canvas_model_0112_snapshot;
-- Operator-reviewed settlement of an already stored planning completion. This
-- receipt never changes the original quote, provider operation or retry history.
CREATE TABLE canvas_agent_settlement_reviews (
 id TEXT PRIMARY KEY,
 operation_id TEXT NOT NULL UNIQUE REFERENCES canvas_agent_model_operations(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES canvas_projects(id) ON DELETE CASCADE,
 run_id TEXT NOT NULL REFERENCES canvas_agent_runs(id) ON DELETE CASCADE,
 step_id TEXT NOT NULL REFERENCES canvas_agent_steps(id) ON DELETE CASCADE,
 usage_attempt_id TEXT NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id),
 request_id TEXT NOT NULL,
 input_digest TEXT NOT NULL,
 receipt_digest TEXT NOT NULL,
 response_digest TEXT NOT NULL,
 tariff_digest TEXT NOT NULL,
 review_digest TEXT NOT NULL UNIQUE,
 units_json TEXT NOT NULL CHECK(json_valid(units_json)),
 diagnostics_json TEXT NOT NULL CHECK(json_valid(diagnostics_json)),
 reservation_credits INTEGER NOT NULL CHECK(reservation_credits BETWEEN 1 AND 100000),
 settlement_credits INTEGER NOT NULL CHECK(settlement_credits BETWEEN 1 AND reservation_credits),
 project_cap_credits INTEGER NOT NULL CHECK(project_cap_credits BETWEEN reservation_credits AND 100000),
 budget_revision INTEGER NOT NULL,
 project_revision INTEGER NOT NULL,
 brief_revision INTEGER,
 original_reconcile_attempts INTEGER NOT NULL CHECK(original_reconcile_attempts=5),
 authorization_ref TEXT NOT NULL,
 actor TEXT NOT NULL,
 allow_new_reasoning INTEGER NOT NULL DEFAULT 0 CHECK(allow_new_reasoning=0),
 state TEXT NOT NULL CHECK(state IN ('approved','settled','completed','held')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 lease_token TEXT,
 lease_until TEXT,
 error_code TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 settled_at TEXT,
 continued_at TEXT
);
CREATE INDEX canvas_agent_settlement_review_run ON canvas_agent_settlement_reviews(run_id);
CREATE TRIGGER canvas_agent_settlement_review_immutable
BEFORE UPDATE OF id,operation_id,project_id,run_id,step_id,usage_attempt_id,user_id,request_id,input_digest,
 receipt_digest,response_digest,tariff_digest,review_digest,units_json,diagnostics_json,reservation_credits,
 settlement_credits,project_cap_credits,budget_revision,project_revision,brief_revision,
 original_reconcile_attempts,authorization_ref,actor,allow_new_reasoning,created_at
ON canvas_agent_settlement_reviews
BEGIN SELECT RAISE(ABORT,'canvas_agent_settlement_review_immutable'); END;
CREATE TRIGGER canvas_agent_settlement_review_terminal
BEFORE UPDATE OF state ON canvas_agent_settlement_reviews
WHEN OLD.state IN ('completed','held') AND NEW.state IS NOT OLD.state
BEGIN SELECT RAISE(ABORT,'canvas_agent_settlement_review_terminal'); END;

INSERT INTO canvas_agent_settlement_reviews SELECT * FROM canvas_review_0112_snapshot;
DROP TABLE canvas_review_0112_snapshot;
DROP TABLE canvas_model_0112_snapshot;

-- Conversational consent is an authorization receipt, not a second cost ledger.
CREATE TABLE canvas_agent_conversation_decisions (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES canvas_projects(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id),
 request_key TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('production_budget','production_start','briefing_allowance')),
 state TEXT NOT NULL CHECK(state IN ('pending','consumed','cancelled','expired')),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 input_json TEXT NOT NULL CHECK(json_valid(input_json)),
 scope_json TEXT NOT NULL CHECK(json_valid(scope_json)),
 source_turn_id TEXT REFERENCES canvas_agent_turns(id),
 decision_key TEXT,
 run_id TEXT REFERENCES canvas_agent_runs(id),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT NOT NULL,
 UNIQUE(project_id,request_key)
);
CREATE UNIQUE INDEX canvas_agent_conversation_decision_current ON canvas_agent_conversation_decisions(project_id) WHERE state='pending';
CREATE TRIGGER canvas_agent_conversation_decision_identity BEFORE UPDATE OF id,project_id,user_id,request_key,kind,input_json,scope_json,source_turn_id,created_at,expires_at ON canvas_agent_conversation_decisions
WHEN NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.user_id IS NOT OLD.user_id
 OR NEW.request_key IS NOT OLD.request_key OR NEW.kind IS NOT OLD.kind OR NEW.input_json IS NOT OLD.input_json
 OR NEW.scope_json IS NOT OLD.scope_json OR NEW.source_turn_id IS NOT OLD.source_turn_id
 OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at
BEGIN SELECT RAISE(ABORT,'canvas_agent_decision_identity_immutable'); END;
CREATE TRIGGER canvas_agent_conversation_decision_project_edit AFTER UPDATE OF revision,deleted_at ON canvas_projects
WHEN NEW.revision IS NOT OLD.revision OR NEW.deleted_at IS NOT OLD.deleted_at
BEGIN
 UPDATE canvas_agent_conversation_decisions SET state='cancelled',revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE project_id=NEW.id AND state='pending';
END;
CREATE TRIGGER canvas_agent_conversation_decision_context_edit AFTER UPDATE OF brief_revision,assistant_model_id,assistant_model_revision,state ON canvas_agent_conversations
WHEN NEW.brief_revision IS NOT OLD.brief_revision OR NEW.assistant_model_id IS NOT OLD.assistant_model_id
 OR NEW.assistant_model_revision IS NOT OLD.assistant_model_revision OR NEW.state IN ('saved','cancelled')
BEGIN
 UPDATE canvas_agent_conversation_decisions SET state='cancelled',revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE project_id=NEW.project_id AND state='pending';
END;
CREATE TRIGGER canvas_agent_conversation_decision_stop AFTER INSERT ON canvas_agent_controls
WHEN NEW.action IN ('pause','cancel','takeover')
BEGIN
 UPDATE canvas_agent_conversation_decisions SET state='cancelled',revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE project_id=(SELECT project_id FROM canvas_agent_runs WHERE id=NEW.run_id) AND state='pending';
END;

-- Image capacity coordinates existing member/organization requests, not billing.
CREATE TABLE image_generation_slots (
 id TEXT PRIMARY KEY,
 usage_id TEXT,
 usage_scope TEXT NOT NULL CHECK(usage_scope IN ('member','organization','admin')),
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT REFERENCES canvas_projects(id) ON DELETE CASCADE,
 job_id TEXT REFERENCES member_generation_jobs(id) ON DELETE CASCADE,
 provider_key TEXT NOT NULL,
 model_id TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'waiting' CHECK(state IN ('waiting','active','unknown','finished')),
 policy_revision TEXT NOT NULL,
 token TEXT,
 lease_until TEXT,
 dispatched_at TEXT,
 finished_at TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX image_generation_slots_active ON image_generation_slots(state,provider_key,user_id,project_id);
CREATE INDEX image_generation_slots_fairness ON image_generation_slots(state,created_at);
CREATE TRIGGER image_generation_slot_identity BEFORE UPDATE OF id,usage_id,usage_scope,user_id,project_id,job_id,provider_key,model_id ON image_generation_slots
WHEN NEW.id IS NOT OLD.id OR NEW.usage_id IS NOT OLD.usage_id OR NEW.usage_scope IS NOT OLD.usage_scope
 OR NEW.user_id IS NOT OLD.user_id OR NEW.project_id IS NOT OLD.project_id
 OR (NEW.job_id IS NOT OLD.job_id AND (OLD.job_id IS NOT NULL OR OLD.state!='waiting' OR OLD.dispatched_at IS NOT NULL
   OR NOT EXISTS(SELECT 1 FROM member_generation_jobs j WHERE j.id=NEW.job_id AND j.usage_attempt_id=OLD.usage_id AND j.user_id=OLD.user_id)))
 OR NEW.provider_key IS NOT OLD.provider_key OR NEW.model_id IS NOT OLD.model_id
BEGIN SELECT RAISE(ABORT,'image_generation_identity_immutable'); END;
