// This service is invoked only by the operator recovery command. It has no
// member/public route. Cloudflare account authorization is supplied by that
// command; neither a conversation nor an agent tool can create an approval.
import { validateCanvasAgentPlan } from '../../../shared/canvas-agent-plan.mjs';
import { normalizeCanvasGrokUsage, canvasGrokUsageUnits } from '../../../shared/canvas-agent-metering.mjs';
import { stablePricingJson } from '../../../../js/shared/model-tariff.mjs';
import { calculateCanvasPlanningSettlementReview } from './model-tariffs.js';
import { settleStoredReceipt } from './canvas-agent-planning.js';
import { readCanvasAgentBudget } from './canvas-agent-budget.js';
import { appendCanvasAgentEvent } from './canvas-agent-progress.js';
import { nowIso, randomTokenHex, sha256Hex } from './tokens.js';

const MODEL='xai/grok-4.7', MAX_ATTEMPTS=3;
const identityKeys=['userId','projectId','runId','stepId','operationId','usageAttemptId'];
const fail=code=>{throw Object.assign(new Error(code),{code,status:409});};
const parse=value=>{try{return JSON.parse(value);}catch{fail('canvas_agent_settlement_evidence_invalid');}};
const digest=value=>sha256Hex(typeof value==='string'?value:stablePricingJson(value));
function identity(input) {
    if(!input||identityKeys.some(key=>typeof input[key]!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(input[key])))
        fail('canvas_agent_settlement_identity_invalid');
    return Object.fromEntries(identityKeys.map(key=>[key,input[key]]));
}
const reviewFor=(env,operationId)=>env.DB.prepare('SELECT * FROM canvas_agent_settlement_reviews WHERE operation_id=?').bind(operationId).first();

function verifyUsage(raw,usage) {
    // Independently validate the immutable raw envelope. Historical normalized
    // receipts did not retain every unsupported category (for example audio or
    // search); validating their totals alone would conceal those categories.
    const checked=normalizeCanvasGrokUsage(raw),storedUnits=canvasGrokUsageUnits(usage);
    if(!checked||!storedUnits||stablePricingJson(storedUnits)!==stablePricingJson(canvasGrokUsageUnits(checked))
        ||stablePricingJson(checked.provider)!==stablePricingJson(usage.provider))
        fail('canvas_agent_settlement_usage_mismatch');
}

