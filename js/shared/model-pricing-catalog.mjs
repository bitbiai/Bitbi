import { listAdminAiCatalog } from './admin-ai-contract.mjs';
import { listCanvasModels, estimateCanvasTextCredits } from './canvas-model-contract.mjs';
import { getMemberExposedModels } from './member-model-exposure.mjs';
import { calculateAiModelCreditCost } from './ai-model-pricing.mjs';
import { GROK_4_6_MODEL_ID, getGrokMaxCompletionTokens, GROK_TEXT_PRICING } from './grok-text-contract.mjs';
import { calculateElevenLabsMusicV2ProviderCost } from './elevenlabs-music-v2-pricing.mjs';
import { canonicalPricingModel, mediaTariffBasis, tariffConfiguration, textTariffBasis, FACTORY_TARIFF_VERSION } from './model-tariff.mjs';
import { isGptImage25Model, normalizeGptImage25Options } from './gpt-image-25-contract.mjs';
import { gptImage25FactoryPrice, isGptImage25PricingAvailable } from './gpt-image-25-pricing.mjs';

export function modelPricingCatalog() {
    const canvas = listCanvasModels(), members = getMemberExposedModels(), byId = new Map();
    for (const [kind, entries] of Object.entries(listAdminAiCatalog({ includeCanvas: true }).models)) {
        for (const model of entries) {
            const id = canonicalPricingModel(model.id), c = canvas.find(item => item.id === id);
            byId.set(id, { id, label: model.label, provider: model.providerLabel || model.vendor || 'Not specified', kind,
                controls: { ...model.capabilities, ...c?.controls, ...(kind === 'text' && !c ? { maxTokens:{min:1,max:model.maxOutputTokens || model.maxTokens || 4096,default:model.defaultMaxTokens || 500} } : {}) }, tokenRates: model.pricingPerMillionTokens || null,
                member: members.some(item => item.id === id) || c?.memberCanvasEnabled === true,
                enabled: model.capabilities?.generationEnabled !== false && (!isGptImage25Model(id) || isGptImage25PricingAvailable(id)), billingPaths: kind === 'image' ? ['member_credits','organization_credits','admin_organization_credits'] : ['member_credits','organization_credits','admin_platform_budget_reference'], factoryVersion: FACTORY_TARIFF_VERSION,
                exemption: id === '@cf/black-forest-labs/flux-2-dev' ? 'explicit_unmetered_admin' : null,
                sourceUrl: id.startsWith('@cf/') ? `https://developers.cloudflare.com/workers-ai/models/${id.split('/').at(-1)}/` : `https://developers.cloudflare.com/ai/models/${id}/`,
            });
        }
    }
    for (const c of canvas) if (!byId.has(c.id)) byId.set(c.id, {
        id: c.id, label: c.label, provider: c.vendor, kind: c.capability, controls: c.controls,
        member: c.memberCanvasEnabled, enabled: c.runnable, factoryVersion: FACTORY_TARIFF_VERSION,
        tokenRates: c.id === GROK_4_6_MODEL_ID ? GROK_TEXT_PRICING : null,
        sourceUrl: `https://developers.cloudflare.com/ai/models/${c.id}/`,
    });
    return [...byId.values()];
}

// Normalization is delegated to the same calculators used by generation.
// No prompts, reference URLs or user identifiers are part of a tariff key.
export function modelFactoryPrice(modelId, input = {}, { credits, context = 'canvas' } = {}) {
    const model = modelPricingCatalog().find(item => item.id === canonicalPricingModel(modelId));
    if (!model) throw new TypeError('Unknown model.');
    input = { ...input };
    if (isGptImage25Model(model.id)) {
        const price = gptImage25FactoryPrice(model.id, input);
        return { model, price, basis: mediaTariffBasis(price, 'image', input) };
    }
    const c = model.controls;
    if (model.kind === 'video') {
        input.duration ??= c.duration?.default ?? c.defaultDuration ?? 5;
        if (model.id === 'pixverse/v6') { input.quality ??= c.defaultQuality || '720p'; input.generateAudio ??= input.generate_audio ?? true; }
    }
    if (['image', 'video', 'music'].includes(model.kind)) {
        const price = calculateAiModelCreditCost({ mediaType: model.kind, modelId: model.id, params: input });
        if (price) return { model, price: { ...price, ...(credits === undefined ? {} : { credits }) }, basis: mediaTariffBasis(price, model.kind, input) };
    }
    if (model.kind === 'text' || model.kind === 'embeddings') {
        const inputTokens = Math.max(1, input.previewInputTokens ?? new TextEncoder().encode(String(input.prompt || input.text || '') + String(input.systemPrompt || input.system || '')).length + (model.id === GROK_4_6_MODEL_ID ? 4096 : 0));
        const reasoningEffort = input.reasoningEffort || 'medium';
        const outputTokens = model.kind === 'embeddings' ? 0 : model.id === GROK_4_6_MODEL_ID
            ? getGrokMaxCompletionTokens(reasoningEffort) : Math.max(1, Number(input.maxTokens ?? input.max_tokens ?? model.controls?.maxTokens?.default ?? 500));
        if (!Number.isSafeInteger(outputTokens) || outputTokens > 200_000) throw new TypeError('Invalid token limit.');
        const rates = model.tokenRates;
        const providerCostUsd = rates && Number.isFinite(rates.input) && Number.isFinite(rates.output ?? 0)
            ? (inputTokens * rates.input + outputTokens * (rates.output || 0)) / 1e6 * (rates.fundingMultiplier || 1) : null;
        const baseCredits = credits ?? (context === 'canvas' ? (estimateCanvasTextCredits(model.id, input) ?? 0) : 0);
        const configuration = model.id === GROK_4_6_MODEL_ID ? { reasoningEffort } : {};
        return { model, price: { modelId: model.id, credits: baseCredits, providerCostUsd, normalized: configuration, formula: { billingMode: 'token_estimate', pricingVersion: FACTORY_TARIFF_VERSION } },
            basis: { configuration, units: { inputToken: inputTokens, ...(model.kind === 'embeddings' ? {} : {outputToken: outputTokens}) } } };
    }
    const provider = model.id === 'elevenlabs/music-v2' ? calculateElevenLabsMusicV2ProviderCost(Number(input.duration_ms ?? 30_000)) : null;
    return { model, price: { modelId: model.id, credits: credits ?? (model.enabled ? 0 : null), providerCostUsd: provider?.providerCostUsd ?? null, normalized: tariffConfiguration(input) },
        basis: { configuration: tariffConfiguration(input), units: provider ? { second:provider.durationMs/1000 } : { request:1 } } };
}

