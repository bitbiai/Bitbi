/* ============================================================
   BITBI — Assets Manager Page
   Entry point for account/assets-manager.html
   ============================================================ */

import { initSiteHeader }    from '../../shared/site-header.js?v=__ASSET_VERSION__';
import { initParticles }     from '../../shared/particles.js';
import { initBinaryRain }    from '../../shared/binary-rain.js';
import { initBinaryFooter }  from '../../shared/binary-footer.js';
import { initScrollReveal }  from '../../shared/scroll-reveal.js';
import { initCookieConsent } from '../../shared/cookie-consent.js';

import {
    apiAdminHomepageHeroVideos,
    apiGetMe,
} from '../../shared/auth-api.js?v=__ASSET_VERSION__';
import { createSavedAssetsBrowser } from '../../shared/saved-assets-browser.js?v=__ASSET_VERSION__';
import { localizedHref, localeText } from '../../shared/locale.js?v=__ASSET_VERSION__';
import { renderPostAuthHint } from '../../shared/auth-post-auth-hint.js?v=__ASSET_VERSION__';
import { createManualHeroVideoUploadController } from '../admin/manual-hero-video-upload.js?v=__ASSET_VERSION__';

const $loading = document.getElementById('loadingState');
const $denied  = document.getElementById('deniedState');
const $content = document.getElementById('studioContent');

let savedAssetsBrowser = null;
let adminUploadController = null;
let adminUploadEnabled = false;
let adminUploadLastTrigger = null;
let adminUploadStatusAbort = null;

const isGermanPage = document.documentElement.lang?.toLowerCase().startsWith('de');
const adminUploadCopy = isGermanPage
    ? {
        ready: 'Bereit zum Hochladen.',
        checking: 'Status der manuellen Uploads wird geprüft...',
        enabled: 'Manuelle Uploads sind aktiviert.',
        disabled: 'Manuelle Uploads sind derzeit deaktiviert.',
        statusFailed: 'Der Status manueller Uploads konnte nicht geladen werden.',
        success: 'Video-Asset hochgeladen. Die Asset-Liste wurde aktualisiert.',
        successToast: 'Video-Asset hochgeladen.',
        uploadStatus: 'Privates Video-Asset wird hochgeladen...',
        error: 'Video-Upload fehlgeschlagen.',
        reasonError: 'Geben Sie vor dem Upload einen Operator-Grund ein.',
        disabledMessage: 'Manuelle Uploads sind durch den Admin-Schalter oder Worker deaktiviert.',
        title: 'Manual source upload',
        description: 'Uploads create private admin source assets only. Public playback still requires an optimized derivative.',
    }
    : {
        ready: 'Ready to upload.',
        checking: 'Checking manual upload availability...',
        enabled: 'Manual uploads are enabled.',
        disabled: 'Manual uploads are currently disabled.',
        statusFailed: 'Manual upload status could not be loaded.',
        success: 'Video asset uploaded. Assets Manager refreshed.',
        successToast: 'Video asset uploaded.',
        uploadStatus: 'Uploading private video asset...',
        error: 'Video upload failed.',
        reasonError: 'Enter an operator reason before uploading.',
        disabledMessage: 'Manual uploads are disabled by the Admin switch or Worker hard-disable.',
        title: 'Manual source upload',
        description: 'Uploads create private admin source assets only. Public playback still requires an optimized derivative.',
    };

function hasGenerateLabHandoff() {
    try {
        const url = new URL(window.location.href);
        const params = url.searchParams;
        return params.get('source') === 'generate-lab'
            || params.get('recent') === '1'
            || url.hash === '#generate-lab-recent';
    } catch {
        return false;
    }
}

function clearGenerateLabHandoffQuery() {
    try {
        const url = new URL(window.location.href);
        url.searchParams.delete('source');
        url.searchParams.delete('recent');
        if (url.hash === '#generate-lab-recent') url.hash = '';
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    } catch {
        // Query cleanup is only a UI convenience; keep the banner dismissible if history is unavailable.
    }
}

