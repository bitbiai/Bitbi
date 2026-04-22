import { invokeText } from "../lib/invoke-ai.js";
import { getModelSummary, resolveCompareModels } from "../lib/model-registry.js";
import { errorResponse, fromError, ok } from "../lib/responses.js";
import { readJsonBody, validateCompareBody } from "../lib/validate.js";
import {
  getDurationMs,
  getErrorFields,
  getRequestLogFields,
  logDiagnostic,
} from "../../../../js/shared/worker-observability.mjs";

export async function handleCompare({ request, env, correlationId, pathname, method }) {
  const startedAt = Date.now();
  try {
    const body = await readJsonBody(request);
    if (!body) {
      return errorResponse("Invalid JSON body.", { status: 400, code: "bad_request" });
    }

    const input = validateCompareBody(body);
    const models = resolveCompareModels(input.models);
    const startedAt = Date.now();
    const results = await Promise.all(
      models.map(async (model) => {
        try {
          const output = await invokeText(env, model, { ...input, correlationId });
          return {
            ok: true,
            model: getModelSummary(model),
            text: output.text,
            usage: output.usage,
            elapsedMs: output.elapsedMs,
          };
        } catch (error) {
          return {
            ok: false,
            model: getModelSummary(model),
            error: error?.message || "Text generation failed.",
            code: error?.code || "upstream_error",
          };
        }
      })
    );

    const warnings = [];
    if (results.some((result) => !result.ok)) {
      warnings.push("One or more model runs failed during comparison.");
    }

    if (results.every((result) => !result.ok)) {
      return errorResponse("All compare runs failed.", {
        status: 502,
        code: "upstream_error",
        warnings,
      });
    }

    return ok({
      task: "compare",
      ...(warnings.length > 0 ? { code: "partial_success" } : {}),
      models: models.map(getModelSummary),
      result: {
        results,
        maxTokens: input.maxTokens,
        temperature: input.temperature,
      },
      elapsedMs: Date.now() - startedAt,
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  } catch (error) {
    logDiagnostic({
      service: "bitbi-ai",
      component: "route-compare",
      event: "admin_ai_compare_failed",
      level: "error",
      correlationId,
      duration_ms: getDurationMs(startedAt),
      ...getRequestLogFields({ request, pathname, method }),
      ...getErrorFields(error, { includeMessage: false }),
    });
    return fromError(error, "Model comparison failed");
  }
}
