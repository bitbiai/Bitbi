/* ============================================================
   BITBI — Admin Dashboard
   Entry point for admin/index.html
   ============================================================ */

// Keep these versioned admin imports aligned with admin/index.html and the admin release-token checklist in CLAUDE.md.
import { initSiteHeader }    from '../../shared/site-header.js?v=20260410-wave10';
import { initParticles }     from '../../shared/particles.js?v=20260410-wave10';
import { initBinaryRain }    from '../../shared/binary-rain.js?v=20260410-wave10';
import { initBinaryFooter }  from '../../shared/binary-footer.js?v=20260410-wave10';
import { initScrollReveal }  from '../../shared/scroll-reveal.js?v=20260410-wave10';
import { initCookieConsent } from '../../shared/cookie-consent.js?v=20260410-wave10';

import {
    apiAdminMe,
    apiAdminUsers,
    apiAdminChangeRole,
    apiAdminChangeStatus,
    apiAdminRevokeSessions,
    apiAdminDeleteUser,
    apiAdminLatestAvatars,
    apiAdminStats,
    apiAdminActivity,
    apiAdminUserActivity,
} from '../../shared/auth-api.js?v=20260412-wave15';
import { galleryItems } from '../../shared/gallery-data.js?v=20260410-wave10';
import { createAdminAiLab } from './ai-lab.js?v=20260412-wave15';

/* ═══════════════════════════════════════════════════════════
   DOM refs
   ═══════════════════════════════════════════════════════════ */

const $denied      = document.getElementById('adminDenied');
const $panel       = document.getElementById('adminPanel');
const $toast       = document.getElementById('adminToast');
const $adminNav    = document.getElementById('adminNav');
const $heroTitle   = document.getElementById('adminHeroTitle');
const $heroDesc    = document.getElementById('adminHeroDesc');

/* Users section refs */
const $loading     = document.getElementById('loadingState');
const $empty       = document.getElementById('emptyState');
const $table       = document.getElementById('userTable');
const $tbody       = document.getElementById('userTbody');
const $mobileList  = document.getElementById('userMobileList');
const $mobileSec   = document.getElementById('mobileSection');
const $searchForm  = document.getElementById('searchForm');
const $searchInput = document.getElementById('searchInput');

/* Avatar dropdown refs */
const $avatarDropdown = document.getElementById('avatarDropdown');
const $avatarToggle   = document.getElementById('avatarToggle');
const $avatarGrid     = document.getElementById('avatarGrid');

/* Lightbox refs */
const $lightbox      = document.getElementById('avatarLightbox');
const $lightboxImg   = document.getElementById('lightboxImg');
const $lightboxName  = document.getElementById('lightboxName');
const $lightboxEmail = document.getElementById('lightboxEmail');

/* Section containers */
const sections = {
    dashboard: document.getElementById('sectionDashboard'),
    users:     document.getElementById('sectionUsers'),
    content:   document.getElementById('sectionContent'),
    media:     document.getElementById('sectionMedia'),
    'ai-lab':  document.getElementById('sectionAiLab'),
    access:    document.getElementById('sectionAccess'),
    activity:  document.getElementById('sectionActivity'),
};

/* Section metadata for hero */
const sectionMeta = {
    dashboard: { title: 'Dashboard',        desc: 'System overview and quick actions' },
    users:     { title: 'User Management',  desc: 'Manage users, roles, and sessions' },
    content:   { title: 'Content',          desc: 'Site content entries and publishing' },
    media:     { title: 'Media Library',    desc: 'Assets, images, audio, and video files' },
    'ai-lab':  { title: 'AI Lab',           desc: 'Admin-only AI tests, previews, and model comparisons' },
    access:    { title: 'Access Control',   desc: 'Membership gating and role-based access' },
    activity:  { title: 'Activity',         desc: 'Audit trail and admin actions' },
};

/* ═══════════════════════════════════════════════════════════
   Toast
   ═══════════════════════════════════════════════════════════ */
function showToast(message, type = 'success') {
    const el = document.createElement('div');
    el.className = `admin-toast__item admin-toast__item--${type}`;
    el.textContent = message;
    $toast.appendChild(el);
    setTimeout(() => { el.remove(); }, 3000);
}

const aiLab = createAdminAiLab({ showToast });

/* ═══════════════════════════════════════════════════════════
   Date formatter
   ═══════════════════════════════════════════════════════════ */
const dtf = new Intl.DateTimeFormat('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
});

function formatDate(iso) {
    if (!iso) return '\u2014';
    return dtf.format(new Date(iso));
}

/* ═══════════════════════════════════════════════════════════
   Render helpers
   ═══════════════════════════════════════════════════════════ */
function createBadge(text, variant) {
    const span = document.createElement('span');
    span.className = `badge badge--${variant}`;
    span.textContent = text;
    return span;
}

function createActionBtn(label, onClick, danger) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-action' + (danger ? ' btn-action--danger' : '');
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
}

/* ═══════════════════════════════════════════════════════════
   Section Routing
   ═══════════════════════════════════════════════════════════ */
let currentSection = 'dashboard';
let dashboardVersion = 0;
let usersVersion = 0;
let statsCache = null;    // { stats, fetchedAt }
const STATS_TTL = 30_000; // 30 seconds

let activityVersion = 0;
let activityMode = 'admin'; // 'admin' | 'user'
let activityEntries = [];   // all loaded entries for current mode
let activityNextCursor = null;
let activityExpanded = false;
let activitySearchTimer = null;
const ACTIVITY_LIMIT = 50;
const ACTIVITY_VISIBLE = 10;
let contentLoaded = false;
let mediaLoaded = false;
let accessLoaded = false;
let adminNavOffsetObserver = null;

