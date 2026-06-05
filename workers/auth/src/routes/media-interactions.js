import { json } from "../lib/response.js";
import {
  getSessionUser,
  requireUser,
} from "../lib/session.js";
import {
  evaluateSharedRateLimit,
  getClientIp,
  rateLimitResponse,
  rateLimitUnavailableResponse,
  sensitiveRateLimitOptions,
} from "../lib/rate-limit.js";
import { nowIso, randomTokenHex } from "../lib/tokens.js";
import {
  getPublicMediaTarget,
  isPublicMediaCommentType,
  isPublicMediaId,
  loadPublicMediaCommentCounts,
} from "../lib/public-media-comments.js";
import {
  countFollowers,
  countFollowing,
  countLikedMedia,
  countPublishedMedia,
  countReceivedLikes,
  getFollowState,
  getPublicMediaLikeCount,
  getPublicMediaViewerLiked,
  toFollowInteractionRecord,
  toProfileMediaRecord,
  toReceivedLikeRecord,
} from "../lib/public-media-interactions.js";

const DEFAULT_PROFILE_SOCIAL_LIMIT = 30;
const MAX_PROFILE_SOCIAL_LIMIT = 50;
const DEFAULT_PROFILE_MEDIA_LIMIT = 36;
const MAX_PROFILE_MEDIA_LIMIT = 60;

function normalizeLimit(value, { defaultValue, maxValue }) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue;
  return Math.min(parsed, maxValue);
}

function parseGalleryInteractionRoute(pathname) {
  const match = pathname.match(/^\/api\/gallery\/(mempics|memvids|memtracks)\/([a-f0-9]+)\/(interactions|like|follow)$/);
  if (!match) return null;
  return {
    mediaType: match[1],
    mediaId: match[2],
    action: match[3],
  };
}

async function requirePublicTarget(env, mediaType, mediaId) {
  if (!isPublicMediaCommentType(mediaType) || !isPublicMediaId(mediaId)) return null;
  return getPublicMediaTarget(env, mediaType, mediaId);
}

async function enforceInteractionRateLimit(ctx, session, scope) {
  const result = await evaluateSharedRateLimit(
    ctx.env,
    scope,
    session?.user?.id || getClientIp(ctx.request),
    60,
    60_000,
    sensitiveRateLimitOptions({
      component: "public-media-interactions",
      correlationId: ctx.correlationId || null,
      requestInfo: ctx,
    })
  );
  if (result.unavailable) return rateLimitUnavailableResponse(ctx.correlationId || null);
  if (result.limited) return rateLimitResponse();
  return null;
}

async function handleInteractionState(ctx, mediaType, mediaId) {
  const target = await requirePublicTarget(ctx.env, mediaType, mediaId);
  if (!target) return json({ ok: false, error: "Media not found." }, { status: 404 });

  const session = await getSessionUser(ctx.request, ctx.env);
  const viewerId = session?.user?.id || null;
  const [likeCount, commentCounts, likedByViewer, followerCount, followedByViewer] = await Promise.all([
    getPublicMediaLikeCount(ctx.env, mediaType, mediaId),
    loadPublicMediaCommentCounts(ctx.env, mediaType, [mediaId]),
    getPublicMediaViewerLiked(ctx.env, mediaType, mediaId, viewerId),
    countFollowers(ctx.env, target.user_id),
    getFollowState(ctx.env, {
      followerUserId: viewerId,
      followedUserId: target.user_id,
    }),
  ]);

  const isOwnMedia = Boolean(viewerId && viewerId === target.user_id);
  return json({
    ok: true,
    data: {
      like_count: likeCount,
      liked_by_viewer: likedByViewer,
      comment_count: commentCounts.get(mediaId) || 0,
      can_follow: Boolean(viewerId && !isOwnMedia),
      followed_by_viewer: followedByViewer,
      follower_count: followerCount,
      is_own_media: isOwnMedia,
    },
  });
}

