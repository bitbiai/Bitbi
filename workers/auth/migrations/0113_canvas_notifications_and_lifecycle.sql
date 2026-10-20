-- Project removal erases creative dialogue while retaining the turn identities
-- referenced by immutable start/approval receipts. Deleting the conversation
-- cascaded into these turns and made an otherwise valid soft deletion fail.
DROP TRIGGER canvas_agent_manual_edit;
CREATE TRIGGER canvas_agent_manual_edit AFTER UPDATE OF revision,deleted_at ON canvas_projects
WHEN NEW.revision IS NOT OLD.revision OR NEW.deleted_at IS NOT OLD.deleted_at
BEGIN
 UPDATE canvas_agent_runs SET status='paused',error_code='canvas_agent_project_changed',lease_token=NULL,lease_until=NULL
 WHERE project_id=NEW.id AND (purpose='production' OR NEW.deleted_at IS NOT NULL)
 AND (status IN ('queued','planning','running','exporting') OR (status='applying' AND NEW.deleted_at IS NOT NULL));
 UPDATE canvas_agent_conversations SET state='cancelled',draft='',
   brief_json='{"version":1,"revision":0,"fields":{},"duration":{"targetDurationSeconds":null,"choice":null,"asked":false,"sourceMessageId":null},"openQuestions":[]}',
   updated_at=NEW.updated_at
 WHERE project_id=NEW.id AND NEW.deleted_at IS NOT NULL;
 UPDATE canvas_agent_turns SET state='deleted',user_text='',assistant_text=NULL,input_json='{}',updated_at=NEW.updated_at
 WHERE project_id=NEW.id AND NEW.deleted_at IS NOT NULL;
END;

-- The inbox is a projection of existing operation facts, not a new job ledger.
-- Old resolved history starts read; unresolved problems remain visible/unread.
CREATE TABLE canvas_notification_rollout (
 id INTEGER PRIMARY KEY CHECK(id=1), introduced_at TEXT NOT NULL
);
INSERT INTO canvas_notification_rollout VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
CREATE TABLE canvas_notification_reads (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 notification_id TEXT NOT NULL CHECK(length(notification_id)<=240),
 read_at TEXT NOT NULL, PRIMARY KEY(user_id,notification_id)
);
-- Browser-only transport notices are explicitly unconfirmed. No arbitrary text,
-- prompts, provider payload, authority or retry instruction is accepted here.
CREATE TABLE canvas_notification_clients (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 request_key TEXT NOT NULL, project_id TEXT REFERENCES canvas_projects(id) ON DELETE CASCADE,
 code TEXT NOT NULL CHECK(length(code)<=100), error_code TEXT CHECK(error_code IS NULL OR length(error_code)<=101), diagnostic_ref TEXT,
 http_status INTEGER CHECK(http_status BETWEEN 0 AND 599), created_at TEXT NOT NULL,
 UNIQUE(user_id,request_key)
);
CREATE INDEX canvas_notification_clients_owner ON canvas_notification_clients(user_id,created_at DESC,id DESC);
CREATE TRIGGER canvas_notification_client_identity BEFORE UPDATE ON canvas_notification_clients
BEGIN SELECT RAISE(ABORT,'canvas_notification_identity_immutable'); END;

