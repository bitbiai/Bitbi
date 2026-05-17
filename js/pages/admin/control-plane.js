/* ============================================================
   BITBI — Admin Control Plane
   Safe frontend-only surfaces for implemented admin APIs.
   ============================================================ */

import {
    apiAdminAiBudgetSwitches,
    apiAdminAiCleanupUsageAttempts,
    apiAdminAiListFailedVideoJobs,
    apiAdminAiListVideoJobPoisonMessages,
    apiAdminAiPlatformBudgetCaps,
    apiAdminAiPlatformBudgetEvidenceArchives,
    apiAdminAiPlatformBudgetReconciliation,
    apiAdminAiPlatformBudgetRepairReport,
    apiAdminAiPlatformBudgetRepairReportExport,
    apiAdminAiPlatformBudgetUsage,
    apiAdminAiCleanupExpiredPlatformBudgetEvidenceArchives,
    apiAdminAiCreatePlatformBudgetEvidenceArchive,
    apiAdminAiDownloadPlatformBudgetEvidenceArchive,
    apiAdminAiExpirePlatformBudgetEvidenceArchive,
    apiAdminAiRepairPlatformBudgetCandidate,
    apiAdminAiUpdatePlatformBudgetCap,
    apiAdminAiUpdateBudgetSwitch,
    apiAdminAiUsageAttempt,
    apiAdminAiUsageAttempts,
    apiAdminBillingEvent,
    apiAdminBillingEvents,
    apiAdminBillingPlans,
    apiAdminBillingReconciliation,
    apiAdminBillingReview,
    apiAdminBillingReviews,
    apiAdminResolveBillingReview,
    apiAdminDataLifecycleArchives,
    apiAdminDataLifecycleRequests,
    apiAdminGrantOrganizationCredits,
    apiAdminGrantUserCredits,
    apiAdminOrganization,
    apiAdminOrganizationBilling,
    apiAdminOrganizations,
    apiAdminUsers,
    apiAdminUserBilling,
} from '../../shared/auth-api.js?v=__ASSET_VERSION__';

const CONTROL_SECTIONS = new Set([
    'dashboard',
    'security',
    'orgs',
    'billing',
    'billing-events',
    'ai-usage',
    'ai-budget-switches',
    'lifecycle',
    'operations',
    'readiness',
    'settings',
]);

const FEATURE_BADGES = {
    'ai.image.generate': ['AI Image', 'user'],
    'ai.text.generate': ['AI Text', 'user'],
    'ai.video.generate': ['AI Video', 'legacy'],
};

const STATUS_VARIANTS = {
    active: 'active',
    succeeded: 'active',
    finalized: 'active',
    completed: 'active',
    granted: 'active',
    planned: 'legacy',
    received: 'user',
    ignored: 'legacy',
    pending: 'legacy',
    reserved: 'legacy',
    failed: 'disabled',
    disabled: 'disabled',
    expired: 'disabled',
};

const SENSITIVE_KEY_PATTERN = /secret|token|password|hash|signature|raw|payload|request_?fingerprint|idempotency|r2_?key|private_?key|mfa|recovery|webhook_?secret|stripe_?secret|service_?auth|card|payment_?method|credential|authorization|cookie|session/i;
const SENSITIVE_VALUE_PATTERN = /\b(?:sk_(?:live|test)|rk_(?:live|test)|whsec|Bearer\s+|Stripe-Signature|authorization=|secret=|token=|password=|pm_[A-Za-z0-9]|card=)[A-Za-z0-9_:=+./-]*/i;

function byId(id) {
    return document.getElementById(id);
}

function clear(node) {
    if (node) node.replaceChildren();
}

function appendText(parent, text) {
    parent.appendChild(document.createTextNode(text == null || text === '' ? '-' : String(text)));
}

function notReported(value) {
    return value == null || value === '' ? 'Not reported' : value;
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) appendText(node, text);
    return node;
}

function badge(label, variant = 'user') {
    const span = el('span', `badge badge--${variant}`);
    span.textContent = label || '-';
    return span;
}

function variantFor(value) {
    return STATUS_VARIANTS[String(value || '').toLowerCase()] || 'user';
}

function shortId(value) {
    const text = String(value || '');
    if (!text) return '-';
    if (text.length <= 18) return text;
    return `${text.slice(0, 10)}...${text.slice(-6)}`;
}

function isSensitiveKey(key) {
    return SENSITIVE_KEY_PATTERN.test(String(key || ''));
}

function safeSummaryValue(value) {
    if (value == null || value === '') return 'Not reported';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'Not reported';
    if (Array.isArray(value)) return `[${value.length} items]`;
    if (typeof value === 'object') return '[object summary]';
    const text = String(value);
    if (SENSITIVE_VALUE_PATTERN.test(text)) return '[redacted]';
    return text;
}

function effectiveSwitchVariant(value) {
    if (value === true || value === 'enabled') return 'active';
    if (value === false || value === 'disabled' || value === 'missing' || value === 'unavailable') return 'disabled';
    return 'legacy';
}

