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
    openStudioImageModal,
    openStudioVideoModal,
} from './studio-deck.js?v=__ASSET_VERSION__';
import {
    getMobileMediaGridQuery,
    openMobileMediaGrid,
    syncMobileMediaTrigger,
} from './mobile-media-grid-overlay.js?v=__ASSET_VERSION__';
import { getCurrentLocale, localeText } from './locale.js?v=__ASSET_VERSION__';
import { formatAssetStorageUsage, formatStorageBytes } from './storage-format.js?v=__ASSET_VERSION__';

const UNFOLDERED = '__unfoldered__';
const ALL_ASSETS = '__all__';
const MAX_BULK_SELECT = 50;
const MAX_FOLDER_NAME_LENGTH = 100;
const MAX_IMAGE_NAME_LENGTH = 1000;
const MAX_FILE_ASSET_NAME_LENGTH = 120;
const SAVED_ASSET_PAGE_LIMIT = 60;
const SAVED_ASSET_MOBILE_DOT_LIMIT = 6;
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

function formatAssetCount(count) {
    const number = Number(count || 0);
    if (getCurrentLocale() === 'de') {
        return `${number} Asset${number === 1 ? '' : 's'}`;
    }
    return `${number} asset${number === 1 ? '' : 's'}`;
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
    if (asset?.title) return asset.title;
    if (isAudioAsset(asset)) return localeText('assets.savedAudioAsset');
    return asset?.file_name
        || (isVideoAsset(asset)
            ? localeText('assets.savedVideoAsset')
            : localeText('assets.savedAsset'));
}

function getFilePreview(asset) {
    if (asset?.preview_text) return asset.preview_text;
    if (isAudioAsset(asset)) return `${localeText('assets.savedAudioAsset')}.`;
    if (isVideoAsset(asset)) return `${localeText('assets.savedVideoAsset')}.`;
    return localeText('assets.savedAiLabAsset');
}

function getAssetTypeLabel(asset) {
    if (isImageAsset(asset)) return localeText('assets.image');
    if (isAudioAsset(asset)) return localeText('assets.soundAsset');
    if (isVideoAsset(asset)) return localeText('assets.videoAsset');
    return localeText('assets.asset');
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
        return String(asset?.title || asset?.prompt || asset?.preview_text || localeText('assets.savedImage')).trim();
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
            placeholder: localeText('assets.folderName'),
            successLabel: localeText('assets.folder'),
        };
    }
    if (isImageAsset(target.asset)) {
        return {
            maxLength: MAX_IMAGE_NAME_LENGTH,
            placeholder: localeText('assets.imageName'),
            successLabel: localeText('assets.image'),
        };
    }
    return {
        maxLength: MAX_FILE_ASSET_NAME_LENGTH,
        placeholder: localeText('assets.assetName'),
        successLabel: isAudioAsset(target.asset)
            ? localeText('assets.soundAsset')
            : isVideoAsset(target.asset)
                ? localeText('assets.videoAsset')
                : localeText('assets.asset'),
    };
}

function getImagePreviewState(asset) {
    const status = asset?.derivatives_status || 'pending';
    if (status === 'failed') {
        return {
            variant: 'failed',
            label: localeText('assets.previewUnavailable'),
            hint: localeText('assets.previewUnavailableHint'),
        };
    }
    if (status === 'processing') {
        return {
            variant: 'pending',
            label: localeText('assets.preparingPreview'),
            hint: localeText('assets.preparingPreviewHint'),
        };
    }
    return {
        variant: 'pending',
        label: localeText('assets.previewPending'),
        hint: localeText('assets.previewPendingHint'),
    };
}

function getVideoPosterPreviewState(asset) {
    if (asset?.poster_url) return null;
    const status = String(asset?.poster_status || '').toLowerCase();
    if (status === 'failed') {
        return {
            variant: 'failed',
            label: localeText('assets.videoPosterFailed'),
            hint: asset?.poster_message || localeText('assets.videoPosterFailedHint'),
        };
    }
    if (status === 'pending' || status === 'queued' || status === 'processing') {
        return {
            variant: 'pending',
            label: localeText('assets.videoPosterPending'),
            hint: asset?.poster_message || localeText('assets.videoPosterPendingHint'),
        };
    }
    return null;
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
    title.textContent = asset.title || asset.preview_text || localeText('assets.savedImage');
    placeholder.appendChild(title);

    const hint = document.createElement('span');
    hint.className = 'studio__image-preview-hint';
    hint.textContent = state.hint;
    placeholder.appendChild(hint);

    return placeholder;
}

function buildVideoPosterPlaceholder(asset) {
    const state = getVideoPosterPreviewState(asset);
    const fallback = document.createElement('div');
    fallback.className = `studio__asset-video-fallback${state ? ` studio__asset-video-fallback--${state.variant}` : ''}`;

    const fallbackIcon = document.createElement('span');
    fallbackIcon.className = 'studio__asset-video-fallback-icon';
    fallbackIcon.setAttribute('aria-hidden', 'true');
    fallbackIcon.textContent = state ? 'i' : '\u25B6';

    const fallbackLabel = document.createElement('span');
    fallbackLabel.className = 'studio__asset-video-fallback-label';
    fallbackLabel.textContent = state?.label || localeText('assets.playVideo');

    fallback.append(fallbackIcon, fallbackLabel);
    if (state?.hint) {
        const fallbackHint = document.createElement('span');
        fallbackHint.className = 'studio__asset-video-fallback-hint';
        fallbackHint.textContent = state.hint;
        fallback.appendChild(fallbackHint);
    }
    return fallback;
}

function getDeleteResultPayload(result) {
    if (result?.data?.data && typeof result.data.data === 'object') return result.data.data;
    if (result?.data && typeof result.data === 'object') return result.data;
    return {};
}

function getDeleteResultCode(result) {
    return getDeleteResultPayload(result)?.code || result?.data?.code || result?.code || '';
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
            publish: localeText('assets.imagePublished'),
            unpublish: localeText('assets.imageUnpublished'),
        };
    }
    if (isAudioAsset(asset)) {
        return {
            publish: localeText('assets.publishTrack'),
            unpublish: localeText('assets.unpublishTrack'),
        };
    }
    if (isVideoAsset(asset)) {
        return {
            publish: localeText('assets.publishVideo'),
            unpublish: localeText('assets.unpublishVideo'),
        };
    }
    return {
        publish: localeText('assets.assetPublished'),
        unpublish: localeText('assets.assetUnpublished'),
    };
}

function normalizeFolders(result) {
    return {
        folders: Array.isArray(result?.folders) ? result.folders : [],
        counts: result?.counts || {},
        unfolderedCount: result?.unfolderedCount || 0,
        storageUsage: result?.storageUsage || null,
    };
}

