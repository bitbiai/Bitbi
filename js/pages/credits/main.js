import { initSiteHeader } from '../../shared/site-header.js?v=__ASSET_VERSION__';
import { initCookieConsent } from '../../shared/cookie-consent.js';
import {
    apiAccountCreditsDashboard,
    apiAdminOrganizations,
    apiCreateMemberLiveCreditPackCheckout,
    apiCreateLiveCreditPackCheckout,
    apiGetMe,
    apiListOrganizations,
    apiOrganizationCreditsDashboard,
} from '../../shared/auth-api.js?v=__ASSET_VERSION__';
import {
    clearActiveOrganizationId,
    resolveActiveOrganizationId,
    setActiveOrganizationId,
} from '../../shared/active-organization.js?v=__ASSET_VERSION__';
import { localeText, localizedHref } from '../../shared/locale.js?v=__ASSET_VERSION__';

const $loading = document.getElementById('creditsLoading');
const $denied = document.getElementById('creditsDenied');
const $error = document.getElementById('creditsError');
const $dashboard = document.getElementById('creditsDashboard');
const $returnState = document.getElementById('creditsReturnState');
const $eyebrow = document.getElementById('creditsEyebrow');
const $subtitle = document.getElementById('creditsSubtitle');
const $scopeLabel = document.getElementById('creditsScopeLabel');
const $orgName = document.getElementById('creditsOrgName');
const $accessScope = document.getElementById('creditsAccessScope');
const $orgPickerWrap = document.getElementById('creditsOrgPickerWrap');
const $orgPicker = document.getElementById('creditsOrgPicker');
const $summaryGrid = document.getElementById('creditsSummaryGrid');
const $packsSection = document.getElementById('creditsPacksSection');
const $checkoutStatus = document.getElementById('creditsCheckoutStatus');
const $configNote = document.getElementById('creditsConfigNote');
const $legalBlock = document.getElementById('creditsLegalBlock');
const $packGrid = document.getElementById('creditsPackGrid');
const $purchasesSection = document.getElementById('creditsPurchasesSection');
const $purchasesBody = document.getElementById('creditsPurchasesBody');
const $ledgerBody = document.getElementById('creditsLedgerBody');

const TERMS_VERSION = '2026-05-05';
const EURO_FORMATTER = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const NUMBER_FORMATTER = new Intl.NumberFormat('en-US');

let currentUser = null;
let eligibleOrganizations = [];
let selectedOrganizationId = null;
let currentDashboard = null;
let activeMode = 'organization';
let termsAccepted = false;
let immediateDeliveryAccepted = false;
let legalError = '';

function show(node) {
    if (node) node.hidden = false;
}

function hide(node) {
    if (node) node.hidden = true;
}

function setError(message) {
    hide($loading);
    hide($dashboard);
    hide($denied);
    if ($error) {
        $error.textContent = message || localeText('credits.unavailable');
        show($error);
    }
}

function setDenied() {
    hide($loading);
    hide($dashboard);
    hide($error);
    show($denied);
}

function setMode(mode) {
    activeMode = mode === 'member' ? 'member' : 'organization';
    if ($eyebrow) $eyebrow.textContent = activeMode === 'member' ? localeText('credits.memberCredits') : localeText('credits.organizationBilling');
    if ($scopeLabel) $scopeLabel.textContent = activeMode === 'member' ? localeText('credits.memberAccount') : localeText('credits.organization');
    if ($subtitle) {
        $subtitle.textContent = activeMode === 'member'
            ? localeText('credits.memberSubtitle')
            : localeText('credits.organizationSubtitle');
    }
}

function removeMemberIrrelevantOrgPicker() {
    if ($orgPickerWrap && $orgPickerWrap.isConnected) {
        $orgPickerWrap.remove();
    }
}

function setNeedsOrganizationSelection() {
    hide($loading);
    hide($error);
    hide($denied);
    show($dashboard);
    if ($orgName) $orgName.textContent = localeText('credits.selectOrganization');
    if ($accessScope) $accessScope.textContent = localeText('credits.selectOrganizationHelp');
    renderOrgPicker();
    renderSummary({});
    renderCheckoutStatus({ enabled: false, configured: false }, currentUser?.role === 'admin' ? 'platform_admin' : 'org_owner');
    renderLegalBlock(false);
    renderPacks([], false);
    renderPurchases([]);
    renderLedger([]);
}

