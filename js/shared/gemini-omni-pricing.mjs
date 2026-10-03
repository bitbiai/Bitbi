import { OMNI_MODEL, OMNI_OPERATIONS, omniOperation, omniSettings, omniFeatures } from './gemini-omni-contract.mjs';
import { browserModelTariff, mediaTariffBasis, getBrowserTariff, tariffKey } from './model-tariff.mjs';

export function omniFactoryPrice(input = {}) {
    const operation = input.operation ?? omniOperation(input.references);
    if (!OMNI_OPERATIONS.includes(operation)) throw new TypeError('Unsupported Omni pricing operation.');
    const { resolution } = omniSettings(input);
    return { modelId: OMNI_MODEL, credits: null, providerCostUsd: null,
        normalized: { resolution, operation },
        formula: { pricingVersion: 'omni-manual-retail-v1', billingMode: 'fixed_request', pricingSource: 'admin_manual_retail', providerCostStatus: 'unknown' } };
}
export function calculateOmniCreditPricing(input = {}) {
    const price = omniFactoryPrice(input);
    return browserModelTariff(price, mediaTariffBasis(price, 'video', input));
}

export function omniMemberAvailable(input = {}, snapshot = getBrowserTariff()) {
    try {
        const settings=omniSettings(input);
        if([...omniFeatures(input.references),settings.resolution].some(key=>snapshot?.omni?.enabled?.[key]!==true))return false;
        const factory=omniFactoryPrice(input);
        const rule=snapshot.rules?.[tariffKey(OMNI_MODEL,factory.normalized)];
        return !!rule && Number.isFinite(rule.rates?.request) && rule.rates.request>0;
    } catch { return false; }
}
export function omniMemberVisible(snapshot = getBrowserTariff()) {
    return ['360p','720p','1080p','4k'].some(resolution=>[[],[{role:'first_frame'}],[{role:'last_frame'}],[{role:'reference_image'}],[{role:'reference_video'}]].some(references=>omniMemberAvailable({resolution,references},snapshot)));
}
