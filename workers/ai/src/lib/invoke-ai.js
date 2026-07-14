import {
  CLAUDE_FABLE_5_MODEL_ID,
  QWEN3_30B_A3B_MODEL_ID,
  calculateQwen3UsageCostUsd,
  buildAdminAiFlux2MaxRequest,
  buildAdminAiGptImage2Request,
  buildAdminAiGrokImagineImageRequest,
  buildAdminAiMultipartImageRequest,
} from "../../../../js/shared/admin-ai-contract.mjs";
import {
  getDurationMs,
  getErrorFields,
  logDiagnostic,
} from "../../../../js/shared/worker-observability.mjs";
import {
  ensureAI,
  firstNestedValue,
  getUpstreamErrorDetails,
  isLikelyBase64,
  isUrlLike,
  sanitizeErrorValue,
  summarizeResultShape,
} from "./invoke-ai-shared.js";
import {
  fetchWithGenerationTimeout,
  runWithGenerationTimeout,
} from "./generation-timeout.js";
import {
  FABLE_CHAT_GENERATION_TIMEOUT_MS,
  FABLE_CHAT_WEB_FETCH_ALLOWED_CALLERS,
  FABLE_CHAT_WEB_FETCH_MAX_CONTENT_TOKENS,
  FABLE_CHAT_WEB_FETCH_MAX_CONTINUATIONS,
  FABLE_CHAT_WEB_FETCH_MAX_USES,
  FABLE_CHAT_WEB_FETCH_TOOL_NAME,
  FABLE_CHAT_WEB_FETCH_TOOL_TYPE,
  FABLE_CHAT_WEB_FETCH_USE_CACHE,
  FABLE_CHAT_WEB_SEARCH_HARD_MAX_USES,
  FABLE_CHAT_WEB_SEARCH_CONTRACT_VERSION,
  FABLE_CHAT_LEGACY_WEB_SEARCH_TOOL_TYPE,
  FABLE_CHAT_WEB_SEARCH_MAX_CONTINUATIONS,
  FABLE_CHAT_WEB_SEARCH_TOOL_NAME,
  FABLE_CHAT_WEB_SEARCH_TOOL_TYPE,
} from "../../../shared/fable-chat-contract.mjs";
import {
  FABLE_CHAT_MEMORY_MODEL_ID,
  FABLE_CHAT_MEMORY_TIMEOUT_MS,
  buildFableChatMemorySummarizerSystemPrompt,
  calculateFableChatMemoryCostUsd,
  escapeFableChatMemoryPromptData,
  getFableChatMemoryProviderMaxTokens,
  getFableChatMemoryAcceptanceCeiling,
  getFableChatMemoryPlanningCeiling,
  normalizeFableChatMemoryRejectionCategory,
  normalizeFableChatMemoryProviderSummary,
  normalizeFableChatMemorySummary,
} from "../../../shared/fable-chat-memory-contract.mjs";
import {
  extractAnthropicVisibleResult,
} from "./anthropic-stream.js";
import { invokeVideo } from "./invoke-ai-video.js";

export { invokeVideo };

function buildMessages(system, prompt, nativeMessages = null) {
  const messages = [];
  if (system) {
    messages.push({ role: "system", content: system });
  }
  if (Array.isArray(nativeMessages)) {
    messages.push(...nativeMessages.map(({ role, content }) => ({ role, content })));
  } else {
    messages.push({ role: "user", content: prompt });
  }
  return messages;
}

function isAnthropicMessagesModel(model) {
  return model?.requestFormat === "anthropic-messages"
    || model?.inputFormat === "anthropic-messages";
}

function buildTextInvocation(env, model, input) {
  const maxTokens = Math.max(1, Math.min(
    Number(input.maxTokens) || model.defaultMaxTokens || 1024,
    model.maxOutputTokens || model.maxTokens || 128_000
  ));

  if (isAnthropicMessagesModel(model)) {
    const payload = {
      max_tokens: maxTokens,
      messages: Array.isArray(input.messages)
        ? input.messages.map(({ role, content }) => ({ role, content }))
        : [{ role: "user", content: input.prompt }],
    };
    if (input.system) payload.system = input.system;
    if (input.effort) payload.output_config = { effort: input.effort };
    if (input.thinkingDisplay) {
      payload.thinking = { type: "adaptive", display: input.thinkingDisplay };
    }
    const tools = [];
    if (input.webSearchEnabled === true) {
      if (input.webSearchContractVersion >= FABLE_CHAT_WEB_SEARCH_CONTRACT_VERSION) {
        tools.push({
          type: FABLE_CHAT_WEB_SEARCH_TOOL_TYPE,
          name: FABLE_CHAT_WEB_SEARCH_TOOL_NAME,
          max_uses: input.webSearchMaxUses,
          allowed_callers: [...input.webSearchAllowedCallers],
          response_inclusion: input.webSearchEffectiveResponseInclusion,
          ...(input.webSearchDomainFilterMode === "allowed" ? {
            allowed_domains: [...input.webSearchActiveDomains],
          } : {}),
          ...(input.webSearchDomainFilterMode === "blocked" ? {
            blocked_domains: [...input.webSearchActiveDomains],
          } : {}),
          ...(input.webSearchLocationEnabled === true ? {
            user_location: { type: "approximate", ...input.webSearchLocation },
          } : {}),
        });
      } else {
        tools.push({
          type: FABLE_CHAT_LEGACY_WEB_SEARCH_TOOL_TYPE,
          name: FABLE_CHAT_WEB_SEARCH_TOOL_NAME,
          max_uses: input.webSearchMaxUses,
        });
      }
    }
    if (input.webFetchEnabled === true) {
      tools.push({
        type: FABLE_CHAT_WEB_FETCH_TOOL_TYPE,
        name: FABLE_CHAT_WEB_FETCH_TOOL_NAME,
        max_uses: FABLE_CHAT_WEB_FETCH_MAX_USES,
        citations: { enabled: true },
        max_content_tokens: FABLE_CHAT_WEB_FETCH_MAX_CONTENT_TOKENS,
        allowed_callers: [...FABLE_CHAT_WEB_FETCH_ALLOWED_CALLERS],
        use_cache: FABLE_CHAT_WEB_FETCH_USE_CACHE,
      });
    }
    if (tools.length > 0) payload.tools = tools;
    if (tools.length > 0
      && input.webSearchContractVersion >= FABLE_CHAT_WEB_SEARCH_CONTRACT_VERSION) {
      payload.tool_choice = { type: input.toolChoice };
    }
    if (input.stream === true) payload.stream = true;

    const gateway = {
      id: env.AI_GATEWAY_ID || "default",
      ...(input.skipGatewayCache === true ? { skipCache: true } : {}),
      ...(typeof input.collectGatewayLog === "boolean"
        ? { collectLog: input.collectGatewayLog }
        : {}),
      metadata: {
        surface: input.gatewaySurface || "admin-ai-lab",
        model_id: model.id,
        provider: model.provider || model.vendor || "Anthropic",
        ...(input.correlationId ? { request_id: input.correlationId } : {}),
      },
    };

    return {
      payload,
      runOptions: {
        gateway,
      },
    };
  }

  return {
    payload: {
      messages: buildMessages(input.system, input.prompt, input.messages),
      max_tokens: Math.min(maxTokens, model.maxTokens || maxTokens),
      temperature: input.temperature,
    },
    runOptions: undefined,
  };
}

