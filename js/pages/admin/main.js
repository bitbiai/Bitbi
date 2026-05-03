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
    apiAdminMfaEnable,
    apiAdminMfaSetup,
    apiAdminMfaStatus,
    apiAdminMfaVerify,
    apiAdminUsers,
    apiAdminChangeRole,
    apiAdminChangeStatus,
    apiAdminRevokeSessions,
    apiAdminDeleteUser,
    apiAdminUserBilling,
    apiAdminLatestAvatars,
    apiAdminStats,
    apiAdminActivity,
    apiAdminUserActivity,
} from '../../shared/auth-api.js?v=__ASSET_VERSION__';
import { galleryItems } from '../../shared/gallery-data.js?v=__ASSET_VERSION__';
import { createAdminAiLab } from './ai-lab.js?v=__ASSET_VERSION__';
import { createAdminControlPlane } from './control-plane.js?v=__ASSET_VERSION__';

/* ═══════════════════════════════════════════════════════════
   DOM refs
   ═══════════════════════════════════════════════════════════ */

const $denied      = document.getElementById('adminDenied');
const $deniedMessage = document.getElementById('adminDeniedMessage');
const $mfaGate     = document.getElementById('adminMfaGate');
const $mfaTitle    = document.getElementById('adminMfaTitle');
const $mfaText     = document.getElementById('adminMfaText');
const $mfaNotice   = document.getElementById('adminMfaNotice');
const $mfaEnrollmentBlock = document.getElementById('adminMfaEnrollmentBlock');
const $mfaVerifyBlock = document.getElementById('adminMfaVerifyBlock');
const $mfaSetupBtn = document.getElementById('adminMfaSetupBtn');
const $mfaSetupFields = document.getElementById('adminMfaSetupFields');
const $mfaSecret   = document.getElementById('adminMfaSecret');
const $mfaOtpAuthUri = document.getElementById('adminMfaOtpAuthUri');
const $mfaRecoveryCodes = document.getElementById('adminMfaRecoveryCodes');
const $mfaEnableCode = document.getElementById('adminMfaEnableCode');
const $mfaEnableBtn = document.getElementById('adminMfaEnableBtn');
const $mfaVerifyCode = document.getElementById('adminMfaVerifyCode');
const $mfaVerifyBtn = document.getElementById('adminMfaVerifyBtn');
const $mfaRecoveryCode = document.getElementById('adminMfaRecoveryCode');
const $mfaRecoveryBtn = document.getElementById('adminMfaRecoveryBtn');
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
const $userPagination = document.getElementById('userPagination');
const $userPaginationStatus = document.getElementById('userPaginationStatus');
const $userLoadMoreBtn = document.getElementById('userLoadMoreBtn');
const $userCreditModal = document.getElementById('userCreditModal');
const $userCreditModalTitle = document.getElementById('userCreditModalTitle');
const $userCreditModalSubtitle = document.getElementById('userCreditModalSubtitle');
const $userCreditModalBody = document.getElementById('userCreditModalBody');

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
    lifecycle: document.getElementById('sectionLifecycle'),
    operations: document.getElementById('sectionOperations'),
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
    'billing-events': { title: 'Billing Events', desc: 'Provider event inspection and Stripe Testmode status' },
    'ai-usage': { title: 'AI Usage',         desc: 'Org-scoped usage attempts, reservations, replay, and cleanup' },
    lifecycle: { title: 'Data Lifecycle',   desc: 'Export, deletion planning, archive, and retention operations' },
    operations: { title: 'Operations',      desc: 'Async AI video diagnostics and operational visibility' },
    readiness: { title: 'Readiness',        desc: 'Release, migration, Cloudflare, and staging verification checklist' },
    users:     { title: 'User Management',  desc: 'Manage users, roles, and sessions' },
    'ai-lab':  { title: 'AI Lab',           desc: 'Admin-only AI tests, previews, and model comparisons' },
    activity:  { title: 'Activity',         desc: 'Audit trail and admin actions' },
    settings:  { title: 'Admin Settings',   desc: 'Safe settings boundaries and deployment-owned configuration' },
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
const ADMIN_MFA_GATE_CODES = new Set([
    'admin_mfa_enrollment_required',
    'admin_mfa_required',
    'admin_mfa_invalid_or_expired',
]);
let adminBootstrapped = false;

