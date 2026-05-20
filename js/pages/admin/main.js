/* ============================================================
   BITBI — Admin Dashboard
   Entry point for admin/index.html
   ============================================================ */

// Keep these versioned admin imports aligned with admin/index.html and the admin release-token checklist in CLAUDE.md.
import { initSiteHeader }    from '../../shared/site-header.js?v=__ASSET_VERSION__';
import { initParticles }     from '../../shared/particles.js?v=__ASSET_VERSION__';
import { initBinaryRain }    from '../../shared/binary-rain.js?v=__ASSET_VERSION__';
import { initBinaryFooter }  from '../../shared/binary-footer.js?v=__ASSET_VERSION__';
import { initScrollReveal }  from '../../shared/scroll-reveal.js?v=__ASSET_VERSION__';
import { initCookieConsent } from '../../shared/cookie-consent.js?v=__ASSET_VERSION__';

import {
    apiAdminMe,
    apiAdminLatestAvatars,
    apiAdminStats,
    apiAdminActivity,
    apiAdminUserActivity,
} from '../../shared/auth-api.js?v=__ASSET_VERSION__';
import { galleryItems } from '../../shared/gallery-data.js?v=__ASSET_VERSION__';
import { createAdminAiLab } from './ai-lab.js?v=__ASSET_VERSION__';
import { createAdminControlPlane } from './control-plane.js?v=__ASSET_VERSION__';
import {
    ADMIN_MFA_GATE_CODES,
    createAdminMfaGate,
} from './security.js?v=__ASSET_VERSION__';
import {
    createRegistrationAvailabilityPanel,
} from './settings.js?v=__ASSET_VERSION__';
import {
    createAdminUsersDomain,
} from './users.js?v=__ASSET_VERSION__';

/* ═══════════════════════════════════════════════════════════
   DOM refs
   ═══════════════════════════════════════════════════════════ */

const $denied      = document.getElementById('adminDenied');
const $deniedMessage = document.getElementById('adminDeniedMessage');
const $mfaGate     = document.getElementById('adminMfaGate');
const $panel       = document.getElementById('adminPanel');
const $toast       = document.getElementById('adminToast');
const $adminNav    = document.getElementById('adminNav');
const $heroTitle   = document.getElementById('adminHeroTitle');
const $heroDesc    = document.getElementById('adminHeroDesc');

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
    security:  document.getElementById('sectionSecurity'),
    orgs:      document.getElementById('sectionOrgs'),
    billing:   document.getElementById('sectionBilling'),
    'billing-events': document.getElementById('sectionBillingEvents'),
    'ai-usage': document.getElementById('sectionAiUsage'),
    'ai-budget-switches': document.getElementById('sectionAiBudgetSwitches'),
    lifecycle: document.getElementById('sectionLifecycle'),
    operations: document.getElementById('sectionOperations'),
    'tenant-assets': document.getElementById('sectionTenantAssets'),
    readiness: document.getElementById('sectionReadiness'),
    users:     document.getElementById('sectionUsers'),
    'ai-lab':  document.getElementById('sectionAiLab'),
    activity:  document.getElementById('sectionActivity'),
    settings:  document.getElementById('sectionSettings'),
};

/* Section metadata for hero */
const sectionMeta = {
    dashboard: { title: 'Command Center',   desc: 'System overview, readiness, and control-plane entrypoints' },
    security:  { title: 'Security & Policy', desc: 'Route policy, MFA, service auth, and fail-closed guardrails' },
    orgs:      { title: 'Organizations',    desc: 'Organization, tenant, and membership inspection' },
    billing:   { title: 'Billing & Credits', desc: 'Plans, entitlements, balances, and safe manual credit grants' },
    'billing-events': { title: 'Billing Events', desc: 'Provider events, operator review queue, and read-only reconciliation' },
    'ai-usage': { title: 'AI Usage',         desc: 'Org-scoped usage attempts, reservations, replay, and cleanup' },
    'ai-budget-switches': { title: 'AI Budget Switches', desc: 'App-level controls layered under Cloudflare master kill switches' },
    lifecycle: { title: 'Data Lifecycle',   desc: 'Export, deletion planning, archive, and retention operations' },
    operations: { title: 'Operations',      desc: 'Operator timeline, triage, async AI video diagnostics, and review queues' },
    'tenant-assets': { title: 'Tenant Assets', desc: 'Cross-domain ownership inventory, evidence gaps, and storage safety' },
    readiness: { title: 'Readiness',        desc: 'Release, migration, Cloudflare, and staging verification checklist' },
    users:     { title: 'User Management',  desc: 'Manage users, roles, and sessions' },
    'ai-lab':  { title: 'AI Lab',           desc: 'Admin-only AI tests, previews, and model comparisons' },
    activity:  { title: 'Activity',         desc: 'Audit trail and admin actions' },
    settings:  { title: 'Admin Settings',   desc: 'Safe settings boundaries and deployment-owned configuration' },
};

