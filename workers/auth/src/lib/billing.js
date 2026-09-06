import { nowIso, randomTokenHex, sha256Hex } from "./tokens.js";
import { requireOrgMembership, requireOrgRole, normalizeOrgId } from "./orgs.js";
import {
  BITBI_MEMBER_SUBSCRIPTION_CREDIT_ALLOWANCE,
  BITBI_MEMBER_SUBSCRIPTION_STORAGE_LIMIT_BYTES,
} from "../../../../js/shared/member-subscription.mjs";

export const BILLING_FEATURES = Object.freeze([
  "ai.text.generate",
  "ai.image.generate",
  "ai.video.generate",
  "ai.music.generate",
  "ai.storage.private",
  "org.members.max",
  "credits.monthly",
  "credits.balance.max",
]);

const DEFAULT_PLAN_CODE = "free";
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;
const IDEMPOTENCY_KEY_MIN_LENGTH = 8;
const IDEMPOTENCY_KEY_MAX_LENGTH = 128;
const MAX_CREDIT_GRANT = 1_000_000;
const MAX_CREDIT_CONSUME = 100_000;
export const MEMBER_DAILY_CREDIT_ALLOWANCE = 10;
export const MEMBER_SUBSCRIPTION_CREDIT_ALLOWANCE = BITBI_MEMBER_SUBSCRIPTION_CREDIT_ALLOWANCE;
export const MEMBER_SUBSCRIPTION_STORAGE_LIMIT_BYTES = BITBI_MEMBER_SUBSCRIPTION_STORAGE_LIMIT_BYTES;
export const MEMBER_CREDIT_BUCKET_SUBSCRIPTION = "subscription";
export const MEMBER_CREDIT_BUCKET_PURCHASED = "purchased";
export const MEMBER_CREDIT_BUCKET_LEGACY_OR_BONUS = "legacy_or_bonus";

const MEMBER_CREDIT_BUCKET_TYPES = new Set([
  MEMBER_CREDIT_BUCKET_SUBSCRIPTION,
  MEMBER_CREDIT_BUCKET_LEGACY_OR_BONUS,
  MEMBER_CREDIT_BUCKET_PURCHASED,
]);
const MEMBER_SUBSCRIPTION_ACTIVE_STORAGE_STATUSES = new Set(["active", "trialing"]);
const MEMBER_SUBSCRIPTION_KNOWN_STATUSES = new Set([
  "incomplete",
  "incomplete_expired",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "paused",
]);

export class BillingError extends Error {
  constructor(message, { status = 400, code = "bad_request" } = {}) {
    super(message);
    this.name = "BillingError";
    this.status = status;
    this.code = code;
  }
}

export function billingErrorResponse(error) {
  return {
    ok: false,
    error: error.message || "Billing request failed.",
    code: error.code || "bad_request",
  };
}

export function isBillingStorageUnavailableError(error) {
  const message = String(error?.message || error || "");
  if (!/(?:no such table|no such column|SQLITE_ERROR|D1_ERROR)/i.test(message)) return false;
  return /\b(?:member_credit_ledger|member_usage_events|member_credit_buckets|member_credit_bucket_events|billing_member_subscriptions|billing_member_subscription_checkout_sessions|credit_ledger|usage_events|plans|entitlements|organization_subscriptions|billing_provider_events|billing_event_actions|billing_checkout_sessions|billing_member_checkout_sessions|billing_operator_item_states|billing_operator_cleanup_runs|billing_operator_cleanup_run_items|billing_operator_purge_tombstones)\b/i.test(message);
}

export function billingStorageUnavailableResponse() {
  return {
    ok: false,
    error: "Billing data is temporarily unavailable.",
    code: "billing_storage_unavailable",
  };
}

export function normalizeBillingIdempotencyKey(value) {
  const key = String(value || "").trim();
  if (
    key.length < IDEMPOTENCY_KEY_MIN_LENGTH ||
    key.length > IDEMPOTENCY_KEY_MAX_LENGTH ||
    !IDEMPOTENCY_KEY_PATTERN.test(key)
  ) {
    throw new BillingError("A valid Idempotency-Key header is required.", {
      status: 428,
      code: "idempotency_key_required",
    });
  }
  return key;
}

function ledgerId() {
  return `cl_${randomTokenHex(16)}`;
}

function usageEventId() {
  return `ue_${randomTokenHex(16)}`;
}

function bucketId() {
  return `mcb_${randomTokenHex(16)}`;
}

function bucketEventId() {
  return `mcbe_${randomTokenHex(16)}`;
}

function memberSubscriptionId() {
  return `msub_${randomTokenHex(16)}`;
}

function normalizeUserId(value) {
  const userId = String(value || "").trim();
  if (!userId || userId.length > 128) {
    throw new BillingError("User not found.", {
      status: 404,
      code: "user_not_found",
    });
  }
  return userId;
}

function normalizeFeatureKey(value) {
  const featureKey = String(value || "").trim();
  if (!BILLING_FEATURES.includes(featureKey)) {
    throw new BillingError("Unsupported billing feature.", {
      status: 400,
      code: "unsupported_feature",
    });
  }
  return featureKey;
}

function normalizePositiveInteger(value, { max, fieldName }) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0 || number > max) {
    throw new BillingError(`${fieldName} must be a positive integer.`, {
      status: 400,
      code: "invalid_amount",
    });
  }
  return number;
}

