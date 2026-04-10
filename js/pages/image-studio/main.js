/* ============================================================
   BITBI — Image Studio Page
   Entry point for account/image-studio.html
   ============================================================ */

import { initSiteHeader }    from '../../shared/site-header.js';
import { initParticles }     from '../../shared/particles.js';
import { initBinaryRain }    from '../../shared/binary-rain.js';
import { initBinaryFooter }  from '../../shared/binary-footer.js';
import { initScrollReveal }  from '../../shared/scroll-reveal.js';
import { initCookieConsent } from '../../shared/cookie-consent.js';

import {
    apiGetMe,
    apiAiGenerateImage,
    apiAiGetQuota,
    apiAiGetFolders,
    apiAiGetFoldersForDelete,
    apiAiCreateFolder,
    apiAiDeleteFolder,
    apiAiGetAssets,
    apiAiSaveImage,
    apiAiDeleteImage,
    apiAiDeleteTextAsset,
    apiAiBulkMoveImages,
    apiAiBulkDeleteImages,
} from '../../shared/auth-api.js?v=20260410-wave10';
import {
    DEFAULT_AI_IMAGE_MODEL,
    getAiImageModelOptions,
} from '../../shared/ai-image-models.mjs?v=20260409-wave7-fix';
import { initStudioDeck, initStudioFolderDeck } from '../../shared/studio-deck.js?v=20260410-wave11';

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
const $saveBar     = document.getElementById('studioSaveBar');
const $folderSelect = document.getElementById('studioFolderSelect');
const $saveBtn     = document.getElementById('studioSaveBtn');

// Gallery
const $galleryFilter    = document.getElementById('studioGalleryFilter');
const $folderGrid       = document.getElementById('studioFolderGrid');
const $folderBack       = document.getElementById('studioFolderBack');
const $folderBackBtn    = document.getElementById('studioFolderBackBtn');
const $imageGrid        = document.getElementById('studioImageGrid');
const $galleryMsg       = document.getElementById('studioGalleryMsg');
const $newFolderBtn     = document.getElementById('studioNewFolderBtn');
const $deleteFolderBtn  = document.getElementById('studioDeleteFolderBtn');
const $newFolderForm    = document.getElementById('studioNewFolderForm');
const $newFolderInput   = document.getElementById('studioNewFolderInput');
const $newFolderSave    = document.getElementById('studioNewFolderSave');
const $newFolderCancel  = document.getElementById('studioNewFolderCancel');

// Delete folder form
const $deleteFolderForm    = document.getElementById('studioDeleteFolderForm');
const $deleteFolderSelect  = document.getElementById('studioDeleteFolderSelect');
const $deleteFolderConfirm = document.getElementById('studioDeleteFolderConfirm');
const $deleteFolderCancel  = document.getElementById('studioDeleteFolderCancel');

// Selection mode
const $selectBtn           = document.getElementById('studioSelectBtn');
const $mobileActionsToggle = document.getElementById('studioMobileActionsToggle');
const $mobileActionsMenu   = document.getElementById('studioMobileActionsMenu');

// Bulk actions
const $bulkBar             = document.getElementById('studioBulkBar');
const $bulkCount           = document.getElementById('studioBulkCount');
const $bulkMove            = document.getElementById('studioBulkMove');
const $bulkDelete          = document.getElementById('studioBulkDelete');
const $bulkCancel          = document.getElementById('studioBulkCancel');
const $bulkMoveForm        = document.getElementById('studioBulkMoveForm');
const $bulkMoveSelect      = document.getElementById('studioBulkMoveSelect');
const $bulkMoveConfirm     = document.getElementById('studioBulkMoveConfirm');
const $bulkMoveCancel      = document.getElementById('studioBulkMoveCancel');

/* ── State ── */
let currentImageData = null;
let currentMeta      = null;
let folders          = [];
let folderCounts     = {};  // { folderId: count }
let unfolderedCount  = 0;
let quotaRemaining   = null;  // null = unknown/admin, number = remaining for non-admin
let quotaLimit       = 10;
let $quotaEl         = null;
let selectMode       = false;
let selectedIds      = new Set();
let folderDeck       = null;
let imageDeck        = null;
const assetDateFormatter = new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
});

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

