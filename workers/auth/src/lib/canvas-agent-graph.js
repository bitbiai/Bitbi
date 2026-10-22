import { canvasMediaPolicyContext, assertCanvasMediaPlan } from './canvas-agent-media-policy.js';
import { CANVAS_AGENT_LIMITS } from '../../../../js/shared/canvas-agent-contract.mjs';
import { assertOmniReady } from './gemini-omni-readiness.js';
import { H3_MODEL } from '../../../../js/shared/minimax-h3.mjs';
import { readCanvasAgentBudget } from './canvas-agent-budget.js';
import { canvasAgentValidationIssue, canvasAgentFeedbackError, canvasAgentParameterError, CANVAS_AGENT_CHOICE_CONTROLS } from './canvas-agent-plan-feedback.js';
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
import { canvasGenerationSettings } from '../../../../js/shared/canvas-generation-settings.mjs';

const TYPE_KIND={text_generation:'text',image_generation:'image',video_generation:'video',music_generation:'music'};
function validateConfig(model,config,prompt) {
    const c=model.controls;
    if(prompt.length>(c.maxPromptLength||12000))agentFail('canvas_agent_prompt_limit');
    for(const [key,control] of Object.entries(CANVAS_AGENT_CHOICE_CONTROLS)){
        const options=c[control];
        if(config[key]!==undefined&&(!options?.length||!options.includes(config[key])))throw canvasAgentParameterError(key);
    }
    const flags={steps:c.supportsSteps,seed:c.supportsSeed,width:c.supportsDimensions,height:c.supportsDimensions,negativePrompt:c.supportsNegativePrompt,generateAudio:c.supportsAudioToggle,watermark:c.supportsWatermark,safetyTolerance:c.supportsSafetyTolerance};
    for(const [key,supported] of Object.entries(flags))if(config[key]!==undefined&&!supported)agentFail('canvas_agent_parameter_unsupported');
    for(const key of ['maxTokens','temperature','reasoningEffort','textPurpose']){
        if(config[key]!==undefined&&(model.capability!=='text'||key!=='textPurpose'&&!c[key]))agentFail('canvas_agent_parameter_unsupported');
    }
    for(const key of ['maxTokens','temperature'])if(config[key]!==undefined&&(config[key]<c[key]?.min||config[key]>c[key]?.max||key==='maxTokens'&&!Number.isInteger(config[key])))agentFail('canvas_agent_parameter_unsupported');
    if(config.steps!==undefined&&(!Number.isInteger(config.steps)||config.steps<1||config.steps>c.maxSteps))agentFail('canvas_agent_parameter_unsupported');
    if(config.safetyTolerance!==undefined&&(config.safetyTolerance<c.minSafetyTolerance||config.safetyTolerance>c.maxSafetyTolerance))agentFail('canvas_agent_parameter_unsupported');
    if(config.reasoningEffort!==undefined&&!c.reasoningEffort.options.includes(config.reasoningEffort))agentFail('canvas_agent_parameter_unsupported');
    if(config.duration!==undefined&&(!c.duration||c.supportsDuration===false||!Number.isInteger(config.duration)||config.duration<c.duration.min||config.duration>c.duration.max))agentFail('canvas_agent_duration_unsupported');
    for(const key of ['width','height'])if(config[key]!==undefined&&(!Number.isInteger(config[key])||config[key]<c.minDimension||config[key]>c.maxDimension))agentFail('canvas_agent_parameter_unsupported');
    if(config.originalAudio!==undefined){if(model.capability!=='video')agentFail('canvas_agent_parameter_unsupported');originalAudioSettings(config.originalAudio);}
    if(config.seedance25!==undefined&&model.id!=='bytedance/seedance-2.5')agentFail('canvas_agent_parameter_unsupported');
    if(['inputMode','musicLengthMs','compositionPlan','forceInstrumental','storeForInpainting','signWithC2pa'].some(key=>config[key]!==undefined)&&model.id!=='elevenlabs/music-v2')agentFail('canvas_agent_parameter_unsupported');
    if(['instrumental','generateLyrics','lyrics'].some(key=>config[key]!==undefined)&&model.capability!=='music')agentFail('canvas_agent_parameter_unsupported');
}
async function calculateCanvasAgentGraph(env,run,view,inventory,rawPlan,repairNodes=null) {
    const plan=validateCanvasAgentPlan(rawPlan,{durationMode:'creative',targetDurationSeconds:run.target_seconds,toleranceSeconds:run.tolerance_seconds,existingNodeIds:view.nodes.map(n=>n.id)});
    if(plan.assembly.targetDurationSeconds<CANVAS_AGENT_LIMITS.minDuration||plan.assembly.targetDurationSeconds>CANVAS_AGENT_LIMITS.maxDuration)agentFail('canvas_agent_target_duration_invalid');
    const repairs=[],issues=[];
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
    // Schema validation knows new node types. Existing IDs must resolve against
    // the saved graph before any new media allocation or graph mutation.
    if(plan.assembly.clips.some(clip=>canvasAgentDependencyKind(specs.get(clip.key),view.nodes)!=='video'))agentFail('canvas_agent_assembly_clip_invalid');
    if(plan.assembly.musicKey&&!['audio','music'].includes(canvasAgentDependencyKind(specs.get(plan.assembly.musicKey),view.nodes)))agentFail('canvas_agent_assembly_music_invalid');
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
    const mediaPolicy=await canvasMediaPolicyContext(env,run.project_id,run.user_id);
    const steps=[],effectiveInputs=new Map(),now=nowIso();
    for(const node of changes){
        if(node.type==='note')continue;
        const model=getCanvasModelForRole(node.modelId,'member');
        const available=inventory.models.find(m=>m.id===node.modelId);
        try {
        if(!model||!available||!model.runnable||model.capability!==TYPE_KIND[node.type])agentFail('canvas_agent_model_ineligible');
        assertCanvasMediaPlan(mediaPolicy,[{modelId:node.modelId,credits:0}]);
        // This video-only field has no effect on ElevenLabs requests, pricing
        // or background-music mixing. Normalize only the exact inert value on
        // a new proposed music node; the raw provider proposal stays intact.
        const audio=node.config.originalAudio;
        if(!node.update&&node.type==='music_generation'&&model.id==='elevenlabs/music-v2'
            &&audio&&Object.keys(audio).sort().join(',')==='enabled,gain'&&audio.enabled===false&&audio.gain===0){
            delete node.config.originalAudio;
            repairs.push({code:'canvas_agent_music_original_audio_noop',nodeKey:node.key,field:'config.originalAudio',from:audio,to:null});
        }
        validateConfig(model,node.config,node.prompt);
        // New model-authored nodes sometimes use the common Canvas spelling.
        // Translate only when the native namespace is entirely absent. An
        // explicit native request (including historical defaults) stays authoritative.
        // The original immutable proposal remains unchanged; effective settings
        // and this interpretation are visible in the ordinary node and validation.
        if(!node.update&&model.id==='bytedance/seedance-2.5'&&node.config.seedance25===undefined){
            const aliases={duration:'duration',resolution:'resolution',aspectRatio:'aspect_ratio',generateAudio:'generate_audio',watermark:'watermark'};
            const entries=Object.entries(aliases).filter(([key])=>Object.hasOwn(node.config,key));
            if(entries.length){
                node.config.seedance25=Object.fromEntries(entries.map(([key,native])=>[native,node.config[key]]));
                repairs.push({code:'canvas_agent_seedance_native_settings',nodeKey:node.key,field:'config.seedance25',
                    from:Object.fromEntries(entries.map(([key])=>[key,node.config[key]])),to:{...node.config.seedance25}});
                for(const [key] of entries)delete node.config[key];
            }
        }
        const references=node.dependencies.map(dep=>({dep,source:specs.get(dep.key)}));
        if(model.id===H3_MODEL&&node.config.aspectRatio===undefined){
            const roles=references.filter(({dep})=>dep.role!=='prompt').map(({dep,source})=>
                canvasAgentDependencyKind(source,view.nodes)==='video'&&dep.method==='last_frame'?'first_frame':dep.role);
            if(roles.some(role=>['first_frame','last_frame'].includes(role))&&!roles.some(role=>role.startsWith('reference_'))){
                node.config.aspectRatio='adaptive';
                repairs.push({code:'canvas_agent_h3_frame_default',nodeKey:node.key,field:'config.aspectRatio',from:null,to:'adaptive'});
                // Updates are merged ordinary node settings; preserve the effective
                // repair in the proposal that is eventually persisted.
                if(node.update)plan.updates.find(update=>update.nodeId===node.id).config.aspectRatio='adaptive';
            }
        }
        for(const {dep,source} of references){
            const kind=canvasAgentDependencyKind(source,view.nodes);
            if(dep.role==='prompt'&&!['text','note'].includes(kind||source.type))agentFail('canvas_agent_reference_unsupported');
            if(kind==='image'&&!available.inputs.image||['audio','music'].includes(kind)&&!available.inputs.audio)agentFail('canvas_agent_reference_unsupported');
            if(kind==='video'&&!available.inputs.videoMethods.includes(dep.method||'reference_video')&&!model.controls.referenceRoles?.includes(dep.role))agentFail('canvas_agent_reference_unsupported');
        }
        // Feasibility uses the same body builder as normal Canvas. References
        // are priced conservatively here and checked again at real admission.
        const input=prepareCanvasAgentPriceInput({node,model,dependencies:references,existingNodes:view.nodes});
        effectiveInputs.set(node.key,input);
        if(model.id==='google/gemini-omni-flash')await assertOmniReady(env,input);
        const quote=await quoteModelTariff(env,{modelId:node.modelId,input});
        if(!Number.isSafeInteger(quote.credits)||quote.credits<1)agentFail('model_pricing_unavailable');
        const id=(await sha256Hex(`canvas-agent-step:${run.id}:${run.rounds}:${node.key}`)).slice(0,32);
        steps.push({id,key:`${run.rounds}:${node.key}`,nodeId:ids.get(node.key),credits:quote.credits,input:{modelId:node.modelId,nodeId:ids.get(node.key),dependencies:node.dependencies.map(dep=>({...dep,nodeId:ids.get(dep.key)})),config:node.config,prompt:node.prompt}});
        } catch(error) {
            if(!error?.code||!Number.isInteger(error.status)||error.status>=500&&error.code!=='gpt_image_25_reference_pricing_unavailable')throw error;
            if(issues.length<16)issues.push(canvasAgentValidationIssue(error,node,model));
        }
    }
    assertCanvasMediaPlan(mediaPolicy,steps);
    const budget=await readCanvasAgentBudget(env,run);
    const generationCredits=steps.reduce((sum,step)=>sum+step.credits,0);
    if(issues.length)return {ok:false,plan,repairs,issues,costs:{complete:false,generationCredits,evaluation:null,totalCredits:generationCredits},budget};
    const plannedDurations=plan.assembly.clips.map(clip=>{
        const spec=specs.get(clip.key),available=inventory.models.find(m=>m.id===spec.modelId);
        const old=view.nodes.find(node=>node.id===spec.id),output=old&&JSON.parse(old.output_json||'{}');
        // Duration belongs to the same native request used for quotation and
        // execution. Seedance's explicit nested controls override any historical
        // generic value; a trim never exceeds the effective native request.
        const model=getCanvasModelForRole(spec.modelId,'member');
        const requested=(effectiveInputs.get(spec.key)??(model?canvasGenerationSettings(spec.config,model,spec.prompt):null))?.duration;
        const known=(!spec.update?(output?.duration??output?.durationSeconds):null)??(requested>0?requested:null)
            ??(available?.controls.supportsDuration===false?null:available?.controls.duration?.default);
        if(Number.isFinite(known)&&known>0&&(clip.trim.start>=known||clip.trim.duration!==undefined&&clip.trim.start+clip.trim.duration>known+0.0001)){
            const error=canvasAgentFeedbackError('canvas_agent_trim_outside_planned_source');
            error.validationIssue={...canvasAgentValidationIssue(error,spec),field:'assembly.clips'};throw error;
        }
        return clip.trim.duration??(known?known-clip.trim.start:null);
    });
    const plannedDurationSeconds=plannedDurations.every(d=>Number.isFinite(d)&&d>0)
        ?transitionTimeline(plannedDurations,plan.assembly.clips.slice(0,-1).map(c=>c.transition),24).duration:null;
    let evaluation=await canvasAgentEvaluationStep(env,run,plan.assembly,specs,ids);
    const quotedEvaluationCredits=evaluation.credits;
    if(generationCredits+evaluation.credits>budget.remainingCredits){
        evaluation={...evaluation,credits:0,input:{...evaluation.input,technicalOnly:true,reason:'budget_headroom'}};
    }
    const costs={complete:true,generationCredits,nodes:steps.map(step=>({nodeId:step.nodeId,stepKey:step.key,modelId:step.input.modelId,credits:step.credits})),
        evaluation:{mode:evaluation.input.technicalOnly?'technical_only':'sampled_frames',credits:evaluation.credits,quotedCredits:quotedEvaluationCredits,
            ...(evaluation.input.technicalOnly?{reason:evaluation.input.reason}:{})},totalCredits:generationCredits+evaluation.credits};
    let assembly={version:1,clips:plan.assembly.clips.map(clip=>({nodeId:ids.get(clip.key),trim:clip.trim,transition:clip.transition})),target:{seconds:plan.assembly.targetDurationSeconds,mode:'creative'}};
    const anchor=JSON.parse(view.project.assembly_json||'null')?.anchorNodeId||assembly.clips.at(-1).nodeId,music=plan.assembly.musicKey?ids.get(plan.assembly.musicKey):null;
    assembly.anchorNodeId=anchor;
    const previousAssembly=JSON.parse(view.project.assembly_json||'null');
    assembly=canvasAssembly({...assembly,musicNodeId:music,backgroundMusic:exportMusicSettings(plan.assembly.backgroundMusic??previousAssembly?.backgroundMusic??{enabled:Boolean(music),gain:0.25}),smoothJoins:(plan.assembly.smoothJoins??previousAssembly?.smoothJoins)===true});
    return {ok:true,plan,repairs,issues,costs,budget,estimatedCredits:costs.totalCredits,assembly,plannedDurationSeconds,
        prepared:{ids,changes,steps,evaluation,anchor,music,now}};
}

