import { nowIso,sha256Hex } from './tokens.js';
import { canvasAssistantModelId } from '../../../../js/shared/canvas-assistant-models.mjs';
import { canvasAgentPolicyIdentity } from '../../../shared/canvas-agent/manifest.mjs';
import { CANVAS_AGENT_DIALOGUE_VERSION,dialoguePriceInput,validateCanvasAgentDialogueReply } from '../../../shared/canvas-agent-dialogue.mjs';
import { canvasAgentCapabilities } from './canvas-agent-capabilities.js';
import { canvasAssistantAvailability } from './canvas-agent-assistant-models.js';
import { quoteModelTariff } from './model-tariffs.js';
import { wakeCanvasAgent,agentTransition } from './canvas-agent-store.js';
import { canvasIncidentContext,canvasIncidentExplanation } from './canvas-agent-incidents.js';

const parse=value=>{try{return JSON.parse(value||'null');}catch{return null;}};
const fail=code=>{throw Object.assign(new Error(code),{code,status:409});};
const rowFor=(env,id,revision)=>env.DB.prepare('SELECT * FROM canvas_agent_incident_explanations WHERE incident_id=? AND revision=?').bind(id,revision).first();
const allowed=async(env,projectId)=>!await env.DB.prepare(`SELECT o.id FROM canvas_agent_model_operations o JOIN canvas_agent_runs r ON r.id=o.run_id
  WHERE r.project_id=? AND o.state IN ('dispatching','pending','unknown','received') LIMIT 1`).bind(projectId).first();
