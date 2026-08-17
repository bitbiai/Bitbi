import { isChatModelEnabled } from "../../../shared/chat-model-contract.mjs";
import { GROK_4_6_MODEL_ID } from "../../../shared/grok-chat-contract.mjs";
import { isRequestBodyError, readJsonBodyLimited } from "../../../../js/shared/request-body.mjs";
import { stripAiCallerPolicyFromBody } from "../../../shared/ai-caller-policy.mjs";
import {
  createInternalGrokChatStream,
  mapGrokChatError,
  validateGrokChatInput,
} from "../lib/grok-chat.js";
import { errorResponse } from "../lib/responses.js";
import {
  getDurationMs,
  getErrorFields,
  getRequestLogFields,
  logDiagnostic,
} from "../../../../js/shared/worker-observability.mjs";

const GROK_INTERNAL_BODY_MAX_BYTES = 24 * 1024 * 1024;

export async function handleChat({ request, env, correlationId, pathname, method }) {
  const startedAt = Date.now();
  try {
    const body = await readJsonBodyLimited(request, { maxBytes: GROK_INTERNAL_BODY_MAX_BYTES });
    const { body: chatBody } = stripAiCallerPolicyFromBody(body);
    const input = validateGrokChatInput(chatBody);
    if (!isChatModelEnabled(env, input.model)) {
      return errorResponse("This model is unavailable.", {
        status: 503,
        code: "chat_model_disabled",
      });
    }
    if (input.model !== GROK_4_6_MODEL_ID) {
      return errorResponse("This model is not supported by this route.", {
        status: 400,
        code: "validation_error",
      });
    }
    return new Response(createInternalGrokChatStream(env, input, { correlationId }), {
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
  } catch (rawError) {
    if (isRequestBodyError(rawError)) {
      return errorResponse(rawError.publicMessage || "Invalid request body.", {
        status: rawError.status,
        code: rawError.code,
      });
    }
    const error = mapGrokChatError(rawError);
    logDiagnostic({
      service: "bitbi-ai",
      component: "route-chat",
      event: "admin_chat_failed",
      level: "error",
      correlationId,
      duration_ms: getDurationMs(startedAt),
      ...getRequestLogFields({ request, pathname, method }),
      model_id: GROK_4_6_MODEL_ID,
      ...(rawError?.validationField ? {
        validation_field: rawError.validationField,
        validation_issue: rawError.validationIssue,
      } : {}),
      ...getErrorFields(error, { includeMessage: false }),
    });
    return errorResponse("Chat generation failed.", {
      status: error.status || 503,
      code: error.code || "provider_unavailable",
    });
  }
}

export { GROK_INTERNAL_BODY_MAX_BYTES };
