import { AI_USAGE_OPERATIONS, prepareAiUsagePolicy } from './ai-usage-policy.js';
import { CANVAS_AGENT_MODEL } from '../../../../js/shared/canvas-agent-contract.mjs';
import { CANVAS_AGENT_PLAN_MAX_OUTPUT_TOKENS, CANVAS_AGENT_PLAN_INPUT_MAX_BYTES, CANVAS_AGENT_PLAN_SYSTEM, CANVAS_AGENT_PLAN_SCHEMA,
    CANVAS_AGENT_EVALUATION_MAX_OUTPUT_TOKENS, CANVAS_AGENT_EVALUATION_SYSTEM, CANVAS_AGENT_EVALUATION_SCHEMA } from '../../../shared/canvas-agent-plan.mjs';
import { buildServiceAuthHeaders } from '../../../../js/shared/service-auth.mjs';
import { AI_CALLER_POLICY_VERSION } from '../../../shared/ai-caller-policy.mjs';
import { readGenerationResponseJson, fetchWithGenerationTimeout } from './generation-timeout.js';
import { quoteModelTariff, settlePinnedModelTariff } from './model-tariffs.js';
import { canvasAgentEnvironment, canvasAgentSession } from './canvas-agent-authority.js';
import { nowIso, sha256Hex } from './tokens.js';
import { modelAreaEnvironment } from './model-availability.js';
import { consumeMemberCredits } from './billing.js';
import { markMemberAiUsageAttemptFinalizing, markMemberAiUsageAttemptSucceeded } from './member-ai-usage-attempts.js';
import { canvasModelTransportReady,canvasModelService,readCanvasModelOperation,dispatchCanvasModelOperation,reconcileCanvasAgentModelOperations } from './canvas-agent-model-operations.js';

export const PLAN_PATH='/internal/ai/canvas-agent/plan';
export const EVALUATE_PATH='/internal/ai/canvas-agent/evaluate';
export async function readCanvasAgentProviderReadiness(env) {
    const unavailable={available:false,reason:'canvas_agent_provider_unavailable',model:CANVAS_AGENT_MODEL,accountAccess:'unverified'};
    if(!canvasModelTransportReady(env)||typeof env.AI_LAB?.fetch!=='function'||String(env.AI_SERVICE_AUTH_SECRET||'').trim().length<16)return unavailable;
    const path='/internal/ai/canvas-agent/readiness';
    try {
        const headers=await buildServiceAuthHeaders({secret:env.AI_SERVICE_AUTH_SECRET,method:'GET',path,body:''});
        let payload;
        const response=await fetchWithGenerationTimeout(env.AI_LAB.fetch.bind(env.AI_LAB),new Request(`https://bitbi-ai.internal${path}`,{headers}),undefined,
            {timeoutMs:5000,consumeResponse:async(response,signal)=>{payload=await readGenerationResponseJson(response,signal);return response;}});
        if(!response.ok||!payload?.ok||payload.protocolVersion!==1||payload.transport!=='cloudflare-background'||payload.model!==CANVAS_AGENT_MODEL||typeof payload.available!=='boolean'||payload.accountAccess!=='unverified')return unavailable;
        return {available:payload.available,reason:payload.available?null:/^[a-z0-9_]{1,80}$/.test(payload.reason||'')?payload.reason:unavailable.reason,
            model:CANVAS_AGENT_MODEL,accountAccess:'unverified'};
    } catch {return unavailable;}
}
const AGENT_ROUTE='/api/account/canvas/projects/:projectId/agent';
export function plannerPriceInput(payload) {
    const prompt=JSON.stringify(payload);
    if(new TextEncoder().encode(prompt).byteLength>CANVAS_AGENT_PLAN_INPUT_MAX_BYTES)
        throw Object.assign(new Error('canvas_agent_context_limit'),{code:'canvas_agent_context_limit',status:413});
    return {model:CANVAS_AGENT_MODEL,prompt,system:CANVAS_AGENT_PLAN_SYSTEM+JSON.stringify(CANVAS_AGENT_PLAN_SCHEMA),
        maxTokens:CANVAS_AGENT_PLAN_MAX_OUTPUT_TOKENS};
}
export function evaluationPriceInput() {
    // Cloudflare documents a 500,000-token context for this exact model, but
    // does not document a dependable image-token formula. Reserve the entire
    // possible input context at its >=200k tariff, plus the bounded output.
    // This is an explicit conservative spending authorization, not actual usage.
    return {model:CANVAS_AGENT_MODEL,prompt:'Bounded Canvas sampled-frame evaluation v1',
        system:CANVAS_AGENT_EVALUATION_SYSTEM+JSON.stringify(CANVAS_AGENT_EVALUATION_SCHEMA),
        previewInputTokens:500000-CANVAS_AGENT_EVALUATION_MAX_OUTPUT_TOKENS,maxTokens:CANVAS_AGENT_EVALUATION_MAX_OUTPUT_TOKENS};
}
export const quoteCanvasAgentPlan=(env,payload)=>quoteModelTariff(env,{modelId:CANVAS_AGENT_MODEL,input:plannerPriceInput(payload)});
export const quoteCanvasAgentEvaluation=env=>quoteModelTariff(env,{modelId:CANVAS_AGENT_MODEL,input:evaluationPriceInput()});
const fail=code=>{throw Object.assign(new Error(code),{code,status:409});};

