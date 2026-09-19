// Exercise the pinned SDK's real stream accounting and the production subclass.
// Only platform transport/storage are simulated; no provider or remote binding.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {build} from '../workers/auth/node_modules/esbuild/lib/main.js';

assert.equal(JSON.parse(fs.readFileSync('workers/media/node_modules/@cloudflare/containers/package.json')).version,'0.3.7');
const bundle=await build({entryPoints:['workers/media/src/index.js'],bundle:true,write:false,format:'cjs',platform:'node',plugins:[{
  name:'platform-only',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'platform',namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export class DurableObject {constructor(ctx,env){this.ctx=ctx;this.env=env;}} export class WorkerEntrypoint {}'}));},
}]});
class PlatformResponse extends Response {get webSocket(){return null;}}
const clock={now:1000};class Clock extends Date {static now(){return clock.now;}}
const scope={module:{exports:{}},Response:PlatformResponse,Request,URL,IdentityTransformStream:TransformStream,Date:Clock,console,crypto,AbortSignal,setTimeout,clearTimeout};
vm.runInNewContext(bundle.outputFiles[0].text,scope);
const {PrivateMediaContainer}=scope.module.exports;
const fixtures=[];
async function fixture() {
  const data=new Map([['__CF_CONTAINER_STATE',{status:'healthy'}]]),initial=[];
  const f={busy:false,status:200,health:null,signals:[],requests:[],scheduled:[],blocked:false};
  f.container={running:false,getTcpPort:()=>({fetch:async url=>{
    f.requests.push(new URL(url).pathname);if(f.hold)await f.hold;
    const body=new URL(url).pathname==='/health'?(f.health??{protocol:1,busy:f.busy,source:'a'.repeat(40)}):{accepted:true};
    return new PlatformResponse(JSON.stringify(body),{status:f.status});
  }}),signal:signal=>{f.signals.push(signal);if(!f.exit)f.container.running=false;},monitor:async()=>{if(f.exit)await f.exit;}};
  const storage={get:async k=>data.get(k),put:async(k,v)=>data.set(k,v),kv:{get:()=>undefined},sql:{exec:()=>[]},setAlarm:async()=>{},sync:async()=>{},deleteAlarm:async()=>{}};
  const ctx={container:f.container,storage,blockConcurrencyWhile:fn=>{const p=Promise.resolve().then(fn);initial.push(p);f.gate=p;return p;}};
  f.object=new PrivateMediaContainer(ctx,{SOURCE_SHA:'a'.repeat(40),PRIVATE_MEDIA_PROCESSOR_SECRET:'synthetic-only'});
  await Promise.all(initial);f.container.running=true;
  f.object.listSchedules=async()=>f.scheduled;
  f.object.startAndWaitForPorts=async()=>{f.container.running=true;await f.object.state.setHealthy();};
  f.external=async fn=>{await f.gate;return fn();};
  fixtures.push(f);return f;
}
const expire=f=>{clock.now+=31_000;return f.object.isActivityExpired();};

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
await fixed.object.deliver({token:'b'.repeat(32)});assert(fixed.container.running,'later work starts the stopped container');
assert.equal(fixed.object.inflightRequests,0);assert(expire(fixed));await fixed.object.onActivityExpired();assert.deepEqual(fixed.signals,[15,15]);
for(const health of [{}, {protocol:1,busy:false,source:'wrong'}, {protocol:1,busy:'false',source:'a'.repeat(40)}]) {
  const f=await fixture();f.health=health;await f.object.onActivityExpired();assert.equal(f.signals.length,0);
}
const bad=await fixture();bad.status=503;await assert.rejects(bad.object.deliver({token:'c'.repeat(32)}));
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
