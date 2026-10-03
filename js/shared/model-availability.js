import { getBrowserTariff } from './model-tariff.mjs';
export function modelAreaEnabled(modelId, area) {
    const policy=getBrowserTariff()?.availability;
    return policy?.version===1 && policy.models?.[modelId]?.[area]===true;
}
export function modelAvailabilitySignature() { return JSON.stringify(getBrowserTariff()?.availability || null); }

export function modelAreaState(modelId,area){const policy=getBrowserTariff()?.availability;const value=policy?.version===1?policy.models?.[modelId]?.[area]:null;return typeof value==='boolean'?value:null;}
