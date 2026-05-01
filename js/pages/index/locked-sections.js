/* ============================================================
   BITBI — Locked sections: member-only Sound Lab placements
   ============================================================ */

import { getAuthState } from '../../shared/auth-state.js';
import { openAuthModal } from '../../shared/auth-modal.js';
import { formatTime } from '../../shared/format-time.js';
import { createStarButton } from '../../shared/favorites.js';
import { getSoundLabTracks, buildSoundLabTrack } from '../../shared/audio/audio-library.js?v=__ASSET_VERSION__';
import {
    initGlobalAudioManager,
    getGlobalAudioState,
    subscribeGlobalAudioState,
    playGlobalTrack,
    pauseGlobalAudio,
    resumeGlobalAudio,
    seekGlobalAudio,
} from '../../shared/audio/audio-manager.js?v=__ASSET_VERSION__';


const LOCK_ICON = `<svg width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>`;

const lockedAreas = [];

export function initLockedSections(revealObserver) {
    setupSoundLabCard(revealObserver);

    updateAll();
    document.addEventListener('bitbi:auth-change', updateAll);
}

function updateAll() {

    const { loggedIn } = getAuthState();
    lockedAreas.forEach(el => {
        el.setAttribute('data-locked', loggedIn ? 'false' : 'true');
    });
}

function makeOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'locked-area__overlay';
    overlay.innerHTML = `<div class="locked-area__badge">${LOCK_ICON}<span>Free registration required</span></div>`;
    overlay.addEventListener('click', () => openAuthModal('register'));
    return overlay;
}

