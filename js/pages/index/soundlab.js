/* ============================================================
   BITBI - Sound Lab: public Memtracks playback
   ============================================================ */

import { formatTime } from '../../shared/format-time.js';
import { createStarButton } from '../../shared/favorites.js';
import {
    initGlobalAudioManager,
    getGlobalAudioState,
    subscribeGlobalAudioState,
    playGlobalTrack,
    pauseGlobalAudio,
    resumeGlobalAudio,
    seekGlobalAudio,
} from '../../shared/audio/audio-manager.js?v=__ASSET_VERSION__';

const MEMTRACKS_PAGE_LIMIT = 60;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function getSeekTimeFromPointer(control, event, duration) {
    const rect = control.getBoundingClientRect();
    const ratio = rect.width > 0 ? clamp((event.clientX - rect.left) / rect.width, 0, 1) : 0;
    return duration * ratio;
}

function stopControlEvent(event) {
    event.stopPropagation();
}

export function initSoundLab(revealObserver) {
    const ctn = document.getElementById('soundLabTracks');
    if (!ctn || ctn.dataset.soundlabReady === 'true') return;
    ctn.dataset.soundlabReady = 'true';

    const plEl = document.getElementById('playlistPlayer');
    if (plEl) {
        plEl.hidden = true;
        plEl.style.display = 'none';
        plEl.innerHTML = '';
    }

    initGlobalAudioManager();

    let currentState = getGlobalAudioState();
    let syncDeck = null;
    const memtracksState = {
        items: [],
        loaded: false,
        loading: false,
        nextCursor: null,
        hasMore: false,
        error: '',
    };

    const statusEl = document.createElement('div');
    statusEl.className = 'snd-memtracks-status';
    statusEl.hidden = true;
    ctn.after(statusEl);

    function getMemtrackTrack(item) {
        if (!item?.id || !item?.file?.url) return null;
        return {
            id: `memtrack:${item.id}`,
            slug: item.slug || `memtrack-${item.id}`,
            title: item.title || 'Memtrack',
            src: item.file.url,
            sourceUrl: item.file.url,
            artwork: item.poster?.url || '',
            artworkUrl: item.poster?.url || '',
            access: 'public',
            collection: 'memtracks',
            originLabel: 'Sound Lab',
            crossOrigin: '',
        };
    }

    function getCurrentMemtrackIndex(state = currentState) {
        return memtracksState.items.findIndex(item => state.trackId === `memtrack:${item.id}`);
    }

    function syncStatus() {
        const show = memtracksState.loading || memtracksState.error || (memtracksState.loaded && !memtracksState.items.length);
        statusEl.hidden = !show;
        if (memtracksState.loading) {
            statusEl.textContent = 'Loading published tracks...';
        } else if (memtracksState.error) {
            statusEl.textContent = memtracksState.error;
        } else if (memtracksState.loaded && !memtracksState.items.length) {
            statusEl.textContent = 'No published tracks yet.';
        } else {
            statusEl.textContent = '';
        }
    }

    function renderMemtrackCard(row, item, state = currentState) {
        const track = getMemtrackTrack(item);
        if (!track) return;
        const isActive = state.trackId === track.id;
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

    function renderMemtrackRows(state = currentState) {
        ctn.querySelectorAll('.snd-card--memtrack').forEach((row) => {
            const item = memtracksState.items.find(entry => String(entry.id) === row.dataset.memtrackId);
            if (item) renderMemtrackCard(row, item, state);
        });
    }

    function createMemtrackCard(item) {
        const card = document.createElement('div');
        card.className = 'reveal snd-card snd-card--memtrack';
        card.style.cssText = 'position:relative;background:rgba(13,27,42,0.45);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,0.06);border-radius:14px;overflow:hidden;transition:border-color 0.3s,background-color 0.3s';
        card.dataset.memtrackId = String(item.id || '');

        const hero = document.createElement('div');
        hero.className = 'snd-hero';
        const posterUrl = item.poster?.url || '';
        if (posterUrl) {
            const img = document.createElement('img');
            img.src = posterUrl;
            img.alt = item.title || 'Memtrack';
            img.loading = 'lazy';
            img.decoding = 'async';
            img.width = Number(item.poster?.w) || 600;
            img.height = Number(item.poster?.h) || 180;
            img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
            hero.appendChild(img);
        } else {
            const fallback = document.createElement('div');
            fallback.className = 'snd-memtrack-fallback';
            fallback.setAttribute('aria-hidden', 'true');
            fallback.textContent = '\u266B';
            hero.appendChild(fallback);
        }

        const veil = document.createElement('div');
        veil.style.cssText = 'position:absolute;inset:0;background:linear-gradient(to top,rgba(13,27,42,0.72),transparent)';
        hero.appendChild(veil);

        const star = createStarButton('soundlab', String(item.id || ''), {
            title: item.title || 'Memtrack',
            thumb_url: posterUrl || item.file?.url || '',
        });
        star.style.cssText = 'position:absolute;top:8px;right:8px';
        hero.appendChild(star);

        const row = document.createElement('div');
        row.className = 'snd-player-row';
        row.style.cssText = 'display:flex;align-items:center;gap:14px;padding:16px 20px';

        const playButton = document.createElement('button');
        playButton.type = 'button';
        playButton.className = 'snd-play snd-memtrack-play';
        playButton.setAttribute('aria-label', `Play ${item.title || 'Memtrack'}`);
        playButton.style.cssText = 'width:40px;height:40px;border-radius:50%;background:rgba(0,240,255,0.07);border:1px solid rgba(0,240,255,0.15);display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;transition:background 0.2s';
        const playIcon = document.createElement('span');
        playIcon.className = 'pi';
        playIcon.setAttribute('aria-hidden', 'true');
        playIcon.textContent = '\u25B6';
        playIcon.style.cssText = 'color:#00F0FF;font-size:14px;line-height:1;padding-left:2px';
        const pauseIcon = document.createElement('span');
        pauseIcon.className = 'pa';
        pauseIcon.setAttribute('aria-hidden', 'true');
        pauseIcon.textContent = '\u275A\u275A';
        pauseIcon.style.cssText = 'display:none;color:#00F0FF;font-size:13px;line-height:1';
        playButton.append(playIcon, pauseIcon);

        const metaWrap = document.createElement('div');
        metaWrap.style.cssText = 'flex:1;min-width:0';
        const titleRow = document.createElement('div');
        titleRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:8px';
        const title = document.createElement('h4');
        title.style.cssText = "font-family:'Playfair Display',serif;font-weight:600;font-size:14px;color:rgba(255,255,255,0.85);white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
        title.textContent = item.title || 'Memtrack';
        const time = document.createElement('span');
        time.className = 'snd-time';
        time.style.cssText = "font-size:10px;font-family:'JetBrains Mono',monospace;color:rgba(255,255,255,0.2);flex-shrink:0";
        time.textContent = '0:00';
        titleRow.append(title, time);

        const bar = document.createElement('div');
        bar.className = 'snd-bar';
        bar.style.cssText = 'position:relative;height:3px;background:rgba(255,255,255,0.05);border-radius:2px;overflow:hidden;cursor:pointer';
        const progress = document.createElement('div');
        progress.className = 'snd-prog';
        progress.style.cssText = 'position:absolute;left:0;top:0;height:100%;width:0%;background:linear-gradient(90deg,#00F0FF,#FFB300);border-radius:2px;transition:width 0.1s linear';
        bar.appendChild(progress);
        metaWrap.append(titleRow, bar);

        const eq = document.createElement('div');
        eq.className = 'eq-wrap';
        eq.style.cssText = 'display:flex;align-items:flex-end;gap:2px;height:32px;flex-shrink:0';
        ['eqBar1 0.8s 6px', 'eqBar2 0.6s 12px', 'eqBar3 0.7s 4px', 'eqBar1 0.9s 8px', 'eqBar2 0.55s 10px'].forEach((entry) => {
            const [name, duration, height] = entry.split(' ');
            const barEl = document.createElement('div');
            barEl.className = 'eq-bar';
            barEl.style.cssText = `animation:${name} ${duration} ease-in-out infinite paused;height:${height}`;
            eq.appendChild(barEl);
        });

        row.append(playButton, metaWrap, eq);
        card.append(hero, row);

        const playItem = async (event) => {
            event?.stopPropagation();
            const track = getMemtrackTrack(item);
            if (!track) return;
            if (currentState.trackId === track.id && currentState.status === 'playing') {
                pauseGlobalAudio();
                return;
            }
            if (currentState.trackId === track.id) {
                await resumeGlobalAudio(true);
                return;
            }
            playGlobalTrack(track);
        };

        playButton.addEventListener('click', playItem);
        hero.addEventListener('click', playItem);
        row.addEventListener('click', stopControlEvent);
        bar.addEventListener('pointerdown', stopControlEvent);
        bar.addEventListener('click', (event) => {
            event.stopPropagation();
            event.preventDefault();
            const track = getMemtrackTrack(item);
            const activeState = getGlobalAudioState();
            if (!track || activeState.trackId !== track.id || !activeState.duration) return;
            seekGlobalAudio(getSeekTimeFromPointer(bar, event, activeState.duration));
        });

        return card;
    }

    async function fetchMemtracks(cursor = null) {
        const params = new URLSearchParams({ limit: String(MEMTRACKS_PAGE_LIMIT) });
        if (cursor) params.set('cursor', cursor);
        const res = await fetch(`/api/gallery/memtracks?${params}`, {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
        });
        const body = await res.json().catch(() => null);
        if (!res.ok || !body?.ok) {
            throw new Error(body?.error || 'Published tracks unavailable.');
        }
        return body.data || {};
    }

    async function loadMemtracks() {
        if (memtracksState.loaded || memtracksState.loading) return;
        memtracksState.loading = true;
        syncStatus();
        try {
            const page = await fetchMemtracks();
            const items = Array.isArray(page.items) ? page.items : [];
            memtracksState.items = items;
            memtracksState.nextCursor = page.next_cursor || null;
            memtracksState.hasMore = !!page.has_more;
            memtracksState.error = '';
            memtracksState.loaded = true;
            ctn.innerHTML = '';
            items.forEach((item) => {
                const card = createMemtrackCard(item);
                ctn.appendChild(card);
                if (revealObserver) revealObserver.observe(card);
            });
            renderMemtrackRows(currentState);
            ctn.dispatchEvent(new CustomEvent('snd:tracks-refresh'));
            document.dispatchEvent(new CustomEvent('bitbi:homepage-category-content-ready', {
                detail: { category: 'sound' },
            }));
        } catch (error) {
            console.warn('soundLab memtracks:', error);
            memtracksState.error = 'Could not load published tracks right now.';
            memtracksState.loaded = true;
        } finally {
            memtracksState.loading = false;
            syncStatus();
        }
    }

    function renderFromState(nextState) {
        currentState = nextState;
        renderMemtrackRows(nextState);
        const currentIdx = getCurrentMemtrackIndex(nextState);
        if (syncDeck && currentIdx >= 0) {
            syncDeck(currentIdx);
        }
    }

    function initSndDeck() {
        const mql = window.matchMedia('(max-width: 639px)');
        let deckActive = 0;
        let isDeck = false;
        let dotsEl = null;
        let swipeLock = false;
        let tracking = false;
        let decided = false;
        let horizontal = false;
        let sx = 0;
        let sy = 0;
        let st = 0;

        function getCards() {
            return Array.from(ctn.children).filter(card => card.classList.contains('snd-card--memtrack'));
        }

        function layout(skipAnim = false) {
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

        function syncDots() {
            if (!dotsEl) return;
            const cards = getCards();
            const dots = dotsEl.querySelectorAll('.snd-deck-dot');
            if (dots.length !== cards.length) {
                buildDots();
                return;
            }
            dots.forEach((dot, i) => {
                dot.classList.toggle('active', i === deckActive);
                dot.setAttribute('aria-selected', i === deckActive ? 'true' : 'false');
            });
        }

        function buildDots() {
            if (dotsEl) dotsEl.remove();
            const cards = getCards();
            if (cards.length <= 1) {
                dotsEl = null;
                return;
            }
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
                    deckActive = i;
                    layout();
                    syncDots();
                });
                dotsEl.appendChild(dot);
            });
            ctn.after(dotsEl);
        }

        function refreshDeck(skipAnim = true) {
            const cards = getCards();
            if (deckActive >= cards.length) deckActive = 0;
            if (!isDeck) {
                cards.forEach((card) => {
                    card.style.transform = '';
                    card.style.opacity = '';
                    card.style.zIndex = '';
                    card.style.pointerEvents = '';
                    card.style.transition = '';
                });
                return;
            }
            layout(skipAnim);
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    getCards().forEach(card => { card.style.transition = ''; });
                });
            });
            buildDots();
        }

        function engage() {
            if (isDeck) return;
            isDeck = true;
            const currentIdx = getCurrentMemtrackIndex();
            deckActive = currentIdx >= 0 ? currentIdx : 0;
            ctn.classList.add('snd-deck');
            refreshDeck(true);
        }

        function disengage() {
            if (!isDeck) return;
            isDeck = false;
            ctn.classList.remove('snd-deck');
            if (dotsEl) {
                dotsEl.remove();
                dotsEl = null;
            }
            refreshDeck(false);
        }

        ctn.addEventListener('touchstart', (event) => {
            if (!isDeck) return;
            const touch = event.touches[0];
            sx = touch.clientX;
            sy = touch.clientY;
            st = Date.now();
            tracking = true;
            decided = false;
            horizontal = false;
            swipeLock = false;
            const card = getCards()[deckActive];
            if (card) card.style.transition = 'none';
        }, { passive: true });

        ctn.addEventListener('touchmove', (event) => {
            if (!tracking || !isDeck) return;
            const touch = event.touches[0];
            const dx = touch.clientX - sx;
            const dy = touch.clientY - sy;
            if (!decided && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
                decided = true;
                horizontal = Math.abs(dx) > Math.abs(dy);
                if (!horizontal) {
                    tracking = false;
                    const card = getCards()[deckActive];
                    if (card) card.style.transition = '';
                    return;
                }
            }
            if (!horizontal) return;
            event.preventDefault();
            const card = getCards()[deckActive];
            if (!card) return;
            let adjusted = dx;
            const n = getCards().length;
            const atBoundary = (deckActive === 0 && dx > 0) || (deckActive >= n - 1 && dx < 0);
            if (atBoundary) adjusted *= 0.25;
            card.style.transform = `translateX(${adjusted}px) scale(0.90)`;
        }, { passive: false });

        ctn.addEventListener('touchend', (event) => {
            if (!tracking || !isDeck) return;
            tracking = false;
            if (!horizontal || !decided) {
                layout();
                return;
            }
            const dx = event.changedTouches[0].clientX - sx;
            const velocity = Math.abs(dx) / Math.max(Date.now() - st, 1);
            const n = getCards().length;
            if ((Math.abs(dx) > 40 || velocity > 0.3) && Math.abs(dx) > 15) {
                swipeLock = true;
                if (dx < 0 && deckActive < n - 1) deckActive++;
                else if (dx > 0 && deckActive > 0) deckActive--;
            }
            layout();
            syncDots();
        }, { passive: true });

        ctn.addEventListener('touchcancel', () => {
            if (!tracking || !isDeck) return;
            tracking = false;
            layout();
        }, { passive: true });

        ctn.addEventListener('click', (event) => {
            if (!swipeLock) return;
            event.stopPropagation();
            event.preventDefault();
            swipeLock = false;
        }, true);

        new MutationObserver(() => {
            if (isDeck) refreshDeck(true);
        }).observe(ctn, { childList: true });

        ctn.addEventListener('snd:tracks-refresh', () => {
            if (isDeck) refreshDeck(true);
        });

        mql.addEventListener('change', event => {
            if (event.matches) engage();
            else disengage();
        });

        if (mql.matches) engage();

        return function syncDeckToTrack(index) {
            if (!isDeck) return;
            const cards = getCards();
            if (index < 0 || index >= cards.length || index === deckActive) return;
            deckActive = index;
            layout();
            syncDots();
        };
    }

    syncDeck = initSndDeck();
    subscribeGlobalAudioState(renderFromState);
    loadMemtracks();

    document.addEventListener('bitbi:audio-ended', (event) => {
        const endedIdx = memtracksState.items.findIndex(item => `memtrack:${item.id}` === event.detail?.trackId);
        if (endedIdx === -1 || endedIdx >= memtracksState.items.length - 1) return;
        const nextTrack = getMemtrackTrack(memtracksState.items[endedIdx + 1]);
        if (nextTrack) playGlobalTrack(nextTrack);
    });
}
