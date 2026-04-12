import { invokeImage } from "../lib/invoke-ai.js";
import { getModelSummary, resolveModelSelection } from "../lib/model-registry.js";
import { errorResponse, fromError, ok } from "../lib/responses.js";
import { readJsonBody, validateImageBody } from "../lib/validate.js";

export async function handleImage({ request, env }) {
  try {
    const body = await readJsonBody(request);
    if (!body) {
      return errorResponse("Invalid JSON body.", { status: 400, code: "bad_request" });
    }

    const input = validateImageBody(body);
    const selection = resolveModelSelection("image", input);
    const output = await invokeImage(env, selection.model, input);
    const warnings = [...selection.warnings, ...output.warnings];

    return ok({
      task: "image",
      model: getModelSummary(selection.model),
      preset: selection.preset,
      result: {
        imageBase64: output.imageBase64,
        mimeType: output.mimeType,
        steps: output.appliedSteps,
        seed: output.appliedSeed,
        guidance: output.appliedGuidance,
        promptMode: input.promptMode || "standard",
        requestedSize:
          input.width && input.height
            ? {
                width: input.width,
                height: input.height,
              }
            : null,
        appliedSize: output.appliedSize,
        referenceImageCount: input.referenceImages?.length || 0,
      },
      elapsedMs: output.elapsedMs,
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  } catch (error) {
    console.error("AI lab image route failed", error);
    return fromError(error, "Image generation failed");
  }
}
