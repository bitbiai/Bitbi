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
  BillingError,
  billingErrorResponse,
  billingStorageUnavailableResponse,
  getAdminOrganizationBilling,
  getAdminUserBilling,
  grantMemberCredits,
  grantOrganizationCredits,
  isBillingStorageUnavailableError,
  listAdminPlans,
  normalizeBillingIdempotencyKey,
} from "../lib/billing.js";
import { buildBillingEvidenceStatus } from "../lib/billing-evidence.js";
import {
  BillingEventError,
  billingEventErrorResponse,
  getBillingProviderEvent,
  getBillingReconciliationReport,
  getBillingReviewEvent,
  listBillingProviderEvents,
  listBillingReviewEvents,
  resolveBillingReviewEvent,
} from "../lib/billing-events.js";
import {
  getErrorFields,
  logDiagnostic,
} from "../../../../js/shared/worker-observability.mjs";

async function enforceAdminBillingRateLimit(ctx, {
  scope = "admin-billing-read-ip",
  maxRequests = 120,
  windowMs = 15 * 60_000,
  component = "admin-billing",
} = {}) {
  const result = await evaluateSharedRateLimit(
    ctx.env,
    scope,
    getClientIp(ctx.request),
    maxRequests,
    windowMs,
    sensitiveRateLimitOptions({
      component,
      correlationId: ctx.correlationId || null,
      requestInfo: ctx,
    })
  );
  if (result.unavailable) return rateLimitUnavailableResponse(ctx.correlationId || null);
  if (result.limited) return rateLimitResponse();
  return null;
}

function billingErrorJson(error, ctx = null) {
  if (error instanceof BillingError) {
    return json(billingErrorResponse(error), { status: error.status });
  }
  if (error instanceof BillingEventError) {
    return json(billingEventErrorResponse(error), { status: error.status });
  }
  if (isBillingStorageUnavailableError(error)) {
    logDiagnostic({
      service: "bitbi-auth",
      component: "admin-billing",
      event: "admin_billing_storage_unavailable",
      level: "error",
      correlationId: ctx?.correlationId || null,
      code: "billing_storage_unavailable",
      ...getErrorFields(error),
    });
    return json(billingStorageUnavailableResponse(), { status: 503 });
  }
  throw error;
}

function idempotencyKeyOrResponse(request) {
  try {
    return {
      key: normalizeBillingIdempotencyKey(request.headers.get("Idempotency-Key")),
      response: null,
    };
  } catch (error) {
    if (error instanceof BillingError) {
      return {
        key: null,
        response: json(billingErrorResponse(error), { status: error.status }),
      };
    }
    throw error;
  }
}

async function auditBillingEvent(ctx, adminUser, action, meta = {}, targetUserId = null) {
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
      correlationId: ctx.correlationId || null,
      requestInfo: ctx,
      allowDirectFallback: true,
    }
  );
}

function countByField(rows, field) {
  const counts = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = String(row?.[field] || "unknown").slice(0, 96) || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function liveBillingStatusVariant(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("configured") || text.includes("present") || text.includes("active")) return "ready";
  if (text.includes("missing") || text.includes("blocked") || text.includes("invalid")) return "blocked";
  return "pending";
}

function liveBillingConfigShapeStatus(config = {}) {
  const hasLiveSecret = config.secrets?.liveSecretKey?.present === true;
  const hasWebhookSecret = config.secrets?.liveWebhookSecret?.present === true;
  const hasSubscriptionPrice = config.priceIds?.liveSubscriptionPriceId?.present === true;
  const hasCreditUrls = config.urls?.liveCreditPackSuccess?.present === true
    && config.urls?.liveCreditPackCancel?.present === true;
  const hasSubscriptionUrls = config.urls?.liveSubscriptionSuccess?.present === true
    && config.urls?.liveSubscriptionCancel?.present === true;
  if (hasLiveSecret && hasWebhookSecret && hasSubscriptionPrice && hasCreditUrls && hasSubscriptionUrls) {
    return "configured_shapes_present";
  }
  if (hasLiveSecret || hasWebhookSecret || hasSubscriptionPrice || hasCreditUrls || hasSubscriptionUrls) {
    return "partial_shapes_present";
  }
  return "missing_required_shapes";
}

