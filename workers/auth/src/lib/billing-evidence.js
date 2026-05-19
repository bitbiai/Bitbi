import { nowIso } from "./tokens.js";
import {
  BITBI_LIVE_CREDIT_PACKS,
} from "../../../../js/shared/live-credit-packs.mjs";
import {
  BITBI_MEMBER_SUBSCRIPTION,
} from "../../../../js/shared/member-subscription.mjs";

const LIVE_CONFIG_NAMES = Object.freeze([
  "ENABLE_LIVE_STRIPE_CREDIT_PACKS",
  "ENABLE_LIVE_STRIPE_SUBSCRIPTIONS",
  "STRIPE_LIVE_SECRET_KEY",
  "STRIPE_LIVE_WEBHOOK_SECRET",
  "STRIPE_LIVE_SUBSCRIPTION_PRICE_ID",
  "STRIPE_LIVE_CHECKOUT_SUCCESS_URL",
  "STRIPE_LIVE_CHECKOUT_CANCEL_URL",
  "STRIPE_LIVE_SUBSCRIPTION_SUCCESS_URL",
  "STRIPE_LIVE_SUBSCRIPTION_CANCEL_URL",
]);

function safeString(value, maxLength = 256) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.slice(0, maxLength);
}

function presence(env, name, maxLength = 2048) {
  return safeString(env?.[name], maxLength);
}

function flagEvidence(env, name) {
  const value = presence(env, name, 16);
  return {
    name,
    present: Boolean(value),
    enabled: value === "true",
    expected: "true",
    status: value === "true" ? "enabled" : value ? "disabled_or_non_true" : "missing",
    valueExposed: false,
  };
}

function secretShape(value, expectedPrefix) {
  if (!value) return "missing";
  if (value.startsWith(expectedPrefix)) return "expected_prefix_present";
  if (value.startsWith("sk_test_")) return "test_key_rejected_for_live";
  if (value.startsWith("sk_live_")) return "live_key_present";
  if (value.startsWith("whsec_")) return "webhook_secret_shape_present";
  return "unknown_or_invalid_shape";
}

function secretEvidence(env, name, expectedPrefix) {
  const value = presence(env, name, 512);
  const shape = secretShape(value, expectedPrefix);
  return {
    name,
    present: Boolean(value),
    status: !value ? "missing" : shape === "expected_prefix_present" ? "present_shape_ok" : "present_shape_review_required",
    shape,
    valueExposed: false,
  };
}

function suffix(value) {
  if (!value) return null;
  return value.length <= 8 ? value : value.slice(-8);
}

function priceIdEvidence(env) {
  const value = presence(env, "STRIPE_LIVE_SUBSCRIPTION_PRICE_ID", 128);
  const validShape = /^price_[A-Za-z0-9_:-]{8,120}$/.test(value);
  return {
    name: "STRIPE_LIVE_SUBSCRIPTION_PRICE_ID",
    present: Boolean(value),
    status: !value ? "missing" : validShape ? "present_shape_ok" : "present_shape_review_required",
    shape: !value ? "missing" : validShape ? "price_id_shape_present" : "invalid_or_unknown_shape",
    safeSuffix: suffix(value),
    valueExposed: false,
  };
}

function urlEvidence(env, name) {
  const value = presence(env, name, 2048);
  if (!value) {
    return {
      name,
      present: false,
      status: "missing",
      valueExposed: false,
    };
  }
  try {
    const url = new URL(value);
    return {
      name,
      present: true,
      status: url.protocol === "https:" ? "present_https" : "present_not_https",
      protocol: url.protocol.replace(":", ""),
      origin: url.origin,
      pathname: url.pathname || "/",
      queryPresent: Boolean(url.search),
      valueExposed: false,
    };
  } catch {
    return {
      name,
      present: true,
      status: "present_invalid_url",
      valueExposed: false,
    };
  }
}

function stripeModeEvidence(env) {
  const value = presence(env, "STRIPE_MODE", 16);
  const normalized = value === "test" || value === "live" ? value : value ? "unsupported" : "missing";
  return {
    name: "STRIPE_MODE",
    present: Boolean(value),
    mode: normalized,
    status: value === "test" ? "testmode_configured" : value === "live" ? "live_mode_review_required" : value ? "unsupported" : "missing",
    valueExposed: value === "test" || value === "live",
  };
}

function statusForRequired(items) {
  return items.every((item) => item.present && !String(item.status || "").includes("missing") && !String(item.status || "").includes("invalid") && !String(item.status || "").includes("not_https"))
    ? "configured_shape_present"
    : "missing_or_pending";
}

