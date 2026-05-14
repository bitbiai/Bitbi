import { nowIso } from "../../lib/tokens.js";
import { listAiImageObjectKeys } from "../../lib/ai-image-derivatives.js";
import {
  releaseUserAssetStorage,
  sumAssetStorageBytes,
} from "../../lib/asset-storage-quota.js";
import {
  buildBulkDeleteFinalStateGuardSql,
  buildBulkMoveFinalStateGuardSql,
  buildCleanupQueueBindings,
  buildCleanupQueueInsertValuesSql,
  buildRequestedValuesList,
  isBulkStateGuardError,
  isMissingTextAssetTableError,
} from "./helpers.js";

const CLEANUP_QUEUE_BATCH_SIZE = 100;

export class AiAssetLifecycleError extends Error {
  constructor(message, status, options = {}) {
    super(message);
    this.name = "AiAssetLifecycleError";
    this.status = status;
    this.branch = options.branch || null;
    this.details = options.details || null;
    this.cause = options.cause;
  }
}

function isMissingAiImageTableError(error) {
  return String(error || "").includes("no such table") && String(error || "").includes("ai_images");
}

function chunkValues(values, size = CLEANUP_QUEUE_BATCH_SIZE) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function dedupeCleanupKeys(keys) {
  return Array.from(new Set((keys || []).filter(Boolean)));
}

function listAiTextAssetObjectKeys(row) {
  return dedupeCleanupKeys([row?.r2_key, row?.poster_r2_key]);
}

function collectCleanupKeys(imageRows = [], textRows = []) {
  return dedupeCleanupKeys([
    ...imageRows.flatMap((row) => listAiImageObjectKeys(row)),
    ...textRows.flatMap((row) => listAiTextAssetObjectKeys(row)),
  ]);
}

async function releaseDeletedAssetStorage(env, userId, imageRows = [], textRows = []) {
  const deletedBytes = sumAssetStorageBytes(imageRows) + sumAssetStorageBytes(textRows);
  if (!deletedBytes) return;
  try {
    await releaseUserAssetStorage(env, { userId, bytes: deletedBytes });
  } catch {
    // Deletion must remain available even if quota bookkeeping needs later reconciliation.
  }
}

function buildCleanupQueueStatements(env, cleanupKeys, createdAt) {
  const statements = [];
  for (const chunk of chunkValues(dedupeCleanupKeys(cleanupKeys))) {
    statements.push(
      env.DB.prepare(
        buildCleanupQueueInsertValuesSql(chunk)
      ).bind(...buildCleanupQueueBindings(chunk, createdAt))
    );
  }
  return statements;
}

async function clearPendingCleanupEntries(env, cleanupKeys) {
  const uniqueKeys = dedupeCleanupKeys(cleanupKeys);
  for (const chunk of chunkValues(uniqueKeys)) {
    const placeholders = chunk.map(() => "?").join(",");
    await env.DB.prepare(
      `DELETE FROM r2_cleanup_queue WHERE r2_key IN (${placeholders}) AND status = 'pending'`
    ).bind(...chunk).run();
  }
}

async function attemptInlineCleanup(env, cleanupKeys) {
  const cleanedKeys = [];
  for (const key of dedupeCleanupKeys(cleanupKeys)) {
    try {
      await env.USER_IMAGES.delete(key);
      cleanedKeys.push(key);
    } catch {
      // Leave the durable queue entry for scheduled retry.
    }
  }

  if (cleanedKeys.length > 0) {
    try {
      await clearPendingCleanupEntries(env, cleanedKeys);
    } catch {
      // Scheduled cleanup will safely retry any remaining queue rows.
    }
  }

  return cleanedKeys;
}

function toBatchFailure(error, {
  unavailableMessage,
  failureMessage,
  conflictMessage = null,
  branch = null,
  details = null,
}) {
  if (error instanceof AiAssetLifecycleError) {
    return error;
  }
  const unavailable = String(error).includes("no such table");
  if (conflictMessage && isBulkStateGuardError(error)) {
    return new AiAssetLifecycleError(conflictMessage, 409, {
      branch: branch || "final_state_guard_failed",
      details,
      cause: error,
    });
  }
  return new AiAssetLifecycleError(
    unavailable ? unavailableMessage : failureMessage,
    unavailable ? 503 : 500,
    {
      branch: unavailable ? "service_unavailable" : (branch || "batch_error"),
      details,
      cause: error,
    }
  );
}

