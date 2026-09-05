-- REL-01: durable outcome receipts survive reservation expiry and replay cleanup.
-- Additive columns; unknown is deliberately independent of legacy status enums.

ALTER TABLE member_ai_usage_attempts ADD COLUMN provider_outcome TEXT NOT NULL DEFAULT 'not_dispatched' CHECK (provider_outcome IN ('not_dispatched','dispatched','unknown','succeeded','failed'));
ALTER TABLE member_ai_usage_attempts ADD COLUMN dispatch_token TEXT;
ALTER TABLE member_ai_usage_attempts ADD COLUMN dispatched_at TEXT;
ALTER TABLE member_ai_usage_attempts ADD COLUMN unknown_at TEXT;
ALTER TABLE member_ai_usage_attempts ADD COLUMN reservation_released_at TEXT;
ALTER TABLE member_ai_usage_attempts ADD COLUMN late_outcome TEXT;
ALTER TABLE member_ai_usage_attempts ADD COLUMN late_evidence_json TEXT NOT NULL DEFAULT '{}';
-- Historical generic failures do not prove that a provider did no work.
UPDATE member_ai_usage_attempts
SET provider_outcome = CASE WHEN provider_status = 'succeeded' THEN 'succeeded' ELSE 'unknown' END,
    dispatch_token = 'legacy:' || id,
    dispatched_at = created_at,
    unknown_at = CASE WHEN provider_status <> 'succeeded' THEN updated_at ELSE NULL END,
    reservation_released_at = CASE WHEN billing_status = 'released' THEN updated_at ELSE NULL END
WHERE provider_status <> 'not_started';

-- A stale Worker may not reset an unknown or already dispatched identity.
CREATE TRIGGER member_ai_usage_attempts_no_redispatch
BEFORE UPDATE OF status, provider_outcome ON member_ai_usage_attempts
WHEN (NEW.status = 'reserved' OR NEW.provider_outcome = 'not_dispatched')
 AND OLD.provider_outcome <> 'not_dispatched'
BEGIN SELECT RAISE(ABORT, 'ai_attempt_redispatch_forbidden'); END;

-- Fail the whole D1 batch, not only its ledger INSERT: bucket mutations in the
-- same batch must also roll back. Unrelated ledger entries are unaffected.
CREATE TRIGGER member_ai_usage_attempts_debit_guard
BEFORE INSERT ON member_credit_ledger
WHEN NEW.amount < 0 AND EXISTS (
 SELECT 1 FROM member_ai_usage_attempts a WHERE a.user_id = NEW.user_id
 AND a.idempotency_key = NEW.idempotency_key
 AND (a.provider_outcome <> 'succeeded' OR a.reservation_released_at IS NOT NULL
      OR a.status <> 'finalizing' OR a.billing_status <> 'reserved')
)
BEGIN SELECT RAISE(ABORT, 'ai_attempt_settlement_forbidden'); END;

CREATE INDEX idx_member_ai_usage_attempts_outcome_expiry ON member_ai_usage_attempts(provider_outcome, billing_status, expires_at);

ALTER TABLE ai_usage_attempts ADD COLUMN provider_outcome TEXT NOT NULL DEFAULT 'not_dispatched' CHECK (provider_outcome IN ('not_dispatched','dispatched','unknown','succeeded','failed'));
ALTER TABLE ai_usage_attempts ADD COLUMN dispatch_token TEXT;
ALTER TABLE ai_usage_attempts ADD COLUMN dispatched_at TEXT;
ALTER TABLE ai_usage_attempts ADD COLUMN unknown_at TEXT;
ALTER TABLE ai_usage_attempts ADD COLUMN reservation_released_at TEXT;
ALTER TABLE ai_usage_attempts ADD COLUMN late_outcome TEXT;
ALTER TABLE ai_usage_attempts ADD COLUMN late_evidence_json TEXT NOT NULL DEFAULT '{}';
-- Historical generic failures do not prove that a provider did no work.
UPDATE ai_usage_attempts
SET provider_outcome = CASE WHEN provider_status = 'succeeded' THEN 'succeeded' ELSE 'unknown' END,
    dispatch_token = 'legacy:' || id,
    dispatched_at = created_at,
    unknown_at = CASE WHEN provider_status <> 'succeeded' THEN updated_at ELSE NULL END,
    reservation_released_at = CASE WHEN billing_status = 'released' THEN updated_at ELSE NULL END
WHERE provider_status <> 'not_started';

-- A stale Worker may not reset an unknown or already dispatched identity.
CREATE TRIGGER ai_usage_attempts_no_redispatch
BEFORE UPDATE OF status, provider_outcome ON ai_usage_attempts
WHEN (NEW.status = 'reserved' OR NEW.provider_outcome = 'not_dispatched')
 AND OLD.provider_outcome <> 'not_dispatched'
BEGIN SELECT RAISE(ABORT, 'ai_attempt_redispatch_forbidden'); END;

-- Fail the whole D1 batch, not only its ledger INSERT: bucket mutations in the
-- same batch must also roll back. Unrelated ledger entries are unaffected.
CREATE TRIGGER ai_usage_attempts_debit_guard
BEFORE INSERT ON credit_ledger
WHEN NEW.amount < 0 AND EXISTS (
 SELECT 1 FROM ai_usage_attempts a WHERE a.organization_id = NEW.organization_id
 AND a.idempotency_key = NEW.idempotency_key
 AND (a.provider_outcome <> 'succeeded' OR a.reservation_released_at IS NOT NULL
      OR a.status <> 'finalizing' OR a.billing_status <> 'reserved')
)
BEGIN SELECT RAISE(ABORT, 'ai_attempt_settlement_forbidden'); END;

