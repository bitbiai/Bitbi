import { errorResponse } from "./responses.js";
import {
  getErrorFields,
  getRequestLogFields,
  logDiagnostic,
  withCorrelationId,
} from "../../../../js/shared/worker-observability.mjs";

export class AiWorkerConfigError extends Error {
  constructor(message = "AI worker configuration is unavailable.", { reason = "invalid_config" } = {}) {
    super(message);
    this.name = "AiWorkerConfigError";
    this.code = "worker_config_unavailable";
    this.status = 503;
    this.reason = reason;
  }
}

export function assertAiWorkerConfig(env) {
  const secret = String(env?.AI_SERVICE_AUTH_SECRET || "").trim();
  if (secret.length < 16) {
    throw new AiWorkerConfigError("AI service authentication secret is missing or invalid.", {
      reason: "ai_service_auth_secret_missing_or_short",
    });
  }
  if (!env?.SERVICE_AUTH_REPLAY) {
    throw new AiWorkerConfigError("AI service authentication replay binding is missing.", {
      reason: "service_auth_replay_binding_missing",
    });
  }
}

export function workerConfigUnavailableResponse(correlationId = null) {
  return withCorrelationId(errorResponse(
    "Service temporarily unavailable. Please try again later.",
    { status: 503, code: "service_unavailable" }
  ), correlationId);
}

export function logAiWorkerConfigFailure({ error, correlationId = null, requestInfo = null } = {}) {
  logDiagnostic({
    service: "bitbi-ai",
    component: "config",
    event: "worker_config_invalid",
    level: "error",
    correlationId,
    config_reason: error?.reason || "unknown",
    status: 503,
    ...getRequestLogFields(requestInfo),
    ...getErrorFields(error, { includeMessage: false }),
  });
}