async function handleLike(ctx, mediaType, mediaId, shouldLike) {
  const session = await requireUser(ctx.request, ctx.env);
  if (session instanceof Response) return session;
  const limited = await enforceInteractionRateLimit(ctx, session, shouldLike ? "public-media-like-create-user" : "public-media-like-delete-user");
  if (limited) return limited;

  const target = await requirePublicTarget(ctx.env, mediaType, mediaId);
  if (!target) return json({ ok: false, error: "Media not found." }, { status: 404 });

  if (shouldLike) {
    await ctx.env.DB.prepare(
      `INSERT OR IGNORE INTO public_media_likes (id, media_type, media_id, user_id, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(`pml_${randomTokenHex(16)}`, mediaType, mediaId, session.user.id, nowIso()).run();
  } else {
    await ctx.env.DB.prepare(
      "DELETE FROM public_media_likes WHERE media_type = ? AND media_id = ? AND user_id = ?"
    ).bind(mediaType, mediaId, session.user.id).run();
  }

  const [likeCount, likedByViewer] = await Promise.all([
    getPublicMediaLikeCount(ctx.env, mediaType, mediaId),
    getPublicMediaViewerLiked(ctx.env, mediaType, mediaId, session.user.id),
  ]);
  return json({
    ok: true,
    data: {
      like_count: likeCount,
      liked_by_viewer: likedByViewer,
    },
  });
}

async function handleFollow(ctx, mediaType, mediaId, shouldFollow) {
  const session = await requireUser(ctx.request, ctx.env);
  if (session instanceof Response) return session;
  const limited = await enforceInteractionRateLimit(ctx, session, shouldFollow ? "profile-follow-create-user" : "profile-follow-delete-user");
  if (limited) return limited;

  const target = await requirePublicTarget(ctx.env, mediaType, mediaId);
  if (!target) return json({ ok: false, error: "Media not found." }, { status: 404 });
  if (target.user_id === session.user.id) {
    return json({ ok: false, error: "You cannot follow yourself." }, { status: 400 });
  }

  if (shouldFollow) {
    await ctx.env.DB.prepare(
      `INSERT OR IGNORE INTO profile_follows (id, follower_user_id, followed_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(`pf_${randomTokenHex(16)}`, session.user.id, target.user_id, nowIso(), null).run();
  } else {
    await ctx.env.DB.prepare(
      "DELETE FROM profile_follows WHERE follower_user_id = ? AND followed_user_id = ?"
    ).bind(session.user.id, target.user_id).run();
  }

  const [followerCount, followedByViewer] = await Promise.all([
    countFollowers(ctx.env, target.user_id),
    getFollowState(ctx.env, {
      followerUserId: session.user.id,
      followedUserId: target.user_id,
    }),
  ]);
  return json({
    ok: true,
    data: {
      follower_count: followerCount,
      followed_by_viewer: followedByViewer,
      can_follow: true,
    },
  });
}

async function handleProfileSummary(ctx) {
  const session = await requireUser(ctx.request, ctx.env);
  if (session instanceof Response) return session;
  const userId = session.user.id;
  const [followerCount, followingCount, receivedLikeCount, publishedMediaCount, likedMediaCount] = await Promise.all([
    countFollowers(ctx.env, userId),
    countFollowing(ctx.env, userId),
    countReceivedLikes(ctx.env, userId),
    countPublishedMedia(ctx.env, userId),
    countLikedMedia(ctx.env, userId),
  ]);
  return json({
    ok: true,
    data: {
      follower_count: followerCount,
      following_count: followingCount,
      received_like_count: receivedLikeCount,
      published_media_count: publishedMediaCount,
      liked_media_count: likedMediaCount,
    },
  });
}

async function handleProfileFollowers(ctx) {
  const session = await requireUser(ctx.request, ctx.env);
  if (session instanceof Response) return session;
  const limit = normalizeLimit(ctx.url.searchParams.get("limit"), {
    defaultValue: DEFAULT_PROFILE_SOCIAL_LIMIT,
    maxValue: MAX_PROFILE_SOCIAL_LIMIT,
  });
  const rows = await ctx.env.DB.prepare(
    `SELECT follows.id,
            follows.created_at,
            profiles.display_name AS follower_display_name
     FROM profile_follows follows
     LEFT JOIN profiles ON profiles.user_id = follows.follower_user_id
     WHERE follows.followed_user_id = ?
     ORDER BY follows.created_at DESC, follows.id DESC
     LIMIT ?`
  ).bind(session.user.id, limit).all();
  return json({
    ok: true,
    data: {
      items: (rows.results || []).map((row) => toFollowInteractionRecord(row, "followers")),
      applied_limit: limit,
    },
  });
}

async function handleProfileFollowing(ctx) {
  const session = await requireUser(ctx.request, ctx.env);
  if (session instanceof Response) return session;
  const limit = normalizeLimit(ctx.url.searchParams.get("limit"), {
    defaultValue: DEFAULT_PROFILE_SOCIAL_LIMIT,
    maxValue: MAX_PROFILE_SOCIAL_LIMIT,
  });
  const rows = await ctx.env.DB.prepare(
    `SELECT follows.id,
            follows.created_at,
            profiles.display_name AS followed_display_name
     FROM profile_follows follows
     LEFT JOIN profiles ON profiles.user_id = follows.followed_user_id
     WHERE follows.follower_user_id = ?
     ORDER BY follows.created_at DESC, follows.id DESC
     LIMIT ?`
  ).bind(session.user.id, limit).all();
  return json({
    ok: true,
    data: {
      items: (rows.results || []).map((row) => toFollowInteractionRecord(row, "following")),
      applied_limit: limit,
    },
  });
}

async function handleProfileLikes(ctx) {
  const session = await requireUser(ctx.request, ctx.env);
  if (session instanceof Response) return session;
  const limit = normalizeLimit(ctx.url.searchParams.get("limit"), {
    defaultValue: DEFAULT_PROFILE_SOCIAL_LIMIT,
    maxValue: MAX_PROFILE_SOCIAL_LIMIT,
  });
  const rows = await ctx.env.DB.prepare(
    `SELECT *
     FROM (
       SELECT likes.id AS like_id,
              likes.created_at AS like_created_at,
              profiles.display_name AS liker_display_name,
              images.id,
              'mempics' AS media_type,
              COALESCE(images.published_at, images.created_at) AS order_at,
              images.created_at,
              images.published_at,
              images.r2_key,
              images.thumb_key,
              images.medium_key,
              images.thumb_width,
              images.thumb_height,
              images.medium_width,
              images.medium_height,
              images.derivatives_version,
              images.derivatives_ready_at,
              owner_profiles.display_name AS owner_display_name,
              (SELECT COUNT(*) FROM public_media_comments comments WHERE comments.media_type = 'mempics' AND comments.media_id = images.id) AS comment_count,
              (SELECT COUNT(*) FROM public_media_likes media_likes WHERE media_likes.media_type = 'mempics' AND media_likes.media_id = images.id) AS like_count,
              NULL AS title,
              NULL AS source_module,
              NULL AS mime_type,
              NULL AS metadata_json,
              NULL AS size_bytes,
              NULL AS poster_r2_key,
              NULL AS poster_width,
              NULL AS poster_height
       FROM public_media_likes likes
       INNER JOIN ai_images images ON images.id = likes.media_id
       LEFT JOIN profiles profiles ON profiles.user_id = likes.user_id
       LEFT JOIN profiles owner_profiles ON owner_profiles.user_id = images.user_id
       WHERE likes.media_type = 'mempics'
         AND images.user_id = ?
         AND images.visibility = 'public'
       UNION ALL
       SELECT likes.id AS like_id,
              likes.created_at AS like_created_at,
              profiles.display_name AS liker_display_name,
              assets.id,
              CASE assets.source_module WHEN 'video' THEN 'memvids' ELSE 'memtracks' END AS media_type,
              COALESCE(assets.published_at, assets.created_at) AS order_at,
              assets.created_at,
              assets.published_at,
              assets.r2_key,
              NULL AS thumb_key,
              NULL AS medium_key,
              NULL AS thumb_width,
              NULL AS thumb_height,
              NULL AS medium_width,
              NULL AS medium_height,
              NULL AS derivatives_version,
              NULL AS derivatives_ready_at,
              owner_profiles.display_name AS owner_display_name,
              (SELECT COUNT(*) FROM public_media_comments comments WHERE comments.media_type = CASE assets.source_module WHEN 'video' THEN 'memvids' ELSE 'memtracks' END AND comments.media_id = assets.id) AS comment_count,
              (SELECT COUNT(*) FROM public_media_likes media_likes WHERE media_likes.media_type = CASE assets.source_module WHEN 'video' THEN 'memvids' ELSE 'memtracks' END AND media_likes.media_id = assets.id) AS like_count,
              assets.title,
              assets.source_module,
              assets.mime_type,
              assets.metadata_json,
              assets.size_bytes,
              assets.poster_r2_key,
              assets.poster_width,
              assets.poster_height
       FROM public_media_likes likes
       INNER JOIN ai_text_assets assets ON assets.id = likes.media_id
       LEFT JOIN profiles profiles ON profiles.user_id = likes.user_id
       LEFT JOIN profiles owner_profiles ON owner_profiles.user_id = assets.user_id
       WHERE assets.user_id = ?
         AND assets.visibility = 'public'
         AND (
           (likes.media_type = 'memvids' AND assets.source_module = 'video')
           OR (likes.media_type = 'memtracks' AND assets.source_module = 'music')
         )
     ) likes
     ORDER BY like_created_at DESC, like_id DESC
     LIMIT ?`
  ).bind(session.user.id, session.user.id, limit).all();
  return json({
    ok: true,
    data: {
      items: (rows.results || []).map(toReceivedLikeRecord),
      applied_limit: limit,
    },
  });
}

async function handleProfilePublishedMedia(ctx) {
  const session = await requireUser(ctx.request, ctx.env);
  if (session instanceof Response) return session;
  const limit = normalizeLimit(ctx.url.searchParams.get("limit"), {
    defaultValue: DEFAULT_PROFILE_MEDIA_LIMIT,
    maxValue: MAX_PROFILE_MEDIA_LIMIT,
  });
  const rows = await ctx.env.DB.prepare(
    `SELECT *
     FROM (
       SELECT images.id,
              'mempics' AS media_type,
              COALESCE(images.published_at, images.created_at) AS order_at,
              images.created_at,
              images.published_at,
              images.r2_key,
              images.thumb_key,
              images.medium_key,
              images.thumb_width,
              images.thumb_height,
              images.medium_width,
              images.medium_height,
              images.derivatives_version,
              images.derivatives_ready_at,
              profiles.display_name AS owner_display_name,
              (SELECT COUNT(*) FROM public_media_comments comments WHERE comments.media_type = 'mempics' AND comments.media_id = images.id) AS comment_count,
              (SELECT COUNT(*) FROM public_media_likes media_likes WHERE media_likes.media_type = 'mempics' AND media_likes.media_id = images.id) AS like_count,
              NULL AS title,
              NULL AS source_module,
              NULL AS mime_type,
              NULL AS metadata_json,
              NULL AS size_bytes,
              NULL AS poster_r2_key,
              NULL AS poster_width,
              NULL AS poster_height
       FROM ai_images images
       LEFT JOIN profiles profiles ON profiles.user_id = images.user_id
       WHERE images.user_id = ?
         AND images.visibility = 'public'
         AND images.derivatives_status = 'ready'
       UNION ALL
       SELECT assets.id,
              CASE assets.source_module WHEN 'video' THEN 'memvids' ELSE 'memtracks' END AS media_type,
              COALESCE(assets.published_at, assets.created_at) AS order_at,
              assets.created_at,
              assets.published_at,
              assets.r2_key,
              NULL AS thumb_key,
              NULL AS medium_key,
              NULL AS thumb_width,
              NULL AS thumb_height,
              NULL AS medium_width,
              NULL AS medium_height,
              NULL AS derivatives_version,
              NULL AS derivatives_ready_at,
              profiles.display_name AS owner_display_name,
              (SELECT COUNT(*) FROM public_media_comments comments WHERE comments.media_type = CASE assets.source_module WHEN 'video' THEN 'memvids' ELSE 'memtracks' END AND comments.media_id = assets.id) AS comment_count,
              (SELECT COUNT(*) FROM public_media_likes media_likes WHERE media_likes.media_type = CASE assets.source_module WHEN 'video' THEN 'memvids' ELSE 'memtracks' END AND media_likes.media_id = assets.id) AS like_count,
              assets.title,
              assets.source_module,
              assets.mime_type,
              assets.metadata_json,
              assets.size_bytes,
              assets.poster_r2_key,
              assets.poster_width,
              assets.poster_height
       FROM ai_text_assets assets
       LEFT JOIN profiles profiles ON profiles.user_id = assets.user_id
       WHERE assets.user_id = ?
         AND assets.visibility = 'public'
         AND assets.source_module IN ('video', 'music')
     ) media
     ORDER BY order_at DESC, created_at DESC, id DESC
     LIMIT ?`
  ).bind(session.user.id, session.user.id, limit).all();
  return json({
    ok: true,
    data: {
      items: (rows.results || []).map((row) => toProfileMediaRecord(row)),
      applied_limit: limit,
    },
  });
}

async function handleProfileLikedMedia(ctx) {
  const session = await requireUser(ctx.request, ctx.env);
  if (session instanceof Response) return session;
  const limit = normalizeLimit(ctx.url.searchParams.get("limit"), {
    defaultValue: DEFAULT_PROFILE_MEDIA_LIMIT,
    maxValue: MAX_PROFILE_MEDIA_LIMIT,
  });
  const rows = await ctx.env.DB.prepare(
    `SELECT *
     FROM (
       SELECT images.id,
              'mempics' AS media_type,
              likes.created_at AS liked_at,
              images.created_at,
              images.published_at,
              images.r2_key,
              images.thumb_key,
              images.medium_key,
              images.thumb_width,
              images.thumb_height,
              images.medium_width,
              images.medium_height,
              images.derivatives_version,
              images.derivatives_ready_at,
              profiles.display_name AS owner_display_name,
              (SELECT COUNT(*) FROM public_media_comments comments WHERE comments.media_type = 'mempics' AND comments.media_id = images.id) AS comment_count,
              (SELECT COUNT(*) FROM public_media_likes media_likes WHERE media_likes.media_type = 'mempics' AND media_likes.media_id = images.id) AS like_count,
              NULL AS title,
              NULL AS source_module,
              NULL AS mime_type,
              NULL AS metadata_json,
              NULL AS size_bytes,
              NULL AS poster_r2_key,
              NULL AS poster_width,
              NULL AS poster_height
       FROM public_media_likes likes
       INNER JOIN ai_images images ON images.id = likes.media_id
       LEFT JOIN profiles profiles ON profiles.user_id = images.user_id
       WHERE likes.user_id = ?
         AND likes.media_type = 'mempics'
         AND images.visibility = 'public'
       UNION ALL
       SELECT assets.id,
              CASE assets.source_module WHEN 'video' THEN 'memvids' ELSE 'memtracks' END AS media_type,
              likes.created_at AS liked_at,
              assets.created_at,
              assets.published_at,
              assets.r2_key,
              NULL AS thumb_key,
              NULL AS medium_key,
              NULL AS thumb_width,
              NULL AS thumb_height,
              NULL AS medium_width,
              NULL AS medium_height,
              NULL AS derivatives_version,
              NULL AS derivatives_ready_at,
              profiles.display_name AS owner_display_name,
              (SELECT COUNT(*) FROM public_media_comments comments WHERE comments.media_type = CASE assets.source_module WHEN 'video' THEN 'memvids' ELSE 'memtracks' END AND comments.media_id = assets.id) AS comment_count,
              (SELECT COUNT(*) FROM public_media_likes media_likes WHERE media_likes.media_type = CASE assets.source_module WHEN 'video' THEN 'memvids' ELSE 'memtracks' END AND media_likes.media_id = assets.id) AS like_count,
              assets.title,
              assets.source_module,
              assets.mime_type,
              assets.metadata_json,
              assets.size_bytes,
              assets.poster_r2_key,
              assets.poster_width,
              assets.poster_height
       FROM public_media_likes likes
       INNER JOIN ai_text_assets assets ON assets.id = likes.media_id
       LEFT JOIN profiles profiles ON profiles.user_id = assets.user_id
       WHERE likes.user_id = ?
         AND assets.visibility = 'public'
         AND (
           (likes.media_type = 'memvids' AND assets.source_module = 'video')
           OR (likes.media_type = 'memtracks' AND assets.source_module = 'music')
         )
     ) media
     ORDER BY liked_at DESC, id DESC
     LIMIT ?`
  ).bind(session.user.id, session.user.id, limit).all();
  return json({
    ok: true,
    data: {
      items: (rows.results || []).map((row) => toProfileMediaRecord(row, { likedAt: row.liked_at || null })),
      applied_limit: limit,
    },
  });
}

export async function handleMediaInteractions(ctx) {
  const { pathname, method } = ctx;

  const route = parseGalleryInteractionRoute(pathname);
  if (route?.action === "interactions" && method === "GET") {
    return handleInteractionState(ctx, route.mediaType, route.mediaId);
  }
  // route-policy: gallery.media.like.create
  if (route?.action === "like" && method === "POST") {
    return handleLike(ctx, route.mediaType, route.mediaId, true);
  }
  // route-policy: gallery.media.like.delete
  if (route?.action === "like" && method === "DELETE") {
    return handleLike(ctx, route.mediaType, route.mediaId, false);
  }
  // route-policy: gallery.media.follow.create
  if (route?.action === "follow" && method === "POST") {
    return handleFollow(ctx, route.mediaType, route.mediaId, true);
  }
  // route-policy: gallery.media.follow.delete
  if (route?.action === "follow" && method === "DELETE") {
    return handleFollow(ctx, route.mediaType, route.mediaId, false);
  }

  if (pathname === "/api/profile/social/summary" && method === "GET") {
    return handleProfileSummary(ctx);
  }
  if (pathname === "/api/profile/social/followers" && method === "GET") {
    return handleProfileFollowers(ctx);
  }
  if (pathname === "/api/profile/social/following" && method === "GET") {
    return handleProfileFollowing(ctx);
  }
  if (pathname === "/api/profile/social/likes" && method === "GET") {
    return handleProfileLikes(ctx);
  }
  if (pathname === "/api/profile/media/published" && method === "GET") {
    return handleProfilePublishedMedia(ctx);
  }
  if (pathname === "/api/profile/media/liked" && method === "GET") {
    return handleProfileLikedMedia(ctx);
  }

  return null;
}
