import { BITBI_MODEL_PRICING_USD_TO_EUR, BITBI_NET_EUR_PER_CREDIT_FOR_MODEL_PRICING, BITBI_TARGET_PROFIT_MARGIN, creditsForProviderCostUsd } from '../../../../js/shared/model-credit-pricing.mjs';
import { applyModelTariff, mediaTariffBasis, canonicalPricingModel, tariffKey, validateTariffRates, FACTORY_TARIFF_VERSION, TARIFF_HEADER, stablePricingJson } from '../../../../js/shared/model-tariff.mjs';
import { modelFactoryPrice, modelPricingCatalog, validateModelPricingSettings } from '../../../../js/shared/model-pricing-catalog.mjs';
import { BillingError } from './billing.js';
import { sha256Hex, randomTokenHex } from './tokens.js';

const fail = (message, code = 'model_pricing_invalid', status = 400) => { throw new BillingError(message, { code, status }); };
export async function getModelTariff(env) {
    const row = await env.DB.prepare('SELECT revision, factory_version, rules_json, updated_at FROM model_pricing_state WHERE id=1').first();
    if (!row || row.factory_version !== FACTORY_TARIFF_VERSION) fail('Model pricing is unavailable.', 'model_pricing_unavailable', 503);
    return { revision: row.revision, rules: JSON.parse(row.rules_json), updatedAt: row.updated_at, factoryVersion: row.factory_version };
}
export async function assertTariffRevision(env, revision) {
    if (revision === undefined) return;
    const state = await getModelTariff(env);
    if (Number(revision) !== state.revision) fail('Prices changed. Review the refreshed estimate before generating.', 'model_pricing_stale', 409);
}
export async function quoteModelTariff(env, { modelId, input = {}, credits, context, request, factory }) {
    const snapshot = await getModelTariff(env);
    if (request && snapshot.revision > 0 && request.headers.get(TARIFF_HEADER) !== String(snapshot.revision)) {
        fail('Prices changed. Review the refreshed estimate before generating.', 'model_pricing_stale', 409);
    }
    if (modelId === 'admin.compare.multi_model' && credits === 0) return { credits: 0, tariff: null, exempt: 'unmetered_compare_reference_only' };
    const resolved = factory ? { model: modelPricingCatalog().find(m=>m.id===canonicalPricingModel(factory.modelId || modelId)) } : modelFactoryPrice(modelId, input, { credits, context });
    const { model } = resolved;
    if (!model) fail('Unknown model.');
    const price = factory || resolved.price;
    const basis = factory ? mediaTariffBasis(factory, model.kind, input) : resolved.basis;
    const priced = applyModelTariff(price, snapshot, basis);
    // H3 alone currently settles authoritative output seconds. Freeze its
    // provider rate, conversion and margin, including under factory pricing.
    const factorySettlement = model.id === 'minimax/h3' ? {
        rateUsdPerSecond: price.formula.rateUsdPerSecond,
        usdToEur: BITBI_MODEL_PRICING_USD_TO_EUR,
        netEurPerCredit: BITBI_NET_EUR_PER_CREDIT_FOR_MODEL_PRICING,
        targetProfitMargin: BITBI_TARGET_PROFIT_MARGIN,
    } : null;
    return { ...priced, factorySettlement, exempt: model.exemption || null };
}

// Used before reservation, after an exact existing-attempt lookup. No request
// data or client-supplied credits are trusted; factory credits come from callers.
export async function pinModelTariff(env, { modelId, input, credits, request, existing, context, factory }) {
    if (existing) {
        const pinned = existing.metadata?.model_tariff || existing.budgetPolicy?.model_tariff;
        return pinned || { credits: Number(existing.creditCost ?? existing.budgetPolicy?.estimated_credits ?? credits), tariff: null, legacy: true };
    }
    const price = await quoteModelTariff(env, { modelId, input, credits, context, request, factory });
    if (!Number.isSafeInteger(price.credits) || price.credits < 0) fail('This execution path has no configured credit tariff.', 'model_pricing_unavailable', 503);
    return { credits: price.credits, tariff: price.tariff, factorySettlement: price.factorySettlement };
}
export function settlePinnedModelTariff(pinned, fallbackCredits, actualUnits) {
    if (!actualUnits || !pinned?.tariff) return fallbackCredits;
    if (!pinned.tariff.rates) {
        if (!pinned.factorySettlement) return fallbackCredits;
        const seconds = actualUnits.second;
        if (!Number.isFinite(seconds) || seconds <= 0 || seconds > pinned.tariff.units.second) fail('Actual usage exceeds the accepted reservation.', 'generation_result_requires_credit_review', 409);
        return creditsForProviderCostUsd(seconds * pinned.factorySettlement.rateUsdPerSecond, pinned.factorySettlement);
    }
    const tariff = pinned.tariff;
    const credits = applyModelTariff({ modelId: tariff.key.split(':')[0], credits: fallbackCredits },
        { revision: tariff.revision, rules: { [tariff.key]: { rates: tariff.rates } } },
        { configuration: tariff.configuration, units: { ...tariff.units, ...actualUnits } }).credits;
    if (credits > pinned.credits) fail('Actual usage exceeds the accepted reservation.', 'generation_result_requires_credit_review', 409);
    return credits;
}

