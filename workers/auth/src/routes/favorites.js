import { json } from "../lib/response.js";
import { requireUser } from "../lib/session.js";
import {
  BODY_LIMITS,
  readJsonBodyOrResponse,
} from "../lib/request.js";
import {
  evaluateSharedRateLimit,
  getClientIp,
  rateLimitResponse,
  rateLimitUnavailableResponse,
  sensitiveRateLimitOptions,
} from "../lib/rate-limit.js";

const VALID_TYPES = ["gallery", "mempics", "soundlab", "video", "experiments"];
const MAX_FAVORITES = 100;
const PUBLIC_FAVORITE_THUMB_ORIGIN = "https://pub.bitbi.ai";

function hasControlChars(value) {
  return /[\x00-\x1f\x7f]/.test(value);
}

function normalizeFavoriteThumbUrl(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (hasControlChars(trimmed)) return null;
  if (trimmed.startsWith("//")) return null;

  if (trimmed.startsWith("/")) {
    if (trimmed.includes("?") || trimmed.includes("#")) return null;
    return trimmed;
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:") return null;
  if (parsed.origin !== PUBLIC_FAVORITE_THUMB_ORIGIN) return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.search || parsed.hash) return null;
  if (!parsed.pathname || parsed.pathname === "/") return null;
  return `${PUBLIC_FAVORITE_THUMB_ORIGIN}${parsed.pathname}`;
}

export async function handleFavorites(ctx) {
  const { pathname, method } = ctx;

  if (pathname === "/api/favorites" && method === "GET") return handleList(ctx);
  // route-policy: favorites.add
  if (pathname === "/api/favorites" && method === "POST") return handleAdd(ctx);
  // route-policy: favorites.remove
  if (pathname === "/api/favorites" && method === "DELETE") return handleRemove(ctx);

  return null;
}

async function handleList(ctx) {
  const session = await requireUser(ctx.request, ctx.env);
  if (session instanceof Response) return session;

  const rows = await ctx.env.DB.prepare(
    "SELECT item_type, item_id, title, thumb_url, created_at FROM favorites WHERE user_id = ? ORDER BY created_at DESC"
  )
    .bind(session.user.id)
    .all();

  return json({ ok: true, favorites: rows.results || [] });
}

async function handleAdd(ctx) {
  const session = await requireUser(ctx.request, ctx.env);
  if (session instanceof Response) return session;

  const ip = getClientIp(ctx.request);
  const limit = await evaluateSharedRateLimit(
    ctx.env,
    "favorites-add-ip",
    ip,
    30,
    60_000,
    sensitiveRateLimitOptions({
      component: "favorites",
      correlationId: ctx.correlationId || null,
      requestInfo: ctx,
    })
  );
  if (limit.unavailable) return rateLimitUnavailableResponse(ctx.correlationId || null);
  if (limit.limited) return rateLimitResponse();

  const parsed = await readJsonBodyOrResponse(ctx.request, { maxBytes: BODY_LIMITS.smallJson });
  if (parsed.response) return parsed.response;
  const body = parsed.body;
  if (!body) return json({ ok: false, error: "Invalid request body." }, { status: 400 });

  const { item_type, item_id, title, thumb_url } = body;
  const normalizedThumbUrl = normalizeFavoriteThumbUrl(thumb_url);

  if (!item_type || !VALID_TYPES.includes(item_type)) {
    return json({ ok: false, error: "Invalid item_type." }, { status: 400 });
  }
  if (!item_id || typeof item_id !== "string" || item_id.length > 100) {
    return json({ ok: false, error: "Invalid item_id." }, { status: 400 });
  }
  if (typeof title !== "string" || title.length > 200) {
    return json({ ok: false, error: "Invalid title." }, { status: 400 });
  }
  if (typeof thumb_url !== "string" || thumb_url.length > 500 || normalizedThumbUrl === null) {
    return json({ ok: false, error: "Invalid thumb_url." }, { status: 400 });
  }

  const existing = await ctx.env.DB.prepare(
    "SELECT 1 AS existing FROM favorites WHERE user_id = ? AND item_type = ? AND item_id = ? LIMIT 1"
  )
    .bind(session.user.id, item_type, item_id)
    .first();

  if (existing) {
    return json({ ok: true });
  }

  // Check limit for new favorites only.
  const count = await ctx.env.DB.prepare(
    "SELECT COUNT(*) AS c FROM favorites WHERE user_id = ?"
  )
    .bind(session.user.id)
    .first();

  if (count && count.c >= MAX_FAVORITES) {
    return json({ ok: false, error: "Favorites limit reached." }, { status: 400 });
  }

  await ctx.env.DB.prepare(
    "INSERT OR IGNORE INTO favorites (user_id, item_type, item_id, title, thumb_url) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(session.user.id, item_type, item_id, title.slice(0, 200), normalizedThumbUrl.slice(0, 500))
    .run();

  return json({ ok: true });
}

async function handleRemove(ctx) {
  const session = await requireUser(ctx.request, ctx.env);
  if (session instanceof Response) return session;

  const ip = getClientIp(ctx.request);
  const limit = await evaluateSharedRateLimit(
    ctx.env,
    "favorites-remove-ip",
    ip,
    60,
    60_000,
    sensitiveRateLimitOptions({
      component: "favorites",
      correlationId: ctx.correlationId || null,
      requestInfo: ctx,
    })
  );
  if (limit.unavailable) return rateLimitUnavailableResponse(ctx.correlationId || null);
  if (limit.limited) return rateLimitResponse();

  const parsed = await readJsonBodyOrResponse(ctx.request, { maxBytes: BODY_LIMITS.smallJson });
  if (parsed.response) return parsed.response;
  const body = parsed.body;
  if (!body) return json({ ok: false, error: "Invalid request body." }, { status: 400 });

  const { item_type, item_id } = body;

  if (!item_type || !VALID_TYPES.includes(item_type)) {
    return json({ ok: false, error: "Invalid item_type." }, { status: 400 });
  }
  if (!item_id || typeof item_id !== "string") {
    return json({ ok: false, error: "Invalid item_id." }, { status: 400 });
  }

  await ctx.env.DB.prepare(
    "DELETE FROM favorites WHERE user_id = ? AND item_type = ? AND item_id = ?"
  )
    .bind(session.user.id, item_type, item_id)
    .run();

  return json({ ok: true });
}
