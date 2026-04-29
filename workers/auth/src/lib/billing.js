import { nowIso, randomTokenHex, sha256Hex } from "./tokens.js";
import { requireOrgMembership, requireOrgRole, normalizeOrgId } from "./orgs.js";

export const BILLING_FEATURES = Object.freeze([
  "ai.text.generate",
  "ai.image.generate",
  "ai.video.generate",
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

async function fetchUsageByIdempotency(env, { organizationId, idempotencyKey }) {
  return env.DB.prepare(
    `SELECT id, organization_id, user_id, feature_key, quantity, credits_delta,
            credit_ledger_id, request_hash, status, created_at
     FROM usage_events
     WHERE organization_id = ? AND idempotency_key = ?
     LIMIT 1`
  ).bind(organizationId, idempotencyKey).first();
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

  const balance = await getCreditBalance(env, orgId);
  const balanceCap = await getBalanceCap(env, orgId);
  const nextBalance = balance + normalizedAmount;
  if (balanceCap != null && nextBalance > balanceCap) {
    throw new BillingError("Credit grant would exceed the organization's balance cap.", {
      status: 409,
      code: "credit_balance_cap_exceeded",
    });
  }

  const now = nowIso();
  const entry = {
    id: ledgerId(),
    organization_id: orgId,
    amount: normalizedAmount,
    balance_after: nextBalance,
    entry_type: "grant",
    feature_key: null,
    source,
    idempotency_key: idempotencyKey,
    request_hash: requestHash,
    created_by_user_id: createdByUserId || null,
    created_at: now,
  };

  try {
    await env.DB.prepare(
      `INSERT INTO credit_ledger (
         id, organization_id, amount, balance_after, entry_type, feature_key,
         source, idempotency_key, request_hash, created_by_user_id, created_at, metadata_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      entry.id,
      entry.organization_id,
      entry.amount,
      entry.balance_after,
      entry.entry_type,
      entry.feature_key,
      entry.source,
      entry.idempotency_key,
      entry.request_hash,
      entry.created_by_user_id,
      entry.created_at,
      JSON.stringify({ reason: normalizeNullableString(reason) })
    ).run();
  } catch (error) {
    if (String(error).includes("UNIQUE")) {
      throw new BillingError("Credit grant conflict.", {
        status: 409,
        code: "credit_grant_conflict",
      });
    }
    throw error;
  }

  return {
    ledgerEntry: serializeLedgerEntry(entry),
    creditBalance: nextBalance,
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
       source, idempotency_key, request_hash, created_by_user_id, created_at, metadata_json
     )
     SELECT ?, ?, ?, latest.balance_after - ?, ?, ?, ?, ?, ?, ?, ?, ?
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
