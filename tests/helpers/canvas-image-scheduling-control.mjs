import worker from '../../workers/auth/src/index.js';
import { canvasAgentBudgetFixture } from './canvas-agent-autonomy-control.mjs';
import { quoteModelTariff } from '../../workers/auth/src/lib/model-tariffs.js';
import { readCanvasAgentBudget } from '../../workers/auth/src/lib/canvas-agent-budget.js';
import { publicAgentRun } from '../../workers/auth/src/lib/canvas-agent-store.js';
import { sha256Hex } from '../../workers/auth/src/lib/tokens.js';
import { imageGenerationCapacity,registerImageGenerationSlot,acquireImageGenerationSlot,dispatchImageGenerationSlot,finishImageGenerationSlot,imageGenerationLegacyReviewFingerprint } from '../../workers/auth/src/lib/image-generation-capacity.js';
import { beginMemberAiUsageAttempt,markMemberAiUsageAttemptProviderRunning,markMemberAiUsageAttemptUnknown } from '../../workers/auth/src/lib/member-ai-usage-attempts.js';
import { evaluateSharedRateLimit,sensitiveRateLimitOptions } from '../../workers/auth/src/lib/rate-limit.js';

const check=(value,message)=>{if(!value)throw new Error(message);};
const MODEL='@cf/black-forest-labs/flux-1-schnell';
export const CANVAS_IMAGE_SCHEDULING_CASES=['parallel-fifteen','capacity-fairness','unknown-fence','manual-revision','stop-budget','capacity-wait','capacity-recovery','out-of-order','rate-admission','scope-limits','claim-recovery','legacy-cutover'];
const policy=(overrides={})=>JSON.stringify({version:1,revision:'synthetic-verified-15',reviewRef:'fixture/account-capacity',
  verifiedUntil:new Date(Date.now()+3600000).toISOString(),global:15,user:15,project:15,providers:{'workers-ai':15,openai:15},...overrides});
const queue=(f,body)=>worker.queue({queue:'bitbi-ai-video-jobs',messages:[{body,attempts:1,ack(){},retry({delaySeconds}){check(delaySeconds>0,'Bounded queue delay');}}]},f.env,
  {waitUntil(){throw new Error('Image scheduling cannot rely on detached/browser work');}});
