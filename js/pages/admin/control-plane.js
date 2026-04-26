/* ============================================================
   BITBI — Admin Control Plane
   Safe frontend-only surfaces for implemented admin APIs.
   ============================================================ */

import {
    apiAdminAiCleanupUsageAttempts,
    apiAdminAiListFailedVideoJobs,
    apiAdminAiListVideoJobPoisonMessages,
    apiAdminAiUsageAttempt,
    apiAdminAiUsageAttempts,
    apiAdminBillingEvent,
    apiAdminBillingEvents,
    apiAdminBillingPlans,
    apiAdminDataLifecycleArchives,
    apiAdminDataLifecycleRequests,
    apiAdminGrantOrganizationCredits,
    apiAdminOrganization,
    apiAdminOrganizationBilling,
    apiAdminOrganizations,
} from '../../shared/auth-api.js?v=__ASSET_VERSION__';

const CONTROL_SECTIONS = new Set([
    'dashboard',
    'security',
    'orgs',
    'billing',
    'billing-events',
    'ai-usage',
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

function byId(id) {
    return document.getElementById(id);
}

function clear(node) {
    if (node) node.replaceChildren();
}

function appendText(parent, text) {
    parent.appendChild(document.createTextNode(text == null || text === '' ? '-' : String(text)));
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
    const safeEntries = Object.entries(value).filter(([key]) => !/secret|signature|raw|payload|hash|token|card/i.test(key));
    if (safeEntries.length === 0) return '-';
    return safeEntries.map(([key, val]) => `${key}: ${typeof val === 'object' ? '[object]' : String(val)}`).join(', ');
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
    return {
        label,
        ok: result.ok,
        status: result.ok ? 'Available' : apiUnavailableMessage(result, 'Unavailable'),
        variant: result.ok ? 'active' : (result.status === 404 ? 'legacy' : 'disabled'),
    };
}

export function createAdminControlPlane({ showToast, formatDate }) {
    const loaded = new Set();

    function notify(message, type = 'success') {
        if (typeof showToast === 'function') showToast(message, type);
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
                copy: 'Inspect organizations, active memberships, roles, and tenant-readiness boundaries.',
                href: '#orgs',
            },
            {
                title: 'Billing / Credits',
                badge: { label: probes[1].status, variant: probes[1].variant },
                copy: 'Review plan entitlements, org credit balances, and perform confirmed manual credit grants.',
                href: '#billing',
            },
            {
                title: 'Billing Events / Stripe',
                badge: { label: probes[2].status, variant: probes[2].variant },
                copy: 'Inspect synthetic/Stripe Testmode billing events. Live billing, subscriptions, invoices, and customer portal remain disabled.',
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
                copy: 'Inspect export/deletion/anonymization requests and private export archive metadata. Irreversible deletion remains disabled.',
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
                badge: { label: '121 policies', variant: 'active' },
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
                meta: [['Required', 'Staging verification and live prereq validation']],
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
            ['Status', org.status || '-'],
            ['Slug', org.slug || '-'],
            ['Created by', org.createdByEmail || '-'],
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

    async function loadOrgBilling(orgId) {
        const state = byId('orgBillingState');
        const detail = byId('orgBillingDetail');
        clear(detail);
        if (!orgId) {
            setState('orgBillingState', 'Enter an organization ID to inspect billing state.');
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
            ['Organization ID', shortId(billing.organizationId || orgId)],
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
                chips.appendChild(badge(feature, 'user'));
            }
            detail.appendChild(chips);
        }
    }

    async function handleCreditGrant(event) {
        event.preventDefault();
        const orgId = byId('creditGrantOrgId')?.value.trim();
        const amount = Number(byId('creditGrantAmount')?.value);
        const reason = byId('creditGrantReason')?.value.trim();
        if (!orgId || !Number.isInteger(amount) || amount <= 0 || !reason) {
            setState('creditGrantResult', 'Organization ID, positive credit amount, and reason are required.', 'error');
            return;
        }
        if (!confirm(`Grant ${amount} credits to ${orgId}? This creates a credit ledger entry.`)) {
            return;
        }
        const idempotencyKey = createIdempotencyKey('admin-credit-grant');
        setState('creditGrantResult', 'Submitting credit grant...');
        const res = await apiAdminGrantOrganizationCredits(orgId, { amount, reason, idempotencyKey });
        if (!res.ok) {
            setState('creditGrantResult', apiUnavailableMessage(res, 'Credit grant failed.'), 'error');
            notify('Credit grant failed.', 'error');
            return;
        }
        const balance = res.data?.ledgerEntry?.balanceAfter ?? res.data?.ledgerEntry?.balance_after ?? '-';
        setState('creditGrantResult', `Credit grant recorded. Balance after: ${balance}.`, 'success');
        notify('Credit grant recorded.', 'success');
        byId('orgBillingId').value = orgId;
        loadOrgBilling(orgId);
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
        const limit = Math.max(1, Math.min(Number(byId('aiCleanupLimit')?.value) || 10, 50));
        const dryRun = !byId('aiCleanupExecute')?.checked;
        if (!dryRun && !confirm('Execute expired AI usage cleanup? This releases stale reservations and may delete only eligible expired temporary replay objects.')) {
            return;
        }
        setState('aiCleanupResult', dryRun ? 'Running cleanup dry-run...' : 'Executing cleanup...');
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
        setState(
            'aiCleanupResult',
            `Scanned ${cleanup.scannedCount ?? 0}; expired ${cleanup.expiredCount ?? 0}; reservations released ${cleanup.reservationsReleasedCount ?? 0}; replay objects deleted ${cleanup.replayObjectsDeletedCount ?? 0}; failed ${cleanup.failedCount ?? 0}.`,
            cleanup.failedCount > 0 ? 'error' : 'success',
        );
        notify(dryRun ? 'AI usage cleanup dry-run completed.' : 'AI usage cleanup executed.', 'success');
        loadAiAttempts();
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
                .map((key) => item[key] ?? item[key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)])
                .filter(Boolean)
                .map(String)
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
                badge: { label: 'Green locally', variant: 'active' },
                copy: 'The committed baseline passed release preflight before this UI phase. Re-run after every control-plane change.',
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
        byId('orgBillingLookupForm')?.addEventListener('submit', (event) => {
            event.preventDefault();
            loadOrgBilling(byId('orgBillingId')?.value.trim());
        });
        byId('creditGrantForm')?.addEventListener('submit', handleCreditGrant);
        byId('billingEventsFilter')?.addEventListener('submit', (event) => {
            event.preventDefault();
            loadBillingEvents();
        });
        byId('aiAttemptsRefresh')?.addEventListener('click', loadAiAttempts);
        byId('aiAttemptsFilter')?.addEventListener('submit', (event) => {
            event.preventDefault();
            loadAiAttempts();
        });
        byId('aiCleanupForm')?.addEventListener('submit', handleAiCleanup);
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
        if (sectionName === 'billing-events') await loadBillingEvents();
        if (sectionName === 'ai-usage') await loadAiAttempts();
        if (sectionName === 'lifecycle') await loadLifecycle();
        if (sectionName === 'operations') await loadOperations();
    }

    return {
        bind,
        load,
        sections: CONTROL_SECTIONS,
    };
}