function setAdminMfaNotice(message = '', type = 'info') {
    if (!$mfaNotice) return;
    $mfaNotice.textContent = message || '';
    $mfaNotice.style.color = type === 'error'
        ? 'var(--color-danger)'
        : type === 'success'
            ? 'var(--color-success)'
            : 'rgba(255, 255, 255, 0.72)';
}

function clearAdminMfaSetupFields() {
    $mfaSetupFields.style.display = 'none';
    $mfaSecret.value = '';
    $mfaOtpAuthUri.value = '';
    $mfaRecoveryCodes.textContent = '';
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

function setAdminMfaButtonsDisabled(disabled) {
    [
        $mfaSetupBtn,
        $mfaEnableBtn,
        $mfaVerifyBtn,
        $mfaRecoveryBtn,
    ].forEach((button) => {
        if (button) button.disabled = !!disabled;
    });
}

function renderAdminMfaSetup(setup) {
    if (!setup) {
        clearAdminMfaSetupFields();
        return;
    }
    $mfaSecret.value = setup.secret || '';
    $mfaOtpAuthUri.value = setup.otpauthUri || '';
    $mfaRecoveryCodes.textContent = Array.isArray(setup.recoveryCodes)
        ? setup.recoveryCodes.join('\n')
        : '';
    $mfaSetupFields.style.display = '';
}

function renderAdminMfaGate(code, status) {
    showAdminMfaGate();
    clearAdminMfaSetupFields();

    const enrolled = !!status?.enrolled;
    const setupPending = !!status?.setupPending;

    if (code === 'admin_mfa_enrollment_required') {
        $mfaTitle.textContent = 'Admin MFA Enrollment Required';
        $mfaText.textContent = setupPending
            ? 'Finish the pending authenticator setup or generate a fresh secret and recovery code set.'
            : 'Set up an authenticator app and recovery codes before the admin dashboard can be used.';
    } else if (code === 'admin_mfa_invalid_or_expired') {
        $mfaTitle.textContent = 'Admin MFA Verification Required';
        $mfaText.textContent = 'Your admin MFA proof is invalid or expired. Verify with a current authenticator code or a recovery code to continue.';
    } else {
        $mfaTitle.textContent = 'Admin MFA Verification Required';
        $mfaText.textContent = 'Verify with a current authenticator code or a recovery code to continue.';
    }

    $mfaEnrollmentBlock.style.display = enrolled ? 'none' : '';
    $mfaVerifyBlock.style.display = enrolled ? '' : 'none';

    if (!enrolled) {
        $mfaSetupBtn.textContent = setupPending ? 'Regenerate setup secret' : 'Generate setup secret';
        $mfaEnableCode.value = '';
        setAdminMfaNotice(
            setupPending
                ? 'If you already saved the setup secret, enter a current authenticator code below. Otherwise generate a fresh setup secret and recovery codes now.'
                : 'Generate a setup secret, add it to your authenticator app, then confirm with a current code to enable MFA.',
            'info'
        );
    } else {
        $mfaVerifyCode.value = '';
        $mfaRecoveryCode.value = '';
        setAdminMfaNotice(
            code === 'admin_mfa_invalid_or_expired'
                ? 'Verify again to renew admin access.'
                : 'Admin access stays locked until MFA verification succeeds.',
            'info'
        );
    }
}

async function refreshAdminMfaGate(code) {
    const status = await apiAdminMfaStatus();
    if (status.ok) {
        renderAdminMfaGate(code, status.data?.mfa || null);
        return;
    }
    renderAdminMfaGate(code, status.data?.mfa || null);
    setAdminMfaNotice(status.error || 'Failed to load MFA status.', 'error');
}

async function reloadAdminAfterMfa(successMessage) {
    if (successMessage) showToast(successMessage, 'success');
    window.location.reload();
}

async function handleAdminMfaSetupClick() {
    setAdminMfaButtonsDisabled(true);
    setAdminMfaNotice('Generating a new setup secret...', 'info');
    try {
        const res = await apiAdminMfaSetup();
        if (!res.ok) {
            setAdminMfaNotice(res.error || 'Failed to generate an MFA setup secret.', 'error');
            return;
        }
        renderAdminMfaGate('admin_mfa_enrollment_required', {
            ...(res.data?.mfa || {}),
            enrolled: false,
            verified: false,
            setupPending: true,
        });
        renderAdminMfaSetup(res.data?.setup || null);
        setAdminMfaNotice('Setup secret and recovery codes generated. Save them now, then enter a current authenticator code to enable MFA.', 'success');
    } finally {
        setAdminMfaButtonsDisabled(false);
    }
}

async function handleAdminMfaEnableClick() {
    setAdminMfaButtonsDisabled(true);
    setAdminMfaNotice('Verifying setup code...', 'info');
    try {
        const res = await apiAdminMfaEnable($mfaEnableCode.value.trim());
        if (!res.ok) {
            setAdminMfaNotice(res.error || 'Failed to enable admin MFA.', 'error');
            return;
        }
        await reloadAdminAfterMfa('Admin MFA enabled.');
    } finally {
        setAdminMfaButtonsDisabled(false);
    }
}

async function handleAdminMfaVerifyClick(mode) {
    setAdminMfaButtonsDisabled(true);
    setAdminMfaNotice(
        mode === 'recovery'
            ? 'Validating recovery code...'
            : 'Validating authenticator code...',
        'info'
    );
    try {
        const res = await apiAdminMfaVerify(
            mode === 'recovery'
                ? { recoveryCode: $mfaRecoveryCode.value.trim() }
                : { code: $mfaVerifyCode.value.trim() }
        );
        if (!res.ok) {
            setAdminMfaNotice(res.error || 'Failed to verify admin MFA.', 'error');
            return;
        }
        await reloadAdminAfterMfa('Admin MFA verified.');
    } finally {
        setAdminMfaButtonsDisabled(false);
    }
}

function bindAdminMfaGate() {
    if ($mfaGate.dataset.bound === '1') return;
    $mfaGate.dataset.bound = '1';

    $mfaSetupBtn?.addEventListener('click', () => {
        handleAdminMfaSetupClick().catch((error) => {
            console.warn(error);
            setAdminMfaNotice('Failed to generate an MFA setup secret.', 'error');
            setAdminMfaButtonsDisabled(false);
        });
    });
    $mfaEnableBtn?.addEventListener('click', () => {
        handleAdminMfaEnableClick().catch((error) => {
            console.warn(error);
            setAdminMfaNotice('Failed to enable admin MFA.', 'error');
            setAdminMfaButtonsDisabled(false);
        });
    });
    $mfaVerifyBtn?.addEventListener('click', () => {
        handleAdminMfaVerifyClick('totp').catch((error) => {
            console.warn(error);
            setAdminMfaNotice('Failed to verify admin MFA.', 'error');
            setAdminMfaButtonsDisabled(false);
        });
    });
    $mfaRecoveryBtn?.addEventListener('click', () => {
        handleAdminMfaVerifyClick('recovery').catch((error) => {
            console.warn(error);
            setAdminMfaNotice('Failed to verify the recovery code.', 'error');
            setAdminMfaButtonsDisabled(false);
        });
    });
}

function bootstrapAdminPanel() {
    if (adminBootstrapped) return;
    adminBootstrapped = true;

    $denied.style.display = 'none';
    $panel.style.display = '';
    $adminNav.style.display = '';

    initAvatarDropdown();
    initLightbox();
    bindUserCreditModal();
    controlPlane.bind();

    $searchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        loadUsers($searchInput.value.trim());
    });

    $userLoadMoreBtn?.addEventListener('click', () => {
        if (!usersHasMore || !usersNextCursor) return;
        loadUsers($searchInput.value.trim(), { append: true });
    });

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
const numberFormatter = new Intl.NumberFormat('en-US');

