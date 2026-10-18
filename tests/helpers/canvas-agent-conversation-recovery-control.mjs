import worker from '../../workers/auth/src/index.js';
import {canvasAgentConversationFixture} from './canvas-agent-conversation-control.mjs';

const check=(value,message)=>{if(!value)throw new Error(message);};
export const CANVAS_CONVERSATION_RECOVERY_CASES=['snail','prepare','rejected','rejected-tail','malformed','invalid-tail','lost-acceptance','ack-error','normalization','storage','completed-tail','failed-projection','expired-projection','historical','stale-policy','isolation'];
// Synthetic regression wording, never a replacement for a member's saved text.
export const CANVAS_SNAIL_BRIEF='Ein lustiger Clip von ungefähr 45 Sekunden mit Hintergrundmusik: Eine Schnecke sitzt auf einem Blatt, und Ameisen schneiden das Blatt ab.';
const reply={text:'Die Idee ist gespeichert: Ein humorvoller Film von ungefähr 45 Sekunden über die Schnecke und die Ameisen, mit Hintergrundmusik.',
  fields:{story:'Eine Schnecke sitzt auf einem Blatt, das Ameisen abschneiden.',mood:'humorvoll',audio:'Hintergrundmusik'},intent:'ready'};
const code=async(response,status,expected)=>{const body=await response.json();check(response.status===status&&(!expected||body.code===expected),`Expected ${status}/${expected||'ok'}, received ${response.status}/${body.code||'ok'}`);return body;};

