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
    apiAdminBillingEvidenceStatus,
    apiAdminBillingEvents,
    apiAdminBillingPlans,
    apiAdminBillingReconciliation,
    apiAdminBillingReview,
    apiAdminBillingReviews,
    apiAdminResolveBillingReview,
    apiAdminDataLifecycleArchives,
    apiAdminDataLifecycleApprove,
    apiAdminDataLifecycleClose,
    apiAdminDataLifecycleComplete,
    apiAdminDataLifecycleExecuteSafe,
    apiAdminDataLifecycleGenerateExport,
    apiAdminDataLifecycleGeneratePlan,
    apiAdminDataLifecycleRequest,
    apiAdminDataLifecycleRequestEvidence,
    apiAdminDataLifecycleRequestExport,
    apiAdminDataLifecycleRequests,
    apiAdminDataLifecycleReject,
    apiAdminAccessSwitchShadowDiagnostics,
    apiAdminAccessSwitchStatus,
    apiAdminGrantOrganizationCredits,
    apiAdminGrantUserCredits,
    apiAdminLegacyMediaResetDryRunExport,
    apiAdminLegacyMediaResetStatus,
    apiAdminOwnershipBackfillDryRun,
    apiAdminOwnershipBackfillExecute,
    apiAdminOrganization,
    apiAdminOrganizationBilling,
    apiAdminOrganizations,
    apiAdminOperationsTimeline,
    apiAdminReadinessStatus,
    apiAdminTenantAssetDomainEvidence,
    apiAdminTenantIsolationEvidenceExport,
    apiAdminTenantAssetManualReviewEvidence,
    apiAdminTenantAssetManualReviewEvidenceExport,
    apiAdminTenantAssetManualReviewItem,
    apiAdminTenantAssetManualReviewItems,
    apiAdminTenantAssetManualReviewPostCleanupDryRun,
    apiAdminTenantAssetManualReviewPostCleanupEvidenceExport,
    apiAdminTenantAssetManualReviewPostCleanupSupersede,
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

const TENANT_REVIEW_SUPERSEDE_CONFIRMATION = 'SUPERSEDE STALE REVIEW ITEMS';

