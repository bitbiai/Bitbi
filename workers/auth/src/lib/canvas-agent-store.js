import { nowIso,randomTokenHex } from './tokens.js';
import { markMemberAiUsageAttemptProviderFailed } from './member-ai-usage-attempts.js';
export const CANVAS_AGENT_MESSAGE='canvas_agent.process';
export const ACTIVE_AGENT_STATES=['queued','planning','running','exporting'];
export const agentFail=(code,status=409)=>{throw Object.assign(new Error(code),{code,status});};
export const readAgentRun=(env,id)=>env.DB.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(id).first();
export async function publicAgentRun(env,row) {
    if(!row)return null;
    const steps=(await env.DB.prepare('SELECT id,kind,status,allocation_credits,usage_attempt_id FROM canvas_agent_steps WHERE run_id=? ORDER BY rowid').bind(row.id).all()).results;
    const modelOperation=await publicCanvasAgentModelOperation(env,row.id);
    const project=await env.DB.prepare('SELECT revision FROM canvas_projects WHERE id=?').bind(row.project_id).first();
    const costs=await env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN l.amount<0 THEN -l.amount ELSE 0 END),0) AS charged,
        COALESCE(SUM(CASE WHEN a.billing_status='reserved' AND a.reservation_released_at IS NULL THEN a.credit_cost ELSE 0 END),0) AS reserved,
        COALESCE(SUM(CASE WHEN a.provider_outcome IN ('dispatched','unknown') THEN a.credit_cost ELSE 0 END),0) AS pending
        FROM canvas_agent_steps s LEFT JOIN member_ai_usage_attempts_v2 a ON a.id=s.usage_attempt_id
        LEFT JOIN member_credit_ledger l ON l.user_id=a.user_id AND l.idempotency_key=a.idempotency_key WHERE s.run_id=?`).bind(row.id).first();
    const input=JSON.parse(row.input_json);
    return {id:row.id,projectId:row.project_id,requestKey:row.request_key,brief:input.brief,status:row.status,phase:row.phase,
        completed:steps.filter(s=>s.kind==='node'&&s.status==='completed').length,total:steps.filter(s=>s.kind==='node').length,
        targetDurationSeconds:row.target_seconds,toleranceSeconds:row.tolerance_seconds,budgetCredits:row.budget_credits,
        allocatedCredits:steps.reduce((sum,s)=>sum+s.allocation_credits,0),projectRevision:row.expected_revision,
        chargedCredits:costs.charged,reservedCredits:costs.reserved,pendingOutcomeCredits:costs.pending,
        modelOperation,allowedActions:canvasAgentAllowedActions({...row,current_revision:project?.revision},modelOperation),
        errorCode:row.error_code,result:row.result_json?JSON.parse(row.result_json):null,
        ...(row.status==='clarification_required'?{clarification:{field:'duration',code:'duration_required'}}:{}),
        createdAt:row.created_at,updatedAt:row.updated_at};
}
export async function publicCanvasAgentModelOperation(env,runId) {
    const op=await env.DB.prepare(`SELECT s.id,s.kind,s.status,a.provider_outcome,o.id AS operation_id,o.state,o.error_code,o.dispatched_at,o.response_at,o.receipt_json,o.reconcile_attempts
        FROM canvas_agent_steps s LEFT JOIN canvas_agent_model_operations o ON o.step_id=s.id
        LEFT JOIN member_ai_usage_attempts_v2 a ON a.id=s.usage_attempt_id
        WHERE s.run_id=? AND s.kind IN ('plan','evaluate') AND s.usage_attempt_id IS NOT NULL ORDER BY s.rowid DESC LIMIT 1`).bind(runId).first();
    if(!op)return null;
    const failed=op.receipt_json&&JSON.parse(op.receipt_json).outcome==='failed';
    const outcome=failed?'failed':op.state==='completed'?'completed':op.state==='rejected'?'rejected':op.state==='unknown'?'unknown':op.state?'pending':
        ['dispatched','unknown'].includes(op.provider_outcome)?'unknown':op.provider_outcome==='succeeded'?'completed':op.provider_outcome==='failed'?'rejected':'not_dispatched';
    return {operationId:op.operation_id||op.id,kind:op.kind,outcome,
        recovery:failed?'billing_review':op.reconcile_attempts>=5?'review_required':op.state==='received'||(op.state==='completed'&&op.status!=='completed')?'receipt_ready':outcome==='unknown'?'review_required':outcome==='pending'?'waiting_callback':null,
        ...(op.dispatched_at?{dispatchedAt:op.dispatched_at}:{}),...(op.response_at?{responseAt:op.response_at}:{})};
}
export function canvasAgentAllowedActions(run,operation) {
    if(['completed','cancelled','taken_over','clarification_required'].includes(run.status))return [];
    const actions=['cancel','takeover'];
    if(ACTIVE_AGENT_STATES.includes(run.status))actions.unshift('pause');
    if(run.status==='paused'&&(run.current_revision===undefined||run.current_revision===run.expected_revision)
        &&!['pending','unknown','failed'].includes(operation?.outcome)&&!['review_required','billing_review'].includes(operation?.recovery))actions.unshift('resume');
    return actions;
}
export async function wakeCanvasAgent(env,id,delaySeconds=0) {
    try {await env.AI_VIDEO_JOBS_QUEUE.send({type:CANVAS_AGENT_MESSAGE,run_id:id},{delaySeconds});}
    catch { /* Persisted next_attempt_at is the scheduled recovery outbox. */ }
}
export async function requeueCanvasAgents(env) {
    const {reconcileCanvasAgentModelOperations}=await import('./canvas-agent-model-operations.js');
    await reconcileCanvasAgentModelOperations(env);
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
    const allowed=['status','phase','error_code','plan_json','result_json','expected_revision','next_attempt_at'];
    if(Object.keys(changes).some(k=>!allowed.includes(k)))throw new TypeError('Invalid state transition');
    const entries=Object.entries(changes);
    const result=await env.DB.prepare(`UPDATE canvas_agent_runs SET ${entries.map(([key])=>`${key}=?`).join(',')},updated_at=? WHERE id=? AND lease_token=?`)
        .bind(...entries.map(([,value])=>value),nowIso(),run.id,run.lease_token).run();
    if(result.meta?.changes!==1)agentFail('canvas_agent_claim_lost');
    Object.assign(run,changes);
}