async function executeLifecycleBatch({
  env,
  cleanupKeys,
  mutationStatements,
  createdAt = nowIso(),
  unavailableMessage,
  failureMessage,
  conflictMessage = null,
  conflictBranch = null,
  details = null,
}) {
  const queueStatements = buildCleanupQueueStatements(env, cleanupKeys, createdAt);
  let batchResults;
  try {
    batchResults = await env.DB.batch([
      ...queueStatements,
      ...mutationStatements,
    ]);
  } catch (error) {
    throw toBatchFailure(error, {
      unavailableMessage,
      failureMessage,
      conflictMessage,
      branch: conflictBranch,
      details,
    });
  }

  return {
    mutationResults: batchResults.slice(queueStatements.length),
    cleanupKeys: dedupeCleanupKeys(cleanupKeys),
  };
}

async function executeMutationBatch({
  env,
  statements,
  unavailableMessage,
  failureMessage,
  conflictMessage = null,
  conflictBranch = null,
  details = null,
}) {
  try {
    return await env.DB.batch(statements);
  } catch (error) {
    throw toBatchFailure(error, {
      unavailableMessage,
      failureMessage,
      conflictMessage,
      branch: conflictBranch,
      details,
    });
  }
}

function buildAiImageDeleteStatement(env, userId, imageId) {
  return env.DB.prepare(
    "DELETE FROM ai_images WHERE id = ? AND user_id = ?"
  ).bind(imageId, userId);
}

function buildAiTextAssetDeleteStatement(env, userId, assetId) {
  return env.DB.prepare(
    "DELETE FROM ai_text_assets WHERE id = ? AND user_id = ?"
  ).bind(assetId, userId);
}

async function loadOwnedAiImageRowsByIds(env, userId, imageIds) {
  const placeholders = imageIds.map(() => "?").join(",");
  try {
    const result = await env.DB.prepare(
      `SELECT id, r2_key, thumb_key, medium_key, size_bytes FROM ai_images WHERE id IN (${placeholders}) AND user_id = ?`
    ).bind(...imageIds, userId).all();
    return result.results || [];
  } catch (error) {
    if (isMissingAiImageTableError(error)) {
      throw new AiAssetLifecycleError("Service temporarily unavailable. Please try again later.", 503, {
        branch: "service_unavailable",
        cause: error,
      });
    }
    throw error;
  }
}

async function loadOwnedAiTextAssetRowsByIds(env, userId, assetIds, { allowMissingTable = false } = {}) {
  const placeholders = assetIds.map(() => "?").join(",");
  try {
    const result = await env.DB.prepare(
      `SELECT id, r2_key, poster_r2_key, size_bytes, poster_size_bytes FROM ai_text_assets WHERE id IN (${placeholders}) AND user_id = ?`
    ).bind(...assetIds, userId).all();
    return result.results || [];
  } catch (error) {
    if (allowMissingTable && isMissingTextAssetTableError(error)) {
      return [];
    }
    if (isMissingTextAssetTableError(error)) {
      throw new AiAssetLifecycleError("Text asset service unavailable.", 503, {
        branch: "service_unavailable",
        cause: error,
      });
    }
    throw error;
  }
}

async function loadUserAiImages(env, userId) {
  try {
    const result = await env.DB.prepare(
      "SELECT r2_key, thumb_key, medium_key, size_bytes FROM ai_images WHERE user_id = ?"
    ).bind(userId).all();
    return result.results || [];
  } catch (error) {
    if (isMissingAiImageTableError(error)) {
      throw new AiAssetLifecycleError("Service temporarily unavailable. Please try again later.", 503, {
        branch: "service_unavailable",
        cause: error,
      });
    }
    throw error;
  }
}

