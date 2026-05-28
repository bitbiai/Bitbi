import { json } from "../lib/response.js";
import {
  decodePaginationCursor,
  encodePaginationCursor,
  paginationErrorResponse,
  readCursorString,
  resolvePaginationLimit,
} from "../lib/pagination.js";
import { buildPublicMediaAliasRedirect, buildPublicMediaHeaders } from "../lib/public-media.js";
import { avatarKey } from "../lib/profile-avatar-state.js";
import {
  buildPublicMemvidUrl,
  buildPublicMemvidVersion,
} from "../../../../js/shared/public-media-contract.mjs";
import {
  getMemvidStreamPreviewConfig,
  isMemvidStreamPreviewMetadataEnabled,
  toPublicStreamPreview,
} from "../lib/cloudflare-stream-previews.js";
import {
  BODY_LIMITS,
  readJsonBodyOrResponse,
} from "../lib/request.js";
import { nowIso, randomTokenHex } from "../lib/tokens.js";

const DEFAULT_MEMVIDS_LIMIT = 60;
const MAX_MEMVIDS_LIMIT = 120;
const PUBLIC_MEMVIDS_CURSOR_TYPE = "public_memvids";

function buildPublicPublisherAvatarVersion(avatarUpdatedAt) {
  const timestamp = Date.parse(String(avatarUpdatedAt || ""));
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  return `av${timestamp.toString(36)}`;
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

function toPublicMemvidRecord(row, streamPreview = null) {
  const meta = parseMetadataJson(row.metadata_json);
  const version = buildPublicMemvidVersion(row);
  const avatarVersion = Number(row.owner_has_avatar) ? buildPublicPublisherAvatarVersion(row.owner_avatar_updated_at) : null;
  const publisher = {
    display_name: getPublicMemvidOwnerLabel(row.owner_display_name),
  };
  const record = {
    id: row.id,
    slug: `memvid-${row.id}`,
    title: row.title || "Memvids",
    caption: getPublicMemvidCaption(row.owner_display_name, row.published_at || row.created_at),
    category: "memvids",
    publisher,
    mime_type: row.mime_type || "video/mp4",
    file: {
      url: buildPublicMemvidUrl(row.id, version, "file"),
    },
    duration_seconds: meta.duration_seconds ?? null,
  };
  if (avatarVersion) {
    record.publisher.avatar = {
      url: `/api/gallery/memvids/${row.id}/${avatarVersion}/avatar`,
    };
  }
  if (row.poster_r2_key) {
    record.poster = {
      url: buildPublicMemvidUrl(row.id, version, "poster"),
      w: row.poster_width ?? null,
      h: row.poster_height ?? null,
    };
  }
  if (streamPreview) {
    record.stream_preview = streamPreview;
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

const PUBLIC_MEMVID_AVATAR_SELECT = `SELECT ai_text_assets.user_id,
                                            profiles.has_avatar,
                                            profiles.avatar_updated_at
                                     FROM ai_text_assets
                                     LEFT JOIN profiles ON profiles.user_id = ai_text_assets.user_id
                                     WHERE ai_text_assets.id = ?
                                       AND ai_text_assets.visibility = 'public'
                                       AND ai_text_assets.source_module = 'video'`;

function isMissingStreamPreviewTable(error) {
  return String(error?.message || error).includes("no such table")
    && String(error?.message || error).includes("memvid_stream_preview");
}

async function listReadyStreamPreviewsForAssets(env, assetIds) {
  if (!isMemvidStreamPreviewMetadataEnabled(env) || !assetIds.length) return new Map();
  const placeholders = assetIds.map(() => "?").join(", ");
  try {
    const rows = await env.DB.prepare(
      `SELECT id,
              asset_id,
              stream_uid,
              status,
              preview_duration_seconds,
              max_loop_count,
              completed_at,
              updated_at
       FROM memvid_stream_previews
       WHERE status = 'ready'
         AND stream_uid IS NOT NULL
         AND asset_id IN (${placeholders})
       ORDER BY completed_at DESC, updated_at DESC`
    ).bind(...assetIds).all();
    const byAsset = new Map();
    for (const row of rows.results || []) {
      if (byAsset.has(row.asset_id)) continue;
      const preview = toPublicStreamPreview(row, env);
      if (preview) byAsset.set(row.asset_id, preview);
    }
    return byAsset;
  } catch (error) {
    if (isMissingStreamPreviewTable(error)) return new Map();
    throw error;
  }
}

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
            owner_display_name,
            owner_has_avatar,
            owner_avatar_updated_at
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
              profiles.display_name AS owner_display_name,
              profiles.has_avatar AS owner_has_avatar,
              profiles.avatar_updated_at AS owner_avatar_updated_at
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
  const streamPreviews = await listReadyStreamPreviewsForAssets(env, items.map((row) => row.id).filter(Boolean));

  return json({
    ok: true,
    data: {
      items: items.map((row) => toPublicMemvidRecord(row, streamPreviews.get(row.id) || null)),
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

async function getPublicMemvidAvatarRow(env, videoId) {
  return env.DB.prepare(PUBLIC_MEMVID_AVATAR_SELECT).bind(videoId).first();
}

function hasMatchingPublicMemvidVersion(row, version) {
  return version === buildPublicMemvidVersion(row);
}

function hasMatchingPublicPublisherAvatarVersion(row, version) {
  return version === buildPublicPublisherAvatarVersion(row?.avatar_updated_at);
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

async function handleGetMemvidAvatar(ctx, videoId, version) {
  const row = await getPublicMemvidAvatarRow(ctx.env, videoId);
  if (!row?.user_id || !Number(row.has_avatar) || !hasMatchingPublicPublisherAvatarVersion(row, version)) {
    return json({ ok: false, error: "Avatar not found." }, { status: 404 });
  }

  const object = await ctx.env.PRIVATE_MEDIA.get(avatarKey(row.user_id));
  if (!object) {
    return json({ ok: false, error: "Avatar not found." }, { status: 404 });
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

async function handleStreamPreviewHoverStart(ctx, videoId) {
  if (!isMemvidStreamPreviewMetadataEnabled(ctx.env)) {
    return json({ ok: true, data: { recorded: false, reason: "stream_previews_disabled" } });
  }

  const parsed = await readJsonBodyOrResponse(ctx.request, {
    maxBytes: BODY_LIMITS.memvidStreamPreviewTelemetryJson,
    requiredContentType: false,
  });
  if (parsed.response) return parsed.response;
  const body = parsed.body || {};
  const row = await getPublicMemvidRouteRow(ctx.env, videoId);
  if (!row?.r2_key) return json({ ok: false, error: "Video not found." }, { status: 404 });

  let preview = null;
  try {
    preview = await ctx.env.DB.prepare(
      `SELECT id,
              asset_id,
              stream_uid,
              status,
              preview_duration_seconds,
              max_loop_count
       FROM memvid_stream_previews
       WHERE asset_id = ?
         AND status = 'ready'
         AND stream_uid IS NOT NULL
       ORDER BY completed_at DESC, updated_at DESC
       LIMIT 1`
    ).bind(videoId).first();
  } catch (error) {
    if (isMissingStreamPreviewTable(error)) {
      return json({ ok: true, data: { recorded: false, reason: "stream_preview_schema_missing" } });
    }
    throw error;
  }
  if (!preview) return json({ ok: true, data: { recorded: false, reason: "stream_preview_not_ready" } });

  const config = getMemvidStreamPreviewConfig(ctx.env);
  const previewDurationSeconds = Math.min(
    config.previewDurationSeconds,
    Math.max(1, Number(preview.preview_duration_seconds || config.previewDurationSeconds) || config.previewDurationSeconds)
  );
  const maxLoopCount = Math.min(
    config.maxLoopCount,
    Math.max(1, Number(preview.max_loop_count || config.maxLoopCount) || config.maxLoopCount)
  );
  const loopCount = Math.min(
    maxLoopCount,
    Math.max(1, Number(body.loop_count || body.loopCount || maxLoopCount) || maxLoopCount)
  );
  const estimatedDeliveredSeconds = previewDurationSeconds * loopCount;

  await ctx.env.DB.prepare(
    `INSERT INTO memvid_stream_preview_events (
       id, preview_id, asset_id, event_type, event_count,
       preview_duration_seconds, max_loop_count, estimated_delivered_seconds,
       provider_metadata_json, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    `msp_evt_${randomTokenHex(16)}`,
    preview.id,
    videoId,
    "hover_start",
    1,
    previewDurationSeconds,
    maxLoopCount,
    estimatedDeliveredSeconds,
    JSON.stringify({
      autoplay_requested: true,
      user_agent_family: String(ctx.request.headers.get("User-Agent") || "").slice(0, 80),
    }),
    nowIso()
  ).run();

  return json({ ok: true, data: { recorded: true } });
}

export async function handleVideoGallery(ctx) {
  const { pathname, method } = ctx;

  if (pathname === "/api/gallery/memvids" && method === "GET") {
    return handleListMemvids(ctx);
  }

  const hoverStartMatch = pathname.match(/^\/api\/gallery\/memvids\/([a-f0-9]+)\/stream-preview\/hover-start$/);
  // route-policy: gallery.memvids.stream-preview.hover-start
  if (hoverStartMatch && method === "POST") {
    return handleStreamPreviewHoverStart(ctx, hoverStartMatch[1]);
  }

  const versionedAvatarMatch = pathname.match(/^\/api\/gallery\/memvids\/([a-f0-9]+)\/([^/]+)\/avatar$/);
  if (versionedAvatarMatch && method === "GET") {
    return handleGetMemvidAvatar(ctx, versionedAvatarMatch[1], versionedAvatarMatch[2]);
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
