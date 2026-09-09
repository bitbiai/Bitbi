import { loadAdminModule } from './module-loader.js?v=__ASSET_VERSION__';
/* BITBI Admin — authenticated, on-demand workspace. */
import { initSiteHeader } from '../../shared/site-header.js?v=__ASSET_VERSION__';
import { initCookieConsent } from '../../shared/cookie-consent.js?v=__ASSET_VERSION__';
import { apiAdminMe } from '../../shared/auth-api.js?v=__ASSET_VERSION__';
// Use the same module identity initialized by site-header/auth-nav/wallet.
import { getAuthState } from '../../shared/auth-state.js';
import { createAdminNav } from './nav.js?v=__ASSET_VERSION__';
import { createAdminRouter } from './router.js?v=__ASSET_VERSION__';
import { ADMIN_MFA_GATE_CODES, createAdminMfaGate } from './security.js?v=__ASSET_VERSION__';

const $denied = document.getElementById('adminDenied');
const $deniedMessage = document.getElementById('adminDeniedMessage');
const $mfaGate = document.getElementById('adminMfaGate');
const $panel = document.getElementById('adminPanel');
const $adminNav = document.getElementById('adminNav');
const $toast = document.getElementById('adminToast');
let currentAdminUser = null;
let authorizationLost = false;
let authorizationUncertain = false;
const instances = new Map();
const pending = new Map();
const nav = createAdminNav();

