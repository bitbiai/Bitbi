import { apiAiGetAssetDetails } from './auth-api.js?v=__ASSET_VERSION__';
import { getAuthState } from './auth-state.js?v=__ASSET_VERSION__';
import { getCurrentLocale } from './locale.js?v=__ASSET_VERSION__';

let serial = 0;
const labels = {
    model: ['Model', 'Modell'], prompt: ['Original generation prompt', 'Ursprünglicher Generierungs-Prompt'],
    resolution: ['Original resolution', 'Originalauflösung'], mimeType: ['File format', 'Dateiformat'],
    durationSeconds: ['Original duration', 'Originaldauer'], recordedDurationSeconds: ['Recorded duration', 'Gespeicherte Dauer'],
    requestedDurationSeconds: ['Requested duration (not measured)', 'Angeforderte Dauer (nicht gemessen)'],
    bitrate: ['Recorded bitrate', 'Gespeicherte Bitrate'], sampleRate: ['Sample rate', 'Abtastrate'], channels: ['Channels', 'Kanäle'],
    seed: ['Seed', 'Seed'], steps: ['Steps', 'Schritte'], fps: ['Recorded FPS', 'Gespeicherte FPS'], bpm: ['BPM', 'BPM'], key: ['Musical key', 'Tonart'],
};
export function createAssetPreviewDetails(asset, { media = () => null } = {}) {
    const de = getCurrentLocale() === 'de', unavailable = de ? 'Nicht verfügbar' : 'Unavailable';
    const section = document.createElement('section'); section.className = 'asset-preview-details'; section.hidden = true;
    section.id = `asset-preview-details-${++serial}`;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'asset-preview-details__toggle';
    button.textContent = de ? 'Mehr Informationen' : 'More information';
    button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-controls', section.id);
    const controller = new AbortController(), owner = getAuthState().user?.id;
    let data = null, loading = false, disposed = false, observedMedia = null;
    const current = () => !disposed && owner === getAuthState().user?.id && !controller.signal.aborted;
    function render() {
        const values = { ...(data || {}) }, original = media();
        // The preview's video/audio source is the original private file. Images
        // may be derivatives: never use their naturalWidth here.
        if (original instanceof HTMLMediaElement) {
            if (Number.isFinite(original.duration) && original.duration > 0) values.durationSeconds = original.duration;
            if (original instanceof HTMLVideoElement && original.videoWidth > 0) {
                values.width = original.videoWidth; values.height = original.videoHeight;
            }
        }
        values.resolution = values.width > 0 && values.height > 0 ? `${values.width} × ${values.height}` : null;
        const kind = asset.asset_type;
        const required = new Set(['model', 'prompt', 'mimeType', ...(kind === 'image' ? ['resolution'] : kind === 'video'
            ? ['resolution', 'durationSeconds'] : ['durationSeconds', 'bitrate', 'sampleRate', 'channels'])]);
        const list = document.createElement('dl');
        for (const [key, names] of Object.entries(labels)) {
            let value = values[key];
            if ((value === null || value === undefined || value === '') && !required.has(key)) continue;
            if (key === 'recordedDurationSeconds' && values.durationSeconds) continue;
            if (typeof value === 'number') value = `${Number(value.toFixed(3))}${key.endsWith('Seconds') ? ' s' : key === 'bitrate' ? ' bit/s' : key === 'sampleRate' ? ' Hz' : ''}`;
            const term = document.createElement('dt'), description = document.createElement('dd');
            term.textContent = names[de ? 1 : 0]; description.textContent = value == null || value === '' ? unavailable : String(value);
            list.append(term, description);
        }
        section.replaceChildren(list);
    }
    async function expand() {
        if (!current()) return;
        const original = media();
        if (original instanceof HTMLMediaElement && original !== observedMedia) {
            observedMedia?.removeEventListener('loadedmetadata', metadataReady);
            observedMedia = original; observedMedia.addEventListener('loadedmetadata', metadataReady);
        }
        section.hidden = !section.hidden; button.setAttribute('aria-expanded', String(!section.hidden));
        if (section.hidden || loading) return;
        if (data) { render(); return; }
        loading = true; section.textContent = de ? 'Informationen werden geladen…' : 'Loading information…';
        const result = await apiAiGetAssetDetails(asset, { signal: controller.signal });
        loading = false;
        if (!current() || !section.isConnected) return;
        data = result.ok && result.data?.ok === true ? result.data.details : {};
        render();
    }
    button.addEventListener('click', expand);
    function metadataReady() { if (current() && data && !section.hidden) render(); }
    const changed = () => {
        if (owner === getAuthState().user?.id) return;
        controller.abort(); data = null; section.replaceChildren(); section.hidden = true;
        button.disabled = true; button.setAttribute('aria-expanded', 'false');
    };
    document.addEventListener('bitbi:auth-change', changed);
    return { section, button, cleanup() { disposed = true; controller.abort(); observedMedia?.removeEventListener('loadedmetadata', metadataReady); document.removeEventListener('bitbi:auth-change', changed); } };
}
