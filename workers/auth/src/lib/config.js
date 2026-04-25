import { json } from "./response.js";
import {
  getErrorFields,
  getRequestLogFields,
  logDiagnostic,
  withCorrelationId,
} from "../../../../js/shared/worker-observability.mjs";
import {
  AUTH_PURPOSE_SECRET_MIN_LENGTH,
  AUTH_PURPOSE_SECRET_NAMES,
  LEGACY_SECURITY_SECRET_MIN_LENGTH,
  LEGACY_SESSION_SECRET_NAME,
  legacySecuritySecretFallbackEnabled,
} from "./security-secrets.js";

export class WorkerConfigError extends Error {
  constructor(message = "Worker configuration is unavailable.", { reason = "invalid_config" } = {}) {
    super(message);
    this.name = "WorkerConfigError";
    this.code = "worker_config_unavailable";
    this.status = 503;
    this.reason = reason;
  }
}

function assertSecret(env, name, { minLength = 16 } = {}) {
  const value = String(env?.[name] || "").trim();
  if (value.length < minLength) {
    throw new WorkerConfigError("Required worker secret is missing or invalid.", {
      reason: `${name.toLowerCase()}_missing_or_short`,
    });
  }
}

export function assertAuthCoreConfig(env) {
  for (const secretName of Object.values(AUTH_PURPOSE_SECRET_NAMES)) {
    assertSecret(env, secretName, { minLength: AUTH_PURPOSE_SECRET_MIN_LENGTH });
  }
  if (legacySecuritySecretFallbackEnabled(env)) {
    assertSecret(env, LEGACY_SESSION_SECRET_NAME, { minLength: LEGACY_SECURITY_SECRET_MIN_LENGTH });
  }
  if (!env?.DB) {
    throw new WorkerConfigError("Required D1 binding is missing.", {
      reason: "db_binding_missing",
    });
  }
}

export function assertAuthAiServiceConfig(env) {
  assertSecret(env, "AI_SERVICE_AUTH_SECRET");
}

export function workerConfigUnavailableResponse(correlationId = null) {
  return withCorrelationId(json(
    { ok: false, error: "Service temporarily unavailable. Please try again later." },
    { status: 503 }
  ), correlationId);
}

export function logWorkerConfigFailure({ env, error, correlationId = null, requestInfo = null, component = "config" } = {}) {
  logDiagnostic({
    service: "bitbi-auth",
    component,
    event: "worker_config_invalid",
    level: "error",
    correlationId,
    config_reason: error?.reason || "unknown",
    production: String(env?.BITBI_ENV || "").trim().toLowerCase() === "production",
    status: 503,
    ...getRequestLogFields(requestInfo),
    ...getErrorFields(error, { includeMessage: false }),
  });
}
