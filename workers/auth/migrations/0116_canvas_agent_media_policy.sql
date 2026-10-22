-- Assistant media constraints are project preferences, not wallet balances.
-- Existing jobs default to the historical unrestricted revision zero.
ALTER TABLE canvas_projects ADD COLUMN media_policy_revision INTEGER NOT NULL DEFAULT 0 CHECK(media_policy_revision>=0);
ALTER TABLE canvas_agent_runs ADD COLUMN media_policy_revision INTEGER NOT NULL DEFAULT 0 CHECK(media_policy_revision>=0);
CREATE TABLE canvas_agent_media_policies (
 project_id TEXT NOT NULL REFERENCES canvas_projects(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id),
 revision INTEGER NOT NULL CHECK(revision>0), request_key TEXT NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN ('automatic','selected')), models_json TEXT NOT NULL CHECK(json_valid(models_json) AND json_type(models_json)='array'),
 created_at TEXT NOT NULL, PRIMARY KEY(project_id,revision), UNIQUE(user_id,request_key)
);
CREATE TRIGGER canvas_agent_media_policy_immutable BEFORE UPDATE ON canvas_agent_media_policies
BEGIN SELECT RAISE(ABORT,'canvas_agent_media_policy_immutable'); END;

-- Model identity comes from immutable accepted step input; deleting a node does
-- not delete its cost history. Use the existing ledger projection exactly once.
CREATE VIEW canvas_agent_media_action_costs AS
WITH source AS (
 SELECT x.id,x.project_id,x.state,c.id AS canvas_run_id,a.id AS usage_attempt_id,COALESCE(json_extract(x.result_json,'$.prepared.modelId'),c.model_id,a.result_model) AS model_id,
  COALESCE(json_extract(x.result_json,'$.prepared.credits'),json_extract(json_extract(x.result_json,'$.confirmationInput'),'$.credits'),a.credit_cost,0) AS allocation_credits,
  a.billing_status,a.provider_outcome,a.reservation_released_at,
  COALESCE((SELECT SUM(CASE WHEN l.amount<0 THEN -l.amount ELSE 0 END) FROM member_credit_ledger l
   WHERE l.user_id=a.user_id AND l.idempotency_key=a.idempotency_key),0) AS charged,
  CASE WHEN a.billing_status='reserved' AND a.reservation_released_at IS NULL THEN a.credit_cost ELSE 0 END AS reserved,
  CASE WHEN a.billing_status='reserved' AND a.reservation_released_at IS NULL AND a.provider_outcome IN ('dispatched','unknown') THEN a.credit_cost
   WHEN c.id IS NOT NULL AND a.id IS NULL THEN COALESCE(json_extract(json_extract(x.result_json,'$.confirmationInput'),'$.credits'),json_extract(x.result_json,'$.prepared.credits'),0) ELSE 0 END AS pending
 FROM canvas_agent_action_receipts x LEFT JOIN canvas_runs c ON c.user_id=x.user_id AND c.project_id=x.project_id AND c.idempotency_key='canvas_action_'||x.id
 LEFT JOIN member_ai_usage_attempts_v2 a ON a.user_id=x.user_id AND a.id=COALESCE(c.usage_attempt_id,
  (SELECT usage_attempt_id FROM member_generation_jobs WHERE user_id=x.user_id AND canvas_run_id=c.id LIMIT 1),
  (SELECT id FROM member_ai_usage_attempts_v2 WHERE user_id=x.user_id AND
   (json_extract(metadata_json,'$.canvas_media_action.action_id')=x.id
    OR idempotency_key=CASE WHEN EXISTS(SELECT 1 FROM canvas_nodes WHERE id=c.node_id AND type='video_generation') THEN 'canvas-video-'||c.id ELSE c.idempotency_key END) LIMIT 1))
 JOIN canvas_nodes n ON n.id=COALESCE(c.node_id,json_extract(x.input_json,'$.action.targetId')) AND n.user_id=x.user_id AND n.project_id=x.project_id
 WHERE json_extract(x.input_json,'$.action.type')='regenerate' AND n.type IN ('image_generation','video_generation','music_generation')
)
SELECT 'action:'||id AS step_id,NULL AS run_id,project_id,allocation_credits,state AS step_status,state AS run_status,
 billing_status,provider_outcome,reservation_released_at,charged,reserved,pending,
 MAX(charged,reserved,CASE WHEN billing_status='finalized' OR reservation_released_at IS NOT NULL THEN charged
  WHEN provider_outcome IN ('dispatched','unknown','succeeded') OR state='executing' OR (canvas_run_id IS NOT NULL AND usage_attempt_id IS NULL) THEN allocation_credits ELSE charged END) AS committed,model_id FROM source;
