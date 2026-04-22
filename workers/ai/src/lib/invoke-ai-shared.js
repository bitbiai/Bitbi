// @ts-check

/**
 * @param {unknown} env
 */
export function ensureAI(env) {
  if (!env || typeof env !== "object" || typeof env.AI?.run !== "function") {
    const error = new Error("Workers AI binding is not configured.");
    // @ts-expect-error status is attached for route error mapping.
    error.status = 503;
    throw error;
  }
}

/**
 * @param {unknown} value
 */
export function isUrlLike(value) {
  if (typeof value !== "string") return false;
  return /^https?:\/\//i.test(value.trim());
}

/**
 * @param {unknown} value
 */
export function isLikelyBase64(value) {
  if (typeof value !== "string") return false;
  const compact = value.replace(/\s+/g, "");
  if (!compact || compact.length < 16 || compact.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(compact);
}

/**
 * @param {unknown} result
 */
export function summarizeResultShape(result) {
  if (result == null) {
    return { type: null };
  }

  if (typeof result === "string") {
    const trimmed = result.trim();
    let hint = "text";
    if (isUrlLike(trimmed)) hint = "url";
    else if (/^data:/i.test(trimmed)) hint = "data_uri";
    else if (/^[a-f0-9\s]+$/i.test(trimmed)) hint = "hex_like";
    else if (isLikelyBase64(trimmed)) hint = "base64_like";

    return {
      type: "string",
      length: result.length,
      hint,
    };
  }

  if (result instanceof ArrayBuffer) {
    return {
      type: "ArrayBuffer",
      byte_length: result.byteLength,
    };
  }

  if (ArrayBuffer.isView(result)) {
    return {
      type: result.constructor?.name || "TypedArray",
      byte_length: result.byteLength,
    };
  }

  if (typeof result === "object") {
    return {
      type: "object",
      keys: Object.keys(result).slice(0, 12),
      data_keys:
        result?.data && typeof result.data === "object" && !Array.isArray(result.data)
          ? Object.keys(result.data).slice(0, 12)
          : undefined,
      result_keys:
        result?.result && typeof result.result === "object" && !Array.isArray(result.result)
          ? Object.keys(result.result).slice(0, 12)
          : undefined,
    };
  }

  return {
    type: typeof result,
  };
}

/**
 * @param {unknown} value
 * @param {number} [depth]
 */
export function sanitizeErrorValue(value, depth = 0) {
  if (value == null) return value;
  if (depth >= 2) {
    if (typeof value === "string") return value.slice(0, 400);
    return typeof value;
  }

  if (typeof value === "string") {
    return value.slice(0, 400);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 6).map((entry) => sanitizeErrorValue(entry, depth + 1));
  }

  if (typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).slice(0, 12)) {
      out[key] = sanitizeErrorValue(value[key], depth + 1);
    }
    return out;
  }

  return String(value).slice(0, 400);
}

/**
 * @param {any} source
 * @param {string | string[]} path
 */
export function getNestedValue(source, path) {
  if (!source || !path) return undefined;
  const segments = Array.isArray(path) ? path : String(path).split(".");
  let current = source;
  for (const segment of segments) {
    if (current == null) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }
    current = current[segment];
  }
  return current;
}

/**
 * @param {any} source
 * @param {string[]} paths
 */
export function firstNestedValue(source, paths) {
  for (const path of paths) {
    const value = getNestedValue(source, path);
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && !value.trim()) continue;
    return value;
  }
  return null;
}

/**
 * @param {unknown} value
 */
export function getUrlHost(value) {
  if (!isUrlLike(value)) return null;
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

function summarizeMediaReference(value, label) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  const summary = {
    [`${label}_present`]: !!trimmed,
    [`${label}_length`]: trimmed.length,
  };
  if (!trimmed) {
    return summary;
  }

  if (/^data:([^;,]+)/i.test(trimmed)) {
    summary[`${label}_kind`] = "data_uri";
    summary[`${label}_mime`] = trimmed.match(/^data:([^;,]+)/i)?.[1] || null;
    return summary;
  }

  if (isUrlLike(trimmed)) {
    summary[`${label}_kind`] = "url";
    summary[`${label}_host`] = getUrlHost(trimmed);
    return summary;
  }

  summary[`${label}_kind`] = isLikelyBase64(trimmed) ? "base64_like" : "inline";
  return summary;
}

function summarizeMediaReferenceArray(values, label) {
  const items = Array.isArray(values)
    ? values.filter((value) => typeof value === "string" && value.trim())
    : [];
  const kinds = new Set();
  const hosts = new Set();

  for (const value of items) {
    const trimmed = value.trim();
    if (/^data:([^;,]+)/i.test(trimmed)) {
      kinds.add("data_uri");
      continue;
    }
    if (isUrlLike(trimmed)) {
      kinds.add("url");
      const host = getUrlHost(trimmed);
      if (host) hosts.add(host);
      continue;
    }
    kinds.add(isLikelyBase64(trimmed) ? "base64_like" : "inline");
  }

  return {
    [`${label}_count`]: items.length,
    [`${label}_kinds`]: items.length ? Array.from(kinds).sort().join(",") : null,
    [`${label}_hosts`]: hosts.size ? Array.from(hosts).sort().join(",") : null,
  };
}

/**
 * @param {Record<string, any> | null | undefined} payload
 */
