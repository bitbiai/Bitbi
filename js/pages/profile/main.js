/* ============================================================
   BITBI — Member Profile Page
   Entry point for profile.html
   ============================================================ */

import { initSiteHeader }    from '../../shared/site-header.js?v=__ASSET_VERSION__';
import { initParticles }     from '../../shared/particles.js';
import { initBinaryRain }    from '../../shared/binary-rain.js';
import { initBinaryFooter }  from '../../shared/binary-footer.js';
import { initScrollReveal }  from '../../shared/scroll-reveal.js';
import { initCookieConsent } from '../../shared/cookie-consent.js';
import { setupFocusTrap }    from '../../shared/focus-trap.js';
import { patchAuthUser }     from '../../shared/auth-state.js';
import {
    openWalletPanelView,
    openWalletWorkspaceView,
    refreshWalletStatus,
    requestWalletLink,
    unlinkLinkedWallet,
} from '../../shared/wallet/wallet-controller.js?v=__ASSET_VERSION__';
import { subscribeWalletState } from '../../shared/wallet/wallet-state.js?v=__ASSET_VERSION__';

import {
    apiAiGetFolders,
    apiAiGetImages,
    apiDeleteAvatar,
    apiGetFavorites,
    apiGetProfile,
    apiLogout,
    apiRemoveFavorite,
    apiRequestReverification,
    apiSetAvatarFromSavedAsset,
    apiUpdateProfile,
    apiUploadAvatar,
} from '../../shared/auth-api.js?v=__ASSET_VERSION__';
import {
    initAvatarGenerate,
    openAvatarGenerateModal,
    closeAvatarGenerateModal,
    isAvatarGenerateModalOpen,
} from './avatar-generate.js?v=__ASSET_VERSION__';
import { galleryItems } from '../../shared/gallery-data.js';
import { formatTime } from '../../shared/format-time.js';
import {
    buildPublicMempicUrl,
    buildPublicMemtrackUrl,
    buildPublicMemvidUrl,
    getPublicMempicVersionFromUrl,
    getPublicMemtrackVersionFromUrl,
    getPublicMemvidVersionFromUrl,
} from '../../shared/public-media-contract.mjs';
import {
    initGlobalAudioManager,
    getGlobalAudioState,
    subscribeGlobalAudioState,
    playGlobalTrack,
    pauseGlobalAudio,
    resumeGlobalAudio,
    seekGlobalAudio,
} from '../../shared/audio/audio-manager.js?v=__ASSET_VERSION__';

/* ── DOM refs ── */
const $loading        = document.getElementById('loadingState');
const $denied         = document.getElementById('deniedState');
const $content        = document.getElementById('profileContent');

const $summaryName    = document.getElementById('summaryName');
const $summaryEmail   = document.getElementById('summaryEmail');
const $summaryRole    = document.getElementById('summaryRole');
const $summaryVerified = document.getElementById('summaryVerified');
const $summarySince   = document.getElementById('summarySince');
const $walletSectionCopy = document.getElementById('walletSectionCopy');
const $walletSectionMsg = document.getElementById('walletSectionMsg');
const $walletSectionRows = document.getElementById('walletSectionRows');
const $walletSectionActions = document.getElementById('walletSectionActions');
const $profileWalletWorkspaceBtn = document.getElementById('profileWalletWorkspaceBtn');
const $walletCard     = document.getElementById('profileWalletCard');

const $form           = document.getElementById('profileForm');
const $displayName    = document.getElementById('displayName');
const $bio            = document.getElementById('bio');
const $website        = document.getElementById('website');
const $submitBtn      = document.getElementById('submitBtn');
const $formMsg        = document.getElementById('formMsg');
const $logoutBtn      = document.getElementById('logoutBtn');

const $avatarImg         = document.getElementById('avatarImg');
const $avatarPlaceholder = document.getElementById('avatarPlaceholder');
const $avatarChangeBtn   = document.getElementById('avatarChangeBtn');
const $avatarInput       = document.getElementById('avatarInput');
const $avatarRemoveBtn   = document.getElementById('avatarRemoveBtn');
const $avatarUploadText  = document.getElementById('avatarUploadText');
const $avatarMsg         = document.getElementById('avatarMsg');
const $avatarSourceModal = document.getElementById('avatarSourceModal');
const $avatarSourceClose = document.getElementById('avatarSourceClose');
const $avatarChooseSavedAssets = document.getElementById('avatarChooseSavedAssets');
const $avatarChooseUploadDevice = document.getElementById('avatarChooseUploadDevice');
const $avatarChooseGenerate = document.getElementById('avatarChooseGenerate');
const $avatarGenerateModal = document.getElementById('avatarGenerateModal');
const $avatarAssetsModal = document.getElementById('avatarAssetsModal');
const $avatarAssetsClose = document.getElementById('avatarAssetsClose');
const $avatarAssetsFilter = document.getElementById('avatarAssetsFilter');
const $avatarAssetsStatus = document.getElementById('avatarAssetsStatus');
const $avatarAssetsGrid = document.getElementById('avatarAssetsGrid');

let walletViewState = null;

function setActiveTab(tab) {
    if (!$content) return;
    $content.dataset.activeTab = tab;

    if (!$tabBar) return;
    $tabBar.querySelectorAll('.profile-tab-btn').forEach(btn => {
        const isActive = btn.dataset.tab === tab;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', String(isActive));
    });
}

/* ── Mobile tab switcher ── */
const $tabBar = document.getElementById('profileTabBar');
if ($tabBar) {
    $tabBar.addEventListener('click', (e) => {
        const btn = e.target.closest('.profile-tab-btn');
        if (!btn || btn.classList.contains('active')) return;
        setActiveTab(btn.dataset.tab);
    });
}

$profileWalletWorkspaceBtn?.addEventListener('click', () => {
    openWalletWorkspaceView();
});

$walletCard?.addEventListener('click', () => {
    openWalletWorkspaceView();
});

/* ── Date formatter ── */
const dtf = new Intl.DateTimeFormat('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
});

function formatDate(iso) {
    if (!iso) return '\u2014';
    return dtf.format(new Date(iso));
}

/* ── Message helpers ── */
function showMsg(text, type) {
    $formMsg.textContent = text;
    $formMsg.className = `profile__msg profile__msg--${type}`;
}

function hideMsg() {
    $formMsg.className = 'profile__msg';
    $formMsg.textContent = '';
}

function showWalletSectionMsg(text, type = 'success') {
    if (!$walletSectionMsg) return;
    $walletSectionMsg.textContent = text || '';
    $walletSectionMsg.className = text
        ? `profile__msg profile__msg--${type}`
        : 'profile__msg';
}

function createWalletRow(label, valueNode) {
    const row = document.createElement('div');
    row.className = 'profile__row';

    const labelEl = document.createElement('span');
    labelEl.className = 'profile__label';
    labelEl.textContent = label;

    const valueEl = document.createElement('span');
    valueEl.className = 'profile__value';
    if (typeof valueNode === 'string') {
        valueEl.textContent = valueNode;
    } else if (valueNode) {
        valueEl.appendChild(valueNode);
    } else {
        valueEl.textContent = '\u2014';
    }

    row.append(labelEl, valueEl);
    return row;
}

