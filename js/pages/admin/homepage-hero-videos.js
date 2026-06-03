import {
    apiAdminCreateHomepageHeroVideoDerivative,
    apiAdminHomepageHeroVideoDerivative,
    apiAdminHomepageHeroVideoCandidates,
    apiAdminHomepageHeroVideoDerivatives,
    apiAdminHomepageHeroVideos,
    apiAdminRetryHomepageHeroVideoDerivative,
    apiAdminRetryHomepageHeroVideoPoster,
    apiAdminRunMemvidStreamPreviews,
    apiAdminUpdateHomepageHeroVideoFeatureSwitch,
    apiAdminUpdateHomepageHeroVideoPreset,
    apiAdminUpdateHomepageHeroVideoSlot,
    createAdminIdempotencyKey,
} from '../../shared/auth-api.js?v=__ASSET_VERSION__';
import { createManualHeroVideoUploadController } from './manual-hero-video-upload.js?v=__ASSET_VERSION__';

const SLOT_ORDER = ['right_top', 'right_bottom', 'left_top', 'left_bottom'];
const SLOT_LABELS = {
    right_top: 'Right top',
    right_bottom: 'Right bottom',
    left_top: 'Left top',
    left_bottom: 'Left bottom',
};
const CANDIDATE_SOURCES = {
    public: 'Published Videos',
    'admin-assets': 'Admin Assets',
};
const FEATURE_LABELS = {
    homepage_hero_external_ffmpeg: 'Hero external ffmpeg derivatives',
    homepage_hero_manual_uploads: 'Hero manual uploads',
    memvid_stream_previews: 'Memvid Stream previews',
    memvid_stream_preview_autoplay: 'Memvid hover autoplay',
};
const DERIVATIVE_POLL_INTERVAL_MS = 4000;

function el(tag, className, text = null) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== null && text !== undefined) node.textContent = String(text);
    return node;
}

