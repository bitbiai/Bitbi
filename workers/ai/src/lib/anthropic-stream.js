import {
  FABLE_CHAT_MAX_ASSISTANT_MESSAGE_CHARACTERS,
  FABLE_CHAT_GENERATION_TIMEOUT_MS,
  FABLE_CHAT_MAX_CITATIONS,
  FABLE_CHAT_MAX_CITATIONS_JSON_BYTES,
  FABLE_CHAT_MAX_PROVIDER_BLOCKS,
  FABLE_CHAT_MAX_PROVIDER_BLOCKS_JSON_BYTES,
  FABLE_CHAT_MAX_PROVIDER_EVENT_BYTES,
  FABLE_CHAT_MAX_PROVIDER_STREAM_BYTES,
  FABLE_CHAT_MAX_REASONING_SUMMARY_CHARACTERS,
  FABLE_CHAT_MAX_SEARCH_QUERY_CHARACTERS,
  FABLE_CHAT_MAX_SEARCH_RESULT_ENCRYPTED_CONTENT_BYTES,
  FABLE_CHAT_MAX_SEARCH_RESULT_ERROR_CODE_CHARACTERS,
  FABLE_CHAT_MAX_SEARCH_RESULT_TITLE_CHARACTERS,
  FABLE_CHAT_MAX_SOURCE_TITLE_CHARACTERS,
  FABLE_CHAT_MAX_SOURCE_URL_CHARACTERS,
  FABLE_CHAT_MAX_TEXT_OUTPUT_BYTES,
  FABLE_CHAT_MAX_THINKING_SIGNATURE_BYTES,
  FABLE_CHAT_MAX_THINKING_SUMMARY_BYTES,
  FABLE_CHAT_MAX_WEB_SEARCH_RESULTS,
  FABLE_CHAT_STREAM_IDLE_TIMEOUT_MS,
  FABLE_CHAT_WEB_SEARCH_MAX_USES,
  FABLE_CHAT_WEB_SEARCH_TOOL_NAME,
} from "../../../shared/fable-chat-contract.mjs";

const ENCODER = new TextEncoder();
const SAFE_STOP_REASON = /^[a-z_]{1,80}$/;
const SAFE_MODEL = /^[A-Za-z0-9._:/-]{1,160}$/;
const UNSAFE_CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const TOOL_ID_PATTERN = /^srvtoolu_[A-Za-z0-9_-]{8,160}$/;
const SEARCH_ERROR_CODES = new Set([
  "too_many_requests", "invalid_tool_input", "max_uses_exceeded",
  "query_too_long", "request_too_large", "unavailable",
]);

export class AnthropicStreamError extends Error {
  constructor(message, { code = "provider_stream_interrupted", definitive = false } = {}) {
    super(message);
    this.name = "AnthropicStreamError";
    this.code = code;
    this.definitive = definitive;
  }
}

function byteLength(value) {
  return ENCODER.encode(String(value || "")).byteLength;
}

function safeText(value, { maxCharacters, maxBytes, allowEmpty = true } = {}) {
  if (typeof value !== "string") throw new AnthropicStreamError("Provider text is invalid.");
  if ((!allowEmpty && !value) || value.length > maxCharacters || byteLength(value) > maxBytes) {
    throw new AnthropicStreamError("Provider text exceeds its safe limit.");
  }
  if (UNSAFE_CONTROL_PATTERN.test(value)) {
    throw new AnthropicStreamError("Provider text contains unsupported control characters.");
  }
  return value;
}

function onlyFields(value, allowed) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function safeHttpsUrl(value) {
  const url = safeText(value, {
    maxCharacters: FABLE_CHAT_MAX_SOURCE_URL_CHARACTERS,
    maxBytes: FABLE_CHAT_MAX_SOURCE_URL_CHARACTERS * 4,
    allowEmpty: false,
  });
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new AnthropicStreamError("Provider citation URL is invalid.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new AnthropicStreamError("Provider citation URL is invalid.");
  }
  return url;
}

function safeToolId(value) {
  const id = safeText(value, { maxCharacters: 180, maxBytes: 720, allowEmpty: false });
  if (!TOOL_ID_PATTERN.test(id)) throw new AnthropicStreamError("Provider tool id is invalid.");
  return id;
}

