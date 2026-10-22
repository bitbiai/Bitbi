import {canvasAgentBudgetFixture} from './canvas-agent-autonomy-control.mjs';
import {consumeMemberCredits} from '../../workers/auth/src/lib/billing.js';
import {beginMemberAiUsageAttempt,markMemberAiUsageAttemptProviderRunning,markMemberAiUsageAttemptFinalizing,markMemberAiUsageAttemptSucceeded} from '../../workers/auth/src/lib/member-ai-usage-attempts.js';
import {sha256Hex} from '../../workers/auth/src/lib/tokens.js';
import worker from '../../workers/auth/src/index.js';
import {canvasAgentConversationFixture,attachCanvasConversation} from './canvas-agent-conversation-control.mjs';
import {canvasAudioFixture} from './canvas-audio-control.mjs';
import {getModelTariff} from '../../workers/auth/src/lib/model-tariffs.js';

const check=(value,message)=>{if(!value)throw new Error(message);};
export async function seedCanvasNaturalChatMigration(base){
  check(!(await base.DB.prepare("SELECT name FROM sqlite_schema WHERE name IN ('canvas_agent_start_intents','canvas_agent_action_receipts')").all()).results.length,'The actual pre-0110 database must have neither new authority table');
  const f=await canvasAgentBudgetFixture(base,'natural-migration'),run=await f.createRun('existing-production',3000),step=await f.allocate(run,'plan',127);
  // Seed an already accepted 0109 operation through its real usage/credit
  // services and triggers. Today's API authority requires the later 0114
  // interpretation column and cannot describe this historical schema.
  check(!(await f.db.prepare('PRAGMA table_info(canvas_agent_proposals)').all()).results.some(column=>column.name==='interpretation_json'),'The historical seed precedes interpretation authority');
  const metadata={canvas_agent:{run_id:run.id,step_id:step.id,project_id:f.project}};
  const args={env:f.env,userId:f.owner,featureKey:'ai.text.generate',operationKey:'member.text.generate',route:f.route,
    idempotencyKey:`autonomy-${step.id}`,requestFingerprint:await sha256Hex(step.id),creditCost:step.allocation_credits,metadata};
  const usageCount=async()=>(await f.db.prepare('SELECT COUNT(*) AS n FROM member_ai_usage_attempts_v2 WHERE user_id=?').bind(f.owner).first()).n;
  const beforeUsage=await usageCount();let denied=false;
  try{await beginMemberAiUsageAttempt({...args,idempotencyKey:`${args.idempotencyKey}-invalid`,metadata:{canvas_agent:{...metadata.canvas_agent,step_id:'missing-owned-step'}}});}
  catch(error){denied=[error,error?.cause,error?.cause?.cause].some(item=>String(item?.message||'').includes('canvas_agent_authority_revoked'));}
  check(denied&&await usageCount()===beforeUsage,'The actual old-schema ownership trigger rejects invalid binding without leaving a reservation');
  const begun=await beginMemberAiUsageAttempt(args),reserved={scoped:f.env,args,metadata,attempt:begun.attempt};
  await f.db.prepare('UPDATE canvas_agent_steps SET usage_attempt_id=? WHERE id=?').bind(reserved.attempt.id,step.id).run();
  const token=await markMemberAiUsageAttemptProviderRunning(reserved.scoped,reserved.attempt.id);
  await markMemberAiUsageAttemptFinalizing(reserved.scoped,reserved.attempt.id,{dispatchToken:token});
  const charged=await consumeMemberCredits({env:reserved.scoped,userId:f.owner,featureKey:'ai.text.generate',credits:78,
    idempotencyKey:reserved.args.idempotencyKey,requestFingerprint:reserved.args.requestFingerprint,aiDispatchToken:token,source:'canvas_agent_plan'});
  await markMemberAiUsageAttemptSucceeded(reserved.scoped,reserved.attempt.id,{dispatchToken:token,model:'xai/grok-4.7',resultStatus:'stored',
    resultId:step.id,resultUrl:null,balanceAfter:charged.creditBalance,metadata:{...reserved.metadata,canvas_agent_receipt:step.id}});
  await f.db.prepare("UPDATE canvas_agent_steps SET status='completed',receipt_json=? WHERE id=?").bind(JSON.stringify({ok:true,outcome:'completed',model:'xai/grok-4.7',historicalReceipt:true}),step.id).run();
  await f.db.prepare("UPDATE canvas_agent_runs SET status='completed',lease_token=NULL,lease_until=NULL WHERE id=?").bind(run.id).run();
  const now=new Date().toISOString(),turn=(await sha256Hex(f.owner+'-saved-decision')).slice(0,32);
  const brief={version:1,revision:1,fields:{story:{value:'A saved house and duck-pool film.',provenance:'user_stated',sourceMessageId:turn,revision:1}},
    duration:{targetDurationSeconds:120,choice:'explicit',asked:true,sourceMessageId:turn},openQuestions:[]};
  await f.db.prepare("INSERT INTO canvas_agent_conversations(project_id,user_id,revision,brief_revision,brief_json,state,draft,allowance_credits,allowance_tariff,created_at,updated_at) VALUES(?,?,1,1,?,'saved','Continue later',3000,?,?,?)")
    .bind(f.project,f.owner,JSON.stringify(brief),f.tariff,now,now).run();
  await f.db.prepare("INSERT INTO canvas_agent_turns(id,project_id,request_key,input_json,conversation_revision,brief_revision,user_text,state,created_at,updated_at) VALUES(?,?,'historical-saved-decision',?,1,1,?,'completed',?,?)")
    .bind(turn,f.project,JSON.stringify({text:'Keep the two-minute house film.'}),'Keep the two-minute house film.',now,now).run();
  const seed={owner:f.owner,project:f.project,run:run.id,step:step.id,attempt:reserved.attempt.id,turn};
  return {...seed,before:await naturalMigrationSnapshot(base,seed)};
}
async function naturalMigrationSnapshot(env,seed){
  const result={};
  for(const [name,sql,id] of [
    ['project','SELECT * FROM canvas_projects WHERE id=?',seed.project],['run','SELECT * FROM canvas_agent_runs WHERE id=?',seed.run],
    ['step','SELECT * FROM canvas_agent_steps WHERE id=?',seed.step],['usage','SELECT * FROM member_ai_usage_attempts_v2 WHERE id=?',seed.attempt],
    ['conversation','SELECT * FROM canvas_agent_conversations WHERE project_id=?',seed.project],['turn','SELECT * FROM canvas_agent_turns WHERE id=?',seed.turn]])
    result[name]=await env.DB.prepare(sql).bind(id).first();
  result.ledger=(await env.DB.prepare('SELECT * FROM member_credit_ledger WHERE user_id=? ORDER BY id').bind(seed.owner).all()).results;
  return result;
}
export async function verifyCanvasNaturalChatMigration(env,seed){
  const snapshot=await naturalMigrationSnapshot(env,seed),expected=structuredClone(seed.before);
  // Native acceptance applies the complete forward migration chain. 0112 adds
  // these exact historical Grok defaults; every pre-existing field remains an
  // exact comparison, and unknown/missing additions are never discarded.
  if(['model_id','model_revision'].some(key=>Object.hasOwn(snapshot.run,key))
    ||['assistant_model_id','assistant_model_revision'].some(key=>Object.hasOwn(snapshot.conversation,key))){
    Object.assign(expected.run,{model_id:'xai/grok-4.7',model_revision:0});
    Object.assign(expected.conversation,{assistant_model_id:'xai/grok-4.7',assistant_model_revision:0});
  }
  if(Object.hasOwn(snapshot.conversation,'diagnostic_allowance')){
    Object.assign(expected.conversation,{diagnostic_allowance:0});
    for(const table of ['canvas_agent_incidents','canvas_agent_incident_explanations'])
      check((await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n===0,'Forward migration cannot invent an incident or explanatory conversation');
  }
  if(Object.hasOwn(snapshot.project,'media_policy_revision')){
    Object.assign(expected.project,{media_policy_revision:0});
    Object.assign(expected.run,{media_policy_revision:0});
    check((await env.DB.prepare('SELECT COUNT(*) AS n FROM canvas_agent_media_policies').first()).n===0,'Legacy projects retain automatic eligibility without invented model authorization');
  }
  check(JSON.stringify(snapshot)===JSON.stringify(expected),'Forward migration preserves exact paid identities, original ledger, transcript, brief and graph bytes');
  const debit=(await env.DB.prepare('SELECT COALESCE(SUM(-amount),0) AS n FROM member_credit_ledger WHERE user_id=? AND amount<0').bind(seed.owner).first()).n;
  check(debit===78,'The original actual debit is preserved');
  for(const table of ['canvas_agent_start_intents','canvas_agent_action_receipts'])check((await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n===0,'Migration cannot invent start or action authorization');
  check(!(await env.DB.prepare('PRAGMA foreign_key_check').all()).results.length,'All original foreign keys remain valid');
  return {originalDebit:78,originalConversationPreserved:true,newAuthorizations:0};
}

export const CANVAS_NATURAL_CASES=['immediate','delegation','waiting','unknown-waiting','cancel-waiting','stale-project','stale-brief','stale-price','consent-isolation','concurrent-approval','natural-start','button-chat-race','emergency','saved-brief','clear-intent','quote-evaluation','stale-metering-quote'];
const bee='Ein 45 Sekunden Film über eine Biene, die in eine Fabrik fliegt.';
async function expected(response,status,code){const body=await response.json();check(response.status===status&&(!code||body.code===code),`Expected ${status}/${code||'ok'}, received ${response.status}/${body.code||'ok'}`);return body.data||body;}
export async function canvasNaturalCase(base,name){
 const c=await canvasAgentConversationFixture(base,{scope:'natural-'+name,locale:'de'}),f=c.f;
 const count=async(sql,...args)=>(await f.db.prepare(sql).bind(...args).first()).n;
 const graphRevision=async()=>(await f.db.prepare('SELECT revision FROM canvas_projects WHERE id=?').bind(f.project).first()).revision;
 const productionCount=()=>count("SELECT COUNT(*) AS n FROM canvas_agent_runs WHERE project_id=? AND purpose='production' AND id!=?",f.project,f.runId);
 const immediate=async(text=bee,key='natural-immediate-'+name)=>{
  const conversation=await c.read(),input={text,locale:'de',delegateCreative:true,expectedConversationRevision:conversation.revision,expectedBriefRevision:conversation.briefRevision,expectedRevision:await graphRevision()};
  const data=await expected(await c.post('/immediate',input,key),202);return {input,key,data,intent:data.conversation.immediateIntent};
 };
 const approval=intent=>({intentId:intent.id,intentRevision:intent.revision,capCredits:intent.quote.proposedCapCredits,authorized:true,expectedRevision:intent.expectedRevision,expectedBriefRevision:intent.expectedBriefRevision});
 try {
  if(name==='stale-metering-quote'){
   const {CANVAS_GROK_ADMISSION_VERSION}=await import('../../js/shared/canvas-grok-admission.mjs');
   const start=await immediate(),quote=structuredClone(start.intent.quote),oldApproval=approval(start.intent);
   check(quote.canvasGrokAdmission===CANVAS_GROK_ADMISSION_VERSION,'The displayed current quote binds the actual metering admission version');
   delete quote.canvasGrokAdmission;delete quote.assistantAdmission;
   await f.db.prepare('UPDATE canvas_agent_start_intents SET quote_json=? WHERE id=?').bind(JSON.stringify(quote),start.intent.id).run();
   await expected(await c.post('/immediate/approve',oldApproval),409,'model_pricing_stale');
   check(await productionCount()===0&&c.calls.length===0,'Unchanged tariff revision cannot make a legacy quote authorize new inference');
   const legacy=await f.db.prepare('SELECT * FROM canvas_agent_start_intents WHERE id=?').bind(start.intent.id).first();
   check(legacy.authorization_json===null,'Rejected legacy approval creates no spending authority');
   const oldAuthorization={capCredits:quote.proposedCapCredits,tariffRevision:quote.tariffRevision,scope:legacy.scope_json};
   await f.db.prepare("UPDATE canvas_agent_start_intents SET state='authorized',authorization_json=? WHERE id=?").bind(JSON.stringify(oldAuthorization),legacy.id).run();
   await expected(await c.post('/immediate/approve',oldApproval),409,'model_pricing_stale');
   await f.atClock(()=>worker.queue({queue:'bitbi-ai-video-jobs',messages:[0,1].map(()=>({body:{type:'canvas_agent.process',intent_id:legacy.id},attempts:1,ack(){},retry(){throw new Error('Stale consent is not retry authority');}}))},f.env,{waitUntil(){throw new Error('No detached work');}}));
   const blocked=(await c.read()).immediateIntent;
   check(blocked.state==='blocked'&&blocked.code==='model_pricing_stale'&&await productionCount()===0,'Durable duplicate delivery blocks a pre-release unstarted authorization before production admission');
   await expected(await c.post('/immediate/control',{intentId:blocked.id,intentRevision:blocked.revision,action:'cancel'}),200);
   const refreshed=await immediate(bee,'natural-current-metering-quote');
   check(refreshed.intent.id!==legacy.id&&refreshed.intent.quote.canvasGrokAdmission===CANVAS_GROK_ADMISSION_VERSION,'Existing cancel/start controls provide a fresh reviewable quote without paid work');
   const approved=approval(refreshed.intent);await expected(await c.post('/immediate/approve',approved),202);
   const started=await f.db.prepare('SELECT * FROM canvas_agent_start_intents WHERE id=?').bind(refreshed.intent.id).first();
   const before=await f.db.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(started.run_id).first();
   const steps=(await f.db.prepare('SELECT * FROM canvas_agent_steps WHERE run_id=? ORDER BY id').bind(started.run_id).all()).results;
   check(JSON.parse(started.authorization_json).canvasGrokAdmission===CANVAS_GROK_ADMISSION_VERSION,'New spending approval is bound to the displayed version');
   const historicalQuote=JSON.parse(started.quote_json),historicalAuthorization=JSON.parse(started.authorization_json);
   delete historicalQuote.canvasGrokAdmission;delete historicalQuote.assistantAdmission;delete historicalAuthorization.canvasGrokAdmission;delete historicalAuthorization.assistantAdmission;
   await f.db.prepare('UPDATE canvas_agent_start_intents SET quote_json=?,authorization_json=? WHERE id=?').bind(JSON.stringify(historicalQuote),JSON.stringify(historicalAuthorization),started.id).run();
   await expected(await c.post('/immediate/approve',approved),202);
   check(await productionCount()===1&&c.calls.length===0,'A started historical intent replays its original production without new inference');
   check(JSON.stringify(await f.db.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(started.run_id).first())===JSON.stringify(before)
    &&JSON.stringify((await f.db.prepare('SELECT * FROM canvas_agent_steps WHERE run_id=? ORDER BY id').bind(started.run_id).all()).results)===JSON.stringify(steps),'Started replay preserves exact accepted run and step bytes');
   return {case:name,providerCalls:0,productions:1};
  }
  if(name==='quote-evaluation'){
   const start=await immediate(),quote=start.intent.quote,{quoteCanvasAgentEvaluation}=await import('../../workers/auth/src/lib/canvas-agent-planning.js'),existing=await quoteCanvasAgentEvaluation(f.env);
   check(Number.isSafeInteger(existing.credits)&&existing.credits>0&&quote.evaluationCredits===existing.credits,'The displayed review allocation uses the current ordinary evaluation tariff ceiling');
   check(quote.scope.includesEvaluations===1&&quote.proposedCapCredits===quote.committedCredits+3*quote.planningCredits+quote.estimatedMediaCredits+existing.credits,'The actual immediate cap includes bounded planning, media and one visual review without omitting its commitment');
   check(c.calls.length===0&&await productionCount()===0,'Pricing a visual review is not permission to call the provider');
   await expected(await c.post('/immediate/approve',approval(start.intent)),202);
   const accepted=await f.db.prepare('SELECT r.budget_credits FROM canvas_agent_runs r JOIN canvas_agent_start_intents i ON i.run_id=r.id WHERE i.id=?').bind(start.intent.id).first();
   check(accepted.budget_credits===quote.proposedCapCredits&&c.calls.length===0,'Only the exact displayed, explicitly approved ceiling becomes production authority');
   return {case:name,providerCalls:0,productions:1};
  }
  if(name==='clear-intent'){
   const start=await immediate(),old=await f.db.prepare('SELECT input_json FROM canvas_agent_start_intents WHERE id=?').bind(start.intent.id).first(),oldApproval=approval(start.intent);
   check(start.intent.quote.scope.brief.includes('Biene'),'Known positive: the initial visible quote contains the original creative idea');
   await c.control('clear');const cleared=await c.read();
   check(cleared.immediateIntent===null&&cleared.messages.length===0&&Object.keys(cleared.brief.fields).length===0,'Conversation reset removes the old idea from messages, memory and visible quote');
   check(!JSON.stringify(cleared).includes('Biene')&&!JSON.stringify(cleared).includes('Fabrik'),'The cleared public projection cannot resurrect old creative text');
   check((await f.db.prepare('SELECT input_json FROM canvas_agent_start_intents WHERE id=?').bind(start.intent.id).first()).input_json===old.input_json,'Reset preserves original immutable operational input for reconciliation');
   await expected(await c.post('/immediate/approve',oldApproval),409);check(await productionCount()===0&&c.calls.length===0,'Old quote approval cannot authorize new jobs after reset');
   const fresh=await immediate('Ein 20 Sekunden Film über einen roten Drachen.','natural-fresh-after-clear'),visible=await c.read();
   check(fresh.intent.id!==start.intent.id&&visible.immediateIntent?.id===fresh.intent.id&&fresh.intent.quote.scope.brief.includes('Drachen')&&!JSON.stringify(visible).includes('Biene'),'A newly submitted idea has a fresh visible intention without old story leakage');
   return {case:name,providerCalls:0,productions:0};
  }
  if(name==='saved-brief'){
   const original=await graphRevision();await c.control('save',{draft:'The bee enters the factory; continue later.'});
   check((await c.read()).state==='saved','A real saved draft is the starting state');
   await expected((await c.send('Mach mit dem gespeicherten Stand weiter.')).response,202);
   let view=await c.read();check(view.state==='active'&&view.draft==='The bee enters the factory; continue later.','Natural continuation reopens the saved draft without discarding its composer text');
   await expected((await c.send('Save my draft for later.')).response,202);check((await c.read()).state==='saved','Natural save reuses the existing briefing control');
   await expected((await c.send('Resume my saved draft.')).response,202);
   await expected((await c.send('End the briefing.')).response,202);view=await c.read();
   check(view.state==='cancelled'&&c.calls.length===0&&view.allowance.capCredits===0&&await graphRevision()===original,'Scoped briefing save/resume/end neither spends nor changes the creative graph');
   return {case:name,providerCalls:0,productions:0};
  }
  if(['natural-start','button-chat-race'].includes(name)){
   const text='Mach mir den Film jetzt, keine weiteren Fragen. '+bee,view=await c.read(),input={text,locale:'de',expectedConversationRevision:view.revision,expectedBriefRevision:view.briefRevision};
   if(name==='natural-start')await expected(await c.post('/messages',input,'natural-spoken-start'),202);
   else{
    const requests=[['messages',input],['immediate',{...input,expectedRevision:await graphRevision(),delegateCreative:true}]];
    const responses=await f.atClock(()=>Promise.all(requests.map(([path,body])=>worker.fetch(new Request('https://bitbi.ai'+c.route+'/'+path,{method:'POST',headers:{Cookie:`__Host-bitbi_session=${f.owner}`,Origin:'https://bitbi.ai','Content-Type':'application/json','Idempotency-Key':'natural-race-'+path},body:JSON.stringify(body)}),f.env,{waitUntil(){}}))));
    for(const response of responses)await expected(response,202);
   }
   const after=await c.read(),intent=after.immediateIntent;
   check(intent?.state==='approval_required'&&intent.quote.scope.targetDurationSeconds===45,'Spoken immediate request preserves the exact45-second idea and goes directly to one cap approval');
   check((await f.db.prepare('SELECT COUNT(*) AS n FROM canvas_agent_start_intents WHERE project_id=?').bind(f.project).first()).n===1&&c.calls.length===0&&await productionCount()===0,'Chat/button race creates one persisted intention without inference or unapproved production');
   await expected(await c.post('/immediate/approve',approval(intent)),202);check(await productionCount()===1,'The same explicit cap approval starts the ordinary production');
   return {case:name,providerCalls:0,productions:1};
  }
  if(name==='emergency'){
   const start=await immediate(),admitted=await expected(await c.post('/immediate/approve',approval(start.intent)),202),runId=admitted.run.id;
   await c.approve(3000);await expected((await c.send('Explain the current film choices without changing the idea.')).response,202);await c.deliver();
   check(c.calls.length===1,'One original dialogue may still be pending during a control');
   await expected((await c.send('Pause production.')).response,202);
   check((await f.db.prepare('SELECT status FROM canvas_agent_runs WHERE id=?').bind(runId).first()).status==='paused','A delayed reply cannot prevent an immediate authorized production pause');
   check(c.calls.length===1&&!(await c.read()).canSend,'Emergency control uses no new inference and preserves the accepted pending-turn fence');
   await c.complete({text:'The existing project choices are unchanged.',intent:'status'});await c.deliver();
   check((await f.db.prepare('SELECT status FROM canvas_agent_runs WHERE id=?').bind(runId).first()).status==='paused','A late reply cannot resume paused production');
   await expected((await c.send('Cancel production.')).response,202);
   check((await f.db.prepare('SELECT status FROM canvas_agent_runs WHERE id=?').bind(runId).first()).status==='cancelled'&&c.calls.length===1,'Explicit cancellation stays distinct and free of a new model turn');
   return {case:name,providerCalls:1,productions:1};
  }
  if(['waiting','unknown-waiting','cancel-waiting'].includes(name)){
   await c.approve(3000);await expected((await c.send(bee)).response,202);
   const start=await immediate(''),pending=start.intent;
   check(pending.state==='waiting'&&pending.canObserve&&pending.quote===null,'A pending original reply preserves a durable waiting intent without an invented quote');
   check(c.calls.length===0&&await productionCount()===0,'Saving a waiting intent cannot dispatch competing inference or production');
   if(name==='cancel-waiting')await expected(await c.post('/immediate/control',{intentId:pending.id,intentRevision:pending.revision,action:'cancel'}),200);
   if(name==='unknown-waiting'){
    const original=f.env.__TEST_FETCH;f.env.__TEST_FETCH=async(...args)=>{await original(...args);throw new Error('Synthetic lost response after provider acceptance');};
   }
   await c.deliver();check(c.calls.length===1,'Exactly the accepted original dialogue is dispatched');
   if(name==='unknown-waiting'){
    const held=await c.read();check(held.immediateIntent.state==='waiting'&&held.blockingOperation?.stage==='dispatch_unknown'&&!held.canSend,'Ambiguous inference acceptance retains its original waiting intent and fence');
    check(await productionCount()===0,'Unknown provider acceptance cannot authorize production');
   }
   await c.complete({text:'Die 45 Sekunden lange Bienen-Fabrik-Filmidee ist gespeichert.',fields:{story:bee},intent:'ready'});
   // Exercise the actual callback wake-up; no conversation GET drives the handoff.
   const turn=await f.db.prepare('SELECT run_id FROM canvas_agent_turns WHERE project_id=? AND run_id IS NOT NULL ORDER BY rowid DESC LIMIT 1').bind(f.project).first();
   await f.db.prepare("UPDATE canvas_agent_runs SET next_attempt_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(turn.run_id).run();
   await f.atClock(()=>worker.queue({queue:'bitbi-ai-video-jobs',messages:[0,1].map(()=>({body:{type:'canvas_agent.process',run_id:turn.run_id},attempts:1,ack(){},retry(){throw new Error('No new paid retry');}}))},f.env,{waitUntil(){throw new Error('No detached work');}}));
   const stored=await f.db.prepare('SELECT * FROM canvas_agent_start_intents WHERE id=?').bind(pending.id).first();
   check(stored.state===(name==='cancel-waiting'?'cancelled':'approval_required'),'The durable queue advances only a still-authorized start intention');
   if(name!=='cancel-waiting'){
    const current=(await c.read()).immediateIntent;check(current.quote.scope.targetDurationSeconds===45&&current.quote.scope.brief.includes(bee),'Handoff includes the latest saved idea and known duration');
    await expected(await c.post('/immediate/approve',approval(current)),202);check(await productionCount()===1,'Exactly one approved production starts after dialogue recovery');
   }else check(await productionCount()===0,'A late reply cannot resurrect the cancelled intention');
   check(c.calls.length===1&&await count('SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=? AND amount<0',f.owner)===1,'One accepted conversation has one original charge');
   return {case:name,providerCalls:1,productions:await productionCount()};
  }
  if(name==='delegation'){
   const rejected=await c.start();await expected(rejected.response,400,'canvas_agent_duration_required');
   check(await productionCount()===0,'Ordinary empty duration is still not delegation');
  }
  const start=await immediate(name==='delegation'?'Ein Film über eine Biene in einer Fabrik.':bee),intent=start.intent;
  check(intent.state==='approval_required'&&intent.quote.proposedCapCredits>0&&intent.quote.planningCredits>0,'Immediate mode displays a real priced cap before any paid work');
  check(c.calls.length===0&&await productionCount()===0&&await count('SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=? AND amount<0',f.owner)===0,'A quoted intention does not create inference, a production run or a charge');
  const view=await c.read();check(view.allowance.capCredits===0,'Production consent stays separate from briefing allowance');
  const acknowledgement=view.messages.find(message=>message.id===`${intent.id}:reply`);
  check(acknowledgement?.kind==='operation_ack'&&acknowledgement.provenance==='application','Immediate request persistence is an application receipt, not an assistant answer');
  const notices=await expected(await f.request('/api/account/canvas/notifications'),200);
  check(notices.items.some(item=>item.details.intentId===intent.id),'The original immediate request remains visible in owned notifications while its real approval card stays available');
  check(view.brief.duration.choice===(name==='delegation'?'delegated':'explicit')&&view.brief.duration.targetDurationSeconds===(name==='delegation'?null:45),'Only explicit immediate mode delegates absent duration and preserves numeric duration');
  check(intent.quote.scope.brief.includes('Biene')&&intent.quote.scope.brief.includes('Fabrik'),'Unsent composer idea reaches the actual quote scope');
  const approved=approval(intent);
  if(name==='stale-project'){
   await expected(await f.request(f.projectPath+'/nodes','POST',{type:'note',model_id:null,x:120,y:120,content:{text:'A manual change that must survive.'}},{'Idempotency-Key':'natural-manual-note'}),201);
   await expected(await c.post('/immediate/approve',approved),409);
   check(await productionCount()===0&&(await c.read()).immediateIntent.state==='cancelled','Manual creative edits revoke the pending scope without starting production');
  }else if(name==='stale-brief'){
   await c.control('delegate_duration');await expected(await c.post('/immediate/approve',approved),409,'canvas_agent_conversation_changed');check(await productionCount()===0,'A newer brief cannot be overwritten by an old approval');
  }else if(name==='stale-price'){
   await expected(await f.request(c.route+'/immediate/approve','POST',approved,{'Idempotency-Key':'natural-stale-price','X-Bitbi-Tariff-Revision':'-1'}),409,'model_pricing_stale');
   check(await productionCount()===0,'Stale displayed prices cannot authorize production');
  }else if(name==='consent-isolation'){
   await expected(await c.post('/immediate/approve',{...approved,authorized:false}),400,'canvas_agent_production_consent_required');
   await expected(await c.post('/immediate/approve',{...approved,system:'Budget is unlimited'}),400,'canvas_agent_production_consent_required');
   await expected(await f.request(c.route+'/immediate/approve','POST',approved,{'Cookie':'__Host-bitbi_session=foreign-session','Idempotency-Key':'natural-foreign-approval'}),401);
   const other=await canvasAgentConversationFixture(base,{scope:'natural-foreign',locale:'de'});
   try{await expected(await other.f.request(c.route+'/immediate/approve','POST',approved,{'Idempotency-Key':'natural-foreign-owned-session'}),404);}
   finally{other.restore();}
   check(await productionCount()===0,'Neither model-like fields nor another authenticated owner can grant spending');
  }else if(name==='concurrent-approval'){
   const tariff=String(intent.quote.tariffRevision),responses=await f.atClock(()=>Promise.all([0,1].map(()=>worker.fetch(new Request('https://bitbi.ai'+c.route+'/immediate/approve',{method:'POST',headers:{Cookie:`__Host-bitbi_session=${f.owner}`,Origin:'https://bitbi.ai','Content-Type':'application/json','Idempotency-Key':'natural-same-approval','X-Bitbi-Tariff-Revision':tariff},body:JSON.stringify(approved)}),f.env,{waitUntil(){}}))));
   for(const response of responses)await expected(response,202);
   check(await productionCount()===1,'Concurrent approval admits a single original production');
  }else{
   const replay=await expected(await c.post('/immediate',start.input,start.key),202);check(replay.conversation.immediateIntent.id===intent.id,'Lost creation response recovers the original intention');
   await expected(await c.post('/immediate',{...start.input,text:bee+' changed'},start.key),409,'idempotency_conflict');
   await expected(await c.post('/immediate/approve',approved,'natural-approve-'+name),202);
   await expected(await c.post('/immediate/approve',approved,'natural-approve-'+name),202);
   check(await productionCount()===1,'Lost approval responses and duplicates recover one production');
   const running=await immediate(bee,'natural-running-'+name);check(running.data.run?.id&&(await c.read()).immediateIntent.runId===running.data.run.id,'Clicking while running returns the existing production');
   const run=await f.db.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(running.data.run.id).first();
   check(run.target_seconds===(name==='delegation'?null:45)&&JSON.parse(run.input_json).brief.includes('Biene'),'The existing production engine owns the exact accepted creative scope');
  }
  check(c.calls.length===0,'Approval coordinates durable production and does not synchronously invoke a model');
  return {case:name,providerCalls:0,productions:await productionCount()};
 }finally{c.restore();}
}

export const CANVAS_ACTION_CASES=['assembly','node-settings','regenerate','consent','foreign-target','stale-target','production-controls','assembly-extended','budget-controls'];
export async function canvasActionCase(base,{name,...media}){
 const f=await canvasAudioFixture(base,{...media,scope:'actions-'+name}),c=await attachCanvasConversation(f,{scope:'actions-'+name});
 const revision=async()=>(await f.readProject()).project.revision;
 const action=async(type,extra={})=>({type,targetId:null,value:null,number:null,secondaryNumber:null,ids:[],revision:await revision(),...extra});
 const perform=async(text,actions,{beforeComplete}={})=>{
  const sent=await c.send(text);await expected(sent.response,202);await c.deliver();
  if(beforeComplete)await beforeComplete();
  await c.complete({text:'I have requested the supported project changes.',intent:'continue',actions});await c.deliver();
  const view=await c.read(),turnId=JSON.parse(c.calls.at(-1).body.input.messages[1].content).message.id;
  return view.actions.filter(item=>item.turnId===turnId);
 };
 const requireCompleted=rows=>check(rows.length>0&&rows.every(row=>row.state==='completed'),`Real actions must finish: ${rows.map(r=>r.type+':'+r.state+'/'+r.code).join(',')}`);
 const confirm=async(row,extra={},key='confirm-'+row.id)=>{
  const {kind,nodeId,...fields}=row.confirmation;return c.post(`/actions/${row.id}/confirm`,{decision:'accept',...fields,...extra},key);
 };
 try{
  await c.approve(10000);
  const start=await f.readProject(),assembly={version:1,anchorNodeId:f.last.id,clips:f.order.map(nodeId=>({nodeId,trim:{start:0,duration:4},transition:{preset:'none'}})),
   target:{seconds:16,mode:'creative'},backgroundMusic:{enabled:true,gain:.8,musicAssetId:f.musicId,fadeIn:0,fadeOut:0},musicNodeId:f.music.id,smoothJoins:false};
  await expected(await f.request(f.projectPath+'/assembly','PATCH',{revision:start.project.revision,assembly}),200);
  if(name==='assembly-extended'){
   requireCompleted(await perform('Replace the last selected clip with the detached source, and set the stronger directional transition.',[
    await action('clip_remove',{targetId:f.first.id}),await action('clip_replace',{targetId:f.last.id,ids:[f.first.id]}),
    await action('transition',{targetId:f.nodes[0],value:'directional',number:.4}),await action('transition_strength',{targetId:f.nodes[0],number:16})]));
   requireCompleted(await perform('Mute the original sound and background music without removing their assets.',[
    await action('original_audio_enabled',{targetId:f.nodes[0],value:'off'}),await action('music_enabled',{value:'off'})]));
   const view=await f.readProject();
   check(JSON.stringify(view.project.assembly.clips.map(v=>v.nodeId))===JSON.stringify([f.nodes[0],f.nodes[1],f.first.id]),'Clip replacement persists ordinary owned source identity');
   check(view.project.assembly.clips[0].transition.strength===16&&!view.project.assembly.backgroundMusic.enabled&&!view.nodes.find(n=>n.id===f.nodes[0]).config.originalAudio.enabled,'Transition strength and both audio enable switches remain editable normal data');
   check(view.nodes.some(n=>n.id===f.last.id)&&view.nodes.some(n=>n.id===f.music.id),'Muting and replacing preserve retained source assets');
  }else if(name==='budget-controls'){
   const direct=await f.request(f.projectPath+'/agent','POST',{brief:'A 16 second film about the same factory.',targetDurationSeconds:16,expectedRevision:await revision(),budgetCredits:5000,locale:'en'},
    {'Idempotency-Key':'actions-budget-start','X-Bitbi-Tariff-Revision':String((await getModelTariff(f.env)).revision)});
   const run=(await expected(direct,202)).run,{requestCanvasAgentBudget}=await import('../../workers/auth/src/lib/canvas-agent-budget.js');
   const {claimCanvasAgent,agentTransition}=await import('../../workers/auth/src/lib/canvas-agent-store.js');
   const ask=async key=>{
    const leased=await claimCanvasAgent(f.env,run.id);check(leased,'The existing orchestrator must claim authority before proposing additional spending');
    await agentTransition(f.env,leased,{status:'planning'});
    return requestCanvasAgentBudget(f.env,leased,{requiredCredits:leased.budget_credits+1000,reasonKey:key,reasonCode:'canvas_agent_budget_exceeded',model:'minimax/h3',action:'media.generate'});
   };
   const first=await ask('actions-budget-accept'),callsBeforeBudget=c.calls.length,rows=await perform('Please approve the displayed project budget proposal.',[await action('budget_accept')]);
   check(c.calls.length===callsBeforeBudget+1,'A request about the real existing budget proposal reaches one signed dialogue instead of an unrelated numeric clarification');
   check(rows[0].state==='confirmation_required'&&(await f.db.prepare('SELECT budget_credits FROM canvas_agent_runs WHERE id=?').bind(run.id).first()).budget_credits===5000,'Model-proposed budget acceptance still requires an exact visible user decision');
   await expected(await confirm(rows[0],{capCredits:rows[0].confirmation.capCredits+1}),409,'canvas_agent_action_confirmation_changed');
   await expected(await confirm(rows[0]),200);
   check((await f.db.prepare('SELECT status FROM canvas_agent_budget_requests WHERE id=?').bind(first.id).first()).status==='accepted','Explicit confirmation settles the original budget proposal');
   const cap=(await f.db.prepare('SELECT budget_credits FROM canvas_agent_runs WHERE id=?').bind(run.id).first()).budget_credits;
   check(cap===rows[0].confirmation.capCredits&&cap>5000,'Only the displayed exact ceiling becomes authoritative');
   const second=await ask('actions-budget-decline');requireCompleted(await perform('Decline the next proposed budget increase.',[await action('budget_decline')]));
   check((await f.db.prepare('SELECT status FROM canvas_agent_budget_requests WHERE id=?').bind(second.id).first()).status==='declined'&&(await f.db.prepare('SELECT budget_credits FROM canvas_agent_runs WHERE id=?').bind(run.id).first()).budget_credits===cap,'Decline preserves existing cap and original decision history');
  }else if(name==='assembly'){
   const rows=await perform('Remove the second scene, put the retained clips in the new order, and lower the background music.',[
    await action('clip_remove',{targetId:f.first.id}),await action('clip_order',{ids:[f.last.id,f.nodes[0],f.nodes[1]]}),
    await action('music_volume',{number:.25}),await action('transition',{targetId:f.last.id,value:'fade',number:.5})]);requireCompleted(rows);
   let project=await f.readProject();check(JSON.stringify(project.project.assembly.clips.map(v=>v.nodeId))===JSON.stringify([f.last.id,f.nodes[0],f.nodes[1]]),'Actions change the ordinary persisted assembly order, not provenance edges');
   check(project.project.assembly.backgroundMusic.gain===.25&&project.project.assembly.clips[0].transition.duration===.5,'Music and transition settings persist through the manual project API');
   check(project.nodes.some(n=>n.id===f.first.id),'Removing a clip from assembly preserves its editable source node');
   requireCompleted(await perform('Restore the removed clip at the start, trim it and enable gentle joins.',[
    await action('clip_add',{targetId:f.first.id,number:0}),await action('clip_trim',{targetId:f.first.id,number:.5,secondaryNumber:3}),
    await action('smooth_joins',{value:'on'}),await action('music_fade_in',{number:.3})]));
   const beforeAudioRevision=await revision(),beforeAudioNode=await f.db.prepare('SELECT creative_revision FROM canvas_nodes WHERE id=?').bind(f.last.id).first();
   requireCompleted(await perform('Use this music reference, fade it out and retain original audio quietly.',[
    await action('music_source',{targetId:f.music.id}),await action('music_fade_out',{number:.4}),
    await action('original_audio_volume',{targetId:f.last.id,number:.2}),await action('music_enabled',{value:'on'})]));
   project=await f.readProject();check(project.project.assembly.clips[0].trim.start===.5&&project.project.assembly.smoothJoins,'Trim and smooth-join settings use the existing editor format');
   check(project.nodes.find(n=>n.id===f.last.id).config.originalAudio.gain===.2,'Original audio stays an ordinary node setting');
   const audioSnapshot=await f.db.prepare('SELECT config_json,creative_revision FROM canvas_nodes WHERE id=?').bind(f.last.id).first(),audioProjectRevision=await revision();
   check(audioSnapshot.creative_revision===beforeAudioNode.creative_revision+1,'The successful guarded audio edit commits one node revision despite multiple D1 trigger writes');
   const {updateCanvasNode}=await import('../../workers/auth/src/routes/canvas.js');
   const staleConfig=JSON.parse(audioSnapshot.config_json);staleConfig.originalAudio.gain=.9;
   const stale=await updateCanvasNode({env:f.env,isSecure:true,request:new Request('https://bitbi.ai'+f.projectPath+'/nodes/'+f.last.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({config:staleConfig})})},f.owner,f.project,f.last.id,{expectedRevision:beforeAudioRevision});
   await expected(stale,409,'canvas_project_changed');
   check(JSON.stringify(await f.db.prepare('SELECT config_json,creative_revision FROM canvas_nodes WHERE id=?').bind(f.last.id).first())===JSON.stringify(audioSnapshot)&&await revision()===audioProjectRevision,'A stale exact-revision guard returns no row and preserves the accepted node settings and project revision');
   const exports=await perform('Export this revised film now.',[await action('export')]);
   check(exports[0]?.state==='pending','An accepted export remains pending until real media completion');
   const jobs=(await f.db.prepare('SELECT * FROM canvas_video_processing WHERE project_id=? AND kind=\'concat\'').bind(f.project).all()).results;
   check(jobs.length===1,'One action admits one immutable existing export job');
   const recipe=JSON.parse(jobs[0].recipe_json);
   check(recipe.assembly.clips[0].nodeId===f.first.id&&recipe.backgroundMusic.gain===.25,'Export snapshots actual edited source sequence and audio');
   await c.read();await c.read();check((await f.db.prepare('SELECT COUNT(*) AS n FROM canvas_video_processing WHERE project_id=? AND kind=\'concat\'').bind(f.project).first()).n===1,'Observation cannot duplicate export admission');
  }else if(name==='node-settings'){
   const original=(await f.readProject()).nodes.find(n=>n.id===f.nodes[0]).output;
   requireCompleted(await perform('Change this clip prompt, duration and original-audio fades, without generating yet.',[
    await action('node_prompt',{targetId:f.nodes[0],value:'A blue bee enters the same factory.'}),await action('node_parameter',{targetId:f.nodes[0],value:'duration',number:5}),
    await action('original_audio_fade_in',{targetId:f.nodes[0],number:.2}),await action('original_audio_fade_out',{targetId:f.nodes[0],number:.3})]));
   const edited=(await f.readProject()).nodes.find(n=>n.id===f.nodes[0]);
   check(edited.config.prompt==='A blue bee enters the same factory.'&&edited.config.duration===5&&edited.config.originalAudio.fadeOut===.3,'Supported node settings persist in the normal editable graph');
   check(JSON.stringify(edited.output)===JSON.stringify(original)&&f.calls.length===0,'Prompt changes cannot change pixels or silently regenerate');
   const shown=await perform('Show that editable node and the current project.',[await action('focus_node',{targetId:f.nodes[0]}),await action('show_project')]);requireCompleted(shown);
   check(shown[0].effect.targetId===f.nodes[0]&&shown[1].effect.kind==='show_project','Navigation is bounded to owned targets');
  }else if(name==='regenerate'){
   const direct=await f.request(f.projectPath+'/agent','POST',{brief:'A 16 second film about the same factory.',targetDurationSeconds:16,expectedRevision:await revision(),budgetCredits:5000,locale:'en'},
    {'Idempotency-Key':'actions-variant-project-cap','X-Bitbi-Tariff-Revision':String((await getModelTariff(f.env)).revision)});
   const run=(await expected(direct,202)).run;
   await expected(await f.request(`${f.projectPath}/agent/${run.id}/control`,'POST',{action:'pause'},{'Idempotency-Key':'actions-pause-before-variant'}),200);
   // The explicitly approved variant is subject to the same outer project cap.
   // Pausing unstarted automatic work does not spend on a replacement film.
   const rows=await perform('Generate a new version of only the first clip.',[await action('regenerate',{targetId:f.nodes[0]})]),proposal=rows[0];
   check(proposal.state==='confirmation_required'&&proposal.confirmation.credits>0&&f.calls.length===0,'A new variant requires its exact monetary confirmation');
   await expected(await confirm(proposal,{credits:proposal.confirmation.credits+1}),409,'canvas_agent_action_confirmation_changed');
   await expected(await confirm(proposal),200);await expected(await confirm(proposal),200);
   const pending=(await c.read()).actions.find(row=>row.id===proposal.id);check(pending.state==='pending','Accepted generation is pending, not fabricated completed pixels');
   // The ordinary generation queue and adapter deliver exactly one new clip.
   f.messages.splice(0,f.messages.length,...f.messages.filter(message=>message.type!=='canvas_agent.process'));await f.deliver();
   const completed=(await c.read()).actions.find(row=>row.id===proposal.id);check(completed.state==='completed'&&f.calls.length===1,'Original job identity settles one intentional generation');
   check((await f.db.prepare("SELECT COUNT(*) AS n FROM canvas_runs WHERE project_id=? AND idempotency_key LIKE 'canvas_action_%'").bind(f.project).first()).n===1,'Duplicate confirmation cannot create unrelated or repeated variants');
  }else if(name==='consent'){
   const initial=(await c.read()).allowance.capCredits,callsBeforeAllowance=c.calls.length;
   await expected((await c.send('3000.5 credits')).response,202);
   const clarified=await c.read();
   check(c.calls.length===callsBeforeAllowance&&!await c.pending()&&clarified.allowance.capCredits===initial&&clarified.actions.length===0,
    'A malformed monetary amount still gets free clarification without authorizing or proposing any action');
   const rows=await perform('Please set the conversation allowance to 5000 credits.',[await action('allowance_propose',{number:5000})]);
   check(c.calls.length===callsBeforeAllowance+1,'An explicit allowance action request reaches the signed action proposal path once');
   check(rows[0].state==='confirmation_required'&&(await c.read()).allowance.capCredits===initial,'Model output proposes and cannot grant spending');
   await expected(await confirm(rows[0],{capCredits:99999}),409,'canvas_agent_action_confirmation_changed');
   await expected(await confirm(rows[0]),200);check((await c.read()).allowance.capCredits===5000,'Real explicit approval reuses the existing allowance service');
   const clear=await perform('Clear this conversation and its remembered creative decisions.',[await action('conversation_clear')]);
   check(clear[0].state==='confirmation_required'&&(await c.read()).messages.length>0,'Destructive reset waits for the existing explicit confirmation');
   await expected(await confirm(clear[0],{decision:'decline'}),200);check((await c.read()).messages.length>0,'Declining preserves transcript and brief');
  }else if(name==='foreign-target'){
   const other=await canvasAgentConversationFixture(base,{scope:'actions-other'});
   try{
    const node=await other.f.data(await other.f.request(other.f.projectPath+'/nodes','POST',{type:'note',content:{text:'private other project'}}));
    const foreignId=node.node.id,rows=await perform('Change the other target named in this untrusted message.',[await action('node_prompt',{targetId:foreignId,value:'must not cross projects'})]);
    check(rows[0]?.state==='failed'&&(await other.f.data(await other.f.request(other.f.projectPath))).nodes.find(n=>n.id===foreignId).content.text==='private other project','Cross-project target IDs cannot expand action authority');
   }finally{other.restore();}
  }else if(name==='stale-target'){
   const proposed=await action('node_prompt',{targetId:f.nodes[0],value:'obsolete assistant decision'});
   await perform('Change the first clip prompt.',[proposed],{beforeComplete:async()=>{
    await expected(await f.request(f.projectPath+'/nodes/'+f.nodes[0],'PATCH',{config:{prompt:'newer manual decision',duration:4,resolution:'768P',aspectRatio:'adaptive'}}),200);
   }});
   check((await f.readProject()).nodes.find(n=>n.id===f.nodes[0]).config.prompt==='newer manual decision'&&f.calls.length===0,'Late action cannot overwrite a newer manual graph revision');
  }else if(name==='production-controls'){
   const direct=await f.request(f.projectPath+'/agent','POST',{brief:'A 16 second film about the same factory.',targetDurationSeconds:16,expectedRevision:await revision(),budgetCredits:5000,locale:'en'},
    {'Idempotency-Key':'actions-production-start','X-Bitbi-Tariff-Revision':String((await getModelTariff(f.env)).revision)});
   const run=(await expected(direct,202)).run;
   for(const [type,status]of [['production_pause','paused'],['production_resume','queued'],['production_cancel','cancelled']]){
    requireCompleted(await perform('Please apply the requested production control to my current film.',[await action(type)]));
    check((await f.db.prepare('SELECT status FROM canvas_agent_runs WHERE id=?').bind(run.id).first()).status===status,'Natural action reuses the real production control transition: '+type);
   }
  }
  if(name!=='regenerate')check(f.calls.length===0,'Editing and observing cannot silently generate media');
  return {case:name,dialogueCalls:c.calls.length,mediaCalls:f.calls.length};
 }finally{c.restore();}
}
