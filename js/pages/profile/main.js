/* ============================================================
   BITBI — Member Profile Page
   Entry point for profile.html
   ============================================================ */

import { initSiteHeader }    from '../../shared/site-header.js';
import { initParticles }     from '../../shared/particles.js';
import { initBinaryRain }    from '../../shared/binary-rain.js';
import { initBinaryFooter }  from '../../shared/binary-footer.js';
import { initScrollReveal }  from '../../shared/scroll-reveal.js';
import { initCookieConsent } from '../../shared/cookie-consent.js';

import { apiGetProfile, apiUpdateProfile, apiLogout, apiUploadAvatar, apiDeleteAvatar, apiRequestReverification, apiGetFavorites, apiRemoveFavorite } from '../../shared/auth-api.js';
import { galleryItems } from '../../shared/gallery-data.js';
import { formatTime } from '../../shared/format-time.js';
import { createAdminAiLab } from '../admin/ai-lab.js?v=20260410-wave10';

/* ── DOM refs ── */
const $loading        = document.getElementById('loadingState');
const $denied         = document.getElementById('deniedState');
const $content        = document.getElementById('profileContent');
const $hero           = document.getElementById('profileHero');
const $heroLabel      = document.getElementById('profileHeroLabel');
const $heroTitle      = document.getElementById('profileHeroTitle');
const $heroDesc       = document.getElementById('profileHeroDesc');
const $homeView       = document.getElementById('profileHomeView');
const $aiLabView      = document.getElementById('profileAiLabView');

const $summaryName    = document.getElementById('summaryName');
const $summaryEmail   = document.getElementById('summaryEmail');
const $summaryRole    = document.getElementById('summaryRole');
const $summaryVerified = document.getElementById('summaryVerified');
const $summarySince   = document.getElementById('summarySince');
const $studioStack    = document.getElementById('profileStudioStack');
const $adminAiLabCard = document.getElementById('profileAdminAiLabCard');
const $aiLabBackBtn   = document.getElementById('profileAiLabBack');
const $aiLabToast     = document.getElementById('profileAiLabToast');

const $form           = document.getElementById('profileForm');
const $displayName    = document.getElementById('displayName');
const $bio            = document.getElementById('bio');
const $website        = document.getElementById('website');
const $youtubeUrl     = document.getElementById('youtubeUrl');
const $submitBtn      = document.getElementById('submitBtn');
const $formMsg        = document.getElementById('formMsg');
const $logoutBtn      = document.getElementById('logoutBtn');

const $avatarImg         = document.getElementById('avatarImg');
const $avatarPlaceholder = document.getElementById('avatarPlaceholder');
const $avatarInput       = document.getElementById('avatarInput');
const $avatarRemoveBtn   = document.getElementById('avatarRemoveBtn');
const $avatarUploadText  = document.getElementById('avatarUploadText');
const $avatarUploadLabel = document.getElementById('avatarUploadLabel');
const $avatarMsg         = document.getElementById('avatarMsg');

const PROFILE_VIEW = 'profile';
const AI_LAB_HASH = 'ai-lab';
let canAccessAdminAiLab = false;

const HERO_CONTENT = {
    [PROFILE_VIEW]: {
        ariaLabel: 'My Profile',
        label: 'Member',
        title: 'My Profile',
        desc: 'View and manage your account',
    },
    [AI_LAB_HASH]: {
        ariaLabel: 'Profile / AI Lab',
        label: 'Profile / AI Lab',
        title: 'AI Lab',
        desc: 'Admin-only testing surface, kept inside your Profile workspace.',
    },
};

function setActiveTab(tab) {
    if (!$content) return;
    $content.dataset.activeTab = tab;

    if (!$tabBar) return;
    $tabBar.querySelectorAll('.profile-tab-btn').forEach(btn => {
        const isActive = btn.dataset.tab === tab;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', String(isActive));
    });
}

function showAiLabToast(message, type = 'success') {
    if (!$aiLabToast || !message) return;

    const item = document.createElement('div');
    item.className = `admin-toast__item admin-toast__item--${type === 'error' ? 'error' : 'success'}`;
    item.textContent = message;
    $aiLabToast.appendChild(item);
    setTimeout(() => item.remove(), 3000);
}

const aiLab = createAdminAiLab({ showToast: showAiLabToast });