function showState(el) {
    $loading.style.display = 'none';
    $denied.style.display = 'none';
    $content.style.display = 'none';
    el.style.display = '';
}

function isAuthFailure(res) {
    return res?.status === 401 || res?.status === 403;
}

function showDeniedState({ sessionExpired = false } = {}) {
    if (sessionExpired && $denied) {
        const title = document.getElementById('assetsDeniedTitle');
        const copy = $denied.querySelector('.studio-denied__text');
        const primary = $denied.querySelector('[data-auth-entry="login"]');
        $denied.setAttribute('role', 'status');
        $denied.setAttribute('aria-live', 'polite');
        if (title) title.textContent = localeText('authRecovery.sessionExpiredTitle');
        if (copy) copy.textContent = localeText('authRecovery.sessionExpiredAssetsCopy');
        if (primary) primary.textContent = localeText('authRecovery.sessionSignInAgain');
    }
    showState($denied);
    $denied.classList.add('visible');
}

function isAdminUser(user) {
    return String(user?.role || '').toLowerCase() === 'admin';
}

function setAdminUploadStatus(message, state = '') {
    const status = document.getElementById('studioAdminUploadVideoStatus');
    if (!status) return;
    status.textContent = message || '';
    if (state) status.dataset.state = state;
    else delete status.dataset.state;
}

function formatApiError(res, fallback) {
    return res?.data?.error || res?.error || fallback;
}

function adminManualUploadsEnabledFromPayload(payload = {}) {
    if (typeof payload.manual_uploads_enabled === 'boolean') return payload.manual_uploads_enabled;
    const feature = payload.feature_status?.features?.homepage_hero_manual_uploads;
    if (typeof feature?.effective_enabled === 'boolean') return feature.effective_enabled;
    return false;
}

function renderAdminUploadForm() {
    const mount = document.getElementById('studioAdminUploadVideoForm');
    if (!mount || !adminUploadController) return;
    mount.replaceChildren(adminUploadController.renderPanel());
}

async function refreshAdminUploadAvailability() {
    if (adminUploadStatusAbort) {
        adminUploadStatusAbort.abort();
    }
    adminUploadStatusAbort = new AbortController();
    adminUploadEnabled = false;
    setAdminUploadStatus(adminUploadCopy.checking);
    renderAdminUploadForm();
    try {
        const res = await apiAdminHomepageHeroVideos({ signal: adminUploadStatusAbort.signal });
        if (!res.ok) {
            adminUploadEnabled = false;
            setAdminUploadStatus(formatApiError(res, adminUploadCopy.statusFailed), 'error');
            renderAdminUploadForm();
            return;
        }
        adminUploadEnabled = adminManualUploadsEnabledFromPayload(res.data?.data || res.data || {});
        setAdminUploadStatus(
            adminUploadEnabled ? adminUploadCopy.enabled : adminUploadCopy.disabled,
            adminUploadEnabled ? '' : 'warning',
        );
        renderAdminUploadForm();
    } catch (error) {
        if (error?.name === 'AbortError') return;
        console.warn('Assets Manager manual upload status failed:', error);
        adminUploadEnabled = false;
        setAdminUploadStatus(adminUploadCopy.statusFailed, 'error');
        renderAdminUploadForm();
    }
}

function closeAdminUploadModal() {
    const modal = document.getElementById('studioAdminUploadVideoModal');
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    adminUploadStatusAbort?.abort();
    adminUploadStatusAbort = null;
    adminUploadController?.reset();
    renderAdminUploadForm();
    const reason = document.getElementById('studioAdminUploadVideoReason');
    if (reason) reason.value = '';
    setAdminUploadStatus(adminUploadCopy.ready);
    adminUploadLastTrigger?.focus?.({ preventScroll: true });
    adminUploadLastTrigger = null;
}