export async function settleStoredReceipt(env,run,step,result,operation=null) {
    const row=await env.DB.prepare('SELECT * FROM member_ai_usage_attempts_v2 WHERE id=? AND user_id=?').bind(step.usage_attempt_id,run.user_id).first();
    const metadata=JSON.parse(row?.metadata_json||'{}');
    const durable=operation&&await env.DB.prepare("SELECT id FROM canvas_agent_model_operations WHERE id=? AND step_id=? AND usage_attempt_id=? AND dispatch_token=? AND state='completed' AND receipt_json=?")
        .bind(operation.id,step.id,row?.id||'',row?.dispatch_token||'',JSON.stringify((({request,operationId,...rest})=>rest)(result))).first();
    if(!row||!row.dispatch_token||metadata.canvas_agent?.step_id!==step.id||metadata.canvas_agent?.run_id!==run.id
        ||row.credit_cost!==step.allocation_credits||row.reservation_released_at)fail('canvas_agent_billing_review_required');
    if(row.billing_status!=='finalized') {
        if(row.billing_status!=='reserved'||(!durable&&row.expires_at<=nowIso()))fail('canvas_agent_billing_review_required');
        if(row.provider_outcome==='unknown') {
            // The already persisted completed receipt is evidence for this exact
            // original dispatch. It permits settlement, never another request.
            const restored=await env.DB.prepare(`UPDATE member_ai_usage_attempts_v2 SET provider_outcome='dispatched'
                WHERE id=? AND dispatch_token=? AND provider_outcome='unknown' AND billing_status='reserved'
                AND reservation_released_at IS NULL AND (expires_at>? OR ?=1)`).bind(row.id,row.dispatch_token,nowIso(),durable?1:0).run();
            if(restored.meta?.changes!==1)fail('canvas_agent_billing_review_required');
            row.provider_outcome='dispatched';
        }
        if(row.provider_outcome==='dispatched') {
            if(durable) {
                const finalized=await env.DB.prepare("UPDATE member_ai_usage_attempts_v2 SET status='finalizing',provider_status='succeeded',provider_outcome='succeeded',updated_at=? WHERE id=? AND dispatch_token=? AND provider_outcome='dispatched' AND billing_status='reserved' AND reservation_released_at IS NULL").bind(nowIso(),row.id,row.dispatch_token).run();
                if(finalized.meta?.changes!==1)fail('canvas_agent_billing_review_required');
            } else await markMemberAiUsageAttemptFinalizing(env,row.id,{dispatchToken:row.dispatch_token});
        }
        else if(row.provider_outcome!=='succeeded')fail('canvas_agent_billing_review_required');
        const usage=result.usage;
        // xAI's documented Grok4.7 envelope can report reasoning outside
        // completion_tokens; total minus prompt includes that billable output
        // without double counting providers that include reasoning already.
        const units=usage&&['input_tokens','output_tokens'].every(key=>Number.isSafeInteger(usage[key])&&usage[key]>=0)
            &&Number.isSafeInteger(usage.provider?.total_tokens)&&usage.provider.total_tokens>=usage.input_tokens+usage.output_tokens
            ?{inputToken:usage.input_tokens,outputToken:usage.provider.total_tokens-usage.input_tokens}:undefined;
        const credits=settlePinnedModelTariff(metadata.model_tariff,row.credit_cost,units);
        if(!Number.isSafeInteger(credits)||credits<1||credits>row.credit_cost)fail('canvas_agent_billing_review_required');
        const charged=await consumeMemberCredits({env,userId:run.user_id,featureKey:row.feature_key,quantity:row.quantity||1,
            credits,idempotencyKey:row.idempotency_key,requestFingerprint:row.request_fingerprint,
            aiDispatchToken:row.dispatch_token,source:'canvas_agent_'+step.kind,
            metadata:{route:row.route,operation:row.operation_key,model:CANVAS_AGENT_MODEL,pricing_mode:'estimated_upper_bound',canvas_agent_receipt:step.id}});
        await markMemberAiUsageAttemptSucceeded(env,row.id,{dispatchToken:row.dispatch_token,model:CANVAS_AGENT_MODEL,resultStatus:'stored',
            balanceAfter:charged.creditBalance,metadata:{...metadata,canvas_agent_receipt:step.id}});
    } else if(row.provider_outcome!=='succeeded')fail('canvas_agent_billing_review_required');
    await env.DB.prepare('UPDATE canvas_agent_steps SET status=?,receipt_json=?,updated_at=? WHERE id=? AND usage_attempt_id=?')
        .bind(result.ok?'completed':'rejected',JSON.stringify(result),nowIso(),step.id,row.id).run();
    if(!result.ok)fail(result.code||'canvas_agent_model_output_invalid');
    return result;
}

