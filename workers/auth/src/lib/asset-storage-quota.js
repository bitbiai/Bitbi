import { json } from "./response.js";
import { nowIso } from "./tokens.js";

export const USER_ASSET_STORAGE_LIMIT_BYTES = 50 * 1024 * 1024;
export const ASSET_STORAGE_LIMIT_EXCEEDED_CODE = "asset_storage_limit_exceeded";

const STORAGE_LIMIT_REACHED_MESSAGE =
  "Speicherlimit erreicht. Jeder Benutzer kann maximal 50 MB im Assets Manager speichern. Bitte lösche bestehende Assets, um Speicherplatz freizugeben.";

function isMissingQuotaTableError(error) {
  return String(error || "").includes("no such table")
    && String(error || "").includes("user_asset_storage_usage");
}

function isMissingTextAssetTableError(error) {
  return String(error || "").includes("no such table")
    && String(error || "").includes("ai_text_assets");
}

function normalizeByteCount(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.floor(number);
}

function quotaServiceError(message = "Asset storage quota is temporarily unavailable.") {
  const error = new Error(message);
  error.status = 503;
  error.code = "asset_storage_quota_unavailable";
  return error;
}

function invalidUploadSizeError() {
  const error = new Error("Upload size could not be determined.");
  error.status = 400;
  error.code = "validation_error";
  return error;
}

export class AssetStorageQuotaError extends Error {
  constructor({
    limitBytes = USER_ASSET_STORAGE_LIMIT_BYTES,
    usedBytes = 0,
    attemptedUploadBytes = 0,
  } = {}) {
    super(STORAGE_LIMIT_REACHED_MESSAGE);
    this.name = "AssetStorageQuotaError";
    this.status = 413;
    this.code = ASSET_STORAGE_LIMIT_EXCEEDED_CODE;
    this.limitBytes = normalizeByteCount(limitBytes) ?? USER_ASSET_STORAGE_LIMIT_BYTES;
    this.usedBytes = normalizeByteCount(usedBytes) ?? 0;
    this.attemptedUploadBytes = normalizeByteCount(attemptedUploadBytes) ?? 0;
    this.remainingBytes = Math.max(0, this.limitBytes - this.usedBytes);
  }
}

export function isAssetStorageQuotaError(error) {
  return error instanceof AssetStorageQuotaError
    || error?.code === ASSET_STORAGE_LIMIT_EXCEEDED_CODE
    || error?.code === "asset_storage_quota_unavailable";
}

export function assetStorageQuotaErrorBody(error) {
  return {
    ok: false,
    error: error?.message || STORAGE_LIMIT_REACHED_MESSAGE,
    code: error?.code || ASSET_STORAGE_LIMIT_EXCEEDED_CODE,
    limitBytes: error?.limitBytes ?? USER_ASSET_STORAGE_LIMIT_BYTES,
    usedBytes: error?.usedBytes ?? 0,
    attemptedUploadBytes: error?.attemptedUploadBytes ?? 0,
    remainingBytes: error?.remainingBytes ?? Math.max(0, USER_ASSET_STORAGE_LIMIT_BYTES - Number(error?.usedBytes || 0)),
  };
}

export function assetStorageQuotaErrorResponse(error) {
  return json(assetStorageQuotaErrorBody(error), { status: error?.status || 413 });
}

async function getObjectSizeBytes(env, r2Key) {
  if (!r2Key) return 0;
  if (!env?.USER_IMAGES || typeof env.USER_IMAGES.head !== "function") {
    throw quotaServiceError();
  }
  const object = await env.USER_IMAGES.head(r2Key);
  if (!object) return 0;
  const size = normalizeByteCount(object.size);
  if (size === null) throw quotaServiceError();
  return size;
}

export function normalizeAssetStorageByteCount(value) {
  return normalizeByteCount(value);
}

export async function getAssetStorageObjectSizeBytes(env, r2Key) {
  return getObjectSizeBytes(env, r2Key);
}

async function updateImageSizeBytes(env, { userId, imageId, sizeBytes }) {
  if (!imageId) return;
  await env.DB.prepare(
    "UPDATE ai_images SET size_bytes = ? WHERE id = ? AND user_id = ? AND size_bytes IS NULL"
  ).bind(sizeBytes, imageId, userId).run();
}

async function updateTextAssetPosterSizeBytes(env, { userId, assetId, sizeBytes }) {
  if (!assetId) return;
  await env.DB.prepare(
    "UPDATE ai_text_assets SET poster_size_bytes = ? WHERE id = ? AND user_id = ? AND poster_size_bytes IS NULL"
  ).bind(sizeBytes, assetId, userId).run();
}

async function calculateImageStorageUsage(env, userId) {
  const rows = await env.DB.prepare(
    "SELECT id, r2_key, size_bytes FROM ai_images WHERE user_id = ?"
  ).bind(userId).all();

  let total = 0;
  for (const row of rows.results || []) {
    let sizeBytes = normalizeByteCount(row.size_bytes);
    if (sizeBytes === null) {
      sizeBytes = await getObjectSizeBytes(env, row.r2_key);
      await updateImageSizeBytes(env, {
        userId,
        imageId: row.id,
        sizeBytes,
      });
    }
    total += sizeBytes;
  }
  return total;
}

