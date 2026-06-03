import {
    apiAdminUploadHomepageHeroVideoSource,
    createAdminIdempotencyKey,
} from '../../shared/auth-api.js?v=__ASSET_VERSION__';

export const MANUAL_UPLOAD_ASPECT_RATIOS = Object.freeze([
    ['9:16', 'Hochkant (9:16)'],
    ['1:1', 'Square (1:1)'],
    ['16:9', 'Landscape (16:9)'],
]);
export const DEFAULT_MANUAL_UPLOAD_ASPECT_RATIO = '16:9';
export const DEFAULT_MANUAL_UPLOAD_POSTER_TIME_SECONDS = 1;

const MAX_MANUAL_UPLOAD_POSTER_TIME_SECONDS = 3600;
const POSTER_CAPTURE_TIMEOUT_MS = 10_000;

function el(tag, className, text = null) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== null && text !== undefined) node.textContent = String(text);
    return node;
}

function formatBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes <= 0) return 'Not recorded';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let index = 0;
    while (size >= 1024 && index < units.length - 1) {
        size /= 1024;
        index += 1;
    }
    return `${size >= 10 || index === 0 ? Math.round(size) : size.toFixed(1)} ${units[index]}`;
}

export function normalizeManualUploadPosterTimeSeconds(value, fallback = DEFAULT_MANUAL_UPLOAD_POSTER_TIME_SECONDS) {
    const parsed = Number.parseFloat(String(value ?? '').trim());
    if (!Number.isFinite(parsed)) return fallback;
    const clamped = Math.min(MAX_MANUAL_UPLOAD_POSTER_TIME_SECONDS, Math.max(0, parsed));
    return Math.round(clamped * 10) / 10;
}

function formatManualUploadPosterTimeSeconds(value) {
    const normalized = normalizeManualUploadPosterTimeSeconds(value);
    return Number.isInteger(normalized) ? String(normalized) : String(normalized);
}

function buildUploadPosterKey(file, timeSeconds) {
    if (!file) return '';
    const lastModified = Number.isFinite(file.lastModified) ? file.lastModified : 0;
    const normalizedTime = normalizeManualUploadPosterTimeSeconds(timeSeconds);
    return `${file.name}:${file.size}:${lastModified}:${normalizedTime}`;
}

function clampPosterCaptureTimeSeconds(requestedTimeSeconds, duration) {
    const requested = normalizeManualUploadPosterTimeSeconds(requestedTimeSeconds);
    if (!Number.isFinite(duration) || duration <= 0) return requested;
    const safeEnd = Math.max(0, duration - 0.05);
    return Math.min(requested, safeEnd);
}

function waitForVideoEvent(video, eventName, timeoutMs = POSTER_CAPTURE_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        let timer = null;
        const cleanup = () => {
            if (timer) window.clearTimeout(timer);
            video.removeEventListener(eventName, onEvent);
            video.removeEventListener('error', onError);
        };
        const onEvent = () => {
            cleanup();
            resolve();
        };
        const onError = () => {
            cleanup();
            reject(new Error('Poster frame could not be generated from this video.'));
        };
        timer = window.setTimeout(() => {
            cleanup();
            reject(new Error('Poster frame generation timed out.'));
        }, timeoutMs);
        video.addEventListener(eventName, onEvent, { once: true });
        video.addEventListener('error', onError, { once: true });
    });
}

function waitForVideoSeek(video, targetTime, timeoutMs = POSTER_CAPTURE_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        const startedAt = performance.now();
        let timer = null;
        const cleanup = () => {
            if (timer) window.clearTimeout(timer);
            video.removeEventListener('seeked', checkReady);
            video.removeEventListener('loadeddata', checkReady);
            video.removeEventListener('timeupdate', checkReady);
            video.removeEventListener('error', onError);
        };
        const isReady = () => video.readyState >= 2
            && Math.abs(Number(video.currentTime || 0) - targetTime) < 0.15;
        function checkReady() {
            if (isReady()) {
                cleanup();
                resolve();
                return;
            }
            if (performance.now() - startedAt >= timeoutMs) {
                cleanup();
                reject(new Error('Poster frame generation timed out.'));
                return;
            }
            timer = window.setTimeout(checkReady, 50);
        }
        function onError() {
            cleanup();
            reject(new Error('Poster frame could not be generated from this video.'));
        }
        video.addEventListener('seeked', checkReady);
        video.addEventListener('loadeddata', checkReady);
        video.addEventListener('timeupdate', checkReady);
        video.addEventListener('error', onError, { once: true });
        checkReady();
    });
}

