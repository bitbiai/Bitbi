// Operator-only interpretation of one settled, completed-invalid answer. No
// public route, provider call or debit exists here. An explicit bounded review
// may admit one existing-production correction; ordinary fenced execution owns
// that separately identified inference and its normal accounting.
import { validateCanvasAgentPlan, canvasAgentValidationDiagnostic, CANVAS_AGENT_PLAN_MAX_BYTES } from '../../../shared/canvas-agent-plan.mjs';
import { normalizeCanvasGrokUsage, canvasGrokUsageUnits } from '../../../shared/canvas-agent-metering.mjs';
import { canvasFableResponse, canvasFableUsageUnits } from '../../../shared/canvas-assistant-fable.mjs';
import { canvasAgentPolicyIdentity } from '../../../shared/canvas-agent/manifest.mjs';
import { CANVAS_FABLE_MODEL, canvasAssistantModelId } from '../../../../js/shared/canvas-assistant-models.mjs';
import { stablePricingJson } from '../../../../js/shared/model-tariff.mjs';
import { settlePinnedModelTariff } from './model-tariffs.js';
import { nowIso, sha256Hex } from './tokens.js';
import { CANVAS_PLAN_NATIVE_FORMAT_POLICY, assertCanvasPlanNativeFormatReviewSupported, deriveCanvasReviewedNativeFormat } from './canvas-agent-plan-format-review.js';