const ADMIN_ACTION_LABELS = {
    change_role: 'Role Change',
    change_status: 'Status Change',
    revoke_sessions: 'Sessions Revoked',
    delete_user: 'User Deleted',
};
const ADMIN_ACTION_VARIANTS = {
    change_role: 'user',
    change_status: 'legacy',
    revoke_sessions: 'disabled',
    delete_user: 'disabled',
};
const USER_ACTION_LABELS = {
    register: 'Registration',
    login: 'Login',
    logout: 'Logout',
    verify_email: 'Email Verified',
    reset_password: 'Password Reset',
    update_profile: 'Profile Update',
    upload_avatar: 'Avatar Upload',
    delete_avatar: 'Avatar Deleted',
};
const USER_ACTION_VARIANTS = {
    register: 'active',
    login: 'user',
    logout: 'legacy',
    verify_email: 'active',
    reset_password: 'admin',
    update_profile: 'user',
    upload_avatar: 'user',
    delete_avatar: 'disabled',
};

function syncAdminNavOffset() {
    const siteNav = document.querySelector('header .site-nav');
    if (!siteNav) return;

    const navHeight = Math.ceil(siteNav.getBoundingClientRect().height);
    if (navHeight > 0) {
        document.documentElement.style.setProperty('--admin-nav-top-offset', `${navHeight}px`);
    }
}

function initAdminNavOffset() {
    syncAdminNavOffset();

    const siteNav = document.querySelector('header .site-nav');
    if (siteNav && 'ResizeObserver' in window) {
        adminNavOffsetObserver?.disconnect?.();
        adminNavOffsetObserver = new ResizeObserver(() => syncAdminNavOffset());
        adminNavOffsetObserver.observe(siteNav);
    }

    window.addEventListener('resize', syncAdminNavOffset);
    window.visualViewport?.addEventListener?.('resize', syncAdminNavOffset);
}

function showSection(name) {
    if (!sections[name]) name = 'dashboard';
    currentSection = name;

    // Toggle section visibility
    for (const [key, el] of Object.entries(sections)) {
        el.style.display = key === name ? '' : 'none';
    }

    // Update nav active state
    document.querySelectorAll('.admin-nav__link').forEach(link => {
        const isActive = link.dataset.section === name;
        link.classList.toggle('admin-nav__link--active', isActive);
    });

    // Update hero
    const meta = sectionMeta[name];
    if (meta) {
        $heroTitle.textContent = meta.title;
        $heroDesc.textContent = meta.desc;
    }

    // Load section data
    if (name === 'dashboard') loadDashboard();
    if (name === 'users') loadUsers($searchInput.value.trim());
    if (name === 'activity') loadActivity();
    if (name === 'content' && !contentLoaded) { loadContent(); contentLoaded = true; }
    if (name === 'media' && !mediaLoaded) { loadMedia(); mediaLoaded = true; }
    if (name === 'ai-lab') aiLab.show();
    if (name === 'access' && !accessLoaded) { loadAccess(); accessLoaded = true; }
}

function initRouting() {
    // Handle hash navigation
    function onHashChange() {
        const hash = location.hash.replace('#', '') || 'dashboard';
        showSection(hash);
    }

    window.addEventListener('hashchange', onHashChange);

    // Handle quick-link clicks (they set hash, hashchange fires)
    document.querySelectorAll('.admin-quick-link[data-nav]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            location.hash = link.dataset.nav;
        });
    });

    // Initial section from URL hash
    onHashChange();
}

/* ═══════════════════════════════════════════════════════════
   Dashboard
   ═══════════════════════════════════════════════════════════ */
function renderStats(s, $updated, fetchedAt) {
    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val ?? '\u2014';
    };
    setVal('statTotal', s.totalUsers);
    setVal('statActive', s.activeUsers);
    setVal('statAdmins', s.admins);
    setVal('statVerified', s.verifiedUsers);
    setVal('statDisabled', s.disabledUsers);
    setVal('statRecent', s.recentRegistrations);
    if ($updated) {
        const ts = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(fetchedAt);
        $updated.textContent = `Last updated: ${ts}`;
    }
}

async function loadDashboard() {
    const $updated = document.getElementById('statsUpdated');

    // Serve from cache if fresh
    if (statsCache && (Date.now() - statsCache.fetchedAt < STATS_TTL)) {
        renderStats(statsCache.stats, $updated, statsCache.fetchedAt);
        return;
    }

    const myVersion = ++dashboardVersion;

    // Clear card values to loading state before fetch
    const statIds = ['statTotal', 'statActive', 'statAdmins', 'statVerified', 'statDisabled', 'statRecent'];
    for (const id of statIds) {
        const el = document.getElementById(id);
        if (el) el.textContent = '\u2014';
    }
    if ($updated) $updated.textContent = 'Refreshing\u2026';

    const statsRes = await apiAdminStats();

    // Ignore stale response if a newer load occurred
    if (myVersion !== dashboardVersion) return;

    if (statsRes.ok) {
        const s = statsRes.data?.stats || statsRes.data || {};
        const now = Date.now();
        statsCache = { stats: s, fetchedAt: now };
        renderStats(s, $updated, now);
    } else {
        if ($updated) $updated.textContent = 'Failed to load stats';
        showToast('Failed to load dashboard stats.', 'error');
    }
}

