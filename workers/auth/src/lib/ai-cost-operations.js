import {
  AI_COST_GATEWAY_SCOPES,
  normalizeAiCostOperationConfig,
} from "./ai-cost-gateway.js";

export const AI_COST_OPERATION_REGISTRY_VERSION = "ai-cost-operations-2026-05-15";

export const AI_COST_CURRENT_ENFORCEMENT_STATUSES = Object.freeze([
  "implemented",
  "partial",
  "missing",
  "not_applicable",
]);

export const AI_COST_BUDGET_SCOPES = Object.freeze({
  MEMBER_CREDIT_ACCOUNT: "member_credit_account",
  ORGANIZATION_CREDIT_ACCOUNT: "organization_credit_account",
  ADMIN_ORG_CREDIT_ACCOUNT: "admin_org_credit_account",
  PLATFORM_ADMIN_LAB_BUDGET: "platform_admin_lab_budget",
  PLATFORM_BACKGROUND_BUDGET: "platform_background_budget",
  OPENCLAW_NEWS_PULSE_BUDGET: "openclaw_news_pulse_budget",
  INTERNAL_AI_WORKER_CALLER_ENFORCED: "internal_ai_worker_caller_enforced",
  EXPLICIT_UNMETERED_ADMIN: "explicit_unmetered_admin",
  EXTERNAL_PROVIDER_ONLY: "external_provider_only",
});

export const AI_COST_BUDGET_SCOPE_POLICIES = Object.freeze({
  [AI_COST_BUDGET_SCOPES.MEMBER_CREDIT_ACCOUNT]: Object.freeze({
    owner: "member",
    creditsDebited: true,
    adminVisibleBudgetRequired: false,
    killSwitchRequired: true,
    idempotencyMandatory: true,
    replayExpected: true,
    operatorReviewRequired: false,
  }),
  [AI_COST_BUDGET_SCOPES.ORGANIZATION_CREDIT_ACCOUNT]: Object.freeze({
    owner: "organization",
    creditsDebited: true,
    adminVisibleBudgetRequired: false,
    killSwitchRequired: true,
    idempotencyMandatory: true,
    replayExpected: true,
    operatorReviewRequired: false,
  }),
  [AI_COST_BUDGET_SCOPES.ADMIN_ORG_CREDIT_ACCOUNT]: Object.freeze({
    owner: "selected organization for admin-initiated paid tests",
    creditsDebited: true,
    adminVisibleBudgetRequired: true,
    killSwitchRequired: true,
    idempotencyMandatory: true,
    replayExpected: true,
    operatorReviewRequired: true,
  }),
  [AI_COST_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET]: Object.freeze({
    owner: "platform admin lab budget",
    creditsDebited: false,
    adminVisibleBudgetRequired: true,
    killSwitchRequired: true,
    idempotencyMandatory: true,
    replayExpected: "operation-dependent",
    operatorReviewRequired: true,
  }),
  [AI_COST_BUDGET_SCOPES.PLATFORM_BACKGROUND_BUDGET]: Object.freeze({
    owner: "platform background job budget",
    creditsDebited: false,
    adminVisibleBudgetRequired: true,
    killSwitchRequired: true,
    idempotencyMandatory: true,
    replayExpected: true,
    operatorReviewRequired: true,
  }),
  [AI_COST_BUDGET_SCOPES.OPENCLAW_NEWS_PULSE_BUDGET]: Object.freeze({
    owner: "OpenClaw / News Pulse platform budget",
    creditsDebited: false,
    adminVisibleBudgetRequired: true,
    killSwitchRequired: true,
    idempotencyMandatory: true,
    replayExpected: true,
    operatorReviewRequired: true,
  }),
  [AI_COST_BUDGET_SCOPES.INTERNAL_AI_WORKER_CALLER_ENFORCED]: Object.freeze({
    owner: "caller route or queue job",
    creditsDebited: false,
    adminVisibleBudgetRequired: true,
    killSwitchRequired: true,
    idempotencyMandatory: "delegated",
    replayExpected: "delegated",
    operatorReviewRequired: true,
  }),
  [AI_COST_BUDGET_SCOPES.EXPLICIT_UNMETERED_ADMIN]: Object.freeze({
    owner: "explicit admin exception",
    creditsDebited: false,
    adminVisibleBudgetRequired: true,
    killSwitchRequired: true,
    idempotencyMandatory: false,
    replayExpected: false,
    operatorReviewRequired: true,
  }),
  [AI_COST_BUDGET_SCOPES.EXTERNAL_PROVIDER_ONLY]: Object.freeze({
    owner: "external provider / not billed by BITBI",
    creditsDebited: false,
    adminVisibleBudgetRequired: false,
    killSwitchRequired: true,
    idempotencyMandatory: "caller-dependent",
    replayExpected: "caller-dependent",
    operatorReviewRequired: true,
  }),
});

const ENFORCEMENT_DETAIL_STATUSES = new Set([
  "implemented",
  "partial",
  "recommended",
  "missing",
  "delegated",
  "not_applicable",
]);

const GAP_SEVERITIES = new Set(["P0", "P1", "P2", "P3"]);
const BUDGET_SCOPE_VALUES = new Set(Object.values(AI_COST_BUDGET_SCOPES));

function freezeList(value = []) {
  return Object.freeze([...value]);
}

function budgetPolicy(targetBudgetScope, {
  currentBudgetScope = targetBudgetScope,
  targetFuturePhase,
  targetEnforcementStatus = "missing",
  targetEnforcement = {},
  notes,
  temporaryBaselineAllowed = false,
  dailyLimitTarget = "required_before_runtime_enforcement",
  monthlyLimitTarget = "required_before_runtime_enforcement",
  killSwitchTarget = "required_before_runtime_enforcement",
} = {}) {
  return Object.freeze({
    targetBudgetScope,
    currentBudgetScope,
    targetFuturePhase,
    targetEnforcementStatus,
    targetEnforcement: Object.freeze({ ...targetEnforcement }),
    notes,
    temporaryBaselineAllowed,
    dailyLimitTarget,
    monthlyLimitTarget,
    killSwitchTarget,
  });
}

