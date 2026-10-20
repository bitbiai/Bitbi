import { canvasAgentConversationFixture } from './canvas-agent-conversation-control.mjs';
import { appendCanvasAgentEvent } from '../../workers/auth/src/lib/canvas-agent-progress.js';
import { syncCanvasProjectIncidents,canvasIncidentContext,canvasIncidentExplanation } from '../../workers/auth/src/lib/canvas-agent-incidents.js';
import { recordCanvasClientNotification,listCanvasNotifications,readCanvasNotifications } from '../../workers/auth/src/lib/canvas-notifications.js';

const check=(value,message)=>{if(!value)throw new Error(message);};
const iso=()=>new Date().toISOString();
export const CANVAS_INCIDENT_CASES=['fallback','manual','model','fable','unknown','resolved','revoked','isolation','deleted'];
export async function canvasIncidentCase(base,name){
  const c=await canvasAgentConversationFixture(base,{scope:'incident-'+name,locale:'de'}),f=c.f,db=f.db;
  await db.prepare("UPDATE canvas_projects SET locale='de' WHERE id=?").bind(f.project).run();
  const before=await c.read();
  const project=await db.prepare('SELECT revision,assembly_json FROM canvas_projects WHERE id=?').bind(f.project).first();
  const source=await db.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(f.runId).first();
  const body={phase:'planning',code:'canvas_agent_plan_invalid',tool:'production.reconcile'};
  const error=async()=>{
    await db.prepare("UPDATE canvas_agent_runs SET status='blocked',error_code='canvas_agent_plan_invalid',cause_json=? WHERE id=?")
      .bind(JSON.stringify({diagnostic:{version:1,category:'semantic',path:'plan.assembly.clips[2].transition',reason:'terminal_transition'}}),source.id).run();
    await appendCanvasAgentEvent(f.env,{...source,status:'blocked'},'incident-initial','error',body);
  };
  const incidents=async()=> (await db.prepare('SELECT * FROM canvas_agent_incidents WHERE project_id=?').bind(f.project).all()).results;
  const explanations=async()=> (await db.prepare('SELECT x.* FROM canvas_agent_incident_explanations x JOIN canvas_agent_incidents i ON i.id=x.incident_id WHERE i.project_id=? ORDER BY x.revision').bind(f.project).all()).results;
  const count=async table=>(await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n;
  const originalCalls=f.calls.length,ledger=await count('member_credit_ledger');
  if(name==='fable'){
    await c.data(await c.post('/model',{modelId:'anthropic/claude-fable-5',expectedConversationRevision:before.revision,expectedModelRevision:before.reasoningModel.revision}));
    const oldFetch=f.env.__TEST_FETCH;
    f.env.__TEST_FETCH=async(url,init)=>{
      const body=init?.body?JSON.parse(init.body):null;if(body?.model!=='anthropic/claude-fable-5')return oldFetch(url,init);
      check(body.input.output_config.format.type==='json_schema'&&body.input.messages.length===1&&!body.input.tools,'Explanation uses the real native structured Fable adapter without admin tools');
      check(body.input.system.includes('Canvas')&&body.input.system.includes('explanation'),'Fable receives the canonical Canvas explanation role');
      const call={id:'synthetic-incident-fable-'+(c.calls.length+1),body};c.calls.push(call);
      return Response.json({success:true,result:{id:call.id,state:'Queued'}});
    };
  }
  if(['model','fable','unknown','resolved','revoked'].includes(name)){
    await c.data(await c.post('/allowance',{capCredits:3000,expectedConversationRevision:(await c.read()).revision,diagnostics:true}));
    check((await c.read()).allowance.diagnosticsAuthorized,'Diagnostic inference requires an explicit same-cap opt-in');
  }
  if(name==='manual'){
    const input={requestId:'manual-save-error-once',projectId:f.project,code:'canvas_request_failed',errorCode:'canvas_save_failed',status:503};
    const notice=await recordCanvasClientNotification(f.env,f.owner,input);
    await recordCanvasClientNotification(f.env,f.owner,input);
    check(notice.item.confirmed===false,'A browser failure remains unconfirmed');
  }else await error();
  await syncCanvasProjectIncidents(f.env,{projectId:f.project,userId:f.owner,allowInference:false});
  let records=await explanations();check(records.length===1,'One actual error produces exactly one persisted fallback before observation');
  const originalTurn=records[0].turn_id,initial=await c.read(),reply=initial.messages.find(item=>item.incidentId);
  check(reply?.kind==='incident_explanation'&&reply.provenance==='application','The fallback is explicitly application-authored');
  check(initial.briefRevision===before.briefRevision,'An explanation does not change the brief revision');
  check(JSON.stringify(await db.prepare('SELECT revision,assembly_json FROM canvas_projects WHERE id=?').bind(f.project).first())===JSON.stringify(project),'An explanation cannot pause or edit creative graph data');
  const notice=(await listCanvasNotifications(f.env,f.owner,{projectId:f.project})).items.find(item=>item.id===reply.sourceNotificationId);
  check(notice,'The explanation refers to the original canonical notification');
  if(name!=='manual')check(notice.details.validationDiagnostic?.reason==='terminal_transition'&&reply.text.includes('obwohl kein weiterer Clip folgt')&&!reply.text.includes('plan.assembly'),'The precise diagnostic stays in Notifications while chat explains the actual relationship naturally');
  await readCanvasNotifications(f.env,f.owner,{ids:[notice.id]});
  await syncCanvasProjectIncidents(f.env,{projectId:f.project,userId:f.owner});
  check((await explanations()).length===1,'Read markers and duplicate event observations cannot create another explanation');
  if(name==='fallback'||name==='manual'||name==='isolation'||name==='deleted'){
    check(c.calls.length===0&&f.calls.length===originalCalls&&await count('member_credit_ledger')===ledger,'No allowance means no inference, debit or production retry');
    check(initial.revision===before.revision,'Automatic explanation does not invalidate a pending conversation decision');
    if(name==='manual')check(reply.text.includes('kein Nachweis')&&!reply.text.includes('Produktion wartet'),'Lost transport does not invent a production stop');
    if(name==='fallback'){
      // More aliases than the collector batch must not starve an older,
      // genuinely different error. Bypass only the capture hook when seeding
      // the backlog, as after a worker interruption; call the real collector.
      const later=new Date(Date.now()+1000).toISOString();
      for(let index=0;index<12;index++)await db.prepare('INSERT INTO canvas_agent_events(run_id,event_key,type,payload_json,created_at) VALUES(?,?,\'error\',?,?)')
        .bind(source.id,`duplicate-backlog-${index}`,JSON.stringify(body),later).run();
      await recordCanvasClientNotification(f.env,f.owner,{requestId:'older-distinct-manual-error',projectId:f.project,code:'canvas_request_failed',errorCode:'canvas_save_failed',status:503});
      await syncCanvasProjectIncidents(f.env,{projectId:f.project,userId:f.owner,allowInference:false});
      check((await incidents()).length===2&&(await explanations()).length===2,'Coalesced retry aliases cannot starve a distinct manual incident behind a bounded source batch');
    }
    if(name==='isolation'){
      const other=await canvasAgentConversationFixture(base,{scope:'incident-foreign',locale:'en'});
      await syncCanvasProjectIncidents(other.f.env,{projectId:f.project,userId:other.f.owner,allowInference:false});
      check(!(await other.read()).messages.some(item=>item.incidentId),'A different owner/project cannot read or inherit this explanation');
      other.restore();
    }
    if(name==='deleted'){
      await db.prepare('UPDATE canvas_projects SET deleted_at=?,updated_at=? WHERE id=?').bind(iso(),iso(),f.project).run();
      await syncCanvasProjectIncidents(f.env,{projectId:f.project,userId:f.owner});
      check((await incidents()).length===0&&(await explanations()).length===0,'Project deletion redacts derived context and cannot resurrect the conversation');
      check((await db.prepare('SELECT state,assistant_text FROM canvas_agent_turns WHERE id=?').bind(originalTurn).first()).assistant_text===null,'Deleted conversation text remains redacted');
    }
  } else {
    if(name==='revoked'){
      const current=await c.read();await c.data(await c.post('/allowance',{capCredits:3000,expectedConversationRevision:current.revision,diagnostics:false}));
      await c.deliver();
      await syncCanvasProjectIncidents(f.env,{projectId:f.project,userId:f.owner});
      check(c.calls.length===0,'Revoking diagnostic consent before dispatch prevents the provider call');
    }else{
      if(name==='unknown'){
        const fetch=f.env.__TEST_FETCH;f.env.__TEST_FETCH=async(...args)=>{const result=await fetch(...args);if(c.calls.length)throw new TypeError('Synthetic acknowledgement lost after acceptance');return result;};
      }
      await c.deliver();check(c.calls.length===1,'One admitted explanation uses the selected real adapter once');
      if(name==='unknown'){
        // A crash may leave the UI turn pending after the operation is already
        // unknown. Observation must retain the original unresolved fence while
        // immediately showing its fallback, even without another capture hook.
        const pending=await explanations(),modelRun=pending[0].model_run_id;
        await db.prepare("UPDATE canvas_agent_turns SET state='pending' WHERE id=?").bind(originalTurn).run();
        await db.prepare("UPDATE canvas_agent_incident_explanations SET state='pending' WHERE turn_id=?").bind(originalTurn).run();
        const unseen=await c.read();
        check(!unseen.canSend&&unseen.blockingOperation?.stage==='dispatch_unknown','Fallback display cannot hide an unknown accepted provider operation');
        check((await db.prepare('SELECT state FROM canvas_agent_turns WHERE id=?').bind(originalTurn).first()).state==='review_required','An unsettled unknown explanation remains review-required');
        const denied=await c.send('Eine neue Frage zum Film');
        check(denied.response.status===409&&(await denied.response.json()).code==='canvas_agent_conversation_pending','A second paid turn is denied while the original explanatory outcome remains unknown');
        check((await explanations())[0].model_run_id===modelRun,'The observer preserves the original operation identity');
        await syncCanvasProjectIncidents(f.env,{projectId:f.project,userId:f.owner});
        await syncCanvasProjectIncidents(f.env,{projectId:f.project,userId:f.owner});
        check(c.calls.length===1&&(await explanations()).length===1,'Unknown explanatory acceptance never recursively explains or dispatches a second call');
        check((await c.read()).messages.find(item=>item.incidentId).provenance==='application','Unknown model outcome retains an honest system explanation');
      }else{
        if(name==='resolved'){
          await db.prepare("UPDATE canvas_agent_runs SET status='planning',error_code=NULL,lease_token='incident-recovery',lease_until=?,next_attempt_at=? WHERE id=?")
            .bind(new Date(Date.now()+600000).toISOString(),iso(),source.id).run();
          const incident=(await incidents())[0],recovering=await canvasIncidentContext(f.env,f.owner,f.project,JSON.parse(incident.source_json));
          check(recovering.state==='recovering'&&!canvasIncidentExplanation(recovering).includes('inzwischen überwunden'),'Clearing an error and queueing recovery is not substantive progress');
          await syncCanvasProjectIncidents(f.env,{projectId:f.project,userId:f.owner,allowInference:false});
          await db.prepare("UPDATE canvas_agent_runs SET status='blocked',error_code='canvas_agent_plan_invalid' WHERE id=?").bind(source.id).run();
          await syncCanvasProjectIncidents(f.env,{projectId:f.project,userId:f.owner,allowInference:false});
          await db.prepare("UPDATE canvas_agent_runs SET status='planning',error_code=NULL WHERE id=?").bind(source.id).run();
          await syncCanvasProjectIncidents(f.env,{projectId:f.project,userId:f.owner,allowInference:false});
          check((await incidents())[0].revision===1&&(await explanations()).length===1,'Transient recovery cycles cannot exhaust the final recovery message or admit repeated explanatory inference');
          const [{freshCanvasAgentPlan},{canvasAgentProject},{canvasAgentCapabilities},{prepareCanvasAgentGraph},{persistCanvasAgentProposal,markCanvasAgentProposal}]=await Promise.all([
            import('./canvas-agent-control.mjs'),import('../../workers/auth/src/routes/canvas-agent.js'),import('../../workers/auth/src/lib/canvas-agent-capabilities.js'),
            import('../../workers/auth/src/lib/canvas-agent-graph.js'),import('../../workers/auth/src/lib/canvas-agent-progress.js')]);
          const run=await db.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(source.id).first(),step=await db.prepare("SELECT * FROM canvas_agent_steps WHERE run_id=? AND kind='plan'").bind(source.id).first(),plan=freshCanvasAgentPlan();
          await persistCanvasAgentProposal(f.env,run,step,plan);
          await prepareCanvasAgentGraph(f.env,run,await canvasAgentProject(f.env,f.owner,f.project),await canvasAgentCapabilities(f.env),plan);
          await markCanvasAgentProposal(f.env,step.id,'applied',{issues:[]});
          check((await canvasIncidentContext(f.env,f.owner,f.project,JSON.parse(incident.source_json))).progress?.kind==='plan_applied','Only the applied editable graph proves the planning blockage is overcome');
        }
        const text='Der gespeicherte Plan braucht eine Korrektur; die ursprüngliche Antwort ist erhalten.';
        if(name==='fable'){
          const call=c.calls.at(-1),body={id:call.id,state:'Completed',provider:'anthropic',model:'anthropic/claude-fable-5',result:{
            id:call.id+'-result',type:'message',role:'assistant',model:'claude-fable-5',stop_reason:'end_turn',
            content:[{type:'text',text:JSON.stringify({text,scope:'canvas',intent:'status',updates:[],actions:[],questions:[]})}],usage:{input_tokens:160,output_tokens:200}}};
          check((await f.request(call.body.options.webhookUrl,'POST',body)).ok,'Native Fable explanatory callback is accepted');
          check((await f.request(call.body.options.webhookUrl,'POST',body)).ok,'Duplicate native explanation callback keeps its accepted identity');
        }else await c.complete({intent:'status',text});
        await syncCanvasProjectIncidents(f.env,{projectId:f.project,userId:f.owner,allowInference:false});
        const current=await c.read(),messages=current.messages.filter(item=>item.incidentId);
        if(name==='resolved'){
          check(messages.filter(item=>item.text.includes('inzwischen überwunden')).length===1&&!messages.some(item=>item.provenance==='model'),'A resolved-before-delivery incident rejects a stale model stoppage and publishes exactly one current recovery update');
          const prior=await db.prepare('SELECT r.status,s.status AS step_status FROM canvas_agent_runs r JOIN canvas_agent_steps s ON s.run_id=r.id WHERE r.id=?').bind(records[0].model_run_id).first();
          check(prior.status==='completed'&&prior.step_status==='completed','A stale explanatory answer is still settled and closes its original informational run');
        }
        else{
          check(messages.length===1&&messages[0].id===`${originalTurn}:reply`&&messages[0].provenance==='model','The paid reply updates the same persisted fallback message with correct model provenance');
          check(messages[0].modelId===(name==='fable'?'anthropic/claude-fable-5':'xai/grok-4.7')&&messages[0].text.includes('ursprüngliche Antwort'),'Accepted selected-model text is preserved without generic action substitution');
          const afterLedger=await count('member_credit_ledger');await syncCanvasProjectIncidents(f.env,{projectId:f.project,userId:f.owner});
          check(c.calls.length===1&&await count('member_credit_ledger')===afterLedger,'Duplicate receipt/projection cannot duplicate inference or debit');
        }
      }
    }
  }
  // Independent text control: unknown dispatch must never inherit the known
  // completed-but-invalid explanation solely because the error label matches.
  const incident=(await incidents())[0];
  if(incident){const context=await canvasIncidentContext(f.env,f.owner,f.project,JSON.parse(incident.source_json));
    context.operation={responseStored:false,valid:null,outcome:'unknown'};
    check(!canvasIncidentExplanation(context).includes('ihr Ausgang ist bekannt'),'Absent completed evidence never becomes known dispatch');}
  c.restore();return {case:name,explanations:(await explanations()).length,providerCalls:c.calls.length};
}
