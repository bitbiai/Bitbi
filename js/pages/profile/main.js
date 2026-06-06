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
    openWalletWorkspaceView,
    refreshWalletStatus,
} from '../../shared/wallet/wallet-controller.js?v=__ASSET_VERSION__';
import { subscribeWalletState } from '../../shared/wallet/wallet-state.js?v=__ASSET_VERSION__';
import { localeText } from '../../shared/locale.js?v=__ASSET_VERSION__';
import { renderPostAuthHint } from '../../shared/auth-post-auth-hint.js?v=__ASSET_VERSION__';

import {
    apiAiGetFolders,
    apiAiGetImages,
    apiDeleteAvatar,
    apiAccountCreditsDashboard,
    apiGetProfile,
    apiGetProfileMedia,
    apiGetProfileSocialList,
    apiGetProfileSocialSummary,
    apiLogout,
    apiRequestReverification,
    apiSetAvatarFromSavedAsset,
    apiUpdateProfile,
    apiUploadAvatar,
} from '../../shared/auth-api.js?v=__ASSET_VERSION__';
import { formatAssetStorageUsage } from '../../shared/storage-format.js?v=__ASSET_VERSION__';
import {
    initAvatarGenerate,
    openAvatarGenerateModal,
    closeAvatarGenerateModal,
    isAvatarGenerateModalOpen,
} from './avatar-generate.js?v=__ASSET_VERSION__';

/* ── DOM refs ── */
const $loading        = document.getElementById('loadingState');
const $denied         = document.getElementById('deniedState');
const $content        = document.getElementById('profileContent');

const $summaryName    = document.getElementById('summaryName');
const $summaryEmail   = document.getElementById('summaryEmail');
const $summaryRole    = document.getElementById('summaryRole');
const $summaryVerified = document.getElementById('summaryVerified');
const $summarySince   = document.getElementById('summarySince');
const $profileCompletionStatus = document.getElementById('profileCompletionStatus');
const $completionSignedInStatus = document.getElementById('completionSignedInStatus');
const $completionEmailStatus = document.getElementById('completionEmailStatus');
const $completionProfileImageStatus = document.getElementById('completionProfileImageStatus');
const $completionDisplayNameStatus = document.getElementById('completionDisplayNameStatus');
const $completionWalletStatus = document.getElementById('completionWalletStatus');
const $profileWalletWorkspaceBtn = document.getElementById('profileWalletWorkspaceBtn');
const $walletCard     = document.getElementById('profileWalletCard');
const $walletCardStatus = document.getElementById('profileWalletCardStatus');
const $profileHomeView = document.getElementById('profileHomeView');
const $profileHero = document.getElementById('profileHero');
const $profileStorageUsage = document.getElementById('profileStorageUsage');
const $profileCreditsBalance = document.getElementById('profileCreditsBalance');
const $profileFollowerCount = document.getElementById('profileFollowerCount');
const $profileFollowingCount = document.getElementById('profileFollowingCount');
const $profileReceivedLikeCount = document.getElementById('profileReceivedLikeCount');
const $profileMediaStatus = document.getElementById('profileMediaStatus');
const $profileMediaGrid = document.getElementById('profileMediaGrid');
const $profileInteractionsOverlay = document.getElementById('profileInteractionsOverlay');
const $profileInteractionsPanel = document.getElementById('profileInteractionsPanel');
const $profileInteractionsClose = document.getElementById('profileInteractionsClose');
const $profileInteractionsList = document.getElementById('profileInteractionsList');
const $profileInteractionsStatus = document.getElementById('profileInteractionsStatus');

const $form           = document.getElementById('profileForm');
const $displayName    = document.getElementById('displayName');
const $bio            = document.getElementById('bio');
const $website        = document.getElementById('website');
const $submitBtn      = document.getElementById('submitBtn');
const $formMsg        = document.getElementById('formMsg');
const $profileEditState = document.getElementById('profileEditState');
const $profileSaveRecovery = document.getElementById('profileSaveRecovery');
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
let profileCompletionContext = null;
let savedProfileFields = null;

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

$walletCard?.addEventListener('click', () => {
    openWalletWorkspaceView();
});

