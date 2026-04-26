import { json } from "../lib/response.js";
import { requireUser } from "../lib/session.js";
import {
  BODY_LIMITS,
  readJsonBodyOrResponse,
} from "../lib/request.js";
import { enforceSensitiveUserRateLimit } from "../lib/sensitive-write-limit.js";
import { logUserActivity } from "../lib/activity.js";
import {
  OrgRbacError,
  addOrganizationMember,
  createOrganization,
  getOrganizationForUser,
  listOrganizationMembers,
  listUserOrganizations,
  normalizeOrgIdempotencyKey,
  orgRbacErrorResponse,
} from "../lib/orgs.js";

function idempotencyKeyOrResponse(request) {
  try {
    return {
      key: normalizeOrgIdempotencyKey(request.headers.get("Idempotency-Key")),
      response: null,
    };
  } catch (error) {
    if (error instanceof OrgRbacError) {
      return {
        key: null,
        response: json(orgRbacErrorResponse(error), { status: error.status }),
      };
    }
    throw error;
  }
}

function orgErrorResponse(error) {
  if (error instanceof OrgRbacError) {
    return json(orgRbacErrorResponse(error), { status: error.status });
  }
  throw error;
}

async function logOrgActivity(ctx, userId, action, meta) {
  await logUserActivity(
    ctx.env,
    userId,
    action,
    meta,
    ctx.request.headers.get("CF-Connecting-IP") || null,
    {
      correlationId: ctx.correlationId || null,
      requestInfo: ctx,
    }
  );
}

async function handleCreateOrganization(ctx, session) {
  const limited = await enforceSensitiveUserRateLimit(ctx, {
    scope: "org-create-user",
    userId: session.user.id,
    maxRequests: 10,
    windowMs: 60 * 60_000,
    component: "org-create",
  });
  if (limited) return limited;

  const idempotency = idempotencyKeyOrResponse(ctx.request);
  if (idempotency.response) return idempotency.response;

  const parsed = await readJsonBodyOrResponse(ctx.request, {
    maxBytes: BODY_LIMITS.smallJson,
  });
  if (parsed.response) return parsed.response;

  try {
    const result = await createOrganization({
      env: ctx.env,
      user: session.user,
      body: parsed.body,
      idempotencyKey: idempotency.key,
    });
    if (!result.reused) {
      await logOrgActivity(ctx, session.user.id, "organization_created", {
        organization_id: result.organization.id,
        organization_role: "owner",
      });
    }
    return json({ ok: true, ...result }, { status: result.reused ? 200 : 201 });
  } catch (error) {
    return orgErrorResponse(error);
  }
}

async function handleAddOrganizationMember(ctx, session, organizationId) {
  const limited = await enforceSensitiveUserRateLimit(ctx, {
    scope: "org-member-write-user",
    userId: session.user.id,
    maxRequests: 30,
    windowMs: 15 * 60_000,
    component: "org-member-write",
  });
  if (limited) return limited;

  const idempotency = idempotencyKeyOrResponse(ctx.request);
  if (idempotency.response) return idempotency.response;

  const parsed = await readJsonBodyOrResponse(ctx.request, {
    maxBytes: BODY_LIMITS.smallJson,
  });
  if (parsed.response) return parsed.response;

  try {
    const result = await addOrganizationMember({
      env: ctx.env,
      actorUser: session.user,
      organizationId,
      body: parsed.body,
      idempotencyKey: idempotency.key,
    });
    if (!result.reused) {
      await logOrgActivity(ctx, session.user.id, "organization_member_added", {
        organization_id: result.membership.organizationId,
        target_user_id: result.membership.userId,
        organization_role: result.membership.role,
      });
    }
    return json({ ok: true, ...result }, { status: result.reused ? 200 : 201 });
  } catch (error) {
    return orgErrorResponse(error);
  }
}

export async function handleOrgs(ctx) {
  const { request, env, pathname, method, url } = ctx;
  if (pathname !== "/api/orgs" && !pathname.startsWith("/api/orgs/")) {
    return null;
  }

  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  if (pathname === "/api/orgs" && method === "GET") {
    try {
      const organizations = await listUserOrganizations(env, {
        userId: session.user.id,
        limit: url.searchParams.get("limit"),
      });
      return json({ ok: true, organizations });
    } catch (error) {
      return orgErrorResponse(error);
    }
  }

  // route-policy: orgs.create
  if (pathname === "/api/orgs" && method === "POST") {
    return handleCreateOrganization(ctx, session);
  }

  const memberMatch = pathname.match(/^\/api\/orgs\/([^/]+)\/members$/);
  if (memberMatch && method === "GET") {
    try {
      const members = await listOrganizationMembers(env, {
        organizationId: memberMatch[1],
        actorUserId: session.user.id,
        limit: url.searchParams.get("limit"),
      });
      return json({ ok: true, members });
    } catch (error) {
      return orgErrorResponse(error);
    }
  }

  // route-policy: orgs.members.add
  if (memberMatch && method === "POST") {
    return handleAddOrganizationMember(ctx, session, memberMatch[1]);
  }

  const orgMatch = pathname.match(/^\/api\/orgs\/([^/]+)$/);
  if (orgMatch && method === "GET") {
    try {
      const organization = await getOrganizationForUser(env, {
        organizationId: orgMatch[1],
        userId: session.user.id,
      });
      return json({ ok: true, organization });
    } catch (error) {
      return orgErrorResponse(error);
    }
  }

  return null;
}
