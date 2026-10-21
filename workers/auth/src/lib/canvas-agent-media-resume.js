import { canvasStoredMediaProof } from './canvas-agent-media-completion.js';
import { detectCanvasDirectControl } from '../../../../js/shared/canvas-agent-control-intent.mjs';
import { stablePricingJson } from '../../../../js/shared/model-tariff.mjs';
import { nowIso,sha256Hex } from './tokens.js';
import { readCanvasAgentBudget } from './canvas-agent-budget.js';
import { canvasAssistantAvailability } from './canvas-agent-assistant-models.js';
import { assertCanvasPlanReviewCurrent } from './canvas-agent-plan-correction-review.js';
import { canvasAgentProject } from '../routes/canvas-agent.js';
import { canvasAgentCapabilities } from './canvas-agent-capabilities.js';
import { canvasAgentDependencyKind } from './canvas-agent-price-input.js';
import { preflightCanvasAgentGraph } from './canvas-agent-graph.js';
const fail=code=>{throw Object.assign(new Error(code),{code,status:409});};
// Older observers could inspect the node during the producer's final writes.
// These codes are candidates for inspection, never permission to resume: all
// current storage, settlement, attachment and authority proofs below must pass.
const recoverableCodes=['canvas_agent_local_execution_failed','canvas_agent_media_recovery_evidence_invalid'];
const eligible=run=>run?.purpose==='production'&&run.plan_json&&run.phase==='generating'
  &&['blocked','review_required'].includes(run.status)&&recoverableCodes.includes(run.error_code);

export async function inspectCanvasMediaResume(env,run,{storage=false,expectedProjectRevision=null}={}) {
  if(!eligible(run))return {eligible:false,code:'canvas_agent_media_recovery_state_changed'};
  const now=nowIso();
  const current=await env.DB.prepare(`SELECT p.revision,p.deleted_at,u.status,c.brief_revision,c.brief_json,c.state,
    (SELECT revision FROM model_pricing_state WHERE id=1) AS tariff_revision,
    EXISTS(SELECT 1 FROM canvas_agent_runs x WHERE x.project_id=p.id AND x.purpose='production' AND x.created_at>?) AS newer_run
    FROM canvas_projects p JOIN users u ON u.id=p.user_id LEFT JOIN canvas_agent_conversations c ON c.project_id=p.id
    WHERE p.id=? AND p.user_id=?`).bind(run.created_at,run.project_id,run.user_id).first();
  if(!current||current.deleted_at||current.status!=='active'||current.state==='cancelled'||current.newer_run)
    return {eligible:false,code:'canvas_agent_authority_revoked'};
  if(run.expires_at<=now)return {eligible:false,code:'canvas_agent_authorization_expired'};
  const rebase=current.revision!==run.expected_revision;
  if(rebase&&expectedProjectRevision!==current.revision)return {eligible:false,code:'canvas_agent_project_changed'};
  if(current.tariff_revision!==run.tariff_revision)return {eligible:false,code:'model_pricing_stale'};
  if(run.lease_until>now)return {eligible:false,code:'canvas_agent_claim_lost'};
  try{
    const reviewed=await assertCanvasPlanReviewCurrent(env,run);
    const briefContinuation=run.brief_revision!==null&&current.brief_revision!==(reviewed?.effectiveBriefRevision??run.brief_revision)
      ?await canvasOperationalBriefContinuation(env,run,current):null;
    const failedStep=JSON.parse(run.cause_json||'{}').execution?.stepId||null;
    const steps=(await env.DB.prepare("SELECT * FROM canvas_agent_steps WHERE run_id=? AND kind='node' AND (status='accepted' OR (id=? AND status='completed'))").bind(run.id,failedStep).all()).results;
    if(!steps.length)return {eligible:false,code:'canvas_agent_media_recovery_pending'};
    const proofs=[];
    for(const step of steps)proofs.push({step,...await canvasStoredMediaProof(env,run,step,{storage})});
    const budget=await readCanvasAgentBudget(env,run);
    if(budget.committedCredits>run.budget_credits)return {eligible:false,code:'canvas_agent_budget_exceeded'};
    if(rebase)await validateCurrentUnstartedMedia(env,run,current);
    return {eligible:true,current,proofs,rebase,briefContinuation};
  }catch(error){
    if(error.status===409&&error.code)return {eligible:false,code:error.code};
    throw error;
  }
}

