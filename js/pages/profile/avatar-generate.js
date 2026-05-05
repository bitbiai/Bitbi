/* ============================================================
   BITBI — Compact avatar-generation overlay
   Hardcoded settings (FLUX.1 Schnell, 4 steps, 1024×1024) are
   enforced here, not exposed to the user. Reuses the existing
   /api/ai/generate-image endpoint so member credit charging
   stays aligned with Assets Manager. The Use button resizes the already
   generated image client-side and calls /api/profile/avatar via
   the existing FormData upload route — no second generation.
   ============================================================ */

import {
    apiAiGenerateImage,
    apiAiGetQuota,
    apiUploadAvatar,
} from '../../shared/auth-api.js?v=__ASSET_VERSION__';
import { DEFAULT_AI_IMAGE_MODEL } from '../../shared/ai-image-models.mjs?v=__ASSET_VERSION__';
import { setupFocusTrap } from '../../shared/focus-trap.js';

export const AVATAR_GENERATION_MODEL = DEFAULT_AI_IMAGE_MODEL;
export const AVATAR_GENERATION_STEPS = 4;
export const AVATAR_GENERATION_SIZE = 1024;
const AVATAR_UPLOAD_DESKTOP_SIZE = 512;
const AVATAR_UPLOAD_DESKTOP_QUALITY = 0.9;
// Matches the existing saved-image thumb preset used for avatar selection.
const AVATAR_UPLOAD_MOBILE_THUMB_SIZE = 320;
const AVATAR_UPLOAD_MOBILE_THUMB_QUALITY = 0.82;
const AVATAR_UPLOAD_PREFERRED_MIME = 'image/webp';
const AVATAR_UPLOAD_FALLBACK_MIME = 'image/png';
const MOBILE_AVATAR_UPLOAD_QUERY = '(max-width: 1023px)';

let initialized = false;
let focusTrapCleanup = null;
let busy = false;
let creditBalance = null;
let isAdmin = false;
let generatedImageDataUrl = null;
let onAvatarUpdated = () => {};
let onClose = () => {};

let $modal = null;
let $closeBtn = null;
let $title = null;
let $preview = null;
let $msg = null;
let $prompt = null;
let $generateBtn = null;
let $useBtn = null;
let $quota = null;

function showMsg(text, type) {
    if (!$msg) return;
    $msg.textContent = text;
    $msg.className = type ? `profile__msg profile__msg--${type}` : 'profile__msg';
}

function hideMsg() {
    if (!$msg) return;
    $msg.textContent = '';
    $msg.className = 'profile__msg';
}

function renderQuota() {
    if (!$quota) return;
    if (isAdmin || creditBalance === null) {
        $quota.hidden = true;
        $quota.textContent = '';
        return;
    }
    $quota.hidden = false;
    $quota.textContent = `${creditBalance} credits available`;
    $quota.classList.toggle('profile-avatar-generate__quota--empty', creditBalance <= 0);
}

async function loadQuota() {
    const q = await apiAiGetQuota();
    if (!q) {
        isAdmin = false;
        creditBalance = null;
        renderQuota();
        return;
    }
    isAdmin = !!q.isAdmin;
    creditBalance = typeof q.creditBalance === 'number' ? q.creditBalance : null;
    renderQuota();
}

function setBusy(state, generateLabel = 'Generate', useLabel = 'Use') {
    busy = state;
    if ($generateBtn) {
        $generateBtn.disabled = state;
        $generateBtn.textContent = state ? generateLabel : 'Generate';
    }
    if ($useBtn) {
        $useBtn.textContent = useLabel;
    }
    if ($prompt) $prompt.disabled = state;
    if ($closeBtn) $closeBtn.disabled = state;
}

function setUseEnabled(enabled) {
    if (!$useBtn) return;
    $useBtn.disabled = !enabled;
    $useBtn.classList.toggle('profile-avatar-generate__btn--ready', enabled);
}

function clearPreview() {
    if (!$preview) return;
    const empty = document.createElement('div');
    empty.className = 'profile-avatar-generate__preview-empty';
    empty.textContent = 'Your avatar will appear here.';
    $preview.replaceChildren(empty);
}

function setPreviewLoading() {
    if (!$preview) return;
    const wrap = document.createElement('div');
    wrap.className = 'profile-avatar-generate__preview-loading';
    const spinner = document.createElement('div');
    spinner.className = 'profile-avatar-generate__spinner';
    spinner.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = 'Creating your avatar…';
    wrap.append(spinner, label);
    $preview.replaceChildren(wrap);
}

function setPreviewImage(dataUrl, alt) {
    if (!$preview) return;
    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = alt;
    img.className = 'profile-avatar-generate__preview-img';
    $preview.replaceChildren(img);
}

