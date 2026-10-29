import {CANVAS_AGENT_BRIEF_FIELDS} from '../../../shared/canvas-agent-dialogue.mjs';
import {CANVAS_AGENT_ACTION_SCHEMA} from '../../../shared/canvas-agent-actions.mjs';
import {readCanvasVoiceContext,applyCanvasVoiceBrief,canvasVoiceSource} from './canvas-voice-conversation.js';
import {applyVoiceDecision,prepareVoiceDecision,voiceDecisionContext,pendingVoicePresentation} from './canvas-voice-decisions.js';
import {applyVoiceActions} from './canvas-voice-actions.js';

const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const nullable=value=>({anyOf:[value,{type:'null'}]});
const provenance={type:'string',enum:['user_stated','corrected','assistant_proposed','unresolved']};
const fields=CANVAS_AGENT_BRIEF_FIELDS.filter(field=>!['format','delegatedChoices'].includes(field));
const revision={type:'integer',minimum:0};
const definitions=[
 {type:'function',name:'canvas_context',description:'Read the current project, saved creative brief, supported capabilities and revisions. This never starts work or approves spending.',parameters:object({})},
 {type:'function',name:'canvas_update_brief',description:'Propose creative changes from the current spoken user turn using current context revisions. Only a successful server result confirms the change. No spending or production controls.',parameters:object({
  expectedConversationRevision:revision,expectedBriefRevision:revision,expectedProjectRevision:revision,
  updates:{type:'array',maxItems:15,items:object({field:{type:'string',enum:fields},value:{type:'string',maxLength:1000},provenance})},
  questions:{type:'array',maxItems:2,items:{type:'string',minLength:1,maxLength:800}},
  format:{...nullable(object({aspectRatio:nullable({type:'string',minLength:1,maxLength:20}),resolution:nullable({type:'string',minLength:1,maxLength:30}),provenance})),description:'Use null when no format change is proposed. Both aspectRatio and resolution null also leave the existing format unchanged.'},
  duration:nullable(object({choice:{type:'string',enum:['explicit','delegated']},targetDurationSeconds:nullable({type:'number',exclusiveMinimum:0})})),
 })},
 {type:'function',name:'canvas_prepare_next_step',description:'Prepare the existing budget/start decision from the saved brief. Never starts or spends. Speak the returned exact spokenPrompt before asking for assent.',parameters:object({})},
 {type:'function',name:'canvas_decision',description:'Process only the current committed user utterance as a budget amount or answer to the current decision. The server parses the amount/yes/no and verifies the exact presented scope; model arguments cannot authorize anything. Speak the returned spokenPrompt exactly. A successful accepted run is the only proof of production start.',parameters:object({})},
 {type:'function',name:'canvas_action',description:'Propose one existing Canvas action from the current user request and current revisions. Paid/destructive/mutating actions require the returned server question followed by a separate current user assent via canvas_decision. Do not confuse stop speaking with cancel production. Return immediately after an accepted job; never wait for its media.',parameters:object({
  expectedConversationRevision:revision,expectedBriefRevision:revision,expectedProjectRevision:revision,actions:{type:'array',minItems:1,maxItems:1,items:CANVAS_AGENT_ACTION_SCHEMA}})},
 {type:'function',name:'canvas_voice_end',description:'End only this Voice session when the current committed user explicitly asks to end Voice. No production is paused or cancelled. Bare stop/end is ambiguous. The application closes cleanly and confirms in its status; do not request another model reply.',parameters:object({})},
];
const names=new Set(definitions.map(value=>value.name));
const fail=code=>{throw Object.assign(new Error(code),{code,status:400});};
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,180}$/.test(value);
const allowedErrors=new Set(['canvas_voice_tool_forbidden','canvas_voice_tool_arguments_invalid','canvas_voice_session_unavailable','canvas_voice_transcript_pending',
 'canvas_voice_brief_invalid','canvas_voice_format_invalid','canvas_voice_format_unavailable','canvas_voice_format_ambiguous','canvas_voice_duration_unconfirmed',
 'canvas_voice_read_only_turn','canvas_voice_source_changed','canvas_voice_turn_unavailable','canvas_agent_conversation_changed','canvas_agent_conversation_stopped','idempotency_conflict']);