function showToast(message, type = 'success') {
    if (authorizationLost || authorizationUncertain) return;
    const node = document.createElement('div');
    node.className = `admin-toast__item admin-toast__item--${type}`;
    node.textContent = message;
    $toast.append(node);
    setTimeout(() => node.remove(), 5000);
}
const common = { showToast, formatDate, formatApiError, shortUserId };
// Literal, versioned imports are rewritten by the existing static build.
const factories = {
    dashboard: () => loadAdminModule(new URL('./dashboard.js?v=__ASSET_VERSION__', import.meta.url)).then(m => () => m.createAdminDashboard({ ...common,
        loadCapabilities: isCurrent => getDomain('control', isCurrent).then(d => d?.load('dashboard', { isCurrent })),
    })),
    control: () => loadAdminModule(new URL('./control-plane.js?v=__ASSET_VERSION__', import.meta.url)).then(m => () => m.createAdminControlPlane(common)),
    users: () => Promise.all([
        loadAdminModule(new URL('./users.js?v=__ASSET_VERSION__', import.meta.url)), loadAdminModule(new URL('./settings.js?v=__ASSET_VERSION__', import.meta.url)),
        loadAdminModule(new URL('./avatar-lightbox.js?v=__ASSET_VERSION__', import.meta.url)),
    ]).then(([u,s,a]) => () => {
        const users = u.createAdminUsersDomain({ ...common, getCurrentAdminUser: () => currentAdminUser,
            invalidateStats: () => instances.get('dashboard')?.invalidate() });
        const registration = s.createRegistrationAvailabilityPanel(common);
        const avatars = a.createAdminAvatarLightbox();
        return { ...users, hide() { users.hide?.(); registration.hide?.(); }, bind() { users.bind(); registration.bind(); avatars.bind(); },
            async load() { await Promise.all([registration.load(), users.load()]); } };
    }),
    activity: () => loadAdminModule(new URL('./activity.js?v=__ASSET_VERSION__', import.meta.url)).then(m => () => m.createAdminActivity(common)),
    newsfeed: () => loadAdminModule(new URL('./newsfeed.js?v=__ASSET_VERSION__', import.meta.url)).then(m => () => m.createAdminNewsfeed()),
    news: () => loadAdminModule(new URL('./news-feed-agent.js?v=__ASSET_VERSION__', import.meta.url)).then(m => () => m.createAdminNewsFeedAgent(common)),
    hero: () => loadAdminModule(new URL('./homepage-hero-videos.js?v=__ASSET_VERSION__', import.meta.url)).then(m => () => m.createHomepageHeroVideosAdmin(common)),
    ai: () => loadAdminModule(new URL('./ai-lab.js?v=__ASSET_VERSION__', import.meta.url)).then(m => () => m.createAdminAiLab(common)),
    fable: () => loadAdminModule(new URL('./fable-data-center.js?v=__ASSET_VERSION__', import.meta.url)).then(m => () => m.createAdminFableDataCenter({ ...common,
        onOpen: () => instances.get('ai')?.setActive(false), onClose: () => instances.get('ai')?.show(),
    })),
};
async function getDomain(key, isCurrent = () => true) {
    if (!isCurrent() || authorizationLost || authorizationUncertain || !currentAdminUser) return null;
    if (instances.has(key)) return instances.get(key);
    if (!pending.has(key)) pending.set(key, factories[key]().catch(error => { pending.delete(key); throw error; }));
    const factory = await pending.get(key);
    if (!isCurrent() || authorizationLost || authorizationUncertain || !currentAdminUser) return null;
    if (!instances.has(key)) { const instance = factory(); instance.bind?.(); instances.set(key, instance); }
    return instances.get(key);
}
const sectionDomain = { dashboard:'dashboard', users:'users', activity:'activity', newsfeed:'newsfeed', 'news-feed-agent':'news', 'homepage-hero-videos':'hero', 'ai-lab':'ai' };
function leaveSection(previous, next) {
    if (previous === next) return;
    for (const [key, instance] of instances) {
        if (key === 'control') instance.leave?.(previous, next);
        else if (key !== sectionDomain[next]) { instance.setActive?.(false); instance.hide?.(); }
    }
}
async function loadAdminSection(name, { context, isCurrent, panel } = {}) {
    if (authorizationLost || authorizationUncertain) return;
    const key = sectionDomain[name] || 'control';
    const domain = await getDomain(key, isCurrent);
    if (!domain || !isCurrent()) return;
    domain.setActive?.(true);
    if (key === 'control') return domain.load(name, { context, isCurrent });
    if (key === 'ai') {
        domain.show?.();
        const card = document.getElementById('fableDataCard');
        async function openFable() {
            try {
                const fable = await getDomain('fable', isCurrent);
                if (!isCurrent() || !fable) return;
                card?.querySelector('[data-fable-load-error]')?.remove();
                if (panel !== 'fableDataCard' && !document.getElementById('fableDataWorkspace')?.hidden) fable.close?.();
                fable.show?.();
                if (panel === 'fableDataCard') document.getElementById('fableDataOpen')?.click();
            } catch {
                if (!isCurrent() || !card) return;
                card.querySelector('[data-fable-load-error]')?.remove();
                const message = document.createElement('div'); message.dataset.fableLoadError=''; message.setAttribute('role','alert');
                message.textContent = 'Fable data could not be loaded. AI Lab remains available. ';
                const retry = document.createElement('button'); retry.type='button'; retry.className='btn-action'; retry.textContent='Retry Fable data';
                retry.addEventListener('click', async () => { if (retry.disabled) return; retry.disabled=true; await openFable(); retry.disabled=false; });
                message.append(retry); card.append(message);
            }
        }
        await openFable();
        return;
    }
    await domain.load?.();
    if (context?.userId && key === 'users' && isCurrent()) await domain.openUser?.(context.userId);
}
const router = createAdminRouter({ heroTitle:document.getElementById('adminHeroTitle'), heroDesc:document.getElementById('adminHeroDesc'), nav, loadSection:loadAdminSection, leaveSection });
function showAccessDenied() {
    $panel.style.display = 'none'; $adminNav.style.display = 'none';
    document.getElementById('adminNavToggle')?.setAttribute('hidden','');
    $denied.style.display = ''; $denied.classList.add('visible');
    $deniedMessage.style.display = ''; $mfaGate.style.display = 'none';
    $deniedMessage.querySelector('.admin-denied__title').textContent = 'Access Denied';
    $deniedMessage.querySelector('.admin-denied__text').textContent = 'You do not have permission to access this area. Please sign in with an admin account.';
    document.getElementById('adminSessionRetry')?.remove();
}
function showSessionUncertain() {
    authorizationUncertain = true;
    router.stop(); leaveSection(router.getCurrentSection(), null);
    document.querySelector('.admin-delete-dialog [aria-label="Cancel user deletion"]')?.click();
    document.getElementById('avatarLightbox')?.classList.remove('admin-lightbox--visible');
    document.getElementById('avatarLightbox')?.setAttribute('aria-hidden', 'true');
    showAccessDenied();
    $deniedMessage.querySelector('.admin-denied__title').textContent = 'Admin session check unavailable';
    $deniedMessage.querySelector('.admin-denied__text').textContent = 'Session status could not be confirmed. Admin work is hidden; this does not confirm a sign-out. Reload to check again. Reloading discards unsaved drafts.';
    const retry = document.createElement('button'); retry.id = 'adminSessionRetry'; retry.type = 'button'; retry.className = 'btn-action';
    retry.textContent = 'Reload to check again'; retry.addEventListener('click', () => window.location.reload());
    $deniedMessage.append(retry);
}
function showAdminMfaGate() {
    showAccessDenied(); $deniedMessage.style.display = 'none'; $mfaGate.style.display = '';
}
const adminMfaGate = createAdminMfaGate({ showToast, showGate:showAdminMfaGate });
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


