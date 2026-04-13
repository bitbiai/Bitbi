import {
  ADMIN_AI_LIVE_AGENT_MODEL,
  validateAdminAiLiveAgentBody,
} from "../../../../js/shared/admin-ai-contract.mjs";
import { errorResponse, fromError } from "../lib/responses.js";
import { readJsonBody } from "../lib/validate.js";

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

    const { messages } = validateAdminAiLiveAgentBody(body);
    ensureAI(env);

    const startedAt = Date.now();
    const stream = await env.AI.run(ADMIN_AI_LIVE_AGENT_MODEL.id, { messages, stream: true });
    const elapsedMs = Date.now() - startedAt;

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "x-bitbi-model": ADMIN_AI_LIVE_AGENT_MODEL.id,
        "x-bitbi-elapsed-ms": String(elapsedMs),
      },
    });
  } catch (error) {
    console.error("AI lab live-agent route failed", error);
    return fromError(error, "Live agent request failed");
  }
}
