/* ============================================================
   BITBI — User activity logging helper
   Fire-and-forget INSERT into user_activity_log
   ============================================================ */

import { nowIso } from "./tokens.js";

export function logUserActivity(env, userId, action, meta, ip) {
  const id = crypto.randomUUID();
  const now = nowIso();
  return env.DB.prepare(
    `INSERT INTO user_activity_log (id, user_id, action, meta_json, ip_address, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(id, userId, action, meta ? JSON.stringify(meta) : null, ip || null, now)
    .run();
}
