import { json } from "../../lib/response.js";
import { requireUser } from "../../lib/session.js";
import { readJsonBody } from "../../lib/request.js";
import { nowIso } from "../../lib/tokens.js";
import { saveAdminAiTextAsset } from "../../lib/ai-text-assets.js";
import { getErrorFields, logDiagnostic, withCorrelationId } from "../../../../../js/shared/worker-observability.mjs";
import {
  REMOTE_MEDIA_URL_POLICY_CODE,
  attachRemoteMediaPolicyContext,
  buildRemoteMediaUrlRejectedMessage,
  getRemoteMediaPolicyLogFields,
} from "../../../../../js/shared/remote-media-policy.mjs";
import { buildRenamedFileName, hasControlCharacters, isMissingTextAssetTableError } from "./helpers.js";

const MAX_PROMPT_LENGTH = 1000;
const MAX_SAVED_FILE_TITLE_LENGTH = 120;

export async function handleRenameTextAsset(ctx, assetId) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const body = await readJsonBody(request);
  const name = String(body?.name || "").trim();
  if (name.length === 0 || name.length > MAX_SAVED_FILE_TITLE_LENGTH) {
    return json({ ok: false, error: `Asset name must be 1–${MAX_SAVED_FILE_TITLE_LENGTH} characters.` }, { status: 400 });
  }
  if (hasControlCharacters(name)) {
    return json({ ok: false, error: "Asset name cannot contain control characters." }, { status: 400 });
  }

  let existing;
  try {
    existing = await env.DB.prepare(
      "SELECT id, title, file_name, mime_type, source_module FROM ai_text_assets WHERE id = ? AND user_id = ?"
    ).bind(assetId, session.user.id).first();
  } catch (error) {
    if (isMissingTextAssetTableError(error)) {
      return json({ ok: false, error: "Text asset service unavailable." }, { status: 503 });
    }
    throw error;
  }

  if (!existing) {
    return json({ ok: false, error: "Text asset not found." }, { status: 404 });
  }

  const nextFileName = buildRenamedFileName(name, existing);
  if (existing.title === name && existing.file_name === nextFileName) {
    return json({
      ok: true,
      data: {
        id: existing.id,
        title: existing.title,
        file_name: existing.file_name,
        unchanged: true,
      },
    });
  }

  await env.DB.prepare(
    "UPDATE ai_text_assets SET title = ?, file_name = ? WHERE id = ? AND user_id = ?"
  ).bind(name, nextFileName, assetId, session.user.id).run();

  return json({
    ok: true,
    data: {
      id: assetId,
      title: name,
      file_name: nextFileName,
      unchanged: false,
    },
  });
}