function createWalletPill(label, variant = '') {
    const pill = document.createElement('span');
    pill.className = `profile__wallet-pill${variant ? ` profile__wallet-pill--${variant}` : ''}`;
    pill.textContent = label;
    return pill;
}

function addressesEqual(left, right) {
    if (!left || !right) return false;
    return String(left).trim().toLowerCase() === String(right).trim().toLowerCase();
}

function renderWalletSection(state = walletViewState) {
    if (!$walletSectionRows || !$walletSectionActions || !$walletSectionCopy || !state) return;

    const linkedWallet = state.linkedWallet || null;
    const connectedAddress = state.active?.address || '';
    const isConnected = state.status === 'connected' && !!connectedAddress;
    const linkedMatchesConnected = !!(linkedWallet && isConnected && addressesEqual(linkedWallet.address, connectedAddress));
    const connectedDiffersFromLinked = !!(linkedWallet && isConnected && !linkedMatchesConnected);
    const actionBusy = state.identityAction && state.identityAction !== 'idle';

    $walletSectionRows.innerHTML = '';
    $walletSectionActions.innerHTML = '';

    if (!state.authReady) {
        $walletSectionCopy.textContent = 'Loading wallet and account status…';
        $walletSectionRows.appendChild(createWalletRow('Status', 'Loading…'));
        return;
    }

    if (!linkedWallet && !isConnected) {
        $walletSectionCopy.textContent = 'No wallet is linked yet. Connect an Ethereum Mainnet wallet to link it to this BITBI account.';
        $walletSectionRows.appendChild(createWalletRow('Status', createWalletPill('No wallet linked')));

        const connectBtn = document.createElement('button');
        connectBtn.type = 'button';
        connectBtn.className = 'profile__wallet-btn';
        connectBtn.textContent = 'Connect Wallet';
        connectBtn.addEventListener('click', () => openWalletPanelView());
        $walletSectionActions.appendChild(connectBtn);
        return;
    }

    if (!linkedWallet && isConnected) {
        $walletSectionCopy.textContent = 'Your wallet is connected in this browser, but it is not linked to your BITBI account yet.';
        $walletSectionRows.appendChild(createWalletRow('Status', createWalletPill('Connected, not linked', 'warning')));
        $walletSectionRows.appendChild(createWalletRow('Connected wallet', connectedAddress));
        $walletSectionRows.appendChild(createWalletRow('Network', state.active?.chainLabel || '\u2014'));

        const linkBtn = document.createElement('button');
        linkBtn.type = 'button';
        linkBtn.className = 'profile__wallet-btn';
        linkBtn.disabled = actionBusy;
        linkBtn.textContent = actionBusy ? 'Working…' : 'Link Connected Wallet';
        linkBtn.addEventListener('click', () => requestWalletLink());
        $walletSectionActions.appendChild(linkBtn);

        const panelBtn = document.createElement('button');
        panelBtn.type = 'button';
        panelBtn.className = 'profile__wallet-btn profile__wallet-btn--ghost';
        panelBtn.textContent = 'Open Wallet Panel';
        panelBtn.addEventListener('click', () => openWalletPanelView());
        $walletSectionActions.appendChild(panelBtn);
        return;
    }

    if (linkedWallet) {
        $walletSectionRows.appendChild(createWalletRow('Linked wallet', linkedWallet.address));
        $walletSectionRows.appendChild(createWalletRow('Network', 'Ethereum Mainnet'));
        $walletSectionRows.appendChild(createWalletRow('Linked at', formatDate(linkedWallet.linkedAt)));
        if (linkedWallet.lastLoginAt) {
            $walletSectionRows.appendChild(createWalletRow('Last wallet sign-in', formatDate(linkedWallet.lastLoginAt)));
        }
    }

    if (linkedWallet && linkedMatchesConnected) {
        $walletSectionCopy.textContent = 'The connected wallet matches the wallet linked to this BITBI account.';
        $walletSectionRows.prepend(createWalletRow('Status', createWalletPill('Linked and connected', 'success')));
    } else if (linkedWallet && connectedDiffersFromLinked) {
        $walletSectionCopy.textContent = 'A different wallet is connected in this browser than the wallet currently linked to this BITBI account.';
        $walletSectionRows.prepend(createWalletRow('Status', createWalletPill('Different wallet connected', 'danger')));
        $walletSectionRows.appendChild(createWalletRow('Connected wallet', connectedAddress));
    } else if (linkedWallet) {
        $walletSectionCopy.textContent = 'A wallet is linked to this BITBI account. You can keep your BITBI session active even when the wallet is not currently connected.';
        $walletSectionRows.prepend(createWalletRow('Status', createWalletPill('Linked', 'success')));
    }

    if (!isConnected) {
        const connectBtn = document.createElement('button');
        connectBtn.type = 'button';
        connectBtn.className = 'profile__wallet-btn';
        connectBtn.textContent = 'Connect Wallet';
        connectBtn.addEventListener('click', () => openWalletPanelView());
        $walletSectionActions.appendChild(connectBtn);
    } else {
        const panelBtn = document.createElement('button');
        panelBtn.type = 'button';
        panelBtn.className = 'profile__wallet-btn profile__wallet-btn--ghost';
        panelBtn.textContent = 'Open Wallet Panel';
        panelBtn.addEventListener('click', () => openWalletPanelView());
        $walletSectionActions.appendChild(panelBtn);
    }

    const unlinkBtn = document.createElement('button');
    unlinkBtn.type = 'button';
    unlinkBtn.className = 'profile__wallet-btn profile__wallet-btn--danger';
    unlinkBtn.disabled = actionBusy;
    unlinkBtn.textContent = state.identityAction === 'unlinking' ? 'Unlinking…' : 'Unlink Wallet';
    unlinkBtn.addEventListener('click', async () => {
        showWalletSectionMsg('', 'success');
        try {
            await unlinkLinkedWallet();
            showWalletSectionMsg('Wallet unlinked from this BITBI account.', 'success');
        } catch {
            showWalletSectionMsg('Could not unlink that wallet.', 'error');
        }
    });
    $walletSectionActions.appendChild(unlinkBtn);
}

/* ── Avatar helpers ── */
const AVATAR_URL = '/api/profile/avatar';
const MAX_AVATAR_SIZE = 2 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const AVATAR_UNFOLDERED_FILTER = '__unfoldered__';
const AVATAR_DEFAULT_STATUS = 'Choose an image for your profile photo.';

const avatarModalCleanups = new Map();
const avatarPickerState = {
    folders: [],
    folderNames: new Map(),
    filter: '',
    assets: [],
    loading: false,
    actionId: null,
};
let avatarActionBusy = false;

function showAvatarMsg(text, type) {
    $avatarMsg.textContent = text;
    $avatarMsg.className = `profile__msg profile__msg--${type}`;
}

function hideAvatarMsg() {
    $avatarMsg.className = 'profile__msg';
    $avatarMsg.textContent = '';
}

