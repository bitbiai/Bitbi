import { json } from "../../lib/response.js";
import { requireUser } from "../../lib/session.js";
import { readJsonBody } from "../../lib/request.js";
import {
  AiAssetLifecycleError,
  deleteUserAiImages,
  moveUserAiImages,
} from "./lifecycle.js";

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
