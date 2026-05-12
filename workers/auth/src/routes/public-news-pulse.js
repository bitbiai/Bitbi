import { json } from "../lib/response.js";
import {
  getNewsPulseItems,
  NEWS_PULSE_CACHE_CONTROL,
  normalizeNewsPulseLocale,
} from "../lib/news-pulse.js";
import {
  isNewsPulseVisualObjectKey,
  NEWS_PULSE_VISUAL_CACHE_CONTROL,
  NEWS_PULSE_VISUAL_ROUTE_PREFIX,
} from "../lib/news-pulse-visuals.js";

function notFound() {
  return json({ ok: false, error: "Not found" }, { status: 404 });
}

function normalizeThumbItemId(pathname) {
  const raw = String(pathname || "").slice(NEWS_PULSE_VISUAL_ROUTE_PREFIX.length);
  if (!raw || raw.includes("/") || raw.length > 180) return null;
  try {
    const decoded = decodeURIComponent(raw);
    if (!/^[A-Za-z0-9._:-]{1,140}$/.test(decoded)) return null;
    return decoded;
  } catch {
    return null;
  }
}

function buildThumbHeaders(object) {
  const headers = new Headers();
  headers.set("Content-Type", object?.httpMetadata?.contentType || "image/webp");
  headers.set("Cache-Control", NEWS_PULSE_VISUAL_CACHE_CONTROL);
  headers.set("X-Content-Type-Options", "nosniff");
  if (Number.isFinite(object?.size) && object.size > 0) {
    headers.set("Content-Length", String(object.size));
  }
  return headers;
}

export async function handlePublicNewsPulse(ctx) {
  const locale = normalizeNewsPulseLocale(ctx.url.searchParams.get("locale"));
  const result = await getNewsPulseItems(ctx.env, locale);
  return json(
    {
      items: result.items,
      updated_at: result.updated_at,
    },
    {
      headers: {
        "cache-control": NEWS_PULSE_CACHE_CONTROL,
      },
    }
  );
}

export async function handlePublicNewsPulseThumb(ctx) {
  if (!ctx?.env?.DB || !ctx.env.USER_IMAGES) return notFound();
  const itemId = normalizeThumbItemId(ctx.pathname);
  if (!itemId) return notFound();

  let row = null;
  try {
    row = await ctx.env.DB.prepare(
      `SELECT visual_object_key
       FROM news_pulse_items
       WHERE id = ?
         AND status = 'active'
         AND visual_status = 'ready'
         AND visual_object_key IS NOT NULL
         AND (expires_at IS NULL OR expires_at > ?)
       LIMIT 1`
    ).bind(itemId, new Date().toISOString()).first();
  } catch {
    return notFound();
  }

  const objectKey = row?.visual_object_key || "";
  if (!isNewsPulseVisualObjectKey(objectKey)) return notFound();

  const object = await ctx.env.USER_IMAGES.get(objectKey);
  if (!object?.body) return notFound();

  return new Response(object.body, {
    status: 200,
    headers: buildThumbHeaders(object),
  });
}
