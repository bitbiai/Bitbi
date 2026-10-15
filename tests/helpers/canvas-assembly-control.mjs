import { deleteAllUserAiAssets } from '../../workers/auth/src/routes/ai/lifecycle.js';
import { canvasAudioFixture } from './canvas-audio-control.mjs';
import { prepareCanvasMediaInspection, readCanvasMediaInspection, attachCanvasInspectionFrame } from '../../workers/auth/src/lib/canvas-media-inspections.js';
const check=(value,message)=>{if(!value)throw new Error(message);};
const bytes=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const headers={Authorization:'Bearer synthetic-audio-processor'};
const base='/api/internal/homepage/hero-videos/canvas-exports/jobs';

export async function canvasAssemblyCase(env,media) {
    const f=await canvasAudioFixture(env,{...media,scope:'assembly'}),path=f.projectPath+'/assembly';
    let current=await f.data(await f.request(path));check(current.assembly===null,'Existing project has no implicit montage');
    const assembly={version:1,anchorNodeId:f.last.id,clips:f.order.map(nodeId=>({nodeId,trim:{start:0},transition:{preset:'none'}})),target:{seconds:120,toleranceSeconds:.5},musicNodeId:f.music.id,backgroundMusic:{enabled:false,gain:1},smoothJoins:false};
    const save=(value=assembly,revision=current.revision)=>f.request(path,'PATCH',{assembly:value,revision});
    let saved=await f.data(await save());check(saved.revision===current.revision+1,'Assembly uses project revision');
    check(JSON.stringify((await f.readProject()).project.assembly)===JSON.stringify(assembly),'Reopen returns ordinary current assembly');
    const replay=await f.data(await save());check(replay.revision===saved.revision,'Lost response replay creates no second revision');
    const malformed=await save({...assembly,clips:[{nodeId:f.order[0],trim:{start:0,duration:999}}]},saved.revision);check(malformed.status===400,'Strict creative schema');
    const foreign=await save({...assembly,clips:[{nodeId:'f'.repeat(32)}]},saved.revision);check(foreign.status===409,'Foreign node never enters assembly');
    check((await save({...assembly,musicNodeId:'f'.repeat(32)},saved.revision)).status===409,'Foreign music node never enters assembly');
    const exportBody={assemblyRevision:saved.revision,backgroundMusic:{enabled:false,gain:1}};
    check((await f.request(f.endpoint.replace(f.last.id,'f'.repeat(32)),'POST',exportBody,{'Idempotency-Key':'assembly-export-foreign-anchor'})).status===409,'Assembly cannot register an export under another project node identity');
    const exported=await f.data(await f.request(f.endpoint,'POST',exportBody,{'Idempotency-Key':'assembly-export-original-01'}));
    check(exported.export.recipe.version===7&&exported.export.recipe.assembly.target.seconds===120,'Explicit immutable timing recipe admitted');
    const recipe=JSON.stringify(exported.export.recipe);
    const edited={...assembly,clips:[assembly.clips[3],assembly.clips[0],assembly.clips[2]],target:null};
    current=await f.data(await f.request(path));saved=await f.data(await save(edited,current.revision));
    check((await f.request(f.endpoint,'POST',exportBody,{'Idempotency-Key':'assembly-export-stale-01'})).status===409,'Stale project revision blocks new export');
    const exact=await f.data(await f.request(f.endpoint,'POST',exportBody,{'Idempotency-Key':'assembly-export-original-01'}));
    check(exact.export.id===exported.export.id&&JSON.stringify(exact.export.recipe)===recipe,'Retry after edit observes accepted immutable intent');
    await f.data(await f.request(`${f.projectPath}/nodes/${f.order[1]}`,'DELETE'));
    check(JSON.stringify((await f.readProject()).project.assembly)===JSON.stringify(edited),'Deleting excluded middle node cannot resurrect it or cascade to retained clips');
    check((await f.readProject()).nodes.some(n=>n.id===f.order[2]),'Unrelated clip survives deletion');
    check((await save(assembly,current.revision)).status===409,'Stale edit cannot overwrite newer deletion');
    const old=await f.data(await f.request(base+'/claim','POST',{protocol:1,recipeProtocol:7,limit:3},headers));check(!old.jobs.some(j=>j.id===exported.export.id),'Older processor cannot consume trim/timing recipe');
    const claim=await f.data(await f.request(base+'/claim','POST',{protocol:1,recipeProtocol:8,limit:3},headers)),job=claim.jobs.find(j=>j.id===exported.export.id);check(job?.assembly.target.seconds===120,'New processor receives complete creative settings');
    const form=new FormData();form.set('video',new Blob([bytes(media.videoBase64)],{type:'video/mp4'}),'output.mp4');form.set('duration','114.5');form.set('width','320');form.set('height','180');
    const short=await f.request(`${base}/${job.id}/complete`,'POST',form,{...headers,'X-BITBI-Canvas-Claim':job.claim});
    check(short.status===400&&(await short.json()).code==='canvas_duration_target_missed','Trusted completion still cannot declare materially short duration successful');
    const retained=await f.db.prepare('SELECT recipe_json FROM canvas_video_processing WHERE id=?').bind(job.id).first();check(retained.recipe_json===recipe,'Completion failure does not rewrite intended film');
    // The stable ordinary export subject survives removal from both the montage
    // and the graph; provenance is independent of current playback membership.
    current=await f.data(await f.request(path));
    saved=await f.data(await save({...edited,clips:edited.clips.filter(c=>c.nodeId!==f.last.id)},current.revision));
    await f.data(await f.request(`${f.projectPath}/nodes/${f.last.id}`,'DELETE'));
    const afterAnchor=await f.data(await f.request(f.endpoint));
    check(afterAnchor.export.id===exported.export.id,'Deleted anchor retains original export identity');
    const backgroundMusic={enabled:true,gain:.25,musicAssetId:f.musicId,fadeIn:.5,fadeOut:.5};
    saved=await f.data(await save({...afterAnchor.assembly,backgroundMusic,smoothJoins:true},afterAnchor.revision));
    check((await f.request(f.endpoint,'POST',{assemblyRevision:saved.revision,backgroundMusic:{enabled:false,gain:1}},{'Idempotency-Key':'assembly-export-divergent-audio'})).status===409,'Export cannot silently override the saved assembly soundtrack');
    const replacement=await f.data(await f.request(f.endpoint,'POST',{assemblyRevision:saved.revision,backgroundMusic,smoothJoins:true},{'Idempotency-Key':'assembly-export-anchor-removed'}));
    check(replacement.export.recipe.videos.length===2&&!replacement.export.recipe.assembly.clips.some(c=>c.nodeId===f.last.id),'New export after anchor removal contains only current sources');
    check(replacement.export.recipe.music.assetId===f.musicId&&replacement.export.recipe.smoothJoins.enabled,'Saved assembly soundtrack and smoothing remain usable after deleting original anchor and music connection');
    check(f.calls.length===0,'Assembly editing, replay, deletion, export and failure never generate media');
    return {assembly:true,cas:true,replay:true,immutable:true,shortDurationRejected:true,providerCalls:0};
}