function sanitizeCitation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !onlyFields(value, ["type", "url", "title", "encrypted_index", "cited_text"])
    || value.type !== "web_search_result_location") {
    throw new AnthropicStreamError("Provider citation is invalid.");
  }
  return {
    type: "web_search_result_location",
    url: safeHttpsUrl(value.url),
    title: safeText(value.title, {
      maxCharacters: FABLE_CHAT_MAX_SEARCH_RESULT_TITLE_CHARACTERS,
      maxBytes: FABLE_CHAT_MAX_SEARCH_RESULT_TITLE_CHARACTERS * 4,
    }),
    encrypted_index: safeText(value.encrypted_index, {
      maxCharacters: FABLE_CHAT_MAX_SEARCH_RESULT_ENCRYPTED_CONTENT_BYTES,
      maxBytes: FABLE_CHAT_MAX_SEARCH_RESULT_ENCRYPTED_CONTENT_BYTES,
      allowEmpty: false,
    }),
    cited_text: safeText(value.cited_text, { maxCharacters: 2_048, maxBytes: 8_192 }),
  };
}

function sanitizeCitations(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > FABLE_CHAT_MAX_CITATIONS) {
    throw new AnthropicStreamError("Provider citations are invalid.");
  }
  return value.map(sanitizeCitation);
}

function sanitizeSearchResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !onlyFields(value, ["type", "url", "title", "encrypted_content", "page_age"])
    || value.type !== "web_search_result") {
    throw new AnthropicStreamError("Provider search result is invalid.");
  }
  return {
    type: "web_search_result",
    url: safeHttpsUrl(value.url),
    title: safeText(value.title, {
      maxCharacters: FABLE_CHAT_MAX_SEARCH_RESULT_TITLE_CHARACTERS,
      maxBytes: FABLE_CHAT_MAX_SEARCH_RESULT_TITLE_CHARACTERS * 4,
    }),
    encrypted_content: safeText(value.encrypted_content, {
      maxCharacters: FABLE_CHAT_MAX_SEARCH_RESULT_ENCRYPTED_CONTENT_BYTES,
      maxBytes: FABLE_CHAT_MAX_SEARCH_RESULT_ENCRYPTED_CONTENT_BYTES,
      allowEmpty: false,
    }),
    page_age: value.page_age == null
      ? null
      : safeText(value.page_age, { maxCharacters: 160, maxBytes: 640 }),
  };
}

function sanitizeSearchResultContent(value) {
  if (Array.isArray(value)) {
    if (value.length > FABLE_CHAT_MAX_WEB_SEARCH_RESULTS) {
      throw new AnthropicStreamError("Provider search results exceed their safe limit.");
    }
    return value.map(sanitizeSearchResult);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !onlyFields(value, ["type", "error_code"])) {
    throw new AnthropicStreamError("Provider search result error is invalid.");
  }
  const errorCode = safeText(value.error_code, {
    maxCharacters: FABLE_CHAT_MAX_SEARCH_RESULT_ERROR_CODE_CHARACTERS,
    maxBytes: FABLE_CHAT_MAX_SEARCH_RESULT_ERROR_CODE_CHARACTERS,
    allowEmpty: false,
  });
  if (value.type !== "web_search_tool_result_error" || !SEARCH_ERROR_CODES.has(errorCode)) {
    throw new AnthropicStreamError("Provider search result error is invalid.");
  }
  return { type: "web_search_tool_result_error", error_code: errorCode };
}

function sanitizeServerToolUse(value) {
  if (!onlyFields(value, ["type", "id", "name", "input"])
    || value.name !== FABLE_CHAT_WEB_SEARCH_TOOL_NAME
    || !value.input || typeof value.input !== "object" || Array.isArray(value.input)
    || !onlyFields(value.input, ["query"])) {
    throw new AnthropicStreamError("Provider server tool use is invalid.");
  }
  return {
    type: "server_tool_use",
    id: safeToolId(value.id),
    name: FABLE_CHAT_WEB_SEARCH_TOOL_NAME,
    input: {
      query: safeText(value.input.query, {
        maxCharacters: FABLE_CHAT_MAX_SEARCH_QUERY_CHARACTERS,
        maxBytes: FABLE_CHAT_MAX_SEARCH_QUERY_CHARACTERS * 4,
        allowEmpty: false,
      }),
    },
  };
}