const BUDGET_POLICY_BY_OPERATION_ID = Object.freeze({
  "admin.text.test": budgetPolicy(AI_COST_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET, {
    currentBudgetScope: AI_COST_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET,
    targetFuturePhase: "Phase 4.8.1 admin text/embeddings durable idempotency foundation",
    targetEnforcementStatus: "partial",
    targetEnforcement: { idempotency: "durable_metadata_only", budgetLedger: "platform_admin_lab_budget_metadata", replay: "metadata_only_no_result_replay", killSwitch: "ENABLE_ADMIN_AI_TEXT_BUDGET metadata target" },
    notes: "Phase 4.8.1 requires Idempotency-Key, creates admin_ai_usage_attempts rows, suppresses same-key duplicate provider execution after pending/completed/failed states, conflicts same-key/different-request retries, and stores metadata-only replay state without credits or live budget caps. Phase 4.8.2 adds bounded non-destructive cleanup plus admin-only sanitized inspection for those rows.",
    temporaryBaselineAllowed: false,
    killSwitchTarget: "ENABLE_ADMIN_AI_TEXT_BUDGET",
  }),
  "admin.image.test.charged": budgetPolicy(AI_COST_BUDGET_SCOPES.ADMIN_ORG_CREDIT_ACCOUNT, {
    targetFuturePhase: "Phase 4.3 admin BFL image test budget enforcement hardening",
    targetEnforcementStatus: "implemented",
    targetEnforcement: { idempotency: "required", budgetLedger: "selected_org_credit_account", replay: "metadata_only", killSwitch: "ENABLE_ADMIN_AI_BFL_IMAGE_BUDGET metadata target" },
    notes: "Phase 4.3 hardens the charged Admin image-test branch with admin_org_credit_account budget policy metadata while preserving selected organization credit debits and no provider replay.",
  }),
  "admin.image.test.unmetered": budgetPolicy(AI_COST_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET, {
    currentBudgetScope: AI_COST_BUDGET_SCOPES.EXPLICIT_UNMETERED_ADMIN,
    targetFuturePhase: "Phase 4.2 admin AI budget policy contract/helpers",
    targetEnforcementStatus: "missing",
    targetEnforcement: { idempotency: "required_or_explicit_exception", budgetLedger: "platform_admin_lab_budget", replay: "metadata_or_disabled", killSwitch: "required" },
    notes: "Unpriced admin image models must become explicit platform admin lab budget spend or stay disabled.",
    temporaryBaselineAllowed: true,
  }),
  "admin.embeddings.test": budgetPolicy(AI_COST_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET, {
    currentBudgetScope: AI_COST_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET,
    targetFuturePhase: "Phase 4.8.1 admin text/embeddings durable idempotency foundation",
    targetEnforcementStatus: "partial",
    targetEnforcement: { idempotency: "durable_metadata_only", budgetLedger: "platform_admin_lab_budget_metadata", replay: "metadata_only_no_vectors", killSwitch: "ENABLE_ADMIN_AI_EMBEDDINGS_BUDGET metadata target" },
    notes: "Phase 4.8.1 requires Idempotency-Key, creates admin_ai_usage_attempts rows, suppresses same-key duplicate provider execution after pending/completed/failed states, conflicts same-key/different-request retries, and stores metadata-only replay state without raw embedding input, vectors, credits, or live budget caps. Phase 4.8.2 adds bounded non-destructive cleanup plus admin-only sanitized inspection for those rows.",
    temporaryBaselineAllowed: false,
    killSwitchTarget: "ENABLE_ADMIN_AI_EMBEDDINGS_BUDGET",
  }),
  "admin.music.test": budgetPolicy(AI_COST_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET, {
    currentBudgetScope: AI_COST_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET,
    targetFuturePhase: "Phase 4.9 admin music budget enforcement",
    targetEnforcementStatus: "partial",
    targetEnforcement: { idempotency: "durable_metadata_only", budgetLedger: "platform_admin_lab_budget_metadata", replay: "metadata_only_no_audio", killSwitch: "ENABLE_ADMIN_AI_MUSIC_BUDGET metadata target" },
    notes: "Phase 4.9 requires Idempotency-Key, creates admin_ai_usage_attempts rows, suppresses same-key duplicate provider execution after pending/completed/failed states, conflicts same-key/different-request retries, and stores metadata-only replay state without raw prompts, lyrics, audio, credits, or live budget caps. Phase 4.8.2 cleanup/inspection applies to these rows.",
    temporaryBaselineAllowed: false,
    killSwitchTarget: "ENABLE_ADMIN_AI_MUSIC_BUDGET",
  }),
  "admin.video.sync_debug": budgetPolicy(AI_COST_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET, {
    currentBudgetScope: AI_COST_BUDGET_SCOPES.EXPLICIT_UNMETERED_ADMIN,
    targetFuturePhase: "Phase 4.2 admin AI budget policy contract/helpers",
    targetEnforcementStatus: "missing",
    targetEnforcement: { idempotency: "required", budgetLedger: "platform_admin_lab_budget", replay: "disabled", killSwitch: "ALLOW_SYNC_VIDEO_DEBUG plus budget flag" },
    notes: "Sync video debug should remain disabled unless an explicit platform lab budget and emergency runbook exist.",
    temporaryBaselineAllowed: true,
  }),
  "admin.video.job.create": budgetPolicy(AI_COST_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET, {
    targetFuturePhase: "Phase 4.5 admin async video job budget enforcement",
    targetEnforcementStatus: "implemented",
    targetEnforcement: { idempotency: "required", budgetLedger: "platform_admin_lab_budget_metadata", replay: "job_metadata", killSwitch: "ENABLE_ADMIN_AI_VIDEO_JOB_BUDGET metadata target" },
    notes: "Phase 4.5 adds sanitized platform_admin_lab_budget job/queue metadata before admin async video provider-cost work; no credits are debited.",
    temporaryBaselineAllowed: false,
  }),
  "admin.video.task.create": budgetPolicy(AI_COST_BUDGET_SCOPES.INTERNAL_AI_WORKER_CALLER_ENFORCED, {
    targetFuturePhase: "Phase 4.5 admin async video job budget enforcement",
    targetEnforcementStatus: "implemented",
    targetEnforcement: { idempotency: "delegated_to_job", budgetLedger: "caller_enforced_admin_video_job_budget_state", replay: "provider_task_metadata", killSwitch: "ENABLE_ADMIN_AI_VIDEO_JOB_BUDGET metadata target" },
    notes: "Phase 4.5 requires valid admin video job budget metadata before the auth queue calls the internal video task create route.",
    temporaryBaselineAllowed: false,
  }),
  "admin.video.task.poll": budgetPolicy(AI_COST_BUDGET_SCOPES.INTERNAL_AI_WORKER_CALLER_ENFORCED, {
    targetFuturePhase: "Phase 4.5 admin async video job budget enforcement",
    targetEnforcementStatus: "implemented",
    targetEnforcement: { idempotency: "delegated_to_job", budgetLedger: "caller_enforced_admin_video_job_budget_state", replay: "provider_status_metadata", killSwitch: "ENABLE_ADMIN_AI_VIDEO_JOB_BUDGET metadata target" },
    notes: "Phase 4.5 requires valid admin video job budget metadata and a persisted provider task id before polling.",
    temporaryBaselineAllowed: false,
  }),
  "admin.compare": budgetPolicy(AI_COST_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET, {
    currentBudgetScope: AI_COST_BUDGET_SCOPES.EXPLICIT_UNMETERED_ADMIN,
    targetFuturePhase: "Phase 4.2 admin AI budget policy contract/helpers",
    targetEnforcementStatus: "missing",
    targetEnforcement: { idempotency: "required", budgetLedger: "platform_admin_lab_budget", replay: "metadata_or_disabled", killSwitch: "required" },
    notes: "Admin compare can fan out to multiple provider calls and needs explicit budget accounting.",
    temporaryBaselineAllowed: true,
  }),
  "admin.live_agent": budgetPolicy(AI_COST_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET, {
    currentBudgetScope: AI_COST_BUDGET_SCOPES.EXPLICIT_UNMETERED_ADMIN,
    targetFuturePhase: "Phase 4.2 admin AI budget policy contract/helpers",
    targetEnforcementStatus: "missing",
    targetEnforcement: { idempotency: "stream_session_required", budgetLedger: "platform_admin_lab_budget", replay: "disabled", killSwitch: "required" },
    notes: "Streaming live-agent spend needs stream duration/token telemetry and a platform lab budget cap.",
    temporaryBaselineAllowed: true,
  }),
  "internal.text.generate": budgetPolicy(AI_COST_BUDGET_SCOPES.INTERNAL_AI_WORKER_CALLER_ENFORCED, {
    targetFuturePhase: "Phase 4.7 internal AI Worker route caller-policy guard",
    targetEnforcementStatus: "delegated",
    targetEnforcement: { idempotency: "caller_enforced", budgetLedger: "caller_enforced", replay: "caller_enforced", killSwitch: "service_binding_only" },
    notes: "Internal text route should remain service-only and require caller-side operation metadata.",
    temporaryBaselineAllowed: true,
  }),
  "internal.image.generate": budgetPolicy(AI_COST_BUDGET_SCOPES.INTERNAL_AI_WORKER_CALLER_ENFORCED, {
    targetFuturePhase: "Phase 4.7 internal AI Worker route caller-policy guard",
    targetEnforcementStatus: "delegated",
    targetEnforcement: { idempotency: "caller_enforced", budgetLedger: "caller_enforced", replay: "caller_enforced", killSwitch: "service_binding_only" },
    notes: "Internal image route should remain service-only and require caller-side operation metadata.",
    temporaryBaselineAllowed: true,
  }),
  "internal.embeddings.generate": budgetPolicy(AI_COST_BUDGET_SCOPES.INTERNAL_AI_WORKER_CALLER_ENFORCED, {
    targetFuturePhase: "Phase 4.7 internal AI Worker route caller-policy guard",
    targetEnforcementStatus: "delegated",
    targetEnforcement: { idempotency: "caller_enforced", budgetLedger: "caller_enforced", replay: "caller_enforced", killSwitch: "service_binding_only" },
    notes: "Internal embeddings route should remain service-only and require caller-side operation metadata if used.",
    temporaryBaselineAllowed: true,
  }),
  "internal.music.generate": budgetPolicy(AI_COST_BUDGET_SCOPES.INTERNAL_AI_WORKER_CALLER_ENFORCED, {
    targetFuturePhase: "Phase 4.7 internal AI Worker route caller-policy guard",
    targetEnforcementStatus: "delegated",
    targetEnforcement: { idempotency: "caller_enforced", budgetLedger: "caller_enforced", replay: "caller_enforced", killSwitch: "service_binding_only" },
    notes: "Member music caller is migrated; admin/internal callers still need caller-policy metadata.",
    temporaryBaselineAllowed: true,
  }),
  "internal.video.generate": budgetPolicy(AI_COST_BUDGET_SCOPES.INTERNAL_AI_WORKER_CALLER_ENFORCED, {
    targetFuturePhase: "Phase 4.7 internal AI Worker route caller-policy guard",
    targetEnforcementStatus: "delegated",
    targetEnforcement: { idempotency: "caller_enforced", budgetLedger: "caller_enforced", replay: "caller_enforced", killSwitch: "service_binding_only" },
    notes: "Internal sync video route should remain caller-gated and debug-disabled unless explicitly budgeted.",
    temporaryBaselineAllowed: true,
  }),
  "internal.video_task.create": budgetPolicy(AI_COST_BUDGET_SCOPES.INTERNAL_AI_WORKER_CALLER_ENFORCED, {
    targetFuturePhase: "Phase 4.7 internal AI Worker route caller-policy guard",
    targetEnforcementStatus: "implemented",
    targetEnforcement: { idempotency: "caller_policy_required", budgetLedger: "caller_enforced", replay: "provider_task_metadata", killSwitch: "service_binding_only plus caller kill-switch metadata" },
    notes: "Phase 4.7 requires valid caller-policy metadata for internal provider task creation and ties the admin video caller to job budget state.",
    temporaryBaselineAllowed: false,
  }),
  "internal.video_task.poll": budgetPolicy(AI_COST_BUDGET_SCOPES.INTERNAL_AI_WORKER_CALLER_ENFORCED, {
    targetFuturePhase: "Phase 4.7 internal AI Worker route caller-policy guard",
    targetEnforcementStatus: "implemented",
    targetEnforcement: { idempotency: "caller_policy_required", budgetLedger: "caller_enforced", replay: "provider_status_metadata", killSwitch: "service_binding_only plus caller kill-switch metadata" },
    notes: "Phase 4.7 requires valid caller-policy metadata for internal provider polling and preserves the persisted provider task id guard.",
    temporaryBaselineAllowed: false,
  }),
  "internal.compare": budgetPolicy(AI_COST_BUDGET_SCOPES.INTERNAL_AI_WORKER_CALLER_ENFORCED, {
    targetFuturePhase: "Phase 4.7 internal AI Worker route caller-policy guard",
    targetEnforcementStatus: "delegated",
    targetEnforcement: { idempotency: "caller_enforced", budgetLedger: "caller_enforced", replay: "caller_enforced", killSwitch: "service_binding_only" },
    notes: "Internal compare can fan out and must be controlled by the admin caller policy.",
    temporaryBaselineAllowed: true,
  }),
  "internal.live_agent": budgetPolicy(AI_COST_BUDGET_SCOPES.INTERNAL_AI_WORKER_CALLER_ENFORCED, {
    targetFuturePhase: "Phase 4.7 internal AI Worker route caller-policy guard",
    targetEnforcementStatus: "delegated",
    targetEnforcement: { idempotency: "caller_stream_session", budgetLedger: "caller_enforced", replay: "disabled", killSwitch: "service_binding_only" },
    notes: "Internal live-agent spend must be controlled by caller stream-session policy.",
    temporaryBaselineAllowed: true,
  }),
  "platform.news_pulse.visual.ingest": budgetPolicy(AI_COST_BUDGET_SCOPES.OPENCLAW_NEWS_PULSE_BUDGET, {
    targetFuturePhase: "Phase 4.6 OpenClaw/News Pulse visual budget controls",
    targetEnforcementStatus: "implemented",
    targetEnforcement: { idempotency: "deterministic_item_key", budgetLedger: "openclaw_news_pulse_budget_metadata", replay: "durable_thumbnail", killSwitch: "ENABLE_NEWS_PULSE_VISUAL_BUDGET metadata target" },
    notes: "Phase 4.6 records openclaw_news_pulse_budget metadata before ingest-triggered visual provider calls and keeps duplicate suppression on deterministic item/status rows.",
    temporaryBaselineAllowed: false,
    killSwitchTarget: "ENABLE_NEWS_PULSE_VISUAL_BUDGET",
  }),
  "platform.news_pulse.visual.scheduled": budgetPolicy(AI_COST_BUDGET_SCOPES.OPENCLAW_NEWS_PULSE_BUDGET, {
    targetFuturePhase: "Phase 4.6 OpenClaw/News Pulse visual budget controls",
    targetEnforcementStatus: "implemented",
    targetEnforcement: { idempotency: "deterministic_item_key", budgetLedger: "openclaw_news_pulse_budget_metadata", replay: "durable_thumbnail", killSwitch: "ENABLE_NEWS_PULSE_VISUAL_BUDGET metadata target" },
    notes: "Phase 4.6 records openclaw_news_pulse_budget metadata before scheduled/backfill visual provider calls and preserves bounded batch/status guards.",
    temporaryBaselineAllowed: false,
    killSwitchTarget: "ENABLE_NEWS_PULSE_VISUAL_BUDGET",
  }),
});

