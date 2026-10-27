-- Voice is a transport for the existing project conversation, never spending or
-- production authority. No audio or provider credentials are retained here.
CREATE TABLE canvas_voice_settings (
 project_id TEXT PRIMARY KEY REFERENCES canvas_projects(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id), revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 settings_json TEXT NOT NULL CHECK(json_valid(settings_json) AND length(settings_json)<=16000),
 updated_at TEXT NOT NULL
);
CREATE TABLE canvas_voice_sessions (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES canvas_agent_conversations(project_id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id), request_key TEXT NOT NULL DEFAULT '',
 request_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(request_json)),
 state TEXT NOT NULL CHECK(state IN ('admitted','connecting','active','stopping','completed','unknown','rejected')),
 conversation_revision INTEGER NOT NULL, brief_revision INTEGER NOT NULL, project_revision INTEGER NOT NULL,
 settings_revision INTEGER NOT NULL DEFAULT 0,
 settings_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(settings_json) AND length(settings_json)<=16000),
 usage_attempt_id TEXT REFERENCES member_ai_usage_attempts_v2(id),
 provider_identity TEXT, auth_session_id TEXT,
 resume_session_id TEXT, resume_conversation_id TEXT, resume_expires_at TEXT,
 max_seconds INTEGER NOT NULL DEFAULT 300 CHECK(max_seconds BETWEEN 1 AND 7200),
 stop_requested INTEGER NOT NULL DEFAULT 0 CHECK(stop_requested IN(0,1)),
 exposure_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(exposure_json)),
 created_at TEXT NOT NULL, updated_at TEXT, expires_at TEXT NOT NULL,
 UNIQUE(user_id,request_key)
);
CREATE TABLE canvas_voice_setting_writes (
 project_id TEXT NOT NULL REFERENCES canvas_projects(id) ON DELETE CASCADE,
 request_key TEXT NOT NULL, input_hash TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(project_id,request_key)
);
CREATE UNIQUE INDEX canvas_voice_one_user_session ON canvas_voice_sessions(user_id)
 WHERE state IN ('admitted','connecting','active','stopping','unknown');
