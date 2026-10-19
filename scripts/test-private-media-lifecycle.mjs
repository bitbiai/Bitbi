// Exercise the pinned SDK's real stream accounting and the production subclass.
// Only platform transport/storage are simulated; no provider or remote binding.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {build} from '../workers/auth/node_modules/esbuild/lib/main.js';

assert.equal(JSON.parse(fs.readFileSync('workers/media/node_modules/@cloudflare/containers/package.json')).version,'0.3.7');
const bundle=await build({entryPoints:['workers/media/src/index.js'],bundle:true,write:false,format:'cjs',platform:'node',plugins:[{
  name:'platform-only',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'platform',namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export class DurableObject {constructor(ctx,env){this.ctx=ctx;this.env=env;}} export class WorkerEntrypoint {}'}));},
}]});
class PlatformResponse extends Response {get webSocket(){return null;}}
// Platform alarm time is advanced explicitly below; the SDK idle wait merely
// yields in this deterministic fixture. The image test keeps real process time.
const clock={now:1000};class Clock extends Date {static now(){return clock.now;}}
let transportFixture;
const authFetch=async(url,init)=>{
  assert.equal(url,'https://bitbi.ai/api/internal/homepage/hero-videos/private-media/runner');
  assert.equal(init.headers.Authorization,'Bearer synthetic-only');
  const request=JSON.parse(init.body),f=transportFixture;f.authority.push(request.action);
  if(f.authorityError)throw f.authorityError;
  if(f.staleToken===request.token)return Response.json({ok:true,data:{protocol:1,state:'stale'}});
  if(f.legacy)return Response.json({ok:false,code:'media_runner_invalid'},{status:409});
  if(request.action==='delivery_failed'&&f.activation==='pending')f.activation='blocked';
  return Response.json({ok:true,data:{protocol:1,state:f.activation}});
};
const scope={fetch:authFetch,module:{exports:{}},Response:PlatformResponse,Request,URL,IdentityTransformStream:TransformStream,Date:Clock,console,crypto,AbortSignal,setTimeout:(fn,ms)=>setTimeout(fn,Math.min(ms,1)),clearTimeout};
vm.runInNewContext(bundle.outputFiles[0].text,scope);
const {PrivateMediaContainer}=scope.module.exports;
const fixtures=[];
async function fixture({realSchedules=false}={}) {
  const data=new Map([['__CF_CONTAINER_STATE',{status:'healthy'}]]),initial=[];
  const f={busy:false,status:200,health:null,signals:[],requests:[],scheduled:[],blocked:false,activation:'pending',authority:[]};
  transportFixture=f;
  f.container={running:false,getTcpPort:()=>({fetch:async url=>{
    f.requests.push(new URL(url).pathname);if(f.hold)await f.hold;
    if(f.transportError)throw f.transportError;
    if(new URL(url).pathname==='/wake'&&f.status<300&&!f.keepPending)f.activation='running';
    const body=new URL(url).pathname==='/health'?(f.health??{protocol:1,busy:f.busy,source:'a'.repeat(40)}):{accepted:true};
    return new PlatformResponse(JSON.stringify(body),{status:f.status});
  }}),signal:signal=>{f.signals.push(signal);if(!f.exit)f.container.running=false;},monitor:async()=>{if(f.exit)await f.exit;}};
  const db=new DatabaseSync(':memory:');f.db=db;
  const storage={get:async k=>structuredClone(data.get(k)),put:async(k,v)=>data.set(k,structuredClone(v)),kv:{get:()=>undefined},sql:{exec:(query,...values)=>{const statement=db.prepare(query);if(statement.columns().length)return statement.all(...values);statement.run(...values);return [];}},setAlarm:async()=>{},sync:async()=>{},deleteAlarm:async()=>{}};
  const ctx={container:f.container,storage,blockConcurrencyWhile:fn=>{const p=Promise.resolve().then(fn);initial.push(p);f.gate=p;return p;}};
  f.object=new PrivateMediaContainer(ctx,{SOURCE_SHA:'a'.repeat(40),PRIVATE_MEDIA_PROCESSOR_SECRET:'synthetic-only'});
  await Promise.all(initial);f.container.running=true;
  f.state=()=>data.get('private-media-delivery');
  if(!realSchedules){f.object.listSchedules=async()=>f.scheduled;f.object.schedule=async(delay,callback,payload)=>{f.scheduled.push({delay,callback,payload});};}
  f.object.startAndWaitForPorts=async()=>{f.container.running=true;await f.object.state.setHealthy();};
  f.external=async fn=>{await f.gate;return fn();};
  fixtures.push(f);return f;
}
const expire=f=>{clock.now+=31_000;return f.object.isActivityExpired();};

