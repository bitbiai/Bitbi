import { BillingError } from "./billing.js";
import { nowIso, randomTokenHex, sha256Hex } from "./tokens.js";

export const OPERATOR_PURGE_CONFIRMATION = "ICH VERSTEHE: DATENBANK-LÖSCHUNG IST ENDGÜLTIG";

const MAX_REASON_LENGTH = 1000;
const MAX_REFS = 250;
const MAX_ARCHIVE_LIST_LIMIT = 250;
const ITEM_TYPES = new Set([
  "billing_provider_event",
  "billing_review",
  "billing_checkout_session",
  "billing_member_checkout_session",
  "billing_member_subscription_checkout_session",
  "billing_member_subscription",
  "member_credit_ledger",
  "member_credit_bucket",
  "member_credit_bucket_event",
  "member_usage_event",
  "credit_ledger",
  "usage_event",
  "payment_problem",
  "reconciliation_item",
]);

function cleanupId(prefix) {
  return `${prefix}_${randomTokenHex(16)}`;
}

function safeString(value, maxLength = 256) {
  const text = String(value || "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ").trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

function serializeJson(value) {
  return JSON.stringify(value && typeof value === "object" && !Array.isArray(value) ? value : {});
}

function parseJson(value) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeLimit(value, fallback = 100) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) return fallback;
  return Math.min(number, MAX_ARCHIVE_LIST_LIMIT);
}

function normalizeReason(value, { required = true } = {}) {
  const reason = safeString(value, MAX_REASON_LENGTH);
  if (required && !reason) {
    throw new BillingError("Operator reason is required.", {
      status: 400,
      code: "operator_cleanup_reason_required",
    });
  }
  if (reason && /(sk_live_|sk_test_|whsec_|Bearer\s+|__Host-bitbi_session|bitbi_session=|Stripe-Signature|card\s*[:=]|payment_?method\s*[:=]|https:\/\/(?:pay\.bitbi\.ai|billing\.stripe\.com)\/p\/session\/)/i.test(reason)) {
    throw new BillingError("Operator reason must not include secrets, session values, card data, or raw provider links.", {
      status: 400,
      code: "unsafe_operator_cleanup_reason",
    });
  }
  return reason;
}

function normalizeItemType(value) {
  const type = safeString(value, 96);
  if (!type || !ITEM_TYPES.has(type)) return null;
  return type;
}

function normalizeSelectionScope(value, hasRefs) {
  const scope = safeString(value, 96) || (hasRefs ? "selected" : "all_active_self");
  if (!/^[a-z0-9_.:-]{2,96}$/i.test(scope)) {
    throw new BillingError("Operator cleanup selection scope is invalid.", {
      status: 400,
      code: "invalid_operator_cleanup_scope",
    });
  }
  return scope;
}

