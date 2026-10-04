// Real Worker/queue/D1/R2 boundaries; only the external provider is synthetic.
import worker from '../../workers/auth/src/index.js';
import { sha256Hex } from '../../workers/auth/src/lib/tokens.js';
import { finishCanvasGeneration } from '../../workers/auth/src/lib/canvas-video-output.js';
import { registerCanvasMedia } from '../../workers/auth/src/lib/canvas-media-storage.js';
import { saveGeneratedVideoAsset, saveAdminAiTextAsset } from '../../workers/auth/src/lib/ai-text-assets.js';
import { topUpMemberDailyCredits, grantMemberCredits } from '../../workers/auth/src/lib/billing.js';
import { getModelTariff } from '../../workers/auth/src/lib/model-tariffs.js';
import { PRIVATE_MEDIA_WAKE } from '../../workers/auth/src/lib/private-media-service.js';
const check=(value,message)=>{if(!value)throw new Error(message);};
export async function canvasCompletionFixture(base,fixture) {
  const db=base.DB,owner='canvas-completion-member',now=new Date().toISOString(),ids=[];
  for(let i=0;i<12;i++)ids.push((await sha256Hex('canvas-completion-'+i)).slice(0,32));
  const project=ids[0],nodes=ids.slice(1,10),musicNode=ids[10],video=Uint8Array.from(atob(fixture.videoBase64),c=>c.charCodeAt(0));
  const messages=[],calls=[],waits=[],observations=[];
  const env={...base,BITBI_ENV:'production',MEMVID_STREAM_PREVIEW_PROCESSOR_SECRET:'synthetic-completion-processor',ENABLE_HOMEPAGE_HERO_EXTERNAL_FFMPEG:'false',ENABLE_MEMVID_STREAM_PREVIEW_AUTO_DISPATCH:'false',
    AI:{async run(){throw new Error('H3 must use the exact REST adapter, not binding inference');}},
    CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),H3_CLOUDFLARE_API_TOKEN:'synthetic-h3-canvas-completion-not-live',AI_IMAGE_DERIVATIVES_QUEUE:{async send(){}},AI_VIDEO_JOBS_QUEUE:{async send(body){messages.push(body);}},
    __TEST_FETCH:async(url,init)=>{
      if(url==='https://fixture.invalid/completion.mp4')return new Response(video,{headers:{'Content-Type':'video/mp4'}});
      check(url===`https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/ai/run`,'Unexpected completion fixture network');
      const body=JSON.parse(init.body);check(body.model==='minimax/h3','Exact H3 adapter');check(body.input.content.filter(c=>c.type!=='text').every(c=>c.role==='first_frame'),'Last-frame input becomes first_frame');calls.push(body);
      return Response.json({success:true,result:{state:'Completed',result:{task:{id:'synthetic-completion-'+calls.length,model:'MiniMax-H3',status:'succeeded',resolution:'768P',duration:4,content:{url:'https://fixture.invalid/completion.mp4'},usage:{output_seconds:4}}}}});
    }};
  await db.prepare("INSERT INTO users(id,email,password_hash,created_at,role,email_verified_at) VALUES(?,?,?,?,'user',?)").bind(owner,owner+'@example.invalid','synthetic',now,now).run();
  await db.prepare('INSERT INTO sessions(id,user_id,token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?)').bind(owner,owner,await sha256Hex(`${owner}:${env.SESSION_HASH_SECRET}`),now,new Date(Date.now()+3600000).toISOString(),now).run();
  await topUpMemberDailyCredits({env,userId:owner});await grantMemberCredits({env,userId:owner,amount:10000,createdByUserId:owner,idempotencyKey:'completion-credits'});
  await db.prepare("INSERT INTO canvas_projects(id,user_id,title,locale,created_at,updated_at) VALUES(?,?,'Completion chain','en',?,?)").bind(project,owner,now,now).run();
  const music=await saveAdminAiTextAsset(env,{userId:owner,sourceModule:'music',title:'Synthetic music',payload:{audioBytes:Uint8Array.from(atob(fixture.musicBase64),c=>c.charCodeAt(0)),mimeType:'audio/mpeg'}});
  for(let i=0;i<nodes.length;i++) {
    const model=i===6?'bytedance/seedance-2.5':'minimax/h3';
    await db.prepare("INSERT INTO canvas_nodes(id,project_id,user_id,type,title,model_id,x,y,config_json,content_json,created_at,updated_at) VALUES(?,?,?,'video_generation',?,?,?,50,?,'{}',?,?)")
      .bind(nodes[i],project,owner,i===6?'Final':i===7?'Out':i===8?'Next':'Clip '+(i+1),model,50+i*150,JSON.stringify({prompt:'Synthetic continuation',duration:4,resolution:'768P',aspectRatio:'adaptive',backgroundMusic:{enabled:true,gain:.5,musicAssetId:music.id}}),now,now).run();
    if(i)await db.prepare("INSERT INTO canvas_edges(id,project_id,user_id,source_node_id,target_node_id,config_json,created_at,updated_at) VALUES(?,?,?,?,?,'{}',?,?)").bind((await sha256Hex('completion-edge-'+i)).slice(0,32),project,owner,nodes[i-1],nodes[i],now,now).run();
    if(i<7) {
      const runId=(await sha256Hex('completion-run-'+i)).slice(0,32);
      await db.prepare("INSERT INTO canvas_runs(id,project_id,node_id,user_id,model_id,operation_type,status,idempotency_key,input_json,created_at,updated_at) VALUES(?,?,?,?,?,'canvas.video.generate','running',?,'{}',?,?)").bind(runId,project,nodes[i],owner,model,runId,now,now).run();
      await registerCanvasMedia(env,{runId,userId:owner,projectId:project,nodeId:nodes[i],kind:'video'});
      const asset=await saveGeneratedVideoAsset(env,{userId:owner,title:'Original '+i,videoBytes:video,mimeType:'video/mp4'});
      await db.prepare('UPDATE canvas_media_outputs SET asset_id=? WHERE run_id=?').bind(asset.id,runId).run();
      // Use the actual completion projection; no test-supplied sourceVersion.
      await finishCanvasGeneration(env,{user_id:owner,media_type:'video',request_key:'canvas-video-'+runId,usage_attempt_id:null},{data:{asset}});
    }
  }
  await db.prepare("INSERT INTO canvas_nodes(id,project_id,user_id,type,title,asset_id,x,y,config_json,content_json,created_at,updated_at) VALUES(?,?,?,'asset_reference','Music',?,50,350,'{}','{}',?,?)").bind(musicNode,project,owner,music.id,now,now).run();
  for(const node of nodes.slice(7))await db.prepare("INSERT INTO canvas_edges(id,project_id,user_id,source_node_id,target_node_id,config_json,created_at,updated_at) VALUES(?,?,?,?,?,'{\"purpose\":\"export_background_music\"}',?,?)").bind((await sha256Hex('completion-music-'+node)).slice(0,32),project,owner,musicNode,node,now,now).run();
  const request=async(url,method='GET',body,headers={})=>worker.fetch(new Request('https://bitbi.ai'+url,{method,headers:{Cookie:`__Host-bitbi_session=${owner}`,Origin:'https://bitbi.ai','X-Bitbi-Tariff-Revision':String((await getModelTariff(env)).revision),...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:typeof body==='string'?body:JSON.stringify(body)}:{})}),env,{waitUntil(p){waits.push(p);}});
  async function deliver({attachmentGap=false}={}) {
    let item;
    while(messages.length) {
      item=messages.shift();
      if(item.type===PRIVATE_MEDIA_WAKE){item=null;continue;}
      const job=await db.prepare('SELECT status FROM member_generation_jobs WHERE id=?').bind(item.job_id).first();
      if(!['preview_pending','succeeded'].includes(job?.status))break;
      item=null;
    }
    check(item?.job_id,'Expected a new accepted fixture job');
    await worker.queue({queue:'bitbi-ai-video-jobs',messages:[{body:item,attempts:1,ack(){},retry(){throw new Error('Unexpected fixture queue retry');}}]},env,{waitUntil(p){waits.push(p);}});await Promise.all(waits);
    const run=await db.prepare("SELECT * FROM canvas_runs WHERE user_id=? AND id=(SELECT substr(request_key,14) FROM member_generation_jobs WHERE id=?)").bind(owner,item.job_id).first();
    const jobState=await db.prepare('SELECT status,error_code FROM member_generation_jobs WHERE id=?').bind(item.job_id).first();
    check(run?.status==='completed',`Queue must write canonical Canvas output: ${run?.status}/${jobState?.status}/${jobState?.error_code}`);
    observations.push({runId:run.id,output:JSON.parse(run.output_json)});
    if(attachmentGap) {
      // Exercise the alternate browser attachment ingress with a durable result
      // and lagging Canvas projection. This is a controlled timing fault, not a
      // claim about the uncaptured timing of the production incident.
      await db.prepare("UPDATE canvas_runs SET status='failed',error_code='canvas_video_pending',output_json=? WHERE id=?").bind(JSON.stringify({videoJobId:item.job_id}),run.id).run();
      await db.prepare('UPDATE canvas_nodes SET output_json=NULL,asset_id=NULL WHERE id=?').bind(run.node_id).run();
    }
    return run;
  }
  async function prepare(index) {
    const source=await db.prepare('SELECT output_json FROM canvas_nodes WHERE id=?').bind(nodes[index-1]).first(),output=JSON.parse(source.output_json);
    const url=`/api/account/canvas/projects/${project}/edges/${(await sha256Hex('completion-edge-'+index)).slice(0,32)}`;
    let r=await request(url,'PATCH',{config:{videoInput:{modelId:'minimax/h3',assetId:output.assetId,runId:output.runId,method:'last_frame'}}});check(r.ok,'Prepare completed predecessor');let data=(await r.json()).data;
    r=await request(url,'PATCH',{config:data.edge.config,frame_image:'data:image/png;base64,'+fixture.imageBase64});check(r.ok,'Store exact last frame');
  }
  check((await request(`/api/account/canvas/projects/${project}/nodes/${musicNode}/asset-reference`,'POST',{asset_id:music.id})).ok,'Attach music through the real source metadata route');
  return {env,db,project,nodes,musicId:music.id,messages,calls,observations,request,deliver,prepare,owner};
}

