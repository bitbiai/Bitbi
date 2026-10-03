import { OMNI_MODEL, OMNI_FEATURES, OMNI_RESOLUTIONS, omniFeatures, normalizeOmniRequest } from '../../../../js/shared/gemini-omni-contract.mjs';
import { BillingError } from './billing.js';

const KEY = 'model_readiness:google/gemini-omni-flash';
const scopes = [...OMNI_FEATURES, ...OMNI_RESOLUTIONS];
const fail = (message, code = 'omni_readiness_unavailable', status = 503) => { throw new BillingError(message, { code, status }); };
const defaults = () => ({ revision: 0, adminTestEnabled: false, adminTestCredits: null, enabled: Object.fromEntries(scopes.map(key => [key, false])), acceptance: {}, history: [], previous: null });

export async function getOmniReadiness(env) {
    const row = await env.DB.prepare('SELECT value_json FROM app_settings WHERE key=?').bind(KEY).first();
    if (!row) return defaults();
    let state;
    try { state = JSON.parse(row.value_json); } catch { fail('Omni readiness is invalid.'); }
    if (!Number.isSafeInteger(state?.revision) || state.revision < 1 || typeof state.adminTestEnabled !== 'boolean'
        || !(state.adminTestCredits === null || Number.isSafeInteger(state.adminTestCredits) && state.adminTestCredits > 0 && state.adminTestCredits <= 100000)
        || scopes.some(key => typeof state.enabled?.[key] !== 'boolean') || !Array.isArray(state.history)) fail('Omni readiness is invalid.');
    return state;
}

export async function getPublicOmniReadiness(env) {
    try { return publicOmniReadiness(await getOmniReadiness(env)); }
    catch { return { ...publicOmniReadiness(defaults()), unavailable: true }; }
}

export function publicOmniReadiness(state) {
    return { revision: state.revision, enabled: { ...state.enabled } };
}

export async function assertOmniReady(env, input, { adminTest = false } = {}) {
    const state = await getOmniReadiness(env);
    if (adminTest) {
        if (!state.adminTestEnabled || !Number.isSafeInteger(state.adminTestCredits) || state.adminTestCredits < 1) fail('Enable an explicitly budgeted Omni Admin test in Model Status first.', 'omni_admin_test_disabled', 409);
        return state;
    }
    if ([...omniFeatures(input.references), input.resolution].some(key => state.enabled[key] !== true)) fail('This Omni capability has not been accepted and activated for members.', 'omni_capability_disabled', 409);
    return state;
}

// Existing MFA/CSRF-protected pricing mutation route owns authorization. These
// settings are not a pricing ledger; retail rules and job reservations stay in
// model_pricing_state / the existing usage ledgers.
export async function changeOmniReadiness(env, actor, input) {
    if (Object.keys(input).some(key => !['action', 'revision', 'config', 'feature', 'enabled', 'evidenceJobId', 'reason'].includes(key))) fail('Unsupported readiness field.', 'omni_readiness_invalid', 400);
    const current = await getOmniReadiness(env);
    if (input.revision !== current.revision) fail('Another administrator changed Omni settings. Reload before saving.', 'omni_readiness_conflict', 409);
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (reason.length < 10 || reason.length > 500) fail('Provide a concise acceptance or change note (10–500 characters).', 'omni_readiness_invalid', 400);
    const next = structuredClone(current);
    if (input.config !== undefined) {
        const config = input.config;
        if (!config || Object.keys(config).some(key => !['adminTestEnabled', 'adminTestCredits'].includes(key))
            || typeof config.adminTestEnabled !== 'boolean' || !(config.adminTestCredits === null || Number.isSafeInteger(config.adminTestCredits) && config.adminTestCredits > 0 && config.adminTestCredits <= 100000)
            || config.adminTestEnabled && config.adminTestCredits === null) fail('Set a positive reservation in platform-budget credit units before enabling Admin tests.', 'omni_readiness_invalid', 400);
        Object.assign(next, config);
    } else {
        if (!scopes.includes(input.feature) || typeof input.enabled !== 'boolean') fail('Select an Omni capability or resolution.', 'omni_readiness_invalid', 400);
        if (input.enabled) {
            if (typeof input.evidenceJobId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(input.evidenceJobId)) fail('A completed owned Admin test job is required.', 'omni_acceptance_required', 409);
            const job = await env.DB.prepare("SELECT input_json, completed_at FROM ai_video_jobs WHERE id=? AND user_id=? AND model=? AND scope='admin' AND status='succeeded' AND output_r2_key IS NOT NULL")
                .bind(input.evidenceJobId, actor.id, OMNI_MODEL).first();
            if (!job) fail('The evidence must be a completed, stored Omni Admin test owned by you.', 'omni_acceptance_required', 409);
            let request;
            try { const raw = JSON.parse(job.input_json); request = normalizeOmniRequest(Object.fromEntries(Object.entries(raw).filter(([key]) => !key.startsWith('__') && key!=='_source_snapshots'))); } catch { fail('The test configuration cannot be verified.', 'omni_acceptance_required', 409); }
            if (![...omniFeatures(request.references), request.resolution].includes(input.feature)) fail('This job did not exercise the selected capability.', 'omni_acceptance_required', 409);
            next.acceptance[input.feature] = { jobId: input.evidenceJobId, completedAt: job.completed_at, acceptedBy: actor.id, note: reason };
        }
        next.enabled[input.feature] = input.enabled;
    }
    const at = new Date().toISOString();
    next.previous = { adminTestEnabled: current.adminTestEnabled, adminTestCredits: current.adminTestCredits, enabled: current.enabled, acceptance: current.acceptance };
    next.revision++;
    next.history = [...current.history, { revision: next.revision, actor: actor.id, at, reason, feature: input.feature || 'admin_test', enabled: input.enabled ?? input.config.adminTestEnabled }].slice(-30);
    const result = await env.DB.prepare(`INSERT INTO app_settings(key,value_json,updated_at,updated_by_user_id,reason) VALUES(?,?,?,?,?)
        ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at,updated_by_user_id=excluded.updated_by_user_id,reason=excluded.reason
        WHERE json_extract(app_settings.value_json,'$.revision')=?`).bind(KEY, JSON.stringify(next), at, actor.id, reason, current.revision).run();
    if (result.meta?.changes !== 1) fail('Another administrator changed Omni settings. Reload before saving.', 'omni_readiness_conflict', 409);
    return next;
}
