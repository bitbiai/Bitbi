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
import { localeText } from '../../shared/locale.js?v=__ASSET_VERSION__';

const $loading = document.getElementById('loadingState');
const $denied  = document.getElementById('deniedState');
const $content = document.getElementById('studioContent');

let savedAssetsBrowser = null;

function showState(el) {
    $loading.style.display = 'none';
    $denied.style.display = 'none';
    $content.style.display = 'none';
    el.style.display = '';
}

function createBrowser() {
    savedAssetsBrowser = createSavedAssetsBrowser({
        refs: {
            root: document.getElementById('studioSavedAssetsCard'),
            galleryFilter: document.getElementById('studioGalleryFilter'),
            folderGrid: document.getElementById('studioFolderGrid'),
            folderBack: document.getElementById('studioFolderBack'),
            folderBackBtn: document.getElementById('studioFolderBackBtn'),
            assetGrid: document.getElementById('studioImageGrid'),
            galleryMsg: document.getElementById('studioGalleryMsg'),
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
            renameForm: document.getElementById('studioRenameForm'),
            renameInput: document.getElementById('studioRenameInput'),
            renameConfirm: document.getElementById('studioRenameConfirm'),
            renameCancel: document.getElementById('studioRenameCancel'),
            bulkMoveForm: document.getElementById('studioBulkMoveForm'),
            bulkMoveSelect: document.getElementById('studioBulkMoveSelect'),
            bulkMoveConfirm: document.getElementById('studioBulkMoveConfirm'),
            bulkMoveCancel: document.getElementById('studioBulkMoveCancel'),
        },
        emptyStateMessage: localeText('assets.emptyDetailed'),
        foldersUnavailableMessage: localeText('assets.foldersUnavailable'),
    });

    return savedAssetsBrowser;
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

    showState($content);
    createBrowser();
    await savedAssetsBrowser.init();
}

init();