async function init() {
    try { initSiteHeader(); } catch (error) { console.warn(error); }
    try { initCookieConsent(); } catch (error) { console.warn(error); }
    nav.bindOffset(); adminMfaGate.bind();
    const me = await apiAdminMe();
    if (!me.ok) {
        if (ADMIN_MFA_GATE_CODES.has(me.code)) await adminMfaGate.refresh(me.code);
        // Only the structured authorization response establishes a denial.
        // A gateway page, network error or service failure establishes neither access nor logout.
        else if ([401, 403].includes(me.status) && me.data?.ok === false
            && typeof me.data.error === 'string' && me.data.error.trim()) showAccessDenied();
        else showSessionUncertain();
        return;
    }
    const candidate = me.data?.user || me.data?.admin || null;
    if (me.data?.ok === false || typeof candidate?.id !== 'string' || !candidate.id.trim()
        || typeof candidate.role !== 'string' || !candidate.role.trim()) { showSessionUncertain(); return; }
    if (candidate.role !== 'admin') { showAccessDenied(); return; }
    const auth = getAuthState();
    if (auth.ready && auth.sessionConfirmed === false) { showSessionUncertain(); return; }
    if (auth.ready && (!auth.loggedIn || auth.user?.id !== candidate.id || auth.user?.role !== 'admin')) { showAccessDenied(); return; }
    // Never expose an identity to navigation until both available checks agree.
    currentAdminUser = candidate;
    $denied.style.display = 'none'; $panel.style.display = ''; $adminNav.style.display = '';
    document.getElementById('adminNavToggle')?.removeAttribute('hidden');
    nav.bind(); router.bind();
}
// WebKit does not consistently scroll a focused region on arrow keys.
// Handle only the region itself; inputs and table action buttons keep native keys.
$panel.addEventListener('keydown', event => {
    const region = event.target;
    if (!region.matches?.('.admin-table-wrap') || !['ArrowLeft', 'ArrowRight'].includes(event.key)
        || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
        || region.scrollWidth <= region.clientWidth) return;
    event.preventDefault();
    region.scrollBy({ left: event.key === 'ArrowRight' ? 64 : -64, behavior: 'instant' });
});
document.addEventListener('admin:open-context', event => {
    if (!currentAdminUser || authorizationLost || authorizationUncertain) return;
    const { section, userId, orgId, eventId, attemptId } = event.detail || {};
    if (!['users','orgs','billing','billing-events','ai-usage','lifecycle'].includes(section)) return;
    const context = Object.fromEntries(Object.entries({userId,orgId,eventId,attemptId}).filter(([,value]) => typeof value === 'string' && value.length > 0 && value.length <= 200));
    router.navigate(section, { context });
});
document.addEventListener('bitbi:auth-change', ({ detail }) => {
    if (!currentAdminUser || !detail?.ready) return;
    if (detail.sessionConfirmed === false) { if (!authorizationLost) showSessionUncertain(); return; }
    if (detail.loggedIn && detail.user?.id === currentAdminUser.id && detail.user?.role === 'admin') return;
    authorizationLost = true; authorizationUncertain = false; currentAdminUser = null;
    router.stop(); leaveSection(router.getCurrentSection(), null);
    // Settle a still-unsubmitted destructive confirmation through its normal cancel path.
    document.querySelector('.admin-delete-dialog [aria-label="Cancel user deletion"]')?.click();
    instances.clear(); pending.clear(); $panel.replaceChildren(); $toast.replaceChildren();
    // These private overlays live outside #adminPanel; hiding alone retains their contents.
    for (const id of ['userInfoModalBody','userInfoModalSubtitle','userStorageModalBody','userStorageModalSubtitle','userCreditModalBody','userCreditModalSubtitle','lightboxName','lightboxEmail']) {
        document.getElementById(id)?.replaceChildren();
    }
    const lightbox = document.getElementById('avatarLightbox');
    lightbox?.setAttribute('aria-hidden','true'); lightbox?.classList.remove('admin-lightbox--visible');
    document.getElementById('lightboxImg')?.removeAttribute('src');
    document.getElementById('lightboxImg')?.setAttribute('alt','');
    document.body.classList.remove('modal-open');
    showAccessDenied();
});
window.addEventListener('pagehide', () => leaveSection(router.getCurrentSection(), null));
init();
