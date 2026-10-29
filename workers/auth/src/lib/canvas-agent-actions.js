import { canvasMediaConstraintError } from './canvas-agent-media-errors.js';
import { validateCanvasAgentActions, CANVAS_AGENT_ACTION_TYPES, canvasImmediateStartRequested } from '../../../shared/canvas-agent-actions.mjs';
import { quoteCanvasMediaAction, canvasMediaActionEnvironment } from './canvas-agent-media-action.js';
import { canvasAgentProject, plannerProject, controlCanvasAgent, decideCanvasAgentBudget } from '../routes/canvas-agent.js';
import { writeCanvasAssembly } from './canvas-assembly.js';
import { originalAudioSettings } from '../../../../js/shared/canvas-audio.mjs';
import { validateCanvasAgentNodeConfig } from './canvas-agent-graph.js';
import { canvasAgentCapabilities } from './canvas-agent-capabilities.js';
import { canvasAssembly } from '../../../../js/shared/canvas-assembly.mjs';
import { exportMusicSettings } from '../../../../js/shared/canvas-export.mjs';
import { TRANSITIONS, transitionSettings } from '../../../../js/shared/canvas-transitions.mjs';
import { getCanvasModelForRole } from '../../../../js/shared/canvas-model-contract.mjs';
import { stablePricingJson, TARIFF_HEADER } from '../../../../js/shared/model-tariff.mjs';
import { getModelTariff, quoteModelTariff } from './model-tariffs.js';
import { saveCanvasExport } from './canvas-export-recipes.js';
import { saveCanvasMedia } from './canvas-media-storage.js';
import { enforceSensitiveUserRateLimit } from './sensitive-write-limit.js';
import { nowIso, sha256Hex, randomTokenHex } from './tokens.js';
import { agentFail, publicAgentRun } from './canvas-agent-store.js';
import { canvasConversationExecutionFacts, canvasConversationStatusText, canvasConversationReadIntent } from './canvas-agent-conversation-context.js';

const parse=value=>value?JSON.parse(value):null;
const runControl = new Set(['production_pause','production_resume','production_cancel','production_takeover']);
const briefControl={brief_save:'save',brief_resume:'resume',brief_cancel:'cancel',skip_questions:'skip_questions',delegate_duration:'delegate_duration',conversation_clear:'clear'};
const assemblyTypes=new Set(['clip_remove','clip_order','clip_add','clip_replace','clip_trim','transition','transition_strength','music_volume','music_enabled','music_fade_in','music_fade_out','music_source','smooth_joins']);
const safeCode=error=>{const failure=canvasMediaConstraintError(error);return /^[a-z][a-z0-9_]{2,100}$/.test(failure?.code||'')?failure.code:'canvas_agent_action_review_required';};
const responseData=async response=>{const result=await response.json();if(!response.ok||!result.ok)agentFail(result.code||'canvas_agent_action_failed',response.status);return result.data;};
const messages={
  completed:['Change saved.','Änderung gespeichert.'],pending:['The request was accepted. Its result is still pending.','Der Auftrag wurde angenommen. Das Ergebnis steht noch aus.'],
  confirmation_required:['Please confirm the displayed decision. Nothing has been authorized by the assistant.','Bitte bestätige die angezeigte Entscheidung. Der Assistent hat keine Freigabe erteilt.'],
  review_required:['This request needs review. It will not be repeated automatically.','Dieser Auftrag muss geprüft werden. Er wird nicht automatisch wiederholt.'],
  failed:['The requested change could not be applied. Your existing project is retained.','Die gewünschte Änderung konnte nicht angewendet werden. Dein bisheriges Projekt bleibt erhalten.'],
};
const label=(state,locale)=>messages[state]?.[locale==='de'?1:0]||messages.pending[locale==='de'?1:0];
const summary=(row,state,detail={})=>({code:detail.code||`canvas_agent_action_${state}`,text:label(state,parse(row.input_json).locale),effect:null,confirmation:null,...detail});
async function finish(env,row,state,result) {
  const previous=parse(row.result_json)||{};
  if(previous.confirmationInput)result={...result,confirmationInput:previous.confirmationInput};
  if(previous.confirmationVoice)result={...result,confirmationVoice:previous.confirmationVoice};
  const written=await env.DB.prepare('UPDATE canvas_agent_action_receipts SET state=?,result_json=?,updated_at=? WHERE id=? AND user_id=? AND state=? AND result_json IS ?')
    .bind(state,JSON.stringify(result),nowIso(),row.id,row.user_id,row.state,row.result_json).run();
  if(written.meta?.changes!==1)return env.DB.prepare('SELECT * FROM canvas_agent_action_receipts WHERE id=?').bind(row.id).first();
  if(['failed','review_required'].includes(state))await (await import('./canvas-agent-incidents.js')).captureCanvasProjectIncidents(env,row.project_id,row.user_id);
  return {...row,state,result_json:JSON.stringify(result)};
}
async function owned(env,userId,projectId){
  const user=await env.DB.prepare("SELECT id,role,status FROM users WHERE id=? AND status='active'").bind(userId).first();
  if(!user)agentFail('canvas_agent_authority_revoked');
  const view=await canvasAgentProject(env,userId,projectId);
  return {user,view};
}
function actionContext(env,user,projectId,key,path,body={},tariff=null,original=null){
  const headers=new Headers(original?.headers||{});headers.set('Content-Type','application/json');headers.set('Idempotency-Key',key);
  if(tariff!==null)headers.set(TARIFF_HEADER,String(tariff));
  const pathname=`/api/account/canvas/projects/${projectId}/${path}`;
  const request=new Request(new URL(pathname,original?.url||'https://canvas.internal'),{method:'POST',headers,body:JSON.stringify(body)});
  return {env,request,pathname,method:'POST',canvasUser:user,isSecure:true};
}
export async function canvasAgentActionControlId(env,projectId){
  const control=await env.DB.prepare(`SELECT c.run_id,c.request_key FROM canvas_agent_controls c JOIN canvas_agent_runs r ON r.id=c.run_id
    WHERE r.project_id=? AND c.action IN ('pause','cancel','takeover') ORDER BY c.rowid DESC LIMIT 1`).bind(projectId).first();
  const stop=await env.DB.prepare(`SELECT id FROM canvas_agent_action_receipts WHERE project_id=? AND state IN ('executing','completed')
    AND json_extract(input_json,'$.action.type') IN ('production_pause','production_cancel','production_takeover') ORDER BY rowid DESC LIMIT 1`).bind(projectId).first();
  return (await sha256Hex(stablePricingJson({control:control||null,stop:stop?.id||null}))).slice(0,32);
}
async function currentRun(env,projectId,userId){return env.DB.prepare("SELECT * FROM canvas_agent_runs WHERE project_id=? AND user_id=? AND purpose='production' ORDER BY created_at DESC,rowid DESC LIMIT 1").bind(projectId,userId).first();}

