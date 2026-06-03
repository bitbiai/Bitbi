/* ============================================================
   BITBI — Assets Manager Page
   Entry point for account/assets-manager.html
   ============================================================ */

import { initSiteHeader }    from '../../shared/site-header.js?v=__ASSET_VERSION__';
import { initParticles }     from '../../shared/particles.js';
import { initBinaryRain }    from '../../shared/binary-rain.js';
import { initBinaryFooter }  from '../../shared/binary-footer.js';
import { initScrollReveal }  from '../../shared/scroll-reveal.js';
import { initCookieConsent } from '../../shared/cookie-consent.js';

import {
    apiAiSaveAudio,
    apiAdminAiModels,
    apiAdminAiTestImage,
    apiAdminHomepageHeroVideos,
    apiAdminOrganizationBilling,
    apiAdminOrganizations,
    apiGetMe,
    createAdminIdempotencyKey,
} from '../../shared/auth-api.js?v=__ASSET_VERSION__';
import {
    calculateAiImageCreditCost,
    FLUX_1_SCHNELL_IMAGE_MODEL_ID,
    isPricedAiImageModel,
} from '../../shared/ai-model-pricing.mjs?v=__ASSET_VERSION__';
import { createSavedAssetsBrowser } from '../../shared/saved-assets-browser.js?v=__ASSET_VERSION__';
import { localizedHref, localeText } from '../../shared/locale.js?v=__ASSET_VERSION__';
import { renderPostAuthHint } from '../../shared/auth-post-auth-hint.js?v=__ASSET_VERSION__';
import { createManualHeroVideoUploadController } from '../admin/manual-hero-video-upload.js?v=__ASSET_VERSION__';
import {
    clearActiveOrganizationId,
    resolveActiveOrganizationId,
    setActiveOrganizationId,
} from '../../shared/active-organization.js?v=__ASSET_VERSION__';

const $loading = document.getElementById('loadingState');
const $denied  = document.getElementById('deniedState');
const $content = document.getElementById('studioContent');

let savedAssetsBrowser = null;
let adminUploadController = null;
let adminUploadEnabled = false;
let adminUploadLastTrigger = null;
let adminUploadStatusAbort = null;
let adminMusicCatalogAbort = null;
let adminMusicOrganizationLoadSeq = 0;

const MUSIC_UPLOAD_DEFAULT_MODEL_ID = FLUX_1_SCHNELL_IMAGE_MODEL_ID;
const MUSIC_UPLOAD_ALLOWED_MIME_TYPES = new Set(['audio/mpeg', 'audio/mp3', 'audio/x-mpeg']);
const MUSIC_UPLOAD_TITLE_MAX_LENGTH = 120;
const MUSIC_UPLOAD_PROMPT_MAX_LENGTH = 1000;

const adminMusicUploadState = {
    busy: false,
    catalogStatus: 'idle',
    catalogError: '',
    models: [],
    selectedModel: '',
    file: null,
    organizationStatus: 'idle',
    billingStatus: 'idle',
    organizationError: '',
    organizations: [],
    selectedOrganizationId: '',
    selectedOrganizationBalance: null,
};

const isGermanPage = document.documentElement.lang?.toLowerCase().startsWith('de');
const adminUploadCopy = isGermanPage
    ? {
        ready: 'Bereit zum Hochladen.',
        checking: 'Status der manuellen Uploads wird geprüft...',
        enabled: 'Manuelle Uploads sind aktiviert.',
        disabled: 'Manuelle Uploads sind derzeit deaktiviert.',
        statusFailed: 'Der Status manueller Uploads konnte nicht geladen werden.',
        success: 'Video-Asset hochgeladen. Die Asset-Liste wurde aktualisiert.',
        successToast: 'Video-Asset hochgeladen.',
        uploadStatus: 'Privates Video-Asset wird hochgeladen...',
        error: 'Video-Upload fehlgeschlagen.',
        reasonError: 'Geben Sie vor dem Upload einen Operator-Grund ein.',
        disabledMessage: 'Manuelle Uploads sind durch den Admin-Schalter oder Worker deaktiviert.',
        title: 'Manual source upload',
        description: 'Uploads create private admin source assets only. Public playback still requires an optimized derivative.',
        chooserTitle: 'Asset hochladen',
        musicReady: 'Wähle eine MP3 und einen Cover-Prompt.',
        musicCatalogLoading: 'Admin-AI-Bildmodelle werden geladen...',
        musicCatalogReady: 'Bildmodell-Katalog geladen.',
        musicCatalogFailed: 'Der Bildmodell-Katalog konnte nicht geladen werden.',
        musicNoModels: 'Für diesen Upload sind keine kompatiblen Admin-AI-Bildmodelle verfügbar.',
        musicCatalogHelp: 'Kostenpflichtige Bildmodelle nutzen die ausgewählten Organisations-Credits.',
        musicOrganizationLoading: 'Organisationen für kostenpflichtige Cover-Generierung werden geladen...',
        musicOrganizationSelect: 'Wähle eine Organisation für dieses kostenpflichtige Cover.',
        musicOrganizationUnavailable: 'Für dieses Bildmodell ist kein Organisationsabrechnungskontext verfügbar.',
        musicOrganizationNoCharge: 'Für dieses Bildmodell fällt keine Admin-Image-Credit-Abrechnung an.',
        musicOrganizationBillingLoading: 'Organisationsguthaben wird geladen...',
        musicOrganizationBillingFailed: 'Organisationsabrechnung konnte nicht geladen werden.',
        musicOrganizationInsufficient: 'Nicht genügend Organisations-Credits für diese Cover-Generierung.',
        musicUploadStatus: 'Cover wird generiert und MP3 gespeichert...',
        musicSuccess: 'Musik-Asset hochgeladen. Assets Manager aktualisiert.',
        musicError: 'Musik-Upload fehlgeschlagen.',
        musicTitleError: 'Gib vor dem Upload einen Titel ein.',
        musicFileError: 'Wähle vor dem Upload eine MP3-Datei aus.',
        musicPromptError: 'Gib vor dem Upload einen Cover-Prompt ein.',
        musicModelError: 'Wähle ein verfügbares Admin-AI-Bildmodell.',
        musicOrganizationError: 'Wähle eine Organisation mit genügend Credits für dieses kostenpflichtige Bildmodell.',
        musicFileTypeError: 'Wähle eine MP3-Audiodatei aus.',
        musicCoverError: 'Cover-Generierung fehlgeschlagen.',
        musicSaveError: 'Audio-Speicherung fehlgeschlagen.',
    }
    : {
        ready: 'Ready to upload.',
        checking: 'Checking manual upload availability...',
        enabled: 'Manual uploads are enabled.',
        disabled: 'Manual uploads are currently disabled.',
        statusFailed: 'Manual upload status could not be loaded.',
        success: 'Video asset uploaded. Assets Manager refreshed.',
        successToast: 'Video asset uploaded.',
        uploadStatus: 'Uploading private video asset...',
        error: 'Video upload failed.',
        reasonError: 'Enter an operator reason before uploading.',
        disabledMessage: 'Manual uploads are disabled by the Admin switch or Worker hard-disable.',
        title: 'Manual source upload',
        description: 'Uploads create private admin source assets only. Public playback still requires an optimized derivative.',
        chooserTitle: 'Upload asset',
        musicReady: 'Choose an MP3 and cover prompt.',
        musicCatalogLoading: 'Loading Admin AI image models...',
        musicCatalogReady: 'Image model catalog loaded.',
        musicCatalogFailed: 'Image model catalog could not be loaded.',
        musicNoModels: 'No compatible Admin AI image models are available for this upload.',
        musicCatalogHelp: 'Charged image models use the selected organization credits.',
        musicOrganizationLoading: 'Loading organizations for charged cover generation...',
        musicOrganizationSelect: 'Select an organization for this charged cover.',
        musicOrganizationUnavailable: 'No organization billing context is available for this image model.',
        musicOrganizationNoCharge: 'No admin image credit charge for this image model.',
        musicOrganizationBillingLoading: 'Loading organization credit balance...',
        musicOrganizationBillingFailed: 'Organization billing could not be loaded.',
        musicOrganizationInsufficient: 'Insufficient organization credits for this cover generation.',
        musicUploadStatus: 'Generating cover and saving MP3...',
        musicSuccess: 'Music asset uploaded. Assets Manager refreshed.',
        musicError: 'Music upload failed.',
        musicTitleError: 'Enter a title before uploading.',
        musicFileError: 'Choose an MP3 file before uploading.',
        musicPromptError: 'Enter a cover prompt before uploading.',
        musicModelError: 'Choose an available Admin AI image model.',
        musicOrganizationError: 'Choose an organization with enough credits for this charged image model.',
        musicFileTypeError: 'Choose an MP3 audio file.',
        musicCoverError: 'Cover image generation failed.',
        musicSaveError: 'Audio save failed.',
    };

