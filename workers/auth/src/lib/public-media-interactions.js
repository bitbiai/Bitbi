import {
  buildPublicMempicUrl,
  buildPublicMempicVersion,
  buildPublicMemtrackUrl,
  buildPublicMemtrackVersion,
  buildPublicMemvidUrl,
  buildPublicMemvidVersion,
} from "../../../../js/shared/public-media-contract.mjs";
import {
  isPublicMediaCommentType,
  publicMediaCommentEntryForImage,
  publicMediaCommentEntryForTextAsset,
  publicMediaTypeForTextAssetSourceModule,
} from "./public-media-comments.js";
import { avatarKey } from "./profile-avatar-state.js";
import { buildPublicMediaHeaders } from "./public-media.js";

const TEXT_MEDIA_LABELS = Object.freeze({
  video: "Memvid",
  music: "Memtrack",
});

export function buildDeletePublicMediaLikesStatements(env, entries = []) {
  const seen = new Set();
  const statements = [];
  for (const entry of entries) {
    const mediaType = String(entry?.mediaType || entry?.media_type || "");
    const mediaId = String(entry?.mediaId || entry?.media_id || "");
    if (!isPublicMediaCommentType(mediaType) || !mediaId) continue;
    const key = `${mediaType}:${mediaId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    statements.push(
      env.DB.prepare(
        "DELETE FROM public_media_likes WHERE media_type = ? AND media_id = ?"
      ).bind(mediaType, mediaId)
    );
  }
  return statements;
}

export async function deletePublicMediaLikes(env, { mediaType, mediaId } = {}) {
  if (!isPublicMediaCommentType(mediaType) || !mediaId) return { deleted: 0 };
  const result = await env.DB.prepare(
    "DELETE FROM public_media_likes WHERE media_type = ? AND media_id = ?"
  ).bind(mediaType, mediaId).run();
  return { deleted: Number(result?.meta?.changes || 0) };
}

export function publicMediaLikeEntryForImage(rowOrId) {
  return publicMediaCommentEntryForImage(rowOrId);
}

export function publicMediaLikeEntryForTextAsset(rowOrId, sourceModule = null) {
  return publicMediaCommentEntryForTextAsset(rowOrId, sourceModule);
}

function normalizeDisplayName(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 50) || "a bitbi member";
}

function buildProfileInteractionAvatarVersion(avatarUpdatedAt) {
  const timestamp = Date.parse(String(avatarUpdatedAt || ""));
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  return `av${timestamp.toString(36)}`;
}

function parseMetadataJson(raw) {
  if (!raw || raw === "{}") return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function buildLikeCountQueryForTarget() {
  return "SELECT COUNT(*) AS count FROM public_media_likes WHERE media_type = ? AND media_id = ?";
}

export async function getPublicMediaLikeCount(env, mediaType, mediaId) {
  if (!isPublicMediaCommentType(mediaType) || !mediaId) return 0;
  const row = await env.DB.prepare(buildLikeCountQueryForTarget()).bind(mediaType, mediaId).first();
  return Number(row?.count || 0);
}

export async function getPublicMediaViewerLiked(env, mediaType, mediaId, userId) {
  if (!userId || !isPublicMediaCommentType(mediaType) || !mediaId) return false;
  const row = await env.DB.prepare(
    `SELECT 1 AS liked
     FROM public_media_likes
     WHERE user_id = ?
       AND media_type = ?
       AND media_id = ?
     LIMIT 1`
  ).bind(userId, mediaType, mediaId).first();
  return Boolean(row);
}

export async function getFollowState(env, { followerUserId, followedUserId } = {}) {
  if (!followerUserId || !followedUserId || followerUserId === followedUserId) return false;
  const row = await env.DB.prepare(
    `SELECT 1 AS following
     FROM profile_follows
     WHERE follower_user_id = ?
       AND followed_user_id = ?
     LIMIT 1`
  ).bind(followerUserId, followedUserId).first();
  return Boolean(row);
}

export async function countFollowers(env, userId) {
  if (!userId) return 0;
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM profile_follows WHERE followed_user_id = ?"
  ).bind(userId).first();
  return Number(row?.count || 0);
}

export async function countFollowing(env, userId) {
  if (!userId) return 0;
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM profile_follows WHERE follower_user_id = ?"
  ).bind(userId).first();
  return Number(row?.count || 0);
}

export async function countPublishedMedia(env, userId) {
  if (!userId) return 0;
  const [imageRow, textRow] = await Promise.all([
    env.DB.prepare(
      "SELECT COUNT(*) AS count FROM ai_images WHERE user_id = ? AND visibility = 'public'"
    ).bind(userId).first(),
    env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM ai_text_assets
       WHERE user_id = ?
         AND visibility = 'public'
         AND source_module IN ('video', 'music')`
    ).bind(userId).first(),
  ]);
  return Number(imageRow?.count || 0) + Number(textRow?.count || 0);
}

