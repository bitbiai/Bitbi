import { canvasMergeView, canvasVideoSelection } from '../../workers/auth/src/lib/canvas-merge-selection.js';
import { canvasClipIdentity, canvasMergeStrand, canvasMergeSequence } from '../../js/shared/canvas-export.mjs';
import { registerCanvasMedia,canvasMediaEnvironment,reclaimCanvasMedia } from '../../workers/auth/src/lib/canvas-media-storage.js';
import worker from '../../workers/auth/src/index.js';
import { sha256Hex } from '../../workers/auth/src/lib/tokens.js';
import { saveGeneratedVideoAsset,saveAdminAiTextAsset } from '../../workers/auth/src/lib/ai-text-assets.js';
import { ownedCanvasVideo } from '../../workers/auth/src/lib/canvas-video-input.js';
import { canvasVideoChain, catchUpCanvasPosters, enqueueCanvasProcessing } from '../../workers/auth/src/lib/canvas-video-processing.js';
const check=(condition,message)=>{if(!condition)throw new Error(message);};
export async function canvasProcessingCase(base,fixture) {
  const now=new Date().toISOString(),owner='canvas-processing-owner',other='canvas-processing-other',project='1'.repeat(32),node='2'.repeat(32);
  const env={...base,MEMVID_STREAM_PREVIEW_PROCESSOR_SECRET:'synthetic-processor',PRIVATE_MEDIA_PROCESSOR_SECRET:'synthetic-container',ENABLE_HOMEPAGE_HERO_EXTERNAL_FFMPEG:'false'};
  const db=env.DB,video=Uint8Array.from(atob(fixture.videoBase64),c=>c.charCodeAt(0));
  for(const id of [owner,other]) {
    await db.prepare("INSERT INTO users(id,email,password_hash,created_at,role,email_verified_at) VALUES(?,?,?,?,'user',?)").bind(id,id+'@example.invalid','synthetic',now,now).run();
    await db.prepare('INSERT INTO sessions(id,user_id,token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?)').bind(id,id,await sha256Hex(`${id}:${env.SESSION_HASH_SECRET}`),now,new Date(Date.now()+3600000).toISOString(),now).run();
  }
  await db.prepare("INSERT INTO canvas_projects(id,user_id,title,created_at,updated_at) VALUES(?,?,'Synthetic chain',?,?)").bind(project,owner,now,now).run();
  await db.prepare("INSERT INTO canvas_nodes(id,project_id,user_id,type,x,y,created_at,updated_at) VALUES(?,?,?,'video_generation',0,0,?,?)").bind(node,project,owner,now,now).run();
  const sources=[],runs=[],nodes=[];
  for(let i=0;i<5;i++) {
    const asset=await saveGeneratedVideoAsset(env,{userId:owner,title:`Clip ${i+1}`,videoBytes:video,mimeType:'video/mp4'});
    const original=await ownedCanvasVideo(env,owner,asset.id),id=(await sha256Hex('canvas-run-'+i)).slice(0,32);
    const input=i?{connected_video_inputs:[{method:'last_frame',runId:runs[i-1],assetId:sources[i-1].id,frame:{version:sources[i-1].version}}]}:{};
    const output={kind:'video',assetId:asset.id,runId:id,sourceVersion:original.version,asset:{id:asset.id,file_url:asset.file_url}};
    const nodeId=i===3?node:(await sha256Hex('canvas-merge-node-'+i)).slice(0,32);
    if(nodeId!==node)await db.prepare("INSERT INTO canvas_nodes(id,project_id,user_id,type,x,y,created_at,updated_at) VALUES(?,?,?,'video_generation',0,0,?,?)").bind(nodeId,project,owner,now,now).run();
    await db.prepare('UPDATE canvas_nodes SET asset_id=?,output_json=?,title=? WHERE id=?').bind(asset.id,JSON.stringify(output),i<2?'Same title':'Clip '+(i+1),nodeId).run();
    nodes.push(nodeId);
    if(i)await db.prepare('INSERT INTO canvas_edges(id,project_id,user_id,source_node_id,target_node_id,config_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind((await sha256Hex('merge-edge-'+i)).slice(0,32),project,owner,nodes[i-1],nodeId,'{}',now,now).run();
    await db.prepare("INSERT INTO canvas_runs(id,project_id,node_id,user_id,model_id,operation_type,status,idempotency_key,input_json,output_json,asset_id,created_at,updated_at) VALUES(?,?,?,?,'pixverse/v6','canvas.video.generate','completed',?,?,?,?,?,?)")
      .bind(id,project,nodeId,owner,id,JSON.stringify(input),JSON.stringify(output),asset.id,now,now).run();
    await registerCanvasMedia(env,{runId:id,userId:owner,projectId:project,nodeId,kind:'video'});
    await db.prepare('UPDATE canvas_media_outputs SET asset_id=? WHERE run_id=?').bind(asset.id,id).run();
    sources.push(original);runs.push(id);
  }
  const request=(url,method='GET',body=null,{user=owner,token=null,key=null,container=false}={})=>worker.fetch(new Request('https://bitbi.ai'+url,{method,headers:{Origin:'https://bitbi.ai',Cookie:`__Host-bitbi_session=${user}`,
    ...(url.startsWith('/api/internal/')?{Authorization:container?'Bearer synthetic-container':'Bearer synthetic-processor'}:{}),...(key?{'Idempotency-Key':key}:{}),...(token?{'X-BITBI-Canvas-Claim':token}:{}),...(body && !(body instanceof FormData)?{'Content-Type':'application/json'}:{})},body:body?(body instanceof FormData?body:JSON.stringify(body)):undefined}),env,{waitUntil(){}});
  const payload=async response=>{const p=await response.json();check(response.ok,`${response.status}: ${JSON.stringify(p)}`);return p.data;};
  const api=`/api/account/canvas/projects/${project}/runs`,internal='/api/internal/homepage/hero-videos/canvas-exports/jobs';
  check(!(await payload(await request(`${api}/${runs[0]}/full-video`))).eligible,'First clip no export');
  check((await request(`${api}/${runs[1]}/full-video`,'POST',{}, {user:other})).status===404,'Foreign project denied');
  check((await canvasVideoChain(env,owner,project,runs[1])).length===2,'Two chain');
  check((await canvasVideoChain(env,owner,project,runs[4])).length===5,'Five chain');
  // Native edit/extension output already contains its immediate source. A prior
  // last-frame segment still belongs in the ordered export exactly once.
  const thirdInput=(await db.prepare('SELECT input_json FROM canvas_runs WHERE id=?').bind(runs[2]).first()).input_json;
  for(const method of ['edit','extend']) {
    const connected_video_inputs=[{method,runId:runs[1],assetId:sources[1].id,sourceVersion:sources[1].version}];
    await db.prepare('UPDATE canvas_runs SET input_json=? WHERE id=?').bind(JSON.stringify({connected_video_inputs}),runs[2]).run();
    const chain=await canvasVideoChain(env,owner,project,runs[2]);
    check(JSON.stringify(chain.map(s=>s.assetId))===JSON.stringify([sources[0].id,sources[2].id]),'Native output does not duplicate included source segment');
    connected_video_inputs[0].sourceVersion='stale';
    await db.prepare('UPDATE canvas_runs SET input_json=? WHERE id=?').bind(JSON.stringify({connected_video_inputs}),runs[2]).run();
    let rejected=false;try{await canvasVideoChain(env,owner,project,runs[2]);}catch(e){rejected=e.code==='video_source_changed';}check(rejected,'Native inclusion still validates exact source bytes');
  }
  await db.prepare('UPDATE canvas_runs SET input_json=? WHERE id=?').bind(thirdInput,runs[2]).run();
  // Mutable node output is irrelevant to an old chain, deleted/version-changed originals are not.
  await db.prepare('UPDATE canvas_nodes SET asset_id=? WHERE id=?').bind(sources[4].id,node).run();
  check((await canvasVideoChain(env,owner,project,runs[1]))[0].assetId===sources[0].id,'Historical parent not overwritten');
  await db.prepare('UPDATE canvas_nodes SET asset_id=? WHERE id=?').bind(sources[3].id,node).run();
  await mergeContractCases({env,owner,other,project,runs,sources,nodes,request,payload});
  const originalInput=(await db.prepare('SELECT input_json FROM canvas_runs WHERE id=?').bind(runs[0]).first()).input_json;
  await db.prepare('UPDATE canvas_runs SET input_json=? WHERE id=?').bind(JSON.stringify({connected_video_inputs:[{method:'last_frame',runId:runs[1],assetId:sources[1].id,frame:{version:sources[1].version}}]}),runs[0]).run();
  let cycle=false;try{await canvasVideoChain(env,owner,project,runs[1]);}catch(e){cycle=e.code==='canvas_chain_cycle';}check(cycle,'Cycle rejected');
  await db.prepare('UPDATE canvas_runs SET input_json=? WHERE id=?').bind(originalInput,runs[0]).run();
  const childInput=(await db.prepare('SELECT input_json FROM canvas_runs WHERE id=?').bind(runs[1]).first()).input_json;
  const stale=JSON.parse(childInput);stale.connected_video_inputs[0].frame.version='wrong';
  await db.prepare('UPDATE canvas_runs SET input_json=? WHERE id=?').bind(JSON.stringify(stale),runs[1]).run();
  let changed=false;try{await canvasVideoChain(env,owner,project,runs[1]);}catch(e){changed=e.code==='video_source_changed';}check(changed,'Changed original rejected');
  await db.prepare('UPDATE canvas_runs SET input_json=? WHERE id=?').bind(childInput,runs[1]).run();
  check((await request(`${api}/${runs[4]}/full-video`,'POST',{})).status===409,'Fresh render requires a versioned idempotent intent');
  // Historical queued jobs retain their original identity and recovery path.
  await enqueueCanvasProcessing(env,{userId:owner,projectId:project,runId:runs[4],kind:'concat',sources:await canvasVideoChain(env,owner,project,runs[4])});
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
  check(saved.preview_base?.file_url===saved.asset.file_url,'Known legacy unmixed aggregate is its own clean base');
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
  await recipeCases({env,owner,other,project,node,run:runs[3],request,payload,form,fixture});
  await selectionCases({env,owner,other,project,runs,sources,request,payload});
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

async function mergeContractCases({env,owner,other,project,runs,sources,nodes,request,payload}) {
  const db=env.DB,url=`/api/account/canvas/projects/${project}/runs/${runs[2]}/full-video`;
  const view=async()=>payload(await request(url));
  const original=await view();
  check(original.availableClips.length===5 && original.availableClips[0].nodeId,'Current nodes define candidate membership');
  check(original.availableClips.filter(c=>c.title==='Same title').length===2,'Duplicate live titles retain distinct identities');
  const backgroundMusic={enabled:false,gain:1},orderedClips=[0,1,2].map(i=>({runId:runs[i],assetId:sources[i].id,version:sources[i].version}));
  check(JSON.stringify(original.chain.clips.map(c=>c.runId))===JSON.stringify(runs.slice(0,3)),'A → B → C includes endpoint, excludes downstream');
  const post=()=>request(url,'POST',{backgroundMusic,orderedClips},{key:'stale-selection-guard'});
  const row=await db.prepare('SELECT output_json,asset_id,type FROM canvas_nodes WHERE id=?').bind(nodes[0]).first();
  const projectCount=(await db.prepare('SELECT COUNT(*) n FROM canvas_projects').first()).n;
  const otherProject=(await sha256Hex('canvas-merge-cross-project')).slice(0,32);
  await db.prepare("INSERT INTO canvas_projects(id,user_id,title,created_at,updated_at) VALUES(?,?,'Other project',?,?)").bind(otherProject,owner,new Date().toISOString(),new Date().toISOString()).run();
  for(const patch of [
    ['deleted_at',new Date().toISOString()],['project_id',otherProject],
    ['output_json',JSON.stringify({kind:'image',runId:runs[0],assetId:sources[0].id,sourceVersion:sources[0].version})],
    ['output_json',JSON.stringify({kind:'video',runId:runs[1],assetId:sources[1].id,sourceVersion:sources[1].version})],
    ['asset_id',sources[1].id],['user_id',other],
  ]) {
    await db.prepare(`UPDATE canvas_nodes SET ${patch[0]}=? WHERE id=?`).bind(patch[1],nodes[0]).run();
    check(!(await view()).availableClips.some(c=>c.runId===runs[0]),'Deleted, replaced, non-video or foreign node excluded');
    check((await post()).status===409,'Stale direct new-job request rejected');
    await db.prepare(`UPDATE canvas_nodes SET ${patch[0]}=? WHERE id=?`).bind(patch[0]==='deleted_at'?null:patch[0]==='user_id'?owner:patch[0]==='project_id'?project:row[patch[0]],nodes[0]).run();
  }
  await db.prepare("UPDATE ai_text_assets SET mime_type='audio/mpeg' WHERE id=?").bind(sources[0].id).run();
  check(!(await view()).availableClips.some(c=>c.runId===runs[0]) && (await post()).status===409,'Video labels/model names cannot override authoritative non-video MIME');
  await db.prepare("UPDATE ai_text_assets SET mime_type='video/mp4' WHERE id=?").bind(sources[0].id).run();
  // Same run history remains present but an unselected output cannot leak in.
  const historical=(await sha256Hex('unselected-history')).slice(0,32);
  await db.prepare(`INSERT INTO canvas_runs(id,project_id,node_id,user_id,model_id,operation_type,status,idempotency_key,input_json,output_json,asset_id,created_at,updated_at)
    SELECT ?,project_id,node_id,user_id,model_id,operation_type,status,?,'{}',output_json,asset_id,created_at,updated_at FROM canvas_runs WHERE id=?`).bind(historical,historical,runs[0]).run();
  check(!(await view()).availableClips.some(c=>c.runId===historical),'Unselected historical run excluded');
  await db.prepare('DELETE FROM canvas_runs WHERE id=?').bind(historical).run();
  await db.prepare('UPDATE canvas_nodes SET title=? WHERE id=?').bind('Live renamed title',nodes[0]).run();
  check((await view()).availableClips.find(c=>c.runId===runs[0]).title==='Live renamed title','Rename uses live node, no generation');
  await db.prepare("UPDATE canvas_nodes SET title='Same title' WHERE id=?").bind(nodes[0]).run();
  // Replace C → D by sibling B → D. E remains downstream of D, outside C's strand.
  const branch=await db.prepare('SELECT id,source_node_id FROM canvas_edges WHERE target_node_id=?').bind(nodes[3]).first();
  await db.prepare('UPDATE canvas_edges SET source_node_id=? WHERE id=?').bind(nodes[1],branch.id).run();
  check(JSON.stringify((await view()).chain.clips.map(c=>c.runId))===JSON.stringify(runs.slice(0,3)),'Sibling strand never enters the sequence');
  const edgeId='e'.repeat(32),now=new Date().toISOString();
  const link=async(source,target)=>db.prepare('INSERT INTO canvas_edges(id,project_id,user_id,source_node_id,target_node_id,config_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(edgeId,project,owner,source,target,'{}',now,now).run();
  await link(nodes[4],nodes[2]);check((await view()).chain.error==='canvas_chain_ambiguous','Several upstream video branches are explicit');
  check((await request(url,'POST',{backgroundMusic,orderedClips,mergeMode:'chain'},{key:'ambiguous-chain-key'})).status===409,'Direct ambiguous chain blocked');
  await db.prepare('DELETE FROM canvas_edges WHERE id=?').bind(edgeId).run();
  await link(nodes[2],nodes[0]);check((await view()).chain.error==='canvas_chain_cycle','Current graph cycle blocked');
  await db.prepare('DELETE FROM canvas_edges WHERE id=?').bind(edgeId).run();
  await db.prepare('UPDATE canvas_edges SET source_node_id=? WHERE id=?').bind(branch.source_node_id,branch.id).run();
  for(const method of ['edit','extend']) {
    const old=(await db.prepare('SELECT input_json FROM canvas_runs WHERE id=?').bind(runs[2]).first()).input_json;
    await db.prepare('UPDATE canvas_runs SET input_json=? WHERE id=?').bind(JSON.stringify({connected_video_inputs:[{method,runId:runs[1],assetId:sources[1].id,sourceVersion:sources[1].version}]}),runs[2]).run();
    check(JSON.stringify((await view()).chain.clips.map(c=>c.runId))===JSON.stringify([runs[0],runs[2]]),'Native edit/extend does not repeat contained segment');
    await db.prepare('UPDATE canvas_runs SET input_json=? WHERE id=?').bind(old,runs[2]).run();
  }
  // Mutation precisely between validated selection and INSERT, using the actual SQL
  // admission statement (also executed by the native D1 suite).
  const before=(await db.prepare('SELECT COUNT(*) n FROM canvas_video_processing').first()).n;
  const selection=await canvasVideoSelection(env,owner,project,runs[2],orderedClips,'chain');
  await db.prepare('UPDATE canvas_nodes SET deleted_at=? WHERE id=?').bind(now,nodes[0]).run();
  let blocked=false;try{await enqueueCanvasProcessing(env,{userId:owner,projectId:project,runId:runs[2],kind:'concat',sources:selection.videos,admission:selection.admission,requestKey:'atomic-race-selection',recipe:{version:2,videos:selection.videos,backgroundMusic}});}catch(e){blocked=e.code==='canvas_selection_changed';}
  check(blocked && (await db.prepare('SELECT COUNT(*) n FROM canvas_video_processing').first()).n===before,'Deletion during admission creates no job');
  await db.prepare('UPDATE canvas_nodes SET deleted_at=NULL WHERE id=?').bind(nodes[0]).run();
  await db.prepare('UPDATE canvas_nodes SET output_json=? WHERE id=?').bind(JSON.stringify({...JSON.parse(row.output_json),sourceVersion:'f'.repeat(64)}),nodes[0]).run();
  blocked=false;try{await enqueueCanvasProcessing(env,{userId:owner,projectId:project,runId:runs[2],kind:'concat',sources:selection.videos,admission:selection.admission,requestKey:'atomic-replacement-key',recipe:{version:2,videos:selection.videos,backgroundMusic}});}catch(e){blocked=e.code==='canvas_selection_changed';}
  check(blocked,'Output replacement between validation and insertion blocks new work');
  await db.prepare('UPDATE canvas_nodes SET output_json=? WHERE id=?').bind(row.output_json,nodes[0]).run();
  await link(nodes[4],nodes[2]);
  blocked=false;try{await enqueueCanvasProcessing(env,{userId:owner,projectId:project,runId:runs[2],kind:'concat',sources:selection.videos,admission:selection.admission,requestKey:'atomic-new-branch-key',recipe:{version:2,videos:selection.videos,backgroundMusic}});}catch(e){blocked=e.code==='canvas_selection_changed';}
  check(blocked,'An upstream branch added during admission cannot silently change the previewed chain');
  await db.prepare('DELETE FROM canvas_edges WHERE id=?').bind(edgeId).run();
  await db.prepare('DELETE FROM canvas_projects WHERE id=?').bind(otherProject).run();
  check((await db.prepare('SELECT COUNT(*) n FROM canvas_projects').first()).n===projectCount,'The fixture restores shared project state before the next native caller');
  const graph=await canvasMergeView(env,owner,project,runs[2]);
  const missing=canvasMergeStrand(graph.nodes.filter(n=>n.id!==nodes[0]),graph.edges,nodes[2]);
  check(missing.error==='canvas_chain_broken','A dangling link is never skipped');
  check(canvasMergeSequence(canvasMergeStrand(graph.nodes,graph.edges,nodes[2]),graph.availableClips.filter(c=>c.runId!==runs[1])).error==='canvas_chain_unavailable','Required unavailable video is not skipped');
}

async function selectionCases({env,owner,other,project,runs,sources,request,payload}) {
  const db=env.DB,run=runs[1],url=`/api/account/canvas/projects/${project}/runs/${run}/full-video`,internal='/api/internal/homepage/hero-videos/canvas-exports/jobs';
  const before=await db.prepare('SELECT model_id,input_json FROM canvas_runs WHERE id=?').bind(run).first();
  const reference={generation:{references:[{role:'reference_video',source:{assetId:sources[0].id}}]},used_sources:[{runId:runs[0],assetId:sources[0].id,version:sources[0].version}]};
  await db.prepare('UPDATE canvas_runs SET model_id=?,input_json=? WHERE id=?').bind('bytedance/seedance-2.5',JSON.stringify(reference),run).run();
  const view=await payload(await request(url));
  check(view.eligible && view.clips===2 && view.availableClips.length===5,'Current graph, not historical reference ancestry, defines the automatic strand');
  const backgroundMusic={enabled:false,gain:1},orderedClips=[0,1].map(i=>({runId:runs[i],assetId:sources[i].id,version:sources[i].version}));
  const post=(clips,key='explicit-clips-key-1',options={})=>request(url,'POST',{backgroundMusic,orderedClips:clips},{key,...options});
  check((await request(url,'POST',{backgroundMusic,orderedClips:[...orderedClips].reverse(),mergeMode:'chain'},{key:'automatic-reference-key'})).status===409,'Automatic mode must match current directed order');
  for(const invalid of [[],[orderedClips[1]],orderedClips.concat(orderedClips[0]),[orderedClips[0],{...orderedClips[1],version:'0'.repeat(64)}],[orderedClips[0],{...orderedClips[1],assetId:sources[2].id}],[orderedClips[0],{...orderedClips[1],runId:'f'.repeat(32)}]])
    check((await post(invalid)).status===409,'Missing, duplicate, changed or unauthoritative selection rejected');
  check((await post(orderedClips,'foreign-project-key',{user:other})).status===404,'Other owner cannot select private clips');
  await db.prepare('UPDATE ai_text_assets SET user_id=? WHERE id=?').bind(other,sources[0].id).run();
  const foreign=await post(orderedClips);check(foreign.status===409&&(await foreign.json()).code==='canvas_selection_changed','Foreign source cannot be selected');
  await db.prepare('UPDATE ai_text_assets SET user_id=? WHERE id=?').bind(owner,sources[0].id).run();
  for(const method of ['edit','extend']){
    await db.prepare('UPDATE canvas_runs SET input_json=? WHERE id=?').bind(JSON.stringify({connected_video_inputs:[{method,runId:runs[0],assetId:sources[0].id,sourceVersion:sources[0].version}]}),run).run();
    const r=await post(orderedClips);check(r.status===409&&(await r.json()).code==='canvas_sequence_included','Native included segments cannot be duplicated by explicit selection');
  }
  await db.prepare('UPDATE canvas_runs SET input_json=? WHERE id=?').bind(JSON.stringify(reference),run).run();
  const created=(await payload(await post(orderedClips))).export;
  check(created.recipe.version===2 && created.recipe.spatialPolicy==='center-crop-v1' && created.recipe.sequence==='explicit','New recipe pins center-crop policy and explicit intent');
  check(JSON.stringify(created.recipe.videos.map(s=>s.runId))===JSON.stringify([runs[0],run]),'Explicit clip order reaches immutable recipe');
  check((await payload(await post(orderedClips))).export.id===created.id,'Lost-response replay does not enqueue another render');
  check((await post([...orderedClips].reverse())).status===409,'Replay cannot silently reorder');
  await db.prepare('UPDATE canvas_nodes SET deleted_at=? WHERE id=(SELECT node_id FROM canvas_runs WHERE id=?)').bind(new Date().toISOString(),runs[0]).run();
  check((await payload(await post(orderedClips))).export.id===created.id,'Already accepted job survives graph deletion and lost response');
  check((await post(orderedClips,'new-after-delete-key')).status===409,'Fresh job cannot reuse the deleted node');
  await db.prepare('UPDATE canvas_nodes SET deleted_at=NULL WHERE id=(SELECT node_id FROM canvas_runs WHERE id=?)').bind(runs[0]).run();
  check((await payload(await request(internal+'/claim','POST',{protocol:1,recipeProtocol:2,limit:3},{container:true}))).jobs.length===0,'Old processor cannot claim a new crop recipe');
  const job=(await payload(await request(internal+'/claim','POST',{protocol:1,recipeProtocol:3,limit:1},{container:true}))).jobs[0];
  check(job.id===created.id && job.spatialPolicy==='center-crop-v1' && job.sources.length===2,'Actual processor admission carries exact new policy');
  check((await db.prepare('SELECT input_json FROM canvas_runs WHERE id=?').bind(run).first()).input_json===JSON.stringify(reference),'Explicit export never rewrites provenance');
  const legacyRecipe={version:1,videos:created.recipe.videos,music:null,backgroundMusic};
  const legacy=await enqueueCanvasProcessing(env,{userId:owner,projectId:project,runId:run,kind:'concat',recipe:legacyRecipe,requestKey:'pre-deployment-key-1',sources:created.recipe.videos});
  const replay=await payload(await request(url,'POST',{backgroundMusic},{key:'pre-deployment-key-1'}));
  check(replay.export.id===legacy.id&&replay.export.recipe.version===1,'In-flight pre-deployment key retains old recipe without a new render');
  const old=(await payload(await request(internal+'/claim','POST',{protocol:1,recipeProtocol:2,limit:1},{container:true}))).jobs[0];
  check(old.id===legacy.id && old.spatialPolicy==='legacy-pad-v1','Old queued recipe remains claimable under old capability');
  const automatic=(await payload(await request(url,'POST',{backgroundMusic,orderedClips,mergeMode:'chain'},{key:'current-chain-key-1'}))).export;
  check(automatic.id!==created.id && automatic.recipe.mergeMode==='chain','Explicit chain intent creates its own immutable version');
  const automaticJob=(await payload(await request(internal+'/claim','POST',{protocol:1,recipeProtocol:3,limit:1},{container:true}))).jobs[0];
  check(automaticJob.id===automatic.id && automaticJob.sources.length===2 && automaticJob.spatialPolicy==='center-crop-v1','Automatic and manual modes use the same real processor admission');
  await db.prepare('UPDATE canvas_video_processing SET attempt_count=7 WHERE id=?').bind(automaticJob.id).run();
  await payload(await request(automaticJob.completion.failure_url,'POST',{code:'canvas_synthetic_retry'},{container:true,token:automaticJob.claim}));
  await payload(await request(job.completion.failure_url,'POST',{code:'canvas_synthetic_retry'},{container:true,token:job.claim}));
  await db.prepare("UPDATE canvas_video_processing SET next_attempt_at='2000-01-01' WHERE id=?").bind(job.id).run();
  const retry=(await payload(await request(internal+'/claim','POST',{protocol:1,recipeProtocol:3,limit:1},{container:true}))).jobs[0];
  check(retry.id===job.id&&retry.claim!==job.claim&&retry.spatialPolicy==='center-crop-v1','Processing retry preserves crop recipe and replaces lease');
  check((await request(job.sources[0].url,'GET',null,{container:true,token:job.claim})).status===409,'Prior crop lease cannot read after retry');
  for(const ended of [retry,old]){
    await db.prepare('UPDATE canvas_video_processing SET attempt_count=7 WHERE id=?').bind(ended.id).run();
    await payload(await request(ended.completion.failure_url,'POST',{code:'canvas_synthetic_end'},{container:true,token:ended.claim}));
  }
  await db.prepare('UPDATE canvas_runs SET model_id=?,input_json=? WHERE id=?').bind(before.model_id,before.input_json,run).run();
  check((await db.prepare('SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=?').bind(owner).first()).n===0,'Selection/merging never debits credits');
}

async function recipeCases({env,owner,other,project,node,run,request,payload,form,fixture}) {
  const db=env.DB,now=new Date().toISOString(),musicNode=(await sha256Hex('export-music-node')).slice(0,32),edge=(await sha256Hex('export-music-edge')).slice(0,32);
  const wav=new Uint8Array(46),view=new DataView(wav.buffer);
  for(const [offset,text] of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']])for(let i=0;i<text.length;i++)wav[offset+i]=text.charCodeAt(i);
  view.setUint32(4,38,true);view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,48000,true);view.setUint32(28,96000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);view.setUint32(40,2,true);
  const music=await saveAdminAiTextAsset(env,{userId:owner,sourceModule:'music',title:'Synthetic music',payload:{audioBytes:wav,mimeType:'audio/wav'}});
  await db.prepare("INSERT INTO canvas_nodes(id,project_id,user_id,type,asset_id,x,y,created_at,updated_at) VALUES(?,?,?,'asset_reference',?,0,0,?,?)").bind(musicNode,project,owner,music.id,now,now).run();
  await db.prepare("INSERT INTO canvas_edges(id,project_id,user_id,source_node_id,target_node_id,config_json,created_at,updated_at) VALUES(?,?,?,?,?,'{\"purpose\":\"export_background_music\"}',?,?)").bind(edge,project,owner,musicNode,node,now,now).run();
  const url=`/api/account/canvas/projects/${project}/runs/${run}/full-video`,internal='/api/internal/homepage/hero-videos/canvas-exports/jobs';
  const submit=(gain,key)=>request(url,'POST',{backgroundMusic:{enabled:true,gain}},{key});
  check((await submit(1.01,'invalid-gain-key-1')).status===400,'Gain cannot amplify');
  check((await submit('0.5','invalid-gain-key-2')).status===400,'Gain coercion forbidden');
  const extraNode=(await sha256Hex('export-extra-music-node')).slice(0,32),extraEdge=(await sha256Hex('export-extra-music-edge')).slice(0,32);
  await db.prepare("INSERT INTO canvas_nodes(id,project_id,user_id,type,asset_id,x,y,created_at,updated_at) VALUES(?,?,?,'asset_reference',?,0,0,?,?)").bind(extraNode,project,owner,music.id,now,now).run();
  await db.prepare("INSERT INTO canvas_edges(id,project_id,user_id,source_node_id,target_node_id,config_json,created_at,updated_at) VALUES(?,?,?,?,?,'{\"purpose\":\"export_background_music\"}',?,?)").bind(extraEdge,project,owner,extraNode,node,now,now).run();
  const ambiguous=await submit(0.5,'ambiguous-music-key');
  check(ambiguous.status===409 && (await ambiguous.json()).code==='canvas_music_ambiguous','Several music edges never silently choose a track');
  const selection=(musicAssetId,key)=>request(url,'POST',{backgroundMusic:{enabled:true,gain:0.5,musicAssetId}},{key});
  check((await selection('not-an-id','selected-music-invalid')).status===400,'Strict selected identity');
  check((await selection('f'.repeat(32),'selected-music-unconnected')).status===409,'Unconnected music is not an export source');
  check((await selection(music.id,'selected-music-duplicate')).status===409,'Duplicate selected edges stay ambiguous');
  await db.prepare('UPDATE canvas_edges SET deleted_at=? WHERE id=?').bind(now,extraEdge).run();
  await db.prepare('UPDATE ai_text_assets SET user_id=? WHERE id=?').bind(other,music.id).run();
  const foreignMusic=await submit(0.5,'foreign-music-key');
  check(foreignMusic.status===409 && (await foreignMusic.json()).code==='canvas_music_unavailable','Foreign music cannot enter an export recipe');
  await db.prepare('UPDATE ai_text_assets SET user_id=? WHERE id=?').bind(owner,music.id).run();
  const a=(await payload(await submit(0.5,'recipe-first-key-1'))).export;
  check((await payload(await submit(0.5,'recipe-first-key-1'))).export.id===a.id,'Duplicate recipe key reused');
  check((await submit(0.8,'recipe-first-key-1')).status===409,'Key cannot change recipe');
  check((await payload(await request(internal+'/claim','POST',{protocol:1,limit:3},{container:true}))).jobs.length===0,'Old container cannot consume a music recipe');
  const claim=async()=> (await payload(await request(internal+'/claim','POST',{protocol:1,recipeProtocol:3,limit:1},{container:true}))).jobs[0];
  const finish=async(job,{retainBase=true}={})=>{
    if(retainBase && job.backgroundMusic?.gain>0)await payload(await request(job.completion.url+'?part=preview-base','POST',form(),{token:job.claim,container:true}));
    await payload(await request(job.completion.url,'POST',form(),{token:job.claim,container:true}));
    // Real existing poster completion entrypoint, not a fabricated ready flag.
    const posterBase='/api/internal/homepage/hero-videos/source-posters/jobs';
    const posters=await payload(await request(posterBase+'/claim?member_only=true','POST',{member_only:true,limit:8}));
    const poster=posters.jobs.find(p=>p.id===job.id);check(poster,'Export poster claimed');
    const data=new FormData();data.set('poster',new Blob([Uint8Array.from(atob(fixture.imageBase64),c=>c.charCodeAt(0))],{type:'image/png'}),'poster.png');
    const response=await worker.fetch(new Request('https://bitbi.ai'+poster.completion.url,{method:'POST',headers:{Authorization:'Bearer synthetic-processor','X-BITBI-Generation-Claim':poster.generation_claim},body:data}),env,{waitUntil(){}});
    check(response.ok,'Export poster completes');
  };
  const aj=await claim();check(aj.id===a.id && aj.sources.at(-1).kind==='music' && aj.backgroundMusic.gain===0.5,'Recipe reaches actual processor claim');
  const source=await request(aj.sources.at(-1).url,'GET',null,{token:aj.claim,container:true});check(source.ok && (await source.arrayBuffer()).byteLength===wav.length,'Music protected download');
  check((await request(aj.sources.at(-1).url,'GET',null,{token:aj.claim})).status===409,'Other processor credential rejected');
  const musicKey=(await db.prepare('SELECT r2_key FROM ai_text_assets WHERE id=?').bind(music.id).first()).r2_key;
  const replaced=new Uint8Array(wav.length+2);replaced.set(wav);replaced[44]=1;await env.USER_IMAGES.put(musicKey,replaced);
  const changed=await request(aj.sources.at(-1).url,'GET',null,{token:aj.claim,container:true});
  check(changed.status===409 && (await changed.json()).code==='canvas_music_changed','Actual protected source route rejects changed music bytes');
  check((await request(aj.completion.url,'POST',form(),{token:aj.claim,container:true})).status===409,'Completion revalidates music version');
  check(!await db.prepare('SELECT id FROM ai_text_assets WHERE id=?').bind(a.id).first(),'Changed source stores no export');
  await env.USER_IMAGES.put(musicKey,wav,{httpMetadata:{contentType:'audio/wav'}});
  let held=false;try{await db.prepare('DELETE FROM ai_text_assets WHERE id=?').bind(music.id).run();}catch(e){held=String(e).includes('canvas_export_in_use');}check(held,'In-flight source retained');
  await payload(await request(aj.completion.url+'?part=preview-base','POST',form(),{token:aj.claim,container:true}));
  const reserved=(await db.prepare('SELECT used_bytes FROM user_asset_storage_usage WHERE user_id=?').bind(owner).first()).used_bytes;
  await payload(await request(aj.completion.url+'?part=preview-base','POST',form(),{token:aj.claim,container:true}));
  check((await db.prepare('SELECT used_bytes FROM user_asset_storage_usage WHERE user_id=?').bind(owner).first()).used_bytes===reserved,'Repeated clean-base upload reserves storage exactly once');
  await finish(aj);
  const clean=(await payload(await request(url))).current.preview_base;
  check(clean?.export_id===a.id,'Completed mixed export exposes its own clean base');
  const baseRead=await request(clean.file_url);check(baseRead.ok && (await baseRead.arrayBuffer()).byteLength===form().get('video').size,'Actual owner reads retained clean base');
  check((await request(clean.file_url,'GET',null,{user:other})).status===404,'Foreign base read denied');
  check((await request(aj.completion.url+'?part=preview-base','POST',form(),{token:aj.claim,container:true})).status===409,'Completed lease cannot replace clean base');
  check(!(await payload(await request('/api/ai/assets?limit=60'))).assets.some(item=>item.id===a.id),'Unsaved aggregate hidden');
  const b=(await payload(await submit(1,'recipe-second-key'))).export,bj=await claim();
  check(b.id!==a.id,'Gain changes identity');
  check((await payload(await request(url))).current.id===a.id,'Old preview remains during rendering');
  const [savedWhileReplacing]=await Promise.all([request(url,'POST',{saveExportId:a.id}),finish(bj)]);
  check(savedWhileReplacing.ok,'Save winning the replacement race is acknowledged');
  check((await payload(await request(url))).current.id===b.id,'Successful replacement current');
  await reclaimCanvasMedia(env,owner);
  check(await db.prepare('SELECT id FROM ai_text_assets WHERE id=?').bind(a.id).first(),'Saved exact version survives replacement');
  check((await request(clean.file_url)).ok,'Saved version retains its clean base');
  const oldBase=(await db.prepare('SELECT preview_base_key FROM canvas_video_processing WHERE id=?').bind(b.id).first()).preview_base_key;
  const c=(await payload(await submit(0,'recipe-late-key-1'))).export,cj=await claim();
  const d=(await payload(await submit(0.25,'recipe-latest-key'))).export,dj=await claim();
  await finish(dj);await finish(cj);
  check((await payload(await request(url))).current.id===d.id,'Late older result never wins');
  await reclaimCanvasMedia(env,owner);
  check(!await db.prepare('SELECT id FROM ai_text_assets WHERE id=?').bind(b.id).first(),'Previous unsaved aggregate reclaimed');
  const retiredBase=await db.prepare('SELECT preview_base_key,preview_base_bytes FROM canvas_video_processing WHERE id=?').bind(b.id).first();
  check(retiredBase.preview_base_key===null && retiredBase.preview_base_bytes===0,'Retirement releases only unsaved base storage');
  check((await db.prepare('SELECT COUNT(*) n FROM r2_cleanup_live_references WHERE r2_key=?').bind(oldBase).first()).n===0,'Retired derivative no longer protected from managed cleanup');
  check(!await db.prepare('SELECT id FROM ai_text_assets WHERE id=?').bind(c.id).first(),'Late unsaved aggregate reclaimed');
  check((await request(url,'POST',{saveExportId:c.id})).status===409,'Delete wins: save cannot resurrect');
  check((await request(url,'POST',{saveExportId:d.id},{user:other})).status===404,'Foreign save denied');
  const e=(await payload(await submit(0.7,'recipe-failed-key'))).export,ej=await claim();
  await payload(await request(ej.completion.url+'?part=preview-base','POST',form(),{token:ej.claim,container:true}));
  await db.prepare('UPDATE canvas_video_processing SET attempt_count=7 WHERE id=?').bind(e.id).run();
  await payload(await request(ej.completion.failure_url,'POST',{code:'canvas_synthetic_failure'},{token:ej.claim,container:true}));
  const state=await payload(await request(url));check(state.export.status==='failed' && state.current.id===d.id,'Failed render preserves successful preview');
  const failedUsage=(await db.prepare('SELECT used_bytes FROM user_asset_storage_usage WHERE user_id=?').bind(owner).first()).used_bytes;
  await reclaimCanvasMedia(env,other);
  check((await db.prepare('SELECT preview_base_bytes FROM canvas_video_processing WHERE id=?').bind(e.id).first()).preview_base_bytes>0,'An owner-scoped sweep cannot retire another owner\'s base');
  await reclaimCanvasMedia(env,owner);
  check((await db.prepare('SELECT preview_base_bytes FROM canvas_video_processing WHERE id=?').bind(e.id).first()).preview_base_bytes===0,'Failed render releases retained base');
  check((await db.prepare('SELECT used_bytes FROM user_asset_storage_usage WHERE user_id=?').bind(owner).first()).used_bytes===failedUsage-form().get('video').size,'Failed-base cleanup releases exactly its storage');
  check((await db.prepare('SELECT COUNT(*) n FROM member_credit_ledger WHERE user_id=?').bind(owner).first()).n===0,'Exports never debit');
  // Saved exact version is protected even after it becomes eligible for cleanup.
  await payload(await request(url,'POST',{saveExportId:d.id}));
  await reclaimCanvasMedia(env,owner);
  check(await db.prepare('SELECT id FROM ai_text_assets WHERE id=?').bind(d.id).first(),'Save wins: cleanup cannot delete');
  let immutable=false;try{await db.prepare("UPDATE canvas_video_processing SET recipe_json='{}' WHERE id=?").bind(d.id).run();}catch(e){immutable=String(e).includes('canvas_export_recipe_immutable');}check(immutable,'Recipe cannot mutate after export');
  const secondMusic=await saveAdminAiTextAsset(env,{userId:owner,sourceModule:'music',title:'Second synthetic track',payload:{audioBytes:wav,mimeType:'audio/wav'}});
  await db.prepare('UPDATE canvas_nodes SET asset_id=? WHERE id=?').bind(secondMusic.id,extraNode).run();
  await db.prepare('UPDATE canvas_edges SET deleted_at=NULL WHERE id=?').bind(extraEdge).run();
  const selected=(await payload(await selection(secondMusic.id,'selected-music-valid-key'))).export;
  check(selected.recipe.music.assetId===secondMusic.id && selected.recipe.backgroundMusic.musicAssetId===secondMusic.id,'Explicit selection resolves exactly the connected owned track');
  const selectedJob=await claim();check(selectedJob.id===selected.id,'Selected recipe reaches existing processor');
  // Rolling deployment/legacy mixed completion: no base uploaded, never claim
  // the already-mixed result is clean. Existing completed video remains usable.
  await finish(selectedJob,{retainBase:false});
  const legacyMixed=(await payload(await request(url))).current;
  check(legacyMixed.asset?.id===selected.id && legacyMixed.preview_base===null,'Mixed export without a retained clean base is explicitly unavailable for audition');
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
