import {
  GROK_MAX_CITATIONS,
  GROK_MAX_PROVIDER_EVENT_BYTES,
  GROK_MAX_PROVIDER_STREAM_BYTES,
  GROK_MAX_TOOL_ARGUMENT_BYTES,
  GROK_STREAM_IDLE_TIMEOUT_MS,
} from "../../../shared/grok-chat-contract.mjs";

const ENCODER = new TextEncoder();
const TOOL_CALL_ID_PATTERN = /^(?:call-|call_)[A-Za-z0-9_-]{1,180}$/;
const TOOL_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const FINISH_REASONS = new Set([
  "stop", "length", "tool_calls", "content_filter", "function_call",
]);

export class OpenAiChatStreamError extends Error {
  constructor(message, {
    code = "provider_stream_interrupted",
    definitive = false,
  } = {}) {
    super(message);
    this.name = "OpenAiChatStreamError";
    this.code = code;
    this.definitive = definitive;
  }
}

function byteLength(value) {
  return ENCODER.encode(String(value || "")).byteLength;
}

function takeLine(buffer, final = false) {
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] === "\n") {
      return {
        line: index > 0 && buffer[index - 1] === "\r"
          ? buffer.slice(0, index - 1)
          : buffer.slice(0, index),
        rest: buffer.slice(index + 1),
      };
    }
    if (buffer[index] === "\r") {
      if (index + 1 >= buffer.length && !final) return null;
      return {
        line: buffer.slice(0, index),
        rest: buffer.slice(index + (buffer[index + 1] === "\n" ? 2 : 1)),
      };
    }
  }
  if (final && buffer) return { line: buffer, rest: "" };
  return null;
}

async function readWithIdleTimeout(reader, timeoutMs) {
  let timeoutId;
  try {
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new OpenAiChatStreamError(
          "The provider stream was idle for too long.",
          { code: "provider_stream_idle_timeout" }
        )), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function* parseSseData(stream) {
  if (!stream || typeof stream.getReader !== "function") {
    throw new OpenAiChatStreamError("The provider did not return a readable stream.", {
      code: "provider_stream_error",
      definitive: true,
    });
  }
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let totalBytes = 0;
  let dataLines = [];
  let lastActivityAt = Date.now();
  const dispatch = () => {
    if (dataLines.length === 0) return null;
    const data = dataLines.join("\n");
    dataLines = [];
    if (byteLength(data) > GROK_MAX_PROVIDER_EVENT_BYTES) {
      throw new OpenAiChatStreamError("The provider event is too large.", {
        code: "provider_stream_malformed",
      });
    }
    return data;
  };
  const processLine = (line) => {
    if (!line) return dispatch();
    if (line.startsWith(":")) return null;
    const split = line.indexOf(":");
    const field = split < 0 ? line : line.slice(0, split);
    let value = split < 0 ? "" : line.slice(split + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") dataLines.push(value);
    return null;
  };
  try {
    while (true) {
      const remaining = Math.max(1, GROK_STREAM_IDLE_TIMEOUT_MS - (Date.now() - lastActivityAt));
      let read;
      try {
        read = await readWithIdleTimeout(reader, remaining);
      } catch (error) {
        if (error instanceof OpenAiChatStreamError) throw error;
        throw new OpenAiChatStreamError("The provider stream read failed.", {
          code: "provider_stream_interrupted",
        });
      }
      if (read.done) break;
      const bytes = typeof read.value === "string" ? ENCODER.encode(read.value) : read.value;
      if (!(bytes instanceof Uint8Array)) {
        throw new OpenAiChatStreamError("The provider stream chunk is invalid.", {
          code: "provider_stream_malformed",
        });
      }
      if (bytes.byteLength > 0) lastActivityAt = Date.now();
      totalBytes += bytes.byteLength;
      if (totalBytes > GROK_MAX_PROVIDER_STREAM_BYTES) {
        throw new OpenAiChatStreamError("The provider stream is too large.", {
          code: "provider_stream_malformed",
        });
      }
      try {
        buffer += decoder.decode(bytes, { stream: true });
      } catch {
        throw new OpenAiChatStreamError("The provider stream contains invalid Unicode.", {
          code: "provider_unicode_decode_failure",
        });
      }
      while (true) {
        const parsed = takeLine(buffer);
        if (!parsed) break;
        buffer = parsed.rest;
        const data = processLine(parsed.line);
        if (data != null) {
          lastActivityAt = Date.now();
          yield data;
        }
      }
    }
    try {
      buffer += decoder.decode();
    } catch {
      throw new OpenAiChatStreamError("The provider stream contains invalid Unicode.", {
        code: "provider_unicode_decode_failure",
      });
    }
    while (true) {
      const parsed = takeLine(buffer, true);
      if (!parsed) break;
      buffer = parsed.rest;
      const data = processLine(parsed.line);
      if (data != null) yield data;
    }
    const trailing = dispatch();
    if (trailing != null) yield trailing;
  } finally {
    reader.releaseLock();
  }
}

function normalizeHttpsCitation(value) {
  const rawUrl = typeof value === "string"
    ? value
    : value?.url || value?.canonical_url || value?.source_url;
  const rawTitle = typeof value === "string"
    ? "Source"
    : value?.title || value?.name || value?.source || "Source";
  if (typeof rawUrl !== "string" || rawUrl.length > 2_048) return null;
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hostname.length > 253) return null;
  const title = String(rawTitle || "Source").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 256)
    || "Source";
  return { title, url: url.href, source: url.hostname.toLowerCase() };
}

