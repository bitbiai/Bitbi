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
} from '../../shared/auth-api.js?v=__ASSET_VERSION__';
import { createAdminActivity } from './activity.js?v=__ASSET_VERSION__';
import { createAdminAiLab } from './ai-lab.js?v=__ASSET_VERSION__';
import { createAdminFableDataCenter } from './fable-data-center.js?v=__ASSET_VERSION__';
import { createAdminAvatarLightbox } from './avatar-lightbox.js?v=__ASSET_VERSION__';
import { createAdminControlPlane } from './control-plane.js?v=__ASSET_VERSION__';
import { createAdminDashboard } from './dashboard.js?v=__ASSET_VERSION__';
import { createHomepageHeroVideosAdmin } from './homepage-hero-videos.js?v=__ASSET_VERSION__';
import { createAdminNav } from './nav.js?v=__ASSET_VERSION__';
import { createAdminNewsFeedAgent } from './news-feed-agent.js?v=__ASSET_VERSION__';
import { createAdminRouter } from './router.js?v=__ASSET_VERSION__';
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
const fableDataCenter = createAdminFableDataCenter({
    showToast,
    formatDate: (value) => formatDate(value),
    onClose: () => aiLab.show(),
});
const controlPlane = createAdminControlPlane({ showToast, formatDate });
const dashboard = createAdminDashboard({ showToast });
const homepageHeroVideos = createHomepageHeroVideosAdmin({ showToast, formatDate, formatApiError });
const newsFeedAgent = createAdminNewsFeedAgent({ showToast, formatDate, formatApiError });
const adminNav = createAdminNav();
const adminActivity = createAdminActivity({ showToast, formatDate });
const adminAvatars = createAdminAvatarLightbox();
const adminMfaGate = createAdminMfaGate({ showToast, showGate: showAdminMfaGate });
const adminUsers = createAdminUsersDomain({
    showToast,
    formatDate,
    formatApiError,
    getCurrentAdminUser: () => currentAdminUser,
    invalidateStats: () => dashboard.invalidate(),
});
const registrationAvailability = createRegistrationAvailabilityPanel({
    showToast,
    formatDate,
    formatApiError,
    shortUserId,
});
let adminBootstrapped = false;
let currentAdminUser = null;

const router = createAdminRouter({
    heroTitle: $heroTitle,
    heroDesc: $heroDesc,
    nav: adminNav,
    loadSection: loadAdminSection,
});

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
    homepageHeroVideos.bind();
    newsFeedAgent.bind();
    controlPlane.bind();
    fableDataCenter.bind();

    adminNav.bind();
    router.bind();
}

/* ═══════════════════════════════════════════════════════════
   Date formatter
   ═══════════════════════════════════════════════════════════ */
const ADMIN_OPERATOR_LOCALE = 'en-GB';

const dtf = new Intl.DateTimeFormat(ADMIN_OPERATOR_LOCALE, {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
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

function loadAdminSection(name) {
    if (name === 'dashboard') dashboard.load();
    const controlPlanePromise = controlPlane.load(name).catch((error) => {
        console.warn(error);
        showToast('Failed to load control-plane section.', 'error');
    });
    if (name === 'users') {
        registrationAvailability.load();
        adminUsers.load();
    }
    if (name === 'activity') adminActivity.load();
    if (name === 'news-feed-agent') newsFeedAgent.load();
    if (name === 'homepage-hero-videos') homepageHeroVideos.load();
    if (name === 'ai-lab') {
        aiLab.show();
        fableDataCenter.show();
    }
    return controlPlanePromise;
}

/* ═══════════════════════════════════════════════════════════
   Init
   ═══════════════════════════════════════════════════════════ */
async function init() {
    // Shared modules
    try { initSiteHeader(); }               catch (e) { console.warn(e); }
    adminNav.bindOffset();
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
