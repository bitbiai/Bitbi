-- Proposals and observation are independent of paid execution and graph writes.
ALTER TABLE canvas_agent_runs ADD COLUMN budget_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE canvas_agent_runs ADD COLUMN repair_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE canvas_agent_runs ADD COLUMN cause_json TEXT CHECK(cause_json IS NULL OR json_valid(cause_json));
ALTER TABLE canvas_agent_model_operations ADD COLUMN receipt_protocol INTEGER NOT NULL DEFAULT 1 CHECK(receipt_protocol IN (1,2));
CREATE TRIGGER canvas_agent_model_receipt_protocol_immutable BEFORE UPDATE OF receipt_protocol ON canvas_agent_model_operations
WHEN NEW.receipt_protocol IS NOT OLD.receipt_protocol
BEGIN SELECT RAISE(ABORT,'canvas_agent_model_identity_immutable'); END;
CREATE INDEX canvas_agent_project_history ON canvas_agent_runs(project_id,created_at);
CREATE TABLE canvas_agent_proposals (
 step_id TEXT PRIMARY KEY REFERENCES canvas_agent_steps(id) ON DELETE CASCADE,
 run_id TEXT NOT NULL REFERENCES canvas_agent_runs(id) ON DELETE CASCADE,
 plan_json TEXT NOT NULL CHECK(json_valid(plan_json)),
 status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','repairing','budget_required','applied','invalid')),
 validation_json TEXT CHECK(validation_json IS NULL OR json_valid(validation_json)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TRIGGER canvas_agent_proposal_immutable BEFORE UPDATE OF step_id,run_id,plan_json ON canvas_agent_proposals
WHEN NEW.step_id IS NOT OLD.step_id OR NEW.run_id IS NOT OLD.run_id OR NEW.plan_json IS NOT OLD.plan_json
BEGIN SELECT RAISE(ABORT,'canvas_agent_proposal_immutable'); END;
-- Retain paid historical plans without resuming or changing stopped productions.
INSERT INTO canvas_agent_proposals(step_id,run_id,plan_json,created_at,updated_at)
SELECT id,run_id,COALESCE(json_extract(receipt_json,'$.plan'),json_extract(receipt_json,'$.data.plan')),updated_at,updated_at
FROM canvas_agent_steps WHERE kind='plan' AND status='completed'
 AND json_type(COALESCE(json_extract(receipt_json,'$.plan'),json_extract(receipt_json,'$.data.plan')))='object';

CREATE TABLE canvas_agent_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 run_id TEXT NOT NULL REFERENCES canvas_agent_runs(id) ON DELETE CASCADE,
 event_key TEXT NOT NULL, type TEXT NOT NULL,
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json) AND length(payload_json)<=12000),
 created_at TEXT NOT NULL, UNIQUE(run_id,event_key)
);
CREATE INDEX canvas_agent_events_replay ON canvas_agent_events(run_id,id);
CREATE TRIGGER canvas_agent_event_immutable BEFORE UPDATE ON canvas_agent_events
BEGIN SELECT RAISE(ABORT,'canvas_agent_event_immutable'); END;

CREATE TABLE canvas_agent_budget_requests (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES canvas_agent_runs(id) ON DELETE CASCADE,
 reason_key TEXT NOT NULL, revision INTEGER NOT NULL, project_revision INTEGER NOT NULL, tariff_revision INTEGER NOT NULL,
 current_cap INTEGER NOT NULL, proposed_cap INTEGER NOT NULL CHECK(proposed_cap BETWEEN 1 AND 100000),
 action_json TEXT NOT NULL CHECK(json_valid(action_json)), resume_status TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined','stale')),
 decision_key TEXT, created_at TEXT NOT NULL, decided_at TEXT,
 UNIQUE(run_id,reason_key,revision), UNIQUE(run_id,decision_key), CHECK(proposed_cap>current_cap)
);
CREATE UNIQUE INDEX canvas_agent_budget_pending ON canvas_agent_budget_requests(run_id) WHERE status='pending';
CREATE TRIGGER canvas_agent_budget_request_immutable
BEFORE UPDATE OF id,run_id,reason_key,revision,project_revision,tariff_revision,current_cap,proposed_cap,action_json,resume_status ON canvas_agent_budget_requests
BEGIN SELECT RAISE(ABORT,'canvas_agent_budget_request_immutable'); END;
CREATE TRIGGER canvas_agent_budget_decision_immutable BEFORE UPDATE OF status,decision_key ON canvas_agent_budget_requests
WHEN OLD.status!='pending' AND (NEW.status IS NOT OLD.status OR NEW.decision_key IS NOT OLD.decision_key)
BEGIN SELECT RAISE(ABORT,'canvas_agent_budget_decision_immutable'); END;