function formatCredits(value) {
    return localeText('credits.credits', { count: NUMBER_FORMATTER.format(Number(value || 0)) });
}

function formatDate(value) {
    if (!value) return localeText('credits.notReported');
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? localeText('credits.notReported') : date.toLocaleString();
}

function formatMoney(amountCents, currency = 'eur') {
    if (String(currency).toLowerCase() === 'eur') {
        return EURO_FORMATTER.format(Number(amountCents || 0) / 100);
    }
    return `${Number(amountCents || 0)} ${String(currency || '').toUpperCase()}`;
}

function idempotencyKey(packId, organizationId) {
    const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return activeMode === 'member'
        ? `credits-member-live:${packId}:${random}`
        : `credits-live:${organizationId}:${packId}:${random}`;
}

function isSafeCheckoutRedirect(value) {
    if (typeof value !== 'string' || !value) return false;
    try {
        const url = new URL(value, window.location.href);
        if (url.origin === 'https://checkout.stripe.com') return true;
        return url.origin === window.location.origin && url.pathname.startsWith('/account/credits');
    } catch {
        return false;
    }
}

function normalizeOrganizations(data, { platformAdmin = false } = {}) {
    const orgs = Array.isArray(data?.organizations) ? data.organizations : [];
    return orgs
        .filter((org) => org && org.id && org.status === 'active')
        .filter((org) => platformAdmin || org.role === 'owner')
        .map((org) => ({
            id: org.id,
            name: org.name || org.slug || org.id,
            role: platformAdmin ? 'platform_admin' : org.role,
            status: org.status,
        }));
}

async function loadEligibleOrganizations() {
    if (currentUser?.role === 'admin') {
        const res = await apiAdminOrganizations({ limit: 100 });
        if (!res.ok) throw new Error(res.error || localeText('credits.adminOrgsFailed'));
        return normalizeOrganizations(res.data, { platformAdmin: true });
    }
    const res = await apiListOrganizations({ limit: 100 });
    if (!res.ok) throw new Error(res.error || localeText('credits.orgsFailed'));
    return normalizeOrganizations(res.data, { platformAdmin: false });
}

function renderReturnState() {
    const params = new URLSearchParams(window.location.search);
    const state = params.get('checkout');
    if (!$returnState || !state) return;
    if (state === 'success') {
        $returnState.textContent = localeText('credits.checkoutSuccess');
        show($returnState);
    } else if (state === 'cancel') {
        $returnState.textContent = localeText('credits.checkoutCancel');
        show($returnState);
    }
}

function renderOrgPicker() {
    if (!$orgPicker || !$orgPickerWrap) return;
    $orgPicker.textContent = '';
    if (eligibleOrganizations.length !== 1) {
        $orgPicker.append(new Option(localeText('credits.selectOrganizationOption'), ''));
    }
    for (const org of eligibleOrganizations) {
        const option = document.createElement('option');
        option.value = org.id;
        option.textContent = org.name;
        $orgPicker.appendChild(option);
    }
    $orgPicker.value = selectedOrganizationId || '';
    $orgPickerWrap.hidden = eligibleOrganizations.length <= 1 && Boolean(selectedOrganizationId);
}

function summaryCard(label, value) {
    const card = document.createElement('article');
    card.className = 'credits-card';
    const title = document.createElement('div');
    title.className = 'credits-card__label';
    title.textContent = label;
    const amount = document.createElement('div');
    amount.className = 'credits-card__value';
    amount.textContent = value;
    card.append(title, amount);
    return card;
}