function sanitizeSearchToolResult(value) {
  if (!onlyFields(value, ["type", "tool_use_id", "content", "caller"])) {
    throw new AnthropicStreamError("Provider search result block is invalid.");
  }
  let caller;
  if (value.caller !== undefined) {
    if (!value.caller || typeof value.caller !== "object" || Array.isArray(value.caller)
      || !onlyFields(value.caller, ["type"]) || value.caller.type !== "direct") {
      throw new AnthropicStreamError("Provider search result caller is invalid.");
    }
    caller = { type: "direct" };
  }
  return {
    type: "web_search_tool_result",
    tool_use_id: safeToolId(value.tool_use_id),
    content: sanitizeSearchResultContent(value.content),
    ...(caller ? { caller } : {}),
  };
}

export function sanitizeAnthropicUsage(usage) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  const safe = {};
  for (const key of [
    "input_tokens",
    "output_tokens",
    "cache_read_input_tokens",
    "cache_creation_input_tokens",
  ]) {
    const value = Number(usage[key]);
    if (Number.isFinite(value) && value >= 0) safe[key] = Math.floor(value);
  }
  const thinkingTokens = Number(usage?.output_tokens_details?.thinking_tokens);
  if (Number.isFinite(thinkingTokens) && thinkingTokens >= 0) {
    safe.output_tokens_details = { thinking_tokens: Math.floor(thinkingTokens) };
  }
  const searchRequests = Number(usage?.server_tool_use?.web_search_requests);
  if (Number.isFinite(searchRequests) && searchRequests >= 0) {
    safe.server_tool_use = { web_search_requests: Math.min(1, Math.floor(searchRequests)) };
  }
  return Object.keys(safe).length > 0 ? safe : null;
}

function mergeUsage(current, next) {
  const sanitized = sanitizeAnthropicUsage(next);
  if (!sanitized) return current;
  return {
    ...(current || {}),
    ...sanitized,
    ...(sanitized.output_tokens_details
      ? { output_tokens_details: sanitized.output_tokens_details }
      : {}),
    ...(sanitized.server_tool_use ? { server_tool_use: sanitized.server_tool_use } : {}),
  };
}

export function sanitizeAnthropicContentBlocks(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > FABLE_CHAT_MAX_PROVIDER_BLOCKS) {
    throw new AnthropicStreamError("Provider content blocks are invalid.");
  }
  const blocks = value.map((block) => {
    if (!block || typeof block !== "object" || Array.isArray(block)) {
      throw new AnthropicStreamError("Provider content block is invalid.");
    }
    if (block.type === "text") {
      if (!onlyFields(block, ["type", "text", "citations"])) {
        throw new AnthropicStreamError("Provider text block is invalid.");
      }
      return {
        type: "text",
        text: safeText(block.text, {
          maxCharacters: FABLE_CHAT_MAX_ASSISTANT_MESSAGE_CHARACTERS,
          maxBytes: FABLE_CHAT_MAX_TEXT_OUTPUT_BYTES,
        }),
        ...(block.citations === undefined ? {} : { citations: sanitizeCitations(block.citations) }),
      };
    }
    if (block.type === "thinking") {
      return {
        type: "thinking",
        thinking: safeText(block.thinking, {
          maxCharacters: FABLE_CHAT_MAX_REASONING_SUMMARY_CHARACTERS,
          maxBytes: FABLE_CHAT_MAX_THINKING_SUMMARY_BYTES,
        }),
        signature: safeText(block.signature, {
          maxCharacters: FABLE_CHAT_MAX_THINKING_SIGNATURE_BYTES,
          maxBytes: FABLE_CHAT_MAX_THINKING_SIGNATURE_BYTES,
          allowEmpty: false,
        }),
      };
    }
    if (block.type === "server_tool_use") return sanitizeServerToolUse(block);
    if (block.type === "web_search_tool_result") return sanitizeSearchToolResult(block);
    throw new AnthropicStreamError("Provider content block type is unsupported.");
  });
  const citationCount = blocks.reduce((total, block) => total + (block.citations?.length || 0), 0);
  if (citationCount > FABLE_CHAT_MAX_CITATIONS) {
    throw new AnthropicStreamError("Provider citations exceed their safe limit.");
  }
  if (byteLength(JSON.stringify(blocks)) > FABLE_CHAT_MAX_PROVIDER_BLOCKS_JSON_BYTES) {
    throw new AnthropicStreamError("Provider content blocks exceed their safe limit.");
  }
  return blocks;
}

