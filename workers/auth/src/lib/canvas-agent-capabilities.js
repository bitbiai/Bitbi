import { listCanvasModelsForRole } from '../../../../js/shared/canvas-model-contract.mjs';
import { canvasVideoMethods } from '../../../../js/shared/canvas-video-input.mjs';
import { TRANSITIONS } from '../../../../js/shared/canvas-transitions.mjs';
import { CANVAS_AGENT_MODEL, CANVAS_AGENT_LIMITS } from '../../../../js/shared/canvas-agent-contract.mjs';
import { getModelTariff, quoteModelTariff } from './model-tariffs.js';
import { publicModelAvailability } from './model-availability.js';
import { sha256Hex } from './tokens.js';
import { stablePricingJson } from '../../../../js/shared/model-tariff.mjs';
import { readCanvasAgentProviderReadiness } from './canvas-agent-planning.js';

export async function canvasAgentCapabilities(env) {
    const [availability,tariff]=await Promise.all([publicModelAvailability(env),getModelTariff(env)]);
    const models=[];
    // The agent always uses the member execution contract, including for an
    // administrator using Canvas. It never inherits private Admin Lab tools.
    for(const model of listCanvasModelsForRole('member')) {
        if(!model.runnable||model.executionMode!=='member'||availability.models[model.id]?.canvas===false)continue;
        if(model.id==='xai/grok-4.6'&&String(env.ENABLE_GROK_4_6)!=='true')continue;
        let price;
        try {price=await quoteModelTariff(env,{modelId:model.id,input:{}});} catch {continue;}
        if(!Number.isSafeInteger(price.credits)||price.credits<1)continue;
        models.push({id:model.id,label:model.label,capability:model.capability,controls:model.controls,
            inputs:{roles:model.controls.referenceRoles||[],videoMethods:canvasVideoMethods(model,{kind:'video_asset',assetId:'owned-placeholder'}).filter(method=>method!=='last_frame'||!['google/gemini-omni-flash','bytedance/seedance-2.5'].includes(model.id)),
                image:model.controls.supportsReferenceImages===true||model.controls.supportsImageInput===true,audio:model.controls.supportsAudioInput===true},
            pricing:{status:model.pricingStatus,defaultCredits:price.credits,revision:tariff.revision},
            restrictions:{memberOnly:true,ownedSourcesOnly:true,providerParameters:'canvas-contract-only'},
            suitability:{status:'provisional',evidence:'Existing Canvas capability descriptions; no paid comparative benchmark.',description:model.description}});
    }
    const inventory={version:1,models,transitions:TRANSITIONS,limits:CANVAS_AGENT_LIMITS,
        tools:['project.read','capabilities.read','cost.estimate','graph.apply','node.execute','job.read','reference.prepare','media.inspect','assembly.edit','export.create','asset.save','clarify'],
        audio:{originalAudio:true,backgroundMusic:true,fades:true},tariffRevision:tariff.revision};
    return {...inventory,revision:await sha256Hex(stablePricingJson(inventory))};
}
export async function canvasAgentAvailability(env) {
    let code=null;
    if(String(env.CANVAS_AGENT_ENABLED)!=='true')code='canvas_agent_disabled';
    else if(!env.AI_LAB?.fetch||!env.AI_VIDEO_JOBS_QUEUE?.send||!env.PRIVATE_MEDIA_PROCESSOR?.fetch)code='canvas_agent_infrastructure_unavailable';
    else if(String(env.ENABLE_GROK_4_7)!=='true')code='canvas_agent_model_unavailable';
    else {
        try {if((await publicModelAvailability(env)).models[CANVAS_AGENT_MODEL]?.canvas===false)code='model_area_disabled';}
        catch {code='model_availability_unavailable';}
        if(!code){const readiness=await readCanvasAgentProviderReadiness(env);if(!readiness.available)code=readiness.code||readiness.reason||'canvas_agent_provider_unavailable';}
    }
    return {available:!code,code,model:CANVAS_AGENT_MODEL,providerAccess:'not_live_verified'};
}
