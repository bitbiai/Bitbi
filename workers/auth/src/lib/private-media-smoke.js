import { inspectH3TimeReference } from './h3-reference-metadata.js';
// Protected release smoke: one fixed, non-AI fixture per backend/source commit.
// No arbitrary URL, prompt, owner, upload, job ID or production record accepted.
import { enqueueAdminAuditEvent } from './activity.js';
import { sha256Hex,nowIso } from './tokens.js';
import { ownedCanvasVideo } from './canvas-video-input.js';
import { putNewManagedR2Object } from './r2-cleanup.js';
import { notifyPrivateMedia,privateMediaStatus,setPrivateMediaService } from './private-media-service.js';
const referenceFixtureHash='2c67d78cda7252be0cb6ef14396d92abb3b7193940ecc977a5c9fcc823bd1609';
const fixtureHash='5dec3abce278a6eb44db0506986d68da202fa3703c0ef8a0e07e423fc2b5095e';
const owner='bitbi-private-media-release-smoke';
const fail=()=>{throw Object.assign(new Error('media_smoke_invalid'),{code:'media_smoke_invalid',status:409});};
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
const id=async value=>(await sha256Hex(value)).slice(0,32);
export async function privateMediaSmoke(env,body) {
  if(!body||Object.keys(body).some(k=>!['sha','backend','action','fixture','referenceFixture'].includes(k))||body.sha!==env.PRIVATE_MEDIA_SOURCE_SHA||!/^[a-f0-9]{40}$/.test(body.sha||'')||!['github','cloudflare'].includes(body.backend)||!['start','result','activate-thumbnails'].includes(body.action))fail();
  const {sha,backend}=body,project=await id(`media-smoke:${sha}:${backend}`),node=await id(project+':node'),now=nowIso();
  if(body.action==='activate-thumbnails'){
    if(backend!=='cloudflare'||body.fixture!==undefined)fail();
    const current=await privateMediaStatus(env);
    if(current.services.cloudflare.state!=='ready')fail();
    const row=await env.DB.prepare("SELECT value_json FROM app_settings WHERE key='private_media_service'").first();
    const previous=JSON.parse(row?.value_json||'{}');
    // A resumed release must never undo a later explicit owner selection.
    if(previous.thumbnailRolloutSha){
      if(current.thumbnailBackend!=='cloudflare')fail();
      return {sha,backend:current.backend,thumbnailBackend:current.thumbnailBackend,verified:true,reused:true};
    }
    const result=await setPrivateMediaService(env,{backend:current.backend,thumbnailBackend:'cloudflare',thumbnailRolloutSha:sha,actor:null,reason:`Protected release ${sha}: verified thumbnail rollout`});
    await enqueueAdminAuditEvent(env,{id:await id('thumbnail-rollout:'+sha),adminUserId:'system:protected-release',action:'thumbnail_service_activated',meta:{sha,thumbnailBackend:result.thumbnailBackend,assemblyBackend:result.backend}},{allowDirectFallback:true});
    return {sha,backend:result.backend,thumbnailBackend:result.thumbnailBackend,verified:true};
  }
  if(body.action==='start') {
    if(typeof body.referenceFixture!=='string'||body.referenceFixture.length>29000)fail();
    const referenceBytes=Uint8Array.from(atob(body.referenceFixture),c=>c.charCodeAt(0));
    if(await digest(referenceBytes)!==referenceFixtureHash)fail();
    if(typeof body.fixture!=='string'||body.fixture.length>4096)fail();
    const bytes=Uint8Array.from(atob(body.fixture),c=>c.charCodeAt(0));if(await digest(bytes)!==fixtureHash)fail();
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO users(id,email,password_hash,created_at,role,status) VALUES(?,?,?,?,'user','disabled')").bind(owner,'private-media-release-smoke@example.invalid','no-login',now),
      env.DB.prepare('INSERT OR IGNORE INTO canvas_projects(id,user_id,title,created_at,updated_at) VALUES(?,?,?,?,?)').bind(project,owner,'Private media release verification',now,now),
      env.DB.prepare("INSERT OR IGNORE INTO canvas_nodes(id,project_id,user_id,type,x,y,created_at,updated_at) VALUES(?,?,?,'video_generation',0,0,?,?)").bind(node,project,owner,now,now),
    ]);
    const reference=await id(project+':reference'),sourceKey=`users/${owner}/release/${reference}-source.mp4`,outputKey=`users/${owner}/video-references/${reference}.mp4`;
    if(!await env.USER_IMAGES.head(sourceKey))await putNewManagedR2Object(env,sourceKey,referenceBytes,{httpMetadata:{contentType:'video/mp4'}});
    const sourceObject=await env.USER_IMAGES.get(sourceKey);if(!sourceObject||await digest(await sourceObject.arrayBuffer())!==referenceFixtureHash)fail();
    const head=await env.USER_IMAGES.head(sourceKey),metadata=inspectH3TimeReference(referenceBytes,'video','video/mp4',{inspectOverrun:true});
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO ai_text_assets(id,user_id,r2_key,title,file_name,source_module,mime_type,size_bytes,metadata_json,created_at) VALUES(?,?,?,'Synthetic reference','reference.mp4','video','video/mp4',?,'{}',?)").bind(reference,owner,sourceKey,referenceBytes.length,now),
      env.DB.prepare(`INSERT OR IGNORE INTO private_video_references(id,user_id,source_asset_id,source_r2_key,source_etag,source_bytes,output_r2_key,source_metadata_json,processing_backend,next_attempt_at,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(reference,owner,reference,sourceKey,head.etag,head.size,outputKey,JSON.stringify(metadata),backend,now,now,now),
      env.DB.prepare("INSERT INTO r2_cleanup_queue(r2_key,status,created_at) SELECT ?,'q2_pending',? WHERE NOT EXISTS(SELECT 1 FROM r2_cleanup_queue WHERE r2_key=?)").bind(outputKey,now,outputKey),
    ]);
    const sources=[];
    for(let i=0;i<2;i++) {
      const asset=await id(project+':asset:'+i),run=await id(project+':run:'+i),key=`users/${owner}/release/${asset}.mp4`;
      if(!await env.USER_IMAGES.head(key))await putNewManagedR2Object(env,key,bytes,{httpMetadata:{contentType:'video/mp4'}});
      const stored=await env.USER_IMAGES.get(key);if(!stored||await digest(await stored.arrayBuffer())!==fixtureHash)fail();
      await env.DB.prepare("INSERT OR IGNORE INTO ai_text_assets(id,user_id,r2_key,title,file_name,source_module,mime_type,size_bytes,metadata_json,created_at) VALUES(?,?,?,'Synthetic clip','synthetic.mp4','video','video/mp4',?,?,?)")
        .bind(asset,owner,key,bytes.length,JSON.stringify({private_media_release_smoke:sha}),now).run();
      const original=await ownedCanvasVideo(env,owner,asset),parent=sources.at(-1);
      const input=parent?{connected_video_inputs:[{method:'last_frame',runId:parent.runId,assetId:parent.assetId,frame:{version:parent.version}}]}:{};
      await env.DB.prepare("INSERT OR IGNORE INTO canvas_runs(id,project_id,node_id,user_id,model_id,operation_type,status,idempotency_key,input_json,output_json,asset_id,created_at,updated_at) VALUES(?,?,?,?,'synthetic-no-provider','canvas.video.generate','completed',?,?,?,?,?,?)")
        .bind(run,project,node,owner,run,JSON.stringify(input),JSON.stringify({kind:'video',assetId:asset,runId:run,sourceVersion:original.version}),asset,now,now).run();
      sources.push({runId:run,assetId:asset,version:original.version,size:original.size});
    }
    // Synthetic jobs alone select their test backend. The actual user setting
    // is never changed by a release smoke; native tests cover atomic switching.
    const insert=(kind,chain,assetId=null)=>env.DB.prepare(`INSERT OR IGNORE INTO canvas_video_processing
      (id,user_id,project_id,run_id,kind,sources_json,asset_id,next_attempt_at,created_at,updated_at,processing_backend,thumbnail_backend)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(kind==='concat'?project:chain[0].assetId,owner,project,chain.at(-1).runId,kind,JSON.stringify(chain),assetId,now,now,now,backend,backend);
    await env.DB.batch([insert('concat',sources),...sources.map(s=>insert('poster',[s],s.assetId))]);
    // Exercise the public-preview producers without publishing a gallery asset
    // or assigning a live Hero slot. Originals remain owned by the disabled
    // synthetic account; the same fixed fixture and accepted backend apply.
    const asset=await id(project+':preview-source'),key=`users/${owner}/release/${asset}.mp4`,derivative='hhvd_'+await id(project+':preview');
    if(!await env.USER_IMAGES.head(key))await putNewManagedR2Object(env,key,bytes,{httpMetadata:{contentType:'video/mp4'}});
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO ai_text_assets(id,user_id,r2_key,title,file_name,source_module,mime_type,size_bytes,metadata_json,created_at) VALUES(?,?,?,'Synthetic preview source','synthetic.mp4','video','video/mp4',?,?,?)")
        .bind(asset,owner,key,bytes.length,JSON.stringify({private_media_release_smoke:sha}),now),
      env.DB.prepare("INSERT OR IGNORE INTO homepage_hero_video_uploads(id,asset_id,user_id,mime_type,size_bytes,r2_key,idempotency_key_hash,request_hash,operator_reason,created_at,processing_backend) VALUES(?,?,?,'video/mp4',?,?,?,?,?,?,?)")
        .bind(asset,asset,owner,bytes.length,key,asset,fixtureHash,'Protected release synthetic preview',now,backend),
      env.DB.prepare("INSERT OR IGNORE INTO homepage_hero_video_derivatives(id,slot,source_type,source_asset_id,source_user_id,provider,status,source_r2_key,created_at,updated_at,processing_backend) VALUES(?,'left_top','admin_asset',?,?,'external_ffmpeg','queued',?,?,?,?)")
        .bind(derivative,asset,owner,key,now,now,backend),
    ]);
    await notifyPrivateMedia(env,backend);return {accepted:true,sha,backend};
  }
  if(body.fixture!==undefined||body.referenceFixture!==undefined)fail();
  const rows=(await env.DB.prepare('SELECT p.status,p.asset_id,a.r2_key,a.poster_r2_key,a.metadata_json FROM canvas_video_processing p LEFT JOIN ai_text_assets a ON a.id=p.asset_id AND a.user_id=p.user_id WHERE p.project_id=? AND p.user_id=? AND p.processing_backend=? ORDER BY p.kind').bind(project,owner,backend).all()).results||[];
  if(rows.length!==3||rows.some(r=>r.status!=='ready'||!r.r2_key||!r.poster_r2_key))return {ready:false,sha,backend,states:rows.map(r=>r.status)};
  const preview=await env.DB.prepare('SELECT status,file_r2_key,poster_r2_key FROM homepage_hero_video_derivatives WHERE id=? AND source_user_id=? AND processing_backend=?')
    .bind('hhvd_'+await id(project+':preview'),owner,backend).first();
  const source=await env.DB.prepare("SELECT r2_key,poster_r2_key FROM ai_text_assets WHERE id=? AND user_id=? AND visibility='private'")
    .bind(await id(project+':preview-source'),owner).first();
  if(preview?.status!=='succeeded'||!preview.file_r2_key||!preview.poster_r2_key||!source?.poster_r2_key)return {ready:false,sha,backend,publicPreviewPending:true};
  const publicRows=[{r2_key:preview.file_r2_key,poster_r2_key:preview.poster_r2_key},source];
  const outputs=[];
  for(const row of [...rows,...publicRows]) {
    const [video,poster]=await Promise.all([env.USER_IMAGES.get(row.r2_key),env.USER_IMAGES.get(row.poster_r2_key)]);
    if(!video||!poster||video.size>1024*1024||poster.size>128*1024)fail();
    const v=new Uint8Array(await video.arrayBuffer()),p=new Uint8Array(await poster.arrayBuffer());
    if(String.fromCharCode(...v.slice(4,8))!=='ftyp'||!p.length)fail();
    const base64=b=>{let s='';for(const x of b)s+=String.fromCharCode(x);return btoa(s);};
    outputs.push({video:base64(v),poster:base64(p),videoDigest:await digest(v),posterDigest:await digest(p)});
  }
  const reference=await env.DB.prepare("SELECT * FROM private_video_references WHERE id=? AND user_id=? AND processing_backend=?").bind(await id(project+':reference'),owner,backend).first();
  if(reference?.status!=='ready')return {ready:false,sha,backend,referencePending:true};
  const original=await env.USER_IMAGES.get(reference.source_r2_key),prepared=await env.USER_IMAGES.get(reference.output_r2_key);
  if(!original||!prepared||await digest(await original.arrayBuffer())!==referenceFixtureHash||prepared.size>100000)fail();
  const referenceBytes=new Uint8Array(await prepared.arrayBuffer()),referenceMetadata=inspectH3TimeReference(referenceBytes,'video','video/mp4');
  if(!referenceMetadata.audioDuration||referenceMetadata.frames!==360)fail();
  let encoded='';for(const byte of referenceBytes)encoded+=String.fromCharCode(byte);
  const videoReference={video:btoa(encoded),videoDigest:await digest(referenceBytes),originalDigest:referenceFixtureHash,metadata:referenceMetadata};
  if(backend==='cloudflare') {
    const verified=await env.PRIVATE_MEDIA_PROCESSOR.fetch('https://private-media/verified',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sha,job:project})});
    if(!verified.ok)fail();
  }
  return {ready:true,sha,backend,outputs:outputs.slice(0,3),publicPreviews:outputs.slice(3),videoReference};
}
