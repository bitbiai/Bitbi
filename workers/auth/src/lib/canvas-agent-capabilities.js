import { canvasAgentModelConstraints } from './canvas-agent-plan-feedback.js';
import { listCanvasModelsForRole } from '../../../../js/shared/canvas-model-contract.mjs';
import { canvasVideoMethods } from '../../../../js/shared/canvas-video-input.mjs';
import { TRANSITIONS } from '../../../../js/shared/canvas-transitions.mjs';
import { CANVAS_AGENT_MODEL, CANVAS_AGENT_LIMITS } from '../../../../js/shared/canvas-agent-contract.mjs';
import { getModelTariff, quoteModelTariff } from './model-tariffs.js';
import { publicModelAvailability } from './model-availability.js';
import { sha256Hex } from './tokens.js';
import { stablePricingJson } from '../../../../js/shared/model-tariff.mjs';
import { getPublicOmniReadiness } from './gemini-omni-readiness.js';
import { canvasAssistantAvailability } from './canvas-agent-assistant-models.js';
import { imageGenerationCapacity } from './image-generation-capacity.js';

export async function canvasAgentCapabilities(env) {
    const [availability,tariff]=await Promise.all([publicModelAvailability(env),getModelTariff(env)]);
    const omniReadiness=await getPublicOmniReadiness(env),models=[];
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
            constraints:{...canvasAgentModelConstraints(model),...(model.id==='google/gemini-omni-flash'?{readiness:omniReadiness}:{})},
            restrictions:{memberOnly:true,ownedSourcesOnly:true,providerParameters:'canvas-contract-only'},
            suitability:{status:'provisional',evidence:'Existing Canvas capability descriptions; no paid comparative benchmark.',description:model.description}});
    }
    const {version,revision,global,user,project,providers,verified,reason}=imageGenerationCapacity(env);
    const inventory={version:3,models,transitions:TRANSITIONS,limits:CANVAS_AGENT_LIMITS,
        imageConcurrency:{version,revision,global,user,project,providers,verified,reason},
        tools:['project.read','capabilities.read','cost.estimate','graph.apply','node.execute','job.read','reference.prepare','media.inspect','assembly.edit','export.create','asset.save','clarify'],
        audio:{originalAudio:true,backgroundMusic:true,fades:true},tariffRevision:tariff.revision};
    return {...inventory,revision:await sha256Hex(stablePricingJson(inventory))};
}
export const canvasAgentAvailability=(env,{dialogue=false,modelId=CANVAS_AGENT_MODEL}={})=>canvasAssistantAvailability(env,modelId,{dialogue});
export const canvasAgentDialogueAvailability=(env,modelId=CANVAS_AGENT_MODEL)=>canvasAgentAvailability(env,{dialogue:true,modelId});
