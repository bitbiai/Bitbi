import { invokeMusic } from "../lib/invoke-ai.js";
import { getModelSummary, resolveModelSelection } from "../lib/model-registry.js";
import { errorResponse, fromError, ok } from "../lib/responses.js";
import { readJsonBody, validateMusicBody } from "../lib/validate.js";
import { ELEVENLABS_MUSIC_V2_MODEL_ID } from "../../../../js/shared/admin-ai-contract.mjs";
import {
  getDurationMs,
  getErrorFields,
  getRequestLogFields,
  logDiagnostic,
} from "../../../../js/shared/worker-observability.mjs";

export async function handleMusic({
  request,
  env,
  correlationId,
  pathname,
  method,
  aiCallerPolicy,
  generationTimeoutMs = null,
}) {
  const startedAt = Date.now();
  let input = null;
  let selection = null;
  try {
    const body = await readJsonBody(request);
    if (!body) {
      return errorResponse("Invalid JSON body.", { status: 400, code: "bad_request" });
    }

    input = validateMusicBody(body);
    selection = resolveModelSelection("music", input);
    const callerPolicy = aiCallerPolicy?.callerPolicy || null;
    if (!callerPolicy || callerPolicy.model_id !== selection.model.id) {
      return errorResponse("Caller policy does not authorize the selected music model.", {
        status: 403,
        code: "ai_caller_policy_model_mismatch",
      });
    }
    if (
      selection.model.id === ELEVENLABS_MUSIC_V2_MODEL_ID
      && callerPolicy.operation_id !== "admin.music.test"
    ) {
      return errorResponse("ElevenLabs Music v2 is restricted to the Admin AI Lab.", {
        status: 403,
        code: "ai_caller_policy_operation_mismatch",
      });
    }
    const output = await invokeMusic(env, selection.model, {
      ...input,
      correlationId,
      // Internal orchestration/test seam only. Browser JSON is validated before
      // this point and never supplies the timeout override.
      ...(Number.isSafeInteger(generationTimeoutMs) && generationTimeoutMs > 0
        ? { generationTimeoutMs }
        : {}),
    });

    if (selection.model.id === ELEVENLABS_MUSIC_V2_MODEL_ID) {
      return ok({
        task: "music",
        model: getModelSummary(selection.model),
        preset: selection.preset,
        result: {
          prompt: output.prompt,
          inputMode: output.inputMode,
          compositionPlanPresent: output.compositionPlanPresent,
          compositionPlanChunkCount: output.compositionPlanChunkCount,
          compositionPlanSerializedLength: output.compositionPlanSerializedLength,
          requestedDurationMs: output.requestedDurationMs,
          actualDurationMs: output.actualDurationMs,
          durationMs: output.durationMs,
          durationMode: output.durationMode,
          outputFormat: output.outputFormat,
          mimeType: output.mimeType,
          downloadExtension: output.downloadExtension,
          audioUrl: output.audioUrl,
          audioBase64: output.audioBase64,
          sampleRate: output.sampleRate,
          channels: output.channels,
          bitrate: output.bitrate,
          sizeBytes: output.sizeBytes,
          seed: output.seed,
          forceInstrumental: output.forceInstrumental,
          storeForInpainting: output.storeForInpainting,
          signWithC2pa: output.signWithC2pa,
          providerStatus: output.providerStatus,
          providerState: output.providerState,
          providerCostEstimateDurationMs: output.providerCostEstimateDurationMs,
          providerCostEstimateKind: output.providerCostEstimateKind,
          estimatedProviderCostUsd: output.estimatedProviderCostUsd,
          actualProviderCostUsd: output.actualProviderCostUsd,
          priceUsdPerOutputSecond: output.priceUsdPerOutputSecond,
          gatewayMetadata: output.gatewayMetadata,
        },
        ...(output.traceId ? { traceId: output.traceId } : {}),
        elapsedMs: output.elapsedMs,
      });
    }

    const lyricsPreview =
      output.lyrics ||
      (input.mode !== "instrumental" && input.lyricsMode === "custom" ? input.lyrics : null);

    return ok({
      task: "music",
      model: getModelSummary(selection.model),
      preset: selection.preset,
      result: {
        prompt: output.prompt,
        mode: input.mode,
        lyricsMode: input.lyricsMode,
        bpm: input.bpm,
        key: input.key,
        mimeType: output.mimeType || "audio/mpeg",
        audioUrl: output.audioUrl,
        audioBase64: output.audioBase64,
        durationMs: output.durationMs,
        sampleRate: output.sampleRate,
        channels: output.channels,
        bitrate: output.bitrate,
        sizeBytes: output.sizeBytes,
        providerStatus: output.providerStatus,
        lyricsPreview,
      },
      ...(output.traceId ? { traceId: output.traceId } : {}),
      elapsedMs: output.elapsedMs,
    });
  } catch (error) {
    logDiagnostic({
      service: "bitbi-ai",
      component: "route-music",
      event: "admin_ai_music_failed",
      level: "error",
      correlationId,
      model: selection?.model?.id || null,
      request_mode: input?.inputMode || input?.mode || null,
      lyrics_mode: input?.lyricsMode || null,
      prompt_length: typeof input?.prompt === "string" ? input.prompt.length : 0,
      composition_plan_chunk_count: Array.isArray(input?.compositionPlan?.chunks)
        ? input.compositionPlan.chunks.length
        : 0,
      requested_duration_ms: input?.musicLengthMs ?? null,
      output_format: input?.outputFormat || null,
      seed_present: input?.seed !== null && input?.seed !== undefined,
      force_instrumental: input?.forceInstrumental === true,
      store_for_inpainting: input?.storeForInpainting === true,
      sign_with_c2pa: input?.signWithC2pa === true,
      provider_error_kind: error?.provider_error_kind || null,
      provider_state: error?.provider_state || null,
      duration_ms: getDurationMs(startedAt),
      ...getRequestLogFields({ request, pathname, method }),
      ...getErrorFields(error, { includeMessage: false }),
    });
    return fromError(error, "Music generation failed");
  }
}