/* ═══════════════════════════════════════════════════════════
   Activity
   ═══════════════════════════════════════════════════════════ */
function formatAdminMeta(action, metaJson) {
    try {
        const meta = JSON.parse(metaJson || '{}');
        switch (action) {
            case 'change_role':      return `New role: ${meta.role || '\u2014'}`;
            case 'change_status':    return `New status: ${meta.status || '\u2014'}`;
            case 'revoke_sessions':  return `${meta.revokedSessions || 0} sessions revoked`;
            case 'delete_user': {
                const parts = [];
                if (meta.target_role) parts.push(`was ${meta.target_role}`);
                if (meta.target_status && meta.target_status !== 'active') parts.push(meta.target_status);
                return parts.length ? `Account deleted (${parts.join(', ')})` : 'Account deleted';
            }
            default:                 return Object.entries(meta).map(([k, v]) => `${k}: ${v}`).join(', ') || '\u2014';
        }
    } catch { return '\u2014'; }
}

function formatUserMeta(action, metaJson) {
    try {
        const meta = JSON.parse(metaJson || '{}');
        switch (action) {
            case 'register':        return meta.email || '\u2014';
            case 'update_profile':  return meta.fields ? `Updated: ${meta.fields.join(', ')}` : '\u2014';
            case 'upload_avatar':   return meta.type || '\u2014';
            default:                return '\u2014';
        }
    } catch { return '\u2014'; }
}

function buildAdminRow(entry) {
    const tr = document.createElement('tr');
    const tdTime = document.createElement('td');
    tdTime.textContent = formatDate(entry.created_at);
    tr.appendChild(tdTime);

    const tdAdmin = document.createElement('td');
    tdAdmin.textContent = entry.admin_email || (entry.admin_user_id?.slice(0, 8) + '\u2026');
    tr.appendChild(tdAdmin);

    const tdAction = document.createElement('td');
    tdAction.appendChild(createBadge(
        ADMIN_ACTION_LABELS[entry.action] || entry.action,
        ADMIN_ACTION_VARIANTS[entry.action] || 'user',
    ));
    tr.appendChild(tdAction);

    const tdTarget = document.createElement('td');
    tdTarget.textContent = entry.target_email || (entry.target_user_id ? entry.target_user_id.slice(0, 8) + '\u2026' : '\u2014');
    tr.appendChild(tdTarget);

    const tdDetails = document.createElement('td');
    tdDetails.className = 'hide-mobile';
    tdDetails.textContent = formatAdminMeta(entry.action, entry.meta_json);
    tr.appendChild(tdDetails);
    return tr;
}

function buildUserRow(entry) {
    const tr = document.createElement('tr');
    const tdTime = document.createElement('td');
    tdTime.textContent = formatDate(entry.created_at);
    tr.appendChild(tdTime);

    const tdUser = document.createElement('td');
    tdUser.textContent = entry.user_email || (entry.user_id?.slice(0, 8) + '\u2026');
    tr.appendChild(tdUser);

    const tdAction = document.createElement('td');
    tdAction.appendChild(createBadge(
        USER_ACTION_LABELS[entry.action] || entry.action,
        USER_ACTION_VARIANTS[entry.action] || 'user',
    ));
    tr.appendChild(tdAction);

    const tdDetails = document.createElement('td');
    tdDetails.textContent = formatUserMeta(entry.action, entry.meta_json);
    tr.appendChild(tdDetails);
    return tr;
}

function renderActivityEntries() {
    const $tbody = document.getElementById('activityTbody');
    const $tbodyMore = document.getElementById('activityTbodyMore');
    const $table = document.getElementById('activityTable');
    const $expand = document.getElementById('activityExpand');
    const $expandLabel = document.getElementById('activityExpandLabel');
    const $loadMore = document.getElementById('activityLoadMore');
    const $empty = document.getElementById('activityEmpty');

    $tbody.replaceChildren();
    $tbodyMore.replaceChildren();

    if (activityEntries.length === 0) {
        $table.style.display = 'none';
        $expand.style.display = 'none';
        $empty.style.display = '';
        return;
    }

    $empty.style.display = 'none';
    $table.style.display = '';

    const buildRow = activityMode === 'admin' ? buildAdminRow : buildUserRow;

    // Top 10 visible
    const visible = activityEntries.slice(0, ACTIVITY_VISIBLE);
    for (const entry of visible) {
        $tbody.appendChild(buildRow(entry));
    }

    // Remaining behind expand
    const rest = activityEntries.slice(ACTIVITY_VISIBLE);
    if (rest.length > 0 || activityNextCursor) {
        $expand.style.display = '';
        $expandLabel.textContent = activityExpanded
            ? 'Hide older entries'
            : `Show ${rest.length} more entr${rest.length === 1 ? 'y' : 'ies'}`;

        for (const entry of rest) {
            $tbodyMore.appendChild(buildRow(entry));
        }

        // Load more button (cursor pagination within expanded area)
        if (activityNextCursor) {
            $loadMore.style.display = '';
        } else {
            $loadMore.style.display = 'none';
        }

        // Restore expanded state
        const $expandWrap = document.getElementById('activityExpand');
        if (activityExpanded) {
            $expandWrap.classList.add('admin-activity-expand--open');
        } else {
            $expandWrap.classList.remove('admin-activity-expand--open');
        }
    } else {
        $expand.style.display = 'none';
    }
}