CREATE VIEW canvas_agent_media_costs AS
 SELECT c.*,json_extract(s.input_json,'$.modelId') AS model_id
 FROM canvas_agent_step_costs c JOIN canvas_agent_steps s ON s.id=c.step_id
 JOIN canvas_nodes n ON n.id=s.node_id
 WHERE s.kind='node' AND n.type IN ('image_generation','video_generation','music_generation')
 UNION ALL SELECT * FROM canvas_agent_media_action_costs;

CREATE TRIGGER canvas_agent_media_project_allocation BEFORE INSERT ON canvas_agent_steps
WHEN EXISTS(SELECT 1 FROM canvas_agent_runs owner JOIN canvas_agent_runs r ON r.project_id=owner.project_id AND r.purpose='production'
 WHERE owner.id=NEW.run_id AND (r.id=owner.id OR owner.purpose='briefing' AND
  (r.status IN ('queued','planning','applying','running','exporting','paused') OR json_extract(owner.input_json,'$.kind')='incident_explanation'
   AND r.created_at=(SELECT MAX(created_at) FROM canvas_agent_runs latest WHERE latest.project_id=r.project_id AND latest.purpose='production')))
 AND r.budget_credits<NEW.allocation_credits+COALESCE((SELECT SUM(c.committed) FROM canvas_agent_step_costs c WHERE c.project_id=r.project_id),0)
 +COALESCE((SELECT SUM(c.committed) FROM canvas_agent_media_action_costs c WHERE c.project_id=r.project_id),0))
BEGIN SELECT RAISE(ABORT,'canvas_agent_budget_exceeded'); END;

CREATE TRIGGER canvas_agent_media_policy_revision BEFORE INSERT ON canvas_agent_media_policies
WHEN NOT EXISTS(SELECT 1 FROM canvas_projects p JOIN users u ON u.id=p.user_id
 WHERE p.id=NEW.project_id AND p.user_id=NEW.user_id AND p.deleted_at IS NULL AND u.status='active' AND p.media_policy_revision=NEW.revision-1)
BEGIN SELECT RAISE(ABORT,'canvas_agent_media_policy_changed'); END;
CREATE TRIGGER canvas_agent_media_policy_cap BEFORE INSERT ON canvas_agent_media_policies
WHEN EXISTS(SELECT 1 FROM json_each(NEW.models_json) m WHERE json_extract(m.value,'$.creditLimit') IS NOT NULL
 AND json_extract(m.value,'$.creditLimit')<COALESCE((SELECT SUM(c.committed) FROM canvas_agent_media_costs c
 WHERE c.project_id=NEW.project_id AND c.model_id=json_extract(m.value,'$.modelId')),0))
BEGIN SELECT RAISE(ABORT,'canvas_agent_media_limit_below_committed'); END;
CREATE TRIGGER canvas_agent_media_policy_apply AFTER INSERT ON canvas_agent_media_policies
BEGIN
 UPDATE canvas_projects SET media_policy_revision=NEW.revision WHERE id=NEW.project_id;
 UPDATE canvas_agent_conversation_decisions SET state='cancelled',revision=revision+1,updated_at=NEW.created_at
  WHERE project_id=NEW.project_id AND state='pending' AND kind IN ('production_budget','production_start');
 UPDATE canvas_agent_start_intents SET state='cancelled',revision=revision+1,error_code='canvas_agent_media_policy_changed',updated_at=NEW.created_at
  WHERE project_id=NEW.project_id AND state IN ('waiting','approval_required','authorized');
 UPDATE canvas_agent_runs SET status='paused',error_code='canvas_agent_media_policy_resume_required',
  cause_json='{"code":"canvas_agent_media_policy_resume_required","recovery":"decision"}',lease_token=NULL,lease_until=NULL,updated_at=NEW.created_at
  WHERE project_id=NEW.project_id AND purpose='production' AND status IN ('queued','planning','applying','running','exporting');
