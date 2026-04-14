/* ============================================================
   BITBI — Image Studio Page
   Entry point for account/image-studio.html
   ============================================================ */

import { initSiteHeader }    from '../../shared/site-header.js?v=__ASSET_VERSION__';
import { initParticles }     from '../../shared/particles.js';
import { initBinaryRain }    from '../../shared/binary-rain.js';
import { initBinaryFooter }  from '../../shared/binary-footer.js';
import { initScrollReveal }  from '../../shared/scroll-reveal.js';
import { initCookieConsent } from '../../shared/cookie-consent.js';

import {
    apiGetMe,
    apiAiGenerateImage,
    apiAiGetQuota,
    apiAiSaveImage,
} from '../../shared/auth-api.js?v=__ASSET_VERSION__';
import { createSavedAssetsBrowser } from '../../shared/saved-assets-browser.js?v=__ASSET_VERSION__';
import {
    DEFAULT_AI_IMAGE_MODEL,
    getAiImageModelOptions,
} from '../../shared/ai-image-models.mjs?v=__ASSET_VERSION__';

/* ── DOM refs ── */
const $loading = document.getElementById('loadingState');
const $denied  = document.getElementById('deniedState');
const $content = document.getElementById('studioContent');

// Generator
const $prompt      = document.getElementById('studioPrompt');
const $model       = document.getElementById('studioModel');
const $steps       = document.getElementById('studioSteps');
const $seed        = document.getElementById('studioSeed');
const $randomize   = document.getElementById('studioRandomize');
const $generateBtn = document.getElementById('studioGenerate');
const $preview     = document.getElementById('studioPreview');
const $genMsg      = document.getElementById('studioGenMsg');

// Save bar
const $saveBar      = document.getElementById('studioSaveBar');
const $folderSelect = document.getElementById('studioFolderSelect');
const $saveBtn      = document.getElementById('studioSaveBtn');

/* ── State ── */
let currentImageData = null;
let currentMeta = null;
let quotaRemaining = null; // null = unknown/admin, number = remaining for non-admin
let quotaLimit = 10;
let $quotaEl = null;
let savedAssetsBrowser = null;

/* ── Helpers ── */
function showState(el) {
    $loading.style.display = 'none';
    $denied.style.display  = 'none';
    $content.style.display = 'none';
    el.style.display = '';
}

function showMsg(el, text, type) {
    el.textContent = text;
    el.className = `studio__msg studio__msg--${type}`;
}

function hideMsg(el) {
    el.className = 'studio__msg';
    el.textContent = '';
}

function populateModelOptions(selectEl, currentValue = DEFAULT_AI_IMAGE_MODEL) {
    if (!selectEl) return;

    const options = getAiImageModelOptions().map(
        ({ id, label }) => `<option value="${id}">${label}</option>`
    );
    selectEl.innerHTML = options.join('');
    selectEl.value = currentValue;
}

function populateSaveFolderOptions(selectEl, folders = []) {
    if (!selectEl) return;
    const current = selectEl.value;
    const options = ['<option value="">Assets</option>']
        .concat(folders.map((folder) => `<option value="${folder.id}">${folder.name}</option>`));
    selectEl.innerHTML = options.join('');
    if (current && folders.some((folder) => folder.id === current)) {
        selectEl.value = current;
    }
}

/* ── Quota indicator ── */
function renderQuota() {
    if (!$quotaEl || quotaRemaining === null) return;
    $quotaEl.textContent = `${quotaRemaining} / ${quotaLimit} generations left today`;
    $quotaEl.classList.toggle('studio__quota--empty', quotaRemaining <= 0);
}

async function loadQuota() {
    const q = await apiAiGetQuota();
    if (!q || q.isAdmin) {
        if ($quotaEl) $quotaEl.style.display = 'none';
        quotaRemaining = null;
        return;
    }
    quotaLimit = q.dailyLimit || 10;
    quotaRemaining = q.remainingToday;
    renderQuota();
}

function injectQuotaEl(anchorEl) {
    $quotaEl = document.createElement('div');
    $quotaEl.className = 'studio__quota';
    $quotaEl.setAttribute('aria-live', 'polite');
    anchorEl.after($quotaEl);
}