// The ordinary Resume action and cron share these proofs and the same atomic
// transition. No billing mutation, inference, new step or receipt rewrite.
export async function resumeCanvasMedia(env,run,{requestKey=null,expectedProjectRevision=null}={}) {
  if(expectedProjectRevision!==null&&!requestKey)fail('canvas_agent_project_changed');
  const inspected=await inspectCanvasMediaResume(env,run,{storage:true,expectedProjectRevision});
  if(!inspected.eligible)fail(inspected.code);
  const available=await canvasAssistantAvailability(env,run.model_id,{providerReadiness:false});
  if(!available.available)fail(available.code);
  const now=nowIso(),key=requestKey||`stored-media:${inspected.proofs.map(p=>p.step.id).join(':')}`;
  const prior=await env.DB.prepare('SELECT action FROM canvas_agent_controls WHERE run_id=? AND request_key=?').bind(run.id,key).first();
  if(prior){if(prior.action!=='resume')fail('idempotency_conflict');return {idempotentReplay:true};}
  await env.DB.batch([
    env.DB.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM canvas_agent_runs r JOIN canvas_projects p ON p.id=r.project_id
      JOIN users u ON u.id=r.user_id LEFT JOIN canvas_agent_conversations c ON c.project_id=p.id
      WHERE r.id=? AND r.user_id=? AND r.status=? AND r.error_code=? AND r.updated_at=? AND r.cause_json IS ?
      AND r.expires_at>? AND (r.lease_until IS NULL OR r.lease_until<=?) AND p.deleted_at IS NULL AND p.revision=? AND r.expected_revision=?
      AND u.status='active' AND c.brief_revision IS ? AND c.brief_json IS ? AND c.state IS ? AND r.budget_credits=? AND r.budget_revision=?
      AND r.tariff_revision=(SELECT revision FROM model_pricing_state WHERE id=1)
      AND NOT EXISTS(SELECT 1 FROM canvas_agent_runs newer WHERE newer.project_id=r.project_id AND newer.purpose='production' AND newer.created_at>r.created_at)
      AND NOT EXISTS(SELECT 1 FROM canvas_agent_controls x WHERE x.run_id=r.id AND x.action IN ('pause','cancel','takeover') AND x.created_at>=r.updated_at))
      THEN 1 ELSE json_extract('[]','$[') END`)
      .bind(run.id,run.user_id,run.status,run.error_code,run.updated_at,run.cause_json,now,now,inspected.current.revision,run.expected_revision,inspected.current.brief_revision,inspected.current.brief_json,inspected.current.state,run.budget_credits,run.budget_revision||0),
    ...inspected.proofs.map(p=>env.DB.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM canvas_agent_steps s
      JOIN canvas_runs c ON c.id=? JOIN member_generation_jobs j ON j.id=? JOIN canvas_nodes n ON n.id=s.node_id
      JOIN member_ai_usage_attempts_v2 a ON a.id=j.usage_attempt_id
      WHERE s.id=? AND s.run_id=? AND s.status=? AND s.receipt_json IS ?
      AND c.status='completed' AND c.deleted_at IS NULL AND c.asset_id=? AND c.usage_attempt_id=?
      AND j.status IN ('succeeded','preview_pending') AND j.provider_receipts_json=? AND j.result_r2_key=?
      AND a.billing_status='finalized' AND a.provider_outcome='succeeded'
      AND n.deleted_at IS NULL AND n.creative_revision=c.node_revision AND n.asset_id=c.asset_id)
      THEN 1 ELSE json_extract('[]','$[') END`).bind(p.id,p.job_id,p.step.id,run.id,p.step.status,p.step.receipt_json,p.asset_id,p.job_usage,p.provider_receipts_json,p.result_r2_key)),
    env.DB.prepare("INSERT INTO canvas_agent_controls(run_id,request_key,action,created_at) VALUES(?,?,'resume',?)").bind(run.id,key,now),
    env.DB.prepare("UPDATE canvas_agent_runs SET status='running',error_code=NULL,cause_json=?,expected_revision=?,lease_token=NULL,lease_until=NULL,next_attempt_at=?,updated_at=? WHERE id=?")
      .bind(JSON.stringify({code:'canvas_agent_media_reconciling',recovery:'receipt',priorError:run.error_code,
        execution:JSON.parse(run.cause_json||'{}').execution||null,steps:inspected.proofs.map(p=>({stepId:p.step.id,canvasRunId:p.id,assetId:p.asset_id,receiptDigest:p.receiptDigest}))}),inspected.current.revision,now,now,run.id),
    env.DB.prepare("INSERT INTO canvas_agent_events(run_id,event_key,type,payload_json,created_at) VALUES(?,?,'action',?,?)")
      .bind(run.id,`control:${key}`,JSON.stringify({code:'media_reconciling',phase:'generating',tool:'production.resume',stepIds:inspected.proofs.map(p=>p.step.id),
        briefContinuation:inspected.briefContinuation,requestedProjectRevision:expectedProjectRevision,priorProjectRevision:run.expected_revision,approvedProjectRevision:inspected.current.revision}),now),
  ]);
  return {resumed:true};
}