END;
CREATE TRIGGER canvas_agent_media_start BEFORE INSERT ON canvas_agent_runs
WHEN NEW.purpose='production' AND NOT EXISTS(SELECT 1 FROM canvas_projects p WHERE p.id=NEW.project_id AND p.media_policy_revision=NEW.media_policy_revision)
BEGIN SELECT RAISE(ABORT,'canvas_agent_media_policy_changed'); END;

CREATE TRIGGER canvas_agent_media_allocation BEFORE INSERT ON canvas_agent_steps
WHEN NEW.kind='node' AND EXISTS(SELECT 1 FROM canvas_nodes WHERE id=NEW.node_id AND type IN ('image_generation','video_generation','music_generation'))
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM canvas_agent_runs r JOIN canvas_projects p ON p.id=r.project_id
  WHERE r.id=NEW.run_id AND r.media_policy_revision=p.media_policy_revision) THEN 1 ELSE RAISE(ABORT,'canvas_agent_media_policy_changed') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM canvas_agent_runs r JOIN canvas_agent_media_policies p ON p.project_id=r.project_id AND p.revision=r.media_policy_revision
  WHERE r.id=NEW.run_id AND p.mode='selected' AND NOT EXISTS(SELECT 1 FROM json_each(p.models_json) m
   WHERE json_extract(m.value,'$.modelId')=json_extract(NEW.input_json,'$.modelId'))) THEN 1 ELSE RAISE(ABORT,'canvas_agent_media_model_not_allowed') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM canvas_agent_runs r JOIN canvas_agent_media_policies p ON p.project_id=r.project_id AND p.revision=r.media_policy_revision,
  json_each(p.models_json) m WHERE r.id=NEW.run_id AND p.mode='selected' AND json_extract(m.value,'$.modelId')=json_extract(NEW.input_json,'$.modelId')
  AND json_extract(m.value,'$.creditLimit') IS NOT NULL AND json_extract(m.value,'$.creditLimit')<NEW.allocation_credits+
   COALESCE((SELECT SUM(c.committed) FROM canvas_agent_media_costs c WHERE c.project_id=r.project_id AND c.model_id=json_extract(NEW.input_json,'$.modelId')),0))
  THEN 1 ELSE RAISE(ABORT,'canvas_agent_media_limit_exceeded') END;
END;

-- This independent dispatch fence runs in the same database operation as the
-- original usage transition. No read/check/write budget race can bypass it.
CREATE TRIGGER canvas_agent_media_dispatch BEFORE UPDATE OF provider_outcome ON member_ai_usage_attempts_v2
WHEN OLD.provider_outcome='not_dispatched' AND NEW.provider_outcome='dispatched'
 AND EXISTS(SELECT 1 FROM canvas_agent_steps s JOIN canvas_nodes n ON n.id=s.node_id
  WHERE s.id=json_extract(NEW.metadata_json,'$.canvas_agent.step_id') AND s.kind='node' AND n.type IN ('image_generation','video_generation','music_generation'))
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM canvas_agent_steps s JOIN canvas_agent_runs r ON r.id=s.run_id JOIN canvas_projects p ON p.id=r.project_id
  WHERE s.id=json_extract(NEW.metadata_json,'$.canvas_agent.step_id') AND r.media_policy_revision=p.media_policy_revision)
  THEN 1 ELSE RAISE(ABORT,'canvas_agent_media_policy_changed') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM canvas_agent_steps s JOIN canvas_agent_runs r ON r.id=s.run_id
  JOIN canvas_agent_media_policies p ON p.project_id=r.project_id AND p.revision=r.media_policy_revision
  WHERE s.id=json_extract(NEW.metadata_json,'$.canvas_agent.step_id') AND p.mode='selected' AND NOT EXISTS(SELECT 1 FROM json_each(p.models_json) m
   WHERE json_extract(m.value,'$.modelId')=json_extract(s.input_json,'$.modelId')))
  THEN 1 ELSE RAISE(ABORT,'canvas_agent_media_model_not_allowed') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM canvas_agent_steps s JOIN canvas_agent_runs r ON r.id=s.run_id
  JOIN canvas_agent_media_policies p ON p.project_id=r.project_id AND p.revision=r.media_policy_revision,json_each(p.models_json) m
  WHERE s.id=json_extract(NEW.metadata_json,'$.canvas_agent.step_id') AND p.mode='selected' AND json_extract(m.value,'$.modelId')=json_extract(s.input_json,'$.modelId')
  AND json_extract(m.value,'$.creditLimit') IS NOT NULL AND json_extract(m.value,'$.creditLimit')<
   COALESCE((SELECT SUM(c.committed) FROM canvas_agent_media_costs c WHERE c.project_id=r.project_id AND c.model_id=json_extract(s.input_json,'$.modelId')),0))
  THEN 1 ELSE RAISE(ABORT,'canvas_agent_media_limit_exceeded') END;
