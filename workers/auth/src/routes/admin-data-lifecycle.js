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
  getDataLifecycleRequest,
  listDataLifecycleRequests,
  normalizeDataLifecycleIdempotencyKey,
  planDataLifecycleRequest,
} from "../lib/data-lifecycle.js";

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
