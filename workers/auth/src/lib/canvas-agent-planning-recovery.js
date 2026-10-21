import { canvasPlanningEvidence } from './canvas-agent-execution-failure.js';
import { assertCanvasAgentPlanningAllowed } from './canvas-agent-repair.js';
import { canvasAssistantAvailability } from './canvas-agent-assistant-models.js';
import { quoteCanvasAgentPlan } from './canvas-agent-planning.js';
import { readCanvasAgentBudget } from './canvas-agent-budget.js';
import { canvasAgentEventStatement } from './canvas-agent-progress.js';
import { markMemberAiUsageAttemptProviderFailed } from './member-ai-usage-attempts.js';
import { nowIso,sha256Hex } from './tokens.js';
import { settlePinnedModelTariff } from './model-tariffs.js';
import { canvasGrokUsageUnits } from '../../../shared/canvas-agent-metering.mjs';
import { canvasFableUsageUnits } from '../../../shared/canvas-assistant-fable.mjs';
import { CANVAS_FABLE_MODEL } from '../../../../js/shared/canvas-assistant-models.mjs';
import { stablePricingJson } from '../../../../js/shared/model-tariff.mjs';

const fail=code=>{throw Object.assign(new Error(code),{code,status:409});};
const eligibleCodes=new Set(['canvas_agent_execution_review_required','canvas_agent_local_execution_failed','canvas_agent_prepare_failed','canvas_agent_service_unavailable']);
export async function inspectCanvasPlanningReadmission(env,run) {
    const cause=JSON.parse(run.cause_json||'{}');
    if(run.error_code==='canvas_agent_plan_correction_exhausted')return inspectStoredPlan(env,run);
    if(run.purpose!=='production'||!['planning','repairing'].includes(run.phase)||run.plan_json
        ||!(['blocked','review_required'].includes(run.status)||run.status==='planning'&&cause.recovery==='local_retry')
        ||!eligibleCodes.has(run.error_code)&&cause.execution?.transient!==true)return null;
    const evidence=await canvasPlanningEvidence(env,run);
    if(evidence.certainty!=='not_dispatched')return null;
    const {step}=evidence,attempt=evidence.attempts[0],input=JSON.parse(step.input_json),ordinal=(input.readmission?.ordinal||0)+1;
    if(ordinal>2||!['reserved','released'].includes(attempt.billing_status))return null;
    const current=await planningAuthority(env,run);if(!current)return null;
    try{await assertCanvasAgentPlanningAllowed(env,run,[],{stepId:step.id});}
    catch(error){if(error.code==='canvas_agent_recovered_plan_requires_review')return null;throw error;}
    const id=(await sha256Hex(`canvas-agent-local-readmission:${step.id}`)).slice(0,32);
    return {id,ordinal,step,attempt,input,current};
}
async function planningAuthority(env,run){
    const current=await env.DB.prepare(`SELECT p.revision,p.deleted_at,u.status,c.brief_revision,c.state,
        (SELECT revision FROM model_pricing_state WHERE id=1) AS tariff_revision,
        EXISTS(SELECT 1 FROM canvas_agent_runs newer WHERE newer.project_id=p.id AND newer.purpose='production' AND newer.created_at>?) AS newer_run
        FROM canvas_projects p JOIN users u ON u.id=p.user_id LEFT JOIN canvas_agent_conversations c ON c.project_id=p.id
        WHERE p.id=? AND p.user_id=?`).bind(run.created_at,run.project_id,run.user_id).first();
    if(!current||current.newer_run||current.deleted_at||current.status!=='active'||current.revision!==run.expected_revision||run.expires_at<=nowIso()
        ||current.tariff_revision!==run.tariff_revision||run.brief_revision&&current.brief_revision!==run.brief_revision
        ||current.state==='cancelled'||run.lease_until&&run.lease_until>nowIso())return null;
    return current;
}

