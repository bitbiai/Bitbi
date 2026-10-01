import { randomUUID } from "node:crypto";
import { AuthPublicRateLimiterDurableObject } from "../../workers/auth/src/lib/public-rate-limiter-do.js";
import { ASSISTANT_BUDGET_OBJECT_NAME, reserveAssistantBudget } from "../../workers/auth/src/lib/website-assistant-budget.js";
const limits = { dailyMicros: 1000, monthlyMicros: 10_000, dailyRequests: 1000, concurrentRequests: 10, leaseMs: 5000 };

// A serialized, rollback-capable storage double checks the actual DO fetch
// boundary. Native workerd coverage remains a separate integration requirement.
export function storageDouble(initial = []) {
  let values = new Map(structuredClone(initial));
  let alarm = null;
  let queue = Promise.resolve();
  const operations = (map, clock) => ({
    get: async (key) => structuredClone(map.get(key)),
    put: async (key, value) => { map.set(key, structuredClone(value)); },
    delete: async (key) => map.delete(key),
    deleteAll: async () => map.clear(),
    list: async ({ prefix, limit, startAfter = "" }) => new Map([...map].filter(([key]) => key.startsWith(prefix) && key > startAfter).sort(([a], [b]) => a.localeCompare(b)).slice(0, limit)),
    getAlarm: async () => clock.value,
    setAlarm: async (value) => { clock.value = value; },
    deleteAlarm: async () => { clock.value = null; },
  });
  return {
    get: async (key) => structuredClone(values.get(key)),
    put: async (key, value) => { values.set(key, structuredClone(value)); },
    deleteAll: async () => values.clear(),
    snapshot: () => structuredClone([...values]),
    getAlarm: async () => alarm,
    setAlarm: async (value) => { alarm = value; },
    deleteAlarm: async () => { alarm = null; },
    transaction(callback) {
      const next = queue.then(async () => {
        const staged = new Map(structuredClone([...values]));
        const clock = { value: alarm };
        const result = await callback(operations(staged, clock));
        values = staged;
        alarm = clock.value;
        return result;
      });
      queue = next.catch(() => {});
      return next;
    },
  };
}

export function harness(storage = storageDouble()) {
  const state = { storage };
  const object = new AuthPublicRateLimiterDurableObject(state, {});
  const objects = new Map([[ASSISTANT_BUDGET_OBJECT_NAME, object]]);
  const env = { PUBLIC_RATE_LIMITER: {
    idFromName(name) { return name; },
    get(name) {
      if (!objects.has(name)) objects.set(name, new AuthPublicRateLimiterDurableObject({ storage: storageDouble() }, {}));
      return { fetch: (url, init) => objects.get(name).fetch(new Request(url, init)) };
    },
  } };
  return { env, object, storage, objects, reserve: (options = {}) => reserveAssistantBudget(env, {
    requestId: randomUUID(), reservationMicros: 100, limits, ...options,
  }) };
}