-- Native D1 limits each compound SELECT to five terms. Keep the same ten
-- projections in two non-materialized groups, so callers still apply their
-- ownership, cursor and unread filters to this one read-only source view.
CREATE VIEW canvas_notification_sources AS
WITH project_and_production_sources AS (
 SELECT 'project:'||p.id||':created' AS id,p.user_id,p.id AS project_id,'lifecycle' AS source,
 'project' AS kind,'canvas_project_created' AS code,'success' AS severity,p.created_at,
 NULL AS diagnostic_ref,NULL AS stage,'created' AS status,1 AS resolved,'{}' AS details_json,1 AS confirmed
 FROM canvas_projects p WHERE p.deleted_at IS NULL
 UNION ALL
 SELECT 'project:'||p.id||':deleted',p.user_id,p.id,'lifecycle','project','canvas_project_deleted','success',p.deleted_at,
 NULL,NULL,'deleted',1,'{}',1 FROM canvas_projects p WHERE p.deleted_at IS NOT NULL
 UNION ALL
 SELECT 'event:'||e.id,r.user_id,r.project_id,'event','production',
 COALESCE(json_extract(e.payload_json,'$.code'),'canvas_production_update'),
 CASE WHEN e.type='error' THEN 'error' WHEN json_extract(e.payload_json,'$.code')='completed' THEN 'success'
 WHEN json_extract(e.payload_json,'$.code')='budget' THEN 'warning' ELSE 'info' END,e.created_at,
 'canvas-event-'||e.id,json_extract(e.payload_json,'$.phase'),r.status,
 CASE WHEN e.type!='error' OR r.status NOT IN ('blocked','review_required','paused') THEN 1 ELSE 0 END,
 json_object('runId',r.id,'tool',json_extract(e.payload_json,'$.tool'),'nodeId',json_extract(e.payload_json,'$.nodeId')),1
 FROM canvas_agent_events e JOIN canvas_agent_runs r ON r.id=e.run_id JOIN canvas_projects p ON p.id=r.project_id AND p.user_id=r.user_id
 WHERE r.purpose='production' AND p.deleted_at IS NULL AND e.type IN ('action','error','decision_summary')
 -- Repeated readiness checks for one unchanged failure share the first identity.
 AND (e.type!='error' OR COALESCE(json_extract(e.payload_json,'$.tool'),'')!='production.readiness' OR e.id=(SELECT MIN(x.id) FROM canvas_agent_events x WHERE x.run_id=e.run_id AND x.type='error'
   AND json_extract(x.payload_json,'$.code') IS json_extract(e.payload_json,'$.code')
   AND json_extract(x.payload_json,'$.tool') IS json_extract(e.payload_json,'$.tool')))
 UNION ALL
 SELECT 'action:'||a.id||':'||a.state||':'||COALESCE(json_extract(a.result_json,'$.pending'),0)||
 CASE WHEN a.state IN ('failed','review_required') THEN ':'||CASE
   WHEN json_extract(a.result_json,'$.code') GLOB '[a-z]*' AND json_extract(a.result_json,'$.code') NOT GLOB '*[^a-z0-9_]*'
    AND length(json_extract(a.result_json,'$.code')) BETWEEN 2 AND 101 THEN json_extract(a.result_json,'$.code') ELSE 'canvas_request_failed' END ELSE '' END,a.user_id,a.project_id,'action','action',
 CASE WHEN json_extract(a.result_json,'$.pending')=1 THEN 'canvas_agent_action_pending'
 ELSE COALESCE(json_extract(a.result_json,'$.code'),'canvas_agent_action_'||a.state) END,
 CASE WHEN a.state='completed' AND COALESCE(json_extract(a.result_json,'$.pending'),0)=0 THEN 'success'
 WHEN a.state='failed' THEN 'error' WHEN a.state IN ('review_required','confirmation_required') THEN 'warning' ELSE 'info' END,a.updated_at,
 'canvas-action-'||a.id,NULL,a.state,CASE WHEN a.state IN ('failed','review_required','confirmation_required') THEN 0 ELSE 1 END,
 json_object('actionId',a.id,'actionType',json_extract(a.input_json,'$.action.type'),'pending',json_extract(a.result_json,'$.pending')),1
 FROM canvas_agent_action_receipts a JOIN canvas_projects p ON p.id=a.project_id AND p.user_id=a.user_id
 WHERE p.deleted_at IS NULL AND a.state IN ('completed','confirmation_required','review_required','failed')
 AND json_extract(a.input_json,'$.action.type') NOT IN ('status','brief_summary','show_project','show_result','focus_node')
 UNION ALL
 SELECT 'export:'||j.id||':'||CASE WHEN j.asset_id IS NOT NULL THEN 'ready' WHEN j.status='failed' THEN 'failed:'||j.attempt_count||':'||CASE
   WHEN j.error_code GLOB '[a-z]*' AND j.error_code NOT GLOB '*[^a-z0-9_]*' AND length(j.error_code) BETWEEN 2 AND 101 THEN j.error_code ELSE 'canvas_request_failed' END
   ELSE j.status END,j.user_id,j.project_id,'export','export',
 CASE WHEN j.asset_id IS NOT NULL THEN 'canvas_export_ready' WHEN j.status='failed' THEN COALESCE(j.error_code,'canvas_export_failed')
 WHEN j.status='processing' THEN 'canvas_export_processing' ELSE 'canvas_export_waiting' END,
 CASE WHEN j.asset_id IS NOT NULL THEN 'success' WHEN j.status='failed' THEN 'error' ELSE 'info' END,j.updated_at,
 'canvas-export-'||j.id,NULL,CASE WHEN j.asset_id IS NOT NULL THEN 'ready' ELSE j.status END,
 CASE WHEN j.asset_id IS NULL AND j.status='failed' THEN 0 ELSE 1 END,
 json_object('exportId',j.id,'assetId',j.asset_id,'nodeId',j.node_id,'runId',j.run_id,'posterPending',j.asset_id IS NOT NULL AND j.status!='ready'),1
 FROM canvas_video_processing j JOIN canvas_projects p ON p.id=j.project_id AND p.user_id=j.user_id
 WHERE j.kind='concat' AND p.deleted_at IS NULL
), generation_and_dialogue_sources AS (
 SELECT 'run:'||r.id||':'||r.status||CASE WHEN r.status='failed' THEN ':'||CASE
   WHEN r.error_code GLOB '[a-z]*' AND r.error_code NOT GLOB '*[^a-z0-9_]*' AND length(r.error_code) BETWEEN 2 AND 101 THEN r.error_code ELSE 'canvas_request_failed' END
   ELSE '' END,r.user_id,r.project_id,'run','generation',
 CASE WHEN r.status='completed' THEN 'canvas_run_complete' ELSE COALESCE(r.error_code,'canvas_action_failed') END,
 CASE WHEN r.status='completed' THEN 'success' WHEN r.error_code IN ('canvas_video_pending','canvas_video_save_pending','canvas_music_pending') THEN 'info' ELSE 'error' END,
 COALESCE(r.completed_at,r.updated_at),'canvas-run-'||r.id,NULL,r.status,CASE WHEN r.status='completed' THEN 1 ELSE 0 END,
 json_object('runId',r.id,'nodeId',r.node_id,'modelId',r.model_id),1
 FROM canvas_runs r JOIN canvas_projects p ON p.id=r.project_id AND p.user_id=r.user_id
 WHERE p.deleted_at IS NULL AND r.deleted_at IS NULL AND r.status IN ('completed','failed')
 UNION ALL
 SELECT 'turn:'||t.id||':'||t.state||':'||CASE WHEN t.error_code GLOB '[a-z]*' AND t.error_code NOT GLOB '*[^a-z0-9_]*'
   AND length(t.error_code) BETWEEN 2 AND 101 THEN t.error_code ELSE 'canvas_request_failed' END,
 p.user_id,t.project_id,'conversation','conversation',COALESCE(t.error_code,'canvas_agent_action_review_required'),
 'warning',t.updated_at,'canvas-turn-'||t.id,NULL,t.state,0,json_object('turnId',t.id),1
 FROM canvas_agent_turns t JOIN canvas_projects p ON p.id=t.project_id
 WHERE p.deleted_at IS NULL AND t.state IN ('review_required','failed')
 UNION ALL
 SELECT 'decision:'||d.id||':'||d.state,d.user_id,d.project_id,'decision','authorization',
 CASE WHEN d.state='cancelled' THEN 'canvas_decision_declined' WHEN d.kind='briefing_allowance' THEN 'canvas_allowance_accepted' ELSE 'canvas_production_started' END,
 'info',a.created_at,'canvas-decision-'||d.id,NULL,d.state,1,json_object('decisionId',d.id,'runId',d.run_id),1
 FROM canvas_agent_conversation_decisions d JOIN canvas_projects p ON p.id=d.project_id AND p.user_id=d.user_id
 JOIN canvas_agent_conversation_actions a ON a.project_id=d.project_id AND a.request_key=d.decision_key
   AND json_extract(a.input_json,'$.kind')='decision' AND json_extract(a.input_json,'$.decisionId')=d.id
 WHERE p.deleted_at IS NULL AND d.state IN ('consumed','cancelled') AND d.kind IN ('briefing_allowance','production_start')
 UNION ALL
 SELECT 'immediate:'||i.id||':'||i.state||CASE WHEN i.state='blocked' THEN ':'||CASE
   WHEN i.error_code GLOB '[a-z]*' AND i.error_code NOT GLOB '*[^a-z0-9_]*' AND length(i.error_code) BETWEEN 2 AND 101 THEN i.error_code ELSE 'canvas_request_failed' END ELSE '' END,
 i.user_id,i.project_id,'immediate','authorization',
 CASE WHEN i.state='started' THEN 'canvas_production_started' WHEN i.state='approval_required' THEN 'canvas_start_approval_required'
 WHEN i.state='blocked' THEN COALESCE(i.error_code,'canvas_agent_action_review_required') WHEN i.state='cancelled' THEN 'canvas_start_cancelled' ELSE 'canvas_start_requested' END,
 CASE WHEN i.state='blocked' THEN 'warning' ELSE 'info' END,i.updated_at,'canvas-intent-'||i.id,NULL,i.state,
 CASE WHEN i.state IN ('blocked','approval_required') THEN 0 ELSE 1 END,json_object('intentId',i.id,'runId',i.run_id),1
 FROM canvas_agent_start_intents i JOIN canvas_projects p ON p.id=i.project_id AND p.user_id=i.user_id
 WHERE p.deleted_at IS NULL
 UNION ALL
 SELECT 'client:'||c.id,c.user_id,c.project_id,'client','connection',c.code,
 CASE WHEN c.http_status>=400 OR c.code IN ('network_error','request_timeout','canvas_save_failed','canvas_request_failed','canvas_action_failed','canvas_project_delete_unconfirmed')
 THEN 'warning' ELSE 'info' END,c.created_at,c.diagnostic_ref,NULL,CAST(c.http_status AS TEXT),1,json_object('errorCode',c.error_code),0
 FROM canvas_notification_clients c LEFT JOIN canvas_projects p ON p.id=c.project_id AND p.user_id=c.user_id
 WHERE c.project_id IS NULL OR p.id IS NOT NULL
)
SELECT * FROM project_and_production_sources
UNION ALL
SELECT * FROM generation_and_dialogue_sources;