function getProfileHashView() {
    return location.hash.replace(/^#/, '').trim().toLowerCase();
}

function applyHeroContent(view) {
    const heroContent = HERO_CONTENT[view] || HERO_CONTENT[PROFILE_VIEW];

    $hero?.setAttribute('aria-label', heroContent.ariaLabel);
    if ($heroLabel) $heroLabel.textContent = heroContent.label;
    if ($heroTitle) $heroTitle.textContent = heroContent.title;
    if ($heroDesc) $heroDesc.textContent = heroContent.desc;
}

function clearAiLabHash() {
    history.replaceState(null, '', `${location.pathname}${location.search}`);
}

function setActiveView(view) {
    const resolvedView = view === AI_LAB_HASH && canAccessAdminAiLab ? AI_LAB_HASH : PROFILE_VIEW;

    if ($content) {
        $content.dataset.activeView = resolvedView;
    }
    if ($homeView) {
        $homeView.hidden = resolvedView !== PROFILE_VIEW;
    }
    if ($aiLabView) {
        $aiLabView.hidden = resolvedView !== AI_LAB_HASH;
    }
    if ($adminAiLabCard) {
        if (resolvedView === AI_LAB_HASH) {
            $adminAiLabCard.setAttribute('aria-current', 'page');
        } else {
            $adminAiLabCard.removeAttribute('aria-current');
        }
    }

    applyHeroContent(resolvedView);

    if (resolvedView === AI_LAB_HASH) {
        setActiveTab('profile');
        aiLab.show();
    }

    return resolvedView;
}

function syncAiLabView() {
    const wantsAiLab = getProfileHashView() === AI_LAB_HASH;

    if (wantsAiLab && !canAccessAdminAiLab) {
        clearAiLabHash();
    }

    setActiveView(wantsAiLab && canAccessAdminAiLab ? AI_LAB_HASH : PROFILE_VIEW);
}

/* ── Mobile tab switcher ── */
const $tabBar = document.getElementById('profileTabBar');
if ($tabBar) {
    $tabBar.addEventListener('click', (e) => {
        const btn = e.target.closest('.profile-tab-btn');
        if (!btn || btn.classList.contains('active')) return;
        setActiveTab(btn.dataset.tab);
    });
}

window.addEventListener('hashchange', syncAiLabView);

/* ── Date formatter ── */
const dtf = new Intl.DateTimeFormat('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
});

function formatDate(iso) {
    if (!iso) return '\u2014';
    return dtf.format(new Date(iso));
}

/* ── Message helpers ── */
function showMsg(text, type) {
    $formMsg.textContent = text;
    $formMsg.className = `profile__msg profile__msg--${type}`;
}

function hideMsg() {
    $formMsg.className = 'profile__msg';
    $formMsg.textContent = '';
}

/* ── Avatar helpers ── */
const AVATAR_URL = '/api/profile/avatar';
const MAX_AVATAR_SIZE = 2 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function showAvatarMsg(text, type) {
    $avatarMsg.textContent = text;
    $avatarMsg.className = `profile__msg profile__msg--${type}`;
}

function hideAvatarMsg() {
    $avatarMsg.className = 'profile__msg';
    $avatarMsg.textContent = '';
}

function loadAvatar(bustCache) {
    const src = bustCache ? `${AVATAR_URL}?t=${Date.now()}` : AVATAR_URL;
    const img = new Image();
    img.onload = () => {
        $avatarImg.src = img.src;
        $avatarImg.style.display = '';
        $avatarPlaceholder.style.display = 'none';
        $avatarRemoveBtn.style.display = '';
    };
    img.onerror = () => {
        $avatarImg.style.display = 'none';
        $avatarPlaceholder.style.display = '';
        $avatarRemoveBtn.style.display = 'none';
    };
    img.src = src;
}

/* ── State switching ── */
function showState(el) {
    $loading.style.display = 'none';
    $denied.style.display = 'none';
    $content.style.display = 'none';
    el.style.display = '';
}