function extractSafeSources(blocks) {
  const sources = new Map();
  for (const block of blocks) {
    if (block.type !== "text") continue;
    for (const citation of block.citations || []) {
      if (!sources.has(citation.url)) {
        sources.set(citation.url, {
          url: citation.url,
          title: citation.title.slice(0, FABLE_CHAT_MAX_SOURCE_TITLE_CHARACTERS),
          type: citation.type,
        });
      }
      if (sources.size >= FABLE_CHAT_MAX_CITATIONS) break;
    }
    if (sources.size >= FABLE_CHAT_MAX_CITATIONS) break;
  }
  const value = [...sources.values()];
  if (byteLength(JSON.stringify(value)) > FABLE_CHAT_MAX_CITATIONS_JSON_BYTES) {
    throw new AnthropicStreamError("Provider citations exceed their safe limit.");
  }
  return value;
}

function countSearchBlocks(blocks, {
  allowIncomplete = false,
  allowOrphanResults = false,
} = {}) {
  const requests = blocks.filter((block) => block.type === "server_tool_use");
  const requestIds = new Set(requests.map((block) => block.id));
  const results = blocks.filter((block) => block.type === "web_search_tool_result");
  const resultIds = new Set(results.map((block) => block.tool_use_id));
  if (
    requestIds.size !== requests.length
    || resultIds.size !== results.length
    || (!allowOrphanResults && results.some((block) => !requestIds.has(block.tool_use_id)))
    || (!allowIncomplete && !allowOrphanResults && requests.length !== results.length)
  ) {
    throw new AnthropicStreamError("Provider web-search blocks are inconsistent.", {
      code: "provider_web_search_blocks_invalid",
      definitive: true,
    });
  }
  if (requests.length > FABLE_CHAT_WEB_SEARCH_MAX_USES || results.length > FABLE_CHAT_WEB_SEARCH_MAX_USES) {
    throw new AnthropicStreamError("Provider exceeded the web-search limit.", {
      code: "provider_web_search_limit_exceeded",
      definitive: true,
    });
  }
  return { requestCount: requests.length, resultCount: results.length };
}

export function extractAnthropicVisibleResult(content, {
  allowMissingText = false,
  allowOrphanSearchResults = false,
} = {}) {
  const blocks = sanitizeAnthropicContentBlocks(content);
  const text = blocks
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n\n")
    .trim();
  if (!text && !allowMissingText) throw new AnthropicStreamError("Provider returned no text output.");
  const reasoningSummary = blocks
    .filter((block) => block.type === "thinking" && block.thinking)
    .map((block) => block.thinking)
    .join("\n\n")
    .trim() || null;
  const search = countSearchBlocks(blocks, {
    allowIncomplete: allowMissingText,
    allowOrphanResults: allowOrphanSearchResults,
  });
  return {
    text,
    reasoningSummary,
    providerBlocks: blocks,
    sources: extractSafeSources(blocks),
    webSearchRequestCount: search.requestCount,
    webSearchResultCount: search.resultCount,
  };
}

function takeSseLine(buffer, final = false) {
  for (let index = 0; index < buffer.length; index += 1) {
    const character = buffer[index];
    if (character === "\n") {
      const line = index > 0 && buffer[index - 1] === "\r"
        ? buffer.slice(0, index - 1)
        : buffer.slice(0, index);
      return { line, rest: buffer.slice(index + 1) };
    }
    if (character === "\r") {
      if (index + 1 >= buffer.length && !final) return null;
      const consume = buffer[index + 1] === "\n" ? 2 : 1;
      return { line: buffer.slice(0, index), rest: buffer.slice(index + consume) };
    }
  }
  if (final && buffer) return { line: buffer, rest: "" };
  return null;
}

