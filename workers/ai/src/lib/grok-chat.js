import {
  GROK_4_6_MODEL_ID,
  GROK_GENERATION_TIMEOUT_MS,
  GROK_MAX_IMAGES_PER_MESSAGE,
  GROK_MAX_IMAGE_BYTES,
  GROK_MAX_TOTAL_IMAGE_BYTES,
  GROK_MAX_TOOL_CALLS_PER_ROUND,
  GROK_MAX_TOOL_ROUNDS,
  GROK_MAX_TOTAL_TOOL_CALLS,
  GROK_PROVIDER_STATE_FORMAT_VERSION,
  normalizeGrokProviderSettings,
  validateGrokStructuredOutput,
} from "../../../shared/grok-chat-contract.mjs";
import {
  addGrokUsage,
  consumeOpenAiChatCompletionStream,
  OpenAiChatStreamError,
} from "./openai-chat-stream.js";
import {
  executeGrokToolCall,
  GROK_TOOL_DEFINITIONS,
  GrokToolError,
} from "./grok-tools.js";

const ENCODER = new TextEncoder();
const PROMPT_CACHE_KEY_PATTERN = /^gpc_[a-f0-9]{64}$/;
const PRIVACY_USER_PATTERN = /^vau_[a-f0-9]{64}$/;
const IMAGE_DATA_URL_PATTERN = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/;
const SAFE_MESSAGE_ROLES = new Set(["system", "user", "assistant", "tool"]);

export class GrokChatValidationError extends Error {
  constructor(message, code = "validation_error", status = 400, {
    validationField = null,
    validationIssue = null,
  } = {}) {
    super(message);
    this.name = "GrokChatValidationError";
    this.code = code;
    this.status = status;
    this.definitive = true;
    this.validationField = validationField;
    this.validationIssue = validationIssue;
  }
}

function byteLength(value) {
  return ENCODER.encode(String(value || "")).byteLength;
}

function plainObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GrokChatValidationError(`${field} must be an object.`);
  }
  return value;
}

function onlyFields(value, allowed, field) {
  const unsupported = Object.keys(value).find((key) => !allowed.has(key));
  if (unsupported) {
    throw new GrokChatValidationError(
      `${field}.${unsupported} is not supported.`,
      "validation_error",
      400,
      { validationField: `${field}.${unsupported}`, validationIssue: "unsupported_field" }
    );
  }
}