const CURRENT_AUTH_SCHEMA_CHECKPOINT = '0059_add_data_lifecycle_completion_state.sql';

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
    productionExecution: {
        status: 'blocked',
        repoSupported: true,
        deployPending: true,
        liveEvidencePending: true,
        productionReadiness: 'blocked',
        repoTruthIsLiveProof: false,
        noBrowserDeploy: true,
        noBrowserMigration: true,
        noBrowserRollback: true,
        safeStateSummary: 'Repo-supported production execution framework is available; deploy-pending and live-evidence-pending remain until operator proof is attached.',
    },
    cloudflareResourceModel: {
        status: 'repo_declared_live_verification_required',
        command: 'npm run cloudflare:resource-model',
        markdownCommand: 'npm run cloudflare:resource-model:markdown',
        repoDeclaredResources: [
            'Workers: bitbi-auth, bitbi-ai, bitbi-contact',
            'Routes: bitbi.ai/api/*, contact.bitbi.ai',
            'D1: bitbi-auth-db',
            'R2: PRIVATE_MEDIA, USER_IMAGES, AUDIT_ARCHIVE',
            'Queues: ACTIVITY_INGEST_QUEUE, AI_IMAGE_DERIVATIVES_QUEUE, AI_VIDEO_JOBS_QUEUE',
        ],
        dashboardManagedRequirements: [
            'WAF/rate limits',
            'Static security Transform Rules',
            'RUM setting',
            'Alerts',
            'Cloudflare secrets and optional feature flags by name only',
        ],
        liveVerificationRequired: true,
        cloudflareApiCallsMade: false,
        secretValuesExposed: false,
    },
    readinessDossier: {
        status: 'local_only_available',
        commands: ['npm run readiness:dossier', 'npm run readiness:dossier:markdown'],
        outputFormats: ['json', 'markdown'],
        productionReadiness: 'blocked',
        liveBillingReadiness: 'blocked',
        defaultLiveCalls: false,
    },
    postDeployVerification: {
        status: 'pending_operator_run',
        command: 'npm run readiness:live-readonly -- --static-url https://bitbi.ai --auth-worker-url https://bitbi.ai --admin-readiness-url https://bitbi.ai',
        getOnlyByDefault: true,
        adminCookieRequiredForAdminPanels: true,
        adminCookieValueRendered: false,
        checks: [
            'public health endpoint',
            'static security headers',
            'unknown API safe failure shape',
            'admin readiness/billing/timeline/tenant checks when cookie is provided',
        ],
    },
    rollbackDrill: {
        status: 'template_available_not_executed',
        command: 'npm run release:rollback-drill',
        rollbackExecuted: false,
        ownerPlaceholder: 'operator to fill',
        requiredEvidence: [
            'previous Worker versions/deploy IDs',
            'previous static artifact/deploy ID',
            'rollback owner',
            'post-rollback smoke evidence',
        ],
    },
    releaseCandidate: {
        status: 'repo_supported_ci_pending_live_evidence_pending',
        productionReadiness: 'blocked',
        liveBillingReadiness: 'blocked',
        releaseCandidateUse: 'code_merge_or_deploy_preparation_only',
        ciStatus: 'unknown_until_operator_runs_matrix',
        commands: [
            'npm run rc:check',
            'npm run release:rc',
            'npm run release:rc:markdown',
            'npm run readiness:dossier:markdown',
            'npm run release:rollback-drill',
            'npm run release:plan',
        ],
        checklist: [
            'clean worktree',
            'all audits pass',
            'full test matrix pass',
            'release plan reviewed',
            'cutover evidence generated',
            'readiness dossier generated',
            'rollback drill generated',
            'live read-only evidence pending or attached',
            'blocked claims acknowledged',
        ],
        waveMatrix: [
            'P0-01 through P0-05 repo-supported; evidence blockers remain visible',
            'P1 Waves 1-9 repo-supported; live/manual evidence remains pending where applicable',
            'P1 Wave 10 RC framework is local-only and does not prove production readiness',
        ],
        dangerousActionsOffered: false,
        browserExecutesCommands: false,
    },
    cutoverEvidence: {
        outputDirectory: 'docs/production-readiness/evidence/',
        commands: [
            'npm run rc:check',
            'npm run release:rc:markdown',
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
        { label: 'P1 Wave 9 production execution framework', status: 'implemented_repo_supported_live_evidence_pending' },
        { label: 'P1 Wave 10 release candidate consolidation', status: 'implemented_repo_supported_go_no_go_blocked' },
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
        { label: 'Cloudflare resource verification model', status: 'implemented_repo_supported_live_evidence_pending' },
        { label: 'Production readiness execution dossier', status: 'implemented_repo_supported_local_only' },
        { label: 'Rollback drill framework', status: 'implemented_repo_supported_not_executed' },
        { label: 'Release Candidate Go/No-Go manifest', status: 'implemented_repo_supported_local_only_blocked_verdict' },
        { label: 'Final RC validation matrix', status: 'implemented_plan_only_by_default' },
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
        title: 'Release Candidate',
        note: 'Copy-only RC handoff and Go/No-Go commands. rc:check prints the local validation matrix by default.',
        commands: [
            'npm run rc:check',
            'npm run release:rc',
            'npm run release:rc:markdown',
            'npm run readiness:dossier:markdown',
            'npm run release:rollback-drill',
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
        title: 'Production execution framework',
        note: 'Local-only production dossier, Cloudflare resource model, and rollback drill. These commands do not call live APIs by default or execute rollback.',
        commands: [
            'npm run readiness:dossier',
            'npm run readiness:dossier:markdown',
            'npm run cloudflare:resource-model',
            'npm run cloudflare:resource-model:markdown',
            'npm run release:rollback-drill',
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
    {
        title: 'Operator timeline / evidence index',
        note: 'Local evidence inventory and operator triage checks. These do not read live R2 or call external providers.',
        commands: [
            'npm run evidence:index',
            'npm run evidence:index:markdown',
            'npm run test:evidence-index',
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
        productionExecution: {
            ...READINESS_FALLBACK_STATUS.productionExecution,
            ...(data.productionExecution || {}),
        },
        cloudflareResourceModel: {
            ...READINESS_FALLBACK_STATUS.cloudflareResourceModel,
            ...(data.cloudflareResourceModel || {}),
        },
        readinessDossier: {
            ...READINESS_FALLBACK_STATUS.readinessDossier,
            ...(data.readinessDossier || {}),
        },
        postDeployVerification: {
            ...READINESS_FALLBACK_STATUS.postDeployVerification,
            ...(data.postDeployVerification || {}),
        },
        rollbackDrill: {
            ...READINESS_FALLBACK_STATUS.rollbackDrill,
            ...(data.rollbackDrill || {}),
        },
        releaseCandidate: {
            ...READINESS_FALLBACK_STATUS.releaseCandidate,
            ...(data.releaseCandidate || {}),
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
    let tenantReviewSupersedeSubmitting = false;
    let tenantReviewPostCleanupReport = null;
    let lifecycleDetailOverlay = null;

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

    function renderBillingEvidenceCard({ title, badgeLabel, badgeVariant = 'user', copy, rows = [], actions = [] }) {
        const card = el('article', 'admin-control-card glass glass-card reveal visible');
        const top = el('div', 'admin-control-card__top');
        top.append(el('h3', 'admin-section-title', title), badge(badgeLabel, badgeVariant));
        card.appendChild(top);
        if (copy) card.appendChild(el('p', 'admin-shell__desc', copy));
        if (rows.length) card.appendChild(detailRows(rows));
        if (actions.length) {
            const actionRow = el('div', 'admin-control-chip-row');
            for (const action of actions) actionRow.appendChild(action);
            card.appendChild(actionRow);
        }
        return card;
    }

    function evidenceStatusBadge(status) {
        const value = String(status || '').toLowerCase();
        if (value.includes('configured') || value.includes('present_https') || value.includes('shape_ok')) return ['configured', 'active'];
        if (value.includes('missing') || value.includes('blocked') || value.includes('invalid')) return ['blocked', 'disabled'];
        if (value.includes('pending') || value.includes('review')) return ['pending', 'legacy'];
        return [status || 'reported', 'user'];
    }

    async function loadBillingEvidenceStatus() {
        const panel = byId('billingEvidencePanel');
        setState('billingEvidenceState', 'Loading billing evidence status...');
        clear(panel);
        const res = await apiAdminBillingEvidenceStatus();
        if (!res.ok) {
            setState('billingEvidenceState', '');
            renderUnavailable(panel, res, 'Billing evidence status unavailable.');
            return;
        }

        const evidence = res.data || {};
        const config = evidence.config || {};
        const secrets = config.secrets || {};
        const urls = config.urls || {};
        const priceId = config.priceIds?.liveSubscriptionPriceId || {};
        const creditPacks = evidence.creditPacks || {};
        const subscription = evidence.subscription || {};
        const plan = subscription.plan || {};
        const [creditStatusLabel, creditStatusVariant] = evidenceStatusBadge(creditPacks.status);
        const [subscriptionStatusLabel, subscriptionStatusVariant] = evidenceStatusBadge(subscription.status);
        const webhookSecret = secrets.liveWebhookSecret || {};

        setState(
            'billingEvidenceState',
            `Generated ${formatDate(evidence.generatedAt)}. Production readiness and live billing readiness remain ${String(evidence.liveBillingReadiness || 'blocked').toUpperCase()}.`
        );

        const overview = el('div', 'admin-reconciliation-overview');
        overview.appendChild(detailRows([
            ['Source', evidence.source || 'worker_env_and_static_catalog_only'],
            ['Production readiness', evidence.productionReadiness || 'blocked'],
            ['Live billing readiness', evidence.liveBillingReadiness || 'blocked'],
            ['Stripe calls made', evidence.stripeCallsMade === true ? 'Yes' : 'No'],
            ['Credit mutation performed', evidence.creditMutationPerformed === true ? 'Yes' : 'No'],
            ['Response redacted', evidence.redactedResponse === true ? 'Yes' : 'No'],
        ]));
        panel.appendChild(overview);

        const grid = el('div', 'admin-control-grid admin-billing-evidence-grid');
        grid.appendChild(renderBillingEvidenceCard({
            title: 'Live Billing Readiness',
            badgeLabel: String(evidence.liveBillingReadiness || 'blocked'),
            badgeVariant: 'disabled',
            copy: 'Live billing is not activated from Admin. Operator canary evidence is required before any readiness claim.',
            rows: [
                ['Required evidence', (evidence.evidenceRequired || []).slice(0, 6).map((item) => `${readableToken(item.id)}: ${readableToken(item.status)}`).join(', ') || 'Not reported'],
                ['Last evidence state', 'pending operator evidence'],
                ['Checkout grant rule', 'Checkout creation does not grant credits'],
            ],
        }));
        grid.appendChild(renderBillingEvidenceCard({
            title: 'Credit Packs',
            badgeLabel: creditStatusLabel,
            badgeVariant: creditStatusVariant,
            copy: 'Configured static pack labels and credit amounts are shown for operator review. Checkout canary remains pending.',
            rows: [
                ['Configured packs', `${creditPacks.configuredCount || 0}`],
                ['Pack catalog', (creditPacks.activePacks || []).map((pack) => `${pack.name} (${pack.credits} credits)`).join(', ') || 'No active packs reported'],
                ['No credit before webhook', creditPacks.noCreditBeforeWebhook === true ? 'Yes' : 'Not reported'],
                ['Checkout canary', readableToken(creditPacks.checkoutCanary)],
            ],
        }));
        grid.appendChild(renderBillingEvidenceCard({
            title: 'BITBI Pro Subscription',
            badgeLabel: subscriptionStatusLabel,
            badgeVariant: subscriptionStatusVariant,
            copy: 'Subscription Price ID is reported by presence and safe suffix only. Monthly subscription credits require invoice.paid evidence.',
            rows: [
                ['Plan', plan.name || 'BITBI Pro'],
                ['Monthly credits', plan.allowanceCredits ?? '-'],
                ['Price ID present', priceId.present === true ? `Yes (...${priceId.safeSuffix || 'reported'})` : 'No'],
                ['Rollover policy', readableToken(plan.rolloverPolicy || 'subscription bucket top up; no rollover claim')],
                ['Invoice.paid evidence', readableToken(subscription.invoicePaidEvidence)],
            ],
        }));
        grid.appendChild(renderBillingEvidenceCard({
            title: 'Webhook Evidence',
            badgeLabel: webhookSecret.present ? 'secret present' : 'secret missing',
            badgeVariant: webhookSecret.present ? 'active' : 'disabled',
            copy: 'Webhook evidence is presence-only. Raw payloads, signatures, payment methods, and secrets are never rendered.',
            rows: [
                ['Endpoint', '/api/billing/webhooks/stripe/live'],
                ['Webhook secret', webhookSecret.present ? 'Present; value redacted' : 'Missing'],
                ['Duplicate idempotency evidence', 'pending operator evidence'],
                ['Wrong price ID rejection evidence', 'pending operator evidence'],
                ['Raw payload/signature rendering', 'not offered'],
            ],
        }));
        grid.appendChild(renderBillingEvidenceCard({
            title: 'Refund / Dispute / Failure Review',
            badgeLabel: 'review-only',
            badgeVariant: 'legacy',
            copy: 'Refunds, disputes, failed invoices, and payment action events are operator-review records only. Accounting/legal/support decisions remain external and auditable.',
            rows: [
                ['Automatic clawback', 'No'],
                ['Stripe action from Admin', 'No'],
                ['Credit mutation on resolution', 'No'],
                ['Review queue', 'Billing Reviews'],
            ],
        }));
        grid.appendChild(renderBillingEvidenceCard({
            title: 'Reconciliation',
            badgeLabel: 'local D1 only',
            badgeVariant: 'user',
            copy: 'Use the Billing Reconciliation panel for bounded mismatch categories. It does not repair, reverse, retry, cancel, or call Stripe.',
            rows: [
                ['Mismatch categories', 'checkout without grant, webhook without ledger, duplicate event, subscription/bucket mismatch, wrong provider mode, manual vs provider grant separation'],
                ['Latest local status', 'See Billing Reconciliation below'],
            ],
        }));
        panel.appendChild(grid);

        const facts = Array.isArray(evidence.failClosedFacts) ? evidence.failClosedFacts : [];
        if (facts.length) {
            const factCard = renderBillingEvidenceCard({
                title: 'Fail-closed Facts',
                badgeLabel: 'read-only',
                badgeVariant: 'user',
                rows: facts.slice(0, 10).map((fact, index) => [`Fact ${index + 1}`, fact]),
            });
            panel.appendChild(factCard);
        }

        const actions = el('div', 'admin-control-chip-row admin-billing-evidence-actions');
        const reviewsLink = el('a', 'btn-action', 'Open Billing Reviews');
        reviewsLink.href = '#billing-events';
        reviewsLink.addEventListener('click', () => byId('billingReviewsList')?.scrollIntoView({ block: 'start' }));
        const reconciliationLink = el('a', 'btn-action', 'Open Billing Reconciliation');
        reconciliationLink.href = '#billing-events';
        reconciliationLink.addEventListener('click', () => byId('billingReconciliationPanel')?.scrollIntoView({ block: 'start' }));
        const templateButton = el('button', 'btn-action', 'Copy billing evidence checklist path');
        templateButton.type = 'button';
        templateButton.addEventListener('click', async () => {
            const copied = await copyTextToClipboard('docs/production-readiness/EVIDENCE_TEMPLATE.md');
            notify(copied ? 'Billing evidence checklist path copied.' : 'Checklist copy failed.', copied ? 'success' : 'error');
        });
        const commandButton = el('button', 'btn-action', 'Copy billing validation commands');
        commandButton.type = 'button';
        commandButton.addEventListener('click', async () => {
            const copied = await copyTextToClipboard([
                'npm run billing:canary-evidence',
                'npx playwright test -c playwright.workers.config.js -g "billing|credit|Stripe|subscription|webhook|invoice|refund|dispute|review|reconciliation|idempotency"',
                'npx playwright test -c playwright.config.js tests/auth-admin.spec.js -g "billing|evidence|reconciliation|review|admin"',
            ].join('\n'));
            notify(copied ? 'Billing validation commands copied.' : 'Command copy failed.', copied ? 'success' : 'error');
        });
        actions.append(reviewsLink, reconciliationLink, templateButton, commandButton);
        panel.appendChild(actions);
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

    function lifecycleRequestId(request) {
        return request?.id || request?.requestId || request?.request_id || '';
    }

    function lifecycleItems(detail) {
        return Array.isArray(detail?.items) ? detail.items : [];
    }

    function lifecyclePlanSummary(detail) {
        const items = lifecycleItems(detail);
        const byAction = {};
        const byStatus = {};
        const retained = new Set();
        for (const item of items) {
            byAction[item.action || 'unknown'] = (byAction[item.action || 'unknown'] || 0) + 1;
            byStatus[item.status || 'unknown'] = (byStatus[item.status || 'unknown'] || 0) + 1;
            if (['retain', 'retain_or_anonymize', 'retain_or_rekey', 'export_reference'].includes(item.action)) {
                retained.add(item.tableName || item.resourceType || 'unknown');
            }
        }
        return {
            count: items.length,
            byAction,
            byStatus,
            retainedCategories: Array.from(retained).sort(),
            blockedCount: items.filter((item) => item.status === 'blocked').length,
            safeActionCount: items.filter((item) => (
                (item.tableName === 'sessions' && item.action === 'revoke') ||
                (['password_reset_tokens', 'email_verification_tokens', 'siwe_challenges'].includes(item.tableName) && item.action === 'expire_or_delete') ||
                (item.resourceType === 'data_export_archive' && item.action === 'expire')
            )).length,
        };
    }

    function lifecycleFinalStatus(request) {
        const finalStatuses = new Set(['completed', 'completed_with_retention', 'rejected', 'closed', 'blocked_requires_legal_review']);
        if (request?.finalStatus) return request.finalStatus;
        return finalStatuses.has(request?.status) ? request.status : '';
    }

    function lifecycleCategoryMatrix(request, detail) {
        const summaryMatrix = request?.completionSummary?.categoryMatrix;
        if (Array.isArray(summaryMatrix) && summaryMatrix.length) return summaryMatrix;
        const items = lifecycleItems(detail);
        const labels = {
            auth_session_token_profile: 'Auth/session/token/profile',
            operational_user_account: 'Operational account',
            ai_asset_metadata_folders: 'AI assets/folders',
            avatar_reference_media: 'Avatar/reference media',
            billing_credit_ledger: 'Billing/credit ledger',
            provider_webhook_evidence: 'Provider/webhook evidence',
            admin_audit_user_activity_security: 'Audit/activity/security',
            legal_compliance_retention: 'Legal/compliance retention',
            lifecycle_evidence_records: 'Lifecycle/evidence records',
        };
        const policyRetained = new Set([
            'billing_credit_ledger',
            'provider_webhook_evidence',
            'admin_audit_user_activity_security',
            'legal_compliance_retention',
            'lifecycle_evidence_records',
        ]);
        const categoryFor = (item) => {
            const tableName = item.tableName || '';
            const resourceType = item.resourceType || '';
            if (['sessions', 'password_reset_tokens', 'email_verification_tokens', 'siwe_challenges', 'admin_mfa_credentials', 'profiles', 'linked_wallets', 'favorites', 'ai_daily_quota_usage'].includes(tableName)) return 'auth_session_token_profile';
            if (tableName === 'users' || resourceType === 'user') return 'operational_user_account';
            if (['ai_folders', 'ai_images', 'ai_text_assets', 'ai_video_jobs'].includes(tableName)) return 'ai_asset_metadata_folders';
            if (resourceType === 'r2_object') return 'avatar_reference_media';
            if (['member_credit_ledger', 'member_subscriptions', 'member_subscription_credit_buckets', 'stripe_credit_pack_checkout_sessions'].includes(tableName)) return 'billing_credit_ledger';
            if (['billing_provider_events', 'billing_reviews'].includes(tableName)) return 'provider_webhook_evidence';
            if (['admin_audit_log', 'user_activity_log', 'activity_events'].includes(tableName) || resourceType === 'admin_audit_log') return 'admin_audit_user_activity_security';
            if (['data_lifecycle_requests', 'data_lifecycle_request_items', 'data_export_archives'].includes(tableName) || resourceType === 'data_export_archive') return 'lifecycle_evidence_records';
            return 'legal_compliance_retention';
        };
        const rank = { blocked: 6, retained: 5, pending: 4, anonymized: 3, deleted: 2, not_applicable: 0 };
        const resultFor = (item) => {
            const action = String(item.action || '').toLowerCase();
            const status = String(item.status || '').toLowerCase();
            if (status === 'blocked' || action === 'manual_review_required') return 'blocked';
            if (['retain', 'retain_or_anonymize', 'retain_or_rekey', 'export_reference', 'export'].includes(action)) return 'retained';
            if (status === 'completed') return ['anonymize', 'retain_or_anonymize', 'retain_or_rekey'].includes(action) ? 'anonymized' : 'deleted';
            if (['delete', 'delete_planned', 'revoke', 'expire_or_delete', 'expire'].includes(action)) return 'pending';
            return 'not_applicable';
        };
        const matrix = Object.entries(labels).map(([id, label]) => ({
            id,
            label,
            result: policyRetained.has(id) ? 'retained' : 'not_applicable',
            itemCount: 0,
            retainedByPolicy: policyRetained.has(id),
        }));
        const byId = new Map(matrix.map((entry) => [entry.id, entry]));
        for (const item of items) {
            const entry = byId.get(categoryFor(item));
            const next = resultFor(item);
            entry.itemCount += 1;
            entry.result = (rank[next] || 0) > (rank[entry.result] || 0) ? next : entry.result;
        }
        return matrix;
    }

    function lifecycleActionState(request, detail) {
        const status = request?.status || '';
        const summary = lifecyclePlanSummary(detail);
        const hasPlan = summary.count > 0;
        const planned = status === 'planned';
        const approved = status === 'approved';
        const safeCompleted = status === 'safe_actions_completed';
        const exportRequest = request?.type === 'export';
        const finalStatus = lifecycleFinalStatus(request);
        const isFinal = Boolean(finalStatus);
        const canComplete = !isFinal && hasPlan && summary.blockedCount === 0 && (safeCompleted || (exportRequest && status === 'export_ready'));
        return {
            isFinal,
            finalStatus,
            canPlan: !isFinal && ['submitted', 'planned', 'blocked'].includes(status),
            canApprove: !isFinal && planned && hasPlan && summary.blockedCount === 0,
            approveDisabledReason: planned
                ? (hasPlan ? (summary.blockedCount ? 'Blocked plan items require manual review before approval.' : '') : 'Generate a plan before approval.')
                : 'Request must be planned before approval.',
            canExecuteDryRun: !isFinal && (approved || safeCompleted),
            canExecuteSafe: !isFinal && approved,
            executeDisabledReason: approved || safeCompleted ? '' : 'Request must be approved before safe execution.',
            canGeneratePrivateArchive: !isFinal && exportRequest && approved,
            archiveDisabledReason: exportRequest ? 'Export request must be approved before archive generation.' : 'Private archives are only available for export requests.',
            canMarkCompleted: canComplete,
            markCompletedReason: canComplete ? '' : (isFinal ? 'Request already has a final lifecycle status.' : 'Completion requires plan evidence, approval, safe execution or export archive evidence, and no blocked plan items.'),
            canRejectClose: !isFinal,
            rejectCloseReason: isFinal ? 'Request already has a final lifecycle status.' : '',
        };
    }

    function formatLifecycleError(res, fallback) {
        const parts = [apiUnavailableMessage(res, fallback)];
        if (res?.code) parts.push(`Code: ${res.code}`);
        if (res?.status) parts.push(`Status: ${res.status}`);
        return parts.join(' ');
    }

    function lifecyclePanel(title, copy) {
        const panel = el('section', 'admin-lifecycle-detail__panel');
        panel.appendChild(el('h4', 'admin-lifecycle-detail__panel-title', title));
        if (copy) panel.appendChild(el('p', 'admin-shell__desc', copy));
        return panel;
    }

    function lifecycleFieldGrid(entries = []) {
        const grid = el('div', 'admin-lifecycle-field-grid');
        for (const entry of entries) {
            const [label, value, options = {}] = entry;
            const row = el('div', options.block ? 'admin-lifecycle-field admin-lifecycle-field--block' : 'admin-lifecycle-field');
            row.appendChild(el('span', 'admin-lifecycle-field__label', label));
            const valueNode = el('div', 'admin-lifecycle-field__value');
            if (value instanceof Node) {
                valueNode.appendChild(value);
            } else {
                valueNode.textContent = value == null || value === '' ? '-' : String(value);
            }
            row.appendChild(valueNode);
            grid.appendChild(row);
        }
        return grid;
    }

    function lifecycleTextBlock(label, value) {
        const block = el('div', 'admin-lifecycle-text-block');
        block.appendChild(el('span', 'admin-lifecycle-text-block__label', label));
        block.appendChild(el('p', 'admin-lifecycle-text-block__value', value || 'Not recorded.'));
        return block;
    }

    function renderLifecycleCategoryMatrix(panel, request, detail) {
        const matrix = lifecycleCategoryMatrix(request, detail);
        const grid = el('div', 'admin-lifecycle-category-grid');
        for (const entry of matrix) {
            const card = el('div', 'admin-lifecycle-category');
            card.appendChild(badge(readableToken(entry.result || 'not_applicable'), variantFor(entry.result)));
            card.appendChild(el('strong', null, entry.label || readableToken(entry.id)));
            card.appendChild(el('span', null, `${entry.itemCount ?? 0} item${Number(entry.itemCount || 0) === 1 ? '' : 's'}`));
            if (entry.retainedByPolicy) card.appendChild(el('span', 'admin-shell__desc', 'Policy-retained'));
            grid.appendChild(card);
        }
        panel.appendChild(grid);
    }

    function addActionButton(rowNode, label, { disabled, reason, onClick, secondary = false } = {}) {
        const button = el('button', secondary ? 'btn-action btn-action--secondary' : 'btn-action', label);
        button.type = 'button';
        button.disabled = Boolean(disabled);
        if (reason) button.title = reason;
        if (typeof onClick === 'function') button.addEventListener('click', onClick);
        rowNode.appendChild(button);
        if (disabled && reason) rowNode.appendChild(el('span', 'admin-shell__desc', reason));
        return button;
    }

    function renderLifecyclePlan(panel, detail) {
        const items = lifecycleItems(detail);
        const summary = lifecyclePlanSummary(detail);
        panel.appendChild(lifecycleFieldGrid([
            ['Plan items', summary.count],
            ['Blocked items', summary.blockedCount],
            ['Safe executable actions', summary.safeActionCount],
            ['Actions', renderJsonSummary(summary.byAction)],
            ['Statuses', renderJsonSummary(summary.byStatus)],
            ['Retained policy categories', summary.retainedCategories.join(', ') || 'Not reported'],
        ]));
        if (!items.length) {
            panel.appendChild(el('p', 'admin-shell__desc', 'No plan items exist yet. Generate a plan before approval or safe execution.'));
            return;
        }
        const { wrap, tbody } = table(['Resource', 'Table', 'Action', 'Status', 'Storage']);
        for (const item of items.slice(0, 12)) {
            const tr = document.createElement('tr');
            addCell(tr, item.resourceType || '-');
            addCell(tr, item.tableName || '-');
            addCell(tr, item.action || '-');
            addCell(tr, badge(item.status || '-', variantFor(item.status)));
            addCell(tr, item.storageReference?.keyClass ? `${item.r2Bucket || item.storageReference.bucket || 'storage'} / ${item.storageReference.keyClass}` : '-');
            tbody.appendChild(tr);
        }
        panel.appendChild(wrap);
        if (items.length > 12) panel.appendChild(el('p', 'admin-shell__desc', `Showing 12 of ${items.length} redacted plan items.`));
    }

    function closeLifecycleDetailOverlay() {
        if (!lifecycleDetailOverlay) return;
        document.removeEventListener('keydown', lifecycleDetailOverlay.onKeydown, true);
        lifecycleDetailOverlay.modal.remove();
        const opener = lifecycleDetailOverlay.opener;
        lifecycleDetailOverlay = null;
        if (opener && typeof opener.focus === 'function') opener.focus();
    }

    function trapLifecycleOverlayFocus(event) {
        if (event.key !== 'Tab' || !lifecycleDetailOverlay?.modal) return;
        const focusable = Array.from(lifecycleDetailOverlay.modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
            .filter((node) => !node.disabled && node.offsetParent !== null);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    async function refreshLifecycleDetail(requestId, bodyNode) {
        clear(bodyNode);
        bodyNode.appendChild(el('p', 'admin-state', 'Loading lifecycle request detail...'));
        const res = await apiAdminDataLifecycleRequest(requestId);
        clear(bodyNode);
        if (!res.ok) {
            const box = el('div', 'admin-alert admin-alert--danger');
            box.appendChild(el('strong', null, 'Lifecycle request detail failed.'));
            box.appendChild(el('p', null, formatLifecycleError(res, 'Request detail unavailable.')));
            bodyNode.appendChild(box);
            return null;
        }
        renderLifecycleDetailBody(requestId, res.data, bodyNode);
        return res.data;
    }

    async function runLifecycleAction({ requestId, button, bodyNode, stateNode, action, call, successMessage }) {
        setSubmitting(button, true);
        stateNode.textContent = `${action}...`;
        stateNode.dataset.state = 'neutral';
        try {
            const res = await call();
            if (!res.ok) {
                stateNode.textContent = formatLifecycleError(res, `${action} failed.`);
                stateNode.dataset.state = 'error';
                notify(`${action} failed.`, 'error');
                return;
            }
            stateNode.textContent = successMessage;
            stateNode.dataset.state = 'success';
            notify(successMessage, 'success');
            await refreshLifecycleDetail(requestId, bodyNode);
            await loadLifecycleRequests();
        } finally {
            setSubmitting(button, false);
        }
    }

    async function exportLifecycleEvidence(requestId, format, button, stateNode) {
        setSubmitting(button, true);
        stateNode.textContent = `Preparing ${format} evidence packet...`;
        stateNode.dataset.state = 'neutral';
        try {
            const res = await apiAdminDataLifecycleRequestEvidence(requestId, { format });
            if (!res.ok) {
                stateNode.textContent = formatLifecycleError(res, 'Evidence export failed.');
                stateNode.dataset.state = 'error';
                notify('Evidence export failed.', 'error');
                return;
            }
            const extension = format === 'markdown' ? 'md' : format;
            const contentType = res.contentType || (format === 'html' ? 'text/html' : format === 'markdown' ? 'text/markdown' : 'application/json');
            if (format === 'html' && typeof window.open === 'function' && typeof Blob !== 'undefined' && window.URL?.createObjectURL) {
                const blob = new Blob([res.text || ''], { type: contentType });
                const url = window.URL.createObjectURL(blob);
                const popup = window.open(url, '_blank', 'noopener');
                window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
                if (popup) {
                    stateNode.textContent = 'PDF-friendly evidence HTML opened. Use browser print or Save as PDF.';
                    stateNode.dataset.state = 'success';
                    return;
                }
            }
            downloadTextFile(`data-lifecycle-${requestId}-evidence.${extension}`, res.text || '', contentType);
            stateNode.textContent = 'Evidence packet downloaded. No lifecycle execution occurred.';
            stateNode.dataset.state = 'success';
        } finally {
            setSubmitting(button, false);
        }
    }

    function renderLifecycleDetailBody(requestId, detail, bodyNode) {
        const request = detail?.request || {};
        const actions = lifecycleActionState(request, detail);
        const stateNode = el('p', 'admin-state', 'Ready. Actions remain guarded by backend confirmation, idempotency, approval, and safe execution policy.');
        const finalStatus = actions.finalStatus || 'not_completed';
        const userItem = lifecycleItems(detail).find((item) => item.resourceType === 'user');

        const header = el('section', 'admin-lifecycle-detail__hero');
        const headerText = el('div', 'admin-lifecycle-detail__hero-main');
        headerText.appendChild(el('h4', 'admin-lifecycle-detail__eyebrow', 'Lifecycle control packet'));
        const badges = el('div', 'admin-control-chip-row');
        badges.append(
            badge(request.type || 'request', 'user'),
            badge(request.status || 'unknown', variantFor(request.status)),
            badge(request.dryRun ? 'dry-run' : 'execution-capable', request.dryRun ? 'legacy' : 'user'),
            badge(`final: ${readableToken(finalStatus)}`, actions.isFinal ? 'active' : 'disabled'),
            badge('evidence required', 'legacy'),
            actions.isFinal ? badge('legal outcome recorded', 'active') : badge('no legal completion claim', 'disabled'),
        );
        headerText.append(
            badges,
            lifecycleFieldGrid([
                ['Request ID', request.id || requestId],
                ['Subject user', shortId(request.subjectUserId)],
                ['Created', formatDate(request.createdAt)],
                ['Updated', formatDate(request.updatedAt)],
                ['Expires', formatDate(request.expiresAt)],
                ['Approval required', request.approvalRequired ? 'Yes' : 'No'],
            ]),
        );
        header.appendChild(headerText);
        bodyNode.append(header, stateNode);

        const grid = el('div', 'admin-lifecycle-layout');

        const subjectPanel = lifecyclePanel('Subject Snapshot', 'Only safe request metadata and redacted plan summaries are shown.');
        subjectPanel.appendChild(lifecycleFieldGrid([
            ['User ID', request.subjectUserId || '-'],
            ['Email snapshot', userItem?.summary?.email || 'Not available until plan captures a safe user item.'],
            ['Role/status snapshot', [userItem?.summary?.role, userItem?.summary?.status].filter(Boolean).join(' / ') || 'Not available'],
            ['Request source', request.reason?.includes('admin_delete_user_modal') ? 'Admin delete user modal' : 'Lifecycle request'],
            ['Admin actor', request.requestedByAdminId ? shortId(request.requestedByAdminId) : 'Not reported'],
        ]));
        subjectPanel.appendChild(lifecycleTextBlock('Reason', request.reason || 'Not recorded'));
        subjectPanel.appendChild(lifecycleTextBlock('Privacy caveat', 'Billing, audit, provider, security, and legal records may be retained or anonymized according to policy. Final legal completion is only claimed when the final status and evidence support it.'));
        grid.appendChild(subjectPanel);

        const statePanel = lifecyclePanel('Current Lifecycle State', 'This panel reflects request state; it does not claim legal completion.');
        statePanel.appendChild(lifecycleFieldGrid([
            ['Submitted/planned/approved state', request.status || '-'],
            ['Final status', readableToken(finalStatus)],
            ['Approved', request.approvedAt ? `Yes (${formatDate(request.approvedAt)})` : 'No'],
            ['Approved by', request.approvedByAdminId ? shortId(request.approvedByAdminId) : 'Not reported'],
            ['Execution state', request.status === 'safe_actions_completed' ? 'Safe actions completed' : 'Not completed'],
            ['Evidence state', request.evidenceStatus || (request.status === 'safe_actions_completed' ? 'Safe action evidence available; completion still requires review.' : 'Evidence pending / partial.')],
            ['Completed', formatDate(request.completedAt)],
            ['Completed by', request.completedByUserId ? shortId(request.completedByUserId) : 'Not reported'],
        ]));
        statePanel.appendChild(lifecycleTextBlock('Retention caveat', 'Do not delete billing ledger, Stripe/provider evidence, audit logs, security records, or legal/compliance records from this overlay. These categories are retained or anonymized only through approved policy workflow.'));
        grid.appendChild(statePanel);

        const planPanel = lifecyclePanel('Plan', 'Generate or inspect the redacted lifecycle plan. Raw private keys and secrets are not rendered.');
        renderLifecyclePlan(planPanel, detail);
        const planActions = el('div', 'admin-control-chip-row');
        addActionButton(planActions, 'Generate Plan', {
            disabled: !actions.canPlan,
            reason: actions.canPlan ? '' : 'Plan generation is no longer available for this state.',
            onClick: (event) => runLifecycleAction({
                requestId,
                button: event.currentTarget,
                bodyNode,
                stateNode,
                action: 'Generate Plan',
                call: () => apiAdminDataLifecycleGeneratePlan(requestId),
                successMessage: 'Plan generated or refreshed.',
            }),
        });
        planPanel.appendChild(planActions);
        planPanel.classList.add('admin-lifecycle-detail__panel--wide');

        const approvePanel = lifecyclePanel('Approval', 'Approval moves a planned request into approved state. It is not legal completion and does not execute erasure.');
        const approveCheckId = `lifecycle-approve-${requestId}`;
        const approveLabel = el('label', 'admin-form__check');
        const approveCheck = document.createElement('input');
        approveCheck.type = 'checkbox';
        approveCheck.id = approveCheckId;
        approveLabel.append(approveCheck, document.createTextNode(' I understand approval does not complete legal/GDPR erasure.'));
        const approveReason = document.createElement('textarea');
        approveReason.className = 'admin-input';
        approveReason.rows = 2;
        approveReason.placeholder = 'Approval note / review reason';
        const approveActions = el('div', 'admin-control-chip-row');
        const approveButton = addActionButton(approveActions, 'Approve', {
            disabled: !actions.canApprove,
            reason: actions.canApprove ? '' : actions.approveDisabledReason,
            onClick: (event) => {
                if (!approveCheck.checked) {
                    stateNode.textContent = 'Approval acknowledgement is required.';
                    stateNode.dataset.state = 'error';
                    return;
                }
                runLifecycleAction({
                    requestId,
                    button: event.currentTarget,
                    bodyNode,
                    stateNode,
                    action: 'Approve',
                    call: () => apiAdminDataLifecycleApprove(requestId, { reason: approveReason.value.trim() }),
                    successMessage: 'Lifecycle request approved.',
                });
            },
        });
        approvePanel.append(approveLabel, approveReason, approveActions);
        if (!actions.canApprove) approveButton.disabled = true;
        grid.appendChild(approvePanel);

        const executePanel = lifecyclePanel('Execute Safe', 'Safe execution is backend-gated. Destructive modes are blocked; dry-run is available after approval.');
        executePanel.appendChild(lifecycleFieldGrid([
            ['Dry-run default', 'Yes'],
            ['Non-dry-run requirements', 'Approved plan, Idempotency-Key, confirm=true, and backend safe-action policy.'],
            ['Retained records', 'Billing, audit, legal, and provider evidence are retained/anonymized under policy.'],
        ]));
        const executeCheck = document.createElement('input');
        executeCheck.type = 'checkbox';
        const executeLabel = el('label', 'admin-form__check');
        executeLabel.append(executeCheck, document.createTextNode(' I understand safe execution is limited and does not perform full legal erasure.'));
        const executeActions = el('div', 'admin-control-chip-row');
        addActionButton(executeActions, 'Execute Safe Dry-run', {
            disabled: !actions.canExecuteDryRun,
            reason: actions.executeDisabledReason,
            secondary: true,
            onClick: (event) => runLifecycleAction({
                requestId,
                button: event.currentTarget,
                bodyNode,
                stateNode,
                action: 'Execute Safe Dry-run',
                call: () => apiAdminDataLifecycleExecuteSafe(requestId, { dryRun: true }),
                successMessage: 'Safe execution dry-run completed.',
            }),
        });
        addActionButton(executeActions, 'Execute Safe', {
            disabled: !actions.canExecuteSafe,
            reason: actions.executeDisabledReason,
            onClick: (event) => {
                if (!executeCheck.checked) {
                    stateNode.textContent = 'Safe execution acknowledgement is required.';
                    stateNode.dataset.state = 'error';
                    return;
                }
                runLifecycleAction({
                    requestId,
                    button: event.currentTarget,
                    bodyNode,
                    stateNode,
                    action: 'Execute Safe',
                    call: () => apiAdminDataLifecycleExecuteSafe(requestId, { dryRun: false }),
                    successMessage: 'Safe lifecycle actions executed.',
                });
            },
        });
        executePanel.append(executeLabel, executeActions);
        grid.appendChild(executePanel);

        const completionPanel = lifecyclePanel('Completion / Legal Outcome', 'Final completion records evidence truth. It does not execute deletion and does not overclaim full legal/GDPR completion when policy-retained categories remain.');
        completionPanel.appendChild(lifecycleFieldGrid([
            ['Current final status', readableToken(finalStatus)],
            ['Evidence completeness', request.evidenceStatus || 'Pending / partial'],
            ['Retained categories', (request.retainedCategories || request.completionSummary?.retainedCategories || []).join(', ') || 'Computed from category matrix / policy.'],
            ['Completion action', actions.canMarkCompleted ? 'Eligible after evidence review.' : actions.markCompletedReason],
            ['Audit trail', 'Use Admin Activity plus evidence export; raw logs are not rendered here.'],
        ]));
        const completionNote = document.createElement('textarea');
        completionNote.className = 'admin-input';
        completionNote.rows = 3;
        completionNote.placeholder = 'Completion note / evidence review summary';
        const completeCheck = document.createElement('input');
        completeCheck.type = 'checkbox';
        const completeLabel = el('label', 'admin-form__check');
        completeLabel.append(completeCheck, document.createTextNode(' I confirm this is a final evidence marker, not an unchecked purge or legal advice.'));
        const completionActions = el('div', 'admin-control-chip-row');
        addActionButton(completionActions, 'Mark Completed', {
            disabled: !actions.canMarkCompleted,
            reason: actions.markCompletedReason,
            onClick: (event) => {
                if (!completeCheck.checked) {
                    stateNode.textContent = 'Completion acknowledgement is required.';
                    stateNode.dataset.state = 'error';
                    return;
                }
                if (!completionNote.value.trim()) {
                    stateNode.textContent = 'Completion note is required.';
                    stateNode.dataset.state = 'error';
                    return;
                }
                runLifecycleAction({
                    requestId,
                    button: event.currentTarget,
                    bodyNode,
                    stateNode,
                    action: 'Mark Completed',
                    call: () => apiAdminDataLifecycleComplete(requestId, { completionNote: completionNote.value.trim() }),
                    successMessage: 'Lifecycle completion evidence recorded.',
                });
            },
        });
        completionPanel.append(completeLabel, completionNote, completionActions);
        completionPanel.classList.add('admin-lifecycle-detail__panel--wide');

        const closePanel = lifecyclePanel('Reject / Close', 'Reject or close updates lifecycle state only. It does not delete data.');
        closePanel.appendChild(lifecycleFieldGrid([
            ['Reject / Close', actions.canRejectClose ? 'Available while the request is not final.' : actions.rejectCloseReason],
            ['Data mutation', 'No data deletion is performed by this disabled action.'],
        ]));
        const closeReason = document.createElement('textarea');
        closeReason.className = 'admin-input';
        closeReason.rows = 3;
        closeReason.placeholder = 'Reject/close reason';
        const closeStatus = document.createElement('select');
        closeStatus.className = 'admin-input';
        for (const [value, label] of [
            ['closed', 'Close without execution'],
            ['blocked_requires_legal_review', 'Close as blocked - legal review required'],
        ]) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            closeStatus.appendChild(option);
        }
        const rejectCheck = document.createElement('input');
        rejectCheck.type = 'checkbox';
        const rejectLabel = el('label', 'admin-form__check');
        rejectLabel.append(rejectCheck, document.createTextNode(' I understand reject/close does not execute erasure or delete data.'));
        const closeActions = el('div', 'admin-control-chip-row');
        addActionButton(closeActions, 'Reject', {
            disabled: !actions.canRejectClose,
            reason: actions.rejectCloseReason,
            secondary: true,
            onClick: (event) => {
                if (!rejectCheck.checked || !closeReason.value.trim()) {
                    stateNode.textContent = 'Reject acknowledgement and reason are required.';
                    stateNode.dataset.state = 'error';
                    return;
                }
                runLifecycleAction({
                    requestId,
                    button: event.currentTarget,
                    bodyNode,
                    stateNode,
                    action: 'Reject',
                    call: () => apiAdminDataLifecycleReject(requestId, { reason: closeReason.value.trim() }),
                    successMessage: 'Lifecycle request rejected without data execution.',
                });
            },
        });
        addActionButton(closeActions, 'Close', {
            disabled: !actions.canRejectClose,
            reason: actions.rejectCloseReason,
            secondary: true,
            onClick: (event) => {
                if (!rejectCheck.checked || !closeReason.value.trim()) {
                    stateNode.textContent = 'Close acknowledgement and reason are required.';
                    stateNode.dataset.state = 'error';
                    return;
                }
                runLifecycleAction({
                    requestId,
                    button: event.currentTarget,
                    bodyNode,
                    stateNode,
                    action: 'Close',
                    call: () => apiAdminDataLifecycleClose(requestId, {
                        reason: closeReason.value.trim(),
                        finalStatus: closeStatus.value,
                    }),
                    successMessage: 'Lifecycle request closed without data execution.',
                });
            },
        });
        closePanel.append(rejectLabel, closeReason, closeStatus, closeActions);
        grid.appendChild(closePanel);

        const exportPanel = lifecyclePanel('Export Evidence', 'Exports are sanitized JSON, Markdown, or printable HTML. Use browser Save as PDF for PDF-friendly storage.');
        const exportActions = el('div', 'admin-control-chip-row');
        addActionButton(exportActions, 'Export Evidence JSON', {
            secondary: true,
            onClick: (event) => exportLifecycleEvidence(requestId, 'json', event.currentTarget, stateNode),
        });
        addActionButton(exportActions, 'Export Evidence Markdown', {
            secondary: true,
            onClick: (event) => exportLifecycleEvidence(requestId, 'markdown', event.currentTarget, stateNode),
        });
        addActionButton(exportActions, 'Open PDF-friendly HTML', {
            secondary: true,
            onClick: (event) => exportLifecycleEvidence(requestId, 'html', event.currentTarget, stateNode),
        });
        if (request.type === 'export') {
            addActionButton(exportActions, 'Generate Private Archive', {
                disabled: !actions.canGeneratePrivateArchive,
                reason: actions.archiveDisabledReason,
                onClick: (event) => runLifecycleAction({
                    requestId,
                    button: event.currentTarget,
                    bodyNode,
                    stateNode,
                    action: 'Generate Private Archive',
                    call: () => apiAdminDataLifecycleGenerateExport(requestId),
                    successMessage: 'Private export archive generated.',
                }),
            });
            addActionButton(exportActions, 'Open Archive Metadata', {
                secondary: true,
                onClick: async (event) => {
                    await runLifecycleAction({
                        requestId,
                        button: event.currentTarget,
                        bodyNode,
                        stateNode,
                        action: 'Open Archive Metadata',
                        call: () => apiAdminDataLifecycleRequestExport(requestId),
                        successMessage: 'Archive metadata checked.',
                    });
                },
            });
        }
        exportPanel.appendChild(exportActions);
        exportPanel.appendChild(el('p', 'admin-shell__desc', 'Evidence packets include request state, plan summary, approval/execution state, retained categories, pending actions, generated timestamp, and redaction guarantees. They are not legal advice.'));
        exportPanel.classList.add('admin-lifecycle-detail__panel--wide');

        const categoryPanel = lifecyclePanel('Category Matrix', 'Category-level outcomes keep legal truth visible without exposing table internals, raw keys, secrets, or payloads.');
        renderLifecycleCategoryMatrix(categoryPanel, request, detail);
        categoryPanel.classList.add('admin-lifecycle-detail__panel--wide');

        const timelinePanel = lifecyclePanel('Timeline / Audit', 'Detailed immutable audit is available in Admin Activity; this overlay shows current lifecycle timestamps only.');
        timelinePanel.appendChild(lifecycleFieldGrid([
            ['Created', formatDate(request.createdAt)],
            ['Updated', formatDate(request.updatedAt)],
            ['Approved', formatDate(request.approvedAt)],
            ['Completed', formatDate(request.completedAt)],
            ['Closed', formatDate(request.closedAt)],
            ['Expires', formatDate(request.expiresAt)],
        ]));
        timelinePanel.appendChild(lifecycleTextBlock('Audit caveat', 'Raw request hashes, idempotency keys, cookies, auth headers, tokens, Stripe/provider payloads, and private R2 keys are never rendered.'));
        timelinePanel.classList.add('admin-lifecycle-detail__panel--wide');

        bodyNode.appendChild(grid);
        bodyNode.append(planPanel, completionPanel, categoryPanel, exportPanel, timelinePanel);
    }

    function openLifecycleDetailOverlay(requestId, opener) {
        closeLifecycleDetailOverlay();
        const modal = el('div', 'admin-lifecycle-modal');
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'adminLifecycleDetailTitle');
        const backdrop = el('div', 'admin-lifecycle-modal__backdrop');
        const dialog = el('div', 'admin-lifecycle-detail glass glass-card');
        const header = el('div', 'admin-lifecycle-detail__header');
        const title = el('h3', 'admin-section-title', 'Data Lifecycle Request Detail');
        title.id = 'adminLifecycleDetailTitle';
        const closeButton = el('button', 'btn-action btn-action--secondary', 'Close');
        closeButton.type = 'button';
        closeButton.addEventListener('click', closeLifecycleDetailOverlay);
        header.append(title, closeButton);
        const body = el('div', 'admin-lifecycle-detail__body');
        dialog.append(header, body);
        modal.append(backdrop, dialog);
        backdrop.addEventListener('click', closeLifecycleDetailOverlay);
        const onKeydown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeLifecycleDetailOverlay();
                return;
            }
            trapLifecycleOverlayFocus(event);
        };
        lifecycleDetailOverlay = { modal, opener, onKeydown };
        document.body.appendChild(modal);
        document.addEventListener('keydown', onKeydown, true);
        closeButton.focus();
        refreshLifecycleDetail(requestId, body);
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
        const { wrap, tbody } = table(['Type', 'Status', 'Subject', 'Dry-run', 'Created', 'Expires', 'Review']);
        for (const request of requests) {
            const tr = document.createElement('tr');
            addCell(tr, request.type || '-');
            addCell(tr, badge(request.status || '-', variantFor(request.status)));
            addCell(tr, shortId(request.subjectUserId || request.subject_user_id));
            addCell(tr, request.dryRun ?? request.dry_run ? 'Yes' : 'No');
            addCell(tr, formatDate(request.createdAt || request.created_at));
            addCell(tr, formatDate(request.expiresAt || request.expires_at));
            const requestId = lifecycleRequestId(request);
            const actions = el('div', 'admin-control-chip-row');
            const openButton = el('button', 'btn-action btn-action--secondary', 'Open');
            openButton.type = 'button';
            openButton.addEventListener('click', (event) => openLifecycleDetailOverlay(requestId, event.currentTarget));
            actions.appendChild(openButton);
            addCell(tr, actions);
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
        const activeCurrent = summary.activeCurrentItems ?? summary.reviewStatusRollup?.review_in_progress ?? 0;
        const pendingManual = summary.stillPendingManualReview ?? summary.reviewStatusRollup?.pending_review ?? 0;
        const deferred = summary.stillDeferred ?? summary.reviewStatusRollup?.deferred ?? 0;
        const supersededCandidates = summary.supersededCandidates ?? 0;
        const stillBlocked = summary.stillBlocked ?? (
            Number(summary.issueCategoryRollup?.public_unsafe || 0) +
            Number(summary.issueCategoryRollup?.derivative_risk || 0) +
            Number(summary.terminalBlockedCount || 0)
        );
        return [
            {
                title: 'Historical Review Items',
                badge: { label: `${summary.totalReviewItems ?? 0} total`, variant: 'user' },
                copy: 'Manual-review rows currently stored in D1. Post-cleanup dry-run determines whether old rows are still current.',
                meta: [
                    ['Active current', activeCurrent],
                    ['Superseded candidates', supersededCandidates],
                    ['Events', summary.eventsCount ?? summary.totalEvents ?? 0],
                ],
            },
            {
                title: 'Current Review Split',
                badge: { label: 'Access blocked', variant: 'disabled' },
                copy: 'Blocked categories remain evidence for human review only.',
                meta: [
                    ['Still blocked', stillBlocked],
                    ['Still pending manual review', pendingManual],
                    ['Deferred', deferred],
                ],
            },
            {
                title: 'Status Evidence',
                badge: { label: 'Review-state only', variant: 'legacy' },
                copy: 'Status events are audit evidence. They do not approve backfill, tenant isolation, or production readiness.',
                meta: [
                    ['Unknown/manual review required', summary.unknownRequiresManualReview ?? 0],
                    ['Status changes', summary.statusChangedEventsCount ?? 0],
                    ['Latest status update', formatDate(summary.latestStatusUpdateTimestamp)],
                ],
            },
        ];
    }

    function mergedTenantReviewSummary(baseSummary = {}, postCleanupSummary = {}) {
        return {
            ...baseSummary,
            ...postCleanupSummary,
            totalReviewItems: postCleanupSummary.totalReviewItems ?? baseSummary.totalReviewItems,
            totalEvents: postCleanupSummary.totalEvents ?? baseSummary.totalEvents,
            eventsCount: postCleanupSummary.eventsCount ?? baseSummary.totalEvents,
            latestStatusUpdateTimestamp: postCleanupSummary.latestStatusAt ?? baseSummary.latestStatusUpdateTimestamp,
            mostRecentImportTimestamp: postCleanupSummary.latestImportAt ?? baseSummary.mostRecentImportTimestamp,
        };
    }

    function renderTenantReviewPostCleanupSummary(report) {
        const container = byId('tenantReviewPostCleanupSummary');
        clear(container);
        if (!container || !report?.summary) return;
        const summary = report.summary;
        renderCards(container, tenantReviewSummaryCards(mergedTenantReviewSummary({}, summary)));
        const chips = el('div', 'admin-control-chip-row');
        chips.append(
            badge('Post-cleanup dry-run evidence', 'active'),
            badge(`Safe candidates ${summary.supersededCandidates ?? 0}`, Number(summary.supersededCandidates || 0) > 0 ? 'legacy' : 'disabled'),
            badge('D1 not mutated', 'user'),
            badge('R2 not listed', 'user'),
            badge('Tenant isolation not claimed', 'legacy'),
        );
        container.appendChild(chips);
    }

    function tenantReviewSupersedeInputsReady() {
        const confirmation = byId('tenantReviewSupersedeConfirmation')?.value.trim() || '';
        const reason = byId('tenantReviewSupersedeReason')?.value.trim() || '';
        const safeCount = Number(tenantReviewPostCleanupReport?.summary?.supersededCandidates || 0);
        return Boolean(tenantReviewPostCleanupReport && safeCount > 0 && confirmation === TENANT_REVIEW_SUPERSEDE_CONFIRMATION && reason);
    }

    function updateTenantReviewSupersedeControls() {
        const submit = byId('tenantReviewSupersedeSubmit');
        if (!submit) return;
        submit.disabled = !tenantReviewSupersedeInputsReady() || tenantReviewSupersedeSubmitting;
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
        renderCards(summaryNode, tenantReviewSummaryCards(mergedTenantReviewSummary(summary, tenantReviewPostCleanupReport?.summary || {})));
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
            `Historical total ${summary.totalReviewItems ?? 0} review item${Number(summary.totalReviewItems || 0) === 1 ? '' : 's'}`,
            `active current ${tenantReviewPostCleanupReport?.summary?.activeCurrentItems ?? 'run dry-run'}`,
            `superseded candidates ${tenantReviewPostCleanupReport?.summary?.supersededCandidates ?? 'run dry-run'}`,
            `events ${summary.totalEvents ?? 0}`,
            `latest import ${formatDate(summary.mostRecentImportTimestamp)}`,
            `latest status ${formatDate(summary.latestStatusUpdateTimestamp)}`,
        ].join(' | ');
        setState('tenantReviewState', statusText);
        return report;
    }

    async function runTenantReviewPostCleanupDryRun(button) {
        if (button) setSubmitting(button, true);
        setState('tenantReviewSupersedeState', 'Running post-cleanup supersession dry-run...');
        try {
            const res = await apiAdminTenantAssetManualReviewPostCleanupDryRun({
                limit: 500,
                sampleLimit: 50,
            });
            if (!res.ok) {
                tenantReviewPostCleanupReport = null;
                renderTenantReviewPostCleanupSummary(null);
                setState('tenantReviewSupersedeState', apiUnavailableMessage(res, 'Post-cleanup supersession dry-run failed.'), 'error');
                updateTenantReviewSupersedeControls();
                return null;
            }
            tenantReviewPostCleanupReport = res.data?.report || {};
            renderTenantReviewPostCleanupSummary(tenantReviewPostCleanupReport);
            const summary = tenantReviewPostCleanupReport.summary || {};
            setState(
                'tenantReviewSupersedeState',
                `Dry-run complete: active current ${summary.activeCurrentItems ?? 0}, safe superseded candidates ${summary.supersededCandidates ?? 0}, still blocked ${summary.stillBlocked ?? 0}, unknown/manual review ${summary.unknownRequiresManualReview ?? 0}. No D1 or R2 mutation occurred.`,
                'success',
            );
            updateTenantReviewSupersedeControls();
            await loadTenantAssetManualReviewEvidence();
            return tenantReviewPostCleanupReport;
        } finally {
            if (button) setSubmitting(button, false);
        }
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
        await runTenantReviewPostCleanupDryRun();
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

    async function exportTenantAssetManualReviewPostCleanupEvidence(button, format) {
        setSubmitting(button, true);
        setState('tenantReviewSupersedeState', `Preparing post-cleanup supersession ${format.toUpperCase()} evidence export...`);
        try {
            const res = await apiAdminTenantAssetManualReviewPostCleanupEvidenceExport({
                format,
                limit: 500,
                sampleLimit: 50,
            });
            if (!res.ok) {
                setState('tenantReviewSupersedeState', apiUnavailableMessage(res, 'Post-cleanup supersession evidence export failed.'), 'error');
                notify('Supersession evidence export failed.', 'error');
                return;
            }
            const extension = format === 'markdown' ? 'md' : format;
            const fallback = `tenant-asset-manual-review-post-cleanup-${new Date().toISOString().slice(0, 10)}.${extension}`;
            downloadTextFile(filenameFromContentDisposition(res.filename, fallback), res.text || '', res.contentType || 'application/octet-stream');
            setState('tenantReviewSupersedeState', `Post-cleanup supersession ${format.toUpperCase()} evidence prepared. No mutation was performed.`, 'success');
            notify('Supersession evidence export prepared.', 'success');
        } finally {
            setSubmitting(button, false);
        }
    }

    async function handleTenantReviewSupersedeSubmit(event) {
        event.preventDefault();
        if (tenantReviewSupersedeSubmitting) return;
        updateTenantReviewSupersedeControls();
        if (!tenantReviewSupersedeInputsReady()) {
            setState('tenantReviewSupersedeState', 'Run dry-run first, then enter exact confirmation and reason. Safe superseded candidates must be present.', 'error');
            return;
        }
        const dryRun = byId('tenantReviewSupersedeDryRun')?.checked !== false;
        if (!dryRun) {
            const confirmed = window.confirm('Mark stale manual-review rows as superseded? This does not delete assets, backfill ownership, switch access checks, reset media, or touch R2.');
            if (!confirmed) {
                setState('tenantReviewSupersedeState', 'Supersession cancelled.', 'neutral');
                return;
            }
        }
        const batchLimit = Number(byId('tenantReviewSupersedeBatchLimit')?.value || 25);
        const submit = byId('tenantReviewSupersedeSubmit');
        tenantReviewSupersedeSubmitting = true;
        setSubmitting(submit, true);
        setState('tenantReviewSupersedeState', dryRun ? 'Submitting supersession executor dry-run...' : 'Submitting guarded supersession update...');
        try {
            const res = await apiAdminTenantAssetManualReviewPostCleanupSupersede({
                dryRun,
                confirm: true,
                confirmation: TENANT_REVIEW_SUPERSEDE_CONFIRMATION,
                reason: byId('tenantReviewSupersedeReason')?.value.trim() || '',
                batchLimit,
            }, { idempotencyKey: createIdempotencyKey('tenant-review-supersede') });
            if (!res.ok) {
                setState('tenantReviewSupersedeState', apiUnavailableMessage(res, 'Manual-review supersession request failed.'), 'error');
                notify('Manual-review supersession failed.', 'error');
                return;
            }
            const result = res.data?.supersession || {};
            setState(
                'tenantReviewSupersedeState',
                `${dryRun ? 'Supersession executor dry-run' : 'Supersession'} completed: considered ${result.rowsConsidered ?? 0}, superseded ${result.rowsSuperseded ?? 0}, skipped ${result.rowsSkipped ?? 0}. Tenant isolation remains unclaimed.`,
                'success',
            );
            notify(dryRun ? 'Supersession dry-run completed.' : 'Review rows superseded.', 'success');
            await runTenantReviewPostCleanupDryRun();
            await loadTenantAssetManualReviewItems();
            setState(
                'tenantReviewSupersedeState',
                `${dryRun ? 'Supersession executor dry-run' : 'Supersession'} completed: considered ${result.rowsConsidered ?? 0}, superseded ${result.rowsSuperseded ?? 0}, skipped ${result.rowsSkipped ?? 0}. Tenant isolation remains unclaimed.`,
                'success',
            );
        } finally {
            tenantReviewSupersedeSubmitting = false;
            setSubmitting(submit, false);
            updateTenantReviewSupersedeControls();
        }
    }

    async function loadOperations() {
        await Promise.all([loadOperatorTimeline(), loadPoisonMessages(), loadFailedJobs(), loadTenantAssetManualReviewQueue()]);
    }

    function operatorTimelineFilters() {
        const filters = {};
        const source = byId('operatorTimelineSourceFilter')?.value || '';
        const severity = byId('operatorTimelineSeverityFilter')?.value || '';
        const status = byId('operatorTimelineStatusFilter')?.value || '';
        const attention = byId('operatorTimelineAttentionFilter')?.value || '';
        if (source) filters.source = source;
        if (severity) filters.severity = severity;
        if (status) filters.status = status;
        if (attention) filters.attentionRequired = attention;
        filters.limit = 25;
        return filters;
    }

    function safeTimelineTarget(target) {
        if (!target || typeof target !== 'object') return null;
        const href = String(target.href || '').trim();
        if (!href.startsWith('#')) return null;
        return {
            href,
            label: safeSummaryValue(target.label || 'Open related panel'),
        };
    }

    function renderOperatorTimelineEvent(event) {
        const card = el('article', 'admin-control-card glass glass-card reveal visible');
        const top = el('div', 'admin-control-card__top');
        top.append(el('h3', 'admin-section-title', safeSummaryValue(event.title || event.type || event.id)));
        top.append(
            badge(readableToken(event.severity || 'informational'), event.severity === 'critical' || event.severity === 'high' ? 'disabled' : statusVariant(event.severity)),
            badge(readableToken(event.source || 'unknown'), 'user'),
            badge(readableToken(event.status || 'recorded'), statusVariant(event.status)),
        );
        card.appendChild(top);
        card.appendChild(el('p', 'admin-shell__desc', safeSummaryValue(event.summary || 'No summary reported.')));
        const meta = [
            ['Time', formatDate(event.timestamp)],
            ['Domain', readableToken(event.domain || event.source)],
            ['Type', readableToken(event.type || event.category)],
            ['Attention required', event.attentionRequired ? 'Yes' : 'No'],
        ];
        if (event.actor && typeof event.actor === 'object') {
            const actorEmail = event.actor.email ? safeSummaryValue(event.actor.email) : null;
            const actorId = event.actor.userId ? shortId(event.actor.userId) : null;
            meta.push(['Actor', actorEmail || actorId || 'Not reported']);
        }
        if (event.recommendedAction?.label) {
            meta.push(['Recommended action', safeSummaryValue(event.recommendedAction.label)]);
        }
        card.appendChild(detailRows(meta));
        const actions = el('div', 'admin-control-chip-row');
        for (const target of [safeTimelineTarget(event.recommendedAction), safeTimelineTarget(event.evidenceTarget)].filter(Boolean)) {
            if (actions.querySelector(`a[href="${target.href}"]`)) continue;
            const link = el('a', 'btn-action', target.label);
            link.href = target.href;
            actions.appendChild(link);
        }
        const copy = el('button', 'btn-action btn-action--secondary', 'Copy event ID');
        copy.type = 'button';
        copy.addEventListener('click', async () => {
            const copied = await copyTextToClipboard(event.id || '');
            notify(copied ? 'Event ID copied.' : 'Copy failed.', copied ? 'success' : 'error');
        });
        actions.appendChild(copy);
        card.appendChild(actions);
        if (event.dangerousActionWarning) {
            card.appendChild(el('p', 'admin-shell__desc', safeSummaryValue(event.dangerousActionWarning)));
        }
        return card;
    }

    async function loadOperatorTimeline() {
        const list = byId('operatorTimelineList');
        const summaryNode = byId('operatorTimelineSummary');
        setState('operatorTimelineState', 'Loading operator timeline...');
        clear(list);
        clear(summaryNode);
        const res = await apiAdminOperationsTimeline(operatorTimelineFilters());
        if (!res.ok) {
            setState('operatorTimelineState', '');
            renderUnavailable(list, res, 'Operator timeline unavailable. Use local evidence index and existing Admin panels for triage.');
            return;
        }
        const data = res.data || {};
        const events = Array.isArray(data.events) ? data.events : [];
        const blockedClaims = Array.isArray(data.blockedClaims) ? data.blockedClaims : [];
        if (summaryNode) {
            summaryNode.appendChild(detailRows([
                ['Generated', formatDate(data.generatedAt)],
                ['Events shown', events.length],
                ['Has more', data.hasMore ? 'Yes' : 'No'],
                ['Read-only', data.readOnly ? 'Yes' : 'No'],
                ['External calls', data.externalCallsMade ? 'Unexpected' : 'No'],
                ['R2 listing', data.r2ListingPerformed ? 'Unexpected' : 'No'],
                ['Blocked claims', blockedClaims.map((item) => readableToken(item.label || item.id)).slice(0, 4).join(', ') || 'Not reported'],
                ['Archive posture', data.archiveVisibility?.status ? readableToken(data.archiveVisibility.status) : 'metadata only'],
            ]));
        }
        if (data.dangerousActionsOffered?.length) {
            setState('operatorTimelineState', 'Timeline returned unexpected dangerous actions. Treat this response as unsafe.', 'error');
            return;
        }
        setState('operatorTimelineState', 'Read-only redacted operator timeline. It does not execute reset/backfill/access-switch, live billing, deploy, migration, Stripe, provider, refund, subscription, or credit actions.');
        const quickLinks = el('div', 'admin-control-chip-row');
        for (const [label, href] of [
            ['Open Billing Reviews', '#billing-events'],
            ['Open Billing Reconciliation', '#billing-events'],
            ['Open Tenant Asset Center', '#tenant-assets'],
            ['Open Manual Review Queue', '#operations'],
            ['Open Data Lifecycle', '#lifecycle'],
            ['Open AI Budget Evidence', '#ai-budget-switches'],
            ['Open Readiness/Evidence Dashboard', '#readiness'],
        ]) {
            const link = el('a', 'btn-action btn-action--secondary', label);
            link.href = href;
            quickLinks.appendChild(link);
        }
        list.appendChild(quickLinks);
        if (!events.length) {
            list.appendChild(el('p', 'admin-shell__desc', 'No operator timeline events matched the current bounded filters.'));
            return;
        }
        const grid = el('div', 'admin-control-grid');
        for (const item of events.slice(0, 25)) {
            grid.appendChild(renderOperatorTimelineEvent(item));
        }
        list.appendChild(grid);
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

    let tenantIsolationBackfillReport = null;
    let tenantIsolationDangerModal = null;

    const TENANT_ISOLATION_DANGER = Object.freeze({
        backfill: {
            name: 'Ownership Backfill',
            confirmation: 'BACKFILL OWNERSHIP',
            changes: 'Writes tenant ownership metadata only for selected ai_folders and ai_images rows classified safe by bounded D1 dry-run evidence.',
            domains: 'Supported write domains: ai_folders and ai_images. Deferred domains include derivatives, text/music/video assets, avatars, public galleries, and raw R2 object families.',
            dryRun: 'Dry-run and evidence export read local D1 metadata only and do not list or mutate R2.',
            metadata: 'Can write asset_owner_type, owning_user_id, created_by_user_id, ownership_status/source/confidence, metadata JSON, and assigned timestamp for safe rows only.',
            access: 'Does not change runtime access decisions by itself, but it can affect a future access-switch if one is later enabled.',
            reset: 'Does not retire or delete media references.',
            evidence: 'Requires dry-run evidence, supported domain selection, reason, Idempotency-Key, and exact typed confirmation.',
            rollback: 'Metadata writes are not presented as globally reversible from this panel. Unsafe/manual/deferred rows remain unchanged.',
        },
        access: {
            name: 'Runtime Access-Switch',
            confirmation: 'ENABLE ACCESS SWITCH',
            changes: 'Would change which ownership signal runtime reads use for asset authorization if a durable switch existed.',
            domains: 'Current diagnostics cover folder/image routes only. Other domains remain deferred.',
            dryRun: 'Shadow diagnostics compare legacy user_id checks with ownership metadata without changing authorization.',
            metadata: 'Does not write ownership metadata.',
            access: 'Enforced mode can make users lose access or see assets incorrectly if evidence is wrong. This implementation keeps enforced mode disabled.',
            reset: 'Does not retire or delete media references.',
            evidence: 'Requires passing shadow diagnostics, reviewed mismatch counts, a durable switch model, and exact confirmation before any future enablement.',
            rollback: 'Rollback would require a real kill switch. Current safe state is legacy access mode off/shadow-only.',
        },
        reset: {
            name: 'Legacy Media Reset',
            confirmation: 'CONFIRMED LEGACY MEDIA RESET',
            changes: 'May retire public references, enqueue cleanup, delete legacy media rows, release storage accounting, and remove media access if confirmed execution is approved.',
            domains: 'First-pass executor is limited to ai_images, ai_folders, image derivatives, and public gallery references. Text/music/video/avatar/export/audit domains remain deferred.',
            dryRun: 'Dry-run inventories D1 rows and reset classifications only. It does not list or mutate live R2.',
            metadata: 'Does not backfill ownership metadata.',
            access: 'Does not switch runtime access checks.',
            reset: 'Confirmed execution is destructive and remains blocked unless the backend gate is explicitly enabled and all evidence requirements are satisfied.',
            evidence: 'Requires sanitized dry-run evidence, Idempotency-Key, reason, selected scope, public/no-credit/irreversible acknowledgements, and exact typed confirmation.',
            rollback: 'Deleted or retired references may not be recoverable from this panel. Do not execute before backfill/access-switch evidence is reviewed.',
        },
    });

    function closeTenantIsolationDangerModal() {
        if (!tenantIsolationDangerModal) return;
        tenantIsolationDangerModal.modal.remove();
        document.removeEventListener('keydown', tenantIsolationDangerModal.onKeydown, true);
        tenantIsolationDangerModal.opener?.focus?.();
        tenantIsolationDangerModal = null;
    }

    function openTenantIsolationDangerModal(kind, opener) {
        const info = TENANT_ISOLATION_DANGER[kind];
        if (!info) return;
        closeTenantIsolationDangerModal();
        const modal = el('div', 'admin-lifecycle-modal admin-tenant-danger-modal');
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'tenantIsolationDangerTitle');
        const backdrop = el('div', 'admin-lifecycle-modal__backdrop');
        const dialog = el('div', 'admin-lifecycle-detail glass glass-card admin-tenant-danger-dialog');
        const header = el('div', 'admin-lifecycle-detail__header');
        const title = el('h3', 'admin-section-title', `! ${info.name} danger explanation`);
        title.id = 'tenantIsolationDangerTitle';
        const close = el('button', 'btn-action btn-action--secondary', 'Close');
        close.type = 'button';
        close.addEventListener('click', closeTenantIsolationDangerModal);
        header.append(title, close);
        const body = el('div', 'admin-lifecycle-detail__body');
        body.appendChild(detailRows([
            ['Action', info.name],
            ['Exact confirmation', info.confirmation],
        ]));
        for (const [label, value] of [
            ['What changes', info.changes],
            ['Affected domains', info.domains],
            ['Dry-run vs mutating', info.dryRun],
            ['Ownership metadata impact', info.metadata],
            ['Runtime access impact', info.access],
            ['Media reset impact', info.reset],
            ['Evidence required', info.evidence],
            ['Rollback limitations', info.rollback],
        ]) {
            body.appendChild(lifecycleTextBlock(label, value));
        }
        dialog.append(header, body);
        modal.append(backdrop, dialog);
        backdrop.addEventListener('click', closeTenantIsolationDangerModal);
        const onKeydown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeTenantIsolationDangerModal();
            }
        };
        tenantIsolationDangerModal = { modal, opener, onKeydown };
        document.body.appendChild(modal);
        document.addEventListener('keydown', onKeydown, true);
        close.focus();
    }

    function tenantDangerButton(kind) {
        const info = TENANT_ISOLATION_DANGER[kind];
        const button = el('button', 'admin-danger-marker', '!');
        button.type = 'button';
        button.title = `${info.name}: open danger explanation`;
        button.setAttribute('aria-label', `${info.name} danger explanation`);
        button.addEventListener('click', (event) => openTenantIsolationDangerModal(kind, event.currentTarget));
        return button;
    }

    function tenantIsolationCard(kind, title, statusText) {
        const card = el('article', 'admin-control-card glass glass-card reveal visible admin-tenant-exec-card');
        const top = el('div', 'admin-control-card__top admin-tenant-exec-card__top');
        const heading = el('div', 'admin-tenant-exec-card__heading');
        heading.append(tenantDangerButton(kind), el('h3', 'admin-section-title', title));
        top.append(heading, badge(statusText, statusText === 'available' ? 'legacy' : 'disabled'));
        card.appendChild(top);
        return card;
    }

    function postCleanupStatusText(report) {
        return readableToken(report?.postCleanupRebaseline?.status || 'post_cleanup_evidence_pending');
    }

    function tenantExportButtons(scope, stateNode) {
        const row = el('div', 'admin-control-chip-row');
        for (const [format, label] of [['json', 'Export JSON evidence'], ['markdown', 'Export Markdown evidence'], ['html', 'Export HTML / PDF-friendly']]) {
            const button = el('button', 'btn-action btn-action--secondary', label);
            button.type = 'button';
            button.addEventListener('click', async () => {
                setSubmitting(button, true);
                stateNode.dataset.state = 'neutral';
                stateNode.textContent = `Preparing ${label.toLowerCase()}...`;
                try {
                    const res = await apiAdminTenantIsolationEvidenceExport({ scope, format, limit: 50 });
                    if (!res.ok) {
                        stateNode.dataset.state = 'error';
                        stateNode.textContent = apiUnavailableMessage(res, `${label} failed.`);
                        notify('Tenant isolation evidence export failed.', 'error');
                        return;
                    }
                    const fallback = `tenant-isolation-${scope}-evidence.${format === 'markdown' ? 'md' : format}`;
                    downloadTextFile(filenameFromContentDisposition(res.filename, fallback), res.text || '', res.contentType || 'text/plain');
                    stateNode.dataset.state = 'success';
                    stateNode.textContent = `${label} prepared. No tenant isolation action was executed.`;
                    notify('Tenant isolation evidence export prepared.', 'success');
                } finally {
                    setSubmitting(button, false);
                }
            });
            row.appendChild(button);
        }
        return row;
    }

    function renderBackfillSummary(node, report) {
        clear(node);
        const summary = report?.summary || {};
        node.appendChild(detailRows([
            ['Generated', formatDate(report?.generatedAt)],
            ['Post-cleanup rebaseline', postCleanupStatusText(report)],
            ['Safe candidates', summary.safeCandidates ?? summary.classifications?.safe_to_backfill ?? 0],
            ['Manual review', summary.classifications?.needs_manual_review ?? 0],
            ['Public unsafe', summary.classifications?.blocked_public_unsafe ?? 0],
            ['Missing evidence', summary.classifications?.blocked_missing_evidence ?? 0],
            ['Already owned', summary.classifications?.already_owned ?? 0],
            ['Backfill performed', report?.backfillPerformed ? 'unexpected' : 'No'],
        ]));
        const candidates = Array.isArray(report?.candidates) ? report.candidates.slice(0, 8) : [];
        if (candidates.length) {
            const { wrap, tbody } = table(['Domain', 'Asset', 'Classification', 'Reason']);
            for (const item of candidates) {
                const tr = document.createElement('tr');
                addCell(tr, readableToken(item.domain));
                addCell(tr, shortId(item.assetId));
                addCell(tr, badge(readableToken(item.classification), item.classification === 'safe_to_backfill' ? 'active' : 'disabled'));
                addCell(tr, readableToken(item.reason));
                tbody.appendChild(tr);
            }
            node.appendChild(wrap);
        }
    }

    function renderOwnershipBackfillControl() {
        const card = tenantIsolationCard('backfill', 'Ownership Backfill', 'dangerous');
        card.appendChild(el('p', 'admin-shell__desc', 'Writes ownership metadata only for rows classified safe by a bounded dry-run. Unsafe, public, missing-evidence, manual-review, and deferred rows remain blocked.'));
        const summary = el('div', 'admin-inventory');
        const state = el('div', 'admin-state', 'Post-cleanup evidence pending. Run dry-run preview before any execution attempt.');
        state.id = 'tenantIsolationBackfillState';
        state.setAttribute('aria-live', 'polite');
        const dryRun = el('button', 'btn-action', 'Run Backfill Dry-run');
        dryRun.type = 'button';
        dryRun.addEventListener('click', async () => {
            setSubmitting(dryRun, true);
            state.dataset.state = 'neutral';
            state.textContent = 'Loading ownership backfill dry-run...';
            try {
                const res = await apiAdminOwnershipBackfillDryRun({ limit: 50, includeDetails: true });
                if (!res.ok) {
                    state.dataset.state = 'error';
                    state.textContent = apiUnavailableMessage(res, 'Ownership backfill dry-run failed.');
                    return;
                }
                tenantIsolationBackfillReport = res.data?.report || {};
                renderBackfillSummary(summary, tenantIsolationBackfillReport);
                state.dataset.state = 'success';
                state.textContent = 'Post-cleanup dry-run loaded. No ownership metadata was written.';
                syncBackfillButtons();
            } finally {
                setSubmitting(dryRun, false);
            }
        });

        const reason = document.createElement('textarea');
        reason.id = 'tenantBackfillReason';
        reason.className = 'admin-ai__textarea';
        reason.rows = 3;
        reason.placeholder = 'Operator reason required for the execution endpoint.';
        const confirmation = document.createElement('input');
        confirmation.id = 'tenantBackfillConfirmation';
        confirmation.className = 'admin-ai__input';
        confirmation.placeholder = 'Type BACKFILL OWNERSHIP';
        const executeDryRun = el('button', 'btn-action btn-action--secondary', 'Execute Endpoint Dry-run');
        executeDryRun.type = 'button';
        const executeWrite = el('button', 'btn-action btn-action--danger', 'Write Safe Ownership Metadata');
        executeWrite.type = 'button';
        const blockedReason = el('p', 'admin-shell__desc', 'Write mode disabled until dry-run is loaded, safe candidates exist, reason is entered, and exact confirmation is typed.');

        function safeCandidateCount() {
            return Number(tenantIsolationBackfillReport?.summary?.safeCandidates ?? tenantIsolationBackfillReport?.summary?.classifications?.safe_to_backfill ?? 0);
        }
        function formReady() {
            return Boolean(reason.value.trim() && confirmation.value.trim() === 'BACKFILL OWNERSHIP');
        }
        function syncBackfillButtons() {
            executeDryRun.disabled = !formReady();
            executeWrite.disabled = !(tenantIsolationBackfillReport && safeCandidateCount() > 0 && formReady());
            blockedReason.textContent = executeWrite.disabled
                ? 'Write mode disabled until dry-run is loaded, safe candidates exist, reason is entered, and exact confirmation is typed.'
                : 'Write mode will update only safe ai_folders/ai_images rows in the selected bounded batch. Tenant isolation is still not claimed.';
        }
        reason.addEventListener('input', syncBackfillButtons);
        confirmation.addEventListener('input', syncBackfillButtons);

        async function runBackfillExecution(dryRunMode, button) {
            if (!formReady()) {
                state.dataset.state = 'error';
                state.textContent = 'Reason and exact BACKFILL OWNERSHIP confirmation are required.';
                return;
            }
            if (!dryRunMode) {
                const confirmed = window.confirm('Write ownership metadata for safe rows only? This does not switch access checks, does not reset media, and does not claim tenant isolation.');
                if (!confirmed) return;
            }
            setSubmitting(button, true);
            state.dataset.state = 'neutral';
            state.textContent = dryRunMode ? 'Submitting backfill execution dry-run...' : 'Submitting guarded ownership metadata write...';
            try {
                const res = await apiAdminOwnershipBackfillExecute({
                    dryRun: dryRunMode,
                    confirm: true,
                    confirmation: 'BACKFILL OWNERSHIP',
                    reason: reason.value.trim(),
                    domains: ['ai_folders', 'ai_images'],
                    batchLimit: 25,
                }, { idempotencyKey: createIdempotencyKey('tenant-ownership-backfill') });
                if (!res.ok) {
                    state.dataset.state = 'error';
                    state.textContent = apiUnavailableMessage(res, 'Ownership backfill execution request failed.');
                    notify('Ownership backfill request failed.', 'error');
                    return;
                }
                state.dataset.state = 'success';
                const backfill = res.data?.backfill || {};
                state.textContent = `${dryRunMode ? 'Post-cleanup backfill dry-run' : 'Ownership metadata write'} completed: considered ${backfill.rowsConsidered ?? 0}, written ${backfill.rowsWritten ?? 0}, blocked ${backfill.rowsBlocked ?? 0}. Tenant isolation remains unclaimed.`;
                notify(dryRunMode ? 'Backfill dry-run completed.' : 'Ownership backfill completed for safe rows.', 'success');
                const refreshed = await apiAdminOwnershipBackfillDryRun({ limit: 50, includeDetails: true });
                if (refreshed.ok) {
                    tenantIsolationBackfillReport = refreshed.data?.report || {};
                    renderBackfillSummary(summary, tenantIsolationBackfillReport);
                    syncBackfillButtons();
                }
            } finally {
                setSubmitting(button, false);
            }
        }
        executeDryRun.addEventListener('click', () => runBackfillExecution(true, executeDryRun));
        executeWrite.addEventListener('click', () => runBackfillExecution(false, executeWrite));
        syncBackfillButtons();

        const form = el('div', 'admin-control-form');
        form.append(
            dryRun,
            tenantExportButtons('backfill', state),
        );
        const reasonLabel = el('label', 'admin-ai__field');
        reasonLabel.append(el('span', 'admin-ai__label', 'Reason'), reason);
        const confirmLabel = el('label', 'admin-ai__field');
        confirmLabel.append(el('span', 'admin-ai__label', 'Exact confirmation'), confirmation);
        const actions = el('div', 'admin-control-chip-row');
        actions.append(executeDryRun, executeWrite);
        form.append(reasonLabel, confirmLabel, actions, blockedReason, state);
        card.append(summary, form);
        return card;
    }

    function renderAccessSwitchControl() {
        const card = tenantIsolationCard('access', 'Runtime Access-Switch', 'blocked');
        card.appendChild(el('p', 'admin-shell__desc', 'Shadow diagnostics compare legacy user_id access with ownership metadata. Enforced mode is not available because this repo has no durable switch state and unresolved evidence remains possible.'));
        const summary = el('div', 'admin-inventory');
        const state = el('div', 'admin-state', 'Post-cleanup Access-Switch evidence pending. Run status and shadow diagnostics.');
        state.id = 'tenantIsolationAccessState';
        state.setAttribute('aria-live', 'polite');
        const refresh = el('button', 'btn-action', 'Refresh Access-Switch Status');
        refresh.type = 'button';
        const shadow = el('button', 'btn-action btn-action--secondary', 'Run Shadow Diagnostics');
        shadow.type = 'button';
        async function loadStatus() {
            const res = await apiAdminAccessSwitchStatus();
            if (!res.ok) {
                state.dataset.state = 'error';
                state.textContent = apiUnavailableMessage(res, 'Access-switch status unavailable.');
                return;
            }
            const status = res.data?.status || {};
            clear(summary);
            summary.appendChild(detailRows([
                ['Current mode', readableToken(status.currentMode || 'off')],
                ['Post-cleanup rebaseline', postCleanupStatusText(status)],
                ['Runtime switch supported', status.runtimeSwitchRepoSupported ? 'Yes' : 'No'],
                ['Live switch enabled', status.liveSwitchEnabled ? 'Unexpected' : 'No'],
                ['Unsafe mismatches', status.mismatchCounts?.unsafe ?? 0],
                ['Manual review', status.mismatchCounts?.manualReview ?? 0],
                ['Tenant isolation claimed', status.tenantIsolationClaimed ? 'Unexpected' : 'No'],
            ]));
            state.dataset.state = 'neutral';
            state.textContent = 'Access-switch status loaded. Post-cleanup shadow evidence is still required; enforced mode remains disabled.';
        }
        refresh.addEventListener('click', () => { void loadStatus(); });
        shadow.addEventListener('click', async () => {
            setSubmitting(shadow, true);
            state.dataset.state = 'neutral';
            state.textContent = 'Running shadow diagnostics...';
            try {
                const res = await apiAdminAccessSwitchShadowDiagnostics({ limit: 50 });
                if (!res.ok) {
                    state.dataset.state = 'error';
                    state.textContent = apiUnavailableMessage(res, 'Shadow diagnostics failed.');
                    return;
                }
                const report = res.data?.report || {};
                clear(summary);
                summary.appendChild(detailRows([
                    ['Mismatch count', report.summary?.mismatchCount ?? 0],
                    ['Post-cleanup rebaseline', postCleanupStatusText(report)],
                    ['Metadata missing', (report.summary?.foldersWithNullOwnershipMetadata ?? 0) + (report.summary?.imagesWithNullOwnershipMetadata ?? 0)],
                    ['Enforced mode allowed', report.summary?.enforcedModeAllowed ? 'Unexpected' : 'No'],
                    ['Runtime changed', report.runtimeBehaviorChanged ? 'Unexpected' : 'No'],
                ]));
                const samples = Array.isArray(report.samples) ? report.samples.slice(0, 5) : [];
                if (samples.length) summary.appendChild(simpleList(samples, ['domain', 'mismatchType', 'reason']));
                state.dataset.state = 'success';
                state.textContent = 'Post-cleanup shadow diagnostics completed. No runtime access decision changed.';
            } finally {
                setSubmitting(shadow, false);
            }
        });
        const enforce = el('button', 'btn-action btn-action--danger', 'Enable Enforced Access-Switch');
        enforce.type = 'button';
        enforce.disabled = true;
        const disabled = el('p', 'admin-shell__desc', 'Disabled: enforced mode requires reviewed shadow diagnostics, safe thresholds, rollback/kill-switch state, and a durable backend switch model.');
        const actions = el('div', 'admin-control-chip-row');
        actions.append(refresh, shadow, tenantExportButtons('access', state), enforce);
        card.append(summary, actions, disabled, state);
        void loadStatus();
        return card;
    }

    function renderLegacyMediaResetControl() {
        const card = tenantIsolationCard('reset', 'Legacy Media Reset', 'blocked');
        card.appendChild(el('p', 'admin-shell__desc', 'Confirmed reset may retire public references, queue cleanup, delete first-pass legacy rows, and release storage. The backend gate remains disabled by default and readiness remains blocked.'));
        const summary = el('div', 'admin-inventory');
        const state = el('div', 'admin-state', 'Post-cleanup reset evidence pending. Confirmed execution remains blocked.');
        state.id = 'tenantIsolationResetState';
        state.setAttribute('aria-live', 'polite');
        const statusButton = el('button', 'btn-action', 'Refresh Reset Status');
        statusButton.type = 'button';
        async function loadStatus() {
            const res = await apiAdminLegacyMediaResetStatus();
            if (!res.ok) {
                state.dataset.state = 'error';
                state.textContent = apiUnavailableMessage(res, 'Legacy reset status unavailable.');
                return;
            }
            const status = res.data?.status || {};
            clear(summary);
            summary.appendChild(detailRows([
                ['Dry-run available', status.dryRunAvailable ? 'Yes' : 'No'],
                ['Post-cleanup rebaseline', postCleanupStatusText(status)],
                ['Confirmed gate enabled', status.confirmedExecutionGate?.enabled ? 'Yes' : 'No'],
                ['Sanitized evidence', readableToken(status.sanitizedEvidenceStatus || 'pending')],
                ['Confirmed readiness', readableToken(status.confirmedReadiness || 'blocked')],
                ['Danger approved', status.dangerousOperationsApproved ? 'Unexpected' : 'No'],
                ['Tenant isolation claimed', status.tenantIsolationClaimed ? 'Unexpected' : 'No'],
            ]));
            state.dataset.state = 'neutral';
            state.textContent = 'Legacy reset status loaded. Post-cleanup sanitized evidence remains pending and confirmed execution is blocked.';
        }
        statusButton.addEventListener('click', () => { void loadStatus(); });
        const dryExport = el('button', 'btn-action btn-action--secondary', 'Export Existing Dry-run JSON');
        dryExport.type = 'button';
        dryExport.addEventListener('click', () => exportLegacyMediaResetDryRunJson(dryExport));
        const execute = el('button', 'btn-action btn-action--danger', 'Confirmed Execute Reset');
        execute.type = 'button';
        execute.disabled = true;
        const disabled = el('p', 'admin-shell__desc', 'Disabled by default: gate disabled, sanitized evidence incomplete, backfill/access-switch evidence not reviewed, exact CONFIRMED LEGACY MEDIA RESET confirmation not accepted from this UI state.');
        const actions = el('div', 'admin-control-chip-row');
        actions.append(statusButton, dryExport, tenantExportButtons('reset', state), execute);
        card.append(summary, actions, disabled, state);
        void loadStatus();
        return card;
    }

    function renderTenantIsolationExecution(container) {
        const section = readinessSection('Tenant Isolation Execution', 'Dangerous staged controls for ownership backfill, runtime access-switch, and legacy media reset. This is an execution control plane, not a readiness claim.');
        const intro = el('div', 'admin-control-hero glass glass-card reveal visible admin-tenant-exec-hero');
        const copy = el('div');
        copy.append(el('p', 'admin-control-hero__eyebrow', 'Dangerous operations'));
        copy.append(el('h3', 'admin-section-title', 'Do not execute Reset before Backfill and Access-Switch evidence are reviewed.'));
        copy.append(el('p', 'admin-control-hero__copy', 'Every warning marker opens a concrete danger explanation. Production readiness remains blocked and tenant isolation is not claimed.'));
        copy.append(el('p', 'admin-control-hero__copy', 'Old owner-map, manual-review, and reset counts are stale after manual media cleanup. Collect fresh post-cleanup evidence before any Backfill, Access-Switch, or Reset decision.'));
        const badges = el('div', 'admin-control-chip-row');
        badges.append(
            badge('Evidence required', 'disabled'),
            badge('Post-cleanup evidence pending', 'disabled'),
            badge('No production readiness claim', 'disabled'),
            badge('Tenant isolation not claimed', 'legacy'),
            badge('Live R2 untouched', 'user'),
        );
        intro.append(copy, badges);
        section.appendChild(intro);
        const sequence = el('ol', 'admin-tenant-sequence');
        ['Step 1: Ownership Backfill', 'Step 2: Access-Switch', 'Step 3: Legacy Media Reset'].forEach((text) => {
            sequence.appendChild(el('li', '', text));
        });
        section.appendChild(sequence);
        const controls = el('div', 'admin-control-grid admin-tenant-exec-grid');
        controls.append(renderOwnershipBackfillControl(), renderAccessSwitchControl(), renderLegacyMediaResetControl());
        section.appendChild(controls);
        const combined = el('div', 'admin-control-chip-row');
        const state = el('div', 'admin-state', 'Combined evidence export is read-only and does not execute tenant isolation actions.');
        for (const [format, label] of [['json', 'Export Combined JSON'], ['markdown', 'Export Combined Markdown'], ['html', 'Export Combined HTML / PDF-friendly']]) {
            const button = el('button', 'btn-action btn-action--secondary', label);
            button.type = 'button';
            button.addEventListener('click', async () => {
                setSubmitting(button, true);
                state.dataset.state = 'neutral';
                state.textContent = `Preparing ${label.toLowerCase()}...`;
                try {
                    const res = await apiAdminTenantIsolationEvidenceExport({ scope: 'combined', format, limit: 50 });
                    if (!res.ok) {
                        state.dataset.state = 'error';
                        state.textContent = apiUnavailableMessage(res, `${label} failed.`);
                        return;
                    }
                    const fallback = `tenant-isolation-execution-evidence.${format === 'markdown' ? 'md' : format}`;
                    downloadTextFile(filenameFromContentDisposition(res.filename, fallback), res.text || '', res.contentType || 'text/plain');
                    state.dataset.state = 'success';
                    state.textContent = `${label} prepared. No backfill, access-switch, reset, R2, provider, Stripe, or Cloudflare action was executed.`;
                } finally {
                    setSubmitting(button, false);
                }
            });
            combined.appendChild(button);
        }
        section.append(combined, state);
        container.appendChild(section);
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

        renderTenantIsolationExecution(container);
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

    function renderProductionExecution(container, status) {
        const execution = status.productionExecution || READINESS_FALLBACK_STATUS.productionExecution;
        const resourceModel = status.cloudflareResourceModel || READINESS_FALLBACK_STATUS.cloudflareResourceModel;
        const dossier = status.readinessDossier || READINESS_FALLBACK_STATUS.readinessDossier;
        const postDeploy = status.postDeployVerification || READINESS_FALLBACK_STATUS.postDeployVerification;
        const rollback = status.rollbackDrill || READINESS_FALLBACK_STATUS.rollbackDrill;
        const section = readinessSection('Production Execution Framework', 'Local-only execution dossier, Cloudflare resource model, post-deploy read-only verification, and rollback drill status. This dashboard never deploys, migrates, mutates Cloudflare, or executes rollback.');
        const grid = el('div', 'admin-control-grid');

        const cards = [
            {
                title: 'Production Execution State',
                badge: execution.status || 'blocked',
                copy: execution.safeStateSummary || 'Repo-supported state exists; deploy-pending and live-evidence-pending remain visible until operator proof is attached.',
                meta: [
                    ['Repo supported', execution.repoSupported === true ? 'Yes' : 'No'],
                    ['Deploy pending', execution.deployPending === true ? 'Yes' : 'No'],
                    ['Live evidence pending', execution.liveEvidencePending === true ? 'Yes' : 'No'],
                    ['Production readiness', execution.productionReadiness || 'blocked'],
                    ['Browser deploy/migration/rollback', execution.noBrowserDeploy && execution.noBrowserMigration && execution.noBrowserRollback ? 'Not offered' : 'Review required'],
                ],
            },
            {
                title: 'Cloudflare Resource Model',
                badge: resourceModel.status || 'live verification required',
                copy: 'Repo declarations are checked against Wrangler config. Live Cloudflare resource, secret, domain, WAF, header, RUM, and alert evidence remains operator-supplied.',
                meta: [
                    ['Resources', (resourceModel.repoDeclaredResources || []).join(', ')],
                    ['Dashboard-managed', (resourceModel.dashboardManagedRequirements || []).join(', ')],
                    ['Live verification required', resourceModel.liveVerificationRequired === true ? 'Yes' : 'No'],
                    ['Cloudflare API calls made here', resourceModel.cloudflareApiCallsMade === true ? 'Yes' : 'No'],
                    ['Secret values exposed', resourceModel.secretValuesExposed === true ? 'Yes' : 'No'],
                ],
                actions: [
                    { label: 'Copy resource model', copy: resourceModel.command || 'npm run cloudflare:resource-model' },
                    { label: 'Copy resource model Markdown', copy: resourceModel.markdownCommand || 'npm run cloudflare:resource-model:markdown' },
                ],
            },
            {
                title: 'Readiness Dossier',
                badge: dossier.status || 'local only',
                copy: 'Single local evidence packet combining release plan, resource model, evidence index, cutover summary, rollback placeholders, and blocked claims.',
                meta: [
                    ['Formats', (dossier.outputFormats || ['json', 'markdown']).join(', ')],
                    ['Default live calls', dossier.defaultLiveCalls === true ? 'Yes' : 'No'],
                    ['Production readiness', dossier.productionReadiness || 'blocked'],
                    ['Live billing readiness', dossier.liveBillingReadiness || 'blocked'],
                ],
                actions: (dossier.commands || ['npm run readiness:dossier', 'npm run readiness:dossier:markdown']).map((command) => ({
                    label: command.includes('markdown') ? 'Copy dossier Markdown' : 'Copy dossier JSON',
                    copy: command,
                })),
            },
            {
                title: 'Post-Deploy Read-Only Verification',
                badge: postDeploy.status || 'pending',
                copy: 'Operator-run live checks are opt-in and GET-only by default. Admin cookies are never rendered; admin checks stay pending when no cookie is provided.',
                meta: [
                    ['Command', postDeploy.command || 'npm run readiness:live-readonly'],
                    ['GET-only by default', postDeploy.getOnlyByDefault === true ? 'Yes' : 'No'],
                    ['Admin cookie required for admin panels', postDeploy.adminCookieRequiredForAdminPanels === true ? 'Yes' : 'No'],
                    ['Admin cookie value rendered', postDeploy.adminCookieValueRendered === true ? 'Yes' : 'No'],
                    ['Checks', (postDeploy.checks || []).join(', ')],
                ],
                actions: [
                    { label: 'Copy live-read-only command', copy: postDeploy.command || 'npm run readiness:live-readonly' },
                ],
            },
            {
                title: 'Rollback Drill',
                badge: rollback.status || 'not executed',
                copy: 'Rollback readiness is documented as a drill artifact only. The command records placeholders and smoke checks; it does not execute rollback.',
                meta: [
                    ['Command', rollback.command || 'npm run release:rollback-drill'],
                    ['Rollback executed', rollback.rollbackExecuted === true ? 'Yes' : 'No'],
                    ['Rollback owner', rollback.ownerPlaceholder || 'operator to fill'],
                    ['Required evidence', (rollback.requiredEvidence || []).join(', ')],
                ],
                actions: [
                    { label: 'Copy rollback drill command', copy: rollback.command || 'npm run release:rollback-drill' },
                ],
            },
        ];

        for (const card of cards) {
            const item = el('article', 'admin-control-card glass glass-card reveal visible');
            const top = el('div', 'admin-control-card__top');
            top.append(el('h3', 'admin-section-title', card.title), badge(statusLabel(card.badge), statusVariant(card.badge)));
            item.append(top, el('p', 'admin-shell__desc', card.copy));
            item.appendChild(detailRows(card.meta));
            const actions = el('div', 'admin-control-chip-row');
            for (const action of card.actions || []) {
                const button = el('button', 'btn-action', action.label);
                button.type = 'button';
                button.addEventListener('click', async () => {
                    const copied = await copyTextToClipboard(action.copy);
                    notify(copied ? `${action.label} copied.` : 'Copy failed.', copied ? 'success' : 'error');
                });
                actions.appendChild(button);
            }
            if (actions.childNodes.length) item.appendChild(actions);
            grid.appendChild(item);
        }

        section.appendChild(grid);
        container.appendChild(section);
    }

    function renderReleaseCandidate(container, status) {
        const rc = status.releaseCandidate || READINESS_FALLBACK_STATUS.releaseCandidate;
        const commands = Array.isArray(rc.commands) ? rc.commands : READINESS_FALLBACK_STATUS.releaseCandidate.commands;
        const commandByText = (text) => commands.find((command) => command === text) || text;
        const section = readinessSection('Release Candidate / Go-No-Go', 'Final RC state, validation matrix, evidence freeze, and blocked claim acknowledgement. This panel copies commands only; it never executes shell commands or performs deployment actions.');
        const grid = el('div', 'admin-control-grid');
        const cards = [
            {
                title: 'Release Candidate Status',
                badge: rc.status || 'blocked',
                copy: 'The RC package is repo-supported for code merge or deploy preparation only. Production readiness and live billing readiness remain blocked until live/manual evidence is collected and reviewed.',
                meta: [
                    ['CI status', rc.ciStatus || 'unknown'],
                    ['RC use', rc.releaseCandidateUse || 'code merge / deploy preparation only'],
                    ['Production readiness', rc.productionReadiness || 'blocked'],
                    ['Live billing readiness', rc.liveBillingReadiness || 'blocked'],
                    ['Browser executes commands', rc.browserExecutesCommands === true ? 'Yes' : 'No'],
                    ['Dangerous actions offered', rc.dangerousActionsOffered === true ? 'Yes' : 'No'],
                ],
            },
            {
                title: 'P0/P1 Wave Matrix',
                badge: 'Evidence blockers visible',
                copy: 'Completed waves are repo-supported current state. Evidence blockers stay visible and do not become live readiness claims.',
                meta: [
                    ['Matrix', (rc.waveMatrix || []).join(', ')],
                ],
            },
            {
                title: 'Final RC Commands',
                badge: 'Copy-only',
                copy: 'Generate the RC manifest, validation matrix, readiness dossier, rollback drill, and release plan from an operator terminal.',
                meta: [
                    ['Primary matrix', commandByText('npm run rc:check')],
                    ['RC Markdown', commandByText('npm run release:rc:markdown')],
                    ['Readiness dossier', commandByText('npm run readiness:dossier:markdown')],
                ],
                actions: [
                    { label: 'Copy RC check', copy: commandByText('npm run rc:check') },
                    { label: 'Copy RC manifest JSON', copy: commandByText('npm run release:rc') },
                    { label: 'Copy RC manifest Markdown', copy: commandByText('npm run release:rc:markdown') },
                    { label: 'Copy RC dossier Markdown', copy: commandByText('npm run readiness:dossier:markdown') },
                    { label: 'Copy rollback drill', copy: commandByText('npm run release:rollback-drill') },
                    { label: 'Copy release plan', copy: commandByText('npm run release:plan') },
                ],
            },
            {
                title: 'Go/No-Go Checklist',
                badge: 'Production blocked',
                copy: 'Every checklist item must be reviewed before deploy approval. Live evidence can remain pending only when the operator explicitly acknowledges blocked claims.',
                meta: [
                    ['Checklist', (rc.checklist || []).join(', ')],
                    ['Blocked claims', 'production readiness, live billing readiness, tenant isolation, ownership backfill, access switch, confirmed legacy reset'],
                ],
            },
        ];

        for (const card of cards) {
            const item = el('article', 'admin-control-card glass glass-card reveal visible');
            const top = el('div', 'admin-control-card__top');
            top.append(el('h3', 'admin-section-title', card.title), badge(statusLabel(card.badge), statusVariant(card.badge)));
            item.append(top, el('p', 'admin-shell__desc', card.copy));
            if (card.meta) item.appendChild(detailRows(card.meta));
            const actions = el('div', 'admin-control-chip-row');
            for (const action of card.actions || []) {
                const button = el('button', 'btn-action', action.label);
                button.type = 'button';
                button.addEventListener('click', async () => {
                    const copied = await copyTextToClipboard(action.copy);
                    notify(copied ? `${action.label} copied.` : 'Copy failed.', copied ? 'success' : 'error');
                });
                actions.appendChild(button);
            }
            if (actions.childNodes.length) item.appendChild(actions);
            grid.appendChild(item);
        }
        section.appendChild(grid);
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
        renderProductionExecution(container, status);
        renderReleaseCandidate(container, status);
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
        byId('billingEvidenceRefresh')?.addEventListener('click', loadBillingEvidenceStatus);
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
        byId('operatorTimelineRefresh')?.addEventListener('click', loadOperatorTimeline);
        byId('operatorTimelineFilter')?.addEventListener('submit', (event) => {
            event.preventDefault();
            loadOperatorTimeline();
        });
        byId('operatorTimelineCopyEvidenceIndex')?.addEventListener('click', async () => {
            const copied = await copyTextToClipboard('npm run evidence:index\nnpm run evidence:index:markdown');
            notify(copied ? 'Evidence index commands copied.' : 'Copy failed.', copied ? 'success' : 'error');
        });
        byId('operatorTimelineCopyRunbook')?.addEventListener('click', async () => {
            const copied = await copyTextToClipboard('docs/runbooks/OPERATOR_TRIAGE_RUNBOOK.md');
            notify(copied ? 'Runbook path copied.' : 'Copy failed.', copied ? 'success' : 'error');
        });
        byId('tenantReviewRefresh')?.addEventListener('click', loadTenantAssetManualReviewQueue);
        byId('tenantReviewDryRunPostCleanup')?.addEventListener('click', (event) => {
            runTenantReviewPostCleanupDryRun(event.currentTarget);
        });
        byId('tenantReviewExportJson')?.addEventListener('click', (event) => {
            exportTenantAssetManualReviewEvidenceJson(event.currentTarget);
        });
        byId('tenantReviewExportPostCleanupJson')?.addEventListener('click', (event) => {
            exportTenantAssetManualReviewPostCleanupEvidence(event.currentTarget, 'json');
        });
        byId('tenantReviewExportPostCleanupMarkdown')?.addEventListener('click', (event) => {
            exportTenantAssetManualReviewPostCleanupEvidence(event.currentTarget, 'markdown');
        });
        byId('tenantReviewExportPostCleanupHtml')?.addEventListener('click', (event) => {
            exportTenantAssetManualReviewPostCleanupEvidence(event.currentTarget, 'html');
        });
        byId('tenantReviewSupersedeWarning')?.addEventListener('click', () => {
            setState('tenantReviewSupersedeState', 'This does not delete assets. It marks manual-review rows as superseded when the referenced asset no longer exists or ownership evidence has superseded the old review. Active/blocking/manual-review rows remain untouched.');
        });
        byId('tenantReviewSupersedeForm')?.addEventListener('submit', handleTenantReviewSupersedeSubmit);
        byId('tenantReviewSupersedeConfirmation')?.addEventListener('input', updateTenantReviewSupersedeControls);
        byId('tenantReviewSupersedeReason')?.addEventListener('input', updateTenantReviewSupersedeControls);
        byId('tenantReviewSupersedeBatchLimit')?.addEventListener('input', updateTenantReviewSupersedeControls);
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
        if (sectionName === 'billing-events') await Promise.all([loadBillingEvidenceStatus(), loadBillingReconciliation(), loadBillingReviews(), loadBillingEvents()]);
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
