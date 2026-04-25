import { json } from "../../lib/response.js";
import { requireUser } from "../../lib/session.js";
import {
  BODY_LIMITS,
  readJsonBodyOrResponse,
} from "../../lib/request.js";
import { enforceSensitiveUserRateLimit } from "../../lib/sensitive-write-limit.js";
import {
  AiAssetLifecycleError,
  deleteUserAiImages,
  moveUserAiImages,
} from "./lifecycle.js";

export async function handleBulkMove(ctx) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const limited = await enforceSensitiveUserRateLimit(ctx, {
    scope: "ai-image-bulk-write-user",
    userId: session.user.id,
    maxRequests: 30,
    windowMs: 10 * 60_000,
    component: "ai-image-bulk-write",
  });
  if (limited) return limited;

  const parsed = await readJsonBodyOrResponse(request, { maxBytes: BODY_LIMITS.adminJson });
  if (parsed.response) return parsed.response;
  const body = parsed.body;
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
    try {
      const result = await moveUserAiImages({
        env,
        userId: session.user.id,
        imageIds,
        folderId,
      });
      return json({ ok: true, data: { moved: result.moved } });
    } catch (error) {
      if (!(error instanceof AiAssetLifecycleError)) {
        throw error;
      }
      return json({ ok: false, error: error.message }, { status: error.status });
    }
  }

  try {
    const result = await moveUserAiImages({
      env,
      userId: session.user.id,
      imageIds,
      folderId: null,
    });
    return json({ ok: true, data: { moved: result.moved } });
  } catch (error) {
    if (!(error instanceof AiAssetLifecycleError)) {
      throw error;
    }
    return json({ ok: false, error: error.message }, { status: error.status });
  }
}

export async function handleBulkDelete(ctx) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const limited = await enforceSensitiveUserRateLimit(ctx, {
    scope: "ai-image-bulk-write-user",
    userId: session.user.id,
    maxRequests: 30,
    windowMs: 10 * 60_000,
    component: "ai-image-bulk-write",
  });
  if (limited) return limited;

  const parsed = await readJsonBodyOrResponse(request, { maxBytes: BODY_LIMITS.adminJson });
  if (parsed.response) return parsed.response;
  const body = parsed.body;
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

  try {
    const result = await deleteUserAiImages({
      env,
      userId: session.user.id,
      imageIds,
    });
    return json({ ok: true, data: { deleted: result.deleted } });
  } catch (error) {
    if (!(error instanceof AiAssetLifecycleError)) {
      throw error;
    }
    return json({ ok: false, error: error.message }, { status: error.status });
  }
}
