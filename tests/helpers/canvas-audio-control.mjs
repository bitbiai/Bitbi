// Reuse the existing authenticated Worker/D1/R2 fixture. All provider responses
// are synthetic; imports use the real upload and Asset Reference endpoints.
import worker from '../../workers/auth/src/index.js';
import { canvasCompletionFixture } from './canvas-completion-control.mjs';
import { canvasClipIdentity } from '../../js/shared/canvas-export.mjs';
const check=(value,message)=>{if(!value)throw new Error(message);};
export async function canvasAudioFixture(base,media) {
  const f=await canvasCompletionFixture(base,{...media,scope:media.scope||'audio'}),projectPath=`/api/account/canvas/projects/${f.project}`;
  f.env.PRIVATE_MEDIA_PROCESSOR_SECRET='synthetic-audio-processor';
  const request=(url,method='GET',body,headers={})=>worker.fetch(new Request('https://bitbi.ai'+url,{method,headers:{Origin:'https://bitbi.ai',Cookie:`__Host-bitbi_session=${f.owner}`,...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:body instanceof FormData||typeof body==='string'?body:JSON.stringify(body)}:{})}),f.env,{waitUntil(){}});
  const data=async response=>{const body=await response.json();check(response.ok,`${response.status}: ${body.code||body.error}`);return body.data;};
  // Keep two existing generated outputs. No provider call is used to seed them.
  await f.db.prepare('UPDATE canvas_nodes SET deleted_at=? WHERE project_id=? AND id NOT IN (?,?,?)').bind(new Date().toISOString(),f.project,f.nodes[0],f.nodes[1],f.nodes[10]||'none').run();
  await f.db.prepare('DELETE FROM canvas_edges WHERE project_id=?').bind(f.project).run();
  const form=new FormData();form.set('file',new File([Uint8Array.from(atob(media.importVideoBase64||media.videoBase64),c=>c.charCodeAt(0))],'import.mp4',{type:'video/mp4'}));
  const upload=await request('/api/ai/reference-video','POST',form);const uploaded=await upload.json();check(upload.ok,`Upload: ${uploaded.code}`);const asset=uploaded.asset;
  const create=async(title,assetId)=>{
    const node=(await data(await request(projectPath+'/nodes','POST',{type:'asset_reference',title,x:100,y:250}))).node;
    const selected=await data(await request(`${projectPath}/nodes/${node.id}/asset-reference`,'POST',{asset_id:assetId}));return {...node,asset_id:assetId,content:{asset:selected.asset}};
  };
  const first=await create('Imported first',asset.id),last=await create('Imported last',asset.id),music=await create('Music asset',f.musicId);
  const order=[f.nodes[0],first.id,f.nodes[1],last.id];const edges=[];
  for(let i=1;i<order.length;i++)edges.push((await data(await request(projectPath+'/edges','POST',{source_node_id:order[i-1],target_node_id:order[i]}))).edge);
  for(const target of [f.nodes[1],last.id])await data(await request(projectPath+'/edges','POST',{source_node_id:music.id,target_node_id:target,config:{purpose:'export_background_music'}}));
  const snapshot=await data(await request(projectPath));
  const endpoint=`${projectPath}/nodes/${last.id}/full-video`;
  return {...f,request,data,projectPath,endpoint,order,first,last,music,asset,edges,snapshot,async readProject(){return data(await request(projectPath));}};
}
export async function canvasAudioCase(base,media) {
  const f=await canvasAudioFixture(base,media);
  await f.db.prepare("UPDATE canvas_nodes SET content_json='{}' WHERE id=?").bind(f.first.id).run();
  const view=await f.data(await f.request(f.endpoint));
  check(view.chain.clips.length===4,'Mixed current strand contains every generated/imported clip');
  check(JSON.stringify(view.chain.clips.map(c=>c.nodeId))===JSON.stringify(f.order),'Exact mixed directed order');
  const refs=view.chain.clips.filter(c=>!c.runId);check(refs.length===2&&refs.every(c=>c.assetId===f.asset.id),'Real shared import identity without fabricated runs');
  const settings={enabled:false,gain:.37,fadeIn:.5,fadeOut:.25};
  await f.data(await f.request(`${f.projectPath}/nodes/${f.first.id}`,'PATCH',{config:{originalAudio:settings}}));
  const other={enabled:true,gain:.6,fadeIn:1.25,fadeOut:.75};
  await f.data(await f.request(`${f.projectPath}/nodes/${f.last.id}`,'PATCH',{config:{originalAudio:other}}));
  const clips=view.chain.clips.map(canvasClipIdentity),jobs=[];
  const denied=await f.request(f.endpoint,'POST',{orderedClips:clips,backgroundMusic:{enabled:false,gain:1}},{Cookie:'__Host-bitbi_session=invalid','Idempotency-Key':'audio-foreign-owner'});
  check(denied.status===401,'Direct unauthenticated source admission denied');
  const changedVersion=await f.request(f.endpoint,'POST',{orderedClips:clips.map((clip,i)=>i===1?{...clip,version:'0'.repeat(64)}:clip),backgroundMusic:{enabled:false,gain:1}},{'Idempotency-Key':'audio-changed-version'});
  check(changedVersion.status===409,'Imported byte version must match authoritative source');
  for(const enabled of [false,true]) {
    const body={orderedClips:clips,mergeMode:'chain',backgroundMusic:{enabled,gain:.5,fadeIn:.4,fadeOut:.8,...(enabled?{musicAssetId:f.musicId}:{})}};
    const key='audio-export-'+String(enabled)+'-fixture';
    const result=await f.data(await f.request(f.endpoint,'POST',body,{'Idempotency-Key':key}));jobs.push(result.export);
    check(result.export.recipe.version===5,'New immutable audio recipe');
    check(JSON.stringify(result.export.recipe.videos[1].originalAudio)===JSON.stringify(settings),'Muted settings preserved at admission');
    check(JSON.stringify(result.export.recipe.videos[3].originalAudio)===JSON.stringify(other),'Same asset, independent node sound');
    const replay=await f.data(await f.request(f.endpoint,'POST',body,{'Idempotency-Key':key}));check(replay.export.id===result.export.id,'Replay observes one job');
  }
  const reopened=await f.readProject();check(reopened.nodes.find(n=>n.id===f.first.id).config.originalAudio.gain===.37,'Reload persistence');
  const bad=await f.request(`${f.projectPath}/nodes/${f.first.id}`,'PATCH',{config:{originalAudio:{...settings,fadeIn:-1}}});check(bad.status===400,'Invalid audio rejected server-side');
  await f.data(await f.request(`${f.projectPath}/nodes/${f.first.id}/asset-reference`,'POST',{asset_id:f.musicId}));
  const changed=await f.data(await f.request(f.endpoint));check(changed.chain.clips.length===2,'Music reference never becomes a timeline segment');
  const stale=await f.request(f.endpoint,'POST',{orderedClips:clips,backgroundMusic:{enabled:false,gain:1}},{'Idempotency-Key':'audio-stale-fixture-000'});
  check(stale.status===409,'Stale imported type/version rejected');
  const row=await f.db.prepare('SELECT recipe_json,node_id,run_id FROM canvas_video_processing WHERE id=?').bind(jobs[0].id).first();
  check(row.node_id===f.last.id&&row.run_id===null,'Export belongs to real node, not invented generation history');
  check(JSON.parse(row.recipe_json).videos[1].originalAudio.gain===.37,'Accepted audio snapshot survives later editing');
  await f.db.prepare("UPDATE canvas_video_processing SET status='failed',error_code='synthetic_failure' WHERE id=?").bind(jobs[1].id).run();
  const retried=await f.data(await f.request(f.endpoint,'POST',{}));
  check(retried.export.id===jobs[1].id&&retried.export.recipe.videos[1].originalAudio.gain===.37,'Accepted imported export retry preserves source/audio snapshot after graph edits');
  check(f.calls.length===0,'No inference for imports, controls, export admission or replay');
  await f.db.prepare('DELETE FROM canvas_projects WHERE id=? AND user_id=?').bind(f.project,f.owner).run();
  return {provider:'synthetic',providerCalls:0,jobs:jobs.map(j=>j.id),order:f.order};
}

