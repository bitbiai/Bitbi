/* ============================================================
   BITBI — Video Create: member PixVerse V6 generation
   ============================================================ */

import {
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

function showMsg(el, text, type) {
    el.textContent = text;
    el.className = `studio__msg studio__msg--${type}`;
}

function hideMsg(el) {
    el.className = 'studio__msg';
    el.textContent = '';
}

function replacePreview(...nodes) {
    if (!$preview) return;
    $preview.replaceChildren(...nodes);
}

function renderPreviewEmpty(text) {
    const empty = document.createElement('div');
    empty.className = 'studio__preview-empty';
    empty.textContent = text;
    replacePreview(empty);
}

function renderPreviewLoading() {
    const loading = document.createElement('div');
    loading.className = 'studio__loading';
    const spinner = document.createElement('div');
    spinner.className = 'studio__spinner';
    const label = document.createElement('span');
    label.textContent = 'Generating your PixVerse video...';
    loading.append(spinner, label);
    replacePreview(loading);
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
    $generateBtn.textContent = `Generate Video · ${price} credits`;
    $generateBtn.setAttribute('aria-label', `Generate PixVerse V6 video for ${price} credits`);
}

function renderQuota() {
    if (!$quotaEl || creditBalance === null) return;
    $quotaEl.textContent = `${creditBalance} credits available`;
    $quotaEl.classList.toggle('studio__quota--empty', creditBalance < currentPrice());
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
        return;
    }
    $imagePreview.textContent = fileName ? `Reference: ${fileName}` : 'Reference image ready';
    $imagePreview.classList.add('video-create__reference-preview--ready');
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
    video.preload = 'metadata';
    video.src = videoUrl;
    if (data?.posterUrl || data?.asset?.poster_url) {
        video.poster = data.posterUrl || data.asset.poster_url;
    }
    result.append(video);

    const meta = document.createElement('div');
    meta.className = 'sound-create__result-meta';
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

    if (!$prompt || !$generateBtn) return;

    const $actions = document.querySelector('#videoCreate .studio__actions');
    if ($actions) {
        injectQuotaEl($actions);
        loadQuota();
    }

    renderReferencePreview('');
    renderGenerateLabel();
    renderQuota();

    $generateBtn.addEventListener('click', handleGenerate);
    $duration?.addEventListener('change', updatePricingState);
    $quality?.addEventListener('change', updatePricingState);
    $audio?.addEventListener('change', updatePricingState);
    $imageInput?.addEventListener('change', handleReferenceImageChange);
    $prompt.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            handleGenerate();
        }
    });
}
