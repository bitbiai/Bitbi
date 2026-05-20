import {
    apiAdminDeleteUserAsset,
    apiAdminDeleteUserFolder,
    apiAdminMoveUserAsset,
    apiAdminRenameUserAsset,
    apiAdminRenameUserFolder,
    apiAdminSetUserAssetVisibility,
    apiAdminUserStorage,
    apiAdminUserStorageReconciliation,
    createAdminIdempotencyKey,
} from '../../shared/auth-api.js?v=__ASSET_VERSION__';
import {
    formatAssetStorageUsage,
    formatStorageBytes,
} from '../../shared/storage-format.js?v=__ASSET_VERSION__';
import {
    focusElementSafely,
    renderRiskNote,
} from './ui.js?v=__ASSET_VERSION__';

const numberFormatter = new Intl.NumberFormat('en-US');

function appendTextCell(row, value, className = '') {
    const cell = document.createElement('td');
    if (className) cell.className = className;
    cell.textContent = value;
    row.appendChild(cell);
    return cell;
}

export function createAdminUserStorage({
    showToast,
    formatDate,
    createBadge,
    createActionBtn,
    createUserIdMeta,
    shortUserId,
    renderInfoUserIdentity,
    userCreditState,
} = {}) {
    const refs = {
        modal: document.getElementById('userStorageModal'),
        title: document.getElementById('userStorageModalTitle'),
        subtitle: document.getElementById('userStorageModalSubtitle'),
        body: document.getElementById('userStorageModalBody'),
    };
    let storageModalState = {
        user: null,
        folders: [],
        assets: [],
        summary: {},
        storageUsage: null,
        reconciliation: null,
        nextCursor: null,
        hasMore: false,
    };

    function syncBodyLock() {
        const hasOpenModal = [
            document.getElementById('userCreditModal'),
            document.getElementById('userInfoModal'),
            refs.modal,
        ].some((modal) => modal && !modal.hidden);
        document.body.classList.toggle('modal-open', hasOpenModal);
    }

    function setModalOpen(open) {
        if (!refs.modal) return;
        refs.modal.hidden = !open;
        refs.modal.setAttribute('aria-hidden', open ? 'false' : 'true');
        syncBodyLock();
    }

    function close() {
        setModalOpen(false);
    }

    function resetState(user) {
        storageModalState = {
            user,
            folders: [],
            assets: [],
            summary: {},
            storageUsage: null,
            reconciliation: null,
            nextCursor: null,
            hasMore: false,
        };
    }

    function getAssetDisplayName(asset = {}) {
        return asset.title || asset.prompt || asset.file_name || asset.id || 'Untitled asset';
    }

    function getAssetTypeLabel(asset = {}) {
        if (asset.asset_type === 'image') return 'Image';
        if (asset.asset_type === 'sound') return 'Audio';
        if (asset.asset_type === 'video') return 'Video';
        if (asset.mime_type) return asset.mime_type;
        return asset.asset_type || 'File';
    }

    function getAssetStorageSize(asset = {}) {
        return Number(asset.size_bytes || 0) + Number(asset.poster_size_bytes || 0);
    }

    function findFolderName(folderId, folders = []) {
        if (!folderId) return 'Unfoldered';
        return folders.find((folder) => folder.id === folderId)?.name || shortUserId(folderId);
    }

    function metric(label, value) {
        const card = document.createElement('article');
        card.className = 'admin-credit-modal__metric';
        const labelEl = document.createElement('span');
        labelEl.className = 'admin-credit-modal__metric-label';
        labelEl.textContent = label;
        const valueEl = document.createElement('strong');
        valueEl.className = 'admin-credit-modal__metric-value';
        valueEl.textContent = value;
        card.append(labelEl, valueEl);
        return card;
    }

    function sectionNote(text) {
        const note = document.createElement('p');
        note.className = 'admin-credit-modal__muted admin-usage-modal__section-note';
        note.textContent = text;
        return note;
    }

    function renderStorageMetrics(payload = {}) {
        const metrics = document.createElement('div');
        metrics.className = 'admin-credit-modal__metrics admin-usage-modal__metrics';
        const storageText = formatAssetStorageUsage(payload.storageUsage) || 'Storage unavailable';
        const remaining = !payload.storageUsage
            ? 'Unavailable'
            : payload.storageUsage?.isUnlimited
                ? 'Unlimited'
                : formatStorageBytes(payload.storageUsage?.remainingBytes);
        metrics.append(
            metric('Storage', storageText),
            metric('Remaining', remaining),
            metric('Assets', numberFormatter.format(Number(payload.summary?.assetCount || 0))),
            metric('Folders', numberFormatter.format(Number(payload.summary?.folderCount || 0))),
        );
        return metrics;
    }

    function renderStorageReconciliationDetails(reconciliation) {
        const section = document.createElement('section');
        section.className = 'admin-credit-modal__section admin-usage-modal__section';
        const heading = document.createElement('h4');
        heading.textContent = 'Storage reconciliation dry-run';
        section.appendChild(heading);

        if (!reconciliation) {
            const action = createActionBtn('Run D1 metadata reconciliation', () => loadReconciliation(storageModalState.user));
            section.appendChild(action);
            const note = document.createElement('p');
            note.className = 'admin-credit-modal__muted';
            note.textContent = 'Read-only D1 metadata check. It does not list R2, repair quota counters, backfill ownership, switch access checks, or prove tenant isolation.';
            section.appendChild(note);
            return section;
        }

        const metrics = document.createElement('div');
        metrics.className = 'admin-credit-modal__metrics admin-usage-modal__metrics';
        metrics.append(
            metric('Recommendation', String(reconciliation.recommendation || 'needs_review')),
            metric('Recorded usage', formatStorageBytes(reconciliation.recordedUsageBytes)),
            metric('Known asset bytes', formatStorageBytes(reconciliation.knownAssetBytes)),
            metric('Delta', reconciliation.deltaBytes === null ? 'Unavailable' : formatStorageBytes(reconciliation.deltaBytes)),
            metric('Missing byte rows', numberFormatter.format(Number(reconciliation.missingByteMetadataCount || 0))),
            metric('Orphan metadata rows', numberFormatter.format(Number(reconciliation.orphanMetadataCount || 0))),
        );
        section.appendChild(metrics);
        const note = document.createElement('p');
        note.className = 'admin-credit-modal__muted';
        note.textContent = 'D1 metadata only. No live R2 listing, no quota repair, no ownership backfill, no access-switching, and no tenant isolation claim.';
        section.appendChild(note);
        const action = createActionBtn('Refresh reconciliation dry-run', () => loadReconciliation(storageModalState.user));
        section.appendChild(action);
        return section;
    }

    function renderFolderActions(user, folder) {
        const wrap = document.createElement('div');
        wrap.className = 'admin-usage-modal__action-row';
        wrap.append(
            createActionBtn('Rename', () => handleRenameFolder(user, folder)),
            createActionBtn('Delete', () => handleDeleteFolder(user, folder), true),
        );
        return wrap;
    }

    function renderFoldersTable(user, folders = []) {
        const section = document.createElement('section');
        section.className = 'admin-usage-modal__section';
        const title = document.createElement('h3');
        title.className = 'admin-credit-modal__section-title';
        title.textContent = 'Folders';
        section.appendChild(title);
        section.appendChild(sectionNote('Folder rename/delete actions are scoped to this selected user. Folder delete requires browser confirmation, an operator reason, and a generated Idempotency-Key.'));

        const wrap = document.createElement('div');
        wrap.className = 'admin-credit-modal__table-wrap admin-usage-modal__table-wrap';
        const table = document.createElement('table');
        table.className = 'admin-table admin-usage-modal__table';
        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        ['Name', 'Folder ID', 'Files', 'Size', 'Created', 'Actions'].forEach((heading) => {
            const th = document.createElement('th');
            th.textContent = heading;
            headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        if (!folders.length) {
            const row = document.createElement('tr');
            const cell = appendTextCell(row, 'No folders for this user.', 'admin-credit-modal__empty-cell');
            cell.colSpan = 6;
            tbody.appendChild(row);
        } else {
            for (const folder of folders) {
                const row = document.createElement('tr');
                appendTextCell(row, folder.name || 'Untitled folder');
                const idCell = appendTextCell(row, '');
                idCell.appendChild(createUserIdMeta(folder.id, { compact: true }));
                appendTextCell(row, numberFormatter.format(Number(folder.file_count || 0)));
                appendTextCell(row, formatStorageBytes(folder.size_bytes));
                appendTextCell(row, formatDate(folder.created_at));
                const actionCell = document.createElement('td');
                actionCell.appendChild(renderFolderActions(user, folder));
                row.appendChild(actionCell);
                tbody.appendChild(row);
            }
        }
        table.appendChild(tbody);
        wrap.appendChild(table);
        section.appendChild(wrap);
        return section;
    }

    function buildAssetFolderSelect(user, asset) {
        const select = document.createElement('select');
        select.className = 'admin-usage-modal__folder-select';
        select.setAttribute('aria-label', `Move ${getAssetDisplayName(asset)} to folder`);

        const unfoldered = document.createElement('option');
        unfoldered.value = '';
        unfoldered.textContent = 'Unfoldered';
        select.appendChild(unfoldered);

        for (const folder of storageModalState.folders) {
            const option = document.createElement('option');
            option.value = folder.id;
            option.textContent = folder.name || folder.id;
            select.appendChild(option);
        }
        select.value = asset.folder_id || '';
        select.addEventListener('change', () => handleMoveAsset(user, asset, select.value || null));
        return select;
    }

    function renderAssetActions(user, asset) {
        const wrap = document.createElement('div');
        wrap.className = 'admin-usage-modal__action-row';

        const open = document.createElement('a');
        open.className = 'btn-action';
        open.href = asset.file_url || '#';
        open.target = '_blank';
        open.rel = 'noopener noreferrer';
        open.textContent = 'Open';

        const nextVisibility = asset.visibility === 'public' ? 'private' : 'public';
        wrap.append(
            open,
            createActionBtn('Rename', () => handleRenameAsset(user, asset)),
            createActionBtn(nextVisibility === 'public' ? 'Make Public' : 'Make Private', () => handleSetAssetVisibility(user, asset, nextVisibility)),
            buildAssetFolderSelect(user, asset),
            createActionBtn('Delete', () => handleDeleteAsset(user, asset), true),
        );
        return wrap;
    }

    function renderAssetsTable(user, assets = []) {
        const section = document.createElement('section');
        section.className = 'admin-usage-modal__section';
        const header = document.createElement('div');
        header.className = 'admin-usage-modal__section-header';
        const title = document.createElement('h3');
        title.className = 'admin-credit-modal__section-title';
        title.textContent = 'Files and assets';
        header.appendChild(title);
        section.appendChild(header);
        section.appendChild(sectionNote('Asset rename, move, visibility, and delete actions apply only to this selected user. Delete requires confirmation, an operator reason, and idempotency; raw private R2 keys are never displayed.'));

        const wrap = document.createElement('div');
        wrap.className = 'admin-credit-modal__table-wrap admin-usage-modal__table-wrap';
        const table = document.createElement('table');
        table.className = 'admin-table admin-usage-modal__table admin-usage-modal__table--assets';
        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        ['Name', 'Type', 'Size', 'Folder', 'Visibility', 'Created', 'Asset ID', 'Actions'].forEach((heading) => {
            const th = document.createElement('th');
            th.textContent = heading;
            headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        if (!assets.length) {
            const row = document.createElement('tr');
            const cell = appendTextCell(row, 'No Assets Manager files for this user.', 'admin-credit-modal__empty-cell');
            cell.colSpan = 8;
            tbody.appendChild(row);
        } else {
            for (const asset of assets) {
                const row = document.createElement('tr');
                appendTextCell(row, getAssetDisplayName(asset), 'admin-usage-modal__asset-name');
                appendTextCell(row, getAssetTypeLabel(asset));
                appendTextCell(row, formatStorageBytes(getAssetStorageSize(asset)));
                appendTextCell(row, findFolderName(asset.folder_id, storageModalState.folders));
                const visibilityCell = document.createElement('td');
                visibilityCell.appendChild(createBadge(asset.visibility || 'private', asset.visibility === 'public' ? 'active' : 'admin'));
                row.appendChild(visibilityCell);
                appendTextCell(row, formatDate(asset.created_at));
                const idCell = appendTextCell(row, '');
                idCell.appendChild(createUserIdMeta(asset.id, { compact: true }));
                const actionCell = document.createElement('td');
                actionCell.appendChild(renderAssetActions(user, asset));
                row.appendChild(actionCell);
                tbody.appendChild(row);
            }
        }
        table.appendChild(tbody);
        wrap.appendChild(table);
        section.appendChild(wrap);

        if (storageModalState.hasMore) {
            const loadMore = createActionBtn('Load more assets', () => loadDetails(user, { append: true }));
            loadMore.classList.add('admin-usage-modal__load-more');
            section.appendChild(loadMore);
        }
        return section;
    }

    function renderDetails(payload = {}) {
        if (!refs.body) return;
        const user = payload.user || storageModalState.user || {};
        refs.body.textContent = '';
        refs.body.appendChild(renderInfoUserIdentity(user));
        refs.body.appendChild(renderStorageMetrics(payload));

        const note = document.createElement('div');
        note.className = 'admin-credit-modal__topup admin-usage-modal__note';
        note.textContent = payload.storageUsage?.isUnlimited
            ? 'This user has unlimited Assets Manager storage because the account is an admin.'
            : 'Storage usage is calculated from active Assets Manager files owned by this user.';
        refs.body.appendChild(note);
        refs.body.appendChild(renderRiskNote(
            'Mutation controls below are scoped to this selected user. Delete actions require browser confirmation, an operator reason, and a generated Idempotency-Key. This overlay never lists live R2 or renders raw private R2 keys.',
            { title: 'Storage mutation safety', className: 'admin-usage-modal__risk-note' }
        ));

        refs.body.appendChild(renderStorageReconciliationDetails(storageModalState.reconciliation));
        refs.body.appendChild(renderFoldersTable(user, payload.folders || []));
        refs.body.appendChild(renderAssetsTable(user, storageModalState.assets || []));
    }

    async function loadReconciliation(user) {
        if (!user?.id) return;
        const res = await apiAdminUserStorageReconciliation(user.id);
        if (!res.ok) {
            showToast(res.error || 'Could not run storage reconciliation.', 'error');
            return;
        }
        storageModalState = {
            ...storageModalState,
            reconciliation: res.data?.data?.reconciliation || res.data?.reconciliation || null,
        };
        renderDetails({
            user: storageModalState.user,
            folders: storageModalState.folders,
            summary: storageModalState.summary,
            storageUsage: storageModalState.storageUsage,
        });
    }

    async function loadDetails(user, { append = false } = {}) {
        if (!append) {
            resetState(user);
            if (refs.body) {
                refs.body.textContent = '';
                refs.body.appendChild(userCreditState('Loading storage usage...'));
            }
        }
        const res = await apiAdminUserStorage(user.id, {
            limit: 100,
            cursor: append ? storageModalState.nextCursor : undefined,
        });
        if (!res.ok) {
            if (refs.body) {
                refs.body.textContent = '';
                refs.body.appendChild(userCreditState(res.error || 'Could not load storage usage.', 'error'));
            }
            return;
        }
        const payload = res.data?.data || res.data || {};
        storageModalState = {
            user: payload.user || user,
            folders: Array.isArray(payload.folders) ? payload.folders : [],
            assets: append
                ? storageModalState.assets.concat(Array.isArray(payload.assets) ? payload.assets : [])
                : (Array.isArray(payload.assets) ? payload.assets : []),
            summary: payload.summary || {},
            storageUsage: payload.storageUsage || null,
            reconciliation: append ? storageModalState.reconciliation : null,
            nextCursor: typeof payload.next_cursor === 'string' ? payload.next_cursor : null,
            hasMore: payload.has_more === true,
        };
        renderDetails({
            ...payload,
            user: storageModalState.user,
            folders: storageModalState.folders,
            summary: storageModalState.summary,
            storageUsage: storageModalState.storageUsage,
        });
    }

    async function open(user) {
        if (!refs.modal || !refs.body) return;
        if (refs.title) refs.title.textContent = 'Usage';
        if (refs.subtitle) refs.subtitle.textContent = `${user.email || 'Selected user'} • ${shortUserId(user.id)}`;
        setModalOpen(true);
        focusElementSafely(refs.modal.querySelector('button[data-user-storage-close]'));
        await loadDetails(user);
    }

    async function refreshOpenDetails() {
        if (!storageModalState.user || !refs.modal || refs.modal.hidden) return;
        await loadDetails(storageModalState.user);
    }

    async function handleRenameAsset(user, asset) {
        const currentName = getAssetDisplayName(asset);
        const name = prompt('Rename asset', currentName);
        if (name === null) return;
        const trimmed = name.trim();
        if (!trimmed || trimmed === currentName) return;
        const res = await apiAdminRenameUserAsset(user.id, asset.id, trimmed);
        if (res.ok) {
            showToast('Asset renamed.', 'success');
            await refreshOpenDetails();
        } else {
            showToast(res.error, 'error');
        }
    }

    async function handleMoveAsset(user, asset, folderId) {
        const res = await apiAdminMoveUserAsset(user.id, asset.id, folderId);
        if (res.ok) {
            showToast('Asset moved.', 'success');
            await refreshOpenDetails();
        } else {
            showToast(res.error, 'error');
            await refreshOpenDetails();
        }
    }

    async function handleSetAssetVisibility(user, asset, visibility) {
        const res = await apiAdminSetUserAssetVisibility(user.id, asset.id, visibility);
        if (res.ok) {
            showToast('Asset visibility updated.', 'success');
            await refreshOpenDetails();
        } else {
            showToast(res.error, 'error');
        }
    }

    async function handleDeleteAsset(user, asset) {
        const target = `${getAssetDisplayName(asset)} (${asset.id})`;
        if (!confirm(`Delete asset "${target}" for ${user.email || user.id}?\n\nThis is an admin storage mutation. It requires a reason and generated Idempotency-Key. It does not prove tenant isolation and does not list live R2.`)) return;
        const reason = prompt('Reason for asset deletion (required, at least 8 characters)', 'Admin storage cleanup requested after review');
        if (reason === null) return;
        const trimmedReason = reason.trim();
        if (trimmedReason.length < 8) {
            showToast('Deletion reason must be at least 8 characters.', 'error');
            return;
        }
        const res = await apiAdminDeleteUserAsset(user.id, asset.id, {
            reason: trimmedReason,
            idempotencyKey: createAdminIdempotencyKey('admin-storage-asset-delete'),
        });
        if (res.ok) {
            showToast('Asset deleted.', 'success');
            await refreshOpenDetails();
        } else {
            showToast(res.error, 'error');
        }
    }

    async function handleRenameFolder(user, folder) {
        const name = prompt('Rename folder', folder.name || '');
        if (name === null) return;
        const trimmed = name.trim();
        if (!trimmed || trimmed === folder.name) return;
        const res = await apiAdminRenameUserFolder(user.id, folder.id, trimmed);
        if (res.ok) {
            showToast('Folder renamed.', 'success');
            await refreshOpenDetails();
        } else {
            showToast(res.error, 'error');
        }
    }

    async function handleDeleteFolder(user, folder) {
        const target = `${folder.name || folder.id} (${folder.id})`;
        if (!confirm(`Delete folder "${target}" and its assets for ${user.email || user.id}?\n\nThis is irreversible or cleanup-queued under existing safeguards. It requires a reason and generated Idempotency-Key. It does not prove tenant isolation and does not list live R2.`)) return;
        const reason = prompt('Reason for folder deletion (required, at least 8 characters)', 'Admin storage folder cleanup requested after review');
        if (reason === null) return;
        const trimmedReason = reason.trim();
        if (trimmedReason.length < 8) {
            showToast('Deletion reason must be at least 8 characters.', 'error');
            return;
        }
        const res = await apiAdminDeleteUserFolder(user.id, folder.id, {
            reason: trimmedReason,
            idempotencyKey: createAdminIdempotencyKey('admin-storage-folder-delete'),
        });
        if (res.ok) {
            showToast('Folder deleted.', 'success');
            await refreshOpenDetails();
        } else {
            showToast(res.error, 'error');
        }
    }

    function bind() {
        if (!refs.modal || refs.modal.dataset.bound === '1') return;
        refs.modal.dataset.bound = '1';
        refs.modal.querySelectorAll('[data-user-storage-close]').forEach((button) => {
            button.addEventListener('click', close);
        });
    }

    return {
        bind,
        close,
        open,
    };
}