function formatDate(iso) {
    if (!iso) return '\u2014';
    return dtf.format(new Date(iso));
}

function formatCredits(value) {
    return `${numberFormatter.format(Number(value || 0))} credits`;
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

async function copyText(text, successMessage = 'Copied.') {
    if (!text) return;
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.setAttribute('readonly', '');
            textarea.style.position = 'fixed';
            textarea.style.insetInlineStart = '-9999px';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            textarea.remove();
        }
        showToast(successMessage, 'success');
    } catch {
        showToast('Copy failed.', 'error');
    }
}

function shortUserId(userId) {
    const value = String(userId || '');
    if (value.length <= 18) return value;
    return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function createUserIdMeta(userId, { compact = false } = {}) {
    const wrap = document.createElement('div');
    wrap.className = `admin-user-id${compact ? ' admin-user-id--compact' : ''}`;

    const code = document.createElement('code');
    code.className = 'admin-user-id__code';
    code.textContent = compact ? shortUserId(userId) : String(userId || '');
    code.title = String(userId || '');

    const copy = createActionBtn('Copy', (event) => {
        event.stopPropagation();
        copyText(String(userId || ''), 'User ID copied.');
    });
    copy.classList.add('admin-user-id__copy');
    copy.setAttribute('aria-label', `Copy user ID ${userId}`);

    wrap.append(code, copy);
    return wrap;
}

/* ═══════════════════════════════════════════════════════════
   Section Routing
   ═══════════════════════════════════════════════════════════ */
let currentSection = 'dashboard';
let dashboardVersion = 0;
let usersVersion = 0;
let usersEntries = [];
let usersNextCursor = null;
let usersHasMore = false;
const USERS_LIMIT = 50;
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
    });
    if (name === 'users') loadUsers($searchInput.value.trim());
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

    const idMeta = document.createElement('div');
    idMeta.className = 'admin-mobile-card__meta admin-mobile-card__meta--id';
    const idLabel = document.createElement('span');
    idLabel.className = 'admin-mobile-card__label';
    idLabel.textContent = 'User ID';
    idMeta.appendChild(idLabel);
    idMeta.appendChild(createUserIdMeta(user.id, { compact: true }));

    // Actions (same logic as desktop)
    const actions = document.createElement('div');
    actions.className = 'admin-mobile-card__actions';

    actions.appendChild(createActionBtn(
        'Credits',
        () => openUserCreditDetails(user),
    ));

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
    content.appendChild(idMeta);
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
   Users — Credit details overlay
   ═══════════════════════════════════════════════════════════ */
