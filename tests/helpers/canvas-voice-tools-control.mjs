import {CanvasVoiceRelay} from '../../workers/auth/src/lib/canvas-voice-relay.js';
import {canvasVoiceSettings} from '../../js/shared/canvas-voice-settings.mjs';
import {canvasVoiceCapabilities} from '../../workers/auth/src/lib/canvas-voice-settings.js';
import {canvasVoiceFunctionDefinitions,createCanvasVoiceToolDispatcher} from '../../workers/auth/src/lib/canvas-voice-tools.js';
import {buildCanvasVoiceSession,verifyCanvasVoiceSessionAck} from '../../workers/auth/src/lib/canvas-voice-provider.js';
import {readCanvasVoiceContext,recordCanvasVoiceUserTurn,recordCanvasVoiceReply} from '../../workers/auth/src/lib/canvas-voice-conversation.js';
import {conversationRow} from '../../workers/auth/src/lib/canvas-agent-conversation.js';
import {sha256Hex} from '../../workers/auth/src/lib/tokens.js';
const check=(value,message)=>{if(!value)throw new Error(message);};
export async function canvasVoiceToolsCase(env,scope){
 const settings=canvasVoiceSettings({tools:{canvas:{enabled:true}}}),dispatcher=createCanvasVoiceToolDispatcher(env,scope),initial=await readCanvasVoiceContext(env,scope);
 const definitions=canvasVoiceFunctionDefinitions(),expected=buildCanvasVoiceSession(settings,{capabilities:canvasVoiceCapabilities(),instructions:initial.instructions,
  tools:definitions,allowedServerTools:definitions.map(value=>value.name)});
 const sent=[],upstream=[],invocations=[],now=Date.now();
 const services={authorize:async()=>{await readCanvasVoiceContext(env,scope);return true;},recordExposure:async()=>{throw new Error('No audio or billed exposure in tool fixture');},
  configuration:()=>expected,verifyConfiguration:session=>verifyCanvasVoiceSessionAck({type:'session.updated',session},expected),active:async()=>{},
  seedContext:async()=>({type:'conversation.item.create',item:{type:'message',role:'user',content:[{type:'input_text',text:JSON.stringify(initial)}]}}),
  userTurn:value=>recordCanvasVoiceUserTurn(env,scope,value),reply:value=>recordCanvasVoiceReply(env,scope,{turnId:value.turn.turnId,responseId:value.responseId,text:value.text,interrupted:value.interrupted}),
  tool:async value=>{invocations.push(structuredClone(value));return dispatcher(value);},response:()=>({type:'response.create'}),interrupted:async()=>{},ended:async()=>{}};
 const relay=new CanvasVoiceRelay({client:{send:raw=>sent.push(JSON.parse(raw)),close(){}},provider:{send:raw=>upstream.push(JSON.parse(raw)),close(){}},
  session:{id:scope.sessionId,expiresAt:new Date(now+60000).toISOString(),settings},services,setTimer:()=>1,clearTimer:()=>{}});
 const provider=value=>relay.providerMessage(JSON.stringify(value));let event=0;
 const call=async(name,args,callId)=>{
  const responseId='response_'+callId;
  await provider({type:'response.created',response:{id:responseId}});
  await provider({type:'response.function_call_arguments.done',event_id:'event_'+(++event),response_id:responseId,call_id:callId,name,arguments:JSON.stringify(args)});
  await provider({type:'response.done',response:{id:responseId,status:'completed'}});
  check(!relay.closed,'Valid and rejected tool results keep the admitted synthetic session observable');
  return JSON.parse(upstream.find(value=>value.item?.call_id===callId).item.output);
 };
 await provider({type:'session.created'});await provider({type:'session.updated',session:expected.session});
 check(expected.session.tools.map(value=>value.name).join(',')==='canvas_context,canvas_update_brief,canvas_prepare_next_step,canvas_decision,canvas_action,canvas_voice_end','Actual provider configuration contains only the fixed guarded Canvas functions');
 check((await call('canvas_context',{},'read_before')).data.briefRevision===0,'Tool reads current canonical state without a user command');
 await provider({type:'input_audio_buffer.committed',item_id:'spoken_cat'});
 await provider({type:'conversation.item.input_audio_transcription.completed',item_id:'spoken_cat',transcript:'Ein Katzenvideo, 45 Sekunden lang, im Cartoon-Stil und 16:9.'});
 const fresh=(await call('canvas_context',{},'read_current')).data;
 const args={expectedConversationRevision:fresh.conversationRevision,expectedBriefRevision:fresh.briefRevision,expectedProjectRevision:fresh.projectRevision,
  updates:[{field:'story',value:'Eine Katze erkundet den Garten.',provenance:'user_stated'},{field:'style',value:'Cartoon',provenance:'user_stated'}],questions:['Welche Auflösung?'],
  format:{aspectRatio:'16:9',resolution:null,provenance:'user_stated'},duration:{choice:'explicit',targetDurationSeconds:45}};
 const applied=await call('canvas_update_brief',args,'apply_current');check(applied.ok&&applied.data.applied,'Real relay dispatcher applies the source-associated canonical brief');
 const saved=await conversationRow(env,scope.projectId,scope.userId),count=invocations.length,original=invocations.at(-1);
 await provider({type:'response.function_call_arguments.done',event_id:'replayed_event',response_id:'response_apply_current',call_id:'apply_current',name:'canvas_update_brief',arguments:JSON.stringify(args)});
 check(invocations.length===count,'Relay replay never reexecutes a tool');
 check((await dispatcher(original)).data.replay,'Durable canonical replay also protects a reconstructed relay');
 const forged=await call('canvas_update_brief',{...args,projectId:'f'.repeat(32)},'forged_owner');check(!forged.ok&&forged.code==='canvas_voice_tool_arguments_invalid','Model cannot supply trusted identity');
 const stale=await call('canvas_update_brief',args,'stale_edit');check(!stale.ok&&stale.code==='canvas_agent_conversation_changed'&&stale.requiresContextRefresh,'Stale proposal asks for current context without another action');
 const next=await call('canvas_prepare_next_step',{},'next_step');check(next.ok&&next.data.executed===false&&next.data.requiresExplicitConfirmation,'Next-step tool cannot authorize or launch production');
 check((await dispatcher({...original,name:'production_start',arguments:{}})).code==='canvas_voice_tool_forbidden','No hidden production command');
 check((await createCanvasVoiceToolDispatcher(env,{...scope,userId:'foreign-user'})({...original,name:'canvas_context',arguments:{}})).code==='canvas_voice_session_unavailable','Captured foreign scope cannot read context');
 const after=await conversationRow(env,scope.projectId,scope.userId);
 check(after.brief_json===saved.brief_json&&after.brief_revision===saved.brief_revision&&after.revision===saved.revision+1,'Only preparing the shared budget question advances conversation; rejected tools preserve creative state');
 check(next.data.presentation?.targetKind==='decision'&&next.data.spokenPrompt.includes('Credits'),'Budget question has a server-owned exact presentation, not spending authority');
 check((await env.DB.prepare('SELECT COUNT(*) AS n FROM canvas_voice_calls WHERE session_id=? AND call_id NOT LIKE \'presentation-proposal:%\'').bind(scope.sessionId).first()).n===1,'One persisted creative mutation; question provenance is separate');
 definitions[0].parameters.properties.userId={type:'string'};check(!canvasVoiceFunctionDefinitions()[0].parameters.properties.userId,'Returned schema cannot change authoritative definition');
 await provider({type:'input_audio_buffer.committed',item_id:'spoken-end'});
 await provider({type:'conversation.item.input_audio_transcription.completed',item_id:'spoken-end',transcript:'Voice beenden'});
 await provider({type:'response.created',response:{id:'end-voice-response'}});
 await provider({type:'response.function_call_arguments.done',event_id:'end-voice-event',response_id:'end-voice-response',call_id:'end-voice-call',name:'canvas_voice_end',arguments:'{}'});
 check(relay.closed&&sent.at(-1).type==='voice.ended'&&sent.at(-1).code==='canvas_voice_stopped','Explicit spoken end closes the actual relay cleanly without another response or production');
 await env.DB.prepare("UPDATE canvas_voice_sessions SET state='completed' WHERE id=?").bind(scope.sessionId).run();
 const disabledId=(await sha256Hex('disabled-tools-'+scope.sessionId)).slice(0,32);
 await env.DB.prepare(`INSERT INTO canvas_voice_sessions(id,project_id,user_id,request_key,state,conversation_revision,brief_revision,project_revision,settings_json,created_at,expires_at)
  VALUES(?,?,?,'disabled-tools','active',0,0,0,'{}',?,?)`).bind(disabledId,scope.projectId,scope.userId,new Date().toISOString(),new Date(Date.now()+60000).toISOString()).run();
 check((await createCanvasVoiceToolDispatcher(env,{...scope,sessionId:disabledId})({...original,name:'canvas_context',arguments:{}})).code==='canvas_voice_tool_forbidden','Persisted tools-off policy independently rejects a forged relay configuration');
}
