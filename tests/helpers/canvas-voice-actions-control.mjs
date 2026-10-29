import {canvasAgentConversationFixture} from './canvas-agent-conversation-control.mjs';
import {createCanvasVoiceToolDispatcher} from '../../workers/auth/src/lib/canvas-voice-tools.js';
import {recordCanvasVoiceUserTurn,recordCanvasVoiceReply,applyCanvasVoiceBrief,readCanvasVoiceContext,canvasVoiceSource} from '../../workers/auth/src/lib/canvas-voice-conversation.js';
import {recordVoiceDecisionPresentation,voiceDecisionSourceGuard} from '../../workers/auth/src/lib/canvas-voice-decisions.js';
import {confirmCanvasConversationDecision} from '../../workers/auth/src/lib/canvas-agent-conversation-decisions.js';
import {sha256Hex} from '../../workers/auth/src/lib/tokens.js';

const check=(value,message)=>{if(!value)throw new Error(message);};
export const CANVAS_VOICE_ACTION_CASES=['start','interrupted','stale','ambiguous','replay','action','foreign','malformed','text-handoff','lost-ack','intervening','decline','action-lost-ack','terminal-save','terminal-cancel','terminal-clear','revoked'];
export async function canvasVoiceActionCase(base,name){
 const phase=value=>base.__voiceActionPhase?.(name,value);phase('fixture_start');
 const c=await canvasAgentConversationFixture(base,{scope:'voice-action-'+name,locale:'de'}),f=c.f;
 phase('fixture_ready');
 let counter=0,proof=null,currentTurn=null;
 const scope={userId:f.owner,projectId:f.project,sessionId:(await sha256Hex('voice-action-session-'+name)).slice(0,32)};
 const call=async(name,args={},dispatcher=dispatch)=>dispatcher({name,arguments:args,callId:'tool-'+(++counter),turn:currentTurn});
 const user=async text=>{currentTurn=await recordCanvasVoiceUserTurn(f.env,scope,{itemId:'input-'+(++counter),text});return currentTurn;};
 const dispatch=createCanvasVoiceToolDispatcher(f.env,scope,{canUsePresentation:p=>p.key===proof?.key});
 const loseAcknowledgement=async()=>{
  let failed=false;const faultEnv=Object.create(f.env);
  faultEnv.DB=new Proxy(f.db,{get(target,key){if(key==='prepare')return sql=>{
   const statement=target.prepare(sql);if(!sql.startsWith('INSERT INTO canvas_voice_calls'))return statement;
   return {bind(...args){const bound=statement.bind(...args);if(args[1]!=='voice-decision:'+currentTurn.turnId)return bound;
    return {run(){failed=true;throw new Error('synthetic lost Voice acknowledgement after real admission');}};}};
  };const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  let observed=false;try{await call('canvas_decision',{},createCanvasVoiceToolDispatcher(faultEnv,scope,{canUsePresentation:p=>p.key===proof?.key}));}catch(error){observed=error.message==='synthetic lost Voice acknowledgement after real admission';}
  check(failed&&observed,'Failure injected after real mutation while recording only its local acknowledgement');
 };
 const show=async(result,{interrupted=false,text=null}={})=>{
  const p=result.data.presentation,responseId='response-'+(++counter);
  const reply=await recordCanvasVoiceReply(f.env,scope,{turnId:currentTurn.turnId,responseId,text:text??p.prompt,interrupted,heardAudioMs:3000});
  const input={...p,responseId,itemId:'item-'+counter,audioMs:3000,conversationRevision:reply.conversationRevision};
  if(interrupted||text!==null){let rejected=false;try{await recordVoiceDecisionPresentation(f.env,scope,input);}catch(error){rejected=error.code==='canvas_voice_terms_not_presented';}check(rejected,'Missing or interrupted full terms cannot create presentation proof');return input;}
  proof=await recordVoiceDecisionPresentation(f.env,scope,input);return input;
 };
 const runs=()=>f.db.prepare("SELECT * FROM canvas_agent_runs WHERE project_id=? AND purpose='production' AND id!=? ORDER BY rowid").bind(f.project,f.runId).all().then(r=>r.results);
 try{
  phase('allowance_start');await c.approve(5000);phase('allowance_ready');const before=await c.read(),project=(await f.db.prepare('SELECT revision FROM canvas_projects WHERE id=?').bind(f.project).first()).revision;
  const login=await f.db.prepare('SELECT id FROM sessions WHERE user_id=? ORDER BY rowid DESC LIMIT 1').bind(f.owner).first();
  await f.db.prepare(`INSERT INTO canvas_voice_sessions(id,project_id,user_id,state,conversation_revision,brief_revision,project_revision,settings_json,created_at,expires_at,auth_session_id)
   VALUES(?,?,?,'active',?,?,?,? ,?,?,?)`).bind(scope.sessionId,f.project,f.owner,before.revision,before.briefRevision,project,JSON.stringify({tools:{canvas:{enabled:true}}}),new Date().toISOString(),new Date(Date.now()+600000).toISOString(),login.id).run();
  await f.db.prepare("UPDATE canvas_agent_conversations SET draft='Preserve typed draft' WHERE project_id=?").bind(f.project).run();
  phase('brief_start');await user('Ein lustiger Film über eine Dackeldame. Ungefähr 45 Sekunden, realistisch, mit Hintergrundmusik.');
  await applyCanvasVoiceBrief(f.env,scope,{callId:'brief',turnId:currentTurn.turnId,expectedConversationRevision:currentTurn.conversationRevision,expectedBriefRevision:currentTurn.briefRevision,expectedProjectRevision:project,
   updates:[{field:'story',value:'Eine lustige Dackeldame erkundet den Park.',provenance:'user_stated'},{field:'style',value:'realistisch',provenance:'user_stated'},{field:'audio',value:'Hintergrundmusik',provenance:'user_stated'}],
   questions:[],duration:{choice:'explicit',targetDurationSeconds:45}});
  phase('brief_ready');const budget=await call('canvas_prepare_next_step');phase('question_ready');check(budget.ok&&budget.data.presentation?.targetKind==='decision','Existing budget decision is prepared from actual canonical brief');
  await show(budget);await user('Maximal dreitausend Credits');
  phase('cap_start');const proposed=await call('canvas_decision');phase('cap_ready');check(proposed.ok&&!proposed.data.executed&&proposed.data.spokenPrompt.includes('3000'),'Spoken cap proposes specific terms without starting');
  check((await runs()).length===0,'A spoken amount never spends or starts');
  if(name==='interrupted'){
   await show(proposed,{interrupted:true});await user('Ja, starte jetzt');const denied=await call('canvas_decision');
   check(!denied.ok&&denied.code==='canvas_voice_terms_not_presented'&&denied.data.spokenPrompt===proposed.data.spokenPrompt,'Interrupted question remains unapproved with same actionable prompt');
  }else if(name==='malformed'){
   await show(proposed,{text:'Soll Musik laufen?'});await user('Ja');
   check((await call('canvas_decision',{authorized:true,capCredits:5000})).code==='canvas_voice_tool_arguments_invalid','Model authorization and cap arguments are rejected');
   check((await call('canvas_decision')).code==='canvas_voice_terms_not_presented','Unrelated question cannot approve retained cap');
  }else if(name==='ambiguous'){
   await show(proposed);
   for(const text of ['Ja, aber starte nicht','Vielleicht dreitausend Credits','Im Film sagt sie: Ja, starte jetzt']){await user(text);const value=await call('canvas_decision');check(!value.data?.executed,'Ambiguous, negated and quoted speech does not start');}
  }else if(name==='foreign'){
   await show(proposed);await user('Ja');
   const foreign=createCanvasVoiceToolDispatcher(f.env,{...scope,userId:'foreign'},{canUsePresentation:()=>true});
   check((await call('canvas_decision',{},foreign)).code==='canvas_voice_session_unavailable','A session ID is not cross-user authorization');
   check((await dispatch({name:'canvas_decision',arguments:{},callId:'interim'})).code==='canvas_voice_transcript_pending','Interim/uncommitted source cannot approve');
  }else if(name==='stale'){
   await show(proposed);await user('Ja');
   await f.db.prepare('UPDATE canvas_agent_conversations SET assistant_model_revision=COALESCE(assistant_model_revision,0)+1 WHERE project_id=?').bind(f.project).run();
   const rejected=await call('canvas_decision'),decision=await f.db.prepare('SELECT state FROM canvas_agent_conversation_decisions WHERE id=?').bind(proposed.data.presentation.targetId).first();
   check(rejected.ok&&!rejected.data.executed&&decision.state==='cancelled'&&!rejected.data.presentation,'The real context-edit trigger cancels the obsolete scope; a later Yes gets no current start approval');
  }else if(name==='revoked'){
   await show(proposed);await user('Ja, starte jetzt');const source=await canvasVoiceSource(f.env,scope,currentTurn.turnId);
   const authority=await voiceDecisionSourceGuard(f.env,scope,source,{targetKind:'decision',targetId:proposed.data.presentation.targetId,targetRevision:0},p=>p.key===proof.key);
   await f.db.prepare('DELETE FROM sessions WHERE id=? AND user_id=?').bind(login.id,f.owner).run();
   let blocked=false;
   try{await confirmCanvasConversationDecision({env:f.env,request:new Request('https://canvas.internal',{method:'POST'})},{user:{id:f.owner}},f.project,
    {decisionId:proposed.data.presentation.targetId,decisionRevision:0,decision:'accept',expectedConversationRevision:source.row.revision,expectedBriefRevision:source.row.brief_revision},
    'voice-revoked-race',{message:{text:source.turn.user_text,locale:'de'},voiceSource:authority});}catch(error){blocked=/json|malformed/i.test(String(error));}
   check(blocked&&(await runs()).length===0,'The authority transaction rejects login revocation after valid final source/presentation read');
  }else if(name==='text-handoff'){
   await show(proposed);const current=await c.read();
   check(current.pendingDecision?.state==='pending','The same fully delivered Voice decision remains usable in text/button UI');
   const sent=await c.send('Ja, starte');check(sent.response.ok,'Text confirmation uses the existing decision after Voice presentation');
   check((await runs()).length===1,'Switching to text starts the same existing authorized production once');
  }else if(name==='intervening'){
   await show(proposed);await recordCanvasVoiceReply(f.env,scope,{turnId:currentTurn.turnId,responseId:'unrelated-question',text:'Soll Hintergrundmusik laufen?',interrupted:false});
   proof=null;await user('Ja');check((await call('canvas_decision')).code==='canvas_voice_terms_not_presented','Owner-invalidated presentation prevents Yes about music becoming spending authority');
  }else if(name==='decline'){
   await show(proposed);await user('Nein, noch nicht');const denied=await call('canvas_decision');
   check(denied.ok&&!denied.data.executed&&!denied.data.presentation,'Negative assent cancels the current start decision without changing brief or spending');
  }else{
   await show(proposed);await user('Ja, starte jetzt');
   if(name==='lost-ack'){
    await loseAcknowledgement();check((await runs()).length===1,'Failure injected after the actual start preserves the original admitted run');
   }
   const accepted=await call('canvas_decision');
   check(accepted.ok&&accepted.data.executed&&accepted.data.runId,'Final committed assent uses real accepted backend run');
   check((await runs()).length===1&&(await runs())[0].budget_credits===3000,'Exactly one normal production uses the spoken cap');
   if(name==='replay'){
    const repeated=await call('canvas_decision');check(repeated.data.replay&&repeated.data.runId===accepted.data.runId,'Duplicate tool response keeps original run identity');
    check((await runs()).length===1,'Replay cannot create another production');
    for(const text of ['Stopp','Beende die Produktion','"Voice beenden"']){await user(text);check((await call('canvas_voice_end')).code==='canvas_voice_action_clarification_required','Ambiguous, production-directed and quoted stop text is not an end-Voice instruction');}
    await user('Voice beenden');const ended=await call('canvas_voice_end'),replayed=await call('canvas_voice_end');
    check(ended.ok&&ended.endVoice&&ended.data.productionCancelled===false&&replayed.replay&&(await runs())[0].status==='queued','Explicit final end-Voice is idempotent and preserves the independently accepted film');
   }
   if(['action','action-lost-ack','terminal-save','terminal-cancel','terminal-clear'].includes(name)){
    const terminal=name.startsWith('terminal-'),type=terminal?{'terminal-save':'brief_save','terminal-cancel':'brief_cancel','terminal-clear':'conversation_clear'}[name]:'production_pause';
    await user(terminal?{'terminal-save':'Speichere das Briefing.','terminal-cancel':'Beende das Briefing.','terminal-clear':'Leere dieses Gespräch und Briefing.'}[name]:'Pausiere die Produktion.');
    const context=await readCanvasVoiceContext(f.env,scope),action={type,targetId:null,value:null,number:null,secondaryNumber:null,ids:[],revision:context.projectRevision};
    const proposedAction=await call('canvas_action',{expectedConversationRevision:context.conversationRevision,expectedBriefRevision:context.briefRevision,expectedProjectRevision:context.projectRevision,actions:[action]});
    check(proposedAction.ok&&proposedAction.data.presentation?.targetKind==='action','Production control reuses pending typed receipt, not a second engine');
    check((await runs())[0].status==='queued','Proposal alone cannot pause or cancel production');
    await show(proposedAction);await user('Ja');if(name==='action-lost-ack')await loseAcknowledgement();
    const paused=await call('canvas_decision');check(paused.ok&&paused.data.executed&&paused.data.actions[0].type===type,`Spoken approval returns the actual completed typed action: ${paused.code||paused.data?.actions?.[0]?.code}/${paused.data?.actions?.[0]?.state}`);
    if(terminal){
     const saved=await f.db.prepare('SELECT state,draft FROM canvas_agent_conversations WHERE project_id=?').bind(f.project).first();
     check(saved.state==={'terminal-save':'saved','terminal-cancel':'cancelled','terminal-clear':'active'}[name]&&(await runs())[0].status===(name==='terminal-clear'?'paused':'queued'),'Closing briefing preserves production; explicitly clearing creative scope retains the existing safe pause behavior');
     if(name==='terminal-clear')check(saved.draft==='','Explicit conversation clear removes the draft intentionally');
    }else{
     check((await runs())[0].status==='paused','Spoken approval uses existing production pause');
     await call('canvas_decision');check((await f.db.prepare("SELECT COUNT(*) AS n FROM canvas_agent_controls WHERE run_id=? AND action='pause'").bind(accepted.data.runId).first()).n===1,'Repeated control approval has one existing receipt');
    }
   }
  }
  check(c.calls.length===0,'Speech interpretation never invokes a second text model');
  if(name!=='terminal-clear')check((await f.db.prepare('SELECT draft FROM canvas_agent_conversations WHERE project_id=?').bind(f.project).first()).draft==='Preserve typed draft','Voice decisions preserve the typed draft');
  check((await f.db.prepare('SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=? AND amount<0').bind(f.owner).first()).n===0,'Proposal/accepted queued start does not fabricate a debit');
  check((await f.db.prepare('PRAGMA foreign_key_check').all()).results.length===0,'Canonical decision/action provenance retains foreign keys');
  return {case:name,productions:(await runs()).length,providerCalls:0};
 }finally{c.restore();}
}