/* ── Render profile data ── */
function renderProfile(profile, account) {
    const isAdmin = account?.role === 'admin';
    canAccessAdminAiLab = isAdmin;

    if ($studioStack) {
        $studioStack.dataset.hasAdminLab = isAdmin ? 'true' : 'false';
    }
    if ($adminAiLabCard) {
        $adminAiLabCard.hidden = !isAdmin;
    }
    syncAiLabView();

    // Summary card
    $summaryName.textContent = profile.display_name || '\u2014';
    $summaryEmail.textContent = account.email;

    $summaryRole.textContent = '';
    const roleBadge = document.createElement('span');
    roleBadge.className = 'profile__badge profile__badge--role';
    roleBadge.textContent = account.role;
    $summaryRole.appendChild(roleBadge);

    $summaryVerified.textContent = '';
    const isLegacy = account.verification_method === 'legacy_auto';
    const isVerified = account.email_verified && !isLegacy;

    const verifiedBadge = document.createElement('span');
    verifiedBadge.className = `profile__badge profile__badge--${isVerified ? 'verified' : isLegacy ? 'legacy' : 'unverified'}`;
    verifiedBadge.textContent = isVerified ? 'Yes' : isLegacy ? 'Pending' : 'No';
    $summaryVerified.appendChild(verifiedBadge);

    if (isLegacy) {
        const verifyLink = document.createElement('button');
        verifyLink.type = 'button';
        verifyLink.className = 'profile__verify-link';
        verifyLink.textContent = 'Verify now';
        verifyLink.addEventListener('click', async () => {
            verifyLink.disabled = true;
            verifyLink.textContent = 'Sending\u2026';
            const res = await apiRequestReverification();
            if (res.ok) {
                verifyLink.textContent = 'Email sent!';
            } else {
                verifyLink.textContent = 'Verify now';
                verifyLink.disabled = false;
            }
        });
        $summaryVerified.appendChild(document.createTextNode(' '));
        $summaryVerified.appendChild(verifyLink);
    }

    $summarySince.textContent = formatDate(account.created_at);

    // Form fields
    $displayName.value = profile.display_name;
    $bio.value = profile.bio;
    $website.value = profile.website;
    $youtubeUrl.value = profile.youtube_url;
}

/* ── Favorites rendering + viewer ── */

const PLACEHOLDER_SVG = `<svg width="24" height="24" fill="rgba(255,255,255,0.08)" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z"/></svg>`;

const R2_PUBLIC_BASE = 'https://pub.bitbi.ai';

/* Map experiment item_ids to URLs */
const EXPERIMENT_URLS = {
    'cosmic-vr': '/experiments/cosmic.html',
    'sound-color': null,
    'sky-fall': '/experiments/skyfall.html',
    'the-gate': '/experiments/king.html',
    'youtube-exclusives': null,
};

/* Map free soundlab slugs to public audio URLs */
const FREE_TRACK_URLS = {
    'cosmic-sea': `${R2_PUBLIC_BASE}/audio/sound-lab/cosmic-sea.mp3`,
    'zufall-und-notwendigkeit': `${R2_PUBLIC_BASE}/audio/sound-lab/zufall-und-notwendigkeit.mp3`,
    'relativity': `${R2_PUBLIC_BASE}/audio/sound-lab/relativity.mp3`,
    'tiny-hearts': `${R2_PUBLIC_BASE}/audio/sound-lab/tiny-hearts.mp3`,
    'grok': `${R2_PUBLIC_BASE}/audio/sound-lab/grok.mp3`,
};

/* Exclusive tracks use /api/music/{slug} */
function getTrackUrl(slug) {
    return FREE_TRACK_URLS[slug] || `/api/music/${slug}`;
}

/* ── Viewer overlay ── */
const $viewer = document.getElementById('favViewer');
const $viewerBody = $viewer ? $viewer.querySelector('.fav-viewer__body') : null;
const $viewerClose = document.getElementById('favViewerClose');
let viewerAudio = null;
let viewerAnimFrame = null;

function openViewer(mode) {
    if (!$viewer) return;
    $viewer.className = `fav-viewer active ${mode || ''}`;
    document.body.style.overflow = 'hidden';
}

