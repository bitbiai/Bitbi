import { json } from "../../lib/response.js";
import { requireUser } from "../../lib/session.js";
import { toAiImageAssetRecord } from "../../lib/ai-image-derivatives.js";
import {
  isMissingTextAssetTableError,
  sortByCreatedAtDesc,
  toAiFileAssetRecord,
} from "./helpers.js";

const AI_IMAGE_LIST_COLUMNS =
  "id, folder_id, prompt, model, steps, seed, created_at, visibility, published_at, thumb_key, medium_key, thumb_width, thumb_height, medium_width, medium_height, derivatives_status, derivatives_version";

export async function handleGetImages(ctx) {
  const { request, env, url } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const folderId = url.searchParams.get("folder_id") || null;
  const onlyUnfoldered = url.searchParams.get("only_unfoldered") === "1";

  let query;
  let params;
  if (onlyUnfoldered) {
    query = `SELECT ${AI_IMAGE_LIST_COLUMNS}
             FROM ai_images WHERE user_id = ? AND folder_id IS NULL
             ORDER BY created_at DESC LIMIT 200`;
    params = [session.user.id];
  } else if (folderId) {
    query = `SELECT ${AI_IMAGE_LIST_COLUMNS}
             FROM ai_images WHERE user_id = ? AND folder_id = ?
             ORDER BY created_at DESC LIMIT 200`;
    params = [session.user.id, folderId];
  } else {
    query = `SELECT ${AI_IMAGE_LIST_COLUMNS}
             FROM ai_images WHERE user_id = ?
             ORDER BY created_at DESC LIMIT 200`;
    params = [session.user.id];
  }

  const rows = await env.DB.prepare(query).bind(...params).all();
  return json({
    ok: true,
    data: {
      images: (rows.results || []).map((row) => toAiImageAssetRecord(row)),
    },
  });
}

export async function handleGetAssets(ctx) {
  const { request, env, url } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const folderId = url.searchParams.get("folder_id") || null;
  const onlyUnfoldered = url.searchParams.get("only_unfoldered") === "1";

  let imageQuery;
  let imageParams;
  let textQuery;
  let textParams;

  if (onlyUnfoldered) {
    imageQuery = `SELECT ${AI_IMAGE_LIST_COLUMNS}
                  FROM ai_images WHERE user_id = ? AND folder_id IS NULL
                  ORDER BY created_at DESC LIMIT 200`;
    imageParams = [session.user.id];
    textQuery = `SELECT id, folder_id, title, file_name, source_module, mime_type, size_bytes, preview_text, created_at, visibility, published_at, poster_r2_key, poster_width, poster_height
                 FROM ai_text_assets WHERE user_id = ? AND folder_id IS NULL
                 ORDER BY created_at DESC LIMIT 200`;
    textParams = [session.user.id];
  } else if (folderId) {
    imageQuery = `SELECT ${AI_IMAGE_LIST_COLUMNS}
                  FROM ai_images WHERE user_id = ? AND folder_id = ?
                  ORDER BY created_at DESC LIMIT 200`;
    imageParams = [session.user.id, folderId];
    textQuery = `SELECT id, folder_id, title, file_name, source_module, mime_type, size_bytes, preview_text, created_at, visibility, published_at, poster_r2_key, poster_width, poster_height
                 FROM ai_text_assets WHERE user_id = ? AND folder_id = ?
                 ORDER BY created_at DESC LIMIT 200`;
    textParams = [session.user.id, folderId];
  } else {
    imageQuery = `SELECT ${AI_IMAGE_LIST_COLUMNS}
                  FROM ai_images WHERE user_id = ?
                  ORDER BY created_at DESC LIMIT 200`;
    imageParams = [session.user.id];
    textQuery = `SELECT id, folder_id, title, file_name, source_module, mime_type, size_bytes, preview_text, created_at, visibility, published_at, poster_r2_key, poster_width, poster_height
                 FROM ai_text_assets WHERE user_id = ?
                 ORDER BY created_at DESC LIMIT 200`;
    textParams = [session.user.id];
  }

  const imageRows = await env.DB.prepare(imageQuery).bind(...imageParams).all();
  let textRows = { results: [] };
  try {
    textRows = await env.DB.prepare(textQuery).bind(...textParams).all();
  } catch (error) {
    if (!isMissingTextAssetTableError(error)) {
      throw error;
    }
  }

  const assets = [
    ...(imageRows.results || []).map((row) => toAiImageAssetRecord(row, { assetType: "image" })),
    ...((textRows.results || []).map((row) => toAiFileAssetRecord(row))),
  ]
    .sort(sortByCreatedAtDesc)
    .slice(0, 200);

  return json({ ok: true, data: { assets } });
}