function loadAvatar(bustCache) {
    const src = bustCache ? `${AVATAR_URL}?t=${Date.now()}` : AVATAR_URL;
    const img = new Image();
    img.onload = () => {
        $avatarImg.src = img.src;
        $avatarImg.style.display = '';
        $avatarPlaceholder.style.display = 'none';
        $avatarRemoveBtn.style.display = '';
    };
    img.onerror = () => {
        $avatarImg.style.display = 'none';
        $avatarPlaceholder.style.display = '';
        $avatarRemoveBtn.style.display = 'none';
    };
    img.src = src;
}

function setAvatarActionState(isBusy, text = 'Change Photo') {
    avatarActionBusy = isBusy;
    if ($avatarChangeBtn) $avatarChangeBtn.disabled = isBusy;
    if ($avatarInput) $avatarInput.disabled = isBusy;
    if ($avatarChooseSavedAssets) $avatarChooseSavedAssets.disabled = isBusy;
    if ($avatarChooseUploadDevice) $avatarChooseUploadDevice.disabled = isBusy;
    if ($avatarChooseGenerate) $avatarChooseGenerate.disabled = isBusy;
    if ($avatarUploadText) $avatarUploadText.textContent = isBusy ? text : 'Change Photo';
}

function setAvatarAssetsStatus(text, type = 'neutral') {
    if (!$avatarAssetsStatus) return;
    $avatarAssetsStatus.textContent = text;
    $avatarAssetsStatus.className = `profile-avatar-picker__status profile-avatar-picker__status--${type}`;
}

function hasOpenAvatarModal() {
    return Boolean(
        ($avatarSourceModal && !$avatarSourceModal.hidden) ||
        ($avatarAssetsModal && !$avatarAssetsModal.hidden) ||
        ($avatarGenerateModal && !$avatarGenerateModal.hidden)
    );
}

function syncAvatarModalBodyLock() {
    if (hasOpenAvatarModal()) {
        document.body.style.overflow = 'hidden';
        return;
    }
    if (!$viewer?.classList.contains('active')) {
        document.body.style.overflow = '';
    }
}

function openAvatarModal(overlay, focusTarget = null) {
    if (!overlay || avatarActionBusy) return;
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    overlay.classList.add('active');

    const cleanup = avatarModalCleanups.get(overlay);
    if (cleanup) cleanup();

    const focusTrapTarget = overlay.querySelector('[role="dialog"]') || overlay;
    avatarModalCleanups.set(overlay, setupFocusTrap(focusTrapTarget));
    syncAvatarModalBodyLock();
    if (focusTarget) focusTarget.focus();
}

function closeAvatarModal(overlay, { focusEl = null } = {}) {
    if (!overlay || overlay.hidden) return;
    overlay.classList.remove('active');
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');

    const cleanup = avatarModalCleanups.get(overlay);
    if (cleanup) {
        cleanup();
        avatarModalCleanups.delete(overlay);
    }

    if (focusEl && typeof focusEl.focus === 'function') {
        focusEl.focus();
    }

    syncAvatarModalBodyLock();
}

function closeAvatarSourceModal(options) {
    closeAvatarModal($avatarSourceModal, options);
}

function closeAvatarAssetsModal(options) {
    closeAvatarModal($avatarAssetsModal, options);
}

function openAvatarSourceModal() {
    hideAvatarMsg();
    openAvatarModal($avatarSourceModal, $avatarChooseSavedAssets || $avatarSourceClose);
}

function getAvatarAssetPreviewState(asset) {
    const status = asset?.derivatives_status || 'pending';
    if (status === 'failed') {
        return {
            variant: 'failed',
            label: 'Thumbnail unavailable',
            hint: 'This image still needs a generated thumbnail before it can be used as your profile photo.',
        };
    }
    if (status === 'processing') {
        return {
            variant: 'pending',
            label: 'Preparing preview',
            hint: 'The thumbnail is still being generated.',
        };
    }
    return {
        variant: 'pending',
        label: 'Preview pending',
        hint: 'This image needs a thumbnail before it can be used as your profile photo.',
    };
}

function buildAvatarAssetPlaceholder(asset) {
    const state = getAvatarAssetPreviewState(asset);
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

function getAvatarAssetMeta(asset) {
    const folderLabel = asset.folder_id
        ? avatarPickerState.folderNames.get(asset.folder_id) || 'Saved Assets'
        : 'Unfoldered';
    const dateLabel = asset.created_at ? formatDate(asset.created_at) : null;
    return [folderLabel, dateLabel].filter(Boolean).join(' / ');
}

function getAvatarAssetActionLabel(asset) {
    if (avatarPickerState.actionId === asset.id) {
        return 'Working\u2026';
    }
    if (asset.thumb_url) {
        return 'Use Photo';
    }
    return asset.derivatives_status === 'failed' ? 'Retry Preview' : 'Prepare Preview';
}

function renderAvatarAssetsGrid() {
    if (!$avatarAssetsGrid) return;

    $avatarAssetsGrid.innerHTML = '';

    if (avatarPickerState.loading) {
        const empty = document.createElement('div');
        empty.className = 'studio__gallery-empty';
        empty.textContent = 'Loading saved images...';
        $avatarAssetsGrid.appendChild(empty);
        return;
    }

    if (!avatarPickerState.assets.length) {
        const empty = document.createElement('div');
        empty.className = 'studio__gallery-empty';
        empty.textContent = 'No saved images available in this view.';
        $avatarAssetsGrid.appendChild(empty);
        return;
    }

    const disableActions = Boolean(avatarPickerState.actionId);

    avatarPickerState.assets.forEach((asset) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'profile-avatar-picker__asset';
        item.disabled = disableActions;
        item.dataset.assetId = asset.id;

        const preview = document.createElement('div');
        preview.className = `studio__image-item profile-avatar-picker__asset-preview${asset.thumb_url ? '' : ' studio__image-item--placeholder'}`;

        if (asset.thumb_url) {
            const img = document.createElement('img');
            img.src = asset.thumb_url;
            img.alt = asset.title || asset.preview_text || 'Saved image';
            img.loading = 'lazy';
            img.decoding = 'async';
            img.crossOrigin = 'use-credentials';
            preview.appendChild(img);
        } else {
            preview.appendChild(buildAvatarAssetPlaceholder(asset));
        }

        const body = document.createElement('span');
        body.className = 'profile-avatar-picker__asset-body';

        const title = document.createElement('span');
        title.className = 'profile-avatar-picker__asset-title';
        title.textContent = asset.title || asset.preview_text || 'Saved image';
        body.appendChild(title);

        const meta = document.createElement('span');
        meta.className = 'profile-avatar-picker__asset-meta';
        meta.textContent = getAvatarAssetMeta(asset);
        body.appendChild(meta);

        const cta = document.createElement('span');
        cta.className = 'profile-avatar-picker__asset-cta';
        cta.textContent = getAvatarAssetActionLabel(asset);
        body.appendChild(cta);

        item.append(preview, body);
        item.addEventListener('click', () => {
            if (asset.thumb_url) {
                assignAvatarFromSavedAsset(asset);
            } else {
                prepareAvatarAssetPreview(asset);
            }
        });

        $avatarAssetsGrid.appendChild(item);
    });
}

