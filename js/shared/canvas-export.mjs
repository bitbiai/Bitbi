// This purpose is intentionally outside the inference graph.
export const EXPORT_MUSIC_PURPOSE = 'export_background_music';
export const isExportMusic = config => config?.purpose === EXPORT_MUSIC_PURPOSE;
export function exportMusicSettings(value = { enabled: false, gain: 1 }) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).some(key => !['enabled', 'gain', 'musicAssetId'].includes(key))
        || (value.musicAssetId!==undefined && (typeof value.musicAssetId!=='string' || !/^[a-f0-9]{32}$/.test(value.musicAssetId)))
        || typeof value.enabled !== 'boolean' || typeof value.gain !== 'number'
        || !Number.isFinite(value.gain) || value.gain < 0 || value.gain > 1) {
        throw Object.assign(new Error('Invalid background music settings.'), { code: 'canvas_music_settings', status: 400 });
    }
    return { enabled: value.enabled, gain: value.gain, ...(value.musicAssetId?{musicAssetId:value.musicAssetId}:{}) };
}
