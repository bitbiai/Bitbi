// One operator-reviewed correction of a retained invalid plan. This is not a
// general brief rebase, a new spending allowance or a replacement production.
import {sha256Hex} from './tokens.js';
import {stablePricingJson} from '../../../../js/shared/model-tariff.mjs';
import {validateCanvasAgentDialogueReply} from '../../../shared/canvas-agent-dialogue.mjs';
import {canvasAgentPolicyIdentity} from '../../../shared/canvas-agent/manifest.mjs';
import {quoteCanvasAgentCorrection} from './canvas-agent-repair.js';

const fail=()=>{throw Object.assign(new Error('canvas_agent_plan_correction_review_invalid'),{code:'canvas_agent_plan_correction_review_invalid',status:409});};
const parse=value=>{try{return JSON.parse(value);}catch{fail();}};
const equal=(a,b)=>stablePricingJson(a)===stablePricingJson(b);
const digest=value=>sha256Hex(typeof value==='string'?value:stablePricingJson(value));
export async function reviewCanvasPlanCorrectionAuthority(env,value,conversation,input){
  const {run}=value;
  if(input.strategy!=='bounded-correction'||!Number.isSafeInteger(input.expectedBriefRevision)
    ||input.expectedBriefRevision!==conversation?.brief_revision||conversation?.state!=='active'
    ||!Number.isSafeInteger(run.brief_revision)||conversation.brief_revision!==run.brief_revision+1
    ||run.repair_attempts!==0||run.rounds!==0||typeof input.sourceTurnId!=='string'||typeof input.intentId!=='string')fail();
  const intent=await env.DB.prepare("SELECT * FROM canvas_agent_start_intents WHERE id=? AND run_id=? AND project_id=? AND user_id=? AND state='started'")
    .bind(input.intentId,run.id,run.project_id,run.user_id).first();
  if(!intent)fail();
  const scope=parse(intent.scope_json),approval=parse(intent.authorization_json),quote=parse(intent.quote_json);
  if(approval.scope!==intent.scope_json||approval.capCredits!==run.budget_credits||approval.tariffRevision!==run.tariff_revision
    ||quote.tariffRevision!==run.tariff_revision||quote.scope?.includesPlanningAttempts!==3||scope.briefRevision!==run.brief_revision
    ||scope.projectRevision!==run.expected_revision||scope.modelId!==run.model_id||scope.brief!==parse(run.input_json).brief
    ||!Number.isSafeInteger(quote.planningCredits)||quote.planningCredits<1)fail();
  const turn=await env.DB.prepare(`SELECT t.*,r.user_id,r.model_id,r.purpose,r.status AS run_status,s.id AS step_id,s.input_json AS step_input,s.receipt_json AS step_receipt,
    s.status AS step_status,s.usage_attempt_id FROM canvas_agent_turns t JOIN canvas_agent_runs r ON r.id=t.run_id
    JOIN canvas_agent_steps s ON s.run_id=r.id AND s.step_key='dialogue'
    WHERE t.id=? AND t.project_id=? AND r.user_id=?`).bind(input.sourceTurnId,run.project_id,run.user_id).first();
  if(!turn||turn.state!=='completed'||turn.run_status!=='completed'||turn.purpose!=='briefing'||turn.step_status!=='completed')fail();
  const operation=await env.DB.prepare("SELECT * FROM canvas_agent_model_operations WHERE step_id=? AND run_id=? AND user_id=? AND state='completed'")
    .bind(turn.step_id,turn.run_id,run.user_id).first();
  const usage=await env.DB.prepare("SELECT * FROM member_ai_usage_attempts_v2 WHERE id=? AND user_id=? AND billing_status='finalized' AND provider_outcome='succeeded' AND reservation_released_at IS NULL")
    .bind(turn.usage_attempt_id,run.user_id).first();
  if(!operation||!usage||!operation.response_json||operation.kind!=='plan'||operation.usage_attempt_id!==usage.id||operation.dispatch_token!==usage.dispatch_token)fail();
  const receipt=parse(operation.receipt_json),stepReceipt=parse(turn.step_receipt),payload=parse(turn.step_input).payload,context=parse(operation.context_json);
  if(!receipt.ok||receipt.outcome!=='completed'||receipt.model!==operation.model||receipt.requestId!==operation.request_id
    ||payload.requestId!==operation.request_id||payload.model!==operation.model||payload.message.id!==turn.id||payload.message.text!==turn.user_text
    ||await sha256Hex(JSON.stringify(payload))!==operation.input_digest||stepReceipt.request?.inputDigest!==operation.input_digest
    ||stepReceipt.operationId!==operation.id||!equal((({request,operationId,...rest})=>rest)(stepReceipt),receipt)
    ||context.dialogue!==true||!equal(context.policy,payload.policy)
    ||!equal(payload.policy,await canvasAgentPolicyIdentity('briefing',payload.policy?.version)))fail();
  const ledger=await env.DB.prepare('SELECT amount,ai_dispatch_token FROM member_credit_ledger WHERE user_id=? AND idempotency_key=?')
    .bind(run.user_id,usage.idempotency_key).first();
  if(!ledger||ledger.amount>=0||ledger.ai_dispatch_token!==operation.dispatch_token)fail();
  const reply=validateCanvasAgentDialogueReply(receipt.dialogue||receipt.data?.dialogue,
    {messageId:turn.id,dialogueVersion:payload.version,projectRevision:payload.projectRevision});
  if(reply.scope!=='canvas'||reply.intent!=='ready'||reply.updates.length!==1||reply.questions.length
    ||reply.actions?.length!==1||reply.actions[0].type!=='start_now'||reply.updates[0].field!=='latestInstruction'
    ||!['user_stated','corrected'].includes(reply.updates[0].provenance))fail();
  // A model's typed start action cannot prove that free text contains no new
  // creative instruction. Only this operator-only, exact-content review may
  // classify the observed delta; callers cannot infer it from unchanged fields.
  const instructionReview=input.instructionReview;
  if(instructionReview?.classification!=='operational-only'
    ||instructionReview.sourceMessageDigest!==await digest(turn.user_text)
    ||instructionReview.proposedInstructionDigest!==await digest(reply.updates[0].value))fail();
  const action=await env.DB.prepare('SELECT * FROM canvas_agent_action_receipts WHERE turn_id=? AND project_id=? AND user_id=? ORDER BY ordinal LIMIT 1')
    .bind(turn.id,run.project_id,run.user_id).first();
  if(!action||action.state!=='failed'||parse(action.result_json).code!=='canvas_agent_immediate_intent_required'
    ||!equal(parse(action.input_json).action,reply.actions[0]))fail();
  const old=payload.brief,current=parse(conversation.brief_json);
  if(payload.briefRevision!==run.brief_revision||old.revision!==run.brief_revision||!Array.isArray(scope.creativeInstructions))fail();
  const {productionBrief}=await import('./canvas-agent-conversation.js');
  const rebuilt=[productionBrief({brief_json:JSON.stringify(old)}),...scope.creativeInstructions.map((entry,index)=>
    `${index===scope.creativeInstructions.length-1?'Latest':'Earlier'} saved user instruction (untrusted creative data):\n${entry.text}`)].filter(Boolean).join('\n\n');
  if(rebuilt!==scope.brief)fail();
  const expected=structuredClone(old),update=reply.updates[0];
  expected.revision=old.revision+1;
  expected.fields.latestInstruction={value:update.value,provenance:update.provenance,sourceMessageId:turn.id,revision:expected.revision};
  if(!equal(expected,current)||current.fields.latestInstruction.sourceMessageId!==turn.id)fail();
  const pending=await env.DB.prepare(`SELECT o.id FROM canvas_agent_model_operations o JOIN canvas_agent_runs r ON r.id=o.run_id
    WHERE r.project_id=? AND o.state IN ('dispatching','pending','unknown','received') LIMIT 1`).bind(run.project_id).first();
  if(pending)fail();
  const authority={strategy:'bounded-correction',originalBriefRevision:run.brief_revision,effectiveBriefRevision:current.revision,
    originalBriefDigest:await digest(old),effectiveBriefDigest:await digest(conversation.brief_json),sourceTurnId:turn.id,
    dialogueOperationId:operation.id,dialogueReceiptDigest:await digest(operation.receipt_json),dialogueInputDigest:operation.input_digest,
    sourceActionId:action.id,sourceActionDigest:await digest({input:action.input_json,result:action.result_json}),
    instructionReview:{classification:'operational-only',sourceMessageDigest:instructionReview.sourceMessageDigest,
      proposedInstructionDigest:instructionReview.proposedInstructionDigest},
    originalIntentId:intent.id,intentDigest:await digest({scope:intent.scope_json,quote:intent.quote_json,approval:intent.authorization_json}),
    originalPlanningAttempts:quote.scope.includesPlanningAttempts,originalPlanningCeiling:quote.planningCredits};
  const guard=env.DB.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM canvas_agent_conversations c
    JOIN canvas_agent_turns t ON t.project_id=c.project_id JOIN canvas_agent_steps s ON s.run_id=t.run_id AND s.id=?
    JOIN canvas_agent_model_operations o ON o.step_id=s.id JOIN canvas_agent_start_intents i ON i.project_id=c.project_id
    JOIN canvas_agent_action_receipts a ON a.turn_id=t.id
    WHERE c.project_id=? AND c.user_id=? AND c.state='active' AND c.brief_json=? AND c.brief_revision=?
    AND t.id=? AND t.state='completed' AND s.status='completed' AND s.receipt_json=? AND o.id=? AND o.receipt_json=?
    AND i.id=? AND i.run_id=? AND i.state='started' AND i.scope_json=? AND i.authorization_json=? AND i.quote_json=?
    AND a.id=? AND a.state='failed' AND a.result_json=? AND a.input_json=?
    AND NOT EXISTS(SELECT 1 FROM canvas_agent_model_operations pending JOIN canvas_agent_runs r ON r.id=pending.run_id
      WHERE r.project_id=c.project_id AND pending.state IN ('dispatching','pending','unknown','received')))
    THEN 1 ELSE json_extract('[]','$[') END`).bind(turn.step_id,run.project_id,run.user_id,conversation.brief_json,current.revision,
      turn.id,turn.step_receipt,operation.id,operation.receipt_json,intent.id,run.id,intent.scope_json,intent.authorization_json,intent.quote_json,action.id,action.result_json,action.input_json);
  return {authority,guard};
}
export async function quoteCanvasPlanReviewedCorrection(env,value,view,inventory,preflight,authority){
  if(preflight.ok||!preflight.issues?.length||preflight.issues.some(issue=>issue.code!=='canvas_agent_parameter_unsupported'))fail();
  const {quote,id,attempt,feedback}=await quoteCanvasAgentCorrection(env,value.run,view,inventory,value.plan,preflight.issues);
  if(attempt!==1||quote.credits>authority.originalPlanningCeiling||quote.credits>quote.budget.remainingCredits)fail();
  return {...authority,boundedCorrection:{stepId:id,attempt,ceilingCredits:quote.credits,payloadDigest:await sha256Hex(JSON.stringify(quote.payload)),
    policy:quote.payload.policy,issues:feedback},quotedBudget:quote.budget};
}
export async function assertCanvasPlanReviewCurrent(env,run,record=null){
  if(!record){const proposal=await env.DB.prepare("SELECT interpretation_json FROM canvas_agent_proposals WHERE run_id=? AND json_extract(interpretation_json,'$.authority.strategy')='bounded-correction' LIMIT 1").bind(run.id).first();
    if(!proposal)return null;record=parse(proposal.interpretation_json);}
  const authority=record.authority;
  if(authority?.strategy!=='bounded-correction')return null;
  if(record.binding?.runId!==run.id||record.binding.userId!==run.user_id||record.binding.projectId!==run.project_id
    ||record.reviewDigest!==await digest({binding:record.binding,authority})||record.allowNewReasoning!==0)fail();
  const row=await env.DB.prepare('SELECT brief_revision,brief_json,state FROM canvas_agent_conversations WHERE project_id=? AND user_id=?').bind(run.project_id,run.user_id).first();
  if(!row||row.state!=='active'||row.brief_revision!==authority.effectiveBriefRevision
    ||await digest(row.brief_json)!==authority.effectiveBriefDigest)fail();
  return authority;
}
export async function allowsReviewedCanvasCorrection(env,run,record,{stepId=null,allocation=false,quote=null}={}){
  const authority=await assertCanvasPlanReviewCurrent(env,run,record),allowed=authority?.boundedCorrection;
  if(!allowed||allowed.attempt!==1||stepId!==allowed.stepId||run.repair_attempts!==(allocation?0:1))return false;
  if(allocation)return !quote||quote.credits===allowed.ceilingCredits&&await sha256Hex(JSON.stringify(quote.payload))===allowed.payloadDigest;
  const step=await env.DB.prepare('SELECT input_json,allocation_credits,kind FROM canvas_agent_steps WHERE id=? AND run_id=?').bind(stepId,run.id).first();
  return Boolean(step&&step.kind==='plan'&&step.allocation_credits===allowed.ceilingCredits&&await sha256Hex(JSON.stringify(parse(step.input_json).payload))===allowed.payloadDigest);
}