function renderAvatarAssetsFilter({ unfolderedCount = 0 } = {}) {
    if (!$avatarAssetsFilter) return;

    const previousValue = avatarPickerState.filter || $avatarAssetsFilter.value || '';
    $avatarAssetsFilter.innerHTML = '';

    const allOption = document.createElement('option');
    allOption.value = '';
    allOption.textContent = 'All Saved Images';
    $avatarAssetsFilter.appendChild(allOption);

    if (unfolderedCount > 0) {
        const unfolderedOption = document.createElement('option');
        unfolderedOption.value = AVATAR_UNFOLDERED_FILTER;
        unfolderedOption.textContent = 'Unfoldered';
        $avatarAssetsFilter.appendChild(unfolderedOption);
    }

    avatarPickerState.folders.forEach((folder) => {
        const option = document.createElement('option');
        option.value = folder.id;
        option.textContent = folder.name;
        $avatarAssetsFilter.appendChild(option);
    });

    const hasPrevious = Array.from($avatarAssetsFilter.options).some((option) => option.value === previousValue);
    avatarPickerState.filter = hasPrevious ? previousValue : '';
    $avatarAssetsFilter.value = avatarPickerState.filter;
}

async function loadAvatarPickerFolders() {
    const folderResult = await apiAiGetFolders();
    avatarPickerState.folders = Array.isArray(folderResult?.folders) ? folderResult.folders : [];
    avatarPickerState.folderNames = new Map(
        avatarPickerState.folders.map((folder) => [folder.id, folder.name])
    );
    renderAvatarAssetsFilter({ unfolderedCount: folderResult?.unfolderedCount || 0 });
}

async function loadAvatarPickerAssets() {
    avatarPickerState.loading = true;
    setAvatarAssetsStatus('Loading saved images...', 'neutral');
    renderAvatarAssetsGrid();

    const filterValue = $avatarAssetsFilter?.value || '';
    avatarPickerState.filter = filterValue;

    const images = filterValue === AVATAR_UNFOLDERED_FILTER
        ? await apiAiGetImages(undefined, { onlyUnfoldered: true })
        : await apiAiGetImages(filterValue || undefined);

    avatarPickerState.assets = Array.isArray(images) ? images : [];
    avatarPickerState.loading = false;
    renderAvatarAssetsGrid();
    setAvatarAssetsStatus(
        avatarPickerState.assets.length ? AVATAR_DEFAULT_STATUS : 'No saved images available in this view.',
        'neutral'
    );
}

async function openAvatarAssetsModal() {
    hideAvatarMsg();
    openAvatarModal($avatarAssetsModal, $avatarAssetsFilter || $avatarAssetsClose);
    await loadAvatarPickerFolders();
    await loadAvatarPickerAssets();
}

async function prepareAvatarAssetPreview(asset) {
    if (!asset?.id || avatarPickerState.actionId) return;

    avatarPickerState.actionId = asset.id;
    setAvatarAssetsStatus(
        asset.derivatives_status === 'failed'
            ? 'Retrying thumbnail generation...'
            : 'Preparing thumbnail...',
        'neutral'
    );
    renderAvatarAssetsGrid();

    try {
        const res = await fetch(`/api/ai/images/${encodeURIComponent(asset.id)}/thumb`, {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
        });

        if (!res.ok) {
            let data = null;
            try { data = await res.json(); } catch { data = null; }
            setAvatarAssetsStatus(
                data?.error || getAvatarAssetPreviewState(asset).label,
                asset.derivatives_status === 'failed' ? 'error' : 'neutral'
            );
            return;
        }

        await res.arrayBuffer();
        const target = avatarPickerState.assets.find((entry) => entry.id === asset.id);
        if (target) {
            target.thumb_url = `/api/ai/images/${asset.id}/thumb`;
            target.medium_url = target.medium_url || `/api/ai/images/${asset.id}/medium`;
            target.derivatives_status = 'ready';
        }
        setAvatarAssetsStatus('Thumbnail ready. Select Use Photo to update your avatar.', 'success');
    } catch {
        setAvatarAssetsStatus('Network error. Please try again.', 'error');
    } finally {
        avatarPickerState.actionId = null;
        renderAvatarAssetsGrid();
    }
}

async function assignAvatarFromSavedAsset(asset) {
    if (!asset?.id || avatarPickerState.actionId || avatarActionBusy) return;

    avatarPickerState.actionId = asset.id;
    setAvatarActionState(true, 'Updating\u2026');
    setAvatarAssetsStatus('Updating profile photo...', 'neutral');
    renderAvatarAssetsGrid();

    try {
        const result = await apiSetAvatarFromSavedAsset(asset.id);
        if (result.ok) {
            patchAuthUser({
                has_avatar: true,
                avatar_url: `${AVATAR_URL}?t=${Date.now()}`,
            });
            closeAvatarAssetsModal({ focusEl: $avatarChangeBtn });
            setAvatarAssetsStatus(AVATAR_DEFAULT_STATUS, 'neutral');
            showAvatarMsg('Photo updated.', 'success');
            loadAvatar(true);
            return;
        }

        setAvatarAssetsStatus(
            result.error || 'Could not update your profile photo.',
            result.code === 'avatar_thumb_unavailable' ? 'neutral' : 'error'
        );
    } finally {
        avatarPickerState.actionId = null;
        setAvatarActionState(false);
        renderAvatarAssetsGrid();
    }
}

/* ── State switching ── */
function showState(el) {
    $loading.style.display = 'none';
    $denied.style.display = 'none';
    $content.style.display = 'none';
    el.style.display = '';
}

/* ── Render profile data ── */
function renderProfile(profile, account) {
    if ($walletCard) {
        $walletCard.hidden = false;
    }

    // Summary card
    $summaryName.textContent = profile.display_name || '\u2014';
    $summaryEmail.textContent = account.email;

    $summaryRole.textContent = '';
    const roleBadge = document.createElement('span');
    roleBadge.className = 'profile__badge profile__badge--role';
    roleBadge.textContent = account.role;
    $summaryRole.appendChild(roleBadge);

    $summaryVerified.textContent = '';
    const isLegacy = account.verification_method === 'legacy_auto';
    const isVerified = account.email_verified && !isLegacy;

    const verifiedBadge = document.createElement('span');
    verifiedBadge.className = `profile__badge profile__badge--${isVerified ? 'verified' : isLegacy ? 'legacy' : 'unverified'}`;
    verifiedBadge.textContent = isVerified ? 'Yes' : isLegacy ? 'Pending' : 'No';
    $summaryVerified.appendChild(verifiedBadge);

    if (isLegacy) {
        const verifyLink = document.createElement('button');
        verifyLink.type = 'button';
        verifyLink.className = 'profile__verify-link';
        verifyLink.textContent = 'Verify now';
        verifyLink.addEventListener('click', async () => {
            verifyLink.disabled = true;
            verifyLink.textContent = 'Sending\u2026';
            const res = await apiRequestReverification();
            if (res.ok) {
                verifyLink.textContent = 'Email sent!';
            } else {
                verifyLink.textContent = 'Verify now';
                verifyLink.disabled = false;
            }
        });
        $summaryVerified.appendChild(document.createTextNode(' '));
        $summaryVerified.appendChild(verifyLink);
    }

    $summarySince.textContent = formatDate(account.created_at);

    // Form fields
    $displayName.value = profile.display_name;
    $bio.value = profile.bio;
    $website.value = profile.website;

    renderWalletSection();
}

