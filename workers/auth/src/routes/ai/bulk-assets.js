import { json } from "../../lib/response.js";
import { requireUser } from "../../lib/session.js";
import {
  BODY_LIMITS,
  readJsonBodyOrResponse,
} from "../../lib/request.js";
import { enforceSensitiveUserRateLimit } from "../../lib/sensitive-write-limit.js";
import {
  isHexAssetId,
  normalizeRequestedIds,
} from "./helpers.js";
import {
  AiAssetLifecycleError,
  deleteUserAiAssets,
  moveUserAiAssets,
} from "./lifecycle.js";

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

  const limited = await enforceSensitiveUserRateLimit(ctx, {
    scope: "ai-asset-bulk-write-user",
    userId: session.user.id,
    maxRequests: 30,
    windowMs: 10 * 60_000,
    component: "ai-asset-bulk-write",
  });
  if (limited) return limited;

  const parsed = await readJsonBodyOrResponse(request, { maxBytes: BODY_LIMITS.adminJson });
  if (parsed.response) return parsed.response;
  const body = parsed.body;
  const normalized = normalizeRequestedIds(body, "asset_ids", "move");
  if (normalized.error) {
    return json({ ok: false, error: normalized.error }, { status: 400 });
  }

  const assetIds = normalized.ids;
  const folderId = body.folder_id || null;
  if (folderId) {
    if (!isHexAssetId(folderId)) {
      return json({ ok: false, error: "Invalid folder ID." }, { status: 400 });
    }
  }
  try {
    const result = await moveUserAiAssets({
      env,
      userId: session.user.id,
      assetIds,
      folderId,
    });
    logBulkActionDiagnostic("move", {
      asset_ids: assetIds,
      folder_id: folderId,
      ...result,
      branch: "success",
    });
    return json({ ok: true, data: { moved: result.moved } });
  } catch (error) {
    if (!(error instanceof AiAssetLifecycleError)) {
      throw error;
    }
    logBulkActionDiagnostic("move", {
      asset_ids: assetIds,
      folder_id: folderId,
      ...(error.details || {}),
      branch: error.branch || "batch_error",
      error: error.cause ? String(error.cause).slice(0, 500) : error.message,
    });
    return json(
      { ok: false, error: error.message },
      { status: error.status }
    );
  }
}

export async function handleBulkDeleteAssets(ctx) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const limited = await enforceSensitiveUserRateLimit(ctx, {
    scope: "ai-asset-bulk-write-user",
    userId: session.user.id,
    maxRequests: 30,
    windowMs: 10 * 60_000,
    component: "ai-asset-bulk-write",
  });
  if (limited) return limited;

  const parsed = await readJsonBodyOrResponse(request, { maxBytes: BODY_LIMITS.adminJson });
  if (parsed.response) return parsed.response;
  const body = parsed.body;
  const normalized = normalizeRequestedIds(body, "asset_ids", "delete");
  if (normalized.error) {
    return json({ ok: false, error: normalized.error }, { status: 400 });
  }

  const assetIds = normalized.ids;
  try {
    const result = await deleteUserAiAssets({
      env,
      userId: session.user.id,
      assetIds,
    });
    logBulkActionDiagnostic("delete", {
      asset_ids: assetIds,
      ...result,
      branch: "success",
    });
    return json({ ok: true, data: { deleted: result.deleted } });
  } catch (error) {
    if (!(error instanceof AiAssetLifecycleError)) {
      throw error;
    }
    logBulkActionDiagnostic("delete", {
      asset_ids: assetIds,
      ...(error.details || {}),
      branch: error.branch || "batch_error",
      error: error.cause ? String(error.cause).slice(0, 500) : error.message,
    });
    return json(
      { ok: false, error: error.message },
      { status: error.status }
    );
  }
}
