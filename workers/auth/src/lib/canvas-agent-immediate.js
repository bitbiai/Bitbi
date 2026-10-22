import { readCanvasMediaPolicy, restrictCanvasMediaInventory } from './canvas-agent-media-policy.js';
import { CANVAS_AGENT_LIMITS,CANVAS_AGENT_MODEL,resolveCanvasAgentDuration } from '../../../../js/shared/canvas-agent-contract.mjs';
import { getCanvasModelForRole } from '../../../../js/shared/canvas-model-contract.mjs';
import { stablePricingJson,TARIFF_HEADER } from '../../../../js/shared/model-tariff.mjs';
import { CANVAS_GROK_ADMISSION_VERSION } from '../../../../js/shared/canvas-grok-admission.mjs';
import {canvasAssistantModel,CANVAS_FABLE_MODEL,CANVAS_FABLE_ADMISSION_VERSION} from '../../../../js/shared/canvas-assistant-models.mjs';
import { nowIso,randomTokenHex,sha256Hex } from './tokens.js';
import { agentFail,publicAgentRun,CANVAS_AGENT_MESSAGE } from './canvas-agent-store.js';
import { canvasAgentProject,plannerProject,startCanvasAgent } from '../routes/canvas-agent.js';
import { ensureConversation,conversationGuard,canvasConversationBlocker,productionBrief } from './canvas-agent-conversation.js';
import { canvasAgentCapabilities } from './canvas-agent-capabilities.js';
import { prepareCanvasAgentPriceInput } from './canvas-agent-price-input.js';
import { budgetCanvasAgentPlan,quoteCanvasAgentEvaluation } from './canvas-agent-planning.js';
import { quoteModelTariff,getModelTariff } from './model-tariffs.js';