function resolvedBudgetPolicy(entry) {
  return entry.budgetPolicy || BUDGET_POLICY_BY_OPERATION_ID[entry.operationConfig?.operationId] || null;
}

function operation(entry) {
  const entryBudgetPolicy = resolvedBudgetPolicy(entry);
  return Object.freeze({
    ...entry,
    operationConfig: Object.freeze({ ...entry.operationConfig }),
    sourceFiles: freezeList(entry.sourceFiles),
    currentEnforcement: Object.freeze({ ...entry.currentEnforcement }),
    budgetPolicy: entryBudgetPolicy ? Object.freeze({
      ...entryBudgetPolicy,
      targetEnforcement: Object.freeze({ ...entryBudgetPolicy.targetEnforcement }),
    }) : null,
    routePolicy: entry.routePolicy ? Object.freeze({ ...entry.routePolicy }) : null,
    currentGaps: freezeList(entry.currentGaps),
  });
}

export const AI_COST_OPERATION_REGISTRY = Object.freeze([
  operation({
    operationConfig: {
      operationId: "member.image.generate",
      featureKey: "ai.image.generate",
      actorType: "member",
      billingScope: AI_COST_GATEWAY_SCOPES.MEMBER_CREDIT_ACCOUNT,
      providerFamily: "workers_ai",
      modelResolverKey: "member.image.model_catalog",
      creditCost: 0,
      costPolicy: "member_image_model_catalog",
      quantity: 1,
      idempotencyPolicy: "required",
      reservationPolicy: "required",
      replayPolicy: "temp_object",
      failurePolicy: ["release_reservation", "no_charge", "terminal_billing_failure"],
      storagePolicy: "user_images",
      observabilityEventPrefix: "member.image.generate",
      routeId: "ai.generate-image",
      routePath: "/api/ai/generate-image",
      notes: "Phase 3.4 pilot config for no-organization member image generation. Phase 3.7 hardens replay-unavailable metadata and scheduled cleanup while keeping member_ai_usage_attempts as the reservation/replay foundation.",
    },
    sourceFiles: ["workers/auth/src/routes/ai/images-write.js"],
    currentStatus: "implemented",
    currentEnforcement: {
      idempotency: "implemented",
      reservation: "implemented",
      replay: "implemented",
      creditCheck: "implemented",
      providerSuppression: "implemented",
    },
    routePolicy: {
      id: "ai.generate-image",
      path: "/api/ai/generate-image",
      expectedIdempotency: "required",
    },
    currentGaps: [],
    gapSeverity: "P3",
    nextMigrationPhase: "Phase 4.1 admin/platform budget policy design",
  }),
  operation({
    operationConfig: {
      operationId: "org.image.generate",
      featureKey: "ai.image.generate",
      actorType: "organization",
      billingScope: AI_COST_GATEWAY_SCOPES.ORGANIZATION_CREDIT_ACCOUNT,
      providerFamily: "workers_ai",
      modelResolverKey: "member.image.model_catalog",
      creditCost: 0,
      costPolicy: "org_image_model_catalog",
      quantity: 1,
      idempotencyPolicy: "required",
      reservationPolicy: "required",
      replayPolicy: "temp_object",
      failurePolicy: ["release_reservation", "no_charge", "terminal_billing_failure"],
      storagePolicy: "user_images",
      observabilityEventPrefix: "org.image.generate",
      routeId: "ai.generate-image",
      routePath: "/api/ai/generate-image",
      notes: "Org-scoped image path already uses ai_usage_attempts reservation/replay for same-key retries.",
    },
    sourceFiles: ["workers/auth/src/routes/ai/images-write.js"],
    currentStatus: "implemented",
    currentEnforcement: {
      idempotency: "implemented",
      reservation: "implemented",
      replay: "implemented",
      creditCheck: "implemented",
      providerSuppression: "implemented",
    },
    routePolicy: null,
    currentGaps: [],
    gapSeverity: "P3",
    nextMigrationPhase: "Gateway adapter after member route migrations",
  }),
  operation({
    operationConfig: {
      operationId: "member.text.generate",
      featureKey: "ai.text.generate",
      actorType: "member",
      billingScope: AI_COST_GATEWAY_SCOPES.EXTERNAL,
      providerFamily: "none",
      providerCost: false,
      creditCost: 0,
      quantity: 1,
      idempotencyPolicy: "forbidden",
      reservationPolicy: "not_supported",
      replayPolicy: "metadata_only",
      failurePolicy: "no_charge",
      storagePolicy: "none",
      observabilityEventPrefix: "member.text.generate",
      routeId: "ai.generate-text",
      routePath: "/api/ai/generate-text",
      notes: "No personal member text provider route currently exists; the route rejects missing organization context.",
    },
    sourceFiles: ["workers/auth/src/routes/ai/text-generate.js"],
    currentStatus: "not_applicable",
    currentEnforcement: {
      idempotency: "not_applicable",
      reservation: "not_applicable",
      replay: "not_applicable",
      creditCheck: "not_applicable",
      providerSuppression: "not_applicable",
    },
    routePolicy: null,
    currentGaps: [],
    gapSeverity: "P3",
    nextMigrationPhase: "Only if personal member text generation is intentionally added",
  }),
  operation({
    operationConfig: {
      operationId: "org.text.generate",
      featureKey: "ai.text.generate",
      actorType: "organization",
      billingScope: AI_COST_GATEWAY_SCOPES.ORGANIZATION_CREDIT_ACCOUNT,
      providerFamily: "ai_worker",
      modelResolverKey: "member.text.fast",
      creditCost: 1,
      quantity: 1,
      idempotencyPolicy: "required",
      reservationPolicy: "required",
      replayPolicy: "metadata_only",
      failurePolicy: ["release_reservation", "no_charge", "terminal_billing_failure"],
      storagePolicy: "none",
      observabilityEventPrefix: "org.text.generate",
      routeId: "ai.generate-text",
      routePath: "/api/ai/generate-text",
      notes: "Org-scoped text generation uses AI_LAB and bounded text replay metadata.",
    },
    sourceFiles: ["workers/auth/src/routes/ai/text-generate.js", "workers/ai/src/routes/text.js", "workers/ai/src/lib/invoke-ai.js"],
    currentStatus: "implemented",
    currentEnforcement: {
      idempotency: "implemented",
      reservation: "implemented",
      replay: "implemented",
      creditCheck: "implemented",
      providerSuppression: "implemented",
    },
    routePolicy: {
      id: "ai.generate-text",
      path: "/api/ai/generate-text",
      expectedIdempotency: "required",
    },
    currentGaps: [],
    gapSeverity: "P3",
    nextMigrationPhase: "Gateway adapter after member route migrations",
  }),
  operation({
    operationConfig: {
      operationId: "member.music.generate",
      featureKey: "ai.music.generate",
      actorType: "member",
      billingScope: AI_COST_GATEWAY_SCOPES.MEMBER_CREDIT_ACCOUNT,
      providerFamily: "ai_worker",
      modelResolverKey: "member.music.model_catalog",
      creditCost: 0,
      costPolicy: "minimax_music_2_6_catalog",
      quantity: 1,
      idempotencyPolicy: "required",
      reservationPolicy: "required",
      replayPolicy: "durable_result",
      failurePolicy: ["release_reservation", "no_charge", "terminal_billing_failure"],
      storagePolicy: "user_images",
      observabilityEventPrefix: "member.music.generate",
      routeId: "ai.generate-music",
      routePath: "/api/ai/generate-music",
      notes: "Phase 3.6 gateway-migrated parent operation for bundled MiniMax Music 2.6 member generation. Phase 3.7 records safe replay-unavailable, cover status, finalization, and cleanup metadata on the parent member_ai_usage_attempts row.",
    },
    subOperationIds: Object.freeze([
      "member.music.lyrics.generate",
      "member.music.audio.generate",
      "member.music.cover.generate",
    ]),
    billingRelationship: "parent_bundle",
    currentChargeModel: "fixed_member_credit_schedule_after_success",
    sourceFiles: ["workers/auth/src/routes/ai/music-generate.js", "workers/ai/src/routes/music.js", "workers/ai/src/lib/invoke-ai.js"],
    currentStatus: "implemented",
    currentEnforcement: {
      idempotency: "implemented",
      reservation: "implemented",
      replay: "implemented",
      creditCheck: "implemented",
      providerSuppression: "implemented",
    },
    routePolicy: {
      id: "ai.generate-music",
      path: "/api/ai/generate-music",
      expectedIdempotency: "required",
    },
    currentGaps: [
      "Full raw generated lyrics replay is intentionally not stored in member attempt metadata; replay returns safe audio/asset metadata without raw prompt or lyrics.",
    ],
    gapSeverity: "P3",
    nextMigrationPhase: "Phase 4.1 admin/platform budget policy design",
  }),
  operation({
    operationConfig: {
      operationId: "member.music.lyrics.generate",
      featureKey: "ai.music.generate",
      actorType: "member",
      billingScope: AI_COST_GATEWAY_SCOPES.MEMBER_CREDIT_ACCOUNT,
      providerFamily: "ai_worker",
      modelResolverKey: "member.music.lyrics_text",
      creditCost: 0,
      costPolicy: "bundled_into_member_music_generation",
      quantity: 1,
      idempotencyPolicy: "required",
      reservationPolicy: "required",
      replayPolicy: "metadata_only",
      failurePolicy: ["release_reservation", "no_charge", "terminal_billing_failure"],
      storagePolicy: "none",
      observabilityEventPrefix: "member.music.lyrics.generate",
      routeId: "ai.generate-music",
      routePath: "/api/ai/generate-music",
      notes: "Optional separate lyrics text sub-operation inside member music generation. Target policy keeps it under the parent music reservation/debit.",
    },
    parentOperationId: "member.music.generate",
    billingRelationship: "included_in_parent_music_charge",
    currentChargeModel: "included_when separateLyricsGeneration adds the fixed 10-credit surcharge",
    sourceFiles: ["workers/auth/src/routes/ai/music-generate.js", "workers/ai/src/routes/text.js", "workers/ai/src/lib/invoke-ai.js"],
    currentStatus: "implemented",
    currentEnforcement: {
      idempotency: "implemented",
      reservation: "implemented",
      replay: "partial",
      creditCheck: "implemented",
      providerSuppression: "implemented",
    },
    routePolicy: null,
    currentGaps: [
      "Generated lyrics are intentionally omitted from replay metadata and replay response; users can request a new generation with a new key when exact lyrics text must be regenerated.",
    ],
    gapSeverity: "P3",
    nextMigrationPhase: "Phase 4.1 admin/platform budget policy design",
  }),
  operation({
    operationConfig: {
      operationId: "member.music.audio.generate",
      featureKey: "ai.music.generate",
      actorType: "member",
      billingScope: AI_COST_GATEWAY_SCOPES.MEMBER_CREDIT_ACCOUNT,
      providerFamily: "ai_worker",
      modelResolverKey: "member.music.audio_model",
      creditCost: 0,
      costPolicy: "included_in_member_music_parent_charge",
      quantity: 1,
      idempotencyPolicy: "required",
      reservationPolicy: "required",
      replayPolicy: "durable_result",
      failurePolicy: ["release_reservation", "no_charge", "terminal_billing_failure"],
      storagePolicy: "user_images",
      observabilityEventPrefix: "member.music.audio.generate",
      routeId: "ai.generate-music",
      routePath: "/api/ai/generate-music",
      notes: "Required MiniMax audio sub-operation inside member music generation. Target policy stores safe replay/output metadata under the parent attempt and finalizes one parent debit.",
    },
    parentOperationId: "member.music.generate",
    billingRelationship: "included_in_parent_music_charge",
    currentChargeModel: "included_in_fixed_member_music_charge",
    sourceFiles: ["workers/auth/src/routes/ai/music-generate.js", "workers/ai/src/routes/music.js", "workers/ai/src/lib/invoke-ai.js"],
    currentStatus: "implemented",
    currentEnforcement: {
      idempotency: "implemented",
      reservation: "implemented",
      replay: "implemented",
      creditCheck: "implemented",
      providerSuppression: "implemented",
    },
    routePolicy: null,
    currentGaps: [
      "Binary audio replay is represented by the persisted member asset rather than raw audio in member attempt metadata.",
    ],
    gapSeverity: "P3",
    nextMigrationPhase: "Phase 4.1 admin/platform budget policy design",
  }),
  operation({
    operationConfig: {
      operationId: "member.music.cover.generate",
      featureKey: "ai.music.generate",
      actorType: "member",
      billingScope: AI_COST_GATEWAY_SCOPES.MEMBER_CREDIT_ACCOUNT,
      providerFamily: "workers_ai",
      modelResolverKey: "member.music.cover_image",
      creditCost: 0,
      costPolicy: "included_in_member_music_parent_charge",
      quantity: 1,
      idempotencyPolicy: "required",
      reservationPolicy: "required",
      replayPolicy: "durable_result",
      failurePolicy: ["release_reservation", "no_charge", "manual_review"],
      storagePolicy: "user_images",
      observabilityEventPrefix: "member.music.cover.generate",
      routeId: "ai.generate-music",
      routePath: "/api/ai/generate-music",
      notes: "Automatic background cover generation after successful member music generation. Phase 3.7 writes pending/succeeded/failed/skipped status back to the parent attempt while keeping the provider call inside the parent bundled music reservation with no separate user-visible charge.",
    },
    parentOperationId: "member.music.generate",
    billingRelationship: "included_in_parent_music_charge",
    currentChargeModel: "not_billed_separately",
    sourceFiles: ["workers/auth/src/lib/member-music-cover.js"],
    currentStatus: "implemented",
    currentEnforcement: {
      idempotency: "implemented",
      reservation: "implemented",
      replay: "partial",
      creditCheck: "not_applicable",
      providerSuppression: "partial",
    },
    routePolicy: null,
    currentGaps: [
      "Cover retry/replay semantics are still partially constrained by existing poster state rather than a dedicated cover attempt.",
    ],
    gapSeverity: "P3",
    nextMigrationPhase: "Phase 4.1 admin/platform budget policy design",
  }),
  operation({
    operationConfig: {
      operationId: "member.video.generate",
      featureKey: "ai.video.generate",
      actorType: "member",
      billingScope: AI_COST_GATEWAY_SCOPES.MEMBER_CREDIT_ACCOUNT,
      providerFamily: "workers_ai",
      modelResolverKey: "member.video.model_catalog",
      creditCost: 0,
      costPolicy: "member_video_model_catalog",
      quantity: 1,
      idempotencyPolicy: "required",
      reservationPolicy: "required",
      replayPolicy: "durable_result",
      failurePolicy: ["release_reservation", "no_charge", "terminal_billing_failure"],
      storagePolicy: "user_images",
      observabilityEventPrefix: "member.video.generate",
      routeId: "ai.generate-video",
      routePath: "/api/ai/generate-video",
      notes: "Phase 3.8 member video gateway migration for PixVerse/HappyHorse generation. The route requires Idempotency-Key, reserves member credits in member_ai_usage_attempts before provider execution, suppresses same-key duplicate provider calls, and finalizes exactly once after durable video asset persistence.",
    },
    sourceFiles: ["workers/auth/src/routes/ai/video-generate.js"],
    currentStatus: "implemented",
    currentEnforcement: {
      idempotency: "implemented",
      reservation: "implemented",
      replay: "implemented",
      creditCheck: "implemented",
      providerSuppression: "implemented",
    },
    routePolicy: {
      id: "ai.generate-video",
      path: "/api/ai/generate-video",
      expectedIdempotency: "required",
    },
    currentGaps: [
      "Admin async video jobs, admin debug video, and internal video-task routes remain separate unmigrated platform/admin budget flows.",
      "Replay returns durable saved-asset metadata and does not re-run providers; deleted/private asset objects return replay-unavailable and require a new idempotency key.",
    ],
    gapSeverity: "P3",
    nextMigrationPhase: "Phase 4.1 admin/platform budget policy design",
  }),
  operation({
    operationConfig: {
      operationId: "admin.text.test",
      featureKey: "admin.ai.test_text",
      actorType: "admin",
      billingScope: AI_COST_GATEWAY_SCOPES.UNMETERED_ADMIN,
      providerFamily: "ai_worker",
      modelResolverKey: "admin.text.model_registry",
      creditCost: 0,
      costPolicy: "admin_text_platform_budget_metadata",
      quantity: 1,
      idempotencyPolicy: "required",
      reservationPolicy: "platform_budget_only",
      replayPolicy: "metadata_only",
      failurePolicy: "manual_review",
      storagePolicy: "none",
      observabilityEventPrefix: "admin.text.test",
      routeId: "admin.ai.test-text",
      routePath: "/api/admin/ai/test-text",
      notes: "Phase 4.8.1 admin-only provider-cost text test. Requires Idempotency-Key, creates an admin_ai_usage_attempts row before provider execution, suppresses duplicate same-key provider calls once pending/completed/failed state exists, and stores metadata-only replay state without raw prompt or generated text. Phase 4.8.2 adds bounded cleanup/inspection for stuck, failed, and completed rows.",
    },
    sourceFiles: ["workers/auth/src/routes/admin-ai.js", "workers/auth/src/lib/admin-ai-proxy.js", "workers/ai/src/routes/text.js", "workers/ai/src/lib/invoke-ai.js"],
    currentStatus: "partial",
    currentEnforcement: {
      idempotency: "implemented",
      reservation: "partial",
      replay: "partial",
      creditCheck: "not_applicable",
      providerSuppression: "implemented",
    },
    routePolicy: {
      id: "admin.ai.test-text",
      path: "/api/admin/ai/test-text",
      expectedIdempotency: "required",
    },
    currentGaps: [
      "Full result replay is intentionally unavailable; duplicate completed requests return metadata-only replay without generated text.",
      "Runtime env kill-switch enforcement and live platform budget caps remain future work.",
    ],
    gapSeverity: "P2",
    nextMigrationPhase: "Phase 4.10 remaining admin provider-cost budget migrations",
  }),
  operation({
    operationConfig: {
      operationId: "admin.image.test.charged",
      featureKey: "admin.ai.test_image",
      actorType: "admin",
      billingScope: AI_COST_GATEWAY_SCOPES.ORGANIZATION_CREDIT_ACCOUNT,
      providerFamily: "ai_worker",
      modelResolverKey: "admin.image.priced_model_catalog",
      creditCost: 1,
      costPolicy: "admin_image_model_catalog",
      quantity: 1,
      idempotencyPolicy: "required",
      reservationPolicy: "required",
      replayPolicy: "metadata_only",
      failurePolicy: ["release_reservation", "no_charge", "terminal_billing_failure"],
      storagePolicy: "user_images",
      observabilityEventPrefix: "admin.image.test.charged",
      routeId: "admin.ai.test-image",
      routePath: "/api/admin/ai/test-image",
      notes: "Priced Admin AI image test path charges selected organization credits. Phase 4.3 adds admin_org_credit_account budget-policy plan/audit metadata for the charged branch without changing unpriced admin image behavior.",
    },
    sourceFiles: ["workers/auth/src/routes/admin-ai.js", "workers/ai/src/routes/image.js", "workers/ai/src/lib/invoke-ai.js"],
    currentStatus: "implemented",
    currentEnforcement: {
      idempotency: "implemented",
      reservation: "implemented",
      replay: "partial",
      creditCheck: "implemented",
      providerSuppression: "implemented",
    },
    routePolicy: {
      id: "admin.ai.test-image",
      path: "/api/admin/ai/test-image",
      expectedIdempotency: "required",
    },
    currentGaps: ["Completed same-key result replay returns billing metadata and budget-policy metadata but not the generated image result."],
    gapSeverity: "P3",
    nextMigrationPhase: "Phase 4.5 admin async video job budget enforcement",
  }),
  operation({
    operationConfig: {
      operationId: "admin.image.test.unmetered",
      featureKey: "admin.ai.test_image",
      actorType: "admin",
      billingScope: AI_COST_GATEWAY_SCOPES.UNMETERED_ADMIN,
      providerFamily: "ai_worker",
      modelResolverKey: "admin.image.unpriced_model_registry",
      creditCost: 0,
      costPolicy: "admin_unmetered_platform_budget_pending",
      quantity: 1,
      idempotencyPolicy: "optional",
      reservationPolicy: "not_supported",
      replayPolicy: "metadata_only",
      failurePolicy: "manual_review",
      storagePolicy: "user_images",
      observabilityEventPrefix: "admin.image.test.unmetered",
      routeId: "admin.ai.test-image",
      routePath: "/api/admin/ai/test-image",
      notes: "Unpriced Admin AI image test branch remains admin-unmetered.",
    },
    sourceFiles: ["workers/auth/src/routes/admin-ai.js", "workers/ai/src/routes/image.js", "workers/ai/src/lib/invoke-ai.js"],
    currentStatus: "partial",
    currentEnforcement: {
      idempotency: "partial",
      reservation: "missing",
      replay: "missing",
      creditCheck: "not_applicable",
      providerSuppression: "missing",
    },
    routePolicy: null,
    currentGaps: ["Unpriced admin models need explicit platform/admin budget telemetry before broad use."],
    gapSeverity: "P2",
    nextMigrationPhase: "Phase 4.2 admin AI budget policy contract/helpers",
  }),
  operation({
    operationConfig: {
      operationId: "admin.embeddings.test",
      featureKey: "admin.ai.test_embeddings",
      actorType: "admin",
      billingScope: AI_COST_GATEWAY_SCOPES.UNMETERED_ADMIN,
      providerFamily: "ai_worker",
      modelResolverKey: "admin.embeddings.model_registry",
      creditCost: 0,
      costPolicy: "admin_embeddings_platform_budget_metadata",
      quantity: 1,
      idempotencyPolicy: "required",
      reservationPolicy: "platform_budget_only",
      replayPolicy: "metadata_only",
      failurePolicy: "manual_review",
      storagePolicy: "none",
      observabilityEventPrefix: "admin.embeddings.test",
      routeId: "admin.ai.test-embeddings",
      routePath: "/api/admin/ai/test-embeddings",
      notes: "Phase 4.8.1 admin-only provider-cost embeddings test. Requires Idempotency-Key, creates an admin_ai_usage_attempts row before provider execution, suppresses duplicate same-key provider calls once pending/completed/failed state exists, and stores metadata-only replay state without raw embedding input or vectors. Phase 4.8.2 adds bounded cleanup/inspection for stuck, failed, and completed rows.",
    },
    sourceFiles: ["workers/auth/src/routes/admin-ai.js", "workers/ai/src/routes/embeddings.js", "workers/ai/src/lib/invoke-ai.js"],
    currentStatus: "partial",
    currentEnforcement: {
      idempotency: "implemented",
      reservation: "partial",
      replay: "partial",
      creditCheck: "not_applicable",
      providerSuppression: "implemented",
    },
    routePolicy: {
      id: "admin.ai.test-embeddings",
      path: "/api/admin/ai/test-embeddings",
      expectedIdempotency: "required",
    },
    currentGaps: [
      "Full result replay is intentionally unavailable; duplicate completed requests return metadata-only replay without embedding vectors.",
      "Runtime env kill-switch enforcement and live platform budget caps remain future work.",
    ],
    gapSeverity: "P3",
    nextMigrationPhase: "Phase 4.10 remaining admin provider-cost budget migrations",
  }),
  operation({
    operationConfig: {
      operationId: "admin.music.test",
      featureKey: "admin.ai.test_music",
      actorType: "admin",
      billingScope: AI_COST_GATEWAY_SCOPES.UNMETERED_ADMIN,
      providerFamily: "ai_worker",
      modelResolverKey: "admin.music.model_registry",
      creditCost: 160,
      costPolicy: "admin_music_platform_budget_metadata",
      quantity: 1,
      idempotencyPolicy: "required",
      reservationPolicy: "platform_budget_only",
      replayPolicy: "metadata_only",
      failurePolicy: "manual_review",
      storagePolicy: "none",
      observabilityEventPrefix: "admin.music.test",
      routeId: "admin.ai.test-music",
      routePath: "/api/admin/ai/test-music",
      notes: "Phase 4.9 admin-only MiniMax music test. Requires Idempotency-Key, creates an admin_ai_usage_attempts row before provider execution, suppresses duplicate same-key provider calls once pending/completed/failed state exists, and stores metadata-only replay state without raw prompts, lyrics, or audio.",
    },
    sourceFiles: ["workers/auth/src/routes/admin-ai.js", "workers/ai/src/routes/music.js", "workers/ai/src/lib/invoke-ai.js"],
    currentStatus: "partial",
    currentEnforcement: {
      idempotency: "implemented",
      reservation: "partial",
      replay: "partial",
      creditCheck: "not_applicable",
      providerSuppression: "implemented",
    },
    routePolicy: {
      id: "admin.ai.test-music",
      path: "/api/admin/ai/test-music",
      expectedIdempotency: "required",
    },
    currentGaps: [
      "Full result replay is intentionally unavailable; duplicate completed requests return metadata-only replay without audio, lyrics, or provider response bodies.",
      "Runtime env kill-switch enforcement and live platform budget caps remain future work.",
    ],
    gapSeverity: "P3",
    nextMigrationPhase: "Phase 4.10 remaining admin provider-cost budget migrations",
  }),
  operation({
    operationConfig: {
      operationId: "admin.video.sync_debug",
      featureKey: "admin.ai.test_video",
      actorType: "admin",
      billingScope: AI_COST_GATEWAY_SCOPES.UNMETERED_ADMIN,
      providerFamily: "ai_worker",
      modelResolverKey: "admin.video.model_registry",
      creditCost: 0,
      costPolicy: "admin_debug_unmetered_disabled_by_default",
      quantity: 1,
      idempotencyPolicy: "optional",
      reservationPolicy: "not_supported",
      replayPolicy: "disabled",
      failurePolicy: "manual_review",
      storagePolicy: "none",
      observabilityEventPrefix: "admin.video.sync_debug",
      routeId: "admin.ai.test-video-debug",
      routePath: "/api/admin/ai/test-video",
      notes: "Synchronous admin debug video route is default-disabled by ALLOW_SYNC_VIDEO_DEBUG.",
    },
    sourceFiles: ["workers/auth/src/routes/admin-ai.js", "workers/ai/src/routes/video.js", "workers/ai/src/lib/invoke-ai.js", "workers/ai/src/lib/invoke-ai-video.js"],
    currentStatus: "partial",
    currentEnforcement: {
      idempotency: "missing",
      reservation: "missing",
      replay: "missing",
      creditCheck: "not_applicable",
      providerSuppression: "missing",
    },
    routePolicy: {
      id: "admin.ai.test-video-debug",
      path: "/api/admin/ai/test-video",
      expectedIdempotency: "explicit-admin-unmetered",
    },
    currentGaps: ["Debug route has no gateway budget telemetry if explicitly enabled."],
    gapSeverity: "P2",
    nextMigrationPhase: "Keep disabled; revisit only if retained",
  }),
  operation({
    operationConfig: {
      operationId: "admin.video.job.create",
      featureKey: "admin.ai.video_job",
      actorType: "admin",
      billingScope: AI_COST_GATEWAY_SCOPES.UNMETERED_ADMIN,
      providerFamily: "ai_worker",
      modelResolverKey: "admin.video.model_registry",
      creditCost: 0,
      costPolicy: "admin_async_video_platform_budget_metadata",
      quantity: 1,
      idempotencyPolicy: "required",
      reservationPolicy: "platform_budget_only",
      replayPolicy: "metadata_only",
      failurePolicy: "manual_review",
      storagePolicy: "user_images",
      observabilityEventPrefix: "admin.video.job.create",
      routeId: "admin.ai.video-jobs.create",
      routePath: "/api/admin/ai/video-jobs",
      notes: "Admin async video job creation requires Idempotency-Key, writes sanitized platform_admin_lab_budget metadata, and queues provider task work only after a valid budget plan is built.",
    },
    sourceFiles: ["workers/auth/src/routes/admin-ai.js", "workers/auth/src/lib/ai-video-jobs.js"],
    currentStatus: "implemented",
    currentEnforcement: {
      idempotency: "implemented",
      reservation: "implemented",
      replay: "implemented",
      creditCheck: "not_applicable",
      providerSuppression: "implemented",
    },
    routePolicy: {
      id: "admin.ai.video-jobs.create",
      path: "/api/admin/ai/video-jobs",
      expectedIdempotency: "required",
    },
    currentGaps: ["Runtime env kill-switch enforcement and live platform budget caps remain future work; Phase 4.5 metadata is local/job scoped."],
    gapSeverity: "P3",
    nextMigrationPhase: "Phase 4.6 OpenClaw/News Pulse visual budget controls",
  }),
  operation({
    operationConfig: {
      operationId: "admin.video.task.create",
      featureKey: "admin.ai.video_job",
      actorType: "admin",
      billingScope: AI_COST_GATEWAY_SCOPES.UNMETERED_ADMIN,
      providerFamily: "ai_worker",
      modelResolverKey: "admin.video.model_registry",
      creditCost: 0,
      costPolicy: "admin_async_video_task_caller_budget_enforced",
      quantity: 1,
      idempotencyPolicy: "inherited",
      reservationPolicy: "platform_budget_only",
      replayPolicy: "metadata_only",
      failurePolicy: "manual_review",
      storagePolicy: "external_only",
      observabilityEventPrefix: "admin.video.task.create",
      routeId: "internal.ai.video-task.create",
      routePath: "/internal/ai/video-task/create",
      notes: "Provider task creation is invoked by the auth worker queue consumer only after admin video job budget metadata is verified; Phase 4.7 propagates signed caller-policy metadata to the AI Worker.",
    },
    sourceFiles: ["workers/auth/src/lib/ai-video-jobs.js", "workers/ai/src/routes/video-task.js", "workers/ai/src/lib/invoke-ai-video.js"],
    currentStatus: "implemented",
    currentEnforcement: {
      idempotency: "delegated",
      reservation: "implemented",
      replay: "implemented",
      creditCheck: "not_applicable",
      providerSuppression: "implemented",
    },
    routePolicy: null,
    currentGaps: ["Live platform budget caps remain caller/job scoped; Phase 4.7 requires AI Worker caller-policy metadata for this internal route."],
    gapSeverity: "P3",
    nextMigrationPhase: "Keep caller-bound; add live caps only with a later route-specific migration",
  }),
  operation({
    operationConfig: {
      operationId: "admin.video.task.poll",
      featureKey: "admin.ai.video_job",
      actorType: "admin",
      billingScope: AI_COST_GATEWAY_SCOPES.UNMETERED_ADMIN,
      providerFamily: "ai_worker",
      modelResolverKey: "admin.video.model_registry",
      creditCost: 0,
      costPolicy: "admin_async_video_poll_caller_budget_enforced",
      quantity: 1,
      idempotencyPolicy: "inherited",
      reservationPolicy: "platform_budget_only",
      replayPolicy: "metadata_only",
      failurePolicy: "manual_review",
      storagePolicy: "external_only",
      observabilityEventPrefix: "admin.video.task.poll",
      routeId: "internal.ai.video-task.poll",
      routePath: "/internal/ai/video-task/poll",
      notes: "Provider task polling uses an existing providerTaskId and verified admin video job budget metadata; Phase 4.7 propagates signed caller-policy metadata to the AI Worker.",
    },
    sourceFiles: ["workers/auth/src/lib/ai-video-jobs.js", "workers/ai/src/routes/video-task.js", "workers/ai/src/lib/invoke-ai-video.js"],
    currentStatus: "implemented",
    currentEnforcement: {
      idempotency: "delegated",
      reservation: "implemented",
      replay: "implemented",
      creditCheck: "not_applicable",
      providerSuppression: "not_applicable",
    },
    routePolicy: null,
    currentGaps: ["Live platform budget caps remain caller/job scoped; Phase 4.7 requires AI Worker caller-policy metadata for this internal route."],
    gapSeverity: "P3",
    nextMigrationPhase: "Keep caller-bound; add live caps only with a later route-specific migration",
  }),
  operation({
    operationConfig: {
      operationId: "admin.compare",
      featureKey: "admin.ai.compare",
      actorType: "admin",
      billingScope: AI_COST_GATEWAY_SCOPES.UNMETERED_ADMIN,
      providerFamily: "ai_worker",
      modelResolverKey: "admin.compare.model_registry",
      creditCost: 0,
      costPolicy: "admin_unmetered_multi_model_platform_budget_pending",
      quantity: 1,
      idempotencyPolicy: "optional",
      reservationPolicy: "not_supported",
      replayPolicy: "disabled",
      failurePolicy: "manual_review",
      storagePolicy: "none",
      observabilityEventPrefix: "admin.compare",
      routeId: "admin.ai.compare",
      routePath: "/api/admin/ai/compare",
      notes: "Admin compare can trigger multiple text provider calls.",
    },
    sourceFiles: ["workers/auth/src/routes/admin-ai.js", "workers/ai/src/routes/compare.js", "workers/ai/src/lib/invoke-ai.js"],
    currentStatus: "missing",
    currentEnforcement: {
      idempotency: "missing",
      reservation: "missing",
      replay: "missing",
      creditCheck: "not_applicable",
      providerSuppression: "missing",
    },
    routePolicy: {
      id: "admin.ai.compare",
      path: "/api/admin/ai/compare",
      expectedIdempotency: "explicit-admin-unmetered",
    },
    currentGaps: ["No explicit admin budget telemetry for multi-model provider spend."],
    gapSeverity: "P2",
    nextMigrationPhase: "Phase 4.2 admin AI budget policy contract/helpers",
  }),
  operation({
    operationConfig: {
      operationId: "admin.live_agent",
      featureKey: "admin.ai.live_agent",
      actorType: "admin",
      billingScope: AI_COST_GATEWAY_SCOPES.UNMETERED_ADMIN,
      providerFamily: "ai_worker",
      modelResolverKey: "admin.live_agent.model",
      creditCost: 0,
      costPolicy: "admin_unmetered_stream_platform_budget_pending",
      quantity: 1,
      idempotencyPolicy: "optional",
      reservationPolicy: "not_supported",
      replayPolicy: "disabled",
      failurePolicy: "manual_review",
      storagePolicy: "none",
      observabilityEventPrefix: "admin.live_agent",
      routeId: "admin.ai.live-agent",
      routePath: "/api/admin/ai/live-agent",
      notes: "Admin streaming live-agent route can consume provider tokens until stream ends.",
    },
    sourceFiles: ["workers/auth/src/routes/admin-ai.js", "workers/ai/src/routes/live-agent.js"],
    currentStatus: "missing",
    currentEnforcement: {
      idempotency: "missing",
      reservation: "missing",
      replay: "missing",
      creditCheck: "not_applicable",
      providerSuppression: "missing",
    },
    routePolicy: {
      id: "admin.ai.live-agent",
      path: "/api/admin/ai/live-agent",
      expectedIdempotency: "explicit-admin-unmetered",
    },
    currentGaps: ["No explicit admin budget telemetry for streaming provider spend."],
    gapSeverity: "P2",
    nextMigrationPhase: "Phase 4.2 admin AI budget policy contract/helpers",
  }),
  operation({
    operationConfig: {
      operationId: "internal.text.generate",
      featureKey: "internal.ai.text",
      actorType: "platform",
      billingScope: AI_COST_GATEWAY_SCOPES.EXTERNAL,
      providerFamily: "workers_ai",
      modelResolverKey: "internal.text.caller_selected",
      creditCost: 0,
      costPolicy: "delegated_to_caller",
      quantity: 1,
      idempotencyPolicy: "inherited",
      reservationPolicy: "not_supported",
      replayPolicy: "disabled",
      failurePolicy: "manual_review",
      storagePolicy: "none",
      observabilityEventPrefix: "internal.text.generate",
      routeId: "internal.ai.test-text",
      routePath: "/internal/ai/test-text",
      notes: "Internal AI Worker route relies on auth-worker caller cost policy.",
    },
    sourceFiles: ["workers/ai/src/routes/text.js", "workers/ai/src/lib/invoke-ai.js"],
    currentStatus: "partial",
    currentEnforcement: {
      idempotency: "delegated",
      reservation: "delegated",
      replay: "delegated",
      creditCheck: "delegated",
      providerSuppression: "delegated",
    },
    routePolicy: null,
    currentGaps: ["Internal route must stay service-only and rely on caller-side gateway enforcement."],
    gapSeverity: "P2",
    nextMigrationPhase: "Wrap callers; do not expose internal route",
  }),
  operation({
    operationConfig: {
      operationId: "internal.image.generate",
      featureKey: "internal.ai.image",
      actorType: "platform",
      billingScope: AI_COST_GATEWAY_SCOPES.EXTERNAL,
      providerFamily: "workers_ai",
      modelResolverKey: "internal.image.caller_selected",
      creditCost: 0,
      costPolicy: "delegated_to_caller",
      quantity: 1,
      idempotencyPolicy: "inherited",
      reservationPolicy: "not_supported",
      replayPolicy: "disabled",
      failurePolicy: "manual_review",
      storagePolicy: "none",
      observabilityEventPrefix: "internal.image.generate",
      routeId: "internal.ai.test-image",
      routePath: "/internal/ai/test-image",
      notes: "Internal AI Worker image route relies on caller-side cost policy.",
    },
    sourceFiles: ["workers/ai/src/routes/image.js", "workers/ai/src/lib/invoke-ai.js"],
    currentStatus: "partial",
    currentEnforcement: {
      idempotency: "delegated",
      reservation: "delegated",
      replay: "delegated",
      creditCheck: "delegated",
      providerSuppression: "delegated",
    },
    routePolicy: null,
    currentGaps: ["Internal route must stay service-only and rely on caller-side gateway enforcement."],
    gapSeverity: "P2",
    nextMigrationPhase: "Wrap callers; do not expose internal route",
  }),
  operation({
    operationConfig: {
      operationId: "internal.embeddings.generate",
      featureKey: "internal.ai.embeddings",
      actorType: "platform",
      billingScope: AI_COST_GATEWAY_SCOPES.EXTERNAL,
      providerFamily: "workers_ai",
      modelResolverKey: "internal.embeddings.caller_selected",
      creditCost: 0,
      costPolicy: "delegated_to_caller",
      quantity: 1,
      idempotencyPolicy: "inherited",
      reservationPolicy: "not_supported",
      replayPolicy: "disabled",
      failurePolicy: "manual_review",
      storagePolicy: "none",
      observabilityEventPrefix: "internal.embeddings.generate",
      routeId: "internal.ai.test-embeddings",
      routePath: "/internal/ai/test-embeddings",
      notes: "Internal embeddings route is admin-only through service binding today.",
    },
    sourceFiles: ["workers/ai/src/routes/embeddings.js", "workers/ai/src/lib/invoke-ai.js"],
    currentStatus: "partial",
    currentEnforcement: {
      idempotency: "delegated",
      reservation: "delegated",
      replay: "delegated",
      creditCheck: "delegated",
      providerSuppression: "delegated",
    },
    routePolicy: null,
    currentGaps: ["Internal route must stay service-only and rely on caller-side gateway enforcement if product-facing use appears."],
    gapSeverity: "P3",
    nextMigrationPhase: "Wrap callers; do not expose internal route",
  }),
  operation({
    operationConfig: {
      operationId: "internal.music.generate",
      featureKey: "internal.ai.music",
      actorType: "platform",
      billingScope: AI_COST_GATEWAY_SCOPES.EXTERNAL,
      providerFamily: "workers_ai",
      modelResolverKey: "internal.music.caller_selected",
      creditCost: 0,
      costPolicy: "delegated_to_caller",
      quantity: 1,
      idempotencyPolicy: "inherited",
      reservationPolicy: "not_supported",
      replayPolicy: "disabled",
      failurePolicy: "manual_review",
      storagePolicy: "none",
      observabilityEventPrefix: "internal.music.generate",
      routeId: "internal.ai.test-music",
      routePath: "/internal/ai/test-music",
      notes: "Internal MiniMax music route relies on caller-side policy. Phase 3.6 covers the member caller; Phase 4.9 covers the admin music test caller with signed budget metadata and durable caller-side idempotency, while other broad internal callers remain baseline-classified.",
    },
    sourceFiles: ["workers/ai/src/routes/music.js", "workers/ai/src/lib/invoke-ai.js"],
    currentStatus: "partial",
    currentEnforcement: {
      idempotency: "delegated",
      reservation: "delegated",
      replay: "delegated",
      creditCheck: "delegated",
      providerSuppression: "delegated",
    },
    routePolicy: null,
    currentGaps: ["The admin music test caller now supplies budget/caller metadata, but the shared internal route still allows baseline-missing caller policy for other known callers to avoid a broad internal route migration."],
    gapSeverity: "P2",
    nextMigrationPhase: "Admin/platform AI cost policy hardening",
  }),
  operation({
    operationConfig: {
      operationId: "internal.video.generate",
      featureKey: "internal.ai.video",
      actorType: "platform",
      billingScope: AI_COST_GATEWAY_SCOPES.EXTERNAL,
      providerFamily: "workers_ai",
      modelResolverKey: "internal.video.caller_selected",
      creditCost: 0,
      costPolicy: "delegated_to_caller",
      quantity: 1,
      idempotencyPolicy: "inherited",
      reservationPolicy: "not_supported",
      replayPolicy: "disabled",
      failurePolicy: "manual_review",
      storagePolicy: "none",
      observabilityEventPrefix: "internal.video.generate",
      routeId: "internal.ai.test-video",
      routePath: "/internal/ai/test-video",
      notes: "Internal sync video route relies on caller policy and debug gating.",
    },
    sourceFiles: ["workers/ai/src/routes/video.js", "workers/ai/src/lib/invoke-ai.js", "workers/ai/src/lib/invoke-ai-video.js"],
    currentStatus: "partial",
    currentEnforcement: {
      idempotency: "delegated",
      reservation: "delegated",
      replay: "delegated",
      creditCheck: "delegated",
      providerSuppression: "delegated",
    },
    routePolicy: null,
    currentGaps: ["Internal route must stay service-only and caller-gated."],
    gapSeverity: "P2",
    nextMigrationPhase: "Keep disabled; revisit only if retained",
  }),
  operation({
    operationConfig: {
      operationId: "internal.video_task.create",
      featureKey: "internal.ai.video_task",
      actorType: "platform",
      billingScope: AI_COST_GATEWAY_SCOPES.EXTERNAL,
      providerFamily: "external_video_provider",
      modelResolverKey: "internal.video_task.caller_selected",
      creditCost: 0,
      costPolicy: "delegated_to_caller",
      quantity: 1,
      idempotencyPolicy: "inherited",
      reservationPolicy: "not_supported",
      replayPolicy: "metadata_only",
      failurePolicy: "manual_review",
      storagePolicy: "external_only",
      observabilityEventPrefix: "internal.video_task.create",
      routeId: "internal.ai.video-task.create",
      routePath: "/internal/ai/video-task/create",
      notes: "Internal async video task creation can create provider-side work; Phase 4.7 requires signed caller-policy metadata before route execution.",
    },
    sourceFiles: ["workers/ai/src/index.js", "workers/ai/src/lib/caller-policy.js", "workers/ai/src/routes/video-task.js", "workers/ai/src/lib/invoke-ai-video.js"],
    currentStatus: "implemented",
    currentEnforcement: {
      idempotency: "implemented",
      reservation: "delegated",
      replay: "partial",
      creditCheck: "delegated",
      providerSuppression: "implemented",
    },
    routePolicy: null,
    currentGaps: ["Caller/job-row policy still owns budget reservation and live caps; the internal route now verifies policy presence and shape only."],
    gapSeverity: "P3",
    nextMigrationPhase: "Keep caller-bound; add live caps only with a later route-specific migration",
  }),
  operation({
    operationConfig: {
      operationId: "internal.video_task.poll",
      featureKey: "internal.ai.video_task",
      actorType: "platform",
      billingScope: AI_COST_GATEWAY_SCOPES.EXTERNAL,
      providerFamily: "external_video_provider",
      modelResolverKey: "internal.video_task.caller_selected",
      creditCost: 0,
      costPolicy: "delegated_to_caller",
      quantity: 1,
      idempotencyPolicy: "inherited",
      reservationPolicy: "not_supported",
      replayPolicy: "metadata_only",
      failurePolicy: "manual_review",
      storagePolicy: "external_only",
      observabilityEventPrefix: "internal.video_task.poll",
      routeId: "internal.ai.video-task.poll",
      routePath: "/internal/ai/video-task/poll",
      notes: "Internal async video task polling should not create new provider work but can call external provider status APIs; Phase 4.7 requires signed caller-policy metadata before route execution.",
    },
    sourceFiles: ["workers/ai/src/index.js", "workers/ai/src/lib/caller-policy.js", "workers/ai/src/routes/video-task.js", "workers/ai/src/lib/invoke-ai-video.js"],
    currentStatus: "implemented",
    currentEnforcement: {
      idempotency: "implemented",
      reservation: "not_applicable",
      replay: "implemented",
      creditCheck: "delegated",
      providerSuppression: "not_applicable",
    },
    routePolicy: null,
    currentGaps: ["Caller/job-row policy still owns bounded polling cadence and live caps; the internal route now verifies policy presence and shape only."],
    gapSeverity: "P3",
    nextMigrationPhase: "Keep caller-bound; add live caps only with a later route-specific migration",
  }),
  operation({
    operationConfig: {
      operationId: "internal.compare",
      featureKey: "internal.ai.compare",
      actorType: "platform",
      billingScope: AI_COST_GATEWAY_SCOPES.EXTERNAL,
      providerFamily: "workers_ai",
      modelResolverKey: "internal.compare.caller_selected",
      creditCost: 0,
      costPolicy: "delegated_to_caller",
      quantity: 1,
      idempotencyPolicy: "inherited",
      reservationPolicy: "not_supported",
      replayPolicy: "disabled",
      failurePolicy: "manual_review",
      storagePolicy: "none",
      observabilityEventPrefix: "internal.compare",
      routeId: "internal.ai.compare",
      routePath: "/internal/ai/compare",
      notes: "Internal compare can run multiple text calls and relies on admin caller policy.",
    },
    sourceFiles: ["workers/ai/src/routes/compare.js", "workers/ai/src/lib/invoke-ai.js"],
    currentStatus: "partial",
    currentEnforcement: {
      idempotency: "delegated",
      reservation: "delegated",
      replay: "delegated",
      creditCheck: "delegated",
      providerSuppression: "delegated",
    },
    routePolicy: null,
    currentGaps: ["Admin compare caller needs explicit platform budget telemetry."],
    gapSeverity: "P2",
    nextMigrationPhase: "Phase 4.2 admin AI budget policy contract/helpers",
  }),
  operation({
    operationConfig: {
      operationId: "internal.live_agent",
      featureKey: "internal.ai.live_agent",
      actorType: "platform",
      billingScope: AI_COST_GATEWAY_SCOPES.EXTERNAL,
      providerFamily: "workers_ai",
      modelResolverKey: "internal.live_agent.model",
      creditCost: 0,
      costPolicy: "delegated_to_caller",
      quantity: 1,
      idempotencyPolicy: "inherited",
      reservationPolicy: "not_supported",
      replayPolicy: "disabled",
      failurePolicy: "manual_review",
      storagePolicy: "none",
      observabilityEventPrefix: "internal.live_agent",
      routeId: "internal.ai.live-agent",
      routePath: "/internal/ai/live-agent",
      notes: "Internal streaming route relies on admin caller policy.",
    },
    sourceFiles: ["workers/ai/src/routes/live-agent.js"],
    currentStatus: "partial",
    currentEnforcement: {
      idempotency: "delegated",
      reservation: "delegated",
      replay: "delegated",
      creditCheck: "delegated",
      providerSuppression: "delegated",
    },
    routePolicy: null,
    currentGaps: ["Admin live-agent caller needs explicit platform budget telemetry."],
    gapSeverity: "P2",
    nextMigrationPhase: "Phase 4.2 admin AI budget policy contract/helpers",
  }),
  operation({
    operationConfig: {
      operationId: "platform.news_pulse.visual.ingest",
      featureKey: "platform.news_pulse.visual",
      actorType: "platform",
      billingScope: AI_COST_GATEWAY_SCOPES.PLATFORM_BUDGET,
      providerFamily: "workers_ai",
      modelResolverKey: "platform.news_pulse.visual_model",
      creditCost: 0,
      costPolicy: "openclaw_news_pulse_budget_metadata",
      quantity: 1,
      idempotencyPolicy: "inherited",
      reservationPolicy: "platform_budget_only",
      replayPolicy: "durable_result",
      failurePolicy: ["manual_review", "no_charge"],
      storagePolicy: "user_images",
      observabilityEventPrefix: "platform.news_pulse.visual.ingest",
      routeId: "openclaw.news_pulse.ingest",
      routePath: "/api/openclaw/news-pulse/ingest",
      notes: "OpenClaw ingest can schedule provider-cost News Pulse visual generation; Phase 4.6 records openclaw_news_pulse_budget metadata before provider execution.",
    },
    sourceFiles: ["workers/auth/src/routes/openclaw-news-pulse.js", "workers/auth/src/lib/news-pulse-visuals.js"],
    currentStatus: "implemented",
    currentEnforcement: {
      idempotency: "implemented",
      reservation: "implemented",
      replay: "implemented",
      creditCheck: "not_applicable",
      providerSuppression: "implemented",
    },
    routePolicy: {
      id: "openclaw.news_pulse.ingest",
      path: "/api/openclaw/news-pulse/ingest",
      expectedIdempotency: "platform-budget-or-deterministic-key",
    },
    currentGaps: ["Runtime env kill-switch enforcement and live daily/monthly platform caps remain future work."],
    gapSeverity: "P3",
    nextMigrationPhase: "Phase 4.7 internal AI Worker route caller-policy guard",
  }),
  operation({
    operationConfig: {
      operationId: "platform.news_pulse.visual.scheduled",
      featureKey: "platform.news_pulse.visual",
      actorType: "platform",
      billingScope: AI_COST_GATEWAY_SCOPES.PLATFORM_BUDGET,
      providerFamily: "workers_ai",
      modelResolverKey: "platform.news_pulse.visual_model",
      creditCost: 0,
      costPolicy: "openclaw_news_pulse_budget_metadata",
      quantity: 1,
      idempotencyPolicy: "inherited",
      reservationPolicy: "platform_budget_only",
      replayPolicy: "durable_result",
      failurePolicy: ["manual_review", "no_charge"],
      storagePolicy: "user_images",
      observabilityEventPrefix: "platform.news_pulse.visual.scheduled",
      routeId: "scheduled.news_pulse.visuals",
      routePath: "/scheduled/news-pulse-visuals",
      notes: "Scheduled News Pulse visual backfill can call the image provider for missing/failed thumbnails; Phase 4.6 records openclaw_news_pulse_budget metadata before provider execution.",
    },
    sourceFiles: ["workers/auth/src/index.js", "workers/auth/src/lib/news-pulse-visuals.js"],
    currentStatus: "implemented",
    currentEnforcement: {
      idempotency: "implemented",
      reservation: "implemented",
      replay: "implemented",
      creditCheck: "not_applicable",
      providerSuppression: "implemented",
    },
    routePolicy: null,
    currentGaps: ["Runtime env kill-switch enforcement and live daily/monthly platform caps remain future work."],
    gapSeverity: "P3",
    nextMigrationPhase: "Phase 4.7 internal AI Worker route caller-policy guard",
  }),
]);

