import {
    adminR2ObjectFileUrl,
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
        loaded: false,
        bound: false,
        searchTimer: 0,
    };

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
            if (button) button.disabled = !enabled;
        }
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
        clear(detail);
        detail.append(el('p', 'admin-state', 'Loading object detail...'));
        const response = await apiAdminR2ObjectDetail({ bucket: item.bucket, key: item.key });
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
                renderTable();
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
        const response = await apiAdminR2Buckets();
        if (!response.ok) {
            renderStatus(refs().state, response.error || 'R2 bucket discovery failed.', 'error');
            return;
        }
        const data = response.data?.data || response.data || {};
        state.buckets = data.buckets || [];
        state.uploadMaxBytes = data.uploadMaxBytes || 0;
        if (!state.bucket && state.buckets[0]) state.bucket = state.buckets[0].id;
        renderBuckets();
        if (data.unavailableBuckets?.length) {
            renderStatus(refs().state, `${state.buckets.length} bound bucket(s). PUBLIC_MEDIA is not exposed unless it is added as a Worker binding.`, 'warning');
        }
    }

    async function loadObjects({ append = false } = {}) {
        if (!state.bucket) {
            renderStatus(refs().state, 'No configured R2 bucket binding is available.', 'warning');
            return;
        }
        renderStatus(refs().state, 'Loading R2 objects...', 'neutral');
        const response = await apiAdminR2Objects({
            bucket: state.bucket,
            prefix: state.prefix,
            delimiter: '/',
            limit: DEFAULT_LIMIT,
            cursor: append ? state.cursor : null,
            search: state.search,
            includeLinked: true,
        });
        if (!response.ok) {
            renderStatus(refs().state, response.error || 'R2 listing failed.', 'error');
            return;
        }
        const data = response.data?.data || response.data || {};
        state.cursor = data.cursor || null;
        state.hasMore = data.hasMore === true;
        const nextItems = [...(data.folders || []), ...(data.objects || [])];
        state.items = append ? state.items.concat(nextItems) : nextItems;
        state.selected.clear();
        renderBuckets();
        renderBreadcrumbs();
        renderTable();
        renderStatus(refs().state, `${state.items.length} item(s) shown in ${state.bucket}${state.prefix ? ` / ${state.prefix}` : ''}.`, 'success');
    }

    async function createFolder() {
        const name = window.prompt('New folder name or prefix');
        if (!name) return;
        const reason = promptReason('Create R2 folder prefix');
        if (!reason) return;
        const prefix = `${state.prefix}${normalizePrefix(name).replace(/\/?$/, '/')}`;
        const response = await apiAdminR2CreateFolder({ bucket: state.bucket, prefix, reason });
        if (!response.ok) {
            notify?.(response.error || 'Folder creation failed.', 'error');
            return;
        }
        notify?.('Folder prefix created.', 'success');
        await loadObjects();
    }

    async function uploadFile() {
        refs().uploadInput?.click();
    }

    async function handleUploadFiles(files) {
        if (!files?.length) return;
        const reason = promptReason(`Upload ${files.length} file(s) to ${state.bucket}/${state.prefix}`);
        if (!reason) return;
        for (const file of Array.from(files)) {
            const response = await apiAdminR2UploadObject({
                bucket: state.bucket,
                prefix: state.prefix,
                file,
                reason,
                overwrite: false,
            });
            if (!response.ok) {
                notify?.(response.error || `Upload failed for ${file.name}.`, 'error');
                break;
            }
        }
        notify?.('Upload completed.', 'success');
        await loadObjects();
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
        if (!state.clipboard) return;
        const reason = promptReason(`${state.clipboard.mode === 'cut' ? 'Move' : 'Copy'} ${state.clipboard.items.length} object(s) into ${state.bucket}/${state.prefix}`);
        if (!reason) return;
        const payload = {
            sourceBucket: state.clipboard.bucket,
            targetBucket: state.bucket,
            targetPrefix: state.prefix,
            items: state.clipboard.items,
            reason,
        };
        const response = state.clipboard.mode === 'cut'
            ? await apiAdminR2MoveObjects(payload)
            : await apiAdminR2CopyObjects(payload);
        if (!response.ok) {
            notify?.(response.error || 'Paste failed.', 'error');
            return;
        }
        const results = response.data?.data?.results || [];
        const failed = results.filter((item) => !item.ok);
        if (failed.length) notify?.(`${failed.length} item(s) were blocked or failed. Open Details for app-managed objects before changing raw keys.`, 'warning');
        else notify?.('Paste completed.', 'success');
        if (state.clipboard.mode === 'cut') state.clipboard = null;
        await loadObjects();
    }

    async function renameSelected() {
        const object = selectedObjects(state)[0];
        if (!object) return;
        const nextName = window.prompt('New object name', object.name || '');
        if (!nextName) return;
        const reason = promptReason('Rename R2 object');
        if (!reason) return;
        const targetKey = `${dirname(object.key)}${normalizePrefix(nextName)}`;
        const response = await apiAdminR2MoveObjects({
            sourceBucket: state.bucket,
            targetBucket: state.bucket,
            items: [{ key: object.key, targetKey }],
            reason,
        });
        if (!response.ok) {
            notify?.(response.error || 'Rename failed.', 'error');
            return;
        }
        const failed = (response.data?.data?.results || []).filter((item) => !item.ok);
        notify?.(failed.length ? failed[0].error || 'Rename blocked.' : 'Object renamed.', failed.length ? 'warning' : 'success');
        await loadObjects();
    }

    async function deleteSelected() {
        const objects = selectedObjects(state);
        if (!objects.length) return;
        const confirmation = window.prompt(`Delete ${objects.length} object(s) from ${state.bucket}?\n\nType ${DELETE_CONFIRMATION} to continue. DB-linked/app-managed objects are blocked server-side.`);
        if (confirmation !== DELETE_CONFIRMATION) return;
        const reason = promptReason('Delete R2 object(s)');
        if (!reason) return;
        const response = await apiAdminR2DeleteObjects({
            bucket: state.bucket,
            items: buildItemRefs(objects),
            reason,
            confirmation,
        });
        if (!response.ok) {
            notify?.(response.error || 'Delete failed.', 'error');
            return;
        }
        const results = response.data?.data?.results || [];
        const failed = results.filter((item) => !item.ok);
        notify?.(failed.length ? `${failed.length} delete item(s) were blocked or failed.` : 'Object(s) deleted.', failed.length ? 'warning' : 'success');
        await loadObjects();
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
        hero.append(el('p', 'admin-control-hero__copy', 'Browse configured Cloudflare R2 buckets like a drive. Mutations stay behind Admin/MFA, same-origin requests, idempotency, reason capture, and audit logging. DB-linked objects are detected and protected from unsafe raw key changes.'));
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
        filter.append(search, el('span', 'admin-r2-clipboard', 'Clipboard empty'));
        filter.querySelector('.admin-r2-clipboard').id = 'objectStorageClipboard';
        root.append(filter);

        const stateLine = el('div', 'admin-state', 'R2 Explorer has not loaded yet.');
        stateLine.id = 'objectStorageState';
        stateLine.setAttribute('aria-live', 'polite');
        root.append(stateLine);

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
        main.append(breadcrumbs, table);

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
            window.clearTimeout(state.searchTimer);
            state.searchTimer = window.setTimeout(async () => {
                state.search = refs().search?.value || '';
                await loadObjects();
            }, 220);
        });
        updateToolbar();
    }

    async function loadObjectStorage() {
        renderShell();
        bind();
        if (!state.loaded) {
            state.loaded = true;
            await loadBuckets();
        }
        await loadObjects();
    }

    return {
        bind,
        loadObjectStorage,
    };
}
