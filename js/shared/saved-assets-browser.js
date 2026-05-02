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
    apiAiRenameFolder,
    apiAiRenameImage,
    apiAiRenameTextAsset,
    apiAiSetImagePublication,
    apiAiSetTextAssetPublication,
} from './auth-api.js?v=__ASSET_VERSION__';
import {
    initStudioDeck,
    initStudioFolderDeck,
    openStudioVideoModal,
} from './studio-deck.js?v=__ASSET_VERSION__';

const UNFOLDERED = '__unfoldered__';
const ALL_ASSETS = '__all__';
const MAX_BULK_SELECT = 50;
const MAX_FOLDER_NAME_LENGTH = 100;
const MAX_IMAGE_NAME_LENGTH = 1000;
const MAX_FILE_ASSET_NAME_LENGTH = 120;
const SAVED_ASSET_PAGE_LIMIT = 60;
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

function isVideoAsset(asset) {
    if (asset?.asset_type === 'video') return true;
    return String(asset?.mime_type || '').toLowerCase().startsWith('video/');
}

function isImageAsset(asset) {
    return asset?.asset_type === 'image';
}

function isPublishedAsset(asset) {
    return String(asset?.visibility || 'private') === 'public';
}

function isPublishedImageAsset(asset) {
    return isPublishedAsset(asset);
}

function getFileBadge(asset) {
    if (isAudioAsset(asset)) return 'SOUND';
    if (isVideoAsset(asset)) return 'VIDEO';
    const sourceModule = String(asset?.source_module || '').trim();
    return sourceModule
        ? sourceModule.replace(/_/g, ' ').toUpperCase()
        : 'TEXT';
}

function getFileTitle(asset) {
    return asset?.title
        || asset?.file_name
        || (isAudioAsset(asset)
            ? 'Saved audio asset'
            : isVideoAsset(asset)
                ? 'Saved video asset'
                : 'Saved asset');
}

function getFilePreview(asset) {
    if (asset?.preview_text) return asset.preview_text;
    if (isAudioAsset(asset)) return 'Saved audio asset.';
    if (isVideoAsset(asset)) return 'Saved video asset.';
    return 'Saved AI Lab asset.';
}

function splitFileName(fileName) {
    const normalized = String(fileName || '').trim();
    const slashIndex = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
    const bareName = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
    const dotIndex = bareName.lastIndexOf('.');
    if (dotIndex > 0 && dotIndex < bareName.length - 1) {
        return {
            base: bareName.slice(0, dotIndex),
            ext: bareName.slice(dotIndex),
        };
    }
    return {
        base: bareName,
        ext: '',
    };
}

function getAssetRenameLabel(asset) {
    if (isImageAsset(asset)) {
        return String(asset?.title || asset?.prompt || asset?.preview_text || 'Saved image').trim();
    }
    if (asset?.title) {
        return String(asset.title).trim();
    }
    if (asset?.file_name) {
        return splitFileName(asset.file_name).base || String(asset.file_name).trim();
    }
    return getFileTitle(asset);
}

