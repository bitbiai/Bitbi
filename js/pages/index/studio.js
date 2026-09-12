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
    getAiImageModelOptions,
    getGenerateLabAiImageModelOptions,
    getAiImageModelConfig,
} from '../../shared/ai-image-models.mjs?v=__ASSET_VERSION__';
import { calculateAiImageCreditCost } from '../../shared/ai-model-pricing.mjs?v=__ASSET_VERSION__';
import { getCurrentLocale, localeText, localizedHref } from '../../shared/locale.js?v=__ASSET_VERSION__';

let initialized = false;
let currentImageData = null;
let currentMeta = null;
const imageSaveOperations = new Map();
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
let $title;

const HOMEPAGE_GALLERY_CREATE_MODEL_IDS = Object.freeze([
    DEFAULT_AI_IMAGE_MODEL,
    '@cf/black-forest-labs/flux-2-klein-9b',
]);

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
    $quotaEl.textContent = localeText('studio.creditsAvailable', { count: creditBalance });
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
    const opts = [`<option value="">${escapeHtml(localeText('studio.assetsOption'))}</option>`];
    for (const f of safeFolders) {
        opts.push(`<option value="${f.id}">${escapeHtml(f.name)}</option>`);
    }
    selectEl.innerHTML = opts.join('');
    if (current) selectEl.value = current;
}

function populateModelOptions(selectEl, currentValue = DEFAULT_AI_IMAGE_MODEL) {
    if (!selectEl) return;

    const generateLabModels = new Map(getGenerateLabAiImageModelOptions().map((model) => [model.id, model]));
    const homepageModels = HOMEPAGE_GALLERY_CREATE_MODEL_IDS
        .map((id) => generateLabModels.get(id))
        .filter(Boolean);
    const options = (homepageModels.length ? homepageModels : getAiImageModelOptions()).map(
        ({ id, label }) => `<option value="${id}">${escapeHtml(label)}</option>`
    );
    selectEl.innerHTML = options.join('');
    selectEl.value = currentValue;
}

function selectedModelConfig() {
    return getAiImageModelConfig($model?.value || DEFAULT_AI_IMAGE_MODEL)
        || getAiImageModelConfig(DEFAULT_AI_IMAGE_MODEL);
}

function toggleFieldSupport(control, supported) {
    const field = control?.closest('.creator-create__field, .studio__field');
    if (field) field.hidden = !supported;
    if (control) {
        control.disabled = !supported;
        control.setAttribute('aria-disabled', supported ? 'false' : 'true');
    }
}

function syncModelCapabilityControls() {
    const config = selectedModelConfig();
    const supportsSteps = config?.supportsSteps === true;
    const supportsSeed = config?.supportsSeed === true;

    if ($title) {
        $title.textContent = config?.label || 'FLUX.1 Schnell';
    }
    toggleFieldSupport($steps, supportsSteps);
    toggleFieldSupport($seed, supportsSeed);
    if ($randomize) {
        $randomize.disabled = !supportsSeed;
        $randomize.setAttribute('aria-disabled', supportsSeed ? 'false' : 'true');
        $randomize.closest('.creator-create__field, .studio__field')?.toggleAttribute('hidden', !supportsSeed);
    }
}

function getEstimatedImageCredits() {
    const selectedModel = $model?.value || DEFAULT_AI_IMAGE_MODEL;
    const config = selectedModelConfig();
    const params = {
        width: config?.multipartDefaults?.width || 1024,
        height: config?.multipartDefaults?.height || 1024,
    };
    if (config?.supportsSteps === true) {
        params.steps = $steps?.value ? Number($steps.value) : 4;
    }
    const pricing = calculateAiImageCreditCost(selectedModel, params);
    return Math.max(1, Math.ceil(Number(pricing?.credits || 1)));
}

function formatCreditEstimate(credits) {
    return localeText('studio.creditEstimate', { count: credits, plural: credits === 1 ? '' : 's' });
}

