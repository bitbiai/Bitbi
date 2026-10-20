import { canvasAgentConversationFixture } from './canvas-agent-conversation-control.mjs';
import { canvasConversationExecutionFacts } from '../../workers/auth/src/lib/canvas-agent-conversation-context.js';
import { canvasConversationDecisionIntent } from '../../js/shared/canvas-conversation-decision-intent.mjs';
import { canvasConversationReplySource,canvasConversationReplyText } from '../../workers/auth/src/lib/canvas-agent-conversation.js';

const check=(value,message)=>{if(!value)throw new Error(message);};
const action=(type,revision,extra={})=>({type,revision,targetId:null,value:null,number:null,secondaryNumber:null,ids:[],...extra});
export async function canvasExplanationCase(env,name) {
  const c=await canvasAgentConversationFixture(env,{scope:'explanation-'+name,locale:'de'}),f=c.f;
  const project=()=>f.db.prepare('SELECT revision,assembly_json FROM canvas_projects WHERE id=?').bind(f.project).first();
  const count=async(table)=>Number((await f.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE project_id=?`).bind(f.project).first()).n);
  try {
    await c.approve(20000);
    if(name==='evidence'){
      await f.db.prepare("UPDATE canvas_agent_runs SET status='blocked',phase='planning',error_code='canvas_agent_plan_correction_exhausted',repair_attempts=2 WHERE id=?").bind(f.runId).run();
      await f.db.prepare("INSERT INTO canvas_agent_events(run_id,event_key,type,payload_json,created_at) VALUES(?,'synthetic-exhausted','error',?,'2026-01-01T03:58:35.000Z')")
        .bind(f.runId,JSON.stringify({tool:'production.reconcile',code:'canvas_agent_plan_correction_exhausted',phase:'planning',privateRaw:'must not enter context'})).run();
      const step=await f.db.prepare("SELECT id FROM canvas_agent_steps WHERE run_id=? AND kind='plan' ORDER BY rowid LIMIT 1").bind(f.runId).first();
      check(step,'The original production has a planning step');
      await f.db.prepare("INSERT INTO canvas_agent_proposals(step_id,run_id,plan_json,status,validation_json,created_at,updated_at) VALUES(?,?,'{}','invalid',?,'2026-01-01T03:58:34.000Z','2026-01-01T03:58:34.000Z')")
        .bind(step.id,f.runId,JSON.stringify({issues:[{code:'canvas_agent_trim_outside_planned_source',nodeKey:'sceneHappy'}]})).run();
      const before=await project(),facts=await canvasConversationExecutionFacts(f.env,f.owner,f.project);
      check(facts.budgets.project.capCredits===10000&&facts.budgets.briefing.capCredits===20000,'Project ceiling and briefing allowance remain distinct authoritative scopes');
      check(facts.recentEvents.some(e=>e.code==='canvas_agent_plan_correction_exhausted')&&!JSON.stringify(facts).includes('privateRaw'),'Only allowlisted event evidence enters model context');
      let denied=false;try{await canvasConversationExecutionFacts(f.env,'foreign-synthetic-owner',f.project);}catch(error){denied=error.code==='canvas_project_not_found';}
      check(denied,'Context independently rejects cross-owner project access');
      f.env.ENABLE_GROK_4_7='false';
      const sent=await c.send('Was bedeutet "Hinweis production.reconcile 05:58:35"?');await c.data(sent.response);
      const reply=(await c.read()).messages.at(-1);
      check(reply.provenance==='application'&&reply.kind==='local_explanation'&&!reply.modelId,'A no-inference explanation is not attributed to Grok');
      check(reply.text.includes('canvas_agent_plan_correction_exhausted')&&reply.text.includes('Korrekturversuche: 2')&&reply.text.includes('Zeitzone'),
        'Technical label is explained from the actual code, bounded attempts and honest clock ambiguity');
      check(reply.text.includes('Clipausschnitt')&&reply.text.includes('sceneHappy')&&reply.text.includes('keine neue Planung'),
        'The actual stored validation explains the source duration problem and safe next step without replanning');
      check(c.calls.length===0&&JSON.stringify(await project())===JSON.stringify(before),'Disabled-provider explanation never generates or edits the graph');
      check((await f.db.prepare('SELECT status FROM canvas_agent_runs WHERE id=?').bind(f.runId).first()).status==='blocked','Explaining a blocked production does not recover or restart it');
      const duplicate=await c.post('/messages',sent.input,sent.key);await c.data(duplicate);
      check((await c.read()).messages.filter(m=>m.text===sent.input.text).length===1,'Explanation delivery remains idempotent');
      return {case:name,providerCalls:0,scopes:2};
    }
    if(name==='quoted'){
      const created=await f.data(await f.request(f.projectPath+'/nodes','POST',{type:'note',title:'Retained manual note',content:{text:'Keep this note.'}}));
      const node=created.node,before=await project(),briefBefore=(await c.read()).briefRevision;
      await c.data((await c.send('Wie kann ich diesen Film verbessern? Was bedeutet "pausiere die Produktion" und warum 45 Sekunden?')).response);await c.deliver();
      const payload=JSON.parse(c.calls.at(-1).body.input.messages[1].content);
      check(payload.currentProject.execution.observedAt&&payload.currentProject.execution.budgets.project.capCredits===10000,
        'The real signed adapter receives bounded current execution evidence');
      await c.complete({text:'Das ist eine Erklärung, kein Auftrag zur Pause.',fields:{story:'Forged replacement story'},
        actions:[action('node_prompt',before.revision,{targetId:node.id,value:'Unwanted change'}),action('production_pause',before.revision)]});await c.deliver();
      const after=await c.read();
      check(after.briefRevision===briefBefore&&after.brief.duration.choice===null,'Duration inside a question is not a new creative decision');
      check(await count('canvas_agent_action_receipts')===0,'Quoted commands cannot become action receipts');
      check(JSON.stringify(await project())===JSON.stringify(before),'An explanatory turn cannot mutate the creative project');
      check(JSON.parse((await f.db.prepare('SELECT content_json FROM canvas_nodes WHERE id=?').bind(node.id).first()).content_json).text==='Keep this note.',
        'Independent manual node content survives a hostile model action');
      check(after.messages.at(-1).text==='Das ist eine Erklärung, kein Auftrag zur Pause.','The real assistant explanation is retained');
      return {case:name,providerCalls:1,scopes:2};
    }
    if(name==='budget-scope'){
      for(const [text,locale]of [['Projektlimit 20.000 Credits','de'],['Project cap 20,000 credits','en']])
        check(canvasConversationDecisionIntent(text,{locale})?.capCredits===20000&&canvasConversationDecisionIntent(text,{locale})?.kind==='cap',
          'An explicit production ceiling remains a project proposal, never a conversation allowance');
      check(canvasConversationDecisionIntent('Limit 20000 Credits',{locale:'de'})===null,'A generic limit has no invented financial scope');
      const before=await c.read();await c.data((await c.send('Limit 20000 Credits')).response);
      const clarified=await c.read();
      check(clarified.messages.at(-1).text.includes('gesamte Projektlimit')&&clarified.messages.at(-1).text.includes('Gesprächsbudget'),
        'An ambiguous limit asks which financial scope is intended');
      check(c.calls.length===0&&clarified.allowance.capCredits===before.allowance.capCredits&&await count('canvas_agent_action_receipts')===0,
        'Clarification spends nothing and cannot save a cap');
      await c.data((await c.send('Ein Film mit einem gesamten Projektbudget von 20000 Credits.')).response);await c.deliver();
      const revision=(await project()).revision,text='Das genannte Projektbudget ist keine Freigabe für ein Gesprächsbudget.';
      await c.complete({text,actions:[action('allowance_propose',revision,{number:20000})]});await c.deliver();
      const view=await c.read(),receipt=view.actions.at(-1);
      check(receipt.state==='failed'&&receipt.code==='canvas_agent_budget_scope_required','A model cannot reinterpret a production ceiling as a briefing allowance');
      const turnId=receipt.turnId,modelReply=current=>{
        const matches=current.messages.filter(message=>message.id===`${turnId}:reply`);
        check(matches.length===1&&matches[0].provenance==='model','The accepted model turn remains uniquely attributable');
        return matches[0];
      };
      check(modelReply(view).text.startsWith(text),
        'An action receipt cannot erase the actual model answer');
      check(modelReply(view).proposedActions?.state==='attention_required'&&modelReply(view).proposedActions.ids.includes(receipt.id),
        'A model reply remains attributed speech; a failed proposed write is separately identified by its real action receipt');
      const sourceId=`action:${receipt.id}:failed:0:canvas_agent_budget_scope_required`;
      const explanations=view.messages.filter(message=>message.kind==='incident_explanation'&&message.sourceNotificationId===sourceId);
      check((await f.db.prepare('SELECT locale FROM canvas_projects WHERE id=?').bind(f.project).first()).locale==='en',
        'The inherited project is English even when this user turn was submitted in German');
      check(explanations.length===1&&explanations[0].provenance==='application'&&!explanations[0].modelId
        &&explanations[0].text.includes('Canvas system information')&&explanations[0].text.includes('Notifications'),
        'The failed budget proposal has its own transparent system explanation, not a replacement model answer');
      const historical='Dein Auftrag ist gespeichert. Die Ergebnisse erscheinen hier.';
      await f.db.prepare('UPDATE canvas_agent_turns SET assistant_text=? WHERE id=?').bind(historical,turnId).run();
      const restored=await c.read();
      check(modelReply(restored).text.startsWith(text),'A historical generic acknowledgement projects the original validated stored reply');
      check(restored.messages.filter(message=>message.sourceNotificationId===sourceId).length===1
        &&restored.messages.find(message=>message.sourceNotificationId===sourceId).id===explanations[0].id
        &&c.calls.length===1&&restored.allowance.capCredits===before.allowance.capCredits,
        'Rereading preserves one unpaid incident explanation without changing the briefing ceiling');
      check((await f.db.prepare('SELECT assistant_text FROM canvas_agent_turns WHERE id=?').bind(turnId).first()).assistant_text===historical,
        'Restoring the visible answer never rewrites historical accepted evidence');
      for(const invalidReceipt of [null,'{']){
        const unavailable={run_id:'historical-synthetic',assistant_text:historical,dialogue_receipt:invalidReceipt,dialogue_input:'{}'};
        check(canvasConversationReplyText(unavailable)===historical&&canvasConversationReplySource(unavailable).kind==='operation_ack'
          &&canvasConversationReplySource(unavailable).provenance==='application','Unrecoverable old application acknowledgements must not be attributed to the model');
      }
      check((await f.db.prepare('SELECT budget_credits FROM canvas_agent_runs WHERE id=?').bind(f.runId).first()).budget_credits===10000,
        'No historical production ceiling is rewritten');
      return {case:name,providerCalls:1,scopes:2};
    }
    throw new Error('Unknown explanation fixture');
  }finally{c.restore();}
}