CREATE INDEX canvas_voice_project_sessions ON canvas_voice_sessions(project_id,created_at);
CREATE TABLE canvas_voice_turns (
 turn_id TEXT PRIMARY KEY REFERENCES canvas_agent_turns(id) ON DELETE CASCADE,
 session_id TEXT NOT NULL REFERENCES canvas_voice_sessions(id) ON DELETE CASCADE,
 source_turn_id TEXT REFERENCES canvas_agent_turns(id) ON DELETE CASCADE,
 provider_item_id TEXT NOT NULL, provider_response_id TEXT, model_id TEXT NOT NULL,
 interrupted INTEGER NOT NULL DEFAULT 0 CHECK(interrupted IN(0,1)), heard_audio_ms INTEGER, retained_text TEXT CHECK(retained_text IS NULL OR length(retained_text)<=8000),
 created_at TEXT NOT NULL, UNIQUE(session_id,provider_item_id), UNIQUE(session_id,provider_response_id)
);
CREATE TABLE canvas_voice_calls (
 session_id TEXT NOT NULL REFERENCES canvas_voice_sessions(id) ON DELETE CASCADE,
 call_id TEXT NOT NULL, input_json TEXT NOT NULL CHECK(json_valid(input_json) AND length(input_json)<=24000),
 result_json TEXT NOT NULL CHECK(json_valid(result_json) AND length(result_json)<=64000), created_at TEXT NOT NULL,
 PRIMARY KEY(session_id,call_id)
);
CREATE TABLE canvas_voice_stop_requests (
 session_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES canvas_projects(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
-- Quotes are not spending authority. Only an explicit, revision-matched session
-- admission reserves the existing member usage ledger. Minimal immutable usage
-- metadata survives project deletion; it contains no audio or conversation text.
CREATE TABLE canvas_voice_quotes (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES canvas_projects(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id), input_json TEXT NOT NULL CHECK(json_valid(input_json)),
 settings_json TEXT NOT NULL CHECK(json_valid(settings_json)), pricing_json TEXT NOT NULL CHECK(json_valid(pricing_json)),
 created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
 resume_session_id TEXT, resume_conversation_id TEXT, resume_expires_at TEXT
);
CREATE TRIGGER canvas_voice_quote_immutable BEFORE UPDATE ON canvas_voice_quotes
BEGIN SELECT RAISE(ABORT,'canvas_voice_quote_immutable'); END;
ALTER TABLE canvas_voice_sessions ADD COLUMN accepted_at TEXT;
ALTER TABLE canvas_voice_sessions ADD COLUMN active_at TEXT;
ALTER TABLE canvas_voice_sessions ADD COLUMN admit_by TEXT;
ALTER TABLE canvas_voice_sessions ADD COLUMN started_blocks INTEGER NOT NULL DEFAULT 0 CHECK(started_blocks>=0);
CREATE VIEW canvas_voice_costs AS
WITH source AS (
 SELECT a.id AS usage_attempt_id,json_extract(a.metadata_json,'$.canvas_voice.project_id') AS project_id,
  a.user_id,a.credit_cost AS allocation_credits,a.billing_status,a.provider_outcome,a.reservation_released_at,
  COALESCE((SELECT SUM(CASE WHEN l.amount<0 THEN -l.amount ELSE 0 END) FROM member_credit_ledger l
   WHERE l.user_id=a.user_id AND l.idempotency_key=a.idempotency_key),0) AS charged,
  CASE WHEN a.billing_status='reserved' AND a.reservation_released_at IS NULL THEN a.credit_cost ELSE 0 END AS reserved,
  CASE WHEN a.billing_status='reserved' AND a.reservation_released_at IS NULL AND a.provider_outcome IN ('dispatched','unknown') THEN a.credit_cost ELSE 0 END AS pending
 FROM member_ai_usage_attempts_v2 a WHERE json_extract(a.metadata_json,'$.canvas_voice.version')=1
)
SELECT *,MAX(charged,reserved) AS committed FROM source;
CREATE INDEX canvas_voice_usage_project ON member_ai_usage_attempts_v2(json_extract(metadata_json,'$.canvas_voice.project_id'),user_id)
 WHERE json_extract(metadata_json,'$.canvas_voice.version')=1;
CREATE VIEW canvas_conversation_costs AS
 SELECT c.project_id,c.committed,c.charged,c.reserved,c.pending FROM canvas_agent_step_costs c
 JOIN canvas_agent_runs r ON r.id=c.run_id WHERE r.purpose='briefing'
 UNION ALL SELECT project_id,committed,charged,reserved,pending FROM canvas_voice_costs;
CREATE VIEW canvas_project_costs AS
 SELECT project_id,committed,charged,reserved,pending,allocation_credits FROM canvas_agent_step_costs
 UNION ALL SELECT project_id,committed,charged,reserved,pending,allocation_credits FROM canvas_agent_media_action_costs
 UNION ALL SELECT project_id,committed,charged,reserved,pending,allocation_credits FROM canvas_voice_costs;
CREATE TRIGGER canvas_voice_usage_identity BEFORE UPDATE OF metadata_json,user_id,idempotency_key,request_fingerprint,credit_cost ON member_ai_usage_attempts_v2
WHEN json_extract(OLD.metadata_json,'$.canvas_voice.version')=1 AND (
 json_extract(NEW.metadata_json,'$.canvas_voice') IS NOT json_extract(OLD.metadata_json,'$.canvas_voice')
 OR NEW.user_id IS NOT OLD.user_id OR NEW.idempotency_key IS NOT OLD.idempotency_key
 OR NEW.request_fingerprint IS NOT OLD.request_fingerprint OR NEW.credit_cost IS NOT OLD.credit_cost
 OR json_type(OLD.metadata_json,'$.canvas_voice_receipt') IS NOT NULL AND
 json_extract(NEW.metadata_json,'$.canvas_voice_receipt') IS NOT json_extract(OLD.metadata_json,'$.canvas_voice_receipt')
 OR json_type(OLD.metadata_json,'$.canvas_voice_acceptance') IS NOT NULL AND
 json_extract(NEW.metadata_json,'$.canvas_voice_acceptance') IS NOT json_extract(OLD.metadata_json,'$.canvas_voice_acceptance'))
BEGIN SELECT RAISE(ABORT,'canvas_voice_usage_immutable'); END;
CREATE TRIGGER canvas_voice_usage_admission BEFORE INSERT ON member_ai_usage_attempts_v2
WHEN json_extract(NEW.metadata_json,'$.canvas_voice.version')=1
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM canvas_voice_quotes q JOIN canvas_projects p ON p.id=q.project_id
  JOIN canvas_agent_conversations c ON c.project_id=p.id JOIN users u ON u.id=p.user_id
  WHERE q.id=json_extract(NEW.metadata_json,'$.canvas_voice.quote_id') AND q.user_id=NEW.user_id AND p.user_id=NEW.user_id
  AND p.id=json_extract(NEW.metadata_json,'$.canvas_voice.project_id') AND p.deleted_at IS NULL AND u.status='active' AND c.state='active'
  AND EXISTS(SELECT 1 FROM sessions login WHERE login.id=json_extract(NEW.metadata_json,'$.canvas_voice.auth_session_id')
   AND login.user_id=NEW.user_id AND login.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  AND q.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
  AND p.revision=json_extract(q.input_json,'$.expectedProjectRevision') AND c.revision=json_extract(q.input_json,'$.expectedConversationRevision')
  AND c.brief_revision=json_extract(q.input_json,'$.expectedBriefRevision')
  AND COALESCE((SELECT revision FROM canvas_voice_settings WHERE project_id=p.id),0)=json_extract(q.input_json,'$.settingsRevision')
  AND json_extract(q.pricing_json,'$.tariffRevision')=(SELECT revision FROM model_pricing_state WHERE id=1)
  AND c.allowance_tariff=json_extract(q.pricing_json,'$.tariffRevision') AND NEW.credit_cost=json_extract(q.pricing_json,'$.maxCredits')
  AND json_extract(NEW.metadata_json,'$.canvas_voice.pricing')=json(q.pricing_json)
  AND NOT EXISTS(SELECT 1 FROM canvas_voice_stop_requests WHERE session_id=json_extract(NEW.metadata_json,'$.canvas_voice.session_id'))
  AND NOT EXISTS(SELECT 1 FROM canvas_voice_costs v WHERE v.user_id=NEW.user_id AND v.reserved>0)
  AND (SELECT COUNT(*) FROM canvas_voice_costs WHERE reserved>0)<8
  AND c.allowance_credits>=NEW.credit_cost+COALESCE((SELECT SUM(committed) FROM canvas_conversation_costs WHERE project_id=p.id),0)
  AND NOT EXISTS(SELECT 1 FROM canvas_agent_runs r WHERE r.project_id=p.id AND r.purpose='production'
   AND r.status IN ('queued','planning','applying','running','exporting','paused') AND r.budget_credits<NEW.credit_cost+
    COALESCE((SELECT SUM(committed) FROM canvas_project_costs WHERE project_id=p.id),0)))
 THEN 1 ELSE RAISE(ABORT,'canvas_voice_admission_denied') END;
END;
CREATE TRIGGER canvas_voice_usage_dispatch BEFORE UPDATE OF provider_outcome ON member_ai_usage_attempts_v2
WHEN OLD.provider_outcome='not_dispatched' AND NEW.provider_outcome='dispatched' AND json_extract(NEW.metadata_json,'$.canvas_voice.version')=1
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM canvas_voice_sessions s JOIN canvas_projects p ON p.id=s.project_id
  JOIN canvas_agent_conversations c ON c.project_id=s.project_id JOIN users u ON u.id=s.user_id
  WHERE s.usage_attempt_id=NEW.id AND s.user_id=NEW.user_id AND s.id=json_extract(NEW.metadata_json,'$.canvas_voice.session_id')
  AND s.state='admitted' AND s.stop_requested=0 AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND s.admit_by>strftime('%Y-%m-%dT%H:%M:%fZ','now')
  AND p.user_id=s.user_id AND p.deleted_at IS NULL AND u.status='active' AND c.state='active'
  AND EXISTS(SELECT 1 FROM sessions login WHERE login.id=s.auth_session_id AND login.user_id=s.user_id AND login.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  AND (s.resume_session_id IS NULL OR s.resume_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND EXISTS(
   SELECT 1 FROM canvas_voice_sessions original JOIN member_ai_usage_attempts_v2 original_usage ON original_usage.id=original.usage_attempt_id
   WHERE original.id=s.resume_session_id AND original.user_id=s.user_id AND original.project_id=s.project_id
   AND original.state='completed' AND original.provider_identity=s.resume_conversation_id
   AND original_usage.billing_status='finalized' AND original_usage.provider_outcome='succeeded'
   AND json_extract(original.settings_json,'$.resumption.enabled')=1 AND json_extract(s.settings_json,'$.resumption.enabled')=1))
  AND p.revision=s.project_revision AND c.revision=s.conversation_revision AND c.brief_revision=s.brief_revision
  AND COALESCE((SELECT revision FROM canvas_voice_settings WHERE project_id=p.id),0)=s.settings_revision
  AND NOT EXISTS(SELECT 1 FROM canvas_voice_stop_requests WHERE session_id=s.id)
  AND c.allowance_credits>=COALESCE((SELECT SUM(committed) FROM canvas_conversation_costs WHERE project_id=p.id),0)
  AND NOT EXISTS(SELECT 1 FROM canvas_agent_runs r WHERE r.project_id=p.id AND r.purpose='production'
   AND r.status IN ('queued','planning','applying','running','exporting','paused')
   AND r.budget_credits<COALESCE((SELECT SUM(committed) FROM canvas_project_costs WHERE project_id=p.id),0)))
 THEN 1 ELSE RAISE(ABORT,'canvas_voice_authority_changed') END;
END;
CREATE TRIGGER canvas_voice_text_allocation BEFORE INSERT ON canvas_agent_steps
WHEN EXISTS(SELECT 1 FROM canvas_agent_runs r WHERE r.id=NEW.run_id AND
 (r.purpose='briefing' AND r.budget_credits<NEW.allocation_credits+
  COALESCE((SELECT SUM(committed) FROM canvas_conversation_costs WHERE project_id=r.project_id),0)
 OR EXISTS(SELECT 1 FROM canvas_agent_runs production WHERE production.project_id=r.project_id AND production.purpose='production'
  AND (production.id=r.id OR r.purpose='briefing' AND production.status IN ('queued','planning','applying','running','exporting','paused'))
  AND production.budget_credits<NEW.allocation_credits+COALESCE((SELECT SUM(committed) FROM canvas_project_costs WHERE project_id=r.project_id),0))))
BEGIN SELECT RAISE(ABORT,'canvas_agent_budget_exceeded'); END;
CREATE TRIGGER canvas_voice_text_dispatch BEFORE UPDATE OF provider_outcome ON member_ai_usage_attempts_v2
WHEN OLD.provider_outcome='not_dispatched' AND NEW.provider_outcome='dispatched' AND EXISTS(
 SELECT 1 FROM canvas_agent_steps s JOIN canvas_agent_runs r ON r.id=s.run_id
 WHERE s.id=json_extract(NEW.metadata_json,'$.canvas_agent.step_id') AND
 (r.purpose='briefing' AND (SELECT allowance_credits FROM canvas_agent_conversations WHERE project_id=r.project_id)<
  COALESCE((SELECT SUM(committed) FROM canvas_conversation_costs WHERE project_id=r.project_id),0)
 OR EXISTS(SELECT 1 FROM canvas_agent_runs production WHERE production.project_id=r.project_id AND production.purpose='production'
  AND (production.id=r.id OR r.purpose='briefing' AND production.status IN ('queued','planning','applying','running','exporting','paused'))
  AND production.budget_credits<COALESCE((SELECT SUM(committed) FROM canvas_project_costs WHERE project_id=r.project_id),0))))
BEGIN SELECT RAISE(ABORT,'canvas_agent_budget_exceeded'); END;
-- Keep the existing explicit reduction/revocation of the conversation allowance.
-- It does not undo accepted costs; revision and dispatch guards prevent new work.
CREATE TRIGGER canvas_voice_production_start BEFORE INSERT ON canvas_agent_runs
WHEN NEW.purpose='production' AND NEW.budget_credits<COALESCE((SELECT SUM(committed) FROM canvas_project_costs WHERE project_id=NEW.project_id),0)
BEGIN SELECT RAISE(ABORT,'canvas_agent_budget_exceeded'); END;
CREATE TRIGGER canvas_voice_production_resume BEFORE UPDATE OF status,budget_credits ON canvas_agent_runs
WHEN NEW.purpose='production' AND NEW.status IN ('queued','planning','applying','running','exporting','paused')
 AND NEW.budget_credits<COALESCE((SELECT SUM(committed) FROM canvas_project_costs WHERE project_id=NEW.project_id),0)
  +CASE WHEN OLD.status IN ('blocked','review_required','paused') AND NEW.status!='paused' THEN
   COALESCE((SELECT SUM(MAX(0,s.allocation_credits-c.committed)) FROM canvas_agent_steps s JOIN canvas_agent_step_costs c ON c.step_id=s.id
    WHERE s.run_id=NEW.id AND s.status IN ('ready','accepted') AND c.reservation_released_at IS NULL
    AND (c.billing_status IS NULL OR c.billing_status='reserved') AND (c.provider_outcome IS NULL OR c.provider_outcome='not_dispatched')),0) ELSE 0 END
BEGIN SELECT RAISE(ABORT,'canvas_agent_budget_exceeded'); END;
CREATE TRIGGER canvas_voice_action_claim BEFORE UPDATE OF state ON canvas_agent_action_receipts
WHEN OLD.state!='executing' AND NEW.state='executing' AND json_extract(NEW.input_json,'$.action.type')='regenerate'
 AND EXISTS(SELECT 1 FROM canvas_agent_runs r WHERE r.id=json_extract(NEW.result_json,'$.prepared.projectCapRunId')
  AND r.budget_credits<json_extract(NEW.result_json,'$.prepared.credits')+
   COALESCE((SELECT SUM(committed) FROM canvas_project_costs WHERE project_id=NEW.project_id),0)
   -COALESCE((SELECT committed FROM canvas_agent_media_action_costs WHERE step_id='action:'||NEW.id),0))
BEGIN SELECT RAISE(ABORT,'canvas_agent_budget_exceeded'); END;
CREATE TRIGGER canvas_voice_action_admission BEFORE INSERT ON member_ai_usage_attempts_v2
WHEN json_extract(NEW.metadata_json,'$.canvas_media_action.action_id') IS NOT NULL
 AND EXISTS(SELECT 1 FROM canvas_agent_action_receipts x JOIN canvas_agent_runs r ON r.id=json_extract(NEW.metadata_json,'$.canvas_media_action.project_cap_run_id')
  WHERE x.id=json_extract(NEW.metadata_json,'$.canvas_media_action.action_id') AND r.budget_credits<
   MAX(NEW.credit_cost,COALESCE(json_extract(x.result_json,'$.prepared.credits'),0))+
   COALESCE((SELECT SUM(committed) FROM canvas_project_costs WHERE project_id=x.project_id),0)
   -COALESCE((SELECT committed FROM canvas_agent_media_action_costs WHERE step_id='action:'||x.id),0))
BEGIN SELECT RAISE(ABORT,'canvas_agent_budget_exceeded'); END;
CREATE TRIGGER canvas_voice_action_dispatch BEFORE UPDATE OF provider_outcome ON member_ai_usage_attempts_v2
WHEN OLD.provider_outcome='not_dispatched' AND NEW.provider_outcome='dispatched' AND json_extract(NEW.metadata_json,'$.canvas_media_action.action_id') IS NOT NULL
 AND EXISTS(SELECT 1 FROM canvas_agent_runs r WHERE r.id=json_extract(NEW.metadata_json,'$.canvas_media_action.project_cap_run_id')
  AND r.budget_credits<COALESCE((SELECT SUM(committed) FROM canvas_project_costs WHERE project_id=r.project_id),0))
BEGIN SELECT RAISE(ABORT,'canvas_agent_budget_exceeded'); END;
CREATE TRIGGER canvas_voice_session_usage_identity BEFORE UPDATE OF usage_attempt_id ON canvas_voice_sessions
BEGIN SELECT RAISE(ABORT,'canvas_voice_identity_immutable'); END;
CREATE TRIGGER canvas_voice_settings_owner BEFORE INSERT ON canvas_voice_settings
WHEN NOT EXISTS(SELECT 1 FROM canvas_projects WHERE id=NEW.project_id AND user_id=NEW.user_id AND deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT,'canvas_voice_owner_invalid'); END;
CREATE TRIGGER canvas_voice_settings_identity BEFORE UPDATE OF project_id,user_id ON canvas_voice_settings
BEGIN SELECT RAISE(ABORT,'canvas_voice_identity_immutable'); END;
CREATE TRIGGER canvas_voice_session_owner BEFORE INSERT ON canvas_voice_sessions
WHEN NOT EXISTS(SELECT 1 FROM canvas_projects p JOIN canvas_agent_conversations c ON c.project_id=p.id
 JOIN users u ON u.id=p.user_id WHERE p.id=NEW.project_id AND p.user_id=NEW.user_id AND c.user_id=NEW.user_id
 AND p.deleted_at IS NULL AND u.status='active' AND c.state='active')
 OR EXISTS(SELECT 1 FROM canvas_voice_stop_requests WHERE session_id=NEW.id)
 OR NEW.usage_attempt_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM member_ai_usage_attempts_v2 a
  WHERE a.id=NEW.usage_attempt_id AND a.user_id=NEW.user_id AND a.provider_outcome='not_dispatched' AND a.billing_status='reserved'
  AND json_extract(a.metadata_json,'$.canvas_voice.session_id')=NEW.id AND json_extract(a.metadata_json,'$.canvas_voice.project_id')=NEW.project_id
  AND json_extract(a.metadata_json,'$.canvas_voice.auth_session_id')=NEW.auth_session_id
  AND EXISTS(SELECT 1 FROM sessions login WHERE login.id=NEW.auth_session_id AND login.user_id=NEW.user_id AND login.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  AND EXISTS(SELECT 1 FROM canvas_voice_quotes q WHERE q.id=json_extract(a.metadata_json,'$.canvas_voice.quote_id')
   AND q.resume_session_id IS NEW.resume_session_id AND q.resume_conversation_id IS NEW.resume_conversation_id AND q.resume_expires_at IS NEW.resume_expires_at))
BEGIN SELECT RAISE(ABORT,'canvas_voice_admission_stopped'); END;
CREATE TRIGGER canvas_voice_session_identity BEFORE UPDATE OF id,project_id,user_id,request_key,request_json,settings_revision,settings_json,created_at,expires_at,max_seconds,admit_by,auth_session_id,resume_session_id,resume_conversation_id,resume_expires_at ON canvas_voice_sessions
BEGIN SELECT RAISE(ABORT,'canvas_voice_identity_immutable'); END;
CREATE TRIGGER canvas_voice_provider_identity BEFORE UPDATE OF provider_identity ON canvas_voice_sessions
WHEN OLD.provider_identity IS NOT NULL AND NEW.provider_identity IS NOT OLD.provider_identity
BEGIN SELECT RAISE(ABORT,'canvas_voice_provider_identity_invalid'); END;
CREATE TRIGGER canvas_voice_turn_owner BEFORE INSERT ON canvas_voice_turns
WHEN NOT EXISTS(SELECT 1 FROM canvas_agent_turns t JOIN canvas_voice_sessions s ON s.project_id=t.project_id
 WHERE t.id=NEW.turn_id AND s.id=NEW.session_id AND (NEW.source_turn_id IS NULL OR EXISTS(
 SELECT 1 FROM canvas_agent_turns source WHERE source.id=NEW.source_turn_id AND source.project_id=t.project_id)))
BEGIN SELECT RAISE(ABORT,'canvas_voice_owner_invalid'); END;
CREATE TRIGGER canvas_voice_project_deleted AFTER UPDATE OF deleted_at ON canvas_projects
WHEN NEW.deleted_at IS NOT NULL
BEGIN
 DELETE FROM canvas_voice_settings WHERE project_id=NEW.id;
 DELETE FROM canvas_voice_quotes WHERE project_id=NEW.id;
 DELETE FROM canvas_voice_setting_writes WHERE project_id=NEW.id;
 DELETE FROM canvas_voice_sessions WHERE project_id=NEW.id;
 DELETE FROM canvas_voice_stop_requests WHERE project_id=NEW.id;
END;
