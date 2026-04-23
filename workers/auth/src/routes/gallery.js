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
  buildPublicMempicUrl,
  buildPublicMempicVersion,
} from "../../../../js/shared/public-media-contract.mjs";

const DEFAULT_MEMPICS_LIMIT = 60;
const MAX_MEMPICS_LIMIT = 120;
const PUBLIC_MEMPICS_CURSOR_TYPE = "public_mempics";

function buildPublicPublisherAvatarVersion(avatarUpdatedAt) {
  const timestamp = Date.parse(String(avatarUpdatedAt || ""));
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  return `av${timestamp.toString(36)}`;
}

function getPublicMempicTitle() {
  return "Mempics";
}

function getPublicMempicOwnerLabel(displayName) {
  const normalized = String(displayName || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 50);
  return normalized || "a bitbi member";
}

function getPublicMempicCaption(displayName, publishedAt) {
  const ownerLabel = getPublicMempicOwnerLabel(displayName);
  const date = String(publishedAt || "").slice(0, 10);
  if (date) return `Published by ${ownerLabel} on ${date}.`;
  return `Published by ${ownerLabel}.`;
}

function toPublicMempicRecord(row) {
  const version = buildPublicMempicVersion(row);
  const avatarVersion = Number(row.owner_has_avatar) ? buildPublicPublisherAvatarVersion(row.owner_avatar_updated_at) : null;
  const publisher = {
    display_name: getPublicMempicOwnerLabel(row.owner_display_name),
  };
  if (avatarVersion) {
    publisher.avatar = {
      url: `/api/gallery/mempics/${row.id}/${avatarVersion}/avatar`,
    };
  }
  return {
    id: row.id,
    slug: `mempic-${row.id}`,
    title: getPublicMempicTitle(),
    caption: getPublicMempicCaption(row.owner_display_name, row.published_at || row.created_at),
    category: "mempics",
    publisher,
    thumb: {
      url: buildPublicMempicUrl(row.id, version, "thumb"),
      w: Number(row.thumb_width) || 320,
      h: Number(row.thumb_height) || 320,
    },
    preview: {
      url: buildPublicMempicUrl(row.id, version, "medium"),
      w: Number(row.medium_width) || Number(row.thumb_width) || 1280,
      h: Number(row.medium_height) || Number(row.thumb_height) || 1280,
    },
    full: {
      url: buildPublicMempicUrl(row.id, version, "file"),
    },
  };
}

const PUBLIC_MEMPIC_SELECT = `SELECT created_at,
                                     published_at,
                                     r2_key,
                                     thumb_key,
                                     medium_key,
                                     thumb_mime_type,
                                     medium_mime_type,
                                     derivatives_version,
                                     derivatives_ready_at
                              FROM ai_images
                              WHERE id = ?
                                AND visibility = 'public'`;

const PUBLIC_MEMPIC_AVATAR_SELECT = `SELECT ai_images.user_id,
                                            profiles.has_avatar,
                                            profiles.avatar_updated_at
                                     FROM ai_images
                                     LEFT JOIN profiles ON profiles.user_id = ai_images.user_id
                                     WHERE ai_images.id = ?
                                       AND ai_images.visibility = 'public'`;

