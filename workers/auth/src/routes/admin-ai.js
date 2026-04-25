import {
  BODY_LIMITS,
  readJsonBodyOrResponse,
} from "../lib/request.js";
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
import {
  getErrorFields,
  getRequestLogFields,
  logDiagnostic,
  withCorrelationId,
} from "../../../../js/shared/worker-observability.mjs";
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
import {
  createAdminAiVideoJob,
  getAdminAiVideoJob,
  normalizeAiVideoIdempotencyKey,
  serializeAiVideoJob,
} from "../lib/ai-video-jobs.js";
import { handleAdminAiDerivativeBackfillRequest } from "../lib/admin-ai-derivative-backfill.js";
import { handleAdminAiSaveTextAssetRequest } from "../lib/admin-ai-save-text.js";
import { withAdminAiCode } from "../lib/admin-ai-response.js";
import {
  logWorkerConfigFailure,
  workerConfigUnavailableResponse,
  WorkerConfigError,
} from "../lib/config.js";
import { createAiGeneratedSaveReferenceFromBase64 } from "./ai/generated-image-save-reference.js";

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

async function readAdminAiJsonBody(
  request,
  correlationId,
  { maxBytes = BODY_LIMITS.adminJson, requiredContentType = true } = {}
) {
  const parsed = await readJsonBodyOrResponse(request, { maxBytes, requiredContentType });
  if (parsed.response) {
    return { response: withCorrelationId(parsed.response, correlationId), body: null };
  }
  return { response: null, body: parsed.body };
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

function decodePathSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function videoJobResponse(job, correlationId, { status = 200, existing = false } = {}) {
  return withCorrelationId(json({
    ok: true,
    existing,
    job: serializeAiVideoJob(job),
  }, { status }), correlationId);
}

async function attachAdminImageSaveReference(response, env, adminUser, correlationId, requestInfo = null) {
  if (!(response instanceof Response)) return response;

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return response;
  }

  let body = null;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }

  if (!body?.ok || typeof body?.result?.imageBase64 !== "string" || !body.result.imageBase64) {
    return response;
  }

  try {
    const { saveReference } = await createAiGeneratedSaveReferenceFromBase64(env, {
      userId: adminUser.id,
      imageBase64: body.result.imageBase64,
      mimeType: body.result.mimeType || "image/png",
    });
    const headers = new Headers(response.headers);
    headers.set("content-type", "application/json; charset=utf-8");
    headers.delete("content-length");
    return withCorrelationId(new Response(JSON.stringify({
      ...body,
      result: {
        ...body.result,
        saveReference,
      },
    }), {
      status: response.status,
      headers,
    }), correlationId);
  } catch (error) {
    logDiagnostic({
      service: "bitbi-auth",
      component: "admin-ai-image",
      event: "admin_ai_generated_temp_store_failed",
      level: "warn",
      correlationId,
      admin_user_id: adminUser.id,
      model: body?.model?.id || null,
      ...getRequestLogFields(requestInfo),
      ...getErrorFields(error, { includeMessage: false }),
    });
    return response;
  }
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

    const parsed = await readAdminAiJsonBody(request, correlationId);
    if (parsed.response) return parsed.response;
    const body = parsed.body;
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

    const parsed = await readAdminAiJsonBody(request, correlationId);
    if (parsed.response) return parsed.response;
    const body = parsed.body;
    if (!body) return badJsonResponse(correlationId);

    try {
      const payload = validateImagePayload(body);
      await validateFlux2DevReferenceImageDimensions(env, payload);
      const response = await proxyToAiLab(
        env,
        "/internal/ai/test-image",
        { method: "POST", body: payload },
        result.user,
        correlationId,
        requestInfo
      );
      return attachAdminImageSaveReference(response, env, result.user, correlationId, requestInfo);
    } catch (error) {
      if (error instanceof InputError) return inputErrorResponse(error, correlationId);
      throw error;
    }
  }

  if (pathname === "/api/admin/ai/test-embeddings" && method === "POST") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-embeddings-ip", 20, 600_000, correlationId);
    if (limited) return limited;

    const parsed = await readAdminAiJsonBody(request, correlationId);
    if (parsed.response) return parsed.response;
    const body = parsed.body;
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

    const parsed = await readAdminAiJsonBody(request, correlationId);
    if (parsed.response) return parsed.response;
    const body = parsed.body;
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

    const parsed = await readAdminAiJsonBody(request, correlationId);
    if (parsed.response) return parsed.response;
    const body = parsed.body;
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

  if (pathname === "/api/admin/ai/video-jobs" && method === "POST") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-video-job-create-ip", 8, 600_000, correlationId);
    if (limited) return limited;

    const parsed = await readAdminAiJsonBody(request, correlationId, {
      maxBytes: BODY_LIMITS.adminVideoJobJson,
    });
    if (parsed.response) return parsed.response;
    const body = parsed.body;
    if (!body) return badJsonResponse(correlationId);

    try {
      const minimalMode = body.minimal_mode === true;
      const { minimal_mode: _strip, ...validationBody } = body;
      const validated = validateVideoPayload(validationBody);
      if (minimalMode) validated.minimal_mode = true;
      const idempotencyKey = normalizeAiVideoIdempotencyKey(request.headers.get("Idempotency-Key"));
      const { job, existing } = await createAdminAiVideoJob({
        env,
        adminUser: result.user,
        payload: validated,
        idempotencyKey,
        correlationId,
      });
      return videoJobResponse(job, correlationId, { status: existing ? 200 : 202, existing });
    } catch (error) {
      if (error instanceof InputError) return inputErrorResponse(error, correlationId);
      if (error instanceof WorkerConfigError) {
        logWorkerConfigFailure({
          env,
          error,
          correlationId,
          requestInfo,
          component: "admin-ai-video-jobs",
        });
        return workerConfigUnavailableResponse(correlationId);
      }
      throw error;
    }
  }

  const videoJobStatusMatch = pathname.match(/^\/api\/admin\/ai\/video-jobs\/([^/]+)$/);
  if (videoJobStatusMatch && method === "GET") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-video-job-status-ip", 60, 600_000, correlationId);
    if (limited) return limited;

    const jobId = decodePathSegment(videoJobStatusMatch[1]);
    if (!jobId || jobId.includes("/")) {
      return notFoundResponse(correlationId);
    }

    const job = await getAdminAiVideoJob(env, result.user, jobId);
    if (!job) {
      return notFoundResponse(correlationId);
    }
    return videoJobResponse(job, correlationId);
  }

  if (pathname === "/api/admin/ai/compare" && method === "POST") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-compare-ip", 15, 600_000, correlationId);
    if (limited) return limited;

    const parsed = await readAdminAiJsonBody(request, correlationId);
    if (parsed.response) return parsed.response;
    const body = parsed.body;
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

    const parsed = await readAdminAiJsonBody(request, correlationId);
    if (parsed.response) return parsed.response;
    const body = parsed.body;
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
    const parsed = contentType.includes("application/json")
      ? await readAdminAiJsonBody(request, correlationId)
      : { response: null, body: {} };
    if (parsed.response) return parsed.response;
    const body = parsed.body;
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

    const parsed = await readAdminAiJsonBody(request, correlationId);
    if (parsed.response) return parsed.response;
    const body = parsed.body;
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

    const parsed = await readAdminAiJsonBody(request, correlationId);
    if (parsed.response) return parsed.response;
    const body = parsed.body;
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
