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
    apiAdminStats,
} from '../../shared/auth-api.js?v=__ASSET_VERSION__';
import { createAdminActivity } from './activity.js?v=__ASSET_VERSION__';
import { createAdminAiLab } from './ai-lab.js?v=__ASSET_VERSION__';
import { createAdminAvatarLightbox } from './avatar-lightbox.js?v=__ASSET_VERSION__';
import { createAdminControlPlane } from './control-plane.js?v=__ASSET_VERSION__';
import { createAdminReferenceViews } from './reference-views.js?v=__ASSET_VERSION__';
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
    content:   document.getElementById('sectionContent'),
    media:     document.getElementById('sectionMedia'),
    access:    document.getElementById('sectionAccess'),
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
    content:   { title: 'Content Reference', desc: 'Read-only codebase content definitions, not live system queries' },
    media:     { title: 'Media Reference',   desc: 'Read-only codebase media inventory, not live R2 listing' },
    access:    { title: 'Access Reference',  desc: 'Read-only codebase access map, not live authorization proof' },
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
const adminActivity = createAdminActivity({ showToast, formatDate });
const adminAvatars = createAdminAvatarLightbox();
const referenceViews = createAdminReferenceViews();
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

    adminAvatars.bind();
    adminUsers.bind();
    adminActivity.bind();
    registrationAvailability.bind();
    controlPlane.bind();

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

let adminNavOffsetObserver = null;

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
    if (name === 'activity') adminActivity.load();
    if (name === 'content') referenceViews.loadContent();
    if (name === 'media') referenceViews.loadMedia();
    if (name === 'access') referenceViews.loadAccess();
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
