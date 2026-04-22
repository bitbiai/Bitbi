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
import { logDiagnostic, withCorrelationId } from "../../../../js/shared/worker-observability.mjs";
import {
  REMOTE_MEDIA_URL_POLICY_CODE,
  attachRemoteMediaPolicyContext,
  buildRemoteMediaUrlRejectedMessage,
  getRemoteMediaPolicyLogFields,
} from "../../../../js/shared/remote-media-policy.mjs";
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
  const { request, env, pathname, method, isSecure } = ctx;
  const correlationId = ctx.correlationId || null;
  const requestInfo = { request, pathname, method };

  if (!pathname.startsWith("/api/admin/ai/")) {
    return null;
  }

  const result = await requireAdmin(request, env, { isSecure, correlationId });
  if (result instanceof Response) {
    return withAdminAiCode(result);
  }

  if (pathname === "/api/admin/ai/models" && method === "GET") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-models-ip", 60, 600_000, correlationId);
    if (limited) return limited;
    return proxyToAiLab(env, "/internal/ai/models", { method: "GET" }, result.user, correlationId, requestInfo);
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
        correlationId,
        requestInfo
      );
    } catch (error) {
      if (error instanceof InputError) {
        if (error.code === REMOTE_MEDIA_URL_POLICY_CODE) {
          logDiagnostic({
            service: "bitbi-auth",
            component: "admin-ai-video",
            event: "admin_ai_video_rejected_remote_url",
            level: "warn",
            correlationId,
            admin_user_id: result.user.id,
            ...getRemoteMediaPolicyLogFields(error),
          });
        }
        return inputErrorResponse(error, correlationId);
      }
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
        correlationId,
        requestInfo
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
        correlationId,
        requestInfo
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
        correlationId,
        requestInfo
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
      const minimalMode = body.minimal_mode === true;
      const { minimal_mode: _strip, ...validationBody } = body;
      const validated = validateVideoPayload(validationBody);
      if (minimalMode) validated.minimal_mode = true;
      return proxyToAiLab(
        env,
        "/internal/ai/test-video",
        { method: "POST", body: validated },
        result.user,
        correlationId,
        requestInfo
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
        correlationId,
        requestInfo
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
      return proxyLiveAgentToAiLab(env, validateLiveAgentPayload(body), result.user, correlationId, requestInfo);
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
    const error = attachRemoteMediaPolicyContext(
      new InputError(
        buildRemoteMediaUrlRejectedMessage(
          "url",
          "The admin remote video proxy is disabled. Stream or download the provider URL directly in the browser instead."
        ),
        410,
        REMOTE_MEDIA_URL_POLICY_CODE
      ),
      rawUrl,
      {
        field: "url",
        reason: "admin_proxy_video_disabled",
      }
    );
    logDiagnostic({
      service: "bitbi-auth",
      component: "admin-ai-proxy-video",
      event: "admin_ai_proxy_video_rejected",
      level: "warn",
      correlationId,
      admin_user_id: result.user.id,
      ...getRemoteMediaPolicyLogFields(error),
    });
    return inputErrorResponse(error, correlationId);
  }

  if (pathname.startsWith("/api/admin/ai/")) {
    return notFoundResponse(correlationId);
  }

  return null;
}
