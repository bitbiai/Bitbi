/* ============================================================
   BITBI — Gallery Create: inline AI image generation
   Homepage creator for the gallery section.
   Lazy-initialized when the user first activates Create mode.
   ============================================================ */

import {
    apiAiGenerateImage,
    apiAiGetQuota,
    apiAiGetFolders,
    apiAiSaveImage,
} from '../../shared/auth-api.js?v=__ASSET_VERSION__';
import {
    DEFAULT_AI_IMAGE_MODEL,
    getAiImageModelConfig,
    getAiImageModelOptions,
} from '../../shared/ai-image-models.mjs?v=__ASSET_VERSION__';

let initialized = false;
let currentImageData = null;
let currentMeta = null;
let folders = [];
let creditBalance = null;
let $quotaEl = null;
const SAVE_REFERENCE_FALLBACK_CODES = new Set([
    'INVALID_SAVE_REFERENCE',
    'SAVE_REFERENCE_EXPIRED',
    'SAVE_REFERENCE_UNAVAILABLE',
]);

/* DOM refs (resolved on init) */
let $prompt, $model, $steps, $seed, $randomize, $generateBtn, $preview, $genMsg;
let $saveBar, $folderSelect, $saveBtn, $costLabel;

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
    if (!$quotaEl || creditBalance === null) return;
    $quotaEl.textContent = `${creditBalance} credits available`;
    $quotaEl.classList.toggle('studio__quota--empty', creditBalance <= 0);
}

async function loadQuota() {
    const q = await apiAiGetQuota();
    if (!q || q.isAdmin) {
        if ($quotaEl) $quotaEl.style.display = 'none';
        creditBalance = null;
        return;
    }
    creditBalance = typeof q.creditBalance === 'number' ? q.creditBalance : null;
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

function getEstimatedImageCredits() {
    const selectedModel = $model?.value || DEFAULT_AI_IMAGE_MODEL;
    const config = getAiImageModelConfig(selectedModel);
    const credits = Number(config?.estimatedCredits);
    return Number.isFinite(credits) && credits > 0 ? Math.ceil(credits) : 1;
}

function formatCreditEstimate(credits) {
    return `${credits} credit${credits === 1 ? '' : 's'}`;
}

function renderGenerateButtonLabel() {
    if (!$generateBtn) return;
    const credits = getEstimatedImageCredits();
    const label = `Generate \u00b7 ${formatCreditEstimate(credits)}`;
    $generateBtn.textContent = label;
    $generateBtn.setAttribute('aria-label', `Generate image, estimated cost ${formatCreditEstimate(credits)}`);
    if ($costLabel) {
        $costLabel.textContent = formatCreditEstimate(credits);
    }
}

/* ── Folders ── */

async function loadFolders() {
    try {
        const result = await apiAiGetFolders();
        folders = result.folders;
    } catch (e) {
        console.warn('Gallery Create: Failed to load folders:', e);
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

    let res;
    try {
        res = await apiAiGenerateImage(prompt, steps, seed, model);
    } catch (error) {
        console.warn('Gallery studio generate failed:', error);
        $preview.innerHTML = '<div class="studio__preview-empty">Generation failed</div>';
        showMsg($genMsg, 'Generation failed. Please try again.', 'error');
        return;
    } finally {
        $generateBtn.disabled = false;
        renderGenerateButtonLabel();
    }

    if (!res.ok) {
        $preview.innerHTML = '<div class="studio__preview-empty">Generation failed</div>';
        showMsg($genMsg, res.error, 'error');
        if (res.data?.code === 'insufficient_member_credits' && creditBalance !== null) {
            creditBalance = 0;
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
    currentMeta = {
        prompt: d.prompt || prompt,
        model: d.model || '',
        steps: d.steps,
        seed: d.seed,
        saveReference: typeof d.saveReference === 'string' ? d.saveReference : null,
    };

    $preview.innerHTML = '';
    const img = document.createElement('img');
    img.src = currentImageData;
    img.alt = prompt;
    $preview.appendChild(img);

    $saveBar.classList.add('visible');
    showMsg($genMsg, 'Image generated.', 'success');

    const balanceAfter = res.data?.billing?.balance_after;
    if (typeof balanceAfter === 'number') {
        creditBalance = balanceAfter;
        renderQuota();
    }
}

/* ── Save Image ── */

async function handleSave() {
    if (!currentMeta || (!currentImageData && !currentMeta.saveReference)) return;

    $saveBtn.disabled = true;
    $saveBtn.textContent = 'Saving\u2026';

    const folderId = $folderSelect.value || null;
    let res;
    try {
        res = await apiAiSaveImage(
            currentMeta.saveReference ? { saveReference: currentMeta.saveReference } : currentImageData,
            currentMeta.prompt,
            currentMeta.model,
            currentMeta.steps,
            currentMeta.seed,
            folderId,
        );
        if (
            !res.ok &&
            currentMeta.saveReference &&
            currentImageData &&
            SAVE_REFERENCE_FALLBACK_CODES.has(res.code)
        ) {
            res = await apiAiSaveImage(
                currentImageData,
                currentMeta.prompt,
                currentMeta.model,
                currentMeta.steps,
                currentMeta.seed,
                folderId,
            );
        }
    } catch (error) {
        console.warn('Gallery studio save failed:', error);
        showMsg($genMsg, 'Save failed. Please try again.', 'error');
        return;
    } finally {
        $saveBtn.disabled = false;
        $saveBtn.textContent = 'Save';
    }

    if (!res.ok) {
        showMsg($genMsg, res.error, 'error');
        return;
    }

    $genMsg.innerHTML = 'Image saved. <a href="/account/assets-manager.html" class="studio__save-link">Open in Assets Manager</a>';
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
    $costLabel     = document.getElementById('galStudioCreditEstimate');

    if (!$prompt || !$generateBtn) return;
    populateModelOptions($model);
    renderGenerateButtonLabel();

    // Quota indicator (inject after the actions row, load from server)
    const $actions = document.querySelector('#galleryStudio .studio__actions');
    if ($actions) { injectQuotaEl($actions); loadQuota(); }

    loadFolders();

    $generateBtn.addEventListener('click', handleGenerate);
    $model?.addEventListener('change', renderGenerateButtonLabel);
    $steps?.addEventListener('change', renderGenerateButtonLabel);
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
