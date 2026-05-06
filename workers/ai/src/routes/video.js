import { invokeVideo } from "../lib/invoke-ai.js";
import { getModelSummary, resolveModelSelection } from "../lib/model-registry.js";
import { errorResponse, fromError, ok } from "../lib/responses.js";
import { readJsonBody, validateVideoBody } from "../lib/validate.js";
import {
  getDurationMs,
  getErrorFields,
  getRequestLogFields,
  logDiagnostic,
} from "../../../../js/shared/worker-observability.mjs";

export async function handleVideo({ request, env, correlationId, pathname, method }) {
  const startedAt = Date.now();
  let input = null;
  let selection = null;
  try {
    const body = await readJsonBody(request);
    if (!body) {
      return errorResponse("Invalid JSON body.", { status: 400, code: "bad_request" });
    }

    const minimal_mode = body.minimal_mode === true;
    const { minimal_mode: _strip, ...validationBody } = body;
    input = validateVideoBody(validationBody);
    selection = resolveModelSelection("video", input);
    const output = await invokeVideo(env, selection.model, { ...input, correlationId, minimal_mode });

    return ok({
      task: "video",
      model: getModelSummary(selection.model),
      preset: selection.preset,
      result: {
        videoUrl: output.videoUrl,
        prompt: output.prompt,
        duration: output.duration,
        aspect_ratio: output.aspect_ratio,
        ratio: output.ratio || output.aspect_ratio || null,
        quality: output.quality,
        resolution: output.resolution,
        seed: output.seed,
        generate_audio: output.generate_audio,
        watermark: output.watermark ?? null,
        hasImageInput: output.hasImageInput,
        hasEndImageInput: output.hasEndImageInput,
        workflow: output.workflow,
      },
      elapsedMs: output.elapsedMs,
    });
  } catch (error) {
    logDiagnostic({
      service: "bitbi-ai",
      component: "route-video",
      event: "admin_ai_video_failed",
      level: "error",
      correlationId,
      model: selection?.model?.id || null,
      has_image_input: !!(input?.image_input || input?.start_image),
      has_end_image_input: !!input?.end_image,
      duration_ms: getDurationMs(startedAt),
      ...getRequestLogFields({ request, pathname, method }),
      ...getErrorFields(error, { includeMessage: false }),
    });
    return fromError(error, "Video generation failed");
  }
}
