const assert=(ok,message='Private media invariant failed')=>{if(!ok)throw Error(message);};
assert.equal=(a,b)=>assert(a===b,`Expected ${String(a)} to equal ${String(b)}`);
assert.deepEqual=(a,b)=>assert.equal(JSON.stringify(a),JSON.stringify(b));
assert.rejects=async(p,pattern)=>{try{await p;}catch(e){assert(pattern.test(String(e)+String(e.cause||'')),'Wrong rejection');return;}throw Error('Expected rejection');};
import worker from '../../workers/auth/src/index.js';
import { enqueueCanvasProcessing,claimCanvasProcessing } from '../../workers/auth/src/lib/canvas-video-processing.js';
import { privateMediaStatus,setPrivateMediaService,mediaRunner,dispatchPrivateMedia,recoverPrivateMedia,processorBackend,PRIVATE_MEDIA_WAKE } from '../../workers/auth/src/lib/private-media-service.js';
export async function privateMediaCase(base,{cookie}={}) {
  const now=new Date().toISOString(),owner='private-media-owner',project='9'.repeat(32),messages=[],starts=[];
  const env={...base,MEMVID_STREAM_PREVIEW_PROCESSOR_SECRET:'synthetic-github',PRIVATE_MEDIA_PROCESSOR_SECRET:'synthetic-container',
    AI_VIDEO_JOBS_QUEUE:{send:async body=>messages.push(body)},PRIVATE_MEDIA_PROCESSOR:{fetch:async(url,init)=>{
      if(new URL(url).pathname==='/status')return Response.json({protocol:1,functional_verified:true,version:'synthetic'});
      starts.push(JSON.parse(init.body));return Response.json({accepted:true},{status:202});
    }}};
  await env.DB.prepare("INSERT INTO users(id,email,password_hash,created_at,role) VALUES(?,?,?,?,'user')").bind(owner,'private-media@example.invalid','disabled',now).run();
  await env.DB.prepare('INSERT INTO canvas_projects(id,user_id,title,created_at,updated_at) VALUES(?,?,?,?,?)').bind(project,owner,'Synthetic',now,now).run();
  const node='8'.repeat(32),run='7'.repeat(32);
  await env.DB.prepare("INSERT INTO canvas_nodes(id,project_id,user_id,type,x,y,created_at,updated_at) VALUES(?,?,?,'video_generation',0,0,?,?)").bind(node,project,owner,now,now).run();
  await env.DB.prepare("INSERT INTO canvas_runs(id,project_id,node_id,user_id,model_id,operation_type,status,idempotency_key,input_json,created_at,updated_at) VALUES(?,?,?,?,'synthetic','canvas.video.generate','completed','synthetic','{}',?,?)").bind(run,project,node,owner,now,now).run();
  const add=(id)=>enqueueCanvasProcessing(env,{userId:owner,projectId:project,runId:run,kind:'concat',sources:[{assetId:id}]});
  const github=await add('old');assert.equal(github.processing_backend,'github');
  const switchResponse=await worker.fetch(new Request('https://bitbi.ai/api/admin/private-media/service',{
    method:'POST',headers:{Cookie:cookie,Origin:'https://bitbi.ai','Content-Type':'application/json','CF-Connecting-IP':'192.0.2.200'},
    body:JSON.stringify({backend:'cloudflare',reason:'Synthetic native switch'}),
  }),env,{waitUntil(){}});
  assert.equal(switchResponse.status,200);
  assert.equal((await switchResponse.json()).data.backend,'cloudflare');
  assert.equal((await privateMediaStatus(env)).backend,'cloudflare');
  const cloud=await add('new');assert.equal(cloud.processing_backend,'cloudflare');
  assert(messages.some(m=>m.type===PRIVATE_MEDIA_WAKE&&m.backend==='cloudflare'),'Immediate durable transport after insert');
  await assert.rejects(env.DB.prepare("UPDATE canvas_video_processing SET processing_backend='github' WHERE id=?").bind(cloud.id).run(),/media_backend_immutable/);
  const delivered={body:{type:PRIVATE_MEDIA_WAKE,backend:'cloudflare'},ack(){this.acked=true;},retry(){throw Error('Unexpected retry');}};
  await worker.queue({queue:'bitbi-ai-video-jobs',messages:[delivered]},env,{});assert(delivered.acked);assert.equal(starts.length,1);
  await Promise.all([dispatchPrivateMedia(env,'cloudflare'),dispatchPrivateMedia(env,'cloudflare')]);assert.equal(starts.length,1);
  const token=starts[0].token,runner='native-runner';await mediaRunner(env,'cloudflare',{token,runner,action:'acquire'});
  await assert.rejects(mediaRunner(env,'cloudflare',{token,runner:'duplicate',action:'acquire'}),/media_runner_claim_lost/);
  const claimed=await claimCanvasProcessing(env,'concat',10,'cloudflare');assert.deepEqual(claimed.map(r=>r.id),[cloud.id]);
  assert(!(await claimCanvasProcessing(env,'concat',10,'github')).some(r=>r.id===cloud.id));
  assert.equal(await processorBackend(env,new Request('https://test',{headers:{Authorization:'Bearer synthetic-github'}})),'github');
  assert.equal(await processorBackend(env,new Request('https://test',{headers:{Authorization:'Bearer synthetic-container'}})),'cloudflare');
  assert.equal(await processorBackend(env,new Request('https://test',{headers:{Authorization:'Bearer invalid'}})),null);
  // Arrival after the first job list must wake again at finish, not await cron.
  await add('arrived-after-claim');messages.length=0;
  await mediaRunner(env,'cloudflare',{token,runner,action:'finish'});assert.equal(messages.length,1);
  // Simulate a lost activation response. Do not dispatch again while its lease
  // survives; expiry replaces the token and fences a delayed original runner.
  env.PRIVATE_MEDIA_PROCESSOR.fetch=async()=>{throw Error('synthetic lost response');};
  assert.equal((await dispatchPrivateMedia(env,'cloudflare')).status,'retry');
  const lost=(await env.DB.prepare("SELECT token FROM private_media_dispatch WHERE backend='cloudflare'").first()).token;
  assert.equal((await dispatchPrivateMedia(env,'cloudflare')).status,'active');
  await env.DB.prepare("UPDATE private_media_dispatch SET lease_until='2000-01-01' WHERE backend='cloudflare'").run();
  assert.equal((await dispatchPrivateMedia(env,'cloudflare')).status,'retry');
  await assert.rejects(mediaRunner(env,'cloudflare',{token:lost,runner:'late',action:'acquire'}),/media_runner_claim_lost/);
  messages.length=0;await recoverPrivateMedia(env);assert(messages.some(m=>m.backend==='cloudflare'));
  await assert.rejects(setPrivateMediaService(env,{backend:'cloudflare',actor:owner,reason:'unavailable'}),/media_service_not_ready/);
  await env.DB.prepare("DELETE FROM app_settings WHERE key='private_media_service'").run();
  assert.equal((await env.DB.prepare('SELECT processing_backend FROM canvas_video_processing WHERE id=?').bind(cloud.id).first()).processing_backend,'cloudflare');
  return {immediateQueue:true,atomicAssignment:true,backendIsolation:true,duplicateStarts:0,lostResponseFenced:true,lateArrivalWoken:true};
}