// SDK 0.3.7 detaches pipeTo(...).finally(decrementInflight). A failed source
// body reaches deliver's catch AND rejects that detached promise. Strict Node
// terminates on the latter, unlike an awaited application exception. Preserve
// this real SDK boundary in an isolated process; never suppress rejections or
// turn a process failure alone into evidence that durable recovery succeeded.
const bodyMarker='private-media-sdk-body-recovery';
function verifyBodyFailureChild(result) {
  assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,1);
  const markers=result.stdout.split('\n').flatMap(line=>{try{const row=JSON.parse(line);return row.test===bodyMarker?[row]:[];}catch{return [];}});
  assert.deepEqual(markers,[{test:bodyMarker,state:'retrying',stage:'acknowledgement',httpStatus:202,errorCode:'media_delivery_transport',attempt:1,schedules:1,inflight:0}],
    'Body interruption must preserve its exact durable recovery before the detached SDK rejection');
  assert.match(result.stderr,/Error: body interrupted/);
  assert.match(result.stderr,/at PrivateMediaContainer\.containerFetch/);
  assert(!result.stderr.includes('AssertionError'),'A failed recovery assertion is not an expected SDK rejection');
}
function verifyBodyFailure() {
  const child=broken=>spawnSync(process.execPath,['--unhandled-rejections=strict',fileURLToPath(import.meta.url),'--sdk-body-child',...(broken?['--missing-retry']:[])],{
    cwd:process.cwd(),encoding:'utf8',timeout:30000,env:{...process.env,NODE_OPTIONS:''},
  });
  verifyBodyFailureChild(child(false));
  const broken=child(true);
  assert.equal(broken.error,undefined);assert.equal(broken.status,1);
  assert.match(broken.stderr,/Body interruption replacement schedule is required/);
  assert.throws(()=>verifyBodyFailureChild(broken),/exact durable recovery/);
  console.log(JSON.stringify({test:'private-media-sdk-body-failure',sdk:'0.3.7',durableRetry:true,inflightReleased:true,detachedRejectionObserved:true,missingRetryRejected:true}));
}
if(process.argv.includes('--sdk-body-child')) {
  const f=await fixture({realSchedules:true});
  await f.object.fetch(new Request('http://actor/wake',{method:'POST',body:JSON.stringify({token:'2'.repeat(32)})}));
  if(process.argv.includes('--missing-retry'))f.object.schedule=async()=>{};
  f.container.getTcpPort=()=>({fetch:async()=>new PlatformResponse(new ReadableStream({start(controller){controller.error(Error('body interrupted'));}}),{status:202})});
  const activityExpired=f.object.isActivityExpired.bind(f.object);
  f.object.isActivityExpired=()=>{
    // This actual SDK boundary follows callback completion and deletion of its
    // original SQL schedule, before the alarm's idle timer yields to Node's
    // rejection reporting. Observe it without changing the idle decision.
    const state=f.state(),schedules=f.db.prepare("SELECT payload FROM container_schedules WHERE callback='deliver'").all();
    assert.equal(schedules.length,1,'Body interruption replacement schedule is required');
    assert.equal(JSON.parse(schedules[0].payload).token,'2'.repeat(32),'Retry must retain the original activation');
    console.log(JSON.stringify({test:bodyMarker,state:state.state,stage:state.stage,httpStatus:state.httpStatus,errorCode:state.errorCode,attempt:state.attempt,schedules:schedules.length,inflight:f.object.inflightRequests}));
    return activityExpired();
  };
  await f.object.alarm();
  // Let strict Node report the exact SDK promise. Returning early or forcing
  // a successful process exit would conceal the independently observed defect.
  await new Promise(setImmediate);
  throw Error('Expected detached SDK body rejection was not observed');
} else if(process.argv.includes('--body-fault-only')) {
  assert.deepEqual(process.argv.slice(2),['--body-fault-only']);
  verifyBodyFailure();
} else {

// Red control reproduces the original deliver method, including its unconsumed
// response: successful HTTP != completed SDK request, even after hours idle.
const old=await fixture();
const response=await old.object.containerFetch('http://container/wake',{method:'POST'});
assert(response.ok);assert.equal(old.object.inflightRequests,1);
clock.now+=3*60*60_000;assert.equal(old.object.isActivityExpired(),false);
await response.arrayBuffer();await Promise.resolve();assert.equal(old.object.inflightRequests,0);
assert(expire(old));

const fixed=await fixture();await fixed.object.deliver({token:'a'.repeat(32)});
assert.equal(fixed.object.inflightRequests,0,'deliver must complete the SDK response stream');
assert.equal(fixed.object.sleepAfter,'30s');assert(expire(fixed));
fixed.busy=true;await fixed.object.onActivityExpired();assert.equal(fixed.signals.length,0,'active child must survive inactivity');
fixed.busy=false;fixed.scheduled=[{callback:'deliver'}];assert(expire(fixed));await fixed.object.onActivityExpired();
assert.equal(fixed.signals.length,0,'accepted queued wake must survive the idle boundary');
fixed.scheduled=[];assert(expire(fixed));await fixed.object.alarm();assert.deepEqual(fixed.signals,[15]);
await fixed.object.fetch(new Request('http://actor/wake',{method:'POST',body:JSON.stringify({token:'b'.repeat(32)})}));fixed.activation='pending';await fixed.object.deliver({token:'b'.repeat(32)});fixed.scheduled=[];assert(fixed.container.running,'later work starts the stopped container');
assert.equal(fixed.object.inflightRequests,0);assert(expire(fixed));await fixed.object.onActivityExpired();assert.deepEqual(fixed.signals,[15,15]);
for(const health of [{}, {protocol:1,busy:false,source:'wrong'}, {protocol:1,busy:'false',source:'a'.repeat(40)}]) {
  const f=await fixture();f.health=health;await f.object.onActivityExpired();assert.equal(f.signals.length,0);
}
const bad=await fixture();bad.status=503;await bad.object.deliver({token:'c'.repeat(32)});
assert.equal(bad.state().state,'retrying');assert.equal(bad.state().httpStatus,503);assert.equal(bad.scheduled.length,1);
assert.equal(bad.object.inflightRequests,0,'failure response also releases SDK accounting');
await bad.object.onActivityExpired();assert.equal(bad.signals.length,0);
const idle=await fixture();idle.container.running=false;await idle.object.onActivityExpired();assert.equal(idle.requests.length,0,'idle inspection never wakes a stopped container');
// A new actor can safely retire an idle instance from the previous source.
const previous=await fixture();previous.health={protocol:1,busy:false,source:'b'.repeat(40)};
await previous.object.onActivityExpired();assert.deepEqual(previous.signals,[15]);
// An incoming wake is held across the health/exit boundary, then durably queued.
const race=await fixture();let releaseHealth,releaseExit,accepted=false;
race.hold=new Promise(r=>{releaseHealth=r;});race.exit=new Promise(r=>{releaseExit=r;});
race.object.schedule=async(_delay,callback,payload)=>race.scheduled.push({callback,payload});
const stopping=race.object.onActivityExpired();
const arrival=race.external(async()=>{const response=await race.object.fetch(new Request('http://actor/wake',{method:'POST',body:JSON.stringify({token:'d'.repeat(32)})}));assert.equal(response.status,202);accepted=true;});
await new Promise(setImmediate);assert(!accepted);releaseHealth();
await new Promise(setImmediate);assert.deepEqual(race.signals,[15]);assert(!accepted,'wake must wait for process exit');
race.container.running=false;releaseExit();await stopping;await arrival;
assert.equal(race.scheduled.length,1);await race.object.deliver(race.scheduled[0].payload);
assert(race.container.running);assert.equal(race.object.inflightRequests,0);
console.log(JSON.stringify({test:'private-media-sdk-lifecycle' ,sdk:'0.3.7',oldLayoutLeaks:true,drained:true,activeProtected:true,queuedWakeProtected:true,stopWakeStop:true,unknownHealthProtected:true,errorDrained:true}));

// Exercise the installed SDK alarm dispatcher, including its unconditional
// deletion after callback exceptions. SQL schedules are real SQLite rows.
const wake=(f,token)=>f.object.fetch(new Request('http://actor/wake',{method:'POST',body:JSON.stringify({token})}));
const scheduled=await fixture({realSchedules:true});
scheduled.object.originalFailure=async()=>{throw Error('sanitized historical callback failure');};
await scheduled.object.schedule(0,'originalFailure',{});await scheduled.object.alarm();
assert.equal((await scheduled.object.listSchedules('originalFailure')).length,0,'Broken control: SDK deletes a failed callback; it does not retry it');
const token='1'.repeat(32);await wake(scheduled,token);await wake(scheduled,token);
assert.equal((await scheduled.object.listSchedules('deliver')).length,1,'Duplicate wake keeps one persisted delivery');
scheduled.status=409;await scheduled.object.alarm();
assert.equal(scheduled.state().state,'retrying');assert.equal(scheduled.state().errorCode,'media_container_busy');
assert.equal(scheduled.state().attempt,1);assert.equal((await scheduled.object.listSchedules('deliver')).length,1,'A replacement schedule survives deletion of the failed original');
assert.equal(scheduled.object.inflightRequests,0);
clock.now+=2000;scheduled.status=202;await scheduled.object.alarm();
assert.equal(scheduled.state().state,'running');assert.equal(scheduled.requests.filter(p=>p==='/wake').length,2);
assert.equal((await scheduled.object.listSchedules('deliver')).length,0);
await wake(scheduled,token);assert.equal((await scheduled.object.listSchedules('deliver')).length,0,'Acquired activation cannot spawn another child');
const safe=await (await scheduled.object.fetch(new Request('http://actor/status'))).json();
assert(safe.delivery.reference);assert(!JSON.stringify(safe).includes(token),'Status excludes dispatch credentials');

verifyBodyFailure();
for(const fault of ['http503','fetch','startup']) {
  const f=await fixture({realSchedules:true});await wake(f,'2'.repeat(32));
  if(fault==='http503')f.status=503;
  if(fault==='fetch')f.transportError=Error('untrusted secret payload must not be logged');
  if(fault==='startup'){f.container.running=false;f.object.startAndWaitForPorts=async()=>{throw Error('port not ready');};}
  await f.object.alarm();assert.equal(f.state().state,'retrying',fault);
  assert.equal((await f.object.listSchedules('deliver')).length,1,fault);
}
const exhausted=await fixture({realSchedules:true});exhausted.status=503;await wake(exhausted,'3'.repeat(32));
for(const delay of [0,2,5,15,30,60]){clock.now+=delay*1000;await exhausted.object.alarm();}
assert.equal(exhausted.state().state,'blocked');assert.equal(exhausted.state().attempt,6);
assert.equal(exhausted.requests.filter(p=>p==='/wake').length,6);assert.equal((await exhausted.object.listSchedules('deliver')).length,0);
assert.equal((await wake(exhausted,'3'.repeat(32))).status,409,'Exhaustion survives duplicate queue delivery');
const stale=await fixture({realSchedules:true});await wake(stale,'4'.repeat(32));stale.activation='stale';await stale.object.alarm();
assert.equal(stale.requests.filter(p=>p==='/wake').length,0,'Superseded or expired activation never starts a container');
const late=await fixture({realSchedules:true});await wake(late,'a'.repeat(32));late.staleToken='b'.repeat(32);await wake(late,late.staleToken);
assert.equal(late.state().token,'a'.repeat(32),'Late stale wake cannot overwrite the current scheduled activation');
await late.object.alarm();assert.equal(late.state().state,'running');assert.equal(late.requests.filter(p=>p==='/wake').length,1);
const overlap=await fixture();let releaseTransport;overlap.hold=new Promise(resolve=>{releaseTransport=resolve;});
const originalDelivery=overlap.object.deliver({token:'c'.repeat(32)});await new Promise(setImmediate);
await overlap.object.deliver({token:'c'.repeat(32)});releaseTransport();await originalDelivery;
assert.equal(overlap.requests.filter(p=>p==='/wake').length,1,'Concurrent same-token callbacks share one in-flight delivery');
const lost=await fixture({realSchedules:true});await wake(lost,'5'.repeat(32));lost.activation='running';await lost.object.alarm();
assert.equal(lost.requests.filter(p=>p==='/wake').length,0,'Acquisition reconciles a lost acknowledgement without another child');
const legacy=await fixture({realSchedules:true});legacy.legacy=true;await wake(legacy,'6'.repeat(32));await legacy.object.alarm();
assert.equal(legacy.state().state,'acknowledged','Compatible rollout retains the original child-owned D1 acquire fence');
assert.equal(legacy.requests.filter(p=>p==='/wake').length,1);
// Operator recovery is explicit, digest/reference-bound and replay-safe. Prior
// attempts remain intact; a new bounded window cannot start before Auth admits it.
transportFixture=exhausted;
const recoveryBody={token:'3'.repeat(32),requestId:'7'.repeat(32),jobId:'8'.repeat(32),reference:exhausted.state().reference};
const retry=body=>exhausted.object.fetch(new Request('http://actor/retry',{method:'POST',body:JSON.stringify(body)}));
assert.equal((await retry({...recoveryBody,reference:'stale'})).status,409);
assert.equal((await retry(recoveryBody)).status,202);assert.equal((await retry(recoveryBody)).status,202);
assert.equal(exhausted.state().attempt,6);assert.equal(exhausted.state().failures.length,1);
assert.equal((await exhausted.object.listSchedules('deliver')).length,0,'Prepared recovery cannot alarm before its Auth lease renewal');
assert.equal((await retry({...recoveryBody,jobId:'9'.repeat(32)})).status,409);
exhausted.activation='stale';clock.now+=2000;await exhausted.object.alarm();await wake(exhausted,recoveryBody.token);
assert.equal(exhausted.state().state,'prepared');assert.equal(exhausted.state().attempt,6);
assert.equal((await exhausted.object.listSchedules('deliver')).length,0,'Expired lease and delayed old wake leave the prepared operation intact');
exhausted.activation='pending';exhausted.status=503;await wake(exhausted,recoveryBody.token);
for(const delay of [0,2,5,15,30,60]){clock.now+=delay*1000;await exhausted.object.alarm();}
assert.equal(exhausted.state().state,'blocked');assert.equal(exhausted.state().attempt,12);assert.equal(exhausted.state().failures[0].attempt,6);
assert.equal((await retry(recoveryBody)).status,409,'Replay reports a failed recovery without approving another attempt window');
assert.equal((await exhausted.object.listSchedules('deliver')).length,0);
assert.equal((await retry({...recoveryBody,requestId:'9'.repeat(32)})).status,202);
exhausted.activation='pending';exhausted.status=202;await wake(exhausted,recoveryBody.token);await exhausted.object.alarm();
assert.equal(exhausted.state().state,'running');assert.equal(exhausted.state().failures.length,2);assert.equal(exhausted.state().attempt,13);

for(const f of fixtures)f.db.close();
console.log(JSON.stringify({test:'private-media-durable-delivery',sdk:'0.3.7',failedCallbackControl:true,duplicate:true,busyRetry:true,transientRetry:true,exhaustedBound:6,staleFenced:true,ackReconciled:true,oldAuthCompatible:true}));
}
