import { json } from "../lib/response.js";
import { requireUser } from "../lib/session.js";
import { readJsonBody } from "../lib/request.js";
import { nowIso } from "../lib/tokens.js";
import {
  buildAiImageCleanupQueueInsertSql,
  listAiImageObjectKeys,
} from "../lib/ai-image-derivatives.js";
import { handleQuota } from "./ai/quota.js";
import { handleGetFolders } from "./ai/folders-read.js";
import { handleGetAssets, handleGetImages } from "./ai/assets-read.js";
import {
  handleCreateFolder,
  handleDeleteFolder,
  handleRenameFolder,
} from "./ai/folders-write.js";
import {
  handleGetImageDerivative,
  handleGetImageFile,
  handleGetTextAssetFile,
  handleGetTextAssetPoster,
} from "./ai/files-read.js";
import {
  handleDeleteImage,
  handleGenerateImage,
  handleRenameImage,
  handleSaveImage,
} from "./ai/images-write.js";
import { handleUpdateImagePublication, handleUpdateTextAssetPublication } from "./ai/publication.js";
import {
  handleDeleteTextAsset,
  handleRenameTextAsset,
  handleSaveAudio,
} from "./ai/text-assets-write.js";
import {
  buildBulkDeleteFinalStateGuardSql,
  buildBulkMoveFinalStateGuardSql,
  buildCleanupQueueBindings,
  buildCleanupQueueInsertValuesSql,
  buildRequestedValuesList,
  isBulkStateGuardError,
  isHexAssetId,
  isMissingTextAssetTableError,
  normalizeRequestedIds,
} from "./ai/helpers.js";

function logBulkActionDiagnostic(action, details) {
  try {
    console.log(`[ai bulk ${action}] ${JSON.stringify(details)}`);
  } catch {
    console.log(`[ai bulk ${action}]`, details);
  }
}

