import {
  ADMIN_AI_VIDEO_MODEL_ID,
  ADMIN_AI_VIDEO_VIDU_Q3_PRO_MODEL_ID,
  buildAdminAiMultipartImageRequest,
} from "../../../../js/shared/admin-ai-contract.mjs";
import {
  getDurationMs,
  getErrorFields,
  logDiagnostic,
} from "../../../../js/shared/worker-observability.mjs";

const DEFAULT_AI_GATEWAY_ID = "default";
const VIDU_PROVIDER_MODEL_ID = "viduq3-pro";
const VIDU_PROVIDER_API_BASE_URL = "https://api.vidu.com";
const VIDU_PROVIDER_CREATE_PATHS = Object.freeze({
  text_to_video: "/ent/v2/text2video",
  image_to_video: "/ent/v2/img2video",
  start_end_to_video: "/ent/v2/start-end2video",
});
const VIDU_PROVIDER_DEFAULT_POLL_INTERVAL_MS = 4_000;
const VIDU_PROVIDER_DEFAULT_TIMEOUT_MS = 450_000;

function ensureAI(env) {
  if (!env?.AI || typeof env.AI.run !== "function") {
    const error = new Error("Workers AI binding is not configured.");
    error.status = 503;
    throw error;
  }
}

function buildMessages(system, prompt) {
  const messages = [];
  if (system) {
    messages.push({ role: "system", content: system });
  }
  messages.push({ role: "user", content: prompt });
  return messages;
}

function collectTextContent(value) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    const text = value
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object") {
          if (typeof entry.text === "string") return entry.text;
          if (typeof entry.content === "string") return entry.content;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();

    return text || null;
  }

  return null;
}

function extractTextResponse(result) {
  const directCandidates = [
    result?.response,
    result?.text,
    result?.output_text,
    result?.result?.response,
    result?.result?.text,
    result?.message?.content,
    result?.choices?.[0]?.message?.content,
    result?.choices?.[0]?.text,
  ];

  for (const candidate of directCandidates) {
    const text = collectTextContent(candidate);
    if (text) return text;
  }

  if (Array.isArray(result?.output)) {
    const chunks = [];
    for (const item of result.output) {
      const text = collectTextContent(item?.content);
      if (text) chunks.push(text);
    }
    if (chunks.length > 0) return chunks.join("\n").trim();
  }

  return null;
}

function parseBase64Image(value) {
  if (typeof value !== "string" || value.length === 0) return null;

  const dataUriMatch = value.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (dataUriMatch) {
    return {
      base64: dataUriMatch[2],
      mimeType: dataUriMatch[1],
    };
  }

  if (/^[A-Za-z0-9+/\n\r]+=*$/.test(value.slice(0, Math.min(value.length, 200)))) {
    return {
      base64: value,
      mimeType: null,
    };
  }

  return null;
}