document.querySelectorAll('[data-open-wallet-workspace]').forEach((trigger) => {
    trigger.addEventListener('click', () => {
        openWalletWorkspaceView();
    });
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

function setEditState(text, type = 'neutral') {
    if (!$profileEditState) return;
    $profileEditState.textContent = text || '';
    $profileEditState.className = `profile__edit-state profile__edit-state--${type}`;
}

function getCurrentProfileFields() {
    return {
        display_name: String($displayName?.value || '').trim(),
        bio: String($bio?.value || ''),
        website: String($website?.value || '').trim(),
    };
}

function normalizeProfileFields(profile = {}) {
    return {
        display_name: String(profile.display_name || '').trim(),
        bio: String(profile.bio || ''),
        website: String(profile.website || '').trim(),
    };
}

function fieldsEqual(left, right) {
    return left?.display_name === right?.display_name
        && left?.bio === right?.bio
        && left?.website === right?.website;
}

function updateEditState(mode = 'idle') {
    if (!savedProfileFields) return;

    if (mode === 'saving') {
        setEditState(localeText('profile.editSaving'), 'busy');
        return;
    }
    if (mode === 'saved') {
        setEditState(localeText('profile.editSaved'), 'success');
        return;
    }
    if (mode === 'error') {
        setEditState(localeText('profile.editSaveFailed'), 'error');
        return;
    }

    const currentFields = getCurrentProfileFields();
    if (fieldsEqual(currentFields, savedProfileFields)) {
        setEditState(localeText('profile.editNoChanges'), 'neutral');
    } else {
        setEditState(localeText('profile.editUnsavedChanges'), 'warning');
        if ($profileSaveRecovery) $profileSaveRecovery.hidden = true;
    }
}

function setCompletionStatus(el, text, state = 'pending') {
    if (!el) return;
    el.textContent = text;
    el.className = `profile__completion-state profile__completion-state--${state}`;
    const item = el.closest('.profile__completion-item');
    if (item) {
        item.dataset.state = state;
        item.setAttribute('aria-label', `${item.querySelector('.profile__completion-label')?.textContent || ''}: ${text}`);
    }
}

function getEmailCompletion(account = {}) {
    const isLegacy = account.verification_method === 'legacy_auto';
    if (account.email_verified && !isLegacy) {
        return { done: true, text: localeText('profile.completionEmailVerified'), state: 'complete' };
    }
    if (isLegacy) {
        return { done: false, text: localeText('profile.completionEmailReview'), state: 'attention' };
    }
    if (account.email_verified === false) {
        return { done: false, text: localeText('profile.completionEmailUnverified'), state: 'attention' };
    }
    return { done: false, text: localeText('profile.completionUnknown'), state: 'pending' };
}

function getWalletCompletion(state = walletViewState) {
    if (!state || !state.authReady || state.identityStatus === 'loading') {
        return { done: false, text: localeText('profile.completionWalletLoading'), state: 'pending' };
    }
    if (state.identityStatus === 'error') {
        return { done: false, text: localeText('profile.completionWalletUnavailable'), state: 'attention' };
    }
    if (state.linkedWallet) {
        return { done: true, text: localeText('profile.completionWalletLinked'), state: 'complete' };
    }
    return { done: false, text: localeText('profile.completionWalletNotLinked'), state: 'pending' };
}

function syncWalletCardStatus(state = walletViewState) {
    if (!$walletCardStatus) return;
    const walletStateResult = getWalletCompletion(state);
    $walletCardStatus.textContent = walletStateResult.text;
    $walletCardStatus.dataset.state = walletStateResult.state;
}

function getBooleanProfileSignal(profile = {}, fields = []) {
    for (const field of fields) {
        if (!Object.prototype.hasOwnProperty.call(profile, field)) continue;
        const value = profile[field];
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') return value.trim().length > 0;
        if (value !== null && value !== undefined) return Boolean(value);
    }
    return null;
}

function getProfileImageCompletion(profile = {}) {
    const hasImage = getBooleanProfileSignal(profile, [
        'has_avatar',
        'hasAvatar',
        'avatar_url',
        'avatarUrl',
    ]);
    if (hasImage === true) {
        return { done: true, text: localeText('profile.completionProfileImageSet'), state: 'complete' };
    }
    if (hasImage === false) {
        return { done: false, text: localeText('profile.completionProfileImageMissing'), state: 'pending' };
    }
    return { done: false, text: localeText('profile.completionUnknown'), state: 'pending' };
}

function getDisplayNameCompletion(profile = {}) {
    const displayName = String(profile.display_name || profile.displayName || '').trim();
    if (displayName) {
        return { done: true, text: localeText('profile.completionDisplayNameSet'), state: 'complete' };
    }
    return { done: false, text: localeText('profile.completionDisplayNameMissing'), state: 'pending' };
}

function renderProfileCompletion(profile = {}, account = {}, walletState = walletViewState) {
    if (!$profileCompletionStatus) return;

    const emailState = getEmailCompletion(account);
    const profileImageState = getProfileImageCompletion(profile);
    const displayNameState = getDisplayNameCompletion(profile);
    const walletStateResult = getWalletCompletion(walletState);
    const checks = [
        { done: true, el: $completionSignedInStatus, text: localeText('profile.completionSignedIn'), state: 'complete' },
        { ...emailState, el: $completionEmailStatus },
        { ...profileImageState, el: $completionProfileImageStatus },
        { ...displayNameState, el: $completionDisplayNameStatus },
        { ...walletStateResult, el: $completionWalletStatus },
    ];

    checks.forEach((check) => setCompletionStatus(check.el, check.text, check.state));
    const completed = checks.filter((check) => check.done).length;
    $profileCompletionStatus.textContent = localeText('profile.completionSummary', {
        completed,
        total: checks.length,
    });
    $profileCompletionStatus.className = completed === checks.length
        ? 'profile__completion-status profile__completion-status--complete'
        : 'profile__completion-status';
}

function syncProfileAvatarCompletion(hasAvatar) {
    if (!profileCompletionContext) return;
    profileCompletionContext.profile = {
        ...profileCompletionContext.profile,
        has_avatar: Boolean(hasAvatar),
        avatar_url: hasAvatar ? AVATAR_URL : null,
    };
    renderProfileCompletion(profileCompletionContext.profile, profileCompletionContext.account);
}

function renderWalletSection(state = walletViewState) {
    if (profileCompletionContext) {
        renderProfileCompletion(profileCompletionContext.profile, profileCompletionContext.account, state);
    }
    syncWalletCardStatus(state);
}

const profileNumberFormatter = new Intl.NumberFormat(document.documentElement.lang?.startsWith('de') ? 'de-DE' : 'en-US');

function formatProfileCredits(value) {
    return localeText('credits.credits', { count: profileNumberFormatter.format(Number(value || 0)) });
}

async function loadProfileCardMetadata() {
    if ($profileStorageUsage) {
        $profileStorageUsage.textContent = localeText('profile.loading');
        apiAiGetFolders()
            .then((result) => {
                const usageText = formatAssetStorageUsage(result?.storageUsage);
                $profileStorageUsage.textContent = usageText || localeText('profile.storageUnavailable');
            })
            .catch(() => {
                $profileStorageUsage.textContent = localeText('profile.storageUnavailable');
            });
    }

    if ($profileCreditsBalance) {
        $profileCreditsBalance.textContent = localeText('profile.loading');
        apiAccountCreditsDashboard({ limit: 1 })
            .then((result) => {
                if (!result.ok) throw new Error('credits_unavailable');
                const dashboard = result.data?.data || result.data || {};
                const balance = dashboard.balance || {};
                const credits = balance.totalCredits ?? balance.current ?? balance.available ?? 0;
                $profileCreditsBalance.textContent = formatProfileCredits(credits);
            })
            .catch(() => {
                $profileCreditsBalance.textContent = localeText('profile.creditsUnavailable');
            });
    }
}

/* ── Avatar helpers ── */
const AVATAR_URL = '/api/profile/avatar';
const MAX_AVATAR_SIZE = 2 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const AVATAR_UNFOLDERED_FILTER = '__unfoldered__';
const AVATAR_DEFAULT_STATUS = localeText('profile.chooseProfilePhoto');

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
    if (!$avatarMsg) return;
    $avatarMsg.textContent = text;
    $avatarMsg.className = `profile__msg profile__msg--${type}`;
}

function hideAvatarMsg() {
    if (!$avatarMsg) return;
    $avatarMsg.className = 'profile__msg';
    $avatarMsg.textContent = '';
}

function loadAvatar(bustCache) {
    if (!$avatarImg || !$avatarPlaceholder || !$avatarRemoveBtn) {
        syncProfileAvatarCompletion(false);
        return;
    }
    const src = bustCache ? `${AVATAR_URL}?t=${Date.now()}` : AVATAR_URL;
    const img = new Image();
    img.onload = () => {
        $avatarImg.src = img.src;
        $avatarImg.style.display = '';
        $avatarPlaceholder.style.display = 'none';
        $avatarRemoveBtn.style.display = '';
        syncProfileAvatarCompletion(true);
    };
    img.onerror = () => {
        $avatarImg.style.display = 'none';
        $avatarPlaceholder.style.display = '';
        $avatarRemoveBtn.style.display = 'none';
        syncProfileAvatarCompletion(false);
    };
    img.src = src;
}

function setAvatarActionState(isBusy, text = localeText('profile.changePhoto')) {
    avatarActionBusy = isBusy;
    if ($avatarChangeBtn) $avatarChangeBtn.disabled = isBusy;
    if ($avatarInput) $avatarInput.disabled = isBusy;
    if ($avatarChooseSavedAssets) $avatarChooseSavedAssets.disabled = isBusy;
    if ($avatarChooseUploadDevice) $avatarChooseUploadDevice.disabled = isBusy;
    if ($avatarChooseGenerate) $avatarChooseGenerate.disabled = isBusy;
    if ($avatarUploadText) $avatarUploadText.textContent = isBusy ? text : localeText('profile.changePhoto');
}

function setAvatarRemoveButtonContent(
    label = localeText('profile.remove'),
    description = localeText('profile.removePhotoDesc'),
) {
    if (!$avatarRemoveBtn) return;
    $avatarRemoveBtn.textContent = '';
    const title = document.createElement('span');
    title.className = 'profile-avatar-modal__option-title';
    title.textContent = label;
    const desc = document.createElement('span');
    desc.className = 'profile-avatar-modal__option-desc';
    desc.textContent = description;
    $avatarRemoveBtn.append(title, desc);
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
    document.body.style.overflow = '';
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
            label: localeText('profile.thumbnailUnavailable'),
            hint: localeText('profile.thumbnailUnavailableHint'),
        };
    }
    if (status === 'processing') {
        return {
            variant: 'pending',
            label: localeText('profile.thumbnailPreparing'),
            hint: localeText('profile.thumbnailPreparingHint'),
        };
    }
    return {
        variant: 'pending',
        label: localeText('profile.thumbnailPending'),
        hint: localeText('profile.thumbnailPendingHint'),
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
    title.textContent = asset.title || asset.preview_text || localeText('profile.savedImage');
    placeholder.appendChild(title);

    const hint = document.createElement('span');
    hint.className = 'studio__image-preview-hint';
    hint.textContent = state.hint;
    placeholder.appendChild(hint);

    return placeholder;
}

