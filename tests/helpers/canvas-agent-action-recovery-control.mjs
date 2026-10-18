import {canvasAgentConversationFixture} from './canvas-agent-conversation-control.mjs';
import {prepareCanvasAgentActionStatements,executeCanvasAgentActions} from '../../workers/auth/src/lib/canvas-agent-actions.js';
import {getModelTariff} from '../../workers/auth/src/lib/model-tariffs.js';
const check=(value,message)=>{if(!value)throw new Error(message);};
export const CANVAS_ACTION_RECOVERY_CASES=['late-stop','confirmation-replay','claim-race','dependent-failure','immediate-scope','immediate-duration-current'];
export async function canvasActionRecoveryCase(base,name){
 const c=await canvasAgentConversationFixture(base,{scope:'action-recovery-'+name}),f=c.f;
 const revision=async()=>(await f.db.prepare('SELECT revision FROM canvas_projects WHERE id=?').bind(f.project).first()).revision;
 const action=async(type,extra={})=>({type,targetId:null,value:null,number:null,secondaryNumber:null,ids:[],revision:await revision(),...extra});
 const expectResponse=async(response,status)=>{const data=await response.json();check(response.status===status,`Expected ${status}, received ${response.status}/${data.code}`);return data.data;};
 const perform=async(actions)=>{
  await c.data((await c.send('A 45 second film of bees in a factory. Apply the requested current-project change.')).response);
  await c.deliver();await c.complete({text:'I requested the change.',actions});await c.deliver();return (await c.read()).actions;
 };
 try{
  await c.approve(2000);
  if(name==='late-stop'){
   await c.exchange('A 45 second film about bees in a factory.',{fields:{story:'Bees in a factory'}});
   const node=(await f.data(await f.request(f.projectPath+'/nodes','POST',{type:'note',content:{text:'manual decision'}}))).node;
   const started=await expectResponse(await f.request(f.projectPath+'/agent','POST',{brief:'A 45 second film about bees.',targetDurationSeconds:45,expectedRevision:await revision(),budgetCredits:5000,locale:'en'},
    {'Idempotency-Key':'recovery-stop-production-start','X-Bitbi-Tariff-Revision':String((await getModelTariff(f.env)).revision)}),202);
   const actions=[await action('production_resume'),await action('node_prompt',{targetId:node.id,value:'late model overwrite'})];
   await c.data((await c.send('Please consider resuming the saved production and updating this note.')).response);await c.deliver();
   const original=JSON.parse(c.calls.at(-1).body.input.messages[1].content).currentProject.lastControlId;
   check(/^[a-f0-9]{32}$/.test(original),'Accepted dialogue binds the actual stop-control snapshot');
   await expectResponse(await f.request(f.projectPath+`/agent/${started.run.id}/control`,'POST',{action:'pause'},{'Idempotency-Key':'recovery-manual-stop'}),200);
   await c.complete({actions});await c.deliver();
   const view=await c.read();check(view.actions.length===2&&view.actions.every(row=>row.state==='failed'),'Late reply cannot stage runnable actions after manual stop');
   check((await f.db.prepare('SELECT status FROM canvas_agent_runs WHERE id=?').bind(started.run.id).first()).status==='paused','A late resume proposal cannot undo the stop');
   check(JSON.parse((await f.db.prepare('SELECT content_json FROM canvas_nodes WHERE id=?').bind(node.id).first()).content_json).text==='manual decision','Late dependent graph mutation stays unapplied');
  }else if(name==='confirmation-replay'){
   const rows=await perform([await action('allowance_propose',{number:2500})]),proposal=rows.at(-1),{kind,nodeId,...decision}=proposal.confirmation;
   void kind;void nodeId;
   const body={decision:'accept',...decision};
   await expectResponse(await c.post(`/actions/${proposal.id}/confirm`,body),200);
   await expectResponse(await c.post(`/actions/${proposal.id}/confirm`,body),200);
   const altered=await c.post(`/actions/${proposal.id}/confirm`,{...body,capCredits:9000});
   const failed=await altered.json();check(altered.status===409&&failed.code==='idempotency_conflict','Completed monetary receipt rejects changed consent replay');
   check((await c.read()).allowance.capCredits===2500,'Replayed or forged acceptance never expands approved allowance');
  }else if(name==='claim-race'){
   await c.exchange('A 45 second film of bees in a factory.',{fields:{story:'Bees in a factory'}});
   const turn=await f.db.prepare("SELECT id FROM canvas_agent_turns WHERE project_id=? AND state='completed' ORDER BY rowid DESC LIMIT 1").bind(f.project).first();
   await c.control('save');
   const conversation=await f.db.prepare('SELECT revision FROM canvas_agent_conversations WHERE project_id=?').bind(f.project).first();
   const actions=[await action('brief_resume')];
   await f.db.batch(await prepareCanvasAgentActionStatements(f.env,{userId:f.owner,projectId:f.project,turnId:turn.id,actions,expectedRevision:await revision(),locale:'en'}));
   const row=await f.db.prepare('SELECT * FROM canvas_agent_action_receipts WHERE turn_id=?').bind(turn.id).first();
   const prepared={expectedRevision:await revision(),expectedBriefRevision:1,locale:'en',body:{action:'resume',expectedConversationRevision:conversation.revision,locale:'en'}};
   await f.db.prepare("UPDATE canvas_agent_action_receipts SET state='executing',result_json=?,updated_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(JSON.stringify({prepared,claimToken:'interrupted-original-claim'}),row.id).run();
   await Promise.all([0,1,2].map(()=>executeCanvasAgentActions(f.env,{userId:f.owner,projectId:f.project,turnId:turn.id})));
   const after=await f.db.prepare('SELECT revision,state FROM canvas_agent_conversations WHERE project_id=?').bind(f.project).first();
   check(after.state==='active'&&after.revision===conversation.revision+1,'Concurrent recovery commits exactly one ordinary resume mutation');
   check((await f.db.prepare('SELECT COUNT(*) AS n FROM canvas_agent_conversation_actions WHERE project_id=? AND request_key=?').bind(f.project,`canvas_action_${row.id}`).first()).n===1,'Recovered mutation retains the original action identity');
   check((await f.db.prepare('SELECT state FROM canvas_agent_action_receipts WHERE id=?').bind(row.id).first()).state==='completed','Recovery reaches a terminal truthful receipt');
  }else if(name==='dependent-failure'){
   const before=(await c.read()).allowance.capCredits;
   const rows=await perform([await action('node_prompt',{targetId:'f'.repeat(32),value:'missing target'}),await action('allowance_propose',{number:5000})]);
   check(rows.length===2&&rows.every(row=>row.state==='failed')&&rows[1].code==='canvas_agent_action_dependency_failed','Failed first action closes dependent proposals instead of stranding cron or UI');
   check((await c.read()).allowance.capCredits===before,'Failed dependency cannot grant later requested spending');
  }else if(name==='immediate-scope'){
   const request=async(text,key)=>{const view=await c.read();return c.post('/immediate',{text,locale:'en',delegateCreative:true,expectedConversationRevision:view.revision,expectedBriefRevision:view.briefRevision,expectedRevision:await revision()},key);};
   const immediate=async(text,key)=>(await expectResponse(await request(text,key),202)).conversation.immediateIntent;
   const cancel=async intent=>expectResponse(await c.post('/immediate/control',{intentId:intent.id,intentRevision:intent.revision,action:'cancel'}),200);
   await expectResponse(await request('Make the film now, no more questions.','scope-control-without-idea'),400);
   const initial='A 45 second film about bees in a factory. Preserve the blue uniforms and the northern entrance.';
   await c.exchange(initial,{fields:{story:'Bees in a factory',mustHaves:'Blue uniforms and the northern entrance'}});
   const correction='Change the factory exterior to a moonlit forest, retaining the bees and blue uniforms. '+ 'Keep the lanterns visible. '.repeat(42)+'A red bicycle must appear in the final shot.';
   check(correction.length>1000,'Independent long-instruction control exercises visible summary bounds');
   const first=await immediate(correction,'scope-new-correction'),view=await c.read();
   check(view.brief.fields.story.value==='Bees in a factory'&&view.brief.fields.mustHaves.value==='Blue uniforms and the northern entrance','An immediate correction preserves earlier creative requirements');
   check(view.brief.fields.latestInstruction.sourceMessageId===first.id&&view.brief.fields.latestInstruction.value.startsWith('Change the factory exterior')&&view.brief.fields.latestInstruction.value.length===1000&&view.brief.fields.latestInstruction.value.endsWith('[shortened; full instruction in conversation]'),'Current brief records the real correction with its source and honest bounded summary');
   check(first.quote.scope.brief.includes(initial)&&first.quote.scope.brief.includes(correction),'The priced scope keeps both complete original wording and the full latest correction');
   await cancel(first);
   const second=await immediate('','scope-reopen-empty'),stored=await f.db.prepare('SELECT source_turn_id,scope_json FROM canvas_agent_start_intents WHERE id=?').bind(second.id).first();
   check(stored.source_turn_id===first.id,'The latest saved creative source includes the genuine immediate turn even without a paid run');
   const instructions=JSON.parse(stored.scope_json).creativeInstructions;
   check(instructions.at(-1).sourceMessageId===first.id&&instructions.at(-1).text===correction&&second.quote.scope.brief.includes(initial)&&second.quote.scope.brief.includes(correction),'Empty restart retains B as latest while preserving A as earlier requirements');
   await cancel(second);
   const third=await immediate('Mach mir den Film jetzt, keine weiteren Fragen.','scope-control-existing-idea');
   const after=await c.read();
   check(after.brief.fields.story.value==='Bees in a factory'&&after.brief.fields.latestInstruction.sourceMessageId===first.id&&!third.quote.scope.brief.includes('Mach mir den Film jetzt'),'A pure start command never becomes the story or supersedes the creative correction');
   check((await f.db.prepare("SELECT COUNT(*) AS n FROM canvas_agent_runs WHERE project_id=? AND purpose='production' AND id!=?").bind(f.project,f.runId).first()).n===0,'Saving or restoring scope does not authorize media production');
  }else if(name==='immediate-duration-current'){
   await c.exchange('A 45 second film about bees in a factory.',{fields:{story:'Bees in a factory'}});
   const immediate=async key=>{const view=await c.read();return (await expectResponse(await c.post('/immediate',{text:'',locale:'en',delegateCreative:true,expectedConversationRevision:view.revision,expectedBriefRevision:view.briefRevision,expectedRevision:await revision()},key),202)).conversation.immediateIntent;};
   const first=await immediate('duration-original');
   check(first.quote.scope.targetDurationSeconds===45&&first.quote.scope.durationChoice==='explicit','Known positive: the original explicit 45-second choice reaches the first real quote');
   await expectResponse(await c.post('/immediate/control',{intentId:first.id,intentRevision:first.revision,action:'cancel'}),200);
   await c.control('delegate_duration');
   const selected=(await c.read()).brief.duration;
   check(selected.choice==='delegated'&&selected.targetDurationSeconds===null,'The ordinary control explicitly replaces the old numeric duration');
   const next=await immediate('duration-current-choice'),after=(await c.read()).brief.duration;
   check(next.quote.scope.durationChoice==='delegated'&&next.quote.scope.targetDurationSeconds===null,'An empty restart respects the current deliberate duration delegation instead of reparsing the older 45-second source');
   check(after.choice==='delegated'&&after.targetDurationSeconds===null&&after.sourceMessageId===selected.sourceMessageId,'Current duration provenance remains bound to the real later control');
   check((await f.db.prepare("SELECT COUNT(*) AS n FROM canvas_agent_runs WHERE project_id=? AND purpose='production' AND id!=?").bind(f.project,f.runId).first()).n===0,'Requoting a delegated duration does not authorize media production');
  }else throw new Error('Unknown action recovery case');
  check(c.calls.length===(name==='late-stop'?2:1),'Action recovery never repeats an accepted paid dialogue');
  return {case:name,providerCalls:c.calls.length};
 }finally{c.restore();}
}
