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
import { getCurrentLocale, localeText, localizedHref } from '../../shared/locale.js?v=__ASSET_VERSION__';

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
const LEDGER_VISIBLE_LIMIT = 5;
const LOCALE = getCurrentLocale();
const DATE_LOCALE = LOCALE === 'de' ? 'de-DE' : 'en-US';
const STRIPE_CHECKOUT_ORIGINS = new Set([
    'https://checkout.stripe.com',
    'https://pay.bitbi.ai',
]);
const EURO_FORMATTER = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const NUMBER_FORMATTER = new Intl.NumberFormat('en-US');
const MONTH_FORMATTER = new Intl.DateTimeFormat(DATE_LOCALE, { month: 'long', year: 'numeric' });

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
    return Number.isNaN(date.getTime()) ? localeText('credits.notReported') : date.toLocaleString(DATE_LOCALE);
}

function parseLedgerDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function monthKeyFromDate(date) {
    if (!date) return 'unknown';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthStartFromKey(key) {
    const match = /^(\d{4})-(\d{2})$/.exec(String(key || ''));
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, 1);
}

function monthLabelFromKey(key) {
    const date = monthStartFromKey(key);
    return date ? MONTH_FORMATTER.format(date) : localeText('credits.notReported');
}

function currentMonthKey() {
    return monthKeyFromDate(new Date());
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
        if (STRIPE_CHECKOUT_ORIGINS.has(url.origin)) return true;
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
    $summaryGrid.classList.toggle('credits-summary-grid--member', activeMode === 'member');
    if (activeMode === 'member') {
        $summaryGrid.append(
            summaryCard(localeText('credits.currentBalance'), formatCredits(balance.current)),
            summaryCard(localeText('credits.consumed'), formatCredits(balance.lifetimeConsumed)),
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
    const hostNote = document.createElement('p');
    hostNote.className = 'credits-legal__host-note';
    hostNote.textContent = localeText('credits.securePayment');
    $legalBlock.appendChild(hostNote);
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

function compareLedgerEntries(a, b) {
    if (a.timestamp !== b.timestamp) return b.timestamp - a.timestamp;
    return a.index - b.index;
}

function compareLedgerMonthKeys(a, b) {
    const dateA = monthStartFromKey(a);
    const dateB = monthStartFromKey(b);
    if (!dateA && !dateB) return 0;
    if (!dateA) return 1;
    if (!dateB) return -1;
    return dateB.getTime() - dateA.getTime();
}

function groupLedgerByMonth(rows = []) {
    const groups = new Map();
    rows.forEach((item, index) => {
        const date = parseLedgerDate(item?.createdAt);
        const key = monthKeyFromDate(date);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({
            item,
            index,
            timestamp: date ? date.getTime() : Number.NEGATIVE_INFINITY,
        });
    });

    for (const [key, entries] of groups.entries()) {
        groups.set(key, entries.sort(compareLedgerEntries).map((entry) => entry.item));
    }
    return groups;
}

function ledgerDetails(item = {}) {
    if (item.usage) {
        return [
            item.usage.model,
            item.usage.action,
            item.usage.pricingSource,
        ].filter(Boolean).join(' • ');
    }
    return item.featureKey || item.createdByEmail || localeText('credits.notReported');
}

function ledgerField(label, value) {
    const row = document.createElement('div');
    row.className = 'credits-ledger-item__field';
    const term = document.createElement('dt');
    term.textContent = label;
    const description = document.createElement('dd');
    description.textContent = value;
    row.append(term, description);
    return row;
}

function createLedgerItem(item = {}) {
    const entry = document.createElement('article');
    entry.className = 'credits-ledger-item';

    const top = document.createElement('div');
    top.className = 'credits-ledger-item__top';
    const type = document.createElement('span');
    type.className = 'credits-ledger-item__type';
    type.textContent = item.type || item.entryType || localeText('credits.notReported');
    const date = document.createElement('time');
    date.className = 'credits-ledger-item__date';
    if (item.createdAt) date.dateTime = item.createdAt;
    date.textContent = formatDate(item.createdAt);
    top.append(type, date);

    const description = document.createElement('p');
    description.className = 'credits-ledger-item__description';
    description.textContent = item.description || item.source || localeText('credits.notReported');

    const fields = document.createElement('dl');
    fields.className = 'credits-ledger-item__fields';
    fields.append(
        ledgerField(localeText('credits.details'), ledgerDetails(item)),
        ledgerField(localeText('credits.amount'), formatCredits(item.amount)),
        ledgerField(localeText('credits.balance'), formatCredits(item.balanceAfter)),
    );

    entry.append(top, description, fields);
    return entry;
}

function showMoreLabel(count) {
    return localeText('credits.showMoreActivity', {
        count: NUMBER_FORMATTER.format(count),
        plural: LOCALE === 'de' ? (count === 1 ? '' : 'en') : (count === 1 ? '' : 's'),
    });
}

function createLedgerList(rows, modifier) {
    const list = document.createElement('div');
    list.className = `credits-ledger-list ${modifier}`;
    rows.forEach((item) => list.appendChild(createLedgerItem(item)));
    return list;
}

function createLedgerMonthCard({ label, rows = [], current = false } = {}) {
    const card = document.createElement('article');
    card.className = current ? 'credits-ledger-card credits-ledger-card--current' : 'credits-ledger-card';

    const title = document.createElement('h3');
    title.className = 'credits-ledger-card__title';
    title.textContent = label || localeText('credits.notReported');
    card.appendChild(title);

    if (!rows.length) {
        const empty = document.createElement('p');
        empty.className = 'credits-empty';
        empty.textContent = localeText('credits.noLedger');
        card.appendChild(empty);
        return card;
    }

    card.appendChild(createLedgerList(rows.slice(0, LEDGER_VISIBLE_LIMIT), 'credits-ledger-list--direct'));

    const remaining = rows.slice(LEDGER_VISIBLE_LIMIT);
    if (remaining.length) {
        const details = document.createElement('details');
        details.className = 'credits-ledger-more';
        const summary = document.createElement('summary');
        summary.textContent = showMoreLabel(remaining.length);
        details.append(summary, createLedgerList(remaining, 'credits-ledger-more__items'));
        card.appendChild(details);
    }

    return card;
}

function renderLedger(rows = []) {
    if (!$ledgerBody) return;
    $ledgerBody.textContent = '';
    $ledgerBody.className = 'credits-ledger-grid';

    const groups = groupLedgerByMonth(rows);
    const currentKey = currentMonthKey();
    $ledgerBody.appendChild(createLedgerMonthCard({
        key: currentKey,
        label: monthLabelFromKey(currentKey),
        rows: groups.get(currentKey) || [],
        current: true,
    }));

    const previousKeys = Array.from(groups.keys())
        .filter((key) => key !== currentKey)
        .sort(compareLedgerMonthKeys);

    for (const key of previousKeys) {
        $ledgerBody.appendChild(createLedgerMonthCard({
            key,
            label: monthLabelFromKey(key),
            rows: groups.get(key) || [],
            current: false,
        }));
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
