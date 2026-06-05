import { avatarKey } from "./profile-avatar-state.js";
import { buildPublicMediaHeaders } from "./public-media.js";

export const PUBLIC_MEDIA_COMMENT_TYPES = Object.freeze(["mempics", "memvids", "memtracks"]);
export const PUBLIC_MEDIA_COMMENT_MAX_BODY_LENGTH = 1000;
export const PUBLIC_MEDIA_COMMENT_DEFAULT_LIMIT = 30;
export const PUBLIC_MEDIA_COMMENT_MAX_LIMIT = 50;

const PUBLIC_MEDIA_TYPE_TO_TEXT_SOURCE_MODULE = Object.freeze({
  memvids: "video",
  memtracks: "music",
});

function buildPublicPublisherAvatarVersion(avatarUpdatedAt) {
  const timestamp = Date.parse(String(avatarUpdatedAt || ""));
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  return `av${timestamp.toString(36)}`;
}

export function isPublicMediaCommentType(value) {
  return PUBLIC_MEDIA_COMMENT_TYPES.includes(String(value || ""));
}

export function isPublicMediaId(value) {
  return typeof value === "string" && /^[a-f0-9]+$/.test(value);
}

export function publicMediaTypeForTextAssetSourceModule(sourceModule) {
  const normalized = String(sourceModule || "").trim().toLowerCase();
  if (normalized === "video") return "memvids";
  if (normalized === "music") return "memtracks";
  return null;
}

export function normalizePublicMediaCommentBody(value) {
  const normalized = String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return { value: "", error: "Comment is required." };
  }
  if (normalized.length > PUBLIC_MEDIA_COMMENT_MAX_BODY_LENGTH) {
    return {
      value: "",
      error: `Comment must be ${PUBLIC_MEDIA_COMMENT_MAX_BODY_LENGTH} characters or fewer.`,
    };
  }
  return { value: normalized, error: null };
}

export async function getPublicMediaTarget(env, mediaType, mediaId) {
  if (!isPublicMediaCommentType(mediaType) || !isPublicMediaId(mediaId)) return null;
  if (mediaType === "mempics") {
    return env.DB.prepare(
      `SELECT id,
              user_id,
              created_at,
              published_at,
              'mempics' AS media_type
       FROM ai_images
       WHERE id = ?
         AND visibility = 'public'
       LIMIT 1`
    ).bind(mediaId).first();
  }

  const sourceModule = PUBLIC_MEDIA_TYPE_TO_TEXT_SOURCE_MODULE[mediaType];
  if (!sourceModule) return null;
  return env.DB.prepare(
    `SELECT id,
            user_id,
            created_at,
            published_at,
            source_module,
            ? AS media_type
     FROM ai_text_assets
     WHERE id = ?
       AND visibility = 'public'
       AND source_module = ?
     LIMIT 1`
  ).bind(mediaType, mediaId, sourceModule).first();
}

export function buildDeletePublicMediaCommentsStatements(env, entries = []) {
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
        "DELETE FROM public_media_comments WHERE media_type = ? AND media_id = ?"
      ).bind(mediaType, mediaId)
    );
  }
  return statements;
}

export async function deletePublicMediaComments(env, { mediaType, mediaId } = {}) {
  if (!isPublicMediaCommentType(mediaType) || !mediaId) return { deleted: 0 };
  const result = await env.DB.prepare(
    "DELETE FROM public_media_comments WHERE media_type = ? AND media_id = ?"
  ).bind(mediaType, mediaId).run();
  return { deleted: Number(result?.meta?.changes || 0) };
}

export async function deletePublicMediaCommentsForMany(env, entries = []) {
  const statements = buildDeletePublicMediaCommentsStatements(env, entries);
  if (!statements.length) return { deleted: 0 };
  const results = await env.DB.batch(statements);
  return {
    deleted: results.reduce((sum, result) => sum + Number(result?.meta?.changes || 0), 0),
  };
}

export function publicMediaCommentEntryForImage(rowOrId) {
  const mediaId = typeof rowOrId === "string" ? rowOrId : rowOrId?.id;
  return mediaId ? { mediaType: "mempics", mediaId } : null;
}

