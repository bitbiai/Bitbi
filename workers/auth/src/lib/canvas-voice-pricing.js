import { CANVAS_VOICE_MODEL } from '../../../../js/shared/canvas-voice-settings.mjs';
import { BITBI_MODEL_PRICING_USD_TO_EUR, BITBI_NET_EUR_PER_CREDIT_FOR_MODEL_PRICING, BITBI_TARGET_PROFIT_MARGIN, creditsForProviderCostUsd } from '../../../../js/shared/model-credit-pricing.mjs';

// Direct xAI Voice, not Cloudflare Unified Billing. The owner selected started
// ten-second units using the existing 20% margin formula (cost / 0.8).
// Source: https://docs.x.ai/developers/models/speech-to-speech (2026-10-27).
// Context is session.instructions: no conversation.item.create text surcharge.
export const CANVAS_VOICE_PRICING_VERSION = 'xai-voice-3.0-2026-10-27';
export const CANVAS_VOICE_MAX_SECONDS = 7200;
export function canvasVoicePrice(settings, maxWallSeconds, tariffRevision) {
    if (!Number.isSafeInteger(maxWallSeconds) || maxWallSeconds < 1 || maxWallSeconds > CANVAS_VOICE_MAX_SECONDS
        || !Number.isSafeInteger(tariffRevision) || tariffRevision < 0) throw Object.assign(new Error('canvas_voice_quote_invalid'), { code: 'canvas_voice_quote_invalid', status: 400 });
    const billingMode = settings.turn_detection.type === null ? 'audio_in_plus_out' : 'session_elapsed';
    const rates = { usdToEur: BITBI_MODEL_PRICING_USD_TO_EUR, netEurPerCredit: BITBI_NET_EUR_PER_CREDIT_FOR_MODEL_PRICING, targetProfitMargin: BITBI_TARGET_PROFIT_MARGIN };
    const unitSeconds = 10, providerUsdPerMinute = 0.08, maxBillableSeconds = maxWallSeconds * (billingMode === 'audio_in_plus_out' ? 2 : 1);
    const creditsPerBlock = creditsForProviderCostUsd(providerUsdPerMinute * unitSeconds / 60, rates), maxBlocks = Math.ceil(maxBillableSeconds / unitSeconds);
    return { version: CANVAS_VOICE_PRICING_VERSION, model: CANVAS_VOICE_MODEL, tariffRevision, unitSeconds, providerUsdPerMinute,
        rates, billingMode, maxWallSeconds, maxBillableSeconds, maxBlocks, creditsPerBlock, maxCredits: maxBlocks * creditsPerBlock, textItems: 0,
        inputRate: settings.audio.input.format.rate, outputRate: settings.audio.output.format.rate };
}
export function canvasVoiceExposure(price, settings, input, previous = {}) {
    const fail = () => { throw Object.assign(new Error('canvas_voice_exposure_invalid'), { code: 'canvas_voice_exposure_invalid', status: 409 }); };
    if (!input || Object.keys(input).some(key => !['elapsedMs', 'inputSamples', 'outputSamples', 'inputRate', 'outputRate'].includes(key))) fail();
    const rate = side => settings?.audio?.[side]?.format.rate ?? price[side + 'Rate'];
    if (!['elapsedMs', 'inputSamples', 'outputSamples'].every(key => Number.isSafeInteger(input[key]) && input[key] >= 0 && input[key] >= (previous[key] || 0))
        || input.inputRate !== rate('input') || input.outputRate !== rate('output') || input.elapsedMs > 7200000
        || input.inputSamples > 7200000 * input.inputRate / 1000 || input.outputSamples > 7200000 * input.outputRate / 1000) fail();
    const billableMs = price.billingMode === 'session_elapsed' ? input.elapsedMs
        : Math.ceil(1000 * (input.inputSamples / input.inputRate + input.outputSamples / input.outputRate));
    const startedBlocks = Math.ceil(billableMs / (price.unitSeconds * 1000));
    return { ...input, billableMs, startedBlocks, accruedCredits: startedBlocks * price.creditsPerBlock,
        maxCredits: price.maxCredits, exceeded: input.elapsedMs > price.maxWallSeconds * 1000 || billableMs > price.maxBillableSeconds * 1000,
        exhausted: input.elapsedMs >= price.maxWallSeconds * 1000 || billableMs >= price.maxBillableSeconds * 1000 };
}
