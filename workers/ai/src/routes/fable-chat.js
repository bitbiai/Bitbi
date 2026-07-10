import { CLAUDE_FABLE_5_MODEL_ID } from "../../../../js/shared/admin-ai-contract.mjs";
import { invokeText } from "../lib/invoke-ai.js";
import { getModelSummary, resolveModelSelection } from "../lib/model-registry.js";
import { errorResponse, fromError, ok } from "../lib/responses.js";
import { readJsonBody, validateFableChatBody } from "../lib/validate.js";
import {
  getDurationMs,
  getErrorFields,
  getRequestLogFields,
  logDiagnostic,
} from "../../../../js/shared/worker-observability.mjs";

export async function handleFableChat({ request, env, correlationId, pathname, method }) {
  const startedAt = Date.now();
  try {
    const body = await readJsonBody(request);
    if (!body) {
      return errorResponse("Invalid JSON body.", { status: 400, code: "bad_request" });
    }

    const input = validateFableChatBody(body);
    const selection = resolveModelSelection("text", { model: CLAUDE_FABLE_5_MODEL_ID });
    const output = await invokeText(env, selection.model, {
      ...input,
      correlationId,
      gatewaySurface: "van-ark-fable-chat",
      skipGatewayCache: true,
      collectGatewayLog: false,
    });

    return ok({
      task: "fable-chat",
      model: getModelSummary(selection.model),
      result: {
        text: output.text,
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
