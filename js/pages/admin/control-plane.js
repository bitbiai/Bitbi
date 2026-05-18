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
    apiAdminLegacyMediaResetDryRunExport,
    apiAdminOrganization,
    apiAdminOrganizationBilling,
    apiAdminOrganizations,
    apiAdminReadinessStatus,
    apiAdminTenantAssetDomainEvidence,
    apiAdminTenantAssetManualReviewEvidence,
    apiAdminTenantAssetManualReviewEvidenceExport,
    apiAdminTenantAssetManualReviewItem,
    apiAdminTenantAssetManualReviewItems,
    apiAdminUpdateTenantAssetManualReviewStatus,
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
    'tenant-assets',
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

const TENANT_REVIEW_STATUSES = [
    'pending_review',
    'review_in_progress',
    'approved_personal_user_asset',
    'approved_organization_asset',
    'approved_legacy_unclassified',
    'approved_platform_admin_test_asset',
    'blocked_public_unsafe',
    'blocked_derivative_risk',
    'blocked_relationship_conflict',
    'blocked_missing_evidence',
    'needs_legal_privacy_review',
    'deferred',
    'rejected',
    'superseded',
];

const TENANT_REVIEW_STATUS_TRANSITIONS = {
    pending_review: ['review_in_progress', 'deferred', 'rejected', 'needs_legal_privacy_review'],
    review_in_progress: [
        'approved_personal_user_asset',
        'approved_organization_asset',
        'approved_legacy_unclassified',
        'approved_platform_admin_test_asset',
        'blocked_public_unsafe',
        'blocked_derivative_risk',
        'blocked_relationship_conflict',
        'blocked_missing_evidence',
        'deferred',
        'rejected',
        'needs_legal_privacy_review',
    ],
    deferred: ['pending_review'],
    needs_legal_privacy_review: ['review_in_progress'],
    approved_personal_user_asset: ['superseded'],
    approved_organization_asset: ['superseded'],
    approved_legacy_unclassified: ['superseded'],
    approved_platform_admin_test_asset: ['superseded'],
    blocked_public_unsafe: ['superseded'],
    blocked_derivative_risk: ['superseded'],
    blocked_relationship_conflict: ['superseded'],
    blocked_missing_evidence: ['superseded'],
    rejected: ['superseded'],
    superseded: [],
};

const CURRENT_AUTH_SCHEMA_CHECKPOINT = '0058_add_legacy_media_reset_actions.sql';

const READINESS_FALLBACK_STATUS = Object.freeze({
    releaseTruth: {
        source: 'config/release-compat.json',
        latestAuthMigration: CURRENT_AUTH_SCHEMA_CHECKPOINT,
        migrationDirectory: 'workers/auth/migrations',
        databaseName: 'bitbi-auth-db',
        staticDeploySeparateFromWorkers: true,
        repoTruthIsLiveDeployProof: false,
        deployVerificationRequired: true,
        deployUnits: ['auth Worker', 'AI Worker', 'contact Worker', 'static Pages'],
        caveat: 'Repository readiness state is not live Cloudflare deploy proof; operator verification remains required.',
    },
    liveEvidenceState: {
        status: 'live_evidence_pending',
        repoSupported: true,
        deployPendingUntilOperatorProof: true,
        liveEvidenceCollectedByRepoAlone: false,
        latestExpectedManifestFields: [
            'generated timestamp',
            'git branch',
            'git commit SHA',
            'worktree classification',
            'latest auth migration',
            'deploy units',
            'deploy order',
            'blocked claims',
            'rollback placeholders',
        ],
        pendingChecks: [
            'release cutover manifest saved',
            'remote auth D1 migration verification',
            'Worker deploy evidence',
            'static deploy evidence if affected',
            'GET /api/health live result',
            'public security header result',
            'admin readiness status live result',
            'rollback owner and previous version recorded',
        ],
        rejectedOrFailedEvidence: [],
        caveat: 'This dashboard does not collect live evidence by itself.',
    },
    cutoverEvidence: {
        outputDirectory: 'docs/production-readiness/evidence/',
        commands: [
            'npm run release:cutover-evidence',
            'npm run release:cutover-evidence:markdown',
            'npm run readiness:live-readonly -- --static-url https://bitbi.ai --auth-worker-url https://bitbi.ai',
        ],
        safeToRunLocally: true,
        browserExecutesCommands: false,
        noDeployOrMigration: true,
    },
    blockedClaims: [
        { label: 'Production readiness', status: 'blocked' },
        { label: 'Live billing readiness', status: 'blocked' },
        { label: 'Tenant isolation', status: 'not_claimed' },
        { label: 'Ownership backfill readiness', status: 'blocked' },
        { label: 'Access-switch readiness', status: 'blocked' },
        { label: 'Confirmed legacy media reset readiness', status: 'blocked' },
        { label: 'Confirmed media deletion/reset', status: 'not_approved' },
    ],
    hardeningStatus: [
        { label: 'P0-01 main release readiness gate', status: 'implemented_repo_supported' },
        { label: 'P0-02 confirmed legacy reset gate', status: 'implemented_default_off' },
        { label: 'P0-03 sanitized legacy reset dry-run evidence', status: 'pending_blocking' },
        { label: 'P0-04 manual-review idempotency evidence', status: 'pending_blocking' },
        { label: 'P0-05 active documentation drift cleanup', status: 'implemented_repo_supported' },
        { label: 'P1 Wave 1 security/cost hardening', status: 'implemented_repo_supported' },
        { label: 'P1 Wave 2 release/canary/billing/admin mutation hardening', status: 'implemented_repo_supported' },
        { label: 'P1 Wave 3 admin/data/observability/scale hardening', status: 'implemented_repo_supported' },
        { label: 'P1 Wave 4 Admin Readiness & Evidence Dashboard', status: 'implemented_repo_supported' },
        { label: 'P1 Wave 5 live evidence/cutover tooling', status: 'implemented_repo_supported' },
    ],
    runtimeSafetyGates: [
        { label: 'ENABLE_LEGACY_MEDIA_RESET_CONFIRMED_EXECUTION', expected: 'off', enabled: false, status: 'disabled_default_off' },
        { label: 'Fetch Metadata CSRF hardening', status: 'implemented' },
        { label: 'AI Worker caller-policy enforcement', status: 'implemented' },
        { label: 'Admin AI legacy/unclassified provider path', status: 'blocked_or_classified' },
        { label: 'R2/private key redaction', status: 'implemented' },
        { label: 'High-risk admin mutation confirmations', status: 'implemented_for_covered_routes' },
        { label: 'Data lifecycle confirmation/idempotency guardrails', status: 'implemented_for_covered_routes' },
    ],
    evidenceStatuses: [
        { label: 'Legacy reset sanitized dry-run evidence', status: 'pending_sanitized_evidence_required' },
        { label: 'Manual-review idempotency evidence', status: 'pending_replay_conflict_status_success' },
        { label: 'Production readiness evidence', status: 'pending_operator_live_evidence' },
        { label: 'Live billing canary evidence', status: 'pending_operator_live_evidence' },
        { label: 'Billing safety local tests', status: 'implemented_repo_supported' },
        { label: 'Readiness/canary local-only safety contract', status: 'implemented_repo_supported' },
        { label: 'AI budget/platform evidence', status: 'implemented_selected_scopes_live_evidence_pending' },
    ],
});