async function loadFolderAiImages(env, userId, folderId) {
  try {
    const result = await env.DB.prepare(
      "SELECT r2_key, thumb_key, medium_key, size_bytes FROM ai_images WHERE folder_id = ? AND user_id = ?"
    ).bind(folderId, userId).all();
    return result.results || [];
  } catch (error) {
    if (isMissingAiImageTableError(error)) {
      throw new AiAssetLifecycleError("Service temporarily unavailable. Please try again later.", 503, {
        branch: "service_unavailable",
        cause: error,
      });
    }
    throw error;
  }
}

async function loadUserAiTextAssets(env, userId, { allowMissingTable = false } = {}) {
  try {
    const result = await env.DB.prepare(
      "SELECT r2_key, poster_r2_key, size_bytes, poster_size_bytes FROM ai_text_assets WHERE user_id = ?"
    ).bind(userId).all();
    return result.results || [];
  } catch (error) {
    if (allowMissingTable && isMissingTextAssetTableError(error)) {
      return [];
    }
    if (isMissingTextAssetTableError(error)) {
      throw new AiAssetLifecycleError("Text asset service unavailable. Please try again later.", 503, {
        branch: "service_unavailable",
        cause: error,
      });
    }
    throw error;
  }
}

async function loadFolderAiTextAssets(env, userId, folderId, { allowMissingTable = false } = {}) {
  try {
    const result = await env.DB.prepare(
      "SELECT r2_key, poster_r2_key, size_bytes, poster_size_bytes FROM ai_text_assets WHERE folder_id = ? AND user_id = ?"
    ).bind(folderId, userId).all();
    return result.results || [];
  } catch (error) {
    if (allowMissingTable && isMissingTextAssetTableError(error)) {
      return [];
    }
    if (isMissingTextAssetTableError(error)) {
      throw new AiAssetLifecycleError("Text asset service unavailable. Please try again later.", 503, {
        branch: "service_unavailable",
        cause: error,
      });
    }
    throw error;
  }
}

async function ensureActiveFolder(env, userId, folderId, details = null) {
  const folder = await env.DB.prepare(
    "SELECT id FROM ai_folders WHERE id = ? AND user_id = ? AND status = 'active'"
  ).bind(folderId, userId).first();

  if (!folder) {
    throw new AiAssetLifecycleError("Folder not found.", 404, {
      branch: "folder_not_found",
      details,
    });
  }
}

function buildImageMoveStatement(env, userId, imageIds, folderId) {
  const valuesList = buildRequestedValuesList(imageIds);
  if (folderId) {
    return env.DB.prepare(
      `WITH requested(id) AS (VALUES ${valuesList})
       UPDATE ai_images SET folder_id = ?
       WHERE user_id = ?
         AND id IN (SELECT id FROM requested)
         AND (SELECT COUNT(*) FROM requested) =
             (SELECT COUNT(*) FROM ai_images WHERE user_id = ? AND id IN (SELECT id FROM requested))
         AND EXISTS (SELECT 1 FROM ai_folders WHERE id = ? AND user_id = ? AND status = 'active')`
    ).bind(...imageIds, folderId, userId, userId, folderId, userId);
  }

  return env.DB.prepare(
    `WITH requested(id) AS (VALUES ${valuesList})
     UPDATE ai_images SET folder_id = NULL
     WHERE user_id = ?
       AND id IN (SELECT id FROM requested)
       AND (SELECT COUNT(*) FROM requested) =
           (SELECT COUNT(*) FROM ai_images WHERE user_id = ? AND id IN (SELECT id FROM requested))`
  ).bind(...imageIds, userId, userId);
}