function renderSummary(balance = {}) {
    if (!$summaryGrid) return;
    $summaryGrid.textContent = '';
    if (activeMode === 'member') {
        $summaryGrid.append(
            summaryCard(localeText('credits.currentBalance'), formatCredits(balance.current)),
            summaryCard(localeText('credits.dailyTopupTarget'), formatCredits(balance.dailyAllowance)),
            summaryCard(localeText('credits.dailyTopups'), formatCredits(balance.lifetimeDailyTopUps)),
            summaryCard(localeText('credits.manualGrants'), formatCredits(balance.lifetimeManualGrants)),
            summaryCard(localeText('credits.consumed'), formatCredits(balance.lifetimeConsumed)),
            summaryCard(localeText('credits.incomingCredits'), formatCredits(balance.lifetimeIncoming)),
        );
    } else {
        $summaryGrid.append(
            summaryCard(localeText('credits.currentBalance'), formatCredits(balance.current)),
            summaryCard(localeText('credits.available'), formatCredits(balance.available)),
            summaryCard(localeText('credits.reserved'), formatCredits(balance.reserved)),
            summaryCard(localeText('credits.livePurchased'), formatCredits(balance.lifetimePurchasedLive)),
            summaryCard(localeText('credits.manualGrants'), formatCredits(balance.lifetimeManualGrants)),
            summaryCard(localeText('credits.consumed'), formatCredits(balance.lifetimeConsumed)),
        );
    }
}

function renderCheckoutStatus(status = {}, accessScope) {
    const enabled = status.enabled === true && status.configured === true;
    if ($checkoutStatus) {
        $checkoutStatus.className = `credits-badge ${enabled ? 'credits-badge--live' : 'credits-badge--blocked'}`;
        $checkoutStatus.textContent = enabled ? localeText('credits.liveEnabled') : localeText('credits.liveUnavailable');
    }
    if ($configNote) {
        const missing = Array.isArray(status.missingConfigNames) ? status.missingConfigNames : [];
        if (enabled) {
            $configNote.hidden = true;
        } else {
            $configNote.textContent = accessScope === 'platform_admin' && missing.length
                ? localeText('credits.operatorMissing', { names: missing.join(', ') })
                : localeText('credits.checkoutUnavailableTryLater');
            show($configNote);
        }
    }
    return enabled;
}

function renderLegalBlock(visible) {
    if (!$legalBlock) return;
    $legalBlock.textContent = '';
    if (!visible) {
        hide($legalBlock);
        return;
    }

    const title = document.createElement('h3');
    title.className = 'credits-legal__title';
    title.textContent = localeText('credits.checkoutConfirmations');

    const termsLabel = document.createElement('label');
    termsLabel.className = 'credits-legal__check';
    const termsInput = document.createElement('input');
    termsInput.id = 'creditsTermsAccepted';
    termsInput.type = 'checkbox';
    termsInput.checked = termsAccepted;
    termsInput.addEventListener('change', () => {
        termsAccepted = termsInput.checked;
        legalError = '';
        renderLegalBlock(true);
    });
    const termsText = document.createElement('span');
    termsText.appendChild(document.createTextNode(localeText('credits.acceptTermsPrefix')));
    const termsLink = document.createElement('a');
    termsLink.href = localizedHref('/legal/terms.html');
    termsLink.target = '_blank';
    termsLink.rel = 'noopener noreferrer';
    termsLink.textContent = localeText('credits.termsLink');
    termsText.appendChild(termsLink);
    termsText.appendChild(document.createTextNode(localeText('credits.acceptTermsSuffix')));
    termsLabel.append(termsInput, termsText);

    const deliveryLabel = document.createElement('label');
    deliveryLabel.className = 'credits-legal__check';
    const deliveryInput = document.createElement('input');
    deliveryInput.id = 'creditsImmediateDeliveryAccepted';
    deliveryInput.type = 'checkbox';
    deliveryInput.checked = immediateDeliveryAccepted;
    deliveryInput.addEventListener('change', () => {
        immediateDeliveryAccepted = deliveryInput.checked;
        legalError = '';
        renderLegalBlock(true);
    });
    deliveryLabel.append(
        deliveryInput,
        document.createTextNode(localeText('credits.immediateDelivery')),
    );

    $legalBlock.append(title, termsLabel, deliveryLabel);
    if (legalError) {
        const error = document.createElement('p');
        error.className = 'credits-legal__error';
        error.setAttribute('role', 'alert');
        error.textContent = legalError;
        $legalBlock.appendChild(error);
    }
    show($legalBlock);
}