// Same production and unchanged creative request; a released billing attempt
// remains released. Only the positively undispatched local admission is replaced.
// This service is shared by the authenticated Resume action and bounded cron
// recovery, not an operator-only approval ledger or an inference endpoint.
export async function readmitCanvasPlanning(env,run,{requestKey=null,automatic=false}={}) {
    if(!automatic&&!requestKey)fail('canvas_agent_readmission_consent_required');
    if(automatic&&JSON.parse(run.cause_json||'{}').recovery!=='local_retry')fail('canvas_agent_readmission_consent_required');
    const inspected=await inspectCanvasPlanningReadmission(env,run);
    if(!inspected)fail('canvas_agent_readmission_not_safe');
    if(inspected.kind==='stored_plan')return resumeStoredPlan(env,run,inspected,requestKey);
    const {id,ordinal,step,attempt,input}=inspected;
    const available=await canvasAssistantAvailability(env,run.model_id,{providerReadiness:false});if(!available.available)fail(available.code);
    const quote=await quoteCanvasAgentPlan(env,input.payload);
    if(quote.credits!==step.allocation_credits||quote.tariff.revision!==run.tariff_revision)fail('model_pricing_stale');
    if(attempt.billing_status==='reserved')await markMemberAiUsageAttemptProviderFailed(env,attempt.id,{definitelyNotDispatched:true,code:'canvas_agent_local_readmission'});
    const budget=await readCanvasAgentBudget(env,run);if(budget.remainingCredits<step.allocation_credits)fail('canvas_agent_budget_exceeded');
    const now=nowIso(),sourceDigest=await sha256Hex(step.input_json),newInput=JSON.stringify({...input,
        readmission:{ordinal,sourceStepId:step.id,sourceAttemptId:attempt.id,sourceDigest}});
    const eventKey=`local-readmission:${step.id}`;
    const statements=[
        env.DB.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM canvas_agent_runs r JOIN canvas_projects p ON p.id=r.project_id
          JOIN users u ON u.id=r.user_id JOIN canvas_agent_steps s ON s.run_id=r.id JOIN member_ai_usage_attempts_v2 a ON a.id=s.usage_attempt_id
          WHERE r.id=? AND r.user_id=? AND r.project_id=? AND r.status=? AND r.error_code=? AND r.cause_json IS ?
          AND r.expected_revision=? AND p.revision=r.expected_revision AND p.deleted_at IS NULL AND u.status='active'
          AND r.expires_at>? AND (r.lease_until IS NULL OR r.lease_until<=?) AND r.plan_json IS NULL
          AND NOT EXISTS(SELECT 1 FROM canvas_agent_runs newer WHERE newer.project_id=r.project_id AND newer.purpose='production' AND newer.created_at>r.created_at)
          AND r.budget_credits=? AND r.budget_revision=? AND r.tariff_revision=(SELECT revision FROM model_pricing_state WHERE id=1)
          AND (COALESCE(r.brief_revision,0)=0 OR EXISTS(SELECT 1 FROM canvas_agent_conversations c WHERE c.project_id=p.id
            AND c.user_id=r.user_id AND c.state='active' AND c.brief_revision=r.brief_revision))
          AND s.id=? AND s.status='ready' AND s.receipt_json IS NULL AND s.input_json=? AND s.allocation_credits=?
          AND s.rowid=(SELECT MAX(latest.rowid) FROM canvas_agent_steps latest WHERE latest.run_id=r.id AND latest.kind='plan')
          AND a.id=? AND a.user_id=r.user_id AND a.provider_outcome='not_dispatched' AND a.dispatch_token IS NULL AND a.dispatched_at IS NULL
          AND a.billing_status='released' AND a.reservation_released_at IS NOT NULL
          AND NOT EXISTS(SELECT 1 FROM canvas_agent_model_operations o WHERE o.step_id=s.id)
          AND NOT EXISTS(SELECT 1 FROM member_credit_ledger l WHERE l.user_id=a.user_id AND l.idempotency_key=a.idempotency_key AND l.amount<0)
          AND NOT EXISTS(SELECT 1 FROM member_ai_usage_attempts_v2 other WHERE other.id!=a.id AND other.user_id=r.user_id
            AND json_extract(other.metadata_json,'$.canvas_agent.step_id')=s.id)) THEN 1 ELSE json_extract('[]','$[') END`)
          .bind(run.id,run.user_id,run.project_id,run.status,run.error_code,run.cause_json,run.expected_revision,now,now,run.budget_credits,run.budget_revision||0,
            step.id,step.input_json,step.allocation_credits,attempt.id),
        env.DB.prepare("UPDATE canvas_agent_runs SET status='planning',error_code=NULL,cause_json=?,next_attempt_at=?,updated_at=? WHERE id=?")
          .bind(JSON.stringify({code:'canvas_agent_local_readmission',stepId:id,recovery:'automatic',sourceStepId:step.id,sourceAttemptId:attempt.id,ordinal}),now,now,run.id),
        env.DB.prepare(`INSERT INTO canvas_agent_steps(id,run_id,step_key,kind,input_json,allocation_credits,created_at,updated_at)
          VALUES(?,?,?,'plan',?,?,?,?)`).bind(id,run.id,`local_readmission_${ordinal}`,newInput,step.allocation_credits,now,now),
        canvasAgentEventStatement(env,run,eventKey,'action',{code:'planning',phase:'planning',tool:'production.resume',stepId:id,
            sourceStepId:step.id,sourceAttemptId:attempt.id,dispatchState:'not_dispatched',ordinal}),
        ...(requestKey?[env.DB.prepare("INSERT INTO canvas_agent_controls(run_id,request_key,action,created_at) VALUES(?,?,'resume',?)").bind(run.id,requestKey,now)]:[]),
    ];
    try{await env.DB.batch(statements);}catch(error){
        const committed=await env.DB.prepare(`SELECT s.id FROM canvas_agent_steps s JOIN canvas_agent_events e ON e.run_id=s.run_id
          WHERE s.id=? AND s.run_id=? AND s.input_json=? AND e.event_key=?`).bind(id,run.id,newInput,eventKey).first();
        if(!committed)throw error;
    }
    return {stepId:id,sourceStepId:step.id,sourceAttemptId:attempt.id,ordinal};
}

// Reuse only a settled successful answer whose previously rejected native
// settings now have an explicit, deterministic interpretation. No new step,
// inference allowance, correction counter reset or historical receipt rewrite.
async function inspectStoredPlan(env,run){
    if(run.purpose!=='production'||run.status!=='blocked'||run.phase!=='planning'||run.plan_json
        ||String(env.CANVAS_AGENT_ENABLED)!=='true'||!JSON.parse(run.cause_json||'{}').issues?.some(issue=>issue.code==='canvas_agent_trim_outside_planned_source'))return null;
    const current=await planningAuthority(env,run);if(!current)return null;
    const evidence=await canvasPlanningEvidence(env,run),{step,operation,attempts}=evidence,attempt=attempts[0];
    if(evidence.certainty!=='response_stored'||step.status!=='completed'||!step.receipt_json||operation.state!=='completed'||!operation.receipt_json||attempts.length!==1
        ||attempt.id!==step.usage_attempt_id||attempt.billing_status!=='finalized'||attempt.provider_outcome!=='succeeded'
        ||attempt.reservation_released_at||attempt.charged<1||operation.usage_attempt_id!==attempt.id||operation.dispatch_token!==attempt.dispatch_token
        ||operation.model!==run.model_id)return null;
    const receipt=JSON.parse(operation.receipt_json),stored=JSON.parse(step.receipt_json),payload=JSON.parse(step.input_json).payload;
    const {request,operationId,...canonical}=stored;
    if(receipt.ok!==true||receipt.outcome!=='completed'||operationId!==operation.id||request?.inputDigest!==operation.input_digest
        ||receipt.requestId!==operation.request_id||receipt.model!==operation.model||payload.requestId!==operation.request_id
        ||await sha256Hex(JSON.stringify(payload))!==operation.input_digest||stablePricingJson(canonical)!==stablePricingJson(receipt))return null;
    const metadata=JSON.parse(attempt.metadata_json),binding=metadata.canvas_agent;
    if(binding?.run_id!==run.id||binding.step_id!==step.id||binding.project_id!==run.project_id)return null;
    let credits;try{
        const units=operation.model===CANVAS_FABLE_MODEL?canvasFableUsageUnits(receipt.usage):canvasGrokUsageUnits(receipt.usage);
        if(!units)return null;credits=settlePinnedModelTariff(metadata.model_tariff,attempt.credit_cost,units);
    }catch(error){if(error.code)return null;throw error;}
    const debit=await env.DB.prepare('SELECT amount,ai_dispatch_token FROM member_credit_ledger WHERE user_id=? AND idempotency_key=?').bind(run.user_id,attempt.idempotency_key).first();
    if(credits!==attempt.charged||credits>step.allocation_credits||debit?.amount!==-credits||debit.ai_dispatch_token!==attempt.dispatch_token)return null;
    const plan=receipt.plan||receipt.data?.plan;
    const proposal=await env.DB.prepare('SELECT plan_json FROM canvas_agent_proposals WHERE step_id=? AND run_id=?').bind(step.id,run.id).first();
    if(!proposal||stablePricingJson(JSON.parse(proposal.plan_json))!==stablePricingJson(plan))return null;
    const {canvasAgentProject}=await import('../routes/canvas-agent.js'),{canvasAgentCapabilities}=await import('./canvas-agent-capabilities.js');
    const {preflightCanvasAgentGraph}=await import('./canvas-agent-graph.js');
    const view=await canvasAgentProject(env,run.user_id,run.project_id),inventory=await canvasAgentCapabilities(env);
    if(inventory.revision!==run.capability_revision)return null;
    const checked=await preflightCanvasAgentGraph(env,run,view,inventory,plan);
    if(!checked.ok||checked.estimatedCredits>checked.budget.remainingCredits||!checked.repairs.some(r=>r.code==='canvas_agent_seedance_native_settings'))return null;
    return {kind:'stored_plan',step,operation,attempt,current,checked};
}
async function resumeStoredPlan(env,run,value,requestKey){
    const {step,operation,attempt,checked}=value,now=nowIso(),key=`stored-plan-resume:${step.id}`;
    const cause=JSON.stringify({code:'canvas_agent_saved_plan_revalidated',stepId:step.id,operationId:operation.id,recovery:'automatic'});
    try{await env.DB.batch([
        env.DB.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM canvas_agent_runs r JOIN canvas_projects p ON p.id=r.project_id
          JOIN users u ON u.id=r.user_id JOIN canvas_agent_steps s ON s.run_id=r.id JOIN canvas_agent_model_operations o ON o.step_id=s.id
          JOIN member_ai_usage_attempts_v2 a ON a.id=s.usage_attempt_id WHERE r.id=? AND r.user_id=? AND r.project_id=?
          AND r.status='blocked' AND r.phase='planning' AND r.error_code=? AND r.cause_json=? AND r.plan_json IS NULL AND r.expires_at>?
          AND (r.lease_until IS NULL OR r.lease_until<=?) AND p.deleted_at IS NULL AND u.status='active' AND p.revision=r.expected_revision AND r.expected_revision=?
          AND r.budget_credits=? AND r.budget_revision=? AND r.tariff_revision=(SELECT revision FROM model_pricing_state WHERE id=1)
          AND (COALESCE(r.brief_revision,0)=0 OR EXISTS(SELECT 1 FROM canvas_agent_conversations c WHERE c.project_id=p.id AND c.user_id=r.user_id AND c.state='active' AND c.brief_revision=r.brief_revision))
          AND NOT EXISTS(SELECT 1 FROM canvas_agent_runs newer WHERE newer.project_id=r.project_id AND newer.purpose='production' AND newer.created_at>r.created_at)
          AND s.id=? AND s.status='completed' AND s.receipt_json=? AND s.input_json=? AND s.rowid=(SELECT MAX(rowid) FROM canvas_agent_steps WHERE run_id=r.id AND kind='plan')
          AND o.id=? AND o.state='completed' AND o.receipt_json=? AND o.response_json=? AND o.input_digest=? AND o.usage_attempt_id=a.id AND o.user_id=r.user_id
          AND a.id=? AND a.user_id=r.user_id AND a.metadata_json=? AND a.billing_status='finalized' AND a.provider_outcome='succeeded' AND a.dispatch_token=o.dispatch_token AND a.reservation_released_at IS NULL
          AND (SELECT COALESCE(SUM(-l.amount),0) FROM member_credit_ledger l WHERE l.user_id=a.user_id AND l.idempotency_key=a.idempotency_key AND l.amount<0)=?)
          THEN 1 ELSE json_extract('[]','$[') END`).bind(run.id,run.user_id,run.project_id,run.error_code,run.cause_json,now,now,run.expected_revision,run.budget_credits,run.budget_revision||0,
            step.id,step.receipt_json,step.input_json,operation.id,operation.receipt_json,operation.response_json,operation.input_digest,attempt.id,attempt.metadata_json,attempt.charged),
        env.DB.prepare("UPDATE canvas_agent_runs SET status='planning',error_code=NULL,cause_json=?,next_attempt_at=?,updated_at=? WHERE id=?").bind(cause,now,now,run.id),
        canvasAgentEventStatement(env,run,key,'action',{code:'planning',phase:'planning',tool:'production.resume',stepId:step.id,operationId:operation.id,
            policy:'canvas-seedance-native-settings-v1',repairs:checked.repairs,newInferenceCalls:0,newCharges:0}),
        env.DB.prepare("INSERT INTO canvas_agent_controls(run_id,request_key,action,created_at) VALUES(?,?,'resume',?)").bind(run.id,requestKey,now),
    ]);}catch(error){
        const committed=await env.DB.prepare('SELECT 1 FROM canvas_agent_events WHERE run_id=? AND event_key=?').bind(run.id,key).first();
        if(!committed)throw error;
    }
    return {kind:'stored_plan',stepId:step.id,operationId:operation.id,newInferenceCalls:0,newCharges:0};
}
