import { json } from "../lib/response.js";
import {
  BODY_LIMITS,
  readJsonBodyOrResponse,
} from "../lib/request.js";
import { enqueueAdminAuditEvent } from "../lib/activity.js";
import { nowIso } from "../lib/tokens.js";
import { requireAdmin } from "../lib/session.js";
import {
  getClientIp,
  evaluateSharedRateLimit,
  rateLimitResponse,
  rateLimitUnavailableResponse,
  sensitiveRateLimitOptions,
} from "../lib/rate-limit.js";
import {
  getUserAssetStorageUsageSnapshot,
} from "../lib/asset-storage-quota.js";
import {
  decodePaginationCursor,
  encodePaginationCursor,
  paginationErrorResponse,
  readCursorInteger,
  readCursorString,
  resolvePaginationLimit,
} from "../lib/pagination.js";
import { toAiImageAssetRecord } from "../lib/ai-image-derivatives.js";
import {
  AiAssetLifecycleError,
  deleteUserAiAssets,
  deleteUserAiFolder,
  moveUserAiAssets,
} from "./ai/lifecycle.js";
import {
  buildRenamedFileName,
  hasControlCharacters,
  isHexAssetId,
  isMissingTextAssetTableError,
  slugify,
  toAiFileAssetRecord,
} from "./ai/helpers.js";

const ADMIN_USER_ASSET_CURSOR_TYPE = "admin_user_assets";
const DEFAULT_ADMIN_USER_ASSET_LIMIT = 100;
const MAX_ADMIN_USER_ASSET_LIMIT = 200;
const ADMIN_ASSET_IMAGE_KIND_RANK = 2;
const ADMIN_ASSET_FILE_KIND_RANK = 1;
const MAX_FOLDER_NAME_LENGTH = 100;
const MAX_IMAGE_NAME_LENGTH = 1000;
const MAX_FILE_ASSET_NAME_LENGTH = 120;
const AI_IMAGE_LIST_COLUMNS =
  "id, folder_id, prompt, model, steps, seed, created_at, size_bytes, visibility, published_at, thumb_key, medium_key, thumb_width, thumb_height, medium_width, medium_height, derivatives_status, derivatives_version";

function storageRouteMatch(pathname) {
  return pathname === "/api/admin/users"
    || pathname.startsWith("/api/admin/users/");
}

async function enforceAdminStorageRateLimit(ctx, {
  scope = "admin-storage-read-ip",
  maxRequests = 120,
  windowMs = 15 * 60_000,
  component = "admin-storage",
} = {}) {
  const result = await evaluateSharedRateLimit(
    ctx.env,
    scope,
    getClientIp(ctx.request),
    maxRequests,
    windowMs,
    sensitiveRateLimitOptions({
      component,
      correlationId: ctx.correlationId || null,
      requestInfo: ctx,
    })
  );
  if (result.unavailable) return rateLimitUnavailableResponse(ctx.correlationId || null);
  if (result.limited) return rateLimitResponse();
  return null;
}

async function getTargetUser(env, userId) {
  if (!userId) return null;
  return await env.DB.prepare(
    "SELECT id, email, role, status, created_at, updated_at FROM users WHERE id = ? LIMIT 1"
  ).bind(userId).first();
}

async function getStorageUsageOrNull(env, userId) {
  try {
    return await getUserAssetStorageUsageSnapshot(env, userId);
  } catch {
    return null;
  }
}

function addFolderCount(stats, folderId, count) {
  const key = folderId || null;
  const current = stats.get(key) || { fileCount: 0, sizeBytes: 0 };
  current.fileCount += Number(count || 0);
  stats.set(key, current);
}

function addFolderSize(stats, folderId, sizeBytes) {
  const key = folderId || null;
  const current = stats.get(key) || { fileCount: 0, sizeBytes: 0 };
  current.sizeBytes += Number(sizeBytes || 0);
  stats.set(key, current);
}