function closeViewer() {
    if (!$viewer) return;
    $viewer.classList.remove('active');
    document.body.style.overflow = '';
    /* Cleanup audio */
    if (viewerAudio) {
        viewerAudio.pause();
        viewerAudio.src = '';
        viewerAudio = null;
    }
    if (viewerAnimFrame) {
        cancelAnimationFrame(viewerAnimFrame);
        viewerAnimFrame = null;
    }
    /* Cleanup iframe */
    const iframe = $viewerBody.querySelector('iframe');
    if (iframe) iframe.src = '';
    /* Clear body */
    $viewerBody.innerHTML = '';
    $viewer.className = 'fav-viewer';
    /* Reset star */
    viewerCurrentFav = null;
    $viewerStar.style.display = 'none';
}

if ($viewerClose) $viewerClose.addEventListener('click', closeViewer);
if ($viewer) {
    $viewer.querySelector('.fav-viewer__backdrop').addEventListener('click', closeViewer);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && $viewer.classList.contains('active')) closeViewer();
    });
}

/* ── Viewer favorite star (remove-from-viewer) ── */
let viewerCurrentFav = null;
const $viewerStar = document.createElement('button');
$viewerStar.type = 'button';
$viewerStar.className = 'fav-star fav-star--active fav-viewer__fav-star';
$viewerStar.setAttribute('aria-pressed', 'true');
$viewerStar.setAttribute('aria-label', 'Remove from favorites');
$viewerStar.innerHTML = '<svg class="fav-star__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z"/></svg>';
$viewerStar.style.display = 'none';
if ($viewer) $viewer.appendChild($viewerStar);

let viewerStarBusyFav = null;

$viewerStar.addEventListener('click', async () => {
    if (!viewerCurrentFav || viewerStarBusyFav === viewerCurrentFav) return;
    const fav = viewerCurrentFav;
    viewerStarBusyFav = fav;

    /* Optimistic UI */
    $viewerStar.classList.remove('fav-star--active');
    $viewerStar.setAttribute('aria-pressed', 'false');
    $viewerStar.setAttribute('aria-label', 'Removed from favorites');

    const res = await apiRemoveFavorite(fav.item_type, fav.item_id);
    if (viewerStarBusyFav === fav) viewerStarBusyFav = null;

    /* Only mutate state if viewer still shows the same item */
    const stale = viewerCurrentFav !== fav;

    if (res.ok) {
        removeFavTile(fav.item_type, fav.item_id);
        if (!stale) viewerCurrentFav = null;
    } else if (!stale) {
        /* Revert only if still viewing the same item */
        $viewerStar.classList.add('fav-star--active');
        $viewerStar.setAttribute('aria-pressed', 'true');
        $viewerStar.setAttribute('aria-label', 'Remove from favorites');
    }
});

function removeFavTile(type, id) {
    const tile = document.querySelector(`.fav-tile[data-fav-key="${type}:${id}"]`);
    if (!tile) return;
    const grid = tile.parentElement;
    tile.remove();
    if (grid && grid.children.length === 0) {
        const container = grid.parentElement;
        const toggle = container.querySelector('.favorites__toggle');
        if (toggle) toggle.remove();
        grid.remove();
        const empty = document.createElement('p');
        empty.className = 'favorites__empty';
        empty.textContent = 'No favorites yet';
        container.appendChild(empty);
    } else if (grid) {
        const container = grid.parentElement;
        const toggle = container.querySelector('.favorites__toggle');
        if (toggle && grid.children.length <= 4) {
            Array.from(grid.children).forEach(t => { t.style.display = ''; });
            toggle.remove();
        } else if (toggle && toggle.getAttribute('aria-expanded') === 'false') {
            Array.from(grid.children).forEach((t, i) => { t.style.display = i < 4 ? '' : 'none'; });
        }
    }
}

/* ── Open gallery image in viewer ── */
function openGalleryInViewer(fav) {
    const item = galleryItems.find(g => g.id === fav.item_id);
    const previewUrl = item ? item.preview.url : fav.thumb_url;
    const caption = item ? item.caption : '';
    const fullUrl = item && item.full ? item.full.url : '';

    let fullLinkHtml = '';
    if (fullUrl) {
        fullLinkHtml = `<a class="fav-viewer__full-link" href="${fullUrl}" target="_blank" rel="noopener noreferrer">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            Open full size
        </a>`;
    }

    $viewerBody.innerHTML = `
        <div class="fav-viewer__card">
            <div class="fav-viewer__image">
                <img src="${previewUrl}" alt="${fav.title}" style="background:#0D1B2A">
            </div>
            <div class="fav-viewer__info">
                <h3 class="fav-viewer__title">${fav.title}</h3>
                ${caption ? `<p class="fav-viewer__caption">${caption}</p>` : ''}
                ${fullLinkHtml}
            </div>
        </div>`;
    openViewer('');
}

