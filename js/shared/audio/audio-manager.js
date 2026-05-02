/* ============================================================
   BITBI — Global audio manager with persisted hard-navigation restore
   Single source of truth for site-wide audio playback
   ============================================================ */

const STORAGE_KEY = 'bitbi_audio_state_v1';
const SCHEMA_VERSION = 1;
const TIME_UPDATE_PERSIST_MS = 1200;

const DEFAULT_VOLUME = 0.8;
const DEFAULT_RATE = 1;

const subscribers = new Set();

let initialized = false;
let audioEl = null;
let persistTimer = null;
let pendingSeekTime = null;
let lastTimePersistAt = 0;
let state = createDefaultState();

function createDefaultState() {
    return {
        schemaVersion: SCHEMA_VERSION,
        ready: false,
        trackId: '',
        trackSlug: '',
        sourceUrl: '',
        title: '',
        artworkUrl: '',
        access: 'public',
        collection: '',
        originPage: '',
        originLabel: '',
        crossOrigin: '',
        status: 'idle',
        playIntent: false,
        autoplayBlocked: false,
        currentTime: 0,
        duration: 0,
        volume: DEFAULT_VOLUME,
        muted: false,
        loop: false,
        playbackRate: DEFAULT_RATE,
        error: '',
        restoredFromStorage: false,
        lastPersistedAt: 0,
        endedAt: 0,
    };
}

function emitState() {
    const snapshot = getGlobalAudioState();
    subscribers.forEach(listener => {
        try {
            listener(snapshot);
        } catch (error) {
            console.warn('globalAudio subscriber:', error);
        }
    });
}

function patchState(patch = {}, options = {}) {
    state = { ...state, ...patch };
    if (!options.skipEmit) emitState();
}

function safeNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function normalizeAssetUrl(value) {
    if (!value || typeof value !== 'string') return '';
    try {
        const url = new URL(value, window.location.origin);
        if (!/^https?:$/.test(url.protocol)) return '';
        return url.toString();
    } catch {
        return '';
    }
}

function normalizeCrossOrigin(sourceUrl, crossOrigin = '') {
    const resolvedSourceUrl = normalizeAssetUrl(sourceUrl);
    if (!resolvedSourceUrl) return '';

    return crossOrigin === 'use-credentials' || crossOrigin === 'anonymous'
        ? crossOrigin
        : '';
}

function buildPersistedSnapshot() {
    if (!state.sourceUrl) return null;
    return {
        schemaVersion: SCHEMA_VERSION,
        trackId: state.trackId,
        trackSlug: state.trackSlug,
        sourceUrl: state.sourceUrl,
        title: state.title,
        artworkUrl: state.artworkUrl,
        access: state.access,
        collection: state.collection,
        originPage: state.originPage,
        originLabel: state.originLabel,
        crossOrigin: state.crossOrigin,
        playIntent: !!state.playIntent,
        currentTime: safeNumber(state.currentTime, 0),
        duration: safeNumber(state.duration, 0),
        volume: clamp(safeNumber(state.volume, DEFAULT_VOLUME), 0, 1),
        muted: !!state.muted,
        loop: !!state.loop,
        playbackRate: clamp(safeNumber(state.playbackRate, DEFAULT_RATE), 0.25, 4),
        lastPersistedAt: Date.now(),
    };
}

function schedulePersist(reason = '') {
    if (!initialized) return;
    if (reason === 'timeupdate') {
        const now = Date.now();
        if (now - lastTimePersistAt < TIME_UPDATE_PERSIST_MS) return;
        lastTimePersistAt = now;
    }

    if (persistTimer) window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => {
        persistTimer = null;
        persistNow();
    }, reason === 'timeupdate' ? 180 : 0);
}

function persistNow() {
    const snapshot = buildPersistedSnapshot();
    try {
        if (!snapshot) {
            localStorage.removeItem(STORAGE_KEY);
            patchState({ lastPersistedAt: 0 }, { skipEmit: true });
            return;
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
        patchState({ lastPersistedAt: snapshot.lastPersistedAt }, { skipEmit: true });
    } catch (error) {
        console.warn('globalAudio persist:', error);
    }
}

function clearPersistedState() {
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
        console.warn('globalAudio clearPersistedState:', error);
    }
}