// ── PATCH /api/ai/assets/bulk-move ──
async function handleBulkMoveAssets(ctx) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const body = await readJsonBody(request);
  const normalized = normalizeRequestedIds(body, "asset_ids", "move");
  if (normalized.error) {
    return json({ ok: false, error: normalized.error }, { status: 400 });
  }

  const assetIds = normalized.ids;
  const folderId = body.folder_id || null;
  const diagnostic = {
    asset_ids: assetIds,
    folder_id: folderId,
    matched_owned_ai_images_count: 0,
    matched_owned_ai_text_assets_count: 0,
    updated_ai_images_count: 0,
    updated_ai_text_assets_count: 0,
    folder_exists_owned: folderId ? false : null,
  };
  if (folderId) {
    if (!isHexAssetId(folderId)) {
      return json({ ok: false, error: "Invalid folder ID." }, { status: 400 });
    }
    const folder = await env.DB.prepare(
      "SELECT id FROM ai_folders WHERE id = ? AND user_id = ? AND status = 'active'"
    ).bind(folderId, session.user.id).first();
    if (!folder) {
      logBulkActionDiagnostic("move", {
        ...diagnostic,
        branch: "folder_not_found",
      });
      return json({ ok: false, error: "Folder not found." }, { status: 404 });
    }
    diagnostic.folder_exists_owned = true;
  }

  const placeholders = assetIds.map(() => "?").join(",");
  const imageRows = await env.DB.prepare(
    `SELECT id FROM ai_images WHERE id IN (${placeholders}) AND user_id = ?`
  ).bind(...assetIds, session.user.id).all();

  let fileRows = { results: [] };
  try {
    fileRows = await env.DB.prepare(
      `SELECT id FROM ai_text_assets WHERE id IN (${placeholders}) AND user_id = ?`
    ).bind(...assetIds, session.user.id).all();
  } catch (error) {
    if (!isMissingTextAssetTableError(error)) {
      throw error;
    }
  }

  const imageIds = (imageRows.results || []).map((row) => row.id);
  const fileIds = (fileRows.results || []).map((row) => row.id);
  diagnostic.matched_owned_ai_images_count = imageIds.length;
  diagnostic.matched_owned_ai_text_assets_count = fileIds.length;
  if (imageIds.length + fileIds.length !== assetIds.length) {
    logBulkActionDiagnostic("move", {
      ...diagnostic,
      branch: "asset_match_count_mismatch",
    });
    return json({ ok: false, error: "One or more assets not found." }, { status: 404 });
  }

  const statements = [];
  let imageUpdateIndex = -1;
  let fileUpdateIndex = -1;

  if (imageIds.length > 0) {
    const valuesList = buildRequestedValuesList(imageIds);
    if (folderId) {
      imageUpdateIndex = statements.length;
      statements.push(
        env.DB.prepare(
          `WITH requested(id) AS (VALUES ${valuesList})
           UPDATE ai_images SET folder_id = ?
           WHERE user_id = ?
             AND id IN (SELECT id FROM requested)
             AND (SELECT COUNT(*) FROM requested) =
                 (SELECT COUNT(*) FROM ai_images WHERE user_id = ? AND id IN (SELECT id FROM requested))
             AND EXISTS (SELECT 1 FROM ai_folders WHERE id = ? AND user_id = ? AND status = 'active')`
        ).bind(...imageIds, folderId, session.user.id, session.user.id, folderId, session.user.id)
      );
    } else {
      imageUpdateIndex = statements.length;
      statements.push(
        env.DB.prepare(
          `WITH requested(id) AS (VALUES ${valuesList})
           UPDATE ai_images SET folder_id = NULL
           WHERE user_id = ?
             AND id IN (SELECT id FROM requested)
             AND (SELECT COUNT(*) FROM requested) =
                 (SELECT COUNT(*) FROM ai_images WHERE user_id = ? AND id IN (SELECT id FROM requested))`
        ).bind(...imageIds, session.user.id, session.user.id)
      );
    }
  }

  if (fileIds.length > 0) {
    const valuesList = buildRequestedValuesList(fileIds);
    if (folderId) {
      fileUpdateIndex = statements.length;
      statements.push(
        env.DB.prepare(
          `WITH requested(id) AS (VALUES ${valuesList})
           UPDATE ai_text_assets SET folder_id = ?
           WHERE user_id = ?
             AND id IN (SELECT id FROM requested)
             AND (SELECT COUNT(*) FROM requested) =
                 (SELECT COUNT(*) FROM ai_text_assets WHERE user_id = ? AND id IN (SELECT id FROM requested))
             AND EXISTS (SELECT 1 FROM ai_folders WHERE id = ? AND user_id = ? AND status = 'active')`
        ).bind(...fileIds, folderId, session.user.id, session.user.id, folderId, session.user.id)
      );
    } else {
      fileUpdateIndex = statements.length;
      statements.push(
        env.DB.prepare(
          `WITH requested(id) AS (VALUES ${valuesList})
           UPDATE ai_text_assets SET folder_id = NULL
           WHERE user_id = ?
             AND id IN (SELECT id FROM requested)
             AND (SELECT COUNT(*) FROM requested) =
                 (SELECT COUNT(*) FROM ai_text_assets WHERE user_id = ? AND id IN (SELECT id FROM requested))`
        ).bind(...fileIds, session.user.id, session.user.id)
      );
    }
  }

  const finalStateGuard = buildBulkMoveFinalStateGuardSql(
    session.user.id,
    imageIds,
    fileIds,
    folderId
  );
  statements.push(
    env.DB.prepare(finalStateGuard.sql).bind(...finalStateGuard.bindings)
  );

  let batchResults;
  try {
    batchResults = await env.DB.batch(statements);
  } catch (error) {
    const unavailable = String(error).includes("no such table");
    const stateGuardError = isBulkStateGuardError(error);
    logBulkActionDiagnostic("move", {
      ...diagnostic,
      branch: stateGuardError ? "final_state_guard_failed" : unavailable ? "service_unavailable" : "batch_error",
      error: String(error).slice(0, 500),
    });
    return json(
      {
        ok: false,
        error: unavailable
          ? "Service temporarily unavailable. Please try again later."
          : stateGuardError
            ? "Move failed. Some assets may have been deleted or the folder removed."
            : "Move failed. Please try again.",
      },
      { status: unavailable ? 503 : stateGuardError ? 409 : 500 }
    );
  }

  diagnostic.updated_ai_images_count = imageUpdateIndex >= 0
    ? (batchResults[imageUpdateIndex]?.meta?.changes || 0)
    : 0;
  diagnostic.updated_ai_text_assets_count = fileUpdateIndex >= 0
    ? (batchResults[fileUpdateIndex]?.meta?.changes || 0)
    : 0;
  logBulkActionDiagnostic("move", {
    ...diagnostic,
    branch: "success",
  });
  return json({ ok: true, data: { moved: assetIds.length } });
}