/* ── Open experiment in viewer ── */
function openExperimentInViewer(fav) {
    const url = EXPERIMENT_URLS[fav.item_id];
    if (!url) {
        /* Experiments without iframeable content (sound-color, youtube-exclusives) — show info card */
        $viewerBody.innerHTML = `
            <div class="fav-viewer__card">
                <div class="fav-viewer__image" style="display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at center,#0d1b3e,#050a15)">
                    <svg width="48" height="48" fill="rgba(0,240,255,0.2)" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
                </div>
                <div class="fav-viewer__info">
                    <h3 class="fav-viewer__title">${fav.title}</h3>
                    <p class="fav-viewer__caption">This experiment is available on the main page.</p>
                    <a class="fav-viewer__full-link" href="/#experiments">View on main page \u2192</a>
                </div>
            </div>`;
        openViewer('');
        return;
    }
    $viewerBody.innerHTML = `<iframe class="fav-viewer__frame" src="${url}" allow="accelerometer;gyroscope" title="${fav.title}"></iframe>`;
    openViewer('fav-viewer--experiment');
}

/* ── Open soundlab track in viewer ── */
function openSoundlabInViewer(fav) {
    const audioUrl = getTrackUrl(fav.item_id);
    const thumbUrl = fav.thumb_url || '';
    const isExclusive = !FREE_TRACK_URLS[fav.item_id];

    let heroHtml;
    if (thumbUrl) {
        heroHtml = `<img src="${thumbUrl}" alt="${fav.title}"${thumbUrl.startsWith('/api/') ? ' crossorigin="use-credentials"' : ''}>`;
    } else {
        heroHtml = `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at 30% 40%,rgba(255,179,0,0.08),transparent 60%),#060e18"><svg width="48" height="48" fill="rgba(255,179,0,0.2)" viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg></div>`;
    }

    $viewerBody.innerHTML = `
        <div class="fav-viewer__player">
            <div class="fav-viewer__player-hero">${heroHtml}</div>
            <div class="fav-viewer__player-controls">
                <button type="button" class="fav-viewer__play-btn" id="fvPlay" aria-label="Play ${fav.title}">
                    <svg id="fvPlayIcon" width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                    <svg id="fvPauseIcon" width="18" height="18" fill="currentColor" viewBox="0 0 24 24" style="display:none"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                </button>
                <div class="fav-viewer__track-info">
                    <div class="fav-viewer__track-title">${fav.title}</div>
                    <div class="fav-viewer__track-time" id="fvTime">0:00</div>
                    <div class="fav-viewer__progress" id="fvBar">
                        <div class="fav-viewer__progress-fill" id="fvProg"></div>
                    </div>
                </div>
            </div>
        </div>`;

    openViewer('');

    /* Wire up audio */
    viewerAudio = new Audio();
    if (isExclusive) {
        viewerAudio.crossOrigin = 'use-credentials';
    }
    viewerAudio.src = audioUrl;
    viewerAudio.volume = 0.8;

    const playBtn = document.getElementById('fvPlay');
    const playIcon = document.getElementById('fvPlayIcon');
    const pauseIcon = document.getElementById('fvPauseIcon');
    const timeEl = document.getElementById('fvTime');
    const progEl = document.getElementById('fvProg');
    const barEl = document.getElementById('fvBar');

    function tick() {
        if (!viewerAudio) return;
        if (viewerAudio.duration) {
            progEl.style.width = (viewerAudio.currentTime / viewerAudio.duration * 100) + '%';
            timeEl.textContent = formatTime(viewerAudio.currentTime) + ' / ' + formatTime(viewerAudio.duration);
        }
        if (!viewerAudio.paused) {
            viewerAnimFrame = requestAnimationFrame(tick);
        }
    }

    playBtn.addEventListener('click', () => {
        if (!viewerAudio) return;
        if (viewerAudio.paused) {
            viewerAudio.play().catch(() => {});
            playIcon.style.display = 'none';
            pauseIcon.style.display = '';
            viewerAnimFrame = requestAnimationFrame(tick);
        } else {
            viewerAudio.pause();
            playIcon.style.display = '';
            pauseIcon.style.display = 'none';
        }
    });

    viewerAudio.addEventListener('ended', () => {
        playIcon.style.display = '';
        pauseIcon.style.display = 'none';
        progEl.style.width = '0%';
    });

    barEl.addEventListener('click', (e) => {
        if (!viewerAudio || !viewerAudio.duration) return;
        const rect = barEl.getBoundingClientRect();
        viewerAudio.currentTime = ((e.clientX - rect.left) / rect.width) * viewerAudio.duration;
    });
}

