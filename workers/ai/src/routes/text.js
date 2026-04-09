import { invokeText } from "../lib/invoke-ai.js";
import { getModelSummary, resolveModelSelection } from "../lib/model-registry.js";
import { errorResponse, fromError, ok } from "../lib/responses.js";
import { readJsonBody, validateTextBody } from "../lib/validate.js";

export async function handleText({ request, env }) {
  try {
    const body = await readJsonBody(request);
    if (!body) {
      return errorResponse("Invalid JSON body.", { status: 400 });
    }

    const input = validateTextBody(body);
    const selection = resolveModelSelection("text", input);
    const output = await invokeText(env, selection.model, input);
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
    console.error("AI lab text route failed", error);
    return fromError(error, "Text generation failed");
  }
}