export function validateAiCostOperationRegistry(entries = AI_COST_OPERATION_REGISTRY) {
  const issues = [];
  const seenOperationIds = new Set();
  const seenRoutePolicyIds = new Set();

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      issues.push("Registry entry must be an object.");
      continue;
    }
    let normalized = null;
    try {
      normalized = normalizeAiCostOperationConfig(entry.operationConfig);
    } catch (error) {
      issues.push(`${entry.operationConfig?.operationId || "unknown"}: ${error.message}`);
      continue;
    }

    if (seenOperationIds.has(normalized.operationId)) {
      issues.push(`Duplicate AI cost operation id "${normalized.operationId}".`);
    }
    seenOperationIds.add(normalized.operationId);

    if (!AI_COST_CURRENT_ENFORCEMENT_STATUSES.includes(entry.currentStatus)) {
      issues.push(`${normalized.operationId}: invalid currentStatus "${entry.currentStatus}".`);
    }
    if (!GAP_SEVERITIES.has(entry.gapSeverity)) {
      issues.push(`${normalized.operationId}: invalid gapSeverity "${entry.gapSeverity}".`);
    }
    if (!entry.nextMigrationPhase || typeof entry.nextMigrationPhase !== "string") {
      issues.push(`${normalized.operationId}: missing nextMigrationPhase.`);
    }
    if (!Array.isArray(entry.sourceFiles) || entry.sourceFiles.length === 0) {
      issues.push(`${normalized.operationId}: missing sourceFiles.`);
    }
    if (!Array.isArray(entry.currentGaps)) {
      issues.push(`${normalized.operationId}: currentGaps must be an array.`);
    }
    for (const [field, status] of Object.entries(entry.currentEnforcement || {})) {
      if (!ENFORCEMENT_DETAIL_STATUSES.has(status)) {
        issues.push(`${normalized.operationId}: invalid currentEnforcement.${field} "${status}".`);
      }
    }
    const entryBudgetPolicy = resolvedBudgetPolicy(entry);
    if (needsBudgetPolicy(normalized)) {
      if (!entryBudgetPolicy) {
        issues.push(`${normalized.operationId}: missing budgetPolicy metadata.`);
      } else {
        if (!BUDGET_SCOPE_VALUES.has(entryBudgetPolicy.targetBudgetScope)) {
          issues.push(`${normalized.operationId}: invalid budgetPolicy.targetBudgetScope "${entryBudgetPolicy.targetBudgetScope}".`);
        }
        if (!BUDGET_SCOPE_VALUES.has(entryBudgetPolicy.currentBudgetScope)) {
          issues.push(`${normalized.operationId}: invalid budgetPolicy.currentBudgetScope "${entryBudgetPolicy.currentBudgetScope}".`);
        }
        if (!entryBudgetPolicy.targetFuturePhase || typeof entryBudgetPolicy.targetFuturePhase !== "string") {
          issues.push(`${normalized.operationId}: missing budgetPolicy.targetFuturePhase.`);
        }
        if (!entryBudgetPolicy.targetEnforcementStatus || typeof entryBudgetPolicy.targetEnforcementStatus !== "string") {
          issues.push(`${normalized.operationId}: missing budgetPolicy.targetEnforcementStatus.`);
        }
        if (!entryBudgetPolicy.targetEnforcement || typeof entryBudgetPolicy.targetEnforcement !== "object") {
          issues.push(`${normalized.operationId}: missing budgetPolicy.targetEnforcement.`);
        }
        if (!entryBudgetPolicy.notes || typeof entryBudgetPolicy.notes !== "string") {
          issues.push(`${normalized.operationId}: missing budgetPolicy.notes.`);
        }
        if (typeof entryBudgetPolicy.temporaryBaselineAllowed !== "boolean") {
          issues.push(`${normalized.operationId}: budgetPolicy.temporaryBaselineAllowed must be boolean.`);
        }
      }
    }
    if (entry.routePolicy) {
      if (!entry.routePolicy.id || !entry.routePolicy.path || !entry.routePolicy.expectedIdempotency) {
        issues.push(`${normalized.operationId}: routePolicy must include id, path, and expectedIdempotency.`);
      }
      const key = `${entry.routePolicy.id}:${entry.routePolicy.expectedIdempotency}`;
      if (seenRoutePolicyIds.has(key)) {
        issues.push(`${normalized.operationId}: duplicate route policy comparison "${key}".`);
      }
      seenRoutePolicyIds.add(key);
    }
  }

  return issues;
}