function getAvatarAssetMeta(asset) {
    const folderLabel = asset.folder_id
        ? avatarPickerState.folderNames.get(asset.folder_id) || localeText('profile.savedAssets')
        : localeText('profile.unfoldered');
    const dateLabel = asset.created_at ? formatDate(asset.created_at) : null;
    return [folderLabel, dateLabel].filter(Boolean).join(' / ');
}

function getAvatarAssetActionLabel(asset) {
    if (avatarPickerState.actionId === asset.id) {
        return localeText('profile.working');
    }
    if (asset.thumb_url) {
        return localeText('profile.usePhoto');
    }
    return asset.derivatives_status === 'failed' ? localeText('profile.retryPreview') : localeText('profile.preparePreview');
}

function renderAvatarAssetsGrid() {
    if (!$avatarAssetsGrid) return;

    $avatarAssetsGrid.innerHTML = '';

    if (avatarPickerState.loading) {
        const empty = document.createElement('div');
        empty.className = 'studio__gallery-empty';
        empty.textContent = localeText('profile.loadingSavedImages');
        $avatarAssetsGrid.appendChild(empty);
        return;
    }

    if (!avatarPickerState.assets.length) {
        const empty = document.createElement('div');
        empty.className = 'studio__gallery-empty';
        empty.textContent = localeText('profile.noSavedImages');
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
            img.alt = asset.title || asset.preview_text || localeText('profile.savedImage');
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
        title.textContent = asset.title || asset.preview_text || localeText('profile.savedImage');
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
    allOption.textContent = localeText('profile.allSavedImages');
    $avatarAssetsFilter.appendChild(allOption);

    if (unfolderedCount > 0) {
        const unfolderedOption = document.createElement('option');
        unfolderedOption.value = AVATAR_UNFOLDERED_FILTER;
        unfolderedOption.textContent = localeText('profile.unfoldered');
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
    setAvatarAssetsStatus(localeText('profile.loadingSavedImages'), 'neutral');
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
        avatarPickerState.assets.length ? AVATAR_DEFAULT_STATUS : localeText('profile.noSavedImages'),
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
            ? localeText('profile.retryingThumbnail')
            : localeText('profile.preparingThumbnail'),
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
        setAvatarAssetsStatus(localeText('profile.thumbnailReady'), 'success');
    } catch {
        setAvatarAssetsStatus(localeText('profile.networkError'), 'error');
    } finally {
        avatarPickerState.actionId = null;
        renderAvatarAssetsGrid();
    }
}

async function assignAvatarFromSavedAsset(asset) {
    if (!asset?.id || avatarPickerState.actionId || avatarActionBusy) return;

    avatarPickerState.actionId = asset.id;
    setAvatarActionState(true, localeText('profile.updating'));
    setAvatarAssetsStatus(localeText('profile.updatingProfilePhoto'), 'neutral');
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
            showAvatarMsg(localeText('profile.photoUpdated'), 'success');
            loadAvatar(true);
            return;
        }

        setAvatarAssetsStatus(
            result.error || localeText('profile.updatePhotoFailed'),
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

function isAuthFailure(res) {
    return res?.status === 401 || res?.status === 403;
}

function showDeniedState({ sessionExpired = false } = {}) {
    if (sessionExpired && $denied) {
        const title = document.getElementById('profileDeniedTitle');
        const copy = $denied.querySelector('.profile-denied__text');
        const primary = $denied.querySelector('[data-auth-entry="login"]');
        $denied.setAttribute('role', 'status');
        $denied.setAttribute('aria-live', 'polite');
        if (title) title.textContent = localeText('authRecovery.sessionExpiredTitle');
        if (copy) copy.textContent = localeText('authRecovery.sessionExpiredProfileCopy');
        if (primary) primary.textContent = localeText('authRecovery.sessionSignInAgain');
    }
    showState($denied);
    $denied.classList.add('visible');
}

/* ── Render profile data ── */
function renderProfile(profile, account) {
    profileCompletionContext = { profile, account };
    if ($walletCard) {
        $walletCard.hidden = false;
    }

    // Summary card
    if ($summaryName && $summaryEmail && $summaryRole && $summaryVerified && $summarySince) {
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
        verifiedBadge.textContent = isVerified ? localeText('profile.yes') : isLegacy ? localeText('profile.pending') : localeText('profile.no');
        $summaryVerified.appendChild(verifiedBadge);

        if (isLegacy) {
            const verifyLink = document.createElement('button');
            verifyLink.type = 'button';
            verifyLink.className = 'profile__verify-link';
            verifyLink.textContent = localeText('profile.verifyNow');
            verifyLink.addEventListener('click', async () => {
                verifyLink.disabled = true;
                verifyLink.textContent = localeText('profile.sending');
                const res = await apiRequestReverification();
                if (res.ok) {
                    verifyLink.textContent = localeText('profile.emailSent');
                } else {
                    verifyLink.textContent = localeText('profile.verifyNow');
                    verifyLink.disabled = false;
                }
            });
            $summaryVerified.appendChild(document.createTextNode(' '));
            $summaryVerified.appendChild(verifyLink);
        }

        $summarySince.textContent = formatDate(account.created_at);
    }

    // Form fields
    if ($displayName && $bio && $website) {
        $displayName.value = profile.display_name || '';
        $bio.value = profile.bio || '';
        $website.value = profile.website || '';
        savedProfileFields = normalizeProfileFields(profile);
        updateEditState('loaded');
    } else {
        savedProfileFields = normalizeProfileFields(profile);
    }

    renderProfileCompletion(profile, account);
    renderWalletSection();
}

/* ── Social dashboard ── */
const profileDashboardState = {
    mediaTab: 'published',
    interactionsTab: 'followers',
    interactionsCleanup: null,
};

function formatProfileCount(value) {
    const count = Math.max(0, Number(value) || 0);
    return new Intl.NumberFormat(document.documentElement.lang?.startsWith('de') ? 'de-DE' : 'en-US', {
        notation: count >= 1000 ? 'compact' : 'standard',
    }).format(count);
}

function setProfileMediaStatus(text, type = 'neutral') {
    if (!$profileMediaStatus) return;
    $profileMediaStatus.textContent = text || '';
    $profileMediaStatus.dataset.state = type;
}

function setInteractionsStatus(text, type = 'neutral') {
    if (!$profileInteractionsStatus) return;
    $profileInteractionsStatus.textContent = text || '';
    $profileInteractionsStatus.dataset.state = type;
}

function renderProfileSummary(summary = {}) {
    if ($profileFollowerCount) $profileFollowerCount.textContent = formatProfileCount(summary.follower_count);
    if ($profileFollowingCount) $profileFollowingCount.textContent = formatProfileCount(summary.following_count);
    if ($profileReceivedLikeCount) $profileReceivedLikeCount.textContent = formatProfileCount(summary.received_like_count);
    document.querySelectorAll('[data-profile-media-tab="published"]').forEach((button) => {
        button.textContent = localeText('profile.publishedTabWithCount', {
            count: formatProfileCount(summary.published_media_count),
        });
    });
    document.querySelectorAll('[data-profile-media-tab="liked"]').forEach((button) => {
        button.textContent = localeText('profile.likesTabWithCount', {
            count: formatProfileCount(summary.liked_media_count),
        });
    });
}

async function loadProfileSummary() {
    if (!$profileFollowerCount && !$profileFollowingCount && !$profileReceivedLikeCount) return;
    const result = await apiGetProfileSocialSummary();
    if (result.ok) renderProfileSummary(result.data?.data || result.data || {});
}

function getProfileMediaKind(item) {
    if (item?.media_type === 'mempics') return 'Mempic';
    if (item?.media_type === 'memvids') return 'Memvid';
    if (item?.media_type === 'memtracks') return 'Memtrack';
    return 'Media';
}

function getProfileMediaThumb(item) {
    return item?.thumb?.url || item?.poster?.url || item?.preview?.url || '';
}

function renderProfileMedia(items = []) {
    if (!$profileMediaGrid) return;
    $profileMediaGrid.replaceChildren();
    if (!items.length) {
        const empty = document.createElement('p');
        empty.className = 'profile__media-empty';
        empty.textContent = profileDashboardState.mediaTab === 'liked'
            ? localeText('profile.noLikedMedia')
            : localeText('profile.noPublishedMedia');
        $profileMediaGrid.appendChild(empty);
        return;
    }

    items.forEach((item) => {
        const card = document.createElement('article');
        card.className = `profile__media-card profile__media-card--${item.media_type || 'media'}`;

        const preview = document.createElement('div');
        preview.className = 'profile__media-preview';
        const thumb = getProfileMediaThumb(item);
        if (thumb) {
            const img = new Image();
            img.src = thumb;
            img.alt = item.title || getProfileMediaKind(item);
            img.loading = 'lazy';
            img.decoding = 'async';
            if (thumb.startsWith('/api/')) img.crossOrigin = 'use-credentials';
            preview.appendChild(img);
        } else {
            const placeholder = document.createElement('span');
            placeholder.className = 'profile__media-placeholder';
            placeholder.textContent = getProfileMediaKind(item);
            preview.appendChild(placeholder);
        }

        const body = document.createElement('div');
        body.className = 'profile__media-body';
        const title = document.createElement('h3');
        title.textContent = item.title || getProfileMediaKind(item);
        const meta = document.createElement('p');
        meta.textContent = [
            getProfileMediaKind(item),
            item.published_at ? formatDate(item.published_at) : null,
        ].filter(Boolean).join(' / ');
        const counts = document.createElement('p');
        counts.className = 'profile__media-counts';
        counts.textContent = localeText('profile.mediaCardCounts', {
            likes: formatProfileCount(item.like_count),
            comments: formatProfileCount(item.comment_count),
        });
        body.append(title, meta, counts);
        card.append(preview, body);
        $profileMediaGrid.appendChild(card);
    });
}

async function loadProfileMedia(tab = profileDashboardState.mediaTab) {
    if (!$profileMediaGrid) return;
    profileDashboardState.mediaTab = tab;
    setProfileMediaStatus(localeText('profile.loadingProfileMedia'), 'neutral');
    const result = await apiGetProfileMedia(tab === 'liked' ? 'liked' : 'published', { limit: 60 });
    if (!result.ok) {
        setProfileMediaStatus(localeText('profile.profileMediaFailed'), 'error');
        return;
    }
    renderProfileMedia(result.data?.data?.items || result.data?.items || []);
    setProfileMediaStatus('', 'neutral');
}

function setProfileMediaTab(tab) {
    const next = tab === 'liked' ? 'liked' : 'published';
    profileDashboardState.mediaTab = next;
    document.querySelectorAll('[data-profile-media-tab]').forEach((button) => {
        const isActive = button.dataset.profileMediaTab === next;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-selected', String(isActive));
    });
    void loadProfileMedia(next);
}

function createInteractionAvatar() {
    const avatar = document.createElement('span');
    avatar.className = 'profile-interactions__avatar';
    avatar.textContent = 'B';
    avatar.setAttribute('aria-hidden', 'true');
    return avatar;
}

function renderInteractionRows(items = [], tab = profileDashboardState.interactionsTab) {
    if (!$profileInteractionsList) return;
    $profileInteractionsList.replaceChildren();
    if (!items.length) {
        const empty = document.createElement('p');
        empty.className = 'profile-interactions__empty';
        empty.textContent = localeText(`profile.${tab}Empty`);
        $profileInteractionsList.appendChild(empty);
        return;
    }

    items.forEach((item) => {
        const row = document.createElement('article');
        row.className = 'profile-interactions__row';
        row.appendChild(createInteractionAvatar());
        const body = document.createElement('div');
        body.className = 'profile-interactions__body';
        const name = document.createElement('strong');
        name.textContent = item.actor?.display_name || localeText('browse.publicMember');
        const copy = document.createElement('span');
        copy.textContent = tab === 'likes'
            ? localeText('profile.likedYourMedia', { mediaType: getProfileMediaKind(item.media) })
            : (tab === 'followers' ? localeText('profile.startedFollowingYou') : localeText('profile.youFollowThem'));
        const date = document.createElement('time');
        date.dateTime = item.created_at || '';
        date.textContent = formatDate(item.created_at);
        body.append(name, copy, date);
        row.appendChild(body);
        if (item.media) {
            const thumb = getProfileMediaThumb(item.media);
            if (thumb) {
                const img = new Image();
                img.className = 'profile-interactions__thumb';
                img.src = thumb;
                img.alt = item.media.title || getProfileMediaKind(item.media);
                img.loading = 'lazy';
                img.decoding = 'async';
                row.appendChild(img);
            }
        }
        $profileInteractionsList.appendChild(row);
    });
}

async function loadInteractionList(tab = profileDashboardState.interactionsTab) {
    if (!$profileInteractionsList) return;
    profileDashboardState.interactionsTab = tab;
    setInteractionsStatus(localeText('profile.loadingInteractions'), 'neutral');
    const result = await apiGetProfileSocialList(tab, { limit: 50 });
    if (!result.ok) {
        setInteractionsStatus(localeText('profile.interactionsFailed'), 'error');
        return;
    }
    renderInteractionRows(result.data?.data?.items || result.data?.items || [], tab);
    setInteractionsStatus('', 'neutral');
}

function setInteractionTab(tab) {
    const next = ['followers', 'following', 'likes'].includes(tab) ? tab : 'followers';
    profileDashboardState.interactionsTab = next;
    document.querySelectorAll('[data-profile-interactions-panel-tab]').forEach((button) => {
        const isActive = button.dataset.profileInteractionsPanelTab === next;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-selected', String(isActive));
    });
    void loadInteractionList(next);
}

function openInteractionsOverlay(tab = 'followers') {
    if (!$profileInteractionsOverlay || !$profileInteractionsPanel) return;
    $profileInteractionsOverlay.hidden = false;
    $profileInteractionsOverlay.setAttribute('aria-hidden', 'false');
    $profileInteractionsOverlay.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    if (profileDashboardState.interactionsCleanup) profileDashboardState.interactionsCleanup();
    profileDashboardState.interactionsCleanup = setupFocusTrap($profileInteractionsPanel);
    setInteractionTab(tab);
    $profileInteractionsClose?.focus();
}

function closeInteractionsOverlay() {
    if (!$profileInteractionsOverlay) return;
    $profileInteractionsOverlay.classList.remove('is-open');
    $profileInteractionsOverlay.hidden = true;
    $profileInteractionsOverlay.setAttribute('aria-hidden', 'true');
    if (profileDashboardState.interactionsCleanup) {
        profileDashboardState.interactionsCleanup();
        profileDashboardState.interactionsCleanup = null;
    }
    syncAvatarModalBodyLock();
}

function initProfileDashboard() {
    if (!$profileMediaGrid && !$profileFollowerCount) return;
    document.querySelectorAll('[data-profile-media-tab]').forEach((button) => {
        button.addEventListener('click', () => setProfileMediaTab(button.dataset.profileMediaTab));
    });
    document.querySelectorAll('[data-profile-interactions-tab]').forEach((button) => {
        button.addEventListener('click', () => openInteractionsOverlay(button.dataset.profileInteractionsTab));
    });
    document.querySelectorAll('[data-profile-interactions-panel-tab]').forEach((button) => {
        button.addEventListener('click', () => setInteractionTab(button.dataset.profileInteractionsPanelTab));
    });
    $profileInteractionsClose?.addEventListener('click', closeInteractionsOverlay);
    $profileInteractionsOverlay?.addEventListener('click', (event) => {
        if (event.target?.hasAttribute?.('data-profile-interactions-close')) closeInteractionsOverlay();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && $profileInteractionsOverlay && !$profileInteractionsOverlay.hidden) {
            event.preventDefault();
            closeInteractionsOverlay();
        }
    });
    window.addEventListener('bitbi:public-media-interaction-change', () => {
        void loadProfileSummary();
        void loadProfileMedia(profileDashboardState.mediaTab);
    });
    void loadProfileSummary();
    void loadProfileMedia('published');
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
        showDeniedState({ sessionExpired: isAuthFailure(res) });
        return;
    }

    // Show profile content
    showState($content);
    renderProfile(res.data.profile, res.data.account);
    initProfileDashboard();
    void loadProfileCardMetadata();
    renderPostAuthHint({
        mount: document.getElementById('profileHomeView'),
        pageSource: 'profile',
        signedIn: true,
    });
    loadAvatar(false);
    refreshWalletStatus().catch(e => console.warn('walletStatus:', e));

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
            showAvatarMsg(localeText('profile.photoUpdated'), 'success');
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
    $avatarInput?.addEventListener('change', async () => {
        const file = $avatarInput.files?.[0];
        if (!file) return;

        hideAvatarMsg();

        if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
            showAvatarMsg(localeText('profile.invalidFile'), 'error');
            $avatarInput.value = '';
            return;
        }
        if (file.size > MAX_AVATAR_SIZE) {
            showAvatarMsg(localeText('profile.fileTooLarge'), 'error');
            $avatarInput.value = '';
            return;
        }

        const wasRemoveDisabled = $avatarRemoveBtn.disabled;
        setAvatarActionState(true, localeText('profile.uploading'));
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
            showAvatarMsg(localeText('profile.photoUpdated'), 'success');
            loadAvatar(true);
        } else {
            showAvatarMsg(result.error, 'error');
        }
    });

    // Avatar remove
    $avatarRemoveBtn?.addEventListener('click', async () => {
        hideAvatarMsg();
        closeAvatarSourceModal({ focusEl: $avatarChangeBtn });
        setAvatarActionState(true);
        $avatarRemoveBtn.disabled = true;
        setAvatarRemoveButtonContent(localeText('profile.removing'), localeText('profile.removingPhotoDesc'));

        const result = await apiDeleteAvatar();

        setAvatarActionState(false);
        $avatarRemoveBtn.disabled = false;
        setAvatarRemoveButtonContent();

        if (result.ok) {
            patchAuthUser({
                has_avatar: false,
                avatar_url: null,
            });
            showAvatarMsg(localeText('profile.photoRemoved'), 'success');
            loadAvatar(true);
        } else {
            showAvatarMsg(result.error, 'error');
        }
    });

    // Form submission
    $form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideMsg();
        if ($profileSaveRecovery) $profileSaveRecovery.hidden = true;

        $submitBtn.disabled = true;
        $submitBtn.textContent = localeText('profile.saving');
        updateEditState('saving');

        const currentFields = getCurrentProfileFields();
        const result = await apiUpdateProfile(currentFields);

        $submitBtn.disabled = false;
        $submitBtn.textContent = localeText('profile.saveChanges');

        if (result.ok) {
            patchAuthUser({
                display_name: currentFields.display_name,
            });
            showMsg(localeText('profile.profileUpdated'), 'success');
            savedProfileFields = { ...currentFields };
            updateEditState('saved');
            $summaryName.textContent = currentFields.display_name || '\u2014';
            if (profileCompletionContext) {
                profileCompletionContext.profile = {
                    ...profileCompletionContext.profile,
                    display_name: currentFields.display_name,
                    bio: currentFields.bio,
                    website: currentFields.website,
                };
                renderProfileCompletion(profileCompletionContext.profile, profileCompletionContext.account);
            }
        } else {
            showMsg(localeText('profile.profileSaveFailed'), 'error');
            updateEditState('error');
            if ($profileSaveRecovery) $profileSaveRecovery.hidden = false;
        }
    });

    [$displayName, $bio, $website].forEach((field) => {
        field?.addEventListener('input', () => updateEditState());
    });

    // Logout button
    $logoutBtn?.addEventListener('click', async () => {
        await apiLogout();
        window.location.href = '/';
    });
}

init();