/* ── Favorites rendering + viewer ── */

const PLACEHOLDER_SVG = `<svg width="24" height="24" fill="rgba(255,255,255,0.08)" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z"/></svg>`;

const R2_PUBLIC_BASE = 'https://pub.bitbi.ai';
const RETIRED_SOUNDLAB_ITEM_IDS = new Set([
    'cosmic-sea',
    'zufall-und-notwendigkeit',
    'relativity',
    'tiny-hearts',
    'grok',
    'exclusive-track-01',
    'burning-slow',
    'feel-it-all',
    'the-ones-who-made-the-light',
    "rooms-i'll-never-live-in",
    'rooms-i-ll-never-live-in',
    'rooms-ill-never-live-in',
]);
const RETIRED_SOUNDLAB_TITLES = new Set([
    'cosmic sea',
    'zufall und notwendigkeit',
    'relativity',
    'tiny hearts',
    'grok',
    'groks groove remix',
    'exclusive track 01',
    'burning slow',
    'feel it all',
    'the ones who made the light',
    'rooms ill never live in',
]);

function hasFavoriteControlChars(value) {
    return /[\x00-\x1f\x7f]/.test(value);
}

function normalizeRetiredSoundLabValue(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[\u2018\u2019']/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function isCurrentMemtrackThumbUrl(value) {
    const url = String(value || '').trim();
    return /^\/api\/gallery\/memtracks\/[a-f0-9]+\/[^/]+\/poster$/i.test(url)
        || /^\/api\/gallery\/memtracks\/[a-f0-9]+\/poster$/i.test(url);
}

function isRetiredSoundLabFavorite(fav) {
    if (fav?.item_type !== 'soundlab') return false;
    const itemId = String(fav.item_id || '').trim().toLowerCase();
    const normalizedItemId = normalizeRetiredSoundLabValue(itemId);
    const thumbUrl = String(fav.thumb_url || '').trim();
    if (RETIRED_SOUNDLAB_ITEM_IDS.has(itemId) || RETIRED_SOUNDLAB_TITLES.has(normalizedItemId)) return true;
    if (thumbUrl.includes('/audio/sound-lab/') || thumbUrl.includes('/sound-lab/thumbs/')) return true;
    if (isCurrentMemtrackThumbUrl(thumbUrl)) return false;
    return RETIRED_SOUNDLAB_TITLES.has(normalizeRetiredSoundLabValue(fav.title));
}

function normalizeFavoriteThumbUrl(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed || hasFavoriteControlChars(trimmed)) return '';
    if (trimmed.startsWith('//')) return '';

    if (trimmed.startsWith('/')) {
        if (trimmed.includes('?') || trimmed.includes('#')) return '';
        return trimmed;
    }

    let parsed;
    try {
        parsed = new URL(trimmed);
    } catch {
        return '';
    }

    if (parsed.protocol !== 'https:') return '';
    if (parsed.origin !== R2_PUBLIC_BASE) return '';
    if (parsed.username || parsed.password) return '';
    if (parsed.search || parsed.hash) return '';
    if (!parsed.pathname || parsed.pathname === '/') return '';
    return `${R2_PUBLIC_BASE}${parsed.pathname}`;
}

function createFavoriteViewerCard() {
    const card = document.createElement('div');
    card.className = 'fav-viewer__card';

    const image = document.createElement('div');
    image.className = 'fav-viewer__image';

    const info = document.createElement('div');
    info.className = 'fav-viewer__info';

    card.appendChild(image);
    card.appendChild(info);
    return { card, image, info };
}

function createFavoriteViewerImage(url, alt) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = alt;
    if (url.startsWith('/api/')) {
        img.crossOrigin = 'use-credentials';
    }
    return img;
}

function buildMempicFavoritePreviewUrl(fav) {
    const version = getPublicMempicVersionFromUrl(fav?.thumb_url);
    if (version) {
        return buildPublicMempicUrl(String(fav.item_id || ''), version, 'medium');
    }
    return `/api/gallery/mempics/${encodeURIComponent(String(fav.item_id || ''))}/medium`;
}

function buildMempicFavoriteFullUrl(fav) {
    const version = getPublicMempicVersionFromUrl(fav?.thumb_url);
    if (version) {
        return buildPublicMempicUrl(String(fav.item_id || ''), version, 'file');
    }
    return `/api/gallery/mempics/${encodeURIComponent(String(fav.item_id || ''))}/file`;
}

function buildVideoFavoriteFileUrl(fav) {
    const version = getPublicMemvidVersionFromUrl(fav?.thumb_url);
    if (version) {
        return buildPublicMemvidUrl(String(fav.item_id || ''), version, 'file');
    }
    return `/api/gallery/memvids/${encodeURIComponent(String(fav.item_id || ''))}/file`;
}

function buildMemtrackFavoriteFileUrl(fav) {
    const version = getPublicMemtrackVersionFromUrl(fav?.thumb_url);
    if (version) {
        return buildPublicMemtrackUrl(String(fav.item_id || ''), version, 'file');
    }
    return '';
}

/* ── Viewer overlay ── */
const $viewer = document.getElementById('favViewer');
const $viewerBody = $viewer ? $viewer.querySelector('.fav-viewer__body') : null;
const $viewerClose = document.getElementById('favViewerClose');
let viewerAudioCleanup = null;

function openViewer(mode) {
    if (!$viewer) return;
    $viewer.className = `fav-viewer active ${mode || ''}`;
    document.body.style.overflow = 'hidden';
}

function closeViewer() {
    if (!$viewer) return;
    $viewer.classList.remove('active');
    syncAvatarModalBodyLock();
    if (viewerAudioCleanup) {
        viewerAudioCleanup();
        viewerAudioCleanup = null;
    }
    /* Cleanup iframe */
    const iframe = $viewerBody.querySelector('iframe');
    if (iframe) iframe.src = '';
    const video = $viewerBody.querySelector('video');
    if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
    }
    /* Clear body */
    $viewerBody.innerHTML = '';
    $viewer.className = 'fav-viewer';
    /* Reset star */
    viewerCurrentFav = null;
    $viewerStar.style.display = 'none';
}

if ($viewerClose) $viewerClose.addEventListener('click', closeViewer);
if ($viewer) {
    $viewer.querySelector('.fav-viewer__backdrop').addEventListener('click', closeViewer);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && $viewer.classList.contains('active')) closeViewer();
    });
}