async function loadFolderStats(env, userId) {
  const stats = new Map();

  const imageCountRows = await env.DB.prepare(
    "SELECT folder_id, COUNT(*) AS cnt FROM ai_images WHERE user_id = ? GROUP BY folder_id"
  ).bind(userId).all();
  for (const row of imageCountRows.results || []) {
    addFolderCount(stats, row.folder_id, row.cnt);
  }

  const imageSizeRows = await env.DB.prepare(
    "SELECT folder_id, COALESCE(SUM(size_bytes), 0) AS size_bytes FROM ai_images WHERE user_id = ? GROUP BY folder_id"
  ).bind(userId).all();
  for (const row of imageSizeRows.results || []) {
    addFolderSize(stats, row.folder_id, row.size_bytes);
  }

  try {
    const textCountRows = await env.DB.prepare(
      "SELECT folder_id, COUNT(*) AS cnt FROM ai_text_assets WHERE user_id = ? GROUP BY folder_id"
    ).bind(userId).all();
    for (const row of textCountRows.results || []) {
      addFolderCount(stats, row.folder_id, row.cnt);
    }

    const textSizeRows = await env.DB.prepare(
      "SELECT folder_id, COALESCE(SUM(size_bytes), 0) + COALESCE(SUM(poster_size_bytes), 0) AS size_bytes FROM ai_text_assets WHERE user_id = ? GROUP BY folder_id"
    ).bind(userId).all();
    for (const row of textSizeRows.results || []) {
      addFolderSize(stats, row.folder_id, row.size_bytes);
    }
  } catch (error) {
    if (!isMissingTextAssetTableError(error)) throw error;
  }

  return stats;
}

function adminAssetUrl(userId, assetId) {
  return `/api/admin/users/${encodeURIComponent(userId)}/assets/${encodeURIComponent(assetId)}/file`;
}

function toAdminAssetRecord(row, userId) {
  const record = Number(row.asset_kind_rank ?? ADMIN_ASSET_IMAGE_KIND_RANK) === ADMIN_ASSET_IMAGE_KIND_RANK
    ? toAiImageAssetRecord(row, { assetType: "image" })
    : toAiFileAssetRecord(row);
  const fileUrl = adminAssetUrl(userId, record.id);
  record.file_url = fileUrl;
  if (record.asset_type === "image") {
    record.original_url = fileUrl;
    record.thumb_url = null;
    record.medium_url = null;
  }
  record.storage_provider = "USER_IMAGES";
  return record;
}

async function listUserAssetsPage(ctx, userId, appliedLimit) {
  const { env, url } = ctx;
  let cursor = null;
  try {
    cursor = await decodePaginationCursor(env, url.searchParams.get("cursor"), ADMIN_USER_ASSET_CURSOR_TYPE);
    if (cursor) {
      cursor = {
        u: readCursorString(cursor, "u"),
        c: readCursorString(cursor, "c"),
        r: readCursorInteger(cursor, "r", {
          min: ADMIN_ASSET_FILE_KIND_RANK,
          max: ADMIN_ASSET_IMAGE_KIND_RANK,
        }),
        i: readCursorString(cursor, "i"),
      };
    }
  } catch {
    return { response: paginationErrorResponse("Invalid cursor.") };
  }
  if (cursor && cursor.u !== userId) {
    return { response: paginationErrorResponse("Invalid cursor.") };
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
             ${ADMIN_ASSET_IMAGE_KIND_RANK} AS asset_kind_rank
      FROM ai_images
      WHERE user_id = ?
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
             ${ADMIN_ASSET_FILE_KIND_RANK} AS asset_kind_rank
      FROM ai_text_assets
      WHERE user_id = ?
    ) AS assets
    ${cursorClause}
    ORDER BY created_at DESC, asset_kind_rank DESC, id DESC
    LIMIT ?`;

  let rows = { results: [] };
  try {
    rows = await env.DB.prepare(unionQuery)
      .bind(userId, userId, ...cursorBindings, appliedLimit + 1)
      .all();
  } catch (error) {
    if (!isMissingTextAssetTableError(error)) throw error;
    const imageRows = await env.DB.prepare(
      `SELECT ${AI_IMAGE_LIST_COLUMNS}
       FROM ai_images
       WHERE user_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    ).bind(userId, appliedLimit + 1).all();
    rows = imageRows;
  }

  const results = rows.results || [];
  const hasMore = results.length > appliedLimit;
  const pageRows = hasMore ? results.slice(0, appliedLimit) : results;
  const last = pageRows[pageRows.length - 1];
  return {
    assets: pageRows.map((row) => toAdminAssetRecord(row, userId)),
    nextCursor: hasMore && last
      ? await encodePaginationCursor(env, ADMIN_USER_ASSET_CURSOR_TYPE, {
          u: userId,
          c: last.created_at,
          r: Number(last.asset_kind_rank || ADMIN_ASSET_IMAGE_KIND_RANK),
          i: last.id,
        })
      : null,
    hasMore,
  };
}

