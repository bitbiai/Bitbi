import { BillingError, getCreditBalance, grantOrganizationCredits, normalizeBillingIdempotencyKey } from "./billing.js";
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

const STRIPE_SIGNATURE_HEADER = "stripe-signature";
const TEST_CHECKOUT_SESSION_ID_PATTERN = /^cs_test_[A-Za-z0-9_:-]{8,200}$/;
const LIVE_CHECKOUT_SESSION_ID_PATTERN = /^cs_live_[A-Za-z0-9_:-]{8,200}$/;
const TEST_PAYMENT_INTENT_ID_PATTERN = /^pi_test_[A-Za-z0-9_:-]{8,200}$/;
const LIVE_PAYMENT_INTENT_ID_PATTERN = /^pi_live_[A-Za-z0-9_:-]{8,200}$/;
const USER_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const CHECKOUT_SESSION_URL_PATTERN = /^https:\/\/checkout\.stripe\.com\/.+/;
const STRIPE_CHECKOUT_TIMEOUT_MS = 10_000;
const LIVE_AUTH_SCOPES = new Set(["platform_admin", "org_owner"]);

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

export const STRIPE_LIVE_CREDIT_PACKS = Object.freeze([
  Object.freeze({
    id: "live_credits_5000",
    name: "5000 Credit Pack",
    credits: 5000,
    amountCents: 999,
    currency: "eur",
    displayPrice: "9,99 €",
    active: true,
    sortOrder: 5000,
  }),
  Object.freeze({
    id: "live_credits_12000",
    name: "12000 Credit Pack",
    credits: 12000,
    amountCents: 1999,
    currency: "eur",
    displayPrice: "19,99 €",
    active: true,
    sortOrder: 12000,
  }),
]);

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

export function getStripeLiveCreditPackCheckoutStatus(env, { includeConfigNames = false } = {}) {
  const requiredNames = [
    "ENABLE_LIVE_STRIPE_CREDIT_PACKS",
    "STRIPE_LIVE_SECRET_KEY",
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
  if (!url || !CHECKOUT_SESSION_URL_PATTERN.test(url)) {
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
    paymentStatus: safeString(value.payment_status, 64),
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

function buildCheckoutForm({ config, pack, organizationId, userId, checkoutId, authorizationScope = null }) {
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
  body.set("metadata[organization_id]", organizationId);
  body.set("metadata[user_id]", userId);
  body.set("metadata[credit_pack_id]", pack.id);
  body.set("metadata[credits]", String(pack.credits));
  body.set("metadata[internal_checkout_session_id]", checkoutId);
  body.set("metadata[stripe_mode]", config.mode);
  if (authorizationScope) {
    body.set("metadata[authorization_scope]", authorizationScope);
  }
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
}) {
  const orgId = normalizeOrgId(organizationId);
  const normalizedUserId = normalizeUserId(userId);
  const scope = normalizeLiveAuthorizationScope(authorizationScope);
  const normalizedKey = normalizeBillingIdempotencyKey(idempotencyKey);
  const pack = getStripeLiveCreditPack(packId);
  const config = getStripeLiveCheckoutConfig(env);
  const keyHash = await sha256Hex(`live:${normalizedKey}`);
  const requestHash = await checkoutRequestFingerprintForMode({
    organizationId: orgId,
    userId: normalizedUserId,
    pack,
    providerMode: STRIPE_MODE_LIVE,
    authorizationScope: scope,
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
      authorizationScope: scope,
      liveBillingEnabled: true,
      asyncPaymentMethodsEnabled: false,
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
  const organizationId = normalizeStripeMetadataOrgId(metadata.organization_id || metadata.organizationId);
  const userId = normalizeUserId(metadata.user_id || metadata.userId);
  const pack = getStripeLiveCreditPack(metadata.credit_pack_id || metadata.creditPackId, { includeLegacy: true });
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
    organizationId,
    userId,
    pack,
    internalCheckoutSessionId: safeString(metadata.internal_checkout_session_id, 64),
  };
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
    packs: STRIPE_LIVE_CREDIT_PACKS
      .filter((pack) => pack.active)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(serializePack),
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
    };
  }

  if (payload?.type !== "checkout.session.completed") {
    return {
      ...stored,
      creditGrant: null,
      checkout: null,
    };
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
    };
  }

  if (payload?.type !== "checkout.session.completed") {
    return {
      ...stored,
      creditGrant: null,
      checkout: null,
    };
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
