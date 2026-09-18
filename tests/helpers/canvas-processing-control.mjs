import worker from '../../workers/auth/src/index.js';
import { sha256Hex } from '../../workers/auth/src/lib/tokens.js';
import { saveGeneratedVideoAsset } from '../../workers/auth/src/lib/ai-text-assets.js';
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
  await db.prepare('DELETE FROM ai_text_assets WHERE id=?').bind(sources[0].id).run();
  let rejected=false;try{await canvasVideoChain(env,owner,project,runs[1]);}catch{rejected=true;}check(rejected,'Missing original blocks');
  const posterRetry=await payload(await request(`${api}/${runs[4]}/full-video`,'POST',{}));
  check(posterRetry.export.asset.id===saved.asset.id && posterRetry.export.status==='preview_pending','Saved export poster retry needs no old clips');
  const resumed=await payload(await request(posterBase+'/claim?member_only=true','POST',{member_only:true,limit:8}));
  check(!resumed.jobs.some(j=>j.id===saved.asset.id),'Existing valid poster not regenerated');
  check((await payload(await request(`${api}/${runs[4]}/full-video`))).export.status==='ready','Existing poster restores ready');
  return {clips:5,assetCount:6,providerCalls:0,creditDebits:0,exportId:saved.id,status:'ready'};
}