const READINESS_COMMAND_GROUPS = Object.freeze([
    {
        title: 'Local validation',
        note: 'Local checks only. These commands do not deploy or mutate Cloudflare by themselves.',
        commands: [
            'npm run check:js',
            'npm run check:secrets',
            'npm run check:route-policies',
            'npm run test:workers',
            'npm run test:static',
            'npm run validate:release',
            'npm run release:plan',
        ],
    },
    {
        title: 'Release cutover / live evidence',
        note: 'Copy-only expected-state and live-read-only evidence commands. They do not deploy or run remote migrations.',
        commands: [
            'npm run release:cutover-evidence',
            'npm run release:cutover-evidence:markdown',
            'npm run readiness:live-readonly -- --static-url https://bitbi.ai --auth-worker-url https://bitbi.ai',
        ],
    },
    {
        title: 'Readiness / evidence',
        note: 'Evidence and readiness checks. Live canary tests stay safe-by-default and pending when no live URL is configured.',
        commands: [
            'npm run check:main-release-readiness',
            'npm run test:readiness-evidence',
            'npm run test:release-cutover-evidence',
            'npm run test:live-canary',
            'npm run check:doc-currentness',
            'npm run test:doc-currentness',
        ],
    },
    {
        title: 'AI / budget',
        note: 'Policy and platform budget tests. These do not call real providers.',
        commands: [
            'npm run check:ai-cost-policy',
            'npm run test:ai-cost-policy',
            'npm run test:ai-cost-operations',
            'npm run test:ai-cost-gateway',
            'npm run test:admin-platform-budget-policy',
            'npm run test:admin-platform-budget-evidence',
        ],
    },
    {
        title: 'Tenant / evidence',
        note: 'Tenant asset dry-runs and local evidence checks only. Do not enable confirmed reset execution.',
        commands: [
            'npm run test:tenant-assets',
            'npm run dry-run:tenant-assets',
            'npm run dry-run:tenant-assets:images',
        ],
    },
]);

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

function readableToken(value) {
    const text = String(value || '').trim();
    if (!text) return '-';
    return text.replace(/_/g, ' ');
}

function tenantReviewStatusVariant(value) {
    const status = String(value || '').toLowerCase();
    if (status.startsWith('approved_')) return 'active';
    if (status.startsWith('blocked_') || status === 'rejected') return 'disabled';
    if (status === 'review_in_progress' || status === 'needs_legal_privacy_review') return 'legacy';
    if (status === 'superseded') return 'legacy';
    if (status === 'deferred') return 'user';
    return 'user';
}

