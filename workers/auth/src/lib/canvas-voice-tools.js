import {CANVAS_AGENT_BRIEF_FIELDS} from '../../../shared/canvas-agent-dialogue.mjs';
import {readCanvasVoiceContext,applyCanvasVoiceBrief,prepareCanvasVoiceNextStep} from './canvas-voice-conversation.js';

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
 {type:'function',name:'canvas_prepare_next_step',description:'Describe missing information and the existing explicit confirmation required for the next production step. This does not create or execute a decision.',parameters:object({})},
];
const names=new Set(definitions.map(value=>value.name));
const fail=code=>{throw Object.assign(new Error(code),{code,status:400});};
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,180}$/.test(value);
const allowedErrors=new Set(['canvas_voice_tool_forbidden','canvas_voice_tool_arguments_invalid','canvas_voice_session_unavailable','canvas_voice_transcript_pending',
 'canvas_voice_brief_invalid','canvas_voice_format_invalid','canvas_voice_format_unavailable','canvas_voice_format_ambiguous','canvas_voice_duration_unconfirmed',
 'canvas_voice_read_only_turn','canvas_voice_source_changed','canvas_voice_turn_unavailable','canvas_agent_conversation_changed','canvas_agent_conversation_stopped','idempotency_conflict']);

export function canvasVoiceFunctionDefinitions(){return structuredClone(definitions);}
export function canvasVoiceToolDiagnostic(name,result){
 return {name:names.has(name)?name:'unknown',ok:result?.ok===true,
  ...(result?.ok===true?{}:{code:allowedErrors.has(result?.code)?result.code:'canvas_voice_tool_failed'})};
}
// Trusted scope is captured by the authenticated server/relay. Provider arguments
// cannot name another owner/project/session, source turn or durable call identity.
export function createCanvasVoiceToolDispatcher(env,trustedScope,{conversationRevision=()=>undefined}={}){
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
   if(invocation.name!=='canvas_update_brief'){
    if(Object.keys(args).length)fail('canvas_voice_tool_arguments_invalid');
    return {ok:true,data:await(invocation.name==='canvas_context'?readCanvasVoiceContext(env,scope):prepareCanvasVoiceNextStep(env,scope))};
   }
   const required=Object.keys(definitions[1].parameters.properties);
   if(required.some(key=>!Object.hasOwn(args,key))||Object.keys(args).some(key=>!required.includes(key)))fail('canvas_voice_tool_arguments_invalid');
   if(!plain(invocation.turn)||!/^[a-f0-9]{32}$/.test(invocation.turn.turnId||''))fail('canvas_voice_transcript_pending');
   return {ok:true,data:await applyCanvasVoiceBrief(env,scope,{...args,turnId:invocation.turn.turnId,callId:invocation.callId},conversationRevision(args))};
  }catch(error){
   if(!allowedErrors.has(error?.code))throw error;
   return {ok:false,code:error.code,requiresContextRefresh:['canvas_voice_source_changed','canvas_agent_conversation_changed'].includes(error.code)};
  }
 };
}