async function loadActivity(appendMode) {
    const $loading = document.getElementById('activityLoading');
    const $empty = document.getElementById('activityEmpty');
    const $table = document.getElementById('activityTable');

    const myVersion = ++activityVersion;
    const searchVal = document.getElementById('activitySearch')?.value.trim() || '';

    if (!appendMode) {
        activityEntries = [];
        activityNextCursor = null;
        activityExpanded = false;
        $loading.style.display = '';
        $empty.style.display = 'none';
        $table.style.display = 'none';
        document.getElementById('activityExpand').style.display = 'none';
    }

    const cursor = appendMode ? activityNextCursor : null;
    const fetchFn = activityMode === 'admin' ? apiAdminActivity : apiAdminUserActivity;
    const res = await fetchFn(ACTIVITY_LIMIT, cursor, searchVal || undefined);

    if (myVersion !== activityVersion) return;
    $loading.style.display = 'none';

    if (!res.ok) {
        showToast('Failed to load activity log.', 'error');
        return;
    }

    const { entries, nextCursor, counts, unavailable, reason } = res.data || {};
    activityNextCursor = nextCursor || null;

    // Handle schema-unavailable gracefully (migration 0012 not applied)
    if (unavailable) {
        const $empty = document.getElementById('activityEmpty');
        $empty.textContent = reason || 'User activity logging is not yet available.';
        $empty.style.display = '';
        document.getElementById('activitySummaryArea').style.display = 'none';
        return;
    }

    if (appendMode) {
        activityEntries = activityEntries.concat(entries || []);
    } else {
        activityEntries = entries || [];
    }

    // Summary cards (admin mode only)
    const $summaryArea = document.getElementById('activitySummaryArea');
    if (activityMode === 'admin') {
        $summaryArea.style.display = '';
        renderActivitySummary(counts || {});
    } else {
        $summaryArea.style.display = 'none';
    }

    renderActivityEntries();
}

function renderActivitySummary(counts) {
    const summaryEl = document.getElementById('activitySummary');
    if (summaryEl) {
        let html = '<div class="admin-inventory">';
        html += `<div class="admin-inventory__row"><span class="admin-inventory__name">Role changes</span><span class="admin-inventory__count">${counts.change_role || 0}</span></div>`;
        html += `<div class="admin-inventory__row"><span class="admin-inventory__name">Status changes</span><span class="admin-inventory__count">${counts.change_status || 0}</span></div>`;
        html += '</div>';
        summaryEl.innerHTML = html;
    }

    const securityEl = document.getElementById('securitySummary');
    if (securityEl) {
        let html = '<div class="admin-inventory">';
        html += `<div class="admin-inventory__row"><span class="admin-inventory__name">Sessions revoked</span><span class="admin-inventory__count">${counts.revoke_sessions || 0}</span></div>`;
        html += `<div class="admin-inventory__row"><span class="admin-inventory__name">Users deleted</span><span class="admin-inventory__count">${counts.delete_user || 0}</span></div>`;
        html += '</div>';
        securityEl.innerHTML = html;
    }
}

function switchActivityMode(mode) {
    if (mode === activityMode) return;
    activityMode = mode;

    // Update mode buttons
    document.querySelectorAll('.admin-activity-mode').forEach(btn => {
        btn.classList.toggle('admin-activity-mode--active', btn.dataset.mode === mode);
    });

    // Update title/desc and table headers
    const $title = document.getElementById('activityTitle');
    const $desc = document.getElementById('activityDesc');
    const $thead = document.getElementById('activityThead');

    if (mode === 'admin') {
        $title.textContent = 'Admin Audit Log';
        $desc.textContent = 'Recent administrative actions.';
        $thead.innerHTML = '<tr><th>Time</th><th>Admin</th><th>Action</th><th>Target</th><th class="hide-mobile">Details</th></tr>';
    } else {
        $title.textContent = 'User Activity Log';
        $desc.textContent = 'Recent user events and actions.';
        $thead.innerHTML = '<tr><th>Time</th><th>User</th><th>Event</th><th class="hide-mobile">Details</th></tr>';
    }

    // Clear search
    const $search = document.getElementById('activitySearch');
    if ($search) $search.value = '';

    loadActivity();
}

/* ═══════════════════════════════════════════════════════════
   Reference note helper
   ═══════════════════════════════════════════════════════════ */
function injectRefNote(sectionId) {
    const el = document.getElementById(sectionId);
    if (!el || el.querySelector('.admin-reference-note')) return;
    const note = document.createElement('div');
    note.className = 'admin-reference-note';
    note.textContent = 'Reference view \u2014 reflects codebase definitions, not live system queries';
    el.insertBefore(note, el.firstChild);
}

/* ═══════════════════════════════════════════════════════════
   Content (read-only reference from codebase data)
   ═══════════════════════════════════════════════════════════ */
