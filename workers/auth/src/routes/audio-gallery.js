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
  buildPublicMemtrackUrl,
  buildPublicMemtrackVersion,
} from "../../../../js/shared/public-media-contract.mjs";

const DEFAULT_MEMTRACKS_LIMIT = 60;
const MAX_MEMTRACKS_LIMIT = 120;
const PUBLIC_MEMTRACKS_CURSOR_TYPE = "public_memtracks";

function buildPublicPublisherAvatarVersion(avatarUpdatedAt) {
  const timestamp = Date.parse(String(avatarUpdatedAt || ""));
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  return `av${timestamp.toString(36)}`;
}

function getPublicMemtrackOwnerLabel(displayName) {
  const normalized = String(displayName || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 50);
  return normalized || "a bitbi member";
}

function getPublicMemtrackCaption(displayName, publishedAt) {
  const ownerLabel = getPublicMemtrackOwnerLabel(displayName);
  const date = String(publishedAt || "").slice(0, 10);
  if (date) return `Published by ${ownerLabel} on ${date}.`;
  return `Published by ${ownerLabel}.`;
}

function parseMetadataJson(raw) {
  if (!raw || raw === "{}") return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function toPublicMemtrackRecord(row) {
  const meta = parseMetadataJson(row.metadata_json);
  const version = buildPublicMemtrackVersion(row);
  const avatarVersion = Number(row.owner_has_avatar) ? buildPublicPublisherAvatarVersion(row.owner_avatar_updated_at) : null;
  const publisher = {
    display_name: getPublicMemtrackOwnerLabel(row.owner_display_name),
  };
  const record = {
    id: row.id,
    slug: `memtrack-${row.id}`,
    title: row.title || "Memtrack",
    caption: getPublicMemtrackCaption(row.owner_display_name, row.published_at || row.created_at),
    category: "memtracks",
    publisher,
    mime_type: row.mime_type || "audio/mpeg",
    file: {
      url: buildPublicMemtrackUrl(row.id, version, "file"),
    },
    duration_seconds: meta.duration_seconds ?? null,
  };
  if (avatarVersion) {
    record.publisher.avatar = {
      url: `/api/gallery/memtracks/${row.id}/${avatarVersion}/avatar`,
    };
  }
  if (row.poster_r2_key) {
    record.poster = {
      url: buildPublicMemtrackUrl(row.id, version, "poster"),
      w: row.poster_width ?? null,
      h: row.poster_height ?? null,
    };
  }
  return record;
}

const PUBLIC_MEMTRACK_SELECT = `SELECT created_at,
                                       published_at,
                                       r2_key,
                                       mime_type,
                                       poster_r2_key
                                FROM ai_text_assets
                                WHERE id = ?
                                  AND visibility = 'public'
                                  AND source_module = 'music'`;

const PUBLIC_MEMTRACK_AVATAR_SELECT = `SELECT ai_text_assets.user_id,
                                              profiles.has_avatar,
                                              profiles.avatar_updated_at
                                       FROM ai_text_assets
                                       LEFT JOIN profiles ON profiles.user_id = ai_text_assets.user_id
                                       WHERE ai_text_assets.id = ?
                                         AND ai_text_assets.visibility = 'public'
                                         AND ai_text_assets.source_module = 'music'`;

async function handleListMemtracks(ctx) {
  const { env, url } = ctx;
  const appliedLimit = resolvePaginationLimit(url.searchParams.get("limit"), {
    defaultValue: DEFAULT_MEMTRACKS_LIMIT,
    maxValue: MAX_MEMTRACKS_LIMIT,
  });

  let cursor = null;
  try {
    cursor = await decodePaginationCursor(env, url.searchParams.get("cursor"), PUBLIC_MEMTRACKS_CURSOR_TYPE);
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
         AND ai_text_assets.source_module = 'music'
     ) AS memtracks
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
      items: items.map((row) => toPublicMemtrackRecord(row)),
      next_cursor: hasMore
        ? await encodePaginationCursor(env, PUBLIC_MEMTRACKS_CURSOR_TYPE, {
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

async function getPublicMemtrackRouteRow(env, trackId) {
  return env.DB.prepare(PUBLIC_MEMTRACK_SELECT).bind(trackId).first();
}

async function getPublicMemtrackAvatarRow(env, trackId) {
  return env.DB.prepare(PUBLIC_MEMTRACK_AVATAR_SELECT).bind(trackId).first();
}

function hasMatchingPublicMemtrackVersion(row, version) {
  return version === buildPublicMemtrackVersion(row);
}

function hasMatchingPublicPublisherAvatarVersion(row, version) {
  return version === buildPublicPublisherAvatarVersion(row?.avatar_updated_at);
}

async function handleGetMemtrackFile(ctx, trackId, version) {
  const { env } = ctx;
  const row = await getPublicMemtrackRouteRow(env, trackId);

  if (!row?.r2_key) {
    return json({ ok: false, error: "Track not found." }, { status: 404 });
  }

  if (!version) {
    return buildPublicMediaAliasRedirect(buildPublicMemtrackUrl(trackId, buildPublicMemtrackVersion(row), "file"));
  }

  if (!hasMatchingPublicMemtrackVersion(row, version)) {
    return json({ ok: false, error: "Track not found." }, { status: 404 });
  }

  const object = await env.USER_IMAGES.get(row.r2_key);
  if (!object) {
    return json({ ok: false, error: "Track not found." }, { status: 404 });
  }

  return new Response(
    object.body,
    {
      headers: buildPublicMediaHeaders(
        row.mime_type || object.httpMetadata?.contentType || "audio/mpeg",
        object.size,
        { immutable: true }
      ),
    }
  );
}

async function handleGetMemtrackPoster(ctx, trackId, version) {
  const { env } = ctx;
  const row = await getPublicMemtrackRouteRow(env, trackId);

  if (!row?.poster_r2_key) {
    return json({ ok: false, error: "Poster not found." }, { status: 404 });
  }

  if (!version) {
    return buildPublicMediaAliasRedirect(
      buildPublicMemtrackUrl(trackId, buildPublicMemtrackVersion(row), "poster")
    );
  }

  if (!hasMatchingPublicMemtrackVersion(row, version)) {
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

async function handleGetMemtrackAvatar(ctx, trackId, version) {
  const row = await getPublicMemtrackAvatarRow(ctx.env, trackId);
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

export async function handleAudioGallery(ctx) {
  const { pathname, method } = ctx;

  if (pathname === "/api/gallery/memtracks" && method === "GET") {
    return handleListMemtracks(ctx);
  }

  const versionedAvatarMatch = pathname.match(/^\/api\/gallery\/memtracks\/([a-f0-9]+)\/([^/]+)\/avatar$/);
  if (versionedAvatarMatch && method === "GET") {
    return handleGetMemtrackAvatar(ctx, versionedAvatarMatch[1], versionedAvatarMatch[2]);
  }

  const versionedFileMatch = pathname.match(/^\/api\/gallery\/memtracks\/([a-f0-9]+)\/([^/]+)\/file$/);
  if (versionedFileMatch && method === "GET") {
    return handleGetMemtrackFile(ctx, versionedFileMatch[1], versionedFileMatch[2]);
  }

  const fileMatch = pathname.match(/^\/api\/gallery\/memtracks\/([a-f0-9]+)\/file$/);
  if (fileMatch && method === "GET") {
    return handleGetMemtrackFile(ctx, fileMatch[1], null);
  }

  const versionedPosterMatch = pathname.match(/^\/api\/gallery\/memtracks\/([a-f0-9]+)\/([^/]+)\/poster$/);
  if (versionedPosterMatch && method === "GET") {
    return handleGetMemtrackPoster(ctx, versionedPosterMatch[1], versionedPosterMatch[2]);
  }

  const posterMatch = pathname.match(/^\/api\/gallery\/memtracks\/([a-f0-9]+)\/poster$/);
  if (posterMatch && method === "GET") {
    return handleGetMemtrackPoster(ctx, posterMatch[1], null);
  }

  return null;
}