async function readWithIdleTimeout(reader, timeoutMs, timeoutCode = "provider_stream_idle_timeout") {
  let timeoutId;
  try {
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new AnthropicStreamError(
          "Provider stream was idle for too long.",
          { code: timeoutCode }
        )), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function* parseSseJsonEvents(stream, {
  maxStreamBytes = FABLE_CHAT_MAX_PROVIDER_STREAM_BYTES,
  maxEventBytes = FABLE_CHAT_MAX_PROVIDER_EVENT_BYTES,
  idleTimeoutMs = FABLE_CHAT_STREAM_IDLE_TIMEOUT_MS,
  maxDurationMs = FABLE_CHAT_GENERATION_TIMEOUT_MS,
} = {}) {
  if (!stream || typeof stream.getReader !== "function") {
    throw new AnthropicStreamError("Provider did not return a readable stream.");
  }
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let textBuffer = "";
  let totalBytes = 0;
  let eventName = "message";
  let dataLines = [];
  const deadline = Date.now() + Math.max(1, Number(maxDurationMs) || FABLE_CHAT_GENERATION_TIMEOUT_MS);
  let streamCompleted = false;

  const dispatch = () => {
    if (dataLines.length === 0) {
      eventName = "message";
      return null;
    }
    const data = dataLines.join("\n");
    dataLines = [];
    const dispatchedName = eventName;
    eventName = "message";
    if (byteLength(data) > maxEventBytes) {
      throw new AnthropicStreamError("Provider stream event is too large.");
    }
    if (data === "[DONE]") return { event: dispatchedName, data: null, done: true };
    try {
      return { event: dispatchedName, data: JSON.parse(data), done: false };
    } catch {
      throw new AnthropicStreamError("Provider stream event is malformed.");
    }
  };

  const processLine = (line) => {
    if (line === "") return dispatch();
    if (line.startsWith(":")) return null;
    const separator = line.indexOf(":");
    const field = separator < 0 ? line : line.slice(0, separator);
    let value = separator < 0 ? "" : line.slice(separator + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") eventName = value || "message";
    if (field === "data") dataLines.push(value);
    return null;
  };

  try {
    while (true) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new AnthropicStreamError("Provider stream exceeded its generation deadline.", {
          code: "provider_stream_timeout",
        });
      }
      const waitMs = Math.min(idleTimeoutMs, remainingMs);
      const { value, done } = await readWithIdleTimeout(
        reader,
        waitMs,
        remainingMs <= idleTimeoutMs ? "provider_stream_timeout" : "provider_stream_idle_timeout"
      );
      if (done) {
        streamCompleted = true;
        break;
      }
      const bytes = typeof value === "string" ? ENCODER.encode(value) : value;
      if (!(bytes instanceof Uint8Array)) {
        throw new AnthropicStreamError("Provider stream chunk is invalid.");
      }
      totalBytes += bytes.byteLength;
      if (totalBytes > maxStreamBytes) {
        throw new AnthropicStreamError("Provider stream exceeds its safe limit.");
      }
      textBuffer += decoder.decode(bytes, { stream: true });
      while (true) {
        const parsed = takeSseLine(textBuffer);
        if (!parsed) break;
        textBuffer = parsed.rest;
        const event = processLine(parsed.line);
        if (event) yield event;
      }
    }
    textBuffer += decoder.decode();
    while (true) {
      const parsed = takeSseLine(textBuffer, true);
      if (!parsed) break;
      textBuffer = parsed.rest;
      const event = processLine(parsed.line);
      if (event) yield event;
    }
    const trailing = dispatch();
    if (trailing) yield trailing;
  } catch (error) {
    if (error instanceof AnthropicStreamError) throw error;
    throw new AnthropicStreamError("Provider stream was interrupted.");
  } finally {
    if (!streamCompleted) {
      try {
        await reader.cancel();
      } catch {
        // The provider stream is already closed or interrupted.
      }
    }
    reader.releaseLock();
  }
}