function loadContent() {
    injectRefNote('sectionContent');
    // Experiments
    const expEl = document.getElementById('contentExperiments');
    if (expEl) {
        const experiments = [
            { name: 'Cosmic Dreamscape VR', meta: 'WebXR, A-Frame' },
            { name: 'Sound & Color',        meta: 'Audio API, Canvas' },
            { name: "King's Quest",          meta: 'Three.js, WebGL' },
            { name: 'Skyfall',               meta: 'Canvas' },
            { name: 'YouTube Exclusives',    meta: 'Exclusive' },
        ];
        let html = '<div class="admin-inventory">';
        for (const e of experiments) {
            html += `<div class="admin-inventory__row"><span class="admin-inventory__name">${e.name}</span><span class="admin-inventory__meta">${e.meta}</span></div>`;
        }
        html += `</div><div class="admin-inventory__total">${experiments.length} experiments</div>`;
        expEl.innerHTML = html;
    }

    // Gallery (from imported gallery-data.js)
    const galEl = document.getElementById('contentGallery');
    if (galEl) {
        const catLabels = { pictures: 'Pictures', creepy: 'Creepy Creatures', experimental: 'Experimental' };
        const cats = {};
        for (const item of galleryItems) {
            cats[item.category] = (cats[item.category] || 0) + 1;
        }
        let html = '<div class="admin-inventory">';
        for (const [key, count] of Object.entries(cats)) {
            html += `<div class="admin-inventory__row"><span class="admin-inventory__name">${catLabels[key] || key}</span><span class="admin-inventory__count">${count}</span></div>`;
        }
        html += `<div class="admin-inventory__row"><span class="admin-inventory__name">Exclusive (Little Monster)</span><span class="admin-inventory__count">15</span></div>`;
        html += `</div><div class="admin-inventory__total">${galleryItems.length + 15} items total</div>`;
        galEl.innerHTML = html;
    }

    // Sound Lab
    const sndEl = document.getElementById('contentSoundlab');
    if (sndEl) {
        const tracks = ['Cosmic Sea', 'Zufall und Notwendigkeit', 'Relativity', 'Tiny Hearts', "Grok's Groove Remix"];
        let html = '<div class="admin-inventory">';
        for (const t of tracks) {
            html += `<div class="admin-inventory__row"><span class="admin-inventory__name">${t}</span><span class="admin-inventory__meta">Public</span></div>`;
        }
        html += `<div class="admin-inventory__row"><span class="admin-inventory__name">Exclusive tracks</span><span class="admin-inventory__count">5</span></div>`;
        html += `</div><div class="admin-inventory__total">10 tracks total</div>`;
        sndEl.innerHTML = html;
    }
}

/* ═══════════════════════════════════════════════════════════
   Media (read-only reference from codebase data)
   ═══════════════════════════════════════════════════════════ */
function loadMedia() {
    injectRefNote('sectionMedia');
    const total = galleryItems.length;

    const galEl = document.getElementById('mediaGallery');
    if (galEl) {
        let html = '<div class="admin-inventory">';
        html += `<div class="admin-inventory__row"><span class="admin-inventory__name">Public items</span><span class="admin-inventory__count">${total}</span></div>`;
        html += `<div class="admin-inventory__row"><span class="admin-inventory__name">Thumbnails (480w)</span><span class="admin-inventory__count">${total}</span></div>`;
        html += `<div class="admin-inventory__row"><span class="admin-inventory__name">Previews (900\u20131600w)</span><span class="admin-inventory__count">${total}</span></div>`;
        html += `<div class="admin-inventory__row"><span class="admin-inventory__name">Full resolution</span><span class="admin-inventory__count">${total}</span></div>`;
        html += `</div><div class="admin-inventory__total">${total * 3} image files &middot; pub.bitbi.ai</div>`;
        galEl.innerHTML = html;
    }

    const audEl = document.getElementById('mediaAudio');
    if (audEl) {
        const files = ['cosmic-sea', 'zufall-und-notwendigkeit', 'relativity', 'tiny-hearts', 'grok'];
        let html = '<div class="admin-inventory">';
        for (const f of files) {
            html += `<div class="admin-inventory__row"><span class="admin-inventory__name">${f}.mp3</span><span class="admin-inventory__meta">MP3</span></div>`;
        }
        html += `</div><div class="admin-inventory__total">5 audio files &middot; pub.bitbi.ai</div>`;
        audEl.innerHTML = html;
    }

    const exclEl = document.getElementById('mediaExclusive');
    if (exclEl) {
        let html = '<div class="admin-inventory">';
        html += '<div class="admin-inventory__row"><span class="admin-inventory__name">Little Monster images</span><span class="admin-inventory__count">15</span></div>';
        html += '<div class="admin-inventory__row"><span class="admin-inventory__name">Little Monster thumbnails</span><span class="admin-inventory__count">15</span></div>';
        html += '<div class="admin-inventory__row"><span class="admin-inventory__name">Exclusive audio tracks</span><span class="admin-inventory__count">5</span></div>';
        html += '</div><div class="admin-inventory__total">35 files &middot; private R2 bucket</div>';
        exclEl.innerHTML = html;
    }
}

/* ═══════════════════════════════════════════════════════════
   Access (read-only reference from codebase data)
   ═══════════════════════════════════════════════════════════ */
