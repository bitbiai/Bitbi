import { exportMusicSettings } from './canvas-export.mjs';
import { transitionSettings, transitionTimeline } from './canvas-transitions.mjs';

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
    if (!Array.isArray(measuredDurations) || measuredDurations.length !== settings.clips.length) fail('canvas_assembly_sources_changed');
    if (!Number.isFinite(fps) || fps <= 0 || fps > 60) fail('canvas_media_timing_invalid');
    const fitted = [];
    const durations = settings.clips.map((clip, index) => {
        const source = measuredDurations[index], start = Math.round(clip.trim.start * fps) / fps;
        if (settings.target?.mode === 'creative') {
            if (!Number.isFinite(source) || source <= 0 || source > 600) fail('canvas_media_timing_invalid');
            const interval = resolveCanvasTrimFrames({ ...clip.trim, sourceFrames: Math.round(source * fps),
                frameRateNumerator: fps, frameRateDenominator: 1, creative: true });
            if (interval.fit) fitted.push(index);
            return interval.durationSeconds;
        }
        const duration = clip.trim.duration === undefined ? source - start : Math.round(clip.trim.duration * fps) / fps;
        if (!Number.isFinite(source) || source <= 0 || duration < 1 / fps || start + duration > source + 0.0001) fail('canvas_trim_outside_source');
        return duration;
    });
    const requested = settings.clips.slice(0, -1).map(clip => clip.transition);
    const transitions = fitted.length ? fitCanvasCreativeTransitions(durations, requested, fps, fitted).transitions : requested;
    return transitionTimeline(durations, transitions, fps);
}

// Intervals are end-exclusive picture frames, never container/audio seconds.
// Callers with decoded media supply its measured frame count and rational rate.
export function resolveCanvasTrimFrames({ start, duration, frameRateNumerator, frameRateDenominator, sourceFrames, creative = false }) {
    const trim = canvasTrim({ start, ...(duration === undefined ? {} : { duration }) });
    const fps = frameRateNumerator / frameRateDenominator;
    if (!Number.isFinite(frameRateNumerator) || !Number.isFinite(frameRateDenominator)
        || frameRateNumerator <= 0 || frameRateDenominator <= 0 || !Number.isFinite(fps) || fps <= 0 || fps > 60
        || !Number.isSafeInteger(sourceFrames) || sourceFrames < 1 || sourceFrames / fps > 600) fail('canvas_media_timing_invalid');
    const startFrame = Math.round(trim.start * fps);
    const requestedEndFrame = trim.duration === undefined ? sourceFrames : startFrame + Math.round(trim.duration * fps);
    const endFrame = creative === true ? Math.min(requestedEndFrame, sourceFrames) : requestedEndFrame;
    if (startFrame < 0 || endFrame > sourceFrames || endFrame <= startFrame) fail('canvas_trim_outside_source');
    return { startFrame, requestedEndFrame, endFrame, durationSeconds: (endFrame - startFrame) * frameRateDenominator / frameRateNumerator,
        fit: endFrame < requestedEndFrame ? { sourceFrames, startFrame, requestedEndFrame, endFrame, frameRateNumerator, frameRateDenominator } : null };
}

// Only joins touching a shortened clip may change. Retain the transition kind
// when its supported duration fits; otherwise use a hard cut. No footage is added.
export function fitCanvasCreativeTransitions(durations, transitions, fps, adjustedClipIndices) {
    if (!Array.isArray(durations) || !durations.length || !Array.isArray(transitions) || transitions.length !== durations.length - 1
        || !Number.isFinite(fps) || fps <= 0 || fps > 60 || !Array.isArray(adjustedClipIndices)
        || adjustedClipIndices.some(index => !Number.isInteger(index) || index < 0 || index >= durations.length)) fail('canvas_transition_invalid');
    const frames = durations.map(duration => {
        if (!Number.isFinite(duration) || duration <= 0) fail('canvas_media_timing_invalid');
        const count = Math.round(duration * fps);
        if (count < 1) fail('canvas_media_timing_invalid');
        return count;
    });
    const settings = transitions.map(transitionSettings);
    const requested = settings.map(t => t.preset === 'none' ? 0 : Math.max(1, Math.round(t.duration * fps)));
    const effective = [...requested], adjusted = new Set(adjustedClipIndices);
    const eligible = effective.map((_, i) => adjusted.has(i) || adjusted.has(i + 1));
    const minimum = Math.max(1, Math.round(.1 * fps));
    const reduce = (index, maximum) => {
        if (index < 0 || index >= effective.length || effective[index] <= maximum) return;
        if (!eligible[index]) fail('canvas_transition_too_long');
        effective[index] = maximum >= minimum ? maximum : 0;
    };
    effective.forEach((_, i) => reduce(i, Math.floor(Math.min(frames[i], frames[i + 1]) / 2)));
    for (let i = 0; i < frames.length; i++) {
        let excess = (effective[i - 1] || 0) + (effective[i] || 0) - (frames[i] - 1);
        for (const edge of [i, i - 1]) {
            if (excess <= 0) break;
            if (!eligible[edge]) continue;
            const before = effective[edge];
            reduce(edge, Math.max(0, before - excess));
            excess -= before - effective[edge];
        }
        if (excess > 0) fail('canvas_transition_too_long');
    }
    const fitted = settings.map((t, i) => effective[i] === requested[i] ? t : effective[i] === 0 ? { preset: 'none' }
        : { ...t, duration: Math.max(.1, Math.round(effective[i] / fps * 1000) / 1000) });
    transitionTimeline(durations, fitted, fps);
    const adjustments = fitted.flatMap((t, index) => effective[index] === requested[index] ? [] : [{
        index, requestedFrames: requested[index], effectiveFrames: effective[index],
        requestedPreset: settings[index].preset, effectivePreset: t.preset,
    }]);
    return { transitions: fitted, adjustments, frameRate: fps };
}

export function verifyCanvasDuration(measuredSeconds, target) {
    const expected = canvasDurationTarget(target);
    if (!Number.isFinite(measuredSeconds) || measuredSeconds <= 0 || measuredSeconds > 600) fail('canvas_duration_invalid');
    if (expected && expected.mode !== 'creative' && Math.abs(measuredSeconds - expected.seconds) > expected.toleranceSeconds + 0.000001) fail('canvas_duration_target_missed');
    return { measuredSeconds, targetSeconds: expected?.seconds ?? null, toleranceSeconds: expected?.toleranceSeconds ?? null,
        ...(expected?.mode === 'creative' ? {mode:'creative', deviationSeconds:measuredSeconds - expected.seconds} : {}) };
}
