import { browserModelTariff, mediaTariffBasis } from './model-tariff.mjs';
import { creditsForProviderCostUsd, requiredSellPriceUsdForProviderCost, creditValueUsd } from './model-credit-pricing.mjs';

// Exact Cloudflare aliases/schemas. Original H3 prices retain the owner's
// authenticated 2026-09-20 tariff; Lite uses its 2026-11-11 public catalog.
// Both bill output seconds, never input/total counters or direct-provider rates.
export const H3_MODEL = 'minimax/h3';
export const H3_LITE_MODEL = 'minimax/h3-lite';
export const H3_RESOLUTIONS = Object.freeze(['768P', '2K']);
export const H3_LITE_RESOLUTIONS = Object.freeze(['480P', '768P']);
export const H3_RATIOS = Object.freeze(['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16']);
export const H3_ROLES = Object.freeze(['first_frame', 'last_frame', 'reference_image', 'reference_video', 'reference_audio']);
// The v2 API documents the per-type limits for Lite. Twelve mixed files remains
// BITBI's conservative application cap inherited from the original H3 guide.
export const H3_LIMITS = Object.freeze({ image: 9, video: 3, audio: 3, total: 12 });
const definitions = Object.freeze({
    [H3_MODEL]: Object.freeze({ id: H3_MODEL, label: 'MiniMax H3', preset: 'video_minimax_h3', providerModel: 'MiniMax-H3',
        resolutions: H3_RESOLUTIONS, defaultResolution: '768P', roles: H3_ROLES, limits: H3_LIMITS,
        supportsVideoInput: true, supportsAudioInput: true, rates: Object.freeze({ '768P': 0.08, '2K': 0.13 }),
        pricingVersion: 'minimax-h3-output-seconds-v1', pricingSource: 'owner_cloudflare_h3_tariff_2026_09_20' }),
    [H3_LITE_MODEL]: Object.freeze({ id: H3_LITE_MODEL, label: 'MiniMax H3 Lite', preset: 'video_minimax_h3_lite', providerModel: 'MiniMax-H3-Lite',
        resolutions: H3_LITE_RESOLUTIONS, defaultResolution: '480P', roles: H3_ROLES, limits: H3_LIMITS,
        supportsVideoInput: true, supportsAudioInput: true, rates: Object.freeze({ '480P': 0.025, '768P': 0.04 }),
        pricingVersion: 'minimax-h3-lite-output-seconds-v1', pricingSource: 'cloudflare_h3_lite_catalog_2026_11_11' }),
});
export const isH3Model = id => Object.hasOwn(definitions, id);
export function h3ModelDefinition(id = H3_MODEL) {
    if (!isH3Model(id)) fail('Unsupported H3 model.');
    return definitions[id];
}
const fail = message => { throw Object.assign(new Error(message), { status: 400, code: 'validation_error' }); };
export const h3MediaType = role => role === 'reference_video' ? 'video' : role === 'reference_audio' ? 'audio' : 'image';

export function h3Settings(input = {}) {
    const model = h3ModelDefinition(input.model);
    const duration = input.duration === undefined ? 5 : Number(input.duration);
    const resolution = input.resolution === undefined ? model.defaultResolution : input.resolution;
    const aspect_ratio = input.aspect_ratio ?? input.ratio ?? '16:9';
    if (!Number.isInteger(duration) || duration < 4 || duration > 15) fail('H3 duration must be an integer from 4 to 15 seconds.');
    if (!model.resolutions.includes(resolution)) fail('Unsupported H3 resolution.');
    if (!H3_RATIOS.includes(aspect_ratio)) fail('Unsupported H3 ratio.');
    return { duration, resolution, aspect_ratio };
}

export function h3References(references = [], modelId = H3_MODEL) {
    const model = h3ModelDefinition(modelId);
    if (!Array.isArray(references) || references.length > model.limits.total) fail('H3 accepts at most twelve reference files.');
    const counts = Object.fromEntries(H3_ROLES.map(role => [role, 0]));
    const result = references.map(ref => {
        if (!ref || !model.roles.includes(ref.role)) fail('Unsupported H3 reference role.');
        if (Object.keys(ref).some(key => !['role', 'source'].includes(key))) fail('Only owned asset references are accepted.');
        const source = ref.source;
        if (!source || source.source_type !== 'saved_asset' || typeof source.asset_id !== 'string'
            || !/^[a-zA-Z0-9_-]{1,128}$/.test(source.asset_id)
            || Object.keys(source).some(key => !['source_type', 'asset_id'].includes(key))) fail('Select a saved, authorized H3 source.');
        counts[ref.role]++;
        return { role: ref.role, source: { source_type: 'saved_asset', asset_id: source.asset_id } };
    });
    if (counts.first_frame > 1 || counts.last_frame > 1) fail('H3 accepts one first and one last frame.');
    if ((counts.first_frame || counts.last_frame) && (counts.reference_image || counts.reference_video || counts.reference_audio)) fail('H3 frame inputs cannot be mixed with reference mode.');
    for (const type of ['image', 'video', 'audio']) if (counts[`reference_${type}`] > model.limits[type]) fail(`Too many H3 ${type} references.`);
    return result;
}