export function summarizeVideoPayload(payload) {
  const keys = payload && typeof payload === "object" && !Array.isArray(payload)
    ? Object.keys(payload).sort()
    : [];
  return {
    payload_keys: keys.join(","),
    payload_key_count: keys.length,
    prompt_present: typeof payload?.prompt === "string" && payload.prompt.trim().length > 0,
    prompt_length: typeof payload?.prompt === "string" ? payload.prompt.length : 0,
    duration: payload?.duration ?? null,
    resolution: payload?.resolution ?? null,
    audio: payload?.audio ?? null,
    aspect_ratio: payload?.aspect_ratio ?? null,
    quality: payload?.quality ?? null,
    seed_present: payload?.seed !== undefined && payload?.seed !== null,
    ...summarizeMediaReference(payload?.start_image, "start_image"),
    ...summarizeMediaReference(payload?.end_image, "end_image"),
    ...summarizeMediaReferenceArray(payload?.images, "images"),
  };
}

/**
 * @param {Record<string, any> | undefined} runOptions
 */
export function summarizeGatewayOptions(runOptions) {
  return {
    has_gateway_option: !!runOptions,
    gateway_id: runOptions?.gateway?.id || null,
  };
}

/**
 * @param {any} error
 */
export function getUpstreamErrorDetails(error) {
  if (!error || typeof error !== "object") return {};

  const upstreamBody = error?.response?.body ?? error?.response?.data ?? error?.body ?? error?.data ?? error?.details ?? null;

  return {
    upstream_status: error?.response?.status ?? error?.status ?? null,
    upstream_status_text: error?.response?.statusText || null,
    upstream_error_code: sanitizeErrorValue(firstNestedValue(upstreamBody, [
      "err_code",
      "error.code",
      "code",
      "status_code",
    ])),
    upstream_body_shape: summarizeResultShape(upstreamBody),
    upstream_cause_shape: summarizeResultShape(error?.cause ?? null),
  };
}

/**
 * @param {any} aiBinding
 */
export function readAiGatewayLogId(aiBinding) {
  const value = aiBinding?.aiGatewayLogId;
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

/**
 * @param {any} gatewayLog
 */
export function extractGatewayLogSummary(gatewayLog) {
  const gatewayErrorValue = firstNestedValue(gatewayLog, [
    "response.body",
    "response.data",
    "response.error",
    "error",
    "body",
    "data",
  ]);
  const gatewayValidationValue = firstNestedValue(gatewayLog, [
    "error.details",
    "response.error.details",
    "response.body.error.details",
    "response.body.details",
    "response.body.validation",
    "response.body.errors",
    "response.data.error.details",
    "response.data.details",
    "response.data.validation",
    "response.data.errors",
    "validation",
    "details",
    "errors",
  ]);
  return {
    gateway_log_shape: summarizeResultShape(gatewayLog),
    gateway_provider_id: sanitizeErrorValue(firstNestedValue(gatewayLog, [
      "provider.id",
      "request.provider.id",
      "target.provider.id",
      "metadata.provider.id",
      "provider",
    ])),
    gateway_provider_name: sanitizeErrorValue(firstNestedValue(gatewayLog, [
      "provider.name",
      "request.provider.name",
      "target.provider.name",
      "metadata.provider.name",
    ])),
    gateway_model_id: sanitizeErrorValue(firstNestedValue(gatewayLog, [
      "model.id",
      "model",
      "request.model.id",
      "request.model",
      "response.model.id",
      "response.model",
      "metadata.model.id",
      "metadata.model",
    ])),
    gateway_response_status: firstNestedValue(gatewayLog, [
      "response.status",
      "response.status_code",
      "status",
      "status_code",
      "response.code",
    ]),
    gateway_response_status_text: sanitizeErrorValue(firstNestedValue(gatewayLog, [
      "response.statusText",
      "response.status_text",
      "statusText",
      "status_text",
    ])),
    gateway_error_code: sanitizeErrorValue(firstNestedValue(gatewayLog, [
      "error.code",
      "response.error.code",
      "response.body.error.code",
      "response.body.code",
      "response.data.error.code",
      "response.data.code",
      "provider_error.code",
      "body.error.code",
      "body.code",
      "code",
      "err_code",
    ])),
    gateway_error_shape: summarizeResultShape(gatewayErrorValue),
    gateway_validation_shape: summarizeResultShape(gatewayValidationValue),
    gateway_request_target: sanitizeErrorValue(firstNestedValue(gatewayLog, [
      "request.target",
      "target.path",
      "target.url",
      "target",
    ])),
    gateway_request_path: sanitizeErrorValue(firstNestedValue(gatewayLog, [
      "request.path",
      "request.route",
      "target.path",
      "metadata.path",
    ])),
    gateway_request_method: sanitizeErrorValue(firstNestedValue(gatewayLog, [
      "request.method",
      "method",
    ])),
    gateway_request_url_host: getUrlHost(firstNestedValue(gatewayLog, [
      "request.url",
      "target.url",
      "metadata.url",
    ])),
  };
}

/**
 * @param {Record<string, any> | undefined} env
 * @param {string} key
 */
export function readTrimmedEnvString(env, key) {
  const value = env?.[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

/**
 * @param {Record<string, any> | undefined} env
 * @param {string[]} keys
 * @param {number} fallback
 */
export function readEnvNumber(env, keys, fallback) {
  for (const key of keys) {
    const value = env?.[key];
    if (value === undefined || value === null || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return fallback;
}
