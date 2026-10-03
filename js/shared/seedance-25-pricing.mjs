import { SEEDANCE_25_MODEL, seedance25Settings, seedance25References } from './seedance-25-contract.mjs';
import { creditsForProviderCostUsd, requiredSellPriceUsdForProviderCost, creditValueUsd, BITBI_MODEL_PRICING_USD_TO_EUR, BITBI_NET_EUR_PER_CREDIT_FOR_MODEL_PRICING, BITBI_TARGET_PROFIT_MARGIN } from './model-credit-pricing.mjs';
import { browserModelTariff, mediaTariffBasis, tariffKey } from './model-tariff.mjs';

// Owner-approved BITBI retail policy, 2026-10-03: charge measured stored output
// seconds, not a claimed provider bill. Preserve this distinction in Admin.
export const SEEDANCE_25_RATES = Object.freeze({
    '480p': Object.freeze({ non_video: 0.1028, video: 0.4304 }),
    '720p': Object.freeze({ non_video: 0.2312, video: 0.9676 }),
});
export const SEEDANCE_25_PRICING_EVIDENCE = Object.freeze({
    status: 'owner_custom_output_duration', rateSource: 'owner_supplied_2026_10_03',
    sourceUrl: 'https://developers.cloudflare.com/ai/models/bytedance/seedance-2.5/',
    fundingSourceUrl: 'https://developers.cloudflare.com/ai-gateway/features/unified-billing/',
    fundingMultiplier: 1.05, checkedAt: '2026-10-03',
});
export const SEEDANCE_25_FALLBACK_RATE = 0.433;

// Only the Admin price-preview boundary supplies a tier explicitly. Actual
// execution always derives it from the validated submitted reference list.
export function seedance25FactoryPriceForTier(input = {}, inputTier = 'non_video', outputSeconds = null) {
    const settings = seedance25Settings(input);
    if (!['non_video', 'video', 'unmapped'].includes(inputTier)) throw new TypeError('Unsupported Seedance input tier.');
    // Reserve a visible 30-second bound, including fixed-duration requests:
    // container timing need not equal the requested integer. Never over-debit.
    const seconds = outputSeconds === null ? 30 : outputSeconds;
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 30) throw new TypeError('Stored output duration requires credit review.');
    const inferenceRate = inputTier === 'unmapped' ? SEEDANCE_25_FALLBACK_RATE : SEEDANCE_25_RATES[settings.resolution][inputTier];
    const rateUsdPerSecond = inferenceRate * SEEDANCE_25_PRICING_EVIDENCE.fundingMultiplier;
    const providerCostUsd = seconds * rateUsdPerSecond;
    const credits = creditsForProviderCostUsd(providerCostUsd);
    return { modelId: SEEDANCE_25_MODEL, credits, providerCostUsd,
        minimumSellPriceUsd: requiredSellPriceUsdForProviderCost(providerCostUsd), chargedValueUsd: creditValueUsd(credits),
        normalized: { duration: settings.duration, resolution: settings.resolution, inputTier },
        formula: { pricingVersion: 'seedance-25-owner-output-duration-v1', pricingSource: SEEDANCE_25_PRICING_EVIDENCE.rateSource,
            pricingStatus: SEEDANCE_25_PRICING_EVIDENCE.status, billingMode: 'custom_stored_output_seconds', providerMeteringVerified: false,
            outputSeconds: seconds, reservationBoundSeconds: seconds, auto: settings.duration === -1,
            inferenceRateUsdPerSecond: inferenceRate, rateUsdPerSecond,
            fundingMultiplier: SEEDANCE_25_PRICING_EVIDENCE.fundingMultiplier,
            usdToEur: BITBI_MODEL_PRICING_USD_TO_EUR, netEurPerCredit: BITBI_NET_EUR_PER_CREDIT_FOR_MODEL_PRICING,
            targetProfitMargin: BITBI_TARGET_PROFIT_MARGIN,
            rounding: 'ceil((providerCost / 0.80) * usdToEur / netEurPerCredit)' } };
}

export function seedance25FactoryPrice(input = {}, outputSeconds = null) {
    const references = seedance25References(input.references);
    return seedance25FactoryPriceForTier(input, references.some(ref => ref.role === 'reference_video') ? 'video' : 'non_video', outputSeconds);
}
export function calculateSeedance25CreditPricing(input = {}) {
    const factory = seedance25FactoryPrice(input);
    return browserModelTariff(factory, mediaTariffBasis(factory, 'video', input));
}

export function seedance25InitialTariffRules() {
    const rules = {};
    for (const resolution of ['480p', '720p']) for (const inputTier of ['non_video', 'video', 'unmapped']) {
        const price = seedance25FactoryPriceForTier({ resolution }, inputTier), basis = mediaTariffBasis(price, 'video');
        const perSecond = price.formula.rateUsdPerSecond / (1 - BITBI_TARGET_PROFIT_MARGIN) * BITBI_MODEL_PRICING_USD_TO_EUR / BITBI_NET_EUR_PER_CREDIT_FOR_MODEL_PRICING;
        // The existing tariff store has eight decimal places per unit. Preserve
        // that precision; round the final request charge upward only once.
        rules[tariffKey(SEEDANCE_25_MODEL, basis.configuration)] = { modelId: SEEDANCE_25_MODEL, configuration: basis.configuration,
            rates: { second: Math.ceil(perSecond * 1e8) / 1e8 }, source: 'owner_custom_output_duration_2026_10_03' };
    }
    return rules;
}