/* ── Sound Lab — Exclusive Track cards ── */
function setupSoundLabCard(revealObserver) {
    const ctn = document.getElementById('soundLabTracks');
    if (!ctn) return;

    initGlobalAudioManager();

    const exclusiveTracks = getSoundLabTracks('member');

    const wrappers = [];
    let currentState = getGlobalAudioState();
    let activeExclIdx = null;

    exclusiveTracks.forEach((tr, idx) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'reveal snd-card locked-area locked-area--card';
        wrapper.setAttribute('data-locked', 'true');
        wrapper.style.cssText = 'background:rgba(13,27,42,0.45);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,0.06);border-radius:14px;overflow:hidden;transition:border-color 0.3s';
        wrapper.dataset.trackId = tr.id;

        const content = document.createElement('div');
        content.className = 'locked-area__content';
        content.innerHTML = `<div class="snd-hero"><img class="excl-thumb" src="" alt="${tr.title}" loading="lazy" decoding="async" width="600" height="180" style="width:100%;height:100%;object-fit:cover;display:none"><div class="excl-thumb-placeholder" style="position:absolute;inset:0;background:radial-gradient(ellipse at 30% 40%,rgba(255,179,0,0.08),transparent 60%),radial-gradient(ellipse at 70% 60%,rgba(0,240,255,0.06),transparent 60%),#060e18;display:flex;align-items:center;justify-content:center"><svg width="48" height="48" fill="rgba(255,179,0,0.2)" viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg></div><div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(13,27,42,0.7),transparent)"></div></div><div class="snd-player-row" style="display:flex;align-items:center;gap:14px;padding:16px 20px"><button class="excl-play" data-excl-idx="${idx}" aria-label="Play ${tr.title}" style="width:40px;height:40px;border-radius:50%;background:rgba(0,240,255,0.07);border:1px solid rgba(0,240,255,0.15);display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;transition:background 0.2s"><svg class="excl-pi" width="14" height="14" fill="#00F0FF" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg><svg class="excl-pa" width="14" height="14" fill="#00F0FF" viewBox="0 0 24 24" style="display:none"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg></button><div style="flex:1;min-width:0"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px"><h4 style="font-family:'Playfair Display',serif;font-weight:600;font-size:14px;color:rgba(255,255,255,0.85);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${tr.title}</h4><span class="excl-time" style="font-size:10px;font-family:'JetBrains Mono',monospace;color:rgba(255,255,255,0.2);flex-shrink:0;margin-left:8px">0:00</span></div><div class="excl-bar" style="position:relative;height:3px;background:rgba(255,255,255,0.05);border-radius:2px;overflow:hidden;cursor:pointer"><div class="excl-prog" style="position:absolute;left:0;top:0;height:100%;width:0%;background:linear-gradient(90deg,#FFB300,#00F0FF);border-radius:2px;transition:width 0.1s linear"></div></div></div><div class="excl-eq" style="display:flex;align-items:flex-end;gap:2px;height:32px;flex-shrink:0"><div class="eq-bar" style="animation:eqBar1 0.8s ease-in-out infinite paused;height:6px"></div><div class="eq-bar" style="animation:eqBar2 0.6s ease-in-out infinite paused;height:12px"></div><div class="eq-bar" style="animation:eqBar3 0.7s ease-in-out infinite paused;height:4px"></div><div class="eq-bar" style="animation:eqBar1 0.9s ease-in-out infinite paused;height:8px"></div><div class="eq-bar" style="animation:eqBar2 0.55s ease-in-out infinite paused;height:10px"></div></div></div>`;

        const exclStar = createStarButton('soundlab', tr.slug, { title: tr.title, thumb_url: tr.artwork });
        content.querySelector('.snd-player-row').appendChild(exclStar);

        wrapper.appendChild(content);
        wrapper.appendChild(makeOverlay());
        ctn.appendChild(wrapper);
        lockedAreas.push(wrapper);
        wrappers.push(wrapper);

        wrapper.onmouseenter = () => { if (activeExclIdx !== idx) wrapper.style.borderColor = 'rgba(0,240,255,0.15)'; };
        wrapper.onmouseleave = () => { if (activeExclIdx !== idx) wrapper.style.borderColor = 'rgba(255,255,255,0.06)'; };

        if (revealObserver) revealObserver.observe(wrapper);
    });

    function setCardPlaying(idx, isPlaying, progress = 0, timeText = '0:00') {
        const w = wrappers[idx];
        w.querySelector('.excl-pi').style.display = isPlaying ? 'none' : '';
        w.querySelector('.excl-pa').style.display = isPlaying ? '' : 'none';
        w.querySelector('.excl-prog').style.width = `${progress}%`;
        w.querySelector('.excl-time').textContent = timeText;
        w.querySelectorAll('.eq-bar').forEach(b => b.style.animationPlayState = isPlaying ? 'running' : 'paused');
        if (activeExclIdx === idx) {
            w.style.borderColor = 'rgba(0,240,255,0.2)';
            w.style.background = 'rgba(0,240,255,0.04)';
        } else {
            w.style.borderColor = 'rgba(255,255,255,0.06)';
            w.style.background = 'rgba(13,27,42,0.45)';
        }
    }

    function playExclTrack(idx) {
        const track = buildSoundLabTrack(exclusiveTracks[idx]?.slug, { originLabel: 'Sound Lab' });
        if (!track) return;
        playGlobalTrack(track);
    }

    /* Play/pause click for each exclusive card */
    wrappers.forEach((w, idx) => {
        const playBtn = w.querySelector('.excl-play');
        const heroEl = w.querySelector('.snd-hero');
        const barEl = w.querySelector('.excl-bar');

        playBtn.addEventListener('click', () => {
            const { loggedIn } = getAuthState();
            if (!loggedIn) { openAuthModal('register'); return; }

            if (currentState.trackId === exclusiveTracks[idx].id && currentState.status === 'playing') {
                pauseGlobalAudio();
                return;
            }
            if (currentState.trackId === exclusiveTracks[idx].id) {
                resumeGlobalAudio(true);
                return;
            }
            playExclTrack(idx);
        });

        heroEl.addEventListener('click', () => playBtn.click());

        barEl.addEventListener('click', (e) => {
            if (currentState.trackId !== exclusiveTracks[idx].id || !currentState.duration) return;
            const rect = barEl.getBoundingClientRect();
            seekGlobalAudio((e.clientX - rect.left) / rect.width * currentState.duration);
        });
    });

    /* Load thumbnails when logged in */
    let thumbsLoaded = false;

    function loadThumbs() {
        if (thumbsLoaded) return;
        if (!getAuthState().loggedIn) return;
        thumbsLoaded = true;
        exclusiveTracks.forEach((tr, idx) => {
            const img = new Image();
            img.crossOrigin = 'use-credentials';
            const thumbEl = wrappers[idx].querySelector('.excl-thumb');
            const placeholderEl = wrappers[idx].querySelector('.excl-thumb-placeholder');
            const thumbUrl = typeof tr.artwork === 'string' ? tr.artwork : '';
            img.onload = () => {
                thumbEl.src = img.src;
                thumbEl.style.display = 'block';
                placeholderEl.style.display = 'none';
            };
            if (thumbUrl) img.src = thumbUrl;
        });
    }

    loadThumbs();

    /* Reset audio and thumbnails when user logs out */
    document.addEventListener('bitbi:auth-change', () => {

        const { loggedIn } = getAuthState();
        if (loggedIn) {
            loadThumbs();
        } else {
            wrappers.forEach((wrapper, i) => {
                wrapper.querySelector('.excl-prog').style.width = '0%';
                wrapper.querySelector('.excl-time').textContent = '0:00';
                wrappers[i].querySelector('.excl-thumb').src = '';
                wrappers[i].querySelector('.excl-thumb').style.display = 'none';
                wrappers[i].querySelector('.excl-thumb-placeholder').style.display = 'flex';
            });
            thumbsLoaded = false;
        }
    });

    /* Respond to deck swipe/dot events from soundlab.js */
    ctn.addEventListener('snd:excl-swipe', (e) => {
        const { loggedIn } = getAuthState();
        if (!loggedIn) return;
        const newIdx = e.detail;
        const wasPlaying = currentState.trackId.startsWith('soundlab:') && currentState.status === 'playing' && exclusiveTracks.some(track => track.id === currentState.trackId);
        if (wasPlaying) playExclTrack(newIdx);
    });

    subscribeGlobalAudioState((nextState) => {
        currentState = nextState;
        activeExclIdx = exclusiveTracks.findIndex(track => track.id === nextState.trackId);
        wrappers.forEach((wrapper, idx) => {
            const isActive = activeExclIdx === idx;
            const isPlaying = isActive && nextState.status === 'playing';
            const progress = isActive && nextState.duration > 0 ? (nextState.currentTime / nextState.duration) * 100 : 0;
            const timeText = isActive && nextState.duration > 0
                ? `${formatTime(nextState.currentTime)} / ${formatTime(nextState.duration)}`
                : '0:00';
            setCardPlaying(idx, isPlaying, progress, timeText);
        });
    });

    document.addEventListener('bitbi:audio-ended', (event) => {
        const endedIdx = exclusiveTracks.findIndex(track => track.id === event.detail?.trackId);
        if (endedIdx === -1) return;
        if (endedIdx < exclusiveTracks.length - 1 && getAuthState().loggedIn) {
            playExclTrack(endedIdx + 1);
            ctn.dispatchEvent(new CustomEvent('snd:excl-deck-sync', { detail: endedIdx + 1 }));
        }
    });
}