function createIdempotencyKey(prefix) {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${prefix}-${Date.now().toString(36)}-${token}`;
}

function setState(id, message, type = 'neutral') {
    const node = byId(id);
    if (!node) return;
    node.textContent = message || '';
    node.dataset.state = type;
}

function apiUnavailableMessage(response, fallback) {
    if (!response) return fallback;
    if (response.status === 404) return 'Capability unavailable in this environment.';
    if (response.status === 429) return 'Rate limit reached. Try again later.';
    if (response.status === 503) return 'Backend dependency is unavailable or fail-closed.';
    if (response.status === 401 || response.status === 403) return 'Admin access or MFA is required.';
    return response.error || fallback;
}

function capabilityStatus(response) {
    if (response?.ok) return { label: 'API available', variant: 'active' };
    if (response?.status === 404) return { label: 'Unavailable', variant: 'legacy' };
    if (response?.status === 429) return { label: 'Rate limited', variant: 'disabled' };
    if (response?.status === 503) return { label: 'Fail-closed', variant: 'disabled' };
    if (response?.status === 401 || response?.status === 403) return { label: 'Admin gated', variant: 'disabled' };
    return { label: 'Unknown', variant: 'legacy' };
}

function setSubmitting(button, submitting) {
    if (!button) return;
    button.disabled = !!submitting;
    button.dataset.busy = submitting ? 'true' : 'false';
}

function renderUnavailable(container, response, fallback = 'This capability is unavailable.') {
    if (!container) return;
    clear(container);
    const box = el('div', 'admin-shell__empty');
    const icon = el('span', 'admin-shell__empty-icon', '!');
    const copy = el('span', null, apiUnavailableMessage(response, fallback));
    box.append(icon, copy);
    container.appendChild(box);
}

function row(name, value, valueClass = 'admin-inventory__meta') {
    const item = el('div', 'admin-inventory__row');
    item.append(el('span', 'admin-inventory__name', name));
    const meta = el('span', valueClass);
    if (value instanceof Node) meta.appendChild(value);
    else appendText(meta, value);
    item.appendChild(meta);
    return item;
}

function detailRows(entries) {
    const list = el('div', 'admin-inventory');
    for (const [name, value] of entries) list.appendChild(row(name, value));
    return list;
}

function table(headers) {
    const wrap = el('div', 'admin-table-wrap');
    const tbl = el('table', 'admin-table');
    const thead = document.createElement('thead');
    const tr = document.createElement('tr');
    for (const header of headers) tr.appendChild(el('th', null, header));
    thead.appendChild(tr);
    tbl.appendChild(thead);
    tbl.appendChild(document.createElement('tbody'));
    wrap.appendChild(tbl);
    return { wrap, tbody: tbl.querySelector('tbody') };
}

function addCell(tr, value) {
    const td = document.createElement('td');
    if (value instanceof Node) td.appendChild(value);
    else appendText(td, value);
    tr.appendChild(td);
    return td;
}

function renderJsonSummary(value) {
    if (!value || typeof value !== 'object') return '-';
    const safeEntries = Object.entries(value).filter(([key]) => !isSensitiveKey(key));
    if (safeEntries.length === 0) return '-';
    return safeEntries
        .slice(0, 10)
        .map(([key, val]) => `${key}: ${safeSummaryValue(val)}`)
        .join(', ');
}

function renderCards(container, cards) {
    clear(container);
    const grid = el('div', 'admin-control-grid');
    for (const card of cards) {
        const item = el('article', 'admin-control-card glass glass-card reveal visible');
        const top = el('div', 'admin-control-card__top');
        const title = el('h3', 'admin-section-title', card.title);
        top.appendChild(title);
        if (card.badge) top.appendChild(badge(card.badge.label, card.badge.variant));
        item.appendChild(top);
        item.appendChild(el('p', 'admin-shell__desc', card.copy));
        if (card.meta) item.appendChild(detailRows(card.meta));
        if (card.href) {
            const link = el('a', 'btn-action', card.cta || 'Open');
            link.href = card.href;
            item.appendChild(link);
        }
        grid.appendChild(item);
    }
    container.appendChild(grid);
}

async function capabilityProbe(label, call) {
    const result = await call();
    const status = capabilityStatus(result);
    return {
        label,
        ok: result.ok,
        status: status.label,
        variant: status.variant,
    };
}

export function createAdminControlPlane({ showToast, formatDate }) {
    const loaded = new Set();
    const billingTargets = {
        orgLookup: null,
        userLookup: null,
        orgGrant: null,
        userGrant: null,
    };
    let selectedBillingReviewId = '';
    let billingReviewResolutionSubmitting = false;

    function notify(message, type = 'success') {
        if (typeof showToast === 'function') showToast(message, type);
    }

    function normalizeLookupValue(value) {
        return String(value || '').trim().toLowerCase();
    }

    function orgDisplayName(org) {
        return org?.name || org?.companyName || org?.company_name || org?.slug || 'Organization';
    }

    function userDisplayEmail(user) {
        return user?.email || user?.userEmail || user?.user_email || '';
    }

    function clearLookupMatches(id) {
        clear(byId(id));
    }

    function renderLookupMatches(holderId, items, labelFn, onSelect) {
        const holder = byId(holderId);
        if (!holder) return;
        clear(holder);
        if (!items.length) return;
        const row = el('div', 'admin-control-chip-row');
        for (const item of items.slice(0, 8)) {
            const button = el('button', 'btn-action', labelFn(item));
            button.type = 'button';
            button.addEventListener('click', () => onSelect(item));
            row.appendChild(button);
        }
        holder.appendChild(row);
    }

    function rememberLookupTarget({ key, inputId, matchesId, target, label, stateId, message }) {
        billingTargets[key] = target;
        const input = byId(inputId);
        if (input) input.value = label;
        clearLookupMatches(matchesId);
        if (stateId && message) setState(stateId, message);
    }

    function matchingStoredTarget({ key, inputId, labelFn }) {
        const inputValue = normalizeLookupValue(byId(inputId)?.value);
        const target = billingTargets[key];
        if (!inputValue || !target) return null;
        return normalizeLookupValue(labelFn(target)) === inputValue ? target : null;
    }

    async function resolveOrganizationByName({ inputId, matchesId, stateId, key, onSelect }) {
        const existing = matchingStoredTarget({ key, inputId, labelFn: orgDisplayName });
        if (existing) return existing;
        const search = byId(inputId)?.value.trim();
        billingTargets[key] = null;
        clearLookupMatches(matchesId);
        if (!search) {
            setState(stateId, 'Enter an organization name to continue.', 'error');
            return null;
        }
        setState(stateId, 'Finding organization...');
        const res = await apiAdminOrganizations({ search, limit: 10 });
        if (!res.ok) {
            setState(stateId, apiUnavailableMessage(res, 'Organization lookup failed.'), 'error');
            return null;
        }
        const orgs = Array.isArray(res.data?.organizations) ? res.data.organizations : [];
        if (orgs.length === 0) {
            setState(stateId, 'No organization found by that name.', 'error');
            return null;
        }
        const normalizedSearch = normalizeLookupValue(search);
        const exactMatches = orgs.filter((org) => (
            normalizeLookupValue(orgDisplayName(org)) === normalizedSearch
            || normalizeLookupValue(org.slug) === normalizedSearch
        ));
        const chosen = exactMatches.length === 1 ? exactMatches[0] : (orgs.length === 1 ? orgs[0] : null);
        if (chosen) {
            rememberLookupTarget({
                key,
                inputId,
                matchesId,
                target: chosen,
                label: orgDisplayName(chosen),
                stateId,
                message: 'Organization selected.',
            });
            return chosen;
        }
        renderLookupMatches(
            matchesId,
            orgs,
            (org) => [orgDisplayName(org), org.createdByEmail ? `created by ${org.createdByEmail}` : org.slug]
                .filter(Boolean)
                .join(' - '),
            (org) => {
                rememberLookupTarget({
                    key,
                    inputId,
                    matchesId,
                    target: org,
                    label: orgDisplayName(org),
                    stateId,
                    message: 'Organization selected.',
                });
                if (typeof onSelect === 'function') onSelect(org);
            },
        );
        setState(stateId, 'Multiple organizations matched. Select one result.', 'error');
        return null;
    }

    async function resolveUserByEmail({ inputId, matchesId, stateId, key, onSelect }) {
        const existing = matchingStoredTarget({ key, inputId, labelFn: userDisplayEmail });
        if (existing) return existing;
        const search = byId(inputId)?.value.trim();
        billingTargets[key] = null;
        clearLookupMatches(matchesId);
        if (!search) {
            setState(stateId, 'Enter a user email address to continue.', 'error');
            return null;
        }
        setState(stateId, 'Finding user...');
        const res = await apiAdminUsers(search, { limit: 10 });
        if (!res.ok) {
            setState(stateId, apiUnavailableMessage(res, 'User lookup failed.'), 'error');
            return null;
        }
        const users = Array.isArray(res.data?.users) ? res.data.users : [];
        if (users.length === 0) {
            setState(stateId, 'No user found by that email.', 'error');
            return null;
        }
        const normalizedSearch = normalizeLookupValue(search);
        const exactMatches = users.filter((user) => normalizeLookupValue(userDisplayEmail(user)) === normalizedSearch);
        const chosen = exactMatches.length === 1 ? exactMatches[0] : (users.length === 1 ? users[0] : null);
        if (chosen) {
            rememberLookupTarget({
                key,
                inputId,
                matchesId,
                target: chosen,
                label: userDisplayEmail(chosen),
                stateId,
                message: 'User selected.',
            });
            return chosen;
        }
        renderLookupMatches(
            matchesId,
            users,
            (user) => userDisplayEmail(user) || 'User without email',
            (user) => {
                rememberLookupTarget({
                    key,
                    inputId,
                    matchesId,
                    target: user,
                    label: userDisplayEmail(user),
                    stateId,
                    message: 'User selected.',
                });
                if (typeof onSelect === 'function') onSelect(user);
            },
        );
        setState(stateId, 'Multiple users matched. Select one email.', 'error');
        return null;
    }

    async function loadCommandCenter() {
        const container = byId('controlPlaneCapabilityGrid');
        if (!container) return;
        clear(container);
        container.appendChild(el('div', 'admin-state', 'Checking implemented admin capabilities...'));

        const probes = await Promise.all([
            capabilityProbe('Organizations', () => apiAdminOrganizations({ limit: 1 })),
            capabilityProbe('Billing plans', () => apiAdminBillingPlans()),
            capabilityProbe('Billing events', () => apiAdminBillingEvents({ limit: 1 })),
            capabilityProbe('AI usage attempts', () => apiAdminAiUsageAttempts({ limit: 1 })),
            capabilityProbe('Data lifecycle', () => apiAdminDataLifecycleRequests({ limit: 1 })),
            capabilityProbe('Export archives', () => apiAdminDataLifecycleArchives({ limit: 1 })),
        ]);

        renderCards(container, [
            {
                title: 'Security & Policy',
                badge: { label: 'Repo-enforced', variant: 'active' },
                copy: 'Route policy, body parser, secret scan, fail-closed limiter, MFA, service auth, and replay protections are implemented and validated by CI/preflight.',
                href: '#security',
                cta: 'Review posture',
            },
            {
                title: 'Organizations / RBAC',
                badge: { label: probes[0].status, variant: probes[0].variant },
                copy: 'Inspect organizations, active memberships, roles, and tenant-readiness boundaries when the admin API responds. This is not live tenant isolation proof.',
                href: '#orgs',
            },
            {
                title: 'Billing / Credits',
                badge: { label: probes[1].status, variant: probes[1].variant },
                copy: 'Review plan entitlements, organization and member credit balances, and perform confirmed manual credit grants. Live payment activation remains disabled.',
                href: '#billing',
            },
            {
                title: 'Billing Events / Stripe',
                badge: { label: probes[2].status, variant: probes[2].variant },
                copy: 'Inspect sanitized provider events, operator-only live Stripe review records, and read-only local reconciliation signals. Automated remediation, credit clawback, and Stripe actions remain disabled.',
                href: '#billing-events',
            },
            {
                title: 'AI Usage Attempts',
                badge: { label: probes[3].status, variant: probes[3].variant },
                copy: 'Inspect org-scoped image/text usage attempts, reservations, replay status, and cleanup dry-runs.',
                href: '#ai-usage',
            },
            {
                title: 'Data Lifecycle',
                badge: { label: probes[4].status, variant: probes[4].variant },
                copy: 'Inspect export/deletion/anonymization requests and private export archive metadata. Irreversible deletion remains unavailable in this UI.',
                href: '#lifecycle',
            },
            {
                title: 'Operational Readiness',
                badge: { label: 'Production blocked', variant: 'disabled' },
                copy: 'Release preflight is green, but live Cloudflare validation, migrations, and staging verification remain deployment prerequisites.',
                href: '#readiness',
            },
        ]);
    }

    function renderSecurity() {
        const container = byId('controlSecurity');
        if (!container) return;
        renderCards(container, [
            {
                title: 'Route Policy Registry',
                badge: { label: 'Repo checked', variant: 'active' },
                copy: 'High-risk auth-worker routes are registered and checked by npm run check:route-policies.',
                meta: [['Scope', 'Review/CI metadata, not a live dashboard signal']],
            },
            {
                title: 'Fail-Closed Limiters',
                badge: { label: 'Sensitive routes', variant: 'active' },
                copy: 'Auth, admin, AI, billing, lifecycle, and webhook mutation paths use fail-closed rate limiting where implemented.',
                meta: [['Live verification', 'Required in staging/production']],
            },
            {
                title: 'Admin MFA',
                badge: { label: 'Production gated', variant: 'active' },
                copy: 'Admin access is centrally MFA-gated in production and backed by durable failed-attempt state.',
                meta: [['Secrets', 'Managed by deployment configuration only']],
            },
            {
                title: 'Service Auth / Replay',
                badge: { label: 'HMAC + nonce', variant: 'active' },
                copy: 'Auth-to-AI service calls use HMAC authentication and Durable Object replay protection.',
                meta: [['Secret values', 'Never shown in this UI']],
            },
            {
                title: 'Production Readiness',
                badge: { label: 'Blocked', variant: 'disabled' },
                copy: 'This UI reflects repo/runtime API state. It does not prove live Cloudflare resources, migrations, WAF, headers, or Stripe endpoint readiness.',
                meta: [['Required checks', 'Staging verification and live prereq validation']],
            },
        ]);
    }

    async function loadOrgs() {
        const state = byId('orgsState');
        const list = byId('orgsList');
        setState('orgsState', 'Loading organizations...');
        clear(list);
        const res = await apiAdminOrganizations({ limit: 50 });
        if (!res.ok) {
            setState('orgsState', '');
            renderUnavailable(list, res, 'Organizations API unavailable.');
            return;
        }
        const orgs = Array.isArray(res.data?.organizations) ? res.data.organizations : [];
        if (orgs.length === 0) {
            setState('orgsState', 'No organizations found.');
            return;
        }
        setState('orgsState', `Showing ${orgs.length} organizations.`);
        const { wrap, tbody } = table(['Organization', 'Status', 'Members', 'Created by', 'Created', 'Actions']);
        for (const org of orgs) {
            const tr = document.createElement('tr');
            addCell(tr, org.name || shortId(org.id));
            addCell(tr, badge(org.status || 'unknown', variantFor(org.status)));
            addCell(tr, org.memberCount ?? org.member_count ?? '-');
            addCell(tr, org.createdByEmail || '-');
            addCell(tr, formatDate(org.createdAt || org.created_at));
            const action = document.createElement('button');
            action.type = 'button';
            action.className = 'btn-action';
            action.textContent = 'Inspect';
            action.addEventListener('click', () => loadOrgDetail(org.id));
            addCell(tr, action);
            tbody.appendChild(tr);
        }
        clear(list);
        list.appendChild(wrap);
    }

    async function loadOrgDetail(orgId) {
        const detail = byId('orgDetail');
        if (!detail) return;
        detail.hidden = false;
        detail.textContent = 'Loading organization detail...';
        const res = await apiAdminOrganization(orgId);
        clear(detail);
        if (!res.ok) {
            renderUnavailable(detail, res, 'Organization detail unavailable.');
            return;
        }
        const org = res.data?.organization || {};
        detail.appendChild(el('h3', 'admin-section-title', org.name || 'Organization Detail'));
        detail.appendChild(detailRows([
            ['Organization ID', shortId(org.id)],
            ['Status', notReported(org.status)],
            ['Slug', notReported(org.slug)],
            ['Created by', notReported(org.createdByEmail)],
            ['Created', formatDate(org.createdAt || org.created_at)],
        ]));
        const members = Array.isArray(res.data?.members) ? res.data.members : [];
        const { wrap, tbody } = table(['Email', 'Role', 'Status', 'Created']);
        for (const member of members) {
            const tr = document.createElement('tr');
            addCell(tr, member.email || shortId(member.userId || member.user_id));
            addCell(tr, badge(member.role, member.role === 'owner' || member.role === 'admin' ? 'admin' : 'user'));
            addCell(tr, badge(member.status, variantFor(member.status)));
            addCell(tr, formatDate(member.createdAt || member.created_at));
            tbody.appendChild(tr);
        }
        detail.appendChild(wrap);
    }

    async function loadBillingPlans() {
        const holder = byId('billingPlans');
        setState('billingPlansState', 'Loading plans...');
        clear(holder);
        const res = await apiAdminBillingPlans();
        if (!res.ok) {
            setState('billingPlansState', '');
            renderUnavailable(holder, res, 'Billing plan API unavailable.');
            return;
        }
        const plans = Array.isArray(res.data?.plans) ? res.data.plans : [];
        setState('billingPlansState', res.data?.livePaymentProviderEnabled === false
            ? 'Live payment provider disabled.'
            : 'Plan catalog loaded.');
        if (plans.length === 0) {
            renderUnavailable(holder, null, 'No plans found.');
            return;
        }
        const stack = el('div', 'admin-control-stack');
        for (const plan of plans) {
            const card = el('article', 'admin-control-mini-card');
            const head = el('div', 'admin-control-card__top');
            head.append(el('strong', null, plan.name || plan.code), badge(plan.status || 'unknown', variantFor(plan.status)));
            card.appendChild(head);
            const entitlements = Array.isArray(plan.entitlements) ? plan.entitlements : [];
            card.appendChild(detailRows([
                ['Code', plan.code || '-'],
                ['Monthly credits', plan.monthlyCreditGrant ?? plan.monthly_credit_grant ?? '-'],
                ['Entitlements', entitlements.map((ent) => ent.featureKey || ent.feature_key || ent.key || ent.feature).filter(Boolean).join(', ') || '-'],
            ]));
            stack.appendChild(card);
        }
        holder.appendChild(stack);
    }

    async function loadOrgBilling(orgId, organization = null) {
        const state = byId('orgBillingState');
        const detail = byId('orgBillingDetail');
        clear(detail);
        if (!orgId) {
            setState('orgBillingState', 'Enter an organization name to inspect billing state.');
            return;
        }
        setState('orgBillingState', 'Loading organization billing...');
        const res = await apiAdminOrganizationBilling(orgId);
        if (!res.ok) {
            setState('orgBillingState', '');
            renderUnavailable(detail, res, 'Organization billing unavailable.');
            return;
        }
        const billing = res.data?.billing || {};
        setState('orgBillingState', 'Billing state loaded.');
        detail.appendChild(detailRows([
            ['Organization', orgDisplayName(organization) || '-'],
            ['Plan', billing.plan?.name || billing.planCode || billing.plan?.code || '-'],
            ['Credit balance', billing.creditBalance ?? billing.balance ?? '-'],
            ['Live payments', 'Disabled'],
        ]));
        const entitlements = Array.isArray(billing.entitlements)
            ? billing.entitlements
            : Object.entries(billing.entitlements || {}).map(([feature, value]) => ({ feature, value }));
        if (entitlements.length > 0) {
            const chips = el('div', 'admin-control-chip-row');
            for (const ent of entitlements.slice(0, 16)) {
            const feature = ent.featureKey || ent.feature_key || ent.feature || ent[0];
            if (feature && !isSensitiveKey(feature)) chips.appendChild(badge(feature, 'user'));
        }
            detail.appendChild(chips);
        }
    }

    async function loadUserBilling(userId, user = null) {
        const detail = byId('userBillingDetail');
        clear(detail);
        if (!userId) {
            setState('userBillingState', 'Enter a user email to inspect member credit state.');
            return;
        }
        setState('userBillingState', 'Loading user billing...');
        const res = await apiAdminUserBilling(userId);
        if (!res.ok) {
            setState('userBillingState', '');
            renderUnavailable(detail, res, 'User billing unavailable.');
            return;
        }
        const billing = res.data?.billing || {};
        setState('userBillingState', 'User billing state loaded.');
        detail.appendChild(detailRows([
            ['User email', billing.email || userDisplayEmail(user) || '-'],
            ['Role', billing.role || '-'],
            ['Status', billing.status || '-'],
            ['Credit balance', billing.creditBalance ?? '-'],
            ['Daily top-up target', billing.dailyCreditAllowance ?? '-'],
        ]));
    }

    async function handleCreditGrant(event) {
        event.preventDefault();
        const submitButton = event.submitter;
        const org = await resolveOrganizationByName({
            inputId: 'creditGrantOrgSearch',
            matchesId: 'creditGrantOrgMatches',
            stateId: 'creditGrantResult',
            key: 'orgGrant',
        });
        const amount = Number(byId('creditGrantAmount')?.value);
        const reason = byId('creditGrantReason')?.value.trim();
        if (!org || !org.id || !Number.isInteger(amount) || amount <= 0 || !reason) {
            setState('creditGrantResult', 'Organization name, positive credit amount, and reason are required.', 'error');
            return;
        }
        if (!confirm(`Grant ${amount} credits to ${orgDisplayName(org)}? This creates a credit ledger entry.`)) {
            return;
        }
        const idempotencyKey = createIdempotencyKey('admin-credit-grant');
        setState('creditGrantResult', 'Submitting credit grant...');
        setSubmitting(submitButton, true);
        try {
            const res = await apiAdminGrantOrganizationCredits(org.id, { amount, reason, idempotencyKey });
            if (!res.ok) {
                setState('creditGrantResult', apiUnavailableMessage(res, 'Credit grant failed.'), 'error');
                notify('Credit grant failed.', 'error');
                return;
            }
            const balance = res.data?.ledgerEntry?.balanceAfter ?? res.data?.ledgerEntry?.balance_after ?? '-';
            setState('creditGrantResult', `Credit grant recorded for ${orgDisplayName(org)}. Balance after: ${balance}.`, 'success');
            notify('Credit grant recorded.', 'success');
            const lookup = byId('orgBillingSearch');
            if (lookup) lookup.value = orgDisplayName(org);
            billingTargets.orgLookup = org;
            loadOrgBilling(org.id, org);
        } finally {
            setSubmitting(submitButton, false);
        }
    }

    async function handleUserCreditGrant(event) {
        event.preventDefault();
        const submitButton = event.submitter;
        const user = await resolveUserByEmail({
            inputId: 'creditGrantUserSearch',
            matchesId: 'creditGrantUserMatches',
            stateId: 'userCreditGrantResult',
            key: 'userGrant',
        });
        const amount = Number(byId('userCreditGrantAmount')?.value);
        const reason = byId('userCreditGrantReason')?.value.trim();
        if (!user || !user.id || !Number.isInteger(amount) || amount <= 0 || !reason) {
            setState('userCreditGrantResult', 'User email, positive credit amount, and reason are required.', 'error');
            return;
        }
        if (!confirm(`Grant ${amount} credits to ${userDisplayEmail(user)}? This creates a member credit ledger entry.`)) {
            return;
        }
        const idempotencyKey = createIdempotencyKey('admin-user-credit-grant');
        setState('userCreditGrantResult', 'Submitting user credit grant...');
        setSubmitting(submitButton, true);
        try {
            const res = await apiAdminGrantUserCredits(user.id, { amount, reason, idempotencyKey });
            if (!res.ok) {
                setState('userCreditGrantResult', apiUnavailableMessage(res, 'User credit grant failed.'), 'error');
                notify('User credit grant failed.', 'error');
                return;
            }
            const balance = res.data?.ledgerEntry?.balanceAfter ?? res.data?.ledgerEntry?.balance_after ?? '-';
            setState('userCreditGrantResult', `User credit grant recorded for ${userDisplayEmail(user)}. Balance after: ${balance}.`, 'success');
            notify('User credit grant recorded.', 'success');
            const lookup = byId('userBillingSearch');
            if (lookup) lookup.value = userDisplayEmail(user);
            billingTargets.userLookup = user;
            loadUserBilling(user.id, user);
        } finally {
            setSubmitting(submitButton, false);
        }
    }

    async function loadBillingEvents() {
        const provider = byId('billingEventsProvider')?.value || '';
        const status = byId('billingEventsStatus')?.value || '';
        const list = byId('billingEventsList');
        setState('billingEventsState', 'Loading billing events...');
        clear(list);
        const res = await apiAdminBillingEvents({ provider, status, limit: 25 });
        if (!res.ok) {
            setState('billingEventsState', '');
            renderUnavailable(list, res, 'Billing events unavailable.');
            return;
        }
        const events = Array.isArray(res.data?.events) ? res.data.events : [];
        if (events.length === 0) {
            setState('billingEventsState', 'No billing events found.');
            return;
        }
        setState('billingEventsState', `Showing ${events.length} sanitized events. Live payments disabled.`);
        const { wrap, tbody } = table(['Provider', 'Mode', 'Type', 'Status', 'Organization', 'Received', 'Actions']);
        for (const event of events) {
            const tr = document.createElement('tr');
            addCell(tr, event.provider || '-');
            addCell(tr, badge(event.providerMode || '-', event.providerMode === 'live' ? 'disabled' : 'user'));
            addCell(tr, event.eventType || '-');
            addCell(tr, badge(event.processingStatus || '-', variantFor(event.processingStatus)));
            addCell(tr, shortId(event.organizationId));
            addCell(tr, formatDate(event.receivedAt));
            const btn = el('button', 'btn-action', 'Inspect');
            btn.type = 'button';
            btn.addEventListener('click', () => loadBillingEventDetail(event.id));
            addCell(tr, btn);
            tbody.appendChild(tr);
        }
        list.appendChild(wrap);
    }

    async function loadBillingEventDetail(eventId) {
        const detail = byId('billingEventDetail');
        detail.hidden = false;
        detail.textContent = 'Loading billing event detail...';
        const res = await apiAdminBillingEvent(eventId);
        clear(detail);
        if (!res.ok) {
            renderUnavailable(detail, res, 'Billing event detail unavailable.');
            return;
        }
        const event = res.data?.event || {};
        detail.appendChild(el('h3', 'admin-section-title', 'Billing Event Detail'));
        detail.appendChild(detailRows([
            ['Event ID', shortId(event.id)],
            ['Provider', event.provider || '-'],
            ['Mode', event.providerMode || '-'],
            ['Type', event.eventType || '-'],
            ['Processing', event.processingStatus || '-'],
            ['Verification', event.verificationStatus || '-'],
            ['Organization', shortId(event.organizationId)],
            ['Received', formatDate(event.receivedAt)],
            ['Summary', renderJsonSummary(event.payloadSummary)],
        ]));
        if (Array.isArray(event.actions) && event.actions.length) {
            const { wrap, tbody } = table(['Action', 'Status', 'Dry-run', 'Summary']);
            for (const action of event.actions) {
                const tr = document.createElement('tr');
                addCell(tr, action.actionType || '-');
                addCell(tr, badge(action.status || '-', variantFor(action.status)));
                addCell(tr, action.dryRun ? 'Yes' : 'No');
                addCell(tr, renderJsonSummary(action.summary));
                tbody.appendChild(tr);
            }
            detail.appendChild(wrap);
        }
    }

    function reconciliationSeverityVariant(severity) {
        const value = String(severity || '').toLowerCase();
        if (value === 'critical') return 'disabled';
        if (value === 'warning') return 'legacy';
        return 'user';
    }

    function renderReconciliationSummaryCard(title, badgeText, badgeVariant, meta) {
        const card = el('article', 'admin-control-card glass glass-card reveal visible');
        const top = el('div', 'admin-control-card__top');
        top.appendChild(el('h3', 'admin-section-title', title));
        top.appendChild(badge(badgeText, badgeVariant));
        card.appendChild(top);
        card.appendChild(detailRows(meta));
        return card;
    }

    function appendReconciliationSection(container, section) {
        const article = el('article', 'admin-reconciliation-section glass glass-card');
        const header = el('div', 'admin-control-card__top');
        header.appendChild(el('h3', 'admin-section-title', section.title || section.id || 'Report Section'));
        header.appendChild(badge(section.severity || 'info', reconciliationSeverityVariant(section.severity)));
        article.appendChild(header);
        if (section.summary && typeof section.summary === 'object') {
            article.appendChild(el('p', 'admin-shell__desc', renderJsonSummary(section.summary)));
        }
        const items = Array.isArray(section.items) ? section.items : [];
        if (items.length === 0) {
            article.appendChild(el('p', 'admin-shell__empty', 'No local items reported in this section.'));
        } else {
            const list = el('div', 'admin-reconciliation-items');
            for (const item of items) {
                const rowNode = el('article', `admin-reconciliation-item admin-reconciliation-item--${item.severity || 'info'}`);
                const itemHeader = el('div', 'admin-reconciliation-item__header');
                itemHeader.appendChild(badge(item.severity || 'info', reconciliationSeverityVariant(item.severity)));
                itemHeader.appendChild(el('strong', null, item.title || 'Billing reconciliation item'));
                rowNode.appendChild(itemHeader);
                if (item.detail) rowNode.appendChild(el('p', 'admin-shell__desc', item.detail));
                const meta = [];
                if (item.count != null) meta.push(['Count', item.count]);
                if (item.refs && typeof item.refs === 'object') meta.push(['Safe refs', renderJsonSummary(item.refs)]);
                if (meta.length) rowNode.appendChild(detailRows(meta));
                list.appendChild(rowNode);
            }
            article.appendChild(list);
        }
        if (section.truncated) {
            article.appendChild(el('p', 'admin-shell__desc', 'Additional local findings were omitted from this bounded UI view.'));
        }
        container.appendChild(article);
    }

    async function loadBillingReconciliation() {
        const panel = byId('billingReconciliationPanel');
        setState('billingReconciliationState', 'Loading billing reconciliation...');
        clear(panel);
        const res = await apiAdminBillingReconciliation();
        if (!res.ok) {
            setState('billingReconciliationState', '');
            renderUnavailable(panel, res, 'Billing reconciliation report unavailable.');
            return;
        }
        const report = res.data || {};
        const summary = report.summary || {};
        const reviews = summary.reviews || {};
        const checkouts = summary.checkouts || {};
        const ledger = summary.creditLedger || {};
        const subscriptions = summary.subscriptions || {};
        setState(
            'billingReconciliationState',
            `Generated ${formatDate(report.generatedAt)} from local D1 only. Verdict remains ${String(report.verdict || 'blocked').toUpperCase()}.`
        );

        const overview = el('div', 'admin-reconciliation-overview');
        overview.appendChild(detailRows([
            ['Generated', formatDate(report.generatedAt)],
            ['Source', report.source || 'local_d1_only'],
            ['Production readiness', report.productionReadiness || 'blocked'],
            ['Live billing readiness', report.liveBillingReadiness || 'blocked'],
            ['Notes', Array.isArray(report.notes) ? report.notes.join(' ') : 'Read-only local report.'],
        ]));
        panel.appendChild(overview);

        const cards = el('div', 'admin-control-grid admin-reconciliation-summary');
        cards.appendChild(renderReconciliationSummaryCard('Risk Items', `${summary.criticalItems || 0} critical`, (summary.criticalItems || 0) > 0 ? 'disabled' : 'user', [
            ['Warnings', summary.warningItems || 0],
            ['Scan limit', summary.scanLimit || '-'],
        ]));
        cards.appendChild(renderReconciliationSummaryCard('Billing Reviews', `${reviews.blocked || 0} blocked`, (reviews.blocked || 0) > 0 ? 'disabled' : 'user', [
            ['Needs review', reviews.needsReview || 0],
            ['Stale unresolved', reviews.staleUnresolved || 0],
        ]));
        cards.appendChild(renderReconciliationSummaryCard('Checkouts', `${checkouts.completedWithoutLedger || 0} missing ledger`, (checkouts.completedWithoutLedger || 0) > 0 ? 'disabled' : 'user', [
            ['Ledger without event', checkouts.ledgerLinkedWithoutBillingEvent || 0],
            ['Org statuses', renderJsonSummary(checkouts.organizationLiveCreditPackByStatus)],
        ]));
        cards.appendChild(renderReconciliationSummaryCard('Ledger / Subscriptions', `${ledger.negativeBalances || 0} negative`, (ledger.negativeBalances || 0) > 0 ? 'disabled' : 'user', [
            ['Missing usage ledger', ledger.usageEventsMissingLedger || 0],
            ['Active subscriptions without top-up', subscriptions.activeWithoutTopUpMarker || 0],
        ]));
        panel.appendChild(cards);

        const safety = el('p', 'admin-shell__desc admin-reconciliation-safety', 'Read-only operator report: no Stripe API calls, no refunds, no credit reversal, no subscription cancellation, and no automatic remediation are available from this panel.');
        panel.appendChild(safety);

        const sections = Array.isArray(report.sections) ? report.sections : [];
        if (sections.length === 0) {
            panel.appendChild(el('div', 'admin-shell__empty', 'No reconciliation sections were returned.'));
            return;
        }
        for (const section of sections) appendReconciliationSection(panel, section);
    }

    function reviewStateLabel(value) {
        return String(value || 'unknown').replace(/_/g, ' ');
    }

    function reviewStateVariant(value) {
        const state = String(value || '').toLowerCase();
        if (state === 'resolved') return 'active';
        if (state === 'blocked') return 'disabled';
        if (state === 'dismissed' || state === 'informational') return 'legacy';
        return 'user';
    }

    function isFinalReviewState(value) {
        const state = String(value || '').toLowerCase();
        return state === 'resolved' || state === 'dismissed';
    }

    function isBlockedReview(review) {
        return String(review?.reviewState || '').toLowerCase() === 'blocked'
            || /dispute/i.test(String(review?.eventType || ''));
    }

    function renderSafeIdentifiers(identifiers) {
        if (!identifiers || typeof identifiers !== 'object' || Array.isArray(identifiers)) return '-';
        const safeEntries = Object.entries(identifiers)
            .filter(([key, value]) => !isSensitiveKey(key) && value != null && value !== '')
            .slice(0, 12);
        if (safeEntries.length === 0) return '-';
        return safeEntries.map(([key, value]) => `${key}: ${safeSummaryValue(value)}`).join(', ');
    }

    function appendBlockedReviewWarning(container, review) {
        if (!isBlockedReview(review)) return;
        const warning = el('div', 'admin-billing-review-warning');
        warning.setAttribute('role', 'alert');
        warning.textContent = review.warning
            || 'Blocked dispute lifecycle event: operator review is required. Do not claim live billing readiness from this UI.';
        container.appendChild(warning);
    }

    function appendBillingReviewResolutionForm(container, review) {
        if (!review?.id || isFinalReviewState(review.reviewState)) return;
        const form = el('form', 'admin-billing-review-resolution');
        form.id = 'billingReviewResolutionForm';

        const safety = el('p', 'admin-shell__desc', 'Resolution records operator review metadata only. It does not adjust credits, call Stripe, refund payments, claw back credits, cancel subscriptions, or reconcile chargebacks.');
        const noteField = el('label', 'admin-ai__field');
        noteField.appendChild(el('span', 'admin-ai__label', 'Resolution note'));
        const note = document.createElement('textarea');
        note.id = 'billingReviewResolutionNote';
        note.className = 'admin-ai__textarea';
        note.rows = 3;
        note.maxLength = 1000;
        note.setAttribute('aria-required', 'true');
        note.placeholder = 'Summarize the human review decision and any external accounting/support follow-up.';
        noteField.appendChild(note);

        const confirmationField = el('label', 'admin-ai__field admin-ai__field--inline admin-billing-review-confirm');
        const checkbox = document.createElement('input');
        checkbox.id = 'billingReviewResolutionConfirm';
        checkbox.type = 'checkbox';
        checkbox.setAttribute('aria-required', 'true');
        confirmationField.appendChild(checkbox);
        confirmationField.appendChild(el('span', null, 'I confirm this records review metadata only and does not perform payment, credit, account, or Stripe remediation.'));

        const result = el('div', 'admin-state');
        result.id = 'billingReviewResolutionState';
        result.setAttribute('aria-live', 'polite');

        const actions = el('div', 'admin-billing-review-actions');
        for (const [status, label] of [['resolved', 'Mark Resolved'], ['dismissed', 'Mark Dismissed']]) {
            const button = el('button', 'btn-action', label);
            button.type = 'submit';
            button.dataset.resolutionStatus = status;
            actions.appendChild(button);
        }

        form.append(safety, noteField, confirmationField, actions, result);
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const resolutionStatus = event.submitter?.dataset?.resolutionStatus || '';
            const resolutionNote = note.value.trim();
            if (billingReviewResolutionSubmitting) return;
            if (!resolutionNote || !checkbox.checked) {
                result.dataset.state = 'error';
                result.textContent = 'Resolution note and confirmation are required.';
                return;
            }
            billingReviewResolutionSubmitting = true;
            form.querySelectorAll('button').forEach((button) => setSubmitting(button, true));
            result.dataset.state = 'neutral';
            result.textContent = 'Recording review resolution...';
            try {
                const res = await apiAdminResolveBillingReview(review.id, {
                    resolutionStatus,
                    resolutionNote,
                    idempotencyKey: createIdempotencyKey('billing-review-resolution'),
                });
                if (!res.ok) {
                    result.dataset.state = 'error';
                    result.textContent = apiUnavailableMessage(res, 'Billing review resolution failed.');
                    notify('Billing review resolution failed.', 'error');
                    return;
                }
                result.dataset.state = 'success';
                result.textContent = res.data?.reused
                    ? 'Billing review resolution was already recorded for this request.'
                    : 'Billing review resolution recorded.';
                notify('Billing review resolution recorded.', 'success');
                selectedBillingReviewId = res.data?.review?.id || review.id;
                await loadBillingReviews();
                await loadBillingReviewDetail(selectedBillingReviewId);
            } finally {
                billingReviewResolutionSubmitting = false;
                form.querySelectorAll('button').forEach((button) => setSubmitting(button, false));
            }
        });
        container.appendChild(form);
    }

    async function loadBillingReviews() {
        const reviewState = byId('billingReviewsStateFilter')?.value || '';
        const providerMode = byId('billingReviewsProviderMode')?.value || 'live';
        const eventType = byId('billingReviewsEventType')?.value.trim() || '';
        const list = byId('billingReviewsList');
        setState('billingReviewsState', 'Loading billing reviews...');
        clear(list);
        const res = await apiAdminBillingReviews({
            reviewState,
            provider: 'stripe',
            providerMode,
            eventType,
            limit: 25,
        });
        if (!res.ok) {
            setState('billingReviewsState', '');
            renderUnavailable(list, res, 'Billing review queue unavailable.');
            return;
        }
        const reviews = Array.isArray(res.data?.reviews) ? res.data.reviews : [];
        if (reviews.length === 0) {
            setState('billingReviewsState', 'No billing review events found for the selected filters.');
            return;
        }
        setState('billingReviewsState', `Showing ${reviews.length} sanitized billing review event${reviews.length === 1 ? '' : 's'}.`);
        const { wrap, tbody } = table(['State', 'Type', 'Provider', 'Mode', 'Provider event', 'Received', 'Recommended action', 'Actions']);
        wrap.classList.add('admin-billing-review-table');
        for (const review of reviews) {
            const tr = document.createElement('tr');
            if (isBlockedReview(review)) tr.classList.add('admin-billing-review-row--blocked');
            addCell(tr, badge(reviewStateLabel(review.reviewState), reviewStateVariant(review.reviewState)));
            addCell(tr, review.eventType || '-');
            addCell(tr, review.provider || '-');
            addCell(tr, badge(review.providerMode || '-', review.providerMode === 'live' ? 'disabled' : 'user'));
            addCell(tr, shortId(review.providerEventId));
            addCell(tr, formatDate(review.receivedAt || review.createdAt));
            addCell(tr, review.recommendedAction || review.reviewReason || '-');
            const btn = el('button', 'btn-action', 'Inspect Review');
            btn.type = 'button';
            btn.addEventListener('click', () => {
                selectedBillingReviewId = review.id;
                loadBillingReviewDetail(review.id);
            });
            addCell(tr, btn);
            tbody.appendChild(tr);
        }
        list.appendChild(wrap);
    }

    async function loadBillingReviewDetail(reviewId) {
        const detail = byId('billingReviewDetail');
        if (!detail) return;
        detail.hidden = false;
        detail.textContent = 'Loading billing review detail...';
        const res = await apiAdminBillingReview(reviewId);
        clear(detail);
        if (!res.ok) {
            renderUnavailable(detail, res, 'Billing review detail unavailable.');
            return;
        }
        const review = res.data?.review || {};
        detail.appendChild(el('h3', 'admin-section-title', 'Billing Review Detail'));
        appendBlockedReviewWarning(detail, review);
        detail.appendChild(detailRows([
            ['Review state', reviewStateLabel(review.reviewState)],
            ['Review reason', review.reviewReason || '-'],
            ['Recommended action', review.recommendedAction || '-'],
            ['Event type', review.eventType || '-'],
            ['Provider', review.provider || '-'],
            ['Provider mode', review.providerMode || '-'],
            ['Provider event', shortId(review.providerEventId)],
            ['Processing', review.processingStatus || '-'],
            ['Action status', review.actionStatus || '-'],
            ['Side effects enabled', review.sideEffectsEnabled === true ? 'Yes' : 'No'],
            ['Operator review only', review.operatorReviewOnly === true ? 'Yes' : 'No'],
            ['Safe identifiers', renderSafeIdentifiers(review.safeIdentifiers)],
            ['Received', formatDate(review.receivedAt || review.createdAt)],
            ['Resolved at', review.resolvedAt ? formatDate(review.resolvedAt) : '-'],
            ['Resolution status', review.resolutionStatus || '-'],
            ['Resolution note', review.resolutionNote || '-'],
        ]));
        if (review.actionSummary && typeof review.actionSummary === 'object') {
            detail.appendChild(el('h3', 'admin-section-title', 'Action Summary'));
            detail.appendChild(detailRows([
                ['Credit mutation', review.actionSummary.creditMutation || 'none'],
                ['Credits granted', review.actionSummary.creditsGranted ?? 0],
                ['Credits reversed', review.actionSummary.creditsReversed ?? 0],
                ['Persisted checkout state', renderJsonSummary(review.actionSummary.persistedCheckoutState)],
            ]));
        }
        appendBillingReviewResolutionForm(detail, review);
    }

    async function loadAiAttempts() {
        const list = byId('aiAttemptsList');
        setState('aiAttemptsState', 'Loading usage attempts...');
        clear(list);
        const res = await apiAdminAiUsageAttempts({
            feature: byId('aiAttemptsFeature')?.value || undefined,
            status: byId('aiAttemptsStatus')?.value.trim() || undefined,
            organizationId: byId('aiAttemptsOrgId')?.value.trim() || undefined,
            limit: 25,
        });
        if (!res.ok) {
            setState('aiAttemptsState', '');
            renderUnavailable(list, res, 'AI usage attempts unavailable.');
            return;
        }
        const attempts = Array.isArray(res.data?.attempts) ? res.data.attempts : [];
        if (attempts.length === 0) {
            setState('aiAttemptsState', 'No AI usage attempts found.');
            return;
        }
        setState('aiAttemptsState', `Showing ${attempts.length} sanitized attempts.`);
        const { wrap, tbody } = table(['Feature', 'Status', 'Provider', 'Billing', 'Credits', 'Replay', 'Updated', 'Actions']);
        for (const attempt of attempts) {
            const tr = document.createElement('tr');
            const feature = FEATURE_BADGES[attempt.feature] || [attempt.feature || '-', 'user'];
            addCell(tr, badge(feature[0], feature[1]));
            addCell(tr, badge(attempt.status || '-', variantFor(attempt.status)));
            addCell(tr, attempt.providerStatus || '-');
            addCell(tr, attempt.billingStatus || '-');
            addCell(tr, attempt.creditCost ?? '-');
            addCell(tr, attempt.replay?.available ? 'Available' : (attempt.replay?.status || '-'));
            addCell(tr, formatDate(attempt.updatedAt));
            const btn = el('button', 'btn-action', 'Inspect');
            btn.type = 'button';
            btn.addEventListener('click', () => loadAiAttemptDetail(attempt.attemptId));
            addCell(tr, btn);
            tbody.appendChild(tr);
        }
        list.appendChild(wrap);
    }

    async function loadAiBudgetSwitches() {
        const list = byId('aiBudgetSwitchesList');
        const summaryNode = byId('aiBudgetSwitchesSummary');
        setState('aiBudgetSwitchesState', 'Loading AI budget switches...');
        clear(list);
        clear(summaryNode);
        const res = await apiAdminAiBudgetSwitches();
        if (!res.ok) {
            setState('aiBudgetSwitchesState', '');
            renderUnavailable(list, res, 'AI budget switches unavailable.');
            return;
        }
        const summary = res.data?.summary || {};
        if (summaryNode) {
            summaryNode.appendChild(detailRows([
                ['Effective rule', 'Cloudflare master flag enabled AND app switch enabled'],
                ['Total switches', summary.totalSwitches ?? '-'],
                ['Master enabled', summary.masterEnabledCount ?? '-'],
                ['App enabled', summary.appEnabledCount ?? '-'],
                ['Effective enabled', summary.effectiveEnabledCount ?? '-'],
                ['Disabled by master', summary.disabledByMasterCount ?? '-'],
                ['Disabled by app', summary.disabledByAppCount ?? '-'],
                ['Live platform caps', summary.liveBudgetCapsStatus || 'not_implemented'],
            ]));
        }
        const switches = Array.isArray(res.data?.switches) ? res.data.switches : [];
        if (switches.length === 0) {
            setState('aiBudgetSwitchesState', 'No allowed AI budget switches returned.');
            return;
        }
        setState('aiBudgetSwitchesState', `Showing ${switches.length} allowed switches. Cloudflare values are not displayed.`);
        const { wrap, tbody } = table(['Switch', 'Scope', 'Master', 'App', 'Effective', 'Cap Status', 'Updated', 'Action']);
        for (const item of switches) {
            const tr = document.createElement('tr');
            const title = el('div', null);
            title.appendChild(el('strong', null, item.label || item.switchKey));
            title.appendChild(el('br'));
            title.appendChild(el('span', 'admin-inventory__meta', item.description || item.switchKey));
            title.appendChild(el('br'));
            title.appendChild(el('span', 'admin-inventory__meta', item.recommendedOperatorNote || 'Cloudflare master flag must also be enabled.'));
            addCell(tr, title);
            addCell(tr, item.budgetScope || '-');
            addCell(tr, badge(item.masterFlagStatus || 'unknown', effectiveSwitchVariant(item.masterFlagStatus)));
            addCell(tr, badge(item.appSwitchEnabled ? 'enabled' : (item.appSwitchStatus || 'disabled'), item.appSwitchEnabled ? 'active' : 'disabled'));
            addCell(tr, badge(item.effectiveEnabled ? 'enabled' : 'disabled', item.effectiveEnabled ? 'active' : 'disabled'));
            addCell(tr, `${item.liveCapStatus || 'not_implemented'} (${item.liveCapFuturePhase || 'future'})`);
            addCell(tr, item.updatedAt ? formatDate(item.updatedAt) : '-');
            const action = el('button', 'btn-action', item.appSwitchEnabled ? 'Disable' : 'Enable');
            action.type = 'button';
            action.dataset.switchKey = item.switchKey;
            action.dataset.enabled = item.appSwitchEnabled ? 'false' : 'true';
            action.disabled = item.appSwitchAvailable === false;
            action.title = item.masterEnabled
                ? 'Update the app-level switch. Cloudflare master must also remain enabled.'
                : 'Cloudflare master flag is disabled or missing; the app switch cannot make this effective.';
            action.addEventListener('click', () => handleAiBudgetSwitchUpdate(item, action));
            addCell(tr, action);
            tbody.appendChild(tr);
        }
        list.appendChild(wrap);
    }

    async function handleAiBudgetSwitchUpdate(item, button) {
        const nextEnabled = !item.appSwitchEnabled;
        const promptMessage = `${nextEnabled ? 'Enable' : 'Disable'} ${item.label || item.switchKey}. Enter an operator reason. Cloudflare master flag must also be enabled; platform_admin_lab_budget paths also require daily/monthly cap allowance.`;
        const reason = window.prompt(promptMessage, '');
        if (!reason || !reason.trim()) {
            setState('aiBudgetSwitchesState', 'Switch update cancelled: reason is required.', 'error');
            return;
        }
        const confirmed = window.confirm(`Confirm app-level ${nextEnabled ? 'enable' : 'disable'} for ${item.switchKey}? This does not change Cloudflare variables.`);
        if (!confirmed) {
            setState('aiBudgetSwitchesState', 'Switch update cancelled.', 'neutral');
            return;
        }
        setSubmitting(button, true);
        setState('aiBudgetSwitchesState', 'Updating AI budget switch...');
        try {
            const res = await apiAdminAiUpdateBudgetSwitch(item.switchKey, {
                enabled: nextEnabled,
                reason: reason.trim(),
                idempotencyKey: createIdempotencyKey('ai-budget-switch'),
            });
            if (!res.ok) {
                setState('aiBudgetSwitchesState', apiUnavailableMessage(res, 'AI budget switch update failed.'), 'error');
                notify('AI budget switch update failed.', 'error');
                return;
            }
            notify('AI budget switch updated.', 'success');
            await loadAiBudgetSwitches();
        } finally {
            setSubmitting(button, false);
        }
    }

    async function loadPlatformBudgetCaps() {
        const list = byId('platformBudgetCapsList');
        const summaryNode = byId('platformBudgetCapsSummary');
        setState('platformBudgetCapsState', 'Loading platform budget caps...');
        clear(list);
        clear(summaryNode);
        const res = await apiAdminAiPlatformBudgetCaps();
        if (!res.ok) {
            setState('platformBudgetCapsState', '');
            renderUnavailable(list, res, 'Platform budget caps unavailable.');
            return;
        }
        const data = res.data || {};
        const windows = Array.isArray(data.windows) ? data.windows : [];
        if (summaryNode) {
            summaryNode.appendChild(detailRows([
                ['Scope', data.budgetScope || 'platform_admin_lab_budget'],
                ['Status', data.liveBudgetCapsStatus || 'platform_admin_lab_budget_foundation'],
                ['Cap enforced', data.capEnforced ? 'Yes' : 'No'],
                ['Customer billing', 'No'],
                ['Generated', formatDate(data.generatedAt)],
            ]));
        }
        if (windows.length === 0) {
            setState('platformBudgetCapsState', 'No platform budget cap windows returned.');
            return;
        }
        setState('platformBudgetCapsState', 'Platform admin lab caps are enforced after Cloudflare master and D1 app switches.');
        const { wrap, tbody } = table(['Window', 'Limit', 'Used', 'Remaining', 'Status', 'Updated', 'Action']);
        for (const item of windows) {
            const tr = document.createElement('tr');
            const limit = item.limit || {};
            addCell(tr, item.windowType || '-');
            addCell(tr, limit.limitUnits ?? '-');
            addCell(tr, item.usedUnits ?? 0);
            addCell(tr, item.remainingUnits ?? '-');
            addCell(tr, badge(item.capStatus || 'missing', item.capStatus === 'available' ? 'active' : 'disabled'));
            addCell(tr, limit.updatedAt ? formatDate(limit.updatedAt) : '-');
            const action = el('button', 'btn-action', limit.limitUnits ? 'Update' : 'Set');
            action.type = 'button';
            action.addEventListener('click', () => handlePlatformBudgetCapUpdate(data.budgetScope || 'platform_admin_lab_budget', item, action));
            addCell(tr, action);
            tbody.appendChild(tr);
        }
        list.appendChild(wrap);

        const usageRes = await apiAdminAiPlatformBudgetUsage();
        if (usageRes.ok && Array.isArray(usageRes.data?.usage?.operationUsage) && usageRes.data.usage.operationUsage.length) {
            const usageTitle = el('h4', 'admin-section-title', 'Current Month Usage');
            list.appendChild(usageTitle);
            const usageTable = table(['Operation', 'Units', 'Events']);
            for (const row of usageRes.data.usage.operationUsage) {
                const tr = document.createElement('tr');
                addCell(tr, row.operationKey || '-');
                addCell(tr, row.usedUnits ?? 0);
                addCell(tr, row.eventCount ?? 0);
                usageTable.tbody.appendChild(tr);
            }
            list.appendChild(usageTable.wrap);
        }
    }

    async function handlePlatformBudgetCapUpdate(budgetScope, item, button) {
        const windowType = item.windowType;
        const current = item.limit?.limitUnits || '';
        const rawLimit = window.prompt(`Set ${windowType} cap units for ${budgetScope}. This is not customer billing.`, String(current));
        if (!rawLimit || !rawLimit.trim()) {
            setState('platformBudgetCapsState', 'Cap update cancelled: limit is required.', 'error');
            return;
        }
        const limitUnits = Number(rawLimit);
        if (!Number.isInteger(limitUnits) || limitUnits <= 0) {
            setState('platformBudgetCapsState', 'Cap update cancelled: limit must be a positive integer.', 'error');
            return;
        }
        const reason = window.prompt('Enter an operator reason for this budget cap update.', '');
        if (!reason || !reason.trim()) {
            setState('platformBudgetCapsState', 'Cap update cancelled: reason is required.', 'error');
            return;
        }
        const confirmed = window.confirm(`Confirm ${windowType} cap ${limitUnits} for ${budgetScope}? This does not change Stripe, Cloudflare, or customer billing.`);
        if (!confirmed) {
            setState('platformBudgetCapsState', 'Cap update cancelled.', 'neutral');
            return;
        }
        setSubmitting(button, true);
        setState('platformBudgetCapsState', 'Updating platform budget cap...');
        try {
            const res = await apiAdminAiUpdatePlatformBudgetCap(budgetScope, {
                windowType,
                limitUnits,
                reason: reason.trim(),
                idempotencyKey: createIdempotencyKey('platform-budget-cap'),
            });
            if (!res.ok) {
                setState('platformBudgetCapsState', apiUnavailableMessage(res, 'Platform budget cap update failed.'), 'error');
                notify('Platform budget cap update failed.', 'error');
                return;
            }
            notify('Platform budget cap updated.', 'success');
            await loadPlatformBudgetCaps();
        } finally {
            setSubmitting(button, false);
        }
    }

    function platformBudgetRepairPayload(candidate, { dryRun, reason }) {
        return {
            budgetScope: candidate.budgetScope || 'platform_admin_lab_budget',
            candidateId: candidate.candidateId,
            candidateType: candidate.issueType,
            requestedAction: candidate.proposedAction,
            dryRun,
            confirm: dryRun ? false : true,
            reason,
        };
    }

    async function handlePlatformBudgetRepair(candidate, mode, button) {
        const dryRun = mode === 'dry_run';
        const reviewOnly = mode === 'review';
        const label = reviewOnly ? 'record review note' : (dryRun ? 'dry run repair' : 'apply repair');
        const reason = window.prompt(`Enter an operator reason to ${label}. No provider, Stripe, credit, or source-row mutation is performed.`, '');
        if (!reason || !reason.trim()) {
            setState('platformBudgetReconciliationState', 'Repair action cancelled: reason is required.', 'error');
            return;
        }
        if (!dryRun) {
            const confirmed = window.confirm(
                reviewOnly
                    ? 'Record this review note only? No platform budget usage event, provider call, Stripe call, credit mutation, or source row update will occur.'
                    : 'Apply this repair by creating one missing platform budget usage event from local D1 evidence? No provider call, Stripe call, credit mutation, or source row update will occur.',
            );
            if (!confirmed) {
                setState('platformBudgetReconciliationState', 'Repair action cancelled.', 'neutral');
                return;
            }
        }
        setSubmitting(button, true);
        setState('platformBudgetReconciliationState', dryRun ? 'Running repair dry-run...' : 'Submitting admin-approved repair...');
        try {
            const res = await apiAdminAiRepairPlatformBudgetCandidate(
                platformBudgetRepairPayload(candidate, { dryRun, reason: reason.trim() }),
                { idempotencyKey: createIdempotencyKey('platform-budget-repair') },
            );
            if (!res.ok) {
                setState('platformBudgetReconciliationState', apiUnavailableMessage(res, 'Platform budget repair request failed.'), 'error');
                notify('Platform budget repair request failed.', 'error');
                return;
            }
            const repair = res.data?.repair || {};
            if (repair.dryRun) {
                setState('platformBudgetReconciliationState', 'Dry-run completed. No repair was applied.');
                notify('Repair dry-run completed.', 'success');
                return;
            }
            notify(repair.repairApplied ? 'Missing usage evidence created.' : 'Repair review recorded.', 'success');
            await loadPlatformBudgetReconciliation();
        } finally {
            setSubmitting(button, false);
        }
    }

    async function loadPlatformBudgetReconciliation() {
        const list = byId('platformBudgetReconciliationList');
        const summaryNode = byId('platformBudgetReconciliationSummary');
        setState('platformBudgetReconciliationState', 'Loading platform budget reconciliation...');
        clear(list);
        clear(summaryNode);
        const res = await apiAdminAiPlatformBudgetReconciliation({ limit: 25, includeCandidates: true });
        if (!res.ok) {
            setState('platformBudgetReconciliationState', '');
            renderUnavailable(list, res, 'Platform budget reconciliation unavailable.');
            return;
        }
        const reconciliation = res.data?.reconciliation || {};
        const summary = reconciliation.summary || {};
        if (summaryNode) {
            summaryNode.appendChild(detailRows([
                ['Scope', reconciliation.budgetScope || 'platform_admin_lab_budget'],
                ['Verdict', reconciliation.verdict || '-'],
                ['Critical issues', summary.criticalIssueCount ?? 0],
                ['Warnings', summary.warningIssueCount ?? 0],
                ['Repair candidates', summary.repairCandidateCount ?? 0],
                ['Read-only', reconciliation.repairApplied === false ? 'Yes' : 'No'],
                ['Generated', formatDate(reconciliation.generatedAt)],
            ]));
        }
        setState('platformBudgetReconciliationState', 'Read-only reconciliation evidence plus explicit admin-approved repair actions. No automatic repair is applied.');
        const candidates = Array.isArray(reconciliation.repairCandidates) ? reconciliation.repairCandidates : [];
        if (candidates.length === 0) {
            list.appendChild(el('p', 'admin-shell__desc', 'No reconciliation repair candidates were returned for the bounded report.'));
            return;
        }
        const { wrap, tbody } = table(['Issue', 'Severity', 'Operation', 'Source', 'Action', 'Reason', 'Repair']);
        for (const item of candidates.slice(0, 25)) {
            const tr = document.createElement('tr');
            addCell(tr, item.issueType || '-');
            addCell(tr, badge(item.severity || 'warning', item.severity === 'critical' ? 'disabled' : 'legacy'));
            addCell(tr, item.operationKey || '-');
            addCell(tr, shortId(item.sourceAttemptId || item.sourceJobId || item.usageEventIds?.[0]));
            addCell(tr, item.proposedAction || '-');
            addCell(tr, item.reason || '-');
            const actions = el('div', 'admin-control-chip-row');
            if (item.phase419Executable || item.proposedAction === 'create_missing_usage_event') {
                const dryRunButton = el('button', 'btn-action btn-action--secondary', 'Dry Run');
                dryRunButton.type = 'button';
                dryRunButton.addEventListener('click', () => handlePlatformBudgetRepair(item, 'dry_run', dryRunButton));
                const applyButton = el('button', 'btn-action', 'Apply Repair');
                applyButton.type = 'button';
                applyButton.addEventListener('click', () => handlePlatformBudgetRepair(item, 'apply', applyButton));
                actions.append(dryRunButton, applyButton);
            } else if (item.reviewOnly) {
                const reviewButton = el('button', 'btn-action btn-action--secondary', 'Record Review');
                reviewButton.type = 'button';
                reviewButton.addEventListener('click', () => handlePlatformBudgetRepair(item, 'review', reviewButton));
                actions.appendChild(reviewButton);
            } else {
                actions.appendChild(el('span', 'admin-shell__desc', 'Future review'));
            }
            addCell(tr, actions);
            tbody.appendChild(tr);
        }
        list.appendChild(wrap);
        list.appendChild(el('p', 'admin-shell__desc', 'Repairs are explicit and admin-approved only. Apply Repair creates missing platform budget usage evidence only; review actions do not mutate usage/source rows. No provider, Stripe, credit, or customer billing action is available here.'));
    }

    function downloadTextFile(filename, text, type) {
        if (typeof Blob === 'undefined' || !window.URL?.createObjectURL) return false;
        const blob = new Blob([text || ''], { type: type || 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.rel = 'noopener';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
        return true;
    }

    async function loadPlatformBudgetRepairReport() {
        const summaryNode = byId('platformBudgetRepairReportSummary');
        const list = byId('platformBudgetRepairReportList');
        setState('platformBudgetRepairReportState', 'Loading repair evidence report...');
        clear(summaryNode);
        clear(list);
        const res = await apiAdminAiPlatformBudgetRepairReport({
            limit: 25,
            includeDetails: false,
            includeCandidates: false,
        });
        if (!res.ok) {
            setState('platformBudgetRepairReportState', '');
            renderUnavailable(list, res, 'Platform budget repair evidence report unavailable.');
            return;
        }
        const report = res.data?.report || {};
        const summary = report.summary || {};
        if (summaryNode) {
            summaryNode.appendChild(detailRows([
                ['Scope', report.budgetScope || 'platform_admin_lab_budget'],
                ['Source', report.source || '-'],
                ['Total repair actions', summary.totalRepairActions ?? 0],
                ['Executable repairs applied', summary.executableRepairsApplied ?? 0],
                ['Review-only actions', summary.reviewOnlyActionsRecorded ?? 0],
                ['Failed repair attempts', summary.failedRepairAttempts ?? 0],
                ['Created usage events', summary.createdUsageEventCount ?? 0],
                ['Automatic repair', report.automaticRepair === false ? 'No' : 'Unknown'],
                ['Generated', formatDate(report.generatedAt)],
            ]));
        }
        setState('platformBudgetRepairReportState', 'No repair is applied. Read-only operator evidence report; export is bounded and sanitized.');
        const statusRows = report.sections?.repairActionStatusRollup || [];
        const typeRows = report.sections?.repairActionTypeRollup || [];
        if (!statusRows.length && !typeRows.length) {
            list.appendChild(el('p', 'admin-shell__desc', 'No platform budget repair actions were returned for the bounded report.'));
        } else {
            const { wrap, tbody } = table(['Rollup', 'Count', 'Created usage events', 'Last action']);
            for (const row of statusRows.slice(0, 12)) {
                const tr = document.createElement('tr');
                addCell(tr, `status:${row.key || '-'}`);
                addCell(tr, row.count ?? 0);
                addCell(tr, row.createdUsageEventCount ?? 0);
                addCell(tr, formatDate(row.lastActionAt));
                tbody.appendChild(tr);
            }
            for (const row of typeRows.slice(0, 12)) {
                const tr = document.createElement('tr');
                addCell(tr, `type:${row.key || '-'}`);
                addCell(tr, row.count ?? 0);
                addCell(tr, row.createdUsageEventCount ?? 0);
                addCell(tr, formatDate(row.lastActionAt));
                tbody.appendChild(tr);
            }
            list.appendChild(wrap);
        }
        list.appendChild(el('p', 'admin-shell__desc', 'Reports and exports expose no raw prompts, provider bodies, raw idempotency keys, Stripe data, Cloudflare tokens, private keys, credit repairs, delete actions, or provider actions.'));
    }

    async function exportPlatformBudgetRepairReportJson(button) {
        setSubmitting(button, true);
        setState('platformBudgetRepairReportState', 'Preparing repair evidence JSON export...');
        try {
            const res = await apiAdminAiPlatformBudgetRepairReportExport({
                format: 'json',
                limit: 50,
                includeDetails: true,
                includeCandidates: false,
            });
            if (!res.ok) {
                setState('platformBudgetRepairReportState', apiUnavailableMessage(res, 'Repair evidence export failed.'), 'error');
                notify('Repair evidence export failed.', 'error');
                return;
            }
            const filename = `platform-budget-repair-report-${new Date().toISOString().slice(0, 10)}.json`;
            downloadTextFile(filename, res.text || '{}\n', 'application/json');
            setState('platformBudgetRepairReportState', 'Repair evidence JSON export prepared. No repair was applied.');
            notify('Repair evidence export prepared.', 'success');
        } finally {
            setSubmitting(button, false);
        }
    }

    function filenameFromContentDisposition(value, fallback) {
        const text = String(value || '');
        const match = text.match(/filename="?([^";]+)"?/i);
        return match?.[1] || fallback;
    }

    async function loadPlatformBudgetEvidenceArchives() {
        const summaryNode = byId('platformBudgetEvidenceArchivesSummary');
        const list = byId('platformBudgetEvidenceArchivesList');
        setState('platformBudgetEvidenceArchivesState', 'Loading evidence archives...');
        clear(summaryNode);
        clear(list);
        const res = await apiAdminAiPlatformBudgetEvidenceArchives({ limit: 25 });
        if (!res.ok) {
            setState('platformBudgetEvidenceArchivesState', '');
            renderUnavailable(list, res, 'Platform budget evidence archives unavailable.');
            return;
        }
        const archives = Array.isArray(res.data?.archives) ? res.data.archives : [];
        const createdCount = archives.filter((archive) => archive.archiveStatus === 'created').length;
        const expiredCount = archives.filter((archive) => archive.archiveStatus === 'expired').length;
        const deletedCount = archives.filter((archive) => archive.archiveStatus === 'deleted').length;
        if (summaryNode) {
            summaryNode.appendChild(detailRows([
                ['Scope', res.data?.budgetScope || 'platform_admin_lab_budget'],
                ['Archives returned', archives.length],
                ['Created', createdCount],
                ['Expired', expiredCount],
                ['Deleted', deletedCount],
                ['Storage', 'AUDIT_ARCHIVE / platform-budget-evidence/'],
                ['Sanitized', 'Yes'],
            ]));
        }
        setState('platformBudgetEvidenceArchivesState', 'Archives are sanitized operator evidence snapshots. No repair, provider call, Stripe call, credit mutation, or source-row mutation is performed.');
        if (!archives.length) {
            list.appendChild(el('p', 'admin-shell__desc', 'No platform budget evidence archives were returned for the bounded list.'));
            return;
        }
        const { wrap, tbody } = table(['Archive', 'Status', 'Format', 'Created', 'Expires', 'Summary', 'Actions']);
        for (const archive of archives.slice(0, 25)) {
            const tr = document.createElement('tr');
            addCell(tr, shortId(archive.id));
            addCell(tr, badge(archive.archiveStatus || 'unknown', archive.archiveStatus === 'created' ? 'active' : 'disabled'));
            addCell(tr, archive.format || '-');
            addCell(tr, formatDate(archive.createdAt));
            addCell(tr, formatDate(archive.expiresAt));
            addCell(tr, `${archive.summary?.totalRepairActions ?? 0} repairs; ${archive.summary?.createdUsageEventCount ?? 0} usage events`);
            const actions = el('div', 'admin-control-chip-row');
            if (archive.archiveStatus === 'created') {
                const downloadButton = el('button', 'btn-action btn-action--secondary', 'Download');
                downloadButton.type = 'button';
                downloadButton.addEventListener('click', () => downloadPlatformBudgetEvidenceArchive(archive, downloadButton));
                const expireButton = el('button', 'btn-action btn-action--secondary', 'Expire');
                expireButton.type = 'button';
                expireButton.addEventListener('click', () => expirePlatformBudgetEvidenceArchive(archive, expireButton));
                actions.append(downloadButton, expireButton);
            } else {
                actions.appendChild(el('span', 'admin-shell__desc', 'No download'));
            }
            addCell(tr, actions);
            tbody.appendChild(tr);
        }
        list.appendChild(wrap);
        list.appendChild(el('p', 'admin-shell__desc', 'Archive metadata omits private R2 keys, raw idempotency keys, prompts, provider bodies, Stripe data, Cloudflare tokens, private keys, repair execution controls, credit actions, and provider actions.'));
    }

    async function createPlatformBudgetEvidenceArchive(button) {
        const format = byId('platformBudgetEvidenceArchiveFormat')?.value || 'json';
        const archiveType = byId('platformBudgetEvidenceArchiveType')?.value || 'repair_report';
        const retentionDays = Number(byId('platformBudgetEvidenceArchiveRetentionDays')?.value || 90);
        const reason = byId('platformBudgetEvidenceArchiveReason')?.value?.trim() || '';
        const includeDetails = byId('platformBudgetEvidenceArchiveIncludeDetails')?.checked === true;
        const includeCandidates = byId('platformBudgetEvidenceArchiveIncludeCandidates')?.checked === true;
        if (!reason) {
            setState('platformBudgetEvidenceArchivesState', 'Archive creation cancelled: reason is required.', 'error');
            return;
        }
        if (!Number.isInteger(retentionDays) || retentionDays <= 0 || retentionDays > 365) {
            setState('platformBudgetEvidenceArchivesState', 'Archive creation cancelled: retention days must be between 1 and 365.', 'error');
            return;
        }
        const confirmed = window.confirm('Create a sanitized platform budget evidence archive? No repair is applied, and no provider, Stripe, credit, Cloudflare, or source-row action is performed.');
        if (!confirmed) {
            setState('platformBudgetEvidenceArchivesState', 'Archive creation cancelled.', 'neutral');
            return;
        }
        setSubmitting(button, true);
        setState('platformBudgetEvidenceArchivesState', 'Creating sanitized evidence archive...');
        try {
            const res = await apiAdminAiCreatePlatformBudgetEvidenceArchive({
                budgetScope: 'platform_admin_lab_budget',
                format,
                archiveType,
                retentionDays,
                reason,
                includeDetails,
                includeCandidates,
                filters: {
                    limit: 50,
                    includeDetails,
                    includeCandidates,
                },
            }, { idempotencyKey: createIdempotencyKey('platform-budget-evidence-archive') });
            if (!res.ok) {
                setState('platformBudgetEvidenceArchivesState', apiUnavailableMessage(res, 'Evidence archive creation failed.'), 'error');
                notify('Evidence archive creation failed.', 'error');
                return;
            }
            notify('Evidence archive created.', 'success');
            await loadPlatformBudgetEvidenceArchives();
        } finally {
            setSubmitting(button, false);
        }
    }

    async function downloadPlatformBudgetEvidenceArchive(archive, button) {
        setSubmitting(button, true);
        setState('platformBudgetEvidenceArchivesState', 'Preparing archived evidence download...');
        try {
            const res = await apiAdminAiDownloadPlatformBudgetEvidenceArchive(archive.id);
            if (!res.ok) {
                setState('platformBudgetEvidenceArchivesState', apiUnavailableMessage(res, 'Evidence archive download failed.'), 'error');
                notify('Evidence archive download failed.', 'error');
                return;
            }
            const fallback = `platform-budget-evidence-${archive.id}.${archive.format === 'markdown' ? 'md' : 'json'}`;
            downloadTextFile(filenameFromContentDisposition(res.filename, fallback), res.text || '', res.contentType || 'application/json');
            setState('platformBudgetEvidenceArchivesState', 'Evidence archive downloaded. No repair was applied.');
        } finally {
            setSubmitting(button, false);
        }
    }

    async function expirePlatformBudgetEvidenceArchive(archive, button) {
        const reason = window.prompt('Enter an operator reason to expire this evidence archive. The archive object is not deleted until cleanup.', '');
        if (!reason || !reason.trim()) {
            setState('platformBudgetEvidenceArchivesState', 'Archive expiry cancelled: reason is required.', 'error');
            return;
        }
        const confirmed = window.confirm('Expire this archive metadata? This does not repair budget data, mutate credits, or call providers/Stripe.');
        if (!confirmed) {
            setState('platformBudgetEvidenceArchivesState', 'Archive expiry cancelled.', 'neutral');
            return;
        }
        setSubmitting(button, true);
        setState('platformBudgetEvidenceArchivesState', 'Expiring evidence archive...');
        try {
            const res = await apiAdminAiExpirePlatformBudgetEvidenceArchive(archive.id, {
                reason: reason.trim(),
            }, { idempotencyKey: createIdempotencyKey('platform-budget-evidence-archive-expire') });
            if (!res.ok) {
                setState('platformBudgetEvidenceArchivesState', apiUnavailableMessage(res, 'Evidence archive expiry failed.'), 'error');
                notify('Evidence archive expiry failed.', 'error');
                return;
            }
            notify('Evidence archive expired.', 'success');
            await loadPlatformBudgetEvidenceArchives();
        } finally {
            setSubmitting(button, false);
        }
    }

    async function cleanupExpiredPlatformBudgetEvidenceArchives(button) {
        const reason = window.prompt('Enter an operator reason for bounded expired archive cleanup.', '');
        if (!reason || !reason.trim()) {
            setState('platformBudgetEvidenceArchivesState', 'Archive cleanup cancelled: reason is required.', 'error');
            return;
        }
        const confirmed = window.confirm('Cleanup expired platform budget evidence archives? Cleanup is bounded and restricted to the platform-budget-evidence/ prefix.');
        if (!confirmed) {
            setState('platformBudgetEvidenceArchivesState', 'Archive cleanup cancelled.', 'neutral');
            return;
        }
        setSubmitting(button, true);
        setState('platformBudgetEvidenceArchivesState', 'Cleaning up expired evidence archives...');
        try {
            const res = await apiAdminAiCleanupExpiredPlatformBudgetEvidenceArchives({
                budgetScope: 'platform_admin_lab_budget',
                limit: 25,
                reason: reason.trim(),
            }, { idempotencyKey: createIdempotencyKey('platform-budget-evidence-archive-cleanup') });
            if (!res.ok) {
                setState('platformBudgetEvidenceArchivesState', apiUnavailableMessage(res, 'Evidence archive cleanup failed.'), 'error');
                notify('Evidence archive cleanup failed.', 'error');
                return;
            }
            notify(`Evidence archive cleanup complete (${res.data?.cleanup?.deletedCount ?? 0} deleted).`, 'success');
            await loadPlatformBudgetEvidenceArchives();
        } finally {
            setSubmitting(button, false);
        }
    }

    async function loadAiAttemptDetail(attemptId) {
        const detail = byId('aiAttemptDetail');
        detail.hidden = false;
        detail.textContent = 'Loading attempt detail...';
        const res = await apiAdminAiUsageAttempt(attemptId);
        clear(detail);
        if (!res.ok) {
            renderUnavailable(detail, res, 'AI usage attempt detail unavailable.');
            return;
        }
        const attempt = res.data?.attempt || {};
        detail.appendChild(el('h3', 'admin-section-title', 'AI Usage Attempt Detail'));
        detail.appendChild(detailRows([
            ['Attempt', shortId(attempt.attemptId)],
            ['Organization', shortId(attempt.organizationId)],
            ['User', shortId(attempt.userId)],
            ['Feature', attempt.feature || '-'],
            ['Route', attempt.route || '-'],
            ['Status', attempt.status || '-'],
            ['Provider', attempt.providerStatus || '-'],
            ['Billing', attempt.billingStatus || '-'],
            ['Replay', attempt.replay?.status || '-'],
            ['Result model', attempt.result?.model || '-'],
            ['Prompt length', attempt.result?.promptLength ?? '-'],
            ['Error', attempt.error?.code || '-'],
        ]));
    }

    async function handleAiCleanup(event) {
        event.preventDefault();
        const submitButton = event.submitter;
        const limit = Math.max(1, Math.min(Number(byId('aiCleanupLimit')?.value) || 10, 50));
        const dryRun = !byId('aiCleanupExecute')?.checked;
        if (!dryRun && !confirm('Execute expired AI usage cleanup? This releases stale reservations and may delete only eligible expired temporary replay objects.')) {
            return;
        }
        setState('aiCleanupResult', dryRun ? 'Running cleanup dry-run...' : 'Executing cleanup...');
        setSubmitting(submitButton, true);
        try {
            const res = await apiAdminAiCleanupUsageAttempts({
                limit,
                dryRun,
                idempotencyKey: createIdempotencyKey('ai-usage-cleanup'),
            });
            if (!res.ok) {
                setState('aiCleanupResult', apiUnavailableMessage(res, 'AI usage cleanup failed.'), 'error');
                notify('AI usage cleanup failed.', 'error');
                return;
            }
            const cleanup = res.data?.cleanup || {};
            const failed = Number(cleanup.failedCount ?? cleanup.replayObjectFailedCount ?? 0);
            setState(
                'aiCleanupResult',
                `Mode ${cleanup.dryRun === false ? 'execute' : 'dry-run'}; scanned ${cleanup.scannedCount ?? 0}; expired ${cleanup.expiredCount ?? 0}; reservations released ${cleanup.reservationsReleasedCount ?? 0}; replay metadata cleared ${cleanup.replayObjectMetadataClearedCount ?? cleanup.replayMetadataExpiredCount ?? 0}; replay objects eligible ${cleanup.replayObjectsEligibleCount ?? 0}; replay objects deleted ${cleanup.replayObjectsDeletedCount ?? 0}; skipped ${cleanup.skippedCount ?? 0}; failed ${failed}.`,
                failed > 0 ? 'error' : 'success',
            );
            notify(dryRun ? 'AI usage cleanup dry-run completed.' : 'AI usage cleanup executed.', 'success');
            loadAiAttempts();
        } finally {
            setSubmitting(submitButton, false);
        }
    }

    async function loadLifecycle() {
        await Promise.all([loadLifecycleRequests(), loadLifecycleArchives()]);
    }

    async function loadLifecycleRequests() {
        const holder = byId('lifecycleRequests');
        setState('lifecycleRequestsState', 'Loading requests...');
        clear(holder);
        const res = await apiAdminDataLifecycleRequests({ limit: 20 });
        if (!res.ok) {
            setState('lifecycleRequestsState', '');
            renderUnavailable(holder, res, 'Lifecycle requests unavailable.');
            return;
        }
        const requests = Array.isArray(res.data?.requests) ? res.data.requests : [];
        if (requests.length === 0) {
            setState('lifecycleRequestsState', 'No lifecycle requests found.');
            return;
        }
        setState('lifecycleRequestsState', `Showing ${requests.length} requests.`);
        const { wrap, tbody } = table(['Type', 'Status', 'Subject', 'Dry-run', 'Created', 'Expires']);
        for (const request of requests) {
            const tr = document.createElement('tr');
            addCell(tr, request.type || '-');
            addCell(tr, badge(request.status || '-', variantFor(request.status)));
            addCell(tr, shortId(request.subjectUserId || request.subject_user_id));
            addCell(tr, request.dryRun ?? request.dry_run ? 'Yes' : 'No');
            addCell(tr, formatDate(request.createdAt || request.created_at));
            addCell(tr, formatDate(request.expiresAt || request.expires_at));
            tbody.appendChild(tr);
        }
        holder.appendChild(wrap);
    }

    async function loadLifecycleArchives() {
        const holder = byId('lifecycleArchives');
        setState('lifecycleArchivesState', 'Loading archives...');
        clear(holder);
        const res = await apiAdminDataLifecycleArchives({ limit: 20 });
        if (!res.ok) {
            setState('lifecycleArchivesState', '');
            renderUnavailable(holder, res, 'Export archive metadata unavailable.');
            return;
        }
        const archives = Array.isArray(res.data?.archives) ? res.data.archives : [];
        if (archives.length === 0) {
            setState('lifecycleArchivesState', 'No export archives found.');
            return;
        }
        setState('lifecycleArchivesState', `Showing ${archives.length} archive metadata rows.`);
        const { wrap, tbody } = table(['Archive', 'Status', 'Subject', 'Size', 'Created', 'Expires']);
        for (const archive of archives) {
            const tr = document.createElement('tr');
            addCell(tr, shortId(archive.id));
            addCell(tr, badge(archive.status || '-', variantFor(archive.status)));
            addCell(tr, shortId(archive.subjectUserId || archive.subject_user_id));
            addCell(tr, archive.sizeBytes ?? archive.size_bytes ?? '-');
            addCell(tr, formatDate(archive.createdAt || archive.created_at));
            addCell(tr, formatDate(archive.expiresAt || archive.expires_at));
            tbody.appendChild(tr);
        }
        holder.appendChild(wrap);
    }

    async function loadOperations() {
        await Promise.all([loadPoisonMessages(), loadFailedJobs()]);
    }

    async function loadPoisonMessages() {
        const holder = byId('videoPoisonList');
        setState('videoPoisonState', 'Loading poison messages...');
        clear(holder);
        const res = await apiAdminAiListVideoJobPoisonMessages({ limit: 10 });
        if (!res.ok) {
            setState('videoPoisonState', '');
            renderUnavailable(holder, res, 'Video poison diagnostics unavailable.');
            return;
        }
        const items = Array.isArray(res.data?.poisonMessages) ? res.data.poisonMessages
            : Array.isArray(res.data?.messages) ? res.data.messages
                : Array.isArray(res.data?.items) ? res.data.items : [];
        if (items.length === 0) {
            setState('videoPoisonState', 'No poison messages found.');
            return;
        }
        setState('videoPoisonState', `Showing ${items.length} poison messages.`);
        holder.appendChild(simpleList(items, ['id', 'jobId', 'reason', 'createdAt']));
    }

    async function loadFailedJobs() {
        const holder = byId('videoFailedList');
        setState('videoFailedState', 'Loading failed jobs...');
        clear(holder);
        const res = await apiAdminAiListFailedVideoJobs({ limit: 10 });
        if (!res.ok) {
            setState('videoFailedState', '');
            renderUnavailable(holder, res, 'Failed job diagnostics unavailable.');
            return;
        }
        const items = Array.isArray(res.data?.jobs) ? res.data.jobs
            : Array.isArray(res.data?.failedJobs) ? res.data.failedJobs
                : Array.isArray(res.data?.items) ? res.data.items : [];
        if (items.length === 0) {
            setState('videoFailedState', 'No failed jobs found.');
            return;
        }
        setState('videoFailedState', `Showing ${items.length} failed jobs.`);
        holder.appendChild(simpleList(items, ['id', 'jobId', 'status', 'errorCode', 'updatedAt']));
    }

    function simpleList(items, preferredKeys) {
        const list = el('div', 'admin-inventory');
        for (const item of items) {
            const name = item.id || item.jobId || item.job_id || item.messageId || 'item';
            const summary = preferredKeys
                .filter((key) => !isSensitiveKey(key))
                .map((key) => item[key] ?? item[key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)])
                .filter(Boolean)
                .map(safeSummaryValue)
                .join(' | ');
            list.appendChild(row(shortId(name), summary || renderJsonSummary(item)));
        }
        return list;
    }

    function renderReadiness() {
        const container = byId('readinessChecklist');
        if (!container) return;
        renderCards(container, [
            {
                title: 'Release Preflight',
                badge: { label: 'Run before merge', variant: 'legacy' },
                copy: 'This control plane reports the repo checklist only. Re-run release preflight after every admin UI change before merge.',
                meta: [['Command', 'npm run release:preflight']],
            },
            {
                title: 'Latest Auth Migration',
                badge: { label: '0038', variant: 'user' },
                copy: 'Stripe Testmode checkout session tracking depends on auth migration 0038 in environments that use Phase 2-J routes.',
                meta: [['Deploy order', 'D1 migrations, auth worker, static']],
            },
            {
                title: 'Production Status',
                badge: { label: 'Blocked', variant: 'disabled' },
                copy: 'Live Cloudflare validation, dashboard-managed WAF/header checks, staging migrations, Stripe Testmode endpoint verification, and staging flow tests are still required.',
            },
            {
                title: 'No Secret Editing',
                badge: { label: 'Deployment-owned', variant: 'legacy' },
                copy: 'Cloudflare secrets, Stripe keys, HMAC secrets, webhook secrets, route policies, and migration state are not editable from this admin UI.',
            },
        ]);
    }

    function renderSettings() {
        const container = byId('adminSettingsPanel');
        if (!container) return;
        renderCards(container, [
            {
                title: 'Admin Settings',
                badge: { label: 'Deployment-owned', variant: 'legacy' },
                copy: 'No safe backend admin settings API exists for mutable deployment configuration. Secrets and production flags stay in Cloudflare/deployment workflows.',
            },
            {
                title: 'Local UI Preferences',
                badge: { label: 'Future', variant: 'user' },
                copy: 'Table density and saved filters can be added later as local-only preferences without backend mutation.',
            },
        ]);
    }

    function bind() {
        byId('orgsRefresh')?.addEventListener('click', loadOrgs);
        byId('billingPlansRefresh')?.addEventListener('click', loadBillingPlans);
        byId('orgBillingLookupForm')?.addEventListener('submit', async (event) => {
            event.preventDefault();
            const org = await resolveOrganizationByName({
                inputId: 'orgBillingSearch',
                matchesId: 'orgBillingMatches',
                stateId: 'orgBillingState',
                key: 'orgLookup',
                onSelect: (selectedOrg) => loadOrgBilling(selectedOrg.id, selectedOrg),
            });
            if (org) loadOrgBilling(org.id, org);
        });
        byId('userBillingLookupForm')?.addEventListener('submit', async (event) => {
            event.preventDefault();
            const user = await resolveUserByEmail({
                inputId: 'userBillingSearch',
                matchesId: 'userBillingMatches',
                stateId: 'userBillingState',
                key: 'userLookup',
                onSelect: (selectedUser) => loadUserBilling(selectedUser.id, selectedUser),
            });
            if (user) loadUserBilling(user.id, user);
        });
        byId('creditGrantForm')?.addEventListener('submit', handleCreditGrant);
        byId('userCreditGrantForm')?.addEventListener('submit', handleUserCreditGrant);
        byId('billingEventsFilter')?.addEventListener('submit', (event) => {
            event.preventDefault();
            loadBillingEvents();
        });
        byId('billingReviewsFilter')?.addEventListener('submit', (event) => {
            event.preventDefault();
            loadBillingReviews();
        });
        byId('billingReviewsRefresh')?.addEventListener('click', loadBillingReviews);
        byId('billingReconciliationRefresh')?.addEventListener('click', loadBillingReconciliation);
        byId('aiAttemptsRefresh')?.addEventListener('click', loadAiAttempts);
        byId('aiAttemptsFilter')?.addEventListener('submit', (event) => {
            event.preventDefault();
            loadAiAttempts();
        });
        byId('aiCleanupForm')?.addEventListener('submit', handleAiCleanup);
        byId('aiBudgetSwitchesRefresh')?.addEventListener('click', loadAiBudgetSwitches);
        byId('platformBudgetCapsRefresh')?.addEventListener('click', loadPlatformBudgetCaps);
        byId('platformBudgetReconciliationRefresh')?.addEventListener('click', loadPlatformBudgetReconciliation);
        byId('platformBudgetRepairReportRefresh')?.addEventListener('click', loadPlatformBudgetRepairReport);
        byId('platformBudgetRepairReportExportJson')?.addEventListener('click', (event) => {
            exportPlatformBudgetRepairReportJson(event.currentTarget);
        });
        byId('platformBudgetEvidenceArchivesRefresh')?.addEventListener('click', loadPlatformBudgetEvidenceArchives);
        byId('platformBudgetEvidenceArchiveCreate')?.addEventListener('click', (event) => {
            createPlatformBudgetEvidenceArchive(event.currentTarget);
        });
        byId('platformBudgetEvidenceArchiveCleanup')?.addEventListener('click', (event) => {
            cleanupExpiredPlatformBudgetEvidenceArchives(event.currentTarget);
        });
        byId('lifecycleRequestsRefresh')?.addEventListener('click', loadLifecycleRequests);
        byId('lifecycleArchivesRefresh')?.addEventListener('click', loadLifecycleArchives);
        byId('operationsRefresh')?.addEventListener('click', loadOperations);
    }

    async function load(sectionName) {
        if (!CONTROL_SECTIONS.has(sectionName)) return;
        if (sectionName === 'dashboard') {
            await loadCommandCenter();
            return;
        }
        if (sectionName === 'security') {
            renderSecurity();
            return;
        }
        if (sectionName === 'readiness') {
            renderReadiness();
            return;
        }
        if (sectionName === 'settings') {
            renderSettings();
            return;
        }
        if (loaded.has(sectionName)) return;
        loaded.add(sectionName);
        if (sectionName === 'orgs') await loadOrgs();
        if (sectionName === 'billing') await loadBillingPlans();
        if (sectionName === 'billing-events') await Promise.all([loadBillingReconciliation(), loadBillingReviews(), loadBillingEvents()]);
        if (sectionName === 'ai-usage') await loadAiAttempts();
        if (sectionName === 'ai-budget-switches') await Promise.all([
            loadAiBudgetSwitches(),
            loadPlatformBudgetCaps(),
            loadPlatformBudgetReconciliation(),
            loadPlatformBudgetRepairReport(),
            loadPlatformBudgetEvidenceArchives(),
        ]);
        if (sectionName === 'lifecycle') await loadLifecycle();
        if (sectionName === 'operations') await loadOperations();
    }

    return {
        bind,
        load,
        sections: CONTROL_SECTIONS,
    };
}