END;

-- Confirmation claims are the earliest assistant variant admission boundary.
CREATE TRIGGER canvas_agent_media_action_claim BEFORE UPDATE OF state ON canvas_agent_action_receipts
WHEN OLD.state!='executing' AND NEW.state='executing' AND json_extract(NEW.input_json,'$.action.type')='regenerate'
 AND EXISTS(SELECT 1 FROM canvas_nodes WHERE id=json_extract(NEW.input_json,'$.action.targetId') AND type IN ('image_generation','video_generation','music_generation'))
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM canvas_agent_runs r WHERE r.id=json_extract(NEW.result_json,'$.prepared.projectCapRunId')
  AND r.project_id=NEW.project_id AND r.user_id=NEW.user_id AND r.purpose='production' AND r.budget_credits IS NOT NULL)
  THEN 1 ELSE RAISE(ABORT,'canvas_agent_project_budget_required') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM canvas_projects p JOIN users u ON u.id=p.user_id JOIN canvas_nodes n ON n.project_id=p.id AND n.user_id=p.user_id
  WHERE p.id=NEW.project_id AND p.user_id=NEW.user_id AND p.deleted_at IS NULL AND u.status='active'
  AND n.id=json_extract(NEW.input_json,'$.action.targetId') AND n.deleted_at IS NULL
  AND n.model_id=json_extract(NEW.result_json,'$.prepared.modelId') AND p.revision=json_extract(NEW.result_json,'$.prepared.expectedRevision')
  AND p.media_policy_revision=COALESCE(json_extract(NEW.result_json,'$.prepared.mediaPolicyRevision'),0)
  AND json_extract(json_extract(NEW.result_json,'$.confirmationInput'),'$.decision')='accept')
  THEN 1 ELSE RAISE(ABORT,'canvas_agent_media_policy_changed') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM canvas_projects p JOIN canvas_agent_media_policies m ON m.project_id=p.id AND m.revision=p.media_policy_revision
  WHERE p.id=NEW.project_id AND m.mode='selected' AND NOT EXISTS(SELECT 1 FROM json_each(m.models_json) item
   WHERE json_extract(item.value,'$.modelId')=json_extract(NEW.result_json,'$.prepared.modelId')))
  THEN 1 ELSE RAISE(ABORT,'canvas_agent_media_model_not_allowed') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM canvas_projects p JOIN canvas_agent_media_policies m ON m.project_id=p.id AND m.revision=p.media_policy_revision,
  json_each(m.models_json) item WHERE p.id=NEW.project_id AND m.mode='selected'
  AND json_extract(item.value,'$.modelId')=json_extract(NEW.result_json,'$.prepared.modelId') AND json_extract(item.value,'$.creditLimit') IS NOT NULL
  AND json_extract(item.value,'$.creditLimit')<json_extract(NEW.result_json,'$.prepared.credits')+
   COALESCE((SELECT SUM(c.committed) FROM canvas_agent_media_costs c WHERE c.project_id=NEW.project_id
    AND c.model_id=json_extract(NEW.result_json,'$.prepared.modelId') AND c.step_id!='action:'||NEW.id),0))
  THEN 1 ELSE RAISE(ABORT,'canvas_agent_media_limit_exceeded') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM canvas_agent_runs r WHERE r.id=(SELECT id FROM canvas_agent_runs WHERE project_id=NEW.project_id AND purpose='production' AND budget_credits IS NOT NULL ORDER BY created_at DESC,rowid DESC LIMIT 1)
  AND (r.id IS NOT json_extract(NEW.result_json,'$.prepared.projectCapRunId') OR r.budget_credits<json_extract(NEW.result_json,'$.prepared.credits')+
   COALESCE((SELECT SUM(c.committed) FROM canvas_agent_step_costs c WHERE c.project_id=NEW.project_id),0)+
   COALESCE((SELECT SUM(c.committed) FROM canvas_agent_media_action_costs c WHERE c.project_id=NEW.project_id AND c.step_id!='action:'||NEW.id),0)))
  THEN 1 ELSE RAISE(ABORT,'canvas_agent_budget_exceeded') END;
