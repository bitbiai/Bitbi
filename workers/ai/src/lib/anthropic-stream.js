import {
  FABLE_CHAT_MAX_ASSISTANT_MESSAGE_CHARACTERS,
  FABLE_CHAT_GENERATION_TIMEOUT_MS,
  FABLE_CHAT_MAX_PROVIDER_BLOCKS,
  FABLE_CHAT_MAX_PROVIDER_BLOCKS_JSON_BYTES,
  FABLE_CHAT_MAX_PROVIDER_EVENT_BYTES,
  FABLE_CHAT_MAX_PROVIDER_STREAM_BYTES,
  FABLE_CHAT_MAX_REASONING_SUMMARY_CHARACTERS,
  FABLE_CHAT_MAX_TEXT_OUTPUT_BYTES,
  FABLE_CHAT_MAX_THINKING_SIGNATURE_BYTES,
  FABLE_CHAT_MAX_THINKING_SUMMARY_BYTES,
  FABLE_CHAT_STREAM_IDLE_TIMEOUT_MS,
} from "../../../shared/fable-chat-contract.mjs";

const ENCODER = new TextEncoder();
const SAFE_STOP_REASON = /^[a-z_]{1,80}$/;
const SAFE_MODEL = /^[A-Za-z0-9._:/-]{1,160}$/;
const UNSAFE_CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

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
      return {
        type: "text",
        text: safeText(block.text, {
          maxCharacters: FABLE_CHAT_MAX_ASSISTANT_MESSAGE_CHARACTERS,
          maxBytes: FABLE_CHAT_MAX_TEXT_OUTPUT_BYTES,
        }),
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
    throw new AnthropicStreamError("Provider content block type is unsupported.");
  });
  if (byteLength(JSON.stringify(blocks)) > FABLE_CHAT_MAX_PROVIDER_BLOCKS_JSON_BYTES) {
    throw new AnthropicStreamError("Provider content blocks exceed their safe limit.");
  }
  return blocks;
}

export function extractAnthropicVisibleResult(content) {
  const blocks = sanitizeAnthropicContentBlocks(content);
  const text = blocks
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n\n")
    .trim();
  if (!text) throw new AnthropicStreamError("Provider returned no text output.");
  const reasoningSummary = blocks
    .filter((block) => block.type === "thinking" && block.thinking)
    .map((block) => block.thinking)
    .join("\n\n")
    .trim() || null;
  return { text, reasoningSummary, providerBlocks: blocks };
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

export async function consumeAnthropicMessageStream(stream, callbacks = {}) {
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
        blocks.set(index, { type: "text", text });
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
  const visible = extractAnthropicVisibleResult(orderedBlocks);
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

export function createInternalFableChatStream(providerStream, { startedAt = Date.now() } = {}) {
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
      void consumeAnthropicMessageStream(providerStream, {
        onThinkingDelta: (text) => enqueue("thinking_delta", { text }),
        onTextDelta: (text) => enqueue("text_delta", { text }),
        onKeepalive: () => enqueue("keepalive", { ok: true }),
      }).then((result) => {
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
