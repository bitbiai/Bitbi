import { json } from "../../lib/response.js";
import { requireUser } from "../../lib/session.js";
import {
  BODY_LIMITS,
  readJsonBodyOrResponse,
} from "../../lib/request.js";
import { nowIso } from "../../lib/tokens.js";
import { isMissingTextAssetTableError } from "./helpers.js";
import { enforceSensitiveUserRateLimit } from "../../lib/sensitive-write-limit.js";
import {
  getMemvidStreamPreviewBacklogCounts,
  queueMemvidStreamPreviewForPublishedAsset,
} from "../../lib/memvid-stream-preview-jobs.js";
import {
  maybeDispatchMemvidStreamPreviewProcessor,
} from "../../lib/memvid-stream-preview-dispatch.js";
import {
  disableAndDeleteMemvidStreamPreviewsForUnpublishedAsset,
} from "../../lib/memvid-stream-preview-cleanup.js";
import {
  buildDeletePublicMediaCommentsStatements,
  publicMediaTypeForTextAssetSourceModule,
} from "../../lib/public-media-comments.js";
import {
  buildDeletePublicMediaLikesStatements,
} from "../../lib/public-media-interactions.js";

export async function handleUpdateImagePublication(ctx, imageId) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const limited = await enforceSensitiveUserRateLimit(ctx, {
    scope: "ai-publication-write-user",
    userId: session.user.id,
    maxRequests: 60,
    windowMs: 10 * 60_000,
    component: "ai-publication-write",
  });
  if (limited) return limited;

  const parsed = await readJsonBodyOrResponse(request, { maxBytes: BODY_LIMITS.smallJson });
  if (parsed.response) return parsed.response;
  const body = parsed.body;
  const visibility = String(body?.visibility || "").trim().toLowerCase();
  if (visibility !== "public" && visibility !== "private") {
    return json({ ok: false, error: "Invalid visibility." }, { status: 400 });
  }

  const existing = await env.DB.prepare(
    "SELECT id, visibility, published_at FROM ai_images WHERE id = ? AND user_id = ?"
  ).bind(imageId, session.user.id).first();

  if (!existing) {
    return json({ ok: false, error: "Image not found." }, { status: 404 });
  }

  const publishedAt = visibility === "public"
    ? (existing.visibility === "public" && existing.published_at ? existing.published_at : nowIso())
    : null;

  const updateStatement = env.DB.prepare(
    "UPDATE ai_images SET visibility = ?, published_at = ? WHERE id = ? AND user_id = ?"
  ).bind(visibility, publishedAt, imageId, session.user.id);
  const publicationStatements = [updateStatement];
  if (existing.visibility === "public" && visibility === "private") {
    const cleanupEntries = [{
      mediaType: "mempics",
      mediaId: imageId,
    }];
    publicationStatements.push(
      ...buildDeletePublicMediaCommentsStatements(env, cleanupEntries),
      ...buildDeletePublicMediaLikesStatements(env, cleanupEntries)
    );
  }
  await env.DB.batch(publicationStatements);

  return json({
    ok: true,
    data: {
      id: imageId,
      visibility,
      is_public: visibility === "public",
      published_at: publishedAt,
    },
  });
}