END;

CREATE TRIGGER canvas_agent_media_action_insert BEFORE INSERT ON member_ai_usage_attempts_v2
WHEN json_extract(NEW.metadata_json,'$.canvas_media_action.action_id') IS NOT NULL
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM canvas_agent_action_receipts x JOIN canvas_projects p ON p.id=x.project_id JOIN users u ON u.id=x.user_id
  JOIN canvas_runs c ON c.user_id=x.user_id AND c.project_id=x.project_id AND c.idempotency_key='canvas_action_'||x.id
  JOIN canvas_nodes n ON n.id=c.node_id AND n.project_id=c.project_id AND n.user_id=c.user_id
  WHERE x.id=json_extract(NEW.metadata_json,'$.canvas_media_action.action_id') AND x.user_id=NEW.user_id AND u.status='active'
  AND x.project_id=json_extract(NEW.metadata_json,'$.canvas_media_action.project_id')
  AND EXISTS(SELECT 1 FROM canvas_agent_runs r WHERE r.id=json_extract(NEW.metadata_json,'$.canvas_media_action.project_cap_run_id') AND r.project_id=x.project_id AND r.user_id=x.user_id AND r.purpose='production' AND r.budget_credits IS NOT NULL) AND p.deleted_at IS NULL AND n.deleted_at IS NULL
  AND p.media_policy_revision=json_extract(NEW.metadata_json,'$.canvas_media_action.policy_revision') AND c.node_revision=n.creative_revision
  AND x.state IN ('executing','completed') AND json_extract(x.input_json,'$.action.type')='regenerate'
  AND json_extract(json_extract(x.result_json,'$.confirmationInput'),'$.decision')='accept'
  AND json_extract(NEW.metadata_json,'$.canvas_media_action.canvas_run_id')=c.id
  AND json_extract(NEW.metadata_json,'$.canvas_media_action.request_key')=CASE WHEN n.type='video_generation' THEN 'canvas-video-'||c.id ELSE c.idempotency_key END
  AND NOT EXISTS(SELECT 1 FROM member_ai_usage_attempts_v2 prior WHERE prior.user_id=NEW.user_id AND prior.id!=NEW.id AND json_extract(prior.metadata_json,'$.canvas_media_action.action_id')=x.id) AND NEW.credit_cost<=COALESCE(json_extract(x.result_json,'$.prepared.credits'),NEW.credit_cost))
  THEN 1 ELSE RAISE(ABORT,'canvas_agent_media_policy_changed') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM canvas_agent_action_receipts x JOIN canvas_projects p ON p.id=x.project_id
  JOIN canvas_runs c ON c.user_id=x.user_id AND c.project_id=x.project_id AND c.idempotency_key='canvas_action_'||x.id
  JOIN canvas_agent_media_policies m ON m.project_id=p.id AND m.revision=p.media_policy_revision
  WHERE x.id=json_extract(NEW.metadata_json,'$.canvas_media_action.action_id') AND m.mode='selected'
  AND NOT EXISTS(SELECT 1 FROM json_each(m.models_json) item WHERE json_extract(item.value,'$.modelId')=c.model_id))
  THEN 1 ELSE RAISE(ABORT,'canvas_agent_media_model_not_allowed') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM canvas_agent_action_receipts x JOIN canvas_projects p ON p.id=x.project_id
  JOIN canvas_runs c ON c.user_id=x.user_id AND c.project_id=x.project_id AND c.idempotency_key='canvas_action_'||x.id
  JOIN canvas_agent_media_policies m ON m.project_id=p.id AND m.revision=p.media_policy_revision,json_each(m.models_json) item
  WHERE x.id=json_extract(NEW.metadata_json,'$.canvas_media_action.action_id') AND m.mode='selected' AND json_extract(item.value,'$.modelId')=c.model_id
  AND json_extract(item.value,'$.creditLimit') IS NOT NULL AND json_extract(item.value,'$.creditLimit')<
   MAX(NEW.credit_cost,COALESCE(json_extract(x.result_json,'$.prepared.credits'),0))+
   COALESCE((SELECT SUM(mc.committed) FROM canvas_agent_media_costs mc WHERE mc.project_id=x.project_id AND mc.model_id=c.model_id AND mc.step_id!='action:'||x.id),0))
  THEN 1 ELSE RAISE(ABORT,'canvas_agent_media_limit_exceeded') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM canvas_agent_action_receipts x JOIN canvas_agent_runs r ON r.id=(SELECT id FROM canvas_agent_runs WHERE project_id=x.project_id AND purpose='production' AND budget_credits IS NOT NULL ORDER BY created_at DESC,rowid DESC LIMIT 1)
  WHERE x.id=json_extract(NEW.metadata_json,'$.canvas_media_action.action_id')
  AND (r.id IS NOT json_extract(NEW.metadata_json,'$.canvas_media_action.project_cap_run_id') OR r.budget_credits<
   MAX(NEW.credit_cost,COALESCE(json_extract(x.result_json,'$.prepared.credits'),0))+
   COALESCE((SELECT SUM(mc.committed) FROM canvas_agent_step_costs mc WHERE mc.project_id=x.project_id),0)+
   COALESCE((SELECT SUM(mc.committed) FROM canvas_agent_media_action_costs mc WHERE mc.project_id=x.project_id AND mc.step_id!='action:'||x.id),0)))
  THEN 1 ELSE RAISE(ABORT,'canvas_agent_budget_exceeded') END;
