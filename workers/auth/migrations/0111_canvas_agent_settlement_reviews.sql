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
