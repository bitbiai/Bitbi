import {
    apiAiBulkDeleteAssets,
    apiAiBulkMoveAssets,
    apiAiCreateFolder,
    apiAiDeleteImage,
    apiAiDeleteTextAsset,
    apiAiDeleteFolder,
    apiAiGetAssets,
    apiAiGetFolders,
    apiAiGetFoldersForDelete,
} from './auth-api.js?v=__ASSET_VERSION__';
import { initStudioDeck, initStudioFolderDeck } from './studio-deck.js?v=__ASSET_VERSION__';

const UNFOLDERED = '__unfoldered__';
const ALL_ASSETS = '__all__';
const MAX_BULK_SELECT = 50;
const assetDateFormatter = new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
});
const assetSizeFormatter = new Intl.NumberFormat('de-DE', {
    maximumFractionDigits: 1,
});

function formatAssetDate(iso) {
    if (!iso) return '';
    try {
        return assetDateFormatter.format(new Date(iso));
    } catch {
        return '';
    }
}

function formatAssetSize(sizeBytes) {
    const size = Number(sizeBytes);
    if (!Number.isFinite(size) || size <= 0) return '';
    if (size >= 1024 * 1024) {
        return `${assetSizeFormatter.format(size / (1024 * 1024))} MB`;
    }
    if (size >= 1024) {
        return `${assetSizeFormatter.format(size / 1024)} KB`;
    }
    return `${Math.round(size)} B`;
}

function isAudioAsset(asset) {
    if (asset?.asset_type === 'sound') return true;
    return String(asset?.mime_type || '').toLowerCase().startsWith('audio/');
}

function isImageAsset(asset) {
    return asset?.asset_type === 'image';
}

function getFileBadge(asset) {
    if (isAudioAsset(asset)) return 'SOUND';
    const sourceModule = String(asset?.source_module || '').trim();
    return sourceModule
        ? sourceModule.replace(/_/g, ' ').toUpperCase()
        : 'TEXT';
}

function getFileTitle(asset) {
    return asset?.title || asset?.file_name || (isAudioAsset(asset) ? 'Saved audio asset' : 'Saved asset');
}

function getFilePreview(asset) {
    if (asset?.preview_text) return asset.preview_text;
    if (isAudioAsset(asset)) return 'Saved audio asset.';
    return 'Saved AI Lab asset.';
}

function getImagePreviewState(asset) {
    const status = asset?.derivatives_status || 'pending';
    if (status === 'failed') {
        return {
            variant: 'failed',
            label: 'Preview unavailable',
            hint: 'Open the original while previews are rebuilt.',
        };
    }
    if (status === 'processing') {
        return {
            variant: 'pending',
            label: 'Preparing preview',
            hint: 'Open the original while the queue finishes your preview.',
        };
    }
    return {
        variant: 'pending',
        label: 'Preview pending',
        hint: 'Open the original while the queue builds your preview.',
    };
}

function buildImagePreviewPlaceholder(asset) {
    const state = getImagePreviewState(asset);
    const placeholder = document.createElement('div');
    placeholder.className = 'studio__image-preview-state';

    const badge = document.createElement('span');
    badge.className = `studio__image-preview-badge studio__image-preview-badge--${state.variant}`;
    badge.textContent = state.label;
    placeholder.appendChild(badge);

    const title = document.createElement('span');
    title.className = 'studio__image-preview-title';
    title.textContent = asset.title || asset.preview_text || 'Saved image';
    placeholder.appendChild(title);

    const hint = document.createElement('span');
    hint.className = 'studio__image-preview-hint';
    hint.textContent = state.hint;
    placeholder.appendChild(hint);

    return placeholder;
}

function normalizeFolders(result) {
    return {
        folders: Array.isArray(result?.folders) ? result.folders : [],
        counts: result?.counts || {},
        unfolderedCount: result?.unfolderedCount || 0,
    };
}

