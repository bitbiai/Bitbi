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
  getAdminOrganization,
  getOrganizationForUser,
  getOrgMembership,
  listOrganizationMembers,
  listUserOrganizations,
  normalizeOrgIdempotencyKey,
  orgRbacErrorResponse,
  requireOrgRole,
} from "../lib/orgs.js";
import {
  StripeBillingError,
  createStripeLiveCreditPackCheckout,
  createStripeCreditPackCheckout,
  getOrganizationCreditsDashboard,
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

async function requireActiveOrganizationForBilling(env, organizationId) {
  const organization = await env.DB.prepare(
    "SELECT id FROM organizations WHERE id = ? AND status = 'active' LIMIT 1"
  ).bind(organizationId).first();
  if (!organization) {
    throw new OrgRbacError("Organization access denied.", {
      status: 404,
      code: "organization_not_found",
    });
  }
  return organization;
}

async function resolveLiveCreditAccess(ctx, session, organizationId) {
  await requireActiveOrganizationForBilling(ctx.env, organizationId);
  if (session.user.role === "admin") {
    return { scope: "platform_admin" };
  }
  await requireOrgRole(ctx.env, {
    organizationId,
    userId: session.user.id,
    minRole: "owner",
  });
  return { scope: "org_owner" };
}

async function handleCreateLiveCreditPackCheckout(ctx, session, organizationId) {
  const limited = await enforceSensitiveUserRateLimit(ctx, {
    scope: "org-billing-live-checkout-user",
    userId: session.user.id,
    maxRequests: 10,
    windowMs: 15 * 60_000,
    component: "org-billing-live-checkout",
  });
  if (limited) return limited;

  const idempotency = idempotencyKeyOrResponse(ctx.request);
  if (idempotency.response) return idempotency.response;

  const parsed = await readJsonBodyOrResponse(ctx.request, {
    maxBytes: BODY_LIMITS.smallJson,
  });
  if (parsed.response) return parsed.response;

  try {
    const access = await resolveLiveCreditAccess(ctx, session, organizationId);
    const result = await createStripeLiveCreditPackCheckout({
      env: ctx.env,
      organizationId,
      userId: session.user.id,
      packId: parsed.body?.pack_id || parsed.body?.packId,
      idempotencyKey: idempotency.key,
      authorizationScope: access.scope,
    });
    if (!result.reused) {
      await logOrgActivity(ctx, session.user.id, "stripe_live_credit_pack_checkout_created", {
        organization_id: result.checkout.organizationId,
        credit_pack_id: result.creditPack.id,
        credits: result.creditPack.credits,
        authorization_scope: access.scope,
      });
    }
    return json({
      ok: true,
      reused: result.reused,
      checkout_url: result.checkout.checkoutUrl,
      session_id: result.checkout.sessionId,
      mode: result.checkout.providerMode,
      authorization_scope: result.checkout.authorizationScope,
      credit_pack: result.creditPack,
      livePaymentProviderEnabled: true,
    }, { status: result.reused ? 200 : 201 });
  } catch (error) {
    return orgErrorResponse(error);
  }
}

async function handleCreditsDashboard(ctx, session, organizationId) {
  try {
    const access = await resolveLiveCreditAccess(ctx, session, organizationId);
    const dashboard = await getOrganizationCreditsDashboard({
      env: ctx.env,
      organizationId,
      accessScope: access.scope,
      includeConfigNames: access.scope === "platform_admin",
      limit: ctx.url.searchParams.get("limit"),
    });
    return json({ ok: true, dashboard });
  } catch (error) {
    return orgErrorResponse(error);
  }
}

function serializeOrganizationDashboardMember(member) {
  return {
    id: member.id,
    organizationId: member.organizationId || member.organization_id,
    userId: member.userId || member.user_id,
    email: member.email || null,
    role: member.role,
    status: member.status,
    createdAt: member.createdAt || member.created_at,
    updatedAt: member.updatedAt || member.updated_at,
  };
}

async function getCurrentOrganizationRole(env, { organizationId, userId }) {
  const membership = await getOrgMembership(env, { organizationId, userId });
  return membership?.role || null;
}

async function resolveOrganizationDashboard(ctx, session, organizationId) {
  await requireActiveOrganizationForBilling(ctx.env, organizationId);

  if (session.user.role === "admin") {
    const adminOrg = await getAdminOrganization(ctx.env, { organizationId });
    const organizationRole = await getCurrentOrganizationRole(ctx.env, {
      organizationId,
      userId: session.user.id,
    });
    const credits = await getOrganizationCreditsDashboard({
      env: ctx.env,
      organizationId,
      accessScope: "platform_admin",
      includeConfigNames: true,
      limit: ctx.url.searchParams.get("limit"),
    });
    return {
      access: {
        platformAdmin: true,
        accessScope: "platform_admin",
        organizationRole: organizationRole || "none",
        canUseAdminImageTests: true,
      },
      organization: {
        ...credits.organization,
        createdByUserId: adminOrg.organization.createdByUserId || null,
        memberCount: adminOrg.organization.memberCount ?? null,
      },
      balance: credits.balance,
      liveCheckout: credits.liveCheckout,
      packs: credits.packs,
      purchaseHistory: credits.purchaseHistory,
      recentLedger: credits.recentLedger,
      recentAdminImageTestDebits: credits.recentLedger.filter((entry) =>
        entry.source === "admin_ai_image_test"
      ),
      members: (adminOrg.members || []).map(serializeOrganizationDashboardMember),
      warnings: organizationRole === "owner" ? [] : [{
        code: "platform_admin_not_org_owner",
        message: "You are platform admin, but you are not an owner of this organization. Credits belong to the organization.",
      }],
    };
  }

  const membership = await requireOrgRole(ctx.env, {
    organizationId,
    userId: session.user.id,
    minRole: "owner",
  });
  const organization = await getOrganizationForUser(ctx.env, {
    organizationId,
    userId: session.user.id,
  });
  const members = await listOrganizationMembers(ctx.env, {
    organizationId,
    actorUserId: session.user.id,
    limit: 100,
  });
  const credits = await getOrganizationCreditsDashboard({
    env: ctx.env,
    organizationId,
    accessScope: "org_owner",
    includeConfigNames: false,
    limit: ctx.url.searchParams.get("limit"),
  });
  return {
    access: {
      platformAdmin: false,
      accessScope: "org_owner",
      organizationRole: membership.role,
      canUseAdminImageTests: false,
    },
    organization: {
      ...credits.organization,
      memberCount: organization.memberCount ?? null,
    },
    balance: credits.balance,
    liveCheckout: credits.liveCheckout,
    packs: credits.packs,
    purchaseHistory: credits.purchaseHistory,
    recentLedger: credits.recentLedger,
    recentAdminImageTestDebits: credits.recentLedger.filter((entry) =>
      entry.source === "admin_ai_image_test"
    ),
    members: members.map(serializeOrganizationDashboardMember),
    warnings: [],
  };
}

async function handleOrganizationDashboard(ctx, session, organizationId) {
  try {
    const dashboard = await resolveOrganizationDashboard(ctx, session, organizationId);
    return json({ ok: true, dashboard });
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

  const liveCheckoutMatch = pathname.match(/^\/api\/orgs\/([^/]+)\/billing\/checkout\/live-credit-pack$/);
  // route-policy: orgs.billing.checkout.live-credit-pack
  if (liveCheckoutMatch && method === "POST") {
    return handleCreateLiveCreditPackCheckout(ctx, session, liveCheckoutMatch[1]);
  }

  const creditsDashboardMatch = pathname.match(/^\/api\/orgs\/([^/]+)\/billing\/credits-dashboard$/);
  if (creditsDashboardMatch && method === "GET") {
    return handleCreditsDashboard(ctx, session, creditsDashboardMatch[1]);
  }

  const organizationDashboardMatch = pathname.match(/^\/api\/orgs\/([^/]+)\/organization-dashboard$/);
  if (organizationDashboardMatch && method === "GET") {
    return handleOrganizationDashboard(ctx, session, organizationDashboardMatch[1]);
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
