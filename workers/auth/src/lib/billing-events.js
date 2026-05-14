import { nowIso, randomTokenHex, sha256Hex } from "./tokens.js";
import { normalizeOrgId } from "./orgs.js";

export const BILLING_WEBHOOK_TEST_PROVIDER = "test";
export const BILLING_WEBHOOK_STRIPE_PROVIDER = "stripe";
export const BILLING_WEBHOOK_VERSION = "v1";
export const BILLING_WEBHOOK_TIMESTAMP_HEADER = "x-bitbi-billing-timestamp";
export const BILLING_WEBHOOK_SIGNATURE_HEADER = "x-bitbi-billing-signature";
export const BILLING_WEBHOOK_REPLAY_WINDOW_MS = 5 * 60_000;

const SUPPORTED_PROVIDERS = new Set([
  BILLING_WEBHOOK_TEST_PROVIDER,
  BILLING_WEBHOOK_STRIPE_PROVIDER,
]);
const SUPPORTED_MODES = new Set(["test", "sandbox", "synthetic"]);
const LIVE_MODE = "live";
const EVENT_ID_PATTERN = /^[A-Za-z0-9._:-]{3,128}$/;
const EVENT_TYPE_PATTERN = /^[a-z0-9_.:-]{3,128}$/i;
const PROVIDER_PATTERN = /^[a-z0-9_-]{2,32}$/i;
const MAX_SUMMARY_STRING_LENGTH = 128;
const SUPPORTED_ACTION_EVENT_TYPES = new Set([
  "checkout.completed",
  "checkout.session.completed",
  "subscription.created",
  "subscription.updated",
  "subscription.cancelled",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  "credit_pack.purchased",
]);

export class BillingEventError extends Error {
  constructor(message, { status = 400, code = "bad_request" } = {}) {
    super(message);
    this.name = "BillingEventError";
    this.status = status;
    this.code = code;
  }
}

export function billingEventErrorResponse(error) {
  return {
    ok: false,
    error: error.message || "Billing event request failed.",
    code: error.code || "bad_request",
  };
}

function eventId() {
  return `bpe_${randomTokenHex(16)}`;
}

function actionId() {
  return `bea_${randomTokenHex(16)}`;
}

function normalizeProvider(provider) {
  const value = String(provider || "").trim().toLowerCase();
  if (!PROVIDER_PATTERN.test(value)) {
    throw new BillingEventError("Unsupported billing provider.", {
      status: 404,
      code: "unsupported_billing_provider",
    });
  }
  if (!SUPPORTED_PROVIDERS.has(value)) {
    throw new BillingEventError("Unsupported billing provider.", {
      status: 404,
      code: "unsupported_billing_provider",
    });
  }
  return value;
}

function normalizeSecret(value) {
  const secret = String(value || "").trim();
  if (secret.length < 24) {
    throw new BillingEventError("Billing webhook verification is not configured.", {
      status: 503,
      code: "billing_webhook_verification_unavailable",
    });
  }
  return secret;
}

function normalizeTimestampHeader(value, { now = Date.now() } = {}) {
  const timestamp = String(value || "").trim();
  if (!/^\d{13}$/.test(timestamp)) {
    throw new BillingEventError("Billing webhook signature is invalid.", {
      status: 401,
      code: "billing_webhook_invalid_signature",
    });
  }
  const timestampMs = Number(timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs(now - timestampMs) > BILLING_WEBHOOK_REPLAY_WINDOW_MS) {
    throw new BillingEventError("Billing webhook signature is stale.", {
      status: 401,
      code: "billing_webhook_stale_signature",
    });
  }
  return timestamp;
}

function parseSignatureHeader(value) {
  const header = String(value || "").trim();
  const prefix = `${BILLING_WEBHOOK_VERSION}=`;
  if (!header.startsWith(prefix)) {
    throw new BillingEventError("Billing webhook signature is invalid.", {
      status: 401,
      code: "billing_webhook_invalid_signature",
    });
  }
  const signature = header.slice(prefix.length).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(signature)) {
    throw new BillingEventError("Billing webhook signature is invalid.", {
      status: 401,
      code: "billing_webhook_invalid_signature",
    });
  }
  return signature;
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