// ── POST /api/ai/assets/bulk-delete ──
async function handleBulkDeleteAssets(ctx) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const body = await readJsonBody(request);
  const normalized = normalizeRequestedIds(body, "asset_ids", "delete");
  if (normalized.error) {
    return json({ ok: false, error: normalized.error }, { status: 400 });
  }

  const assetIds = normalized.ids;
  const diagnostic = {
    asset_ids: assetIds,
    matched_owned_ai_images_count: 0,
    matched_owned_ai_text_assets_count: 0,
    deleted_ai_images_count: 0,
    deleted_ai_text_assets_count: 0,
  };
  const placeholders = assetIds.map(() => "?").join(",");

  const imageSnapshot = await env.DB.prepare(
    `SELECT id, r2_key, thumb_key, medium_key FROM ai_images WHERE id IN (${placeholders}) AND user_id = ?`
  ).bind(...assetIds, session.user.id).all();

  let fileSnapshot = { results: [] };
  try {
    fileSnapshot = await env.DB.prepare(
      `SELECT id, r2_key, poster_r2_key FROM ai_text_assets WHERE id IN (${placeholders}) AND user_id = ?`
    ).bind(...assetIds, session.user.id).all();
  } catch (error) {
    if (!isMissingTextAssetTableError(error)) {
      throw error;
    }
  }

  const imageRows = imageSnapshot.results || [];
  const fileRows = fileSnapshot.results || [];
  diagnostic.matched_owned_ai_images_count = imageRows.length;
  diagnostic.matched_owned_ai_text_assets_count = fileRows.length;
  if (imageRows.length + fileRows.length !== assetIds.length) {
    logBulkActionDiagnostic("delete", {
      ...diagnostic,
      branch: "asset_match_count_mismatch",
    });
    return json({ ok: false, error: "One or more assets not found." }, { status: 404 });
  }

  const imageIds = imageRows.map((row) => row.id);
  const fileIds = fileRows.map((row) => row.id);
  const cleanupKeys = Array.from(new Set([
    ...imageRows.flatMap((row) => listAiImageObjectKeys(row)),
    ...fileRows.flatMap((row) => [row.r2_key, row.poster_r2_key]).filter(Boolean),
  ]));
  const ts = nowIso();
  const statements = [];
  let imageDeleteIndex = -1;
  let fileDeleteIndex = -1;

  if (cleanupKeys.length > 0) {
    statements.push(
      env.DB.prepare(
        buildCleanupQueueInsertValuesSql(cleanupKeys)
      ).bind(...buildCleanupQueueBindings(cleanupKeys, ts))
    );
  }

  if (imageIds.length > 0) {
    const valuesList = buildRequestedValuesList(imageIds);
    imageDeleteIndex = statements.length;
    statements.push(
      env.DB.prepare(
        `WITH requested(id) AS (VALUES ${valuesList})
         DELETE FROM ai_images
         WHERE user_id = ?
           AND id IN (SELECT id FROM requested)
           AND (SELECT COUNT(*) FROM requested) =
               (SELECT COUNT(*) FROM ai_images WHERE user_id = ? AND id IN (SELECT id FROM requested))`
      ).bind(...imageIds, session.user.id, session.user.id)
    );
  }

  if (fileIds.length > 0) {
    const valuesList = buildRequestedValuesList(fileIds);
    fileDeleteIndex = statements.length;
    statements.push(
      env.DB.prepare(
        `WITH requested(id) AS (VALUES ${valuesList})
         DELETE FROM ai_text_assets
         WHERE user_id = ?
           AND id IN (SELECT id FROM requested)
           AND (SELECT COUNT(*) FROM requested) =
               (SELECT COUNT(*) FROM ai_text_assets WHERE user_id = ? AND id IN (SELECT id FROM requested))`
      ).bind(...fileIds, session.user.id, session.user.id)
    );
  }

  const finalStateGuard = buildBulkDeleteFinalStateGuardSql(
    session.user.id,
    imageIds,
    fileIds
  );
  statements.push(
    env.DB.prepare(finalStateGuard.sql).bind(...finalStateGuard.bindings)
  );

  let batchResults;
  try {
    batchResults = await env.DB.batch(statements);
  } catch (error) {
    const unavailable = String(error).includes("no such table");
    const stateGuardError = isBulkStateGuardError(error);
    logBulkActionDiagnostic("delete", {
      ...diagnostic,
      branch: stateGuardError ? "final_state_guard_failed" : unavailable ? "service_unavailable" : "batch_error",
      error: String(error).slice(0, 500),
    });
    return json(
      {
        ok: false,
        error: unavailable
          ? "Service temporarily unavailable. Please try again later."
          : stateGuardError
            ? "Delete failed. Some assets may have already been removed."
            : "Delete failed. Please try again.",
      },
      { status: unavailable ? 503 : stateGuardError ? 409 : 500 }
    );
  }

  diagnostic.deleted_ai_images_count = imageDeleteIndex >= 0
    ? (batchResults[imageDeleteIndex]?.meta?.changes || 0)
    : 0;
  diagnostic.deleted_ai_text_assets_count = fileDeleteIndex >= 0
    ? (batchResults[fileDeleteIndex]?.meta?.changes || 0)
    : 0;
  logBulkActionDiagnostic("delete", {
    ...diagnostic,
    branch: "success",
  });
  const cleanedKeys = [];
  for (const row of imageRows) {
    for (const key of listAiImageObjectKeys(row)) {
      try {
        await env.USER_IMAGES.delete(key);
        cleanedKeys.push(key);
      } catch {
        // Leave queue entry for scheduled retry.
      }
    }
  }

  for (const row of fileRows) {
    if (!row.r2_key) continue;
    try {
      await env.USER_IMAGES.delete(row.r2_key);
      cleanedKeys.push(row.r2_key);
    } catch {
      // Leave queue entry for scheduled retry.
    }
  }

  const uniqueCleanedKeys = Array.from(new Set(cleanedKeys));
  if (uniqueCleanedKeys.length > 0) {
    try {
      const placeholdersForKeys = uniqueCleanedKeys.map(() => "?").join(",");
      await env.DB.prepare(
        `DELETE FROM r2_cleanup_queue WHERE r2_key IN (${placeholdersForKeys}) AND status = 'pending'`
      ).bind(...uniqueCleanedKeys).run();
    } catch {
      // Non-critical — queued retry stays safe and idempotent.
    }
  }

  return json({ ok: true, data: { deleted: assetIds.length } });
}