export async function canvasAudioInputsCase(base,media) {
  const f=await canvasAudioFixture(base,{...media,scope:'audio-inputs'});
  const target=(await f.data(await f.request(f.projectPath+'/nodes','POST',{type:'video_generation',model_id:'minimax/h3',title:'Synthetic input acceptance',config:{prompt:'Synthetic continuation',duration:4,resolution:'768P',aspectRatio:'adaptive'}}))).node;
  const edge=(await f.data(await f.request(f.projectPath+'/edges','POST',{source_node_id:f.first.id,target_node_id:target.id}))).edge;
  const edgePath=`${f.projectPath}/edges/${edge.id}`,targetPath=`${f.projectPath}/nodes/${target.id}`;
  const prepared=await f.data(await f.request(edgePath,'PATCH',{config:{videoInput:{modelId:'minimax/h3',assetId:f.asset.id,runId:null,nodeId:f.first.id,method:'last_frame'}}}));
  check(prepared.edge.config.videoInput.nodeId===f.first.id&&!prepared.edge.config.videoInput.runId,'Real imported continuation context');
  await f.data(await f.request(edgePath,'PATCH',{config:prepared.edge.config,frame_image:'data:image/png;base64,'+media.imageBase64}));
  const tariff=(await f.db.prepare('SELECT revision FROM model_pricing_state WHERE id=1').first()).revision;
  const run=async key=>f.request(targetPath+'/run','POST',{}, {'Idempotency-Key':key,'X-Bitbi-Tariff-Revision':String(tariff)});
  check((await run('audio-import-frame')).status===202,'Imported last frame accepted for existing provider input');await f.deliver();
  check(f.calls.length===1&&f.calls[0].input.content.some(c=>c.role==='first_frame'),'Synthetic adapter receives the prepared image input');
  const image=await f.data(await f.request('/api/ai/images/save','POST',{imageData:'data:image/png;base64,'+media.imageBase64,prompt:'Synthetic imported image',model:'uploaded-reference'}));
  await f.data(await f.request(`${f.projectPath}/nodes/${f.first.id}/asset-reference`,'POST',{asset_id:image.id}));
  let reopened=await f.readProject();
  check(reopened.nodes.find(n=>n.id===f.first.id).content.asset.asset_type==='image','Image type persists from authoritative metadata');
  check(!reopened.edges.find(e=>e.id===edge.id).config.videoInput,'Source replacement clears prepared video frames');
  await f.data(await f.request(targetPath,'PATCH',{config:{...target.config,h3Roles:{[edge.id]:'reference_video'}}}));
  const stale=await run('audio-stale-role');check(stale.status===409&&f.calls.length===1,'Stale media role blocks before dispatch');
  await f.data(await f.request(targetPath,'PATCH',{config:{...target.config,h3Roles:{[edge.id]:'first_frame'}}}));
  check((await run('audio-import-image')).status===202,'Owned image reference accepted by compatible existing adapter');await f.deliver();
  check(f.calls.length===2&&f.calls[1].input.content.some(c=>c.role==='first_frame'),'Synthetic provider received actual image-reference input');
  await f.data(await f.request(`${f.projectPath}/nodes/${f.first.id}/asset-reference`,'POST',{asset_id:f.musicId}));
  reopened=await f.readProject();check(reopened.nodes.find(n=>n.id===f.first.id).content.asset.asset_type==='audio','Music type persists after replacement');
  const invalidExport=await f.request(edgePath,'PATCH',{config:{purpose:'export_background_music'}});check(invalidExport.ok,'Music link is accepted for generated video');
  const musicExport=await f.request(`${f.projectPath}/edges/${f.edges[0].id}`,'PATCH',{config:{purpose:'export_background_music'}});
  check(musicExport.status===409,'Video cannot masquerade as background music after a type change');
  await f.db.prepare('DELETE FROM canvas_projects WHERE id=? AND user_id=?').bind(f.project,f.owner).run();
  return {provider:'synthetic',providerCalls:2,typedInputs:true};
}

