import {
  ADMIN_AI_VIDEO_MODEL_ID,
  ADMIN_AI_VIDEO_VIDU_Q3_PRO_MODEL_ID,
  buildAdminAiMultipartImageRequest,
} from "../../../../js/shared/admin-ai-contract.mjs";
import {
  getErrorFields,
  logDiagnostic,
} from "../../../../js/shared/worker-observability.mjs";

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

  return {
    upstream_status: error?.response?.status ?? error?.status ?? null,
    upstream_status_text: error?.response?.statusText || null,
    upstream_body: sanitizeErrorValue(
      error?.response?.body ?? error?.response?.data ?? error?.body ?? error?.data ?? error?.details ?? null
    ),
    upstream_cause: sanitizeErrorValue(error?.cause ?? null),
  };
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
  error.provider_body = sanitizeErrorValue(raw?.data ?? raw ?? null);
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
      ...getErrorFields(error),
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
      ...getErrorFields(error),
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
      ...getErrorFields(error),
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
      ...getErrorFields(error),
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
      provider_body: providerError.provider_body,
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
      ? (gatewayMode === "on" ? { gateway: { id: "default" } } : undefined)
      : (model.proxied ? { gateway: { id: "default" } } : undefined);

  const payloadTypeMap = {};
  for (const [k, v] of Object.entries(payload)) {
    payloadTypeMap[`pt_${k}`] = `${typeof v}`;
  }

  // --- Vidu minimal_mode: bypass UI params, send hardcoded prompt-only payload ---
  const effectivePayload = minimalModeActive
    ? { prompt: "A golden retriever running through a sunlit meadow in slow motion" }
    : payload;

  // --- Vidu pre-flight diagnostic: log the exact outgoing payload ---
  if (model.id === ADMIN_AI_VIDEO_VIDU_Q3_PRO_MODEL_ID) {
    const promptStr = typeof payload.prompt === "string" ? payload.prompt : "";
    const hasControlChars = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(promptStr);
    logDiagnostic({
      service: "bitbi-ai",
      component: "invoke-video",
      event: "vidu_preflight_payload",
      level: "info",
      correlationId: input.correlationId || null,
      model: model.id,
      payload_json: JSON.stringify(payload),
      prompt_length: promptStr.length,
      prompt_empty_after_trim: promptStr.trim().length === 0,
      prompt_has_control_chars: hasControlChars,
      prompt_preview: promptStr.slice(0, 120),
      payload_keys: Object.keys(payload).sort().join(","),
      gateway_mode: gatewayMode,
      minimal_mode_active: minimalModeActive,
      gateway_options: runOptions ? JSON.stringify(runOptions) : "none",
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
      payload_json: JSON.stringify(payload),
      effective_payload_json: JSON.stringify(effectivePayload),
      gateway_options: runOptions ? JSON.stringify(runOptions) : "none",
      payload_keys: Object.keys(payload).sort().join(","),
      effective_payload_keys: Object.keys(effectivePayload).sort().join(","),
    });
  }

  logDiagnostic({
    service: "bitbi-ai",
    component: "invoke-video",
    event: "workers_ai_video_invoke",
    level: "info",
    correlationId: input.correlationId || null,
    model: model.id,
    has_gateway_option: !!runOptions,
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
      effective_payload_json: JSON.stringify(effectivePayload),
    });
  }

  let raw;
  try {
    raw = runOptions
      ? await env.AI.run(model.id, effectivePayload, runOptions)
      : await env.AI.run(model.id, effectivePayload);
  } catch (error) {
    logDiagnostic({
      service: "bitbi-ai",
      component: "invoke-video",
      event: "workers_ai_run_failed",
      level: "error",
      correlationId: input.correlationId || null,
      model: model.id,
      has_gateway_option: !!runOptions,
      gateway_mode: gatewayMode,
      minimal_mode_active: minimalModeActive,
      effective_payload_json:
        model.id === ADMIN_AI_VIDEO_VIDU_Q3_PRO_MODEL_ID
          ? JSON.stringify(effectivePayload)
          : undefined,
      has_image_input: !!request.normalized.hasImageInput,
      has_end_image_input: !!request.normalized.hasEndImageInput,
      ...getErrorFields(error),
    });
    throw error;
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
