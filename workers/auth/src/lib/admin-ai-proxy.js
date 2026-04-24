import { json } from "./response.js";
import { buildServiceAuthHeaders } from "../../../../js/shared/service-auth.mjs";
import { withAdminAiCode } from "./admin-ai-response.js";
import {
  assertAuthAiServiceConfig,
  logWorkerConfigFailure,
  workerConfigUnavailableResponse,
  WorkerConfigError,
} from "./config.js";
import {
  evaluateSharedRateLimit,
  getClientIp,
  rateLimitUnavailableResponse,
  sensitiveRateLimitOptions,
} from "./rate-limit.js";
import {
  BITBI_CORRELATION_HEADER,
  getDurationMs,
  getErrorFields,
  getRequestLogFields,
  logDiagnostic,
  withCorrelationId,
} from "../../../../js/shared/worker-observability.mjs";

const AI_LAB_BASE_URL = "https://bitbi-ai.internal";

export function serviceUnavailableResponse(correlationId = null) {
  return withCorrelationId(json(
    {
      ok: false,
      error: "AI lab service unavailable.",
      code: "upstream_error",
    },
    { status: 503 }
  ), correlationId);
}

function adminAiRateLimitResponse(correlationId = null) {
  return withCorrelationId(json(
    {
      ok: false,
      error: "Too many requests. Please try again later.",
      code: "rate_limited",
    },
    { status: 429 }
  ), correlationId);
}

export async function rateLimitAdminAi(request, env, scope, maxRequests, windowMs, correlationId = null) {
  const ip = getClientIp(request);
  const url = new URL(request.url);
  const result = await evaluateSharedRateLimit(env, scope, ip, maxRequests, windowMs, sensitiveRateLimitOptions({
    component: "admin-ai",
    correlationId,
    requestInfo: { request, pathname: url.pathname, method: request.method },
  }));
  if (result.unavailable) {
    return rateLimitUnavailableResponse(correlationId);
  }
  if (result.limited) {
    return adminAiRateLimitResponse(correlationId);
  }
  return null;
}

async function buildSignedAiLabHeaders({ env, method, path, bodyText, adminUser, correlationId, requestInfo = null }) {
  try {
    assertAuthAiServiceConfig(env);
    return await buildServiceAuthHeaders({
      secret: env.AI_SERVICE_AUTH_SECRET,
      method,
      path,
      body: bodyText || "",
    });
  } catch (error) {
    if (error instanceof WorkerConfigError || error?.code === "service_auth_unavailable") {
      logWorkerConfigFailure({
        env,
        error,
        correlationId,
        requestInfo,
        component: "admin-ai-service-auth",
      });
      return null;
    }
    logDiagnostic({
      service: "bitbi-auth",
      component: "admin-ai-service-auth",
      event: "admin_ai_service_auth_sign_failed",
      level: "error",
      correlationId,
      admin_user_id: adminUser?.id || null,
      ...getRequestLogFields(requestInfo),
      ...getErrorFields(error, { includeMessage: false }),
    });
    return null;
  }
}

