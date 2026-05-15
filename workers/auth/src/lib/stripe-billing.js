import {
  BillingError,
  getActiveMemberSubscription,
  getCreditBalance,
  grantMemberCredits,
  grantOrganizationCredits,
  normalizeBillingIdempotencyKey,
  topUpMemberSubscriptionCredits,
  upsertMemberSubscriptionFromProvider,
} from "./billing.js";
import { BITBI_LIVE_CREDIT_PACKS } from "../../../../js/shared/live-credit-packs.mjs";
import { BITBI_MEMBER_SUBSCRIPTION } from "../../../../js/shared/member-subscription.mjs";
import {
  BillingEventError,
  BILLING_WEBHOOK_STRIPE_PROVIDER,
  ingestVerifiedBillingProviderEvent,
  parseBillingWebhookPayload,
  updateBillingProviderEventProcessing,
} from "./billing-events.js";
import { normalizeOrgId } from "./orgs.js";
import { nowIso, randomTokenHex, sha256Hex } from "./tokens.js";

export const STRIPE_MODE_TEST = "test";
export const STRIPE_MODE_LIVE = "live";
export const STRIPE_WEBHOOK_TOLERANCE_MS = 5 * 60_000;
export const STRIPE_CHECKOUT_API_URL = "https://api.stripe.com/v1/checkout/sessions";
export const STRIPE_SUBSCRIPTIONS_API_URL = "https://api.stripe.com/v1/subscriptions";

const STRIPE_SIGNATURE_HEADER = "stripe-signature";
const TEST_CHECKOUT_SESSION_ID_PATTERN = /^cs_test_[A-Za-z0-9_:-]{8,200}$/;
const LIVE_CHECKOUT_SESSION_ID_PATTERN = /^cs_live_[A-Za-z0-9_:-]{8,200}$/;
const TEST_PAYMENT_INTENT_ID_PATTERN = /^pi_test_[A-Za-z0-9_:-]{8,200}$/;
const LIVE_PAYMENT_INTENT_ID_PATTERN = /^pi_live_[A-Za-z0-9_:-]{8,200}$/;
const LIVE_SUBSCRIPTION_ID_PATTERN = /^sub_[A-Za-z0-9_:-]{8,200}$/;
const LIVE_INVOICE_ID_PATTERN = /^in_[A-Za-z0-9_:-]{8,200}$/;
const USER_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const CHECKOUT_SESSION_URL_ORIGINS = new Set([
  "https://checkout.stripe.com",
  "https://pay.bitbi.ai",
]);
const STRIPE_CHECKOUT_TIMEOUT_MS = 10_000;
const LIVE_AUTH_SCOPES = new Set(["platform_admin", "org_owner"]);
const LIVE_MEMBER_AUTH_SCOPE = "member";
const LIVE_ORGANIZATION_CHECKOUT_SCOPE = "organization";
const LIVE_MEMBER_CHECKOUT_SCOPE = "member";
const LIVE_MEMBER_SUBSCRIPTION_CHECKOUT_SCOPE = "member_subscription";
export const BITBI_TERMS_VERSION = "2026-05-05";

const LIVE_OPERATOR_REVIEW_POLICIES = Object.freeze({
  "invoice.payment_failed": Object.freeze({
    reviewState: "needs_review",
    recommendedAction: "Review the invoice, customer, subscription state, and Stripe retry outcome before granting access or credits.",
    reason: "Stripe reported a failed live invoice payment; BITBI does not grant or revoke credits automatically for this event.",
  }),
  "invoice.payment_action_required": Object.freeze({
    reviewState: "needs_review",
    recommendedAction: "Review the customer payment-action requirement in Stripe and confirm whether the subscription should remain pending.",
    reason: "Stripe reported that live invoice payment requires customer action; BITBI does not grant or revoke credits automatically for this event.",
  }),
  "checkout.session.expired": Object.freeze({
    reviewState: "informational",
    recommendedAction: "Confirm the expired checkout did not complete elsewhere; no automatic credit grant is performed.",
    reason: "Stripe reported a live checkout session expired.",
  }),
  "charge.refunded": Object.freeze({
    reviewState: "needs_review",
    recommendedAction: "Review the live charge refund in Stripe, match it to any BITBI ledger entries, and decide on manual remediation.",
    reason: "Stripe reported a refunded live charge; BITBI does not automatically claw back credits.",
  }),
  "refund.created": Object.freeze({
    reviewState: "needs_review",
    recommendedAction: "Review the live refund creation in Stripe, match it to any BITBI ledger entries, and decide on manual remediation.",
    reason: "Stripe reported a live refund was created; BITBI does not automatically claw back credits.",
  }),
  "refund.updated": Object.freeze({
    reviewState: "needs_review",
    recommendedAction: "Review the live refund update in Stripe and confirm whether any manual billing action is required.",
    reason: "Stripe reported a live refund update; BITBI does not automatically adjust credits.",
  }),
  "charge.dispute.created": Object.freeze({
    reviewState: "blocked",
    recommendedAction: "Treat the disputed charge as blocked for operator review; investigate in Stripe and decide any manual account or credit action.",
    reason: "Stripe reported a new live dispute; BITBI does not automatically remove credits or cancel access.",
  }),
  "charge.dispute.updated": Object.freeze({
    reviewState: "needs_review",
    recommendedAction: "Review the live dispute update in Stripe and decide whether manual billing or account action is required.",
    reason: "Stripe reported a live dispute update; BITBI does not automatically adjust credits.",
  }),
  "charge.dispute.closed": Object.freeze({
    reviewState: "needs_review",
    recommendedAction: "Review the closed live dispute outcome in Stripe and decide whether manual billing or account action is required.",
    reason: "Stripe reported a live dispute closed; BITBI does not automatically adjust credits.",
  }),
});

export const STRIPE_CREDIT_PACKS = Object.freeze([
  Object.freeze({
    id: "credits_5000",
    name: "5000 Credit Pack",
    credits: 5000,
    amountCents: 4900,
    currency: "eur",
    active: true,
    sortOrder: 5000,
  }),
  Object.freeze({
    id: "credits_10000",
    name: "10000 Credit Pack",
    credits: 10000,
    amountCents: 8900,
    currency: "eur",
    active: true,
    sortOrder: 10000,
  }),
]);

export const STRIPE_LIVE_CREDIT_PACKS = BITBI_LIVE_CREDIT_PACKS;

const STRIPE_LIVE_LEGACY_CREDIT_PACKS = Object.freeze([
  Object.freeze({
    id: "live_credits_10000",
    name: "10000 Credit Pack",
    credits: 10000,
    amountCents: 150,
    currency: "eur",
    displayPrice: "1,50 €",
    active: false,
    sortOrder: 10000,
  }),
]);

export class StripeBillingError extends Error {
  constructor(message, {
    status = 400,
    code = "stripe_billing_error",
    configNames = [],
    missingConfigNames = [],
  } = {}) {
    super(message);
    this.name = "StripeBillingError";
    this.status = status;
    this.code = code;
    this.configNames = normalizeConfigNames(configNames);
    this.missingConfigNames = normalizeConfigNames(missingConfigNames);
  }
}

export function stripeBillingErrorResponse(error) {
  const body = {
    ok: false,
    error: error.message || "Stripe billing request failed.",
    code: error.code || "stripe_billing_error",
  };
  if (error.configNames?.length) body.config_names = error.configNames;
  if (error.missingConfigNames?.length) body.missing_config_names = error.missingConfigNames;
  return body;
}