function getRenameTargetConfig(target) {
    if (!target) return null;
    if (target.kind === 'folder') {
        return {
            maxLength: MAX_FOLDER_NAME_LENGTH,
            placeholder: 'Folder name',
            successLabel: 'Folder',
        };
    }
    if (isImageAsset(target.asset)) {
        return {
            maxLength: MAX_IMAGE_NAME_LENGTH,
            placeholder: 'Image name',
            successLabel: 'Image',
        };
    }
    return {
        maxLength: MAX_FILE_ASSET_NAME_LENGTH,
        placeholder: 'Asset name',
        successLabel: isAudioAsset(target.asset)
            ? 'Sound asset'
            : isVideoAsset(target.asset)
                ? 'Video asset'
                : 'Asset',
    };
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

function buildSoundPlayIndicator() {
    const indicator = document.createElement('div');
    indicator.className = 'studio__asset-play-indicator';
    indicator.dataset.playing = 'false';
    indicator.setAttribute('aria-hidden', 'true');

    for (let index = 0; index < 4; index += 1) {
        const bar = document.createElement('span');
        bar.className = 'studio__asset-play-bar';
        indicator.appendChild(bar);
    }

    return indicator;
}

function buildSoundCoverBackground(asset) {
    if (!asset?.poster_url) return null;
    const cover = document.createElement('div');
    cover.className = 'studio__asset-cover-bg';
    cover.setAttribute('aria-hidden', 'true');
    cover.style.backgroundImage = `url("${String(asset.poster_url).replace(/"/g, '%22')}")`;
    return cover;
}

function getPublicationLabels(asset) {
    if (isImageAsset(asset)) {
        return {
            publish: 'Image published to Mempics.',
            unpublish: 'Image removed from Mempics.',
        };
    }
    if (isAudioAsset(asset)) {
        return {
            publish: 'Track published to Memtracks.',
            unpublish: 'Track removed from Memtracks.',
        };
    }
    if (isVideoAsset(asset)) {
        return {
            publish: 'Video published to Memvids.',
            unpublish: 'Video removed from Memvids.',
        };
    }
    return {
        publish: 'Asset published.',
        unpublish: 'Asset removed from public view.',
    };
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
    const $bulkRename = refs.bulkRename;
    const $bulkMove = refs.bulkMove;
    const $bulkDelete = refs.bulkDelete;
    const $bulkCancel = refs.bulkCancel;
    const $renameForm = refs.renameForm;
    const $renameInput = refs.renameInput;
    const $renameConfirm = refs.renameConfirm;
    const $renameCancel = refs.renameCancel;
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
    let selectionScope = null;
    let currentAssets = [];
    let folderDeck = null;
    let assetDeck = null;
    let folderLoadSeq = 0;
    let assetLoadSeq = 0;
    let activeSoundAudio = null;
    let activeSoundIndicator = null;
    let assetNextCursor = null;
    let assetHasMore = false;
    let assetLoadingMore = false;

    const $assetPagination = document.createElement('div');
    $assetPagination.className = 'studio__pagination';
    $assetPagination.style.display = 'none';

    const $assetPaginationStatus = document.createElement('div');
    $assetPaginationStatus.className = 'studio__pagination-status';

    const $assetLoadMore = document.createElement('button');
    $assetLoadMore.type = 'button';
    $assetLoadMore.className = 'studio__pagination-btn';
    $assetLoadMore.textContent = 'Load More';

    $assetPagination.append($assetPaginationStatus, $assetLoadMore);
    $assetGrid.insertAdjacentElement('afterend', $assetPagination);

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

    function setSoundIndicatorState(indicator, isActive) {
        if (!indicator) return;
        indicator.dataset.playing = isActive ? 'true' : 'false';
        indicator.classList.toggle('is-active', !!isActive);
    }

    function clearActiveSoundIndicator() {
        if (activeSoundIndicator) {
            setSoundIndicatorState(activeSoundIndicator, false);
        }
        activeSoundAudio = null;
        activeSoundIndicator = null;
    }

    function bindSoundPlaybackIndicator(audio, indicator) {
        if (!audio || !indicator) return;

        const activate = () => {
            if (activeSoundAudio && activeSoundAudio !== audio) {
                setSoundIndicatorState(activeSoundIndicator, false);
            }
            activeSoundAudio = audio;
            activeSoundIndicator = indicator;
            setSoundIndicatorState(indicator, true);
        };

        const deactivate = () => {
            if (activeSoundAudio === audio) {
                activeSoundAudio = null;
                activeSoundIndicator = null;
            }
            setSoundIndicatorState(indicator, false);
        };

        audio.addEventListener('play', activate);
        audio.addEventListener('pause', deactivate);
        audio.addEventListener('ended', deactivate);
        audio.addEventListener('emptied', deactivate);
    }

    function openExternalAsset(url) {
        if (!url) return;
        window.open(url, '_blank', 'noopener,noreferrer');
    }

    function openTextAsset(asset) {
        openExternalAsset(asset?.file_url || '');
    }

    function openVideoAsset(asset) {
        if (!asset?.file_url) return;
        openStudioVideoModal({
            videoUrl: asset.file_url,
            title: getFileTitle(asset),
            posterUrl: asset.poster_url || '',
        });
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
        currentAssets = [];
        assetNextCursor = null;
        assetHasMore = false;
        assetLoadingMore = false;
        clearActiveSoundIndicator();
        $assetGrid.innerHTML = '';
        const empty = document.createElement('div');
        empty.className = 'studio__gallery-empty';
        empty.textContent = message;
        $assetGrid.appendChild(empty);
        updateAssetPaginationUi();
    }

    function updateAssetPaginationUi() {
        const shouldShow = !folderViewActive && (currentAssets.length > 0 || assetLoadingMore || assetHasMore);
        $assetPagination.style.display = shouldShow ? '' : 'none';
        if (!shouldShow) return;

        if (assetLoadingMore) {
            $assetPaginationStatus.textContent = 'Loading more assets...';
        } else if (assetHasMore) {
            $assetPaginationStatus.textContent = `Showing ${currentAssets.length} saved assets.`;
        } else {
            $assetPaginationStatus.textContent = currentAssets.length
                ? `Showing all ${currentAssets.length} saved assets.`
                : '';
        }

        $assetLoadMore.style.display = assetHasMore ? '' : 'none';
        $assetLoadMore.disabled = assetLoadingMore;
        $assetLoadMore.textContent = assetLoadingMore ? 'Loading…' : 'Load More';
    }

    function appendSelectionCheck(item) {
        const check = document.createElement('div');
        check.className = 'studio__image-check';
        check.setAttribute('aria-hidden', 'true');
        item.appendChild(check);
    }

    function getSelectedEntity() {
        if (selectedIds.size !== 1) return null;
        const [id] = Array.from(selectedIds);
        if (!id) return null;
        if (selectionScope === 'folder') {
            const folder = folders.find((entry) => entry.id === id);
            return folder
                ? {
                    kind: 'folder',
                    id: folder.id,
                    label: folder.name,
                }
                : null;
        }

        const asset = currentAssets.find((entry) => entry.id === id);
        return asset
            ? {
                kind: 'asset',
                id: asset.id,
                label: getAssetRenameLabel(asset),
                asset,
            }
            : null;
    }

    function hideRenameForm() {
        $renameForm?.classList.remove('visible');
    }

    function getSelectionContextLabel() {
        return selectionScope === 'folder' ? 'folder' : 'asset';
    }

    function updateBulkCount() {
        const count = selectedIds.size;
        if ($bulkCount) {
            $bulkCount.textContent = `${count} selected${count >= MAX_BULK_SELECT ? ' (max)' : ''}`;
        }

        if ($bulkRename) {
            $bulkRename.disabled = count !== 1;
        }

        const folderSelection = selectionScope === 'folder';
        if ($bulkMove) {
            $bulkMove.hidden = folderSelection;
            $bulkMove.disabled = folderSelection || count === 0;
        }
        if ($bulkDelete) {
            $bulkDelete.hidden = folderSelection;
            $bulkDelete.disabled = folderSelection || count === 0;
        }

        if (count !== 1) {
            hideRenameForm();
        }
        if (folderSelection) {
            $bulkMoveForm?.classList.remove('visible');
        }
    }

    async function restoreSingleSelection(id, scope) {
        if (!id || !scope) return;
        if (scope === 'folder') {
            if (!folderViewActive) return;
            enterSelectMode();
            const item = $folderGrid.querySelector(`.studio__folder-card[data-folder-id="${id}"]`);
            if (item) {
                toggleSelection(item);
            }
            return;
        }

        if (folderViewActive) return;
        enterSelectMode();
        const item = $assetGrid.querySelector(`.studio__image-item[data-asset-id="${id}"]`);
        if (item) {
            toggleSelection(item);
        }
    }

    async function deleteSingleAsset(asset) {
        if (isImageAsset(asset)) {
            return apiAiDeleteImage(asset.id);
        }
        return apiAiDeleteTextAsset(asset.id);
    }

    async function updateAssetPublication(asset, visibility) {
        if (isImageAsset(asset)) {
            return apiAiSetImagePublication(asset.id, visibility);
        }
        return apiAiSetTextAssetPublication(asset.id, visibility);
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
        hideRenameForm();
        folderViewActive = true;
        assetLoadingMore = false;
        $galleryFilter.value = '';
        $folderGrid.style.display = '';
        $assetGrid.style.display = 'none';
        folderDeck?.setVisible(true);
        assetDeck?.setVisible(false);
        $folderBack?.classList.remove('visible');
        updateAssetPaginationUi();

        const total = unfolderedCount + folders.reduce((sum, folder) => sum + (folderCounts[folder.id] || 0), 0);
        $folderGrid.innerHTML = '';

        const allCard = document.createElement('div');
        allCard.className = 'studio__folder-card';
        allCard.addEventListener('click', () => {
            if (selectMode) return;
            openAllAssets();
        });
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
        assetsCard.addEventListener('click', () => {
            if (selectMode) return;
            openFolder(UNFOLDERED);
        });
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
            card.dataset.folderId = folder.id;
            card.title = folder.name;
            card.addEventListener('click', () => {
                if (selectMode) {
                    toggleSelection(card);
                    return;
                }
                openFolder(folder.id);
            });

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
            appendSelectionCheck(card);
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

        const visibilityBadge = document.createElement('span');
        visibilityBadge.className = `studio__image-visibility ${isPublishedImageAsset(asset) ? 'studio__image-visibility--public' : 'studio__image-visibility--private'}`;
        visibilityBadge.textContent = isPublishedImageAsset(asset) ? 'Public' : 'Private';
        item.appendChild(visibilityBadge);

        const overlay = document.createElement('div');
        overlay.className = 'studio__image-overlay';

        const publishButton = document.createElement('button');
        publishButton.type = 'button';
        publishButton.className = `studio__image-publish ${isPublishedImageAsset(asset) ? 'studio__image-publish--public' : ''}`;
        publishButton.textContent = isPublishedImageAsset(asset) ? 'Unpublish' : 'Publish';
        publishButton.addEventListener('click', async (event) => {
            event.stopPropagation();
            const nextVisibility = isPublishedImageAsset(asset) ? 'private' : 'public';
            publishButton.disabled = true;
            publishButton.textContent = '…';
            const result = await updateAssetPublication(asset, nextVisibility);
            if (!result.ok) {
                publishButton.disabled = false;
                publishButton.textContent = isPublishedImageAsset(asset) ? 'Unpublish' : 'Publish';
                showMsg(result.error || 'Visibility update failed.', 'error');
                return;
            }
            await refresh();
            showMsg(
                nextVisibility === 'public' ? 'Image published to Mempics.' : 'Image removed from Mempics.',
                'success',
            );
        });

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

        overlay.appendChild(publishButton);
        overlay.appendChild(deleteButton);
        item.appendChild(overlay);
        appendSelectionCheck(item);
        return item;
    }

    function buildFileCard(asset) {
        const item = document.createElement('article');
        const isSound = isAudioAsset(asset);
        const isVideo = isVideoAsset(asset);
        const hasSoundCover = isSound && asset.poster_url;
        item.className = `studio__image-item studio__image-item--file ${isSound ? 'studio__image-item--sound' : isVideo ? 'studio__image-item--video' : 'studio__image-item--text'}${hasSoundCover ? ' studio__image-item--has-cover' : ''}`;
        item.dataset.assetId = asset.id;
        item.dataset.assetType = isSound ? 'sound' : isVideo ? 'video' : 'text';
        item.title = getFileTitle(asset);

        if (hasSoundCover) {
            item.appendChild(buildSoundCoverBackground(asset));
        }

        const badge = document.createElement('span');
        badge.className = `studio__asset-badge ${isSound ? 'studio__asset-badge--sound' : isVideo ? 'studio__asset-badge--video' : 'studio__asset-badge--text'}`;
        badge.textContent = getFileBadge(asset);
        item.appendChild(badge);

        const title = document.createElement('h3');
        title.className = 'studio__asset-title';
        title.textContent = getFileTitle(asset);
        item.appendChild(title);

        if (!isVideo && !isSound) {
            const preview = document.createElement('p');
            preview.className = 'studio__asset-preview';
            preview.textContent = getFilePreview(asset);
            item.appendChild(preview);
        }

        if (isSound && asset.file_url) {
            const playIndicator = buildSoundPlayIndicator();
            item.appendChild(playIndicator);

            const audio = document.createElement('audio');
            audio.className = 'studio__asset-audio';
            audio.controls = true;
            audio.preload = 'none';
            audio.src = asset.file_url;
            bindSoundPlaybackIndicator(audio, playIndicator);
            item.appendChild(audio);
        } else if (isVideo) {
            const videoTrigger = document.createElement('button');
            videoTrigger.type = 'button';
            videoTrigger.className = 'studio__asset-video-trigger';
            videoTrigger.setAttribute('aria-label', `Open video ${getFileTitle(asset)}`);
            videoTrigger.disabled = !asset.file_url;
            videoTrigger.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (selectMode) {
                    toggleSelection(item);
                    return;
                }
                openVideoAsset(asset);
            });

            if (asset.poster_url) {
                const posterImg = document.createElement('img');
                posterImg.className = 'studio__asset-poster';
                posterImg.src = asset.poster_url;
                posterImg.alt = getFileTitle(asset);
                posterImg.loading = 'lazy';
                posterImg.decoding = 'async';
                if (asset.poster_width) posterImg.width = asset.poster_width;
                if (asset.poster_height) posterImg.height = asset.poster_height;
                videoTrigger.appendChild(posterImg);
            } else {
                const fallback = document.createElement('div');
                fallback.className = 'studio__asset-video-fallback';

                const fallbackIcon = document.createElement('span');
                fallbackIcon.className = 'studio__asset-video-fallback-icon';
                fallbackIcon.setAttribute('aria-hidden', 'true');
                fallbackIcon.textContent = '\u25B6';

                const fallbackLabel = document.createElement('span');
                fallbackLabel.className = 'studio__asset-video-fallback-label';
                fallbackLabel.textContent = 'Play video';

                fallback.append(fallbackIcon, fallbackLabel);
                videoTrigger.appendChild(fallback);
            }

            item.appendChild(videoTrigger);
        }

        const meta = document.createElement('div');
        meta.className = 'studio__asset-meta';
        meta.textContent = [
            formatAssetDate(asset.created_at),
            asset.file_name || '',
            formatAssetSize(asset.size_bytes),
        ].filter(Boolean).join(' · ');
        item.appendChild(meta);

        if (isVideo || isSound) {
            const isPublished = isPublishedAsset(asset);
            const visBadge = document.createElement('span');
            visBadge.className = `studio__image-visibility ${isPublished ? 'studio__image-visibility--public' : 'studio__image-visibility--private'}`;
            visBadge.textContent = isPublished ? 'Public' : 'Private';
            item.appendChild(visBadge);
        }

        const actions = document.createElement('div');
        actions.className = 'studio__asset-actions';

        if (isVideo || isSound) {
            const isPublished = isPublishedAsset(asset);
            const pubBtn = document.createElement('button');
            pubBtn.type = 'button';
            pubBtn.className = `studio__image-publish studio__image-publish--inline ${isPublished ? 'studio__image-publish--public' : ''}`;
            pubBtn.textContent = isPublished ? 'Unpublish' : 'Publish';
            pubBtn.addEventListener('click', async (event) => {
                event.stopPropagation();
                const nextVis = isPublishedAsset(asset) ? 'private' : 'public';
                pubBtn.disabled = true;
                pubBtn.textContent = '\u2026';
                const result = await updateAssetPublication(asset, nextVis);
                if (!result.ok) {
                    pubBtn.disabled = false;
                    pubBtn.textContent = isPublishedAsset(asset) ? 'Unpublish' : 'Publish';
                    showMsg(result.error || 'Visibility update failed.', 'error');
                    return;
                }
                await refresh();
                const labels = getPublicationLabels(asset);
                showMsg(nextVis === 'public' ? labels.publish : labels.unpublish, 'success');
            });
            actions.appendChild(pubBtn);
        }

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'studio__image-delete studio__image-delete--inline';
        deleteButton.textContent = 'Delete';
        deleteButton.addEventListener('click', async (event) => {
            event.stopPropagation();
            const confirmText = isSound
                ? 'Delete this sound file?'
                : isVideo
                    ? 'Delete this video asset?'
                    : 'Delete this saved asset?';
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
            showMsg(isSound ? 'Sound file deleted.' : isVideo ? 'Video asset deleted.' : 'Asset deleted.', 'success');
        });
        actions.appendChild(deleteButton);

        if (!isSound && !isVideo && asset.file_url) {
            item.setAttribute('role', 'button');
            item.tabIndex = 0;
            item.setAttribute('aria-label', `Open ${getFileTitle(asset)}`);
            item.addEventListener('click', (event) => {
                if (event.defaultPrevented) return;
                if (selectMode) return;
                if (event.target.closest('button, a, audio, summary, details, .studio__image-check')) return;
                openTextAsset(asset);
            });
            item.addEventListener('keydown', (event) => {
                if (selectMode) return;
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                openTextAsset(asset);
            });
        }

        item.appendChild(actions);
        appendSelectionCheck(item);
        return item;
    }

    async function loadGallery({ append = false } = {}) {
        if (selectMode) exitSelectMode();
        const requestId = ++assetLoadSeq;
        const filterValue = $galleryFilter.value;
        const isAllAssets = filterValue === ALL_ASSETS || filterValue === '';
        const isUnfoldered = filterValue === UNFOLDERED;
        const folderId = (!isAllAssets && !isUnfoldered && filterValue) ? filterValue : null;

        $assetGrid.style.display = '';
        if (!append) {
            assetLoadingMore = false;
            assetNextCursor = null;
            assetHasMore = false;
            clearActiveSoundIndicator();
            $assetGrid.innerHTML = '';
            const loading = document.createElement('div');
            loading.className = 'studio__gallery-empty';
            loading.textContent = 'Loading…';
            $assetGrid.appendChild(loading);
            updateAssetPaginationUi();
        } else {
            assetLoadingMore = true;
            updateAssetPaginationUi();
        }

        let page;
        try {
            page = await apiAiGetAssets(folderId, {
                onlyUnfoldered: isUnfoldered,
                limit: SAVED_ASSET_PAGE_LIMIT,
                cursor: append ? assetNextCursor : null,
            });
        } catch (error) {
            console.warn('Failed to load gallery:', error);
            if (requestId !== assetLoadSeq) return;
            assetLoadingMore = false;
            if (append) {
                updateAssetPaginationUi();
                showMsg('Could not load more saved assets.', 'error');
                return;
            }
            currentAssets = [];
            renderEmptyState();
            showMsg('Could not load saved assets.', 'error');
            return;
        }

        if (requestId !== assetLoadSeq) return;
        hideMsg();

        const assets = Array.isArray(page?.assets) ? page.assets : [];
        assetNextCursor = page?.nextCursor || null;
        assetHasMore = page?.hasMore === true;
        assetLoadingMore = false;

        currentAssets = append
            ? currentAssets.concat(assets)
            : assets.slice();
        if (currentAssets.length === 0) {
            renderEmptyState(emptyStateMessage);
            return;
        }

        $assetGrid.innerHTML = '';
        currentAssets.forEach((asset) => {
            $assetGrid.appendChild(isImageAsset(asset) ? buildImageCard(asset) : buildFileCard(asset));
        });
        assetDeck?.refresh();
        updateAssetPaginationUi();
    }

    function openFolder(folderId) {
        hideNewFolderForm();
        hideDeleteFolderForm();
        hideRenameForm();
        folderViewActive = false;
        $folderGrid.style.display = 'none';
        folderDeck?.setVisible(false);
        $assetGrid.style.display = '';
        $folderBack?.classList.add('visible');
        $galleryFilter.value = folderId;
        loadGallery();
        updateAssetPaginationUi();
    }

    function openAllAssets() {
        hideNewFolderForm();
        hideDeleteFolderForm();
        hideRenameForm();
        folderViewActive = false;
        $folderGrid.style.display = 'none';
        folderDeck?.setVisible(false);
        $assetGrid.style.display = '';
        $folderBack?.classList.add('visible');
        $galleryFilter.value = ALL_ASSETS;
        loadGallery();
        updateAssetPaginationUi();
    }

    function exitSelectMode() {
        if (!selectMode) return;
        selectMode = false;
        selectionScope = null;
        selectedIds.clear();
        $assetGrid.classList.remove('studio--selecting');
        $folderGrid.classList.remove('studio--selecting');
        delete $assetGrid.dataset.selectMode;
        delete $folderGrid.dataset.selectMode;
        $bulkBar?.classList.remove('visible');
        hideRenameForm();
        $bulkMoveForm?.classList.remove('visible');
        $galleryFilter.disabled = false;
        setSelectionRootActive(false);
        $assetGrid.querySelectorAll('.studio__image-item.selected').forEach((el) => {
            el.classList.remove('selected');
        });
        $folderGrid.querySelectorAll('.studio__folder-card.selected').forEach((el) => {
            el.classList.remove('selected');
        });
        updateBulkCount();
    }

    function enterSelectMode() {
        hideNewFolderForm();
        hideDeleteFolderForm();
        hideRenameForm();
        $bulkMoveForm?.classList.remove('visible');

        const folderScope = folderViewActive;
        const items = folderScope
            ? $folderGrid.querySelectorAll('.studio__folder-card[data-folder-id]')
            : $assetGrid.querySelectorAll('.studio__image-item[data-asset-id]');
        if (items.length === 0) {
            showMsg(
                folderScope ? 'No folders available to rename.' : 'No saved assets available to select.',
                'error',
            );
            return;
        }

        selectMode = true;
        selectionScope = folderScope ? 'folder' : 'asset';
        selectedIds.clear();
        if (folderScope) {
            $folderGrid.classList.add('studio--selecting');
            $folderGrid.dataset.selectMode = 'true';
        } else {
            $assetGrid.classList.add('studio--selecting');
            $assetGrid.dataset.selectMode = 'true';
        }
        $bulkBar?.classList.add('visible');
        $galleryFilter.disabled = true;
        setSelectionRootActive(true);
        updateBulkCount();
        hideMsg();
    }

    function toggleSelection(item) {
        const id = item.dataset.assetId || item.dataset.folderId;
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

    function showRenameForm() {
        if (selectedIds.size !== 1) {
            showMsg(`Select exactly one ${getSelectionContextLabel()} first.`, 'error');
            return;
        }
        const target = getSelectedEntity();
        if (!target) {
            showMsg(`Selected ${getSelectionContextLabel()} could not be loaded. Refresh and try again.`, 'error');
            return;
        }

        const config = getRenameTargetConfig(target);
        if (!config || !$renameInput) return;

        $bulkMoveForm?.classList.remove('visible');
        $renameInput.value = target.label || '';
        $renameInput.maxLength = config.maxLength;
        $renameInput.placeholder = config.placeholder;
        $renameForm?.classList.add('visible');
        $renameInput.focus();
        $renameInput.select();
    }

    async function handleRenameConfirm() {
        const target = getSelectedEntity();
        if (!target) {
            showMsg(`Select exactly one ${getSelectionContextLabel()} first.`, 'error');
            return;
        }

        const nextName = $renameInput?.value || '';
        if ($renameConfirm) {
            $renameConfirm.disabled = true;
            $renameConfirm.textContent = '\u2026';
        }

        let result;
        if (target.kind === 'folder') {
            result = await apiAiRenameFolder(target.id, nextName);
        } else if (isImageAsset(target.asset)) {
            result = await apiAiRenameImage(target.id, nextName);
        } else {
            result = await apiAiRenameTextAsset(target.id, nextName);
        }

        if ($renameConfirm) {
            $renameConfirm.disabled = false;
            $renameConfirm.textContent = 'Rename';
        }
        if (!result.ok) {
            showMsg(result.error || 'Rename failed.', 'error');
            return;
        }

        hideRenameForm();
        const config = getRenameTargetConfig(target);
        if (result.data?.unchanged) {
            showMsg(`${config?.successLabel || 'Item'} name unchanged.`, 'success');
            return;
        }

        const selectedId = target.id;
        const selectedScope = selectionScope;
        await refresh({ preserveView: true });
        await restoreSingleSelection(selectedId, selectedScope);
        showMsg(`${config?.successLabel || 'Item'} renamed.`, 'success');
    }

    function showBulkMoveForm() {
        if (selectionScope === 'folder') {
            showMsg('Move is only available for saved assets.', 'error');
            return;
        }
        if (selectedIds.size === 0) {
            showMsg('Select at least one asset first.', 'error');
            return;
        }
        hideRenameForm();
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
        if (selectionScope === 'folder') {
            showMsg('Delete is only available from the folder delete action.', 'error');
            return;
        }
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
        hideRenameForm();
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
        hideRenameForm();
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
        $bulkRename?.addEventListener('click', showRenameForm);
        $bulkMove?.addEventListener('click', showBulkMoveForm);
        $bulkDelete?.addEventListener('click', handleBulkDelete);
        $bulkCancel?.addEventListener('click', exitSelectMode);
        $renameConfirm?.addEventListener('click', handleRenameConfirm);
        $renameCancel?.addEventListener('click', hideRenameForm);
        $renameInput?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                handleRenameConfirm();
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                hideRenameForm();
            }
        });
        $bulkMoveConfirm?.addEventListener('click', handleBulkMoveConfirm);
        $bulkMoveCancel?.addEventListener('click', () => {
            $bulkMoveForm?.classList.remove('visible');
        });
        $assetLoadMore.addEventListener('click', () => {
            if (!assetHasMore || assetLoadingMore) return;
            loadGallery({ append: true });
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