export function normalizeGrokCitations(value) {
  if (!Array.isArray(value)) return [];
  const output = [];
  const seen = new Set();
  for (const entry of value) {
    const citation = normalizeHttpsCitation(entry);
    if (!citation || seen.has(citation.url)) continue;
    seen.add(citation.url);
    output.push(citation);
    if (output.length >= GROK_MAX_CITATIONS) break;
  }
  return output;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

export function normalizeGrokUsage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const promptTokens = nonNegativeInteger(value.prompt_tokens);
  const completionTokens = nonNegativeInteger(value.completion_tokens);
  const totalTokens = nonNegativeInteger(value.total_tokens);
  const cachedTokens = nonNegativeInteger(value.prompt_tokens_details?.cached_tokens);
  const imageTokens = nonNegativeInteger(value.prompt_tokens_details?.image_tokens);
  const reasoningTokens = nonNegativeInteger(value.completion_tokens_details?.reasoning_tokens);
  const sourcesUsed = nonNegativeInteger(value.num_sources_used);
  const costTicks = value.cost_in_usd_ticks;
  const normalizedCostTicks = (typeof costTicks === "string" && /^\d{1,40}$/.test(costTicks))
    ? costTicks
    : (Number.isSafeInteger(costTicks) && costTicks >= 0 ? String(costTicks) : null);
  return {
    input_tokens: promptTokens,
    output_tokens: completionTokens,
    cache_read_input_tokens: cachedTokens,
    output_tokens_details: { thinking_tokens: reasoningTokens },
    provider: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
      cached_tokens: cachedTokens,
      image_tokens: imageTokens,
      reasoning_tokens: reasoningTokens,
      sources_used: sourcesUsed,
      ...(normalizedCostTicks == null ? {} : { cost_in_usd_ticks: normalizedCostTicks }),
    },
  };
}

export function addGrokUsage(left, right) {
  if (!left) return right || null;
  if (!right) return left;
  const provider = {};
  for (const key of [
    "prompt_tokens", "completion_tokens", "total_tokens", "cached_tokens", "image_tokens",
    "reasoning_tokens", "sources_used",
  ]) {
    provider[key] = nonNegativeInteger(left.provider?.[key]) + nonNegativeInteger(right.provider?.[key]);
  }
  const leftTicks = left.provider?.cost_in_usd_ticks;
  const rightTicks = right.provider?.cost_in_usd_ticks;
  if (/^\d+$/.test(leftTicks || "") && /^\d+$/.test(rightTicks || "")) {
    try {
      provider.cost_in_usd_ticks = (BigInt(leftTicks) + BigInt(rightTicks)).toString();
    } catch {
      // Raw provider ticks remain absent if the exact integer sum cannot be represented safely.
    }
  }
  return {
    input_tokens: provider.prompt_tokens,
    output_tokens: provider.completion_tokens,
    cache_read_input_tokens: provider.cached_tokens,
    output_tokens_details: { thinking_tokens: provider.reasoning_tokens },
    provider,
  };
}

