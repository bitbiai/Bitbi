import { initSiteHeader } from '../../shared/site-header.js?v=__ASSET_VERSION__';
import { initCookieConsent } from '../../shared/cookie-consent.js';
import {
    apiAdminOrganizations,
    apiCreateLiveCreditPackCheckout,
    apiGetMe,
    apiListOrganizations,
    apiOrganizationCreditsDashboard,
} from '../../shared/auth-api.js?v=__ASSET_VERSION__';

const $loading = document.getElementById('creditsLoading');
const $denied = document.getElementById('creditsDenied');
const $error = document.getElementById('creditsError');
const $dashboard = document.getElementById('creditsDashboard');
const $returnState = document.getElementById('creditsReturnState');
const $orgName = document.getElementById('creditsOrgName');
const $accessScope = document.getElementById('creditsAccessScope');
const $orgPickerWrap = document.getElementById('creditsOrgPickerWrap');
const $orgPicker = document.getElementById('creditsOrgPicker');
const $summaryGrid = document.getElementById('creditsSummaryGrid');
const $checkoutStatus = document.getElementById('creditsCheckoutStatus');
const $configNote = document.getElementById('creditsConfigNote');
const $packGrid = document.getElementById('creditsPackGrid');
const $purchasesBody = document.getElementById('creditsPurchasesBody');
const $ledgerBody = document.getElementById('creditsLedgerBody');

const EURO_FORMATTER = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const NUMBER_FORMATTER = new Intl.NumberFormat('en-US');

let currentUser = null;
let eligibleOrganizations = [];
let selectedOrganizationId = null;
let currentDashboard = null;

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
        $error.textContent = message || 'Credits dashboard is unavailable.';
        show($error);
    }
}

function setDenied() {
    hide($loading);
    hide($dashboard);
    hide($error);
    show($denied);
}

function formatCredits(value) {
    return `${NUMBER_FORMATTER.format(Number(value || 0))} credits`;
}

function formatDate(value) {
    if (!value) return 'Not reported';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Not reported' : date.toLocaleString();
}

function formatMoney(amountCents, currency = 'eur') {
    if (String(currency).toLowerCase() === 'eur') {
        return EURO_FORMATTER.format(Number(amountCents || 0) / 100);
    }
    return `${Number(amountCents || 0)} ${String(currency || '').toUpperCase()}`;
}

function idempotencyKey(packId, organizationId) {
    const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `credits-live:${organizationId}:${packId}:${random}`;
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
        if (!res.ok) throw new Error(res.error || 'Could not load admin organizations.');
        return normalizeOrganizations(res.data, { platformAdmin: true });
    }
    const res = await apiListOrganizations({ limit: 100 });
    if (!res.ok) throw new Error(res.error || 'Could not load organizations.');
    return normalizeOrganizations(res.data, { platformAdmin: false });
}

function renderReturnState() {
    const params = new URLSearchParams(window.location.search);
    const state = params.get('checkout');
    if (!$returnState || !state) return;
    if (state === 'success') {
        $returnState.textContent = 'Payment was returned from Stripe. Credits appear after the verified webhook confirms the paid live Checkout Session.';
        show($returnState);
    } else if (state === 'cancel') {
        $returnState.textContent = 'Checkout was cancelled. No credits were added and your balance is unchanged.';
        show($returnState);
    }
}

function renderOrgPicker() {
    if (!$orgPicker || !$orgPickerWrap) return;
    $orgPicker.textContent = '';
    for (const org of eligibleOrganizations) {
        const option = document.createElement('option');
        option.value = org.id;
        option.textContent = org.name;
        $orgPicker.appendChild(option);
    }
    $orgPicker.value = selectedOrganizationId || '';
    $orgPickerWrap.hidden = eligibleOrganizations.length <= 1;
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
    $summaryGrid.append(
        summaryCard('Current balance', formatCredits(balance.current)),
        summaryCard('Available', formatCredits(balance.available)),
        summaryCard('Reserved', formatCredits(balance.reserved)),
        summaryCard('Live purchased', formatCredits(balance.lifetimePurchasedLive)),
        summaryCard('Manual grants', formatCredits(balance.lifetimeManualGrants)),
        summaryCard('Consumed', formatCredits(balance.lifetimeConsumed)),
    );
}

