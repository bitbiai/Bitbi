import { invokeVideo } from "../lib/invoke-ai.js";
import { getModelSummary, resolveModelSelection } from "../lib/model-registry.js";
import { errorResponse, fromError, ok } from "../lib/responses.js";
import { readJsonBody, validateVideoBody } from "../lib/validate.js";
import {
  getErrorFields,
  logDiagnostic,
} from "../../../../js/shared/worker-observability.mjs";

export async function handleVideo({ request, env, correlationId }) {
  let input = null;
  let selection = null;
  try {
    const body = await readJsonBody(request);
    if (!body) {
      return errorResponse("Invalid JSON body.", { status: 400, code: "bad_request" });
    }

    input = validateVideoBody(body);
    selection = resolveModelSelection("video", input);
    const output = await invokeVideo(env, selection.model, { ...input, correlationId });

    return ok({
      task: "video",
      model: getModelSummary(selection.model),
      preset: selection.preset,
      result: {
        videoUrl: output.videoUrl,
        prompt: output.prompt,
        duration: output.duration,
        aspect_ratio: output.aspect_ratio,
        quality: output.quality,
        resolution: output.resolution,
        seed: output.seed,
        generate_audio: output.generate_audio,
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
      ...getErrorFields(error),
    });
    return fromError(error, "Video generation failed");
  }
}