async function evidence(env,input) {
    const ids=identity(input);
    const run=await env.DB.prepare('SELECT * FROM canvas_agent_runs WHERE id=? AND project_id=? AND user_id=?')
        .bind(ids.runId,ids.projectId,ids.userId).first();
    const step=await env.DB.prepare('SELECT * FROM canvas_agent_steps WHERE id=? AND run_id=? AND usage_attempt_id=?')
        .bind(ids.stepId,ids.runId,ids.usageAttemptId).first();
    const operation=await env.DB.prepare('SELECT * FROM canvas_agent_model_operations WHERE id=? AND run_id=? AND step_id=? AND user_id=? AND usage_attempt_id=?')
        .bind(ids.operationId,ids.runId,ids.stepId,ids.userId,ids.usageAttemptId).first();
    const usage=await env.DB.prepare('SELECT * FROM member_ai_usage_attempts_v2 WHERE id=? AND user_id=?')
        .bind(ids.usageAttemptId,ids.userId).first();
    const project=await env.DB.prepare('SELECT p.id,p.revision,p.deleted_at,u.status AS user_status FROM canvas_projects p JOIN users u ON u.id=p.user_id WHERE p.id=? AND p.user_id=?')
        .bind(ids.projectId,ids.userId).first();
    if(!run||!step||!operation||!usage||!project||run.purpose!=='production'||step.kind!=='plan'||operation.kind!=='plan'
        ||operation.model!==MODEL||operation.state!=='completed'||operation.reconcile_attempts!==5
        ||!operation.response_json||!operation.receipt_json||!operation.provider_run_id
        ||operation.dispatch_token!==usage.dispatch_token||usage.reservation_released_at
        ||!['reserved','finalized'].includes(usage.billing_status)||!['dispatched','succeeded'].includes(usage.provider_outcome))
        fail('canvas_agent_settlement_evidence_invalid');
    const previous=await reviewFor(env,operation.id);
    if(!previous&&(operation.error_code!=='generation_result_requires_credit_review'
        ||!['review_required','cancelled','taken_over','blocked','paused'].includes(run.status)
        ||!['accepted','review_required'].includes(step.status)||usage.billing_status!=='reserved'))
        fail('canvas_agent_settlement_state_changed');
    const metadata=parse(usage.metadata_json||'{}'), receipt=parse(operation.receipt_json), response=parse(operation.response_json);
    const stepInput=parse(step.input_json), context=parse(operation.context_json), request=parse(step.receipt_json||'{}').request;
    const caller=parse(operation.caller_policy_json);
    if(metadata.canvas_agent?.run_id!==run.id||metadata.canvas_agent?.step_id!==step.id
        ||metadata.canvas_agent?.project_id!==run.project_id||usage.credit_cost!==step.allocation_credits
        ||!metadata.model_tariff||metadata.model_tariff.credits!==usage.credit_cost
        ||receipt.ok!==true||receipt.outcome!=='completed'||receipt.model!==MODEL||receipt.requestId!==operation.request_id
        ||response.state!=='Completed'||response.id!==operation.provider_run_id||response.model!==MODEL
        ||response.result?.id!==receipt.responseId||!['grok-4.7',MODEL].includes(response.result?.model)
        ||response.result?.object!=='chat.completion'||response.result?.choices?.length!==1
        ||response.result.choices[0]?.finish_reason!=='stop'||response.result.choices[0]?.message?.role!=='assistant'
        ||response.result.choices[0]?.message?.refusal||response.result.choices[0]?.message?.tool_calls?.length
        ||caller.request_fingerprint!==usage.request_fingerprint||caller.model_id!==MODEL
        ||caller.source_component!=='auth-worker-canvas-agent'||caller.correlation_id!==run.id
        ||!stepInput.payload||stepInput.payload.requestId!==operation.request_id
        ||await sha256Hex(JSON.stringify(stepInput.payload))!==operation.input_digest||request?.inputDigest!==operation.input_digest)
        fail('canvas_agent_settlement_integrity_mismatch');
    const expectedContext={targetDurationSeconds:stepInput.payload.targetDurationSeconds??null,
        ...(stepInput.payload.toleranceSeconds!==undefined?{toleranceSeconds:stepInput.payload.toleranceSeconds}:{}),
        ...(stepInput.payload.durationMode!==undefined?{durationMode:stepInput.payload.durationMode}:{}),
        existingNodeIds:stepInput.payload.currentProject?.nodes?.map(node=>node.id),policy:stepInput.payload.policy};
    if(stablePricingJson(expectedContext)!==stablePricingJson(context))fail('canvas_agent_settlement_context_mismatch');
    const rawPlan=validateCanvasAgentPlan(parse(response.result.choices[0].message.content),context);
    const plan=validateCanvasAgentPlan(receipt.plan||receipt.data?.plan,context);
    if(stablePricingJson(rawPlan)!==stablePricingJson(plan))fail('canvas_agent_settlement_plan_mismatch');
    verifyUsage(response.result.usage,receipt.usage);
    const calculation=calculateCanvasPlanningSettlementReview(metadata.model_tariff,usage.credit_cost,receipt.usage);
    if(!Number.isSafeInteger(calculation.credits)||calculation.credits<1||calculation.credits>usage.credit_cost)
        fail('canvas_agent_settlement_additional_authorization_required');
    const hashes={receiptDigest:await digest(operation.receipt_json),responseDigest:await digest(operation.response_json),
        tariffDigest:await digest(JSON.stringify(metadata.model_tariff)),inputDigest:operation.input_digest};
    const budget=await readCanvasAgentBudget(env,run);
    if(budget.committedCredits>run.budget_credits)fail('canvas_agent_settlement_project_budget_exceeded');
    const ledger=(await env.DB.prepare('SELECT id,amount,ai_dispatch_token FROM member_credit_ledger WHERE user_id=? AND idempotency_key=?')
        .bind(run.user_id,usage.idempotency_key).all()).results;
    if(ledger.length>1||ledger.some(row=>row.amount!==-calculation.credits||row.ai_dispatch_token!==usage.dispatch_token)
        ||usage.billing_status==='finalized'&&ledger.length!==1)fail('canvas_agent_settlement_ledger_mismatch');
    const approval={version:1,...ids,...hashes,requestId:operation.request_id,units:calculation.units,
        diagnostics:calculation.diagnostics,reservationCredits:usage.credit_cost,settlementCredits:calculation.credits,
        projectCapCredits:previous?.project_cap_credits??run.budget_credits,budgetRevision:previous?.budget_revision??run.budget_revision,
        projectRevision:previous?.project_revision??run.expected_revision,
        briefRevision:run.brief_revision,originalReconcileAttempts:operation.reconcile_attempts};
    const reviewDigest=await digest(approval);
    if(previous&&previous.review_digest!==reviewDigest)fail('canvas_agent_settlement_review_conflict');
    const conversation=await env.DB.prepare('SELECT brief_revision,state FROM canvas_agent_conversations WHERE project_id=? AND user_id=?')
        .bind(run.project_id,run.user_id).first();
    const stopped=await env.DB.prepare("SELECT action FROM canvas_agent_controls WHERE run_id=? AND action IN ('pause','cancel','takeover') ORDER BY created_at DESC LIMIT 1").bind(run.id).first();
    let continuationBlock=null;
    if(run.status!=='review_required'||run.error_code!=='canvas_agent_receipt_review_required')continuationBlock='canvas_agent_settlement_run_not_resumable';
    if(stopped)continuationBlock='canvas_agent_stopped';
    if(run.expires_at<=nowIso())continuationBlock='canvas_agent_authorization_expired';
    if(project.deleted_at||project.user_status!=='active')continuationBlock='canvas_agent_authority_revoked';
    if(project.revision!==run.expected_revision)continuationBlock='canvas_agent_project_changed';
    if(run.brief_revision!==null&&(conversation?.brief_revision!==run.brief_revision||conversation?.state==='cancelled'))continuationBlock='canvas_agent_conversation_changed';
    return {ids,run,step,operation,usage,project,metadata,receipt,request,plan,calculation,approval,reviewDigest,budget,previous,ledger,continuationBlock};
}