END;

CREATE TRIGGER canvas_agent_media_action_dispatch BEFORE UPDATE OF provider_outcome ON member_ai_usage_attempts_v2
WHEN OLD.provider_outcome='not_dispatched' AND NEW.provider_outcome='dispatched' AND json_extract(NEW.metadata_json,'$.canvas_media_action.action_id') IS NOT NULL
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM canvas_agent_action_receipts x JOIN canvas_projects p ON p.id=x.project_id JOIN users u ON u.id=x.user_id
  JOIN canvas_runs c ON c.user_id=x.user_id AND c.project_id=x.project_id AND c.idempotency_key='canvas_action_'||x.id
  JOIN canvas_nodes n ON n.id=c.node_id AND n.project_id=c.project_id AND n.user_id=c.user_id
  WHERE x.id=json_extract(NEW.metadata_json,'$.canvas_media_action.action_id') AND x.user_id=NEW.user_id AND u.status='active'
  AND x.project_id=json_extract(NEW.metadata_json,'$.canvas_media_action.project_id')
  AND EXISTS(SELECT 1 FROM canvas_agent_runs r WHERE r.id=json_extract(NEW.metadata_json,'$.canvas_media_action.project_cap_run_id') AND r.project_id=x.project_id AND r.user_id=x.user_id AND r.purpose='production' AND r.budget_credits IS NOT NULL) AND p.deleted_at IS NULL AND n.deleted_at IS NULL
  AND p.media_policy_revision=json_extract(NEW.metadata_json,'$.canvas_media_action.policy_revision') AND c.node_revision=n.creative_revision
  AND x.state IN ('executing','completed') AND json_extract(x.input_json,'$.action.type')='regenerate'
  AND json_extract(json_extract(x.result_json,'$.confirmationInput'),'$.decision')='accept'
  AND json_extract(NEW.metadata_json,'$.canvas_media_action.canvas_run_id')=c.id
  AND json_extract(NEW.metadata_json,'$.canvas_media_action.request_key')=CASE WHEN n.type='video_generation' THEN 'canvas-video-'||c.id ELSE c.idempotency_key END
  AND NOT EXISTS(SELECT 1 FROM member_ai_usage_attempts_v2 prior WHERE prior.user_id=NEW.user_id AND prior.id!=NEW.id AND json_extract(prior.metadata_json,'$.canvas_media_action.action_id')=x.id) AND NEW.credit_cost<=COALESCE(json_extract(x.result_json,'$.prepared.credits'),NEW.credit_cost))
  THEN 1 ELSE RAISE(ABORT,'canvas_agent_media_policy_changed') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM canvas_agent_action_receipts x JOIN canvas_projects p ON p.id=x.project_id
  JOIN canvas_runs c ON c.user_id=x.user_id AND c.project_id=x.project_id AND c.idempotency_key='canvas_action_'||x.id
  JOIN canvas_agent_media_policies m ON m.project_id=p.id AND m.revision=p.media_policy_revision
  WHERE x.id=json_extract(NEW.metadata_json,'$.canvas_media_action.action_id') AND m.mode='selected'
  AND NOT EXISTS(SELECT 1 FROM json_each(m.models_json) item WHERE json_extract(item.value,'$.modelId')=c.model_id))
  THEN 1 ELSE RAISE(ABORT,'canvas_agent_media_model_not_allowed') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM canvas_agent_action_receipts x JOIN canvas_projects p ON p.id=x.project_id
  JOIN canvas_runs c ON c.user_id=x.user_id AND c.project_id=x.project_id AND c.idempotency_key='canvas_action_'||x.id
  JOIN canvas_agent_media_policies m ON m.project_id=p.id AND m.revision=p.media_policy_revision,json_each(m.models_json) item
  WHERE x.id=json_extract(NEW.metadata_json,'$.canvas_media_action.action_id') AND m.mode='selected' AND json_extract(item.value,'$.modelId')=c.model_id
  AND json_extract(item.value,'$.creditLimit') IS NOT NULL AND json_extract(item.value,'$.creditLimit')<
   MAX(NEW.credit_cost,COALESCE(json_extract(x.result_json,'$.prepared.credits'),0))+
   COALESCE((SELECT SUM(mc.committed) FROM canvas_agent_media_costs mc WHERE mc.project_id=x.project_id AND mc.model_id=c.model_id AND mc.step_id!='action:'||x.id),0))
  THEN 1 ELSE RAISE(ABORT,'canvas_agent_media_limit_exceeded') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM canvas_agent_action_receipts x JOIN canvas_agent_runs r ON r.id=(SELECT id FROM canvas_agent_runs WHERE project_id=x.project_id AND purpose='production' AND budget_credits IS NOT NULL ORDER BY created_at DESC,rowid DESC LIMIT 1)
  WHERE x.id=json_extract(NEW.metadata_json,'$.canvas_media_action.action_id')
  AND (r.id IS NOT json_extract(NEW.metadata_json,'$.canvas_media_action.project_cap_run_id') OR r.budget_credits<
   MAX(NEW.credit_cost,COALESCE(json_extract(x.result_json,'$.prepared.credits'),0))+
   COALESCE((SELECT SUM(mc.committed) FROM canvas_agent_step_costs mc WHERE mc.project_id=x.project_id),0)+
   COALESCE((SELECT SUM(mc.committed) FROM canvas_agent_media_action_costs mc WHERE mc.project_id=x.project_id AND mc.step_id!='action:'||x.id),0)))
  THEN 1 ELSE RAISE(ABORT,'canvas_agent_budget_exceeded') END;