function addUsageValues(left, right) {
  const output = {};
  for (const key of [
    "input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens",
  ]) {
    const a = Number(left?.[key]);
    const b = Number(right?.[key]);
    if (Number.isFinite(a) || Number.isFinite(b)) {
      output[key] = Math.max(0, Math.floor(Number.isFinite(a) ? a : 0))
        + Math.max(0, Math.floor(Number.isFinite(b) ? b : 0));
    }
  }
  const aThinking = Number(left?.output_tokens_details?.thinking_tokens);
  const bThinking = Number(right?.output_tokens_details?.thinking_tokens);
  if (Number.isFinite(aThinking) || Number.isFinite(bThinking)) {
    output.output_tokens_details = {
      thinking_tokens: Math.max(0, Math.floor(Number.isFinite(aThinking) ? aThinking : 0))
        + Math.max(0, Math.floor(Number.isFinite(bThinking) ? bThinking : 0)),
    };
  }
  const aSearch = Number(left?.server_tool_use?.web_search_requests);
  const bSearch = Number(right?.server_tool_use?.web_search_requests);
  const aFetch = Number(left?.server_tool_use?.web_fetch_requests);
  const bFetch = Number(right?.server_tool_use?.web_fetch_requests);
  if (Number.isFinite(aSearch) || Number.isFinite(bSearch)
    || Number.isFinite(aFetch) || Number.isFinite(bFetch)) {
    output.server_tool_use = {
      ...(Number.isFinite(aSearch) || Number.isFinite(bSearch) ? {
      web_search_requests: Math.min(FABLE_CHAT_WEB_SEARCH_HARD_MAX_USES,
        Math.max(0, Math.floor(Number.isFinite(aSearch) ? aSearch : 0))
        + Math.max(0, Math.floor(Number.isFinite(bSearch) ? bSearch : 0))),
      } : {}),
      ...(Number.isFinite(aFetch) || Number.isFinite(bFetch) ? {
        web_fetch_requests: Math.min(FABLE_CHAT_WEB_FETCH_MAX_USES,
          Math.max(0, Math.floor(Number.isFinite(aFetch) ? aFetch : 0))
          + Math.max(0, Math.floor(Number.isFinite(bFetch) ? bFetch : 0))),
      } : {}),
    };
  }
  return Object.keys(output).length > 0 ? output : null;
}

function buildPauseTurnContinuationPayload(payload, providerBlocks) {
  return {
    ...payload,
    messages: [
      ...payload.messages,
      { role: "assistant", content: providerBlocks },
    ],
  };
}

function extractAnthropicMessageText(result) {
  if (!result || typeof result !== "object") return null;
  if (typeof result.content === "string") return result.content.trim() || null;
  if (!Array.isArray(result.content)) return null;

  const text = result.content
    .filter((block) => (
      block
      && typeof block === "object"
      && block.type === "text"
      && typeof block.text === "string"
    ))
    .map((block) => block.text)
    .join("\n\n")
    .trim();
  return text || null;
}

function sanitizeAnthropicUsage(usage) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  const safe = {};
  for (const key of [
    "input_tokens",
    "output_tokens",
    "cache_read_input_tokens",
    "cache_creation_input_tokens",
  ]) {
    const value = Number(usage[key]);
    if (Number.isFinite(value) && value >= 0) safe[key] = value;
  }
  const thinkingTokens = Number(usage?.output_tokens_details?.thinking_tokens);
  if (Number.isFinite(thinkingTokens) && thinkingTokens >= 0) {
    safe.output_tokens_details = { thinking_tokens: thinkingTokens };
  }
  const searchRequests = Number(usage?.server_tool_use?.web_search_requests);
  const fetchRequests = Number(usage?.server_tool_use?.web_fetch_requests);
  if ((Number.isFinite(searchRequests) && searchRequests >= 0)
    || (Number.isFinite(fetchRequests) && fetchRequests >= 0)) {
    safe.server_tool_use = {
      ...(Number.isFinite(searchRequests) && searchRequests >= 0 ? {
      web_search_requests: Math.min(FABLE_CHAT_WEB_SEARCH_HARD_MAX_USES, Math.floor(searchRequests)),
      } : {}),
      ...(Number.isFinite(fetchRequests) && fetchRequests >= 0 ? {
        web_fetch_requests: Math.min(FABLE_CHAT_WEB_FETCH_MAX_USES, Math.floor(fetchRequests)),
      } : {}),
    };
  }
  return Object.keys(safe).length > 0 ? safe : null;
}

