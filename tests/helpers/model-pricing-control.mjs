import { prepareAiUsagePolicy, AI_USAGE_OPERATIONS } from '../../workers/auth/src/lib/ai-usage-policy.js';
import { calculateAiVideoCreditCost } from '../../js/shared/ai-model-pricing.mjs';
import { settlePinnedModelTariff } from '../../workers/auth/src/lib/model-tariffs.js';
export async function modelPricingCase(env, body) {
    const payload = { model:'minimax/h3', duration:5, resolution:'768P', prompt:'Synthetic pricing fixture', ...body.settings, ...(body.organization ? {organization_id:body.organization} : {}) };
    const request = new Request('https://bitbi.ai/api/ai/generate-video', { method:'POST', headers:{ 'Idempotency-Key':body.key, 'X-Bitbi-Tariff-Revision':String(body.revision ?? 0) } });
    const price = calculateAiVideoCreditCost(payload.model,payload);
    const policy = await prepareAiUsagePolicy({ env, request, user:{id:'q2-workerd-member',role:'user'}, body:payload,
        route:'/api/ai/generate-video', operation:{...AI_USAGE_OPERATIONS.MEMBER_VIDEO_GENERATE,credits:price.credits,modelId:payload.model} });
    if (body.settle) {
        const pinned = policy.attempt.metadata.model_tariff;
        await policy.markProviderRunning(); await policy.markFinalizing();
        const credits = settlePinnedModelTariff(pinned,price.credits,{second:body.seconds ?? 5});
        const result = await policy.chargeAfterSuccess({}, {credits,units:{second:body.seconds ?? 5}});
        await policy.markSucceeded({ model:payload.model,metadata:{model_tariff:pinned} });
        return {kind:policy.attemptKind,credits:policy.credits,billing:result};
    }
    return {kind:policy.attemptKind,credits:policy.credits,attemptId:policy.attempt.id,tariff:policy.attempt.metadata.model_tariff};
}