function loadAccess() {
    injectRefNote('sectionAccess');
    const gatingEl = document.getElementById('accessGating');
    if (gatingEl) {
        const gates = [
            'YouTube Exclusives experiment card',
            'Gallery "Exclusive" filter category',
            'Little Monster gallery folder (15 images)',
            'Exclusive Sound Lab track',
            'Markets portfolio card',
        ];
        let html = '<div class="admin-inventory">';
        for (const g of gates) {
            html += `<div class="admin-inventory__row"><span class="admin-inventory__name">${g}</span><span class="admin-inventory__meta">Auth required</span></div>`;
        }
        html += `</div><div class="admin-inventory__total">5 gated placements</div>`;
        gatingEl.innerHTML = html;
    }

    const rolesEl = document.getElementById('accessRoles');
    if (rolesEl) {
        let html = '<div class="admin-inventory">';
        html += '<div class="admin-inventory__row"><span class="admin-inventory__name">User</span><span class="admin-inventory__meta">Profile, favorites, Image Studio, view content</span></div>';
        html += '<div class="admin-inventory__row"><span class="admin-inventory__name">Admin</span><span class="admin-inventory__meta">All user permissions + user management, audit log</span></div>';
        html += '</div>';
        rolesEl.innerHTML = html;
    }

    const mapEl = document.getElementById('accessMap');
    if (mapEl) {
        let html = '<div class="admin-inventory">';
        html += `<div class="admin-inventory__row"><span class="admin-inventory__name">Gallery (${galleryItems.length} items)</span><span class="badge badge--active">Public</span></div>`;
        html += '<div class="admin-inventory__row"><span class="admin-inventory__name">Little Monster (15 images)</span><span class="badge badge--admin">Auth</span></div>';
        html += '<div class="admin-inventory__row"><span class="admin-inventory__name">Sound Lab (5 tracks)</span><span class="badge badge--active">Public</span></div>';
        html += '<div class="admin-inventory__row"><span class="admin-inventory__name">Exclusive tracks (5)</span><span class="badge badge--admin">Auth</span></div>';
        html += '<div class="admin-inventory__row"><span class="admin-inventory__name">Experiments (4)</span><span class="badge badge--active">Public</span></div>';
        html += '<div class="admin-inventory__row"><span class="admin-inventory__name">YouTube Exclusives</span><span class="badge badge--admin">Auth</span></div>';
        html += '<div class="admin-inventory__row"><span class="admin-inventory__name">Image Studio</span><span class="badge badge--admin">Auth</span></div>';
        html += '</div>';
        mapEl.innerHTML = html;
    }
}

/* ═══════════════════════════════════════════════════════════
   Users — Mobile card builder
   ═══════════════════════════════════════════════════════════ */
function buildMobileCard(user) {
    const card = document.createElement('div');
    card.className = 'admin-mobile-card';

    const isLegacy = user.verification_method === 'legacy_auto';
    const isVerified = !!user.email_verified_at && !isLegacy;
    const primaryName = user.display_name || user.email;
    const secondaryLine = user.display_name ? user.email : null;

    /* Header (always visible) */
    const header = document.createElement('div');
    header.className = 'admin-mobile-card__header';
    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');
    header.setAttribute('aria-expanded', 'false');

    const identity = document.createElement('div');
    identity.className = 'admin-mobile-card__identity';

    const nameEl = document.createElement('div');
    nameEl.className = 'admin-mobile-card__name';
    nameEl.textContent = primaryName;
    identity.appendChild(nameEl);

    if (secondaryLine) {
        const subEl = document.createElement('div');
        subEl.className = 'admin-mobile-card__sub';
        subEl.textContent = secondaryLine;
        identity.appendChild(subEl);
    }

    const badgeRole = createBadge(user.role, user.role === 'admin' ? 'admin' : 'user');
    const badgeStatus = createBadge(user.status, user.status === 'active' ? 'active' : 'disabled');
    const verifiedLabel = isVerified ? 'Yes' : isLegacy ? 'Legacy' : 'No';
    const verifiedStyle = isVerified ? 'active' : isLegacy ? 'legacy' : 'disabled';
    const badgeVerified = createBadge(verifiedLabel, verifiedStyle);

    const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chevron.classList.add('admin-mobile-card__chevron');
    chevron.setAttribute('width', '16');
    chevron.setAttribute('height', '16');
    chevron.setAttribute('viewBox', '0 0 24 24');
    chevron.setAttribute('fill', 'none');
    chevron.setAttribute('stroke', 'currentColor');
    chevron.setAttribute('stroke-width', '2');
    chevron.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('d', 'M19 9l-7 7-7-7');
    chevron.appendChild(path);

    header.appendChild(identity);
    header.appendChild(badgeRole);
    header.appendChild(badgeStatus);
    header.appendChild(badgeVerified);
    header.appendChild(chevron);

    /* Body (expandable accordion) */
    const body = document.createElement('div');
    body.className = 'admin-mobile-card__body';

    const bodyInner = document.createElement('div');
    bodyInner.className = 'admin-mobile-card__body-inner';

    const content = document.createElement('div');
    content.className = 'admin-mobile-card__content';

    // Created date
    const meta = document.createElement('div');
    meta.className = 'admin-mobile-card__meta';
    const metaLabel = document.createElement('span');
    metaLabel.className = 'admin-mobile-card__label';
    metaLabel.textContent = 'Created';
    const metaValue = document.createElement('span');
    metaValue.className = 'admin-mobile-card__value';
    metaValue.textContent = formatDate(user.created_at);
    meta.appendChild(metaLabel);
    meta.appendChild(metaValue);

    // Actions (same logic as desktop)
    const actions = document.createElement('div');
    actions.className = 'admin-mobile-card__actions';

    const newRole = user.role === 'admin' ? 'user' : 'admin';
    actions.appendChild(createActionBtn(
        newRole === 'admin' ? 'Make Admin' : 'Make User',
        () => handleChangeRole(user.id, newRole),
    ));

    const newStatus = user.status === 'active' ? 'disabled' : 'active';
    actions.appendChild(createActionBtn(
        newStatus === 'disabled' ? 'Disable' : 'Enable',
        () => handleChangeStatus(user.id, newStatus),
    ));

    actions.appendChild(createActionBtn(
        'Revoke Sessions',
        () => handleRevokeSessions(user.id),
    ));

    actions.appendChild(createActionBtn(
        'Delete',
        () => handleDeleteUser(user.id, user.email),
        true,
    ));

    content.appendChild(meta);
    content.appendChild(actions);
    bodyInner.appendChild(content);
    body.appendChild(bodyInner);

    card.appendChild(header);
    card.appendChild(body);

    /* Toggle expand/collapse */
    const toggle = () => {
        const isOpen = card.classList.toggle('admin-mobile-card--open');
        header.setAttribute('aria-expanded', String(isOpen));
    };
    header.addEventListener('click', toggle);
    header.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
        }
    });

    return card;
}

