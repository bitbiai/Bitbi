// Provider evidence only: never used to change a customer's accepted tariff.
// Exact Workers AI aliases checked against Cloudflare's public pricing table.
const SOURCE = 'https://developers.cloudflare.com/workers-ai/platform/pricing/';
const checkedAt = '2026-09-21';
const tokenRates = {
    '@cf/meta/llama-3.3-70b-instruct-fp8-fast': { input:0.293, output:2.253 },
    '@cf/google/gemma-4-26b-a4b-it': { input:0.1, output:0.3 },
    '@cf/qwen/qwen3-30b-a3b-fp8': { input:0.051, output:0.335 },
    '@cf/openai/gpt-oss-120b': { input:0.35, output:0.75 },
    '@cf/openai/gpt-oss-20b': { input:0.2, output:0.3 },
    '@cf/baai/bge-m3': { input:0.012 },
};
function evidence(model, factory) {
    if (tokenRates[model.id]) return { status:'verified', checkedAt, sourceUrl:SOURCE, unit:'million_tokens', ratesUsd:tokenRates[model.id] };
    if (model.id === '@cf/black-forest-labs/flux-1-schnell') return { status:'verified', checkedAt, sourceUrl:SOURCE, ratesUsd:{tile512:0.0000528,step:0.0001056} };
    if (model.id === '@cf/black-forest-labs/flux-2-klein-9b') return { status:'verified', checkedAt, sourceUrl:SOURCE, ratesUsd:{firstMegapixel:0.015,additionalMegapixel:0.002,inputMegapixel:0.002} };
    if (model.id === '@cf/black-forest-labs/flux-2-dev') return { status:'verified', checkedAt, sourceUrl:SOURCE, ratesUsd:{inputTilePerStep:0.00021,outputTilePerStep:0.00041} };
    if (model.id === 'minimax/h3') return { status:'owner_verified_dashboard', checkedAt:'2026-09-20', sourceUrl:model.sourceUrl, unit:'output_second', ratesUsd:{'768P':0.08,'2K':0.13} };
    if (model.id === 'xai/grok-imagine-video-1.5-preview') return { status:'owner_verified_dashboard', checkedAt:'2026-09-20', sourceUrl:model.sourceUrl, unit:'output_second', ratesUsd:{'480p':0.08,'720p':0.14}, acquisitionMultiplier:1.05 };
    return { status:'not_currently_verified', checkedAt:null, sourceUrl:model.sourceUrl,
        factorySource:factory?.formula?.pricingSource || factory?.formula?.pricingVersion || null };
}

export function providerPriceEvidence(model, factory, now=Date.now()) {
    const result=evidence(model,factory);
    return {...result,status:result.checkedAt && now-Date.parse(result.checkedAt)>30*86400000 ? 'stale' : result.status};
}
