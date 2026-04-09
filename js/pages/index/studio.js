/* ============================================================
   BITBI — Gallery Studio: inline AI image generation
   Embedded version of Image Studio for the gallery section.
   Lazy-initialized when the user first activates Create mode.
   ============================================================ */

import {
    apiAiGenerateImage,
    apiAiGetQuota,
    apiAiGetFolders,
    apiAiSaveImage,
} from '../../shared/auth-api.js?v=20260409-wave7';
import {
    DEFAULT_AI_IMAGE_MODEL,
    getAiImageModelOptions,
} from '../../shared/ai-image-models.mjs?v=20260409-wave7-fix';

let initialized = false;
let currentImageData = null;
let currentMeta = null;
let folders = [];
let quotaRemaining = null;
let quotaLimit = 10;
let $quotaEl = null;

/* DOM refs (resolved on init) */
let $prompt, $model, $steps, $seed, $randomize, $generateBtn, $preview, $genMsg;
let $saveBar, $folderSelect, $saveBtn;

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

/* ── Folders ── */

async function loadFolders() {
    try {
        const result = await apiAiGetFolders();
        folders = result.folders;
    } catch (e) {
        console.warn('Studio: Failed to load folders:', e);
        folders = [];
    }
    populateFolderOptions($folderSelect);
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

    $genMsg.innerHTML = 'Image saved. <a href="/account/image-studio.html" class="studio__save-link">Open in Image Studio</a>';
    $genMsg.className = 'studio__msg studio__msg--success';
    $saveBar.classList.remove('visible');
    currentImageData = null;
    currentMeta = null;
}

/* ── Public API ── */

export function initGalleryStudio() {
    if (initialized) return;
    initialized = true;

    $prompt        = document.getElementById('galStudioPrompt');
    $model         = document.getElementById('galStudioModel');
    $steps         = document.getElementById('galStudioSteps');
    $seed          = document.getElementById('galStudioSeed');
    $randomize     = document.getElementById('galStudioRandomize');
    $generateBtn   = document.getElementById('galStudioGenerate');
    $preview       = document.getElementById('galStudioPreview');
    $genMsg        = document.getElementById('galStudioGenMsg');
    $saveBar       = document.getElementById('galStudioSaveBar');
    $folderSelect  = document.getElementById('galStudioFolderSelect');
    $saveBtn       = document.getElementById('galStudioSaveBtn');

    if (!$prompt || !$generateBtn) return;
    populateModelOptions($model);

    // Quota indicator (inject after the actions row, load from server)
    const $actions = document.querySelector('#galleryStudio .studio__actions');
    if ($actions) { injectQuotaEl($actions); loadQuota(); }

    loadFolders();

    $generateBtn.addEventListener('click', handleGenerate);
    $saveBtn.addEventListener('click', handleSave);
    $randomize.addEventListener('click', () => {
        $seed.value = Math.floor(Math.random() * 2147483647);
    });

    $prompt.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            handleGenerate();
        }
    });
}