/* ═══════════════════════════════════════════════════════════
   Users — Render user rows
   ═══════════════════════════════════════════════════════════ */
function renderUsers(users) {
    $tbody.replaceChildren();
    $mobileList.replaceChildren();

    if (!users || users.length === 0) {
        $table.style.display = 'none';
        $mobileSec.style.display = 'none';
        $empty.style.display = '';
        return;
    }

    $empty.style.display = 'none';
    $table.style.display = '';
    $mobileSec.style.display = '';

    for (const user of users) {
        const tr = document.createElement('tr');

        // Email
        const tdEmail = document.createElement('td');
        tdEmail.textContent = user.email;
        tr.appendChild(tdEmail);

        // Role badge
        const tdRole = document.createElement('td');
        tdRole.appendChild(createBadge(user.role, user.role === 'admin' ? 'admin' : 'user'));
        tr.appendChild(tdRole);

        // Status badge
        const tdStatus = document.createElement('td');
        tdStatus.appendChild(createBadge(user.status, user.status === 'active' ? 'active' : 'disabled'));
        tr.appendChild(tdStatus);

        // Verified badge
        const tdVerified = document.createElement('td');
        const isLegacyV = user.verification_method === 'legacy_auto';
        const isVerifiedV = !!user.email_verified_at && !isLegacyV;
        const vLabel = isVerifiedV ? 'Yes' : isLegacyV ? 'Legacy' : 'No';
        const vStyle = isVerifiedV ? 'active' : isLegacyV ? 'legacy' : 'disabled';
        tdVerified.appendChild(createBadge(vLabel, vStyle));
        tr.appendChild(tdVerified);

        // Created date
        const tdCreated = document.createElement('td');
        tdCreated.className = 'hide-mobile';
        tdCreated.textContent = formatDate(user.created_at);
        tr.appendChild(tdCreated);

        // Actions
        const tdActions = document.createElement('td');
        const actionsWrap = document.createElement('div');
        actionsWrap.className = 'admin-actions';

        // Toggle role
        const newRole = user.role === 'admin' ? 'user' : 'admin';
        actionsWrap.appendChild(
            createActionBtn(
                newRole === 'admin' ? 'Make Admin' : 'Make User',
                () => handleChangeRole(user.id, newRole),
            ),
        );

        // Toggle status
        const newStatus = user.status === 'active' ? 'disabled' : 'active';
        actionsWrap.appendChild(
            createActionBtn(
                newStatus === 'disabled' ? 'Disable' : 'Enable',
                () => handleChangeStatus(user.id, newStatus),
            ),
        );

        // Revoke sessions
        actionsWrap.appendChild(
            createActionBtn('Revoke Sessions', () => handleRevokeSessions(user.id)),
        );

        // Delete
        actionsWrap.appendChild(
            createActionBtn('Delete', () => handleDeleteUser(user.id, user.email), true),
        );

        tdActions.appendChild(actionsWrap);
        tr.appendChild(tdActions);
        $tbody.appendChild(tr);

        // Mobile card
        $mobileList.appendChild(buildMobileCard(user));
    }
}

/* ═══════════════════════════════════════════════════════════
   Users — Load
   ═══════════════════════════════════════════════════════════ */
async function loadUsers(search) {
    const myVersion = ++usersVersion;

    $loading.style.display = '';
    $empty.style.display = 'none';
    $table.style.display = 'none';
    $mobileSec.style.display = 'none';

    const res = await apiAdminUsers(search || undefined);

    // Ignore stale response if a newer load was initiated
    if (myVersion !== usersVersion) return;

    $loading.style.display = 'none';

    if (!res.ok) {
        showToast(res.error, 'error');
        return;
    }

    renderUsers(res.data?.users ?? res.data);
}

/* ═══════════════════════════════════════════════════════════
   Users — Action handlers
   ═══════════════════════════════════════════════════════════ */
async function handleChangeRole(userId, newRole) {
    const res = await apiAdminChangeRole(userId, newRole);
    if (res.ok) {
        statsCache = null;
        showToast(res.data?.message || 'Role changed', 'success');
        loadUsers($searchInput.value.trim());
    } else {
        showToast(res.error, 'error');
    }
}

async function handleChangeStatus(userId, newStatus) {
    const res = await apiAdminChangeStatus(userId, newStatus);
    if (res.ok) {
        statsCache = null;
        showToast(res.data?.message || 'Status changed', 'success');
        loadUsers($searchInput.value.trim());
    } else {
        showToast(res.error, 'error');
    }
}

async function handleRevokeSessions(userId) {
    if (!confirm('Revoke all sessions for this user?')) return;
    const res = await apiAdminRevokeSessions(userId);
    if (res.ok) {
        showToast(res.data?.message || 'Sessions revoked', 'success');
    } else {
        showToast(res.error, 'error');
    }
}

async function handleDeleteUser(userId, email) {
    if (!confirm(`Permanently delete user "${email}"?`)) return;
    const res = await apiAdminDeleteUser(userId);
    if (res.ok) {
        statsCache = null;
        showToast(res.data?.message || 'User deleted', 'success');
        loadUsers($searchInput.value.trim());
    } else {
        showToast(res.error, 'error');
    }
}