function resetState() {
    generatedImageDataUrl = null;
    setUseEnabled(false);
    hideMsg();
    clearPreview();
    if ($prompt) $prompt.value = '';
}

async function handleGenerate() {
    if (busy) return;
    const prompt = ($prompt?.value || '').trim();
    if (!prompt) {
        showMsg('Please describe your avatar.', 'error');
        $prompt?.focus();
        return;
    }
    if (!isAdmin && creditBalance !== null && creditBalance <= 0) {
        showMsg('No image credits available.', 'error');
        return;
    }

    hideMsg();
    setBusy(true, 'Generating…');
    setUseEnabled(false);
    generatedImageDataUrl = null;
    setPreviewLoading();

    const seed = Math.floor(Math.random() * 2147483647);

    let res;
    try {
        res = await apiAiGenerateImage(
            prompt,
            AVATAR_GENERATION_STEPS,
            seed,
            AVATAR_GENERATION_MODEL,
        );
    } catch (error) {
        console.warn('Avatar generation failed:', error);
        showMsg('Generation failed. Please try again.', 'error');
        clearPreview();
        setBusy(false);
        return;
    } finally {
        setBusy(false);
    }

    if (!res?.ok) {
        const msg = res?.error || 'Generation failed. Please try again.';
        showMsg(msg, 'error');
        clearPreview();
        if (res?.data?.code === 'insufficient_member_credits' && creditBalance !== null) {
            creditBalance = 0;
            renderQuota();
        }
        return;
    }

    const data = res.data?.data || res.data || {};
    const imageBase64 = data.imageBase64;
    const mimeType = data.mimeType || 'image/png';
    if (!imageBase64) {
        showMsg('No image returned. Please try again.', 'error');
        clearPreview();
        return;
    }

    generatedImageDataUrl = `data:${mimeType};base64,${imageBase64}`;
    setPreviewImage(generatedImageDataUrl, prompt);
    setUseEnabled(true);
    showMsg('Avatar ready. Press Use to apply it.', 'success');

    const balanceAfter = res.data?.billing?.balance_after;
    if (!isAdmin && typeof balanceAfter === 'number') {
        creditBalance = balanceAfter;
        renderQuota();
    }
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Could not decode generated image.'));
        img.src = src;
    });
}

function canvasToBlob(canvas, mime, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (blob) resolve(blob);
                else reject(new Error('Could not encode avatar image.'));
            },
            mime,
            quality,
        );
    });
}

export function normalizeImageMimeType(type) {
    const normalized = String(type || '').trim().toLowerCase();
    if (normalized === 'image/webp' || normalized === 'image/jpeg' || normalized === 'image/png') {
        return normalized;
    }
    return AVATAR_UPLOAD_FALLBACK_MIME;
}

export function extensionFromMimeType(type) {
    switch (normalizeImageMimeType(type)) {
        case 'image/webp':
            return 'webp';
        case 'image/jpeg':
            return 'jpg';
        case 'image/png':
        default:
            return 'png';
    }
}

function isKnownImageMimeType(type) {
    const normalized = String(type || '').trim().toLowerCase();
    return normalized === 'image/webp' || normalized === 'image/jpeg' || normalized === 'image/png';
}

export function createAvatarUploadFile(blob) {
    const mimeType = normalizeImageMimeType(blob?.type);
    const extension = extensionFromMimeType(mimeType);
    return new File([blob], `avatar.${extension}`, { type: mimeType });
}

export function isMobileAvatarUploadViewport() {
    try {
        return window.matchMedia?.(MOBILE_AVATAR_UPLOAD_QUERY)?.matches === true;
    } catch {
        return false;
    }
}

export function getAvatarUploadEncodingProfile({ mobile = isMobileAvatarUploadViewport() } = {}) {
    return mobile
        ? {
            size: AVATAR_UPLOAD_MOBILE_THUMB_SIZE,
            quality: AVATAR_UPLOAD_MOBILE_THUMB_QUALITY,
            variant: 'mobile-thumb',
        }
        : {
            size: AVATAR_UPLOAD_DESKTOP_SIZE,
            quality: AVATAR_UPLOAD_DESKTOP_QUALITY,
            variant: 'desktop',
        };
}

