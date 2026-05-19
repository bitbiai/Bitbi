import { json } from "../lib/response.js";
import {
  BODY_LIMITS,
  readJsonBodyOrResponse,
} from "../lib/request.js";
import { requireAdmin } from "../lib/session.js";
import { enqueueAdminAuditEvent } from "../lib/activity.js";
import {
  evaluateSharedRateLimit,
  getClientIp,
  rateLimitResponse,
  rateLimitUnavailableResponse,
  sensitiveRateLimitOptions,
} from "../lib/rate-limit.js";
import {
  DataLifecycleError,
  approveDataLifecycleRequest,
  createDataLifecycleRequest,
  dataLifecycleErrorResponse,
  executeSafeDataLifecycleActions,
  getDataLifecycleRequest,
  listDataLifecycleRequests,
  normalizeDataLifecycleIdempotencyKey,
  planDataLifecycleRequest,
  requireDataLifecycleConfirmation,
} from "../lib/data-lifecycle.js";
import {
  DATA_EXPORT_ARCHIVE_CURSOR_TYPE,
  DATA_EXPORT_ARCHIVE_CONTENT_TYPE,
  generateDataExportArchive,
  getDataExportArchiveForRequest,
  listDataExportArchives,
  readDataExportArchive,
} from "../lib/data-export-archive.js";
import { cleanupExpiredDataExportArchives } from "../lib/data-export-cleanup.js";
import {
  decodePaginationCursor,
  encodePaginationCursor,
  paginationErrorResponse,
  readCursorInteger,
  readCursorString,
  resolvePaginationLimit,
} from "../lib/pagination.js";

const DATA_EXPORT_ARCHIVE_CURSOR_TTL_MS = 60 * 60 * 1000;
const DEFAULT_EXPORT_ARCHIVE_LIMIT = 50;
const MAX_EXPORT_ARCHIVE_LIMIT = 100;

async function enforceDataLifecycleRateLimit(ctx) {
  const { request, env, pathname, method, correlationId } = ctx;
  const result = await evaluateSharedRateLimit(
    env,
    "admin-data-lifecycle-ip",
    getClientIp(request),
    20,
    900_000,
    sensitiveRateLimitOptions({
      component: "admin-data-lifecycle",
      correlationId,
      requestInfo: { request, pathname, method },
    })
  );
  if (result.unavailable) return rateLimitUnavailableResponse(correlationId);
  if (result.limited) return rateLimitResponse();
  return null;
}

function lifecycleJson(payload, init) {
  return json(payload, init);
}

function lifecycleError(error) {
  if (error instanceof DataLifecycleError) {
    const payload = dataLifecycleErrorResponse(error);
    const { status, ...body } = payload;
    return lifecycleJson(body, { status });
  }
  throw error;
}

function decodePathId(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new DataLifecycleError("Invalid request path.", {
      status: 400,
      code: "invalid_path",
    });
  }
}

function normalizeEvidenceFormat(value) {
  const format = String(value || "json").trim().toLowerCase();
  if (format === "md") return "markdown";
  if (["json", "markdown", "html"].includes(format)) return format;
  return "json";
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item) || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function planCategoryForAction(action) {
  const value = String(action || "").toLowerCase();
  if (["delete", "delete_planned", "revoke", "expire_or_delete", "expire"].includes(value)) {
    return "deleteOrExpire";
  }
  if (["anonymize", "retain_or_anonymize", "retain_or_rekey"].includes(value)) {
    return "anonymizeOrRekey";
  }
  if (["retain", "export_reference"].includes(value)) {
    return "retained";
  }
  if (["manual_review_required"].includes(value)) {
    return "manualReviewRequired";
  }
  if (["export"].includes(value)) {
    return "export";
  }
  return "other";
}