function setUserCreditModalOpen(open) {
    if (!$userCreditModal) return;
    $userCreditModal.hidden = !open;
    $userCreditModal.setAttribute('aria-hidden', open ? 'false' : 'true');
    document.body.classList.toggle('modal-open', open);
}

function closeUserCreditDetails() {
    setUserCreditModalOpen(false);
}

function userCreditState(message, variant = '') {
    const box = document.createElement('div');
    box.className = `admin-credit-modal__state${variant ? ` admin-credit-modal__state--${variant}` : ''}`;
    box.textContent = message;
    return box;
}

function creditMetric(label, value) {
    const card = document.createElement('article');
    card.className = 'admin-credit-modal__metric';
    const labelEl = document.createElement('span');
    labelEl.className = 'admin-credit-modal__metric-label';
    labelEl.textContent = label;
    const valueEl = document.createElement('strong');
    valueEl.className = 'admin-credit-modal__metric-value';
    valueEl.textContent = value;
    card.append(labelEl, valueEl);
    return card;
}

function transactionDetails(item = {}) {
    const usage = item.usage || {};
    return [
        usage.model,
        usage.action || usage.route,
        usage.pricingSource,
        item.featureKey,
        item.createdByEmail ? `by ${item.createdByEmail}` : null,
        item.id ? `ref ${shortUserId(item.id)}` : null,
    ].filter(Boolean).join(' • ') || 'Not reported';
}

