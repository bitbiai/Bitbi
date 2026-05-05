/* ============================================================
   BITBI — Generate Lab page
   Standalone member workspace for existing image, video, and
   music generation flows. Backend validation and billing remain
   authoritative.
   ============================================================ */

import { initSiteHeader } from '../../shared/site-header.js?v=__ASSET_VERSION__';
import { initParticles } from '../../shared/particles.js';
import { initBinaryRain } from '../../shared/binary-rain.js';
import { initBinaryFooter } from '../../shared/binary-footer.js';
import { initScrollReveal } from '../../shared/scroll-reveal.js';
import { initCookieConsent } from '../../shared/cookie-consent.js';
import { activateGenerateLabContext } from '../../shared/generate-lab-context.js?v=__ASSET_VERSION__';
import {
    apiAiAttachVideoPoster,
    apiAiGenerateImage,
    apiAiGenerateMusic,
    apiAiGenerateVideo,
    apiAiGetAssets,
    apiAiGetFolders,
    apiAiGetQuota,
    apiAiSaveImage,
    apiGetMe,
} from '../../shared/auth-api.js?v=__ASSET_VERSION__';
import { getAuthState } from '../../shared/auth-state.js';
import { openAuthModal } from '../../shared/auth-modal.js';
import { setupFocusTrap } from '../../shared/focus-trap.js';
import { createSavedAssetsBrowser } from '../../shared/saved-assets-browser.js?v=__ASSET_VERSION__';
import {
    GENERATE_LAB_MEDIA_TYPES,
    calculateGenerateLabCredits,
    getDefaultGenerateLabModel,
    getGenerateLabMediaType,
    getGenerateLabModels,
    getGenerateLabModelsByMediaType,
    getGenerateLabModel,
    MUSIC_26_MODEL_ID,
} from './model-registry.js?v=__ASSET_VERSION__';

const MAX_VIDEO_REFERENCE_BYTES = 10 * 1024 * 1024;
const SAVE_REFERENCE_FALLBACK_CODES = new Set([
    'INVALID_SAVE_REFERENCE',
    'SAVE_REFERENCE_EXPIRED',
    'SAVE_REFERENCE_UNAVAILABLE',
]);
const COVER_POLL_INTERVAL_MS = 2000;
const COVER_POLL_TIMEOUT_MS = 30000;

const refs = {};
let assetsBrowser = null;
let releaseAssetsOverlayFocus = null;
const state = {
    loggedIn: false,
    user: null,
    creditBalance: null,
    folders: [],
    mediaType: 'image',
    modelId: getDefaultGenerateLabModel('image').id,
    busy: false,
    videoReferenceDataUri: '',
    currentImageData: null,
    currentImageMeta: null,
    currentResult: null,
    coverPollToken: 0,
};

const assetsBrowserRefIds = {
    root: 'labAssetsBrowserRoot',
    galleryFilter: 'labAssetsFilter',
    folderGrid: 'labAssetsFolderGrid',
    folderBack: 'labAssetsFolderBack',
    folderBackBtn: 'labAssetsFolderBackBtn',
    assetGrid: 'labAssetsGrid',
    galleryMsg: 'labAssetsMsg',
    newFolderBtn: 'labAssetsNewFolderBtn',
    deleteFolderBtn: 'labAssetsDeleteFolderBtn',
    newFolderForm: 'labAssetsNewFolderForm',
    newFolderInput: 'labAssetsNewFolderInput',
    newFolderSave: 'labAssetsNewFolderSave',
    newFolderCancel: 'labAssetsNewFolderCancel',
    deleteFolderForm: 'labAssetsDeleteFolderForm',
    deleteFolderSelect: 'labAssetsDeleteFolderSelect',
    deleteFolderConfirm: 'labAssetsDeleteFolderConfirm',
    deleteFolderCancel: 'labAssetsDeleteFolderCancel',
    selectBtn: 'labAssetsSelectBtn',
    mobileActionsToggle: 'labAssetsMobileActionsToggle',
    mobileActionsMenu: 'labAssetsMobileActionsMenu',
    bulkBar: 'labAssetsBulkBar',
    bulkCount: 'labAssetsBulkCount',
    bulkRename: 'labAssetsBulkRename',
    bulkMove: 'labAssetsBulkMove',
    bulkDelete: 'labAssetsBulkDelete',
    bulkCancel: 'labAssetsBulkCancel',
    renameForm: 'labAssetsRenameForm',
    renameInput: 'labAssetsRenameInput',
    renameConfirm: 'labAssetsRenameConfirm',
    renameCancel: 'labAssetsRenameCancel',
    bulkMoveForm: 'labAssetsBulkMoveForm',
    bulkMoveSelect: 'labAssetsBulkMoveSelect',
    bulkMoveConfirm: 'labAssetsBulkMoveConfirm',
    bulkMoveCancel: 'labAssetsBulkMoveCancel',
};

function byId(id) {
    return document.getElementById(id);
}

function el(tag, { className, text, attrs } = {}, ...children) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    if (attrs) {
        for (const [name, value] of Object.entries(attrs)) {
            if (value === false || value === null || value === undefined) continue;
            if (value === true) {
                node.setAttribute(name, '');
            } else {
                node.setAttribute(name, String(value));
            }
        }
    }
    node.append(...children.filter(Boolean));
    return node;
}

function installHeaderStatusPanel() {
    const navLinks = document.querySelector('.site-nav__links');
    if (!navLinks) return;

    let panel = document.getElementById('generateLabHeaderStatus');
    if (!panel) {
        panel = el('div', {
            className: 'generate-lab-header-status',
            attrs: { id: 'generateLabHeaderStatus', 'aria-live': 'polite' },
        });
        panel.append(
            el('span', {
                className: 'generate-lab__account-status',
                text: 'Checking session...',
                attrs: { id: 'labAccountStatus' },
            }),
            el('strong', {
                className: 'generate-lab__credit-status',
                text: 'Credits unavailable',
                attrs: { id: 'labCreditStatus' },
            }),
            el('button', {
                className: 'generate-lab__assets-link',
                text: 'Assets Manager',
                attrs: { id: 'labAssetsOpen', type: 'button' },
            }),
        );
    }

    navLinks.replaceChildren(panel);
    navLinks.classList.add('site-nav__links--empty', 'site-nav__links--generate-lab');
    refs.accountStatus = byId('labAccountStatus');
    refs.creditStatus = byId('labCreditStatus');
    refs.assetsOpen = byId('labAssetsOpen');
    if (refs.assetsOpen) refs.assetsOpen.onclick = openAssetsOverlay;
    updateAccountPanel();
}

