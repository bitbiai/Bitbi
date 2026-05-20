import {
    CURRENT_AUTH_SCHEMA_CHECKPOINT,
    readableToken,
} from './core.js?v=__ASSET_VERSION__';

export const READINESS_FALLBACK_STATUS = Object.freeze({
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
            'Core readiness gates are repo-supported; evidence blockers remain visible',
            'Security, cost, Admin, lifecycle, tenant asset, and release controls are repo-supported; live/manual evidence remains pending where applicable',
            'Release candidate framework is local-only and does not prove production readiness',
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
        { label: 'Main release readiness gate', status: 'implemented_repo_supported' },
        { label: 'Confirmed legacy reset gate', status: 'implemented_default_off' },
        { label: 'Sanitized legacy reset dry-run evidence', status: 'pending_blocking' },
        { label: 'Manual-review idempotency evidence', status: 'pending_blocking' },
        { label: 'Active documentation drift cleanup', status: 'implemented_repo_supported' },
        { label: 'Security and cost hardening', status: 'implemented_repo_supported' },
        { label: 'Release, canary, billing, and admin mutation hardening', status: 'implemented_repo_supported' },
        { label: 'Admin, data, observability, and scale hardening', status: 'implemented_repo_supported' },
        { label: 'Admin Readiness & Evidence Dashboard', status: 'implemented_repo_supported' },
        { label: 'Live evidence and cutover tooling', status: 'implemented_repo_supported' },
        { label: 'Production execution framework', status: 'implemented_repo_supported_live_evidence_pending' },
        { label: 'Release candidate consolidation', status: 'implemented_repo_supported_go_no_go_blocked' },
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

export const READINESS_COMMAND_GROUPS = Object.freeze([
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

export function statusVariant(value) {
    const status = String(value || '').toLowerCase();
    if (status.includes('implemented') || status === 'available' || status === 'repo_supported') return 'active';
    if (status.includes('disabled') || status.includes('blocked') || status.includes('not_approved') || status.includes('not_claimed') || status.includes('unsafe')) return 'disabled';
    if (status.includes('pending') || status.includes('verification') || status.includes('required')) return 'legacy';
    return 'user';
}

export function statusLabel(value) {
    return readableToken(value || 'not reported');
}

export function normalizeReadinessStatus(data) {
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
