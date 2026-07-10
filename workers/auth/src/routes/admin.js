import { json } from "../lib/response.js";
import {
  BODY_LIMITS,
  readJsonBodyOrResponse,
} from "../lib/request.js";
import { enqueueAdminAuditEvent } from "../lib/activity.js";
import { nowIso } from "../lib/tokens.js";
import { requireAdmin } from "../lib/session.js";
import {
  createDataLifecycleRequest,
  DataLifecycleError,
} from "../lib/data-lifecycle.js";
import {
  REGISTRATION_MAINTENANCE_MESSAGE,
  RegistrationAvailabilityError,
  getRegistrationAvailability,
  setRegistrationAvailability,
} from "../lib/registration-availability.js";
import {
  getActivityRetentionCutoff,
  getActivityRetentionMetadata,
} from "../lib/activity-archive.js";
import { buildOperatorTimeline } from "../lib/operator-event-timeline.js";
import {
  ACTIVITY_CURSOR_TTL_MS,
  ADMIN_AUDIT_LOG_TABLE,
  ADMIN_ACTIVITY_CURSOR_TYPE,
  ADMIN_USER_ACTIVITY_CURSOR_TYPE,
  USER_ACTIVITY_LOG_TABLE,
  buildActivitySearchFilterHash,
  buildActivitySearchRange,
  normalizeActivitySearchTerm,
  sanitizeActivityMetaJson,
} from "../lib/activity-search.js";
import {
  evaluateSharedRateLimit,
  isProductionEnvironment,
  getClientIp,
  rateLimitResponse,
  rateLimitUnavailableResponse,
  sensitiveRateLimitOptions,
} from "../lib/rate-limit.js";
import {
  buildAdminMfaDeniedResponse,
  logAdminMfaDiagnostic,
} from "../lib/admin-mfa.js";
import {
  LEGACY_MEDIA_RESET_CONFIRMED_EXECUTION_GATE,
  isLegacyMediaResetConfirmedExecutionEnabled,
} from "../lib/tenant-asset-legacy-media-reset-executor.js";
import {
  decodePaginationCursor,
  encodePaginationCursor,
  paginationErrorResponse,
  readCursorString,
  readCursorInteger,
  resolvePaginationLimit,
} from "../lib/pagination.js";
import { handleAdminAI } from "./admin-ai.js";
import { handleAdminFableChat } from "./admin-fable-chat.js";
import { handleAdminBilling } from "./admin-billing.js";
import { handleAdminDataLifecycle } from "./admin-data-lifecycle.js";
import { handleAdminMfa } from "./admin-mfa.js";
import { handleAdminNewsPulse } from "./admin-news-pulse.js";
import { handleAdminOrgs } from "./admin-orgs.js";
import { handleAdminR2Explorer } from "./admin-r2-explorer.js";
import { handleAdminStorage } from "./admin-storage.js";
import { handleAdminTenantAssets } from "./admin-tenant-assets.js";
import { handleAdminHomepageHeroVideos } from "./homepage-hero-videos.js";
import { AiAssetLifecycleError, deleteAllUserAiAssets } from "./ai/lifecycle.js";

const ADMIN_USERS_CURSOR_TYPE = "admin_users";
const DEFAULT_ADMIN_USERS_LIMIT = 50;
const MAX_ADMIN_USERS_LIMIT = 100;
const DEFAULT_ADMIN_ACTIVITY_LIMIT = 50;
const MAX_ADMIN_ACTIVITY_LIMIT = 100;
const ADMIN_USER_DELETED_STATUS = "deleted";
const ADMIN_USER_DELETED_PASSWORD_HASH = "deleted_account_disabled";
const ADMIN_DELETE_ERASURE_ACKNOWLEDGEMENT = "ERASURE WORKFLOW";
const ADMIN_DELETE_ERASURE_DEFAULT_REASON = "Admin initiated GDPR/data erasure workflow from Admin user deletion.";
// Runtime Workers cannot read config/release-compat.json directly; release
// compatibility tests keep this dashboard label aligned with the manifest.
const CURRENT_AUTH_SCHEMA_CHECKPOINT = "0070_add_fable_chat_advanced_inference.sql";
const READINESS_STATUS_VERSION = "omega-p1-readiness-dashboard-v4";

function adminSettingsIdempotencyKeyOrResponse(request) {
  const key = String(request.headers.get("Idempotency-Key") || "").trim();
  if (!key) {
    return {
      response: json(
        {
          ok: false,
          error: "Idempotency-Key is required for admin registration setting changes.",
          code: "idempotency_key_required",
        },
        { status: 428 }
      ),
    };
  }
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(key)) {
    return {
      response: json(
        {
          ok: false,
          error: "Invalid Idempotency-Key header.",
          code: "invalid_idempotency_key",
        },
        { status: 400 }
      ),
    };
  }
  return { key };
}

function adminMutationConfirmationResponse(code, message, confirmation) {
  return json(
    {
      ok: false,
      error: message,
      code,
      required: {
        confirm: true,
        confirmation,
      },
    },
    { status: 409 }
  );
}