export function buildBillingEvidenceStatus(env = {}) {
  const creditPacksFlag = flagEvidence(env, "ENABLE_LIVE_STRIPE_CREDIT_PACKS");
  const subscriptionsFlag = flagEvidence(env, "ENABLE_LIVE_STRIPE_SUBSCRIPTIONS");
  const liveSecret = secretEvidence(env, "STRIPE_LIVE_SECRET_KEY", "sk_live_");
  const liveWebhookSecret = secretEvidence(env, "STRIPE_LIVE_WEBHOOK_SECRET", "whsec_");
  const priceId = priceIdEvidence(env);
  const creditPackSuccessUrl = urlEvidence(env, "STRIPE_LIVE_CHECKOUT_SUCCESS_URL");
  const creditPackCancelUrl = urlEvidence(env, "STRIPE_LIVE_CHECKOUT_CANCEL_URL");
  const subscriptionSuccessUrl = urlEvidence(env, "STRIPE_LIVE_SUBSCRIPTION_SUCCESS_URL");
  const subscriptionCancelUrl = urlEvidence(env, "STRIPE_LIVE_SUBSCRIPTION_CANCEL_URL");

  const activePacks = BITBI_LIVE_CREDIT_PACKS
    .filter((pack) => pack.active !== false)
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))
    .map((pack) => ({
      id: pack.id,
      name: pack.name,
      credits: pack.credits,
      amountCents: pack.amountCents,
      currency: pack.currency,
      displayPrice: pack.displayPrice || null,
      active: pack.active !== false,
    }));

  const creditPackRequired = [
    creditPacksFlag,
    liveSecret,
    liveWebhookSecret,
    creditPackSuccessUrl,
    creditPackCancelUrl,
  ];
  const subscriptionRequired = [
    subscriptionsFlag,
    liveSecret,
    liveWebhookSecret,
    priceId,
    subscriptionSuccessUrl,
    subscriptionCancelUrl,
  ];

  return {
    ok: true,
    version: "omega-p1-wave7-billing-evidence-v1",
    generatedAt: nowIso(),
    source: "worker_env_and_static_catalog_only",
    productionReadiness: "blocked",
    liveBillingReadiness: "blocked",
    boundedResponse: true,
    redactedResponse: true,
    stripeCallsMade: false,
    checkoutSessionCreated: false,
    webhookMutationPerformed: false,
    d1MutationPerformed: false,
    creditMutationPerformed: false,
    config: {
      namesInspected: LIVE_CONFIG_NAMES,
      flags: {
        liveCreditPacks: creditPacksFlag,
        liveSubscriptions: subscriptionsFlag,
      },
      stripeMode: stripeModeEvidence(env),
      secrets: {
        liveSecretKey: liveSecret,
        liveWebhookSecret,
      },
      priceIds: {
        liveSubscriptionPriceId: priceId,
      },
      urls: {
        liveCreditPackSuccess: creditPackSuccessUrl,
        liveCreditPackCancel: creditPackCancelUrl,
        liveSubscriptionSuccess: subscriptionSuccessUrl,
        liveSubscriptionCancel: subscriptionCancelUrl,
      },
    },
    creditPacks: {
      status: statusForRequired(creditPackRequired),
      configuredCount: activePacks.length,
      activePacks,
      checkoutCanary: "pending_operator_evidence",
      noCreditBeforeWebhook: true,
    },
    subscription: {
      status: statusForRequired(subscriptionRequired),
      checkoutCanary: "pending_operator_evidence",
      invoicePaidEvidence: "pending_operator_evidence",
      plan: {
        id: BITBI_MEMBER_SUBSCRIPTION.id,
        name: BITBI_MEMBER_SUBSCRIPTION.name,
        amountCents: BITBI_MEMBER_SUBSCRIPTION.amountCents,
        currency: BITBI_MEMBER_SUBSCRIPTION.currency,
        displayPrice: BITBI_MEMBER_SUBSCRIPTION.displayPrice,
        interval: BITBI_MEMBER_SUBSCRIPTION.interval,
        allowanceCredits: BITBI_MEMBER_SUBSCRIPTION.allowanceCredits,
        storageLimitBytes: BITBI_MEMBER_SUBSCRIPTION.storageLimitBytes,
        rolloverPolicy: "subscription_bucket_top_up_no_automatic_rollover_claim",
      },
    },
    failClosedFacts: [
      "Checkout creation does not grant credits.",
      "Verified webhook or paid invoice event is required before credit grant.",
      "Live credit-pack checkout requires the live webhook secret before checkout creation.",
      "Live subscription checkout requires the live webhook secret before checkout creation.",
      "Wrong price ID or provider mode grants no subscription credits.",
      "Refund, dispute, and payment-failure events are review-only and do not claw back credits automatically.",
      "Raw Stripe payloads, signatures, and secret values are not returned by admin billing evidence endpoints.",
      "Live billing readiness remains blocked until operator canary evidence is attached and reviewed.",
    ],
    evidenceRequired: [
      { id: "live_credit_pack_checkout_canary", status: "pending_operator_evidence" },
      { id: "live_subscription_checkout_canary", status: "pending_operator_evidence" },
      { id: "verified_webhook_receipt", status: "pending_operator_evidence" },
      { id: "duplicate_webhook_idempotency", status: "pending_operator_evidence" },
      { id: "wrong_price_id_rejection", status: "pending_operator_evidence" },
      { id: "missing_webhook_secret_fail_closed", status: "pending_operator_evidence" },
      { id: "no_credit_before_webhook", status: "repo_tests_required_operator_review" },
      { id: "invoice_paid_subscription_credit_grant", status: "pending_operator_evidence" },
      { id: "refund_dispute_failure_review_only", status: "repo_tests_required_operator_review" },
      { id: "raw_payload_signature_secret_redaction", status: "repo_tests_required_operator_review" },
    ],
    safeActions: [
      "Refresh billing evidence status.",
      "Open Billing Reviews.",
      "Open Billing Reconciliation.",
      "Copy docs/production-readiness/EVIDENCE_TEMPLATE.md.",
      "Copy npm run billing:canary-evidence.",
      "Copy targeted local billing validation commands.",
    ],
    dangerousActionsOffered: [],
  };
}