async function reencodeForAvatar(dataUrl, encodingProfile = getAvatarUploadEncodingProfile()) {
    const img = await loadImage(dataUrl);
    const canvas = document.createElement('canvas');
    const targetSize = Math.max(1, Number(encodingProfile?.size) || AVATAR_UPLOAD_DESKTOP_SIZE);
    canvas.width = targetSize;
    canvas.height = targetSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable.');
    const sourceSize = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
    const sx = ((img.naturalWidth || img.width) - sourceSize) / 2;
    const sy = ((img.naturalHeight || img.height) - sourceSize) / 2;
    ctx.drawImage(img, sx, sy, sourceSize, sourceSize, 0, 0, targetSize, targetSize);
    let blob;
    try {
        blob = await canvasToBlob(
            canvas,
            AVATAR_UPLOAD_PREFERRED_MIME,
            Number(encodingProfile?.quality) || AVATAR_UPLOAD_DESKTOP_QUALITY,
        );
        if (!blob || blob.size === 0) throw new Error('Empty blob.');
        if (!isKnownImageMimeType(blob.type)) throw new Error('Unknown encoded avatar type.');
        return createAvatarUploadFile(blob);
    } catch {
        const pngBlob = await canvasToBlob(canvas, 'image/png');
        return createAvatarUploadFile(pngBlob);
    }
}

async function handleUse() {
    if (busy || !generatedImageDataUrl) return;

    setBusy(true, 'Generate', 'Applying…');
    if ($useBtn) $useBtn.disabled = true;
    hideMsg();

    try {
        const file = await reencodeForAvatar(generatedImageDataUrl);
        const result = await apiUploadAvatar(file);

        if (!result?.ok) {
            showMsg(result?.error || 'Could not apply avatar. Please try again.', 'error');
            if ($useBtn) $useBtn.disabled = false;
            return;
        }

        try { onAvatarUpdated(); } catch (e) { console.warn('avatar update callback failed:', e); }
        closeAvatarGenerateModal({ resetForm: true });
    } catch (error) {
        console.warn('Avatar apply failed:', error);
        showMsg('Could not apply avatar. Please try again.', 'error');
        if ($useBtn) $useBtn.disabled = false;
    } finally {
        setBusy(false);
        if ($useBtn) $useBtn.textContent = 'Use';
    }
}

function bindEvents() {
    $generateBtn?.addEventListener('click', handleGenerate);
    $useBtn?.addEventListener('click', handleUse);
    $closeBtn?.addEventListener('click', () => closeAvatarGenerateModal());

    $modal?.addEventListener('click', (event) => {
        if (event.target === $modal) closeAvatarGenerateModal();
    });

    $prompt?.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            handleGenerate();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if (!$modal || $modal.hidden) return;
        if (busy) return;
        event.preventDefault();
        closeAvatarGenerateModal();
    });
}

function ensureInit() {
    if (initialized) return true;

    $modal       = document.getElementById('avatarGenerateModal');
    $closeBtn    = document.getElementById('avatarGenerateClose');
    $title       = document.getElementById('avatarGenerateTitle');
    $preview     = document.getElementById('avatarGeneratePreview');
    $msg         = document.getElementById('avatarGenerateMsg');
    $prompt      = document.getElementById('avatarGeneratePrompt');
    $generateBtn = document.getElementById('avatarGenerateBtn');
    $useBtn      = document.getElementById('avatarGenerateUseBtn');
    $quota       = document.getElementById('avatarGenerateQuota');

    if (!$modal || !$prompt || !$generateBtn || !$useBtn || !$preview) {
        return false;
    }

    bindEvents();
    initialized = true;
    return true;
}

export function initAvatarGenerate(opts = {}) {
    if (typeof opts.onAvatarUpdated === 'function') onAvatarUpdated = opts.onAvatarUpdated;
    if (typeof opts.onClose === 'function') onClose = opts.onClose;
    return ensureInit();
}

export function openAvatarGenerateModal() {
    if (!ensureInit()) return;
    if (!$modal.hidden) return;

    resetState();
    setUseEnabled(false);

    $modal.hidden = false;
    $modal.setAttribute('aria-hidden', 'false');
    $modal.classList.add('active');

    if (focusTrapCleanup) {
        try { focusTrapCleanup(); } catch {}
        focusTrapCleanup = null;
    }
    const focusTarget = $modal.querySelector('.modal-card');
    focusTrapCleanup = setupFocusTrap(focusTarget);

    document.body.style.overflow = 'hidden';

    loadQuota();
    window.setTimeout(() => $prompt?.focus(), 0);
}

export function closeAvatarGenerateModal({ resetForm = false } = {}) {
    if (!$modal || $modal.hidden) return;

    $modal.classList.remove('active');
    $modal.hidden = true;
    $modal.setAttribute('aria-hidden', 'true');

    if (focusTrapCleanup) {
        try { focusTrapCleanup(); } catch {}
        focusTrapCleanup = null;
    }

    document.body.style.overflow = '';

    if (resetForm) {
        resetState();
    }

    try { onClose(); } catch (e) { console.warn('avatar generate close callback failed:', e); }
}

export function isAvatarGenerateModalOpen() {
    return !!($modal && !$modal.hidden);
}