function buildLifecyclePlanSummary(items = []) {
  const boundedItems = Array.isArray(items) ? items.slice(0, 500) : [];
  const byPlanCategory = countBy(boundedItems, (item) => planCategoryForAction(item.action));
  const retainedCategories = Array.from(new Set(boundedItems
    .filter((item) => ["retained", "anonymizeOrRekey"].includes(planCategoryForAction(item.action)))
    .map((item) => item.tableName || item.resourceType || "unknown")
    .filter(Boolean)))
    .sort();
  const blockedItems = boundedItems.filter((item) => item.status === "blocked");
  const manualReviewItems = boundedItems.filter((item) => planCategoryForAction(item.action) === "manualReviewRequired");
  return {
    itemCount: boundedItems.length,
    itemLimitApplied: boundedItems.length !== (Array.isArray(items) ? items.length : 0),
    byAction: countBy(boundedItems, (item) => item.action),
    byStatus: countBy(boundedItems, (item) => item.status),
    byResourceType: countBy(boundedItems, (item) => item.resourceType),
    byTable: countBy(boundedItems.filter((item) => item.tableName), (item) => item.tableName),
    byPlanCategory,
    recordsToDeleteOrExpire: byPlanCategory.deleteOrExpire || 0,
    recordsToAnonymizeOrRekey: byPlanCategory.anonymizeOrRekey || 0,
    recordsRetainedUnderPolicy: byPlanCategory.retained || 0,
    recordsExportedOrReferenced: byPlanCategory.export || 0,
    manualReviewRequired: manualReviewItems.length,
    blockedItemCount: blockedItems.length,
    retainedPolicyCategories: retainedCategories,
    unsafeOrMissingDataWarnings: blockedItems.length > 0
      ? ["blocked_items_require_manual_review"]
      : [],
    evidenceRequired: true,
    rawPrivateKeysIncluded: false,
    rawSecretsIncluded: false,
  };
}

function buildLifecycleAvailableActions(request, items = []) {
  const status = request?.status || "unknown";
  const hasPlan = Array.isArray(items) && items.length > 0;
  const hasBlockedItems = items.some((item) => item.status === "blocked");
  const planned = status === "planned";
  const approved = status === "approved";
  const safeActionsCompleted = status === "safe_actions_completed";
  const exportRequest = request?.type === "export";
  return {
    viewDetails: { available: true },
    generatePlan: {
      available: status === "submitted" || status === "planned" || status === "blocked",
      disabledReason: safeActionsCompleted ? "Safe actions already completed." : null,
      mutatesPlanStateOnly: true,
    },
    approve: {
      available: planned && hasPlan && !hasBlockedItems,
      disabledReason: planned
        ? (hasPlan ? (hasBlockedItems ? "Blocked plan items require manual review." : null) : "Plan has no items yet.")
        : "Request must be planned before approval.",
      requiresConfirmation: true,
      executesDataDeletion: false,
    },
    executeSafeDryRun: {
      available: approved || safeActionsCompleted,
      disabledReason: approved || safeActionsCompleted ? null : "Request must be approved before safe execution dry-run.",
      requiresIdempotencyKey: true,
      dryRun: true,
      executesIrreversibleDeletion: false,
    },
    executeSafe: {
      available: approved,
      disabledReason: approved ? null : "Request must be approved before safe execution.",
      requiresConfirmation: true,
      requiresIdempotencyKey: true,
      destructiveModesBlocked: true,
      note: "Safe execution can revoke sessions and expire eligible tokens/archives. It does not perform broad billing, audit, legal, or provider-evidence deletion.",
    },
    generatePrivateArchive: {
      available: exportRequest && (approved || safeActionsCompleted),
      disabledReason: exportRequest ? "Export request must be approved before archive generation." : "Only export requests can generate private archives.",
      requiresConfirmation: true,
      requiresIdempotencyKey: true,
    },
    exportEvidence: { available: true, formats: ["json", "markdown", "html"] },
    markCompleted: {
      available: false,
      disabledReason: "Manual completion/evidence status is not represented by the current lifecycle schema.",
    },
    rejectOrClose: {
      available: false,
      disabledReason: "Rejected/closed lifecycle statuses are not represented by the current lifecycle schema.",
      deletesData: false,
    },
  };
}