function parsePersistedSnapshot() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION) {
            localStorage.removeItem(STORAGE_KEY);
            return null;
        }

        const sourceUrl = normalizeAssetUrl(parsed.sourceUrl);
        if (!sourceUrl) {
            localStorage.removeItem(STORAGE_KEY);
            return null;
        }

        const crossOrigin = normalizeCrossOrigin(sourceUrl, parsed.crossOrigin);

        return {
            schemaVersion: SCHEMA_VERSION,
            trackId: typeof parsed.trackId === 'string' ? parsed.trackId : '',
            trackSlug: typeof parsed.trackSlug === 'string' ? parsed.trackSlug : '',
            sourceUrl,
            title: typeof parsed.title === 'string' ? parsed.title : 'Untitled track',
            artworkUrl: normalizeAssetUrl(parsed.artworkUrl),
            access: parsed.access === 'member' ? 'member' : 'public',
            collection: typeof parsed.collection === 'string' ? parsed.collection : '',
            originPage: typeof parsed.originPage === 'string' ? parsed.originPage : '',
            originLabel: typeof parsed.originLabel === 'string' ? parsed.originLabel : '',
            crossOrigin,
            playIntent: !!parsed.playIntent,
            currentTime: Math.max(0, safeNumber(parsed.currentTime, 0)),
            duration: Math.max(0, safeNumber(parsed.duration, 0)),
            volume: clamp(safeNumber(parsed.volume, DEFAULT_VOLUME), 0, 1),
            muted: !!parsed.muted,
            loop: !!parsed.loop,
            playbackRate: clamp(safeNumber(parsed.playbackRate, DEFAULT_RATE), 0.25, 4),
            lastPersistedAt: safeNumber(parsed.lastPersistedAt, 0),
        };
    } catch (error) {
        console.warn('globalAudio parsePersistedSnapshot:', error);
        clearPersistedState();
        return null;
    }
}

function ensureAudioElement() {
    if (audioEl) return audioEl;

    audioEl = new Audio();
    audioEl.preload = 'auto';

    audioEl.addEventListener('loadedmetadata', () => {
        if (!audioEl) return;
        if (pendingSeekTime !== null) {
            const maxTime = Number.isFinite(audioEl.duration) ? audioEl.duration : pendingSeekTime;
            audioEl.currentTime = clamp(pendingSeekTime, 0, Math.max(maxTime, 0));
            pendingSeekTime = null;
        }
        patchState({
            duration: Number.isFinite(audioEl.duration) ? audioEl.duration : state.duration,
            currentTime: Number.isFinite(audioEl.currentTime) ? audioEl.currentTime : state.currentTime,
            status: audioEl.paused ? 'paused' : 'playing',
            error: '',
        });
        schedulePersist('metadata');
    });

    audioEl.addEventListener('durationchange', () => {
        if (!audioEl) return;
        patchState({
            duration: Number.isFinite(audioEl.duration) ? audioEl.duration : 0,
        });
        schedulePersist('duration');
    });

    audioEl.addEventListener('timeupdate', () => {
        if (!audioEl) return;
        patchState({
            currentTime: Number.isFinite(audioEl.currentTime) ? audioEl.currentTime : state.currentTime,
        });
        schedulePersist('timeupdate');
    });

    audioEl.addEventListener('play', () => {
        patchState({
            status: 'playing',
            autoplayBlocked: false,
            error: '',
        });
        schedulePersist('play');
    });

    audioEl.addEventListener('pause', () => {
        if (!audioEl) return;
        patchState({
            status: state.autoplayBlocked ? 'blocked' : 'paused',
            currentTime: Number.isFinite(audioEl.currentTime) ? audioEl.currentTime : state.currentTime,
        });
        schedulePersist('pause');
    });

    audioEl.addEventListener('volumechange', () => {
        if (!audioEl) return;
        patchState({
            volume: clamp(safeNumber(audioEl.volume, state.volume), 0, 1),
            muted: !!audioEl.muted,
        });
        schedulePersist('volume');
    });

    audioEl.addEventListener('ratechange', () => {
        if (!audioEl) return;
        patchState({
            playbackRate: clamp(safeNumber(audioEl.playbackRate, DEFAULT_RATE), 0.25, 4),
        });
        schedulePersist('rate');
    });

    audioEl.addEventListener('ended', () => {
        patchState({
            status: 'paused',
            playIntent: false,
            currentTime: Number.isFinite(audioEl.duration) ? audioEl.duration : state.currentTime,
            duration: Number.isFinite(audioEl.duration) ? audioEl.duration : state.duration,
            endedAt: Date.now(),
        });
        schedulePersist('ended');
        document.dispatchEvent(new CustomEvent('bitbi:audio-ended', {
            detail: {
                trackId: state.trackId,
                trackSlug: state.trackSlug,
                collection: state.collection,
            },
        }));
    });

    audioEl.addEventListener('error', () => {
        patchState({
            status: 'error',
            playIntent: false,
            autoplayBlocked: false,
            error: 'Audio unavailable.',
        });
        schedulePersist('error');
    });

    return audioEl;
}

