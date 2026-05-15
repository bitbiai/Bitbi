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
const MAX_REVIEW_NOTE_LENGTH = 1000;
const RECONCILIATION_SCAN_LIMIT = 500;
const RECONCILIATION_ITEM_LIMIT = 12;
const RECONCILIATION_STALE_REVIEW_MS = 7 * 24 * 60 * 60 * 1000;
const REVIEW_STATES = new Set(["needs_review", "blocked", "informational", "resolved", "dismissed"]);
const REVIEW_RESOLUTION_STATUSES = new Set(["resolved", "dismissed"]);
const REVIEW_PROVIDER_MODES = new Set(["test", "sandbox", "synthetic", "live"]);
const UNRESOLVED_REVIEW_STATES = new Set(["needs_review", "blocked"]);
const REVIEW_IDENTIFIER_KEYS = new Set([
  "providerEventId",
  "invoiceId",
  "chargeId",
  "refundId",
  "disputeId",
  "checkoutSessionId",
  "customerId",
  "subscriptionId",
  "paymentIntentId",
]);
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
  "invoice.payment_action_required",
  "checkout.session.expired",
  "charge.refunded",
  "refund.created",
  "refund.updated",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
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

function normalizeReviewState(value) {
  const state = safeString(value, 32);
  return REVIEW_STATES.has(state) ? state : null;
}

function normalizeReviewStateFilter(value) {
  if (value == null || value === "") return null;
  const state = safeString(value, 32);
  if (!REVIEW_STATES.has(state)) {
    throw new BillingEventError("Billing review state is invalid.", {
      status: 400,
      code: "invalid_billing_review_state",
    });
  }
  return state;
}

function normalizeReviewProviderMode(value) {
  if (value == null || value === "") return null;
  const mode = safeString(value, 32);
  if (!REVIEW_PROVIDER_MODES.has(mode)) {
    throw new BillingEventError("Billing review provider mode is invalid.", {
      status: 400,
      code: "invalid_billing_review_provider_mode",
    });
  }
  return mode;
}

function normalizeReviewResolutionStatus(value) {
  const status = safeString(value, 32);
  if (!REVIEW_RESOLUTION_STATUSES.has(status)) {
    throw new BillingEventError("Billing review resolution status is invalid.", {
      status: 400,
      code: "invalid_billing_review_resolution_status",
    });
  }
  return status;
}

function normalizeReviewResolutionNote(value) {
  const raw = String(value || "");
  const stripped = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ").trim();
  if (!stripped) {
    throw new BillingEventError("Billing review resolution note is required.", {
      status: 400,
      code: "billing_review_resolution_note_required",
    });
  }
  if (stripped.length > MAX_REVIEW_NOTE_LENGTH) {
    throw new BillingEventError("Billing review resolution note is too long.", {
      status: 400,
      code: "billing_review_resolution_note_too_long",
    });
  }
  if (/(?:sk_live_|sk_test_|whsec_|(?:authorization|secret|token|password)\s*[:=]|pm_[A-Za-z0-9]|card\s*[:=])/i.test(stripped)) {
    throw new BillingEventError("Billing review resolution note must not include secrets or payment method values.", {
      status: 400,
      code: "unsafe_billing_review_resolution_note",
    });
  }
  return stripped;
}

function sanitizeReviewIdentifierValue(value) {
  const text = safeString(value, 128);
  if (!text) return null;
  if (/(?:secret|signature|authorization|password|credential|payment_?method|card|bank|token)/i.test(text)) {
    return null;
  }
  return text;
}

function sanitizeReviewIdentifiers(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const identifiers = {};
  for (const key of REVIEW_IDENTIFIER_KEYS) {
    const sanitized = sanitizeReviewIdentifierValue(value[key]);
    if (sanitized) identifiers[key] = sanitized;
  }
  return identifiers;
}

function sanitizePersistedCheckoutState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const safe = {};
  for (const key of [
    "scope",
    "sessionId",
    "status",
    "organizationId",
    "userId",
    "creditPackId",
    "credits",
    "hasLedgerEntry",
    "hasCompletedAt",
    "hasGrantedAt",
    "needsReview",
  ]) {
    if (value[key] == null) continue;
    if (typeof value[key] === "string") {
      const text = safeString(value[key], 128);
      if (text) safe[key] = text;
    } else if (typeof value[key] === "number" || typeof value[key] === "boolean") {
      safe[key] = value[key];
    }
  }
  return Object.keys(safe).length > 0 ? safe : null;
}

function findBillingReviewAction(event) {
  const actions = Array.isArray(event?.actions) ? event.actions : [];
  for (const action of actions) {
    const summary = action.summary && typeof action.summary === "object" && !Array.isArray(action.summary)
      ? action.summary
      : {};
    const reviewState = normalizeReviewState(summary.reviewState || summary.resolutionStatus);
    if (reviewState || summary.operatorReviewOnly === true) {
      return {
        action,
        summary,
        reviewState: reviewState || "needs_review",
      };
    }
  }
  return null;
}

