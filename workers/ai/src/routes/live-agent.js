import { errorResponse, fromError } from "../lib/responses.js";
import { readJsonBody } from "../lib/validate.js";

const GEMMA_MODEL = "@cf/google/gemma-4-26b-a4b-it";
const MAX_MESSAGES = 40;
const MAX_SYSTEM_LENGTH = 1200;
const MAX_MESSAGE_LENGTH = 4000;

function validateMessages(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw Object.assign(new Error("JSON body must be an object."), { status: 400, name: "ValidationError", code: "bad_request" });
  }

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    throw Object.assign(new Error("messages must be a non-empty array."), { status: 400, name: "ValidationError", code: "validation_error" });
  }

  if (messages.length > MAX_MESSAGES) {
    throw Object.assign(new Error(`messages must contain at most ${MAX_MESSAGES} items.`), { status: 400, name: "ValidationError", code: "validation_error" });
  }

  const validated = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
      throw Object.assign(new Error(`messages[${i}] must be an object.`), { status: 400, name: "ValidationError", code: "validation_error" });
    }

    const role = msg.role;
    if (role !== "system" && role !== "user" && role !== "assistant") {
      throw Object.assign(new Error(`messages[${i}].role must be "system", "user", or "assistant".`), { status: 400, name: "ValidationError", code: "validation_error" });
    }

    if (typeof msg.content !== "string") {
      throw Object.assign(new Error(`messages[${i}].content must be a string.`), { status: 400, name: "ValidationError", code: "validation_error" });
    }

    const maxLen = role === "system" ? MAX_SYSTEM_LENGTH : MAX_MESSAGE_LENGTH;
    const trimmed = msg.content.trim();
    if (!trimmed) {
      throw Object.assign(new Error(`messages[${i}].content must not be empty.`), { status: 400, name: "ValidationError", code: "validation_error" });
    }
    if (trimmed.length > maxLen) {
      throw Object.assign(new Error(`messages[${i}].content must be at most ${maxLen} characters.`), { status: 400, name: "ValidationError", code: "validation_error" });
    }

    validated.push({ role, content: trimmed });
  }

  // Must have at least one user message
  if (!validated.some((m) => m.role === "user")) {
    throw Object.assign(new Error("messages must include at least one user message."), { status: 400, name: "ValidationError", code: "validation_error" });
  }

  return validated;
}

function ensureAI(env) {
  if (!env?.AI || typeof env.AI.run !== "function") {
    const error = new Error("Workers AI binding is not configured.");
    error.status = 503;
    throw error;
  }
}

export async function handleLiveAgent({ request, env }) {
  try {
    const body = await readJsonBody(request);
    if (!body) {
      return errorResponse("Invalid JSON body.", { status: 400, code: "bad_request" });
    }

    const messages = validateMessages(body);
    ensureAI(env);

    const startedAt = Date.now();
    const stream = await env.AI.run(GEMMA_MODEL, { messages, stream: true });
    const elapsedMs = Date.now() - startedAt;

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "x-bitbi-model": GEMMA_MODEL,
        "x-bitbi-elapsed-ms": String(elapsedMs),
      },
    });
  } catch (error) {
    console.error("AI lab live-agent route failed", error);
    return fromError(error, "Live agent request failed");
  }
}
