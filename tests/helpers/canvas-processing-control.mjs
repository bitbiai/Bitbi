import { registerCanvasMedia,canvasMediaEnvironment,reclaimCanvasMedia } from '../../workers/auth/src/lib/canvas-media-storage.js';
import worker from '../../workers/auth/src/index.js';
import { sha256Hex } from '../../workers/auth/src/lib/tokens.js';
import { saveGeneratedVideoAsset,saveAdminAiTextAsset } from '../../workers/auth/src/lib/ai-text-assets.js';
import { ownedCanvasVideo } from '../../workers/auth/src/lib/canvas-video-input.js';
import { canvasVideoChain, catchUpCanvasPosters } from '../../workers/auth/src/lib/canvas-video-processing.js';
const check=(condition,message)=>{if(!condition)throw new Error(message);};
export async function canvasProcessingCase(base,fixture) {
  const now=new Date().toISOString(),owner='canvas-processing-owner',other='canvas-processing-other',project='1'.repeat(32),node='2'.repeat(32);
  const env={...base,MEMVID_STREAM_PREVIEW_PROCESSOR_SECRET:'synthetic-processor',ENABLE_HOMEPAGE_HERO_EXTERNAL_FFMPEG:'false'};
  const db=env.DB,video=Uint8Array.from(atob(fixture.videoBase64),c=>c.charCodeAt(0));
  for(const id of [owner,other]) {
    await db.prepare("INSERT INTO users(id,email,password_hash,created_at,role,email_verified_at) VALUES(?,?,?,?,'user',?)").bind(id,id+'@example.invalid','synthetic',now,now).run();
    await db.prepare('INSERT INTO sessions(id,user_id,token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?)').bind(id,id,await sha256Hex(`${id}:${env.SESSION_HASH_SECRET}`),now,new Date(Date.now()+3600000).toISOString(),now).run();
  }
  await db.prepare("INSERT INTO canvas_projects(id,user_id,title,created_at,updated_at) VALUES(?,?,'Synthetic chain',?,?)").bind(project,owner,now,now).run();
  await db.prepare("INSERT INTO canvas_nodes(id,project_id,user_id,type,x,y,created_at,updated_at) VALUES(?,?,?,'video_generation',0,0,?,?)").bind(node,project,owner,now,now).run();
  const sources=[],runs=[];
  for(let i=0;i<5;i++) {
    const asset=await saveGeneratedVideoAsset(env,{userId:owner,title:`Clip ${i+1}`,videoBytes:video,mimeType:'video/mp4'});
    const original=await ownedCanvasVideo(env,owner,asset.id),id=(await sha256Hex('canvas-run-'+i)).slice(0,32);
    const input=i?{connected_video_inputs:[{method:'last_frame',runId:runs[i-1],assetId:sources[i-1].id,frame:{version:sources[i-1].version}}]}:{};
    const output={kind:'video',assetId:asset.id,runId:id,sourceVersion:original.version,asset:{id:asset.id,file_url:asset.file_url}};
    await db.prepare("INSERT INTO canvas_runs(id,project_id,node_id,user_id,model_id,operation_type,status,idempotency_key,input_json,output_json,asset_id,created_at,updated_at) VALUES(?,?,?,?,'pixverse/v6','canvas.video.generate','completed',?,?,?,?,?,?)")
      .bind(id,project,node,owner,id,JSON.stringify(input),JSON.stringify(output),asset.id,now,now).run();
    await registerCanvasMedia(env,{runId:id,userId:owner,projectId:project,nodeId:node,kind:'video'});
    await db.prepare('UPDATE canvas_media_outputs SET asset_id=? WHERE run_id=?').bind(asset.id,id).run();
    sources.push(original);runs.push(id);
  }
  const request=(url,method='GET',body=null,{user=owner,token=null}={})=>worker.fetch(new Request('https://bitbi.ai'+url,{method,headers:{Origin:'https://bitbi.ai',Cookie:`__Host-bitbi_session=${user}`,
    ...(url.startsWith('/api/internal/')?{Authorization:'Bearer synthetic-processor'}:{}),...(token?{'X-BITBI-Canvas-Claim':token}:{}),...(body && !(body instanceof FormData)?{'Content-Type':'application/json'}:{})},body:body?(body instanceof FormData?body:JSON.stringify(body)):undefined}),env,{waitUntil(){}});
  const payload=async response=>{const p=await response.json();check(response.ok,`${response.status}: ${JSON.stringify(p)}`);return p.data;};
  const api=`/api/account/canvas/projects/${project}/runs`,internal='/api/internal/homepage/hero-videos/canvas-exports/jobs';
  check(!(await payload(await request(`${api}/${runs[0]}/full-video`))).eligible,'First clip no export');
  check((await request(`${api}/${runs[1]}/full-video`,'POST',{}, {user:other})).status===404,'Foreign project denied');
  check((await canvasVideoChain(env,owner,project,runs[1])).length===2,'Two chain');
  check((await canvasVideoChain(env,owner,project,runs[4])).length===5,'Five chain');
  // Mutable node output is irrelevant to an old chain, deleted/version-changed originals are not.
  await db.prepare('UPDATE canvas_nodes SET asset_id=? WHERE id=?').bind(sources[4].id,node).run();
  check((await canvasVideoChain(env,owner,project,runs[1]))[0].assetId===sources[0].id,'Historical parent not overwritten');
  const originalInput=(await db.prepare('SELECT input_json FROM canvas_runs WHERE id=?').bind(runs[0]).first()).input_json;
  await db.prepare('UPDATE canvas_runs SET input_json=? WHERE id=?').bind(JSON.stringify({connected_video_inputs:[{method:'last_frame',runId:runs[1],assetId:sources[1].id,frame:{version:sources[1].version}}]}),runs[0]).run();
  let cycle=false;try{await canvasVideoChain(env,owner,project,runs[1]);}catch(e){cycle=e.code==='canvas_chain_cycle';}check(cycle,'Cycle rejected');
  await db.prepare('UPDATE canvas_runs SET input_json=? WHERE id=?').bind(originalInput,runs[0]).run();
  const childInput=(await db.prepare('SELECT input_json FROM canvas_runs WHERE id=?').bind(runs[1]).first()).input_json;
  const stale=JSON.parse(childInput);stale.connected_video_inputs[0].frame.version='wrong';
  await db.prepare('UPDATE canvas_runs SET input_json=? WHERE id=?').bind(JSON.stringify(stale),runs[1]).run();
  let changed=false;try{await canvasVideoChain(env,owner,project,runs[1]);}catch(e){changed=e.code==='video_source_changed';}check(changed,'Changed original rejected');
  await db.prepare('UPDATE canvas_runs SET input_json=? WHERE id=?').bind(childInput,runs[1]).run();
  const a=await payload(await request(`${api}/${runs[4]}/full-video`,'POST',{}));
  const b=await payload(await request(`${api}/${runs[4]}/full-video`,'POST',{}));check(a.export.id===b.export.id,'Duplicate export reused');
  check((await request(internal+'/claim','POST',{protocol:0})).status===409,'Old processor cannot claim');
  const job=(await payload(await request(internal+'/claim','POST',{protocol:1,limit:1}))).jobs[0];
  check(job.sources.length===5,'Processor receives full ordered chain');
  check((await payload(await request(internal+'/claim','POST',{protocol:1,limit:1}))).jobs.length===0,'No concurrent claim');
  const source=await request(job.sources[0].url,'GET',null,{token:job.claim});check(source.ok,'Private source accessible');
  check((await source.arrayBuffer()).byteLength===video.length,'Original bytes');
  check((await request(job.sources[0].url,'GET',null,{token:'0'.repeat(32)})).status===409,'Stale claim denied');
  const form=()=>{const f=new FormData();f.set('video',new Blob([video],{type:'video/mp4'}),'full-video.mp4');f.set('duration','5');f.set('width','320');f.set('height','180');return f;};
  await payload(await request(job.completion.url,'POST',form(),{token:job.claim}));
  check((await request(job.completion.url,'POST',form(),{token:job.claim})).status===409,'Late duplicate fenced');
  check((await db.prepare('SELECT COUNT(*) AS n FROM ai_text_assets WHERE user_id=?').bind(owner).first()).n===6,'One separate export');
  check((await db.prepare('SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=?').bind(owner).first()).n===0,'No debit');
  const saved=(await payload(await request(`${api}/${runs[4]}/full-video`))).export;check(saved.status==='preview_pending' && saved.asset,'Video retained before poster');
  await db.prepare("UPDATE canvas_video_processing SET asset_id=NULL,status='queued',locked_until=NULL,next_attempt_at=? WHERE id=?").bind(now,saved.id).run();
  check((await payload(await request(internal+'/claim','POST',{protocol:1,limit:1}))).jobs.length===0,'Lost completion recovers saved video without another concat');
  check((await payload(await request(`${api}/${runs[4]}/full-video`))).export.asset.id===saved.asset.id,'Recovered exact original export');
  check((await request(saved.asset.file_url,'GET',null,{user:other})).status===404,'Private export denied');
  const posterBase='/api/internal/homepage/hero-videos/source-posters/jobs';
  const posterJobs=await payload(await request(posterBase+'/claim?member_only=true','POST',{member_only:true,limit:8}));
  const posterJob=posterJobs.jobs.find(j=>j.id===saved.asset.id);check(posterJob,'Export uses existing poster endpoint');
  const posterRequest=async (url,body,token=posterJob.generation_claim)=>worker.fetch(new Request('https://bitbi.ai'+url,{method:'POST',headers:{Authorization:'Bearer synthetic-processor','X-BITBI-Generation-Claim':token,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:JSON.stringify(body)}),env,{waitUntil(){}});
  await posterRequest(posterJob.completion.failure_url,{code:'synthetic_poster_failure'});
  check((await db.prepare('SELECT COUNT(*) AS n FROM ai_text_assets WHERE id=?').bind(saved.asset.id).first()).n===1,'Poster failure preserves video');
  await db.prepare('UPDATE canvas_video_processing SET next_attempt_at=? WHERE id=?').bind(now,saved.id).run();
  const retry=(await payload(await request(posterBase+'/claim?member_only=true','POST',{member_only:true,limit:8}))).jobs.find(j=>j.id===saved.asset.id);
  const posterForm=new FormData();posterForm.set('poster',new Blob([Uint8Array.from(atob(fixture.imageBase64),c=>c.charCodeAt(0))],{type:'image/png'}),'poster.png');
  await payload(await posterRequest(retry.completion.url,posterForm,retry.generation_claim));
  check((await payload(await request(`${api}/${runs[4]}/full-video`))).export.status==='ready','Export poster complete');
  check(await catchUpCanvasPosters(env)>=5,'Existing Canvas missing posters queued');
  check(await catchUpCanvasPosters(env)>=5,'Catchup repeat safe');
  check((await db.prepare("SELECT COUNT(*) AS n FROM canvas_video_processing WHERE kind='poster'").first()).n===5,'No duplicate backfill');
  // A saved export can retry only its poster even after an original is gone.
  await db.prepare("UPDATE canvas_video_processing SET status='failed',error_code='canvas_poster_failed' WHERE id=?").bind(saved.id).run();
  // Source deletion is rejected rather than substituting a newer graph asset.
  await payload(await request(`${api}/${runs[0]}/save-asset`,'POST',{}));
  await db.prepare('DELETE FROM ai_text_assets WHERE id=?').bind(sources[0].id).run();
  let rejected=false;try{await canvasVideoChain(env,owner,project,runs[1]);}catch{rejected=true;}check(rejected,'Missing original blocks');
  const posterRetry=await payload(await request(`${api}/${runs[4]}/full-video`,'POST',{}));
  check(posterRetry.export.asset.id===saved.asset.id && posterRetry.export.status==='preview_pending','Saved export poster retry needs no old clips');
  const resumed=await payload(await request(posterBase+'/claim?member_only=true','POST',{member_only:true,limit:8}));
  check(!resumed.jobs.some(j=>j.id===saved.asset.id),'Existing valid poster not regenerated');
  check((await payload(await request(`${api}/${runs[4]}/full-video`))).export.status==='ready','Existing poster restores ready');
  await payload(await request(`/api/account/canvas/projects/${project}`,'DELETE'));
  check((await request(saved.asset.file_url)).ok,'Full video remains permanent after source project deletion');
  check((await db.prepare('SELECT COUNT(*) AS n FROM canvas_media_outputs WHERE asset_id=?').bind(saved.asset.id).first()).n===0,'Combined output is never Canvas-only');
  const storage=await canvasStorageCases(env,fixture);
  return {clips:5,assetCount:6,providerCalls:0,creditDebits:0,exportId:saved.id,status:'ready',storage};
}

// Exercised inside the same workerd control fixture: real route authorization,
// D1 transactions/triggers, R2 originals/derivatives and quota, no provider calls.
export async function canvasStorageCases(env, fixture) {
  const now=new Date().toISOString(),owner='canvas-storage-owner',other='canvas-storage-other';
  for(const id of [owner,other]) {
    await env.DB.prepare("INSERT INTO users(id,email,password_hash,created_at,role,email_verified_at) VALUES(?,?,?,?,'user',?)").bind(id,id+'@example.invalid','synthetic',now,now).run();
    await env.DB.prepare('INSERT INTO sessions(id,user_id,token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?)').bind(id,id,await sha256Hex(`${id}:${env.SESSION_HASH_SECRET}`),now,new Date(Date.now()+3600000).toISOString(),now).run();
  }
  const request=(path,method='GET',user=owner)=>worker.fetch(new Request('https://bitbi.ai'+path,{method,headers:{Origin:'https://bitbi.ai',Cookie:`__Host-bitbi_session=${user}`,...(method==='POST'?{'Content-Type':'application/json'}:{})},body:method==='POST'?'{}':undefined}),env,{waitUntil(){}});
  let sequence=1000;
  const create=async({running=false,project=null,node=null,kind='video'}={})=>{
    const id=()=> (++sequence).toString(16).padStart(32,'0');
    const p=project||id(),n=node||id(),run=id();
    if(!project)await env.DB.prepare("INSERT INTO canvas_projects(id,user_id,title,created_at,updated_at) VALUES(?,?,'Storage fixture',?,?)").bind(p,owner,now,now).run();
    if(!node)await env.DB.prepare("INSERT INTO canvas_nodes(id,project_id,user_id,type,x,y,created_at,updated_at) VALUES(?,?,?,'video_generation',0,0,?,?)").bind(n,p,owner,now,now).run();
    await env.DB.prepare("INSERT INTO canvas_runs(id,project_id,node_id,user_id,model_id,operation_type,status,idempotency_key,input_json,created_at,updated_at) VALUES(?,?,?,?,'pixverse/v6','canvas.video.generate',?,?,'{}',?,?)").bind(run,p,n,owner,running?'running':'completed',run,now,now).run();
    await registerCanvasMedia(env,{runId:run,userId:owner,projectId:p,nodeId:n,kind});
    return {p,n,run,path:`/api/account/canvas/projects/${p}`,save:`/api/account/canvas/projects/${p}/runs/${run}/save-asset`};
  };
  const store=async c=>{
    const asset=await saveGeneratedVideoAsset(canvasMediaEnvironment(env,c.run),{userId:owner,title:'Synthetic video',videoBytes:Uint8Array.from(atob(fixture.videoBase64),x=>x.charCodeAt(0)),mimeType:'video/mp4'});
    await env.DB.prepare("UPDATE canvas_runs SET status='completed',asset_id=? WHERE id=?").bind(asset.id,c.run).run();
    c.asset=asset;c.key=(await env.DB.prepare('SELECT r2_key FROM ai_text_assets WHERE id=?').bind(asset.id).first()).r2_key;
    return c;
  };
  const exists=async c=>Boolean(await env.USER_IMAGES.head(c.key));
  const first=await store(await create());
  const assets=await (await request('/api/ai/assets?limit=60')).json();
  check(!assets.data.assets.some(a=>a.id===first.asset.id),'Canvas-only output is absent from Assets');
  check((await (await request('/api/ai/folders')).json()).data.unfolderedCount===0,'Canvas output excluded from folder totals');
  check((await request(first.asset.file_url)).ok,'Owner can read original');
  check((await request(first.asset.file_url,'GET',other)).status===404,'Foreign original denied');
  check((await request(first.save,'POST',other)).status===409,'Foreign save denied');
  check((await request(first.save,'POST')).ok && (await request(first.save,'POST')).ok,'Promotion and replay succeed');
  check((await (await request('/api/ai/assets?limit=60')).json()).data.assets.some(a=>a.id===first.asset.id),'Saved original is in Assets');
  check((await (await request('/api/ai/folders')).json()).data.unfolderedCount===1,'Saved output counted once');
  check((await request(first.path,'DELETE')).ok && await exists(first),'Saved output survives deletion');
  const late=await create({running:true});
  check((await request(late.path,'DELETE')).ok,'Delete while generating accepted');
  await store(late);await reclaimCanvasMedia(env,owner);
  check(!await exists(late),'Late output reclaimed without resurrection');
  check((await request(late.save,'POST')).status===409,'Late save cannot resurrect deleted producer');
  const multi=await store(await create()),earlier=await store(await create({project:multi.p,node:multi.n}));
  check((await request(`${multi.path}/nodes/${multi.n}`,'DELETE')).ok,'Node delete accepted');
  check(!await exists(multi) && !await exists(earlier),'All unsaved runs reclaimed');
  const retained=await store(await create()),consumer=await create();
  await env.DB.prepare('UPDATE canvas_nodes SET asset_id=? WHERE id=?').bind(retained.asset.id,consumer.n).run();
  await request(retained.path,'DELETE');check(await exists(retained),'Live consumer fences cleanup');
  await request(consumer.path,'DELETE');check(!await exists(retained),'Deferred output reclaimed after consumer removal');
  const picture=await create({kind:'image'});
  const {handleSaveImage}=await import('../../workers/auth/src/routes/ai/images-write.js');
  const imageResponse=await handleSaveImage({env:canvasMediaEnvironment(env,picture.run),canvasImageId:picture.run,request:new Request('https://bitbi.ai/api/ai/images/save',{method:'POST',headers:{Cookie:`__Host-bitbi_session=${owner}`,Origin:'https://bitbi.ai','Content-Type':'application/json'},body:JSON.stringify({imageData:'data:image/png;base64,'+fixture.imageBase64,prompt:'Synthetic image'})})});
  check(imageResponse.ok,'Actual private image writer');
  const img=await env.DB.prepare('SELECT * FROM ai_images WHERE id=?').bind(picture.run).first();check(img,'Stable image identity');
  await request(picture.path,'DELETE');check(await env.USER_IMAGES.head(img.r2_key),'Pending derivative keeps original for active consumer');
  // Complete the existing derivative storage contract with fixture bytes.
  const thumb=img.r2_key+'.thumb',medium=img.r2_key+'.medium';
  for(const key of [thumb,medium])await env.USER_IMAGES.put(key,Uint8Array.from(atob(fixture.imageBase64),c=>c.charCodeAt(0)),{httpMetadata:{contentType:'image/png'}});
  await env.DB.prepare("UPDATE ai_images SET derivatives_status='ready',thumb_key=?,medium_key=? WHERE id=?").bind(thumb,medium,picture.run).run();
  await reclaimCanvasMedia(env,owner);
  for(const key of [img.r2_key,thumb,medium])check(!await env.USER_IMAGES.head(key),'Image and finished derivatives reclaimed');
  // Audio uses the same private lifecycle and the existing byte writer.
  const music=await create({kind:'music'});
  const wav=new Uint8Array(46),view=new DataView(wav.buffer);
  wav.set(new TextEncoder().encode('RIFF'),0);view.setUint32(4,38,true);wav.set(new TextEncoder().encode('WAVEfmt '),8);
  view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,8000,true);view.setUint32(28,16000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);wav.set(new TextEncoder().encode('data'),36);view.setUint32(40,2,true);
  music.asset=await saveAdminAiTextAsset(canvasMediaEnvironment(env,music.run),{userId:owner,sourceModule:'music',title:'Synthetic silent music',payload:{audioBytes:wav,mimeType:'audio/wav'}});
  music.key=(await env.DB.prepare('SELECT r2_key FROM ai_text_assets WHERE id=?').bind(music.asset.id).first()).r2_key;
  check(music.asset.id===music.run,'Audio stable Canvas identity');
  await request(music.path,'DELETE');check(!await exists(music),'Audio original reclaimed');
  // A managed deletion receipt remains held while another stored asset aliases
  // the same bytes. No new delete intent is needed when that consumer clears.
  const {processR2CleanupQueue}=await import('../../workers/auth/src/lib/r2-cleanup.js');
  const held=await store(await create()),alias='f'.repeat(32);
  await env.DB.prepare("INSERT INTO ai_text_assets(id,user_id,title,file_name,source_module,r2_key,mime_type,size_bytes,created_at) VALUES(?,?,'Alias','alias.mp4','video',?,'video/mp4',0,?)").bind(alias,owner,held.key,now).run();
  await request(held.path,'DELETE');check(await exists(held),'Live R2 alias holds object');
  await env.DB.prepare('DELETE FROM ai_text_assets WHERE id=?').bind(alias).run();
  await processR2CleanupQueue(env);check(!await exists(held),'Held receipt resumes after last alias clears');
  for(const saveFirst of [true,false]) {
    const race=await store(await create());
    const calls=saveFirst?[()=>request(race.save,'POST'),()=>request(race.path,'DELETE')]:[()=>request(race.path,'DELETE'),()=>request(race.save,'POST')];
    const responses=await Promise.all(calls.map(call=>call()));
    const saved=responses[saveFirst?0:1].ok;
    await reclaimCanvasMedia(env,owner);
    check(await exists(race)===saved,'Save/delete race preserves exactly the winning disposition');
  }
  check((await env.DB.prepare('SELECT used_bytes FROM user_asset_storage_usage WHERE user_id=?').bind(owner).first()).used_bytes === (await env.DB.prepare('SELECT COALESCE(SUM(size_bytes),0) AS n FROM ai_text_assets WHERE user_id=?').bind(owner).first()).n,'Reclamation releases original storage quota exactly');
  check((await env.DB.prepare("SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=?").bind(owner).first()).n===0,'Storage operations never debit');
  return {saveReplay:true,lateCleanup:true,earlierRuns:true,consumerFence:true,saveDeleteRace:true};
}
