import {canvasAgentConversationFixture} from './canvas-agent-conversation-control.mjs';
const check=(value,message)=>{if(!value)throw new Error(message);};
export const CANVAS_CONVERSATION_DECISION_CASES=['bootstrap','duration','explicit','button','stale-graph','stale-model','stale-price','expired','isolation','allowance','money-clarification','long-brief','stale-admission','intervening-question'];
export async function canvasConversationDecisionCase(base,name){
 const c=await canvasAgentConversationFixture(base,{scope:'decision-'+name,locale:'de'}),f=c.f;
 const data=async response=>{const body=await response.json();check(response.ok,`${response.status}/${body.code}`);return body.data;};
 const send=async text=>{const sent=await c.send(text);return {...sent,body:await data(sent.response)};};
 const productions=async()=>(await f.db.prepare("SELECT * FROM canvas_agent_runs WHERE project_id=? AND purpose='production' AND id!=? ORDER BY rowid").bind(f.project,f.runId).all()).results;
 try{
  if(name==='allowance'){
   await send('Gesprächsbudget 200 Credits');const proposal=await c.read();
   check(proposal.pendingDecision.kind==='briefing_allowance'&&proposal.allowance.capCredits===0,'The natural allowance is only a proposal before affirmative consent');
   const accepted=await send('Ja');await data(await c.post('/messages',accepted.input,accepted.key));
   check((await c.read()).allowance.capCredits===200,'Natural confirmation uses the existing authoritative allowance');
   check((await productions()).length===0&&c.calls.length===0,'Briefing consent does not dispatch inference or authorize film production');
   check((await f.db.prepare("SELECT COUNT(*) AS n FROM canvas_agent_conversation_actions WHERE project_id=? AND request_key LIKE 'decision-allowance:%'").bind(f.project).first()).n===1,'Replay creates one existing allowance receipt');
   return {case:name,productions:0,providerCalls:0};
  }
  if(name==='money-clarification'){
   const before=JSON.stringify((await c.read()).brief);
   for(const text of ['3000 Euro','3,000 Credits','noch 500 Credits','3000.5 credits','3000'])await send(text);
   const view=await c.read();check(view.messages.at(-1).text.includes('ganze Zahl in Credits'),'Unclear amount receives a friendly deterministic clarification');
   check(JSON.stringify(view.brief)===before&&!view.pendingDecision&&view.allowance.capCredits===0,'Currency and additional or context-free amounts cannot become memory or consent');
   check((await productions()).length===0&&c.calls.length===0,'Monetary clarification never buys inference');return {case:name,productions:0,providerCalls:0};
  }
  if(name==='long-brief'){
   const idea='Ein 45 Sekunden Film. '+('Der Hund besucht den Park. '.repeat(55))+' MUST KEEP: the final scene has a blue umbrella.';
   await send(idea);const view=await c.read();check(view.brief.fields.story.value.length<=1000&&view.brief.fields.story.value.includes('Full user brief retained'),'Long brief summary explicitly signals retained original');
   await send('3000 Credits');await send('Ja');const run=(await productions())[0];check(JSON.parse(run.input_json).brief.includes('MUST KEEP: the final scene has a blue umbrella.'),'Approved production retains the full original requirement beyond summary limit');
   return {case:name,productions:1,providerCalls:c.calls.length};
  }
  const idea=name==='duration'?'Ein lustiger Film über Hunde im Park.':'Ein lustiger 45 Sekunden Film über Hunde im Park.';
  await send(idea);let view=await c.read();
  check(c.calls.length===0&&view.allowance.capCredits===0,'Budget bootstrap never authorizes or sends inference');
  if(name==='duration'){
   check(view.brief.duration.asked&&!view.brief.duration.choice&&!view.pendingDecision,'Missing duration is asked and blocks a start decision');
   await send('45 Sekunden');view=await c.read();
  }
  check(view.pendingDecision?.kind==='production_budget','A known duration produces one persisted budget question');
  const creative=JSON.stringify(view.brief),graph=(await f.db.prepare('SELECT revision FROM canvas_projects WHERE id=?').bind(f.project).first()).revision;
  if(name==='intervening-question')await c.approve(5000);
  if(name==='explicit'){
   const sent=await send('Starte jetzt mit maximal 3000 Credits');
   await data(await c.post('/messages',sent.input,sent.key));
  }else{
   await send(name==='duration'?'3.000':'3000 Credits');view=await c.read();
   check(view.pendingDecision?.kind==='production_start'&&view.pendingDecision.scope.capCredits===3000,'The stated cap creates a server-owned pending start decision');
   check((await productions()).length===0&&c.calls.length===0,'A budget proposal is not start approval');
   check(JSON.stringify(view.brief)===creative,'Budget text cannot overwrite creative decisions');
   const decision=view.pendingDecision;
   if(name==='intervening-question'){
    const before=await c.read();
    const sent=await c.send('Welche Möglichkeiten gibt es für Musik?');await data(sent.response);await c.deliver();
    const musicQuestion='Soll Hintergrundmusik laufen?';
    await c.complete({text:musicQuestion,questions:[],updates:[],intent:'continue'});
    const after=await c.read();
    check(after.messages.some(message=>message.id&&message.text===musicQuestion&&message.status==='completed'),'The real signed reply asks an unrelated question after the spending proposal');
    check(after.revision>before.revision&&after.briefRevision===before.briefRevision&&JSON.stringify(after.brief)===JSON.stringify(before.brief),'Only conversation position changed; the creative brief and its revision did not');
    check(after.pendingDecision?.id===decision.id&&after.pendingDecision.state==='stale','The previous spending question is no longer current');
    const answer=await c.send('Ja'),rejected=await answer.response.json();
    check(answer.response.status===409&&rejected.code==='canvas_agent_decision_changed','Yes to the later music question cannot approve the old start decision');
    check((await productions()).length===0&&c.calls.length===1,'The unrelated affirmative neither starts production nor submits another paid request');
    check((await f.db.prepare('SELECT revision FROM canvas_projects WHERE id=?').bind(f.project).first()).revision===graph,'Discussion and rejected consent preserve the editable graph');
    return {case:name,productions:0,providerCalls:1};
   }
   if(['stale-graph','stale-model','stale-price','expired','stale-admission'].includes(name)){
    if(name==='stale-graph')await f.db.prepare('UPDATE canvas_projects SET revision=revision+1 WHERE id=?').bind(f.project).run();
    if(name==='stale-model')await f.db.prepare('UPDATE canvas_agent_conversations SET assistant_model_revision=assistant_model_revision+1 WHERE project_id=?').bind(f.project).run();
    if(name==='stale-price')await f.db.prepare('UPDATE model_pricing_state SET revision=revision+1 WHERE id=1').run();
    if(name==='stale-admission'){const raw=await f.db.prepare('SELECT scope_json FROM canvas_agent_conversation_decisions WHERE id=?').bind(decision.id).first(),scope=JSON.parse(raw.scope_json);scope.quote.assistantAdmission='old-unapproved-admission';const trigger=await f.db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='canvas_agent_conversation_decision_identity'").first();try{await f.db.prepare('DROP TRIGGER canvas_agent_conversation_decision_identity').run();await f.db.prepare('UPDATE canvas_agent_conversation_decisions SET scope_json=? WHERE id=?').bind(JSON.stringify(scope),decision.id).run();}finally{await f.db.prepare(trigger.sql).run();}}
    if(name==='expired')await f.advance(31*60*1000);
    const snapshot=await c.read(),r=await c.post('/decision',{decisionId:decision.id,decisionRevision:decision.revision,decision:'accept',expectedConversationRevision:snapshot.revision,expectedBriefRevision:snapshot.briefRevision});
    check(r.status===409,'Changed or expired scope rejects the old approval');
    check((await productions()).length===0&&c.calls.length===0,'Stale consent cannot start or dispatch');
    return {case:name,productions:0,providerCalls:0};
   }
   if(name==='isolation'){
    const other=await canvasAgentConversationFixture(base,{scope:'decision-other',locale:'de'});
    try{const snapshot=await other.read(),r=await other.post('/decision',{decisionId:decision.id,decisionRevision:decision.revision,decision:'accept',expectedConversationRevision:snapshot.revision,expectedBriefRevision:snapshot.briefRevision});check(r.status===404,'Decision IDs never transfer authority across projects');}finally{other.restore();}
   }
   if(name==='button'){
    const body={decisionId:decision.id,decisionRevision:decision.revision,decision:'accept',expectedConversationRevision:view.revision,expectedBriefRevision:view.briefRevision};
    await data(await c.post('/decision',body,'decision-button-original'));await data(await c.post('/decision',body,'decision-button-original'));
   }else{
    const sent=await send('Ja, starte');await data(await c.post('/messages',sent.input,sent.key));
    await send('Ja');
   }
  }
  const runs=await productions();check(runs.length===1&&runs[0].budget_credits===3000&&runs[0].status==='queued','One exact approval starts one ordinary durable production within 3000 credits');
  check(JSON.stringify((await c.read()).brief)===creative,'Start and duplicate approval preserve the original creative brief');
  check((await f.db.prepare('SELECT revision FROM canvas_projects WHERE id=?').bind(f.project).first()).revision===graph,'Budget conversation does not mutate the creative graph');
  check(c.calls.length===0,'Starting queues work without synchronously calling a model');
  check((await f.db.prepare("SELECT COUNT(*) AS n FROM canvas_agent_conversation_decisions WHERE project_id=? AND state='consumed'").bind(f.project).first()).n===1,'Exactly one persisted decision is consumed');
  check(!(await f.db.prepare('PRAGMA foreign_key_check').all()).results.length,'All decision references remain valid');
  return {case:name,productions:1,providerCalls:0};
 }finally{c.restore();}
}
