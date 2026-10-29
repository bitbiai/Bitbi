import {stablePricingJson} from '../../../../js/shared/model-tariff.mjs';
import {canvasConversationDecisionIntent} from '../../../../js/shared/canvas-conversation-decision-intent.mjs';
import {canvasAgentProject} from '../routes/canvas-agent.js';
import {canvasVoiceSource} from './canvas-voice-conversation.js';
import {canvasConversationDecisionPrompt,ensureCanvasConversationBudgetQuestion,handleCanvasConversationDecisionMessage} from './canvas-agent-conversation-decisions.js';
import {nowIso,sha256Hex} from './tokens.js';

const parse=value=>JSON.parse(value||'null');
const fail=code=>{throw Object.assign(new Error(code),{code,status:409});};
const normalize=value=>String(value||'').normalize('NFKC').replace(/\s+/gu,' ').trim();
// Spoken quotation typography is not a term. Never join word/number fragments,
// and keep this comparison separate from the immutable prompt/hash normalizer.
const speechTerms=value=>normalize(normalize(value).replace(/(?<![\p{L}\p{M}\p{N}"“”„])["“”„]+|["“”„]+(?![\p{L}\p{M}\p{N}"“”„])/gu,''));
const pending=(env,scope)=>env.DB.prepare("SELECT * FROM canvas_agent_conversation_decisions WHERE project_id=? AND user_id=? AND state='pending' ORDER BY rowid DESC LIMIT 1").bind(scope.projectId,scope.userId).first();
const record=(env,scope,key)=>env.DB.prepare('SELECT * FROM canvas_voice_calls WHERE session_id=? AND call_id=?').bind(scope.sessionId,key).first();
const proposalKey=p=>`presentation-proposal:${p.targetKind}:${p.targetId}`;
export const voiceDecisionContext=(env,scope)=>pending(env,scope).then(row=>row?{id:row.id,revision:row.revision,kind:row.kind,state:row.state,expiresAt:row.expires_at,prompt:canvasConversationDecisionPrompt(row)}:null);
export async function pendingVoicePresentation(env,scope){
 const row=await env.DB.prepare(`SELECT r.result_json FROM canvas_voice_calls r WHERE r.session_id=? AND r.call_id LIKE 'presentation-proposal:%'
  AND ((json_extract(r.result_json,'$.targetKind')='decision' AND EXISTS(SELECT 1 FROM canvas_agent_conversation_decisions d WHERE d.id=json_extract(r.result_json,'$.targetId') AND d.project_id=? AND d.user_id=? AND d.state='pending'))
   OR (json_extract(r.result_json,'$.targetKind')='action' AND EXISTS(SELECT 1 FROM canvas_agent_action_receipts a WHERE a.id=json_extract(r.result_json,'$.targetId') AND a.project_id=? AND a.user_id=? AND a.state='confirmation_required')))
  ORDER BY r.rowid DESC LIMIT 1`).bind(scope.sessionId,scope.projectId,scope.userId,scope.projectId,scope.userId).first();
 return row?parse(row.result_json):null;
}