function appendToolCallFragments(state, fragments) {
  if (!Array.isArray(fragments)) {
    throw new OpenAiChatStreamError("The provider tool-call delta is invalid.", {
      code: "provider_stream_malformed",
    });
  }
  for (const fragment of fragments) {
    if (!fragment || typeof fragment !== "object" || Array.isArray(fragment)) {
      throw new OpenAiChatStreamError("The provider tool-call delta is invalid.", {
        code: "provider_stream_malformed",
      });
    }
    const index = Number(fragment.index);
    if (!Number.isInteger(index) || index < 0 || index >= 128) {
      throw new OpenAiChatStreamError("The provider tool-call index is invalid.", {
        code: "provider_stream_malformed",
      });
    }
    const current = state.get(index) || { index, id: "", type: "function", name: "", arguments: "" };
    if (fragment.id != null) current.id += String(fragment.id);
    if (fragment.type != null && fragment.type !== "function") {
      throw new OpenAiChatStreamError("The provider tool-call type is unsupported.", {
        code: "provider_tool_invalid",
        definitive: true,
      });
    }
    if (fragment.function?.name != null) current.name += String(fragment.function.name);
    if (fragment.function?.arguments != null) current.arguments += String(fragment.function.arguments);
    if (byteLength(current.arguments) > GROK_MAX_TOOL_ARGUMENT_BYTES) {
      throw new OpenAiChatStreamError("The provider tool arguments are too large.", {
        code: "provider_tool_arguments_invalid",
        definitive: true,
      });
    }
    state.set(index, current);
  }
}

function finalizeToolCalls(state) {
  return [...state.values()].sort((a, b) => a.index - b.index).map((entry) => {
    if (!TOOL_CALL_ID_PATTERN.test(entry.id) || !TOOL_NAME_PATTERN.test(entry.name) || !entry.arguments) {
      throw new OpenAiChatStreamError("The provider returned an invalid tool call.", {
        code: "provider_tool_invalid",
        definitive: true,
      });
    }
    return {
      id: entry.id,
      type: "function",
      function: { name: entry.name, arguments: entry.arguments },
    };
  });
}

function sanitizeOutputFiles(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 16).map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const id = String(entry.id || entry.file_id || "").trim();
    const name = String(entry.name || entry.filename || "").trim();
    if (!/^[A-Za-z0-9_-]{1,180}$/.test(id)) return null;
    return {
      id,
      ...(name && name.length <= 256 && !/[\u0000-\u001f\u007f/\\]/.test(name) ? { name } : {}),
    };
  }).filter(Boolean);
}