function sanitizeReviewSummary(summary = {}) {
  const reviewState = normalizeReviewState(summary.reviewState || summary.resolutionStatus) || "needs_review";
  const resolution = summary.resolution && typeof summary.resolution === "object" && !Array.isArray(summary.resolution)
    ? summary.resolution
    : {};
  const sanitized = {
    eventType: safeString(summary.eventType, 128),
    providerMode: safeString(summary.providerMode, 32),
    sideEffectsEnabled: summary.sideEffectsEnabled === true,
    operatorReviewOnly: summary.operatorReviewOnly === true,
    reviewState,
    reviewReason: safeString(summary.reviewReason, 512),
    recommendedAction: safeString(summary.recommendedAction, 512),
    safeIdentifiers: sanitizeReviewIdentifiers(summary.safeIdentifiers),
    creditMutation: safeString(summary.creditMutation, 64),
    creditsGranted: Number.isFinite(Number(summary.creditsGranted)) ? Number(summary.creditsGranted) : 0,
    creditsReversed: Number.isFinite(Number(summary.creditsReversed)) ? Number(summary.creditsReversed) : 0,
    resolutionStatus: normalizeReviewState(summary.resolutionStatus || resolution.status),
    resolutionNote: safeString(summary.resolutionNote || resolution.note, MAX_REVIEW_NOTE_LENGTH),
    resolvedByUserId: safeString(summary.resolvedByUserId || resolution.resolvedByUserId, 128),
    resolvedAt: safeString(summary.resolvedAt || resolution.resolvedAt, 64),
    previousReviewState: normalizeReviewState(summary.previousReviewState),
  };
  const checkoutState = sanitizePersistedCheckoutState(summary.persistedCheckoutState);
  if (checkoutState) sanitized.persistedCheckoutState = checkoutState;
  return sanitized;
}

