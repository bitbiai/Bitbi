import worker from '../../workers/auth/src/index.js';
import aiWorker from '../../workers/ai/src/index.js';
import {canvasAgentModelOperationFixture} from './canvas-agent-model-operation-control.mjs';
import {canvasConversationExecutionFacts} from '../../workers/auth/src/lib/canvas-agent-conversation-context.js';
import {recoverCanvasStoredMedia} from '../../workers/auth/src/lib/canvas-agent-media-resume.js';
const check=(value,message)=>{if(!value)throw new Error(message);};
export const MEDIA_COMPLETION_CASES=['resume','automatic','lost-ack','missing-storage','edited','adopt-current','unknown','cancelled','expired','foreign','completion-window','proof-recheck'];

export async function canvasMediaCompletionCase(base,name,media,{processor=null}={}){
  check(MEDIA_COMPLETION_CASES.includes(name),'Known media completion case');
  const f=await canvasAgentModelOperationFixture(base,{scope:'media-completion-'+name}),calls=[],callbacks=[];
  const plan={version:1,title:'Reference to editable mixed film',continuity:'The same red dog and pool across both scenes.',
    nodes:[
      {key:'reference',type:'image_generation',title:'Dog reference',modelId:'xai/grok-imagine-image-2.0',prompt:'A red dog at a pool.',config:{resolution:'1k',aspectRatio:'16:9'},dependencies:[]},
      ...[1,2,3].map(i=>({key:'shot'+i,type:'video_generation',title:'Scene '+i,modelId:'minimax/h3',prompt:'The same dog at the pool, scene '+i,
        config:{duration:4,resolution:'768P',aspectRatio:'adaptive'},dependencies:[{key:'reference',role:'first_frame'}]})),
      {key:'music',type:'music_generation',title:'Background music',modelId:'elevenlabs/music-v2',prompt:'Bright instrumental music.',
        config:{musicLengthMs:12000,forceInstrumental:true,outputFormat:'mp3_48000_192'},dependencies:[]},
    ],assembly:{clips:[1,2,3].map(i=>({key:'shot'+i,trim:{start:0,duration:4},transition:{preset:'none'}})),musicKey:'music',
      targetDurationSeconds:12,toleranceSeconds:.5,backgroundMusic:{enabled:true,gain:.5},smoothJoins:false}};
  const provider={ENABLE_GROK_4_7:'true',AI_SERVICE_AUTH_SECRET:f.env.AI_SERVICE_AUTH_SECRET,
    SERVICE_AUTH_REPLAY:f.env.SERVICE_AUTH_REPLAY||f.env.PUBLIC_RATE_LIMITER,
    AI:{async run(model,input){
      calls.push({model,input});
      if(model==='xai/grok-imagine-image-2.0')return {image:'data:image/png;base64,'+media.imageBase64};
      if(model==='elevenlabs/music-v2')return {state:'Completed',result:{audio:'data:audio/mpeg;base64,'+media.musicBase64,audio_duration_ms:12000}};
      throw new Error('Unexpected paid model in media fixture');
    }}};
  f.env.AI=provider.AI;
  f.env.AI_LAB={fetch:request=>aiWorker.fetch(request,provider,{waitUntil(){throw new Error('Detached inference forbidden');}})};
  f.env.AI_IMAGE_DERIVATIVES_QUEUE={async send(){}};
  f.env.PRIVATE_MEDIA_PROCESSOR_SECRET='synthetic-audio-processor';
  f.env.PRIVATE_MEDIA_PROCESSOR={async fetch(){return Response.json({ok:true});}};
  const originalFetch=f.env.__TEST_FETCH;
  f.env.__TEST_FETCH=async(url,init)=>{
    if(url==='https://fixture.invalid/media-completion.mp4')return new Response(Uint8Array.from(atob(media.videoSourcesBase64?.[calls.filter(c=>c.model==='minimax/h3').length-1]||media.videoBase64),c=>c.charCodeAt(0)),{headers:{'Content-Type':'video/mp4'}});
    check(url===`https://api.cloudflare.com/client/v4/accounts/${f.env.CLOUDFLARE_ACCOUNT_ID}/ai/run`,'Unexpected external request');
    const body=JSON.parse(init.body);
    if(body.model==='minimax/h3'){
      calls.push({model:body.model,input:body.input});
      check(body.input.content.some(c=>c.role==='first_frame'),'Video receives the actual stored image reference');
      return Response.json({success:true,result:{state:'Completed',result:{task:{id:'synthetic-clip-'+calls.length,model:'MiniMax-H3',status:'succeeded',
        resolution:'768P',duration:4,usage:{output_seconds:4},content:{url:'https://fixture.invalid/media-completion.mp4'}}}}});
    }
    if(body.input.response_format.json_schema.name==='bitbi_canvas_evaluation_v1'){
      callbacks.push({url:body.options.webhookUrl,body:{id:'synthetic-media-review',state:'Completed',model:body.model,result:{id:'synthetic-media-review',object:'chat.completion',model:'grok-4.7',
        choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({accepted:true,issues:[],confidence:'medium',samplingLimit:'Selected stills only.'})}}],
        usage:{prompt_tokens:120,completion_tokens:200,total_tokens:320}}}});
      return Response.json({success:true,result:{id:'synthetic-media-review',state:'Queued'}});
    }
    return originalFetch(url,init);
  };
  await f.deliver();
  const result={id:'synthetic-plan-result',object:'chat.completion',model:'grok-4.7',choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(plan)}}],usage:{prompt_tokens:120,completion_tokens:200,total_tokens:320}};
  const completion=await f.complete({result});check(completion.status===200,`Original signed planning callback accepted: ${completion.status}/${await completion.text()}`);
  await f.deliver();await f.deliver();
  const jobs=()=>f.db.prepare('SELECT * FROM member_generation_jobs WHERE user_id=? ORDER BY rowid').bind(f.owner).all();
  const deliverJob=job=>f.atClock(()=>worker.queue({queue:'bitbi-ai-video-jobs',messages:[{body:{type:'member_generation.process',job_id:job.id},attempts:1,ack(){},retry(){throw new Error('Unexpected media retry');}}]},f.env,{waitUntil(){throw new Error('Detached media forbidden');}}));
  const first=(await jobs()).results[0];check(first?.media_type==='image','First normal accepted job is the reference image');
  const original=f.env.DB;
  let windowObserved=false,windowState=null;
  if(name==='completion-window')f.env.DB=new Proxy(original,{get(target,key){
    if(key==='prepare')return sql=>{
      const statement=target.prepare(sql);
      if(!sql.startsWith('UPDATE member_generation_jobs SET status=?,result_r2_key=?'))return statement;
      return {bind(...args){const bound=statement.bind(...args);return {async run(){
        const node=await f.db.prepare('SELECT status FROM canvas_runs WHERE id=?').bind(first.canvas_run_id).first();
        const job=await f.db.prepare('SELECT status FROM member_generation_jobs WHERE id=?').bind(first.id).first();
        check(node.status==='completed'&&job.status==='ingesting','Real producer exposes the completed node before the final job write');
        f.advance(10000);
        await worker.queue({queue:'bitbi-ai-video-jobs',messages:[{body:{type:'canvas_agent.process',run_id:f.runId},attempts:1,ack(){},retry(){throw new Error('Unexpected agent retry');}}]},f.env,{waitUntil(){throw new Error('Detached completion forbidden');}});
        const run=await f.db.prepare('SELECT status,error_code FROM canvas_agent_runs WHERE id=?').bind(f.runId).first();
        const step=await f.db.prepare("SELECT status FROM canvas_agent_steps WHERE run_id=? AND kind='node' ORDER BY rowid LIMIT 1").bind(f.runId).first();
        windowState={run,step};
        check(calls.length===1,'Observation does not submit another image');windowObserved=true;
        return bound.run();
      }};}};
    };const value=target[key];return typeof value==='function'?value.bind(target):value;
  }});
  try{await deliverJob(first);}finally{f.env.DB=original;}
  const saved=await f.db.prepare('SELECT * FROM member_generation_jobs WHERE id=?').bind(first.id).first();
  check(saved.status==='succeeded'&&saved.asset_id,'The normal image provider/storage/callback completes before the injected local failure');
  if(name==='completion-window'){
    check(windowObserved,'Actual producer finalization window was exercised');
    check(windowState.run.status==='running'&&!windowState.run.error_code&&windowState.step.status==='accepted','An unfinished local job is observed without blocking or releasing dependencies');
    await f.deliver();await deliverJob(first);await f.deliver();
    const step=await f.db.prepare("SELECT status,receipt_json FROM canvas_agent_steps WHERE run_id=? AND kind='node' ORDER BY rowid LIMIT 1").bind(f.runId).first();
    check(step.status==='completed'&&JSON.parse(step.receipt_json).assetId===saved.asset_id,'Normal wake finishes the original stored result');
    check((await jobs()).results.some(j=>j.media_type==='video')&&calls.length===1,'Only the dependent video is admitted, no repeated image inference');
    const debits=await f.db.prepare('SELECT COUNT(*) AS count FROM member_credit_ledger WHERE user_id=? AND idempotency_key=(SELECT idempotency_key FROM member_ai_usage_attempts_v2 WHERE id=?) AND amount<0').bind(f.owner,first.usage_attempt_id).first();
    check(debits.count===1,'Interleaved completion and duplicate delivery debit the image once');
    return {case:name,recovered:true,mediaCalls:calls.length};
  }
  let injected=false;
  f.env.DB=new Proxy(original,{get(target,key){if(key==='prepare')return sql=>{
    const statement=target.prepare(sql);if(name==='proof-recheck'?!sql.startsWith('SELECT c.*,j.id AS job_id'):sql!=='SELECT * FROM canvas_runs WHERE user_id=? AND idempotency_key=?')return statement;
    return {bind(...args){const bound=statement.bind(...args);return {async first(){if(!injected){injected=true;throw name==='proof-recheck'?Object.assign(new Error('canvas_agent_media_recovery_evidence_invalid'),{code:'canvas_agent_media_recovery_evidence_invalid',status:409}):new Error('D1_ERROR: synthetic read interruption');}return bound.first();}};}};
  };const value=target[key];return typeof value==='function'?value.bind(target):value;}});
  try{await f.deliver();}finally{f.env.DB=original;}
  const current=()=>f.db.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(f.runId).first();
  const held=await current();check(injected&&held.status===(name==='proof-recheck'?'blocked':'review_required')&&held.error_code===(name==='proof-recheck'?'canvas_agent_media_recovery_evidence_invalid':'canvas_agent_local_execution_failed'),'Actual generation caller retains the original failure and execution certainty');
  const cause=JSON.parse(held.cause_json);check(cause.execution.stepId&&cause.execution.stage===(name==='proof-recheck'?'media_completion':'media_lookup'),'Diagnostic identifies the media step');
  const facts=await canvasConversationExecutionFacts(f.env,f.owner,f.project);
  const accepted=facts.production.steps.find(s=>s.id===cause.execution.stepId);
  check(accepted?.receipt?.ok===null&&accepted.receipt.outcome==='accepted','Missing ok is not a corrupt receipt');
  const ledgerBefore=JSON.stringify((await f.db.prepare('SELECT * FROM member_credit_ledger WHERE user_id=? ORDER BY id').bind(f.owner).all()).results);
  let expectedRevision;
  const resume=()=>f.request(`${f.route}/${f.runId}/control`,'POST',{action:'resume',...(expectedRevision!==undefined?{expectedRevision}: {})},{'Idempotency-Key':'synthetic-media-resume'});
  if(name==='missing-storage'){const image=await f.db.prepare('SELECT r2_key FROM ai_images WHERE id=?').bind(saved.asset_id).first();await f.env.USER_IMAGES.delete(image.r2_key);}
  if(name==='edited')await f.data(await f.request(`${f.projectPath}/nodes/${accepted.nodeId}`,'PATCH',{title:'A genuinely newer manual decision'}));
  if(name==='cancelled')await f.data(await f.request(`${f.route}/${f.runId}/control`,'POST',{action:'cancel'},{'Idempotency-Key':'synthetic-stop'}));
  if(name==='unknown')await f.db.prepare("UPDATE member_generation_jobs SET status='processing',asset_id=NULL,result_r2_key=NULL WHERE id=?").bind(first.id).run();
  if(name==='adopt-current'){
    const view=await f.data(await f.request(f.projectPath)),node=view.nodes.find(n=>n.type==='video_generation');
    await f.data(await f.request(`${f.projectPath}/nodes/${node.id}`,'PATCH',{config:{...node.config,prompt:'The same dog, with a corrected camera direction.'}}));
    check((await resume()).status===409,'A new creative revision requires its explicit approval');
    expectedRevision=(await f.data(await f.request(f.projectPath))).project.revision;
  }
  if(name==='expired'){const clock=f.advance(3*24*3600000);await f.db.prepare('UPDATE sessions SET expires_at=? WHERE user_id=?').bind(new Date(clock+3600000).toISOString(),f.owner).run();}
  if(name==='foreign'){
    const denied=await f.request(`${f.route}/${f.runId}/control`,'POST',{action:'resume'},{Cookie:'__Host-bitbi_session=foreign','Idempotency-Key':'synthetic-foreign'});
    check(denied.status===401,'Foreign user cannot resume');return {case:name,recovered:false,mediaCalls:calls.length};
  }
  if(['missing-storage','edited','unknown','cancelled','expired'].includes(name)){
    const response=await resume(),failure=await response.json();check(!response.ok,'Changed proof/authority blocks normal Resume');
    if(name==='unknown')await f.db.prepare("UPDATE member_generation_jobs SET status='processing',asset_id=NULL,result_r2_key=NULL WHERE id=?").bind(first.id).run();
  if(name==='adopt-current'){
    const view=await f.data(await f.request(f.projectPath)),node=view.nodes.find(n=>n.type==='video_generation');
    await f.data(await f.request(`${f.projectPath}/nodes/${node.id}`,'PATCH',{config:{...node.config,prompt:'The same dog, with a corrected camera direction.'}}));
    check((await resume()).status===409,'A new creative revision requires its explicit approval');
    expectedRevision=(await f.data(await f.request(f.projectPath))).project.revision;
  }
  if(name==='expired')check(failure.code==='canvas_agent_authorization_expired','Expired production authority, not expired login, blocks recovery');
    check(calls.length===1&&JSON.stringify((await f.db.prepare('SELECT * FROM member_credit_ledger WHERE user_id=? ORDER BY id').bind(f.owner).all()).results)===ledgerBefore,'Rejected recovery spends nothing');
    return {case:name,recovered:false,mediaCalls:calls.length};
  }
  if(['automatic','proof-recheck'].includes(name))await f.atClock(()=>recoverCanvasStoredMedia(f.env));
  else if(name==='lost-ack'){
    let lost=false;f.env.DB=new Proxy(original,{get(target,key){if(key==='batch')return async statements=>{const value=await target.batch(statements);if(!lost){lost=true;throw new Error('Synthetic lost commit acknowledgement');}return value;};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
    try{await resume();}finally{f.env.DB=original;}
    check(lost&&(await current()).status==='running','Lost acknowledgement retains the committed resume');
    check((await resume()).ok,'Same request observes successful committed transition');
  }else{
    const responses=await Promise.all([resume(),resume()]);check(responses.some(r=>r.ok),`One concurrent Resume succeeds: ${await responses[0].clone().text()}`);
    check((await resume()).ok,'Duplicate Resume observes the same control');
  }
  if(name==='adopt-current'){
    check((await current()).expected_revision===expectedRevision,'Only the explicitly approved current graph is adopted');
    const conflict=await f.request(`${f.route}/${f.runId}/control`,'POST',{action:'resume',expectedRevision:expectedRevision-1},{'Idempotency-Key':'synthetic-media-resume'});
    check(conflict.status===409,'Same identity cannot adopt different inputs');
  }
  check((await current()).status==='running','Evidence-based normal resume retains the original run');
  await deliverJob(first);await f.deliver();
  check(calls.length===1,'Reconciliation never repeats image inference');
  check(JSON.stringify((await f.db.prepare('SELECT * FROM member_credit_ledger WHERE user_id=? ORDER BY id').bind(f.owner).all()).results)===ledgerBefore,'No second debit during completion');
  const done=await f.db.prepare('SELECT * FROM canvas_agent_steps WHERE id=?').bind(accepted.id).first();
  check(done.status==='completed'&&JSON.parse(done.receipt_json).assetId===saved.asset_id,'Original step now points to the actual saved image');
  const completedFacts=await canvasConversationExecutionFacts(f.env,f.owner,f.project);
  check(completedFacts.production.steps.find(s=>s.id===accepted.id)?.receipt?.outcome==='completion_recorded','Completed media reference is evidence, not a fabricated provider ok flag');
  await f.deliver();check((await jobs()).results.some(j=>j.media_type==='video'),'The next dependent video is admitted');
  if(!processor)return {case:name,recovered:true,mediaCalls:calls.length};
  for(let turn=0;turn<40&&(await current()).status!=='completed';turn++){
    for(const job of (await jobs()).results.filter(j=>j.status==='queued'))await deliverJob(job);
    await f.deliver();
    for(const callback of callbacks.splice(0))check((await f.request(callback.url,'POST',callback.body)).ok,'Signed evaluation result');
    await processor(f);
    check(['running','exporting','completed'].includes((await current()).status),`Complete production blocked: ${(await current()).error_code}`);
  }
  const final=await current();check(final.status==='completed','The same recovered production reaches the saved mixed export');
  check(calls.length===5&&f.calls.length===1,'One reference, three videos, music, and one original plan only');
  return {case:name,recovered:true,mediaCalls:calls.length,runId:f.runId,result:JSON.parse(final.result_json),fixture:f,deliverMediaJob:deliverJob,generationCalls:()=>calls.length};
}