function normalizeConfigNames(names) {
  const seen = new Set();
  const normalized = [];
  for (const name of Array.isArray(names) ? names : []) {
    const value = String(name || "").trim();
    if (!/^[A-Z][A-Z0-9_]{1,127}$/.test(value) || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

function checkoutSessionId() {
  return `bcs_${randomTokenHex(16)}`;
}

function safeString(value, maxLength = 256) {
  const text = String(value || "").trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

function normalizeStripeMode(env) {
  const mode = safeString(env?.STRIPE_MODE, 16);
  if (!mode) {
    throw new StripeBillingError("Stripe Testmode is not configured.", {
      status: 503,
      code: "stripe_testmode_unavailable",
      configNames: ["STRIPE_MODE"],
      missingConfigNames: ["STRIPE_MODE"],
    });
  }
  if (mode !== STRIPE_MODE_TEST) {
    throw new StripeBillingError("Live Stripe billing is disabled.", {
      status: 403,
      code: "stripe_live_mode_disabled",
      configNames: ["STRIPE_MODE"],
    });
  }
  return mode;
}

function normalizeAdminStripeCheckoutEnabled(env) {
  const value = safeString(env?.ENABLE_ADMIN_STRIPE_TEST_CHECKOUT, 16);
  if (value !== "true") {
    throw new StripeBillingError("Admin Stripe Testmode checkout is disabled.", {
      status: 503,
      code: "stripe_admin_test_checkout_disabled",
      configNames: ["ENABLE_ADMIN_STRIPE_TEST_CHECKOUT"],
      missingConfigNames: value ? [] : ["ENABLE_ADMIN_STRIPE_TEST_CHECKOUT"],
    });
  }
  return true;
}

function normalizeStripeSecretKey(env) {
  const key = safeString(env?.STRIPE_SECRET_KEY, 256);
  if (!key) {
    throw new StripeBillingError("Stripe Testmode secret key is not configured.", {
      status: 503,
      code: "stripe_secret_unavailable",
      configNames: ["STRIPE_SECRET_KEY"],
      missingConfigNames: ["STRIPE_SECRET_KEY"],
    });
  }
  if (key.startsWith("sk_live_")) {
    throw new StripeBillingError("Live Stripe keys are disabled.", {
      status: 403,
      code: "stripe_live_mode_disabled",
      configNames: ["STRIPE_SECRET_KEY"],
    });
  }
  if (!key.startsWith("sk_test_")) {
    throw new StripeBillingError("Stripe Testmode secret key is invalid.", {
      status: 503,
      code: "stripe_secret_unavailable",
      configNames: ["STRIPE_SECRET_KEY"],
    });
  }
  return key;
}

function normalizeStripeWebhookSecret(env) {
  const secret = safeString(env?.STRIPE_WEBHOOK_SECRET, 256);
  if (!secret) {
    throw new StripeBillingError("Stripe webhook verification is not configured.", {
      status: 503,
      code: "stripe_webhook_secret_unavailable",
      configNames: ["STRIPE_WEBHOOK_SECRET"],
      missingConfigNames: ["STRIPE_WEBHOOK_SECRET"],
    });
  }
  if (!secret.startsWith("whsec_") || secret.length < 16) {
    throw new StripeBillingError("Stripe webhook verification is not configured.", {
      status: 503,
      code: "stripe_webhook_secret_unavailable",
      configNames: ["STRIPE_WEBHOOK_SECRET"],
    });
  }
  return secret;
}

function normalizeLiveStripeCreditPacksEnabled(env) {
  const value = safeString(env?.ENABLE_LIVE_STRIPE_CREDIT_PACKS, 16);
  if (value !== "true") {
    throw new StripeBillingError("Live Stripe credit-pack checkout is disabled.", {
      status: 503,
      code: "stripe_live_credit_packs_disabled",
      configNames: ["ENABLE_LIVE_STRIPE_CREDIT_PACKS"],
      missingConfigNames: value ? [] : ["ENABLE_LIVE_STRIPE_CREDIT_PACKS"],
    });
  }
  return true;
}

function normalizeLiveStripeSubscriptionsEnabled(env) {
  const value = safeString(env?.ENABLE_LIVE_STRIPE_SUBSCRIPTIONS, 16);
  if (value !== "true") {
    throw new StripeBillingError("Live Stripe subscription checkout is disabled.", {
      status: 503,
      code: "stripe_live_subscriptions_disabled",
      configNames: ["ENABLE_LIVE_STRIPE_SUBSCRIPTIONS"],
      missingConfigNames: value ? [] : ["ENABLE_LIVE_STRIPE_SUBSCRIPTIONS"],
    });
  }
  return true;
}

function normalizeStripeLiveSecretKey(env) {
  const key = safeString(env?.STRIPE_LIVE_SECRET_KEY, 256);
  if (!key) {
    throw new StripeBillingError("Stripe live secret key is not configured.", {
      status: 503,
      code: "stripe_live_secret_unavailable",
      configNames: ["STRIPE_LIVE_SECRET_KEY"],
      missingConfigNames: ["STRIPE_LIVE_SECRET_KEY"],
    });
  }
  if (key.startsWith("sk_test_")) {
    throw new StripeBillingError("Stripe Testmode keys cannot be used for live credit packs.", {
      status: 403,
      code: "stripe_live_secret_invalid",
      configNames: ["STRIPE_LIVE_SECRET_KEY"],
    });
  }
  if (!key.startsWith("sk_live_")) {
    throw new StripeBillingError("Stripe live secret key is invalid.", {
      status: 503,
      code: "stripe_live_secret_unavailable",
      configNames: ["STRIPE_LIVE_SECRET_KEY"],
    });
  }
  return key;
}

function normalizeStripeLiveWebhookSecret(env) {
  const secret = safeString(env?.STRIPE_LIVE_WEBHOOK_SECRET, 256);
  if (!secret) {
    throw new StripeBillingError("Stripe live webhook verification is not configured.", {
      status: 503,
      code: "stripe_live_webhook_secret_unavailable",
      configNames: ["STRIPE_LIVE_WEBHOOK_SECRET"],
      missingConfigNames: ["STRIPE_LIVE_WEBHOOK_SECRET"],
    });
  }
  if (!secret.startsWith("whsec_") || secret.length < 16) {
    throw new StripeBillingError("Stripe live webhook verification is not configured.", {
      status: 503,
      code: "stripe_live_webhook_secret_unavailable",
      configNames: ["STRIPE_LIVE_WEBHOOK_SECRET"],
    });
  }
  return secret;
}

function normalizeHttpsUrl(value, fieldName, configName) {
  const text = safeString(value, 2048);
  if (!text) {
    throw new StripeBillingError(`${fieldName} is not configured.`, {
      status: 503,
      code: "stripe_checkout_url_unavailable",
      configNames: [configName],
      missingConfigNames: [configName],
    });
  }
  try {
    const url = new URL(text);
    if (url.protocol !== "https:") throw new Error("not https");
    return url.toString();
  } catch {
    throw new StripeBillingError(`${fieldName} must be an HTTPS URL.`, {
      status: 503,
      code: "stripe_checkout_url_unavailable",
      configNames: [configName],
    });
  }
}

function getStripeCheckoutConfig(env) {
  normalizeAdminStripeCheckoutEnabled(env);
  return {
    mode: normalizeStripeMode(env),
    secretKey: normalizeStripeSecretKey(env),
    successUrl: normalizeHttpsUrl(
      env?.STRIPE_CHECKOUT_SUCCESS_URL,
      "Stripe checkout success URL",
      "STRIPE_CHECKOUT_SUCCESS_URL"
    ),
    cancelUrl: normalizeHttpsUrl(
      env?.STRIPE_CHECKOUT_CANCEL_URL,
      "Stripe checkout cancel URL",
      "STRIPE_CHECKOUT_CANCEL_URL"
    ),
  };
}

function getStripeLiveCheckoutConfig(env) {
  normalizeLiveStripeCreditPacksEnabled(env);
  normalizeStripeLiveWebhookSecret(env);
  return {
    mode: STRIPE_MODE_LIVE,
    secretKey: normalizeStripeLiveSecretKey(env),
    successUrl: normalizeHttpsUrl(
      env?.STRIPE_LIVE_CHECKOUT_SUCCESS_URL,
      "Stripe live checkout success URL",
      "STRIPE_LIVE_CHECKOUT_SUCCESS_URL"
    ),
    cancelUrl: normalizeHttpsUrl(
      env?.STRIPE_LIVE_CHECKOUT_CANCEL_URL,
      "Stripe live checkout cancel URL",
      "STRIPE_LIVE_CHECKOUT_CANCEL_URL"
    ),
  };
}

function normalizeStripeLiveSubscriptionPriceId(env) {
  const priceId = safeString(env?.STRIPE_LIVE_SUBSCRIPTION_PRICE_ID, 128);
  if (!priceId) {
    throw new StripeBillingError("Stripe live subscription Price ID is not configured.", {
      status: 503,
      code: "stripe_live_subscription_price_unavailable",
      configNames: ["STRIPE_LIVE_SUBSCRIPTION_PRICE_ID"],
      missingConfigNames: ["STRIPE_LIVE_SUBSCRIPTION_PRICE_ID"],
    });
  }
  if (!/^price_[A-Za-z0-9_:-]{8,120}$/.test(priceId)) {
    throw new StripeBillingError("Stripe live subscription Price ID is invalid.", {
      status: 503,
      code: "stripe_live_subscription_price_invalid",
      configNames: ["STRIPE_LIVE_SUBSCRIPTION_PRICE_ID"],
    });
  }
  return priceId;
}

function getStripeLiveSubscriptionCheckoutConfig(env) {
  normalizeLiveStripeSubscriptionsEnabled(env);
  normalizeStripeLiveWebhookSecret(env);
  return {
    mode: STRIPE_MODE_LIVE,
    secretKey: normalizeStripeLiveSecretKey(env),
    priceId: normalizeStripeLiveSubscriptionPriceId(env),
    successUrl: normalizeHttpsUrl(
      env?.STRIPE_LIVE_SUBSCRIPTION_SUCCESS_URL,
      "Stripe live subscription success URL",
      "STRIPE_LIVE_SUBSCRIPTION_SUCCESS_URL"
    ),
    cancelUrl: normalizeHttpsUrl(
      env?.STRIPE_LIVE_SUBSCRIPTION_CANCEL_URL,
      "Stripe live subscription cancel URL",
      "STRIPE_LIVE_SUBSCRIPTION_CANCEL_URL"
    ),
  };
}

function getStripeLiveSubscriptionManagementConfig(env) {
  return {
    mode: STRIPE_MODE_LIVE,
    secretKey: normalizeStripeLiveSecretKey(env),
    priceId: normalizeStripeLiveSubscriptionPriceId(env),
  };
}

export function getStripeLiveCreditPackCheckoutStatus(env, { includeConfigNames = false } = {}) {
  const requiredNames = [
    "ENABLE_LIVE_STRIPE_CREDIT_PACKS",
    "STRIPE_LIVE_SECRET_KEY",
    "STRIPE_LIVE_WEBHOOK_SECRET",
    "STRIPE_LIVE_CHECKOUT_SUCCESS_URL",
    "STRIPE_LIVE_CHECKOUT_CANCEL_URL",
  ];
  const missing = requiredNames.filter((name) => !safeString(env?.[name], 2048));
  let enabled = false;
  let configured = false;
  let code = null;
  try {
    getStripeLiveCheckoutConfig(env);
    enabled = true;
    configured = true;
  } catch (error) {
    if (error instanceof StripeBillingError) code = error.code;
  }
  const result = {
    enabled,
    configured,
    mode: STRIPE_MODE_LIVE,
    code,
  };
  if (includeConfigNames) {
    result.configNames = requiredNames;
    result.missingConfigNames = missing;
  }
  return result;
}

export function getStripeLiveSubscriptionCheckoutStatus(env, { includeConfigNames = false } = {}) {
  const requiredNames = [
    "ENABLE_LIVE_STRIPE_SUBSCRIPTIONS",
    "STRIPE_LIVE_SECRET_KEY",
    "STRIPE_LIVE_WEBHOOK_SECRET",
    "STRIPE_LIVE_SUBSCRIPTION_PRICE_ID",
    "STRIPE_LIVE_SUBSCRIPTION_SUCCESS_URL",
    "STRIPE_LIVE_SUBSCRIPTION_CANCEL_URL",
  ];
  const missing = requiredNames.filter((name) => !safeString(env?.[name], 2048));
  let enabled = false;
  let configured = false;
  let code = null;
  try {
    getStripeLiveSubscriptionCheckoutConfig(env);
    enabled = true;
    configured = true;
  } catch (error) {
    if (error instanceof StripeBillingError) code = error.code;
  }
  const result = {
    enabled,
    configured,
    mode: STRIPE_MODE_LIVE,
    code,
    plan: {
      id: BITBI_MEMBER_SUBSCRIPTION.id,
      name: BITBI_MEMBER_SUBSCRIPTION.name,
      amountCents: BITBI_MEMBER_SUBSCRIPTION.amountCents,
      currency: BITBI_MEMBER_SUBSCRIPTION.currency,
      interval: BITBI_MEMBER_SUBSCRIPTION.interval,
      allowanceCredits: BITBI_MEMBER_SUBSCRIPTION.allowanceCredits,
      storageLimitBytes: BITBI_MEMBER_SUBSCRIPTION.storageLimitBytes,
    },
  };
  if (includeConfigNames) {
    result.configNames = requiredNames;
    result.missingConfigNames = missing;
  }
  return result;
}

function normalizePackId(value) {
  const packId = safeString(value, 64);
  if (!packId || !/^[a-z0-9_-]{3,64}$/i.test(packId)) {
    throw new StripeBillingError("A valid credit pack id is required.", {
      status: 400,
      code: "invalid_credit_pack",
    });
  }
  return packId;
}

export function getStripeCreditPack(packId) {
  const normalized = normalizePackId(packId);
  const pack = STRIPE_CREDIT_PACKS.find((entry) => entry.id === normalized);
  if (!pack || (!pack.active && !includeLegacy)) {
    throw new StripeBillingError("Unsupported credit pack.", {
      status: 400,
      code: "unsupported_credit_pack",
    });
  }
  return pack;
}

export function getStripeLiveCreditPack(packId, { includeLegacy = false } = {}) {
  const normalized = normalizePackId(packId);
  const packs = includeLegacy
    ? STRIPE_LIVE_CREDIT_PACKS.concat(STRIPE_LIVE_LEGACY_CREDIT_PACKS)
    : STRIPE_LIVE_CREDIT_PACKS;
  const pack = packs.find((entry) => entry.id === normalized);
  if (!pack || !pack.active) {
    throw new StripeBillingError("Unsupported live credit pack.", {
      status: 400,
      code: "unsupported_credit_pack",
    });
  }
  return pack;
}

function serializePack(pack) {
  return {
    id: pack.id,
    name: pack.name,
    credits: pack.credits,
    amountCents: pack.amountCents,
    currency: pack.currency,
    displayPrice: pack.displayPrice || null,
  };
}

export function listStripeLiveCreditPacks() {
  return STRIPE_LIVE_CREDIT_PACKS
    .filter((pack) => pack.active)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(serializePack);
}

function serializeCheckoutRow(row, { includeUrl = false } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    providerMode: row.provider_mode,
    sessionId: row.provider_checkout_session_id || null,
    organizationId: row.organization_id,
    userId: row.user_id,
    creditPack: {
      id: row.credit_pack_id,
      credits: Number(row.credits || 0),
      amountCents: Number(row.amount_cents || 0),
      currency: row.currency,
    },
    status: row.status,
    authorizationScope: row.authorization_scope || parseJsonObject(row.metadata_json).authorizationScope || null,
    paymentStatus: row.payment_status || null,
    completedAt: row.completed_at || null,
    grantedAt: row.granted_at || null,
    failedAt: row.failed_at || null,
    expiredAt: row.expired_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    checkoutUrl: includeUrl ? (row.checkout_url || null) : undefined,
  };
}

function serializeMemberCheckoutRow(row, { includeUrl = false } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    providerMode: row.provider_mode,
    sessionId: row.provider_checkout_session_id || null,
    organizationId: null,
    userId: row.user_id,
    creditPack: {
      id: row.credit_pack_id,
      credits: Number(row.credits || 0),
      amountCents: Number(row.amount_cents || 0),
      currency: row.currency,
    },
    status: row.status,
    checkoutScope: LIVE_MEMBER_CHECKOUT_SCOPE,
    authorizationScope: row.authorization_scope || LIVE_MEMBER_AUTH_SCOPE,
    paymentStatus: row.payment_status || null,
    completedAt: row.completed_at || null,
    grantedAt: row.granted_at || null,
    failedAt: row.failed_at || null,
    expiredAt: row.expired_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    checkoutUrl: includeUrl ? (row.checkout_url || null) : undefined,
  };
}

function serializeMemberSubscriptionCheckoutRow(row, { includeUrl = false } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    providerMode: row.provider_mode,
    sessionId: row.provider_checkout_session_id || null,
    subscriptionId: row.provider_subscription_id || null,
    organizationId: null,
    userId: row.user_id,
    plan: {
      id: row.plan_id,
      name: BITBI_MEMBER_SUBSCRIPTION.name,
      amountCents: Number(row.amount_cents || 0),
      currency: row.currency,
      interval: BITBI_MEMBER_SUBSCRIPTION.interval,
      allowanceCredits: BITBI_MEMBER_SUBSCRIPTION.allowanceCredits,
      storageLimitBytes: BITBI_MEMBER_SUBSCRIPTION.storageLimitBytes,
    },
    status: row.status,
    checkoutScope: LIVE_MEMBER_SUBSCRIPTION_CHECKOUT_SCOPE,
    authorizationScope: row.authorization_scope || LIVE_MEMBER_AUTH_SCOPE,
    paymentStatus: row.payment_status || null,
    completedAt: row.completed_at || null,
    failedAt: row.failed_at || null,
    expiredAt: row.expired_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    checkoutUrl: includeUrl ? (row.checkout_url || null) : undefined,
  };
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function hashJson(value) {
  return sha256Hex(JSON.stringify(value));
}

async function checkoutRequestFingerprint({ organizationId, userId, pack }) {
  return hashJson({
    organizationId,
    userId,
    creditPackId: pack.id,
    credits: pack.credits,
    amountCents: pack.amountCents,
    currency: pack.currency,
  });
}

async function checkoutRequestFingerprintForMode({ organizationId, userId, pack, providerMode, authorizationScope = null }) {
  return hashJson({
    provider: "stripe",
    providerMode,
    authorizationScope,
    organizationId,
    userId,
    creditPackId: pack.id,
    credits: pack.credits,
    amountCents: pack.amountCents,
    currency: pack.currency,
  });
}

async function liveCheckoutRequestFingerprint({ organizationId, userId, pack, authorizationScope, legalAcceptance }) {
  return hashJson({
    provider: "stripe",
    providerMode: STRIPE_MODE_LIVE,
    source: "pricing_page",
    checkoutScope: LIVE_ORGANIZATION_CHECKOUT_SCOPE,
    authorizationScope,
    organizationId,
    userId,
    creditPackId: pack.id,
    credits: pack.credits,
    amountCents: pack.amountCents,
    currency: pack.currency,
    termsAccepted: legalAcceptance.termsAccepted,
    termsVersion: legalAcceptance.termsVersion,
    immediateDeliveryAccepted: legalAcceptance.immediateDeliveryAccepted,
  });
}

async function liveMemberCheckoutRequestFingerprint({ userId, pack, legalAcceptance }) {
  return hashJson({
    provider: "stripe",
    providerMode: STRIPE_MODE_LIVE,
    source: "pricing_page",
    checkoutScope: LIVE_MEMBER_CHECKOUT_SCOPE,
    authorizationScope: LIVE_MEMBER_AUTH_SCOPE,
    userId,
    creditPackId: pack.id,
    credits: pack.credits,
    amountCents: pack.amountCents,
    currency: pack.currency,
    termsAccepted: legalAcceptance.termsAccepted,
    termsVersion: legalAcceptance.termsVersion,
    immediateDeliveryAccepted: legalAcceptance.immediateDeliveryAccepted,
  });
}

async function liveMemberSubscriptionCheckoutRequestFingerprint({ userId, plan, priceId, legalAcceptance }) {
  return hashJson({
    provider: "stripe",
    providerMode: STRIPE_MODE_LIVE,
    source: "pricing_page",
    checkoutScope: LIVE_MEMBER_SUBSCRIPTION_CHECKOUT_SCOPE,
    authorizationScope: LIVE_MEMBER_AUTH_SCOPE,
    userId,
    planId: plan.id,
    priceId,
    amountCents: plan.amountCents,
    currency: plan.currency,
    interval: plan.interval,
    allowanceCredits: plan.allowanceCredits,
    storageLimitBytes: plan.storageLimitBytes,
    termsAccepted: legalAcceptance.termsAccepted,
    termsVersion: legalAcceptance.termsVersion,
    immediateDeliveryAccepted: legalAcceptance.immediateDeliveryAccepted,
  });
}

async function fetchCheckoutByIdempotency(env, { organizationId, userId, idempotencyKeyHash }) {
  return env.DB.prepare(
    `SELECT id, provider, provider_mode, provider_checkout_session_id,
            provider_payment_intent_id, organization_id, user_id, credit_pack_id,
            credits, amount_cents, currency, status, idempotency_key_hash,
            request_fingerprint_hash, checkout_url, provider_customer_id,
            billing_event_id, credit_ledger_entry_id, authorization_scope,
            payment_status, granted_at, failed_at, expired_at, metadata_json,
            created_at, updated_at, completed_at
     FROM billing_checkout_sessions
     WHERE organization_id = ? AND user_id = ? AND idempotency_key_hash = ?
     LIMIT 1`
  ).bind(organizationId, userId, idempotencyKeyHash).first();
}

async function fetchMemberCheckoutByIdempotency(env, { userId, idempotencyKeyHash }) {
  return env.DB.prepare(
    `SELECT id, provider, provider_mode, provider_checkout_session_id,
            provider_payment_intent_id, user_id, credit_pack_id,
            credits, amount_cents, currency, status, idempotency_key_hash,
            request_fingerprint_hash, checkout_url, provider_customer_id,
            billing_event_id, member_credit_ledger_entry_id, authorization_scope,
            payment_status, granted_at, failed_at, expired_at, metadata_json,
            created_at, updated_at, completed_at
     FROM billing_member_checkout_sessions
     WHERE user_id = ? AND idempotency_key_hash = ?
     LIMIT 1`
  ).bind(userId, idempotencyKeyHash).first();
}

async function fetchCheckoutByProviderSession(env, sessionId) {
  return env.DB.prepare(
    `SELECT id, provider, provider_mode, provider_checkout_session_id,
            provider_payment_intent_id, organization_id, user_id, credit_pack_id,
            credits, amount_cents, currency, status, idempotency_key_hash,
            request_fingerprint_hash, checkout_url, provider_customer_id,
            billing_event_id, credit_ledger_entry_id, authorization_scope,
            payment_status, granted_at, failed_at, expired_at, metadata_json,
            created_at, updated_at, completed_at
     FROM billing_checkout_sessions
     WHERE provider = 'stripe' AND provider_checkout_session_id = ?
     LIMIT 1`
  ).bind(sessionId).first();
}

async function fetchMemberCheckoutByProviderSession(env, sessionId) {
  return env.DB.prepare(
    `SELECT id, provider, provider_mode, provider_checkout_session_id,
            provider_payment_intent_id, user_id, credit_pack_id,
            credits, amount_cents, currency, status, idempotency_key_hash,
            request_fingerprint_hash, checkout_url, provider_customer_id,
            billing_event_id, member_credit_ledger_entry_id, authorization_scope,
            payment_status, granted_at, failed_at, expired_at, metadata_json,
            created_at, updated_at, completed_at
     FROM billing_member_checkout_sessions
     WHERE provider = 'stripe' AND provider_checkout_session_id = ?
     LIMIT 1`
  ).bind(sessionId).first();
}

async function fetchMemberSubscriptionCheckoutByIdempotency(env, { userId, idempotencyKeyHash }) {
  return env.DB.prepare(
    `SELECT id, provider, provider_mode, provider_checkout_session_id,
            provider_subscription_id, user_id, plan_id, provider_price_id,
            amount_cents, currency, status, idempotency_key_hash,
            request_fingerprint_hash, checkout_url, provider_customer_id,
            billing_event_id, authorization_scope, payment_status,
            failed_at, expired_at, metadata_json, created_at, updated_at,
            completed_at
     FROM billing_member_subscription_checkout_sessions
     WHERE user_id = ? AND idempotency_key_hash = ?
     LIMIT 1`
  ).bind(userId, idempotencyKeyHash).first();
}

async function fetchMemberSubscriptionCheckoutByProviderSession(env, sessionId) {
  return env.DB.prepare(
    `SELECT id, provider, provider_mode, provider_checkout_session_id,
            provider_subscription_id, user_id, plan_id, provider_price_id,
            amount_cents, currency, status, idempotency_key_hash,
            request_fingerprint_hash, checkout_url, provider_customer_id,
            billing_event_id, authorization_scope, payment_status,
            failed_at, expired_at, metadata_json, created_at, updated_at,
            completed_at
     FROM billing_member_subscription_checkout_sessions
     WHERE provider = 'stripe' AND provider_checkout_session_id = ?
     LIMIT 1`
  ).bind(sessionId).first();
}

async function fetchMemberSubscriptionByProviderSubscriptionId(env, subscriptionId) {
  return env.DB.prepare(
    `SELECT id, user_id, provider, provider_mode, provider_customer_id,
            provider_subscription_id, provider_price_id, status,
            current_period_start, current_period_end, cancel_at_period_end,
            canceled_at, metadata_json, created_at, updated_at
     FROM billing_member_subscriptions
     WHERE provider = 'stripe'
       AND provider_mode = 'live'
       AND provider_subscription_id = ?
     LIMIT 1`
  ).bind(subscriptionId).first();
}

function checkoutSessionPatternForMode(mode) {
  return mode === STRIPE_MODE_LIVE
    ? LIVE_CHECKOUT_SESSION_ID_PATTERN
    : TEST_CHECKOUT_SESSION_ID_PATTERN;
}

function paymentIntentPatternForMode(mode) {
  return mode === STRIPE_MODE_LIVE
    ? LIVE_PAYMENT_INTENT_ID_PATTERN
    : TEST_PAYMENT_INTENT_ID_PATTERN;
}

function isStripeCheckoutSessionUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && CHECKOUT_SESSION_URL_ORIGINS.has(url.origin)
      && url.pathname.length > 1;
  } catch {
    return false;
  }
}

