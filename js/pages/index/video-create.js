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
import {
    calculatePixverseV6MemberCredits,
    PIXVERSE_V6_MAX_DURATION,
    PIXVERSE_V6_MIN_DURATION,
} from '../../shared/pixverse-v6-pricing.mjs?v=__ASSET_VERSION__';

const DEFAULT_DURATION = 5;
const DEFAULT_QUALITY = '720p';
const MAX_REFERENCE_IMAGE_BYTES = 10 * 1024 * 1024;

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
    copy.textContent = 'Adjust the prompt and settings, then generate a new PixVerse clip.';
    empty.append(icon, title, copy);
    replacePreview(empty);
}

function renderPreviewLoading() {
    const loading = document.createElement('div');
    loading.className = 'video-create__loading';
    const spinner = document.createElement('div');
    spinner.className = 'studio__spinner';
    const label = document.createElement('span');
    label.textContent = 'Generating your PixVerse video...';
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
    return calculatePixverseV6MemberCredits({
        duration: selectedDuration(),
        quality: selectedQuality(),
        generateAudio: selectedGenerateAudio(),
    });
}

function renderGenerateLabel() {
    if (!$generateBtn) return;
    const price = currentPrice();
    $generateBtn.textContent = 'Generate Video';
    $generateBtn.setAttribute('aria-label', `Generate PixVerse V6 video for ${price} credits`);
    if ($creditEstimate) {
        $creditEstimate.textContent = `${price} credits`;
    }
}

function renderQuota() {
    if (!$quotaEl) return;
    const hasBalance = typeof creditBalance === 'number';
    const insufficient = hasBalance && creditBalance < currentPrice();
    if (!hasBalance) {
        $quotaEl.textContent = 'Balance unavailable';
    } else if (insufficient) {
        $quotaEl.textContent = `${creditBalance} credits available - not enough for this setting`;
    } else {
        $quotaEl.textContent = `${creditBalance} credits available`;
    }
    $quotaEl.classList.toggle('video-create__balance--empty', insufficient);
    $actionCard?.classList.toggle('is-insufficient', insufficient);
}

async function loadQuota() {
    const q = await apiAiGetQuota();
    if (!q || q.isAdmin) {
        if ($quotaEl) $quotaEl.textContent = 'Admin preview';
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
    if (!referenceImageDataUri) {
        $imagePreview.textContent = 'Optional image-to-video reference';
        $imagePreview.classList.remove('video-create__reference-preview--ready');
        $uploadShell?.classList.remove('is-ready');
        if ($referenceRemove) $referenceRemove.hidden = true;
        return;
    }
    $imagePreview.textContent = fileName ? fileName : 'Reference image ready';
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
        showMsg($msg, 'Reference image must be an image file.', 'error');
        return;
    }
    if (file.size > MAX_REFERENCE_IMAGE_BYTES) {
        $imageInput.value = '';
        renderReferencePreview('');
        showMsg($msg, 'Reference image must be 10 MB or smaller.', 'error');
        return;
    }
    try {
        referenceImageDataUri = await readFileAsDataUri(file);
        renderReferencePreview(file.name || '');
    } catch {
        $imageInput.value = '';
        renderReferencePreview('');
        showMsg($msg, 'Reference image could not be read.', 'error');
    }
}

function renderResult(data) {
    const videoUrl = data?.videoUrl || data?.asset?.file_url || '';
    if (!videoUrl) {
        renderPreviewEmpty('No playable video returned');
        return;
    }
    const title = data?.asset?.title || 'Generated video';
    const result = document.createElement('div');
    result.className = 'video-create__result';

    const video = document.createElement('video');
    video.className = 'video-create__player';
    video.controls = true;
    video.playsInline = true;
    const posterUrl = data?.posterUrl || data?.asset?.poster_url || '';
    video.preload = posterUrl ? 'metadata' : 'auto';
    video.src = videoUrl;
    if (posterUrl) {
        video.poster = posterUrl;
    }
    result.append(video);
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
        link.href = '/account/image-studio.html';
        link.textContent = 'Open in Studio';
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
        showMsg($msg, 'Prompt is required.', 'error');
        return;
    }

    hideMsg($msg);
    updatePricingState();
    $generateBtn.disabled = true;
    $generateBtn.textContent = 'Generating Video...';
    renderPreviewLoading();

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
        renderPreviewEmpty('Video generation failed');
        showMsg($msg, 'Generation failed. Please try again.', 'error');
        return;
    } finally {
        $generateBtn.disabled = false;
        renderGenerateLabel();
    }

    if (!res.ok) {
        renderPreviewEmpty('Video generation failed');
        showMsg($msg, res.error || 'Generation failed. Please try again.', 'error');
        if (res.code === 'insufficient_member_credits' && creditBalance !== null) {
            renderQuota();
        }
        return;
    }

    const data = res.data?.data || res.data || {};
    renderResult(data);
    showMsg($msg, 'Video generated and saved.', 'success');

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
    $uploadShell = document.querySelector('#videoCreate .video-create__upload-shell');
    $actionCard = document.querySelector('#videoCreate .video-create__action-card');

    if (!$prompt || !$generateBtn) return;

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