export function getAiCostRoutePolicyBaselines(entries = AI_COST_OPERATION_REGISTRY) {
  return entries
    .filter((entry) => entry.routePolicy)
    .map((entry) => ({
      operationId: entry.operationConfig.operationId,
      id: entry.routePolicy.id,
      path: entry.routePolicy.path,
      expected: entry.routePolicy.expectedIdempotency,
      classification: `${entry.operationConfig.actorType}-${entry.operationConfig.billingScope}`,
      notes: entry.operationConfig.notes || null,
    }));
}

export function getAiCostOperationConfig(operationId, entries = AI_COST_OPERATION_REGISTRY) {
  const match = entries.find((entry) => entry.operationConfig?.operationId === operationId);
  return match ? normalizeAiCostOperationConfig(match.operationConfig) : null;
}

export function getAiCostOperationRegistryEntry(operationId, entries = AI_COST_OPERATION_REGISTRY) {
  return entries.find((entry) => entry.operationConfig?.operationId === operationId) || null;
}

export function getAiCostProviderCallSourceFiles(entries = AI_COST_OPERATION_REGISTRY) {
  return [...new Set(entries.flatMap((entry) => entry.sourceFiles || []))].sort();
}

function countWhere(entries, predicate) {
  return entries.reduce((count, entry) => count + (predicate(entry) ? 1 : 0), 0);
}