function sanitizeAnthropicStopDetails(value, depth = 0) {
  if (value == null) return null;
  if (typeof value === "string") return value.slice(0, 200);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 2) return null;
  if (Array.isArray(value)) {
    return value.slice(0, 8)
      .map((entry) => sanitizeAnthropicStopDetails(entry, depth + 1))
      .filter((entry) => entry !== null);
  }
  if (typeof value !== "object") return null;

  const safe = {};
  for (const [key, entry] of Object.entries(value).slice(0, 12)) {
    if (/(?:thinking|signature|content|prompt|message|text)/i.test(key)) continue;
    const sanitized = sanitizeAnthropicStopDetails(entry, depth + 1);
    if (sanitized !== null) safe[key] = sanitized;
  }
  return Object.keys(safe).length > 0 ? safe : null;
}

function unifiedBillingReadinessError(error) {
  if (error?.code === "generation_timeout") return error;
  const providerMessage = typeof error?.message === "string" ? error.message : "";
  if (/(?:thinking|redacted_thinking)[\s\S]{0,160}latest assistant message[\s\S]{0,160}cannot be modified/i.test(providerMessage)) {
    const contextError = new Error("Fable request context is invalid.");
    contextError.name = "FableReplayedContextError";
    contextError.code = "provider_invalid_replayed_context";
    contextError.status = 400;
    return contextError;
  }
  const readinessError = new Error(
    "Claude Fable 5 could not run through Cloudflare Unified Billing. Verify the AI Gateway and available Unified Billing credits, then retry."
  );
  readinessError.name = "UnifiedBillingReadinessError";
  readinessError.code = "unified_billing_unavailable";
  readinessError.status = 503;
  return readinessError;
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

const REMOTE_IMAGE_MAX_BYTES = 25 * 1024 * 1024;
const REMOTE_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function sanitizeGatewayMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") return null;
  return {
    keySource: sanitizeErrorValue(metadata.keySource) || null,
  };
}