function hasGenerateLabHandoff() {
    try {
        const url = new URL(window.location.href);
        const params = url.searchParams;
        return params.get('source') === 'generate-lab'
            || params.get('recent') === '1'
            || url.hash === '#generate-lab-recent';
    } catch {
        return false;
    }
}

function clearGenerateLabHandoffQuery() {
    try {
        const url = new URL(window.location.href);
        url.searchParams.delete('source');
        url.searchParams.delete('recent');
        if (url.hash === '#generate-lab-recent') url.hash = '';
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    } catch {
        // Query cleanup is only a UI convenience; keep the banner dismissible if history is unavailable.
    }
}

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
        const title = document.getElementById('assetsDeniedTitle');
        const copy = $denied.querySelector('.studio-denied__text');
        const primary = $denied.querySelector('[data-auth-entry="login"]');
        $denied.setAttribute('role', 'status');
        $denied.setAttribute('aria-live', 'polite');
        if (title) title.textContent = localeText('authRecovery.sessionExpiredTitle');
        if (copy) copy.textContent = localeText('authRecovery.sessionExpiredAssetsCopy');
        if (primary) primary.textContent = localeText('authRecovery.sessionSignInAgain');
    }
    showState($denied);
    $denied.classList.add('visible');
}

function isAdminUser(user) {
    return String(user?.role || '').toLowerCase() === 'admin';
}

function setAdminUploadStatus(message, state = '') {
    const status = document.getElementById('studioAdminUploadVideoStatus');
    if (!status) return;
    status.textContent = message || '';
    if (state) status.dataset.state = state;
    else delete status.dataset.state;
}

function formatApiError(res, fallback) {
    return res?.data?.error || res?.error || fallback;
}

function setModalVisibility(modal, visible) {
    if (!modal) return;
    modal.hidden = !visible;
    modal.setAttribute('aria-hidden', visible ? 'false' : 'true');
}

function getImageCatalogModels(catalog) {
    const source = catalog?.data && typeof catalog.data === 'object' ? catalog.data : catalog;
    return Array.isArray(source?.models?.image) ? source.models.image : [];
}

function normalizeAdminOrgRows(data) {
    const rows = Array.isArray(data?.organizations)
        ? data.organizations
        : Array.isArray(data?.orgs)
            ? data.orgs
            : Array.isArray(data?.items)
                ? data.items
                : [];
    return rows
        .map((org) => ({
            id: String(org?.id || org?.organizationId || '').trim(),
            name: String(org?.name || org?.slug || org?.id || '').trim(),
        }))
        .filter((org) => /^org_[a-f0-9]{32}$/.test(org.id));
}

function extractCreditBalance(data) {
    const candidates = [
        data?.billing?.creditBalance,
        data?.creditBalance,
        data?.state?.creditBalance,
        data?.organization?.creditBalance,
    ];
    for (const value of candidates) {
        const number = Number(value);
        if (Number.isFinite(number)) return number;
    }
    return null;
}

function getSelectedMusicModelId() {
    const { model } = getMusicUploadElements();
    return String(model?.value || adminMusicUploadState.selectedModel || '').trim();
}

function getSelectedMusicModelInfo(modelId = getSelectedMusicModelId()) {
    return adminMusicUploadState.models.find((entry) => entry?.id === modelId) || null;
}

function isMusicUploadModelKnown(modelId) {
    return !!modelId && !!getSelectedMusicModelInfo(modelId);
}

function isSelectedMusicModelChargeable(modelId = getSelectedMusicModelId()) {
    return isPricedAiImageModel(modelId);
}

function getSelectedMusicCreditCost(modelId = getSelectedMusicModelId()) {
    try {
        return calculateAiImageCreditCost(modelId, {})?.credits || null;
    } catch {
        return null;
    }
}

function getSelectedMusicOrganization() {
    const selectedOrgId = adminMusicUploadState.selectedOrganizationId || '';
    return adminMusicUploadState.organizations.find((org) => org.id === selectedOrgId) || null;
}

