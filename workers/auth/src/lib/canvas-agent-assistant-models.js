import { CANVAS_ASSISTANT_MODELS, CANVAS_ASSISTANT_MODEL_VERSION, CANVAS_FABLE_MODEL, CANVAS_FABLE_ADMISSION_VERSION,
    canvasAssistantModel, canvasAssistantModelId } from '../../../../js/shared/canvas-assistant-models.mjs';
import { CANVAS_GROK_ADMISSION_VERSION } from '../../../../js/shared/canvas-grok-admission.mjs';
import { modelPricingCatalog } from '../../../../js/shared/model-pricing-catalog.mjs';
import { publicModelAvailability } from './model-availability.js';
import { quoteModelTariff } from './model-tariffs.js';
import { readCanvasAgentProviderReadiness } from './canvas-agent-planning.js';

export async function canvasAssistantAvailability(env, modelId, { dialogue = false, providerReadiness = true } = {}) {
    const model = canvasAssistantModel(modelId);
    if (!model) return { available:false,code:'canvas_agent_model_adapter_unavailable',model:modelId,providerAccess:'not_live_verified' };
    let code = null;
    if (String(env.CANVAS_AGENT_ENABLED) !== 'true') code = 'canvas_agent_disabled';
    else if (!env.AI_LAB?.fetch || !env.AI_VIDEO_JOBS_QUEUE?.send || !env.PRIVATE_MEDIA_PROCESSOR?.fetch) code = 'canvas_agent_infrastructure_unavailable';
    else if (modelId === 'xai/grok-4.7' && String(env.ENABLE_GROK_4_7) !== 'true') code = 'canvas_agent_model_unavailable';
    if (!code) {
        try {
            const availability = await publicModelAvailability(env);
            if (availability.models[modelId]?.canvas !== true) code = 'model_area_disabled';
        } catch { code = 'model_availability_unavailable'; }
    }
    if (!code) {
        try {
            const price = await quoteModelTariff(env,{modelId,input:{prompt:'Canvas assistant readiness quotation.',maxTokens:4096,
                ...(modelId===CANVAS_FABLE_MODEL?{canvasFableAdmission:CANVAS_FABLE_ADMISSION_VERSION}:{canvasGrokAdmission:CANVAS_GROK_ADMISSION_VERSION})}});
            if (!Number.isSafeInteger(price.credits) || price.credits < 1) code = 'model_pricing_unavailable';
        } catch { code = 'model_pricing_unavailable'; }
    }
    let diagnostic;
    if (!code && providerReadiness) {
        const readiness = await readCanvasAgentProviderReadiness(env,{dialogue,modelId});
        if (!readiness.available) code = readiness.reason || 'canvas_agent_provider_unavailable';
        diagnostic = readiness.diagnostic;
    }
    return {available:!code,code,model:modelId,providerAccess:'not_live_verified',...(diagnostic?{diagnostic}:{})};
}
export async function canvasAssistantModelInventory(env) {
    const eligible = await Promise.all(CANVAS_ASSISTANT_MODELS.map(async model => {
        const state = await canvasAssistantAvailability(env,model.modelId,{dialogue:true});
        return {...model,available:state.available,reason:state.code,version:CANVAS_ASSISTANT_MODEL_VERSION,accountAccess:'unverified'};
    }));
    // Display actual integrated text models with an explicit exclusion instead
    // of inventing an OpenAI/ChatGPT adapter or silently substituting providers.
    return [...eligible,...modelPricingCatalog().filter(model=>model.kind==='text'&&!canvasAssistantModel(model.id)).map(model=>({
        modelId:model.id,displayName:model.label,provider:model.provider,available:false,vision:false,
        reason:'canvas_agent_model_adapter_unavailable',version:CANVAS_ASSISTANT_MODEL_VERSION,accountAccess:'unverified',
    }))];
}
export const selectedCanvasAssistantModel = row => canvasAssistantModelId(row?.assistant_model_id);