export async function canvasInspectionCase(env,media) {
    const f=await canvasAudioFixture(env,{...media,scope:'inspection'}),view=await f.data(await f.request(f.endpoint)),clip=view.availableClips.find(c=>c.nodeId===f.order[0]);
    const input={nodeId:clip.nodeId,assetId:clip.assetId,version:clip.version,frame:{kind:'last'}};
    const job=await prepareCanvasMediaInspection(f.env,f.owner,f.project,input),duplicate=await prepareCanvasMediaInspection(f.env,f.owner,f.project,input);check(job.id===duplicate.id,'Duplicate frame request has one durable identity');
    let denied=false;try{await prepareCanvasMediaInspection(f.env,'another-owner',f.project,input);}catch{denied=true;}check(denied,'Frame ownership cannot be supplied by model');
    let changed=false;try{await prepareCanvasMediaInspection(f.env,f.owner,f.project,{...input,version:'0'.repeat(64)});}catch{changed=true;}check(changed,'Exact immutable source version required');
    const path=base+'/inspections',claimed=(await f.data(await f.request(path+'/claim','POST',{protocol:1},headers))).jobs.find(j=>j.id===job.id);check(claimed,'Private processor receives due frame work');
    const auth={...headers,'X-BITBI-Canvas-Claim':claimed.claim};
    check((await f.request(claimed.source.url,'GET',null,auth)).status===200,'Leased original source is private and owner checked');
    check((await f.request(claimed.source.url,'GET',null,{...auth,'X-BITBI-Canvas-Claim':'0'.repeat(32)})).status===409,'Wrong processing lease cannot read original');
    const metadata={duration:4,width:320,height:320,fps:24,frames:96,hasAudio:true,frameTime:95/24};
    const form=new FormData();form.set('image',new Blob([bytes(media.imageBase64)],{type:'image/png'}),'frame.png');form.set('metadata',JSON.stringify(metadata));
    await f.data(await f.request(claimed.complete,'POST',form,auth));
    const ready=await readCanvasMediaInspection(f.env,f.owner,f.project,job.id);check(ready.status==='ready'&&ready.frame.version===clip.version,'Frame and measured inspection persist after browser-independent completion');
    check((await f.request(ready.frame.previewUrl)).status===200,'Frame uses ordinary private Canvas image asset');
    check((await f.request(ready.frame.previewUrl,'GET',null,{Cookie:'__Host-bitbi_session=invalid'})).status===401,'No public frame delivery');
    const target=(await f.data(await f.request(f.projectPath+'/nodes','POST',{type:'video_generation',model_id:'minimax/h3',config:{prompt:'Fixture continuation',duration:4,resolution:'768P',aspectRatio:'adaptive'}}))).node;
    const edge=(await f.data(await f.request(f.projectPath+'/edges','POST',{source_node_id:clip.nodeId,target_node_id:target.id}))).edge;
    let revision=(await f.readProject()).project.revision;
    const attached=await attachCanvasInspectionFrame(f.env,f.owner,f.project,edge.id,job.id,revision);check(attached.config.videoInput.frame.imageId===job.id,'Prepared frame attaches through normal editable video input');
    let stale=false;try{await attachCanvasInspectionFrame(f.env,f.owner,f.project,edge.id,job.id,revision);}catch{stale=true;}check(stale,'Stale frame attachment cannot overwrite manual change');
    // A saved image with a lost completion acknowledgement is recovered before
    // the final lease retry limit; no extraction identity or quota is duplicated.
    await f.db.prepare("UPDATE canvas_media_inspections SET status='processing',attempt_count=3,locked_until='2000-01-01' WHERE id=?").bind(job.id).run();
    const recovered=await f.data(await f.request(path+'/claim','POST',{protocol:1},headers));check(!recovered.jobs.some(j=>j.id===job.id),'Committed image is recovered without another extraction');
    check((await readCanvasMediaInspection(f.env,f.owner,f.project,job.id)).status==='ready','Saved-reply ambiguity reconciles ready');
    const queued=await prepareCanvasMediaInspection(f.env,f.owner,f.project,{...input,frame:{kind:'time',seconds:1}});
    let protectedSource=false;try{await f.db.prepare('DELETE FROM ai_text_assets WHERE id=? AND user_id=?').bind(clip.assetId,f.owner).run();}catch{protectedSource=true;}
    check(protectedSource,'Ordinary deletion cannot destroy a queued inspection source');
    await f.db.prepare(`WITH RECURSIVE numbers(n) AS(SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<478)
        INSERT INTO canvas_media_inspections(id,user_id,project_id,node_id,source_asset_id,source_version,source_bytes,frame_json,next_attempt_at,created_at,updated_at)
        SELECT printf('%032x',n+1000),user_id,project_id,node_id,source_asset_id,source_version,source_bytes,frame_json,next_attempt_at,created_at,updated_at FROM numbers,canvas_media_inspections WHERE id=?`).bind(queued.id).run();
    check((await prepareCanvasMediaInspection(f.env,f.owner,f.project,input)).id===job.id,'Known inspection remains replayable at resource cap');
    let bounded=false;try{await prepareCanvasMediaInspection(f.env,f.owner,f.project,{...input,frame:{kind:'time',seconds:2}});}catch(error){bounded=error.code==='canvas_inspection_limit';}check(bounded,'Distinct inspection work is atomically bounded per project');
    const agentId='a8'.repeat(16),now=new Date().toISOString();
    await f.db.prepare(`INSERT INTO canvas_agent_runs(id,project_id,user_id,request_key,input_json,status,expected_revision,budget_credits,next_attempt_at,created_at,updated_at,expires_at)
        VALUES(?,?,?,'inspection-cleanup','{}','queued',?,5,?,?,?,?)`).bind(agentId,f.project,f.owner,(await f.readProject()).project.revision,now,now,now,new Date(Date.now()+3600000).toISOString()).run();
    await f.db.prepare(`INSERT INTO canvas_agent_steps(id,run_id,step_key,kind,input_json,allocation_credits,created_at,updated_at) VALUES(?,?,'cleanup','plan','{}',1,?,?)`).bind('a9'.repeat(16),agentId,now,now).run();
    await f.db.prepare("INSERT INTO canvas_agent_controls(run_id,request_key,action,created_at) VALUES(?,'cleanup-control','pause',?)").bind(agentId,now).run();
    const beforeAssetStatements=[{statement:f.db.prepare('DELETE FROM canvas_projects WHERE id=? AND user_id=?').bind(f.project,f.owner),label:'canvas_projects_delete'}];
    let rolledBack=false;try{await deleteAllUserAiAssets({env:f.env,userId:f.owner,beforeAssetStatements,additionalStatements:[f.db.prepare("SELECT json_extract('[]','$[')")]});}catch{rolledBack=true;}
    check(rolledBack&&(await readCanvasMediaInspection(f.env,f.owner,f.project,queued.id)).status==='queued','Later operational-delete failure restores source and project authority atomically');
    await deleteAllUserAiAssets({env:f.env,userId:f.owner,beforeAssetStatements});
    for(const [table,column,value] of [['canvas_projects','id',f.project],['canvas_agent_runs','id',agentId],['canvas_agent_steps','run_id',agentId],['canvas_agent_controls','run_id',agentId],['canvas_media_inspections','project_id',f.project]])
        check(!(await f.db.prepare(`SELECT 1 FROM ${table} WHERE ${column}=?`).bind(value).first()),'Operational account deletion cascades '+table);
    check(f.calls.length===0,'Inspection, attachment and recovery make no paid calls');
    return {inspection:true,owner:true,lease:true,sourceVersion:true,recovery:true,providerCalls:0};
}