function allowedTenantReviewTransitions(status) {
    return TENANT_REVIEW_STATUS_TRANSITIONS[String(status || '')] || [];
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

function statusVariant(value) {
    const status = String(value || '').toLowerCase();
    if (status.includes('implemented') || status === 'available' || status === 'repo_supported') return 'active';
    if (status.includes('disabled') || status.includes('blocked') || status.includes('not_approved') || status.includes('not_claimed') || status.includes('unsafe')) return 'disabled';
    if (status.includes('pending') || status.includes('verification') || status.includes('required')) return 'legacy';
    return 'user';
}

function statusLabel(value) {
    return readableToken(value || 'not reported');
}

function normalizeReadinessStatus(data) {
    if (!data || typeof data !== 'object') return READINESS_FALLBACK_STATUS;
    return {
        ...READINESS_FALLBACK_STATUS,
        ...data,
        releaseTruth: {
            ...READINESS_FALLBACK_STATUS.releaseTruth,
            ...(data.releaseTruth || {}),
        },
        liveEvidenceState: {
            ...READINESS_FALLBACK_STATUS.liveEvidenceState,
            ...(data.liveEvidenceState || {}),
        },
        cutoverEvidence: {
            ...READINESS_FALLBACK_STATUS.cutoverEvidence,
            ...(data.cutoverEvidence || {}),
        },
        blockedClaims: Array.isArray(data.blockedClaims) ? data.blockedClaims : READINESS_FALLBACK_STATUS.blockedClaims,
        hardeningStatus: Array.isArray(data.hardeningStatus) ? data.hardeningStatus : READINESS_FALLBACK_STATUS.hardeningStatus,
        runtimeSafetyGates: Array.isArray(data.runtimeSafetyGates) ? data.runtimeSafetyGates : READINESS_FALLBACK_STATUS.runtimeSafetyGates,
        evidenceStatuses: Array.isArray(data.evidenceStatuses) ? data.evidenceStatuses : READINESS_FALLBACK_STATUS.evidenceStatuses,
    };
}

async function copyTextToClipboard(text) {
    if (!text) return false;
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.setAttribute('readonly', '');
            textarea.style.position = 'fixed';
            textarea.style.insetInlineStart = '-9999px';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            textarea.remove();
        }
        return true;
    } catch {
        return false;
    }
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
    let selectedTenantReviewItemId = '';
    let billingReviewResolutionSubmitting = false;
    let tenantReviewStatusSubmitting = false;

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
            capabilityProbe('AI budget controls', () => apiAdminAiBudgetSwitches()),
            capabilityProbe('Data lifecycle', () => apiAdminDataLifecycleRequests({ limit: 1 })),
            capabilityProbe('Export archives', () => apiAdminDataLifecycleArchives({ limit: 1 })),
            capabilityProbe('Tenant asset manual review', () => apiAdminTenantAssetManualReviewEvidence({ limit: 1, includeItems: false })),
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
                title: 'AI Budget Controls',
                badge: { label: probes[4].status, variant: probes[4].variant },
                copy: 'Operate Cloudflare-master plus D1 app switches, platform_admin_lab_budget caps, reconciliation, repair evidence, and sanitized archives. This is not live billing readiness.',
                href: '#ai-budget-switches',
                cta: 'Open controls',
            },
            {
                title: 'Data Lifecycle',
                badge: { label: probes[5].status, variant: probes[5].variant },
                copy: 'Inspect export/deletion/anonymization requests and private export archive metadata. Irreversible deletion remains unavailable in this UI.',
                href: '#lifecycle',
            },
            {
                title: 'Tenant Asset Manual Review',
                badge: { label: probes[7].status, variant: probes[7].variant },
                copy: 'Inspect AI folders/images manual-review queue evidence and record review-status decisions. Ownership backfill and access switching remain blocked.',
                href: '#operations',
                cta: 'Open queue',
            },
            {
                title: 'Operational Readiness',
                badge: { label: 'Production blocked', variant: 'disabled' },
                copy: 'Release preflight is green, but live Cloudflare validation, migration verification, and main-only operator evidence remain deployment prerequisites.',
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

    function tenantReviewSummaryCards(summary = {}) {
        return [
            {
                title: 'Review Queue',
                badge: { label: `${summary.totalReviewItems ?? 0} items`, variant: 'user' },
                copy: 'Manual-review rows only. This queue does not change ownership metadata or runtime access checks.',
                meta: [
                    ['Pending', summary.reviewStatusRollup?.pending_review ?? 0],
                    ['In progress', summary.reviewStatusRollup?.review_in_progress ?? 0],
                    ['Critical', summary.severityRollup?.critical ?? 0],
                ],
            },
            {
                title: 'Blocked Review Signals',
                badge: { label: 'Access blocked', variant: 'disabled' },
                copy: 'Blocked categories remain evidence for human review only.',
                meta: [
                    ['Public unsafe', summary.issueCategoryRollup?.public_unsafe ?? 0],
                    ['Derivative risk', summary.issueCategoryRollup?.derivative_risk ?? 0],
                    ['Terminal blocked', summary.terminalBlockedCount ?? 0],
                ],
            },
            {
                title: 'Status Evidence',
                badge: { label: 'Review-state only', variant: 'legacy' },
                copy: 'Status events are audit evidence. They do not approve backfill, tenant isolation, or production readiness.',
                meta: [
                    ['Status changes', summary.statusChangedEventsCount ?? 0],
                    ['Terminal approved', summary.terminalApprovedCount ?? 0],
                    ['Latest status update', formatDate(summary.latestStatusUpdateTimestamp)],
                ],
            },
        ];
    }

    function tenantReviewFilters() {
        return {
            limit: 25,
            reviewStatus: byId('tenantReviewStatusFilter')?.value || undefined,
            issueCategory: byId('tenantReviewCategoryFilter')?.value || undefined,
            severity: byId('tenantReviewSeverityFilter')?.value || undefined,
            priority: byId('tenantReviewPriorityFilter')?.value || undefined,
            assetDomain: byId('tenantReviewDomainFilter')?.value || undefined,
        };
    }

    async function loadTenantAssetManualReviewEvidence() {
        const summaryNode = byId('tenantReviewSummary');
        setState('tenantReviewState', 'Loading tenant asset manual-review evidence...');
        clear(summaryNode);
        const res = await apiAdminTenantAssetManualReviewEvidence({ limit: 10, includeItems: false });
        if (!res.ok) {
            setState('tenantReviewState', '');
            renderUnavailable(summaryNode, res, 'Tenant asset manual-review evidence unavailable.');
            return null;
        }
        const report = res.data?.report || {};
        const summary = report.summary || {};
        renderCards(summaryNode, tenantReviewSummaryCards(summary));
        const safety = el('div', 'admin-control-chip-row');
        safety.append(
            badge('Access switch blocked', 'disabled'),
            badge('Backfill blocked', 'disabled'),
            badge('Tenant isolation not claimed', 'legacy'),
            badge('No R2 action', 'user'),
            badge('Review-state only', 'user'),
        );
        summaryNode.appendChild(safety);
        const statusText = [
            `Total ${summary.totalReviewItems ?? 0} review item${Number(summary.totalReviewItems || 0) === 1 ? '' : 's'}`,
            `events ${summary.totalEvents ?? 0}`,
            `latest import ${formatDate(summary.mostRecentImportTimestamp)}`,
            `latest status ${formatDate(summary.latestStatusUpdateTimestamp)}`,
        ].join(' | ');
        setState('tenantReviewState', statusText);
        return report;
    }

    function renderTenantReviewEvents(container, events) {
        const safeEvents = Array.isArray(events) ? events : [];
        if (!safeEvents.length) {
            container.appendChild(el('p', 'admin-shell__desc', 'No bounded event history returned for this item.'));
            return;
        }
        const { wrap, tbody } = table(['Event', 'Old', 'New', 'Actor', 'Reason', 'Created']);
        for (const event of safeEvents.slice(0, 25)) {
            const tr = document.createElement('tr');
            addCell(tr, readableToken(event.eventType));
            addCell(tr, readableToken(event.oldStatus));
            addCell(tr, readableToken(event.newStatus));
            addCell(tr, event.actorUserIdPresent ? 'Recorded' : '-');
            addCell(tr, event.reasonPresent ? 'Recorded' : '-');
            addCell(tr, formatDate(event.createdAt));
            tbody.appendChild(tr);
        }
        container.appendChild(wrap);
    }

    function appendTenantReviewStatusForm(container, item) {
        const allowed = allowedTenantReviewTransitions(item.reviewStatus);
        if (!allowed.length) {
            container.appendChild(el('p', 'admin-shell__desc', 'This review status has no outgoing transition in the Phase 6.17 workflow.'));
            return;
        }
        const form = el('form', 'admin-control-form');
        form.id = 'tenantReviewStatusForm';

        const statusField = el('label', 'admin-ai__field');
        statusField.appendChild(el('span', 'admin-ai__label', 'Next status'));
        const select = document.createElement('select');
        select.id = 'tenantReviewNextStatus';
        select.className = 'admin-ai__input';
        select.required = true;
        for (const status of allowed.filter((value) => TENANT_REVIEW_STATUSES.includes(value))) {
            const option = document.createElement('option');
            option.value = status;
            option.textContent = readableToken(status);
            select.appendChild(option);
        }
        statusField.appendChild(select);

        const reasonField = el('label', 'admin-ai__field');
        reasonField.appendChild(el('span', 'admin-ai__label', 'Operator reason'));
        const reason = document.createElement('textarea');
        reason.id = 'tenantReviewStatusReason';
        reason.className = 'admin-ai__textarea';
        reason.rows = 3;
        reason.maxLength = 500;
        reason.required = true;
        reason.placeholder = 'Record the manual review decision. This does not backfill ownership or change access checks.';
        reasonField.appendChild(reason);

        const confirmField = el('label', 'admin-ai__field admin-ai__field--inline');
        const checkbox = document.createElement('input');
        checkbox.id = 'tenantReviewStatusConfirm';
        checkbox.type = 'checkbox';
        checkbox.required = true;
        confirmField.appendChild(checkbox);
        confirmField.appendChild(el('span', null, 'I confirm this changes review-state rows only; it does not update assets, ownership metadata, access checks, R2, credits, or billing.'));

        const submit = el('button', 'admin-ai__run', 'Update Review Status');
        submit.type = 'submit';
        const state = el('div', 'admin-state');
        state.id = 'tenantReviewStatusUpdateState';
        state.setAttribute('aria-live', 'polite');

        form.append(statusField, reasonField, confirmField, submit, state);
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (tenantReviewStatusSubmitting) return;
            const newStatus = select.value;
            const reasonText = reason.value.trim();
            if (!newStatus || !reasonText || !checkbox.checked) {
                state.dataset.state = 'error';
                state.textContent = 'Next status, reason, and confirmation are required.';
                return;
            }
            const confirmed = window.confirm('Update this manual-review status? This records review-state evidence only and does not backfill ownership or change access behavior.');
            if (!confirmed) {
                state.dataset.state = 'neutral';
                state.textContent = 'Status update cancelled.';
                return;
            }
            tenantReviewStatusSubmitting = true;
            setSubmitting(submit, true);
            state.dataset.state = 'neutral';
            state.textContent = 'Recording review status update...';
            try {
                const res = await apiAdminUpdateTenantAssetManualReviewStatus(item.id, {
                    newStatus,
                    reason: reasonText,
                    confirm: true,
                    metadata: {
                        source: 'admin_control_plane',
                        phase: '6.18',
                    },
                    idempotencyKey: createIdempotencyKey('tenant-review-status'),
                });
                if (!res.ok) {
                    state.dataset.state = 'error';
                    state.textContent = apiUnavailableMessage(res, 'Manual-review status update failed.');
                    notify('Manual-review status update failed.', 'error');
                    return;
                }
                state.dataset.state = 'success';
                state.textContent = 'Manual-review status updated. No source asset rows were changed.';
                notify('Manual-review status updated.', 'success');
                await Promise.all([
                    loadTenantAssetManualReviewEvidence(),
                    loadTenantAssetManualReviewItems(),
                    loadTenantAssetManualReviewDetail(item.id),
                ]);
                setState('tenantReviewState', 'Manual-review status updated. No source asset rows were changed.', 'success');
            } finally {
                tenantReviewStatusSubmitting = false;
                setSubmitting(submit, false);
            }
        });
        container.appendChild(el('h3', 'admin-section-title', 'Review Status Update'));
        container.appendChild(el('p', 'admin-shell__desc', 'Status changes write only manual-review item/event rows. There is no backfill, access switch, source asset update, R2 action, provider call, Stripe call, or credit/billing action.'));
        container.appendChild(form);
    }

    async function loadTenantAssetManualReviewDetail(itemId) {
        const detail = byId('tenantReviewDetail');
        if (!detail) return;
        detail.hidden = false;
        detail.textContent = 'Loading manual-review item detail...';
        const res = await apiAdminTenantAssetManualReviewItem(itemId, { includeEvents: true });
        clear(detail);
        if (!res.ok) {
            renderUnavailable(detail, res, 'Manual-review item detail unavailable.');
            return;
        }
        const item = res.data?.item || {};
        selectedTenantReviewItemId = item.id || itemId;
        detail.appendChild(el('h3', 'admin-section-title', 'Tenant Asset Manual Review Detail'));
        detail.appendChild(detailRows([
            ['Review item', shortId(item.id)],
            ['Asset domain', item.assetDomain || '-'],
            ['Asset', shortId(item.assetId)],
            ['Issue category', readableToken(item.issueCategory)],
            ['Review status', readableToken(item.reviewStatus)],
            ['Severity', item.severity || '-'],
            ['Priority', item.priority || '-'],
            ['Evidence source', item.evidenceSourcePath || '-'],
            ['Created', formatDate(item.createdAt)],
            ['Updated', formatDate(item.updatedAt)],
            ['Reviewed at', formatDate(item.reviewedAt)],
            ['Safe notes', item.safeNotes || '-'],
        ]));
        detail.appendChild(el('h3', 'admin-section-title', 'Event History'));
        renderTenantReviewEvents(detail, item.events);
        appendTenantReviewStatusForm(detail, item);
    }

    async function loadTenantAssetManualReviewItems() {
        const list = byId('tenantReviewList');
        setState('tenantReviewItemsState', 'Loading manual-review queue...');
        clear(list);
        const res = await apiAdminTenantAssetManualReviewItems(tenantReviewFilters());
        if (!res.ok) {
            setState('tenantReviewItemsState', '');
            renderUnavailable(list, res, 'Manual-review queue unavailable.');
            return;
        }
        const items = Array.isArray(res.data?.items) ? res.data.items : [];
        if (!items.length) {
            setState('tenantReviewItemsState', 'No manual-review items found for the selected filters.');
            return;
        }
        setState('tenantReviewItemsState', `Showing ${items.length} of ${res.data?.total ?? items.length} review item${items.length === 1 ? '' : 's'}.`);
        const { wrap, tbody } = table(['Status', 'Category', 'Severity', 'Priority', 'Domain', 'Updated', 'Actions']);
        for (const item of items) {
            const tr = document.createElement('tr');
            addCell(tr, badge(readableToken(item.reviewStatus), tenantReviewStatusVariant(item.reviewStatus)));
            addCell(tr, readableToken(item.issueCategory));
            addCell(tr, badge(item.severity || '-', item.severity === 'critical' ? 'disabled' : variantFor(item.severity)));
            addCell(tr, item.priority || '-');
            addCell(tr, item.assetDomain || '-');
            addCell(tr, formatDate(item.updatedAt || item.createdAt));
            const button = el('button', 'btn-action', 'Inspect Review');
            button.type = 'button';
            button.addEventListener('click', () => loadTenantAssetManualReviewDetail(item.id));
            addCell(tr, button);
            tbody.appendChild(tr);
        }
        list.appendChild(wrap);
        if (!selectedTenantReviewItemId && items[0]?.id) {
            loadTenantAssetManualReviewDetail(items[0].id);
        }
    }

    async function loadTenantAssetManualReviewQueue() {
        await Promise.all([
            loadTenantAssetManualReviewEvidence(),
            loadTenantAssetManualReviewItems(),
        ]);
    }

    async function exportTenantAssetManualReviewEvidenceJson(button) {
        setSubmitting(button, true);
        setState('tenantReviewState', 'Preparing tenant asset manual-review JSON export...');
        try {
            const res = await apiAdminTenantAssetManualReviewEvidenceExport({
                format: 'json',
                limit: 50,
                includeItems: true,
            });
            if (!res.ok) {
                setState('tenantReviewState', apiUnavailableMessage(res, 'Tenant asset manual-review evidence export failed.'), 'error');
                notify('Tenant asset evidence export failed.', 'error');
                return;
            }
            const fallback = `tenant-asset-manual-review-evidence-${new Date().toISOString().slice(0, 10)}.json`;
            downloadTextFile(filenameFromContentDisposition(res.filename, fallback), res.text || '{}\n', res.contentType || 'application/json');
            setState('tenantReviewState', 'Manual-review evidence JSON export prepared. No backfill or access switch was performed.');
            notify('Tenant asset evidence export prepared.', 'success');
        } finally {
            setSubmitting(button, false);
        }
    }

    async function loadOperations() {
        await Promise.all([loadPoisonMessages(), loadFailedJobs(), loadTenantAssetManualReviewQueue()]);
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

    const TENANT_ASSET_FALLBACK_DOMAINS = Object.freeze([
        ['ai_folders', 'implemented_but_evidence_pending', 'yes_new_rows_only', 'legacy_user_id', 'yes', 'dry_run_and_gated_executor_limited', 'indirect_folder_rollup', 'yes', 'high'],
        ['ai_images', 'implemented_but_evidence_pending', 'yes_new_rows_only', 'legacy_user_id', 'yes', 'dry_run_and_gated_executor_limited', 'yes_size_bytes', 'yes', 'high'],
        ['ai_image_derivatives', 'evidence_pending', 'partial_parent_only', 'parent_ai_image_legacy_user_id', 'partial', 'dry_run_only_derivative_cleanup_required', 'partial_parent_size_only', 'partial_redacted_counts', 'high'],
        ['ai_text_assets', 'deferred', 'no', 'legacy_user_id', 'no', 'deferred_existing_delete_paths_only', 'yes_size_bytes', 'yes_assets_manager', 'high'],
        ['member_music_audio_assets', 'deferred', 'no', 'legacy_user_id', 'no', 'deferred_existing_delete_paths_only', 'yes_size_bytes_and_poster_size_bytes', 'yes_assets_manager', 'high'],
        ['member_video_assets', 'deferred', 'no', 'legacy_user_id_or_job_scope', 'no', 'deferred_existing_delete_paths_only', 'partial', 'partial', 'high'],
        ['profile_avatars', 'deferred', 'no', 'profile_user_id', 'no', 'deferred', 'no', 'partial_latest_avatar_view', 'medium'],
        ['data_lifecycle_exports', 'implemented_but_operator_evidence_pending', 'separate_lifecycle_model', 'admin_only_archive_read', 'not_applicable', 'not_applicable', 'no', 'yes', 'high'],
        ['r2_user_images', 'evidence_pending', 'partial_parent_only', 'D1 parent lookup', 'partial', 'blocked_without_parent_evidence', 'partial_d1_bytes_only', 'redacted_only', 'blocked'],
    ]).map(([id, currentStatus, ownershipMetadataSupport, runtimeAccessCheckSource, manualReviewSupport, resetSupport, quotaStorageAccountingSupport, adminVisibilitySupport, deletionResetRisk]) => ({
        id,
        label: readableToken(id),
        currentStatus,
        ownershipMetadataSupport,
        runtimeAccessCheckSource,
        manualReviewSupport,
        resetSupport,
        quotaStorageAccountingSupport,
        adminVisibilitySupport,
        deletionResetRisk,
    }));

    function normalizeTenantDomainReport(data) {
        const report = data?.report || data?.data?.report || null;
        if (report && Array.isArray(report.domains)) return report;
        return {
            source: 'frontend_static_fallback',
            generatedAt: new Date().toISOString(),
            noBackfill: true,
            noAccessSwitch: true,
            tenantIsolationClaimed: false,
            productionReadiness: 'blocked',
            liveBillingReadiness: 'blocked',
            ownershipBackfillReadiness: 'blocked',
            accessSwitchReadiness: 'blocked',
            confirmedResetReadiness: 'blocked',
            blockedClaims: [
                'tenant isolation is not claimed',
                'ownership backfill readiness remains blocked',
                'access-switch readiness remains blocked',
                'confirmed legacy media reset readiness remains blocked',
            ],
            domains: TENANT_ASSET_FALLBACK_DOMAINS,
            limitations: [
                'Backend domain evidence endpoint unavailable; static fallback is not live evidence.',
                'No R2 listing, mutation, backfill, access-switching, or reset action is available from this panel.',
            ],
        };
    }

    function renderTenantDomainMatrix(container, domains = []) {
        const wrap = el('div', 'admin-credit-modal__table-wrap admin-usage-modal__table-wrap');
        const table = el('table', 'admin-table admin-usage-modal__table');
        const thead = el('thead');
        const head = el('tr');
        ['Domain', 'Status', 'Ownership', 'Access check', 'Manual review', 'Reset', 'Quota', 'Admin visibility', 'Risk'].forEach((label) => {
            head.appendChild(el('th', '', label));
        });
        thead.appendChild(head);
        table.appendChild(thead);
        const tbody = el('tbody');
        for (const domain of domains) {
            const tr = el('tr');
            tr.appendChild(el('td', 'admin-usage-modal__asset-name', domain.label || readableToken(domain.id)));
            const statusCell = el('td');
            statusCell.appendChild(badge(statusLabel(domain.currentStatus), statusVariant(domain.currentStatus)));
            tr.appendChild(statusCell);
            [
                domain.ownershipMetadataSupport,
                domain.runtimeAccessCheckSource,
                domain.manualReviewSupport,
                domain.resetSupport,
                domain.quotaStorageAccountingSupport,
                domain.adminVisibilitySupport,
                domain.deletionResetRisk,
            ].forEach((value) => tr.appendChild(el('td', '', statusLabel(value))));
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        wrap.appendChild(table);
        container.appendChild(wrap);
    }

    function renderTenantBlockedActions(container) {
        const section = readinessSection('Blocked Actions', 'Visible operator boundaries. These actions are not executable from the Admin Control Plane.');
        const grid = el('div', 'admin-control-grid');
        for (const item of [
            ['Ownership backfill', 'blocked'],
            ['Access switch', 'blocked'],
            ['Confirmed legacy reset', 'blocked'],
            ['Live R2 listing/deletion', 'not_available'],
        ]) {
            const card = el('article', 'admin-control-card glass glass-card reveal visible');
            const top = el('div', 'admin-control-card__top');
            top.append(el('h3', 'admin-section-title', item[0]), badge(statusLabel(item[1]), 'disabled'));
            card.append(top, el('p', 'admin-shell__desc', 'Requires separate approved evidence and implementation package. This dashboard offers no execution control.'));
            grid.appendChild(card);
        }
        section.appendChild(grid);
        container.appendChild(section);
    }

    async function renderTenantAssets() {
        const container = byId('tenantAssetCenter');
        if (!container) return;
        clear(container);
        container.appendChild(el('div', 'admin-state', 'Loading tenant asset domain evidence...'));
        const res = await apiAdminTenantAssetDomainEvidence();
        const report = normalizeTenantDomainReport(res.ok ? res.data : null);
        clear(container);

        const hero = el('div', 'admin-control-hero glass glass-card reveal visible');
        const copy = el('div');
        copy.append(el('p', 'admin-control-hero__eyebrow', 'Tenant Asset Center'));
        copy.append(el('h2', 'admin-control-hero__title', 'Cross-domain ownership inventory, evidence gaps, and storage safety.'));
        copy.append(el('p', 'admin-control-hero__copy', 'This panel is read-only evidence and admin visibility. It does not claim tenant isolation, perform ownership backfill, switch runtime access checks, execute reset/delete operations, or list live R2.'));
        const facts = detailRows([
            ['Evidence source', report.source || 'repo registry'],
            ['Generated', report.generatedAt || 'not reported'],
            ['No backfill', report.noBackfill === true ? 'true' : 'not reported'],
            ['No access switch', report.noAccessSwitch === true ? 'true' : 'not reported'],
            ['Tenant isolation claimed', report.tenantIsolationClaimed === true ? 'true' : 'false'],
            ['Production readiness', report.productionReadiness || 'blocked'],
        ]);
        hero.append(copy, facts);
        container.appendChild(hero);

        const matrix = readinessSection('Tenant Asset Domain Matrix', 'Broader current-state domain inventory. Metrics are D1 metadata only when available and never live R2 proof.');
        renderTenantDomainMatrix(matrix, report.domains || []);
        container.appendChild(matrix);

        const evidence = readinessSection('Evidence Actions', 'Safe copy/open actions only. No browser shell execution and no destructive admin action.');
        const actions = el('div', 'admin-control-chip-row');
        const refresh = el('button', 'btn-action', 'Refresh domain evidence');
        refresh.type = 'button';
        refresh.addEventListener('click', () => { void renderTenantAssets(); });
        actions.appendChild(refresh);
        for (const [label, value] of [
            ['Copy domain roadmap path', 'docs/tenant-assets/TENANT_ASSET_DOMAIN_EXPANSION_ROADMAP.md'],
            ['Copy manual-review evidence template path', 'docs/tenant-assets/MANUAL_REVIEW_IDEMPOTENCY_EVIDENCE_TEMPLATE.md'],
            ['Copy legacy reset evidence template path', 'docs/tenant-assets/LEGACY_MEDIA_RESET_SANITIZED_DRY_RUN_EVIDENCE_TEMPLATE.md'],
        ]) {
            const button = el('button', 'btn-action btn-action--secondary', label);
            button.type = 'button';
            button.addEventListener('click', async () => {
                const copied = await copyTextToClipboard(value);
                notify(copied ? `${label.replace(/^Copy /, '')} copied.` : 'Copy failed.', copied ? 'success' : 'error');
            });
            actions.appendChild(button);
        }
        const reviewLink = el('a', 'btn-action', 'Open manual-review queue');
        reviewLink.href = '#operations';
        actions.appendChild(reviewLink);
        evidence.appendChild(actions);
        const blockedClaims = el('div', 'admin-control-chip-row');
        for (const claim of report.blockedClaims || []) {
            blockedClaims.appendChild(badge(claim, 'disabled'));
        }
        evidence.appendChild(blockedClaims);
        container.appendChild(evidence);

        const storage = readinessSection('Storage Safety', 'Selected-user storage reconciliation is available from Admin Users > Usage. It uses D1 metadata only.');
        storage.appendChild(readinessCards([
            {
                title: 'Reconciliation dry-run',
                status: 'available',
                copy: 'Computes recorded usage, known D1 asset bytes, delta, missing byte metadata, public/private counts, folder count, and orphan metadata. It does not list R2 or fix counters.',
                meta: [
                    ['Mutation', 'none'],
                    ['R2 listing', 'not performed'],
                    ['Tenant isolation claim', 'false'],
                ],
            },
            {
                title: 'Future quota evidence',
                status: 'required',
                copy: 'Quota/storage evidence is required before any reset/delete/backfill/access-switch claim can be considered.',
                meta: [
                    ['Accepted proof', 'operator evidence plus local tests'],
                    ['Automatic repair', 'not implemented here'],
                ],
            },
        ], (item) => ({
            title: item.title,
            badge: { label: item.status, variant: statusVariant(item.status) },
            copy: item.copy,
            meta: item.meta,
        })));
        container.appendChild(storage);

        renderTenantBlockedActions(container);
        if (!res.ok) {
            renderUnavailable(container, res, 'Tenant asset domain evidence endpoint unavailable; static fallback shown.');
        }
    }

    function readinessSection(title, desc) {
        const section = el('section', 'admin-control-subsection');
        const header = el('div', 'admin-control-subsection__header');
        const copy = el('div');
        copy.append(el('h3', 'admin-section-title', title));
        if (desc) copy.append(el('p', 'admin-shell__desc', desc));
        header.appendChild(copy);
        section.appendChild(header);
        return section;
    }

    function readinessCards(items, mapper) {
        const holder = el('div');
        renderCards(holder, items.map(mapper));
        return holder.firstElementChild || holder;
    }

    function renderReadinessHero(container, status, sourceLabel) {
        const release = status.releaseTruth || {};
        const hero = el('div', 'admin-control-hero glass glass-card reveal visible');
        const copy = el('div');
        copy.append(el('p', 'admin-control-hero__eyebrow', 'Readiness & Evidence Dashboard'));
        copy.append(el('h2', 'admin-control-hero__title', 'Current platform state, blocked claims, and safe operator actions.'));
        copy.append(el('p', 'admin-control-hero__copy', 'This dashboard centralizes repo-supported OMEGA/P1 readiness state. It does not prove live deploy status, live billing readiness, tenant isolation, ownership backfill readiness, access-switch readiness, or confirmed reset readiness.'));
        const badges = el('div', 'admin-control-hero__badges');
        badges.append(
            badge('Production blocked', 'disabled'),
            badge('Live billing blocked', 'disabled'),
            badge('Tenant isolation not claimed', 'legacy'),
            badge('Reset not approved', 'disabled'),
            badge(sourceLabel, sourceLabel === 'Backend status' ? 'active' : 'legacy'),
        );
        hero.append(copy, badges);
        container.appendChild(hero);

        const releaseSection = readinessSection('Current Release Truth', 'Repo truth is useful operator context, not live deploy proof.');
        releaseSection.appendChild(readinessCards([
            {
                title: 'Auth schema checkpoint',
                status: release.latestAuthMigration || CURRENT_AUTH_SCHEMA_CHECKPOINT,
                copy: `Latest auth migration from ${release.source || 'config/release-compat.json'}. Operator must verify remote D1 status before dependent Auth Worker deploys.`,
                meta: [
                    ['Migration directory', release.migrationDirectory || 'workers/auth/migrations'],
                    ['Database', release.databaseName || 'bitbi-auth-db'],
                ],
            },
            {
                title: 'Deploy separation',
                status: 'operator verification required',
                copy: 'Static Pages, Auth Worker, AI Worker, and Contact Worker deploy separately. Release plan output must be reviewed before any main release.',
                meta: [
                    ['Deploy units', Array.isArray(release.deployUnits) ? release.deployUnits.join(', ') : 'auth Worker, AI Worker, contact Worker, static Pages'],
                    ['Live deploy proof', release.repoTruthIsLiveDeployProof ? 'Claimed' : 'Not claimed'],
                ],
            },
        ], (item) => ({
            title: item.title,
            badge: { label: item.status, variant: statusVariant(item.status) },
            copy: item.copy,
            meta: item.meta,
        })));
        container.appendChild(releaseSection);
    }

    function renderReadinessStatusGrid(container, title, desc, items) {
        const section = readinessSection(title, desc);
        section.appendChild(readinessCards(items, (item) => ({
            title: item.label || item.title,
            badge: { label: statusLabel(item.status || item.expected || 'not reported'), variant: statusVariant(item.status || item.expected) },
            copy: item.copy || item.summary || item.message || 'Current-state operator signal. Verify live state separately where applicable.',
            meta: item.expected || item.enabled !== undefined
                ? [
                    ['Expected', item.expected || '-'],
                    ['Enabled', item.enabled === true ? 'Yes' : item.enabled === false ? 'No' : 'Not applicable'],
                    ['Raw value exposed', item.rawValueExposed === true ? 'Yes' : 'No'],
                ]
                : undefined,
        })));
        container.appendChild(section);
    }

    function renderLiveEvidenceState(container, status) {
        const state = status.liveEvidenceState || READINESS_FALLBACK_STATUS.liveEvidenceState;
        const cutover = status.cutoverEvidence || READINESS_FALLBACK_STATUS.cutoverEvidence;
        const pendingChecks = Array.isArray(state.pendingChecks) ? state.pendingChecks : [];
        const manifestFields = Array.isArray(state.latestExpectedManifestFields) ? state.latestExpectedManifestFields : [];
        const commands = Array.isArray(cutover.commands) ? cutover.commands : [];
        const section = readinessSection('Live Evidence State', 'Repo-supported controls are distinct from deployed, operator-verified live evidence.');
        const grid = el('div', 'admin-control-grid');

        const liveCard = el('article', 'admin-control-card glass glass-card reveal visible');
        const liveTop = el('div', 'admin-control-card__top');
        liveTop.append(el('h3', 'admin-section-title', 'Live runtime proof'), badge(statusLabel(state.status), statusVariant(state.status)));
        liveCard.append(liveTop, el('p', 'admin-shell__desc', state.caveat || 'No live evidence is collected by the repo alone. Operator read-only evidence remains required.'));
        liveCard.appendChild(detailRows([
            ['Repo supported', state.repoSupported === true ? 'Yes' : 'No'],
            ['Deploy pending until operator proof', state.deployPendingUntilOperatorProof === true ? 'Yes' : 'No'],
            ['Evidence collected by repo alone', state.liveEvidenceCollectedByRepoAlone === true ? 'Yes' : 'No'],
            ['Pending checks', pendingChecks.length ? pendingChecks.join(', ') : 'Not reported'],
        ]));
        grid.appendChild(liveCard);

        const manifestCard = el('article', 'admin-control-card glass glass-card reveal visible');
        const manifestTop = el('div', 'admin-control-card__top');
        manifestTop.append(el('h3', 'admin-section-title', 'Release cutover manifest'), badge('Copy-only', 'user'));
        manifestCard.append(manifestTop, el('p', 'admin-shell__desc', 'Generate expected-state evidence before deploy; save sanitized output under the production-readiness evidence directory.'));
        manifestCard.appendChild(detailRows([
            ['Output path', cutover.outputDirectory || 'docs/production-readiness/evidence/'],
            ['Manifest fields', manifestFields.length ? manifestFields.join(', ') : 'Not reported'],
            ['Browser executes commands', cutover.browserExecutesCommands === true ? 'Yes' : 'No'],
            ['Deploy or migration from command', cutover.noDeployOrMigration === true ? 'No' : 'Not reported'],
        ]));
        const actions = el('div', 'admin-control-chip-row');
        const commandButton = el('button', 'btn-action', 'Copy cutover commands');
        commandButton.type = 'button';
        commandButton.addEventListener('click', async () => {
            const copied = await copyTextToClipboard(commands.join('\n'));
            notify(copied ? 'Cutover evidence commands copied.' : 'Command copy failed.', copied ? 'success' : 'error');
        });
        const pathButton = el('button', 'btn-action', 'Copy evidence save path');
        pathButton.type = 'button';
        pathButton.addEventListener('click', async () => {
            const copied = await copyTextToClipboard(cutover.outputDirectory || 'docs/production-readiness/evidence/');
            notify(copied ? 'Evidence path copied.' : 'Evidence path copy failed.', copied ? 'success' : 'error');
        });
        actions.append(commandButton, pathButton);
        manifestCard.appendChild(actions);
        grid.appendChild(manifestCard);

        section.appendChild(grid);
        container.appendChild(section);
    }

    function renderEvidenceCenter(container) {
        const section = readinessSection('Evidence Center', 'Evidence status is intentionally conservative. Pending evidence remains blocking until sanitized operator proof is accepted.');
        const grid = el('div', 'admin-control-grid');
        const cards = [
            {
                title: 'Legacy Media Reset Dry-run Evidence',
                badge: { label: 'Pending sanitized evidence', variant: 'disabled' },
                copy: 'Current status is rejected unsafe / pending sanitized evidence. Confirmed reset execution is not offered here and remains hard-disabled by default.',
                meta: [
                    ['Template', 'docs/tenant-assets/LEGACY_MEDIA_RESET_SANITIZED_DRY_RUN_EVIDENCE_TEMPLATE.md'],
                    ['Decision', 'docs/tenant-assets/evidence/LEGACY_MEDIA_RESET_DRY_RUN_EVIDENCE_DECISION.md'],
                    ['Required', 'dryRun:true, no deletion, no raw idempotency keys, no raw private R2 keys'],
                ],
                actions: [
                    { label: 'Copy template path', copy: 'docs/tenant-assets/LEGACY_MEDIA_RESET_SANITIZED_DRY_RUN_EVIDENCE_TEMPLATE.md' },
                    { label: 'Download dry-run report', onClick: (button) => exportLegacyMediaResetDryRunJson(button) },
                ],
            },
            {
                title: 'Manual Review Idempotency Evidence',
                badge: { label: 'Needs replay/conflict proof', variant: 'disabled' },
                copy: 'Existing operator evidence still needs import replay, import conflict, standalone status success, status replay, status conflict, and item/event readback evidence.',
                meta: [
                    ['Template', 'docs/tenant-assets/MANUAL_REVIEW_IDEMPOTENCY_EVIDENCE_TEMPLATE.md'],
                    ['Decision', 'docs/tenant-assets/evidence/MANUAL_REVIEW_STATUS_OPERATOR_EVIDENCE_DECISION.md'],
                    ['Scope', 'Review-state only; no backfill or access switch'],
                ],
                actions: [
                    { label: 'Copy template path', copy: 'docs/tenant-assets/MANUAL_REVIEW_IDEMPOTENCY_EVIDENCE_TEMPLATE.md' },
                    { label: 'Export manual-review evidence', onClick: (button) => exportTenantAssetManualReviewEvidenceJson(button) },
                ],
            },
            {
                title: 'Production Readiness Evidence',
                badge: { label: 'Blocked / pending', variant: 'disabled' },
                copy: 'Required categories include release plan, remote migration verification, Worker/static deploy evidence, bindings/secrets, health/security headers, alerts/WAF/RUM, rollback, and canaries.',
                meta: [
                    ['Template', 'docs/production-readiness/EVIDENCE_TEMPLATE.md'],
                    ['Current state', 'Not production-ready'],
                ],
                actions: [
                    { label: 'Copy template path', copy: 'docs/production-readiness/EVIDENCE_TEMPLATE.md' },
                ],
            },
            {
                title: 'Live Billing Evidence',
                badge: { label: 'Blocked / pending', variant: 'disabled' },
                copy: 'Live Stripe readiness requires live config, live checkout canary, verified webhook receipt, duplicate webhook idempotency, review workflow, and redacted evidence.',
                meta: [
                    ['Current state', 'Live billing readiness blocked'],
                    ['Stripe actions', 'Not available from this dashboard'],
                ],
            },
            {
                title: 'AI Budget / Platform Evidence',
                badge: { label: 'Implemented scopes; live evidence pending', variant: 'legacy' },
                copy: 'Selected admin/platform budget controls exist. Live platform evidence remains required before readiness claims.',
                meta: [
                    ['Open panel', 'Budget Switches'],
                    ['Customer billing', 'Not implied'],
                ],
                href: '#ai-budget-switches',
            },
        ];
        for (const card of cards) {
            const item = el('article', 'admin-control-card glass glass-card reveal visible');
            const top = el('div', 'admin-control-card__top');
            top.append(el('h3', 'admin-section-title', card.title), badge(card.badge.label, card.badge.variant));
            item.append(top, el('p', 'admin-shell__desc', card.copy));
            if (card.meta) item.appendChild(detailRows(card.meta));
            const actions = el('div', 'admin-control-chip-row');
            if (card.href) {
                const link = el('a', 'btn-action', 'Open existing panel');
                link.href = card.href;
                actions.appendChild(link);
            }
            for (const action of card.actions || []) {
                const button = el('button', 'btn-action', action.label);
                button.type = 'button';
                button.addEventListener('click', async () => {
                    if (action.copy) {
                        const copied = await copyTextToClipboard(action.copy);
                        notify(copied ? 'Evidence path copied.' : 'Copy failed.', copied ? 'success' : 'error');
                        return;
                    }
                    await action.onClick?.(button);
                });
                actions.appendChild(button);
            }
            item.appendChild(actions);
            grid.appendChild(item);
        }
        section.appendChild(grid);
        container.appendChild(section);
    }

    function renderOperatorActions(container) {
        const section = readinessSection('Operator Actions', 'Safe actions are inspection, export, refresh, and copy-only guidance. Dangerous actions are intentionally absent or disabled.');
        section.appendChild(readinessCards([
            {
                title: 'Safe inspection and export',
                status: 'available',
                copy: 'Refresh this dashboard, open existing panels, export already sanitized evidence, and copy local commands for an operator terminal.',
                meta: [
                    ['Open controls', 'Billing Events, AI Budget Switches, Data Lifecycle, Operations, Activity'],
                    ['Browser command execution', 'Not implemented'],
                ],
            },
            {
                title: 'Dangerous actions not offered',
                status: 'blocked',
                copy: 'No button enables legacy reset execution, confirmed reset/delete, ownership backfill, access-switching, live billing enablement, deploys, remote migrations, or Stripe/provider/Cloudflare/GitHub mutation.',
                meta: [
                    ['Reset gate', 'Do not enable'],
                    ['Confirmed deletion/reset', 'Not approved'],
                ],
            },
        ], (item) => ({
            title: item.title,
            badge: { label: item.status, variant: statusVariant(item.status) },
            copy: item.copy,
            meta: item.meta,
        })));
        const links = el('div', 'admin-control-chip-row');
        for (const [label, href] of [
            ['Billing Events', '#billing-events'],
            ['AI Budget Controls', '#ai-budget-switches'],
            ['Data Lifecycle', '#lifecycle'],
            ['Tenant Manual Review', '#operations'],
            ['Activity Log', '#activity'],
        ]) {
            const link = el('a', 'btn-action', label);
            link.href = href;
            links.appendChild(link);
        }
        section.appendChild(links);
        container.appendChild(section);
    }

    function renderCommandCenter(container) {
        const section = readinessSection('Command Center', 'Copy-only local/operator commands. The browser never executes shell commands.');
        const grid = el('div', 'admin-control-grid');
        for (const group of READINESS_COMMAND_GROUPS) {
            const card = el('article', 'admin-control-card glass glass-card reveal visible');
            const top = el('div', 'admin-control-card__top');
            top.append(el('h3', 'admin-section-title', group.title), badge('Copy-only', 'user'));
            card.append(top, el('p', 'admin-shell__desc', group.note));
            const pre = el('pre', 'admin-command-block');
            pre.textContent = group.commands.join('\n');
            const button = el('button', 'btn-action', 'Copy commands');
            button.type = 'button';
            button.addEventListener('click', async () => {
                const copied = await copyTextToClipboard(group.commands.join('\n'));
                notify(copied ? `${group.title} commands copied.` : 'Command copy failed.', copied ? 'success' : 'error');
            });
            card.append(pre, button);
            grid.appendChild(card);
        }
        const warning = el('p', 'admin-shell__desc', 'Manual deploy commands are intentionally not one-click actions. Do not enable ENABLE_LEGACY_MEDIA_RESET_CONFIRMED_EXECUTION from this dashboard.');
        section.append(grid, warning);
        container.appendChild(section);
    }

    async function exportLegacyMediaResetDryRunJson(button) {
        setSubmitting(button, true);
        setState('readinessStatusState', 'Preparing legacy media reset dry-run evidence export...');
        try {
            const res = await apiAdminLegacyMediaResetDryRunExport({ format: 'json', limit: 50 });
            if (!res.ok) {
                setState('readinessStatusState', apiUnavailableMessage(res, 'Legacy reset dry-run export unavailable.'), 'error');
                notify('Legacy reset dry-run export unavailable.', 'error');
                return;
            }
            const fallback = `legacy-media-reset-dry-run-${new Date().toISOString().slice(0, 10)}.json`;
            downloadTextFile(filenameFromContentDisposition(res.filename, fallback), res.text || '{}\n', res.contentType || 'application/json');
            setState('readinessStatusState', 'Legacy reset dry-run JSON export prepared. No reset or deletion was executed.', 'success');
            notify('Legacy reset dry-run export prepared.', 'success');
        } finally {
            setSubmitting(button, false);
        }
    }

    async function renderReadiness() {
        const container = byId('readinessChecklist');
        if (!container) return;
        clear(container);
        const toolbar = el('div', 'admin-control-toolbar glass glass-card reveal visible');
        const copy = el('div');
        copy.append(el('h3', 'admin-section-title', 'Readiness & Evidence'));
        copy.append(el('p', 'admin-shell__desc', 'Central operator cockpit for release truth, blocked claims, hardening status, evidence gaps, and safe command copy.'));
        const refresh = el('button', 'btn-action', 'Refresh status');
        refresh.type = 'button';
        refresh.addEventListener('click', () => {
            void renderReadiness();
        });
        toolbar.append(copy, refresh);
        container.appendChild(toolbar);
        const state = el('div', 'admin-state');
        state.id = 'readinessStatusState';
        state.textContent = 'Loading readiness status...';
        container.appendChild(state);

        const res = await apiAdminReadinessStatus();
        const status = normalizeReadinessStatus(res.ok ? res.data : null);
        const sourceLabel = res.ok ? 'Backend status' : 'Static fallback';
        setState(
            'readinessStatusState',
            res.ok
                ? 'Read-only readiness status loaded. No provider, Stripe, R2, reset, backfill, access-switch, deploy, or migration action was performed.'
                : 'Backend readiness status unavailable; rendering static current-state fallback. Operator verification remains required.',
            res.ok ? 'success' : 'error',
        );

        renderReadinessHero(container, status, sourceLabel);
        renderLiveEvidenceState(container, status);
        renderReadinessStatusGrid(container, 'Blocked Claims', 'These claims remain blocked or unclaimed unless separate operator evidence proves otherwise.', status.blockedClaims);
        renderReadinessStatusGrid(container, 'P0/P1 Hardening Status', 'Implemented means repo-supported/current-state, not proven live.', status.hardeningStatus);
        renderReadinessStatusGrid(container, 'Runtime Safety Gates', 'Safety gates and controls are shown as operator signals; missing gate values are safe/default-off unless explicitly enabled.', status.runtimeSafetyGates);
        renderReadinessStatusGrid(container, 'Evidence Status', 'Evidence gaps stay visible because they block readiness claims.', status.evidenceStatuses);
        renderEvidenceCenter(container);
        renderOperatorActions(container);
        renderCommandCenter(container);
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
        byId('tenantReviewRefresh')?.addEventListener('click', loadTenantAssetManualReviewQueue);
        byId('tenantReviewExportJson')?.addEventListener('click', (event) => {
            exportTenantAssetManualReviewEvidenceJson(event.currentTarget);
        });
        byId('tenantReviewFilter')?.addEventListener('submit', (event) => {
            event.preventDefault();
            selectedTenantReviewItemId = '';
            loadTenantAssetManualReviewItems();
        });
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
            await renderReadiness();
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
        if (sectionName === 'tenant-assets') await renderTenantAssets();
    }

    return {
        bind,
        load,
        sections: CONTROL_SECTIONS,
    };
}
