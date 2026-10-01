import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { AuthPublicRateLimiterDurableObject } from "../workers/auth/src/lib/public-rate-limiter-do.js";
import {
  ASSISTANT_BUDGET_STORAGE_KEY,
  reserveAssistantBudget, settleAssistantBudget,
} from "../workers/auth/src/lib/website-assistant-budget.js";

const DAY = 86_400_000;
const limits = { dailyMicros: 1000, monthlyMicros: 10_000, dailyRequests: 1000, concurrentRequests: 10, leaseMs: 5000 };

import { storageDouble, harness } from "./helpers/website-assistant-fixture.mjs";

async function clockAt(timestamp, callback) {
  const previous = Date.now;
  let now = new Date(timestamp).getTime();
  Date.now = () => now;
  try { await callback((ms) => { now += ms; }); } finally { Date.now = previous; }
}

test("parallel admission cannot overspend daily cap across isolate callers", async () => {
  const h = harness();
  const admissions = await Promise.all(Array.from({ length: 40 }, () => h.reserve()));
  assert.equal(admissions.filter((x) => x.permitted).length, 10);
  assert.equal(admissions.filter((x) => x.code === "assistant_daily_budget").length, 30);
  const data = await h.storage.get(ASSISTANT_BUDGET_STORAGE_KEY);
  assert.equal(Object.values(data.days)[0].chargedMicros, 1000);
  assert.equal(Object.values(data.days)[0].requests, 10);
});

test("concurrency, daily request and month cap are independent blocking limits", async () => {
  await clockAt("2026-10-01T23:59:00Z", async (advance) => {
    const h = harness();
    const one = { ...limits, dailyRequests: 1, concurrentRequests: 1, monthlyMicros: 1000 };
    assert.equal((await h.reserve({ limits: one })).permitted, true);
    assert.equal((await h.reserve({ limits: { ...one, dailyRequests: 2 } })).code, "assistant_concurrency");
    advance(6000);
    assert.equal((await h.reserve({ limits: one })).code, "assistant_daily_requests");
    advance(60_000);
    assert.equal((await h.reserve({ reservationMicros: 1000, limits: one })).code, "assistant_monthly_budget");
    advance(31 * DAY);
    assert.equal((await h.reserve({ reservationMicros: 1000, limits: one })).permitted, true);
  });
});

test("measured completion refunds the reservation difference once and records anonymous tokens", async () => {
  const h = harness();
  const requestId = randomUUID();
  await h.reserve({ requestId, reservationMicros: 1000 });
  const result = await settleAssistantBudget(h.env, { requestId, outcome: "completed", costMicros: 250,
    usage: { inputTokens: 300, outputTokens: 40 } });
  assert.equal(result.measured, true);
  assert.equal(result.chargedMicros, 250);
  assert.equal((await settleAssistantBudget(h.env, { requestId, outcome: "completed", costMicros: 0,
    usage: { inputTokens: 0, outputTokens: 0 } })).code, "assistant_budget_already_settled");
  const data = await h.storage.get(ASSISTANT_BUDGET_STORAGE_KEY);
  const totals = Object.values(data.days)[0];
  assert.deepEqual(totals, { requests: 1, chargedMicros: 250, measuredMicros: 250, measuredRequests: 1, inputTokens: 300, outputTokens: 40, completed: 1, failed: 0, cancelled: 0, unknown: 0, latencyMs: 0, latencySamples: 0 });
  assert.equal(Object.keys(data.active).length, 0);
  assert.equal((await h.reserve({ reservationMicros: 750 })).permitted, true);
});

test("unknown, cancelled, failed, missing usage and over-reservation usage never refund or release a live lease", async () => {
  await clockAt("2026-10-02T12:00:00Z", async (advance) => {
    for (const detail of [
      { outcome: "unknown" }, { outcome: "cancelled" }, { outcome: "failed" },
      { outcome: "completed", costMicros: 0 },
      { outcome: "completed", costMicros: 101, usage: { inputTokens: 10, outputTokens: 2 } },
      { outcome: "completed", costMicros: 0, usage: { inputTokens: -1, outputTokens: 0 } },
    ]) {
      const h = harness();
      const requestId = randomUUID();
      await h.reserve({ requestId, limits: { ...limits, concurrentRequests: 1 } });
      const result = await settleAssistantBudget(h.env, { requestId, ...detail });
      assert.equal(result.measured, false);
      assert.equal(result.chargedMicros, 100);
      assert.equal((await h.reserve({ limits: { ...limits, concurrentRequests: 1 } })).code, "assistant_concurrency");
      advance(6000);
      await h.object.alarm();
      const data = await h.storage.get(ASSISTANT_BUDGET_STORAGE_KEY);
      assert.equal(Object.values(data.days)[0].chargedMicros, 100);
      assert.equal(Object.keys(data.active).length, 0);
      assert.equal((await h.reserve({ requestId })).code, "assistant_duplicate_request");
    }
  });
});