END;

-- Provenance survives settlement, replay expiration and result reclamation.
CREATE INDEX canvas_media_action_usage ON member_ai_usage_attempts_v2(user_id,json_extract(metadata_json,'$.canvas_media_action.action_id'))
 WHERE json_type(metadata_json,'$.canvas_media_action')='object';
CREATE TRIGGER canvas_media_action_usage_identity BEFORE UPDATE OF metadata_json ON member_ai_usage_attempts_v2
WHEN json_type(OLD.metadata_json,'$.canvas_media_action')='object'
 AND json_extract(NEW.metadata_json,'$.canvas_media_action') IS NOT json_extract(OLD.metadata_json,'$.canvas_media_action')
BEGIN SELECT RAISE(ABORT,'canvas_agent_authority_revoked'); END;

-- Variants share the original project ceiling with production, briefing and
-- authorized diagnosis. Keep their separate conversation allowances unchanged.
CREATE TRIGGER canvas_agent_media_project_dispatch BEFORE UPDATE OF provider_outcome ON member_ai_usage_attempts_v2
WHEN OLD.provider_outcome='not_dispatched' AND NEW.provider_outcome='dispatched'
 AND EXISTS(SELECT 1 FROM canvas_agent_steps step JOIN canvas_agent_runs owner ON owner.id=step.run_id
  JOIN canvas_agent_runs r ON r.project_id=owner.project_id AND r.purpose='production'
  WHERE step.id=json_extract(NEW.metadata_json,'$.canvas_agent.step_id') AND (r.id=owner.id OR owner.purpose='briefing' AND
   (r.status IN ('queued','planning','applying','running','exporting','paused') OR json_extract(owner.input_json,'$.kind')='incident_explanation'
    AND r.created_at=(SELECT MAX(created_at) FROM canvas_agent_runs latest WHERE latest.project_id=r.project_id AND latest.purpose='production')))
  AND r.budget_credits<COALESCE((SELECT SUM(committed) FROM canvas_agent_step_costs WHERE project_id=r.project_id),0)
   +COALESCE((SELECT SUM(committed) FROM canvas_agent_media_action_costs WHERE project_id=r.project_id),0))