async function createTrustedLocalVideoBlob(source) {
    if (typeof Blob === 'undefined' || !(source instanceof Blob)) {
        throw new Error('Poster frame generation requires a local video Blob.');
    }
    const mimeType = String(source.type || '').toLowerCase();
    if (mimeType && !mimeType.startsWith('video/')) {
        throw new Error('Poster frame generation requires a local video Blob.');
    }
    const bytes = await source.arrayBuffer();
    return new Blob([bytes], { type: mimeType || 'video/mp4' });
}

function loadTrustedLocalVideoBlob(video, videoBlob) {
    video.src = URL.createObjectURL(videoBlob);
}

function revokeTrustedLocalVideoBlob(video) {
    const objectUrl = video.currentSrc || video.src || '';
    if (objectUrl.startsWith('blob:')) URL.revokeObjectURL(objectUrl);
    video.removeAttribute('src');
    try { video.load(); } catch { /* noop */ }
}

export async function capturePosterFromLocalVideoBlob(source, { timeSeconds = DEFAULT_MANUAL_UPLOAD_POSTER_TIME_SECONDS } = {}) {
    const videoBlob = await createTrustedLocalVideoBlob(source);
    const video = document.createElement('video');
    try {
        video.muted = true;
        video.playsInline = true;
        video.preload = 'metadata';
        const metadataReady = waitForVideoEvent(video, 'loadedmetadata');
        loadTrustedLocalVideoBlob(video, videoBlob);
        await metadataReady;
        const targetTime = clampPosterCaptureTimeSeconds(timeSeconds, video.duration);
        if (targetTime > 0) {
            const seeked = waitForVideoSeek(video, targetTime);
            video.currentTime = targetTime;
            await seeked;
        } else if (video.readyState < 2) {
            await waitForVideoEvent(video, 'loadeddata');
        }

        const width = video.videoWidth || 640;
        const height = video.videoHeight || 360;
        const canvas = document.createElement('canvas');
        const ratio = Math.min(640 / width, 640 / height, 1);
        canvas.width = Math.max(1, Math.round(width * ratio));
        canvas.height = Math.max(1, Math.round(height * ratio));
        const context = canvas.getContext('2d');
        if (!context) {
            throw new Error('Poster frame could not be generated from this video.');
        }
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        return await new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (!blob) {
                    reject(new Error('Poster frame could not be encoded.'));
                    return;
                }
                resolve(blob);
            }, 'image/webp', 0.82);
        });
    } finally {
        revokeTrustedLocalVideoBlob(video);
    }
}

function generatePosterBlobFromVideoFile(file, { timeSeconds = DEFAULT_MANUAL_UPLOAD_POSTER_TIME_SECONDS } = {}) {
    if (!file) return Promise.resolve(null);
    return capturePosterFromLocalVideoBlob(file, { timeSeconds });
}

export function createManualHeroVideoUploadState() {
    return {
        uploadFile: null,
        uploadPoster: null,
        uploadPosterWarning: '',
        uploadPosterBusy: false,
        uploadPosterKey: '',
        uploadTitle: '',
        uploadAspectRatio: DEFAULT_MANUAL_UPLOAD_ASPECT_RATIO,
        uploadPosterTimeSeconds: DEFAULT_MANUAL_UPLOAD_POSTER_TIME_SECONDS,
        uploadBusy: false,
    };
}