function getSelectedMusicBillingBlocker(modelId = getSelectedMusicModelId()) {
    if (!isMusicUploadModelKnown(modelId)) return adminUploadCopy.musicModelError;
    if (!isSelectedMusicModelChargeable(modelId)) return '';
    if (adminMusicUploadState.organizationStatus === 'loading') return adminUploadCopy.musicOrganizationLoading;
    if (adminMusicUploadState.organizationStatus === 'error') {
        return adminMusicUploadState.organizationError || adminUploadCopy.musicOrganizationUnavailable;
    }
    if (!adminMusicUploadState.selectedOrganizationId) return adminUploadCopy.musicOrganizationSelect;
    if (adminMusicUploadState.billingStatus === 'loading') return adminUploadCopy.musicOrganizationBillingLoading;
    if (adminMusicUploadState.billingStatus === 'error') {
        return adminMusicUploadState.organizationError || adminUploadCopy.musicOrganizationBillingFailed;
    }
    const credits = getSelectedMusicCreditCost(modelId);
    const balance = adminMusicUploadState.selectedOrganizationBalance;
    if (credits && adminMusicUploadState.billingStatus !== 'ready') return adminUploadCopy.musicOrganizationBillingLoading;
    if (credits && typeof balance === 'number' && balance < credits) {
        return adminUploadCopy.musicOrganizationInsufficient;
    }
    if (credits && typeof balance !== 'number') return adminUploadCopy.musicOrganizationBillingFailed;
    return '';
}

function getMusicUploadElements() {
    return {
        modal: document.getElementById('studioAdminUploadMusicModal'),
        title: document.getElementById('studioAdminUploadMusicTitle'),
        titleInput: document.getElementById('studioAdminUploadMusicTitleInput'),
        fileInput: document.getElementById('studioAdminUploadMusicFile'),
        prompt: document.getElementById('studioAdminUploadMusicPrompt'),
        model: document.getElementById('studioAdminUploadMusicModel'),
        modelHelp: document.getElementById('studioAdminUploadMusicModelHelp'),
        organizationField: document.getElementById('studioAdminUploadMusicOrganizationField'),
        organization: document.getElementById('studioAdminUploadMusicOrganization'),
        organizationState: document.getElementById('studioAdminUploadMusicOrganizationState'),
        submit: document.getElementById('studioAdminUploadMusicSubmit'),
        status: document.getElementById('studioAdminUploadMusicStatus'),
    };
}

function setAdminMusicUploadStatus(message, state = '') {
    const { status } = getMusicUploadElements();
    if (!status) return;
    status.textContent = message || '';
    if (state) status.dataset.state = state;
    else delete status.dataset.state;
}

function titleFromUploadFileName(fileName) {
    const baseName = String(fileName || '')
        .replace(/\\/g, '/')
        .split('/')
        .pop()
        .replace(/\.[^.]+$/, '')
        .trim();
    return baseName.slice(0, MUSIC_UPLOAD_TITLE_MAX_LENGTH);
}

function isMp3UploadFile(file) {
    if (!file) return false;
    const type = String(file.type || '').split(';')[0].trim().toLowerCase();
    const hasMp3Extension = String(file.name || '').toLowerCase().endsWith('.mp3');
    if (type && !MUSIC_UPLOAD_ALLOWED_MIME_TYPES.has(type)) return false;
    return hasMp3Extension || MUSIC_UPLOAD_ALLOWED_MIME_TYPES.has(type);
}

async function readFileAsBase64(file) {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
}

function extractGeneratedCoverImage(responseData) {
    const result = responseData?.result || responseData?.data?.result || responseData?.data || responseData;
    const imageBase64 = typeof result?.imageBase64 === 'string'
        ? result.imageBase64
        : (typeof result?.image_base64 === 'string' ? result.image_base64 : '');
    if (!imageBase64) return null;
    return {
        imageBase64,
        mimeType: typeof result?.mimeType === 'string'
            ? result.mimeType
            : (typeof result?.mime_type === 'string' ? result.mime_type : 'image/png'),
    };
}

function selectDefaultMusicUploadModel(models) {
    const defaultModel = models.find((model) => model?.id === MUSIC_UPLOAD_DEFAULT_MODEL_ID);
    if (defaultModel?.id) return defaultModel.id;
    const firstUnpriced = models.find((model) => model?.id && !isPricedAiImageModel(model.id));
    if (firstUnpriced?.id) return firstUnpriced.id;
    return models[0]?.id || '';
}

function populateAdminMusicOrganizationSelect() {
    const { organization } = getMusicUploadElements();
    if (!organization) return;
    const current = adminMusicUploadState.selectedOrganizationId || '';
    organization.replaceChildren();
    if (adminMusicUploadState.organizationStatus === 'loading') {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = adminUploadCopy.musicOrganizationLoading;
        organization.appendChild(option);
        organization.value = '';
        return;
    }
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = adminUploadCopy.musicOrganizationSelect;
    organization.appendChild(placeholder);
    for (const org of adminMusicUploadState.organizations) {
        organization.append(new Option(org.name || org.id, org.id));
    }
    if (current && adminMusicUploadState.organizations.some((org) => org.id === current)) {
        organization.value = current;
    } else {
        organization.value = '';
    }
}

function syncAdminMusicBillingUi() {
    const { organizationField, organization, organizationState } = getMusicUploadElements();
    const selectedModel = getSelectedMusicModelId();
    const isChargeable = isSelectedMusicModelChargeable(selectedModel);
    const busy = adminMusicUploadState.busy;
    const credits = getSelectedMusicCreditCost(selectedModel);
    const selectedOrg = getSelectedMusicOrganization();

    if (organizationField) organizationField.hidden = !isChargeable && adminMusicUploadState.organizationStatus !== 'loading';
    if (organization) {
        organization.disabled = busy
            || !isChargeable
            || adminMusicUploadState.organizationStatus === 'loading'
            || !adminMusicUploadState.organizations.length;
    }
    if (!organizationState) return;

    if (adminMusicUploadState.organizationStatus === 'loading') {
        organizationState.textContent = adminUploadCopy.musicOrganizationLoading;
        return;
    }
    if (!isChargeable) {
        organizationState.textContent = adminUploadCopy.musicOrganizationNoCharge;
        return;
    }
    if (adminMusicUploadState.organizationStatus === 'error') {
        organizationState.textContent = adminMusicUploadState.organizationError || adminUploadCopy.musicOrganizationUnavailable;
        return;
    }
    if (!adminMusicUploadState.selectedOrganizationId) {
        organizationState.textContent = adminUploadCopy.musicOrganizationSelect;
        return;
    }
    if (adminMusicUploadState.billingStatus === 'loading') {
        organizationState.textContent = adminUploadCopy.musicOrganizationBillingLoading;
        return;
    }
    if (adminMusicUploadState.billingStatus === 'error') {
        organizationState.textContent = adminMusicUploadState.organizationError || adminUploadCopy.musicOrganizationBillingFailed;
        return;
    }
    if (credits && adminMusicUploadState.billingStatus !== 'ready') {
        organizationState.textContent = adminUploadCopy.musicOrganizationBillingLoading;
        return;
    }

    const prefix = selectedOrg?.name
        ? `Selected organization: ${selectedOrg.name}. `
        : `Selected organization: ${adminMusicUploadState.selectedOrganizationId}. `;
    const balance = adminMusicUploadState.selectedOrganizationBalance;
    if (credits && typeof balance === 'number') {
        organizationState.textContent = balance >= credits
            ? `${prefix}Balance: ${balance} credits. Estimated cover cost: ${credits} credit${credits === 1 ? '' : 's'}.`
            : `${prefix}Insufficient credits: balance ${balance}; estimated cover cost ${credits}.`;
        return;
    }
    if (credits) {
        organizationState.textContent = `${prefix}Estimated cover cost: ${credits} credit${credits === 1 ? '' : 's'}. The server verifies final billing after provider success.`;
        return;
    }
    organizationState.textContent = `${prefix}This charged cover uses organization credits. The server verifies final billing after provider success.`;
}

