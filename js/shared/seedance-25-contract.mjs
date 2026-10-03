// Exact Cloudflare route, checked 2026-10-03. Native ByteDance and Seedance 2.0
// contracts are not substitutes. Source: /ai/models/bytedance/seedance-2.5/.
export const SEEDANCE_25_MODEL = 'bytedance/seedance-2.5';
export const SEEDANCE_25_PRESET = 'video_seedance_25';
export const SEEDANCE_25_RESOLUTIONS = Object.freeze(['480p', '720p']);
export const SEEDANCE_25_RATIOS = Object.freeze(['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive']);
export const SEEDANCE_25_WORKFLOWS = Object.freeze(['generate', 'edit', 'extend']);
export const SEEDANCE_25_REFERENCE_LIMITS = Object.freeze({ first_frame: 1, last_frame: 1, reference_image: 30, reference_video: 10, reference_audio: 10 });
export const SEEDANCE_25_ROLES = Object.freeze(Object.keys(SEEDANCE_25_REFERENCE_LIMITS));
export const seedance25MediaType = role => role === 'reference_video' ? 'video' : role === 'reference_audio' ? 'audio' : 'image';
const fail = message => { throw Object.assign(new Error(message), { status: 400, code: 'seedance_25_invalid_input' }); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const only = (value, keys) => { if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) fail('Unsupported Seedance 2.5 field.'); };

export function seedance25References(value = []) {
    if (!Array.isArray(value) || value.length > 52) fail('Too many Seedance 2.5 references.');
    const counts = Object.fromEntries(SEEDANCE_25_ROLES.map(role => [role, 0]));
    return value.map(ref => {
        only(ref, ['role', 'source']);
        if (!SEEDANCE_25_ROLES.includes(ref.role) || ++counts[ref.role] > SEEDANCE_25_REFERENCE_LIMITS[ref.role]) fail('Too many or unsupported Seedance 2.5 reference roles.');
        only(ref.source, ['source_type', 'asset_id']);
        if (ref.source.source_type !== 'saved_asset' || typeof ref.source.asset_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(ref.source.asset_id)) fail('Select an owned saved asset.');
        return { role: ref.role, source: { source_type: 'saved_asset', asset_id: ref.source.asset_id } };
    });
}

export function seedance25Settings(input = {}, references = []) {
    for (const key of ['duration', 'resolution', 'aspect_ratio', 'output_format', 'workflow']) if (input[key] === null) fail('Null is not a Seedance 2.5 setting.');
    const duration = input.duration ?? 5;
    if (duration !== -1 && (!Number.isInteger(duration) || duration < 4 || duration > 30)) fail('Duration must be Auto or an integer from 4 to 30 seconds.');
    const resolution = input.resolution ?? '720p', ratio = input.aspect_ratio ?? 'adaptive';
    if (!SEEDANCE_25_RESOLUTIONS.includes(resolution) || !SEEDANCE_25_RATIOS.includes(ratio)) fail('Unsupported Seedance 2.5 resolution or ratio.');
    if (input.fps !== undefined && input.fps !== 24) fail('Seedance 2.5 uses 24 fps.');
    for (const key of ['camera_fixed', 'watermark', 'use_virtual_avatar', 'generate_audio']) if (input[key] !== undefined && typeof input[key] !== 'boolean') fail('Invalid Seedance 2.5 toggle.');
    if (input.seed !== undefined && !Number.isSafeInteger(input.seed)) fail('Seed must be a safe integer.');
    const output_format = input.output_format ?? 'mp4';
    if (!['mp4', 'mov'].includes(output_format)) fail('Choose MP4 or MOV.');
    return { duration, resolution, aspect_ratio: references.some(ref => ['first_frame', 'last_frame'].includes(ref.role)) ? 'adaptive' : ratio,
        fps: 24, camera_fixed: input.camera_fixed ?? false, watermark: input.watermark ?? false,
        output_format, use_virtual_avatar: input.use_virtual_avatar ?? false,
        ...(input.generate_audio === undefined ? {} : { generate_audio: input.generate_audio }),
        ...(input.seed === undefined ? {} : { seed: input.seed }) };
}