async function calculateTextAssetStorageUsage(env, userId) {
  let rows;
  try {
    rows = await env.DB.prepare(
      "SELECT id, r2_key, poster_r2_key, size_bytes, poster_size_bytes FROM ai_text_assets WHERE user_id = ?"
    ).bind(userId).all();
  } catch (error) {
    if (isMissingTextAssetTableError(error)) return 0;
    throw error;
  }

  let total = 0;
  for (const row of rows.results || []) {
    let sizeBytes = normalizeByteCount(row.size_bytes);
    if (sizeBytes === null) {
      sizeBytes = await getObjectSizeBytes(env, row.r2_key);
    }
    total += sizeBytes;
    if (row.poster_r2_key) {
      let posterSizeBytes = normalizeByteCount(row.poster_size_bytes);
      if (posterSizeBytes === null) {
        posterSizeBytes = await getObjectSizeBytes(env, row.poster_r2_key);
        await updateTextAssetPosterSizeBytes(env, {
          userId,
          assetId: row.id,
          sizeBytes: posterSizeBytes,
        });
      }
      total += posterSizeBytes;
    }
  }
  return total;
}

export async function calculateUserAssetStorageUsage(env, userId) {
  return (await calculateImageStorageUsage(env, userId))
    + (await calculateTextAssetStorageUsage(env, userId));
}

export async function getUserAssetStorageUsageSnapshot(env, userId) {
  const usedBytes = await ensureUserAssetStorageUsage(env, userId);
  return {
    usedBytes,
    limitBytes: USER_ASSET_STORAGE_LIMIT_BYTES,
    remainingBytes: Math.max(0, USER_ASSET_STORAGE_LIMIT_BYTES - usedBytes),
  };
}

async function getStoredUsageBytes(env, userId) {
  try {
    const row = await env.DB.prepare(
      "SELECT used_bytes FROM user_asset_storage_usage WHERE user_id = ?"
    ).bind(userId).first();
    if (!row) return null;
    return normalizeByteCount(row.used_bytes) ?? 0;
  } catch (error) {
    if (isMissingQuotaTableError(error)) throw quotaServiceError();
    throw error;
  }
}

export async function ensureUserAssetStorageUsage(env, userId) {
  const stored = await getStoredUsageBytes(env, userId);
  if (stored !== null) return stored;

  const usedBytes = await calculateUserAssetStorageUsage(env, userId);
  const updatedAt = nowIso();
  try {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO user_asset_storage_usage (user_id, used_bytes, updated_at) VALUES (?, ?, ?)"
    ).bind(userId, usedBytes, updatedAt).run();
  } catch (error) {
    if (isMissingQuotaTableError(error)) throw quotaServiceError();
    throw error;
  }

  return await getStoredUsageBytes(env, userId) ?? usedBytes;
}

export async function reserveUserAssetStorage(env, { userId, uploadBytes }) {
  const attemptedUploadBytes = normalizeByteCount(uploadBytes);
  if (attemptedUploadBytes === null) throw invalidUploadSizeError();

  const usedBefore = await ensureUserAssetStorageUsage(env, userId);
  if (attemptedUploadBytes === 0) {
    return {
      limitBytes: USER_ASSET_STORAGE_LIMIT_BYTES,
      usedBytes: usedBefore,
      attemptedUploadBytes,
      remainingBytes: Math.max(0, USER_ASSET_STORAGE_LIMIT_BYTES - usedBefore),
    };
  }

  let result;
  try {
    result = await env.DB.prepare(
      `UPDATE user_asset_storage_usage
       SET used_bytes = used_bytes + ?, updated_at = ?
       WHERE user_id = ? AND used_bytes + ? <= ?`
    ).bind(
      attemptedUploadBytes,
      nowIso(),
      userId,
      attemptedUploadBytes,
      USER_ASSET_STORAGE_LIMIT_BYTES
    ).run();
  } catch (error) {
    if (isMissingQuotaTableError(error)) throw quotaServiceError();
    throw error;
  }

  if (result?.meta?.changes === 1) {
    const usedBytes = await getStoredUsageBytes(env, userId);
    return {
      limitBytes: USER_ASSET_STORAGE_LIMIT_BYTES,
      usedBytes: usedBytes ?? (usedBefore + attemptedUploadBytes),
      attemptedUploadBytes,
      remainingBytes: Math.max(0, USER_ASSET_STORAGE_LIMIT_BYTES - (usedBytes ?? (usedBefore + attemptedUploadBytes))),
    };
  }

  const currentUsed = await ensureUserAssetStorageUsage(env, userId);
  throw new AssetStorageQuotaError({
    usedBytes: currentUsed,
    attemptedUploadBytes,
  });
}

export async function releaseUserAssetStorage(env, { userId, bytes }) {
  const releaseBytes = normalizeByteCount(bytes);
  if (!releaseBytes) return;
  try {
    await env.DB.prepare(
      `UPDATE user_asset_storage_usage
       SET used_bytes = CASE WHEN used_bytes >= ? THEN used_bytes - ? ELSE 0 END,
           updated_at = ?
       WHERE user_id = ?`
    ).bind(releaseBytes, releaseBytes, nowIso(), userId).run();
  } catch (error) {
    if (isMissingQuotaTableError(error)) return;
    throw error;
  }
}

export function sumAssetStorageBytes(rows = []) {
  return rows.reduce((total, row) => total
    + (normalizeByteCount(row?.size_bytes) ?? 0)
    + (normalizeByteCount(row?.poster_size_bytes) ?? 0), 0);
}