function renderAdminMusicModelOptions() {
    const { model, modelHelp } = getMusicUploadElements();
    if (!model) return;
    model.replaceChildren();

    if (adminMusicUploadState.catalogStatus === 'loading') {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = adminUploadCopy.musicCatalogLoading;
        model.appendChild(option);
        model.value = '';
        model.disabled = true;
        if (modelHelp) modelHelp.textContent = adminUploadCopy.musicCatalogLoading;
        return;
    }

    if (!adminMusicUploadState.models.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = adminUploadCopy.musicNoModels;
        model.appendChild(option);
        model.value = '';
        model.disabled = true;
        if (modelHelp) modelHelp.textContent = adminMusicUploadState.catalogError || adminUploadCopy.musicNoModels;
        return;
    }

    for (const entry of adminMusicUploadState.models) {
        const option = document.createElement('option');
        option.value = entry.id;
        option.textContent = `${entry.label || entry.name || entry.id} (${entry.id})${isPricedAiImageModel(entry.id) ? ' · organization credits' : ''}`;
        model.appendChild(option);
    }

    const selected = adminMusicUploadState.selectedModel || selectDefaultMusicUploadModel(adminMusicUploadState.models);
    adminMusicUploadState.selectedModel = selected;
    model.disabled = adminMusicUploadState.busy;
    if (selected) model.value = selected;
    if (modelHelp) {
        modelHelp.textContent = adminMusicUploadState.models.some((entry) => isPricedAiImageModel(entry.id))
            ? adminUploadCopy.musicCatalogHelp
            : adminUploadCopy.musicCatalogReady;
    }
    syncAdminMusicBillingUi();
}

function syncAdminMusicUploadUi() {
    const { titleInput, fileInput, prompt, model, submit } = getMusicUploadElements();
    const busy = adminMusicUploadState.busy;
    const title = String(titleInput?.value || '').trim();
    const coverPrompt = String(prompt?.value || '').trim();
    const selectedModel = String(model?.value || adminMusicUploadState.selectedModel || '').trim();
    const billingBlocker = getSelectedMusicBillingBlocker(selectedModel);
    const canSubmit = !busy
        && !!title
        && !!adminMusicUploadState.file
        && !!coverPrompt
        && !billingBlocker;

    if (titleInput) titleInput.disabled = busy;
    if (fileInput) fileInput.disabled = busy;
    if (prompt) prompt.disabled = busy;
    if (model) model.disabled = busy || !adminMusicUploadState.models.length;
    syncAdminMusicBillingUi();
    if (submit) submit.disabled = !canSubmit;
}

function resetAdminMusicUploadForm() {
    const { titleInput, fileInput, prompt, model } = getMusicUploadElements();
    adminMusicUploadState.busy = false;
    adminMusicUploadState.file = null;
    if (titleInput) titleInput.value = '';
    if (fileInput) fileInput.value = '';
    if (prompt) prompt.value = '';
    adminMusicUploadState.selectedModel = selectDefaultMusicUploadModel(adminMusicUploadState.models);
    renderAdminMusicModelOptions();
    populateAdminMusicOrganizationSelect();
    if (model && adminMusicUploadState.selectedModel) model.value = adminMusicUploadState.selectedModel;
    setAdminMusicUploadStatus(adminUploadCopy.musicReady);
    syncAdminMusicUploadUi();
}

async function loadAdminMusicImageModels() {
    if (adminMusicCatalogAbort) adminMusicCatalogAbort.abort();
    adminMusicCatalogAbort = new AbortController();
    adminMusicUploadState.catalogStatus = 'loading';
    adminMusicUploadState.catalogError = '';
    renderAdminMusicModelOptions();
    syncAdminMusicUploadUi();
    setAdminMusicUploadStatus(adminUploadCopy.musicCatalogLoading);

    try {
        const res = await apiAdminAiModels({ signal: adminMusicCatalogAbort.signal });
        if (!res.ok) {
            adminMusicUploadState.catalogStatus = 'error';
            adminMusicUploadState.models = [];
            adminMusicUploadState.selectedModel = '';
            adminMusicUploadState.catalogError = formatApiError(res, adminUploadCopy.musicCatalogFailed);
            renderAdminMusicModelOptions();
            setAdminMusicUploadStatus(adminMusicUploadState.catalogError, 'error');
            syncAdminMusicUploadUi();
            return;
        }
        const models = getImageCatalogModels(res.data).filter((entry) => entry?.id);
        adminMusicUploadState.catalogStatus = 'ready';
        adminMusicUploadState.models = models;
        adminMusicUploadState.selectedModel = selectDefaultMusicUploadModel(models);
        adminMusicUploadState.catalogError = '';
        renderAdminMusicModelOptions();
        setAdminMusicUploadStatus(models.length ? adminUploadCopy.musicReady : adminUploadCopy.musicNoModels, models.length ? '' : 'warning');
        syncAdminMusicUploadUi();
    } catch (error) {
        if (error?.name === 'AbortError') return;
        console.warn('Assets Manager music upload catalog load failed:', error);
        adminMusicUploadState.catalogStatus = 'error';
        adminMusicUploadState.models = [];
        adminMusicUploadState.selectedModel = '';
        adminMusicUploadState.catalogError = adminUploadCopy.musicCatalogFailed;
        renderAdminMusicModelOptions();
        setAdminMusicUploadStatus(adminUploadCopy.musicCatalogFailed, 'error');
        syncAdminMusicUploadUi();
    }
}