async function fetchRemoteImageCandidate(url) {
  if (typeof url !== "string" || !/^https:\/\//i.test(url)) return null;
  const response = await fetchWithGenerationTimeout(globalThis.fetch, url, { method: "GET" });
  if (!response.ok) {
    throw new Error("Provider image URL could not be fetched.");
  }

  const contentType = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!REMOTE_IMAGE_MIME_TYPES.has(contentType)) {
    throw new Error("Provider image URL returned an unsupported image type.");
  }

  const contentLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > REMOTE_IMAGE_MAX_BYTES) {
    throw new Error("Provider image URL exceeded the image size limit.");
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > REMOTE_IMAGE_MAX_BYTES) {
    throw new Error("Provider image URL exceeded the image size limit.");
  }

  return {
    imageBase64: bytesToBase64(new Uint8Array(buffer)),
    mimeType: contentType,
    imageUrl: url,
  };
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
    if (result.result?.image != null) candidates.push(result.result.image);
    if (result.image != null) candidates.push(result.image);
    if (Array.isArray(result.images) && result.images.length > 0) candidates.push(result.images[0]);
    if (result.data?.image != null) candidates.push(result.data.image);
    if (Array.isArray(result.data) && result.data[0]?.url != null) candidates.push(result.data[0].url);
    if (Array.isArray(result.output) && result.output[0]?.image != null) candidates.push(result.output[0].image);
    if (Array.isArray(result.result?.images) && result.result.images.length > 0) candidates.push(result.result.images[0]);
    if (Array.isArray(result.result?.data) && result.result.data[0]?.url != null) {
      candidates.push(result.result.data[0].url);
    }
    if (result.data != null) candidates.push(result.data);
  }
  candidates.push(result);

  for (const candidate of candidates) {
    if (typeof candidate === "string" && isUrlLike(candidate)) {
      const fetched = await fetchRemoteImageCandidate(candidate);
      if (fetched) return fetched;
    }

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
      return {
        imageBase64: bytesToBase64(bytes),
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
  const { payload, runOptions } = buildTextInvocation(env, model, input);

  let raw;
  try {
    raw = await runWithGenerationTimeout(() => (
      runOptions
        ? env.AI.run(model.id, payload, runOptions)
        : env.AI.run(model.id, payload)
    ), {
      timeoutMs: input.generationTimeoutMs || undefined,
    });
    if (model.id === CLAUDE_FABLE_5_MODEL_ID
      && (input.webSearchEnabled === true || input.webFetchEnabled === true)) {
      const maxContinuations = (input.webSearchEnabled === true
        ? Math.min(FABLE_CHAT_WEB_SEARCH_MAX_CONTINUATIONS, input.webSearchMaxUses)
        : 0) + (input.webFetchEnabled === true ? FABLE_CHAT_WEB_FETCH_MAX_CONTINUATIONS : 0);
      let continuationCount = 0;
      let accumulatedBlocks = [];
      let accumulatedUsage = null;
      let gatewayMetadata = raw?.gatewayMetadata;
      while (raw?.stop_reason === "pause_turn") {
        const paused = extractAnthropicVisibleResult(raw?.content, {
          allowMissingText: true,
          allowOrphanSearchResults: continuationCount > 0,
          allowOrphanFetchResults: continuationCount > 0,
          allowOrphanCodeExecutionResults: continuationCount > 0,
          maxWebSearchUses: input.webSearchEnabled === true ? input.webSearchMaxUses : 0,
          maxWebFetchUses: input.webFetchEnabled === true ? input.webFetchMaxUses : 0,
          allowDynamicSearch: ["dynamic", "both"].includes(input.webSearchCallerMode),
          allowExcludedSearchResults: input.webSearchEffectiveResponseInclusion === "excluded",
        });
        accumulatedBlocks = [...accumulatedBlocks, ...paused.providerBlocks];
        extractAnthropicVisibleResult(accumulatedBlocks, {
          allowMissingText: true,
          maxWebSearchUses: input.webSearchEnabled === true ? input.webSearchMaxUses : 0,
          maxWebFetchUses: input.webFetchEnabled === true ? input.webFetchMaxUses : 0,
          allowDynamicSearch: ["dynamic", "both"].includes(input.webSearchCallerMode),
          allowExcludedSearchResults: input.webSearchEffectiveResponseInclusion === "excluded",
        });
        accumulatedUsage = addUsageValues(accumulatedUsage, raw?.usage);
        gatewayMetadata = raw?.gatewayMetadata || gatewayMetadata;
        if (continuationCount >= maxContinuations) {
          const error = new Error("Fable web search exceeded its continuation limit.");
          error.code = "provider_pause_turn_limit_exceeded";
          throw error;
        }
        const continuationPayload = buildPauseTurnContinuationPayload(payload, accumulatedBlocks);
        raw = await runWithGenerationTimeout(() => env.AI.run(
          model.id,
          continuationPayload,
          runOptions
        ), { timeoutMs: input.generationTimeoutMs || FABLE_CHAT_GENERATION_TIMEOUT_MS });
        continuationCount += 1;
      }
      if (accumulatedBlocks.length > 0) {
        raw = {
          ...raw,
          content: [...accumulatedBlocks, ...(raw?.content || [])],
          usage: addUsageValues(accumulatedUsage, raw?.usage),
          gatewayMetadata: raw?.gatewayMetadata || gatewayMetadata,
        };
      }
    }
  } catch (error) {
    const classifiedError = model.id === CLAUDE_FABLE_5_MODEL_ID
      ? unifiedBillingReadinessError(error)
      : error;
    logDiagnostic({
      service: "bitbi-ai",
      component: "invoke-text",
      event: "workers_ai_run_failed",
      level: "error",
      correlationId: input.correlationId || null,
      model: model.id,
      provider: model.provider || model.vendor || null,
      gateway_id: runOptions?.gateway?.id || null,
      duration_ms: getDurationMs(startedAt),
      ...getErrorFields(classifiedError, { includeMessage: false }),
    });
    throw classifiedError;
  }
  const isAnthropic = isAnthropicMessagesModel(model);
  const text = isAnthropic
    ? extractAnthropicMessageText(raw)
    : extractTextResponse(raw);

  if (!text) {
    throw new Error("Model returned no text output.");
  }

  const preserved = isAnthropic && input.preserveAnthropicContent === true
      ? extractAnthropicVisibleResult(raw?.content, {
        maxWebSearchUses: input.webSearchEnabled === true ? input.webSearchMaxUses : 0,
        maxWebFetchUses: input.webFetchEnabled === true ? input.webFetchMaxUses : 0,
        allowDynamicSearch: ["dynamic", "both"].includes(input.webSearchCallerMode),
        allowExcludedSearchResults: input.webSearchEffectiveResponseInclusion === "excluded",
      })
    : null;
  if (preserved && preserved.text !== text) {
    throw new Error("Model returned inconsistent text content.");
  }

  const usage = isAnthropic
    ? sanitizeAnthropicUsage(raw?.usage)
    : raw?.usage || raw?.result?.usage || null;
  return {
    text,
    usage,
    responseModel: isAnthropic ? sanitizeErrorValue(raw?.model) || null : null,
    stopReason: isAnthropic ? sanitizeErrorValue(raw?.stop_reason) || null : null,
    stopSequence: isAnthropic ? sanitizeErrorValue(raw?.stop_sequence) || null : null,
    stopDetails: isAnthropic ? sanitizeAnthropicStopDetails(raw?.stop_details) : null,
    gatewayMetadata: isAnthropic ? sanitizeGatewayMetadata(raw?.gatewayMetadata) : null,
    ...(preserved ? {
      providerBlocks: preserved.providerBlocks,
      reasoningSummary: preserved.reasoningSummary,
      sources: preserved.sources,
      webSearchRequestCount: preserved.webSearchRequestCount,
      webSearchExecutedRequestCount: Number.isFinite(
        Number(usage?.server_tool_use?.web_search_requests)
      )
        ? Number(usage.server_tool_use.web_search_requests)
        : preserved.webSearchRequestCount,
      webSearchResultCount: preserved.webSearchResultCount,
      webFetchRequestCount: preserved.webFetchRequestCount,
      webFetchResultCount: preserved.webFetchResultCount,
      webFetchErrorResultCount: preserved.webFetchErrorResultCount,
    } : {}),
    ...(model.id === QWEN3_30B_A3B_MODEL_ID
      ? { providerCostUsd: calculateQwen3UsageCostUsd(usage).totalCostUsd }
      : {}),
    elapsedMs: Date.now() - startedAt,
  };
}

function sanitizeQwenUsage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const promptTokens = Math.max(0, Math.floor(Number(value.prompt_tokens) || 0));
  const completionTokens = Math.max(0, Math.floor(Number(value.completion_tokens) || 0));
  const totalTokens = Math.max(
    promptTokens + completionTokens,
    Math.floor(Number(value.total_tokens) || 0)
  );
  return {
    input_tokens: promptTokens,
    output_tokens: completionTokens,
    total_tokens: totalTokens,
  };
}

