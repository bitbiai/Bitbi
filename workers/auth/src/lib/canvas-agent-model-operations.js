import { buildServiceAuthHeaders } from '../../../../js/shared/service-auth.mjs';
import { withAiCallerPolicy } from '../../../shared/ai-caller-policy.mjs';
import { readBodyBytesLimited } from '../../../../js/shared/request-body.mjs';
import { getAiSaveReferenceSigningSecret,getAiSaveReferenceSigningSecretCandidates } from './security-secrets.js';
import { fetchWithGenerationTimeout } from './generation-timeout.js';
import { nowIso,randomTokenHex } from './tokens.js';
import { wakeCanvasAgent } from './canvas-agent-store.js';
import { markMemberAiUsageAttemptProviderFailed } from './member-ai-usage-attempts.js';
import { h3Diagnostic } from './h3-provider-result.js';
import { canvasAgentReasoningSummary } from '../../../shared/canvas-agent-plan.mjs';
import { logCanvasDialogueStage } from './canvas-agent-dialogue-state.js';
import { canvasAssistantModel, CANVAS_FABLE_MODEL } from '../../../../js/shared/canvas-assistant-models.mjs';

export const CANVAS_MODEL_PROTOCOL=1;
export const CANVAS_MODEL_RECEIPT_WAIT_MS=30*60_000;
const MODEL='xai/grok-4.7',MAX_RECEIPT_BYTES=520*1024;
const fail=(code,status=409)=>{throw Object.assign(new Error(code),{code,status});};
const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,180}$/.test(value)?value:null;
const readOperation=(env,id)=>env.DB.prepare('SELECT * FROM canvas_agent_model_operations WHERE id=?').bind(id).first();
export const readCanvasModelOperation=(env,stepId)=>env.DB.prepare('SELECT * FROM canvas_agent_model_operations WHERE step_id=?').bind(stepId).first();

export function canvasModelTransportReady(env) {
    try {getAiSaveReferenceSigningSecret(env);} catch {return false;}
    return /^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID||'')&&typeof env.H3_CLOUDFLARE_API_TOKEN==='string'&&env.H3_CLOUDFLARE_API_TOKEN.trim().length>0;
}
async function boundedJson(response,signal,maxBytes=MAX_RECEIPT_BYTES) {
    const reader=response.body?.getReader();if(!reader)fail('canvas_agent_service_response_invalid');
    const chunks=[];let size=0;
    const abort=()=>{Promise.resolve(reader.cancel(signal?.reason)).catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
    try {for(;;){if(signal?.aborted)throw signal.reason;const {done,value}=await reader.read();if(done)break;
        size+=value.byteLength;if(size>maxBytes){await reader.cancel();fail('canvas_agent_receipt_too_large',413);}chunks.push(value);}
        if(signal?.aborted)throw signal.reason;
        const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
        return JSON.parse(new TextDecoder().decode(bytes));
    } finally {signal?.removeEventListener('abort',abort);reader.releaseLock();}
}
export async function canvasModelService(env,path,payload,policy,userId) {
    const body=JSON.stringify(withAiCallerPolicy(payload,policy));
    const signed=await buildServiceAuthHeaders({secret:env.AI_SERVICE_AUTH_SECRET,method:'POST',path,body});
    let result;
    const response=await fetchWithGenerationTimeout(env.AI_LAB.fetch.bind(env.AI_LAB),new Request(`https://bitbi-ai.internal${path}`,{
        method:'POST',headers:{...signed,'Content-Type':'application/json','x-bitbi-user-id':userId},body}),undefined,
    {timeoutMs:30_000,consumeResponse:async(response,signal)=>{result=await boundedJson(response,signal);return response;}});
    if(!result||typeof result.ok!=='boolean')fail('canvas_agent_service_response_invalid');
    if(!response.ok&&result.outcome!=='completed')throw Object.assign(new Error('canvas_agent_service_failed'),{
        code:/^[a-z0-9_]{1,90}$/.test(result.code||'')?result.code:'canvas_agent_service_unavailable',
        status:response.status,outcome:path.endsWith('/prepare')?'not_submitted':result.outcome});
    return result;
}
async function signature(secret,op) {
    const bytes=new TextEncoder(),key=await crypto.subtle.importKey('raw',bytes.encode(`canvas-model-callback:v1:${secret}`),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const input=JSON.stringify([op.id,op.step_id,op.run_id,op.user_id,op.usage_attempt_id,op.dispatch_token,op.input_digest]);
    return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,bytes.encode(input))),v=>v.toString(16).padStart(2,'0')).join('');
}
async function callbackUrl(env,op) {
    return `https://bitbi.ai/api/internal/ai/canvas-agent-result/${op.id}.${await signature(getAiSaveReferenceSigningSecret(env),op)}`;
}
function diagnostic(response,op,startedAt,error=null) {
    const value=h3Diagnostic(error,{status:response?.status,requestId:response?.headers.get('cf-ai-req-id'),gatewayId:response?.headers.get('cf-aig-log-id'),correlationId:op.id});
    return {...value,operationId:op.id,phase:op.kind,durationMs:Math.max(0,Date.now()-startedAt),providerRunId:op.provider_run_id||null};
}
async function markUnknown(env,op,code,detail) {
    const now=nowIso();
    await env.DB.prepare(`UPDATE canvas_agent_model_operations SET state='unknown',error_code=?,diagnostic_json=?,updated_at=?
        WHERE id=? AND state IN ('dispatching','pending') AND response_json IS NULL`).bind(code,JSON.stringify(detail),now,op.id).run();
    const current=await readOperation(env,op.id);
    if(current?.state==='unknown'){
        logCanvasDialogueStage('dispatch_unknown',{runId:op.run_id,operationId:op.id,stepId:op.step_id,code,
            httpStatus:detail?.status,durationMs:detail?.durationMs,dispatchState:'unknown',receiptState:'none'});
        await markMemberAiUsageAttemptProviderFailed(env,op.usage_attempt_id,{dispatchToken:op.dispatch_token,code,message:'Provider outcome requires reconciliation.'});
        await env.DB.prepare(`UPDATE canvas_agent_runs SET status='review_required',error_code=?,lease_token=NULL,lease_until=NULL,updated_at=?
            WHERE id=? AND status IN ('queued','planning','running','exporting')`).bind(code,now,op.run_id).run();
    }
}