export async function canvasAgentActionContext(env,userId,projectId){
  const {view}=await owned(env,userId,projectId),run=await currentRun(env,projectId,userId);
  const project=plannerProject(view);project.nodes=project.nodes.map(node=>({...node,title:String(node.title||'').slice(0,60),
    config:Object.fromEntries(Object.entries(node.config||{}).filter(([key])=>['prompt','duration','aspectRatio','resolution','seed','steps','originalAudio','generateAudio','maxTokens','temperature'].includes(key)).map(([key,value])=>[key,typeof value==='string'?value.slice(0,160):value])),
    content:undefined,output:node.output?{kind:node.output.kind,assetId:node.output.assetId||null,sourceVersion:node.output.sourceVersion||null,runId:node.output.runId||null}:null}));
  // Reference edges and assembly order are different facts. Keep both, with
  // only their existing IDs/roles; never include imported metadata or URLs.
  project.edges=(project.edges||[]).map(edge=>({id:edge.id,sourceNodeId:edge.sourceNodeId,targetNodeId:edge.targetNodeId,
    role:typeof edge.config?.role==='string'?edge.config.role.slice(0,64):null,
    purpose:typeof edge.config?.purpose==='string'?edge.config.purpose.slice(0,64):null}));
  return {...project,revision:view.project.revision,lastControlId:await canvasAgentActionControlId(env,projectId),actionTypes:CANVAS_AGENT_ACTION_TYPES,
    transitions:TRANSITIONS.map(({id,parameter,min,max})=>({id,...parameter?{parameter,min,max}:{}})),
    production:run?{id:run.id,status:run.status,phase:run.phase,budgetCredits:run.budget_credits,budgetRevision:run.budget_revision,errorCode:run.error_code}:null,
    execution:await canvasConversationExecutionFacts(env,userId,projectId)};
}
export async function prepareCanvasAgentActionStatements(env,{userId,projectId,turnId,actions,expectedRevision,locale,expectedControlId,voiceSource=null}){
  const valid=validateCanvasAgentActions(actions,{projectRevision:expectedRevision});
  const controlId=expectedControlId===undefined?await canvasAgentActionControlId(env,projectId):expectedControlId;
  if(!/^[a-f0-9]{32}$/.test(controlId||''))agentFail('canvas_agent_action_context_invalid');
  const statements=[];
  for(let ordinal=0;ordinal<valid.length;ordinal++){
    const id=(await sha256Hex(`canvas-dialogue-action:${projectId}:${turnId}:${ordinal}`)).slice(0,32);
    const input={version:1,action:valid[ordinal],expectedRevision,expectedControlId:controlId,locale:locale==='de'?'de':'en',
      ...(voiceSource?{voice:{sessionId:voiceSource.sessionId,conversationRevision:voiceSource.conversationRevision,briefRevision:voiceSource.briefRevision}}:{})};
    statements.push(env.DB.prepare(`INSERT INTO canvas_agent_action_receipts(id,project_id,user_id,turn_id,ordinal,input_json,state,created_at,updated_at)
      VALUES(?,?,?,?,?,?,'proposed',?,?)`).bind(id,projectId,userId,turnId,ordinal,stablePricingJson(input),nowIso(),nowIso()));
  }
  return statements;
}
function publicAction(row){const result=parse(row.result_json)||{};return {id:row.id,turnId:row.turn_id,type:parse(row.input_json).action.type,state:result.pending?'pending':row.state,
  code:result.code||'canvas_agent_action_pending',text:result.text||label(result.pending?'pending':row.state,parse(row.input_json).locale),
  effect:result.effect||null,confirmation:result.confirmation||null};}