function openAdminUploadModal(trigger = null) {
    const modal = document.getElementById('studioAdminUploadVideoModal');
    const title = document.getElementById('studioAdminUploadVideoTitle');
    const reason = document.getElementById('studioAdminUploadVideoReason');
    if (!modal || !adminUploadController) return;
    adminUploadLastTrigger = trigger instanceof HTMLElement ? trigger : document.getElementById('studioAdminUploadVideoBtn');
    adminUploadController.reset();
    if (reason) reason.value = '';
    setAdminUploadStatus(adminUploadCopy.checking);
    renderAdminUploadForm();
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    window.requestAnimationFrame(() => {
        title?.focus?.({ preventScroll: true });
    });
    refreshAdminUploadAvailability().catch((error) => {
        console.warn('Assets Manager manual upload status failed:', error);
    });
}

function setupAdminVideoUpload({ enabled = false } = {}) {
    const desktopBtn = document.getElementById('studioAdminUploadVideoBtn');
    const mobileBtn = document.getElementById('studioAdminUploadVideoMobileBtn');
    const modal = document.getElementById('studioAdminUploadVideoModal');
    const reason = document.getElementById('studioAdminUploadVideoReason');

    if (!desktopBtn || !modal) {
        return;
    }

    if (!enabled) {
        desktopBtn.hidden = true;
        if (mobileBtn) mobileBtn.hidden = true;
        return;
    }

    desktopBtn.hidden = false;
    if (mobileBtn) mobileBtn.hidden = false;
    adminUploadEnabled = false;
    adminUploadController = createManualHeroVideoUploadController({
        isEnabled: () => adminUploadEnabled,
        getOperatorReason: () => reason?.value || '',
        setStatus: setAdminUploadStatus,
        render: renderAdminUploadForm,
        formatApiError,
        panelTitle: adminUploadCopy.title,
        panelDescription: adminUploadCopy.description,
        disabledMessage: adminUploadCopy.disabledMessage,
        successStatus: adminUploadCopy.success,
        successToast: adminUploadCopy.successToast,
        errorFallback: adminUploadCopy.error,
        reasonError: adminUploadCopy.reasonError,
        uploadStatus: adminUploadCopy.uploadStatus,
        async onUploadSuccess() {
            if (savedAssetsBrowser) {
                await savedAssetsBrowser.openAllAssets();
            }
            window.setTimeout(closeAdminUploadModal, 0);
        },
    });
    renderAdminUploadForm();

    const handleModalInput = (event) => {
        if (adminUploadController?.handleInput(event)) return;
    };
    const handleModalChange = (event) => {
        if (adminUploadController?.handleChange(event)) return;
    };
    const handleModalClick = (event) => {
        if (event.target?.closest?.('[data-assets-upload-close]')) {
            closeAdminUploadModal();
            return;
        }
        adminUploadController?.handleClick(event);
    };

    modal.addEventListener('input', handleModalInput);
    modal.addEventListener('change', handleModalChange);
    modal.addEventListener('click', handleModalClick);
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !modal.hidden) {
            closeAdminUploadModal();
        }
    });
}