async function loadSelectedAdminMusicOrganizationBilling() {
    const orgId = adminMusicUploadState.selectedOrganizationId || '';
    adminMusicUploadState.selectedOrganizationBalance = null;
    if (!orgId) {
        adminMusicUploadState.billingStatus = 'idle';
        syncAdminMusicUploadUi();
        return;
    }
    adminMusicUploadState.billingStatus = 'loading';
    adminMusicUploadState.organizationError = '';
    syncAdminMusicUploadUi();
    const res = await apiAdminOrganizationBilling(orgId);
    if (!res.ok) {
        adminMusicUploadState.billingStatus = 'error';
        adminMusicUploadState.selectedOrganizationBalance = null;
        adminMusicUploadState.organizationError = formatApiError(res, adminUploadCopy.musicOrganizationBillingFailed);
        syncAdminMusicUploadUi();
        return;
    }
    adminMusicUploadState.billingStatus = 'ready';
    adminMusicUploadState.organizationError = '';
    adminMusicUploadState.selectedOrganizationBalance = extractCreditBalance(res.data);
    syncAdminMusicUploadUi();
}

async function loadAdminMusicOrganizations() {
    const seq = ++adminMusicOrganizationLoadSeq;
    adminMusicUploadState.organizationStatus = 'loading';
    adminMusicUploadState.billingStatus = 'idle';
    adminMusicUploadState.organizationError = '';
    adminMusicUploadState.organizations = [];
    adminMusicUploadState.selectedOrganizationId = '';
    adminMusicUploadState.selectedOrganizationBalance = null;
    populateAdminMusicOrganizationSelect();
    syncAdminMusicUploadUi();

    const res = await apiAdminOrganizations({ limit: 100 });
    if (seq !== adminMusicOrganizationLoadSeq) return;
    if (!res.ok) {
        adminMusicUploadState.organizationStatus = 'error';
        adminMusicUploadState.organizationError = formatApiError(res, adminUploadCopy.musicOrganizationUnavailable);
        adminMusicUploadState.organizations = [];
        populateAdminMusicOrganizationSelect();
        syncAdminMusicUploadUi();
        return;
    }

    adminMusicUploadState.organizations = normalizeAdminOrgRows(res.data);
    adminMusicUploadState.organizationStatus = adminMusicUploadState.organizations.length ? 'ready' : 'error';
    if (!adminMusicUploadState.organizations.length) {
        adminMusicUploadState.organizationError = adminUploadCopy.musicOrganizationUnavailable;
    }
    const activeOrganizationId = resolveActiveOrganizationId(adminMusicUploadState.organizations);
    adminMusicUploadState.selectedOrganizationId = adminMusicUploadState.organizations.some((org) => org.id === activeOrganizationId)
        ? activeOrganizationId
        : '';
    populateAdminMusicOrganizationSelect();
    syncAdminMusicUploadUi();
    if (adminMusicUploadState.selectedOrganizationId) {
        await loadSelectedAdminMusicOrganizationBilling();
    }
}

function closeAdminUploadChooser({ restoreFocus = true } = {}) {
    const modal = document.getElementById('studioAdminUploadChooserModal');
    if (!modal || modal.hidden) return;
    setModalVisibility(modal, false);
    if (restoreFocus) {
        adminUploadLastTrigger?.focus?.({ preventScroll: true });
        adminUploadLastTrigger = null;
    }
}

function openAdminUploadChooser(trigger = null) {
    const modal = document.getElementById('studioAdminUploadChooserModal');
    const title = document.getElementById('studioAdminUploadChooserTitle');
    if (!modal) return;
    adminUploadLastTrigger = trigger instanceof HTMLElement ? trigger : document.getElementById('studioAdminUploadVideoBtn');
    setModalVisibility(modal, true);
    window.requestAnimationFrame(() => {
        title?.focus?.({ preventScroll: true });
    });
}

function closeAdminMusicUploadModal({ restoreFocus = true } = {}) {
    const { modal } = getMusicUploadElements();
    if (!modal || modal.hidden) return;
    adminMusicCatalogAbort?.abort();
    adminMusicCatalogAbort = null;
    adminMusicOrganizationLoadSeq += 1;
    setModalVisibility(modal, false);
    resetAdminMusicUploadForm();
    if (restoreFocus) {
        adminUploadLastTrigger?.focus?.({ preventScroll: true });
        adminUploadLastTrigger = null;
    }
}

function openAdminMusicUploadModal(trigger = null) {
    const { modal, title } = getMusicUploadElements();
    if (!modal) return;
    closeAdminUploadChooser({ restoreFocus: false });
    adminUploadLastTrigger = trigger instanceof HTMLElement ? trigger : (adminUploadLastTrigger || document.getElementById('studioAdminUploadVideoBtn'));
    resetAdminMusicUploadForm();
    setModalVisibility(modal, true);
    window.requestAnimationFrame(() => {
        title?.focus?.({ preventScroll: true });
    });
    loadAdminMusicImageModels().catch((error) => {
        console.warn('Assets Manager music upload catalog load failed:', error);
    });
    loadAdminMusicOrganizations().catch((error) => {
        console.warn('Assets Manager music upload organization load failed:', error);
        adminMusicUploadState.organizationStatus = 'error';
        adminMusicUploadState.organizationError = adminUploadCopy.musicOrganizationUnavailable;
        populateAdminMusicOrganizationSelect();
        syncAdminMusicUploadUi();
    });
}