export function normalizeSeedance25Request(input = {}) {
    only(input, ['model', 'preset', 'prompt', 'references', 'workflow', 'duration', 'resolution', 'aspect_ratio', 'fps', 'camera_fixed', 'watermark', 'seed', 'output_format', 'use_virtual_avatar', 'generate_audio']);
    if (input.model !== undefined && input.model !== SEEDANCE_25_MODEL || input.preset !== undefined && input.preset !== SEEDANCE_25_PRESET) fail('Unsupported Seedance model or preset.');
    if (input.prompt !== undefined && typeof input.prompt !== 'string') fail('Prompt must be text.');
    const references = seedance25References(input.references), prompt = (input.prompt ?? '').trim();
    if ([...prompt].length > 2000 || (!prompt && !references.length)) fail('Enter up to 2000 characters or select reference media.');
    if (references.some(ref => ref.role === 'last_frame') && !references.some(ref => ref.role === 'first_frame')) fail('A last frame requires a first frame.');
    const workflow = input.workflow ?? 'generate', settings = seedance25Settings(input, references);
    if (!SEEDANCE_25_WORKFLOWS.includes(workflow)) fail('Unsupported Seedance 2.5 workflow.');
    if (workflow !== 'generate' && !references.some(ref => ref.role === 'reference_video')) fail('Editing or extending requires reference video.');
    if (workflow === 'edit' && settings.duration !== -1) fail('Editing a reference video requires Auto duration.');
    return { model: SEEDANCE_25_MODEL, preset: SEEDANCE_25_PRESET, prompt, workflow, references, ...settings };
}

// Input durations come from Auth's bounded byte inspector, never client metadata.
export function validateSeedance25ReferenceDurations(references, durations) {
    if (!Array.isArray(durations) || references.length !== durations.length) fail('Reference measurements are missing.');
    const totals = { video: 0, audio: 0 };
    references.forEach((ref, index) => {
        const type = seedance25MediaType(ref.role);
        if (type === 'image') return;
        const duration = durations[index];
        if (!Number.isFinite(duration) || duration <= 0) fail('Reference duration is unavailable.');
        totals[type] += duration;
        if (totals[type] > 30) fail('Video and audio references may total at most 30 seconds per media type.');
    });
    return totals;
}

export function buildSeedance25ProviderInput(input) {
    const { seedance25_sources, ...request } = input;
    const { model, preset, references, workflow, prompt, ...settings } = normalizeSeedance25Request(request);
    if (!Array.isArray(seedance25_sources) || seedance25_sources.length !== references.length) fail('Seedance references are unresolved.');
    const payload = { ...settings, ...(prompt ? { prompt } : {}) };
    references.forEach((ref, index) => {
        const source = seedance25_sources[index];
        let url;
        try { url = new URL(source?.url); } catch { fail('Invalid resolved reference.'); }
        if (source.role !== ref.role || url.origin !== 'https://bitbi.ai' || !url.pathname.startsWith('/api/internal/ai/media-source/') || url.search || url.hash) fail('Invalid resolved reference.');
        if (ref.role === 'first_frame') payload.image = url.href;
        else if (ref.role === 'last_frame') payload.last_frame_image = url.href;
        else (payload[`${ref.role}s`] ||= []).push(url.href);
    });
    // workflow is BITBI provenance/UI intent; Cloudflare has no mode field.
    return payload;
}

export function parseSeedance25Result(raw) {
    if (!object(raw) || raw.state !== undefined && raw.state !== 'Completed') throw Object.assign(new Error('Seedance output is unconfirmed.'), { code: 'seedance_25_outcome_unconfirmed', status: 502 });
    const result = raw.result ?? raw;
    let url;
    try { url = new URL(result?.video); if (url.protocol !== 'https:' || url.username || url.password) throw Error(); }
    catch { throw Object.assign(new Error('Seedance returned no valid video URL.'), { code: 'seedance_25_output_missing', status: 502 }); }
    // The published output schema establishes a video URI, not billable usage.
    return { video: url.href, usage: null, providerCostUsd: null };
}