const POLICY='canvas-plan-terminal-join-v1';
const fail=code=>{throw Object.assign(new Error(code),{code,status:409});};
const parse=value=>{try{return JSON.parse(value);}catch{fail('canvas_agent_plan_interpretation_evidence_invalid');}};
const digest=value=>sha256Hex(typeof value==='string'?value:stablePricingJson(value));
const equal=(a,b)=>stablePricingJson(a)===stablePricingJson(b);
const idKeys=['userId','projectId','runId','stepId','operationId','usageAttemptId'];
function identities(input){
    if(!input||idKeys.some(key=>typeof input[key]!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(input[key])))fail('canvas_agent_plan_interpretation_identity_invalid');
    return Object.fromEntries(idKeys.map(key=>[key,input[key]]));
}
function storedPlan(operation){
    const receipt=parse(operation.receipt_json),response=parse(operation.response_json),context=parse(operation.context_json);
    if(operation.kind!=='plan'||operation.state!=='completed'||receipt.ok!==false||receipt.outcome!=='completed'
        ||receipt.code!=='canvas_agent_plan_invalid'||receipt.requestId!==operation.request_id||receipt.model!==operation.model
        ||response.state!=='Completed'||response.id!==operation.provider_run_id||response.model!==operation.model)
        fail('canvas_agent_plan_interpretation_evidence_invalid');
    let text,usage,responseId;
    if(operation.model===CANVAS_FABLE_MODEL){
        const normalized=canvasFableResponse(response.result);if(normalized.error)fail('canvas_agent_plan_interpretation_evidence_invalid');
        ({text,usage,responseId}=normalized);
    }else{
        const result=response.result,choice=result?.choices?.[0];
        if(operation.model!=='xai/grok-4.7'||result?.object!=='chat.completion'||!['grok-4.7',operation.model].includes(result.model)
            ||result.error||result.choices?.length!==1||choice.finish_reason!=='stop'||choice.message?.role!=='assistant'
            ||choice.message.refusal||choice.message.tool_calls?.length)fail('canvas_agent_plan_interpretation_evidence_invalid');
        text=choice.message.content;usage=normalizeCanvasGrokUsage(result.usage);responseId=result.id;
    }
    if(typeof text!=='string'||new TextEncoder().encode(text).length>CANVAS_AGENT_PLAN_MAX_BYTES||!usage||!equal(usage,receipt.usage)
        ||responseId!==receipt.responseId||(context.model||'xai/grok-4.7')!==operation.model)fail('canvas_agent_plan_interpretation_evidence_invalid');
    return {raw:parse(text),context,receipt,response,usage};
}
export function diagnoseStoredCanvasPlan(operation){
    try{const {raw,context}=storedPlan(operation);try{validateCanvasAgentPlan(raw,context);}catch(error){return canvasAgentValidationDiagnostic(error.validationDiagnostic);}}
    catch{ /* No verified diagnosis from missing or contradictory evidence. */ }
    return null;
}
export function deriveCanvasTerminalTransition(raw,context){
    let diagnostic;
    try{validateCanvasAgentPlan(raw,context);}catch(error){diagnostic=canvasAgentValidationDiagnostic(error.validationDiagnostic);}
    if(diagnostic?.category!=='semantic'||diagnostic.reason!=='terminal_transition')fail('canvas_agent_plan_interpretation_not_applicable');
    const candidate=structuredClone(raw),index=candidate.assembly.clips.length-1,from=candidate.assembly.clips[index].transition;
    candidate.assembly.clips[index].transition={preset:'none'};
    return {plan:validateCanvasAgentPlan(candidate,context),diagnostic,change:{path:`plan.assembly.clips[${index}].transition`,from,to:{preset:'none'}}};
}
async function originalEvidence(env,input,{derive=true,formatApproval=null}={}){
    const ids=identities(input);
    const run=await env.DB.prepare('SELECT * FROM canvas_agent_runs WHERE id=? AND project_id=? AND user_id=?').bind(ids.runId,ids.projectId,ids.userId).first();
    const step=await env.DB.prepare('SELECT * FROM canvas_agent_steps WHERE id=? AND run_id=? AND usage_attempt_id=?').bind(ids.stepId,ids.runId,ids.usageAttemptId).first();
    const operation=await env.DB.prepare('SELECT * FROM canvas_agent_model_operations WHERE id=? AND step_id=? AND run_id=? AND user_id=? AND usage_attempt_id=?')
        .bind(ids.operationId,ids.stepId,ids.runId,ids.userId,ids.usageAttemptId).first();
    const usage=await env.DB.prepare('SELECT * FROM member_ai_usage_attempts_v2 WHERE id=? AND user_id=?').bind(ids.usageAttemptId,ids.userId).first();
    const project=await env.DB.prepare('SELECT p.*,u.status AS user_status FROM canvas_projects p JOIN users u ON u.id=p.user_id WHERE p.id=? AND p.user_id=?')
        .bind(ids.projectId,ids.userId).first();
    if(!run||!step||!operation||!usage||!project||run.purpose!=='production'||step.kind!=='plan'||step.status!=='rejected'
        ||usage.billing_status!=='finalized'||usage.provider_outcome!=='succeeded'||usage.reservation_released_at
        ||operation.dispatch_token!==usage.dispatch_token||canvasAssistantModelId(run.model_id)!==operation.model
        ||operation.reconcile_attempts>=5||step.allocation_credits!==usage.credit_cost)fail('canvas_agent_plan_interpretation_evidence_invalid');
    const saved=storedPlan(operation),derived=derive?deriveCanvasTerminalTransition(saved.raw,saved.context):null,metadata=parse(usage.metadata_json),stepInput=parse(step.input_json),stepReceipt=parse(step.receipt_json);
    const responseDigest=await digest(operation.response_json);
    const format=derived&&formatApproval?deriveCanvasReviewedNativeFormat(derived.plan,formatApproval,responseDigest):null;
    if(format)derived.plan=validateCanvasAgentPlan(format.plan,saved.context);
    const caller=parse(operation.caller_policy_json),payload=stepInput.payload;
    if(!payload||payload.requestId!==operation.request_id||payload.model!==operation.model||await sha256Hex(JSON.stringify(payload))!==operation.input_digest
        ||stepReceipt.request?.inputDigest!==operation.input_digest||stepReceipt.operationId!==operation.id
        ||!equal((({request,operationId,...rest})=>rest)(stepReceipt),saved.receipt)
        ||metadata.canvas_agent?.run_id!==run.id||metadata.canvas_agent?.step_id!==step.id||metadata.canvas_agent?.project_id!==run.project_id
        ||caller.request_fingerprint!==usage.request_fingerprint||caller.model_id!==operation.model||caller.correlation_id!==run.id
        ||caller.source_component!=='auth-worker-canvas-agent'||!metadata.model_tariff)fail('canvas_agent_plan_interpretation_integrity_mismatch');
    const expectedPolicy=await canvasAgentPolicyIdentity(payload.repair?'correction':'planning',payload.policy?.version);
    if(!equal(payload.policy,expectedPolicy)||!equal(saved.context.policy,expectedPolicy)||!equal(parse(run.policy_json),await canvasAgentPolicyIdentity('planning',expectedPolicy.version))
        ||!equal(saved.context.existingNodeIds,payload.currentProject?.nodes?.map(node=>node.id))
        ||saved.context.targetDurationSeconds!==(payload.targetDurationSeconds??null)||saved.context.toleranceSeconds!==payload.toleranceSeconds
        ||saved.context.durationMode!==payload.durationMode)fail('canvas_agent_plan_interpretation_context_mismatch');
    const units=operation.model===CANVAS_FABLE_MODEL?canvasFableUsageUnits(saved.usage):canvasGrokUsageUnits(saved.usage);
    const chargedCredits=settlePinnedModelTariff(metadata.model_tariff,usage.credit_cost,units);
    const ledger=(await env.DB.prepare('SELECT id,amount,ai_dispatch_token FROM member_credit_ledger WHERE user_id=? AND idempotency_key=?')
        .bind(run.user_id,usage.idempotency_key).all()).results;
    if(ledger.length!==1||ledger[0].amount!==-chargedCredits||ledger[0].ai_dispatch_token!==operation.dispatch_token)
        fail('canvas_agent_plan_interpretation_billing_mismatch');
    const proposal=await env.DB.prepare('SELECT * FROM canvas_agent_proposals WHERE step_id=? AND run_id=?').bind(step.id,run.id).first();
    const binding={version:format?2:1,policy:format?CANVAS_PLAN_NATIVE_FORMAT_POLICY:POLICY,...ids,modelId:operation.model,requestId:operation.request_id,inputDigest:operation.input_digest,
        responseDigest,receiptDigest:await digest(operation.receipt_json),contextDigest:await digest(operation.context_json),
        stepReceiptDigest:await digest(step.receipt_json),tariffDigest:await digest(metadata.model_tariff),...(derived?{planDigest:await digest(derived.plan),diagnostic:derived.diagnostic,change:derived.change}:{}),chargedCredits,originalReconcileAttempts:operation.reconcile_attempts};
    if(format)Object.assign(binding,{formatApproval:format.approval,formatChanges:format.changes});
    return {ids,run,step,operation,usage,project,proposal,binding,plan:derived?.plan,rawPlan:saved.raw,diagnostic:diagnoseStoredCanvasPlan(operation),ledger};
}
function storedInterpretation(value){
    if(!value.proposal?.interpretation_json)return null;
    const stored=parse(value.proposal.interpretation_json);
    if(!equal(stored.binding,value.binding)||stored.allowNewReasoning!==(stored.authority?.allowNewReasoning?1:0)||stored.reviewDigest!==undefined&&typeof stored.reviewDigest!=='string'
        ||!equal(parse(value.proposal.plan_json),value.plan))fail('canvas_agent_plan_interpretation_conflict');
    return stored;
}
export async function readValidCanvasPlanInterpretation(env,run,step){
    const proposal=await env.DB.prepare('SELECT interpretation_json FROM canvas_agent_proposals WHERE step_id=? AND run_id=?').bind(step.id,run.id).first();
    if(!proposal?.interpretation_json)return null;
    const stored=parse(proposal.interpretation_json),value=await originalEvidence(env,stored.binding,{formatApproval:stored.binding.version===2?stored.binding.formatApproval:null});
    const checked=storedInterpretation(value);
    if(!checked||checked.reviewDigest!==await digest({binding:checked.binding,authority:checked.authority})
        ||run.id!==value.run.id||step.id!==value.step.id)fail('canvas_agent_plan_interpretation_conflict');
    return value.plan;
}
async function inheritedCorrectionReview(env,value,conversation){
    const {run,step}=value,parent=await env.DB.prepare("SELECT * FROM canvas_agent_proposals WHERE run_id=? AND json_extract(interpretation_json,'$.authority.strategy')='bounded-correction' LIMIT 1").bind(run.id).first();
    if(!parent||parent.step_id===step.id)return null;
    const record=parse(parent.interpretation_json),{assertCanvasPlanReviewCurrent,allowsReviewedCanvasCorrection}=await import('./canvas-agent-plan-correction-review.js');
    const authority=await assertCanvasPlanReviewCurrent(env,run,record);
    if(!await allowsReviewedCanvasCorrection(env,run,record,{stepId:step.id}))fail('canvas_agent_plan_interpretation_authority_changed');
    const original=await originalEvidence(env,record.binding),verified=storedInterpretation(original);
    if(!verified||verified.reviewDigest!==record.reviewDigest||original.step.id!==parent.step_id)
        fail('canvas_agent_plan_interpretation_conflict');
    // Inherit only the exact reviewed result's brief, never its right to make
    // another request. Both the immutable review and current brief are fenced
    // again in the same batch that persists this separate interpretation.
    return {authority:{effectiveBriefRevision:authority.effectiveBriefRevision,effectiveBriefDigest:authority.effectiveBriefDigest,
        inheritedReview:{stepId:parent.step_id,reviewDigest:record.reviewDigest,correctionStepId:step.id}},
        guard:env.DB.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM canvas_agent_proposals p
          JOIN canvas_agent_runs r ON r.id=p.run_id JOIN canvas_agent_conversations c ON c.project_id=r.project_id AND c.user_id=r.user_id
          WHERE p.step_id=? AND p.run_id=? AND p.interpretation_json=? AND r.repair_attempts=1
          AND c.state='active' AND c.brief_revision=? AND c.brief_json=?) THEN 1 ELSE json_extract('[]','$[') END`)
            .bind(parent.step_id,run.id,parent.interpretation_json,authority.effectiveBriefRevision,conversation.brief_json)};
}
async function evidence(env,input,activeRun=null){
    if(input.strategy!==undefined&&!['bounded-correction','reviewed-correction-result'].includes(input.strategy)||activeRun&&input.strategy)fail('canvas_agent_plan_interpretation_approval_invalid');
    if(input.formatApproval!==undefined&&(activeRun||input.strategy!=='reviewed-correction-result'))fail('canvas_agent_plan_format_approval_invalid');
    const value=await originalEvidence(env,input,{formatApproval:input.formatApproval}),stored=storedInterpretation(value);
    if(stored){
        if(stored.reviewDigest!==await digest({binding:stored.binding,authority:stored.authority}))fail('canvas_agent_plan_interpretation_conflict');
        return {...value,stored,reviewDigest:stored.reviewDigest,replay:true};
    }
    const {run,step,project}=value,now=nowIso();
    const permittedState=activeRun?run.status==='planning'&&run.lease_token===activeRun.lease_token&&run.lease_until>now:run.status==='blocked'
        &&(run.error_code==='canvas_agent_plan_invalid'||input.strategy==='reviewed-correction-result'&&run.error_code==='canvas_agent_plan_interpretation_authority_changed');
    if(!permittedState||run.phase!=='planning'||run.expires_at<=now
        ||!activeRun&&run.lease_until&&run.lease_until>now||project.deleted_at||project.user_status!=='active'||project.revision!==run.expected_revision
        ||String(env.CANVAS_AGENT_ENABLED)!=='true')fail('canvas_agent_plan_interpretation_authority_changed');
    const conversation=await env.DB.prepare('SELECT brief_revision,brief_json,state FROM canvas_agent_conversations WHERE project_id=? AND user_id=?').bind(run.project_id,run.user_id).first();
    const reviewed=input.strategy==='bounded-correction'
        ?await (await import('./canvas-agent-plan-correction-review.js')).reviewCanvasPlanCorrectionAuthority(env,value,conversation,input):null;
    const inherited=activeRun||input.strategy==='reviewed-correction-result'?await inheritedCorrectionReview(env,value,conversation):null;
    if(input.strategy==='reviewed-correction-result'&&!inherited)fail('canvas_agent_plan_interpretation_authority_changed');
    const stopped=await env.DB.prepare("SELECT run_id FROM canvas_agent_controls WHERE run_id=? AND action IN ('pause','cancel','takeover') LIMIT 1").bind(run.id).first();
    const latest=await env.DB.prepare("SELECT id FROM canvas_agent_steps WHERE run_id=? AND kind='plan' ORDER BY rowid DESC LIMIT 1").bind(run.id).first();
    const competing=await env.DB.prepare("SELECT id FROM canvas_agent_runs WHERE project_id=? AND id!=? AND purpose='production' AND status IN ('queued','planning','applying','running','exporting') LIMIT 1").bind(run.project_id,run.id).first();
    if(stopped||competing||latest?.id!==step.id||run.brief_revision!==null&&(!reviewed&&!inherited&&conversation?.brief_revision!==run.brief_revision||conversation?.state==='cancelled'))
        fail('canvas_agent_plan_interpretation_authority_changed');
    if(value.proposal)fail('canvas_agent_plan_interpretation_conflict');
    if(input.formatApproval)assertCanvasPlanNativeFormatReviewSupported();
    const {canvasAgentProject}=await import('../routes/canvas-agent.js'),{canvasAgentCapabilities}=await import('./canvas-agent-capabilities.js');
    const {preflightCanvasAgentGraph}=await import('./canvas-agent-graph.js');
    const view=await canvasAgentProject(env,run.user_id,run.project_id),inventory=await canvasAgentCapabilities(env);
    if(inventory.revision!==run.capability_revision||inventory.tariffRevision!==run.tariff_revision)fail('canvas_agent_plan_interpretation_capabilities_changed');
    const preflight=await preflightCanvasAgentGraph(env,run,view,inventory,value.plan,parse(step.input_json).repairNodes||null);
    const correction=reviewed?await (await import('./canvas-agent-plan-correction-review.js')).quoteCanvasPlanReviewedCorrection(env,value,view,inventory,preflight,reviewed.authority):null;
    if(!correction&&(!preflight.ok||preflight.estimatedCredits>preflight.budget.remainingCredits))
        throw Object.assign(new Error('canvas_agent_plan_interpretation_preflight_blocked'),{code:'canvas_agent_plan_interpretation_preflight_blocked',status:409,issues:preflight.issues||[]});
    const authority={projectRevision:run.expected_revision,briefRevision:run.brief_revision,budgetRevision:run.budget_revision,
        capCredits:run.budget_credits,tariffRevision:run.tariff_revision,capabilityRevision:run.capability_revision,
        expiresAt:run.expires_at,committedCredits:(correction?.quotedBudget||preflight.budget).committedCredits,estimatedMediaCredits:preflight.estimatedCredits??null,
        allowNewReasoning:Boolean(activeRun)&&!inherited,...(correction||{}),...(inherited?.authority||{})};
    return {...value,preflight,authority,correctionGuard:reviewed?.guard||inherited?.guard,reviewDigest:await digest({binding:value.binding,authority}),replay:false};
}
function report(value){return {version:value.binding.version,policy:value.binding.policy,...value.ids,reviewDigest:value.reviewDigest,replay:value.replay,
    diagnostic:value.binding.diagnostic,change:value.binding.change,chargedCredits:value.binding.chargedCredits,
    ...(value.binding.formatApproval?{formatApproval:value.binding.formatApproval,formatChanges:value.binding.formatChanges}:{}),
    newInferenceCalls:0,newCharges:0,planNodes:value.plan.nodes.length,assemblyClips:value.plan.assembly.clips.length,
    ...(value.authority||value.stored?.authority?{authority:value.authority||value.stored.authority}:{}),runStatus:value.run.status,observedAt:nowIso()};}
export async function previewCanvasPlanInterpretation(env,input){return report(await evidence(env,input));}
export async function applyCanvasPlanInterpretation(env,input){return applyInterpretation(env,input);}
async function applyInterpretation(env,input,activeRun=null){
    const value=await evidence(env,input,activeRun),{run,step,operation,usage}=value;
    if(input.reviewDigest!==value.reviewDigest||!/^[A-Za-z0-9_.:/-]{1,160}$/.test(input.authorizationRef||'')
        ||!/^[A-Za-z0-9_.:@/-]{1,100}$/.test(input.actor||''))fail('canvas_agent_plan_interpretation_approval_invalid');
    if(value.replay){if(value.stored.actor!==input.actor||value.stored.authorizationRef!==input.authorizationRef)fail('canvas_agent_plan_interpretation_conflict');return report(value);}
    const now=nowIso(),record={binding:value.binding,authority:value.authority,reviewDigest:value.reviewDigest,allowNewReasoning:value.authority.allowNewReasoning?1:0,actor:input.actor,authorizationRef:input.authorizationRef,createdAt:now};
    const prior=`EXISTS(SELECT 1 FROM canvas_agent_proposals WHERE step_id=? AND run_id=? AND json_extract(interpretation_json,'$.reviewDigest')=?
      AND json_extract(interpretation_json,'$.actor')=? AND json_extract(interpretation_json,'$.authorizationRef')=?)`;
    const priorArgs=[step.id,run.id,value.reviewDigest,input.actor,input.authorizationRef];
    await env.DB.batch([
        env.DB.prepare(`SELECT CASE WHEN ${prior} OR EXISTS(SELECT 1 FROM canvas_agent_runs r JOIN canvas_projects p ON p.id=r.project_id JOIN users u ON u.id=r.user_id
          WHERE (r.id=? AND r.user_id=? AND r.project_id=? AND r.status=? AND r.error_code IS ? AND r.phase='planning'
          AND r.expected_revision=? AND r.brief_revision IS ? AND r.budget_revision=? AND r.budget_credits=? AND r.expires_at=? AND r.expires_at>?)
          AND ((?=0 AND (r.lease_until IS NULL OR r.lease_until<=?)) OR (?=1 AND r.lease_token=? AND r.lease_until>?)) AND (p.revision=r.expected_revision AND p.deleted_at IS NULL AND p.user_id=r.user_id AND u.status='active')
          AND NOT EXISTS(SELECT 1 FROM canvas_agent_controls WHERE run_id=r.id AND action IN ('pause','cancel','takeover'))
          AND NOT EXISTS(SELECT 1 FROM canvas_agent_runs n WHERE n.project_id=r.project_id AND n.id!=r.id AND n.purpose='production' AND n.status IN ('queued','planning','applying','running','exporting'))
          AND (r.brief_revision IS NULL OR EXISTS(SELECT 1 FROM canvas_agent_conversations c WHERE c.project_id=r.project_id AND c.user_id=r.user_id AND c.brief_revision=? AND c.state!='cancelled')))
          THEN 1 ELSE json_extract('[]','$[') END`).bind(...priorArgs,run.id,run.user_id,run.project_id,run.status,run.error_code,run.expected_revision,run.brief_revision,run.budget_revision,run.budget_credits,run.expires_at,now,activeRun?1:0,now,activeRun?1:0,activeRun?.lease_token||null,now,value.authority.effectiveBriefRevision??run.brief_revision),
        ...(value.correctionGuard?[value.correctionGuard]:[]),
        env.DB.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM canvas_agent_steps s JOIN canvas_agent_model_operations o ON o.step_id=s.id JOIN member_ai_usage_attempts_v2 a ON a.id=s.usage_attempt_id
          WHERE s.id=? AND s.run_id=? AND s.status='rejected' AND s.input_json=? AND s.receipt_json=? AND s.id=(SELECT id FROM canvas_agent_steps WHERE run_id=s.run_id AND kind='plan' ORDER BY rowid DESC LIMIT 1)
          AND (o.id=? AND o.state='completed' AND o.response_json=? AND o.receipt_json=? AND o.context_json=? AND o.input_digest=? AND o.reconcile_attempts=?)
          AND (a.id=? AND a.billing_status='finalized' AND a.provider_outcome='succeeded' AND a.reservation_released_at IS NULL AND a.metadata_json=? AND a.dispatch_token=o.dispatch_token)
          AND EXISTS(SELECT 1 FROM member_credit_ledger l WHERE l.id=? AND l.user_id=? AND l.amount=? AND l.ai_dispatch_token=o.dispatch_token))
          THEN 1 ELSE json_extract('[]','$[') END`).bind(step.id,run.id,step.input_json,step.receipt_json,operation.id,operation.response_json,operation.receipt_json,operation.context_json,
            operation.input_digest,operation.reconcile_attempts,usage.id,usage.metadata_json,value.ledger[0].id,run.user_id,-value.binding.chargedCredits),
        env.DB.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM model_pricing_state WHERE id=1 AND revision=?)
          AND (SELECT COALESCE(SUM(committed),0) FROM canvas_agent_step_costs WHERE project_id=?)=? THEN 1 ELSE json_extract('[]','$[') END`)
            .bind(run.tariff_revision,run.project_id,value.authority.committedCredits),
        env.DB.prepare(`INSERT INTO canvas_agent_proposals(step_id,run_id,plan_json,status,validation_json,interpretation_json,created_at,updated_at)
          VALUES(?,?,?,'proposed',?,?,?,?) ON CONFLICT(step_id) DO NOTHING`).bind(step.id,run.id,JSON.stringify(value.plan),JSON.stringify({issues:value.preflight.issues,repairs:[value.binding.change,...(value.binding.formatChanges||[])]}),JSON.stringify(record),now,now),
        env.DB.prepare(`SELECT CASE WHEN ${prior} THEN 1 ELSE json_extract('[]','$[') END`).bind(...priorArgs),
        env.DB.prepare(`UPDATE canvas_agent_runs SET status='planning',phase='planning',error_code=NULL,cause_json=NULL,next_attempt_at=?,updated_at=?
          WHERE id=? AND status='blocked' AND error_code=?`).bind(now,now,run.id,run.error_code),
        env.DB.prepare(`INSERT INTO canvas_agent_events(run_id,event_key,type,payload_json,created_at) VALUES(?,?,'decision_summary',?,?) ON CONFLICT(run_id,event_key) DO NOTHING`)
          .bind(run.id,`plan-interpretation:${step.id}`,JSON.stringify({code:'canvas_agent_saved_plan_interpreted',phase:'planning',policy:value.binding.policy,reviewDigest:value.reviewDigest,
            operationId:operation.id,stepId:step.id,diagnostic:value.binding.diagnostic,change:value.binding.change,newInferenceCalls:0,newCharges:0,
            ...(value.binding.formatApproval?{formatApprovalRef:value.binding.formatApproval.approvalRef,formatChanges:value.binding.formatChanges}:{}),
            ...(value.authority.boundedCorrection?{authorizedCorrectionStepId:value.authority.boundedCorrection.stepId,correctionCeilingCredits:value.authority.boundedCorrection.ceilingCredits}:{} )}),now),
    ]);
    if(!activeRun)await (await import('./canvas-agent-store.js')).wakeCanvasAgent(env,run.id);
    return report(await evidence(env,input,activeRun));
}

// Execution supplies a currently fenced production lease. This is not a new
// planning request and cannot make a stopped run active.
export async function persistCanvasPlanInterpretation(env,run,step){
    const operation=await env.DB.prepare('SELECT id,usage_attempt_id FROM canvas_agent_model_operations WHERE step_id=? AND run_id=?').bind(step.id,run.id).first();
    if(!operation)return null;
    const input={userId:run.user_id,projectId:run.project_id,runId:run.id,stepId:step.id,operationId:operation.id,usageAttemptId:operation.usage_attempt_id};
    const value=await evidence(env,input,run);
    await applyInterpretation(env,{...input,reviewDigest:value.reviewDigest,authorizationRef:`production:${run.id}`,actor:'canvas-production'},run);
    return value.plan;
}
export async function readCanvasCompletedInvalidPlan(env,run,step){
    const operation=await env.DB.prepare('SELECT id,usage_attempt_id FROM canvas_agent_model_operations WHERE step_id=? AND run_id=?').bind(step.id,run.id).first();
    if(!operation)return null;
    const value=await originalEvidence(env,{userId:run.user_id,projectId:run.project_id,runId:run.id,stepId:step.id,operationId:operation.id,usageAttemptId:operation.usage_attempt_id},{derive:false});
    if(!value.diagnostic||!['schema','semantic'].includes(value.diagnostic.category)||!value.rawPlan||typeof value.rawPlan!=='object'||Array.isArray(value.rawPlan))return null;
    return {plan:value.rawPlan,diagnostic:value.diagnostic,operationId:operation.id};
}