async function handleGetUserStorage(ctx, targetUserId) {
  const { env, url } = ctx;
  const appliedLimit = resolvePaginationLimit(url.searchParams.get("limit"), {
    defaultValue: DEFAULT_ADMIN_USER_ASSET_LIMIT,
    maxValue: MAX_ADMIN_USER_ASSET_LIMIT,
  });
  const targetUser = await getTargetUser(env, targetUserId);
  if (!targetUser) {
    return json({ ok: false, error: "User not found." }, { status: 404 });
  }

  const page = await listUserAssetsPage(ctx, targetUser.id, appliedLimit);
  if (page.response) return page.response;

  const foldersRows = await env.DB.prepare(
    "SELECT id, name, slug, status, created_at FROM ai_folders WHERE user_id = ? AND status IN ('active') ORDER BY name ASC"
  ).bind(targetUser.id).all();
  const folderStats = await loadFolderStats(env, targetUser.id);
  const folders = (foldersRows.results || []).map((folder) => {
    const stats = folderStats.get(folder.id) || { fileCount: 0, sizeBytes: 0 };
    return {
      ...folder,
      file_count: stats.fileCount,
      size_bytes: stats.sizeBytes,
    };
  });
  const unfoldered = folderStats.get(null) || { fileCount: 0, sizeBytes: 0 };
  const totals = Array.from(folderStats.values()).reduce((acc, stats) => ({
    assetCount: acc.assetCount + stats.fileCount,
    sizeBytes: acc.sizeBytes + stats.sizeBytes,
  }), { assetCount: 0, sizeBytes: 0 });

  return json({
    ok: true,
    data: {
      user: targetUser,
      storageUsage: await getStorageUsageOrNull(env, targetUser.id),
      summary: {
        assetCount: totals.assetCount,
        folderCount: folders.length,
        unfolderedCount: unfoldered.fileCount,
        unfolderedSizeBytes: unfoldered.sizeBytes,
        totalAssetBytes: totals.sizeBytes,
      },
      folders,
      assets: page.assets,
      next_cursor: page.nextCursor,
      has_more: page.hasMore,
      applied_limit: appliedLimit,
    },
  });
}