function renderUserCreditTransactions(rows = []) {
    const wrap = document.createElement('div');
    wrap.className = 'admin-credit-modal__table-wrap';
    const table = document.createElement('table');
    table.className = 'admin-table admin-credit-modal__table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    ['Date', 'Type', 'Description', 'Details', 'Amount', 'Balance'].forEach((heading) => {
        const th = document.createElement('th');
        th.textContent = heading;
        headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    if (!rows.length) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 6;
        cell.className = 'admin-credit-modal__empty-cell';
        cell.textContent = 'No member credit transactions yet.';
        row.appendChild(cell);
        tbody.appendChild(row);
    } else {
        for (const item of rows) {
            const row = document.createElement('tr');
            [
                formatDate(item.createdAt),
                item.type || item.entryType || 'Not reported',
                item.description || item.reason || item.source || 'Not reported',
                transactionDetails(item),
                formatCredits(item.amount),
                formatCredits(item.balanceAfter),
            ].forEach((value) => {
                const cell = document.createElement('td');
                cell.textContent = value;
                row.appendChild(cell);
            });
            tbody.appendChild(row);
        }
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
}

function renderUserCreditDetails(user, billing = {}) {
    if (!$userCreditModalBody) return;
    const balance = billing.balance || {};
    const transactions = Array.isArray(billing.transactions) ? billing.transactions : [];

    $userCreditModalBody.textContent = '';
    const identity = document.createElement('div');
    identity.className = 'admin-credit-modal__identity';

    const email = document.createElement('div');
    email.className = 'admin-credit-modal__identity-email';
    email.textContent = billing.email || user.email || 'Unknown email';
    identity.appendChild(email);
    identity.appendChild(createUserIdMeta(billing.userId || user.id));
    $userCreditModalBody.appendChild(identity);

    const metrics = document.createElement('div');
    metrics.className = 'admin-credit-modal__metrics';
    metrics.append(
        creditMetric('Current balance', formatCredits(balance.current ?? billing.creditBalance)),
        creditMetric('Daily top-up target', formatCredits(balance.dailyAllowance ?? billing.dailyCreditAllowance)),
        creditMetric('Incoming credits', formatCredits(balance.lifetimeIncoming)),
        creditMetric('Consumed credits', formatCredits(balance.lifetimeConsumed)),
        creditMetric('Manual grants', formatCredits(balance.lifetimeManualGrants)),
    );
    $userCreditModalBody.appendChild(metrics);

    const topUp = document.createElement('div');
    topUp.className = 'admin-credit-modal__topup';
    topUp.textContent = billing.dailyTopUp
        ? `Daily top-up: ${formatCredits(billing.dailyTopUp.grantedCredits)} granted for ${formatDate(billing.dailyTopUp.dayStart)}.`
        : `Daily top-up target: ${formatCredits(balance.dailyAllowance ?? billing.dailyCreditAllowance)}. Admin inspection does not apply a top-up.`;
    $userCreditModalBody.appendChild(topUp);

    const sectionTitle = document.createElement('h3');
    sectionTitle.className = 'admin-credit-modal__section-title';
    sectionTitle.textContent = 'Recent transactions';
    $userCreditModalBody.appendChild(sectionTitle);
    $userCreditModalBody.appendChild(renderUserCreditTransactions(transactions));
}

async function openUserCreditDetails(user) {
    if (!$userCreditModal || !$userCreditModalBody) return;
    if ($userCreditModalTitle) $userCreditModalTitle.textContent = 'Credit details';
    if ($userCreditModalSubtitle) $userCreditModalSubtitle.textContent = `${user.email || 'Selected user'} • ${shortUserId(user.id)}`;
    $userCreditModalBody.textContent = '';
    $userCreditModalBody.appendChild(userCreditState('Loading credit details...'));
    setUserCreditModalOpen(true);

    let res = null;
    try {
        res = await apiAdminUserBilling(user.id);
    } catch {
        res = { ok: false, error: 'Could not load credit details.' };
    }
    if (!res.ok) {
        $userCreditModalBody.textContent = '';
        $userCreditModalBody.appendChild(userCreditState(res.error || 'Could not load credit details.', 'error'));
        return;
    }
    renderUserCreditDetails(user, res.data?.billing || {});
}