function normalizeStripeCheckoutSession(value, { mode = STRIPE_MODE_TEST } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StripeBillingError("Stripe Checkout Session response is invalid.", {
      status: 502,
      code: "stripe_checkout_invalid_response",
    });
  }
  const id = safeString(value.id, 220);
  const url = safeString(value.url, 2048);
  const isLiveMode = mode === STRIPE_MODE_LIVE;
  if (!id || !checkoutSessionPatternForMode(mode).test(id) || Boolean(value.livemode) !== isLiveMode) {
    throw new StripeBillingError(isLiveMode
      ? "Stripe Checkout Session response is not live mode."
      : "Stripe Checkout Session response is not testmode.", {
      status: 502,
      code: "stripe_checkout_invalid_response",
    });
  }
  if (!url || !isStripeCheckoutSessionUrl(url)) {
    throw new StripeBillingError("Stripe Checkout Session URL is invalid.", {
      status: 502,
      code: "stripe_checkout_invalid_response",
    });
  }
  return {
    id,
    url,
    customer: safeString(value.customer, 128),
    paymentIntent: safeString(value.payment_intent, 128),
    subscription: safeString(value.subscription, 128),
    paymentStatus: safeString(value.payment_status, 64),
    mode: safeString(value.mode, 32),
  };
}

async function postStripeCheckoutSession({ env, config, body, idempotencyKey }) {
  const fetchImpl = env.__TEST_FETCH || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new StripeBillingError("Stripe API fetch is unavailable.", {
      status: 503,
      code: "stripe_fetch_unavailable",
    });
  }

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeout = controller
    ? setTimeout(() => controller.abort(), STRIPE_CHECKOUT_TIMEOUT_MS)
    : null;
  try {
    const response = await fetchImpl(STRIPE_CHECKOUT_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": idempotencyKey,
      },
      body,
      signal: controller?.signal,
    });
    let parsed = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }
    if (!response.ok) {
      throw new StripeBillingError("Stripe Checkout Session could not be created.", {
        status: 502,
        code: "stripe_checkout_create_failed",
      });
    }
    return normalizeStripeCheckoutSession(parsed, { mode: config.mode });
  } catch (error) {
    if (error instanceof StripeBillingError) throw error;
    throw new StripeBillingError("Stripe Checkout Session could not be created.", {
      status: 502,
      code: "stripe_checkout_create_failed",
    });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function normalizeStripeSubscriptionResponse(value, { expectedSubscriptionId, expectedPriceId } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StripeBillingError("Stripe Subscription response is invalid.", {
      status: 502,
      code: "stripe_subscription_update_failed",
    });
  }
  const subscriptionId = safeString(value.id, 128);
  if (
    !subscriptionId ||
    !LIVE_SUBSCRIPTION_ID_PATTERN.test(subscriptionId) ||
    (expectedSubscriptionId && subscriptionId !== expectedSubscriptionId) ||
    value.livemode !== true
  ) {
    throw new StripeBillingError("Stripe Subscription response is invalid.", {
      status: 502,
      code: "stripe_subscription_update_failed",
    });
  }
  const priceId = getSubscriptionPriceId(value);
  if (expectedPriceId && priceId !== expectedPriceId) {
    throw new StripeBillingError("Stripe Subscription response does not match BITBI Pro.", {
      status: 409,
      code: "stripe_subscription_price_mismatch",
    });
  }
  return {
    subscriptionId,
    customer: safeString(value.customer, 128),
    priceId,
    status: safeString(value.status, 64) || "active",
    currentPeriodStart: stripeTimestampToIso(getSubscriptionPeriodStart(value)),
    currentPeriodEnd: stripeTimestampToIso(getSubscriptionPeriodEnd(value)),
    cancelAtPeriodEnd: value.cancel_at_period_end === true,
    canceledAt: stripeTimestampToIso(value.canceled_at),
    metadata: metadataObject(value.metadata),
  };
}