async function toArrayBuffer(value) {
  if (value == null) return null;
  if (value instanceof ArrayBuffer) return value;
  if (typeof value.arrayBuffer === "function") {
    try {
      return await value.arrayBuffer();
    } catch {
      return null;
    }
  }
  if (value.buffer instanceof ArrayBuffer && typeof value.byteLength === "number") {
    return value.buffer.byteLength === value.byteLength
      ? value.buffer
      : value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  return null;
}

async function extractImageResponse(result, model) {
  const candidates = [];
  if (result && typeof result === "object" && !ArrayBuffer.isView(result) && !(result instanceof ArrayBuffer)) {
    if (result.image != null) candidates.push(result.image);
    if (Array.isArray(result.images) && result.images.length > 0) candidates.push(result.images[0]);
    if (result.data != null) candidates.push(result.data);
  }
  candidates.push(result);

  for (const candidate of candidates) {
    const parsed = parseBase64Image(candidate);
    if (parsed) {
      return {
        imageBase64: parsed.base64,
        mimeType: parsed.mimeType || model.defaultMimeType || "image/jpeg",
      };
    }

    const buffer = await toArrayBuffer(candidate);
    if (buffer && buffer.byteLength > 0) {
      const bytes = new Uint8Array(buffer);
      const base64 = btoa(bytes.reduce((acc, byte) => acc + String.fromCharCode(byte), ""));
      return {
        imageBase64: base64,
        mimeType: model.defaultMimeType || "image/jpeg",
      };
    }
  }

  return null;
}

function normalizeVectorArray(candidate) {
  if (!Array.isArray(candidate) || candidate.length === 0) return null;

  if (candidate.every((item) => Array.isArray(item))) {
    return candidate;
  }

  if (candidate.every((item) => typeof item === "number")) {
    return [candidate];
  }

  if (candidate.every((item) => Array.isArray(item?.embedding))) {
    return candidate.map((item) => item.embedding);
  }

  return null;
}

function extractEmbeddingsResponse(result) {
  const candidates = [
    result?.data,
    result?.response,
    result?.result?.data,
    result?.result?.response,
  ];

  for (const candidate of candidates) {
    const vectors = normalizeVectorArray(candidate);
    if (vectors) {
      return {
        vectors,
        shape: Array.isArray(result?.shape) ? result.shape : [vectors.length, vectors[0]?.length || 0],
        pooling: result?.pooling || result?.result?.pooling || null,
      };
    }
  }

  return null;
}

function composeMusicPrompt(input) {
  const promptParts = [String(input.prompt || "").trim()];

  if (input.bpm) {
    promptParts.push(`Tempo target: ${input.bpm} BPM.`);
  }

  if (input.key) {
    promptParts.push(`Preferred key center: ${input.key}.`);
  }

  if (input.mode === "instrumental") {
    promptParts.push("Instrumental only. No vocals.");
  } else {
    promptParts.push("Lead vocals should remain present.");
  }

  return promptParts.filter(Boolean).join(" ");
}

function isUrlLike(value) {
  if (typeof value !== "string") return false;
  return /^https?:\/\//i.test(value.trim());
}

function isLikelyBase64(value) {
  if (typeof value !== "string") return false;
  const compact = value.replace(/\s+/g, "");
  if (!compact || compact.length < 16 || compact.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(compact);
}

function parseBase64Audio(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const dataUriMatch = trimmed.match(/^data:(audio\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (dataUriMatch) {
    return {
      audioBase64: dataUriMatch[2],
      mimeType: dataUriMatch[1],
    };
  }

  const compact = trimmed.replace(/\s+/g, "");
  if (!isLikelyBase64(compact)) {
    return null;
  }

  return {
    audioBase64: compact,
    mimeType: "audio/mpeg",
  };
}

function parseBinaryAudioString(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  const sample = value.slice(0, Math.min(value.length, 128));
  const codes = [...sample].map((char) => char.charCodeAt(0));
  if (codes.some((code) => code > 255)) {
    return null;
  }
  const hasBinaryishByte = codes.some((code) => code === 0 || code < 9 || (code > 13 && code < 32));
  if (!hasBinaryishByte) {
    return null;
  }

  try {
    return {
      audioBase64: btoa(value),
      mimeType: "audio/mpeg",
    };
  } catch {
    return null;
  }
}

function summarizeMusicPayload(payload) {
  return {
    has_prompt: typeof payload?.prompt === "string" && payload.prompt.trim().length > 0,
    prompt_length: typeof payload?.prompt === "string" ? payload.prompt.length : 0,
    has_lyrics: typeof payload?.lyrics === "string" && payload.lyrics.trim().length > 0,
    lyrics_length: typeof payload?.lyrics === "string" ? payload.lyrics.length : 0,
    lyrics_optimizer: payload?.lyrics_optimizer === true,
    is_instrumental: payload?.is_instrumental === true,
    sample_rate: payload?.sample_rate ?? null,
    bitrate: payload?.bitrate ?? null,
    format: payload?.format ?? null,
  };
}

function summarizeResultShape(result) {
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

function summarizeVideoPayload(payload) {
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

function summarizeGatewayOptions(runOptions) {
  return {
    has_gateway_option: !!runOptions,
    gateway_id: runOptions?.gateway?.id || null,
  };
}

function sanitizeErrorValue(value, depth = 0) {
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

function getUpstreamErrorDetails(error) {
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

function getNestedValue(source, path) {
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

function firstNestedValue(source, paths) {
  for (const path of paths) {
    const value = getNestedValue(source, path);
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && !value.trim()) continue;
    return value;
  }
  return null;
}

function readAiGatewayLogId(aiBinding) {
  const value = aiBinding?.aiGatewayLogId;
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function extractGatewayLogSummary(gatewayLog) {
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

function logViduGatewayReference({
  correlationId,
  modelId,
  gatewayMode,
  minimalModeActive,
  effectivePayload,
  aiGatewayLogId,
  runOutcome,
}) {
  logDiagnostic({
    service: "bitbi-ai",
    component: "invoke-video",
    event: "vidu_ai_gateway_log_reference",
    level: runOutcome === "failure" ? "error" : "info",
    correlationId,
    model: modelId,
    ai_gateway_log_id: aiGatewayLogId,
    gateway_mode: gatewayMode,
    minimal_mode_active: minimalModeActive,
    effective_request: summarizeVideoPayload(effectivePayload),
    run_outcome: runOutcome,
  });
}

function readTrimmedEnvString(env, key) {
  const value = env?.[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function readEnvNumber(env, keys, fallback) {
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

function getViduProviderApiKey(env) {
  return readTrimmedEnvString(env, "VIDU_API_KEY");
}

function getViduProviderPollIntervalMs(env) {
  return readEnvNumber(
    env,
    ["__VIDU_POLL_INTERVAL_MS", "VIDU_POLL_INTERVAL_MS"],
    VIDU_PROVIDER_DEFAULT_POLL_INTERVAL_MS
  );
}

function getViduProviderTimeoutMs(env) {
  return readEnvNumber(
    env,
    ["__VIDU_POLL_TIMEOUT_MS", "VIDU_POLL_TIMEOUT_MS"],
    VIDU_PROVIDER_DEFAULT_TIMEOUT_MS
  );
}

async function logViduGatewayFailureDetails({
  env,
  correlationId,
  modelId,
  gatewayMode,
  minimalModeActive,
  effectivePayload,
  aiGatewayLogId,
}) {
  if (!aiGatewayLogId) return;

  try {
    const gatewayLog = await env.AI.gateway(DEFAULT_AI_GATEWAY_ID).getLog(aiGatewayLogId);
    logDiagnostic({
      service: "bitbi-ai",
      component: "invoke-video",
      event: "vidu_ai_gateway_log_summary",
      level: "error",
      correlationId,
      model: modelId,
      ai_gateway_log_id: aiGatewayLogId,
      gateway_mode: gatewayMode,
      minimal_mode_active: minimalModeActive,
      effective_request: summarizeVideoPayload(effectivePayload),
      ...extractGatewayLogSummary(gatewayLog),
    });
  } catch (gatewayLogError) {
    logDiagnostic({
      service: "bitbi-ai",
      component: "invoke-video",
      event: "vidu_ai_gateway_log_lookup_failed",
      level: "error",
      correlationId,
      model: modelId,
      ai_gateway_log_id: aiGatewayLogId,
      gateway_mode: gatewayMode,
      minimal_mode_active: minimalModeActive,
      effective_request: summarizeVideoPayload(effectivePayload),
      ...getErrorFields(gatewayLogError),
    });
  }
}

function resolveViduWorkflowFromPayload(payload) {
  if (typeof payload?.end_image === "string" && payload.end_image.trim()) {
    return "start_end_to_video";
  }
  if (typeof payload?.start_image === "string" && payload.start_image.trim()) {
    return "image_to_video";
  }
  return "text_to_video";
}

function buildViduProviderCreateRequest(payload) {
  const workflow = resolveViduWorkflowFromPayload(payload);
  const createPath = VIDU_PROVIDER_CREATE_PATHS[workflow];
  const createPayload = {
    model: VIDU_PROVIDER_MODEL_ID,
    duration: payload.duration,
    resolution: payload.resolution,
  };

  const prompt = typeof payload?.prompt === "string" ? payload.prompt.trim() : "";
  if (prompt) {
    createPayload.prompt = prompt;
  }

  if (payload?.audio === false) {
    createPayload.audio = false;
  }

  if (workflow === "text_to_video") {
    const aspectRatio = typeof payload?.aspect_ratio === "string" ? payload.aspect_ratio.trim() : "";
    if (aspectRatio && aspectRatio !== "16:9") {
      createPayload.aspect_ratio = aspectRatio;
    }
  } else if (workflow === "image_to_video") {
    createPayload.images = [payload.start_image];
  } else {
    createPayload.images = [payload.start_image, payload.end_image];
  }

  return {
    workflow,
    createPath,
    createPayload,
  };
}

async function readJsonOrText(response) {
  const rawText = await response.text();
  if (!rawText) {
    return { data: null, rawText: "" };
  }

  try {
    return {
      data: JSON.parse(rawText),
      rawText,
    };
  } catch {
    return {
      data: null,
      rawText,
    };
  }
}

function extractViduProviderTaskId(body) {
  const value = firstNestedValue(body, [
    "task_id",
    "id",
    "data.task_id",
    "data.id",
  ]);
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function extractViduProviderState(body) {
  const value = firstNestedValue(body, [
    "state",
    "status",
    "data.state",
    "data.status",
  ]);
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim().toLowerCase();
  return normalized || null;
}

function extractViduProviderVideoUrl(body) {
  const directCandidates = [
    body?.video,
    body?.video_url,
    body?.url,
    body?.data?.video,
    body?.data?.video_url,
    body?.data?.url,
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && isUrlLike(candidate)) {
      return candidate;
    }
  }

  const creations = Array.isArray(body?.creations)
    ? body.creations
    : Array.isArray(body?.data?.creations)
      ? body.data.creations
      : [];

  for (const creation of creations) {
    const candidate = creation?.url || creation?.video_url || creation?.watermarked_url || null;
    if (typeof candidate === "string" && isUrlLike(candidate)) {
      return candidate;
    }
  }

  return null;
}

function getUrlHost(value) {
  if (!isUrlLike(value)) return null;
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

function buildViduProviderError(message, { status = null, body = null, step = null, taskId = null } = {}) {
  const error = new Error(message);
  error.status = 502;
  error.code = "upstream_error";
  error.provider_status = status;
  error.provider_error_code = sanitizeErrorValue(firstNestedValue(body, [
    "err_code",
    "error.code",
    "code",
    "status_code",
  ]));
  error.provider_body_shape = summarizeResultShape(body);
  error.provider_step = step;
  error.provider_task_id = taskId;
  return error;
}

async function delayMs(ms) {
  if (!(ms > 0)) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldAttemptViduProviderFallback({
  env,
  modelId,
  gatewayMode,
  aiGatewayLogId,
  error,
}) {
  if (modelId !== ADMIN_AI_VIDEO_VIDU_Q3_PRO_MODEL_ID) return false;
  if (gatewayMode !== "on") return false;
  if (aiGatewayLogId) return false;
  if (!getViduProviderApiKey(env)) return false;
  const errorMessage = String(error?.message || "");
  return /request validation failed/i.test(errorMessage);
}

async function invokeViduProviderFallback({
  env,
  correlationId,
  modelId,
  gatewayMode,
  minimalModeActive,
  effectivePayload,
  cloudflareError,
}) {
  const apiKey = getViduProviderApiKey(env);
  if (!apiKey) {
    throw buildViduProviderError("Vidu provider fallback is not configured.", {
      step: "config",
    });
  }

  const { workflow, createPath, createPayload } = buildViduProviderCreateRequest(effectivePayload);
  const startedAt = Date.now();
  const baseHeaders = {
    Authorization: `Token ${apiKey}`,
    "Content-Type": "application/json",
  };

  logDiagnostic({
    service: "bitbi-ai",
    component: "invoke-video",
    event: "vidu_provider_fallback_started",
    level: "warn",
    correlationId,
    model: modelId,
    gateway_mode: gatewayMode,
    minimal_mode_active: minimalModeActive,
    workflow,
    effective_request: summarizeVideoPayload(effectivePayload),
    create_path: createPath,
    create_request: summarizeVideoPayload(createPayload),
    cloudflare_error_name: cloudflareError?.name || null,
    cloudflare_error_code: cloudflareError?.code || null,
    cloudflare_error_status: cloudflareError?.status || null,
  });

  let createResponse;
  try {
    createResponse = await fetch(`${VIDU_PROVIDER_API_BASE_URL}${createPath}`, {
      method: "POST",
      headers: baseHeaders,
      body: JSON.stringify(createPayload),
    });
  } catch (providerError) {
    throw buildViduProviderError("Vidu provider task creation failed.", {
      body: getErrorFields(providerError),
      step: "create",
    });
  }

  const createResult = await readJsonOrText(createResponse);
  const createBody = createResult.data ?? createResult.rawText;
  if (!createResponse.ok) {
    throw buildViduProviderError("Vidu provider task creation failed.", {
      status: createResponse.status,
      body: createBody,
      step: "create",
    });
  }

  const taskId = extractViduProviderTaskId(createResult.data);
  const createState = extractViduProviderState(createResult.data);
  const immediateVideoUrl = extractViduProviderVideoUrl(createResult.data);
  logDiagnostic({
    service: "bitbi-ai",
    component: "invoke-video",
    event: "vidu_provider_task_created",
    level: "info",
    correlationId,
    model: modelId,
    gateway_mode: gatewayMode,
    minimal_mode_active: minimalModeActive,
    workflow,
    provider_task_id: taskId,
    provider_state: createState,
    create_path: createPath,
    duration_ms: getDurationMs(startedAt),
  });

  if (immediateVideoUrl) {
    logDiagnostic({
      service: "bitbi-ai",
      component: "invoke-video",
      event: "vidu_provider_fallback_succeeded",
      level: "warn",
      correlationId,
      model: modelId,
      gateway_mode: gatewayMode,
      minimal_mode_active: minimalModeActive,
      workflow,
      provider_task_id: taskId,
      provider_state: createState || "success",
      poll_attempts: 0,
      video_url_host: getUrlHost(immediateVideoUrl),
      duration_ms: getDurationMs(startedAt),
    });
    return {
      videoUrl: immediateVideoUrl,
      providerTaskId: taskId,
      workflow,
      providerState: createState || "success",
      pollAttempts: 0,
    };
  }

  if (!taskId) {
    throw buildViduProviderError("Vidu provider did not return a task ID.", {
      body: createBody,
      step: "create",
    });
  }

  const pollIntervalMs = getViduProviderPollIntervalMs(env);
  const timeoutAt = Date.now() + getViduProviderTimeoutMs(env);
  let pollAttempts = 0;
  let lastState = createState;

  while (Date.now() <= timeoutAt) {
    if (pollAttempts > 0) {
      await delayMs(pollIntervalMs);
    }
    pollAttempts += 1;

    let pollResponse;
    try {
      pollResponse = await fetch(
        `${VIDU_PROVIDER_API_BASE_URL}/ent/v2/tasks/${encodeURIComponent(taskId)}/creations`,
        {
          method: "GET",
          headers: baseHeaders,
        }
      );
    } catch (providerError) {
      throw buildViduProviderError("Vidu provider status check failed.", {
        body: getErrorFields(providerError),
        step: "poll",
        taskId,
      });
    }

    const pollResult = await readJsonOrText(pollResponse);
    const pollBody = pollResult.data ?? pollResult.rawText;
    if (!pollResponse.ok) {
      throw buildViduProviderError("Vidu provider status check failed.", {
        status: pollResponse.status,
        body: pollBody,
        step: "poll",
        taskId,
      });
    }

    const providerState = extractViduProviderState(pollResult.data);
    const providerErrCode = sanitizeErrorValue(firstNestedValue(pollResult.data, [
      "err_code",
      "error.code",
      "code",
    ]));
    const providerProgress = firstNestedValue(pollResult.data, [
      "progress",
      "data.progress",
    ]);

    if (pollAttempts === 1 || providerState !== lastState) {
      logDiagnostic({
        service: "bitbi-ai",
        component: "invoke-video",
        event: "vidu_provider_poll_state",
        level: "info",
        correlationId,
        model: modelId,
        gateway_mode: gatewayMode,
        minimal_mode_active: minimalModeActive,
        workflow,
        provider_task_id: taskId,
        provider_state: providerState,
        provider_progress: providerProgress ?? null,
        provider_err_code: providerErrCode,
        poll_attempt: pollAttempts,
      });
      lastState = providerState;
    }

    const videoUrl = extractViduProviderVideoUrl(pollResult.data);
    if (videoUrl) {
      logDiagnostic({
        service: "bitbi-ai",
        component: "invoke-video",
        event: "vidu_provider_fallback_succeeded",
        level: "warn",
        correlationId,
        model: modelId,
        gateway_mode: gatewayMode,
        minimal_mode_active: minimalModeActive,
        workflow,
        provider_task_id: taskId,
        provider_state: providerState || "success",
        provider_err_code: providerErrCode,
        poll_attempts: pollAttempts,
        video_url_host: getUrlHost(videoUrl),
        duration_ms: getDurationMs(startedAt),
      });
      return {
        videoUrl,
        providerTaskId: taskId,
        workflow,
        providerState: providerState || "success",
        pollAttempts,
      };
    }

    if (providerState === "failed") {
      throw buildViduProviderError("Vidu provider generation failed.", {
        body: pollBody,
        step: "poll",
        taskId,
      });
    }

    if (providerState === "success") {
      throw buildViduProviderError("Vidu provider completed without returning a video URL.", {
        body: pollBody,
        step: "poll",
        taskId,
      });
    }
  }

  throw buildViduProviderError("Vidu provider generation timed out before completion.", {
    step: "poll_timeout",
    taskId,
  });
}

function buildMusicProviderError(raw) {
  const providerCode = Number(raw?.base_resp?.status_code);
  if (!Number.isFinite(providerCode) || providerCode === 0) {
    return null;
  }

  const statusMessage = String(raw?.base_resp?.status_msg || "Music provider returned an error.").trim();
  const error = new Error(statusMessage || "Music provider returned an error.");
  error.status = 502;
  error.code = "upstream_error";
  error.provider_status_code = providerCode;
  error.provider_status_message = statusMessage || null;
  error.traceId = raw?.trace_id || null;
  error.provider_error_code = sanitizeErrorValue(firstNestedValue(raw?.data ?? raw ?? null, [
    "err_code",
    "error.code",
    "code",
    "status_code",
  ]));
  error.provider_body_shape = summarizeResultShape(raw?.data ?? raw ?? null);
  return error;
}

function parseHexAudio(value) {
  if (typeof value !== "string") return null;
  const compact = value.replace(/\s+/g, "");
  if (!compact || compact.length % 2 !== 0 || !/^[a-f0-9]+$/i.test(compact)) {
    return null;
  }

  const bytes = new Uint8Array(compact.length / 2);
  for (let i = 0; i < compact.length; i += 2) {
    bytes[i / 2] = Number.parseInt(compact.slice(i, i + 2), 16);
  }

  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return {
    audioBase64: btoa(binary),
    mimeType: "audio/mpeg",
  };
}

function extractMusicLyrics(result) {
  const candidates = [
    result?.analysis_info?.lyrics,
    result?.analysis_info?.generated_lyrics,
    result?.analysis_info?.final_lyrics,
    result?.lyrics,
    result?.data?.lyrics,
    result?.result?.lyrics,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

async function extractAudioCandidate(value) {
  if (value == null) return null;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    if (isUrlLike(trimmed)) {
      return {
        audioUrl: trimmed,
        audioBase64: null,
        mimeType: "audio/mpeg",
      };
    }

    const dataUriAudio = trimmed.startsWith("data:")
      ? parseBase64Audio(trimmed)
      : null;
    if (dataUriAudio) {
      return {
        audioUrl: null,
        ...dataUriAudio,
      };
    }

    const hexAudio = /^[a-f0-9\s]+$/i.test(trimmed)
      ? parseHexAudio(trimmed)
      : null;
    if (hexAudio) {
      return {
        audioUrl: null,
        ...hexAudio,
      };
    }

    const base64Audio = parseBase64Audio(trimmed);
    if (base64Audio) {
      return {
        audioUrl: null,
        ...base64Audio,
      };
    }

    const binaryAudio = parseBinaryAudioString(value);
    if (binaryAudio) {
      return {
        audioUrl: null,
        ...binaryAudio,
      };
    }

    return null;
  }

  const buffer = await toArrayBuffer(value);
  if (!buffer || buffer.byteLength === 0) {
    return null;
  }

  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return {
    audioUrl: null,
    audioBase64: btoa(binary),
    mimeType: "audio/mpeg",
  };
}

async function extractMusicResponse(result) {
  const candidates = [
    result,
    result?.audio_url,
    result?.url,
    result?.audio,
    result?.data?.audio_url,
    result?.data?.url,
    result?.data?.audio,
    result?.result?.audio_url,
    result?.result?.url,
    result?.result?.audio,
    result?.result?.data?.audio,
  ];

  for (const candidate of candidates) {
    const audio = await extractAudioCandidate(candidate);
    if (audio && (audio.audioUrl || audio.audioBase64)) {
      return audio;
    }
  }

  return null;
}

export async function invokeText(env, model, input) {
  ensureAI(env);
  const startedAt = Date.now();

  const payload = {
    messages: buildMessages(input.system, input.prompt),
    max_tokens: Math.min(input.maxTokens, model.maxTokens || input.maxTokens),
    temperature: input.temperature,
  };

  let raw;
  try {
    raw = await env.AI.run(model.id, payload);
  } catch (error) {
    logDiagnostic({
      service: "bitbi-ai",
      component: "invoke-text",
      event: "workers_ai_run_failed",
      level: "error",
      correlationId: input.correlationId || null,
      model: model.id,
      duration_ms: getDurationMs(startedAt),
      ...getErrorFields(error, { includeMessage: false }),
    });
    throw error;
  }
  const text = extractTextResponse(raw);

  if (!text) {
    throw new Error("Model returned no text output.");
  }

  return {
    text,
    usage: raw?.usage || raw?.result?.usage || null,
    elapsedMs: Date.now() - startedAt,
  };
}

export async function invokeImage(env, model, input) {
  ensureAI(env);
  const startedAt = Date.now();
  const warnings = [];
  let payload;
  let appliedSteps = null;
  let appliedSeed = null;
  let appliedGuidance = null;
  let appliedSize = null;

  if (model.inputFormat === "multipart") {
    const multipartRequest = buildAdminAiMultipartImageRequest(model, input);
    payload = multipartRequest.payload;
    appliedSteps = multipartRequest.appliedSteps;
    appliedSeed = multipartRequest.appliedSeed;
    appliedGuidance = multipartRequest.appliedGuidance;
    appliedSize = multipartRequest.appliedSize;
  } else {
    payload = {
      prompt: input.prompt,
      steps: Math.min(input.steps ?? model.defaultSteps ?? 4, model.maxSteps || input.steps || 8),
    };

    if (input.seed !== null && input.seed !== undefined) {
      payload.seed = input.seed;
    }

    appliedSteps = payload.steps;
    appliedSeed = input.seed;

    if (input.width && input.height) {
      if (model.supportsDimensions) {
        payload.width = input.width;
        payload.height = input.height;
        appliedSize = { width: input.width, height: input.height };
      } else {
        warnings.push(`Model "${model.id}" ignores width and height overrides.`);
      }
    }
  }

  if (!model.supportsGuidance && input.guidance !== null && input.guidance !== undefined) {
    warnings.push(`Model "${model.id}" does not support guidance.`);
  }
  if (!model.supportsStructuredPrompt && input.structuredPrompt) {
    warnings.push(`Model "${model.id}" does not support structured prompts. Using standard prompt.`);
  }
  if (!model.supportsReferenceImages && input.referenceImages?.length > 0) {
    warnings.push(`Model "${model.id}" does not support reference images. They were ignored.`);
  }

  let raw;
  try {
    raw = await env.AI.run(model.id, payload);
  } catch (error) {
    logDiagnostic({
      service: "bitbi-ai",
      component: "invoke-image",
      event: "workers_ai_run_failed",
      level: "error",
      correlationId: input.correlationId || null,
      model: model.id,
      input_format: model.inputFormat || "json",
      duration_ms: getDurationMs(startedAt),
      ...getErrorFields(error, { includeMessage: false }),
    });
    throw error;
  }
  const image = await extractImageResponse(raw, model);

  if (!image) {
    throw new Error("Model returned no image output.");
  }

  return {
    ...image,
    appliedSteps,
    appliedSeed,
    appliedGuidance,
    appliedSize,
    warnings,
    elapsedMs: Date.now() - startedAt,
  };
}

export async function invokeEmbeddings(env, model, input) {
  ensureAI(env);
  const startedAt = Date.now();
  let raw;
  try {
    raw = await env.AI.run(model.id, {
      text: input.input.length === 1 ? input.input[0] : input.input,
    });
  } catch (error) {
    logDiagnostic({
      service: "bitbi-ai",
      component: "invoke-embeddings",
      event: "workers_ai_run_failed",
      level: "error",
      correlationId: input.correlationId || null,
      model: model.id,
      duration_ms: getDurationMs(startedAt),
      ...getErrorFields(error, { includeMessage: false }),
    });
    throw error;
  }

  const embeddings = extractEmbeddingsResponse(raw);
  if (!embeddings) {
    throw new Error("Model returned no embeddings output.");
  }

  return {
    ...embeddings,
    elapsedMs: Date.now() - startedAt,
  };
}

export async function invokeMusic(env, model, input) {
  ensureAI(env);
  const startedAt = Date.now();
  const payload = {
    prompt: composeMusicPrompt(input),
    sample_rate: 44100,
    bitrate: 256000,
    format: "mp3",
    lyrics_optimizer: input.mode !== "instrumental" && input.lyricsMode === "auto",
    is_instrumental: input.mode === "instrumental",
  };

  if (input.mode !== "instrumental" && input.lyricsMode === "custom" && input.lyrics) {
    payload.lyrics = input.lyrics;
  }

  const runOptions = model.proxied ? { gateway: { id: "default" } } : undefined;

  logDiagnostic({
    service: "bitbi-ai",
    component: "invoke-music",
    event: "workers_ai_music_invoke",
    level: "info",
    correlationId: input.correlationId || null,
    model: model.id,
    has_gateway_option: !!runOptions,
    gateway_id: runOptions?.gateway?.id || null,
    provider_payload: summarizeMusicPayload(payload),
  });

  let raw;
  try {
    raw = await env.AI.run(model.id, payload, runOptions);
  } catch (error) {
    logDiagnostic({
      service: "bitbi-ai",
      component: "invoke-music",
      event: "workers_ai_run_failed",
      level: "error",
      correlationId: input.correlationId || null,
      model: model.id,
      has_gateway_option: !!runOptions,
      gateway_id: runOptions?.gateway?.id || null,
      provider_payload: summarizeMusicPayload(payload),
      ...getUpstreamErrorDetails(error),
      duration_ms: getDurationMs(startedAt),
      ...getErrorFields(error, { includeMessage: false }),
    });
    throw error;
  }

  const providerError = buildMusicProviderError(raw);
  if (providerError) {
    logDiagnostic({
      service: "bitbi-ai",
      component: "invoke-music",
      event: "workers_ai_music_provider_error",
      level: "error",
      correlationId: input.correlationId || null,
      model: model.id,
      provider_payload: summarizeMusicPayload(payload),
      provider_trace_id: raw?.trace_id || null,
      provider_status_code: providerError.provider_status_code,
      provider_status_message: providerError.provider_status_message,
      provider_status: raw?.data?.status ?? raw?.status ?? null,
      raw_shape: summarizeResultShape(raw),
      provider_error_code: providerError.provider_error_code || null,
      provider_body_shape: providerError.provider_body_shape || null,
      duration_ms: getDurationMs(startedAt),
    });
    throw providerError;
  }

  const music = await extractMusicResponse(raw);
  if (!music || (!music.audioUrl && !music.audioBase64)) {
    const error = new Error("Model returned no audio output.");
    error.status = 502;
    error.code = "upstream_error";
    logDiagnostic({
      service: "bitbi-ai",
      component: "invoke-music",
      event: "workers_ai_music_parse_failed",
      level: "error",
      correlationId: input.correlationId || null,
      model: model.id,
      provider_payload: summarizeMusicPayload(payload),
      provider_trace_id: raw?.trace_id || null,
      provider_status: raw?.data?.status ?? raw?.status ?? null,
      provider_base_status_code: raw?.base_resp?.status_code ?? null,
      provider_base_status_message: raw?.base_resp?.status_msg ?? null,
      raw_shape: summarizeResultShape(raw),
      duration_ms: getDurationMs(startedAt),
    });
    throw error;
  }

  return {
    ...music,
    prompt: payload.prompt,
    providerStatus: raw?.data?.status ?? raw?.status ?? null,
    durationMs: raw?.extra_info?.music_duration ?? null,
    sampleRate: raw?.extra_info?.music_sample_rate ?? null,
    channels: raw?.extra_info?.music_channel ?? null,
    bitrate: raw?.extra_info?.bitrate ?? payload.bitrate,
    sizeBytes: raw?.extra_info?.music_size ?? null,
    lyrics: extractMusicLyrics(raw),
    traceId: raw?.trace_id || null,
    elapsedMs: Date.now() - startedAt,
  };
}

function extractVideoUrl(result) {
  const candidates = [
    result?.video,
    result?.video_url,
    result?.url,
    result?.data?.video,
    result?.data?.video_url,
    result?.data?.url,
    result?.result?.video,
    result?.result?.video_url,
    result?.result?.url,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && isUrlLike(candidate)) {
      return candidate;
    }
  }

  return null;
}

const VIDU_VALID_RESOLUTIONS = ["540p", "720p", "1080p"];
const VIDU_VALID_ASPECT_RATIOS = ["16:9", "9:16", "3:4", "4:3", "1:1"];
const VIDU_MINIMAL_MODE_PAYLOAD = {
  prompt: "A golden retriever running through a sunlit meadow in slow motion",
  duration: 5,
  resolution: "720p",
};

function viduValidationError(message) {
  const error = new Error(message);
  error.name = "ValidationError";
  error.status = 400;
  error.code = "validation_error";
  return error;
}

function buildViduQ3Payload(input) {
  // --- duration: coerce to integer, validate range 1..16 ---
  let duration = input.duration;
  if (duration !== undefined && duration !== null) {
    duration = typeof duration === "string" ? parseInt(duration, 10) : Number(duration);
    if (!Number.isInteger(duration) || duration < 1 || duration > 16) {
      throw viduValidationError("vidu/q3-pro: duration must be an integer between 1 and 16.");
    }
  } else {
    throw viduValidationError("vidu/q3-pro: duration is required.");
  }

  // --- resolution: validate enum ---
  let resolution = input.resolution;
  if (resolution !== undefined && resolution !== null && resolution !== "") {
    resolution = String(resolution).trim();
    if (!VIDU_VALID_RESOLUTIONS.includes(resolution)) {
      throw viduValidationError(
        `vidu/q3-pro: resolution must be one of ${VIDU_VALID_RESOLUTIONS.join(", ")}.`
      );
    }
  } else {
    throw viduValidationError("vidu/q3-pro: resolution is required.");
  }

  // --- audio: coerce to boolean ---
  let audio = input.audio;
  if (audio !== undefined && audio !== null && audio !== "") {
    if (typeof audio === "string") {
      audio = audio.trim().toLowerCase() !== "false" && audio.trim() !== "0";
    } else {
      audio = Boolean(audio);
    }
  } else {
    audio = false;
  }

  // --- prompt: trim if present ---
  let prompt = input.prompt;
  if (prompt !== undefined && prompt !== null) {
    prompt = String(prompt).trim();
    if (!prompt) prompt = undefined;
  }

  // --- start_image / end_image: include only if non-empty strings ---
  const startImage =
    typeof input.start_image === "string" && input.start_image.trim()
      ? input.start_image.trim()
      : undefined;
  const endImage =
    typeof input.end_image === "string" && input.end_image.trim()
      ? input.end_image.trim()
      : undefined;

  if (endImage && !startImage) {
    throw viduValidationError("vidu/q3-pro: end_image requires start_image.");
  }

  // --- aspect_ratio: only for text-to-video (no images), validate enum ---
  let aspectRatio = undefined;
  if (!startImage && !endImage && input.aspect_ratio) {
    aspectRatio = String(input.aspect_ratio).trim();
    if (aspectRatio && !VIDU_VALID_ASPECT_RATIOS.includes(aspectRatio)) {
      throw viduValidationError(
        `vidu/q3-pro: aspect_ratio must be one of ${VIDU_VALID_ASPECT_RATIOS.join(", ")}.`
      );
    }
    if (!aspectRatio) aspectRatio = undefined;
  }

  // --- Build strict payload from allowlist only ---
  const payload = { duration, resolution, audio };
  if (prompt) payload.prompt = prompt;
  if (startImage) payload.start_image = startImage;
  if (endImage) payload.end_image = endImage;
  if (aspectRatio) payload.aspect_ratio = aspectRatio;

  const workflow =
    input.workflow
    || (endImage
      ? "start_end_to_video"
      : startImage
        ? "image_to_video"
        : "text_to_video");

  return {
    payload,
    normalized: {
      prompt: prompt || null,
      duration,
      aspect_ratio: aspectRatio || null,
      quality: null,
      resolution,
      seed: null,
      generate_audio: audio,
      hasImageInput: !!startImage,
      hasEndImageInput: !!endImage,
      workflow,
    },
  };
}

function buildVideoPayload(model, input) {
  if (model.id === ADMIN_AI_VIDEO_MODEL_ID) {
    const payload = {
      prompt: input.prompt,
      duration: input.duration,
      aspect_ratio: input.aspect_ratio,
      quality: input.quality,
      generate_audio: input.generate_audio,
    };

    if (input.negative_prompt) {
      payload.negative_prompt = input.negative_prompt;
    }
    if (input.seed !== null && input.seed !== undefined) {
      payload.seed = input.seed;
    }
    if (input.image_input) {
      payload.image_input = input.image_input;
    }

    return {
      payload,
      normalized: {
        prompt: input.prompt,
        duration: input.duration,
        aspect_ratio: input.aspect_ratio,
        quality: input.quality,
        resolution: null,
        seed: input.seed ?? null,
        generate_audio: input.generate_audio,
        hasImageInput: !!input.image_input,
        hasEndImageInput: false,
        workflow: input.workflow || (input.image_input ? "image_to_video" : "text_to_video"),
      },
    };
  }

  if (model.id === ADMIN_AI_VIDEO_VIDU_Q3_PRO_MODEL_ID) {
    return buildViduQ3Payload(input);
  }

  const error = new Error(`Unsupported video model "${model.id}".`);
  error.status = 400;
  error.code = "model_not_allowed";
  throw error;
}

export async function invokeVideo(env, model, input) {
  ensureAI(env);
  const startedAt = Date.now();
  const request = buildVideoPayload(model, input);
  const payload = request.payload;
  const minimalModeActive =
    model.id === ADMIN_AI_VIDEO_VIDU_Q3_PRO_MODEL_ID && input.minimal_mode === true;
  const gatewayMode =
    model.id === ADMIN_AI_VIDEO_VIDU_Q3_PRO_MODEL_ID
      ? (input.gateway_mode === "off" ? "off" : "on")
      : null;
  const runOptions =
    model.id === ADMIN_AI_VIDEO_VIDU_Q3_PRO_MODEL_ID
      ? (gatewayMode === "on" ? { gateway: { id: DEFAULT_AI_GATEWAY_ID } } : undefined)
      : (model.proxied ? { gateway: { id: DEFAULT_AI_GATEWAY_ID } } : undefined);

  const payloadTypeMap = {};
  for (const [k, v] of Object.entries(payload)) {
    payloadTypeMap[`pt_${k}`] = `${typeof v}`;
  }

  // --- Vidu minimal_mode: replace UI params with a fixed doc-compliant payload ---
  const effectivePayload = minimalModeActive
    ? { ...VIDU_MINIMAL_MODE_PAYLOAD }
    : payload;

  // --- Vidu pre-flight diagnostics: log safe request summaries only ---
  if (model.id === ADMIN_AI_VIDEO_VIDU_Q3_PRO_MODEL_ID) {
    const promptStr = typeof payload.prompt === "string" ? payload.prompt : "";
    const hasControlChars = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(promptStr);
    logDiagnostic({
      service: "bitbi-ai",
      component: "invoke-video",
      event: "vidu_preflight_request",
      level: "info",
      correlationId: input.correlationId || null,
      model: model.id,
      request_summary: {
        ...summarizeVideoPayload(payload),
        prompt_empty_after_trim: promptStr.trim().length === 0,
        prompt_has_control_chars: hasControlChars,
      },
      gateway_mode: gatewayMode,
      minimal_mode_active: minimalModeActive,
      ...summarizeGatewayOptions(runOptions),
      ...payloadTypeMap,
    });

    logDiagnostic({
      service: "bitbi-ai",
      component: "invoke-video",
      event: "vidu_effective_request",
      level: "info",
      correlationId: input.correlationId || null,
      model: model.id,
      gateway_mode: gatewayMode,
      minimal_mode_active: minimalModeActive,
      requested_summary: summarizeVideoPayload(payload),
      effective_summary: summarizeVideoPayload(effectivePayload),
      ...summarizeGatewayOptions(runOptions),
    });
  }

  logDiagnostic({
    service: "bitbi-ai",
    component: "invoke-video",
    event: "workers_ai_video_invoke",
    level: "info",
    correlationId: input.correlationId || null,
    model: model.id,
    ...summarizeGatewayOptions(runOptions),
    has_image_input: !!request.normalized.hasImageInput,
    has_end_image_input: !!request.normalized.hasEndImageInput,
    workflow: request.normalized.workflow,
    duration: payload.duration,
    aspect_ratio: payload.aspect_ratio || null,
    quality: payload.quality || null,
    resolution: payload.resolution || null,
    payload_keys: Object.keys(payload).sort().join(","),
    gateway_mode: gatewayMode,
    minimal_mode_active: minimalModeActive,
    ...payloadTypeMap,
  });

  if (minimalModeActive) {
    logDiagnostic({
      service: "bitbi-ai",
      component: "invoke-video",
      event: "vidu_minimal_mode_active",
      level: "warn",
      correlationId: input.correlationId || null,
      model: model.id,
      gateway_mode: gatewayMode,
      minimal_mode_active: true,
      original_payload_keys: Object.keys(payload).sort().join(","),
      effective_summary: summarizeVideoPayload(effectivePayload),
    });
  }

  let raw;
  let aiGatewayLogId = null;
  try {
    raw = runOptions
      ? await env.AI.run(model.id, effectivePayload, runOptions)
      : await env.AI.run(model.id, effectivePayload);
    aiGatewayLogId = readAiGatewayLogId(env.AI);
    if (model.id === ADMIN_AI_VIDEO_VIDU_Q3_PRO_MODEL_ID) {
      logViduGatewayReference({
        correlationId: input.correlationId || null,
        modelId: model.id,
        gatewayMode,
        minimalModeActive,
        effectivePayload,
        aiGatewayLogId,
        runOutcome: "success",
      });
    }
  } catch (error) {
    aiGatewayLogId = readAiGatewayLogId(env.AI);
    if (model.id === ADMIN_AI_VIDEO_VIDU_Q3_PRO_MODEL_ID) {
      logViduGatewayReference({
        correlationId: input.correlationId || null,
        modelId: model.id,
        gatewayMode,
        minimalModeActive,
        effectivePayload,
        aiGatewayLogId,
        runOutcome: "failure",
      });
      await logViduGatewayFailureDetails({
        env,
        correlationId: input.correlationId || null,
        modelId: model.id,
        gatewayMode,
        minimalModeActive,
        effectivePayload,
        aiGatewayLogId,
      });

      if (shouldAttemptViduProviderFallback({
        env,
        modelId: model.id,
        gatewayMode,
        aiGatewayLogId,
        error,
      })) {
        try {
          const fallback = await invokeViduProviderFallback({
            env,
            correlationId: input.correlationId || null,
            modelId: model.id,
            gatewayMode,
            minimalModeActive,
            effectivePayload,
            cloudflareError: error,
          });
          raw = { video: fallback.videoUrl };
          aiGatewayLogId = null;
        } catch (fallbackError) {
          logDiagnostic({
            service: "bitbi-ai",
            component: "invoke-video",
            event: "vidu_provider_fallback_failed",
            level: "error",
            correlationId: input.correlationId || null,
            model: model.id,
            ai_gateway_log_id: aiGatewayLogId,
            gateway_mode: gatewayMode,
            minimal_mode_active: minimalModeActive,
            effective_request: summarizeVideoPayload(effectivePayload),
            cloudflare_error_name: error?.name || null,
            cloudflare_error_code: error?.code || null,
            cloudflare_error_status: error?.status || null,
            duration_ms: getDurationMs(startedAt),
            ...getErrorFields(fallbackError),
            ...getUpstreamErrorDetails(fallbackError),
          });
          error = fallbackError;
        }
      }
    }
    if (!raw) {
      logDiagnostic({
        service: "bitbi-ai",
        component: "invoke-video",
        event: "workers_ai_run_failed",
        level: "error",
        correlationId: input.correlationId || null,
        model: model.id,
        ...summarizeGatewayOptions(runOptions),
        ai_gateway_log_id: aiGatewayLogId,
        gateway_mode: gatewayMode,
        minimal_mode_active: minimalModeActive,
        effective_request:
          model.id === ADMIN_AI_VIDEO_VIDU_Q3_PRO_MODEL_ID
            ? summarizeVideoPayload(effectivePayload)
            : undefined,
        has_image_input: !!request.normalized.hasImageInput,
        has_end_image_input: !!request.normalized.hasEndImageInput,
        duration_ms: getDurationMs(startedAt),
        ...getErrorFields(error, { includeMessage: false }),
      });
      throw error;
    }
  }

  const videoUrl = extractVideoUrl(raw);
  if (!videoUrl) {
    const error = new Error("Model returned no video output.");
    error.status = 502;
    error.code = "upstream_error";
    logDiagnostic({
      service: "bitbi-ai",
      component: "invoke-video",
      event: "workers_ai_video_parse_failed",
      level: "error",
      correlationId: input.correlationId || null,
      model: model.id,
      raw_shape: summarizeResultShape(raw),
      duration_ms: getDurationMs(startedAt),
    });
    throw error;
  }

  return {
    videoUrl,
    prompt: request.normalized.prompt,
    duration: request.normalized.duration,
    aspect_ratio: request.normalized.aspect_ratio,
    quality: request.normalized.quality,
    resolution: request.normalized.resolution,
    seed: request.normalized.seed,
    generate_audio: request.normalized.generate_audio,
    hasImageInput: request.normalized.hasImageInput,
    hasEndImageInput: request.normalized.hasEndImageInput,
    workflow: request.normalized.workflow,
    elapsedMs: Date.now() - startedAt,
  };
}