function normalizeText(value, field, maxLength, { empty = false } = {}) {
  if (typeof value !== "string" || value.length > maxLength
    || (!empty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new GrokChatValidationError(`${field} is invalid.`);
  }
  return value;
}

function validateImageDataUrl(value, field) {
  if (typeof value !== "string") throw new GrokChatValidationError(`${field} is invalid.`);
  const matched = value.match(IMAGE_DATA_URL_PATTERN);
  if (!matched || matched[2].length % 4 !== 0) {
    throw new GrokChatValidationError(`${field} must be a private supported image data URL.`);
  }
  const approximateBytes = Math.floor(matched[2].length * 3 / 4)
    - (matched[2].endsWith("==") ? 2 : matched[2].endsWith("=") ? 1 : 0);
  if (approximateBytes <= 0 || approximateBytes > GROK_MAX_IMAGE_BYTES) {
    throw new GrokChatValidationError(`${field} is too large.`);
  }
  return { url: value, byteSize: approximateBytes };
}

function validateUserContent(value, field) {
  if (typeof value === "string") return normalizeText(value, field, 16_000);
  if (!Array.isArray(value) || value.length < 1 || value.length > GROK_MAX_IMAGES_PER_MESSAGE + 1) {
    throw new GrokChatValidationError(`${field} is invalid.`);
  }
  let textCount = 0;
  let imageCount = 0;
  let imageBytes = 0;
  const normalized = value.map((item, index) => {
    const entry = plainObject(item, `${field}[${index}]`);
    if (entry.type === "text") {
      onlyFields(entry, new Set(["type", "text"]), `${field}[${index}]`);
      textCount += 1;
      return { type: "text", text: normalizeText(entry.text, `${field}[${index}].text`, 16_000) };
    }
    if (entry.type === "image_url") {
      onlyFields(entry, new Set(["type", "image_url"]), `${field}[${index}]`);
      const image = plainObject(entry.image_url, `${field}[${index}].image_url`);
      onlyFields(image, new Set(["url", "detail"]), `${field}[${index}].image_url`);
      if (image.detail != null && !["auto", "low", "high"].includes(image.detail)) {
        throw new GrokChatValidationError(`${field}[${index}].image_url.detail is invalid.`);
      }
      const validated = validateImageDataUrl(image.url, `${field}[${index}].image_url.url`);
      imageCount += 1;
      imageBytes += validated.byteSize;
      return {
        type: "image_url",
        image_url: {
          url: validated.url,
          ...(image.detail == null ? {} : { detail: image.detail }),
        },
      };
    }
    throw new GrokChatValidationError(`${field}[${index}].type is not supported.`);
  });
  if (textCount !== 1 || imageCount < 1 || imageCount > GROK_MAX_IMAGES_PER_MESSAGE) {
    throw new GrokChatValidationError(`${field} must contain one text block and bounded images.`);
  }
  if (imageBytes > GROK_MAX_TOTAL_IMAGE_BYTES) {
    throw new GrokChatValidationError(`${field} contains too much image data.`);
  }
  return normalized;
}

function validateToolCalls(value, field) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 128) {
    throw new GrokChatValidationError(`${field} is invalid.`);
  }
  return value.map((toolCall, index) => {
    const item = plainObject(toolCall, `${field}[${index}]`);
    onlyFields(item, new Set(["id", "type", "function"]), `${field}[${index}]`);
    const fn = plainObject(item.function, `${field}[${index}].function`);
    onlyFields(fn, new Set(["name", "arguments"]), `${field}[${index}].function`);
    const id = normalizeText(item.id, `${field}[${index}].id`, 180);
    const name = normalizeText(fn.name, `${field}[${index}].function.name`, 64);
    const args = normalizeText(fn.arguments, `${field}[${index}].function.arguments`, 16 * 1024);
    if (item.type !== "function"
      || !/^(?:call-|call_)[A-Za-z0-9_-]{1,180}$/.test(id)
      || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)) {
      throw new GrokChatValidationError(`${field}[${index}] is invalid.`);
    }
    return { id, type: "function", function: { name, arguments: args } };
  });
}

function validateMessage(value, index) {
  const field = `messages[${index}]`;
  const message = plainObject(value, field);
  const role = String(message.role || "").trim();
  if (!SAFE_MESSAGE_ROLES.has(role)) throw new GrokChatValidationError(`${field}.role is invalid.`);
  if (role === "system") {
    onlyFields(message, new Set(["role", "content"]), field);
    return { role, content: normalizeText(message.content, `${field}.content`, 12_000) };
  }
  if (role === "user") {
    onlyFields(message, new Set(["role", "content"]), field);
    return { role, content: validateUserContent(message.content, `${field}.content`) };
  }
  if (role === "assistant") {
    onlyFields(message, new Set(["role", "content", "tool_calls"]), field);
    const content = message.content == null
      ? null
      : normalizeText(message.content, `${field}.content`, 524_288, { empty: true });
    const toolCalls = message.tool_calls == null
      ? null
      : validateToolCalls(message.tool_calls, `${field}.tool_calls`);
    if (content == null && !toolCalls) throw new GrokChatValidationError(`${field} is invalid.`);
    return { role, content, ...(toolCalls ? { tool_calls: toolCalls } : {}) };
  }
  onlyFields(message, new Set(["role", "content", "tool_call_id"]), field);
  const toolCallId = normalizeText(message.tool_call_id, `${field}.tool_call_id`, 180);
  if (!/^(?:call-|call_)[A-Za-z0-9_-]{1,180}$/.test(toolCallId)) {
    throw new GrokChatValidationError(`${field}.tool_call_id is invalid.`);
  }
  return {
    role,
    content: normalizeText(message.content, `${field}.content`, 32 * 1024),
    tool_call_id: toolCallId,
  };
}