export async function seedCanvasAudioMigration(db) {
  const user='canvas-audio-migration',project='a0'.repeat(16),node='b0'.repeat(16),run='c0'.repeat(16),now=new Date().toISOString();
  await db.prepare('INSERT INTO users(id,email,password_hash,created_at) VALUES(?,?,?,?)').bind(user,user+'@example.invalid','synthetic',now).run();
  await db.prepare('INSERT INTO user_asset_storage_usage(user_id,used_bytes,updated_at) VALUES(?,1234,?)').bind(user,now).run();
  await db.prepare("INSERT INTO canvas_projects(id,user_id,title,created_at,updated_at) VALUES(?,?,'Migration fixture',?,?)").bind(project,user,now,now).run();
  await db.prepare("INSERT INTO canvas_nodes(id,user_id,project_id,type,x,y,created_at,updated_at) VALUES(?,?,?,'video_generation',0,0,?,?)").bind(node,user,project,now,now).run();
  await db.prepare("INSERT INTO canvas_runs(id,user_id,project_id,node_id,model_id,operation_type,status,idempotency_key,input_json,created_at,updated_at) VALUES(?,?,?,?,'minimax/h3','canvas.video.generate','completed','fixture','{}',?,?)").bind(run,user,project,node,now,now).run();
  for(const [id,status,bytes] of [['d0'.repeat(16),'ready',40],['e0'.repeat(16),'processing',60]]) {
    await db.prepare("INSERT INTO canvas_video_processing(id,user_id,project_id,run_id,kind,sources_json,status,recipe_json,preview_base_key,preview_base_etag,preview_base_bytes,next_attempt_at,created_at,updated_at) VALUES(?,?,?,?,'concat','[]',?,?,'synthetic/base.mp4','fixture',?,?,?,?)")
      .bind(id,user,project,run,status,JSON.stringify({version:2,backgroundMusic:{enabled:false,gain:1},videos:[]}),bytes,now,now,now).run();
    if(status==='ready') {
      await db.prepare('UPDATE canvas_video_processing SET asset_id=id WHERE id=?').bind(id).run();
      await db.prepare("UPDATE canvas_export_versions SET state='saved',saved_at=? WHERE id=?").bind(now,id).run();
    }
  }
  const snapshot={};
  for(const table of ['canvas_video_processing','canvas_export_versions','canvas_export_heads'])snapshot[table]=(await db.prepare('SELECT * FROM '+table+' ORDER BY '+(table==='canvas_export_heads'?'run_id':'id')).all()).results;
  return snapshot;
}
export async function verifyCanvasAudioMigration(db,snapshot) {
  for(const [table,rows] of Object.entries(snapshot)) {
    const after=(await db.prepare('SELECT * FROM '+table+' ORDER BY '+(table==='canvas_export_heads'?'run_id':'id')).all()).results;
    check(rows.length===after.length,table+' retains every row');
    for(let i=0;i<rows.length;i++)for(const [key,value] of Object.entries(rows[i]))check(after[i][key]===value,table+'.'+key+' preserved');
  }
  check((await db.prepare("SELECT used_bytes FROM user_asset_storage_usage WHERE user_id='canvas-audio-migration'").first()).used_bytes===1234,'Migration does not release stored base quota');
  check(!(await db.prepare('PRAGMA foreign_key_check').all()).results.length,'No broken FK after populated migration');
  return {preserved:true};
}
