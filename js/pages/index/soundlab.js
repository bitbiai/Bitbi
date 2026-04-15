/* ============================================================
   BITBI — Sound Lab: shared audio manager integration
   ============================================================ */

import { formatTime } from '../../shared/format-time.js';
import { getAuthState, getAuthState as readAuthState } from '../../shared/auth-state.js';
import { openAuthModal } from '../../shared/auth-modal.js';
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
    setGlobalAudioVolume,
} from '../../shared/audio/audio-manager.js?v=__ASSET_VERSION__';

const tracks = getSoundLabTracks('public');

export function initSoundLab(revealObserver) {
    const ctn = document.getElementById('soundLabTracks');
    const plEl = document.getElementById('playlistPlayer');
    if (!ctn || !plEl || ctn.dataset.soundlabReady === 'true') return;
    ctn.dataset.soundlabReady = 'true';

    initGlobalAudioManager();

    let activeIdx = null;
    let currentState = getGlobalAudioState();
    let syncDeck = null;

    tracks.forEach((tr, idx) => {
        const card = document.createElement('div');
        card.className = 'reveal snd-card';
        card.style.cssText = 'background:rgba(13,27,42,0.45);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,0.06);border-radius:14px;overflow:hidden;transition:border-color 0.3s,background-color 0.3s';
        card.dataset.trackId = tr.id;
        card.dataset.trackIdx = String(idx);
        card.onmouseenter = () => {
            if (currentState.trackId !== tr.id) card.style.borderColor = 'rgba(0,240,255,0.15)';
        };
        card.onmouseleave = () => {
            if (currentState.trackId !== tr.id) card.style.borderColor = 'rgba(255,255,255,0.06)';
        };
        card.innerHTML = `<div class="snd-hero"><img src="${tr.artwork}" alt="${tr.title}" loading="lazy" decoding="async" width="600" height="180" style="width:100%;height:100%;object-fit:cover;display:block"><div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(13,27,42,0.7),transparent)"></div></div><div class="snd-player-row" style="display:flex;align-items:center;gap:14px;padding:16px 20px"><button class="snd-play" data-idx="${idx}" aria-label="Play ${tr.title}" style="width:40px;height:40px;border-radius:50%;background:rgba(0,240,255,0.07);border:1px solid rgba(0,240,255,0.15);display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;transition:background 0.2s"><svg class="pi" width="14" height="14" fill="#00F0FF" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg><svg class="pa" width="14" height="14" fill="#00F0FF" viewBox="0 0 24 24" style="display:none"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg></button><div style="flex:1;min-width:0"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px"><h4 style="font-family:'Playfair Display',serif;font-weight:600;font-size:14px;color:rgba(255,255,255,0.85);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${tr.title}</h4><span class="snd-time" style="font-size:10px;font-family:'JetBrains Mono',monospace;color:rgba(255,255,255,0.2);flex-shrink:0;margin-left:8px">0:00</span></div><div class="snd-bar" style="position:relative;height:3px;background:rgba(255,255,255,0.05);border-radius:2px;overflow:hidden;cursor:pointer"><div class="snd-prog" style="position:absolute;left:0;top:0;height:100%;width:0%;background:linear-gradient(90deg,#00F0FF,#FFB300);border-radius:2px;transition:width 0.1s linear"></div></div></div><div class="eq-wrap" style="display:flex;align-items:flex-end;gap:2px;height:32px;flex-shrink:0"><div class="eq-bar" style="animation:eqBar1 0.8s ease-in-out infinite paused;height:6px"></div><div class="eq-bar" style="animation:eqBar2 0.6s ease-in-out infinite paused;height:12px"></div><div class="eq-bar" style="animation:eqBar3 0.7s ease-in-out infinite paused;height:4px"></div><div class="eq-bar" style="animation:eqBar1 0.9s ease-in-out infinite paused;height:8px"></div><div class="eq-bar" style="animation:eqBar2 0.55s ease-in-out infinite paused;height:10px"></div></div></div>`;
        const star = createStarButton('soundlab', tr.slug, { title: tr.title, thumb_url: tr.artwork });
        card.querySelector('.snd-player-row').appendChild(star);
        ctn.appendChild(card);
    });

    function getCurrentPublicIndex(state = currentState) {
        return tracks.findIndex(track => track.id === state.trackId);
    }

    function isPublicPlaying(state = currentState) {
        return getCurrentPublicIndex(state) !== -1 && state.status === 'playing';
    }

    function playTrack(idx) {
        if (idx < 0 || idx >= tracks.length) return;
        const track = buildSoundLabTrack(tracks[idx].slug, { originLabel: 'Sound Lab' });
        if (!track) return;
        playGlobalTrack(track);
    }

    function renderRow(row, idx, state = currentState) {
        const isActive = state.trackId === tracks[idx].id;
        const isPlaying = isActive && state.status === 'playing';
        const progress = isActive && state.duration > 0 ? (state.currentTime / state.duration) * 100 : 0;
        const timeText = isActive && state.duration > 0
            ? `${formatTime(state.currentTime)} / ${formatTime(state.duration)}`
            : '0:00';

        row.style.borderColor = isActive ? 'rgba(0,240,255,0.2)' : 'rgba(255,255,255,0.06)';
        row.style.background = isActive ? 'rgba(0,240,255,0.04)' : 'rgba(13,27,42,0.45)';
        row.querySelector('.snd-prog').style.width = `${progress}%`;
        row.querySelector('.snd-time').textContent = timeText;
        row.querySelector('.pi').style.display = isPlaying ? 'none' : '';
        row.querySelector('.pa').style.display = isPlaying ? '' : 'none';
        row.querySelectorAll('.eq-bar').forEach(bar => {
            bar.style.animationPlayState = isPlaying ? 'running' : 'paused';
        });
    }

    plEl.style.cssText = 'background:rgba(13,27,42,0.55);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(0,240,255,0.1);border-radius:14px;padding:16px 20px;transition:border-color 0.3s';
    plEl.innerHTML = `
    <div style="display:flex;align-items:center;gap:14px">
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
            <button id="plPrev" aria-label="Previous track" style="width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all 0.2s">
                <svg width="12" height="12" fill="rgba(255,255,255,0.5)" viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
            </button>
            <button id="plPlay" aria-label="Play all tracks" style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,rgba(0,240,255,0.12),rgba(255,179,0,0.08));border:1px solid rgba(0,240,255,0.2);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all 0.2s;box-shadow:0 0 20px rgba(0,240,255,0.08)">
                <svg id="plPlayIcon" width="16" height="16" fill="#00F0FF" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                <svg id="plPauseIcon" width="16" height="16" fill="#00F0FF" viewBox="0 0 24 24" style="display:none"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
            </button>
            <button id="plNext" aria-label="Next track" style="width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all 0.2s">
                <svg width="12" height="12" fill="rgba(255,255,255,0.5)" viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
            </button>
        </div>
        <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
                <span id="plTitle" style="font-family:'Playfair Display',serif;font-weight:600;font-size:13px;color:rgba(255,255,255,0.65);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Play All — ${tracks.length} Tracks</span>
                <span id="plTime" style="font-size:10px;font-family:'JetBrains Mono',monospace;color:rgba(255,255,255,0.2);flex-shrink:0;margin-left:8px"></span>
            </div>
            <div id="plBar" style="position:relative;height:4px;background:rgba(255,255,255,0.05);border-radius:2px;overflow:hidden;cursor:pointer">
                <div id="plProg" style="position:absolute;left:0;top:0;height:100%;width:0%;background:linear-gradient(90deg,#00F0FF,#FFB300);border-radius:2px;transition:width 0.1s linear"></div>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px">
                <span id="plTrackNum" aria-live="polite" style="font-size:9px;font-family:'JetBrains Mono',monospace;color:rgba(255,255,255,0.15);letter-spacing:1px"></span>
                <div style="display:flex;align-items:center;gap:6px">
                    <svg width="10" height="10" fill="rgba(255,255,255,0.2)" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
                    <input id="plVol" type="range" min="0" max="100" value="80" aria-label="Volume" style="width:60px;height:3px;accent-color:#00F0FF;cursor:pointer;opacity:0.5">
                </div>
            </div>
        </div>
    </div>`;

    function plUpdate(state = currentState) {
        const playIcon = document.getElementById('plPlayIcon');
        const pauseIcon = document.getElementById('plPauseIcon');
        const titleEl = document.getElementById('plTitle');
        const numEl = document.getElementById('plTrackNum');
        const progEl = document.getElementById('plProg');
        const timeEl = document.getElementById('plTime');
        const volumeEl = document.getElementById('plVol');
        if (!playIcon || !pauseIcon || !titleEl || !numEl || !progEl || !timeEl || !volumeEl) return;

        const currentPublicIdx = getCurrentPublicIndex(state);
        const isPlaying = currentPublicIdx !== -1 && state.status === 'playing';
        playIcon.style.display = isPlaying ? 'none' : '';
        pauseIcon.style.display = isPlaying ? '' : 'none';

        if (currentPublicIdx !== -1) {
            titleEl.textContent = tracks[currentPublicIdx].title;
            numEl.textContent = `Track ${currentPublicIdx + 1} / ${tracks.length}`;
            if (state.duration > 0) {
                progEl.style.width = `${(state.currentTime / state.duration) * 100}%`;
                timeEl.textContent = `${formatTime(state.currentTime)} / ${formatTime(state.duration)}`;
            } else {
                progEl.style.width = '0%';
                timeEl.textContent = formatTime(state.currentTime);
            }
        } else {
            titleEl.textContent = `Play All — ${tracks.length} Tracks`;
            numEl.textContent = '';
            progEl.style.width = '0%';
            timeEl.textContent = '';
        }

        volumeEl.value = String(Math.round((state.muted ? 0 : state.volume) * 100));
    }

    function renderFromState(nextState) {
        currentState = nextState;
        const previousIdx = activeIdx;
        activeIdx = getCurrentPublicIndex(nextState);
        Array.from(ctn.children)
            .filter(child => !child.classList.contains('locked-area'))
            .forEach((row, idx) => renderRow(row, idx, nextState));
        plUpdate(nextState);
        if (syncDeck && activeIdx !== -1 && activeIdx !== previousIdx) {
            syncDeck(activeIdx);
        }
    }

    ctn.querySelectorAll('.snd-play').forEach(btn => {
        btn.addEventListener('click', async () => {
            const idx = parseInt(btn.dataset.idx, 10);
            const isCurrent = currentState.trackId === tracks[idx].id;
            if (isCurrent && currentState.status === 'playing') {
                pauseGlobalAudio();
                return;
            }
            if (isCurrent) {
                await resumeGlobalAudio(true);
                return;
            }
            playTrack(idx);
        });
    });

    ctn.querySelectorAll('.snd-hero').forEach(hero => {
        hero.addEventListener('click', () => {
            const trackBtn = hero.closest('.snd-card')?.querySelector('.snd-play');
            if (trackBtn) trackBtn.click();
        });
    });

    ctn.querySelectorAll('.snd-bar').forEach((bar, idx) => {
        bar.addEventListener('click', (event) => {
            if (currentState.trackId !== tracks[idx].id || !currentState.duration) return;
            const rect = bar.getBoundingClientRect();
            seekGlobalAudio(((event.clientX - rect.left) / rect.width) * currentState.duration);
        });
    });

    document.getElementById('plPlay')?.addEventListener('click', async () => {
        if (activeIdx === null || activeIdx === -1) {
            playTrack(0);
            return;
        }
        if (currentState.status === 'playing') {
            pauseGlobalAudio();
            return;
        }
        await resumeGlobalAudio(true);
    });

    document.getElementById('plNext')?.addEventListener('click', () => {
        const currentPublicIdx = getCurrentPublicIndex();
        const next = currentPublicIdx === -1 ? 0 : (currentPublicIdx + 1) % tracks.length;
        playTrack(next);
    });

    document.getElementById('plPrev')?.addEventListener('click', () => {
        const currentPublicIdx = getCurrentPublicIndex();
        if (currentPublicIdx !== -1 && currentState.currentTime > 3) {
            seekGlobalAudio(0);
            return;
        }
        const prev = currentPublicIdx === -1 ? tracks.length - 1 : (currentPublicIdx - 1 + tracks.length) % tracks.length;
        playTrack(prev);
    });

    document.getElementById('plBar')?.addEventListener('click', (event) => {
        if (!currentState.duration || activeIdx === null || activeIdx === -1) return;
        const rect = event.currentTarget.getBoundingClientRect();
        seekGlobalAudio(((event.clientX - rect.left) / rect.width) * currentState.duration);
    });

    document.getElementById('plVol')?.addEventListener('input', (event) => {
        setGlobalAudioVolume(Number(event.target.value) / 100);
    });

    plEl.onmouseenter = () => { plEl.style.borderColor = 'rgba(0,240,255,0.2)'; };
    plEl.onmouseleave = () => { plEl.style.borderColor = 'rgba(0,240,255,0.1)'; };

    if (revealObserver) {
        ctn.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));
        revealObserver.observe(plEl);
    }

    /* ── Mobile Deck ── */
    function initSndDeck() {
        const mql = window.matchMedia('(max-width: 639px)');
        let deckActive = 0;
        let isDeck = false;
        let dotsEl = null;
        let swipeLock = false;
        let wasPlayingOnSwipeStart = false;
        let category = 'free';
        let lastExclDeckIdx = 0;

        function getCards() {
            return Array.from(ctn.children).filter(c => c.style.display !== 'none');
        }

        function sndLayout(skipAnim) {
            const cards = getCards();
            const n = cards.length;
            cards.forEach((card, i) => {
                const d = i - deckActive;
                card.style.transition = skipAnim ? 'none' : '';
                if (d === 0) {
                    card.style.transform = 'scale(0.90)';
                    card.style.opacity = '1';
                    card.style.zIndex = String(n);
                    card.style.pointerEvents = '';
                } else if (d === 1) {
                    card.style.transform = 'translateX(24px) scale(0.86)';
                    card.style.opacity = '0.55';
                    card.style.zIndex = String(n - 1);
                    card.style.pointerEvents = 'none';
                } else if (d === 2) {
                    card.style.transform = 'translateX(42px) scale(0.82)';
                    card.style.opacity = '0.3';
                    card.style.zIndex = String(n - 2);
                    card.style.pointerEvents = 'none';
                } else {
                    card.style.transform = d < 0 ? 'translateX(-30px) scale(0.82)' : 'translateX(50px) scale(0.80)';
                    card.style.opacity = '0';
                    card.style.zIndex = '0';
                    card.style.pointerEvents = 'none';
                }
            });
        }

        function sndBuildDots() {
            if (dotsEl) dotsEl.remove();
            const cards = getCards();
            if (cards.length <= 1) { dotsEl = null; return; }
            dotsEl = document.createElement('div');
            dotsEl.className = 'snd-deck-dots';
            dotsEl.setAttribute('role', 'tablist');
            dotsEl.setAttribute('aria-label', 'Sound Lab tracks');
            cards.forEach((_, i) => {
                const dot = document.createElement('button');
                dot.type = 'button';
                dot.className = `snd-deck-dot${i === deckActive ? ' active' : ''}`;
                dot.setAttribute('role', 'tab');
                dot.setAttribute('aria-selected', i === deckActive ? 'true' : 'false');
                dot.setAttribute('aria-label', `Show track ${i + 1}`);
                dot.addEventListener('click', () => {
                    const wasPlaying = isPublicPlaying();
                    deckActive = i;
                    if (category === 'exclusive') lastExclDeckIdx = i;
                    sndLayout();
                    sndSyncDots();
                    if (category === 'free' && wasPlaying) playTrack(deckActive);
                    if (category === 'exclusive') {
                        ctn.dispatchEvent(new CustomEvent('snd:excl-swipe', { detail: i }));
                    }
                });
                dotsEl.appendChild(dot);
            });
            ctn.after(dotsEl);
        }

        function sndSyncDots() {
            if (!dotsEl) return;
            const dots = dotsEl.querySelectorAll('.snd-deck-dot');
            const cards = getCards();
            if (dots.length !== cards.length) {
                sndBuildDots();
                return;
            }
            dots.forEach((dot, i) => {
                dot.classList.toggle('active', i === deckActive);
                dot.setAttribute('aria-selected', i === deckActive ? 'true' : 'false');
            });
        }

        function applyCategory() {
            Array.from(ctn.children).forEach(card => {
                const isExcl = card.classList.contains('locked-area');
                card.style.display = (category === 'free') === isExcl ? 'none' : '';
            });
        }

        function switchCategory(nextCategory) {
            if (category === 'exclusive') lastExclDeckIdx = deckActive;
            category = nextCategory;
            applyCategory();
            if (!isDeck) return;

            const cards = getCards();
            if (nextCategory === 'free' && activeIdx !== null && activeIdx !== -1 && activeIdx < cards.length) {
                deckActive = activeIdx;
            } else if (nextCategory === 'exclusive' && lastExclDeckIdx >= 0 && lastExclDeckIdx < cards.length) {
                deckActive = lastExclDeckIdx;
            } else {
                deckActive = 0;
            }

            sndLayout(true);
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    getCards().forEach(card => { card.style.transition = ''; });
                });
            });
            sndBuildDots();
        }

        function createFilterBar() {
            const bar = document.createElement('div');
            bar.className = 'snd-filter-bar';
            bar.setAttribute('role', 'tablist');
            bar.setAttribute('aria-label', 'Sound Lab categories');

            const freeBtn = document.createElement('button');
            freeBtn.type = 'button';
            freeBtn.className = 'snd-filter-btn active';
            freeBtn.textContent = 'Free';
            freeBtn.setAttribute('role', 'tab');
            freeBtn.setAttribute('aria-selected', 'true');

            const exclBtn = document.createElement('button');
            exclBtn.type = 'button';
            exclBtn.className = 'snd-filter-btn snd-filter-btn--auth';
            exclBtn.textContent = 'Exclusive 🔒';
            exclBtn.setAttribute('role', 'tab');
            exclBtn.setAttribute('aria-selected', 'false');

            if (readAuthState().loggedIn) {
                exclBtn.classList.add('unlocked');
                exclBtn.textContent = 'Exclusive';
            }

            freeBtn.addEventListener('click', () => {
                if (category === 'free') return;
                freeBtn.classList.add('active');
                freeBtn.setAttribute('aria-selected', 'true');
                exclBtn.classList.remove('active');
                exclBtn.setAttribute('aria-selected', 'false');
                switchCategory('free');
            });

            exclBtn.addEventListener('click', () => {
                if (!readAuthState().loggedIn) {
                    openAuthModal('register');
                    return;
                }
                if (category === 'exclusive') return;
                exclBtn.classList.add('active');
                exclBtn.setAttribute('aria-selected', 'true');
                freeBtn.classList.remove('active');
                freeBtn.setAttribute('aria-selected', 'false');
                switchCategory('exclusive');
            });

            bar.appendChild(freeBtn);
            bar.appendChild(exclBtn);
            ctn.parentElement.insertBefore(bar, ctn);

            document.addEventListener('bitbi:auth-change', () => {
                const { loggedIn } = getAuthState();
                exclBtn.classList.toggle('unlocked', loggedIn);
                exclBtn.textContent = loggedIn ? 'Exclusive' : 'Exclusive 🔒';
                if (!loggedIn && category === 'exclusive') {
                    freeBtn.classList.add('active');
                    freeBtn.setAttribute('aria-selected', 'true');
                    exclBtn.classList.remove('active');
                    exclBtn.setAttribute('aria-selected', 'false');
                    switchCategory('free');
                }
            });
        }

        function engage() {
            if (isDeck) return;
            isDeck = true;
            deckActive = activeIdx !== null && activeIdx !== -1 ? activeIdx : 0;
            ctn.classList.add('snd-deck');
            applyCategory();
            sndLayout(true);
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    getCards().forEach(card => { card.style.transition = ''; });
                });
            });
            sndBuildDots();
        }

        function disengage() {
            if (!isDeck) return;
            isDeck = false;
            ctn.classList.remove('snd-deck');
            Array.from(ctn.children).forEach(card => {
                card.style.transform = '';
                card.style.opacity = '';
                card.style.zIndex = '';
                card.style.pointerEvents = '';
                card.style.transition = '';
            });
            applyCategory();
            if (dotsEl) { dotsEl.remove(); dotsEl = null; }
        }

        let sx;
        let sy;
        let st;
        let tracking;
        let decided;
        let horiz;

        ctn.addEventListener('touchstart', event => {
            if (!isDeck) return;
            const touch = event.touches[0];
            sx = touch.clientX;
            sy = touch.clientY;
            st = Date.now();
            tracking = true;
            decided = false;
            horiz = false;
            swipeLock = false;
            wasPlayingOnSwipeStart = isPublicPlaying();
            const card = getCards()[deckActive];
            if (card) card.style.transition = 'none';
        }, { passive: true });

        ctn.addEventListener('touchmove', event => {
            if (!tracking || !isDeck) return;
            const touch = event.touches[0];
            const dx = touch.clientX - sx;
            const dy = touch.clientY - sy;
            if (!decided && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
                decided = true;
                horiz = Math.abs(dx) > Math.abs(dy);
                if (!horiz) {
                    tracking = false;
                    const card = getCards()[deckActive];
                    if (card) card.style.transition = '';
                    return;
                }
            }
            if (horiz) {
                event.preventDefault();
                const card = getCards()[deckActive];
                if (card) {
                    let adj = dx;
                    const n = getCards().length;
                    const atBoundary = (deckActive === 0 && dx > 0) || (deckActive >= n - 1 && dx < 0);
                    if (atBoundary) adj *= 0.25;
                    card.style.transform = `translateX(${adj}px) scale(0.90)`;
                }
            }
        }, { passive: false });

        ctn.addEventListener('touchend', event => {
            if (!tracking || !isDeck) return;
            tracking = false;
            if (!horiz || !decided) { sndLayout(); return; }
            const dx = event.changedTouches[0].clientX - sx;
            const velocity = Math.abs(dx) / Math.max(Date.now() - st, 1);
            const prevActive = deckActive;
            const n = getCards().length;
            if ((Math.abs(dx) > 40 || velocity > 0.3) && Math.abs(dx) > 15) {
                swipeLock = true;
                if (dx < 0 && deckActive < n - 1) deckActive++;
                else if (dx > 0 && deckActive > 0) deckActive--;
            }

            if (category === 'exclusive') lastExclDeckIdx = deckActive;
            sndLayout();
            sndSyncDots();
            if (deckActive !== prevActive) {
                if (wasPlayingOnSwipeStart && category === 'free') playTrack(deckActive);
                if (category === 'exclusive') {
                    ctn.dispatchEvent(new CustomEvent('snd:excl-swipe', { detail: deckActive }));
                }
            }
        }, { passive: true });

        ctn.addEventListener('touchcancel', () => {
            if (!tracking || !isDeck) return;
            tracking = false;
            sndLayout();
        }, { passive: true });

        ctn.addEventListener('click', event => {
            if (swipeLock) {
                event.stopPropagation();
                event.preventDefault();
                swipeLock = false;
            }
        }, true);

        new MutationObserver(() => {
            applyCategory();
            if (!isDeck) return;
            sndLayout(true);
            sndSyncDots();
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    getCards().forEach(card => { card.style.transition = ''; });
                });
            });
        }).observe(ctn, { childList: true });

        createFilterBar();

        ctn.addEventListener('snd:excl-deck-sync', event => {
            const newIdx = event.detail;
            lastExclDeckIdx = newIdx;
            if (!isDeck || category !== 'exclusive') return;
            const cards = getCards();
            if (newIdx >= 0 && newIdx < cards.length) {
                deckActive = newIdx;
                sndLayout();
                sndSyncDots();
            }
        });

        mql.addEventListener('change', event => {
            if (event.matches) engage();
            else disengage();
        });

        if (mql.matches) engage();
        else applyCategory();

        return function syncDeckToTrack(idx) {
            if (!isDeck || category !== 'free') return;
            const cards = getCards();
            if (idx < 0 || idx >= cards.length) return;
            deckActive = idx;
            sndLayout();
            sndSyncDots();
        };
    }

    syncDeck = initSndDeck();
    subscribeGlobalAudioState(renderFromState);

    document.addEventListener('bitbi:audio-ended', event => {
        const endedIdx = tracks.findIndex(track => track.id === event.detail?.trackId);
        if (endedIdx === -1) return;
        if (endedIdx < tracks.length - 1) {
            playTrack(endedIdx + 1);
        }
    });
}
