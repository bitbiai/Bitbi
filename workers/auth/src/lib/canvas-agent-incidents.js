import { nowIso, sha256Hex } from './tokens.js';
import { logDiagnostic } from '../../../../js/shared/worker-observability.mjs';
import { canvasConversationExecutionFacts } from './canvas-agent-conversation-context.js';
import { canvasAgentValidationDiagnostic } from '../../../shared/canvas-agent-plan.mjs';

const parse=value=>{try{return JSON.parse(value||'null');}catch{return null;}};
const safe=value=>typeof value==='string'&&/^[A-Za-z0-9_.:/-]{1,160}$/.test(value)?value:null;
const errorCode=value=>typeof value==='string'&&/^[a-z][a-z0-9_]{1,100}$/.test(value)?value:null;
const rows=value=>value.results||[];
const excluded=new Set(['canvas_agent_start_approval_required','canvas_start_approval_required','canvas_agent_action_confirmation_required']);
const sqlSafe=value=>`CASE WHEN typeof(${value})='text' AND length(${value}) BETWEEN 1 AND 160 AND ${value} NOT GLOB '*[^A-Za-z0-9_.:/-]*' THEN ${value} END`;
const detail=key=>sqlSafe(`json_extract(n.details_json,'$.${key}')`);
const sqlCode=value=>`CASE WHEN typeof(${value})='text' AND ${value} GLOB '[a-z]*' AND ${value} NOT GLOB '*[^a-z0-9_]*' AND length(${value}) BETWEEN 2 AND 101 THEN ${value} END`;
const sourceCode=`COALESCE(${sqlCode("json_extract(n.details_json,'$.errorCode')")},${sqlCode('n.code')},'canvas_request_failed')`;
const sourceKeySql=`n.source||':'||COALESCE(${['exportId','actionId','turnId','intentId','runId'].map(detail).join(',')},n.id)||':'||(${sourceCode})||':'||COALESCE(${detail('nodeId')},'')||':'||COALESCE(${sqlSafe('n.stage')},'')||':'||COALESCE(${detail('tool')},'')`;
const sourceSql=`SELECT n.*,p.locale FROM canvas_notification_sources n JOIN canvas_projects p ON p.id=n.project_id AND p.user_id=n.user_id
 JOIN users u ON u.id=p.user_id CROSS JOIN canvas_agent_incident_rollout b
 WHERE p.deleted_at IS NULL AND u.status='active' AND n.severity IN ('error','warning')
 AND n.status IS NOT 'confirmation_required' AND (${sourceCode}) NOT IN ('canvas_agent_start_approval_required','canvas_start_approval_required','canvas_agent_action_confirmation_required')
 AND (n.created_at>=b.introduced_at OR n.resolved=0)
 AND NOT EXISTS(SELECT 1 FROM canvas_agent_incidents known WHERE known.project_id=n.project_id AND known.source_key=(${sourceKeySql}))
 AND NOT EXISTS(SELECT 1 FROM canvas_agent_incident_explanations x JOIN canvas_agent_turns t ON t.id=x.turn_id
   WHERE n.source='conversation' AND t.id=json_extract(n.details_json,'$.turnId'))
 AND NOT EXISTS(SELECT 1 FROM canvas_agent_incident_explanations x
   WHERE n.source='event' AND x.model_run_id=json_extract(n.details_json,'$.runId'))`;