export async function consumeAnthropicMessageStream(stream, callbacks = {}, {
  allowOrphanSearchResults = false,
} = {}) {
  const blocks = new Map();
  const stoppedBlocks = new Set();
  let responseModel = null;
  let usage = null;
  let stopReason = null;
  let stopSequence = null;
  let sawMessageStart = false;
  let sawMessageStop = false;
  let accumulatedTextBytes = 0;
  let accumulatedTextCharacters = 0;
  let accumulatedThinkingBytes = 0;
  let accumulatedThinkingCharacters = 0;

  const accountVisibleDelta = (type, delta) => {
    const bytes = byteLength(delta);
    if (type === "text") {
      accumulatedTextBytes += bytes;
      accumulatedTextCharacters += delta.length;
      if (
        accumulatedTextBytes > FABLE_CHAT_MAX_TEXT_OUTPUT_BYTES
        || accumulatedTextCharacters > FABLE_CHAT_MAX_ASSISTANT_MESSAGE_CHARACTERS
      ) {
        throw new AnthropicStreamError("Provider text output exceeds its safe limit.");
      }
      return;
    }
    accumulatedThinkingBytes += bytes;
    accumulatedThinkingCharacters += delta.length;
    if (
      accumulatedThinkingBytes > FABLE_CHAT_MAX_THINKING_SUMMARY_BYTES
      || accumulatedThinkingCharacters > FABLE_CHAT_MAX_REASONING_SUMMARY_CHARACTERS
    ) {
      throw new AnthropicStreamError("Provider thinking summary exceeds its safe limit.");
    }
  };

  const append = (block, field, delta, byteLimit, characterLimit) => {
    const next = `${block[field]}${delta}`;
    if (next.length > characterLimit || byteLength(next) > byteLimit) {
      throw new AnthropicStreamError("Provider output exceeds its safe limit.");
    }
    block[field] = next;
  };

  for await (const event of parseSseJsonEvents(stream)) {
    if (event.done) continue;
    const value = event.data;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new AnthropicStreamError("Provider stream event is invalid.");
    }
    const type = String(value.type || event.event || "");
    if (type === "ping") {
      callbacks.onKeepalive?.();
      continue;
    }
    if (type === "error") {
      throw new AnthropicStreamError("Provider returned a definitive stream error.", {
        code: "provider_stream_error",
        definitive: true,
      });
    }
    if (type === "message_start") {
      if (sawMessageStart || sawMessageStop || blocks.size > 0) {
        throw new AnthropicStreamError("Provider stream started out of order.");
      }
      sawMessageStart = true;
      const model = value.message?.model;
      responseModel = typeof model === "string" && SAFE_MODEL.test(model) ? model : null;
      usage = mergeUsage(usage, value.message?.usage);
      continue;
    }
    if (type === "content_block_start") {
      if (!sawMessageStart || sawMessageStop) {
        throw new AnthropicStreamError("Provider content block started out of order.");
      }
      const index = Number(value.index);
      if (!Number.isInteger(index) || index < 0 || index >= FABLE_CHAT_MAX_PROVIDER_BLOCKS || blocks.has(index)) {
        throw new AnthropicStreamError("Provider content block index is invalid.");
      }
      const source = value.content_block;
      if (source?.type === "text") {
        const text = safeText(source.text || "", {
          maxCharacters: FABLE_CHAT_MAX_ASSISTANT_MESSAGE_CHARACTERS,
          maxBytes: FABLE_CHAT_MAX_TEXT_OUTPUT_BYTES,
        });
        accountVisibleDelta("text", text);
        blocks.set(index, {
          type: "text",
          text,
          ...(source.citations === undefined ? {} : { citations: sanitizeCitations(source.citations) }),
        });
        if (text) callbacks.onTextDelta?.(text);
      } else if (source?.type === "thinking") {
        const thinking = safeText(source.thinking || "", {
          maxCharacters: FABLE_CHAT_MAX_REASONING_SUMMARY_CHARACTERS,
          maxBytes: FABLE_CHAT_MAX_THINKING_SUMMARY_BYTES,
        });
        accountVisibleDelta("thinking", thinking);
        blocks.set(index, {
          type: "thinking",
          thinking,
          signature: safeText(source.signature || "", {
            maxCharacters: FABLE_CHAT_MAX_THINKING_SIGNATURE_BYTES,
            maxBytes: FABLE_CHAT_MAX_THINKING_SIGNATURE_BYTES,
          }),
        });
        if (thinking) callbacks.onThinkingDelta?.(thinking);
      } else if (source?.type === "server_tool_use") {
        if (!onlyFields(source, ["type", "id", "name", "input"])
          || source.name !== FABLE_CHAT_WEB_SEARCH_TOOL_NAME) {
          throw new AnthropicStreamError("Provider server tool block is invalid.");
        }
        const input = source.input === undefined ? {} : source.input;
        if (!input || typeof input !== "object" || Array.isArray(input)) {
          throw new AnthropicStreamError("Provider server tool input is invalid.");
        }
        const initialJson = Object.keys(input).length > 0 ? JSON.stringify(input) : "";
        if (byteLength(initialJson) > FABLE_CHAT_MAX_SEARCH_QUERY_CHARACTERS * 4) {
          throw new AnthropicStreamError("Provider server tool input is too large.");
        }
        blocks.set(index, {
          type: "server_tool_use",
          id: safeToolId(source.id),
          name: FABLE_CHAT_WEB_SEARCH_TOOL_NAME,
          inputJson: initialJson,
        });
        const started = [...blocks.values()].filter((block) => block.type === "server_tool_use").length;
        if (started > FABLE_CHAT_WEB_SEARCH_MAX_USES) {
          throw new AnthropicStreamError("Provider exceeded the web-search limit.", {
            code: "provider_web_search_limit_exceeded",
            definitive: true,
          });
        }
        callbacks.onWebSearchStarted?.();
      } else if (source?.type === "web_search_tool_result") {
        const result = sanitizeSearchToolResult(source);
        blocks.set(index, result);
        const results = [...blocks.values()].filter((block) => block.type === "web_search_tool_result").length;
        if (results > FABLE_CHAT_WEB_SEARCH_MAX_USES) {
          throw new AnthropicStreamError("Provider exceeded the web-search limit.", {
            code: "provider_web_search_limit_exceeded",
            definitive: true,
          });
        }
      } else {
        throw new AnthropicStreamError("Provider content block type is unsupported.");
      }
      continue;
    }
    if (type === "content_block_delta") {
      if (!sawMessageStart || sawMessageStop) {
        throw new AnthropicStreamError("Provider content block delta is out of order.");
      }
      const index = Number(value.index);
      const block = blocks.get(index);
      if (!block || stoppedBlocks.has(index)) {
        throw new AnthropicStreamError("Provider content block delta is out of order.");
      }
      const delta = value.delta;
      if (delta?.type === "text_delta" && block.type === "text") {
        const text = safeText(delta.text, {
          maxCharacters: FABLE_CHAT_MAX_ASSISTANT_MESSAGE_CHARACTERS,
          maxBytes: FABLE_CHAT_MAX_TEXT_OUTPUT_BYTES,
        });
        accountVisibleDelta("text", text);
        append(
          block,
          "text",
          text,
          FABLE_CHAT_MAX_TEXT_OUTPUT_BYTES,
          FABLE_CHAT_MAX_ASSISTANT_MESSAGE_CHARACTERS
        );
        callbacks.onTextDelta?.(text);
      } else if (delta?.type === "thinking_delta" && block.type === "thinking") {
        const thinking = safeText(delta.thinking, {
          maxCharacters: FABLE_CHAT_MAX_REASONING_SUMMARY_CHARACTERS,
          maxBytes: FABLE_CHAT_MAX_THINKING_SUMMARY_BYTES,
        });
        accountVisibleDelta("thinking", thinking);
        append(
          block,
          "thinking",
          thinking,
          FABLE_CHAT_MAX_THINKING_SUMMARY_BYTES,
          FABLE_CHAT_MAX_REASONING_SUMMARY_CHARACTERS
        );
        callbacks.onThinkingDelta?.(thinking);
      } else if (delta?.type === "signature_delta" && block.type === "thinking") {
        const signature = safeText(delta.signature, {
          maxCharacters: FABLE_CHAT_MAX_THINKING_SIGNATURE_BYTES,
          maxBytes: FABLE_CHAT_MAX_THINKING_SIGNATURE_BYTES,
        });
        append(
          block,
          "signature",
          signature,
          FABLE_CHAT_MAX_THINKING_SIGNATURE_BYTES,
          FABLE_CHAT_MAX_THINKING_SIGNATURE_BYTES
        );
      } else if (delta?.type === "input_json_delta" && block.type === "server_tool_use") {
        const partial = safeText(delta.partial_json, {
          maxCharacters: FABLE_CHAT_MAX_SEARCH_QUERY_CHARACTERS * 4,
          maxBytes: FABLE_CHAT_MAX_SEARCH_QUERY_CHARACTERS * 4,
        });
        append(
          block,
          "inputJson",
          partial,
          FABLE_CHAT_MAX_SEARCH_QUERY_CHARACTERS * 4,
          FABLE_CHAT_MAX_SEARCH_QUERY_CHARACTERS * 4
        );
      } else if (delta?.type === "citations_delta" && block.type === "text") {
        const citation = sanitizeCitation(delta.citation);
        block.citations = [...(block.citations || []), citation];
        if (block.citations.length > FABLE_CHAT_MAX_CITATIONS) {
          throw new AnthropicStreamError("Provider citations exceed their safe limit.");
        }
      } else {
        throw new AnthropicStreamError("Provider content block delta is invalid.");
      }
      continue;
    }
    if (type === "content_block_stop") {
      if (!sawMessageStart || sawMessageStop) {
        throw new AnthropicStreamError("Provider content block stop is out of order.");
      }
      const index = Number(value.index);
      if (!blocks.has(index) || stoppedBlocks.has(index)) {
        throw new AnthropicStreamError("Provider content block stop is out of order.");
      }
      const block = blocks.get(index);
      if (block.type === "server_tool_use") {
        let input;
        try {
          input = JSON.parse(block.inputJson || "{}");
        } catch {
          throw new AnthropicStreamError("Provider server tool input is malformed.", {
            code: "provider_stream_malformed",
            definitive: true,
          });
        }
        blocks.set(index, sanitizeServerToolUse({
          type: block.type,
          id: block.id,
          name: block.name,
          input,
        }));
      }
      stoppedBlocks.add(index);
      continue;
    }
    if (type === "message_delta") {
      if (!sawMessageStart || sawMessageStop) {
        throw new AnthropicStreamError("Provider message delta is out of order.");
      }
      const reason = value.delta?.stop_reason;
      stopReason = typeof reason === "string" && SAFE_STOP_REASON.test(reason) ? reason : null;
      const sequence = value.delta?.stop_sequence;
      stopSequence = typeof sequence === "string" ? sequence.slice(0, 160) : null;
      usage = mergeUsage(usage, value.usage);
      continue;
    }
    if (type === "message_stop") {
      if (!sawMessageStart || sawMessageStop || stoppedBlocks.size !== blocks.size) {
        throw new AnthropicStreamError("Provider message stop is out of order.");
      }
      sawMessageStop = true;
      continue;
    }
    // Unknown provider events are ignored only after their JSON and size have been validated.
  }

  if (!sawMessageStart || !sawMessageStop || blocks.size === 0 || stoppedBlocks.size !== blocks.size) {
    throw new AnthropicStreamError("Provider stream ended without a definitive completion.");
  }
  const orderedBlocks = [...blocks.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, block]) => block);
  const visible = extractAnthropicVisibleResult(orderedBlocks, {
    allowMissingText: stopReason === "pause_turn",
    allowOrphanSearchResults,
  });
  return {
    ...visible,
    usage,
    responseModel,
    stopReason,
    stopSequence,
  };
}