function buildTextAssetMoveStatement(env, userId, assetIds, folderId) {
  const valuesList = buildRequestedValuesList(assetIds);
  if (folderId) {
    return env.DB.prepare(
      `WITH requested(id) AS (VALUES ${valuesList})
       UPDATE ai_text_assets SET folder_id = ?
       WHERE user_id = ?
         AND id IN (SELECT id FROM requested)
         AND (SELECT COUNT(*) FROM requested) =
             (SELECT COUNT(*) FROM ai_text_assets WHERE user_id = ? AND id IN (SELECT id FROM requested))
         AND EXISTS (SELECT 1 FROM ai_folders WHERE id = ? AND user_id = ? AND status = 'active')`
    ).bind(...assetIds, folderId, userId, userId, folderId, userId);
  }

  return env.DB.prepare(
    `WITH requested(id) AS (VALUES ${valuesList})
     UPDATE ai_text_assets SET folder_id = NULL
     WHERE user_id = ?
       AND id IN (SELECT id FROM requested)
       AND (SELECT COUNT(*) FROM requested) =
           (SELECT COUNT(*) FROM ai_text_assets WHERE user_id = ? AND id IN (SELECT id FROM requested))`
  ).bind(...assetIds, userId, userId);
}

function buildImageDeleteStatementForIds(env, userId, imageIds) {
  const valuesList = buildRequestedValuesList(imageIds);
  return env.DB.prepare(
    `WITH requested(id) AS (VALUES ${valuesList})
     DELETE FROM ai_images
     WHERE user_id = ?
       AND id IN (SELECT id FROM requested)
       AND (SELECT COUNT(*) FROM requested) =
           (SELECT COUNT(*) FROM ai_images WHERE user_id = ? AND id IN (SELECT id FROM requested))`
  ).bind(...imageIds, userId, userId);
}

function buildTextAssetDeleteStatementForIds(env, userId, assetIds) {
  const valuesList = buildRequestedValuesList(assetIds);
  return env.DB.prepare(
    `WITH requested(id) AS (VALUES ${valuesList})
     DELETE FROM ai_text_assets
     WHERE user_id = ?
       AND id IN (SELECT id FROM requested)
       AND (SELECT COUNT(*) FROM requested) =
           (SELECT COUNT(*) FROM ai_text_assets WHERE user_id = ? AND id IN (SELECT id FROM requested))`
  ).bind(...assetIds, userId, userId);
}

export async function deleteUserAiImage({ env, userId, imageId }) {
  let row;
  try {
    row = await env.DB.prepare(
      "SELECT r2_key, thumb_key, medium_key, size_bytes FROM ai_images WHERE id = ? AND user_id = ?"
    ).bind(imageId, userId).first();
  } catch (error) {
    if (isMissingAiImageTableError(error)) {
      throw new AiAssetLifecycleError("Service temporarily unavailable. Please try again later.", 503, {
        branch: "service_unavailable",
        cause: error,
      });
    }
    throw error;
  }

  if (!row) {
    throw new AiAssetLifecycleError("Image not found.", 404, {
      branch: "asset_not_found",
    });
  }

  const { mutationResults, cleanupKeys } = await executeLifecycleBatch({
    env,
    cleanupKeys: collectCleanupKeys([row], []),
    mutationStatements: [buildAiImageDeleteStatement(env, userId, imageId)],
    unavailableMessage: "Service temporarily unavailable. Please try again later.",
    failureMessage: "Delete failed. Please try again.",
  });

  const deleted = mutationResults[0]?.meta?.changes || 0;
  if (deleted !== 1) {
    throw new AiAssetLifecycleError("Delete failed. Image may have already been removed.", 409, {
      branch: "delete_conflict",
    });
  }

  await attemptInlineCleanup(env, cleanupKeys);
  await releaseDeletedAssetStorage(env, userId, [row], []);
}

export async function deleteUserAiTextAsset({ env, userId, assetId }) {
  let row;
  try {
    row = await env.DB.prepare(
      "SELECT r2_key, poster_r2_key, size_bytes, poster_size_bytes FROM ai_text_assets WHERE id = ? AND user_id = ?"
    ).bind(assetId, userId).first();
  } catch (error) {
    if (isMissingTextAssetTableError(error)) {
      throw new AiAssetLifecycleError("Text asset service unavailable.", 503, {
        branch: "service_unavailable",
        cause: error,
      });
    }
    throw error;
  }

  if (!row) {
    throw new AiAssetLifecycleError("Text asset not found.", 404, {
      branch: "asset_not_found",
    });
  }

  const { mutationResults, cleanupKeys } = await executeLifecycleBatch({
    env,
    cleanupKeys: collectCleanupKeys([], [row]),
    mutationStatements: [buildAiTextAssetDeleteStatement(env, userId, assetId)],
    unavailableMessage: "Text asset service unavailable. Please try again later.",
    failureMessage: "Delete failed. Please try again.",
  });

  const deleted = mutationResults[0]?.meta?.changes || 0;
  if (deleted !== 1) {
    throw new AiAssetLifecycleError("Delete failed. Text asset may have already been removed.", 409, {
      branch: "delete_conflict",
    });
  }

  await attemptInlineCleanup(env, cleanupKeys);
  await releaseDeletedAssetStorage(env, userId, [], [row]);
}

