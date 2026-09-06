import {
    adminR2ObjectFileUrl,
    createAdminIdempotencyKey,
    apiAdminR2Buckets,
    apiAdminR2CopyObjects,
    apiAdminR2CreateFolder,
    apiAdminR2DeleteObjects,
    apiAdminR2MoveObjects,
    apiAdminR2ObjectDetail,
    apiAdminR2Objects,
    apiAdminR2UploadObject,
} from '../../../shared/auth-api.js?v=__ASSET_VERSION__';
import {
    addCell,
    badge,
    byId,
    clear,
    detailRows,
    el,
    renderUnavailable,
    shortId,
} from './core.js?v=__ASSET_VERSION__';

const DEFAULT_LIMIT = 100;
const DELETE_CONFIRMATION = 'DELETE R2 OBJECTS';

function formatBytes(value) {
    const bytes = Number(value || 0);
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let index = 0;
    while (size >= 1024 && index < units.length - 1) {
        size /= 1024;
        index += 1;
    }
    return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDate(value, formatDate) {
    if (!value) return '-';
    if (typeof formatDate === 'function') return formatDate(value);
    try {
        return new Intl.DateTimeFormat('en', {
            dateStyle: 'medium',
            timeStyle: 'short',
        }).format(new Date(value));
    } catch {
        return String(value);
    }
}

function normalizePrefix(value) {
    return String(value || '').replace(/^\/+/, '').replace(/\/{2,}/g, '/');
}

function dirname(key) {
    const clean = String(key || '').replace(/\/+$/, '');
    const index = clean.lastIndexOf('/');
    return index >= 0 ? `${clean.slice(0, index + 1)}` : '';
}

function itemId(item) {
    return `${item.type}:${item.key || item.prefix}`;
}

function itemPath(item) {
    return item.key || item.prefix || '';
}

function appLinkLabel(appLink) {
    if (appLink?.linked) return 'App-managed';
    if (appLink?.risk === 'audit-archive') return 'Audit archive';
    return 'Unlinked';
}

function appLinkVariant(appLink) {
    if (appLink?.linked) return 'disabled';
    if (appLink?.risk === 'audit-archive') return 'legacy';
    return 'active';
}

function createButton(label, className = 'btn-action', options = {}) {
    const button = el('button', className, label);
    button.type = 'button';
    if (options.id) button.id = options.id;
    if (options.ariaLabel) button.setAttribute('aria-label', options.ariaLabel);
    return button;
}

function promptReason(actionLabel) {
    const reason = window.prompt(`${actionLabel}\n\nEnter an operator reason. This is written to admin audit logs without raw object payloads.`);
    return reason ? reason.trim() : '';
}

function selectedObjects(state) {
    return state.items.filter((item) => item.type === 'object' && state.selected.has(itemId(item)));
}

function selectedItems(state) {
    return state.items.filter((item) => state.selected.has(itemId(item)));
}

function buildItemRefs(items) {
    return items
        .filter((item) => item.type === 'object')
        .map((item) => ({ bucket: item.bucket, key: item.key }));
}

function renderStatus(container, message, type = 'neutral') {
    if (!container) return;
    container.textContent = message || '';
    container.dataset.state = type;
}

function renderPreview(container, detail) {
    clear(container);
    const object = detail?.object;
    if (!object) {
        container.append(el('p', 'admin-shell__desc', 'Select an object to preview metadata and content.'));
        return;
    }
    const url = adminR2ObjectFileUrl({ bucket: object.bucket, key: object.key, download: false });
    const contentType = String(object.contentType || '').toLowerCase();
    const head = el('div', 'admin-r2-detail__head');
    head.append(el('h3', 'admin-section-title', object.name || 'Object detail'));
    head.append(badge(appLinkLabel(object.appLink), appLinkVariant(object.appLink)));
    container.append(head);

    const preview = el('div', 'admin-r2-preview');
    if (contentType.startsWith('image/')) {
        const img = document.createElement('img');
        img.src = url;
        img.alt = object.name || 'R2 object preview';
        preview.append(img);
    } else if (contentType.startsWith('video/')) {
        const video = document.createElement('video');
        video.src = url;
        video.controls = true;
        video.preload = 'metadata';
        preview.append(video);
    } else if (contentType.startsWith('audio/')) {
        const audio = document.createElement('audio');
        audio.src = url;
        audio.controls = true;
        preview.append(audio);
    } else if (contentType === 'application/pdf') {
        const iframe = document.createElement('iframe');
        iframe.src = url;
        iframe.title = object.name || 'R2 PDF preview';
        preview.append(iframe);
    } else {
        preview.append(el('p', 'admin-shell__desc', 'Preview is available through download for this object type.'));
    }
    container.append(preview);

    container.append(detailRows([
        ['Bucket', object.bucket],
        ['Raw key', object.key],
        ['Content type', object.contentType],
        ['Size', formatBytes(object.size)],
        ['Uploaded', formatDate(object.uploaded)],
        ['Owner label', object.owner?.label || 'Not mapped'],
        ['Canonical owner prefix', object.owner?.canonicalPrefix || '-'],
        ['App link', appLinkLabel(object.appLink)],
        ['Linked rows', object.appLink?.links?.length ? `${object.appLink.links.length}` : '0'],
    ]));

    const actions = el('div', 'admin-r2-detail__actions');
    const download = el('a', 'btn-action', 'Download');
    download.href = adminR2ObjectFileUrl({ bucket: object.bucket, key: object.key, download: true });
    download.rel = 'noopener';
    actions.append(download);
    const copyKey = createButton('Copy raw key', 'btn-secondary');
    copyKey.addEventListener('click', async () => {
        await navigator.clipboard?.writeText?.(object.key);
    });
    actions.append(copyKey);
    container.append(actions);

    if (object.appLink?.linked) {
        const warning = el('p', 'admin-r2-warning', 'This object is linked to BITBI application data. Raw R2 rename, move, or delete is blocked here to avoid broken database references.');
        container.append(warning);
    }
}

export function createObjectStorageDomain({ notify, formatDate: formatDateFn } = {}) {
    const state = {
        buckets: [],
        bucket: null,
        prefix: '',
        items: [],
        selected: new Set(),
        cursor: null,
        hasMore: false,
        search: '',
        clipboard: null,
        uploadMaxBytes: 0,
        uploading: false,
        loaded: false,
        bound: false,
        searchTimer: 0,
        listGeneration: 0,
        detailGeneration: 0,
        listing: false,
        detailLoading: false,
        mutation: null,
        intents: new Map(),
        active: true,
    };

    function context() {
        return JSON.stringify([state.bucket, state.prefix, state.search]);
    }

    function setActive(active) {
        state.active = active;
        if (!active) {
            window.clearTimeout(state.searchTimer);
            state.searchTimer = 0;
            state.detailLoading = false;
            state.listGeneration += 1;
            state.detailGeneration += 1;
            state.listing = false;
        }
    }

    // Retries retain the exact payload and key. A lost reply is never retried automatically.
    async function mutate(action, payload, request, onSuccess) {
        if (state.mutation) return;
        const signature = JSON.stringify([action, payload]);
        let intent = state.intents.get(signature);
        if (!intent) {
            intent = { key: createAdminIdempotencyKey(`admin-r2-${action}`), payload: structuredClone(payload) };
            state.intents.set(signature, intent);
        }
        const target = `${payload.targetBucket || payload.bucket || payload.sourceBucket}/${payload.targetPrefix || payload.prefix || ''}`;
        const origin = context();
        state.mutation = intent;
        updateToolbar();
        renderStatus(byId('objectStorageMutationResult'), `${action}: ${target} — waiting for confirmation.`);
        try {
            const response = await request(intent.payload, { idempotencyKey: intent.key });
            if (!response.ok) {
                const message = `${action}: ${target} — ${response.error || 'Request not confirmed.'} Verify the result before retrying this same intent.`;
                renderStatus(byId('objectStorageMutationResult'), message, 'error');
                notify?.(message, 'error');
                return;
            }
            const results = response.data?.data?.results || response.data?.results || [];
            const failed = results.filter((item) => !item.ok);
            const message = failed.length
                ? `${action}: ${target} — ${results.length - failed.length} confirmed, ${failed.length} blocked or failed. Review each object before another action.`
                : `${action}: ${target} — confirmed.`;
            renderStatus(byId('objectStorageMutationResult'), message, failed.length ? 'warning' : 'success');
            notify?.(message, failed.length ? 'warning' : 'success');
            if (!failed.length) {
                state.intents.delete(signature);
                onSuccess?.();
            }
            if (state.active && origin === context()) await loadObjects();
        } catch {
            renderStatus(byId('objectStorageMutationResult'), `${action}: ${target} — outcome unknown. Verify before retrying; the original request identity is retained.`, 'error');
        } finally {
            state.mutation = null;
            updateToolbar();
        }
    }

    function refs() {
        return {
            root: byId('objectStorageExplorer'),
            state: byId('objectStorageState'),
            bucketList: byId('objectStorageBucketList'),
            breadcrumb: byId('objectStorageBreadcrumbs'),
            table: byId('objectStorageTable'),
            detail: byId('objectStorageDetail'),
            search: byId('objectStorageSearch'),
            uploadInput: byId('objectStorageUploadInput'),
            clipboard: byId('objectStorageClipboard'),
        };
    }

    function updateToolbar() {
        const hasObjectSelection = selectedObjects(state).length > 0;
        const hasAnySelection = selectedItems(state).length > 0;
        const oneObject = selectedObjects(state).length === 1;
        for (const [id, enabled] of [
            ['objectStorageCopyBtn', hasObjectSelection],
            ['objectStorageCutBtn', hasObjectSelection],
            ['objectStoragePasteBtn', !!state.clipboard],
            ['objectStorageRenameBtn', oneObject],
            ['objectStorageDeleteBtn', hasObjectSelection],
            ['objectStorageDownloadBtn', oneObject],
            ['objectStorageDetailsBtn', hasAnySelection],
        ]) {
            const button = byId(id);
            if (button) button.disabled = !enabled || !!state.mutation;
        }
        for (const id of ['objectStorageNewFolderBtn']) {
            const button = byId(id);
            if (button) button.disabled = !!state.mutation || !state.bucket;
        }
        const more = byId('objectStorageLoadMoreBtn');
        if (more) { more.hidden = !state.hasMore; more.disabled = state.listing; }
        const clipboard = byId('objectStorageClipboard');
        if (clipboard) {
            clipboard.textContent = state.clipboard
                ? `${state.clipboard.mode === 'cut' ? 'Cut' : 'Copy'}: ${state.clipboard.items.length} object(s) from ${state.clipboard.bucket}`
                : 'Clipboard empty';
        }
    }

    function selectOnly(item) {
        state.selected.clear();
        state.selected.add(itemId(item));
        renderTable();
        updateToolbar();
    }

    async function openItem(item) {
        if (item.type === 'folder') {
            state.prefix = item.prefix;
            await loadObjects();
            return;
        }
        await showDetail(item);
    }

    async function showDetail(item) {
        if (!item || item.type !== 'object') return;
        const detail = refs().detail;
        if (!detail) return;
        const generation = ++state.detailGeneration;
        const origin = context();
        clear(detail);
        detail.append(el('p', 'admin-state', 'Loading object detail...'));
        state.detailLoading = true;
        const response = await apiAdminR2ObjectDetail({ bucket: item.bucket, key: item.key });
        if (generation !== state.detailGeneration || origin !== context() || !state.active) return;
        state.detailLoading = false;
        if (!response.ok) {
            renderUnavailable(detail, response, 'Object detail is unavailable.');
            return;
        }
        renderPreview(detail, response.data?.data || response.data);
    }

    function renderBuckets() {
        const list = refs().bucketList;
        if (!list) return;
        clear(list);
        for (const bucket of state.buckets) {
            const button = createButton(bucket.displayName || bucket.id, 'admin-r2-bucket');
            button.dataset.active = bucket.id === state.bucket ? 'true' : 'false';
            button.append(el('span', 'admin-r2-bucket__meta', bucket.id));
            button.addEventListener('click', async () => {
                state.bucket = bucket.id;
                state.prefix = '';
                state.selected.clear();
                await loadObjects();
            });
            list.append(button);
        }
    }

    function renderBreadcrumbs() {
        const container = refs().breadcrumb;
        if (!container) return;
        clear(container);
        const parts = [{ label: state.bucket || 'Bucket', prefix: '' }];
        let current = '';
        for (const part of state.prefix.split('/').filter(Boolean)) {
            current += `${part}/`;
            parts.push({ label: part, prefix: current });
        }
        parts.forEach((part, index) => {
            if (index > 0) container.append(el('span', 'admin-r2-breadcrumb__sep', '/'));
            const button = createButton(part.label, 'admin-r2-breadcrumb__button');
            button.addEventListener('click', async () => {
                state.prefix = part.prefix;
                state.selected.clear();
                await loadObjects();
            });
            container.append(button);
        });
    }

    function renderTable() {
        const tableContainer = refs().table;
        if (!tableContainer) return;
        clear(tableContainer);
        if (!state.items.length) {
            tableContainer.append(el('div', 'admin-shell__empty', state.search
                ? 'No objects or folders match the current search.'
                : 'This prefix is empty.'));
            return;
        }
        const wrap = el('div', 'admin-table-wrap admin-r2-table-wrap');
        wrap.tabIndex = 0;
        wrap.setAttribute('role', 'region');
        wrap.setAttribute('aria-label', 'R2 objects; scroll for more columns and actions');
        const table = el('table', 'admin-table admin-r2-table');
        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        ['', 'Name', 'Type', 'Size', 'Modified', 'Owner', 'App link', 'Actions'].forEach((label) => headRow.append(el('th', null, label)));
        thead.append(headRow);
        const tbody = document.createElement('tbody');
        for (const item of state.items) {
            const tr = document.createElement('tr');
            tr.dataset.selected = state.selected.has(itemId(item)) ? 'true' : 'false';
            const selectCell = document.createElement('td');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = state.selected.has(itemId(item));
            checkbox.setAttribute('aria-label', `Select ${item.name || itemPath(item)}`);
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) state.selected.add(itemId(item));
                else state.selected.delete(itemId(item));
                tr.dataset.selected = checkbox.checked ? 'true' : 'false';
                updateToolbar();
            });
            selectCell.append(checkbox);
            tr.append(selectCell);

            const nameButton = createButton(item.name || itemPath(item), 'admin-r2-name');
            nameButton.dataset.kind = item.type;
            nameButton.addEventListener('click', () => openItem(item));
            addCell(tr, nameButton);
            addCell(tr, item.type === 'folder' ? 'Folder' : item.contentType || 'Object');
            addCell(tr, item.type === 'folder' ? '-' : formatBytes(item.size));
            addCell(tr, item.type === 'folder' ? '-' : formatDate(item.uploaded || item.lastModified, formatDateFn));
            addCell(tr, item.owner?.label || '-');
            addCell(tr, item.type === 'folder' ? '-' : badge(appLinkLabel(item.appLink), appLinkVariant(item.appLink)));
            const actions = el('div', 'admin-r2-row-actions');
            const inspect = createButton('Details', 'btn-secondary');
            inspect.addEventListener('click', () => {
                selectOnly(item);
                if (item.type === 'object') showDetail(item);
            });
            actions.append(inspect);
            if (item.type === 'object') {
                const download = el('a', 'btn-secondary', 'Download');
                download.href = adminR2ObjectFileUrl({ bucket: item.bucket, key: item.key, download: true });
                actions.append(download);
            }
            addCell(tr, actions);
            tr.addEventListener('dblclick', () => openItem(item));
            tbody.append(tr);
        }
        table.append(thead, tbody);
        wrap.append(table);
        tableContainer.append(wrap);
        updateToolbar();
    }

    async function loadBuckets() {
        const generation = state.listGeneration;
        const response = await apiAdminR2Buckets();
        if (!state.active || generation !== state.listGeneration) return false;
        if (!response.ok) {
            renderStatus(refs().state, response.error || 'R2 bucket discovery failed.', 'error');
            return false;
        }
        const data = response.data?.data || response.data || {};
        state.buckets = data.buckets || [];
        state.uploadMaxBytes = data.uploadMaxBytes || 0;
        if (!state.bucket && state.buckets[0]) state.bucket = state.buckets[0].id;
        renderBuckets();
        if (data.unavailableBuckets?.length) {
            renderStatus(refs().state, `${state.buckets.length} bound bucket(s). PUBLIC_MEDIA is not exposed unless it is added as a Worker binding.`, 'warning');
        }
        return true;
    }

    async function loadObjects({ append = false } = {}) {
        if (!state.active) return;
        if (!state.bucket) {
            renderStatus(refs().state, 'No configured R2 bucket binding is available.', 'warning');
            return;
        }
        if (append && (state.listing || !state.hasMore || !state.cursor)) return;
        const origin = context();
        const generation = ++state.listGeneration;
        state.listing = true;
        if (!append) {
            state.items = [];
            state.selected.clear();
            state.cursor = null;
            state.hasMore = false;
            state.detailGeneration += 1;
            clear(refs().detail);
            clear(refs().table);
        }
        renderBuckets();
        renderBreadcrumbs();
        updateToolbar();
        renderStatus(refs().state, `Loading R2 objects in ${state.bucket}/${state.prefix}...`, 'neutral');
        try {
            const response = await apiAdminR2Objects({
                bucket: state.bucket, prefix: state.prefix, delimiter: '/', limit: DEFAULT_LIMIT,
                cursor: append ? state.cursor : null, search: state.search, includeLinked: true,
            });
            if (generation !== state.listGeneration || origin !== context() || !state.active) return;
            if (!response.ok) {
                renderStatus(refs().state, `${response.error || 'R2 listing failed.'} ${append ? 'Use Load more to retry this page.' : 'Use Refresh to retry this location.'}`, 'error');
                return;
            }
            const data = response.data?.data || response.data || {};
            state.cursor = data.cursor || null;
            state.hasMore = data.hasMore === true && !!state.cursor;
            const nextItems = [...(data.folders || []), ...(data.objects || [])];
            state.items = [...new Map([...(append ? state.items : []), ...nextItems].map(item => [itemId(item), item])).values()];
            renderTable();
            renderStatus(refs().state, `${state.items.length} item(s) shown in ${state.bucket}${state.prefix ? ` / ${state.prefix}` : ''}.${state.hasMore ? ' More results are available.' : ''}`, 'success');
        } catch {
            if (generation === state.listGeneration && origin === context()) renderStatus(refs().state, 'R2 listing failed. Retry this location.', 'error');
        } finally {
            if (generation === state.listGeneration) { state.listing = false; updateToolbar(); }
        }
    }

    async function createFolder() {
        const name = window.prompt('New folder name or prefix');
        if (!name) return;
        const reason = promptReason('Create R2 folder prefix');
        if (!reason) return;
        const prefix = `${state.prefix}${normalizePrefix(name).replace(/\/?$/, '/')}`;
        await mutate('folder', { bucket: state.bucket, prefix, reason }, apiAdminR2CreateFolder);
    }

    async function uploadFile() {
        refs().uploadInput?.click();
    }

    async function handleUploadFiles(files) {
        if (!files?.length || state.uploading) return;
        const batch = Array.from(files);
        const bucket = state.bucket;
        const prefix = state.prefix;
        const origin = context();
        const reason = promptReason(`Upload ${batch.length} file(s) to ${bucket}/${prefix}`);
        if (!reason) return;
        let succeeded = 0;
        let failed = 0;
        let unconfirmed = 0;
        let failure = '';
        state.uploading = true;
        byId('objectStorageUploadBtn').disabled = true;
        const result = byId('objectStorageUploadResult');
        renderStatus(result, `Uploading ${batch.length} file(s) to ${bucket}/${prefix}...`);
        try {
            for (const file of batch) {
                let response;
                try {
                    response = await apiAdminR2UploadObject({ bucket, prefix, file, reason, overwrite: false });
                } catch {
                    response = { ok: false, code: 'network_error' };
                }
                if (!response.ok) {
                    if (response.code === 'network_error' || response.status === 0) {
                        unconfirmed += 1;
                        failure = ` ${file.name}: Upload request failed; the object outcome is unknown. Verify the object before retrying.`;
                    } else {
                        failed += 1;
                        failure = ` ${file.name}: ${response.error || 'Upload failed.'}`;
                    }
                    break;
                }
                succeeded += 1;
            }
            const notAttempted = batch.length - succeeded - failed - unconfirmed;
            const message = `Upload result: ${succeeded} succeeded, ${failed} failed, ${notAttempted} not attempted${unconfirmed ? `, ${unconfirmed} unconfirmed` : ''}.${failure}`;
            const tone = failed || unconfirmed ? 'error' : 'success';
            renderStatus(result, message, tone);
            notify?.(message, tone);
            if (state.active && origin === context()) await loadObjects();
        } finally {
            state.uploading = false;
            byId('objectStorageUploadBtn').disabled = false;
        }
    }

    function copy(mode) {
        const objects = selectedObjects(state);
        if (!objects.length) return;
        state.clipboard = {
            mode,
            bucket: state.bucket,
            items: buildItemRefs(objects),
        };
        updateToolbar();
        notify?.(`${mode === 'cut' ? 'Cut' : 'Copy'} clipboard set for ${objects.length} object(s).`, 'success');
    }

    async function paste() {
        if (!state.clipboard || state.mutation) return;
        const clipboard = state.clipboard;
        const reason = promptReason(`${clipboard.mode === 'cut' ? 'Move' : 'Copy'} ${clipboard.items.length} object(s) into ${state.bucket}/${state.prefix}`);
        if (!reason) return;
        await mutate(clipboard.mode === 'cut' ? 'move' : 'copy', {
            sourceBucket: clipboard.bucket, targetBucket: state.bucket, targetPrefix: state.prefix,
            items: clipboard.items, reason,
        }, clipboard.mode === 'cut' ? apiAdminR2MoveObjects : apiAdminR2CopyObjects, () => {
            if (clipboard.mode === 'cut' && state.clipboard === clipboard) state.clipboard = null;
        });
    }

    async function renameSelected() {
        if (state.mutation) return;
        const object = selectedObjects(state)[0];
        if (!object) return;
        const nextName = window.prompt('New object name', object.name || '');
        if (!nextName) return;
        const reason = promptReason(`Rename R2 object: ${object.bucket}/${object.key}`);
        if (!reason) return;
        const targetKey = `${dirname(object.key)}${normalizePrefix(nextName)}`;
        await mutate('move', {
            sourceBucket: object.bucket, targetBucket: object.bucket,
            items: [{ key: object.key, targetKey }], reason,
        }, apiAdminR2MoveObjects);
    }

    async function deleteSelected() {
        if (state.mutation) return;
        const objects = selectedObjects(state);
        if (!objects.length) return;
        const bucket = state.bucket;
        const confirmation = window.prompt(`Delete ${objects.length} object(s) from ${bucket}?\n${objects.map(item => item.key).join('\n')}\n\nType ${DELETE_CONFIRMATION} to continue. DB-linked/app-managed objects are blocked server-side.`);
        if (confirmation !== DELETE_CONFIRMATION) return;
        const reason = promptReason('Delete R2 object(s)');
        if (!reason) return;
        await mutate('delete', { bucket, items: buildItemRefs(objects), reason, confirmation }, apiAdminR2DeleteObjects);
    }

    function downloadSelected() {
        const object = selectedObjects(state)[0];
        if (!object) return;
        window.open(adminR2ObjectFileUrl({ bucket: object.bucket, key: object.key, download: true }), '_blank', 'noopener');
    }

    async function detailsSelected() {
        const item = selectedItems(state)[0];
        if (!item) return;
        if (item.type === 'folder') {
            state.detailGeneration += 1;
            const detail = refs().detail;
            clear(detail);
            detail.append(detailRows([
                ['Folder prefix', item.prefix],
                ['Display label', item.owner?.label || item.name],
                ['Canonical owner prefix', item.owner?.canonicalPrefix || '-'],
            ]));
            return;
        }
        await showDetail(item);
    }

    function renderShell() {
        const root = refs().root;
        if (!root || root.dataset.rendered === '1') return;
        root.dataset.rendered = '1';
        root.className = 'admin-r2-explorer admin-control-stack';

        const hero = el('div', 'admin-control-hero');
        hero.append(el('div', 'admin-control-hero__eyebrow', 'System / R2 Drive'));
        hero.append(el('h2', 'admin-control-hero__title', 'R2 Object Storage'));
        hero.append(el('p', 'admin-control-hero__copy', 'Browse objects by bucket and prefix. Changes require a reason and target confirmation; linked objects remain protected.'));
        root.append(hero);

        const toolbar = el('div', 'admin-r2-toolbar admin-control-toolbar');
        [
            ['Refresh', 'objectStorageRefreshBtn'],
            ['Upload', 'objectStorageUploadBtn'],
            ['New folder', 'objectStorageNewFolderBtn'],
            ['Copy', 'objectStorageCopyBtn'],
            ['Cut', 'objectStorageCutBtn'],
            ['Paste', 'objectStoragePasteBtn'],
            ['Rename', 'objectStorageRenameBtn'],
            ['Delete', 'objectStorageDeleteBtn'],
            ['Download', 'objectStorageDownloadBtn'],
            ['Details', 'objectStorageDetailsBtn'],
        ].forEach(([label, id]) => toolbar.append(createButton(label, id === 'objectStorageDeleteBtn' ? 'btn-danger' : 'btn-action', { id })));
        const input = document.createElement('input');
        input.id = 'objectStorageUploadInput';
        input.type = 'file';
        input.multiple = true;
        input.hidden = true;
        toolbar.append(input);
        root.append(toolbar);

        const filter = el('div', 'admin-control-filter admin-r2-filter');
        const search = document.createElement('input');
        search.id = 'objectStorageSearch';
        search.className = 'admin-search__input';
        search.type = 'search';
        search.placeholder = 'Search keys, names, users, email, or prefix';
        search.setAttribute('aria-label', 'Search R2 objects in the current bucket and prefix');
        filter.append(search, el('span', 'admin-r2-clipboard', 'Clipboard empty'));
        filter.querySelector('.admin-r2-clipboard').id = 'objectStorageClipboard';
        root.append(filter);

        const stateLine = el('div', 'admin-state', 'R2 Explorer has not loaded yet.');
        stateLine.id = 'objectStorageState';
        stateLine.setAttribute('aria-live', 'polite');
        root.append(stateLine);
        const uploadResult = el('div', 'admin-state');
        uploadResult.id = 'objectStorageUploadResult';
        uploadResult.setAttribute('role', 'status');
        uploadResult.setAttribute('aria-live', 'polite');
        root.append(uploadResult);
        const mutationResult = el('div', 'admin-state');
        mutationResult.id = 'objectStorageMutationResult';
        mutationResult.setAttribute('role', 'status');
        root.append(mutationResult);

        const layout = el('div', 'admin-r2-layout');
        const sidebar = el('aside', 'admin-r2-sidebar');
        sidebar.append(el('h3', 'admin-section-title', 'Buckets'));
        const bucketList = el('div', 'admin-r2-buckets');
        bucketList.id = 'objectStorageBucketList';
        sidebar.append(bucketList);

        const main = el('section', 'admin-r2-main');
        const breadcrumbs = el('nav', 'admin-r2-breadcrumbs');
        breadcrumbs.id = 'objectStorageBreadcrumbs';
        breadcrumbs.setAttribute('aria-label', 'R2 breadcrumbs');
        const table = el('div', 'admin-r2-table-host');
        table.id = 'objectStorageTable';
        const more = createButton('Load more', 'btn-action', { id: 'objectStorageLoadMoreBtn' });
        more.hidden = true;
        more.addEventListener('click', () => loadObjects({ append: true }));
        main.append(breadcrumbs, table, more);

        const detail = el('aside', 'admin-r2-detail glass glass-card');
        detail.id = 'objectStorageDetail';
        detail.append(el('p', 'admin-shell__desc', 'Select an object to inspect metadata, app links, and preview/download options.'));
        layout.append(sidebar, main, detail);
        root.append(layout);
    }

    function bind() {
        renderShell();
        if (state.bound) return;
        state.bound = true;
        byId('objectStorageRefreshBtn')?.addEventListener('click', () => loadObjects());
        byId('objectStorageUploadBtn')?.addEventListener('click', uploadFile);
        byId('objectStorageNewFolderBtn')?.addEventListener('click', createFolder);
        byId('objectStorageCopyBtn')?.addEventListener('click', () => copy('copy'));
        byId('objectStorageCutBtn')?.addEventListener('click', () => copy('cut'));
        byId('objectStoragePasteBtn')?.addEventListener('click', paste);
        byId('objectStorageRenameBtn')?.addEventListener('click', renameSelected);
        byId('objectStorageDeleteBtn')?.addEventListener('click', deleteSelected);
        byId('objectStorageDownloadBtn')?.addEventListener('click', downloadSelected);
        byId('objectStorageDetailsBtn')?.addEventListener('click', detailsSelected);
        refs().uploadInput?.addEventListener('change', async (event) => {
            await handleUploadFiles(event.target.files);
            event.target.value = '';
        });
        refs().search?.addEventListener('input', () => {
            state.search = refs().search?.value || '';
            state.listGeneration += 1;
            state.detailGeneration += 1;
            state.selected.clear();
            state.hasMore = false;
            state.items = [];
            clear(refs().table);
            clear(refs().detail);
            updateToolbar();
            window.clearTimeout(state.searchTimer);
            state.searchTimer = window.setTimeout(async () => {
                state.searchTimer = 0;
                state.search = refs().search?.value || '';
                await loadObjects();
            }, 220);
        });
        updateToolbar();
    }

    async function loadObjectStorage() {
        if (!state.active) return;
        renderShell();
        bind();
        if (!state.loaded) {
            const generation = state.listGeneration;
            const loaded = await loadBuckets();
            if (!state.active || generation !== state.listGeneration) return;
            state.loaded = loaded;
            if (!state.loaded) return;
        }
        await loadObjects();
    }

    return {
        bind,
        setActive,
        needsReload: () => !state.loaded || state.listing || state.detailLoading || Boolean(state.searchTimer),
        loadObjectStorage,
    };
}
