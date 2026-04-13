import { json } from "../lib/response.js";

const DEFAULT_MEMPICS_LIMIT = 60;
const MAX_MEMPICS_LIMIT = 120;

function toSafeLimit(value) {
  const limit = Number(value);
  if (!Number.isFinite(limit)) return DEFAULT_MEMPICS_LIMIT;
  return Math.min(Math.max(Math.floor(limit), 1), MAX_MEMPICS_LIMIT);
}

function getPublicMempicTitle(id) {
  const shortId = String(id || "").slice(0, 6).toUpperCase();
  return shortId ? `Mempic ${shortId}` : "Mempic";
}

function getPublicMempicCaption(publishedAt) {
  const date = String(publishedAt || "").slice(0, 10);
  if (date) return `Published by a bitbi member on ${date}.`;
  return "Published by a bitbi member.";
}

function toPublicMempicRecord(row) {
  return {
    id: row.id,
    slug: `mempic-${row.id}`,
    title: getPublicMempicTitle(row.id),
    caption: getPublicMempicCaption(row.published_at || row.created_at),
    category: "mempics",
    thumb: {
      url: `/api/gallery/mempics/${row.id}/thumb`,
      w: Number(row.thumb_width) || 320,
      h: Number(row.thumb_height) || 320,
    },
    preview: {
      url: `/api/gallery/mempics/${row.id}/medium`,
      w: Number(row.medium_width) || Number(row.thumb_width) || 1280,
      h: Number(row.medium_height) || Number(row.thumb_height) || 1280,
    },
    full: {
      url: `/api/gallery/mempics/${row.id}/file`,
    },
  };
}

function buildPublicImageHeaders(contentType, size) {
  const headers = new Headers();
  headers.set("Content-Type", contentType || "image/webp");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  if (size) {
    headers.set("Content-Length", String(size));
  }
  return headers;
}

async function handleListMempics(ctx) {
  const { env, url } = ctx;
  const limit = toSafeLimit(url.searchParams.get("limit"));
  const rows = await env.DB.prepare(
    `SELECT id, created_at, published_at, thumb_width, thumb_height, medium_width, medium_height
     FROM ai_images
     WHERE visibility = 'public'
       AND derivatives_status = 'ready'
       AND thumb_key IS NOT NULL
       AND medium_key IS NOT NULL
     ORDER BY COALESCE(published_at, created_at) DESC, created_at DESC, id DESC
     LIMIT ?`
  ).bind(limit).all();

  return json({
    ok: true,
    data: {
      items: (rows.results || []).map((row) => toPublicMempicRecord(row)),
    },
  });
}

async function handleGetMempicFile(ctx, imageId) {
  const { env } = ctx;
  const row = await env.DB.prepare(
    "SELECT r2_key FROM ai_images WHERE id = ? AND visibility = 'public'"
  ).bind(imageId).first();

  if (!row?.r2_key) {
    return json({ ok: false, error: "Image not found." }, { status: 404 });
  }

  const object = await env.USER_IMAGES.get(row.r2_key);
  if (!object) {
    return json({ ok: false, error: "Image not found." }, { status: 404 });
  }

  return new Response(
    object.body,
    {
      headers: buildPublicImageHeaders(
        object.httpMetadata?.contentType || "image/png",
        object.size
      ),
    }
  );
}

async function handleGetMempicDerivative(ctx, imageId, variant) {
  const { env } = ctx;
  const select =
    variant === "thumb"
      ? "SELECT thumb_key AS derivative_key, thumb_mime_type AS mime_type FROM ai_images WHERE id = ? AND visibility = 'public' AND thumb_key IS NOT NULL"
      : "SELECT medium_key AS derivative_key, medium_mime_type AS mime_type FROM ai_images WHERE id = ? AND visibility = 'public' AND medium_key IS NOT NULL";

  const row = await env.DB.prepare(select).bind(imageId).first();
  if (!row?.derivative_key) {
    return json({ ok: false, error: "Image not found." }, { status: 404 });
  }

  const object = await env.USER_IMAGES.get(row.derivative_key);
  if (!object) {
    return json({ ok: false, error: "Image not found." }, { status: 404 });
  }

  return new Response(
    object.body,
    {
      headers: buildPublicImageHeaders(
        row.mime_type || object.httpMetadata?.contentType || "image/webp",
        object.size
      ),
    }
  );
}

export async function handleGallery(ctx) {
  const { pathname, method } = ctx;

  if (pathname === "/api/gallery/mempics" && method === "GET") {
    return handleListMempics(ctx);
  }

  const fileMatch = pathname.match(/^\/api\/gallery\/mempics\/([a-f0-9]+)\/file$/);
  if (fileMatch && method === "GET") {
    return handleGetMempicFile(ctx, fileMatch[1]);
  }

  const thumbMatch = pathname.match(/^\/api\/gallery\/mempics\/([a-f0-9]+)\/thumb$/);
  if (thumbMatch && method === "GET") {
    return handleGetMempicDerivative(ctx, thumbMatch[1], "thumb");
  }

  const mediumMatch = pathname.match(/^\/api\/gallery\/mempics\/([a-f0-9]+)\/medium$/);
  if (mediumMatch && method === "GET") {
    return handleGetMempicDerivative(ctx, mediumMatch[1], "medium");
  }

  return null;
}
