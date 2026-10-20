import { canvasAgentConversationFixture } from './canvas-agent-conversation-control.mjs';
import { isCanvasAgentProviderEndpoint, freshCanvasAgentPlan } from './canvas-agent-control.mjs';
import { CANVAS_FABLE_MODEL } from '../../js/shared/canvas-assistant-models.mjs';
import worker from '../../workers/auth/src/index.js';

const check=(value,message)=>{if(!value)throw new Error(message);};
export async function canvasAssistantProductionCase(env) {
  const c=await canvasAgentConversationFixture(env,{scope:'assistant-production'}),f=c.f,calls=[];
  f.env.__TEST_FETCH=async(url,init)=>{
    check(isCanvasAgentProviderEndpoint(url,f.env.CLOUDFLARE_ACCOUNT_ID),'Production uses the owned background route only');
    const body=JSON.parse(init.body);
    check(body.model===CANVAS_FABLE_MODEL&&body.options.background===true,'Selected production and its correction never fall back to Grok');
    check(body.input.output_config.format.type==='json_schema'&&body.input.messages.length===1,'Production keeps native structured Messages');
    const call={id:'synthetic-fable-production-'+(calls.length+1),body};calls.push(call);
    return Response.json({success:true,result:{id:call.id,state:'Queued'}});
  };
  const select=async(modelId,key)=>{const row=await c.read();return c.post('/model',{
    modelId,expectedConversationRevision:row.revision,expectedModelRevision:row.reasoningModel.revision},key);};
  try {
    const row=await c.read();
    check((await c.post('/model',{expectedConversationRevision:row.revision,expectedModelRevision:0},'missing-model-choice')).status===400,'Missing selection is never a silent default');
    await c.data(await select(CANVAS_FABLE_MODEL,'production-select-fable'));
    const started=await f.data(await f.request(f.route,'POST',{brief:'Three scenes of a house built beside a duck pool, then visitors celebrate. Choose a suitable duration.',
      durationChoice:'delegated',expectedRevision:0,budgetCredits:10000,locale:'en'},{'Idempotency-Key':'selected-fable-production'}));
    const runId=started.run.id;
    const deliver=async()=>{
      const due=await f.db.prepare('SELECT next_attempt_at FROM canvas_agent_runs WHERE id=?').bind(runId).first(),now=await f.atClock(()=>Date.now());
      f.advance(Math.max(0,(Date.parse(due.next_attempt_at)||now)-now));
      await f.atClock(async()=>{let acks=0;await worker.queue({queue:'bitbi-ai-video-jobs',messages:[{
        body:{type:'canvas_agent.process',run_id:runId},attempts:1,ack(){acks++;},retry(){throw new Error('No replacement inference retry');}}]},f.env,
        {waitUntil(){throw new Error('Production does not need browser-owned background work');}});check(acks===1,'One durable delivery is acknowledged');});
      return f.db.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(runId).first();
    };
    const complete=async(plan)=>{
      const call=calls.at(-1),body={id:call.id,state:'Completed',provider:'anthropic',model:CANVAS_FABLE_MODEL,result:{
        id:call.id+'-result',type:'message',role:'assistant',model:'claude-fable-5',stop_reason:'end_turn',
        content:[{type:'text',text:JSON.stringify(plan)}],usage:{input_tokens:160,output_tokens:200}}};
      check((await f.request(call.body.options.webhookUrl,'POST',{...body,result:{...body.result,error:{code:'contradictory'}}})).status===400,
        'A contradictory completed/error envelope cannot become a successful receipt');
      check((await f.request(call.body.options.webhookUrl,'POST',body)).ok,'Native production callback is retained');
      check((await f.request(call.body.options.webhookUrl,'POST',body)).ok,'Repeated native callback is idempotent');
    };
    await deliver();check(calls.length===1,'One original production planning call');
    const original=(await f.db.prepare('SELECT * FROM canvas_agent_model_operations WHERE run_id=?').bind(runId).all()).results[0];
    const initialInput=JSON.parse(calls[0].body.input.messages[0].content);
    check(initialInput.durationMode==='creative'&&initialInput.budget.capCredits===10000,'Native planner receives original explicit delegation and budget');
    await c.data(await select('xai/grok-4.7','production-select-grok'));
    const invalid=freshCanvasAgentPlan(),image=key=>({key,type:'image_generation',title:'Reference',modelId:'openai/gpt-image-2',prompt:'The same red house beside a duck pool.',config:{},dependencies:[]});
    invalid.nodes=[image('first'),image('reference'),{...invalid.nodes[0],key:'shot',config:{duration:4,resolution:'768P',aspectRatio:'16:9'},
      dependencies:[{key:'first',role:'first_frame'},{key:'reference',role:'reference_image'}]}];
    invalid.assembly={...invalid.assembly,targetDurationSeconds:4,clips:[{key:'shot',trim:{start:0,duration:4},transition:{preset:'none'}}]};
    await complete(invalid);await deliver();
    const repair=await f.db.prepare("SELECT * FROM canvas_agent_steps WHERE run_id=? AND step_key='preflight_repair_1'").bind(runId).first();
    check(repair,'Invalid reference combination creates a bounded correction before applying any nodes');
    const repairInput=JSON.parse(repair.input_json);
    check(repairInput.modelId===CANVAS_FABLE_MODEL&&repairInput.payload.model===CANVAS_FABLE_MODEL
      &&repairInput.payload.repair.issues.some(issue=>issue.code==='canvas_agent_h3_reference_modes_mixed'),'Correction inherits accepted model and exact preflight feedback');
    check((await f.db.prepare('SELECT COUNT(*) AS n FROM canvas_nodes WHERE project_id=?').bind(f.project).first()).n===0,'Invalid proposal cannot mutate the editable graph');
    await deliver();check(calls.length===2,'Only the separately authorized bounded correction is dispatched');
    await complete(freshCanvasAgentPlan());const completed=await deliver();
    const nodes=(await f.db.prepare('SELECT * FROM canvas_nodes WHERE project_id=? AND deleted_at IS NULL').bind(f.project).all()).results;
    const assembly=JSON.parse((await f.db.prepare('SELECT assembly_json FROM canvas_projects WHERE id=?').bind(f.project).first()).assembly_json);
    check(completed.status==='running'&&nodes.length===4&&assembly.clips.length===3,
      'Corrected native Fable plan applies ordinary editable nodes and assembly: '+JSON.stringify({status:completed.status,code:completed.error_code,nodes:nodes.length,clips:assembly?.clips?.length}));
    const videos=nodes.filter(node=>node.type==='video_generation');
    check(videos.length===3&&videos.every(node=>node.model_id==='minimax/h3'&&JSON.parse(node.config_json).prompt)
      &&nodes.some(node=>node.type==='note'&&JSON.parse(node.content_json).text===freshCanvasAgentPlan().continuity),
      'Three editable media prompts and the ordinary continuity note remain independent of the assistant');
    const evaluation=await f.db.prepare("SELECT input_json,allocation_credits FROM canvas_agent_steps WHERE run_id=? AND kind='evaluate'").bind(runId).first();
    check(evaluation&&evaluation.allocation_credits===0&&JSON.parse(evaluation.input_json).reason==='model_visual_review_unavailable','Unverified Fable vision is explicitly technical-only without a paid review');
    const operations=(await f.db.prepare('SELECT * FROM canvas_agent_model_operations WHERE run_id=? ORDER BY rowid').bind(runId).all()).results;
    check(operations.length===2&&operations[0].id===original.id&&operations.every(op=>op.model===CANVAS_FABLE_MODEL&&op.state==='completed'),'Original production identities and selected model persist through correction');
    check((await f.db.prepare('SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=? AND amount<0').bind(f.owner).first()).n===2,'Planning and correction each settle once');
    check((await c.read()).reasoningModel.modelId==='xai/grok-4.7'&&completed.model_id===CANVAS_FABLE_MODEL,'Later header selection does not rewrite the authorized production');
    check(calls.length===2&&c.calls.length===0,'No extra inference or media generation was needed to prove graph application');
    return {providerCalls:2,corrections:1,nodes:4,assemblyClips:3,technicalOnly:true,acceptedModelPinned:true};
  }finally{c.restore();}
}

