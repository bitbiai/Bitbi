import { initSiteHeader } from '../../shared/site-header.js?v=__ASSET_VERSION__';
import { initCookieConsent } from '../../shared/cookie-consent.js';
import {
    apiAdminOrganizations,
    apiGetMe,
    apiListOrganizations,
    apiOrganizationDashboard,
} from '../../shared/auth-api.js?v=__ASSET_VERSION__';
import {
    clearActiveOrganizationId,
    resolveActiveOrganizationId,
    setActiveOrganizationId,
} from '../../shared/active-organization.js?v=__ASSET_VERSION__';

const $loading = document.getElementById('organizationLoading');
const $denied = document.getElementById('organizationDenied');
const $error = document.getElementById('organizationError');
const $dashboard = document.getElementById('organizationDashboard');
const $name = document.getElementById('organizationName');
const $access = document.getElementById('organizationAccess');
const $pickerWrap = document.getElementById('organizationPickerWrap');
const $picker = document.getElementById('organizationPicker');
const $warning = document.getElementById('organizationWarning');
const $summaryGrid = document.getElementById('organizationSummaryGrid');
const $ledgerBody = document.getElementById('organizationLedgerBody');
const $adminDebitsBody = document.getElementById('organizationAdminDebitsBody');
const $membersBody = document.getElementById('organizationMembersBody');

const NUMBER_FORMATTER = new Intl.NumberFormat('en-US');

let currentUser = null;
let eligibleOrganizations = [];
let selectedOrganizationId = '';

function show(node) {
    if (node) node.hidden = false;
}

function hide(node) {
    if (node) node.hidden = true;
}

function formatCredits(value) {
    return `${NUMBER_FORMATTER.format(Number(value || 0))} credits`;
}

function formatDate(value) {
    if (!value) return 'Not reported';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Not reported' : date.toLocaleString();
}

function setDenied() {
    hide($loading);
    hide($dashboard);
    hide($error);
    show($denied);
}

function setError(message) {
    hide($loading);
    hide($dashboard);
    hide($denied);
    if ($error) {
        $error.textContent = message || 'Organization dashboard is unavailable.';
        show($error);
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
        if (!res.ok) throw new Error(res.error || 'Could not load admin-visible organizations.');
        return normalizeOrganizations(res.data, { platformAdmin: true });
    }
    const res = await apiListOrganizations({ limit: 100 });
    if (!res.ok) throw new Error(res.error || 'Could not load organizations.');
    return normalizeOrganizations(res.data, { platformAdmin: false });
}

function renderPicker() {
    if (!$picker || !$pickerWrap) return;
    $picker.textContent = '';
    if (eligibleOrganizations.length !== 1) {
        $picker.append(new Option('Select organization', ''));
    }
    for (const org of eligibleOrganizations) {
        $picker.append(new Option(org.name, org.id));
    }
    $picker.value = selectedOrganizationId || '';
    $pickerWrap.hidden = eligibleOrganizations.length <= 1 && Boolean(selectedOrganizationId);
}

function summaryCard(label, value) {
    const card = document.createElement('article');
    card.className = 'credits-card organization-card';
    const title = document.createElement('div');
    title.className = 'credits-card__label';
    title.textContent = label;
    const amount = document.createElement('div');
    amount.className = 'credits-card__value';
    amount.textContent = value;
    card.append(title, amount);
    return card;
}

function renderSummary(dashboard = {}) {
    if (!$summaryGrid) return;
    const balance = dashboard.balance || {};
    const access = dashboard.access || {};
    $summaryGrid.textContent = '';
    $summaryGrid.append(
        summaryCard('Current balance', formatCredits(balance.current)),
        summaryCard('Available', formatCredits(balance.available)),
        summaryCard('Reserved', formatCredits(balance.reserved)),
        summaryCard('Platform admin', access.platformAdmin ? 'yes' : 'no'),
        summaryCard('Organization role', access.organizationRole || 'none'),
        summaryCard('Admin image tests', access.canUseAdminImageTests ? 'available' : 'not available'),
    );
}