// ── PATCH /api/ai/images/bulk-move ──
async function handleBulkMove(ctx) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const body = await readJsonBody(request);
  if (!body || !Array.isArray(body.image_ids) || body.image_ids.length === 0) {
    return json({ ok: false, error: "image_ids array is required." }, { status: 400 });
  }

  const imageIds = body.image_ids;
  if (imageIds.length > 50) {
    return json({ ok: false, error: "Cannot move more than 50 images at once." }, { status: 400 });
  }

  for (const id of imageIds) {
    if (typeof id !== "string" || !/^[a-f0-9]+$/.test(id)) {
      return json({ ok: false, error: "Invalid image ID." }, { status: 400 });
    }
  }

  const folderId = body.folder_id || null;
  if (folderId) {
    if (typeof folderId !== "string" || !/^[a-f0-9]+$/.test(folderId)) {
      return json({ ok: false, error: "Invalid folder ID." }, { status: 400 });
    }
    const folder = await env.DB.prepare(
      "SELECT id FROM ai_folders WHERE id = ? AND user_id = ? AND status = 'active'"
    ).bind(folderId, session.user.id).first();
    if (!folder) {
      return json({ ok: false, error: "Folder not found." }, { status: 404 });
    }
  }

  // Advisory ownership pre-check — gives a clear 404 before the guarded write
  const placeholders = imageIds.map(() => "?").join(",");
  const owned = await env.DB.prepare(
    `SELECT COUNT(*) AS cnt FROM ai_images WHERE id IN (${placeholders}) AND user_id = ?`
  ).bind(...imageIds, session.user.id).first();

  if (!owned || owned.cnt !== imageIds.length) {
    return json({ ok: false, error: "One or more images not found." }, { status: 404 });
  }

  // CTE-guarded UPDATE: IDs bound once via VALUES, count guard ensures
  // all-or-nothing within a single atomic statement. If any image was
  // concurrently deleted between the advisory check and this statement,
  // the count mismatch causes zero rows to be updated.
  const valuesList = imageIds.map(() => "(?)").join(",");
  let result;
  if (folderId) {
    result = await env.DB.prepare(
      `WITH requested(id) AS (VALUES ${valuesList})
       UPDATE ai_images SET folder_id = ?
       WHERE user_id = ?
         AND id IN (SELECT id FROM requested)
         AND (SELECT COUNT(*) FROM requested) =
             (SELECT COUNT(*) FROM ai_images WHERE user_id = ? AND id IN (SELECT id FROM requested))
         AND EXISTS (SELECT 1 FROM ai_folders WHERE id = ? AND user_id = ? AND status = 'active')`
    ).bind(...imageIds, folderId, session.user.id, session.user.id, folderId, session.user.id).run();
  } else {
    result = await env.DB.prepare(
      `WITH requested(id) AS (VALUES ${valuesList})
       UPDATE ai_images SET folder_id = NULL
       WHERE user_id = ?
         AND id IN (SELECT id FROM requested)
         AND (SELECT COUNT(*) FROM requested) =
             (SELECT COUNT(*) FROM ai_images WHERE user_id = ? AND id IN (SELECT id FROM requested))`
    ).bind(...imageIds, session.user.id, session.user.id).run();
  }

  if (!result.meta.changes || result.meta.changes !== imageIds.length) {
    return json(
      { ok: false, error: "Move failed. Some images may have been deleted or the folder removed." },
      { status: 409 }
    );
  }

  return json({ ok: true, data: { moved: imageIds.length } });
}

