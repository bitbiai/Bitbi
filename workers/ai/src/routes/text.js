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
    const output = await invokeText(env, selection.model, { ...input, correlationId });
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
      },
      elapsedMs: output.elapsedMs,
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
