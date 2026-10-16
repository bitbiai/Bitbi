import { exportMusicSettings } from './canvas-export-contract.mjs';
import { transitionSettings, transitionTimeline } from './canvas-transition-contract.mjs';

export const CANVAS_ASSEMBLY_VERSION = 1;
export const CANVAS_DURATION_TOLERANCE_SECONDS = 0.5;
const fail = code => { throw Object.assign(new Error(code), { code, status: 400 }); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const keys = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
const id = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);

export function canvasTrim(value = { start: 0 }) {
    if (!keys(value, ['start', 'duration']) || !Number.isFinite(value.start) || value.start < 0 || value.start >= 600
        || value.duration !== undefined && (!Number.isFinite(value.duration) || value.duration < 0.1 || value.duration > 600 || value.start + value.duration > 600)) fail('canvas_trim_invalid');
    return { start: Math.round(value.start * 1000) / 1000, ...(value.duration === undefined ? {} : { duration: Math.round(value.duration * 1000) / 1000 }) };
}

export function canvasDurationTarget(value = null) {
    if (value === null) return null;
    if (!keys(value, ['seconds', 'toleranceSeconds', 'mode']) || !Number.isFinite(value.seconds) || value.seconds < 1 || value.seconds > 600
        || value.mode !== undefined && !['creative', 'exact'].includes(value.mode)
        || value.toleranceSeconds !== undefined && value.toleranceSeconds !== CANVAS_DURATION_TOLERANCE_SECONDS) fail('canvas_duration_target_invalid');
    const seconds = Math.round(value.seconds * 1000) / 1000;
    // Creative targets guide production; actual duration is always measured.
    // Older recipes retain their exact-duration contract and existing tolerance.
    return value.mode === 'creative' ? { seconds, mode: 'creative' }
        : { seconds, toleranceSeconds: CANVAS_DURATION_TOLERANCE_SECONDS };
}

// Playback order is node-based. Resolving a node's current selected output is an
// explicit export action; prompt/edge edits never generate or change old pixels.
export function canvasAssembly(value) {
    if (!keys(value, ['version', 'clips', 'target', 'anchorNodeId', 'backgroundMusic', 'smoothJoins', 'musicNodeId']) || value.version !== CANVAS_ASSEMBLY_VERSION
        || value.anchorNodeId !== undefined && !id(value.anchorNodeId)
        || value.musicNodeId !== undefined && value.musicNodeId !== null && !id(value.musicNodeId)
        || value.smoothJoins !== undefined && typeof value.smoothJoins !== 'boolean'
        || !Array.isArray(value.clips) || value.clips.length > 120) fail('canvas_assembly_invalid');
    const seen = new Set();
    const clips = value.clips.map(clip => {
        if (!keys(clip, ['nodeId', 'trim', 'transition']) || !id(clip.nodeId) || seen.has(clip.nodeId)) fail('canvas_assembly_invalid');
        seen.add(clip.nodeId);
        return { nodeId: clip.nodeId, trim: canvasTrim(clip.trim), transition: transitionSettings(clip.transition) };
    });
    return { version: CANVAS_ASSEMBLY_VERSION, ...(value.anchorNodeId ? {anchorNodeId:value.anchorNodeId} : {}), clips, target: canvasDurationTarget(value.target),
        ...(value.musicNodeId !== undefined ? {musicNodeId:value.musicNodeId} : {}),
        ...(value.backgroundMusic !== undefined ? {backgroundMusic:exportMusicSettings(value.backgroundMusic)} : {}),
        ...(value.smoothJoins !== undefined ? {smoothJoins:value.smoothJoins} : {}) };
}

export function canvasAssemblyTiming(assembly, measuredDurations, fps) {
    const settings = canvasAssembly(assembly);
    if (measuredDurations.length !== settings.clips.length) fail('canvas_assembly_sources_changed');
    const durations = settings.clips.map((clip, index) => {
        const source = measuredDurations[index], start = Math.round(clip.trim.start * fps) / fps;
        const duration = clip.trim.duration === undefined ? source - start : Math.round(clip.trim.duration * fps) / fps;
        if (!Number.isFinite(source) || source <= 0 || duration < 1 / fps || start + duration > source + 0.0001) fail('canvas_trim_outside_source');
        return duration;
    });
    return transitionTimeline(durations, settings.clips.slice(0, -1).map(clip => clip.transition), fps);
}

export function verifyCanvasDuration(measuredSeconds, target) {
    const expected = canvasDurationTarget(target);
    if (!Number.isFinite(measuredSeconds) || measuredSeconds <= 0 || measuredSeconds > 600) fail('canvas_duration_invalid');
    if (expected && expected.mode !== 'creative' && Math.abs(measuredSeconds - expected.seconds) > expected.toleranceSeconds + 0.000001) fail('canvas_duration_target_missed');
    return { measuredSeconds, targetSeconds: expected?.seconds ?? null, toleranceSeconds: expected?.toleranceSeconds ?? null,
        ...(expected?.mode === 'creative' ? {mode:'creative', deviationSeconds:measuredSeconds - expected.seconds} : {}) };
}