function populateFolderOptions(selectEl) {
    const safeFolders = Array.isArray(folders) ? folders : [];
    const current = selectEl.value;
    const opts = ['<option value="">Assets</option>'];
    for (const f of safeFolders) {
        opts.push(`<option value="${f.id}">${escapeHtml(f.name)}</option>`);
    }
    selectEl.innerHTML = opts.join('');
    if (current) selectEl.value = current;
}

function populateModelOptions(selectEl, currentValue = DEFAULT_AI_IMAGE_MODEL) {
    if (!selectEl) return;

    const options = getAiImageModelOptions().map(
        ({ id, label }) => `<option value="${id}">${escapeHtml(label)}</option>`
    );
    selectEl.innerHTML = options.join('');
    selectEl.value = currentValue;
}

const UNFOLDERED = '__unfoldered__';
const ALL_IMAGES = '__all__';

function populateGalleryFilter(selectEl) {
    const safeFolders = Array.isArray(folders) ? folders : [];
    const current = selectEl.value;
    const opts = [
        '<option value="">All Folders</option>',
        `<option value="${ALL_IMAGES}">All Assets</option>`,
        `<option value="${UNFOLDERED}">Assets</option>`,
    ];
    for (const f of safeFolders) {
        opts.push(`<option value="${f.id}">${escapeHtml(f.name)}</option>`);
    }
    selectEl.innerHTML = opts.join('');
    if (current) selectEl.value = current;
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatAssetDate(iso) {
    if (!iso) return '';
    try {
        return assetDateFormatter.format(new Date(iso));
    } catch {
        return '';
    }
}

function getImagePreviewState(asset) {
    const status = asset?.derivatives_status || 'pending';
    if (status === 'failed') {
        return {
            variant: 'failed',
            label: 'Preview unavailable',
            hint: 'Open the original while previews are rebuilt.',
        };
    }
    if (status === 'processing') {
        return {
            variant: 'pending',
            label: 'Preparing preview',
            hint: 'Open the original while the queue finishes your preview.',
        };
    }
    return {
        variant: 'pending',
        label: 'Preview pending',
        hint: 'Open the original while the queue builds your preview.',
    };
}

function buildImagePreviewPlaceholder(asset) {
    const state = getImagePreviewState(asset);
    const placeholder = document.createElement('div');
    placeholder.className = 'studio__image-preview-state';

    const badge = document.createElement('span');
    badge.className = `studio__image-preview-badge studio__image-preview-badge--${state.variant}`;
    badge.textContent = state.label;
    placeholder.appendChild(badge);

    const title = document.createElement('span');
    title.className = 'studio__image-preview-title';
    title.textContent = asset.title || asset.preview_text || 'Saved image';
    placeholder.appendChild(title);

    const hint = document.createElement('span');
    hint.className = 'studio__image-preview-hint';
    hint.textContent = state.hint;
    placeholder.appendChild(hint);

    return placeholder;
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
        // Admin or failed — hide quota UI
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

/* ── Folders ���─ */
async function loadFolders() {
    let ok = true;
    try {
        const result = await apiAiGetFolders();
        folders = result.folders;
        folderCounts = result.counts;
        unfolderedCount = result.unfolderedCount;
    } catch (e) {
        console.warn('Failed to load folders:', e);
        folders = [];
        folderCounts = {};
        unfolderedCount = 0;
        ok = false;
    }
    populateFolderOptions($folderSelect);
    populateGalleryFilter($galleryFilter);
    $galleryFilter.value = '';
    return ok;
}

/* ── Folder Cards View ── */
let folderViewActive = true;

function showFolderView() {
    folderViewActive = true;
    $folderGrid.style.display = '';
    $imageGrid.style.display = 'none';
    if (imageDeck) imageDeck.setVisible(false);
    $folderBack.classList.remove('visible');

    const safeFolders = Array.isArray(folders) ? folders : [];

    // Compute total from server-provided counts
    let total = unfolderedCount;
    for (const f of safeFolders) total += (folderCounts[f.id] || 0);

    $folderGrid.innerHTML = '';

    // "All Assets" card — opens flat gallery across all folders
    const allCard = document.createElement('div');
    allCard.className = 'studio__folder-card';
    allCard.innerHTML =
        `<span class="studio__folder-card-icon" aria-hidden="true">&#128444;</span>` +
        `<span class="studio__folder-card-name">All Assets</span>` +
        `<span class="studio__folder-card-count">${total} asset${total !== 1 ? 's' : ''}</span>`;
    allCard.addEventListener('click', openAllImages);
    $folderGrid.appendChild(allCard);

    // Assets card (unfoldered assets)
    const assetsCard = document.createElement('div');
    assetsCard.className = 'studio__folder-card';
    assetsCard.innerHTML =
        `<span class="studio__folder-card-icon" aria-hidden="true">&#128230;</span>` +
        `<span class="studio__folder-card-name">Assets</span>` +
        `<span class="studio__folder-card-count">${unfolderedCount} asset${unfolderedCount !== 1 ? 's' : ''}</span>`;
    assetsCard.addEventListener('click', () => openFolder(UNFOLDERED, 'Assets'));
    $folderGrid.appendChild(assetsCard);

    // User-created folder cards
    for (const f of safeFolders) {
        const count = folderCounts[f.id] || 0;
        const card = document.createElement('div');
        card.className = 'studio__folder-card';
        card.innerHTML =
            `<span class="studio__folder-card-icon" aria-hidden="true">&#128193;</span>` +
            `<span class="studio__folder-card-name">${escapeHtml(f.name)}</span>` +
            `<span class="studio__folder-card-count">${count} asset${count !== 1 ? 's' : ''}</span>`;
        card.addEventListener('click', () => openFolder(f.id, f.name));
        $folderGrid.appendChild(card);
    }
}

function openFolder(folderId, folderName) {
    folderViewActive = false;
    $folderGrid.style.display = 'none';
    if (folderDeck) folderDeck.setVisible(false);
    $imageGrid.innerHTML = '<div class="studio__gallery-empty">Loading\u2026</div>';
    $imageGrid.style.display = '';
    $folderBack.classList.add('visible');
    $galleryFilter.value = folderId;
    loadGallery();
}

function openAllImages() {
    folderViewActive = false;
    $folderGrid.style.display = 'none';
    if (folderDeck) folderDeck.setVisible(false);
    $imageGrid.innerHTML = '<div class="studio__gallery-empty">Loading\u2026</div>';
    $imageGrid.style.display = '';
    $folderBack.classList.add('visible');
    $galleryFilter.value = ALL_IMAGES;
    loadGallery();
}

function backToFolders() {
    $galleryFilter.value = '';
    showFolderView();
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
    $generateBtn.textContent = 'Generating\u2026';
    $saveBar.classList.remove('visible');
    currentImageData = null;
    currentMeta = null;

    $preview.innerHTML = '<div class="studio__loading"><div class="studio__spinner"></div><span>Creating your image\u2026</span></div>';

    const steps = $steps.value ? Number($steps.value) : null;
    const seed  = $seed.value  ? Number($seed.value)  : null;
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

    // Server returns { ok, data: { imageBase64, mimeType, prompt, ... } }
    // request() wrapper nests it as res.data = full server JSON
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

    // Update quota after successful generation
    if (quotaRemaining !== null && quotaRemaining > 0) {
        quotaRemaining--;
        renderQuota();
    }
}

/* ── Save Image ── */
async function handleSave() {
    if (!currentImageData || !currentMeta) return;

    $saveBtn.disabled = true;
    $saveBtn.textContent = 'Saving\u2026';

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
    if (folderViewActive) showFolderView();
    else loadGallery();
}

/* ── Gallery ── */
async function loadGallery() {
    if (selectMode) exitSelectMode();
    const filterVal = $galleryFilter.value;
    const isAllImages = filterVal === ALL_IMAGES || filterVal === '';
    const isUnfoldered = filterVal === UNFOLDERED;
    const folderId = (!isAllImages && !isUnfoldered && filterVal) ? filterVal : null;
    let assets;
    try {
        assets = await apiAiGetAssets(folderId, { onlyUnfoldered: isUnfoldered });
    } catch (e) {
        console.warn('Failed to load gallery:', e);
        assets = [];
    }
    if (!Array.isArray(assets)) assets = [];

    if (assets.length === 0) {
        $imageGrid.innerHTML = '<div class="studio__gallery-empty">No saved assets yet. Save an image here or from the Admin AI Lab to populate your folders.</div>';
        return;
    }

    $imageGrid.innerHTML = '';
    for (const asset of assets) {
        if (asset.asset_type === 'text') {
            const item = document.createElement('article');
            item.className = 'studio__image-item studio__image-item--text';
            item.dataset.assetType = 'text';
            item.dataset.openUrl = asset.file_url || '';
            item.title = asset.title || asset.file_name || 'Saved text asset';

            const badge = document.createElement('span');
            badge.className = 'studio__text-badge';
            badge.textContent = String(asset.source_module || 'text').replace(/_/g, ' ').toUpperCase();
            item.appendChild(badge);

            const title = document.createElement('h3');
            title.className = 'studio__text-title';
            title.textContent = asset.title || asset.file_name || 'Saved text asset';
            item.appendChild(title);

            const preview = document.createElement('p');
            preview.className = 'studio__text-preview';
            preview.textContent = asset.preview_text || 'Saved AI Lab text asset.';
            item.appendChild(preview);

            const meta = document.createElement('div');
            meta.className = 'studio__text-meta';
            meta.textContent = [formatAssetDate(asset.created_at), asset.file_name || 'TXT']
                .filter(Boolean)
                .join(' · ');
            item.appendChild(meta);

            const actions = document.createElement('div');
            actions.className = 'studio__text-actions';

            const openLink = document.createElement('a');
            openLink.className = 'studio__text-open';
            openLink.href = asset.file_url || '#';
            openLink.target = '_blank';
            openLink.rel = 'noopener noreferrer';
            openLink.textContent = 'Open';
            actions.appendChild(openLink);

            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'studio__image-delete studio__image-delete--inline';
            delBtn.textContent = 'Delete';
            delBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (!confirm('Delete this text asset?')) return;
                delBtn.disabled = true;
                delBtn.textContent = '\u2026';
                const del = await apiAiDeleteTextAsset(asset.id);
                if (del.ok) {
                    item.remove();
                    if ($imageGrid.children.length === 0) {
                        $imageGrid.innerHTML = '<div class="studio__gallery-empty">No saved assets yet.</div>';
                    }
                } else {
                    delBtn.disabled = false;
                    delBtn.textContent = 'Delete';
                    showMsg($galleryMsg, del.error, 'error');
                }
            });
            actions.appendChild(delBtn);

            item.appendChild(actions);
            $imageGrid.appendChild(item);
            continue;
        }

        const item = document.createElement('div');
        item.className = 'studio__image-item';
        item.dataset.imageId = asset.id;
        item.title = asset.title || asset.preview_text || '';
        item.dataset.previewUrl = asset.medium_url || asset.original_url || asset.file_url || '';
        item.dataset.originalUrl = asset.original_url || asset.file_url || '';

        if (asset.thumb_url) {
            const imgEl = document.createElement('img');
            imgEl.src = asset.thumb_url;
            imgEl.alt = asset.title || asset.preview_text || 'Saved image';
            imgEl.loading = 'lazy';
            imgEl.decoding = 'async';
            if (asset.thumb_width) imgEl.width = asset.thumb_width;
            if (asset.thumb_height) imgEl.height = asset.thumb_height;
            item.appendChild(imgEl);
        } else {
            item.classList.add('studio__image-item--placeholder');
            item.appendChild(buildImagePreviewPlaceholder(asset));
        }

        const overlay = document.createElement('div');
        overlay.className = 'studio__image-overlay';

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'studio__image-delete';
        delBtn.textContent = 'Delete';
        delBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!confirm('Delete this image?')) return;
            delBtn.disabled = true;
            delBtn.textContent = '\u2026';
            const del = await apiAiDeleteImage(asset.id);
            if (del.ok) {
                item.remove();
                // Check if grid is now empty
                if ($imageGrid.children.length === 0) {
                    $imageGrid.innerHTML = '<div class="studio__gallery-empty">No saved assets yet.</div>';
                }
            } else {
                delBtn.disabled = false;
                delBtn.textContent = 'Delete';
                showMsg($galleryMsg, del.error, 'error');
            }
        });
        overlay.appendChild(delBtn);
        item.appendChild(overlay);

        const check = document.createElement('div');
        check.className = 'studio__image-check';
        check.setAttribute('aria-hidden', 'true');
        item.appendChild(check);

        $imageGrid.appendChild(item);
    }
}

