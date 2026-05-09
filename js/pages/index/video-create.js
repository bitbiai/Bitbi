/* ============================================================
   BITBI — Video Create: member PixVerse V6 generation
   ============================================================ */

import {
    apiAiAttachVideoPoster,
    apiAiGenerateVideo,
    apiAiGetQuota,
} from '../../shared/auth-api.js?v=__ASSET_VERSION__';
import { getAuthState } from '../../shared/auth-state.js';
import { openAuthModal } from '../../shared/auth-modal.js';
import { localeText, localizedHref } from '../../shared/locale.js?v=__ASSET_VERSION__';
import {
    PIXVERSE_V6_MAX_DURATION,
    PIXVERSE_V6_MIN_DURATION,
    PIXVERSE_V6_MODEL_ID,
} from '../../shared/pixverse-v6-pricing.mjs?v=__ASSET_VERSION__';
import { calculateAiVideoCreditCost } from '../../shared/ai-model-pricing.mjs?v=__ASSET_VERSION__';

const DEFAULT_DURATION = 5;
const DEFAULT_QUALITY = '720p';
const MAX_REFERENCE_IMAGE_BYTES = 10 * 1024 * 1024;
const MOBILE_PLAYBACK_TIMEOUT_MS = 8000;
const MOBILE_RISKY_VIDEO_MIME_TYPES = new Set(['video/webm', 'video/quicktime']);

let initialized = false;
let creditBalance = null;
let referenceImageDataUri = '';
let $prompt;
let $negative;
let $imageInput;
let $imagePreview;
let $duration;
let $aspectRatio;
let $quality;
let $audio;
let $seed;
let $generateBtn;
let $preview;
let $msg;
let $quotaEl;
let $creditEstimate;
let $referenceRemove;
let $referenceThumb;
let $uploadShell;
let $actionCard;

function showMsg(el, text, type) {
    el.textContent = text;
    el.className = `studio__msg video-create__msg studio__msg--${type}`;
}

function hideMsg(el) {
    el.className = 'studio__msg video-create__msg';
    el.textContent = '';
}

function replacePreview(...nodes) {
    if (!$preview) return;
    $preview.replaceChildren(...nodes);
}

function isMobilePreviewFlow() {
    return Boolean(window.matchMedia?.('(max-width: 767px)').matches);
}

function prefersReducedMotion() {
    return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

function focusPreviewSafely() {
    if (!$preview) return;
    try {
        $preview.focus({ preventScroll: true });
    } catch {
        $preview.focus();
    }
}

function scrollPreviewIntoViewOnMobile({ focus = false } = {}) {
    if (!$preview || !isMobilePreviewFlow()) return;
    const target = $preview.closest('.video-create__panel--preview') || $preview;
    window.requestAnimationFrame(() => {
        if (focus) focusPreviewSafely();
        target.scrollIntoView({
            behavior: prefersReducedMotion() ? 'auto' : 'smooth',
            block: 'start',
            inline: 'nearest',
        });
    });
}

function renderPreviewEmpty(text) {
    const empty = document.createElement('div');
    empty.className = 'video-create__empty';
    const icon = document.createElement('span');
    icon.className = 'video-create__empty-icon';
    icon.setAttribute('aria-hidden', 'true');
    const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    iconSvg.setAttribute('viewBox', '0 0 24 24');
    iconSvg.setAttribute('fill', 'none');
    iconSvg.setAttribute('stroke', 'currentColor');
    iconSvg.setAttribute('stroke-width', '1.6');
    iconSvg.setAttribute('stroke-linecap', 'round');
    iconSvg.setAttribute('stroke-linejoin', 'round');
    const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path1.setAttribute('d', 'M15 10.5 20 7v10l-5-3.5V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z');
    const path2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path2.setAttribute('d', 'M7 9h4');
    const path3 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path3.setAttribute('d', 'M7 13h2');
    iconSvg.append(path1, path2, path3);
    icon.append(iconSvg);
    const title = document.createElement('strong');
    title.textContent = text;
    const copy = document.createElement('span');
    copy.textContent = localeText('studio.adjustVideo');
    empty.append(icon, title, copy);
    replacePreview(empty);
}

function renderPreviewLoading() {
    const loading = document.createElement('div');
    loading.className = 'video-create__loading';
    const spinner = document.createElement('div');
    spinner.className = 'studio__spinner';
    const label = document.createElement('span');
    label.textContent = localeText('studio.generatingPixverse');
    loading.append(spinner, label);
    replacePreview(loading);
}

function captureVideoPosterBase64(video) {
    if (!video || !video.videoWidth || !video.videoHeight) return '';
    try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return '';
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/webp', 0.82);
    } catch (error) {
        console.warn('Video poster capture failed:', error);
        return '';
    }
}