function bindUserCreditModal() {
    if (!$userCreditModal || $userCreditModal.dataset.bound === '1') return;
    $userCreditModal.dataset.bound = '1';
    $userCreditModal.querySelectorAll('[data-user-credit-close]').forEach((button) => {
        button.addEventListener('click', closeUserCreditDetails);
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !$userCreditModal.hidden) closeUserCreditDetails();
    });
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
        updateUsersPagination([]);
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

        // User ID
        const tdUserId = document.createElement('td');
        tdUserId.className = 'admin-user-id-cell';
        tdUserId.appendChild(createUserIdMeta(user.id, { compact: true }));
        tr.appendChild(tdUserId);

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

        actionsWrap.appendChild(
            createActionBtn('Credits', () => openUserCreditDetails(user)),
        );

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

    updateUsersPagination(users);
}

function updateUsersPagination(users) {
    if (!$userPagination || !$userPaginationStatus || !$userLoadMoreBtn) return;
    if (!users || users.length === 0) {
        $userPagination.style.display = 'none';
        $userPaginationStatus.textContent = '';
        return;
    }

    $userPagination.style.display = '';
    $userPaginationStatus.textContent = usersHasMore
        ? `Showing ${users.length} users.`
        : `Showing all ${users.length} users.`;
    $userLoadMoreBtn.disabled = false;
    $userLoadMoreBtn.textContent = 'Load more users';
    $userLoadMoreBtn.style.display = usersHasMore ? '' : 'none';
}

/* ═══════════════════════════════════════════════════════════
   Users — Load
   ═══════════════════════════════════════════════════════════ */
async function loadUsers(search, { append = false } = {}) {
    const myVersion = ++usersVersion;
    const normalizedSearch = search?.trim() || '';

    if (!append) {
        usersEntries = [];
        usersNextCursor = null;
        usersHasMore = false;
        $loading.style.display = '';
        $empty.style.display = 'none';
        $table.style.display = 'none';
        $mobileSec.style.display = 'none';
        if ($userPagination) $userPagination.style.display = 'none';
    } else if ($userLoadMoreBtn) {
        $userLoadMoreBtn.disabled = true;
        $userLoadMoreBtn.textContent = 'Loading...';
    }

    const res = await apiAdminUsers(normalizedSearch || undefined, {
        limit: USERS_LIMIT,
        cursor: append ? usersNextCursor : undefined,
    });

    // Ignore stale response if a newer load was initiated
    if (myVersion !== usersVersion) return;

    if (!append) {
        $loading.style.display = 'none';
    } else if ($userLoadMoreBtn) {
        $userLoadMoreBtn.disabled = false;
        $userLoadMoreBtn.textContent = 'Load more users';
    }

    if (!res.ok) {
        showToast(res.error, 'error');
        return;
    }

    const users = Array.isArray(res.data?.users)
        ? res.data.users
        : Array.isArray(res.data)
            ? res.data
            : [];
    usersEntries = append ? usersEntries.concat(users) : users;
    usersNextCursor = typeof res.data?.next_cursor === 'string' ? res.data.next_cursor : null;
    usersHasMore = res.data?.has_more === true;

    renderUsers(usersEntries);
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
    bindAdminMfaGate();

    // Auth check
    const me = await apiAdminMe();

    if (!me.ok) {
        if (ADMIN_MFA_GATE_CODES.has(me.code)) {
            await refreshAdminMfaGate(me.code);
            return;
        }
        showAccessDenied();
        return;
    }

    bootstrapAdminPanel();
}

init();
