// @ts-check

import {
  ADMIN_AI_VIDEO_MODEL_ID,
  ADMIN_AI_VIDEO_VIDU_Q3_PRO_MODEL_ID,
} from "../../../../js/shared/admin-ai-contract.mjs";
import {
  getDurationMs,
  getErrorFields,
  logDiagnostic,
} from "../../../../js/shared/worker-observability.mjs";
import {
  ensureAI,
  extractGatewayLogSummary,
  firstNestedValue,
  getUpstreamErrorDetails,
  getUrlHost,
  isUrlLike,
  readAiGatewayLogId,
  readEnvNumber,
  readTrimmedEnvString,
  sanitizeErrorValue,
  summarizeGatewayOptions,
  summarizeResultShape,
  summarizeVideoPayload,
} from "./invoke-ai-shared.js";

const DEFAULT_AI_GATEWAY_ID = "default";
const VIDU_PROVIDER_MODEL_ID = "viduq3-pro";
const VIDU_PROVIDER_API_BASE_URL = "https://api.vidu.com";
const VIDU_PROVIDER_CREATE_PATHS = Object.freeze({
  text_to_video: "/ent/v2/text2video",
  image_to_video: "/ent/v2/img2video",
  start_end_to_video: "/ent/v2/start-end2video",
});
const VIDU_PROVIDER_DEFAULT_POLL_INTERVAL_MS = 4_000;
const VIDU_PROVIDER_DEFAULT_TIMEOUT_MS = 600_000;
const VIDU_VALID_RESOLUTIONS = ["540p", "720p", "1080p"];
const VIDU_VALID_ASPECT_RATIOS = ["16:9", "9:16", "3:4", "4:3", "1:1"];
const VIDU_MINIMAL_MODE_PAYLOAD = {
  prompt: "A golden retriever running through a sunlit meadow in slow motion",
  duration: 5,
  resolution: "720p",
};

/**
 * @typedef {object} NormalizedVideoRequest
 * @property {string | null} prompt
 * @property {number} duration
 * @property {string | null} aspect_ratio
 * @property {string | null} quality
 * @property {string | null} resolution
 * @property {number | null} seed
 * @property {boolean} generate_audio
 * @property {boolean} hasImageInput
 * @property {boolean} hasEndImageInput
 * @property {string} workflow
 */

/**
 * @typedef {object} BuiltVideoPayload
 * @property {Record<string, any>} payload
 * @property {NormalizedVideoRequest} normalized
 */

/**
 * @typedef {object} VideoInvokeResult
 * @property {string} videoUrl
 * @property {string | null} prompt
 * @property {number} duration
 * @property {string | null} aspect_ratio
 * @property {string | null} quality
 * @property {string | null} resolution
 * @property {number | null} seed
 * @property {boolean} generate_audio
 * @property {boolean} hasImageInput
 * @property {boolean} hasEndImageInput
 * @property {string} workflow
 * @property {number} elapsedMs
 */

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