export function canvasIncidentSource(row) {
  const details=parse(row.details_json)||{},bounded={};
  for(const key of ['runId','nodeId','assetId','exportId','actionId','turnId','intentId','modelId','actionType','tool'])if(safe(details[key]))bounded[key]=details[key];
  const code=errorCode(details.errorCode)||errorCode(row.code)||'canvas_request_failed';
  if(excluded.has(code)||row.status==='confirmation_required')return null;
  const operation=bounded.exportId||bounded.actionId||bounded.turnId||bounded.intentId||bounded.runId||row.id;
  // Retries of the same operation/cause coalesce; distinct operations retain IDs.
  const key=[row.source,operation,code,bounded.nodeId||'',safe(row.stage)||'',bounded.tool||''].join(':');
  return {key,id:row.id,source:row.source,code,at:row.created_at,diagnosticRef:safe(row.diagnostic_ref),
    stage:safe(row.stage),confirmed:Boolean(row.confirmed),details:bounded,locale:row.locale==='de'?'de':'en'};
}
const validation=value=>canvasAgentValidationDiagnostic(value);
export async function canvasIncidentContext(env,userId,projectId,source) {
  const facts=await canvasConversationExecutionFacts(env,userId,projectId),d=source.details;
  let operation=null,affected=null,diagnostic=null,progress=null;
  if(source.source==='event'){
    const run=await env.DB.prepare('SELECT id,status,phase,error_code,cause_json,model_id,next_attempt_at,expires_at,expected_revision FROM canvas_agent_runs WHERE id=? AND project_id=? AND user_id=?')
      .bind(d.runId,projectId,userId).first();
    const original=run?await env.DB.prepare('SELECT initial_context_json FROM canvas_agent_incidents WHERE project_id=? AND user_id=? AND source_notification_id=?')
      .bind(projectId,userId,source.id).first():null;
    const initial=parse(original?.initial_context_json);
    const event=run?await env.DB.prepare("SELECT payload_json FROM canvas_agent_events WHERE run_id=? AND 'event:'||id=?")
      .bind(run.id,source.id).first():null;
    const payload=parse(event?.payload_json)||{},stepId=safe(initial?.operation?.stepId)||safe(payload.stepId),operationId=safe(initial?.operation?.id)||safe(payload.operationId);
    // Once captured, retain the exact original operation. Later correction/media
    // receipts must not become evidence about an earlier planning rejection.
    const predicates=stepId?'s.id=?':operationId?'o.id=?':`s.created_at<=? AND (s.status IN ('rejected','accepted') OR o.error_code=?)
      AND (o.response_at IS NULL OR o.response_at<=?)${d.nodeId?' AND s.node_id=?':''}`;
    const bindings=stepId?[stepId]:operationId?[operationId]:[source.at,source.code,source.at,...(d.nodeId?[d.nodeId]:[])];
    const receipt=run?await env.DB.prepare(`SELECT s.id AS step_id,s.kind,s.status,s.receipt_json,o.id AS operation_id,o.state,o.response_json IS NOT NULL AS response_stored,
      o.receipt_json AS operation_receipt,o.model,o.response_at,a.billing_status,a.credit_cost,a.provider_outcome
      FROM canvas_agent_steps s LEFT JOIN canvas_agent_model_operations o ON o.step_id=s.id
      LEFT JOIN member_ai_usage_attempts_v2 a ON a.id=s.usage_attempt_id
      WHERE s.run_id=? AND ${predicates}
      ORDER BY CASE WHEN o.error_code=? THEN 0 ELSE 1 END,s.rowid DESC LIMIT 1`).bind(run.id,...bindings,source.code).first():null;
    const result=parse(receipt?.operation_receipt)||parse(receipt?.receipt_json),cause=parse(run?.cause_json);
    diagnostic=validation(initial?.validation||payload.validationDiagnostic||payload.diagnostic||result?.validationDiagnostic||result?.diagnostic
      ||(run?.error_code===source.code?cause?.validationDiagnostic||cause?.diagnostic:null));
    if(!diagnostic&&receipt?.operation_id&&receipt.response_stored&&result?.outcome==='completed'&&result.ok===false){
      const stored=await env.DB.prepare('SELECT * FROM canvas_agent_model_operations WHERE id=? AND run_id=? AND user_id=?').bind(receipt.operation_id,run.id,userId).first();
      diagnostic=(await import('./canvas-agent-plan-interpretation.js')).diagnoseStoredCanvasPlan(stored);
    }
    const scheduled=run&&['queued','planning','applying','running','exporting'].includes(run.status)&&run.next_attempt_at
      &&run.expires_at>facts.observedAt&&run.expected_revision===facts.projectRevision
      &&(run.error_code!==source.code||cause?.recovery==='readiness'&&!cause.readiness?.exhausted);
    affected=run?{runId:run.id,status:run.status,phase:run.phase,errorCode:errorCode(run.error_code),modelId:run.model_id,
      recovery:scheduled?'automatic':null,nextAttemptAt:run.next_attempt_at}:null;
    if(receipt)operation={id:receipt.operation_id,stepId:receipt.step_id,kind:receipt.kind,state:receipt.state,
      responseStored:Boolean(receipt.response_stored),outcome:safe(result?.outcome)||safe(receipt.provider_outcome),
      valid:typeof result?.ok==='boolean'?result.ok:null,responseAt:receipt.response_at,modelId:receipt.model,
      validation:diagnostic,
      billingStatus:receipt.billing_status,reservationCredits:receipt.billing_status==='reserved'?receipt.credit_cost:null};
    if(run&&['planning','validating'].includes(source.stage)){
      const applied=await env.DB.prepare(`SELECT p.step_id,p.updated_at FROM canvas_agent_proposals p WHERE p.run_id=? AND p.status='applied' AND p.updated_at>=?
        AND EXISTS(SELECT 1 FROM canvas_agent_steps s JOIN canvas_nodes n ON n.id=s.node_id AND n.project_id=? AND n.user_id=?
          WHERE s.run_id=p.run_id AND s.kind='node') ORDER BY p.updated_at DESC LIMIT 1`).bind(run.id,source.at,projectId,userId).first();
      if(applied)progress={kind:'plan_applied',stepId:applied.step_id,at:applied.updated_at};
    } else if(receipt?.status==='completed'&&parse(receipt.receipt_json)?.ok===true)progress={kind:'step_completed',stepId:receipt.step_id};
  } else if(source.source==='export'){
    const job=await env.DB.prepare('SELECT id,status,error_code,asset_id,next_attempt_at,attempt_count FROM canvas_video_processing WHERE id=? AND project_id=? AND user_id=?')
      .bind(d.exportId,projectId,userId).first();
    affected=job?{exportId:job.id,status:job.asset_id?'ready':job.status,errorCode:errorCode(job.error_code),assetId:job.asset_id,
      recovery:!job.asset_id&&['queued','processing'].includes(job.status)?'automatic':null,nextAttemptAt:job.next_attempt_at,attempts:job.attempt_count}:null;
  } else if(source.source==='run'){
    const run=await env.DB.prepare('SELECT id,status,error_code,asset_id,model_id FROM canvas_runs WHERE id=? AND project_id=? AND user_id=? AND deleted_at IS NULL').bind(d.runId,projectId,userId).first();
    affected=run?{runId:run.id,status:run.status,errorCode:errorCode(run.error_code),assetId:run.asset_id,modelId:run.model_id}:null;
  } else if(source.source==='action'){
    const action=await env.DB.prepare('SELECT id,state,result_json FROM canvas_agent_action_receipts WHERE id=? AND project_id=? AND user_id=?').bind(d.actionId,projectId,userId).first();
    affected=action?{actionId:action.id,status:action.state,errorCode:errorCode(parse(action.result_json)?.code)}:null;
  } else if(source.source==='conversation'){
    const turn=await env.DB.prepare("SELECT id,state,error_code FROM canvas_agent_turns WHERE id=? AND project_id=? AND state!='deleted'").bind(d.turnId,projectId).first();
    affected=turn?{turnId:turn.id,status:turn.state,errorCode:errorCode(turn.error_code)}:null;
  } else if(source.source==='immediate'){
    const intent=await env.DB.prepare('SELECT id,state,error_code FROM canvas_agent_start_intents WHERE id=? AND project_id=? AND user_id=?').bind(d.intentId,projectId,userId).first();
    affected=intent?{intentId:intent.id,status:intent.state,errorCode:errorCode(intent.error_code)}:null;
  }
  const complete=source.source==='event'?Boolean(progress):affected&&['ready','completed','started','succeeded'].includes(affected.status);
  const state=complete?'resolved':affected?.recovery==='automatic'?'recovering':'active';
  const retention=await env.DB.prepare(`SELECT COUNT(*) AS nodes,COALESCE(SUM(asset_id IS NOT NULL OR output_json IS NOT NULL),0) AS resultNodes
    FROM canvas_nodes WHERE project_id=? AND user_id=? AND deleted_at IS NULL`).bind(projectId,userId).first();
  return {version:1,trust:'server_observation',source:{...source,details:d},observedAt:facts.observedAt,observedUntil:facts.observedUntil,
    changedDuringObservation:facts.changedDuringObservation,state,affected,operation,validation:diagnostic,progress,
    production:facts.production?{id:facts.production.id,status:facts.production.status,phase:facts.production.phase,
      errorCode:facts.production.errorCode,completed:facts.production.completed,total:facts.production.total,
      repairAttempts:facts.production.repairAttempts,authorityExpired:facts.production.authorityExpired}:null,
    retained:{nodes:retention.nodes,resultNodes:retention.resultNodes,exportAssets:facts.exports.filter(item=>item.assetId).map(item=>item.assetId)},
    budgets:facts.budgets};
}