// Old dialogue could record an unambiguous Resume command as latestInstruction.
// Prove that precise source and unchanged creative fields; do not rewrite the
// original brief identity or accept arbitrary model-authored budget/role text.
export async function canvasOperationalBriefContinuation(env,run,current){
  const brief=JSON.parse(current.brief_json),entry=brief.fields?.latestInstruction;
  const turn=await env.DB.prepare(`SELECT t.id,t.user_text,t.state,s.input_json,s.receipt_json FROM canvas_agent_turns t
    JOIN canvas_agent_runs r ON r.id=t.run_id AND r.user_id=? AND r.purpose='briefing'
    JOIN canvas_agent_steps s ON s.run_id=r.id AND s.step_key='dialogue' AND s.status='completed'
    WHERE t.id=? AND t.project_id=? AND t.created_at>=?`)
    .bind(run.user_id,entry?.sourceMessageId||'',run.project_id,run.created_at).first();
  if(!turn||turn.state!=='completed'||detectCanvasDirectControl(turn.user_text)!=='production_resume')fail('canvas_agent_brief_changed');
  const payload=JSON.parse(turn.input_json).payload,receipt=JSON.parse(turn.receipt_json),old=payload.brief;
  if(receipt.ok!==true||payload.message?.id!==turn.id||payload.message?.text!==turn.user_text
    ||!['user_stated','corrected'].includes(entry.provenance)||payload.briefRevision!==run.brief_revision||old?.revision!==run.brief_revision
    ||brief.revision!==run.brief_revision+1||current.brief_revision!==brief.revision||entry.revision!==brief.revision)fail('canvas_agent_brief_changed');
  const expected={...old,revision:brief.revision,fields:{...old.fields,latestInstruction:entry}};
  if(stablePricingJson(expected)!==stablePricingJson(brief))fail('canvas_agent_brief_changed');
  return {sourceTurnId:turn.id,originalBriefRevision:run.brief_revision,effectiveBriefRevision:brief.revision,
    effectiveBriefDigest:await sha256Hex(current.brief_json),classification:'operational_resume_only'};
}