// These receipts attest application output/playback correlation, never biometric
// identity or human hearing. The existing decision remains the only authority.
export async function saveVoicePresentation(env,scope,presentation){
 const value={...presentation,promptHash:await sha256Hex(normalize(presentation.prompt))},input=stablePricingJson(value),key=proposalKey(value);
 const previous=await record(env,scope,key);
 if(previous){if(previous.input_json!==input)fail('canvas_voice_decision_changed');return parse(previous.result_json);}
 await env.DB.prepare('INSERT INTO canvas_voice_calls(session_id,call_id,input_json,result_json,created_at) VALUES(?,?,?,?,?)').bind(scope.sessionId,key,input,JSON.stringify(value),nowIso()).run();
 return value;
}
export async function recordVoiceDecisionPresentation(env,scope,input){
 if(!input||!['decision','action'].includes(input.targetKind)||!/^[a-f0-9]{32}$/.test(input.targetId||'')||!Number.isSafeInteger(input.targetRevision)
  ||!['responseId','itemId'].every(key=>typeof input[key]==='string'&&/^[A-Za-z0-9_.:-]{1,180}$/.test(input[key]))
  ||!Number.isSafeInteger(input.audioMs)||input.audioMs<=0||input.audioMs>3600000)fail('canvas_voice_presentation_invalid');
 const proposal=await record(env,scope,proposalKey(input));if(!proposal)fail('canvas_voice_terms_not_presented');
 const p=parse(proposal.result_json);
 for(const key of ['targetKind','targetId','targetRevision','questionConversationRevision','briefRevision','projectRevision'])if(input[key]!==p[key])fail('canvas_voice_decision_changed');
 const reply=await env.DB.prepare(`SELECT t.assistant_text,v.interrupted,c.revision,c.brief_revision,p.revision AS project_revision FROM canvas_voice_turns v
  JOIN canvas_agent_turns t ON t.id=v.turn_id JOIN canvas_agent_conversations c ON c.project_id=t.project_id JOIN canvas_voice_sessions s ON s.id=v.session_id
  JOIN canvas_projects p ON p.id=s.project_id WHERE s.id=? AND s.user_id=? AND s.project_id=? AND v.provider_response_id=?
  AND t.state='completed' AND s.state='active' AND s.stop_requested=0 AND s.expires_at>? AND c.state='active' AND p.deleted_at IS NULL AND p.user_id=s.user_id`)
  .bind(scope.sessionId,scope.userId,scope.projectId,input.responseId,nowIso()).first();
 if(!reply||reply.interrupted||!speechTerms(reply.assistant_text).includes(speechTerms(p.prompt)))fail('canvas_voice_terms_not_presented');
 if(reply.brief_revision!==p.briefRevision||reply.project_revision!==p.projectRevision||input.conversationRevision!==reply.revision)fail('canvas_voice_decision_changed');
 const key='presentation:'+ (await sha256Hex(`${p.targetKind}:${p.targetId}:${input.responseId}`)).slice(0,32);
 const result={...p,key,conversationRevision:reply.revision,responseId:input.responseId,itemId:input.itemId,audioMs:input.audioMs};
 const prior=await record(env,scope,key);if(prior){if(prior.input_json!==stablePricingJson(result))fail('idempotency_conflict');return parse(prior.result_json);}
 await env.DB.prepare('INSERT INTO canvas_voice_calls(session_id,call_id,input_json,result_json,created_at) VALUES(?,?,?,?,?)').bind(scope.sessionId,key,stablePricingJson(result),JSON.stringify(result),nowIso()).run();
 return result;
}
export async function voiceDecisionSourceGuard(env,scope,source,target,canUsePresentation){
 const candidate=await env.DB.prepare(`SELECT * FROM canvas_voice_calls WHERE session_id=? AND call_id LIKE 'presentation:%'
  AND json_extract(result_json,'$.targetKind')=? AND json_extract(result_json,'$.targetId')=? ORDER BY rowid DESC LIMIT 1`)
  .bind(scope.sessionId,target.targetKind,target.targetId).first();
 const p=candidate&&parse(candidate.result_json);
 if(!p||p.targetRevision!==target.targetRevision||source.row.brief_revision!==p.briefRevision||source.session.current_project_revision!==p.projectRevision
  ||!await canUsePresentation?.(p))fail('canvas_voice_terms_not_presented');
 const proof=env.DB.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM canvas_voice_calls r JOIN canvas_voice_turns v ON v.session_id=r.session_id
  JOIN canvas_agent_turns t ON t.id=v.turn_id WHERE r.session_id=? AND r.call_id=? AND r.result_json=? AND v.provider_response_id=?
  AND v.interrupted=0 AND t.state='completed' AND t.rowid<(SELECT rowid FROM canvas_agent_turns WHERE id=?)) THEN 1 ELSE json_extract('[]','$[') END`)
  .bind(scope.sessionId,p.key,candidate.result_json,p.responseId,source.turn.id);
 // Execute the same guard now and in the authority transaction: absence is not
 // positive proof, and a subsequent interruption cannot race admission.
 try{await proof.first();}catch{fail('canvas_voice_terms_not_presented');}
 return {...source,kind:'voice',turnId:source.turn.id,decisionId:target.targetId,questionConversationRevision:p.questionConversationRevision,
  conversationRevision:source.row.revision,presentationVerified:true,guard:[...source.guard,proof],presentation:p};
}
export async function currentVoicePresentation(env,scope,source,decision){
 if(!decision)return null;
 const s=parse(decision.scope_json);
 // The proposal is immutable. Conversation projections can advance separately;
 // its creative/model/price scope remains enforced by the normal decision path.
 return saveVoicePresentation(env,scope,{targetKind:'decision',targetId:decision.id,targetRevision:decision.revision,
  questionConversationRevision:s.questionConversationRevision,conversationRevision:s.questionConversationRevision,
  briefRevision:s.briefRevision,projectRevision:s.projectRevision,prompt:canvasConversationDecisionPrompt(decision)});
}
export async function prepareVoiceDecision(env,scope,turnId){
 const source=await canvasVoiceSource(env,scope,turnId),voiceSource={...source,kind:'voice',turnId:source.turn.id};
 await ensureCanvasConversationBudgetQuestion(env,scope.projectId,scope.userId,{voiceSource});
 const decision=await pending(env,scope),presentation=await currentVoicePresentation(env,scope,source,decision);
 return {prepared:true,executed:false,requiresExplicitConfirmation:true,revisionBefore:source.row.revision,conversationRevision:voiceSource.outcome?.conversationRevision??source.row.revision,
  briefRevision:source.row.brief_revision,projectRevision:source.session.current_project_revision,
  decision:decision?{id:decision.id,kind:decision.kind,state:decision.state}:null,presentation,spokenPrompt:presentation?.prompt||null};
}
async function reconcileVoiceDecision(env,scope,key,turnId){
 const prior=await env.DB.prepare(`SELECT * FROM canvas_agent_conversation_decisions WHERE project_id=? AND user_id=?
  AND (decision_key=? OR (source_turn_id=? AND request_key IN (?,?))) ORDER BY rowid DESC LIMIT 1`)
  .bind(scope.projectId,scope.userId,key,turnId,'proposal:'+key,'allowance:'+key).first();
 if(!prior)return null;
 const original=parse(prior.input_json),bound=parse(prior.scope_json),receipt=prior.decision_key===key?await env.DB.prepare('SELECT input_json FROM canvas_agent_conversation_actions WHERE project_id=? AND request_key=?').bind(scope.projectId,key).first():null;
 const accepted=receipt&&parse(receipt.input_json),revisionBefore=accepted?.expectedConversationRevision??original.expectedConversationRevision;
 const presentation=prior.state==='pending'?await currentVoicePresentation(env,scope,null,prior):null;
 return {handled:true,executed:prior.state==='consumed'&&Boolean(prior.run_id),replay:true,revisionBefore,conversationRevision:revisionBefore+1,
  briefRevision:bound.briefRevision,projectRevision:bound.projectRevision,runId:prior.state==='consumed'?prior.run_id:null,
  presentation,spokenPrompt:presentation?.prompt||(prior.state==='consumed'?(bound.locale==='de'?'Die ursprüngliche Freigabe wurde bereits angenommen.':'The original approval was already accepted.'):null)};
}
export async function applyVoiceDecision(env,scope,{turnId,callId},{canUsePresentation}={}){
 const key='voice-decision:'+turnId,identity=stablePricingJson({turnId}),prior=await record(env,scope,key);
 if(prior){if(prior.input_json!==identity)fail('idempotency_conflict');return {...parse(prior.result_json),replay:true};}
 const {reconcileVoiceAction}=await import('./canvas-voice-actions.js');
 const reconciled=await reconcileVoiceAction(env,scope,turnId)||await reconcileVoiceDecision(env,scope,key,turnId);
 if(reconciled){await env.DB.prepare('INSERT OR IGNORE INTO canvas_voice_calls(session_id,call_id,input_json,result_json,created_at) VALUES(?,?,?,?,?)').bind(scope.sessionId,key,identity,JSON.stringify(reconciled),nowIso()).run();return reconciled;}
 const source=await canvasVoiceSource(env,scope,turnId),decision=await pending(env,scope),locale=source.session.locale==='de'?'de':'en';
 const intent=canvasConversationDecisionIntent(source.turn.user_text,{locale,budgetAsked:decision?.kind==='production_budget'});
 if(['accept','decline'].includes(intent?.kind)){
  const {pendingVoiceAction,confirmVoiceAction}=await import('./canvas-voice-actions.js'),action=await pendingVoiceAction(env,scope);
  const presentation=action?await pendingVoicePresentation(env,scope):null;
  if(action&&presentation?.targetKind==='action'&&presentation.targetId===action.id){const result=await confirmVoiceAction(env,scope,source,action,intent.kind,canUsePresentation);
   await env.DB.prepare('INSERT INTO canvas_voice_calls(session_id,call_id,input_json,result_json,created_at) VALUES(?,?,?,?,?)').bind(scope.sessionId,key,identity,JSON.stringify(result),nowIso()).run();return result;}
 }
 let voiceSource={...source,kind:'voice',turnId,conversationRevision:source.row.revision};
 if(['accept','decline'].includes(intent?.kind)&&decision){
  voiceSource=await voiceDecisionSourceGuard(env,scope,source,{targetKind:'decision',targetId:decision.id,targetRevision:decision.revision},canUsePresentation);
 }
 if(intent?.kind==='cap'&&!/credits?\s*[.!]*$/iu.test(source.turn.user_text)&&decision?.kind==='production_budget')
  voiceSource=await voiceDecisionSourceGuard(env,scope,source,{targetKind:'decision',targetId:decision.id,targetRevision:decision.revision},canUsePresentation);
 const input={text:source.turn.user_text,locale,expectedConversationRevision:source.row.revision,expectedBriefRevision:source.row.brief_revision};
 const ctx={env,request:new Request('https://canvas.internal/api/account/canvas/projects/'+scope.projectId+'/agent/conversation',{method:'POST'}),isSecure:true};
 const handled=await handleCanvasConversationDecisionMessage(ctx,{user:{id:scope.userId}},await canvasAgentProject(env,scope.userId,scope.projectId),source.row,input,key,{voiceSource});
 const next=await pending(env,scope),presentation=handled&&next?await currentVoicePresentation(env,scope,source,next):null;
 const outcome=voiceSource.outcome||{revisionBefore:source.row.revision,conversationRevision:source.row.revision,briefRevision:source.row.brief_revision};
 const result={handled,executed:Boolean(outcome.runId),...outcome,projectRevision:outcome.projectRevision??source.session.current_project_revision,
  presentation,spokenPrompt:presentation?.prompt||outcome.text||null,decision:next?{id:next.id,kind:next.kind,state:next.state}:null};
 // A lost local acknowledgement never causes a second admission: the normal
 // decision request key, immutable proposal and run identity remain authoritative.
 await env.DB.prepare('INSERT INTO canvas_voice_calls(session_id,call_id,input_json,result_json,created_at) VALUES(?,?,?,?,?)').bind(scope.sessionId,key,identity,JSON.stringify(result),nowIso()).run();
 return result;
}
