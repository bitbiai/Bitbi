import { invokeText } from "../lib/invoke-ai.js";
import { getModelSummary, resolveCompareModels } from "../lib/model-registry.js";
import { errorResponse, fromError, ok } from "../lib/responses.js";
import { readJsonBody, validateCompareBody } from "../lib/validate.js";

export async function handleCompare({ request, env }) {
  try {
    const body = await readJsonBody(request);
    if (!body) {
      return errorResponse("Invalid JSON body.", { status: 400 });
    }

    const input = validateCompareBody(body);
    const models = resolveCompareModels(input.models);
    const startedAt = Date.now();
    const results = await Promise.all(
      models.map(async (model) => {
        try {
          const output = await invokeText(env, model, input);
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
        warnings,
      });
    }

    return ok({
      task: "compare",
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
    console.error("AI lab compare route failed", error);
    return fromError(error, "Model comparison failed");
  }
}