async function buildSignaturePayload({ provider, timestamp, rawBody }) {
  const payloadHash = await sha256Hex(String(rawBody || ""));
  return `${BILLING_WEBHOOK_VERSION}\n${provider}\n${timestamp}\n${payloadHash}`;
}

export async function buildSyntheticBillingWebhookSignature({
  secret,
  provider = BILLING_WEBHOOK_TEST_PROVIDER,
  timestamp,
  rawBody,
}) {
  const providerName = normalizeProvider(provider);
  const normalizedSecret = normalizeSecret(secret);
  const signaturePayload = await buildSignaturePayload({
    provider: providerName,
    timestamp: String(timestamp || ""),
    rawBody: String(rawBody || ""),
  });
  return `${BILLING_WEBHOOK_VERSION}=${await hmacSha256Hex(normalizedSecret, signaturePayload)}`;
}

export async function verifySyntheticBillingWebhookRequest({
  env,
  provider,
  rawBody,
  request,
  now = Date.now(),
}) {
  const providerName = normalizeProvider(provider);
  const secret = normalizeSecret(env?.BILLING_WEBHOOK_TEST_SECRET);
  const timestamp = normalizeTimestampHeader(request.headers.get(BILLING_WEBHOOK_TIMESTAMP_HEADER), { now });
  const suppliedSignature = parseSignatureHeader(request.headers.get(BILLING_WEBHOOK_SIGNATURE_HEADER));
  const signaturePayload = await buildSignaturePayload({
    provider: providerName,
    timestamp,
    rawBody,
  });
  const expectedSignature = await hmacSha256Hex(secret, signaturePayload);
  if (!safeEqualHex(suppliedSignature, expectedSignature)) {
    throw new BillingEventError("Billing webhook signature is invalid.", {
      status: 401,
      code: "billing_webhook_invalid_signature",
    });
  }
  return {
    provider: providerName,
    verificationStatus: "verified_test_signature",
    timestamp,
  };
}

export function parseBillingWebhookPayload(rawBody) {
  try {
    const parsed = JSON.parse(String(rawBody || ""));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("payload must be an object");
    }
    return parsed;
  } catch {
    throw new BillingEventError("Billing webhook payload is malformed.", {
      status: 400,
      code: "billing_webhook_malformed_payload",
    });
  }
}