export async function proxyLiveAgentToAiLab(env, payload, adminUser, correlationId, requestInfo = null) {
  const startedAt = Date.now();
  if (!env.AI_LAB || typeof env.AI_LAB.fetch !== "function") {
    logDiagnostic({
      service: "bitbi-auth",
      component: "admin-ai-proxy",
      event: "admin_ai_proxy_binding_missing",
      level: "error",
      correlationId,
      status: 503,
      upstream_path: "/internal/ai/live-agent",
      admin_user_id: adminUser.id,
      ...getRequestLogFields(requestInfo),
    });
    return serviceUnavailableResponse(correlationId);
  }

  let response;
  try {
    const path = "/internal/ai/live-agent";
    const bodyText = JSON.stringify(payload);
    const serviceAuthHeaders = await buildSignedAiLabHeaders({
      env,
      method: "POST",
      path,
      bodyText,
      adminUser,
      correlationId,
      requestInfo,
    });
    if (!serviceAuthHeaders) return workerConfigUnavailableResponse(correlationId);
    response = await env.AI_LAB.fetch(
      new Request(`${AI_LAB_BASE_URL}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
          accept: "text/event-stream",
          "x-bitbi-admin-user-id": adminUser.id,
          "x-bitbi-admin-user-email": adminUser.email,
          [BITBI_CORRELATION_HEADER]: correlationId,
          ...serviceAuthHeaders,
        },
        body: bodyText,
      })
    );
  } catch (error) {
    logDiagnostic({
      service: "bitbi-auth",
      component: "admin-ai-proxy",
      event: "admin_ai_live_agent_proxy_failed",
      level: "error",
      correlationId,
      status: 503,
      upstream_path: "/internal/ai/live-agent",
      admin_user_id: adminUser.id,
      duration_ms: getDurationMs(startedAt),
      ...getRequestLogFields(requestInfo),
      ...getErrorFields(error),
    });
    return serviceUnavailableResponse(correlationId);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/event-stream")) {
    return withCorrelationId(response, correlationId);
  }

  if (response.status >= 500) {
    logDiagnostic({
      service: "bitbi-auth",
      component: "admin-ai-proxy",
      event: "admin_ai_live_agent_upstream_error",
      level: "error",
      correlationId,
      upstream_path: "/internal/ai/live-agent",
      admin_user_id: adminUser.id,
      status: response.status,
      duration_ms: getDurationMs(startedAt),
      ...getRequestLogFields(requestInfo),
    });
  }

  return withCorrelationId(await withAdminAiCode(response), correlationId);
}

export async function proxyToAiLab(env, path, init, adminUser, correlationId, requestInfo = null) {
  const startedAt = Date.now();
  if (!env.AI_LAB || typeof env.AI_LAB.fetch !== "function") {
    logDiagnostic({
      service: "bitbi-auth",
      component: "admin-ai-proxy",
      event: "admin_ai_proxy_binding_missing",
      level: "error",
      correlationId,
      status: 503,
      upstream_path: path,
      admin_user_id: adminUser.id,
      ...getRequestLogFields(requestInfo),
    });
    return serviceUnavailableResponse(correlationId);
  }

  const bodyText = init.body !== undefined ? JSON.stringify(init.body) : "";
  const serviceAuthHeaders = await buildSignedAiLabHeaders({
    env,
    method: init.method,
    path,
    bodyText,
    adminUser,
    correlationId,
    requestInfo,
  });
  if (!serviceAuthHeaders) return workerConfigUnavailableResponse(correlationId);

  const headers = new Headers({
    accept: "application/json",
    "x-bitbi-admin-user-id": adminUser.id,
    "x-bitbi-admin-user-email": adminUser.email,
    [BITBI_CORRELATION_HEADER]: correlationId,
    ...serviceAuthHeaders,
  });

  if (init.body !== undefined) {
    headers.set("content-type", "application/json; charset=utf-8");
  }

  let response;
  try {
    response = await env.AI_LAB.fetch(
      new Request(`${AI_LAB_BASE_URL}${path}`, {
        method: init.method,
        headers,
        body: init.body !== undefined ? bodyText : undefined,
      })
    );
  } catch (error) {
    logDiagnostic({
      service: "bitbi-auth",
      component: "admin-ai-proxy",
      event: "admin_ai_proxy_failed",
      level: "error",
      correlationId,
      status: 503,
      upstream_path: path,
      admin_user_id: adminUser.id,
      duration_ms: getDurationMs(startedAt),
      ...getRequestLogFields(requestInfo),
      ...getErrorFields(error),
    });
    return serviceUnavailableResponse(correlationId);
  }

  if (response.status >= 500) {
    logDiagnostic({
      service: "bitbi-auth",
      component: "admin-ai-proxy",
      event: "admin_ai_upstream_error",
      level: "error",
      correlationId,
      upstream_path: path,
      admin_user_id: adminUser.id,
      status: response.status,
      duration_ms: getDurationMs(startedAt),
      ...getRequestLogFields(requestInfo),
    });
  }

  return withCorrelationId(await withAdminAiCode(response), correlationId);
}