async function buildAdminLiveBillingReadinessStatus(env) {
  const evidence = buildBillingEvidenceStatus(env);
  const [events, reviews, reconciliation] = await Promise.all([
    listBillingProviderEvents(env, {
      provider: "stripe",
      providerMode: "live",
      limit: 25,
    }),
    listBillingReviewEvents(env, {
      provider: "stripe",
      providerMode: "live",
      limit: 25,
    }),
    getBillingReconciliationReport(env),
  ]);
  const reviewRows = Array.isArray(reviews?.reviews) ? reviews.reviews : [];
  const unresolvedReviews = reviewRows.filter((review) => !["resolved", "dismissed"].includes(String(review.reviewState || "").toLowerCase()));
  const summary = reconciliation?.summary || {};
  const configShapeStatus = liveBillingConfigShapeStatus(evidence.config);
  const nextOperatorActions = [
    {
      id: "deploy_auth_worker_static",
      label: "Deploy Auth Worker and Static Pages after validation passes.",
      inspect: "Run release:plan and deploy in the documented order.",
      safeAction: "Deployment only; do not enable live flags yet.",
    },
    {
      id: "export_redacted_status",
      label: "Export this redacted status before enabling live flags.",
      inspect: "Admin -> Finance -> Live Billing.",
      safeAction: "Download JSON or Markdown evidence from this page.",
    },
    {
      id: "configure_redacted_env",
      label: "Configure Cloudflare Stripe secrets and vars with optional tax flags false.",
      inspect: "Cloudflare Worker settings; values stay outside the repo.",
      safeAction: "Use copied env-name checklist with placeholders only.",
    },
    {
      id: "verify_config_shape",
      label: "Refresh Admin Live Billing and verify configured shapes, not values.",
      inspect: "Configuration Readiness and Webhook Health cards.",
      safeAction: "Confirm no raw secrets, payloads, signatures, cards, cookies, or tokens render.",
    },
    {
      id: "run_operator_canaries",
      label: "Run controlled canary purchases only when the operator intentionally triggers real payment.",
      inspect: "Credits page, Stripe Dashboard, Billing Events, Billing Reconciliation.",
      safeAction: "Capture sanitized evidence for no-credit-before-webhook, exactly-once grants, duplicate webhook idempotency, BITBI Pro invoice top-up, and review-only failures.",
    },
    {
      id: "attach_evidence_review",
      label: "Attach sanitized evidence and keep final readiness blocked until reviewed.",
      inspect: "docs/production-readiness/evidence/ and this command center.",
      safeAction: "Move only to operator-reviewed after evidence is complete.",
    },
  ];
  return {
    ok: true,
    version: "omega-p1-live-billing-readiness-v1",
    generatedAt: evidence.generatedAt,
    repositorySupport: "ready_for_operator_canary",
    productionReadiness: evidence.productionReadiness,
    liveBillingReadiness: evidence.liveBillingReadiness,
    configShapeStatus,
    evidenceStatus: "pending_operator_evidence",
    canaryStatus: "pending_operator_evidence",
    finalVerdict: {
      status: "blocked_pending_operator_evidence",
      summary: "Repository support is ready for an operator live-billing canary, but production readiness and live billing readiness remain blocked until sanitized evidence is collected and reviewed.",
    },
    boundedResponse: true,
    redactedResponse: true,
    stripeCallsMade: false,
    checkoutSessionCreated: false,
    d1MutationPerformed: false,
    creditMutationPerformed: false,
    dangerousActionsOffered: [],
    copy: "Admin does not activate live payments by itself. It guides configuration, evidence, and operator go/no-go.",
    statusBadges: [
      { id: "repository_support", label: "Repository support", status: "ready_for_operator_canary", variant: "ready" },
      { id: "production_readiness", label: "Production readiness", status: evidence.productionReadiness || "blocked", variant: "blocked" },
      { id: "live_billing_readiness", label: "Live billing readiness", status: evidence.liveBillingReadiness || "blocked", variant: "blocked" },
      { id: "config_shape", label: "Config shape", status: configShapeStatus, variant: liveBillingStatusVariant(configShapeStatus) },
      { id: "credit_packs", label: "Credit packs", status: evidence.creditPacks?.status || "missing_or_pending", variant: liveBillingStatusVariant(evidence.creditPacks?.status) },
      { id: "bitbi_pro", label: "BITBI Pro subscription", status: evidence.subscription?.status || "missing_or_pending", variant: liveBillingStatusVariant(evidence.subscription?.status) },
      { id: "webhook", label: "Webhook", status: evidence.config?.secrets?.liveWebhookSecret?.present ? "secret_present_redacted" : "secret_missing", variant: evidence.config?.secrets?.liveWebhookSecret?.present ? "pending" : "blocked" },
      { id: "reconciliation", label: "Reconciliation", status: reconciliation?.verdict || "blocked", variant: String(reconciliation?.verdict || "").toLowerCase() === "ready" ? "ready" : "pending" },
      { id: "billing_reviews", label: "Billing reviews", status: `${unresolvedReviews.length} unresolved`, variant: unresolvedReviews.length ? "pending" : "ready" },
      { id: "evidence_status", label: "Evidence status", status: "pending_operator_evidence", variant: "pending" },
      { id: "canary_status", label: "Canary status", status: "pending_operator_evidence", variant: "pending" },
      { id: "final_verdict", label: "Final verdict", status: "blocked_pending_operator_evidence", variant: "blocked" },
    ],
    configuration: evidence.config,
    catalog: {
      creditPacks: evidence.creditPacks,
      subscription: evidence.subscription,
      publicCatalog: true,
      stripePriceIdConfigured: evidence.config?.priceIds?.liveSubscriptionPriceId?.present === true,
      needsStripeDashboardEvidence: true,
    },
    checkoutSafety: {
      facts: evidence.failClosedFacts,
      checkoutCreationDoesNotGrantCredits: true,
      grantsRequireVerifiedWebhookOrInvoice: true,
      missingWebhookSecretFailsClosedBeforeCheckout: true,
      wrongProviderModeOrPriceIdDoesNotGrant: true,
    },
    webhookHealth: {
      endpoint: "/api/billing/webhooks/stripe/live",
      signatureVerification: "verified_live_signature",
      rawPayloadsRendered: false,
      signaturesRendered: false,
      recentEvents: (Array.isArray(events) ? events : []).slice(0, 10).map((event) => ({
        id: event.id,
        eventType: event.eventType,
        providerMode: event.providerMode,
        processingStatus: event.processingStatus,
        actionStatus: event.actionStatus,
        duplicate: event.duplicate === true,
        receivedAt: event.receivedAt || event.createdAt,
      })),
      countsByType: countByField(events, "eventType"),
      countsByStatus: countByField(events, "processingStatus"),
      countsByProviderMode: countByField(events, "providerMode"),
    },
    customerPortal: {
      ...evidence.customerPortal,
      implemented: true,
      endpoint: "/api/account/billing/portal",
      memberTriggeredOnly: true,
      adminCustomerMutation: false,
    },
    taxInvoice: evidence.taxInvoice,
    evidenceChecklist: (Array.isArray(evidence.evidenceRequired) ? evidence.evidenceRequired : []).map((item) => ({
      ...item,
      why: {
        live_credit_pack_checkout_canary: "Proves the configured live credit-pack checkout can be created safely by an operator.",
        live_subscription_checkout_canary: "Proves the configured BITBI Pro checkout can be created safely by an operator.",
        verified_webhook_receipt: "Proves Stripe live events reach the verified webhook endpoint.",
        duplicate_webhook_idempotency: "Proves repeated provider events cannot double-grant credits.",
        wrong_price_id_rejection: "Proves unrelated Stripe prices do not grant BITBI Pro credits.",
        missing_webhook_secret_fail_closed: "Proves checkout stays disabled without webhook-credit readiness.",
        no_credit_before_webhook: "Proves checkout creation alone never grants credits.",
        invoice_paid_subscription_credit_grant: "Proves subscription credits are topped up only after a paid invoice event.",
        refund_dispute_failure_review_only: "Proves refunds, disputes, and failures create review records only.",
        raw_payload_signature_secret_redaction: "Proves Admin never renders raw payloads, signatures, or secrets.",
        customer_portal_session_canary: "Proves a signed-in member can open Stripe Customer Portal without Admin customer mutation.",
        tax_invoice_configuration_review: "Confirms Stripe Tax/invoice flags and dashboard accounting setup were reviewed by an operator.",
      }[item.id] || "Required operator evidence for live billing readiness.",
      inspect: {
        live_credit_pack_checkout_canary: "Credits page checkout response and Stripe Dashboard checkout session.",
        live_subscription_checkout_canary: "Pricing/Credits subscription checkout response and Stripe Dashboard checkout session.",
        verified_webhook_receipt: "Billing Events provider log for /api/billing/webhooks/stripe/live.",
        duplicate_webhook_idempotency: "Billing Reconciliation duplicate/idempotency section.",
        wrong_price_id_rejection: "Billing Events ignored/review rows with wrong Price ID.",
        missing_webhook_secret_fail_closed: "Worker response from checkout with webhook secret absent.",
        no_credit_before_webhook: "Member credit ledger remains unchanged after checkout creation.",
        invoice_paid_subscription_credit_grant: "Member subscription bucket ledger after verified invoice.paid.",
        refund_dispute_failure_review_only: "Billing Reviews queue.",
        raw_payload_signature_secret_redaction: "Admin Live Billing and Billing Evidence payloads.",
        customer_portal_session_canary: "Member Credits page portal button and Stripe Portal session.",
        tax_invoice_configuration_review: "Stripe Dashboard tax/invoice settings and redacted env checklist.",
      }[item.id] || "Admin Live Billing Command Center.",
      nextAction: "Collect sanitized operator evidence; do not paste raw secrets, signatures, payloads, cards, cookies, or session values.",
    })),
    reviews: {
      totalShown: reviewRows.length,
      unresolved: unresolvedReviews.length,
      byState: countByField(reviewRows, "reviewState"),
    },
    reconciliation: {
      verdict: reconciliation?.verdict || "blocked",
      summary,
      notes: reconciliation?.notes || [],
    },
    actions: {
      refreshStatus: true,
      copyValidationCommands: true,
      copyCloudflareEnvChecklist: true,
      copyStripeDashboardChecklist: true,
      downloadSanitizedEvidenceJson: true,
      downloadSanitizedEvidenceMarkdown: true,
      openBillingReviews: true,
      openBillingReconciliation: true,
      openCreditsPage: true,
      createsLiveCheckout: false,
      callsStripe: false,
      refunds: false,
      creditMutation: false,
      subscriptionMutation: false,
    },
    nextOperatorActions,
  };
}