function renderPacks(packs = [], checkoutEnabled) {
    if (!$packGrid) return;
    $packGrid.textContent = '';
    for (const pack of packs) {
        const card = document.createElement('article');
        card.className = 'credits-pack';
        const title = document.createElement('h3');
        title.textContent = `${NUMBER_FORMATTER.format(pack.credits)} Credits`;
        const price = document.createElement('div');
        price.className = 'credits-pack__price';
        price.textContent = pack.displayPrice || formatMoney(pack.amountCents, pack.currency);
        const meta = document.createElement('p');
        meta.className = 'credits-pack__meta';
        meta.textContent = localeText('credits.oneTimeStripe');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-primary credits-pack__cta';
        button.dataset.checkoutPack = pack.id;
        button.disabled = !checkoutEnabled;
        button.textContent = checkoutEnabled ? localeText('credits.continueCheckout') : localeText('credits.checkoutUnavailable');
        card.append(title, price, meta, button);
        $packGrid.appendChild(card);
    }
}

function renderPurchases(rows = []) {
    if (!$purchasesBody) return;
    $purchasesBody.textContent = '';
    if (!rows.length) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 5;
        cell.className = 'credits-empty';
        cell.textContent = localeText('credits.noPurchases');
        row.appendChild(cell);
        $purchasesBody.appendChild(row);
        return;
    }
    for (const item of rows) {
        const row = document.createElement('tr');
        for (const value of [
            formatDate(item.createdAt),
            item.creditPack?.id || localeText('credits.notReported'),
            item.status || localeText('credits.notReported'),
            formatMoney(item.creditPack?.amountCents, item.creditPack?.currency),
            item.authorizationScope || localeText('credits.notReported'),
        ]) {
            const cell = document.createElement('td');
            cell.textContent = value;
            row.appendChild(cell);
        }
        $purchasesBody.appendChild(row);
    }
}

function renderLedger(rows = []) {
    if (!$ledgerBody) return;
    $ledgerBody.textContent = '';
    if (!rows.length) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 6;
        cell.className = 'credits-empty';
        cell.textContent = localeText('credits.noLedger');
        row.appendChild(cell);
        $ledgerBody.appendChild(row);
        return;
    }
    for (const item of rows) {
        const row = document.createElement('tr');
        const details = item.usage
            ? [
                item.usage.model,
                item.usage.action,
                item.usage.pricingSource,
            ].filter(Boolean).join(' • ')
            : (item.featureKey || item.createdByEmail || localeText('credits.notReported'));
        for (const value of [
            formatDate(item.createdAt),
            item.type || item.entryType || localeText('credits.notReported'),
            item.description || item.source || localeText('credits.notReported'),
            details || localeText('credits.notReported'),
            formatCredits(item.amount),
            formatCredits(item.balanceAfter),
        ]) {
            const cell = document.createElement('td');
            cell.textContent = value;
            row.appendChild(cell);
        }
        $ledgerBody.appendChild(row);
    }
}

function renderMemberDashboard(dashboard) {
    currentDashboard = dashboard;
    setMode('member');
    hide($loading);
    hide($error);
    hide($denied);
    show($dashboard);
    if ($orgName) $orgName.textContent = localeText('credits.personalCredits');
    if ($accessScope) {
        const topUp = dashboard.dailyTopUp;
        $accessScope.textContent = topUp
            ? localeText('credits.dailyTopupGranted', { credits: formatCredits(topUp.grantedCredits) })
            : localeText('credits.personalAccount');
    }
    removeMemberIrrelevantOrgPicker();
    if ($packsSection) $packsSection.hidden = false;
    if ($purchasesSection) $purchasesSection.hidden = false;
    const checkoutEnabled = renderCheckoutStatus(dashboard.liveCheckout, 'member');
    renderLegalBlock(checkoutEnabled && Array.isArray(dashboard.packs) && dashboard.packs.length > 0);
    renderSummary(dashboard.balance);
    renderPacks(dashboard.packs || [], checkoutEnabled);
    renderPurchases(dashboard.purchaseHistory || []);
    renderLedger(dashboard.transactions);
}

function renderDashboard(dashboard) {
    currentDashboard = dashboard;
    setMode('organization');
    hide($loading);
    hide($error);
    hide($denied);
    show($dashboard);
    if ($packsSection) $packsSection.hidden = false;
    if ($purchasesSection) $purchasesSection.hidden = false;
    if ($orgName) $orgName.textContent = dashboard.organization?.name || localeText('credits.organization');
    if ($accessScope) {
        $accessScope.textContent = dashboard.organization?.accessScope === 'platform_admin'
            ? localeText('credits.platformAdminAccess')
            : localeText('credits.orgOwnerAccess');
    }
    renderOrgPicker();
    renderSummary(dashboard.balance);
    const checkoutEnabled = renderCheckoutStatus(dashboard.liveCheckout, dashboard.organization?.accessScope);
    renderLegalBlock(checkoutEnabled && Array.isArray(dashboard.packs) && dashboard.packs.length > 0);
    renderPacks(dashboard.packs, checkoutEnabled);
    renderPurchases(dashboard.purchaseHistory);
    renderLedger(dashboard.recentLedger);
}