/* ── New Folder ── */
function showNewFolderForm() {
    hideDeleteFolderForm();
    $newFolderForm.classList.add('visible');
    $newFolderInput.value = '';
    $newFolderInput.focus();
}

function hideNewFolderForm() {
    $newFolderForm.classList.remove('visible');
}

async function handleCreateFolder() {
    const name = $newFolderInput.value.trim();
    if (!name) return;

    $newFolderSave.disabled = true;
    const res = await apiAiCreateFolder(name);
    $newFolderSave.disabled = false;

    if (!res.ok) {
        showMsg($galleryMsg, res.error, 'error');
        return;
    }

    hideNewFolderForm();
    await loadFolders();
    if (folderViewActive) showFolderView();
    showMsg($galleryMsg, `Folder "${name}" created.`, 'success');
}

/* ── Delete Folder ── */
async function showDeleteFolderForm() {
    hideNewFolderForm();
    let deletableFolders;
    try {
        deletableFolders = await apiAiGetFoldersForDelete();
    } catch (e) {
        deletableFolders = Array.isArray(folders) ? folders : [];
    }
    if (!deletableFolders.length) {
        showMsg($galleryMsg, 'No folders to delete.', 'error');
        return;
    }
    $deleteFolderSelect.innerHTML = '';
    for (const f of deletableFolders) {
        const opt = document.createElement('option');
        opt.value = f.id;
        opt.textContent = f.status === 'deleting' ? `${f.name} (retry delete)` : f.name;
        $deleteFolderSelect.appendChild(opt);
    }
    $deleteFolderForm.classList.add('visible');
    $deleteFolderSelect.focus();
}

