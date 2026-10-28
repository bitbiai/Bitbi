import {conversationRow,conversationView,canvasConversationReplyText,createConversationTurn} from '../../workers/auth/src/lib/canvas-agent-conversation.js';
import {applyCanvasVoiceBrief,recordCanvasVoiceReply,markCanvasVoiceReplyInterrupted} from '../../workers/auth/src/lib/canvas-voice-conversation.js';
import {CANVAS_AGENT_POLICY_VERSION} from '../../workers/shared/canvas-agent/manifest.mjs';
import {getModelTariff} from '../../workers/auth/src/lib/model-tariffs.js';
import {validateCanvasAgentDialogueInput,buildCanvasAgentDialoguePayload} from '../../workers/ai/src/lib/canvas-agent-dialogue.js';
const check=(value,message)=>{if(!value)throw new Error(message);};
async function reject(fn,code){try{await fn();}catch(error){check(error.code===code,`Expected ${code}, received ${error.code||'unclassified'}`);return;}throw new Error(`Expected ${code}`);}
export async function canvasVoiceTextContinuation(env,scope,transcript,proposal){
 const DB=env.DB,{userId,projectId,sessionId}=scope;
 await applyCanvasVoiceBrief(env,scope,proposal);
 const reply={turnId:transcript.turnId,responseId:'late-interrupted',text:'Bekannt. Diesen hinteren Teil hat die Wiedergabe nicht bestätigt.',interrupted:false};
 await recordCanvasVoiceReply(env,scope,reply);
 await DB.prepare("UPDATE canvas_voice_sessions SET state='completed' WHERE id=?").bind(sessionId).run();
 await markCanvasVoiceReplyInterrupted(env,scope,{responseId:reply.responseId,audioEndMs:150});
 check((await markCanvasVoiceReplyInterrupted(env,scope,{responseId:reply.responseId,audioEndMs:150})).replay,'Late interruption replay is idempotent after session completion');
 const original=await DB.prepare('SELECT assistant_text FROM canvas_agent_turns WHERE id=?').bind(transcript.turnId).first();
 check(original.assistant_text===reply.text,'Interruption retains immutable generated response evidence');
 await reject(()=>markCanvasVoiceReplyInterrupted(env,{...scope,userId:'foreign-user'},{responseId:reply.responseId,audioEndMs:150}),'canvas_voice_turn_unavailable');
 await reject(()=>markCanvasVoiceReplyInterrupted(env,scope,{responseId:reply.responseId,audioEndMs:150,transcript:'Invented provider prefix'}),'canvas_voice_interruption_invalid');
 const voice=await DB.prepare('SELECT interrupted,retained_text FROM canvas_voice_turns WHERE turn_id=?').bind(transcript.turnId).first();
 check(canvasConversationReplyText({assistant_text:original.assistant_text,voice_json:JSON.stringify({...voice,retainedText:voice.retained_text,locale:'de'})})==='Antwort unterbrochen; gesprochener Anteil nicht bestätigt.','Public unknown playback never repeats full unheard answer');
 const tariff=await getModelTariff(env);await DB.prepare('UPDATE canvas_agent_conversations SET allowance_credits=10000,allowance_tariff=? WHERE project_id=?').bind(tariff.revision,projectId).run();
 const wakes=[],scoped={...env,CANVAS_AGENT_ENABLED:'true',ENABLE_GROK_4_7:'true',CLOUDFLARE_ACCOUNT_ID:'0'.repeat(32),H3_CLOUDFLARE_API_TOKEN:'synthetic-not-live',AI_SERVICE_AUTH_SECRET:'synthetic-voice-transition-secret',
  AI_VIDEO_JOBS_QUEUE:{async send(body){wakes.push(body);}},PRIVATE_MEDIA_PROCESSOR:{async fetch(){throw new Error('Text continuation must not process media');}},
  AI_LAB:{async fetch(request){check(request.method==='GET'&&new URL(request.url).pathname==='/internal/ai/canvas-agent/readiness','Only signed configuration observation permitted');return Response.json({ok:true,protocolVersion:1,transport:'cloudflare-background',model:'xai/grok-4.7',available:true,accountAccess:'unverified',dialogueVersion:2,policyVersion:CANVAS_AGENT_POLICY_VERSION});}}};
 const row=await conversationRow(env,projectId,userId),project=await DB.prepare('SELECT * FROM canvas_projects WHERE id=?').bind(projectId).first();
 await createConversationTurn(scoped,{project},row,{text:'Bitte beschreibe die bereits geklärte Geschichte weiter.',locale:'de',expectedConversationRevision:row.revision,expectedBriefRevision:row.brief_revision},'explicit-typed-followup');
 const step=await DB.prepare('SELECT s.input_json FROM canvas_agent_steps s JOIN canvas_agent_runs r ON r.id=s.run_id WHERE r.project_id=?').bind(projectId).first(),payload=JSON.parse(step.input_json).payload;
 const history=payload.recentMessages.find(message=>message.id===transcript.turnId+'_reply');
 check(history.text==='Antwort unterbrochen; gesprochener Anteil nicht bestätigt.','Actual typed request excludes unconfirmed spoken continuation');
 const origin=payload.currentProject.conversationSources.find(message=>message.id===history.id);
 check(origin.playback==='not_verified'&&origin.provenance==='application'&&origin.kind==='voice_interruption','Trusted application delivery note travels outside strict text history schema');
 for(const model of ['xai/grok-4.7','anthropic/claude-fable-5']){
  const adapter=buildCanvasAgentDialoguePayload(validateCanvasAgentDialogueInput({...payload,model})),body=JSON.parse(adapter.messages.at(-1).content);
  check(body.recentMessages.find(message=>message.id===history.id).text===history.text&&body.brief.fields.style.value==='realistisch','Both text adapters preserve interrupted Voice context and canonical brief');
 }
 check(wakes.length===1,'Only explicit new typed message queues one text operation');
 await markCanvasVoiceReplyInterrupted(env,scope,{responseId:reply.responseId,audioEndMs:150,transcript:'Bekannt.'});
 const retained=await DB.prepare('SELECT retained_text FROM canvas_voice_turns WHERE turn_id=?').bind(transcript.turnId).first();check(retained.retained_text==='Bekannt.','Provider-acknowledged prefix is retained separately from original response');
 const publicReply=(await conversationView(scoped,projectId,userId)).conversation.messages.find(message=>message.id===transcript.turnId+':reply');
 check(publicReply.text==='Bekannt.'&&publicReply.provenance==='model'&&publicReply.delivery.source==='provider'&&publicReply.interrupted===true&&publicReply.playback==='not_verified','Retained provider prefix has truthful model attribution without claiming the whole response was heard');
 check((await DB.prepare('SELECT COUNT(*) AS n FROM member_ai_usage_attempts_v2').first()).n===0,'Neither voice projection nor text preparation dispatches or charges');
}