function attachVideoPosterAfterFrame(data, video) {
    const assetId = data?.asset?.id;
    if (!assetId || data?.posterUrl || data?.asset?.poster_url || !video) return;

    let attempted = false;
    const attemptAttach = async () => {
        if (attempted) return;
        const posterBase64 = captureVideoPosterBase64(video);
        if (!posterBase64) return;
        attempted = true;
        const res = await apiAiAttachVideoPoster(assetId, posterBase64);
        if (!res.ok) {
            console.warn('Video poster attach failed:', res.error || res.code || 'unknown error');
            return;
        }
        const posterUrl = res.data?.data?.poster_url || res.data?.poster_url || '';
        if (posterUrl) {
            video.poster = posterUrl;
            if (data.asset) data.asset.poster_url = posterUrl;
            data.posterUrl = posterUrl;
        }
    };

    const onFrameReady = () => {
        attemptAttach();
    };
    video.addEventListener('loadeddata', onFrameReady, { once: true });
    video.addEventListener('canplay', onFrameReady, { once: true });
    if (video.readyState >= 2) {
        window.setTimeout(onFrameReady, 0);
    }
}

function normalizeMimeType(value) {
    const text = String(value || '').trim().toLowerCase();
    return text || '';
}

function mimeTypeBase(mimeType) {
    return normalizeMimeType(mimeType).split(';')[0].trim();
}

function resultMimeType(data) {
    return normalizeMimeType(data?.mimeType || data?.asset?.mime_type || data?.asset?.mimeType || '');
}

function canPreviewMimeType(video, mimeType) {
    if (!mimeType || typeof video?.canPlayType !== 'function') return 'unknown';
    return video.canPlayType(mimeType) ? 'supported' : 'unsupported';
}

function isRiskyMobileVideoMime(mimeType) {
    return MOBILE_RISKY_VIDEO_MIME_TYPES.has(mimeTypeBase(mimeType));
}

function createPlaybackFallback(videoUrl) {
    const fallback = document.createElement('div');
    fallback.className = 'video-create__playback-fallback';
    fallback.hidden = true;
    fallback.setAttribute('role', 'status');
    fallback.setAttribute('aria-live', 'polite');

    const copy = document.createElement('p');
    copy.textContent = localeText('studio.videoMobilePreviewUnsupported');
    fallback.append(copy);

    const actions = document.createElement('div');
    actions.className = 'video-create__fallback-actions';
    if (videoUrl) {
        const openVideo = document.createElement('a');
        openVideo.className = 'studio__save-link video-create__direct-link';
        openVideo.href = videoUrl;
        openVideo.target = '_blank';
        openVideo.rel = 'noopener';
        openVideo.textContent = localeText('studio.openVideoFile');
        actions.append(openVideo);
    }
    fallback.append(actions);

    return fallback;
}

function watchMobilePlayback(video, fallback, mimeType) {
    if (!video || !fallback || !isMobilePreviewFlow()) return;

    let playable = video.readyState >= HTMLMediaElement.HAVE_METADATA;
    let timerId = 0;

    const showFallback = () => {
        if (playable) return;
        fallback.hidden = false;
    };
    const markPlayable = () => {
        playable = true;
        fallback.hidden = true;
        if (timerId) window.clearTimeout(timerId);
    };

    const mimeSupport = canPreviewMimeType(video, mimeType);
    if (mimeSupport === 'unsupported' || isRiskyMobileVideoMime(mimeType)) {
        showFallback();
    }

    video.addEventListener('loadedmetadata', markPlayable, { once: true });
    video.addEventListener('canplay', markPlayable, { once: true });
    video.addEventListener('error', showFallback, { once: true });
    video.addEventListener('stalled', showFallback, { once: true });
    video.addEventListener('abort', showFallback, { once: true });
    timerId = window.setTimeout(showFallback, MOBILE_PLAYBACK_TIMEOUT_MS);
}

function selectedDuration() {
    const value = Number($duration?.value || DEFAULT_DURATION);
    if (!Number.isInteger(value)) return DEFAULT_DURATION;
    return Math.min(PIXVERSE_V6_MAX_DURATION, Math.max(PIXVERSE_V6_MIN_DURATION, value));
}

function selectedQuality() {
    return $quality?.value || DEFAULT_QUALITY;
}

function selectedGenerateAudio() {
    return $audio?.checked !== false;
}

function currentPrice() {
    return calculateAiVideoCreditCost(PIXVERSE_V6_MODEL_ID, {
        duration: selectedDuration(),
        quality: selectedQuality(),
        generateAudio: selectedGenerateAudio(),
    })?.credits || 1;
}

function renderGenerateLabel() {
    if (!$generateBtn) return;
    const price = currentPrice();
    $generateBtn.textContent = localeText('studio.generateVideo');
    $generateBtn.setAttribute('aria-label', localeText('studio.generatePixverseAria', { cost: price }));
    if ($creditEstimate) {
        $creditEstimate.textContent = localeText('credits.credits', { count: price });
    }
}