export async function countReceivedLikes(env, userId) {
  if (!userId) return 0;
  const [imageRow, videoRow, musicRow] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM public_media_likes likes
       INNER JOIN ai_images images ON images.id = likes.media_id
       WHERE likes.media_type = 'mempics'
         AND images.user_id = ?
         AND images.visibility = 'public'`
    ).bind(userId).first(),
    env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM public_media_likes likes
       INNER JOIN ai_text_assets assets ON assets.id = likes.media_id
       WHERE likes.media_type = 'memvids'
         AND assets.user_id = ?
         AND assets.visibility = 'public'
         AND assets.source_module = 'video'`
    ).bind(userId).first(),
    env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM public_media_likes likes
       INNER JOIN ai_text_assets assets ON assets.id = likes.media_id
       WHERE likes.media_type = 'memtracks'
         AND assets.user_id = ?
         AND assets.visibility = 'public'
         AND assets.source_module = 'music'`
    ).bind(userId).first(),
  ]);
  return Number(imageRow?.count || 0) + Number(videoRow?.count || 0) + Number(musicRow?.count || 0);
}

export async function countLikedMedia(env, userId) {
  if (!userId) return 0;
  const [imageRow, videoRow, musicRow] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM public_media_likes likes
       INNER JOIN ai_images images ON images.id = likes.media_id
       WHERE likes.user_id = ?
         AND likes.media_type = 'mempics'
         AND images.visibility = 'public'`
    ).bind(userId).first(),
    env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM public_media_likes likes
       INNER JOIN ai_text_assets assets ON assets.id = likes.media_id
       WHERE likes.user_id = ?
         AND likes.media_type = 'memvids'
         AND assets.visibility = 'public'
         AND assets.source_module = 'video'`
    ).bind(userId).first(),
    env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM public_media_likes likes
       INNER JOIN ai_text_assets assets ON assets.id = likes.media_id
       WHERE likes.user_id = ?
         AND likes.media_type = 'memtracks'
         AND assets.visibility = 'public'
         AND assets.source_module = 'music'`
    ).bind(userId).first(),
  ]);
  return Number(imageRow?.count || 0) + Number(videoRow?.count || 0) + Number(musicRow?.count || 0);
}

function toActor(row, prefix = "actor", interactionKind = "") {
  const actor = {
    display_name: normalizeDisplayName(row?.[`${prefix}_display_name`]),
  };
  const version = Number(row?.[`${prefix}_has_avatar`])
    ? buildProfileInteractionAvatarVersion(row?.[`${prefix}_avatar_updated_at`])
    : null;
  if (version && row?.id && interactionKind) {
    actor.avatar = {
      url: `/api/profile/social/${interactionKind}/${row.id}/${version}/avatar`,
    };
  }
  return actor;
}

export function toFollowInteractionRecord(row, type) {
  return {
    id: row.id,
    type,
    created_at: row.created_at,
    actor: type === "followers"
      ? toActor(row, "follower", "followers")
      : toActor(row, "followed", "following"),
  };
}

function buildImageRecord(row, { likedAt = null } = {}) {
  const version = buildPublicMempicVersion(row);
  return {
    id: row.id,
    media_type: "mempics",
    collection: "mempics",
    title: "Mempics",
    caption: row.caption || "",
    published_at: row.published_at || null,
    liked_at: likedAt,
    comment_count: Number(row.comment_count || 0),
    like_count: Number(row.like_count || 0),
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
    publisher: {
      display_name: normalizeDisplayName(row.owner_display_name),
    },
  };
}

function buildTextRecord(row, { likedAt = null } = {}) {
  const mediaType = publicMediaTypeForTextAssetSourceModule(row.source_module);
  const meta = parseMetadataJson(row.metadata_json);
  const isVideo = mediaType === "memvids";
  const version = isVideo ? buildPublicMemvidVersion(row) : buildPublicMemtrackVersion(row);
  const urlBuilder = isVideo ? buildPublicMemvidUrl : buildPublicMemtrackUrl;
  const record = {
    id: row.id,
    media_type: mediaType,
    collection: mediaType,
    title: row.title || TEXT_MEDIA_LABELS[row.source_module] || "Media",
    caption: row.caption || "",
    published_at: row.published_at || null,
    liked_at: likedAt,
    comment_count: Number(row.comment_count || 0),
    like_count: Number(row.like_count || 0),
    mime_type: row.mime_type || (isVideo ? "video/mp4" : "audio/mpeg"),
    size_bytes: Number(row.size_bytes) || null,
    file: {
      url: urlBuilder(row.id, version, "file"),
    },
    publisher: {
      display_name: normalizeDisplayName(row.owner_display_name),
    },
  };
  if (row.poster_r2_key) {
    record.poster = {
      url: urlBuilder(row.id, version, "poster"),
      w: row.poster_width ?? null,
      h: row.poster_height ?? null,
    };
  }
  const durationSeconds = Number(meta.duration_seconds ?? meta.audio?.duration_seconds ?? 0);
  const durationMs = Number(meta.duration_ms ?? meta.audio?.duration_ms ?? 0);
  record.duration_seconds = Number.isFinite(durationSeconds) && durationSeconds > 0
    ? durationSeconds
    : (Number.isFinite(durationMs) && durationMs > 0 ? durationMs / 1000 : null);
  if (meta.aspect_ratio) record.aspect_ratio = meta.aspect_ratio;
  if (Number.isFinite(Number(meta.width)) && Number.isFinite(Number(meta.height))) {
    record.width = Number(meta.width);
    record.height = Number(meta.height);
  }
  return record;
}