/* ── Viewer favorite star (remove-from-viewer) ── */
let viewerCurrentFav = null;
const $viewerStar = document.createElement('button');
$viewerStar.type = 'button';
$viewerStar.className = 'fav-star fav-star--active fav-viewer__fav-star';
$viewerStar.setAttribute('aria-pressed', 'true');
$viewerStar.setAttribute('aria-label', 'Remove from favorites');
$viewerStar.innerHTML = '<svg class="fav-star__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z"/></svg>';
$viewerStar.style.display = 'none';
if ($viewer) $viewer.appendChild($viewerStar);

let viewerStarBusyFav = null;

$viewerStar.addEventListener('click', async () => {
    if (!viewerCurrentFav || viewerStarBusyFav === viewerCurrentFav) return;
    const fav = viewerCurrentFav;
    viewerStarBusyFav = fav;

    /* Optimistic UI */
    $viewerStar.classList.remove('fav-star--active');
    $viewerStar.setAttribute('aria-pressed', 'false');
    $viewerStar.setAttribute('aria-label', 'Removed from favorites');

    const res = await apiRemoveFavorite(fav.item_type, fav.item_id);
    if (viewerStarBusyFav === fav) viewerStarBusyFav = null;

    /* Only mutate state if viewer still shows the same item */
    const stale = viewerCurrentFav !== fav;

    if (res.ok) {
        removeFavTile(fav.item_type, fav.item_id);
        if (!stale) viewerCurrentFav = null;
    } else if (!stale) {
        /* Revert only if still viewing the same item */
        $viewerStar.classList.add('fav-star--active');
        $viewerStar.setAttribute('aria-pressed', 'true');
        $viewerStar.setAttribute('aria-label', 'Remove from favorites');
    }
});

function removeFavTile(type, id) {
    const tile = document.querySelector(`.fav-tile[data-fav-key="${type}:${id}"]`);
    if (!tile) return;
    const grid = tile.parentElement;
    tile.remove();
    if (grid && grid.children.length === 0) {
        const container = grid.parentElement;
        const toggle = container.querySelector('.favorites__toggle');
        if (toggle) toggle.remove();
        grid.remove();
        const empty = document.createElement('p');
        empty.className = 'favorites__empty';
        empty.textContent = 'No favorites yet';
        container.appendChild(empty);
    } else if (grid) {
        const container = grid.parentElement;
        const toggle = container.querySelector('.favorites__toggle');
        if (toggle && grid.children.length <= 4) {
            Array.from(grid.children).forEach(t => { t.style.display = ''; });
            toggle.remove();
        } else if (toggle && toggle.getAttribute('aria-expanded') === 'false') {
            Array.from(grid.children).forEach((t, i) => { t.style.display = i < 4 ? '' : 'none'; });
        }
    }
}

/* ── Open gallery image in viewer ── */
function openGalleryInViewer(fav) {
    const item = galleryItems.find(g => g.id === fav.item_id);
    const title = String(fav.title || '');
    const previewUrl = item ? item.preview.url : normalizeFavoriteThumbUrl(fav.thumb_url);
    const caption = item ? item.caption : '';
    const fullUrl = item && item.full ? item.full.url : '';

    const { card, image, info } = createFavoriteViewerCard();
    if (previewUrl) {
        const img = createFavoriteViewerImage(previewUrl, title);
        img.style.background = '#0D1B2A';
        image.appendChild(img);
    }

    const heading = document.createElement('h3');
    heading.className = 'fav-viewer__title';
    heading.textContent = title;
    info.appendChild(heading);

    if (caption) {
        const captionEl = document.createElement('p');
        captionEl.className = 'fav-viewer__caption';
        captionEl.textContent = caption;
        info.appendChild(captionEl);
    }

    if (fullUrl) {
        const fullLink = document.createElement('a');
        fullLink.className = 'fav-viewer__full-link';
        fullLink.href = fullUrl;
        fullLink.target = '_blank';
        fullLink.rel = 'noopener noreferrer';
        fullLink.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
        fullLink.appendChild(document.createTextNode(' Open full size'));
        info.appendChild(fullLink);
    }

    $viewerBody.innerHTML = '';
    $viewerBody.appendChild(card);
    openViewer('');
}

function openMempicInViewer(fav) {
    const title = String(fav.title || 'Mempics');
    const previewUrl = buildMempicFavoritePreviewUrl(fav);
    const fullUrl = buildMempicFavoriteFullUrl(fav);

    const { card, image, info } = createFavoriteViewerCard();
    image.appendChild(createFavoriteViewerImage(previewUrl, title));

    const heading = document.createElement('h3');
    heading.className = 'fav-viewer__title';
    heading.textContent = title;
    info.appendChild(heading);

    const fullLink = document.createElement('a');
    fullLink.className = 'fav-viewer__full-link';
    fullLink.href = fullUrl;
    fullLink.target = '_blank';
    fullLink.rel = 'noopener noreferrer';
    fullLink.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
    fullLink.appendChild(document.createTextNode(' Open full size'));
    info.appendChild(fullLink);

    $viewerBody.innerHTML = '';
    $viewerBody.appendChild(card);
    openViewer('');
}