function report(value,review=value.previous) {
    return {version:1,...value.ids,reviewId:review?.id||value.reviewDigest,reviewDigest:value.reviewDigest,
        receiptDigest:value.approval.receiptDigest,responseDigest:value.approval.responseDigest,tariffDigest:value.approval.tariffDigest,
        requestId:value.operation.request_id,providerOperationId:value.operation.provider_run_id,
        units:value.calculation.units,diagnostics:value.calculation.diagnostics,
        reservationCredits:value.usage.credit_cost,settlementCredits:value.calculation.credits,
        unusedReservationCredits:value.usage.credit_cost-value.calculation.credits,
        chargedCredits:value.ledger.length?value.calculation.credits:0,budget:value.budget,
        originalReconcileAttempts:value.operation.reconcile_attempts,reviewState:review?.state||'not_applied',
        recoveryAttempts:review?.attempts||0,continuationAllowed:!value.continuationBlock,continuationBlock:value.continuationBlock,
        continuationStatus:review?.state==='completed'?'resumed':review?.state==='held'?'held':'not_resumed',
        runStatus:value.run.status,stepStatus:value.step.status,observedAt:nowIso()};
}

export async function previewCanvasPlanningSettlementReview(env,input) {
    return report(await evidence(env,input));
}

export async function applyCanvasPlanningSettlementReview(env,input) {
    const value=await evidence(env,input), {run,step,operation,usage,approval}=value;
    if(input.reviewDigest!==value.reviewDigest||!/^[a-zA-Z0-9_.:/-]{1,160}$/.test(input.authorizationRef||'')
        ||!/^[a-zA-Z0-9_.:@/-]{1,100}$/.test(input.actor||''))fail('canvas_agent_settlement_approval_invalid');
    if(value.previous&& (value.previous.authorization_ref!==input.authorizationRef||value.previous.actor!==input.actor))
        fail('canvas_agent_settlement_review_conflict');
    if(['completed','held'].includes(value.previous?.state))return report(value);
    const now=nowIso(),id=value.reviewDigest;
    if(!value.previous){
        await env.DB.batch([
            env.DB.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM canvas_agent_runs r JOIN canvas_agent_steps s ON s.run_id=r.id
                JOIN canvas_agent_model_operations o ON o.step_id=s.id JOIN member_ai_usage_attempts_v2 a ON a.id=s.usage_attempt_id
                JOIN canvas_projects p ON p.id=r.project_id
                WHERE r.id=? AND r.user_id=? AND r.status=? AND r.error_code IS ? AND r.expected_revision=?
                AND r.budget_credits=? AND r.budget_revision=? AND (r.lease_until IS NULL OR r.lease_until<=?)
                AND p.revision=? AND p.deleted_at IS ? AND s.id=? AND s.status=? AND o.id=? AND o.state='completed'
                AND o.reconcile_attempts=5 AND o.error_code='generation_result_requires_credit_review'
                AND o.receipt_json=? AND o.response_json=? AND a.id=? AND a.billing_status=? AND a.provider_outcome=?
                AND a.metadata_json=? AND a.reservation_released_at IS NULL AND a.credit_cost=?
                AND r.budget_credits>=COALESCE((SELECT SUM(committed) FROM canvas_agent_step_costs c WHERE c.project_id=r.project_id),0))
                THEN 1 ELSE json_extract('[]','$[') END`)
                .bind(run.id,run.user_id,run.status,run.error_code,run.expected_revision,run.budget_credits,run.budget_revision,now,
                    value.project.revision,value.project.deleted_at,step.id,step.status,operation.id,operation.receipt_json,operation.response_json,
                    usage.id,usage.billing_status,usage.provider_outcome,usage.metadata_json,usage.credit_cost),
            env.DB.prepare(`INSERT INTO canvas_agent_settlement_reviews(id,operation_id,project_id,run_id,step_id,usage_attempt_id,user_id,
                request_id,input_digest,receipt_digest,response_digest,tariff_digest,review_digest,units_json,diagnostics_json,
                reservation_credits,settlement_credits,project_cap_credits,budget_revision,project_revision,brief_revision,
                original_reconcile_attempts,authorization_ref,actor,state,created_at,updated_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'approved',?,?) ON CONFLICT(operation_id) DO NOTHING`)
                .bind(id,operation.id,run.project_id,run.id,step.id,usage.id,run.user_id,operation.request_id,operation.input_digest,
                    approval.receiptDigest,approval.responseDigest,approval.tariffDigest,id,JSON.stringify(approval.units),JSON.stringify(approval.diagnostics),
                    usage.credit_cost,approval.settlementCredits,run.budget_credits,run.budget_revision,run.expected_revision,run.brief_revision,
                    operation.reconcile_attempts,input.authorizationRef,input.actor,now,now),
        ]);
    }
    const stored=await reviewFor(env,operation.id);
    if(stored?.review_digest!==id||stored.authorization_ref!==input.authorizationRef||stored.actor!==input.actor)
        fail('canvas_agent_settlement_review_conflict');
    const token=randomTokenHex(16), leaseUntil=new Date(Date.now()+5*60_000).toISOString();
    const claimed=await env.DB.prepare(`UPDATE canvas_agent_settlement_reviews SET attempts=attempts+1,lease_token=?,lease_until=?,updated_at=?,error_code=NULL
        WHERE id=? AND state IN ('approved','settled') AND attempts<? AND (lease_until IS NULL OR lease_until<=?) RETURNING *`)
        .bind(token,leaseUntil,now,id,MAX_ATTEMPTS,now).first();
    if(!claimed)fail('canvas_agent_settlement_recovery_busy_or_exhausted');
    await appendCanvasAgentEvent(env,run,`settlement-review:${id}:${claimed.attempts}`,'decision_summary',{
        code:'canvas_agent_settlement_review_authorized',phase:'planning',reviewId:id,attempt:claimed.attempts,
        settlementCredits:approval.settlementCredits,reservationCredits:usage.credit_cost});
    try {
        await settleStoredReceipt(env,run,step,{...value.receipt,request:value.request,operationId:operation.id},operation,
            {settlementReviewId:id,settlementReviewLeaseToken:token});
        const settled=await env.DB.prepare('SELECT billing_status FROM member_ai_usage_attempts_v2 WHERE id=? AND user_id=?').bind(usage.id,run.user_id).first();
        const completed=await env.DB.prepare("SELECT id FROM canvas_agent_steps WHERE id=? AND status='completed'").bind(step.id).first();
        if(settled?.billing_status!=='finalized'||!completed)fail('canvas_agent_settlement_incomplete');
        await env.DB.prepare("UPDATE canvas_agent_settlement_reviews SET state='settled',settled_at=COALESCE(settled_at,?),updated_at=? WHERE id=? AND lease_token=?")
            .bind(nowIso(),nowIso(),id,token).run();
        // Settlement of accepted costs is distinct from permission for future
        // work. This CAS cannot renew expiry or undo any intervening user edit.
        const resumed=await env.DB.prepare(`UPDATE canvas_agent_runs SET status='planning',phase='planning',error_code=NULL,cause_json=NULL,
            next_attempt_at=?,updated_at=?,lease_token=NULL,lease_until=NULL
            WHERE id=? AND user_id=? AND status='review_required' AND error_code='canvas_agent_receipt_review_required'
            AND expires_at>? AND expected_revision=? AND budget_credits=? AND budget_revision=?
            AND (lease_until IS NULL OR lease_until<=?)
            AND EXISTS(SELECT 1 FROM canvas_agent_settlement_reviews v WHERE v.id=? AND v.lease_token=? AND v.lease_until>? AND v.state='settled')
            AND EXISTS(SELECT 1 FROM canvas_projects p JOIN users u ON u.id=p.user_id WHERE p.id=canvas_agent_runs.project_id
                AND p.user_id=canvas_agent_runs.user_id AND p.deleted_at IS NULL AND p.revision=canvas_agent_runs.expected_revision AND u.status='active')
            AND (brief_revision IS NULL OR EXISTS(SELECT 1 FROM canvas_agent_conversations c WHERE c.project_id=canvas_agent_runs.project_id
                AND c.user_id=canvas_agent_runs.user_id AND c.brief_revision=canvas_agent_runs.brief_revision AND c.state!='cancelled'))
            AND NOT EXISTS(SELECT 1 FROM canvas_agent_controls c WHERE c.run_id=canvas_agent_runs.id AND c.action IN ('pause','cancel','takeover'))
            AND NOT EXISTS(SELECT 1 FROM canvas_agent_runs newer WHERE newer.project_id=canvas_agent_runs.project_id
                AND newer.id!=canvas_agent_runs.id AND newer.purpose='production' AND newer.status IN ('queued','planning','applying','running','exporting'))
            RETURNING id`).bind(nowIso(),nowIso(),run.id,run.user_id,nowIso(),approval.projectRevision,approval.projectCapCredits,
                approval.budgetRevision,nowIso(),id,token,nowIso()).first();
        // A lost response after the guarded resume is recoverable from the
        // existing run and completed planning step without applying another plan.
        const current=await env.DB.prepare('SELECT status FROM canvas_agent_runs WHERE id=?').bind(run.id).first();
        const continued=Boolean(resumed)||['planning','applying','running','exporting','completed'].includes(current?.status);
        await env.DB.prepare(`UPDATE canvas_agent_settlement_reviews SET state=?,continued_at=CASE WHEN ?=1 THEN COALESCE(continued_at,?) ELSE continued_at END,
            lease_token=NULL,lease_until=NULL,updated_at=?,error_code=? WHERE id=? AND lease_token=?`)
            .bind(continued?'completed':'held',continued?1:0,nowIso(),nowIso(),continued?null:'canvas_agent_settlement_continuation_held',id,token).run();
        await appendCanvasAgentEvent(env,run,`settlement-reviewed:${id}`,'decision_summary',{
            code:continued?'canvas_agent_settlement_resolved':'canvas_agent_settlement_continuation_held',phase:'planning',reviewId:id,
            settlementCredits:approval.settlementCredits,unusedReservationCredits:usage.credit_cost-approval.settlementCredits});
        return report(await evidence(env,input));
    } catch(error) {
        const code=/^[a-z0-9_]{1,90}$/.test(error.code||'')?error.code:'canvas_agent_settlement_recovery_failed';
        await env.DB.prepare('UPDATE canvas_agent_settlement_reviews SET error_code=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_token=?')
            .bind(code,nowIso(),id,token).run();
        throw error;
    }
}

// This single continuation resolves an inert unsupported music setting after
// settlement. It never alters the accepted proposal or financial review, and
// never calls inference, billing, graph mutation or queue dispatch itself.
const CONTINUATION='canvas-agent-settled-music-noop-v1';
const continuationKey=id=>`settlement-plan-continuation:${id}`;
const settingsSql="SELECT json_group_array(json_object('key',key,'value_json',value_json)) AS snapshot FROM (SELECT key,value_json FROM app_settings WHERE key LIKE 'model_area:%' OR key='model_readiness:google/gemini-omni-flash' ORDER BY key)";
async function continuationEvidence(env,input) {
    const value=await evidence(env,input),{run,step,previous:review}=value;
    if(!review||review.state!=='completed'||!review.settled_at||review.allow_new_reasoning!==0
        ||input.reviewDigest!==value.reviewDigest||step.status!=='completed'||value.usage.billing_status!=='finalized'
        ||value.ledger.length!==1)fail('canvas_agent_settlement_continuation_invalid');
    const old=await env.DB.prepare('SELECT payload_json,created_at FROM canvas_agent_events WHERE run_id=? AND event_key=?')
        .bind(run.id,continuationKey(review.id)).first();
    if(old){
        const saved=parse(old.payload_json);
        if(saved.policy!==CONTINUATION||saved.approval?.reviewDigest!==value.reviewDigest
            ||saved.continuationDigest!==await digest(saved.approval))fail('canvas_agent_settlement_continuation_conflict');
        return {value,saved,replay:true};
    }
    if(run.status!=='review_required'||run.error_code!=='canvas_agent_recovered_plan_requires_review'
        ||run.expected_revision!==review.project_revision||run.budget_credits!==review.project_cap_credits
        ||(run.budget_revision||0)!==review.budget_revision||run.brief_revision!==review.brief_revision
        ||value.continuationBlock!=='canvas_agent_settlement_run_not_resumable'
        ||run.lease_until&&run.lease_until>nowIso())fail('canvas_agent_settlement_continuation_state_changed');
    if(String(env.CANVAS_AGENT_ENABLED)!=='true'||String(env.ENABLE_GROK_4_7)!=='true'
        ||!['true','false'].includes(String(env.ENABLE_GROK_4_6)))fail('canvas_agent_settlement_runtime_unavailable');
    const newer=await env.DB.prepare(`SELECT id FROM canvas_agent_runs WHERE project_id=? AND id!=? AND purpose='production'
        AND (created_at>=? OR status IN ('queued','planning','applying','running','exporting')) LIMIT 1`)
        .bind(run.project_id,run.id,run.created_at).first();
    const otherStep=await env.DB.prepare('SELECT id FROM canvas_agent_steps WHERE run_id=? AND id!=? LIMIT 1').bind(run.id,step.id).first();
    if(newer||otherStep)fail('canvas_agent_settlement_continuation_state_changed');
    const proposal=await env.DB.prepare('SELECT * FROM canvas_agent_proposals WHERE step_id=? AND run_id=?').bind(step.id,run.id).first();
    const validation=parse(proposal?.validation_json||'null'),issues=validation?.issues;
    if(proposal?.status!=='invalid'||stablePricingJson(parse(proposal.plan_json))!==stablePricingJson(value.plan)
        ||!Array.isArray(issues)||issues.length!==1||issues[0].code!=='canvas_agent_parameter_unsupported'
        ||issues[0].modelId!=='elevenlabs/music-v2'||issues[0].field!=='config')fail('canvas_agent_settlement_continuation_issue_changed');
    const node=value.plan.nodes.find(node=>node.key===issues[0].nodeKey),audio=node?.config?.originalAudio;
    if(node?.type!=='music_generation'||node.modelId!=='elevenlabs/music-v2'||!audio||audio.enabled!==false||audio.gain!==0
        ||Object.keys(audio).sort().join(',')!=='enabled,gain')fail('canvas_agent_settlement_continuation_issue_changed');
    const settings=(await env.DB.prepare(settingsSql).first()).snapshot;
    const pricing=await env.DB.prepare('SELECT revision,factory_version,rules_json FROM model_pricing_state WHERE id=1').first();
    const {canvasAgentProject}=await import('../routes/canvas-agent.js');
    const {canvasAgentCapabilities}=await import('./canvas-agent-capabilities.js');
    const {preflightCanvasAgentGraph}=await import('./canvas-agent-graph.js');
    const view=await canvasAgentProject(env,run.user_id,run.project_id),inventory=await canvasAgentCapabilities(env);
    if(inventory.revision!==run.capability_revision||inventory.tariffRevision!==run.tariff_revision
        ||pricing?.revision!==run.tariff_revision)fail('canvas_agent_settlement_continuation_prices_changed');
    const preflight=await preflightCanvasAgentGraph(env,run,view,inventory,value.plan);
    const required={code:'canvas_agent_music_original_audio_noop',nodeKey:node.key,field:'config.originalAudio',from:{enabled:false,gain:0},to:null};
    if(!preflight.ok||stablePricingJson(preflight.repairs)!==stablePricingJson([required])
        ||!Number.isSafeInteger(preflight.estimatedCredits)||preflight.estimatedCredits>preflight.budget.remainingCredits)
        fail('canvas_agent_settlement_continuation_preflight_blocked');
    const approval={version:1,policy:CONTINUATION,reviewDigest:value.reviewDigest,...value.ids,
        receiptDigest:value.approval.receiptDigest,responseDigest:value.approval.responseDigest,inputDigest:value.approval.inputDigest,
        proposalDigest:await digest(proposal.plan_json),validationDigest:await digest(proposal.validation_json),
        derivedPlanDigest:await digest(preflight.plan),repairs:preflight.repairs,costs:preflight.costs,
        projectRevision:run.expected_revision,briefRevision:run.brief_revision,projectCapCredits:run.budget_credits,
        budgetRevision:run.budget_revision,tariffRevision:run.tariff_revision,capabilityRevision:inventory.revision,
        settingsDigest:await digest(settings),pricingDigest:await digest(pricing),committedCredits:preflight.budget.committedCredits,
        expiresAt:run.expires_at};
    return {value,proposal,settings,pricing,preflight,approval,continuationDigest:await digest(approval),replay:false};
}
function continuationReport(result) {
    const {value,saved,replay}=result;
    return {...report(value),continuationPolicy:CONTINUATION,continuationDigest:saved?.continuationDigest||result.continuationDigest,
        continuationAllowed:!replay,continuationBlock:null,continuationStatus:replay?'already_resumed':'ready',replay,
        preflight:{repairs:(saved?.approval||result.approval).repairs,costs:(saved?.approval||result.approval).costs},
        ...(saved?{continuedAt:saved.continuedAt}:{})};
}
export async function previewCanvasPlanningSettlementContinuation(env,input) {
    return continuationReport(await continuationEvidence(env,input));
}
export async function applyCanvasPlanningSettlementContinuation(env,input) {
    const result=await continuationEvidence(env,input),{value}=result,{run,step,previous:review}=value;
    const expected=result.saved?.continuationDigest||result.continuationDigest;
    if(input.continuationDigest!==expected||input.actor!==review.actor||input.authorizationRef!==review.authorization_ref)
        fail('canvas_agent_settlement_continuation_approval_invalid');
    if(result.replay)return continuationReport(result);
    const now=nowIso(),key=continuationKey(review.id),payload=JSON.stringify({policy:CONTINUATION,
        code:'canvas_agent_settled_plan_continued',phase:'planning',continuationDigest:expected,approval:result.approval,
        actor:input.actor,authorizationRef:input.authorizationRef,continuedAt:now});
    if(new TextEncoder().encode(payload).byteLength>12000)fail('canvas_agent_settlement_continuation_evidence_limit');
    const unchanged=`EXISTS(SELECT 1 FROM canvas_agent_runs r JOIN canvas_projects p ON p.id=r.project_id JOIN users u ON u.id=r.user_id
        JOIN canvas_agent_steps s ON s.run_id=r.id JOIN canvas_agent_model_operations o ON o.step_id=s.id
        JOIN member_ai_usage_attempts_v2 a ON a.id=s.usage_attempt_id JOIN canvas_agent_settlement_reviews v ON v.operation_id=o.id
        JOIN canvas_agent_proposals q ON q.step_id=s.id
        WHERE r.id=? AND r.user_id=? AND r.project_id=? AND r.status='review_required' AND r.error_code='canvas_agent_recovered_plan_requires_review'
        AND r.expected_revision=? AND r.brief_revision IS ? AND r.budget_credits=? AND r.budget_revision=? AND r.tariff_revision=?
        AND r.capability_revision=? AND r.expires_at=? AND r.expires_at>? AND (r.lease_until IS NULL OR r.lease_until<=?)
        AND p.revision=r.expected_revision AND p.deleted_at IS NULL AND p.user_id=r.user_id AND u.status='active'
        AND (r.brief_revision IS NULL OR EXISTS(SELECT 1 FROM canvas_agent_conversations c WHERE c.project_id=r.project_id
            AND c.user_id=r.user_id AND c.brief_revision=r.brief_revision AND c.state!='cancelled'))
        AND NOT EXISTS(SELECT 1 FROM canvas_agent_controls c WHERE c.run_id=r.id AND c.action IN ('pause','cancel','takeover'))
        AND NOT EXISTS(SELECT 1 FROM canvas_agent_runs n WHERE n.project_id=r.project_id AND n.id!=r.id AND n.purpose='production'
            AND (n.created_at>=r.created_at OR n.status IN ('queued','planning','applying','running','exporting')))
        AND s.id=? AND s.status='completed' AND s.receipt_json=? AND NOT EXISTS(SELECT 1 FROM canvas_agent_steps extra WHERE extra.run_id=r.id AND extra.id!=s.id)
        AND o.id=? AND o.state='completed' AND o.receipt_json=? AND o.response_json=? AND o.reconcile_attempts=5
        AND a.id=? AND a.billing_status='finalized' AND a.provider_outcome='succeeded' AND a.reservation_released_at IS NULL
        AND a.metadata_json=? AND v.id=? AND v.state='completed' AND v.allow_new_reasoning=0 AND v.review_digest=?
        AND q.status='invalid' AND q.plan_json=? AND q.validation_json=?
        AND EXISTS(SELECT 1 FROM model_pricing_state WHERE id=1 AND revision=? AND factory_version=? AND rules_json=?)
        AND (SELECT COALESCE(SUM(committed),0) FROM canvas_agent_step_costs WHERE project_id=r.project_id)=?
        AND (${settingsSql.replace(' AS snapshot','')})=?)`;
    const bindings=[run.id,run.user_id,run.project_id,run.expected_revision,run.brief_revision,run.budget_credits,run.budget_revision,
        run.tariff_revision,run.capability_revision,run.expires_at,now,now,step.id,step.receipt_json,value.operation.id,
        value.operation.receipt_json,value.operation.response_json,value.usage.id,value.usage.metadata_json,review.id,review.review_digest,
        result.proposal.plan_json,result.proposal.validation_json,result.pricing.revision,result.pricing.factory_version,result.pricing.rules_json,
        result.approval.committedCredits,result.settings];
    // A duplicate already committed event wins without touching the run again.
    // A failing guard aborts both event and status write in the D1 transaction.
    await env.DB.batch([
        env.DB.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM canvas_agent_events WHERE run_id=? AND event_key=? AND json_extract(payload_json,'$.continuationDigest')=?)
            OR ${unchanged} THEN 1 ELSE json_extract('[]','$[') END`).bind(run.id,key,expected,...bindings),
        env.DB.prepare(`UPDATE canvas_agent_runs SET status='planning',phase='planning',error_code=NULL,cause_json=NULL,
            next_attempt_at=?,updated_at=?,lease_token=NULL,lease_until=NULL WHERE id=?
            AND NOT EXISTS(SELECT 1 FROM canvas_agent_events WHERE run_id=? AND event_key=?) AND ${unchanged}`)
            .bind(now,now,run.id,run.id,key,...bindings),
        env.DB.prepare(`INSERT INTO canvas_agent_events(run_id,event_key,type,payload_json,created_at)
            VALUES(?,?,'decision_summary',?,?) ON CONFLICT(run_id,event_key) DO NOTHING`).bind(run.id,key,payload,now),
    ]);
    return continuationReport(await continuationEvidence(env,input));
}
