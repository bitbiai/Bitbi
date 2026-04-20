import { json } from "../../lib/response.js";
import { requireUser } from "../../lib/session.js";
import { readJsonBody } from "../../lib/request.js";
import { nowIso } from "../../lib/tokens.js";
import { buildAiImageCleanupQueueInsertSql, listAiImageObjectKeys } from "../../lib/ai-image-derivatives.js";

export async function handleBulkMove(ctx) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const body = await readJsonBody(request);
  if (!body || !Array.isArray(body.image_ids) || body.image_ids.length === 0) {
    return json({ ok: false, error: "image_ids array is required." }, { status: 400 });
  }

  const imageIds = body.image_ids;
  const folderId = body.folder_id || null;

  if (imageIds.length > 50) {
    return json({ ok: false, error: "Cannot move more than 50 images at once." }, { status: 400 });
  }

  for (const id of imageIds) {
    if (typeof id !== "string" || !/^[a-f0-9]+$/.test(id)) {
      return json({ ok: false, error: "Invalid image ID." }, { status: 400 });
    }
  }

  if (folderId && (typeof folderId !== "string" || !/^[a-f0-9]+$/.test(folderId))) {
    return json({ ok: false, error: "Invalid folder ID." }, { status: 400 });
  }

  if (folderId) {
    const folder = await env.DB.prepare(
      "SELECT id FROM ai_folders WHERE id = ? AND user_id = ?"
    ).bind(folderId, session.user.id).first();
    if (!folder) {
      return json({ ok: false, error: "Folder not found." }, { status: 404 });
    }
  }

  const placeholders = imageIds.map(() => "?").join(",");
  const check = await env.DB.prepare(
    `SELECT COUNT(*) AS cnt FROM ai_images WHERE id IN (${placeholders}) AND user_id = ?`
  ).bind(...imageIds, session.user.id).first();

  if (!check || check.cnt !== imageIds.length) {
    return json({ ok: false, error: "One or more images not found." }, { status: 404 });
  }

  const valuesList = imageIds.map(() => "(?)").join(",");
  if (folderId) {
    await env.DB.prepare(
      `WITH requested(id) AS (VALUES ${valuesList})
       UPDATE ai_images
       SET folder_id = ?
       WHERE user_id = ?
         AND id IN (SELECT id FROM requested)
         AND (SELECT COUNT(*) FROM requested) =
             (SELECT COUNT(*) FROM ai_images WHERE user_id = ? AND id IN (SELECT id FROM requested))
         AND EXISTS (SELECT 1 FROM ai_folders WHERE id = ? AND user_id = ?)`
    ).bind(...imageIds, folderId, session.user.id, session.user.id, folderId, session.user.id).run();
  } else {
    await env.DB.prepare(
      `WITH requested(id) AS (VALUES ${valuesList})
       UPDATE ai_images
       SET folder_id = NULL
       WHERE user_id = ?
         AND id IN (SELECT id FROM requested)
         AND (SELECT COUNT(*) FROM requested) =
             (SELECT COUNT(*) FROM ai_images WHERE user_id = ? AND id IN (SELECT id FROM requested))`
    ).bind(...imageIds, session.user.id, session.user.id).run();
  }

  return json({ ok: true, data: { moved: imageIds.length } });
}

export async function handleBulkDelete(ctx) {
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

  const placeholders = imageIds.map(() => "?").join(",");
  const snapshot = await env.DB.prepare(
    `SELECT id, r2_key, thumb_key, medium_key FROM ai_images WHERE id IN (${placeholders}) AND user_id = ?`
  ).bind(...imageIds, session.user.id).all();

  if (!snapshot.results || snapshot.results.length !== imageIds.length) {
    return json({ ok: false, error: "One or more images not found." }, { status: 404 });
  }

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
    console.error("Bulk delete: atomic batch failed", e);
    const msg = String(e).includes("no such table")
      ? "Service temporarily unavailable. Please try again later."
      : "Delete failed. Please try again.";
    return json({ ok: false, error: msg }, { status: 503 });
  }

  const deleted = batchResults[1].meta.changes || 0;
  if (deleted !== imageIds.length) {
    return json(
      { ok: false, error: "Delete failed. Some images may have already been removed." },
      { status: 409 }
    );
  }

  const cleanedKeys = [];
  for (const row of snapshot.results) {
    try {
      for (const key of listAiImageObjectKeys(row)) {
        await env.USER_IMAGES.delete(key);
        cleanedKeys.push(key);
      }
    } catch {}
  }

  if (cleanedKeys.length > 0) {
    try {
      const ph = cleanedKeys.map(() => "?").join(",");
      await env.DB.prepare(
        `DELETE FROM r2_cleanup_queue WHERE r2_key IN (${ph}) AND status = 'pending'`
      ).bind(...cleanedKeys).run();
    } catch {}
  }

  return json({ ok: true, data: { deleted } });
}