function renderQuota() {
    if (!$quotaEl) return;
    const hasBalance = typeof creditBalance === 'number';
    const insufficient = hasBalance && creditBalance < currentPrice();
    if (!hasBalance) {
        $quotaEl.textContent = localeText('studio.balanceUnavailable');
    } else if (insufficient) {
        $quotaEl.textContent = localeText('studio.creditsAvailableNotEnough', { count: creditBalance });
    } else {
        $quotaEl.textContent = localeText('studio.creditsAvailable', { count: creditBalance });
    }
    $quotaEl.classList.toggle('video-create__balance--empty', insufficient);
    $actionCard?.classList.toggle('is-insufficient', insufficient);
}

async function loadQuota() {
    const q = await apiAiGetQuota();
    if (!q || q.isAdmin) {
        if ($quotaEl) $quotaEl.textContent = localeText('studio.adminPreview');
        creditBalance = null;
        return;
    }
    creditBalance = typeof q.creditBalance === 'number' ? q.creditBalance : null;
    renderQuota();
}

function createIdempotencyKey() {
    if (globalThis.crypto?.randomUUID) {
        return `video-pixverse-${globalThis.crypto.randomUUID()}`;
    }
    return `video-pixverse-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function updatePricingState() {
    renderGenerateLabel();
    renderQuota();
}

function renderReferencePreview(fileName) {
    if (!$imagePreview) return;
    if ($referenceThumb) {
        $referenceThumb.replaceChildren();
        $referenceThumb.hidden = true;
    }
    if (!referenceImageDataUri) {
        $imagePreview.textContent = localeText('studio.optionalVideoReference');
        $imagePreview.classList.remove('video-create__reference-preview--ready');
        $uploadShell?.classList.remove('is-ready');
        if ($referenceRemove) $referenceRemove.hidden = true;
        return;
    }
    if ($referenceThumb) {
        const image = document.createElement('img');
        image.src = referenceImageDataUri;
        image.alt = '';
        image.decoding = 'async';
        image.setAttribute('aria-hidden', 'true');
        $referenceThumb.appendChild(image);
        $referenceThumb.hidden = false;
    }
    $imagePreview.textContent = fileName ? fileName : localeText('studio.referenceImageReady');
    $imagePreview.classList.add('video-create__reference-preview--ready');
    $uploadShell?.classList.add('is-ready');
    if ($referenceRemove) $referenceRemove.hidden = false;
}

function clearReferenceImage() {
    referenceImageDataUri = '';
    if ($imageInput) $imageInput.value = '';
    renderReferencePreview('');
    hideMsg($msg);
}

function readFileAsDataUri(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener('load', () => resolve(String(reader.result || '')));
        reader.addEventListener('error', () => reject(reader.error || new Error('Could not read image.')));
        reader.readAsDataURL(file);
    });
}

async function handleReferenceImageChange() {
    hideMsg($msg);
    referenceImageDataUri = '';
    const file = $imageInput?.files?.[0] || null;
    if (!file) {
        renderReferencePreview('');
        return;
    }
    if (!file.type?.startsWith('image/')) {
        $imageInput.value = '';
        renderReferencePreview('');
        showMsg($msg, localeText('studio.referenceImageMustImage'), 'error');
        return;
    }
    if (file.size > MAX_REFERENCE_IMAGE_BYTES) {
        $imageInput.value = '';
        renderReferencePreview('');
        showMsg($msg, localeText('studio.referenceImageTooLarge'), 'error');
        return;
    }
    try {
        referenceImageDataUri = await readFileAsDataUri(file);
        renderReferencePreview(file.name || '');
    } catch {
        $imageInput.value = '';
        renderReferencePreview('');
        showMsg($msg, localeText('studio.referenceImageReadFailed'), 'error');
    }
}

function renderResult(data) {
    const videoUrl = data?.videoUrl || data?.asset?.file_url || '';
    if (!videoUrl) {
        renderPreviewEmpty(localeText('studio.noPlayableVideo'));
        return;
    }
    const mimeType = resultMimeType(data);
    const title = data?.asset?.title || localeText('studio.generatedVideo');
    const result = document.createElement('div');
    result.className = 'video-create__result';

    const video = document.createElement('video');
    video.className = 'video-create__player';
    video.controls = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    if (mimeType) {
        video.dataset.mimeType = mimeType;
    }
    const posterUrl = data?.posterUrl || data?.asset?.poster_url || '';
    video.preload = posterUrl ? 'metadata' : 'auto';
    video.src = videoUrl;
    if (posterUrl) {
        video.poster = posterUrl;
    }
    result.append(video);
    const fallback = createPlaybackFallback(videoUrl);
    result.append(fallback);
    watchMobilePlayback(video, fallback, mimeType);
    attachVideoPosterAfterFrame(data, video);

    const meta = document.createElement('div');
    meta.className = 'video-create__result-meta';
    const strong = document.createElement('strong');
    strong.textContent = title;
    const model = document.createElement('span');
    model.textContent = data?.model?.label || 'PixVerse V6';
    meta.append(strong, model);
    result.append(meta);

    if (data?.asset?.id) {
        const link = document.createElement('a');
        link.className = 'studio__save-link';
        link.href = localizedHref('/account/assets-manager.html');
        link.textContent = localeText('studio.openAssetsManager');
        result.append(link);
    }

    replacePreview(result);
}

async function handleGenerate() {
    const { loggedIn } = getAuthState();
    if (!loggedIn) {
        openAuthModal('register');
        return;
    }

    const prompt = ($prompt.value || '').trim();
    if (!prompt) {
        showMsg($msg, localeText('studio.promptRequired'), 'error');
        return;
    }

    hideMsg($msg);
    updatePricingState();
    $generateBtn.disabled = true;
    $generateBtn.textContent = localeText('studio.generatingVideo');
    renderPreviewLoading();
    scrollPreviewIntoViewOnMobile();

    const payload = {
        prompt,
        duration: selectedDuration(),
        aspect_ratio: $aspectRatio?.value || '16:9',
        quality: selectedQuality(),
        generate_audio: selectedGenerateAudio(),
    };
    const negative = ($negative?.value || '').trim();
    if (negative) payload.negative_prompt = negative;
    const seedValue = ($seed?.value || '').trim();
    if (seedValue) payload.seed = Number(seedValue);
    if (referenceImageDataUri) payload.image_input = referenceImageDataUri;

    let res;
    try {
        res = await apiAiGenerateVideo(payload, {
            headers: { 'Idempotency-Key': createIdempotencyKey() },
        });
    } catch (error) {
        console.warn('Video generation failed:', error);
        renderPreviewEmpty(localeText('studio.videoGenerationFailed'));
        scrollPreviewIntoViewOnMobile({ focus: true });
        showMsg($msg, localeText('studio.generationFailed'), 'error');
        return;
    } finally {
        $generateBtn.disabled = false;
        renderGenerateLabel();
    }

    if (!res.ok) {
        renderPreviewEmpty(localeText('studio.videoGenerationFailed'));
        scrollPreviewIntoViewOnMobile({ focus: true });
        showMsg($msg, res.error || localeText('studio.generationFailed'), 'error');
        if (res.code === 'insufficient_member_credits' && creditBalance !== null) {
            renderQuota();
        }
        return;
    }

    const data = res.data?.data || res.data || {};
    renderResult(data);
    scrollPreviewIntoViewOnMobile({ focus: true });
    showMsg($msg, localeText('studio.videoGeneratedSaved'), 'success');

    const balanceAfter = res.data?.billing?.balance_after;
    if (typeof balanceAfter === 'number') {
        creditBalance = balanceAfter;
        renderQuota();
    }
}

export function initVideoCreate() {
    if (initialized) return;
    initialized = true;

    $prompt = document.getElementById('videoPrompt');
    $negative = document.getElementById('videoNegativePrompt');
    $imageInput = document.getElementById('videoReferenceImage');
    $imagePreview = document.getElementById('videoReferencePreview');
    $duration = document.getElementById('videoDuration');
    $aspectRatio = document.getElementById('videoAspectRatio');
    $quality = document.getElementById('videoQuality');
    $audio = document.getElementById('videoGenerateAudio');
    $seed = document.getElementById('videoSeed');
    $generateBtn = document.getElementById('videoGenerate');
    $preview = document.getElementById('videoPreview');
    $msg = document.getElementById('videoMsg');
    $quotaEl = document.getElementById('videoCreditBalance');
    $creditEstimate = document.getElementById('videoCreditEstimate');
    $referenceRemove = document.getElementById('videoReferenceRemove');
    $referenceThumb = document.getElementById('videoReferenceThumb');
    $uploadShell = document.querySelector('#videoCreate .video-create__upload-shell');
    $actionCard = document.querySelector('#videoCreate .video-create__action-card');

    if (!$prompt || !$generateBtn) return;
    $preview?.setAttribute('tabindex', '-1');

    loadQuota();

    renderReferencePreview('');
    renderGenerateLabel();
    renderQuota();

    $generateBtn.addEventListener('click', handleGenerate);
    $duration?.addEventListener('change', updatePricingState);
    $quality?.addEventListener('change', updatePricingState);
    $audio?.addEventListener('change', updatePricingState);
    $imageInput?.addEventListener('change', handleReferenceImageChange);
    $referenceRemove?.addEventListener('click', clearReferenceImage);
    $prompt.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            handleGenerate();
        }
    });
}
