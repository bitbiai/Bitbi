/* ============================================================
   BITBI — Locked sections: 5 member-only placements
   ============================================================ */

import { getAuthState } from '../../shared/auth-state.js';
import { openAuthModal } from '../../shared/auth-modal.js';

const LOCK_ICON = `<svg width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>`;

const lockedAreas = [];

export function initLockedSections(revealObserver) {
    setupExperimentCard(revealObserver);
    setupGalleryFilter();
    setupGalleryExclusiveCard();
    setupSoundLabCard();
    setupMarketsCard();

    updateAll();
    document.addEventListener('bitbi:auth-change', updateAll);
}

function updateAll() {
    const { loggedIn } = getAuthState();
    lockedAreas.forEach(el => {
        el.setAttribute('data-locked', loggedIn ? 'false' : 'true');
    });
    /* Update gallery filter button style */
    const filterBtn = document.querySelector('.auth-filter-btn');
    if (filterBtn) {
        filterBtn.classList.toggle('auth-filter-btn--unlocked', loggedIn);
        filterBtn.textContent = loggedIn ? 'Exclusive' : 'Exclusive \uD83D\uDD12';
    }
}

function makeOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'locked-area__overlay';
    overlay.innerHTML = `<div class="locked-area__badge">${LOCK_ICON}<span>Free registration required</span></div>`;
    overlay.addEventListener('click', () => openAuthModal('register'));
    return overlay;
}