function buildAdminReadinessStatus(env) {
  const resetConfirmedExecutionEnabled = isLegacyMediaResetConfirmedExecutionEnabled(env);
  return {
    ok: true,
    version: READINESS_STATUS_VERSION,
    generatedAt: nowIso(),
    releaseTruth: {
      source: "config/release-compat.json",
      latestAuthMigration: CURRENT_AUTH_SCHEMA_CHECKPOINT,
      migrationDirectory: "workers/auth/migrations",
      databaseName: "bitbi-auth-db",
      staticDeploySeparateFromWorkers: true,
      repoTruthIsLiveDeployProof: false,
      deployVerificationRequired: true,
      deployUnits: ["auth Worker", "AI Worker", "contact Worker", "static Pages"],
      caveat: "Repository readiness state is not live Cloudflare deploy proof; operator verification remains required.",
    },
    liveEvidenceState: {
      status: "live_evidence_pending",
      repoSupported: true,
      deployPendingUntilOperatorProof: true,
      liveEvidenceCollectedByRepoAlone: false,
      latestExpectedManifestFields: [
        "generated timestamp",
        "git branch",
        "git commit SHA",
        "worktree classification",
        "latest auth migration",
        "deploy units",
        "deploy order",
        "blocked claims",
        "rollback placeholders",
      ],
      pendingChecks: [
        "release cutover manifest saved",
        "remote auth D1 migration verification",
        "Worker deploy evidence",
        "static deploy evidence if affected",
        "GET /api/health live result",
        "public security header result",
        "admin readiness status live result",
        "rollback owner and previous version recorded",
      ],
      rejectedOrFailedEvidence: [],
      caveat: "This endpoint reports repo-supported status only. It does not collect live evidence by itself.",
    },
    productionExecution: {
      status: "blocked",
      repoSupported: true,
      deployPending: true,
      liveEvidencePending: true,
      productionReadiness: "blocked",
      repoTruthIsLiveProof: false,
      noBrowserDeploy: true,
      noBrowserMigration: true,
      noBrowserRollback: true,
      safeStateSummary: "Repo-supported production execution framework is available; deploy-pending and live-evidence-pending remain until operator proof is attached.",
    },
    cloudflareResourceModel: {
      status: "repo_declared_live_verification_required",
      command: "npm run cloudflare:resource-model",
      markdownCommand: "npm run cloudflare:resource-model:markdown",
      repoDeclaredResources: [
        "Workers: bitbi-auth, bitbi-ai, bitbi-contact",
        "Routes: bitbi.ai/api/*, contact.bitbi.ai",
        "D1: bitbi-auth-db",
        "R2: PRIVATE_MEDIA, USER_IMAGES, AUDIT_ARCHIVE",
        "Queues: ACTIVITY_INGEST_QUEUE, AI_IMAGE_DERIVATIVES_QUEUE, AI_VIDEO_JOBS_QUEUE",
        "Durable Objects: auth/contact public rate limiters, AI service replay",
        "Service binding: Auth -> AI Worker",
        "Cloudflare Images and Workers AI bindings",
        "Auth scheduled cron",
      ],
      dashboardManagedRequirements: [
        "WAF/rate limits",
        "Static security Transform Rules",
        "RUM setting",
        "Alerts",
        "Custom domains/certificates if outside repo evidence",
        "Cloudflare secrets and optional feature flags by name only",
      ],
      liveVerificationRequired: true,
      cloudflareApiCallsMade: false,
      secretValuesExposed: false,
    },
    readinessDossier: {
      status: "local_only_available",
      commands: [
        "npm run readiness:dossier",
        "npm run readiness:dossier:markdown",
      ],
      outputFormats: ["json", "markdown"],
      productionReadiness: "blocked",
      liveBillingReadiness: "blocked",
      defaultLiveCalls: false,
    },
    postDeployVerification: {
      status: "pending_operator_run",
      command: "npm run readiness:live-readonly -- --static-url https://bitbi.ai --auth-worker-url https://bitbi.ai --admin-readiness-url https://bitbi.ai",
      getOnlyByDefault: true,
      adminCookieRequiredForAdminPanels: true,
      adminCookieValueRendered: false,
      checks: [
        "public health endpoint",
        "static security headers",
        "unknown API safe failure shape",
        "admin readiness status when cookie is provided",
        "billing evidence status when cookie is provided",
        "operations timeline when cookie is provided",
        "tenant domain evidence when cookie is provided",
      ],
    },
    rollbackDrill: {
      status: "template_available_not_executed",
      command: "npm run release:rollback-drill",
      rollbackExecuted: false,
      ownerPlaceholder: "operator to fill",
      requiredEvidence: [
        "previous Worker versions/deploy IDs",
        "previous static artifact/deploy ID",
        "rollback owner",
        "decision criteria",
        "post-rollback smoke evidence",
      ],
    },
    releaseCandidate: {
      status: "repo_supported_ci_pending_live_evidence_pending",
      productionReadiness: "blocked",
      liveBillingReadiness: "blocked",
      releaseCandidateUse: "code_merge_or_deploy_preparation_only",
      ciStatus: "unknown_until_operator_runs_matrix",
      commands: [
        "npm run rc:check",
        "npm run release:rc",
        "npm run release:rc:markdown",
        "npm run readiness:dossier:markdown",
        "npm run release:rollback-drill",
        "npm run release:plan",
      ],
      checklist: [
        "clean worktree",
        "all audits pass",
        "full local/static/worker/test matrix pass",
        "release plan reviewed",
        "cutover evidence generated",
        "readiness dossier generated",
        "rollback drill generated",
        "live read-only evidence pending or attached",
        "blocked claims acknowledged",
      ],
      waveMatrix: [
        "Core readiness gates are repo-supported; evidence blockers remain visible",
        "Security, cost, Admin, lifecycle, tenant asset, and release controls are repo-supported; live/manual evidence remains pending where applicable",
        "Release candidate framework is local-only and does not prove production readiness",
      ],
      dangerousActionsOffered: false,
      browserExecutesCommands: false,
    },
    cutoverEvidence: {
      outputDirectory: "docs/production-readiness/evidence/",
      commands: [
        "npm run rc:check",
        "npm run release:rc:markdown",
        "npm run release:cutover-evidence",
        "npm run release:cutover-evidence:markdown",
        "npm run readiness:live-readonly -- --static-url https://bitbi.ai --auth-worker-url https://bitbi.ai",
        "npm run readiness:dossier",
        "npm run readiness:dossier:markdown",
        "npm run cloudflare:resource-model",
        "npm run cloudflare:resource-model:markdown",
        "npm run release:rollback-drill",
      ],
      safeToRunLocally: true,
      browserExecutesCommands: false,
      noDeployOrMigration: true,
    },
    blockedClaims: [
      { id: "production_readiness", label: "Production readiness", status: "blocked" },
      { id: "live_billing_readiness", label: "Live billing readiness", status: "blocked" },
      { id: "tenant_isolation", label: "Tenant isolation", status: "not_claimed" },
      { id: "ownership_backfill_readiness", label: "Ownership backfill readiness", status: "blocked" },
      { id: "access_switch_readiness", label: "Access-switch readiness", status: "blocked" },
      { id: "confirmed_legacy_media_reset_readiness", label: "Confirmed legacy media reset readiness", status: "blocked" },
      { id: "confirmed_media_deletion_reset", label: "Confirmed media deletion/reset", status: "not_approved" },
    ],
    hardeningStatus: [
      { id: "omega_p0_01", label: "Main release readiness gate", status: "implemented_repo_supported" },
      { id: "omega_p0_02", label: "Confirmed legacy reset gate", status: "implemented_default_off" },
      { id: "omega_p0_03", label: "Sanitized legacy reset dry-run evidence", status: "pending_blocking" },
      { id: "omega_p0_04", label: "Manual-review idempotency evidence", status: "pending_blocking" },
      { id: "omega_p0_05", label: "Active documentation drift cleanup", status: "implemented_repo_supported" },
      { id: "omega_p1_wave_1", label: "Security and cost boundary hardening", status: "implemented_repo_supported" },
      { id: "omega_p1_wave_2", label: "Release, canary, billing, and admin hardening", status: "implemented_repo_supported" },
      { id: "omega_p1_wave_3", label: "Admin, data, observability, and scale hardening", status: "implemented_repo_supported" },
      { id: "omega_p1_wave_4", label: "Admin Readiness & Evidence Dashboard", status: "implemented_repo_supported" },
      { id: "omega_p1_wave_5", label: "Live evidence and cutover tooling", status: "implemented_repo_supported" },
      { id: "omega_p1_wave_6", label: "Tenant asset and storage evidence expansion", status: "implemented_repo_supported" },
      { id: "omega_p1_wave_7", label: "Billing evidence and control plane", status: "implemented_repo_supported" },
      { id: "omega_p1_wave_8", label: "Operator timeline and triage evidence explorer", status: "implemented_repo_supported" },
      { id: "omega_p1_wave_9", label: "Production execution framework", status: "implemented_repo_supported_live_evidence_pending" },
      { id: "omega_p1_wave_10", label: "Release candidate consolidation", status: "implemented_repo_supported_go_no_go_blocked" },
    ],
    runtimeSafetyGates: [
      {
        id: "legacy_media_reset_confirmed_execution",
        label: LEGACY_MEDIA_RESET_CONFIRMED_EXECUTION_GATE,
        expected: "off",
        enabled: resetConfirmedExecutionEnabled,
        status: resetConfirmedExecutionEnabled ? "enabled_requires_operator_review" : "disabled_default_off",
        rawValueExposed: false,
      },
      { id: "fetch_metadata_csrf", label: "Fetch Metadata CSRF hardening", status: "implemented" },
      { id: "ai_worker_caller_policy", label: "AI Worker caller-policy enforcement", status: "implemented" },
      { id: "admin_ai_legacy_paths", label: "Admin AI legacy/unclassified provider paths", status: "blocked_or_classified" },
      { id: "r2_private_key_redaction", label: "R2/private key redaction", status: "implemented" },
      { id: "admin_mutation_confirmations", label: "High-risk admin mutation confirmations", status: "implemented_for_covered_routes" },
      { id: "data_lifecycle_guardrails", label: "Data lifecycle confirmation/idempotency guardrails", status: "implemented_for_covered_routes" },
    ],
    evidenceStatuses: [
      { id: "legacy_reset_sanitized_dry_run", label: "Legacy reset sanitized dry-run evidence", status: "pending_sanitized_evidence_required" },
      { id: "manual_review_idempotency", label: "Manual-review idempotency evidence", status: "pending_replay_conflict_status_success" },
      { id: "production_readiness", label: "Production readiness evidence", status: "pending_operator_live_evidence" },
      { id: "live_billing_canary", label: "Live billing canary evidence", status: "pending_operator_live_evidence" },
      { id: "billing_evidence_control_plane", label: "Billing evidence/control plane", status: "implemented_repo_supported" },
      { id: "billing_safety_local_tests", label: "Billing safety local tests", status: "implemented_repo_supported" },
      { id: "operator_timeline_triage", label: "Operator timeline/triage read model", status: "implemented_repo_supported" },
      { id: "evidence_archive_index", label: "Evidence archive/index tooling", status: "implemented_repo_supported_local_only" },
      { id: "cloudflare_resource_model", label: "Cloudflare resource verification model", status: "implemented_repo_supported_live_evidence_pending" },
      { id: "production_readiness_dossier", label: "Production readiness execution dossier", status: "implemented_repo_supported_local_only" },
      { id: "rollback_drill", label: "Rollback drill framework", status: "implemented_repo_supported_not_executed" },
      { id: "release_candidate_manifest", label: "Release Candidate Go/No-Go manifest", status: "implemented_repo_supported_local_only_blocked_verdict" },
      { id: "rc_validation_matrix", label: "Final RC validation matrix", status: "implemented_plan_only_by_default" },
      { id: "readiness_canary_contract", label: "Readiness/canary local-only safety contract", status: "implemented_repo_supported" },
      { id: "ai_budget_platform_evidence", label: "AI budget/platform evidence", status: "implemented_selected_scopes_live_evidence_pending" },
    ],
    safeNextActions: [
      "Refresh this dashboard.",
      "Open existing admin panels for read-only inspection or already guarded operations.",
      "Export existing sanitized evidence where admin APIs already support export.",
      "Copy local validation commands and run them outside the browser.",
      "Collect missing operator evidence manually without enabling destructive gates.",
    ],
    dangerousActionsDisabled: [
      "Enable legacy reset confirmed execution.",
      "Confirmed reset/delete.",
      "Ownership backfill.",
      "Runtime access-check switch.",
      "Live billing enablement.",
      "Remote migrations/deploys from the browser.",
      "Stripe/provider/Cloudflare/GitHub API mutation.",
    ],
  };
}

function requireAdminMutationConfirmation(body, {
  confirmation,
  code,
  message,
}) {
  if (body?.confirm !== true || body?.confirmation !== confirmation) {
    return adminMutationConfirmationResponse(code, message, confirmation);
  }
  return null;
}

function normalizeAdminDeleteErasureWorkflow(body) {
  const workflowBody = body?.dataErasureWorkflow && typeof body.dataErasureWorkflow === "object"
    ? body.dataErasureWorkflow
    : {};
  const requested = body?.startDataErasureWorkflow === true || workflowBody.start === true;
  if (!requested) {
    return {
      requested: false,
      response: null,
      workflow: null,
    };
  }

  const acknowledgement = String(
    workflowBody.acknowledgement ?? body?.dataErasureAcknowledgement ?? ""
  ).trim();
  if (acknowledgement !== ADMIN_DELETE_ERASURE_ACKNOWLEDGEMENT) {
    return {
      requested: true,
      workflow: null,
      response: json(
        {
          ok: false,
          error: "Explicit Data Erasure workflow acknowledgement is required before starting the privacy/legal review workflow.",
          code: "admin_delete_user_erasure_acknowledgement_required",
          required: {
            dataErasureWorkflow: {
              acknowledgement: ADMIN_DELETE_ERASURE_ACKNOWLEDGEMENT,
            },
          },
          dataErasureWorkflow: {
            started: false,
            status: "acknowledgement_required",
            executesImmediately: false,
            evidenceRequired: true,
          },
        },
        { status: 409 }
      ),
    };
  }

  const reason = String(workflowBody.reason || ADMIN_DELETE_ERASURE_DEFAULT_REASON).trim()
    .slice(0, 500) || ADMIN_DELETE_ERASURE_DEFAULT_REASON;
  const requestSource = String(workflowBody.requestSource || "admin_delete_user_modal").trim()
    .replace(/[^a-zA-Z0-9_.:-]+/g, "_")
    .slice(0, 80) || "admin_delete_user_modal";

  return {
    requested: true,
    response: null,
    workflow: {
      acknowledgement,
      reason,
      requestSource,
    },
  };
}

function adminDeleteErasureNotRequested() {
  return {
    started: false,
    status: "not_requested",
    executesImmediately: false,
    evidenceRequired: false,
  };
}