export async function canvasCompletionCase(base, media) {
  const f=await canvasCompletionFixture(base,media), outputs=[];
  const data=async response=>{const body=await response.json();check(response.ok,`Completion API ${response.status}: ${body.code}`);return body.data;};
  const projectPath=`/api/account/canvas/projects/${f.project}`;
  for(const index of [7,8]) {
    await f.prepare(index);
    const path=`${projectPath}/nodes/${f.nodes[index]}/run`,headers={'Idempotency-Key':'completion-'+index};
    const accepted=await f.request(path,'POST',{},headers);
    check(accepted.status===202,`New completion accepted once: ${accepted.status} ${(await accepted.json()).code||''}`);
    await f.deliver({attachmentGap:index===7});
    const {run}=await data(await f.request(path,'POST',{},headers));
    check(run.status==='completed','Attached completion');
    const canonical=f.observations.at(-1).output;
    check(/^[a-f0-9]{64}$/.test(run.output.sourceVersion) && run.output.sourceVersion===canonical.sourceVersion,'Attach output retains independent queue/R2 version');
    const project=await data(await f.request(projectPath));
    check(project.nodes.find(n=>n.id===f.nodes[index]).output.sourceVersion===canonical.sourceVersion,'Reopen retains version');
    const fullPath=`${projectPath}/runs/${run.id}/full-video`,view=await data(await f.request(fullPath));
    check(view.eligible && !view.chain.error && view.chain.clips.length===index+1,'Full current strand remains extendable');
    check(JSON.stringify(view.chain.clips.map(c=>c.nodeId))===JSON.stringify(f.nodes.slice(0,index+1)),'Directed order excludes music and downstream node');
    const replay=await data(await f.request(path,'POST',{},headers));
    check(replay.run.id===run.id && f.calls.length===index-6,'No extra generation on attach, read or replay');
    outputs.push({runId:run.id,count:view.chain.clips.length,version:canonical.sourceVersion});
    if(index===8) for(const enabled of [false,true]) {
      const result=await data(await f.request(fullPath,'POST',{orderedClips:view.chain.clips.map(({runId,assetId,version})=>({runId,assetId,version})),mergeMode:'chain',backgroundMusic:{enabled,gain:.5,...(enabled?{musicAssetId:f.musicId}:{})}},{'Idempotency-Key':'completion-export-'+enabled}));
      check(result.export.recipe.videos.length===9 && result.export.recipe.spatialPolicy==='center-crop-v1','Same validated export recipe');
      check(Boolean(result.export.recipe.music)===enabled && result.export.recipe.backgroundMusic.gain===.5,'Music off needs no asset; on preserves selected gain');
    }
  }
  check(f.calls.length===2,'Exactly two synthetic provider calls for two new clips');
  // Keep shared native fixtures isolated; original test assets remain owned by
  // this dedicated synthetic member and are never visible to another fixture.
  await f.db.prepare('DELETE FROM canvas_projects WHERE id=? AND user_id=?').bind(f.project,f.owner).run();
  return {outputs,provider:'synthetic',providerCalls:f.calls.length};
}