/* ── Build favorite tiles ── */
function renderFavorites(favorites) {
    const groups = { experiments: [], gallery: [], soundlab: [] };
    for (const f of favorites) {
        if (groups[f.item_type]) groups[f.item_type].push(f);
    }

    for (const [type, items] of Object.entries(groups)) {
        const container = document.querySelector(`[data-favorites-type="${type}"]`);
        if (!container) continue;

        const label = container.querySelector('.favorites__group-label');
        container.innerHTML = '';
        if (label) container.appendChild(label);

        if (items.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'favorites__empty';
            empty.textContent = 'No favorites yet';
            container.appendChild(empty);
            continue;
        }

        const grid = document.createElement('div');
        grid.className = 'favorites__grid';

        for (const fav of items) {
            const tile = document.createElement('div');
            tile.className = 'fav-tile fav-tile--interactive';
            tile.setAttribute('role', 'button');
            tile.setAttribute('tabindex', '0');
            tile.dataset.favKey = `${fav.item_type}:${fav.item_id}`;
            tile.title = fav.title;

            tile.addEventListener('click', () => handleTileClick(fav));
            tile.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleTileClick(fav); }
            });

            if (fav.thumb_url) {
                const img = document.createElement('img');
                img.className = 'fav-tile__img';
                img.src = fav.thumb_url;
                img.alt = fav.title;
                img.loading = 'lazy';
                img.decoding = 'async';
                if (fav.thumb_url.startsWith('/api/')) {
                    img.crossOrigin = 'use-credentials';
                }
                img.onerror = function () {
                    this.onerror = null;
                    this.style.display = 'none';
                    const ph = document.createElement('div');
                    ph.className = 'fav-tile__placeholder';
                    ph.innerHTML = PLACEHOLDER_SVG;
                    this.parentElement.insertBefore(ph, this);
                };
                tile.appendChild(img);
            } else {
                const ph = document.createElement('div');
                ph.className = 'fav-tile__placeholder';
                ph.innerHTML = PLACEHOLDER_SVG;
                tile.appendChild(ph);
            }

            const lbl = document.createElement('div');
            lbl.className = 'fav-tile__label';
            lbl.textContent = fav.title;
            tile.appendChild(lbl);

            grid.appendChild(tile);
        }

        container.appendChild(grid);

        /* Collapse to 4 items if more exist */
        const LIMIT = 4;
        if (items.length > LIMIT) {
            const tiles = Array.from(grid.children);
            tiles.forEach((t, i) => { if (i >= LIMIT) t.style.display = 'none'; });

            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'favorites__toggle';
            toggle.setAttribute('aria-expanded', 'false');
            toggle.innerHTML = '<svg class="favorites__toggle-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg> Show all';

            toggle.addEventListener('click', () => {
                const expanded = toggle.getAttribute('aria-expanded') === 'true';
                const allTiles = Array.from(grid.children);
                if (expanded) {
                    allTiles.forEach((t, i) => { if (i >= LIMIT) t.style.display = 'none'; });
                    toggle.setAttribute('aria-expanded', 'false');
                    toggle.innerHTML = '<svg class="favorites__toggle-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg> Show all';
                } else {
                    allTiles.forEach(t => { t.style.display = ''; });
                    toggle.setAttribute('aria-expanded', 'true');
                    toggle.innerHTML = '<svg class="favorites__toggle-arrow favorites__toggle-arrow--up" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg> Show less';
                }
            });

            container.appendChild(toggle);
        }
    }
}

