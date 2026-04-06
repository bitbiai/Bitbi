/* ============================================================
   BITBI — Admin Dashboard
   Entry point for admin/index.html
   ============================================================ */

import { initSiteHeader }    from '../../shared/site-header.js';
import { initParticles }     from '../../shared/particles.js';
import { initBinaryRain }    from '../../shared/binary-rain.js';
import { initBinaryFooter }  from '../../shared/binary-footer.js';
import { initScrollReveal }  from '../../shared/scroll-reveal.js';
import { initCookieConsent } from '../../shared/cookie-consent.js';

import {
    apiAdminMe,
    apiAdminUsers,
    apiAdminChangeRole,
    apiAdminChangeStatus,
    apiAdminRevokeSessions,
    apiAdminDeleteUser,
    apiAdminLatestAvatars,
    apiAdminStats,
} from '../../shared/auth-api.js';

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
    site:      document.getElementById('sectionSite'),
    access:    document.getElementById('sectionAccess'),
    activity:  document.getElementById('sectionActivity'),
    settings:  document.getElementById('sectionSettings'),
};

/* Section metadata for hero */
const sectionMeta = {
    dashboard: { title: 'Dashboard',        desc: 'System overview and quick actions' },
    users:     { title: 'User Management',  desc: 'Manage users, roles, and sessions' },
    content:   { title: 'Content',          desc: 'Site content entries and publishing' },
    media:     { title: 'Media Library',    desc: 'Assets, images, audio, and video files' },
    site:      { title: 'Site',             desc: 'Homepage, navigation, and global settings' },
    access:    { title: 'Access Control',   desc: 'Membership gating and role-based access' },
    activity:  { title: 'Activity',         desc: 'Audit trail and admin actions' },
    settings:  { title: 'Settings',         desc: 'Global configuration and defaults' },
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
    if (name === 'dashboard') {
        loadDashboard();
    }
    if (name === 'users') {
        loadUsers($searchInput.value.trim());
    }
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

    // Init routing (loads initial section from hash)
    initRouting();
}

init();
