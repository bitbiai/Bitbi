import { prepareAiUsagePolicy, AI_USAGE_OPERATIONS } from '../../workers/auth/src/lib/ai-usage-policy.js';
import { calculateAiVideoCreditCost, calculateAiImageCreditCost } from '../../js/shared/ai-model-pricing.mjs';
import { isGptImage25Model } from '../../js/shared/gpt-image-25-contract.mjs';
import { settlePinnedModelTariff } from '../../workers/auth/src/lib/model-tariffs.js';
export async function modelPricingCase(env, body) {
    const image = isGptImage25Model(body.modelId), route=image?'/api/ai/generate-image':'/api/ai/generate-video';
    const payload = { ...(image ? {model:body.modelId} : {model:'minimax/h3', duration:5, resolution:'768P'}), prompt:'Synthetic pricing fixture', ...body.settings, ...(body.organization ? {organization_id:body.organization} : {}) };
    const request = new Request('https://bitbi.ai'+route, { method:'POST', headers:{ 'Idempotency-Key':body.key, 'X-Bitbi-Tariff-Revision':String(body.revision ?? 0) } });
    const price = (image?calculateAiImageCreditCost:calculateAiVideoCreditCost)(payload.model,payload);
    const policy = await prepareAiUsagePolicy({ env, request, user:{id:'q2-workerd-member',role:'user'}, body:payload,
        route, operation:{...(image?AI_USAGE_OPERATIONS.MEMBER_IMAGE_GENERATE:AI_USAGE_OPERATIONS.MEMBER_VIDEO_GENERATE),credits:price.credits,modelId:payload.model} });
    if (body.settle) {
        const pinned = policy.attempt.metadata.model_tariff;
        await policy.markProviderRunning(); await policy.markFinalizing();
        const units=image?undefined:{second:body.seconds ?? 5};
        const credits = settlePinnedModelTariff(pinned,price.credits,units);
        const result = await policy.chargeAfterSuccess({}, {credits,units});
        await policy.markSucceeded({ model:payload.model,metadata:{model_tariff:pinned} });
        return {kind:policy.attemptKind,credits:policy.credits,billing:result};
    }
    return {kind:policy.attemptKind,credits:policy.credits,attemptId:policy.attempt.id,tariff:policy.attempt.metadata.model_tariff};
}
