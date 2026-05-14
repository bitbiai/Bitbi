import { json } from "../../lib/response.js";
import { requireUser } from "../../lib/session.js";
import { getUserAssetStorageUsageSnapshot } from "../../lib/asset-storage-quota.js";
import {
  decodePaginationCursor,
  encodePaginationCursor,
  paginationErrorResponse,
  readCursorInteger,
  readCursorString,
  resolvePaginationLimit,
} from "../../lib/pagination.js";
import { toAiImageAssetRecord } from "../../lib/ai-image-derivatives.js";
import {
  isMissingTextAssetTableError,
  toAiFileAssetRecord,
} from "./helpers.js";

const AI_IMAGE_LIST_COLUMNS =
  "id, folder_id, prompt, model, steps, seed, created_at, size_bytes, visibility, published_at, thumb_key, medium_key, thumb_width, thumb_height, medium_width, medium_height, derivatives_status, derivatives_version";
const MEMBER_ASSET_CURSOR_TYPE = "member_assets";
const DEFAULT_MEMBER_ASSET_LIMIT = 60;
const MAX_MEMBER_ASSET_LIMIT = 100;
const MEMBER_ASSET_IMAGE_KIND_RANK = 2;
const MEMBER_ASSET_FILE_KIND_RANK = 1;