export async function handleAdminBilling(ctx) {
  const { request, env, url, pathname, method, isSecure, correlationId } = ctx;
  const isBillingRoute = pathname === "/api/admin/billing/plans"
    || pathname === "/api/admin/billing/evidence/status"
    || pathname === "/api/admin/billing/live-readiness/status"
    || pathname === "/api/admin/billing/events"
    || pathname === "/api/admin/billing/reconciliation"
    || pathname === "/api/admin/billing/reviews"
    || /^\/api\/admin\/billing\/events\/[^/]+$/.test(pathname)
    || /^\/api\/admin\/billing\/reviews\/[^/]+$/.test(pathname)
    || /^\/api\/admin\/billing\/reviews\/[^/]+\/resolution$/.test(pathname)
    || /^\/api\/admin\/orgs\/[^/]+\/billing$/.test(pathname)
    || /^\/api\/admin\/orgs\/[^/]+\/credits\/grant$/.test(pathname)
    || /^\/api\/admin\/users\/[^/]+\/billing$/.test(pathname)
    || /^\/api\/admin\/users\/[^/]+\/credits\/grant$/.test(pathname);
  if (!isBillingRoute) return null;

  const session = await requireAdmin(request, env, {
    isSecure,
    correlationId,
  });
  if (session instanceof Response) return session;

  if (pathname === "/api/admin/billing/plans" && method === "GET") {
    const limited = await enforceAdminBillingRateLimit(ctx);
    if (limited) return limited;
    const plans = await listAdminPlans(env);
    return json({ ok: true, plans, livePaymentProviderEnabled: false });
  }

  if (pathname === "/api/admin/billing/evidence/status" && method === "GET") {
    const limited = await enforceAdminBillingRateLimit(ctx);
    if (limited) return limited;
    return json(buildBillingEvidenceStatus(env));
  }

  if (pathname === "/api/admin/billing/live-readiness/status" && method === "GET") {
    const limited = await enforceAdminBillingRateLimit(ctx);
    if (limited) return limited;
    try {
      const status = await buildAdminLiveBillingReadinessStatus(env);
      return json(status);
    } catch (error) {
      return billingErrorJson(error, ctx);
    }
  }

  if (pathname === "/api/admin/billing/events" && method === "GET") {
    const limited = await enforceAdminBillingRateLimit(ctx);
    if (limited) return limited;
    try {
      const events = await listBillingProviderEvents(env, {
        provider: url.searchParams.get("provider"),
        status: url.searchParams.get("status"),
        eventType: url.searchParams.get("event_type") || url.searchParams.get("eventType"),
        organizationId: url.searchParams.get("organization_id") || url.searchParams.get("organizationId"),
        limit: url.searchParams.get("limit"),
      });
      return json({ ok: true, events, livePaymentProviderEnabled: false });
    } catch (error) {
      return billingErrorJson(error, ctx);
    }
  }

  if (pathname === "/api/admin/billing/reconciliation" && method === "GET") {
    const limited = await enforceAdminBillingRateLimit(ctx);
    if (limited) return limited;
    try {
      const report = await getBillingReconciliationReport(env);
      return json(report);
    } catch (error) {
      return billingErrorJson(error, ctx);
    }
  }

  if (pathname === "/api/admin/billing/reviews" && method === "GET") {
    const limited = await enforceAdminBillingRateLimit(ctx);
    if (limited) return limited;
    try {
      const result = await listBillingReviewEvents(env, {
        reviewState: url.searchParams.get("review_state") || url.searchParams.get("reviewState"),
        provider: url.searchParams.get("provider"),
        providerMode: url.searchParams.get("provider_mode") || url.searchParams.get("providerMode"),
        eventType: url.searchParams.get("event_type") || url.searchParams.get("eventType"),
        limit: url.searchParams.get("limit"),
      });
      return json({
        ok: true,
        reviews: result.reviews,
        nextCursor: result.nextCursor,
        livePaymentProviderEnabled: false,
      });
    } catch (error) {
      return billingErrorJson(error, ctx);
    }
  }

  const eventMatch = pathname.match(/^\/api\/admin\/billing\/events\/([^/]+)$/);
  if (eventMatch && method === "GET") {
    const limited = await enforceAdminBillingRateLimit(ctx);
    if (limited) return limited;
    try {
      const event = await getBillingProviderEvent(env, { id: eventMatch[1] });
      return json({ ok: true, event, livePaymentProviderEnabled: false });
    } catch (error) {
      return billingErrorJson(error, ctx);
    }
  }

  const reviewMatch = pathname.match(/^\/api\/admin\/billing\/reviews\/([^/]+)$/);
  if (reviewMatch && method === "GET") {
    const limited = await enforceAdminBillingRateLimit(ctx);
    if (limited) return limited;
    try {
      const review = await getBillingReviewEvent(env, { id: reviewMatch[1] });
      return json({
        ok: true,
        review,
        livePaymentProviderEnabled: false,
      });
    } catch (error) {
      return billingErrorJson(error, ctx);
    }
  }

  const reviewResolutionMatch = pathname.match(/^\/api\/admin\/billing\/reviews\/([^/]+)\/resolution$/);
  // route-policy: admin.billing.reviews.resolve
  if (reviewResolutionMatch && method === "POST") {
    const limited = await enforceAdminBillingRateLimit(ctx, {
      scope: "admin-billing-write-ip",
      maxRequests: 30,
      windowMs: 15 * 60_000,
      component: "admin-billing-write",
    });
    if (limited) return limited;

    const idempotency = idempotencyKeyOrResponse(request);
    if (idempotency.response) return idempotency.response;

    const parsed = await readJsonBodyOrResponse(request, {
      maxBytes: BODY_LIMITS.smallJson,
    });
    if (parsed.response) return parsed.response;

    try {
      const result = await resolveBillingReviewEvent(env, {
        id: reviewResolutionMatch[1],
        resolutionStatus: parsed.body?.resolution_status || parsed.body?.resolutionStatus,
        resolutionNote: parsed.body?.resolution_note || parsed.body?.resolutionNote,
        resolvedByUserId: session.user.id,
        idempotencyKey: idempotency.key,
      });
      if (!result.reused) {
        await auditBillingEvent(ctx, session.user, `billing_review_${result.review.resolutionStatus}`, {
          billing_event_id: result.review.billingEventId,
          provider: result.review.provider,
          provider_mode: result.review.providerMode,
          event_type: result.review.eventType,
          provider_event_id: result.review.providerEventId,
          review_state: result.review.reviewState,
          previous_review_state: result.review.actionSummary?.previousReviewState || null,
        });
      }
      return json({ ok: true, ...result, sideEffectsEnabled: false });
    } catch (error) {
      return billingErrorJson(error, ctx);
    }
  }

  const billingMatch = pathname.match(/^\/api\/admin\/orgs\/([^/]+)\/billing$/);
  if (billingMatch && method === "GET") {
    const limited = await enforceAdminBillingRateLimit(ctx);
    if (limited) return limited;
    try {
      const billing = await getAdminOrganizationBilling(env, {
        organizationId: billingMatch[1],
      });
      return json({ ok: true, billing });
    } catch (error) {
      return billingErrorJson(error, ctx);
    }
  }

  const grantMatch = pathname.match(/^\/api\/admin\/orgs\/([^/]+)\/credits\/grant$/);
  // route-policy: admin.orgs.credits.grant
  if (grantMatch && method === "POST") {
    const limited = await enforceAdminBillingRateLimit(ctx, {
      scope: "admin-billing-write-ip",
      maxRequests: 30,
      windowMs: 15 * 60_000,
      component: "admin-billing-write",
    });
    if (limited) return limited;

    const idempotency = idempotencyKeyOrResponse(request);
    if (idempotency.response) return idempotency.response;

    const parsed = await readJsonBodyOrResponse(request, {
      maxBytes: BODY_LIMITS.smallJson,
    });
    if (parsed.response) return parsed.response;

    try {
      const result = await grantOrganizationCredits({
        env,
        organizationId: grantMatch[1],
        amount: parsed.body?.amount,
        reason: parsed.body?.reason,
        createdByUserId: session.user.id,
        idempotencyKey: idempotency.key,
      });
      if (!result.reused) {
        await auditBillingEvent(ctx, session.user, "organization_credit_granted", {
          organization_id: grantMatch[1],
          amount: result.ledgerEntry.amount,
          balance_after: result.ledgerEntry.balanceAfter,
        });
      }
      return json({ ok: true, ...result }, { status: result.reused ? 200 : 201 });
    } catch (error) {
      return billingErrorJson(error, ctx);
    }
  }

  const userBillingMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/billing$/);
  if (userBillingMatch && method === "GET") {
    const limited = await enforceAdminBillingRateLimit(ctx);
    if (limited) return limited;
    try {
      const billing = await getAdminUserBilling(env, {
        userId: decodeURIComponent(userBillingMatch[1]),
      });
      return json({ ok: true, billing });
    } catch (error) {
      return billingErrorJson(error, ctx);
    }
  }

  const userGrantMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/credits\/grant$/);
  // route-policy: admin.users.credits.grant
  if (userGrantMatch && method === "POST") {
    const limited = await enforceAdminBillingRateLimit(ctx, {
      scope: "admin-billing-write-ip",
      maxRequests: 30,
      windowMs: 15 * 60_000,
      component: "admin-billing-write",
    });
    if (limited) return limited;

    const idempotency = idempotencyKeyOrResponse(request);
    if (idempotency.response) return idempotency.response;

    const parsed = await readJsonBodyOrResponse(request, {
      maxBytes: BODY_LIMITS.smallJson,
    });
    if (parsed.response) return parsed.response;

    const targetUserId = decodeURIComponent(userGrantMatch[1]);
    try {
      const result = await grantMemberCredits({
        env,
        userId: targetUserId,
        amount: parsed.body?.amount,
        reason: parsed.body?.reason,
        createdByUserId: session.user.id,
        idempotencyKey: idempotency.key,
      });
      if (!result.reused) {
        await auditBillingEvent(ctx, session.user, "user_credit_granted", {
          user_id: targetUserId,
          amount: result.ledgerEntry.amount,
          balance_after: result.ledgerEntry.balanceAfter,
        }, targetUserId);
      }
      return json({ ok: true, ...result }, { status: result.reused ? 200 : 201 });
    } catch (error) {
      return billingErrorJson(error, ctx);
    }
  }

  return null;
}