function buildLifecycleEvidencePacket(detail, { generatedAt = new Date().toISOString() } = {}) {
  const request = detail.request || {};
  const items = Array.isArray(detail.items) ? detail.items : [];
  const planSummary = buildLifecyclePlanSummary(items);
  const userItem = items.find((item) => item.resourceType === "user");
  const userSummary = userItem?.summary || {};
  const completedClaimed = request.status === "safe_actions_completed" && planSummary.blockedItemCount === 0;
  return {
    title: "BITBI Data Lifecycle Evidence Packet",
    generatedAt,
    request: {
      id: request.id,
      type: request.type,
      status: request.status,
      dryRun: request.dryRun === true,
      subjectUserId: request.subjectUserId,
      reason: request.reason || null,
      requestedByUserId: request.requestedByUserId || null,
      requestedByAdminId: request.requestedByAdminId || null,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
      expiresAt: request.expiresAt || null,
      completedAt: request.completedAt || null,
      errorCode: request.errorCode || null,
      errorMessage: request.errorMessage || null,
    },
    subjectSnapshot: {
      userId: request.subjectUserId,
      email: typeof userSummary.email === "string" ? userSummary.email : null,
      role: typeof userSummary.role === "string" ? userSummary.role : null,
      status: typeof userSummary.status === "string" ? userSummary.status : null,
      source: userItem ? "plan_user_item" : "request_subject",
    },
    lifecycleState: {
      currentStatus: request.status,
      dryRun: request.dryRun === true,
      approvalRequired: request.approvalRequired === true,
      approved: Boolean(request.approvedAt),
      approvedByAdminId: request.approvedByAdminId || null,
      approvedAt: request.approvedAt || null,
      safeActionsCompleted: request.status === "safe_actions_completed",
      evidenceState: completedClaimed ? "safe_actions_completed_evidence_available" : "evidence_pending_or_partial",
      noLegalCompletionClaim: !completedClaimed,
    },
    planSummary,
    availableActions: buildLifecycleAvailableActions(request, items),
    itemPreview: items.slice(0, 25).map((item) => ({
      id: item.id,
      resourceType: item.resourceType,
      tableName: item.tableName || null,
      action: item.action,
      status: item.status,
      storageReference: item.storageReference ? {
        bucket: item.storageReference.bucket || item.r2Bucket || null,
        keyClass: item.storageReference.keyClass || null,
        internalKeyIncluded: false,
      } : null,
    })),
    retainedPolicyCategories: Array.from(new Set([
      ...planSummary.retainedPolicyCategories,
      "admin_audit_log",
      "billing_ledger",
      "provider_evidence",
      "legal_compliance_records",
    ])).sort(),
    pendingActions: [
      request.status === "submitted" ? "generate_plan" : null,
      request.status === "planned" ? "approve_request" : null,
      request.status === "approved" ? "execute_safe_or_export_evidence" : null,
      completedClaimed ? null : "review_evidence_before_legal_completion_claim",
    ].filter(Boolean),
    redaction: {
      privateR2KeysRendered: false,
      rawStripePayloadsRendered: false,
      secretsRendered: false,
      cookiesRendered: false,
      authHeadersRendered: false,
      rawIdempotencyKeysRendered: false,
      rawRequestHashesRendered: false,
    },
    legalCaveat: "This evidence packet documents current BITBI data lifecycle state. It is not legal advice, does not prove production readiness, and does not claim full legal/GDPR completion unless the request status and recorded evidence show completion.",
    blockedClaims: {
      productionReadiness: "blocked",
      liveBillingReadiness: "blocked",
      tenantIsolation: "not_claimed",
      ownershipBackfillReadiness: "blocked",
      accessSwitchReadiness: "blocked",
      confirmedLegacyMediaResetReadiness: "blocked",
    },
  };
}

