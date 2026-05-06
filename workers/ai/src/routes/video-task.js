import { createVideoProviderTask, pollVideoProviderTask } from "../lib/invoke-ai-video.js";
import { getModelSummary, resolveModelSelection } from "../lib/model-registry.js";
import { errorResponse, fromError, ok } from "../lib/responses.js";
import { readJsonBody, validateVideoBody } from "../lib/validate.js";
import {
  getDurationMs,
  getErrorFields,
  getRequestLogFields,
  logDiagnostic,
} from "../../../../js/shared/worker-observability.mjs";

function providerTaskPayload(result) {
  return {
    status: result.status,
    videoUrl: result.videoUrl || null,
    posterUrl: result.posterUrl || null,
    providerTaskId: result.providerTaskId || null,
    providerState: result.providerState || null,
    retryAfterSeconds: result.retryAfterSeconds || null,
    prompt: result.prompt,
    duration: result.duration,
    aspect_ratio: result.aspect_ratio,
    ratio: result.ratio || result.aspect_ratio || null,
    quality: result.quality,
    resolution: result.resolution,
    seed: result.seed,
    generate_audio: result.generate_audio,
    watermark: result.watermark ?? null,
    hasImageInput: result.hasImageInput,
    hasEndImageInput: result.hasEndImageInput,
    workflow: result.workflow,
  };
}

async function readVideoTaskRequest(request) {
  const body = await readJsonBody(request);
  if (!body) {
    return { error: errorResponse("Invalid JSON body.", { status: 400, code: "bad_request" }) };
  }
  const minimal_mode = body.minimal_mode === true;
  const providerTaskId = typeof body.providerTaskId === "string" ? body.providerTaskId.trim() : "";
  const { minimal_mode: _stripMinimal, providerTaskId: _stripTaskId, ...validationBody } = body;
  const input = validateVideoBody(validationBody);
  if (minimal_mode) input.minimal_mode = true;
  return { body, input, providerTaskId };
}

export async function handleVideoTaskCreate({ request, env, correlationId, pathname, method }) {
  const startedAt = Date.now();
  let input = null;
  let selection = null;
  try {
    const parsed = await readVideoTaskRequest(request);
    if (parsed.error) return parsed.error;
    input = parsed.input;
    selection = resolveModelSelection("video", input);
    const result = await createVideoProviderTask(env, selection.model, {
      ...input,
      correlationId,
    });
    return ok({
      task: "video-provider-task",
      model: getModelSummary(selection.model),
      preset: selection.preset,
      result: providerTaskPayload(result),
      elapsedMs: result.elapsedMs,
    });
  } catch (error) {
    logDiagnostic({
      service: "bitbi-ai",
      component: "route-video-task",
      event: "admin_ai_video_task_create_failed",
      level: "error",
      correlationId,
      model: selection?.model?.id || null,
      has_image_input: !!(input?.image_input || input?.start_image),
      has_end_image_input: !!input?.end_image,
      duration_ms: getDurationMs(startedAt),
      ...getRequestLogFields({ request, pathname, method }),
      ...getErrorFields(error, { includeMessage: false }),
    });
    return fromError(error, "Video provider task creation failed");
  }
}

export async function handleVideoTaskPoll({ request, env, correlationId, pathname, method }) {
  const startedAt = Date.now();
  let input = null;
  let selection = null;
  try {
    const parsed = await readVideoTaskRequest(request);
    if (parsed.error) return parsed.error;
    if (!parsed.providerTaskId) {
      return errorResponse("providerTaskId is required.", {
        status: 400,
        code: "bad_provider_task_id",
      });
    }
    input = parsed.input;
    selection = resolveModelSelection("video", input);
    const result = await pollVideoProviderTask(env, selection.model, {
      ...input,
      correlationId,
    }, {
      providerTaskId: parsed.providerTaskId,
    });
    return ok({
      task: "video-provider-task",
      model: getModelSummary(selection.model),
      preset: selection.preset,
      result: providerTaskPayload(result),
      elapsedMs: result.elapsedMs,
    });
  } catch (error) {
    logDiagnostic({
      service: "bitbi-ai",
      component: "route-video-task",
      event: "admin_ai_video_task_poll_failed",
      level: "error",
      correlationId,
      model: selection?.model?.id || null,
      provider_task_id_present: !!selection && !!input,
      duration_ms: getDurationMs(startedAt),
      ...getRequestLogFields({ request, pathname, method }),
      ...getErrorFields(error, { includeMessage: false }),
    });
    return fromError(error, "Video provider task polling failed");
  }
}