test("storage reopening retains admitted amounts and abandoned requests across UTC rollover", async () => {
  await clockAt("2026-10-02T23:59:59Z", async (advance) => {
    const h = harness();
    const requestId = randomUUID();
    await h.reserve({ requestId, reservationMicros: 1000 });
    advance(6000);
    const reopened = harness(storageDouble(h.storage.snapshot()));
    assert.equal((await reopened.reserve({ requestId })).code, "assistant_duplicate_request");
    assert.equal((await reopened.reserve()).permitted, true);
    const data = await reopened.storage.get(ASSISTANT_BUDGET_STORAGE_KEY);
    assert.equal(data.days["2026-10-02"].chargedMicros, 1000);
    assert.equal(data.days["2026-10-03"].chargedMicros, 100);
    assert.equal(data.months["2026-10"].chargedMicros, 1100);
  });
});

test("atomic storage failure and malformed remote proof fail closed without leaking exception content", async () => {
  const h = harness();
  h.storage.transaction = async () => { throw new Error("private-storage-diagnostic"); };
  assert.deepEqual(await h.reserve(), { permitted: false, code: "assistant_budget_unavailable" });
  for (const body of [{ permitted: true }, { permitted: true, code: "assistant_budget_settled" }, { permitted: "true", code: "assistant_budget_admitted" }]) {
    const env = { PUBLIC_RATE_LIMITER: { idFromName: () => "isolated", get: () => ({ fetch: async () => Response.json(body) }) } };
    assert.equal((await reserveAssistantBudget(env, { requestId: randomUUID(), reservationMicros: 1, limits })).permitted, false);
  }
  assert.equal((await reserveAssistantBudget({}, { requestId: randomUUID(), reservationMicros: 1, limits })).code, "assistant_budget_unavailable");
});

test("trusted DO boundary validates UUID, integer caps, positive reservation and bounded request body", async () => {
  const h = harness();
  const valid = { requestId: randomUUID(), reservationMicros: 100, limits };
  for (const body of [null, {}, { ...valid, requestId: "arbitrary-user-text" }, { ...valid, reservationMicros: -1 },
    { ...valid, reservationMicros: 1.5 }, { ...valid, limits: { ...limits, monthlyMicros: null } },
    { ...valid, limits: { ...limits, concurrentRequests: 100 } },
    { ...valid, limits: { ...limits, dailyRequests: 1001 } },
    { ...valid, limits: { ...limits, leaseMs: 120_001 } }, { ...valid, ignored: "x".repeat(5000) },
  ]) {
    const result = await h.object.fetch(new Request("https://rate-limit.internal/assistant/reserve", {
      method: "POST", body: JSON.stringify(body),
    }));
    assert.equal(result.status, 400);
  }
  assert.equal(h.storage.snapshot().length, 0);
});

test("metadata retention cleanup is bounded and does not erase monthly charges", async () => {
  await clockAt("2026-10-03T12:00:00Z", async (advance) => {
    const h = harness();
    for (let i = 0; i < 300; i += 1) {
      const requestId = randomUUID();
      assert.equal((await h.reserve({ requestId, reservationMicros: 1 })).permitted, true);
      await settleAssistantBudget(h.env, { requestId, costMicros: 1, usage: { inputTokens: 1, outputTokens: 1 }, outcome: "completed" });
    }
    assert.equal(h.storage.snapshot().length, 301);
    advance(2 * DAY + 1);
    await h.object.alarm();
    assert.equal(h.storage.snapshot().length, 45);
    await h.object.alarm();
    assert.equal(h.storage.snapshot().length, 1);
    assert.equal((await h.storage.get(ASSISTANT_BUDGET_STORAGE_KEY)).months["2026-10"].chargedMicros, 300);
    advance(94 * DAY);
    await h.object.alarm();
    assert.equal(h.storage.snapshot().length, 0);
  });
});

test("assistant alarm leaves ordinary rate-limiter instances on their existing cleanup path", async () => {
  const storage = storageDouble([["count", 5], ["expires_at_ms", Date.now() - 1]]);
  const object = new AuthPublicRateLimiterDurableObject({ storage }, {});
  await object.alarm();
  assert.equal(storage.snapshot().length, 0);
});

test("request metadata has no prompt, IP, account, raw reply or arbitrary submitted keys", async () => {
  const h = harness();
  const result = await h.object.fetch(new Request("https://rate-limit.internal/assistant/reserve", {
    method: "POST", body: JSON.stringify({ requestId: randomUUID(), reservationMicros: 100, limits,
      prompt: "private-message", ip: "private-ip", account: "private-account", reply: "private-reply" }),
  }));
  assert.equal((await result.json()).permitted, true);
  assert.doesNotMatch(JSON.stringify(h.storage.snapshot()), /private-|prompt|account|reply/);
});