function populateFolderOptions(selectEl, folders, placeholder = 'Assets') {
    if (!selectEl) return;
    const current = selectEl.value;
    selectEl.innerHTML = '';

    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = placeholder;
    selectEl.appendChild(defaultOption);

    folders.forEach((folder) => {
        const option = document.createElement('option');
        option.value = folder.id;
        option.textContent = folder.name;
        selectEl.appendChild(option);
    });

    if (current) {
        const match = folders.some((folder) => folder.id === current);
        selectEl.value = match ? current : '';
    }
}

function populateGalleryFilter(selectEl, folders) {
    if (!selectEl) return;
    const current = selectEl.value;
    selectEl.innerHTML = '';

    [
        { value: '', label: 'All Folders' },
        { value: ALL_ASSETS, label: 'All Assets' },
        { value: UNFOLDERED, label: 'Assets' },
    ].forEach((entry) => {
        const option = document.createElement('option');
        option.value = entry.value;
        option.textContent = entry.label;
        selectEl.appendChild(option);
    });

    folders.forEach((folder) => {
        const option = document.createElement('option');
        option.value = folder.id;
        option.textContent = folder.name;
        selectEl.appendChild(option);
    });

    const allowed = new Set(['', ALL_ASSETS, UNFOLDERED, ...folders.map((folder) => folder.id)]);
    selectEl.value = allowed.has(current) ? current : '';
}

