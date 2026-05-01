import { json } from "../lib/response.js";
import { requireAdmin } from "../lib/session.js";
import {
  evaluateSharedRateLimit,
  getClientIp,
  rateLimitResponse,
  rateLimitUnavailableResponse,
  sensitiveRateLimitOptions,
} from "../lib/rate-limit.js";
import {
  OrgRbacError,
  getAdminOrganization,
  listAdminOrganizations,
  orgRbacErrorResponse,
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

function orgErrorResponse(error) {
  if (error instanceof OrgRbacError) {
    return json(orgRbacErrorResponse(error), { status: error.status });
  }
  throw error;
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

  const limited = await enforceAdminOrgReadRateLimit(ctx);
  if (limited) return limited;

  if (pathname === "/api/admin/orgs" && method === "GET") {
    const organizations = await listAdminOrganizations(env, {
      limit: url.searchParams.get("limit"),
      search: url.searchParams.get("search"),
    });
    return json({ ok: true, organizations });
  }

  const orgMatch = pathname.match(/^\/api\/admin\/orgs\/([^/]+)$/);
  if (orgMatch && method === "GET") {
    try {
      const result = await getAdminOrganization(env, {
        organizationId: orgMatch[1],
      });
      return json({ ok: true, ...result });
    } catch (error) {
      return orgErrorResponse(error);
    }
  }

  return null;
}