export function canvasIncidentExplanation(context,reason='not_authorized') {
  const de=context.source.locale==='de',source=context.source,affected=context.affected,op=context.operation;
  const parts=[];
  if(context.state==='resolved')parts.push(de?'Der zuvor gemeldete Fehler ist inzwischen überwunden; der gespeicherte Auftrag ist weitergekommen.':'The earlier error has now been overcome; the stored operation has advanced.');
  else if(!source.confirmed)parts.push(de?'Die Oberfläche konnte einen Canvas-Vorgang oder seinen Status nicht zuverlässig bestätigen. Das ist kein Nachweis dafür, dass die Produktion angehalten wurde.':'The interface could not reliably confirm a Canvas operation or its status. This does not establish that production stopped.');
  else if(source.code==='canvas_agent_plan_invalid')parts.push(de?'Der Produktionsplan konnte nicht übernommen werden.':'The production plan could not be accepted.');
  else if(source.source==='export')parts.push(de?'Der angeforderte Videoexport konnte noch nicht abgeschlossen werden.':'The requested video export has not completed.');
  else if(source.source==='run')parts.push(de?'Bei einem Generierungsschritt ist ein Fehler aufgetreten.':'A generation step encountered an error.');
  else if(source.source==='conversation')parts.push(de?'Die letzte Modellantwort konnte nicht vollständig bereitgestellt werden.':'The last model reply could not be delivered completely.');
  else parts.push(de?'Ein Vorgang in diesem Canvas-Projekt benötigt Aufmerksamkeit.':'An operation in this Canvas project needs attention.');
  if(context.state!=='resolved'){
    if((op?.validation||context.validation)?.reason==='terminal_transition')parts.push(de?'Beim letzten Clip ist eine Überblendung zu einem weiteren Clip eingetragen, obwohl kein weiterer Clip folgt.':'The last clip specifies a transition to another clip even though no clip follows it.');
    else if(op?.validation||context.validation)parts.push(de?'Die gespeicherte Antwort verletzt eine geprüfte Regel für die Struktur oder die Beziehungen des Plans. Die genaue Prüfstelle steht in Meldungen.':'The stored reply violates a validated rule for the plan structure or its relationships. Notifications contains the precise validation detail.');
    else if(source.confirmed)parts.push(de?'Eine genauere Ursache ist anhand der gespeicherten Belege noch nicht gesichert.':'The stored evidence does not yet establish a more precise cause.');
  }
  const run=context.production,related=affected?.runId===run?.id;
  if(source.confirmed&&context.state!=='resolved'&&run){
    if(related&&['blocked','review_required'].includes(run.status))parts.push(de?'Diese Produktion wartet auf eine sichere Klärung.':'This production is waiting for a safe resolution.');
    else if(!related&&['running','planning','exporting','queued'].includes(run.status))parts.push(de?'Die Produktion ist weiterhin aktiv; dieser Hinweis allein belegt keinen Produktionsstopp.':'Production remains active; this notice alone does not establish a production blocker.');
  }
  if(op?.responseStored&&op.valid===false&&op.outcome==='completed')parts.push(de?'Die ursprüngliche Antwort ist gespeichert; ihr Ausgang ist bekannt.':'The original response is retained; its outcome is known.');
  else if(context.retained.resultNodes||context.retained.exportAssets.length)parts.push(de?'Bereits gespeicherte Ergebnisse bleiben erhalten.':'Previously saved results remain retained.');
  if(op?.billingStatus==='finalized')parts.push(de?'Der ursprüngliche Modellaufruf ist abgerechnet; eine ungültige Antwort bedeutet nicht, dass keine Kosten entstanden sind.':'The original model call has been settled; an invalid reply does not mean no cost was incurred.');
  if(context.state==='recovering')parts.push(de?'Die bestehende Wiederherstellung ist vorgemerkt oder läuft bereits; ein erfolgreicher Folgeschritt ist noch nicht belegt. Diese Erklärung startet keinen neuen Auftrag.':'Existing recovery is scheduled or underway; a successful next step is not yet evidenced. This explanation starts no new operation.');
  else if(context.state!=='resolved')parts.push(de?'Der Beleg muss geprüft werden; diese Auskunft startet keine Wiederholung. Details stehen in Meldungen.':'The receipt needs review; this explanation starts no retry. Details are in Notifications.');
  if(reason==='model_failed'||reason==='model_outcome_unknown')parts.push(de?'Die KI-Erklärung konnte nicht bereitgestellt werden. Dies ist eine Canvas-Systemauskunft; der bestehende Modellauftrag wird nicht erneut versandt.':'The AI explanation could not be delivered. This is Canvas system information; the existing model request is not being resubmitted.');
  else if(reason!=='model_pending')parts.push(de?'KI-Analyse war für diese Erklärung nicht verfügbar oder nicht freigegeben. Dies ist eine Canvas-Systemauskunft ohne neuen Modellaufruf.':'AI analysis was unavailable or not authorized for this explanation. This is Canvas system information without a new model call.');
  else parts.push(de?'Dies ist zunächst eine Canvas-Systemauskunft; die freigegebene KI-Erklärung wird unter derselben Nachricht ergänzt.':'This is initial Canvas system information; the authorized AI explanation will update this same message.');
  return parts.join(' ').slice(0,8000);
}