function needsBudgetPolicy(normalized) {
  return normalized.providerCost && (
    normalized.actorType === "admin" ||
    normalized.actorType === "platform" ||
    normalized.billingScope === AI_COST_GATEWAY_SCOPES.PLATFORM_BUDGET ||
    normalized.billingScope === AI_COST_GATEWAY_SCOPES.UNMETERED_ADMIN ||
    normalized.billingScope === AI_COST_GATEWAY_SCOPES.EXTERNAL
  );
}

export function summarizeAiCostOperationRegistry(entries = AI_COST_OPERATION_REGISTRY) {
  const normalizedEntries = entries.map((entry) => ({
    entry,
    config: normalizeAiCostOperationConfig(entry.operationConfig),
  }));
  const providerCostEntries = normalizedEntries.filter(({ config }) => config.providerCost);
  const highRiskOperations = normalizedEntries
    .filter(({ entry }) => entry.gapSeverity === "P1")
    .map(({ config }) => config.operationId)
    .sort();

  return Object.freeze({
    version: AI_COST_OPERATION_REGISTRY_VERSION,
    totalOperations: entries.length,
    providerCostOperations: providerCostEntries.length,
    memberOperations: countWhere(normalizedEntries, ({ config }) => config.actorType === "member"),
    organizationOperations: countWhere(normalizedEntries, ({ config }) => config.actorType === "organization"),
    adminPlatformOperations: countWhere(normalizedEntries, ({ config }) => config.actorType === "admin" || config.actorType === "platform"),
    currentMissingMandatoryIdempotency: countWhere(providerCostEntries, ({ entry, config }) =>
      config.idempotencyPolicy === "required"
      && entry.currentEnforcement?.idempotency !== "implemented"
    ),
    currentMissingReservation: countWhere(providerCostEntries, ({ entry, config }) =>
      config.reservationPolicy === "required"
      && entry.currentEnforcement?.reservation !== "implemented"
    ),
    currentNoReplay: countWhere(providerCostEntries, ({ entry, config }) =>
      config.replayPolicy !== "disabled"
      && !["implemented", "partial"].includes(entry.currentEnforcement?.replay)
    ),
    platformBudgetReviewOperations: countWhere(providerCostEntries, ({ config }) =>
      config.billingScope === AI_COST_GATEWAY_SCOPES.PLATFORM_BUDGET
    ),
    budgetScopeCounts: Object.freeze(Object.fromEntries(
      Object.values(AI_COST_BUDGET_SCOPES).map((scope) => [
        scope,
        countWhere(entries, (entry) => resolvedBudgetPolicy(entry)?.targetBudgetScope === scope),
      ])
    )),
    highRiskOperations,
  });
}