function sanitizeQwenDiagnosticUsage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output = {};
  for (const [providerField, safeField] of [
    ["prompt_tokens", "input_tokens"],
    ["completion_tokens", "output_tokens"],
    ["total_tokens", "total_tokens"],
  ]) {
    const tokens = Number(value[providerField]);
    if (Number.isFinite(tokens) && tokens >= 0) {
      output[safeField] = Math.floor(tokens);
    }
  }
  return output;
}

function hasFableChatMemoryReasoningValue(value) {
  if (value == null) return false;
  if (typeof value === "string") {
    const normalized = value.trim();
    return Boolean(normalized && !["[]", "{}"].includes(normalized));
  }
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(value);
}

function sanitizeFableChatMemoryFinishReason(value) {
  if (typeof value !== "string" || !value.trim()) return "missing";
  const normalized = value.trim().toLowerCase();
  return ["stop", "length", "max_tokens"].includes(normalized)
    ? normalized
    : "other";
}

function createFableChatMemoryProviderRejection(category, diagnostics = {}) {
  const rejectionCategory = normalizeFableChatMemoryRejectionCategory(category);
  const error = new Error("Qwen memory response did not satisfy the bounded output contract.");
  error.code = rejectionCategory === "provider_length_truncation"
    ? "fable_chat_memory_truncated"
    : "fable_chat_memory_invalid_provider_result";
  error.status = 502;
  error.rejectionCategory = rejectionCategory;
  error.memoryDiagnostic = Object.freeze({
    rejection_category: rejectionCategory,
    finish_reason: diagnostics.finish_reason || "missing",
    model_id: FABLE_CHAT_MEMORY_MODEL_ID,
    choice_present: diagnostics.choice_present === true,
    content_present: diagnostics.content_present === true,
    reasoning_content_present: diagnostics.reasoning_content_present === true,
    reasoning_present: diagnostics.reasoning_present === true,
    refusal_present: diagnostics.refusal_present === true,
    think_tag_present: diagnostics.think_tag_present === true,
    json_parse_success: diagnostics.json_parse_success === true,
    ...(Number.isFinite(Number(diagnostics.estimated_summary_tokens))
      ? { estimated_summary_tokens: Math.max(0, Math.floor(Number(diagnostics.estimated_summary_tokens))) }
      : {}),
    configured_profile_limit: Math.max(
      0,
      Math.floor(Number(diagnostics.configured_profile_limit) || 0)
    ),
    provider_usage: sanitizeQwenDiagnosticUsage(diagnostics.provider_usage),
    duration_ms: Math.max(0, Math.floor(Number(diagnostics.duration_ms) || 0)),
    source_catalog_count: Math.max(0, Math.floor(Number(diagnostics.source_catalog_count) || 0)),
    returned_source_id_count: Math.max(0, Math.floor(Number(diagnostics.returned_source_id_count) || 0)),
    resolved_source_id_count: Math.max(0, Math.floor(Number(diagnostics.resolved_source_id_count) || 0)),
    unknown_source_id_count: Math.max(0, Math.floor(Number(diagnostics.unknown_source_id_count) || 0)),
    duplicate_source_id_count: Math.max(0, Math.floor(Number(diagnostics.duplicate_source_id_count) || 0)),
    malformed_source_id_count: Math.max(0, Math.floor(Number(diagnostics.malformed_source_id_count) || 0)),
    source_id_shape_valid: diagnostics.source_id_shape_valid === true,
    profile: ["standard", "lite"].includes(diagnostics.profile)
      ? diagnostics.profile
      : null,
    planning_ceiling: Math.max(0, Math.floor(Number(diagnostics.planning_ceiling) || 0)),
    base_soft_target: Math.max(
      0,
      Math.floor(Number(diagnostics.base_soft_target) || 0)
    ),
    acceptance_ceiling: Math.max(
      0,
      Math.floor(Number(diagnostics.acceptance_ceiling) || 0)
    ),
    fixed_schema_overhead: Math.max(
      0,
      Math.floor(Number(diagnostics.fixed_schema_overhead) || 0)
    ),
    source_overhead_estimate: Math.max(
      0,
      Math.floor(Number(diagnostics.source_overhead_estimate) || 0)
    ),
    safety_margin: Math.max(0, Math.floor(Number(diagnostics.safety_margin) || 0)),
    effective_summary_target: Math.max(
      0,
      Math.floor(Number(diagnostics.effective_summary_target) || 0)
    ),
    effective_soft_target: Math.max(
      0,
      Math.floor(Number(diagnostics.effective_soft_target) || 0)
    ),
    final_estimated_summary_size: Math.max(
      0,
      Math.floor(Number(diagnostics.final_estimated_summary_size) || 0)
    ),
    final_limit_exceeded: diagnostics.final_limit_exceeded === true,
  });
  return error;
}

