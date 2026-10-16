import worker from '../../workers/auth/src/index.js';
import {prepareCanvasAgentReferences} from '../../workers/auth/src/lib/canvas-agent-references.js';
import { canvasAudioFixture } from './canvas-audio-control.mjs';
import { sha256Hex } from '../../workers/auth/src/lib/tokens.js';
import { changeModelTariff, getModelTariff } from '../../workers/auth/src/lib/model-tariffs.js';
import { canvasAgentCapabilities } from '../../workers/auth/src/lib/canvas-agent-capabilities.js';
import { canvasAgentProject } from '../../workers/auth/src/routes/canvas-agent.js';
import { preflightCanvasAgentGraph, prepareCanvasAgentGraph } from '../../workers/auth/src/lib/canvas-agent-graph.js';
const check=(value,message)=>{if(!value)throw new Error(message);};
const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);

// Actual authenticated Canvas routes, normal generation admission and durable
// storage. The only provider is the existing isolated synthetic REST fixture.
export async function canvasAgentPreflightCase(base,media) {
    const f=await canvasAudioFixture(base,{...media,scope:'agent-preflight'});
    const created=await f.data(await f.request('/api/account/canvas/projects','POST',{title:'Executable plan validation',locale:'en'}));
    const project=created.project.id,route=`/api/account/canvas/projects/${project}`;
    const image=await f.data(await f.request('/api/ai/images/save','POST',{imageData:'data:image/png;base64,'+media.imageBase64,prompt:'Synthetic house reference',model:'uploaded-reference'}));
    const sources=[];
    for(const [title,asset] of [['House first frame',image.id],['House reference',image.id],['Prior clip',f.asset.id]]) {
        const node=(await f.data(await f.request(route+'/nodes','POST',{type:'asset_reference',title}))).node;
        await f.data(await f.request(`${route}/nodes/${node.id}/asset-reference`,'POST',{asset_id:asset}));sources.push(node.id);
    }
    const mixed={key:'build',type:'video_generation',modelId:'minimax/h3',title:'Build the same house',prompt:'Build the same small-town house with ducks nearby.',config:{duration:4,resolution:'768P',aspectRatio:'16:9'},dependencies:[
        {key:`existing:${sources[0]}`,role:'first_frame'},{key:`existing:${sources[1]}`,role:'reference_image'},
    ]};
    const plan={version:1,title:'House construction',continuity:'Retain the house and duck pool.',nodes:[mixed],updates:[],assembly:{clips:[{key:'build',trim:{start:0,duration:4},transition:{preset:'none'}}],musicKey:null,targetDurationSeconds:6}};
    let view=await canvasAgentProject(f.env,f.owner,project);
    const now=new Date().toISOString(),runId=(await sha256Hex('agent-preflight-run')).slice(0,32);
    const oldRules=(await getModelTariff(f.env)).rules;
    const readinessKey='model_readiness:google/gemini-omni-flash';
    const oldReadiness=await f.db.prepare('SELECT value_json FROM app_settings WHERE key=?').bind(readinessKey).first();
    const enabled={generation:true,image:false,frames:false,reference_images:true,video_edit:false,audio_reference:false,'720p':true,'360p':false,'1080p':false,'4k':false};
    const setReadiness=()=>f.db.prepare("INSERT INTO app_settings(key,value_json,updated_at,reason) VALUES(?,?,?,'Synthetic preflight fixture') ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json").bind(readinessKey,JSON.stringify({revision:1,adminTestEnabled:false,adminTestCredits:null,enabled,acceptance:{},history:[]}),now).run();
    await setReadiness();
    for(const operation of ['text','reference'])await changeModelTariff(f.env,{id:f.owner},{action:'save',modelId:'google/gemini-omni-flash',revision:(await getModelTariff(f.env)).revision,settings:{resolution:'720p',operation},rates:{request:53}});
    const tariff=await getModelTariff(f.env);
    await f.db.prepare(`INSERT INTO canvas_agent_runs(id,project_id,user_id,request_key,input_json,status,expected_revision,budget_credits,target_seconds,tolerance_seconds,tariff_revision,lease_token,lease_until,next_attempt_at,created_at,updated_at,expires_at)
        VALUES(?,?,?,?,?,'planning',?,10000,NULL,.5,?,'00112233445566778899aabbccddeeff',?,?,?,?,?)`)
        .bind(runId,project,f.owner,runId,JSON.stringify({brief:'Build a small-town house with a duck pool.'}),view.project.revision,tariff.revision,new Date(Date.now()+600000).toISOString(),now,now,now,new Date(Date.now()+3600000).toISOString()).run();
    let run=await f.db.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(runId).first();
    const inventory=await canvasAgentCapabilities(f.env),before=JSON.stringify(plan);
    const h3=inventory.models.find(model=>model.id==='minimax/h3');
    check(inventory.version===2&&same(h3.constraints.mutuallyExclusiveModes,['frames','reference']),'Inventory expresses the actual H3 conditional mode gate');
    check(h3.constraints.videoLastFrame.effectiveRole==='first_frame'&&h3.constraints.referenceModes[0].requires.aspectRatio==='adaptive','Planner knows extracted frames imply adaptive frame mode');
    const failed=await preflightCanvasAgentGraph(f.env,run,view,inventory,plan);
    check(!failed.ok&&failed.issues[0].code==='canvas_agent_h3_reference_modes_mixed'&&failed.issues[0].nodeKey==='build','Precise mixed-mode failure before graph creation');
    check(failed.plan&&same(failed.plan.nodes[0].dependencies,mixed.dependencies)&&JSON.stringify(plan)===before,'Invalid proposal is available intact without dropping references');
    check((await canvasAgentProject(f.env,f.owner,project)).nodes.length===3&&f.calls.length===0,'Preflight never writes nodes or submits media');
    const continuation=structuredClone(plan);continuation.nodes[0].dependencies[0]={key:`existing:${sources[2]}`,role:'reference_video',method:'last_frame'};
    check((await preflightCanvasAgentGraph(f.env,run,view,inventory,continuation)).issues[0].code==='canvas_agent_h3_reference_modes_mixed','Prepared video last frame cannot bypass mixed-mode rejection');
    const frameOnly=structuredClone(plan);frameOnly.nodes[0].dependencies.pop();
    check((await preflightCanvasAgentGraph(f.env,run,view,inventory,frameOnly)).issues[0].code==='canvas_agent_h3_frame_ratio_required','Explicit conflicting ratio needs a creative decision');
    delete frameOnly.nodes[0].config.aspectRatio;
    const technical=await preflightCanvasAgentGraph(f.env,run,view,inventory,frameOnly);
    check(technical.ok&&technical.repairs.length===1&&technical.plan.nodes[0].config.aspectRatio==='adaptive','Only a missing technical ratio is repaired automatically');
    check(!Object.hasOwn(frameOnly.nodes[0].config,'aspectRatio'),'Raw proposal remains immutable after repair');
    const repaired=structuredClone(plan);repaired.nodes[0].dependencies[0].role='reference_image';
    const checked=await preflightCanvasAgentGraph(f.env,run,view,inventory,repaired);
    check(checked.ok&&checked.costs.complete&&checked.costs.totalCredits>0,'A creative repair preserving both assets reaches complete pricing');
    check(checked.plannedDurationSeconds===4&&checked.assembly.target.mode==='creative'&&checked.assembly.target.seconds===6,'Approximate target does not reject a technically valid shorter film');
    const cheap={...run,budget_credits:checked.costs.generationCredits};
    const optional=await preflightCanvasAgentGraph(f.env,cheap,view,inventory,repaired);
    check(optional.ok&&optional.costs.evaluation.mode==='technical_only'&&optional.costs.evaluation.credits===0&&optional.costs.totalCredits===checked.costs.generationCredits,'Optional visual review cannot consume media headroom');
    const tooSmall=await preflightCanvasAgentGraph(f.env,{...run,budget_credits:1},view,inventory,repaired);
    check(tooSmall.ok&&tooSmall.costs.totalCredits>tooSmall.budget.remainingCredits,'An unaffordable proposal still exposes its plan and full minimum cost');
    let denied=false;try{await prepareCanvasAgentGraph(f.env,{...run,budget_credits:1},view,inventory,repaired);}catch(error){denied=error.code==='canvas_agent_budget_exceeded'&&error.preflight.costs.complete&&error.budget.additionalCredits>0;}
    check(denied&&(await canvasAgentProject(f.env,f.owner,project)).nodes.length===3,'Cost refusal happens before graph writes and retains actionable costs');
    const appliedPlan=structuredClone(repaired);
    appliedPlan.nodes.push({key:'continued',type:'video_generation',modelId:'minimax/h3',title:'Continue imported clip',prompt:'Continue this same house.',config:{duration:4,aspectRatio:'adaptive'},dependencies:[{key:`existing:${sources[2]}`,role:'reference_video',method:'last_frame'}]});
    for(const [key,modelId,config]of [['omni_order','google/gemini-omni-flash',{}],['seedance_order','bytedance/seedance-2.5',{seedance25:{duration:4}}]])
        appliedPlan.nodes.push({key,type:'video_generation',modelId,title:key,prompt:'Preserve the first and second reference identities.',config,dependencies:structuredClone(repaired.nodes[0].dependencies)});
    check(inventory.models.find(m=>m.id==='google/gemini-omni-flash').constraints.readiness.enabled.reference_images,'Inventory exposes actual member Omni feature gates');
    enabled.reference_images=false;await setReadiness();
    check((await preflightCanvasAgentGraph(f.env,run,view,inventory,appliedPlan)).issues.some(issue=>issue.code==='omni_capability_disabled'),'Fresh member readiness rejects disabled reference operations despite an earlier inventory');
    enabled.reference_images=true;await setReadiness();
    const applied=await prepareCanvasAgentGraph(f.env,run,view,inventory,appliedPlan);
    view=await canvasAgentProject(f.env,f.owner,project);run=await f.db.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(runId).first();
    check(run.target_seconds===6&&view.project.revision===run.expected_revision,'Chosen automatic target and graph share the final guarded persistence');
    const node=view.nodes.find(node=>node.id===applied.steps.find(step=>step.key==='0:build').nodeId);
    check(node&&JSON.parse(node.config_json).aspectRatio==='16:9'&&view.edges.filter(edge=>edge.target_node_id===node.id).length===2,'Ordinary editable graph retains both references and explicit framing');
    for(const [modelId,orderKey]of [['google/gemini-omni-flash','omniOrder'],['bytedance/seedance-2.5','seedance25Order']]){
        const ordered=view.nodes.find(n=>n.model_id===modelId),config=JSON.parse(ordered.config_json);
        const intended=sources.slice(0,2).map(source=>view.edges.find(e=>e.source_node_id===source&&e.target_node_id===ordered.id).id);
        check(same(config[orderKey],intended)&&!same(config[orderKey],[...intended].reverse()),'Normal editable reference ordering preserves the planned identities, including a wrong-order countercontrol');
        const reopened=(await f.data(await f.request(route))).nodes.find(n=>n.id===ordered.id);
        check(same(reopened.config[orderKey],intended),'Reference order survives ordinary project reload');
    }
    const continuationStep=await f.db.prepare("SELECT * FROM canvas_agent_steps WHERE run_id=? AND step_key='0:continued'").bind(runId).first();
    check(!await prepareCanvasAgentReferences(f.env,run,continuationStep),'Imported video queues real browser-independent frame preparation instead of being silently skipped');
    const processor='/api/internal/homepage/hero-videos/canvas-exports/jobs',auth={Authorization:'Bearer synthetic-audio-processor'};
    const inspection=await f.db.prepare('SELECT * FROM canvas_media_inspections WHERE project_id=? AND node_id=?').bind(project,sources[2]).first();
    check(inspection?.source_asset_id===f.asset.id,'Inspection binds the actual imported source asset');
    const frameJob=(await f.data(await f.request(processor+'/inspections/claim','POST',{protocol:1},auth))).jobs.find(j=>j.id===inspection.id);
    check(frameJob,'Actual private processor claims the imported reference');
    const frame=new FormData();frame.set('image',new Blob([Uint8Array.from(atob(media.imageBase64),c=>c.charCodeAt(0))],{type:'image/png'}),'frame.png');
    frame.set('metadata',JSON.stringify({duration:4,width:320,height:320,fps:24,frames:96,hasAudio:true,frameTime:95/24}));
    await f.data(await f.request(frameJob.complete,'POST',frame,{...auth,'X-BITBI-Canvas-Claim':frameJob.claim}));
    check(await prepareCanvasAgentReferences(f.env,run,continuationStep),'Prepared imported last frame attaches to the ordinary connection');
    const importedEdge=(await f.data(await f.request(route))).edges.find(e=>e.source_node_id===sources[2]);
    check(importedEdge.config.videoInput.method==='last_frame'&&importedEdge.config.videoInput.nodeId===sources[2]&&importedEdge.config.videoInput.runId===null&&importedEdge.config.videoInput.frame.version===inspection.source_version,'Reload keeps the exact imported source/version/frame without an agent-only recipe');
    // Normal reference ownership/type admission remains downstream; no fabricated
    // output_json is created for any of these already saved references.
    check((await f.db.prepare("SELECT COUNT(*) AS n FROM canvas_nodes WHERE project_id=? AND type='asset_reference' AND output_json IS NOT NULL").bind(project).first()).n===0,'Saved references retain normal output-free representation');
    const provider=f.env.__TEST_FETCH;
    f.env.__TEST_FETCH=async(url,init)=>{
        if(!String(url).startsWith('https://api.cloudflare.com/'))return provider(url,init);
        const request=JSON.parse(init.body);check(request.model==='minimax/h3','Only supported H3 route');
        const refs=request.input.content.filter(item=>item.type!=='text');
        check(refs.length===2&&refs.every(item=>item.role==='reference_image')&&request.input.ratio==='16:9','Actual provider request preserves both reference roles and framing');
        f.calls.push(request);
        return Response.json({success:true,result:{state:'Completed',result:{task:{id:'synthetic-preflight-fixed',model:'MiniMax-H3',status:'succeeded',resolution:'768P',duration:4,content:{url:'https://fixture.invalid/completion.mp4'},usage:{output_seconds:4}}}}});
    };
    f.env.CANVAS_AGENT_ENABLED='true';f.env.ENABLE_GROK_4_7='true';f.env.AI_SERVICE_AUTH_SECRET='preflight-signed-readiness-only';
    f.env.PRIVATE_MEDIA_PROCESSOR={async fetch(){return Response.json({ok:true});}};
    f.env.AI_LAB={async fetch(request){check(new URL(request.url).pathname==='/internal/ai/canvas-agent/readiness','No new model inference during reference execution');
        const ai=(await import('../../workers/ai/src/index.js')).default;return ai.fetch(request,{ENABLE_GROK_4_7:'true',AI_SERVICE_AUTH_SECRET:f.env.AI_SERVICE_AUTH_SECRET,SERVICE_AUTH_REPLAY:base.SERVICE_AUTH_REPLAY||base.PUBLIC_RATE_LIMITER,AI:{run(){throw Error('Readiness cannot infer');}}},{waitUntil(){}});}};
    await f.db.prepare("UPDATE canvas_agent_runs SET lease_token=NULL,lease_until=NULL,next_attempt_at='2000-01-01' WHERE id=?").bind(runId).run();
    const waits=[];await worker.queue({queue:'bitbi-ai-video-jobs',messages:[{body:{type:'canvas_agent.process',run_id:runId},attempts:1,ack(){},retry(){throw Error('Unexpected queue retry');}}]},f.env,{waitUntil(p){waits.push(p);}});await Promise.all(waits);
    check((await f.db.prepare('SELECT COUNT(*) AS n FROM canvas_runs WHERE project_id=? AND node_id=?').bind(project,node.id).first()).n===1,'Actual agent queue admits already saved Asset References instead of waiting forever');
    await f.deliver();
    const takeover=await f.data(await f.request(`${route}/agent/${runId}/control`,'POST',{action:'takeover'},{'Idempotency-Key':'preflight-manual-takeover'}));
    check(takeover.run.status==='taken_over','Intentional takeover uses the authenticated project control');
    for(let i=f.messages.length-1;i>=0;i--)if(f.messages[i].type==='canvas_agent.process'){
        const [body]=f.messages.splice(i,1);
        await worker.queue({queue:'bitbi-ai-video-jobs',messages:[{body,attempts:1,ack(){},retry(){throw Error('Stopped agent wake cannot retry');}}]},f.env,{waitUntil(p){waits.push(p);}});
    }
    await Promise.all(waits);
    check(f.calls.length===1,'A delayed agent wake after takeover does not generate another clip');
    const response=await f.request(`${route}/nodes/${node.id}/run`,'POST',{}, {'Idempotency-Key':'preflight-normal-repaired','X-Bitbi-Tariff-Revision':String(tariff.revision)});
    check(response.status===202,'Repaired persisted graph is runnable through normal Canvas after agent takeover');await f.deliver();
    const output=(await canvasAgentProject(f.env,f.owner,project)).nodes.find(item=>item.id===node.id);
    check(f.calls.length===2&&output.asset_id&&JSON.parse(output.output_json).sourceVersion,'Agent execution and explicit manual rerun each save their legitimate private result');
    // The ordinary export route keeps exact recipes compatible and admits a
    // creative target only to a processor which understands its semantics.
    let current=await f.data(await f.request(route));
    const assembly=current.project.assembly,endpoint=`${route}/nodes/${assembly.anchorNodeId}/full-video`;
    let saved=await f.data(await f.request(route+'/assembly','PATCH',{revision:current.project.revision,assembly:{...assembly,target:{seconds:4,mode:'exact'}}}));
    const strict=(await f.data(await f.request(endpoint,'POST',{assemblyRevision:saved.revision,backgroundMusic:assembly.backgroundMusic},{'Idempotency-Key':'preflight-exact-export'}))).export;
    check(strict.recipe.version===7&&!Object.hasOwn(strict.recipe.assembly.target,'mode'),'Explicit exact mode retains the legacy recipe contract');
    saved=await f.data(await f.request(route+'/assembly','PATCH',{revision:saved.revision,assembly}));
    const creative=(await f.data(await f.request(endpoint,'POST',{assemblyRevision:saved.revision,backgroundMusic:assembly.backgroundMusic},{'Idempotency-Key':'preflight-creative-export'}))).export;
    check(creative.recipe.version===8&&creative.recipe.assembly.target.mode==='creative','Creative duration has its own immutable recipe version');
    // Prioritize the incompatible job ahead of the compatible control. A
    // broken old-protocol filter therefore claims the wrong known identity.
    await f.db.prepare('UPDATE canvas_video_processing SET next_attempt_at=? WHERE id=?').bind('1999-01-01',creative.id).run();
    await f.db.prepare('UPDATE canvas_video_processing SET next_attempt_at=? WHERE id=?').bind('1999-01-02',strict.id).run();
    const old=(await f.data(await f.request(processor+'/claim','POST',{protocol:1,recipeProtocol:8,limit:1},auth))).jobs;
    check(old.length===1&&old[0].id===strict.id,'Older processor claims the compatible exact recipe despite the creative job being first');
    const held=await f.db.prepare('SELECT status,attempt_count,processing_token FROM canvas_video_processing WHERE id=?').bind(creative.id).first();
    check(held.status==='queued'&&held.attempt_count===0&&!held.processing_token,'Unsupported creative recipe remains entirely unleased');
    const jobs=(await f.data(await f.request(processor+'/claim','POST',{protocol:1,recipeProtocol:9,limit:1},auth))).jobs;
    check(jobs.length===1&&jobs[0].id===creative.id&&jobs[0].recipeVersion===8,'New processor receives the exact intended creative export');
    const form=new FormData();form.set('video',new Blob([Uint8Array.from(atob(media.videoBase64),c=>c.charCodeAt(0))],{type:'video/mp4'}),'completed.mp4');
    form.set('duration','4');form.set('width','320');form.set('height','320');
    form.set('audioTimeline',JSON.stringify([{start:0,duration:4,overlap:0,originalAudioFit:{policy:'fit-picture-v1',trimStart:0,trimEnd:0}}]));
    form.set('seamResult',JSON.stringify({policy:'motion-anchors-v1',improved:0,seams:[]}));
    const completed=await f.data(await f.request(`${processor}/${creative.id}/complete`,'POST',form,{...auth,'X-BITBI-Canvas-Claim':jobs[0].claim}));
    check(completed.status==='preview_pending'&&(await f.request(`/api/ai/text-assets/${completed.asset_id}/file`)).status===200,'Creative duration preserves a saved playable artifact with its measured duration');
    check((await f.db.prepare('SELECT recipe_json FROM canvas_video_processing WHERE id=?').bind(strict.id).first()).recipe_json===JSON.stringify(strict.recipe),'New export preserves the prior exact recipe');
    await f.db.prepare('DELETE FROM canvas_projects WHERE id=? AND user_id=?').bind(project,f.owner).run();
    await f.db.prepare('DELETE FROM canvas_projects WHERE id=? AND user_id=?').bind(f.project,f.owner).run();
    await f.db.prepare('UPDATE model_pricing_state SET rules_json=? WHERE id=1').bind(JSON.stringify(oldRules)).run();
    if(oldReadiness)await f.db.prepare('UPDATE app_settings SET value_json=? WHERE key=?').bind(oldReadiness.value_json,readinessKey).run();
    else await f.db.prepare('DELETE FROM app_settings WHERE key=?').bind(readinessKey).run();
    return {mixedRejected:true,extractedFrameRejected:true,technicalDefaultRepaired:true,creativeRepairPreservedReferences:true,editableGraph:true,syntheticProviderCalls:2,measuredTargetMode:applied.assembly.target.mode,versionedCreativeExport:true,savedCreativeOutput:true,importedReferences:true,persistedReferenceOrder:true};
}
