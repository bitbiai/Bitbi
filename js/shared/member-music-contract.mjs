import { validateAdminAiMusicBody, validateElevenLabsMusicV2CompositionPlan } from './admin-ai-contract.mjs';
import { ELEVENLABS_MUSIC_V2_MODEL_ID, ELEVENLABS_MUSIC_V2_DEFAULT_DURATION_MS, calculateElevenLabsMusicV2ProviderCost } from './elevenlabs-music-v2-pricing.mjs';
import { creditsForProviderCostUsd } from './model-credit-pricing.mjs';
import { browserModelTariff, mediaTariffBasis } from './model-tariff.mjs';

export const ELEVENLABS_MEMBER_FIELDS = Object.freeze(['inputMode', 'compositionPlan', 'musicLengthMs', 'outputFormat', 'seed', 'forceInstrumental', 'storeForInpainting', 'signWithC2pa']);
export const MEMBER_MUSIC_PLAN_BODY_BYTES = 288 * 1024;

export function elevenLabsDurationMs(input = {}) {
    const duration = input.compositionPlan
        ? validateElevenLabsMusicV2CompositionPlan(input.compositionPlan).totalDurationMs
        : input.musicLengthMs ?? input.duration_ms ?? ELEVENLABS_MUSIC_V2_DEFAULT_DURATION_MS;
    if (!Number.isSafeInteger(duration) || duration < 3000 || duration > 600000) throw new TypeError('Music duration must be 3000–600000 milliseconds.');
    return duration;
}

export function elevenLabsMemberBody(config, prompt = '') {
    const body = { model: ELEVENLABS_MUSIC_V2_MODEL_ID, prompt };
    for (const key of ELEVENLABS_MEMBER_FIELDS) if (config[key] !== undefined) body[key] = config[key];
    if (body.inputMode === 'composition_plan') {
        delete body.prompt;
        delete body.musicLengthMs;
        delete body.forceInstrumental;
        if (typeof config.compositionPlanText === 'string') body.compositionPlan = JSON.parse(config.compositionPlanText);
    } else delete body.compositionPlan;
    return body;
}

export function validateElevenLabsMemberBody(body) {
    return validateAdminAiMusicBody(body);
}

export function elevenLabsCreditPrice(input = {}) {
    const durationMs = elevenLabsDurationMs(input);
    const provider = calculateElevenLabsMusicV2ProviderCost(durationMs);
    const factory = { modelId: ELEVENLABS_MUSIC_V2_MODEL_ID, credits: creditsForProviderCostUsd(provider.providerCostUsd),
        providerCostUsd: provider.providerCostUsd, normalized: { durationMs },
        formula: { pricingVersion: 'elevenlabs-music-v2-output-seconds-v1', billingMode: 'output_seconds', rateUsdPerSecond: provider.priceUsdPerOutputSecond } };
    return browserModelTariff(factory, mediaTariffBasis(factory, 'music', input));
}
