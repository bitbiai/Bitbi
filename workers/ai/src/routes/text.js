import { invokeGrokText } from "../lib/grok-chat.js";
import { runWithGenerationTimeout } from "../lib/generation-timeout.js";
import { GROK_4_6_MODEL_ID } from "../../../../js/shared/grok-text-contract.mjs";
import { invokeText } from "../lib/invoke-ai.js";
import { getModelSummary, resolveModelSelection } from "../lib/model-registry.js";
import { errorResponse, fromError, ok } from "../lib/responses.js";
import { readJsonBody, validateTextBody } from "../lib/validate.js";
import {
  getDurationMs,
  getErrorFields,
  getRequestLogFields,
  logDiagnostic,
} from "../../../../js/shared/worker-observability.mjs";

export async function handleText({ request, env, correlationId, pathname, method }) {
  const startedAt = Date.now();
  try {
    const body = await readJsonBody(request);
    if (!body) {
      return errorResponse("Invalid JSON body.", { status: 400, code: "bad_request" });
    }

    const input = validateTextBody(body);
    const selection = resolveModelSelection("text", input);
    const output = selection.model.id === GROK_4_6_MODEL_ID
      ? await runWithGenerationTimeout(signal => invokeGrokText(env, { ...input, correlationId }, signal))
      : await invokeText(env, selection.model, { ...input, correlationId });
    const warnings = [...selection.warnings];

    return ok({
      task: "text",
      model: getModelSummary(selection.model),
      preset: selection.preset,
      result: {
        text: output.text,
        usage: output.usage,
        maxTokens: input.maxTokens,
        temperature: input.temperature,
        ...(output.responseModel ? { responseModel: output.responseModel } : {}),
        ...(output.stopReason ? { stopReason: output.stopReason } : {}),
        ...(output.stopSequence ? { stopSequence: output.stopSequence } : {}),
        ...(output.stopDetails ? { stopDetails: output.stopDetails } : {}),
        ...(output.gatewayMetadata ? { gatewayMetadata: output.gatewayMetadata } : {}),
        ...(Number.isFinite(output.providerCostUsd)
          ? { providerCostUsd: output.providerCostUsd }
          : {}),
      },
      elapsedMs: output.elapsedMs ?? Date.now() - startedAt,
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  } catch (error) {
    logDiagnostic({
      service: "bitbi-ai",
      component: "route-text",
      event: "admin_ai_text_failed",
      level: "error",
      correlationId,
      duration_ms: getDurationMs(startedAt),
      ...getRequestLogFields({ request, pathname, method }),
      ...getErrorFields(error, { includeMessage: false }),
    });
    return fromError(error, "Text generation failed");
  }
}
