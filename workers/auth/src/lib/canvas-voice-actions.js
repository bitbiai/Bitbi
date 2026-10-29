import {validateCanvasAgentActions} from '../../../shared/canvas-agent-actions.mjs';
import {stablePricingJson} from '../../../../js/shared/model-tariff.mjs';
import {canvasVoiceSource} from './canvas-voice-conversation.js';
import {prepareCanvasAgentActionStatements,executeCanvasAgentActions,confirmCanvasAgentAction,canvasAgentActionControlId} from './canvas-agent-actions.js';
import {saveVoicePresentation,voiceDecisionSourceGuard,prepareVoiceDecision} from './canvas-voice-decisions.js';
import {nowIso} from './tokens.js';

const parse=value=>JSON.parse(value||'null');
const fail=code=>{throw Object.assign(new Error(code),{code,status:409});};
const reads=new Set(['status','brief_summary','show_project','show_result','focus_node']);
const names={brief_save:['save the briefing','Briefing speichern'],brief_resume:['resume the briefing','Briefing fortsetzen'],brief_cancel:['cancel the briefing','Briefing abbrechen'],
 skip_questions:['delegate optional creative choices','optionale kreative Entscheidungen delegieren'],delegate_duration:['delegate the film duration','die Filmdauer delegieren'],
 production_pause:['pause production','Produktion pausieren'],production_resume:['resume production within its existing authorization','Produktion innerhalb der bestehenden Freigabe fortsetzen'],
 production_cancel:['cancel further production work','weitere Produktionsarbeit abbrechen'],production_takeover:['take manual control of production','Produktion manuell übernehmen'],
 budget_accept:['approve the proposed production cap','das vorgeschlagene Produktionslimit freigeben'],budget_decline:['decline the proposed production cap','das vorgeschlagene Produktionslimit ablehnen'],
 conversation_clear:['clear this conversation and brief','dieses Gespräch und Briefing leeren'],clip_remove:['remove the clip from the assembly','Clip aus der Montage entfernen'],
 clip_order:['change the clip order','Clip-Reihenfolge ändern'],clip_add:['add the clip to the assembly','Clip zur Montage hinzufügen'],clip_replace:['replace the assembly clip','Montage-Clip ersetzen'],
 clip_trim:['change the clip trim','Clip-Zuschnitt ändern'],transition:['change the transition','Übergang ändern'],transition_strength:['change transition strength','Übergangsstärke ändern'],
 music_volume:['change music volume','Musiklautstärke ändern'],music_enabled:['switch background music','Hintergrundmusik umschalten'],music_fade_in:['change music fade-in','Musik-Einblendung ändern'],
 music_fade_out:['change music fade-out','Musik-Ausblendung ändern'],music_source:['change background music','Hintergrundmusik wechseln'],smooth_joins:['switch smooth joins','weiche Übergänge umschalten'],
 node_prompt:['change the node prompt','Knoten-Prompt ändern'],node_model:['change the node model','Knoten-Modell ändern'],node_parameter:['change the node parameter','Knoten-Parameter ändern'],
 original_audio_volume:['change original audio volume','Originalton-Lautstärke ändern'],original_audio_enabled:['switch original audio','Originalton umschalten'],
 original_audio_fade_in:['change original audio fade-in','Originalton-Einblendung ändern'],original_audio_fade_out:['change original audio fade-out','Originalton-Ausblendung ändern'],
 regenerate:['generate a new variant','eine neue Variante generieren'],export:['export the current montage','die aktuelle Montage exportieren'],save_result:['save the existing result','das vorhandene Ergebnis speichern']};
