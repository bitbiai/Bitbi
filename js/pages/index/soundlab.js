/* ============================================================
   BITBI — Sound Lab: audio player, playlist, seek, volume
   ============================================================ */

import { formatTime } from '../../shared/format-time.js';
import { getAuthState } from '../../shared/auth-state.js';
import { openAuthModal } from '../../shared/auth-modal.js';

const R2_PUBLIC_BASE = 'https://pub.bitbi.ai';

const tracks = [
    { t: 'Cosmic Sea', file: `${R2_PUBLIC_BASE}/audio/sound-lab/cosmic-sea.mp3` },
    { t: 'Zufall und Notwendigkeit', file: `${R2_PUBLIC_BASE}/audio/sound-lab/zufall-und-notwendigkeit.mp3` },
    { t: 'Relativity', file: `${R2_PUBLIC_BASE}/audio/sound-lab/relativity.mp3` },
    { t: 'Tiny Hearts', file: `${R2_PUBLIC_BASE}/audio/sound-lab/tiny-hearts.mp3` },
    { t: "Grok's Groove Remix", file: `${R2_PUBLIC_BASE}/audio/sound-lab/grok.mp3` },
];

const trackImages = ['/assets/images/4.jpg', '/assets/images/2.jpg', '/assets/images/3.jpg', '/assets/images/5.jpg', '/assets/images/6.jpg'];

