import worker from '../../workers/auth/src/index.js';
import aiWorker from '../../workers/ai/src/index.js';
import {canvasAudioFixture} from './canvas-audio-control.mjs';
import {freshCanvasAgentPlan,isCanvasAgentProviderEndpoint} from './canvas-agent-control.mjs';
import {canvasAgentCapabilities} from '../../workers/auth/src/lib/canvas-agent-capabilities.js';
import {prepareCanvasAgentGraph} from '../../workers/auth/src/lib/canvas-agent-graph.js';
import {canvasAgentProject} from '../../workers/auth/src/routes/canvas-agent.js';
import {sha256Hex} from '../../workers/auth/src/lib/tokens.js';
import {modelAreaKey} from '../../js/shared/model-area-contract.mjs';

const check=(value,message)=>{if(!value)throw new Error(message);};
export const READINESS_CASES=['accepted-pending','accepted-saved','retry-recover','retry-exhausted','disabled','model-disabled','revoked','expired','edited','unknown'];

// The graph and jobs use ordinary production callers and native-compatible D1.
// Only provider delivery and the signed informational readiness response vary.
export async function canvasAgentReadinessCase(env,name,media){
  const f=await canvasAudioFixture(env,{...media,scope:`readiness-${name}`});
  Object.assign(f.env,{CANVAS_AGENT_ENABLED:'true',ENABLE_GROK_4_7:'true',AI_SERVICE_AUTH_SECRET:'synthetic-readiness-service-secret',
    PRIVATE_MEDIA_PROCESSOR:{fetch:async()=>Response.json({ok:true})}});
  let mode='ready',readinessCalls=0;
  f.env.AI_LAB={fetch:async request=>{
    check(new URL(request.url).pathname==='/internal/ai/canvas-agent/readiness','Readiness recovery must never request planning or inference');
    readinessCalls++;
    if(mode==='unavailable')return Response.json({ok:false,code:'service_unavailable'},{status:503});
    return aiWorker.fetch(request,{ENABLE_GROK_4_7:'true',AI_SERVICE_AUTH_SECRET:f.env.AI_SERVICE_AUTH_SECRET,
      SERVICE_AUTH_REPLAY:f.env.SERVICE_AUTH_REPLAY||f.env.PUBLIC_RATE_LIMITER,
      AI:{run(){throw new Error('Readiness must never perform inference');}}},{waitUntil(){throw new Error('No detached inference');}});
  }};
  const inventory=await canvasAgentCapabilities(f.env),view=await canvasAgentProject(f.env,f.owner,f.project);
  const runId=(await sha256Hex(`readiness-run:${name}`)).slice(0,32),now=new Date().toISOString();
  await f.db.prepare(`INSERT INTO canvas_agent_runs(id,project_id,user_id,request_key,input_json,status,expected_revision,
    budget_credits,target_seconds,tolerance_seconds,tariff_revision,capability_revision,lease_token,lease_until,next_attempt_at,created_at,updated_at,expires_at)
    VALUES(?,?,?,?,?,'planning',?,5000,12,.5,?,?,'readiness-fixture-lease',?,?,?,?,?)`)
    .bind(runId,f.project,f.owner,runId,JSON.stringify({brief:'A twelve-second editable synthetic film.'}),view.project.revision,
      inventory.tariffRevision,inventory.revision,new Date(Date.now()+600000).toISOString(),now,now,now,new Date(Date.now()+3600000).toISOString()).run();
  const read=()=>f.db.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(runId).first();
  await prepareCanvasAgentGraph(f.env,await read(),view,inventory,freshCanvasAgentPlan());
  await f.db.prepare('UPDATE canvas_agent_runs SET lease_token=NULL,lease_until=NULL WHERE id=?').bind(runId).run();
  const steps=()=>f.db.prepare("SELECT * FROM canvas_agent_steps WHERE run_id=? AND kind='node' ORDER BY rowid").bind(runId).all();
  const jobs=()=>f.db.prepare('SELECT * FROM member_generation_jobs WHERE user_id=? ORDER BY rowid').bind(f.owner).all();
  const wake=async({due=true}={})=>{
    // Represent a subsequent scheduled wake only after asserting its persisted
    // backoff below; do not alter the clock used by native service-auth replay.
    if(due)await f.db.prepare("UPDATE canvas_agent_runs SET next_attempt_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(runId).run();
    await worker.queue({queue:'bitbi-ai-video-jobs',messages:[0,1].map(()=>({body:{type:'canvas_agent.process',run_id:runId},attempts:1,ack(){},retry(){throw new Error('Observation retries belong to durable run state');}}))},f.env,{waitUntil(){throw new Error('No detached execution');}});
  };
  const deliver=async()=>{
    const message=f.messages.find(item=>item.type==='member_generation.process');check(message,'One original media job was admitted');
    f.messages.splice(f.messages.indexOf(message),1);
    await worker.queue({queue:'bitbi-ai-video-jobs',messages:[{body:message,attempts:1,ack(){},retry(){throw new Error('Unknown acceptance must not replay');}}]},f.env,{waitUntil(){}});
  };
  if(['accepted-pending','accepted-saved','unknown'].includes(name)){
    await wake();check((await jobs()).results.length===1,'One original durable job');
    const original=(await jobs()).results[0],first=(await steps()).results[0],callsBefore=readinessCalls;
    if(name==='accepted-pending'){
      const originalFetch=f.env.__TEST_FETCH;let release,entered;
      const held=new Promise(resolve=>{release=resolve;}),dispatched=new Promise(resolve=>{entered=resolve;});
      f.env.__TEST_FETCH=async(url,init)=>{if(isCanvasAgentProviderEndpoint(url,f.env.CLOUDFLARE_ACCOUNT_ID)){entered();await held;}return originalFetch(url,init);};
      const delivery=deliver();
      try{
        await Promise.race([dispatched,delivery.then(()=>{throw new Error('Provider was never entered');})]);
        mode='unavailable';await wake();
        const job=(await jobs()).results[0],usage=await f.db.prepare('SELECT provider_outcome FROM member_ai_usage_attempts_v2 WHERE id=?').bind(job.usage_attempt_id).first();
        check(job.id===original.id&&job.status==='processing'&&usage.provider_outcome==='dispatched','Observe the exact accepted provider operation');
        check(readinessCalls===callsBefore&&(await read()).status==='running','Pending accepted work needs no new readiness probe');
      }finally{release();await delivery;}
      check(f.calls.length===1&&(await jobs()).results.length===1,'No duplicate provider or job after concurrent observation');
    }else if(name==='accepted-saved'){
      await deliver();mode='unavailable';await wake();
      const complete=(await steps()).results[0],job=(await jobs()).results[0];
      check(complete.id===first.id&&complete.status==='completed'&&complete.usage_attempt_id===original.usage_attempt_id,'Existing saved receipt completes the original agent step');
      check(job.id===original.id&&job.asset_id&&job.result_r2_key,'Saved byte identity survives assistant unavailability');
      check(readinessCalls===callsBefore&&f.calls.length===1,'Saved-result observation never probes or generates again');
      const ledger=await f.db.prepare('SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=? AND amount<0').bind(f.owner).first();
      check(ledger.n===1,'Exactly one original media debit');
      await wake();check((await read()).status==='running'&&readinessCalls===callsBefore+1&&(await jobs()).results.length===1,'The next NEW step must wait for readiness');
    }else{
      f.env.__TEST_FETCH=async(url,init)=>{check(isCanvasAgentProviderEndpoint(url,f.env.CLOUDFLARE_ACCOUNT_ID),'No download without a result');f.calls.push(JSON.parse(init.body));return Response.json({success:false,errors:[{code:7009,message:'Synthetic ambiguous acceptance'}]},{status:504});};
      await deliver();mode='unavailable';await wake();
      check((await read()).status==='review_required'&&(await read()).error_code==='canvas_agent_provider_review_required','Unknown provider outcome remains fenced');
      check(readinessCalls===callsBefore&&f.calls.length===1&&(await jobs()).results.length===1,'Readiness retry cannot disguise a new paid generation');
    }
  }else if(name.startsWith('retry-')){
    mode='unavailable';const count=name==='retry-exhausted'?5:2;
    for(let attempt=1;attempt<=count;attempt++){
      const before=Date.now();await wake();const current=await read(),cause=JSON.parse(current.cause_json);
      check(cause.readiness.attempts===attempt&&cause.readiness.httpStatus===503&&cause.readiness.code==='canvas_agent_readiness_http','Typed failure and attempt are durable across queue invocations');
      check(current.status===(attempt===5?'blocked':'running'),'Only bounded observation failure becomes blocked');
      if(attempt<5)check(Date.parse(current.next_attempt_at)>=before+Math.min(240,30*2**(attempt-1))*1000,'Persisted exponential backoff is respected');
      const observed=readinessCalls;await wake({due:false});check(readinessCalls===observed,'Early duplicate delivery cannot bypass durable backoff');
      check((await jobs()).results.length===0&&f.calls.length===0,'Failed readiness starts no media operation');
    }
    if(name==='retry-recover'){
      mode='ready';await wake();const current=await read();
      check(current.status==='running'&&current.error_code===null&&current.cause_json===null,'A successful signed probe clears only the observational failure');
      check((await jobs()).results.length===1,'Exactly one next step admitted after readiness recovery');
      await deliver();check(f.calls.length===1,'No speculative duplicate generation');
    }else{
      mode='ready';await wake();check(readinessCalls===5&&JSON.parse((await read()).cause_json).readiness.exhausted===true,'Exhausted observational retries do not restart automatically');
    }
  }else{
    mode='unavailable';
    if(name==='disabled')f.env.CANVAS_AGENT_ENABLED='false';
    if(name==='model-disabled')await f.db.prepare('INSERT INTO app_settings(key,value_json,updated_at) VALUES(?,?,?)').bind(modelAreaKey('xai/grok-4.7','canvas'),JSON.stringify({version:1,revision:1,enabled:false,history:[]}),now).run();
    if(name==='revoked')await f.db.prepare("UPDATE users SET status='suspended' WHERE id=?").bind(f.owner).run();
    if(name==='expired')await f.db.prepare("UPDATE canvas_agent_runs SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(runId).run();
    if(name==='edited')await f.db.prepare('UPDATE canvas_projects SET revision=revision+1 WHERE id=?').bind(f.project).run();
    await wake();const current=await read();
    const expected={disabled:'canvas_agent_disabled','model-disabled':'model_area_disabled',revoked:'canvas_agent_authority_revoked',expired:'canvas_agent_authorization_expired',edited:'canvas_agent_project_changed'}[name];
    check(current.error_code===expected&&!['running','queued','planning','exporting'].includes(current.status),'Authority/configuration holds are not transient readiness retries');
    check(readinessCalls===0&&(await jobs()).results.length===0&&f.calls.length===0,'Local guards precede network and paid admission');
  }
  if(name==='model-disabled')await f.db.prepare('DELETE FROM app_settings WHERE key=?').bind(modelAreaKey('xai/grok-4.7','canvas')).run();
  return {name,readinessCalls,providerCalls:f.calls.length};
}
