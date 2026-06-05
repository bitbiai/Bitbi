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
import { nowIso, randomTokenHex } from "../lib/tokens.js";
import {
  PUBLIC_MEDIA_COMMENT_DEFAULT_LIMIT,
  PUBLIC_MEDIA_COMMENT_MAX_LIMIT,
  getPublicMediaTarget,
  isPublicMediaCommentType,
  isPublicMediaId,
  normalizePublicMediaCommentBody,
  servePublicMediaCommentAvatar,
  toPublicMediaCommentRecord,
} from "../lib/public-media-comments.js";

function resolveCommentLimit(searchParams) {
  const parsed = Number.parseInt(String(searchParams.get("limit") || ""), 10);
  if (!Number.isFinite(parsed)) return PUBLIC_MEDIA_COMMENT_DEFAULT_LIMIT;
  return Math.max(1, Math.min(PUBLIC_MEDIA_COMMENT_MAX_LIMIT, parsed));
}

function parseCommentRoute(pathname) {
  const match = pathname.match(/^\/api\/gallery\/(mempics|memvids|memtracks)\/([a-f0-9]+)\/comments$/);
  if (!match) return null;
  return {
    mediaType: match[1],
    mediaId: match[2],
  };
}

async function requirePublicMediaTarget(ctx, mediaType, mediaId) {
  if (!isPublicMediaCommentType(mediaType) || !isPublicMediaId(mediaId)) return null;
  return getPublicMediaTarget(ctx.env, mediaType, mediaId);
}

async function listComments(ctx, mediaType, mediaId) {
  const target = await requirePublicMediaTarget(ctx, mediaType, mediaId);
  if (!target) return json({ ok: false, error: "Media not found." }, { status: 404 });

  const limit = resolveCommentLimit(ctx.url.searchParams);
  const rows = await ctx.env.DB.prepare(
    `SELECT comments.id,
            comments.body,
            comments.created_at,
            profiles.display_name AS author_display_name,
            profiles.has_avatar AS author_has_avatar,
            profiles.avatar_updated_at AS author_avatar_updated_at
     FROM public_media_comments comments
     LEFT JOIN profiles ON profiles.user_id = comments.user_id
     WHERE comments.media_type = ?
       AND comments.media_id = ?
     ORDER BY comments.created_at DESC, comments.id DESC
     LIMIT ?`
  ).bind(mediaType, mediaId, limit).all();

  const countRow = await ctx.env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM public_media_comments
     WHERE media_type = ?
       AND media_id = ?`
  ).bind(mediaType, mediaId).first();

  return json({
    ok: true,
    data: {
      comments: (rows.results || []).map(toPublicMediaCommentRecord),
      count: Number(countRow?.count || 0),
      applied_limit: limit,
      order: "newest_first",
    },
  });
}

async function enforceCommentPostRateLimit(ctx, userId) {
  const ip = getClientIp(ctx.request);
  const ipLimit = await evaluateSharedRateLimit(
    ctx.env,
    "public-media-comment-create-ip",
    ip,
    60,
    60_000,
    sensitiveRateLimitOptions({
      component: "public-media-comments",
      correlationId: ctx.correlationId || null,
      requestInfo: ctx,
    })
  );
  if (ipLimit.unavailable) return rateLimitUnavailableResponse(ctx.correlationId || null);
  if (ipLimit.limited) return rateLimitResponse();

  const userLimit = await evaluateSharedRateLimit(
    ctx.env,
    "public-media-comment-create-user",
    userId,
    20,
    10 * 60_000,
    sensitiveRateLimitOptions({
      component: "public-media-comments",
      correlationId: ctx.correlationId || null,
      requestInfo: ctx,
    })
  );
  if (userLimit.unavailable) return rateLimitUnavailableResponse(ctx.correlationId || null);
  if (userLimit.limited) return rateLimitResponse();
  return null;
}

async function createComment(ctx, mediaType, mediaId) {
  const session = await requireUser(ctx.request, ctx.env);
  if (session instanceof Response) return session;

  const limited = await enforceCommentPostRateLimit(ctx, session.user.id);
  if (limited) return limited;

  const target = await requirePublicMediaTarget(ctx, mediaType, mediaId);
  if (!target) return json({ ok: false, error: "Media not found." }, { status: 404 });

  const parsed = await readJsonBodyOrResponse(ctx.request, { maxBytes: BODY_LIMITS.smallJson });
  if (parsed.response) return parsed.response;
  const body = parsed.body || {};
  const normalized = normalizePublicMediaCommentBody(body.body ?? body.comment);
  if (normalized.error) {
    return json({ ok: false, error: normalized.error }, { status: 400 });
  }

  const id = `pmc_${randomTokenHex(16)}`;
  const createdAt = nowIso();
  await ctx.env.DB.prepare(
    `INSERT INTO public_media_comments (
       id, media_type, media_id, user_id, body, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, NULL)`
  ).bind(id, mediaType, mediaId, session.user.id, normalized.value, createdAt).run();

  const row = await ctx.env.DB.prepare(
    `SELECT comments.id,
            comments.body,
            comments.created_at,
            profiles.display_name AS author_display_name,
            profiles.has_avatar AS author_has_avatar,
            profiles.avatar_updated_at AS author_avatar_updated_at
     FROM public_media_comments comments
     LEFT JOIN profiles ON profiles.user_id = comments.user_id
     WHERE comments.id = ?
     LIMIT 1`
  ).bind(id).first();

  const countRow = await ctx.env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM public_media_comments
     WHERE media_type = ?
       AND media_id = ?`
  ).bind(mediaType, mediaId).first();

  return json({
    ok: true,
    data: {
      comment: toPublicMediaCommentRecord(row || {
        id,
        body: normalized.value,
        created_at: createdAt,
        author_display_name: session.user.email || "",
      }),
      count: Number(countRow?.count || 0),
    },
  }, { status: 201 });
}

async function handleCommentAvatar(ctx, commentId, version) {
  const response = await servePublicMediaCommentAvatar(ctx, commentId, version);
  if (response) return response;
  return json({ ok: false, error: "Avatar not found." }, { status: 404 });
}

export async function handleMediaComments(ctx) {
  const { pathname, method } = ctx;

  const avatarMatch = pathname.match(/^\/api\/gallery\/comments\/([A-Za-z0-9_-]+)\/([^/]+)\/avatar$/);
  if (avatarMatch && method === "GET") {
    return handleCommentAvatar(ctx, avatarMatch[1], avatarMatch[2]);
  }

  const route = parseCommentRoute(pathname);
  if (!route) return null;

  if (method === "GET") {
    return listComments(ctx, route.mediaType, route.mediaId);
  }

  // route-policy: gallery.comments.create
  if (method === "POST") {
    return createComment(ctx, route.mediaType, route.mediaId);
  }

  return null;
}