export async function moveUserAiAssets({ env, userId, assetIds, folderId = null }) {
  const details = {
    matched_owned_ai_images_count: 0,
    matched_owned_ai_text_assets_count: 0,
    updated_ai_images_count: 0,
    updated_ai_text_assets_count: 0,
    folder_exists_owned: folderId ? false : null,
  };

  if (folderId) {
    await ensureActiveFolder(env, userId, folderId, details);
    details.folder_exists_owned = true;
  }

  const imageRows = await loadOwnedAiImageRowsByIds(env, userId, assetIds);
  const textRows = await loadOwnedAiTextAssetRowsByIds(env, userId, assetIds, { allowMissingTable: true });
  const imageIds = imageRows.map((row) => row.id);
  const textIds = textRows.map((row) => row.id);

  details.matched_owned_ai_images_count = imageIds.length;
  details.matched_owned_ai_text_assets_count = textIds.length;

  if (imageIds.length + textIds.length !== assetIds.length) {
    throw new AiAssetLifecycleError("One or more assets not found.", 404, {
      branch: "asset_match_count_mismatch",
      details,
    });
  }

  const statements = [];
  let imageUpdateIndex = -1;
  let textUpdateIndex = -1;

  if (imageIds.length > 0) {
    imageUpdateIndex = statements.length;
    statements.push(buildImageMoveStatement(env, userId, imageIds, folderId));
  }

  if (textIds.length > 0) {
    textUpdateIndex = statements.length;
    statements.push(buildTextAssetMoveStatement(env, userId, textIds, folderId));
  }

  const finalStateGuard = buildBulkMoveFinalStateGuardSql(userId, imageIds, textIds, folderId);
  statements.push(
    env.DB.prepare(finalStateGuard.sql).bind(...finalStateGuard.bindings)
  );

  const batchResults = await executeMutationBatch({
    env,
    statements,
    unavailableMessage: "Service temporarily unavailable. Please try again later.",
    failureMessage: "Move failed. Please try again.",
    conflictMessage: "Move failed. Some assets may have been deleted or the folder removed.",
    conflictBranch: "final_state_guard_failed",
    details,
  });

  details.updated_ai_images_count = imageUpdateIndex >= 0
    ? (batchResults[imageUpdateIndex]?.meta?.changes || 0)
    : 0;
  details.updated_ai_text_assets_count = textUpdateIndex >= 0
    ? (batchResults[textUpdateIndex]?.meta?.changes || 0)
    : 0;

  return {
    moved: assetIds.length,
    ...details,
  };
}

export async function moveUserAiImages({ env, userId, imageIds, folderId = null }) {
  const details = {
    matched_owned_ai_images_count: 0,
    updated_ai_images_count: 0,
    folder_exists_owned: folderId ? false : null,
  };

  if (folderId) {
    await ensureActiveFolder(env, userId, folderId, details);
    details.folder_exists_owned = true;
  }

  const imageRows = await loadOwnedAiImageRowsByIds(env, userId, imageIds);
  const matchedIds = imageRows.map((row) => row.id);
  details.matched_owned_ai_images_count = matchedIds.length;
  if (matchedIds.length !== imageIds.length) {
    throw new AiAssetLifecycleError("One or more images not found.", 404, {
      branch: "asset_match_count_mismatch",
      details,
    });
  }

  const statements = [
    buildImageMoveStatement(env, userId, matchedIds, folderId),
  ];
  const finalStateGuard = buildBulkMoveFinalStateGuardSql(userId, matchedIds, [], folderId);
  statements.push(
    env.DB.prepare(finalStateGuard.sql).bind(...finalStateGuard.bindings)
  );

  const batchResults = await executeMutationBatch({
    env,
    statements,
    unavailableMessage: "Service temporarily unavailable. Please try again later.",
    failureMessage: "Move failed. Please try again.",
    conflictMessage: "Move failed. Some images may have been deleted or the folder removed.",
    conflictBranch: "final_state_guard_failed",
    details,
  });

  details.updated_ai_images_count = batchResults[0]?.meta?.changes || 0;

  return {
    moved: imageIds.length,
    ...details,
  };
}

