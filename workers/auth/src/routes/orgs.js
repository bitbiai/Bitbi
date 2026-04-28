import { json } from "../lib/response.js";
import { requireAdmin, requireUser } from "../lib/session.js";
import {
  BODY_LIMITS,
  readJsonBodyOrResponse,
} from "../lib/request.js";
import { enforceSensitiveUserRateLimit } from "../lib/sensitive-write-limit.js";
import { logUserActivity } from "../lib/activity.js";
import {
  BillingError,
  billingErrorResponse,
  getOrganizationBillingState,
  listOrganizationUsage,
  requireBillingReader,
  resolveEffectiveEntitlements,
} from "../lib/billing.js";
import {
  OrgRbacError,
  addOrganizationMember,
  createOrganization,
  getOrganizationForUser,
  listOrganizationMembers,
  listUserOrganizations,
  normalizeOrgIdempotencyKey,
  orgRbacErrorResponse,
  requireOrgRole,
} from "../lib/orgs.js";
import {
  StripeBillingError,
  createStripeCreditPackCheckout,
  stripeBillingErrorResponse,
} from "../lib/stripe-billing.js";

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
  if (error instanceof BillingError) {
    return json(billingErrorResponse(error), { status: error.status });
  }
  if (error instanceof StripeBillingError) {
    return json(stripeBillingErrorResponse(error), { status: error.status });
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

async function handleCreateCreditPackCheckout(ctx, organizationId) {
  const adminSession = await requireAdmin(ctx.request, ctx.env, {
    correlationId: ctx.correlationId || null,
    isSecure: ctx.isSecure === true,
  });
  if (adminSession instanceof Response) return adminSession;

  const limited = await enforceSensitiveUserRateLimit(ctx, {
    scope: "org-billing-checkout-user",
    userId: adminSession.user.id,
    maxRequests: 10,
    windowMs: 15 * 60_000,
    component: "org-billing-checkout",
  });
  if (limited) return limited;

  const idempotency = idempotencyKeyOrResponse(ctx.request);
  if (idempotency.response) return idempotency.response;

  const parsed = await readJsonBodyOrResponse(ctx.request, {
    maxBytes: BODY_LIMITS.smallJson,
  });
  if (parsed.response) return parsed.response;

  try {
    await requireOrgRole(ctx.env, {
      organizationId,
      userId: adminSession.user.id,
      minRole: "admin",
    });
    const result = await createStripeCreditPackCheckout({
      env: ctx.env,
      organizationId,
      userId: adminSession.user.id,
      packId: parsed.body?.pack_id || parsed.body?.packId,
      idempotencyKey: idempotency.key,
    });
    if (!result.reused) {
      await logOrgActivity(ctx, adminSession.user.id, "stripe_credit_pack_checkout_created", {
        organization_id: result.checkout.organizationId,
        credit_pack_id: result.creditPack.id,
        credits: result.creditPack.credits,
      });
    }
    return json({
      ok: true,
      reused: result.reused,
      checkout_url: result.checkout.checkoutUrl,
      session_id: result.checkout.sessionId,
      mode: result.checkout.providerMode,
      credit_pack: result.creditPack,
      livePaymentProviderEnabled: false,
    }, { status: result.reused ? 200 : 201 });
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

  const entitlementMatch = pathname.match(/^\/api\/orgs\/([^/]+)\/entitlements$/);
  if (entitlementMatch && method === "GET") {
    try {
      await getOrganizationForUser(env, {
        organizationId: entitlementMatch[1],
        userId: session.user.id,
      });
      const entitlements = await resolveEffectiveEntitlements(env, {
        organizationId: entitlementMatch[1],
      });
      return json({ ok: true, ...entitlements });
    } catch (error) {
      return orgErrorResponse(error);
    }
  }

  const billingMatch = pathname.match(/^\/api\/orgs\/([^/]+)\/billing$/);
  if (billingMatch && method === "GET") {
    try {
      await requireBillingReader(env, {
        organizationId: billingMatch[1],
        userId: session.user.id,
      });
      const billing = await getOrganizationBillingState(env, {
        organizationId: billingMatch[1],
      });
      return json({ ok: true, billing });
    } catch (error) {
      return orgErrorResponse(error);
    }
  }

  const checkoutMatch = pathname.match(/^\/api\/orgs\/([^/]+)\/billing\/checkout\/credit-pack$/);
  // route-policy: orgs.billing.checkout.credit-pack
  if (checkoutMatch && method === "POST") {
    return handleCreateCreditPackCheckout(ctx, checkoutMatch[1]);
  }

  const usageMatch = pathname.match(/^\/api\/orgs\/([^/]+)\/usage$/);
  if (usageMatch && method === "GET") {
    try {
      await requireBillingReader(env, {
        organizationId: usageMatch[1],
        userId: session.user.id,
      });
      const usage = await listOrganizationUsage(env, {
        organizationId: usageMatch[1],
        userId: session.user.id,
        limit: url.searchParams.get("limit"),
      });
      return json({ ok: true, usage });
    } catch (error) {
      return orgErrorResponse(error);
    }
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