/* ── Open soundlab track in viewer ── */
function openSoundlabInViewer(fav) {
    const title = String(fav.title || '');
    const thumbUrl = normalizeFavoriteThumbUrl(fav.thumb_url);
    const memtrackFileUrl = buildMemtrackFavoriteFileUrl(fav);
    if (!memtrackFileUrl) return;
    initGlobalAudioManager();
    if (viewerAudioCleanup) {
        viewerAudioCleanup();
        viewerAudioCleanup = null;
    }

    const player = document.createElement('div');
    player.className = 'fav-viewer__player';

    const hero = document.createElement('div');
    hero.className = 'fav-viewer__player-hero';
    if (thumbUrl) {
        hero.appendChild(createFavoriteViewerImage(thumbUrl, title));
    } else {
        const placeholder = document.createElement('div');
        placeholder.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at 30% 40%,rgba(255,179,0,0.08),transparent 60%),#060e18';
        placeholder.innerHTML = '<svg width="48" height="48" fill="rgba(255,179,0,0.2)" viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>';
        hero.appendChild(placeholder);
    }

    const controls = document.createElement('div');
    controls.className = 'fav-viewer__player-controls';

    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'fav-viewer__play-btn';
    playBtn.id = 'fvPlay';
    playBtn.setAttribute('aria-label', `Play ${title}`);
    playBtn.innerHTML = '<svg id="fvPlayIcon" width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg><svg id="fvPauseIcon" width="18" height="18" fill="currentColor" viewBox="0 0 24 24" style="display:none"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';

    const trackInfo = document.createElement('div');
    trackInfo.className = 'fav-viewer__track-info';

    const trackTitle = document.createElement('div');
    trackTitle.className = 'fav-viewer__track-title';
    trackTitle.textContent = title;

    const timeEl = document.createElement('div');
    timeEl.className = 'fav-viewer__track-time';
    timeEl.id = 'fvTime';
    timeEl.textContent = '0:00';

    const barEl = document.createElement('div');
    barEl.className = 'fav-viewer__progress';
    barEl.id = 'fvBar';

    const progEl = document.createElement('div');
    progEl.className = 'fav-viewer__progress-fill';
    progEl.id = 'fvProg';
    barEl.appendChild(progEl);

    trackInfo.appendChild(trackTitle);
    trackInfo.appendChild(timeEl);
    trackInfo.appendChild(barEl);
    controls.appendChild(playBtn);
    controls.appendChild(trackInfo);
    player.appendChild(hero);
    player.appendChild(controls);

    $viewerBody.innerHTML = '';
    $viewerBody.appendChild(player);

    openViewer('');

    const track = {
        id: `memtrack:${fav.item_id}`,
        slug: `memtrack-${fav.item_id}`,
        title: title || 'Memtrack',
        sourceUrl: memtrackFileUrl,
        src: memtrackFileUrl,
        artworkUrl: thumbUrl,
        artwork: thumbUrl,
        access: 'public',
        collection: 'memtracks',
        originLabel: 'Profile favorites',
        crossOrigin: '',
    };
    if (!track) return;

    const playIcon = document.getElementById('fvPlayIcon');
    const pauseIcon = document.getElementById('fvPauseIcon');

    function renderViewerAudio(state) {
        const isCurrentTrack = state.trackId === track.id;
        const isPlaying = isCurrentTrack && state.status === 'playing';
        const duration = isCurrentTrack ? Number(state.duration) || 0 : 0;
        const currentTime = isCurrentTrack ? Number(state.currentTime) || 0 : 0;
        const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

        playIcon.style.display = isPlaying ? 'none' : '';
        pauseIcon.style.display = isPlaying ? '' : 'none';
        progEl.style.width = `${progress}%`;
        timeEl.textContent = duration > 0
            ? `${formatTime(currentTime)} / ${formatTime(duration)}`
            : '0:00';
    }

    viewerAudioCleanup = subscribeGlobalAudioState(renderViewerAudio);
    renderViewerAudio(getGlobalAudioState());

    playBtn.addEventListener('click', async () => {
        const audioState = getGlobalAudioState();
        const isCurrentTrack = audioState.trackId === track.id;
        if (isCurrentTrack && audioState.status === 'playing') {
            pauseGlobalAudio();
            return;
        }
        if (isCurrentTrack) {
            await resumeGlobalAudio(true);
            return;
        }
        playGlobalTrack(track);
    });

    barEl.addEventListener('click', (e) => {
        const audioState = getGlobalAudioState();
        if (audioState.trackId !== track.id || !audioState.duration) return;
        const rect = barEl.getBoundingClientRect();
        seekGlobalAudio(((e.clientX - rect.left) / rect.width) * audioState.duration);
    });
}

function openVideoInViewer(fav) {
    const title = String(fav.title || 'Video');
    const fileUrl = buildVideoFavoriteFileUrl(fav);
    const posterUrl = normalizeFavoriteThumbUrl(fav.thumb_url);

    const { card, image, info } = createFavoriteViewerCard();

    const video = document.createElement('video');
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.src = fileUrl;
    if (posterUrl) {
        video.poster = posterUrl;
    }
    image.appendChild(video);

    const heading = document.createElement('h3');
    heading.className = 'fav-viewer__title';
    heading.textContent = title;
    info.appendChild(heading);

    const openLink = document.createElement('a');
    openLink.className = 'fav-viewer__full-link';
    openLink.href = fileUrl;
    openLink.target = '_blank';
    openLink.rel = 'noopener noreferrer';
    openLink.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
    openLink.appendChild(document.createTextNode(' Open video'));
    info.appendChild(openLink);

    $viewerBody.innerHTML = '';
    $viewerBody.appendChild(card);
    openViewer('');
}

/* ── Build favorite tiles ── */
function renderFavorites(favorites) {
    const groups = { mempics: [], video: [], soundlab: [] };
    for (const f of favorites) {
        if (isRetiredSoundLabFavorite(f)) continue;
        if (groups[f.item_type]) groups[f.item_type].push(f);
    }

    for (const [type, items] of Object.entries(groups)) {
        const container = document.querySelector(`[data-favorites-type="${type}"]`);
        if (!container) continue;

        const label = container.querySelector('.favorites__group-label');
        container.innerHTML = '';
        if (label) container.appendChild(label);

        if (items.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'favorites__empty';
            empty.textContent = 'No favorites yet';
            container.appendChild(empty);
            continue;
        }

        const grid = document.createElement('div');
        grid.className = 'favorites__grid';

        for (const fav of items) {
            const tile = document.createElement('div');
            tile.className = 'fav-tile fav-tile--interactive';
            tile.setAttribute('role', 'button');
            tile.setAttribute('tabindex', '0');
            tile.dataset.favKey = `${fav.item_type}:${fav.item_id}`;
            tile.title = fav.title;

            tile.addEventListener('click', () => handleTileClick(fav));
            tile.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleTileClick(fav); }
            });

            const safeThumbUrl = normalizeFavoriteThumbUrl(fav.thumb_url);

            if (safeThumbUrl) {
                const img = document.createElement('img');
                img.className = 'fav-tile__img';
                img.src = safeThumbUrl;
                img.alt = fav.title;
                img.loading = 'lazy';
                img.decoding = 'async';
                if (safeThumbUrl.startsWith('/api/')) {
                    img.crossOrigin = 'use-credentials';
                }
                img.onerror = function () {
                    this.onerror = null;
                    this.style.display = 'none';
                    const ph = document.createElement('div');
                    ph.className = 'fav-tile__placeholder';
                    ph.innerHTML = PLACEHOLDER_SVG;
                    this.parentElement.insertBefore(ph, this);
                };
                tile.appendChild(img);
            } else {
                const ph = document.createElement('div');
                ph.className = 'fav-tile__placeholder';
                ph.innerHTML = PLACEHOLDER_SVG;
                tile.appendChild(ph);
            }

            const lbl = document.createElement('div');
            lbl.className = 'fav-tile__label';
            lbl.textContent = fav.title;
            tile.appendChild(lbl);

            grid.appendChild(tile);
        }

        container.appendChild(grid);

        /* Collapse to 4 items if more exist */
        const LIMIT = 4;
        if (items.length > LIMIT) {
            const tiles = Array.from(grid.children);
            tiles.forEach((t, i) => { if (i >= LIMIT) t.style.display = 'none'; });

            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'favorites__toggle';
            toggle.setAttribute('aria-expanded', 'false');
            toggle.innerHTML = '<svg class="favorites__toggle-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg> Show all';

            toggle.addEventListener('click', () => {
                const expanded = toggle.getAttribute('aria-expanded') === 'true';
                const allTiles = Array.from(grid.children);
                if (expanded) {
                    allTiles.forEach((t, i) => { if (i >= LIMIT) t.style.display = 'none'; });
                    toggle.setAttribute('aria-expanded', 'false');
                    toggle.innerHTML = '<svg class="favorites__toggle-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg> Show all';
                } else {
                    allTiles.forEach(t => { t.style.display = ''; });
                    toggle.setAttribute('aria-expanded', 'true');
                    toggle.innerHTML = '<svg class="favorites__toggle-arrow favorites__toggle-arrow--up" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg> Show less';
                }
            });

            container.appendChild(toggle);
        }
    }
}