async function attemptPlay(userInitiated = false) {
    const audio = ensureAudioElement();
    try {
        await audio.play();
        patchState({
            status: 'playing',
            playIntent: true,
            autoplayBlocked: false,
            error: '',
        });
        schedulePersist('play');
        return true;
    } catch (error) {
        const blocked = error?.name === 'NotAllowedError';
        patchState({
            status: blocked ? 'blocked' : 'paused',
            playIntent: !blocked,
            autoplayBlocked: blocked && !userInitiated,
            error: blocked ? '' : 'Playback failed.',
        });
        schedulePersist('playfail');
        return false;
    }
}

function configureAudioFromState() {
    const audio = ensureAudioElement();
    audio.volume = clamp(safeNumber(state.volume, DEFAULT_VOLUME), 0, 1);
    audio.muted = !!state.muted;
    audio.loop = !!state.loop;
    audio.playbackRate = clamp(safeNumber(state.playbackRate, DEFAULT_RATE), 0.25, 4);
}

function trackMatchesState(track = {}) {
    if (!track) return false;
    if (track.trackId && track.trackId === state.trackId) return true;
    if (track.id && track.id === state.trackId) return true;
    const sourceUrl = normalizeAssetUrl(track.sourceUrl || track.src);
    return !!sourceUrl && sourceUrl === state.sourceUrl;
}

function applyTrackToState(track = {}, status = 'paused') {
    const sourceUrl = normalizeAssetUrl(track.sourceUrl || track.src);
    const crossOrigin = normalizeCrossOrigin(sourceUrl, track.crossOrigin);
    patchState({
        trackId: typeof track.trackId === 'string' ? track.trackId : (typeof track.id === 'string' ? track.id : ''),
        trackSlug: typeof track.trackSlug === 'string' ? track.trackSlug : (typeof track.slug === 'string' ? track.slug : ''),
        sourceUrl,
        title: typeof track.title === 'string' && track.title.trim() ? track.title.trim() : 'Untitled track',
        artworkUrl: normalizeAssetUrl(track.artworkUrl || track.artwork),
        access: track.access === 'member' ? 'member' : 'public',
        collection: typeof track.collection === 'string' ? track.collection : '',
        originPage: typeof track.originPage === 'string' ? track.originPage : window.location.pathname,
        originLabel: typeof track.originLabel === 'string' ? track.originLabel : '',
        crossOrigin,
        status,
        error: '',
    });
}

function setAudioSource(sourceUrl, crossOrigin = '') {
    const audio = ensureAudioElement();
    const resolvedSourceUrl = normalizeAssetUrl(sourceUrl);
    if (!resolvedSourceUrl) return false;

    if (crossOrigin) {
        audio.crossOrigin = crossOrigin;
    } else {
        audio.removeAttribute('crossorigin');
    }

    if (audio.src !== resolvedSourceUrl) {
        audio.src = resolvedSourceUrl;
    }
    return true;
}

function hydratePersistedState() {
    const snapshot = parsePersistedSnapshot();
    if (!snapshot) {
        patchState({ ready: true });
        return;
    }

    state = {
        ...state,
        ...snapshot,
        status: snapshot.playIntent ? 'loading' : 'paused',
        ready: true,
        restoredFromStorage: true,
        autoplayBlocked: false,
        error: '',
    };
    configureAudioFromState();
    emitState();

    if (!setAudioSource(snapshot.sourceUrl, snapshot.crossOrigin)) {
        clearGlobalAudio({ preservePrefs: true });
        return;
    }

    pendingSeekTime = snapshot.currentTime;
    if (!snapshot.playIntent) {
        schedulePersist('restore');
        return;
    }

    window.setTimeout(() => {
        attemptPlay(false);
    }, 0);
}

function handleAuthChange(event) {
    const detail = event?.detail;
    if (detail?.loggedIn !== false) return;
    if (state.access !== 'member') return;
    clearGlobalAudio();
}

function handlePageHide() {
    persistNow();
}

export function initGlobalAudioManager() {
    if (initialized) return getGlobalAudioState();
    initialized = true;

    ensureAudioElement();
    configureAudioFromState();
    hydratePersistedState();

    document.addEventListener('bitbi:auth-change', handleAuthChange);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handlePageHide);

    return getGlobalAudioState();
}

export function getGlobalAudioState() {
    return {
        ...state,
    };
}