function buildAdminDeleteErasureIdempotencyKey(targetUserId) {
  const safeId = String(targetUserId || "user")
    .replace(/[^a-zA-Z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 92) || "user";
  return `admin-delete-erasure-${safeId}`.slice(0, 128);
}

async function startAdminDeleteDataErasureWorkflow({
  env,
  adminUser,
  targetUser,
  workflow,
  now,
  correlationId,
  requestInfo,
}) {
  const result = await createDataLifecycleRequest({
    env,
    adminUser,
    idempotencyKey: buildAdminDeleteErasureIdempotencyKey(targetUser.id),
    body: {
      type: "delete",
      subjectUserId: targetUser.id,
      reason: workflow.reason,
    },
  });
  const request = result.request;
  const workflowSummary = {
    started: true,
    status: request.status === "submitted" ? "pending_review" : request.status,
    requestStatus: request.status,
    requestId: request.id,
    requestType: request.type,
    reused: result.reused === true,
    requiresApproval: request.approvalRequired === true,
    executesImmediately: false,
    evidenceRequired: true,
    dryRun: request.dryRun === true,
    requestSource: workflow.requestSource,
  };

  await enqueueAdminAuditEvent(
    env,
    {
      adminUserId: adminUser.id,
      action: "data_erasure_workflow_started_from_admin_delete",
      targetUserId: targetUser.id,
      meta: {
        request_id: request.id,
        request_type: request.type,
        request_status: request.status,
        workflow_status: workflowSummary.status,
        reused: workflowSummary.reused,
        request_source: workflow.requestSource,
        executes_immediately: false,
        evidence_required: true,
        dry_run: request.dryRun === true,
        target_email: targetUser.email,
        target_role: targetUser.role,
        target_status: targetUser.status,
        actor_email: adminUser.email,
      },
      createdAt: now,
    },
    {
      correlationId,
      requestInfo,
      allowDirectFallback: true,
    }
  );

  return workflowSummary;
}

function adminDeleteOperationalFailurePayload({
  error,
  dependencySummary,
  dataErasureWorkflow,
}) {
  const blockedDependency = error.branch === "user_delete_failed_dependency"
    || error.branch === "retention_dependency_blocked";
  return {
    ok: false,
    error: error.message,
    code: blockedDependency
      ? "admin_delete_user_dependency_blocked"
      : "admin_delete_user_lifecycle_failed",
    branch: error.branch || "lifecycle_delete_failed",
    operationalDelete: {
      completed: false,
      status: "failed",
      branch: error.branch || "lifecycle_delete_failed",
    },
    dataErasureWorkflow,
    dependencySummary: {
      mode: dependencySummary.mode,
      blockingCategories: blockedDependency
        ? dependencySummary.retainedPolicyRecords
        : [error.details?.category || error.branch || "lifecycle_cleanup"],
      safeCounts: dependencySummary.safeCounts,
      unavailable: dependencySummary.unavailable,
    },
  };
}

function safeDeletedEmailForUser(userId) {
  const safeId = String(userId || "user")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "user";
  return `deleted+${safeId}@deleted.bitbi.invalid`;
}

function adminUserLifecycleStatement({ statement, branch, label, category }) {
  return { statement, branch, label, category };
}

function normalizeCountValue(row) {
  const value = row?.cnt ?? row?.count ?? row?.total ?? 0;
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function isMissingOptionalDependencyTable(error) {
  return /no such table/i.test(String(error?.message || error || ""));
}

async function countAdminUserDependency(env, { id, sql, bindings, optional = true }) {
  try {
    const row = await env.DB.prepare(sql).bind(...bindings).first();
    return { id, count: normalizeCountValue(row), available: true };
  } catch (error) {
    if (optional && isMissingOptionalDependencyTable(error)) {
      return { id, count: null, available: false };
    }
    throw error;
  }
}

async function buildAdminUserDeleteDependencySummary(env, userId) {
  const counts = await Promise.all([
    countAdminUserDependency(env, { id: "sessions", sql: "SELECT COUNT(*) AS cnt FROM sessions WHERE user_id = ?", bindings: [userId] }),
    countAdminUserDependency(env, { id: "email_verification_tokens", sql: "SELECT COUNT(*) AS cnt FROM email_verification_tokens WHERE user_id = ?", bindings: [userId] }),
    countAdminUserDependency(env, { id: "password_reset_tokens", sql: "SELECT COUNT(*) AS cnt FROM password_reset_tokens WHERE user_id = ?", bindings: [userId] }),
    countAdminUserDependency(env, { id: "profiles", sql: "SELECT COUNT(*) AS cnt FROM profiles WHERE user_id = ?", bindings: [userId] }),
    countAdminUserDependency(env, { id: "linked_wallets", sql: "SELECT COUNT(*) AS cnt FROM linked_wallets WHERE user_id = ?", bindings: [userId] }),
    countAdminUserDependency(env, { id: "siwe_challenges", sql: "SELECT COUNT(*) AS cnt FROM siwe_challenges WHERE user_id = ?", bindings: [userId] }),
    countAdminUserDependency(env, { id: "favorites", sql: "SELECT COUNT(*) AS cnt FROM favorites WHERE user_id = ?", bindings: [userId] }),
    countAdminUserDependency(env, { id: "ai_images", sql: "SELECT COUNT(*) AS cnt FROM ai_images WHERE user_id = ?", bindings: [userId] }),
    countAdminUserDependency(env, { id: "ai_text_assets", sql: "SELECT COUNT(*) AS cnt FROM ai_text_assets WHERE user_id = ?", bindings: [userId] }),
    countAdminUserDependency(env, { id: "ai_folders", sql: "SELECT COUNT(*) AS cnt FROM ai_folders WHERE user_id = ?", bindings: [userId] }),
    countAdminUserDependency(env, { id: "ai_generation_log", sql: "SELECT COUNT(*) AS cnt FROM ai_generation_log WHERE user_id = ?", bindings: [userId] }),
    countAdminUserDependency(env, { id: "ai_daily_quota_usage", sql: "SELECT COUNT(*) AS cnt FROM ai_daily_quota_usage WHERE user_id = ?", bindings: [userId] }),
    countAdminUserDependency(env, { id: "ai_video_jobs", sql: "SELECT COUNT(*) AS cnt FROM ai_video_jobs WHERE user_id = ?", bindings: [userId] }),
    countAdminUserDependency(env, { id: "member_ai_usage_attempts", sql: "SELECT COUNT(*) AS cnt FROM member_ai_usage_attempts WHERE user_id = ?", bindings: [userId] }),
    countAdminUserDependency(env, { id: "canvas_projects", sql: "SELECT COUNT(*) AS cnt FROM canvas_projects WHERE user_id = ?", bindings: [userId] }),
    countAdminUserDependency(env, { id: "asset_storage_quota", sql: "SELECT COUNT(*) AS cnt FROM user_asset_storage_usage WHERE user_id = ?", bindings: [userId] }),
    countAdminUserDependency(env, { id: "admin_mfa_credentials", sql: "SELECT COUNT(*) AS cnt FROM admin_mfa_credentials WHERE admin_user_id = ?", bindings: [userId] }),
    countAdminUserDependency(env, { id: "admin_mfa_recovery_codes", sql: "SELECT COUNT(*) AS cnt FROM admin_mfa_recovery_codes WHERE admin_user_id = ?", bindings: [userId] }),
    countAdminUserDependency(env, { id: "admin_mfa_failed_attempts", sql: "SELECT COUNT(*) AS cnt FROM admin_mfa_failed_attempts WHERE admin_user_id = ?", bindings: [userId] }),
    countAdminUserDependency(env, { id: "organization_memberships", sql: "SELECT COUNT(*) AS cnt FROM organization_memberships WHERE user_id = ?", bindings: [userId] }),
    countAdminUserDependency(env, { id: "organizations_created", sql: "SELECT COUNT(*) AS cnt FROM organizations WHERE created_by_user_id = ?", bindings: [userId] }),
    countAdminUserDependency(env, { id: "organization_memberships_created", sql: "SELECT COUNT(*) AS cnt FROM organization_memberships WHERE created_by_user_id = ?", bindings: [userId] }),
    countAdminUserDependency(env, { id: "member_credit_ledger", sql: "SELECT COUNT(*) AS cnt FROM member_credit_ledger WHERE user_id = ? OR created_by_user_id = ?", bindings: [userId, userId] }),
    countAdminUserDependency(env, { id: "member_usage_events", sql: "SELECT COUNT(*) AS cnt FROM member_usage_events WHERE user_id = ?", bindings: [userId] }),
    countAdminUserDependency(env, { id: "member_credit_buckets", sql: "SELECT COUNT(*) AS cnt FROM member_credit_buckets WHERE user_id = ?", bindings: [userId] }),
    countAdminUserDependency(env, { id: "member_credit_bucket_events", sql: "SELECT COUNT(*) AS cnt FROM member_credit_bucket_events WHERE user_id = ?", bindings: [userId] }),
    countAdminUserDependency(env, { id: "billing_member_checkout_sessions", sql: "SELECT COUNT(*) AS cnt FROM billing_member_checkout_sessions WHERE user_id = ?", bindings: [userId] }),
    countAdminUserDependency(env, { id: "billing_member_subscriptions", sql: "SELECT COUNT(*) AS cnt FROM billing_member_subscriptions WHERE user_id = ?", bindings: [userId] }),
    countAdminUserDependency(env, { id: "billing_member_subscription_checkout_sessions", sql: "SELECT COUNT(*) AS cnt FROM billing_member_subscription_checkout_sessions WHERE user_id = ?", bindings: [userId] }),
    countAdminUserDependency(env, { id: "billing_checkout_sessions", sql: "SELECT COUNT(*) AS cnt FROM billing_checkout_sessions WHERE user_id = ?", bindings: [userId] }),
    countAdminUserDependency(env, { id: "billing_provider_events", sql: "SELECT COUNT(*) AS cnt FROM billing_provider_events WHERE user_id = ?", bindings: [userId] }),
    countAdminUserDependency(env, { id: "credit_ledger_created", sql: "SELECT COUNT(*) AS cnt FROM credit_ledger WHERE created_by_user_id = ?", bindings: [userId] }),
    countAdminUserDependency(env, { id: "usage_events", sql: "SELECT COUNT(*) AS cnt FROM usage_events WHERE user_id = ?", bindings: [userId] }),
    countAdminUserDependency(env, { id: "ai_usage_attempts", sql: "SELECT COUNT(*) AS cnt FROM ai_usage_attempts WHERE user_id = ?", bindings: [userId] }),
    countAdminUserDependency(env, { id: "admin_ai_usage_attempts", sql: "SELECT COUNT(*) AS cnt FROM admin_ai_usage_attempts WHERE admin_user_id = ?", bindings: [userId] }),
    countAdminUserDependency(env, { id: "admin_audit_log", sql: "SELECT COUNT(*) AS cnt FROM admin_audit_log WHERE admin_user_id = ? OR target_user_id = ?", bindings: [userId, userId] }),
    countAdminUserDependency(env, { id: "user_activity_log", sql: "SELECT COUNT(*) AS cnt FROM user_activity_log WHERE user_id = ?", bindings: [userId] }),
    countAdminUserDependency(env, { id: "activity_search_index", sql: "SELECT COUNT(*) AS cnt FROM activity_search_index WHERE actor_user_id = ? OR target_user_id = ?", bindings: [userId, userId] }),
    countAdminUserDependency(env, { id: "data_lifecycle_requests", sql: "SELECT COUNT(*) AS cnt FROM data_lifecycle_requests WHERE subject_user_id = ? OR requested_by_user_id = ? OR requested_by_admin_id = ? OR approved_by_admin_id = ?", bindings: [userId, userId, userId, userId] }),
    countAdminUserDependency(env, { id: "data_export_archives", sql: "SELECT COUNT(*) AS cnt FROM data_export_archives WHERE subject_user_id = ?", bindings: [userId] }),
    countAdminUserDependency(env, { id: "manual_review_items", sql: "SELECT COUNT(*) AS cnt FROM ai_asset_manual_review_items WHERE legacy_owner_user_id = ? OR proposed_owning_user_id = ? OR assigned_to_user_id = ? OR reviewed_by_user_id = ? OR created_by_user_id = ?", bindings: [userId, userId, userId, userId, userId] }),
    countAdminUserDependency(env, { id: "manual_review_events", sql: "SELECT COUNT(*) AS cnt FROM ai_asset_manual_review_events WHERE actor_user_id = ?", bindings: [userId] }),
    countAdminUserDependency(env, { id: "legacy_media_reset_actions", sql: "SELECT COUNT(*) AS cnt FROM tenant_asset_media_reset_actions WHERE operator_user_id = ?", bindings: [userId] }),
    countAdminUserDependency(env, { id: "legacy_media_reset_events", sql: "SELECT COUNT(*) AS cnt FROM tenant_asset_media_reset_action_events WHERE actor_user_id = ?", bindings: [userId] }),
  ]);

  const safeCounts = {};
  const unavailable = [];
  for (const item of counts) {
    if (item.available) {
      safeCounts[item.id] = item.count;
    } else {
      unavailable.push(item.id);
    }
  }

  const retainedCategoryMap = [
    ["admin_audit_log", ["admin_audit_log", "activity_search_index"]],
    ["user_activity_log_retention", ["user_activity_log"]],
    ["billing_ledger", [
      "member_credit_ledger",
      "member_usage_events",
      "member_credit_buckets",
      "member_credit_bucket_events",
      "billing_member_checkout_sessions",
      "billing_member_subscriptions",
      "billing_member_subscription_checkout_sessions",
      "billing_checkout_sessions",
      "billing_provider_events",
      "credit_ledger_created",
      "usage_events",
    ]],
    ["organization_relationship_history", [
      "organizations_created",
      "organization_memberships_created",
    ]],
    ["data_lifecycle_records", [
      "data_lifecycle_requests",
      "data_export_archives",
    ]],
    ["ai_usage_attempt_evidence", [
      "ai_usage_attempts",
      "admin_ai_usage_attempts",
    ]],
    ["tenant_manual_review_evidence", [
      "manual_review_items",
      "manual_review_events",
      "legacy_media_reset_actions",
      "legacy_media_reset_events",
    ]],
  ];
  const retainedPolicyRecords = retainedCategoryMap
    .filter(([, ids]) => ids.some((id) => Number(safeCounts[id] || 0) > 0))
    .map(([category]) => category);
  if (!retainedPolicyRecords.includes("admin_audit_log")) {
    retainedPolicyRecords.unshift("admin_audit_log");
  }
  if (!retainedPolicyRecords.includes("billing_ledger_and_provider_evidence_if_present")) {
    retainedPolicyRecords.push("billing_ledger_and_provider_evidence_if_present");
  }
  if (!retainedPolicyRecords.includes("legal_or_compliance_records_if_present")) {
    retainedPolicyRecords.push("legal_or_compliance_records_if_present");
  }

  return {
    mode: "operational_anonymized_delete",
    safeCounts,
    unavailable,
    retainedPolicyRecords,
  };
}

function buildAdminUserOperationalDeleteStatements(env, {
  userId,
  deletedEmail,
  now,
  unavailable = [],
}) {
  const unavailableSet = new Set(unavailable);
  const statements = [
    adminUserLifecycleStatement({
      statement: env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId),
      branch: "sessions_delete_failed",
      label: "sessions_delete",
      category: "auth_session_cleanup",
    }),
    adminUserLifecycleStatement({
      statement: env.DB.prepare("DELETE FROM email_verification_tokens WHERE user_id = ?").bind(userId),
      branch: "tokens_delete_failed",
      label: "email_verification_tokens_delete",
      category: "auth_token_cleanup",
    }),
    adminUserLifecycleStatement({
      statement: env.DB.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").bind(userId),
      branch: "tokens_delete_failed",
      label: "password_reset_tokens_delete",
      category: "auth_token_cleanup",
    }),
  ];
  const pushOptional = (tableId, item) => {
    if (!unavailableSet.has(tableId)) statements.push(adminUserLifecycleStatement(item));
  };
  pushOptional("admin_mfa_recovery_codes", {
    statement: env.DB.prepare("DELETE FROM admin_mfa_recovery_codes WHERE admin_user_id = ?").bind(userId),
    branch: "admin_mfa_delete_failed",
    label: "admin_mfa_recovery_codes_delete",
    category: "admin_mfa_cleanup",
  });
  pushOptional("admin_mfa_credentials", {
    statement: env.DB.prepare("DELETE FROM admin_mfa_credentials WHERE admin_user_id = ?").bind(userId),
    branch: "admin_mfa_delete_failed",
    label: "admin_mfa_credentials_delete",
    category: "admin_mfa_cleanup",
  });
  pushOptional("admin_mfa_failed_attempts", {
    statement: env.DB.prepare("DELETE FROM admin_mfa_failed_attempts WHERE admin_user_id = ?").bind(userId),
    branch: "admin_mfa_delete_failed",
    label: "admin_mfa_failed_attempts_delete",
    category: "admin_mfa_cleanup",
  });
  pushOptional("linked_wallets", {
    statement: env.DB.prepare("DELETE FROM linked_wallets WHERE user_id = ?").bind(userId),
    branch: "wallet_links_delete_failed",
    label: "linked_wallets_delete",
    category: "wallet_cleanup",
  });
  pushOptional("siwe_challenges", {
    statement: env.DB.prepare("DELETE FROM siwe_challenges WHERE user_id = ?").bind(userId),
    branch: "wallet_challenges_delete_failed",
    label: "siwe_challenges_delete",
    category: "wallet_cleanup",
  });
  statements.push(
    adminUserLifecycleStatement({
      statement: env.DB.prepare("DELETE FROM profiles WHERE user_id = ?").bind(userId),
      branch: "profile_delete_failed",
      label: "profile_delete",
      category: "profile_cleanup",
    })
  );
  pushOptional("favorites", {
    statement: env.DB.prepare("DELETE FROM favorites WHERE user_id = ?").bind(userId),
    branch: "favorites_delete_failed",
    label: "favorites_delete",
    category: "user_preference_cleanup",
  });
  pushOptional("asset_storage_quota", {
    statement: env.DB.prepare("DELETE FROM user_asset_storage_usage WHERE user_id = ?").bind(userId),
    branch: "storage_quota_delete_failed",
    label: "user_asset_storage_usage_delete",
    category: "asset_storage_cleanup",
  });
  pushOptional("ai_generation_log", {
    statement: env.DB.prepare("DELETE FROM ai_generation_log WHERE user_id = ?").bind(userId),
    branch: "ai_generation_log_delete_failed",
    label: "ai_generation_log_delete",
    category: "ai_operational_history_cleanup",
  });
  pushOptional("ai_daily_quota_usage", {
    statement: env.DB.prepare("DELETE FROM ai_daily_quota_usage WHERE user_id = ?").bind(userId),
    branch: "ai_daily_quota_delete_failed",
    label: "ai_daily_quota_usage_delete",
    category: "ai_quota_cleanup",
  });
  pushOptional("member_ai_usage_attempts", {
    statement: env.DB.prepare("DELETE FROM member_ai_usage_attempts WHERE user_id = ?").bind(userId),
    branch: "member_ai_usage_attempts_delete_failed",
    label: "member_ai_usage_attempts_delete",
    category: "ai_attempt_cleanup",
  });
  pushOptional("canvas_projects", {
    statement: env.DB.prepare("DELETE FROM canvas_projects WHERE user_id = ?").bind(userId),
    branch: "canvas_projects_delete_failed",
    label: "canvas_projects_delete",
    category: "canvas_workspace_cleanup",
  });
  pushOptional("organization_memberships", {
    statement: env.DB.prepare("DELETE FROM organization_memberships WHERE user_id = ?").bind(userId),
    branch: "organization_memberships_delete_failed",
    label: "organization_memberships_delete",
    category: "organization_access_cleanup",
  });
  statements.push(
    adminUserLifecycleStatement({
      statement: env.DB.prepare(
        "UPDATE users SET email = ?, password_hash = ?, status = ?, email_verified_at = NULL, verification_method = ?, updated_at = ? WHERE id = ? AND status != ?"
      ).bind(deletedEmail, ADMIN_USER_DELETED_PASSWORD_HASH, ADMIN_USER_DELETED_STATUS, "operational_delete", now, userId, ADMIN_USER_DELETED_STATUS),
      branch: "user_anonymize_failed",
      label: "user_account_anonymize",
      category: "account_anonymization",
    })
  );
  return statements;
}

function normalizeAdminUserSearch(value) {
  return String(value || "").trim();
}

function normalizeActivityEntry(entry, actorEmailField, targetEmailField = null) {
  const normalized = {
    ...entry,
    meta_json: sanitizeActivityMetaJson(entry.action, entry.meta_json),
  };
  const fallback = (() => {
    try {
      return JSON.parse(entry.meta_json || "{}");
    } catch {
      return {};
    }
  })();
  if (actorEmailField && !normalized[actorEmailField]) {
    normalized[actorEmailField] = fallback.actor_email || fallback.email || null;
  }
  if (targetEmailField && !normalized[targetEmailField]) {
    normalized[targetEmailField] = fallback.target_email || null;
  }
  return normalized;
}

function appendActivitySearchConditions(conditions, bindings, search) {
  const range = buildActivitySearchRange(search);
  if (!range) return false;
  const [start, end] = range;
  conditions.push(`(
    (idx.action_norm >= ? AND idx.action_norm < ?)
    OR (idx.actor_email_norm >= ? AND idx.actor_email_norm < ?)
    OR (idx.target_email_norm >= ? AND idx.target_email_norm < ?)
    OR (idx.entity_id >= ? AND idx.entity_id < ?)
  )`);
  bindings.push(start, end, start, end, start, end, start, end);
  return true;
}

function appendActivityCursorCondition(conditions, bindings, cursor, { createdColumn, idColumn }) {
  if (!cursor) return;
  conditions.push(`(${createdColumn} < ? OR (${createdColumn} = ? AND ${idColumn} < ?))`);
  bindings.push(cursor.c, cursor.c, cursor.i);
}

async function decodeActivityCursorOrResponse(env, cursorParam, cursorType, expectedFilterHash) {
  if (!cursorParam) return { cursor: null };
  try {
    const decoded = await decodePaginationCursor(env, cursorParam, cursorType);
    const cursor = {
      c: readCursorString(decoded, "c"),
      i: readCursorString(decoded, "i"),
      q: readCursorString(decoded, "q", { allowEmpty: true, maxLength: 80 }),
      exp: readCursorInteger(decoded, "exp", { min: 1 }),
    };
    if (cursor.q !== expectedFilterHash || cursor.exp <= Date.now()) {
      return { response: paginationErrorResponse("Invalid cursor.") };
    }
    return { cursor };
  } catch {
    return { response: paginationErrorResponse("Invalid cursor.") };
  }
}

async function encodeActivityCursor(env, cursorType, filterHash, last) {
  return encodePaginationCursor(env, cursorType, {
    c: last.created_at,
    i: last.id,
    q: filterHash,
    exp: Date.now() + ACTIVITY_CURSOR_TTL_MS,
  });
}

async function enforceAdminActionRateLimit(ctx) {
  const { request, env, pathname, method, correlationId } = ctx;
  const ip = getClientIp(request);
  const result = await evaluateSharedRateLimit(
    env,
    "admin-action-ip",
    ip,
    30,
    900_000,
    sensitiveRateLimitOptions({
      component: "admin-action",
      correlationId,
      requestInfo: { request, pathname, method },
    })
  );
  if (result.unavailable) return rateLimitUnavailableResponse(correlationId);
  if (result.limited) return rateLimitResponse();
  return null;
}

export async function handleAdmin(ctx) {
  const { request, env, url, pathname, method, isSecure, correlationId } = ctx;

  const adminMfaResult = await handleAdminMfa(ctx);
  if (adminMfaResult) {
    return adminMfaResult;
  }

  const adminFableChatResult = await handleAdminFableChat(ctx);
  if (adminFableChatResult) {
    return adminFableChatResult;
  }

  const adminAiResult = await handleAdminAI(ctx);
  if (adminAiResult) {
    return adminAiResult;
  }

  const adminNewsPulseResult = await handleAdminNewsPulse(ctx);
  if (adminNewsPulseResult) {
    return adminNewsPulseResult;
  }

  const dataLifecycleResult = await handleAdminDataLifecycle(ctx);
  if (dataLifecycleResult) {
    return dataLifecycleResult;
  }

  const adminTenantAssetsResult = await handleAdminTenantAssets(ctx);
  if (adminTenantAssetsResult) {
    return adminTenantAssetsResult;
  }

  const adminBillingResult = await handleAdminBilling(ctx);
  if (adminBillingResult) {
    return adminBillingResult;
  }

  const adminR2ExplorerResult = await handleAdminR2Explorer(ctx);
  if (adminR2ExplorerResult) {
    return adminR2ExplorerResult;
  }

  const adminStorageResult = await handleAdminStorage(ctx);
  if (adminStorageResult) {
    return adminStorageResult;
  }

  if (
    (pathname === "/api/admin/homepage/hero-videos" && method === "GET") ||
    (pathname === "/api/admin/homepage/hero-videos/feature-status" && method === "GET") ||
    // route-policy: admin.homepage.hero-videos.preset.update
    (pathname === "/api/admin/homepage/hero-videos/preset" && method === "PATCH") ||
    (pathname === "/api/admin/homepage/hero-videos/candidates" && method === "GET") ||
    // route-policy: admin.homepage.hero-videos.uploads.create
    (pathname === "/api/admin/homepage/hero-videos/uploads" && method === "POST") ||
    // route-policy: admin.homepage.hero-videos.memvid-stream-previews.backfill
    (pathname === "/api/admin/homepage/hero-videos/memvid-stream-previews/backfill" && method === "POST") ||
    // route-policy: admin.homepage.hero-videos.memvid-stream-previews.run
    (pathname === "/api/admin/homepage/hero-videos/memvid-stream-previews/run" && method === "POST") ||
    (pathname === "/api/admin/homepage/hero-videos/derivatives" && method === "GET") ||
    // route-policy: admin.homepage.hero-videos.derivatives.create
    (pathname === "/api/admin/homepage/hero-videos/derivatives" && method === "POST")
  ) {
    return handleAdminHomepageHeroVideos(ctx);
  }
  const homepageHeroFeatureStatusMatch = pathname.match(/^\/api\/admin\/homepage\/hero-videos\/feature-status\/([^/]+)$/);
  // route-policy: admin.homepage.hero-videos.feature-status.update
  if (homepageHeroFeatureStatusMatch && method === "PATCH") {
    return handleAdminHomepageHeroVideos(ctx);
  }
  const homepageHeroUploadPosterMatch = pathname.match(/^\/api\/admin\/homepage\/hero-videos\/uploads\/([^/]+)\/poster$/);
  // route-policy: admin.homepage.hero-videos.uploads.poster
  if (homepageHeroUploadPosterMatch && method === "POST") {
    return handleAdminHomepageHeroVideos(ctx);
  }
  const homepageHeroUploadPosterRetryMatch = pathname.match(/^\/api\/admin\/homepage\/hero-videos\/uploads\/([^/]+)\/poster\/retry$/);
  // route-policy: admin.homepage.hero-videos.uploads.poster.retry
  if (homepageHeroUploadPosterRetryMatch && method === "POST") {
    return handleAdminHomepageHeroVideos(ctx);
  }
  const homepageHeroVideoDerivativeRetryMatch = pathname.match(/^\/api\/admin\/homepage\/hero-videos\/derivatives\/([^/]+)\/retry$/);
  // route-policy: admin.homepage.hero-videos.derivatives.retry
  if (homepageHeroVideoDerivativeRetryMatch && method === "POST") {
    return handleAdminHomepageHeroVideos(ctx);
  }
  const homepageHeroVideoDerivativeDetailMatch = pathname.match(/^\/api\/admin\/homepage\/hero-videos\/derivatives\/([^/]+)$/);
  if (homepageHeroVideoDerivativeDetailMatch && method === "GET") {
    return handleAdminHomepageHeroVideos(ctx);
  }
  const homepageHeroVideoSlotMatch = pathname.match(/^\/api\/admin\/homepage\/hero-videos\/slots\/([^/]+)$/);
  // route-policy: admin.homepage.hero-videos.slots.update
  if (homepageHeroVideoSlotMatch && method === "PUT") {
    return handleAdminHomepageHeroVideos(ctx);
  }

  const adminOrgsResult = await handleAdminOrgs(ctx);
  if (adminOrgsResult) {
    return adminOrgsResult;
  }

  // GET /api/admin/me
  if (pathname === "/api/admin/me" && method === "GET") {
    const result = await requireAdmin(request, env, {
      isSecure,
      correlationId,
      allowMfaBootstrap: true,
    });

    if (result instanceof Response) {
      return result;
    }

    if (result.adminMfa?.enforcementRequired && isProductionEnvironment(env)) {
      logAdminMfaDiagnostic({
        request,
        correlationId,
        adminUserId: result.user.id,
        event: "admin_mfa_access_rejected",
        level: "warn",
        failureReason: result.adminMfa.failureReason,
        status: 403,
        setupPending: result.adminMfa.setupPending,
        recoveryCodesRemaining: result.adminMfa.recoveryCodesRemaining,
      });
      return buildAdminMfaDeniedResponse({
        session: result,
        mfaState: result.adminMfa,
        correlationId,
        includeUser: true,
        isSecure,
      });
    }

    return json({
      ok: true,
      user: result.user,
    });
  }

  // GET /api/admin/readiness/status
  if (pathname === "/api/admin/readiness/status" && method === "GET") {
    const result = await requireAdmin(request, env, { isSecure, correlationId });

    if (result instanceof Response) {
      return result;
    }

    return json(buildAdminReadinessStatus(env), {
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  // GET /api/admin/operations/timeline
  if (pathname === "/api/admin/operations/timeline" && method === "GET") {
    const result = await requireAdmin(request, env, { isSecure, correlationId });

    if (result instanceof Response) {
      return result;
    }

    const timeline = await buildOperatorTimeline(env, url.searchParams);
    return json(timeline, {
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  // GET /api/admin/registration/status
  if (pathname === "/api/admin/registration/status" && method === "GET") {
    const result = await requireAdmin(request, env, { isSecure, correlationId });
    if (result instanceof Response) return result;
    const limited = await enforceAdminActionRateLimit(ctx);
    if (limited) return limited;
    try {
      const registration = await getRegistrationAvailability(env);
      return json({
        ok: true,
        registration,
      }, {
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      return json(
        {
          ok: false,
          error: "Registration availability status is temporarily unavailable.",
          code: "registration_availability_status_unavailable",
        },
        { status: 503 }
      );
    }
  }

  // route-policy: admin.registration.status.update
  // POST /api/admin/registration/status
  if (pathname === "/api/admin/registration/status" && method === "POST") {
    const result = await requireAdmin(request, env, { isSecure, correlationId });
    if (result instanceof Response) return result;
    const limited = await enforceAdminActionRateLimit(ctx);
    if (limited) return limited;
    const idempotency = adminSettingsIdempotencyKeyOrResponse(request);
    if (idempotency.response) return idempotency.response;
    const parsed = await readJsonBodyOrResponse(request, { maxBytes: BODY_LIMITS.smallJson });
    if (parsed.response) return parsed.response;
    const body = parsed.body || {};
    try {
      const registration = await setRegistrationAvailability(env, {
        enabled: body.enabled,
        actorUserId: result.user.id,
        reason: body.reason,
        maintenanceMessage: body.maintenanceMessage || REGISTRATION_MAINTENANCE_MESSAGE,
      });
      await enqueueAdminAuditEvent(
        env,
        {
          adminUserId: result.user.id,
          action: registration.enabled
            ? "registration_availability_enabled"
            : "registration_availability_disabled",
          targetUserId: null,
          meta: {
            enabled: registration.enabled,
            effectiveStatus: registration.effectiveStatus,
            reasonPresent: Boolean(registration.reason),
            existingUsersUnaffected: true,
            rawIdempotencyKeyIncluded: false,
          },
        },
        { correlationId, requestInfo: ctx, allowDirectFallback: true }
      );
      return json({
        ok: true,
        registration,
        message: registration.enabled
          ? "New user registrations are enabled."
          : "New user registrations are disabled for maintenance.",
      }, {
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      if (error instanceof RegistrationAvailabilityError) {
        return json(
          {
            ok: false,
            error: error.message,
            code: error.code,
            fields: error.fields,
          },
          { status: error.status || 400 }
        );
      }
      return json(
        {
          ok: false,
          error: "Registration availability setting could not be saved.",
          code: "registration_availability_update_failed",
        },
        { status: 500 }
      );
    }
  }

  // GET /api/admin/users
  if (pathname === "/api/admin/users" && method === "GET") {
    const result = await requireAdmin(request, env, { isSecure, correlationId });

    if (result instanceof Response) {
      return result;
    }

    const appliedLimit = resolvePaginationLimit(url.searchParams.get("limit"), {
      defaultValue: DEFAULT_ADMIN_USERS_LIMIT,
      maxValue: MAX_ADMIN_USERS_LIMIT,
    });
    const search = normalizeAdminUserSearch(url.searchParams.get("search"));

    let cursor = null;
    try {
      cursor = await decodePaginationCursor(env, url.searchParams.get("cursor"), ADMIN_USERS_CURSOR_TYPE);
      if (cursor) {
        cursor = {
          q: readCursorString(cursor, "q", { allowEmpty: true }),
          c: readCursorString(cursor, "c"),
          i: readCursorString(cursor, "i"),
        };
      }
    } catch {
      return paginationErrorResponse("Invalid cursor.");
    }
    if (cursor && cursor.q !== search) {
      return paginationErrorResponse("Invalid cursor.");
    }

    const conditions = ["status <> ?"];
    const bindings = [ADMIN_USER_DELETED_STATUS];

    if (search) {
      conditions.push("email LIKE ?");
      bindings.push(`%${search}%`);
    }
    if (cursor) {
      conditions.push("(created_at < ? OR (created_at = ? AND id < ?))");
      bindings.push(cursor.c, cursor.c, cursor.i);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = await env.DB.prepare(
      `SELECT id, email, role, status, created_at, updated_at, email_verified_at, verification_method
       FROM users
       ${whereClause}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    )
      .bind(...bindings, appliedLimit + 1)
      .all();

    const resultRows = rows.results || [];
    const hasMore = resultRows.length > appliedLimit;
    const users = hasMore ? resultRows.slice(0, appliedLimit) : resultRows;
    const last = users[users.length - 1];

    return json({
      ok: true,
      users,
      next_cursor: hasMore
        ? await encodePaginationCursor(env, ADMIN_USERS_CURSOR_TYPE, {
            q: search,
            c: last.created_at,
            i: last.id,
          })
        : null,
      has_more: hasMore,
      applied_limit: appliedLimit,
    });
  }

  // PATCH /api/admin/users/:id/role
  // route-policy: admin.users.role.update
  if (
    pathname.startsWith("/api/admin/users/") &&
    pathname.endsWith("/role") &&
    method === "PATCH"
  ) {
    const result = await requireAdmin(request, env, { isSecure, correlationId });

    if (result instanceof Response) {
      return result;
    }

    const limited = await enforceAdminActionRateLimit(ctx);
    if (limited) return limited;

    const parts = pathname.split("/");
    // ["", "api", "admin", "users", ":id", "role"]
    const targetUserId = parts[4];

    if (!targetUserId || parts.length !== 6) {
      return json(
        { ok: false, error: "Invalid path." },
        { status: 400 }
      );
    }

    const parsed = await readJsonBodyOrResponse(request, { maxBytes: BODY_LIMITS.smallJson });
    if (parsed.response) return parsed.response;
    const body = parsed.body;

    if (!body) {
      return json(
        { ok: false, error: "Invalid JSON body." },
        { status: 400 }
      );
    }

    const newRole = body.role;

    if (newRole !== "user" && newRole !== "admin") {
      return json(
        { ok: false, error: "Invalid role. Allowed: \"user\" or \"admin\"." },
        { status: 400 }
      );
    }

    if (targetUserId === result.user.id && newRole !== "admin") {
      return json(
        { ok: false, error: "You cannot remove your own admin role." },
        { status: 400 }
      );
    }

    const targetUser = await env.DB.prepare(
      "SELECT id, email, role, status FROM users WHERE id = ? LIMIT 1"
    )
      .bind(targetUserId)
      .first();

    if (!targetUser) {
      return json(
        { ok: false, error: "User not found." },
        { status: 404 }
      );
    }
    if (targetUser.status === ADMIN_USER_DELETED_STATUS) {
      return json(
        { ok: false, error: "User not found." },
        { status: 404 }
      );
    }

    const now = nowIso();

    await env.DB.prepare(
      "UPDATE users SET role = ?, updated_at = ? WHERE id = ?"
    ).bind(newRole, now, targetUserId).run();

    await enqueueAdminAuditEvent(
      env,
      {
        adminUserId: result.user.id,
        action: "change_role",
        targetUserId,
        meta: {
          role: newRole,
          target_email: targetUser.email,
          target_role: targetUser.role,
          target_status: targetUser.status,
          actor_email: result.user.email,
        },
        createdAt: now,
      },
      {
        correlationId,
        requestInfo: ctx,
        allowDirectFallback: true,
      }
    );

    const updatedUser = await env.DB.prepare(
      "SELECT id, email, role, status, created_at, updated_at FROM users WHERE id = ? LIMIT 1"
    )
      .bind(targetUserId)
      .first();

    return json({
      ok: true,
      user: updatedUser,
    });
  }

  // PATCH /api/admin/users/:id/status
  // route-policy: admin.users.status.update
  if (
    pathname.startsWith("/api/admin/users/") &&
    pathname.endsWith("/status") &&
    method === "PATCH"
  ) {
    const result = await requireAdmin(request, env, { isSecure, correlationId });

    if (result instanceof Response) {
      return result;
    }

    const limited = await enforceAdminActionRateLimit(ctx);
    if (limited) return limited;

    const parts = pathname.split("/");
    // ["", "api", "admin", "users", ":id", "status"]
    const targetUserId = parts[4];

    if (!targetUserId || parts.length !== 6) {
      return json(
        { ok: false, error: "Invalid path." },
        { status: 400 }
      );
    }

    const parsed = await readJsonBodyOrResponse(request, { maxBytes: BODY_LIMITS.smallJson });
    if (parsed.response) return parsed.response;
    const body = parsed.body;

    if (!body) {
      return json(
        { ok: false, error: "Invalid JSON body." },
        { status: 400 }
      );
    }

    const newStatus = body.status;

    if (newStatus !== "active" && newStatus !== "disabled") {
      return json(
        { ok: false, error: "Invalid status. Allowed: \"active\" or \"disabled\"." },
        { status: 400 }
      );
    }

    if (targetUserId === result.user.id && newStatus === "disabled") {
      return json(
        { ok: false, error: "You cannot disable your own account." },
        { status: 400 }
      );
    }

    const targetUser = await env.DB.prepare(
      "SELECT id, email, role, status FROM users WHERE id = ? LIMIT 1"
    )
      .bind(targetUserId)
      .first();

    if (!targetUser) {
      return json(
        { ok: false, error: "User not found." },
        { status: 404 }
      );
    }

    const now = nowIso();

    await env.DB.prepare(
      "UPDATE users SET status = ?, updated_at = ? WHERE id = ?"
    ).bind(newStatus, now, targetUserId).run();

    await enqueueAdminAuditEvent(
      env,
      {
        adminUserId: result.user.id,
        action: "change_status",
        targetUserId,
        meta: {
          status: newStatus,
          target_email: targetUser.email,
          target_role: targetUser.role,
          target_status: targetUser.status,
          actor_email: result.user.email,
        },
        createdAt: now,
      },
      {
        correlationId,
        requestInfo: ctx,
        allowDirectFallback: true,
      }
    );

    const updatedUser = await env.DB.prepare(
      "SELECT id, email, role, status, created_at, updated_at FROM users WHERE id = ? LIMIT 1"
    )
      .bind(targetUserId)
      .first();

    return json({
      ok: true,
      user: updatedUser,
    });
  }

  // POST /api/admin/users/:id/revoke-sessions
  // route-policy: admin.users.sessions.revoke
  if (
    pathname.startsWith("/api/admin/users/") &&
    pathname.endsWith("/revoke-sessions") &&
    method === "POST"
  ) {
    const result = await requireAdmin(request, env, { isSecure, correlationId });

    if (result instanceof Response) {
      return result;
    }

    const limited = await enforceAdminActionRateLimit(ctx);
    if (limited) return limited;

    const parts = pathname.split("/");
    // ["", "api", "admin", "users", ":id", "revoke-sessions"]
    const targetUserId = parts[4];

    if (!targetUserId || parts.length !== 6) {
      return json(
        { ok: false, error: "Invalid path." },
        { status: 400 }
      );
    }

    if (targetUserId === result.user.id) {
      return json(
        { ok: false, error: "You cannot revoke your own sessions here." },
        { status: 400 }
      );
    }

    const parsed = await readJsonBodyOrResponse(request, { maxBytes: BODY_LIMITS.smallJson });
    if (parsed.response) return parsed.response;
    const confirmation = requireAdminMutationConfirmation(parsed.body, {
      confirmation: "revoke_sessions",
      code: "admin_revoke_sessions_confirmation_required",
      message: "Explicit confirmation is required before revoking all sessions for a user.",
    });
    if (confirmation) return confirmation;

    const targetUser = await env.DB.prepare(
      "SELECT id, email, role, status FROM users WHERE id = ? LIMIT 1"
    )
      .bind(targetUserId)
      .first();

    if (!targetUser) {
      return json(
        { ok: false, error: "User not found." },
        { status: 404 }
      );
    }

    const deleteResult = await env.DB.prepare(
      "DELETE FROM sessions WHERE user_id = ?"
    )
      .bind(targetUserId)
      .run();

    const now = nowIso();

    await enqueueAdminAuditEvent(
      env,
      {
        adminUserId: result.user.id,
        action: "revoke_sessions",
        targetUserId,
        meta: {
          revokedSessions: deleteResult.meta.changes,
          target_email: targetUser.email,
          target_role: targetUser.role,
          target_status: targetUser.status,
          actor_email: result.user.email,
        },
        createdAt: now,
      },
      {
        correlationId,
        requestInfo: ctx,
        allowDirectFallback: true,
      }
    );

    return json({
      ok: true,
      revokedSessions: deleteResult.meta.changes,
      targetUserId,
    });
  }

  // GET /api/admin/stats
  if (pathname === "/api/admin/stats" && method === "GET") {
    const result = await requireAdmin(request, env, { isSecure, correlationId });
    if (result instanceof Response) return result;

    const row = await env.DB.prepare(
      `SELECT
         COUNT(*) AS totalUsers,
         COALESCE(SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END), 0) AS admins,
         COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS activeUsers,
         COALESCE(SUM(CASE WHEN status = 'disabled' THEN 1 ELSE 0 END), 0) AS disabledUsers,
         COALESCE(SUM(CASE WHEN email_verified_at IS NOT NULL
                    AND (verification_method IS NULL OR verification_method != 'legacy_auto')
              THEN 1 ELSE 0 END), 0) AS verifiedUsers,
         COALESCE(SUM(CASE WHEN datetime(created_at) >= datetime('now', '-7 days')
              THEN 1 ELSE 0 END), 0) AS recentRegistrations
       FROM users
       WHERE status <> 'deleted'`
    ).first();

    return json({
      ok: true,
      stats: {
        totalUsers: row.totalUsers,
        admins: row.admins,
        activeUsers: row.activeUsers,
        disabledUsers: row.disabledUsers,
        verifiedUsers: row.verifiedUsers,
        recentRegistrations: row.recentRegistrations,
      },
    });
  }

  // GET /api/admin/avatars/latest
  if (pathname === "/api/admin/avatars/latest" && method === "GET") {
    const result = await requireAdmin(request, env, { isSecure, correlationId });
    if (result instanceof Response) return result;

    const rows = await env.DB.prepare(
      `SELECT u.id, u.email, p.display_name, p.avatar_updated_at
       FROM profiles p
       INNER JOIN users u ON u.id = p.user_id
       WHERE COALESCE(p.has_avatar, 0) = 1
         AND p.avatar_updated_at IS NOT NULL
       ORDER BY p.avatar_updated_at DESC, p.user_id DESC
       LIMIT 4`
    ).all();

    if (!(rows.results || []).length) {
      return json({ ok: true, avatars: [] });
    }

    const avatars = (rows.results || []).map((row) => ({
      userId: row.id,
      email: row.email || null,
      displayName: row.display_name || null,
      uploadedAt: row.avatar_updated_at,
    }));

    return json({ ok: true, avatars });
  }

  // GET /api/admin/avatars/:userId (serve image)
  if (
    pathname.startsWith("/api/admin/avatars/") &&
    method === "GET"
  ) {
    const result = await requireAdmin(request, env, { isSecure, correlationId });
    if (result instanceof Response) return result;

    const parts = pathname.split("/");
    const targetUserId = parts[4];

    if (!targetUserId || parts.length !== 5) {
      return json({ ok: false, error: "Invalid path." }, { status: 400 });
    }

    const object = await env.PRIVATE_MEDIA.get(`avatars/${targetUserId}`);
    if (!object) {
      return new Response(null, { status: 404 });
    }

    const headers = new Headers();
    headers.set(
      "Content-Type",
      object.httpMetadata?.contentType || "image/png"
    );
    if (object.size) headers.set("Content-Length", String(object.size));
    headers.set("Cache-Control", "private, no-store");
    headers.set("X-Content-Type-Options", "nosniff");

    return new Response(object.body, { headers });
  }

  // DELETE /api/admin/users/:id
  // route-policy: admin.users.delete
  if (
    pathname.startsWith("/api/admin/users/") &&
    method === "DELETE"
  ) {
    const result = await requireAdmin(request, env, { isSecure, correlationId });

    if (result instanceof Response) {
      return result;
    }

    const limited = await enforceAdminActionRateLimit(ctx);
    if (limited) return limited;

    const parts = pathname.split("/");
    // ["", "api", "admin", "users", ":id"]
    const targetUserId = parts[4];

    if (!targetUserId || parts.length !== 5) {
      return json(
        { ok: false, error: "Invalid path." },
        { status: 400 }
      );
    }

    if (targetUserId === result.user.id) {
      return json(
        { ok: false, error: "You cannot delete your own account." },
        { status: 400 }
      );
    }

    const parsed = await readJsonBodyOrResponse(request, {
      maxBytes: BODY_LIMITS.smallJson,
      requiredContentType: false,
    });
    if (parsed.response) return parsed.response;
    const confirmation = requireAdminMutationConfirmation(parsed.body, {
      confirmation: "delete_user",
      code: "admin_delete_user_confirmation_required",
      message: "Explicit confirmation is required before permanently deleting a user.",
    });
    if (confirmation) return confirmation;
    const erasureWorkflowRequest = normalizeAdminDeleteErasureWorkflow(parsed.body);
    if (erasureWorkflowRequest.response) return erasureWorkflowRequest.response;

    const targetUser = await env.DB.prepare(
      "SELECT id, email, role, status FROM users WHERE id = ? LIMIT 1"
    )
      .bind(targetUserId)
      .first();

    if (!targetUser) {
      return json(
        { ok: false, error: "User not found." },
        { status: 404 }
      );
    }

    const now = nowIso();
    let dataErasureWorkflow = adminDeleteErasureNotRequested();
    if (erasureWorkflowRequest.requested) {
      try {
        dataErasureWorkflow = await startAdminDeleteDataErasureWorkflow({
          env,
          adminUser: result.user,
          targetUser,
          workflow: erasureWorkflowRequest.workflow,
          now,
          correlationId,
          requestInfo: ctx,
        });
      } catch (error) {
        const isLifecycleError = error instanceof DataLifecycleError;
        return json(
          {
            ok: false,
            error: isLifecycleError
              ? error.message
              : "Failed to start Data Erasure workflow before operational deletion.",
            code: "admin_delete_user_erasure_workflow_failed",
            operationalDelete: {
              completed: false,
              status: "not_started",
            },
            dataErasureWorkflow: {
              started: false,
              status: "failed",
              errorCode: isLifecycleError ? error.code : "data_lifecycle_unavailable",
              requiresApproval: true,
              executesImmediately: false,
              evidenceRequired: true,
            },
          },
          { status: isLifecycleError ? error.status : 500 }
        );
      }
    }

    const dependencySummary = await buildAdminUserDeleteDependencySummary(env, targetUserId);
    const deletedEmail = safeDeletedEmailForUser(targetUserId);
    let aiDeletionSummary = null;
    try {
      aiDeletionSummary = await deleteAllUserAiAssets({
        env,
        userId: targetUserId,
        createdAt: now,
        additionalStatements: buildAdminUserOperationalDeleteStatements(env, {
          userId: targetUserId,
          deletedEmail,
          now,
          unavailable: dependencySummary.unavailable,
        }),
      });
    } catch (error) {
      if (!(error instanceof AiAssetLifecycleError)) {
        throw error;
      }
      return json(
        adminDeleteOperationalFailurePayload({
          error,
          dependencySummary,
          dataErasureWorkflow,
        }),
        { status: error.status }
      );
    }

    const anonymizedUser = await env.DB.prepare(
      "SELECT id, email, role, status FROM users WHERE id = ? LIMIT 1"
    ).bind(targetUserId).first();
    if (!anonymizedUser || anonymizedUser.status !== ADMIN_USER_DELETED_STATUS || anonymizedUser.email !== deletedEmail) {
      return json(
        {
          ok: false,
          error: "Operational user deletion did not reach the final account anonymization state.",
          code: "admin_delete_user_lifecycle_failed",
          branch: "user_anonymize_failed",
          operationalDelete: {
            completed: false,
            status: "failed",
            branch: "user_anonymize_failed",
          },
          dataErasureWorkflow,
          dependencySummary: {
            mode: dependencySummary.mode,
            blockingCategories: ["account_anonymization"],
            safeCounts: dependencySummary.safeCounts,
            unavailable: dependencySummary.unavailable,
          },
        },
        { status: 500 }
      );
    }

    // Avatar cleanup is best-effort because the destructive DB work already committed.
    let avatarCleanup = "best_effort_completed";
    try {
      await env.PRIVATE_MEDIA.delete(`avatars/${targetUserId}`);
    } catch (e) {
      avatarCleanup = "best_effort_failed";
      console.error("Admin delete: avatar cleanup failed", e);
    }

    await enqueueAdminAuditEvent(
      env,
      {
        adminUserId: result.user.id,
        action: "operational_delete_user",
        targetUserId,
        meta: {
          deletedUserId: targetUserId,
          deletion_mode: "operational_anonymized_delete",
          target_email: targetUser.email,
          target_role: targetUser.role,
          target_status: targetUser.status,
          actor_email: result.user.email,
          retained_policy_records: dependencySummary.retainedPolicyRecords,
          data_erasure_workflow_requested: dataErasureWorkflow.started === true,
          data_erasure_workflow_request_id: dataErasureWorkflow.requestId || null,
        },
        createdAt: now,
      },
      {
        correlationId,
        requestInfo: ctx,
        allowDirectFallback: true,
      }
    );

    return json({
      ok: true,
      deletedUserId: targetUserId,
      deletionMode: dataErasureWorkflow.started
        ? "operational_delete_with_erasure_workflow"
        : "operational_delete",
      operationalDelete: {
        completed: true,
        deletedUserId: targetUserId,
        deletionMode: "operational_anonymized_delete",
        deletionScope: {
          accountDeletedOrAnonymized: true,
          loginDisabled: true,
          sessionsDeleted: true,
          tokensDeleted: true,
          profileDeleted: true,
          aiAssetsDeleted: {
            images: aiDeletionSummary?.deletedAiImagesCount ?? 0,
            textAssets: aiDeletionSummary?.deletedAiTextAssetsCount ?? 0,
            folders: aiDeletionSummary?.deletedAiFoldersCount ?? null,
            cleanupObjectsQueued: aiDeletionSummary?.cleanupObjectsQueuedCount ?? 0,
          },
          aiFoldersDeleted: true,
          storageQuotaCleaned: true,
          avatarCleanup,
          retainedPolicyRecords: dependencySummary.retainedPolicyRecords,
        },
      },
      dataErasureWorkflow,
      deletionScope: {
        accountDeletedOrAnonymized: true,
        loginDisabled: true,
        sessionsDeleted: true,
        tokensDeleted: true,
        profileDeleted: true,
        aiAssetsDeleted: {
          images: aiDeletionSummary?.deletedAiImagesCount ?? 0,
          textAssets: aiDeletionSummary?.deletedAiTextAssetsCount ?? 0,
          folders: aiDeletionSummary?.deletedAiFoldersCount ?? null,
          cleanupObjectsQueued: aiDeletionSummary?.cleanupObjectsQueuedCount ?? 0,
        },
        aiFoldersDeleted: true,
        storageQuotaCleaned: true,
        avatarCleanup,
        retainedPolicyRecords: dependencySummary.retainedPolicyRecords,
      },
    });
  }

  // GET /api/admin/activity
  if (pathname === "/api/admin/activity" && method === "GET") {
    const result = await requireAdmin(request, env, { isSecure, correlationId });
    if (result instanceof Response) return result;

    const limit = resolvePaginationLimit(url.searchParams.get("limit"), {
      defaultValue: DEFAULT_ADMIN_ACTIVITY_LIMIT,
      maxValue: MAX_ADMIN_ACTIVITY_LIMIT,
    });
    const cursorParam = url.searchParams.get("cursor") || null;
    const search = normalizeActivitySearchTerm(url.searchParams.get("search"));
    const filterHash = await buildActivitySearchFilterHash(ADMIN_AUDIT_LOG_TABLE, search);
    const cutoffIso = getActivityRetentionCutoff();

    const cursorResult = await decodeActivityCursorOrResponse(
      env,
      cursorParam,
      ADMIN_ACTIVITY_CURSOR_TYPE,
      filterHash
    );
    if (cursorResult.response) return cursorResult.response;
    const cursor = cursorResult.cursor;

    const entriesQuery = (() => {
      const conditions = [];
      const bindings = [];

      if (search) {
        conditions.push(`idx.source_table = '${ADMIN_AUDIT_LOG_TABLE}'`);
        appendActivityCursorCondition(conditions, bindings, cursor, {
          createdColumn: "idx.created_at",
          idColumn: "idx.source_event_id",
        });
        appendActivitySearchConditions(conditions, bindings, search);
        return env.DB.prepare(
          `SELECT a.id, a.action, a.meta_json, a.created_at,
                  a.admin_user_id, COALESCE(au.email, idx.actor_email_norm) AS admin_email,
                  a.target_user_id, COALESCE(tu.email, idx.target_email_norm) AS target_email
           FROM activity_search_index idx
           JOIN admin_audit_log a ON a.id = idx.source_event_id
           LEFT JOIN users au ON au.id = a.admin_user_id
           LEFT JOIN users tu ON tu.id = a.target_user_id
           WHERE ${conditions.join(" AND ")}
           ORDER BY idx.created_at DESC, idx.source_event_id DESC
           LIMIT ?`
        ).bind(...bindings, limit + 1);
      }

      appendActivityCursorCondition(conditions, bindings, cursor, {
        createdColumn: "a.created_at",
        idColumn: "a.id",
      });
      const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      return env.DB.prepare(
        `SELECT a.id, a.action, a.meta_json, a.created_at,
                a.admin_user_id, COALESCE(au.email, idx.actor_email_norm) AS admin_email,
                a.target_user_id, COALESCE(tu.email, idx.target_email_norm) AS target_email
         FROM admin_audit_log a
         LEFT JOIN activity_search_index idx
           ON idx.source_table = 'admin_audit_log'
          AND idx.source_event_id = a.id
         LEFT JOIN users au ON au.id = a.admin_user_id
         LEFT JOIN users tu ON tu.id = a.target_user_id
         ${whereClause}
         ORDER BY a.created_at DESC, a.id DESC
         LIMIT ?`
      ).bind(...bindings, limit + 1);
    })();

    const [entriesRes, countsRes] = await env.DB.batch([
      entriesQuery,
      env.DB.prepare(
        `SELECT action, COUNT(*) AS cnt
         FROM admin_audit_log
         WHERE created_at >= ?
         GROUP BY action`
      ).bind(cutoffIso),
    ]);

    const rows = entriesRes.results || [];
    const hasMore = rows.length > limit;
    const entries = (hasMore ? rows.slice(0, limit) : rows)
      .map((entry) => normalizeActivityEntry(entry, "admin_email", "target_email"));

    let nextCursor = null;
    if (hasMore && entries.length > 0) {
      const last = entries[entries.length - 1];
      nextCursor = await encodeActivityCursor(env, ADMIN_ACTIVITY_CURSOR_TYPE, filterHash, last);
    }

    const counts = {};
    for (const row of countsRes.results || []) {
      counts[row.action] = row.cnt;
    }

    return json({
      ok: true,
      entries,
      nextCursor,
      counts,
      searchMode: search ? "indexed_prefix" : "recent",
      ...getActivityRetentionMetadata(),
    });
  }

  // GET /api/admin/user-activity
  if (pathname === "/api/admin/user-activity" && method === "GET") {
    const result = await requireAdmin(request, env, { isSecure, correlationId });
    if (result instanceof Response) return result;

    const limit = resolvePaginationLimit(url.searchParams.get("limit"), {
      defaultValue: DEFAULT_ADMIN_ACTIVITY_LIMIT,
      maxValue: MAX_ADMIN_ACTIVITY_LIMIT,
    });
    const cursorParam = url.searchParams.get("cursor") || null;
    const search = normalizeActivitySearchTerm(url.searchParams.get("search"));
    const filterHash = await buildActivitySearchFilterHash(USER_ACTIVITY_LOG_TABLE, search);

    const cursorResult = await decodeActivityCursorOrResponse(
      env,
      cursorParam,
      ADMIN_USER_ACTIVITY_CURSOR_TYPE,
      filterHash
    );
    if (cursorResult.response) return cursorResult.response;
    const cursor = cursorResult.cursor;

    let entriesRes;
    try {
      const conditions = [];
      const bindings = [];
      let entriesQuery;

      if (search) {
        conditions.push(`idx.source_table = '${USER_ACTIVITY_LOG_TABLE}'`);
        appendActivityCursorCondition(conditions, bindings, cursor, {
          createdColumn: "idx.created_at",
          idColumn: "idx.source_event_id",
        });
        appendActivitySearchConditions(conditions, bindings, search);
        entriesQuery = env.DB.prepare(
          `SELECT a.id, a.user_id, a.action, a.meta_json, a.ip_address, a.created_at,
                  COALESCE(u.email, idx.actor_email_norm) AS user_email
           FROM activity_search_index idx
           JOIN user_activity_log a ON a.id = idx.source_event_id
           LEFT JOIN users u ON u.id = a.user_id
           WHERE ${conditions.join(" AND ")}
           ORDER BY idx.created_at DESC, idx.source_event_id DESC
           LIMIT ?`
        ).bind(...bindings, limit + 1);
      } else {
        appendActivityCursorCondition(conditions, bindings, cursor, {
          createdColumn: "a.created_at",
          idColumn: "a.id",
        });
        const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        entriesQuery = env.DB.prepare(
          `SELECT a.id, a.user_id, a.action, a.meta_json, a.ip_address, a.created_at,
                  COALESCE(u.email, idx.actor_email_norm) AS user_email
           FROM user_activity_log a
           LEFT JOIN activity_search_index idx
             ON idx.source_table = 'user_activity_log'
            AND idx.source_event_id = a.id
           LEFT JOIN users u ON u.id = a.user_id
           ${whereClause}
           ORDER BY a.created_at DESC, a.id DESC
           LIMIT ?`
        ).bind(...bindings, limit + 1);
      }

      entriesRes = await entriesQuery.all();
    } catch (e) {
      // Graceful degradation if migration 0012 has not been applied
      if (String(e).includes("no such table")) {
        return json({
          ok: true,
          entries: [],
          nextCursor: null,
          unavailable: true,
          reason: "User activity logging not yet configured. Run migration 0012.",
          ...getActivityRetentionMetadata(),
        });
      }
      throw e;
    }

    const rows = entriesRes.results || [];
    const hasMore = rows.length > limit;
    const entries = (hasMore ? rows.slice(0, limit) : rows)
      .map((entry) => normalizeActivityEntry(entry, "user_email"));

    let nextCursor = null;
    if (hasMore && entries.length > 0) {
      const last = entries[entries.length - 1];
      nextCursor = await encodeActivityCursor(env, ADMIN_USER_ACTIVITY_CURSOR_TYPE, filterHash, last);
    }

    return json({
      ok: true,
      entries,
      nextCursor,
      searchMode: search ? "indexed_prefix" : "recent",
      ...getActivityRetentionMetadata(),
    });
  }

  return null;
}
