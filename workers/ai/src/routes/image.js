import { invokeImage } from "../lib/invoke-ai.js";
import { getModelSummary, resolveModelSelection } from "../lib/model-registry.js";
import { errorResponse, fromError, ok } from "../lib/responses.js";
import { readJsonBody, validateImageBody } from "../lib/validate.js";
import {
  getDurationMs,
  getErrorFields,
  getRequestLogFields,
  logDiagnostic,
} from "../../../../js/shared/worker-observability.mjs";

export async function handleImage({ request, env, correlationId, pathname, method }) {
  const startedAt = Date.now();
  try {
    const body = await readJsonBody(request);
    if (!body) {
      return errorResponse("Invalid JSON body.", { status: 400, code: "bad_request" });
    }

    const input = validateImageBody(body);
    const selection = resolveModelSelection("image", input);
    const output = await invokeImage(env, selection.model, { ...input, correlationId });
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
    logDiagnostic({
      service: "bitbi-ai",
      component: "route-image",
      event: "admin_ai_image_failed",
      level: "error",
      correlationId,
      duration_ms: getDurationMs(startedAt),
      ...getRequestLogFields({ request, pathname, method }),
      ...getErrorFields(error, { includeMessage: false }),
    });
    return fromError(error, "Image generation failed");
  }
}