async function publishFallback(env,incident,context) {
  const {ensureConversation}=await import('./canvas-agent-conversation.js');
  const conversation=await ensureConversation(env,incident.project_id,incident.user_id);
  if(!conversation||conversation.state==='cancelled')return;
  const turnId=(await sha256Hex(`canvas-incident-turn:${incident.id}:${incident.revision}`)).slice(0,32),now=nowIso();
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO canvas_agent_turns(id,project_id,request_key,input_json,conversation_revision,brief_revision,user_text,assistant_text,state,created_at,updated_at)
      SELECT ?,? ,?,?,c.revision,c.brief_revision,'',?,'completed',?,? FROM canvas_agent_conversations c JOIN canvas_projects p ON p.id=c.project_id
      JOIN users u ON u.id=c.user_id WHERE c.project_id=? AND c.user_id=? AND c.state!='cancelled' AND p.deleted_at IS NULL AND u.status='active'`)
      .bind(turnId,incident.project_id,`incident:${incident.id}:${incident.revision}`,JSON.stringify({kind:'incident_explanation',incidentId:incident.id,revision:incident.revision}),canvasIncidentExplanation(context),now,now,incident.project_id,incident.user_id),
    env.DB.prepare(`INSERT OR IGNORE INTO canvas_agent_incident_explanations(incident_id,revision,turn_id,state,fallback_reason,created_at,updated_at)
      SELECT ?,?,?,'fallback','not_authorized',?,? WHERE EXISTS(SELECT 1 FROM canvas_agent_turns WHERE id=? AND state='completed')`)
      .bind(incident.id,incident.revision,turnId,now,now,turnId),
  ]);
}
async function capture(env,row) {
  const source=canvasIncidentSource(row);if(!source)return;
  const prior=await env.DB.prepare('SELECT * FROM canvas_agent_incidents WHERE project_id=? AND source_key=?').bind(row.project_id,source.key).first();
  if(prior)return;
  const context=await canvasIncidentContext(env,row.user_id,row.project_id,source),now=nowIso();
  const id=(await sha256Hex(`canvas-incident:${row.project_id}:${source.key}`)).slice(0,32),json=JSON.stringify(context);
  await env.DB.prepare(`INSERT OR IGNORE INTO canvas_agent_incidents(id,project_id,user_id,source_key,source_notification_id,source_json,initial_context_json,context_json,state,created_at,updated_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM canvas_projects p JOIN users u ON u.id=p.user_id WHERE p.id=? AND p.user_id=? AND p.deleted_at IS NULL AND u.status='active')`)
    .bind(id,row.project_id,row.user_id,source.key,source.id,JSON.stringify(source),json,json,context.state,now,now,row.project_id,row.user_id).run();
}

export async function syncCanvasProjectIncidents(env,{projectId=null,userId=null,allowInference=true}={}) {
  // Failed briefing turns must be projected without waiting for a browser GET.
  // Accepted unknown operations retain their usage/dispatch identities.
  await env.DB.prepare(`UPDATE canvas_agent_turns SET state=CASE WHEN (SELECT status FROM canvas_agent_runs WHERE id=run_id)='review_required' THEN 'review_required' ELSE 'failed' END,
    error_code=(SELECT error_code FROM canvas_agent_runs WHERE id=run_id),updated_at=?
    WHERE state='pending' AND run_id IN (SELECT r.id FROM canvas_agent_runs r JOIN canvas_projects p ON p.id=r.project_id
      WHERE r.status IN ('blocked','review_required') AND p.deleted_at IS NULL AND (? IS NULL OR r.project_id=?) AND (? IS NULL OR r.user_id=?))`)
    .bind(nowIso(),projectId,projectId,userId,userId).run();
  const filters=[],params=[];
  if(projectId){filters.push('n.project_id=?');params.push(projectId);}
  if(userId){filters.push('n.user_id=?');params.push(userId);}
  // A bounded batch stays below Worker/D1 subrequest limits. Durable rows and
  // the next cron sweep retain the remainder; no incident evidence is deleted.
  const sources=rows(await env.DB.prepare(sourceSql+(filters.length?' AND '+filters.join(' AND '):'')+' ORDER BY n.created_at DESC,n.id DESC LIMIT 8').bind(...params).all());
  for(const source of sources)await capture(env,source);
  const owned=[],args=[];
  if(projectId){owned.push('i.project_id=?');args.push(projectId);}
  if(userId){owned.push('i.user_id=?');args.push(userId);}
  const incidents=rows(await env.DB.prepare(`SELECT i.* FROM canvas_agent_incidents i JOIN canvas_projects p ON p.id=i.project_id AND p.user_id=i.user_id JOIN users u ON u.id=i.user_id
    WHERE p.deleted_at IS NULL AND u.status='active'${owned.length?' AND '+owned.join(' AND '):''}
    AND (i.state!='resolved' OR NOT EXISTS(SELECT 1 FROM canvas_agent_incident_explanations x WHERE x.incident_id=i.id AND x.revision=i.revision)
      OR EXISTS(SELECT 1 FROM canvas_agent_incident_explanations x WHERE x.incident_id=i.id AND x.state='pending'))
    ORDER BY CASE WHEN NOT EXISTS(SELECT 1 FROM canvas_agent_incident_explanations x WHERE x.incident_id=i.id AND x.revision=i.revision) THEN 0 ELSE 1 END,i.updated_at LIMIT 8`).bind(...args).all());
  for(let incident of incidents){
    const context=await canvasIncidentContext(env,incident.user_id,incident.project_id,parse(incident.source_json));
    const next=incident.state==='resolved'?'resolved':context.state;
    if(next!==incident.state){
      // Retry/readiness fluctuations update current evidence, not the message
      // budget. Reserve the next bounded explanation for substantive recovery.
      const revision=next==='resolved'?Math.min(3,incident.revision+1):incident.revision;
      const changed=await env.DB.prepare('UPDATE canvas_agent_incidents SET state=?,revision=?,context_json=?,updated_at=? WHERE id=? AND revision=? AND state=?')
        .bind(next,revision,JSON.stringify(context),nowIso(),incident.id,incident.revision,incident.state).run();
      if(changed.meta?.changes!==1)continue;
      incident={...incident,state:next,revision,context_json:JSON.stringify(context)};
    } else await env.DB.prepare('UPDATE canvas_agent_incidents SET context_json=?,updated_at=? WHERE id=? AND revision=?')
        .bind(JSON.stringify({...context,state:next}),nowIso(),incident.id,incident.revision).run();
    await publishFallback(env,incident,{...context,state:next});
    if(allowInference)await (await import('./canvas-agent-incident-model.js')).prepareCanvasIncidentExplanation(env,incident,{...context,state:next});
  }
  await (await import('./canvas-agent-incident-model.js')).reconcileCanvasIncidentExplanations(env,{projectId,userId});
  return {observed:sources.length,incidents:incidents.length};
}
export async function captureCanvasProjectIncidents(env,projectId,userId) {
  try{return await syncCanvasProjectIncidents(env,{projectId,userId});}
  catch{logDiagnostic({service:'bitbi-auth',component:'canvas-incidents',event:'canvas_incident_capture_failed',level:'warn',correlationId:safe(projectId),code:'canvas_incident_projection_pending'});return {pending:true};}
}
export async function canvasIncidentConversationProjection(env,projectId,userId) {
  const records=rows(await env.DB.prepare(`SELECT x.*,i.source_notification_id,i.state AS incident_state,i.user_id FROM canvas_agent_incident_explanations x
    JOIN canvas_agent_incidents i ON i.id=x.incident_id JOIN canvas_projects p ON p.id=i.project_id AND p.user_id=i.user_id
    WHERE i.project_id=? AND i.user_id=? AND p.deleted_at IS NULL`).bind(projectId,userId).all());
  return {records,revision:records.reduce((sum,row)=>sum+row.revision+(row.state==='model'?10:0),0)};
}
