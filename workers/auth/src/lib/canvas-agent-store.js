import { nowIso,randomTokenHex } from './tokens.js';
import { markMemberAiUsageAttemptProviderFailed } from './member-ai-usage-attempts.js';
import { readCanvasAgentBudget,publicCanvasBudgetRequest } from './canvas-agent-budget.js';
import { publicCanvasAgentProposal,publicCanvasAgentOutputs } from './canvas-agent-progress.js';
export const CANVAS_AGENT_MESSAGE='canvas_agent.process';
export const ACTIVE_AGENT_STATES=['queued','planning','running','exporting'];
export const agentFail=(code,status=409)=>{throw Object.assign(new Error(code),{code,status});};
export const readAgentRun=(env,id)=>env.DB.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(id).first();
export async function publicAgentRun(env,row) {
    if(!row)return null;
    const steps=(await env.DB.prepare('SELECT id,kind,status,allocation_credits,usage_attempt_id FROM canvas_agent_steps WHERE run_id=? ORDER BY rowid').bind(row.id).all()).results;
    const modelOperation=await publicCanvasAgentModelOperation(env,row.id);
    const project=await env.DB.prepare('SELECT revision FROM canvas_projects WHERE id=?').bind(row.project_id).first();
    const budget=row.budget_credits===null?null:await readCanvasAgentBudget(env,row);
    const budgetRequest=await env.DB.prepare("SELECT * FROM canvas_agent_budget_requests WHERE run_id=? AND status='pending' ORDER BY created_at DESC LIMIT 1").bind(row.id).first();
    const actionableBudget=budgetRequest&&row.status==='paused'&&row.phase==='budget'&&row.expires_at>nowIso()
        &&budgetRequest?.project_revision===project?.revision&&budgetRequest.project_revision===row.expected_revision
        &&budgetRequest.revision===(row.budget_revision||0)&&budgetRequest.current_cap===row.budget_credits;
    let cause=row.cause_json?JSON.parse(row.cause_json):row.error_code?{code:row.error_code,step:row.phase,recovery:'manual'}:null;
    if(row.status==='paused'&&row.phase==='budget'&&!actionableBudget)cause={code:row.expires_at<=nowIso()?'canvas_agent_authorization_expired':project?.revision!==row.expected_revision?'canvas_agent_project_changed':'canvas_agent_budget_request_changed',step:'budget',recovery:'manual'};
    const proposedPlan=await publicCanvasAgentProposal(env,row),partialOutputs=await publicCanvasAgentOutputs(env,row);
    const held=['cancelled','taken_over'].includes(row.status)||row.status==='paused'&&row.phase!=='budget';
    const event=await env.DB.prepare(`SELECT type,payload_json FROM canvas_agent_events WHERE run_id=? AND type IN ('action','decision_summary','error')
        AND (?=0 OR json_extract(payload_json,'$.code')=?) ORDER BY id DESC LIMIT 1`).bind(row.id,held?1:0,row.status).first();
    const input=JSON.parse(row.input_json);
    return {id:row.id,projectId:row.project_id,requestKey:row.request_key,brief:input.brief,status:row.status,phase:row.phase,
        completed:steps.filter(s=>s.kind==='node'&&s.status==='completed').length,total:steps.filter(s=>s.kind==='node').length,
        targetDurationSeconds:row.target_seconds,toleranceSeconds:row.tolerance_seconds,budgetCredits:row.budget_credits,
        allocatedCredits:steps.reduce((sum,s)=>sum+s.allocation_credits,0),projectRevision:row.expected_revision,
        chargedCredits:budget?.chargedCredits||0,reservedCredits:budget?.reservedCredits||0,pendingOutcomeCredits:budget?.pendingOutcomeCredits||0,
        committedCredits:budget?.committedCredits||0,remainingCredits:budget?.remainingCredits||0,budgetRevision:row.budget_revision||0,
        budgetRequest:actionableBudget?publicCanvasBudgetRequest(budgetRequest):null,proposedPlan,partialOutputs,
        currentAction:!held&&modelOperation?.recovery==='settlement_review'?{code:'settlement_review',phase:'settlement_review',model:'xai/grok-4.7',tool:'billing.review'}:
            event?JSON.parse(event.payload_json):{phase:held?row.status==='taken_over'?'manual_takeover':row.status:row.phase,model:!held&&modelOperation?'xai/grok-4.7':null},
        cause,
        summarySupport:{status:'unavailable',mode:'completed'},
        modelOperation,allowedActions:canvasAgentAllowedActions({...row,current_revision:project?.revision},modelOperation),
        errorCode:row.error_code,result:row.result_json?JSON.parse(row.result_json):null,
        ...(row.status==='clarification_required'?{clarification:{field:'duration',code:'duration_required'}}:{}),
        createdAt:row.created_at,updatedAt:row.updated_at};
}
export async function publicCanvasAgentModelOperation(env,runId) {
    const op=await env.DB.prepare(`SELECT s.id,s.kind,s.status,a.provider_outcome,a.billing_status,o.id AS operation_id,o.state,o.error_code,o.dispatched_at,o.response_at,o.receipt_json,o.reconcile_attempts
        FROM canvas_agent_steps s LEFT JOIN canvas_agent_model_operations o ON o.step_id=s.id
        LEFT JOIN member_ai_usage_attempts_v2 a ON a.id=s.usage_attempt_id
        WHERE s.run_id=? AND s.kind IN ('plan','evaluate') AND s.usage_attempt_id IS NOT NULL ORDER BY s.rowid DESC LIMIT 1`).bind(runId).first();
    if(!op)return null;
    const receipt=op.receipt_json?JSON.parse(op.receipt_json):null,failed=receipt?.outcome==='failed';
    const settled=op.state==='completed'&&op.status==='completed'&&op.billing_status==='finalized';
    const settlementReview=op.state==='completed'&&receipt?.ok===true&&op.status!=='completed'&&op.billing_status==='reserved'
        &&['generation_result_requires_credit_review','canvas_agent_billing_review_required'].includes(op.error_code);
    const outcome=failed?'failed':op.state==='completed'?'completed':op.state==='rejected'?'rejected':op.state==='unknown'?'unknown':op.state?'pending':
        ['dispatched','unknown'].includes(op.provider_outcome)?'unknown':op.provider_outcome==='succeeded'?'completed':op.provider_outcome==='failed'?'rejected':'not_dispatched';
    return {operationId:op.operation_id||op.id,kind:op.kind,outcome,
        recovery:settled?null:settlementReview?'settlement_review':failed?'billing_review':op.reconcile_attempts>=5?'review_required':op.state==='received'||(op.state==='completed'&&op.status!=='completed')?'receipt_ready':outcome==='unknown'?'review_required':outcome==='pending'?'waiting_callback':null,
        ...(op.dispatched_at?{dispatchedAt:op.dispatched_at}:{}),...(op.response_at?{responseAt:op.response_at}:{})};
}
export function canvasAgentAllowedActions(run,operation) {
    if(['completed','cancelled','taken_over','clarification_required'].includes(run.status))return [];
    const actions=['cancel','takeover'];
    if(ACTIVE_AGENT_STATES.includes(run.status))actions.unshift('pause');
    if(run.status==='paused'&&run.phase!=='budget'&&(run.current_revision===undefined||run.current_revision===run.expected_revision)
        &&!['pending','unknown','failed'].includes(operation?.outcome)&&!['review_required','billing_review','settlement_review'].includes(operation?.recovery))actions.unshift('resume');
    return actions;
}
export async function wakeCanvasAgent(env,id,delaySeconds=0) {
    try {await env.AI_VIDEO_JOBS_QUEUE.send({type:CANVAS_AGENT_MESSAGE,run_id:id},{delaySeconds});}
    catch { /* Persisted next_attempt_at is the scheduled recovery outbox. */ }
}
export async function requeueCanvasAgents(env) {
    const {reconcileCanvasAgentModelOperations}=await import('./canvas-agent-model-operations.js');
    await reconcileCanvasAgentModelOperations(env);
    const {observeCanvasConversationReceipts}=await import('./canvas-agent-conversation.js');
    const recoverable=(await env.DB.prepare(`SELECT DISTINCT r.project_id,r.user_id FROM canvas_agent_runs r
        JOIN canvas_agent_turns t ON t.run_id=r.id JOIN canvas_agent_steps s ON s.run_id=r.id AND s.step_key='dialogue'
        JOIN canvas_projects p ON p.id=r.project_id JOIN users u ON u.id=r.user_id
        WHERE r.purpose='briefing' AND p.deleted_at IS NULL AND u.status='active'
        AND s.status IN ('completed','rejected') AND t.state IN ('pending','review_required','failed')
        AND r.next_attempt_at<=? ORDER BY r.updated_at LIMIT 20`).bind(nowIso()).all()).results;
    for(const row of recoverable)await observeCanvasConversationReceipts(env,row.project_id,row.user_id);
    await (await import('./canvas-agent-immediate.js')).recoverCanvasImmediateIntents(env);
    await (await import('./canvas-agent-actions.js')).recoverCanvasAgentActions(env);
    const now=nowIso();
    await env.DB.prepare(`UPDATE canvas_agent_runs SET status='blocked',error_code='canvas_agent_authorization_expired',lease_token=NULL,lease_until=NULL,updated_at=?
        WHERE status IN ('queued','planning','running','exporting') AND expires_at<=?`).bind(now,now).run();
    const rows=await env.DB.prepare(`SELECT id FROM canvas_agent_runs WHERE status IN ('queued','planning','running','exporting')
        AND next_attempt_at<=? AND (lease_until IS NULL OR lease_until<=?) ORDER BY next_attempt_at LIMIT 20`).bind(now,now).all();
    for(const row of rows.results)await wakeCanvasAgent(env,row.id);
    const stopped=(await env.DB.prepare(`SELECT DISTINCT r.id FROM canvas_agent_runs r JOIN canvas_agent_steps s ON s.run_id=r.id
        JOIN member_ai_usage_attempts_v2 a ON a.id=s.usage_attempt_id
        WHERE r.status IN ('cancelled','taken_over','blocked','review_required') AND a.provider_outcome='not_dispatched' AND a.billing_status='reserved' LIMIT 20`).all()).results;
    for(const row of stopped)await releaseCanvasAgentUndispatched(env,row.id);
}
export async function releaseCanvasAgentUndispatched(env,id) {
    const rows=(await env.DB.prepare(`SELECT a.id FROM member_ai_usage_attempts_v2 a JOIN canvas_agent_steps s ON s.usage_attempt_id=a.id
        JOIN canvas_agent_runs r ON r.id=s.run_id WHERE r.id=? AND r.status IN ('cancelled','taken_over','blocked','review_required')
        AND a.provider_outcome='not_dispatched' AND a.billing_status='reserved'`).bind(id).all()).results;
    // Existing dispatch fencing makes this safe against a concurrent claimant.
    // Accepted/unknown requests are never treated as refundable reservations.
    for(const row of rows)await markMemberAiUsageAttemptProviderFailed(env,row.id,{definitelyNotDispatched:true,code:'canvas_agent_stopped_before_dispatch'});
}
export async function claimCanvasAgent(env,id) {
    const token=randomTokenHex(16),now=nowIso();
    const result=await env.DB.prepare(`UPDATE canvas_agent_runs SET lease_token=?,lease_until=?,updated_at=?
        WHERE id=? AND status IN ('queued','planning','running','exporting') AND next_attempt_at<=?
        AND (lease_until IS NULL OR lease_until<=?)`).bind(token,new Date(Date.now()+15*60000).toISOString(),now,id,now,now).run();
    return result.meta?.changes===1?readAgentRun(env,id):null;
}
export async function agentTransition(env,run,changes) {
    const allowed=['status','phase','error_code','plan_json','result_json','expected_revision','next_attempt_at','cause_json','target_seconds'];
    if(Object.keys(changes).some(k=>!allowed.includes(k)))throw new TypeError('Invalid state transition');
    const entries=Object.entries(changes);
    const result=await env.DB.prepare(`UPDATE canvas_agent_runs SET ${entries.map(([key])=>`${key}=?`).join(',')},updated_at=? WHERE id=? AND lease_token=?`)
        .bind(...entries.map(([,value])=>value),nowIso(),run.id,run.lease_token).run();
    if(result.meta?.changes!==1)agentFail('canvas_agent_claim_lost');
    Object.assign(run,changes);
}
