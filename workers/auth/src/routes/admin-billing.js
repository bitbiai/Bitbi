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
  archiveOperatorBillingItems,
  applyOperatorBillingPurge,
  getBillingArchiveSummary,
  listOperatorBillingArchive,
  OPERATOR_PURGE_CONFIRMATION,
  previewOperatorBillingPurge,
  restoreOperatorBillingItems,
} from "../lib/operator-billing-cleanup.js";
import {
  getErrorFields,
  logDiagnostic,
} from "../../../../js/shared/worker-observability.mjs";
import {
  repairPaidLiveMemberCreditPackCheckout,
  StripeBillingError,
  stripeBillingErrorResponse,
} from "../lib/stripe-billing.js";

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

function parseBooleanFlag(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

function wantsArchivedBillingRows(url) {
  return parseBooleanFlag(url.searchParams.get("include_archived") || url.searchParams.get("includeArchived"))
    || String(url.searchParams.get("mode") || "").trim().toLowerCase() === "archive";
}

function billingErrorJson(error, ctx = null) {
  if (error instanceof BillingError) {
    return json(billingErrorResponse(error), { status: error.status });
  }
  if (error instanceof BillingEventError) {
    return json(billingEventErrorResponse(error), { status: error.status });
  }
  if (error instanceof StripeBillingError) {
    return json(stripeBillingErrorResponse(error), { status: error.status });
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
  if (text.includes("no_critical")) return "ready";
  if (text.includes("blocked") || text.includes("missing") || text.includes("invalid")) return "blocked";
  if (
    text.includes("incident")
    || text.includes("repair")
  ) return "pending";
  if (
    text.includes("operator_approved_live")
    || text.includes("operator_go_live_approved")
    || text.includes("operator_approved_live_with_evidence_waivers")
    || text.includes("partial_evidence_operator_approved")
  ) return "ready";
  if (
    text.includes("critical")
    || text.includes("warning")
    || text.includes("pending")
    || text.includes("waived")
    || text.includes("partial")
    || text.includes("review")
  ) return "pending";
  if (
    text.includes("configured")
    || text.includes("present")
    || text.includes("active")
    || text.includes("approved")
    || text.includes("live")
    || text.includes("operator")
    || text.includes("enabled")
  ) return "ready";
  return "pending";
}

function liveBillingFeatureStatus({ configured, enabled, operatorApproved }) {
  if (configured && enabled && operatorApproved) return "configured_enabled_operator_live";
  if (configured && enabled) return "configured_enabled";
  if (configured) return "configured_pending_enablement";
  return "missing_or_pending";
}

function liveBillingEvidenceOverride(id) {
  return {
    live_credit_pack_checkout_canary: {
      status: "live_fulfillment_failure_repair_required",
      nextAction: "Repair the paid 5000-credit member checkout with the dry-run-first admin repair path, then attach follow-up evidence showing exactly one +5000 purchased-credit grant.",
    },
    live_subscription_checkout_canary: {
      status: "operator_confirmed_bitbi_pro_active",
      nextAction: "Attach the final sanitized Stripe/BITBI subscription artifact when available.",
    },
    verified_webhook_receipt: {
      status: "operator_confirmed_admin_events_visible",
      nextAction: "Keep webhook delivery screenshots/export redacted; do not paste raw payloads or signatures.",
    },
    duplicate_webhook_idempotency: {
      status: "operator_waived_pending_artifact",
      nextAction: "Collect duplicate-delivery/idempotency proof after go-live monitoring if not already captured.",
    },
    wrong_price_id_rejection: {
      status: "repo_tests_operator_waived_pending_live_artifact",
      nextAction: "Keep wrong-price live evidence out of production unless performed as a safe controlled negative canary.",
    },
    missing_webhook_secret_fail_closed: {
      status: "repo_tests_operator_waived",
      nextAction: "Keep webhook secret configured in production; do not remove it for live evidence collection.",
    },
    no_credit_before_webhook: {
      status: "operator_waived_pending_artifact",
      nextAction: "Attach a sanitized before/after ledger excerpt if the operator wants full artifact backing.",
    },
    invoice_paid_subscription_credit_grant: {
      status: "operator_confirmed_bitbi_pro_payment_active",
      nextAction: "Attach sanitized invoice-paid/top-up evidence when available.",
    },
    refund_dispute_failure_review_only: {
      status: "repo_tests_operator_waived_pending_live_artifact",
      nextAction: "Monitor Billing Reviews; do not trigger refunds or disputes just to create evidence.",
    },
    raw_payload_signature_secret_redaction: {
      status: "secret_scan_and_redacted_export_passed",
      nextAction: "Continue running check:secrets before every evidence commit.",
    },
    customer_portal_session_canary: {
      status: "operator_confirmed_pay_bitbi_ai",
      nextAction: "Portal works through pay.bitbi.ai; do not store full portal session URLs.",
    },
    tax_invoice_configuration_review: {
      status: "disabled_by_default_operator_review_pending",
      nextAction: "Keep tax, tax ID, and invoice flags false until separate accounting/legal approval.",
    },
  }[id] || null;
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
  const [eventResult, reviews, reconciliation] = await Promise.all([
    listBillingProviderEvents(env, {
      provider: "stripe",
      providerMode: "live",
      limit: 25,
      includeArchiveSummary: true,
    }),
    listBillingReviewEvents(env, {
      provider: "stripe",
      providerMode: "live",
      limit: 25,
      includeArchiveSummary: true,
    }),
    getBillingReconciliationReport(env),
  ]);
  const events = eventResult.events || [];
  const archiveSummary = reconciliation?.archiveSummary || eventResult.archiveSummary || {};
  const reviewRows = Array.isArray(reviews?.reviews) ? reviews.reviews : [];
  const unresolvedReviews = reviewRows.filter((review) => !["resolved", "dismissed"].includes(String(review.reviewState || "").toLowerCase()));
  const blockingReviews = reviewRows.filter((review) => ["blocked", "needs_review", "critical"].includes(String(review.reviewState || "").toLowerCase()));
  const summary = reconciliation?.summary || {};
  const configShapeStatus = liveBillingConfigShapeStatus(evidence.config);
  const operatorApproved = true;
  const liveCreditPacksEnabled = evidence.config?.flags?.liveCreditPacks?.enabled === true;
  const liveSubscriptionsEnabled = evidence.config?.flags?.liveSubscriptions?.enabled === true;
  const creditPacksConfigured = evidence.creditPacks?.status === "configured_shape_present";
  const subscriptionConfigured = evidence.subscription?.status === "configured_shape_present";
  const liveWebhookConfigured = evidence.config?.secrets?.liveWebhookSecret?.present === true;
  const portalConfigured = evidence.customerPortal?.status === "configured_shape_present"
    || evidence.config?.urls?.liveCustomerPortalReturn?.present === true;
  const criticalReconciliationItems = Number(summary.criticalItems || 0);
  const reconciliationOperatorStatus = criticalReconciliationItems > 0
    ? "critical_items_operator_warning"
    : "no_critical_items_operator_accepted";
  const nextOperatorActions = [
    {
      id: "monitor_live_billing",
      label: "Monitor Billing Events, Billing Reviews, and Reconciliation during live operation.",
      inspect: "Admin -> Finance -> Live Billing, Billing Events, Billing Reconciliation.",
      safeAction: "Read-only monitoring; do not trigger refunds, clawbacks, or provider mutations from Admin.",
    },
    {
      id: "attach_remaining_artifacts",
      label: "Attach remaining waived or pending artifact-backed evidence when it is available.",
      inspect: "docs/production-readiness/evidence/operator-live-evidence-2026-06-12/.",
      safeAction: "Use shortened IDs and redacted screenshots/exports only.",
    },
    {
      id: "keep_tax_invoice_flags_disabled",
      label: "Keep Stripe Tax, tax ID collection, and invoice creation flags disabled until separate approval.",
      inspect: "Cloudflare Worker vars and Stripe Dashboard accounting/tax settings.",
      safeAction: "Optional tax/invoice settings remain false by default.",
    },
    {
      id: "confirm_live_flags",
      label: "Confirm live credit-pack and subscription enablement in Cloudflare without exposing values.",
      inspect: "Cloudflare Worker env vars and Admin Live Billing configured/enabled badges.",
      safeAction: "Operator-owned verification; this Admin page cannot read dashboard state outside its runtime env.",
    },
    {
      id: "rollback_if_needed",
      label: "If issues appear, disable live credit packs and subscriptions while keeping the webhook endpoint available.",
      inspect: "Cloudflare Worker vars, Billing Reviews, Billing Reconciliation.",
      safeAction: "Set ENABLE_LIVE_STRIPE_CREDIT_PACKS=false and ENABLE_LIVE_STRIPE_SUBSCRIPTIONS=false; do not delete ledger or evidence rows.",
    },
  ];
  const evidenceChecklist = (Array.isArray(evidence.evidenceRequired) ? evidence.evidenceRequired : []).map((item) => {
    const override = liveBillingEvidenceOverride(item.id);
    return {
      ...item,
      status: override?.status || item.status,
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
      nextAction: override?.nextAction || "Collect sanitized operator evidence; do not paste raw secrets, signatures, payloads, cards, cookies, or session values.",
    };
  });
  return {
    ok: true,
    version: "omega-p1-live-billing-readiness-v1",
    generatedAt: evidence.generatedAt,
    repositorySupport: "ready_for_operator_canary",
    productionReadiness: "operator_go_live_approved",
    productionReadinessScope: "billing_go_live_operator_approval_not_full_evidence_proven_production_maturity",
    liveBillingReadiness: "operator_approved_live",
    configShapeStatus,
    evidenceStatus: "partial_evidence_operator_approved_incident_open",
    archiveSummary: {
      ...archiveSummary,
      activeViewsExcludeArchived: true,
      readinessNotProvenByArchive: true,
      note: "Archived billing records are excluded from active operator counters and remain available in the archive. Archiving is not production-readiness evidence.",
    },
    canaryStatus: "operator_confirmed_manual_live_validation",
    finalVerdict: {
      status: "operator_approved_live_with_evidence_waivers",
      summary: "Live billing is enabled by operator approval. Artifact-backed evidence is partially complete; the 5000-credit-pack canary has an open paid-fulfillment repair incident.",
    },
    operatorApproval: {
      status: "operator_approved_live",
      approvedAt: "2026-06-13",
      approvedBy: "operator_attestation",
      artifactBackedEvidence: "partial",
      acceptedRemainingEvidenceRisk: true,
      evidencePackagePath: "docs/production-readiness/evidence/operator-live-evidence-2026-06-12/",
      confirmed: [
        "Stripe Customer Portal works via pay.bitbi.ai.",
        "BITBI Pro subscription/payment works.",
        "Admin Live Billing shows configured live billing support.",
      ],
      waivedOrPending: [
        "5000-credit-pack canary paid in Stripe but BITBI fulfillment failed; repair and follow-up evidence pending.",
        "Full artifact-backed no-credit-before-webhook evidence.",
        "Full duplicate webhook replay/idempotency artifact.",
        "Wrong Price ID live rejection artifact.",
        "Refund/dispute/failure live review-only artifact.",
        "Tax/invoice accounting/legal review remains separate and disabled by default.",
      ],
    },
    boundedResponse: true,
    redactedResponse: true,
    stripeCallsMade: false,
    checkoutSessionCreated: false,
    d1MutationPerformed: false,
    creditMutationPerformed: false,
    dangerousActionsOffered: [],
    copy: "Live billing is enabled by operator approval. Artifact-backed evidence is partially complete; the 5000-credit-pack canary has an open paid-fulfillment repair incident.",
    statusBadges: [
      { id: "repository_support", label: "Repository support", status: "ready_for_operator_canary", variant: "ready" },
      { id: "production_readiness", label: "Production readiness", status: "operator_go_live_approved", variant: "ready" },
      { id: "live_billing_readiness", label: "Live billing readiness", status: "operator_approved_live", variant: "ready" },
      { id: "config_shape", label: "Config shape", status: configShapeStatus, variant: liveBillingStatusVariant(configShapeStatus) },
      { id: "credit_packs", label: "Credit packs", status: liveBillingFeatureStatus({ configured: creditPacksConfigured, enabled: liveCreditPacksEnabled, operatorApproved }), variant: creditPacksConfigured && liveCreditPacksEnabled ? "ready" : "pending" },
      { id: "bitbi_pro", label: "BITBI Pro subscription", status: liveBillingFeatureStatus({ configured: subscriptionConfigured, enabled: liveSubscriptionsEnabled, operatorApproved }), variant: subscriptionConfigured && liveSubscriptionsEnabled ? "ready" : "pending" },
      { id: "webhook", label: "Webhook", status: liveWebhookConfigured ? "configured_operator_live" : "secret_missing", variant: liveWebhookConfigured ? "ready" : "blocked" },
      { id: "customer_portal", label: "Customer Portal", status: portalConfigured ? "configured_operator_confirmed_pay_bitbi_ai" : "missing_or_pending", variant: portalConfigured ? "ready" : "pending" },
      { id: "reconciliation", label: "Reconciliation", status: reconciliationOperatorStatus, variant: criticalReconciliationItems > 0 ? "pending" : "ready" },
      { id: "billing_reviews", label: "Billing reviews", status: `${blockingReviews.length} blocking_or_needs_review`, variant: blockingReviews.length ? "pending" : "ready" },
      { id: "evidence_status", label: "Evidence status", status: "partial_evidence_operator_approved_incident_open", variant: "pending" },
      { id: "canary_status", label: "Canary status", status: "operator_confirmed_manual_live_validation", variant: "ready" },
      { id: "final_verdict", label: "Final verdict", status: "operator_approved_live_with_evidence_waivers", variant: "ready" },
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
      status: portalConfigured ? "configured_operator_confirmed" : evidence.customerPortal?.status,
      sessionCanary: portalConfigured ? "operator_confirmed_pay_bitbi_ai" : evidence.customerPortal?.sessionCanary,
      operatorConfirmedPayBitbiAi: portalConfigured,
      memberTriggeredOnly: true,
      adminCustomerMutation: false,
    },
    taxInvoice: evidence.taxInvoice,
    evidenceChecklist,
    reviews: {
      totalShown: reviewRows.length,
      unresolved: unresolvedReviews.length,
      blockingOrNeedsReview: blockingReviews.length,
      byState: countByField(reviewRows, "reviewState"),
    },
    reconciliation: {
      verdict: reconciliation?.verdict || "blocked",
      operatorApprovalStatus: reconciliationOperatorStatus,
      criticalItems: criticalReconciliationItems,
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
    || pathname === "/api/admin/billing/live-credit-pack-repairs"
    || pathname === "/api/admin/billing/operator-archive"
    || pathname === "/api/admin/billing/operator-archive/restore"
    || pathname === "/api/admin/billing/operator-purge-preview"
    || pathname === "/api/admin/billing/operator-purge"
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
    const archiveSummary = await getBillingArchiveSummary(env);
    return json({
      ...buildBillingEvidenceStatus(env),
      archiveSummary: {
        ...archiveSummary,
        readinessNotProvenByArchive: true,
        note: "Archived billing records are excluded from active operator counters and remain available in the archive. Archiving is not production-readiness evidence.",
      },
    });
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
      const result = await listBillingProviderEvents(env, {
        provider: url.searchParams.get("provider"),
        status: url.searchParams.get("status"),
        eventType: url.searchParams.get("event_type") || url.searchParams.get("eventType"),
        organizationId: url.searchParams.get("organization_id") || url.searchParams.get("organizationId"),
        limit: url.searchParams.get("limit"),
        includeArchived: wantsArchivedBillingRows(url),
        includeArchiveSummary: true,
      });
      return json({
        ok: true,
        events: result.events || [],
        archiveSummary: result.archiveSummary,
        archivedExcludedByDefault: !wantsArchivedBillingRows(url),
        livePaymentProviderEnabled: false,
      });
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
      const includeArchived = wantsArchivedBillingRows(url);
      const result = await listBillingReviewEvents(env, {
        reviewState: url.searchParams.get("review_state") || url.searchParams.get("reviewState"),
        provider: url.searchParams.get("provider"),
        providerMode: url.searchParams.get("provider_mode") || url.searchParams.get("providerMode"),
        eventType: url.searchParams.get("event_type") || url.searchParams.get("eventType"),
        limit: url.searchParams.get("limit"),
        includeArchived,
        includeArchiveSummary: true,
      });
      return json({
        ok: true,
        reviews: result.reviews,
        nextCursor: result.nextCursor,
        archiveSummary: result.archiveSummary,
        archivedExcludedByDefault: !includeArchived,
        livePaymentProviderEnabled: false,
      });
    } catch (error) {
      return billingErrorJson(error, ctx);
    }
  }

  if (pathname === "/api/admin/billing/operator-archive" && method === "GET") {
    const limited = await enforceAdminBillingRateLimit(ctx);
    if (limited) return limited;
    try {
      const result = await listOperatorBillingArchive(env, {
        limit: url.searchParams.get("limit"),
        itemType: url.searchParams.get("item_type") || url.searchParams.get("itemType"),
        q: url.searchParams.get("q"),
        archivedOnly: url.searchParams.get("archived_only") || url.searchParams.get("archivedOnly"),
      });
      return json({ ok: true, ...result, livePaymentProviderEnabled: false });
    } catch (error) {
      return billingErrorJson(error, ctx);
    }
  }

  // route-policy: admin.billing.operator_archive.create
  if (pathname === "/api/admin/billing/operator-archive" && method === "POST") {
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
      const result = await archiveOperatorBillingItems({
        env,
        adminUserId: session.user.id,
        body: parsed.body,
        idempotencyKey: idempotency.key,
      });
      if (!result.reused) {
        await auditBillingEvent(ctx, session.user, result.run?.dryRun
          ? "billing_operator_archive_dry_run"
          : "billing_operator_archive_applied", {
          cleanup_run_id: result.run?.id,
          selection_scope: result.run?.selectionScope,
          dry_run: result.run?.dryRun === true,
          status: result.run?.status,
          affected_items: result.summary?.affectedItems || result.result?.affectedItems || 0,
        });
      }
      return json({ ok: true, ...result }, { status: result.run?.dryRun ? 200 : 201 });
    } catch (error) {
      return billingErrorJson(error, ctx);
    }
  }

  // route-policy: admin.billing.operator_archive.restore
  if (pathname === "/api/admin/billing/operator-archive/restore" && method === "POST") {
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
      const result = await restoreOperatorBillingItems({
        env,
        adminUserId: session.user.id,
        body: parsed.body,
        idempotencyKey: idempotency.key,
      });
      if (!result.reused) {
        await auditBillingEvent(ctx, session.user, result.run?.dryRun
          ? "billing_operator_restore_dry_run"
          : "billing_operator_restore_applied", {
          cleanup_run_id: result.run?.id,
          selection_scope: result.run?.selectionScope,
          dry_run: result.run?.dryRun === true,
          status: result.run?.status,
          affected_items: result.summary?.affectedItems || result.result?.restoredItems || 0,
        });
      }
      return json({ ok: true, ...result }, { status: result.run?.dryRun ? 200 : 201 });
    } catch (error) {
      return billingErrorJson(error, ctx);
    }
  }

  // route-policy: admin.billing.operator_purge.preview
  if (pathname === "/api/admin/billing/operator-purge-preview" && method === "POST") {
    const limited = await enforceAdminBillingRateLimit(ctx, {
      scope: "admin-billing-write-ip",
      maxRequests: 20,
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
      const result = await previewOperatorBillingPurge({
        env,
        adminUserId: session.user.id,
        body: parsed.body,
        idempotencyKey: idempotency.key,
      });
      if (!result.reused) {
        await auditBillingEvent(ctx, session.user, "billing_operator_purge_preview", {
          cleanup_run_id: result.run?.id,
          selection_scope: result.run?.selectionScope,
          status: result.run?.status,
          blocked: result.summary?.blockedItems || 0,
          deletable: result.summary?.deletableItems || 0,
        });
      }
      return json({
        ok: true,
        ...result,
        confirmationPhrase: OPERATOR_PURGE_CONFIRMATION,
      });
    } catch (error) {
      return billingErrorJson(error, ctx);
    }
  }

  // route-policy: admin.billing.operator_purge.apply
  if (pathname === "/api/admin/billing/operator-purge" && method === "POST") {
    const limited = await enforceAdminBillingRateLimit(ctx, {
      scope: "admin-billing-write-ip",
      maxRequests: 10,
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
      const result = await applyOperatorBillingPurge({
        env,
        adminUserId: session.user.id,
        body: parsed.body,
        idempotencyKey: idempotency.key,
      });
      if (!result.reused) {
        await auditBillingEvent(ctx, session.user, "billing_operator_purge_applied", {
          cleanup_run_id: result.run?.id,
          selection_scope: result.run?.selectionScope,
          status: result.run?.status,
          deleted_count: result.result?.deletedCount || 0,
          tombstones_created: result.result?.tombstonesCreated || 0,
        });
      }
      return json({ ok: true, ...result }, { status: result.reused ? 200 : 201 });
    } catch (error) {
      return billingErrorJson(error, ctx);
    }
  }

  const eventMatch = pathname.match(/^\/api\/admin\/billing\/events\/([^/]+)$/);
  if (eventMatch && method === "GET") {
    const limited = await enforceAdminBillingRateLimit(ctx);
    if (limited) return limited;
    try {
      const event = await getBillingProviderEvent(env, {
        id: eventMatch[1],
        includeArchived: wantsArchivedBillingRows(url),
      });
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
      const review = await getBillingReviewEvent(env, {
        id: reviewMatch[1],
        includeArchived: wantsArchivedBillingRows(url),
      });
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

  // route-policy: admin.billing.live_credit_pack_repairs.create
  if (pathname === "/api/admin/billing/live-credit-pack-repairs" && method === "POST") {
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
      const result = await repairPaidLiveMemberCreditPackCheckout({
        env,
        checkoutId: parsed.body?.checkout_id || parsed.body?.checkoutId,
        stripeCheckoutSessionId: parsed.body?.stripe_checkout_session_id || parsed.body?.stripeCheckoutSessionId,
        expectedCreditPackId: parsed.body?.expected_credit_pack_id || parsed.body?.expectedCreditPackId,
        expectedCredits: parsed.body?.expected_credits ?? parsed.body?.expectedCredits,
        expectedAmountCents: parsed.body?.expected_amount_cents ?? parsed.body?.expectedAmountCents,
        expectedCurrency: parsed.body?.expected_currency || parsed.body?.expectedCurrency,
        evidence: parsed.body?.evidence,
        dryRun: parsed.body?.dry_run !== false && parsed.body?.dryRun !== false,
        confirm: parsed.body?.confirm === true,
        confirmation: parsed.body?.confirmation,
        reason: parsed.body?.reason,
        adminUserId: session.user.id,
        idempotencyKey: idempotency.key,
      });
      await auditBillingEvent(ctx, session.user, result.applied
        ? "live_member_credit_pack_repair_applied"
        : "live_member_credit_pack_repair_dry_run", {
        checkout_id: result.checkout?.id,
        target_user_id: result.checkout?.userId,
        session_id: result.checkout?.sessionId,
        credit_pack_id: result.checkout?.creditPack?.id,
        credits: result.wouldGrantCredits || result.checkout?.creditPack?.credits || result.creditGrant?.creditsGranted,
        amount_cents: result.checkout?.creditPack?.amountCents,
        currency: result.checkout?.creditPack?.currency,
        status: result.status,
        dry_run: result.dryRun === true,
        applied: result.applied === true,
        reused: result.reused === true,
        evidence_mode: result.evidenceMode,
      }, result.checkout?.userId || null);
      return json({ ok: true, ...result }, { status: result.applied && !result.reused ? 201 : 200 });
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