async function postStripeSubscriptionCancelAtPeriodEnd({
  env,
  config,
  subscriptionId,
  cancelAtPeriodEnd,
  idempotencyKey,
}) {
  const fetchImpl = env.__TEST_FETCH || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new StripeBillingError("Stripe API fetch is unavailable.", {
      status: 503,
      code: "stripe_fetch_unavailable",
    });
  }

  const normalizedSubscriptionId = safeString(subscriptionId, 128);
  if (!normalizedSubscriptionId || !LIVE_SUBSCRIPTION_ID_PATTERN.test(normalizedSubscriptionId)) {
    throw new StripeBillingError("Stripe live subscription id is invalid.", {
      status: 400,
      code: "stripe_subscription_invalid",
    });
  }

  const body = new URLSearchParams();
  body.set("cancel_at_period_end", cancelAtPeriodEnd ? "true" : "false");

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeout = controller
    ? setTimeout(() => controller.abort(), STRIPE_CHECKOUT_TIMEOUT_MS)
    : null;
  try {
    const response = await fetchImpl(`${STRIPE_SUBSCRIPTIONS_API_URL}/${encodeURIComponent(normalizedSubscriptionId)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": idempotencyKey,
      },
      body,
      signal: controller?.signal,
    });
    let parsed = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }
    if (!response.ok) {
      throw new StripeBillingError("Stripe Subscription could not be updated.", {
        status: 502,
        code: "stripe_subscription_update_failed",
      });
    }
    return normalizeStripeSubscriptionResponse(parsed, {
      expectedSubscriptionId: normalizedSubscriptionId,
      expectedPriceId: config.priceId,
    });
  } catch (error) {
    if (error instanceof StripeBillingError) throw error;
    throw new StripeBillingError("Stripe Subscription could not be updated.", {
      status: 502,
      code: "stripe_subscription_update_failed",
    });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function buildCheckoutForm({
  config,
  pack,
  organizationId = null,
  userId,
  checkoutId,
  authorizationScope = null,
  checkoutScope = null,
  source = null,
  legalAcceptance = null,
}) {
  const body = new URLSearchParams();
  body.set("mode", "payment");
  if (config.mode === STRIPE_MODE_LIVE) {
    body.set("payment_method_types[0]", "card");
  }
  body.set("success_url", config.successUrl);
  body.set("cancel_url", config.cancelUrl);
  body.set("client_reference_id", checkoutId);
  body.set("line_items[0][quantity]", "1");
  body.set("line_items[0][price_data][currency]", pack.currency);
  body.set("line_items[0][price_data][unit_amount]", String(pack.amountCents));
  body.set("line_items[0][price_data][product_data][name]", pack.name);
  if (organizationId) {
    body.set("metadata[organization_id]", organizationId);
  }
  body.set("metadata[user_id]", userId);
  body.set("metadata[pack_id]", pack.id);
  body.set("metadata[credit_pack_id]", pack.id);
  body.set("metadata[credits]", String(pack.credits));
  body.set("metadata[internal_checkout_session_id]", checkoutId);
  body.set("metadata[stripe_mode]", config.mode);
  body.set("metadata[mode]", config.mode);
  if (checkoutScope) body.set("metadata[checkout_scope]", checkoutScope);
  if (source) body.set("metadata[source]", source);
  if (authorizationScope) {
    body.set("metadata[authorization_scope]", authorizationScope);
  }
  if (legalAcceptance) {
    body.set("metadata[terms_accepted]", legalAcceptance.termsAccepted ? "true" : "false");
    body.set("metadata[terms_version]", legalAcceptance.termsVersion);
    body.set("metadata[immediate_delivery_accepted]", legalAcceptance.immediateDeliveryAccepted ? "true" : "false");
    if (legalAcceptance.acceptedAt) {
      body.set("metadata[accepted_at]", legalAcceptance.acceptedAt);
    }
  }
  return body;
}

function buildSubscriptionCheckoutForm({
  config,
  plan,
  userId,
  checkoutId,
  legalAcceptance,
}) {
  const body = new URLSearchParams();
  body.set("mode", "subscription");
  body.set("payment_method_types[0]", "card");
  body.set("success_url", config.successUrl);
  body.set("cancel_url", config.cancelUrl);
  body.set("client_reference_id", checkoutId);
  body.set("line_items[0][quantity]", "1");
  body.set("line_items[0][price]", config.priceId);
  body.set("metadata[user_id]", userId);
  body.set("metadata[plan_id]", plan.id);
  body.set("metadata[subscription_plan_id]", plan.id);
  body.set("metadata[internal_checkout_session_id]", checkoutId);
  body.set("metadata[stripe_mode]", config.mode);
  body.set("metadata[mode]", config.mode);
  body.set("metadata[checkout_scope]", LIVE_MEMBER_SUBSCRIPTION_CHECKOUT_SCOPE);
  body.set("metadata[authorization_scope]", LIVE_MEMBER_AUTH_SCOPE);
  body.set("metadata[source]", "pricing_page");
  body.set("metadata[terms_accepted]", legalAcceptance.termsAccepted ? "true" : "false");
  body.set("metadata[terms_version]", legalAcceptance.termsVersion);
  body.set("metadata[immediate_delivery_accepted]", legalAcceptance.immediateDeliveryAccepted ? "true" : "false");
  if (legalAcceptance.acceptedAt) {
    body.set("metadata[accepted_at]", legalAcceptance.acceptedAt);
  }
  body.set("subscription_data[metadata][user_id]", userId);
  body.set("subscription_data[metadata][plan_id]", plan.id);
  body.set("subscription_data[metadata][subscription_plan_id]", plan.id);
  body.set("subscription_data[metadata][internal_checkout_session_id]", checkoutId);
  body.set("subscription_data[metadata][checkout_scope]", LIVE_MEMBER_SUBSCRIPTION_CHECKOUT_SCOPE);
  body.set("subscription_data[metadata][authorization_scope]", LIVE_MEMBER_AUTH_SCOPE);
  body.set("subscription_data[metadata][source]", "pricing_page");
  body.set("subscription_data[metadata][terms_version]", legalAcceptance.termsVersion);
  return body;
}

export async function createStripeCreditPackCheckout({
  env,
  organizationId,
  userId,
  packId,
  idempotencyKey,
}) {
  const orgId = normalizeOrgId(organizationId);
  const normalizedUserId = normalizeUserId(userId);
  const normalizedKey = normalizeBillingIdempotencyKey(idempotencyKey);
  const pack = getStripeCreditPack(packId);
  const config = getStripeCheckoutConfig(env);
  const keyHash = await sha256Hex(normalizedKey);
  const requestHash = await checkoutRequestFingerprint({ organizationId: orgId, userId: normalizedUserId, pack });
  const existing = await fetchCheckoutByIdempotency(env, {
    organizationId: orgId,
    userId: normalizedUserId,
    idempotencyKeyHash: keyHash,
  });
  if (existing) {
    if (existing.request_fingerprint_hash !== requestHash) {
      throw new StripeBillingError("Idempotency-Key conflicts with a different checkout request.", {
        status: 409,
        code: "idempotency_conflict",
      });
    }
    if (!existing.checkout_url) {
      throw new StripeBillingError("Stripe Checkout Session could not be created.", {
        status: 502,
        code: "stripe_checkout_create_failed",
      });
    }
    return {
      checkout: serializeCheckoutRow(existing, { includeUrl: true }),
      creditPack: serializePack(pack),
      reused: true,
    };
  }

  const id = checkoutSessionId();
  const stripeSession = await postStripeCheckoutSession({
    env,
    config,
    body: buildCheckoutForm({
      config,
      pack,
      organizationId: orgId,
      userId: normalizedUserId,
      checkoutId: id,
    }),
    idempotencyKey: `bitbi-${keyHash.slice(0, 48)}`,
  });

  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO billing_checkout_sessions (
       id, provider, provider_mode, provider_checkout_session_id,
       provider_payment_intent_id, organization_id, user_id, credit_pack_id,
       credits, amount_cents, currency, status, idempotency_key_hash,
       request_fingerprint_hash, checkout_url, provider_customer_id,
       metadata_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    "stripe",
    STRIPE_MODE_TEST,
    stripeSession.id,
    stripeSession.paymentIntent && TEST_PAYMENT_INTENT_ID_PATTERN.test(stripeSession.paymentIntent)
      ? stripeSession.paymentIntent
      : null,
    orgId,
    normalizedUserId,
    pack.id,
    pack.credits,
    pack.amountCents,
    pack.currency,
    "created",
    keyHash,
    requestHash,
    stripeSession.url,
    stripeSession.customer,
    JSON.stringify({ phase: "2-J", liveBillingEnabled: false }),
    now,
    now
  ).run();

  return {
    checkout: {
      id,
      provider: "stripe",
      providerMode: STRIPE_MODE_TEST,
      sessionId: stripeSession.id,
      organizationId: orgId,
      userId: normalizedUserId,
      creditPack: serializePack(pack),
      status: "created",
      checkoutUrl: stripeSession.url,
      createdAt: now,
      updatedAt: now,
    },
    creditPack: serializePack(pack),
    reused: false,
  };
}

function normalizeLiveAuthorizationScope(value) {
  const scope = safeString(value, 32);
  if (!scope || !LIVE_AUTH_SCOPES.has(scope)) {
    throw new StripeBillingError("Live checkout authorization scope is invalid.", {
      status: 403,
      code: "stripe_live_checkout_unauthorized_scope",
    });
  }
  return scope;
}

function normalizeLiveLegalAcceptance(value) {
  const data = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  if (data.termsAccepted !== true && data.terms_accepted !== true) {
    throw new StripeBillingError("BITBI terms must be accepted before checkout.", {
      status: 400,
      code: "terms_acceptance_required",
    });
  }
  const termsVersion = safeString(data.termsVersion || data.terms_version, 32);
  if (termsVersion !== BITBI_TERMS_VERSION) {
    throw new StripeBillingError("The current BITBI terms version must be accepted before checkout.", {
      status: 400,
      code: "terms_version_required",
    });
  }
  if (data.immediateDeliveryAccepted !== true && data.immediate_delivery_accepted !== true) {
    throw new StripeBillingError("Immediate digital-credit delivery consent is required before checkout.", {
      status: 400,
      code: "immediate_delivery_acceptance_required",
    });
  }
  const acceptedAtText = safeString(data.acceptedAt || data.accepted_at, 64);
  let acceptedAt = null;
  if (acceptedAtText) {
    const parsed = new Date(acceptedAtText);
    if (!Number.isFinite(parsed.getTime())) {
      throw new StripeBillingError("Terms acceptance timestamp is invalid.", {
        status: 400,
        code: "terms_acceptance_timestamp_invalid",
      });
    }
    acceptedAt = parsed.toISOString();
  }
  return {
    termsAccepted: true,
    termsVersion,
    immediateDeliveryAccepted: true,
    acceptedAt,
  };
}

async function updateCheckoutSessionAfterStripeCreate(env, {
  id,
  providerMode,
  stripeSession,
  now = nowIso(),
}) {
  await env.DB.prepare(
    `UPDATE billing_checkout_sessions
     SET provider_checkout_session_id = ?,
         provider_payment_intent_id = COALESCE(?, provider_payment_intent_id),
         provider_customer_id = COALESCE(?, provider_customer_id),
         checkout_url = ?,
         payment_status = COALESCE(?, payment_status),
         error_code = NULL,
         error_message = NULL,
         updated_at = ?
     WHERE id = ? AND provider = 'stripe' AND provider_mode = ?`
  ).bind(
    stripeSession.id,
    stripeSession.paymentIntent && paymentIntentPatternForMode(providerMode).test(stripeSession.paymentIntent)
      ? stripeSession.paymentIntent
      : null,
    stripeSession.customer,
    stripeSession.url,
    stripeSession.paymentStatus,
    now,
    id,
    providerMode
  ).run();
  return fetchCheckoutByProviderSession(env, stripeSession.id);
}

async function markCheckoutSessionFailed(env, {
  id,
  errorCode,
  errorMessage,
  now = nowIso(),
}) {
  await env.DB.prepare(
    `UPDATE billing_checkout_sessions
     SET status = 'failed',
         error_code = ?,
         error_message = ?,
         updated_at = ?,
         failed_at = COALESCE(failed_at, ?)
     WHERE id = ?`
  ).bind(
    safeString(errorCode, 64),
    safeString(errorMessage, 256),
    now,
    now,
    id
  ).run();
}

export async function createStripeLiveCreditPackCheckout({
  env,
  organizationId,
  userId,
  packId,
  idempotencyKey,
  authorizationScope,
  legalAcceptance,
}) {
  const orgId = normalizeOrgId(organizationId);
  const normalizedUserId = normalizeUserId(userId);
  const scope = normalizeLiveAuthorizationScope(authorizationScope);
  const acceptance = normalizeLiveLegalAcceptance(legalAcceptance);
  const normalizedKey = normalizeBillingIdempotencyKey(idempotencyKey);
  const pack = getStripeLiveCreditPack(packId);
  const config = getStripeLiveCheckoutConfig(env);
  const keyHash = await sha256Hex(`live:${normalizedKey}`);
  const requestHash = await liveCheckoutRequestFingerprint({
    organizationId: orgId,
    userId: normalizedUserId,
    pack,
    authorizationScope: scope,
    legalAcceptance: acceptance,
  });
  const existing = await fetchCheckoutByIdempotency(env, {
    organizationId: orgId,
    userId: normalizedUserId,
    idempotencyKeyHash: keyHash,
  });
  if (existing) {
    if (existing.request_fingerprint_hash !== requestHash) {
      throw new StripeBillingError("Idempotency-Key conflicts with a different checkout request.", {
        status: 409,
        code: "idempotency_conflict",
      });
    }
    if (!existing.checkout_url) {
      throw new StripeBillingError("Stripe Checkout Session could not be created.", {
        status: 502,
        code: "stripe_checkout_create_failed",
      });
    }
    return {
      checkout: serializeCheckoutRow(existing, { includeUrl: true }),
      creditPack: serializePack(pack),
      reused: true,
    };
  }

  const id = checkoutSessionId();
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO billing_checkout_sessions (
       id, provider, provider_mode, provider_checkout_session_id,
       provider_payment_intent_id, organization_id, user_id, credit_pack_id,
       credits, amount_cents, currency, status, idempotency_key_hash,
       request_fingerprint_hash, checkout_url, provider_customer_id,
       authorization_scope, payment_status, metadata_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    "stripe",
    STRIPE_MODE_LIVE,
    null,
    null,
    orgId,
    normalizedUserId,
    pack.id,
    pack.credits,
    pack.amountCents,
    pack.currency,
    "created",
    keyHash,
    requestHash,
    null,
    null,
    scope,
    null,
    JSON.stringify({
      phase: "2-L",
      source: "pricing_page",
      checkoutScope: LIVE_ORGANIZATION_CHECKOUT_SCOPE,
      authorizationScope: scope,
      liveBillingEnabled: true,
      asyncPaymentMethodsEnabled: false,
      termsAccepted: true,
      termsVersion: acceptance.termsVersion,
      immediateDeliveryAccepted: true,
      acceptedAt: acceptance.acceptedAt,
    }),
    now,
    now
  ).run();

  try {
    const stripeSession = await postStripeCheckoutSession({
      env,
      config,
      body: buildCheckoutForm({
        config,
        pack,
        organizationId: orgId,
        userId: normalizedUserId,
        checkoutId: id,
        authorizationScope: scope,
        checkoutScope: LIVE_ORGANIZATION_CHECKOUT_SCOPE,
        source: "pricing_page",
        legalAcceptance: acceptance,
      }),
      idempotencyKey: `bitbi-live-${keyHash.slice(0, 43)}`,
    });
    const checkout = await updateCheckoutSessionAfterStripeCreate(env, {
      id,
      providerMode: STRIPE_MODE_LIVE,
      stripeSession,
    });
    return {
      checkout: serializeCheckoutRow(checkout, { includeUrl: true }),
      creditPack: serializePack(pack),
      reused: false,
    };
  } catch (error) {
    const code = error instanceof StripeBillingError ? error.code : "stripe_checkout_create_failed";
    const message = error instanceof StripeBillingError
      ? error.message
      : "Stripe Checkout Session could not be created.";
    await markCheckoutSessionFailed(env, { id, errorCode: code, errorMessage: message });
    throw error;
  }
}

async function updateMemberCheckoutSessionAfterStripeCreate(env, {
  id,
  stripeSession,
  now = nowIso(),
}) {
  await env.DB.prepare(
    `UPDATE billing_member_checkout_sessions
     SET provider_checkout_session_id = ?,
         provider_payment_intent_id = COALESCE(?, provider_payment_intent_id),
         provider_customer_id = COALESCE(?, provider_customer_id),
         checkout_url = ?,
         payment_status = COALESCE(?, payment_status),
         error_code = NULL,
         error_message = NULL,
         updated_at = ?
     WHERE id = ? AND provider = 'stripe' AND provider_mode = 'live'`
  ).bind(
    stripeSession.id,
    stripeSession.paymentIntent && paymentIntentPatternForMode(STRIPE_MODE_LIVE).test(stripeSession.paymentIntent)
      ? stripeSession.paymentIntent
      : null,
    stripeSession.customer,
    stripeSession.url,
    stripeSession.paymentStatus,
    now,
    id
  ).run();
  return fetchMemberCheckoutByProviderSession(env, stripeSession.id);
}

async function markMemberCheckoutSessionFailed(env, {
  id,
  errorCode,
  errorMessage,
  now = nowIso(),
}) {
  await env.DB.prepare(
    `UPDATE billing_member_checkout_sessions
     SET status = 'failed',
         error_code = ?,
         error_message = ?,
         updated_at = ?,
         failed_at = COALESCE(failed_at, ?)
     WHERE id = ?`
  ).bind(
    safeString(errorCode, 64),
    safeString(errorMessage, 256),
    now,
    now,
    id
  ).run();
}

async function updateMemberSubscriptionCheckoutAfterStripeCreate(env, {
  id,
  stripeSession,
  now = nowIso(),
}) {
  await env.DB.prepare(
    `UPDATE billing_member_subscription_checkout_sessions
     SET provider_checkout_session_id = ?,
         provider_subscription_id = COALESCE(?, provider_subscription_id),
         provider_customer_id = COALESCE(?, provider_customer_id),
         checkout_url = ?,
         payment_status = COALESCE(?, payment_status),
         error_code = NULL,
         error_message = NULL,
         updated_at = ?
     WHERE id = ? AND provider = 'stripe' AND provider_mode = 'live'`
  ).bind(
    stripeSession.id,
    stripeSession.subscription && LIVE_SUBSCRIPTION_ID_PATTERN.test(stripeSession.subscription)
      ? stripeSession.subscription
      : null,
    stripeSession.customer,
    stripeSession.url,
    stripeSession.paymentStatus,
    now,
    id
  ).run();
  return fetchMemberSubscriptionCheckoutByProviderSession(env, stripeSession.id);
}

async function markMemberSubscriptionCheckoutFailed(env, {
  id,
  errorCode,
  errorMessage,
  now = nowIso(),
}) {
  await env.DB.prepare(
    `UPDATE billing_member_subscription_checkout_sessions
     SET status = 'failed',
         error_code = ?,
         error_message = ?,
         updated_at = ?,
         failed_at = COALESCE(failed_at, ?)
     WHERE id = ?`
  ).bind(
    safeString(errorCode, 64),
    safeString(errorMessage, 256),
    now,
    now,
    id
  ).run();
}

export async function createStripeLiveMemberCreditPackCheckout({
  env,
  userId,
  packId,
  idempotencyKey,
  legalAcceptance,
}) {
  const normalizedUserId = normalizeUserId(userId);
  const acceptance = normalizeLiveLegalAcceptance(legalAcceptance);
  const normalizedKey = normalizeBillingIdempotencyKey(idempotencyKey);
  const pack = getStripeLiveCreditPack(packId);
  const config = getStripeLiveCheckoutConfig(env);
  const keyHash = await sha256Hex(`live-member:${normalizedKey}`);
  const requestHash = await liveMemberCheckoutRequestFingerprint({
    userId: normalizedUserId,
    pack,
    legalAcceptance: acceptance,
  });
  const existing = await fetchMemberCheckoutByIdempotency(env, {
    userId: normalizedUserId,
    idempotencyKeyHash: keyHash,
  });
  if (existing) {
    if (existing.request_fingerprint_hash !== requestHash) {
      throw new StripeBillingError("Idempotency-Key conflicts with a different checkout request.", {
        status: 409,
        code: "idempotency_conflict",
      });
    }
    if (!existing.checkout_url) {
      throw new StripeBillingError("Stripe Checkout Session could not be created.", {
        status: 502,
        code: "stripe_checkout_create_failed",
      });
    }
    return {
      checkout: serializeMemberCheckoutRow(existing, { includeUrl: true }),
      creditPack: serializePack(pack),
      reused: true,
    };
  }

  const id = checkoutSessionId();
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO billing_member_checkout_sessions (
       id, provider, provider_mode, provider_checkout_session_id,
       provider_payment_intent_id, user_id, credit_pack_id,
       credits, amount_cents, currency, status, idempotency_key_hash,
       request_fingerprint_hash, checkout_url, provider_customer_id,
       authorization_scope, payment_status, metadata_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    "stripe",
    STRIPE_MODE_LIVE,
    null,
    null,
    normalizedUserId,
    pack.id,
    pack.credits,
    pack.amountCents,
    pack.currency,
    "created",
    keyHash,
    requestHash,
    null,
    null,
    LIVE_MEMBER_AUTH_SCOPE,
    null,
    JSON.stringify({
      phase: "2-M",
      source: "pricing_page",
      checkoutScope: LIVE_MEMBER_CHECKOUT_SCOPE,
      authorizationScope: LIVE_MEMBER_AUTH_SCOPE,
      liveBillingEnabled: true,
      asyncPaymentMethodsEnabled: false,
      termsAccepted: true,
      termsVersion: acceptance.termsVersion,
      immediateDeliveryAccepted: true,
      acceptedAt: acceptance.acceptedAt,
    }),
    now,
    now
  ).run();

  try {
    const stripeSession = await postStripeCheckoutSession({
      env,
      config,
      body: buildCheckoutForm({
        config,
        pack,
        userId: normalizedUserId,
        checkoutId: id,
        authorizationScope: LIVE_MEMBER_AUTH_SCOPE,
        checkoutScope: LIVE_MEMBER_CHECKOUT_SCOPE,
        source: "pricing_page",
        legalAcceptance: acceptance,
      }),
      idempotencyKey: `bitbi-live-member-${keyHash.slice(0, 36)}`,
    });
    const checkout = await updateMemberCheckoutSessionAfterStripeCreate(env, {
      id,
      stripeSession,
    });
    return {
      checkout: serializeMemberCheckoutRow(checkout, { includeUrl: true }),
      creditPack: serializePack(pack),
      reused: false,
    };
  } catch (error) {
    const code = error instanceof StripeBillingError ? error.code : "stripe_checkout_create_failed";
    const message = error instanceof StripeBillingError
      ? error.message
      : "Stripe Checkout Session could not be created.";
    await markMemberCheckoutSessionFailed(env, { id, errorCode: code, errorMessage: message });
    throw error;
  }
}

export async function createStripeLiveMemberSubscriptionCheckout({
  env,
  userId,
  idempotencyKey,
  legalAcceptance,
}) {
  const normalizedUserId = normalizeUserId(userId);
  const acceptance = normalizeLiveLegalAcceptance(legalAcceptance);
  const normalizedKey = normalizeBillingIdempotencyKey(idempotencyKey);
  const config = getStripeLiveSubscriptionCheckoutConfig(env);
  const plan = BITBI_MEMBER_SUBSCRIPTION;
  const keyHash = await sha256Hex(`live-member-subscription:${normalizedKey}`);
  const requestHash = await liveMemberSubscriptionCheckoutRequestFingerprint({
    userId: normalizedUserId,
    plan,
    priceId: config.priceId,
    legalAcceptance: acceptance,
  });
  const existing = await fetchMemberSubscriptionCheckoutByIdempotency(env, {
    userId: normalizedUserId,
    idempotencyKeyHash: keyHash,
  });
  if (existing) {
    if (existing.request_fingerprint_hash !== requestHash) {
      throw new StripeBillingError("Idempotency-Key conflicts with a different subscription checkout request.", {
        status: 409,
        code: "idempotency_conflict",
      });
    }
    if (!existing.checkout_url) {
      throw new StripeBillingError("Stripe Checkout Session could not be created.", {
        status: 502,
        code: "stripe_checkout_create_failed",
      });
    }
    return {
      checkout: serializeMemberSubscriptionCheckoutRow(existing, { includeUrl: true }),
      plan,
      reused: true,
    };
  }

  const id = checkoutSessionId();
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO billing_member_subscription_checkout_sessions (
       id, provider, provider_mode, provider_checkout_session_id,
       provider_subscription_id, user_id, plan_id, provider_price_id,
       amount_cents, currency, status, idempotency_key_hash,
       request_fingerprint_hash, checkout_url, provider_customer_id,
       authorization_scope, payment_status, metadata_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    "stripe",
    STRIPE_MODE_LIVE,
    null,
    null,
    normalizedUserId,
    plan.id,
    config.priceId,
    plan.amountCents,
    plan.currency,
    "created",
    keyHash,
    requestHash,
    null,
    null,
    LIVE_MEMBER_AUTH_SCOPE,
    null,
    JSON.stringify({
      phase: "member-subscriptions-pro",
      source: "pricing_page",
      checkoutScope: LIVE_MEMBER_SUBSCRIPTION_CHECKOUT_SCOPE,
      authorizationScope: LIVE_MEMBER_AUTH_SCOPE,
      termsAccepted: true,
      termsVersion: acceptance.termsVersion,
      immediateDeliveryAccepted: true,
      acceptedAt: acceptance.acceptedAt,
    }),
    now,
    now
  ).run();

  try {
    const stripeSession = await postStripeCheckoutSession({
      env,
      config,
      body: buildSubscriptionCheckoutForm({
        config,
        plan,
        userId: normalizedUserId,
        checkoutId: id,
        legalAcceptance: acceptance,
      }),
      idempotencyKey: `bitbi-live-sub-${keyHash.slice(0, 41)}`,
    });
    if (stripeSession.mode && stripeSession.mode !== "subscription") {
      throw new StripeBillingError("Stripe Checkout Session response is not a subscription checkout.", {
        status: 502,
        code: "stripe_checkout_invalid_response",
      });
    }
    const checkout = await updateMemberSubscriptionCheckoutAfterStripeCreate(env, {
      id,
      stripeSession,
    });
    return {
      checkout: serializeMemberSubscriptionCheckoutRow(checkout, { includeUrl: true }),
      plan,
      reused: false,
    };
  } catch (error) {
    const code = error instanceof StripeBillingError ? error.code : "stripe_checkout_create_failed";
    const message = error instanceof StripeBillingError
      ? error.message
      : "Stripe Checkout Session could not be created.";
    await markMemberSubscriptionCheckoutFailed(env, { id, errorCode: code, errorMessage: message });
    throw error;
  }
}

function assertLiveMemberSubscriptionManageable(subscription, { expectedPriceId, action }) {
  if (!subscription) {
    throw new StripeBillingError("No active BITBI Pro subscription was found.", {
      status: 404,
      code: "subscription_not_found",
    });
  }
  if (
    subscription.provider !== "stripe" ||
    subscription.providerMode !== STRIPE_MODE_LIVE ||
    !subscription.providerSubscriptionId ||
    !LIVE_SUBSCRIPTION_ID_PATTERN.test(subscription.providerSubscriptionId)
  ) {
    throw new StripeBillingError("The current subscription cannot be managed automatically.", {
      status: 409,
      code: "subscription_not_manageable",
    });
  }
  if (subscription.providerPriceId !== expectedPriceId) {
    throw new StripeBillingError("The current subscription does not match BITBI Pro.", {
      status: 409,
      code: "stripe_subscription_price_mismatch",
    });
  }
  if (action === "cancel" && subscription.cancelAtPeriodEnd) {
    return { alreadyInRequestedState: true };
  }
  if (action === "reactivate" && !subscription.cancelAtPeriodEnd) {
    throw new StripeBillingError("The current subscription is not scheduled for cancellation.", {
      status: 409,
      code: "subscription_not_scheduled_for_cancellation",
    });
  }
  return { alreadyInRequestedState: false };
}

async function updateStripeLiveMemberSubscriptionCancelAtPeriodEnd({
  env,
  userId,
  cancelAtPeriodEnd,
  idempotencyKey,
}) {
  const normalizedUserId = normalizeUserId(userId);
  const normalizedKey = normalizeBillingIdempotencyKey(idempotencyKey);
  const config = getStripeLiveSubscriptionManagementConfig(env);
  const subscription = await getActiveMemberSubscription(env, normalizedUserId);
  const requestedAction = cancelAtPeriodEnd ? "cancel" : "reactivate";
  const manageability = assertLiveMemberSubscriptionManageable(subscription, {
    expectedPriceId: config.priceId,
    action: requestedAction,
  });
  if (manageability.alreadyInRequestedState) {
    return {
      subscription,
      reused: true,
    };
  }

  const stripeSubscription = await postStripeSubscriptionCancelAtPeriodEnd({
    env,
    config,
    subscriptionId: subscription.providerSubscriptionId,
    cancelAtPeriodEnd,
    idempotencyKey: `bitbi-live-subscription-${requestedAction}-${normalizedKey.slice(0, 80)}`,
  });
  const updated = await upsertMemberSubscriptionFromProvider({
    env,
    userId: normalizedUserId,
    providerSubscriptionId: stripeSubscription.subscriptionId,
    providerCustomerId: stripeSubscription.customer || subscription.providerCustomerId || null,
    providerPriceId: stripeSubscription.priceId || subscription.providerPriceId || config.priceId,
    status: stripeSubscription.status || subscription.status,
    currentPeriodStart: stripeSubscription.currentPeriodStart || subscription.currentPeriodStart || null,
    currentPeriodEnd: stripeSubscription.currentPeriodEnd || subscription.currentPeriodEnd || null,
    cancelAtPeriodEnd: stripeSubscription.cancelAtPeriodEnd,
    canceledAt: stripeSubscription.canceledAt || subscription.canceledAt || null,
    metadata: {
      ...stripeSubscription.metadata,
      source: `account_subscription_${requestedAction}`,
    },
  });
  return {
    subscription: updated,
    reused: false,
  };
}

export function cancelStripeLiveMemberSubscriptionAtPeriodEnd({ env, userId, idempotencyKey }) {
  return updateStripeLiveMemberSubscriptionCancelAtPeriodEnd({
    env,
    userId,
    cancelAtPeriodEnd: true,
    idempotencyKey,
  });
}

export function reactivateStripeLiveMemberSubscription({ env, userId, idempotencyKey }) {
  return updateStripeLiveMemberSubscriptionCancelAtPeriodEnd({
    env,
    userId,
    cancelAtPeriodEnd: false,
    idempotencyKey,
  });
}

function normalizeUserId(value) {
  const userId = safeString(value, 128);
  if (!userId || !USER_ID_PATTERN.test(userId)) {
    throw new StripeBillingError("A valid user id is required.", {
      status: 400,
      code: "invalid_user_id",
    });
  }
  return userId;
}

function normalizeStripeMetadataOrgId(value) {
  try {
    return normalizeOrgId(value);
  } catch {
    throw new StripeBillingError("Stripe organization metadata is invalid.", {
      status: 400,
      code: "stripe_checkout_metadata_invalid",
    });
  }
}

function parseStripeSignatureHeader(value) {
  const header = String(value || "").trim();
  if (!header) {
    throw new StripeBillingError("Stripe webhook signature is invalid.", {
      status: 401,
      code: "stripe_webhook_invalid_signature",
    });
  }
  const parts = header.split(",").map((part) => part.trim()).filter(Boolean);
  const timestamps = [];
  const signatures = [];
  for (const part of parts) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const key = part.slice(0, separator);
    const valuePart = part.slice(separator + 1);
    if (key === "t") timestamps.push(valuePart);
    if (key === "v1") signatures.push(valuePart.toLowerCase());
  }
  const timestamp = timestamps.at(-1);
  if (!timestamp || !/^\d{10}$/.test(timestamp) || signatures.length === 0) {
    throw new StripeBillingError("Stripe webhook signature is invalid.", {
      status: 401,
      code: "stripe_webhook_invalid_signature",
    });
  }
  if (signatures.some((signature) => !/^[a-f0-9]{64}$/.test(signature))) {
    throw new StripeBillingError("Stripe webhook signature is invalid.", {
      status: 401,
      code: "stripe_webhook_invalid_signature",
    });
  }
  return {
    timestamp,
    signatures,
  };
}

async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message)
  );
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

export async function buildStripeWebhookSignature({ secret, timestamp, rawBody }) {
  const normalizedSecret = normalizeStripeWebhookSecret({ STRIPE_WEBHOOK_SECRET: secret });
  const timestampText = String(timestamp || "");
  const signature = await hmacSha256Hex(normalizedSecret, `${timestampText}.${String(rawBody || "")}`);
  return `t=${timestampText},v1=${signature}`;
}

export async function verifyStripeWebhookRequest({ env, rawBody, request, now = Date.now() }) {
  normalizeStripeMode(env);
  const secret = normalizeStripeWebhookSecret(env);
  const parsed = parseStripeSignatureHeader(request.headers.get(STRIPE_SIGNATURE_HEADER));
  const timestampMs = Number(parsed.timestamp) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(now - timestampMs) > STRIPE_WEBHOOK_TOLERANCE_MS) {
    throw new StripeBillingError("Stripe webhook signature is stale.", {
      status: 401,
      code: "stripe_webhook_stale_signature",
    });
  }
  const expected = await hmacSha256Hex(secret, `${parsed.timestamp}.${String(rawBody || "")}`);
  if (!parsed.signatures.some((signature) => safeEqualHex(signature, expected))) {
    throw new StripeBillingError("Stripe webhook signature is invalid.", {
      status: 401,
      code: "stripe_webhook_invalid_signature",
    });
  }
  return {
    provider: BILLING_WEBHOOK_STRIPE_PROVIDER,
    verificationStatus: "verified_test_signature",
    timestamp: parsed.timestamp,
  };
}

export async function verifyStripeLiveWebhookRequest({ env, rawBody, request, now = Date.now() }) {
  const secret = normalizeStripeLiveWebhookSecret(env);
  const parsed = parseStripeSignatureHeader(request.headers.get(STRIPE_SIGNATURE_HEADER));
  const timestampMs = Number(parsed.timestamp) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(now - timestampMs) > STRIPE_WEBHOOK_TOLERANCE_MS) {
    throw new StripeBillingError("Stripe live webhook signature is stale.", {
      status: 401,
      code: "stripe_webhook_stale_signature",
    });
  }
  const expected = await hmacSha256Hex(secret, `${parsed.timestamp}.${String(rawBody || "")}`);
  if (!parsed.signatures.some((signature) => safeEqualHex(signature, expected))) {
    throw new StripeBillingError("Stripe live webhook signature is invalid.", {
      status: 401,
      code: "stripe_webhook_invalid_signature",
    });
  }
  return {
    provider: BILLING_WEBHOOK_STRIPE_PROVIDER,
    verificationStatus: "verified_test_signature",
    timestamp: parsed.timestamp,
  };
}

function getStripeSessionObject(payload) {
  const object = payload?.data?.object;
  if (!object || typeof object !== "object" || Array.isArray(object)) {
    throw new StripeBillingError("Stripe event object is invalid.", {
      status: 400,
      code: "stripe_event_invalid_object",
    });
  }
  return object;
}

function normalizeCheckoutCompletion(payload) {
  if (payload?.type !== "checkout.session.completed") {
    return null;
  }
  if (payload.livemode === true) {
    throw new StripeBillingError("Live Stripe events are disabled.", {
      status: 403,
      code: "stripe_live_mode_disabled",
    });
  }
  const session = getStripeSessionObject(payload);
  if (session.livemode === true) {
    throw new StripeBillingError("Live Stripe Checkout Sessions are disabled.", {
      status: 403,
      code: "stripe_live_mode_disabled",
    });
  }
  const sessionId = safeString(session.id, 220);
  if (!sessionId || !TEST_CHECKOUT_SESSION_ID_PATTERN.test(sessionId)) {
    throw new StripeBillingError("Stripe Checkout Session is invalid.", {
      status: 400,
      code: "stripe_checkout_session_invalid",
    });
  }
  if (session.mode !== "payment" || session.payment_status !== "paid") {
    throw new StripeBillingError("Stripe Checkout Session is not a paid credit-pack payment.", {
      status: 400,
      code: "stripe_checkout_not_paid",
    });
  }
  const metadata = session.metadata && typeof session.metadata === "object" && !Array.isArray(session.metadata)
    ? session.metadata
    : {};
  const organizationId = normalizeStripeMetadataOrgId(metadata.organization_id || metadata.organizationId);
  const userId = normalizeUserId(metadata.user_id || metadata.userId);
  const pack = getStripeCreditPack(metadata.credit_pack_id || metadata.creditPackId);
  const metadataCredits = Number(metadata.credits);
  const amountTotal = Number(session.amount_total);
  const currency = safeString(session.currency, 16)?.toLowerCase();
  if (!Number.isInteger(metadataCredits) || metadataCredits !== pack.credits) {
    throw new StripeBillingError("Stripe credit pack metadata is invalid.", {
      status: 400,
      code: "stripe_credit_pack_mismatch",
    });
  }
  if (amountTotal !== pack.amountCents || currency !== pack.currency) {
    throw new StripeBillingError("Stripe checkout amount does not match the credit pack.", {
      status: 400,
      code: "stripe_credit_pack_amount_mismatch",
    });
  }
  return {
    sessionId,
    paymentIntent: safeString(session.payment_intent, 128),
    customer: safeString(session.customer, 128),
    organizationId,
    userId,
    pack,
    internalCheckoutSessionId: safeString(metadata.internal_checkout_session_id, 64),
  };
}

function normalizeLiveCheckoutCompletion(payload) {
  if (payload?.type !== "checkout.session.completed") {
    return null;
  }
  if (payload.livemode !== true) {
    throw new StripeBillingError("Testmode Stripe events are not accepted on the live webhook.", {
      status: 403,
      code: "stripe_live_webhook_mode_mismatch",
    });
  }
  const session = getStripeSessionObject(payload);
  if (session.livemode !== true) {
    throw new StripeBillingError("Testmode Stripe Checkout Sessions are not accepted on the live webhook.", {
      status: 403,
      code: "stripe_live_webhook_mode_mismatch",
    });
  }
  const sessionId = safeString(session.id, 220);
  if (!sessionId || !LIVE_CHECKOUT_SESSION_ID_PATTERN.test(sessionId)) {
    throw new StripeBillingError("Stripe live Checkout Session is invalid.", {
      status: 400,
      code: "stripe_checkout_session_invalid",
    });
  }
  if (session.mode !== "payment" || session.payment_status !== "paid") {
    throw new StripeBillingError("Stripe live Checkout Session is not a paid credit-pack payment.", {
      status: 400,
      code: "stripe_checkout_not_paid",
    });
  }
  const metadata = session.metadata && typeof session.metadata === "object" && !Array.isArray(session.metadata)
    ? session.metadata
    : {};
  const checkoutScope = safeString(metadata.checkout_scope || metadata.checkoutScope, 32) || LIVE_ORGANIZATION_CHECKOUT_SCOPE;
  if (![LIVE_ORGANIZATION_CHECKOUT_SCOPE, LIVE_MEMBER_CHECKOUT_SCOPE].includes(checkoutScope)) {
    throw new StripeBillingError("Stripe live checkout scope is invalid.", {
      status: 400,
      code: "stripe_checkout_scope_invalid",
    });
  }
  const organizationId = checkoutScope === LIVE_MEMBER_CHECKOUT_SCOPE
    ? null
    : normalizeStripeMetadataOrgId(metadata.organization_id || metadata.organizationId);
  const userId = normalizeUserId(metadata.user_id || metadata.userId);
  const pack = getStripeLiveCreditPack(metadata.credit_pack_id || metadata.creditPackId || metadata.pack_id || metadata.packId, { includeLegacy: true });
  const metadataCredits = Number(metadata.credits);
  const amountTotal = Number(session.amount_total);
  const currency = safeString(session.currency, 16)?.toLowerCase();
  if (!Number.isInteger(metadataCredits) || metadataCredits !== pack.credits) {
    throw new StripeBillingError("Stripe live credit pack metadata is invalid.", {
      status: 400,
      code: "stripe_credit_pack_mismatch",
    });
  }
  if (amountTotal !== pack.amountCents || currency !== pack.currency) {
    throw new StripeBillingError("Stripe live checkout amount does not match the credit pack.", {
      status: 400,
      code: "stripe_credit_pack_amount_mismatch",
    });
  }
  return {
    sessionId,
    paymentIntent: safeString(session.payment_intent, 128),
    customer: safeString(session.customer, 128),
    paymentStatus: safeString(session.payment_status, 64),
    checkoutScope,
    organizationId,
    userId,
    pack,
    internalCheckoutSessionId: safeString(metadata.internal_checkout_session_id, 64),
  };
}

function metadataObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeLiveSubscriptionCheckoutCompletion(payload) {
  if (payload?.type !== "checkout.session.completed") return null;
  if (payload.livemode !== true) {
    throw new StripeBillingError("Testmode Stripe events are not accepted on the live webhook.", {
      status: 403,
      code: "stripe_live_webhook_mode_mismatch",
    });
  }
  const session = getStripeSessionObject(payload);
  if (session.livemode !== true) {
    throw new StripeBillingError("Testmode Stripe Checkout Sessions are not accepted on the live webhook.", {
      status: 403,
      code: "stripe_live_webhook_mode_mismatch",
    });
  }
  const sessionId = safeString(session.id, 220);
  if (!sessionId || !LIVE_CHECKOUT_SESSION_ID_PATTERN.test(sessionId)) {
    throw new StripeBillingError("Stripe live Checkout Session is invalid.", {
      status: 400,
      code: "stripe_checkout_session_invalid",
    });
  }
  if (session.mode !== "subscription") {
    throw new StripeBillingError("Stripe live Checkout Session is not a subscription checkout.", {
      status: 400,
      code: "stripe_checkout_scope_invalid",
    });
  }
  const metadata = metadataObject(session.metadata);
  const checkoutScope = safeString(metadata.checkout_scope || metadata.checkoutScope, 32);
  if (checkoutScope !== LIVE_MEMBER_SUBSCRIPTION_CHECKOUT_SCOPE) {
    throw new StripeBillingError("Stripe live subscription checkout scope is invalid.", {
      status: 400,
      code: "stripe_checkout_scope_invalid",
    });
  }
  const subscriptionId = safeString(session.subscription, 128);
  if (!subscriptionId || !LIVE_SUBSCRIPTION_ID_PATTERN.test(subscriptionId)) {
    throw new StripeBillingError("Stripe live subscription id is invalid.", {
      status: 400,
      code: "stripe_subscription_invalid",
    });
  }
  return {
    sessionId,
    subscriptionId,
    customer: safeString(session.customer, 128),
    paymentStatus: safeString(session.payment_status, 64),
    userId: normalizeUserId(metadata.user_id || metadata.userId),
    planId: safeString(metadata.plan_id || metadata.subscription_plan_id || metadata.planId, 64),
    internalCheckoutSessionId: safeString(metadata.internal_checkout_session_id, 64),
  };
}

function stripeTimestampToIso(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (Number.isFinite(number)) {
    const date = new Date(number > 10_000_000_000 ? number : number * 1000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getSubscriptionItem(object) {
  const items = object?.items?.data;
  return Array.isArray(items) && items.length ? items[0] : null;
}

function getStripePriceId(value) {
  if (typeof value === "string") {
    return safeString(value, 128);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return safeString(value.id || value.price || value.price_id, 128);
}

function getSubscriptionPriceId(object) {
  const item = getSubscriptionItem(object);
  return safeString(
    getStripePriceId(object?.price) ||
    getStripePriceId(object?.plan) ||
    getStripePriceId(item?.price) ||
    getStripePriceId(item?.plan) ||
    item?.pricing?.price_details?.price,
    128
  );
}

function getSubscriptionPeriodStart(object) {
  return object?.current_period_start ?? getSubscriptionItem(object)?.current_period_start ?? null;
}

function getSubscriptionPeriodEnd(object) {
  return object?.current_period_end ?? getSubscriptionItem(object)?.current_period_end ?? null;
}

function normalizeLiveSubscriptionEvent(payload) {
  if (!["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(payload?.type)) {
    return null;
  }
  if (payload.livemode !== true) {
    throw new StripeBillingError("Testmode Stripe events are not accepted on the live webhook.", {
      status: 403,
      code: "stripe_live_webhook_mode_mismatch",
    });
  }
  const subscription = getStripeSessionObject(payload);
  if (subscription.livemode !== true) {
    throw new StripeBillingError("Testmode Stripe subscriptions are not accepted on the live webhook.", {
      status: 403,
      code: "stripe_live_webhook_mode_mismatch",
    });
  }
  const subscriptionId = safeString(subscription.id, 128);
  if (!subscriptionId || !LIVE_SUBSCRIPTION_ID_PATTERN.test(subscriptionId)) {
    throw new StripeBillingError("Stripe live subscription id is invalid.", {
      status: 400,
      code: "stripe_subscription_invalid",
    });
  }
  const metadata = metadataObject(subscription.metadata);
  return {
    subscriptionId,
    customer: safeString(subscription.customer, 128),
    userId: metadata.user_id || metadata.userId ? normalizeUserId(metadata.user_id || metadata.userId) : null,
    priceId: getSubscriptionPriceId(subscription),
    status: safeString(subscription.status, 64) || (payload.type === "customer.subscription.deleted" ? "canceled" : "incomplete"),
    currentPeriodStart: stripeTimestampToIso(getSubscriptionPeriodStart(subscription)),
    currentPeriodEnd: stripeTimestampToIso(getSubscriptionPeriodEnd(subscription)),
    cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
    canceledAt: stripeTimestampToIso(subscription.canceled_at),
    metadata,
  };
}

function getInvoiceLineForSubscription(invoice, subscriptionId) {
  const lines = Array.isArray(invoice?.lines?.data) ? invoice.lines.data : [];
  return lines.find((line) =>
    safeString(line.subscription, 128) === subscriptionId ||
    safeString(line.parent?.subscription_item_details?.subscription, 128) === subscriptionId ||
    safeString(line.subscription_item, 128)
  ) || lines[0] || null;
}

function getInvoiceLinePriceId(line) {
  return safeString(
    getStripePriceId(line?.price) ||
    getStripePriceId(line?.plan) ||
    line?.pricing?.price_details?.price ||
    line?.price_id ||
    line?.plan_id,
    128
  );
}

function getInvoiceLinePriceIds(invoice) {
  const lines = Array.isArray(invoice?.lines?.data) ? invoice.lines.data : [];
  const priceIds = new Set();
  for (const line of lines) {
    const priceId = getInvoiceLinePriceId(line);
    if (priceId) priceIds.add(priceId);
  }
  return Array.from(priceIds);
}

function getInvoiceSubscriptionId(invoice) {
  const lines = Array.isArray(invoice?.lines?.data) ? invoice.lines.data : [];
  const lineSubscriptionId = lines
    .map((line) => safeString(line?.parent?.subscription_item_details?.subscription || line?.subscription, 128))
    .find(Boolean);
  return safeString(
    invoice?.subscription ||
    invoice?.parent?.subscription_details?.subscription ||
    invoice?.subscription_details?.subscription ||
    lineSubscriptionId,
    128
  );
}

function getInvoiceSubscriptionMetadata(invoice, line = null) {
  return {
    ...metadataObject(line?.metadata),
    ...metadataObject(invoice?.subscription_details?.metadata),
    ...metadataObject(invoice?.parent?.subscription_details?.metadata),
    ...metadataObject(invoice?.metadata),
  };
}

function normalizeLiveInvoicePaidEvent(payload) {
  if (payload?.type !== "invoice.paid" && payload?.type !== "invoice.payment_succeeded") return null;
  if (payload.livemode !== true) {
    throw new StripeBillingError("Testmode Stripe events are not accepted on the live webhook.", {
      status: 403,
      code: "stripe_live_webhook_mode_mismatch",
    });
  }
  const invoice = getStripeSessionObject(payload);
  if (invoice.livemode !== true) {
    throw new StripeBillingError("Testmode Stripe invoices are not accepted on the live webhook.", {
      status: 403,
      code: "stripe_live_webhook_mode_mismatch",
    });
  }
  const invoiceId = safeString(invoice.id, 128);
  if (!invoiceId || !LIVE_INVOICE_ID_PATTERN.test(invoiceId)) {
    throw new StripeBillingError("Stripe live invoice id is invalid.", {
      status: 400,
      code: "stripe_invoice_invalid",
    });
  }
  if (invoice.status && invoice.status !== "paid") {
    throw new StripeBillingError("Stripe live invoice is not paid.", {
      status: 400,
      code: "stripe_invoice_not_paid",
    });
  }
  const subscriptionId = getInvoiceSubscriptionId(invoice);
  if (!subscriptionId) {
    return {
      ignored: true,
      reason: "Stripe invoice is not subscription-backed.",
      invoiceId,
      subscriptionId: null,
      customer: safeString(invoice.customer, 128),
    };
  }
  if (!LIVE_SUBSCRIPTION_ID_PATTERN.test(subscriptionId)) {
    throw new StripeBillingError("Stripe live invoice subscription is invalid.", {
      status: 400,
      code: "stripe_subscription_invalid",
    });
  }
  const line = getInvoiceLineForSubscription(invoice, subscriptionId);
  const priceIds = getInvoiceLinePriceIds(invoice);
  const metadata = getInvoiceSubscriptionMetadata(invoice, line);
  const periodStart = stripeTimestampToIso(line?.period?.start || invoice.period_start);
  const periodEnd = stripeTimestampToIso(line?.period?.end || invoice.period_end);
  if (!periodStart || !periodEnd) {
    throw new StripeBillingError("Stripe live invoice subscription period is missing.", {
      status: 400,
      code: "stripe_subscription_period_missing",
    });
  }
  const priceId = getInvoiceLinePriceId(line) || priceIds[0] || null;
  return {
    invoiceId,
    subscriptionId,
    customer: safeString(invoice.customer, 128),
    userId: metadata.user_id || metadata.userId ? normalizeUserId(metadata.user_id || metadata.userId) : null,
    priceId,
    priceIds,
    status: "active",
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: false,
    metadata,
  };
}

function getOptionalStripeEventObject(payload) {
  const object = payload?.data?.object;
  return object && typeof object === "object" && !Array.isArray(object) ? object : {};
}

function extractStripeLiveReviewIdentifiers({ payload, stored }) {
  const object = getOptionalStripeEventObject(payload);
  const metadata = metadataObject(object.metadata);
  const objectType = safeString(object.object, 64);
  const objectId = safeString(object.id, 128);
  const eventType = safeString(payload?.type, 128);
  const identifiers = {
    providerEventId: safeString(stored?.event?.providerEventId || payload?.id, 128),
    invoiceId: null,
    chargeId: null,
    refundId: null,
    disputeId: null,
    checkoutSessionId: null,
    customerId: safeString(object.customer, 128),
    subscriptionId: safeString(
      object.subscription ||
      object.parent?.subscription_details?.subscription ||
      object.subscription_details?.subscription ||
      metadata.subscription_id ||
      metadata.subscriptionId,
      128
    ),
    paymentIntentId: safeString(object.payment_intent, 128),
  };

  if (objectType === "invoice" || eventType?.startsWith("invoice.")) {
    identifiers.invoiceId = objectId;
  }
  if (objectType === "charge" || eventType === "charge.refunded") {
    identifiers.chargeId = objectId;
  }
  if (objectType === "refund" || eventType?.startsWith("refund.")) {
    identifiers.refundId = objectId;
  }
  if (objectType === "dispute" || eventType?.startsWith("charge.dispute.")) {
    identifiers.disputeId = objectId;
  }
  if (objectType === "checkout.session" || eventType === "checkout.session.expired") {
    identifiers.checkoutSessionId = objectId;
  }

  identifiers.invoiceId ||= safeString(object.invoice, 128);
  identifiers.chargeId ||= safeString(object.charge, 128);
  identifiers.refundId ||= safeString(object.refund, 128);
  identifiers.disputeId ||= safeString(object.dispute, 128);
  identifiers.checkoutSessionId ||= safeString(object.checkout_session || object.checkoutSession, 128);

  return {
    objectType,
    objectLivemode: object.livemode === true ? true : (object.livemode === false ? false : null),
    identifiers,
  };
}

function summarizeCheckoutReviewRow(row, scope) {
  if (!row) return null;
  const ledgerEntryId = row.credit_ledger_entry_id || row.member_credit_ledger_entry_id || null;
  return {
    scope,
    status: row.status || null,
    providerMode: row.provider_mode || null,
    userId: row.user_id || null,
    organizationId: row.organization_id || null,
    creditPackId: row.credit_pack_id || row.plan_id || null,
    ledgerEntryPresent: Boolean(ledgerEntryId),
    completedAtPresent: Boolean(row.completed_at),
    grantedAtPresent: Boolean(row.granted_at),
    billingEventLinked: Boolean(row.billing_event_id),
  };
}

function checkoutReviewRowNeedsReview(summary) {
  if (!summary) return false;
  return summary.status === "completed" ||
    summary.ledgerEntryPresent ||
    summary.completedAtPresent ||
    summary.grantedAtPresent;
}

async function inspectExpiredLiveCheckoutSession(env, checkoutSessionId) {
  const sessionId = safeString(checkoutSessionId, 220);
  if (!sessionId) {
    return {
      reviewState: "needs_review",
      reason: "Stripe checkout.session.expired did not include a safe checkout session id.",
      recommendedAction: "Review the Stripe event manually and confirm no BITBI checkout or credit grant is linked.",
      persistedCheckoutState: [],
      organizationId: null,
      userId: null,
    };
  }

  const rows = [
    summarizeCheckoutReviewRow(await fetchCheckoutByProviderSession(env, sessionId), LIVE_ORGANIZATION_CHECKOUT_SCOPE),
    summarizeCheckoutReviewRow(await fetchMemberCheckoutByProviderSession(env, sessionId), LIVE_MEMBER_CHECKOUT_SCOPE),
    summarizeCheckoutReviewRow(await fetchMemberSubscriptionCheckoutByProviderSession(env, sessionId), LIVE_MEMBER_SUBSCRIPTION_CHECKOUT_SCOPE),
  ].filter((row) => row && row.providerMode === STRIPE_MODE_LIVE);
  const inconsistent = rows.some(checkoutReviewRowNeedsReview);
  const first = rows[0] || null;
  if (inconsistent) {
    return {
      reviewState: "needs_review",
      reason: "Expired live checkout has persisted state that may already be completed or ledger-linked.",
      recommendedAction: "Review the checkout, ledger, and Stripe session before taking any manual remediation.",
      persistedCheckoutState: rows,
      organizationId: first?.organizationId || null,
      userId: first?.userId || null,
    };
  }
  return {
    reviewState: "informational",
    reason: rows.length
      ? "Expired live checkout is known locally and has no completed or ledger-linked state."
      : "Expired live checkout has no local persisted checkout state.",
    recommendedAction: "No automatic credit grant was performed; keep as audit evidence unless Stripe shows a later successful payment.",
    persistedCheckoutState: rows,
    organizationId: first?.organizationId || null,
    userId: first?.userId || null,
  };
}

async function handleLiveOperatorReviewEvent({ env, stored, payload }) {
  const policy = LIVE_OPERATOR_REVIEW_POLICIES[payload?.type];
  if (!policy) return null;
  const { objectType, objectLivemode, identifiers } = extractStripeLiveReviewIdentifiers({ payload, stored });
  if (objectLivemode === false) {
    throw new StripeBillingError("Testmode Stripe event objects are not accepted on the live webhook.", {
      status: 403,
      code: "stripe_live_webhook_mode_mismatch",
    });
  }

  const checkoutReview = payload.type === "checkout.session.expired"
    ? await inspectExpiredLiveCheckoutSession(env, identifiers.checkoutSessionId)
    : null;
  const reviewState = checkoutReview?.reviewState || policy.reviewState;
  const actionStatus = reviewState === "informational" ? "ignored" : "deferred";
  const event = await updateBillingProviderEventProcessing(env, {
    eventId: stored.event.id,
    processingStatus: reviewState === "informational" ? "ignored" : "planned",
    organizationId: checkoutReview?.organizationId || null,
    userId: checkoutReview?.userId || null,
    actionType: payload.type,
    actionStatus,
    actionDryRun: true,
    actionSummary: {
      eventType: payload.type,
      providerMode: STRIPE_MODE_LIVE,
      sideEffectsEnabled: false,
      reviewState,
      reviewReason: checkoutReview?.reason || policy.reason,
      recommendedAction: checkoutReview?.recommendedAction || policy.recommendedAction,
      safeIdentifiers: identifiers,
      stripeObjectType: objectType || null,
      stripeObjectLivemode: objectLivemode,
      persistedCheckoutState: checkoutReview?.persistedCheckoutState || undefined,
      creditsGranted: 0,
      creditsReversed: 0,
      creditMutation: "none",
      operatorReviewOnly: true,
    },
  });
  return {
    event,
    duplicate: false,
    actionPlanned: reviewState !== "informational",
    creditGrant: null,
    checkout: null,
    subscription: null,
  };
}

async function markLiveOperatorReviewEventFailed(env, { stored, payload, error }) {
  const code = error instanceof BillingError || error instanceof StripeBillingError || error instanceof BillingEventError
    ? error.code
    : "stripe_live_review_event_failed";
  const message = error instanceof BillingError || error instanceof StripeBillingError || error instanceof BillingEventError
    ? error.message
    : "Stripe live review event handling failed.";
  const { objectType, objectLivemode, identifiers } = extractStripeLiveReviewIdentifiers({ payload, stored });
  return updateBillingProviderEventProcessing(env, {
    eventId: stored.event.id,
    processingStatus: "failed",
    errorCode: code,
    errorMessage: message,
    actionType: payload.type,
    actionStatus: "failed",
    actionDryRun: true,
    actionSummary: {
      eventType: payload.type,
      providerMode: STRIPE_MODE_LIVE,
      sideEffectsEnabled: false,
      reviewState: "blocked",
      reviewReason: "Stripe live operator-review event failed validation or storage update.",
      recommendedAction: "Review the Stripe event and BITBI billing-event record manually before taking any billing action.",
      safeIdentifiers: identifiers,
      stripeObjectType: objectType || null,
      stripeObjectLivemode: objectLivemode,
      errorCode: code,
      creditsGranted: 0,
      creditsReversed: 0,
      creditMutation: "none",
      operatorReviewOnly: true,
    },
  });
}

async function markStripeEventFailed(env, {
  eventId,
  actionType,
  errorCode,
  errorMessage,
}) {
  return updateBillingProviderEventProcessing(env, {
    eventId,
    processingStatus: "failed",
    errorCode,
    errorMessage,
    actionType,
    actionStatus: "failed",
    actionDryRun: false,
    actionSummary: {
      sideEffectsEnabled: true,
      creditGrantStatus: "failed",
      errorCode,
    },
  });
}

async function upsertCompletedCheckoutSession({
  env,
  completion,
  billingEventId,
  ledgerEntryId = null,
  providerMode = STRIPE_MODE_TEST,
}) {
  const existing = await fetchCheckoutByProviderSession(env, completion.sessionId);
  const now = nowIso();
  if (!existing) {
    throw new StripeBillingError("Stripe Checkout Session was not created by this installation.", {
      status: 403,
      code: "stripe_checkout_session_unrecognized",
    });
  }
  assertCheckoutMatchesCompletion(existing, completion);
  await env.DB.prepare(
    `UPDATE billing_checkout_sessions
     SET status = 'completed',
         provider_payment_intent_id = COALESCE(?, provider_payment_intent_id),
         provider_customer_id = COALESCE(?, provider_customer_id),
         billing_event_id = COALESCE(?, billing_event_id),
         credit_ledger_entry_id = COALESCE(?, credit_ledger_entry_id),
         payment_status = COALESCE(?, payment_status),
         error_code = NULL,
         error_message = NULL,
         updated_at = ?,
         completed_at = COALESCE(completed_at, ?),
         granted_at = CASE WHEN ? IS NOT NULL THEN COALESCE(granted_at, ?) ELSE granted_at END
     WHERE provider = 'stripe' AND provider_checkout_session_id = ?`
  ).bind(
    completion.paymentIntent && paymentIntentPatternForMode(providerMode).test(completion.paymentIntent)
      ? completion.paymentIntent
      : null,
    completion.customer,
    billingEventId,
    ledgerEntryId,
    completion.paymentStatus || "paid",
    now,
    now,
    ledgerEntryId,
    now,
    completion.sessionId
  ).run();
  return fetchCheckoutByProviderSession(env, completion.sessionId);
}

function assertCheckoutMatchesCompletion(checkout, completion) {
  if (
    checkout.organization_id !== completion.organizationId ||
    checkout.user_id !== completion.userId ||
    checkout.credit_pack_id !== completion.pack.id ||
    Number(checkout.credits) !== completion.pack.credits ||
    Number(checkout.amount_cents) !== completion.pack.amountCents ||
    String(checkout.currency).toLowerCase() !== completion.pack.currency
  ) {
    throw new StripeBillingError("Stripe Checkout Session does not match the stored checkout request.", {
      status: 409,
      code: "stripe_checkout_session_mismatch",
    });
  }
}

function assertMemberCheckoutMatchesCompletion(checkout, completion) {
  if (
    checkout.user_id !== completion.userId ||
    checkout.credit_pack_id !== completion.pack.id ||
    Number(checkout.credits) !== completion.pack.credits ||
    Number(checkout.amount_cents) !== completion.pack.amountCents ||
    String(checkout.currency).toLowerCase() !== completion.pack.currency
  ) {
    throw new StripeBillingError("Stripe live member Checkout Session does not match the stored checkout request.", {
      status: 409,
      code: "stripe_checkout_session_mismatch",
    });
  }
}

async function requireAdminCreatedCheckoutSession(env, completion) {
  const checkout = await fetchCheckoutByProviderSession(env, completion.sessionId);
  if (!checkout) {
    throw new StripeBillingError("Stripe Checkout Session was not created by this installation.", {
      status: 403,
      code: "stripe_checkout_session_unrecognized",
    });
  }
  assertCheckoutMatchesCompletion(checkout, completion);

  const creator = await env.DB.prepare(
    "SELECT id, email, role, status FROM users WHERE id = ? LIMIT 1"
  ).bind(checkout.user_id).first();
  if (creator?.role !== "admin" || creator?.status !== "active") {
    throw new StripeBillingError("Stripe Checkout Session was not created by a platform admin.", {
      status: 403,
      code: "stripe_checkout_admin_scope_required",
    });
  }
  return checkout;
}

async function upsertCompletedMemberCheckoutSession({
  env,
  completion,
  billingEventId,
  ledgerEntryId = null,
}) {
  const existing = await fetchMemberCheckoutByProviderSession(env, completion.sessionId);
  const now = nowIso();
  if (!existing) {
    throw new StripeBillingError("Stripe live member Checkout Session was not created by this installation.", {
      status: 403,
      code: "stripe_checkout_session_unrecognized",
    });
  }
  assertMemberCheckoutMatchesCompletion(existing, completion);
  await env.DB.prepare(
    `UPDATE billing_member_checkout_sessions
     SET status = 'completed',
         provider_payment_intent_id = COALESCE(?, provider_payment_intent_id),
         provider_customer_id = COALESCE(?, provider_customer_id),
         billing_event_id = COALESCE(?, billing_event_id),
         member_credit_ledger_entry_id = COALESCE(?, member_credit_ledger_entry_id),
         payment_status = COALESCE(?, payment_status),
         error_code = NULL,
         error_message = NULL,
         updated_at = ?,
         completed_at = COALESCE(completed_at, ?),
         granted_at = CASE WHEN ? IS NOT NULL THEN COALESCE(granted_at, ?) ELSE granted_at END
     WHERE provider = 'stripe' AND provider_checkout_session_id = ?`
  ).bind(
    completion.paymentIntent && paymentIntentPatternForMode(STRIPE_MODE_LIVE).test(completion.paymentIntent)
      ? completion.paymentIntent
      : null,
    completion.customer,
    billingEventId,
    ledgerEntryId,
    completion.paymentStatus || "paid",
    now,
    now,
    ledgerEntryId,
    now,
    completion.sessionId
  ).run();
  return fetchMemberCheckoutByProviderSession(env, completion.sessionId);
}

async function upsertCompletedMemberSubscriptionCheckoutSession({
  env,
  completion,
  billingEventId,
}) {
  const existing = await fetchMemberSubscriptionCheckoutByProviderSession(env, completion.sessionId);
  const now = nowIso();
  if (!existing) {
    throw new StripeBillingError("Stripe live member subscription Checkout Session was not created by this installation.", {
      status: 403,
      code: "stripe_checkout_session_unrecognized",
    });
  }
  assertMemberSubscriptionCheckoutMatchesCompletion(existing, completion);
  await env.DB.prepare(
    `UPDATE billing_member_subscription_checkout_sessions
     SET status = 'completed',
         provider_subscription_id = COALESCE(?, provider_subscription_id),
         provider_customer_id = COALESCE(?, provider_customer_id),
         billing_event_id = COALESCE(?, billing_event_id),
         payment_status = COALESCE(?, payment_status),
         error_code = NULL,
         error_message = NULL,
         updated_at = ?,
         completed_at = COALESCE(completed_at, ?)
     WHERE provider = 'stripe' AND provider_checkout_session_id = ?`
  ).bind(
    completion.subscriptionId,
    completion.customer,
    billingEventId,
    completion.paymentStatus || "paid",
    now,
    now,
    completion.sessionId
  ).run();
  return fetchMemberSubscriptionCheckoutByProviderSession(env, completion.sessionId);
}

async function requireLiveAuthorizedCheckoutSession(env, completion) {
  const checkout = await fetchCheckoutByProviderSession(env, completion.sessionId);
  if (!checkout || checkout.provider_mode !== STRIPE_MODE_LIVE) {
    throw new StripeBillingError("Stripe live Checkout Session was not created by this installation.", {
      status: 403,
      code: "stripe_checkout_session_unrecognized",
    });
  }
  assertCheckoutMatchesCompletion(checkout, completion);

  const scope = normalizeLiveAuthorizationScope(
    checkout.authorization_scope || parseJsonObject(checkout.metadata_json).authorizationScope
  );
  const creator = await env.DB.prepare(
    "SELECT id, email, role, status FROM users WHERE id = ? LIMIT 1"
  ).bind(checkout.user_id).first();
  if (!creator || creator.status !== "active") {
    throw new StripeBillingError("Stripe live Checkout Session creator is no longer active.", {
      status: 403,
      code: "stripe_checkout_creator_inactive",
    });
  }
  if (scope === "platform_admin") {
    if (creator.role !== "admin") {
      throw new StripeBillingError("Stripe live Checkout Session was not created by a current platform admin.", {
        status: 403,
        code: "stripe_checkout_admin_scope_required",
      });
    }
    return { checkout, scope };
  }

  const membership = await env.DB.prepare(
    `SELECT om.role, om.status, o.status AS organization_status
     FROM organization_memberships om
     JOIN organizations o ON o.id = om.organization_id
     WHERE om.organization_id = ? AND om.user_id = ?
     LIMIT 1`
  ).bind(checkout.organization_id, checkout.user_id).first();
  if (
    membership?.role !== "owner" ||
    membership?.status !== "active" ||
    membership?.organization_status !== "active"
  ) {
    throw new StripeBillingError("Stripe live Checkout Session owner authorization is no longer valid.", {
      status: 403,
      code: "stripe_checkout_owner_scope_required",
    });
  }
  return { checkout, scope };
}

async function requireLiveMemberCheckoutSession(env, completion) {
  const checkout = await fetchMemberCheckoutByProviderSession(env, completion.sessionId);
  if (!checkout || checkout.provider_mode !== STRIPE_MODE_LIVE) {
    throw new StripeBillingError("Stripe live member Checkout Session was not created by this installation.", {
      status: 403,
      code: "stripe_checkout_session_unrecognized",
    });
  }
  assertMemberCheckoutMatchesCompletion(checkout, completion);
  const scope = checkout.authorization_scope || parseJsonObject(checkout.metadata_json).authorizationScope;
  if (scope !== LIVE_MEMBER_AUTH_SCOPE) {
    throw new StripeBillingError("Stripe live member Checkout Session scope is invalid.", {
      status: 403,
      code: "stripe_checkout_scope_invalid",
    });
  }
  const creator = await env.DB.prepare(
    "SELECT id, email, role, status FROM users WHERE id = ? LIMIT 1"
  ).bind(checkout.user_id).first();
  if (!creator || creator.status !== "active") {
    throw new StripeBillingError("Stripe live Checkout Session creator is no longer active.", {
      status: 403,
      code: "stripe_checkout_creator_inactive",
    });
  }
  return { checkout, scope: LIVE_MEMBER_AUTH_SCOPE };
}

function assertMemberSubscriptionCheckoutMatchesCompletion(checkout, completion) {
  if (
    checkout.user_id !== completion.userId ||
    checkout.plan_id !== BITBI_MEMBER_SUBSCRIPTION.id ||
    Number(checkout.amount_cents) !== BITBI_MEMBER_SUBSCRIPTION.amountCents ||
    String(checkout.currency).toLowerCase() !== BITBI_MEMBER_SUBSCRIPTION.currency
  ) {
    throw new StripeBillingError("Stripe live member subscription Checkout Session does not match the stored checkout request.", {
      status: 409,
      code: "stripe_checkout_session_mismatch",
    });
  }
}

async function requireLiveMemberSubscriptionCheckoutSession(env, completion) {
  const checkout = await fetchMemberSubscriptionCheckoutByProviderSession(env, completion.sessionId);
  if (!checkout || checkout.provider_mode !== STRIPE_MODE_LIVE) {
    throw new StripeBillingError("Stripe live member subscription Checkout Session was not created by this installation.", {
      status: 403,
      code: "stripe_checkout_session_unrecognized",
    });
  }
  assertMemberSubscriptionCheckoutMatchesCompletion(checkout, completion);
  const scope = checkout.authorization_scope || parseJsonObject(checkout.metadata_json).authorizationScope;
  if (scope !== LIVE_MEMBER_AUTH_SCOPE) {
    throw new StripeBillingError("Stripe live member subscription Checkout Session scope is invalid.", {
      status: 403,
      code: "stripe_checkout_scope_invalid",
    });
  }
  const creator = await env.DB.prepare(
    "SELECT id, email, role, status FROM users WHERE id = ? LIMIT 1"
  ).bind(checkout.user_id).first();
  if (!creator || creator.status !== "active") {
    throw new StripeBillingError("Stripe live subscription Checkout Session creator is no longer active.", {
      status: 403,
      code: "stripe_checkout_creator_inactive",
    });
  }
  return { checkout, scope: LIVE_MEMBER_AUTH_SCOPE };
}

function serializeDashboardCheckout(row) {
  const checkout = serializeCheckoutRow(row);
  return {
    ...checkout,
    sessionId: row.provider_checkout_session_id
      ? `${String(row.provider_checkout_session_id).slice(0, 14)}…`
      : null,
    paymentIntentId: row.provider_payment_intent_id
      ? `${String(row.provider_payment_intent_id).slice(0, 13)}…`
      : null,
    billingEventId: row.billing_event_id || null,
    ledgerEntryId: row.credit_ledger_entry_id || null,
  };
}

function serializeDashboardMemberCheckout(row) {
  const checkout = serializeMemberCheckoutRow(row);
  return {
    ...checkout,
    sessionId: row.provider_checkout_session_id
      ? `${String(row.provider_checkout_session_id).slice(0, 14)}…`
      : null,
    paymentIntentId: row.provider_payment_intent_id
      ? `${String(row.provider_payment_intent_id).slice(0, 13)}…`
      : null,
    billingEventId: row.billing_event_id || null,
    ledgerEntryId: row.member_credit_ledger_entry_id || null,
  };
}

function serializeDashboardLedger(row) {
  return {
    id: row.id,
    amount: Number(row.amount || 0),
    balanceAfter: Number(row.balance_after || 0),
    entryType: row.entry_type,
    featureKey: row.feature_key || null,
    source: row.source || null,
    createdByUserId: row.created_by_user_id || null,
    createdAt: row.created_at,
  };
}

export async function getMemberLiveCreditsPurchaseContext({
  env,
  userId,
  includeConfigNames = false,
  limit = 25,
}) {
  const normalizedUserId = normalizeUserId(userId);
  const appliedLimit = Math.min(Math.max(Number.parseInt(String(limit || 25), 10) || 25, 1), 50);
  const purchaseRows = await env.DB.prepare(
    `SELECT id, provider, provider_mode, provider_checkout_session_id,
            provider_payment_intent_id, user_id, credit_pack_id,
            credits, amount_cents, currency, status, idempotency_key_hash,
            request_fingerprint_hash, checkout_url, provider_customer_id,
            billing_event_id, member_credit_ledger_entry_id, authorization_scope,
            payment_status, granted_at, failed_at, expired_at, metadata_json,
            created_at, updated_at, completed_at
     FROM billing_member_checkout_sessions
     WHERE user_id = ?
       AND provider = 'stripe'
       AND provider_mode = 'live'
     ORDER BY created_at DESC, id DESC
     LIMIT ?`
  ).bind(normalizedUserId, appliedLimit).all();
  return {
    liveCheckout: getStripeLiveCreditPackCheckoutStatus(env, { includeConfigNames }),
    subscriptionCheckout: getStripeLiveSubscriptionCheckoutStatus(env, { includeConfigNames }),
    packs: listStripeLiveCreditPacks(),
    purchaseHistory: (purchaseRows.results || []).map(serializeDashboardMemberCheckout),
  };
}

export async function getOrganizationCreditsDashboard({
  env,
  organizationId,
  accessScope,
  includeConfigNames = false,
  limit = 25,
}) {
  const orgId = normalizeOrgId(organizationId);
  const scope = normalizeLiveAuthorizationScope(accessScope);
  const appliedLimit = Math.min(Math.max(Number.parseInt(String(limit || 25), 10) || 25, 1), 50);
  const organization = await env.DB.prepare(
    "SELECT id, name, slug, status, created_at, updated_at FROM organizations WHERE id = ? LIMIT 1"
  ).bind(orgId).first();
  if (!organization || organization.status !== "active") {
    throw new StripeBillingError("Organization is not available for credits.", {
      status: 404,
      code: "organization_not_found",
    });
  }

  const currentBalance = await getCreditBalance(env, orgId);
  const now = nowIso();
  const reservedRow = await env.DB.prepare(
    `SELECT COALESCE(SUM(credit_cost), 0) AS reserved_credits
     FROM ai_usage_attempts
     WHERE organization_id = ?
       AND billing_status = 'reserved'
       AND expires_at > ?`
  ).bind(orgId, now).first();
  const reservedCredits = Number(reservedRow?.reserved_credits || 0);
  const purchasedRow = await env.DB.prepare(
    `SELECT COALESCE(SUM(credits), 0) AS credits
     FROM billing_checkout_sessions
     WHERE organization_id = ?
       AND provider = 'stripe'
       AND provider_mode = 'live'
       AND status = 'completed'
       AND credit_ledger_entry_id IS NOT NULL`
  ).bind(orgId).first();
  const manualGrantRow = await env.DB.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS credits
     FROM credit_ledger
     WHERE organization_id = ?
       AND entry_type = 'grant'
       AND source <> 'stripe_live_checkout'`
  ).bind(orgId).first();
  const consumedRow = await env.DB.prepare(
    `SELECT COALESCE(SUM(ABS(amount)), 0) AS credits
     FROM credit_ledger
     WHERE organization_id = ?
       AND entry_type IN ('consume', 'debit')`
  ).bind(orgId).first();
  const purchaseRows = await env.DB.prepare(
    `SELECT id, provider, provider_mode, provider_checkout_session_id,
            provider_payment_intent_id, organization_id, user_id, credit_pack_id,
            credits, amount_cents, currency, status, idempotency_key_hash,
            request_fingerprint_hash, checkout_url, provider_customer_id,
            billing_event_id, credit_ledger_entry_id, authorization_scope,
            payment_status, granted_at, failed_at, expired_at, metadata_json,
            created_at, updated_at, completed_at
     FROM billing_checkout_sessions
     WHERE organization_id = ?
       AND provider = 'stripe'
       AND provider_mode = 'live'
     ORDER BY created_at DESC, id DESC
     LIMIT ?`
  ).bind(orgId, appliedLimit).all();
  const ledgerRows = await env.DB.prepare(
    `SELECT id, organization_id, amount, balance_after, entry_type, feature_key,
            source, created_by_user_id, created_at
     FROM credit_ledger
     WHERE organization_id = ?
     ORDER BY created_at DESC, rowid DESC
     LIMIT ?`
  ).bind(orgId, appliedLimit).all();

  return {
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      status: organization.status,
      accessScope: scope,
    },
    balance: {
      current: currentBalance,
      reserved: reservedCredits,
      available: Math.max(0, currentBalance - reservedCredits),
      lifetimePurchasedLive: Number(purchasedRow?.credits || 0),
      lifetimeManualGrants: Number(manualGrantRow?.credits || 0),
      lifetimeConsumed: Number(consumedRow?.credits || 0),
    },
    liveCheckout: getStripeLiveCreditPackCheckoutStatus(env, { includeConfigNames }),
    packs: listStripeLiveCreditPacks(),
    purchaseHistory: (purchaseRows.results || []).map(serializeDashboardCheckout),
    recentLedger: (ledgerRows.results || []).map(serializeDashboardLedger),
  };
}