const sectionAliases = {
    'platform-budget-caps': { section: 'ai-budget-switches', panel: 'platformBudgetCapsPanel' },
    'budget-reconciliation': { section: 'ai-budget-switches', panel: 'platformBudgetReconciliationPanel' },
    'budget-repair': { section: 'ai-budget-switches', panel: 'platformBudgetReconciliationPanel' },
    'repair-evidence-report': { section: 'ai-budget-switches', panel: 'platformBudgetRepairReportPanel' },
    'evidence-archives': { section: 'ai-budget-switches', panel: 'platformBudgetEvidenceArchivesPanel' },
    timeline: { section: 'operations', panel: null },
    triage: { section: 'operations', panel: null },
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
const controlPlane = createAdminControlPlane({ showToast, formatDate });
const adminMfaGate = createAdminMfaGate({ showToast, showGate: showAdminMfaGate });
const adminUsers = createAdminUsersDomain({
    showToast,
    formatDate,
    formatApiError,
    getCurrentAdminUser: () => currentAdminUser,
    invalidateStats: () => { statsCache = null; },
});
const registrationAvailability = createRegistrationAvailabilityPanel({
    showToast,
    formatDate,
    formatApiError,
    shortUserId,
});
let adminBootstrapped = false;
let pendingAdminPanelTarget = null;
let currentAdminUser = null;

function resolveSectionRoute(name) {
    const routeName = name || 'dashboard';
    const alias = sectionAliases[routeName];
    if (alias) return alias;
    return { section: routeName, panel: null };
}

function showAccessDenied() {
    $panel.style.display = 'none';
    $adminNav.style.display = 'none';
    $denied.style.display = '';
    $denied.classList.add('visible');
    $deniedMessage.style.display = '';
    $mfaGate.style.display = 'none';
}

function showAdminMfaGate() {
    $panel.style.display = 'none';
    $adminNav.style.display = 'none';
    $denied.style.display = '';
    $denied.classList.add('visible');
    $deniedMessage.style.display = 'none';
    $mfaGate.style.display = '';
}

function bootstrapAdminPanel() {
    if (adminBootstrapped) return;
    adminBootstrapped = true;

    $denied.style.display = 'none';
    $panel.style.display = '';
    $adminNav.style.display = '';

    initAvatarDropdown();
    initLightbox();
    adminUsers.bind();
    registrationAvailability.bind();
    controlPlane.bind();

    document.querySelectorAll('.admin-activity-mode').forEach(btn => {
        btn.addEventListener('click', () => switchActivityMode(btn.dataset.mode));
    });

    const $actSearch = document.getElementById('activitySearch');
    if ($actSearch) {
        $actSearch.addEventListener('input', () => {
            clearTimeout(activitySearchTimer);
            activitySearchTimer = setTimeout(() => loadActivity(), 350);
        });
    }

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

    const $loadMoreBtn = document.getElementById('activityLoadMoreBtn');
    if ($loadMoreBtn) {
        $loadMoreBtn.addEventListener('click', () => {
            if (activityNextCursor) {
                activityExpanded = true;
                loadActivity(true);
            }
        });
    }

    initAdminNavGroups();
    initAdminNavLinkCollapse();
    initRouting();
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

function formatApiError(res, fallback = 'Request failed.') {
    const message = res?.error || res?.data?.error || fallback;
    const code = res?.code || res?.data?.code || null;
    const status = res?.status || res?.data?.status || null;
    const branch = res?.branch || res?.data?.branch || null;
    const summary = res?.dependencySummary || res?.data?.dependencySummary || null;
    const workflow = res?.dataErasureWorkflow || res?.data?.dataErasureWorkflow || null;
    const details = [];
    if (code) details.push(`code: ${code}`);
    if (branch) details.push(`branch: ${branch}`);
    if (status) details.push(`status: ${status}`);
    if (workflow?.started && workflow?.requestId) {
        details.push(`workflow: ${workflow.requestId}/${workflow.status || 'pending'}`);
    } else if (workflow?.status && workflow.status !== 'not_requested') {
        details.push(`workflow: ${workflow.status}`);
    }
    const dependencies = Array.isArray(summary?.blockingCategories)
        ? summary.blockingCategories.filter(Boolean).slice(0, 4).join(', ')
        : '';
    const suffix = details.length ? ` (${details.join(', ')})` : '';
    const dependencyText = dependencies ? ` Dependencies: ${dependencies}.` : '';
    const retentionText = branch === 'retention_dependency_blocked' || code === 'admin_delete_user_retention_dependency_blocked'
        ? ' This is a backend policy/schema dependency, not a confirmation or network issue.'
        : '';
    return `${message}${suffix}${dependencyText}${retentionText}`;
}

function shortUserId(userId) {
    const value = String(userId || '');
    if (value.length <= 18) return value;
    return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

/* ═══════════════════════════════════════════════════════════
   Section Routing
   ═══════════════════════════════════════════════════════════ */
let currentSection = 'dashboard';
let dashboardVersion = 0;
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

function focusAdminPanelTarget(panelId) {
    if (!panelId) return;
    window.requestAnimationFrame(() => {
        const panel = document.getElementById(panelId);
        if (!panel) return;
        panel.scrollIntoView({ block: 'start', behavior: 'auto' });
    });
}

function showSection(name) {
    const route = resolveSectionRoute(name);
    name = route.section;
    pendingAdminPanelTarget = route.panel;
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

    // Mark the active group and ensure single-open accordion behavior
    const activeLink = document.querySelector(`.admin-nav__link[data-section="${name}"]`);
    const activeGroup = activeLink?.closest('.admin-nav__group');
    const allGroups = document.querySelectorAll('.admin-nav__group');
    allGroups.forEach(g => {
        g.classList.toggle('admin-nav__group--active', g === activeGroup);
    });
    // Always collapse non-active groups so only one group can be expanded.
    allGroups.forEach(g => {
        if (g !== activeGroup) setAdminNavGroupExpanded(g, false);
    });
    if (activeGroup) {
        // Auto-expand the active group only for non-dashboard sections (i.e.
        // direct deep links to #ai-lab, #users, #settings, etc.). Normal admin
        // entry / #dashboard keeps Overview collapsed even though its content
        // is visible. Honor a pending click-to-collapse intent in either case.
        const collapseAfterClick = pendingNavLinkCollapseGroup === activeGroup;
        pendingNavLinkCollapseGroup = null;
        const shouldExpand = name !== 'dashboard' && !collapseAfterClick;
        setAdminNavGroupExpanded(activeGroup, shouldExpand);
    } else {
        pendingNavLinkCollapseGroup = null;
    }

    // Update hero
    const meta = sectionMeta[name];
    if (meta) {
        $heroTitle.textContent = meta.title;
        $heroDesc.textContent = meta.desc;
    }

    // Load section data
    if (name === 'dashboard') loadDashboard();
    controlPlane.load(name).catch((error) => {
        console.warn(error);
        showToast('Failed to load control-plane section.', 'error');
    }).finally(() => {
        const panelTarget = pendingAdminPanelTarget;
        pendingAdminPanelTarget = null;
        focusAdminPanelTarget(panelTarget);
    });
    if (name === 'users') {
        registrationAvailability.load();
        adminUsers.load();
    }
    if (name === 'activity') loadActivity();
    if (name === 'ai-lab') aiLab.show();
}

function setAdminNavGroupExpanded(group, expanded) {
    const toggle = group.querySelector('.admin-nav__group-toggle');
    if (!toggle) return;
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    group.classList.toggle('admin-nav__group--expanded', expanded);
}

function initAdminNavGroups() {
    const groups = document.querySelectorAll('.admin-nav__group');
    groups.forEach((group) => {
        const toggle = group.querySelector('.admin-nav__group-toggle');
        if (!toggle) return;
        // Sync the explicit class with the initial aria-expanded state from HTML
        const initiallyExpanded = toggle.getAttribute('aria-expanded') === 'true';
        group.classList.toggle('admin-nav__group--expanded', initiallyExpanded);
        toggle.addEventListener('click', () => {
            const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
            if (!isExpanded) {
                // Single-open accordion: when opening a group, collapse every
                // other group so at most one is expanded at a time.
                groups.forEach((other) => {
                    if (other !== group) setAdminNavGroupExpanded(other, false);
                });
            }
            setAdminNavGroupExpanded(group, !isExpanded);
        });
    });
}

// Captures the parent group of a child link the user just clicked, so the
// next showSection() call can collapse it instead of auto-expanding it.
// Cold deep links never set this, so showSection's auto-expand still works
// for direct hash routes.
let pendingNavLinkCollapseGroup = null;

function initAdminNavLinkCollapse() {
    document.querySelectorAll('.admin-nav__group-items .admin-nav__link').forEach((link) => {
        link.addEventListener('click', () => {
            const group = link.closest('.admin-nav__group');
            if (!group) return;
            const linkHash = link.getAttribute('href') || '';
            const currentHash = location.hash || '#dashboard';
            if (linkHash === currentHash) {
                // Same-hash click: no hashchange fires, so showSection won't run.
                // Collapse synchronously instead of relying on the flag.
                setAdminNavGroupExpanded(group, false);
                return;
            }
            pendingNavLinkCollapseGroup = group;
        });
    });
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

    document.querySelectorAll('[data-admin-panel-target]').forEach(link => {
        link.addEventListener('click', () => {
            const panelTarget = link.dataset.adminPanelTarget || null;
            pendingAdminPanelTarget = panelTarget;
            const linkHash = (link.getAttribute('href') || '').replace('#', '');
            if (linkHash && linkHash === (location.hash || '').replace('#', '')) {
                focusAdminPanelTarget(panelTarget);
            }
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

    // Gallery (from imported gallery-data.js)
    const galEl = document.getElementById('contentGallery');
    if (galEl) {
        const catLabels = { mempics: 'Mempics' };
        const cats = {};
        for (const item of galleryItems) {
            cats[item.category] = (cats[item.category] || 0) + 1;
        }
        let html = '<div class="admin-inventory">';
        for (const [key, count] of Object.entries(cats)) {
            html += `<div class="admin-inventory__row"><span class="admin-inventory__name">${catLabels[key] || key}</span><span class="admin-inventory__count">${count}</span></div>`;
        }
        html += `</div><div class="admin-inventory__total">${galleryItems.length} items total</div>`;
        galEl.innerHTML = html;
    }

    // Sound Lab
    const sndEl = document.getElementById('contentSoundlab');
    if (sndEl) {
        let html = '<div class="admin-inventory">';
        html += '<div class="admin-inventory__row"><span class="admin-inventory__name">Published member tracks</span><span class="admin-inventory__meta">Memtracks</span></div>';
        html += '</div><div class="admin-inventory__total">Sound Lab Explore reads public music from Memtracks.</div>';
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
        let html = '<div class="admin-inventory">';
        html += '<div class="admin-inventory__row"><span class="admin-inventory__name">Published music assets</span><span class="admin-inventory__meta">USER_IMAGES</span></div>';
        html += '<div class="admin-inventory__row"><span class="admin-inventory__name">Public playback</span><span class="admin-inventory__meta">/api/gallery/memtracks</span></div>';
        html += '</div><div class="admin-inventory__total">Legacy bundled Free tracks are removed from the active Sound Lab UI.</div>';
        audEl.innerHTML = html;
    }
}

/* ═══════════════════════════════════════════════════════════
   Access (read-only reference from codebase data)
   ═══════════════════════════════════════════════════════════ */
function loadAccess() {
    injectRefNote('sectionAccess');
    const gatingEl = document.getElementById('accessGating');
    if (gatingEl) {
        let html = '<div class="admin-inventory">';
        html += '<div class="admin-inventory__row"><span class="admin-inventory__name">Sound Lab category gates</span><span class="admin-inventory__meta">Removed</span></div>';
        html += '</div><div class="admin-inventory__total">Sound Lab Explore shows published member tracks directly.</div>';
        gatingEl.innerHTML = html;
    }

    const rolesEl = document.getElementById('accessRoles');
    if (rolesEl) {
        let html = '<div class="admin-inventory">';
        html += '<div class="admin-inventory__row"><span class="admin-inventory__name">User</span><span class="admin-inventory__meta">Profile, favorites, Assets Manager, view content</span></div>';
        html += '<div class="admin-inventory__row"><span class="admin-inventory__name">Admin</span><span class="admin-inventory__meta">All user permissions + user management, audit log</span></div>';
        html += '</div>';
        rolesEl.innerHTML = html;
    }

    const mapEl = document.getElementById('accessMap');
    if (mapEl) {
        let html = '<div class="admin-inventory">';
        html += `<div class="admin-inventory__row"><span class="admin-inventory__name">Gallery (${galleryItems.length} items)</span><span class="badge badge--active">Public</span></div>`;
        html += '<div class="admin-inventory__row"><span class="admin-inventory__name">Sound Lab Memtracks</span><span class="badge badge--active">Public when published</span></div>';
        html += '<div class="admin-inventory__row"><span class="admin-inventory__name">Experiments (4)</span><span class="badge badge--active">Public</span></div>';
        html += '<div class="admin-inventory__row"><span class="admin-inventory__name">Video Exclusives</span><span class="badge badge--admin">Auth</span></div>';
        html += '<div class="admin-inventory__row"><span class="admin-inventory__name">Assets Manager</span><span class="badge badge--admin">Auth</span></div>';
        html += '</div>';
        mapEl.innerHTML = html;
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
    adminMfaGate.bind();

    // Auth check
    const me = await apiAdminMe();

    if (!me.ok) {
        if (ADMIN_MFA_GATE_CODES.has(me.code)) {
            await adminMfaGate.refresh(me.code);
            return;
        }
        showAccessDenied();
        return;
    }

    currentAdminUser = me.data?.user || me.data?.admin || null;
    bootstrapAdminPanel();
}

init();