export async function handleSaveAudio(ctx) {
  const { request, env } = ctx;
  const correlationId = ctx.correlationId || null;
  const respond = (body, init) => withCorrelationId(json(body, init), correlationId);
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const body = await readJsonBody(request);
  if (body?.audioUrl !== undefined && body?.audioUrl !== null && body?.audioUrl !== "") {
    const error = attachRemoteMediaPolicyContext(
      new Error(
        buildRemoteMediaUrlRejectedMessage(
          "audioUrl",
          "Submit inline audio bytes via audioBase64 instead."
        )
      ),
      body.audioUrl,
      {
        field: "audioUrl",
        reason: "remote_audio_save_url_rejected",
      }
    );
    error.status = 400;
    error.code = REMOTE_MEDIA_URL_POLICY_CODE;
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-save-audio",
      event: "ai_audio_save_rejected_remote_url",
      level: "warn",
      correlationId,
      user_id: session.user.id,
      ...getRemoteMediaPolicyLogFields(error),
    });
    return respond({ ok: false, error: error.message, code: error.code }, { status: error.status });
  }

  if (!body || !body.audioBase64) {
    return respond({ ok: false, error: "Audio data is required (audioBase64)." }, { status: 400 });
  }

  const title = String(body.title || "").trim();
  if (!title || title.length > MAX_SAVED_FILE_TITLE_LENGTH) {
    return respond(
      { ok: false, error: `Title is required and must be at most ${MAX_SAVED_FILE_TITLE_LENGTH} characters.` },
      { status: 400 }
    );
  }

  if (body.audioBase64 && (typeof body.audioBase64 !== "string" || body.audioBase64.length === 0)) {
    return respond({ ok: false, error: "audioBase64 must be a non-empty string." }, { status: 400 });
  }

  const mimeType = String(body.mimeType || "audio/mpeg").trim();
  if (!mimeType.startsWith("audio/")) {
    return respond({ ok: false, error: "mimeType must be an audio MIME type." }, { status: 400 });
  }

  const folderId = body.folder_id || null;
  if (folderId && (typeof folderId !== "string" || !/^[a-f0-9]+$/.test(folderId))) {
    return respond({ ok: false, error: "Invalid folder ID." }, { status: 400 });
  }

  const payload = {
    audioBase64: body.audioBase64 || null,
    mimeType,
    prompt: body.prompt ? String(body.prompt).slice(0, MAX_PROMPT_LENGTH) : null,
    model: body.model || null,
    mode: body.mode || null,
    lyricsMode: body.lyricsMode || null,
    bpm: body.bpm ?? null,
    key: body.key || null,
    lyricsPreview: body.lyricsPreview || null,
    durationMs: body.durationMs ?? null,
    sampleRate: body.sampleRate ?? null,
    channels: body.channels ?? null,
    bitrate: body.bitrate ?? null,
    sizeBytes: body.sizeBytes ?? null,
    traceId: body.traceId || null,
    warnings: Array.isArray(body.warnings) ? body.warnings : [],
    elapsedMs: body.elapsedMs ?? null,
    receivedAt: body.receivedAt || null,
  };

  try {
    const saved = await saveAdminAiTextAsset(env, {
      userId: session.user.id,
      folderId,
      title,
      sourceModule: "music",
      payload,
    });

    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-save-audio",
      event: "ai_audio_saved",
      correlationId,
      user_id: session.user.id,
      asset_id: saved.id,
      folder_id: saved.folder_id,
      size_bytes: saved.size_bytes,
    });

    return respond({ ok: true, data: saved }, { status: 201 });
  } catch (error) {
    const status = error?.status || 500;
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-save-audio",
      event: "ai_audio_save_failed",
      level: "error",
      correlationId,
      user_id: session.user.id,
      ...getErrorFields(error),
    });
    return respond(
      {
        ok: false,
        error: error?.message || "Audio save failed.",
        code: error?.code || (status >= 500 ? "internal_error" : "validation_error"),
      },
      { status }
    );
  }
}

export async function handleDeleteTextAsset(ctx, assetId) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  let row;
  try {
    row = await env.DB.prepare(
      "SELECT r2_key, poster_r2_key FROM ai_text_assets WHERE id = ? AND user_id = ?"
    ).bind(assetId, session.user.id).first();
  } catch (error) {
    if (isMissingTextAssetTableError(error)) {
      return json({ ok: false, error: "Text asset service unavailable." }, { status: 503 });
    }
    throw error;
  }

  if (!row) {
    return json({ ok: false, error: "Text asset not found." }, { status: 404 });
  }

  const ts = nowIso();
  let batchResults;
  try {
    const batchStmts = [
      env.DB.prepare(
        `INSERT INTO r2_cleanup_queue (r2_key, status, created_at)
         SELECT r2_key, 'pending', ?
         FROM ai_text_assets
         WHERE id = ? AND user_id = ?`
      ).bind(ts, assetId, session.user.id),
    ];
    if (row.poster_r2_key) {
      batchStmts.push(
        env.DB.prepare(
          "INSERT INTO r2_cleanup_queue (r2_key, status, created_at) VALUES (?, 'pending', ?)"
        ).bind(row.poster_r2_key, ts)
      );
    }
    batchStmts.push(
      env.DB.prepare(
        "DELETE FROM ai_text_assets WHERE id = ? AND user_id = ?"
      ).bind(assetId, session.user.id)
    );
    batchResults = await env.DB.batch(batchStmts);
  } catch (error) {
    const unavailable = String(error).includes("no such table");
    return json(
      {
        ok: false,
        error: unavailable ? "Text asset service unavailable. Please try again later." : "Delete failed. Please try again.",
      },
      { status: unavailable ? 503 : 500 }
    );
  }

  const deleteStmtIndex = row.poster_r2_key ? 2 : 1;
  const deleted = batchResults[deleteStmtIndex].meta.changes || 0;
  if (deleted !== 1) {
    return json(
      { ok: false, error: "Delete failed. Text asset may have already been removed." },
      { status: 409 }
    );
  }

  try {
    await env.USER_IMAGES.delete(row.r2_key);
    if (row.poster_r2_key) {
      await env.USER_IMAGES.delete(row.poster_r2_key);
    }
    const keysToClean = [row.r2_key, row.poster_r2_key].filter(Boolean);
    for (const key of keysToClean) {
      await env.DB.prepare(
        "DELETE FROM r2_cleanup_queue WHERE r2_key = ? AND status = 'pending'"
      ).bind(key).run();
    }
  } catch {
    // Leave queue entries for scheduled retry.
  }

  return json({ ok: true });
}
