import { nowIso } from "./tokens.js";

// These namespaces belong to application writers. Raw Admin target writes must
// use the same boundary; keys outside it are retained for explicit review.
export function isManagedCleanupKey(key) {
  return typeof key === "string" && /^(users|van-ark-chat)\/.+/.test(key);
}

export function isManagedR2WriteTarget(bucket, key) {
  return bucket === "USER_IMAGES" && isManagedCleanupKey(key);
}

export async function putNewManagedR2Object(env, key, value, options = {}) {
  if (!isManagedCleanupKey(key)) throw new Error("Managed object namespace required.");
  const retired = await env.DB.prepare(
    "SELECT r2_key FROM r2_object_tombstones WHERE r2_key = ?"
  ).bind(key).first();
  if (retired) throw new Error("Object key has been retired.");
  const result = await env.USER_IMAGES.put(key, value, {
    ...options,
    onlyIf: new Headers({ "If-None-Match": "*" }),
  });
  if (result == null) throw new Error("Object key already exists.");
  // A retirement after this precheck is fenced by the database INSERT/UPDATE
  // triggers. No R2/D1 transaction is implied; an unreferenced late PUT can
  // require later orphan cleanup, but cannot reactivate a retired key.
  return result;
}

async function claimCleanup(env, row, now) {
  if (!isManagedCleanupKey(row.r2_key)) {
    await env.DB.prepare(
      "UPDATE r2_cleanup_queue SET status = 'q2_held' WHERE id = ? AND status IN ('q2_pending', 'q2_deleting')"
    ).bind(row.id).run();
    return false;
  }
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO r2_object_tombstones (r2_key, retired_at)
       SELECT q.r2_key, ? FROM r2_cleanup_queue q
       WHERE q.id = ? AND q.status IN ('q2_pending', 'q2_deleting') AND q.attempts < 5
         AND NOT EXISTS (SELECT 1 FROM r2_cleanup_live_references r WHERE r.r2_key = q.r2_key)`
    ).bind(now, row.id),
    env.DB.prepare(
      `UPDATE r2_cleanup_queue SET status = 'q2_deleting'
       WHERE id = ? AND status IN ('q2_pending', 'q2_deleting') AND attempts < 5
         AND EXISTS (SELECT 1 FROM r2_object_tombstones t WHERE t.r2_key = r2_cleanup_queue.r2_key)
       RETURNING id, r2_key`
    ).bind(row.id),
    env.DB.prepare(
      `UPDATE r2_cleanup_queue SET status = 'q2_held'
       WHERE id = ? AND status = 'q2_pending'
         AND NOT EXISTS (SELECT 1 FROM r2_object_tombstones t WHERE t.r2_key = r2_cleanup_queue.r2_key)`
    ).bind(row.id),
  ]);
  return results[1]?.results?.some((claimed) => claimed.id === row.id && claimed.r2_key === row.r2_key) === true;
}

export async function processR2CleanupQueue(env, { keys = null, limit = 50, now = nowIso() } = {}) {
  const requestedKeys = Array.isArray(keys) ? [...new Set(keys.filter(Boolean))] : null;
  if (requestedKeys?.length === 0) return { deleted: 0, failed: 0, held: 0, dead: 0 };
  const summary = { deleted: 0, failed: 0, held: 0, dead: 0 };
  // Inline calls select individual keys to keep each statement below D1's
  // bound-parameter limit. Scheduled calls retain the existing 50-row limit.
  const selections = requestedKeys || [null];
  for (const key of selections) {
    const rows = await env.DB.prepare(
      `SELECT id, r2_key FROM r2_cleanup_queue
       WHERE status IN ('q2_pending', 'q2_deleting') AND attempts < 5
         ${key === null ? "" : "AND r2_key = ?"}
       ORDER BY created_at ASC, id ASC LIMIT ?`
    ).bind(...(key === null ? [] : [key]), Math.min(50, Math.max(1, limit))).all();
    for (const row of rows.results || []) {
      if (!await claimCleanup(env, row, now)) { summary.held += 1; continue; }
      try {
        await env.USER_IMAGES.delete(row.r2_key);
      } catch {
        const failure = await env.DB.prepare(
          `UPDATE r2_cleanup_queue SET attempts = attempts + 1, last_attempt_at = ?,
             status = CASE WHEN attempts + 1 >= 5 THEN 'q2_dead' ELSE 'q2_deleting' END
           WHERE id = ? AND status = 'q2_deleting' RETURNING status`
        ).bind(now, row.id).run();
        summary.failed += 1;
        if (failure.results?.some((result) => result.status === 'q2_dead')) summary.dead += 1;
        continue;
      }
      // Keep the tombstone permanently, including after response loss or a
      // repeated delivery. New references to this key can never be committed.
      await env.DB.prepare(
        "DELETE FROM r2_cleanup_queue WHERE id = ? AND status = 'q2_deleting'"
      ).bind(row.id).run();
      summary.deleted += 1;
    }
  }
  return summary;
}
