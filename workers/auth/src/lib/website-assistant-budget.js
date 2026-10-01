// One strongly consistent, metadata-only budget for the public website assistant.
// This uses a dedicated instance of the existing rate-limiter namespace. It never
// shares counters, transcripts, account identifiers or credit balances with users.
import { ASSISTANT_BUDGET_OBJECT_NAME, ASSISTANT_CONTROL_STORAGE_KEY, readStoredAssistantControl, writeStoredAssistantControl } from './website-assistant-control.js';
export { ASSISTANT_BUDGET_OBJECT_NAME };
export const ASSISTANT_BUDGET_STORAGE_KEY = "website-assistant-budget:v1";
const REQUEST_PREFIX = "website-assistant-request:v1:";
const DAY_MS = 86_400_000;
const RECORD_RETENTION_MS = 2 * DAY_MS;
const METRIC_RETENTION_MS = 93 * DAY_MS;
const CLEANUP_BATCH = 256;
const MAX_BODY_BYTES = 4096;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OUTCOMES = new Set(["completed", "failed", "cancelled", "unknown"]);
const CODES = new Set([
  "assistant_budget_admitted", "assistant_budget_settled", "assistant_budget_already_settled",
  "assistant_duplicate_request", "assistant_daily_budget", "assistant_monthly_budget",
  "assistant_daily_requests", "assistant_concurrency", "assistant_budget_invalid",
  "assistant_budget_unavailable", "assistant_budget_unknown_request", "assistant_control_changed",
]);