/* ── Placement 1: Experiments Grid — YouTube Exclusives card ── */
function setupExperimentCard(revealObserver) {
    const grid = document.getElementById('experimentsGrid');
    if (!grid) return;

    const tc = { YouTube: '239,68,68', Video: '255,179,0' };
    function makeTags(tags) {
        return tags.map(t =>
            `<span style="font-size:10px;font-family:'JetBrains Mono',monospace;background:rgba(${tc[t] || '0,240,255'},0.08);color:rgba(${tc[t] || '0,240,255'},0.8);padding:2px 8px;border-radius:20px">${t}</span>`
        ).join('');
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'locked-area locked-area--card tilt-card rounded-2xl overflow-hidden reveal';
    wrapper.setAttribute('data-locked', 'true');
    wrapper.style.cssText = 'background:rgba(13,27,42,0.45);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,0.06)';

    const content = document.createElement('div');
    content.className = 'locked-area__content';
    content.innerHTML = `<div style="height:180px;position:relative;overflow:hidden;background:radial-gradient(ellipse at center,#1a0510,#0a0205)"><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center"><svg width="48" height="48" fill="rgba(239,68,68,0.3)" viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg></div><div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(13,27,42,0.7),transparent)"></div></div><div style="padding:20px"><div style="display:flex;gap:6px;margin-bottom:10px">${makeTags(['YouTube', 'Video'])}</div><h3 style="font-family:'Playfair Display',serif;font-weight:700;font-size:16px;color:rgba(255,255,255,0.9);margin-bottom:8px">YouTube Exclusives</h3><p style="color:rgba(255,255,255,0.35);font-size:12px;line-height:1.6;margin-bottom:14px">Behind-the-scenes footage, extended cuts, and exclusive video content only available to registered members.</p><span style="color:#00F0FF;font-size:11px;font-weight:600;display:inline-flex;align-items:center;gap:4px">View Content <span style="font-size:14px">\u2192</span></span></div>`;

    wrapper.appendChild(content);
    wrapper.appendChild(makeOverlay());
    grid.appendChild(wrapper);
    lockedAreas.push(wrapper);

    if (revealObserver) revealObserver.observe(wrapper);
}

/* ── Placement 2: Gallery — Exclusive filter button ── */
function setupGalleryFilter() {
    const filterBar = document.querySelector('.filter-bar');
    if (!filterBar) return;

    const btn = document.createElement('button');
    btn.className = 'auth-filter-btn';
    btn.textContent = 'Exclusive \uD83D\uDD12';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', 'false');
    btn.setAttribute('tabindex', '-1');

    btn.addEventListener('click', () => {
        const { loggedIn } = getAuthState();
        if (!loggedIn) {
            openAuthModal('register');
            return;
        }
        const isActive = btn.classList.contains('active');
        /* Deselect all filter buttons (both regular and exclusive) */
        filterBar.querySelectorAll('.filter-btn').forEach(b => {
            b.classList.remove('active');
            b.setAttribute('aria-selected', 'false');
        });
        btn.classList.remove('active');
        btn.setAttribute('aria-selected', 'false');

        if (isActive) {
            /* Toggle off: re-activate "All" */
            const allBtn = filterBar.querySelector('[data-filter="all"]');
            if (allBtn) { allBtn.classList.add('active'); allBtn.setAttribute('aria-selected', 'true'); allBtn.click(); }
        } else {
            /* Toggle on: show exclusive only */
            btn.classList.add('active');
            btn.setAttribute('aria-selected', 'true');
            /* Dispatch a custom event so gallery.js render('exclusive') is triggered */
            const grid = document.getElementById('galleryGrid');
            if (grid) grid.dispatchEvent(new CustomEvent('gallery:filter', { detail: 'exclusive' }));
        }
    });

    filterBar.appendChild(btn);
}

/* ── Placement 2b: Gallery — Exclusive Image card ── */
function setupGalleryExclusiveCard() {
    const grid = document.getElementById('galleryGrid');
    const modal = document.getElementById('galleryModal');
    if (!grid || !modal) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'locked-area gallery-item';
    wrapper.setAttribute('data-locked', 'true');

    const content = document.createElement('div');
    content.className = 'locked-area__content gallery-inner rounded-xl overflow-hidden relative';
    content.style.cssText = 'border:1px solid rgba(255,255,255,0.04);cursor:pointer';

    /* Placeholder shown before image loads or when locked */
    const placeholder = `<div class="excl-img-placeholder" style="width:100%;aspect-ratio:1/1;background:radial-gradient(ellipse at center,#0d1b2a,#060e18);display:flex;align-items:center;justify-content:center"><svg width="48" height="48" fill="rgba(0,240,255,0.15)" viewBox="0 0 24 24"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg></div>`;

    content.innerHTML = `
        ${placeholder}
        <img class="excl-img-real" src="" alt="Little Monster" loading="lazy" decoding="async" style="width:100%;display:none;object-fit:cover">
        <div class="gallery-overlay" style="position:absolute;inset:0;display:flex;align-items:flex-end;padding:20px">
            <div>
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                    <h4 style="font-family:'Playfair Display',serif;font-weight:700;font-size:14px;color:rgba(255,255,255,0.9)">Little Monster</h4>
                    <span style="font-size:9px;font-family:'JetBrains Mono',monospace;background:rgba(255,179,0,0.1);color:rgba(255,179,0,0.8);padding:2px 6px;border-radius:10px">MEMBERS</span>
                </div>
                <p style="font-size:10px;color:rgba(255,255,255,0.4);text-transform:capitalize">exclusive</p>
                <span style="display:inline-block;margin-top:6px;font-size:10px;font-family:'JetBrains Mono',monospace;color:#00F0FF">View Full →</span>
            </div>
        </div>`;

    wrapper.appendChild(content);
    wrapper.appendChild(makeOverlay());
    grid.prepend(wrapper);
    lockedAreas.push(wrapper);

    const imgEl = content.querySelector('.excl-img-real');
    const placeholderEl = content.querySelector('.excl-img-placeholder');
    let imageLoaded = false;

    /* Load image from protected endpoint when user logs in */
    function loadImage() {
        if (imageLoaded) return;
        const { loggedIn } = getAuthState();
        if (!loggedIn) return;

        const img = new Image();
        img.crossOrigin = 'use-credentials';
        img.onload = () => {
            imgEl.src = img.src;
            imgEl.style.display = 'block';
            placeholderEl.style.display = 'none';
            imageLoaded = true;
        };
        img.src = '/api/images/little-monster';
    }

    /* Open in gallery modal when clicked (only if logged in) */
    content.addEventListener('click', () => {
        const { loggedIn } = getAuthState();
        if (!loggedIn) { openAuthModal('register'); return; }

        const mi = document.getElementById('modalImage');
        mi.style.background = '#0D1B2A';
        mi.innerHTML = `<img src="/api/images/little-monster" crossorigin="use-credentials" alt="Little Monster" style="width:100%;height:100%;object-fit:contain;display:block">`;
        document.getElementById('modalTitle').textContent = 'Little Monster';
        document.getElementById('modalCaption').textContent = 'An exclusive creature from the BITBI universe — only visible to registered members.';
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    });

    /* React to auth changes */
    document.addEventListener('bitbi:auth-change', () => {
        const { loggedIn } = getAuthState();
        if (loggedIn) {
            loadImage();
        } else {
            /* Reset to placeholder on logout */
            imgEl.src = '';
            imgEl.style.display = 'none';
            placeholderEl.style.display = 'flex';
            imageLoaded = false;
        }
    });

    /* Try loading immediately in case user is already logged in */
    loadImage();
}

/* ── Placement 3: Sound Lab — Exclusive Track player ── */
function setupSoundLabCard() {
    const player = document.getElementById('playlistPlayer');
    if (!player) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'locked-area locked-area--glass';
    wrapper.setAttribute('data-locked', 'true');

    const content = document.createElement('div');
    content.className = 'locked-area__content';
    content.style.cssText = 'padding:16px 20px;display:flex;align-items:center;gap:14px;background:rgba(13,27,42,0.45);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,0.06);border-radius:14px;transition:border-color 0.3s';
    content.innerHTML = `
        <button class="excl-play" aria-label="Play Exclusive Track 01" style="width:40px;height:40px;border-radius:50%;background:rgba(0,240,255,0.07);border:1px solid rgba(0,240,255,0.15);display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;transition:background 0.2s">
            <svg class="excl-pi" width="14" height="14" fill="#00F0FF" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            <svg class="excl-pa" width="14" height="14" fill="#00F0FF" viewBox="0 0 24 24" style="display:none"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
        </button>
        <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                <div style="display:flex;align-items:center;gap:8px;min-width:0">
                    <h4 style="font-family:'Playfair Display',serif;font-weight:600;font-size:14px;color:rgba(255,255,255,0.85);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Exclusive Track 01</h4>
                    <span style="font-size:9px;font-family:'JetBrains Mono',monospace;background:rgba(255,179,0,0.1);color:rgba(255,179,0,0.8);padding:2px 6px;border-radius:10px;flex-shrink:0">MEMBERS</span>
                </div>
                <span class="excl-time" style="font-size:10px;font-family:'JetBrains Mono',monospace;color:rgba(255,255,255,0.2);flex-shrink:0;margin-left:8px">0:00</span>
            </div>
            <div class="excl-bar" style="position:relative;height:3px;background:rgba(255,255,255,0.05);border-radius:2px;overflow:hidden;cursor:pointer">
                <div class="excl-prog" style="position:absolute;left:0;top:0;height:100%;width:0%;background:linear-gradient(90deg,#FFB300,#00F0FF);border-radius:2px;transition:width 0.1s linear"></div>
            </div>
        </div>
        <div class="excl-eq" style="display:flex;align-items:flex-end;gap:2px;height:32px;flex-shrink:0">
            <div class="eq-bar" style="animation:eqBar1 0.8s ease-in-out infinite paused;height:6px"></div>
            <div class="eq-bar" style="animation:eqBar2 0.6s ease-in-out infinite paused;height:12px"></div>
            <div class="eq-bar" style="animation:eqBar3 0.7s ease-in-out infinite paused;height:4px"></div>
            <div class="eq-bar" style="animation:eqBar1 0.9s ease-in-out infinite paused;height:8px"></div>
            <div class="eq-bar" style="animation:eqBar2 0.55s ease-in-out infinite paused;height:10px"></div>
        </div>`;

    wrapper.appendChild(content);
    wrapper.appendChild(makeOverlay());
    player.after(wrapper);
    lockedAreas.push(wrapper);

    /* ── Exclusive track audio player (only works when unlocked) ── */
    let audio = null;
    let playing = false;
    let animFrame = null;

    const playBtn = content.querySelector('.excl-play');
    const playIcon = content.querySelector('.excl-pi');
    const pauseIcon = content.querySelector('.excl-pa');
    const timeEl = content.querySelector('.excl-time');
    const progEl = content.querySelector('.excl-prog');
    const barEl = content.querySelector('.excl-bar');
    const eqBars = content.querySelectorAll('.eq-bar');

    function fmt(s) {
        if (isNaN(s)) return '0:00';
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return m + ':' + (sec < 10 ? '0' : '') + sec;
    }

    function tick() {
        if (!audio) return;
        if (audio.duration) {
            progEl.style.width = (audio.currentTime / audio.duration * 100) + '%';
            timeEl.textContent = fmt(audio.currentTime) + ' / ' + fmt(audio.duration);
        }
        animFrame = requestAnimationFrame(tick);
    }

    function setPlaying(state) {
        playing = state;
        playIcon.style.display = state ? 'none' : '';
        pauseIcon.style.display = state ? '' : 'none';
        eqBars.forEach(b => b.style.animationPlayState = state ? 'running' : 'paused');
        if (state) {
            content.style.borderColor = 'rgba(0,240,255,0.2)';
            content.style.background = 'rgba(0,240,255,0.04)';
        } else {
            content.style.borderColor = 'rgba(255,255,255,0.06)';
            content.style.background = 'rgba(13,27,42,0.45)';
        }
    }

    function ensureAudio() {
        if (audio) return audio;
        audio = new Audio('/api/music/exclusive-track-01');
        audio.crossOrigin = 'use-credentials';
        audio.addEventListener('ended', () => {
            setPlaying(false);
            progEl.style.width = '0%';
            if (animFrame) cancelAnimationFrame(animFrame);
        });
        audio.addEventListener('error', () => {
            setPlaying(false);
            if (animFrame) cancelAnimationFrame(animFrame);
        });
        return audio;
    }

    playBtn.addEventListener('click', () => {
        const { loggedIn } = getAuthState();
        if (!loggedIn) { openAuthModal('register'); return; }

        const a = ensureAudio();
        if (playing) {
            a.pause();
            setPlaying(false);
            if (animFrame) cancelAnimationFrame(animFrame);
        } else {
            a.play();
            setPlaying(true);
            tick();
        }
    });

    barEl.addEventListener('click', (e) => {
        if (!audio || !audio.duration) return;
        const rect = barEl.getBoundingClientRect();
        audio.currentTime = (e.clientX - rect.left) / rect.width * audio.duration;
    });

    content.onmouseenter = () => { if (!playing) content.style.borderColor = 'rgba(0,240,255,0.15)'; };
    content.onmouseleave = () => { if (!playing) content.style.borderColor = 'rgba(255,255,255,0.06)'; };

    /* Reset audio when user logs out */
    document.addEventListener('bitbi:auth-change', () => {
        const { loggedIn } = getAuthState();
        if (!loggedIn && audio) {
            audio.pause();
            audio.src = '';
            audio = null;
            playing = false;
            setPlaying(false);
            progEl.style.width = '0%';
            timeEl.textContent = '0:00';
            if (animFrame) cancelAnimationFrame(animFrame);
        }
    });
}

/* ── Placement 4: Markets — Portfolio Tracker card ── */
function setupMarketsCard() {
    const note = document.querySelector('#markets .section__note');
    if (!note) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'locked-area locked-area--glass';
    wrapper.setAttribute('data-locked', 'true');

    const content = document.createElement('div');
    content.className = 'locked-area__content';
    content.style.cssText = 'padding:20px;min-height:80px;display:flex;align-items:center;gap:14px';
    content.innerHTML = `
        <div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,rgba(255,179,0,0.12),rgba(0,240,255,0.08));border:1px solid rgba(255,179,0,0.2);display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <svg width="16" height="16" fill="rgba(255,179,0,0.8)" viewBox="0 0 24 24"><path d="M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z"/></svg>
        </div>
        <div>
            <h4 style="font-family:'Playfair Display',serif;font-weight:600;font-size:14px;color:rgba(255,255,255,0.85)">Portfolio Tracker</h4>
            <p style="color:rgba(255,255,255,0.35);font-size:11px;margin-top:2px">Track your portfolio and access advanced analytics — members only</p>
        </div>`;

    wrapper.appendChild(content);
    wrapper.appendChild(makeOverlay());
    note.after(wrapper);
    lockedAreas.push(wrapper);
}
