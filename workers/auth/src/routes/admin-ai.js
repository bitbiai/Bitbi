import { readJsonBody } from "../lib/request.js";
import { json } from "../lib/response.js";
import { requireAdmin } from "../lib/session.js";
import {
  AdminAiValidationError as InputError,
  validateAdminAiCompareBody as validateComparePayload,
  validateAdminAiEmbeddingsBody as validateEmbeddingsPayload,
  validateAdminAiImageBody as validateImagePayload,
  validateAdminAiLiveAgentBody as validateLiveAgentPayload,
  validateAdminAiMusicBody as validateMusicPayload,
  validateAdminAiTextBody as validateTextPayload,
  validateAdminAiVideoBody as validateVideoPayload,
  validateFlux2DevReferenceImageDimensions,
} from "../../../../js/shared/admin-ai-contract.mjs";
import { withCorrelationId } from "../../../../js/shared/worker-observability.mjs";
import {
  proxyLiveAgentToAiLab,
  proxyToAiLab,
  rateLimitAdminAi,
} from "../lib/admin-ai-proxy.js";
import { handleAdminAiDerivativeBackfillRequest } from "../lib/admin-ai-derivative-backfill.js";
import { handleAdminAiSaveTextAssetRequest } from "../lib/admin-ai-save-text.js";
import { withAdminAiCode } from "../lib/admin-ai-response.js";

function inputErrorResponse(error, correlationId = null) {
  return withCorrelationId(json(
    {
      ok: false,
      error: error.message,
      code: error.code || "validation_error",
    },
    { status: error.status || 400 }
  ), correlationId);
}

function badJsonResponse(correlationId) {
  return withCorrelationId(
    json({ ok: false, error: "Invalid JSON body.", code: "bad_request" }, { status: 400 }),
    correlationId
  );
}

function notFoundResponse(correlationId) {
  return withCorrelationId(json(
    {
      ok: false,
      error: "Not found",
      code: "not_found",
    },
    { status: 404 }
  ), correlationId);
}

