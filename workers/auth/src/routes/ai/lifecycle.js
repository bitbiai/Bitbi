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
import { logDiagnostic } from "../../../../../js/shared/worker-observability.mjs";
import {
  buildDeletePublicMediaCommentsStatements,
  publicMediaCommentEntryForImage,
  publicMediaCommentEntryForTextAsset,
} from "../../lib/public-media-comments.js";
import {
  buildDeletePublicMediaLikesStatements,
  publicMediaLikeEntryForImage,
  publicMediaLikeEntryForTextAsset,
} from "../../lib/public-media-interactions.js";

const CLEANUP_QUEUE_BATCH_SIZE = 100;

export class AiAssetLifecycleError extends Error {
  constructor(message, status, options = {}) {
    super(message);
    this.name = "AiAssetLifecycleError";
    this.status = status;
    this.branch = options.branch || null;
    this.code = options.code || options.branch || null;
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
      branch: unavailable ? (branch || "service_unavailable") : (branch || "batch_error"),
      details,
      cause: error,
    }
  );
}

function normalizeLifecycleStatement(entry, fallbackIndex) {
  if (entry?.statement) {
    return {
      statement: entry.statement,
      branch: entry.branch || `lifecycle_statement_${fallbackIndex}_failed`,
      label: entry.label || entry.branch || `lifecycle_statement_${fallbackIndex}`,
      category: entry.category || "lifecycle",
    };
  }
  return {
    statement: entry,
    branch: `lifecycle_statement_${fallbackIndex}_failed`,
    label: `lifecycle_statement_${fallbackIndex}`,
    category: "lifecycle",
  };
}

