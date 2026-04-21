import { json } from "../lib/response.js";
import {
  decodePaginationCursor,
  encodePaginationCursor,
  paginationErrorResponse,
  readCursorString,
  resolvePaginationLimit,
} from "../lib/pagination.js";
import { buildPublicMediaAliasRedirect, buildPublicMediaHeaders } from "../lib/public-media.js";
import {
  buildPublicMemvidUrl,
  buildPublicMemvidVersion,
} from "../../../../js/shared/public-media-contract.mjs";

const DEFAULT_MEMVIDS_LIMIT = 60;
const MAX_MEMVIDS_LIMIT = 120;
const PUBLIC_MEMVIDS_CURSOR_TYPE = "public_memvids";

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
  const version = buildPublicMemvidVersion(row);
  const record = {
    id: row.id,
    slug: `memvid-${row.id}`,
    title: row.title || "Memvids",
    caption: getPublicMemvidCaption(row.owner_display_name, row.published_at || row.created_at),
    category: "memvids",
    mime_type: row.mime_type || "video/mp4",
    file: {
      url: buildPublicMemvidUrl(row.id, version, "file"),
    },
    duration_seconds: meta.duration_seconds ?? null,
  };
  if (row.poster_r2_key) {
    record.poster = {
      url: buildPublicMemvidUrl(row.id, version, "poster"),
      w: row.poster_width ?? null,
      h: row.poster_height ?? null,
    };
  }
  return record;
}