function hideDeleteFolderForm() {
    $deleteFolderForm.classList.remove('visible');
}

async function handleDeleteFolder() {
    const folderId = $deleteFolderSelect.value;
    if (!folderId) return;

    const safeFolders = Array.isArray(folders) ? folders : [];
    const target = safeFolders.find(f => f.id === folderId);
    const name = target ? target.name : 'this folder';

    if (!confirm(`Delete folder "${name}" and all its assets?\n\nThis cannot be undone.`)) return;

    $deleteFolderConfirm.disabled = true;
    $deleteFolderConfirm.textContent = '\u2026';
    const res = await apiAiDeleteFolder(folderId);
    $deleteFolderConfirm.disabled = false;
    $deleteFolderConfirm.textContent = 'Delete';

    if (!res.ok) {
        showMsg($galleryMsg, res.error || 'Failed to delete folder.', 'error');
        return;
    }

    hideDeleteFolderForm();

    if ($galleryFilter.value === folderId) {
        $galleryFilter.value = '';
    }

    await loadFolders();
    showFolderView();
    showMsg($galleryMsg, `Folder "${name}" deleted.`, 'success');
}

/* ── Selection Mode ── */
function enterSelectMode() {
    const items = $imageGrid.querySelectorAll('.studio__image-item[data-image-id]');
    if (items.length === 0) return;
    selectMode = true;
    selectedIds.clear();
    $imageGrid.classList.add('studio--selecting');
    $imageGrid.dataset.selectMode = 'true';
    $bulkBar.classList.add('visible');
    $galleryFilter.disabled = true;
    const card = $imageGrid.closest('.studio__card');
    if (card) card.classList.add('studio--selecting-mode');
    updateBulkCount();
    hideMsg($galleryMsg);
}

