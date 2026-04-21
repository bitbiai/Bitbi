import { nowIso } from "./tokens.js";

export function avatarKey(userId) {
  return `avatars/${userId}`;
}

function toAvatarPresence(value) {
  if (value === null || value === undefined) return null;
  return !!Number(value);
}

export async function persistAvatarPresence(
  env,
  userId,
  hasAvatar,
  {
    updatedAt = nowIso(),
    avatarUpdatedAt = hasAvatar ? updatedAt : null,
  } = {}
) {
  await env.DB.prepare(
    `INSERT INTO profiles (user_id, display_name, bio, website, youtube_url, has_avatar, avatar_updated_at, created_at, updated_at)
     VALUES (?, '', '', '', '', ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       has_avatar = excluded.has_avatar,
       avatar_updated_at = CASE
         WHEN excluded.has_avatar = 0 THEN NULL
         WHEN excluded.avatar_updated_at IS NOT NULL THEN excluded.avatar_updated_at
         ELSE profiles.avatar_updated_at
       END,
       updated_at = excluded.updated_at`
  )
    .bind(
      userId,
      hasAvatar ? 1 : 0,
      avatarUpdatedAt,
      updatedAt,
      updatedAt
    )
    .run();
}

export async function resolveCachedAvatarPresence(env, userId, storedState) {
  const cached = toAvatarPresence(storedState);
  if (cached !== null) return cached;

  let object = null;
  try {
    object = await env.PRIVATE_MEDIA.get(avatarKey(userId));
  } catch {
    return false;
  }
  const hasAvatar = !!object;
  await persistAvatarPresence(env, userId, hasAvatar, { avatarUpdatedAt: null });
  return hasAvatar;
}