function parseMetadataJson(raw) {
  if (!raw || raw === "{}") return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

const PUBLIC_MEMVID_SELECT = `SELECT created_at,
                                     published_at,
                                     r2_key,
                                     mime_type,
                                     poster_r2_key
                              FROM ai_text_assets
                              WHERE id = ?
                                AND visibility = 'public'
                                AND source_module = 'video'`;

async function handleListMemvids(ctx) {
  const { env, url } = ctx;
  const appliedLimit = resolvePaginationLimit(url.searchParams.get("limit"), {
    defaultValue: DEFAULT_MEMVIDS_LIMIT,
    maxValue: MAX_MEMVIDS_LIMIT,
  });

  let cursor = null;
  try {
    cursor = await decodePaginationCursor(env, url.searchParams.get("cursor"), PUBLIC_MEMVIDS_CURSOR_TYPE);
    if (cursor) {
      cursor = {
        o: readCursorString(cursor, "o"),
        c: readCursorString(cursor, "c"),
        i: readCursorString(cursor, "i"),
      };
    }
  } catch {
    return paginationErrorResponse("Invalid cursor.");
  }

  const cursorClause = cursor
    ? `WHERE (
         order_at < ?
         OR (
           order_at = ?
           AND (
             created_at < ?
             OR (created_at = ? AND id < ?)
           )
         )
       )`
    : "";
  const cursorBindings = cursor
    ? [cursor.o, cursor.o, cursor.c, cursor.c, cursor.i]
    : [];

  const rows = await env.DB.prepare(
    `SELECT id,
            title,
            mime_type,
            metadata_json,
            created_at,
            published_at,
            order_at,
            r2_key,
            poster_r2_key,
            poster_width,
            poster_height,
            owner_display_name
     FROM (
       SELECT ai_text_assets.id,
              ai_text_assets.title,
              ai_text_assets.mime_type,
              ai_text_assets.metadata_json,
              ai_text_assets.created_at,
              ai_text_assets.published_at,
              COALESCE(ai_text_assets.published_at, ai_text_assets.created_at) AS order_at,
              ai_text_assets.r2_key,
              ai_text_assets.poster_r2_key,
              ai_text_assets.poster_width,
              ai_text_assets.poster_height,
              profiles.display_name AS owner_display_name
       FROM ai_text_assets
       LEFT JOIN profiles ON profiles.user_id = ai_text_assets.user_id
       WHERE ai_text_assets.visibility = 'public'
         AND ai_text_assets.source_module = 'video'
     ) AS memvids
     ${cursorClause}
     ORDER BY order_at DESC, created_at DESC, id DESC
     LIMIT ?`
  ).bind(...cursorBindings, appliedLimit + 1).all();

  const resultRows = rows.results || [];
  const hasMore = resultRows.length > appliedLimit;
  const items = hasMore ? resultRows.slice(0, appliedLimit) : resultRows;
  const last = items[items.length - 1];

  return json({
    ok: true,
    data: {
      items: items.map((row) => toPublicMemvidRecord(row)),
      next_cursor: hasMore
        ? await encodePaginationCursor(env, PUBLIC_MEMVIDS_CURSOR_TYPE, {
            o: last.order_at,
            c: last.created_at,
            i: last.id,
          })
        : null,
      has_more: hasMore,
      applied_limit: appliedLimit,
    },
  });
}

async function getPublicMemvidRouteRow(env, videoId) {
  return env.DB.prepare(PUBLIC_MEMVID_SELECT).bind(videoId).first();
}

function hasMatchingPublicMemvidVersion(row, version) {
  return version === buildPublicMemvidVersion(row);
}

async function handleGetMemvidFile(ctx, videoId, version) {
  const { env } = ctx;
  const row = await getPublicMemvidRouteRow(env, videoId);

  if (!row?.r2_key) {
    return json({ ok: false, error: "Video not found." }, { status: 404 });
  }

  if (!version) {
    return buildPublicMediaAliasRedirect(buildPublicMemvidUrl(videoId, buildPublicMemvidVersion(row), "file"));
  }

  if (!hasMatchingPublicMemvidVersion(row, version)) {
    return json({ ok: false, error: "Video not found." }, { status: 404 });
  }

  const object = await env.USER_IMAGES.get(row.r2_key);
  if (!object) {
    return json({ ok: false, error: "Video not found." }, { status: 404 });
  }

  return new Response(
    object.body,
    {
      headers: buildPublicMediaHeaders(
        row.mime_type || object.httpMetadata?.contentType || "video/mp4",
        object.size,
        { immutable: true }
      ),
    }
  );
}

async function handleGetMemvidPoster(ctx, videoId, version) {
  const { env } = ctx;
  const row = await getPublicMemvidRouteRow(env, videoId);

  if (!row?.poster_r2_key) {
    return json({ ok: false, error: "Poster not found." }, { status: 404 });
  }

  if (!version) {
    return buildPublicMediaAliasRedirect(
      buildPublicMemvidUrl(videoId, buildPublicMemvidVersion(row), "poster")
    );
  }

  if (!hasMatchingPublicMemvidVersion(row, version)) {
    return json({ ok: false, error: "Poster not found." }, { status: 404 });
  }

  const object = await env.USER_IMAGES.get(row.poster_r2_key);
  if (!object) {
    return json({ ok: false, error: "Poster not found." }, { status: 404 });
  }

  return new Response(
    object.body,
    {
      headers: buildPublicMediaHeaders(
        object.httpMetadata?.contentType || "image/webp",
        object.size,
        { immutable: true }
      ),
    }
  );
}

export async function handleVideoGallery(ctx) {
  const { pathname, method } = ctx;

  if (pathname === "/api/gallery/memvids" && method === "GET") {
    return handleListMemvids(ctx);
  }

  const versionedFileMatch = pathname.match(/^\/api\/gallery\/memvids\/([a-f0-9]+)\/([^/]+)\/file$/);
  if (versionedFileMatch && method === "GET") {
    return handleGetMemvidFile(ctx, versionedFileMatch[1], versionedFileMatch[2]);
  }

  const fileMatch = pathname.match(/^\/api\/gallery\/memvids\/([a-f0-9]+)\/file$/);
  if (fileMatch && method === "GET") {
    return handleGetMemvidFile(ctx, fileMatch[1], null);
  }

  const versionedPosterMatch = pathname.match(/^\/api\/gallery\/memvids\/([a-f0-9]+)\/([^/]+)\/poster$/);
  if (versionedPosterMatch && method === "GET") {
    return handleGetMemvidPoster(ctx, versionedPosterMatch[1], versionedPosterMatch[2]);
  }

  const posterMatch = pathname.match(/^\/api\/gallery\/memvids\/([a-f0-9]+)\/poster$/);
  if (posterMatch && method === "GET") {
    return handleGetMemvidPoster(ctx, posterMatch[1], null);
  }

  return null;
}