function evidenceHeaders(contentType) {
  return {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  };
}

function markdownList(values) {
  const items = Array.isArray(values) ? values.filter(Boolean) : [];
  if (!items.length) return "- None recorded";
  return items.map((value) => `- ${String(value)}`).join("\n");
}

function renderEvidenceMarkdown(packet) {
  const request = packet.request;
  const state = packet.lifecycleState;
  const plan = packet.planSummary;
  return [
    `# ${packet.title}`,
    "",
    `Generated: ${packet.generatedAt}`,
    "",
    "## Request",
    "",
    `- Request ID: ${request.id}`,
    `- Type: ${request.type}`,
    `- Status: ${request.status}`,
    `- Dry-run: ${request.dryRun ? "yes" : "no"}`,
    `- Subject user ID: ${request.subjectUserId}`,
    `- Created: ${request.createdAt}`,
    `- Expires: ${request.expiresAt || "not set"}`,
    `- Reason: ${request.reason || "not recorded"}`,
    "",
    "## Lifecycle State",
    "",
    `- Approval required: ${state.approvalRequired ? "yes" : "no"}`,
    `- Approved: ${state.approved ? "yes" : "no"}`,
    `- Safe actions completed: ${state.safeActionsCompleted ? "yes" : "no"}`,
    `- Evidence state: ${state.evidenceState}`,
    `- No legal completion claim: ${state.noLegalCompletionClaim ? "yes" : "no"}`,
    "",
    "## Plan Summary",
    "",
    `- Items: ${plan.itemCount}`,
    `- Delete/expire actions: ${plan.recordsToDeleteOrExpire}`,
    `- Anonymize/rekey actions: ${plan.recordsToAnonymizeOrRekey}`,
    `- Retained policy records: ${plan.recordsRetainedUnderPolicy}`,
    `- Blocked items: ${plan.blockedItemCount}`,
    `- Manual review required: ${plan.manualReviewRequired}`,
    "",
    "## Retained Policy Categories",
    "",
    markdownList(packet.retainedPolicyCategories),
    "",
    "## Pending Actions",
    "",
    markdownList(packet.pendingActions),
    "",
    "## Redaction Guarantees",
    "",
    markdownList(Object.entries(packet.redaction).map(([key, value]) => `${key}: ${value}`)),
    "",
    "## Legal Caveat",
    "",
    packet.legalCaveat,
    "",
  ].join("\n");
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function htmlRows(entries) {
  return entries.map(([name, value]) => (
    `<tr><th>${escapeHtml(name)}</th><td>${escapeHtml(value)}</td></tr>`
  )).join("");
}

function htmlList(values) {
  const items = Array.isArray(values) ? values.filter(Boolean) : [];
  if (!items.length) return "<p>None recorded.</p>";
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderEvidenceHtml(packet) {
  const request = packet.request;
  const state = packet.lifecycleState;
  const plan = packet.planSummary;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(packet.title)} - ${escapeHtml(request.id)}</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #151515; background: #fff; }
    body { margin: 32px; line-height: 1.45; }
    h1, h2 { margin: 0 0 12px; }
    h2 { margin-top: 28px; font-size: 1.15rem; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0 20px; }
    th, td { text-align: left; vertical-align: top; border: 1px solid #d9d9d9; padding: 8px 10px; }
    th { width: 32%; background: #f5f5f5; }
    .notice { border: 1px solid #222; padding: 12px 14px; margin: 18px 0; }
    @media print { body { margin: 18mm; } .notice { break-inside: avoid; } }
  </style>
</head>
<body>
  <h1>${escapeHtml(packet.title)}</h1>
  <p>Generated: ${escapeHtml(packet.generatedAt)}</p>
  <p>PDF-friendly storage: use browser print or Save as PDF. No binary PDF is generated by this endpoint.</p>
  <div class="notice">${escapeHtml(packet.legalCaveat)}</div>
  <h2>Request</h2>
  <table><tbody>${htmlRows([
    ["Request ID", request.id],
    ["Type", request.type],
    ["Status", request.status],
    ["Dry-run", request.dryRun ? "yes" : "no"],
    ["Subject user ID", request.subjectUserId],
    ["Created", request.createdAt],
    ["Expires", request.expiresAt || "not set"],
    ["Reason", request.reason || "not recorded"],
  ])}</tbody></table>
  <h2>Lifecycle State</h2>
  <table><tbody>${htmlRows([
    ["Approval required", state.approvalRequired ? "yes" : "no"],
    ["Approved", state.approved ? "yes" : "no"],
    ["Safe actions completed", state.safeActionsCompleted ? "yes" : "no"],
    ["Evidence state", state.evidenceState],
    ["No legal completion claim", state.noLegalCompletionClaim ? "yes" : "no"],
  ])}</tbody></table>
  <h2>Plan Summary</h2>
  <table><tbody>${htmlRows([
    ["Items", plan.itemCount],
    ["Delete/expire actions", plan.recordsToDeleteOrExpire],
    ["Anonymize/rekey actions", plan.recordsToAnonymizeOrRekey],
    ["Retained policy records", plan.recordsRetainedUnderPolicy],
    ["Blocked items", plan.blockedItemCount],
    ["Manual review required", plan.manualReviewRequired],
  ])}</tbody></table>
  <h2>Retained Policy Categories</h2>
  ${htmlList(packet.retainedPolicyCategories)}
  <h2>Pending Actions</h2>
  ${htmlList(packet.pendingActions)}
  <h2>Redaction Guarantees</h2>
  ${htmlList(Object.entries(packet.redaction).map(([key, value]) => `${key}: ${value}`))}
</body>
</html>`;
}

async function decodeArchiveCursorOrResponse(env, cursorParam) {
  if (!cursorParam) return { cursor: null };
  try {
    const decoded = await decodePaginationCursor(env, cursorParam, DATA_EXPORT_ARCHIVE_CURSOR_TYPE);
    const cursor = {
      createdAt: readCursorString(decoded, "c"),
      id: readCursorString(decoded, "i"),
      exp: readCursorInteger(decoded, "exp", { min: 1 }),
    };
    if (cursor.exp <= Date.now()) {
      return { response: paginationErrorResponse("Invalid cursor.") };
    }
    return { cursor };
  } catch {
    return { response: paginationErrorResponse("Invalid cursor.") };
  }
}

async function encodeArchiveCursor(env, last) {
  return encodePaginationCursor(env, DATA_EXPORT_ARCHIVE_CURSOR_TYPE, {
    c: last.created_at,
    i: last.id,
    exp: Date.now() + DATA_EXPORT_ARCHIVE_CURSOR_TTL_MS,
  });
}

async function requireLifecycleAdmin(ctx) {
  const result = await requireAdmin(ctx.request, ctx.env, {
    isSecure: ctx.isSecure,
    correlationId: ctx.correlationId,
  });
  return result;
}

async function auditLifecycleEvent(ctx, adminUser, action, targetUserId, meta = {}) {
  await enqueueAdminAuditEvent(
    ctx.env,
    {
      adminUserId: adminUser.id,
      action,
      targetUserId,
      meta: {
        ...meta,
        actor_email: adminUser.email,
      },
    },
    {
      correlationId: ctx.correlationId,
      requestInfo: ctx,
      allowDirectFallback: true,
    }
  );
}

export async function handleAdminDataLifecycle(ctx) {
  const { request, url, pathname, method } = ctx;
  if (!pathname.startsWith("/api/admin/data-lifecycle/")) {
    return null;
  }

  const admin = await requireLifecycleAdmin(ctx);
  if (admin instanceof Response) return admin;

  const limited = await enforceDataLifecycleRateLimit(ctx);
  if (limited) return limited;

  // GET /api/admin/data-lifecycle/requests
  if (pathname === "/api/admin/data-lifecycle/requests" && method === "GET") {
    try {
      const result = await listDataLifecycleRequests(ctx.env, {
        limit: url.searchParams.get("limit"),
      });
      return lifecycleJson({ ok: true, ...result });
    } catch (error) {
      return lifecycleError(error);
    }
  }

  // GET /api/admin/data-lifecycle/exports
  if (pathname === "/api/admin/data-lifecycle/exports" && method === "GET") {
    try {
      const decoded = await decodeArchiveCursorOrResponse(ctx.env, url.searchParams.get("cursor"));
      if (decoded.response) return decoded.response;
      const result = await listDataExportArchives(ctx.env, {
        limit: resolvePaginationLimit(url.searchParams.get("limit"), {
          defaultValue: DEFAULT_EXPORT_ARCHIVE_LIMIT,
          maxValue: MAX_EXPORT_ARCHIVE_LIMIT,
        }),
        cursor: decoded.cursor,
      });
      const nextCursor = result.hasMore && result.last
        ? await encodeArchiveCursor(ctx.env, result.last)
        : null;
      const { last: _ignoredLast, ...safeResult } = result;
      return lifecycleJson({ ok: true, ...safeResult, nextCursor });
    } catch (error) {
      return lifecycleError(error);
    }
  }

  // POST /api/admin/data-lifecycle/exports/cleanup-expired
  // route-policy: admin.data-lifecycle.exports.cleanup-expired
  if (pathname === "/api/admin/data-lifecycle/exports/cleanup-expired" && method === "POST") {
    try {
      normalizeDataLifecycleIdempotencyKey(request.headers.get("Idempotency-Key"));
      const parsed = await readJsonBodyOrResponse(request, {
        maxBytes: BODY_LIMITS.smallJson,
      });
      if (parsed.response) return parsed.response;
      requireDataLifecycleConfirmation(parsed.body, {
        message: "Explicit confirmation is required before cleaning up expired data export archives.",
        code: "archive_cleanup_confirmation_required",
      });
      const result = await cleanupExpiredDataExportArchives({
        env: ctx.env,
        limit: parsed.body?.limit,
      });
      await auditLifecycleEvent(
        ctx,
        admin.user,
        "data_lifecycle_export_archive_cleanup_completed",
        null,
        {
          scanned_count: result.scannedCount,
          deleted_count: result.deletedCount,
          missing_count: result.missingCount,
          failed_count: result.failedCount,
          skipped_count: result.skippedCount,
        }
      );
      return lifecycleJson({ ok: true, cleanup: result });
    } catch (error) {
      return lifecycleError(error);
    }
  }

  // POST /api/admin/data-lifecycle/requests
  // route-policy: admin.data-lifecycle.requests.create
  if (pathname === "/api/admin/data-lifecycle/requests" && method === "POST") {
    try {
      const idempotencyKey = normalizeDataLifecycleIdempotencyKey(
        request.headers.get("Idempotency-Key")
      );
      const parsed = await readJsonBodyOrResponse(request, {
        maxBytes: BODY_LIMITS.adminJson,
      });
      if (parsed.response) return parsed.response;
      const result = await createDataLifecycleRequest({
        env: ctx.env,
        adminUser: admin.user,
        body: parsed.body,
        idempotencyKey,
      });
      await auditLifecycleEvent(
        ctx,
        admin.user,
        "data_lifecycle_request_created",
        result.request.subjectUserId,
        {
          request_id: result.request.id,
          request_type: result.request.type,
          dry_run: result.request.dryRun,
          reused: result.reused,
        }
      );
      return lifecycleJson({ ok: true, ...result }, { status: result.reused ? 200 : 201 });
    } catch (error) {
      return lifecycleError(error);
    }
  }

  const detailMatch = pathname.match(/^\/api\/admin\/data-lifecycle\/requests\/([^/]+)$/);
  // GET /api/admin/data-lifecycle/requests/:id
  if (detailMatch && method === "GET") {
    try {
      const result = await getDataLifecycleRequest(ctx.env, decodePathId(detailMatch[1]));
      return lifecycleJson({ ok: true, ...result });
    } catch (error) {
      return lifecycleError(error);
    }
  }

  const evidenceMatch = pathname.match(/^\/api\/admin\/data-lifecycle\/requests\/([^/]+)\/evidence$/);
  // GET /api/admin/data-lifecycle/requests/:id/evidence
  // route-policy: admin.data-lifecycle.requests.evidence
  if (evidenceMatch && method === "GET") {
    try {
      const detail = await getDataLifecycleRequest(ctx.env, decodePathId(evidenceMatch[1]));
      const packet = buildLifecycleEvidencePacket(detail);
      const format = normalizeEvidenceFormat(url.searchParams.get("format"));
      if (format === "markdown") {
        return new Response(renderEvidenceMarkdown(packet), {
          status: 200,
          headers: evidenceHeaders("text/markdown; charset=utf-8"),
        });
      }
      if (format === "html") {
        return new Response(renderEvidenceHtml(packet), {
          status: 200,
          headers: evidenceHeaders("text/html; charset=utf-8"),
        });
      }
      return new Response(JSON.stringify({ ok: true, evidence: packet }, null, 2), {
        status: 200,
        headers: evidenceHeaders("application/json; charset=utf-8"),
      });
    } catch (error) {
      return lifecycleError(error);
    }
  }

  const generateExportMatch = pathname.match(/^\/api\/admin\/data-lifecycle\/requests\/([^/]+)\/generate-export$/);
  // POST /api/admin/data-lifecycle/requests/:id/generate-export
  // route-policy: admin.data-lifecycle.requests.generate-export
  if (generateExportMatch && method === "POST") {
    try {
      normalizeDataLifecycleIdempotencyKey(request.headers.get("Idempotency-Key"));
      const parsed = await readJsonBodyOrResponse(request, {
        maxBytes: BODY_LIMITS.smallJson,
      });
      if (parsed.response) return parsed.response;
      requireDataLifecycleConfirmation(parsed.body, {
        message: "Explicit confirmation is required before generating a private data export archive.",
        code: "export_archive_confirmation_required",
      });
      const result = await generateDataExportArchive({
        env: ctx.env,
        requestId: decodePathId(generateExportMatch[1]),
      });
      await auditLifecycleEvent(
        ctx,
        admin.user,
        "data_lifecycle_export_archive_generated",
        result.archive.subjectUserId,
        {
          request_id: result.archive.requestId,
          archive_id: result.archive.id,
          size_bytes: result.archive.sizeBytes,
          reused: result.reused,
        }
      );
      return lifecycleJson({ ok: true, ...result }, { status: result.reused ? 200 : 201 });
    } catch (error) {
      return lifecycleError(error);
    }
  }

  const executeSafeMatch = pathname.match(/^\/api\/admin\/data-lifecycle\/requests\/([^/]+)\/execute-safe$/);
  // POST /api/admin/data-lifecycle/requests/:id/execute-safe
  // route-policy: admin.data-lifecycle.requests.execute-safe
  if (executeSafeMatch && method === "POST") {
    try {
      normalizeDataLifecycleIdempotencyKey(request.headers.get("Idempotency-Key"));
      const parsed = await readJsonBodyOrResponse(request, {
        maxBytes: BODY_LIMITS.smallJson,
      });
      if (parsed.response) return parsed.response;
      if (parsed.body?.dryRun === false) {
        requireDataLifecycleConfirmation(parsed.body, {
          message: "Explicit confirmation is required before executing safe data lifecycle actions.",
          code: "safe_execution_confirmation_required",
        });
      }
      const result = await executeSafeDataLifecycleActions({
        env: ctx.env,
        adminUser: admin.user,
        requestId: decodePathId(executeSafeMatch[1]),
        body: parsed.body,
      });
      await auditLifecycleEvent(
        ctx,
        admin.user,
        "data_lifecycle_safe_actions_executed",
        result.request.subjectUserId,
        {
          request_id: result.request.id,
          request_type: result.request.type,
          dry_run: result.dryRun,
          action_count: result.actions.length,
          destructive_actions_disabled: true,
          reused: result.reused,
        }
      );
      return lifecycleJson({ ok: true, ...result });
    } catch (error) {
      return lifecycleError(error);
    }
  }

  const requestExportMatch = pathname.match(/^\/api\/admin\/data-lifecycle\/requests\/([^/]+)\/export$/);
  // GET /api/admin/data-lifecycle/requests/:id/export
  if (requestExportMatch && method === "GET") {
    try {
      const result = await getDataExportArchiveForRequest(ctx.env, decodePathId(requestExportMatch[1]));
      return lifecycleJson({ ok: true, ...result });
    } catch (error) {
      return lifecycleError(error);
    }
  }

  const archiveMatch = pathname.match(/^\/api\/admin\/data-lifecycle\/exports\/([^/]+)$/);
  // GET /api/admin/data-lifecycle/exports/:archiveId
  if (archiveMatch && method === "GET") {
    try {
      const result = await readDataExportArchive({
        env: ctx.env,
        archiveId: decodePathId(archiveMatch[1]),
      });
      return new Response(result.object.body, {
        status: 200,
        headers: {
          "content-type": DATA_EXPORT_ARCHIVE_CONTENT_TYPE,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "x-frame-options": "DENY",
        },
      });
    } catch (error) {
      return lifecycleError(error);
    }
  }

  const planMatch = pathname.match(/^\/api\/admin\/data-lifecycle\/requests\/([^/]+)\/plan$/);
  // POST /api/admin/data-lifecycle/requests/:id/plan
  // route-policy: admin.data-lifecycle.requests.plan
  if (planMatch && method === "POST") {
    try {
      normalizeDataLifecycleIdempotencyKey(request.headers.get("Idempotency-Key"));
      const parsed = await readJsonBodyOrResponse(request, {
        maxBytes: BODY_LIMITS.smallJson,
      });
      if (parsed.response) return parsed.response;
      const result = await planDataLifecycleRequest(ctx.env, decodePathId(planMatch[1]));
      await auditLifecycleEvent(
        ctx,
        admin.user,
        "data_lifecycle_request_planned",
        result.request.subjectUserId,
        {
          request_id: result.request.id,
          request_type: result.request.type,
          item_count: result.items.length,
          blocked: result.blocked,
          reused: result.reused,
        }
      );
      return lifecycleJson({ ok: true, ...result });
    } catch (error) {
      return lifecycleError(error);
    }
  }

  const approveMatch = pathname.match(/^\/api\/admin\/data-lifecycle\/requests\/([^/]+)\/approve$/);
  // POST /api/admin/data-lifecycle/requests/:id/approve
  // route-policy: admin.data-lifecycle.requests.approve
  if (approveMatch && method === "POST") {
    try {
      normalizeDataLifecycleIdempotencyKey(request.headers.get("Idempotency-Key"));
      const parsed = await readJsonBodyOrResponse(request, {
        maxBytes: BODY_LIMITS.smallJson,
      });
      if (parsed.response) return parsed.response;
      requireDataLifecycleConfirmation(parsed.body, {
        message: "Explicit confirmation is required before approving a data lifecycle request.",
        code: "approval_confirmation_required",
      });
      const result = await approveDataLifecycleRequest({
        env: ctx.env,
        adminUser: admin.user,
        requestId: decodePathId(approveMatch[1]),
      });
      await auditLifecycleEvent(
        ctx,
        admin.user,
        "data_lifecycle_request_approved",
        result.request.subjectUserId,
        {
          request_id: result.request.id,
          request_type: result.request.type,
          reused: result.reused,
        }
      );
      return lifecycleJson({ ok: true, ...result });
    } catch (error) {
      return lifecycleError(error);
    }
  }

  return null;
}