/* ═══════════════════════════════════════════════════════════
   Avatar Dropdown (Users section)
   ═══════════════════════════════════════════════════════════ */
let avatarsLoaded = false;

async function loadLatestAvatars() {
    $avatarGrid.replaceChildren();
    const msg = document.createElement('div');
    msg.className = 'admin-avatars__empty';
    msg.textContent = 'Loading...';
    $avatarGrid.appendChild(msg);

    const res = await apiAdminLatestAvatars();
    avatarsLoaded = true;

    if (!res.ok) {
        msg.textContent = 'Failed to load avatars.';
        return;
    }

    const avatars = res.data?.avatars ?? [];

    if (avatars.length === 0) {
        msg.textContent = 'No avatars uploaded yet.';
        return;
    }

    $avatarGrid.replaceChildren();

    for (const avatar of avatars) {
        const item = document.createElement('button');
        item.className = 'admin-avatars__item';
        item.type = 'button';
        item.setAttribute('aria-label', `View avatar for ${avatar.displayName || avatar.email}`);

        const img = document.createElement('img');
        img.className = 'admin-avatars__thumb';
        img.src = `/api/admin/avatars/${avatar.userId}`;
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';

        item.appendChild(img);
        item.addEventListener('click', () => openLightbox(avatar));
        $avatarGrid.appendChild(item);
    }
}

function initAvatarDropdown() {
    $avatarToggle.addEventListener('click', async () => {
        const isOpen = $avatarDropdown.classList.toggle('admin-avatars--open');
        $avatarToggle.setAttribute('aria-expanded', String(isOpen));

        if (isOpen && !avatarsLoaded) {
            await loadLatestAvatars();
        }
    });
}

/* ═══════════════════════════════════════════════════════════
   Lightbox
   ═══════════════════════════════════════════════════════════ */
function openLightbox(avatar) {
    $lightboxImg.src = `/api/admin/avatars/${avatar.userId}`;
    $lightboxImg.alt = `Avatar of ${avatar.displayName || avatar.email}`;
    $lightboxName.textContent = avatar.displayName || avatar.email;
    $lightboxEmail.textContent = avatar.displayName ? avatar.email : '';
    $lightbox.classList.add('admin-lightbox--visible');
    $lightbox.setAttribute('aria-hidden', 'false');
}

function closeLightbox() {
    $lightbox.classList.remove('admin-lightbox--visible');
    $lightbox.setAttribute('aria-hidden', 'true');
    $lightboxImg.src = '';
}

function initLightbox() {
    $lightbox.addEventListener('click', (e) => {
        if (e.target === $lightbox) closeLightbox();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && $lightbox.classList.contains('admin-lightbox--visible')) {
            closeLightbox();
        }
    });
}

/* ═══════════════════════════════════════════════════════════
   Init
   ═══════════════════════════════════════════════════════════ */
async function init() {
    // Shared modules
    try { initSiteHeader(); }               catch (e) { console.warn(e); }
    initAdminNavOffset();
    try { initParticles('heroCanvas'); }     catch (e) { console.warn(e); }
    try { initBinaryRain('binaryRain'); }    catch (e) { console.warn(e); }
    try { initBinaryFooter('binaryFooter'); } catch (e) { console.warn(e); }
    try { initScrollReveal(); }              catch (e) { console.warn(e); }
    try { initCookieConsent(); }             catch (e) { console.warn(e); }

    // Auth check
    const me = await apiAdminMe();

    if (!me.ok) {
        $denied.style.display = '';
        $denied.classList.add('visible');
        return;
    }

    // Show admin panel + nav
    $panel.style.display = '';
    $adminNav.style.display = '';

    // Avatar dropdown + lightbox (for Users section)
    initAvatarDropdown();
    initLightbox();

    // Search form (Users section)
    $searchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        loadUsers($searchInput.value.trim());
    });

    // Activity mode switch
    document.querySelectorAll('.admin-activity-mode').forEach(btn => {
        btn.addEventListener('click', () => switchActivityMode(btn.dataset.mode));
    });

    // Activity search (debounced)
    const $actSearch = document.getElementById('activitySearch');
    if ($actSearch) {
        $actSearch.addEventListener('input', () => {
            clearTimeout(activitySearchTimer);
            activitySearchTimer = setTimeout(() => loadActivity(), 350);
        });
    }

    // Activity expand/collapse toggle
    const $expandBtn = document.getElementById('activityExpandBtn');
    if ($expandBtn) {
        $expandBtn.addEventListener('click', () => {
            activityExpanded = !activityExpanded;
            const $wrap = document.getElementById('activityExpand');
            $wrap.classList.toggle('admin-activity-expand--open', activityExpanded);
            const $label = document.getElementById('activityExpandLabel');
            const restCount = activityEntries.length - ACTIVITY_VISIBLE;
            $label.textContent = activityExpanded
                ? 'Hide older entries'
                : `Show ${restCount} more entr${restCount === 1 ? 'y' : 'ies'}`;
            $expandBtn.setAttribute('aria-expanded', String(activityExpanded));
        });
    }

    // Activity load more (cursor pagination within expanded area)
    const $loadMoreBtn = document.getElementById('activityLoadMoreBtn');
    if ($loadMoreBtn) {
        $loadMoreBtn.addEventListener('click', () => {
            if (activityNextCursor) {
                activityExpanded = true; // keep expanded when loading more
                loadActivity(true);
            }
        });
    }

    // Init routing (loads initial section from hash)
    initRouting();
}

init();