function populateFolderOptions(selectEl, folders, placeholder = localeText('assets.assets')) {
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
        { value: '', label: localeText('assets.allFolders') },
        { value: ALL_ASSETS, label: localeText('assets.allAssets') },
        { value: UNFOLDERED, label: localeText('assets.assets') },
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
    emptyStateMessage = localeText('assets.empty'),
    emptyStateTitle = localeText('assets.emptyStateTitle'),
    emptyStateCtaLabel = localeText('assets.emptyStateCta'),
    emptyStateCtaHref,
    loadFailedMessage = localeText('assets.couldNotLoadAssetsHelp'),
    loadFailedTitle = localeText('assets.loadFailedTitle'),
    loadFailedCtaLabel = '',
    loadFailedCtaHref = '',
    emptyListStatus = localeText('assets.listEmptyStatus'),
    loadFailedListStatus = localeText('assets.listLoadFailedStatus'),
    foldersUnavailableMessage = localeText('assets.foldersUnavailable'),
    handoffActive = false,
    onFoldersChange = null,
    onUploadVideo = null,
} = {}) {
    const root = refs.root;
    const $galleryFilter = refs.galleryFilter;
    const $storageUsage = refs.storageUsage;
    const $storageInsight = refs.storageInsight;
    const $folderGrid = refs.folderGrid;
    const $folderBack = refs.folderBack;
    const $folderBackBtn = refs.folderBackBtn;
    const $assetGrid = refs.assetGrid;
    const $galleryMsg = refs.galleryMsg;
    const $listStatus = refs.listStatus;
    const $viewContext = refs.viewContext;
    const $viewContextTitle = refs.viewContextTitle;
    const $viewContextCopy = refs.viewContextCopy;
    const $viewScope = refs.viewScope;
    const $viewOrder = refs.viewOrder;
    const $viewRefresh = refs.viewRefresh;
    const $viewShowAll = refs.viewShowAll;
    const $uploadVideoBtn = refs.uploadVideoBtn;
    const $viewGenerateLab = refs.viewGenerateLab;
    const $viewCredits = refs.viewCredits;
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
    const $selectionGuide = refs.selectionGuide;
    const $selectionGuideCopy = refs.selectionGuideCopy;
    const $selectionGuideStatus = refs.selectionGuideStatus;
    const $renameForm = refs.renameForm;
    const $renameInput = refs.renameInput;
    const $renameConfirm = refs.renameConfirm;
    const $renameCancel = refs.renameCancel;
    const $bulkMoveForm = refs.bulkMoveForm;
    const $bulkMoveSummary = refs.bulkMoveSummary;
    const $bulkMoveSelect = refs.bulkMoveSelect;
    const $bulkMoveConfirm = refs.bulkMoveConfirm;
    const $bulkMoveCancel = refs.bulkMoveCancel;
    const $actionResult = refs.actionResult;
    const $actionResultTitle = refs.actionResultTitle;
    const $actionResultCopy = refs.actionResultCopy;
    const $actionResultMeta = refs.actionResultMeta;
    const $actionResultActions = refs.actionResultActions;

    if (!$galleryFilter || !$folderGrid || !$assetGrid) {
        return {
            init: async () => {},
            show: async () => {},
            refresh: async () => {},
            openAllAssets: async () => {},
            getViewState: () => ({ folderViewActive: true, assetCount: 0, filterValue: '' }),
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
    const mobileMediaQuery = getMobileMediaGridQuery();

    const $assetPagination = document.createElement('div');
    $assetPagination.className = 'studio__pagination';
    $assetPagination.style.display = 'none';

    const $assetPaginationStatus = document.createElement('div');
    $assetPaginationStatus.className = 'studio__pagination-status';

    const $assetMobileGridTrigger = document.createElement('button');
    $assetMobileGridTrigger.type = 'button';
    $assetMobileGridTrigger.className = 'studio__mobile-grid-trigger browse-pagination__status';
    $assetMobileGridTrigger.hidden = true;

    const $assetLoadMore = document.createElement('button');
    $assetLoadMore.type = 'button';
    $assetLoadMore.className = 'studio__pagination-btn';
    $assetLoadMore.textContent = localeText('assets.loadMore');

    $assetPagination.append($assetPaginationStatus, $assetMobileGridTrigger, $assetLoadMore);
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

    function buildActionResultButton(label, onClick) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'studio__action-result-action';
        button.textContent = label;
        button.addEventListener('click', onClick);
        return button;
    }

    function setActionResult({
        type = 'info',
        title = '',
        copy = '',
        meta = '',
        toast = '',
        actions = [],
    } = {}) {
        if (!$actionResult || !$actionResultTitle || !$actionResultCopy) {
            showMsg(toast || title || copy, type === 'error' ? 'error' : type === 'success' ? 'success' : 'info');
            return;
        }

        $actionResult.hidden = false;
        $actionResult.dataset.result = type;
        $actionResultTitle.textContent = title;
        $actionResultCopy.textContent = copy;
        if ($actionResultMeta) {
            $actionResultMeta.textContent = meta || '';
            $actionResultMeta.hidden = !meta;
        }
        if ($actionResultActions) {
            $actionResultActions.replaceChildren();
            actions
                .filter((action) => action && action.label && typeof action.onClick === 'function')
                .forEach((action) => {
                    $actionResultActions.appendChild(buildActionResultButton(action.label, action.onClick));
                });
            $actionResultActions.hidden = !$actionResultActions.children.length;
        }

        showMsg(toast || title || copy, type === 'error' ? 'error' : type === 'success' ? 'success' : 'info');
        if (mobileMediaQuery?.matches) {
            $actionResult.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

    function getRefreshResultAction() {
        return {
            label: localeText('assets.actionRefresh'),
            onClick: () => {
                refresh().catch(() => showMsg(localeText('assets.viewRefreshFailed'), 'error'));
            },
        };
    }

    function getShowAllResultAction() {
        return {
            label: localeText('assets.actionShowAll'),
            onClick: () => {
                openAllAssets().catch(() => showMsg(localeText('assets.viewShowAllFailed'), 'error'));
            },
        };
    }

    function getContinueSelectionAction() {
        return {
            label: localeText('assets.actionContinueSelection'),
            onClick: () => {
                $bulkMoveForm?.classList.remove('visible');
                updateBulkCount();
            },
        };
    }

    function getCancelSelectionAction() {
        return {
            label: localeText('assets.actionCancelSelection'),
            onClick: () => exitSelectMode(),
        };
    }

    function getOpenTargetFolderAction(folderId, targetLabel) {
        if (!folderId) {
            return {
                label: localeText('assets.actionOpenUnfoldered'),
                onClick: () => {
                    openAllAssets()
                        .then(() => {
                            $galleryFilter.value = UNFOLDERED;
                            return loadGallery();
                        })
                        .catch(() => showMsg(localeText('assets.viewShowAllFailed'), 'error'));
                },
            };
        }
        return {
            label: localeText('assets.actionOpenTargetFolder', { target: targetLabel || localeText('assets.folder') }),
            onClick: () => openFolder(folderId),
        };
    }

    function getFolderOverviewAction() {
        return {
            label: localeText('assets.actionFolderOverview'),
            onClick: () => showFolderView(),
        };
    }

    function setListStatus(text = '', view = '') {
        if (!$listStatus) return;
        $listStatus.textContent = text || '';
        $listStatus.hidden = !text;
        if (view) {
            $listStatus.dataset.view = view;
        } else {
            delete $listStatus.dataset.view;
        }
    }

    function getAssetVerb(count) {
        if (getCurrentLocale() !== 'de') return '';
        return count === 1 ? 'wird' : 'werden';
    }

    function getCurrentFolderName(filterValue) {
        if (filterValue === UNFOLDERED) return localeText('assets.assets');
        const folder = folders.find((entry) => entry.id === filterValue);
        return folder?.name || localeText('assets.folder');
    }

    function getFolderById(folderId) {
        return folders.find((entry) => entry.id === folderId) || null;
    }

    function getFolderCount(filterValue) {
        if (filterValue === UNFOLDERED) return Number(unfolderedCount || 0);
        if (filterValue && filterValue !== ALL_ASSETS) {
            if (!Object.prototype.hasOwnProperty.call(folderCounts, filterValue)) {
                return !folderViewActive && $galleryFilter.value === filterValue && currentAssets.length === 0
                    ? 0
                    : null;
            }
            const count = Number(folderCounts[filterValue]);
            return Number.isFinite(count) ? count : null;
        }
        return null;
    }

    function getGenerateLabHref() {
        return getCurrentLocale() === 'de'
            ? '/de/generate-lab/?source=assets-manager'
            : '/generate-lab/?source=assets-manager';
    }

    function getAssetFolderLabel(asset) {
        if (!asset?.folder_id) return localeText('assets.folderNone');
        const folder = folders.find((entry) => entry.id === asset.folder_id);
        return folder?.name || localeText('assets.folderUnknown');
    }

    function getCurrentAssetViewLabel() {
        if (folderViewActive) return localeText('assets.viewScopeOverview');
        const filterValue = $galleryFilter.value;
        if (filterValue === UNFOLDERED) return localeText('assets.viewScopeUnfoldered');
        if (filterValue && filterValue !== ALL_ASSETS) {
            return localeText('assets.viewScopeFolder', { folder: getCurrentFolderName(filterValue) });
        }
        return localeText('assets.viewScopeAll');
    }

    function getAssetVisibilityLabel(asset) {
        return isPublishedAsset(asset) ? localeText('assets.public') : localeText('assets.private');
    }

    function getAssetDetailRows(asset) {
        const rows = [
            { label: localeText('assets.detailType'), value: getAssetTypeLabel(asset) },
            { label: localeText('assets.detailFolder'), value: getAssetFolderLabel(asset) },
            { label: localeText('assets.detailCurrentView'), value: getCurrentAssetViewLabel() },
            { label: localeText('assets.detailVisibility'), value: getAssetVisibilityLabel(asset) },
        ];
        const created = formatAssetDate(asset?.created_at);
        if (created) rows.push({ label: localeText('assets.detailCreated'), value: created });
        const updated = formatAssetDate(asset?.updated_at);
        if (updated) rows.push({ label: localeText('assets.detailUpdated'), value: updated });
        if (!isImageAsset(asset) && asset?.file_name) {
            rows.push({ label: localeText('assets.detailFile'), value: String(asset.file_name) });
        }
        const size = formatAssetSize(asset?.size_bytes);
        if (size) rows.push({ label: localeText('assets.detailSize'), value: size });
        const source = String(asset?.source_module || '').trim();
        if (source) {
            rows.push({
                label: localeText('assets.detailSource'),
                value: source.replace(/_/g, ' '),
            });
        }
        return rows;
    }

    function getAssetDetailModalOptions(asset, title) {
        return {
            ariaLabel: localeText('assets.detailDialogLabel', { title }),
            eyebrow: localeText('assets.detailEyebrow'),
            openLabel: localeText('assets.openOriginalAsset'),
            openTitle: localeText('assets.openOriginalAsset'),
            closeLabel: localeText('assets.closePreview'),
            closeTitle: localeText('assets.closePreview'),
            imageAlt: title,
            imageErrorAlt: localeText('assets.previewLoadFailedAlt'),
            details: getAssetDetailRows(asset),
            statusText: localeText('assets.detailSafeStatus'),
        };
    }

    function getViewContextValues() {
        const count = currentAssets.length;
        const filterValue = $galleryFilter.value;
        return {
            count,
            countLabel: formatAssetCount(count),
            verb: getAssetVerb(count),
            folder: getCurrentFolderName(filterValue),
        };
    }

    function setViewContext({ titleKey, copyKey, scopeKey, orderKey = 'assets.viewOrderRecent', values = {} } = {}) {
        if (!$viewContext) return;
        const merged = {
            ...getViewContextValues(),
            ...values,
        };
        if ($viewContextTitle && titleKey) $viewContextTitle.textContent = localeText(titleKey, merged);
        if ($viewContextCopy && copyKey) $viewContextCopy.textContent = localeText(copyKey, merged);
        if ($viewScope && scopeKey) $viewScope.textContent = localeText(scopeKey, merged);
        if ($viewOrder && orderKey) $viewOrder.textContent = localeText(orderKey, merged);
    }

    function updateViewContext(mode = 'current') {
        if (!$viewContext) return;
        const filterValue = $galleryFilter.value;
        const values = getViewContextValues();

        if (mode === 'loading') {
            setViewContext({
                titleKey: 'assets.viewLoadingTitle',
                copyKey: handoffActive ? 'assets.viewHandoffLoadingCopy' : 'assets.viewLoadingCopy',
                scopeKey: folderViewActive ? 'assets.viewScopeOverview' : 'assets.viewScopeAll',
                values,
            });
            return;
        }

        if (mode === 'error') {
            setViewContext({
                titleKey: handoffActive ? 'assets.viewHandoffErrorTitle' : 'assets.viewLoadFailedTitle',
                copyKey: handoffActive ? 'assets.viewHandoffErrorCopy' : 'assets.viewLoadFailedCopy',
                scopeKey: folderViewActive ? 'assets.viewScopeOverview' : 'assets.viewScopeAll',
                values,
            });
            return;
        }

        if (mode === 'empty' && handoffActive) {
            setViewContext({
                titleKey: 'assets.viewHandoffEmptyTitle',
                copyKey: 'assets.viewHandoffEmptyCopy',
                scopeKey: filterValue === UNFOLDERED
                    ? 'assets.viewScopeUnfoldered'
                    : (filterValue && filterValue !== ALL_ASSETS ? 'assets.viewScopeFolder' : 'assets.viewScopeAll'),
                values,
            });
            return;
        }

        if (folderViewActive) {
            setViewContext({
                titleKey: 'assets.viewOverviewTitle',
                copyKey: handoffActive ? 'assets.viewHandoffOverviewCopy' : 'assets.viewOverviewCopy',
                scopeKey: 'assets.viewScopeOverview',
                values,
            });
            return;
        }

        if (filterValue === UNFOLDERED) {
            setViewContext({
                titleKey: 'assets.viewUnfolderedTitle',
                copyKey: 'assets.viewUnfolderedCopy',
                scopeKey: 'assets.viewScopeUnfoldered',
                values,
            });
            return;
        }

        if (filterValue && filterValue !== ALL_ASSETS) {
            setViewContext({
                titleKey: 'assets.viewFolderTitle',
                copyKey: 'assets.viewFolderCopy',
                scopeKey: 'assets.viewScopeFolder',
                values,
            });
            return;
        }

        setViewContext({
            titleKey: handoffActive ? 'assets.viewHandoffAllTitle' : 'assets.viewAllTitle',
            copyKey: handoffActive ? 'assets.viewHandoffAllCopy' : 'assets.viewAllCopy',
            scopeKey: 'assets.viewScopeAll',
            values,
        });
    }

    function setCurrentAssetViewStatus() {
        const count = currentAssets.length;
        const filterValue = $galleryFilter.value;
        const values = {
            count,
            countLabel: formatAssetCount(count),
            verb: getAssetVerb(count),
            folder: getCurrentFolderName(filterValue),
        };
        if (filterValue === UNFOLDERED) {
            setListStatus(localeText('assets.unfolderedViewStatus', values), 'unfoldered');
            updateViewContext();
            return;
        }
        if (filterValue && filterValue !== ALL_ASSETS) {
            setListStatus(localeText('assets.folderFilteredStatus', values), 'folder');
            updateViewContext();
            return;
        }
        setListStatus(localeText('assets.listNewestFirstStatus', values), 'all');
        updateViewContext();
    }

    function getStorageInsightText(storageUsage, usageText) {
        if (!usageText) return localeText('assets.storageInsightUnavailable');
        if (storageUsage?.isUnlimited === true) {
            return localeText('assets.storageInsightUnlimited', { usage: usageText });
        }

        const usedBytes = Number(storageUsage?.usedBytes);
        const limitBytes = Number(storageUsage?.limitBytes);
        const providedRemainingBytes = Number(storageUsage?.remainingBytes);
        const remainingBytes = Number.isFinite(providedRemainingBytes)
            ? providedRemainingBytes
            : limitBytes - usedBytes;

        if (!Number.isFinite(usedBytes) || !Number.isFinite(limitBytes) || limitBytes <= 0 || !Number.isFinite(remainingBytes)) {
            return localeText('assets.storageInsightUnavailable');
        }

        const remaining = formatStorageBytes(Math.max(0, remainingBytes));
        const key = usedBytes / limitBytes >= 0.85
            ? 'assets.storageInsightNearLimit'
            : 'assets.storageInsightRemaining';
        return localeText(key, { usage: usageText, remaining });
    }

    function updateStorageUsage(storageUsage) {
        const text = formatAssetStorageUsage(storageUsage);
        if ($storageInsight) {
            $storageInsight.textContent = getStorageInsightText(storageUsage, text);
        }

        if (!$storageUsage) return;
        if (!text) {
            $storageUsage.hidden = true;
            $storageUsage.textContent = '';
            return;
        }
        const label = localeText('assets.storageUsageLabel');
        $storageUsage.hidden = false;
        $storageUsage.textContent = text;
        $storageUsage.title = label;
        $storageUsage.setAttribute('aria-label', `${label}: ${text}`);
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

    function openImageAsset(asset) {
        const previewUrl = asset?.medium_url || asset?.original_url || asset?.file_url || asset?.thumb_url || '';
        const originalUrl = asset?.original_url || asset?.file_url || previewUrl;
        if (!previewUrl) return;
        const title = asset?.title || asset?.preview_text || localeText('assets.savedImage');
        openStudioImageModal(
            previewUrl,
            title,
            originalUrl,
            getAssetDetailModalOptions(asset, title),
        );
    }

    function openVideoAsset(asset) {
        if (!asset?.file_url) return;
        openStudioVideoModal({
            videoUrl: asset.file_url,
            title: getFileTitle(asset),
            posterUrl: asset.poster_url || '',
            ariaLabel: localeText('assets.detailDialogLabel', { title: getFileTitle(asset) }),
            eyebrow: localeText('assets.detailEyebrow'),
            closeLabel: localeText('assets.closePreview'),
            closeTitle: localeText('assets.closePreview'),
            details: getAssetDetailRows(asset),
            statusText: localeText('assets.detailSafeStatus'),
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

    async function handleExternalStorageChange() {
        if (!$storageUsage || !initialized) return;
        await refresh({ preserveView: true });
    }

    function localizeWorkspaceLinks() {
        const isGerman = getCurrentLocale() === 'de';
        if ($viewGenerateLab) {
            $viewGenerateLab.href = isGerman
                ? '/de/generate-lab/?source=assets-manager&step=create'
                : '/generate-lab/?source=assets-manager&step=create';
        }
        if ($viewCredits) {
            $viewCredits.href = isGerman
                ? '/de/account/credits.html?scope=member&source=assets-manager'
                : '/account/credits.html?scope=member&source=assets-manager';
        }
    }

    async function handleViewRefresh() {
        if (!$viewRefresh) return;
        const readyLabel = $viewRefresh.textContent;
        $viewRefresh.disabled = true;
        $viewRefresh.textContent = localeText('assets.viewRefreshStarted');
        setListStatus(localeText('assets.viewRefreshStarted'), 'loading');
        updateViewContext('loading');
        try {
            await refresh({ preserveView: false });
            await openAllAssets();
            setListStatus(localeText('assets.viewRefreshDone'), 'all');
        } catch (error) {
            console.warn('Saved assets refresh failed:', error);
            setListStatus(localeText('assets.viewRefreshFailed'), 'error');
            showMsg(localeText('assets.viewRefreshFailed'), 'error');
        } finally {
            $viewRefresh.disabled = false;
            $viewRefresh.textContent = readyLabel;
            updateViewContext();
        }
    }

    async function handleViewShowAll() {
        if (!$viewShowAll) return;
        const readyLabel = $viewShowAll.textContent;
        $viewShowAll.disabled = true;
        $viewShowAll.textContent = localeText('assets.viewShowAllStarted');
        setListStatus(localeText('assets.viewShowAllStarted'), 'loading');
        updateViewContext('loading');
        try {
            await openAllAssets();
            setListStatus(localeText('assets.viewShowAllDone'), 'all');
            showMsg(localeText('assets.viewShowAllDone'), 'success');
        } catch (error) {
            console.warn('Saved assets show-all failed:', error);
            setListStatus(localeText('assets.viewShowAllFailed'), 'error');
            showMsg(localeText('assets.viewShowAllFailed'), 'error');
        } finally {
            $viewShowAll.disabled = false;
            $viewShowAll.textContent = readyLabel;
            updateViewContext();
        }
    }

    function getCreateToolsHref() {
        return getCurrentLocale() === 'de' ? '/de/#gallery' : '/#gallery';
    }

    function getFolderEmptyActions() {
        return [
            {
                label: localeText('assets.emptyFolderShowAll'),
                onClick: () => openAllAssets(),
            },
            {
                label: localeText('assets.emptyFolderBack'),
                onClick: () => showFolderView(),
                variant: 'secondary',
            },
            {
                label: localeText('assets.emptyFolderCreate'),
                href: getGenerateLabHref(),
                variant: 'secondary',
            },
        ];
    }

    function getCurrentEmptyStateOptions(filterValue) {
        if (filterValue === UNFOLDERED) {
            return {
                title: localeText('assets.emptyUnfolderedTitle'),
                message: handoffActive
                    ? localeText('assets.emptyUnfolderedHandoffCopy')
                    : localeText('assets.emptyUnfolderedCopy'),
                listStatus: localeText('assets.emptyUnfolderedStatus'),
                statusView: 'empty',
                actions: getFolderEmptyActions(),
                ctaHref: '',
                ctaLabel: '',
            };
        }

        if (filterValue && filterValue !== ALL_ASSETS) {
            const folder = getCurrentFolderName(filterValue);
            return {
                title: localeText('assets.emptyFolderTitle', { folder }),
                message: localeText(
                    handoffActive ? 'assets.emptyFolderHandoffCopy' : 'assets.emptyFolderCopy',
                    { folder },
                ),
                listStatus: localeText('assets.emptyFolderStatus', { folder }),
                statusView: 'empty',
                actions: getFolderEmptyActions(),
                ctaHref: '',
                ctaLabel: '',
            };
        }

        return null;
    }

    function renderEmptyState(message = emptyStateMessage, options = {}) {
        currentAssets = [];
        assetNextCursor = null;
        assetHasMore = false;
        assetLoadingMore = false;
        clearActiveSoundIndicator();
        $assetGrid.innerHTML = '';
        const empty = document.createElement('div');
        empty.className = 'studio__gallery-empty';
        const title = document.createElement('h3');
        title.className = 'studio__gallery-empty-title';
        title.textContent = options.title || emptyStateTitle;

        const copy = document.createElement('p');
        copy.className = 'studio__gallery-empty-copy';
        copy.textContent = message;

        empty.append(title, copy);

        const ctaHref = options.ctaHref === undefined
            ? (emptyStateCtaHref === undefined ? getCreateToolsHref() : emptyStateCtaHref)
            : options.ctaHref;
        const ctaLabel = options.ctaLabel === undefined ? emptyStateCtaLabel : options.ctaLabel;
        if (ctaHref && ctaLabel) {
            const cta = document.createElement('a');
            cta.className = 'studio__gallery-empty-link';
            cta.href = ctaHref;
            cta.textContent = ctaLabel;
            empty.appendChild(cta);
        }

        if (Array.isArray(options.actions) && options.actions.length > 0) {
            const actions = document.createElement('div');
            actions.className = 'studio__gallery-empty-actions';
            options.actions.forEach((action) => {
                const control = action.href ? document.createElement('a') : document.createElement('button');
                control.className = `studio__gallery-empty-link${action.variant ? ` studio__gallery-empty-link--${action.variant}` : ''}`;
                if (action.href) {
                    control.href = action.href;
                } else {
                    control.type = 'button';
                    if (typeof action.onClick === 'function') {
                        control.addEventListener('click', action.onClick);
                    }
                }
                control.textContent = action.label;
                actions.appendChild(control);
            });
            empty.appendChild(actions);
        }

        $assetGrid.appendChild(empty);
        updateAssetPaginationUi();
        setListStatus(
            options.listStatus === undefined ? emptyListStatus : options.listStatus,
            options.statusView || 'empty',
        );
        updateViewContext(options.statusView === 'error' ? 'error' : 'empty');
    }

    function updateAssetPaginationUi() {
        const shouldShow = !folderViewActive && (currentAssets.length > 0 || assetLoadingMore || assetHasMore);
        $assetPagination.style.display = shouldShow ? '' : 'none';
        if (!shouldShow) return;

        if (assetLoadingMore) {
            $assetPaginationStatus.textContent = localeText('assets.loadingMore');
        } else if (assetHasMore) {
            $assetPaginationStatus.textContent = localeText('assets.showingSavedAssets', { count: currentAssets.length });
        } else {
            $assetPaginationStatus.textContent = currentAssets.length
                ? localeText('assets.showingAllSavedAssets', { count: currentAssets.length })
                : '';
        }

        $assetLoadMore.style.display = assetHasMore ? '' : 'none';
        $assetLoadMore.disabled = assetLoadingMore;
        $assetLoadMore.textContent = assetLoadingMore ? localeText('assets.loading') : localeText('assets.loadMore');

        const canOpenMobileGrid = !assetLoadingMore && !folderViewActive && !selectMode && currentAssets.length > 0;
        $assetPaginationStatus.classList.toggle('studio__pagination-status--mobile-hidden', canOpenMobileGrid);
        $assetMobileGridTrigger.hidden = !canOpenMobileGrid;
        $assetMobileGridTrigger.textContent = canOpenMobileGrid
            ? (
                assetHasMore
                    ? localeText('assets.showingSavedAssets', { count: currentAssets.length })
                    : localeText('assets.allSavedAssetsDisplayed', { count: currentAssets.length })
            )
            : '';
        syncMobileMediaTrigger($assetMobileGridTrigger, {
            enabled: canOpenMobileGrid,
            label: localeText('assets.openSavedAssetsGrid'),
        });
    }

    function getAssetOverlayTitle(asset, index) {
        if (isImageAsset(asset)) {
            return asset.title || asset.prompt || asset.preview_text || localeText('assets.savedImage');
        }
        return getFileTitle(asset) || `${localeText('assets.savedAsset')} ${index + 1}`;
    }

    function getAssetOverlayPreviewUrl(asset) {
        if (isImageAsset(asset)) {
            return asset.thumb_url || asset.medium_url || asset.original_url || asset.file_url || '';
        }
        if (isAudioAsset(asset) || isVideoAsset(asset)) {
            return asset.poster_url || '';
        }
        return '';
    }

    function getAssetOverlayFallback(asset) {
        if (isVideoAsset(asset)) return '\u25B6';
        if (isAudioAsset(asset)) return '\u266B';
        if (isImageAsset(asset)) return '\u25A7';
        return 'TXT';
    }

    function getAssetOverlayMeta(asset) {
        const parts = [
            isImageAsset(asset)
                ? localeText('assets.image')
                : isAudioAsset(asset)
                    ? localeText('assets.soundAsset')
                    : isVideoAsset(asset)
                        ? localeText('assets.videoAsset')
                        : localeText('assets.asset'),
            formatAssetDate(asset.created_at),
        ];
        return parts.filter(Boolean).join(' · ');
    }

    function openAssetFromMobileGrid(asset) {
        if (!asset?.id || selectMode) return;
        const item = Array.from($assetGrid.querySelectorAll('.studio__image-item[data-asset-id]'))
            .find((entry) => entry.dataset.assetId === String(asset.id));
        if (!item) return;

        if (isVideoAsset(asset)) {
            const videoTrigger = item.querySelector('.studio__asset-video-trigger');
            if (videoTrigger) {
                videoTrigger.click();
                return;
            }
            openVideoAsset(asset);
            return;
        }

        if (isImageAsset(asset) || (!isAudioAsset(asset) && asset.file_url)) {
            item.click();
            return;
        }

        item.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (!item.hasAttribute('tabindex')) item.tabIndex = 0;
        item.focus({ preventScroll: true });
    }

    function openAssetsMobileGridOverlay() {
        if (folderViewActive || selectMode || assetLoadingMore || currentAssets.length === 0) return;
        openMobileMediaGrid({
            title: localeText('assets.savedAssets'),
            items: currentAssets,
            emptyText: emptyStateMessage,
            className: 'mobile-media-grid-overlay--assets',
            renderItem(asset, index, { closeGrid } = {}) {
                const title = getAssetOverlayTitle(asset, index);
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'mobile-media-grid-overlay__item mobile-media-grid-overlay__item--asset';
                button.setAttribute('aria-label', localeText('assets.openAsset', { title }));

                const previewUrl = getAssetOverlayPreviewUrl(asset);
                if (previewUrl) {
                    const img = new Image();
                    img.src = previewUrl;
                    img.alt = '';
                    img.loading = 'lazy';
                    img.decoding = 'async';
                    button.appendChild(img);
                } else {
                    const fallback = document.createElement('span');
                    fallback.className = 'mobile-media-grid-overlay__fallback';
                    fallback.textContent = getAssetOverlayFallback(asset);
                    button.appendChild(fallback);
                }

                const label = document.createElement('span');
                label.className = 'mobile-media-grid-overlay__item-label';
                label.textContent = title;
                button.appendChild(label);

                const meta = document.createElement('span');
                meta.className = 'mobile-media-grid-overlay__item-meta';
                meta.textContent = getAssetOverlayMeta(asset);
                button.appendChild(meta);

                button.addEventListener('click', () => {
                    if (typeof closeGrid === 'function') closeGrid();
                    openAssetFromMobileGrid(asset);
                });

                return button;
            },
        });
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
        return selectionScope === 'folder' ? localeText('assets.folder').toLowerCase() : localeText('assets.asset').toLowerCase();
    }

    function getSelectionCountLabel(count = selectedIds.size) {
        return count >= MAX_BULK_SELECT
            ? localeText('assets.selectedMax', { count })
            : localeText('assets.selected', { count });
    }

    function getMoveTargetLabel() {
        const folderId = $bulkMoveSelect?.value || '';
        if (!folderId) return localeText('assets.moveTargetUnfoldered');
        const folder = getFolderById(folderId);
        return folder?.name || localeText('assets.folderUnknown');
    }

    function updateBulkMoveSummary() {
        if (!$bulkMoveSummary) return;
        if (!selectMode || selectionScope === 'folder') {
            $bulkMoveSummary.textContent = '';
            return;
        }
        const countLabel = getSelectionCountLabel();
        const target = getMoveTargetLabel();
        const key = folders.length === 0 && !($bulkMoveSelect?.value || '')
            ? 'assets.moveTargetNoFoldersSummary'
            : 'assets.moveTargetSummary';
        $bulkMoveSummary.textContent = localeText(key, { countLabel, target });
    }

    function getSelectionItemTitle(item) {
        return String(
            item.title
            || item.querySelector('.studio__asset-title, .studio__folder-card-name')?.textContent
            || item.dataset.assetType
            || localeText('assets.asset'),
        ).trim();
    }

    function handleSelectionOnlyKeydown(event) {
        if (!selectMode || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        toggleSelection(event.currentTarget);
    }

    function prepareSelectionItemA11y(item, active, selected) {
        if (!active) {
            item.classList.remove('selected');
            item.removeAttribute('aria-pressed');
            item.removeAttribute('aria-describedby');
            if (Object.prototype.hasOwnProperty.call(item.dataset, 'selectionOriginalLabel')) {
                const previousLabel = item.dataset.selectionOriginalLabel;
                if (previousLabel) item.setAttribute('aria-label', previousLabel);
                else item.removeAttribute('aria-label');
                delete item.dataset.selectionOriginalLabel;
            }
            if (item.dataset.selectionAddedRole === 'true') {
                item.removeAttribute('role');
                delete item.dataset.selectionAddedRole;
            }
            if (item.dataset.selectionAddedTabindex === 'true') {
                item.removeAttribute('tabindex');
                delete item.dataset.selectionAddedTabindex;
            }
            return;
        }

        if (!item.hasAttribute('role')) {
            item.dataset.selectionAddedRole = 'true';
            item.setAttribute('role', 'button');
        }
        if (item.dataset.selectionAddedRole === 'true' && item.dataset.selectionKeyBound !== 'true') {
            item.addEventListener('keydown', handleSelectionOnlyKeydown);
            item.dataset.selectionKeyBound = 'true';
        }
        if (!item.hasAttribute('tabindex')) {
            item.dataset.selectionAddedTabindex = 'true';
            item.tabIndex = 0;
        }
        if (!Object.prototype.hasOwnProperty.call(item.dataset, 'selectionOriginalLabel')) {
            item.dataset.selectionOriginalLabel = item.getAttribute('aria-label') || '';
        }

        const title = getSelectionItemTitle(item);
        const labelKey = selectionScope === 'folder' ? 'assets.selectFolderCard' : 'assets.selectAssetCard';
        item.setAttribute('aria-label', localeText(labelKey, { title }));
        item.setAttribute('aria-pressed', selected ? 'true' : 'false');
        item.setAttribute('aria-describedby', 'studioSelectionGuideStatus');
        item.classList.toggle('selected', selected);
    }

    function syncSelectionItemStates() {
        const activeGrid = selectionScope === 'folder' ? $folderGrid : $assetGrid;
        [$assetGrid, $folderGrid].forEach((grid) => {
            grid?.querySelectorAll('.studio__image-item[data-asset-id], .studio__folder-card[data-folder-id]').forEach((item) => {
                const id = item.dataset.assetId || item.dataset.folderId;
                const active = selectMode && grid === activeGrid;
                prepareSelectionItemA11y(item, active, Boolean(active && id && selectedIds.has(id)));
            });
        });
    }

    function updateSelectionGuide() {
        if (!$selectionGuide) return;
        if (!selectMode) {
            $selectionGuide.hidden = true;
            if ($selectionGuideStatus) $selectionGuideStatus.textContent = '';
            return;
        }

        const folderSelection = selectionScope === 'folder';
        const countLabel = getSelectionCountLabel();
        $selectionGuide.hidden = false;
        if ($selectionGuideCopy) {
            $selectionGuideCopy.textContent = folderSelection
                ? localeText('assets.selectionFolderCopy')
                : localeText('assets.selectionAssetCopy');
        }
        if ($selectionGuideStatus) {
            $selectionGuideStatus.textContent = folderSelection
                ? localeText('assets.selectionFolderStatus', { countLabel })
                : localeText('assets.selectionAssetStatus', { countLabel });
        }
    }

    function updateBulkCount() {
        const count = selectedIds.size;
        if ($bulkCount) {
            $bulkCount.textContent = getSelectionCountLabel(count);
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
        syncSelectionItemStates();
        updateSelectionGuide();
        updateBulkMoveSummary();
        updateAssetPaginationUi();
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

    async function refreshAndCheckAssetPresent(assetId) {
        await refresh({ preserveView: true });
        return currentAssets.some((entry) => String(entry.id) === String(assetId));
    }

    async function handleSingleDeleteResult(result, asset, {
        deleteButton = null,
        restoreLabel = localeText('assets.delete'),
        successToast = localeText('assets.assetDeleted'),
    } = {}) {
        const code = getDeleteResultCode(result);
        if (result.ok) {
            await refresh({ preserveView: true });
            const alreadyDeleted = code === 'already_deleted' || getDeleteResultPayload(result)?.already_deleted === true;
            setActionResult({
                type: 'success',
                title: alreadyDeleted
                    ? localeText('assets.actionSingleDeleteAlreadyRemovedTitle')
                    : localeText('assets.actionSingleDeleteSuccessTitle'),
                copy: alreadyDeleted
                    ? localeText('assets.actionSingleDeleteAlreadyRemovedCopy')
                    : localeText('assets.actionSingleDeleteSuccessCopy'),
                meta: localeText('assets.actionDeleteSuccessMeta'),
                toast: alreadyDeleted ? localeText('assets.deleteAlreadyRemoved') : successToast,
                actions: [getShowAllResultAction(), getRefreshResultAction()],
            });
            return true;
        }

        if (deleteButton) {
            deleteButton.disabled = false;
            deleteButton.textContent = restoreLabel;
        }

        if (code === 'hero_source_in_use') {
            setActionResult({
                type: 'error',
                title: localeText('assets.deleteHeroSourceInUseTitle'),
                copy: result?.error || result?.data?.error || localeText('assets.deleteHeroSourceInUseCopy'),
                toast: localeText('assets.deleteHeroSourceInUseToast'),
                actions: [getRefreshResultAction()],
            });
            return false;
        }

        if (code === 'delete_conflict') {
            let stillPresent = true;
            try {
                stillPresent = await refreshAndCheckAssetPresent(asset.id);
            } catch (error) {
                console.warn('Saved assets refresh after delete conflict failed:', error);
            }
            if (!stillPresent) {
                setActionResult({
                    type: 'success',
                    title: localeText('assets.actionSingleDeleteAlreadyRemovedTitle'),
                    copy: localeText('assets.actionSingleDeleteAlreadyRemovedCopy'),
                    meta: localeText('assets.actionDeleteSuccessMeta'),
                    toast: localeText('assets.deleteAlreadyRemoved'),
                    actions: [getShowAllResultAction(), getRefreshResultAction()],
                });
                return true;
            }
            setActionResult({
                type: 'error',
                title: localeText('assets.actionSingleDeleteConflictTitle'),
                copy: localeText('assets.actionSingleDeleteConflictCopy'),
                toast: localeText('assets.deleteFailedHelp'),
                actions: [getRefreshResultAction()],
            });
            return false;
        }

        setActionResult({
            type: 'error',
            title: localeText('assets.actionSingleDeleteFailedTitle'),
            copy: localeText('assets.actionSingleDeleteFailedCopy'),
            toast: localeText('assets.deleteFailedHelp'),
            actions: [getRefreshResultAction()],
        });
        return false;
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
            updateStorageUsage(result.storageUsage);
        } catch (error) {
            console.warn('Failed to load folders:', error);
            if (requestId !== folderLoadSeq) return false;
            folders = [];
            folderCounts = {};
            unfolderedCount = 0;
            notifyFoldersChange();
            populateFolderOptions($bulkMoveSelect, folders, localeText('assets.moveTargetUnfoldered'));
            populateGalleryFilter($galleryFilter, folders);
            if (!preserveFilter) $galleryFilter.value = '';
            return false;
        }

        notifyFoldersChange();
        populateFolderOptions($bulkMoveSelect, folders, localeText('assets.moveTargetUnfoldered'));
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
        setListStatus(localeText('assets.folderOverviewStatus'), 'folders');
        updateViewContext();

        const total = unfolderedCount + folders.reduce((sum, folder) => sum + (folderCounts[folder.id] || 0), 0);
        $folderGrid.innerHTML = '';

        const bindFolderCardActivation = (card, name, count, activate) => {
            card.setAttribute('role', 'button');
            card.tabIndex = 0;
            card.setAttribute('aria-label', localeText('assets.openFolderCard', {
                name,
                count: formatAssetCount(count),
            }));
            card.addEventListener('click', activate);
            card.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                activate();
            });
        };

        const allCard = document.createElement('div');
        allCard.className = 'studio__folder-card';
        bindFolderCardActivation(allCard, localeText('assets.allAssets'), total, () => {
            if (selectMode) return;
            openAllAssets();
        });
        [
            { className: 'studio__folder-card-icon', text: '\u{1F5BC}' },
            { className: 'studio__folder-card-name', text: localeText('assets.allAssets') },
            { className: 'studio__folder-card-count', text: formatAssetCount(total) },
            { className: 'studio__folder-card-action-label', text: localeText('assets.folderCardOpenAll') },
        ].forEach((entry) => {
            const el = document.createElement('span');
            el.className = entry.className;
            el.textContent = entry.text;
            allCard.appendChild(el);
        });
        $folderGrid.appendChild(allCard);

        const assetsCard = document.createElement('div');
        assetsCard.className = 'studio__folder-card';
        bindFolderCardActivation(assetsCard, localeText('assets.assets'), unfolderedCount, () => {
            if (selectMode) return;
            openFolder(UNFOLDERED);
        });
        [
            { className: 'studio__folder-card-icon', text: '\u{1F4E6}' },
            { className: 'studio__folder-card-name', text: localeText('assets.assets') },
            { className: 'studio__folder-card-count', text: formatAssetCount(unfolderedCount) },
            { className: 'studio__folder-card-action-label', text: localeText('assets.folderCardOpenUnfoldered') },
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
            const totalCount = folderCounts[folder.id] || 0;
            bindFolderCardActivation(card, folder.name, totalCount, () => {
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
            count.textContent = formatAssetCount(totalCount);

            const action = document.createElement('span');
            action.className = 'studio__folder-card-action-label';
            action.textContent = localeText('assets.folderCardOpenFolder');

            card.append(icon, name, count, action);
            appendSelectionCheck(card);
            $folderGrid.appendChild(card);
        });
    }

    function buildImageCard(asset) {
        const item = document.createElement('div');
        const title = asset.title || asset.preview_text || localeText('assets.savedImage');
        item.className = 'studio__image-item';
        item.dataset.assetId = asset.id;
        item.dataset.assetType = 'image';
        item.dataset.previewUrl = asset.medium_url || asset.original_url || asset.file_url || '';
        item.dataset.originalUrl = asset.original_url || asset.file_url || '';
        item.title = title;
        item.setAttribute('role', 'button');
        item.tabIndex = 0;
        item.setAttribute('aria-label', localeText('assets.previewAssetWithTitle', { title }));
        item.addEventListener('keydown', (event) => {
            if (event.target !== item && event.target.closest('button, a, audio, summary, details')) return;
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            if (selectMode) {
                toggleSelection(item);
                return;
            }
            openImageAsset(asset);
        });

        if (asset.thumb_url) {
            const imgEl = document.createElement('img');
            imgEl.src = asset.thumb_url;
            imgEl.alt = title;
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
        visibilityBadge.textContent = isPublishedImageAsset(asset) ? localeText('assets.public') : localeText('assets.private');
        item.appendChild(visibilityBadge);

        const overlay = document.createElement('div');
        overlay.className = 'studio__image-overlay';

        const previewButton = document.createElement('button');
        previewButton.type = 'button';
        previewButton.className = 'studio__image-preview-action';
        previewButton.textContent = localeText('assets.previewAsset');
        previewButton.setAttribute('aria-label', localeText('assets.previewAssetWithTitle', {
            title,
        }));
        previewButton.addEventListener('click', (event) => {
            event.stopPropagation();
            if (selectMode) return;
            openImageAsset(asset);
        });

        const publishButton = document.createElement('button');
        publishButton.type = 'button';
        publishButton.className = `studio__image-publish ${isPublishedImageAsset(asset) ? 'studio__image-publish--public' : ''}`;
        publishButton.textContent = isPublishedImageAsset(asset) ? localeText('assets.unpublish') : localeText('assets.publish');
        publishButton.addEventListener('click', async (event) => {
            event.stopPropagation();
            const nextVisibility = isPublishedImageAsset(asset) ? 'private' : 'public';
            publishButton.disabled = true;
            publishButton.textContent = '…';
            setActionResult({
                type: 'info',
                title: localeText('assets.actionVisibilityPendingTitle'),
                copy: localeText('assets.actionVisibilityPendingCopy'),
                actions: [getRefreshResultAction()],
            });
            const result = await updateAssetPublication(asset, nextVisibility);
            if (!result.ok) {
                publishButton.disabled = false;
                publishButton.textContent = isPublishedImageAsset(asset) ? localeText('assets.unpublish') : localeText('assets.publish');
                setActionResult({
                    type: 'error',
                    title: localeText('assets.actionVisibilityFailedTitle'),
                    copy: localeText('assets.actionVisibilityFailedCopy'),
                    toast: localeText('assets.visibilityUpdateFailed'),
                    actions: [getRefreshResultAction()],
                });
                return;
            }
            await refresh();
            setActionResult({
                type: 'success',
                title: localeText('assets.actionVisibilitySuccessTitle'),
                copy: localeText('assets.actionVisibilitySuccessCopy'),
                toast: nextVisibility === 'public' ? localeText('assets.imagePublished') : localeText('assets.imageUnpublished'),
                actions: [getRefreshResultAction()],
            });
        });

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'studio__image-delete';
        deleteButton.textContent = localeText('assets.delete');
        deleteButton.addEventListener('click', async (event) => {
            event.stopPropagation();
            if (!confirm(localeText('assets.deleteAssetConfirm'))) return;
            deleteButton.disabled = true;
            deleteButton.textContent = '\u2026';
            setActionResult({
                type: 'info',
                title: localeText('assets.actionSingleDeletePendingTitle'),
                copy: localeText('assets.actionSingleDeletePendingCopy'),
            });
            const result = await deleteSingleAsset(asset);
            await handleSingleDeleteResult(result, asset, {
                deleteButton,
                restoreLabel: localeText('assets.delete'),
                successToast: localeText('assets.imageDeleted'),
            });
        });

        overlay.appendChild(previewButton);
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

        if (isVideo || isSound) {
            const isPublished = isPublishedAsset(asset);
            const visBadge = document.createElement('span');
            visBadge.className = `studio__image-visibility ${isPublished ? 'studio__image-visibility--public' : 'studio__image-visibility--private'}`;
            visBadge.textContent = isPublished ? localeText('assets.public') : localeText('assets.private');
            item.appendChild(visBadge);
        }

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
            videoTrigger.setAttribute('aria-label', localeText('assets.openVideo', { title: getFileTitle(asset) }));
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
                videoTrigger.appendChild(buildVideoPosterPlaceholder(asset));
            }

            item.appendChild(videoTrigger);
        }

        if (!isSound) {
            const meta = document.createElement('div');
            meta.className = 'studio__asset-meta';
            meta.textContent = [
                formatAssetDate(asset.created_at),
                asset.file_name || '',
                formatAssetSize(asset.size_bytes),
            ].filter(Boolean).join(' · ');
            item.appendChild(meta);
        }

        const actions = document.createElement('div');
        actions.className = 'studio__asset-actions';

        if (!isSound && !isVideo && asset.file_url) {
            const openButton = document.createElement('button');
            openButton.type = 'button';
            openButton.className = 'studio__asset-preview-action';
            openButton.textContent = localeText('assets.openFile');
            openButton.setAttribute('aria-label', localeText('assets.openFileWithTitle', { title: getFileTitle(asset) }));
            openButton.addEventListener('click', (event) => {
                event.stopPropagation();
                openTextAsset(asset);
            });
            actions.appendChild(openButton);
        }

        if (isVideo || isSound) {
            const isPublished = isPublishedAsset(asset);
            const pubBtn = document.createElement('button');
            pubBtn.type = 'button';
            pubBtn.className = `studio__image-publish studio__image-publish--inline ${isPublished ? 'studio__image-publish--public' : ''}`;
            pubBtn.textContent = isPublished ? localeText('assets.unpublish') : localeText('assets.publish');
            pubBtn.addEventListener('click', async (event) => {
                event.stopPropagation();
                const nextVis = isPublishedAsset(asset) ? 'private' : 'public';
                pubBtn.disabled = true;
                pubBtn.textContent = '\u2026';
                setActionResult({
                    type: 'info',
                    title: localeText('assets.actionVisibilityPendingTitle'),
                    copy: localeText('assets.actionVisibilityPendingCopy'),
                    actions: [getRefreshResultAction()],
                });
                const result = await updateAssetPublication(asset, nextVis);
                if (!result.ok) {
                    pubBtn.disabled = false;
                    pubBtn.textContent = isPublishedAsset(asset) ? localeText('assets.unpublish') : localeText('assets.publish');
                    setActionResult({
                        type: 'error',
                        title: localeText('assets.actionVisibilityFailedTitle'),
                        copy: localeText('assets.actionVisibilityFailedCopy'),
                        toast: localeText('assets.visibilityUpdateFailed'),
                        actions: [getRefreshResultAction()],
                    });
                    return;
                }
                await refresh();
                const labels = getPublicationLabels(asset);
                setActionResult({
                    type: 'success',
                    title: localeText('assets.actionVisibilitySuccessTitle'),
                    copy: localeText('assets.actionVisibilitySuccessCopy'),
                    toast: nextVis === 'public' ? labels.publish : labels.unpublish,
                    actions: [getRefreshResultAction()],
                });
            });
            actions.appendChild(pubBtn);
        }

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'studio__image-delete studio__image-delete--inline';
        deleteButton.textContent = localeText('assets.delete');
        deleteButton.addEventListener('click', async (event) => {
            event.stopPropagation();
            const confirmText = isSound
                ? localeText('assets.deleteSoundConfirm')
                : isVideo
                    ? localeText('assets.deleteVideoConfirm')
                    : localeText('assets.deleteAssetConfirm');
            if (!confirm(confirmText)) return;
            deleteButton.disabled = true;
            deleteButton.textContent = '\u2026';
            setActionResult({
                type: 'info',
                title: localeText('assets.actionSingleDeletePendingTitle'),
                copy: localeText('assets.actionSingleDeletePendingCopy'),
            });
            const result = await deleteSingleAsset(asset);
            await handleSingleDeleteResult(result, asset, {
                deleteButton,
                restoreLabel: localeText('assets.delete'),
                successToast: isSound ? localeText('assets.soundDeleted') : isVideo ? localeText('assets.videoDeleted') : localeText('assets.assetDeleted'),
            });
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
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                if (selectMode) {
                    toggleSelection(item);
                    return;
                }
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
            loading.textContent = localeText('assets.loading');
            $assetGrid.appendChild(loading);
            updateAssetPaginationUi();
            setListStatus(localeText('assets.listLoadingStatus'), 'loading');
            updateViewContext('loading');
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
                showMsg(localeText('assets.couldNotLoadMore'), 'error');
                return;
            }
            currentAssets = [];
            renderEmptyState(loadFailedMessage, {
                title: loadFailedTitle,
                ctaHref: loadFailedCtaHref,
                ctaLabel: loadFailedCtaLabel,
                listStatus: loadFailedListStatus,
                statusView: 'error',
            });
            showMsg(localeText('assets.couldNotLoadAssets'), 'error');
            updateViewContext('error');
            return;
        }

        if (requestId !== assetLoadSeq) return;
        hideMsg();
        updateStorageUsage(page?.storageUsage);

        const assets = Array.isArray(page?.assets) ? page.assets : [];
        assetNextCursor = page?.nextCursor || null;
        assetHasMore = page?.hasMore === true;
        assetLoadingMore = false;

        currentAssets = append
            ? currentAssets.concat(assets)
            : assets.slice();
        if (currentAssets.length === 0) {
            const emptyState = getCurrentEmptyStateOptions(filterValue);
            if (emptyState) {
                renderEmptyState(emptyState.message, emptyState);
            } else {
                renderEmptyState(emptyStateMessage);
            }
            return;
        }

        $assetGrid.innerHTML = '';
        currentAssets.forEach((asset) => {
            $assetGrid.appendChild(isImageAsset(asset) ? buildImageCard(asset) : buildFileCard(asset));
        });
        assetDeck?.refresh();
        updateAssetPaginationUi();
        setCurrentAssetViewStatus();
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

    async function openAllAssets() {
        hideNewFolderForm();
        hideDeleteFolderForm();
        hideRenameForm();
        folderViewActive = false;
        $folderGrid.style.display = 'none';
        folderDeck?.setVisible(false);
        $assetGrid.style.display = '';
        $folderBack?.classList.add('visible');
        $galleryFilter.value = ALL_ASSETS;
        await loadGallery();
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
                folderScope ? localeText('assets.noFoldersRename') : localeText('assets.noAssetsSelect'),
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
        } else {
            if (selectedIds.size >= MAX_BULK_SELECT) {
                showMsg(localeText('assets.maxSelected', { max: MAX_BULK_SELECT }), 'error');
                return;
            }
            selectedIds.add(id);
        }
        updateBulkCount();
    }

    function showRenameForm() {
        if (selectedIds.size !== 1) {
            showMsg(localeText('assets.selectExactlyOne', { context: getSelectionContextLabel() }), 'error');
            return;
        }
        const target = getSelectedEntity();
        if (!target) {
            showMsg(localeText('assets.selectedCouldNotLoad', { context: getSelectionContextLabel() }), 'error');
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
            showMsg(localeText('assets.selectExactlyOne', { context: getSelectionContextLabel() }), 'error');
            return;
        }

        const nextName = $renameInput?.value || '';
        if ($renameConfirm) {
            $renameConfirm.disabled = true;
            $renameConfirm.textContent = '\u2026';
        }
        setActionResult({
            type: 'info',
            title: localeText('assets.actionRenamePendingTitle'),
            copy: localeText('assets.actionRenamePendingCopy'),
        });

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
            $renameConfirm.textContent = localeText('assets.rename');
        }
        if (!result.ok) {
            setActionResult({
                type: 'error',
                title: localeText('assets.actionRenameFailedTitle'),
                copy: localeText('assets.actionRenameFailedCopy'),
                toast: localeText('assets.renameFailedHelp'),
                actions: [getRefreshResultAction(), getCancelSelectionAction()],
            });
            return;
        }

        hideRenameForm();
        const config = getRenameTargetConfig(target);
        const label = config?.successLabel || localeText('assets.asset');
        if (result.data?.unchanged) {
            setActionResult({
                type: 'success',
                title: localeText('assets.actionRenameUnchangedTitle'),
                copy: localeText('assets.actionRenameUnchangedCopy'),
                toast: localeText('assets.nameUnchanged', { label }),
                actions: [getCancelSelectionAction(), getRefreshResultAction()],
            });
            return;
        }

        const selectedId = target.id;
        const selectedScope = selectionScope;
        await refresh({ preserveView: true });
        await restoreSingleSelection(selectedId, selectedScope);
        setActionResult({
            type: 'success',
            title: localeText('assets.actionRenameSuccessTitle'),
            copy: localeText('assets.actionRenameSuccessCopy', { label }),
            meta: localeText('assets.actionRenameSuccessMeta'),
            toast: localeText('assets.renamed', { label }),
            actions: [getCancelSelectionAction(), getRefreshResultAction()],
        });
    }

    function showBulkMoveForm() {
        if (selectionScope === 'folder') {
            showMsg(localeText('assets.moveAssetOnly'), 'error');
            return;
        }
        if (selectedIds.size === 0) {
            showMsg(localeText('assets.selectAtLeastOne'), 'error');
            return;
        }
        hideRenameForm();
        populateFolderOptions($bulkMoveSelect, folders, localeText('assets.moveTargetUnfoldered'));
        updateBulkMoveSummary();
        $bulkMoveForm?.classList.add('visible');
        $bulkMoveSelect?.focus();
    }

    async function handleBulkMoveConfirm() {
        if (selectedIds.size === 0) return;
        const folderId = $bulkMoveSelect?.value || null;
        const target = getMoveTargetLabel();
        const count = selectedIds.size;
        if ($bulkMoveConfirm) {
            $bulkMoveConfirm.disabled = true;
            $bulkMoveConfirm.textContent = '\u2026';
        }
        setActionResult({
            type: 'info',
            title: localeText('assets.actionMovePendingTitle'),
            copy: localeText('assets.actionMovePendingCopy'),
            meta: localeText('assets.moveTargetSummary', {
                countLabel: formatAssetCount(count),
                target,
            }),
        });
        const result = await apiAiBulkMoveAssets(Array.from(selectedIds), folderId);
        if ($bulkMoveConfirm) {
            $bulkMoveConfirm.disabled = false;
            $bulkMoveConfirm.textContent = localeText('assets.move');
        }
        if (!result.ok) {
            setActionResult({
                type: 'error',
                title: localeText('assets.actionMoveFailedTitle'),
                copy: localeText('assets.actionMoveFailedCopy'),
                toast: localeText('assets.moveFailedHelp'),
                actions: [getContinueSelectionAction(), getCancelSelectionAction(), getRefreshResultAction()],
            });
            return;
        }
        exitSelectMode();
        await refresh();
        setActionResult({
            type: 'success',
            title: localeText('assets.actionMoveSuccessTitle'),
            copy: localeText('assets.actionMoveSuccessCopy', {
                countLabel: formatAssetCount(count),
                target,
            }),
            meta: localeText('assets.actionMoveSuccessMeta'),
            toast: localeText('assets.moved', { count, plural: count === 1 ? '' : 's' }),
            actions: [getOpenTargetFolderAction(folderId, target), getShowAllResultAction(), getRefreshResultAction()],
        });
    }

    async function handleBulkDelete() {
        if (selectionScope === 'folder') {
            showMsg(localeText('assets.deleteAssetOnly'), 'error');
            return;
        }
        if (selectedIds.size === 0) {
            showMsg(localeText('assets.selectAtLeastOne'), 'error');
            return;
        }
        const count = selectedIds.size;
        if (!confirm(localeText('assets.deleteSelectedConfirm', { count, plural: count === 1 ? '' : 's' }))) {
            return;
        }
        if ($bulkDelete) {
            $bulkDelete.disabled = true;
            $bulkDelete.textContent = '\u2026';
        }
        setActionResult({
            type: 'info',
            title: localeText('assets.actionDeletePendingTitle'),
            copy: localeText('assets.actionDeletePendingCopy'),
            meta: formatAssetCount(count),
        });
        const result = await apiAiBulkDeleteAssets(Array.from(selectedIds));
        if ($bulkDelete) {
            $bulkDelete.disabled = false;
            $bulkDelete.textContent = localeText('assets.deleteSelected');
        }
        if (!result.ok) {
            setActionResult({
                type: 'error',
                title: localeText('assets.actionDeleteFailedTitle'),
                copy: localeText('assets.actionDeleteFailedCopy'),
                toast: localeText('assets.deleteAssetsFailedHelp'),
                actions: [getContinueSelectionAction(), getRefreshResultAction(), getCancelSelectionAction()],
            });
            return;
        }
        exitSelectMode();
        await refresh();
        setActionResult({
            type: 'success',
            title: localeText('assets.actionDeleteSuccessTitle'),
            copy: localeText('assets.actionDeleteSuccessCopy', { countLabel: formatAssetCount(count) }),
            meta: localeText('assets.actionDeleteSuccessMeta'),
            toast: localeText('assets.deleted', { count, plural: count === 1 ? '' : 's' }),
            actions: [getShowAllResultAction(), getRefreshResultAction()],
        });
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
        setActionResult({
            type: 'info',
            title: localeText('assets.actionFolderCreatePendingTitle'),
            copy: localeText('assets.actionFolderCreatePendingCopy'),
        });
        const result = await apiAiCreateFolder(name);
        if ($newFolderSave) $newFolderSave.disabled = false;
        if (!result.ok) {
            setActionResult({
                type: 'error',
                title: localeText('assets.actionFolderCreateFailedTitle'),
                copy: localeText('assets.actionFolderCreateFailedCopy'),
                toast: localeText('assets.folderCreationFailed'),
                actions: [getRefreshResultAction()],
            });
            return;
        }
        hideNewFolderForm();
        await refresh({ preserveView: folderViewActive });
        setActionResult({
            type: 'success',
            title: localeText('assets.actionFolderCreateSuccessTitle'),
            copy: localeText('assets.actionFolderCreateSuccessCopy', { name }),
            toast: localeText('assets.folderCreated', { name }),
            actions: [getFolderOverviewAction(), getShowAllResultAction()],
        });
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
            showMsg(localeText('assets.noFoldersDelete'), 'error');
            return;
        }

        if ($deleteFolderSelect) {
            $deleteFolderSelect.innerHTML = '';
            deletableFolders.forEach((folder) => {
                const option = document.createElement('option');
                option.value = folder.id;
                option.textContent = folder.status === 'deleting'
                    ? `${folder.name} (${localeText('assets.retryDelete')})`
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
        const name = targetFolder?.name || localeText('assets.thisFolder');
        if (!confirm(localeText('assets.deleteFolderConfirm', { name }))) {
            return;
        }

        if ($deleteFolderConfirm) {
            $deleteFolderConfirm.disabled = true;
            $deleteFolderConfirm.textContent = '\u2026';
        }
        setActionResult({
            type: 'info',
            title: localeText('assets.actionFolderDeletePendingTitle'),
            copy: localeText('assets.actionFolderDeletePendingCopy'),
        });
        const result = await apiAiDeleteFolder(folderId);
        if ($deleteFolderConfirm) {
            $deleteFolderConfirm.disabled = false;
            $deleteFolderConfirm.textContent = localeText('assets.delete');
        }
        if (!result.ok) {
            setActionResult({
                type: 'error',
                title: localeText('assets.actionFolderDeleteFailedTitle'),
                copy: localeText('assets.actionFolderDeleteFailedCopy'),
                toast: localeText('assets.folderDeleteFailedHelp'),
                actions: [getRefreshResultAction(), getFolderOverviewAction()],
            });
            return;
        }

        hideDeleteFolderForm();
        if ($galleryFilter.value === folderId) {
            $galleryFilter.value = '';
            folderViewActive = true;
        }
        await refresh({ preserveView: true });
        setActionResult({
            type: 'success',
            title: localeText('assets.actionFolderDeleteSuccessTitle'),
            copy: localeText('assets.actionFolderDeleteSuccessCopy', { name }),
            meta: localeText('assets.actionFolderDeleteSuccessMeta'),
            toast: localeText('assets.folderDeleted', { name }),
            actions: [getShowAllResultAction(), getFolderOverviewAction(), getRefreshResultAction()],
        });
    }

    async function refresh({ preserveView = true } = {}) {
        const previousFilter = $galleryFilter.value;
        const previousFolderView = folderViewActive;
        const foldersOk = await loadFolders({ preserveFilter: preserveView });
        if (!foldersOk) {
            showMsg(foldersUnavailableMessage, 'error');
            await openAllAssets();
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

        assetDeck = initStudioDeck($assetGrid, {
            maxDots: SAVED_ASSET_MOBILE_DOT_LIMIT,
            onOpenImage(item) {
                const asset = currentAssets.find((entry) => String(entry.id) === String(item.dataset.assetId));
                if (asset) openImageAsset(asset);
            },
        });
        folderDeck = initStudioFolderDeck($folderGrid);
        localizeWorkspaceLinks();

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
        $viewRefresh?.addEventListener('click', handleViewRefresh);
        $viewShowAll?.addEventListener('click', handleViewShowAll);
        $uploadVideoBtn?.addEventListener('click', () => {
            if (typeof onUploadVideo === 'function') onUploadVideo($uploadVideoBtn);
        });
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
        $bulkMoveSelect?.addEventListener('change', updateBulkMoveSummary);
        $bulkMoveCancel?.addEventListener('click', () => {
            $bulkMoveForm?.classList.remove('visible');
            updateBulkMoveSummary();
        });
        $assetLoadMore.addEventListener('click', () => {
            if (!assetHasMore || assetLoadingMore) return;
            loadGallery({ append: true });
        });
        $assetMobileGridTrigger.addEventListener('click', openAssetsMobileGridOverlay);

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
            else if (action === 'upload-video' && typeof onUploadVideo === 'function') onUploadVideo(event.target.closest('button'));
        });
        document.addEventListener('click', (event) => {
            if (!root?.contains(event.target)) closeMobileMenu();
        });
        if ($storageUsage) {
            window.addEventListener('bitbi:assets-storage-changed', handleExternalStorageChange);
        }
        mobileMediaQuery?.addEventListener?.('change', updateAssetPaginationUi);

        const foldersOk = await loadFolders({ preserveFilter: false });
        if (foldersOk) {
            showFolderView();
        } else {
            showMsg(foldersUnavailableMessage, 'error');
            await openAllAssets();
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
        openAllAssets,
        getViewState() {
            return {
                folderViewActive,
                assetCount: currentAssets.length,
                filterValue: $galleryFilter.value,
            };
        },
        getFolders() {
            return folders.slice();
        },
    };
}