export async function handleVerifiedStripeWebhookEvent({
  env,
  rawBody,
  payload,
  verificationStatus,
}) {
  if (payload?.livemode === true) {
    throw new StripeBillingError("Live Stripe events are disabled.", {
      status: 403,
      code: "stripe_live_mode_disabled",
    });
  }
  const stored = await ingestVerifiedBillingProviderEvent({
    env,
    provider: BILLING_WEBHOOK_STRIPE_PROVIDER,
    rawBody,
    payload,
    verificationStatus,
  });
  if (stored.duplicate) {
    return {
      ...stored,
      creditGrant: null,
      checkout: null,
      subscription: null,
    };
  }

  if (payload?.type !== "checkout.session.completed") {
    return {
      ...stored,
      creditGrant: null,
      checkout: null,
      subscription: null,
    };
  }

  const rawSession = getStripeSessionObject(payload);
  if (rawSession.mode === "subscription") {
    try {
      return await handleLiveSubscriptionCheckoutCompleted({ env, stored, payload });
    } catch (error) {
      const code = error instanceof BillingError || error instanceof StripeBillingError
        ? error.code
        : "stripe_live_subscription_checkout_failed";
      const message = error instanceof BillingError || error instanceof StripeBillingError
        ? error.message
        : "Stripe live subscription checkout handling failed.";
      await markStripeEventFailed(env, {
        eventId: stored.event.id,
        actionType: payload.type,
        errorCode: code,
        errorMessage: message,
      });
      throw error instanceof StripeBillingError
        ? error
        : new StripeBillingError("Stripe live subscription checkout handling failed.", {
            status: 503,
            code: "stripe_live_subscription_checkout_failed",
          });
    }
  }

  let completion;
  try {
    completion = normalizeCheckoutCompletion(payload);
  } catch (error) {
    if (error instanceof StripeBillingError) {
      await markStripeEventFailed(env, {
        eventId: stored.event.id,
        actionType: payload.type,
        errorCode: error.code,
        errorMessage: error.message,
      });
      throw error;
    }
    throw error;
  }

  try {
    const existingCheckout = await requireAdminCreatedCheckoutSession(env, completion);
    let grant = null;
    if (!existingCheckout.credit_ledger_entry_id) {
      grant = await grantOrganizationCredits({
        env,
        organizationId: completion.organizationId,
        amount: completion.pack.credits,
        createdByUserId: completion.userId,
        idempotencyKey: `stripe:${stored.event.providerEventId}`,
        source: "stripe_test_checkout",
        reason: `credit_pack:${completion.pack.id}`,
      });
    }
    const checkout = await upsertCompletedCheckoutSession({
      env,
      completion,
      billingEventId: stored.event.id,
      ledgerEntryId: grant?.ledgerEntry?.id || existingCheckout.credit_ledger_entry_id || null,
    });
    const event = await updateBillingProviderEventProcessing(env, {
      eventId: stored.event.id,
      processingStatus: "planned",
      organizationId: completion.organizationId,
      userId: completion.userId,
      actionType: payload.type,
      actionStatus: "planned",
      actionDryRun: false,
      actionSummary: {
        sideEffectsEnabled: true,
        creditGrantStatus: existingCheckout.credit_ledger_entry_id
          ? "already_granted"
          : (grant.reused ? "already_granted" : "granted"),
        creditPackId: completion.pack.id,
        credits: completion.pack.credits,
      },
    });
    return {
      event,
      duplicate: false,
      actionPlanned: true,
      creditGrant: {
        organizationId: completion.organizationId,
        creditsGranted: existingCheckout.credit_ledger_entry_id ? 0 : completion.pack.credits,
        balanceAfter: grant?.creditBalance ?? null,
        reused: Boolean(existingCheckout.credit_ledger_entry_id || grant?.reused),
      },
      checkout: serializeCheckoutRow(checkout),
    };
  } catch (error) {
    const code = error instanceof BillingError || error instanceof StripeBillingError
      ? error.code
      : "stripe_credit_grant_failed";
    const message = error instanceof BillingError || error instanceof StripeBillingError
      ? error.message
      : "Stripe credit grant failed.";
    await markStripeEventFailed(env, {
      eventId: stored.event.id,
      actionType: payload.type,
      errorCode: code,
      errorMessage: message,
    });
    throw error instanceof StripeBillingError
      ? error
      : new StripeBillingError("Stripe credit grant failed.", {
          status: 503,
          code: "stripe_credit_grant_failed",
        });
  }
}