// ── POST /api/ai/images/bulk-delete ──
async function handleBulkDelete(ctx) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const body = await readJsonBody(request);
  if (!body || !Array.isArray(body.image_ids) || body.image_ids.length === 0) {
    return json({ ok: false, error: "image_ids array is required." }, { status: 400 });
  }

  const imageIds = body.image_ids;
  if (imageIds.length > 50) {
    return json({ ok: false, error: "Cannot delete more than 50 images at once." }, { status: 400 });
  }

  for (const id of imageIds) {
    if (typeof id !== "string" || !/^[a-f0-9]+$/.test(id)) {
      return json({ ok: false, error: "Invalid image ID." }, { status: 400 });
    }
  }

  // Advisory pre-check — also captures r2_keys for inline R2 cleanup later
  const placeholders = imageIds.map(() => "?").join(",");
  const snapshot = await env.DB.prepare(
    `SELECT id, r2_key, thumb_key, medium_key FROM ai_images WHERE id IN (${placeholders}) AND user_id = ?`
  ).bind(...imageIds, session.user.id).all();

  if (!snapshot.results || snapshot.results.length !== imageIds.length) {
    return json({ ok: false, error: "One or more images not found." }, { status: 404 });
  }

  // Atomic batch: queue creation + row deletion in ONE D1 transaction.
  //
  // Statement 1: INSERT cleanup jobs by SELECTing r2_keys from ai_images.
  //   The CTE count guard ensures this only inserts if ALL requested images
  //   exist and are owned. Runs first so it reads ai_images before deletion.
  //
  // Statement 2: DELETE the matching ai_images rows with the same guard.
  //   Within this transaction, statement 2 sees ai_images after statement 1
  //   read from it (statement 1 only inserted into a different table).
  //   The count guard evaluates identically — both affect N rows or 0 rows.
  //
  // Invariant: if ai_images rows are gone, their cleanup queue entries
  // definitely exist in the same committed transaction. No split-brain.
  const valuesList = imageIds.map(() => "(?)").join(",");
  const ts = nowIso();

  let batchResults;
  try {
    batchResults = await env.DB.batch([
      env.DB.prepare(
        `WITH requested(id) AS (VALUES ${valuesList})
         , matches AS (
           SELECT r2_key, thumb_key, medium_key
           FROM ai_images
           WHERE user_id = ?
             AND id IN (SELECT id FROM requested)
             AND (SELECT COUNT(*) FROM requested) =
                 (SELECT COUNT(*) FROM ai_images WHERE user_id = ? AND id IN (SELECT id FROM requested))
         )
         INSERT INTO r2_cleanup_queue (r2_key, status, created_at)
         SELECT r2_key, 'pending', ? FROM matches
         UNION ALL
         SELECT thumb_key, 'pending', ? FROM matches WHERE thumb_key IS NOT NULL
         UNION ALL
         SELECT medium_key, 'pending', ? FROM matches WHERE medium_key IS NOT NULL`
      ).bind(...imageIds, session.user.id, session.user.id, ts, ts, ts),

      env.DB.prepare(
        `WITH requested(id) AS (VALUES ${valuesList})
         DELETE FROM ai_images
         WHERE user_id = ?
           AND id IN (SELECT id FROM requested)
           AND (SELECT COUNT(*) FROM requested) =
               (SELECT COUNT(*) FROM ai_images WHERE user_id = ? AND id IN (SELECT id FROM requested))`
      ).bind(...imageIds, session.user.id, session.user.id),
    ]);
  } catch (e) {
    // Batch failed — transaction rolled back, nothing committed.
    console.error("Bulk delete: atomic batch failed", e);
    const msg = String(e).includes("no such table")
      ? "Service temporarily unavailable. Please try again later."
      : "Delete failed. Please try again.";
    return json({ ok: false, error: msg }, { status: 503 });
  }

  const deleted = batchResults[1].meta.changes || 0;
  if (deleted !== imageIds.length) {
    // CTE count guard failed — concurrent mutation. Both statements
    // affected zero rows within the same committed transaction.
    return json(
      { ok: false, error: "Delete failed. Some images may have already been removed." },
      { status: 409 }
    );
  }

  // Durable handoff complete — all deleted r2_keys have queue entries.
  // Inline R2 cleanup is best-effort optimization only.
  const cleanedKeys = [];
  for (const row of snapshot.results) {
    try {
      for (const key of listAiImageObjectKeys(row)) {
        await env.USER_IMAGES.delete(key);
        cleanedKeys.push(key);
      }
    } catch { /* leave queue entry for scheduled retry */ }
  }

  // Remove queue entries for blobs already cleaned up inline.
  // If this fails, the scheduled handler will re-delete idempotently.
  if (cleanedKeys.length > 0) {
    try {
      const ph = cleanedKeys.map(() => "?").join(",");
      await env.DB.prepare(
        `DELETE FROM r2_cleanup_queue WHERE r2_key IN (${ph}) AND status = 'pending'`
      ).bind(...cleanedKeys).run();
    } catch { /* non-critical — idempotent R2 delete on next scheduled run */ }
  }

  return json({ ok: true, data: { deleted } });
}