CREATE INDEX idx_ai_usage_attempts_outcome_expiry ON ai_usage_attempts(provider_outcome, billing_status, expires_at);

-- Queue/Admin outcome state is independent of legacy UI status enums.
ALTER TABLE admin_ai_usage_attempts ADD COLUMN provider_outcome TEXT NOT NULL DEFAULT 'not_dispatched' CHECK (provider_outcome IN ('not_dispatched','dispatched','unknown','succeeded','failed'));
ALTER TABLE admin_ai_usage_attempts ADD COLUMN dispatch_token TEXT;
ALTER TABLE admin_ai_usage_attempts ADD COLUMN dispatched_at TEXT;
ALTER TABLE admin_ai_usage_attempts ADD COLUMN unknown_at TEXT;
ALTER TABLE admin_ai_usage_attempts ADD COLUMN late_outcome TEXT;
ALTER TABLE admin_ai_usage_attempts ADD COLUMN late_evidence_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE admin_ai_usage_attempts ADD COLUMN platform_exposure_units INTEGER NOT NULL DEFAULT 0 CHECK (platform_exposure_units >= 0);
ALTER TABLE admin_ai_usage_attempts ADD COLUMN platform_window_day TEXT;
ALTER TABLE admin_ai_usage_attempts ADD COLUMN platform_window_month TEXT;

ALTER TABLE ai_video_jobs ADD COLUMN provider_outcome TEXT NOT NULL DEFAULT 'not_dispatched' CHECK (provider_outcome IN ('not_dispatched','dispatched','unknown','succeeded','failed'));
ALTER TABLE ai_video_jobs ADD COLUMN dispatch_token TEXT;
ALTER TABLE ai_video_jobs ADD COLUMN processing_token TEXT;
ALTER TABLE ai_video_jobs ADD COLUMN dispatched_at TEXT;
ALTER TABLE ai_video_jobs ADD COLUMN unknown_at TEXT;
ALTER TABLE ai_video_jobs ADD COLUMN late_outcome TEXT;
ALTER TABLE ai_video_jobs ADD COLUMN late_evidence_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE ai_video_jobs ADD COLUMN provider_result_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE ai_video_jobs ADD COLUMN platform_exposure_units INTEGER NOT NULL DEFAULT 0 CHECK (platform_exposure_units >= 0);
ALTER TABLE ai_video_jobs ADD COLUMN platform_window_day TEXT;
ALTER TABLE ai_video_jobs ADD COLUMN platform_window_month TEXT;

-- Existing generic failures/expired processing are not proof of no dispatch.
UPDATE admin_ai_usage_attempts
SET provider_outcome = CASE WHEN provider_status = 'succeeded' THEN 'succeeded' ELSE 'unknown' END,
    dispatch_token = 'legacy:' || id,
    dispatched_at = created_at,
    unknown_at = CASE WHEN provider_status <> 'succeeded' THEN updated_at ELSE NULL END,
    platform_window_day = substr(created_at, 1, 10),
    platform_window_month = substr(created_at, 1, 7),
    platform_exposure_units = CASE WHEN operation_key = 'admin.video.job.recover' THEN 0 WHEN json_valid(budget_policy_json)
      THEN min(1000000000, max(1, ceil(CAST(coalesce(json_extract(budget_policy_json, '$.estimated_cost_units'), json_extract(budget_policy_json, '$.estimatedCostUnits'), json_extract(budget_policy_json, '$.estimated_credits'), json_extract(budget_policy_json, '$.estimatedCredits'), 1) AS REAL)))) ELSE 1 END
WHERE provider_status <> 'not_started';

UPDATE ai_video_jobs
SET provider_outcome = CASE WHEN status = 'succeeded' THEN 'succeeded' ELSE 'unknown' END,
    dispatch_token = 'legacy:' || id,
    dispatched_at = created_at,
    unknown_at = CASE WHEN status <> 'succeeded' THEN updated_at ELSE NULL END,
    platform_window_day = substr(created_at, 1, 10),
    platform_window_month = substr(created_at, 1, 7),
    platform_exposure_units = CASE WHEN json_valid(budget_policy_json)
      THEN min(1000000000, max(1, ceil(CAST(coalesce(json_extract(budget_policy_json, '$.estimated_cost_units'), json_extract(budget_policy_json, '$.estimatedCostUnits'), json_extract(budget_policy_json, '$.estimated_credits'), json_extract(budget_policy_json, '$.estimatedCredits'), 1) AS REAL)))) ELSE 1 END
WHERE status = 'succeeded' OR provider_task_id IS NOT NULL OR attempt_count > 0
   OR CASE WHEN json_valid(budget_policy_json) THEN json_extract(budget_policy_json, '$.provider_task_create.attempted') = 1 ELSE 0 END;

CREATE INDEX idx_admin_ai_attempts_platform_exposure ON admin_ai_usage_attempts (budget_scope, platform_window_month, provider_outcome);
CREATE INDEX idx_ai_video_jobs_platform_exposure ON ai_video_jobs (platform_window_month, provider_outcome);
CREATE INDEX idx_ai_video_jobs_dispatch_outcome ON ai_video_jobs (provider_outcome, locked_until);
