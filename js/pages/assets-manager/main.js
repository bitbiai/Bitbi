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

import { apiGetMe } from '../../shared/auth-api.js?v=__ASSET_VERSION__';
import { createSavedAssetsBrowser } from '../../shared/saved-assets-browser.js?v=__ASSET_VERSION__';
import { localizedHref, localeText } from '../../shared/locale.js?v=__ASSET_VERSION__';

const $loading = document.getElementById('loadingState');
const $denied  = document.getElementById('deniedState');
const $content = document.getElementById('studioContent');

let savedAssetsBrowser = null;

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

function createBrowser({ fromGenerateLab = false } = {}) {
    savedAssetsBrowser = createSavedAssetsBrowser({
        refs: {
            root: document.getElementById('studioSavedAssetsCard'),
            galleryFilter: document.getElementById('studioGalleryFilter'),
            storageUsage: document.getElementById('studioStorageUsage'),
            storageInsight: document.getElementById('studioStorageInsight'),
            folderGrid: document.getElementById('studioFolderGrid'),
            folderBack: document.getElementById('studioFolderBack'),
            folderBackBtn: document.getElementById('studioFolderBackBtn'),
            assetGrid: document.getElementById('studioImageGrid'),
            galleryMsg: document.getElementById('studioGalleryMsg'),
            listStatus: document.getElementById('studioListStatus'),
            viewContext: document.getElementById('studioViewContext'),
            viewContextTitle: document.getElementById('studioViewContextTitle'),
            viewContextCopy: document.getElementById('studioViewContextCopy'),
            viewScope: document.getElementById('studioViewScope'),
            viewOrder: document.getElementById('studioViewOrder'),
            viewRefresh: document.getElementById('studioViewRefresh'),
            viewShowAll: document.getElementById('studioViewShowAll'),
            viewGenerateLab: document.getElementById('studioViewGenerateLab'),
            viewCredits: document.getElementById('studioViewCredits'),
            folderDetail: document.getElementById('studioFolderDetail'),
            folderDetailTitle: document.getElementById('studioFolderDetailTitle'),
            folderDetailCopy: document.getElementById('studioFolderDetailCopy'),
            folderDetailCount: document.getElementById('studioFolderDetailCount'),
            folderDetailShowAll: document.getElementById('studioFolderDetailShowAll'),
            folderDetailBack: document.getElementById('studioFolderDetailBack'),
            folderDetailGenerateLab: document.getElementById('studioFolderDetailGenerateLab'),
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
        showState($denied);
        $denied.classList.add('visible');
        return;
    }

    const fromGenerateLab = hasGenerateLabHandoff();

    showState($content);
    createBrowser({ fromGenerateLab });
    await savedAssetsBrowser.init();
    if (fromGenerateLab) {
        initGenerateLabHandoff();
        await savedAssetsBrowser.openAllAssets();
    }
}

init();