export async function executeCanvasAgentModel(env,run,step,user,suppliedPayload) {
    if(!['plan','evaluate'].includes(step.kind))fail('canvas_agent_model_step_invalid');
    const input=JSON.parse(step.input_json),payload=suppliedPayload||input.payload;
    if(!payload)fail('canvas_agent_model_input_missing');
    const pricingInput=step.kind==='evaluate'?(input.pricingInput||evaluationPriceInput()):plannerPriceInput(payload);
    const scoped=canvasAgentEnvironment(modelAreaEnvironment(env,'canvas'),{runId:run.id,stepId:step.id,projectId:run.project_id,userId:run.user_id,leaseToken:run.lease_token});
    const request=new Request(`https://bitbi.ai${AGENT_ROUTE.replace(':projectId',run.project_id)}`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':`canvas-agent-${step.id}`,'X-Bitbi-Tariff-Revision':String(run.tariff_revision)},body:'{}'});
    await canvasAgentSession(request,scoped);
    const snapshot={inputDigest:await sha256Hex(JSON.stringify(payload)),frameDigests:await Promise.all((payload.frames||[]).map(async frame=>({nodeId:frame.nodeId,timeSeconds:frame.timeSeconds,imageSha256:await sha256Hex(frame.imageData)})))};
    const stored=step.receipt_json?JSON.parse(step.receipt_json):null;
    if(stored?.request?.inputDigest&&stored.request.inputDigest!==snapshot.inputDigest)fail('canvas_agent_model_input_changed');
    if(stored?.outcome==='completed')return settleStoredReceipt(scoped,run,step,stored);
    let operation=await readCanvasModelOperation(env,step.id);
    const observe=async()=>{
        if(operation.input_digest!==snapshot.inputDigest)fail('canvas_agent_model_input_changed');
        await reconcileCanvasAgentModelOperations(env,{runId:run.id});
        operation=await readCanvasModelOperation(env,step.id);
        if(operation.reconcile_attempts>=5)fail('canvas_agent_receipt_review_required');
        if(operation.state==='completed'){
            const settled=await env.DB.prepare('SELECT status FROM canvas_agent_steps WHERE id=?').bind(step.id).first();
            if(!['completed','rejected'].includes(settled?.status))return null;
            const receipt=JSON.parse(operation.receipt_json);if(!receipt.ok)fail(receipt.code);return receipt;
        }
        if(operation.state==='rejected')fail(operation.error_code||'canvas_agent_provider_rejected');
        if(operation.state==='unknown')fail(operation.error_code||'canvas_agent_provider_outcome_unknown');
        return null;
    };
    if(operation)return observe();
    if(step.status!=='ready')fail('canvas_agent_planning_review_required');
    if(!canvasModelTransportReady(env)||typeof env.AI_LAB?.fetch!=='function'||String(env.AI_SERVICE_AUTH_SECRET||'').trim().length<16)fail('canvas_agent_provider_unavailable');
    const policy=await prepareAiUsagePolicy({env:scoped,request,user,body:pricingInput,
        operation:{...AI_USAGE_OPERATIONS.MEMBER_TEXT_GENERATE,modelId:CANVAS_AGENT_MODEL,credits:step.allocation_credits,source:'canvas_agent_'+step.kind},
        route:new URL(request.url).pathname,allowAdminMemberCredits:true});
    await env.DB.prepare('UPDATE canvas_agent_steps SET usage_attempt_id=?,updated_at=? WHERE id=? AND (usage_attempt_id IS NULL OR usage_attempt_id=?)').bind(policy.attempt.id,nowIso(),step.id,policy.attempt.id).run();
    step={...step,usage_attempt_id:policy.attempt.id};
    if(!['reserved','retryable'].includes(policy.attemptKind))fail('canvas_agent_planning_review_required');
    await policy.prepareForProvider();
    const callerPolicy={policy_version:AI_CALLER_POLICY_VERSION,operation_id:'member.text.generate',budget_scope:'member_credit_account',
        enforcement_status:'gateway_enforced',caller_class:'member',owner_domain:'member-text',provider_family:'ai_worker',model_id:CANVAS_AGENT_MODEL,
        model_resolver_key:'member.text.model_catalog',idempotency_policy:'required',source_route:new URL(request.url).pathname,
        source_component:'auth-worker-canvas-agent',budget_fingerprint:policy.gatewayPlan?.fingerprint||policy.requestFingerprint,
        request_fingerprint:policy.gatewayPlan?.fingerprint||policy.requestFingerprint,correlation_id:run.id,reason:'canvas_agent_member_credit_gateway_verified'};
    let prepared;
    try {
        prepared=await canvasModelService(env,'/internal/ai/canvas-agent/prepare',{kind:step.kind,input:payload},callerPolicy,user.id);
        if(!prepared.ok||prepared.protocolVersion!==1||prepared.model!==CANVAS_AGENT_MODEL||prepared.inputDigest!==snapshot.inputDigest
            ||prepared.requestId!==payload.requestId||!prepared.context||!prepared.input)fail('canvas_agent_service_response_invalid');
        await canvasAgentSession(request,scoped);
    } catch(error) {
        await policy.markProviderFailed({definitelyNotDispatched:true,code:error.code||'canvas_agent_prepare_failed'});throw error;
    }
    const token=await policy.markProviderRunning();
    operation=await dispatchCanvasModelOperation(env,run,step,prepared,callerPolicy,token,snapshot);
    return observe();
}

export async function executeCanvasAgentPlan(env,run,step,user) {
    const result=await executeCanvasAgentModel(env,run,step,user);
    return result?.plan||result?.data?.plan||null;
}