export async function canvasAssistantModelSwitchCase(env) {
  const c=await canvasAgentConversationFixture(env,{scope:'assistant-model-switch'}),f=c.f,groks=f.env.__TEST_FETCH,fableCalls=[];
  f.env.__TEST_FETCH=async(url,init)=>{
    const body=isCanvasAgentProviderEndpoint(url,f.env.CLOUDFLARE_ACCOUNT_ID)&&init?.body?JSON.parse(init.body):null;
    if(body?.model!==CANVAS_FABLE_MODEL)return groks(url,init);
    const headers=new Headers(init.headers);
    check(body.options.background===true&&headers.get('cf-aig-max-attempts')==='1'&&headers.get('cf-aig-collect-log-payload')==='false','Fable retains private single-dispatch background transport');
    check(body.input.messages.length===1&&body.input.messages[0].role==='user'&&body.input.output_config.format.type==='json_schema','Native Fable has a real structured contract');
    check(!body.input.tools&&!body.input.cache_control&&!body.input.prompt_cache_key&&!body.input.user,'Canvas receives no private Admin tools or cross-provider replay');
    const call={id:'synthetic-fable-switch-'+(fableCalls.length+1),body};fableCalls.push(call);
    return Response.json({success:true,result:{id:call.id,state:'Queued'}});
  };
  const select=async(modelId,key)=>{
    const row=await c.read();return c.post('/model',{modelId,expectedConversationRevision:row.revision,expectedModelRevision:row.reasoningModel.revision},key);
  };
  try {
    await c.approve(10000);
    await c.data((await c.send('A 45 second comic film about a dog.')).response);await c.deliver();
    const old=await c.pending(),original=await f.db.prepare('SELECT * FROM canvas_agent_model_operations WHERE run_id=?').bind(old.run_id).first();
    check(original.model==='xai/grok-4.7'&&c.calls.length===1,'Original accepted Grok operation exists');
    const grokContext=JSON.parse(c.calls[0].body.input.messages[1].content);
    check(grokContext.currentProject.execution.observedAt&&grokContext.currentProject.execution.budgets.briefing.capCredits===10000,
      'Grok receives the observed project evidence and explicitly scoped briefing allowance');
    const before=await c.read(),body={modelId:CANVAS_FABLE_MODEL,expectedConversationRevision:before.revision,expectedModelRevision:before.reasoningModel.revision};
    await c.data(await c.post('/model',body,'switch-original-fable'));await c.data(await c.post('/model',body,'switch-original-fable'));
    const unchanged=await f.db.prepare('SELECT * FROM canvas_agent_model_operations WHERE id=?').bind(original.id).first();
    check(JSON.stringify(unchanged)===JSON.stringify(original),'Switch and replay leave original operation identity and evidence unchanged');
    await c.complete({fields:{story:'A funny dog',style:'comic'}});await c.deliver();
    const first=await c.read();check(first.reasoningModel.modelId===CANVAS_FABLE_MODEL&&first.brief.fields.style.value==='comic','Selection and creative memory persist independently');
    await c.data((await c.send('Keep the same dog and add a funny arrival.')).response);await c.deliver();
    check(fableCalls.length===1&&c.calls.length===1,'Next dialogue uses exactly one Fable request without replaying Grok');
    const call=fableCalls[0],context=JSON.parse(call.body.input.messages[0].content);
    check(context.brief.fields.style.value==='comic'&&context.brief.duration.targetDurationSeconds===45
      &&context.recentMessages.some(message=>message.text.includes('comic film')),'Canonical confirmed brief, duration and visible history cross models');
    check(context.currentProject.execution.observedAt&&context.currentProject.execution.budgets.briefing.capCredits===10000
      &&context.currentProject.conversationSources.some(source=>source.modelId==='xai/grok-4.7'),
      'Fable receives the same evidence contract and explicit attribution of previous visible replies');
    check(call.body.input.system===c.calls[0].body.input.messages[0].content&&call.body.input.system.includes('project-explanations v1'),
      'Both native adapters receive the same current Canvas policy and explanation skill');
    check(context.recentMessages.every(message=>Object.keys(message).every(key=>['id','role','text'].includes(key))),
      'Only canonical visible message fields cross models; capability descriptions may legitimately discuss thinking');
    await c.data(await select('xai/grok-4.7','switch-back-grok'));
    const result={id:call.id,state:'Completed',provider:'anthropic',model:CANVAS_FABLE_MODEL,result:{id:call.id+'-response',type:'message',role:'assistant',model:'claude-fable-5',stop_reason:'end_turn',
        content:[{type:'thinking',thinking:'PRIVATE reasoning',signature:'PRIVATE signature'},{type:'text',text:JSON.stringify({text:'The comic dog arrives with a funny surprise.',scope:'canvas',intent:'continue',updates:[],questions:[],actions:[{type:'status',targetId:null,value:null,number:null,secondaryNumber:null,ids:[],revision:context.projectRevision}]})}],
      usage:{input_tokens:160,output_tokens:200,cache_read_input_tokens:0,cache_creation_input_tokens:0}}};
    const callback=new URL(call.body.options.webhookUrl);
    check((await f.request(callback.pathname,'POST',result)).ok,'Original Fable callback remains valid after selection changes');
    check((await f.request(callback.pathname,'POST',result)).ok,'Duplicate native callback preserves one receipt');
    await c.deliver();
    const reopened=await c.read(),ops=(await f.db.prepare('SELECT * FROM canvas_agent_model_operations WHERE user_id=? ORDER BY rowid').bind(f.owner).all()).results;
    const debits=(await f.db.prepare('SELECT * FROM member_credit_ledger WHERE user_id=? AND amount<0').bind(f.owner).all()).results;
    check(ops.length===2&&ops.every(op=>op.state==='completed')&&debits.length===2,'Each original accepted operation settles exactly once');
    check(ops.every(op=>JSON.parse(op.receipt_json).model===op.model),'Original model is retained by the normalized receipt');
    check(!JSON.stringify(ops).includes('PRIVATE'),'Hidden native provider blocks never enter stored receipts');
    check(reopened.messages.some(message=>message.role==='assistant'&&message.modelId===CANVAS_FABLE_MODEL)
      &&reopened.messages.some(message=>message.role==='assistant'&&message.modelId==='xai/grok-4.7'),'Historical message attribution survives reopen');
    check(reopened.messages.some(message=>message.modelId===CANVAS_FABLE_MODEL&&message.text==='The comic dog arrives with a funny surprise.')
      &&reopened.actions.some(action=>action.type==='status'&&action.state==='completed'),
      'A successful application action stays separate from the preserved natural model answer');
    check(reopened.reasoningModel.modelId==='xai/grok-4.7'&&reopened.brief.fields.style.value==='comic','Reopen keeps current choice and prior known facts');
    const malformed=await select('unintegrated/provider','switch-unintegrated');check(malformed.status===400,'Unintegrated models fail before any inference');
    const {changeModelAvailability}=await import('../../workers/auth/src/lib/model-availability.js');
    await changeModelAvailability(f.env,{id:f.owner},{modelId:CANVAS_FABLE_MODEL,area:'canvas',enabled:false,revision:0});
    check((await select(CANVAS_FABLE_MODEL,'switch-disabled')).status===503,'Disabled model cannot be selected');
    await changeModelAvailability(f.env,{id:f.owner},{modelId:CANVAS_FABLE_MODEL,area:'canvas',enabled:true,revision:1});
    const pricing=await f.db.prepare('SELECT rules_json FROM model_pricing_state WHERE id=1').first();
    const rules={...JSON.parse(pricing.rules_json),[`${CANVAS_FABLE_MODEL}:{}`]:{rates:{inputToken:1}}};
    await f.db.prepare('UPDATE model_pricing_state SET rules_json=? WHERE id=1').bind(JSON.stringify(rules)).run();
    check((await select(CANVAS_FABLE_MODEL,'switch-unpriced')).status===503,'Missing retail billing dimensions cannot admit an unpriced model');
    await f.db.prepare('UPDATE model_pricing_state SET rules_json=? WHERE id=1').bind(pricing.rules_json).run();
    check(c.calls.length===1&&fableCalls.length===1,'All selector/read/replay operations are inference-free');
    return {models:2,providerCalls:2,debits:2,originalIdentitiesPreserved:true,opaqueContextShared:false};
  }finally{c.restore();}
}
