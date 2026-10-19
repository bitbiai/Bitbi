import worker from '../../workers/auth/src/index.js';
import {canvasAudioFixture} from './canvas-audio-control.mjs';
import {finishCanvasAgentFixture,freshCanvasAgentPlan} from './canvas-agent-control.mjs';
import {previewCanvasMediaRecovery,authorizeCanvasMediaRecovery,recoverCanvasAgentMedia} from '../../workers/auth/src/lib/canvas-agent-media-recovery.js';
import {readCanvasAgentBudget} from '../../workers/auth/src/lib/canvas-agent-budget.js';
import {processCanvasAgent} from '../../workers/auth/src/lib/canvas-agent-execution.js';
const check=(condition,message)=>{if(!condition)throw new Error(message);};
export const H3_RECOVERY_CASES=['late','operator','duplicate','cancelled','expired','edited','missing-storage','wrong-owner','unknown','binding','concurrent','crash'];
export async function canvasH3RecoveryCase(env,name,media){
  const f=await canvasAudioFixture(env,{...media,scope:`h3-recovery-${name}`}),original=f.env.__TEST_FETCH;
  let callback,submissions=0;
  f.env.__TEST_FETCH=async(url,init)=>{
    const body=init?.body?JSON.parse(init.body):null;
    if(body?.model==='minimax/h3'&&submissions++===0){
      callback=body.input.callback_url;f.calls.push(body);
      return Response.json({success:false,errors:[{code:7009,message:'Synthetic gateway timeout after acceptance'}]},{status:504});
    }
    return original(url,init);
  };
  const deliver=async()=>{
    const message=f.messages.find(item=>item.type==='member_generation.process');
    check(message,'Accepted original durable generation job');f.messages.splice(f.messages.indexOf(message),1);
    await worker.queue({queue:'bitbi-ai-video-jobs',messages:[{body:message,attempts:1,ack(){},retry(){throw new Error('Unknown acceptance is not resubmitted');}}]},f.env,{waitUntil(){}});
  };
  const finished=await finishCanvasAgentFixture({f,targetSeconds:12,planOverride:freshCanvasAgentPlan(),expectedTerminal:'review_required',deliverGeneration:deliver});
  const aiWorker=(await import('../../workers/ai/src/index.js')).default;
  f.env.AI_LAB={fetch:request=>aiWorker.fetch(request,{ENABLE_GROK_4_7:'true',AI_SERVICE_AUTH_SECRET:f.env.AI_SERVICE_AUTH_SECRET,SERVICE_AUTH_REPLAY:f.env.SERVICE_AUTH_REPLAY||f.env.PUBLIC_RATE_LIMITER,AI:{run(){throw new Error('Recovery must not invoke reasoning');}}},{waitUntil(){}})};
  const runId=finished.runId,identity={runId,userId:f.owner,projectId:f.project};
  const current=()=>f.db.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(runId).first();
  const job=await f.db.prepare('SELECT * FROM member_generation_jobs WHERE canvas_run_id IN (SELECT id FROM canvas_runs WHERE project_id=?) ORDER BY created_at DESC LIMIT 1').bind(f.project).first();
  check(job.status==='outcome_unknown'&&submissions===1,'Exact 504 boundary retains one paid request');
  if(name==='unknown'){
    check((await recoverCanvasAgentMedia(f.env,identity)).every(item=>!item.recovered),'Unknown provider acceptance cannot resume');
    check((await current()).status==='review_required'&&submissions===1,'No blind retry');return {name,submissions,recovered:false};
  }
  const body={task:{id:'synthetic-h3-late',model:'MiniMax-H3',status:'succeeded',resolution:'768P',duration:4,usage:{output_seconds:4},content:{url:'https://fixture.invalid/completion.mp4'}}};
  const response=await f.request(new URL(callback).pathname,'POST',body);check(response.ok,`Signed late callback accepted: ${response.status}`);
  await deliver();
  const saved=await f.db.prepare('SELECT * FROM member_generation_jobs WHERE id=?').bind(job.id).first();
  check(['succeeded','preview_pending'].includes(saved.status)&&saved.asset_id,'Original job saved');
  const usage=await f.db.prepare('SELECT * FROM member_ai_usage_attempts_v2 WHERE id=?').bind(job.usage_attempt_id).first();
  check(usage.billing_status==='finalized'&&JSON.parse(usage.metadata_json).canvas_agent?.run_id===runId,'Completion retains original project budget binding');
  const budget=await readCanvasAgentBudget(f.env,await current());check(budget.chargedCredits>=usage.credit_cost,'Late finalized cost remains visible before agent resumes');
  if(name==='binding')return {name,submissions,recovered:false};
  if(name==='operator'){
    // Retained historical metadata was replaced by the old result writer. The
    // reviewed recovery binds the original owned job, never rewrites its tariff.
    await f.db.prepare("UPDATE member_ai_usage_attempts_v2 SET metadata_json=json_remove(metadata_json,'$.canvas_agent') WHERE id=?").bind(job.usage_attempt_id).run();
    await f.db.prepare("UPDATE canvas_agent_runs SET cause_json=json_set(cause_json,'$.recovery','manual') WHERE id=?").bind(runId).run();
    check((await recoverCanvasAgentMedia(f.env,identity)).length===0,'Historical holds require explicit scoped recovery');
    const preview=await previewCanvasMediaRecovery(f.env,identity),input={...identity,recoveryDigest:preview.recoveryDigest,projectCapCredits:5000,actor:'synthetic-owner',authorizationRef:'synthetic-test-approval'};
    check((await authorizeCanvasMediaRecovery(f.env,input)).authorized,'Audited exact operator consent');
    check((await authorizeCanvasMediaRecovery(f.env,input)).idempotentReplay,'Repeated recovery authorization is not duplicated');
  }
  if(name==='cancelled')await f.db.prepare("UPDATE canvas_agent_runs SET status='cancelled' WHERE id=?").bind(runId).run();
  if(name==='expired')await f.db.prepare("UPDATE canvas_agent_runs SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(runId).run();
  if(name==='edited')await f.db.prepare('UPDATE canvas_projects SET revision=revision+1 WHERE id=?').bind(f.project).run();
  if(name==='missing-storage'){const asset=await f.db.prepare('SELECT r2_key FROM ai_text_assets WHERE id=?').bind(saved.asset_id).first();await f.env.USER_IMAGES.delete(asset.r2_key);}
  if(name==='wrong-owner'){
    let error;try{await previewCanvasMediaRecovery(f.env,{...identity,userId:'foreign-owner'});}catch(e){error=e;}
    check(error?.code==='canvas_agent_media_recovery_not_found','Independent exact-owner guard');return {name,submissions,recovered:false};
  }
  let recovered;
  if(name==='crash'){
    const real=f.env.DB;let lost=false;
    f.env.DB=new Proxy(real,{get(target,key){if(key==='batch')return async statements=>{const result=await target.batch(statements);if(!lost){lost=true;throw new Error('Synthetic loss after committed reconciliation');}return result;};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
    try{await recoverCanvasAgentMedia(f.env,identity);}finally{f.env.DB=real;}
    check(lost&&(await current()).status==='running','Crash after commit leaves authoritative successful transition');
    recovered=[{recovered:true}];
  }else if(name==='concurrent'){
    const results=await Promise.all([recoverCanvasAgentMedia(f.env,identity),recoverCanvasAgentMedia(f.env,identity)]);
    recovered=results.flat().filter(item=>item.recovered);check(recovered.length===1,'Concurrent observers reconcile exactly once');
  }else recovered=await recoverCanvasAgentMedia(f.env,identity);
  if(['cancelled','expired','edited','missing-storage'].includes(name)){
    check(recovered.every(item=>!item.recovered),'Changed authority or missing bytes prevents continuation');
    if(name==='missing-storage')check(recovered[0]?.code==='canvas_agent_media_recovery_storage_missing','Storage broken case reaches byte check');
    if(name==='edited')check(recovered[0]?.code==='canvas_agent_project_changed','Edit broken case reaches revision check');
    check(submissions===1,'Storage/authority failure does not regenerate');return {name,submissions,recovered:false};
  }
  check(recovered.length===1&&recovered[0].recovered,`Late result resumes exact production: ${JSON.stringify(recovered)}`);
  check((await current()).status==='running','Original production resumes only after persisted receipt validation');
  const count=await f.db.prepare('SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=? AND idempotency_key=? AND amount<0').bind(f.owner,usage.idempotency_key).first();
  check(count.n===1,'Exactly one original debit');
  check((await recoverCanvasAgentMedia(f.env,identity)).length===0,'Duplicate cron or operator delivery does not duplicate recovery');
  await processCanvasAgent(f.env,runId);
  const next=await f.db.prepare('SELECT COUNT(*) AS n FROM member_generation_jobs WHERE canvas_run_id IN (SELECT id FROM canvas_runs WHERE project_id=?)').bind(f.project).first();
  check(next.n===2&&submissions===1,'Next legitimate clip is durably accepted without repeating first inference');
  return {name,submissions,recovered:true};
}
