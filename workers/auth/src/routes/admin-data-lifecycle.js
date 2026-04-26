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