/* ── Image Generation ── */
async function handleGenerate() {
    const prompt = $prompt.value.trim();
    if (!prompt) {
        showMsg($genMsg, 'Please enter a prompt.', 'error');
        return;
    }

    hideMsg($genMsg);
    $generateBtn.disabled = true;
    $generateBtn.textContent = 'Generating…';
    $saveBar.classList.remove('visible');
    currentImageData = null;
    currentMeta = null;

    $preview.innerHTML = '<div class="studio__loading"><div class="studio__spinner"></div><span>Creating your image…</span></div>';

    const steps = $steps.value ? Number($steps.value) : null;
    const seed  = $seed.value ? Number($seed.value) : null;
    const model = $model?.value || DEFAULT_AI_IMAGE_MODEL;

    const res = await apiAiGenerateImage(prompt, steps, seed, model);

    $generateBtn.disabled = false;
    $generateBtn.textContent = 'Generate';

    if (!res.ok) {
        $preview.innerHTML = '<div class="studio__preview-empty">Generation failed</div>';
        showMsg($genMsg, res.error, 'error');
        if (res.data?.code === 'DAILY_IMAGE_LIMIT_REACHED' && quotaRemaining !== null) {
            quotaRemaining = 0;
            renderQuota();
        }
        return;
    }

    const d = res.data?.data || res.data || {};
    const imageBase64 = d.imageBase64;
    const mimeType = d.mimeType || 'image/png';
    if (!imageBase64) {
        $preview.innerHTML = '<div class="studio__preview-empty">No image in response</div>';
        showMsg($genMsg, 'No image data returned.', 'error');
        return;
    }

    currentImageData = `data:${mimeType};base64,${imageBase64}`;
    currentMeta = { prompt: d.prompt || prompt, model: d.model || '', steps: d.steps, seed: d.seed };

    $preview.innerHTML = '';
    const img = document.createElement('img');
    img.src = currentImageData;
    img.alt = prompt;
    $preview.appendChild(img);

    $saveBar.classList.add('visible');
    showMsg($genMsg, 'Image generated.', 'success');

    if (quotaRemaining !== null && quotaRemaining > 0) {
        quotaRemaining -= 1;
        renderQuota();
    }
}

/* ── Save Image ── */
async function handleSave() {
    if (!currentImageData || !currentMeta) return;

    $saveBtn.disabled = true;
    $saveBtn.textContent = 'Saving…';

    const folderId = $folderSelect.value || null;
    const res = await apiAiSaveImage(
        currentImageData,
        currentMeta.prompt,
        currentMeta.model,
        currentMeta.steps,
        currentMeta.seed,
        folderId
    );

    $saveBtn.disabled = false;
    $saveBtn.textContent = 'Save';

    if (!res.ok) {
        showMsg($genMsg, res.error, 'error');
        return;
    }

    showMsg($genMsg, 'Image saved.', 'success');
    $saveBar.classList.remove('visible');
    currentImageData = null;
    currentMeta = null;

    try {
        await savedAssetsBrowser?.refresh();
    } catch (error) {
        console.warn('saved assets refresh failed:', error);
    }
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
            bulkMove: document.getElementById('studioBulkMove'),
            bulkDelete: document.getElementById('studioBulkDelete'),
            bulkCancel: document.getElementById('studioBulkCancel'),
            bulkMoveForm: document.getElementById('studioBulkMoveForm'),
            bulkMoveSelect: document.getElementById('studioBulkMoveSelect'),
            bulkMoveConfirm: document.getElementById('studioBulkMoveConfirm'),
            bulkMoveCancel: document.getElementById('studioBulkMoveCancel'),
        },
        emptyStateMessage: 'No saved assets yet. Save an image here or from the Admin AI Lab to populate your folders.',
        foldersUnavailableMessage: 'Could not load folders. Showing all saved assets.',
        onFoldersChange({ folders }) {
            populateSaveFolderOptions($folderSelect, folders);
        },
    });

    return savedAssetsBrowser;
}

/* ── Init ── */
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
    populateModelOptions($model);
    createBrowser();

    const $actions = document.querySelector('.studio__actions');
    if ($actions) {
        injectQuotaEl($actions);
        loadQuota();
    }

    await savedAssetsBrowser.init();

    $generateBtn.addEventListener('click', handleGenerate);
    $saveBtn.addEventListener('click', handleSave);
    $randomize.addEventListener('click', () => {
        $seed.value = Math.floor(Math.random() * 2147483647);
    });

    $prompt.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            handleGenerate();
        }
    });
}

init();