function serializeBillingReviewEvent(event, action, { includeSummary = false } = {}) {
  const summary = action?.summary && typeof action.summary === "object" && !Array.isArray(action.summary)
    ? action.summary
    : {};
  const reviewSummary = sanitizeReviewSummary(summary);
  const reviewState = reviewSummary.reviewState;
  const review = {
    id: event.id,
    billingEventId: event.id,
    actionId: action?.id || null,
    providerEventId: event.providerEventId,
    provider: event.provider,
    providerMode: event.providerMode,
    eventType: event.eventType,
    eventCreatedAt: event.eventCreatedAt || null,
    receivedAt: event.receivedAt,
    processingStatus: event.processingStatus,
    actionStatus: action?.status || null,
    reviewState,
    reviewReason: reviewSummary.reviewReason,
    recommendedAction: reviewSummary.recommendedAction,
    sideEffectsEnabled: reviewSummary.sideEffectsEnabled,
    operatorReviewOnly: reviewSummary.operatorReviewOnly,
    safeIdentifiers: reviewSummary.safeIdentifiers,
    resolutionStatus: reviewSummary.resolutionStatus,
    resolutionNote: reviewSummary.resolutionNote,
    resolvedByUserId: reviewSummary.resolvedByUserId,
    resolvedAt: reviewSummary.resolvedAt,
    warning: reviewState === "blocked"
      ? "Blocked billing lifecycle event: operator review is required before any billing or account readiness claim."
      : null,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
  if (includeSummary) {
    review.actionSummary = reviewSummary;
  }
  return review;
}

async function queryRows(env, sql, bindings = []) {
  const statement = env.DB.prepare(sql);
  const result = bindings.length
    ? await statement.bind(...bindings).all()
    : await statement.all();
  return result.results || [];
}

function countBy(rows, fieldName) {
  const counts = {};
  for (const row of rows) {
    const key = String(row?.[fieldName] || "unknown");
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function latestRowsByKey(rows, keyName) {
  const latest = new Map();
  const sorted = [...rows].sort((a, b) =>
    String(b.created_at || "").localeCompare(String(a.created_at || "")) ||
    String(b.id || "").localeCompare(String(a.id || ""))
  );
  for (const row of sorted) {
    const key = row?.[keyName];
    if (!key || latest.has(key)) continue;
    latest.set(key, row);
  }
  return [...latest.values()];
}

function countDuplicateIdempotencyKeys(rows, scopeKeys = []) {
  const seen = new Map();
  let duplicateGroups = 0;
  for (const row of rows) {
    if (!row?.idempotency_key) continue;
    const scope = scopeKeys.map((key) => row[key] || "").join(":");
    const key = `${scope}:${row.idempotency_key}`;
    const count = seen.get(key) || 0;
    if (count === 1) duplicateGroups += 1;
    seen.set(key, count + 1);
  }
  return duplicateGroups;
}

function severityRank(severity) {
  if (severity === "critical") return 3;
  if (severity === "warning") return 2;
  return 1;
}

function maxSeverity(items) {
  let severity = "info";
  for (const item of items) {
    if (severityRank(item.severity) > severityRank(severity)) {
      severity = item.severity;
    }
  }
  return severity;
}

function reportItem({ id, severity = "info", title, detail, count = null, refs = {} }) {
  return {
    id,
    severity,
    title: safeString(title, 160) || "Billing reconciliation item",
    detail: safeString(detail, 512) || null,
    count: Number.isFinite(Number(count)) ? Number(count) : null,
    refs,
  };
}

function reportSection(id, title, items, summary = {}) {
  return {
    id,
    title,
    severity: maxSeverity(items),
    summary,
    items: items.slice(0, RECONCILIATION_ITEM_LIMIT),
    truncated: items.length > RECONCILIATION_ITEM_LIMIT,
  };
}

function safeRowRefs(row, extra = {}) {
  return {
    id: safeString(row?.id, 128),
    providerEventId: safeString(row?.providerEventId || row?.provider_event_id, 128),
    eventType: safeString(row?.eventType || row?.event_type, 128),
    providerMode: safeString(row?.providerMode || row?.provider_mode, 32),
    checkoutSessionId: safeString(row?.provider_checkout_session_id, 128),
    organizationId: safeString(row?.organization_id || row?.organizationId, 128),
    userId: safeString(row?.user_id || row?.userId, 128),
    subscriptionId: safeString(row?.provider_subscription_id || row?.providerSubscriptionId, 128),
    ...extra,
  };
}

function isReviewStale(review, generatedAt) {
  if (!UNRESOLVED_REVIEW_STATES.has(review?.reviewState)) return false;
  const received = Date.parse(review.receivedAt || review.createdAt || "");
  const generated = Date.parse(generatedAt);
  if (!Number.isFinite(received) || !Number.isFinite(generated)) return false;
  return generated - received > RECONCILIATION_STALE_REVIEW_MS;
}

async function listReconciliationCheckouts(env) {
  const [
    organizationCheckouts,
    memberCheckouts,
    subscriptionCheckouts,
    organizationLedger,
    memberLedger,
    organizationUsage,
    memberUsage,
    memberSubscriptions,
    memberCreditBuckets,
    memberCreditBucketEvents,
  ] = await Promise.all([
    queryRows(env, `SELECT id, provider, provider_mode, provider_checkout_session_id,
                          provider_payment_intent_id, organization_id, user_id,
                          credit_pack_id, credits, amount_cents, currency, status,
                          billing_event_id, credit_ledger_entry_id, authorization_scope,
                          payment_status, granted_at, failed_at, expired_at,
                          created_at, updated_at, completed_at
                   FROM billing_checkout_sessions
                   WHERE provider = 'stripe' AND provider_mode = 'live'
                   ORDER BY created_at DESC, id DESC
                   LIMIT ?`, [RECONCILIATION_SCAN_LIMIT]),
    queryRows(env, `SELECT id, provider, provider_mode, provider_checkout_session_id,
                          provider_payment_intent_id, user_id, credit_pack_id,
                          credits, amount_cents, currency, status, billing_event_id,
                          member_credit_ledger_entry_id, authorization_scope,
                          payment_status, granted_at, failed_at, expired_at,
                          created_at, updated_at, completed_at
                   FROM billing_member_checkout_sessions
                   WHERE provider = 'stripe' AND provider_mode = 'live'
                   ORDER BY created_at DESC, id DESC
                   LIMIT ?`, [RECONCILIATION_SCAN_LIMIT]),
    queryRows(env, `SELECT id, provider, provider_mode, provider_checkout_session_id,
                          provider_subscription_id, user_id, plan_id, provider_price_id,
                          amount_cents, currency, status, billing_event_id,
                          authorization_scope, payment_status, failed_at, expired_at,
                          created_at, updated_at, completed_at
                   FROM billing_member_subscription_checkout_sessions
                   WHERE provider = 'stripe' AND provider_mode = 'live'
                   ORDER BY created_at DESC, id DESC
                   LIMIT ?`, [RECONCILIATION_SCAN_LIMIT]),
    queryRows(env, `SELECT id, organization_id, amount, balance_after, entry_type,
                          feature_key, source, idempotency_key, created_at
                   FROM credit_ledger
                   ORDER BY created_at DESC, id DESC
                   LIMIT ?`, [RECONCILIATION_SCAN_LIMIT]),
    queryRows(env, `SELECT id, user_id, amount, balance_after, entry_type,
                          feature_key, source, idempotency_key, created_at
                   FROM member_credit_ledger
                   ORDER BY created_at DESC, id DESC
                   LIMIT ?`, [RECONCILIATION_SCAN_LIMIT]),
    queryRows(env, `SELECT id, organization_id, user_id, feature_key, credits_delta,
                          credit_ledger_id, idempotency_key, status, created_at
                   FROM usage_events
                   ORDER BY created_at DESC, id DESC
                   LIMIT ?`, [RECONCILIATION_SCAN_LIMIT]),
    queryRows(env, `SELECT id, user_id, feature_key, credits_delta, credit_ledger_id,
                          idempotency_key, status, created_at
                   FROM member_usage_events
                   ORDER BY created_at DESC, id DESC
                   LIMIT ?`, [RECONCILIATION_SCAN_LIMIT]),
    queryRows(env, `SELECT id, user_id, provider, provider_mode, provider_customer_id,
                          provider_subscription_id, provider_price_id, status,
                          current_period_start, current_period_end, cancel_at_period_end,
                          canceled_at, created_at, updated_at
                   FROM billing_member_subscriptions
                   WHERE provider = 'stripe' AND provider_mode = 'live'
                   ORDER BY updated_at DESC, id DESC
                   LIMIT ?`, [RECONCILIATION_SCAN_LIMIT]),
    queryRows(env, `SELECT id, user_id, bucket_type, balance, local_subscription_id,
                          provider_subscription_id, period_start, period_end,
                          source, created_at, updated_at
                   FROM member_credit_buckets
                   ORDER BY updated_at DESC, id DESC
                   LIMIT ?`, [RECONCILIATION_SCAN_LIMIT]),
    queryRows(env, `SELECT id, user_id, bucket_id, bucket_type, amount, balance_after,
                          member_credit_ledger_id, source, idempotency_key, created_at
                   FROM member_credit_bucket_events
                   ORDER BY created_at DESC, id DESC
                   LIMIT ?`, [RECONCILIATION_SCAN_LIMIT]),
  ]);

  return {
    organizationCheckouts,
    memberCheckouts,
    subscriptionCheckouts,
    organizationLedger,
    memberLedger,
    organizationUsage,
    memberUsage,
    memberSubscriptions,
    memberCreditBuckets,
    memberCreditBucketEvents,
  };
}

export async function getBillingReconciliationReport(env) {
  const generatedAt = nowIso();
  const providerEvents = (await listBillingProviderEvents(env, {
    provider: BILLING_WEBHOOK_STRIPE_PROVIDER,
    providerMode: LIVE_MODE,
    limit: RECONCILIATION_SCAN_LIMIT,
  }));
  const eventDetails = [];
  for (const event of providerEvents) {
    eventDetails.push(await getBillingProviderEvent(env, { id: event.id }));
  }
  const reviews = [];
  for (const event of eventDetails) {
    const reviewAction = findBillingReviewAction(event);
    if (!reviewAction) continue;
    reviews.push(serializeBillingReviewEvent(event, reviewAction.action, { includeSummary: true }));
  }

  const reconciliation = await listReconciliationCheckouts(env);
  const {
    organizationCheckouts,
    memberCheckouts,
    subscriptionCheckouts,
    organizationLedger,
    memberLedger,
    organizationUsage,
    memberUsage,
    memberSubscriptions,
    memberCreditBuckets,
    memberCreditBucketEvents,
  } = reconciliation;

  const reviewCounts = countBy(reviews, "reviewState");
  const unresolvedReviews = reviews.filter((review) => UNRESOLVED_REVIEW_STATES.has(review.reviewState));
  const blockedReviews = reviews.filter((review) => review.reviewState === "blocked");
  const staleReviews = reviews.filter((review) => isReviewStale(review, generatedAt));
  const reviewTypeCounts = countBy(unresolvedReviews, "eventType");

  const providerItems = [];
  const failedEvents = providerEvents.filter((event) => event.processingStatus === "failed");
  const duplicateEventIds = Object.entries(countBy(providerEvents, "providerEventId"))
    .filter(([, count]) => count > 1);
  const conflictEvents = providerEvents.filter((event) =>
    /conflict|mismatch/i.test(`${event.errorCode || ""} ${event.errorMessage || ""}`)
  );
  if (failedEvents.length > 0) {
    providerItems.push(reportItem({
      id: "provider_events_failed",
      severity: "warning",
      title: "Live Stripe provider events failed local processing.",
      detail: "Failed provider events need operator inspection before any live billing readiness claim.",
      count: failedEvents.length,
      refs: { sampleEventId: safeString(failedEvents[0].id, 128) },
    }));
  }
  if (duplicateEventIds.length > 0) {
    providerItems.push(reportItem({
      id: "provider_events_duplicate_ids",
      severity: "warning",
      title: "Duplicate live Stripe provider event ids are present in local scan.",
      detail: "Provider event id uniqueness should prevent this; inspect D1 constraints and webhook idempotency.",
      count: duplicateEventIds.length,
    }));
  }
  if (conflictEvents.length > 0) {
    providerItems.push(reportItem({
      id: "provider_events_conflicts",
      severity: "critical",
      title: "Live Stripe provider event conflicts are present in local scan.",
      detail: "Payload mismatch/conflict markers require operator investigation before billing readiness.",
      count: conflictEvents.length,
      refs: { sampleEventId: safeString(conflictEvents[0].id, 128) },
    }));
  }
  if (providerEvents.length === 0) {
    providerItems.push(reportItem({
      id: "provider_events_none",
      severity: "info",
      title: "No recent live Stripe provider events were found in the bounded local scan.",
      detail: "This is not evidence that live webhooks are healthy; it only reflects local D1 state.",
      count: 0,
    }));
  }

  const reviewItems = [];
  if (blockedReviews.length > 0) {
    reviewItems.push(reportItem({
      id: "reviews_blocked_unresolved",
      severity: "critical",
      title: "Unresolved blocked billing review events exist.",
      detail: "Blocked live Stripe dispute events prevent live billing readiness claims until human review is complete.",
      count: blockedReviews.length,
      refs: safeRowRefs(blockedReviews[0]),
    }));
  }
  if ((reviewCounts.needs_review || 0) > 0) {
    reviewItems.push(reportItem({
      id: "reviews_needs_review",
      severity: "warning",
      title: "Billing review events still need operator review.",
      detail: "Refund, failed-payment, or dispute lifecycle events remain unresolved.",
      count: reviewCounts.needs_review || 0,
      refs: safeRowRefs(reviews.find((review) => review.reviewState === "needs_review")),
    }));
  }
  if (staleReviews.length > 0) {
    reviewItems.push(reportItem({
      id: "reviews_stale_unresolved",
      severity: "warning",
      title: "Stale unresolved billing reviews exist.",
      detail: "At least one unresolved review is older than seven days in local D1 state.",
      count: staleReviews.length,
      refs: safeRowRefs(staleReviews[0]),
    }));
  }
  if (reviewItems.length === 0) {
    reviewItems.push(reportItem({
      id: "reviews_no_unresolved_blockers",
      severity: "info",
      title: "No unresolved blocked or needs-review events were found in the bounded local scan.",
      detail: "This does not prove Stripe, accounting, or live billing readiness.",
      count: 0,
    }));
  }

  const checkoutItems = [];
  const completedOrgWithoutLedger = organizationCheckouts.filter((row) =>
    row.status === "completed" && !row.credit_ledger_entry_id
  );
  const completedMemberWithoutLedger = memberCheckouts.filter((row) =>
    row.status === "completed" && !row.member_credit_ledger_entry_id
  );
  const ledgerLinkedWithoutEvent = [
    ...organizationCheckouts.filter((row) => row.credit_ledger_entry_id && !row.billing_event_id),
    ...memberCheckouts.filter((row) => row.member_credit_ledger_entry_id && !row.billing_event_id),
  ];
  const expiredInconsistent = [
    ...organizationCheckouts,
    ...memberCheckouts,
    ...subscriptionCheckouts,
  ].filter((row) =>
    row.status === "expired" && (row.completed_at || row.granted_at || row.credit_ledger_entry_id || row.member_credit_ledger_entry_id)
  );
  const completedSubscriptionWithoutProviderId = subscriptionCheckouts.filter((row) =>
    row.status === "completed" && !row.provider_subscription_id
  );
  if (completedOrgWithoutLedger.length || completedMemberWithoutLedger.length) {
    const sample = completedOrgWithoutLedger[0] || completedMemberWithoutLedger[0];
    checkoutItems.push(reportItem({
      id: "checkouts_completed_without_ledger",
      severity: "critical",
      title: "Completed live credit-pack checkout sessions without linked ledger entries.",
      detail: "Completed checkout sessions without local credit ledger links may indicate ungranted credits or an incomplete webhook path.",
      count: completedOrgWithoutLedger.length + completedMemberWithoutLedger.length,
      refs: safeRowRefs(sample),
    }));
  }
  if (ledgerLinkedWithoutEvent.length > 0) {
    checkoutItems.push(reportItem({
      id: "checkouts_ledger_without_billing_event",
      severity: "warning",
      title: "Ledger-linked live checkout sessions are missing billing event links.",
      detail: "Credits appear locally linked to checkout sessions but lack a billing provider event id for audit traceability.",
      count: ledgerLinkedWithoutEvent.length,
      refs: safeRowRefs(ledgerLinkedWithoutEvent[0]),
    }));
  }
  if (expiredInconsistent.length > 0) {
    checkoutItems.push(reportItem({
      id: "checkouts_expired_inconsistent",
      severity: "critical",
      title: "Expired checkout sessions have completion or ledger markers.",
      detail: "Expired sessions with completion/grant markers need operator investigation.",
      count: expiredInconsistent.length,
      refs: safeRowRefs(expiredInconsistent[0]),
    }));
  }
  if (completedSubscriptionWithoutProviderId.length > 0) {
    checkoutItems.push(reportItem({
      id: "subscription_checkouts_missing_subscription_id",
      severity: "warning",
      title: "Completed subscription checkout sessions are missing provider subscription ids.",
      detail: "Subscription checkout completion without a provider subscription id blocks reliable subscription lifecycle reconciliation.",
      count: completedSubscriptionWithoutProviderId.length,
      refs: safeRowRefs(completedSubscriptionWithoutProviderId[0]),
    }));
  }
  if (checkoutItems.length === 0) {
    checkoutItems.push(reportItem({
      id: "checkouts_no_local_mismatch",
      severity: "info",
      title: "No critical local checkout/ledger mismatches were found in the bounded scan.",
      detail: "This does not call Stripe and does not prove external checkout state.",
      count: 0,
    }));
  }

  const latestOrgBalances = latestRowsByKey(organizationLedger, "organization_id");
  const latestMemberBalances = latestRowsByKey(memberLedger, "user_id");
  const negativeOrgBalances = organizationLedger.filter((row) => Number(row.balance_after) < 0);
  const negativeMemberBalances = memberLedger.filter((row) => Number(row.balance_after) < 0);
  const missingOrgUsageLedger = organizationUsage.filter((row) =>
    Number(row.credits_delta) < 0 && !row.credit_ledger_id
  );
  const missingMemberUsageLedger = memberUsage.filter((row) =>
    Number(row.credits_delta) < 0 && !row.credit_ledger_id
  );
  const duplicateOrgIdempotency = countDuplicateIdempotencyKeys(organizationLedger, ["organization_id"]);
  const duplicateMemberIdempotency = countDuplicateIdempotencyKeys(memberLedger, ["user_id"]);
  const ledgerItems = [];
  if (negativeOrgBalances.length || negativeMemberBalances.length) {
    const sample = negativeOrgBalances[0] || negativeMemberBalances[0];
    ledgerItems.push(reportItem({
      id: "credit_ledger_negative_balances",
      severity: "critical",
      title: "Suspicious negative credit balances exist.",
      detail: "Credit ledgers should not expose negative latest balances without explicit product approval.",
      count: negativeOrgBalances.length + negativeMemberBalances.length,
      refs: safeRowRefs(sample),
    }));
  }
  if (missingOrgUsageLedger.length || missingMemberUsageLedger.length) {
    const sample = missingOrgUsageLedger[0] || missingMemberUsageLedger[0];
    ledgerItems.push(reportItem({
      id: "usage_missing_ledger_entry",
      severity: "warning",
      title: "Usage events are missing linked ledger entries.",
      detail: "Credit-consuming usage without ledger linkage weakens billing auditability.",
      count: missingOrgUsageLedger.length + missingMemberUsageLedger.length,
      refs: safeRowRefs(sample),
    }));
  }
  if (duplicateOrgIdempotency || duplicateMemberIdempotency) {
    ledgerItems.push(reportItem({
      id: "credit_ledger_duplicate_idempotency",
      severity: "critical",
      title: "Duplicate credit-ledger idempotency keys were detected.",
      detail: "Duplicate idempotency keys could indicate double-grant or duplicate debit risk.",
      count: duplicateOrgIdempotency + duplicateMemberIdempotency,
    }));
  }
  if (ledgerItems.length === 0) {
    ledgerItems.push(reportItem({
      id: "credit_ledger_no_local_mismatch",
      severity: "info",
      title: "No negative balances or missing usage-ledger links were found in the bounded scan.",
      detail: "This is a local D1 consistency check only.",
      count: 0,
    }));
  }

  const subscriptionCounts = countBy(memberSubscriptions, "status");
  const activeSubscriptions = memberSubscriptions.filter((row) => row.status === "active" || row.status === "trialing");
  const missingSubscriptionIds = memberSubscriptions.filter((row) => !row.provider_subscription_id);
  const cancelAtPeriodEnd = memberSubscriptions.filter((row) => Number(row.cancel_at_period_end || 0) === 1);
  const subscriptionBucketsByProviderId = new Map();
  for (const bucket of memberCreditBuckets) {
    if (bucket.bucket_type !== "subscription" || !bucket.provider_subscription_id) continue;
    if (!subscriptionBucketsByProviderId.has(bucket.provider_subscription_id)) {
      subscriptionBucketsByProviderId.set(bucket.provider_subscription_id, []);
    }
    subscriptionBucketsByProviderId.get(bucket.provider_subscription_id).push(bucket);
  }
  const bucketEventsByBucketId = new Map();
  for (const event of memberCreditBucketEvents) {
    if (!bucketEventsByBucketId.has(event.bucket_id)) bucketEventsByBucketId.set(event.bucket_id, []);
    bucketEventsByBucketId.get(event.bucket_id).push(event);
  }
  const activeWithoutTopUp = activeSubscriptions.filter((subscription) => {
    const buckets = subscriptionBucketsByProviderId.get(subscription.provider_subscription_id) || [];
    return !buckets.some((bucket) => (bucketEventsByBucketId.get(bucket.id) || [])
      .some((event) => event.source === "subscription_period_top_up"));
  });
  const subscriptionItems = [];
  if (missingSubscriptionIds.length > 0) {
    subscriptionItems.push(reportItem({
      id: "subscriptions_missing_provider_subscription_id",
      severity: "warning",
      title: "Subscription records are missing provider subscription ids.",
      detail: "Provider subscription ids are required for reliable lifecycle reconciliation.",
      count: missingSubscriptionIds.length,
      refs: safeRowRefs(missingSubscriptionIds[0]),
    }));
  }
  if (activeWithoutTopUp.length > 0) {
    subscriptionItems.push(reportItem({
      id: "subscriptions_active_without_top_up",
      severity: "warning",
      title: "Active/trialing subscriptions lack a local subscription credit top-up marker.",
      detail: "This local signal needs operator review against paid invoice history before readiness claims.",
      count: activeWithoutTopUp.length,
      refs: safeRowRefs(activeWithoutTopUp[0]),
    }));
  }
  if (cancelAtPeriodEnd.length > 0) {
    subscriptionItems.push(reportItem({
      id: "subscriptions_cancel_at_period_end",
      severity: "info",
      title: "Subscriptions scheduled to cancel at period end exist.",
      detail: "This is informational and should be considered during operator reconciliation.",
      count: cancelAtPeriodEnd.length,
      refs: safeRowRefs(cancelAtPeriodEnd[0]),
    }));
  }
  if (subscriptionItems.length === 0) {
    subscriptionItems.push(reportItem({
      id: "subscriptions_no_local_mismatch",
      severity: "info",
      title: "No local subscription reconciliation warnings were found in the bounded scan.",
      detail: "This does not call Stripe and does not prove external subscription status.",
      count: 0,
    }));
  }

  const sections = [
    reportSection("billing_provider_events", "Billing Provider Events", providerItems, {
      recentLiveStripeEvents: providerEvents.length,
      failed: failedEvents.length,
      duplicateEventIds: duplicateEventIds.length,
      conflicts: conflictEvents.length,
    }),
    reportSection("billing_reviews", "Billing Reviews", reviewItems, {
      needsReview: reviewCounts.needs_review || 0,
      blocked: reviewCounts.blocked || 0,
      informational: reviewCounts.informational || 0,
      resolved: reviewCounts.resolved || 0,
      dismissed: reviewCounts.dismissed || 0,
      staleUnresolved: staleReviews.length,
      topUnresolvedEventTypes: Object.entries(reviewTypeCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([eventType, count]) => ({ eventType, count })),
    }),
    reportSection("checkout_sessions", "Checkout Sessions", checkoutItems, {
      organizationLiveCreditPackByStatus: countBy(organizationCheckouts, "status"),
      memberLiveCreditPackByStatus: countBy(memberCheckouts, "status"),
      memberSubscriptionCheckoutByStatus: countBy(subscriptionCheckouts, "status"),
      completedWithoutLedger: completedOrgWithoutLedger.length + completedMemberWithoutLedger.length,
      ledgerLinkedWithoutBillingEvent: ledgerLinkedWithoutEvent.length,
      expiredInconsistent: expiredInconsistent.length,
    }),
    reportSection("credit_ledger", "Credit Ledger", ledgerItems, {
      organizationAccountsScanned: latestOrgBalances.length,
      memberAccountsScanned: latestMemberBalances.length,
      organizationLedgerRowsScanned: organizationLedger.length,
      memberLedgerRowsScanned: memberLedger.length,
      negativeBalances: negativeOrgBalances.length + negativeMemberBalances.length,
      usageEventsMissingLedger: missingOrgUsageLedger.length + missingMemberUsageLedger.length,
      duplicateIdempotencyKeyGroups: duplicateOrgIdempotency + duplicateMemberIdempotency,
    }),
    reportSection("subscriptions", "Subscriptions", subscriptionItems, {
      byStatus: subscriptionCounts,
      activeOrTrialing: activeSubscriptions.length,
      cancelAtPeriodEnd: cancelAtPeriodEnd.length,
      missingProviderSubscriptionId: missingSubscriptionIds.length,
      activeWithoutTopUpMarker: activeWithoutTopUp.length,
    }),
  ];

  const criticalCount = sections.reduce(
    (count, section) => count + section.items.filter((item) => item.severity === "critical").length,
    0
  );
  const warningCount = sections.reduce(
    (count, section) => count + section.items.filter((item) => item.severity === "warning").length,
    0
  );

  return {
    ok: true,
    generatedAt,
    source: "local_d1_only",
    verdict: "blocked",
    productionReadiness: "blocked",
    liveBillingReadiness: "blocked",
    summary: {
      scanLimit: RECONCILIATION_SCAN_LIMIT,
      criticalItems: criticalCount,
      warningItems: warningCount,
      providerEvents: {
        recentLiveStripeTotal: providerEvents.length,
        failed: failedEvents.length,
        duplicateEventIds: duplicateEventIds.length,
        conflicts: conflictEvents.length,
      },
      reviews: {
        needsReview: reviewCounts.needs_review || 0,
        blocked: reviewCounts.blocked || 0,
        informational: reviewCounts.informational || 0,
        resolved: reviewCounts.resolved || 0,
        dismissed: reviewCounts.dismissed || 0,
        staleUnresolved: staleReviews.length,
      },
      checkouts: {
        organizationLiveCreditPackByStatus: countBy(organizationCheckouts, "status"),
        memberLiveCreditPackByStatus: countBy(memberCheckouts, "status"),
        memberSubscriptionCheckoutByStatus: countBy(subscriptionCheckouts, "status"),
        completedWithoutLedger: completedOrgWithoutLedger.length + completedMemberWithoutLedger.length,
        ledgerLinkedWithoutBillingEvent: ledgerLinkedWithoutEvent.length,
      },
      creditLedger: {
        organizationAccountsScanned: latestOrgBalances.length,
        memberAccountsScanned: latestMemberBalances.length,
        negativeBalances: negativeOrgBalances.length + negativeMemberBalances.length,
        usageEventsMissingLedger: missingOrgUsageLedger.length + missingMemberUsageLedger.length,
      },
      subscriptions: {
        byStatus: subscriptionCounts,
        activeOrTrialing: activeSubscriptions.length,
        cancelAtPeriodEnd: cancelAtPeriodEnd.length,
        activeWithoutTopUpMarker: activeWithoutTopUp.length,
      },
    },
    sections,
    notes: [
      "This report is read-only.",
      "It uses local D1 state only.",
      "It does not call Stripe.",
      "It does not reconcile automatically.",
      "It does not adjust credits, subscriptions, checkout state, review state, or provider events.",
      "Operator review is required before any production or live billing readiness claim.",
    ],
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
  providerMode = null,
  status = null,
  eventType = null,
  organizationId = null,
  limit = 25,
} = {}) {
  const appliedLimit = normalizeLimit(limit);
  const providerFilter = provider ? normalizeProvider(provider) : null;
  const modeFilter = providerMode ? normalizeReviewProviderMode(providerMode) : null;
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
       AND (? IS NULL OR provider_mode = ?)
       AND (? IS NULL OR processing_status = ?)
       AND (? IS NULL OR event_type = ?)
       AND (? IS NULL OR organization_id = ?)
     ORDER BY received_at DESC, id DESC
     LIMIT ?`
  ).bind(
    providerFilter,
    providerFilter,
    modeFilter,
    modeFilter,
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

export async function listBillingReviewEvents(env, {
  reviewState = null,
  provider = null,
  providerMode = null,
  eventType = null,
  limit = 25,
} = {}) {
  const appliedLimit = normalizeLimit(limit);
  const stateFilter = normalizeReviewStateFilter(reviewState);
  const modeFilter = normalizeReviewProviderMode(providerMode);
  const scanLimit = Math.min(Math.max(appliedLimit * 5, 25), 500);
  const candidateEvents = await listBillingProviderEvents(env, {
    provider,
    providerMode: modeFilter,
    eventType,
    limit: scanLimit,
  });
  const reviews = [];
  for (const event of candidateEvents) {
    const detail = await getBillingProviderEvent(env, { id: event.id });
    const reviewAction = findBillingReviewAction(detail);
    if (!reviewAction) continue;
    const review = serializeBillingReviewEvent(detail, reviewAction.action);
    if (stateFilter && review.reviewState !== stateFilter) continue;
    reviews.push(review);
    if (reviews.length >= appliedLimit) break;
  }
  return {
    reviews,
    nextCursor: null,
  };
}

export async function getBillingReviewEvent(env, { id }) {
  const event = await getBillingProviderEvent(env, { id });
  const reviewAction = findBillingReviewAction(event);
  if (!reviewAction) {
    throw new BillingEventError("Billing review event not found.", {
      status: 404,
      code: "billing_review_event_not_found",
    });
  }
  return serializeBillingReviewEvent(event, reviewAction.action, { includeSummary: true });
}

export async function resolveBillingReviewEvent(env, {
  id,
  resolutionStatus,
  resolutionNote,
  resolvedByUserId,
  idempotencyKey,
}) {
  const status = normalizeReviewResolutionStatus(resolutionStatus);
  const note = normalizeReviewResolutionNote(resolutionNote);
  const event = await getBillingProviderEvent(env, { id });
  const reviewAction = findBillingReviewAction(event);
  if (!reviewAction) {
    throw new BillingEventError("Billing review event not found.", {
      status: 404,
      code: "billing_review_event_not_found",
    });
  }

  const summary = reviewAction.summary || {};
  const existingKeyHash = summary.resolutionIdempotencyKeyHash || summary.resolution?.idempotencyKeyHash || null;
  const keyHash = await sha256Hex(`${event.id}:${String(idempotencyKey || "")}`);
  const requestHash = await sha256Hex(JSON.stringify({
    billingEventId: event.id,
    resolutionStatus: status,
    resolutionNote: note,
  }));
  const existingRequestHash = summary.resolutionRequestHash || summary.resolution?.requestHash || null;
  if (existingKeyHash === keyHash) {
    if (existingRequestHash && existingRequestHash !== requestHash) {
      throw new BillingEventError("Idempotency-Key conflicts with a different billing review resolution.", {
        status: 409,
        code: "idempotency_conflict",
      });
    }
    return {
      review: serializeBillingReviewEvent(event, reviewAction.action, { includeSummary: true }),
      reused: true,
    };
  }

  const currentState = normalizeReviewState(summary.reviewState || summary.resolutionStatus) || reviewAction.reviewState;
  if (currentState === "resolved" || currentState === "dismissed") {
    throw new BillingEventError("Billing review event is already resolved or dismissed.", {
      status: 409,
      code: "billing_review_already_finalized",
    });
  }

  const resolvedAt = nowIso();
  const updatedSummary = {
    ...summary,
    previousReviewState: currentState,
    reviewState: status,
    resolutionStatus: status,
    resolutionNote: note,
    resolvedByUserId: safeString(resolvedByUserId, 128),
    resolvedAt,
    resolutionIdempotencyKeyHash: keyHash,
    resolutionRequestHash: requestHash,
    sideEffectsEnabled: false,
    operatorReviewOnly: true,
    creditMutation: "none",
    creditsGranted: 0,
    creditsReversed: 0,
    resolution: {
      status,
      note,
      resolvedByUserId: safeString(resolvedByUserId, 128),
      resolvedAt,
      idempotencyKeyHash: keyHash,
      requestHash,
      sideEffectsEnabled: false,
    },
  };

  await updateBillingProviderEventProcessing(env, {
    eventId: event.id,
    processingStatus: event.processingStatus,
    actionType: reviewAction.action.actionType,
    actionStatus: reviewAction.action.status,
    actionDryRun: reviewAction.action.dryRun,
    actionSummary: updatedSummary,
  });

  return {
    review: await getBillingReviewEvent(env, { id: event.id }),
    reused: false,
  };
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