export function toProfileMediaRecord(row, { likedAt = null } = {}) {
  if (row.media_type === "mempics") return buildImageRecord(row, { likedAt });
  return buildTextRecord(row, { likedAt });
}

export function toReceivedLikeRecord(row) {
  return {
    id: row.like_id,
    type: "likes",
    created_at: row.like_created_at,
    actor: toActor({ ...row, id: row.like_id }, "liker", "likes"),
    media: toProfileMediaRecord(row),
  };
}

export function hasMatchingProfileInteractionAvatarVersion(row, version) {
  return version === buildProfileInteractionAvatarVersion(row?.avatar_updated_at);
}

async function getProfileInteractionAvatarProfileRow(env, userId) {
  if (!userId) return null;
  return env.DB.prepare(
    `SELECT user_id,
            has_avatar,
            avatar_updated_at
     FROM profiles
     WHERE user_id = ?
     LIMIT 1`
  ).bind(userId).first();
}

async function getProfileInteractionAvatarUserId(env, sessionUserId, kind, interactionId) {
  if (kind === "followers") {
    const row = await env.DB.prepare(
      `SELECT follower_user_id AS avatar_user_id
       FROM profile_follows
       WHERE id = ?
         AND followed_user_id = ?
       LIMIT 1`
    ).bind(interactionId, sessionUserId).first();
    return row?.avatar_user_id || null;
  }
  if (kind === "following") {
    const row = await env.DB.prepare(
      `SELECT followed_user_id AS avatar_user_id
       FROM profile_follows
       WHERE id = ?
         AND follower_user_id = ?
       LIMIT 1`
    ).bind(interactionId, sessionUserId).first();
    return row?.avatar_user_id || null;
  }
  if (kind !== "likes") return null;
  const like = await env.DB.prepare(
    `SELECT id,
            media_type,
            media_id,
            user_id
     FROM public_media_likes
     WHERE id = ?
     LIMIT 1`
  ).bind(interactionId).first();
  if (!like?.user_id || !isPublicMediaCommentType(like.media_type)) return null;
  if (like.media_type === "mempics") {
    const media = await env.DB.prepare(
      `SELECT id
       FROM ai_images
       WHERE id = ?
         AND user_id = ?
         AND visibility = 'public'
       LIMIT 1`
    ).bind(like.media_id, sessionUserId).first();
    return media ? like.user_id : null;
  }
  const sourceModule = like.media_type === "memvids" ? "video" : "music";
  const media = await env.DB.prepare(
    `SELECT id
     FROM ai_text_assets
     WHERE id = ?
       AND user_id = ?
       AND visibility = 'public'
       AND source_module = ?
     LIMIT 1`
  ).bind(like.media_id, sessionUserId, sourceModule).first();
  return media ? like.user_id : null;
}

export async function serveProfileInteractionAvatar(ctx, { kind, interactionId, version, sessionUserId } = {}) {
  if (!["followers", "following", "likes"].includes(kind) || !interactionId || !sessionUserId) return null;
  const avatarUserId = await getProfileInteractionAvatarUserId(ctx.env, sessionUserId, kind, interactionId);
  const profile = await getProfileInteractionAvatarProfileRow(ctx.env, avatarUserId);
  if (
    !profile?.user_id ||
    !Number(profile.has_avatar) ||
    !hasMatchingProfileInteractionAvatarVersion(profile, version)
  ) {
    return null;
  }

  const object = await ctx.env.PRIVATE_MEDIA.get(avatarKey(profile.user_id));
  if (!object) return null;

  return new Response(
    object.body,
    {
      headers: buildPublicMediaHeaders(
        object.httpMetadata?.contentType || "image/webp",
        object.size,
        { immutable: false }
      ),
    }
  );
}