export async function canvasConversationRecoveryCase(base,name) {
  check(CANVAS_CONVERSATION_RECOVERY_CASES.includes(name),'Known conversation recovery case');
  const c=await canvasAgentConversationFixture(base,{scope:'chat-recovery-'+name,locale:'de'}),f=c.f,serviceCalls=[];
  const service=f.env.AI_LAB;
  f.env.AI_LAB={fetch(request){serviceCalls.push(new URL(request.url).pathname);return service.fetch(request);}};
  const get=sql=>f.db.prepare(sql).bind(f.project).first();
  const turn=()=>get("SELECT * FROM canvas_agent_turns WHERE project_id=? AND run_id IS NOT NULL ORDER BY rowid DESC LIMIT 1");
  const run=()=>get("SELECT * FROM canvas_agent_runs WHERE project_id=? AND purpose='briefing' ORDER BY rowid DESC LIMIT 1");
  const operation=()=>get("SELECT o.* FROM canvas_agent_model_operations o JOIN canvas_agent_runs r ON r.id=o.run_id WHERE r.project_id=? AND r.purpose='briefing' ORDER BY o.rowid DESC LIMIT 1");
  const attempt=()=>get("SELECT a.* FROM member_ai_usage_attempts_v2 a JOIN canvas_agent_steps s ON s.usage_attempt_id=a.id JOIN canvas_agent_runs r ON r.id=s.run_id WHERE r.project_id=? AND r.purpose='briefing' ORDER BY a.rowid DESC LIMIT 1");
  const debitCount=async()=>(await f.db.prepare('SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=? AND amount<0').bind(f.owner).first()).n;
  const projectRevision=async()=>(await get('SELECT revision FROM canvas_projects WHERE id=?')).revision;
  const wake=async()=>{
    const row=await run();f.advance(61000);
    await f.atClock(()=>worker.queue({queue:'bitbi-ai-video-jobs',messages:[0,1].map(()=>({body:{type:'canvas_agent.process',run_id:row.id},attempts:1,
      ack(){},retry(){throw new Error('Receipt recovery must never retry paid dispatch');}}))},f.env,{waitUntil(){throw new Error('No browser-owned recovery loop');}}));
  };
  const view=()=>c.read();
  try {
    await c.approve(3000);
    await c.control('skip_questions',{locale:'de'});
    const asked=await view();
    check(asked.brief.duration.asked&&!asked.brief.duration.choice&&/Wie lang/.test(asked.messages.at(-1).text),'Skip asks for duration once and never delegates spending or duration');
    check(c.calls.length===0&&await debitCount()===0,'The local duration question does not claim model inference');
    const sourceRevision=await projectRevision();

    if(name==='prepare') {
      const live=f.env.AI_LAB;
      f.env.AI_LAB={fetch(request){if(new URL(request.url).pathname.endsWith('/prepare'))throw new Error('Synthetic prepare failure with private prose');return live.fetch(request);}};
    }
    if(['snail','rejected','rejected-tail','lost-acceptance','ack-error','historical'].includes(name)) {
      const external=f.env.__TEST_FETCH;
      f.env.__TEST_FETCH=async(...args)=>{
        await external(...args);
        if(name==='snail')return Response.json({success:true,result:{state:'Queued'}},{status:202});
        if(name==='rejected'||name==='rejected-tail')return Response.json({success:false,errors:[{code:5004,message:'Synthetic private provider prose'}]},{status:400});
        if(name==='ack-error')return Response.json({success:false,errors:[{code:5004,message:'Contradictory acknowledgement'}]},{status:202});
        throw new Error('Synthetic lost initial response after provider acceptance');
      };
    }
    const sent=await c.send(CANVAS_SNAIL_BRIEF);await code(sent.response,202);
    const originalTurn=await turn();
    check(originalTurn.user_text===CANVAS_SNAIL_BRIEF,'Admission preserves the exact saved user wording');
    check((await view()).brief.duration.targetDurationSeconds===45,'The supplied 45-second answer resolves duration');

    if(name==='stale-policy') {
      const step=await f.db.prepare('SELECT * FROM canvas_agent_steps WHERE run_id=?').bind(originalTurn.run_id).first();
      const input=JSON.parse(step.input_json);delete input.payload.policy;
      const removed=await f.db.prepare("DELETE FROM canvas_agent_steps WHERE id=? AND status='ready' AND usage_attempt_id IS NULL").bind(step.id).run();
      check(removed.meta.changes===1,'Only an undispatched historical fixture step is reconstructed');
      await f.db.prepare("INSERT INTO canvas_agent_steps(id,run_id,step_key,kind,input_json,allocation_credits,created_at,updated_at) VALUES(?,?,?,'plan',?,?,?,?)")
        .bind(step.id,step.run_id,step.step_key,JSON.stringify(input),step.allocation_credits,step.created_at,step.updated_at).run();
    }
    await c.deliver();
    if(name==='prepare'||name==='stale-policy') {
      const current=await view();
      check(c.calls.length===0&&!await operation()&&await debitCount()===0,'Known preparation failure cannot have provider work or a charge');
      check(current.messages.at(-1).delivery.stage==='preparation_failed'&&current.canSend===true&&!current.blockingOperation,'Known local failure cannot lock the project as uncertain inference');
      check(current.allowance.committedCredits===0&&current.allowance.reservedCredits===0,'Released or absent reservation is not displayed as spending');
      const held=await attempt();if(held)check(held.provider_outcome==='not_dispatched'&&held.billing_status==='released','Prepare failure releases only proven undispatched work');
      check(current.messages.at(-1).text===''&&!JSON.stringify(current.messages.at(-1).delivery).includes('private prose'),'System failure never invents an assistant reply or exposes exception text');
      check((await turn()).user_text===CANVAS_SNAIL_BRIEF,'Failure preserves the original wording');
      await c.control('save',{draft:'Später fortsetzen.'});check((await view()).draft==='Später fortsetzen.','Saving remains available');
      await code(await c.post('/messages',sent.input,sent.key),200);await wake();
      check(c.calls.length===0,'Observation and original request replay do not create inference');
      return {case:name,providerCalls:0,charges:0};
    }
    check(c.calls.length===1,'The one accepted turn submits exactly one original provider request');
    const call=c.calls[0],context=JSON.parse(call.body.input.messages[1].content);
    check(context.message.id===originalTurn.id&&context.message.text===CANVAS_SNAIL_BRIEF&&context.brief.duration.targetDurationSeconds===45,'Signed preparation binds source wording and known duration');
    if(name==='rejected'||name==='rejected-tail') {
      const current=await view(),usage=await attempt();
      check(current.messages.at(-1).delivery.stage==='rejected'&&current.canSend===true&&!current.blockingOperation,'Proven rejection is distinct from uncertain dispatch');
      check(usage.billing_status==='released'&&usage.provider_outcome==='failed'&&await debitCount()===0,'Documented no-inference rejection releases once without a debit');
      if(name==='rejected-tail') {
        await code((await c.send('Eine andere kreative Idee als ausdrücklich neue Nachricht.')).response,202);
        check(c.calls.length===1&&await debitCount()===0,'Next-message admission after definite rejection does not resubmit or charge the rejected turn');
        return {case:name,providerCalls:1,charges:0};
      }
      await wake();await view();check(c.calls.length===1,'Rejected request is never submitted again');
      return {case:name,providerCalls:1,charges:0};
    }
    if(['lost-acceptance','ack-error','historical'].includes(name)) {
      if(name==='historical') {
        const op=await operation();
        await f.db.prepare('DELETE FROM canvas_agent_model_operations WHERE id=?').bind(op.id).run();
        await f.db.prepare("UPDATE canvas_agent_runs SET status='review_required',error_code='canvas_agent_execution_review_required' WHERE id=?").bind(originalTurn.run_id).run();
      }
      const held=await attempt(),current=await view();
      check(current.messages.at(-1).delivery.stage==='dispatch_unknown'&&current.blockingOperation?.turnId===originalTurn.id&&current.canSend===false,'Unknown accepted work blocks only its unresolved operation');
      check(current.allowance.chargedCredits===0&&current.allowance.committedCredits>0&&current.allowance.reservedCredits>0&&current.allowance.pendingOutcomeCredits>0,'Held commitment is not a finalized charge');
      await code(await c.post('/messages',sent.input,sent.key),200);
      await code((await c.send('Noch einmal versuchen.')).response,409,'canvas_agent_conversation_pending');
      if(name==='ack-error') {
        await wake();check(c.calls.length===1&&await debitCount()===0,'Contradictory HTTP202 cannot fabricate pending success, release funds or resubmit');
        return {case:name,providerCalls:1,charges:0};
      }
      await c.data(await f.request(f.projectPath+'/nodes','POST',{type:'note',title:'Manuelle Entscheidung',content:{text:'Diese Notiz bleibt erhalten.'},config:{}}));
      check(await projectRevision()>sourceRevision,'Manual Canvas editing remains independent while inference is uncertain');
      if(name==='historical') {
        await c.control('clear');await code((await c.send('Eine neue Idee.')).response,409,'canvas_agent_conversation_pending');
        await c.control('save',{draft:'Die gespeicherte Anfrage später prüfen.'});
        check(JSON.stringify(await attempt())===JSON.stringify(held),'Read, clear and draft actions cannot rewrite historical held billing evidence');
        await wake();check(c.calls.length===1&&await debitCount()===0,'Historical missing operation cannot authorize new inference or a charge');
        return {case:name,providerCalls:1,charges:0};
      }
      const accepted=await operation(),oldService=f.env.AI_LAB;
      f.env.AI_LAB={fetch(request){check(!new URL(request.url).pathname.endsWith('/prepare'),'An accepted old-policy receipt must not be prepared again');return oldService.fetch(request);}};
      await c.complete(reply);
      const recovered=await view();
      check(recovered.messages.at(-1).status==='completed'&&recovered.messages.at(-1).text===reply.text,'Reload reconciles late signed receipt and stored reply without a queue or paid POST');
      check((await operation()).context_json===accepted.context_json,'Accepted policy identity survives recovery');
      check(c.calls.length===1&&await debitCount()===1&&recovered.canSend===true&&!recovered.blockingOperation,'Duplicate callbacks settle once and remove only the resolved hold');
      check((await turn()).error_code===null&&(await run()).error_code===null&&recovered.messages.at(-1).delivery.code===null,'A completed recovered reply clears stale current failure projections');
      check((await get('SELECT COUNT(*) AS n FROM canvas_nodes WHERE project_id=?')).n===1,'Recovery preserves unrelated manual work');
      return {case:name,providerCalls:1,charges:1};
    }
    const pending=await view();
    check(pending.messages.at(-1).delivery.stage==='provider_pending'&&pending.canSend===false,'Accepted provider work is honestly pending');
    check(pending.allowance.chargedCredits===0&&pending.allowance.reservedCredits>0,'An accepted request is not a completed charge');
    if(name==='malformed'||name==='invalid-tail') {
      await c.complete({result:{id:'invalid-dialogue-output',object:'chat.completion',model:'grok-4.7',
        choices:[{finish_reason:'stop',message:{role:'assistant',content:'{"private_incomplete":'}}],usage:{prompt_tokens:120,completion_tokens:200,total_tokens:320}}});
      const invalid=await view();
      check(invalid.messages.at(-1).delivery.stage==='response_invalid'&&invalid.canSend===true&&!invalid.blockingOperation,'Received invalid output is not unknown provider acceptance');
      check(!invalid.messages.at(-1).text&&!invalid.brief.fields.story&&await debitCount()===1,'Malformed completed inference is charged once but never accepted as creative memory');
      if(name==='invalid-tail') {
        check((await turn()).state==='failed'&&(await run()).status==='blocked','GET closes the finalized rejected dialogue without a queue wake');
        await code((await c.send('Eine ausdrücklich neue Nachricht nach dem ungültigen Ergebnis.')).response,202);
        check(c.calls.length===1&&await debitCount()===1,'New-message admission cannot repeat the rejected inference or its charge');
        return {case:name,providerCalls:1,charges:1};
      }
      await view();await wake();check(c.calls.length===1&&await debitCount()===1,'Invalid output recovery cannot request replacement inference');
      return {case:name,providerCalls:1,charges:1};
    }
    if(name==='isolation') {
      const other=await canvasAgentConversationFixture(base,{scope:'chat-recovery-foreign'});
      try {await code(await other.f.request(c.route),404);}finally{other.restore();}
      const callback=new URL(call.body.options.webhookUrl),bad=callback.pathname.replace(/.$/,callback.pathname.endsWith('0')?'1':'0');
      await code(await f.request(bad,'POST',{}),403,'canvas_agent_callback_identity');
      await code(await f.request(callback.pathname,'POST',{id:call.id,state:'Completed',model:'unapproved/model'}),400,'canvas_agent_callback_invalid');
      check((await operation()).response_json===null,'Rejected callback cannot fabricate a result');
      const current=await view();
      await code((await c.start({body:{expectedConversationRevision:current.revision,expectedBriefRevision:current.briefRevision,
        expectedRevision:await projectRevision(),budgetCredits:3000,locale:'de',authorized:false}})).response,400,'canvas_agent_production_consent_required');
    }
    await c.complete(reply);
    if(name==='completed-tail') {
      const database=f.env.DB;let failures=0;
      f.env.DB=new Proxy(database,{get(target,key){
        if(key==='prepare')return sql=>{if(sql.startsWith('UPDATE canvas_agent_runs SET status=?,phase=?,error_code=?,cause_json=?,updated_at=?')){
          failures++;throw new Error('Synthetic interruption after committed transcript');}return target.prepare(sql);};
        const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
      }});
      try {await view();}finally{f.env.DB=database;}
      const saved=await turn(),unfinished=await run(),before=await get('SELECT revision,brief_revision FROM canvas_agent_conversations WHERE project_id=?');
      check(failures===1&&saved.state==='completed'&&saved.assistant_text===reply.text&&unfinished.status!=='completed','The real transcript commits before the controlled final run-write failure');
      const recovered=await view(),after=await get('SELECT revision,brief_revision FROM canvas_agent_conversations WHERE project_id=?');
      check((await run()).status==='completed'&&recovered.canSend&&JSON.stringify(after)===JSON.stringify(before),'GET closes only the terminal run tail without applying creative memory twice');
      await code((await c.send('Eine ausdrücklich neue Nachricht nach der gespeicherten Antwort.')).response,202);
      check(c.calls.length===1&&await debitCount()===1,'The unlocked composer admits a new turn without repeating old inference or billing');
      return {case:name,providerCalls:1,charges:1};
    }
    if(name==='failed-projection'||name==='expired-projection') {
      const {reconcileCanvasAgentModelOperations}=await import('../../workers/auth/src/lib/canvas-agent-model-operations.js');
      await f.atClock(()=>reconcileCanvasAgentModelOperations(f.env,{runId:originalTurn.run_id}));
      const receipt=await operation();
      check(receipt.state==='completed'&&await debitCount()===1&&!(await turn()).assistant_text,'Historical fixture starts from an actual settled receipt before transcript projection');
      await f.db.prepare("UPDATE canvas_agent_turns SET state='failed',error_code='canvas_agent_execution_review_required' WHERE id=?").bind(originalTurn.id).run();
      await f.db.prepare("UPDATE canvas_agent_runs SET status='blocked',error_code='canvas_agent_execution_review_required',lease_token=NULL,lease_until=NULL WHERE id=?").bind(originalTurn.run_id).run();
      check((await turn()).state==='failed','The older failed projection is genuinely reproduced');
      if(name==='expired-projection') {
        const expiry='2000-01-01T00:00:00.000Z';
        await f.db.prepare("UPDATE canvas_agent_runs SET status='completed',expires_at=? WHERE id=?").bind(expiry,originalTurn.run_id).run();
        const before=await get('SELECT revision,brief_revision FROM canvas_agent_conversations WHERE project_id=?');
        // Bypass the fixture's request serialization deliberately, while keeping
        // its one stable clock around genuinely concurrent authenticated GETs.
        const observed=await f.atClock(()=>Promise.all([0,1,2].map(async index=>{
          const waits=[];
          const response=await worker.fetch(new Request('https://bitbi.ai'+c.route,{headers:{Origin:'https://bitbi.ai',
            Cookie:`__Host-bitbi_session=${f.owner}`,'CF-Connecting-IP':`192.0.2.${220+index}`}}),f.env,{waitUntil(promise){waits.push(promise);}});
          await Promise.all(waits);return code(response,200);
        })));
        check(observed.every(result=>result.ok),'Every concurrent receipt observation succeeds');
        const projected=await turn(),after=await get('SELECT revision,brief_revision FROM canvas_agent_conversations WHERE project_id=?');
        check(projected.state==='completed'&&projected.assistant_text===reply.text,'Expired historical completion remains readable without restoring execution authority');
        check(after.revision===before.revision+1&&after.brief_revision===before.brief_revision+1,'Concurrent observations apply the original brief projection once');
        check((await run()).expires_at===expiry&&c.calls.length===1&&await debitCount()===1,'Read recovery neither extends authority nor repeats inference or billing');
        check((await operation()).receipt_json===receipt.receipt_json,'Historical accepted receipt is immutable');
      }
    }
    if(name==='normalization') {
      const live=f.env.AI_LAB;let failures=0;
      f.env.AI_LAB={fetch(request){
        if(new URL(request.url).pathname.endsWith('/normalize')){failures++;return Response.json({ok:false,code:'synthetic_normalization_unavailable',outcome:'not_submitted'},{status:503});}
        return live.fetch(request);
      }};
      const waiting=await view(),stored=(await operation()).response_json;
      check(failures===1&&stored&&waiting.messages.at(-1).delivery.stage==='receipt_pending'&&!waiting.canSend,'An already received response waits for normalization, not another inference');
      check(await debitCount()===0&&waiting.allowance.reservedCredits>0,'Transient normalization outage preserves the original unsettled reservation');
      f.env.AI_LAB=live;f.advance(61000);
    }
    if(name==='storage') {
      const database=f.env.DB;let failures=0;
      f.env.DB=new Proxy(database,{get(target,key){
        if(key==='prepare')return sql=>{if(sql.startsWith("UPDATE canvas_agent_turns SET state='completed'")){failures++;throw new Error('Synthetic dialogue storage interruption');}return target.prepare(sql);};
        const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
      }});
      try {await wake();}finally{f.env.DB=database;}
      check(failures>0&&(await operation()).response_json&&await debitCount()===1,'Storage fault occurs after a real received and settled response');
      check(!(await turn()).assistant_text,'The fault genuinely prevents conversation storage');
    }
    const completed=await view();
    check(completed.messages.at(-1).status==='completed'&&completed.messages.at(-1).text===reply.text,'GET observation delivers the validated saved reply in the original conversation');
    check(completed.brief.fields.story.sourceMessageId===originalTurn.id&&completed.brief.fields.audio.value==='Hintergrundmusik','Project memory retains source provenance and requested music');
    check(completed.brief.duration.targetDurationSeconds===45&&!completed.brief.openQuestions.some(q=>/dauer|wie lang|duration/i.test(q)),'Known duration is not asked again');
    check(completed.allowance.chargedCredits>0&&completed.allowance.committedCredits===completed.allowance.chargedCredits&&completed.allowance.reservedCredits===0,'Finalized costs and refundable reservations are projected distinctly');
    check(await projectRevision()===sourceRevision&&(await get('SELECT COUNT(*) AS n FROM canvas_nodes WHERE project_id=?')).n===0,'Conversation alone neither authorizes production nor mutates the graph');
    await code(await c.post('/messages',sent.input,sent.key),200);await c.complete(reply);await view();
    check(c.calls.length===1&&await debitCount()===1,'Reload, duplicate send and duplicate completion retain one paid identity');
    check(serviceCalls.includes('/internal/ai/canvas-agent/prepare')&&serviceCalls.includes('/internal/ai/canvas-agent/normalize'),'Both actual signed AI boundaries executed');
    const diagnostic=JSON.stringify(completed.messages.at(-1).delivery||{});
    check(!diagnostic.includes(CANVAS_SNAIL_BRIEF)&&!diagnostic.includes('webhook')&&!diagnostic.includes('Bearer'),'Display diagnostics contain no private text or callback capability');
    return {case:name,providerCalls:1,charges:1};
  }finally{c.restore();}
}
