/* ============================================================
   BITBI — Sound Lab Create: inline MiniMax Music generation
   ============================================================ */

import {
    apiAiGenerateMusic,
    apiAiGetAssets,
    apiAiGetQuota,
} from '../../shared/auth-api.js?v=__ASSET_VERSION__';
import { getAuthState } from '../../shared/auth-state.js';
import { openAuthModal } from '../../shared/auth-modal.js';

const BASE_PRICE = 150;
const SEPARATE_LYRICS_PRICE = 160;
const COVER_POLL_INTERVAL_MS = 2000;
const COVER_POLL_TIMEOUT_MS = 30000;

let initialized = false;
let creditBalance = null;
let $prompt, $lyrics, $instrumental, $generateLyrics, $generateBtn, $preview, $msg, $quotaEl, $costLabel;
let coverPollToken = 0;

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
    coverPollToken += 1;
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
    label.textContent = 'Creating your track...';
    loading.append(spinner, label);
    replacePreview(loading);
}

function applyCoverImage(cover, coverUrl) {
    if (!cover) return;
    const currentImg = cover.querySelector('img');
    if (!coverUrl) {
        currentImg?.remove();
        cover.classList.add('sound-create__cover--fallback');
        cover.dataset.coverState = 'fallback';
        return;
    }

    cover.classList.remove('sound-create__cover--fallback');
    cover.dataset.coverState = 'ready';

    const img = currentImg || document.createElement('img');
    img.src = coverUrl;
    img.alt = '';
    img.loading = 'lazy';
    if (!currentImg) {
        const playButton = cover.querySelector('.sound-create__cover-play');
        cover.insertBefore(img, playButton || null);
    }
}

function updateRenderedAssetCover(asset) {
    if (!$preview || !asset?.id || !asset.poster_url) return false;
    const result = Array.from($preview.querySelectorAll('.sound-create__result'))
        .find((node) => node.dataset.assetId === String(asset.id));
    if (!result) return false;
    applyCoverImage(result.querySelector('.sound-create__cover'), asset.poster_url);
    return true;
}

function startCoverPolling(asset) {
    const assetId = asset?.id ? String(asset.id) : '';
    if (!assetId || asset?.poster_url) return;

    const token = ++coverPollToken;
    const startedAt = Date.now();
    const folderId = asset.folder_id || null;
    const onlyUnfoldered = !folderId;

    const poll = async () => {
        if (token !== coverPollToken) return;
        try {
            const page = await apiAiGetAssets(folderId, {
                onlyUnfoldered,
                limit: 20,
            });
            const updated = (page.assets || []).find((entry) => String(entry?.id || '') === assetId);
            if (updated?.poster_url) {
                updateRenderedAssetCover(updated);
                return;
            }
        } catch (error) {
            console.warn('Sound Lab cover refresh failed:', error);
        }

        if (token !== coverPollToken) return;
        if (Date.now() - startedAt >= COVER_POLL_TIMEOUT_MS) return;
        setTimeout(poll, COVER_POLL_INTERVAL_MS);
    };

    setTimeout(poll, COVER_POLL_INTERVAL_MS);
}

function currentPrice() {
    return ($generateLyrics?.checked && !$generateLyrics.disabled) ? SEPARATE_LYRICS_PRICE : BASE_PRICE;
}