function clear(node) {
    node?.replaceChildren?.();
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

function formatCompressionRatio(originalBytes, derivativeBytes) {
    const original = Number(originalBytes);
    const derivative = Number(derivativeBytes);
    if (!Number.isFinite(original) || !Number.isFinite(derivative) || original <= 0 || derivative <= 0) {
        return 'Not recorded';
    }
    return `${Math.max(1, Math.round((original / derivative) * 10) / 10)}x smaller`;
}

function stableStringify(value) {
    if (value === null || value === undefined || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function normalizeCandidateSourceType(value) {
    return value === 'admin_asset' ? 'admin-assets' : value;
}

function derivativeMatchesCandidate(derivative, candidate) {
    if (!derivative || !candidate) return false;
    return derivative.source_asset_id === candidate.source_asset_id
        && normalizeCandidateSourceType(derivative.source_type) === normalizeCandidateSourceType(candidate.source_type);
}

function derivativeMatchesCurrentPreset(derivative, presetStatus) {
    if (!derivative?.target_preset || !presetStatus?.preset) return true;
    return stableStringify(derivative.target_preset) === stableStringify(presetStatus.preset);
}

function isDerivativeTerminal(derivative) {
    return ['succeeded', 'failed'].includes(String(derivative?.status || '').toLowerCase());
}

function sortDerivativesForCurrentSelection(derivatives, state) {
    return [...derivatives].sort((a, b) => {
        const aSelected = a.slot === state.selectedSlot && derivativeMatchesCandidate(a, state.selectedCandidate) ? 1 : 0;
        const bSelected = b.slot === state.selectedSlot && derivativeMatchesCandidate(b, state.selectedCandidate) ? 1 : 0;
        if (aSelected !== bSelected) return bSelected - aSelected;
        const aTime = Date.parse(a.completed_at || a.processing_completed_at || a.updated_at || a.created_at || '') || 0;
        const bTime = Date.parse(b.completed_at || b.processing_completed_at || b.updated_at || b.created_at || '') || 0;
        return bTime - aTime;
    });
}

function formatDate(value, formatDate) {
    if (!value) return 'Not recorded';
    try {
        return formatDate ? formatDate(value) : new Date(value).toLocaleString('en-GB');
    } catch {
        return 'Not recorded';
    }
}

function formatDateValue(value, formatter) {
    if (!value) return 'Not recorded';
    try {
        return formatter ? formatter(value) : new Date(value).toLocaleString('en-GB');
    } catch {
        return 'Not recorded';
    }
}

function getPublicSlotMedia(slot) {
    const version = slot?.derivative?.version;
    if (!slot?.enabled || !version) return null;
    const encodedSlot = encodeURIComponent(slot.slot);
    const encodedVersion = encodeURIComponent(version);
    return {
        file: `/api/homepage/hero-videos/${encodedSlot}/${encodedVersion}/file`,
        poster: `/api/homepage/hero-videos/${encodedSlot}/${encodedVersion}/poster`,
    };
}

function createMetaRow(label, value) {
    const row = el('div', 'admin-hero-videos__meta-row');
    row.append(el('span', 'admin-hero-videos__meta-label', label));
    row.append(el('span', 'admin-hero-videos__meta-value', value || 'Not recorded'));
    return row;
}

function createStatusBadge(status, enabled = false) {
    const badge = el('span', 'admin-hero-videos__badge');
    const normalized = String(status || '').toLowerCase();
    badge.dataset.state = enabled ? 'enabled' : (normalized || 'neutral');
    badge.textContent = enabled ? 'Enabled' : (status || 'Disabled');
    return badge;
}

function getPosterState({ posterUrl, posterStatus, posterMessage } = {}) {
    if (posterUrl) return null;
    const status = String(posterStatus || '').toLowerCase();
    if (status === 'pending' || status === 'queued' || status === 'processing') {
        return {
            state: 'pending',
            label: 'Poster preview is being prepared',
            message: posterMessage || 'Retry poster generation if this source remains pending.',
        };
    }
    if (status === 'failed') {
        return {
            state: 'failed',
            label: 'Poster preview failed',
            message: posterMessage || 'Retry poster generation before relying on Admin preview cards.',
        };
    }
    return null;
}

function createTrustedAdminMediaUrl(value, { allowBlob = true } = {}) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    let parsed;
    try {
        parsed = new URL(raw, window.location.origin);
    } catch {
        return null;
    }
    if (parsed.protocol === 'blob:') return allowBlob ? parsed : null;
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.origin !== window.location.origin) return null;
    return parsed;
}

function serializeTrustedAdminMediaUrl(url) {
    if (!(url instanceof URL)) return '';
    if (url.protocol === 'blob:') return url.href;
    if (url.origin !== window.location.origin) return '';
    return `${url.pathname}${url.search}${url.hash}`;
}

function setTrustedElementUrl(element, attribute, url) {
    const serialized = serializeTrustedAdminMediaUrl(url);
    if (!serialized) return false;
    element.setAttribute(attribute, serialized);
    return true;
}

function renderPreview({ fileUrl, posterUrl, title, posterStatus, posterMessage }) {
    const preview = el('div', 'admin-hero-videos__preview');
    const posterState = getPosterState({ posterUrl, posterStatus, posterMessage });
    if (posterState) {
        const state = el('div', 'admin-hero-videos__preview-state');
        state.dataset.state = posterState.state;
        state.append(el('strong', null, posterState.label));
        state.append(el('span', null, posterState.message));
        preview.append(state);
        return preview;
    }
    const safeFileUrl = createTrustedAdminMediaUrl(fileUrl);
    const safePosterUrl = createTrustedAdminMediaUrl(posterUrl);
    if (safeFileUrl) {
        const video = document.createElement('video');
        video.className = 'admin-hero-videos__video';
        video.controls = true;
        video.muted = true;
        video.playsInline = true;
        video.preload = 'metadata';
        setTrustedElementUrl(video, 'src', safeFileUrl);
        if (safePosterUrl) setTrustedElementUrl(video, 'poster', safePosterUrl);
        preview.append(video);
        return preview;
    }
    if (safePosterUrl) {
        const image = document.createElement('img');
        image.className = 'admin-hero-videos__poster';
        image.alt = title || 'Hero video poster';
        image.loading = 'lazy';
        setTrustedElementUrl(image, 'src', safePosterUrl);
        preview.append(image);
        return preview;
    }
    preview.append(el('span', 'admin-hero-videos__preview-empty', 'No preview available'));
    return preview;
}

function renderSlotCard(slot, state, formatDate) {
    const card = el('article', 'admin-hero-videos__slot-card');
    card.dataset.slot = slot.slot;
    if (state.selectedSlot === slot.slot) card.classList.add('admin-hero-videos__slot-card--selected');

    const top = el('div', 'admin-hero-videos__card-top');
    const titleWrap = el('div');
    titleWrap.append(el('h3', 'admin-hero-videos__card-title', SLOT_LABELS[slot.slot] || slot.slot));
    titleWrap.append(el('p', 'admin-hero-videos__card-subtitle', slot.title || slot.derivative?.source_title || 'No derivative assigned'));
    top.append(titleWrap);
    top.append(createStatusBadge(slot.derivative?.status || 'Disabled', slot.enabled));
    card.append(top);

    const media = getPublicSlotMedia(slot);
    card.append(renderPreview({
        fileUrl: media?.file || null,
        posterUrl: media?.poster || null,
        title: slot.title,
    }));

    const meta = el('div', 'admin-hero-videos__meta');
    meta.append(createMetaRow('Source', slot.source_type || 'None'));
    meta.append(createMetaRow('Original size', formatBytes(slot.derivative?.original_size_bytes)));
    meta.append(createMetaRow('Derivative size', formatBytes(slot.derivative?.size_bytes)));
    meta.append(createMetaRow('Compression', formatCompressionRatio(slot.derivative?.original_size_bytes, slot.derivative?.size_bytes)));
    meta.append(createMetaRow('Updated', formatDate(slot.updated_at, formatDate)));
    card.append(meta);

    const actions = el('div', 'admin-hero-videos__actions');
    const selectBtn = el('button', 'btn-action admin-hero-videos__button', 'Use this slot');
    selectBtn.type = 'button';
    selectBtn.dataset.action = 'select-slot';
    selectBtn.dataset.slot = slot.slot;
    actions.append(selectBtn);

    const disableBtn = el('button', 'btn-action admin-hero-videos__button admin-hero-videos__button--ghost', 'Disable slot');
    disableBtn.type = 'button';
    disableBtn.dataset.action = 'disable-slot';
    disableBtn.dataset.slot = slot.slot;
    disableBtn.disabled = !slot.enabled;
    actions.append(disableBtn);
    card.append(actions);

    return card;
}

function renderCandidateCard(candidate, state) {
    const card = el('article', 'admin-hero-videos__candidate-card');
    card.dataset.assetId = candidate.source_asset_id;
    if (state.selectedCandidate?.source_asset_id === candidate.source_asset_id
        && state.selectedCandidate?.source_type === candidate.source_type) {
        card.classList.add('admin-hero-videos__candidate-card--selected');
    }

    card.append(renderPreview({
        fileUrl: candidate.file_url || null,
        posterUrl: candidate.poster_url || null,
        title: candidate.title,
        posterStatus: candidate.poster_status,
        posterMessage: candidate.poster_message,
    }));

    const body = el('div', 'admin-hero-videos__candidate-body');
    body.append(el('h3', 'admin-hero-videos__candidate-title', candidate.title || 'Untitled video'));
    body.append(createMetaRow('Source', candidate.source_type === 'public' ? 'Published video' : 'Admin asset'));
    body.append(createMetaRow('Original size', formatBytes(candidate.size_bytes)));
    body.append(createMetaRow('Duration', candidate.duration_seconds ? `${candidate.duration_seconds}s` : 'Not recorded'));
    if (candidate.poster_status && !candidate.poster_url) {
        body.append(createMetaRow('Poster', candidate.poster_status));
    }
    const selectBtn = el('button', 'btn-action admin-hero-videos__button', 'Select');
    selectBtn.type = 'button';
    selectBtn.dataset.action = 'select-candidate';
    selectBtn.dataset.assetId = candidate.source_asset_id;
    selectBtn.dataset.sourceType = candidate.source_type;
    body.append(selectBtn);
    if (candidate.source_type === 'admin_asset' && candidate.poster_retryable && !candidate.poster_url) {
        const retryPoster = el('button', 'btn-action admin-hero-videos__button admin-hero-videos__button--ghost', state.posterRetryAssetId === candidate.source_asset_id ? 'Retrying poster...' : 'Retry poster');
        retryPoster.type = 'button';
        retryPoster.dataset.action = 'retry-candidate-poster';
        retryPoster.dataset.assetId = candidate.source_asset_id;
        retryPoster.disabled = state.posterRetryAssetId === candidate.source_asset_id || !candidate.file_url;
        body.append(retryPoster);
    }
    card.append(body);

    return card;
}

export function createHomepageHeroVideosAdmin({
    showToast,
    formatDate,
    formatApiError,
} = {}) {
    const refs = {
        container: document.getElementById('homepageHeroVideosAdmin'),
    };
    const state = {
        bound: false,
        loading: false,
        selectedSlot: 'right_top',
        selectedCandidate: null,
        pendingDerivative: null,
        provider: 'external_ffmpeg',
        currentSource: 'public',
        slots: [],
        candidates: [],
        recentDerivatives: [],
        derivativePollTimer: 0,
        derivativePollInFlight: false,
        manualUploadsEnabled: false,
        externalFfmpegEnabled: false,
        featureStatus: null,
        presetStatus: null,
        presetDraft: null,
        streamPreviewSummary: null,
        streamPreviewProcessorDispatch: null,
        posterRetryAssetId: '',
        savingFeatureKey: '',
        presetSaving: false,
        streamBackfillBusy: false,
        status: 'Loading homepage hero videos...',
        statusState: 'neutral',
    };

    function setStatus(message, statusState = 'neutral') {
        state.status = message;
        state.statusState = statusState;
        const status = refs.container?.querySelector('[data-homepage-hero-status]');
        if (status) {
            status.textContent = message;
            status.dataset.state = statusState;
        }
    }

    const manualUpload = createManualHeroVideoUploadController({
        isEnabled: () => state.manualUploadsEnabled,
        getOperatorReason: () => readReason(),
        setStatus,
        render: renderShell,
        showToast,
        formatApiError,
        async onUploadSuccess(data = {}) {
            const candidate = data.candidate || null;
            state.currentSource = 'admin-assets';
            await loadCandidates('admin-assets');
            state.selectedCandidate = candidate
                || state.candidates.find((entry) => entry.source_asset_id === candidate?.source_asset_id) || null;
        },
    });

    function selectedSlotRecord() {
        return state.slots.find((slot) => slot.slot === state.selectedSlot) || null;
    }

    function getFeature(key) {
        return state.featureStatus?.features?.[key] || null;
    }

    function getPresetDraft() {
        if (!state.presetDraft) {
            state.presetDraft = { ...(state.presetStatus?.preset || {}) };
        }
        return state.presetDraft;
    }

    function syncFeatureState(configData = {}) {
        state.featureStatus = configData.feature_status || state.featureStatus || null;
        state.presetStatus = configData.preset_status || state.presetStatus || null;
        state.presetDraft = state.presetStatus?.preset ? { ...state.presetStatus.preset } : state.presetDraft;
        const manualFeature = state.featureStatus?.features?.homepage_hero_manual_uploads || null;
        const ffmpegFeature = state.featureStatus?.features?.homepage_hero_external_ffmpeg || null;
        state.manualUploadsEnabled = typeof configData.manual_uploads_enabled === 'boolean'
            ? configData.manual_uploads_enabled === true
            : manualFeature?.effective_enabled === true;
        state.externalFfmpegEnabled = typeof configData.external_ffmpeg_enabled === 'boolean'
            ? configData.external_ffmpeg_enabled === true
            : ffmpegFeature?.effective_enabled === true;
        state.streamPreviewSummary = configData.stream_preview_summary || state.streamPreviewSummary;
        state.streamPreviewProcessorDispatch = configData.stream_preview_processor_dispatch || state.streamPreviewProcessorDispatch;
    }

    function renderShell() {
        if (!refs.container) return;
        clear(refs.container);

        const shell = el('section', 'admin-hero-videos');
        shell.setAttribute('aria-labelledby', 'homepageHeroVideosTitle');

        const header = el('div', 'admin-hero-videos__header');
        const headerText = el('div');
        headerText.append(el('p', 'admin-shell__eyebrow', 'Homepage media'));
        headerText.append(el('h2', 'admin-section-title', 'Homepage Hero Videos'));
        headerText.querySelector('h2').id = 'homepageHeroVideosTitle';
        headerText.append(el('p', 'admin-shell__desc', 'Configure exactly four optimized public hero-video slots. If the set is incomplete, the public homepage keeps using the latest published Memvid fallback.'));
        header.append(headerText);
        const refreshBtn = el('button', 'btn-action', 'Refresh');
        refreshBtn.type = 'button';
        refreshBtn.dataset.action = 'refresh';
        header.append(refreshBtn);
        shell.append(header);

        const status = el('div', 'admin-state admin-hero-videos__status', state.status);
        status.dataset.homepageHeroStatus = '1';
        status.dataset.state = state.statusState;
        shell.append(status);

        shell.append(renderOperationsSummary());

        const grid = el('div', 'admin-hero-videos__slot-grid');
        const slotsByName = new Map(state.slots.map((slot) => [slot.slot, slot]));
        SLOT_ORDER.forEach((slotName) => {
            grid.append(renderSlotCard(slotsByName.get(slotName) || { slot: slotName, enabled: false }, state, formatDate));
        });
        shell.append(grid);

        const workbench = el('div', 'admin-hero-videos__workbench');
        const workbenchMain = el('div', 'admin-hero-videos__workbench-main');
        workbenchMain.append(renderCandidateBrowser());
        workbenchMain.append(renderRecentConversionsPanel());
        workbench.append(workbenchMain);
        workbench.append(renderAssignmentPanel());
        shell.append(workbench);

        refs.container.append(shell);
    }

    function renderOperationsSummary() {
        const summary = el('section', 'admin-hero-videos__ops');
        summary.setAttribute('aria-label', 'Hero and stream preview operations');
        const leftColumn = el('div', 'admin-hero-videos__ops-left');
        const rightColumn = el('div', 'admin-hero-videos__ops-right');

        const hero = el('div', 'admin-hero-videos__ops-card');
        hero.append(el('h3', 'admin-hero-videos__section-title', 'Video Delivery Controls'));
        hero.append(el('p', 'admin-shell__desc', 'Worker capabilities default on. These Admin switches are runtime rollout controls and do not prove provider readiness.'));
        hero.append(renderFeatureControl('homepage_hero_external_ffmpeg'));
        hero.append(renderFeatureControl('homepage_hero_manual_uploads'));
        leftColumn.append(hero);
        leftColumn.append(renderPresetPanel());

        const preview = el('div', 'admin-hero-videos__ops-card');
        preview.append(el('h3', 'admin-hero-videos__section-title', 'Memvid Stream previews'));
        preview.append(renderFeatureControl('memvid_stream_previews'));
        preview.append(renderFeatureControl('memvid_stream_preview_autoplay'));
        const stream = state.streamPreviewSummary || {};
        const flags = stream.feature_flags || {};
        preview.append(createMetaRow('Provider config', flags.provider_configured ? 'Configured' : 'Missing'));
        const dispatch = state.streamPreviewProcessorDispatch || {};
        const dispatchLabel = dispatch.configured
            ? `Configured${dispatch.provider ? ` (${dispatch.provider})` : ''}`
            : 'Not configured';
        preview.append(createMetaRow('Processor dispatch', dispatchLabel));
        preview.append(createMetaRow('Auto dispatch', dispatch.auto_dispatch_enabled ? 'Enabled' : 'Disabled'));
        preview.append(createMetaRow('Dispatch threshold', String(dispatch.threshold ?? 3)));
        preview.append(createMetaRow('Last dispatch', dispatch.last_dispatch_at ? formatDateValue(dispatch.last_dispatch_at, formatDate) : 'Never'));
        preview.append(createMetaRow('Last dispatch status', dispatch.last_dispatch_status || 'None'));
        preview.append(createMetaRow('Last dispatch reason', dispatch.last_dispatch_reason || 'None'));
        preview.append(createMetaRow('Last dispatch message', dispatch.last_dispatch_message || dispatch.dispatch_skipped_reason || 'None'));
        preview.append(createMetaRow('Next dispatch after', dispatch.next_dispatch_after ? formatDateValue(dispatch.next_dispatch_after, formatDate) : 'Now'));
        preview.append(createMetaRow('Queued previews', String(stream.queued_count ?? stream.status_counts?.queued ?? 0)));
        preview.append(createMetaRow('Repair backlog', String(stream.repair_count ?? stream.ready_missing_download_url ?? 0)));
        preview.append(createMetaRow('Total processor backlog', String(stream.total_backlog_count ?? 0)));
        preview.append(createMetaRow('Ready previews', String(stream.ready_count ?? 0)));
        preview.append(createMetaRow('Ready MP4 downloads', String(stream.ready_with_download_url ?? 0)));
        preview.append(createMetaRow('Needs MP4 repair', String(stream.ready_missing_download_url ?? 0)));
        preview.append(createMetaRow('Pending deletes', String(stream.pending_delete_count ?? 0)));
        preview.append(createMetaRow('Failed deletes', String(stream.failed_delete_count ?? 0)));
        preview.append(createMetaRow('Failed previews', String(stream.failed_count ?? 0)));
        preview.append(createMetaRow('Estimated delivered minutes', String(stream.estimated_delivered_minutes ?? 0)));
        const actions = el('div', 'admin-hero-videos__actions');
        const backfillBtn = el('button', 'btn-action admin-hero-videos__button--ghost', state.streamBackfillBusy ? 'Queuing previews and starting processor...' : 'Generate / repair Memvid previews');
        backfillBtn.type = 'button';
        backfillBtn.dataset.action = 'run-stream-preview-processing';
        backfillBtn.disabled = !getFeature('memvid_stream_previews')?.effective_enabled || state.streamBackfillBusy;
        actions.append(backfillBtn);
        preview.append(actions);
        rightColumn.append(preview);

        summary.append(leftColumn);
        summary.append(rightColumn);
        return summary;
    }

    function renderFeatureControl(key) {
        const feature = getFeature(key);
        const row = el('div', 'admin-hero-videos__feature');
        row.dataset.feature = key;
        const text = el('div');
        text.append(el('strong', 'admin-hero-videos__feature-title', FEATURE_LABELS[key] || feature?.label || key));
        const provider = feature?.provider_required
            ? `Provider ${feature.provider_configured ? 'configured' : 'missing'}`
            : 'No provider secret required';
        text.append(el('span', 'admin-hero-videos__feature-meta', [
            `Worker ${feature?.worker_enabled ? 'on' : 'off'}`,
            `Admin ${feature?.admin_enabled ? 'on' : 'off'}`,
            `Effective ${feature?.effective_enabled ? 'on' : 'off'}`,
            provider,
        ].join(' · ')));
        if (feature?.provider?.missing?.length) {
            text.append(el('span', 'admin-hero-videos__feature-warning', `Missing: ${feature.provider.missing.join(', ')}`));
        }
        row.append(text);
        const btn = el('button', 'btn-action admin-hero-videos__button--ghost', feature?.admin_enabled ? 'Turn off' : 'Turn on');
        btn.type = 'button';
        btn.dataset.action = 'toggle-feature';
        btn.dataset.feature = key;
        btn.dataset.enabled = feature?.admin_enabled ? 'false' : 'true';
        btn.disabled = state.savingFeatureKey === key || !feature;
        row.append(btn);
        return row;
    }

    function renderPresetNumberField(label, field, { min, max, step = '1' } = {}) {
        const draft = getPresetDraft();
        const labelNode = el('label', 'admin-hero-videos__field');
        labelNode.append(el('span', null, label));
        const input = document.createElement('input');
        input.className = 'admin-search__input';
        input.type = 'number';
        input.min = String(min);
        input.max = String(max);
        input.step = step;
        input.dataset.presetField = field;
        input.value = draft[field] ?? '';
        input.disabled = state.presetSaving;
        labelNode.append(input);
        return labelNode;
    }

    function renderPresetPanel() {
        const panel = el('div', 'admin-hero-videos__ops-card admin-hero-videos__ops-card--wide');
        panel.append(el('h3', 'admin-hero-videos__section-title', 'Hero Conversion Preset'));
        panel.append(el('p', 'admin-shell__desc', 'Structured safe preset fields only. New values apply to new or retried derivative jobs; existing succeeded derivatives are not changed.'));
        const grid = el('div', 'admin-hero-videos__preset-grid');
        grid.append(renderPresetNumberField('Max width', 'maxWidth', { min: 320, max: 1080 }));
        grid.append(renderPresetNumberField('FPS', 'fps', { min: 12, max: 30 }));
        grid.append(renderPresetNumberField('Duration seconds', 'durationSeconds', { min: 3, max: 12 }));
        grid.append(renderPresetNumberField('CRF quality', 'crf', { min: 24, max: 36 }));
        grid.append(renderPresetNumberField('Poster width', 'posterWidth', { min: 320, max: 1080 }));
        const presetLabel = el('label', 'admin-hero-videos__field');
        presetLabel.append(el('span', null, 'Encoder preset'));
        const select = document.createElement('select');
        select.className = 'admin-search__input';
        select.dataset.presetField = 'encoderPreset';
        ['veryfast', 'fast', 'medium', 'slow', 'slower'].forEach((value) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = value;
            option.selected = (getPresetDraft().encoderPreset || 'slow') === value;
            select.append(option);
        });
        presetLabel.append(select);
        grid.append(presetLabel);
        panel.append(grid);
        const audioLabel = el('label', 'admin-hero-videos__check');
        const audio = document.createElement('input');
        audio.type = 'checkbox';
        audio.dataset.presetField = 'audio';
        audio.checked = getPresetDraft().audio === true;
        audio.disabled = state.presetSaving;
        audioLabel.append(audio, el('span', null, 'Enable audio in derivative output'));
        panel.append(audioLabel);
        if (state.presetStatus?.warnings?.length) {
            panel.append(el('p', 'admin-hero-videos__feature-warning', state.presetStatus.warnings.join(' ')));
        }
        const actions = el('div', 'admin-hero-videos__actions');
        const save = el('button', 'btn-action', state.presetSaving ? 'Saving preset...' : 'Save preset');
        save.type = 'button';
        save.dataset.action = 'save-preset';
        save.disabled = state.presetSaving;
        actions.append(save);
        panel.append(actions);
        return panel;
    }

    function renderCandidateBrowser() {
        const browser = el('section', 'admin-hero-videos__browser');
        browser.setAttribute('aria-labelledby', 'homepageHeroCandidatesTitle');
        const top = el('div', 'admin-hero-videos__section-top');
        top.append(el('h3', 'admin-hero-videos__section-title', 'Candidate Browser'));
        top.querySelector('h3').id = 'homepageHeroCandidatesTitle';
        const tabs = el('div', 'admin-hero-videos__tabs');
        tabs.setAttribute('role', 'tablist');
        tabs.setAttribute('aria-label', 'Hero video candidate sources');
        Object.entries(CANDIDATE_SOURCES).forEach(([source, label]) => {
            const btn = el('button', 'admin-hero-videos__tab', label);
            btn.type = 'button';
            btn.dataset.action = 'switch-source';
            btn.dataset.source = source;
            btn.setAttribute('role', 'tab');
            btn.setAttribute('aria-selected', state.currentSource === source ? 'true' : 'false');
            tabs.append(btn);
        });
        top.append(tabs);
        browser.append(top);
        browser.append(renderManualUploadPanel());

        const candidates = el('div', 'admin-hero-videos__candidate-grid');
        if (state.candidates.length) {
            state.candidates.forEach((candidate) => candidates.append(renderCandidateCard(candidate, state)));
        } else {
            candidates.append(el('div', 'admin-shell__empty', 'No video candidates found for this source.'));
        }
        browser.append(candidates);
        return browser;
    }

    function renderRecentConversionsPanel() {
        const panel = el('section', 'admin-hero-videos__recent');
        panel.setAttribute('aria-labelledby', 'homepageHeroRecentConversionsTitle');

        const top = el('div', 'admin-hero-videos__section-top');
        top.append(el('h3', 'admin-hero-videos__section-title', 'Recent conversions'));
        top.querySelector('h3').id = 'homepageHeroRecentConversionsTitle';
        const refresh = el('button', 'btn-action admin-hero-videos__button--ghost', 'Refresh conversions');
        refresh.type = 'button';
        refresh.dataset.action = 'refresh-derivatives';
        top.append(refresh);
        panel.append(top);
        panel.append(el('p', 'admin-shell__desc', 'Completed unassigned derivatives stay recoverable here after the external processor finishes.'));

        const grid = el('div', 'admin-hero-videos__candidate-grid admin-hero-videos__recent-grid');
        const derivatives = sortDerivativesForCurrentSelection(state.recentDerivatives || [], state);
        if (!derivatives.length) {
            grid.append(el('div', 'admin-shell__empty', 'No recent conversion jobs found yet.'));
        } else {
            derivatives.forEach((derivative) => {
                const card = el('article', 'admin-hero-videos__candidate-card admin-hero-videos__derivative-card');
                card.dataset.derivativeId = derivative.id;
                if (state.pendingDerivative?.id === derivative.id) {
                    card.classList.add('admin-hero-videos__candidate-card--selected');
                }
                const header = el('div', 'admin-hero-videos__card-top');
                const title = el('div');
                title.append(el('h4', 'admin-hero-videos__candidate-title', derivative.source_title || 'Untitled source'));
                title.append(el('p', 'admin-hero-videos__card-subtitle', `${SLOT_LABELS[derivative.slot] || derivative.slot} · ${derivative.provider || 'provider not recorded'}`));
                header.append(title);
                header.append(createStatusBadge(derivative.status || 'unknown'));
                card.append(header);

                const meta = el('div', 'admin-hero-videos__meta');
                meta.append(createMetaRow('Original size', formatBytes(derivative.original_size_bytes)));
                meta.append(createMetaRow('Derivative size', formatBytes(derivative.size_bytes)));
                meta.append(createMetaRow('Compression', formatCompressionRatio(derivative.original_size_bytes, derivative.size_bytes)));
                meta.append(createMetaRow('Updated', formatDateValue(derivative.completed_at || derivative.updated_at, formatDate)));
                meta.append(createMetaRow('Assignment', derivative.is_assigned ? `Assigned to ${SLOT_LABELS[derivative.assigned_slot] || derivative.assigned_slot}` : 'Unassigned'));
                if (derivative.status === 'failed' && derivative.error_message) {
                    meta.append(createMetaRow('Error', derivative.error_message));
                }
                card.append(meta);

                const actions = el('div', 'admin-hero-videos__actions');
                const select = el('button', 'btn-action admin-hero-videos__button--ghost', 'Select derivative');
                select.type = 'button';
                select.dataset.action = 'select-derivative';
                select.dataset.derivativeId = derivative.id;
                actions.append(select);

                const canAssign = derivative.status === 'succeeded'
                    && derivative.slot === state.selectedSlot
                    && !derivative.is_assigned;
                if (derivative.status === 'succeeded') {
                    const assign = el('button', 'btn-action', canAssign ? 'Assign this derivative' : (derivative.is_assigned ? `Assigned to ${SLOT_LABELS[derivative.assigned_slot] || derivative.assigned_slot}` : 'Select matching slot to assign'));
                    assign.type = 'button';
                    assign.dataset.action = 'assign-derivative';
                    assign.dataset.derivativeId = derivative.id;
                    assign.disabled = !canAssign;
                    actions.append(assign);
                }
                if (['queued', 'processing'].includes(String(derivative.status || '').toLowerCase())) {
                    const poll = el('button', 'btn-action admin-hero-videos__button--ghost', 'Check status');
                    poll.type = 'button';
                    poll.dataset.action = 'poll-derivative';
                    poll.dataset.derivativeId = derivative.id;
                    actions.append(poll);
                }
                if (derivative.status === 'failed') {
                    const retry = el('button', 'btn-action admin-hero-videos__button--ghost', 'Retry conversion');
                    retry.type = 'button';
                    retry.dataset.action = 'retry-derivative';
                    retry.dataset.derivativeId = derivative.id;
                    actions.append(retry);
                }
                card.append(actions);
                grid.append(card);
            });
        }
        panel.append(grid);
        return panel;
    }

    function renderManualUploadPanel() {
        return manualUpload.renderPanel();
    }

    function renderAssignmentPanel() {
        const panel = el('aside', 'admin-hero-videos__assign');
        panel.setAttribute('aria-labelledby', 'homepageHeroAssignmentTitle');
        panel.append(el('h3', 'admin-hero-videos__section-title', 'Conversion & Assignment'));
        panel.querySelector('h3').id = 'homepageHeroAssignmentTitle';

        const slot = selectedSlotRecord();
        panel.append(createMetaRow('Selected slot', SLOT_LABELS[state.selectedSlot] || state.selectedSlot));
        panel.append(createMetaRow('Selected source', state.selectedCandidate?.title || 'No candidate selected'));
        panel.append(createMetaRow('Source size', formatBytes(state.selectedCandidate?.size_bytes)));
        panel.append(createMetaRow('Pending derivative', state.pendingDerivative?.status || 'None'));
        panel.append(createMetaRow('Derivative size', formatBytes(state.pendingDerivative?.size_bytes || slot?.derivative?.size_bytes)));

        const providerLabel = el('label', 'admin-hero-videos__field');
        providerLabel.append(el('span', null, 'Conversion provider'));
        const provider = document.createElement('select');
        provider.className = 'admin-search__input';
        provider.dataset.field = 'provider';
        [
            ['external_ffmpeg', 'External FFmpeg'],
            ['cloudflare_stream', 'Cloudflare Stream'],
        ].forEach(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            option.selected = state.provider === value;
            provider.append(option);
        });
        providerLabel.append(provider);
        panel.append(providerLabel);

        const reasonLabel = el('label', 'admin-hero-videos__field');
        reasonLabel.append(el('span', null, 'Operator reason'));
        const reason = document.createElement('textarea');
        reason.className = 'admin-search__input admin-hero-videos__reason';
        reason.rows = 4;
        reason.maxLength = 500;
        reason.placeholder = 'Required for conversion, assignment, and disabling a slot.';
        reason.dataset.field = 'reason';
        reason.value = refs.container?.dataset.operatorReason || '';
        reasonLabel.append(reason);
        panel.append(reasonLabel);

        const actions = el('div', 'admin-hero-videos__actions admin-hero-videos__actions--stacked');
        const convertBtn = el('button', 'btn-action', 'Convert selected');
        convertBtn.type = 'button';
        convertBtn.dataset.action = 'convert';
        convertBtn.disabled = !state.selectedCandidate || !state.selectedSlot || (state.provider === 'external_ffmpeg' && !state.externalFfmpegEnabled);
        actions.append(convertBtn);

        const assignBtn = el('button', 'btn-action', 'Assign converted derivative');
        assignBtn.type = 'button';
        assignBtn.dataset.action = 'assign';
        assignBtn.disabled = !(state.pendingDerivative?.status === 'succeeded' && state.pendingDerivative?.slot === state.selectedSlot);
        actions.append(assignBtn);

        const saveBtn = el('button', 'btn-action admin-hero-videos__button--ghost', 'Save slot');
        saveBtn.type = 'button';
        saveBtn.dataset.action = 'save';
        saveBtn.disabled = assignBtn.disabled;
        actions.append(saveBtn);
        panel.append(actions);

        const note = el('p', 'admin-shell__desc', 'Conversion jobs never publish the original source video. Public slots serve only versioned optimized derivatives with audio removed.');
        panel.append(note);
        return panel;
    }

    function upsertRecentDerivative(derivative) {
        if (!derivative?.id) return;
        const next = state.recentDerivatives.filter((entry) => entry.id !== derivative.id);
        next.unshift(derivative);
        state.recentDerivatives = sortDerivativesForCurrentSelection(next.slice(0, 100), state);
    }

    function stopDerivativePolling() {
        if (state.derivativePollTimer) {
            window.clearInterval(state.derivativePollTimer);
            state.derivativePollTimer = 0;
        }
    }

    async function refreshDerivativeById(derivativeId, { render = true } = {}) {
        if (!derivativeId || state.derivativePollInFlight) return null;
        state.derivativePollInFlight = true;
        try {
            const res = await apiAdminHomepageHeroVideoDerivative(derivativeId);
            if (!res.ok) {
                setStatus(formatApiError?.(res, 'Derivative status could not be refreshed.') || res.error, 'error');
                return null;
            }
            const derivative = res.data?.data?.derivative || null;
            if (derivative) {
                upsertRecentDerivative(derivative);
                if (state.pendingDerivative?.id === derivative.id) {
                    state.pendingDerivative = derivative;
                    if (derivative.status === 'succeeded') {
                        setStatus('Conversion job succeeded. Assign it to the selected slot when ready.', 'success');
                    } else if (derivative.status === 'failed') {
                        setStatus('Conversion job failed. Review the error and retry if needed.', 'error');
                    } else {
                        setStatus(`Conversion job ${derivative.status || 'queued'}.`, 'neutral');
                    }
                }
                if (isDerivativeTerminal(derivative)) stopDerivativePolling();
            }
            return derivative;
        } finally {
            state.derivativePollInFlight = false;
            if (render) renderShell();
        }
    }

    function startDerivativePolling(derivativeId, { immediate = false } = {}) {
        if (!derivativeId) return;
        stopDerivativePolling();
        if (immediate) {
            refreshDerivativeById(derivativeId).catch((error) => {
                console.warn(error);
                setStatus('Derivative status could not be refreshed.', 'error');
                renderShell();
            });
        }
        state.derivativePollTimer = window.setInterval(() => {
            const section = refs.container?.closest('[hidden]');
            if (document.visibilityState === 'hidden' || section || !refs.container?.isConnected) return;
            refreshDerivativeById(derivativeId).catch((error) => {
                console.warn(error);
                setStatus('Derivative status could not be refreshed.', 'error');
                renderShell();
            });
        }, DERIVATIVE_POLL_INTERVAL_MS);
    }

    function findReusableDerivative() {
        if (!state.selectedCandidate || !state.selectedSlot) return null;
        const matching = state.recentDerivatives.filter((derivative) => (
            derivative.slot === state.selectedSlot
            && derivativeMatchesCandidate(derivative, state.selectedCandidate)
            && derivativeMatchesCurrentPreset(derivative, state.presetStatus)
            && !derivative.is_assigned
        ));
        return matching.find((derivative) => derivative.status === 'succeeded')
            || matching.find((derivative) => ['queued', 'processing'].includes(String(derivative.status || '').toLowerCase()))
            || null;
    }

    async function loadRecentDerivatives({ render = false } = {}) {
        const res = await apiAdminHomepageHeroVideoDerivatives({
            includeUnassigned: true,
            limit: 50,
        });
        if (!res.ok) {
            state.recentDerivatives = [];
            setStatus(formatApiError?.(res, 'Recent conversions could not be loaded.') || res.error, 'error');
            return;
        }
        state.recentDerivatives = Array.isArray(res.data?.data?.derivatives) ? res.data.data.derivatives : [];
        if (state.pendingDerivative?.id) {
            const match = state.recentDerivatives.find((entry) => entry.id === state.pendingDerivative.id);
            if (match) state.pendingDerivative = match;
            if (match && !isDerivativeTerminal(match)) startDerivativePolling(match.id);
        }
        if (render) renderShell();
    }

    async function loadCandidates(source = state.currentSource) {
        const res = await apiAdminHomepageHeroVideoCandidates(source, { limit: 24 });
        if (!res.ok) {
            state.candidates = [];
            setStatus(formatApiError?.(res, 'Hero video candidates could not be loaded.') || res.error, 'error');
            return;
        }
        state.currentSource = source;
        state.candidates = Array.isArray(res.data?.data?.candidates) ? res.data.data.candidates : [];
    }

    async function load() {
        if (!refs.container || state.loading) return;
        state.loading = true;
        renderShell();
        setStatus('Loading homepage hero videos...');
        try {
            const [config] = await Promise.all([
                apiAdminHomepageHeroVideos(),
                loadCandidates(state.currentSource),
                loadRecentDerivatives(),
            ]);
            if (!config.ok) {
                setStatus(formatApiError?.(config, 'Homepage hero video config could not be loaded.') || config.error, 'error');
                return;
            }
            state.slots = Array.isArray(config.data?.data?.slots) ? config.data.data.slots : [];
            syncFeatureState(config.data?.data || {});
            if (state.pendingDerivative?.id) {
                await refreshDerivativeById(state.pendingDerivative.id, { render: false });
            }
            setStatus('Homepage hero video configuration loaded.', 'success');
        } finally {
            state.loading = false;
            renderShell();
        }
    }

    function readReason() {
        const value = refs.container?.querySelector('[data-field="reason"]')?.value || '';
        if (refs.container) refs.container.dataset.operatorReason = value;
        return value.trim();
    }

    async function convertSelected() {
        if (!state.selectedCandidate || !state.selectedSlot) return;
        const reason = readReason();
        if (reason.length < 8) {
            setStatus('Enter an operator reason before converting.', 'error');
            return;
        }
        await loadRecentDerivatives();
        const reusable = findReusableDerivative();
        if (reusable) {
            state.pendingDerivative = reusable;
            upsertRecentDerivative(reusable);
            if (!isDerivativeTerminal(reusable)) {
                startDerivativePolling(reusable.id, { immediate: true });
            }
            const message = reusable.status === 'succeeded'
                ? 'Existing completed conversion selected. Assign it to the selected slot.'
                : `Existing ${reusable.status || 'queued'} conversion selected. Status polling is active.`;
            setStatus(message, reusable.status === 'succeeded' ? 'success' : 'neutral');
            showToast?.(message, reusable.status === 'succeeded' ? 'success' : 'info');
            renderShell();
            return;
        }
        setStatus('Creating conversion job...');
        const res = await apiAdminCreateHomepageHeroVideoDerivative({
            slot: state.selectedSlot,
            source_type: state.selectedCandidate.source_type,
            source_asset_id: state.selectedCandidate.source_asset_id,
            provider: state.provider,
            operator_reason: reason,
        }, {
            idempotencyKey: createAdminIdempotencyKey('homepage-hero-video-convert'),
        });
        if (!res.ok) {
            const message = formatApiError?.(res, 'Conversion job could not be created.') || res.error;
            setStatus(message, 'error');
            showToast?.(message, 'error');
            return;
        }
        state.pendingDerivative = res.data?.data?.derivative || null;
        upsertRecentDerivative(state.pendingDerivative);
        const status = state.pendingDerivative?.status || 'queued';
        setStatus(`Conversion job ${status}.`, status === 'succeeded' ? 'success' : 'neutral');
        showToast?.(`Hero video conversion job ${status}.`, status === 'succeeded' ? 'success' : 'info');
        if (state.pendingDerivative?.id && !isDerivativeTerminal(state.pendingDerivative)) {
            startDerivativePolling(state.pendingDerivative.id, { immediate: true });
        }
        await refreshConfigOnly();
    }

    async function runStreamPreviewProcessing() {
        if (state.streamBackfillBusy) return;
        const reason = readReason();
        if (reason.length < 8) {
            setStatus('Enter an operator reason before generating or repairing Stream previews.', 'error');
            return;
        }
        state.streamBackfillBusy = true;
        setStatus('Queuing previews and starting processor...');
        renderShell();
        const res = await apiAdminRunMemvidStreamPreviews({
            limit: 25,
            repair_limit: 100,
            operator_reason: reason,
        }, {
            idempotencyKey: createAdminIdempotencyKey('memvid-stream-preview-run'),
        });
        state.streamBackfillBusy = false;
        if (!res.ok) {
            const message = formatApiError?.(res, 'Stream preview processing could not be started.') || res.error;
            setStatus(message, 'error');
            showToast?.(message, 'error');
            renderShell();
            return;
        }
        const data = res.data?.data || {};
        const count = Number(data.queued_new_count ?? data.queued_count ?? 0);
        const repairCount = Number(data.queued_repair_count ?? data.repair_queued_count ?? 0);
        const started = data.dispatch_succeeded === true || data.processor_dispatch_started === true;
        const warnings = Array.isArray(res.data?.data?.warnings) ? res.data.data.warnings : [];
        const dispatchMessage = data.dispatch_message || warnings[0] || 'Automatic processor dispatch is not configured.';
        syncFeatureState(res.data?.data || {});
        state.streamPreviewProcessorDispatch = {
            ...(state.streamPreviewProcessorDispatch || {}),
            configured: data.dispatch_configured ?? data.processor_dispatch_configured ?? state.streamPreviewProcessorDispatch?.configured,
            provider: data.dispatch_provider ?? state.streamPreviewProcessorDispatch?.provider,
        };
        const message = started
            ? `Preview processing started. Queued ${count} new and ${repairCount} repair job${repairCount === 1 ? '' : 's'}.`
            : `Queued ${count} new and ${repairCount} repair job${repairCount === 1 ? '' : 's'}. ${dispatchMessage}`;
        setStatus(message, started ? 'success' : 'warning');
        showToast?.(started ? 'Preview processing started.' : 'Preview jobs queued; processor dispatch is not configured.', started ? 'success' : 'warning');
        await refreshConfigOnly();
    }

    async function assignDerivative(derivative = state.pendingDerivative) {
        if (!derivative || derivative.status !== 'succeeded') return;
        if (derivative.slot !== state.selectedSlot) {
            setStatus('Select the matching slot before assigning this derivative.', 'error');
            return;
        }
        const reason = readReason();
        if (reason.length < 8) {
            setStatus('Enter an operator reason before assigning a derivative.', 'error');
            return;
        }
        state.pendingDerivative = derivative;
        setStatus('Saving slot assignment...');
        const res = await apiAdminUpdateHomepageHeroVideoSlot(state.selectedSlot, {
            enabled: true,
            derivative_id: derivative.id,
            operator_reason: reason,
        }, {
            idempotencyKey: createAdminIdempotencyKey('homepage-hero-video-slot'),
        });
        if (!res.ok) {
            const message = formatApiError?.(res, 'Slot assignment could not be saved.') || res.error;
            setStatus(message, 'error');
            showToast?.(message, 'error');
            return;
        }
        state.slots = Array.isArray(res.data?.data?.slots) ? res.data.data.slots : state.slots;
        state.pendingDerivative = null;
        await loadRecentDerivatives();
        setStatus('Slot assignment saved.', 'success');
        showToast?.('Homepage hero video slot saved.', 'success');
        renderShell();
    }

    async function retryDerivative(derivativeId) {
        const reason = readReason();
        if (reason.length < 8) {
            setStatus('Enter an operator reason before retrying a derivative.', 'error');
            return;
        }
        setStatus('Retrying conversion job...');
        const res = await apiAdminRetryHomepageHeroVideoDerivative(derivativeId, {
            operator_reason: reason,
        }, {
            idempotencyKey: createAdminIdempotencyKey('homepage-hero-video-derivative-retry'),
        });
        if (!res.ok) {
            const message = formatApiError?.(res, 'Conversion retry could not be queued.') || res.error;
            setStatus(message, 'error');
            showToast?.(message, 'error');
            return;
        }
        const derivative = res.data?.data?.derivative || null;
        if (derivative) {
            state.pendingDerivative = derivative;
            upsertRecentDerivative(derivative);
            startDerivativePolling(derivative.id, { immediate: true });
        }
        setStatus('Conversion retry queued.', 'success');
        showToast?.('Conversion retry queued.', 'success');
        renderShell();
    }

    async function disableSlot(slotName) {
        const reason = readReason();
        if (reason.length < 8) {
            setStatus('Enter an operator reason before disabling a slot.', 'error');
            return;
        }
        const confirmed = window.confirm(`Disable ${SLOT_LABELS[slotName] || slotName}? The public homepage will use the Memvid fallback until all four slots are enabled.`);
        if (!confirmed) return;
        setStatus('Disabling slot...');
        const res = await apiAdminUpdateHomepageHeroVideoSlot(slotName, {
            enabled: false,
            operator_reason: reason,
        }, {
            idempotencyKey: createAdminIdempotencyKey('homepage-hero-video-disable'),
        });
        if (!res.ok) {
            const message = formatApiError?.(res, 'Slot could not be disabled.') || res.error;
            setStatus(message, 'error');
            showToast?.(message, 'error');
            return;
        }
        state.slots = Array.isArray(res.data?.data?.slots) ? res.data.data.slots : state.slots;
        setStatus('Slot disabled. Public homepage fallback remains available.', 'success');
        showToast?.('Homepage hero video slot disabled.', 'success');
        renderShell();
    }

    async function refreshConfigOnly() {
        const [res] = await Promise.all([
            apiAdminHomepageHeroVideos(),
            loadRecentDerivatives(),
        ]);
        if (res.ok) {
            state.slots = Array.isArray(res.data?.data?.slots) ? res.data.data.slots : state.slots;
            syncFeatureState(res.data?.data || {});
        }
        if (state.pendingDerivative?.id) {
            await refreshDerivativeById(state.pendingDerivative.id, { render: false });
        }
        renderShell();
    }

    async function toggleFeature(key, enabled) {
        const reason = readReason();
        if (reason.length < 8) {
            setStatus('Enter an operator reason before changing video delivery controls.', 'error');
            return;
        }
        state.savingFeatureKey = key;
        setStatus('Saving video delivery switch...');
        renderShell();
        const res = await apiAdminUpdateHomepageHeroVideoFeatureSwitch(key, {
            enabled,
            operator_reason: reason,
        }, {
            idempotencyKey: createAdminIdempotencyKey(`video-delivery-${key}`),
        });
        state.savingFeatureKey = '';
        if (!res.ok) {
            const message = formatApiError?.(res, 'Video delivery switch could not be saved.') || res.error;
            setStatus(message, 'error');
            showToast?.(message, 'error');
            renderShell();
            return;
        }
        syncFeatureState({
            feature_status: res.data?.data?.status,
        });
        const feature = res.data?.data?.feature;
        if (feature?.key === 'homepage_hero_manual_uploads') state.manualUploadsEnabled = feature.effective_enabled === true;
        if (feature?.key === 'homepage_hero_external_ffmpeg') state.externalFfmpegEnabled = feature.effective_enabled === true;
        setStatus('Video delivery switch saved.', 'success');
        showToast?.('Video delivery switch saved.', 'success');
        await refreshConfigOnly();
    }

    async function savePreset() {
        const reason = readReason();
        if (reason.length < 8) {
            setStatus('Enter an operator reason before saving the conversion preset.', 'error');
            return;
        }
        state.presetSaving = true;
        setStatus('Saving hero conversion preset...');
        renderShell();
        const res = await apiAdminUpdateHomepageHeroVideoPreset({
            preset: getPresetDraft(),
            operator_reason: reason,
        }, {
            idempotencyKey: createAdminIdempotencyKey('homepage-hero-ffmpeg-preset'),
        });
        state.presetSaving = false;
        if (!res.ok) {
            const message = formatApiError?.(res, 'Hero conversion preset could not be saved.') || res.error;
            setStatus(message, 'error');
            showToast?.(message, 'error');
            renderShell();
            return;
        }
        state.presetStatus = res.data?.data?.preset_status || state.presetStatus;
        state.presetDraft = state.presetStatus?.preset ? { ...state.presetStatus.preset } : state.presetDraft;
        setStatus('Hero conversion preset saved.', 'success');
        showToast?.('Hero conversion preset saved.', 'success');
        renderShell();
    }

    async function retryCandidatePoster(assetId) {
        const candidate = state.candidates.find((entry) => entry.source_asset_id === assetId && entry.source_type === 'admin_asset');
        if (!candidate || state.posterRetryAssetId) return;
        const reason = readReason();
        if (reason.length < 8) {
            setStatus('Enter an operator reason before retrying poster generation.', 'error');
            return;
        }
        state.posterRetryAssetId = assetId;
        setStatus('Queueing poster preview extraction...');
        renderShell();
        try {
            const res = await apiAdminRetryHomepageHeroVideoPoster(assetId, {
                operator_reason: reason,
            }, {
                idempotencyKey: createAdminIdempotencyKey('homepage-hero-video-poster'),
            });
            if (!res.ok) {
                const message = formatApiError?.(res, 'Poster preview could not be queued.') || res.error;
                setStatus(message, 'error');
                showToast?.(message, 'error');
                return;
            }
            await loadCandidates('admin-assets');
            state.selectedCandidate = state.candidates.find((entry) => entry.source_asset_id === assetId) || state.selectedCandidate;
            setStatus('Poster preview queued for processor extraction.', 'success');
            showToast?.('Poster preview queued.', 'success');
        } catch (error) {
            console.warn(error);
            setStatus('Poster preview could not be queued.', 'error');
            showToast?.('Poster preview could not be queued.', 'error');
        } finally {
            state.posterRetryAssetId = '';
            renderShell();
        }
    }

    function selectCandidate(assetId, sourceType) {
        state.selectedCandidate = state.candidates.find((candidate) => (
            candidate.source_asset_id === assetId && candidate.source_type === sourceType
        )) || null;
        state.pendingDerivative = null;
        renderShell();
    }

    function bind() {
        if (!refs.container || state.bound) return;
        state.bound = true;
        refs.container.addEventListener('click', (event) => {
            const target = event.target.closest('[data-action]');
            if (!target) return;
            const action = target.dataset.action;
            if (action === 'refresh') {
                load().catch((error) => {
                    console.warn(error);
                    setStatus('Homepage hero videos could not be refreshed.', 'error');
                });
            }
            if (action === 'select-slot') {
                state.selectedSlot = target.dataset.slot || state.selectedSlot;
                state.pendingDerivative = state.pendingDerivative?.slot === state.selectedSlot ? state.pendingDerivative : null;
                renderShell();
            }
            if (action === 'disable-slot') {
                disableSlot(target.dataset.slot).catch((error) => {
                    console.warn(error);
                    setStatus('Slot could not be disabled.', 'error');
                });
            }
            if (action === 'switch-source') {
                const source = target.dataset.source || 'public';
                state.selectedCandidate = null;
                state.pendingDerivative = null;
                loadCandidates(source)
                    .then(() => renderShell())
                    .catch((error) => {
                        console.warn(error);
                        setStatus('Hero video candidates could not be loaded.', 'error');
                    });
            }
            if (action === 'select-candidate') {
                selectCandidate(target.dataset.assetId, target.dataset.sourceType);
            }
            if (action === 'refresh-derivatives') {
                loadRecentDerivatives({ render: true }).catch((error) => {
                    console.warn(error);
                    setStatus('Recent conversions could not be refreshed.', 'error');
                });
            }
            if (action === 'select-derivative') {
                const derivative = state.recentDerivatives.find((entry) => entry.id === target.dataset.derivativeId) || null;
                state.pendingDerivative = derivative;
                if (derivative && !isDerivativeTerminal(derivative)) {
                    startDerivativePolling(derivative.id, { immediate: true });
                }
                renderShell();
            }
            if (action === 'assign-derivative') {
                const derivative = state.recentDerivatives.find((entry) => entry.id === target.dataset.derivativeId) || null;
                assignDerivative(derivative).catch((error) => {
                    console.warn(error);
                    setStatus('Slot assignment could not be saved.', 'error');
                });
            }
            if (action === 'poll-derivative') {
                const derivativeId = target.dataset.derivativeId;
                const derivative = state.recentDerivatives.find((entry) => entry.id === derivativeId) || null;
                state.pendingDerivative = derivative || state.pendingDerivative;
                startDerivativePolling(derivativeId, { immediate: true });
            }
            if (action === 'retry-derivative') {
                retryDerivative(target.dataset.derivativeId).catch((error) => {
                    console.warn(error);
                    setStatus('Conversion retry could not be queued.', 'error');
                });
            }
            if (action === 'retry-candidate-poster') {
                retryCandidatePoster(target.dataset.assetId).catch((error) => {
                    console.warn(error);
                    state.posterRetryAssetId = '';
                    setStatus('Poster preview could not be retried.', 'error');
                    renderShell();
                });
            }
            if (action === 'convert') {
                convertSelected().catch((error) => {
                    console.warn(error);
                    setStatus('Conversion job could not be created.', 'error');
                });
            }
            if (manualUpload.handleClick(event)) return;
            if (action === 'run-stream-preview-processing') {
                runStreamPreviewProcessing().catch((error) => {
                    console.warn(error);
                    state.streamBackfillBusy = false;
                    setStatus('Stream preview processing could not be started.', 'error');
                    renderShell();
                });
            }
            if (action === 'toggle-feature') {
                toggleFeature(target.dataset.feature, target.dataset.enabled === 'true').catch((error) => {
                    console.warn(error);
                    state.savingFeatureKey = '';
                    setStatus('Video delivery switch could not be saved.', 'error');
                    renderShell();
                });
            }
            if (action === 'save-preset') {
                savePreset().catch((error) => {
                    console.warn(error);
                    state.presetSaving = false;
                    setStatus('Hero conversion preset could not be saved.', 'error');
                    renderShell();
                });
            }
            if (action === 'assign' || action === 'save') {
                assignDerivative().catch((error) => {
                    console.warn(error);
                    setStatus('Slot assignment could not be saved.', 'error');
                });
            }
        });
        refs.container.addEventListener('change', (event) => {
            if (event.target?.dataset?.field === 'provider') {
                state.provider = event.target.value || 'external_ffmpeg';
            }
            if (manualUpload.handleChange(event)) return;
            if (event.target?.dataset?.presetField) {
                const draft = getPresetDraft();
                const field = event.target.dataset.presetField;
                draft[field] = event.target.type === 'checkbox'
                    ? event.target.checked
                    : event.target.value;
            }
        });
        refs.container.addEventListener('input', (event) => {
            if (event.target?.dataset?.field === 'reason' && refs.container) {
                refs.container.dataset.operatorReason = event.target.value || '';
            }
            if (manualUpload.handleInput(event)) return;
            if (event.target?.dataset?.presetField) {
                const draft = getPresetDraft();
                const field = event.target.dataset.presetField;
                draft[field] = event.target.type === 'number'
                    ? Number(event.target.value)
                    : event.target.value;
            }
        });
    }

    return {
        bind,
        load,
    };
}