function createBrowser({ fromGenerateLab = false, enableAdminUpload = false } = {}) {
    savedAssetsBrowser = createSavedAssetsBrowser({
        refs: {
            root: document.getElementById('studioSavedAssetsCard'),
            galleryFilter: document.getElementById('studioGalleryFilter'),
            storageUsage: document.getElementById('studioStorageUsage'),
            folderGrid: document.getElementById('studioFolderGrid'),
            folderBack: document.getElementById('studioFolderBack'),
            folderBackBtn: document.getElementById('studioFolderBackBtn'),
            assetGrid: document.getElementById('studioImageGrid'),
            galleryMsg: document.getElementById('studioGalleryMsg'),
            listStatus: document.getElementById('studioListStatus'),
            viewRefresh: document.getElementById('studioViewRefresh'),
            viewShowAll: document.getElementById('studioViewShowAll'),
            uploadVideoBtn: document.getElementById('studioAdminUploadVideoBtn'),
            newFolderBtn: document.getElementById('studioNewFolderBtn'),
            deleteFolderBtn: document.getElementById('studioDeleteFolderBtn'),
            newFolderForm: document.getElementById('studioNewFolderForm'),
            newFolderInput: document.getElementById('studioNewFolderInput'),
            newFolderSave: document.getElementById('studioNewFolderSave'),
            newFolderCancel: document.getElementById('studioNewFolderCancel'),
            deleteFolderForm: document.getElementById('studioDeleteFolderForm'),
            deleteFolderSelect: document.getElementById('studioDeleteFolderSelect'),
            deleteFolderConfirm: document.getElementById('studioDeleteFolderConfirm'),
            deleteFolderCancel: document.getElementById('studioDeleteFolderCancel'),
            selectBtn: document.getElementById('studioSelectBtn'),
            mobileActionsToggle: document.getElementById('studioMobileActionsToggle'),
            mobileActionsMenu: document.getElementById('studioMobileActionsMenu'),
            bulkBar: document.getElementById('studioBulkBar'),
            bulkCount: document.getElementById('studioBulkCount'),
            bulkRename: document.getElementById('studioBulkRename'),
            bulkMove: document.getElementById('studioBulkMove'),
            bulkDelete: document.getElementById('studioBulkDelete'),
            bulkCancel: document.getElementById('studioBulkCancel'),
            selectionGuide: document.getElementById('studioSelectionGuide'),
            selectionGuideCopy: document.getElementById('studioSelectionGuideCopy'),
            selectionGuideStatus: document.getElementById('studioSelectionGuideStatus'),
            renameForm: document.getElementById('studioRenameForm'),
            renameInput: document.getElementById('studioRenameInput'),
            renameConfirm: document.getElementById('studioRenameConfirm'),
            renameCancel: document.getElementById('studioRenameCancel'),
            bulkMoveForm: document.getElementById('studioBulkMoveForm'),
            bulkMoveSummary: document.getElementById('studioBulkMoveSummary'),
            bulkMoveSelect: document.getElementById('studioBulkMoveSelect'),
            bulkMoveConfirm: document.getElementById('studioBulkMoveConfirm'),
            bulkMoveCancel: document.getElementById('studioBulkMoveCancel'),
            actionResult: document.getElementById('studioActionResult'),
            actionResultTitle: document.getElementById('studioActionResultTitle'),
            actionResultCopy: document.getElementById('studioActionResultCopy'),
            actionResultMeta: document.getElementById('studioActionResultMeta'),
            actionResultActions: document.getElementById('studioActionResultActions'),
        },
        emptyStateMessage: fromGenerateLab ? localeText('assets.handoffEmptyCopy') : localeText('assets.emptyDetailed'),
        emptyStateTitle: fromGenerateLab ? localeText('assets.handoffEmptyTitle') : localeText('assets.emptyStateTitle'),
        emptyStateCtaLabel: fromGenerateLab ? localeText('assets.handoffEmptyCta') : localeText('assets.emptyStateCta'),
        emptyStateCtaHref: fromGenerateLab ? localizedHref('/generate-lab/') : undefined,
        loadFailedMessage: fromGenerateLab ? localeText('assets.handoffLoadFailedCopy') : localeText('assets.couldNotLoadAssetsHelp'),
        loadFailedTitle: fromGenerateLab ? localeText('assets.handoffLoadFailedTitle') : localeText('assets.loadFailedTitle'),
        loadFailedCtaLabel: fromGenerateLab ? localeText('assets.handoffEmptyCta') : '',
        loadFailedCtaHref: fromGenerateLab ? localizedHref('/generate-lab/') : '',
        emptyListStatus: fromGenerateLab ? localeText('assets.handoffEmptyStatus') : localeText('assets.listEmptyStatus'),
        loadFailedListStatus: fromGenerateLab ? localeText('assets.handoffLoadFailedStatus') : localeText('assets.listLoadFailedStatus'),
        foldersUnavailableMessage: localeText('assets.foldersUnavailable'),
        handoffActive: fromGenerateLab,
        onUploadVideo: enableAdminUpload
            ? (trigger) => openAdminUploadModal(trigger || document.getElementById('studioAdminUploadVideoBtn'))
            : null,
    });

    return savedAssetsBrowser;
}