async function actionPresentation(env,scope,source,row){
 const input=parse(row.input_json),result=parse(row.result_json),action=input.action,confirmation=result?.confirmation;
 if(row.state!=='confirmation_required'||!confirmation)return null;
 const de=input.locale==='de',label=names[action.type]?.[de?1:0];if(!label)fail('canvas_voice_action_unavailable');
 const target=action.targetId?await env.DB.prepare('SELECT title FROM canvas_nodes WHERE id=? AND project_id=? AND user_id=? AND deleted_at IS NULL').bind(action.targetId,scope.projectId,scope.userId).first():null;
 const details=[target?.title,...(action.ids.length?[action.ids.map(id=>id.slice(0,8)).join(', ')]:[]),action.value,action.number,action.secondaryNumber].filter(value=>value!==null&&value!==undefined&&value!=='').join(' · ');
 const cost=confirmation.capCredits!=null?(de?`Höchstlimit: ${confirmation.capCredits} Credits.`:`Maximum cap: ${confirmation.capCredits} credits.`)
  :confirmation.credits!=null?(de?`Freigabe für ${confirmation.credits} Credits.`:`Authorization for ${confirmation.credits} credits.`)
  :(de?'Dies erteilt keine neue Freigabe für kostenpflichtige Generierungen.':'This does not authorize new paid generations.');
 const consequence=['conversation_clear','skip_questions','delegate_duration'].includes(action.type)?(de?' Eine laufende Produktion wird wegen der Briefingänderung pausiert.':' An active production will pause because its briefing changes.')
  :['brief_save','brief_cancel'].includes(action.type)?(de?' Das beendet dieses Voice-Briefing; eine bereits freigegebene Produktion läuft weiter.':' This ends this Voice briefing; an already authorized production continues.') :'';
 const prompt=de?`Soll ich ${label}${details?`: ${details}`:''}? ${cost}${consequence} Bereits angenommene Aufträge und ihre Kosten bleiben erhalten. Bestätige diese Aktion mit „Ja“ oder lehne sie mit „Nein“ ab.`
  :`Shall I ${label}${details?`: ${details}`:''}? ${cost}${consequence} Already accepted work and its costs remain unchanged. Confirm this action with “Yes” or decline with “No”.`;
 return saveVoicePresentation(env,scope,{targetKind:'action',targetId:row.id,targetRevision:0,questionConversationRevision:input.voice.conversationRevision,
  conversationRevision:input.voice.conversationRevision,briefRevision:confirmation.expectedBriefRevision,projectRevision:confirmation.expectedRevision,prompt});
}
const currentAction=(env,scope,turnId=null)=>env.DB.prepare(`SELECT a.* FROM canvas_agent_action_receipts a JOIN canvas_voice_turns v ON v.turn_id=a.turn_id
 WHERE a.project_id=? AND a.user_id=? AND v.session_id=? AND (? IS NULL OR a.turn_id=?)
 AND (? IS NOT NULL OR a.state='confirmation_required') ORDER BY a.rowid DESC LIMIT 1`).bind(scope.projectId,scope.userId,scope.sessionId,turnId,turnId,turnId).first();