export function validateGrokChatInput(value) {
  const input = plainObject(value, "Request body");
  onlyFields(input, new Set([
    "model", "messages", "settings", "promptCacheKey", "privacyUser", "contextFormatVersion",
  ]), "Request body");
  if (input.model !== GROK_4_6_MODEL_ID) throw new GrokChatValidationError("model is not supported.");
  if (!Array.isArray(input.messages) || input.messages.length < 2 || input.messages.length > 500) {
    throw new GrokChatValidationError("messages is invalid.");
  }
  const messages = input.messages.map(validateMessage);
  if (messages[0].role !== "system" || messages[messages.length - 1].role !== "user") {
    throw new GrokChatValidationError("messages must start with system and end with user.");
  }
  if (!PROMPT_CACHE_KEY_PATTERN.test(String(input.promptCacheKey || ""))) {
    throw new GrokChatValidationError("promptCacheKey is invalid.");
  }
  if (!PRIVACY_USER_PATTERN.test(String(input.privacyUser || ""))) {
    throw new GrokChatValidationError("privacyUser is invalid.");
  }
  let settings;
  try {
    settings = normalizeGrokProviderSettings(input.settings);
  } catch (error) {
    throw new GrokChatValidationError(error?.message || "Grok settings are invalid.");
  }
  return {
    model: GROK_4_6_MODEL_ID,
    messages,
    settings,
    promptCacheKey: input.promptCacheKey,
    privacyUser: input.privacyUser,
    contextFormatVersion: String(input.contextFormatVersion || "").slice(0, 80),
  };
}

function providerResponseFormat(responseFormat) {
  if (responseFormat.type === "json_schema") {
    return {
      type: "json_schema",
      json_schema: {
        name: responseFormat.jsonSchema.name,
        schema: responseFormat.jsonSchema.schema,
        strict: true,
      },
    };
  }
  return { type: responseFormat.type };
}

export function buildGrokProviderPayload(input, messages = input.messages, {
  toolChoice = input.settings.toolChoice,
} = {}) {
  const { settings } = input;
  const payload = {
    messages,
    max_completion_tokens: settings.maxCompletionTokens,
    prompt_cache_key: input.promptCacheKey,
    reasoning_effort: settings.reasoningEffort,
    stream: true,
    stream_options: { include_usage: true },
    user: input.privacyUser,
  };
  if (settings.responseFormat.type !== "text") {
    payload.response_format = providerResponseFormat(settings.responseFormat);
  }
  if (toolChoice !== "none") {
    payload.parallel_tool_calls = settings.parallelToolCalls;
    payload.tool_choice = toolChoice;
    payload.tools = GROK_TOOL_DEFINITIONS;
  }
  if (settings.temperature != null) payload.temperature = settings.temperature;
  if (settings.topP != null) payload.top_p = settings.topP;
  if (settings.seed != null) payload.seed = settings.seed;
  if (settings.webSearch.mode !== "off") {
    payload.search_parameters = {
      mode: settings.webSearch.mode,
      max_search_results: settings.webSearch.maxResults,
      return_citations: true,
      ...(settings.webSearch.fromDate ? { from_date: settings.webSearch.fromDate } : {}),
      ...(settings.webSearch.toDate ? { to_date: settings.webSearch.toDate } : {}),
    };
  }
  return payload;
}

function gatewayOptions(env, correlationId) {
  return {
    gateway: {
      id: env.AI_GATEWAY_ID || "default",
      skipCache: true,
      collectLog: false,
      metadata: {
        surface: "van-ark-chat",
        model_id: GROK_4_6_MODEL_ID,
        provider: "xai",
        ...(correlationId ? { request_id: correlationId } : {}),
      },
    },
  };
}

async function runProviderRound(env, input, messages, correlationId, signal, toolChoice) {
  if (!env?.AI || typeof env.AI.run !== "function") {
    throw new GrokChatValidationError("Workers AI is unavailable.", "ai_binding_missing", 503);
  }
  const output = await env.AI.run(
    GROK_4_6_MODEL_ID,
    buildGrokProviderPayload(input, messages, { toolChoice }),
    { ...gatewayOptions(env, correlationId), signal }
  );
  if (!output || typeof output.getReader !== "function") {
    throw new OpenAiChatStreamError("Workers AI did not return a stream.", {
      code: "provider_stream_error",
      definitive: true,
    });
  }
  return output;
}

function safeProviderStateMessage(message) {
  if (message.role === "tool") {
    return { role: "tool", tool_call_id: message.tool_call_id, content: message.content };
  }
  return {
    role: "assistant",
    content: typeof message.content === "string" ? message.content : null,
    ...(Array.isArray(message.tool_calls) ? { tool_calls: message.tool_calls } : {}),
    ...(typeof message.reasoning_content === "string" && message.reasoning_content
      ? { reasoning_content: message.reasoning_content }
      : {}),
  };
}