export function createSavedAssetsBrowser({
    refs = {},
    emptyStateMessage = 'No saved assets yet.',
    foldersUnavailableMessage = 'Could not load folders. Showing all saved assets.',
    onFoldersChange = null,
} = {}) {
    const root = refs.root;
    const $galleryFilter = refs.galleryFilter;
    const $folderGrid = refs.folderGrid;
    const $folderBack = refs.folderBack;
    const $folderBackBtn = refs.folderBackBtn;
    const $assetGrid = refs.assetGrid;
    const $galleryMsg = refs.galleryMsg;
    const $newFolderBtn = refs.newFolderBtn;
    const $deleteFolderBtn = refs.deleteFolderBtn;
    const $newFolderForm = refs.newFolderForm;
    const $newFolderInput = refs.newFolderInput;
    const $newFolderSave = refs.newFolderSave;
    const $newFolderCancel = refs.newFolderCancel;
    const $deleteFolderForm = refs.deleteFolderForm;
    const $deleteFolderSelect = refs.deleteFolderSelect;
    const $deleteFolderConfirm = refs.deleteFolderConfirm;
    const $deleteFolderCancel = refs.deleteFolderCancel;
    const $selectBtn = refs.selectBtn;
    const $mobileActionsToggle = refs.mobileActionsToggle;
    const $mobileActionsMenu = refs.mobileActionsMenu;
    const $bulkBar = refs.bulkBar;
    const $bulkCount = refs.bulkCount;
    const $bulkMove = refs.bulkMove;
    const $bulkDelete = refs.bulkDelete;
    const $bulkCancel = refs.bulkCancel;
    const $bulkMoveForm = refs.bulkMoveForm;
    const $bulkMoveSelect = refs.bulkMoveSelect;
    const $bulkMoveConfirm = refs.bulkMoveConfirm;
    const $bulkMoveCancel = refs.bulkMoveCancel;

    if (!$galleryFilter || !$folderGrid || !$assetGrid) {
        return {
            init: async () => {},
            show: async () => {},
            refresh: async () => {},
            getFolders: () => [],
        };
    }

    let initialized = false;
    let folderViewActive = true;
    let folders = [];
    let folderCounts = {};
    let unfolderedCount = 0;
    let selectMode = false;
    let selectedIds = new Set();
    let folderDeck = null;
    let assetDeck = null;
    let folderLoadSeq = 0;
    let assetLoadSeq = 0;

    function showMsg(text, type) {
        if (!$galleryMsg) return;
        $galleryMsg.textContent = text;
        $galleryMsg.className = `studio__msg studio__msg--${type}`;
    }

    function hideMsg() {
        if (!$galleryMsg) return;
        $galleryMsg.textContent = '';
        $galleryMsg.className = 'studio__msg';
    }

    function notifyFoldersChange() {
        if (typeof onFoldersChange !== 'function') return;
        onFoldersChange({
            folders: folders.slice(),
            counts: { ...folderCounts },
            unfolderedCount,
        });
    }

    function setSelectionRootActive(isActive) {
        root?.classList.toggle('studio--selecting-mode', !!isActive);
    }

    function closeMobileMenu() {
        if (!$mobileActionsMenu || !$mobileActionsToggle) return;
        $mobileActionsMenu.classList.remove('visible');
        $mobileActionsToggle.setAttribute('aria-expanded', 'false');
    }

    function toggleMobileMenu() {
        if (!$mobileActionsMenu || !$mobileActionsToggle) return;
        const isOpen = $mobileActionsMenu.classList.contains('visible');
        if (isOpen) {
            closeMobileMenu();
            return;
        }
        $mobileActionsMenu.classList.add('visible');
        $mobileActionsToggle.setAttribute('aria-expanded', 'true');
    }

    function renderEmptyState(message = emptyStateMessage) {
        $assetGrid.innerHTML = '';
        const empty = document.createElement('div');
        empty.className = 'studio__gallery-empty';
        empty.textContent = message;
        $assetGrid.appendChild(empty);
    }

    function appendSelectionCheck(item) {
        const check = document.createElement('div');
        check.className = 'studio__image-check';
        check.setAttribute('aria-hidden', 'true');
        item.appendChild(check);
    }

    async function deleteSingleAsset(asset) {
        if (isImageAsset(asset)) {
            return apiAiDeleteImage(asset.id);
        }
        return apiAiDeleteTextAsset(asset.id);
    }

    async function loadFolders({ preserveFilter = true } = {}) {
        const requestId = ++folderLoadSeq;
        try {
            const result = normalizeFolders(await apiAiGetFolders());
            if (requestId !== folderLoadSeq) return false;
            folders = result.folders;
            folderCounts = result.counts;
            unfolderedCount = result.unfolderedCount;
        } catch (error) {
            console.warn('Failed to load folders:', error);
            if (requestId !== folderLoadSeq) return false;
            folders = [];
            folderCounts = {};
            unfolderedCount = 0;
            notifyFoldersChange();
            populateFolderOptions($bulkMoveSelect, folders);
            populateGalleryFilter($galleryFilter, folders);
            if (!preserveFilter) $galleryFilter.value = '';
            return false;
        }

        notifyFoldersChange();
        populateFolderOptions($bulkMoveSelect, folders);
        populateGalleryFilter($galleryFilter, folders);
        if (!preserveFilter) {
            $galleryFilter.value = '';
        }
        return true;
    }

    function showFolderView() {
        exitSelectMode();
        hideNewFolderForm();
        hideDeleteFolderForm();
        folderViewActive = true;
        $galleryFilter.value = '';
        $folderGrid.style.display = '';
        $assetGrid.style.display = 'none';
        folderDeck?.setVisible(true);
        assetDeck?.setVisible(false);
        $folderBack?.classList.remove('visible');

        const total = unfolderedCount + folders.reduce((sum, folder) => sum + (folderCounts[folder.id] || 0), 0);
        $folderGrid.innerHTML = '';

        const allCard = document.createElement('div');
        allCard.className = 'studio__folder-card';
        allCard.addEventListener('click', openAllAssets);
        [
            { className: 'studio__folder-card-icon', text: '\u{1F5BC}' },
            { className: 'studio__folder-card-name', text: 'All Assets' },
            { className: 'studio__folder-card-count', text: `${total} asset${total === 1 ? '' : 's'}` },
        ].forEach((entry) => {
            const el = document.createElement('span');
            el.className = entry.className;
            el.textContent = entry.text;
            allCard.appendChild(el);
        });
        $folderGrid.appendChild(allCard);

        const assetsCard = document.createElement('div');
        assetsCard.className = 'studio__folder-card';
        assetsCard.addEventListener('click', () => openFolder(UNFOLDERED));
        [
            { className: 'studio__folder-card-icon', text: '\u{1F4E6}' },
            { className: 'studio__folder-card-name', text: 'Assets' },
            { className: 'studio__folder-card-count', text: `${unfolderedCount} asset${unfolderedCount === 1 ? '' : 's'}` },
        ].forEach((entry) => {
            const el = document.createElement('span');
            el.className = entry.className;
            el.textContent = entry.text;
            assetsCard.appendChild(el);
        });
        $folderGrid.appendChild(assetsCard);

        folders.forEach((folder) => {
            const card = document.createElement('div');
            card.className = 'studio__folder-card';
            card.addEventListener('click', () => openFolder(folder.id));

            const icon = document.createElement('span');
            icon.className = 'studio__folder-card-icon';
            icon.textContent = '\u{1F4C1}';

            const name = document.createElement('span');
            name.className = 'studio__folder-card-name';
            name.textContent = folder.name;

            const count = document.createElement('span');
            count.className = 'studio__folder-card-count';
            const totalCount = folderCounts[folder.id] || 0;
            count.textContent = `${totalCount} asset${totalCount === 1 ? '' : 's'}`;

            card.append(icon, name, count);
            $folderGrid.appendChild(card);
        });
    }

    function buildImageCard(asset) {
        const item = document.createElement('div');
        item.className = 'studio__image-item';
        item.dataset.assetId = asset.id;
        item.dataset.assetType = 'image';
        item.dataset.previewUrl = asset.medium_url || asset.original_url || asset.file_url || '';
        item.dataset.originalUrl = asset.original_url || asset.file_url || '';
        item.title = asset.title || asset.preview_text || '';

        if (asset.thumb_url) {
            const imgEl = document.createElement('img');
            imgEl.src = asset.thumb_url;
            imgEl.alt = asset.title || asset.preview_text || 'Saved image';
            imgEl.loading = 'lazy';
            imgEl.decoding = 'async';
            if (asset.thumb_width) imgEl.width = asset.thumb_width;
            if (asset.thumb_height) imgEl.height = asset.thumb_height;
            item.appendChild(imgEl);
        } else {
            item.classList.add('studio__image-item--placeholder');
            item.appendChild(buildImagePreviewPlaceholder(asset));
        }

        const overlay = document.createElement('div');
        overlay.className = 'studio__image-overlay';

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'studio__image-delete';
        deleteButton.textContent = 'Delete';
        deleteButton.addEventListener('click', async (event) => {
            event.stopPropagation();
            if (!confirm('Delete this image?')) return;
            deleteButton.disabled = true;
            deleteButton.textContent = '\u2026';
            const result = await deleteSingleAsset(asset);
            if (!result.ok) {
                deleteButton.disabled = false;
                deleteButton.textContent = 'Delete';
                showMsg(result.error || 'Delete failed.', 'error');
                return;
            }
            await refresh();
            showMsg('Image deleted.', 'success');
        });

        overlay.appendChild(deleteButton);
        item.appendChild(overlay);
        appendSelectionCheck(item);
        return item;
    }

    function buildFileCard(asset) {
        const item = document.createElement('article');
        const isSound = isAudioAsset(asset);
        item.className = `studio__image-item studio__image-item--file ${isSound ? 'studio__image-item--sound' : 'studio__image-item--text'}`;
        item.dataset.assetId = asset.id;
        item.dataset.assetType = isSound ? 'sound' : 'text';
        item.dataset.openUrl = asset.file_url || '';
        item.title = getFileTitle(asset);

        const badge = document.createElement('span');
        badge.className = `studio__asset-badge ${isSound ? 'studio__asset-badge--sound' : 'studio__asset-badge--text'}`;
        badge.textContent = getFileBadge(asset);
        item.appendChild(badge);

        const title = document.createElement('h3');
        title.className = 'studio__asset-title';
        title.textContent = getFileTitle(asset);
        item.appendChild(title);

        const preview = document.createElement('p');
        preview.className = 'studio__asset-preview';
        preview.textContent = getFilePreview(asset);
        item.appendChild(preview);

        if (isSound && asset.file_url) {
            const audio = document.createElement('audio');
            audio.className = 'studio__asset-audio';
            audio.controls = true;
            audio.preload = 'none';
            audio.src = asset.file_url;
            item.appendChild(audio);
        }

        const meta = document.createElement('div');
        meta.className = 'studio__asset-meta';
        meta.textContent = [
            formatAssetDate(asset.created_at),
            asset.file_name || '',
            formatAssetSize(asset.size_bytes),
        ].filter(Boolean).join(' · ');
        item.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'studio__asset-actions';

        const openLink = document.createElement('a');
        openLink.className = 'studio__asset-open';
        openLink.href = asset.file_url || '#';
        openLink.target = '_blank';
        openLink.rel = 'noopener noreferrer';
        openLink.textContent = isSound ? 'Open File' : 'Open';
        actions.appendChild(openLink);

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'studio__image-delete studio__image-delete--inline';
        deleteButton.textContent = 'Delete';
        deleteButton.addEventListener('click', async (event) => {
            event.stopPropagation();
            const confirmText = isSound ? 'Delete this sound file?' : 'Delete this saved asset?';
            if (!confirm(confirmText)) return;
            deleteButton.disabled = true;
            deleteButton.textContent = '\u2026';
            const result = await deleteSingleAsset(asset);
            if (!result.ok) {
                deleteButton.disabled = false;
                deleteButton.textContent = 'Delete';
                showMsg(result.error || 'Delete failed.', 'error');
                return;
            }
            await refresh();
            showMsg(isSound ? 'Sound file deleted.' : 'Asset deleted.', 'success');
        });
        actions.appendChild(deleteButton);

        item.appendChild(actions);
        appendSelectionCheck(item);
        return item;
    }

    async function loadGallery() {
        if (selectMode) exitSelectMode();
        const requestId = ++assetLoadSeq;
        const filterValue = $galleryFilter.value;
        const isAllAssets = filterValue === ALL_ASSETS || filterValue === '';
        const isUnfoldered = filterValue === UNFOLDERED;
        const folderId = (!isAllAssets && !isUnfoldered && filterValue) ? filterValue : null;

        $assetGrid.style.display = '';
        $assetGrid.innerHTML = '';
        const loading = document.createElement('div');
        loading.className = 'studio__gallery-empty';
        loading.textContent = 'Loading…';
        $assetGrid.appendChild(loading);

        let assets;
        try {
            assets = await apiAiGetAssets(folderId, { onlyUnfoldered: isUnfoldered });
        } catch (error) {
            console.warn('Failed to load gallery:', error);
            if (requestId !== assetLoadSeq) return;
            renderEmptyState();
            showMsg('Could not load saved assets.', 'error');
            return;
        }

        if (requestId !== assetLoadSeq) return;
        hideMsg();

        if (!Array.isArray(assets) || assets.length === 0) {
            renderEmptyState(emptyStateMessage);
            return;
        }

        $assetGrid.innerHTML = '';
        assets.forEach((asset) => {
            $assetGrid.appendChild(isImageAsset(asset) ? buildImageCard(asset) : buildFileCard(asset));
        });
        assetDeck?.refresh();
    }

    function openFolder(folderId) {
        hideNewFolderForm();
        hideDeleteFolderForm();
        folderViewActive = false;
        $folderGrid.style.display = 'none';
        folderDeck?.setVisible(false);
        $assetGrid.style.display = '';
        $folderBack?.classList.add('visible');
        $galleryFilter.value = folderId;
        loadGallery();
    }

    function openAllAssets() {
        hideNewFolderForm();
        hideDeleteFolderForm();
        folderViewActive = false;
        $folderGrid.style.display = 'none';
        folderDeck?.setVisible(false);
        $assetGrid.style.display = '';
        $folderBack?.classList.add('visible');
        $galleryFilter.value = ALL_ASSETS;
        loadGallery();
    }

    function exitSelectMode() {
        if (!selectMode) return;
        selectMode = false;
        selectedIds.clear();
        $assetGrid.classList.remove('studio--selecting');
        delete $assetGrid.dataset.selectMode;
        $bulkBar?.classList.remove('visible');
        $bulkMoveForm?.classList.remove('visible');
        $galleryFilter.disabled = false;
        setSelectionRootActive(false);
        $assetGrid.querySelectorAll('.studio__image-item.selected').forEach((el) => {
            el.classList.remove('selected');
        });
        updateBulkCount();
    }

    function enterSelectMode() {
        const items = $assetGrid.querySelectorAll('.studio__image-item[data-asset-id]');
        if (items.length === 0) return;
        selectMode = true;
        selectedIds.clear();
        $assetGrid.classList.add('studio--selecting');
        $assetGrid.dataset.selectMode = 'true';
        $bulkBar?.classList.add('visible');
        $galleryFilter.disabled = true;
        setSelectionRootActive(true);
        updateBulkCount();
        hideMsg();
    }

    function toggleSelection(item) {
        const id = item.dataset.assetId;
        if (!id) return;
        if (selectedIds.has(id)) {
            selectedIds.delete(id);
            item.classList.remove('selected');
        } else {
            if (selectedIds.size >= MAX_BULK_SELECT) {
                showMsg(`You can select up to ${MAX_BULK_SELECT} assets at a time.`, 'error');
                return;
            }
            selectedIds.add(id);
            item.classList.add('selected');
        }
        updateBulkCount();
    }

    function updateBulkCount() {
        if (!$bulkCount) return;
        const count = selectedIds.size;
        $bulkCount.textContent = `${count} selected${count >= MAX_BULK_SELECT ? ' (max)' : ''}`;
    }

    function showBulkMoveForm() {
        if (selectedIds.size === 0) {
            showMsg('Select at least one asset first.', 'error');
            return;
        }
        populateFolderOptions($bulkMoveSelect, folders);
        $bulkMoveForm?.classList.add('visible');
        $bulkMoveSelect?.focus();
    }

    async function handleBulkMoveConfirm() {
        if (selectedIds.size === 0) return;
        const folderId = $bulkMoveSelect?.value || null;
        if ($bulkMoveConfirm) {
            $bulkMoveConfirm.disabled = true;
            $bulkMoveConfirm.textContent = '\u2026';
        }
        const result = await apiAiBulkMoveAssets(Array.from(selectedIds), folderId);
        if ($bulkMoveConfirm) {
            $bulkMoveConfirm.disabled = false;
            $bulkMoveConfirm.textContent = 'Move';
        }
        if (!result.ok) {
            showMsg(result.error || 'Failed to move assets.', 'error');
            return;
        }
        const movedCount = selectedIds.size;
        exitSelectMode();
        await refresh();
        showMsg(`${movedCount} asset${movedCount === 1 ? '' : 's'} moved.`, 'success');
    }

    async function handleBulkDelete() {
        if (selectedIds.size === 0) {
            showMsg('Select at least one asset first.', 'error');
            return;
        }
        const count = selectedIds.size;
        if (!confirm(`Delete ${count} selected asset${count === 1 ? '' : 's'}?\n\nThis cannot be undone.`)) {
            return;
        }
        if ($bulkDelete) {
            $bulkDelete.disabled = true;
            $bulkDelete.textContent = '\u2026';
        }
        const result = await apiAiBulkDeleteAssets(Array.from(selectedIds));
        if ($bulkDelete) {
            $bulkDelete.disabled = false;
            $bulkDelete.textContent = 'Delete Selected';
        }
        if (!result.ok) {
            showMsg(result.error || 'Failed to delete assets.', 'error');
            return;
        }
        exitSelectMode();
        await refresh();
        showMsg(`${count} asset${count === 1 ? '' : 's'} deleted.`, 'success');
    }

    function hideNewFolderForm() {
        $newFolderForm?.classList.remove('visible');
    }

    function showNewFolderForm() {
        $deleteFolderForm?.classList.remove('visible');
        $newFolderForm?.classList.add('visible');
        if ($newFolderInput) {
            $newFolderInput.value = '';
            $newFolderInput.focus();
        }
    }

    async function handleCreateFolder() {
        const name = $newFolderInput?.value.trim();
        if (!name) return;
        if ($newFolderSave) $newFolderSave.disabled = true;
        const result = await apiAiCreateFolder(name);
        if ($newFolderSave) $newFolderSave.disabled = false;
        if (!result.ok) {
            showMsg(result.error || 'Folder creation failed.', 'error');
            return;
        }
        hideNewFolderForm();
        await refresh({ preserveView: folderViewActive });
        showMsg(`Folder "${name}" created.`, 'success');
    }

    async function showDeleteFolderForm() {
        hideNewFolderForm();
        let deletableFolders;
        try {
            deletableFolders = await apiAiGetFoldersForDelete();
        } catch {
            deletableFolders = folders.slice();
        }

        if (!Array.isArray(deletableFolders) || deletableFolders.length === 0) {
            showMsg('No folders to delete.', 'error');
            return;
        }

        if ($deleteFolderSelect) {
            $deleteFolderSelect.innerHTML = '';
            deletableFolders.forEach((folder) => {
                const option = document.createElement('option');
                option.value = folder.id;
                option.textContent = folder.status === 'deleting'
                    ? `${folder.name} (retry delete)`
                    : folder.name;
                $deleteFolderSelect.appendChild(option);
            });
        }
        $deleteFolderForm?.classList.add('visible');
        $deleteFolderSelect?.focus();
    }

    function hideDeleteFolderForm() {
        $deleteFolderForm?.classList.remove('visible');
    }

    async function handleDeleteFolder() {
        const folderId = $deleteFolderSelect?.value;
        if (!folderId) return;

        const targetFolder = folders.find((folder) => folder.id === folderId);
        const name = targetFolder?.name || 'this folder';
        if (!confirm(`Delete folder "${name}" and all its assets?\n\nThis cannot be undone.`)) {
            return;
        }

        if ($deleteFolderConfirm) {
            $deleteFolderConfirm.disabled = true;
            $deleteFolderConfirm.textContent = '\u2026';
        }
        const result = await apiAiDeleteFolder(folderId);
        if ($deleteFolderConfirm) {
            $deleteFolderConfirm.disabled = false;
            $deleteFolderConfirm.textContent = 'Delete';
        }
        if (!result.ok) {
            showMsg(result.error || 'Failed to delete folder.', 'error');
            return;
        }

        hideDeleteFolderForm();
        if ($galleryFilter.value === folderId) {
            $galleryFilter.value = '';
            folderViewActive = true;
        }
        await refresh({ preserveView: true });
        showMsg(`Folder "${name}" deleted.`, 'success');
    }

    async function refresh({ preserveView = true } = {}) {
        const previousFilter = $galleryFilter.value;
        const previousFolderView = folderViewActive;
        const foldersOk = await loadFolders({ preserveFilter: preserveView });
        if (!foldersOk) {
            showMsg(foldersUnavailableMessage, 'error');
            openAllAssets();
            return;
        }

        const allowedFolderIds = new Set(folders.map((folder) => folder.id));
        if (
            previousFilter &&
            previousFilter !== ALL_ASSETS &&
            previousFilter !== UNFOLDERED &&
            !allowedFolderIds.has(previousFilter)
        ) {
            $galleryFilter.value = '';
            folderViewActive = true;
        }

        if (!preserveView || previousFolderView || $galleryFilter.value === '') {
            showFolderView();
            return;
        }

        folderViewActive = false;
        $folderGrid.style.display = 'none';
        folderDeck?.setVisible(false);
        $assetGrid.style.display = '';
        $folderBack?.classList.add('visible');
        await loadGallery();
    }

    async function init() {
        if (initialized) return;
        initialized = true;

        assetDeck = initStudioDeck($assetGrid);
        folderDeck = initStudioFolderDeck($folderGrid);

        $galleryFilter.addEventListener('change', () => {
            const value = $galleryFilter.value;
            if (value === '') {
                showFolderView();
                return;
            }
            if (value === ALL_ASSETS) {
                openAllAssets();
                return;
            }
            openFolder(value);
        });

        $folderBackBtn?.addEventListener('click', showFolderView);
        $newFolderBtn?.addEventListener('click', showNewFolderForm);
        $deleteFolderBtn?.addEventListener('click', showDeleteFolderForm);
        $deleteFolderConfirm?.addEventListener('click', handleDeleteFolder);
        $deleteFolderCancel?.addEventListener('click', hideDeleteFolderForm);
        $newFolderCancel?.addEventListener('click', hideNewFolderForm);
        $newFolderSave?.addEventListener('click', handleCreateFolder);
        $newFolderInput?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                handleCreateFolder();
            }
            if (event.key === 'Escape') hideNewFolderForm();
        });

        $selectBtn?.addEventListener('click', enterSelectMode);
        $bulkMove?.addEventListener('click', showBulkMoveForm);
        $bulkDelete?.addEventListener('click', handleBulkDelete);
        $bulkCancel?.addEventListener('click', exitSelectMode);
        $bulkMoveConfirm?.addEventListener('click', handleBulkMoveConfirm);
        $bulkMoveCancel?.addEventListener('click', () => {
            $bulkMoveForm?.classList.remove('visible');
        });

        $assetGrid.addEventListener('click', (event) => {
            if (!selectMode) return;
            const item = event.target.closest('.studio__image-item[data-asset-id]');
            if (!item) return;
            if (event.target.closest('a, button, audio, summary, details')) return;
            toggleSelection(item);
        });

        $mobileActionsToggle?.addEventListener('click', (event) => {
            event.stopPropagation();
            toggleMobileMenu();
        });
        $mobileActionsMenu?.addEventListener('click', (event) => {
            const button = event.target.closest('[data-action]');
            if (!button) return;
            closeMobileMenu();
            const action = button.dataset.action;
            if (action === 'new-folder') showNewFolderForm();
            else if (action === 'delete-folder') showDeleteFolderForm();
            else if (action === 'select') enterSelectMode();
        });
        document.addEventListener('click', (event) => {
            if (!root?.contains(event.target)) closeMobileMenu();
        });

        const foldersOk = await loadFolders({ preserveFilter: false });
        if (foldersOk) {
            showFolderView();
        } else {
            showMsg(foldersUnavailableMessage, 'error');
            openAllAssets();
        }
    }

    async function show() {
        await init();
        if (folderViewActive) {
            folderDeck?.setVisible(true);
            assetDeck?.setVisible(false);
        } else {
            folderDeck?.setVisible(false);
            assetDeck?.setVisible(true);
        }
    }

    return {
        init,
        show,
        refresh,
        getFolders() {
            return folders.slice();
        },
    };
}