// The same registry-derived controls drive both the editor and server validation.
// Billing quantities vary within a configuration; they are never wildcard rules.
export function modelPricingControls(model) {
    const c = model.controls || {}, fields = [];
    const choice = (key, options, value) => { if (options?.length) fields.push({key,options,default:value ?? options[0]}); };
    const number = (key, min, max, value, step=1) => fields.push({key,min,max,step,default:value});
    for (const key of ['resolution','quality','size']) { const value=c['default'+key[0].toUpperCase()+key.slice(1)]; const options=c[key+'Options']; choice(key,key==='size' && options?.length && typeof value!=='string' ? ['',...options] : options,key==='size' && typeof value!=='string' ? '' : value); }
    if (isGptImage25Model(model.id)) for (const key of ['background','outputFormat']) choice(key,c[key+'Options'],c['default'+key[0].toUpperCase()+key.slice(1)]);
    choice('operation',isGptImage25Model(model.id) ? ['generate','edit'] : c.availableOperations?.length ? c.availableOperations : ['generate'],'generate');
    if (model.kind === 'video') number('duration',c.duration?.min ?? c.minDuration ?? 1,c.duration?.max ?? c.maxDuration ?? 15,c.duration?.default ?? c.defaultDuration ?? 5);
    if (c.supportsAudioToggle) choice('generateAudio',[true,false],c.defaultGenerateAudio !== false);
    if (c.supportsDimensions) for (const key of ['width','height']) number(key,c.minDimension||64,c.maxDimension||2048,c.defaultSize?.[key]||1024);
    if (c.supportsSteps) number('steps',1,c.maxSteps||8,c.defaultSteps||4);
    if (c.supportsReferenceImages) number('referenceImageCount',0,c.maxReferenceImages||4,0);
    if (model.id.includes('flux-2-') && model.id !== '@cf/black-forest-labs/flux-2-dev') number('inputImageMegapixels',0,32,0,0.000001);
    if (model.id === 'xai/grok-imagine-image') number('n',1,10,1);
    if (model.kind === 'text' || model.kind === 'embeddings') number('previewInputTokens',1,100000,1);
    if (model.kind === 'text') {
        choice('reasoningEffort',c.reasoningEffort?.options,c.reasoningEffort?.default);
        if (!c.reasoningEffort) number('maxTokens',c.maxTokens?.min||1,c.maxTokens?.max||4096,c.maxTokens?.default||500);
    }
    if (model.id === 'minimax/music-2.6') choice('separateLyricsGeneration',[false,true],false);
    if (model.id === 'elevenlabs/music-v2') number('duration_ms',c.minDurationMs,c.maxDurationMs,c.defaultDurationMs);
    return fields;
}
export function validateModelPricingSettings(model, settings) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new TypeError('Invalid pricing configuration.');
    const fields = modelPricingControls(model);
    for (const [key,value] of Object.entries(settings)) {
        const field = fields.find(item=>item.key===key);
        if (!field) throw new TypeError('Unsupported pricing configuration field: '+key);
        if (field.options ? !field.options.includes(value) : typeof value !== 'number' || !Number.isFinite(value) || value<field.min || value>field.max || (field.step===1 && !Number.isInteger(value))) throw new TypeError('Unsupported pricing configuration: '+key);
    }
    if (isGptImage25Model(model.id)) {
        try { normalizeGptImage25Options(settings); } catch (error) { throw new TypeError(error.message); }
    }
    return settings;
}