export function validateFableChatMemoryProviderResult(raw, {
  profile,
  diagnosticVersion = 1,
  sourceCatalog = [],
  memoryBudgetPlan = null,
  startedAt = Date.now(),
} = {}) {
  const appliedAcceptanceCeiling = diagnosticVersion >= 5
    ? getFableChatMemoryAcceptanceCeiling(profile)
    : getFableChatMemoryPlanningCeiling(profile);
  const choice = Array.isArray(raw?.choices) ? raw.choices[0] : null;
  const choicePresent = Boolean(choice && typeof choice === "object" && !Array.isArray(choice));
  const message = choicePresent && choice.message && typeof choice.message === "object"
    && !Array.isArray(choice.message)
    ? choice.message
    : null;
  const contentPresent = Boolean(message && Object.hasOwn(message, "content"));
  const rawContent = typeof message?.content === "string" ? message.content : null;
  const content = rawContent == null ? "" : rawContent.trim();
  const reasoningContentPresent = hasFableChatMemoryReasoningValue(message?.reasoning_content);
  const reasoningPresent = hasFableChatMemoryReasoningValue(message?.reasoning);
  const refusalPresent = typeof message?.refusal === "string"
    && Boolean(message.refusal.trim());
  const thinkTagPresent = typeof rawContent === "string" && /<\/?think>/i.test(rawContent);
  const finishReason = sanitizeFableChatMemoryFinishReason(choice?.finish_reason);
  const diagnostics = {
    finish_reason: finishReason,
    choice_present: choicePresent,
    content_present: contentPresent,
    reasoning_content_present: reasoningContentPresent,
    reasoning_present: reasoningPresent,
    refusal_present: refusalPresent,
    think_tag_present: thinkTagPresent,
    json_parse_success: false,
    configured_profile_limit: appliedAcceptanceCeiling,
    provider_usage: raw?.usage,
    duration_ms: getDurationMs(startedAt),
    source_catalog_count: Array.isArray(sourceCatalog) ? sourceCatalog.length : 0,
    source_id_shape_valid: diagnosticVersion < 3,
    profile,
    planning_ceiling: memoryBudgetPlan?.planningCeiling,
    base_soft_target: memoryBudgetPlan?.profileBaseSoftTarget,
    acceptance_ceiling: appliedAcceptanceCeiling,
    fixed_schema_overhead: memoryBudgetPlan?.fixedSchemaOverhead,
    source_overhead_estimate: memoryBudgetPlan?.sourceOverheadEstimate,
    safety_margin: memoryBudgetPlan?.safetyMargin,
    effective_summary_target: memoryBudgetPlan?.effectiveSoftTarget,
    effective_soft_target: memoryBudgetPlan?.effectiveSoftTarget,
  };
  if (!choicePresent) {
    throw createFableChatMemoryProviderRejection("missing_choice", diagnostics);
  }
  if (finishReason === "missing") {
    throw createFableChatMemoryProviderRejection("missing_finish_reason", diagnostics);
  }
  if (["length", "max_tokens"].includes(finishReason)) {
    throw createFableChatMemoryProviderRejection("provider_length_truncation", diagnostics);
  }
  if (finishReason !== "stop") {
    throw createFableChatMemoryProviderRejection("invalid_finish_reason", diagnostics);
  }
  if (!contentPresent || typeof rawContent !== "string") {
    throw createFableChatMemoryProviderRejection("missing_content", diagnostics);
  }
  if (!content) {
    throw createFableChatMemoryProviderRejection("empty_content", diagnostics);
  }
  if (reasoningContentPresent) {
    throw createFableChatMemoryProviderRejection("reasoning_content_present", diagnostics);
  }
  if (reasoningPresent) {
    throw createFableChatMemoryProviderRejection("reasoning_present", diagnostics);
  }
  if (thinkTagPresent) {
    throw createFableChatMemoryProviderRejection("think_tag_present", diagnostics);
  }
  if (refusalPresent) {
    throw createFableChatMemoryProviderRejection("refusal_present", diagnostics);
  }
  let parsed;
  try {
    parsed = JSON.parse(content);
    diagnostics.json_parse_success = true;
  } catch {
    throw createFableChatMemoryProviderRejection("json_parse_failed", diagnostics);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw createFableChatMemoryProviderRejection("json_not_object", diagnostics);
  }
  try {
    const normalized = diagnosticVersion >= 3
      ? normalizeFableChatMemoryProviderSummary(parsed, {
          mode: profile,
          sourceCatalog,
          acceptanceCeiling: appliedAcceptanceCeiling,
        })
      : normalizeFableChatMemorySummary(parsed, { mode: profile });
    if (diagnosticVersion >= 4) {
      normalized.sourceDiagnostics = {
        ...(normalized.sourceDiagnostics || {}),
        profile,
        planning_ceiling: memoryBudgetPlan?.planningCeiling || 0,
        base_soft_target: memoryBudgetPlan?.profileBaseSoftTarget || 0,
        acceptance_ceiling: appliedAcceptanceCeiling,
        fixed_schema_overhead: memoryBudgetPlan?.fixedSchemaOverhead || 0,
        source_overhead_estimate: memoryBudgetPlan?.sourceOverheadEstimate || 0,
        safety_margin: memoryBudgetPlan?.safetyMargin || 0,
        effective_summary_target: memoryBudgetPlan?.effectiveSoftTarget || 0,
        effective_soft_target: memoryBudgetPlan?.effectiveSoftTarget || 0,
        final_estimated_summary_size: normalized.estimatedTokens,
        final_limit_exceeded: false,
      };
    }
    return normalized;
  } catch (cause) {
    throw createFableChatMemoryProviderRejection(
      cause?.rejectionCategory,
      {
        ...diagnostics,
        estimated_summary_tokens: cause?.estimatedSummaryTokens,
        final_estimated_summary_size: cause?.estimatedSummaryTokens,
        final_limit_exceeded: cause?.rejectionCategory === "summary_limit_exceeded",
        ...(cause?.sourceDiagnostics || {}),
      }
    );
  }
}