async function getStorageUsageOrNull(env, userId) {
  try {
    return await getUserAssetStorageUsageSnapshot(env, userId);
  } catch {
    return null;
  }
}

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
  const appliedLimit = resolvePaginationLimit(url.searchParams.get("limit"), {
    defaultValue: DEFAULT_MEMBER_ASSET_LIMIT,
    maxValue: MAX_MEMBER_ASSET_LIMIT,
  });
  const scopeKey = onlyUnfoldered ? "unfoldered" : (folderId ? `folder:${folderId}` : "all");

  let cursor = null;
  try {
    cursor = await decodePaginationCursor(env, url.searchParams.get("cursor"), MEMBER_ASSET_CURSOR_TYPE);
    if (cursor) {
      cursor = {
        s: readCursorString(cursor, "s"),
        c: readCursorString(cursor, "c"),
        r: readCursorInteger(cursor, "r", {
          min: MEMBER_ASSET_FILE_KIND_RANK,
          max: MEMBER_ASSET_IMAGE_KIND_RANK,
        }),
        i: readCursorString(cursor, "i"),
      };
    }
  } catch {
    return paginationErrorResponse("Invalid cursor.");
  }
  if (cursor && cursor.s !== scopeKey) {
    return paginationErrorResponse("Invalid cursor.");
  }

  const imageConditions = ["user_id = ?"];
  const imageBindings = [session.user.id];
  const textConditions = ["user_id = ?"];
  const textBindings = [session.user.id];

  if (onlyUnfoldered) {
    imageConditions.push("folder_id IS NULL");
    textConditions.push("folder_id IS NULL");
  } else if (folderId) {
    imageConditions.push("folder_id = ?");
    imageBindings.push(folderId);
    textConditions.push("folder_id = ?");
    textBindings.push(folderId);
  }

  const cursorBindings = [];
  let cursorClause = "";
  if (cursor) {
    cursorClause = `
      WHERE (
        created_at < ?
        OR (
          created_at = ?
          AND (
            asset_kind_rank < ?
            OR (asset_kind_rank = ? AND id < ?)
          )
        )
      )`;
    cursorBindings.push(
      cursor.c,
      cursor.c,
      Number(cursor.r),
      Number(cursor.r),
      cursor.i
    );
  }

  const unionQuery = `
    SELECT *
    FROM (
      SELECT ${AI_IMAGE_LIST_COLUMNS},
             NULL AS title,
             NULL AS file_name,
             NULL AS source_module,
             NULL AS mime_type,
             NULL AS preview_text,
             NULL AS poster_r2_key,
             NULL AS poster_width,
             NULL AS poster_height,
             NULL AS poster_size_bytes,
             ${MEMBER_ASSET_IMAGE_KIND_RANK} AS asset_kind_rank
      FROM ai_images
      WHERE ${imageConditions.join(" AND ")}
      UNION ALL
      SELECT id,
             folder_id,
             NULL AS prompt,
             NULL AS model,
             NULL AS steps,
             NULL AS seed,
             created_at,
             size_bytes,
             visibility,
             published_at,
             NULL AS thumb_key,
             NULL AS medium_key,
             NULL AS thumb_width,
             NULL AS thumb_height,
             NULL AS medium_width,
             NULL AS medium_height,
             NULL AS derivatives_status,
             NULL AS derivatives_version,
             title,
             file_name,
             source_module,
             mime_type,
             preview_text,
             poster_r2_key,
             poster_width,
             poster_height,
             poster_size_bytes,
             ${MEMBER_ASSET_FILE_KIND_RANK} AS asset_kind_rank
      FROM ai_text_assets
      WHERE ${textConditions.join(" AND ")}
    ) AS assets
    ${cursorClause}
    ORDER BY created_at DESC, asset_kind_rank DESC, id DESC
    LIMIT ?`;

  let rows = { results: [] };
  try {
    rows = await env.DB.prepare(unionQuery)
      .bind(...imageBindings, ...textBindings, ...cursorBindings, appliedLimit + 1)
      .all();
  } catch (error) {
    if (!isMissingTextAssetTableError(error)) {
      throw error;
    }

    const imageCursorClause = cursor
      ? `
         AND (
           created_at < ?
           OR (
             created_at = ?
             AND id < ?
           )
         )`
      : "";
    const imageRows = await env.DB.prepare(
      `SELECT ${AI_IMAGE_LIST_COLUMNS}
       FROM ai_images
       WHERE ${imageConditions.join(" AND ")}
       ${imageCursorClause}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    )
      .bind(
        ...imageBindings,
        ...(cursor ? [cursor.c, cursor.c, cursor.i] : []),
        appliedLimit + 1
      )
      .all();

    const imageResults = imageRows.results || [];
    const hasMore = imageResults.length > appliedLimit;
    const items = hasMore ? imageResults.slice(0, appliedLimit) : imageResults;
    const assets = items.map((row) => toAiImageAssetRecord(row, { assetType: "image" }));
    const last = items[items.length - 1];
    const storageUsage = await getStorageUsageOrNull(env, session.user.id);

    return json({
      ok: true,
      data: {
        assets,
        next_cursor: hasMore
          ? await encodePaginationCursor(env, MEMBER_ASSET_CURSOR_TYPE, {
              s: scopeKey,
              c: last.created_at,
              r: MEMBER_ASSET_IMAGE_KIND_RANK,
              i: last.id,
            })
          : null,
        has_more: hasMore,
        applied_limit: appliedLimit,
        ...(storageUsage ? { storageUsage } : {}),
      },
    });
  }

  const results = rows.results || [];
  const hasMore = results.length > appliedLimit;
  const pageRows = hasMore ? results.slice(0, appliedLimit) : results;
  const assets = pageRows.map((row) => (
    Number(row.asset_kind_rank) === MEMBER_ASSET_IMAGE_KIND_RANK
      ? toAiImageAssetRecord(row, { assetType: "image" })
      : toAiFileAssetRecord(row)
  ));
  const last = pageRows[pageRows.length - 1];
  const storageUsage = await getStorageUsageOrNull(env, session.user.id);

  return json({
    ok: true,
    data: {
      assets,
      next_cursor: hasMore
        ? await encodePaginationCursor(env, MEMBER_ASSET_CURSOR_TYPE, {
            s: scopeKey,
            c: last.created_at,
            r: Number(last.asset_kind_rank),
            i: last.id,
          })
        : null,
      has_more: hasMore,
      applied_limit: appliedLimit,
      ...(storageUsage ? { storageUsage } : {}),
    },
  });
}