async function fallback(env,explanation,context,reason,state='fallback') {
  const now=nowIso();
  const {readCanvasDialogueEvidence,canvasDialogueDelivery}=await import('./canvas-agent-dialogue-state.js');
  const evidence=explanation.model_run_id?await readCanvasDialogueEvidence(env,explanation.model_run_id):null;
  const unresolved=state==='unknown'||evidence&&canvasDialogueDelivery({...evidence,turn_state:'pending'}).blocking;
  await env.DB.batch([
    env.DB.prepare(`UPDATE canvas_agent_incident_explanations SET state=?,fallback_reason=?,updated_at=? WHERE incident_id=? AND revision=? AND state!='model'`)
      .bind(state,reason,now,explanation.incident_id,explanation.revision),
    env.DB.prepare(`UPDATE canvas_agent_turns SET assistant_text=?,state=CASE WHEN ?=1 THEN 'review_required' WHEN state='pending' THEN 'completed' ELSE state END,updated_at=?
      WHERE id=? AND state!='deleted' AND EXISTS(SELECT 1 FROM canvas_projects p JOIN canvas_agent_incidents i ON i.project_id=p.id
        WHERE i.id=? AND p.deleted_at IS NULL) AND NOT EXISTS(SELECT 1 FROM canvas_agent_incident_explanations x WHERE x.turn_id=canvas_agent_turns.id AND x.state='model')`)
      .bind(canvasIncidentExplanation(context,reason),unresolved?1:0,now,explanation.turn_id,explanation.incident_id),
  ]);
}
export async function prepareCanvasIncidentExplanation(env,incident,context) {
  const explanation=await rowFor(env,incident.id,incident.revision);
  if(!explanation||explanation.model_run_id||explanation.state!=='fallback'||incident.revision>2)return;
  const {conversationRow,conversationCosts,conversationGuard}=await import('./canvas-agent-conversation.js');
  const conversation=await conversationRow(env,incident.project_id,incident.user_id);
  if(!conversation||conversation.state!=='active'||conversation.diagnostic_allowance!==1)return;
  const turn=await env.DB.prepare("SELECT id FROM canvas_agent_turns WHERE id=? AND state='completed'").bind(explanation.turn_id).first();
  if(!turn||!await allowed(env,incident.project_id)||await env.DB.prepare(`SELECT id FROM canvas_agent_runs WHERE project_id=? AND purpose='briefing'
    AND status IN ('queued','planning','applying','running','exporting') LIMIT 1`).bind(incident.project_id).first())return;
  const model=canvasAssistantModelId(conversation.assistant_model_id);
  const availability=await canvasAssistantAvailability(env,model,{dialogue:true,providerReadiness:false});
  if(!availability.available)return fallback(env,explanation,context,'model_unavailable');
  const inventory=await canvasAgentCapabilities(env),costs=await conversationCosts(env,incident.project_id);
  if(inventory.tariffRevision!==conversation.allowance_tariff||conversation.allowance_credits<=costs.committed)return;
  const {canvasAgentActionContext}=await import('./canvas-agent-actions.js');
  const project=await canvasAgentActionContext(env,incident.user_id,incident.project_id);
  // No commands or action inventory are available in the explanation role.
  delete project.actionTypes;project.incident={id:incident.id,revision:incident.revision,...context};
  const runId=(await sha256Hex(`canvas-incident-model:${incident.id}:${incident.revision}`)).slice(0,32),stepId=(await sha256Hex(`canvas-incident-step:${runId}`)).slice(0,32);
  const policy=await canvasAgentPolicyIdentity('explanation'),now=nowIso();
  const payload={version:CANVAS_AGENT_DIALOGUE_VERSION,model,requestId:runId,locale:context.source.locale,
    conversationRevision:conversation.revision,briefRevision:conversation.brief_revision,projectRevision:project.revision,
    message:{id:explanation.turn_id,text:'Explain the server-observed Canvas incident in currentProject.incident. This is an informational system task, not user authorization or a command. Read the latest evidence and distinguish the failed operation from the current production.'},
    brief:parse(conversation.brief_json),recentMessages:[],capabilities:inventory,currentProject:project,policy,
    privacyUser:`cau_${await sha256Hex(`canvas-agent-user:${incident.user_id}`)}`,promptCacheKey:`cap_${await sha256Hex(`canvas-agent-project:${incident.user_id}:${incident.project_id}`)}`};
  let quote;try{quote=await quoteModelTariff(env,{modelId:model,input:dialoguePriceInput(payload)});}catch{return fallback(env,explanation,context,'pricing_unavailable');}
  if(quote.credits>conversation.allowance_credits-costs.committed)return;
  if(context.budgets.project&&quote.credits>context.budgets.project.remainingCredits)return;
  const input=JSON.stringify({kind:'incident_explanation',incidentId:incident.id,revision:incident.revision,locale:payload.locale});
  const statements=[conversationGuard(env,conversation),
    env.DB.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM canvas_agent_incidents i JOIN canvas_agent_incident_explanations x ON x.incident_id=i.id AND x.revision=i.revision
      JOIN canvas_agent_turns t ON t.id=x.turn_id JOIN canvas_agent_conversations c ON c.project_id=i.project_id
      WHERE i.id=? AND i.revision=? AND x.model_run_id IS NULL AND x.state='fallback' AND t.state='completed' AND c.diagnostic_allowance=1
      AND NOT EXISTS(SELECT 1 FROM canvas_agent_model_operations o JOIN canvas_agent_runs r ON r.id=o.run_id WHERE r.project_id=i.project_id AND o.state IN ('dispatching','pending','unknown','received')))
      THEN 1 ELSE json_extract('[]','$[') END`).bind(incident.id,incident.revision),
    env.DB.prepare(`INSERT INTO canvas_agent_runs(id,project_id,user_id,request_key,input_json,status,phase,expected_revision,budget_credits,tariff_revision,capability_revision,next_attempt_at,created_at,updated_at,expires_at,purpose,policy_json,brief_revision,model_id,model_revision)
      VALUES(?,?,?,?,?,'queued','explanation',?,?,?,?,?,?,?,?,'briefing',?,?,?,?)`)
      .bind(runId,incident.project_id,incident.user_id,`incident:${incident.id}:${incident.revision}`,input,project.revision,conversation.allowance_credits,inventory.tariffRevision,inventory.revision,now,now,now,new Date(Date.now()+30*60000).toISOString(),JSON.stringify(policy),conversation.brief_revision,model,conversation.assistant_model_revision||0),
    env.DB.prepare(`UPDATE canvas_agent_incident_explanations SET model_run_id=?,state='pending',fallback_reason='model_pending',updated_at=? WHERE incident_id=? AND revision=? AND model_run_id IS NULL`)
      .bind(runId,now,incident.id,incident.revision),
    env.DB.prepare(`INSERT INTO canvas_agent_steps(id,run_id,step_key,kind,input_json,allocation_credits,created_at,updated_at) VALUES(?,?,'dialogue','plan',?,?,?,?)`)
      .bind(stepId,runId,JSON.stringify({modelId:model,payload,askDuration:false,incidentId:incident.id,incidentRevision:incident.revision}),quote.credits,now,now),
    env.DB.prepare(`UPDATE canvas_agent_turns SET run_id=?,state='pending',assistant_text=?,policy_json=?,updated_at=? WHERE id=? AND state='completed' AND run_id IS NULL`)
      .bind(runId,canvasIncidentExplanation(context,'model_pending'),JSON.stringify(policy),now,explanation.turn_id),
    env.DB.prepare("SELECT CASE WHEN changes()=1 THEN 1 ELSE json_extract('[]','$[') END"),
  ];
  try{await env.DB.batch(statements);}catch(error){
    // Concurrent user turns/allowance edits simply win. No provider was called.
    if(await rowFor(env,incident.id,incident.revision).then(row=>row?.model_run_id))return;
    const current=await conversationRow(env,incident.project_id,incident.user_id);
    if(current?.revision!==conversation.revision||await env.DB.prepare("SELECT id FROM canvas_agent_runs WHERE project_id=? AND purpose='briefing' AND status IN ('queued','planning','running','exporting')").bind(incident.project_id).first())return;
    throw error;
  }
  await wakeCanvasAgent(env,runId);
}
export async function processCanvasIncidentExplanation(env,run,user,{receiptOnly=false}={}) {
  const explanation=await env.DB.prepare(`SELECT x.*,i.project_id,i.user_id,i.source_json,i.context_json,i.revision AS current_revision,i.state AS incident_state
    FROM canvas_agent_incident_explanations x JOIN canvas_agent_incidents i ON i.id=x.incident_id WHERE x.model_run_id=?`).bind(run.id).first();
  if(!explanation)return false;
  const turn=await env.DB.prepare('SELECT state FROM canvas_agent_turns WHERE id=?').bind(explanation.turn_id).first();
  const conversation=await env.DB.prepare('SELECT state,diagnostic_allowance FROM canvas_agent_conversations WHERE project_id=? AND user_id=?').bind(run.project_id,run.user_id).first();
  const step=await env.DB.prepare("SELECT * FROM canvas_agent_steps WHERE run_id=? AND step_key='dialogue'").bind(run.id).first();
  if(!step)return true;
  const acceptedState=parse(step.input_json)?.payload?.currentProject?.incident?.state;
  const current=await canvasIncidentContext(env,run.user_id,run.project_id,parse(explanation.source_json));
  if(!turn||turn.state==='deleted'||conversation?.state==='cancelled')return true;
  if(explanation.revision!==explanation.current_revision||current.state!==explanation.incident_state||acceptedState!==current.state){
    // Preserve the already delivered historical message. The current incident
    // revision owns its one recovery update; a late model reply cannot duplicate it.
    await env.DB.prepare("UPDATE canvas_agent_incident_explanations SET state='stale',fallback_reason='latest_evidence',updated_at=? WHERE incident_id=? AND revision=? AND state!='model'")
      .bind(nowIso(),explanation.incident_id,explanation.revision).run();
    if(!step.usage_attempt_id||['completed','rejected'].includes(step.status)){
      await env.DB.prepare("UPDATE canvas_agent_runs SET status='completed',phase='explanation',error_code=NULL,updated_at=? WHERE id=? AND status NOT IN ('cancelled','taken_over','paused')").bind(nowIso(),run.id).run();
      await env.DB.prepare("UPDATE canvas_agent_turns SET state='completed',updated_at=? WHERE id=? AND state IN ('pending','review_required','failed')").bind(nowIso(),explanation.turn_id).run();
    }
    return true;
  }
  if(!receiptOnly&&step.status!=='completed'){
    if(conversation.state!=='active'||conversation.diagnostic_allowance!==1)fail('canvas_agent_diagnostic_consent_required');
    await agentTransition(env,run,{status:'planning',phase:'explanation'});
  }
  if(receiptOnly&&step.status!=='completed')return true;
  const receipt=step.status==='completed'?parse(step.receipt_json):await (await import('./canvas-agent-planning.js')).executeCanvasAgentModel(env,run,step,user);
  if(!receipt)return true;
  const input=parse(step.input_json),reply=validateCanvasAgentDialogueReply(receipt.dialogue||receipt.data?.dialogue,
    {messageId:explanation.turn_id,dialogueVersion:input.payload.version,projectRevision:input.payload.projectRevision});
  if(reply.intent!=='status'||reply.scope!=='canvas'||reply.updates.length||reply.actions?.length||reply.questions.length)fail('canvas_agent_explanation_invalid');
  // Refresh immediately before publication. A late reply cannot announce an
  // already resolved blockage or restore a deleted conversation.
  const latest=await canvasIncidentContext(env,run.user_id,run.project_id,parse(explanation.source_json));
  if(latest.state!==current.state){
    await env.DB.prepare("UPDATE canvas_agent_incident_explanations SET state='stale',fallback_reason='latest_evidence',updated_at=? WHERE incident_id=? AND revision=?").bind(nowIso(),explanation.incident_id,explanation.revision).run();
    await env.DB.prepare("UPDATE canvas_agent_runs SET status='completed',phase='explanation',updated_at=? WHERE id=? AND status NOT IN ('cancelled','taken_over','paused')").bind(nowIso(),run.id).run();
    return true;
  }
  const now=nowIso();
  await env.DB.batch([
    env.DB.prepare(`UPDATE canvas_agent_turns SET assistant_text=?,state='completed',error_code=NULL,updated_at=?
      WHERE id=? AND state!='deleted' AND EXISTS(SELECT 1 FROM canvas_agent_incidents i JOIN canvas_projects p ON p.id=i.project_id
      JOIN canvas_agent_conversations c ON c.project_id=p.id JOIN users u ON u.id=p.user_id
      WHERE i.id=? AND i.revision=? AND i.state=? AND p.deleted_at IS NULL AND c.state!='cancelled' AND u.status='active')`)
      .bind(reply.text,now,explanation.turn_id,explanation.incident_id,explanation.revision,current.state),
    env.DB.prepare(`UPDATE canvas_agent_incident_explanations SET state='model',fallback_reason='',updated_at=? WHERE incident_id=? AND revision=? AND changes()=1`)
      .bind(now,explanation.incident_id,explanation.revision),
    env.DB.prepare(`UPDATE canvas_agent_runs SET status='completed',error_code=NULL,cause_json=NULL,updated_at=? WHERE id=?
      AND status NOT IN ('cancelled','taken_over','paused') AND EXISTS(SELECT 1 FROM canvas_agent_incident_explanations x WHERE x.model_run_id=canvas_agent_runs.id AND x.state='model')`).bind(now,run.id),
  ]);
  return true;
}
export async function reconcileCanvasIncidentExplanations(env,{projectId=null,userId=null}={}) {
  const args=[],conditions=[];
  if(projectId){conditions.push('i.project_id=?');args.push(projectId);}
  if(userId){conditions.push('i.user_id=?');args.push(userId);}
  const pending=(await env.DB.prepare(`SELECT x.*,i.source_json,i.project_id,i.user_id,r.status AS run_status,s.status AS step_status
    FROM canvas_agent_incident_explanations x JOIN canvas_agent_incidents i ON i.id=x.incident_id
    JOIN canvas_projects p ON p.id=i.project_id AND p.user_id=i.user_id JOIN users u ON u.id=i.user_id
    JOIN canvas_agent_runs r ON r.id=x.model_run_id JOIN canvas_agent_steps s ON s.run_id=r.id AND s.step_key='dialogue'
    WHERE p.deleted_at IS NULL AND u.status='active' AND x.state IN ('pending','unknown','failed','stale')${conditions.length?' AND '+conditions.join(' AND '):''}
    ORDER BY x.updated_at LIMIT 20`).bind(...args).all()).results;
  for(const item of pending){
    if(item.step_status==='completed'){
      const run=await env.DB.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(item.model_run_id).first();
      await processCanvasIncidentExplanation(env,run,{id:run.user_id},{receiptOnly:true});
    }else if(['blocked','review_required','cancelled','taken_over'].includes(item.run_status)||item.step_status==='rejected'){
      const context=await canvasIncidentContext(env,item.user_id,item.project_id,parse(item.source_json));
      const operation=await env.DB.prepare('SELECT state FROM canvas_agent_model_operations WHERE run_id=?').bind(item.model_run_id).first();
      await fallback(env,item,context,operation?.state==='unknown'?'model_outcome_unknown':'model_failed',operation?.state==='unknown'?'unknown':'failed');
    }
  }
}