export function encodeSseEvent(event, data) {
  return ENCODER.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function sumUsage(left, right) {
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
  if (Number.isFinite(aSearch) || Number.isFinite(bSearch)) {
    output.server_tool_use = {
      web_search_requests: Math.min(1,
        Math.max(0, Math.floor(Number.isFinite(aSearch) ? aSearch : 0))
        + Math.max(0, Math.floor(Number.isFinite(bSearch) ? bSearch : 0))),
    };
  }
  return Object.keys(output).length > 0 ? output : null;
}

export function createInternalFableChatStream(providerStream, {
  startedAt = Date.now(),
  continueAfterPause = null,
} = {}) {
  let canceled = false;
  return new ReadableStream({
    start(controller) {
      const enqueue = (event, data) => {
        if (canceled) return;
        try {
          controller.enqueue(encodeSseEvent(event, data));
        } catch {
          canceled = true;
        }
      };
      enqueue("accepted", { ok: true });
      const callbacks = {
        onThinkingDelta: (text) => enqueue("thinking_delta", { text }),
        onTextDelta: (text) => enqueue("text_delta", { text }),
        onWebSearchStarted: () => enqueue("web_search_started", { ok: true }),
        onKeepalive: () => enqueue("keepalive", { ok: true }),
      };
      void consumeAnthropicMessageStream(providerStream, callbacks).then(async (initial) => {
        let result = initial;
        if (initial.stopReason === "pause_turn") {
          if (typeof continueAfterPause !== "function") {
            throw new AnthropicStreamError("Provider paused without a continuation path.", {
              code: "provider_pause_turn_unavailable",
            });
          }
          const continuationStream = await continueAfterPause(initial.providerBlocks);
          const continuation = await consumeAnthropicMessageStream(continuationStream, callbacks, {
            allowOrphanSearchResults: true,
          });
          if (continuation.stopReason === "pause_turn") {
            throw new AnthropicStreamError("Provider exceeded the continuation limit.", {
              code: "provider_pause_turn_limit_exceeded",
            });
          }
          const combined = extractAnthropicVisibleResult([
            ...initial.providerBlocks,
            ...continuation.providerBlocks,
          ]);
          result = {
            ...continuation,
            ...combined,
            usage: sumUsage(initial.usage, continuation.usage),
            responseModel: continuation.responseModel || initial.responseModel,
          };
        }
        enqueue("complete_internal", {
          ...result,
          durationMs: Math.max(0, Date.now() - startedAt),
        });
        if (!canceled) controller.close();
      }).catch((error) => {
        enqueue("error", {
          code: error?.code || "provider_stream_interrupted",
          outcome: error?.definitive === true ? "failed" : "unknown",
        });
        if (!canceled) controller.close();
      });
    },
    cancel() {
      canceled = true;
    },
  });
}
