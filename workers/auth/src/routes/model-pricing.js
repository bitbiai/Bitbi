import { providerPriceEvidence } from '../lib/model-provider-prices.js';
import { applyModelTariff } from '../../../../js/shared/model-tariff.mjs';
import { requireAdmin, getSessionUser } from '../lib/session.js';
import { json } from '../lib/response.js';
import { readJsonBodyOrResponse, BODY_LIMITS } from '../lib/request.js';
import { BillingError, billingErrorResponse } from '../lib/billing.js';
import { getModelTariff, changeModelTariff, quoteModelTariff, refreshProviderPriceSource } from '../lib/model-tariffs.js';
import { modelPricingCatalog, modelFactoryPrice, modelPricingControls, validateModelPricingSettings } from '../../../../js/shared/model-pricing-catalog.mjs';

const reply = (data, status = 200) => json({ ok: true, ...data }, { status, headers: { 'Cache-Control': 'private, no-store' } });
export async function handleModelPricing(ctx) {
    const { request, env, pathname, method, isSecure, correlationId } = ctx;
    if (pathname === '/api/model-pricing' && method === 'GET') {
        const session = await getSessionUser(request, env);
        const admin = session?.user?.role === 'admin' && session.user.status === 'active';
        const tariff = await getModelTariff(env), publicIds = new Set(modelPricingCatalog().filter(model => model.member).map(model => model.id));
        return reply({ ...tariff, rules: Object.fromEntries(Object.entries(tariff.rules).filter(([, rule]) => admin || publicIds.has(rule.modelId))) });
    }
    if (!pathname.startsWith('/api/admin/ai/model-pricing')) return null;
    const session = await requireAdmin(request, env, { isSecure, correlationId });
    if (session instanceof Response) return session;
    try {
        if (pathname === '/api/admin/ai/model-pricing' && method === 'GET') {
            const tariff = await getModelTariff(env);
            const models = modelPricingCatalog().map(model => {
                try { const {price,basis}=modelFactoryPrice(model.id); return { ...model, pricingControls:modelPricingControls(model), factory:price, basis, effective:applyModelTariff(price,tariff,basis), providerEvidence:providerPriceEvidence(model,price) }; }
                catch { return { ...model, factory: null, providerEvidence:providerPriceEvidence(model,null) }; }
            });
            const observations = await env.DB.prepare('SELECT model_id, source_url, observed_at, status FROM model_provider_price_observations').all();
            return reply({ ...tariff, models, observations: observations.results || [] });
        }
        const parsed = await readJsonBodyOrResponse(request, { maxBytes: BODY_LIMITS.smallJson });
        if (parsed.response) return parsed.response;
        if (pathname === '/api/admin/ai/model-pricing' && method === 'PATCH') return reply(await changeModelTariff(env, session.user, parsed.body));
        if (pathname === '/api/admin/ai/model-pricing/quote' && method === 'POST') {
            const { modelId, settings = {} } = parsed.body;
            const model = modelPricingCatalog().find(m=>m.id===modelId);
            if (!model) throw new TypeError('Unknown model.');
            validateModelPricingSettings(model, settings);
            return reply({ price: await quoteModelTariff(env, { modelId, input: settings }) });
        }
        if (pathname === '/api/admin/ai/model-pricing/source' && method === 'POST') return reply({ observation: await refreshProviderPriceSource(env, parsed.body.modelId) });
        return null;
    } catch (error) {
        if (error instanceof TypeError) return json({ ok: false, error: error.message, code: 'model_pricing_invalid' }, { status: 400 });
        return error instanceof BillingError ? json(billingErrorResponse(error), {status:error.status}) : json({ ok: false, error: 'Model pricing is unavailable.', code: 'model_pricing_unavailable' }, { status: 503 });
    }
}