const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const period = (now) => ({ day: new Date(now).toISOString().slice(0, 10), month: new Date(now).toISOString().slice(0, 7) });
const response = (body, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const denied = (code) => ({ permitted: false, code });

function validLimits(limits) {
  return limits && integer(limits.dailyMicros, 1, 100_000_000)
    && integer(limits.monthlyMicros, limits.dailyMicros, 1_000_000_000)
    && integer(limits.dailyRequests, 1, 1000)
    && integer(limits.concurrentRequests, 1, 10)
    && integer(limits.leaseMs, 5000, 120_000);
}

function validUsage(usage) {
  return usage && integer(usage.inputTokens, 0, 1_048_576)
    && integer(usage.outputTokens, 0, 16_384);
}

function metric() {
  return { chargedMicros: 0, requests: 0, measuredMicros: 0, measuredRequests: 0, inputTokens: 0, outputTokens: 0, completed: 0, failed: 0, cancelled: 0, unknown: 0, latencyMs: 0, latencySamples: 0 };
}

function ledger(now) {
  return { version: 1, metricsVersion: 2, days: {}, months: {}, active: {}, cleanupAfter: null, lastActivity: now };
}

function assertLedger(data) {
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const nonnegative = value => Number.isSafeInteger(value) && value >= 0;
  if (!object(data) || data.version !== 1 || !object(data.days) || !object(data.months) || !object(data.active) ||
      !nonnegative(data.lastActivity) || (data.metricsVersion !== undefined && data.metricsVersion !== 2) ||
      (data.cleanupAfter !== null && (typeof data.cleanupAfter !== 'string' || !data.cleanupAfter.startsWith(REQUEST_PREFIX)))) throw new Error('assistant_ledger_invalid');
  for (const [collection, pattern] of [[data.days, /^\d{4}-\d{2}-\d{2}$/], [data.months, /^\d{4}-\d{2}$/]]) {
    for (const [key, totals] of Object.entries(collection)) {
      if (!pattern.test(key) || !Number.isFinite(Date.parse(key)) || !object(totals)) throw new Error('assistant_ledger_invalid');
      for (const field of ['chargedMicros', 'requests', 'measuredMicros', 'measuredRequests', 'inputTokens', 'outputTokens']) {
        if (!nonnegative(totals[field])) throw new Error('assistant_ledger_invalid');
      }
      for (const field of ['completed', 'failed', 'cancelled', 'unknown', 'latencyMs', 'latencySamples']) {
        if ((data.metricsVersion === 2 || totals[field] !== undefined) && !nonnegative(totals[field])) throw new Error('assistant_ledger_invalid');
      }
      if (totals.measuredRequests > totals.requests || totals.measuredMicros > totals.chargedMicros) throw new Error('assistant_ledger_invalid');
    }
  }
  for (const [id, expiry] of Object.entries(data.active)) if (!UUID.test(id) || !nonnegative(expiry)) throw new Error('assistant_ledger_invalid');
  for (const key of ['lastSuccessfulInference', 'lastError']) {
    const value = data[key];
    if (value && (!object(value) || !Number.isFinite(Date.parse(value.at)) || !['real', 'synthetic'].includes(value.evidence))) throw new Error('assistant_ledger_invalid');
  }
  return data;
}

function assertEntry(entry) {
  if (!entry || !/^\d{4}-\d{2}-\d{2}$/.test(entry.day) || !/^\d{4}-\d{2}$/.test(entry.month) ||
      !integer(entry.reservationMicros, 1, 100_000_000) || !integer(entry.createdAt, 0, Number.MAX_SAFE_INTEGER) ||
      !integer(entry.expiresAt, entry.createdAt, Number.MAX_SAFE_INTEGER) || typeof entry.settled !== 'boolean') throw new Error('assistant_ledger_invalid');
  return entry;
}

function prune(data, now) {
  for (const [id, expires] of Object.entries(data.active)) if (expires <= now) delete data.active[id];
  const cutoff = now - METRIC_RETENTION_MS;
  for (const key of Object.keys(data.days)) if (Date.parse(key + "T00:00:00Z") <= cutoff) delete data.days[key];
  for (const key of Object.keys(data.months)) if (Date.parse(key + "-01T00:00:00Z") <= cutoff) delete data.months[key];
}

function periods(data, keys) {
  return [data.days[keys.day] ??= metric(), data.months[keys.month] ??= metric()];
}

async function scheduleAlarm(storage, data, now) {
  // The isolated budget instance owns its alarm. Keep an earlier cleanup alarm
  // when another request is admitted; never postpone an outstanding lease expiry.
  const next = Math.min(now + (data.cleanupAfter ? 60_000 : 60 * 60_000), ...Object.values(data.active));
  const current = await storage.getAlarm();
  if (!current || current <= now || next < current) await storage.setAlarm(Math.max(now + 1000, next));
}

async function reserve(storage, body, now) {
  if (!UUID.test(body?.requestId || "") || !validLimits(body?.limits)
      || !integer(body?.reservationMicros, 1, 100_000_000)) return denied("assistant_budget_invalid");
  return storage.transaction(async (txn) => {
    const control = await readStoredAssistantControl(txn);
    // Recheck the exact settings revision at the atomic spend boundary. An
    // already-read public configuration cannot admit after deactivation wins.
    if (body.controlRevision !== undefined && (body.controlRevision !== control.revision ||
        !['public', 'admin'].includes(body.audience) || (body.audience === 'public' ? control.settings.mode !== 'public' : !['admin', 'public'].includes(control.settings.mode)))) return denied("assistant_control_changed");
    const existing = await txn.get(ASSISTANT_BUDGET_STORAGE_KEY);
    const data = existing === undefined ? ledger(now) : existing;
    assertLedger(data);
    prune(data, now);
    if (await txn.get(REQUEST_PREFIX + body.requestId) !== undefined) return denied("assistant_duplicate_request");
    const keys = period(now);
    const [day, month] = periods(data, keys);
    const { limits, reservationMicros } = body;
    if (day.chargedMicros + reservationMicros > limits.dailyMicros) return denied("assistant_daily_budget");
    if (month.chargedMicros + reservationMicros > limits.monthlyMicros) return denied("assistant_monthly_budget");
    if (day.requests >= limits.dailyRequests) return denied("assistant_daily_requests");
    if (Object.keys(data.active).length >= limits.concurrentRequests) return denied("assistant_concurrency");
    for (const totals of [day, month]) {
      totals.chargedMicros += reservationMicros;
      totals.requests += 1;
    }
    const expiresAt = now + limits.leaseMs;
    data.active[body.requestId] = expiresAt;
    data.lastActivity = now;
    await txn.put(REQUEST_PREFIX + body.requestId, {
      ...keys, reservationMicros, createdAt: now, expiresAt, settled: false, model: body.model || null, evidence: body.evidence === "real" ? "real" : "synthetic",
    });
    await txn.put(ASSISTANT_BUDGET_STORAGE_KEY, data);
    await scheduleAlarm(txn, data, now);
    return { permitted: true, code: "assistant_budget_admitted", expiresAt };
  });
}

async function settle(storage, body, now) {
  if (!UUID.test(body?.requestId || "") || !OUTCOMES.has(body?.outcome)) return denied("assistant_budget_invalid");
  return storage.transaction(async (txn) => {
    const data = await txn.get(ASSISTANT_BUDGET_STORAGE_KEY);
    const entry = await txn.get(REQUEST_PREFIX + body.requestId);
    if (data === undefined || entry === undefined) return denied("assistant_budget_unknown_request");
    assertLedger(data); assertEntry(entry);
    if (entry.settled) return { permitted: true, code: "assistant_budget_already_settled" };
    prune(data, now);
    const measured = Boolean(body.outcome === "completed" && validUsage(body.usage)
      && integer(body.costMicros, 0, entry.reservationMicros));
    const chargedMicros = measured ? body.costMicros : entry.reservationMicros;
    // A lost, failed or cancelled inference may still be running. Preserve its
    // concurrency lease and maximum charge; neither retry nor timeout refunds it.
    if (measured) delete data.active[body.requestId];
    for (const totals of periods(data, entry)) {
      totals.chargedMicros -= entry.reservationMicros - chargedMicros;
      totals[body.outcome] = (totals[body.outcome] || 0) + 1;
      if (integer(body.latencyMs, 0, 120000)) {
        totals.latencyMs = (totals.latencyMs || 0) + body.latencyMs;
        totals.latencySamples = (totals.latencySamples || 0) + 1;
      }
      if (measured) {
        totals.measuredMicros += chargedMicros;
        totals.measuredRequests += 1;
        totals.inputTokens += body.usage.inputTokens;
        totals.outputTokens += body.usage.outputTokens;
      }
    }
    entry.settled = true;
    entry.outcome = body.outcome;
    if (body.outcome === 'completed') data.lastSuccessfulInference = { at: new Date(now).toISOString(), model: entry.model, evidence: entry.evidence };
    if (body.outcome !== 'completed') data.lastError = { at: new Date(now).toISOString(), code: body.outcome === 'cancelled' ? 'request_cancelled_or_timeout' : 'provider_error', evidence: entry.evidence };
    entry.chargedMicros = chargedMicros;
    data.lastActivity = now;
    await txn.put(REQUEST_PREFIX + body.requestId, entry);
    await txn.put(ASSISTANT_BUDGET_STORAGE_KEY, data);
    await scheduleAlarm(txn, data, now);
    return { permitted: true, code: "assistant_budget_settled", chargedMicros, measured };
  });
}

async function boundedJson(request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

export async function handleAssistantBudgetRequest(state, request) {
  const pathname = new URL(request.url).pathname;
  if (request.method !== "POST" || !["/assistant/reserve", "/assistant/settle", "/assistant/control-read", "/assistant/control-write", "/assistant/control-restore"].includes(pathname)) {
    return response(denied("assistant_budget_invalid"), 400);
  }
  const storage = state?.storage;
  if (typeof storage?.transaction !== "function") return response(denied("assistant_budget_unavailable"), 503);
  const body = await boundedJson(request);
  try {
    if (pathname.startsWith('/assistant/control-')) {
      if (pathname !== '/assistant/control-read') return response(await writeStoredAssistantControl(storage, body, Date.now(), pathname.endsWith('-restore')));
      const result = await storage.transaction(async txn => {
        const now = Date.now(), keys = period(now), data = await txn.get(ASSISTANT_BUDGET_STORAGE_KEY);
        const control = await readStoredAssistantControl(txn);
        if (data !== undefined) { assertLedger(data); prune(data, now); }
        return { ok: true, control, usage: { observedAt: new Date(now).toISOString(), coverage: 'assistant-provider-requests-only',
          daily: { period: keys.day, ...metric(), ...(data?.days[keys.day] || {}) },
          monthly: { period: keys.month, ...metric(), ...(data?.months[keys.month] || {}) },
          activeRequests: Object.keys(data?.active || {}).length, lastActivity: data?.lastActivity ? new Date(data.lastActivity).toISOString() : null,
          statisticsCoverage: data === undefined || data.metricsVersion === 2 ? 'complete-since-first-request' : 'partial-legacy-metrics',
          providerBilledMicros: null, lastSuccessfulInference: data?.lastSuccessfulInference || null, lastError: data?.lastError || null } };
      });
      return response(result);
    }
    const result = pathname === "/assistant/reserve"
      ? await reserve(storage, body, Date.now()) : await settle(storage, body, Date.now());
    return response(result, result.code === "assistant_budget_invalid" ? 400 : 200);
  } catch {
    // Fail closed and expose no stored metadata or underlying provider errors.
    return response(denied("assistant_budget_unavailable"), 503);
  }
}

export async function runAssistantBudgetAlarm(state) {
  const storage = state?.storage;
  if (await storage?.get(ASSISTANT_BUDGET_STORAGE_KEY) === undefined) {
    if (await storage?.get(ASSISTANT_CONTROL_STORAGE_KEY) === undefined) return false;
    await readStoredAssistantControl(storage);
    await storage.deleteAlarm();
    return true;
  }
  await storage.transaction(async (txn) => {
    const data = await txn.get(ASSISTANT_BUDGET_STORAGE_KEY);
    const now = Date.now();
    assertLedger(data);
    prune(data, now);
    const records = await txn.list({ prefix: REQUEST_PREFIX, limit: CLEANUP_BATCH,
      ...(data.cleanupAfter ? { startAfter: data.cleanupAfter } : {}) });
    for (const [key, entry] of records) {
      assertEntry(entry);
      if (entry.createdAt <= now - RECORD_RETENTION_MS) await txn.delete(key);
    }
    data.cleanupAfter = records.size === CLEANUP_BATCH ? [...records.keys()].at(-1) : null;
    // The spend ledger survives reservation cleanup. Removing an expired lease
    // never removes its charge from the corresponding daily/monthly cap.
    await txn.put(ASSISTANT_BUDGET_STORAGE_KEY, data);
    if (data.lastActivity > now - METRIC_RETENTION_MS || records.size === CLEANUP_BATCH) {
      await scheduleAlarm(txn, data, now);
    } else {
      await txn.delete(ASSISTANT_BUDGET_STORAGE_KEY);
      await txn.deleteAlarm();
    }
  });
  return true;
}

async function callBudget(env, action, body) {
  const namespace = env?.PUBLIC_RATE_LIMITER;
  if (!namespace?.idFromName || !namespace?.get) return denied("assistant_budget_unavailable");
  try {
    const stub = namespace.get(namespace.idFromName(ASSISTANT_BUDGET_OBJECT_NAME));
    const result = await stub.fetch(`https://rate-limit.internal/assistant/${action}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    if (!result.ok) return denied("assistant_budget_unavailable");
    const data = await result.json();
    if (typeof data?.permitted !== "boolean" || !CODES.has(data?.code)) return denied("assistant_budget_unavailable");
    if (data.permitted && (action === "reserve" ? data.code !== "assistant_budget_admitted"
      : !["assistant_budget_settled", "assistant_budget_already_settled"].includes(data.code))) {
      return denied("assistant_budget_unavailable");
    }
    return data;
  } catch {
    return denied("assistant_budget_unavailable");
  }
}

export function reserveAssistantBudget(env, { reservationMicros, limits, requestId, controlRevision, audience, model, evidence }) {
  return callBudget(env, "reserve", { reservationMicros, limits, requestId, controlRevision, audience, model, evidence });
}

export function settleAssistantBudget(env, { requestId, costMicros, usage, outcome, latencyMs }) {
  return callBudget(env, "settle", { requestId, costMicros, usage, outcome, latencyMs });
}