export function initSoundLab(revealObserver) {
    const ctn = document.getElementById('soundLabTracks');
    const plEl = document.getElementById('playlistPlayer');
    if (!ctn || !plEl) return;

    const audios = [];
    let activeIdx = null;
    let syncDeck = null;

    tracks.forEach((tr, idx) => {
        const audio = new Audio();
        audio.preload = 'none';
        audios.push(audio);

        const d = document.createElement('div');
        d.className = 'reveal snd-card';
        d.style.cssText = 'background:rgba(13,27,42,0.45);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,0.06);border-radius:14px;overflow:hidden;transition:border-color 0.3s';
        d.onmouseenter = () => d.style.borderColor = 'rgba(0,240,255,0.15)';
        d.onmouseleave = () => { if (activeIdx !== idx) d.style.borderColor = 'rgba(255,255,255,0.06)'; };
        d.innerHTML = `<div class="snd-hero"><img src="${trackImages[idx]}" alt="${tr.t}" loading="lazy" decoding="async" width="600" height="180" style="width:100%;height:100%;object-fit:cover;display:block"><div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(13,27,42,0.7),transparent)"></div></div><div class="snd-player-row" style="display:flex;align-items:center;gap:14px;padding:16px 20px"><button class="snd-play" data-idx="${idx}" aria-label="Play ${tr.t}" style="width:40px;height:40px;border-radius:50%;background:rgba(0,240,255,0.07);border:1px solid rgba(0,240,255,0.15);display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;transition:background 0.2s"><svg class="pi" width="14" height="14" fill="#00F0FF" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg><svg class="pa" width="14" height="14" fill="#00F0FF" viewBox="0 0 24 24" style="display:none"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg></button><div style="flex:1;min-width:0"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px"><h4 style="font-family:'Playfair Display',serif;font-weight:600;font-size:14px;color:rgba(255,255,255,0.85);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${tr.t}</h4><span class="snd-time" style="font-size:10px;font-family:'JetBrains Mono',monospace;color:rgba(255,255,255,0.2);flex-shrink:0;margin-left:8px">0:00</span></div><div class="snd-bar" style="position:relative;height:3px;background:rgba(255,255,255,0.05);border-radius:2px;overflow:hidden;cursor:pointer"><div class="snd-prog" style="position:absolute;left:0;top:0;height:100%;width:0%;background:linear-gradient(90deg,#00F0FF,#FFB300);border-radius:2px;transition:width 0.1s linear"></div></div></div><div class="eq-wrap" style="display:flex;align-items:flex-end;gap:2px;height:32px;flex-shrink:0"><div class="eq-bar" style="animation:eqBar1 0.8s ease-in-out infinite paused;height:6px"></div><div class="eq-bar" style="animation:eqBar2 0.6s ease-in-out infinite paused;height:12px"></div><div class="eq-bar" style="animation:eqBar3 0.7s ease-in-out infinite paused;height:4px"></div><div class="eq-bar" style="animation:eqBar1 0.9s ease-in-out infinite paused;height:8px"></div><div class="eq-bar" style="animation:eqBar2 0.55s ease-in-out infinite paused;height:10px"></div></div></div>`;
        ctn.appendChild(d);
    });

    function highlightRow(idx) {
        for (let i = 0; i < ctn.children.length; i++) {
            const row = ctn.children[i];
            if (!row || row.classList.contains('locked-area')) continue;
            if (i === idx) {
                row.style.borderColor = 'rgba(0,240,255,0.2)';
                row.style.background = 'rgba(0,240,255,0.04)';
            } else {
                row.style.borderColor = 'rgba(255,255,255,0.06)';
                row.style.background = 'rgba(13,27,42,0.45)';
            }
        }
    }

    function stopAll() {
        audios.forEach((a, i) => {
            a.pause();
            const row = ctn.children[i];
            if (!row) return;
            row.querySelectorAll('.eq-bar').forEach(b => b.style.animationPlayState = 'paused');
            row.querySelector('.pi').style.display = '';
            row.querySelector('.pa').style.display = 'none';
        });
        activeIdx = null;
        highlightRow(-1);
        plUpdate();
    }

    function playTrack(idx) {
        if (idx < 0 || idx >= tracks.length) return;
        stopAll();
        const audio = audios[idx];
        const row = ctn.children[idx];
        audio.play().catch(() => {});
        activeIdx = idx;
        startTick();
        row.querySelector('.pi').style.display = 'none';
        row.querySelector('.pa').style.display = '';
        row.querySelectorAll('.eq-bar').forEach(b => b.style.animationPlayState = 'running');
        highlightRow(idx);
        plUpdate();
        if (syncDeck) syncDeck(idx);
    }

    function pauseTrack() {
        if (activeIdx === null) return;
        const audio = audios[activeIdx];
        const row = ctn.children[activeIdx];
        audio.pause();
        row.querySelectorAll('.eq-bar').forEach(b => b.style.animationPlayState = 'paused');
        row.querySelector('.pi').style.display = '';
        row.querySelector('.pa').style.display = 'none';
        plUpdate();
    }

    document.querySelectorAll('.snd-play').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.idx);
            if (activeIdx === idx && !audios[idx].paused) { pauseTrack(); return; }
            if (activeIdx === idx && audios[idx].paused) {
                audios[idx].play().catch(() => {});
                startTick();
                const row = ctn.children[idx];
                row.querySelector('.pi').style.display = 'none';
                row.querySelector('.pa').style.display = '';
                row.querySelectorAll('.eq-bar').forEach(b => b.style.animationPlayState = 'running');
                plUpdate();
                return;
            }
            playTrack(idx);
        });
    });

    document.querySelectorAll('.snd-hero').forEach(hero => {
        hero.addEventListener('click', () => {
            const trackBtn = hero.closest('.snd-card').querySelector('.snd-play');
            if (trackBtn) trackBtn.click();
        });
    });

    ctn.querySelectorAll('.snd-bar').forEach((bar, idx) => {
        bar.addEventListener('click', (e) => {
            const audio = audios[idx];
            if (audio.duration) {
                const rect = bar.getBoundingClientRect();
                audio.currentTime = (e.clientX - rect.left) / rect.width * audio.duration;
            }
        });
    });

    let tickRunning = false;

    function tick() {
        if (activeIdx !== null) {
            const a = audios[activeIdx];
            const row = ctn.children[activeIdx];
            if (row && a.duration) {
                row.querySelector('.snd-prog').style.width = (a.currentTime / a.duration * 100) + '%';
                row.querySelector('.snd-time').textContent = formatTime(a.currentTime) + ' / ' + formatTime(a.duration);
            }
        }
        plTickProgress();
        if (audios.some(a => !a.paused)) {
            requestAnimationFrame(tick);
        } else {
            tickRunning = false;
        }
    }

    function startTick() {
        if (!tickRunning) {
            tickRunning = true;
            requestAnimationFrame(tick);
        }
    }

    audios.forEach((a, i) => {
        a.addEventListener('ended', () => {
            const row = ctn.children[i];
            row.querySelectorAll('.eq-bar').forEach(b => b.style.animationPlayState = 'paused');
            row.querySelector('.pi').style.display = '';
            row.querySelector('.pa').style.display = 'none';
            row.querySelector('.snd-prog').style.width = '0%';
            if (i < tracks.length - 1) { playTrack(i + 1); }
            else { activeIdx = null; highlightRow(-1); plUpdate(); }
        });
    });

    /* ── Playlist Player ── */
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
                <span id="plTitle" style="font-family:'Playfair Display',serif;font-weight:600;font-size:13px;color:rgba(255,255,255,0.65);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Play All \u2014 ${tracks.length} Tracks</span>
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

    function plUpdate() {
        const playIcon = document.getElementById('plPlayIcon');
        const pauseIcon = document.getElementById('plPauseIcon');
        const titleEl = document.getElementById('plTitle');
        const numEl = document.getElementById('plTrackNum');
        if (!playIcon || !pauseIcon || !titleEl || !numEl) return;
        const isPlaying = activeIdx !== null && !audios[activeIdx].paused;
        playIcon.style.display = isPlaying ? 'none' : '';
        pauseIcon.style.display = isPlaying ? '' : 'none';
        if (activeIdx !== null) {
            titleEl.textContent = tracks[activeIdx].t;
            numEl.textContent = 'Track ' + (activeIdx + 1) + ' / ' + tracks.length;
        } else {
            titleEl.textContent = 'Play All \u2014 ' + tracks.length + ' Tracks';
            numEl.textContent = '';
        }
    }

    function plTickProgress() {
        const progEl = document.getElementById('plProg');
        const timeEl = document.getElementById('plTime');
        if (!progEl || !timeEl) return;
        if (activeIdx === null) { progEl.style.width = '0%'; timeEl.textContent = ''; return; }
        const a = audios[activeIdx];
        if (!a.duration) return;
        progEl.style.width = (a.currentTime / a.duration * 100) + '%';
        timeEl.textContent = formatTime(a.currentTime) + ' / ' + formatTime(a.duration);
    }

    document.getElementById('plPlay').addEventListener('click', () => {
        if (activeIdx === null) { playTrack(0); return; }
        if (audios[activeIdx].paused) {
            audios[activeIdx].play().catch(() => {});
            startTick();
            const row = ctn.children[activeIdx];
            row.querySelector('.pi').style.display = 'none';
            row.querySelector('.pa').style.display = '';
            row.querySelectorAll('.eq-bar').forEach(b => b.style.animationPlayState = 'running');
            plUpdate();
        } else {
            pauseTrack();
        }
    });

    document.getElementById('plNext').addEventListener('click', () => {
        const next = activeIdx === null ? 0 : (activeIdx + 1) % tracks.length;
        playTrack(next);
    });

    document.getElementById('plPrev').addEventListener('click', () => {
        if (activeIdx !== null && audios[activeIdx].currentTime > 3) { audios[activeIdx].currentTime = 0; return; }
        const prev = activeIdx === null ? tracks.length - 1 : (activeIdx - 1 + tracks.length) % tracks.length;
        playTrack(prev);
    });

    document.getElementById('plBar').addEventListener('click', (e) => {
        if (activeIdx === null) return;
        const a = audios[activeIdx];
        if (!a.duration) return;
        const rect = e.currentTarget.getBoundingClientRect();
        a.currentTime = (e.clientX - rect.left) / rect.width * a.duration;
    });

    document.getElementById('plVol').addEventListener('input', (e) => {
        const vol = e.target.value / 100;
        audios.forEach(a => a.volume = vol);
    });

    audios.forEach(a => a.volume = 0.8);

    // Defer audio metadata loading until soundlab section is visible
    if (typeof IntersectionObserver !== 'undefined') {
        const audioIo = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting) {
                tracks.forEach((tr, idx) => {
                    audios[idx].src = tr.file;
                    audios[idx].preload = 'metadata';
                });
                audioIo.disconnect();
            }
        });
        audioIo.observe(ctn);
    } else {
        tracks.forEach((tr, idx) => {
            audios[idx].src = tr.file;
            audios[idx].preload = 'metadata';
        });
    }

    plEl.onmouseenter = () => plEl.style.borderColor = 'rgba(0,240,255,0.2)';
    plEl.onmouseleave = () => plEl.style.borderColor = 'rgba(0,240,255,0.1)';

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

        function getCards() {
            return Array.from(ctn.children).filter(c => c.style.display !== 'none');
        }

        function sndLayout(skipAnim) {
            const cards = getCards();
            const n = cards.length;
            cards.forEach((c, i) => {
                const d = i - deckActive;
                c.style.transition = skipAnim ? 'none' : '';
                if (d === 0) {
                    c.style.transform = 'scale(0.90)';
                    c.style.opacity = '1';
                    c.style.zIndex = String(n);
                    c.style.pointerEvents = '';
                } else if (d === 1) {
                    c.style.transform = 'translateX(24px) scale(0.86)';
                    c.style.opacity = '0.55';
                    c.style.zIndex = String(n - 1);
                    c.style.pointerEvents = 'none';
                } else if (d === 2) {
                    c.style.transform = 'translateX(42px) scale(0.82)';
                    c.style.opacity = '0.3';
                    c.style.zIndex = String(n - 2);
                    c.style.pointerEvents = 'none';
                } else {
                    c.style.transform = d < 0 ? 'translateX(-30px) scale(0.82)' : 'translateX(50px) scale(0.80)';
                    c.style.opacity = '0';
                    c.style.zIndex = '0';
                    c.style.pointerEvents = 'none';
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
                const d = document.createElement('button');
                d.type = 'button';
                d.className = 'snd-deck-dot' + (i === deckActive ? ' active' : '');
                d.setAttribute('role', 'tab');
                d.setAttribute('aria-selected', i === deckActive ? 'true' : 'false');
                d.setAttribute('aria-label', `Show track ${i + 1}`);
                d.addEventListener('click', () => {
                    const wasPlaying = activeIdx !== null && !audios[activeIdx].paused;
                    deckActive = i;
                    sndLayout();
                    sndSyncDots();
                    if (wasPlaying && category === 'free') playTrack(deckActive);
                    if (category === 'exclusive') ctn.dispatchEvent(new CustomEvent('snd:excl-swipe', { detail: i }));
                });
                dotsEl.appendChild(d);
            });
            ctn.after(dotsEl);
        }

        function sndSyncDots() {
            if (!dotsEl) return;
            const dots = dotsEl.querySelectorAll('.snd-deck-dot');
            const cards = getCards();
            if (dots.length !== cards.length) { sndBuildDots(); return; }
            dots.forEach((d, i) => {
                d.classList.toggle('active', i === deckActive);
                d.setAttribute('aria-selected', i === deckActive ? 'true' : 'false');
            });
        }

        function applyCategory() {
            Array.from(ctn.children).forEach(c => {
                const isExcl = c.classList.contains('locked-area');
                c.style.display = (category === 'free') === isExcl ? 'none' : '';
            });
        }

        function switchCategory(cat) {
            category = cat;
            if (!isDeck) return;
            applyCategory();
            deckActive = 0;
            sndLayout(true);
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    getCards().forEach(c => { c.style.transition = ''; });
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
            exclBtn.textContent = 'Exclusive \uD83D\uDD12';
            exclBtn.setAttribute('role', 'tab');
            exclBtn.setAttribute('aria-selected', 'false');

            const { loggedIn } = getAuthState();
            if (loggedIn) {
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
                const { loggedIn } = getAuthState();
                if (!loggedIn) { openAuthModal('register'); return; }
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
                exclBtn.textContent = loggedIn ? 'Exclusive' : 'Exclusive \uD83D\uDD12';
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
            deckActive = activeIdx !== null ? activeIdx : 0;
            ctn.classList.add('snd-deck');
            applyCategory();
            sndLayout(true);
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    getCards().forEach(c => { c.style.transition = ''; });
                });
            });
            sndBuildDots();
        }

        function disengage() {
            if (!isDeck) return;
            isDeck = false;
            ctn.classList.remove('snd-deck');
            Array.from(ctn.children).forEach(c => {
                c.style.transform = '';
                c.style.opacity = '';
                c.style.zIndex = '';
                c.style.pointerEvents = '';
                c.style.transition = '';
                c.style.display = '';
            });
            if (dotsEl) { dotsEl.remove(); dotsEl = null; }
        }

        /* Touch */
        let sx, sy, st, tracking, decided, horiz;

        ctn.addEventListener('touchstart', e => {
            if (!isDeck) return;
            const t = e.touches[0];
            sx = t.clientX; sy = t.clientY; st = Date.now();
            tracking = true; decided = false; horiz = false;
            swipeLock = false;
            wasPlayingOnSwipeStart = activeIdx !== null && !audios[activeIdx].paused;
            const c = getCards()[deckActive];
            if (c) c.style.transition = 'none';
        }, { passive: true });

        ctn.addEventListener('touchmove', e => {
            if (!tracking || !isDeck) return;
            const t = e.touches[0];
            const dx = t.clientX - sx, dy = t.clientY - sy;
            if (!decided && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
                decided = true;
                horiz = Math.abs(dx) > Math.abs(dy);
                if (!horiz) {
                    tracking = false;
                    const c = getCards()[deckActive];
                    if (c) c.style.transition = '';
                    return;
                }
            }
            if (horiz) {
                e.preventDefault();
                const c = getCards()[deckActive];
                if (c) {
                    let adj = dx;
                    const n = getCards().length;
                    if ((deckActive === 0 && dx > 0) || (deckActive >= n - 1 && dx < 0)) adj *= 0.25;
                    c.style.transform = `translateX(${adj}px) scale(0.90)`;
                }
            }
        }, { passive: false });

        ctn.addEventListener('touchend', e => {
            if (!tracking || !isDeck) return;
            tracking = false;
            if (!horiz || !decided) { sndLayout(); return; }
            const dx = e.changedTouches[0].clientX - sx;
            const v = Math.abs(dx) / Math.max(Date.now() - st, 1);
            const prevActive = deckActive;
            const n = getCards().length;
            if ((Math.abs(dx) > 40 || v > 0.3) && Math.abs(dx) > 15) {
                swipeLock = true;
                if (dx < 0 && deckActive < n - 1) deckActive++;
                else if (dx > 0 && deckActive > 0) deckActive--;
            }
            sndLayout();
            sndSyncDots();
            if (deckActive !== prevActive) {
                if (wasPlayingOnSwipeStart && category === 'free') playTrack(deckActive);
                if (category === 'exclusive') ctn.dispatchEvent(new CustomEvent('snd:excl-swipe', { detail: deckActive }));
            }
        }, { passive: true });

        ctn.addEventListener('touchcancel', () => {
            if (!tracking || !isDeck) return;
            tracking = false;
            sndLayout();
        }, { passive: true });

        /* Block click after swipe */
        ctn.addEventListener('click', e => {
            if (swipeLock) { e.stopPropagation(); e.preventDefault(); swipeLock = false; }
        }, true);

        /* Watch for dynamically added cards (locked sections) */
        new MutationObserver(() => {
            if (isDeck) {
                applyCategory();
                sndLayout(true);
                sndSyncDots();
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        getCards().forEach(c => { c.style.transition = ''; });
                    });
                });
            }
        }).observe(ctn, { childList: true });

        createFilterBar();

        /* Sync deck when exclusive auto-advances */
        ctn.addEventListener('snd:excl-deck-sync', (e) => {
            if (!isDeck || category !== 'exclusive') return;
            const newIdx = e.detail;
            const cards = getCards();
            if (newIdx >= 0 && newIdx < cards.length) {
                deckActive = newIdx;
                sndLayout();
                sndSyncDots();
            }
        });

        mql.addEventListener('change', e => {
            if (e.matches) engage();
            else disengage();
        });

        if (mql.matches) engage();

        return function(idx) {
            if (!isDeck || category !== 'free') return;
            const cards = getCards();
            if (idx < 0 || idx >= cards.length) return;
            deckActive = idx;
            sndLayout();
            sndSyncDots();
        };
    }

    syncDeck = initSndDeck();
}
