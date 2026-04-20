import { json } from "../../lib/response.js";
import { requireUser } from "../../lib/session.js";
import {
  AI_IMAGE_DERIVATIVE_ON_DEMAND_COOLDOWN_MS,
  AI_IMAGE_DERIVATIVE_VERSION,
  buildAiImageDerivativeMessage,
  processAiImageDerivativeMessage,
  shouldAttemptOnDemandAiImageDerivative,
} from "../../lib/ai-image-derivatives.js";
import { isMissingTextAssetTableError } from "./helpers.js";

export async function handleGetImageFile(ctx, imageId) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const row = await env.DB.prepare(
    "SELECT r2_key FROM ai_images WHERE id = ? AND user_id = ?"
  ).bind(imageId, session.user.id).first();

  if (!row) {
    return json({ ok: false, error: "Image not found." }, { status: 404 });
  }

  const object = await env.USER_IMAGES.get(row.r2_key);
  if (!object) {
    return json({ ok: false, error: "Image file not found." }, { status: 404 });
  }

  const headers = new Headers();
  headers.set("Content-Type", object.httpMetadata?.contentType || "image/png");
  headers.set("Cache-Control", "private, max-age=3600");
  return new Response(object.body, { headers });
}

export async function handleGetImageDerivative(ctx, imageId, variant) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const select =
    variant === "thumb"
      ? "SELECT thumb_key AS derivative_key, thumb_mime_type AS mime_type, derivatives_status, derivatives_attempted_at, derivatives_lease_expires_at, r2_key FROM ai_images WHERE id = ? AND user_id = ?"
      : "SELECT medium_key AS derivative_key, medium_mime_type AS mime_type, derivatives_status, derivatives_attempted_at, derivatives_lease_expires_at, r2_key FROM ai_images WHERE id = ? AND user_id = ?";

  const row = await env.DB.prepare(select).bind(imageId, session.user.id).first();
  if (!row) {
    return json({ ok: false, error: "Image not found." }, { status: 404 });
  }

  if (row.derivative_key) {
    const object = await env.USER_IMAGES.get(row.derivative_key);
    if (object) {
      const headers = new Headers();
      headers.set("Content-Type", row.mime_type || object.httpMetadata?.contentType || "image/webp");
      headers.set("Cache-Control", "private, max-age=3600");
      return new Response(object.body, { headers });
    }
  }

  if (shouldAttemptOnDemandAiImageDerivative(row, { cooldownMs: AI_IMAGE_DERIVATIVE_ON_DEMAND_COOLDOWN_MS })) {
    try {
      const result = await processAiImageDerivativeMessage(
        env,
        buildAiImageDerivativeMessage({
          imageId,
          userId: session.user.id,
          originalKey: row.r2_key,
          derivativesVersion: AI_IMAGE_DERIVATIVE_VERSION,
          trigger: "on_demand",
        }),
        { isLastAttempt: true }
      );

      if (result.status === "ready") {
        const derivativeKey = variant === "thumb" ? result.keys.thumb : result.keys.medium;
        const generated = await env.USER_IMAGES.get(derivativeKey);
        if (generated) {
          const headers = new Headers();
          headers.set("Content-Type", generated.httpMetadata?.contentType || "image/webp");
          headers.set("Cache-Control", "private, max-age=3600");
          return new Response(generated.body, { headers });
        }
      }
    } catch {
      // On-demand generation failed — fall through to 404
    }
  }

  return json({ ok: false, error: "Image preview not ready." }, { status: 404 });
}

export async function handleGetTextAssetFile(ctx, assetId) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  let row;
  try {
    row = await env.DB.prepare(
      "SELECT r2_key, file_name, mime_type FROM ai_text_assets WHERE id = ? AND user_id = ?"
    ).bind(assetId, session.user.id).first();
  } catch (error) {
    if (isMissingTextAssetTableError(error)) {
      return json({ ok: false, error: "Saved asset service unavailable." }, { status: 503 });
    }
    throw error;
  }

  if (!row) {
    return json({ ok: false, error: "Saved asset not found." }, { status: 404 });
  }

  const object = await env.USER_IMAGES.get(row.r2_key);
  if (!object) {
    return json({ ok: false, error: "Saved asset file not found." }, { status: 404 });
  }

  const headers = new Headers();
  headers.set("Content-Type", row.mime_type || object.httpMetadata?.contentType || "text/plain; charset=utf-8");
  headers.set("Cache-Control", "private, max-age=3600");
  if (object.size) {
    headers.set("Content-Length", String(object.size));
  }
  headers.set("Accept-Ranges", "bytes");
  headers.set("X-Content-Type-Options", "nosniff");
  if (row.file_name) {
    headers.set("Content-Disposition", `inline; filename=\"${row.file_name}\"`);
  }
  return new Response(object.body, { headers });
}

export async function handleGetTextAssetPoster(ctx, assetId) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  let row;
  try {
    row = await env.DB.prepare(
      "SELECT poster_r2_key FROM ai_text_assets WHERE id = ? AND user_id = ? AND poster_r2_key IS NOT NULL"
    ).bind(assetId, session.user.id).first();
  } catch (error) {
    if (isMissingTextAssetTableError(error)) {
      return json({ ok: false, error: "Saved asset service unavailable." }, { status: 503 });
    }
    throw error;
  }

  if (!row?.poster_r2_key) {
    return json({ ok: false, error: "Poster not found." }, { status: 404 });
  }

  const object = await env.USER_IMAGES.get(row.poster_r2_key);
  if (!object) {
    return json({ ok: false, error: "Poster not found." }, { status: 404 });
  }

  const headers = new Headers();
  headers.set("Content-Type", object.httpMetadata?.contentType || "image/webp");
  headers.set("Cache-Control", "private, max-age=3600");
  headers.set("X-Content-Type-Options", "nosniff");
  if (object.size) {
    headers.set("Content-Length", String(object.size));
  }
  return new Response(object.body, { headers });
}