export async function deleteUserAiAssets({ env, userId, assetIds, createdAt = nowIso() }) {
  const details = {
    matched_owned_ai_images_count: 0,
    matched_owned_ai_text_assets_count: 0,
    deleted_ai_images_count: 0,
    deleted_ai_text_assets_count: 0,
  };

  const imageRows = await loadOwnedAiImageRowsByIds(env, userId, assetIds);
  const textRows = await loadOwnedAiTextAssetRowsByIds(env, userId, assetIds, { allowMissingTable: true });
  const imageIds = imageRows.map((row) => row.id);
  const textIds = textRows.map((row) => row.id);

  details.matched_owned_ai_images_count = imageIds.length;
  details.matched_owned_ai_text_assets_count = textIds.length;

  if (imageIds.length + textIds.length !== assetIds.length) {
    throw new AiAssetLifecycleError("One or more assets not found.", 404, {
      branch: "asset_match_count_mismatch",
      details,
    });
  }

  const mutationStatements = [];
  let imageDeleteIndex = -1;
  let textDeleteIndex = -1;

  if (imageIds.length > 0) {
    imageDeleteIndex = mutationStatements.length;
    mutationStatements.push(buildImageDeleteStatementForIds(env, userId, imageIds));
  }

  if (textIds.length > 0) {
    textDeleteIndex = mutationStatements.length;
    mutationStatements.push(buildTextAssetDeleteStatementForIds(env, userId, textIds));
  }

  const finalStateGuard = buildBulkDeleteFinalStateGuardSql(userId, imageIds, textIds);
  mutationStatements.push(
    env.DB.prepare(finalStateGuard.sql).bind(...finalStateGuard.bindings)
  );

  const { mutationResults, cleanupKeys } = await executeLifecycleBatch({
    env,
    cleanupKeys: collectCleanupKeys(imageRows, textRows),
    mutationStatements,
    createdAt,
    unavailableMessage: "Service temporarily unavailable. Please try again later.",
    failureMessage: "Delete failed. Please try again.",
    conflictMessage: "Delete failed. Some assets may have already been removed.",
    conflictBranch: "final_state_guard_failed",
    details,
  });

  details.deleted_ai_images_count = imageDeleteIndex >= 0
    ? (mutationResults[imageDeleteIndex]?.meta?.changes || 0)
    : 0;
  details.deleted_ai_text_assets_count = textDeleteIndex >= 0
    ? (mutationResults[textDeleteIndex]?.meta?.changes || 0)
    : 0;

  await attemptInlineCleanup(env, cleanupKeys);
  await releaseDeletedAssetStorage(env, userId, imageRows, textRows);

  return {
    deleted: assetIds.length,
    ...details,
  };
}