async function loadMemberDashboard() {
    hide($denied);
    hide($error);
    show($loading);
    const res = await apiAccountCreditsDashboard({ limit: 50 });
    if (!res.ok) {
        if (res.status === 401 || res.status === 403) return setDenied();
        return setError(res.error || localeText('credits.unavailable'));
    }
    renderMemberDashboard(res.data?.dashboard || {});
}

async function loadDashboard() {
    if (!selectedOrganizationId) return setDenied();
    hide($denied);
    hide($error);
    show($loading);
    const res = await apiOrganizationCreditsDashboard(selectedOrganizationId, { limit: 25 });
    if (!res.ok) {
        if (res.status === 401 || res.status === 403 || res.status === 404) return setDenied();
        return setError(res.error || localeText('credits.unavailable'));
    }
    renderDashboard(res.data?.dashboard || {});
}

async function startCheckout(packId, button) {
    if (!packId) return;
    if (activeMode !== 'member' && !selectedOrganizationId) return;
    if (!termsAccepted || !immediateDeliveryAccepted) {
        legalError = localeText('credits.legalError');
        renderLegalBlock(true);
        return;
    }
    const original = button.textContent;
    button.disabled = true;
    button.textContent = localeText('credits.creatingCheckout');
    const payload = {
        packId,
        idempotencyKey: idempotencyKey(packId, selectedOrganizationId),
        termsAccepted: true,
        termsVersion: TERMS_VERSION,
        immediateDeliveryAccepted: true,
        acceptedAt: new Date().toISOString(),
    };
    const res = activeMode === 'member'
        ? await apiCreateMemberLiveCreditPackCheckout(payload)
        : await apiCreateLiveCreditPackCheckout(selectedOrganizationId, payload);
    if (!res.ok) {
        button.disabled = false;
        button.textContent = original;
        setError(res.error || localeText('credits.checkoutFailed'));
        if (currentDashboard) {
            if (activeMode === 'member') renderMemberDashboard(currentDashboard);
            else renderDashboard(currentDashboard);
        }
        return;
    }
    const checkoutUrl = res.data?.checkout_url;
    if (isSafeCheckoutRedirect(checkoutUrl)) {
        window.location.assign(checkoutUrl);
        return;
    }
    button.disabled = false;
    button.textContent = original;
    setError(localeText('credits.invalidCheckout'));
}

async function init() {
    try { initSiteHeader(); } catch (error) { console.warn(error); }
    try { initCookieConsent(); } catch (error) { console.warn(error); }
    renderReturnState();

    const me = await apiGetMe();
    if (!me.ok || !me.data?.loggedIn) return setDenied();
    currentUser = me.data.user || {};
    const params = new URLSearchParams(window.location.search);
    const requestedScope = params.get('scope');
    if (requestedScope === 'member') return loadMemberDashboard();

    try {
        eligibleOrganizations = await loadEligibleOrganizations();
    } catch (error) {
        return setError(error?.message || localeText('credits.orgLoadFailed'));
    }
    if (!eligibleOrganizations.length) return loadMemberDashboard();
    selectedOrganizationId = resolveActiveOrganizationId(eligibleOrganizations);
    if (!selectedOrganizationId) return setNeedsOrganizationSelection();
    await loadDashboard();
}

$orgPicker?.addEventListener('change', async () => {
    selectedOrganizationId = $orgPicker.value;
    if (selectedOrganizationId) setActiveOrganizationId(selectedOrganizationId);
    else clearActiveOrganizationId();
    if (!selectedOrganizationId) return setNeedsOrganizationSelection();
    await loadDashboard();
});

$packGrid?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-checkout-pack]');
    if (!button) return;
    startCheckout(button.dataset.checkoutPack, button);
});

init().catch((error) => {
    console.warn(error);
    setError(localeText('credits.unavailable'));
});