function renderGenerateButtonLabel() {
    if (!$generateBtn) return;
    const credits = getEstimatedImageCredits();
    const cost = formatCreditEstimate(credits);
    const label = localeText('studio.generateImageCost', { cost });
    $generateBtn.textContent = label;
    $generateBtn.setAttribute('aria-label', localeText('studio.generateImageAria', { cost }));
    if ($costLabel) {
        $costLabel.textContent = cost;
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
    if ($generateBtn.disabled) return;
    const prompt = $prompt.value.trim();
    if (!prompt) {
        showMsg($genMsg, localeText('studio.promptRequiredImage'), 'error');
        return;
    }

    hideMsg($genMsg);
    $generateBtn.disabled = true;
    $generateBtn.textContent = localeText('studio.generating');
    $saveBar.classList.remove('visible');
    currentImageData = null;
    currentMeta = null;
    syncImageSaves();

    $preview.innerHTML = `<div class="studio__loading"><div class="studio__spinner"></div><span>${escapeHtml(localeText('studio.creatingImage'))}</span></div>`;

    const config = selectedModelConfig();
    const steps = config?.supportsSteps === true && $steps.value ? Number($steps.value) : null;
    const seed  = config?.supportsSeed === true && $seed.value ? Number($seed.value) : null;
    const model = $model?.value || DEFAULT_AI_IMAGE_MODEL;

    let res;
    try {
        res = await apiAiGenerateImage(prompt, steps, seed, model,{durable:true,onAccepted:()=>showMsg($genMsg,localeText('generation.accepted'),'info')});
    } catch (error) {
        console.warn('Gallery studio generate failed:', error);
        $preview.innerHTML = `<div class="studio__preview-empty">${escapeHtml(localeText('studio.generationFailedTitle'))}</div>`;
        showMsg($genMsg, localeText('studio.generationFailed'), 'error');
        return;
    } finally {
        $generateBtn.disabled = false;
        renderGenerateButtonLabel();
    }

    if (!res.ok) {
        $preview.innerHTML = `<div class="studio__preview-empty">${escapeHtml(localeText('studio.generationFailedTitle'))}</div>`;
        showMsg($genMsg, res.error, res.pending ? 'info' : 'error');
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
        $preview.innerHTML = `<div class="studio__preview-empty">${escapeHtml(localeText('studio.noImageInResponse'))}</div>`;
        showMsg($genMsg, localeText('studio.noImageReturned'), 'error');
        return;
    }

    currentImageData = `data:${mimeType};base64,${imageBase64}`;
    currentMeta = Object.freeze({
        prompt: d.prompt || prompt,
        model: d.model || '',
        steps: d.steps,
        seed: d.seed,
        saveReference: typeof d.saveReference === 'string' ? d.saveReference : null,
    });

    $preview.innerHTML = '';
    const img = document.createElement('img');
    img.src = currentImageData;
    img.alt = prompt;
    $preview.appendChild(img);

    $saveBar.classList.toggle('visible', !d.asset?.id);
    syncImageSaves();
    showMsg($genMsg, localeText('studio.imageGenerated'), 'success');

    const balanceAfter = res.data?.billing?.balance_after;
    if (typeof balanceAfter === 'number') {
        creditBalance = balanceAfter;
        renderQuota();
    }
}

/* ── Save Image ── */

function renderDetachedImageSave(operation) {
    const { context } = operation;
    if (context.identity === currentMeta) return;
    if (!operation.notice) {
        const notice = document.createElement('div');
        notice.className = 'studio__msg studio__msg--info';
        notice.dataset.imageSaveNotice = '';
        notice.setAttribute('aria-live', 'polite');
        notice.tabIndex = -1;
        const image = document.createElement('img');
        image.src = context.imageData;
        image.alt = context.meta.prompt;
        image.width = 72;
        image.height = 72;
        image.style.objectFit = 'contain';
        const description = document.createElement('p');
        description.style.overflowWrap = 'anywhere';
        description.textContent = `${context.meta.prompt} · ${context.meta.model} · ${context.folderName}`;
        const status = document.createElement('p');
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'studio__save-btn creator-create__save-btn';
        retry.textContent = getCurrentLocale() === 'de' ? 'Dieses Bild erneut speichern' : 'Retry saving this image';
        retry.addEventListener('click', () => {
            if (document.activeElement === retry) notice.focus({ preventScroll: true });
            saveImageOperation(operation);
        });
        notice.append(image, description, status, retry);
        $saveBar.after(notice);
        Object.assign(operation, { notice, status, retry });
    }
    operation.notice.dataset.imageSaveState = operation.pending ? 'pending' : 'failed';
    operation.status.textContent = operation.pending ? localeText('studio.saving') : (operation.error || localeText('studio.saveFailed'));
    operation.retry.hidden = operation.pending;
    operation.retry.disabled = operation.pending;
}

function syncImageSaves() {
    for (const operation of imageSaveOperations.values()) renderDetachedImageSave(operation);
    const pending = imageSaveOperations.get(currentMeta)?.pending === true;
    $saveBtn.disabled = pending;
    $saveBtn.textContent = localeText(pending ? 'studio.saving' : 'studio.save');
}

async function handleSave() {
    if (!currentMeta || (!currentImageData && !currentMeta.saveReference)) return;
    let operation = imageSaveOperations.get(currentMeta);
    if (!operation) {
        document.querySelectorAll('#galleryStudio [data-image-save-state="saved"]').forEach((node) => node.remove());
        operation = { context: Object.freeze({
            identity: currentMeta,
            imageData: currentImageData,
            meta: Object.freeze({ ...currentMeta }),
            folderId: $folderSelect.value || null,
            folderName: $folderSelect.selectedOptions[0]?.textContent || localeText('studio.assetsOption'),
        }), pending: false, saved: false };
        imageSaveOperations.set(currentMeta, operation);
    }
    await saveImageOperation(operation);
}

async function saveImageOperation(operation) {
    if (operation.pending || operation.saved) return;
    operation.pending = true;
    const { identity, imageData, meta, folderId } = operation.context;
    syncImageSaves();
    let res;
    try {
        res = await apiAiSaveImage(
            meta.saveReference ? { saveReference: meta.saveReference } : imageData,
            meta.prompt,
            meta.model,
            meta.steps,
            meta.seed,
            folderId,
        );
        if (
            !res.ok &&
            meta.saveReference &&
            imageData &&
            SAVE_REFERENCE_FALLBACK_CODES.has(res.code)
        ) {
            res = await apiAiSaveImage(
                imageData,
                meta.prompt,
                meta.model,
                meta.steps,
                meta.seed,
                folderId,
            );
        }
    } catch (error) {
        console.warn('Gallery studio save failed:', error);
        res = { ok: false, error: localeText('studio.saveFailed') };
    }
    operation.pending = false;
    if (!res.ok) {
        operation.error = res.error || localeText('studio.saveFailed');
        syncImageSaves();
        if (document.activeElement === operation.notice) operation.retry?.focus({ preventScroll: true });
        if (currentMeta === identity) {
            showMsg($genMsg, `${operation.error} ${localeText('assets.folder')}: ${operation.context.folderName}.`, 'error');
        }
        return;
    }

    operation.saved = true;
    imageSaveOperations.delete(identity);
    if (operation.notice) {
        operation.notice.dataset.imageSaveState = 'saved';
        operation.notice.textContent = `${localeText('studio.imageSavedPrefix')}${meta.prompt}`;
    }
    if (currentMeta !== identity) return;

    const restoreSaveFocus = document.activeElement === $saveBtn;
    const assetsLink = document.createElement('a');
    assetsLink.href = localizedHref('/account/assets-manager.html');
    assetsLink.className = 'studio__save-link';
    assetsLink.textContent = localeText('studio.openAssetsManager');
    $genMsg.replaceChildren(document.createTextNode(localeText('studio.imageSavedPrefix')), assetsLink);
    $genMsg.className = 'studio__msg studio__msg--success';
    $saveBar.classList.remove('visible');
    currentImageData = null;
    currentMeta = null;
    syncImageSaves();
    if (restoreSaveFocus) assetsLink.focus({ preventScroll: true });
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
    $title         = document.getElementById('galleryCreateTitle');

    if (!$prompt || !$generateBtn) return;
    populateModelOptions($model);
    syncModelCapabilityControls();
    renderGenerateButtonLabel();

    // Quota indicator (inject after the actions row, load from server)
    const $actions = document.querySelector('#galleryStudio .studio__actions');
    if ($actions) { injectQuotaEl($actions); loadQuota(); }

    loadFolders();

    $generateBtn.addEventListener('click', handleGenerate);
    $model?.addEventListener('change', () => {
        syncModelCapabilityControls();
        renderGenerateButtonLabel();
    });
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
