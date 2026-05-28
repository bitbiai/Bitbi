import {
    apiAdminCreateHomepageHeroVideoDerivative,
    apiAdminHomepageHeroVideoCandidates,
    apiAdminHomepageHeroVideos,
    apiAdminUpdateHomepageHeroVideoSlot,
    createAdminIdempotencyKey,
} from '../../shared/auth-api.js?v=__ASSET_VERSION__';

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

function formatDate(value, formatDate) {
    if (!value) return 'Not recorded';
    try {
        return formatDate ? formatDate(value) : new Date(value).toLocaleString('en-GB');
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

function renderPreview({ fileUrl, posterUrl, title }) {
    const preview = el('div', 'admin-hero-videos__preview');
    if (fileUrl) {
        const video = document.createElement('video');
        video.className = 'admin-hero-videos__video';
        video.controls = true;
        video.muted = true;
        video.playsInline = true;
        video.preload = 'metadata';
        video.src = fileUrl;
        if (posterUrl) video.poster = posterUrl;
        preview.append(video);
        return preview;
    }
    if (posterUrl) {
        const image = document.createElement('img');
        image.className = 'admin-hero-videos__poster';
        image.alt = title || 'Hero video poster';
        image.loading = 'lazy';
        image.src = posterUrl;
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
    }));

    const body = el('div', 'admin-hero-videos__candidate-body');
    body.append(el('h3', 'admin-hero-videos__candidate-title', candidate.title || 'Untitled video'));
    body.append(createMetaRow('Source', candidate.source_type === 'public' ? 'Published video' : 'Admin asset'));
    body.append(createMetaRow('Original size', formatBytes(candidate.size_bytes)));
    body.append(createMetaRow('Duration', candidate.duration_seconds ? `${candidate.duration_seconds}s` : 'Not recorded'));
    const selectBtn = el('button', 'btn-action admin-hero-videos__button', 'Select');
    selectBtn.type = 'button';
    selectBtn.dataset.action = 'select-candidate';
    selectBtn.dataset.assetId = candidate.source_asset_id;
    selectBtn.dataset.sourceType = candidate.source_type;
    body.append(selectBtn);
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

    function selectedSlotRecord() {
        return state.slots.find((slot) => slot.slot === state.selectedSlot) || null;
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

        const grid = el('div', 'admin-hero-videos__slot-grid');
        const slotsByName = new Map(state.slots.map((slot) => [slot.slot, slot]));
        SLOT_ORDER.forEach((slotName) => {
            grid.append(renderSlotCard(slotsByName.get(slotName) || { slot: slotName, enabled: false }, state, formatDate));
        });
        shell.append(grid);

        const workbench = el('div', 'admin-hero-videos__workbench');
        workbench.append(renderCandidateBrowser());
        workbench.append(renderAssignmentPanel());
        shell.append(workbench);

        refs.container.append(shell);
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

        const candidates = el('div', 'admin-hero-videos__candidate-grid');
        if (state.candidates.length) {
            state.candidates.forEach((candidate) => candidates.append(renderCandidateCard(candidate, state)));
        } else {
            candidates.append(el('div', 'admin-shell__empty', 'No video candidates found for this source.'));
        }
        browser.append(candidates);
        return browser;
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
        convertBtn.disabled = !state.selectedCandidate || !state.selectedSlot;
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
            ]);
            if (!config.ok) {
                setStatus(formatApiError?.(config, 'Homepage hero video config could not be loaded.') || config.error, 'error');
                return;
            }
            state.slots = Array.isArray(config.data?.data?.slots) ? config.data.data.slots : [];
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
        const status = state.pendingDerivative?.status || 'queued';
        setStatus(`Conversion job ${status}.`, status === 'succeeded' ? 'success' : 'neutral');
        showToast?.(`Hero video conversion job ${status}.`, status === 'succeeded' ? 'success' : 'info');
        await refreshConfigOnly();
    }

    async function assignPending() {
        if (!state.pendingDerivative || state.pendingDerivative.status !== 'succeeded') return;
        const reason = readReason();
        if (reason.length < 8) {
            setStatus('Enter an operator reason before assigning a derivative.', 'error');
            return;
        }
        setStatus('Saving slot assignment...');
        const res = await apiAdminUpdateHomepageHeroVideoSlot(state.selectedSlot, {
            enabled: true,
            derivative_id: state.pendingDerivative.id,
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
        setStatus('Slot assignment saved.', 'success');
        showToast?.('Homepage hero video slot saved.', 'success');
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
        const res = await apiAdminHomepageHeroVideos();
        if (res.ok) {
            state.slots = Array.isArray(res.data?.data?.slots) ? res.data.data.slots : state.slots;
        }
        renderShell();
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
            if (action === 'convert') {
                convertSelected().catch((error) => {
                    console.warn(error);
                    setStatus('Conversion job could not be created.', 'error');
                });
            }
            if (action === 'assign' || action === 'save') {
                assignPending().catch((error) => {
                    console.warn(error);
                    setStatus('Slot assignment could not be saved.', 'error');
                });
            }
        });
        refs.container.addEventListener('change', (event) => {
            if (event.target?.dataset?.field === 'provider') {
                state.provider = event.target.value || 'external_ffmpeg';
            }
        });
        refs.container.addEventListener('input', (event) => {
            if (event.target?.dataset?.field === 'reason' && refs.container) {
                refs.container.dataset.operatorReason = event.target.value || '';
            }
        });
    }

    return {
        bind,
        load,
    };
}