function normalizeNullableString(value, maxLength = 256) {
  const text = String(value || "").trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

function parseJsonObject(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function serializeJsonObject(value) {
  return JSON.stringify(value && typeof value === "object" && !Array.isArray(value) ? value : {});
}

function normalizeCreditBucketType(value) {
  const bucketType = String(value || "").trim();
  if (!MEMBER_CREDIT_BUCKET_TYPES.has(bucketType)) {
    throw new BillingError("Unsupported member credit bucket.", {
      status: 400,
      code: "unsupported_credit_bucket",
    });
  }
  return bucketType;
}

function normalizeSubscriptionStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (!MEMBER_SUBSCRIPTION_KNOWN_STATUSES.has(status)) {
    return "incomplete";
  }
  return status;
}

function normalizeIsoFromStripeTimestamp(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    const date = new Date(value > 10_000_000_000 ? value : value * 1000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isFutureIso(value, now = nowIso()) {
  if (!value) return false;
  return String(value) > String(now);
}

function isMissingMemberBucketTableError(error) {
  return String(error || "").includes("no such table")
    && String(error || "").includes("member_credit_buckets");
}

function classifyGrantBucketType(source, explicitBucketType = null) {
  if (explicitBucketType) return normalizeCreditBucketType(explicitBucketType);
  if (source === "subscription_period_top_up") return MEMBER_CREDIT_BUCKET_SUBSCRIPTION;
  if (source === "stripe_live_checkout") return MEMBER_CREDIT_BUCKET_PURCHASED;
  return MEMBER_CREDIT_BUCKET_LEGACY_OR_BONUS;
}

function bucketSortOrder(bucketType) {
  if (bucketType === MEMBER_CREDIT_BUCKET_SUBSCRIPTION) return 0;
  if (bucketType === MEMBER_CREDIT_BUCKET_LEGACY_OR_BONUS) return 1;
  return 2;
}

function serializeMemberSubscriptionRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    providerMode: row.provider_mode,
    providerCustomerId: row.provider_customer_id || null,
    providerSubscriptionId: row.provider_subscription_id || null,
    providerPriceId: row.provider_price_id || null,
    status: row.status,
    currentPeriodStart: row.current_period_start || null,
    currentPeriodEnd: row.current_period_end || null,
    cancelAtPeriodEnd: Number(row.cancel_at_period_end || 0) === 1,
    canceledAt: row.canceled_at || null,
    metadata: parseJsonObject(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeMemberCreditBucket(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    bucketType: row.bucket_type,
    balance: Number(row.balance || 0),
    localSubscriptionId: row.local_subscription_id || null,
    providerSubscriptionId: row.provider_subscription_id || null,
    periodStart: row.period_start || null,
    periodEnd: row.period_end || null,
    source: row.source || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata: parseJsonObject(row.metadata_json),
  };
}

async function hashRequest(value) {
  return sha256Hex(JSON.stringify(value));
}

async function buildUsageRequestHash({
  organizationId,
  userId,
  featureKey,
  quantity,
  credits,
  requestFingerprint = null,
}) {
  return hashRequest({
    organizationId,
    userId: userId || null,
    featureKey,
    quantity,
    credits,
    requestFingerprint: normalizeNullableString(requestFingerprint, 128),
  });
}

export async function buildMemberUsageRequestHash({
  userId,
  featureKey,
  quantity,
  credits,
  requestFingerprint = null,
}) {
  return hashRequest({
    userId,
    featureKey,
    quantity,
    credits,
    requestFingerprint: normalizeNullableString(requestFingerprint, 128),
  });
}

function serializePlan(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status,
    billingInterval: row.billing_interval,
    monthlyCreditGrant: Number(row.monthly_credit_grant || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeSubscription(row) {
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    planId: row.plan_id,
    status: row.status,
    source: row.source,
    provider: row.provider || null,
    currentPeriodStart: row.current_period_start || null,
    currentPeriodEnd: row.current_period_end || null,
    cancelAt: row.cancel_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeEntitlement(row) {
  const value = (() => {
    if (row.value_kind === "number") return Number(row.value_numeric || 0);
    if (row.value_kind === "text") return row.value_text || "";
    return Boolean(row.enabled);
  })();
  return {
    featureKey: row.feature_key,
    enabled: Number(row.enabled) === 1,
    valueKind: row.value_kind,
    value,
  };
}

function serializeLedgerEntry(row) {
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    amount: Number(row.amount || 0),
    balanceAfter: Number(row.balance_after || 0),
    entryType: row.entry_type,
    featureKey: row.feature_key || null,
    source: row.source,
    createdByUserId: row.created_by_user_id || null,
    createdAt: row.created_at,
  };
}

function serializeUsageEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id || null,
    featureKey: row.feature_key,
    quantity: Number(row.quantity || 0),
    creditsDelta: Number(row.credits_delta || 0),
    creditLedgerId: row.credit_ledger_id || null,
    status: row.status,
    createdAt: row.created_at,
  };
}

function serializeMemberLedgerEntry(row) {
  if (!row) return null;
  const metadata = parseJsonObject(row.metadata_json);
  return {
    id: row.id,
    userId: row.user_id,
    amount: Number(row.amount || 0),
    balanceAfter: Number(row.balance_after || 0),
    entryType: row.entry_type,
    featureKey: row.feature_key || null,
    source: row.source,
    createdByUserId: row.created_by_user_id || null,
    createdByEmail: row.created_by_email || null,
    createdAt: row.created_at,
    metadata,
  };
}

function serializeMemberUsageEvent(row) {
  if (!row) return null;
  const metadata = parseJsonObject(row.metadata_json);
  return {
    id: row.id,
    userId: row.user_id,
    featureKey: row.feature_key,
    quantity: Number(row.quantity || 0),
    creditsDelta: Number(row.credits_delta || 0),
    creditLedgerId: row.credit_ledger_id || null,
    status: row.status,
    createdAt: row.created_at,
    metadata,
  };
}

async function getDefaultPlan(env) {
  const row = await env.DB.prepare(
    "SELECT id, code, name, status, billing_interval, monthly_credit_grant, created_at, updated_at FROM plans WHERE code = ? AND status = 'active' LIMIT 1"
  ).bind(DEFAULT_PLAN_CODE).first();
  if (!row) {
    throw new BillingError("Default billing plan is unavailable.", {
      status: 503,
      code: "default_plan_unavailable",
    });
  }
  return row;
}

async function assertOrganizationExists(env, organizationId) {
  const row = await env.DB.prepare(
    "SELECT id FROM organizations WHERE id = ? AND status = 'active' LIMIT 1"
  ).bind(organizationId).first();
  if (!row) {
    throw new BillingError("Organization not found.", {
      status: 404,
      code: "organization_not_found",
    });
  }
}

async function getActiveUser(env, userId) {
  const normalizedUserId = normalizeUserId(userId);
  const row = await env.DB.prepare(
    "SELECT id, email, role, status, created_at FROM users WHERE id = ? LIMIT 1"
  ).bind(normalizedUserId).first();
  if (!row || row.status !== "active") {
    throw new BillingError("User not found.", {
      status: 404,
      code: "user_not_found",
    });
  }
  return row;
}

async function getActiveSubscription(env, organizationId) {
  return env.DB.prepare(
    `SELECT id, organization_id, plan_id, status, source, provider,
            current_period_start, current_period_end, cancel_at, created_at, updated_at
     FROM organization_subscriptions
     WHERE organization_id = ?
       AND status = 'active'
     ORDER BY created_at DESC, id DESC
     LIMIT 1`
  ).bind(organizationId).first();
}

async function getPlanById(env, planId) {
  return env.DB.prepare(
    "SELECT id, code, name, status, billing_interval, monthly_credit_grant, created_at, updated_at FROM plans WHERE id = ? LIMIT 1"
  ).bind(planId).first();
}

async function listPlanEntitlements(env, planId) {
  const rows = await env.DB.prepare(
    `SELECT id, plan_id, feature_key, enabled, value_kind, value_numeric, value_text, created_at, updated_at
     FROM entitlements
     WHERE plan_id = ?
     ORDER BY feature_key ASC`
  ).bind(planId).all();
  return (rows.results || []).map(serializeEntitlement);
}

export async function getCreditBalance(env, organizationId) {
  const orgId = normalizeOrgId(organizationId);
  const row = await env.DB.prepare(
    `SELECT balance_after
     FROM credit_ledger
     WHERE organization_id = ?
     ORDER BY created_at DESC, rowid DESC
     LIMIT 1`
  ).bind(orgId).first();
  return Number(row?.balance_after || 0);
}

async function getMemberLedgerBalance(env, userId) {
  const normalizedUserId = normalizeUserId(userId);
  const row = await env.DB.prepare(
    `SELECT balance_after
     FROM member_credit_ledger
     WHERE user_id = ?
     ORDER BY created_at DESC, rowid DESC
     LIMIT 1`
  ).bind(normalizedUserId).first();
  return Number(row?.balance_after || 0);
}

async function listMemberLedgerRows(env, userId) {
  const rows = await env.DB.prepare(
    `SELECT id, user_id, amount, balance_after, entry_type, feature_key,
            source, idempotency_key, request_hash, created_by_user_id, created_at, metadata_json
     FROM member_credit_ledger
     WHERE user_id = ?
     ORDER BY created_at ASC, rowid ASC`
  ).bind(userId).all();
  return rows.results || [];
}

function deriveBucketsFromLegacyLedger(rows) {
  const balances = {
    [MEMBER_CREDIT_BUCKET_SUBSCRIPTION]: 0,
    [MEMBER_CREDIT_BUCKET_LEGACY_OR_BONUS]: 0,
    [MEMBER_CREDIT_BUCKET_PURCHASED]: 0,
  };
  for (const row of rows || []) {
    const amount = Number(row.amount || 0);
    if (amount === 0) continue;
    const metadata = parseJsonObject(row.metadata_json);
    if (amount > 0) {
      const bucketType = classifyGrantBucketType(row.source, metadata.credit_bucket || metadata.creditBucket);
      balances[bucketType] += amount;
      continue;
    }
    let remainingDebit = Math.abs(amount);
    for (const bucketType of [
      MEMBER_CREDIT_BUCKET_SUBSCRIPTION,
      MEMBER_CREDIT_BUCKET_LEGACY_OR_BONUS,
      MEMBER_CREDIT_BUCKET_PURCHASED,
    ]) {
      if (remainingDebit <= 0) break;
      const debit = Math.min(balances[bucketType], remainingDebit);
      balances[bucketType] -= debit;
      remainingDebit -= debit;
    }
  }

  const ledgerBalance = Number(rows?.at(-1)?.balance_after || 0);
  const derivedTotal = balances[MEMBER_CREDIT_BUCKET_SUBSCRIPTION]
    + balances[MEMBER_CREDIT_BUCKET_LEGACY_OR_BONUS]
    + balances[MEMBER_CREDIT_BUCKET_PURCHASED];
  if (ledgerBalance > derivedTotal) {
    balances[MEMBER_CREDIT_BUCKET_LEGACY_OR_BONUS] += ledgerBalance - derivedTotal;
  }
  return balances;
}

async function listMemberCreditBucketRows(env, userId) {
  const rows = await env.DB.prepare(
    `SELECT id, user_id, bucket_type, balance, local_subscription_id,
            provider_subscription_id, period_start, period_end, source,
            metadata_json, created_at, updated_at
     FROM member_credit_buckets
     WHERE user_id = ?
     ORDER BY
       CASE bucket_type
         WHEN 'subscription' THEN 0
         WHEN 'legacy_or_bonus' THEN 1
         WHEN 'purchased' THEN 2
         ELSE 3
       END,
       period_start DESC,
       created_at ASC,
       id ASC`
  ).bind(userId).all();
  return rows.results || [];
}

function memberCreditBucketGrantStatements(env, {
  userId, ledgerEntryId, bucketType, source, idempotencyKey,
  localSubscriptionId = null, providerSubscriptionId = null, periodStart = null, periodEnd = null,
  metadata = {}, now = nowIso(),
}) {
  const type = normalizeCreditBucketType(bucketType);
  if (type === MEMBER_CREDIT_BUCKET_SUBSCRIPTION && (!providerSubscriptionId || !periodStart)) {
    throw new BillingError("Member subscription bucket scope is required.", { status: 503, code: "credit_bucket_unavailable" });
  }
  const selector = `user_id = ? AND bucket_type = ?${type === MEMBER_CREDIT_BUCKET_SUBSCRIPTION ? " AND provider_subscription_id = ? AND period_start = ?" : ""}`;
  const selected = [userId, type, ...(type === MEMBER_CREDIT_BUCKET_SUBSCRIPTION ? [providerSubscriptionId, periodStart] : [])];
  const statements = [];
  const add = (sql, ...bindings) => statements.push(env.DB.prepare(sql).bind(...bindings));
  // The fresh ledger ID belongs to this transaction. Replay never increments
  // the bucket, and a missing target bucket aborts at the event NOT NULL guard.
  add(`INSERT OR IGNORE INTO member_credit_buckets
      (id, user_id, bucket_type, balance, local_subscription_id, provider_subscription_id,
       period_start, period_end, source, metadata_json, created_at, updated_at)
      SELECT ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM member_credit_ledger WHERE id = ? AND amount > 0)`,
    bucketId(), userId, type, localSubscriptionId, providerSubscriptionId, periodStart, periodEnd, source,
    serializeJsonObject({ ...metadata, credit_bucket: type }), now, now, ledgerEntryId);
  add(`UPDATE member_credit_buckets
      SET balance = balance + (SELECT amount FROM member_credit_ledger WHERE id = ?),
        local_subscription_id = COALESCE(?, local_subscription_id), provider_subscription_id = COALESCE(?, provider_subscription_id),
        period_start = COALESCE(?, period_start), period_end = COALESCE(?, period_end), source = COALESCE(?, source), updated_at = ?
      WHERE ${selector} AND EXISTS (SELECT 1 FROM member_credit_ledger WHERE id = ? AND amount > 0)`,
    ledgerEntryId, localSubscriptionId, providerSubscriptionId, periodStart, periodEnd, source, now, ...selected, ledgerEntryId);
  add(`INSERT INTO member_credit_bucket_events
      (id, user_id, bucket_id, bucket_type, amount, balance_after, member_credit_ledger_id, source, idempotency_key, metadata_json, created_at)
      SELECT ?, ?, (SELECT id FROM member_credit_buckets WHERE ${selector}), ?, l.amount,
        (SELECT balance FROM member_credit_buckets WHERE ${selector}), l.id, ?, ?, ?, ?
      FROM member_credit_ledger l WHERE l.id = ? AND l.amount > 0`,
    bucketEventId(), userId, ...selected, type, ...selected, source, idempotencyKey,
    serializeJsonObject({ ...metadata, credit_bucket: type }), now, ledgerEntryId);
  return statements;
}

async function prepareMemberCreditBucketReconciliation(env, userId, now = nowIso()) {
  const statements = [];
  const add = (sql, ...bindings) => statements.push(env.DB.prepare(sql).bind(...bindings));
  const latestBalanceSql = "COALESCE((SELECT balance_after FROM member_credit_ledger WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1), 0)";
  const balanceSql = "COALESCE((SELECT SUM(balance) FROM member_credit_buckets WHERE user_id = ?), 0)";
  // Preserve the existing legacy classification, but initialize/reconcile it
  // inside the fulfillment transaction. A stale no-bucket snapshot cannot
  // seed old balances over newer ledger activity.
  const buckets = await listMemberCreditBucketRows(env, userId);
  if (!buckets.length) {
    const rows = await listMemberLedgerRows(env, userId);
    const balances = deriveBucketsFromLegacyLedger(rows);
    const seedId = bucketId();
    add(`INSERT INTO member_credit_buckets
        (id, user_id, bucket_type, balance, source, metadata_json, created_at, updated_at)
        SELECT ?, ?, 'purchased', ?, 'legacy_ledger_reconciliation', ?, ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM member_credit_buckets WHERE user_id = ?)
          AND COALESCE((SELECT id FROM member_credit_ledger WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1), '') = ?`,
      seedId, userId, balances[MEMBER_CREDIT_BUCKET_PURCHASED],
      serializeJsonObject({ credit_bucket: "purchased", reconciliation_source: "member_credit_ledger", origin_confidence: "stripe_live_checkout_source" }),
      now, now, userId, userId, rows.at(-1)?.id || "");
    add(`INSERT INTO member_credit_buckets
        (id, user_id, bucket_type, balance, source, metadata_json, created_at, updated_at)
        SELECT ?, ?, 'legacy_or_bonus', ?, 'legacy_ledger_reconciliation', ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM member_credit_buckets WHERE id = ?)`,
      bucketId(), userId, balances[MEMBER_CREDIT_BUCKET_LEGACY_OR_BONUS],
      serializeJsonObject({ credit_bucket: "legacy_or_bonus", reconciliation_source: "member_credit_ledger", origin_confidence: "unproven_or_bonus" }),
      now, now, seedId);
  }
  for (const bucketType of [MEMBER_CREDIT_BUCKET_PURCHASED, MEMBER_CREDIT_BUCKET_LEGACY_OR_BONUS]) {
    add(`INSERT OR IGNORE INTO member_credit_buckets
        (id, user_id, bucket_type, balance, source, metadata_json, created_at, updated_at)
        SELECT ?, ?, ?, 0, 'legacy_ledger_reconciliation', '{}', ?, ?
        WHERE EXISTS (SELECT 1 FROM member_credit_buckets WHERE user_id = ?)`,
      bucketId(), userId, bucketType, now, now, userId);
  }

  add(`UPDATE member_credit_buckets SET balance = balance + MAX(0, ${latestBalanceSql} - ${balanceSql}), updated_at = ?
       WHERE user_id = ? AND bucket_type = 'legacy_or_bonus'
         AND ${latestBalanceSql} > ${balanceSql}`, userId, userId, now, userId, userId, userId);
  return statements;
}

async function ensureMemberCreditBuckets(env, userId) {
  const normalizedUserId = normalizeUserId(userId);
  // The SQL compares current ledger and current bucket totals together. A
  // paused reader can never turn a later Pack commit into a second bonus grant.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await env.DB.batch(await prepareMemberCreditBucketReconciliation(env, normalizedUserId));
    const rows = await listMemberCreditBucketRows(env, normalizedUserId);
    if (rows.length) return rows;
  }
  throw new BillingError("Member credit buckets changed during initialization; retry.", {
    status: 503, code: "credit_bucket_unavailable",
  });
}

export async function getMemberCreditBucketBalances(env, userId) {
  const normalizedUserId = normalizeUserId(userId);
  let rows;
  try {
    rows = await ensureMemberCreditBuckets(env, normalizedUserId);
  } catch (error) {
    if (!isMissingMemberBucketTableError(error)) throw error;
    const balance = await getMemberLedgerBalance(env, normalizedUserId);
    return {
      totalCredits: balance,
      subscriptionCredits: 0,
      legacyOrBonusCredits: balance,
      purchasedCredits: 0,
      buckets: [],
      bucketStorageAvailable: false,
    };
  }

  const subscriptionCredits = rows
    .filter((row) => row.bucket_type === MEMBER_CREDIT_BUCKET_SUBSCRIPTION)
    .reduce((sum, row) => sum + Number(row.balance || 0), 0);
  const legacyOrBonusCredits = rows
    .filter((row) => row.bucket_type === MEMBER_CREDIT_BUCKET_LEGACY_OR_BONUS)
    .reduce((sum, row) => sum + Number(row.balance || 0), 0);
  const purchasedCredits = rows
    .filter((row) => row.bucket_type === MEMBER_CREDIT_BUCKET_PURCHASED)
    .reduce((sum, row) => sum + Number(row.balance || 0), 0);
  return {
    totalCredits: subscriptionCredits + legacyOrBonusCredits + purchasedCredits,
    subscriptionCredits,
    legacyOrBonusCredits,
    purchasedCredits,
    buckets: rows.map(serializeMemberCreditBucket),
    bucketStorageAvailable: true,
  };
}

export async function getMemberCreditBalance(env, userId) {
  const buckets = await getMemberCreditBucketBalances(env, userId);
  return buckets.totalCredits;
}

export async function getOrganizationBillingState(env, { organizationId }) {
  const orgId = normalizeOrgId(organizationId);
  await assertOrganizationExists(env, orgId);
  const subscription = await getActiveSubscription(env, orgId);
  const plan = subscription
    ? await getPlanById(env, subscription.plan_id)
    : await getDefaultPlan(env);
  if (!plan || plan.status !== "active") {
    throw new BillingError("Billing plan is unavailable.", {
      status: 503,
      code: "plan_unavailable",
    });
  }
  const entitlements = await listPlanEntitlements(env, plan.id);
  const creditBalance = await getCreditBalance(env, orgId);
  return {
    organizationId: orgId,
    plan: serializePlan(plan),
    subscription: serializeSubscription(subscription),
    entitlements,
    creditBalance,
    livePaymentProviderEnabled: false,
  };
}

export function entitlementMap(entitlements) {
  const map = new Map();
  for (const entitlement of entitlements || []) {
    map.set(entitlement.featureKey, entitlement);
  }
  return map;
}

export async function resolveEffectiveEntitlements(env, { organizationId }) {
  const state = await getOrganizationBillingState(env, { organizationId });
  return {
    organizationId: state.organizationId,
    plan: state.plan,
    entitlements: state.entitlements,
  };
}

export async function assertOrganizationFeatureEnabled(env, { organizationId, featureKey }) {
  const feature = normalizeFeatureKey(featureKey);
  const state = await getOrganizationBillingState(env, { organizationId });
  const entitlement = entitlementMap(state.entitlements).get(feature);
  if (!entitlement || !entitlement.enabled) {
    throw new BillingError("Feature is not enabled for this organization.", {
      status: 403,
      code: "feature_not_entitled",
    });
  }
  return { state, entitlement };
}

export async function assertOrganizationHasCredits(env, { organizationId, credits }) {
  const requiredCredits = normalizePositiveInteger(credits, {
    max: MAX_CREDIT_CONSUME,
    fieldName: "credits",
  });
  const balance = await getCreditBalance(env, organizationId);
  if (balance < requiredCredits) {
    throw new BillingError("Insufficient organization credits.", {
      status: 402,
      code: "insufficient_credits",
    });
  }
  return { balance, requiredCredits };
}

async function fetchLedgerByIdempotency(env, { organizationId, idempotencyKey }) {
  return env.DB.prepare(
    `SELECT id, organization_id, amount, balance_after, entry_type, feature_key,
            source, request_hash, created_by_user_id, created_at
     FROM credit_ledger
     WHERE organization_id = ? AND idempotency_key = ?
     LIMIT 1`
  ).bind(organizationId, idempotencyKey).first();
}

async function fetchMemberLedgerByIdempotency(env, { userId, idempotencyKey }) {
  return env.DB.prepare(
    `SELECT id, user_id, amount, balance_after, entry_type, feature_key,
            source, request_hash, created_by_user_id, created_at
     FROM member_credit_ledger
     WHERE user_id = ? AND idempotency_key = ?
     LIMIT 1`
  ).bind(userId, idempotencyKey).first();
}

async function fetchUsageByIdempotency(env, { organizationId, idempotencyKey }) {
  return env.DB.prepare(
    `SELECT id, organization_id, user_id, feature_key, quantity, credits_delta,
            credit_ledger_id, request_hash, status, created_at
     FROM usage_events
     WHERE organization_id = ? AND idempotency_key = ?
     LIMIT 1`
  ).bind(organizationId, idempotencyKey).first();
}

export async function fetchMemberUsageByIdempotency(env, { userId, idempotencyKey }) {
  return env.DB.prepare(
    `SELECT id, user_id, feature_key, quantity, credits_delta,
            credit_ledger_id, request_hash, status, created_at
     FROM member_usage_events
     WHERE user_id = ? AND idempotency_key = ?
     LIMIT 1`
  ).bind(userId, idempotencyKey).first();
}

export async function assertUsageIdempotencyAvailable({
  env,
  organizationId,
  userId = null,
  featureKey,
  quantity = 1,
  credits,
  idempotencyKey,
  requestFingerprint = null,
}) {
  const orgId = normalizeOrgId(organizationId);
  const feature = normalizeFeatureKey(featureKey);
  const normalizedQuantity = normalizePositiveInteger(quantity, {
    max: MAX_CREDIT_CONSUME,
    fieldName: "quantity",
  });
  const normalizedCredits = normalizePositiveInteger(credits ?? normalizedQuantity, {
    max: MAX_CREDIT_CONSUME,
    fieldName: "credits",
  });
  const existingUsage = await fetchUsageByIdempotency(env, { organizationId: orgId, idempotencyKey });
  if (!existingUsage) return null;

  const requestHash = await buildUsageRequestHash({
    organizationId: orgId,
    userId,
    featureKey: feature,
    quantity: normalizedQuantity,
    credits: normalizedCredits,
    requestFingerprint,
  });
  if (existingUsage.request_hash !== requestHash) {
    throw new BillingError("Idempotency-Key conflicts with a different usage request.", {
      status: 409,
      code: "idempotency_conflict",
    });
  }
  return serializeUsageEvent(existingUsage);
}

async function getBalanceCap(env, organizationId) {
  const state = await getOrganizationBillingState(env, { organizationId });
  const cap = entitlementMap(state.entitlements).get("credits.balance.max");
  return Number(cap?.value || 0) || null;
}

export async function grantOrganizationCredits({
  env,
  organizationId,
  amount,
  createdByUserId,
  idempotencyKey,
  source = "manual_admin_grant",
  reason = null,
}) {
  const orgId = normalizeOrgId(organizationId);
  const normalizedAmount = normalizePositiveInteger(amount, {
    max: MAX_CREDIT_GRANT,
    fieldName: "amount",
  });
  const requestHash = await hashRequest({
    organizationId: orgId,
    amount: normalizedAmount,
    source,
    reason: normalizeNullableString(reason),
  });
  const existing = await fetchLedgerByIdempotency(env, { organizationId: orgId, idempotencyKey });
  if (existing) {
    if (existing.request_hash !== requestHash) {
      throw new BillingError("Idempotency-Key conflicts with a different credit grant.", {
        status: 409,
        code: "idempotency_conflict",
      });
    }
    return {
      ledgerEntry: serializeLedgerEntry(existing),
      creditBalance: Number(existing.balance_after || 0),
      reused: true,
    };
  }

  const balanceCap = await getBalanceCap(env, orgId);
  const now = nowIso();
  const entryId = ledgerId();
  let result;
  try {
    // Read the balance and enforce its cap inside the insertion. A paused
    // manual grant must include an intervening checkout grant or debit.
    result = await env.DB.prepare(
      `INSERT INTO credit_ledger (
         id, organization_id, amount, balance_after, entry_type, feature_key,
         source, idempotency_key, request_hash, created_by_user_id, created_at, metadata_json
       ) SELECT ?, ?, CASE WHEN ? IS NULL OR latest.balance_after + ? <= ? THEN ? ELSE NULL END,
         latest.balance_after + ?, 'grant', NULL, ?, ?, ?, ?,
         MAX(?, COALESCE((SELECT created_at FROM credit_ledger WHERE organization_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1), '')), ?
       FROM (
         SELECT COALESCE((SELECT balance_after FROM credit_ledger WHERE organization_id = ?
           ORDER BY created_at DESC, rowid DESC LIMIT 1), 0) AS balance_after
       ) AS latest
       WHERE NOT EXISTS (SELECT 1 FROM credit_ledger WHERE organization_id = ? AND idempotency_key = ?)`
    ).bind(
      entryId, orgId, balanceCap, normalizedAmount, balanceCap, normalizedAmount,
      normalizedAmount, source, idempotencyKey, requestHash, createdByUserId || null,
      now, orgId, JSON.stringify({ reason: normalizeNullableString(reason) }), orgId, orgId, idempotencyKey
    ).run();
  } catch (error) {
    if (/NOT NULL constraint failed: credit_ledger\.amount/.test(String(error))) {
      throw new BillingError("Credit grant would exceed the organization's balance cap.", {
        status: 409,
        code: "credit_balance_cap_exceeded",
      });
    }
    if (String(error).includes("UNIQUE")) {
      throw new BillingError("Credit grant conflict.", {
        status: 409,
        code: "credit_grant_conflict",
      });
    }
    throw error;
  }

  if (result?.success !== true || !Number.isInteger(result?.meta?.changes)
    || ![0, 1].includes(result.meta.changes)) {
    throw new BillingError("Credit grant was not confirmed.", { status: 503, code: "credit_grant_incomplete" });
  }
  const entry = await env.DB.prepare("SELECT * FROM credit_ledger WHERE id = ? AND organization_id = ?")
    .bind(entryId, orgId).first()
    || await fetchLedgerByIdempotency(env, { organizationId: orgId, idempotencyKey });
  if (entry && entry.request_hash !== requestHash) {
    throw new BillingError("Idempotency-Key conflicts with a different credit grant.", {
      status: 409, code: "idempotency_conflict",
    });
  }
  if (!entry || (entry.id === entryId && Number(result?.meta?.changes) !== 1)
    || (entry.id !== entryId && Number(result?.meta?.changes) !== 0)) {
    throw new BillingError("Credit grant was not confirmed.", { status: 503, code: "credit_grant_incomplete" });
  }
  return {
    ledgerEntry: serializeLedgerEntry(entry),
    creditBalance: Number(entry.balance_after || 0),
    reused: entry.id !== entryId,
  };
}

export async function topUpMemberDailyCredits({
  env,
  userId,
  now = nowIso(),
  allowance = MEMBER_DAILY_CREDIT_ALLOWANCE,
}) {
  const normalizedUserId = normalizeUserId(userId);
  await getActiveUser(env, normalizedUserId);
  const normalizedAllowance = normalizePositiveInteger(allowance, {
    max: MAX_CREDIT_GRANT,
    fieldName: "allowance",
  });
  const dayStart = now.slice(0, 10) + "T00:00:00.000Z";
  const idempotencyKey = `member-daily-topup:${dayStart}`;
  const requestHash = await hashRequest({
    userId: normalizedUserId,
    dayStart,
    allowance: normalizedAllowance,
    source: "daily_member_top_up",
  });

  const existing = await fetchMemberLedgerByIdempotency(env, {
    userId: normalizedUserId,
    idempotencyKey,
  });
  if (existing) {
    if (existing.request_hash !== requestHash) {
      throw new BillingError("Daily member credit top-up conflict.", {
        status: 409,
        code: "idempotency_conflict",
      });
    }
    const currentBalance = await getMemberCreditBalance(env, normalizedUserId);
    return {
      ledgerEntry: serializeMemberLedgerEntry(existing),
      creditBalance: currentBalance,
      grantedCredits: Number(existing.amount || 0),
      dailyAllowance: normalizedAllowance,
      dayStart,
      reused: true,
    };
  }

  const nowValue = nowIso();
  const entryId = ledgerId();
  try {
    const ledgerStatement = env.DB.prepare(
      `INSERT INTO member_credit_ledger (
         id, user_id, amount, balance_after, entry_type, feature_key,
         source, idempotency_key, request_hash, created_by_user_id, created_at, metadata_json
       )
       SELECT
         ?, ?, 
         CASE WHEN EXISTS (SELECT 1 FROM member_credit_buckets WHERE user_id = ?)
           THEN CASE WHEN latest.balance_after < ? THEN ? - latest.balance_after ELSE 0 END ELSE NULL END,
         CASE WHEN latest.balance_after < ? THEN ? ELSE latest.balance_after END,
         ?, ?, ?, ?, ?, ?,
         MAX(?, COALESCE((SELECT created_at FROM member_credit_ledger WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1), '')), ?
       FROM (
         SELECT COALESCE((
           SELECT balance_after FROM member_credit_ledger
           WHERE user_id = ?
           ORDER BY created_at DESC, rowid DESC
           LIMIT 1
         ), 0) AS balance_after
       ) AS latest`
    ).bind(
      entryId,
      normalizedUserId,
      normalizedUserId,
      normalizedAllowance,
      normalizedAllowance,
      normalizedAllowance,
      normalizedAllowance,
      "grant",
      null,
      "daily_member_top_up",
      idempotencyKey,
      requestHash,
      null,
      nowValue,
      normalizedUserId,
      JSON.stringify({ dayStart, allowance: normalizedAllowance }),
      normalizedUserId
    );
    const initialization = await prepareMemberCreditBucketReconciliation(env, normalizedUserId, nowValue);
    await env.DB.batch([
      ...initialization, ledgerStatement,
      ...memberCreditBucketGrantStatements(env, {
        userId: normalizedUserId, ledgerEntryId: entryId, bucketType: MEMBER_CREDIT_BUCKET_LEGACY_OR_BONUS,
        source: "daily_member_top_up", idempotencyKey,
        metadata: { dayStart, allowance: normalizedAllowance }, now: nowValue,
      }),
    ]);
  } catch (error) {
    if (String(error).includes("UNIQUE")) {
      const raced = await fetchMemberLedgerByIdempotency(env, {
        userId: normalizedUserId,
        idempotencyKey,
      });
      if (raced && raced.request_hash === requestHash) {
        const currentBalance = await getMemberCreditBalance(env, normalizedUserId);
        return {
          ledgerEntry: serializeMemberLedgerEntry(raced),
          creditBalance: currentBalance,
          grantedCredits: Number(raced.amount || 0),
          dailyAllowance: normalizedAllowance,
          dayStart,
          reused: true,
        };
      }
      throw new BillingError("Daily member credit top-up conflict.", {
        status: 409,
        code: "idempotency_conflict",
      });
    }
    throw error;
  }

  const inserted = await fetchMemberLedgerByIdempotency(env, {
    userId: normalizedUserId,
    idempotencyKey,
  });
  return {
    ledgerEntry: serializeMemberLedgerEntry(inserted),
    creditBalance: await getMemberCreditBalance(env, normalizedUserId),
    grantedCredits: Number(inserted?.amount || 0),
    dailyAllowance: normalizedAllowance,
    dayStart,
    reused: false,
  };
}

export async function assertMemberHasCredits(env, { userId, credits }) {
  const normalizedUserId = normalizeUserId(userId);
  const requiredCredits = normalizePositiveInteger(credits, {
    max: MAX_CREDIT_CONSUME,
    fieldName: "credits",
  });
  const balance = await getMemberCreditBalance(env, normalizedUserId);
  if (balance < requiredCredits) {
    throw new BillingError("Insufficient member credits.", {
      status: 402,
      code: "insufficient_member_credits",
    });
  }
  return { balance, requiredCredits };
}

export async function grantMemberCredits({
  env,
  userId,
  amount,
  createdByUserId,
  idempotencyKey,
  source = "manual_admin_grant",
  reason = null,
  creditBucketType = null,
  bucketScope = null,
  metadata = {},
}) {
  const normalizedUserId = normalizeUserId(userId);
  await getActiveUser(env, normalizedUserId);
  const normalizedAmount = normalizePositiveInteger(amount, {
    max: MAX_CREDIT_GRANT,
    fieldName: "amount",
  });
  const normalizedBucketType = classifyGrantBucketType(source, creditBucketType);
  const scope = bucketScope && typeof bucketScope === "object" && !Array.isArray(bucketScope)
    ? bucketScope
    : {};
  const requestHash = await hashRequest({
    userId: normalizedUserId,
    amount: normalizedAmount,
    source,
    reason: normalizeNullableString(reason),
  });
  const existing = await fetchMemberLedgerByIdempotency(env, {
    userId: normalizedUserId,
    idempotencyKey,
  });
  if (existing) {
    if (existing.request_hash !== requestHash) {
      throw new BillingError("Idempotency-Key conflicts with a different credit grant.", {
        status: 409,
        code: "idempotency_conflict",
      });
    }
    return {
      ledgerEntry: serializeMemberLedgerEntry(existing),
      creditBalance: await getMemberCreditBalance(env, normalizedUserId),
      reused: true,
    };
  }

  const now = nowIso();
  const entryId = ledgerId();
  const grantMetadata = { reason: normalizeNullableString(reason), ...metadata };
  const statements = await prepareMemberCreditBucketReconciliation(env, normalizedUserId, now);
  statements.push(env.DB.prepare(
    `INSERT INTO member_credit_ledger (
       id, user_id, amount, balance_after, entry_type, feature_key,
       source, idempotency_key, request_hash, created_by_user_id, created_at, metadata_json
     ) SELECT ?, ?, CASE WHEN EXISTS (SELECT 1 FROM member_credit_buckets WHERE user_id = ?) THEN ? ELSE NULL END,
       COALESCE((SELECT SUM(balance) FROM member_credit_buckets WHERE user_id = ?), 0) + ?,
       'grant', NULL, ?, ?, ?, ?,
       MAX(?, COALESCE((SELECT created_at FROM member_credit_ledger WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1), '')), ?`
  ).bind(entryId, normalizedUserId, normalizedUserId, normalizedAmount, normalizedUserId, normalizedAmount,
    source, idempotencyKey, requestHash, createdByUserId || null, now, normalizedUserId,
    serializeJsonObject({ ...grantMetadata, credit_bucket: normalizedBucketType, bucket_scope: scope })));
  statements.push(...memberCreditBucketGrantStatements(env, {
    userId: normalizedUserId, ledgerEntryId: entryId, bucketType: normalizedBucketType, source, idempotencyKey,
    localSubscriptionId: scope.localSubscriptionId || scope.local_subscription_id || null,
    providerSubscriptionId: scope.providerSubscriptionId || scope.provider_subscription_id || null,
    periodStart: scope.periodStart || scope.period_start || null,
    periodEnd: scope.periodEnd || scope.period_end || null,
    metadata: grantMetadata, now,
  }));
  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (String(error).includes("UNIQUE")) {
      throw new BillingError("Credit grant conflict.", { status: 409, code: "credit_grant_conflict" });
    }
    throw error;
  }
  const entry = await env.DB.prepare("SELECT * FROM member_credit_ledger WHERE id = ?").bind(entryId).first();
  return { ledgerEntry: serializeMemberLedgerEntry(entry), creditBalance: await getMemberCreditBalance(env, normalizedUserId), reused: false };
}

export async function consumeMemberCredits({
  env,
  userId,
  featureKey,
  quantity = 1,
  credits,
  idempotencyKey = null,
  requestFingerprint = null,
  aiDispatchToken = null,
  metadata = {},
  source = "usage_event",
}) {
  const normalizedUserId = normalizeUserId(userId);
  const feature = normalizeFeatureKey(featureKey);
  const normalizedQuantity = normalizePositiveInteger(quantity, {
    max: MAX_CREDIT_CONSUME,
    fieldName: "quantity",
  });
  const normalizedCredits = normalizePositiveInteger(credits ?? normalizedQuantity, {
    max: MAX_CREDIT_CONSUME,
    fieldName: "credits",
  });
  const requestHash = await buildMemberUsageRequestHash({
    userId: normalizedUserId,
    featureKey: feature,
    quantity: normalizedQuantity,
    credits: normalizedCredits,
    requestFingerprint,
  });
  const normalizedSource = normalizeNullableString(source, 64) || "usage_event";

  if (idempotencyKey) {
    const existingUsage = await fetchMemberUsageByIdempotency(env, {
      userId: normalizedUserId,
      idempotencyKey,
    });
    if (existingUsage) {
      if (existingUsage.request_hash !== requestHash) {
        throw new BillingError("Idempotency-Key conflicts with a different usage request.", {
          status: 409,
          code: "idempotency_conflict",
        });
      }
      const balance = await getMemberCreditBalance(env, normalizedUserId);
      return {
        usageEvent: serializeMemberUsageEvent(existingUsage),
        creditBalance: balance,
        reused: true,
      };
    }
  }

  const bucketRows = (await ensureMemberCreditBuckets(env, normalizedUserId))
    .map((row) => ({ ...row, balance: Number(row.balance || 0) }))
    .filter((row) => row.balance > 0)
    .sort((a, b) => {
      const order = bucketSortOrder(a.bucket_type) - bucketSortOrder(b.bucket_type);
      if (order !== 0) return order;
      return String(a.period_end || a.created_at || "").localeCompare(String(b.period_end || b.created_at || ""));
    });
  let remainingCredits = normalizedCredits;
  const bucketDebits = [];
  for (const row of bucketRows) {
    if (remainingCredits <= 0) break;
    const debit = Math.min(row.balance, remainingCredits);
    if (debit <= 0) continue;
    bucketDebits.push({
      bucketId: row.id,
      bucketType: row.bucket_type,
      amount: debit,
      balanceAfter: row.balance - debit,
    });
    remainingCredits -= debit;
  }
  if (remainingCredits > 0) {
    throw new BillingError("Insufficient member credits.", {
      status: 402,
      code: "insufficient_member_credits",
    });
  }

  const now = nowIso();
  const creditId = ledgerId();
  const usageId = usageEventId();
  const usageMetadata = metadata && typeof metadata === "object" ? metadata : {};
  const ledgerMetadata = {
    quantity: normalizedQuantity,
    credit_bucket_debits: bucketDebits.map((debit) => ({
      bucket_id: debit.bucketId,
      credit_bucket: debit.bucketType,
      amount: debit.amount,
    })),
  };
  const ledgerStatement = env.DB.prepare(
    `INSERT INTO member_credit_ledger (
       id, user_id, amount, balance_after, entry_type, feature_key,
       source, idempotency_key, request_hash, created_by_user_id, created_at, metadata_json, ai_dispatch_token
     )
     SELECT ?, ?, ?, latest.balance_after - ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     FROM (
       SELECT COALESCE((
         SELECT balance_after FROM member_credit_ledger
         WHERE user_id = ?
         ORDER BY created_at DESC, rowid DESC
         LIMIT 1
       ), 0) AS balance_after
     ) AS latest
     WHERE latest.balance_after >= ?`
  ).bind(
    creditId,
    normalizedUserId,
    -normalizedCredits,
    normalizedCredits,
    "consume",
    feature,
    normalizedSource,
    idempotencyKey,
    requestHash,
    userId || null,
    now,
    serializeJsonObject(ledgerMetadata),
    aiDispatchToken,
    normalizedUserId,
    normalizedCredits
  );

  const usage = {
    id: usageId,
    user_id: normalizedUserId,
    feature_key: feature,
    quantity: normalizedQuantity,
    credits_delta: -normalizedCredits,
    credit_ledger_id: creditId,
    request_hash: requestHash,
    status: "recorded",
    created_at: now,
  };

  try {
    // A stale bucket plan must fail its CHECK constraint inside the batch, so
    // the ledger and usage writes roll back with the bucket debit.
    const bucketUpdateStatements = bucketDebits.map((debit) =>
      env.DB.prepare(
        `UPDATE member_credit_buckets
         SET balance = balance - ?, updated_at = ?
         WHERE id = ? AND user_id = ?`
      ).bind(
        debit.amount,
        now,
        debit.bucketId,
        normalizedUserId
      )
    );
    // Read the serialized post-debit balance. A removed bucket yields NULL,
    // which the event's NOT NULL constraint rejects in the same transaction.
    const bucketEventStatements = bucketDebits.map((debit) =>
      env.DB.prepare(
        `INSERT INTO member_credit_bucket_events (
           id, user_id, bucket_id, bucket_type, amount, balance_after,
           member_credit_ledger_id, source, idempotency_key, metadata_json, created_at
         ) VALUES (?, ?, ?, ?, ?,
           (SELECT balance FROM member_credit_buckets WHERE id = ? AND user_id = ?),
           ?, ?, ?, ?, ?)`
      ).bind(
        bucketEventId(),
        normalizedUserId,
        debit.bucketId,
        debit.bucketType,
        -debit.amount,
        debit.bucketId,
        normalizedUserId,
        creditId,
        normalizedSource,
        idempotencyKey ? `${idempotencyKey}:${debit.bucketId}` : null,
        serializeJsonObject({
          ...usageMetadata,
          credit_bucket: debit.bucketType,
          quantity: normalizedQuantity,
        }),
        now
      )
    );
    const usageStatement = env.DB.prepare(
      `INSERT INTO member_usage_events (
         id, user_id, feature_key, quantity, credits_delta,
         credit_ledger_id, idempotency_key, request_hash, status, created_at, metadata_json
       )
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM member_credit_ledger WHERE id = ?)`
    ).bind(
      usage.id,
      usage.user_id,
      usage.feature_key,
      usage.quantity,
      usage.credits_delta,
      usage.credit_ledger_id,
      idempotencyKey,
      usage.request_hash,
      usage.status,
      usage.created_at,
      serializeJsonObject({
        ...usageMetadata,
        credit_bucket_debits: ledgerMetadata.credit_bucket_debits,
      }),
      usage.credit_ledger_id
    );
    const batchResults = await env.DB.batch([
      ledgerStatement,
      ...bucketUpdateStatements,
      ...bucketEventStatements,
      usageStatement,
    ]);
    const ledgerInsert = batchResults[0];
    const bucketUpdates = batchResults.slice(1, 1 + bucketUpdateStatements.length);
    const usageInsert = batchResults.at(-1);
    if (!ledgerInsert?.meta?.changes) {
      throw new BillingError("Insufficient member credits.", {
        status: 402,
        code: "insufficient_member_credits",
      });
    }
    if (bucketUpdates.some((result) => !result?.meta?.changes)) {
      throw new BillingError("Insufficient member credits.", {
        status: 402,
        code: "insufficient_member_credits",
      });
    }
    if (!usageInsert?.meta?.changes) {
      throw new BillingError("Usage event could not be recorded.", {
        status: 503,
        code: "usage_record_failed",
      });
    }
  } catch (error) {
    if (error instanceof BillingError) {
      throw error;
    }
    if (/CHECK constraint failed:\s*balance\s*>=\s*0\b|NOT NULL constraint failed:\s*member_credit_bucket_events\.balance_after\b/i.test(String(error))) {
      throw new BillingError("Insufficient member credits.", {
        status: 402,
        code: "insufficient_member_credits",
      });
    }
    if (String(error).includes("UNIQUE")) {
      throw new BillingError("Usage event conflict.", {
        status: 409,
        code: "usage_event_conflict",
      });
    }
    throw error;
  }

  return {
    usageEvent: serializeMemberUsageEvent(usage),
    creditBalance: await getMemberCreditBalance(env, normalizedUserId),
    reused: false,
  };
}

export async function consumeOrganizationCredits({
  env,
  organizationId,
  userId = null,
  featureKey,
  quantity = 1,
  credits,
  idempotencyKey,
  requestFingerprint = null,
  aiDispatchToken = null,
  metadata = {},
  source = "usage_event",
}) {
  const orgId = normalizeOrgId(organizationId);
  const feature = normalizeFeatureKey(featureKey);
  const normalizedQuantity = normalizePositiveInteger(quantity, {
    max: MAX_CREDIT_CONSUME,
    fieldName: "quantity",
  });
  const normalizedCredits = normalizePositiveInteger(credits ?? normalizedQuantity, {
    max: MAX_CREDIT_CONSUME,
    fieldName: "credits",
  });
  const requestHash = await buildUsageRequestHash({
    organizationId: orgId,
    userId,
    featureKey: feature,
    quantity: normalizedQuantity,
    credits: normalizedCredits,
    requestFingerprint,
  });
  const normalizedSource = normalizeNullableString(source, 64) || "usage_event";

  const existingUsage = await fetchUsageByIdempotency(env, { organizationId: orgId, idempotencyKey });
  if (existingUsage) {
    if (existingUsage.request_hash !== requestHash) {
      throw new BillingError("Idempotency-Key conflicts with a different usage request.", {
        status: 409,
        code: "idempotency_conflict",
      });
    }
    const balance = await getCreditBalance(env, orgId);
    return {
      usageEvent: serializeUsageEvent(existingUsage),
      creditBalance: balance,
      reused: true,
    };
  }

  await assertOrganizationFeatureEnabled(env, { organizationId: orgId, featureKey: feature });

  const now = nowIso();
  const creditId = ledgerId();
  const usageId = usageEventId();
  const ledgerStatement = env.DB.prepare(
    `INSERT INTO credit_ledger (
       id, organization_id, amount, balance_after, entry_type, feature_key,
       source, idempotency_key, request_hash, created_by_user_id, created_at, metadata_json, ai_dispatch_token
     )
     SELECT ?, ?, ?, latest.balance_after - ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     FROM (
       SELECT COALESCE((
         SELECT balance_after FROM credit_ledger
         WHERE organization_id = ?
         ORDER BY created_at DESC, rowid DESC
         LIMIT 1
       ), 0) AS balance_after
     ) AS latest
     WHERE latest.balance_after >= ?`
  ).bind(
    creditId,
    orgId,
    -normalizedCredits,
    normalizedCredits,
    "consume",
    feature,
    normalizedSource,
    idempotencyKey,
    requestHash,
    userId || null,
    now,
    JSON.stringify({ quantity: normalizedQuantity }),
    aiDispatchToken,
    orgId,
    normalizedCredits
  );

  const usage = {
    id: usageId,
    organization_id: orgId,
    user_id: userId || null,
    feature_key: feature,
    quantity: normalizedQuantity,
    credits_delta: -normalizedCredits,
    credit_ledger_id: creditId,
    request_hash: requestHash,
    status: "recorded",
    created_at: now,
  };

  try {
    const usageStatement = env.DB.prepare(
      `INSERT INTO usage_events (
         id, organization_id, user_id, feature_key, quantity, credits_delta,
         credit_ledger_id, idempotency_key, request_hash, status, created_at, metadata_json
       )
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM credit_ledger WHERE id = ?)`
    ).bind(
      usage.id,
      usage.organization_id,
      usage.user_id,
      usage.feature_key,
      usage.quantity,
      usage.credits_delta,
      usage.credit_ledger_id,
      idempotencyKey,
      usage.request_hash,
      usage.status,
      usage.created_at,
      JSON.stringify(metadata && typeof metadata === "object" ? metadata : {}),
      usage.credit_ledger_id
    );
    const [ledgerInsert, usageInsert] = await env.DB.batch([ledgerStatement, usageStatement]);
    if (!ledgerInsert?.meta?.changes) {
      throw new BillingError("Insufficient organization credits.", {
        status: 402,
        code: "insufficient_credits",
      });
    }
    if (!usageInsert?.meta?.changes) {
      throw new BillingError("Usage event could not be recorded.", {
        status: 503,
        code: "usage_record_failed",
      });
    }
  } catch (error) {
    if (error instanceof BillingError) {
      throw error;
    }
    if (String(error).includes("UNIQUE")) {
      throw new BillingError("Usage event conflict.", {
        status: 409,
        code: "usage_event_conflict",
      });
    }
    throw error;
  }

  return {
    usageEvent: serializeUsageEvent(usage),
    creditBalance: await getCreditBalance(env, orgId),
    reused: false,
  };
}

export async function listOrganizationUsage(env, { organizationId, userId, limit = 50 }) {
  const orgId = normalizeOrgId(organizationId);
  await requireOrgMembership(env, { organizationId: orgId, userId });
  const appliedLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const rows = await env.DB.prepare(
    `SELECT id, organization_id, user_id, feature_key, quantity, credits_delta,
            credit_ledger_id, status, created_at
     FROM usage_events
     WHERE organization_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT ?`
  ).bind(orgId, appliedLimit).all();
  return (rows.results || []).map(serializeUsageEvent);
}

export async function requireBillingReader(env, { organizationId, userId }) {
  return requireOrgRole(env, {
    organizationId,
    userId,
    minRole: "admin",
  });
}

async function getMemberSubscriptionByProviderId(env, providerSubscriptionId) {
  const subscriptionId = normalizeNullableString(providerSubscriptionId, 128);
  if (!subscriptionId) return null;
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

export async function upsertMemberSubscriptionFromProvider({
  env,
  userId,
  providerSubscriptionId,
  providerCustomerId = null,
  providerPriceId = null,
  status = "incomplete",
  currentPeriodStart = null,
  currentPeriodEnd = null,
  cancelAtPeriodEnd = false,
  canceledAt = null,
  metadata = {},
}) {
  const normalizedUserId = normalizeUserId(userId);
  await getActiveUser(env, normalizedUserId);
  const subscriptionIdValue = normalizeNullableString(providerSubscriptionId, 128);
  if (!subscriptionIdValue) {
    throw new BillingError("Subscription id is required.", {
      status: 400,
      code: "subscription_id_required",
    });
  }
  const now = nowIso();
  const existing = await getMemberSubscriptionByProviderId(env, subscriptionIdValue);
  const rowId = existing?.id || memberSubscriptionId();
  if (existing && existing.user_id !== normalizedUserId) {
    throw new BillingError("Subscription owner mismatch.", {
      status: 409,
      code: "subscription_owner_mismatch",
    });
  }
  await env.DB.prepare(
    `INSERT INTO billing_member_subscriptions (
       id, user_id, provider, provider_mode, provider_customer_id,
       provider_subscription_id, provider_price_id, status,
       current_period_start, current_period_end, cancel_at_period_end,
       canceled_at, metadata_json, created_at, updated_at
     ) VALUES (?, ?, 'stripe', 'live', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider, provider_mode, provider_subscription_id) DO UPDATE SET
       user_id = excluded.user_id,
       provider_customer_id = COALESCE(excluded.provider_customer_id, billing_member_subscriptions.provider_customer_id),
       provider_price_id = COALESCE(excluded.provider_price_id, billing_member_subscriptions.provider_price_id),
       status = excluded.status,
       current_period_start = COALESCE(excluded.current_period_start, billing_member_subscriptions.current_period_start),
       current_period_end = COALESCE(excluded.current_period_end, billing_member_subscriptions.current_period_end),
       cancel_at_period_end = excluded.cancel_at_period_end,
       canceled_at = COALESCE(excluded.canceled_at, billing_member_subscriptions.canceled_at),
       metadata_json = excluded.metadata_json,
       updated_at = excluded.updated_at`
  ).bind(
    rowId,
    normalizedUserId,
    normalizeNullableString(providerCustomerId, 128),
    subscriptionIdValue,
    normalizeNullableString(providerPriceId, 128),
    normalizeSubscriptionStatus(status),
    normalizeIsoFromStripeTimestamp(currentPeriodStart),
    normalizeIsoFromStripeTimestamp(currentPeriodEnd),
    cancelAtPeriodEnd ? 1 : 0,
    normalizeIsoFromStripeTimestamp(canceledAt),
    serializeJsonObject(metadata),
    existing?.created_at || now,
    now
  ).run();
  const row = await getMemberSubscriptionByProviderId(env, subscriptionIdValue);
  return serializeMemberSubscriptionRow(row);
}

export async function getActiveMemberSubscription(env, userId, { now = nowIso() } = {}) {
  const normalizedUserId = normalizeUserId(userId);
  const rows = await env.DB.prepare(
    `SELECT id, user_id, provider, provider_mode, provider_customer_id,
            provider_subscription_id, provider_price_id, status,
            current_period_start, current_period_end, cancel_at_period_end,
            canceled_at, metadata_json, created_at, updated_at
     FROM billing_member_subscriptions
     WHERE user_id = ?
       AND status IN ('active', 'trialing')
       AND current_period_end IS NOT NULL
       AND current_period_end > ?
     ORDER BY current_period_end DESC, updated_at DESC, id DESC
     LIMIT 1`
  ).bind(normalizedUserId, now).first();
  return serializeMemberSubscriptionRow(rows);
}

export async function getMemberSubscriptionState(env, userId, { now = nowIso() } = {}) {
  const normalizedUserId = normalizeUserId(userId);
  const latest = await env.DB.prepare(
    `SELECT id, user_id, provider, provider_mode, provider_customer_id,
            provider_subscription_id, provider_price_id, status,
            current_period_start, current_period_end, cancel_at_period_end,
            canceled_at, metadata_json, created_at, updated_at
     FROM billing_member_subscriptions
     WHERE user_id = ?
     ORDER BY updated_at DESC, created_at DESC, id DESC
     LIMIT 1`
  ).bind(normalizedUserId).first();
  const active = latest
    && MEMBER_SUBSCRIPTION_ACTIVE_STORAGE_STATUSES.has(latest.status)
    && isFutureIso(latest.current_period_end, now);
  const serialized = serializeMemberSubscriptionRow(latest);
  const cancelAtPeriodEnd = serialized?.cancelAtPeriodEnd === true;
  return {
    subscription: serialized,
    hasActiveSubscription: Boolean(active),
    isSubscribed: Boolean(active),
    subscriptionStatus: latest?.status || "none",
    subscriptionPeriodStart: latest?.current_period_start || null,
    subscriptionPeriodEnd: latest?.current_period_end || null,
    nextTopUpAt: active ? latest.current_period_end : null,
    nextRenewalDate: active && !cancelAtPeriodEnd ? latest.current_period_end : null,
    activeUntil: active ? latest.current_period_end : null,
    cancelAtPeriodEnd,
    canCancelSubscription: Boolean(active && !cancelAtPeriodEnd && serialized?.providerSubscriptionId),
    canReactivateSubscription: Boolean(active && cancelAtPeriodEnd && serialized?.providerSubscriptionId),
    planName: active ? "BITBI Pro" : null,
  };
}

export async function topUpMemberSubscriptionCredits({
  env,
  userId,
  subscriptionId,
  providerSubscriptionId = subscriptionId,
  periodStart,
  periodEnd,
  allowance = MEMBER_SUBSCRIPTION_CREDIT_ALLOWANCE,
  providerEventId = null,
  stripeInvoiceId = null,
}) {
  const normalizedUserId = normalizeUserId(userId);
  await getActiveUser(env, normalizedUserId);
  await ensureMemberCreditBuckets(env, normalizedUserId);
  const normalizedSubscriptionId = normalizeNullableString(providerSubscriptionId || subscriptionId, 128);
  const normalizedPeriodStart = normalizeIsoFromStripeTimestamp(periodStart);
  const normalizedPeriodEnd = normalizeIsoFromStripeTimestamp(periodEnd);
  if (!normalizedSubscriptionId || !normalizedPeriodStart || !normalizedPeriodEnd) {
    throw new BillingError("Subscription period is required.", {
      status: 400,
      code: "subscription_period_required",
    });
  }
  const normalizedAllowance = normalizePositiveInteger(allowance, {
    max: MAX_CREDIT_GRANT,
    fieldName: "allowance",
  });
  const invoiceId = normalizeNullableString(stripeInvoiceId || providerEventId || "unknown", 128) || "unknown";
  const idempotencyKey = `subscription-topup:${normalizedSubscriptionId}:${normalizedPeriodStart}:${invoiceId}`;
  const existing = await fetchMemberLedgerByIdempotency(env, {
    userId: normalizedUserId,
    idempotencyKey,
  });
  if (existing) {
    const existingGrantHash = await hashRequest({
      userId: normalizedUserId,
      amount: Number(existing.amount || 0),
      source: "subscription_period_top_up",
      reason: normalizeNullableString(`subscription:${normalizedSubscriptionId}`),
    });
    if (existing.request_hash !== existingGrantHash) {
      throw new BillingError("Subscription credit top-up conflict.", {
        status: 409,
        code: "idempotency_conflict",
      });
    }
    const buckets = await getMemberCreditBucketBalances(env, normalizedUserId);
    return {
      ledgerEntry: serializeMemberLedgerEntry(existing),
      creditBalance: buckets.totalCredits,
      subscriptionCredits: buckets.subscriptionCredits,
      grantedCredits: 0,
      allowance: normalizedAllowance,
      reused: true,
    };
  }

  const subscriptionRow = await getMemberSubscriptionByProviderId(env, normalizedSubscriptionId);
  const bucketRow = await env.DB.prepare(
    `SELECT id, user_id, bucket_type, balance, local_subscription_id,
            provider_subscription_id, period_start, period_end, source,
            metadata_json, created_at, updated_at
     FROM member_credit_buckets
     WHERE user_id = ?
       AND bucket_type = 'subscription'
       AND provider_subscription_id = ?
       AND period_start = ?
     LIMIT 1`
  ).bind(normalizedUserId, normalizedSubscriptionId, normalizedPeriodStart).first();
  const currentSubscriptionCredits = Number(bucketRow?.balance || 0);
  const grantAmount = Math.max(0, normalizedAllowance - currentSubscriptionCredits);
  if (grantAmount <= 0) {
    const buckets = await getMemberCreditBucketBalances(env, normalizedUserId);
    return {
      ledgerEntry: null,
      creditBalance: buckets.totalCredits,
      subscriptionCredits: buckets.subscriptionCredits,
      grantedCredits: 0,
      allowance: normalizedAllowance,
      reused: false,
    };
  }

  const grant = await grantMemberCredits({
    env,
    userId: normalizedUserId,
    amount: grantAmount,
    createdByUserId: normalizedUserId,
    idempotencyKey,
    source: "subscription_period_top_up",
    reason: `subscription:${normalizedSubscriptionId}`,
    creditBucketType: MEMBER_CREDIT_BUCKET_SUBSCRIPTION,
    bucketScope: {
      localSubscriptionId: subscriptionRow?.id || null,
      providerSubscriptionId: normalizedSubscriptionId,
      periodStart: normalizedPeriodStart,
      periodEnd: normalizedPeriodEnd,
    },
    metadata: {
      provider_event_id: normalizeNullableString(providerEventId, 128),
      stripe_invoice_id: normalizeNullableString(stripeInvoiceId, 128),
      allowance: normalizedAllowance,
      period_start: normalizedPeriodStart,
      period_end: normalizedPeriodEnd,
    },
  });
  const buckets = await getMemberCreditBucketBalances(env, normalizedUserId);
  return {
    ledgerEntry: grant.ledgerEntry,
    creditBalance: buckets.totalCredits,
    subscriptionCredits: buckets.subscriptionCredits,
    grantedCredits: grantAmount,
    allowance: normalizedAllowance,
    reused: grant.reused,
  };
}

export async function listAdminPlans(env) {
  const planRows = await env.DB.prepare(
    "SELECT id, code, name, status, billing_interval, monthly_credit_grant, created_at, updated_at FROM plans ORDER BY code ASC"
  ).all();
  const plans = [];
  for (const row of planRows.results || []) {
    plans.push({
      ...serializePlan(row),
      entitlements: await listPlanEntitlements(env, row.id),
    });
  }
  return plans;
}

export async function getAdminOrganizationBilling(env, { organizationId }) {
  return getOrganizationBillingState(env, { organizationId });
}

export async function getAdminUserBilling(env, { userId }) {
  const user = await getActiveUser(env, userId);
  const dashboard = await getMemberCreditsDashboard({
    env,
    userId: user.id,
    limit: 50,
    applyDailyTopUp: false,
  });
  const creditBalance = Number(dashboard?.balance?.current || 0);
  return {
    userId: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    creditBalance,
    dailyCreditAllowance: MEMBER_DAILY_CREDIT_ALLOWANCE,
    balance: dashboard.balance,
    dailyTopUp: dashboard.dailyTopUp,
    transactions: dashboard.transactions,
  };
}

function memberCreditTypeLabel(row) {
  if (row.source === "daily_member_top_up") return "daily_top_up";
  if (row.source === "manual_admin_grant") return "manual_grant";
  if (row.entry_type === "consume") return "usage_charge";
  return row.entry_type || "credit_activity";
}

function memberCreditDescription(row, usageMetadata = {}) {
  const ledgerMetadata = parseJsonObject(row.metadata_json);
  if (row.source === "daily_member_top_up") {
    const allowance = ledgerMetadata.allowance || MEMBER_DAILY_CREDIT_ALLOWANCE;
    return `Daily member credit top-up to ${allowance} credits`;
  }
  if (row.source === "manual_admin_grant") {
    return ledgerMetadata.reason || "Manual admin credit grant";
  }
  if (row.entry_type === "consume") {
    if (usageMetadata.model) return `Image generation charge for ${usageMetadata.model}`;
    return row.feature_key ? `Usage charge for ${row.feature_key}` : "Credit usage charge";
  }
  return ledgerMetadata.reason || row.source || "Credit activity";
}

function serializeMemberDashboardTransaction(row) {
  const usageMetadata = parseJsonObject(row.usage_metadata_json);
  return {
    id: row.id,
    type: memberCreditTypeLabel(row),
    entryType: row.entry_type,
    source: row.source,
    featureKey: row.feature_key || row.usage_feature_key || null,
    amount: Number(row.amount || 0),
    balanceAfter: Number(row.balance_after || 0),
    createdAt: row.created_at,
    description: memberCreditDescription(row, usageMetadata),
    reason: parseJsonObject(row.metadata_json).reason || null,
    createdByEmail: row.created_by_email || null,
    usage: row.usage_id ? {
      id: row.usage_id,
      featureKey: row.usage_feature_key || row.feature_key || null,
      quantity: Number(row.quantity || 0),
      creditsDelta: Number(row.credits_delta || row.amount || 0),
      status: row.usage_status || null,
      model: usageMetadata.model || null,
      action: usageMetadata.operation || usageMetadata.route || null,
      route: usageMetadata.route || null,
      pricingSource: usageMetadata.pricing_source || null,
      providerCostUsd: Number.isFinite(Number(usageMetadata.provider_cost_usd))
        ? Number(usageMetadata.provider_cost_usd)
        : null,
    } : null,
  };
}

export async function getMemberCreditsDashboard({
  env,
  userId,
  limit = 50,
  applyDailyTopUp = true,
}) {
  const user = await getActiveUser(env, userId);
  const appliedLimit = Math.min(Math.max(Number.parseInt(String(limit || 50), 10) || 50, 1), 100);
  const dailyTopUp = applyDailyTopUp
    ? await topUpMemberDailyCredits({ env, userId: user.id })
    : null;
  const bucketBalances = await getMemberCreditBucketBalances(env, user.id);
  const subscriptionState = await getMemberSubscriptionState(env, user.id);
  const currentBalance = bucketBalances.totalCredits;
  const incomingRow = await env.DB.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS credits
     FROM member_credit_ledger
     WHERE user_id = ?
       AND amount > 0`
  ).bind(user.id).first();
  const topUpRow = await env.DB.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS credits
     FROM member_credit_ledger
     WHERE user_id = ?
       AND source = 'daily_member_top_up'`
  ).bind(user.id).first();
  const manualGrantRow = await env.DB.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS credits
     FROM member_credit_ledger
     WHERE user_id = ?
       AND entry_type = 'grant'
       AND source = 'manual_admin_grant'`
  ).bind(user.id).first();
  const consumedRow = await env.DB.prepare(
    `SELECT COALESCE(SUM(ABS(amount)), 0) AS credits
     FROM member_credit_ledger
     WHERE user_id = ?
       AND entry_type IN ('consume', 'debit')`
  ).bind(user.id).first();
  const transactionRows = await env.DB.prepare(
    `SELECT l.id, l.user_id, l.amount, l.balance_after, l.entry_type,
            l.feature_key, l.source, l.created_by_user_id, actor.email AS created_by_email,
            l.created_at, l.metadata_json,
            u.id AS usage_id, u.feature_key AS usage_feature_key, u.quantity,
            u.credits_delta, u.status AS usage_status, u.metadata_json AS usage_metadata_json
     FROM member_credit_ledger l
     LEFT JOIN member_usage_events u ON u.credit_ledger_id = l.id AND u.user_id = l.user_id
     LEFT JOIN users actor ON actor.id = l.created_by_user_id
     WHERE l.user_id = ?
     ORDER BY l.created_at DESC, l.rowid DESC
     LIMIT ?`
  ).bind(user.id, appliedLimit).all();

  return {
    account: {
      userId: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
    },
    balance: {
      current: currentBalance,
      available: currentBalance,
      totalCredits: currentBalance,
      subscriptionCredits: bucketBalances.subscriptionCredits,
      legacyOrBonusCredits: bucketBalances.legacyOrBonusCredits,
      purchasedCredits: bucketBalances.purchasedCredits,
      dailyAllowance: MEMBER_DAILY_CREDIT_ALLOWANCE,
      lifetimeIncoming: Number(incomingRow?.credits || 0),
      lifetimeDailyTopUps: Number(topUpRow?.credits || 0),
      lifetimeManualGrants: Number(manualGrantRow?.credits || 0),
      lifetimeConsumed: Number(consumedRow?.credits || 0),
    },
    subscription: {
      ...subscriptionState,
      storageLimitBytes: user.role === "admin"
        ? null
        : (subscriptionState.hasActiveSubscription
          ? MEMBER_SUBSCRIPTION_STORAGE_LIMIT_BYTES
          : 50 * 1024 * 1024),
    },
    totalCredits: currentBalance,
    subscriptionCredits: bucketBalances.subscriptionCredits,
    purchasedCredits: bucketBalances.purchasedCredits,
    legacyOrBonusCredits: bucketBalances.legacyOrBonusCredits,
    subscriptionStatus: subscriptionState.subscriptionStatus,
    subscriptionPeriodStart: subscriptionState.subscriptionPeriodStart,
    subscriptionPeriodEnd: subscriptionState.subscriptionPeriodEnd,
    nextTopUpAt: subscriptionState.nextTopUpAt,
    nextRenewalDate: subscriptionState.nextRenewalDate,
    activeUntil: subscriptionState.activeUntil,
    cancelAtPeriodEnd: subscriptionState.cancelAtPeriodEnd,
    canCancelSubscription: subscriptionState.canCancelSubscription,
    canReactivateSubscription: subscriptionState.canReactivateSubscription,
    planName: subscriptionState.planName,
    storageLimitBytes: user.role === "admin"
      ? null
      : (subscriptionState.hasActiveSubscription
        ? MEMBER_SUBSCRIPTION_STORAGE_LIMIT_BYTES
        : 50 * 1024 * 1024),
    isSubscribed: subscriptionState.isSubscribed,
    hasActiveSubscription: subscriptionState.hasActiveSubscription,
    dailyTopUp: dailyTopUp ? {
      dayStart: dailyTopUp.dayStart,
      grantedCredits: dailyTopUp.grantedCredits,
      reused: dailyTopUp.reused,
      dailyAllowance: dailyTopUp.dailyAllowance,
    } : null,
    transactions: (transactionRows.results || []).map(serializeMemberDashboardTransaction),
  };
}

// Pack fulfillment is deliberately separate from generic grants and subscription
// top-ups. The caller appends its checkout/receipt writes to this one D1 batch.
export async function prepareAtomicCreditPackGrant({
  env, userId, organizationId = null, amount, createdByUserId,
  idempotencyKey, source, reason, linkedLedgerEntryId = null, checkoutGuard,
}) {
  if (!checkoutGuard?.sql) throw new BillingError("Checkout guard is required.", { status: 409, code: "checkout_guard_required" });
  const member = organizationId == null;
  const owner = member ? normalizeUserId(userId) : normalizeOrgId(organizationId);
  const credits = normalizePositiveInteger(amount, { max: MAX_CREDIT_GRANT, fieldName: "amount" });
  if (member) await getActiveUser(env, owner);
  const table = member ? "member_credit_ledger" : "credit_ledger";
  const ownerColumn = member ? "user_id" : "organization_id";
  const requestHash = await hashRequest({
    [member ? "userId" : "organizationId"]: owner,
    amount: credits, source, reason: normalizeNullableString(reason),
  });
  // A pre-existing checkout link (including old test-mode event keys) remains
  // authoritative only after its owner, amount and grant hash have matched.
  if (linkedLedgerEntryId) {
    const linked = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(linkedLedgerEntryId).first();
    if (!linked || linked[ownerColumn] !== owner || linked.request_hash !== requestHash || Number(linked.amount) !== credits) {
      throw new BillingError("Checkout credit evidence conflicts with the requested pack.", { status: 409, code: "idempotency_conflict" });
    }
    idempotencyKey = linked.idempotency_key;
  }
  if (!idempotencyKey) throw new BillingError("Checkout credit identity is missing.", { status: 409, code: "idempotency_conflict" });
  const existing = await env.DB.prepare(`SELECT * FROM ${table} WHERE ${ownerColumn} = ? AND idempotency_key = ?`).bind(owner, idempotencyKey).first();
  if (existing && existing.request_hash !== requestHash) {
    throw new BillingError("Idempotency-Key conflicts with a different credit grant.", { status: 409, code: "idempotency_conflict" });
  }
  const now = nowIso();
  const newLedgerId = ledgerId();
  const statements = [];
  const add = (sql, ...bindings) => statements.push(env.DB.prepare(sql).bind(...bindings));
  const latestBalanceSql = `COALESCE((SELECT balance_after FROM ${table} WHERE ${ownerColumn} = ? ORDER BY created_at DESC, rowid DESC LIMIT 1), 0)`;
  let balanceSql = latestBalanceSql;
  let balanceCap = null;
  if (member) {
    statements.push(...await prepareMemberCreditBucketReconciliation(env, owner, now));
    balanceSql = "COALESCE((SELECT SUM(balance) FROM member_credit_buckets WHERE user_id = ?), 0)";
  } else {
    balanceCap = existing ? null : await getBalanceCap(env, owner);
    if (!existing && balanceCap != null && (await getCreditBalance(env, owner)) + credits > balanceCap) {
      throw new BillingError("Credit grant would exceed the organization's balance cap.", { status: 409, code: "credit_balance_cap_exceeded" });
    }
  }
  const eligibility = member
    ? "EXISTS (SELECT 1 FROM member_credit_buckets WHERE user_id = ? AND bucket_type = 'purchased')"
    : `(? IS NULL OR ${balanceSql} + ? <= ?)`;
  const eligibilityBindings = member ? [owner] : [balanceCap, owner, credits, balanceCap];
  // A failed in-transaction eligibility guard deliberately violates amount's
  // NOT NULL constraint: D1 rolls the whole batch back, including bucket seeds.
  add(`INSERT INTO ${table}
       (id, ${ownerColumn}, amount, balance_after, entry_type, feature_key, source, idempotency_key, request_hash, created_by_user_id, created_at, metadata_json)
       SELECT ?, ?, CASE WHEN (${eligibility}) AND (${checkoutGuard.sql}) THEN ? ELSE NULL END, ${balanceSql} + ?, 'grant', NULL, ?, ?, ?, ?, MAX(?, COALESCE((SELECT created_at FROM ${table} WHERE ${ownerColumn} = ? ORDER BY created_at DESC, rowid DESC LIMIT 1), '')), ?
       WHERE NOT EXISTS (SELECT 1 FROM ${table} WHERE ${ownerColumn} = ? AND idempotency_key = ?)`,
    newLedgerId, owner, ...eligibilityBindings, ...checkoutGuard.bindings, credits, owner, credits, source, idempotencyKey, requestHash,
    createdByUserId || null, now, owner,
    serializeJsonObject({ reason: normalizeNullableString(reason), ...(member ? { credit_bucket: "purchased", bucket_scope: {} } : {}) }), owner, idempotencyKey);
  // The preflight hash check is also enforced after concurrent receipts have
  // serialized. No conflicting grant can acquire this checkout's completion.
  add(`UPDATE ${table} SET amount = NULL WHERE ${ownerColumn} = ? AND idempotency_key = ? AND (request_hash IS NULL OR request_hash <> ?)`, owner, idempotencyKey, requestHash);
  add(`UPDATE ${table} SET amount = NULL WHERE ${ownerColumn} = ? AND idempotency_key = ? AND NOT (${checkoutGuard.sql})`, owner, idempotencyKey, ...checkoutGuard.bindings);
  if (member) {
    add(`UPDATE member_credit_buckets SET balance = balance + ?, updated_at = ?
         WHERE user_id = ? AND bucket_type = 'purchased'
           AND EXISTS (SELECT 1 FROM member_credit_ledger WHERE id = ?)`, credits, now, owner, newLedgerId);
    add(`INSERT INTO member_credit_bucket_events
         (id, user_id, bucket_id, bucket_type, amount, balance_after, member_credit_ledger_id, source, idempotency_key, metadata_json, created_at)
         SELECT ?, ?, b.id, 'purchased', ?, b.balance, ?, ?, ?, ?, ?
         FROM member_credit_buckets b WHERE b.user_id = ? AND b.bucket_type = 'purchased'
           AND EXISTS (SELECT 1 FROM member_credit_ledger WHERE id = ?)`,
      bucketEventId(), owner, credits, newLedgerId, source, idempotencyKey,
      serializeJsonObject({ reason: normalizeNullableString(reason) }), now, owner, newLedgerId);
  }
  const ledgerSql = `SELECT id FROM ${table} WHERE ${ownerColumn} = ? AND idempotency_key = ? AND request_hash = ?`;
  const ledgerBindings = [owner, idempotencyKey, requestHash];
  return {
    statements, now, ledgerSql, ledgerBindings, newLedgerId,
    async result() {
      const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = (${ledgerSql})`).bind(...ledgerBindings).first();
      if (!row) throw new BillingError("Checkout credit fulfillment is incomplete.", { status: 503, code: "credit_grant_incomplete" });
      const balance = await env.DB.prepare(`SELECT ${balanceSql} AS balance`).bind(owner).first();
      return {
        ledgerEntry: member ? serializeMemberLedgerEntry(row) : serializeLedgerEntry(row),
        creditBalance: Number(balance?.balance || 0),
        reused: row.id !== newLedgerId,
      };
    },
  };
}
