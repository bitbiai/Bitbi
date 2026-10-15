import { validateCanvasAgentPlan } from '../../../shared/canvas-agent-plan.mjs';
import { getCanvasModelForRole } from '../../../../js/shared/canvas-model-contract.mjs';
import { transitionTimeline } from '../../../../js/shared/canvas-transitions.mjs';
import { originalAudioSettings } from '../../../../js/shared/canvas-audio.mjs';
import { exportMusicSettings } from '../../../../js/shared/canvas-export.mjs';
import { quoteModelTariff } from './model-tariffs.js';
import { sha256Hex,nowIso } from './tokens.js';
import { agentFail } from './canvas-agent-store.js';
import { canvasAgentEvaluationStep } from './canvas-agent-evaluation.js';
import { stablePricingJson } from '../../../../js/shared/model-tariff.mjs';
import { canvasAssembly } from '../../../../js/shared/canvas-assembly.mjs';
import { prepareCanvasAgentPriceInput, canvasAgentDependencyKind } from './canvas-agent-price-input.js';

const TYPE_KIND={text_generation:'text',image_generation:'image',video_generation:'video',music_generation:'music'};
function validateConfig(model,config,prompt) {
    const c=model.controls;
    if(prompt.length>(c.maxPromptLength||12000))agentFail('canvas_agent_prompt_limit');
    const choices={aspectRatio:c.aspectRatioOptions,quality:c.qualityOptions,resolution:c.resolutionOptions,size:c.sizeOptions,outputFormat:c.outputFormatOptions,background:c.backgroundOptions};
    for(const [key,options] of Object.entries(choices))if(config[key]!==undefined&&(!options?.length||!options.includes(config[key])))agentFail('canvas_agent_parameter_unsupported');
    const flags={steps:c.supportsSteps,seed:c.supportsSeed,width:c.supportsDimensions,height:c.supportsDimensions,negativePrompt:c.supportsNegativePrompt,generateAudio:c.supportsAudioToggle,watermark:c.supportsWatermark,safetyTolerance:c.supportsSafetyTolerance};
    for(const [key,supported] of Object.entries(flags))if(config[key]!==undefined&&!supported)agentFail('canvas_agent_parameter_unsupported');
    if(config.duration!==undefined&&(!c.duration||c.supportsDuration===false||!Number.isInteger(config.duration)||config.duration<c.duration.min||config.duration>c.duration.max))agentFail('canvas_agent_duration_unsupported');
    for(const key of ['width','height'])if(config[key]!==undefined&&(!Number.isInteger(config[key])||config[key]<c.minDimension||config[key]>c.maxDimension))agentFail('canvas_agent_parameter_unsupported');
    if(config.originalAudio!==undefined)originalAudioSettings(config.originalAudio);
    if(config.seedance25!==undefined&&model.id!=='bytedance/seedance-2.5')agentFail('canvas_agent_parameter_unsupported');
    if(['inputMode','musicLengthMs','compositionPlan','forceInstrumental','storeForInpainting','signWithC2pa'].some(key=>config[key]!==undefined)&&model.id!=='elevenlabs/music-v2')agentFail('canvas_agent_parameter_unsupported');
    if(['instrumental','generateLyrics','lyrics'].some(key=>config[key]!==undefined)&&model.capability!=='music')agentFail('canvas_agent_parameter_unsupported');
}
export async function prepareCanvasAgentGraph(env,run,view,inventory,rawPlan,repairNodes=null) {
    const plan=validateCanvasAgentPlan(rawPlan,{targetDurationSeconds:run.target_seconds,toleranceSeconds:run.tolerance_seconds,existingNodeIds:view.nodes.map(n=>n.id)});
    if(view.nodes.length+plan.nodes.length+1>120||view.edges.length+plan.nodes.reduce((s,n)=>s+n.dependencies.length,0)+1>300)agentFail('canvas_agent_project_limit');
    const ids=new Map(view.nodes.map(n=>[`existing:${n.id}`,n.id]));
    for(const n of plan.nodes)ids.set(n.key,(await sha256Hex(`canvas-agent-node:${run.id}:${run.rounds}:${n.key}`)).slice(0,32));
    const specs=new Map(plan.nodes.map(n=>[n.key,n]));
    for(const old of view.nodes){
        const config=JSON.parse(old.config_json);
        const dependencies=view.edges.filter(e=>e.target_node_id===old.id&&JSON.parse(e.config_json||'{}').purpose!=='export_background_music').map(e=>{
            const edgeConfig=JSON.parse(e.config_json||'{}'),source=view.nodes.find(n=>n.id===e.source_node_id),kind=canvasAgentDependencyKind(source,view.nodes);
            return {key:`existing:${e.source_node_id}`,role:config.h3Roles?.[e.id]||config.omniRoles?.[e.id]||config.seedance25Roles?.[e.id]||({image:'reference_image',video:'reference_video',music:'reference_audio',audio:'reference_audio'}[kind]||'prompt'),
                ...(edgeConfig.videoInput?.method?{method:edgeConfig.videoInput.method}:{})};
        });
        specs.set(`existing:${old.id}`,{key:`existing:${old.id}`,id:old.id,type:old.type,modelId:old.model_id,prompt:Object.hasOwn(config,'prompt')?config.prompt:JSON.parse(old.content_json).prompt||'',config,dependencies});
    }
    if(repairNodes){
        const current=JSON.parse(view.project.assembly_json),anchor=view.nodes.find(n=>n.id===current.anchorNodeId),config={...JSON.parse(anchor?.config_json||'{}'),...(current.backgroundMusic?{backgroundMusic:current.backgroundMusic}:{}),...(current.smoothJoins!==undefined?{smoothJoins:current.smoothJoins}:{})};
        const proposed=canvasAssembly({version:1,clips:plan.assembly.clips.map(c=>({nodeId:ids.get(c.key),trim:c.trim,transition:c.transition})),target:current.target}).clips;
        const existingMusic=current.musicNodeId!==undefined?current.musicNodeId:(view.edges.find(e=>e.target_node_id===current.anchorNodeId&&JSON.parse(e.config_json||'{}').purpose==='export_background_music')?.source_node_id||null);
        if(plan.nodes.length||plan.updates.length!==repairNodes.length||plan.updates.some(n=>!repairNodes.includes(n.nodeId))
            ||stablePricingJson(proposed)!==stablePricingJson(current.clips)|| (plan.assembly.musicKey?ids.get(plan.assembly.musicKey):null)!==existingMusic
            ||stablePricingJson(exportMusicSettings(plan.assembly.backgroundMusic||config.backgroundMusic))!==stablePricingJson(exportMusicSettings(config.backgroundMusic))
            ||(plan.assembly.smoothJoins??config.smoothJoins??false)!==(config.smoothJoins===true))agentFail('canvas_agent_revision_scope_invalid');
    }
    const changes=[...plan.nodes,...plan.updates.map(u=>{
        const old=specs.get(`existing:${u.nodeId}`),config={...old.config,...u.config};
        // The normal generation Inspector edits config.prompt. Creative intent
        // must be visible in that same control, with no hidden legacy fallback.
        config.prompt=u.prompt;
        const updated={...old,prompt:u.prompt,config,update:true};
        specs.set(updated.key,updated);return updated;
    })];
    const steps=[],now=nowIso();
    for(const node of changes){
        if(node.type==='note')continue;
        const model=getCanvasModelForRole(node.modelId,'member');
        const available=inventory.models.find(m=>m.id===node.modelId);
        if(!model||!available||!model.runnable||model.capability!==TYPE_KIND[node.type])agentFail('canvas_agent_model_ineligible');
        validateConfig(model,node.config,node.prompt);
        const references=node.dependencies.map(dep=>({dep,source:specs.get(dep.key)}));
        for(const {dep,source} of references){
            const kind=canvasAgentDependencyKind(source,view.nodes);
            if(dep.role==='prompt'&&!['text','note'].includes(kind||source.type))agentFail('canvas_agent_reference_unsupported');
            if(kind==='image'&&!available.inputs.image||['audio','music'].includes(kind)&&!available.inputs.audio)agentFail('canvas_agent_reference_unsupported');
            if(kind==='video'&&!available.inputs.videoMethods.includes(dep.method||'reference_video')&&!model.controls.referenceRoles.includes(dep.role))agentFail('canvas_agent_reference_unsupported');
        }
        // Feasibility uses the same body builder as normal Canvas. References
        // are priced conservatively here and checked again at real admission.
        const input=prepareCanvasAgentPriceInput({node,model,dependencies:references,existingNodes:view.nodes});
        const quote=await quoteModelTariff(env,{modelId:node.modelId,input});
        if(!Number.isSafeInteger(quote.credits)||quote.credits<1)agentFail('model_pricing_unavailable');
        const id=(await sha256Hex(`canvas-agent-step:${run.id}:${run.rounds}:${node.key}`)).slice(0,32);
        steps.push({id,key:`${run.rounds}:${node.key}`,nodeId:ids.get(node.key),credits:quote.credits,input:{modelId:node.modelId,nodeId:ids.get(node.key),dependencies:node.dependencies.map(dep=>({...dep,nodeId:ids.get(dep.key)})),config:node.config,prompt:node.prompt}});
    }
    const plannedDurations=plan.assembly.clips.map(clip=>{
        const spec=specs.get(clip.key),available=inventory.models.find(m=>m.id===spec.modelId);
        return clip.trim.duration??spec.config.duration??spec.config.seedance25?.duration??available?.controls.duration?.default;
    });
    if(plannedDurations.every(d=>Number.isFinite(d)&&d>0)){
        const timeline=transitionTimeline(plannedDurations,plan.assembly.clips.slice(0,-1).map(c=>c.transition),24);
        if(Math.abs(timeline.duration-run.target_seconds)>run.tolerance_seconds)agentFail('canvas_agent_plan_duration_mismatch');
    }
    const allocation=await env.DB.prepare('SELECT COALESCE(SUM(allocation_credits),0) AS credits FROM canvas_agent_steps WHERE run_id=?').bind(run.id).first();
    const evaluation=await canvasAgentEvaluationStep(env,run,plan.assembly,specs,ids);
    if(allocation.credits+evaluation.credits+steps.reduce((sum,s)=>sum+s.credits,0)>run.budget_credits)agentFail('canvas_agent_budget_exceeded');
    let assembly={version:1,clips:plan.assembly.clips.map(clip=>({nodeId:ids.get(clip.key),trim:clip.trim,transition:clip.transition})),target:{seconds:run.target_seconds,toleranceSeconds:run.tolerance_seconds}};
    const anchor=JSON.parse(view.project.assembly_json||'null')?.anchorNodeId||assembly.clips.at(-1).nodeId,music=plan.assembly.musicKey?ids.get(plan.assembly.musicKey):null;
    assembly.anchorNodeId=anchor;
    const previousAssembly=JSON.parse(view.project.assembly_json||'null');
    assembly=canvasAssembly({...assembly,musicNodeId:music,backgroundMusic:exportMusicSettings(plan.assembly.backgroundMusic??previousAssembly?.backgroundMusic??{enabled:Boolean(music),gain:0.25}),smoothJoins:(plan.assembly.smoothJoins??previousAssembly?.smoothJoins)===true});
    const statements=[env.DB.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM canvas_agent_runs r JOIN canvas_projects p ON p.id=r.project_id
        WHERE r.id=? AND r.lease_token=? AND r.status='planning' AND r.lease_until>? AND r.expires_at>?
        AND EXISTS(SELECT 1 FROM users WHERE id=r.user_id AND status='active')
        AND p.revision=r.expected_revision AND p.deleted_at IS NULL) THEN 1 ELSE json_extract('[]','$[') END`).bind(run.id,run.lease_token,now,now),
        env.DB.prepare("UPDATE canvas_agent_runs SET status='applying' WHERE id=? AND lease_token=?").bind(run.id,run.lease_token)];
    // Store creative continuity in an ordinary note visible in the editor.
    const noteId=(await sha256Hex(`canvas-agent-continuity:${run.id}:${run.rounds}`)).slice(0,32);
    statements.push(env.DB.prepare(`INSERT INTO canvas_nodes(id,project_id,user_id,type,title,x,y,config_json,content_json,created_at,updated_at)
        VALUES(?,?,?,'note','Production continuity',40,40,'{}',?,?,?)`).bind(noteId,run.project_id,run.user_id,JSON.stringify({text:plan.continuity}),now,now));
    for(const [index,node] of changes.entries()){
        const config={...node.config,...(node.type==='note'?{}:{prompt:node.prompt})};
        for(const [i,dep] of (node.update?[]:node.dependencies).entries()){
            const edgeId=(await sha256Hex(`canvas-agent-edge:${run.id}:${node.key}:${i}`)).slice(0,32);
            if(['minimax/h3','google/gemini-omni-flash','bytedance/seedance-2.5'].includes(node.modelId)){
                const rolesKey=node.modelId==='minimax/h3'?'h3Roles':node.modelId==='google/gemini-omni-flash'?'omniRoles':'seedance25Roles';
                config[rolesKey]={...config[rolesKey],[edgeId]:dep.role};
            }
        }
        if(ids.get(node.key)===anchor){config.backgroundMusic=exportMusicSettings(plan.assembly.backgroundMusic||{enabled:Boolean(music),gain:0.25});config.smoothJoins=plan.assembly.smoothJoins===true;}
        if(node.update)statements.push(env.DB.prepare('UPDATE canvas_nodes SET config_json=?,content_json=json_remove(content_json,\'$.prompt\'),updated_at=? WHERE id=? AND project_id=? AND user_id=? AND deleted_at IS NULL').bind(JSON.stringify(config),now,ids.get(node.key),run.project_id,run.user_id));
        else statements.push(env.DB.prepare(`INSERT INTO canvas_nodes(id,project_id,user_id,type,title,x,y,model_id,config_json,content_json,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(ids.get(node.key),run.project_id,run.user_id,node.type,node.title,80+(index%5)*440,280+Math.floor(index/5)*380,node.modelId,JSON.stringify(config),JSON.stringify(node.type==='note'?{text:node.prompt}:{}),now,now));
    }
    for(const node of plan.nodes)for(const [index,dep] of node.dependencies.entries()){
        const edgeId=(await sha256Hex(`canvas-agent-edge:${run.id}:${node.key}:${index}`)).slice(0,32);
        statements.push(env.DB.prepare(`INSERT INTO canvas_edges(id,project_id,user_id,source_node_id,target_node_id,config_json,created_at,updated_at) VALUES(?,?,?,?,?,'{}',?,?)`).bind(edgeId,run.project_id,run.user_id,ids.get(dep.key),ids.get(node.key),now,now));
    }
    if(music&&(view.nodes.some(n=>n.id===anchor)||plan.nodes.some(n=>ids.get(n.key)===anchor))&&!view.edges.some(e=>e.source_node_id===music&&e.target_node_id===anchor&&JSON.parse(e.config_json||'{}').purpose==='export_background_music'))statements.push(env.DB.prepare(`INSERT INTO canvas_edges(id,project_id,user_id,source_node_id,target_node_id,config_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`).bind((await sha256Hex(`canvas-agent-music:${run.id}`)).slice(0,32),run.project_id,run.user_id,music,anchor,JSON.stringify({purpose:'export_background_music'}),now,now));
    for(const s of steps)statements.push(env.DB.prepare(`INSERT INTO canvas_agent_steps(id,run_id,step_key,kind,node_id,input_json,allocation_credits,created_at,updated_at) VALUES(?,?,?,'node',?,?,?,?,?)`).bind(s.id,run.id,s.key,s.nodeId,JSON.stringify(s.input),s.credits,now,now));
    statements.push(env.DB.prepare(`INSERT INTO canvas_agent_steps(id,run_id,step_key,kind,input_json,allocation_credits,created_at,updated_at) VALUES(?,?,?,'evaluate',?,?,?,?)`).bind(evaluation.id,run.id,evaluation.key,JSON.stringify(evaluation.input),evaluation.credits,now,now));
    statements.push(env.DB.prepare('UPDATE canvas_projects SET assembly_json=?,workspace_width=MAX(workspace_width,2400),workspace_height=MAX(workspace_height,?),updated_at=? WHERE id=? AND user_id=?').bind(JSON.stringify(assembly),Math.max(1600,Math.ceil(changes.length/5)*380+600),now,run.project_id,run.user_id),
        env.DB.prepare(`UPDATE canvas_agent_runs SET status='running',rounds=rounds+1,phase='generating',plan_json=?,expected_revision=(SELECT revision FROM canvas_projects WHERE id=?),updated_at=? WHERE id=? AND lease_token=?`).bind(JSON.stringify(plan),run.project_id,now,run.id,run.lease_token));
    await env.DB.batch(statements);
    return {plan,steps,assembly};
}