async function markLiveStripeEventIgnored(env, { stored, payload, reason, summary = {} }) {
  const event = await updateBillingProviderEventProcessing(env, {
    eventId: stored.event.id,
    processingStatus: "ignored",
    actionType: payload.type,
    actionStatus: "ignored",
    actionDryRun: false,
    actionSummary: {
      sideEffectsEnabled: false,
      reason,
      ...summary,
    },
  });
  return {
    event,
    duplicate: false,
    actionPlanned: false,
    creditGrant: null,
    checkout: null,
    subscription: null,
  };
}

async function handleLiveSubscriptionCheckoutCompleted({ env, stored, payload }) {
  const completion = normalizeLiveSubscriptionCheckoutCompletion(payload);
  const { checkout } = await requireLiveMemberSubscriptionCheckoutSession(env, completion);
  const updatedCheckout = await upsertCompletedMemberSubscriptionCheckoutSession({
    env,
    completion,
    billingEventId: stored.event.id,
  });
  const subscription = await upsertMemberSubscriptionFromProvider({
    env,
    userId: completion.userId,
    providerSubscriptionId: completion.subscriptionId,
    providerCustomerId: completion.customer,
    providerPriceId: checkout.provider_price_id,
    status: "incomplete",
    metadata: {
      checkout_session_id: completion.sessionId,
      checkout_scope: LIVE_MEMBER_SUBSCRIPTION_CHECKOUT_SCOPE,
      source: "checkout.session.completed",
    },
  });
  const event = await updateBillingProviderEventProcessing(env, {
    eventId: stored.event.id,
    processingStatus: "planned",
    userId: completion.userId,
    billingCustomerId: completion.customer,
    actionType: payload.type,
    actionStatus: "planned",
    actionDryRun: false,
    actionSummary: {
      sideEffectsEnabled: true,
      liveBillingEnabled: true,
      checkoutScope: LIVE_MEMBER_SUBSCRIPTION_CHECKOUT_SCOPE,
      subscriptionStatus: "recorded_without_credit_grant",
      providerSubscriptionId: completion.subscriptionId,
      creditsGranted: 0,
    },
  });
  return {
    event,
    duplicate: false,
    actionPlanned: true,
    creditGrant: null,
    checkout: serializeMemberSubscriptionCheckoutRow(updatedCheckout),
    subscription,
  };
}