export async function invokeFableChatMemory(env, input) {
  ensureAI(env);
  const startedAt = Date.now();
  const usesSourceIdContract = input.diagnosticVersion >= 3;
  const usesDynamicSummaryBudget = input.diagnosticVersion >= 4;
  const system = buildFableChatMemorySummarizerSystemPrompt(input.profile, {
    sourceIdContract: usesSourceIdContract,
    effectiveSoftTarget: usesDynamicSummaryBudget
      ? input.memoryBudgetPlan?.effectiveSoftTarget
      : null,
    litePlanVersion: input.litePlanVersion,
  });
  const maxTokens = getFableChatMemoryProviderMaxTokens(input.profile);
  const payload = {
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          "Summarize the following server-delimited memory source according to the system contract.",
          ...(usesSourceIdContract ? [
            "Select only source IDs from sourceCatalog and return them in source_ids; return no source titles, URLs, or objects.",
          ] : []),
          ...(usesDynamicSummaryBudget ? [
            `Keep all non-source summary content combined within ${input.memoryBudgetPlan.effectiveSoftTarget} conservatively estimated tokens.`,
            "Produce one complete concise JSON object; do not use source_ids to expand the narrative.",
          ] : []),
          ...(input.profile === "lite" && input.litePlanVersion >= 2 ? [
            "For Lite memory, keep only durable facts, decisions, preferences, constraints, and unresolved tasks; omit narrative and repetition.",
          ] : []),
          "<van_ark_memory_source>",
          escapeFableChatMemoryPromptData(input.sourcePayload),
          "</van_ark_memory_source>",
          "/no_think",
        ].join("\n"),
      },
    ],
    max_tokens: maxTokens,
    temperature: 0.7,
    top_p: 0.8,
    top_k: 20,
    response_format: { type: "json_object" },
    stream: false,
  };
  const runOptions = {
    gateway: {
      id: env.AI_GATEWAY_ID || "default",
      skipCache: true,
      collectLog: false,
      metadata: {
        surface: "van-ark-fable-memory",
        model_id: QWEN3_30B_A3B_MODEL_ID,
        profile: input.profile,
        ...(input.correlationId ? { request_id: input.correlationId } : {}),
      },
    },
  };
  let raw;
  try {
    raw = await runWithGenerationTimeout(() => env.AI.run(
      QWEN3_30B_A3B_MODEL_ID,
      payload,
      runOptions
    ), { timeoutMs: FABLE_CHAT_MEMORY_TIMEOUT_MS });
  } catch (error) {
    logDiagnostic({
      service: "bitbi-ai",
      component: "invoke-fable-chat-memory",
      event: "workers_ai_memory_run_failed",
      level: "error",
      correlationId: input.correlationId || null,
      model: QWEN3_30B_A3B_MODEL_ID,
      profile: input.profile,
      gateway_id: runOptions.gateway.id,
      duration_ms: getDurationMs(startedAt),
      ...getErrorFields(error, { includeMessage: false }),
    });
    throw error;
  }
  const normalized = validateFableChatMemoryProviderResult(raw, {
    profile: input.profile,
    diagnosticVersion: input.diagnosticVersion,
    sourceCatalog: input.sourceCatalog,
    memoryBudgetPlan: input.memoryBudgetPlan,
    startedAt,
  });
  const usage = sanitizeQwenUsage(raw?.usage);
  const cost = calculateFableChatMemoryCostUsd(usage);
  return {
    canonicalSummary: normalized.canonical,
    estimatedSummaryTokens: normalized.estimatedTokens,
    sourceDiagnostics: normalized.sourceDiagnostics || null,
    usage,
    providerCostUsd: cost.totalCostUsd,
    responseModel: sanitizeErrorValue(raw?.model) || QWEN3_30B_A3B_MODEL_ID,
    finishReason: "stop",
    elapsedMs: Date.now() - startedAt,
  };
}

