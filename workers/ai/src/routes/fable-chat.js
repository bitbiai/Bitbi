import { CLAUDE_FABLE_5_MODEL_ID } from "../../../../js/shared/admin-ai-contract.mjs";
import { invokeFableChatStream, invokeText } from "../lib/invoke-ai.js";
import { createInternalFableChatStream } from "../lib/anthropic-stream.js";
import { getModelSummary, resolveModelSelection } from "../lib/model-registry.js";
import { errorResponse, fromError, ok } from "../lib/responses.js";
import { readFableChatJsonBody, validateFableChatBody } from "../lib/validate.js";
import { FABLE_CHAT_GENERATION_TIMEOUT_MS } from "../../../shared/fable-chat-contract.mjs";
import {
  getDurationMs,
  getErrorFields,
  getRequestLogFields,
  logDiagnostic,
} from "../../../../js/shared/worker-observability.mjs";

export async function handleFableChat({ request, env, correlationId, pathname, method }) {
  const startedAt = Date.now();
  try {
    const body = await readFableChatJsonBody(request);
    if (!body) {
      return errorResponse("Invalid JSON body.", { status: 400, code: "bad_request" });
    }

    const input = validateFableChatBody(body);
    const selection = resolveModelSelection("text", { model: CLAUDE_FABLE_5_MODEL_ID });
    const invocationInput = {
      ...input,
      correlationId,
      gatewaySurface: "van-ark-fable-chat",
      skipGatewayCache: true,
      collectGatewayLog: false,
    };

    if (pathname === "/internal/ai/fable-chat/stream") {
      const output = await invokeFableChatStream(env, selection.model, invocationInput);
      return new Response(createInternalFableChatStream(output.stream, {
        startedAt: output.startedAt,
        continueAfterPause: output.continueAfterPause,
        maxWebSearchUses: input.webSearchMaxUses,
      }), {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Accel-Buffering": "no",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    const output = await invokeText(env, selection.model, {
      ...invocationInput,
      generationTimeoutMs: FABLE_CHAT_GENERATION_TIMEOUT_MS,
      preserveAnthropicContent: true,
    });

    return ok({
      task: "fable-chat",
      model: getModelSummary(selection.model),
      result: {
        text: output.text,
        providerBlocks: output.providerBlocks,
        reasoningSummary: output.reasoningSummary,
        sources: output.sources,
        webSearchRequestCount: output.webSearchRequestCount,
        webSearchResultCount: output.webSearchResultCount,
        usage: output.usage,
        maxTokens: input.maxTokens,
        ...(output.responseModel ? { responseModel: output.responseModel } : {}),
        ...(output.stopReason ? { stopReason: output.stopReason } : {}),
        ...(output.stopSequence ? { stopSequence: output.stopSequence } : {}),
        ...(output.stopDetails ? { stopDetails: output.stopDetails } : {}),
        ...(output.gatewayMetadata ? { gatewayMetadata: output.gatewayMetadata } : {}),
      },
      elapsedMs: output.elapsedMs,
    });
  } catch (error) {
    logDiagnostic({
      service: "bitbi-ai",
      component: "route-fable-chat",
      event: "admin_fable_chat_failed",
      level: "error",
      correlationId,
      duration_ms: getDurationMs(startedAt),
      ...getRequestLogFields({ request, pathname, method }),
      ...getErrorFields(error, { includeMessage: false }),
    });
    return fromError(error, "Fable chat generation failed");
  }
}