async function handleLiveSubscriptionLifecycle({ env, stored, payload }) {
  const subscriptionEvent = normalizeLiveSubscriptionEvent(payload);
  const expectedPriceId = normalizeStripeLiveSubscriptionPriceId(env);
  const effectivePriceId = subscriptionEvent.priceId || null;
  if (effectivePriceId !== expectedPriceId) {
    return markLiveStripeEventIgnored(env, {
      stored,
      payload,
      reason: "Stripe subscription price id does not match BITBI Pro.",
      summary: { providerSubscriptionId: subscriptionEvent.subscriptionId, priceIdPresent: Boolean(effectivePriceId) },
    });
  }
  const existing = await fetchMemberSubscriptionByProviderSubscriptionId(env, subscriptionEvent.subscriptionId);
  const userId = subscriptionEvent.userId || existing?.user_id;
  if (!userId) {
    return markLiveStripeEventIgnored(env, {
      stored,
      payload,
      reason: "Stripe subscription event has no known BITBI user.",
      summary: { providerSubscriptionId: subscriptionEvent.subscriptionId },
    });
  }
  const subscription = await upsertMemberSubscriptionFromProvider({
    env,
    userId,
    providerSubscriptionId: subscriptionEvent.subscriptionId,
    providerCustomerId: subscriptionEvent.customer || existing?.provider_customer_id || null,
    providerPriceId: subscriptionEvent.priceId || existing?.provider_price_id || null,
    status: payload.type === "customer.subscription.deleted" ? "canceled" : subscriptionEvent.status,
    currentPeriodStart: subscriptionEvent.currentPeriodStart || existing?.current_period_start || null,
    currentPeriodEnd: subscriptionEvent.currentPeriodEnd || existing?.current_period_end || null,
    cancelAtPeriodEnd: subscriptionEvent.cancelAtPeriodEnd,
    canceledAt: subscriptionEvent.canceledAt || existing?.canceled_at || null,
    metadata: {
      ...subscriptionEvent.metadata,
      source_event_type: payload.type,
      provider_event_id: stored.event.providerEventId,
    },
  });
  const event = await updateBillingProviderEventProcessing(env, {
    eventId: stored.event.id,
    processingStatus: "planned",
    userId,
    billingCustomerId: subscriptionEvent.customer || existing?.provider_customer_id || null,
    actionType: payload.type,
    actionStatus: "planned",
    actionDryRun: false,
    actionSummary: {
      sideEffectsEnabled: true,
      liveBillingEnabled: true,
      providerSubscriptionId: subscriptionEvent.subscriptionId,
      subscriptionStatus: subscription.status,
      creditsGranted: 0,
    },
  });
  return {
    event,
    duplicate: false,
    actionPlanned: true,
    creditGrant: null,
    checkout: null,
    subscription,
  };
}

