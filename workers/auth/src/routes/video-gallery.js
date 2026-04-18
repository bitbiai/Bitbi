import { json } from "../lib/response.js";

const DEFAULT_MEMVIDS_LIMIT = 60;
const MAX_MEMVIDS_LIMIT = 120;

function toSafeLimit(value) {
  const limit = Number(value);
  if (!Number.isFinite(limit)) return DEFAULT_MEMVIDS_LIMIT;
  return Math.min(Math.max(Math.floor(limit), 1), MAX_MEMVIDS_LIMIT);
}

function getPublicMemvidOwnerLabel(displayName) {
  const normalized = String(displayName || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 50);
  return normalized || "a bitbi member";
}

function getPublicMemvidCaption(displayName, publishedAt) {
  const ownerLabel = getPublicMemvidOwnerLabel(displayName);
  const date = String(publishedAt || "").slice(0, 10);
  if (date) return `Published by ${ownerLabel} on ${date}.`;
  return `Published by ${ownerLabel}.`;
}

function toPublicMemvidRecord(row) {
  const meta = parseMetadataJson(row.metadata_json);
  return {
    id: row.id,
    slug: `memvid-${row.id}`,
    title: row.title || "Memvids",
    caption: getPublicMemvidCaption(row.owner_display_name, row.published_at || row.created_at),
    category: "memvids",
    mime_type: row.mime_type || "video/mp4",
    file: {
      url: `/api/gallery/memvids/${row.id}/file`,
    },
    duration_seconds: meta.duration_seconds ?? null,
  };
}

function parseMetadataJson(raw) {
  if (!raw || raw === "{}") return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function buildPublicVideoHeaders(contentType, size) {
  const headers = new Headers();
  headers.set("Content-Type", contentType || "video/mp4");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  if (size) {
    headers.set("Content-Length", String(size));
  }
  return headers;
}

async function handleListMemvids(ctx) {
  const { env, url } = ctx;
  const limit = toSafeLimit(url.searchParams.get("limit"));
  const rows = await env.DB.prepare(
    `SELECT ai_text_assets.id,
            ai_text_assets.title,
            ai_text_assets.mime_type,
            ai_text_assets.metadata_json,
            ai_text_assets.created_at,
            ai_text_assets.published_at,
            profiles.display_name AS owner_display_name
     FROM ai_text_assets
     LEFT JOIN profiles ON profiles.user_id = ai_text_assets.user_id
     WHERE ai_text_assets.visibility = 'public'
       AND ai_text_assets.source_module = 'video'
     ORDER BY COALESCE(ai_text_assets.published_at, ai_text_assets.created_at) DESC,
              ai_text_assets.created_at DESC,
              ai_text_assets.id DESC
     LIMIT ?`
  ).bind(limit).all();

  return json({
    ok: true,
    data: {
      items: (rows.results || []).map((row) => toPublicMemvidRecord(row)),
    },
  });
}

async function handleGetMemvidFile(ctx, videoId) {
  const { env } = ctx;
  const row = await env.DB.prepare(
    "SELECT r2_key, mime_type FROM ai_text_assets WHERE id = ? AND visibility = 'public' AND source_module = 'video'"
  ).bind(videoId).first();

  if (!row?.r2_key) {
    return json({ ok: false, error: "Video not found." }, { status: 404 });
  }

  const object = await env.USER_IMAGES.get(row.r2_key);
  if (!object) {
    return json({ ok: false, error: "Video not found." }, { status: 404 });
  }

  return new Response(
    object.body,
    {
      headers: buildPublicVideoHeaders(
        row.mime_type || object.httpMetadata?.contentType || "video/mp4",
        object.size
      ),
    }
  );
}

export async function handleVideoGallery(ctx) {
  const { pathname, method } = ctx;

  if (pathname === "/api/gallery/memvids" && method === "GET") {
    return handleListMemvids(ctx);
  }

  const fileMatch = pathname.match(/^\/api\/gallery\/memvids\/([a-f0-9]+)\/file$/);
  if (fileMatch && method === "GET") {
    return handleGetMemvidFile(ctx, fileMatch[1]);
  }

  return null;
}