export async function handleUpdateTextAssetPublication(ctx, assetId) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const limited = await enforceSensitiveUserRateLimit(ctx, {
    scope: "ai-publication-write-user",
    userId: session.user.id,
    maxRequests: 60,
    windowMs: 10 * 60_000,
    component: "ai-publication-write",
  });
  if (limited) return limited;

  const parsed = await readJsonBodyOrResponse(request, { maxBytes: BODY_LIMITS.smallJson });
  if (parsed.response) return parsed.response;
  const body = parsed.body;
  const visibility = String(body?.visibility || "").trim().toLowerCase();
  if (visibility !== "public" && visibility !== "private") {
    return json({ ok: false, error: "Invalid visibility." }, { status: 400 });
  }

  let existing;
  try {
    existing = await env.DB.prepare(
      `SELECT id,
              user_id,
              visibility,
              published_at,
              source_module,
              r2_key,
              mime_type,
              size_bytes,
              title,
              metadata_json
       FROM ai_text_assets
       WHERE id = ?
         AND user_id = ?`
    ).bind(assetId, session.user.id).first();
  } catch (error) {
    if (isMissingTextAssetTableError(error)) {
      return json({ ok: false, error: "Asset service unavailable." }, { status: 503 });
    }
    throw error;
  }

  if (!existing) {
    return json({ ok: false, error: "Asset not found." }, { status: 404 });
  }

  const publishedAt = visibility === "public"
    ? (existing.visibility === "public" && existing.published_at ? existing.published_at : nowIso())
    : null;

  const updateStatement = env.DB.prepare(
    "UPDATE ai_text_assets SET visibility = ?, published_at = ? WHERE id = ? AND user_id = ?"
  ).bind(visibility, publishedAt, assetId, session.user.id);
  const publicationStatements = [updateStatement];
  const commentMediaType = publicMediaTypeForTextAssetSourceModule(existing.source_module);
  if (existing.visibility === "public" && visibility === "private" && commentMediaType) {
    const cleanupEntries = [{
      mediaType: commentMediaType,
      mediaId: assetId,
    }];
    publicationStatements.push(
      ...buildDeletePublicMediaCommentsStatements(env, cleanupEntries),
      ...buildDeletePublicMediaLikesStatements(env, cleanupEntries)
    );
  }
  await env.DB.batch(publicationStatements);

  let streamPreviewLifecycle = null;
  const wasPublic = existing.visibility === "public";
  const isVideo = existing.source_module === "video";
  if (isVideo && !wasPublic && visibility === "public") {
    const asset = {
      ...existing,
      visibility: "public",
      published_at: publishedAt,
    };
    try {
      const queued = await queueMemvidStreamPreviewForPublishedAsset(env, asset, {
        source: "publish",
      });
      const backlog = await getMemvidStreamPreviewBacklogCounts(env);
      const dispatch = await maybeDispatchMemvidStreamPreviewProcessor(env, {
        reason: "publish_threshold",
        dispatchReason: "Published Memvid Stream preview auto-dispatch.",
        queuedNewCount: backlog.queued_count,
        queuedRepairCount: backlog.repair_count,
      });
      streamPreviewLifecycle = {
        action: "publish_queue",
        queued_count: queued.queued_count,
        backlog_count: backlog.total_count,
        skipped_reason: queued.skipped_reason || dispatch.dispatch_skipped_reason || null,
        dispatch_configured: dispatch.dispatch_configured ?? dispatch.configured ?? false,
        dispatch_attempted: dispatch.dispatch_attempted ?? dispatch.attempted ?? false,
        dispatch_succeeded: dispatch.dispatch_succeeded ?? dispatch.succeeded ?? false,
        dispatch_provider: dispatch.dispatch_provider ?? dispatch.provider ?? null,
        dispatch_skipped_reason: dispatch.dispatch_skipped_reason || null,
        next_dispatch_after: dispatch.next_dispatch_after || null,
      };
    } catch (error) {
      streamPreviewLifecycle = {
        action: "publish_queue",
        queued_count: 0,
        warning: "stream_preview_queue_failed",
        error_code: error?.code || "stream_preview_queue_failed",
      };
    }
  } else if (isVideo && wasPublic && visibility === "private") {
    const asset = {
      ...existing,
      visibility: "private",
      published_at: null,
    };
    try {
      const cleanup = await disableAndDeleteMemvidStreamPreviewsForUnpublishedAsset(env, asset, {
        source: "unpublish",
        unpublishedAt: nowIso(),
      });
      streamPreviewLifecycle = {
        action: "unpublish_cleanup",
        ...cleanup,
      };
    } catch (error) {
      streamPreviewLifecycle = {
        action: "unpublish_cleanup",
        warning: "stream_preview_cleanup_failed",
        error_code: error?.code || "stream_preview_cleanup_failed",
      };
    }
  }

  return json({
    ok: true,
    data: {
      id: assetId,
      visibility,
      is_public: visibility === "public",
      published_at: publishedAt,
      stream_preview_lifecycle: streamPreviewLifecycle,
    },
  });
}
