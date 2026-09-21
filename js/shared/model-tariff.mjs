// Retail credits only. Provider costs remain in the existing factory calculators.
// This module is also used by Auth; browser state is never an authority there.
export const MODEL_TARIFF_VERSION = 'model-tariff-v1';
export const FACTORY_TARIFF_VERSION = 'factory-2026-09-21';
export const TARIFF_HEADER = 'X-Bitbi-Tariff-Revision';
const DIMENSIONS = ['resolution', 'quality', 'size', 'width', 'height', 'steps', 'operation', 'generateAudio', 'reasoningEffort', 'separateLyricsGeneration'];
export const TARIFF_UNITS = ['request', 'second', 'image', 'referenceImage', 'inputMegapixel', 'inputToken', 'cachedInputToken', 'outputToken', 'cacheWriteToken'];
export const stablePricingJson = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map(key => [key, v[key]])) : v);
export function canonicalPricingModel(id) {
    return id === 'black-forest-labs/flux-2-klein-9b' ? '@cf/black-forest-labs/flux-2-klein-9b' : String(id || '');
}
export function tariffConfiguration(normalized = {}) {
    return Object.fromEntries(DIMENSIONS.filter(key => normalized[key] !== undefined && normalized[key] !== null)
        .map(key => [key, normalized[key]]));
}
export function tariffKey(modelId, configuration) {
    return `${canonicalPricingModel(modelId)}:${stablePricingJson(tariffConfiguration(configuration))}`;
}
export function mediaTariffBasis(factory, mediaType, input = {}) {
    const normalized = factory?.normalized || {};
    const configuration = tariffConfiguration(normalized);
    // Operations are separate tariffs even where their current prices coincide.
    if (mediaType === 'video' || mediaType === 'image') configuration.operation = input.operation || input._operation || normalized.operation || 'generate';
    let units;
    if (mediaType === 'video') units = { second: Number(factory?.formula?.outputSeconds ?? normalized.duration ?? input.duration) };
    else if (mediaType === 'image') {
        units = { image: Number(normalized.n ?? 1) };
        if (Object.hasOwn(normalized, 'inputImageMegapixels')) units.inputMegapixel = Number(normalized.inputImageMegapixels || 0);
        else if (Object.hasOwn(normalized, 'referenceImageCount') || Object.hasOwn(normalized, 'inputImageCount')) units.referenceImage = Number(normalized.inputImageCount ?? normalized.referenceImageCount ?? 0);
    } else units = { request: 1 };
    return { configuration, units };
}
export function validateTariffRates(rates, units) {
    if (!rates || typeof rates !== 'object' || Array.isArray(rates)
        || Object.keys(rates).length !== units.length || units.some(unit => !Object.hasOwn(rates, unit))) throw new TypeError('Supply every rate for this configuration.');
    for (const [unit, value] of Object.entries(rates)) {
        if (!units.includes(unit) || typeof value !== 'number' || !Number.isFinite(value)
            || value < 0 || value > 1_000_000 || Math.abs(value * 1e8 - Math.round(value * 1e8)) > 0.001) throw new TypeError('Invalid credit rate.');
    }
    if (!Object.values(rates).some(value => value > 0)) throw new TypeError('A tariff must have a positive rate.');
    return { ...rates };
}
export function applyModelTariff(factory, snapshot, basis) {
    if (!factory || !basis) return factory;
    const key = tariffKey(factory.modelId, basis.configuration);
    const rule = snapshot?.rules?.[key];
    let credits = factory.credits;
    if (rule) {
        validateTariffRates(rule.rates, Object.keys(basis.units));
        const total = Object.entries(basis.units).reduce((sum, [unit, quantity]) => {
            if (!Number.isFinite(quantity) || quantity < 0) throw new TypeError('Invalid billing quantity.');
            // Quantities carry at most six fractional digits (seconds/MP);
            // round upward, never under-reserve a fractional input quantity.
            return sum + BigInt(Math.ceil(quantity * 1e6)) * BigInt(Math.round(rule.rates[unit] * 1e8));
        }, 0n);
        credits = Math.max(1, Number((total + 100_000_000_000_000n - 1n) / 100_000_000_000_000n));
        if (!Number.isSafeInteger(credits) || credits > 100_000) throw new TypeError('Tariff exceeds the credit limit.');
    }
    return { ...factory, credits, factoryCredits: factory.credits, tariff: {
        version: MODEL_TARIFF_VERSION, factoryVersion: FACTORY_TARIFF_VERSION,
        revision: snapshot?.revision ?? 0, key, configuration: basis.configuration,
        units: basis.units, rates: rule?.rates || null, source: rule ? 'custom' : 'factory',
    } };
}

let browserSnapshot = null;
export function setBrowserTariff(snapshot) { browserSnapshot = snapshot; }
export function getBrowserTariff() { return browserSnapshot; }
export function browserModelTariff(factory, basis) {
    return typeof window === 'undefined' ? factory : applyModelTariff(factory, browserSnapshot, basis);
}

export function textTariffBasis(modelId, input = {}, defaults = {}) {
    const grok = modelId === 'xai/grok-4.6';
    const reasoningEffort = input.reasoningEffort || 'medium';
    const inputToken = Math.max(1, new TextEncoder().encode(String(input.prompt || input.text || '') + String(input.systemPrompt || input.system || '')).length + (grok ? 4096 : 0));
    const outputToken = Math.max(0, Number(input.maxTokens ?? input.max_tokens ?? defaults.maxTokens ?? 500));
    return { configuration: grok ? { reasoningEffort } : {}, units: { inputToken, outputToken } };
}