function encodeSseEvent(event, data) {
  return ENCODER.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function terminalWitness(state, phase) {
  const elapsed = Math.max(0, Date.now() - state.startedAt);
  const bucket = (value) => {
    for (const threshold of [5_000, 30_000, 60_000, 120_000, 300_000, 900_000]) {
      if (value <= threshold) return `le_${threshold}`;
    }
    return "gt_900000";
  };
  return {
    termination_phase: phase,
    last_provider_event_type: state.done ? "message_stop" : state.started ? "message_delta" : "none",
    last_normalized_event_type: state.lastNormalizedEvent,
    message_start_seen: state.started,
    message_delta_seen: state.started,
    message_stop_seen: state.done,
    provider_ping_seen: false,
    content_block_count: state.rounds,
    stopped_content_block_count: state.done ? state.rounds : Math.max(0, state.rounds - 1),
    all_blocks_stopped: state.done,
    upstream_eof_seen: state.done,
    upstream_abort_seen: state.aborted,
    upstream_error_seen: state.error,
    downstream_cancel_seen: state.canceled,
    complete_internal_constructed: state.completeConstructed,
    complete_internal_emitted: state.completeEmitted,
    parser_error_code: state.errorCode,
    web_search_received_result_count: state.citations,
    web_search_accepted_result_count: state.citations,
    web_search_quarantined_invalid_url_count: 0,
    elapsed_ms_bucket: bucket(elapsed),
    final_idle_duration_ms_bucket: bucket(0),
    normalized_event_count_bucket: bucket(state.eventCount),
    streamed_byte_count_bucket: bucket(state.bytes),
  };
}

export function createInternalGrokChatStream(env, input, {
  correlationId = null,
} = {}) {
  let canceled = false;
  let providerAbortController = null;
  const state = {
    startedAt: Date.now(),
    started: false,
    done: false,
    aborted: false,
    error: false,
    canceled: false,
    errorCode: null,
    rounds: 0,
    citations: 0,
    bytes: 0,
    eventCount: 0,
    completeConstructed: false,
    completeEmitted: false,
    lastNormalizedEvent: "accepted",
  };
  return new ReadableStream({
    start(controller) {
      const enqueue = (event, data) => {
        if (canceled) return false;
        try {
          const encoded = encodeSseEvent(event, data);
          state.bytes += encoded.byteLength;
          state.eventCount += 1;
          state.lastNormalizedEvent = event;
          controller.enqueue(encoded);
          return true;
        } catch {
          canceled = true;
          state.canceled = true;
          return false;
        }
      };
      const emitWitness = (phase) => {
        if (!canceled) enqueue("terminal_witness", terminalWitness(state, phase));
      };
      enqueue("accepted", { ok: true });
      if (input.settings.webSearch.mode !== "off") enqueue("web_search_started", { ok: true });
      const processing = (async () => {
        const abortController = new AbortController();
        providerAbortController = abortController;
        if (canceled) abortController.abort("downstream_client_canceled");
        const timeoutId = setTimeout(() => {
          state.aborted = true;
          abortController.abort("generation_timeout");
        }, GROK_GENERATION_TIMEOUT_MS);
        let messages = [...input.messages];
        const providerStateMessages = [];
        let combinedUsage = null;
        let combinedReasoning = "";
        let totalToolCalls = 0;
        let finalResult = null;
        try {
          for (let round = 0; round <= GROK_MAX_TOOL_ROUNDS; round += 1) {
            state.rounds += 1;
            const stream = await runProviderRound(
              env,
              input,
              messages,
              correlationId,
              abortController.signal,
              round === 0 ? input.settings.toolChoice : "auto"
            );
            state.started = true;
            const result = await consumeOpenAiChatCompletionStream(stream, {
              onTextDelta: (text) => enqueue("text_delta", { text }),
              onReasoningDelta: (text) => enqueue("thinking_delta", { text }),
            });
            combinedUsage = addGrokUsage(combinedUsage, result.usage);
            combinedReasoning += result.reasoning;
            state.citations = result.citations.length;
            const assistantMessage = {
              role: "assistant",
              content: result.text || null,
              ...(result.toolCalls.length > 0 ? { tool_calls: result.toolCalls } : {}),
              ...(result.reasoning ? { reasoning_content: result.reasoning } : {}),
            };
            providerStateMessages.push(safeProviderStateMessage(assistantMessage));
            if (result.finishReason !== "tool_calls") {
              finalResult = result;
              break;
            }
            if (round >= GROK_MAX_TOOL_ROUNDS) {
              throw new OpenAiChatStreamError("The provider exceeded the tool continuation limit.", {
                code: "provider_tool_round_limit_exceeded",
                definitive: true,
              });
            }
            if (result.toolCalls.length > GROK_MAX_TOOL_CALLS_PER_ROUND
              || totalToolCalls + result.toolCalls.length > GROK_MAX_TOTAL_TOOL_CALLS) {
              throw new OpenAiChatStreamError("The provider exceeded the tool-call limit.", {
                code: "provider_tool_limit_exceeded",
                definitive: true,
              });
            }
            totalToolCalls += result.toolCalls.length;
            const toolResults = await Promise.all(result.toolCalls.map(executeGrokToolCall));
            const replayAssistant = {
              role: "assistant",
              content: result.text || null,
              tool_calls: result.toolCalls,
            };
            const toolMessages = toolResults.map((tool) => ({
              role: "tool",
              tool_call_id: tool.id,
              content: tool.content,
            }));
            messages = [...messages, replayAssistant, ...toolMessages];
            providerStateMessages.push(...toolMessages.map(safeProviderStateMessage));
          }
          if (!finalResult) {
            throw new OpenAiChatStreamError("The provider did not complete the model turn.", {
              code: "provider_tool_round_limit_exceeded",
              definitive: true,
            });
          }
          try {
            validateGrokStructuredOutput(finalResult.text, input.settings.responseFormat);
          } catch (error) {
            throw new OpenAiChatStreamError(error?.message || "Structured output is invalid.", {
              code: "provider_structured_output_invalid",
              definitive: true,
            });
          }
          state.done = true;
          state.completeConstructed = true;
          const providerState = {
            version: 1,
            formatVersion: GROK_PROVIDER_STATE_FORMAT_VERSION,
            messages: providerStateMessages,
            citations: finalResult.citations,
            outputFiles: finalResult.outputFiles,
            responseId: finalResult.responseId,
            systemFingerprint: finalResult.systemFingerprint,
            serviceTier: finalResult.serviceTier,
          };
          state.completeEmitted = enqueue("complete_internal", {
            text: finalResult.text.trim(),
            reasoningSummary: combinedReasoning || null,
            providerState,
            providerBlocks: null,
            sources: finalResult.citations,
            usage: combinedUsage,
            responseModel: finalResult.responseModel,
            stopReason: finalResult.finishReason === "length" ? "max_tokens" : finalResult.finishReason,
            stopSequence: null,
            webSearchRequestCount: input.settings.webSearch.mode === "off" ? 0 : 1,
            webSearchExecutedRequestCount: combinedUsage?.provider?.sources_used > 0 ? 1 : 0,
            webSearchResultCount: finalResult.citations.length > 0 ? 1 : 0,
            webSearchReceivedResultCount: finalResult.citations.length,
            webSearchAcceptedResultCount: finalResult.citations.length,
            webSearchQuarantinedInvalidUrlCount: 0,
            webFetchRequestCount: 0,
            webFetchResultCount: 0,
            webFetchErrorResultCount: 0,
            durationMs: Math.max(0, Date.now() - state.startedAt),
          });
          emitWitness("complete_internal");
        } catch (error) {
          state.error = true;
          state.errorCode = error?.code || (state.aborted
            ? "provider_stream_timeout"
            : "provider_stream_interrupted");
          emitWitness("provider_stream_error");
          enqueue("error", {
            code: state.errorCode,
            outcome: error?.definitive === true ? "failed" : "unknown",
          });
        } finally {
          clearTimeout(timeoutId);
          if (providerAbortController === abortController) providerAbortController = null;
          if (!canceled) controller.close();
        }
      })();
      void processing;
    },
    cancel() {
      canceled = true;
      state.canceled = true;
      providerAbortController?.abort("downstream_client_canceled");
    },
  });
}

export function mapGrokChatError(error) {
  if (error instanceof GrokChatValidationError) return error;
  if (error instanceof GrokToolError || error instanceof OpenAiChatStreamError) {
    return new GrokChatValidationError(
      "Grok chat could not complete the request.",
      error.code,
      error.definitive === true ? 502 : 503
    );
  }
  return new GrokChatValidationError("Grok chat is unavailable.", "provider_unavailable", 503);
}