BEGIN SELECT RAISE(ABORT,'canvas_agent_budget_exceeded'); END;

-- Blocked runs do not hold unstarted allocations. Reactivation must readmit
-- them atomically against any variants accepted while the run was stopped.
CREATE TRIGGER canvas_agent_media_project_resume BEFORE UPDATE OF status ON canvas_agent_runs
WHEN NEW.purpose='production' AND NEW.status IN ('queued','planning','applying','running','exporting')
 AND OLD.status IN ('paused','blocked','review_required')
 AND NEW.budget_credits<COALESCE((SELECT SUM(committed) FROM canvas_agent_step_costs WHERE project_id=NEW.project_id),0)
  +COALESCE((SELECT SUM(committed) FROM canvas_agent_media_action_costs WHERE project_id=NEW.project_id),0)
  +COALESCE((SELECT SUM(MAX(0,s.allocation_credits-c.committed)) FROM canvas_agent_steps s
    JOIN canvas_agent_step_costs c ON c.step_id=s.id WHERE s.run_id=NEW.id AND s.status IN ('ready','accepted')
    AND c.reservation_released_at IS NULL AND (c.billing_status IS NULL OR c.billing_status='reserved')
    AND (c.provider_outcome IS NULL OR c.provider_outcome='not_dispatched')),0)
BEGIN SELECT RAISE(ABORT,'canvas_agent_budget_exceeded'); END;

CREATE TRIGGER canvas_agent_media_model_resume BEFORE UPDATE OF status ON canvas_agent_runs
WHEN NEW.purpose='production' AND NEW.status IN ('queued','planning','applying','running','exporting')
 AND OLD.status IN ('paused','blocked','review_required')
 AND EXISTS(SELECT 1 FROM canvas_agent_media_policies p,json_each(p.models_json) item
  WHERE p.project_id=NEW.project_id AND p.revision=NEW.media_policy_revision AND p.mode='selected'
   AND json_extract(item.value,'$.creditLimit') IS NOT NULL AND json_extract(item.value,'$.creditLimit')<
    COALESCE((SELECT SUM(committed) FROM canvas_agent_media_costs WHERE project_id=NEW.project_id AND model_id=json_extract(item.value,'$.modelId')),0)
    +COALESCE((SELECT SUM(MAX(0,s.allocation_credits-c.committed)) FROM canvas_agent_steps s JOIN canvas_agent_media_costs c ON c.step_id=s.id
      WHERE s.run_id=NEW.id AND s.status IN ('ready','accepted') AND c.model_id=json_extract(item.value,'$.modelId')
       AND c.reservation_released_at IS NULL AND (c.billing_status IS NULL OR c.billing_status='reserved')
       AND (c.provider_outcome IS NULL OR c.provider_outcome='not_dispatched')),0))
BEGIN SELECT RAISE(ABORT,'canvas_agent_media_limit_exceeded'); END;