export const pendingVoiceAction=(env,scope)=>currentAction(env,scope);
export async function reconcileVoiceAction(env,scope,turnId){
 const row=await env.DB.prepare(`SELECT * FROM canvas_agent_action_receipts WHERE project_id=? AND user_id=?
  AND json_extract(result_json,'$.confirmationVoice.sessionId')=? AND json_extract(result_json,'$.confirmationVoice.turnId')=? ORDER BY rowid DESC LIMIT 1`)
  .bind(scope.projectId,scope.userId,scope.sessionId,turnId).first();
 if(!row)return null;
 const source=parse(row.result_json).confirmationVoice;
 return {...await resultFor(env,scope,{row:{revision:source.conversationRevision,brief_revision:source.briefRevision},session:{current_project_revision:source.projectRevision}},row),replay:true};
}
async function resultFor(env,scope,source,row){
 const result=parse(row.result_json)||{},proof=result.voiceRevision,presentation=await actionPresentation(env,scope,source,row);
 return {handled:true,executed:row.state==='completed',revisionBefore:source.row.revision,
  conversationRevision:proof?.conversationAfter??source.row.revision,briefRevision:proof?.briefAfter??source.row.brief_revision,
  projectRevision:proof?.projectAfter??source.session.current_project_revision,
  ...(proof&&row.state==='completed'?{projectRevisionBefore:proof.projectBefore,actionId:row.id,controlId:result.controlId}:{}),runId:result.runId||null,
  actions:[{id:row.id,type:parse(row.input_json).action.type,state:result.pending?'pending':row.state,text:result.text,code:result.code,effect:result.effect||null}],
  presentation,spokenPrompt:presentation?.prompt||result.text||null};
}
export async function applyVoiceActions(env,scope,input,{conversationRevision}={}){
 if(!Array.isArray(input.actions)||input.actions.length!==1)fail('canvas_voice_action_invalid');
 validateCanvasAgentActions(input.actions,{projectRevision:input.expectedProjectRevision});
 const identity=stablePricingJson(input),key='voice-action:'+input.turnId;
 const prior=await env.DB.prepare('SELECT * FROM canvas_voice_calls WHERE session_id=? AND call_id=?').bind(scope.sessionId,key).first();
 if(prior){if(prior.input_json!==identity)fail('idempotency_conflict');return {...parse(prior.result_json),replay:true};}
 const source=await canvasVoiceSource(env,scope,input.turnId),action=input.actions[0],text=source.turn.user_text;
 if(source.row.revision!==(conversationRevision??input.expectedConversationRevision)||source.row.brief_revision!==input.expectedBriefRevision||source.session.current_project_revision!==input.expectedProjectRevision)fail('canvas_agent_conversation_changed');
 if(action.type==='start_now')return prepareVoiceDecision(env,scope,input.turnId);
 if(action.type==='allowance_propose')fail('canvas_voice_use_decision');
 // A bare "stop" is not a production cancellation. Quoted script dialogue and
 // hypothetical instructions are never authority to propose destructive work.
 if(!reads.has(action.type)&&(/^[\s,.!?]*(?:stop|stopp|halt|pause|yes|ja|no|nein)[\s,.!?]*$/iu.test(text)
  ||/["“”«»`]/u.test(text)||/\b(?:hypothetical|hypothetisch|if|wenn|sagt|says)\b/iu.test(text)))fail('canvas_voice_action_clarification_required');
 const existing=await currentAction(env,scope,input.turnId);
 if(existing){if(stablePricingJson(parse(existing.input_json).action)!==stablePricingJson(action))fail('idempotency_conflict');}
 else await env.DB.batch([...source.guard,
  env.DB.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM canvas_projects WHERE id=? AND user_id=? AND revision=? AND deleted_at IS NULL) THEN 1 ELSE json_extract('[]','$[') END").bind(scope.projectId,scope.userId,input.expectedProjectRevision),
  ...await prepareCanvasAgentActionStatements(env,{userId:scope.userId,projectId:scope.projectId,turnId:input.turnId,actions:input.actions,
   expectedRevision:input.expectedProjectRevision,locale:source.session.locale,expectedControlId:await canvasAgentActionControlId(env,scope.projectId),
   voiceSource:{sessionId:scope.sessionId,conversationRevision:source.row.revision,briefRevision:source.row.brief_revision}})]);
 await executeCanvasAgentActions(env,{userId:scope.userId,projectId:scope.projectId,turnId:input.turnId});
 const row=await currentAction(env,scope,input.turnId),result=await resultFor(env,scope,source,row);
 await env.DB.prepare('INSERT INTO canvas_voice_calls(session_id,call_id,input_json,result_json,created_at) VALUES(?,?,?,?,?)').bind(scope.sessionId,key,identity,JSON.stringify(result),nowIso()).run();
 return result;
}
export async function confirmVoiceAction(env,scope,source,row,decision,canUsePresentation){
 const authority=await voiceDecisionSourceGuard(env,scope,source,{targetKind:'action',targetId:row.id,targetRevision:0},canUsePresentation),confirmation=parse(row.result_json).confirmation;
 const body={decision,...Object.fromEntries(Object.entries(confirmation).filter(([key])=>!['kind','nodeId'].includes(key)))};
 const ctx={env,request:new Request('https://canvas.internal/api/account/canvas/projects/'+scope.projectId+'/agent/actions/'+row.id,{method:'POST'}),isSecure:true};
 await confirmCanvasAgentAction(ctx,{user:{id:scope.userId}},scope.projectId,row.id,body,{voiceGuard:authority.guard,
  voiceSource:{sessionId:scope.sessionId,turnId:source.turn.id,conversationRevision:source.row.revision,briefRevision:source.row.brief_revision,
   projectRevision:source.session.current_project_revision,presentationKey:authority.presentation.key}});
 return resultFor(env,scope,source,await currentAction(env,scope,row.turn_id));
}