function exitSelectMode() {
    if (!selectMode) return;
    selectMode = false;
    selectedIds.clear();
    $imageGrid.classList.remove('studio--selecting');
    delete $imageGrid.dataset.selectMode;
    $bulkBar.classList.remove('visible');
    hideBulkMoveForm();
    $galleryFilter.disabled = false;
    const card = $imageGrid.closest('.studio__card');
    if (card) card.classList.remove('studio--selecting-mode');
    $imageGrid.querySelectorAll('.studio__image-item.selected').forEach(el => {
        el.classList.remove('selected');
    });
}

const MAX_BULK_SELECT = 50;

function toggleImageSelection(item) {
    const id = item.dataset.imageId;
    if (!id) return;
    if (selectedIds.has(id)) {
        selectedIds.delete(id);
        item.classList.remove('selected');
    } else {
        if (selectedIds.size >= MAX_BULK_SELECT) {
            showMsg($galleryMsg, `You can select up to ${MAX_BULK_SELECT} images at a time.`, 'error');
            return;
        }
        selectedIds.add(id);
        item.classList.add('selected');
    }
    updateBulkCount();
}

function updateBulkCount() {
    const n = selectedIds.size;
    $bulkCount.textContent = `${n} selected` + (n >= MAX_BULK_SELECT ? ' (max)' : '');
}

