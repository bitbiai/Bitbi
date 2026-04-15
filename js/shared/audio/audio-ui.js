/* ============================================================
   BITBI — Shared global audio shell UI
   Injects one compact player shell before <main> on all pages
   ============================================================ */

import {
    initGlobalAudioManager,
    subscribeGlobalAudioState,
    getGlobalAudioState,
    resumeGlobalAudio,
    pauseGlobalAudio,
    seekGlobalAudio,
    toggleGlobalAudioMute,
    clearGlobalAudio,
} from './audio-manager.js?v=__ASSET_VERSION__';

let initialized = false;
let unsubscribe = null;
let removeOutsidePointerListener = null;

function formatTime(value) {
    const totalSeconds = Math.max(0, Math.floor(Number(value) || 0));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function ensureAudioShell() {
    let shell = document.getElementById('globalAudioShell');
    if (shell) return shell;

    const main = document.querySelector('main');
    if (!main || !main.parentNode) return null;

    shell = document.createElement('section');
    shell.id = 'globalAudioShell';
    shell.className = 'site-audio';
    shell.hidden = true;
    shell.setAttribute('aria-label', 'Global audio player');
    shell.innerHTML = `
        <div class="site-audio__drawer">
            <div id="globalAudioPanel" class="site-audio__panel glass" aria-hidden="true">
                <button type="button" id="globalAudioToggle" class="site-audio__btn site-audio__btn--play" aria-label="Play audio">
                    <svg class="site-audio__icon site-audio__icon--play" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg>
                    <svg class="site-audio__icon site-audio__icon--pause" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"></path></svg>
                </button>
                <div class="site-audio__meta">
                    <div id="globalAudioTitle" class="site-audio__title">Audio player</div>
                    <div id="globalAudioStatus" class="site-audio__status" aria-live="polite"></div>
                </div>
                <button type="button" id="globalAudioMute" class="site-audio__btn site-audio__btn--mute" aria-label="Mute audio">
                    <svg class="site-audio__icon site-audio__icon--volume" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"></path></svg>
                    <svg class="site-audio__icon site-audio__icon--muted" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zM19 12c0 .94-.2 1.84-.56 2.66l1.51 1.51C20.62 14.91 21 13.49 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zm-14-3v6h4l5 5v-6.17l-9-9V9zm16.19 12.19L4.81 2.81 3.39 4.22 6.17 7H3v6h4l5 5v-8.17l7.78 7.78 1.41-1.42z"></path></svg>
                </button>
                <button type="button" id="globalAudioDismiss" class="site-audio__btn site-audio__btn--dismiss" aria-label="Dismiss player">
                    <svg class="site-audio__icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path></svg>
                </button>
                <button type="button" id="globalAudioProgress" class="site-audio__progress" aria-label="Seek within track">
                    <span id="globalAudioProgressFill" class="site-audio__progress-fill"></span>
                </button>
            </div>
            <button type="button" id="globalAudioHandle" class="site-audio__handle" aria-label="Show audio player" aria-expanded="false" aria-controls="globalAudioPanel">
                <span class="site-audio__handle-mark" aria-hidden="true"></span>
                <span class="site-audio__handle-text">Sound</span>
            </button>
        </div>
    `;

    main.parentNode.insertBefore(shell, main);
    return shell;
}

function renderAudioShell(nextState) {
    const shell = document.getElementById('globalAudioShell');
    if (!shell) return;

    const title = shell.querySelector('#globalAudioTitle');
    const status = shell.querySelector('#globalAudioStatus');
    const playBtn = shell.querySelector('#globalAudioToggle');
    const muteBtn = shell.querySelector('#globalAudioMute');
    const progress = shell.querySelector('#globalAudioProgress');
    const progressFill = shell.querySelector('#globalAudioProgressFill');
    const handle = shell.querySelector('#globalAudioHandle');
    const panel = shell.querySelector('#globalAudioPanel');

    const hasTrack = !!nextState.sourceUrl;
    shell.hidden = !hasTrack;
    shell.classList.toggle('site-audio--playing', nextState.status === 'playing');
    shell.classList.toggle('site-audio--blocked', nextState.status === 'blocked');
    shell.classList.toggle('site-audio--muted', !!nextState.muted);

    if (!hasTrack) {
        setDrawerExpanded(shell, false);
        return;
    }

    const isPlaying = nextState.status === 'playing';
    const isBlocked = nextState.status === 'blocked';
    const duration = Number(nextState.duration) || 0;
    const currentTime = Number(nextState.currentTime) || 0;
    const progressPercent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

    if (title) title.textContent = nextState.title || 'Untitled track';
    if (status) {
        const prefix = isPlaying
            ? 'Playing'
            : isBlocked
                ? 'Ready to resume'
                : nextState.status === 'loading'
                    ? 'Loading'
                    : 'Paused';
        const timeSummary = duration > 0
            ? `${formatTime(currentTime)} / ${formatTime(duration)}`
            : formatTime(currentTime);
        status.textContent = nextState.originLabel
            ? `${prefix} • ${nextState.originLabel} • ${timeSummary}`
            : `${prefix} • ${timeSummary}`;
    }

    if (playBtn) {
        playBtn.setAttribute('aria-label', isPlaying ? 'Pause audio' : 'Play audio');
        playBtn.classList.toggle('is-playing', isPlaying);
    }
    if (muteBtn) {
        muteBtn.setAttribute('aria-label', nextState.muted ? 'Unmute audio' : 'Mute audio');
        muteBtn.classList.toggle('is-muted', !!nextState.muted);
    }
    if (progressFill) {
        progressFill.style.width = `${progressPercent}%`;
    }
    if (progress) {
        progress.disabled = duration <= 0;
    }
    if (handle) {
        handle.setAttribute('aria-label', shell.classList.contains('is-open') ? 'Hide audio player' : 'Show audio player');
    }
    if (panel && !shell.classList.contains('is-open') && !shell.contains(document.activeElement)) {
        panel.setAttribute('aria-hidden', 'true');
    }
}

function bindAudioShellEvents() {
    const shell = document.getElementById('globalAudioShell');
    if (!shell || shell.dataset.bound === 'true') return;
    shell.dataset.bound = 'true';

    const drawer = shell.querySelector('.site-audio__drawer');
    const panel = shell.querySelector('#globalAudioPanel');
    const playBtn = shell.querySelector('#globalAudioToggle');
    const muteBtn = shell.querySelector('#globalAudioMute');
    const dismissBtn = shell.querySelector('#globalAudioDismiss');
    const progress = shell.querySelector('#globalAudioProgress');
    const handle = shell.querySelector('#globalAudioHandle');

    const canUseHoverDrawer = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    const closeDrawer = () => {
        if (shell.hidden) return;
        setDrawerExpanded(shell, false);
    };

    playBtn?.addEventListener('click', async () => {
        const nextState = getGlobalAudioState();
        if (nextState.status === 'playing') {
            pauseGlobalAudio();
            return;
        }
        await resumeGlobalAudio(true);
    });

    muteBtn?.addEventListener('click', () => {
        toggleGlobalAudioMute();
    });

    dismissBtn?.addEventListener('click', async () => {
        clearGlobalAudio({ preservePrefs: true });
        closeDrawer();
    });

    progress?.addEventListener('click', (event) => {
        const nextState = getGlobalAudioState();
        if (!nextState.duration) return;
        const rect = progress.getBoundingClientRect();
        const nextPercent = clamp((event.clientX - rect.left) / rect.width, 0, 1);
        seekGlobalAudio(nextState.duration * nextPercent);
    });

    drawer?.addEventListener('pointerenter', () => {
        if (!canUseHoverDrawer() || shell.hidden) return;
        setDrawerExpanded(shell, true);
    });

    drawer?.addEventListener('pointerleave', () => {
        if (!canUseHoverDrawer()) return;
        closeDrawer();
    });

    shell.addEventListener('focusin', () => {
        if (shell.hidden) return;
        setDrawerExpanded(shell, true);
    });

    shell.addEventListener('focusout', () => {
        window.requestAnimationFrame(() => {
            if (shell.contains(document.activeElement)) return;
            closeDrawer();
        });
    });

    handle?.addEventListener('click', (event) => {
        if (shell.hidden) return;
        if (canUseHoverDrawer()) {
            setDrawerExpanded(shell, true);
            return;
        }
        event.preventDefault();
        setDrawerExpanded(shell, !shell.classList.contains('is-open'));
    });

    panel?.setAttribute('aria-hidden', 'true');
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function bindOutsidePointerListener(shell) {
    if (removeOutsidePointerListener) return;
    const listener = (event) => {
        if (shell.hidden || shell.contains(event.target)) return;
        setDrawerExpanded(shell, false);
    };
    document.addEventListener('pointerdown', listener, true);
    removeOutsidePointerListener = () => {
        document.removeEventListener('pointerdown', listener, true);
        removeOutsidePointerListener = null;
    };
}

function setDrawerExpanded(shell, expanded) {
    if (!shell) return;
    const handle = shell.querySelector('#globalAudioHandle');
    const panel = shell.querySelector('#globalAudioPanel');
    const nextExpanded = !!expanded && !shell.hidden;

    shell.classList.toggle('is-open', nextExpanded);
    handle?.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
    handle?.setAttribute('aria-label', nextExpanded ? 'Hide audio player' : 'Show audio player');
    panel?.setAttribute('aria-hidden', nextExpanded ? 'false' : 'true');

    const canUseHoverDrawer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (nextExpanded && !canUseHoverDrawer) {
        bindOutsidePointerListener(shell);
    } else if (removeOutsidePointerListener) {
        removeOutsidePointerListener();
    }
}

export function initGlobalAudioUI() {
    if (initialized) return;
    initialized = true;

    initGlobalAudioManager();
    const shell = ensureAudioShell();
    if (!shell) return;

    bindAudioShellEvents();

    unsubscribe = subscribeGlobalAudioState(renderAudioShell);
}

export function destroyGlobalAudioUI() {
    if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
    }
    if (removeOutsidePointerListener) {
        removeOutsidePointerListener();
    }
    initialized = false;
}