// Explicit revision adoption never reapplies the old graph. Only existing,
// genuinely unstarted nodes may change, and their current requests must still
// fit each original allocation. Accepted inputs and dependency topology remain.
async function validateCurrentUnstartedMedia(env,run,current){
  const view=await canvasAgentProject(env,run.user_id,run.project_id);
  if(view.project.revision!==current.revision)fail('canvas_agent_project_changed');
  const steps=(await env.DB.prepare("SELECT * FROM canvas_agent_steps WHERE run_id=? AND kind='node'").bind(run.id).all()).results;
  const updates=[];
  for(const step of steps){
    const node=view.nodes.find(n=>n.id===step.node_id),input=JSON.parse(step.input_json);
    if(!node||node.model_id!==input.modelId)fail('canvas_agent_project_changed');
    const incoming=view.edges.filter(e=>e.target_node_id===node.id&&JSON.parse(e.config_json||'{}').purpose!=='export_background_music');
    if(incoming.length!==input.dependencies.length||input.dependencies.some(dep=>!incoming.some(e=>e.source_node_id===dep.nodeId)))fail('canvas_agent_project_changed');
    const config=JSON.parse(node.config_json),content=JSON.parse(node.content_json||'{}');
    for(const dep of input.dependencies){
      const edge=incoming.find(e=>e.source_node_id===dep.nodeId),edgeConfig=JSON.parse(edge.config_json||'{}');
      const kind=canvasAgentDependencyKind(view.nodes.find(n=>n.id===dep.nodeId),view.nodes);
      const role=config.h3Roles?.[edge.id]||config.omniRoles?.[edge.id]||config.seedance25Roles?.[edge.id]
        ||({image:'reference_image',video:'reference_video',music:'reference_audio',audio:'reference_audio'}[kind]||'prompt');
      if(role!==dep.role||(edgeConfig.videoInput?.method??null)!==(dep.method??null))fail('canvas_agent_project_changed');
    }
    if(step.status!=='ready'){await canvasStoredMediaProof(env,run,step,{storage:true});continue;}
    const dispatched=await env.DB.prepare('SELECT 1 FROM canvas_runs WHERE user_id=? AND idempotency_key=?').bind(run.user_id,`canvas-agent-${step.id}`).first();
    if(dispatched||step.usage_attempt_id||step.receipt_json)fail('canvas_agent_media_recovery_pending');
    // Empty delta: preflight reads the entire current saved configuration,
    // including native reference-role maps that are not LLM update fields.
    updates.push({nodeId:node.id,prompt:config.prompt??content.prompt??'',config:{}});
  }
  const original=JSON.parse(run.plan_json),assembly=JSON.parse(view.project.assembly_json);
  const plan={version:1,title:original.title,continuity:original.continuity,nodes:[],updates,
    assembly:{clips:assembly.clips.map(c=>({...c,key:`existing:${c.nodeId}`})).map(({nodeId,...c})=>c),
      musicKey:assembly.musicNodeId?`existing:${assembly.musicNodeId}`:null,targetDurationSeconds:run.target_seconds,
      toleranceSeconds:run.tolerance_seconds,smoothJoins:assembly.smoothJoins}};
  const checked=await preflightCanvasAgentGraph(env,run,view,await canvasAgentCapabilities(env),plan,updates.map(n=>n.nodeId));
  if(!checked.ok)fail(checked.issues?.[0]?.code||'canvas_agent_project_changed');
  if(checked.costs.nodes.some(n=>n.credits>steps.find(s=>s.node_id===n.nodeId)?.allocation_credits))fail('canvas_agent_budget_exceeded');
  const remaining=steps.filter(s=>s.status==='ready').reduce((sum,s)=>sum+s.allocation_credits,0);
  if(remaining>checked.budget.remainingCredits)fail('canvas_agent_budget_exceeded');
}

export async function recoverCanvasStoredMedia(env) {
  const rows=(await env.DB.prepare(`SELECT * FROM canvas_agent_runs WHERE purpose='production' AND phase='generating'
    AND status IN ('blocked','review_required') AND error_code IN (?,?)
    AND expires_at>? AND (lease_until IS NULL OR lease_until<=?) ORDER BY updated_at LIMIT 10`).bind(...recoverableCodes,nowIso(),nowIso()).all()).results;
  for(const run of rows){
    const proof=await inspectCanvasMediaResume(env,run);if(!proof.eligible)continue;
    try{await resumeCanvasMedia(env,run);}catch(error){
      // Expected proof/authority races leave the original incident intact.
      // Unexpected infrastructure failures propagate to the existing cron.
      if(error.status!==409)throw error;
    }
  }
}