async function executeLabeledLifecycleStatements({
  env,
  cleanupKeys,
  mutationStatements,
  createdAt = nowIso(),
  unavailableMessage,
  failureMessage,
  details = null,
}) {
  const queueStatements = buildCleanupQueueStatements(env, cleanupKeys, createdAt).map((statement, index) => ({
    statement,
    branch: "cleanup_queue_insert_failed",
    label: `cleanup_queue_insert_${index + 1}`,
    category: "asset_cleanup_queue",
  }));
  const normalizedMutations = mutationStatements.map((entry, index) => (
    normalizeLifecycleStatement(entry, index + 1)
  ));
  const results = [];

  for (const item of [...queueStatements, ...normalizedMutations]) {
    try {
      results.push(await item.statement.run());
    } catch (error) {
      throw toBatchFailure(error, {
        unavailableMessage,
        failureMessage,
        branch: item.branch,
        details: {
          ...(details || {}),
          statement: item.label,
          category: item.category,
        },
      });
    }
  }

  return {
    mutationResults: results.slice(queueStatements.length),
    cleanupKeys: dedupeCleanupKeys(cleanupKeys),
  };
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

function buildPublicMediaCommentCleanupStatementsForImages(env, imageRows = []) {
  return buildDeletePublicMediaCommentsStatements(
    env,
    imageRows.map(publicMediaCommentEntryForImage).filter(Boolean)
  );
}

function buildPublicMediaCommentCleanupStatementsForTextAssets(env, textRows = []) {
  return buildDeletePublicMediaCommentsStatements(
    env,
    textRows.map(publicMediaCommentEntryForTextAsset).filter(Boolean)
  );
}

function buildPublicMediaLikeCleanupStatementsForImages(env, imageRows = []) {
  return buildDeletePublicMediaLikesStatements(
    env,
    imageRows.map(publicMediaLikeEntryForImage).filter(Boolean)
  );
}

function buildPublicMediaLikeCleanupStatementsForTextAssets(env, textRows = []) {
  return buildDeletePublicMediaLikesStatements(
    env,
    textRows.map(publicMediaLikeEntryForTextAsset).filter(Boolean)
  );
}

function isMissingHomepageHeroVideoTableError(error) {
  const message = String(error?.message || error || "");
  return message.includes("no such table") && message.includes("homepage_hero_video_");
}

function isMissingMemvidStreamPreviewTableError(error) {
  const message = String(error?.message || error || "");
  return message.includes("no such table") && message.includes("memvid_stream_preview");
}

async function loadHomepageHeroTextAssetLinks(env, { userId, assetId }) {
  const empty = {
    available: false,
    linkedUploadCount: 0,
    activeSlotCount: 0,
    derivativeCounts: {},
  };
  try {
    const [uploadRow, activeSlotRow, derivativeRows] = await Promise.all([
      env.DB.prepare(
        "SELECT COUNT(*) AS count FROM homepage_hero_video_uploads WHERE asset_id = ? AND user_id = ?"
      ).bind(assetId, userId).first(),
      env.DB.prepare(
        `SELECT COUNT(*) AS count
         FROM homepage_hero_video_slots slots
         LEFT JOIN homepage_hero_video_derivatives derivatives ON derivatives.id = slots.derivative_id
         WHERE slots.enabled = 1
           AND (
             (slots.source_type = 'admin_asset'
              AND slots.source_asset_id = ?
              AND (slots.source_user_id IS NULL OR slots.source_user_id = ?))
             OR
             (derivatives.source_type = 'admin_asset'
              AND derivatives.source_asset_id = ?
              AND (derivatives.source_user_id IS NULL OR derivatives.source_user_id = ?))
           )`
      ).bind(assetId, userId, assetId, userId).first(),
      env.DB.prepare(
        `SELECT status, COUNT(*) AS count
         FROM homepage_hero_video_derivatives
         WHERE source_type = 'admin_asset'
           AND source_asset_id = ?
           AND (source_user_id IS NULL OR source_user_id = ?)
         GROUP BY status`
      ).bind(assetId, userId).all(),
    ]);
    return {
      available: true,
      linkedUploadCount: Number(uploadRow?.count || 0),
      activeSlotCount: Number(activeSlotRow?.count || 0),
      derivativeCounts: Object.fromEntries((derivativeRows.results || []).map((row) => [
        row.status || "unknown",
        Number(row.count || 0),
      ])),
    };
  } catch (error) {
    if (isMissingHomepageHeroVideoTableError(error)) return empty;
    throw error;
  }
}

function buildHomepageHeroTextAssetCleanupStatements(env, { userId, assetId, links }) {
  if (!links?.available) return [];
  return [
    env.DB.prepare(
      `UPDATE homepage_hero_video_derivatives
       SET status = 'failed',
           error_code = COALESCE(error_code, 'source_deleted'),
           error_message = COALESCE(error_message, 'Source asset was deleted.'),
           updated_at = ?
       WHERE source_type = 'admin_asset'
         AND source_asset_id = ?
         AND (source_user_id IS NULL OR source_user_id = ?)
         AND status IN ('queued', 'processing')`
    ).bind(nowIso(), assetId, userId),
    env.DB.prepare(
      "DELETE FROM homepage_hero_video_uploads WHERE asset_id = ? AND user_id = ?"
    ).bind(assetId, userId),
  ];
}

function buildMemvidStreamPreviewCleanupStatements(env, { userId, assetId }) {
  return [
    env.DB.prepare(
      "DELETE FROM memvid_stream_preview_events WHERE asset_id = ?"
    ).bind(assetId),
    env.DB.prepare(
      "DELETE FROM memvid_stream_previews WHERE asset_id = ? AND user_id = ?"
    ).bind(assetId, userId),
  ];
}

async function textAssetStillExists(env, { userId, assetId }) {
  const row = await env.DB.prepare(
    "SELECT id FROM ai_text_assets WHERE id = ? AND user_id = ?"
  ).bind(assetId, userId).first();
  return Boolean(row);
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
      `SELECT id, source_module, r2_key, poster_r2_key, size_bytes, poster_size_bytes FROM ai_text_assets WHERE id IN (${placeholders}) AND user_id = ?`
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
      "SELECT id, r2_key, thumb_key, medium_key, size_bytes FROM ai_images WHERE user_id = ?"
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
      "SELECT id, r2_key, thumb_key, medium_key, size_bytes FROM ai_images WHERE folder_id = ? AND user_id = ?"
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
      "SELECT id, source_module, r2_key, poster_r2_key, size_bytes, poster_size_bytes FROM ai_text_assets WHERE user_id = ?"
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
      "SELECT id, source_module, r2_key, poster_r2_key, size_bytes, poster_size_bytes FROM ai_text_assets WHERE folder_id = ? AND user_id = ?"
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
      "SELECT id, r2_key, thumb_key, medium_key, size_bytes FROM ai_images WHERE id = ? AND user_id = ?"
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
    mutationStatements: [
      ...buildPublicMediaCommentCleanupStatementsForImages(env, [row]),
      ...buildPublicMediaLikeCleanupStatementsForImages(env, [row]),
      buildAiImageDeleteStatement(env, userId, imageId),
    ],
    unavailableMessage: "Service temporarily unavailable. Please try again later.",
    failureMessage: "Delete failed. Please try again.",
  });

  const deleted = mutationResults[mutationResults.length - 1]?.meta?.changes || 0;
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
      "SELECT id, source_module, r2_key, poster_r2_key, size_bytes, poster_size_bytes FROM ai_text_assets WHERE id = ? AND user_id = ?"
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
    return { code: "already_deleted", already_deleted: true, deleted: false };
  }

  const heroLinks = await loadHomepageHeroTextAssetLinks(env, { userId, assetId });
  if (heroLinks.activeSlotCount > 0) {
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-text-asset-delete",
      event: "manual_hero_source_delete_blocked",
      level: "warn",
      asset_id: assetId,
      user_id: userId,
      linked_upload_count: heroLinks.linkedUploadCount,
      active_slot_count: heroLinks.activeSlotCount,
      derivative_counts: heroLinks.derivativeCounts,
      final_row_exists: true,
    });
    throw new AiAssetLifecycleError(
      "This video is currently assigned to a Homepage Hero slot. Remove or replace it in Homepage Hero Videos before deleting.",
      409,
      {
        branch: "hero_source_in_use",
        code: "hero_source_in_use",
        details: {
          linked_upload_count: heroLinks.linkedUploadCount,
          active_slot_count: heroLinks.activeSlotCount,
          derivative_counts: heroLinks.derivativeCounts,
        },
      }
    );
  }

  const mutationStatements = [
    ...buildHomepageHeroTextAssetCleanupStatements(env, { userId, assetId, links: heroLinks }),
    ...buildMemvidStreamPreviewCleanupStatements(env, { userId, assetId }),
    ...buildPublicMediaCommentCleanupStatementsForTextAssets(env, [row]),
    ...buildPublicMediaLikeCleanupStatementsForTextAssets(env, [row]),
    buildAiTextAssetDeleteStatement(env, userId, assetId),
  ];

  let mutationResults = [];
  let cleanupKeys = [];
  try {
    const result = await executeLifecycleBatch({
      env,
      cleanupKeys: collectCleanupKeys([], [row]),
      mutationStatements,
      unavailableMessage: "Text asset service unavailable. Please try again later.",
      failureMessage: "Delete failed. Please try again.",
    });
    mutationResults = result.mutationResults;
    cleanupKeys = result.cleanupKeys;
  } catch (error) {
    if (!isMissingMemvidStreamPreviewTableError(error?.cause || error)) throw error;
    const result = await executeLifecycleBatch({
      env,
      cleanupKeys: collectCleanupKeys([], [row]),
      mutationStatements: [
        ...buildHomepageHeroTextAssetCleanupStatements(env, { userId, assetId, links: heroLinks }),
        ...buildPublicMediaCommentCleanupStatementsForTextAssets(env, [row]),
        ...buildPublicMediaLikeCleanupStatementsForTextAssets(env, [row]),
        buildAiTextAssetDeleteStatement(env, userId, assetId),
      ],
      unavailableMessage: "Text asset service unavailable. Please try again later.",
      failureMessage: "Delete failed. Please try again.",
    });
    mutationResults = result.mutationResults;
    cleanupKeys = result.cleanupKeys;
  }

  const deleteResult = mutationResults[mutationResults.length - 1];
  const deleted = deleteResult?.meta?.changes || 0;
  const finalRowExists = await textAssetStillExists(env, { userId, assetId });
  if (deleted !== 1 && finalRowExists) {
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-text-asset-delete",
      event: "manual_hero_source_delete_conflict",
      level: "warn",
      asset_id: assetId,
      user_id: userId,
      linked_upload_count: heroLinks.linkedUploadCount,
      active_slot_count: heroLinks.activeSlotCount,
      derivative_counts: heroLinks.derivativeCounts,
      final_row_exists: true,
      d1_delete_changes: deleted,
    });
    throw new AiAssetLifecycleError("Delete did not complete. Refresh the library and retry.", 409, {
      branch: "delete_conflict",
      code: "delete_conflict",
      details: {
        linked_upload_count: heroLinks.linkedUploadCount,
        active_slot_count: heroLinks.activeSlotCount,
        derivative_counts: heroLinks.derivativeCounts,
        final_row_exists: true,
        d1_delete_changes: deleted,
      },
    });
  }

  if (deleted !== 1) {
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-text-asset-delete",
      event: "text_asset_delete_confirmed_by_final_state",
      level: "info",
      asset_id: assetId,
      user_id: userId,
      linked_upload_count: heroLinks.linkedUploadCount,
      active_slot_count: heroLinks.activeSlotCount,
      derivative_counts: heroLinks.derivativeCounts,
      final_row_exists: false,
      d1_delete_changes: deleted,
    });
  }

  await attemptInlineCleanup(env, cleanupKeys);
  await releaseDeletedAssetStorage(env, userId, [], [row]);
  return { code: deleted === 1 ? "deleted" : "deleted_final_state", deleted: true, already_deleted: false };
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
    mutationStatements.push(...buildPublicMediaCommentCleanupStatementsForImages(env, imageRows));
    mutationStatements.push(...buildPublicMediaLikeCleanupStatementsForImages(env, imageRows));
    imageDeleteIndex = mutationStatements.length;
    mutationStatements.push(buildImageDeleteStatementForIds(env, userId, imageIds));
  }

  if (textIds.length > 0) {
    mutationStatements.push(...buildPublicMediaCommentCleanupStatementsForTextAssets(env, textRows));
    mutationStatements.push(...buildPublicMediaLikeCleanupStatementsForTextAssets(env, textRows));
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
    mutationStatements: [
      ...buildPublicMediaCommentCleanupStatementsForImages(env, imageRows),
      ...buildPublicMediaLikeCleanupStatementsForImages(env, imageRows),
      buildImageDeleteStatementForIds(env, userId, matchedIds),
    ],
    createdAt,
    unavailableMessage: "Service temporarily unavailable. Please try again later.",
    failureMessage: "Delete failed. Please try again.",
  });

  details.deleted_ai_images_count = mutationResults[mutationResults.length - 1]?.meta?.changes || 0;
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
      ...buildPublicMediaCommentCleanupStatementsForImages(env, imageRows),
      ...buildPublicMediaLikeCleanupStatementsForImages(env, imageRows),
      env.DB.prepare("DELETE FROM ai_images WHERE folder_id = ? AND user_id = ?").bind(folderId, userId),
    ];

    if (textRows.length > 0) {
      mutationStatements.push(...buildPublicMediaCommentCleanupStatementsForTextAssets(env, textRows));
      mutationStatements.push(...buildPublicMediaLikeCleanupStatementsForTextAssets(env, textRows));
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
    ...buildPublicMediaCommentCleanupStatementsForImages(env, imageRows),
    ...buildPublicMediaLikeCleanupStatementsForImages(env, imageRows),
  ];
  const imageDeleteIndex = mutationStatements.length;
  let textDeleteIndex = -1;
  let folderDeleteIndex = 1;
  mutationStatements.push(env.DB.prepare("DELETE FROM ai_images WHERE user_id = ?").bind(userId));

  if (textRows.length > 0) {
    mutationStatements.push(...buildPublicMediaCommentCleanupStatementsForTextAssets(env, textRows));
    mutationStatements.push(...buildPublicMediaLikeCleanupStatementsForTextAssets(env, textRows));
    textDeleteIndex = mutationStatements.length;
    mutationStatements.push(
      {
        statement: env.DB.prepare("DELETE FROM ai_text_assets WHERE user_id = ?").bind(userId),
        branch: "ai_text_assets_delete_failed",
        label: "ai_text_assets_delete",
        category: "user_owned_ai_assets",
      }
    );
  }

  folderDeleteIndex = mutationStatements.length;
  mutationStatements[imageDeleteIndex] = {
    statement: mutationStatements[imageDeleteIndex],
    branch: "ai_images_delete_failed",
    label: "ai_images_delete",
    category: "user_owned_ai_assets",
  };
  mutationStatements.push({
    statement: env.DB.prepare("DELETE FROM ai_folders WHERE user_id = ?").bind(userId),
    branch: "ai_folders_delete_failed",
    label: "ai_folders_delete",
    category: "user_owned_ai_assets",
  }, ...additionalStatements);

  const { cleanupKeys, mutationResults } = await executeLabeledLifecycleStatements({
    env,
    cleanupKeys: collectCleanupKeys(imageRows, textRows),
    mutationStatements,
    createdAt,
    unavailableMessage: "Service temporarily unavailable. Please try again later.",
    failureMessage: "Failed to complete operational user deletion. Review the deletion branch for the blocked cleanup category.",
  });
  await attemptInlineCleanup(env, cleanupKeys);
  await releaseDeletedAssetStorage(env, userId, imageRows, textRows);
  return {
    deletedAiImagesCount: mutationResults[imageDeleteIndex]?.meta?.changes ?? imageRows.length,
    deletedAiTextAssetsCount: textDeleteIndex >= 0
      ? (mutationResults[textDeleteIndex]?.meta?.changes ?? textRows.length)
      : 0,
    deletedAiFoldersCount: mutationResults[folderDeleteIndex]?.meta?.changes ?? null,
    cleanupObjectsQueuedCount: cleanupKeys.length,
  };
}