const exact=(body,keys)=>body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).every(k=>keys.includes(k));
const revision=value=>Number.isSafeInteger(value)&&value>=0;
const textOk=value=>typeof value==='string'&&value.length<=6000&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const read=(env,id)=>env.DB.prepare('SELECT * FROM canvas_agent_start_intents WHERE id=?').bind(id).first();
const admission=modelId=>modelId===CANVAS_FABLE_MODEL?CANVAS_FABLE_ADMISSION_VERSION:CANVAS_GROK_ADMISSION_VERSION;
export const validCanvasAssistantQuoteAdmission=quote=>(quote?.assistantAdmission||quote?.canvasGrokAdmission)===admission(quote?.modelId||CANVAS_AGENT_MODEL);
const latest=(env,projectId)=>env.DB.prepare('SELECT * FROM canvas_agent_start_intents WHERE project_id=? ORDER BY rowid DESC LIMIT 1').bind(projectId).first();
// A start command is operational context, not a replacement creative story.
const startControlOnly=text=>{
 const value=String(text||'').normalize('NFKC').trim().toLowerCase();
 return /^(?:(?:bitte|keine weiteren fragen[,;:]?|ohne weitere fragen[,;:]?)\s+)*(?:mach(?:e)?|erstell(?:e)?|produzier(?:e)?|starte)\s+(?:mir\s+)?(?:(?:den|das|die|ein(?:en)?|mein(?:en|e)?)\s+)?(?:film|video|produktion)\s+(?:jetzt|sofort)(?:[,;.!\s]+(?:bitte|keine weiteren fragen|ohne weitere fragen))*[.!?]*$/u.test(value)
  || /^(?:(?:please|no more questions[,;:]?|can you|could you)\s+)*(?:start|make|create|produce)\s+(?:(?:me|the|my|a)\s+)*(?:film|video|production)\s+now(?:[,;.!\s]+(?:please|no more questions))*[.!?]*$/u.test(value);
};
async function latestCreativeSource(env,projectId,afterId=null){
 const rows=(await env.DB.prepare(`SELECT t.* FROM canvas_agent_turns t WHERE t.project_id=?
  AND (t.run_id IS NOT NULL OR EXISTS(SELECT 1 FROM canvas_agent_start_intents i WHERE i.id=t.id AND i.project_id=t.project_id))
  AND t.state NOT IN ('deleted','cancelled') AND (? IS NULL OR t.rowid>(SELECT rowid FROM canvas_agent_turns WHERE id=?))
  ORDER BY t.rowid DESC LIMIT 80`).bind(projectId,afterId,afterId).all()).results;
 return rows.find(turn=>turn.user_text.trim()&&!startControlOnly(turn.user_text))||null;
}
const instructionSummary=(text,locale)=>{
 const marker=locale==='de'?' … [gekürzt; vollständige Vorgabe im Gespräch]':' … [shortened; full instruction in conversation]';
 return text.length<=1000?text:text.slice(0,1000-marker.length)+marker;
};
const guard=(env,row)=>env.DB.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM canvas_agent_start_intents i JOIN canvas_projects p ON p.id=i.project_id
 JOIN users u ON u.id=i.user_id WHERE i.id=? AND i.revision=? AND i.state=? AND p.user_id=i.user_id AND p.deleted_at IS NULL
 AND p.revision=i.expected_revision AND u.status='active' AND i.expires_at>?) THEN 1 ELSE json_extract('[]','$[') END`)
 .bind(row.id,row.revision,row.state,nowIso());
async function wake(env,id){try{await env.AI_VIDEO_JOBS_QUEUE.send({type:CANVAS_AGENT_MESSAGE,intent_id:id});}catch{/* Cron owns recovery of persisted intentions. */}}
export async function cancelCanvasImmediateIntents(env,projectId,code='canvas_agent_stopped'){
 await env.DB.prepare("UPDATE canvas_agent_start_intents SET state='cancelled',revision=revision+1,error_code=?,updated_at=? WHERE project_id=? AND state IN ('waiting','approval_required','authorized')").bind(code,nowIso(),projectId).run();
}
export async function publicCanvasImmediateIntent(env,projectId){
 const row=await latest(env,projectId);if(!row)return null;
 // Reset removes creative context from the UI as well as future model input.
 // Keep immutable operational identities privately for original-request replay.
 const cleared=await env.DB.prepare(`SELECT MAX(json_extract(input_json,'$.expectedConversationRevision')) AS revision
  FROM canvas_agent_conversation_actions WHERE project_id=? AND json_extract(input_json,'$.kind')='control'
  AND json_extract(input_json,'$.action')='clear'`).bind(projectId).first();
 if(cleared?.revision!==null&&cleared?.revision!==undefined&&JSON.parse(row.input_json).expectedConversationRevision<=cleared.revision)return null;
 const scope=JSON.parse(row.scope_json||'null');
 return {id:row.id,revision:row.revision,state:row.state,code:row.error_code,runId:row.run_id,
  canObserve:['waiting','authorized'].includes(row.state),quote:JSON.parse(row.quote_json||'null'),
  expectedRevision:scope?.projectRevision??row.expected_revision,expectedBriefRevision:scope?.briefRevision??row.source_brief_revision,
  createdAt:row.created_at,updatedAt:row.updated_at};
}
export async function createCanvasImmediateIntent(env,userId,projectId,body,key){
 if(!exact(body,['text','locale','expectedConversationRevision','expectedBriefRevision','expectedRevision','delegateCreative'])
  ||!textOk(body.text)||!['en','de'].includes(body.locale)||body.delegateCreative!==true
  ||![body.expectedConversationRevision,body.expectedBriefRevision,body.expectedRevision].every(revision))agentFail('canvas_agent_immediate_invalid',400);
 const view=await canvasAgentProject(env,userId,projectId),row=await ensureConversation(env,projectId,userId),input=stablePricingJson(body);
 const prior=await env.DB.prepare('SELECT * FROM canvas_agent_start_intents WHERE project_id=? AND request_key=?').bind(projectId,key).first();
 if(prior){if(prior.input_json!==input)agentFail('idempotency_conflict');await advanceCanvasImmediateIntent(env,prior.id);return read(env,prior.id);}
 const running=await env.DB.prepare("SELECT * FROM canvas_agent_runs WHERE project_id=? AND user_id=? AND purpose='production' AND status NOT IN ('completed','cancelled','taken_over') ORDER BY rowid DESC LIMIT 1").bind(projectId,userId).first();
 if(running)return {existingRun:await publicAgentRun(env,running)};
 const pending=await env.DB.prepare("SELECT * FROM canvas_agent_start_intents WHERE project_id=? AND state IN ('waiting','approval_required','authorized')").bind(projectId).first();
 if(pending){if(JSON.parse(pending.input_json).text!==body.text)agentFail('canvas_agent_immediate_pending');await advanceCanvasImmediateIntent(env,pending.id);return read(env,pending.id);}
 if(row.state!=='active')agentFail('canvas_agent_conversation_stopped');
 if(row.revision!==body.expectedConversationRevision||row.brief_revision!==body.expectedBriefRevision)agentFail('canvas_agent_conversation_changed');
 if(view.project.revision!==body.expectedRevision)agentFail('canvas_agent_project_changed');
 const source=await latestCreativeSource(env,projectId);
 if((!body.text.trim()||startControlOnly(body.text))&&!source?.user_text&&!JSON.parse(row.brief_json).fields.story?.value)agentFail('canvas_agent_brief_required',400);
 const id=randomTokenHex(16),now=nowIso();
 try {await env.DB.batch([conversationGuard(env,row),env.DB.prepare("UPDATE canvas_agent_conversation_decisions SET state='cancelled',revision=revision+1,updated_at=? WHERE project_id=? AND state='pending'").bind(now,projectId),env.DB.prepare(`INSERT INTO canvas_agent_start_intents
  (id,project_id,user_id,request_key,input_json,source_turn_id,expected_revision,source_brief_revision,state,created_at,updated_at,expires_at)
  VALUES(?,?,?,?,?,?,?,?,'waiting',?,?,?)`).bind(id,projectId,userId,key,input,source?.id||null,body.expectedRevision,row.brief_revision,now,now,new Date(Date.now()+48*3600000).toISOString())]);}
 catch(error){const same=await env.DB.prepare("SELECT * FROM canvas_agent_start_intents WHERE project_id=? AND state IN ('waiting','approval_required','authorized')").bind(projectId).first();
  if(same&&JSON.parse(same.input_json).text===body.text)return same;throw error;}
 await advanceCanvasImmediateIntent(env,id);await wake(env,id);return read(env,id);
}

export async function quoteCanvasImmediateScope(env,intent,scope,view){
 const {canvasAssistantAvailability}=await import('./canvas-agent-assistant-models.js');
 const modelId=scope.modelId||CANVAS_AGENT_MODEL;
 const inventory=await restrictCanvasMediaInventory(env,intent.project_id,await canvasAgentCapabilities(env),intent.user_id),available=await canvasAssistantAvailability(env,modelId);
 if(!available.available)agentFail(available.code,503);
 const candidates=[];
 // This is a reviewable estimate using real integrated request builders and
 // tariffs, not a second model catalog or a promise of the final creative plan.
 const estimatedSeconds=scope.targetDurationSeconds||60;
 for(const offered of inventory.models.filter(m=>m.capability==='video'&&m.controls.supportsDuration!==false)){
  const model=getCanvasModelForRole(offered.id,'member');
  try{
   const seconds=model.controls.duration?.default;if(!Number.isFinite(seconds)||seconds<=0)continue;
   const node={modelId:model.id,type:'video_generation',config:{},prompt:scope.brief.slice(0,Math.min(1000,model.controls.maxPromptLength||1000))};
   const input=prepareCanvasAgentPriceInput({node,model}),quote=await quoteModelTariff(env,{modelId:model.id,input});
   if(!Number.isSafeInteger(quote.credits)||quote.credits<1)continue;
   if(model.id==='google/gemini-omni-flash')continue; // Provider-selected length cannot establish this estimate.
   const clips=Math.ceil((estimatedSeconds+0.5)/(Math.max(1,seconds-0.5)));
   const remaining=inventory.mediaPolicy.usage.find(item=>item.modelId===model.id)?.remainingCredits;
   if(remaining!==null&&remaining!==undefined&&quote.credits*clips>remaining)continue;
   candidates.push({modelId:model.id,clips,seconds,credits:quote.credits*clips});
  }catch{/* Unsupported/unpriced combinations are not offered as a quote. */}
 }
 candidates.sort((a,b)=>a.credits-b.credits||a.modelId.localeCompare(b.modelId));
 if(!candidates.length)agentFail('canvas_agent_model_ineligible',400);
 const selected=candidates[0];
 const extras=['image','music'].reduce((sum,capability)=>{
  const count=capability==='image'?Math.min(4,selected.clips):1;
  const model=inventory.models.find(m=>m.capability===capability&&Number.isFinite(m.pricing?.defaultCredits)
    &&(inventory.mediaPolicy.usage.find(item=>item.modelId===m.id)?.remainingCredits??Infinity)>=m.pricing.defaultCredits*count);
  return sum+(model?model.pricing.defaultCredits*count:0);
 },0);
 const payload={version:1,model:modelId,requestId:intent.id,brief:scope.brief,targetDurationSeconds:scope.targetDurationSeconds,
  toleranceSeconds:CANVAS_AGENT_LIMITS.toleranceSeconds,capabilityRevision:inventory.revision,capabilities:inventory,
  projectRevision:view.project.revision,currentProject:plannerProject(view),
  privacyUser:`cau_${await sha256Hex(`canvas-agent-user:${intent.user_id}`)}`,promptCacheKey:`cap_${await sha256Hex(`canvas-agent-project:${intent.user_id}:${intent.project_id}`)}`};
 const priced=await budgetCanvasAgentPlan(env,{project_id:intent.project_id,model_id:modelId,budget_credits:CANVAS_AGENT_LIMITS.maxBudgetCredits,budget_revision:0},payload);
 const evaluates=canvasAssistantModel(modelId)?.vision===true;
 const evaluation=evaluates?await quoteCanvasAgentEvaluation(env,modelId):{credits:0};
 const estimatedMediaCredits=selected.credits+extras,proposedCapCredits=priced.budget.committedCredits+3*priced.credits+estimatedMediaCredits+evaluation.credits;
 if(proposedCapCredits>CANVAS_AGENT_LIMITS.maxBudgetCredits)agentFail('canvas_agent_budget_exceeded');
 return {proposedCapCredits,planningCredits:priced.credits,evaluationCredits:evaluation.credits,estimatedMediaCredits,committedCredits:priced.budget.committedCredits,
  mediaPolicy:inventory.mediaPolicy,mediaPolicyRevision:inventory.mediaPolicy.revision,tariffRevision:inventory.tariffRevision,modelId,modelRevision:scope.modelRevision??0,assistantAdmission:admission(modelId),...(modelId===CANVAS_AGENT_MODEL?{canvasGrokAdmission:CANVAS_GROK_ADMISSION_VERSION}:{}),scope:{brief:scope.brief,targetDurationSeconds:scope.targetDurationSeconds,durationChoice:scope.durationChoice,
   estimatedSeconds,estimateModelId:selected.modelId,estimatedClips:selected.clips,includesPlanningAttempts:3,includesEvaluations:evaluates?1:0},
  expectedRevision:scope.projectRevision,expectedBriefRevision:scope.briefRevision};
}
async function prepareScope(env,intent,row,view){
 const input=JSON.parse(intent.input_json),source=intent.source_turn_id&&await env.DB.prepare('SELECT * FROM canvas_agent_turns WHERE id=? AND project_id=?').bind(intent.source_turn_id,intent.project_id).first();
 if(source&&['deleted','cancelled'].includes(source.state))agentFail('canvas_agent_conversation_stopped');
 const newer=await latestCreativeSource(env,intent.project_id,intent.source_turn_id);
 if(newer)agentFail('canvas_agent_conversation_changed');
 const brief=JSON.parse(row.brief_json),text=input.text.trim(),creativeText=startControlOnly(text)?'':text,latestText=source?.user_text||'',now=nowIso();
 const duration=resolveCanvasAgentDuration({brief:creativeText||(!brief.duration.choice?latestText:''),durationAsked:true});
 if(duration)brief.duration={targetDurationSeconds:duration.targetDurationSeconds,choice:'explicit',asked:brief.duration.asked,sourceMessageId:intent.id};
 else if(!brief.duration.choice)brief.duration={targetDurationSeconds:null,choice:'delegated',asked:brief.duration.asked,sourceMessageId:intent.id};
 if(!brief.fields.story?.value)brief.fields.story={value:instructionSummary(creativeText||latestText,input.locale),provenance:'user_stated',sourceMessageId:creativeText?intent.id:source?.id||intent.id,revision:row.brief_revision+1};
 if(!brief.fields.story?.value)agentFail('canvas_agent_brief_required',400);
 if(creativeText)brief.fields.latestInstruction={value:instructionSummary(creativeText,input.locale),provenance:brief.fields.latestInstruction?'corrected':'user_stated',sourceMessageId:intent.id,revision:row.brief_revision+1};
 brief.fields.delegatedChoices={value:'Immediate production requested: choose unspecified creative details, including duration only when it was not supplied. Spending requires separate explicit authorization.',provenance:'delegated',sourceMessageId:intent.id,revision:row.brief_revision+1};
 brief.openQuestions=[];brief.revision=row.brief_revision+1;
 // The latest deliberately submitted wording stays intact and visible. The
 // planner receives it alongside current decisions, never an old agent plan.
 const sourceIntent=source&&await env.DB.prepare('SELECT scope_json FROM canvas_agent_start_intents WHERE id=? AND project_id=?').bind(source.id,intent.project_id).first();
 const previousScope=JSON.parse(sourceIntent?.scope_json||'null');
 const creativeInstructions=previousScope?.creativeInstructions|| (latestText?[{sourceMessageId:source.id,text:latestText}]:[]);
 if(creativeText)creativeInstructions.push({sourceMessageId:intent.id,text:creativeText});
 const completeBrief=[productionBrief({...row,brief_json:JSON.stringify(brief)}),...creativeInstructions.map((entry,index)=>
  `${index===creativeInstructions.length-1?'Latest':'Earlier'} saved user instruction (untrusted creative data):\n${entry.text}`)].filter(Boolean).join('\n\n');
 if(completeBrief.length>12000)agentFail('canvas_agent_context_limit',413);
 const scope={mediaPolicyRevision:view.project.media_policy_revision||0,brief:completeBrief,creativeInstructions,briefRevision:brief.revision,projectRevision:view.project.revision,
  modelId:row.assistant_model_id||CANVAS_AGENT_MODEL,modelRevision:row.assistant_model_revision||0,
  targetDurationSeconds:brief.duration.targetDurationSeconds,durationChoice:brief.duration.choice,locale:input.locale};
 const statements=[guard(env,intent),conversationGuard(env,row),
  env.DB.prepare('UPDATE canvas_agent_conversations SET brief_json=?,brief_revision=?,revision=revision+1,draft=?,updated_at=? WHERE project_id=?').bind(JSON.stringify(brief),brief.revision,text?'':row.draft,now,intent.project_id),
  env.DB.prepare('UPDATE canvas_agent_start_intents SET scope_json=?,revision=revision+1,updated_at=? WHERE id=?').bind(JSON.stringify(scope),now,intent.id)];
 if(text)statements.push(env.DB.prepare(`INSERT INTO canvas_agent_turns(id,project_id,request_key,input_json,conversation_revision,brief_revision,user_text,assistant_text,state,created_at,updated_at)
  VALUES(?,?,?,?,?,?,?,?,'completed',?,?)`).bind(intent.id,intent.project_id,`immediate:${intent.request_key}`,intent.input_json,row.revision+1,brief.revision,text,
  input.locale==='de'?'Dein Produktionswunsch ist gespeichert. Ich bereite die passende Freigabe vor.':'Your production request is saved. I am preparing the required authorization.',now,now));
 await env.DB.batch(statements);return scope;
}
export async function advanceCanvasImmediateIntent(env,id){
 let intent=await read(env,id);if(!intent||!['waiting','authorized'].includes(intent.state))return intent;
 try{
  const view=await canvasAgentProject(env,intent.user_id,intent.project_id),row=await ensureConversation(env,intent.project_id,intent.user_id);
  const user=await env.DB.prepare('SELECT status FROM users WHERE id=?').bind(intent.user_id).first();
  if(user?.status!=='active'||row.state!=='active'||intent.expires_at<=nowIso())agentFail('canvas_agent_authorization_expired');
  if(view.project.revision!==intent.expected_revision)agentFail('canvas_agent_project_changed');
  if(await canvasConversationBlocker(env,intent.project_id))return intent;
  const held=await env.DB.prepare("SELECT o.id FROM canvas_agent_model_operations o JOIN canvas_agent_runs r ON r.id=o.run_id WHERE r.project_id=? AND o.state IN ('dispatching','pending','unknown','received') LIMIT 1").bind(intent.project_id).first();
  if(held)return intent;
  let scope=JSON.parse(intent.scope_json||'null');
  if(!scope){scope=await prepareScope(env,intent,row,view);intent=await read(env,id);}
  const current=await ensureConversation(env,intent.project_id,intent.user_id);
  if((scope.mediaPolicyRevision??0)!==(await readCanvasMediaPolicy(env,intent.project_id,intent.user_id)).revision)agentFail('canvas_agent_media_policy_changed');
  if(current.brief_revision!==scope.briefRevision)agentFail('canvas_agent_conversation_changed');
  if(scope.modelId&&(scope.modelId!==(current.assistant_model_id||CANVAS_AGENT_MODEL)||scope.modelRevision!==(current.assistant_model_revision||0)))agentFail('canvas_agent_assistant_model_changed');
  if(intent.state==='waiting'){
   const quote=await quoteCanvasImmediateScope(env,intent,scope,view);
   await env.DB.batch([guard(env,intent),conversationGuard(env,current),env.DB.prepare("UPDATE canvas_agent_start_intents SET state='approval_required',quote_json=?,revision=revision+1,updated_at=? WHERE id=?").bind(JSON.stringify(quote),nowIso(),id)]);
  }else{
   const authorization=JSON.parse(intent.authorization_json||'null'),quote=JSON.parse(intent.quote_json||'null');
   if(!authorization||authorization.scope!==intent.scope_json||authorization.tariffRevision!==quote?.tariffRevision)agentFail('canvas_agent_production_consent_required');
   if(!validCanvasAssistantQuoteAdmission(quote)||(authorization.assistantAdmission||authorization.canvasGrokAdmission)!==(quote.assistantAdmission||quote.canvasGrokAdmission))agentFail('model_pricing_stale');
   if((await getModelTariff(env)).revision!==authorization.tariffRevision)agentFail('model_pricing_stale');
   const body={brief:scope.brief,targetDurationSeconds:scope.targetDurationSeconds,durationChoice:scope.durationChoice,
    budgetCredits:authorization.capCredits,expectedRevision:scope.projectRevision,mediaPolicyRevision:scope.mediaPolicyRevision??0,locale:scope.locale};
   const request=new Request(`https://bitbi.ai/api/account/canvas/projects/${intent.project_id}/agent`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':`immediate:${id}`,[TARIFF_HEADER]:String(authorization.tariffRevision)},body:JSON.stringify(body)});
   await startCanvasAgent({env,request},{user:{id:intent.user_id}},intent.project_id,{briefRevision:scope.briefRevision,
    ...(scope.modelId?{assistantModelId:scope.modelId,assistantModelRevision:scope.modelRevision}:{}),
    guard:[guard(env,intent),conversationGuard(env,current)],afterStart:runId=>[
     env.DB.prepare("UPDATE canvas_agent_start_intents SET state='started',run_id=?,revision=revision+1,updated_at=? WHERE id=? AND state='authorized'").bind(runId,nowIso(),id)]});
  }
 }catch(error){
  // Concurrent exact replay may have committed. Observe it before classifying
  // an exception; no new request identity is generated during recovery.
  const current=await read(env,id);if(!current||current.revision!==intent.revision||!['waiting','authorized'].includes(current.state))return current;
  const code=/^[a-z0-9_]{1,90}$/.test(error?.code||'')?error.code:'canvas_agent_immediate_review_required';
  await env.DB.prepare("UPDATE canvas_agent_start_intents SET state='blocked',error_code=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND state IN ('waiting','authorized')").bind(code,nowIso(),id,intent.revision).run();
 }
 return read(env,id);
}
export async function approveCanvasImmediateIntent(env,userId,projectId,body,tariff){
 if(!exact(body,['intentId','intentRevision','capCredits','authorized','expectedRevision','expectedBriefRevision'])||body.authorized!==true
  ||!/^[a-f0-9]{32}$/.test(body.intentId||'')||![body.intentRevision,body.expectedRevision,body.expectedBriefRevision].every(revision)||!Number.isSafeInteger(body.capCredits)||body.capCredits<1||body.capCredits>CANVAS_AGENT_LIMITS.maxBudgetCredits)agentFail('canvas_agent_production_consent_required',400);
 let row=await read(env,body.intentId);
 if(!row||row.project_id!==projectId||row.user_id!==userId)agentFail('canvas_agent_immediate_not_found',404);
 const quote=JSON.parse(row.quote_json||'null'),scope=JSON.parse(row.scope_json||'null');
 const authorization={capCredits:body.capCredits,tariffRevision:quote?.tariffRevision,scope:row.scope_json,
  ...(quote?.assistantAdmission!==undefined?{assistantAdmission:quote.assistantAdmission}:{}),
  ...(quote?.canvasGrokAdmission!==undefined?{canvasGrokAdmission:quote.canvasGrokAdmission}:{})};
 if(['authorized','started'].includes(row.state)){
  if(stablePricingJson(JSON.parse(row.authorization_json))!==stablePricingJson(authorization))agentFail('idempotency_conflict');
  // Started intentions retain their original replay shape and accepted usage.
  // An unstarted authorization cannot silently accept a new metering contract.
  if(row.state==='authorized'&&!validCanvasAssistantQuoteAdmission(quote))agentFail('model_pricing_stale');
  await advanceCanvasImmediateIntent(env,row.id);return read(env,row.id);
 }
 if(row.state!=='approval_required'||row.revision!==body.intentRevision||scope?.projectRevision!==body.expectedRevision||scope?.briefRevision!==body.expectedBriefRevision)agentFail('canvas_agent_immediate_changed');
 const current=await ensureConversation(env,projectId,userId);
 if((scope.mediaPolicyRevision??0)!==(await readCanvasMediaPolicy(env,projectId,userId)).revision)agentFail('canvas_agent_media_policy_changed');
 if(current.brief_revision!==scope.briefRevision)agentFail('canvas_agent_conversation_changed');
 if(scope.modelId&&(scope.modelId!==(current.assistant_model_id||CANVAS_AGENT_MODEL)||scope.modelRevision!==(current.assistant_model_revision||0)))agentFail('canvas_agent_assistant_model_changed');
 if(!validCanvasAssistantQuoteAdmission(quote))agentFail('model_pricing_stale');
 if(String(quote.tariffRevision)!==String(tariff)||(await getModelTariff(env)).revision!==quote.tariffRevision)agentFail('model_pricing_stale');
 if(body.capCredits<quote.committedCredits+quote.planningCredits)agentFail('canvas_agent_budget_exceeded');
 try {await env.DB.batch([guard(env,row),conversationGuard(env,current),env.DB.prepare("UPDATE canvas_agent_start_intents SET state='authorized',authorization_json=?,revision=revision+1,updated_at=? WHERE id=?").bind(JSON.stringify(authorization),nowIso(),row.id)]);}
 catch(error){const accepted=await read(env,row.id);if(!['authorized','started'].includes(accepted?.state)||stablePricingJson(JSON.parse(accepted.authorization_json||'null'))!==stablePricingJson(authorization))throw error;}
 await advanceCanvasImmediateIntent(env,row.id);await wake(env,row.id);return read(env,row.id);
}
export async function controlCanvasImmediateIntent(env,userId,projectId,body){
 if(!exact(body,['intentId','intentRevision','action'])||body.action!=='cancel'||!/^[a-f0-9]{32}$/.test(body.intentId||'')||!revision(body.intentRevision))agentFail('canvas_agent_immediate_invalid',400);
 const row=await read(env,body.intentId);if(!row||row.project_id!==projectId||row.user_id!==userId)agentFail('canvas_agent_immediate_not_found',404);
 if(row.state==='cancelled')return row;
 if(row.state==='started'||row.revision!==body.intentRevision)agentFail('canvas_agent_immediate_changed');
 await env.DB.prepare("UPDATE canvas_agent_start_intents SET state='cancelled',error_code='canvas_agent_stopped',revision=revision+1,updated_at=? WHERE id=? AND revision=?").bind(nowIso(),row.id,row.revision).run();return read(env,row.id);
}
export async function recoverCanvasImmediateIntents(env,{projectId=null}={}){
 const rows=(await env.DB.prepare(`SELECT id FROM canvas_agent_start_intents WHERE state IN ('waiting','authorized') ${projectId?'AND project_id=?':''} ORDER BY updated_at LIMIT 20`).bind(...(projectId?[projectId]:[])).all()).results;
 for(const row of rows)await advanceCanvasImmediateIntent(env,row.id);
}
