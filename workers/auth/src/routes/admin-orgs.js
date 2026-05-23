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
  OrgRbacError,
  assignAdminOrganizationMember,
  getAdminOrganization,
  listAdminOrganizationUserAccess,
  listAdminOrganizations,
  orgRbacErrorResponse,
  removeAdminOrganizationMember,
} from "../lib/orgs.js";

async function enforceAdminOrgReadRateLimit(ctx) {
  const result = await evaluateSharedRateLimit(
    ctx.env,
    "admin-org-read-ip",
    getClientIp(ctx.request),
    120,
    15 * 60_000,
    sensitiveRateLimitOptions({
      component: "admin-org-read",
      correlationId: ctx.correlationId || null,
      requestInfo: ctx,
    })
  );
  if (result.unavailable) return rateLimitUnavailableResponse(ctx.correlationId || null);
  if (result.limited) return rateLimitResponse();
  return null;
}

async function enforceAdminOrgWriteRateLimit(ctx) {
  const result = await evaluateSharedRateLimit(
    ctx.env,
    "admin-org-write-ip",
    getClientIp(ctx.request),
    30,
    15 * 60_000,
    sensitiveRateLimitOptions({
      component: "admin-org-write",
      correlationId: ctx.correlationId || null,
      requestInfo: ctx,
    })
  );
  if (result.unavailable) return rateLimitUnavailableResponse(ctx.correlationId || null);
  if (result.limited) return rateLimitResponse();
  return null;
}

function orgErrorResponse(error) {
  if (error instanceof OrgRbacError) {
    return json(orgRbacErrorResponse(error), { status: error.status });
  }
  throw error;
}

async function auditAdminOrgMembership(ctx, adminUser, action, meta = {}) {
  await enqueueAdminAuditEvent(
    ctx.env,
    {
      adminUserId: adminUser.id,
      action,
      targetUserId: meta.target_user_id || null,
      meta: {
        organization_id: meta.organization_id || null,
        membership_role: meta.membership_role || null,
        reused: meta.reused === true,
        actor_email: adminUser.email,
        rawIdempotencyKeyIncluded: false,
      },
    },
    {
      correlationId: ctx.correlationId || null,
      requestInfo: ctx,
      allowDirectFallback: true,
    }
  );
}

function idempotencyKeyOrResponse(request) {
  const key = String(request.headers.get("Idempotency-Key") || "").trim();
  if (!key) {
    return {
      key: null,
      response: json({
        ok: false,
        error: "A valid Idempotency-Key header is required.",
        code: "idempotency_key_required",
      }, { status: 428 }),
    };
  }
  return { key, response: null };
}

export async function handleAdminOrgs(ctx) {
  const { request, env, pathname, method, isSecure, correlationId, url } = ctx;
  if (pathname !== "/api/admin/orgs" && !pathname.startsWith("/api/admin/orgs/")) {
    return null;
  }

  const session = await requireAdmin(request, env, {
    isSecure,
    correlationId,
  });
  if (session instanceof Response) return session;

  if (pathname === "/api/admin/orgs" && method === "GET") {
    const limited = await enforceAdminOrgReadRateLimit(ctx);
    if (limited) return limited;
    const organizations = await listAdminOrganizations(env, {
      limit: url.searchParams.get("limit"),
      search: url.searchParams.get("search"),
    });
    return json({ ok: true, organizations });
  }

  const orgMatch = pathname.match(/^\/api\/admin\/orgs\/([^/]+)$/);
  if (orgMatch && method === "GET") {
    const limited = await enforceAdminOrgReadRateLimit(ctx);
    if (limited) return limited;
    try {
      const result = await getAdminOrganization(env, {
        organizationId: orgMatch[1],
      });
      return json({ ok: true, ...result });
    } catch (error) {
      return orgErrorResponse(error);
    }
  }

  const accessMatch = pathname.match(/^\/api\/admin\/orgs\/([^/]+)\/user-access$/);
  if (accessMatch && method === "GET") {
    const limited = await enforceAdminOrgReadRateLimit(ctx);
    if (limited) return limited;
    try {
      const users = await listAdminOrganizationUserAccess(env, {
        organizationId: accessMatch[1],
        search: url.searchParams.get("search"),
        limit: url.searchParams.get("limit"),
      });
      return json({ ok: true, users });
    } catch (error) {
      return orgErrorResponse(error);
    }
  }

  const userAccessMatch = pathname.match(/^\/api\/admin\/orgs\/([^/]+)\/users\/([^/]+)$/);
  // route-policy: admin.orgs.users.assign
  if (userAccessMatch && method === "PUT") {
    const limited = await enforceAdminOrgWriteRateLimit(ctx);
    if (limited) return limited;
    const idempotency = idempotencyKeyOrResponse(request);
    if (idempotency.response) return idempotency.response;
    const parsed = await readJsonBodyOrResponse(request, {
      maxBytes: BODY_LIMITS.smallJson,
    });
    if (parsed.response) return parsed.response;
    try {
      const result = await assignAdminOrganizationMember({
        env,
        actorUser: session.user,
        organizationId: userAccessMatch[1],
        userId: userAccessMatch[2],
        role: parsed.body?.role || "member",
        idempotencyKey: idempotency.key,
      });
      if (!result.reused) {
        await auditAdminOrgMembership(ctx, session.user, "organization_member_assigned", {
          organization_id: userAccessMatch[1],
          target_user_id: userAccessMatch[2],
          membership_role: result.access?.membership?.role || "member",
          reused: false,
        });
      }
      return json({ ok: true, ...result }, { status: result.reused ? 200 : 201 });
    } catch (error) {
      return orgErrorResponse(error);
    }
  }

  // route-policy: admin.orgs.users.remove
  if (userAccessMatch && method === "DELETE") {
    const limited = await enforceAdminOrgWriteRateLimit(ctx);
    if (limited) return limited;
    const idempotency = idempotencyKeyOrResponse(request);
    if (idempotency.response) return idempotency.response;
    const parsed = await readJsonBodyOrResponse(request, {
      maxBytes: BODY_LIMITS.smallJson,
    });
    if (parsed.response) return parsed.response;
    try {
      const result = await removeAdminOrganizationMember({
        env,
        organizationId: userAccessMatch[1],
        userId: userAccessMatch[2],
        idempotencyKey: idempotency.key,
      });
      if (!result.reused) {
        await auditAdminOrgMembership(ctx, session.user, "organization_member_removed", {
          organization_id: userAccessMatch[1],
          target_user_id: userAccessMatch[2],
          membership_role: result.access?.membership?.role || null,
          reused: false,
        });
      }
      return json({ ok: true, ...result });
    } catch (error) {
      return orgErrorResponse(error);
    }
  }

  return null;
}