function extractViduProviderPosterUrl(body) {
  const directCandidates = [
    body?.poster,
    body?.poster_url,
    body?.thumbnail,
    body?.thumbnail_url,
    body?.cover,
    body?.cover_url,
    body?.data?.poster,
    body?.data?.poster_url,
    body?.data?.thumbnail,
    body?.data?.thumbnail_url,
    body?.data?.cover,
    body?.data?.cover_url,
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
    const candidate =
      creation?.poster_url ||
      creation?.thumbnail_url ||
      creation?.cover_url ||
      creation?.image_url ||
      null;
    if (typeof candidate === "string" && isUrlLike(candidate)) {
      return candidate;
    }
  }

  return null;
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

function getViduProviderPollDelaySeconds(env) {
  return Math.max(5, Math.ceil(getViduProviderPollIntervalMs(env) / 1000));
}

function isProviderTerminalSuccess(state) {
  return ["success", "succeeded", "complete", "completed", "done"].includes(String(state || "").toLowerCase());
}

function isProviderTerminalFailure(state) {
  return ["failed", "failure", "error", "rejected", "cancelled", "canceled"].includes(String(state || "").toLowerCase());
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

function viduValidationError(message) {
  const error = new Error(message);
  error.name = "ValidationError";
  error.status = 400;
  error.code = "validation_error";
  return error;
}

function buildViduQ3Payload(input) {
  let duration = input.duration;
  if (duration !== undefined && duration !== null) {
    duration = typeof duration === "string" ? parseInt(duration, 10) : Number(duration);
    if (!Number.isInteger(duration) || duration < 1 || duration > 16) {
      throw viduValidationError("vidu/q3-pro: duration must be an integer between 1 and 16.");
    }
  } else {
    throw viduValidationError("vidu/q3-pro: duration is required.");
  }

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

  let prompt = input.prompt;
  if (prompt !== undefined && prompt !== null) {
    prompt = String(prompt).trim();
    if (!prompt) prompt = undefined;
  }

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

/**
 * @param {{ id: string }} model
 * @param {Record<string, any>} input
 * @returns {BuiltVideoPayload}
 */
export function buildVideoPayload(model, input) {
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

function buildVideoTaskResult({
  status,
  request,
  startedAt,
  videoUrl = null,
  posterUrl = null,
  providerTaskId = null,
  providerState = null,
  retryAfterSeconds = null,
}) {
  return {
    status,
    videoUrl,
    posterUrl,
    providerTaskId,
    providerState,
    retryAfterSeconds,
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
    elapsedMs: getDurationMs(startedAt),
  };
}

async function runWorkersAiVideoOnce(env, model, input, request, startedAt, runOptions) {
  ensureAI(env);
  const raw = runOptions
    ? await env.AI.run(model.id, request.payload, runOptions)
    : await env.AI.run(model.id, request.payload);
  const videoUrl = extractVideoUrl(raw);
  const providerTaskId = extractViduProviderTaskId(raw);
  const providerState = extractViduProviderState(raw);
  const posterUrl = extractViduProviderPosterUrl(raw);
  if (videoUrl) {
    return buildVideoTaskResult({
      status: "succeeded",
      request,
      startedAt,
      videoUrl,
      posterUrl,
      providerTaskId,
      providerState: providerState || "success",
    });
  }
  if (providerTaskId) {
    return buildVideoTaskResult({
      status: "provider_pending",
      request,
      startedAt,
      providerTaskId,
      providerState,
      retryAfterSeconds: 30,
    });
  }
  const error = new Error("Model returned no video output.");
  error.status = 502;
  error.code = "upstream_error";
  throw error;
}

async function createViduProviderTaskOnce({
  env,
  correlationId,
  modelId,
  minimalModeActive,
  effectivePayload,
  request,
  startedAt,
}) {
  const apiKey = getViduProviderApiKey(env);
  if (!apiKey) {
    throw buildViduProviderError("Vidu provider direct API is not configured.", {
      step: "config",
    });
  }

  const { workflow, createPath, createPayload } = buildViduProviderCreateRequest(effectivePayload);
  let createResponse;
  try {
    createResponse = await fetch(`${VIDU_PROVIDER_API_BASE_URL}${createPath}`, {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
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

  const providerTaskId = extractViduProviderTaskId(createResult.data);
  const providerState = extractViduProviderState(createResult.data);
  const videoUrl = extractViduProviderVideoUrl(createResult.data);
  const posterUrl = extractViduProviderPosterUrl(createResult.data);

  logDiagnostic({
    service: "bitbi-ai",
    component: "invoke-video",
    event: "vidu_provider_task_created",
    level: "info",
    correlationId,
    model: modelId,
    workflow,
    provider_task_id: providerTaskId,
    provider_state: providerState,
    create_path: createPath,
    duration_ms: getDurationMs(startedAt),
  });

  if (videoUrl) {
    return buildVideoTaskResult({
      status: "succeeded",
      request,
      startedAt,
      videoUrl,
      posterUrl,
      providerTaskId,
      providerState: providerState || "success",
    });
  }

  if (!providerTaskId) {
    throw buildViduProviderError("Vidu provider did not return a task ID.", {
      body: createBody,
      step: "create",
    });
  }

  return buildVideoTaskResult({
    status: "provider_pending",
    request,
    startedAt,
    providerTaskId,
    providerState,
    retryAfterSeconds: getViduProviderPollDelaySeconds(env),
  });
}

/**
 * Create or start one provider-side video task without long polling.
 *
 * @param {Record<string, any>} env
 * @param {{ id: string, proxied?: boolean }} model
 * @param {Record<string, any>} input
 */
export async function createVideoProviderTask(env, model, input) {
  const startedAt = Date.now();
  const request = buildVideoPayload(model, input);
  const minimalModeActive =
    model.id === ADMIN_AI_VIDEO_VIDU_Q3_PRO_MODEL_ID && input.minimal_mode === true;
  const gatewayMode =
    model.id === ADMIN_AI_VIDEO_VIDU_Q3_PRO_MODEL_ID
      ? (input.gateway_mode === "off" ? "off" : "on")
      : null;
  const effectivePayload = minimalModeActive
    ? { ...VIDU_MINIMAL_MODE_PAYLOAD }
    : request.payload;

  if (model.id === ADMIN_AI_VIDEO_VIDU_Q3_PRO_MODEL_ID) {
    return createViduProviderTaskOnce({
      env,
      correlationId: input.correlationId || null,
      modelId: model.id,
      minimalModeActive,
      effectivePayload,
      request: {
        ...request,
        payload: effectivePayload,
        normalized: {
          ...request.normalized,
          workflow: request.normalized.workflow,
        },
      },
      startedAt,
    });
  }

  const runOptions = model.proxied ? { gateway: { id: DEFAULT_AI_GATEWAY_ID } } : undefined;
  return runWorkersAiVideoOnce(env, model, input, request, startedAt, runOptions);
}

/**
 * Poll one provider-side task once. This intentionally does not loop/sleep.
 *
 * @param {Record<string, any>} env
 * @param {{ id: string, proxied?: boolean }} model
 * @param {Record<string, any>} input
 * @param {{ providerTaskId: string }} task
 */
export async function pollVideoProviderTask(env, model, input, task) {
  const startedAt = Date.now();
  const request = buildVideoPayload(model, input);
  const providerTaskId = typeof task?.providerTaskId === "string" ? task.providerTaskId.trim() : "";
  if (!providerTaskId) {
    const error = new Error("providerTaskId is required.");
    error.status = 400;
    error.code = "bad_provider_task_id";
    throw error;
  }

  if (model.id !== ADMIN_AI_VIDEO_VIDU_Q3_PRO_MODEL_ID) {
    const error = new Error("Provider polling is not supported for this video model.");
    error.status = 502;
    error.code = "provider_poll_not_supported";
    throw error;
  }

  const apiKey = getViduProviderApiKey(env);
  if (!apiKey) {
    throw buildViduProviderError("Vidu provider direct API is not configured.", {
      step: "config",
      taskId: providerTaskId,
    });
  }

  let pollResponse;
  try {
    pollResponse = await fetch(
      `${VIDU_PROVIDER_API_BASE_URL}/ent/v2/tasks/${encodeURIComponent(providerTaskId)}/creations`,
      {
        method: "GET",
        headers: {
          Authorization: `Token ${apiKey}`,
        },
      }
    );
  } catch (providerError) {
    throw buildViduProviderError("Vidu provider status check failed.", {
      body: getErrorFields(providerError),
      step: "poll",
      taskId: providerTaskId,
    });
  }

  const pollResult = await readJsonOrText(pollResponse);
  const pollBody = pollResult.data ?? pollResult.rawText;
  if (!pollResponse.ok) {
    throw buildViduProviderError("Vidu provider status check failed.", {
      status: pollResponse.status,
      body: pollBody,
      step: "poll",
      taskId: providerTaskId,
    });
  }

  const providerState = extractViduProviderState(pollResult.data);
  const videoUrl = extractViduProviderVideoUrl(pollResult.data);
  const posterUrl = extractViduProviderPosterUrl(pollResult.data);

  if (videoUrl) {
    return buildVideoTaskResult({
      status: "succeeded",
      request,
      startedAt,
      videoUrl,
      posterUrl,
      providerTaskId,
      providerState: providerState || "success",
    });
  }

  if (isProviderTerminalFailure(providerState)) {
    return buildVideoTaskResult({
      status: "failed",
      request,
      startedAt,
      providerTaskId,
      providerState: providerState || "failed",
    });
  }

  if (isProviderTerminalSuccess(providerState)) {
    const error = new Error("Vidu provider completed without returning a video URL.");
    error.status = 502;
    error.code = "upstream_error";
    throw error;
  }

  return buildVideoTaskResult({
    status: "provider_pending",
    request,
    startedAt,
    providerTaskId,
    providerState,
    retryAfterSeconds: getViduProviderPollDelaySeconds(env),
  });
}

/**
 * @param {Record<string, any>} env
 * @param {{ id: string, proxied?: boolean }} model
 * @param {Record<string, any>} input
 * @returns {Promise<VideoInvokeResult>}
 */
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
  for (const [key, value] of Object.entries(payload)) {
    payloadTypeMap[`pt_${key}`] = `${typeof value}`;
  }

  const effectivePayload = minimalModeActive
    ? { ...VIDU_MINIMAL_MODE_PAYLOAD }
    : payload;

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