export async function invokeFableChatStream(env, model, input) {
  ensureAI(env);
  const startedAt = Date.now();
  const { payload, runOptions } = buildTextInvocation(env, model, {
    ...input,
    stream: true,
  });
  try {
    const stream = await runWithGenerationTimeout(() => env.AI.run(
      model.id,
      payload,
      runOptions
    ), { timeoutMs: FABLE_CHAT_GENERATION_TIMEOUT_MS });
    if (!stream || typeof stream.getReader !== "function") {
      throw new Error("Model did not return a readable stream.");
    }
    return {
      stream,
      startedAt,
      continueAfterPause: input.webSearchEnabled === true || input.webFetchEnabled === true
        ? async (providerBlocks) => {
            const continuationPayload = buildPauseTurnContinuationPayload(payload, providerBlocks);
            const continuation = await runWithGenerationTimeout(() => env.AI.run(
              model.id,
              continuationPayload,
              runOptions
            ), { timeoutMs: FABLE_CHAT_GENERATION_TIMEOUT_MS });
            if (!continuation || typeof continuation.getReader !== "function") {
              throw new Error("Model did not return a readable continuation stream.");
            }
            return continuation;
          }
        : null,
    };
  } catch (error) {
    const classifiedError = unifiedBillingReadinessError(error);
    logDiagnostic({
      service: "bitbi-ai",
      component: "invoke-fable-chat-stream",
      event: "workers_ai_stream_start_failed",
      level: "error",
      correlationId: input.correlationId || null,
      model: model.id,
      provider: model.provider || model.vendor || null,
      gateway_id: runOptions?.gateway?.id || null,
      duration_ms: getDurationMs(startedAt),
      ...getErrorFields(classifiedError, { includeMessage: false }),
    });
    throw classifiedError;
  }
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
  let appliedQuality = null;
  let appliedOutputFormat = null;
  let appliedBackground = null;
  let appliedSafetyTolerance = null;
  let appliedAspectRatio = null;
  let appliedResolution = null;
  let appliedResponseFormat = null;
  let appliedOutputCount = null;
  let inputImageCount = null;
  let hasPrimaryImage = null;
  let hasMask = null;
  let referenceImageCount = Array.isArray(input.referenceImages) ? input.referenceImages.length : 0;
  let runOptions;

  if (model.inputFormat === "gpt-image-2") {
    const gptRequest = buildAdminAiGptImage2Request(model, input);
    payload = gptRequest.payload;
    appliedQuality = gptRequest.appliedQuality;
    appliedSize = null;
    appliedOutputFormat = gptRequest.appliedOutputFormat;
    appliedBackground = gptRequest.appliedBackground;
    referenceImageCount = gptRequest.referenceImageCount;
    runOptions = { gateway: { id: env.AI_GATEWAY_ID || "default" } };

    logDiagnostic({
      service: "bitbi-ai",
      component: "invoke-image",
      event: "workers_ai_gpt_image_2_invoke",
      level: "info",
      correlationId: input.correlationId || null,
      model: model.id,
      gateway_id: runOptions.gateway.id,
      quality: appliedQuality,
      size: payload.size,
      output_format: appliedOutputFormat,
      background: appliedBackground,
      reference_image_count: referenceImageCount,
      prompt_length: payload.prompt.length,
    });
  } else if (model.inputFormat === "grok-imagine-image") {
    const grokRequest = buildAdminAiGrokImagineImageRequest(model, input);
    payload = grokRequest.payload;
    appliedQuality = grokRequest.appliedQuality;
    appliedResolution = grokRequest.appliedResolution;
    appliedAspectRatio = grokRequest.appliedAspectRatio;
    appliedResponseFormat = grokRequest.appliedResponseFormat;
    appliedOutputCount = grokRequest.appliedOutputCount;
    referenceImageCount = grokRequest.referenceImageCount;
    inputImageCount = grokRequest.inputImageCount;
    hasPrimaryImage = grokRequest.hasPrimaryImage;
    hasMask = grokRequest.hasMask;
    runOptions = { gateway: { id: env.AI_GATEWAY_ID || "default" } };

    logDiagnostic({
      service: "bitbi-ai",
      component: "invoke-image",
      event: "workers_ai_grok_imagine_image_invoke",
      level: "info",
      correlationId: input.correlationId || null,
      model: model.id,
      gateway_id: runOptions.gateway.id,
      quality: appliedQuality,
      resolution: appliedResolution,
      aspect_ratio: appliedAspectRatio,
      response_format: appliedResponseFormat,
      output_count: appliedOutputCount,
      input_image_count: inputImageCount,
      has_primary_image: hasPrimaryImage,
      has_mask: hasMask,
      prompt_length: payload.prompt.length,
    });
  } else if (model.inputFormat === "flux-2-max") {
    const flux2MaxRequest = buildAdminAiFlux2MaxRequest(model, input);
    payload = flux2MaxRequest.payload;
    appliedSize = flux2MaxRequest.appliedSize;
    appliedSeed = flux2MaxRequest.appliedSeed;
    appliedOutputFormat = flux2MaxRequest.appliedOutputFormat;
    appliedSafetyTolerance = flux2MaxRequest.appliedSafetyTolerance;
    referenceImageCount = flux2MaxRequest.referenceImageCount;
    runOptions = { gateway: { id: env.AI_GATEWAY_ID || "default" } };

    logDiagnostic({
      service: "bitbi-ai",
      component: "invoke-image",
      event: "workers_ai_flux_2_max_invoke",
      level: "info",
      correlationId: input.correlationId || null,
      model: model.id,
      gateway_id: runOptions.gateway.id,
      width: payload.width,
      height: payload.height,
      output_format: appliedOutputFormat,
      safety_tolerance: appliedSafetyTolerance,
      reference_image_count: referenceImageCount,
      prompt_length: payload.prompt.length,
    });
  } else if (model.inputFormat === "multipart") {
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
    raw = await runWithGenerationTimeout(() => (
      runOptions
        ? env.AI.run(model.id, payload, runOptions)
        : env.AI.run(model.id, payload)
    ));
  } catch (error) {
    logDiagnostic({
      service: "bitbi-ai",
      component: "invoke-image",
      event: "workers_ai_run_failed",
      level: "error",
      correlationId: input.correlationId || null,
      model: model.id,
      input_format: model.inputFormat || "json",
      gateway_id: runOptions?.gateway?.id || null,
      quality: appliedQuality,
      size: payload?.size || null,
      output_format: appliedOutputFormat,
      response_format: appliedResponseFormat,
      resolution: appliedResolution,
      aspect_ratio: appliedAspectRatio,
      output_count: appliedOutputCount,
      input_image_count: inputImageCount,
      background: appliedBackground,
      safety_tolerance: appliedSafetyTolerance,
      reference_image_count: referenceImageCount,
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
    appliedQuality,
    appliedOutputFormat,
    appliedBackground,
    appliedSafetyTolerance,
    appliedAspectRatio,
    appliedResolution,
    appliedResponseFormat,
    appliedOutputCount,
    referenceImageCount,
    inputImageCount,
    hasPrimaryImage,
    hasMask,
    imageUrl: image.imageUrl || null,
    gatewayMetadata: sanitizeGatewayMetadata(raw?.gatewayMetadata),
    warnings,
    elapsedMs: Date.now() - startedAt,
  };
}

export async function invokeEmbeddings(env, model, input) {
  ensureAI(env);
  const startedAt = Date.now();
  let raw;
  try {
    raw = await runWithGenerationTimeout(() => env.AI.run(model.id, {
      text: input.input.length === 1 ? input.input[0] : input.input,
    }));
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
    raw = await runWithGenerationTimeout(() => env.AI.run(model.id, payload, runOptions));
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