async function handleListMempics(ctx) {
  const { env, url } = ctx;
  const appliedLimit = resolvePaginationLimit(url.searchParams.get("limit"), {
    defaultValue: DEFAULT_MEMPICS_LIMIT,
    maxValue: MAX_MEMPICS_LIMIT,
  });

  let cursor = null;
  try {
    cursor = await decodePaginationCursor(env, url.searchParams.get("cursor"), PUBLIC_MEMPICS_CURSOR_TYPE);
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
            created_at,
            published_at,
            order_at,
            r2_key,
            thumb_key,
            medium_key,
            thumb_width,
            thumb_height,
            medium_width,
            medium_height,
            derivatives_version,
            derivatives_ready_at,
            owner_display_name,
            owner_has_avatar,
            owner_avatar_updated_at
     FROM (
       SELECT ai_images.id,
              ai_images.created_at,
              ai_images.published_at,
              COALESCE(ai_images.published_at, ai_images.created_at) AS order_at,
              ai_images.r2_key,
              ai_images.thumb_key,
              ai_images.medium_key,
              ai_images.thumb_width,
              ai_images.thumb_height,
              ai_images.medium_width,
              ai_images.medium_height,
              ai_images.derivatives_version,
              ai_images.derivatives_ready_at,
              profiles.display_name AS owner_display_name,
              profiles.has_avatar AS owner_has_avatar,
              profiles.avatar_updated_at AS owner_avatar_updated_at
       FROM ai_images
       LEFT JOIN profiles ON profiles.user_id = ai_images.user_id
       WHERE ai_images.visibility = 'public'
         AND ai_images.derivatives_status = 'ready'
         AND ai_images.thumb_key IS NOT NULL
         AND ai_images.medium_key IS NOT NULL
     ) AS mempics
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
      items: items.map((row) => toPublicMempicRecord(row)),
      next_cursor: hasMore
        ? await encodePaginationCursor(env, PUBLIC_MEMPICS_CURSOR_TYPE, {
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

async function getPublicMempicRouteRow(env, imageId) {
  return env.DB.prepare(PUBLIC_MEMPIC_SELECT).bind(imageId).first();
}

async function getPublicMempicAvatarRow(env, imageId) {
  return env.DB.prepare(PUBLIC_MEMPIC_AVATAR_SELECT).bind(imageId).first();
}

function hasMatchingPublicMempicVersion(row, version) {
  return version === buildPublicMempicVersion(row);
}

function hasMatchingPublicPublisherAvatarVersion(row, version) {
  return version === buildPublicPublisherAvatarVersion(row?.avatar_updated_at);
}

async function handleGetMempicFile(ctx, imageId, version) {
  const { env } = ctx;
  const row = await getPublicMempicRouteRow(env, imageId);

  if (!row?.r2_key) {
    return json({ ok: false, error: "Image not found." }, { status: 404 });
  }

  if (!version) {
    return buildPublicMediaAliasRedirect(buildPublicMempicUrl(imageId, buildPublicMempicVersion(row), "file"));
  }

  if (!hasMatchingPublicMempicVersion(row, version)) {
    return json({ ok: false, error: "Image not found." }, { status: 404 });
  }

  const object = await env.USER_IMAGES.get(row.r2_key);
  if (!object) {
    return json({ ok: false, error: "Image not found." }, { status: 404 });
  }

  return new Response(
    object.body,
    {
      headers: buildPublicMediaHeaders(
        object.httpMetadata?.contentType || "image/png",
        object.size,
        { immutable: true }
      ),
    }
  );
}

async function handleGetMempicDerivative(ctx, imageId, variant, version) {
  const { env } = ctx;
  const row = await getPublicMempicRouteRow(env, imageId);
  const derivativeKey = variant === "thumb" ? row?.thumb_key : row?.medium_key;
  const mimeType = variant === "thumb" ? row?.thumb_mime_type : row?.medium_mime_type;

  if (!derivativeKey) {
    return json({ ok: false, error: "Image not found." }, { status: 404 });
  }

  if (!version) {
    return buildPublicMediaAliasRedirect(
      buildPublicMempicUrl(imageId, buildPublicMempicVersion(row), variant)
    );
  }

  if (!hasMatchingPublicMempicVersion(row, version)) {
    return json({ ok: false, error: "Image not found." }, { status: 404 });
  }

  const object = await env.USER_IMAGES.get(derivativeKey);
  if (!object) {
    return json({ ok: false, error: "Image not found." }, { status: 404 });
  }

  return new Response(
    object.body,
    {
      headers: buildPublicMediaHeaders(
        mimeType || object.httpMetadata?.contentType || "image/webp",
        object.size,
        { immutable: true }
      ),
    }
  );
}

async function handleGetMempicAvatar(ctx, imageId, version) {
  const row = await getPublicMempicAvatarRow(ctx.env, imageId);
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

export async function handleGallery(ctx) {
  const { pathname, method } = ctx;

  if (pathname === "/api/gallery/mempics" && method === "GET") {
    return handleListMempics(ctx);
  }

  const versionedAvatarMatch = pathname.match(/^\/api\/gallery\/mempics\/([a-f0-9]+)\/([^/]+)\/avatar$/);
  if (versionedAvatarMatch && method === "GET") {
    return handleGetMempicAvatar(ctx, versionedAvatarMatch[1], versionedAvatarMatch[2]);
  }

  const versionedFileMatch = pathname.match(/^\/api\/gallery\/mempics\/([a-f0-9]+)\/([^/]+)\/file$/);
  if (versionedFileMatch && method === "GET") {
    return handleGetMempicFile(ctx, versionedFileMatch[1], versionedFileMatch[2]);
  }

  const fileMatch = pathname.match(/^\/api\/gallery\/mempics\/([a-f0-9]+)\/file$/);
  if (fileMatch && method === "GET") {
    return handleGetMempicFile(ctx, fileMatch[1], null);
  }

  const versionedThumbMatch = pathname.match(/^\/api\/gallery\/mempics\/([a-f0-9]+)\/([^/]+)\/thumb$/);
  if (versionedThumbMatch && method === "GET") {
    return handleGetMempicDerivative(ctx, versionedThumbMatch[1], "thumb", versionedThumbMatch[2]);
  }

  const thumbMatch = pathname.match(/^\/api\/gallery\/mempics\/([a-f0-9]+)\/thumb$/);
  if (thumbMatch && method === "GET") {
    return handleGetMempicDerivative(ctx, thumbMatch[1], "thumb", null);
  }

  const versionedMediumMatch = pathname.match(/^\/api\/gallery\/mempics\/([a-f0-9]+)\/([^/]+)\/medium$/);
  if (versionedMediumMatch && method === "GET") {
    return handleGetMempicDerivative(ctx, versionedMediumMatch[1], "medium", versionedMediumMatch[2]);
  }

  const mediumMatch = pathname.match(/^\/api\/gallery\/mempics\/([a-f0-9]+)\/medium$/);
  if (mediumMatch && method === "GET") {
    return handleGetMempicDerivative(ctx, mediumMatch[1], "medium", null);
  }

  return null;
}