function formatCredits(credits) {
    const safe = Number.isFinite(Number(credits)) ? Number(credits) : 0;
    return `${safe} credit${safe === 1 ? '' : 's'}`;
}

function createIdempotencyKey(prefix) {
    if (globalThis.crypto?.randomUUID) {
        return `${prefix}-${globalThis.crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function parseOptionalInteger(value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const number = Number(raw);
    if (!Number.isInteger(number) || number < min || number > max) return null;
    return number;
}

function selectedModel() {
    return getGenerateLabModel(state.modelId);
}

function selectedMediaType() {
    return getGenerateLabMediaType(state.mediaType);
}

function currentCreditEstimate() {
    const model = selectedModel();
    if (model.mediaType === 'video') {
        return calculateGenerateLabCredits(model.id, {
            duration: Number(refs.videoDuration?.value || model.defaults.duration),
            quality: refs.videoQuality?.value || model.defaults.quality,
            generateAudio: refs.videoAudio?.checked !== false,
        });
    }
    if (model.mediaType === 'music') {
        return calculateGenerateLabCredits(model.id, {
            generateLyrics: refs.musicGenerateLyrics?.checked === true && !refs.musicGenerateLyrics.disabled,
        });
    }
    return calculateGenerateLabCredits(model.id, {});
}

function setMessage(text = '', type = 'info') {
    if (!refs.message) return;
    refs.message.textContent = text;
    refs.message.className = text ? `generate-lab__message generate-lab__message--${type}` : 'generate-lab__message';
}

function setBusy(nextBusy, label = '') {
    state.busy = nextBusy;
    if (refs.generate) {
        refs.generate.disabled = nextBusy;
        refs.generate.textContent = nextBusy ? label : 'Generate';
    }
    for (const control of document.querySelectorAll('[data-generate-lab-workspace] input, [data-generate-lab-workspace] select, [data-generate-lab-workspace] textarea')) {
        control.disabled = nextBusy;
    }
    syncImageOptionState();
    syncMusicOptionState();
    updateActionState();
}

function requireMember() {
    const authState = getAuthState();
    if (state.loggedIn || authState.loggedIn) return true;
    try {
        openAuthModal('register');
    } catch {
        setMessage('Please sign in to generate media.', 'error');
    }
    return false;
}

function getAssetsBrowserRefs() {
    return Object.fromEntries(
        Object.entries(assetsBrowserRefIds).map(([key, id]) => [key, byId(id)]),
    );
}

function createAssetsBrowser() {
    assetsBrowser = createSavedAssetsBrowser({
        refs: getAssetsBrowserRefs(),
        emptyStateMessage: 'No saved assets yet. Generate images, videos, or music, then manage them here.',
        foldersUnavailableMessage: 'Could not load folders. Showing all saved assets.',
    });
    return assetsBrowser;
}

async function ensureAssetsBrowser() {
    if (!assetsBrowser) createAssetsBrowser();
    await assetsBrowser.show();
}

function closeAssetsOverlay() {
    if (!refs.assetsOverlay || refs.assetsOverlay.hidden) return;
    refs.assetsOverlay.hidden = true;
    refs.assetsOverlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('generate-lab-assets-open');
    if (releaseAssetsOverlayFocus) {
        releaseAssetsOverlayFocus();
        releaseAssetsOverlayFocus = null;
    }
}

async function openAssetsOverlay() {
    if (!requireMember()) return;
    if (!refs.assetsOverlay) return;
    refs.assetsOverlay.hidden = false;
    refs.assetsOverlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('generate-lab-assets-open');
    releaseAssetsOverlayFocus = setupFocusTrap(refs.assetsOverlayShell || refs.assetsOverlay);
    refs.assetsOverlayClose?.focus();
    try {
        await ensureAssetsBrowser();
    } catch (error) {
        console.warn('Generate Lab assets overlay load failed:', error);
        const msg = byId('labAssetsMsg');
        if (msg) {
            msg.textContent = 'Assets could not be loaded. Please try again.';
            msg.classList.add('studio__msg--error');
        }
    }
}

function updateAccountPanel() {
    if (refs.accountStatus) {
        if (state.loggedIn) {
            const email = state.user?.email || 'Member';
            refs.accountStatus.textContent = `Signed in as ${email}`;
        } else {
            refs.accountStatus.textContent = 'Sign in required';
        }
    }
    if (refs.creditStatus) {
        if (state.creditBalance === null) {
            refs.creditStatus.textContent = state.loggedIn ? 'Credits unavailable' : 'Credits after sign-in';
        } else {
            refs.creditStatus.textContent = `${state.creditBalance} credits`;
        }
    }
}

function updateActionState() {
    const price = currentCreditEstimate();
    const insufficient = state.creditBalance !== null && state.creditBalance < price;

    if (refs.cost) refs.cost.textContent = formatCredits(price);
    if (refs.balance) {
        if (!state.loggedIn) {
            refs.balance.textContent = 'Sign in to check credits and generate.';
            refs.balance.classList.remove('is-low');
        } else if (state.creditBalance === null) {
            refs.balance.textContent = 'Credit balance unavailable.';
            refs.balance.classList.remove('is-low');
        } else {
            refs.balance.textContent = `${state.creditBalance} credits available`;
            refs.balance.classList.toggle('is-low', insufficient);
        }
    }
    if (refs.generate && !state.busy) {
        refs.generate.textContent = state.loggedIn ? (insufficient ? 'Insufficient Credits' : 'Generate') : 'Sign in to Generate';
        refs.generate.disabled = state.loggedIn && insufficient;
        refs.generate.setAttribute('aria-label', `${refs.generate.textContent}, estimated cost ${formatCredits(price)}`);
    }
}

function renderFolderOptions() {
    if (!refs.folderSelect) return;
    const current = refs.folderSelect.value;
    const options = [
        el('option', { text: 'Assets', attrs: { value: '' } }),
        ...state.folders.map((folder) => el('option', { text: folder.name || 'Untitled folder', attrs: { value: folder.id } })),
    ];
    refs.folderSelect.replaceChildren(...options);
    if (current) refs.folderSelect.value = current;
}

function renderImageModelOptions() {
    if (!refs.imageModel) return;
    const models = getGenerateLabModelsByMediaType('image');
    refs.imageModel.replaceChildren(
        ...models.map((model) => el('option', { text: model.displayName, attrs: { value: model.id } })),
    );
    refs.imageModel.value = state.modelId;
}

function renderModelList() {
    if (!refs.modelList) return;
    const models = getGenerateLabModelsByMediaType(state.mediaType);
    const cards = models.map((model) => {
        const isSelected = model.id === state.modelId;
        const button = el('button', {
            className: `generate-lab__model-card${isSelected ? ' is-selected' : ''}`,
            attrs: {
                type: 'button',
                'data-model-id': model.id,
                'aria-pressed': isSelected ? 'true' : 'false',
            },
        });
        const top = el('span', { className: 'generate-lab__model-card-top' },
            el('strong', { text: model.displayName }),
            el('span', { className: 'generate-lab__model-status', text: model.status }),
        );
        const summary = el('span', { className: 'generate-lab__model-summary', text: model.summary });
        const meta = el('span', { className: 'generate-lab__model-route', text: model.provider });
        button.append(top, summary, meta);
        button.addEventListener('click', () => {
            state.modelId = model.id;
            if (state.mediaType === 'image' && refs.imageModel) refs.imageModel.value = model.id;
            renderAllForSelection();
        });
        return button;
    });
    refs.modelList.replaceChildren(...cards);
}

function renderModelDetails() {
    const model = selectedModel();
    if (!refs.modelDetails) return;
    const title = el('strong', { text: model.displayName });
    const copy = el('p', { text: model.summary });
    const list = el('ul', { className: 'generate-lab__capability-list' },
        ...model.capabilities.map((capability) => el('li', { text: capability })),
    );
    refs.modelDetails.replaceChildren(title, copy, list);
    if (refs.modelBadge) refs.modelBadge.textContent = model.displayName;
}

function renderPromptCopy() {
    const media = selectedMediaType();
    if (refs.promptLabel) refs.promptLabel.textContent = media.promptLabel;
    if (refs.prompt) {
        refs.prompt.placeholder = media.promptPlaceholder;
        refs.prompt.setAttribute('aria-describedby', 'labPromptHelp');
    }
    if (refs.promptHelp) refs.promptHelp.textContent = media.promptHelp;
    if (refs.composerEyebrow) refs.composerEyebrow.textContent = `${media.label} composer`;
    if (refs.composerTitle) refs.composerTitle.textContent = `${media.label} prompt stage`;
}

function renderSettingsGroups() {
    document.querySelectorAll('[data-settings-for]').forEach((group) => {
        group.hidden = group.dataset.settingsFor !== state.mediaType;
    });
}

function syncImageOptionState() {
    const model = selectedModel();
    const supportsSteps = model.mediaType !== 'image' || model.controls?.supportsSteps === true;
    const supportsSeed = model.mediaType !== 'image' || model.controls?.supportsSeed === true;
    const stepsField = refs.imageSteps?.closest('.generate-lab__field');
    const seedField = refs.imageSeed?.closest('.generate-lab__field');

    if (refs.imageSteps) {
        refs.imageSteps.disabled = state.busy || !supportsSteps;
        refs.imageSteps.setAttribute('aria-disabled', refs.imageSteps.disabled ? 'true' : 'false');
    }
    if (refs.imageSeed) {
        refs.imageSeed.disabled = state.busy || !supportsSeed;
        refs.imageSeed.setAttribute('aria-disabled', refs.imageSeed.disabled ? 'true' : 'false');
    }
    stepsField?.classList.toggle('is-disabled', !supportsSteps);
    seedField?.classList.toggle('is-disabled', !supportsSeed);
}

function renderEmptyResult() {
    const media = selectedMediaType();
    const marker = el('span', { className: `generate-lab__empty-mark generate-lab__empty-mark--${media.id}`, attrs: { 'aria-hidden': 'true' } });
    const title = el('strong', { text: media.emptyTitle });
    const copy = el('p', { text: media.emptyCopy });
    refs.resultStage?.replaceChildren(el('div', { className: 'generate-lab__empty-state' }, marker, title, copy));
}

function renderLoadingResult(text) {
    const spinner = el('div', { className: 'generate-lab__spinner', attrs: { 'aria-hidden': 'true' } });
    refs.resultStage?.replaceChildren(el('div', { className: 'generate-lab__loading-state' }, spinner, el('span', { text })));
}

function renderAllForSelection({ keepResult = false } = {}) {
    document.body.dataset.labMode = state.mediaType;
    for (const tab of document.querySelectorAll('.generate-lab__media-tab')) {
        const active = tab.dataset.mediaType === state.mediaType;
        tab.classList.toggle('is-active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
    }
    renderImageModelOptions();
    renderModelList();
    renderModelDetails();
    renderPromptCopy();
    renderSettingsGroups();
    syncImageOptionState();
    syncMusicOptionState();
    updateActionState();
    if (!keepResult) {
        state.currentResult = null;
        state.currentImageData = null;
        state.currentImageMeta = null;
        renderEmptyResult();
        setMessage('');
    }
}

function readFileAsDataUri(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Could not read file.'));
        reader.readAsDataURL(file);
    });
}

function clearVideoReference() {
    state.videoReferenceDataUri = '';
    if (refs.videoReference) refs.videoReference.value = '';
    if (refs.videoReferenceLabel) refs.videoReferenceLabel.textContent = 'Optional image-to-video reference';
    if (refs.videoReferenceRemove) refs.videoReferenceRemove.hidden = true;
    refs.videoReferenceShell?.classList.remove('has-file');
}

async function handleVideoReferenceChange() {
    const file = refs.videoReference?.files?.[0];
    if (!file) {
        clearVideoReference();
        return;
    }
    if (!file.type.startsWith('image/')) {
        clearVideoReference();
        setMessage('Reference image must be an image file.', 'error');
        return;
    }
    if (file.size > MAX_VIDEO_REFERENCE_BYTES) {
        clearVideoReference();
        setMessage('Reference image must be 10 MB or smaller.', 'error');
        return;
    }
    try {
        state.videoReferenceDataUri = await readFileAsDataUri(file);
        if (refs.videoReferenceLabel) refs.videoReferenceLabel.textContent = file.name || 'Reference image selected';
        if (refs.videoReferenceRemove) refs.videoReferenceRemove.hidden = false;
        refs.videoReferenceShell?.classList.add('has-file');
        setMessage('');
    } catch {
        clearVideoReference();
        setMessage('Reference image could not be read.', 'error');
    }
}

function syncMusicOptionState() {
    if (!refs.musicLyrics || !refs.musicInstrumental || !refs.musicGenerateLyrics) return;
    const instrumental = refs.musicInstrumental.checked === true;
    const hasManualLyrics = refs.musicLyrics.value.trim().length > 0;
    refs.musicLyrics.disabled = state.busy || instrumental || refs.musicGenerateLyrics.checked === true;
    refs.musicGenerateLyrics.disabled = state.busy || instrumental || hasManualLyrics;
    if (refs.musicGenerateLyrics.disabled) refs.musicGenerateLyrics.checked = false;
    refs.musicLyrics.closest('.generate-lab__field')?.classList.toggle('is-disabled', refs.musicLyrics.disabled);
    refs.musicGenerateLyrics.closest('.generate-lab__toggle')?.classList.toggle('is-disabled', refs.musicGenerateLyrics.disabled);
    updateActionState();
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
        console.warn('Generate Lab video poster capture failed:', error);
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
            console.warn('Generate Lab video poster attach failed:', res.error || res.code || 'unknown error');
            return;
        }
        const posterUrl = res.data?.data?.poster_url || res.data?.poster_url || '';
        if (posterUrl) {
            video.poster = posterUrl;
            if (data.asset) data.asset.poster_url = posterUrl;
            data.posterUrl = posterUrl;
        }
    };
    const onFrameReady = () => attemptAttach();
    video.addEventListener('loadeddata', onFrameReady, { once: true });
    video.addEventListener('canplay', onFrameReady, { once: true });
    if (video.readyState >= 2) window.setTimeout(onFrameReady, 0);
}

function applyAudioCover(cover, coverUrl) {
    const existing = cover.querySelector('img');
    if (!coverUrl) {
        existing?.remove();
        cover.classList.add('generate-lab__audio-cover--fallback');
        return;
    }
    const img = existing || document.createElement('img');
    img.src = coverUrl;
    img.alt = '';
    img.loading = 'lazy';
    cover.classList.remove('generate-lab__audio-cover--fallback');
    if (!existing) cover.prepend(img);
}

function updateRenderedAudioCover(asset) {
    if (!asset?.id || !asset.poster_url || !refs.resultStage) return false;
    const result = Array.from(refs.resultStage.querySelectorAll('[data-audio-asset-id]'))
        .find((node) => node.dataset.audioAssetId === String(asset.id));
    if (!result) return false;
    applyAudioCover(result.querySelector('.generate-lab__audio-cover'), asset.poster_url);
    return true;
}

function startAudioCoverPolling(asset) {
    const assetId = asset?.id ? String(asset.id) : '';
    if (!assetId || asset?.poster_url) return;
    const token = ++state.coverPollToken;
    const startedAt = Date.now();
    const folderId = asset.folder_id || null;
    const onlyUnfoldered = !folderId;

    const poll = async () => {
        if (token !== state.coverPollToken) return;
        try {
            const page = await apiAiGetAssets(folderId, { onlyUnfoldered, limit: 20 });
            const updated = (page.assets || []).find((entry) => String(entry?.id || '') === assetId);
            if (updated?.poster_url) {
                updateRenderedAudioCover(updated);
                return;
            }
        } catch (error) {
            console.warn('Generate Lab audio cover refresh failed:', error);
        }
        if (token !== state.coverPollToken) return;
        if (Date.now() - startedAt >= COVER_POLL_TIMEOUT_MS) return;
        window.setTimeout(poll, COVER_POLL_INTERVAL_MS);
    };
    window.setTimeout(poll, COVER_POLL_INTERVAL_MS);
}

function renderImageResult({ imageData, prompt, meta }) {
    const img = el('img', {
        className: 'generate-lab__image-output',
        attrs: { src: imageData, alt: prompt },
    });
    const save = el('button', {
        className: 'generate-lab__secondary-btn',
        text: 'Save to Assets Manager',
        attrs: { type: 'button' },
    });
    save.addEventListener('click', handleSaveImage);
    const caption = el('div', { className: 'generate-lab__result-meta' },
        el('strong', { text: meta?.modelLabel || 'Generated image' }),
        el('span', { text: 'Private until you publish from Assets Manager.' }),
    );
    refs.resultStage?.replaceChildren(el('figure', { className: 'generate-lab__result-card generate-lab__result-card--image' }, img, caption, save));
}

function renderVideoResult(data) {
    const videoUrl = data?.videoUrl || data?.asset?.file_url || '';
    if (!videoUrl) {
        renderEmptyResult();
        setMessage('No playable video was returned.', 'error');
        return;
    }
    const title = data?.asset?.title || 'Generated video';
    const video = el('video', {
        className: 'generate-lab__video-output',
        attrs: {
            controls: true,
            playsinline: true,
            preload: data?.posterUrl || data?.asset?.poster_url ? 'metadata' : 'auto',
            src: videoUrl,
        },
    });
    const posterUrl = data?.posterUrl || data?.asset?.poster_url || '';
    if (posterUrl) video.poster = posterUrl;
    attachVideoPosterAfterFrame(data, video);

    const meta = el('div', { className: 'generate-lab__result-meta' },
        el('strong', { text: title }),
        el('span', { text: 'Saved as a private video asset.' }),
    );
    const actions = el('div', { className: 'generate-lab__result-actions' },
        el('button', {
            className: 'generate-lab__secondary-link',
            text: 'Open in Assets Manager',
            attrs: { type: 'button' },
        }),
    );
    actions.querySelector('button')?.addEventListener('click', openAssetsOverlay);
    refs.resultStage?.replaceChildren(el('div', { className: 'generate-lab__result-card generate-lab__result-card--video' }, video, meta, actions));
}

function renderMusicResult(data) {
    const audioUrl = data?.audioUrl || data?.asset?.file_url || '';
    if (!audioUrl) {
        renderEmptyResult();
        setMessage('No playable audio was returned.', 'error');
        return;
    }
    const title = data?.asset?.title || 'Generated music';
    const coverUrl = data?.asset?.poster_url || data?.coverUrl || '';
    const result = el('div', {
        className: 'generate-lab__result-card generate-lab__result-card--audio',
        attrs: data?.asset?.id ? { 'data-audio-asset-id': data.asset.id } : {},
    });
    const cover = el('div', { className: 'generate-lab__audio-cover' });
    applyAudioCover(cover, coverUrl);
    const audio = el('audio', {
        className: 'generate-lab__audio-output',
        attrs: { controls: true, preload: 'metadata', src: audioUrl },
    });
    const meta = el('div', { className: 'generate-lab__result-meta' },
        el('strong', { text: title }),
        el('span', { text: 'Saved as a private music asset.' }),
    );
    const actions = el('div', { className: 'generate-lab__result-actions' },
        el('button', {
            className: 'generate-lab__secondary-link',
            text: 'Open in Assets Manager',
            attrs: { type: 'button' },
        }),
    );
    actions.querySelector('button')?.addEventListener('click', openAssetsOverlay);
    result.append(cover, audio, meta, actions);
    refs.resultStage?.replaceChildren(result);
    startAudioCoverPolling(data?.asset);
}

function getAssetTitle(asset) {
    return String(asset?.title || asset?.filename || asset?.file_name || asset?.prompt || asset?.preview_text || 'Saved asset');
}

function isVideoAsset(asset) {
    const assetType = String(asset?.asset_type || '').toLowerCase();
    const sourceModule = String(asset?.source_module || '').toLowerCase();
    const mime = String(asset?.mime_type || asset?.content_type || '').toLowerCase();
    return assetType === 'video' || sourceModule === 'video' || mime.startsWith('video/');
}

function isAudioAsset(asset) {
    const assetType = String(asset?.asset_type || '').toLowerCase();
    const sourceModule = String(asset?.source_module || '').toLowerCase();
    const mime = String(asset?.mime_type || asset?.content_type || '').toLowerCase();
    return assetType === 'sound' || assetType === 'audio' || sourceModule === 'music' || mime.startsWith('audio/');
}

function isImageAsset(asset) {
    return String(asset?.asset_type || '').toLowerCase() === 'image';
}

function getAssetPreviewUrl(asset) {
    return asset?.medium_url || asset?.thumb_url || asset?.original_url || asset?.file_url || asset?.url || '';
}

function getAssetFileUrl(asset) {
    return asset?.file_url || asset?.original_url || asset?.url || '';
}

function setCrossOriginIfNeeded(media, url) {
    if (String(url || '').startsWith('/api/')) {
        media.crossOrigin = 'use-credentials';
    }
}

function tryPlaySelectedMedia(media) {
    const playPromise = media?.play?.();
    if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
            setMessage('Preview is ready. Press play if your browser blocked autoplay.', 'info');
        });
    }
}

function renderRecentImageAsset(asset) {
    const title = getAssetTitle(asset);
    const imageUrl = getAssetPreviewUrl(asset);
    if (!imageUrl) {
        renderEmptyResult();
        setMessage('This image asset has no preview URL.', 'error');
        return;
    }
    const img = el('img', {
        className: 'generate-lab__image-output',
        attrs: { src: imageUrl, alt: title, loading: 'eager', decoding: 'async' },
    });
    setCrossOriginIfNeeded(img, imageUrl);
    const meta = el('div', { className: 'generate-lab__result-meta' },
        el('strong', { text: title }),
        el('span', { text: 'Recent image asset opened in Generate Lab.' }),
    );
    refs.resultStage?.replaceChildren(el('figure', { className: 'generate-lab__result-card generate-lab__result-card--image generate-lab__result-card--recent' }, img, meta));
    setMessage('Recent image opened in the preview stage.', 'success');
}

function renderRecentVideoAsset(asset) {
    const title = getAssetTitle(asset);
    const videoUrl = getAssetFileUrl(asset);
    if (!videoUrl) {
        renderEmptyResult();
        setMessage('This video asset has no playable URL.', 'error');
        return;
    }
    const video = el('video', {
        className: 'generate-lab__video-output',
        attrs: {
            controls: true,
            playsinline: true,
            preload: 'metadata',
            src: videoUrl,
        },
    });
    setCrossOriginIfNeeded(video, videoUrl);
    const posterUrl = asset?.poster_url || asset?.thumb_url || '';
    if (posterUrl) video.poster = posterUrl;
    const meta = el('div', { className: 'generate-lab__result-meta' },
        el('strong', { text: title }),
        el('span', { text: 'Recent video asset opened in Generate Lab.' }),
    );
    refs.resultStage?.replaceChildren(el('div', { className: 'generate-lab__result-card generate-lab__result-card--video generate-lab__result-card--recent' }, video, meta));
    setMessage('Recent video opened in the preview stage.', 'success');
    tryPlaySelectedMedia(video);
}

function renderRecentAudioAsset(asset) {
    const title = getAssetTitle(asset);
    const audioUrl = getAssetFileUrl(asset);
    if (!audioUrl) {
        renderEmptyResult();
        setMessage('This audio asset has no playable URL.', 'error');
        return;
    }
    const cover = el('div', { className: 'generate-lab__audio-cover' });
    applyAudioCover(cover, asset?.poster_url || asset?.thumb_url || '');
    const audio = el('audio', {
        className: 'generate-lab__audio-output',
        attrs: { controls: true, preload: 'metadata', src: audioUrl },
    });
    setCrossOriginIfNeeded(audio, audioUrl);
    const meta = el('div', { className: 'generate-lab__result-meta' },
        el('strong', { text: title }),
        el('span', { text: 'Recent music asset opened in Generate Lab.' }),
    );
    const result = el('div', { className: 'generate-lab__result-card generate-lab__result-card--audio generate-lab__result-card--recent' }, cover, audio, meta);
    refs.resultStage?.replaceChildren(result);
    setMessage('Recent audio opened in the preview stage.', 'success');
    tryPlaySelectedMedia(audio);
}

function openRecentAsset(asset) {
    if (!asset) return;
    state.currentResult = { type: 'recent_asset', assetId: asset.id || null };
    state.currentImageData = null;
    state.currentImageMeta = null;

    if (isVideoAsset(asset)) {
        renderRecentVideoAsset(asset);
    } else if (isAudioAsset(asset)) {
        renderRecentAudioAsset(asset);
    } else if (isImageAsset(asset)) {
        renderRecentImageAsset(asset);
    } else {
        renderEmptyResult();
        setMessage('This asset type is not previewable in Generate Lab yet.', 'error');
    }

    document.querySelectorAll('.generate-lab__recent-card').forEach((card) => {
        const selected = String(card.dataset.assetId || '') === String(asset.id || '');
        card.classList.toggle('is-selected', selected);
        card.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
}

async function handleSaveImage() {
    if (!state.currentImageMeta || (!state.currentImageData && !state.currentImageMeta.saveReference)) return;
    const folderId = refs.folderSelect?.value || null;
    setMessage('Saving image...', 'info');

    let res;
    try {
        res = await apiAiSaveImage(
            state.currentImageMeta.saveReference
                ? { saveReference: state.currentImageMeta.saveReference }
                : state.currentImageData,
            state.currentImageMeta.prompt,
            state.currentImageMeta.model,
            state.currentImageMeta.steps,
            state.currentImageMeta.seed,
            folderId,
        );
        if (!res.ok && state.currentImageMeta.saveReference && state.currentImageData && SAVE_REFERENCE_FALLBACK_CODES.has(res.code)) {
            res = await apiAiSaveImage(
                state.currentImageData,
                state.currentImageMeta.prompt,
                state.currentImageMeta.model,
                state.currentImageMeta.steps,
                state.currentImageMeta.seed,
                folderId,
            );
        }
    } catch (error) {
        console.warn('Generate Lab image save failed:', error);
        setMessage('Save failed. Please try again.', 'error');
        return;
    }

    if (!res.ok) {
        setMessage(res.error || 'Save failed. Please try again.', 'error');
        return;
    }

    state.currentImageData = null;
    state.currentImageMeta = null;
    setMessage('Image saved. Open Assets Manager to publish, move, or rename it.', 'success');
    await loadRecentAssets();
}

async function generateImage(prompt) {
    const currentModel = selectedModel();
    const model = refs.imageModel?.value || currentModel.id;
    const steps = currentModel.controls?.supportsSteps === true
        ? parseOptionalInteger(refs.imageSteps?.value, { min: 1, max: 20 })
        : null;
    const seed = currentModel.controls?.supportsSeed === true
        ? parseOptionalInteger(refs.imageSeed?.value, { min: 0 })
        : null;
    const res = await apiAiGenerateImage(prompt, steps, seed, model);
    if (!res.ok) return res;
    const data = res.data?.data || res.data || {};
    if (!data.imageBase64) {
        return { ok: false, error: 'No image data returned.' };
    }
    const mimeType = data.mimeType || 'image/png';
    const imageData = `data:${mimeType};base64,${data.imageBase64}`;
    state.currentImageData = imageData;
    state.currentImageMeta = {
        prompt: data.prompt || prompt,
        model: data.model || model,
        modelLabel: selectedModel().displayName,
        steps: data.steps,
        seed: data.seed,
        saveReference: typeof data.saveReference === 'string' ? data.saveReference : null,
    };
    renderImageResult({ imageData, prompt, meta: state.currentImageMeta });
    return res;
}

async function generateVideo(prompt) {
    const payload = {
        prompt,
        duration: Number(refs.videoDuration?.value || 5),
        aspect_ratio: refs.videoAspect?.value || '16:9',
        quality: refs.videoQuality?.value || '720p',
        generate_audio: refs.videoAudio?.checked !== false,
    };
    const negative = refs.videoNegative?.value.trim() || '';
    if (negative) payload.negative_prompt = negative;
    const seed = parseOptionalInteger(refs.videoSeed?.value, { min: 0, max: 2147483647 });
    if (seed !== null) payload.seed = seed;
    if (state.videoReferenceDataUri) payload.image_input = state.videoReferenceDataUri;
    const folderId = refs.folderSelect?.value || '';
    if (folderId) payload.folder_id = folderId;

    const res = await apiAiGenerateVideo(payload, {
        headers: { 'Idempotency-Key': createIdempotencyKey('generate-lab-video') },
    });
    if (res.ok) {
        renderVideoResult(res.data?.data || res.data || {});
    }
    return res;
}

async function generateMusic(prompt) {
    const payload = {
        prompt,
        instrumental: refs.musicInstrumental?.checked === true,
        generateLyrics: refs.musicGenerateLyrics?.checked === true && !refs.musicGenerateLyrics.disabled,
    };
    const manualLyrics = refs.musicLyrics?.value.trim() || '';
    if (manualLyrics && !payload.instrumental && !payload.generateLyrics) payload.lyrics = manualLyrics;
    const folderId = refs.folderSelect?.value || '';
    if (folderId) payload.folder_id = folderId;

    const res = await apiAiGenerateMusic(payload, {
        headers: { 'Idempotency-Key': createIdempotencyKey('generate-lab-music') },
    });
    if (res.ok) {
        renderMusicResult(res.data?.data || res.data || {});
    }
    return res;
}

async function handleGenerate() {
    if (state.busy) return;
    if (!requireMember()) return;

    const prompt = refs.prompt?.value.trim() || '';
    if (!prompt) {
        setMessage('Prompt is required.', 'error');
        refs.prompt?.focus();
        return;
    }

    const price = currentCreditEstimate();
    if (state.creditBalance !== null && state.creditBalance < price) {
        setMessage(`You need ${formatCredits(price)} for this generation.`, 'error');
        return;
    }

    setMessage('');
    setBusy(true, state.mediaType === 'music' ? 'Generating Music...' : state.mediaType === 'video' ? 'Generating Video...' : 'Generating Image...');
    renderLoadingResult(state.mediaType === 'music'
        ? 'Creating your track. This can take up to 2 minutes...'
        : state.mediaType === 'video'
            ? 'Generating and saving your PixVerse video...'
            : 'Creating your image...');

    let res;
    try {
        if (state.mediaType === 'image') res = await generateImage(prompt);
        else if (state.mediaType === 'video') res = await generateVideo(prompt);
        else res = await generateMusic(prompt);
    } catch (error) {
        console.warn('Generate Lab generation failed:', error);
        res = { ok: false, error: 'Generation failed. Please try again.' };
    } finally {
        setBusy(false);
    }

    if (!res?.ok) {
        renderEmptyResult();
        setMessage(res?.error || 'Generation failed. Please try again.', 'error');
        return;
    }

    const balanceAfter = res.data?.billing?.balance_after;
    if (typeof balanceAfter === 'number') {
        state.creditBalance = balanceAfter;
        updateAccountPanel();
    }
    const success = state.mediaType === 'image'
        ? 'Image generated. Save it when you are ready.'
        : state.mediaType === 'video'
            ? 'Video generated and saved.'
            : 'Music generated and saved.';
    setMessage(success, 'success');
    await loadRecentAssets();
}

function mediaPreviewForAsset(asset) {
    const imageUrl = asset?.thumb_url || asset?.medium_url || asset?.url || asset?.file_url || '';
    const posterUrl = asset?.poster_url || asset?.thumb_url || asset?.medium_url || '';
    if (isVideoAsset(asset)) {
        return posterUrl
            ? el('img', { attrs: { src: posterUrl, alt: '', loading: 'lazy' } })
            : el('span', { className: 'generate-lab__recent-kind', text: 'VID' });
    }
    if (isAudioAsset(asset)) {
        return posterUrl
            ? el('img', { attrs: { src: posterUrl, alt: '', loading: 'lazy' } })
            : el('span', { className: 'generate-lab__recent-kind', text: 'SND' });
    }
    return imageUrl
        ? el('img', { attrs: { src: imageUrl, alt: '', loading: 'lazy' } })
        : el('span', { className: 'generate-lab__recent-kind', text: 'IMG' });
}

function renderRecentAssets(assets) {
    if (!refs.recentAssets) return;
    if (!state.loggedIn) {
        refs.recentAssets.replaceChildren(el('div', { className: 'generate-lab__recent-empty', text: 'Sign in to load recent assets.' }));
        return;
    }
    if (!assets.length) {
        refs.recentAssets.replaceChildren(el('div', { className: 'generate-lab__recent-empty', text: 'No saved assets yet.' }));
        return;
    }
    const cards = assets.slice(0, 6).map((asset) => {
        const title = getAssetTitle(asset);
        const card = el('button', {
            className: 'generate-lab__recent-card',
            attrs: {
                type: 'button',
                'aria-label': `Open ${title} in Generate Lab preview`,
                'aria-pressed': 'false',
                'data-asset-id': asset?.id || '',
            },
        });
        card.append(
            el('span', { className: 'generate-lab__recent-thumb' }, mediaPreviewForAsset(asset)),
            el('strong', { text: title }),
        );
        card.addEventListener('click', () => openRecentAsset(asset));
        return card;
    });
    refs.recentAssets.replaceChildren(...cards);
}

async function loadRecentAssets() {
    if (!state.loggedIn) {
        renderRecentAssets([]);
        return;
    }
    try {
        const result = await apiAiGetAssets(null, { limit: 6 });
        renderRecentAssets(result.assets || []);
    } catch (error) {
        console.warn('Generate Lab recent asset load failed:', error);
        refs.recentAssets?.replaceChildren(el('div', { className: 'generate-lab__recent-empty', text: 'Recent assets could not be loaded.' }));
    }
}

async function loadFolders() {
    if (!state.loggedIn) {
        state.folders = [];
        renderFolderOptions();
        return;
    }
    try {
        const result = await apiAiGetFolders();
        state.folders = Array.isArray(result.folders) ? result.folders : [];
    } catch (error) {
        console.warn('Generate Lab folder load failed:', error);
        state.folders = [];
    }
    renderFolderOptions();
}

async function loadQuota() {
    if (!state.loggedIn) {
        state.creditBalance = null;
        updateAccountPanel();
        updateActionState();
        return;
    }
    try {
        const quota = await apiAiGetQuota();
        state.creditBalance = typeof quota?.creditBalance === 'number' ? quota.creditBalance : null;
    } catch (error) {
        console.warn('Generate Lab quota load failed:', error);
        state.creditBalance = null;
    }
    updateAccountPanel();
    updateActionState();
}

async function loadSession() {
    try {
        const res = await apiGetMe();
        state.loggedIn = res.ok && res.data?.loggedIn === true;
        state.user = state.loggedIn ? (res.data?.user || null) : null;
    } catch (error) {
        console.warn('Generate Lab session load failed:', error);
        state.loggedIn = false;
        state.user = null;
    }
    updateAccountPanel();
    updateActionState();
}

function bindEvents() {
    for (const tab of document.querySelectorAll('.generate-lab__media-tab')) {
        tab.addEventListener('click', () => {
            const mediaType = tab.dataset.mediaType || 'image';
            state.mediaType = mediaType;
            state.modelId = getDefaultGenerateLabModel(mediaType).id;
            renderAllForSelection();
        });
    }

    refs.imageModel?.addEventListener('change', () => {
        state.modelId = refs.imageModel.value;
        renderAllForSelection({ keepResult: true });
    });
    refs.imageSteps?.addEventListener('change', updateActionState);
    refs.imageSeed?.addEventListener('input', updateActionState);
    refs.videoDuration?.addEventListener('change', updateActionState);
    refs.videoQuality?.addEventListener('change', updateActionState);
    refs.videoAspect?.addEventListener('change', updateActionState);
    refs.videoAudio?.addEventListener('change', updateActionState);
    refs.videoReference?.addEventListener('change', handleVideoReferenceChange);
    refs.videoReferenceRemove?.addEventListener('click', clearVideoReference);
    refs.musicInstrumental?.addEventListener('change', syncMusicOptionState);
    refs.musicGenerateLyrics?.addEventListener('change', syncMusicOptionState);
    refs.musicLyrics?.addEventListener('input', syncMusicOptionState);
    refs.generate?.addEventListener('click', handleGenerate);
    refs.recentAssetsOpen?.addEventListener('click', openAssetsOverlay);
    refs.assetsOverlayClose?.addEventListener('click', closeAssetsOverlay);
    refs.assetsOverlay?.addEventListener('click', (event) => {
        if (event.target.closest('[data-lab-assets-close]')) closeAssetsOverlay();
    });
    refs.assetsOverlay?.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeAssetsOverlay();
        }
    });
    refs.prompt?.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            handleGenerate();
        }
    });
}

function cacheRefs() {
    Object.assign(refs, {
        accountStatus: byId('labAccountStatus'),
        creditStatus: byId('labCreditStatus'),
        mediaTabs: Array.from(document.querySelectorAll('.generate-lab__media-tab')),
        modelList: byId('labModelList'),
        modelDetails: byId('labModelDetails'),
        modelBadge: byId('labModelBadge'),
        composerEyebrow: byId('labComposerEyebrow'),
        composerTitle: byId('labComposerTitle'),
        prompt: byId('labPrompt'),
        promptLabel: byId('labPromptLabel'),
        promptHelp: byId('labPromptHelp'),
        resultStage: byId('labResultStage'),
        recentAssets: byId('labRecentAssets'),
        recentAssetsOpen: byId('labRecentAssetsOpen'),
        imageModel: byId('labImageModel'),
        imageSteps: byId('labImageSteps'),
        imageSeed: byId('labImageSeed'),
        videoNegative: byId('labVideoNegative'),
        videoReference: byId('labVideoReference'),
        videoReferenceShell: byId('labVideoReferenceShell'),
        videoReferenceLabel: byId('labVideoReferenceLabel'),
        videoReferenceRemove: byId('labVideoReferenceRemove'),
        videoDuration: byId('labVideoDuration'),
        videoQuality: byId('labVideoQuality'),
        videoAspect: byId('labVideoAspect'),
        videoSeed: byId('labVideoSeed'),
        videoAudio: byId('labVideoAudio'),
        musicLyrics: byId('labMusicLyrics'),
        musicInstrumental: byId('labMusicInstrumental'),
        musicGenerateLyrics: byId('labMusicGenerateLyrics'),
        folderSelect: byId('labFolderSelect'),
        cost: byId('labCost'),
        balance: byId('labBalance'),
        generate: byId('labGenerate'),
        message: byId('labMessage'),
        assetsOverlay: byId('labAssetsOverlay'),
        assetsOverlayShell: document.querySelector('.generate-lab-assets-overlay__shell'),
        assetsOverlayClose: byId('labAssetsOverlayClose'),
    });
}

async function init() {
    document.documentElement.classList.add('generate-lab-ready');
    activateGenerateLabContext();
    try {
        initSiteHeader({
            showCategoryLinks: false,
            enableGlobalAudio: false,
            homeTarget: 'bitbi-main',
            homeRel: 'noopener',
            contextLabel: 'Desktop Workspace',
            isGenerateLabPage: true,
        });
    } catch (error) { console.warn(error); }
    try { initParticles('heroCanvas'); } catch (error) { console.warn(error); }
    try { initBinaryRain('binaryRain'); } catch (error) { console.warn(error); }
    try { initBinaryFooter('binaryFooter'); } catch (error) { console.warn(error); }
    try { initScrollReveal(); } catch (error) { console.warn(error); }
    try { initCookieConsent(); } catch (error) { console.warn(error); }

    cacheRefs();
    installHeaderStatusPanel();
    if (!refs.generate || !refs.prompt) return;

    if (!getGenerateLabModels().some((model) => model.id === MUSIC_26_MODEL_ID)) {
        console.warn('Generate Lab registry is missing Music 2.6.');
    }

    bindEvents();
    renderAllForSelection();
    await loadSession();
    await Promise.all([loadQuota(), loadFolders(), loadRecentAssets()]);
}

document.addEventListener('bitbi:auth-change', () => {
    window.setTimeout(() => {
        installHeaderStatusPanel();
        loadSession().catch((error) => console.warn('Generate Lab auth refresh failed:', error));
    }, 0);
});

init();