function renderGenerateLabel() {
    if (!$generateBtn) return;
    const price = currentPrice();
    $generateBtn.textContent = `Generate Music — ${price} Credits`;
    if ($costLabel) {
        $costLabel.textContent = `${price} credits`;
    }
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
        return `soundlab-music-${globalThis.crypto.randomUUID()}`;
    }
    return `soundlab-music-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function syncOptionState() {
    const instrumental = $instrumental?.checked === true;
    const hasManualLyrics = ($lyrics?.value || '').trim().length > 0;
    if ($lyrics) {
        $lyrics.disabled = instrumental || ($generateLyrics?.checked === true);
        $lyrics.closest('.studio__field')?.classList.toggle('is-disabled', $lyrics.disabled);
    }
    if ($generateLyrics) {
        $generateLyrics.disabled = instrumental || hasManualLyrics;
        if ($generateLyrics.disabled) $generateLyrics.checked = false;
        $generateLyrics.closest('.sound-create__toggle')?.classList.toggle('is-disabled', $generateLyrics.disabled);
    }
    renderGenerateLabel();
    renderQuota();
}

function renderResult(data) {
    const audioUrl = data?.audioUrl || data?.asset?.file_url || '';
    if (!audioUrl) {
        renderPreviewEmpty('No playable audio returned');
        return;
    }
    const title = data?.asset?.title || 'Generated music';
    const lyrics = data?.lyricsPreview || data?.generatedLyrics || '';
    const coverUrl = data?.asset?.poster_url || data?.coverUrl || '';

    const result = document.createElement('div');
    result.className = 'sound-create__result';
    if (data?.asset?.id) {
        result.dataset.assetId = String(data.asset.id);
    }

    const cover = document.createElement('div');
    cover.className = 'sound-create__cover';
    applyCoverImage(cover, coverUrl);

    const audio = document.createElement('audio');
    audio.controls = true;
    audio.preload = 'metadata';
    audio.src = audioUrl;

    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'sound-create__cover-play';
    play.setAttribute('aria-label', `Play ${title}`);
    play.textContent = '▶';
    play.addEventListener('click', async () => {
        try {
            if (audio.paused) {
                await audio.play();
                play.textContent = '||';
                play.setAttribute('aria-label', `Pause ${title}`);
            } else {
                audio.pause();
                play.textContent = '▶';
                play.setAttribute('aria-label', `Play ${title}`);
            }
        } catch (error) {
            console.warn('Sound Lab playback failed:', error);
        }
    });
    audio.addEventListener('pause', () => {
        play.textContent = '▶';
        play.setAttribute('aria-label', `Play ${title}`);
    });
    audio.addEventListener('ended', () => {
        play.textContent = '▶';
        play.setAttribute('aria-label', `Play ${title}`);
    });
    audio.addEventListener('play', () => {
        play.textContent = '||';
        play.setAttribute('aria-label', `Pause ${title}`);
    });

    cover.append(play);
    result.append(cover);
    result.append(audio);

    const meta = document.createElement('div');
    meta.className = 'sound-create__result-meta';
    const strong = document.createElement('strong');
    strong.textContent = title;
    const model = document.createElement('span');
    model.textContent = data?.model?.label || 'MiniMax Music 2.6';
    meta.append(strong, model);
    result.append(meta);

    if (lyrics) {
        const lyricsEl = document.createElement('pre');
        lyricsEl.className = 'sound-create__lyrics-output';
        lyricsEl.textContent = lyrics;
        result.append(lyricsEl);
    }

    if (data?.asset?.id) {
        const link = document.createElement('a');
        link.className = 'studio__save-link';
        link.href = '/account/image-studio.html';
        link.textContent = 'Open in Studio';
        result.append(link);
    }

    replacePreview(result);
    startCoverPolling(data?.asset);
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
    syncOptionState();
    $generateBtn.disabled = true;
    $generateBtn.textContent = 'Generating Music...';
    renderPreviewLoading();

    const payload = {
        prompt,
        instrumental: $instrumental.checked === true,
        generateLyrics: $generateLyrics.checked === true && !$generateLyrics.disabled,
    };
    const manualLyrics = ($lyrics.value || '').trim();
    if (manualLyrics && !payload.instrumental && !payload.generateLyrics) {
        payload.lyrics = manualLyrics;
    }

    let res;
    try {
        res = await apiAiGenerateMusic(payload, {
            headers: { 'Idempotency-Key': createIdempotencyKey() },
        });
    } catch (error) {
        console.warn('Sound Lab music generation failed:', error);
        renderPreviewEmpty('Music generation failed');
        showMsg($msg, 'Generation failed. Please try again.', 'error');
        return;
    } finally {
        $generateBtn.disabled = false;
        renderGenerateLabel();
    }

    if (!res.ok) {
        renderPreviewEmpty('Music generation failed');
        showMsg($msg, res.error || 'Generation failed. Please try again.', 'error');
        if (res.code === 'insufficient_member_credits' && creditBalance !== null) {
            renderQuota();
        }
        return;
    }

    const data = res.data?.data || res.data || {};
    renderResult(data);
    showMsg($msg, 'Music generated and saved.', 'success');

    const balanceAfter = res.data?.billing?.balance_after;
    if (typeof balanceAfter === 'number') {
        creditBalance = balanceAfter;
        renderQuota();
    }
}

export function initSoundLabCreate() {
    if (initialized) return;
    initialized = true;

    $prompt = document.getElementById('soundMusicPrompt');
    $lyrics = document.getElementById('soundMusicLyrics');
    $instrumental = document.getElementById('soundMusicInstrumental');
    $generateLyrics = document.getElementById('soundMusicGenerateLyrics');
    $generateBtn = document.getElementById('soundMusicGenerate');
    $preview = document.getElementById('soundMusicPreview');
    $msg = document.getElementById('soundMusicMsg');
    $costLabel = document.getElementById('soundMusicCreditEstimate');

    if (!$prompt || !$generateBtn) return;

    const $actions = document.querySelector('#soundLabCreate .studio__actions');
    if ($actions) {
        injectQuotaEl($actions);
        loadQuota();
    }

    renderGenerateLabel();
    syncOptionState();

    $generateBtn.addEventListener('click', handleGenerate);
    $instrumental?.addEventListener('change', syncOptionState);
    $generateLyrics?.addEventListener('change', syncOptionState);
    $lyrics?.addEventListener('input', syncOptionState);
    $prompt.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            handleGenerate();
        }
    });
}