['canvas_voice_terms_not_presented','canvas_voice_decision_changed','canvas_voice_action_invalid','canvas_voice_action_unavailable','canvas_voice_action_clarification_required','canvas_voice_use_decision',
 'canvas_agent_decision_changed','canvas_agent_decision_expired','canvas_agent_decision_invalid','canvas_agent_decision_not_found','canvas_agent_budget_required','canvas_agent_budget_exceeded',
 'canvas_agent_already_active','canvas_agent_duration_required','canvas_agent_conversation_pending','canvas_agent_provider_review_required','canvas_agent_conversation_limit','model_pricing_stale',
 'canvas_agent_media_policy_changed','canvas_agent_action_invalid','canvas_agent_project_changed','canvas_agent_action_confirmation_changed','canvas_agent_action_review_required','canvas_agent_action_not_found'].forEach(code=>allowedErrors.add(code));
['canvas_agent_disabled','canvas_agent_infrastructure_unavailable','canvas_agent_model_unavailable','canvas_agent_model_adapter_unavailable','canvas_agent_model_ineligible',
 'canvas_agent_provider_unavailable','canvas_agent_dialogue_unavailable','model_area_disabled','model_availability_unavailable','model_pricing_unavailable',
 'canvas_agent_context_limit','canvas_agent_price_quote_unstable','canvas_agent_budget_state_invalid'].forEach(code=>allowedErrors.add(code));

