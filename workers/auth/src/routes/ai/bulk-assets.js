import { json } from "../../lib/response.js";
import { requireUser } from "../../lib/session.js";
import { readJsonBody } from "../../lib/request.js";
import { nowIso } from "../../lib/tokens.js";
import { listAiImageObjectKeys } from "../../lib/ai-image-derivatives.js";
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
} from "./helpers.js";

function logBulkActionDiagnostic(action, details) {
  try {
    console.log(`[ai bulk ${action}] ${JSON.stringify(details)}`);
  } catch {
    console.log(`[ai bulk ${action}]`, details);
  }
}

export async function handleBulkMoveAssets(ctx) {
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

export async function handleBulkDeleteAssets(ctx) {
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

  for (const key of cleanupKeys) {
    try {
      await env.USER_IMAGES.delete(key);
    } catch {}
  }

  if (cleanupKeys.length > 0) {
    try {
      const placeholdersSql = cleanupKeys.map(() => "?").join(",");
      await env.DB.prepare(
        `DELETE FROM r2_cleanup_queue WHERE r2_key IN (${placeholdersSql}) AND status = 'pending'`
      ).bind(...cleanupKeys).run();
    } catch {}
  }

  return json({ ok: true, data: { deleted: assetIds.length } });
}