async function fixture(base,name,count,capacity=15) {
  const f=await canvasAgentBudgetFixture(base,'images-'+name),nodes=[],now=new Date().toISOString();
  f.env.IMAGE_GENERATION_CAPACITY_JSON=policy({global:capacity,user:capacity,project:capacity,providers:{'workers-ai':capacity}});
  f.env.AI_IMAGE_DERIVATIVES_QUEUE={async send(){}};
  for(let i=0;i<count;i++) {
    const response=await f.request(f.projectPath+'/nodes','POST',{type:'image_generation',model_id:MODEL,title:'Independent reference '+i,config:{prompt:'A red dog portrait '+i}});
    const value=await response.json();check(response.ok,`Ordinary image node admission: ${value.code}`);nodes.push(value.data.node.id);
  }
  const price=await quoteModelTariff(f.env,{modelId:MODEL,input:{}}),run=await f.createRun('images-'+name,Math.max(100,price.credits*count));
  for(let i=0;i<nodes.length;i++)await f.db.prepare(`INSERT INTO canvas_agent_steps(id,run_id,step_key,kind,node_id,input_json,allocation_credits,created_at,updated_at)
    VALUES(?,?,?,'node',?,?,?,?,?)`).bind((await sha256Hex(run.id+':'+i)).slice(0,32),run.id,'image_'+i,nodes[i],JSON.stringify({modelId:MODEL,dependencies:[]}),price.credits,now,now).run();
  await f.db.prepare("UPDATE canvas_agent_runs SET status='running',phase='generating',lease_token=NULL,lease_until=NULL WHERE id=?").bind(run.id).run();
  return {...f,nodes,run,price};
}
async function start(f) {
  await queue(f,{type:'canvas_agent.process',run_id:f.run.id});
  const jobs=(await f.db.prepare('SELECT * FROM member_generation_jobs WHERE user_id=? ORDER BY created_at,rowid').bind(f.owner).all()).results;
  const run=await f.db.prepare('SELECT status,error_code FROM canvas_agent_runs WHERE id=?').bind(f.run.id).first();
  check(run.status==='running',`Ordinary scheduler admission must run: ${run.status}/${run.error_code}`);
  return jobs;
}
function providerBarrier(f,media) {
  const calls=[],tasks=[];let notify;
  f.env.AI={async run(model,input){check(model===MODEL,'Only the admitted model may run');let resolve,reject;
    const gate=new Promise((yes,no)=>{resolve=yes;reject=no;});calls.push({model,input,resolve,reject});notify?.();return gate;}};
  const begin=async job=>{
    const previous=calls.length,entered=new Promise(resolve=>{notify=resolve;});
    const task=queue(f,{type:'member_generation.process',job_id:job.id});tasks.push(task);
    let timer;
    try {await Promise.race([entered,task.then(async()=>{const row=await f.db.prepare('SELECT status,error_code FROM member_generation_jobs WHERE id=?').bind(job.id).first();throw new Error(`Queue returned before provider acceptance: ${row.status}/${row.error_code}`);}),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Actual queue did not reach synthetic provider')),10000);})]);}
    finally {clearTimeout(timer);notify=null;}
    check(calls.length===previous+1,'One original dispatch per independent job');
  };
  const finish=async()=>{for(const call of [...calls].reverse())call.resolve({image:media.imageBase64});await Promise.all(tasks);};
  return {calls,tasks,begin,finish};
}
async function cleanup(f) {
  // Native controls share a database; terminal/unknown synthetic jobs must not
  // become another independent case's global account workload after assertions.
  await f.db.prepare('DELETE FROM member_generation_jobs WHERE user_id=?').bind(f.owner).run();
  await f.db.prepare('DELETE FROM image_generation_slots WHERE user_id=?').bind(f.owner).run();
  await f.db.prepare('DELETE FROM member_ai_usage_attempts_v2 WHERE user_id=?').bind(f.owner).run();
  await f.db.prepare('DELETE FROM canvas_projects WHERE id=?').bind(f.project).run();
}

export async function canvasImageSchedulingCase(base,{name,...media}) {
  check(CANVAS_IMAGE_SCHEDULING_CASES.includes(name),'Known image scheduling control');
  if(name==='legacy-cutover') {
    const f=await fixture(base,name,1,1),barrier=providerBarrier(f,media);
    try {
      const legacy=async(key,unknown=true)=>{
        const input={env:f.env,userId:f.owner,featureKey:'ai.image.generate',operationKey:'member.image.generate',route:'/api/ai/generate-image',
          idempotencyKey:'synthetic-legacy-cutover-'+key,requestFingerprint:await sha256Hex(key),creditCost:1,metadata:{image_request:{model_id:MODEL}}};
        const usage=await beginMemberAiUsageAttempt(input),token=await markMemberAiUsageAttemptProviderRunning(f.env,usage.attempt.id);
        if(unknown)await markMemberAiUsageAttemptUnknown(f.env,usage.attempt.id,{dispatchToken:token});
        const row=await f.db.prepare('SELECT * FROM member_ai_usage_attempts_v2 WHERE id=?').bind(usage.attempt.id).first();
        const hash=await imageGenerationLegacyReviewFingerprint({scope:'member',id:row.id,createdAt:row.created_at,modelId:MODEL});
        return {row,hash,input,token};
      };
      const first=await legacy('first'),second=await legacy('second'),jobs=await start(f);
      const slot=await f.db.prepare('SELECT * FROM image_generation_slots WHERE job_id=?').bind(jobs[0].id).first();
      f.env.IMAGE_GENERATION_LEGACY_REVIEW_JSON='';
      check(!await acquireImageGenerationSlot(f.env,slot),'An absent/invalid review never silently ignores historical unknown exposure');
      const review={version:1,reviewRef:'synthetic/explicit-cutover',reviewedAt:new Date().toISOString(),unknown:[first.hash,second.hash]};
      f.env.IMAGE_GENERATION_LEGACY_REVIEW_JSON=JSON.stringify(review);
      await barrier.begin(jobs[0]);await barrier.finish();
      for(const original of [first,second])check(JSON.stringify(await f.db.prepare('SELECT * FROM member_ai_usage_attempts_v2 WHERE id=?').bind(original.row.id).first())===JSON.stringify(original.row),
        'Reviewed coordination changes neither historical outcome, reservation, receipt nor request identity');
      check((await f.db.prepare('SELECT status FROM member_generation_jobs WHERE id=?').bind(jobs[0].id).first()).status==='succeeded','An exact reviewed cutover permits the original new ordinary image job');
      const waiting=await registerImageGenerationSlot(f.env,{usagePolicy:{mode:'admin'},userId:f.owner,modelId:MODEL});
      await f.db.prepare("UPDATE member_ai_usage_attempts_v2 SET metadata_json=json_set(metadata_json,'$.image_request.model_id',?) WHERE id=?")
        .bind('openai/gpt-image-2',first.row.id).run();
      check(!await acquireImageGenerationSlot(f.env,waiting),'A changed original model tuple cannot reuse a reviewed digest');
      await f.db.prepare('UPDATE member_ai_usage_attempts_v2 SET metadata_json=? WHERE id=?').bind(first.row.metadata_json,first.row.id).run();
      // Synthetic authoritative terminal receipt: removing one reviewed row
      // from physical exposure must not invalidate the independent other row.
      await f.db.prepare("UPDATE member_ai_usage_attempts_v2 SET provider_outcome='succeeded',provider_status='succeeded',status='finalizing' WHERE id=? AND dispatch_token=?")
        .bind(first.row.id,first.token).run();
      const after=await acquireImageGenerationSlot(f.env,waiting);check(after,'A resolved original tuple does not invalidate other per-record reviews');
      await finishImageGenerationSlot(f.env,after,{confirmed:true});
      const current=await legacy('current',false),next=await registerImageGenerationSlot(f.env,{usagePolicy:{mode:'admin'},userId:f.owner,modelId:MODEL});
      f.env.IMAGE_GENERATION_LEGACY_REVIEW_JSON=JSON.stringify({...review,reviewedAt:new Date().toISOString(),unknown:[...review.unknown,current.hash]});
      check(!await acquireImageGenerationSlot(f.env,next),'Even a listed digest never excludes a currently dispatched legacy request');
      f.env.IMAGE_GENERATION_LEGACY_REVIEW_JSON=JSON.stringify(review);
      await markMemberAiUsageAttemptUnknown(f.env,current.row.id,{dispatchToken:current.token});
      check(!await acquireImageGenerationSlot(f.env,next),'A new unreviewed unknown still consumes physical capacity');
      const replay=await beginMemberAiUsageAttempt(second.input);
      check(replay.attempt.id===second.row.id&&replay.attempt.providerOutcome==='unknown','Review never permits a new paid identity for historical uncertainty');
      check((await f.db.prepare('SELECT COUNT(*) n FROM member_credit_ledger WHERE user_id=? AND amount<0').bind(f.owner).first()).n===1,'Only the one genuinely completed new image is debited');
      return {reviewedUnknown:2,historicalFinancialStateUnchanged:true,currentDispatchBlocked:true,newUnknownBlocked:true,tupleGuard:true,independentReviews:true,providerCalls:1};
    } finally {for(const call of barrier.calls)call.resolve({image:media.imageBase64});await Promise.allSettled(barrier.tasks);await cleanup(f);}
  }
  if(name==='claim-recovery') {
    const f=await fixture(base,name,2,2),barrier=providerBarrier(f,media);
    try {
      const jobs=await start(f),slot=await f.db.prepare('SELECT * FROM image_generation_slots WHERE job_id=?').bind(jobs[0].id).first();
      const failed=await acquireImageGenerationSlot(f.env,slot);check(failed,'Original undispatched capacity grant');
      await finishImageGenerationSlot(f.env,failed);
      check((await f.db.prepare('SELECT state FROM image_generation_slots WHERE id=?').bind(slot.id).first()).state==='waiting','An undispatched worker failure releases the claim for its original job');
      const resumed=await acquireImageGenerationSlot(f.env,slot);check(resumed&&resumed.token!==failed.token,'Safe retry retains original reservation/slot with a fresh fenced lease');
      await finishImageGenerationSlot(f.env,failed,{confirmed:true});
      check((await f.db.prepare('SELECT token FROM image_generation_slots WHERE id=?').bind(slot.id).first()).token===resumed.token,'An earlier finished claim cannot release a successor');
      await finishImageGenerationSlot(f.env,resumed);
      await barrier.begin(jobs[0]);
      const visible=await publicAgentRun(f.env,await f.db.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(f.run.id).first());
      check(visible.mediaProgress.generating===1&&visible.mediaProgress.waiting===1&&visible.mediaProgress.saved===0&&visible.mediaProgress.blocked===0,
        'Public progress counts actual provider dispatch separately from the original waiting job');
      await f.db.prepare('UPDATE image_generation_slots SET lease_until=? WHERE id=?').bind('2000-01-01T00:00:00Z',slot.id).run();
      let outcome;try{await acquireImageGenerationSlot(f.env,slot);}catch(error){outcome=error.code;}
      check(outcome==='generation_provider_outcome_unknown','An expired dispatched identity enters outcome review, never normal scheduling retry');
      check((await f.db.prepare('SELECT state FROM image_generation_slots WHERE id=?').bind(slot.id).first()).state==='unknown','Uncertain acceptance retains its original capacity');
      await queue(f,{type:'member_generation.process',job_id:jobs[0].id});
      check(barrier.calls.length===1,'Concurrent redelivery cannot repeat an original accepted provider call');
      await barrier.finish();
      const saved=await f.db.prepare('SELECT status,asset_id FROM member_generation_jobs WHERE id=?').bind(jobs[0].id).first();
      check(saved.status==='succeeded'&&saved.asset_id,'The original late result completes its existing job');
      check((await f.db.prepare('SELECT state FROM image_generation_slots WHERE id=?').bind(slot.id).first()).state==='finished','Confirmed original terminal evidence releases the unknown slot');
      const budget=await readCanvasAgentBudget(f.env,await f.db.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(f.run.id).first());
      check(budget.chargedCredits===f.price.credits&&budget.reservedCredits===f.price.credits,'One settled original debit and one untouched sibling reservation remain authoritative');
      return {undispatchedRetry:true,expiredDispatchReview:true,providerCalls:1,progress:{generating:1,waiting:1},lateResultSaved:true};
    } finally {for(const call of barrier.calls)call.resolve({image:media.imageBase64});await Promise.allSettled(barrier.tasks);await cleanup(f);}
  }
  if(name==='scope-limits') {
    const f=await fixture(base,name,1),env=f.env;let secondProject;
    try {
      const created=await f.request('/api/account/canvas/projects','POST',{title:'Second concurrent project',locale:'en'});
      const projectBody=await created.json();check(created.ok,'Owned second project');secondProject=projectBody.data.project.id;
      const response=await f.request(`/api/account/canvas/projects/${secondProject}/nodes`,'POST',{type:'image_generation',model_id:MODEL,config:{prompt:'Second project dog'}});
      const body=await response.json();check(response.ok,'Ordinary second-project node');
      const slotFor=async(projectId,nodeId,key)=>{
        const id=(await sha256Hex(f.owner+key)).slice(0,32),now=new Date().toISOString();
        await f.db.prepare(`INSERT INTO canvas_runs(id,project_id,node_id,user_id,model_id,operation_type,status,idempotency_key,input_json,created_at,updated_at)
          VALUES(?,?,?,?,?,'canvas.image.generate','queued',?,'{}',?,?)`).bind(id,projectId,nodeId,f.owner,MODEL,key,now,now).run();
        return registerImageGenerationSlot(env,{usagePolicy:{mode:'admin'},userId:f.owner,modelId:MODEL,canvasRunId:id});
      };
      env.IMAGE_GENERATION_CAPACITY_JSON=policy({global:3,user:3,project:1,providers:{'workers-ai':3,openai:3}});
      const one=await slotFor(f.project,f.nodes[0],'scope-one'),same=await slotFor(f.project,f.nodes[0],'scope-same'),other=await slotFor(secondProject,body.data.node.id,'scope-other');
      const first=await acquireImageGenerationSlot(env,one);check(first,'First project receives capacity');await dispatchImageGenerationSlot(env,first);
      check(!await acquireImageGenerationSlot(env,same),'Project limit independently blocks a second image even with free user/global/provider capacity');
      const second=await acquireImageGenerationSlot(env,other);check(second,'The same user may run an independently eligible other project');await finishImageGenerationSlot(env,second,{confirmed:true});
      env.IMAGE_GENERATION_CAPACITY_JSON=policy({global:3,user:3,project:3,providers:{'workers-ai':1,openai:3}});
      check(!await acquireImageGenerationSlot(env,same),'Provider-specific maximum independently blocks a request');
      const another=await registerImageGenerationSlot(env,{usagePolicy:{mode:'admin'},userId:f.owner,modelId:'openai/gpt-image-2'});
      const different=await acquireImageGenerationSlot(env,another);check(different,'An eligible different provider is not blocked by the busy provider');await dispatchImageGenerationSlot(env,different);
      await finishImageGenerationSlot(env,first,{confirmed:true});
      env.IMAGE_GENERATION_CAPACITY_JSON=policy({global:1,user:3,project:3,providers:{'workers-ai':3,openai:3}});
      check(!await acquireImageGenerationSlot(env,same),'Lowered global capacity applies atomically without interrupting an accepted sibling');
      await finishImageGenerationSlot(env,different,{confirmed:true});
      const resumed=await acquireImageGenerationSlot(env,same);check(resumed,'Original waiting slot resumes when every independent gate permits');await finishImageGenerationSlot(env,resumed,{confirmed:true});
      return {independentProjectGate:true,independentProviderGate:true,independentGlobalGate:true,paidCalls:0};
    } finally {await cleanup(f);if(secondProject)await f.db.prepare('DELETE FROM canvas_projects WHERE id=?').bind(secondProject).run();}
  }
  if(name==='rate-admission') {
    const RealDate=globalThis.Date;let clock=RealDate.now()-RealDate.now()%3600000+10*60000;
    globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
    let f;
    try {
      f=await fixture(base,name,2,2);
      for(let i=0;i<20;i++)check(!(await evaluateSharedRateLimit(f.env,'ai-generate-user',f.owner,20,3600000,sensitiveRateLimitOptions())).limited,'Existing image hourly allowance remains twenty');
      f.env.AI={run(){throw new Error('Rate-limited admission must never dispatch');}};
      await queue(f,{type:'canvas_agent.process',run_id:f.run.id});
      const run=await f.db.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(f.run.id).first();
      check(run.status==='running'&&run.phase==='waiting_limit'&&Date.parse(run.next_attempt_at)>clock,'Known pre-dispatch rate limit schedules a durable wait');
      const original=await f.db.prepare("SELECT * FROM canvas_runs WHERE project_id=? AND error_code='canvas_agent_admission_wait'").bind(f.project).first();
      check(original&&!original.usage_attempt_id,'A genuine admission429 owns no paid attempt');
      check((await f.db.prepare('SELECT COUNT(*) n FROM member_generation_jobs WHERE user_id=?').bind(f.owner).first()).n===0,'Rate-limited work never masquerades as an accepted provider job');
      await queue(f,{type:'canvas_agent.process',run_id:f.run.id});
      clock=Date.parse(run.next_attempt_at)+1;
      const jobs=await start(f);check(jobs.length===2,'Original bounded cohort is admitted after the real limiter boundary');
      const resumed=await f.db.prepare('SELECT id,idempotency_key FROM canvas_runs WHERE id=?').bind(original.id).first();
      check(resumed.idempotency_key===original.idempotency_key,'Backoff retains exact original node/request identity');
      return {hourlyAllowance:20,paidCalls:0,waitResumed:true,admittedAfterReset:2};
    } finally {if(f)await cleanup(f);globalThis.Date=RealDate;}
  }
  if(name==='out-of-order') {
    const f=await fixture(base,name,3,2),barrier=providerBarrier(f,media);
    try {
      const jobs=await start(f);for(const job of jobs)await barrier.begin(job);
      barrier.calls[1].resolve({image:media.imageBase64});await barrier.tasks[1];
      const later=await f.db.prepare('SELECT * FROM member_generation_jobs WHERE id=?').bind(jobs[1].id).first();
      const laterRun=await f.db.prepare('SELECT * FROM canvas_runs WHERE id=?').bind(later.canvas_run_id).first();
      const node=await f.db.prepare('SELECT asset_id,title,config_json FROM canvas_nodes WHERE id=?').bind(laterRun.node_id).first();
      check(later.status==='succeeded'&&node.asset_id===later.asset_id&&laterRun.asset_id===later.asset_id,'A later output attaches only to its original job/run/node');
      const image=await f.db.prepare('SELECT prompt FROM ai_images WHERE id=?').bind(later.asset_id).first();
      const originalInput=await new Response((await f.env.USER_IMAGES.get(later.input_r2_key)).body).json();
      check(image.prompt==='A red dog','Existing three-word asset naming remains intact');
      check(originalInput.prompt===barrier.calls[1].input.prompt&&originalInput.prompt===JSON.parse(node.config_json).prompt,
        'Retained creative prompt belongs to the exact original node/provider input');
      const earlier=await f.db.prepare('SELECT status,asset_id FROM member_generation_jobs WHERE id=?').bind(jobs[0].id).first();
      check(earlier.status==='processing'&&!earlier.asset_id,'A completed sibling never completes the unfinished first operation');
      barrier.calls[0].reject(Object.assign(new Error('Synthetic ambiguous provider429'),{status:429}));await barrier.tasks[0];
      await queue(f,{type:'member_generation.process',job_id:jobs[0].id});
      const unknown=await f.db.prepare('SELECT status FROM member_generation_jobs WHERE id=?').bind(jobs[0].id).first();
      check(unknown.status==='outcome_unknown'&&barrier.calls.length===2,'Provider429 without verified no-inference evidence remains unknown, never an admission retry');
      const budget=await readCanvasAgentBudget(f.env,await f.db.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(f.run.id).first());
      check(budget.chargedCredits===f.price.credits&&budget.pendingOutcomeCredits===f.price.credits,'One actual sibling debit and one unknown commitment are counted separately');
      return {outOfOrderMapped:true,savedSibling:1,unknownSibling:1,providerCalls:2};
    } finally {for(const call of barrier.calls)call.resolve({image:media.imageBase64});await Promise.allSettled(barrier.tasks);await cleanup(f);}
  }
  if(name==='capacity-wait') {
    const f=await fixture(base,name,2,2),other=await fixture(base,name+'-manual',1,2),barrier=providerBarrier(f,media);
    try {
      const jobs=await start(f);for(const job of jobs)await barrier.begin(job);
      const response=await other.request(`${other.projectPath}/nodes/${other.nodes[0]}/run`,'POST',{}, {'Idempotency-Key':'manual-image-capacity-fallback'});
      const body=await response.json();check(response.status===202,`A manual Canvas wait retains its existing identity as a supported job: ${response.status}/${body.code}`);
      const waiting=await f.db.prepare('SELECT * FROM member_generation_jobs WHERE user_id=?').bind(other.owner).first();check(waiting,'One ordinary durable fallback job');
      for(let i=0;i<10;i++) {
        await f.db.prepare('UPDATE member_generation_jobs SET next_attempt_at=? WHERE id=?').bind('2000-01-01T00:00:00Z',waiting.id).run();
        await queue(f,{type:'member_generation.process',job_id:waiting.id});
      }
      const held=await f.db.prepare('SELECT * FROM member_generation_jobs WHERE id=?').bind(waiting.id).first();
      check(held.status==='queued'&&held.error_code==='image_generation_capacity_wait'&&held.attempt_count===0,'Ten capacity waits consume no provider/recovery attempts');
      check(barrier.calls.length===2,'A full shared account does not dispatch the waiting manual job');
      barrier.calls[0].resolve({image:media.imageBase64});await barrier.tasks[0];
      await f.db.prepare('UPDATE member_generation_jobs SET next_attempt_at=? WHERE id=?').bind('2000-01-01T00:00:00Z',waiting.id).run();
      await barrier.begin(waiting);await barrier.finish();
      const saved=await f.db.prepare('SELECT status,asset_id FROM member_generation_jobs WHERE id=?').bind(waiting.id).first();
      check(saved.status==='succeeded'&&saved.asset_id,'Waiting original job completes after capacity becomes available');
      const node=await f.db.prepare('SELECT asset_id FROM canvas_nodes WHERE id=?').bind(other.nodes[0]).first();
      check(node.asset_id===saved.asset_id,'Manual Canvas fallback attaches the exact saved image to its ordinary node');
      check((await f.db.prepare('SELECT COUNT(*) n FROM member_ai_usage_attempts_v2 WHERE user_id=?').bind(other.owner).first()).n===1,'Waiting/retries retain one reservation and one paid identity');
      return {overlappingAccepted:2,capacityWaits:10,providerCalls:3,manualImageSaved:true};
    } finally {for(const call of barrier.calls)call.resolve({image:media.imageBase64});await Promise.allSettled(barrier.tasks);await cleanup(f);await cleanup(other);}
  }
  if(name==='capacity-recovery') {
    const f=await fixture(base,name,1,1),env=f.env;
    try {
      env.IMAGE_GENERATION_CAPACITY_JSON=policy({global:1,user:1,project:1,providers:{'workers-ai':1}});
      const jobs=await start(f),slot=await f.db.prepare('SELECT * FROM image_generation_slots WHERE job_id=?').bind(jobs[0].id).first();
      const old=await acquireImageGenerationSlot(env,slot);check(old,'First finite lease');
      await f.db.prepare('UPDATE image_generation_slots SET lease_until=? WHERE id=?').bind('2000-01-01T00:00:00Z',slot.id).run();
      const current=await acquireImageGenerationSlot(env,slot);check(current&&current.token!==old.token,'Only an undispatched expired lease can be replaced');
      await finishImageGenerationSlot(env,old,{confirmed:true});
      check((await f.db.prepare('SELECT state,token FROM image_generation_slots WHERE id=?').bind(slot.id).first()).token===current.token,'A stale worker cannot release its successor capacity');
      await dispatchImageGenerationSlot(env,current);
      await f.db.prepare('UPDATE image_generation_slots SET lease_until=? WHERE id=?').bind('2000-01-01T00:00:00Z',slot.id).run();
      const other=await registerImageGenerationSlot(env,{usagePolicy:{mode:'admin'},userId:f.foreign,modelId:MODEL});
      check(!await acquireImageGenerationSlot(env,other),'Expired dispatch intent remains held without a receipt');
      check((await f.db.prepare('SELECT state FROM image_generation_slots WHERE id=?').bind(slot.id).first()).state==='unknown','Lease expiry is not evidence of provider failure');
      await finishImageGenerationSlot(env,current,{confirmed:true});
      const second=await acquireImageGenerationSlot(env,other);check(second,'Late terminal evidence safely frees original capacity');await finishImageGenerationSlot(env,second,{confirmed:true});
      const usage=await beginMemberAiUsageAttempt({env,userId:f.owner,featureKey:'ai.image.generate',operationKey:'member.image.generate',route:'/api/ai/generate-image',
        idempotencyKey:'synthetic-legacy-image-capacity',requestFingerprint:'f'.repeat(64),creditCost:1,metadata:{}});
      await markMemberAiUsageAttemptProviderRunning(env,usage.attempt.id);
      const after=await registerImageGenerationSlot(env,{usagePolicy:{mode:'admin'},userId:f.foreign,modelId:'openai/gpt-image-2'});
      check(!await acquireImageGenerationSlot(env,after),'Pre-upgrade dispatched usage without a slot still consumes shared account capacity');
      check((await f.db.prepare('SELECT provider_outcome FROM member_ai_usage_attempts_v2 WHERE id=?').bind(usage.attempt.id).first()).provider_outcome==='dispatched','Capacity checks never rewrite old provider outcomes');
      await f.db.prepare('DELETE FROM image_generation_slots WHERE user_id=?').bind(f.foreign).run();
      return {replacedUndispatchedLease:1,unknownHeld:true,legacyExposureCounted:true,paidCalls:0};
    } finally {await cleanup(f);}
  }
  if(name==='capacity-fairness') {
    const f=await fixture(base,name,0),env=f.env;
    try {
      for(const invalid of [undefined,'{}',policy({global:16}),policy({verifiedUntil:'2020-01-01'}),policy({reviewRef:''}),policy({providers:{invented:15}})]) {
        env.IMAGE_GENERATION_CAPACITY_JSON=invalid;const read=imageGenerationCapacity(env);check(!read.verified&&read.global===1&&read.reason==='image_capacity_unverified','Unknown limits cannot silently enable parallel dispatch');
      }
      env.IMAGE_GENERATION_CAPACITY_JSON=policy({global:2,user:1,project:1,providers:{'workers-ai':2,openai:1}});
      const slot=userId=>registerImageGenerationSlot(env,{usagePolicy:{mode:'admin'},userId,modelId:MODEL});
      const first=await slot(f.owner),second=await slot(f.owner),other=await slot(f.foreign);
      const claim=await acquireImageGenerationSlot(env,first);check(claim,'First eligible user gets a slot');await dispatchImageGenerationSlot(env,claim);
      check(!await acquireImageGenerationSlot(env,second),'Per-user/project maximum prevents monopolizing the shared pool');
      const fair=await acquireImageGenerationSlot(env,other);check(fair,'A second waiting user gets the remaining shared slot');
      await dispatchImageGenerationSlot(env,fair);check(!await acquireImageGenerationSlot(env,second),'Global maximum remains atomic');
      await finishImageGenerationSlot(env,claim,{confirmed:true});await finishImageGenerationSlot(env,fair,{confirmed:true});
      const next=await acquireImageGenerationSlot(env,second);check(next,'Waiting identity resumes after a terminal original receipt');
      await finishImageGenerationSlot(env,next,{confirmed:true});
      const contenders=await Promise.all([slot(f.owner),slot(f.owner)]);
      const claims=await Promise.all(contenders.map(item=>acquireImageGenerationSlot(env,item)));
      check(claims.filter(Boolean).length===1,'Concurrent native D1 admission cannot exceed user capacity');
      for(const item of claims)await finishImageGenerationSlot(env,item,{confirmed:true});
      await f.db.prepare('DELETE FROM image_generation_slots WHERE user_id=?').bind(f.foreign).run();
      return {conservativeDefault:1,atomicUserLimit:1,fairUsers:2,newPaidCalls:0};
    } finally {await cleanup(f);}
  }
  const count=name==='parallel-fifteen'?16:name==='manual-revision'?2:3,capacity=name==='parallel-fifteen'?15:2;
  const f=await fixture(base,name,count,capacity),barrier=providerBarrier(f,media);
  try {
    const jobs=await start(f);check(jobs.length===capacity,'Scheduler enqueues only the bounded independent cohort');
    check(barrier.calls.length===0,'Scheduler admission never invokes providers in its own request');
    if(name==='stop-budget') {
      const reservation=(await f.db.prepare('SELECT SUM(credit_cost) n FROM member_ai_usage_attempts_v2 WHERE user_id=?').bind(f.owner).first()).n;
      check(reservation===capacity*f.price.credits,'Ordinary atomic reservations match the admitted cohort');
      const response=await f.request(`${f.route}/${f.run.id}/control`,'POST',{action:'cancel'},{'Idempotency-Key':'image-stop-budget-control'});
      check(response.ok,'Authenticated production cancellation succeeds');
      for(const job of jobs)await queue(f,{type:'member_generation.process',job_id:job.id});
      check(barrier.calls.length===0,'Cancelled authority cannot dispatch even already queued images');
      const budget=await readCanvasAgentBudget(f.env,await f.db.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(f.run.id).first());
      check(budget.chargedCredits===0&&budget.committedCredits<=f.run.budget_credits,'No cancelled work consumes unapproved budget');
      return {acceptedJobs:capacity,providerCalls:0,stoppedBeforeDispatch:true};
    }
    for(const job of jobs)await barrier.begin(job);
    check(barrier.calls.length===capacity,'All independent provider operations overlap before any finishes');
    check((await f.db.prepare("SELECT COUNT(*) n FROM image_generation_slots WHERE user_id=? AND state='active'").bind(f.owner).first()).n===capacity,'Durable capacity matches real in-flight provider calls');
    // Duplicate queue delivery and a duplicate agent wake cannot re-dispatch.
    await queue(f,{type:'member_generation.process',job_id:jobs[0].id});
    await f.db.prepare('UPDATE canvas_agent_runs SET next_attempt_at=? WHERE id=?').bind('2000-01-01T00:00:00Z',f.run.id).run();
    await queue(f,{type:'canvas_agent.process',run_id:f.run.id});
    check(barrier.calls.length===capacity,'Duplicate wakes preserve all original paid identities');
    if(name==='unknown-fence') {
      barrier.calls[0].reject(new Error('Synthetic interrupted provider acceptance'));
      barrier.calls[1].resolve({image:media.imageBase64});await Promise.all(barrier.tasks);
      const unknown=await f.db.prepare('SELECT status FROM member_generation_jobs WHERE id=?').bind(jobs[0].id).first();
      check(unknown.status==='outcome_unknown','Uncertain provider acceptance remains reviewable');
      check((await f.db.prepare("SELECT COUNT(*) n FROM image_generation_slots WHERE user_id=? AND state='unknown'").bind(f.owner).first()).n===1,'Unknown acceptance retains one account slot');
      await queue(f,{type:'member_generation.process',job_id:jobs[0].id});check(barrier.calls.length===2,'Unknown provider identity is never resubmitted');
      return {acceptedCalls:2,unknownHeld:1,newRetries:0};
    }
    if(name==='manual-revision') {
      const response=await f.request(`${f.projectPath}/nodes/${f.nodes[0]}`,'PATCH',{config:{prompt:'User replacement prompt'}});
      check(response.ok,'Ordinary manual editing remains available');
    }
    await barrier.finish();
    const saved=(await f.db.prepare('SELECT status,asset_id FROM member_generation_jobs WHERE user_id=?').bind(f.owner).all()).results;
    check(saved.every(row=>row.status==='succeeded'&&row.asset_id),'Every original result is saved independently');
    const attempts=(await f.db.prepare('SELECT metadata_json FROM member_ai_usage_attempts_v2 WHERE user_id=?').bind(f.owner).all()).results;
    check(attempts.every(row=>JSON.parse(row.metadata_json).canvas_agent?.run_id===f.run.id),'Finalization preserves project budget ownership');
    const current=await f.db.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(f.run.id).first(),budget=await readCanvasAgentBudget(f.env,current);
    check(budget.chargedCredits===capacity*f.price.credits&&budget.reservedCredits===0,'Out-of-order completed outputs are charged once in the authoritative project budget');
    const nodes=(await f.db.prepare('SELECT id,config_json,asset_id FROM canvas_nodes WHERE project_id=?').bind(f.project).all()).results;
    if(name==='manual-revision') {
      check(current.status==='paused'&&nodes.every(row=>!row.asset_id),'Late accepted outputs cannot overwrite a manual takeover');
      check(JSON.parse(nodes.find(row=>row.id===f.nodes[0]).config_json).prompt==='User replacement prompt','New user prompt remains authoritative');
      return {overlappingAccepted:2,retainedAssets:2,manualEditPreserved:true,duplicateCalls:0};
    }
    check(nodes.filter(row=>row.asset_id).length===15&&current.status==='running','Independent sibling results attach to ordinary editable nodes without pausing one another');
    check((await f.db.prepare('SELECT revision FROM canvas_projects WHERE id=?').bind(f.project).first()).revision===f.run.expected_revision,'Output completion does not invent a creative revision');
    return {overlappingAccepted:15,persistedImages:15,originalJobs:15,duplicateCalls:0,budgetCharged:budget.chargedCredits};
  } finally {for(const call of barrier.calls)call.resolve({image:media.imageBase64});await Promise.allSettled(barrier.tasks);await cleanup(f);}
}