export async function consumeOpenAiChatCompletionStream(stream, callbacks = {}) {
  let text = "";
  let reasoning = "";
  let finishReason = null;
  let responseModel = null;
  let responseId = null;
  let systemFingerprint = null;
  let serviceTier = "default";
  let usage = null;
  let citations = [];
  let outputFiles = [];
  let doneSeen = false;
  let dataSeen = false;
  const toolCallState = new Map();
  for await (const raw of parseSseData(stream)) {
    if (raw === "[DONE]") {
      doneSeen = true;
      break;
    }
    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      throw new OpenAiChatStreamError("The provider stream contains malformed JSON.", {
        code: "provider_stream_malformed",
      });
    }
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      throw new OpenAiChatStreamError("The provider event is invalid.", {
        code: "provider_stream_malformed",
      });
    }
    dataSeen = true;
    if (event.error) {
      throw new OpenAiChatStreamError("The provider returned an error event.", {
        code: "provider_stream_error",
        definitive: true,
      });
    }
    if (event.id != null) responseId = String(event.id).slice(0, 180);
    if (event.model != null) responseModel = String(event.model).slice(0, 160);
    if (event.system_fingerprint != null) {
      systemFingerprint = String(event.system_fingerprint).slice(0, 180);
    }
    if (event.service_tier === "default" || event.service_tier === "priority") {
      serviceTier = event.service_tier;
    }
    if (event.usage != null) usage = normalizeGrokUsage(event.usage);
    if (event.citations != null) citations = normalizeGrokCitations(event.citations);
    if (event.output_files != null) outputFiles = sanitizeOutputFiles(event.output_files);
    if (!Array.isArray(event.choices)) {
      throw new OpenAiChatStreamError("The provider choices are invalid.", {
        code: "provider_stream_malformed",
      });
    }
    if (event.choices.length === 0) continue;
    if (event.choices.length !== 1 || Number(event.choices[0]?.index) !== 0) {
      throw new OpenAiChatStreamError("The provider returned unsupported multiple choices.", {
        code: "provider_stream_malformed",
        definitive: true,
      });
    }
    const choice = event.choices[0];
    const delta = choice.delta || choice.message || {};
    if (!delta || typeof delta !== "object" || Array.isArray(delta)) {
      throw new OpenAiChatStreamError("The provider delta is invalid.", {
        code: "provider_stream_malformed",
      });
    }
    if (delta.content != null) {
      if (typeof delta.content !== "string") {
        throw new OpenAiChatStreamError("The provider content delta is invalid.", {
          code: "provider_stream_malformed",
        });
      }
      text += delta.content;
      callbacks.onTextDelta?.(delta.content);
    }
    if (delta.reasoning_content != null) {
      if (typeof delta.reasoning_content !== "string") {
        throw new OpenAiChatStreamError("The provider reasoning delta is invalid.", {
          code: "provider_stream_malformed",
        });
      }
      reasoning += delta.reasoning_content;
      callbacks.onReasoningDelta?.(delta.reasoning_content);
    }
    if (delta.tool_calls != null) appendToolCallFragments(toolCallState, delta.tool_calls);
    if (choice.finish_reason != null) {
      if (!FINISH_REASONS.has(choice.finish_reason) || finishReason) {
        throw new OpenAiChatStreamError("The provider finish reason is invalid.", {
          code: "provider_stream_malformed",
        });
      }
      finishReason = choice.finish_reason;
    }
  }
  if (!doneSeen) {
    throw new OpenAiChatStreamError("The provider stream ended before [DONE].", {
      code: "provider_upstream_eof_before_message_stop",
    });
  }
  if (!dataSeen || !finishReason) {
    throw new OpenAiChatStreamError("The provider stream ended without a terminal choice.", {
      code: "provider_stream_malformed",
    });
  }
  const toolCalls = finalizeToolCalls(toolCallState);
  if (finishReason === "tool_calls" && toolCalls.length === 0) {
    throw new OpenAiChatStreamError("The provider omitted required tool calls.", {
      code: "provider_tool_invalid",
      definitive: true,
    });
  }
  if (finishReason !== "tool_calls" && toolCalls.length > 0) {
    throw new OpenAiChatStreamError("The provider returned unfinished tool calls.", {
      code: "provider_tool_invalid",
      definitive: true,
    });
  }
  if (finishReason !== "tool_calls" && !text.trim()) {
    throw new OpenAiChatStreamError("The provider returned an empty response.", {
      code: "provider_empty_response",
      definitive: true,
    });
  }
  if (!usage) {
    throw new OpenAiChatStreamError("The provider omitted final usage.", {
      code: "provider_usage_missing",
    });
  }
  return {
    text,
    reasoning,
    toolCalls,
    finishReason,
    responseModel,
    responseId,
    systemFingerprint,
    serviceTier,
    usage,
    citations,
    outputFiles,
  };
}