export async function changeModelTariff(env, actor, input) {
    if (!Number.isSafeInteger(input.revision) || !['save', 'reset', 'reset_model'].includes(input.action)) fail('Invalid pricing change.');
    if (Object.keys(input).some(key => !['revision', 'action', 'modelId', 'settings', 'rates'].includes(key))) fail('Unsupported pricing field.');
    const model = modelPricingCatalog().find(item => item.id === input.modelId);
    if (!model) fail('Unknown model.');
    validateModelPricingSettings(model, input.settings);
    const current = await getModelTariff(env);
    if (current.revision !== input.revision) fail('Another administrator changed pricing. Reload before saving.', 'model_pricing_conflict', 409);
    const rules = { ...current.rules };
    let key = null, baseline = null;
    if (input.action === 'reset_model') {
        for (const entry of Object.keys(rules)) if (rules[entry].modelId === model.id) delete rules[entry];
    } else {
        const { price, basis } = modelFactoryPrice(model.id, input.settings || {});
        if (!model.enabled || !Number.isFinite(price.credits)) fail('Pricing cannot enable an unavailable execution path.');
        key = tariffKey(model.id, basis.configuration);
        baseline = { price, basis, sourceUrl: model.sourceUrl, factoryVersion: FACTORY_TARIFF_VERSION };
        if (input.action === 'reset') delete rules[key];
        else {
            rules[key] = { modelId: model.id, configuration: basis.configuration, rates: validateTariffRates(input.rates, Object.keys(basis.units)) };
            applyModelTariff(price, {revision:current.revision,rules}, basis);
        }
    }
    if (Object.keys(rules).length > 4096) fail('Too many custom configurations.');
    const now = new Date().toISOString(), changeId = randomTokenHex(16);
    const statements = [env.DB.prepare(`UPDATE model_pricing_state SET revision=revision+1, rules_json=?, change_id=?, updated_at=? WHERE id=1 AND revision=?`)
        .bind(stablePricingJson(rules), changeId, now, input.revision),
    env.DB.prepare(`INSERT INTO model_pricing_changes (revision,actor_user_id,change_id,model_id,configuration_key,action,before_json,after_json,created_at)
        SELECT revision,?,?,?,?,?,?,?,? FROM model_pricing_state WHERE id=1 AND change_id=?`)
        .bind(actor.id, changeId, model.id, key, input.action, stablePricingJson(current.rules), stablePricingJson(rules), now, changeId)];
    if (baseline) statements.push(env.DB.prepare(`INSERT OR IGNORE INTO model_pricing_factory (version,configuration_key,baseline_json,created_at)
        SELECT ?,?,?,? FROM model_pricing_state WHERE id=1 AND change_id=?`)
        .bind(FACTORY_TARIFF_VERSION, key, stablePricingJson(baseline), now, changeId));
    const result = await env.DB.batch(statements);
    if (result[0].meta?.changes !== 1) fail('Another administrator changed pricing. Reload before saving.', 'model_pricing_conflict', 409);
    return getModelTariff(env);
}

// A document refresh is evidence of retrieval, NOT approval of changed rates.
// Existing factory costs and custom retail tariffs are never changed by it.
export async function refreshProviderPriceSource(env, modelId) {
    const model = modelPricingCatalog().find(item => item.id === modelId);
    if (!model) fail('Unknown model.');
    const response = await fetch(model.sourceUrl, { redirect: 'error', signal: AbortSignal.timeout(8000), headers: { Accept: 'text/markdown' } });
    const reader = response.body?.getReader();
    const chunks = []; let bytes = 0;
    if (reader) try {
        while (true) { const {done,value} = await reader.read(); if (done) break;
            bytes += value.byteLength; if (bytes > 1_000_000) { await reader.cancel(); fail('Provider source is too large.', 'provider_source_unavailable', 502); } chunks.push(value);
        }
    } finally { reader.releaseLock(); }
    const text = await new Blob(chunks).text();
    const observation = { modelId, sourceUrl: model.sourceUrl, observedAt: new Date().toISOString(), status: response.ok ? 'review_required' : 'unavailable', contentSha256: await sha256Hex(text) };
    await env.DB.prepare(`INSERT INTO model_provider_price_observations (model_id,source_url,observed_at,content_sha256,status) VALUES (?,?,?,?,?)
        ON CONFLICT(model_id) DO UPDATE SET source_url=excluded.source_url, observed_at=excluded.observed_at, content_sha256=excluded.content_sha256, status=excluded.status`)
        .bind(modelId, observation.sourceUrl, observation.observedAt, observation.contentSha256, observation.status).run();
    return observation;
}