// Read-only full executable preflight. Raw model proposals are separately owned
// by the run store. Feedback contains application-authored constraints only.
export async function preflightCanvasAgentGraph(env,run,view,inventory,rawPlan,repairNodes=null) {
    try {
        const {prepared,...result}=await calculateCanvasAgentGraph(env,run,view,inventory,rawPlan,repairNodes);
        return result;
    } catch(error) {
        if(!error?.code||!Number.isInteger(error.status)||error.status>=500)throw error;
        return {ok:false,plan:null,repairs:[],issues:[error.validationIssue||canvasAgentValidationIssue(error)],costs:null};
    }
}
export async function prepareCanvasAgentGraph(env,run,view,inventory,rawPlan,repairNodes=null) {
    let checked;
    try {checked=await calculateCanvasAgentGraph(env,run,view,inventory,rawPlan,repairNodes);}
    catch(error){
        if(error?.code&&error.status<500)error.validation={issues:[error.validationIssue||canvasAgentValidationIssue(error)]};
        throw error;
    }
    const {prepared,...preflight}=checked;
    if(!checked.ok)throw Object.assign(canvasAgentFeedbackError(checked.issues[0].code),{validation:preflight,preflight});
    if(checked.costs.totalCredits>checked.budget.remainingCredits){
        const additionalCredits=checked.costs.totalCredits-checked.budget.remainingCredits;
        throw Object.assign(canvasAgentFeedbackError('canvas_agent_budget_exceeded'),{validation:preflight,preflight,
            budget:{additionalCredits,newCapCredits:checked.budget.capCredits+additionalCredits}});
    }
    const {plan,assembly}=checked;
    const {ids,changes,steps,evaluation,anchor,music}=prepared,now=nowIso();
    const statements=[env.DB.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM canvas_agent_runs r JOIN canvas_projects p ON p.id=r.project_id
        WHERE r.id=? AND r.lease_token=? AND r.status='planning' AND r.lease_until>? AND r.expires_at>?
        AND EXISTS(SELECT 1 FROM users WHERE id=r.user_id AND status='active')
        AND p.revision=r.expected_revision AND p.deleted_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM canvas_agent_proposals review WHERE review.run_id=r.id
          AND json_extract(review.interpretation_json,'$.authority.strategy')='bounded-correction'
          AND NOT EXISTS(SELECT 1 FROM canvas_agent_conversations c WHERE c.project_id=r.project_id AND c.user_id=r.user_id
            AND c.state!='cancelled' AND c.brief_revision=json_extract(review.interpretation_json,'$.authority.effectiveBriefRevision'))))
        THEN 1 ELSE json_extract('[]','$[') END`).bind(run.id,run.lease_token,now,now),
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
        if(!node.update&&['google/gemini-omni-flash','bytedance/seedance-2.5'].includes(node.modelId)){
            const orderKey=node.modelId==='google/gemini-omni-flash'?'omniOrder':'seedance25Order';
            config[orderKey]=await Promise.all(node.dependencies.flatMap((dep,index)=>dep.role==='prompt'?[]:[sha256Hex(`canvas-agent-edge:${run.id}:${node.key}:${index}`).then(hash=>hash.slice(0,32))]));
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
        env.DB.prepare(`UPDATE canvas_agent_runs SET status='running',rounds=rounds+1,phase='generating',plan_json=?,target_seconds=?,expected_revision=(SELECT revision FROM canvas_projects WHERE id=?),updated_at=? WHERE id=? AND lease_token=?`).bind(JSON.stringify(plan),plan.assembly.targetDurationSeconds,run.project_id,now,run.id,run.lease_token));
    try {await env.DB.batch(statements);}
    catch(error){
        // D1 may have committed this atomic graph while its response was lost.
        // Observe the exact same application instead of inserting it again or
        // replacing a successful run with the caller's stale error state.
        const applied=await env.DB.prepare(`SELECT r.status,r.lease_token,r.rounds,r.plan_json,r.expected_revision,p.revision
            FROM canvas_agent_runs r JOIN canvas_projects p ON p.id=r.project_id
            WHERE r.id=? AND r.user_id=? AND r.project_id=?`).bind(run.id,run.user_id,run.project_id).first();
        if(applied?.status!=='running'||applied.lease_token!==run.lease_token||applied.rounds!==run.rounds+1
            ||applied.plan_json!==JSON.stringify(plan)||applied.expected_revision!==applied.revision)throw error;
    }
    return {plan,steps,assembly,repairs:checked.repairs,costs:checked.costs,plannedDurationSeconds:checked.plannedDurationSeconds};
}

export { validateConfig as validateCanvasAgentNodeConfig };
