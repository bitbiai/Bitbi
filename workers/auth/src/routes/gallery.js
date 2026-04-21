import { json } from "../lib/response.js";
import { buildPublicMediaAliasRedirect, buildPublicMediaHeaders } from "../lib/public-media.js";
import {
  buildPublicMempicUrl,
  buildPublicMempicVersion,
} from "../../../../js/shared/public-media-contract.mjs";

const DEFAULT_MEMPICS_LIMIT = 60;
const MAX_MEMPICS_LIMIT = 120;

function toSafeLimit(value) {
  const limit = Number(value);
  if (!Number.isFinite(limit)) return DEFAULT_MEMPICS_LIMIT;
  return Math.min(Math.max(Math.floor(limit), 1), MAX_MEMPICS_LIMIT);
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
  return {
    id: row.id,
    slug: `mempic-${row.id}`,
    title: getPublicMempicTitle(),
    caption: getPublicMempicCaption(row.owner_display_name, row.published_at || row.created_at),
    category: "mempics",
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

async function handleListMempics(ctx) {
  const { env, url } = ctx;
  const limit = toSafeLimit(url.searchParams.get("limit"));
  const rows = await env.DB.prepare(
    `SELECT ai_images.id,
            ai_images.created_at,
            ai_images.published_at,
            ai_images.r2_key,
            ai_images.thumb_key,
            ai_images.medium_key,
            ai_images.thumb_width,
            ai_images.thumb_height,
            ai_images.medium_width,
            ai_images.medium_height,
            ai_images.derivatives_version,
            ai_images.derivatives_ready_at,
            profiles.display_name AS owner_display_name
     FROM ai_images
     LEFT JOIN profiles ON profiles.user_id = ai_images.user_id
     WHERE ai_images.visibility = 'public'
       AND ai_images.derivatives_status = 'ready'
       AND ai_images.thumb_key IS NOT NULL
       AND ai_images.medium_key IS NOT NULL
     ORDER BY COALESCE(ai_images.published_at, ai_images.created_at) DESC,
              ai_images.created_at DESC,
              ai_images.id DESC
     LIMIT ?`
  ).bind(limit).all();

  return json({
    ok: true,
    data: {
      items: (rows.results || []).map((row) => toPublicMempicRecord(row)),
    },
  });
}

async function getPublicMempicRouteRow(env, imageId) {
  return env.DB.prepare(PUBLIC_MEMPIC_SELECT).bind(imageId).first();
}

function hasMatchingPublicMempicVersion(row, version) {
  return version === buildPublicMempicVersion(row);
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

export async function handleGallery(ctx) {
  const { pathname, method } = ctx;

  if (pathname === "/api/gallery/mempics" && method === "GET") {
    return handleListMempics(ctx);
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