// ── Main dispatcher ──
export async function handleAI(ctx) {
  const { pathname, method } = ctx;

  if (pathname === "/api/ai/quota" && method === "GET") {
    return handleQuota(ctx);
  }
  if (pathname === "/api/ai/generate-image" && method === "POST") {
    return handleGenerateImage(ctx);
  }
  if (pathname === "/api/ai/folders" && method === "GET") {
    return handleGetFolders(ctx);
  }
  if (pathname === "/api/ai/folders" && method === "POST") {
    return handleCreateFolder(ctx);
  }
  if (pathname === "/api/ai/images" && method === "GET") {
    return handleGetImages(ctx);
  }
  if (pathname === "/api/ai/assets" && method === "GET") {
    return handleGetAssets(ctx);
  }
  if (pathname === "/api/ai/assets/bulk-move" && method === "PATCH") {
    return handleBulkMoveAssets(ctx);
  }
  if (pathname === "/api/ai/assets/bulk-delete" && method === "POST") {
    return handleBulkDeleteAssets(ctx);
  }
  if (pathname === "/api/ai/images/save" && method === "POST") {
    return handleSaveImage(ctx);
  }
  if (pathname === "/api/ai/audio/save" && method === "POST") {
    return handleSaveAudio(ctx);
  }
  if (pathname === "/api/ai/images/bulk-move" && method === "PATCH") {
    return handleBulkMove(ctx);
  }
  if (pathname === "/api/ai/images/bulk-delete" && method === "POST") {
    return handleBulkDelete(ctx);
  }

  // DELETE /api/ai/folders/:id
  const folderMatch = pathname.match(/^\/api\/ai\/folders\/([a-f0-9]+)$/);
  if (folderMatch && method === "PATCH") {
    return handleRenameFolder(ctx, folderMatch[1]);
  }
  if (folderMatch && method === "DELETE") {
    return handleDeleteFolder(ctx, folderMatch[1]);
  }

  // /api/ai/images/:id/file
  const fileMatch = pathname.match(/^\/api\/ai\/images\/([a-f0-9]+)\/file$/);
  if (fileMatch && method === "GET") {
    return handleGetImageFile(ctx, fileMatch[1]);
  }

  const thumbMatch = pathname.match(/^\/api\/ai\/images\/([a-f0-9]+)\/thumb$/);
  if (thumbMatch && method === "GET") {
    return handleGetImageDerivative(ctx, thumbMatch[1], "thumb");
  }

  const mediumMatch = pathname.match(/^\/api\/ai\/images\/([a-f0-9]+)\/medium$/);
  if (mediumMatch && method === "GET") {
    return handleGetImageDerivative(ctx, mediumMatch[1], "medium");
  }

  const textFileMatch = pathname.match(/^\/api\/ai\/text-assets\/([a-f0-9]+)\/file$/);
  if (textFileMatch && method === "GET") {
    return handleGetTextAssetFile(ctx, textFileMatch[1]);
  }

  const textPosterMatch = pathname.match(/^\/api\/ai\/text-assets\/([a-f0-9]+)\/poster$/);
  if (textPosterMatch && method === "GET") {
    return handleGetTextAssetPoster(ctx, textPosterMatch[1]);
  }

  // DELETE /api/ai/images/:id
  const deleteMatch = pathname.match(/^\/api\/ai\/images\/([a-f0-9]+)$/);
  if (deleteMatch && method === "DELETE") {
    return handleDeleteImage(ctx, deleteMatch[1]);
  }

  const publicationMatch = pathname.match(/^\/api\/ai\/images\/([a-f0-9]+)\/publication$/);
  if (publicationMatch && method === "PATCH") {
    return handleUpdateImagePublication(ctx, publicationMatch[1]);
  }

  const imageRenameMatch = pathname.match(/^\/api\/ai\/images\/([a-f0-9]+)\/rename$/);
  if (imageRenameMatch && method === "PATCH") {
    return handleRenameImage(ctx, imageRenameMatch[1]);
  }

  const textPublicationMatch = pathname.match(/^\/api\/ai\/text-assets\/([a-f0-9]+)\/publication$/);
  if (textPublicationMatch && method === "PATCH") {
    return handleUpdateTextAssetPublication(ctx, textPublicationMatch[1]);
  }

  const textRenameMatch = pathname.match(/^\/api\/ai\/text-assets\/([a-f0-9]+)\/rename$/);
  if (textRenameMatch && method === "PATCH") {
    return handleRenameTextAsset(ctx, textRenameMatch[1]);
  }

  const textDeleteMatch = pathname.match(/^\/api\/ai\/text-assets\/([a-f0-9]+)$/);
  if (textDeleteMatch && method === "DELETE") {
    return handleDeleteTextAsset(ctx, textDeleteMatch[1]);
  }

  return null;
}