function parseByteRange(rangeHeader, size) {
  const totalSize = Number(size);
  if (!rangeHeader || !Number.isFinite(totalSize) || totalSize <= 0) return null;
  const value = String(rangeHeader).trim();
  if (!value.toLowerCase().startsWith("bytes=")) return { invalid: true };
  const spec = value.slice(6).trim();
  if (!spec || spec.includes(",")) return { invalid: true };
  const [rawStart, rawEnd] = spec.split("-");
  if (rawStart === undefined || rawEnd === undefined) return { invalid: true };
  let start;
  let end;
  if (rawStart === "") {
    if (!/^\d+$/.test(rawEnd)) return { invalid: true };
    const suffixLength = Number.parseInt(rawEnd, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return { invalid: true };
    start = Math.max(totalSize - suffixLength, 0);
    end = totalSize - 1;
  } else {
    if (!/^\d+$/.test(rawStart) || (rawEnd !== "" && !/^\d+$/.test(rawEnd))) return { invalid: true };
    start = Number.parseInt(rawStart, 10);
    end = rawEnd === "" ? totalSize - 1 : Number.parseInt(rawEnd, 10);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return { invalid: true };
  }
  if (start < 0 || end < start || start >= totalSize) return { invalid: true };
  return {
    start,
    end: Math.min(end, totalSize - 1),
    size: totalSize,
  };
}

function buildUnsatisfiableRangeResponse(size) {
  const headers = new Headers();
  headers.set("Content-Range", `bytes */${Number(size) || 0}`);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "private, max-age=3600");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(null, { status: 416, headers });
}

