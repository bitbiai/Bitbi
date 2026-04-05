import { json } from "../lib/response.js";
import { requireUser } from "../lib/session.js";
import { readJsonBody } from "../lib/request.js";
import { isRateLimited, getClientIp, rateLimitResponse } from "../lib/rate-limit.js";

const VALID_TYPES = ["gallery", "soundlab", "experiments"];
const MAX_FAVORITES = 100;

export async function handleFavorites(ctx) {
  const { pathname, method } = ctx;

  if (pathname === "/api/favorites" && method === "GET") return handleList(ctx);
  if (pathname === "/api/favorites" && method === "POST") return handleAdd(ctx);
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
  if (isRateLimited(`fav:add:${ip}`, 30, 60_000)) return rateLimitResponse();

  const body = await readJsonBody(ctx.request);
  if (!body) return json({ ok: false, error: "Invalid request body." }, { status: 400 });

  const { item_type, item_id, title, thumb_url } = body;

  if (!item_type || !VALID_TYPES.includes(item_type)) {
    return json({ ok: false, error: "Invalid item_type." }, { status: 400 });
  }
  if (!item_id || typeof item_id !== "string" || item_id.length > 100) {
    return json({ ok: false, error: "Invalid item_id." }, { status: 400 });
  }
  if (typeof title !== "string" || title.length > 200) {
    return json({ ok: false, error: "Invalid title." }, { status: 400 });
  }
  if (typeof thumb_url !== "string" || thumb_url.length > 500) {
    return json({ ok: false, error: "Invalid thumb_url." }, { status: 400 });
  }

  // Check limit
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
    .bind(session.user.id, item_type, item_id, title.slice(0, 200), thumb_url.slice(0, 500))
    .run();

  return json({ ok: true });
}

async function handleRemove(ctx) {
  const session = await requireUser(ctx.request, ctx.env);
  if (session instanceof Response) return session;

  const body = await readJsonBody(ctx.request);
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