async function handleLiveSubscriptionInvoicePaid({ env, stored, payload }) {
  const invoice = normalizeLiveInvoicePaidEvent(payload);
  if (invoice?.ignored) {
    return markLiveStripeEventIgnored(env, {
      stored,
      payload,
      reason: invoice.reason,
      summary: { providerSubscriptionId: invoice.subscriptionId, invoiceId: invoice.invoiceId },
    });
  }
  const expectedPriceId = normalizeStripeLiveSubscriptionPriceId(env);
  const invoicePriceIds = Array.isArray(invoice.priceIds) ? invoice.priceIds : [];
  const hasExpectedPriceId = invoicePriceIds.includes(expectedPriceId);
  if (!hasExpectedPriceId) {
    return markLiveStripeEventIgnored(env, {
      stored,
      payload,
      reason: "Stripe invoice price id does not match BITBI Pro.",
      summary: { providerSubscriptionId: invoice.subscriptionId, invoiceId: invoice.invoiceId, priceIdPresent: invoicePriceIds.length > 0 },
    });
  }
  const existing = await fetchMemberSubscriptionByProviderSubscriptionId(env, invoice.subscriptionId);
  const userId = invoice.userId || existing?.user_id;
  if (!userId) {
    return markLiveStripeEventIgnored(env, {
      stored,
      payload,
      reason: "Stripe invoice has no known BITBI user.",
      summary: { providerSubscriptionId: invoice.subscriptionId, invoiceId: invoice.invoiceId },
    });
  }
  const subscription = await upsertMemberSubscriptionFromProvider({
    env,
    userId,
    providerSubscriptionId: invoice.subscriptionId,
    providerCustomerId: invoice.customer || existing?.provider_customer_id || null,
    providerPriceId: expectedPriceId,
    status: "active",
    currentPeriodStart: invoice.currentPeriodStart,
    currentPeriodEnd: invoice.currentPeriodEnd,
    cancelAtPeriodEnd: existing?.cancel_at_period_end === 1,
    canceledAt: existing?.canceled_at || null,
    metadata: {
      ...invoice.metadata,
      source_event_type: payload.type,
      provider_event_id: stored.event.providerEventId,
      stripe_invoice_id: invoice.invoiceId,
    },
  });
  const topUp = await topUpMemberSubscriptionCredits({
    env,
    userId,
    subscriptionId: invoice.subscriptionId,
    providerSubscriptionId: invoice.subscriptionId,
    periodStart: invoice.currentPeriodStart,
    periodEnd: invoice.currentPeriodEnd,
    providerEventId: stored.event.providerEventId,
    stripeInvoiceId: invoice.invoiceId,
  });
  const event = await updateBillingProviderEventProcessing(env, {
    eventId: stored.event.id,
    processingStatus: "planned",
    userId,
    billingCustomerId: invoice.customer || existing?.provider_customer_id || null,
    actionType: payload.type,
    actionStatus: "planned",
    actionDryRun: false,
    actionSummary: {
      sideEffectsEnabled: true,
      liveBillingEnabled: true,
      providerSubscriptionId: invoice.subscriptionId,
      stripeInvoiceId: invoice.invoiceId,
      subscriptionStatus: subscription.status,
      creditGrantStatus: topUp.reused
        ? "already_granted"
        : (topUp.grantedCredits > 0 ? "granted" : "already_full"),
      creditsGranted: topUp.grantedCredits,
      allowance: topUp.allowance,
      subscriptionCredits: topUp.subscriptionCredits,
    },
  });
  return {
    event,
    duplicate: false,
    actionPlanned: true,
    creditGrant: {
      checkoutScope: LIVE_MEMBER_SUBSCRIPTION_CHECKOUT_SCOPE,
      userId,
      creditsGranted: topUp.grantedCredits,
      balanceAfter: topUp.creditBalance,
      subscriptionCredits: topUp.subscriptionCredits,
      reused: topUp.reused,
    },
    checkout: null,
    subscription,
  };
}

export async function handleVerifiedStripeLiveWebhookEvent({
  env,
  rawBody,
  payload,
  verificationStatus,
}) {
  if (payload?.livemode !== true) {
    throw new StripeBillingError("Testmode Stripe events are not accepted on the live webhook.", {
      status: 403,
      code: "stripe_live_webhook_mode_mismatch",
    });
  }
  const stored = await ingestVerifiedBillingProviderEvent({
    env,
    provider: BILLING_WEBHOOK_STRIPE_PROVIDER,
    rawBody,
    payload,
    verificationStatus,
    allowLive: true,
  });
  if (stored.duplicate) {
    return {
      ...stored,
      creditGrant: null,
      checkout: null,
      subscription: null,
    };
  }

  if (LIVE_OPERATOR_REVIEW_POLICIES[payload?.type]) {
    try {
      return await handleLiveOperatorReviewEvent({ env, stored, payload });
    } catch (error) {
      await markLiveOperatorReviewEventFailed(env, { stored, payload, error });
      throw error;
    }
  }

  if (payload?.type === "customer.subscription.created" || payload?.type === "customer.subscription.updated" || payload?.type === "customer.subscription.deleted") {
    try {
      return await handleLiveSubscriptionLifecycle({ env, stored, payload });
    } catch (error) {
      const code = error instanceof BillingError || error instanceof StripeBillingError
        ? error.code
        : "stripe_live_subscription_update_failed";
      const message = error instanceof BillingError || error instanceof StripeBillingError
        ? error.message
        : "Stripe live subscription update failed.";
      await markStripeEventFailed(env, {
        eventId: stored.event.id,
        actionType: payload.type,
        errorCode: code,
        errorMessage: message,
      });
      throw error instanceof StripeBillingError
        ? error
        : new StripeBillingError("Stripe live subscription update failed.", {
            status: 503,
            code: "stripe_live_subscription_update_failed",
          });
    }
  }

  if (payload?.type === "invoice.paid" || payload?.type === "invoice.payment_succeeded") {
    try {
      return await handleLiveSubscriptionInvoicePaid({ env, stored, payload });
    } catch (error) {
      const code = error instanceof BillingError || error instanceof StripeBillingError
        ? error.code
        : "stripe_live_subscription_topup_failed";
      const message = error instanceof BillingError || error instanceof StripeBillingError
        ? error.message
        : "Stripe live subscription credit top-up failed.";
      await markStripeEventFailed(env, {
        eventId: stored.event.id,
        actionType: payload.type,
        errorCode: code,
        errorMessage: message,
      });
      throw error instanceof StripeBillingError
        ? error
        : new StripeBillingError("Stripe live subscription credit top-up failed.", {
            status: 503,
            code: "stripe_live_subscription_topup_failed",
          });
    }
  }

  if (payload?.type !== "checkout.session.completed") {
    return {
      ...stored,
      creditGrant: null,
      checkout: null,
      subscription: null,
    };
  }

  const rawSession = getStripeSessionObject(payload);
  if (rawSession.mode === "subscription") {
    try {
      return await handleLiveSubscriptionCheckoutCompleted({ env, stored, payload });
    } catch (error) {
      const code = error instanceof BillingError || error instanceof StripeBillingError
        ? error.code
        : "stripe_live_subscription_checkout_failed";
      const message = error instanceof BillingError || error instanceof StripeBillingError
        ? error.message
        : "Stripe live subscription checkout handling failed.";
      await markStripeEventFailed(env, {
        eventId: stored.event.id,
        actionType: payload.type,
        errorCode: code,
        errorMessage: message,
      });
      throw error instanceof StripeBillingError
        ? error
        : new StripeBillingError("Stripe live subscription checkout handling failed.", {
            status: 503,
            code: "stripe_live_subscription_checkout_failed",
          });
    }
  }

  let completion;
  try {
    completion = normalizeLiveCheckoutCompletion(payload);
  } catch (error) {
    if (error instanceof StripeBillingError) {
      await markStripeEventFailed(env, {
        eventId: stored.event.id,
        actionType: payload.type,
        errorCode: error.code,
        errorMessage: error.message,
      });
      throw error;
    }
    throw error;
  }

  try {
    if (completion.checkoutScope === LIVE_MEMBER_CHECKOUT_SCOPE) {
      const { checkout: existingCheckout, scope } = await requireLiveMemberCheckoutSession(env, completion);
      let grant = null;
      if (!existingCheckout.member_credit_ledger_entry_id) {
        grant = await grantMemberCredits({
          env,
          userId: completion.userId,
          amount: completion.pack.credits,
          createdByUserId: completion.userId,
          idempotencyKey: `stripe_live_member_checkout:${completion.sessionId}:${completion.pack.id}`,
          source: "stripe_live_checkout",
          reason: `credit_pack:${completion.pack.id}`,
        });
      }
      const checkout = await upsertCompletedMemberCheckoutSession({
        env,
        completion,
        billingEventId: stored.event.id,
        ledgerEntryId: grant?.ledgerEntry?.id || existingCheckout.member_credit_ledger_entry_id || null,
      });
      const event = await updateBillingProviderEventProcessing(env, {
        eventId: stored.event.id,
        processingStatus: "planned",
        userId: completion.userId,
        actionType: payload.type,
        actionStatus: "planned",
        actionDryRun: false,
        actionSummary: {
          sideEffectsEnabled: true,
          liveBillingEnabled: true,
          checkoutScope: LIVE_MEMBER_CHECKOUT_SCOPE,
          authorizationScope: scope,
          creditGrantStatus: existingCheckout.member_credit_ledger_entry_id
            ? "already_granted"
            : (grant.reused ? "already_granted" : "granted"),
          creditPackId: completion.pack.id,
          credits: completion.pack.credits,
        },
      });
      return {
        event,
        duplicate: false,
        actionPlanned: true,
        creditGrant: {
          checkoutScope: LIVE_MEMBER_CHECKOUT_SCOPE,
          userId: completion.userId,
          creditsGranted: existingCheckout.member_credit_ledger_entry_id ? 0 : completion.pack.credits,
          balanceAfter: grant?.creditBalance ?? null,
          reused: Boolean(existingCheckout.member_credit_ledger_entry_id || grant?.reused),
        },
        checkout: serializeMemberCheckoutRow(checkout),
      };
    }

    if (completion.checkoutScope !== LIVE_ORGANIZATION_CHECKOUT_SCOPE) {
      throw new StripeBillingError("Stripe live checkout scope is invalid.", {
        status: 400,
        code: "stripe_checkout_scope_invalid",
      });
    }

    const { checkout: existingCheckout, scope } = await requireLiveAuthorizedCheckoutSession(env, completion);
    let grant = null;
    if (!existingCheckout.credit_ledger_entry_id) {
      grant = await grantOrganizationCredits({
        env,
        organizationId: completion.organizationId,
        amount: completion.pack.credits,
        createdByUserId: completion.userId,
        idempotencyKey: `stripe_live_checkout:${completion.sessionId}:${completion.pack.id}`,
        source: "stripe_live_checkout",
        reason: `credit_pack:${completion.pack.id}`,
      });
    }
    const checkout = await upsertCompletedCheckoutSession({
      env,
      completion,
      billingEventId: stored.event.id,
      ledgerEntryId: grant?.ledgerEntry?.id || existingCheckout.credit_ledger_entry_id || null,
      providerMode: STRIPE_MODE_LIVE,
    });
    const event = await updateBillingProviderEventProcessing(env, {
      eventId: stored.event.id,
      processingStatus: "planned",
      organizationId: completion.organizationId,
      userId: completion.userId,
      actionType: payload.type,
      actionStatus: "planned",
      actionDryRun: false,
      actionSummary: {
        sideEffectsEnabled: true,
        liveBillingEnabled: true,
        authorizationScope: scope,
        creditGrantStatus: existingCheckout.credit_ledger_entry_id
          ? "already_granted"
          : (grant.reused ? "already_granted" : "granted"),
        creditPackId: completion.pack.id,
        credits: completion.pack.credits,
      },
    });
    return {
      event,
      duplicate: false,
      actionPlanned: true,
      creditGrant: {
        organizationId: completion.organizationId,
        creditsGranted: existingCheckout.credit_ledger_entry_id ? 0 : completion.pack.credits,
        balanceAfter: grant?.creditBalance ?? null,
        reused: Boolean(existingCheckout.credit_ledger_entry_id || grant?.reused),
      },
      checkout: serializeCheckoutRow(checkout),
    };
  } catch (error) {
    const code = error instanceof BillingError || error instanceof StripeBillingError
      ? error.code
      : "stripe_live_credit_grant_failed";
    const message = error instanceof BillingError || error instanceof StripeBillingError
      ? error.message
      : "Stripe live credit grant failed.";
    await markStripeEventFailed(env, {
      eventId: stored.event.id,
      actionType: payload.type,
      errorCode: code,
      errorMessage: message,
    });
    throw error instanceof StripeBillingError
      ? error
      : new StripeBillingError("Stripe live credit grant failed.", {
          status: 503,
          code: "stripe_live_credit_grant_failed",
        });
  }
}

export function parseVerifiedStripeWebhookPayload(rawBody) {
  return parseBillingWebhookPayload(rawBody);
}
