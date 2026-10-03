// Exact Cloudflare preview adapter. Native Gemini 1.1 controls/limits are not
// an authority for this route. BITBI-owned assets are resolved only by Auth.
export const OMNI_MODEL = 'google/gemini-omni-flash';
export const OMNI_PRESET = 'video_gemini_omni_flash';
export const OMNI_RESOLUTIONS = Object.freeze(['360p', '720p', '1080p', '4k']);
export const OMNI_RATIOS = Object.freeze(['16:9', '9:16']);
export const OMNI_OPERATIONS = Object.freeze(['text', 'image', 'frames', 'reference', 'edit']);
export const OMNI_ROLES = Object.freeze(['first_frame', 'last_frame', 'reference_image', 'reference_video', 'reference_audio']);
export const OMNI_FEATURES = Object.freeze(['generation', 'image', 'frames', 'reference_images', 'video_edit', 'audio_reference']);
const fail = (message, code = 'omni_invalid_input', status = 400) => { throw Object.assign(new Error(message), { code, status }); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
export const omniMediaType = role => role === 'reference_video' ? 'video' : role === 'reference_audio' ? 'audio' : 'image';

export function omniReferences(references = []) {
    if (!Array.isArray(references) || references.length > 14) fail('Omni accepts at most ten reference images, two frames, one video and one audio file.');
    const counts = Object.fromEntries(OMNI_ROLES.map(role => [role, 0]));
    return references.map(ref => {
        if (!object(ref) || !OMNI_ROLES.includes(ref.role) || Object.keys(ref).some(key => !['role', 'source'].includes(key))) fail('Unsupported Omni reference role.');
        const source = ref.source;
        if (!object(source) || source.source_type !== 'saved_asset' || typeof source.asset_id !== 'string'
            || !/^[a-zA-Z0-9_-]{1,128}$/.test(source.asset_id) || Object.keys(source).some(key => !['source_type', 'asset_id'].includes(key))) fail('Select an owned saved asset.');
        if (++counts[ref.role] > (ref.role === 'reference_image' ? 10 : 1)) fail('Too many files for this Omni reference role.');
        return { role: ref.role, source: { source_type: 'saved_asset', asset_id: source.asset_id } };
    });
}

export function omniOperation(references = []) {
    const roles = new Set(references.map(ref => ref.role));
    return roles.has('reference_video') ? 'edit' : roles.has('last_frame') ? 'frames'
        : roles.has('reference_image') ? 'reference' : roles.has('first_frame') ? 'image' : 'text';
}
export function omniFeatures(references = []) {
    const roles = new Set(references.map(ref => ref.role));
    return ['generation', ...(roles.has('first_frame') ? ['image'] : []), ...(roles.has('last_frame') ? ['frames'] : []),
        ...(roles.has('reference_image') ? ['reference_images'] : []), ...(roles.has('reference_video') ? ['video_edit'] : []),
        ...(roles.has('reference_audio') ? ['audio_reference'] : [])];
}
export function omniSettings(input = {}) {
    const resolution = input.resolution ?? '720p', aspect_ratio = input.aspect_ratio ?? '16:9';
    if (!OMNI_RESOLUTIONS.includes(resolution) || !OMNI_RATIOS.includes(aspect_ratio)) fail('Unsupported Omni resolution or aspect ratio.');
    return { resolution, aspect_ratio };
}
export function normalizeOmniRequest(input = {}) {
    if (!object(input)) fail('An Omni request object is required.');
    if (Object.keys(input).some(key => !['model', 'preset', 'prompt', 'resolution', 'aspect_ratio', 'references', 'operation'].includes(key))) fail('Unsupported Omni control. Duration, seed, audio toggles and conversation continuation are not available.');
    if ((input.model !== undefined && input.model !== OMNI_MODEL) || (input.preset !== undefined && input.preset !== OMNI_PRESET)) fail('Unsupported Omni model or preset.');
    const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
    if (!prompt || [...prompt].length > 7000) fail('Enter an instruction of at most 7000 characters.');
    const references = omniReferences(input.references), operation = omniOperation(references);
    if (input.operation !== undefined && input.operation !== operation) fail('The operation does not match the selected media.');
    return { model: OMNI_MODEL, preset: OMNI_PRESET, prompt, ...omniSettings(input), references, operation };
}

export function buildOmniProviderInput(input) {
    const { omni_sources, ...request } = input;
    const normalized = normalizeOmniRequest(request);
    if (!Array.isArray(omni_sources) || omni_sources.length !== normalized.references.length) fail('Omni references are not resolved.');
    const payload = { text: normalized.prompt, aspect_ratio: normalized.aspect_ratio, resolution: normalized.resolution };
    normalized.references.forEach((ref, index) => {
        const entry = omni_sources[index];
        let url;
        try { url = new URL(entry?.url); } catch { fail('Invalid resolved Omni media.'); }
        if (entry.role !== ref.role || url.origin !== 'https://bitbi.ai' || !url.pathname.startsWith('/api/internal/ai/media-source/') || url.search || url.hash) fail('Invalid resolved Omni media.');
        if (ref.role === 'reference_image') (payload.reference_images ||= []).push(url.href);
        else payload[({ first_frame: 'image', last_frame: 'last_frame', reference_video: 'video', reference_audio: 'audio' })[ref.role]] = url.href;
    });
    return payload;
}

// Only a completed output is an accepted result. Unknown envelopes require
// reconciliation, not another inference or a made-up provider polling route.
export function parseOmniResult(raw) {
    if (!object(raw) || (raw.state !== undefined && raw.state !== 'Completed')) fail('Omni returned no confirmed completed output.', 'omni_outcome_unconfirmed', 502);
    const result = raw.result ?? raw;
    if (!object(result) || typeof result.video !== 'string') fail('Omni returned no video output.', 'omni_output_missing', 502);
    const video = result.video;
    if (video.startsWith('data:')) {
        // Application transport bound, not a claimed provider output limit.
        const match = /^data:video\/(mp4|webm);base64,/.exec(video);
        const encoded = match ? video.slice(match[0].length) : '';
        if (video.length > 22_369_660 || !encoded || encoded.length % 4 || /[^A-Za-z0-9+/=]/.test(encoded)
            || !/^[^=]*={0,2}$/.test(encoded)) fail('Omni inline video is invalid or exceeds the 16 MiB transport limit.', 'omni_output_invalid', 502);
    } else {
        try { const url = new URL(video); if (url.protocol !== 'https:' || url.username || url.password) throw Error(); }
        catch { fail('Omni returned an invalid output URL.', 'omni_output_invalid', 502); }
    }
    const identity = result.interaction_id ?? raw.interaction_id;
    // Preserve only an explicit provider interaction field, never generic id,
    // requestId, taskId or Gateway metadata. This does not enable continuation.
    const interactionId = typeof identity === 'string' && /^[A-Za-z0-9._:-]{1,512}$/.test(identity) ? identity : null;
    return { video, interactionId, providerCostUsd: null, usage: null };
}
