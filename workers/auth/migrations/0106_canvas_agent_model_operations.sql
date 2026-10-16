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
 model TEXT NOT NULL CHECK(model='xai/grok-4.7'),
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
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
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