export function publicMediaCommentEntryForTextAsset(rowOrId, sourceModule = null) {
  const mediaId = typeof rowOrId === "string" ? rowOrId : rowOrId?.id;
  const mediaType = publicMediaTypeForTextAssetSourceModule(sourceModule || rowOrId?.source_module);
  return mediaId && mediaType ? { mediaType, mediaId } : null;
}

function buildInPlaceholders(values) {
  return values.map(() => "?").join(",");
}

export async function loadPublicMediaCountsByUser(env, userIds = []) {
  const ids = Array.from(new Set((userIds || []).filter(Boolean)));
  const counts = new Map(ids.map((id) => [id, 0]));
  if (!ids.length) return counts;
  const placeholders = buildInPlaceholders(ids);

  const imageRows = await env.DB.prepare(
    `SELECT user_id, COUNT(*) AS count
     FROM ai_images
     WHERE visibility = 'public'
       AND user_id IN (${placeholders})
     GROUP BY user_id`
  ).bind(...ids).all();
  for (const row of imageRows.results || []) {
    counts.set(row.user_id, Number(counts.get(row.user_id) || 0) + Number(row.count || 0));
  }

  try {
    const textRows = await env.DB.prepare(
      `SELECT user_id, COUNT(*) AS count
       FROM ai_text_assets
       WHERE visibility = 'public'
         AND source_module IN ('video', 'music')
         AND user_id IN (${placeholders})
       GROUP BY user_id`
    ).bind(...ids).all();
    for (const row of textRows.results || []) {
      counts.set(row.user_id, Number(counts.get(row.user_id) || 0) + Number(row.count || 0));
    }
  } catch (error) {
    if (!String(error?.message || error).includes("no such table")) throw error;
  }

  return counts;
}

export async function loadPublicMediaCommentCounts(env, mediaType, mediaIds = []) {
  const ids = Array.from(new Set((mediaIds || []).filter(Boolean)));
  const counts = new Map(ids.map((id) => [id, 0]));
  if (!isPublicMediaCommentType(mediaType) || !ids.length) return counts;
  const placeholders = buildInPlaceholders(ids);
  try {
    const rows = await env.DB.prepare(
      `SELECT media_id, COUNT(*) AS count
       FROM public_media_comments
       WHERE media_type = ?
         AND media_id IN (${placeholders})
       GROUP BY media_id`
    ).bind(mediaType, ...ids).all();
    for (const row of rows.results || []) {
      counts.set(row.media_id, Number(row.count || 0));
    }
  } catch (error) {
    if (!String(error?.message || error).includes("no such table")) throw error;
  }
  return counts;
}

export function toPublicCommentAuthor(row) {
  const displayName = String(row?.author_display_name || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 50) || "a bitbi member";
  const author = { display_name: displayName };
  const version = Number(row?.author_has_avatar)
    ? buildPublicPublisherAvatarVersion(row?.author_avatar_updated_at)
    : null;
  if (version && row?.id) {
    author.avatar = {
      url: `/api/gallery/comments/${row.id}/${version}/avatar`,
    };
  }
  return author;
}

export function toPublicMediaCommentRecord(row) {
  return {
    id: row.id,
    body: row.body,
    created_at: row.created_at,
    author: toPublicCommentAuthor(row),
  };
}

export function hasMatchingCommentAvatarVersion(row, version) {
  return version === buildPublicPublisherAvatarVersion(row?.avatar_updated_at);
}

export async function getPublicMediaCommentAvatarRow(env, commentId) {
  return env.DB.prepare(
    `SELECT comments.id,
            comments.media_type,
            comments.media_id,
            comments.user_id,
            profiles.has_avatar,
            profiles.avatar_updated_at
     FROM public_media_comments comments
     LEFT JOIN profiles ON profiles.user_id = comments.user_id
     WHERE comments.id = ?
     LIMIT 1`
  ).bind(commentId).first();
}

export async function servePublicMediaCommentAvatar(ctx, commentId, version) {
  const row = await getPublicMediaCommentAvatarRow(ctx.env, commentId);
  if (
    !row?.user_id ||
    !Number(row.has_avatar) ||
    !hasMatchingCommentAvatarVersion(row, version)
  ) {
    return null;
  }

  const target = await getPublicMediaTarget(ctx.env, row.media_type, row.media_id);
  if (!target) return null;

  const object = await ctx.env.PRIVATE_MEDIA.get(avatarKey(row.user_id));
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