/* ── Bulk Move ── */
function showBulkMoveForm() {
    if (selectedIds.size === 0) {
        showMsg($galleryMsg, 'Select at least one image first.', 'error');
        return;
    }
    populateFolderOptions($bulkMoveSelect);
    $bulkMoveForm.classList.add('visible');
    $bulkMoveSelect.focus();
}

function hideBulkMoveForm() {
    $bulkMoveForm.classList.remove('visible');
}

async function handleBulkMoveConfirm() {
    if (selectedIds.size === 0) return;
    const folderId = $bulkMoveSelect.value || null;
    $bulkMoveConfirm.disabled = true;
    $bulkMoveConfirm.textContent = '\u2026';
    const res = await apiAiBulkMoveImages([...selectedIds], folderId);
    $bulkMoveConfirm.disabled = false;
    $bulkMoveConfirm.textContent = 'Move';
    if (!res.ok) {
        showMsg($galleryMsg, res.error || 'Failed to move images.', 'error');
        return;
    }
    const n = selectedIds.size;
    exitSelectMode();
    loadGallery();
    showMsg($galleryMsg, `${n} image${n > 1 ? 's' : ''} moved.`, 'success');
}

/* ── Bulk Delete ── */
async function handleBulkDelete() {
    if (selectedIds.size === 0) {
        showMsg($galleryMsg, 'Select at least one image first.', 'error');
        return;
    }
    const n = selectedIds.size;
    if (!confirm(`Delete ${n} selected image${n > 1 ? 's' : ''}?\n\nThis cannot be undone.`)) return;
    $bulkDelete.disabled = true;
    $bulkDelete.textContent = '\u2026';
    const res = await apiAiBulkDeleteImages([...selectedIds]);
    $bulkDelete.disabled = false;
    $bulkDelete.textContent = 'Delete Selected';
    if (!res.ok) {
        showMsg($galleryMsg, res.error || 'Failed to delete images.', 'error');
        return;
    }
    exitSelectMode();
    loadGallery();
    showMsg($galleryMsg, `${n} image${n > 1 ? 's' : ''} deleted.`, 'success');
}

/* ── Mobile Actions Dropdown ── */
function toggleMobileMenu() {
    const isOpen = $mobileActionsMenu.classList.contains('visible');
    if (isOpen) {
        closeMobileMenu();
    } else {
        $mobileActionsMenu.classList.add('visible');
        $mobileActionsToggle.setAttribute('aria-expanded', 'true');
    }
}