function sanitizeId(value, maxLength = 160) {
  const text = safeString(value, maxLength);
  if (!text || !/^[A-Za-z0-9._:-]{2,160}$/.test(text)) return null;
  return text;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function collectProblemRefs(body = {}) {
  const refs = [];
  for (const ref of [
    ...toArray(body.itemRefs || body.item_refs),
    ...toArray(body.problemRefs || body.problem_refs),
  ]) {
    if (ref && typeof ref === "object" && !Array.isArray(ref)) refs.push(ref);
  }
  for (const id of toArray(body.ids)) {
    refs.push({ id });
  }
  if (body.itemRef && typeof body.itemRef === "object") refs.push(body.itemRef);
  if (body.problemRef && typeof body.problemRef === "object") refs.push(body.problemRef);
  if (refs.length > MAX_REFS) {
    throw new BillingError("Too many cleanup items were requested.", {
      status: 413,
      code: "operator_cleanup_selection_too_large",
    });
  }
  return refs;
}

async function queryRows(env, sql, bindings = []) {
  const statement = env.DB.prepare(sql);
  const result = bindings.length ? await statement.bind(...bindings).all() : await statement.all();
  return result.results || [];
}

async function queryOne(env, sql, bindings = []) {
  const statement = env.DB.prepare(sql);
  return bindings.length ? await statement.bind(...bindings).first() : await statement.first();
}

function itemKey(item) {
  return `${item.itemType}:${item.itemId}`;
}

function normalizeResolvedItem(item) {
  const itemType = normalizeItemType(item?.itemType || item?.item_type);
  const itemId = sanitizeId(item?.itemId || item?.item_id || item?.id);
  if (!itemType || !itemId) return null;
  return {
    itemType,
    itemId,
    row: item.row || null,
    summary: item.summary || {},
  };
}

function addResolved(map, item) {
  const normalized = normalizeResolvedItem(item);
  if (!normalized) return;
  map.set(itemKey(normalized), normalized);
}

async function addProviderEventById(env, map, id, itemType = "billing_provider_event") {
  const eventId = sanitizeId(id);
  if (!eventId) return;
  const row = await queryOne(env,
    `SELECT id, provider, provider_event_id, provider_account, provider_mode,
            event_type, event_created_at, received_at, processing_status,
            verification_status, payload_hash, payload_summary_json,
            organization_id, user_id, billing_customer_id, error_code,
            error_message, attempt_count, last_processed_at, created_at, updated_at
     FROM billing_provider_events
     WHERE id = ? OR provider_event_id = ?
     LIMIT 1`,
    [eventId, eventId]
  );
  if (!row) return;
  addResolved(map, {
    itemType,
    itemId: row.id,
    row,
    summary: summarizeProviderEvent(row),
  });
}

async function addCheckoutByIdOrSession(env, map, idOrSession) {
  const value = sanitizeId(idOrSession);
  if (!value) return;
  const queries = [
    ["billing_member_checkout_session", `SELECT * FROM billing_member_checkout_sessions WHERE id = ? OR provider_checkout_session_id = ? LIMIT 1`],
    ["billing_checkout_session", `SELECT * FROM billing_checkout_sessions WHERE id = ? OR provider_checkout_session_id = ? LIMIT 1`],
    ["billing_member_subscription_checkout_session", `SELECT * FROM billing_member_subscription_checkout_sessions WHERE id = ? OR provider_checkout_session_id = ? LIMIT 1`],
  ];
  for (const [itemType, sql] of queries) {
    const row = await queryOne(env, sql, [value, value]);
    if (!row) continue;
    addResolved(map, {
      itemType,
      itemId: row.id,
      row,
      summary: summarizeCheckout(row, itemType),
    });
    if (row.billing_event_id) await addProviderEventById(env, map, row.billing_event_id);
  }
}

async function addMemberSubscriptionById(env, map, id) {
  const value = sanitizeId(id);
  if (!value) return;
  const row = await queryOne(env,
    `SELECT * FROM billing_member_subscriptions
     WHERE id = ? OR provider_subscription_id = ?
     LIMIT 1`,
    [value, value]
  );
  if (!row) return;
  addResolved(map, {
    itemType: "billing_member_subscription",
    itemId: row.id,
    row,
    summary: {
      title: "BITBI Pro subscription",
      userId: row.user_id || null,
      providerSubscriptionId: row.provider_subscription_id || null,
      status: row.status || null,
      providerMode: row.provider_mode || null,
    },
  });
}

async function addLedgerById(env, map, id) {
  const value = sanitizeId(id);
  if (!value) return;
  const row = await queryOne(env, `SELECT * FROM member_credit_ledger WHERE id = ? LIMIT 1`, [value]);
  if (!row) return;
  addResolved(map, {
    itemType: "member_credit_ledger",
    itemId: row.id,
    row,
    summary: {
      title: "Member credit ledger",
      userId: row.user_id || null,
      amount: Number(row.amount || 0),
      balanceAfter: Number(row.balance_after || 0),
      source: row.source || null,
    },
  });
}

function summarizeProviderEvent(row) {
  const payloadSummary = parseJson(row.payload_summary_json);
  return {
    title: row.event_type || "billing provider event",
    provider: row.provider || null,
    providerMode: row.provider_mode || null,
    providerEventId: row.provider_event_id || null,
    processingStatus: row.processing_status || null,
    verificationStatus: row.verification_status || null,
    amount: payloadSummary.amount ?? null,
    currency: payloadSummary.currency || null,
    creditPackId: payloadSummary.creditPackId || null,
    checkoutSessionIdPresent: payloadSummary.checkoutSessionIdPresent === true,
    userId: row.user_id || null,
    organizationId: row.organization_id || null,
    createdAt: row.created_at || row.received_at || null,
  };
}

function summarizeCheckout(row, itemType) {
  return {
    title: itemType === "billing_member_subscription_checkout_session"
      ? "BITBI Pro checkout"
      : "Credit-pack checkout",
    provider: row.provider || null,
    providerMode: row.provider_mode || null,
    checkoutId: row.id || null,
    providerCheckoutSessionId: row.provider_checkout_session_id || null,
    providerPaymentIntentId: row.provider_payment_intent_id || null,
    providerSubscriptionId: row.provider_subscription_id || null,
    userId: row.user_id || null,
    organizationId: row.organization_id || null,
    creditPackId: row.credit_pack_id || null,
    credits: Number.isFinite(Number(row.credits)) ? Number(row.credits) : null,
    amountCents: Number.isFinite(Number(row.amount_cents)) ? Number(row.amount_cents) : null,
    currency: row.currency || null,
    status: row.status || null,
    paymentStatus: row.payment_status || null,
    hasLedgerEntry: Boolean(row.member_credit_ledger_entry_id || row.credit_ledger_entry_id),
    billingEventId: row.billing_event_id || null,
    createdAt: row.created_at || null,
  };
}

async function resolveExplicitRefs(env, refs) {
  const map = new Map();
  for (const ref of refs) {
    const explicitType = normalizeItemType(ref.itemType || ref.item_type || ref.type);
    const explicitId = sanitizeId(ref.itemId || ref.item_id || ref.id);
    if (explicitType && explicitId) {
      if (explicitType === "billing_provider_event" || explicitType === "billing_review") {
        await addProviderEventById(env, map, explicitId, explicitType);
      } else if (
        explicitType === "billing_member_checkout_session" ||
        explicitType === "billing_checkout_session" ||
        explicitType === "billing_member_subscription_checkout_session"
      ) {
        await addCheckoutByIdOrSession(env, map, explicitId);
      } else if (explicitType === "billing_member_subscription") {
        await addMemberSubscriptionById(env, map, explicitId);
      } else if (explicitType === "member_credit_ledger") {
        await addLedgerById(env, map, explicitId);
      } else {
        addResolved(map, { itemType: explicitType, itemId: explicitId, summary: { title: explicitType } });
      }
    }

    for (const eventId of [
      ...toArray(ref.eventIds || ref.event_ids),
      ...toArray(ref.reviewIds || ref.review_ids),
      ref.providerEventId || ref.provider_event_id,
      ref.billingEventId || ref.billing_event_id,
    ]) {
      await addProviderEventById(env, map, eventId);
    }
    for (const checkoutId of [
      ref.checkoutId || ref.checkout_id,
      ref.stripeCheckoutSessionId || ref.stripe_checkout_session_id,
      ref.sessionId || ref.session_id,
    ]) {
      await addCheckoutByIdOrSession(env, map, checkoutId);
    }
    for (const subscriptionId of [
      ref.subscriptionId || ref.subscription_id,
      ref.providerSubscriptionId || ref.provider_subscription_id,
    ]) {
      await addMemberSubscriptionById(env, map, subscriptionId);
    }
  }
  return [...map.values()];
}

async function resolveAllActiveSelf(env, userId) {
  const map = new Map();
  const [memberCheckouts, subscriptionCheckouts, subscriptions, providerEvents] = await Promise.all([
    queryRows(env, `SELECT * FROM billing_member_checkout_sessions WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 300`, [userId]),
    queryRows(env, `SELECT * FROM billing_member_subscription_checkout_sessions WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 300`, [userId]),
    queryRows(env, `SELECT * FROM billing_member_subscriptions WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT 300`, [userId]),
    queryRows(env, `SELECT id, provider, provider_event_id, provider_account, provider_mode,
                           event_type, event_created_at, received_at, processing_status,
                           verification_status, payload_hash, payload_summary_json,
                           organization_id, user_id, billing_customer_id, error_code,
                           error_message, attempt_count, last_processed_at, created_at, updated_at
                    FROM billing_provider_events
                    WHERE user_id = ?
                    ORDER BY received_at DESC, id DESC
                    LIMIT 300`, [userId]),
  ]);
  for (const row of memberCheckouts) {
    addResolved(map, { itemType: "billing_member_checkout_session", itemId: row.id, row, summary: summarizeCheckout(row, "billing_member_checkout_session") });
    if (row.billing_event_id) await addProviderEventById(env, map, row.billing_event_id);
  }
  for (const row of subscriptionCheckouts) {
    addResolved(map, { itemType: "billing_member_subscription_checkout_session", itemId: row.id, row, summary: summarizeCheckout(row, "billing_member_subscription_checkout_session") });
    if (row.billing_event_id) await addProviderEventById(env, map, row.billing_event_id);
  }
  for (const row of subscriptions) {
    addResolved(map, {
      itemType: "billing_member_subscription",
      itemId: row.id,
      row,
      summary: {
        title: "BITBI Pro subscription",
        userId: row.user_id,
        providerSubscriptionId: row.provider_subscription_id,
        status: row.status,
        providerMode: row.provider_mode,
      },
    });
  }
  for (const row of providerEvents) {
    addResolved(map, { itemType: "billing_provider_event", itemId: row.id, row, summary: summarizeProviderEvent(row) });
  }
  return [...map.values()];
}

export async function getArchivedBillingItemKeys(env) {
  const rows = await queryRows(env,
    `SELECT item_type, item_id
     FROM billing_operator_item_states
     WHERE state = 'archived'`
  );
  return new Set(rows.map((row) => `${row.item_type}:${row.item_id}`));
}

export function billingItemKey(itemType, itemId) {
  const type = normalizeItemType(itemType);
  const id = sanitizeId(itemId);
  return type && id ? `${type}:${id}` : null;
}

export function isBillingItemKeyArchived(archivedKeys, itemType, itemId) {
  const key = billingItemKey(itemType, itemId);
  return Boolean(key && archivedKeys?.has(key));
}

export function billingProviderEventArchiveItemKeys(eventId) {
  const id = sanitizeId(eventId);
  if (!id) return [];
  return [
    ["billing_provider_event", id],
    ["billing_review", id],
    ["payment_problem", id],
    ["payment_problem", `event-${id}`],
    ["reconciliation_item", id],
    ["reconciliation_item", `event-${id}`],
  ].map(([itemType, itemId]) => billingItemKey(itemType, itemId)).filter(Boolean);
}

export function isBillingProviderEventArchived(archivedKeys, eventId) {
  return billingProviderEventArchiveItemKeys(eventId).some((key) => archivedKeys?.has(key));
}

export async function getBillingArchiveSummary(env) {
  const rows = await queryRows(env,
    `SELECT item_type, COUNT(*) AS count
     FROM billing_operator_item_states
     WHERE state = 'archived'
     GROUP BY item_type
     ORDER BY item_type ASC`
  );
  const byItemType = {};
  let totalArchived = 0;
  for (const row of rows) {
    const itemType = safeString(row.item_type, 96) || "unknown";
    const count = Number(row.count || 0);
    byItemType[itemType] = count;
    totalArchived += count;
  }
  return {
    totalArchived,
    byItemType,
    activeViewsExcludeArchived: true,
    archiveAvailable: true,
    note: "Archived billing records are excluded from active operator counters and remain available in the archive.",
  };
}

async function resolveSelection(env, body, { adminUserId, includeArchived = false } = {}) {
  const refs = collectProblemRefs(body);
  const scope = normalizeSelectionScope(body.selectionScope || body.selection_scope, refs.length > 0);
  let items = refs.length > 0
    ? await resolveExplicitRefs(env, refs)
    : await resolveAllActiveSelf(env, adminUserId);
  if (!includeArchived) {
    const archived = await getArchivedBillingItemKeys(env);
    items = items.filter((item) => !archived.has(itemKey(item)));
  }
  return { items, scope, refs };
}

async function existingRunByIdempotency(env, { userId, runType, idempotencyKey }) {
  if (!idempotencyKey) return null;
  const keyHash = await sha256Hex(`${runType}:${idempotencyKey}`);
  const row = await queryOne(env,
    `SELECT id, run_type, selection_scope, requested_by_user_id, reason, dry_run,
            confirmation, idempotency_key_hash, status, summary_json, created_at, updated_at
     FROM billing_operator_cleanup_runs
     WHERE requested_by_user_id = ? AND idempotency_key_hash = ?
     LIMIT 1`,
    [userId, keyHash]
  );
  return row ? serializeCleanupRun(row) : null;
}

async function insertRun(env, {
  runType,
  selectionScope,
  requestedByUserId,
  reason,
  dryRun,
  confirmation = null,
  idempotencyKey = null,
  status,
  summary,
}) {
  const now = nowIso();
  const keyHash = idempotencyKey ? await sha256Hex(`${runType}:${idempotencyKey}`) : null;
  const id = cleanupId("bocr");
  await env.DB.prepare(
    `INSERT INTO billing_operator_cleanup_runs (
       id, run_type, selection_scope, requested_by_user_id, reason, dry_run,
       confirmation, idempotency_key_hash, status, summary_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    runType,
    selectionScope,
    requestedByUserId,
    reason,
    dryRun ? 1 : 0,
    confirmation,
    keyHash,
    status,
    serializeJson(summary),
    now,
    now
  ).run();
  return {
    id,
    runType,
    selectionScope,
    requestedByUserId,
    reason,
    dryRun: Boolean(dryRun),
    status,
    summary,
    createdAt: now,
    updatedAt: now,
  };
}

async function insertRunItems(env, runId, items, { action, status }) {
  const now = nowIso();
  const statements = items.map((item) => env.DB.prepare(
    `INSERT INTO billing_operator_cleanup_run_items (
       id, run_id, item_type, item_id, action, status, summary_json, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    cleanupId("bocri"),
    runId,
    item.itemType,
    item.itemId,
    action,
    status,
    serializeJson(item.summary || {}),
    now
  ));
  if (statements.length > 0) await env.DB.batch(statements);
}

function serializeCleanupRun(row) {
  return {
    id: row.id,
    runType: row.run_type,
    selectionScope: row.selection_scope,
    requestedByUserId: row.requested_by_user_id || null,
    reason: row.reason || null,
    dryRun: Number(row.dry_run || 0) === 1,
    confirmationPresent: Boolean(row.confirmation),
    status: row.status,
    summary: parseJson(row.summary_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeArchiveRow(row, summary = {}) {
  return {
    id: row.id,
    itemType: row.item_type,
    itemId: row.item_id,
    state: row.state,
    reason: row.reason || null,
    archivedByUserId: row.archived_by_user_id || null,
    archivedAt: row.archived_at,
    restoredByUserId: row.restored_by_user_id || null,
    restoredAt: row.restored_at || null,
    metadata: parseJson(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    summary,
  };
}

async function summarizeArchivedItem(env, row) {
  const itemType = row.item_type;
  const itemId = row.item_id;
  if (itemType === "billing_provider_event" || itemType === "billing_review") {
    const event = await queryOne(env,
      `SELECT id, provider, provider_event_id, provider_account, provider_mode,
              event_type, event_created_at, received_at, processing_status,
              verification_status, payload_hash, payload_summary_json,
              organization_id, user_id, billing_customer_id, error_code,
              error_message, attempt_count, last_processed_at, created_at, updated_at
       FROM billing_provider_events
       WHERE id = ?
       LIMIT 1`,
      [itemId]
    );
    return event ? summarizeProviderEvent(event) : { title: "Archivierter Eintrag", missingOriginal: true };
  }
  if (["billing_member_checkout_session", "billing_checkout_session", "billing_member_subscription_checkout_session"].includes(itemType)) {
    const table = itemType === "billing_member_checkout_session"
      ? "billing_member_checkout_sessions"
      : itemType === "billing_checkout_session"
      ? "billing_checkout_sessions"
      : "billing_member_subscription_checkout_sessions";
    const rowValue = await queryOne(env, `SELECT * FROM ${table} WHERE id = ? LIMIT 1`, [itemId]);
    return rowValue ? summarizeCheckout(rowValue, itemType) : { title: "Archivierter Checkout", missingOriginal: true };
  }
  return parseJson(row.metadata_json)?.summary || { title: itemType };
}

export async function listOperatorBillingArchive(env, {
  limit = 100,
  itemType = null,
  q = null,
  archivedOnly = true,
} = {}) {
  const appliedLimit = normalizeLimit(limit);
  const typeFilter = normalizeItemType(itemType);
  const rows = await queryRows(env,
    `SELECT id, item_type, item_id, state, reason, archived_by_user_id, archived_at,
            restored_by_user_id, restored_at, metadata_json, created_at, updated_at
     FROM billing_operator_item_states
     WHERE (? IS NULL OR item_type = ?)
       AND (? = 0 OR state = 'archived')
     ORDER BY archived_at DESC, id DESC
     LIMIT ?`,
    [typeFilter, typeFilter, archivedOnly ? 1 : 0, appliedLimit]
  );
  const archiveItems = [];
  const query = safeString(q, 128)?.toLowerCase() || "";
  for (const row of rows) {
    const summary = await summarizeArchivedItem(env, row);
    const item = serializeArchiveRow(row, summary);
    if (query) {
      const haystack = JSON.stringify(item).toLowerCase();
      if (!haystack.includes(query)) continue;
    }
    archiveItems.push(item);
  }
  return {
    ok: true,
    archiveItems,
    count: archiveItems.length,
    truncated: rows.length >= appliedLimit,
  };
}

export async function archiveOperatorBillingItems({
  env,
  adminUserId,
  body = {},
  idempotencyKey,
}) {
  const existing = await existingRunByIdempotency(env, { userId: adminUserId, runType: "archive", idempotencyKey });
  if (existing) return { ok: true, reused: true, run: existing, archivedItems: existing.summary?.items || [] };

  const reason = normalizeReason(body.reason);
  const dryRun = body.dryRun === true || body.dry_run === true;
  const { items, scope } = await resolveSelection(env, body, { adminUserId });
  const summaryItems = items.map((item) => ({
    itemType: item.itemType,
    itemId: item.itemId,
    summary: item.summary,
  }));
  const summary = {
    action: "archive",
    dryRun,
    selectedCount: items.length,
    items: summaryItems,
    germanSummary: dryRun
      ? "Trockenlauf: Archivieren würde Einträge nur aus der aktiven Auswertung ausblenden."
      : "Archivieren blendet Einträge aus der aktiven Auswertung aus. Im Archiv bleiben sie erhalten.",
  };
  const run = await insertRun(env, {
    runType: "archive",
    selectionScope: scope,
    requestedByUserId: adminUserId,
    reason,
    dryRun,
    idempotencyKey,
    status: dryRun ? "planned" : "applied",
    summary,
  });
  await insertRunItems(env, run.id, items, { action: "archive", status: dryRun ? "planned" : "applied" });
  if (!dryRun && items.length > 0) {
    const now = nowIso();
    const statements = items.map((item) => env.DB.prepare(
      `INSERT INTO billing_operator_item_states (
         id, item_type, item_id, state, reason, archived_by_user_id, archived_at,
         restored_by_user_id, restored_at, metadata_json, created_at, updated_at
       ) VALUES (?, ?, ?, 'archived', ?, ?, ?, NULL, NULL, ?, ?, ?)
       ON CONFLICT(item_type, item_id) DO UPDATE SET
         state = 'archived',
         reason = excluded.reason,
         archived_by_user_id = excluded.archived_by_user_id,
         archived_at = excluded.archived_at,
         restored_by_user_id = NULL,
         restored_at = NULL,
         metadata_json = excluded.metadata_json,
         updated_at = excluded.updated_at`
    ).bind(
      cleanupId("bois"),
      item.itemType,
      item.itemId,
      reason,
      adminUserId,
      now,
      serializeJson({ summary: item.summary || {}, cleanupRunId: run.id }),
      now,
      now
    ));
    await env.DB.batch(statements);
  }
  return {
    ok: true,
    reused: false,
    run,
    archivedItems: summaryItems,
    dryRun,
  };
}

export async function restoreOperatorBillingItems({
  env,
  adminUserId,
  body = {},
  idempotencyKey,
}) {
  const existing = await existingRunByIdempotency(env, { userId: adminUserId, runType: "restore", idempotencyKey });
  if (existing) return { ok: true, reused: true, run: existing, restoredItems: existing.summary?.items || [] };

  const reason = normalizeReason(body.reason, { required: false }) || "Operator restore";
  const { items, scope } = await resolveSelection(env, body, { adminUserId, includeArchived: true });
  const targetItems = items.length > 0
    ? items
    : (await listOperatorBillingArchive(env, { limit: 250 })).archiveItems.map((item) => ({
      itemType: item.itemType,
      itemId: item.itemId,
      summary: item.summary,
    }));
  const summaryItems = targetItems.map((item) => ({ itemType: item.itemType, itemId: item.itemId, summary: item.summary }));
  const summary = {
    action: "restore",
    selectedCount: summaryItems.length,
    items: summaryItems,
    germanSummary: "Wiederherstellen macht archivierte Einträge wieder in aktiven Auswertungen sichtbar.",
  };
  const run = await insertRun(env, {
    runType: "restore",
    selectionScope: scope,
    requestedByUserId: adminUserId,
    reason,
    dryRun: false,
    idempotencyKey,
    status: "applied",
    summary,
  });
  await insertRunItems(env, run.id, targetItems, { action: "restore", status: "applied" });
  if (targetItems.length > 0) {
    await env.DB.batch(targetItems.map((item) => env.DB.prepare(
      `DELETE FROM billing_operator_item_states
       WHERE item_type = ? AND item_id = ?`
    ).bind(item.itemType, item.itemId)));
  }
  return {
    ok: true,
    reused: false,
    run,
    restoredItems: summaryItems,
  };
}

function makePlanItem(item, { action, status = "planned", reason = null, table = null, tombstone = null } = {}) {
  return {
    itemType: item.itemType,
    itemId: item.itemId,
    action,
    status,
    table,
    reason,
    tombstone,
    summary: item.summary || {},
  };
}

function checkoutHasLedger(row = {}) {
  return Boolean(row.member_credit_ledger_entry_id || row.credit_ledger_entry_id);
}

function checkoutLooksPaidOrCompleted(row = {}) {
  return row.status === "completed" ||
    String(row.payment_status || "").toLowerCase() === "paid" ||
    Boolean(row.completed_at || row.granted_at);
}

function analyzePurgeItem(item) {
  const row = item.row || {};
  if (["member_credit_ledger", "member_credit_bucket", "member_credit_bucket_event", "member_usage_event", "credit_ledger", "usage_event", "billing_member_subscription"].includes(item.itemType)) {
    return [makePlanItem(item, {
      action: "blocked",
      status: "blocked",
      reason: "Ledger-, Bucket-, Usage- und aktive Subscription-Zeilen werden nicht hart gelöscht, weil laufende Salden oder Mitgliedschaftszustände inkonsistent werden könnten. Bitte archivieren.",
    })];
  }
  if (["billing_member_checkout_session", "billing_checkout_session"].includes(item.itemType)) {
    if (checkoutHasLedger(row) || checkoutLooksPaidOrCompleted(row)) {
      return [makePlanItem(item, {
        action: "blocked",
        status: "blocked",
        reason: "Dieser Checkout ist bezahlt, abgeschlossen oder ledger-verknüpft. Hard-Delete ist blockiert; archivieren ist die sichere Option.",
      })];
    }
    return [makePlanItem(item, {
      action: "delete",
      table: item.itemType === "billing_member_checkout_session" ? "billing_member_checkout_sessions" : "billing_checkout_sessions",
      tombstone: tombstoneForCheckout(item),
    })];
  }
  if (item.itemType === "billing_member_subscription_checkout_session") {
    if (checkoutLooksPaidOrCompleted(row) || row.provider_subscription_id) {
      return [makePlanItem(item, {
        action: "blocked",
        status: "blocked",
        reason: "Subscription-Checkout ist mit einem Abo oder Zahlungssignal verknüpft. Hard-Delete ist blockiert; archivieren ist die sichere Option.",
      })];
    }
    return [makePlanItem(item, {
      action: "delete",
      table: "billing_member_subscription_checkout_sessions",
      tombstone: tombstoneForCheckout(item),
    })];
  }
  if (item.itemType === "billing_review") {
    return [makePlanItem(item, {
      action: "delete",
      table: "billing_event_actions",
      tombstone: {
        tombstoneType: "billing_review",
        originalItemType: item.itemType,
        originalItemId: item.itemId,
        provider: row.provider || null,
        providerMode: row.provider_mode || row.providerMode || null,
        providerEventId: row.provider_event_id || row.providerEventId || null,
        payloadHash: row.payload_hash || null,
      },
    })];
  }
  if (item.itemType === "billing_provider_event") {
    if (row.processing_status === "planned" && /checkout\.session\.completed/.test(row.event_type || "")) {
      return [makePlanItem(item, {
        action: "blocked",
        status: "blocked",
        reason: "Checkout-Webhook-Events mit möglicher Gutschrift werden nicht direkt hart gelöscht. Bitte erst Checkout-/Ledger-Verknüpfungen prüfen oder archivieren.",
      })];
    }
    return [makePlanItem(item, {
      action: "delete",
      table: "billing_provider_events",
      tombstone: {
        tombstoneType: "provider_event",
        provider: row.provider || null,
        providerMode: row.provider_mode || null,
        providerEventId: row.provider_event_id || null,
        originalItemType: item.itemType,
        originalItemId: item.itemId,
        payloadHash: row.payload_hash || null,
      },
    })];
  }
  return [makePlanItem(item, {
    action: "blocked",
    status: "blocked",
    reason: "Dieser Eintrag kann nicht sicher hart gelöscht werden. Bitte archivieren.",
  })];
}

function tombstoneForCheckout(item) {
  const row = item.row || {};
  return {
    tombstoneType: "checkout_session",
    provider: row.provider || null,
    providerMode: row.provider_mode || null,
    providerCheckoutSessionId: row.provider_checkout_session_id || null,
    providerPaymentIntentId: row.provider_payment_intent_id || null,
    providerSubscriptionId: row.provider_subscription_id || null,
    originalItemType: item.itemType,
    originalItemId: item.itemId,
  };
}

async function buildPurgePreview(env, body, { adminUserId }) {
  const { items, scope } = await resolveSelection(env, body, { adminUserId, includeArchived: true });
  const planItems = [];
  for (const item of items) {
    planItems.push(...analyzePurgeItem(item));
  }
  const blockedItems = planItems.filter((item) => item.status === "blocked");
  const deleteItems = planItems.filter((item) => item.action === "delete");
  const tombstoneItems = deleteItems.filter((item) => item.tombstone);
  const summary = {
    action: "purge_preview",
    selectionScope: scope,
    selectedCount: items.length,
    plannedDeleteCount: deleteItems.length,
    plannedTombstoneCount: tombstoneItems.length,
    blockedCount: blockedItems.length,
    canApply: deleteItems.length > 0 && blockedItems.length === 0,
    germanSummary: blockedItems.length > 0
      ? "Die Datenbank-Löschung ist für mindestens einen Eintrag blockiert. Archivieren bleibt verfügbar."
      : "Die Vorschau löscht noch nichts. Anwenden erfordert Exportbestätigung und den exakten Bestätigungssatz.",
    plannedItems: planItems,
    safety: {
      dryRunOnly: true,
      stripeMutation: false,
      creditMutation: false,
      ledgerBalanceRewrite: false,
      blockedLedgerLinkedDeletes: blockedItems.length > 0,
    },
  };
  const previewHash = await sha256Hex(JSON.stringify({
    selectionScope: scope,
    plannedItems: planItems.map((item) => ({
      itemType: item.itemType,
      itemId: item.itemId,
      action: item.action,
      status: item.status,
      table: item.table || null,
    })),
  }));
  return { items, scope, planItems, summary: { ...summary, previewHash }, previewHash };
}

export async function previewOperatorBillingPurge({
  env,
  adminUserId,
  body = {},
  idempotencyKey,
}) {
  const existing = await existingRunByIdempotency(env, { userId: adminUserId, runType: "purge_preview", idempotencyKey });
  if (existing) return { ok: true, reused: true, run: existing, preview: existing.summary };
  const reason = normalizeReason(body.reason);
  const preview = await buildPurgePreview(env, body, { adminUserId });
  const run = await insertRun(env, {
    runType: "purge_preview",
    selectionScope: preview.scope,
    requestedByUserId: adminUserId,
    reason,
    dryRun: true,
    idempotencyKey,
    status: preview.summary.canApply ? "planned" : "blocked",
    summary: preview.summary,
  });
  await insertRunItems(env, run.id, preview.planItems.map((item) => ({ ...item, summary: item.summary })), {
    action: "delete",
    status: "planned",
  });
  return {
    ok: true,
    reused: false,
    run,
    preview: preview.summary,
  };
}

export async function applyOperatorBillingPurge({
  env,
  adminUserId,
  body = {},
  idempotencyKey,
}) {
  const existing = await existingRunByIdempotency(env, { userId: adminUserId, runType: "purge_apply", idempotencyKey });
  if (existing) return { ok: true, reused: true, run: existing, result: existing.summary };
  const reason = normalizeReason(body.reason);
  if (body.exportEvidenceAcknowledged !== true && body.export_evidence_acknowledged !== true) {
    throw new BillingError("Export evidence acknowledgement is required before database deletion.", {
      status: 400,
      code: "operator_cleanup_export_ack_required",
    });
  }
  const confirmation = safeString(body.confirmation, 128);
  if (confirmation !== OPERATOR_PURGE_CONFIRMATION) {
    throw new BillingError("Exact database deletion confirmation is required.", {
      status: 400,
      code: "operator_cleanup_confirmation_required",
    });
  }
  const suppliedPreviewHash = safeString(body.previewHash || body.preview_hash, 128);
  if (!suppliedPreviewHash) {
    throw new BillingError("A current purge preview hash is required.", {
      status: 400,
      code: "operator_cleanup_preview_hash_required",
    });
  }
  const preview = await buildPurgePreview(env, body, { adminUserId });
  if (preview.previewHash !== suppliedPreviewHash) {
    throw new BillingError("The purge preview no longer matches the current selection.", {
      status: 409,
      code: "operator_cleanup_preview_mismatch",
    });
  }
  if (!preview.summary.canApply) {
    const run = await insertRun(env, {
      runType: "purge_apply",
      selectionScope: preview.scope,
      requestedByUserId: adminUserId,
      reason,
      dryRun: false,
      confirmation,
      idempotencyKey,
      status: "blocked",
      summary: preview.summary,
    });
    await insertRunItems(env, run.id, preview.planItems.map((item) => ({ ...item, summary: item.summary })), {
      action: "blocked",
      status: "blocked",
    });
    throw new BillingError("Database deletion is blocked for this selection. Archive remains available.", {
      status: 409,
      code: "operator_cleanup_purge_blocked",
    });
  }

  const now = nowIso();
  const runId = cleanupId("bocr");
  const keyHash = idempotencyKey ? await sha256Hex(`purge_apply:${idempotencyKey}`) : null;
  const deleteItems = preview.planItems.filter((item) => item.action === "delete");
  const statements = [
    env.DB.prepare(
      `INSERT INTO billing_operator_cleanup_runs (
         id, run_type, selection_scope, requested_by_user_id, reason, dry_run,
         confirmation, idempotency_key_hash, status, summary_json, created_at, updated_at
       ) VALUES (?, 'purge_apply', ?, ?, ?, 0, ?, ?, 'applied', ?, ?, ?)`
    ).bind(runId, preview.scope, adminUserId, reason, confirmation, keyHash, serializeJson(preview.summary), now, now),
  ];
  for (const item of deleteItems) {
    statements.push(env.DB.prepare(
      `INSERT INTO billing_operator_cleanup_run_items (
         id, run_id, item_type, item_id, action, status, summary_json, created_at
       ) VALUES (?, ?, ?, ?, 'delete', 'applied', ?, ?)`
    ).bind(cleanupId("bocri"), runId, item.itemType, item.itemId, serializeJson(item.summary || {}), now));
    if (item.tombstone) {
      statements.push(tombstoneStatement(env, item.tombstone, { adminUserId, reason, now }));
    }
  }
  for (const item of deleteItems.filter((entry) => entry.table === "billing_event_actions")) {
    statements.push(env.DB.prepare(`DELETE FROM billing_event_actions WHERE event_id = ?`).bind(item.itemId));
  }
  for (const item of deleteItems.filter((entry) => entry.table === "billing_member_checkout_sessions")) {
    statements.push(env.DB.prepare(`DELETE FROM billing_member_checkout_sessions WHERE id = ?`).bind(item.itemId));
  }
  for (const item of deleteItems.filter((entry) => entry.table === "billing_checkout_sessions")) {
    statements.push(env.DB.prepare(`DELETE FROM billing_checkout_sessions WHERE id = ?`).bind(item.itemId));
  }
  for (const item of deleteItems.filter((entry) => entry.table === "billing_member_subscription_checkout_sessions")) {
    statements.push(env.DB.prepare(`DELETE FROM billing_member_subscription_checkout_sessions WHERE id = ?`).bind(item.itemId));
  }
  for (const item of deleteItems.filter((entry) => entry.table === "billing_provider_events")) {
    statements.push(env.DB.prepare(`DELETE FROM billing_event_actions WHERE event_id = ?`).bind(item.itemId));
    statements.push(env.DB.prepare(`DELETE FROM billing_provider_events WHERE id = ?`).bind(item.itemId));
  }
  for (const item of deleteItems) {
    statements.push(env.DB.prepare(
      `DELETE FROM billing_operator_item_states WHERE item_type = ? AND item_id = ?`
    ).bind(item.itemType, item.itemId));
  }
  await env.DB.batch(statements);
  const result = {
    ...preview.summary,
    appliedAt: now,
    deletedCount: deleteItems.length,
    tombstonesCreated: deleteItems.filter((item) => item.tombstone).length,
    germanSummary: "Datenbank-Reset wurde nur für sichere, nicht ledger-gekoppelte Einträge angewendet. Stripe wurde nicht verändert.",
  };
  return {
    ok: true,
    reused: false,
    run: {
      id: runId,
      runType: "purge_apply",
      selectionScope: preview.scope,
      requestedByUserId: adminUserId,
      reason,
      dryRun: false,
      status: "applied",
      summary: result,
      createdAt: now,
      updatedAt: now,
    },
    result,
  };
}

function tombstoneStatement(env, tombstone, { adminUserId, reason, now }) {
  return env.DB.prepare(
    `INSERT OR IGNORE INTO billing_operator_purge_tombstones (
       id, tombstone_type, provider, provider_mode, provider_event_id,
       provider_checkout_session_id, provider_payment_intent_id,
       provider_subscription_id, original_item_type, original_item_id,
       payload_hash, reason, purged_by_user_id, purged_at,
       metadata_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    cleanupId("bopt"),
    tombstone.tombstoneType,
    tombstone.provider || null,
    tombstone.providerMode || null,
    tombstone.providerEventId || null,
    tombstone.providerCheckoutSessionId || null,
    tombstone.providerPaymentIntentId || null,
    tombstone.providerSubscriptionId || null,
    tombstone.originalItemType || null,
    tombstone.originalItemId || null,
    tombstone.payloadHash || null,
    reason,
    adminUserId,
    now,
    serializeJson({ source: "operator_billing_cleanup" }),
    now,
    now
  );
}

export async function findOperatorBillingPurgeTombstoneForProviderEvent(env, {
  provider,
  providerMode,
  providerEventId,
  providerCheckoutSessionId = null,
  providerPaymentIntentId = null,
  providerSubscriptionId = null,
}) {
  const row = await queryOne(env,
    `SELECT id, tombstone_type, provider, provider_mode, provider_event_id,
            provider_checkout_session_id, provider_payment_intent_id,
            provider_subscription_id, original_item_type, original_item_id,
            payload_hash, reason, purged_by_user_id, purged_at,
            metadata_json, created_at, updated_at
     FROM billing_operator_purge_tombstones
     WHERE (provider = ? AND provider_event_id = ?)
        OR (provider = ? AND provider_mode = ? AND provider_checkout_session_id IS NOT NULL AND provider_checkout_session_id = ?)
        OR (provider = ? AND provider_mode = ? AND provider_payment_intent_id IS NOT NULL AND provider_payment_intent_id = ?)
        OR (provider = ? AND provider_mode = ? AND provider_subscription_id IS NOT NULL AND provider_subscription_id = ?)
     ORDER BY purged_at DESC, id DESC
     LIMIT 1`,
    [
      provider,
      providerEventId,
      provider,
      providerMode,
      providerCheckoutSessionId,
      provider,
      providerMode,
      providerPaymentIntentId,
      provider,
      providerMode,
      providerSubscriptionId,
    ]
  );
  if (!row) return null;
  return {
    id: row.id,
    tombstoneType: row.tombstone_type,
    provider: row.provider || null,
    providerMode: row.provider_mode || null,
    providerEventId: row.provider_event_id || null,
    providerCheckoutSessionId: row.provider_checkout_session_id || null,
    providerPaymentIntentId: row.provider_payment_intent_id || null,
    providerSubscriptionId: row.provider_subscription_id || null,
    originalItemType: row.original_item_type || null,
    originalItemId: row.original_item_id || null,
    purgedAt: row.purged_at,
    reason: row.reason || null,
  };
}