export async function deleteUserAiImages({ env, userId, imageIds, createdAt = nowIso() }) {
  const details = {
    matched_owned_ai_images_count: 0,
    deleted_ai_images_count: 0,
  };

  const imageRows = await loadOwnedAiImageRowsByIds(env, userId, imageIds);
  const matchedIds = imageRows.map((row) => row.id);
  details.matched_owned_ai_images_count = matchedIds.length;

  if (matchedIds.length !== imageIds.length) {
    throw new AiAssetLifecycleError("One or more images not found.", 404, {
      branch: "asset_match_count_mismatch",
      details,
    });
  }

  const { mutationResults, cleanupKeys } = await executeLifecycleBatch({
    env,
    cleanupKeys: collectCleanupKeys(imageRows, []),
    mutationStatements: [buildImageDeleteStatementForIds(env, userId, matchedIds)],
    createdAt,
    unavailableMessage: "Service temporarily unavailable. Please try again later.",
    failureMessage: "Delete failed. Please try again.",
  });

  details.deleted_ai_images_count = mutationResults[0]?.meta?.changes || 0;
  if (details.deleted_ai_images_count !== imageIds.length) {
    throw new AiAssetLifecycleError("Delete failed. Some images may have already been removed.", 409, {
      branch: "delete_conflict",
      details,
    });
  }

  await attemptInlineCleanup(env, cleanupKeys);
  await releaseDeletedAssetStorage(env, userId, imageRows, []);

  return {
    deleted: details.deleted_ai_images_count,
    ...details,
  };
}

export async function deleteUserAiFolder({ env, userId, folderId, createdAt = nowIso() }) {
  const markResult = await env.DB.prepare(
    "UPDATE ai_folders SET status = 'deleting' WHERE id = ? AND user_id = ? AND status IN ('active', 'deleting')"
  ).bind(folderId, userId).run();

  if (!markResult.meta.changes) {
    throw new AiAssetLifecycleError("Folder not found.", 404, {
      branch: "folder_not_found",
    });
  }

  try {
    const imageRows = await loadFolderAiImages(env, userId, folderId);
    const textRows = await loadFolderAiTextAssets(env, userId, folderId, { allowMissingTable: true });
    const mutationStatements = [
      env.DB.prepare("DELETE FROM ai_images WHERE folder_id = ? AND user_id = ?").bind(folderId, userId),
    ];

    if (textRows.length > 0) {
      mutationStatements.push(
        env.DB.prepare("DELETE FROM ai_text_assets WHERE folder_id = ? AND user_id = ?").bind(folderId, userId)
      );
    }

    mutationStatements.push(
      env.DB.prepare("DELETE FROM ai_folders WHERE id = ? AND user_id = ?").bind(folderId, userId)
    );

    const { cleanupKeys } = await executeLifecycleBatch({
      env,
      cleanupKeys: collectCleanupKeys(imageRows, textRows),
      mutationStatements,
      createdAt,
      unavailableMessage: "Service temporarily unavailable. Please try again later.",
      failureMessage: "Failed to delete folder. Please try again.",
    });
    await attemptInlineCleanup(env, cleanupKeys);
    await releaseDeletedAssetStorage(env, userId, imageRows, textRows);
  } catch (error) {
    try {
      await env.DB.prepare(
        "UPDATE ai_folders SET status = 'active' WHERE id = ? AND user_id = ? AND status = 'deleting'"
      ).bind(folderId, userId).run();
    } catch {}
    throw error;
  }
}

export async function deleteAllUserAiAssets({
  env,
  userId,
  additionalStatements = [],
  createdAt = nowIso(),
}) {
  const imageRows = await loadUserAiImages(env, userId);
  const textRows = await loadUserAiTextAssets(env, userId, { allowMissingTable: true });
  const mutationStatements = [
    env.DB.prepare("DELETE FROM ai_images WHERE user_id = ?").bind(userId),
  ];

  if (textRows.length > 0) {
    mutationStatements.push(
      env.DB.prepare("DELETE FROM ai_text_assets WHERE user_id = ?").bind(userId)
    );
  }

  mutationStatements.push(
    env.DB.prepare("DELETE FROM ai_folders WHERE user_id = ?").bind(userId),
    ...additionalStatements
  );

  const { cleanupKeys } = await executeLifecycleBatch({
    env,
    cleanupKeys: collectCleanupKeys(imageRows, textRows),
    mutationStatements,
    createdAt,
    unavailableMessage: "Service temporarily unavailable. Please try again later.",
    failureMessage: "Failed to delete user. Please try again.",
  });
  await attemptInlineCleanup(env, cleanupKeys);
  await releaseDeletedAssetStorage(env, userId, imageRows, textRows);
}
