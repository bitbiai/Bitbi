import { json } from "../../lib/response.js";
import { requireUser } from "../../lib/session.js";
import { nowIso } from "../../lib/tokens.js";

const DAILY_IMAGE_LIMIT = 10; // max successful generations per non-admin user per UTC day

function getQuotaDayStart(ts = nowIso()) {
  return ts.slice(0, 10) + "T00:00:00.000Z";
}

function quotaUnavailableResponse() {
  return json(
    { ok: false, error: "Service temporarily unavailable. Please try again later." },
    { status: 503 }
  );
}

async function getDailyUsage(env, userId, now = nowIso()) {
  const dayStart = getQuotaDayStart(now);
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS cnt
     FROM ai_daily_quota_usage
     WHERE user_id = ?
       AND day_start = ?
       AND (status = 'consumed' OR (status = 'reserved' AND expires_at >= ?))`
  ).bind(userId, dayStart, now).first();
  return row ? row.cnt : 0;
}

export async function handleQuota(ctx) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  if (session.user.role === "admin") {
    return json({ ok: true, data: { isAdmin: true } });
  }

  let usedToday;
  try {
    usedToday = await getDailyUsage(env, session.user.id);
  } catch (e) {
    if (String(e).includes("no such table")) return quotaUnavailableResponse();
    throw e;
  }
  const remaining = Math.max(0, DAILY_IMAGE_LIMIT - usedToday);
  return json({
    ok: true,
    data: {
      isAdmin: false,
      dailyLimit: DAILY_IMAGE_LIMIT,
      usedToday,
      remainingToday: remaining,
    },
  });
}
