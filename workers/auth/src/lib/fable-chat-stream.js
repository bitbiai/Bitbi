import {
  FABLE_CHAT_MAX_PROVIDER_BLOCKS_JSON_BYTES,
  FABLE_CHAT_MAX_TEXT_OUTPUT_BYTES,
  FABLE_CHAT_MAX_THINKING_SUMMARY_BYTES,
  FABLE_CHAT_STREAM_IDLE_TIMEOUT_MS,
} from "../../../shared/fable-chat-contract.mjs";

const ENCODER = new TextEncoder();
const INTERNAL_STREAM_MAX_BYTES = 8 * 1024 * 1024;
const INTERNAL_EVENT_MAX_BYTES = FABLE_CHAT_MAX_PROVIDER_BLOCKS_JSON_BYTES + (256 * 1024);

export class FableChatInternalStreamError extends Error {
  constructor(message, { code = "provider_stream_interrupted", outcome = "unknown" } = {}) {
    super(message);
    this.name = "FableChatInternalStreamError";
    this.code = code;
    this.outcome = outcome === "failed" ? "failed" : "unknown";
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
      const consume = buffer[index + 1] === "\n" ? 2 : 1;
      return { line: buffer.slice(0, index), rest: buffer.slice(index + consume) };
    }
  }
  if (final && buffer) return { line: buffer, rest: "" };
  return null;
}

async function readWithTimeout(reader) {
  let timeoutId;
  try {
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new FableChatInternalStreamError(
          "The internal Fable stream was idle for too long.",
          { code: "provider_stream_idle_timeout" }
        )), FABLE_CHAT_STREAM_IDLE_TIMEOUT_MS + 30_000);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function* parseInternalEvents(stream) {
  if (!stream || typeof stream.getReader !== "function") {
    throw new FableChatInternalStreamError("The AI service did not return a stream.");
  }
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let totalBytes = 0;
  let eventName = "message";
  let dataLines = [];

  const dispatch = () => {
    if (dataLines.length === 0) {
      eventName = "message";
      return null;
    }
    const raw = dataLines.join("\n");
    dataLines = [];
    const event = eventName;
    eventName = "message";
    if (byteLength(raw) > INTERNAL_EVENT_MAX_BYTES) {
      throw new FableChatInternalStreamError("The internal Fable stream event is too large.");
    }
    try {
      return { event, data: JSON.parse(raw) };
    } catch {
      throw new FableChatInternalStreamError("The internal Fable stream event is malformed.");
    }
  };
  const processLine = (line) => {
    if (!line) return dispatch();
    if (line.startsWith(":")) return null;
    const split = line.indexOf(":");
    const field = split < 0 ? line : line.slice(0, split);
    let value = split < 0 ? "" : line.slice(split + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") eventName = value || "message";
    if (field === "data") dataLines.push(value);
    return null;
  };

  try {
    while (true) {
      const { value, done } = await readWithTimeout(reader);
      if (done) break;
      const bytes = typeof value === "string" ? ENCODER.encode(value) : value;
      if (!(bytes instanceof Uint8Array)) {
        throw new FableChatInternalStreamError("The internal Fable stream chunk is invalid.");
      }
      totalBytes += bytes.byteLength;
      if (totalBytes > INTERNAL_STREAM_MAX_BYTES) {
        throw new FableChatInternalStreamError("The internal Fable stream is too large.");
      }
      buffer += decoder.decode(bytes, { stream: true });
      while (true) {
        const parsed = takeLine(buffer);
        if (!parsed) break;
        buffer = parsed.rest;
        const event = processLine(parsed.line);
        if (event) yield event;
      }
    }
    buffer += decoder.decode();
    while (true) {
      const parsed = takeLine(buffer, true);
      if (!parsed) break;
      buffer = parsed.rest;
      const event = processLine(parsed.line);
      if (event) yield event;
    }
    const trailing = dispatch();
    if (trailing) yield trailing;
  } catch (error) {
    if (error instanceof FableChatInternalStreamError) throw error;
    throw new FableChatInternalStreamError("The internal Fable stream was interrupted.");
  } finally {
    reader.releaseLock();
  }
}

export async function consumeInternalFableChatStream(stream, callbacks = {}) {
  let accepted = false;
  let complete = null;
  let textBytes = 0;
  let thinkingBytes = 0;
  for await (const { event, data } of parseInternalEvents(stream)) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new FableChatInternalStreamError("The internal Fable stream payload is invalid.");
    }
    if (event === "accepted") {
      if (accepted) throw new FableChatInternalStreamError("The provider was accepted twice.");
      accepted = true;
      callbacks.onAccepted?.();
      continue;
    }
    if (event === "keepalive") {
      callbacks.onKeepalive?.();
      continue;
    }
    if (event === "web_search_started") {
      if (!accepted || data.ok !== true) {
        throw new FableChatInternalStreamError("The internal web-search event is invalid.");
      }
      callbacks.onWebSearchStarted?.();
      continue;
    }
    if (event === "thinking_delta" || event === "text_delta") {
      if (!accepted || typeof data.text !== "string") {
        throw new FableChatInternalStreamError("The internal Fable delta is invalid.");
      }
      const bytes = byteLength(data.text);
      if (event === "thinking_delta") {
        thinkingBytes += bytes;
        if (thinkingBytes > FABLE_CHAT_MAX_THINKING_SUMMARY_BYTES) {
          throw new FableChatInternalStreamError("The thinking summary is too large.");
        }
        callbacks.onThinkingDelta?.(data.text);
      } else {
        textBytes += bytes;
        if (textBytes > FABLE_CHAT_MAX_TEXT_OUTPUT_BYTES) {
          throw new FableChatInternalStreamError("The assistant response is too large.");
        }
        callbacks.onTextDelta?.(data.text);
      }
      continue;
    }
    if (event === "complete_internal") {
      if (!accepted || complete) {
        throw new FableChatInternalStreamError("The internal Fable completion is out of order.");
      }
      complete = data;
      continue;
    }
    if (event === "error") {
      throw new FableChatInternalStreamError("The provider stream failed.", {
        code: typeof data.code === "string" ? data.code : "provider_stream_interrupted",
        outcome: data.outcome,
      });
    }
    // Unknown normalized events are ignored after bounded JSON parsing.
  }
  if (!accepted || !complete) {
    throw new FableChatInternalStreamError("The provider stream ended without completion.");
  }
  return complete;
}

export function encodeFableChatBrowserEvent(event, data) {
  return ENCODER.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function fableChatStreamResponse(stream) {
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "CDN-Cache-Control": "no-store",
      "Cloudflare-CDN-Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