export async function handleAdminAI(ctx) {
  const { request, env, pathname, method } = ctx;
  const correlationId = ctx.correlationId || null;

  if (!pathname.startsWith("/api/admin/ai/")) {
    return null;
  }

  const result = await requireAdmin(request, env);
  if (result instanceof Response) {
    return withAdminAiCode(result);
  }

  if (pathname === "/api/admin/ai/models" && method === "GET") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-models-ip", 60, 600_000, correlationId);
    if (limited) return limited;
    return proxyToAiLab(env, "/internal/ai/models", { method: "GET" }, result.user, correlationId);
  }

  if (pathname === "/api/admin/ai/test-text" && method === "POST") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-text-ip", 30, 600_000, correlationId);
    if (limited) return limited;

    const body = await readJsonBody(request);
    if (!body) return badJsonResponse(correlationId);

    try {
      return proxyToAiLab(
        env,
        "/internal/ai/test-text",
        { method: "POST", body: validateTextPayload(body) },
        result.user,
        correlationId
      );
    } catch (error) {
      if (error instanceof InputError) return inputErrorResponse(error, correlationId);
      throw error;
    }
  }

  if (pathname === "/api/admin/ai/test-image" && method === "POST") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-image-ip", 10, 600_000, correlationId);
    if (limited) return limited;

    const body = await readJsonBody(request);
    if (!body) return badJsonResponse(correlationId);

    try {
      const payload = validateImagePayload(body);
      await validateFlux2DevReferenceImageDimensions(env, payload);
      return proxyToAiLab(
        env,
        "/internal/ai/test-image",
        { method: "POST", body: payload },
        result.user,
        correlationId
      );
    } catch (error) {
      if (error instanceof InputError) return inputErrorResponse(error, correlationId);
      throw error;
    }
  }

  if (pathname === "/api/admin/ai/test-embeddings" && method === "POST") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-embeddings-ip", 20, 600_000, correlationId);
    if (limited) return limited;

    const body = await readJsonBody(request);
    if (!body) return badJsonResponse(correlationId);

    try {
      return proxyToAiLab(
        env,
        "/internal/ai/test-embeddings",
        { method: "POST", body: validateEmbeddingsPayload(body) },
        result.user,
        correlationId
      );
    } catch (error) {
      if (error instanceof InputError) return inputErrorResponse(error, correlationId);
      throw error;
    }
  }

  if (pathname === "/api/admin/ai/test-music" && method === "POST") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-music-ip", 8, 600_000, correlationId);
    if (limited) return limited;

    const body = await readJsonBody(request);
    if (!body) return badJsonResponse(correlationId);

    try {
      return proxyToAiLab(
        env,
        "/internal/ai/test-music",
        { method: "POST", body: validateMusicPayload(body) },
        result.user,
        correlationId
      );
    } catch (error) {
      if (error instanceof InputError) return inputErrorResponse(error, correlationId);
      throw error;
    }
  }

  if (pathname === "/api/admin/ai/test-video" && method === "POST") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-video-ip", 8, 600_000, correlationId);
    if (limited) return limited;

    const body = await readJsonBody(request);
    if (!body) return badJsonResponse(correlationId);

    try {
      return proxyToAiLab(
        env,
        "/internal/ai/test-video",
        { method: "POST", body: validateVideoPayload(body) },
        result.user,
        correlationId
      );
    } catch (error) {
      if (error instanceof InputError) return inputErrorResponse(error, correlationId);
      throw error;
    }
  }

  if (pathname === "/api/admin/ai/compare" && method === "POST") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-compare-ip", 15, 600_000, correlationId);
    if (limited) return limited;

    const body = await readJsonBody(request);
    if (!body) return badJsonResponse(correlationId);

    try {
      return proxyToAiLab(
        env,
        "/internal/ai/compare",
        { method: "POST", body: validateComparePayload(body) },
        result.user,
        correlationId
      );
    } catch (error) {
      if (error instanceof InputError) return inputErrorResponse(error, correlationId);
      throw error;
    }
  }

  if (pathname === "/api/admin/ai/live-agent" && method === "POST") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-liveagent-ip", 20, 600_000, correlationId);
    if (limited) return limited;

    const body = await readJsonBody(request);
    if (!body) return badJsonResponse(correlationId);

    try {
      return proxyLiveAgentToAiLab(env, validateLiveAgentPayload(body), result.user, correlationId);
    } catch (error) {
      if (error instanceof InputError) return inputErrorResponse(error, correlationId);
      throw error;
    }
  }

  if (pathname === "/api/admin/ai/image-derivatives/backfill" && method === "POST") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-derivative-backfill-ip", 20, 600_000, correlationId);
    if (limited) return limited;

    const contentType = request.headers.get("content-type") || "";
    const body = contentType.includes("application/json") ? await readJsonBody(request) : {};
    if (contentType.includes("application/json") && !body) return badJsonResponse(correlationId);

    return handleAdminAiDerivativeBackfillRequest({
      env,
      body,
      adminUser: result.user,
      correlationId,
    });
  }

  if (pathname === "/api/admin/ai/save-text-asset" && method === "POST") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-save-text-ip", 25, 600_000, correlationId);
    if (limited) return limited;

    const body = await readJsonBody(request);
    if (!body) return badJsonResponse(correlationId);

    return handleAdminAiSaveTextAssetRequest({
      env,
      adminUserId: result.user.id,
      body,
      correlationId,
    });
  }

  if (pathname === "/api/admin/ai/proxy-video" && method === "POST") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-video-proxy-ip", 16, 600_000, correlationId);
    if (limited) return limited;

    const body = await readJsonBody(request);
    if (!body) return badJsonResponse(correlationId);

    const rawUrl = typeof body.url === "string" ? body.url.trim() : "";
    if (!rawUrl) {
      return withCorrelationId(
        json({ ok: false, error: "url is required.", code: "validation_error" }, { status: 400 }),
        correlationId
      );
    }

    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return withCorrelationId(
        json({ ok: false, error: "url is not a valid URL.", code: "validation_error" }, { status: 400 }),
        correlationId
      );
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return withCorrelationId(
        json({ ok: false, error: "url must use HTTPS.", code: "validation_error" }, { status: 400 }),
        correlationId
      );
    }

    let upstream;
    try {
      upstream = await fetch(rawUrl, { redirect: "follow" });
    } catch {
      return withCorrelationId(
        json({ ok: false, error: "Failed to fetch the video URL.", code: "upstream_error" }, { status: 502 }),
        correlationId
      );
    }
    if (!upstream.ok) {
      return withCorrelationId(
        json({ ok: false, error: `Upstream returned HTTP ${upstream.status}.`, code: "upstream_error" }, { status: 502 }),
        correlationId
      );
    }

    const ct = (upstream.headers.get("content-type") || "").toLowerCase();
    if (!ct.startsWith("video/")) {
      return withCorrelationId(
        json({ ok: false, error: `URL did not return video content (${ct || "missing"}).`, code: "validation_error" }, { status: 422 }),
        correlationId
      );
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": ct,
        "Cache-Control": "no-store",
      },
    });
  }

  if (pathname.startsWith("/api/admin/ai/")) {
    return notFoundResponse(correlationId);
  }

  return null;
}