function initGenerateLabHandoff() {
    const banner = document.getElementById('assetsHandoffBanner');
    if (!banner) return;

    const title = document.getElementById('assetsHandoffTitle');
    const status = document.getElementById('assetsHandoffStatus');
    const refresh = document.getElementById('assetsHandoffRefresh');
    const showAll = document.getElementById('assetsHandoffShowAll');
    const dismiss = document.getElementById('assetsHandoffDismiss');
    const returnLink = document.getElementById('assetsHandoffReturn');

    if (returnLink) {
        returnLink.href = localizedHref('/generate-lab/');
    }

    banner.hidden = false;
    title?.focus?.({ preventScroll: true });

    refresh?.addEventListener('click', async () => {
        if (!savedAssetsBrowser) return;
        refresh.disabled = true;
        if (status) status.textContent = localeText('assets.handoffRefreshStarted');
        try {
            await savedAssetsBrowser.refresh({ preserveView: false });
            await savedAssetsBrowser.openAllAssets();
            if (status) status.textContent = localeText('assets.handoffRefreshDone');
        } catch (error) {
            console.warn('Assets Manager Generate Lab handoff refresh failed:', error);
            if (status) status.textContent = localeText('assets.handoffRefreshFailed');
        } finally {
            refresh.disabled = false;
        }
    });

    showAll?.addEventListener('click', async () => {
        if (!savedAssetsBrowser) return;
        showAll.disabled = true;
        if (status) status.textContent = localeText('assets.handoffShowAllStarted');
        try {
            await savedAssetsBrowser.openAllAssets();
            if (status) status.textContent = localeText('assets.handoffShowAllDone');
        } catch (error) {
            console.warn('Assets Manager Generate Lab show-all failed:', error);
            if (status) status.textContent = localeText('assets.handoffShowAllFailed');
        } finally {
            showAll.disabled = false;
        }
    });

    dismiss?.addEventListener('click', () => {
        banner.hidden = true;
        if (status) status.textContent = '';
        clearGenerateLabHandoffQuery();
    });
}

async function init() {
    try { initSiteHeader(); }    catch (e) { console.warn(e); }
    try { initParticles('heroCanvas'); }      catch (e) { console.warn(e); }
    try { initBinaryRain('binaryRain'); }     catch (e) { console.warn(e); }
    try { initBinaryFooter('binaryFooter'); } catch (e) { console.warn(e); }
    try { initScrollReveal(); }               catch (e) { console.warn(e); }
    try { initCookieConsent(); }              catch (e) { console.warn(e); }

    const res = await apiGetMe();

    if (!res.ok || !res.data?.loggedIn) {
        showDeniedState({ sessionExpired: isAuthFailure(res) });
        return;
    }

    const fromGenerateLab = hasGenerateLabHandoff();
    const user = res.data?.user || {};
    const enableAdminUpload = isAdminUser(user);

    showState($content);
    renderPostAuthHint({
        mount: $content,
        pageSource: 'assets-manager',
        signedIn: true,
    });
    setupAdminVideoUpload({ enabled: enableAdminUpload });
    createBrowser({ fromGenerateLab, enableAdminUpload });
    await savedAssetsBrowser.init();
    if (fromGenerateLab) {
        initGenerateLabHandoff();
        await savedAssetsBrowser.openAllAssets();
    }
}

init();