export function subscribeGlobalAudioState(listener) {
    if (typeof listener !== 'function') return () => {};
    subscribers.add(listener);
    listener(getGlobalAudioState());
    return () => {
        subscribers.delete(listener);
    };
}

export async function playGlobalTrack(track = {}, options = {}) {
    initGlobalAudioManager();

    const sameTrack = trackMatchesState(track);
    if (sameTrack) {
        return resumeGlobalAudio(true);
    }

    applyTrackToState(track, 'loading');
    const sourceUrl = state.sourceUrl;
    if (!sourceUrl) {
        patchState({ status: 'error', error: 'Missing audio source.' });
        return false;
    }

    const configured = setAudioSource(sourceUrl, state.crossOrigin);
    if (!configured) {
        patchState({ status: 'error', error: 'Invalid audio source.' });
        return false;
    }

    const audio = ensureAudioElement();
    configureAudioFromState();
    pendingSeekTime = options.currentTime != null ? Math.max(0, safeNumber(options.currentTime, 0)) : 0;
    audio.loop = !!state.loop;
    patchState({
        currentTime: pendingSeekTime,
        duration: 0,
        playIntent: true,
        autoplayBlocked: false,
        endedAt: 0,
    });
    if (pendingSeekTime === 0) {
        audio.currentTime = 0;
    }
    schedulePersist('load');
    return attemptPlay(true);
}

export async function resumeGlobalAudio(userInitiated = true) {
    initGlobalAudioManager();
    const audio = ensureAudioElement();
    if (!state.sourceUrl) return false;
    if (!audio.src) {
        if (!setAudioSource(state.sourceUrl, state.crossOrigin)) return false;
    }
    configureAudioFromState();
    if (state.duration > 0 && state.currentTime >= Math.max(state.duration - 0.25, 0)) {
        audio.currentTime = 0;
        patchState({ currentTime: 0 });
    }
    patchState({
        status: 'loading',
        playIntent: true,
        autoplayBlocked: false,
        error: '',
    });
    return attemptPlay(userInitiated);
}

export function pauseGlobalAudio() {
    initGlobalAudioManager();
    const audio = ensureAudioElement();
    patchState({
        playIntent: false,
        autoplayBlocked: false,
    });
    audio.pause();
    schedulePersist('pause');
}

export function seekGlobalAudio(nextTime) {
    initGlobalAudioManager();
    const audio = ensureAudioElement();
    if (!state.sourceUrl) return;
    const numericTime = Math.max(0, safeNumber(nextTime, 0));
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
        audio.currentTime = clamp(numericTime, 0, audio.duration);
    } else {
        pendingSeekTime = numericTime;
    }
    patchState({
        currentTime: Number.isFinite(audio.currentTime) ? audio.currentTime : numericTime,
    });
    schedulePersist('seek');
}

export function setGlobalAudioVolume(nextVolume) {
    initGlobalAudioManager();
    const audio = ensureAudioElement();
    audio.volume = clamp(safeNumber(nextVolume, DEFAULT_VOLUME), 0, 1);
    audio.muted = audio.volume === 0 ? true : false;
}

export function toggleGlobalAudioMute() {
    initGlobalAudioManager();
    const audio = ensureAudioElement();
    audio.muted = !audio.muted;
}

export function toggleGlobalAudioLoop() {
    initGlobalAudioManager();
    const audio = ensureAudioElement();
    audio.loop = !audio.loop;
}

export function setGlobalAudioPlaybackRate(nextRate) {
    initGlobalAudioManager();
    const audio = ensureAudioElement();
    audio.playbackRate = clamp(safeNumber(nextRate, DEFAULT_RATE), 0.25, 4);
}

export function clearGlobalAudio(options = {}) {
    initGlobalAudioManager();
    const audio = ensureAudioElement();
    const preservedPrefs = {
        volume: state.volume,
        muted: state.muted,
        loop: state.loop,
        playbackRate: state.playbackRate,
    };

    audio.pause();
    audio.removeAttribute('src');
    try { audio.load(); } catch (_) { /* noop */ }
    pendingSeekTime = null;

    state = {
        ...createDefaultState(),
        ready: true,
        volume: options.preservePrefs ? preservedPrefs.volume : DEFAULT_VOLUME,
        muted: options.preservePrefs ? preservedPrefs.muted : false,
        loop: options.preservePrefs ? preservedPrefs.loop : false,
        playbackRate: options.preservePrefs ? preservedPrefs.playbackRate : DEFAULT_RATE,
    };

    clearPersistedState();
    emitState();
}