export function normalizeH3Request(input = {}) {
    const model = h3ModelDefinition(input.model);
    if (input.preset !== undefined && input.preset !== model.preset) fail('H3 preset does not match the selected model.');
    const allowed = new Set(['model', 'preset', 'prompt', 'duration', 'resolution', 'aspect_ratio', 'ratio', 'references']);
    if (Object.keys(input).some(key => !allowed.has(key))) fail('Unsupported H3 request field.');
    const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
    if (!prompt || [...prompt].length > 7000) fail('H3 requires a prompt of at most 7000 characters.');
    const settings = h3Settings(input), references = h3References(input.references, model.id);
    if (references.some(ref => ['first_frame', 'last_frame'].includes(ref.role)) && settings.aspect_ratio !== 'adaptive') fail('H3 frame inputs require adaptive ratio.');
    if (model.id === H3_LITE_MODEL && settings.aspect_ratio === 'adaptive' && !references.some(ref => ['first_frame', 'last_frame'].includes(ref.role))) fail('H3 Lite requires a concrete ratio outside frame mode.');
    return { model: model.id, preset: model.preset, prompt, ...settings, references };
}

function factory_calculateH3CreditPricing(input = {}, outputSeconds = null) {
    const model = h3ModelDefinition(input.model);
    const normalized = h3Settings(input);
    const seconds = outputSeconds === null ? normalized.duration : Number(outputSeconds);
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 15) fail('Invalid H3 output usage.');
    const rate = model.rates[normalized.resolution];
    const providerCostUsd = seconds * rate;
    const credits = creditsForProviderCostUsd(providerCostUsd);
    return { credits, modelId: model.id, providerCostUsd, minimumSellPriceUsd: requiredSellPriceUsdForProviderCost(providerCostUsd),
        chargedValueUsd: creditValueUsd(credits), normalized,
        formula: { pricingVersion: model.pricingVersion, pricingSource: model.pricingSource,
            billingMode: 'per_output_second', rateUsdPerSecond: rate, outputSeconds: seconds, targetProfitMargin: 0.2,
            requiredUserPrice: 'providerCost / (1 - targetProfitMargin)', rounding: 'ceil(requiredUserPriceEur / netEurPerCredit)' } };
}

// Resolved fields are produced only by Auth after ownership and byte validation;
// the AI service never accepts caller-selected callback/upload destinations.
export function buildH3ProviderInput(input) {
    const settings=h3Settings(input), references=h3References(input.references, input.model);
    const content=input.h3_content || [{type:'text',text:input.prompt}];
    if(content.length!==references.length+1 || content[0]?.type!=='text' || content[0]?.text!==input.prompt)fail('H3 content identity mismatch.');
    const internal=(url,path)=>{try{const parsed=new URL(url);return parsed.origin==='https://bitbi.ai'&&parsed.pathname.startsWith(path)&&!parsed.search&&!parsed.hash;}catch{return false;}};
    for(let i=0;i<references.length;i++) {
        const ref=references[i],type=`${h3MediaType(ref.role)}_url`,entry=content[i+1];
        if(entry.type!==type||entry.role!==ref.role||!internal(entry[type]?.url,'/api/internal/ai/media-source/'))fail('Invalid resolved H3 source.');
    }
    if(!internal(input.h3_callback,'/api/internal/ai/h3-callback/'))fail('H3 requires its internal completion destination.');
    return {content,duration:settings.duration,resolution:settings.resolution,ratio:settings.aspect_ratio,callback_url:input.h3_callback};
}

// This is a task receipt, never a generic URL search (a prompt or reference URL
// is not output). Native task state must agree with its own output identity.
export function parseH3Task(raw, expectedModel = H3_MODEL) {
    const model = h3ModelDefinition(expectedModel);
    const task = raw?.task ?? raw?.result?.task;
    if (!task || !['string', 'number'].includes(typeof task.id) || !String(task.id).match(/^[a-zA-Z0-9_-]{1,128}$/)
        || task.model !== model.providerModel || !['queued', 'running', 'succeeded', 'failed', 'cancelled'].includes(task.status)) {
        throw Object.assign(new Error('Invalid H3 task receipt.'), { code: 'h3_invalid_receipt', status: 502 });
    }
    let videoUrl = null;
    if (task.status === 'succeeded') {
        try { const url = new URL(task.content?.url); if (url.protocol !== 'https:' || url.username || url.password) throw new Error(); videoUrl = url.href; }
        catch { throw Object.assign(new Error('H3 output is unavailable.'), { code: 'h3_output_missing', status: 502 }); }
    }
    return { taskId: String(task.id), state: task.status, videoUrl, resolution: task.resolution,
        outputSeconds: task.usage?.output_seconds ?? null, duration: task.duration ?? null,
        failed: ['failed', 'cancelled'].includes(task.status), pending: ['queued', 'running'].includes(task.status) };
}

export function h3ReferenceError(code,de=false) {
    return ({
        h3_reference_file_duration:['Each reference video or audio must be between 2 and 15 seconds.','Jede Video- oder Audioreferenz muss zwischen 2 und 15 Sekunden lang sein.'],
        h3_reference_total_duration:['Reference videos or audio must total at most 15 seconds per media type.','Video- beziehungsweise Audioreferenzen dürfen zusammen je Medienart höchstens 15 Sekunden lang sein.'],
        h3_reference_preparation_failed:['The video reference could not be prepared. The original is unchanged; no generation was started.','Die Videoreferenz konnte nicht vorbereitet werden. Das Original ist unverändert; keine Generierung wurde gestartet.'],
    })[code]?.[de?1:0] || '';
}

export function calculateH3CreditPricing(input = {}, ...rest) {
    const factory = factory_calculateH3CreditPricing(input, ...rest);
    return browserModelTariff(factory, mediaTariffBasis(factory, 'video', input));
}
