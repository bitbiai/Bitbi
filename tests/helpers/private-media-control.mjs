const assert=(ok,message='Private media invariant failed')=>{if(!ok)throw Error(message);};
assert.equal=(a,b)=>assert(a===b,`Expected ${String(a)} to equal ${String(b)}`);
assert.deepEqual=(a,b)=>assert.equal(JSON.stringify(a),JSON.stringify(b));
assert.rejects=async(p,pattern)=>{try{await p;}catch(e){assert(pattern.test(String(e)+String(e.cause||'')),'Wrong rejection');return;}throw Error('Expected rejection');};
import {saveGeneratedVideoAsset} from '../../workers/auth/src/lib/ai-text-assets.js';
import {claimHeroPreview,ownsPublicPreview} from '../../workers/auth/src/lib/media-preview-jobs.js';
import worker from '../../workers/auth/src/index.js';
import { enqueueCanvasProcessing,claimCanvasProcessing } from '../../workers/auth/src/lib/canvas-video-processing.js';
import { privateMediaStatus,setPrivateMediaService,mediaRunner,dispatchPrivateMedia,recoverPrivateMedia,processorBackend,PRIVATE_MEDIA_WAKE } from '../../workers/auth/src/lib/private-media-service.js';
export async function privateMediaCase(base,{cookie,videoBase64,imageBase64}={}) {
  const now=new Date().toISOString(),owner='private-media-owner',project='9'.repeat(32),messages=[],starts=[];
  const env={...base,GITHUB_ACTIONS_DISPATCH_TOKEN:'synthetic',GITHUB_ACTIONS_DISPATCH_OWNER:'synthetic',GITHUB_ACTIONS_DISPATCH_REPO:'fixture',MEMVID_STREAM_PREVIEW_PROCESSOR_SECRET:'synthetic-github',PRIVATE_MEDIA_PROCESSOR_SECRET:'synthetic-container',
    AI_VIDEO_JOBS_QUEUE:{send:async body=>messages.push(body)},PRIVATE_MEDIA_PROCESSOR:{fetch:async(url,init)=>{
      if(new URL(url).pathname==='/status')return Response.json({protocol:1,functional_verified:true,preview_configured:true,version:'synthetic'});
      starts.push(JSON.parse(init.body));return Response.json({accepted:true},{status:202});
    }}};
  await env.DB.prepare("INSERT INTO users(id,email,password_hash,created_at,role) VALUES(?,?,?,?,'user')").bind(owner,'private-media@example.invalid','disabled',now).run();
  await env.DB.prepare('INSERT INTO canvas_projects(id,user_id,title,created_at,updated_at) VALUES(?,?,?,?,?)').bind(project,owner,'Synthetic',now,now).run();
  const node='8'.repeat(32),run='7'.repeat(32);
  await env.DB.prepare("INSERT INTO canvas_nodes(id,project_id,user_id,type,x,y,created_at,updated_at) VALUES(?,?,?,'video_generation',0,0,?,?)").bind(node,project,owner,now,now).run();
  await env.DB.prepare("INSERT INTO canvas_runs(id,project_id,node_id,user_id,model_id,operation_type,status,idempotency_key,input_json,created_at,updated_at) VALUES(?,?,?,?,'synthetic','canvas.video.generate','completed','synthetic','{}',?,?)").bind(run,project,node,owner,now,now).run();
  const add=(id)=>enqueueCanvasProcessing(env,{userId:owner,projectId:project,runId:run,kind:'concat',sources:[{assetId:id}]});
  const github=await add('old');assert.equal(github.processing_backend,'github');
  const configured=env.PRIVATE_MEDIA_PROCESSOR.fetch;
  env.PRIVATE_MEDIA_PROCESSOR.fetch=async()=>Response.json({protocol:1,functional_verified:true,preview_configured:false,version:'synthetic'});
  await setPrivateMediaService(env,{backend:'cloudflare',thumbnailBackend:'github',actor:owner,reason:'Assembly does not require Stream preview credentials'});
  await assert.rejects(setPrivateMediaService(env,{backend:'cloudflare',thumbnailBackend:'cloudflare',actor:owner,reason:'Missing Stream credential'}),/media_service_not_ready/);
  env.PRIVATE_MEDIA_PROCESSOR.fetch=configured;
  const switchResponse=await worker.fetch(new Request('https://bitbi.ai/api/admin/private-media/service',{
    method:'POST',headers:{Cookie:cookie,Origin:'https://bitbi.ai','Content-Type':'application/json','CF-Connecting-IP':'192.0.2.200'},
    body:JSON.stringify({backend:'cloudflare',thumbnailBackend:'github',reason:'Synthetic native switch'}),
  }),env,{waitUntil(){}});
  assert.equal(switchResponse.status,200);
  assert.equal((await switchResponse.json()).data.backend,'cloudflare');
  assert.equal((await privateMediaStatus(env)).backend,'cloudflare');
  const cloud=await add('new');assert.equal(cloud.processing_backend,'cloudflare');assert.equal(cloud.thumbnail_backend,'github');
  await assert.rejects(env.DB.prepare("UPDATE canvas_video_processing SET thumbnail_backend='cloudflare' WHERE id=?").bind(cloud.id).run(),/media_backend_immutable/);
  await setPrivateMediaService(env,{backend:'cloudflare',thumbnailBackend:'cloudflare',actor:owner,reason:'Independent poster switch'});
  const after=await add('post-switch');assert.equal(after.thumbnail_backend,'cloudflare');
  await env.DB.prepare("UPDATE canvas_video_processing SET status='ready' WHERE id=?").bind(after.id).run();
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
  // Public Hero preview and source poster use the same fenced transport and
  // existing private originals; the other backend cannot claim or complete them.
  env.ENABLE_HOMEPAGE_HERO_EXTERNAL_FFMPEG='true';
  env.HOMEPAGE_HERO_EXTERNAL_FFMPEG_SECRET='synthetic-github';
  const video=Uint8Array.from(atob(videoBase64),c=>c.charCodeAt(0));
  const asset=await saveGeneratedVideoAsset(env,{userId:owner,title:'Native public preview source',videoBytes:video,mimeType:'video/mp4'});
  const original=await env.DB.prepare('SELECT r2_key FROM ai_text_assets WHERE id=?').bind(asset.id).first();
  const derivative='hhvd_'+'c'.repeat(32);
  await env.DB.prepare(`INSERT INTO homepage_hero_video_derivatives(id,slot,source_type,source_asset_id,source_user_id,provider,status,source_r2_key,created_at,updated_at,processing_backend)
    VALUES(?,'left_top','admin_asset',?,?,'external_ffmpeg','queued',?,?,?,'cloudflare')`).bind(derivative,asset.id,owner,original.r2_key,now,now).run();
  const input={id:derivative}, [first,duplicate]=await Promise.all([claimHeroPreview(env,input,'cloudflare'),claimHeroPreview(env,input,'cloudflare')]);
  const claim=first||duplicate;assert(Boolean(first)!==Boolean(duplicate),'Exactly one preview lease');
  assert(!await ownsPublicPreview(env,{kind:'preview',id:derivative,backend:'github',token:claim.processing_token}));
  const request=(url,body,token=claim.processing_token)=>worker.fetch(new Request('https://bitbi.ai'+url,{method:body?'POST':'GET',headers:{Authorization:'Bearer synthetic-container',...(token?{'X-BITBI-Preview-Claim':token}:{})},body}),env,{waitUntil(){}});
  const endpoint='/api/internal/homepage/hero-videos/jobs/'+derivative;
  assert.equal((await request(endpoint+'/source')).status,200);
  assert.equal((await request(endpoint+'/source',null,'d'.repeat(32))).status,409);
  await env.DB.prepare("UPDATE homepage_hero_video_derivatives SET locked_until='2000-01-01' WHERE id=?").bind(derivative).run();
  const replacement=await claimHeroPreview(env,input,'cloudflare');assert(replacement.processing_token!==claim.processing_token);
  assert.equal((await request(endpoint+'/source')).status,409);
  const form=new FormData();form.append('file',new Blob([video],{type:'video/mp4'}),'preview.mp4');
  form.append('poster',new Blob([Uint8Array.from(atob(imageBase64),c=>c.charCodeAt(0))],{type:'image/webp'}),'poster.webp');
  const completed=await request(endpoint+'/complete',form,replacement.processing_token);
  assert.equal(completed.status,200);assert.equal((await env.DB.prepare('SELECT status FROM homepage_hero_video_derivatives WHERE id=?').bind(derivative).first()).status,'succeeded');
  assert.equal((await request(endpoint+'/fail',JSON.stringify({error_code:'stale'}))).status,409);
  const posterAsset=await saveGeneratedVideoAsset(env,{userId:owner,title:'Manual upload',videoBytes:video,mimeType:'video/mp4'});
  const posterKey=(await env.DB.prepare('SELECT r2_key FROM ai_text_assets WHERE id=?').bind(posterAsset.id).first()).r2_key;
  await env.DB.prepare(`INSERT INTO homepage_hero_video_uploads(id,asset_id,user_id,mime_type,size_bytes,r2_key,idempotency_key_hash,request_hash,operator_reason,created_at,processing_backend)
    VALUES('poster-upload',?,?,'video/mp4',?,?, 'poster-idempotency','poster-request','synthetic',?,'cloudflare')`).bind(posterAsset.id,owner,video.length,posterKey,now).run();
  const posterCall=async(path,body,claim,secret='synthetic-container')=>worker.fetch(new Request('https://bitbi.ai/api/internal/homepage/hero-videos/source-posters/'+path,{
    method:body?'POST':'GET',headers:{Authorization:'Bearer '+secret,...(body instanceof FormData?{}:{'Content-Type':'application/json'}),...(claim?{'X-BITBI-Poster-Claim':claim}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined}),env,{waitUntil(){}});
  assert.equal((await (await posterCall('jobs/claim',{member_only:false},null,'synthetic-github')).json()).data.jobs.length,0);
  const posterClaim=await (await posterCall('jobs/claim',{member_only:false})).json();
  const posterJob=posterClaim.data.jobs[0];assert.equal(posterJob.source_asset_id,posterAsset.id);assert(posterJob.public_poster_claim);
  assert.equal((await (await posterCall('jobs/claim',{member_only:false})).json()).data.jobs.length,0);
  assert.equal((await posterCall('jobs/'+posterAsset.id+'/source',null,'0'.repeat(32))).status,409);
  const originalPosterSource=await posterCall('jobs/'+posterAsset.id+'/source',null,posterJob.public_poster_claim);assert.equal(originalPosterSource.status,200);assert.equal((await originalPosterSource.arrayBuffer()).byteLength,video.length);
  const posterData=new FormData();posterData.set('poster',new Blob([Uint8Array.from(atob(imageBase64),c=>c.charCodeAt(0))],{type:'image/png'}),'poster.png');
  assert.equal((await posterCall('jobs/'+posterAsset.id+'/complete',posterData,posterJob.public_poster_claim)).status,200);
  const retained=(await env.DB.prepare('SELECT poster_r2_key FROM ai_text_assets WHERE id=?').bind(posterAsset.id).first()).poster_r2_key;assert(retained);
  assert.equal((await (await posterCall('jobs/claim',{member_only:false})).json()).data.jobs.length,0,'Existing poster must not be regenerated');
  env.ENABLE_MEMVID_STREAM_PREVIEWS='true';env.CLOUDFLARE_ACCOUNT_ID='synthetic';env.CLOUDFLARE_STREAM_API_TOKEN='synthetic';
  await env.DB.prepare("UPDATE ai_text_assets SET visibility='public' WHERE id=?").bind(asset.id).run();
  const streamId='msp_'+'e'.repeat(32),fingerprint='f'.repeat(64);
  await env.DB.prepare(`INSERT INTO memvid_stream_previews(id,asset_id,user_id,source_r2_key,source_fingerprint,status,created_at,updated_at,processing_backend)
    VALUES(?,?,?,?,?,'queued',?,?,'cloudflare')`).bind(streamId,asset.id,owner,original.r2_key,fingerprint,now,now).run();
  const stream=async(path,body,secret='synthetic-container')=>{const r=await worker.fetch(new Request('https://bitbi.ai/api/internal/memvid-stream-previews/'+path,{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify(body)}),env,{waitUntil(){}});return {status:r.status,body:await r.json()};};
  assert.equal((await stream('jobs/claim',{receipt_protocol:2,limit:1},'synthetic-github')).body.data.jobs.length,0);
  const claimedStream=(await stream('jobs/claim',{receipt_protocol:2,limit:1})).body.data.jobs[0];assert.equal(claimedStream.id,streamId);
  assert.equal((await stream('jobs/claim',{receipt_protocol:2,limit:1})).body.data.jobs.length,0);
  const permit=(await stream('jobs/'+streamId+'/receipt',{phase:'begin',claim_token:claimedStream.claim_token,source_fingerprint:fingerprint})).body.data;
  assert(permit.upload_token,'One source-bound upload permit');
  assert.equal((await stream('jobs/'+streamId+'/receipt',{phase:'begin',claim_token:claimedStream.claim_token,source_fingerprint:fingerprint})).status,409);
  await env.DB.prepare('DELETE FROM ai_text_assets WHERE id=?').bind(asset.id).run();
  const receipt={upload_token:permit.upload_token,stream_uid:'f'.repeat(32),source_fingerprint:fingerprint};
  assert.equal((await stream('jobs/'+streamId+'/receipt',receipt,'synthetic-github')).status,403);
  const late=await stream('jobs/'+streamId+'/receipt',receipt);assert.equal(late.status,200);assert(late.body.data.retired,'Late receipt survives deletion without republishing');
  // Simulate a lost activation response. Do not dispatch again while its lease
  // survives; expiry replaces the token and fences a delayed original runner.
  env.PRIVATE_MEDIA_PROCESSOR.fetch=async()=>{throw Error('synthetic lost response');};
  assert.equal((await dispatchPrivateMedia(env,'cloudflare')).status,'retry');
  const lost=(await env.DB.prepare("SELECT token FROM private_media_dispatch WHERE backend='cloudflare'").first()).token;
  assert.equal((await dispatchPrivateMedia(env,'cloudflare')).status,'active');
  await env.DB.prepare("UPDATE private_media_dispatch SET lease_until='2000-01-01' WHERE backend='cloudflare'").run();
  assert.equal((await dispatchPrivateMedia(env,'cloudflare')).status,'retry');
  await assert.rejects(mediaRunner(env,'cloudflare',{token:lost,runner:'late',action:'acquire'}),/media_runner_claim_lost/);
  const exhausted='hhvd_'+'9'.repeat(32);
  await env.DB.prepare(`INSERT INTO homepage_hero_video_derivatives(id,slot,source_type,source_asset_id,source_user_id,provider,status,source_r2_key,created_at,updated_at,processing_backend,attempt_count,locked_until)
    VALUES(?,'left_top','admin_asset',?,?,'external_ffmpeg','processing',?,?,?,'cloudflare',8,'2000-01-01')`).bind(exhausted,posterAsset.id,owner,posterKey,now,now).run();
  messages.length=0;await recoverPrivateMedia(env);assert(messages.some(m=>m.backend==='cloudflare'));
  assert.equal((await env.DB.prepare('SELECT status FROM homepage_hero_video_derivatives WHERE id=?').bind(exhausted).first()).status,'failed');
  assert.equal((await env.DB.prepare('SELECT poster_r2_key FROM ai_text_assets WHERE id=?').bind(posterAsset.id).first()).poster_r2_key,retained);
  await assert.rejects(setPrivateMediaService(env,{backend:'cloudflare',actor:owner,reason:'unavailable'}),/media_service_not_ready/);
  await env.DB.prepare("DELETE FROM app_settings WHERE key='private_media_service'").run();
  assert.equal((await env.DB.prepare('SELECT processing_backend FROM canvas_video_processing WHERE id=?').bind(cloud.id).first()).processing_backend,'cloudflare');
  return {immediateQueue:true,atomicAssignment:true,backendIsolation:true,duplicateStarts:0,lostResponseFenced:true,lateArrivalWoken:true};
}

export async function privateMediaSmokeCase(base,fixture) {
  const {privateMediaSmoke}=await import('../../workers/auth/src/lib/private-media-smoke.js');
  let verified=0;const sha='b'.repeat(40);
  const env={...base,ENABLE_HOMEPAGE_HERO_EXTERNAL_FFMPEG:'true',HOMEPAGE_HERO_EXTERNAL_FFMPEG_SECRET:'synthetic-github',PRIVATE_MEDIA_SOURCE_SHA:sha,MEMVID_STREAM_PREVIEW_PROCESSOR_SECRET:'synthetic-github',PRIVATE_MEDIA_PROCESSOR_SECRET:'synthetic-container',
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
    const body={sha,backend,action:'start',fixture:fixture.videoBase64,referenceFixture:fixture.referenceBase64};await smoke(body);await smoke(body);
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
    const stillPending=await smoke({sha,backend,action:'result'});assert.equal(stillPending.ready,false);assert.equal(stillPending.publicPreviewPending,true);
    const publicPosters=await fetch('/api/internal/homepage/hero-videos/source-posters/jobs/claim',{member_only:false,limit:8});assert.equal(publicPosters.status,200);
    for(const poster of (await publicPosters.json()).data.jobs){
      const data=new FormData();data.set('poster',new Blob([image],{type:'image/png'}),'poster.png');
      assert.equal((await fetch(poster.completion.url,data,{'X-BITBI-Poster-Claim':poster.public_poster_claim})).status,200);
    }
    const publicJobs=await fetch('/api/internal/homepage/hero-videos/jobs/claim',{limit:8});assert.equal(publicJobs.status,200);
    for(const preview of (await publicJobs.json()).data.jobs){
      const data=new FormData();data.set('file',new Blob([video],{type:'video/mp4'}),'preview.mp4');data.set('poster',new Blob([image],{type:'image/webp'}),'poster.webp');
      assert.equal((await fetch(preview.completion.url,data,{'X-BITBI-Preview-Claim':preview.preview_claim})).status,200);
    }
    assert.equal((await smoke({sha,backend,action:'result'})).referencePending,true);
    const referenceBase='/api/internal/homepage/hero-videos/reference-videos/jobs';
    const referenceResponse=await fetch(referenceBase+'/claim',{protocol:1});assert.equal(referenceResponse.status,200);
    const reference=(await referenceResponse.json()).data.jobs[0];assert(reference);
    const referenceForm=new FormData();referenceForm.set('video',new Blob([Uint8Array.from(atob(fixture.preparedBase64),c=>c.charCodeAt(0))],{type:'video/mp4'}),'reference.mp4');
    assert.equal((await fetch(reference.completion.url,referenceForm,{'X-BITBI-Canvas-Claim':reference.claim})).status,200);
    const result=await smoke({sha,backend,action:'result'});assert.equal(result.ready,true);assert.equal(result.videoReference.metadata.frames,360);assert.equal(result.outputs.length,3);assert.equal(result.publicPreviews.length,2);
  }
  assert.equal(verified,1);
  const activate={sha,backend:'cloudflare',action:'activate-thumbnails'};
  await assert.rejects(privateMediaSmoke(env,activate),/media_smoke_invalid/);
  env.GITHUB_ACTIONS_DISPATCH_TOKEN='synthetic';env.GITHUB_ACTIONS_DISPATCH_OWNER='synthetic';env.GITHUB_ACTIONS_DISPATCH_REPO='synthetic';
  env.PRIVATE_MEDIA_PROCESSOR.fetch=async()=>Response.json({protocol:1,functional_verified:true,preview_configured:true,version:sha});
  const activation=await privateMediaSmoke(env,activate);assert.equal(activation.thumbnailBackend,'cloudflare');
  assert.equal(activation.backend,'github','The assembly choice is independent');
  assert.equal((await privateMediaSmoke(env,activate)).reused,true);
  await setPrivateMediaService(env,{backend:'github',thumbnailBackend:'github',actor:null,reason:'Owner explicitly selects alternative'});
  await assert.rejects(privateMediaSmoke(env,activate),/media_smoke_invalid/);
  assert.equal((await privateMediaStatus(env)).thumbnailBackend,'github','Retry must preserve later owner choice');
  return {bothBackends:true,firstAndContinuationAndExportPosters:true,repeatSeedSafe:true,noAI:true};
}