function safeString(value, maxLength = MAX_SUMMARY_STRING_LENGTH) {
  const text = String(value || "").trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

function normalizeEventMode(value, { allowLive = false } = {}) {
  const mode = String(value || "test").trim().toLowerCase();
  if (mode === LIVE_MODE) {
    if (allowLive) return mode;
    throw new BillingEventError("Live billing events are not enabled.", {
      status: 403,
      code: "billing_webhook_live_mode_disabled",
    });
  }
  if (!SUPPORTED_MODES.has(mode)) {
    throw new BillingEventError("Unsupported billing event mode.", {
      status: 400,
      code: "unsupported_billing_event_mode",
    });
  }
  return mode;
}

function normalizeEventCreatedAt(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    const date = new Date(value > 10_000_000_000 ? value : value * 1000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeMaybeOrgId(value) {
  try {
    return normalizeOrgId(value);
  } catch {
    return null;
  }
}

function normalizeEventType(value) {
  const eventType = safeString(value, 128);
  if (!eventType || !EVENT_TYPE_PATTERN.test(eventType)) {
    throw new BillingEventError("Billing webhook event type is invalid.", {
      status: 400,
      code: "invalid_billing_event_type",
    });
  }
  return eventType;
}

function normalizeProviderEventId(value) {
  const id = safeString(value, 128);
  if (!id || !EVENT_ID_PATTERN.test(id)) {
    throw new BillingEventError("Billing webhook event id is invalid.", {
      status: 400,
      code: "invalid_billing_event_id",
    });
  }
  return id;
}

function boundedKeys(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const forbidden = /(?:card|bank|payment_?method|signature|secret|token|password|credential|authorization)/i;
  return Object.keys(value)
    .filter((key) => !forbidden.test(key))
    .slice(0, 20)
    .sort();
}

function sanitizedPayloadSummary(payload, { providerEventId, eventType, providerMode }) {
  const data = payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
    ? payload.data
    : {};
  const object = data.object && typeof data.object === "object" && !Array.isArray(data.object)
    ? data.object
    : {};
  const metadata = object.metadata && typeof object.metadata === "object" && !Array.isArray(object.metadata)
    ? object.metadata
    : {};
  const organizationId = normalizeMaybeOrgId(
    payload.organization_id ||
    payload.organizationId ||
    data.organization_id ||
    data.organizationId ||
    object.organization_id ||
    object.organizationId ||
    metadata.organization_id ||
    metadata.organizationId
  );
  const amountValue = data.amount ?? payload.amount ?? object.amount_total ?? object.amount;
  const amount = Number.isFinite(Number(amountValue)) ? Number(amountValue) : null;
  const currency = safeString(data.currency || payload.currency || object.currency, 16);
  return {
    providerEventId,
    eventType,
    mode: providerMode,
    account: safeString(payload.account || payload.provider_account || payload.providerAccount, 64),
    organizationId,
    hasBillingCustomerRef: Boolean(data.billing_customer_ref || data.customer || object.customer || payload.customer),
    hasData: Object.keys(data).length > 0,
    dataKeys: boundedKeys(data),
    amount,
    currency,
    planCode: safeString(data.plan_code || data.planCode || payload.plan_code || payload.planCode, 64),
    creditPackId: safeString(metadata.credit_pack_id || metadata.creditPackId, 64),
    checkoutSessionIdPresent: Boolean(object.id),
    paymentDataRedacted: true,
  };
}

export async function normalizeBillingProviderEvent({ provider, rawBody, payload, allowLive = false }) {
  const providerName = normalizeProvider(provider);
  const providerEventId = normalizeProviderEventId(payload.id || payload.event_id || payload.eventId);
  const eventType = normalizeEventType(payload.type || payload.event_type || payload.eventType);
  const providerMode = normalizeEventMode(
    payload.mode ||
    payload.environment ||
    payload.provider_mode ||
    (payload.livemode === true ? "live" : null),
    { allowLive }
  );
  const payloadHash = await sha256Hex(String(rawBody || ""));
  const summary = sanitizedPayloadSummary(payload, {
    providerEventId,
    eventType,
    providerMode,
  });
  return {
    provider: providerName,
    providerEventId,
    providerMode,
    providerAccount: summary.account,
    eventType,
    eventCreatedAt: normalizeEventCreatedAt(payload.created || payload.created_at || payload.event_created_at),
    payloadHash,
    payloadSummary: summary,
    organizationId: summary.organizationId,
    userId: null,
    billingCustomerId: null,
    supportedAction: SUPPORTED_ACTION_EVENT_TYPES.has(eventType),
  };
}

function serializeJson(value) {
  return JSON.stringify(value && typeof value === "object" ? value : {});
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function serializeEventRow(row, { includeActions = false, actions = [] } = {}) {
  if (!row) return null;
  const event = {
    id: row.id,
    provider: row.provider,
    providerEventId: row.provider_event_id,
    providerAccount: row.provider_account || null,
    providerMode: row.provider_mode,
    eventType: row.event_type,
    eventCreatedAt: row.event_created_at || null,
    receivedAt: row.received_at,
    processingStatus: row.processing_status,
    verificationStatus: row.verification_status,
    organizationId: row.organization_id || null,
    userId: row.user_id || null,
    billingCustomerId: row.billing_customer_id || null,
    errorCode: row.error_code || null,
    errorMessage: row.error_message || null,
    attemptCount: Number(row.attempt_count || 0),
    lastProcessedAt: row.last_processed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    payloadSummary: parseJsonObject(row.payload_summary_json),
  };
  if (includeActions) {
    event.actions = actions.map(serializeActionRow);
  }
  return event;
}

function serializeActionRow(row) {
  return {
    id: row.id,
    eventId: row.event_id,
    actionType: row.action_type,
    status: row.status,
    dryRun: Number(row.dry_run || 0) === 1,
    summary: parseJsonObject(row.summary_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function ingestVerifiedBillingProviderEvent({
  env,
  provider,
  rawBody,
  payload,
  verificationStatus = "verified_test_signature",
  receivedAt = nowIso(),
  allowLive = false,
}) {
  const normalized = await normalizeBillingProviderEvent({ provider, rawBody, payload, allowLive });
  const existing = await env.DB.prepare(
    `SELECT id, provider, provider_event_id, provider_account, provider_mode,
            event_type, event_created_at, received_at, processing_status,
            verification_status, payload_hash, payload_summary_json,
            organization_id, user_id, billing_customer_id, error_code,
            error_message, attempt_count, last_processed_at, created_at, updated_at
     FROM billing_provider_events
     WHERE provider = ? AND provider_event_id = ?
     LIMIT 1`
  ).bind(normalized.provider, normalized.providerEventId).first();
  if (existing) {
    if (existing.payload_hash !== normalized.payloadHash) {
      throw new BillingEventError("Billing provider event id was replayed with a different payload.", {
        status: 409,
        code: "billing_event_payload_conflict",
      });
    }
    return {
      event: serializeEventRow(existing),
      duplicate: true,
      actionPlanned: false,
    };
  }

  const id = eventId();
  const now = receivedAt || nowIso();
  const processingStatus = normalized.supportedAction ? "planned" : "ignored";
  const errorCode = normalized.supportedAction ? null : "unsupported_billing_event_type";
  const errorMessage = normalized.supportedAction
    ? null
    : "Billing event type was stored for inspection but has no enabled side effects.";
  await env.DB.prepare(
    `INSERT INTO billing_provider_events (
       id, provider, provider_event_id, provider_account, provider_mode,
       event_type, event_created_at, received_at, processing_status,
       verification_status, dedupe_key, payload_hash, payload_summary_json,
       organization_id, user_id, billing_customer_id, error_code, error_message,
       attempt_count, last_processed_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    normalized.provider,
    normalized.providerEventId,
    normalized.providerAccount,
    normalized.providerMode,
    normalized.eventType,
    normalized.eventCreatedAt,
    now,
    processingStatus,
    verificationStatus,
    `${normalized.provider}:${normalized.providerEventId}`,
    normalized.payloadHash,
    serializeJson(normalized.payloadSummary),
    normalized.organizationId,
    normalized.userId,
    normalized.billingCustomerId,
    errorCode,
    errorMessage,
    1,
    now,
    now,
    now
  ).run();

  let actionPlanned = false;
  if (normalized.supportedAction) {
    await env.DB.prepare(
      `INSERT INTO billing_event_actions (
         id, event_id, action_type, status, dry_run, summary_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      actionId(),
      id,
      normalized.eventType,
      "deferred",
      1,
      serializeJson({
        sideEffectsEnabled: false,
        reason: "Phase 2-I stores and classifies events only; subscription and credit side effects are deferred.",
      }),
      now,
      now
    ).run();
    actionPlanned = true;
  }

  const inserted = await env.DB.prepare(
    `SELECT id, provider, provider_event_id, provider_account, provider_mode,
            event_type, event_created_at, received_at, processing_status,
            verification_status, payload_hash, payload_summary_json,
            organization_id, user_id, billing_customer_id, error_code,
            error_message, attempt_count, last_processed_at, created_at, updated_at
     FROM billing_provider_events
     WHERE id = ?
     LIMIT 1`
  ).bind(id).first();

  return {
    event: serializeEventRow(inserted),
    duplicate: false,
    actionPlanned,
  };
}

function normalizeLimit(value, fallback = 25) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 100);
}

function normalizeOptionalFilter(value, maxLength = 128) {
  const text = safeString(value, maxLength);
  return text || null;
}

export async function listBillingProviderEvents(env, {
  provider = null,
  status = null,
  eventType = null,
  organizationId = null,
  limit = 25,
} = {}) {
  const appliedLimit = normalizeLimit(limit);
  const providerFilter = provider ? normalizeProvider(provider) : null;
  const statusFilter = normalizeOptionalFilter(status, 32);
  const typeFilter = eventType ? normalizeEventType(eventType) : null;
  const orgFilter = organizationId ? normalizeOrgId(organizationId) : null;
  const rows = await env.DB.prepare(
    `SELECT id, provider, provider_event_id, provider_account, provider_mode,
            event_type, event_created_at, received_at, processing_status,
            verification_status, payload_hash, payload_summary_json,
            organization_id, user_id, billing_customer_id, error_code,
            error_message, attempt_count, last_processed_at, created_at, updated_at
     FROM billing_provider_events
     WHERE (? IS NULL OR provider = ?)
       AND (? IS NULL OR processing_status = ?)
       AND (? IS NULL OR event_type = ?)
       AND (? IS NULL OR organization_id = ?)
     ORDER BY received_at DESC, id DESC
     LIMIT ?`
  ).bind(
    providerFilter,
    providerFilter,
    statusFilter,
    statusFilter,
    typeFilter,
    typeFilter,
    orgFilter,
    orgFilter,
    appliedLimit
  ).all();
  return (rows.results || []).map((row) => serializeEventRow(row));
}

export async function getBillingProviderEvent(env, { id }) {
  const eventIdValue = safeString(id, 64);
  if (!eventIdValue || !/^bpe_[a-f0-9]{32}$/.test(eventIdValue)) {
    throw new BillingEventError("Billing event not found.", {
      status: 404,
      code: "billing_event_not_found",
    });
  }
  const row = await env.DB.prepare(
    `SELECT id, provider, provider_event_id, provider_account, provider_mode,
            event_type, event_created_at, received_at, processing_status,
            verification_status, payload_hash, payload_summary_json,
            organization_id, user_id, billing_customer_id, error_code,
            error_message, attempt_count, last_processed_at, created_at, updated_at
     FROM billing_provider_events
     WHERE id = ?
     LIMIT 1`
  ).bind(eventIdValue).first();
  if (!row) {
    throw new BillingEventError("Billing event not found.", {
      status: 404,
      code: "billing_event_not_found",
    });
  }
  const actions = await env.DB.prepare(
    `SELECT id, event_id, action_type, status, dry_run, summary_json, created_at, updated_at
     FROM billing_event_actions
     WHERE event_id = ?
     ORDER BY created_at ASC, id ASC`
  ).bind(eventIdValue).all();
  return serializeEventRow(row, {
    includeActions: true,
    actions: actions.results || [],
  });
}

export async function updateBillingProviderEventProcessing(env, {
  eventId: id,
  processingStatus,
  organizationId = null,
  userId = null,
  billingCustomerId = null,
  errorCode = null,
  errorMessage = null,
  actionType = null,
  actionStatus = "planned",
  actionDryRun = false,
  actionSummary = {},
}) {
  const eventIdValue = safeString(id, 64);
  const status = safeString(processingStatus, 32);
  if (!eventIdValue || !/^bpe_[a-f0-9]{32}$/.test(eventIdValue)) {
    throw new BillingEventError("Billing event not found.", {
      status: 404,
      code: "billing_event_not_found",
    });
  }
  if (!["received", "planned", "ignored", "failed"].includes(status)) {
    throw new BillingEventError("Billing event status is invalid.", {
      status: 400,
      code: "invalid_billing_event_status",
    });
  }
  const now = nowIso();
  await env.DB.prepare(
    `UPDATE billing_provider_events
     SET processing_status = ?,
         organization_id = COALESCE(?, organization_id),
         user_id = COALESCE(?, user_id),
         billing_customer_id = COALESCE(?, billing_customer_id),
         error_code = ?,
         error_message = ?,
         last_processed_at = ?,
         updated_at = ?
     WHERE id = ?`
  ).bind(
    status,
    organizationId,
    userId,
    billingCustomerId,
    errorCode,
    errorMessage,
    now,
    now,
    eventIdValue
  ).run();

  if (actionType) {
    await env.DB.prepare(
      `UPDATE billing_event_actions
       SET status = ?,
           dry_run = ?,
           summary_json = ?,
           updated_at = ?
       WHERE event_id = ? AND action_type = ?`
    ).bind(
      actionStatus,
      actionDryRun ? 1 : 0,
      serializeJson(actionSummary),
      now,
      eventIdValue,
      actionType
    ).run();
  }

  return getBillingProviderEvent(env, { id: eventIdValue });
}