export async function publicCanvasAgentActions(env,projectId,userId){
  const rows=(await env.DB.prepare(`SELECT a.* FROM canvas_agent_action_receipts a JOIN canvas_agent_turns t ON t.id=a.turn_id
    WHERE a.project_id=? AND a.user_id=? AND t.state!='deleted' ORDER BY a.created_at,a.ordinal LIMIT 320`).bind(projectId,userId).all()).results||[];
  return rows.map(publicAction);
}
function changedAssembly(view,action){
  const current=parse(view.project.assembly_json);if(!current)agentFail('canvas_assembly_missing');
  const next=canvasAssembly(current),index=next.clips.findIndex(clip=>clip.nodeId===action.targetId);
  if(['clip_remove','clip_replace','clip_trim','transition','transition_strength'].includes(action.type)&&index<0)agentFail('canvas_assembly_sources_changed');
  if(action.type==='clip_remove')next.clips.splice(index,1);
  if(action.type==='clip_order'){
    if(action.ids.length!==next.clips.length||action.ids.some(id=>!next.clips.some(clip=>clip.nodeId===id)))agentFail('canvas_assembly_sources_changed');
    next.clips=action.ids.map(id=>next.clips.find(clip=>clip.nodeId===id));
  }
  if(action.type==='clip_add'){
    if(next.clips.some(clip=>clip.nodeId===action.targetId))agentFail('canvas_assembly_sources_changed');
    const at=action.number??next.clips.length;if(!Number.isSafeInteger(at)||at<0||at>next.clips.length)agentFail('canvas_agent_action_invalid');
    next.clips.splice(at,0,{nodeId:action.targetId,trim:{start:0},transition:{preset:'none'}});
  }
  if(action.type==='clip_replace')next.clips[index]={...next.clips[index],nodeId:action.ids[0],trim:{start:0}};
  if(action.type==='clip_trim')next.clips[index].trim={start:action.number,...action.secondaryNumber===null?{}:{duration:action.secondaryNumber}};
  if(action.type==='transition')next.clips[index].transition=transitionSettings({preset:action.value,...action.value==='none'?{}:{duration:action.number}});
  if(action.type==='transition_strength')next.clips[index].transition=transitionSettings({...next.clips[index].transition,strength:action.number});
  if(action.type.startsWith('music_')){
    next.backgroundMusic=exportMusicSettings(next.backgroundMusic);
    const property={music_volume:'gain',music_fade_in:'fadeIn',music_fade_out:'fadeOut'}[action.type];
    if(property)next.backgroundMusic[property]=action.number;
    if(action.type==='music_enabled')next.backgroundMusic.enabled=action.value==='on';
    if(action.type==='music_source'){
      const node=view.nodes.find(node=>node.id===action.targetId),output=parse(node?.output_json),content=parse(node?.content_json);
      const assetId=output?.assetId||output?.asset?.id||content?.asset?.id;
      if(!assetId)agentFail('canvas_assembly_music_invalid');
      next.musicNodeId=node.id;next.backgroundMusic.musicAssetId=assetId;
    }
  }
  if(action.type==='smooth_joins')next.smoothJoins=action.value==='on';
  return canvasAssembly(next);
}
async function regenerationQuote(env,user,view,action){
  const node=view.nodes.find(node=>node.id===action.targetId);if(!node)agentFail('node_not_found',404);
  const model=getCanvasModelForRole(node.model_id,'member');if(!model?.runnable||model.executionMode!=='member')agentFail('model_not_runnable');
  const {resolveCanvasNodeInputs,buildCanvasGenerationBody}=await import('../routes/canvas.js');
  const resolution=await resolveCanvasNodeInputs(env,user.id,view.project.id,node,model);
  if(resolution.errors?.length)agentFail('canvas_input_invalid');
  const input=buildCanvasGenerationBody(node,model,resolution),quote=await quoteModelTariff(env,{modelId:model.id,input});
  if(!Number.isSafeInteger(quote.credits)||quote.credits<1)agentFail('model_pricing_unavailable');
  return {credits:quote.credits,tariffRevision:(await getModelTariff(env)).revision,inputDigest:await sha256Hex(stablePricingJson(input)),modelId:model.id,
    ...await quoteCanvasMediaAction(env,user.id,view.project.id,model.id,quote.credits)};
}
async function prepareAction(env,row,user,view,expectedRevision){
  const {action,locale}=parse(row.input_json);
  const conversation=await env.DB.prepare('SELECT * FROM canvas_agent_conversations WHERE project_id=? AND user_id=?').bind(row.project_id,row.user_id).first();
  const base={expectedRevision,expectedBriefRevision:conversation.brief_revision,locale};
  if(assemblyTypes.has(action.type))return {...base,assembly:changedAssembly(view,action)};
  if(runControl.has(action.type)||['budget_accept','budget_decline','status'].includes(action.type)){
    const run=await currentRun(env,row.project_id,row.user_id);if(!run&&!['status','production_pause','production_cancel','production_takeover'].includes(action.type))agentFail('canvas_agent_not_found',404);
    const prepared={...base,runId:run?.id||null};
    if(['budget_accept','budget_decline'].includes(action.type)){
      const budget=await env.DB.prepare("SELECT * FROM canvas_agent_budget_requests WHERE run_id=? AND status='pending' ORDER BY created_at DESC LIMIT 1").bind(run.id).first();
      if(!budget)agentFail('canvas_agent_budget_request_invalid');
      prepared.body={requestId:budget.id,requestRevision:budget.revision,decision:action.type==='budget_accept'?'accept':'decline',proposedCapCredits:budget.proposed_cap,expectedRevision:budget.project_revision};
      prepared.tariffRevision=budget.tariff_revision;
    }
    return prepared;
  }
  if(briefControl[action.type])return {...base,body:{action:briefControl[action.type],expectedConversationRevision:conversation.revision,locale}};
  if(action.type==='allowance_propose'){
    const source=await env.DB.prepare('SELECT user_text FROM canvas_agent_turns WHERE id=? AND project_id=?').bind(row.turn_id,row.project_id).first();
    if(!/(?:gesprächsbudget|gesprächslimit|(?:briefing|conversation|chat)\s+(?:budget|allowance|limit))/iu.test(source?.user_text||''))agentFail('canvas_agent_budget_scope_required');
    return {...base,body:{capCredits:action.number,expectedConversationRevision:conversation.revision},tariffRevision:(await getModelTariff(env)).revision};
  }
  if(action.type==='regenerate')return {...base,...await regenerationQuote(env,user,view,action)};
  if(action.type.startsWith('node_')||action.type.startsWith('original_audio_')){
    const node=view.nodes.find(node=>node.id===action.targetId);if(!node)agentFail('node_not_found',404);
    const config=parse(node.config_json)||{};
    if(action.type==='node_parameter'){
      if(!['duration','seed','steps','width','height','maxTokens','temperature','safetyTolerance'].includes(action.value))agentFail('canvas_agent_action_parameter_invalid');
      const model=getCanvasModelForRole(node.model_id,'member');if(!model?.runnable)agentFail('model_not_runnable');
      validateCanvasAgentNodeConfig(model,{[action.value]:action.number},'');
      config[action.value]=action.number;
    }
    if(action.type==='node_prompt')config.prompt=action.value;
    if(action.type.startsWith('original_audio_')){
      if(!['video_generation','music_generation','asset_reference'].includes(node.type))agentFail('canvas_agent_parameter_unsupported');
      config.originalAudio=originalAudioSettings(config.originalAudio);
      const property={original_audio_volume:'gain',original_audio_fade_in:'fadeIn',original_audio_fade_out:'fadeOut'}[action.type];
      if(property)config.originalAudio[property]=action.number;else config.originalAudio.enabled=action.value==='on';
      config.originalAudio=originalAudioSettings(config.originalAudio);
    }
    if(action.type==='node_model'&&(!getCanvasModelForRole(action.value,'member')?.runnable||!(await canvasAgentCapabilities(env)).models.some(model=>model.id===action.value)))agentFail('model_not_runnable');
    if(action.type==='node_prompt'&&['text_prompt','note'].includes(node.type))return {...base,body:{content:{...parse(node.content_json),[node.type==='text_prompt'?'prompt':'text']:action.value}}};
    return {...base,body:action.type==='node_model'?{model_id:action.value}:{config}};
  }
  if(action.type==='export'){
    const assembly=parse(view.project.assembly_json);if(!assembly?.anchorNodeId)agentFail('canvas_assembly_missing');
    return {...base,anchorNodeId:assembly.anchorNodeId,body:{assemblyRevision:expectedRevision,backgroundMusic:exportMusicSettings(assembly.backgroundMusic),smoothJoins:assembly.smoothJoins===true}};
  }
  if(action.type==='focus_node'&&!view.nodes.some(node=>node.id===action.targetId))agentFail('node_not_found',404);
  return base;
}
function confirmationFor(row,prepared){
  const {action,voice}=parse(row.input_json),kind={allowance_propose:'allowance',budget_accept:'budget',regenerate:'regenerate',conversation_clear:'clear'}[action.type]
    ||(voice&&!['status','brief_summary','show_project','show_result','focus_node'].includes(action.type)?'voice':null);
  if(!kind)return null;
  return {kind,expectedRevision:prepared.expectedRevision,expectedBriefRevision:prepared.expectedBriefRevision,
    ...(prepared.tariffRevision!==undefined?{tariffRevision:prepared.tariffRevision}:{}),
    ...(kind==='allowance'?{capCredits:prepared.body.capCredits}:{}),...(kind==='budget'?{capCredits:prepared.body.proposedCapCredits}:{}),
    ...(kind==='regenerate'?{credits:prepared.credits,nodeId:action.targetId,
      ...(prepared.mediaPolicyRevision!==undefined?{mediaPolicyRevision:prepared.mediaPolicyRevision}:{})}: {})};
}
async function applyAction(env,row,user,view,prepared,originalRequest=null){
  const {action,locale}=parse(row.input_json),key=`canvas_action_${row.id}`,session={user};
  const ctx=(path,body,tariff)=>actionContext(env,user,row.project_id,key,path,body,tariff,originalRequest);
  if(assemblyTypes.has(action.type)){
    const saved=await writeCanvasAssembly(env,user.id,row.project_id,prepared.assembly,prepared.expectedRevision);
    return {revision:saved.revision,effect:{kind:'refresh'},text:locale==='de'?'Die Montage ist gespeichert. Ein neuer Export übernimmt die Änderung.':'The assembly is saved. A new export will include the change.'};
  }
  if(runControl.has(action.type)){
    const limited=await enforceSensitiveUserRateLimit(ctx('agent',{}),{userId:user.id,scope:'canvas-agent-write-user',maxRequests:30,windowMs:3600000,component:'canvas-agent'});if(limited)await responseData(limited);
    if(['production_pause','production_cancel','production_takeover'].includes(action.type)){
      await stopCanvasAgentActions(env,row.project_id,{exceptId:row.id});
      const {cancelCanvasImmediateIntents}=await import('./canvas-agent-immediate.js');
      await cancelCanvasImmediateIntents(env,row.project_id);
    }
    const actual=prepared.runId?await env.DB.prepare('SELECT status FROM canvas_agent_runs WHERE id=? AND user_id=?').bind(prepared.runId,user.id).first():null;
    if(!actual||['completed','cancelled','taken_over'].includes(actual.status)){
      if(action.type==='production_resume')agentFail('canvas_agent_control_closed');
      return {effect:{kind:'refresh'},text:locale==='de'?'Der vorgemerkte Start ist gestoppt. Es läuft keine weitere Produktion.':'The queued start is stopped. No further production is running.'};
    }
    const result=await responseData(await controlCanvasAgent(ctx(`agent/${prepared.runId}/control`,{action:action.type.replace('production_','')}),session,row.project_id,prepared.runId));
    return {effect:{kind:'refresh'},runId:result.run?.id,code:`canvas_agent_action_${action.type}`,text:locale==='de'
      ?{production_pause:'Die Produktion ist pausiert. Bereits angenommene Aufträge können noch fertig werden.',production_resume:'Die Produktion wird fortgesetzt.',production_cancel:'Neue Produktionsarbeit ist gestoppt. Bereits angenommene Aufträge können noch fertig werden.',production_takeover:'Du hast die manuelle Kontrolle über das Projekt übernommen.'}[action.type]
      :{production_pause:'Production is paused. Already accepted jobs may still finish.',production_resume:'Production is resuming.',production_cancel:'New production work is stopped. Already accepted jobs may still finish.',production_takeover:'You have taken manual control of the project.'}[action.type]};
  }
  if(briefControl[action.type]){
    const {controlCanvasConversation}=await import('../routes/canvas-agent-conversation.js');
    const conversation=await env.DB.prepare('SELECT * FROM canvas_agent_conversations WHERE project_id=? AND user_id=?').bind(row.project_id,user.id).first();
    const voiceConfirmation=parse(row.result_json)?.confirmationVoice;
    const body=voiceConfirmation?{...prepared.body,expectedConversationRevision:voiceConfirmation.conversationRevision}:prepared.body;
    await controlCanvasConversation(ctx('agent/conversation/control',body),conversation,body,key,locale,
      parse(row.input_json).voice?{voiceSource:{turnId:row.turn_id}}:{});
    return {effect:{kind:'refresh'},conversationRevision:conversation.revision+1,briefRevision:conversation.brief_revision+(['clear','skip_questions','delegate_duration'].includes(prepared.body.action)?1:0)};
  }
  if(action.type==='allowance_propose'){
    const {approveCanvasBriefingAllowance}=await import('../routes/canvas-agent-conversation.js');
    const conversation=await env.DB.prepare('SELECT * FROM canvas_agent_conversations WHERE project_id=? AND user_id=?').bind(row.project_id,user.id).first();
    await approveCanvasBriefingAllowance(ctx('agent/conversation/allowance',prepared.body,prepared.tariffRevision),conversation,prepared.body,key);
    const current=await env.DB.prepare('SELECT allowance_credits FROM canvas_agent_conversations WHERE project_id=? AND user_id=?').bind(row.project_id,user.id).first();
    return {effect:{kind:'refresh'},conversationRevision:conversation.revision+1,briefRevision:conversation.brief_revision,text:locale==='de'?`Das Gesprächsbudget ist mit ${current.allowance_credits} Credits freigegeben. Das Projektlimit der Produktion wurde dadurch nicht verändert.`:`The briefing allowance is authorized at ${current.allowance_credits} credits. This has not changed the production project cap.`};
  }
  if(['budget_accept','budget_decline'].includes(action.type)){
    const limited=await enforceSensitiveUserRateLimit(ctx('agent',{}),{userId:user.id,scope:'canvas-agent-write-user',maxRequests:30,windowMs:3600000,component:'canvas-agent'});if(limited)await responseData(limited);
    await responseData(await decideCanvasAgentBudget(ctx(`agent/${prepared.runId}/budget`,prepared.body,prepared.tariffRevision),session,row.project_id,prepared.runId));
    return {effect:{kind:'refresh'}};
  }
  if(action.type.startsWith('node_')||action.type.startsWith('original_audio_')){
    const {updateCanvasNode}=await import('../routes/canvas.js');
    const result=await responseData(await updateCanvasNode(ctx(`nodes/${action.targetId}`,prepared.body),user.id,row.project_id,action.targetId,{expectedRevision:prepared.expectedRevision}));
    if(action.type.startsWith('original_audio_'))return {revision:result.mutationRevision,effect:{kind:'focus_node',targetId:action.targetId},text:locale==='de'?'Die Toneinstellung ist gespeichert. Ein neuer Export übernimmt die Änderung.':'The audio setting is saved. A new export will include the change.'};
    return {revision:result.mutationRevision,effect:{kind:'focus_node',targetId:action.targetId},text:locale==='de'?'Die Knoteneinstellung ist gespeichert. Vorhandene Medien bleiben unverändert, bis du neu generierst.':'The node setting is saved. Existing media stays unchanged until you regenerate.'};
  }
  if(action.type==='regenerate'){
    if(!originalRequest)agentFail('canvas_agent_action_confirmation_required');
    const {runCanvasNode}=await import('../routes/canvas.js');
    const actionCtx=ctx(`nodes/${action.targetId}/run`,{},prepared.tariffRevision);
    actionCtx.env=canvasMediaActionEnvironment(env,row,prepared);
    const response=await runCanvasNode(actionCtx,session,row.project_id,action.targetId);
    const result=await response.json();
    const run=await env.DB.prepare('SELECT id,status,error_code FROM canvas_runs WHERE project_id=? AND user_id=? AND idempotency_key=?').bind(row.project_id,user.id,key).first();
    if(!run){if(!response.ok||!result.ok)agentFail(result.code||'canvas_agent_action_failed',response.status);agentFail('canvas_agent_action_review_required');}
    return {pending:run.status!=='completed',runId:run.id,effect:{kind:'focus_node',targetId:action.targetId},code:run.status==='completed'?'canvas_agent_action_regenerated':'canvas_agent_action_generation_pending'};
  }
  if(action.type==='export'){
    const {canvasExport}=await import('../routes/canvas-video-processing.js');
    const result=await responseData(await canvasExport(ctx(`nodes/${prepared.anchorNodeId}/full-video`,prepared.body),user.id,row.project_id,{nodeId:prepared.anchorNodeId}));
    const pending=!['ready','preview_pending'].includes(result.export?.status)||!result.export?.asset?.id;
    if(!pending)await saveCanvasExport(env,user.id,row.project_id,{nodeId:prepared.anchorNodeId},result.export.id);
    return {pending,exportId:result.export?.id,anchorNodeId:prepared.anchorNodeId,effect:{kind:'show_result',targetId:prepared.anchorNodeId}};
  }
  if(action.type==='save_result'){
    await saveCanvasMedia(env,user.id,row.project_id,action.targetId);return {effect:{kind:'refresh'}};
  }
  if(action.type==='focus_node')return {effect:{kind:'focus_node',targetId:action.targetId}};
  if(action.type==='show_project')return {effect:{kind:'show_project'}};
  if(action.type==='show_result'){
    const output=await env.DB.prepare("SELECT id,node_id,run_id FROM canvas_video_processing WHERE project_id=? AND user_id=? AND status IN ('ready','preview_pending') AND asset_id IS NOT NULL ORDER BY created_at DESC LIMIT 1").bind(row.project_id,user.id).first();
    if(!output)agentFail('canvas_agent_result_unavailable');
    const legacy= !output.node_id&&output.run_id?await env.DB.prepare('SELECT node_id FROM canvas_runs WHERE id=? AND project_id=? AND user_id=?').bind(output.run_id,row.project_id,user.id).first():null;
    const target=output.node_id||legacy?.node_id;
    return {effect:{kind:'show_result',...(target?{targetId:target}:{})},exportId:output.id};
  }
  if(action.type==='brief_summary'){
    const conversation=await env.DB.prepare('SELECT brief_json FROM canvas_agent_conversations WHERE project_id=? AND user_id=?').bind(row.project_id,user.id).first();
    const brief=parse(conversation.brief_json);return {text:[brief.fields.story?.value,brief.fields.style?.value,brief.fields.audio?.value,
      brief.duration.targetDurationSeconds?`${brief.duration.targetDurationSeconds} ${locale==='de'?'Sekunden':'seconds'}`:null].filter(Boolean).join('\n')|| (locale==='de'?'Noch keine Filmidee gespeichert.':'No film idea has been saved yet.')};
  }
  if(action.type==='status'){
    return {text:canvasConversationStatusText(await canvasConversationExecutionFacts(env,user.id,row.project_id),locale),effect:{kind:'refresh'}};
  }
  if(action.type==='start_now'){
    const turn=await env.DB.prepare('SELECT user_text FROM canvas_agent_turns WHERE id=? AND project_id=?').bind(row.turn_id,row.project_id).first();
    if(!canvasImmediateStartRequested(turn?.user_text))agentFail('canvas_agent_immediate_intent_required');
    const conversation=await env.DB.prepare('SELECT revision,brief_revision FROM canvas_agent_conversations WHERE project_id=? AND user_id=?').bind(row.project_id,user.id).first();
    const {createCanvasImmediateIntent}=await import('./canvas-agent-immediate.js');
    await createCanvasImmediateIntent(env,user.id,row.project_id,{text:turn.user_text,locale,delegateCreative:true,expectedConversationRevision:conversation.revision,
      expectedBriefRevision:conversation.brief_revision,expectedRevision:view.project.revision},key);
    return {pending:true,effect:{kind:'refresh'},code:'canvas_agent_immediate_requested'};
  }
  agentFail('canvas_agent_action_invalid',400);
}

