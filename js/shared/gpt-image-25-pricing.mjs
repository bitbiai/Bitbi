import { isGptImage25Model, normalizeGptImage25Options, GPT_IMAGE_25_MAX_PROMPT_LENGTH } from './gpt-image-25-contract.mjs';
import { browserModelTariff, mediaTariffBasis } from './model-tariff.mjs';
import { creditsForProviderCostUsd, BITBI_MODEL_PRICING_USD_TO_EUR, BITBI_NET_EUR_PER_CREDIT_FOR_MODEL_PRICING, BITBI_TARGET_PROFIT_MARGIN } from './model-credit-pricing.mjs';

// Cloudflare's model catalog exposes these exact alias rates in its embedded
// data-model-pricing attributes. These are token rates, not per-image costs.
// Its adapter schema promises neither token quantities nor resolved auto
// settings. A different model's token schedule is not evidence for these IDs.
export const GPT_IMAGE_25_PRICING_VERSION = 'gpt-image-2.5-bounded-2026-09-22';
export const GPT_IMAGE_25_PROVIDER_PRICING = Object.freeze({
    sourceUrl: 'https://developers.cloudflare.com/ai/models/',
    checkedAt: '2026-09-22',
    sourceSha256: '654258f692dbd1cf3a72b0a01d4665b78b288b20b263db97cb7dc97249512f78',
    unit: 'million_tokens',
    ratesUsd: Object.freeze({ inputToken: 5, cachedInputToken: 1.25, inputImageToken: 8, cachedInputImageToken: 3, outputImageToken: 30 }),
    fundingMultiplier: 1.05,
    fundingSourceUrl: 'https://developers.cloudflare.com/ai-gateway/features/unified-billing/',
});
export const GPT_IMAGE_25_OUTPUT_TOKEN_SOURCE = Object.freeze({
    sourceUrl: 'https://developers.openai.com/api/docs/guides/image-generation',
    calculatorUrl: 'https://developers.openai.com/_astro/GptImageTokenCalculator.react.Z2Zu5XGo.js',
    sourceSha256: '893dc3f5500595ac138e607ed0f59aff87bd92354938ec9213e089c0a5d0b60a',
    checkedAt: '2026-09-22',
});
const OUTPUT_GRIDS = Object.freeze({ low: 16, medium: 24, high: 48, xhigh: 64, max: 96 });
const MAX_OUTPUT_PIXELS = 8_294_400;
// UTF-8 has at most three bytes per UTF-16 code unit (a surrogate pair uses
// four bytes for two code units). Overview quotes without a prompt show this
// application maximum; admissions use the actual prompt's byte-token bound.
const MAX_TEXT_INPUT_TOKEN_BOUND = GPT_IMAGE_25_MAX_PROMPT_LENGTH * 3;
function roundHalfEven(value) {
    const integer = Math.floor(value);
    return value - integer === 0.5 ? integer + integer % 2 : Math.round(value);
}
export function gptImage25OutputTokens(input = {}) {
    const { quality, size } = normalizeGptImage25Options(input);
    const grid = OUTPUT_GRIDS[quality === 'auto' ? 'max' : quality];
    if (size === 'auto') {
        // OpenAI's calculator caps all 2.5 outputs at this pixel budget. A
        // square maximizes both grid dimensions; 2880² realizes this bound.
        return { tokens: Math.ceil(grid * grid * (2_000_000 + MAX_OUTPUT_PIXELS) / 4_000_000), bound: true };
    }
    const [width, height] = size.split('x').map(Number);
    const shortGrid = roundHalfEven(grid / (Math.max(width, height) / Math.min(width, height)));
    return { tokens: Math.ceil(grid * shortGrid * (2_000_000 + width * height) / 4_000_000), bound: quality === 'auto' };
}
export function isGptImage25PricingAvailable(modelId, input = {}) {
    return isGptImage25Model(modelId) && Number.isSafeInteger(gptImage25FactoryPrice(modelId, input).credits);
}

export function gptImage25FactoryPrice(modelId, input = {}) {
    if (!isGptImage25Model(modelId)) throw new TypeError('Unknown GPT Image 2.5 model.');
    const { prompt, ...normalized } = normalizeGptImage25Options(input);
    const textInputTokenBound = prompt === undefined ? MAX_TEXT_INPUT_TOKEN_BOUND : new TextEncoder().encode(prompt).length;
    const output = gptImage25OutputTokens(normalized);
    const inputImageBasisVerified = normalized.referenceImageCount === 0;
    const inferenceCostUsd = inputImageBasisVerified
        ? (textInputTokenBound * GPT_IMAGE_25_PROVIDER_PRICING.ratesUsd.inputToken + output.tokens * GPT_IMAGE_25_PROVIDER_PRICING.ratesUsd.outputImageToken) / 1_000_000 : null;
    const providerCostUsd = inferenceCostUsd === null ? null : inferenceCostUsd * GPT_IMAGE_25_PROVIDER_PRICING.fundingMultiplier;
    return {
        modelId, credits: providerCostUsd === null ? null : creditsForProviderCostUsd(providerCostUsd), providerCostUsd, inferenceCostUsd,
        pricingStatus: inputImageBasisVerified ? 'verified_bounded_quote' : 'input_image_token_quantities_unverified', normalized,
        formula: {
            pricingVersion: GPT_IMAGE_25_PRICING_VERSION,
            billingMode: 'fixed_bounded_quote',
            pricingSource: GPT_IMAGE_25_PROVIDER_PRICING.sourceUrl,
            providerRatesUsdPerMillionTokens: GPT_IMAGE_25_PROVIDER_PRICING.ratesUsd,
            fundingMultiplier: GPT_IMAGE_25_PROVIDER_PRICING.fundingMultiplier,
            rateEvidenceStatus: 'verified', quantityEvidenceStatus: inputImageBasisVerified ? 'verified_bound' : 'input_images_not_verified',
            textInputTokenBound, promptBoundIsMaximum: prompt === undefined,
            outputImageTokens: output.tokens, outputImageTokensAreBound: output.bound,
            outputTokenSource: GPT_IMAGE_25_OUTPUT_TOKEN_SOURCE,
            quantityPolicy: 'utf8_prompt_byte_bound_and_selected_or_bounded_auto_output; uncached_input',
            usdToEur: BITBI_MODEL_PRICING_USD_TO_EUR, netEurPerCredit: BITBI_NET_EUR_PER_CREDIT_FOR_MODEL_PRICING,
            targetProfitMargin: BITBI_TARGET_PROFIT_MARGIN,
            rounding: 'ceil(requiredUserPriceEur / netEurPerCredit)',
            settlement: 'accepted_quote_without_provider_usage',
            unavailableCode: inputImageBasisVerified ? null : 'gpt_image_25_reference_pricing_unavailable',
        },
    };
}

export function calculateGptImage25CreditCost(modelId, input = {}) {
    // Validate even when blocked, but never let a null provider cost flow into
    // the common conversion helper's one-credit minimum.
    const factory = gptImage25FactoryPrice(modelId, input);
    return factory.credits === null ? null : browserModelTariff(factory, mediaTariffBasis(factory, 'image', input));
}