function handleTileClick(fav) {
    viewerCurrentFav = fav;
    $viewerStar.classList.add('fav-star--active');
    $viewerStar.setAttribute('aria-pressed', 'true');
    $viewerStar.setAttribute('aria-label', 'Remove from favorites');
    $viewerStar.style.display = '';

    switch (fav.item_type) {
        case 'gallery': openGalleryInViewer(fav); break;
        case 'experiments': openExperimentInViewer(fav); break;
        case 'soundlab': openSoundlabInViewer(fav); break;
    }
}

/* ── Init ── */
async function init() {
    // Shared header (nav, mobile menu, auth)
    try { initSiteHeader(); } catch (e) { console.warn(e); }

    // Visual modules (non-blocking)
    try { initParticles('heroCanvas'); }      catch (e) { console.warn(e); }
    try { initBinaryRain('binaryRain'); }     catch (e) { console.warn(e); }
    try { initBinaryFooter('binaryFooter'); } catch (e) { console.warn(e); }
    try { initScrollReveal(); }               catch (e) { console.warn(e); }
    try { initCookieConsent(); }              catch (e) { console.warn(e); }

    // Load profile (doubles as auth check — returns 401 if not logged in)
    const res = await apiGetProfile();

    if (!res.ok) {
        showState($denied);
        $denied.classList.add('visible');
        return;
    }

    // Show profile content
    showState($content);
    renderProfile(res.data.profile, res.data.account);
    loadAvatar(false);

    // Load and render favorites
    apiGetFavorites().then(favRes => {
        if (favRes.ok && Array.isArray(favRes.data?.favorites)) {
            renderFavorites(favRes.data.favorites);
        }
    }).catch(e => console.warn('favorites:', e));

    if ($aiLabBackBtn) {
        $aiLabBackBtn.addEventListener('click', () => {
            setActiveTab('profile');
            clearAiLabHash();
            syncAiLabView();
            $adminAiLabCard?.focus();
        });
    }

    // Avatar upload
    $avatarInput.addEventListener('change', async () => {
        const file = $avatarInput.files[0];
        if (!file) return;

        hideAvatarMsg();

        if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
            showAvatarMsg('Invalid file type. Allowed: JPEG, PNG, WebP.', 'error');
            $avatarInput.value = '';
            return;
        }
        if (file.size > MAX_AVATAR_SIZE) {
            showAvatarMsg('File too large. Maximum size is 2 MB.', 'error');
            $avatarInput.value = '';
            return;
        }

        $avatarUploadLabel.style.pointerEvents = 'none';
        $avatarUploadLabel.style.opacity = '0.5';
        $avatarUploadText.textContent = 'Uploading\u2026';

        const result = await apiUploadAvatar(file);

        $avatarUploadLabel.style.pointerEvents = '';
        $avatarUploadLabel.style.opacity = '';
        $avatarUploadText.textContent = 'Change Photo';
        $avatarInput.value = '';

        if (result.ok) {
            showAvatarMsg('Photo updated.', 'success');
            loadAvatar(true);
        } else {
            showAvatarMsg(result.error, 'error');
        }
    });

    // Avatar remove
    $avatarRemoveBtn.addEventListener('click', async () => {
        hideAvatarMsg();
        $avatarRemoveBtn.disabled = true;
        $avatarRemoveBtn.textContent = 'Removing\u2026';

        const result = await apiDeleteAvatar();

        $avatarRemoveBtn.disabled = false;
        $avatarRemoveBtn.textContent = 'Remove';

        if (result.ok) {
            showAvatarMsg('Photo removed.', 'success');
            loadAvatar(true);
        } else {
            showAvatarMsg(result.error, 'error');
        }
    });

    // Form submission
    $form.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideMsg();

        $submitBtn.disabled = true;
        $submitBtn.textContent = 'Saving...';

        const result = await apiUpdateProfile({
            display_name: $displayName.value,
            bio: $bio.value,
            website: $website.value,
            youtube_url: $youtubeUrl.value,
        });

        $submitBtn.disabled = false;
        $submitBtn.textContent = 'Save Changes';

        if (result.ok) {
            showMsg('Profile updated.', 'success');
            $summaryName.textContent = $displayName.value.trim() || '\u2014';
        } else {
            showMsg(result.error, 'error');
        }
    });

    // Logout button
    $logoutBtn.addEventListener('click', async () => {
        await apiLogout();
        window.location.href = '/';
    });
}

init();
