import { logDiagnostic } from '../../../../js/shared/worker-observability.mjs';
import { sha256Hex } from './tokens.js';

const safeCode=value=>typeof value==='string'&&/^[a-z][a-z0-9_]{0,89}$/.test(value)?value:null;
const stages=new Set(['authority','input','policy','readiness','reservation','reservation_link','admission','prepare','dispatch_claim','dispatch','receipt','planning']);
const causes=new Set(['canvas_agent_authority_revoked','canvas_agent_recovery_brief_changed','canvas_agent_diagnostic_authority_required',
    'canvas_agent_step_immutable','model_pricing_stale','model_area_disabled','canvas_agent_budget_exceeded']);
export async function canvasExecutionDiagnostic(error,{stage='planning',stepId=null}={}) {
    const chain=[];for(let e=error;e&&chain.length<3;e=e.cause)chain.push(e);
    const text=chain.map(e=>String(e.message||'').slice(0,2000)).join('\n');
    const invariant=[...causes].find(code=>new RegExp(`\\b${code}\\b`).test(text));
    const sqlite=chain.some(e=>/SQLITE|D1_/.test(String(e.code||'')))||/\b(?:D1_ERROR|SQLITE_ERROR)\b/.test(text);
    const busy=chain.some(e=>['SQLITE_BUSY','SQLITE_LOCKED','D1_SESSION_ERROR'].includes(e.code)||/^D1_ERROR:.*\b(?:SQLITE_BUSY|SQLITE_LOCKED)\b/.test(String(e.message||'')));
    const nativeCode=chain.map(e=>e.code).find(value=>['SQLITE_BUSY','SQLITE_LOCKED','SQLITE_ERROR','ERR_SQLITE_ERROR','D1_ERROR','D1_TYPE_ERROR','D1_SESSION_ERROR'].includes(value))||null;
    const category=invariant?'invariant':busy?'database_transient':sqlite?'database':chain.some(e=>e instanceof TypeError)?'type':chain.some(e=>e instanceof SyntaxError)?'syntax':'internal';
    // Only fixed codes and source locations leave the exception boundary. Never
    // retain arbitrary messages, SQL, inputs, provider text or complete stacks.
    const source=String(error?.stack||'').match(/\b(?:canvas-agent-[a-z-]+|ai-usage-policy|ai-dispatch-state)\.js:\d+:\d+/)?.[0]||null;
    return {version:1,nativeCode,httpStatus:Number.isInteger(error?.status)&&error.status>=400&&error.status<=599?error.status:null,stage:stages.has(stage)?stage:'planning',category,reason:invariant||safeCode(error?.code)||'unclassified_local_exception',
        stepId,source,reference:`canvas-execution-${(await sha256Hex([stage,stepId,error?.name,text].join(':'))).slice(0,24)}`,
        transient:busy&&!invariant};
}

// Read the exact step and all attempts bound to it. A missing projection is
// unknown evidence, never affirmative proof that no provider request was sent.
export async function canvasPlanningEvidence(env,run,stepId=null) {
    const step=await env.DB.prepare(`SELECT s.* FROM canvas_agent_steps s JOIN canvas_agent_runs r ON r.id=s.run_id
        WHERE r.id=? AND r.user_id=? AND r.project_id=? AND s.kind='plan' AND (? IS NULL OR s.id=?) ORDER BY s.rowid DESC LIMIT 1`)
        .bind(run.id,run.user_id,run.project_id,stepId,stepId).first();
    if(!step)return {step:null,certainty:'unverified',attempts:[],operation:null};
    const operation=await env.DB.prepare('SELECT * FROM canvas_agent_model_operations WHERE step_id=? AND run_id=? AND user_id=?').bind(step.id,run.id,run.user_id).first();
    const attempts=(await env.DB.prepare(`SELECT a.*,COALESCE((SELECT SUM(-l.amount) FROM member_credit_ledger l
        WHERE l.user_id=a.user_id AND l.idempotency_key=a.idempotency_key AND l.amount<0),0) AS charged
        FROM member_ai_usage_attempts_v2 a WHERE a.user_id=? AND (a.id=? OR
        (json_extract(a.metadata_json,'$.canvas_agent.run_id')=? AND json_extract(a.metadata_json,'$.canvas_agent.step_id')=?))`)
        .bind(run.user_id,step.usage_attempt_id,run.id,step.id).all()).results;
    let certainty='unverified';
    if(operation?.response_json)certainty='response_stored';
    else if(operation&&['dispatching','pending'].includes(operation.state))certainty='accepted_or_dispatching';
    else if(operation||attempts.some(a=>a.dispatch_token||a.dispatched_at||a.provider_outcome!=='not_dispatched'||a.charged))certainty='unknown';
    else if(attempts.length===1&&attempts[0].id===step.usage_attempt_id&&!step.receipt_json&&step.status==='ready')certainty='not_dispatched';
    return {step,attempts,operation,certainty};
}

export async function canvasProductionFailure(env,run,error) {
    const diagnostic=error.executionDiagnostic||await canvasExecutionDiagnostic(error,{stage:run.phase});
    logDiagnostic({service:'bitbi-auth',component:'canvas-agent',event:'canvas_execution_failed',level:'error',correlationId:run.id,...diagnostic});
    const evidence=run.phase==='planning'||run.phase==='repairing'?await canvasPlanningEvidence(env,run,diagnostic.stepId):null;
    const code=safeCode(error.code)||(causes.has(diagnostic.reason)?diagnostic.reason:'canvas_agent_local_execution_failed');
    const certainty=evidence?.certainty||'unverified';
    const knownReview=new Set(['canvas_agent_policy_review_required','canvas_agent_billing_review_required','canvas_agent_planning_review_required',
        'canvas_agent_result_review_required','canvas_agent_provider_review_required','canvas_agent_receipt_review_required','canvas_agent_provider_failure_review_required',
        'canvas_agent_provider_outcome_unknown','canvas_agent_provider_timeout','canvas_agent_claim_lost','generation_result_requires_credit_review']).has(code);
    const retry=diagnostic.transient&&certainty==='not_dispatched'&&Number(JSON.parse(evidence.step.input_json).readmission?.ordinal||0)<2;
    return {code,status:retry?'planning':['unknown','accepted_or_dispatching'].includes(certainty)||certainty==='response_stored'&&code==='canvas_agent_local_execution_failed'||knownReview?'review_required':'blocked',
        cause:{code,step:run.phase,recovery:retry?'local_retry':certainty==='not_dispatched'?'readmission':['response_stored','accepted_or_dispatching','unknown'].includes(certainty)?'receipt':'support',
            dispatchState:certainty,stepId:evidence?.step?.id||diagnostic.stepId,operationId:evidence?.operation?.id||null,execution:diagnostic},evidence};
}