export async function privateMediaSmokeCase(base,fixture) {
  const {privateMediaSmoke}=await import('../../workers/auth/src/lib/private-media-smoke.js');
  let verified=0;const sha='b'.repeat(40);
  const env={...base,PRIVATE_MEDIA_SOURCE_SHA:sha,MEMVID_STREAM_PREVIEW_PROCESSOR_SECRET:'synthetic-github',PRIVATE_MEDIA_PROCESSOR_SECRET:'synthetic-container',
    AI_VIDEO_JOBS_QUEUE:{send:async()=>{}},PRIVATE_MEDIA_PROCESSOR:{fetch:async()=>{verified++;return Response.json({verified:true});}}};
  const video=Uint8Array.from(atob(fixture.videoBase64),c=>c.charCodeAt(0)),image=Uint8Array.from(atob(fixture.imageBase64),c=>c.charCodeAt(0));
  const smokeRequest=(body,secret='synthetic-container')=>worker.fetch(new Request('https://bitbi.ai/api/internal/homepage/hero-videos/private-media/smoke',{
    method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify(body),
  }),env,{waitUntil(){}});
  for(const secret of ['invalid','synthetic-github'])assert.equal((await smokeRequest({sha,backend:'cloudflare',action:'start',fixture:fixture.videoBase64},secret)).status,403);
  const smoke=async body=>{const response=await smokeRequest(body);assert.equal(response.status,200);return (await response.json()).data;};
  await assert.rejects(privateMediaSmoke(env,{sha:'a'.repeat(40),backend:'cloudflare',action:'start',fixture:fixture.videoBase64}),/media_smoke_invalid/);
  await assert.rejects(privateMediaSmoke(env,{sha,backend:'cloudflare',action:'start',fixture:btoa('not-media')}),/media_smoke_invalid/);
  for(const backend of ['github','cloudflare']) {
    const body={sha,backend,action:'start',fixture:fixture.videoBase64};await smoke(body);await smoke(body);
    assert.equal((await smoke({sha,backend,action:'result'})).ready,false);
    const token=backend==='github'?'synthetic-github':'synthetic-container';
    const fetch=async(url,body,extra={})=>worker.fetch(new Request('https://bitbi.ai'+url,{method:'POST',headers:{Authorization:`Bearer ${token}`,...(body instanceof FormData?{}:{'Content-Type':'application/json'}),...extra},body:body instanceof FormData?body:JSON.stringify(body)}),env,{waitUntil(){}});
    const baseUrl='/api/internal/homepage/hero-videos/canvas-exports/jobs';
    const response=await fetch(baseUrl+'/claim',{protocol:1,limit:3});assert.equal(response.status,200);const job=(await response.json()).data.jobs.find(j=>j.sources.length===2);assert(job);
    const form=new FormData();form.set('video',new Blob([video],{type:'video/mp4'}),'synthetic.mp4');form.set('duration','2');form.set('width','320');form.set('height','180');
    const completed=await fetch(job.completion.url,form,{'X-BITBI-Canvas-Claim':job.claim});assert.equal(completed.status,200);
    const posterResponse=await fetch('/api/internal/homepage/hero-videos/source-posters/jobs/claim?member_only=true',{member_only:true,limit:8});assert.equal(posterResponse.status,200);
    for(const poster of (await posterResponse.json()).data.jobs) {
      const data=new FormData();data.set('poster',new Blob([image],{type:'image/png'}),'poster.png');
      const saved=await fetch(poster.completion.url,data,{'X-BITBI-Generation-Claim':poster.generation_claim});assert.equal(saved.status,200);
    }
    const result=await smoke({sha,backend,action:'result'});assert.equal(result.ready,true);assert.equal(result.outputs.length,3);
  }
  assert.equal(verified,1);return {bothBackends:true,firstAndContinuationAndExportPosters:true,repeatSeedSafe:true,noAI:true};
}
