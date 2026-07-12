import {
  FABLE_CHAT_MAX_PROVIDER_BLOCKS_JSON_BYTES,
  FABLE_CHAT_MAX_TEXT_OUTPUT_BYTES,
  FABLE_CHAT_MAX_THINKING_SUMMARY_BYTES,
  FABLE_PROVIDER_STREAM_IDLE_TIMEOUT_MS,
} from "../../../shared/fable-chat-contract.mjs";

const ENCODER = new TextEncoder();
const INTERNAL_STREAM_MAX_BYTES = 8 * 1024 * 1024;
const INTERNAL_EVENT_MAX_BYTES = FABLE_CHAT_MAX_PROVIDER_BLOCKS_JSON_BYTES + (256 * 1024);

export class FableChatInternalStreamError extends Error {
  constructor(message, {
    code = "provider_stream_interrupted",
    outcome = "unknown",
    terminalWitness = null,
  } = {}) {
    super(message);
    this.name = "FableChatInternalStreamError";
    this.code = code;
    this.outcome = outcome === "failed" ? "failed" : "unknown";
    this.terminalWitness = terminalWitness;
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

async function readWithTimeout(reader, timeoutMs) {
  let timeoutId;
  try {
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new FableChatInternalStreamError(
          "The internal Fable stream was idle for too long.",
          { code: "provider_stream_idle_timeout" }
        )), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function* parseInternalEvents(stream, {
  onReadChunkBytes = null,
  onBodyEnded = null,
  onReadError = null,
} = {}) {
  if (!stream || typeof stream.getReader !== "function") {
    throw new FableChatInternalStreamError("The AI service did not return a stream.");
  }
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let totalBytes = 0;
  let eventName = "message";
  let dataLines = [];
  let lastValidActivityAt = Date.now();

  const markValidActivity = () => {
    lastValidActivityAt = Date.now();
  };

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
      const remainingIdleMs = Math.max(
        1,
        FABLE_PROVIDER_STREAM_IDLE_TIMEOUT_MS - (Date.now() - lastValidActivityAt)
      );
      const { value, done } = await readWithTimeout(reader, remainingIdleMs);
      if (done) {
        onBodyEnded?.();
        break;
      }
      const bytes = typeof value === "string" ? ENCODER.encode(value) : value;
      if (!(bytes instanceof Uint8Array)) {
        throw new FableChatInternalStreamError("The internal Fable stream chunk is invalid.");
      }
      totalBytes += bytes.byteLength;
      onReadChunkBytes?.(bytes.byteLength);
      if (totalBytes > INTERNAL_STREAM_MAX_BYTES) {
        throw new FableChatInternalStreamError("The internal Fable stream is too large.");
      }
      buffer += decoder.decode(bytes, { stream: true });
      while (true) {
        const parsed = takeLine(buffer);
        if (!parsed) break;
        buffer = parsed.rest;
        const event = processLine(parsed.line);
        if (event) yield { ...event, markValidActivity };
      }
    }
    buffer += decoder.decode();
    while (true) {
      const parsed = takeLine(buffer, true);
      if (!parsed) break;
      buffer = parsed.rest;
      const event = processLine(parsed.line);
      if (event) yield { ...event, markValidActivity };
    }
    const trailing = dispatch();
    if (trailing) yield { ...trailing, markValidActivity };
  } catch (error) {
    onReadError?.();
    if (error instanceof FableChatInternalStreamError) throw error;
    throw new FableChatInternalStreamError("The internal Fable stream was interrupted.");
  } finally {
    reader.releaseLock();
  }
}

const SAFE_INTERNAL_EVENTS = new Set([
  "none", "accepted", "keepalive", "web_search_started", "thinking_delta",
  "text_delta", "terminal_witness", "complete_internal", "error",
]);
const SAFE_TERMINATION_PHASES = new Set(["complete_internal", "provider_stream_error"]);
const SAFE_STREAM_ERROR_CODES = new Set([
  "provider_stream_interrupted", "provider_stream_idle_timeout", "provider_stream_timeout",
  "provider_stream_malformed", "provider_stream_error", "provider_web_search_limit_exceeded",
  "provider_web_search_limit_invalid", "provider_pause_turn_unavailable",
  "provider_pause_turn_limit_exceeded",
]);

function boundedBucket(value, thresholds) {
  const number = Math.max(0, Number(value) || 0);
  for (const threshold of thresholds) {
    if (number <= threshold) return `le_${threshold}`;
  }
  return `gt_${thresholds[thresholds.length - 1]}`;
}

function safeInternalEvent(value) {
  return SAFE_INTERNAL_EVENTS.has(value) ? value : "none";
}

function safeStreamErrorCode(value) {
  return SAFE_STREAM_ERROR_CODES.has(value) ? value : "provider_stream_interrupted";
}

function normalizeAiTerminalWitness(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const phase = SAFE_TERMINATION_PHASES.has(value.termination_phase)
    ? value.termination_phase
    : "provider_stream_error";
  const count = (entry) => Math.min(64, Math.max(0, Number.isInteger(entry) ? entry : 0));
  const bucket = (entry) => typeof entry === "string" && /^((le|gt)_\d+)$/.test(entry)
    ? entry.slice(0, 16)
    : "le_0";
  const event = (entry, allowed) => allowed.has(entry) ? entry : "none";
  return {
    termination_phase: phase,
    last_provider_event_type: event(value.last_provider_event_type, new Set([
      "none", "ping", "message_start", "content_block_start", "content_block_delta",
      "content_block_stop", "message_delta", "message_stop", "error",
    ])),
    last_normalized_event_type: safeInternalEvent(value.last_normalized_event_type),
    message_start_seen: value.message_start_seen === true,
    message_delta_seen: value.message_delta_seen === true,
    message_stop_seen: value.message_stop_seen === true,
    provider_ping_seen: value.provider_ping_seen === true,
    content_block_count: count(value.content_block_count),
    stopped_content_block_count: count(value.stopped_content_block_count),
    all_blocks_stopped: value.all_blocks_stopped === true,
    upstream_eof_seen: value.upstream_eof_seen === true,
    upstream_abort_seen: value.upstream_abort_seen === true,
    upstream_error_seen: value.upstream_error_seen === true,
    downstream_cancel_seen: value.downstream_cancel_seen === true,
    complete_internal_constructed: value.complete_internal_constructed === true,
    complete_internal_emitted: value.complete_internal_emitted === true,
    parser_error_code: value.parser_error_code == null ? null : safeStreamErrorCode(value.parser_error_code),
    elapsed_ms_bucket: bucket(value.elapsed_ms_bucket),
    final_idle_duration_ms_bucket: bucket(value.final_idle_duration_ms_bucket),
    normalized_event_count_bucket: bucket(value.normalized_event_count_bucket),
    streamed_byte_count_bucket: bucket(value.streamed_byte_count_bucket),
  };
}

function buildAuthTerminalWitness(state, {
  finalizationStarted = false,
  finalizationSucceeded = false,
  finalizationFailed = false,
  downstreamClientDisconnected = false,
  unknownClassificationReason = null,
} = {}) {
  const now = Date.now();
  return {
    last_internal_event_type: safeInternalEvent(state.lastInternalEventType),
    accepted_seen: state.accepted === true,
    complete_internal_seen: state.completeInternalSeen === true,
    error_event_seen: state.errorEventSeen === true,
    downstream_client_disconnected: downstreamClientDisconnected === true,
    ai_response_body_ended: state.aiResponseBodyEnded === true,
    ai_stream_read_error: state.aiStreamReadError === true,
    finalization_started: finalizationStarted === true,
    finalization_succeeded: finalizationSucceeded === true,
    finalization_failed: finalizationFailed === true,
    unknown_classification_reason: unknownClassificationReason
      ? safeStreamErrorCode(unknownClassificationReason)
      : null,
    elapsed_ms_bucket: boundedBucket(now - state.startedAt, [30_000, 60_000, 120_000, 180_000, 300_000]),
    final_idle_duration_ms_bucket: boundedBucket(now - state.lastInternalActivityAt, [5_000, 30_000, 60_000, 120_000, 300_000]),
  };
}

export async function consumeInternalFableChatStream(stream, callbacks = {}) {
  let accepted = false;
  let complete = null;
  let textBytes = 0;
  let thinkingBytes = 0;
  let aiTerminalWitness = null;
  const state = {
    startedAt: Date.now(),
    lastInternalActivityAt: Date.now(),
    lastInternalEventType: "none",
    accepted: false,
    completeInternalSeen: false,
    errorEventSeen: false,
    aiResponseBodyEnded: false,
    aiStreamReadError: false,
  };
  const markInternalActivity = (event, type) => {
    event.markValidActivity?.();
    state.lastInternalActivityAt = Date.now();
    state.lastInternalEventType = safeInternalEvent(type);
  };
  const withWitness = (error, options = {}) => {
    const wrapped = error instanceof FableChatInternalStreamError
      ? error
      : new FableChatInternalStreamError("The internal Fable stream was interrupted.");
    wrapped.terminalWitness = buildAuthTerminalWitness(state, options);
    wrapped.aiTerminalWitness = aiTerminalWitness;
    return wrapped;
  };

  try {
    for await (const { event, data, markValidActivity } of parseInternalEvents(stream, {
      onBodyEnded: () => { state.aiResponseBodyEnded = true; },
      onReadError: () => { state.aiStreamReadError = true; },
    })) {
      const internalEvent = { markValidActivity };
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new FableChatInternalStreamError("The internal Fable stream payload is invalid.");
      }
      if (event === "terminal_witness") {
        aiTerminalWitness = normalizeAiTerminalWitness(data);
        if (!aiTerminalWitness) {
          throw new FableChatInternalStreamError("The internal terminal witness is invalid.");
        }
        markInternalActivity(internalEvent, event);
        callbacks.onTerminalWitness?.(aiTerminalWitness);
        continue;
      }
      if (event === "accepted") {
        if (accepted) throw new FableChatInternalStreamError("The provider was accepted twice.");
        accepted = true;
        state.accepted = true;
        markInternalActivity(internalEvent, event);
        callbacks.onAccepted?.();
        continue;
      }
      if (event === "keepalive") {
        if (data.ok !== true) {
          throw new FableChatInternalStreamError("The internal keepalive event is invalid.");
        }
        markInternalActivity(internalEvent, event);
        callbacks.onKeepalive?.();
        continue;
      }
      if (event === "web_search_started") {
        if (!accepted || data.ok !== true) {
          throw new FableChatInternalStreamError("The internal web-search event is invalid.");
        }
        markInternalActivity(internalEvent, event);
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
          markInternalActivity(internalEvent, event);
          callbacks.onThinkingDelta?.(data.text);
        } else {
          textBytes += bytes;
          if (textBytes > FABLE_CHAT_MAX_TEXT_OUTPUT_BYTES) {
            throw new FableChatInternalStreamError("The assistant response is too large.");
          }
          markInternalActivity(internalEvent, event);
          callbacks.onTextDelta?.(data.text);
        }
        continue;
      }
      if (event === "complete_internal") {
        if (!accepted || complete) {
          throw new FableChatInternalStreamError("The internal Fable completion is out of order.");
        }
        complete = data;
        state.completeInternalSeen = true;
        markInternalActivity(internalEvent, event);
        continue;
      }
      if (event === "error") {
        state.errorEventSeen = true;
        markInternalActivity(internalEvent, event);
        throw new FableChatInternalStreamError("The provider stream failed.", {
          code: typeof data.code === "string" ? data.code : "provider_stream_interrupted",
          outcome: data.outcome,
        });
      }
      // Unknown normalized events are ignored and do not reset the idle timer.
    }
    if (!accepted || !complete) {
      throw new FableChatInternalStreamError("The provider stream ended without completion.");
    }
  } catch (error) {
    throw withWitness(error, {
      unknownClassificationReason: error?.code || "provider_stream_interrupted",
    });
  }
  return {
    ...complete,
    authTerminalWitness: buildAuthTerminalWitness(state),
    aiTerminalWitness,
  };
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