async function handleGetUserAssetFile(ctx, targetUserId, assetId) {
  const { request, env } = ctx;
  const targetUser = await getTargetUser(env, targetUserId);
  if (!targetUser) {
    return json({ ok: false, error: "User not found." }, { status: 404 });
  }
  if (!isHexAssetId(assetId)) {
    return json({ ok: false, error: "Invalid asset ID." }, { status: 400 });
  }

  const image = await env.DB.prepare(
    "SELECT r2_key FROM ai_images WHERE id = ? AND user_id = ?"
  ).bind(assetId, targetUser.id).first();
  if (image) {
    const object = await env.USER_IMAGES.get(image.r2_key);
    if (!object) {
      return json({ ok: false, error: "Image file not found." }, { status: 404 });
    }
    const headers = new Headers();
    headers.set("Content-Type", object.httpMetadata?.contentType || "image/png");
    headers.set("Cache-Control", "private, max-age=3600");
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(object.body, { headers });
  }

  let file;
  try {
    file = await env.DB.prepare(
      "SELECT r2_key, file_name, mime_type FROM ai_text_assets WHERE id = ? AND user_id = ?"
    ).bind(assetId, targetUser.id).first();
  } catch (error) {
    if (isMissingTextAssetTableError(error)) {
      return json({ ok: false, error: "Saved asset service unavailable." }, { status: 503 });
    }
    throw error;
  }
  if (!file) {
    return json({ ok: false, error: "Asset not found." }, { status: 404 });
  }

  const rangeHeader = request.headers.get("Range");
  const metadataHead = rangeHeader ? await env.USER_IMAGES.head(file.r2_key) : null;
  if (rangeHeader && !metadataHead) {
    return json({ ok: false, error: "Saved asset file not found." }, { status: 404 });
  }
  const range = rangeHeader ? parseByteRange(rangeHeader, metadataHead?.size) : null;
  if (range?.invalid) {
    return buildUnsatisfiableRangeResponse(metadataHead?.size || 0);
  }

  const object = range
    ? await env.USER_IMAGES.get(file.r2_key, {
        range: {
          offset: range.start,
          length: range.end - range.start + 1,
        },
      })
    : await env.USER_IMAGES.get(file.r2_key);
  if (!object) {
    return json({ ok: false, error: "Saved asset file not found." }, { status: 404 });
  }

  const contentLength = range ? range.end - range.start + 1 : object.size;
  const headers = new Headers();
  headers.set("Content-Type", file.mime_type || object.httpMetadata?.contentType || "application/octet-stream");
  headers.set("Cache-Control", "private, max-age=3600");
  headers.set("Accept-Ranges", "bytes");
  headers.set("X-Content-Type-Options", "nosniff");
  if (contentLength) headers.set("Content-Length", String(contentLength));
  if (file.file_name) headers.set("Content-Disposition", `inline; filename=\"${file.file_name}\"`);
  if (range) {
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${range.size}`);
    return new Response(object.body, { status: 206, headers });
  }
  return new Response(object.body, { headers });
}

async function auditStorageEvent(ctx, adminUser, action, targetUser, meta = {}) {
  await enqueueAdminAuditEvent(
    ctx.env,
    {
      adminUserId: adminUser.id,
      action,
      targetUserId: targetUser.id,
      meta: {
        ...meta,
        target_email: targetUser.email,
        target_role: targetUser.role,
        target_status: targetUser.status,
        actor_email: adminUser.email,
      },
      createdAt: nowIso(),
    },
    {
      correlationId: ctx.correlationId || null,
      requestInfo: ctx,
      allowDirectFallback: true,
    }
  );
}

async function handleRenameUserAsset(ctx, session, targetUserId, assetId) {
  const { request, env } = ctx;
  const targetUser = await getTargetUser(env, targetUserId);
  if (!targetUser) return json({ ok: false, error: "User not found." }, { status: 404 });
  if (!isHexAssetId(assetId)) return json({ ok: false, error: "Invalid asset ID." }, { status: 400 });

  const parsed = await readJsonBodyOrResponse(request, { maxBytes: BODY_LIMITS.smallJson });
  if (parsed.response) return parsed.response;
  const name = String(parsed.body?.name || "").trim();
  if (!name) return json({ ok: false, error: "Asset name is required." }, { status: 400 });
  if (hasControlCharacters(name)) {
    return json({ ok: false, error: "Asset name cannot contain control characters." }, { status: 400 });
  }

  const image = await env.DB.prepare(
    "SELECT id, prompt FROM ai_images WHERE id = ? AND user_id = ?"
  ).bind(assetId, targetUser.id).first();
  if (image) {
    if (name.length > MAX_IMAGE_NAME_LENGTH) {
      return json({ ok: false, error: `Image name must be 1–${MAX_IMAGE_NAME_LENGTH} characters.` }, { status: 400 });
    }
    if (image.prompt !== name) {
      await env.DB.prepare(
        "UPDATE ai_images SET prompt = ? WHERE id = ? AND user_id = ?"
      ).bind(name, assetId, targetUser.id).run();
      await auditStorageEvent(ctx, session.user, "admin_user_asset_renamed", targetUser, {
        asset_id: assetId,
        asset_type: "image",
      });
    }
    return json({ ok: true, data: { id: assetId, title: name, prompt: name, unchanged: image.prompt === name } });
  }

  let file;
  try {
    file = await env.DB.prepare(
      "SELECT id, title, file_name, mime_type, source_module FROM ai_text_assets WHERE id = ? AND user_id = ?"
    ).bind(assetId, targetUser.id).first();
  } catch (error) {
    if (isMissingTextAssetTableError(error)) {
      return json({ ok: false, error: "Text asset service unavailable." }, { status: 503 });
    }
    throw error;
  }
  if (!file) return json({ ok: false, error: "Asset not found." }, { status: 404 });
  if (name.length > MAX_FILE_ASSET_NAME_LENGTH) {
    return json({ ok: false, error: `Asset name must be 1–${MAX_FILE_ASSET_NAME_LENGTH} characters.` }, { status: 400 });
  }

  const nextFileName = buildRenamedFileName(name, file);
  const unchanged = file.title === name && file.file_name === nextFileName;
  if (!unchanged) {
    await env.DB.prepare(
      "UPDATE ai_text_assets SET title = ?, file_name = ? WHERE id = ? AND user_id = ?"
    ).bind(name, nextFileName, assetId, targetUser.id).run();
    await auditStorageEvent(ctx, session.user, "admin_user_asset_renamed", targetUser, {
      asset_id: assetId,
      asset_type: file.source_module || "file",
    });
  }
  return json({ ok: true, data: { id: assetId, title: name, file_name: nextFileName, unchanged } });
}

async function handleMoveUserAsset(ctx, session, targetUserId, assetId) {
  const { request, env } = ctx;
  const targetUser = await getTargetUser(env, targetUserId);
  if (!targetUser) return json({ ok: false, error: "User not found." }, { status: 404 });
  if (!isHexAssetId(assetId)) return json({ ok: false, error: "Invalid asset ID." }, { status: 400 });
  const parsed = await readJsonBodyOrResponse(request, { maxBytes: BODY_LIMITS.smallJson });
  if (parsed.response) return parsed.response;
  const folderId = parsed.body?.folder_id || parsed.body?.folderId || null;
  if (folderId && !isHexAssetId(folderId)) {
    return json({ ok: false, error: "Invalid folder ID." }, { status: 400 });
  }

  try {
    const result = await moveUserAiAssets({
      env,
      userId: targetUser.id,
      assetIds: [assetId],
      folderId,
    });
    await auditStorageEvent(ctx, session.user, "admin_user_asset_moved", targetUser, {
      asset_id: assetId,
      folder_id: folderId,
    });
    return json({ ok: true, data: { moved: result.moved, folder_id: folderId } });
  } catch (error) {
    if (!(error instanceof AiAssetLifecycleError)) throw error;
    return json({ ok: false, error: error.message }, { status: error.status });
  }
}

async function handleUpdateUserAssetVisibility(ctx, session, targetUserId, assetId) {
  const { request, env } = ctx;
  const targetUser = await getTargetUser(env, targetUserId);
  if (!targetUser) return json({ ok: false, error: "User not found." }, { status: 404 });
  if (!isHexAssetId(assetId)) return json({ ok: false, error: "Invalid asset ID." }, { status: 400 });
  const parsed = await readJsonBodyOrResponse(request, { maxBytes: BODY_LIMITS.smallJson });
  if (parsed.response) return parsed.response;
  const visibility = String(parsed.body?.visibility || "").trim().toLowerCase();
  if (visibility !== "public" && visibility !== "private") {
    return json({ ok: false, error: "Invalid visibility." }, { status: 400 });
  }

  const image = await env.DB.prepare(
    "SELECT id, visibility, published_at FROM ai_images WHERE id = ? AND user_id = ?"
  ).bind(assetId, targetUser.id).first();
  if (image) {
    const publishedAt = visibility === "public"
      ? (image.visibility === "public" && image.published_at ? image.published_at : nowIso())
      : null;
    await env.DB.prepare(
      "UPDATE ai_images SET visibility = ?, published_at = ? WHERE id = ? AND user_id = ?"
    ).bind(visibility, publishedAt, assetId, targetUser.id).run();
    await auditStorageEvent(ctx, session.user, "admin_user_asset_visibility_updated", targetUser, {
      asset_id: assetId,
      asset_type: "image",
      visibility,
    });
    return json({ ok: true, data: { id: assetId, visibility, is_public: visibility === "public", published_at: publishedAt } });
  }

  let file;
  try {
    file = await env.DB.prepare(
      "SELECT id, visibility, published_at FROM ai_text_assets WHERE id = ? AND user_id = ?"
    ).bind(assetId, targetUser.id).first();
  } catch (error) {
    if (isMissingTextAssetTableError(error)) {
      return json({ ok: false, error: "Asset service unavailable." }, { status: 503 });
    }
    throw error;
  }
  if (!file) return json({ ok: false, error: "Asset not found." }, { status: 404 });
  const publishedAt = visibility === "public"
    ? (file.visibility === "public" && file.published_at ? file.published_at : nowIso())
    : null;
  await env.DB.prepare(
    "UPDATE ai_text_assets SET visibility = ?, published_at = ? WHERE id = ? AND user_id = ?"
  ).bind(visibility, publishedAt, assetId, targetUser.id).run();
  await auditStorageEvent(ctx, session.user, "admin_user_asset_visibility_updated", targetUser, {
    asset_id: assetId,
    asset_type: "file",
    visibility,
  });
  return json({ ok: true, data: { id: assetId, visibility, is_public: visibility === "public", published_at: publishedAt } });
}

async function handleDeleteUserAsset(ctx, session, targetUserId, assetId) {
  const { env } = ctx;
  const targetUser = await getTargetUser(env, targetUserId);
  if (!targetUser) return json({ ok: false, error: "User not found." }, { status: 404 });
  if (!isHexAssetId(assetId)) return json({ ok: false, error: "Invalid asset ID." }, { status: 400 });
  try {
    const result = await deleteUserAiAssets({
      env,
      userId: targetUser.id,
      assetIds: [assetId],
    });
    await auditStorageEvent(ctx, session.user, "admin_user_asset_deleted", targetUser, {
      asset_id: assetId,
    });
    return json({ ok: true, data: { deleted: result.deleted } });
  } catch (error) {
    if (!(error instanceof AiAssetLifecycleError)) throw error;
    return json({ ok: false, error: error.message }, { status: error.status });
  }
}

async function handleRenameUserFolder(ctx, session, targetUserId, folderId) {
  const { request, env } = ctx;
  const targetUser = await getTargetUser(env, targetUserId);
  if (!targetUser) return json({ ok: false, error: "User not found." }, { status: 404 });
  if (!isHexAssetId(folderId)) return json({ ok: false, error: "Invalid folder ID." }, { status: 400 });
  const parsed = await readJsonBodyOrResponse(request, { maxBytes: BODY_LIMITS.smallJson });
  if (parsed.response) return parsed.response;
  const name = String(parsed.body?.name || "").trim();
  if (name.length === 0 || name.length > MAX_FOLDER_NAME_LENGTH) {
    return json({ ok: false, error: `Folder name must be 1–${MAX_FOLDER_NAME_LENGTH} characters.` }, { status: 400 });
  }
  if (hasControlCharacters(name)) {
    return json({ ok: false, error: "Folder name cannot contain control characters." }, { status: 400 });
  }
  const existing = await env.DB.prepare(
    "SELECT id, name, slug FROM ai_folders WHERE id = ? AND user_id = ? AND status = 'active'"
  ).bind(folderId, targetUser.id).first();
  if (!existing) return json({ ok: false, error: "Folder not found." }, { status: 404 });

  const nextSlug = slugify(name);
  const unchanged = existing.name === name && existing.slug === nextSlug;
  if (!unchanged) {
    try {
      await env.DB.prepare(
        "UPDATE ai_folders SET name = ?, slug = ? WHERE id = ? AND user_id = ? AND status = 'active'"
      ).bind(name, nextSlug, folderId, targetUser.id).run();
    } catch (error) {
      if (String(error).includes("UNIQUE")) {
        return json({ ok: false, error: "A folder with that name already exists." }, { status: 409 });
      }
      throw error;
    }
    await auditStorageEvent(ctx, session.user, "admin_user_folder_renamed", targetUser, {
      folder_id: folderId,
    });
  }
  return json({ ok: true, data: { id: folderId, name, slug: nextSlug, unchanged } });
}

async function handleDeleteUserFolder(ctx, session, targetUserId, folderId) {
  const { env } = ctx;
  const targetUser = await getTargetUser(env, targetUserId);
  if (!targetUser) return json({ ok: false, error: "User not found." }, { status: 404 });
  if (!isHexAssetId(folderId)) return json({ ok: false, error: "Invalid folder ID." }, { status: 400 });
  try {
    await deleteUserAiFolder({
      env,
      userId: targetUser.id,
      folderId,
    });
    await auditStorageEvent(ctx, session.user, "admin_user_folder_deleted", targetUser, {
      folder_id: folderId,
    });
    return json({ ok: true });
  } catch (error) {
    if (!(error instanceof AiAssetLifecycleError)) throw error;
    return json({ ok: false, error: error.message }, { status: error.status });
  }
}

export async function handleAdminStorage(ctx) {
  const { request, pathname, method, env, isSecure, correlationId } = ctx;
  if (!storageRouteMatch(pathname)) return null;
  const isAdminStorageRoute =
    /^\/api\/admin\/users\/[^/]+\/storage$/.test(pathname)
    || /^\/api\/admin\/users\/[^/]+\/assets\/[a-f0-9]+\/file$/.test(pathname)
    || /^\/api\/admin\/users\/[^/]+\/assets\/[a-f0-9]+\/rename$/.test(pathname)
    || /^\/api\/admin\/users\/[^/]+\/assets\/[a-f0-9]+\/folder$/.test(pathname)
    || /^\/api\/admin\/users\/[^/]+\/assets\/[a-f0-9]+\/visibility$/.test(pathname)
    || /^\/api\/admin\/users\/[^/]+\/assets\/[a-f0-9]+$/.test(pathname)
    || /^\/api\/admin\/users\/[^/]+\/folders\/[a-f0-9]+$/.test(pathname);
  if (!isAdminStorageRoute) return null;

  const session = await requireAdmin(request, env, { isSecure, correlationId });
  if (session instanceof Response) return session;

  const storageMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/storage$/);
  // route-policy: admin.users.storage.read
  if (storageMatch && method === "GET") {
    const limited = await enforceAdminStorageRateLimit(ctx);
    if (limited) return limited;
    return handleGetUserStorage(ctx, decodeURIComponent(storageMatch[1]));
  }

  const fileMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/assets\/([a-f0-9]+)\/file$/);
  // route-policy: admin.users.storage.asset.file
  if (fileMatch && method === "GET") {
    const limited = await enforceAdminStorageRateLimit(ctx);
    if (limited) return limited;
    return handleGetUserAssetFile(ctx, decodeURIComponent(fileMatch[1]), fileMatch[2]);
  }

  const writeLimited = async () => enforceAdminStorageRateLimit(ctx, {
    scope: "admin-storage-write-ip",
    maxRequests: 30,
    windowMs: 15 * 60_000,
    component: "admin-storage-write",
  });

  const renameAssetMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/assets\/([a-f0-9]+)\/rename$/);
  // route-policy: admin.users.storage.asset.rename
  if (renameAssetMatch && method === "PATCH") {
    const limited = await writeLimited();
    if (limited) return limited;
    return handleRenameUserAsset(ctx, session, decodeURIComponent(renameAssetMatch[1]), renameAssetMatch[2]);
  }

  const moveAssetMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/assets\/([a-f0-9]+)\/folder$/);
  // route-policy: admin.users.storage.asset.move
  if (moveAssetMatch && method === "PATCH") {
    const limited = await writeLimited();
    if (limited) return limited;
    return handleMoveUserAsset(ctx, session, decodeURIComponent(moveAssetMatch[1]), moveAssetMatch[2]);
  }

  const visibilityAssetMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/assets\/([a-f0-9]+)\/visibility$/);
  // route-policy: admin.users.storage.asset.visibility
  if (visibilityAssetMatch && method === "PATCH") {
    const limited = await writeLimited();
    if (limited) return limited;
    return handleUpdateUserAssetVisibility(ctx, session, decodeURIComponent(visibilityAssetMatch[1]), visibilityAssetMatch[2]);
  }

  const deleteAssetMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/assets\/([a-f0-9]+)$/);
  // route-policy: admin.users.storage.asset.delete
  if (deleteAssetMatch && method === "DELETE") {
    const limited = await writeLimited();
    if (limited) return limited;
    return handleDeleteUserAsset(ctx, session, decodeURIComponent(deleteAssetMatch[1]), deleteAssetMatch[2]);
  }

  const folderMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/folders\/([a-f0-9]+)$/);
  // route-policy: admin.users.storage.folder.rename
  if (folderMatch && method === "PATCH") {
    const limited = await writeLimited();
    if (limited) return limited;
    return handleRenameUserFolder(ctx, session, decodeURIComponent(folderMatch[1]), folderMatch[2]);
  }
  // route-policy: admin.users.storage.folder.delete
  if (folderMatch && method === "DELETE") {
    const limited = await writeLimited();
    if (limited) return limited;
    return handleDeleteUserFolder(ctx, session, decodeURIComponent(folderMatch[1]), folderMatch[2]);
  }

  return null;
}
