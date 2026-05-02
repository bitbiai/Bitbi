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
    if (!/^\d+$/.test(rawStart) || (rawEnd !== "" && !/^\d+$/.test(rawEnd))) {
      return { invalid: true };
    }
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

  const rangeHeader = request.headers.get("Range");
  const rangeHead = rangeHeader ? await env.USER_IMAGES.head(row.r2_key) : null;
  if (rangeHeader && !rangeHead) {
    return json({ ok: false, error: "Saved asset file not found." }, { status: 404 });
  }
  const range = rangeHeader ? parseByteRange(rangeHeader, rangeHead?.size) : null;
  if (range?.invalid) {
    return buildUnsatisfiableRangeResponse(rangeHead?.size || 0);
  }

  const object = range
    ? await env.USER_IMAGES.get(row.r2_key, {
        range: {
          offset: range.start,
          length: range.end - range.start + 1,
        },
      })
    : await env.USER_IMAGES.get(row.r2_key);
  if (!object) {
    return json({ ok: false, error: "Saved asset file not found." }, { status: 404 });
  }

  const contentLength = range
    ? range.end - range.start + 1
    : object.size;
  const headers = new Headers();
  headers.set("Content-Type", row.mime_type || object.httpMetadata?.contentType || "text/plain; charset=utf-8");
  headers.set("Cache-Control", "private, max-age=3600");
  if (contentLength) {
    headers.set("Content-Length", String(contentLength));
  }
  headers.set("Accept-Ranges", "bytes");
  headers.set("X-Content-Type-Options", "nosniff");
  if (row.file_name) {
    headers.set("Content-Disposition", `inline; filename=\"${row.file_name}\"`);
  }
  if (range) {
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${range.size}`);
    return new Response(object.body, {
      status: 206,
      headers,
    });
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
