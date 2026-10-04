// One bounded, linear envelope for node playback, audition and rendered files.
// Settings are per node; media bytes and other nodes using the asset are untouched.
export const DEFAULT_ORIGINAL_AUDIO = Object.freeze({ enabled: true, gain: 1, fadeIn: 0, fadeOut: 0 });
export function originalAudioSettings(value = DEFAULT_ORIGINAL_AUDIO) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).some(key => !['enabled', 'gain', 'fadeIn', 'fadeOut'].includes(key))
        || typeof value.enabled !== 'boolean' || !Number.isFinite(value.gain) || value.gain < 0 || value.gain > 1
        || ['fadeIn', 'fadeOut'].some(key => value[key] !== undefined && (!Number.isFinite(value[key]) || value[key] < 0 || value[key] > 600))) {
        throw Object.assign(new Error('Invalid Canvas audio settings.'), { code: 'canvas_audio_settings', status: 400 });
    }
    return { enabled: value.enabled, gain: value.gain, fadeIn: value.fadeIn ?? 0, fadeOut: value.fadeOut ?? 0 };
}
export function effectiveAudio(value, duration) {
    const settings = originalAudioSettings(value);
    if (!(Number.isFinite(duration) && duration > 0)) return settings;
    let fadeIn = Math.min(settings.fadeIn, duration), fadeOut = Math.min(settings.fadeOut, duration);
    const scale = Math.min(1, duration / (fadeIn + fadeOut || 1));
    fadeIn *= scale; fadeOut *= scale;
    return { ...settings, fadeIn, fadeOut };
}
export function audioGainAt(value, time, duration) {
    const { enabled, gain, fadeIn, fadeOut } = effectiveAudio(value, duration);
    if (!enabled || time < 0 || time >= duration) return 0;
    return gain * Math.min(1, fadeIn ? time / fadeIn : 1, fadeOut ? (duration - time) / fadeOut : 1);
}
export const hasAudioEffects = value => {
    const s = originalAudioSettings(value);
    return !s.enabled || s.gain !== 1 || s.fadeIn !== 0 || s.fadeOut !== 0;
};
