import {CANVAS_AGENT_MODEL} from '../../../../js/shared/canvas-agent-contract.mjs';
import {canvasConversationDecisionIntent,canvasConversationBudgetClarification} from '../../../../js/shared/canvas-conversation-decision-intent.mjs';
import {detectCanvasDirectControl} from '../../../../js/shared/canvas-agent-control-intent.mjs';
import {stablePricingJson,TARIFF_HEADER} from '../../../../js/shared/model-tariff.mjs';
import {nowIso,randomTokenHex} from './tokens.js';
import {agentFail} from './canvas-agent-store.js';
import {getModelTariff} from './model-tariffs.js';
import {canvasAgentProject,startCanvasAgent} from '../routes/canvas-agent.js';
import {ensureConversation,conversationGuard,conversationCosts,canvasConversationBlocker,productionBrief,userDuration,durationQuestion} from './canvas-agent-conversation.js';
import {quoteCanvasImmediateScope,validCanvasAssistantQuoteAdmission} from './canvas-agent-immediate.js';
import {canvasConversationReadIntent} from './canvas-agent-conversation-context.js';

const retainedBriefMarker='… [Full user brief retained in the conversation.]';
const parse=value=>JSON.parse(value||'null');
const current=(env,projectId)=>env.DB.prepare("SELECT * FROM canvas_agent_conversation_decisions WHERE project_id=? AND state='pending' ORDER BY rowid DESC LIMIT 1").bind(projectId).first();
const selection=row=>({modelId:row.assistant_model_id||CANVAS_AGENT_MODEL,modelRevision:row.assistant_model_revision||0});
const briefReady=brief=>Boolean(brief.fields.story?.value)&&(brief.duration.choice==='delegated'||brief.duration.targetDurationSeconds>0);
const question=locale=>locale==='de'?'Wie viele Credits darf der gesamte Film höchstens kosten? Nenne mir dein Projektlimit, zum Beispiel „3000 Credits“. Erst danach frage ich dich ausdrücklich nach dem Start.':'What is the maximum credit budget for the whole film? Tell me your project cap, for example “3000 Credits”. I will then ask you explicitly whether to start.';
const noDecision=locale=>locale==='de'?'Es gibt gerade keine aktuelle Startfreigabe. Nenne mir zunächst dein Projektlimit in Credits; deine Filmidee bleibt gespeichert.':'There is no current start approval to confirm. First tell me your project cap in credits; your film idea is saved.';
const runActive=(env,projectId)=>env.DB.prepare("SELECT id FROM canvas_agent_runs WHERE project_id=? AND purpose='production' AND status NOT IN ('completed','cancelled','taken_over') LIMIT 1").bind(projectId).first();
function turnStatement(env,row,input,key,id,text,briefRevision=row.brief_revision){
 return env.DB.prepare(`INSERT INTO canvas_agent_turns(id,project_id,request_key,input_json,conversation_revision,brief_revision,user_text,assistant_text,state,created_at,updated_at)
 VALUES(?,?,?,?,?,?,?,?,'completed',?,?)`).bind(id,row.project_id,key,stablePricingJson(input),row.revision+1,briefRevision,input.text,text,nowIso(),nowIso());
}
async function localReply(env,row,input,key,text,{brief=null,guard=[],statements=[],id=randomTokenHex(16),voiceSource=null}={}){
 const next=brief?.revision??row.brief_revision;
 await env.DB.batch([conversationGuard(env,row),...(voiceSource?.guard||[]),...guard,env.DB.prepare(voiceSource
  ?'UPDATE canvas_agent_conversations SET revision=revision+1,brief_revision=?,brief_json=?,updated_at=? WHERE project_id=?'
  :'UPDATE canvas_agent_conversations SET revision=revision+1,brief_revision=?,brief_json=?,draft=\'\',updated_at=? WHERE project_id=?').bind(next,brief?JSON.stringify(brief):row.brief_json,nowIso(),row.project_id),
  ...(voiceSource?[]:[turnStatement(env,row,input,key,id,text,next)]),...statements]);
 if(voiceSource)voiceSource.outcome={text,revisionBefore:row.revision,conversationRevision:row.revision+1,briefRevision:next};
 return id;
}
function decisionGuard(env,decision,scope,voiceSource=null){
 return env.DB.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM canvas_agent_conversation_decisions d
 JOIN canvas_projects p ON p.id=d.project_id JOIN canvas_agent_conversations c ON c.project_id=d.project_id JOIN users u ON u.id=d.user_id
 WHERE d.id=? AND d.user_id=? AND d.project_id=? AND d.state='pending' AND d.revision=? AND d.expires_at>?
 AND p.user_id=d.user_id AND p.deleted_at IS NULL AND p.revision=? AND c.brief_revision=? AND c.assistant_model_id=? AND c.assistant_model_revision=?
 AND c.revision=? AND c.state='active' AND u.status='active') THEN 1 ELSE json_extract('[]','$[') END`)
 .bind(decision.id,decision.user_id,decision.project_id,decision.revision,nowIso(),scope.projectRevision,scope.briefRevision,scope.modelId,scope.modelRevision,voiceSource?.conversationRevision??scope.confirmationConversationRevision??scope.questionConversationRevision);
}
function insertDecision(env,row,{id,key,kind,input,scope,sourceTurnId=null}){
 const now=nowIso();
 return env.DB.prepare(`INSERT INTO canvas_agent_conversation_decisions(id,project_id,user_id,request_key,kind,state,input_json,scope_json,source_turn_id,created_at,updated_at,expires_at)
 VALUES(?,?,?,?,?,'pending',?,?,?,?,?,?)`).bind(id,row.project_id,row.user_id,key,kind,stablePricingJson(input),JSON.stringify(scope),sourceTurnId,now,now,new Date(Date.now()+30*60000).toISOString());
}
async function boundScope(env,row,view){
 const brief=parse(row.brief_json),tariff=await getModelTariff(env);
 let completeBrief=productionBrief(row);
 if(brief.fields.story?.value?.endsWith(retainedBriefMarker)&&brief.fields.story.sourceMessageId){
  const source=await env.DB.prepare("SELECT user_text FROM canvas_agent_turns WHERE id=? AND project_id=? AND state!='deleted'").bind(brief.fields.story.sourceMessageId,row.project_id).first();
  if(source?.user_text)completeBrief+='\nOriginal user brief: '+source.user_text;
 }
 return {questionConversationRevision:row.revision+1,projectRevision:view.project.revision,mediaPolicyRevision:view.project.media_policy_revision||0,briefRevision:row.brief_revision,...selection(row),tariffRevision:tariff.revision,
  brief:completeBrief,story:brief.fields.story?.value||'',targetDurationSeconds:brief.duration.targetDurationSeconds,durationChoice:brief.duration.choice,locale:view.project.locale==='de'?'de':'en'};
}
async function assertCurrent(env,row,view,decision,voiceSource=null){
 const scope=parse(decision.scope_json);
 if(decision.user_id!==row.user_id||decision.project_id!==row.project_id)agentFail('canvas_agent_decision_not_found',404);
 if(decision.state!=='pending'||decision.expires_at<=nowIso())agentFail('canvas_agent_decision_expired');
 if((scope.mediaPolicyRevision??0)!==(view.project.media_policy_revision||0))agentFail('canvas_agent_media_policy_changed');
 const projected=voiceSource?.kind==='voice'&&voiceSource.decisionId===decision.id&&voiceSource.questionConversationRevision===scope.questionConversationRevision&&voiceSource.conversationRevision===row.revision&&voiceSource.presentationVerified===true;
 // Switching to an explicit text/button answer immediately after the exact
 // spoken question uses that same persisted presentation. Any later turn or
 // unrelated edit advances revision and invalidates this narrow projection.
 const delivered=!voiceSource&&scope.questionConversationRevision!==row.revision?await env.DB.prepare(`SELECT 1 AS ok FROM canvas_voice_calls r
  JOIN canvas_voice_sessions s ON s.id=r.session_id JOIN canvas_voice_turns v ON v.session_id=s.id AND v.provider_response_id=json_extract(r.result_json,'$.responseId')
  JOIN canvas_agent_turns t ON t.id=v.turn_id WHERE s.project_id=? AND s.user_id=? AND r.call_id LIKE 'presentation:%' AND v.interrupted=0 AND t.state='completed'
  AND json_extract(r.result_json,'$.targetKind')='decision' AND json_extract(r.result_json,'$.targetId')=? AND json_extract(r.result_json,'$.targetRevision')=?
  AND json_extract(r.result_json,'$.questionConversationRevision')=? AND json_extract(r.result_json,'$.conversationRevision')=? LIMIT 1`)
  .bind(row.project_id,row.user_id,decision.id,decision.revision,scope.questionConversationRevision,row.revision).first():null;
 if((scope.questionConversationRevision!==row.revision&&!projected&&!delivered)||scope.projectRevision!==view.project.revision||scope.briefRevision!==row.brief_revision||scope.modelId!==selection(row).modelId||scope.modelRevision!==selection(row).modelRevision)agentFail('canvas_agent_decision_changed');
 if(scope.quote&&!validCanvasAssistantQuoteAdmission(scope.quote))agentFail('model_pricing_stale');
 if(scope.tariffRevision!==(await getModelTariff(env)).revision)agentFail('model_pricing_stale');
 if(row.state!=='active')agentFail('canvas_agent_conversation_stopped');
 return delivered?{...scope,confirmationConversationRevision:row.revision}:scope;
}
export async function publicCanvasConversationDecision(env,projectId,userId){
 const decision=await current(env,projectId);if(!decision||decision.user_id!==userId)return null;
 const scope=parse(decision.scope_json),row=await ensureConversation(env,projectId,userId),view=await canvasAgentProject(env,userId,projectId);
 let code=null;try{await assertCurrent(env,row,view,decision);}catch(error){code=error.code||'canvas_agent_decision_changed';}
 return {id:decision.id,revision:decision.revision,kind:decision.kind,state:code?'stale':'pending',code,expiresAt:decision.expires_at,
  scope:{story:scope.story,targetDurationSeconds:scope.targetDurationSeconds,durationChoice:scope.durationChoice,capCredits:scope.capCredits??null,
   modelId:scope.modelId,modelRevision:scope.modelRevision,mediaPolicyRevision:scope.mediaPolicyRevision??0,tariffRevision:scope.tariffRevision,expectedRevision:scope.projectRevision,expectedBriefRevision:scope.briefRevision},quote:scope.quote||null};
}
export async function ensureCanvasConversationBudgetQuestion(env,projectId,userId,{voiceSource=null}={}){
 const row=await ensureConversation(env,projectId,userId),brief=parse(row.brief_json);
 if(row.state!=='active'||!briefReady(brief)||await current(env,projectId)||await runActive(env,projectId)||await canvasConversationBlocker(env,projectId))return;
 if(await env.DB.prepare("SELECT id FROM canvas_agent_start_intents WHERE project_id=? AND state IN ('waiting','approval_required','authorized') LIMIT 1").bind(projectId).first())return;
 const view=await canvasAgentProject(env,userId,projectId),scope=await boundScope(env,row,view),id=randomTokenHex(16),key='budget-question:'+id;
 const input={text:'',locale:scope.locale,expectedConversationRevision:row.revision,expectedBriefRevision:row.brief_revision};
 await localReply(env,row,input,key,question(scope.locale),{voiceSource,statements:[insertDecision(env,row,{id,key,kind:'production_budget',input,scope,sourceTurnId:voiceSource?.turnId||null})]});
}
export function canvasConversationDecisionPrompt(decision){
 const scope=parse(decision.scope_json);
 if(decision.kind==='production_budget')return question(scope.locale);
 if(decision.kind==='production_start')return startSummary(scope);
 return scope.locale==='de'?`Gesprächsbudget: insgesamt höchstens ${scope.capCredits} Credits für Modellantworten in diesem Projekt. Das startet keinen Film und gibt keine Mediengenerierung frei. Soll ich dieses Gesprächsbudget freigeben?`
  :`Briefing allowance: at most ${scope.capCredits} credits in total for model replies in this project. This does not start a film or authorize media generation. Shall I authorize this briefing allowance?`;
}
function startSummary(scope){
 const duration=scope.targetDurationSeconds?`${scope.targetDurationSeconds} s`:(scope.locale==='de'?'Dauer ausdrücklich überlassen':'duration explicitly delegated');
 return scope.locale==='de'?`${duration} · ${scope.story}\nProjektlimit: ${scope.capCredits} Credits, einschließlich bereits beauftragter Gesprächskosten, Planung, Medien und Prüfung. Das ist eine Obergrenze, keine sofortige Gesamtbelastung. Soll ich den Film jetzt starten? Antworte mit „Ja“ oder nutze die Freigabe unten.`
  :`${duration} · ${scope.story}\nProject cap: ${scope.capCredits} credits, including committed conversation costs, planning, media and review. This is a ceiling, not an immediate total charge. Shall I start the film now? Reply “Yes” or use the approval below.`;
}
async function proposeStart(env,row,view,input,key,capCredits,prior,{authorizeNow=false,voiceSource=null}={}){
 const original=await env.DB.prepare('SELECT * FROM canvas_agent_conversation_decisions WHERE project_id=? AND request_key=?').bind(row.project_id,'proposal:'+key).first();
 if(original){if(original.input_json!==stablePricingJson(input))agentFail('idempotency_conflict');return original;}
 const brief=parse(row.brief_json);if(!briefReady(brief))agentFail('canvas_agent_duration_required',400);
 if(await runActive(env,row.project_id))agentFail('canvas_agent_already_active');
 if(await canvasConversationBlocker(env,row.project_id))agentFail('canvas_agent_conversation_pending');
 const scope={...await boundScope(env,row,view),questionConversationRevision:row.revision+(authorizeNow?0:1),locale:input.locale,capCredits},id=randomTokenHex(16);
 scope.quote=await quoteCanvasImmediateScope(env,{id,user_id:row.user_id,project_id:row.project_id},scope,view);
 if(capCredits<scope.quote.committedCredits+scope.quote.planningCredits)agentFail('canvas_agent_budget_exceeded');
 const statements=[];
 if(prior)statements.push(env.DB.prepare("UPDATE canvas_agent_conversation_decisions SET state='cancelled',revision=revision+1,updated_at=? WHERE id=? AND state='pending'").bind(nowIso(),prior.id));
 statements.push(insertDecision(env,row,{id,key:'proposal:'+key,kind:'production_start',input,scope,sourceTurnId:voiceSource?.turnId||null}));
 if(authorizeNow)await env.DB.batch([conversationGuard(env,row),...statements]);
 else await localReply(env,row,input,key,startSummary(scope),{statements,voiceSource});
 return env.DB.prepare('SELECT * FROM canvas_agent_conversation_decisions WHERE id=?').bind(id).first();
}
async function proposeAllowance(env,row,view,input,key,capCredits,prior,voiceSource=null){
 const scope={...await boundScope(env,row,view),locale:input.locale,capCredits},id=randomTokenHex(16),statements=[];
 if(prior)statements.push(env.DB.prepare("UPDATE canvas_agent_conversation_decisions SET state='cancelled',revision=revision+1,updated_at=? WHERE id=? AND state='pending'").bind(nowIso(),prior.id));
 statements.push(insertDecision(env,row,{id,key:'allowance:'+key,kind:'briefing_allowance',input,scope,sourceTurnId:voiceSource?.turnId||null}));
 const text=input.locale==='de'?`Gesprächsbudget: insgesamt höchstens ${capCredits} Credits für Modellantworten in diesem Projekt. Das startet keinen Film und gibt keine Mediengenerierung frei. Soll ich dieses Gesprächsbudget freigeben?`
  :`Briefing allowance: at most ${capCredits} credits in total for model replies in this project. This does not start a film or authorize media generation. Shall I authorize this briefing allowance?`;
 await localReply(env,row,input,key,text,{statements,voiceSource});
}
export async function confirmCanvasConversationDecision(ctx,session,projectId,input,key,{message=null,voiceSource=null}={}){
 const row=await ensureConversation(ctx.env,projectId,session.user.id),view=await canvasAgentProject(ctx.env,session.user.id,projectId);
 if(!input||Object.keys(input).some(k=>!['decisionId','decisionRevision','decision','expectedConversationRevision','expectedBriefRevision'].includes(k))||!['accept','decline'].includes(input.decision)||!/^[a-f0-9]{32}$/.test(input.decisionId||''))agentFail('canvas_agent_decision_invalid',400);
 const decision=await ctx.env.DB.prepare('SELECT * FROM canvas_agent_conversation_decisions WHERE id=? AND project_id=? AND user_id=?').bind(input.decisionId,projectId,session.user.id).first();
 if(!decision)agentFail('canvas_agent_decision_not_found',404);
 const identity=stablePricingJson({kind:'decision',...input});
 const previous=await ctx.env.DB.prepare('SELECT input_json FROM canvas_agent_conversation_actions WHERE project_id=? AND request_key=?').bind(projectId,key).first();
 if(previous){if(previous.input_json!==identity)agentFail('idempotency_conflict');return true;}
 const receipt=()=>ctx.env.DB.prepare('INSERT INTO canvas_agent_conversation_actions(project_id,request_key,input_json,created_at) VALUES(?,?,?,?)').bind(projectId,key,identity,nowIso());
 if(decision.revision!==input.decisionRevision||row.revision!==input.expectedConversationRevision||row.brief_revision!==input.expectedBriefRevision)agentFail('canvas_agent_decision_changed');
 if(voiceSource&&input.decision==='accept'&&voiceSource.presentationVerified!==true)agentFail('canvas_voice_terms_not_presented');
 const scope=await assertCurrent(ctx.env,row,view,decision,voiceSource);
 if(!['production_start','briefing_allowance'].includes(decision.kind))agentFail('canvas_agent_decision_invalid',400);
 const turn=message||{text:input.decision==='accept'?(scope.locale==='de'?'Ja, starte.':'Yes, start.'):(scope.locale==='de'?'Nein, noch nicht.':'No, not yet.'),locale:scope.locale,...input};
 if(input.decision==='decline'){
  await localReply(ctx.env,row,turn,key,scope.locale==='de'?'Der Film wird nicht gestartet. Deine Projektidee bleibt gespeichert.':'The film will not start. Your project brief is saved.',{voiceSource,guard:[decisionGuard(ctx.env,decision,scope,voiceSource)],statements:[receipt(),ctx.env.DB.prepare("UPDATE canvas_agent_conversation_decisions SET state='cancelled',decision_key=?,revision=revision+1,updated_at=? WHERE id=?").bind(key,nowIso(),decision.id)]});return true;
 }
 if(decision.kind==='briefing_allowance'){
  const {approveCanvasBriefingAllowance}=await import('../routes/canvas-agent-conversation.js');
  const request=new Request(ctx.request.url,{method:'POST',headers:{'Content-Type':'application/json',[TARIFF_HEADER]:String(scope.tariffRevision)}});
  await approveCanvasBriefingAllowance({...ctx,request},row,{capCredits:scope.capCredits,expectedConversationRevision:row.revision},'decision-allowance:'+decision.id,{guard:[...(voiceSource?.guard||[]),decisionGuard(ctx.env,decision,scope,voiceSource)],after:[receipt(),
   ctx.env.DB.prepare("UPDATE canvas_agent_conversation_decisions SET state='consumed',decision_key=?,revision=revision+1,updated_at=? WHERE id=? AND state='pending'").bind(key,nowIso(),decision.id),
   ...(voiceSource?[]:[turnStatement(ctx.env,row,turn,key,randomTokenHex(16),scope.locale==='de'?'Das Gesprächsbudget ist freigegeben. Es wurde keine Produktion gestartet.':'The briefing allowance is authorized. No production has started.')])
  ]});if(voiceSource)voiceSource.outcome={text:scope.locale==='de'?'Das Gesprächsbudget ist freigegeben. Es wurde keine Produktion gestartet.':'The briefing allowance is authorized. No production has started.',revisionBefore:row.revision,conversationRevision:row.revision+1,briefRevision:row.brief_revision,projectRevision:scope.projectRevision};return true;
 }
 if(await canvasConversationBlocker(ctx.env,projectId))agentFail('canvas_agent_conversation_pending');
 const held=await ctx.env.DB.prepare("SELECT o.id FROM canvas_agent_model_operations o JOIN canvas_agent_runs r ON r.id=o.run_id WHERE r.project_id=? AND o.state IN ('dispatching','pending','unknown','received') LIMIT 1").bind(projectId).first();
 if(held)agentFail('canvas_agent_provider_review_required');
 const body={brief:scope.brief,targetDurationSeconds:scope.targetDurationSeconds,durationChoice:scope.durationChoice,budgetCredits:scope.capCredits,mediaPolicyRevision:scope.mediaPolicyRevision??0,
  expectedRevision:scope.projectRevision,locale:scope.locale};
 const request=new Request(ctx.request,{body:JSON.stringify(body),headers:{'Content-Type':'application/json','Idempotency-Key':'decision:'+decision.id,[TARIFF_HEADER]:String(scope.tariffRevision)}});
 const result=await startCanvasAgent({...ctx,request},session,projectId,{briefRevision:scope.briefRevision,assistantModelId:scope.modelId,assistantModelRevision:scope.modelRevision,guard:[conversationGuard(ctx.env,row),...(voiceSource?.guard||[]),decisionGuard(ctx.env,decision,scope,voiceSource)],afterStart:runId=>[
  receipt(),
  ctx.env.DB.prepare("UPDATE canvas_agent_conversation_decisions SET state='consumed',decision_key=?,run_id=?,revision=revision+1,updated_at=? WHERE id=? AND state='pending'").bind(key,runId,nowIso(),decision.id),
  ctx.env.DB.prepare('UPDATE canvas_agent_conversations SET revision=revision+1,updated_at=? WHERE project_id=?').bind(nowIso(),projectId),
  ...(voiceSource?[]:[turnStatement(ctx.env,row,turn,key,randomTokenHex(16),scope.locale==='de'?'Deine Freigabe ist gespeichert. Die Produktion startet innerhalb deines Projektlimits.':'Your approval is saved. Production starts within your project cap.')])
 ]});
 if(!result.ok){const error=await result.json();agentFail(error.code||'canvas_agent_start_review_required',result.status);}
 if(voiceSource){const accepted=await result.json();voiceSource.outcome={text:scope.locale==='de'?'Deine Freigabe ist gespeichert. Die Produktion startet innerhalb deines Projektlimits.':'Your approval is saved. Production starts within your project cap.',revisionBefore:row.revision,conversationRevision:row.revision+1,briefRevision:row.brief_revision,projectRevision:scope.projectRevision,runId:accepted.data?.run?.id};}return true;
}
export async function handleCanvasConversationDecisionMessage(ctx,session,view,row,input,key,{voiceSource=null}={}){
 if(detectCanvasDirectControl(input.text)||canvasConversationReadIntent(input.text))return false;
 const env=ctx.env,brief=parse(row.brief_json),pending=await current(env,row.project_id),intent=canvasConversationDecisionIntent(input.text,{locale:input.locale,budgetAsked:pending?.kind==='production_budget'&&(parse(pending.scope_json).questionConversationRevision===row.revision||voiceSource?.presentationVerified===true&&voiceSource.decisionId===pending.id)});
 const count=await env.DB.prepare("SELECT COUNT(*) AS n FROM canvas_agent_turns t WHERE project_id=? AND state!='deleted' AND NOT EXISTS(SELECT 1 FROM canvas_agent_incident_explanations x WHERE x.turn_id=t.id)").bind(row.project_id).first();
 if(count.n>=80)agentFail('canvas_agent_conversation_limit');
 if(intent?.kind==='invalid_cap')agentFail('canvas_agent_budget_required',400);
 if(intent?.kind==='accept'||intent?.kind==='decline'){
  if(!pending||!['production_start','briefing_allowance'].includes(pending.kind)){await localReply(env,row,input,key,noDecision(input.locale),{voiceSource});return true;}
  return confirmCanvasConversationDecision(ctx,session,row.project_id,{decisionId:pending.id,decisionRevision:pending.revision,decision:intent.kind,expectedConversationRevision:row.revision,expectedBriefRevision:row.brief_revision},key,{message:input,voiceSource});
 }
 if(intent?.kind==='allowance_cap'){await proposeAllowance(env,row,view,input,key,intent.capCredits,pending,voiceSource);return true;}
 if(intent?.kind==='cap'){
  // A newly stated cap proposes a fresh decision. It cannot reuse an expired
  // scope; only an affirmative reply is restricted to the displayed old scope.
  const decision=await proposeStart(env,row,view,input,key,intent.capCredits,pending,{authorizeNow:intent.explicitStart&&!voiceSource,voiceSource});
  if(intent.explicitStart&&!voiceSource){const fresh=await ensureConversation(env,row.project_id,row.user_id);await confirmCanvasConversationDecision(ctx,session,row.project_id,{decisionId:decision.id,decisionRevision:decision.revision,decision:'accept',expectedConversationRevision:fresh.revision,expectedBriefRevision:fresh.brief_revision},key,{message:input});}
  return true;
 }
 if(canvasConversationBudgetClarification(input.text)||/^\s*\d[\d., ]*\s*$/u.test(input.text)&&!brief.duration.asked){
  await localReply(env,row,input,key,input.locale==='de'?'Meinst du das gesamte Projektlimit oder nur das Gesprächsbudget? Bitte nenne eine ganze Zahl in Credits, zum Beispiel „Projektbudget 3000 Credits“ oder „Gesprächsbudget 100 Credits“. Eurobeträge und zusätzliche Credits rechne ich nicht automatisch um.':'Do you mean the total project cap or only the briefing allowance? Please give a whole number of credits, for example “Project budget 3000 credits” or “Briefing allowance 100 credits”. I do not automatically convert currency or add extra credits.',{voiceSource});return true;
 }
 // A bounded, deterministic first exchange lets the member establish scope and
 // a spending decision without buying inference just to discuss its allowance.
 const costs=await conversationCosts(env,row.project_id);
 if(row.allowance_credits>costs.committed)return false;
 if(row.state!=='active'||await canvasConversationBlocker(env,row.project_id))return false;
 if(await runActive(env,row.project_id))return false;
 const id=voiceSource?.turnId||randomTokenHex(16),duration=userDuration(input.text,brief,id);
 if(!brief.fields.story?.value){
  if(!duration&&!/\b(?:film|video|movie|clip|geschichte|story)\b/iu.test(input.text))return false;
  brief.fields.story={value:input.text.length>1000?input.text.slice(0,1000-retainedBriefMarker.length)+retainedBriefMarker:input.text,provenance:'user_stated',sourceMessageId:id,revision:row.brief_revision+1};
 }else if(!duration)return false;
 if(duration)brief.duration=duration;
 brief.revision=row.brief_revision+1;
 if(!brief.duration.choice)brief.duration.asked=true;
 const statements=[];
 if(briefReady(brief)){
  const scope=await boundScope(env,{...row,brief_json:JSON.stringify(brief),brief_revision:brief.revision},view),decisionId=randomTokenHex(16);
  statements.push(insertDecision(env,row,{id:decisionId,key:'budget:'+key,kind:'production_budget',input,scope,sourceTurnId:id}));
 }
 await localReply(env,row,input,key,briefReady(brief)?question(input.locale):durationQuestion(input.locale),{brief,id,statements,voiceSource});
 return true;
}