function renderCheckoutStatus(status = {}, accessScope) {
    const enabled = status.enabled === true && status.configured === true;
    if ($checkoutStatus) {
        $checkoutStatus.className = `credits-badge ${enabled ? 'credits-badge--live' : 'credits-badge--blocked'}`;
        $checkoutStatus.textContent = enabled ? 'Live checkout enabled' : 'Live checkout unavailable';
    }
    if ($configNote) {
        const missing = Array.isArray(status.missingConfigNames) ? status.missingConfigNames : [];
        if (enabled) {
            $configNote.hidden = true;
        } else {
            $configNote.textContent = accessScope === 'platform_admin' && missing.length
                ? `Operator config missing: ${missing.join(', ')}. Values are never shown here.`
                : 'Checkout is currently unavailable. Please try again later or contact an administrator.';
            show($configNote);
        }
    }
    return enabled;
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
        meta.textContent = 'One-time live Stripe card payment. Credits are granted only after the verified webhook confirms payment.';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-primary credits-pack__cta';
        button.dataset.checkoutPack = pack.id;
        button.disabled = !checkoutEnabled;
        button.textContent = checkoutEnabled ? 'Continue to checkout' : 'Checkout unavailable';
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
        cell.textContent = 'No live credit-pack purchases yet.';
        row.appendChild(cell);
        $purchasesBody.appendChild(row);
        return;
    }
    for (const item of rows) {
        const row = document.createElement('tr');
        for (const value of [
            formatDate(item.createdAt),
            item.creditPack?.id || 'Not reported',
            item.status || 'Not reported',
            formatMoney(item.creditPack?.amountCents, item.creditPack?.currency),
            item.authorizationScope || 'Not reported',
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
        cell.colSpan = 5;
        cell.className = 'credits-empty';
        cell.textContent = 'No recent credit ledger activity.';
        row.appendChild(cell);
        $ledgerBody.appendChild(row);
        return;
    }
    for (const item of rows) {
        const row = document.createElement('tr');
        for (const value of [
            formatDate(item.createdAt),
            item.entryType || 'Not reported',
            item.source || 'Not reported',
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

function renderDashboard(dashboard) {
    currentDashboard = dashboard;
    hide($loading);
    hide($error);
    hide($denied);
    show($dashboard);
    if ($orgName) $orgName.textContent = dashboard.organization?.name || 'Organization';
    if ($accessScope) {
        $accessScope.textContent = dashboard.organization?.accessScope === 'platform_admin'
            ? 'Platform admin access.'
            : 'Active organization owner access.';
    }
    renderOrgPicker();
    renderSummary(dashboard.balance);
    const checkoutEnabled = renderCheckoutStatus(dashboard.liveCheckout, dashboard.organization?.accessScope);
    renderPacks(dashboard.packs, checkoutEnabled);
    renderPurchases(dashboard.purchaseHistory);
    renderLedger(dashboard.recentLedger);
}

async function loadDashboard() {
    if (!selectedOrganizationId) return setDenied();
    hide($denied);
    hide($error);
    show($loading);
    const res = await apiOrganizationCreditsDashboard(selectedOrganizationId, { limit: 25 });
    if (!res.ok) {
        if (res.status === 401 || res.status === 403 || res.status === 404) return setDenied();
        return setError(res.error || 'Credits dashboard is unavailable.');
    }
    renderDashboard(res.data?.dashboard || {});
}

async function startCheckout(packId, button) {
    if (!selectedOrganizationId || !packId) return;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Creating checkout...';
    const res = await apiCreateLiveCreditPackCheckout(selectedOrganizationId, {
        packId,
        idempotencyKey: idempotencyKey(packId, selectedOrganizationId),
    });
    if (!res.ok) {
        button.disabled = false;
        button.textContent = original;
        setError(res.error || 'Checkout could not be created.');
        if (currentDashboard) renderDashboard(currentDashboard);
        return;
    }
    const checkoutUrl = res.data?.checkout_url;
    if (isSafeCheckoutRedirect(checkoutUrl)) {
        window.location.assign(checkoutUrl);
        return;
    }
    button.disabled = false;
    button.textContent = original;
    setError('Checkout response was invalid.');
}

async function init() {
    try { initSiteHeader(); } catch (error) { console.warn(error); }
    try { initCookieConsent(); } catch (error) { console.warn(error); }
    renderReturnState();

    const me = await apiGetMe();
    if (!me.ok || !me.data?.loggedIn) return setDenied();
    currentUser = me.data.user || {};

    try {
        eligibleOrganizations = await loadEligibleOrganizations();
    } catch (error) {
        return setError(error?.message || 'Could not load organization access.');
    }
    if (!eligibleOrganizations.length) return setDenied();
    selectedOrganizationId = eligibleOrganizations[0].id;
    await loadDashboard();
}

$orgPicker?.addEventListener('change', async () => {
    selectedOrganizationId = $orgPicker.value;
    await loadDashboard();
});

$packGrid?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-checkout-pack]');
    if (!button) return;
    startCheckout(button.dataset.checkoutPack, button);
});

init().catch((error) => {
    console.warn(error);
    setError('Credits dashboard failed to load.');
});
