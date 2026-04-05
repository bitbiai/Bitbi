/* ============================================================
   BITBI — Gallery Studio: inline AI image generation
   Embedded version of Image Studio for the gallery section.
   Lazy-initialized when the user first activates Create mode.
   ============================================================ */

import {
    apiAiGenerateImage,
    apiAiGetQuota,
    apiAiGetFolders,
    apiAiCreateFolder,
    apiAiGetImages,
    apiAiSaveImage,
    apiAiDeleteImage,
} from '../../shared/auth-api.js';
import { initStudioDeck } from '../../shared/studio-deck.js';

let initialized = false;
let currentImageData = null;
let currentMeta = null;
let folders = [];
let quotaRemaining = null;
let quotaLimit = 10;
let $quotaEl = null;

/* DOM refs (resolved on init) */
let $prompt, $steps, $seed, $randomize, $generateBtn, $preview, $genMsg;
let $saveBar, $folderSelect, $saveBtn;
let $galleryFilter, $imageGrid, $galleryMsg;
let $newFolderBtn, $newFolderForm, $newFolderInput, $newFolderSave, $newFolderCancel;

/* ── Helpers ── */

function showMsg(el, text, type) {
    el.textContent = text;
    el.className = `studio__msg studio__msg--${type}`;
}

function hideMsg(el) {
    el.className = 'studio__msg';
    el.textContent = '';
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

function populateFolderOptions(selectEl) {
    const safeFolders = Array.isArray(folders) ? folders : [];
    const current = selectEl.value;
    const opts = ['<option value="">No folder</option>'];
    for (const f of safeFolders) {
        opts.push(`<option value="${f.id}">${escapeHtml(f.name)}</option>`);
    }
    selectEl.innerHTML = opts.join('');
    if (current) selectEl.value = current;
}

/* ── Folders ── */

async function loadFolders() {
    try {
        folders = await apiAiGetFolders();
    } catch (e) {
        console.warn('Studio: Failed to load folders:', e);
        folders = [];
    }
    populateFolderOptions($folderSelect);
    populateFolderOptions($galleryFilter);
    $galleryFilter.insertAdjacentHTML('afterbegin', '<option value="">All images</option>');
    $galleryFilter.value = '';
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

    const res = await apiAiGenerateImage(prompt, steps, seed);

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
        folderId,
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
    loadGallery();
}

/* ── Gallery ── */

async function loadGallery() {
    const folderId = $galleryFilter.value || null;
    let images;
    try {
        images = await apiAiGetImages(folderId);
    } catch (e) {
        console.warn('Studio: Failed to load gallery:', e);
        images = [];
    }
    if (!Array.isArray(images)) images = [];

    if (images.length === 0) {
        $imageGrid.innerHTML = '<div class="studio__gallery-empty">No saved images yet. Generate and save your first one above.</div>';
        return;
    }

    $imageGrid.innerHTML = '';
    for (const img of images) {
        const item = document.createElement('div');
        item.className = 'studio__image-item';
        item.title = img.prompt;

        const imgEl = document.createElement('img');
        imgEl.src = `/api/ai/images/${img.id}/file`;
        imgEl.alt = img.prompt;
        imgEl.loading = 'lazy';
        item.appendChild(imgEl);

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
            const del = await apiAiDeleteImage(img.id);
            if (del.ok) {
                item.remove();
                if ($imageGrid.children.length === 0) {
                    $imageGrid.innerHTML = '<div class="studio__gallery-empty">No saved images yet.</div>';
                }
            } else {
                delBtn.disabled = false;
                delBtn.textContent = 'Delete';
                showMsg($galleryMsg, del.error, 'error');
            }
        });
        overlay.appendChild(delBtn);
        item.appendChild(overlay);

        $imageGrid.appendChild(item);
    }
}

/* ── New Folder ── */

function showNewFolderForm() {
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
    showMsg($galleryMsg, `Folder "${escapeHtml(name)}" created.`, 'success');
}

/* ── Public API ── */

export function initGalleryStudio() {
    if (initialized) return;
    initialized = true;

    $prompt        = document.getElementById('galStudioPrompt');
    $steps         = document.getElementById('galStudioSteps');
    $seed          = document.getElementById('galStudioSeed');
    $randomize     = document.getElementById('galStudioRandomize');
    $generateBtn   = document.getElementById('galStudioGenerate');
    $preview       = document.getElementById('galStudioPreview');
    $genMsg        = document.getElementById('galStudioGenMsg');
    $saveBar       = document.getElementById('galStudioSaveBar');
    $folderSelect  = document.getElementById('galStudioFolderSelect');
    $saveBtn       = document.getElementById('galStudioSaveBtn');
    $galleryFilter = document.getElementById('galStudioGalleryFilter');
    $imageGrid     = document.getElementById('galStudioImageGrid');
    $galleryMsg    = document.getElementById('galStudioGalleryMsg');
    $newFolderBtn    = document.getElementById('galStudioNewFolderBtn');
    $newFolderForm   = document.getElementById('galStudioNewFolderForm');
    $newFolderInput  = document.getElementById('galStudioNewFolderInput');
    $newFolderSave   = document.getElementById('galStudioNewFolderSave');
    $newFolderCancel = document.getElementById('galStudioNewFolderCancel');

    if (!$prompt || !$generateBtn) return;

    /* Attach mobile deck swipe + click-to-preview to saved images grid */
    if ($imageGrid) initStudioDeck($imageGrid);

    // Quota indicator (inject after the actions row, load from server)
    const $actions = document.querySelector('#galleryStudio .studio__actions');
    if ($actions) { injectQuotaEl($actions); loadQuota(); }

    loadFolders();
    loadGallery();

    $generateBtn.addEventListener('click', handleGenerate);
    $saveBtn.addEventListener('click', handleSave);
    $randomize.addEventListener('click', () => {
        $seed.value = Math.floor(Math.random() * 2147483647);
    });
    $galleryFilter.addEventListener('change', loadGallery);
    $newFolderBtn.addEventListener('click', showNewFolderForm);
    $newFolderCancel.addEventListener('click', hideNewFolderForm);
    $newFolderSave.addEventListener('click', handleCreateFolder);
    $newFolderInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); handleCreateFolder(); }
        if (e.key === 'Escape') hideNewFolderForm();
    });

    $prompt.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            handleGenerate();
        }
    });
}