function renderRows(tbody, rows, columns, emptyText, colspan) {
    if (!tbody) return;
    tbody.textContent = '';
    if (!rows.length) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = colspan;
        cell.className = 'credits-empty';
        cell.textContent = emptyText;
        row.appendChild(cell);
        tbody.appendChild(row);
        return;
    }
    for (const item of rows) {
        const row = document.createElement('tr');
        for (const column of columns) {
            const cell = document.createElement('td');
            cell.textContent = column(item);
            row.appendChild(cell);
        }
        tbody.appendChild(row);
    }
}

function renderTables(dashboard = {}) {
    renderRows($ledgerBody, dashboard.recentLedger || [], [
        (item) => formatDate(item.createdAt),
        (item) => item.entryType || 'Not reported',
        (item) => item.source || 'Not reported',
        (item) => formatCredits(item.amount),
        (item) => formatCredits(item.balanceAfter),
    ], 'No recent credit ledger activity.', 5);

    renderRows($adminDebitsBody, dashboard.recentAdminImageTestDebits || [], [
        (item) => formatDate(item.createdAt),
        (item) => item.source || 'admin_ai_image_test',
        (item) => formatCredits(item.amount),
        (item) => formatCredits(item.balanceAfter),
    ], 'No recent admin image-test debits for this organization.', 4);

    renderRows($membersBody, dashboard.members || [], [
        (item) => item.email || item.userId || 'Not reported',
        (item) => item.role || 'Not reported',
        (item) => item.status || 'Not reported',
        (item) => formatDate(item.createdAt),
    ], 'No active members reported.', 4);
}

function renderNeedsSelection() {
    hide($loading);
    hide($error);
    hide($denied);
    show($dashboard);
    if ($name) $name.textContent = 'Select an organization';
    if ($access) $access.textContent = 'Choose an active organization to inspect its credits, members, and role context.';
    if ($warning) hide($warning);
    renderPicker();
    renderSummary({});
    renderTables({});
}

function renderDashboard(dashboard = {}) {
    hide($loading);
    hide($error);
    hide($denied);
    show($dashboard);
    renderPicker();
    const org = dashboard.organization || {};
    const access = dashboard.access || {};
    if ($name) $name.textContent = org.name || org.id || 'Organization';
    if ($access) {
        $access.textContent = `Platform admin: ${access.platformAdmin ? 'yes' : 'no'} · Organization role: ${access.organizationRole || 'none'} · Organization id: ${org.id || 'not reported'}`;
    }
    const warning = Array.isArray(dashboard.warnings) ? dashboard.warnings[0] : null;
    if ($warning) {
        if (warning?.message) {
            $warning.textContent = warning.message;
            show($warning);
        } else {
            hide($warning);
        }
    }
    renderSummary(dashboard);
    renderTables(dashboard);
}

async function loadDashboard() {
    if (!selectedOrganizationId) return renderNeedsSelection();
    hide($denied);
    hide($error);
    show($loading);
    const res = await apiOrganizationDashboard(selectedOrganizationId, { limit: 25 });
    if (!res.ok) {
        if (res.status === 401 || res.status === 403 || res.status === 404) return setDenied();
        return setError(res.error || 'Organization dashboard is unavailable.');
    }
    renderDashboard(res.data?.dashboard || {});
}

async function init() {
    try { initSiteHeader(); } catch (error) { console.warn(error); }
    try { initCookieConsent(); } catch (error) { console.warn(error); }

    const me = await apiGetMe();
    if (!me.ok || !me.data?.loggedIn) return setDenied();
    currentUser = me.data.user || {};

    try {
        eligibleOrganizations = await loadEligibleOrganizations();
    } catch (error) {
        return setError(error?.message || 'Could not load organization access.');
    }
    if (!eligibleOrganizations.length) return setDenied();
    selectedOrganizationId = resolveActiveOrganizationId(eligibleOrganizations);
    if (!selectedOrganizationId) return renderNeedsSelection();
    await loadDashboard();
}

$picker?.addEventListener('change', async () => {
    selectedOrganizationId = $picker.value;
    if (selectedOrganizationId) setActiveOrganizationId(selectedOrganizationId);
    else clearActiveOrganizationId();
    await loadDashboard();
});

init().catch((error) => {
    console.warn(error);
    setError('Organization dashboard failed to load.');
});