-- The ledger remains the only source of charges. One operation contributes
-- one commitment: actual settlement OR its still-authorized ceiling. A wallet
-- reservation and its allocation are never counted as two expenditures.
CREATE VIEW canvas_agent_step_costs AS
WITH amounts AS (
 SELECT s.id AS step_id,s.run_id,r.project_id,s.allocation_credits,s.status AS step_status,r.status AS run_status,
  a.billing_status,a.provider_outcome,a.reservation_released_at,
  COALESCE((SELECT SUM(CASE WHEN l.amount<0 THEN -l.amount ELSE 0 END) FROM member_credit_ledger l
    WHERE l.user_id=a.user_id AND l.idempotency_key=a.idempotency_key),0) AS charged,
  CASE WHEN a.billing_status='reserved' AND a.reservation_released_at IS NULL THEN a.credit_cost ELSE 0 END AS reserved,
  CASE WHEN a.billing_status='reserved' AND a.reservation_released_at IS NULL AND a.provider_outcome IN ('dispatched','unknown') THEN a.credit_cost ELSE 0 END AS pending
 FROM canvas_agent_steps s JOIN canvas_agent_runs r ON r.id=s.run_id
 LEFT JOIN member_ai_usage_attempts_v2 a ON a.id=COALESCE(s.usage_attempt_id,
   (SELECT id FROM member_ai_usage_attempts_v2 WHERE json_extract(metadata_json,'$.canvas_agent.step_id')=s.id LIMIT 1))
)
SELECT *,MAX(charged,reserved,CASE
 WHEN billing_status='finalized' OR reservation_released_at IS NOT NULL THEN charged
 WHEN provider_outcome IN ('dispatched','unknown','succeeded') OR reserved>0 THEN allocation_credits
 WHEN step_status='rejected' OR run_status IN ('cancelled','taken_over','blocked','review_required','completed') THEN charged
 ELSE allocation_credits END) AS committed FROM amounts;

DROP TRIGGER canvas_agent_allocation;
CREATE TRIGGER canvas_agent_allocation BEFORE INSERT ON canvas_agent_steps
WHEN NOT EXISTS(SELECT 1 FROM canvas_agent_runs r WHERE r.id=NEW.run_id
 AND r.budget_credits>=NEW.allocation_credits+COALESCE((SELECT SUM(committed) FROM canvas_agent_step_costs c WHERE c.project_id=r.project_id),0)
 AND r.status IN ('queued','planning','applying','running','exporting'))
BEGIN SELECT RAISE(ABORT,'canvas_agent_budget_exceeded'); END;
CREATE TRIGGER canvas_agent_cap_amendment BEFORE UPDATE OF budget_credits,budget_revision ON canvas_agent_runs
WHEN (NEW.budget_credits IS NOT OLD.budget_credits OR NEW.budget_revision IS NOT OLD.budget_revision)
 AND NOT EXISTS(SELECT 1 FROM canvas_agent_budget_requests b WHERE b.run_id=OLD.id AND b.status='accepted'
  AND b.revision=OLD.budget_revision AND b.current_cap=OLD.budget_credits AND b.proposed_cap=NEW.budget_credits
  AND NEW.budget_revision=OLD.budget_revision+1 AND b.project_revision=OLD.expected_revision)
BEGIN SELECT RAISE(ABORT,'canvas_agent_budget_consent_required'); END;
