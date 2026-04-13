import { json } from "./response.js";
import { getClientIp, isSharedRateLimited } from "./rate-limit.js";
import { withAdminAiCode } from "./admin-ai-response.js";
import {
  getErrorFields,
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
  if (await isSharedRateLimited(env, scope, ip, maxRequests, windowMs)) {
    return adminAiRateLimitResponse(correlationId);
  }
  return null;
}

export async function proxyLiveAgentToAiLab(env, payload, adminUser, correlationId) {
  if (!env.AI_LAB || typeof env.AI_LAB.fetch !== "function") {
    logDiagnostic({
      service: "bitbi-auth",
      component: "admin-ai-proxy",
      event: "admin_ai_proxy_binding_missing",
      level: "error",
      correlationId,
      path: "/internal/ai/live-agent",
      admin_user_id: adminUser.id,
    });
    return serviceUnavailableResponse(correlationId);
  }

  let response;
  try {
    response = await env.AI_LAB.fetch(
      new Request(`${AI_LAB_BASE_URL}/internal/ai/live-agent`, {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
          accept: "text/event-stream",
          "x-bitbi-admin-user-id": adminUser.id,
          "x-bitbi-admin-user-email": adminUser.email,
          "x-bitbi-correlation-id": correlationId,
        },
        body: JSON.stringify(payload),
      })
    );
  } catch (error) {
    logDiagnostic({
      service: "bitbi-auth",
      component: "admin-ai-proxy",
      event: "admin_ai_live_agent_proxy_failed",
      level: "error",
      correlationId,
      path: "/internal/ai/live-agent",
      admin_user_id: adminUser.id,
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
      path: "/internal/ai/live-agent",
      admin_user_id: adminUser.id,
      status: response.status,
    });
  }

  return withCorrelationId(await withAdminAiCode(response), correlationId);
}

export async function proxyToAiLab(env, path, init, adminUser, correlationId) {
  if (!env.AI_LAB || typeof env.AI_LAB.fetch !== "function") {
    logDiagnostic({
      service: "bitbi-auth",
      component: "admin-ai-proxy",
      event: "admin_ai_proxy_binding_missing",
      level: "error",
      correlationId,
      path,
      admin_user_id: adminUser.id,
    });
    return serviceUnavailableResponse(correlationId);
  }

  const headers = new Headers({
    accept: "application/json",
    "x-bitbi-admin-user-id": adminUser.id,
    "x-bitbi-admin-user-email": adminUser.email,
    "x-bitbi-correlation-id": correlationId,
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
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      })
    );
  } catch (error) {
    logDiagnostic({
      service: "bitbi-auth",
      component: "admin-ai-proxy",
      event: "admin_ai_proxy_failed",
      level: "error",
      correlationId,
      path,
      admin_user_id: adminUser.id,
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
      path,
      admin_user_id: adminUser.id,
      status: response.status,
    });
  }

  return withCorrelationId(await withAdminAiCode(response), correlationId);
}