function handleTileClick(fav) {
    viewerCurrentFav = fav;
    $viewerStar.classList.add('fav-star--active');
    $viewerStar.setAttribute('aria-pressed', 'true');
    $viewerStar.setAttribute('aria-label', 'Remove from favorites');
    $viewerStar.style.display = '';

    switch (fav.item_type) {
        case 'gallery': openGalleryInViewer(fav); break;
        case 'mempics': openMempicInViewer(fav); break;
        case 'video': openVideoInViewer(fav); break;
        case 'soundlab': openSoundlabInViewer(fav); break;
    }
}

subscribeWalletState((state) => {
    walletViewState = state;
    renderWalletSection(state);
});

/* ── Init ── */
async function init() {
    // Shared header (nav, mobile menu, auth)
    try { initSiteHeader(); } catch (e) { console.warn(e); }

    // Visual modules (non-blocking)
    try { initParticles('heroCanvas'); }      catch (e) { console.warn(e); }
    try { initBinaryRain('binaryRain'); }     catch (e) { console.warn(e); }
    try { initBinaryFooter('binaryFooter'); } catch (e) { console.warn(e); }
    try { initScrollReveal(); }               catch (e) { console.warn(e); }
    try { initCookieConsent(); }              catch (e) { console.warn(e); }

    // Load profile (doubles as auth check — returns 401 if not logged in)
    const res = await apiGetProfile();

    if (!res.ok) {
        showState($denied);
        $denied.classList.add('visible');
        return;
    }

    // Show profile content
    showState($content);
    renderProfile(res.data.profile, res.data.account);
    loadAvatar(false);
    refreshWalletStatus().catch(e => console.warn('walletStatus:', e));

    // Load and render favorites
    apiGetFavorites().then(favRes => {
        if (favRes.ok && Array.isArray(favRes.data?.favorites)) {
            renderFavorites(favRes.data.favorites);
        }
    }).catch(e => console.warn('favorites:', e));

    // Avatar source chooser + picker
    $avatarChangeBtn?.addEventListener('click', () => {
        if (avatarActionBusy) return;
        openAvatarSourceModal();
    });

    $avatarSourceClose?.addEventListener('click', () => {
        closeAvatarSourceModal({ focusEl: $avatarChangeBtn });
    });

    $avatarAssetsClose?.addEventListener('click', () => {
        closeAvatarAssetsModal({ focusEl: $avatarChangeBtn });
    });

    $avatarSourceModal?.addEventListener('click', (event) => {
        if (event.target === $avatarSourceModal) {
            closeAvatarSourceModal({ focusEl: $avatarChangeBtn });
        }
    });

    $avatarAssetsModal?.addEventListener('click', (event) => {
        if (event.target === $avatarAssetsModal) {
            closeAvatarAssetsModal({ focusEl: $avatarChangeBtn });
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if ($avatarAssetsModal && !$avatarAssetsModal.hidden) {
            event.preventDefault();
            closeAvatarAssetsModal({ focusEl: $avatarChangeBtn });
            return;
        }
        if ($avatarSourceModal && !$avatarSourceModal.hidden) {
            event.preventDefault();
            closeAvatarSourceModal({ focusEl: $avatarChangeBtn });
        }
    });

    $avatarChooseUploadDevice?.addEventListener('click', () => {
        closeAvatarSourceModal({ focusEl: $avatarChangeBtn });
        window.setTimeout(() => $avatarInput?.click(), 0);
    });

    $avatarChooseSavedAssets?.addEventListener('click', async () => {
        closeAvatarSourceModal({ focusEl: $avatarChangeBtn });
        await openAvatarAssetsModal();
    });

    initAvatarGenerate({
        onAvatarUpdated: () => {
            patchAuthUser({
                has_avatar: true,
                avatar_url: `${AVATAR_URL}?t=${Date.now()}`,
            });
            showAvatarMsg('Photo updated.', 'success');
            loadAvatar(true);
            syncAvatarModalBodyLock();
            $avatarChangeBtn?.focus();
        },
        onClose: () => {
            syncAvatarModalBodyLock();
        },
    });

    $avatarChooseGenerate?.addEventListener('click', () => {
        closeAvatarSourceModal({ focusEl: null });
        openAvatarGenerateModal();
    });

    $avatarAssetsFilter?.addEventListener('change', () => {
        void loadAvatarPickerAssets();
    });

    // Avatar upload
    $avatarInput.addEventListener('change', async () => {
        const file = $avatarInput.files?.[0];
        if (!file) return;

        hideAvatarMsg();

        if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
            showAvatarMsg('Invalid file type. Allowed: JPEG, PNG, WebP.', 'error');
            $avatarInput.value = '';
            return;
        }
        if (file.size > MAX_AVATAR_SIZE) {
            showAvatarMsg('File too large. Maximum size is 2 MB.', 'error');
            $avatarInput.value = '';
            return;
        }

        const wasRemoveDisabled = $avatarRemoveBtn.disabled;
        setAvatarActionState(true, 'Uploading\u2026');
        $avatarRemoveBtn.disabled = true;

        const result = await apiUploadAvatar(file);

        setAvatarActionState(false);
        $avatarRemoveBtn.disabled = wasRemoveDisabled;
        $avatarInput.value = '';

        if (result.ok) {
            patchAuthUser({
                has_avatar: true,
                avatar_url: `${AVATAR_URL}?t=${Date.now()}`,
            });
            showAvatarMsg('Photo updated.', 'success');
            loadAvatar(true);
        } else {
            showAvatarMsg(result.error, 'error');
        }
    });

    // Avatar remove
    $avatarRemoveBtn.addEventListener('click', async () => {
        hideAvatarMsg();
        setAvatarActionState(true);
        $avatarRemoveBtn.disabled = true;
        $avatarRemoveBtn.textContent = 'Removing\u2026';

        const result = await apiDeleteAvatar();

        setAvatarActionState(false);
        $avatarRemoveBtn.disabled = false;
        $avatarRemoveBtn.textContent = 'Remove';

        if (result.ok) {
            patchAuthUser({
                has_avatar: false,
                avatar_url: null,
            });
            showAvatarMsg('Photo removed.', 'success');
            loadAvatar(true);
        } else {
            showAvatarMsg(result.error, 'error');
        }
    });

    // Form submission
    $form.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideMsg();

        $submitBtn.disabled = true;
        $submitBtn.textContent = 'Saving...';

        const result = await apiUpdateProfile({
            display_name: $displayName.value,
            bio: $bio.value,
            website: $website.value,
        });

        $submitBtn.disabled = false;
        $submitBtn.textContent = 'Save Changes';

        if (result.ok) {
            patchAuthUser({
                display_name: $displayName.value.trim(),
            });
            showMsg('Profile updated.', 'success');
            $summaryName.textContent = $displayName.value.trim() || '\u2014';
        } else {
            showMsg(result.error, 'error');
        }
    });

    // Logout button
    $logoutBtn.addEventListener('click', async () => {
        await apiLogout();
        window.location.href = '/';
    });
}

init();