export function createManualHeroVideoUploadController({
    isEnabled = () => true,
    getOperatorReason = () => '',
    setStatus = () => {},
    render = () => {},
    showToast = null,
    formatApiError = null,
    onUploadSuccess = null,
    panelTitle = 'Manual source upload',
    panelDescription = 'Uploads create private admin source assets only. Public playback still requires an optimized derivative.',
    disabledMessage = 'Manual uploads are disabled by the Admin switch or Worker hard-disable.',
    successStatus = 'Private hero source uploaded. Convert it before assigning a public slot.',
    successToast = 'Hero source uploaded.',
    errorFallback = 'Hero source upload failed.',
    reasonError = 'Enter an operator reason before uploading.',
    uploadStatus = 'Uploading private hero source...',
} = {}) {
    const state = createManualHeroVideoUploadState();

    function enabled() {
        return isEnabled() !== false;
    }

    function reset() {
        state.uploadFile = null;
        state.uploadPoster = null;
        state.uploadPosterKey = '';
        state.uploadPosterWarning = '';
        state.uploadPosterBusy = false;
        state.uploadTitle = '';
        state.uploadAspectRatio = DEFAULT_MANUAL_UPLOAD_ASPECT_RATIO;
        state.uploadPosterTimeSeconds = DEFAULT_MANUAL_UPLOAD_POSTER_TIME_SECONDS;
        state.uploadBusy = false;
    }

    async function prepareUploadPoster(file, { force = false } = {}) {
        const posterKey = buildUploadPosterKey(file, state.uploadPosterTimeSeconds);
        if (!force && state.uploadPoster && state.uploadPosterKey === posterKey) return state.uploadPoster;
        state.uploadPoster = null;
        state.uploadPosterKey = '';
        state.uploadPosterWarning = '';
        if (!file) return null;
        state.uploadPosterBusy = true;
        render();
        try {
            state.uploadPoster = await generatePosterBlobFromVideoFile(file, {
                timeSeconds: state.uploadPosterTimeSeconds,
            });
            state.uploadPosterKey = posterKey;
        } catch (error) {
            console.warn(error);
            state.uploadPosterWarning = 'Poster preview could not be generated automatically. Upload can continue, but retry poster generation before using this source in Admin asset views.';
        } finally {
            state.uploadPosterBusy = false;
            render();
        }
        return state.uploadPoster;
    }

    async function ensureFreshUploadPoster() {
        if (!state.uploadFile) return;
        const posterKey = buildUploadPosterKey(state.uploadFile, state.uploadPosterTimeSeconds);
        if (state.uploadPoster && state.uploadPosterKey === posterKey) return;
        await prepareUploadPoster(state.uploadFile, { force: true });
    }

    async function uploadSource() {
        if (!enabled() || !state.uploadFile || state.uploadBusy) return;
        const reason = String(getOperatorReason() || '').trim();
        if (reason.length < 8) {
            setStatus(reasonError, 'error');
            return;
        }
        state.uploadBusy = true;
        setStatus('Preparing thumbnail preview...');
        render();
        await ensureFreshUploadPoster();
        setStatus(uploadStatus);
        render();
        const res = await apiAdminUploadHomepageHeroVideoSource(state.uploadFile, {
            title: state.uploadTitle,
            operatorReason: reason,
            poster: state.uploadPoster,
            aspectRatio: state.uploadAspectRatio,
            posterTimeSeconds: state.uploadPosterTimeSeconds,
            idempotencyKey: createAdminIdempotencyKey('homepage-hero-video-upload'),
        });
        state.uploadBusy = false;
        if (!res.ok) {
            const message = formatApiError?.(res, errorFallback) || res.error || errorFallback;
            setStatus(message, 'error');
            showToast?.(message, 'error');
            render();
            return;
        }
        const data = res.data?.data || {};
        if (data.poster_warning) {
            showToast?.(data.poster_warning, 'warning');
        }
        if (typeof onUploadSuccess === 'function') {
            await onUploadSuccess(data);
        }
        reset();
        setStatus(successStatus, 'success');
        showToast?.(successToast, 'success');
        render();
    }

    function renderPanel() {
        const panel = el('div', 'admin-hero-videos__upload');
        panel.append(el('h4', 'admin-hero-videos__upload-title', panelTitle));
        if (panelDescription) panel.append(el('p', 'admin-shell__desc', panelDescription));

        const titleLabel = el('label', 'admin-hero-videos__field');
        titleLabel.append(el('span', null, 'Source title'));
        const title = document.createElement('input');
        title.className = 'admin-search__input';
        title.type = 'text';
        title.maxLength = 120;
        title.dataset.field = 'upload-title';
        title.value = state.uploadTitle || '';
        title.disabled = !enabled() || state.uploadBusy;
        titleLabel.append(title);
        panel.append(titleLabel);

        const fileLabel = el('label', 'admin-hero-videos__field');
        fileLabel.append(el('span', null, 'Video file'));
        const file = document.createElement('input');
        file.className = 'admin-search__input';
        file.type = 'file';
        file.accept = 'video/mp4,video/webm,video/quicktime';
        file.dataset.field = 'upload-file';
        file.disabled = !enabled() || state.uploadBusy;
        fileLabel.append(file);
        panel.append(fileLabel);

        const optionsRow = el('div', 'admin-hero-videos__upload-options');

        const aspectLabel = el('label', 'admin-hero-videos__field');
        aspectLabel.append(el('span', null, 'Display format'));
        const aspect = document.createElement('select');
        aspect.className = 'admin-search__input';
        aspect.dataset.field = 'upload-aspect-ratio';
        aspect.disabled = !enabled() || state.uploadBusy;
        MANUAL_UPLOAD_ASPECT_RATIOS.forEach(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            option.selected = (state.uploadAspectRatio || DEFAULT_MANUAL_UPLOAD_ASPECT_RATIO) === value;
            aspect.append(option);
        });
        aspectLabel.append(aspect);
        optionsRow.append(aspectLabel);

        const posterTimeLabel = el('label', 'admin-hero-videos__field');
        posterTimeLabel.append(el('span', null, 'Thumb timestamp'));
        const posterTime = document.createElement('input');
        posterTime.className = 'admin-search__input';
        posterTime.type = 'number';
        posterTime.min = '0';
        posterTime.step = '0.1';
        posterTime.dataset.field = 'upload-poster-time';
        posterTime.value = formatManualUploadPosterTimeSeconds(state.uploadPosterTimeSeconds);
        posterTime.disabled = !enabled() || state.uploadBusy;
        posterTimeLabel.append(posterTime);
        posterTimeLabel.append(el('small', 'admin-hero-videos__field-help', 'Seconds into the video used for the saved thumbnail.'));
        optionsRow.append(posterTimeLabel);
        panel.append(optionsRow);

        const actions = el('div', 'admin-hero-videos__actions');
        const uploadBtn = el('button', 'btn-action', state.uploadBusy ? 'Uploading...' : 'Upload source');
        uploadBtn.type = 'button';
        uploadBtn.dataset.action = 'upload-source';
        uploadBtn.disabled = !enabled() || state.uploadBusy || state.uploadPosterBusy || !state.uploadFile;
        actions.append(uploadBtn);
        panel.append(actions);

        if (!enabled()) {
            panel.append(el('p', 'admin-shell__desc', disabledMessage));
        } else if (state.uploadPosterBusy) {
            panel.append(el('p', 'admin-shell__desc', 'Generating poster preview from the selected video...'));
        } else if (state.uploadPosterWarning) {
            panel.append(el('p', 'admin-hero-videos__feature-warning', state.uploadPosterWarning));
            const retryActions = el('div', 'admin-hero-videos__actions');
            const retryPoster = el('button', 'btn-action admin-hero-videos__button--ghost', 'Retry poster preview');
            retryPoster.type = 'button';
            retryPoster.dataset.action = 'retry-upload-poster';
            retryPoster.disabled = !state.uploadFile || state.uploadBusy;
            retryActions.append(retryPoster);
            panel.append(retryActions);
        } else if (state.uploadFile) {
            panel.append(createMetaRow('Selected file', `${state.uploadFile.name} (${formatBytes(state.uploadFile.size)})`));
            panel.append(createMetaRow('Generated poster', state.uploadPoster ? 'Ready' : 'Not generated'));
        }
        return panel;
    }

    function createMetaRow(label, value) {
        const row = el('div', 'admin-hero-videos__meta-row');
        row.append(el('span', null, label));
        row.append(el('strong', null, value || 'Not recorded'));
        return row;
    }

    function handleInput(event) {
        if (event.target?.dataset?.field === 'upload-title') {
            state.uploadTitle = event.target.value || '';
            return true;
        }
        if (event.target?.dataset?.field === 'upload-poster-time') {
            state.uploadPosterTimeSeconds = normalizeManualUploadPosterTimeSeconds(event.target.value);
            state.uploadPosterKey = '';
            return true;
        }
        return false;
    }

    function handleChange(event) {
        if (event.target?.dataset?.field === 'upload-aspect-ratio') {
            const value = event.target.value || DEFAULT_MANUAL_UPLOAD_ASPECT_RATIO;
            state.uploadAspectRatio = MANUAL_UPLOAD_ASPECT_RATIOS.some(([ratio]) => ratio === value)
                ? value
                : DEFAULT_MANUAL_UPLOAD_ASPECT_RATIO;
            return true;
        }
        if (event.target?.dataset?.field === 'upload-poster-time') {
            state.uploadPosterTimeSeconds = normalizeManualUploadPosterTimeSeconds(event.target.value);
            event.target.value = formatManualUploadPosterTimeSeconds(state.uploadPosterTimeSeconds);
            state.uploadPosterKey = '';
            return true;
        }
        if (event.target?.dataset?.field === 'upload-file') {
            state.uploadFile = event.target.files?.[0] || null;
            state.uploadPosterKey = '';
            if (!state.uploadTitle && state.uploadFile?.name) {
                state.uploadTitle = state.uploadFile.name.replace(/\.[^.]+$/, '');
            }
            prepareUploadPoster(state.uploadFile).catch((error) => {
                console.warn(error);
                state.uploadPosterBusy = false;
                state.uploadPosterWarning = 'Poster preview could not be generated automatically.';
                render();
            });
            return true;
        }
        return false;
    }

    function handleClick(event) {
        const target = event.target?.closest?.('[data-action]');
        const action = target?.dataset?.action || '';
        if (action === 'upload-source') {
            uploadSource().catch((error) => {
                console.warn(error);
                state.uploadBusy = false;
                setStatus(errorFallback, 'error');
                render();
            });
            return true;
        }
        if (action === 'retry-upload-poster') {
            prepareUploadPoster(state.uploadFile).catch((error) => {
                console.warn(error);
                state.uploadPosterBusy = false;
                state.uploadPosterWarning = 'Poster preview could not be generated automatically.';
                render();
            });
            return true;
        }
        return false;
    }

    return {
        state,
        reset,
        renderPanel,
        handleInput,
        handleChange,
        handleClick,
        prepareUploadPoster,
        ensureFreshUploadPoster,
        uploadSource,
    };
}