async function executeOne(env,row,{request=null,confirmed=false,voiceGuard=[]}={}){
  const currentRow=await env.DB.prepare('SELECT * FROM canvas_agent_action_receipts WHERE id=?').bind(row.id).first();
  if(!currentRow)return row;row=currentRow;
  const input=parse(row.input_json),{action}=input;
  const {user,view}=await owned(env,row.user_id,row.project_id);
  // A stop fences future actions, never hides an already accepted node job.
  // This lookup cannot submit inference or repeat a generation.
  if(row.state==='executing'&&action.type==='regenerate'){
    const accepted=await env.DB.prepare('SELECT id,status,error_code FROM canvas_runs WHERE project_id=? AND user_id=? AND idempotency_key=?').bind(row.project_id,row.user_id,`canvas_action_${row.id}`).first();
    if(accepted)return finish(env,row,'completed',summary(row,accepted.status==='completed'?'completed':'pending',{
      pending:accepted.status!=='completed',runId:accepted.id,revision:view.project.revision,controlId:input.expectedControlId,
      effect:{kind:'focus_node',targetId:action.targetId}}));
  }
  // A completed stop/clear intentionally changes its source state. Subsequent
  // observation must retain the completed receipt, not relabel it as failure.
  if(['completed','failed','review_required'].includes(row.state))return row;
  const turn=await env.DB.prepare('SELECT state,user_text FROM canvas_agent_turns WHERE id=? AND project_id=?').bind(row.turn_id,row.project_id).first();
  const conversation=await env.DB.prepare('SELECT state FROM canvas_agent_conversations WHERE project_id=? AND user_id=?').bind(row.project_id,row.user_id).first();
  if((!conversation||conversation.state!=='active')&&!['brief_resume','status','brief_summary','show_project','show_result','focus_node'].includes(action.type)&&row.state!=='executing')return finish(env,row,'failed',summary(row,'failed',{code:'canvas_agent_conversation_stopped'}));
  if(!turn||['deleted','cancelled'].includes(turn.state))return finish(env,row,'failed',summary(row,'failed',{code:'canvas_agent_action_source_changed'}));
  if(row.state==='proposed'&&canvasConversationReadIntent(turn.user_text)&&!['status','brief_summary','show_project','show_result','focus_node'].includes(action.type))
    return finish(env,row,'failed',summary(row,'failed',{code:'canvas_agent_explanation_only'}));
  if(row.state==='confirmation_required'&&!confirmed)return row;
  const priorAction=await env.DB.prepare('SELECT state,result_json FROM canvas_agent_action_receipts WHERE turn_id=? AND ordinal<? ORDER BY ordinal DESC LIMIT 1').bind(row.turn_id,row.ordinal).first();
  const currentControlId=await canvasAgentActionControlId(env,row.project_id),expectedControlId=priorAction?.state==='completed'?(parse(priorAction.result_json)?.controlId??input.expectedControlId):input.expectedControlId;
  if(currentControlId!==expectedControlId&&!['status','brief_summary','show_project','show_result','focus_node','production_pause','production_cancel','production_takeover'].includes(action.type))
    return finish(env,row,'failed',summary(row,'failed',{code:'canvas_agent_stopped'}));
  let prepared=parse(row.result_json)?.prepared;
  if(row.state==='executing'){
    if(Date.now()-Date.parse(row.updated_at)<30000)return row;
    const current=parse(row.result_json)||{},claimed=JSON.stringify({...current,claimToken:randomTokenHex(16)});
    const renewed=await env.DB.prepare("UPDATE canvas_agent_action_receipts SET result_json=?,updated_at=? WHERE id=? AND state='executing' AND updated_at=? AND result_json IS ?").bind(claimed,nowIso(),row.id,row.updated_at,row.result_json).run();
    if(renewed.meta?.changes!==1)return env.DB.prepare('SELECT * FROM canvas_agent_action_receipts WHERE id=?').bind(row.id).first();
    row={...row,result_json:claimed};
    // No automatic replay of a non-idempotent or paid mutation. Reconcile the
    // exact intended state/job first; all other uncertainty remains visible.
    if(assemblyTypes.has(action.type)&&prepared?.assembly&&stablePricingJson(parse(view.project.assembly_json))===stablePricingJson(prepared.assembly)){
      return finish(env,row,'completed',summary(row,'completed',{revision:view.project.revision,effect:{kind:'refresh'}}));
    }
    if((action.type.startsWith('node_')||action.type.startsWith('original_audio_'))&&prepared?.body){
      const node=view.nodes.find(node=>node.id===action.targetId),matches=node&&Object.entries(prepared.body).every(([key,value])=>stablePricingJson(key==='config'?parse(node.config_json):key==='content'?parse(node.content_json):node[key])===stablePricingJson(value));
      if(matches)return finish(env,row,'completed',summary(row,'completed',{revision:view.project.revision,effect:{kind:'focus_node',targetId:action.targetId}}));
    }
    if(action.type==='regenerate'){
      const run=await env.DB.prepare('SELECT id,status FROM canvas_runs WHERE project_id=? AND user_id=? AND idempotency_key=?').bind(row.project_id,row.user_id,`canvas_action_${row.id}`).first();
      if(run)return finish(env,row,'completed',summary(row,run.status==='completed'?'completed':'pending',{runId:run.id,effect:{kind:'focus_node',targetId:action.targetId}}));
    }
    // Stored receipts for idempotent controls/exports can be queried/replayed
    // with the original immutable parameters; never issue a second generation.
    if(!(runControl.has(action.type)||briefControl[action.type]||['allowance_propose','budget_accept','budget_decline','export','save_result','start_now'].includes(action.type)))
      return finish(env,row,'review_required',summary(row,'review_required'));
  }else{
    const prior=await env.DB.prepare("SELECT state,result_json FROM canvas_agent_action_receipts WHERE turn_id=? AND ordinal<? ORDER BY ordinal DESC LIMIT 1").bind(row.turn_id,row.ordinal).first();
    if(prior&&['failed','review_required'].includes(prior.state))return finish(env,row,'failed',summary(row,'failed',{code:'canvas_agent_action_dependency_failed'}));
    if(prior&&(prior.state!=='completed'||parse(prior.result_json)?.pending))return row;
    const expectedRevision=prior?parse(prior.result_json)?.revision??input.expectedRevision:input.expectedRevision;
    if(view.project.revision!==expectedRevision&&!['status','brief_summary',...runControl].includes(action.type))return finish(env,row,'failed',summary(row,'failed',{code:'canvas_agent_project_changed'}));
    if(!prepared)prepared=await prepareAction(env,row,user,view,expectedRevision);
    const confirmation=confirmationFor(row,prepared);
    if(confirmation&&!confirmed)return finish(env,row,'confirmation_required',summary(row,'confirmation_required',{confirmation,prepared}));
    const claimResult=JSON.stringify({...parse(row.result_json),prepared,claimToken:randomTokenHex(16)});
    const claimStatement=env.DB.prepare("UPDATE canvas_agent_action_receipts SET state='executing',result_json=?,updated_at=? WHERE id=? AND state=? AND result_json IS ?").bind(claimResult,nowIso(),row.id,row.state,row.result_json);
    const claim=voiceGuard.length?(await env.DB.batch([...voiceGuard,claimStatement])).at(-1):await claimStatement.run();
    if(claim.meta?.changes!==1)return await env.DB.prepare('SELECT * FROM canvas_agent_action_receipts WHERE id=?').bind(row.id).first();
    row={...row,state:'executing',result_json:claimResult};
  }
  let result;
  try { result=await applyAction(env,row,user,view,prepared,request); }
  catch(error){error=canvasMediaConstraintError(error);if(Number(error.status)>=400&&Number(error.status)<500)return finish(env,row,'failed',summary(row,'failed',{code:safeCode(error)}));throw error;}
  const revision=(await canvasAgentProject(env,user.id,row.project_id)).project.revision;
  return finish(env,row,'completed',summary(row,result.pending?'pending':'completed',{...result,revision,
    ...(input.voice?{voiceRevision:{projectBefore:view.project.revision,projectAfter:result.revision??view.project.revision,
      ...(result.conversationRevision!==undefined?{conversationAfter:result.conversationRevision,briefAfter:result.briefRevision}:{})}}:{}),
    controlId:await canvasAgentActionControlId(env,row.project_id)}));
}
export async function executeCanvasAgentActions(env,{userId,projectId,turnId}){
  await owned(env,userId,projectId);
  const rows=(await env.DB.prepare('SELECT * FROM canvas_agent_action_receipts WHERE project_id=? AND user_id=? AND turn_id=? ORDER BY ordinal').bind(projectId,userId,turnId).all()).results||[];
  for(const row of rows){
    try {const result=await executeOne(env,row);
      if(['failed','review_required'].includes(result.state)){
        const following=(await env.DB.prepare("SELECT * FROM canvas_agent_action_receipts WHERE turn_id=? AND ordinal>? AND state='proposed'").bind(row.turn_id,row.ordinal).all()).results||[];
        for(const next of following)await finish(env,next,'failed',summary(next,'failed',{code:'canvas_agent_action_dependency_failed'}));
        break;
      }
      if(result.state!=='completed'||parse(result.result_json)?.pending)break;}
    catch(error){
      const current=await env.DB.prepare('SELECT * FROM canvas_agent_action_receipts WHERE id=?').bind(row.id).first();
      if(current.state==='proposed'||current.state==='confirmation_required')
        await finish(env,current,'failed',summary(current,'failed',{code:safeCode(error)}));
      // An interrupted storage write remains executing. Recovery observes its
      // original receipt after the short claim window; it never guesses failure.
      break;
    }
  }
  return publicCanvasAgentActions(env,projectId,userId);
}
export async function recoverCanvasAgentActions(env,{projectId=null,userId=null,limit=12}={}){
  const rows=(await env.DB.prepare(`SELECT DISTINCT project_id,user_id,turn_id FROM canvas_agent_action_receipts
    WHERE (state IN ('proposed','executing') OR state='completed' AND json_extract(result_json,'$.pending')=1) AND (? IS NULL OR project_id=?) AND (? IS NULL OR user_id=?) ORDER BY created_at LIMIT ?`)
    .bind(projectId,projectId,userId,userId,Math.min(32,limit)).all()).results||[];
  for(const row of rows){
    const pending=(await env.DB.prepare("SELECT * FROM canvas_agent_action_receipts WHERE turn_id=? AND state='completed' AND json_extract(result_json,'$.pending')=1").bind(row.turn_id).all()).results||[];
    for(const receipt of pending){
      const result=parse(receipt.result_json),type=parse(receipt.input_json).action.type;
      const source=type==='regenerate'?await env.DB.prepare('SELECT status,error_code FROM canvas_runs WHERE id=? AND user_id=? AND project_id=?').bind(result.runId,row.user_id,row.project_id).first()
        :type==='export'?await env.DB.prepare('SELECT status,error_code FROM canvas_video_processing WHERE id=? AND user_id=? AND project_id=?').bind(result.exportId,row.user_id,row.project_id).first():null;
      if(source&&(type==='export'?['ready','preview_pending'].includes(source.status):source.status==='completed')){
        if(type==='export')await saveCanvasExport(env,row.user_id,row.project_id,{nodeId:result.anchorNodeId},result.exportId);
        await finish(env,receipt,'completed',summary(receipt,'completed',{...result,pending:false,text:label('completed',parse(receipt.input_json).locale)}));
      }
      else if(type==='start_now'){
        const intent=await env.DB.prepare('SELECT state,run_id,error_code FROM canvas_agent_start_intents WHERE project_id=? AND user_id=? AND request_key=?').bind(row.project_id,row.user_id,`canvas_action_${receipt.id}`).first();
        if(intent?.state==='started')await finish(env,receipt,'completed',summary(receipt,'completed',{...result,pending:false,runId:intent.run_id,text:parse(receipt.input_json).locale==='de'?'Die Produktion wurde gestartet.':'Production has started.'}));
        else if(['blocked','cancelled'].includes(intent?.state))await finish(env,receipt,'failed',summary(receipt,'failed',{code:safeCode({code:intent.error_code})}));
      }
      else if(source?.status==='failed'&&!['canvas_video_pending','canvas_image_save_pending'].includes(source.error_code))
        await finish(env,receipt,'review_required',summary(receipt,'review_required',{code:safeCode({code:source.error_code})}));
    }
    await executeCanvasAgentActions(env,{userId:row.user_id,projectId:row.project_id,turnId:row.turn_id});
  }
}
export async function confirmCanvasAgentAction(ctx,session,projectId,id,body,{voiceGuard=[],voiceSource=null}={}){
  const fields=['decision','expectedRevision','expectedBriefRevision','capCredits','tariffRevision','credits','mediaPolicyRevision'];
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!fields.includes(key))||!['accept','decline'].includes(body.decision))agentFail('canvas_agent_action_confirmation_invalid',400);
  const row=await ctx.env.DB.prepare('SELECT * FROM canvas_agent_action_receipts WHERE id=? AND project_id=? AND user_id=?').bind(id,projectId,session.user.id).first();
  if(!row)agentFail('canvas_agent_action_not_found',404);
  const confirmationInput=stablePricingJson(body);
  if(['completed','failed'].includes(row.state)){
    if(parse(row.result_json)?.confirmationInput!==confirmationInput)agentFail('idempotency_conflict');
    return publicAction(row);
  }
  if(row.state!=='confirmation_required')agentFail('canvas_agent_action_review_required');
  const stored=parse(row.result_json),confirmation=stored.confirmation;
  for(const [key,value] of Object.entries(confirmation))if(!['kind','nodeId'].includes(key)&&body[key]!==value)agentFail('canvas_agent_action_confirmation_changed');
  if(Object.keys(body).some(key=>key!=='decision'&&!Object.hasOwn(confirmation,key)))agentFail('canvas_agent_action_confirmation_invalid',400);
  const {user,view}=await owned(ctx.env,session.user.id,projectId);
  const conversation=await ctx.env.DB.prepare('SELECT brief_revision FROM canvas_agent_conversations WHERE project_id=? AND user_id=?').bind(projectId,user.id).first();
  if(view.project.revision!==confirmation.expectedRevision||conversation.brief_revision!==confirmation.expectedBriefRevision)agentFail('canvas_agent_project_changed');
  if(body.decision==='decline')return publicAction(await finish(ctx.env,row,'failed',summary(row,'failed',{confirmationInput,...(voiceSource?{confirmationVoice:voiceSource}:{}),code:'canvas_agent_action_declined',text:parse(row.input_json).locale==='de'?'Nicht freigegeben. Es wurde kein neuer Auftrag gestartet.':'Not approved. No new job was started.'})));
  if(confirmation.kind==='regenerate'){
    const current=await regenerationQuote(ctx.env,user,view,parse(row.input_json).action);
    if(current.mediaPolicyRevision!==stored.prepared.mediaPolicyRevision||current.projectCapRunId!==stored.prepared.projectCapRunId)agentFail('canvas_agent_media_policy_changed');
    if(current.credits!==confirmation.credits||current.tariffRevision!==confirmation.tariffRevision||current.inputDigest!==stored.prepared.inputDigest)agentFail('model_pricing_stale');
  }
  const bound=JSON.stringify({...stored,confirmationInput,...(voiceSource?{confirmationVoice:voiceSource}:{})});
  const bindStatement=ctx.env.DB.prepare("UPDATE canvas_agent_action_receipts SET result_json=? WHERE id=? AND state='confirmation_required' AND result_json IS ?").bind(bound,row.id,row.result_json);
  const binding=voiceGuard.length?(await ctx.env.DB.batch([...voiceGuard,bindStatement])).at(-1):await bindStatement.run();
  if(binding.meta?.changes!==1)agentFail('canvas_agent_action_confirmation_changed');
  const result=await executeOne(ctx.env,{...row,result_json:bound},{request:ctx.request,confirmed:true,voiceGuard});
  await executeCanvasAgentActions(ctx.env,{userId:user.id,projectId,turnId:row.turn_id});
  return publicAction(result);
}

export async function stopCanvasAgentActions(env,projectId,{exceptId=null}={}){
  const rows=(await env.DB.prepare("SELECT * FROM canvas_agent_action_receipts WHERE project_id=? AND state IN ('proposed','confirmation_required') AND (? IS NULL OR id!=?)").bind(projectId,exceptId,exceptId).all()).results||[];
  for(const row of rows)if(!['production_pause','production_cancel','production_takeover','status'].includes(parse(row.input_json).action.type))
    await finish(env,row,'failed',summary(row,'failed',{code:'canvas_agent_stopped'}));
}