function closeMobileMenu() {
    $mobileActionsMenu.classList.remove('visible');
    $mobileActionsToggle.setAttribute('aria-expanded', 'false');
}

/* ── Init ── */
async function init() {
    try { initSiteHeader(); }    catch (e) { console.warn(e); }
    try { initParticles('heroCanvas'); }      catch (e) { console.warn(e); }
    try { initBinaryRain('binaryRain'); }     catch (e) { console.warn(e); }
    try { initBinaryFooter('binaryFooter'); } catch (e) { console.warn(e); }
    try { initScrollReveal(); }               catch (e) { console.warn(e); }
    try { initCookieConsent(); }              catch (e) { console.warn(e); }

    // Auth check via /api/me
    const res = await apiGetMe();

    if (!res.ok || !res.data?.loggedIn) {
        showState($denied);
        $denied.classList.add('visible');
        return;
    }

    showState($content);
    populateModelOptions($model);

    /* Attach mobile deck swipe + click-to-preview to saved assets grid */
    if ($imageGrid) imageDeck = initStudioDeck($imageGrid);
    if ($folderGrid) folderDeck = initStudioFolderDeck($folderGrid);

    // Quota indicator (inject after the actions row, load from server)
    const $actions = document.querySelector('.studio__actions');
    if ($actions) { injectQuotaEl($actions); loadQuota(); }

    // Load data — fall back to flat gallery if folder metadata fails
    const foldersOk = await loadFolders();
    if (foldersOk) {
        showFolderView();
    } else {
        showMsg($galleryMsg, 'Could not load folders. Showing all saved assets.', 'error');
        openAllImages();
    }

    // Event listeners
    $generateBtn.addEventListener('click', handleGenerate);
    $saveBtn.addEventListener('click', handleSave);
    $randomize.addEventListener('click', () => {
        $seed.value = Math.floor(Math.random() * 2147483647);
    });
    $galleryFilter.addEventListener('change', () => {
        const val = $galleryFilter.value;
        if (val === '') {
            showFolderView();
        } else if (val === ALL_IMAGES) {
            openAllImages();
        } else {
            openFolder(val, '');
        }
    });
    $folderBackBtn.addEventListener('click', backToFolders);
    $newFolderBtn.addEventListener('click', showNewFolderForm);
    $deleteFolderBtn.addEventListener('click', showDeleteFolderForm);
    $deleteFolderConfirm.addEventListener('click', handleDeleteFolder);
    $deleteFolderCancel.addEventListener('click', hideDeleteFolderForm);
    $newFolderCancel.addEventListener('click', hideNewFolderForm);
    $newFolderSave.addEventListener('click', handleCreateFolder);
    $newFolderInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); handleCreateFolder(); }
        if (e.key === 'Escape') hideNewFolderForm();
    });

    // Selection mode
    $selectBtn.addEventListener('click', enterSelectMode);
    $bulkMove.addEventListener('click', showBulkMoveForm);
    $bulkDelete.addEventListener('click', handleBulkDelete);
    $bulkCancel.addEventListener('click', exitSelectMode);
    $bulkMoveConfirm.addEventListener('click', handleBulkMoveConfirm);
    $bulkMoveCancel.addEventListener('click', hideBulkMoveForm);

    // Image selection click handler
    $imageGrid.addEventListener('click', (e) => {
        if (!selectMode) return;
        const item = e.target.closest('.studio__image-item');
        if (!item) return;
        if (e.target.closest('.studio__image-delete')) return;
        if (e.target.closest('a')) return;
        toggleImageSelection(item);
    });

    // Mobile actions dropdown
    $mobileActionsToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleMobileMenu();
    });
    $mobileActionsMenu.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        closeMobileMenu();
        const action = btn.dataset.action;
        if (action === 'new-folder') showNewFolderForm();
        else if (action === 'delete-folder') showDeleteFolderForm();
        else if (action === 'select') enterSelectMode();
    });
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#studioMobileActions')) closeMobileMenu();
    });

    // Allow Ctrl+Enter to generate
    $prompt.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            handleGenerate();
        }
    });
}

init();