async function handleAdminMusicUpload() {
    const { titleInput, fileInput, prompt, model } = getMusicUploadElements();
    if (adminMusicUploadState.busy) return;

    const title = String(titleInput?.value || '').trim().slice(0, MUSIC_UPLOAD_TITLE_MAX_LENGTH);
    const coverPrompt = String(prompt?.value || '').trim().slice(0, MUSIC_UPLOAD_PROMPT_MAX_LENGTH);
    const selectedModel = String(model?.value || adminMusicUploadState.selectedModel || '').trim();
    const file = adminMusicUploadState.file || fileInput?.files?.[0] || null;

    if (!title) {
        setAdminMusicUploadStatus(adminUploadCopy.musicTitleError, 'error');
        syncAdminMusicUploadUi();
        return;
    }
    if (!file) {
        setAdminMusicUploadStatus(adminUploadCopy.musicFileError, 'error');
        syncAdminMusicUploadUi();
        return;
    }
    if (!isMp3UploadFile(file)) {
        setAdminMusicUploadStatus(adminUploadCopy.musicFileTypeError, 'error');
        syncAdminMusicUploadUi();
        return;
    }
    if (!coverPrompt) {
        setAdminMusicUploadStatus(adminUploadCopy.musicPromptError, 'error');
        syncAdminMusicUploadUi();
        return;
    }
    const billingBlocker = getSelectedMusicBillingBlocker(selectedModel);
    if (billingBlocker) {
        setAdminMusicUploadStatus(billingBlocker, 'error');
        syncAdminMusicUploadUi();
        return;
    }

    adminMusicUploadState.busy = true;
    setAdminMusicUploadStatus(adminUploadCopy.musicUploadStatus, 'loading');
    syncAdminMusicUploadUi();

    try {
        const coverPayload = {
            prompt: coverPrompt,
            model: selectedModel,
        };
        if (isSelectedMusicModelChargeable(selectedModel)) {
            coverPayload.organization_id = adminMusicUploadState.selectedOrganizationId;
        }
        const coverRes = await apiAdminAiTestImage(coverPayload, {
            headers: {
                'Idempotency-Key': createAdminIdempotencyKey('admin-assets-music-cover'),
            },
        });
        if (!coverRes.ok) {
            setAdminMusicUploadStatus(formatApiError(coverRes, adminUploadCopy.musicCoverError), 'error');
            return;
        }
        if (typeof coverRes.data?.billing?.balance_after === 'number') {
            adminMusicUploadState.selectedOrganizationBalance = coverRes.data.billing.balance_after;
            adminMusicUploadState.billingStatus = 'ready';
            syncAdminMusicUploadUi();
        }
        const cover = extractGeneratedCoverImage(coverRes.data);
        if (!cover) {
            setAdminMusicUploadStatus(adminUploadCopy.musicCoverError, 'error');
            return;
        }

        const audioBase64 = await readFileAsBase64(file);
        const saveRes = await apiAiSaveAudio({
            title,
            audioBase64,
            mimeType: 'audio/mpeg',
            sizeBytes: file.size,
            prompt: coverPrompt,
            model: selectedModel,
            mode: 'admin_assets_manager_upload',
            source: 'admin_assets_manager_upload',
            coverImageBase64: cover.imageBase64,
            coverMimeType: cover.mimeType,
            coverPrompt,
            coverModel: selectedModel,
            receivedAt: new Date().toISOString(),
        });
        if (!saveRes.ok) {
            setAdminMusicUploadStatus(formatApiError(saveRes, adminUploadCopy.musicSaveError), 'error');
            return;
        }

        if (savedAssetsBrowser) {
            await savedAssetsBrowser.openAllAssets();
        }
        if (saveRes.data?.cover_warning) {
            setAdminMusicUploadStatus(`${adminUploadCopy.musicSuccess} ${saveRes.data.cover_warning}`, 'warning');
            return;
        }
        setAdminMusicUploadStatus(adminUploadCopy.musicSuccess, 'success');
        window.setTimeout(() => closeAdminMusicUploadModal(), 0);
    } catch (error) {
        console.warn('Assets Manager music upload failed:', error);
        setAdminMusicUploadStatus(adminUploadCopy.musicError, 'error');
    } finally {
        adminMusicUploadState.busy = false;
        syncAdminMusicUploadUi();
    }
}

function adminManualUploadsEnabledFromPayload(payload = {}) {
    if (typeof payload.manual_uploads_enabled === 'boolean') return payload.manual_uploads_enabled;
    const feature = payload.feature_status?.features?.homepage_hero_manual_uploads;
    if (typeof feature?.effective_enabled === 'boolean') return feature.effective_enabled;
    return false;
}

function renderAdminUploadForm() {
    const mount = document.getElementById('studioAdminUploadVideoForm');
    if (!mount || !adminUploadController) return;
    mount.replaceChildren(adminUploadController.renderPanel());
}

async function refreshAdminUploadAvailability() {
    if (adminUploadStatusAbort) {
        adminUploadStatusAbort.abort();
    }
    adminUploadStatusAbort = new AbortController();
    adminUploadEnabled = false;
    setAdminUploadStatus(adminUploadCopy.checking);
    renderAdminUploadForm();
    try {
        const res = await apiAdminHomepageHeroVideos({ signal: adminUploadStatusAbort.signal });
        if (!res.ok) {
            adminUploadEnabled = false;
            setAdminUploadStatus(formatApiError(res, adminUploadCopy.statusFailed), 'error');
            renderAdminUploadForm();
            return;
        }
        adminUploadEnabled = adminManualUploadsEnabledFromPayload(res.data?.data || res.data || {});
        setAdminUploadStatus(
            adminUploadEnabled ? adminUploadCopy.enabled : adminUploadCopy.disabled,
            adminUploadEnabled ? '' : 'warning',
        );
        renderAdminUploadForm();
    } catch (error) {
        if (error?.name === 'AbortError') return;
        console.warn('Assets Manager manual upload status failed:', error);
        adminUploadEnabled = false;
        setAdminUploadStatus(adminUploadCopy.statusFailed, 'error');
        renderAdminUploadForm();
    }
}

function closeAdminUploadModal() {
    const modal = document.getElementById('studioAdminUploadVideoModal');
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    adminUploadStatusAbort?.abort();
    adminUploadStatusAbort = null;
    adminUploadController?.reset();
    renderAdminUploadForm();
    const reason = document.getElementById('studioAdminUploadVideoReason');
    if (reason) reason.value = '';
    setAdminUploadStatus(adminUploadCopy.ready);
    adminUploadLastTrigger?.focus?.({ preventScroll: true });
    adminUploadLastTrigger = null;
}

function openAdminUploadModal(trigger = null) {
    const modal = document.getElementById('studioAdminUploadVideoModal');
    const title = document.getElementById('studioAdminUploadVideoTitle');
    const reason = document.getElementById('studioAdminUploadVideoReason');
    if (!modal || !adminUploadController) return;
    closeAdminUploadChooser({ restoreFocus: false });
    adminUploadLastTrigger = trigger instanceof HTMLElement ? trigger : document.getElementById('studioAdminUploadVideoBtn');
    adminUploadController.reset();
    if (reason) reason.value = '';
    setAdminUploadStatus(adminUploadCopy.checking);
    renderAdminUploadForm();
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    window.requestAnimationFrame(() => {
        title?.focus?.({ preventScroll: true });
    });
    refreshAdminUploadAvailability().catch((error) => {
        console.warn('Assets Manager manual upload status failed:', error);
    });
}