// The immutable intent precedes the only paid POST. A process loss before POST
// is conservatively unknown; an intent can never be replayed as new inference.
export async function dispatchCanvasModelOperation(env,run,step,prepared,callerPolicy,dispatchToken,snapshot) {
    const model=canvasAssistantModel(prepared.model);
    if(!model||callerPolicy.model_id!==model.modelId||(run.model_id||MODEL)!==model.modelId
        ||(prepared.context.model||MODEL)!==model.modelId)fail('canvas_agent_model_identity_mismatch');
    const now=nowIso(),op={id:randomTokenHex(16),step_id:step.id,run_id:run.id,user_id:run.user_id,usage_attempt_id:step.usage_attempt_id,
        dispatch_token:dispatchToken,input_digest:snapshot.inputDigest,kind:step.kind,provider_run_id:null,receipt_protocol:2};
    const url=await callbackUrl(env,op); // Validate signing configuration before durable intent.
    await env.DB.batch([
        env.DB.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM canvas_agent_runs r JOIN canvas_projects p ON p.id=r.project_id
            JOIN users u ON u.id=r.user_id JOIN member_ai_usage_attempts_v2 a ON a.id=?
            WHERE r.id=? AND r.lease_token=? AND r.lease_until>? AND r.status IN ('planning','running')
            AND r.expires_at>? AND p.deleted_at IS NULL AND (p.revision=r.expected_revision OR r.purpose='briefing') AND u.status='active'
            AND (r.purpose='production' OR EXISTS(SELECT 1 FROM canvas_agent_conversations v WHERE v.project_id=r.project_id
                AND v.state='active' AND v.allowance_tariff=r.tariff_revision
                AND v.allowance_credits>=COALESCE((SELECT SUM(c.committed) FROM canvas_agent_step_costs c
                  JOIN canvas_agent_runs owner ON owner.id=c.run_id WHERE c.project_id=r.project_id AND owner.purpose='briefing'),0)))
            AND a.user_id=r.user_id AND a.dispatch_token=? AND a.provider_outcome='dispatched' AND a.billing_status='reserved'
            AND a.reservation_released_at IS NULL) THEN 1 ELSE json_extract('[]','$[') END`)
            .bind(step.usage_attempt_id,run.id,run.lease_token,now,now,dispatchToken),
        env.DB.prepare(`INSERT INTO canvas_agent_model_operations(id,step_id,run_id,user_id,usage_attempt_id,dispatch_token,kind,model,request_id,
            input_digest,context_json,caller_policy_json,state,receipt_protocol,dispatched_at,next_attempt_at,receipt_deadline,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'dispatching',2,?,?,?,?,?)`).bind(op.id,step.id,run.id,run.user_id,step.usage_attempt_id,dispatchToken,step.kind,model.modelId,
            prepared.requestId,snapshot.inputDigest,JSON.stringify(prepared.context),JSON.stringify(callerPolicy),now,now,new Date(Date.now()+CANVAS_MODEL_RECEIPT_WAIT_MS).toISOString(),now,now),
        env.DB.prepare("UPDATE canvas_agent_steps SET status='accepted',receipt_json=?,updated_at=? WHERE id=? AND status='ready'")
            .bind(JSON.stringify({request:snapshot,operationId:op.id}),now,step.id),
        env.DB.prepare("SELECT CASE WHEN changes()=1 THEN 1 ELSE json_extract('[]','$[') END"),
    ]);
    const startedAt=Date.now();let response,body;
    logCanvasDialogueStage('dispatching',{runId:run.id,operationId:op.id,stepId:step.id,dispatchState:'dispatched',receiptState:'none'});
    try {
        response=await fetchWithGenerationTimeout(env.__TEST_FETCH||fetch,`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run`,{
            method:'POST',redirect:'manual',headers:{Authorization:`Bearer ${env.H3_CLOUDFLARE_API_TOKEN}`,'Content-Type':'application/json',
                'cf-aig-gateway-id':'default','cf-aig-skip-cache':'true','cf-aig-collect-log':run.purpose==='briefing'?'true':'false',
                'cf-aig-collect-log-payload':'false','cf-aig-max-attempts':'1',
                'cf-aig-metadata':JSON.stringify({bitbi_dispatch:op.id,canvas_run:run.id,canvas_step:step.id})},
            body:JSON.stringify({model:model.modelId,input:prepared.input,options:{background:true,webhookUrl:url}})},
        {timeoutMs:30_000,consumeResponse:async(response,signal)=>{body=await boundedJson(response,signal);return response;}});
        const result=body?.result;
        // A documented background request may acknowledge acceptance with HTTP
        // 202 before it supplies a run ID. That is pending work, never a completed
        // inference or permission to resubmit. Its signed callback binds the ID.
        const accepted=response.status===202&&body&&typeof body==='object'&&!Array.isArray(body)
            &&(body.success===undefined||body.success===true)&&(body.errors===undefined||Array.isArray(body.errors)&&body.errors.length===0)&&!body.error&&!result?.error;
        if(!response.ok||body?.success===false||body?.errors?.length||body?.error||!accepted&&(body?.success!==true||!safeId(result?.id))) {
            const detail=diagnostic(response,op,startedAt,body?.errors?.[0]||result?.error);
            if(detail.noInference&&!safeId(result?.id))await storeRejection(env,op,'canvas_agent_provider_rejected',detail);
            else await markUnknown(env,op,'canvas_agent_provider_outcome_unknown',detail);
        } else if(result?.result?.object==='chat.completion'||result?.result?.type==='message'||result?.state==='Failed')await storeCallback(env,{...op,model:model.modelId},result);
        else {
            const providerId=safeId(result?.id);
            const saved=await env.DB.prepare(`UPDATE canvas_agent_model_operations SET state='pending',provider_run_id=?,diagnostic_json=?,response_at=?,updated_at=?
                WHERE id=? AND state='dispatching' AND provider_run_id IS NULL AND response_json IS NULL`)
                .bind(providerId,JSON.stringify({...diagnostic(response,op,startedAt),providerRunId:providerId,
                    envelope:{successPresent:typeof body.success==='boolean',resultPresent:Boolean(result&&typeof result==='object'),
                        rootIdPresent:Boolean(safeId(body.id)),resultIdPresent:Boolean(safeId(result?.id)),
                        state:['Queued','Running','Pending','Completed','Failed'].includes(result?.state)?result.state:null}}),nowIso(),nowIso(),op.id).run();
            const current=await readOperation(env,op.id);
            if(saved.meta?.changes!==1&&providerId&&current?.provider_run_id!==providerId)fail('canvas_agent_model_identity_mismatch');
            logCanvasDialogueStage(current.state==='pending'?'provider_pending':'callback_observed',{
                runId:run.id,operationId:op.id,stepId:step.id,httpStatus:response.status,
                durationMs:Date.now()-startedAt,dispatchState:current.state==='completed'?'succeeded':'dispatched',receiptState:current.state});
        }
    } catch(error) {
        await markUnknown(env,op,error?.code==='generation_timeout'?'canvas_agent_provider_timeout':'canvas_agent_provider_outcome_unknown',diagnostic(response,op,startedAt));
    }
    return readOperation(env,op.id);
}

async function storeRejection(env,op,code,detail) {
    const receipt=JSON.stringify({ok:false,outcome:'not_submitted',code});
    await env.DB.prepare(`UPDATE canvas_agent_model_operations SET state='rejected',receipt_json=?,error_code=?,diagnostic_json=?,completed_at=?,updated_at=?
        WHERE id=? AND state IN ('dispatching','pending','unknown') AND response_json IS NULL AND receipt_json IS NULL`)
        .bind(receipt,code,JSON.stringify(detail),nowIso(),nowIso(),op.id).run();
    logCanvasDialogueStage('rejected',{runId:op.run_id,operationId:op.id,stepId:op.step_id,code,httpStatus:detail.status,dispatchState:'rejected',receiptState:'rejected'});
}
function normalizedCallback(body,op) {
    if(op.model===CANVAS_FABLE_MODEL){
        if(!body||typeof body!=='object'||!safeId(body.id)||!['Completed','Failed'].includes(body.state)
            ||body.model!==undefined&&body.model!==op.model||body.provider!==undefined&&body.provider!=='anthropic')fail('canvas_agent_callback_invalid',400);
        if(body.state==='Failed')return {id:body.id,state:'Failed',model:op.model,error:{code:safeId(String(body.error?.code||''))}};
        const response=body.result;
        if(!response||response.error||response.type!=='message'||!safeId(response.id)||!['claude-fable-5',op.model].includes(response.model)
            ||!Array.isArray(response.content))fail('canvas_agent_callback_invalid',400);
        // Provider thinking/signatures and tool payloads are never transcript
        // context. Keep only discriminants needed to reject forbidden blocks.
        return {id:body.id,state:'Completed',model:op.model,result:{id:response.id,type:response.type,role:response.role,
            model:response.model,stop_reason:response.stop_reason,usage:response.usage,
            content:response.content.map(block=>({type:block?.type,...(block?.type==='text'?{text:block.text}:{})}))}};
    }
    if(!body||typeof body!=='object'||!safeId(body.id)||!safeId(body.state)
        ||(body.model!==undefined&&body.model!==MODEL)||(body.provider!==undefined&&!['xai','x-ai'].includes(body.provider)))fail('canvas_agent_callback_invalid',400);
    if(body.state==='Failed')return {id:body.id,state:'Failed',model:MODEL,error:{code:safeId(String(body.error?.code||''))}};
    const response=body.result;
    if(!response||typeof response!=='object'||Array.isArray(response)||response.object!=='chat.completion'
        ||!safeId(response.id)||!['grok-4.7',MODEL].includes(response.model))fail('canvas_agent_callback_invalid',400);
    // Only the provider's documented readable summary survives. Hidden or
    // encrypted reasoning and arbitrary provider fields never enter storage.
    // Previously accepted operations keep their original canonical receipt.
    // Adding summaries must not turn an old duplicate into a terminal conflict.
    const summary=op.receipt_protocol===2?canvasAgentReasoningSummary(response):null;
    return {id:body.id,state:'Completed',model:MODEL,result:{id:response.id,object:response.object,model:response.model,usage:response.usage,
        choices:Array.isArray(response.choices)?response.choices.map(choice=>({finish_reason:choice?.finish_reason,message:{role:choice?.message?.role,
            content:choice?.message?.content,refusal:choice?.message?.refusal,tool_calls:choice?.message?.tool_calls,
            ...(summary?{reasoning_content:summary.text}:{})}})):response.choices}};
}
async function storeCallback(env,op,body) {
    const checked=normalizedCallback(body,op),text=JSON.stringify(checked);
    if(new TextEncoder().encode(text).byteLength>MAX_RECEIPT_BYTES)fail('canvas_agent_callback_too_large',413);
    const current=await readOperation(env,op.id);
    if(current.provider_run_id&&current.provider_run_id!==checked.id)fail('canvas_agent_model_identity_mismatch');
    if(current.response_json){if(current.response_json!==text)fail('canvas_agent_model_terminal_conflict');return;}
    if(current.receipt_json)fail('canvas_agent_model_terminal_conflict');
    const changed=await env.DB.prepare(`UPDATE canvas_agent_model_operations SET provider_run_id=?,state='received',response_json=?,response_at=?,next_attempt_at=?,updated_at=?
        WHERE id=? AND response_json IS NULL AND receipt_json IS NULL AND (provider_run_id IS NULL OR provider_run_id=?)`)
        .bind(checked.id,text,nowIso(),nowIso(),nowIso(),op.id,checked.id).run();
    if(changed.meta?.changes!==1){const latest=await readOperation(env,op.id);if(latest?.response_json!==text)fail('canvas_agent_model_terminal_conflict');}
}
export async function handleCanvasAgentModelCallback({env,request},token) {
    const headers={'Cache-Control':'private, no-store'};
    try {
        if(request.method!=='POST')fail('method_not_allowed',405);
        const match=/^([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(token||'');if(!match)fail('canvas_agent_callback_identity',403);
        const op=await readOperation(env,match[1]);if(!op)fail('canvas_agent_callback_identity',403);
        let valid=false;for(const {secret} of getAiSaveReferenceSigningSecretCandidates(env)){
            const expected=await signature(secret,op);let diff=0;for(let i=0;i<64;i++)diff|=expected.charCodeAt(i)^match[2].charCodeAt(i);if(!diff)valid=true;
        }
        if(!valid)fail('canvas_agent_callback_identity',403);
        const body=JSON.parse(new TextDecoder().decode(await readBodyBytesLimited(request,{maxBytes:MAX_RECEIPT_BYTES})));
        await storeCallback(env,op,body);
        const stored=await readOperation(env,op.id);
        logCanvasDialogueStage('callback_observed',{runId:op.run_id,operationId:op.id,stepId:op.step_id,
            dispatchState:stored.state==='completed'?'succeeded':'dispatched',receiptState:stored.state});
        // A stored chat receipt is ready now. Do not make it wait for the
        // media-oriented next-poll delay; keep any active execution lease fenced.
        await env.DB.prepare(`UPDATE canvas_agent_runs SET next_attempt_at=? WHERE id=? AND purpose='briefing'
            AND status IN ('queued','planning','running') AND (lease_until IS NULL OR lease_until<=?)`)
            .bind(nowIso(),op.run_id,nowIso()).run();
        // Successful persistence is acknowledged even if the wake fails. Cron
        // observes received operations, including cancelled/historical runs.
        await wakeCanvasAgent(env,op.run_id);
        return Response.json({ok:true},{headers});
    } catch(error){return Response.json({ok:false,code:error.code||'canvas_agent_callback_invalid'},{status:error.status||400,headers});}
}

export async function reconcileCanvasModelOperation(env,op) {
    if(op.reconcile_attempts>=5)fail('canvas_agent_receipt_review_required');
    if(['dispatching','pending'].includes(op.state)&&op.receipt_deadline<=nowIso()){
        await markUnknown(env,op,'canvas_agent_provider_outcome_unknown',{operationId:op.id,phase:op.kind,reason:'receipt_deadline'});op=await readOperation(env,op.id);
    }
    if(op.state==='received'){
        const response=JSON.parse(op.response_json);
        if(response.state==='Failed'){
            // A terminal provider error is not evidence of zero incurred usage.
            // Retain it for review; only documented pre-inference rejection may
            // release a reservation without a billable completion receipt.
            const receipt=JSON.stringify({ok:false,outcome:'failed',code:'canvas_agent_provider_failure_review_required',providerError:response.error});
            await env.DB.prepare("UPDATE canvas_agent_model_operations SET state='unknown',receipt_json=?,error_code='canvas_agent_provider_failure_review_required',updated_at=? WHERE id=? AND state='received' AND receipt_json IS NULL")
                .bind(receipt,nowIso(),op.id).run();
            await markMemberAiUsageAttemptProviderFailed(env,op.usage_attempt_id,{dispatchToken:op.dispatch_token,code:'canvas_agent_provider_failed',message:'Provider failure requires cost reconciliation.'});
            await env.DB.prepare("UPDATE canvas_agent_runs SET status='review_required',error_code='canvas_agent_provider_failure_review_required',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND status IN ('queued','planning','running','exporting','review_required')").bind(nowIso(),op.run_id).run();
            return readOperation(env,op.id);
        }
        const result=
            await canvasModelService(env,'/internal/ai/canvas-agent/normalize',{kind:JSON.parse(op.context_json).dialogue===true?'dialogue':op.kind,requestId:op.request_id,context:JSON.parse(op.context_json),response:response.result},JSON.parse(op.caller_policy_json),op.user_id);
        if(result.requestId!==op.request_id||result.model!==op.model)fail('canvas_agent_model_identity_mismatch');
        if(!['completed','not_submitted'].includes(result.outcome))fail('canvas_agent_receipt_review_required');
        const saved=await env.DB.prepare(`UPDATE canvas_agent_model_operations SET state=?,receipt_json=?,error_code=?,completed_at=?,updated_at=?
            WHERE id=? AND state='received' AND receipt_json IS NULL AND response_json=?`)
            .bind(result.outcome==='completed'?'completed':'rejected',JSON.stringify(result),result.ok?null:result.code,nowIso(),nowIso(),op.id,op.response_json).run();
        op=await readOperation(env,op.id);if(!saved.meta?.changes&&!op.receipt_json)fail('canvas_agent_receipt_review_required');
        logCanvasDialogueStage(result.ok?'receipt_pending':'response_invalid',{runId:op.run_id,operationId:op.id,stepId:op.step_id,
            code:result.ok?null:result.code,dispatchState:'dispatched',receiptState:'completed'});
    }
    if(op.state==='rejected') {
        // Only the authenticated immutable terminal receipt permits a release.
        await env.DB.prepare(`UPDATE member_ai_usage_attempts_v2 SET provider_outcome='dispatched' WHERE id=? AND dispatch_token=?
            AND provider_outcome='unknown' AND billing_status='reserved' AND reservation_released_at IS NULL`)
            .bind(op.usage_attempt_id,op.dispatch_token).run();
        await markMemberAiUsageAttemptProviderFailed(env,op.usage_attempt_id,{dispatchToken:op.dispatch_token,confirmedOutcome:true,code:op.error_code});
        await env.DB.prepare("UPDATE canvas_agent_steps SET status='rejected',receipt_json=?,updated_at=? WHERE id=? AND status!='completed'")
            .bind(op.receipt_json,nowIso(),op.step_id).run();
    } else if(op.state==='completed') {
        const run=await env.DB.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(op.run_id).first();
        const step=await env.DB.prepare('SELECT * FROM canvas_agent_steps WHERE id=?').bind(op.step_id).first();
        const {settleStoredReceipt}=await import('./canvas-agent-planning.js');
        const stored=JSON.parse(op.receipt_json),receipt={...stored,request:JSON.parse(step.receipt_json||'{}').request,operationId:op.id};
        try {await settleStoredReceipt(env,run,step,receipt,op);} catch(error){
            if(error.code!==stored.code||stored.ok)throw error;
        }
    }
    if(['completed','rejected'].includes(op.state)) {
        const result=JSON.parse(op.receipt_json),now=nowIso();
        await env.DB.prepare(`UPDATE canvas_agent_runs SET status=?,error_code=?,next_attempt_at=?,updated_at=? WHERE id=?
            AND status='review_required' AND (error_code IN ('canvas_agent_provider_outcome_unknown','canvas_agent_provider_timeout','canvas_agent_planning_review_required')
              OR error_code='canvas_agent_local_execution_failed' AND json_extract(cause_json,'$.recovery')='receipt'
                AND json_extract(cause_json,'$.operationId')=?)
            AND expires_at>? AND EXISTS(SELECT 1 FROM canvas_projects p JOIN users u ON u.id=p.user_id
              WHERE p.id=canvas_agent_runs.project_id AND p.deleted_at IS NULL AND (p.revision=canvas_agent_runs.expected_revision OR canvas_agent_runs.purpose='briefing') AND u.status='active')
            AND NOT EXISTS(SELECT 1 FROM canvas_agent_runs newer WHERE newer.project_id=canvas_agent_runs.project_id AND newer.id!=canvas_agent_runs.id AND newer.purpose=canvas_agent_runs.purpose
              AND newer.status IN ('queued','planning','applying','running','exporting'))`)
            .bind(result.ok?(op.kind==='plan'?'planning':'running'):'blocked',result.ok?null:result.code,now,now,op.run_id,op.id,now).run();
    }
    await env.DB.prepare('UPDATE canvas_agent_model_operations SET next_attempt_at=? WHERE id=?').bind(new Date(Date.now()+60_000).toISOString(),op.id).run();
    return op;
}
export async function reconcileCanvasAgentModelOperations(env,{runId=null}={}) {
    // Historical requests have no background operation. Preserve their exact
    // reservation/dispatch evidence; classification is not a replay or refund.
    await env.DB.prepare(`UPDATE canvas_agent_runs SET status='review_required',error_code='canvas_agent_provider_outcome_unknown',lease_token=NULL,lease_until=NULL,updated_at=?
        WHERE status='blocked' AND error_code IN ('canvas_agent_provider_timeout','generation_timeout','canvas_agent_planning_review_required')
        ${runId?'AND id=?':''} AND EXISTS(SELECT 1 FROM canvas_agent_steps s JOIN member_ai_usage_attempts_v2 a ON a.id=s.usage_attempt_id
          WHERE s.run_id=canvas_agent_runs.id AND s.kind IN ('plan','evaluate') AND a.provider_outcome IN ('dispatched','unknown'))`)
        .bind(nowIso(),...(runId?[runId]:[])).run();
    const rows=(await env.DB.prepare(`SELECT o.* FROM canvas_agent_model_operations o JOIN canvas_agent_steps s ON s.id=o.step_id
        WHERE ${runId?'o.run_id=? AND o.next_attempt_at<=?':'o.next_attempt_at<=?'} AND o.reconcile_attempts<5 AND o.state!='unknown'
          AND (o.state NOT IN ('completed','rejected') OR s.status NOT IN ('completed','rejected')) ORDER BY o.next_attempt_at LIMIT 20`)
        .bind(...(runId?[runId,nowIso()]:[nowIso()])).all()).results;
    for(const row of rows){
        try {await reconcileCanvasModelOperation(env,row);} catch(error){
            const code=/^[a-z0-9_]{1,90}$/.test(error.code||'')?error.code:'canvas_agent_receipt_review_required';
            await env.DB.prepare('UPDATE canvas_agent_model_operations SET reconcile_attempts=reconcile_attempts+1,error_code=?,next_attempt_at=?,updated_at=? WHERE id=? AND reconcile_attempts<5')
                .bind(code,new Date(Date.now()+60_000).toISOString(),nowIso(),row.id).run();
            await env.DB.prepare(`UPDATE canvas_agent_runs SET status='review_required',error_code='canvas_agent_receipt_review_required',lease_token=NULL,lease_until=NULL,updated_at=?
                WHERE id=? AND status IN ('queued','planning','running','exporting')
                AND EXISTS(SELECT 1 FROM canvas_agent_model_operations WHERE id=? AND reconcile_attempts>=5)`).bind(nowIso(),row.run_id,row.id).run();
        }
    }
}