export function canvasVoiceFunctionDefinitions(){return structuredClone(definitions);}
export const isCanvasVoiceTool=name=>names.has(name);
export const voiceToolNeedsUserTurn=name=>names.has(name)&&name!=='canvas_context';
async function endVoice(env,scope,turnId){
 const key='voice-end:'+turnId,previous=await env.DB.prepare('SELECT result_json FROM canvas_voice_calls WHERE session_id=? AND call_id=?').bind(scope.sessionId,key).first();
 if(previous)return {...JSON.parse(previous.result_json),replay:true};
 const source=await canvasVoiceSource(env,scope,turnId),text=source.turn.user_text.normalize('NFKC').trim().toLowerCase().replace(/[.!]+$/u,'');
 if(!/^(?:(?:bitte\s+)?(?:(?:voice(?:[- ]assistent|[- ]gespräch|[- ]sitzung)?|sprachgespräch)\s+beenden|beende\s+(?:(?:den|die|das)\s+)?(?:voice(?:[- ]assistent(?:en)?|[- ]gespräch|[- ]sitzung)?|sprachgespräch))|(?:please\s+)?(?:end|stop|close)\s+(?:the\s+)?voice(?:\s+(?:session|assistant|call))?(?:\s+please)?)$/u.test(text))fail('canvas_voice_action_clarification_required');
 const result={ok:true,endVoice:true,data:{stopped:true,productionCancelled:false,text:source.session.locale==='de'?'Voice wird beendet. Eine bereits freigegebene Produktion läuft weiter.':'Voice is ending. An already authorized production continues.'}};
 await env.DB.batch([...source.guard,env.DB.prepare('INSERT INTO canvas_voice_calls(session_id,call_id,input_json,result_json,created_at) VALUES(?,?,?,?,?)')
  .bind(scope.sessionId,key,JSON.stringify({turnId}),JSON.stringify(result),new Date().toISOString())]);
 return result;
}
export function canvasVoiceToolDiagnostic(name,result){
 return {name:names.has(name)?name:'unknown',ok:result?.ok===true,
  ...(result?.ok===true?{}:{code:allowedErrors.has(result?.code)?result.code:'canvas_voice_tool_failed'})};
}
// Trusted scope is captured by the authenticated server/relay. Provider arguments
// cannot name another owner/project/session, source turn or durable call identity.
export function createCanvasVoiceToolDispatcher(env,trustedScope,{conversationRevision=()=>undefined,canUsePresentation=()=>false}={}){
 const scope=Object.freeze({sessionId:trustedScope.sessionId,projectId:trustedScope.projectId,userId:trustedScope.userId});
 return async invocation=>{
  try{
   if(!plain(invocation)||Object.keys(invocation).some(key=>!['name','arguments','callId','turn'].includes(key))||!names.has(invocation.name)||!id(invocation.callId))fail('canvas_voice_tool_forbidden');
   const row=await env.DB.prepare(`SELECT s.settings_json FROM canvas_voice_sessions s JOIN canvas_projects p ON p.id=s.project_id JOIN users u ON u.id=s.user_id
    JOIN canvas_agent_conversations c ON c.project_id=p.id WHERE s.id=? AND s.project_id=? AND s.user_id=? AND p.user_id=s.user_id
    AND p.deleted_at IS NULL AND u.status='active' AND c.state='active' AND s.state='active' AND s.stop_requested=0 AND s.expires_at>?
    AND NOT EXISTS(SELECT 1 FROM canvas_voice_stop_requests stop WHERE stop.session_id=s.id)`).bind(scope.sessionId,scope.projectId,scope.userId,new Date().toISOString()).first();
   if(!row)fail('canvas_voice_session_unavailable');
   if(JSON.parse(row.settings_json)?.tools?.canvas?.enabled!==true)fail('canvas_voice_tool_forbidden');
   const args=invocation.arguments;
   if(!plain(args)||new TextEncoder().encode(JSON.stringify(args)).byteLength>24000)fail('canvas_voice_tool_arguments_invalid');
   if(voiceToolNeedsUserTurn(invocation.name)&&(!plain(invocation.turn)||!/^[a-f0-9]{32}$/.test(invocation.turn.turnId||'')))fail('canvas_voice_transcript_pending');
   if(['canvas_context','canvas_prepare_next_step','canvas_decision','canvas_voice_end'].includes(invocation.name)){
    if(Object.keys(args).length)fail('canvas_voice_tool_arguments_invalid');
    if(invocation.name==='canvas_context')return {ok:true,data:{...await readCanvasVoiceContext(env,scope),voiceDecision:await voiceDecisionContext(env,scope)}};
    if(invocation.name==='canvas_voice_end')return await endVoice(env,scope,invocation.turn.turnId);
    if(invocation.name==='canvas_prepare_next_step')return {ok:true,data:await prepareVoiceDecision(env,scope,invocation.turn.turnId)};
    return {ok:true,data:await applyVoiceDecision(env,scope,{turnId:invocation.turn.turnId,callId:invocation.callId},{canUsePresentation})};
   }
   const required=Object.keys(definitions.find(item=>item.name===invocation.name).parameters.properties);
   if(required.some(key=>!Object.hasOwn(args,key))||Object.keys(args).some(key=>!required.includes(key)))fail('canvas_voice_tool_arguments_invalid');
   if(invocation.name==='canvas_action')return {ok:true,data:await applyVoiceActions(env,scope,{...args,turnId:invocation.turn.turnId},{conversationRevision:conversationRevision(args)})};
   return {ok:true,data:await applyCanvasVoiceBrief(env,scope,{...args,turnId:invocation.turn.turnId,callId:invocation.callId},conversationRevision(args))};
  }catch(error){
   if(!allowedErrors.has(error?.code))throw error;
   const presentation=error.code==='canvas_voice_terms_not_presented'?await pendingVoicePresentation(env,scope):null;
   return {ok:false,code:error.code,requiresContextRefresh:['canvas_voice_source_changed','canvas_agent_conversation_changed','canvas_agent_decision_changed','canvas_agent_project_changed'].includes(error.code),
    ...(error.code==='canvas_voice_terms_not_presented'?{data:{presentation,spokenPrompt:presentation?.prompt||null},next:'Speak the current exact full prompt again; no approval was accepted.'}:{})};
  }
 };
}