function setupAdminVideoUpload({ enabled = false } = {}) {
    const desktopBtn = document.getElementById('studioAdminUploadVideoBtn');
    const mobileBtn = document.getElementById('studioAdminUploadVideoMobileBtn');
    const chooserModal = document.getElementById('studioAdminUploadChooserModal');
    const modal = document.getElementById('studioAdminUploadVideoModal');
    const musicModal = document.getElementById('studioAdminUploadMusicModal');
    const musicFile = document.getElementById('studioAdminUploadMusicFile');
    const musicTitle = document.getElementById('studioAdminUploadMusicTitleInput');
    const musicPrompt = document.getElementById('studioAdminUploadMusicPrompt');
    const musicModel = document.getElementById('studioAdminUploadMusicModel');
    const musicOrganization = document.getElementById('studioAdminUploadMusicOrganization');
    const musicSubmit = document.getElementById('studioAdminUploadMusicSubmit');
    const reason = document.getElementById('studioAdminUploadVideoReason');

    if (!desktopBtn || !chooserModal || !modal || !musicModal) {
        return;
    }

    if (!enabled) {
        desktopBtn.hidden = true;
        if (mobileBtn) mobileBtn.hidden = true;
        return;
    }

    desktopBtn.hidden = false;
    if (mobileBtn) mobileBtn.hidden = false;
    adminUploadEnabled = false;
    adminUploadController = createManualHeroVideoUploadController({
        isEnabled: () => adminUploadEnabled,
        getOperatorReason: () => reason?.value || '',
        setStatus: setAdminUploadStatus,
        render: renderAdminUploadForm,
        formatApiError,
        panelTitle: adminUploadCopy.title,
        panelDescription: adminUploadCopy.description,
        disabledMessage: adminUploadCopy.disabledMessage,
        successStatus: adminUploadCopy.success,
        successToast: adminUploadCopy.successToast,
        errorFallback: adminUploadCopy.error,
        reasonError: adminUploadCopy.reasonError,
        uploadStatus: adminUploadCopy.uploadStatus,
        async onUploadSuccess() {
            if (savedAssetsBrowser) {
                await savedAssetsBrowser.openAllAssets();
            }
            window.setTimeout(closeAdminUploadModal, 0);
        },
    });
    renderAdminUploadForm();

    const handleModalInput = (event) => {
        if (adminUploadController?.handleInput(event)) return;
    };
    const handleModalChange = (event) => {
        if (adminUploadController?.handleChange(event)) return;
    };
    const handleModalClick = (event) => {
        if (event.target?.closest?.('[data-assets-upload-close]')) {
            closeAdminUploadModal();
            return;
        }
        adminUploadController?.handleClick(event);
    };

    modal.addEventListener('input', handleModalInput);
    modal.addEventListener('change', handleModalChange);
    modal.addEventListener('click', handleModalClick);

    chooserModal.addEventListener('click', (event) => {
        if (event.target?.closest?.('[data-assets-upload-chooser-close]')) {
            closeAdminUploadChooser();
            return;
        }
        const choice = event.target?.closest?.('[data-assets-upload-choice]')?.dataset?.assetsUploadChoice;
        if (choice === 'video') {
            openAdminUploadModal(adminUploadLastTrigger || desktopBtn);
        } else if (choice === 'music') {
            openAdminMusicUploadModal(adminUploadLastTrigger || desktopBtn);
        }
    });

    const handleMusicInput = () => {
        syncAdminMusicUploadUi();
    };
    const handleMusicChange = (event) => {
        if (event.target === musicFile) {
            const file = musicFile.files?.[0] || null;
            if (!file) {
                adminMusicUploadState.file = null;
                syncAdminMusicUploadUi();
                return;
            }
            if (!isMp3UploadFile(file)) {
                adminMusicUploadState.file = null;
                setAdminMusicUploadStatus(adminUploadCopy.musicFileTypeError, 'error');
                syncAdminMusicUploadUi();
                return;
            }
            adminMusicUploadState.file = file;
            if (musicTitle && !musicTitle.value.trim()) {
                musicTitle.value = titleFromUploadFileName(file.name);
            }
            setAdminMusicUploadStatus(adminUploadCopy.musicReady);
            syncAdminMusicUploadUi();
            return;
        }
        if (event.target === musicModel) {
            adminMusicUploadState.selectedModel = musicModel.value || '';
            syncAdminMusicUploadUi();
            return;
        }
        if (event.target === musicOrganization) {
            adminMusicUploadState.selectedOrganizationId = musicOrganization.value || '';
            adminMusicUploadState.selectedOrganizationBalance = null;
            if (adminMusicUploadState.selectedOrganizationId) {
                setActiveOrganizationId(adminMusicUploadState.selectedOrganizationId);
                loadSelectedAdminMusicOrganizationBilling().catch((error) => {
                    console.warn('Assets Manager music upload billing load failed:', error);
                    adminMusicUploadState.billingStatus = 'error';
                    adminMusicUploadState.organizationError = adminUploadCopy.musicOrganizationBillingFailed;
                    syncAdminMusicUploadUi();
                });
            } else {
                clearActiveOrganizationId();
                adminMusicUploadState.billingStatus = 'idle';
                syncAdminMusicUploadUi();
            }
        }
    };
    musicModal.addEventListener('input', handleMusicInput);
    musicModal.addEventListener('change', handleMusicChange);
    musicModal.addEventListener('click', (event) => {
        if (event.target?.closest?.('[data-assets-music-upload-close]')) {
            closeAdminMusicUploadModal();
            return;
        }
        if (event.target === musicSubmit) {
            handleAdminMusicUpload().catch((error) => {
                console.warn('Assets Manager music upload failed:', error);
                setAdminMusicUploadStatus(adminUploadCopy.musicError, 'error');
            });
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if (!musicModal.hidden) {
            closeAdminMusicUploadModal();
        } else if (!modal.hidden) {
            closeAdminUploadModal();
        } else if (!chooserModal.hidden) {
            closeAdminUploadChooser();
        }
    });
}

function createBrowser({ fromGenerateLab = false, enableAdminUpload = false } = {}) {
    savedAssetsBrowser = createSavedAssetsBrowser({
        refs: {
            root: document.getElementById('studioSavedAssetsCard'),
            galleryFilter: document.getElementById('studioGalleryFilter'),
            storageUsage: document.getElementById('studioStorageUsage'),
            folderGrid: document.getElementById('studioFolderGrid'),
            folderBack: document.getElementById('studioFolderBack'),
            folderBackBtn: document.getElementById('studioFolderBackBtn'),
            assetGrid: document.getElementById('studioImageGrid'),
            galleryMsg: document.getElementById('studioGalleryMsg'),
            listStatus: document.getElementById('studioListStatus'),
            viewRefresh: document.getElementById('studioViewRefresh'),
            viewShowAll: document.getElementById('studioViewShowAll'),
            uploadVideoBtn: document.getElementById('studioAdminUploadVideoBtn'),
            newFolderBtn: document.getElementById('studioNewFolderBtn'),
            deleteFolderBtn: document.getElementById('studioDeleteFolderBtn'),
            newFolderForm: document.getElementById('studioNewFolderForm'),
            newFolderInput: document.getElementById('studioNewFolderInput'),
            newFolderSave: document.getElementById('studioNewFolderSave'),
            newFolderCancel: document.getElementById('studioNewFolderCancel'),
            deleteFolderForm: document.getElementById('studioDeleteFolderForm'),
            deleteFolderSelect: document.getElementById('studioDeleteFolderSelect'),
            deleteFolderConfirm: document.getElementById('studioDeleteFolderConfirm'),
            deleteFolderCancel: document.getElementById('studioDeleteFolderCancel'),
            selectBtn: document.getElementById('studioSelectBtn'),
            mobileActionsToggle: document.getElementById('studioMobileActionsToggle'),
            mobileActionsMenu: document.getElementById('studioMobileActionsMenu'),
            bulkBar: document.getElementById('studioBulkBar'),
            bulkCount: document.getElementById('studioBulkCount'),
            bulkRename: document.getElementById('studioBulkRename'),
            bulkMove: document.getElementById('studioBulkMove'),
            bulkDelete: document.getElementById('studioBulkDelete'),
            bulkCancel: document.getElementById('studioBulkCancel'),
            selectionGuide: document.getElementById('studioSelectionGuide'),
            selectionGuideCopy: document.getElementById('studioSelectionGuideCopy'),
            selectionGuideStatus: document.getElementById('studioSelectionGuideStatus'),
            renameForm: document.getElementById('studioRenameForm'),
            renameInput: document.getElementById('studioRenameInput'),
            renameConfirm: document.getElementById('studioRenameConfirm'),
            renameCancel: document.getElementById('studioRenameCancel'),
            bulkMoveForm: document.getElementById('studioBulkMoveForm'),
            bulkMoveSummary: document.getElementById('studioBulkMoveSummary'),
            bulkMoveSelect: document.getElementById('studioBulkMoveSelect'),
            bulkMoveConfirm: document.getElementById('studioBulkMoveConfirm'),
            bulkMoveCancel: document.getElementById('studioBulkMoveCancel'),
            actionResult: document.getElementById('studioActionResult'),
            actionResultTitle: document.getElementById('studioActionResultTitle'),
            actionResultCopy: document.getElementById('studioActionResultCopy'),
            actionResultMeta: document.getElementById('studioActionResultMeta'),
            actionResultActions: document.getElementById('studioActionResultActions'),
        },
        emptyStateMessage: fromGenerateLab ? localeText('assets.handoffEmptyCopy') : localeText('assets.emptyDetailed'),
        emptyStateTitle: fromGenerateLab ? localeText('assets.handoffEmptyTitle') : localeText('assets.emptyStateTitle'),
        emptyStateCtaLabel: fromGenerateLab ? localeText('assets.handoffEmptyCta') : localeText('assets.emptyStateCta'),
        emptyStateCtaHref: fromGenerateLab ? localizedHref('/generate-lab/') : undefined,
        loadFailedMessage: fromGenerateLab ? localeText('assets.handoffLoadFailedCopy') : localeText('assets.couldNotLoadAssetsHelp'),
        loadFailedTitle: fromGenerateLab ? localeText('assets.handoffLoadFailedTitle') : localeText('assets.loadFailedTitle'),
        loadFailedCtaLabel: fromGenerateLab ? localeText('assets.handoffEmptyCta') : '',
        loadFailedCtaHref: fromGenerateLab ? localizedHref('/generate-lab/') : '',
        emptyListStatus: fromGenerateLab ? localeText('assets.handoffEmptyStatus') : localeText('assets.listEmptyStatus'),
        loadFailedListStatus: fromGenerateLab ? localeText('assets.handoffLoadFailedStatus') : localeText('assets.listLoadFailedStatus'),
        foldersUnavailableMessage: localeText('assets.foldersUnavailable'),
        handoffActive: fromGenerateLab,
        onUploadVideo: enableAdminUpload
            ? (trigger) => openAdminUploadChooser(trigger || document.getElementById('studioAdminUploadVideoBtn'))
            : null,
    });

    return savedAssetsBrowser;
}

function initGenerateLabHandoff() {
    const banner = document.getElementById('assetsHandoffBanner');
    if (!banner) return;

    const title = document.getElementById('assetsHandoffTitle');
    const status = document.getElementById('assetsHandoffStatus');
    const refresh = document.getElementById('assetsHandoffRefresh');
    const showAll = document.getElementById('assetsHandoffShowAll');
    const dismiss = document.getElementById('assetsHandoffDismiss');
    const returnLink = document.getElementById('assetsHandoffReturn');

    if (returnLink) {
        returnLink.href = localizedHref('/generate-lab/');
    }

    banner.hidden = false;
    title?.focus?.({ preventScroll: true });

    refresh?.addEventListener('click', async () => {
        if (!savedAssetsBrowser) return;
        refresh.disabled = true;
        if (status) status.textContent = localeText('assets.handoffRefreshStarted');
        try {
            await savedAssetsBrowser.refresh({ preserveView: false });
            await savedAssetsBrowser.openAllAssets();
            if (status) status.textContent = localeText('assets.handoffRefreshDone');
        } catch (error) {
            console.warn('Assets Manager Generate Lab handoff refresh failed:', error);
            if (status) status.textContent = localeText('assets.handoffRefreshFailed');
        } finally {
            refresh.disabled = false;
        }
    });

    showAll?.addEventListener('click', async () => {
        if (!savedAssetsBrowser) return;
        showAll.disabled = true;
        if (status) status.textContent = localeText('assets.handoffShowAllStarted');
        try {
            await savedAssetsBrowser.openAllAssets();
            if (status) status.textContent = localeText('assets.handoffShowAllDone');
        } catch (error) {
            console.warn('Assets Manager Generate Lab show-all failed:', error);
            if (status) status.textContent = localeText('assets.handoffShowAllFailed');
        } finally {
            showAll.disabled = false;
        }
    });

    dismiss?.addEventListener('click', () => {
        banner.hidden = true;
        if (status) status.textContent = '';
        clearGenerateLabHandoffQuery();
    });
}

async function init() {
    try { initSiteHeader(); }    catch (e) { console.warn(e); }
    try { initParticles('heroCanvas'); }      catch (e) { console.warn(e); }
    try { initBinaryRain('binaryRain'); }     catch (e) { console.warn(e); }
    try { initBinaryFooter('binaryFooter'); } catch (e) { console.warn(e); }
    try { initScrollReveal(); }               catch (e) { console.warn(e); }
    try { initCookieConsent(); }              catch (e) { console.warn(e); }

    const res = await apiGetMe();

    if (!res.ok || !res.data?.loggedIn) {
        showDeniedState({ sessionExpired: isAuthFailure(res) });
        return;
    }

    const fromGenerateLab = hasGenerateLabHandoff();
    const user = res.data?.user || {};
    const enableAdminUpload = isAdminUser(user);

    showState($content);
    renderPostAuthHint({
        mount: $content,
        pageSource: 'assets-manager',
        signedIn: true,
    });
    setupAdminVideoUpload({ enabled: enableAdminUpload });
    createBrowser({ fromGenerateLab, enableAdminUpload });
    await savedAssetsBrowser.init();
    if (fromGenerateLab) {
        initGenerateLabHandoff();
        await savedAssetsBrowser.openAllAssets();
    }
}

init();
