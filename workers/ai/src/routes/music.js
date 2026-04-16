import { invokeMusic } from "../lib/invoke-ai.js";
import { getModelSummary, resolveModelSelection } from "../lib/model-registry.js";
import { errorResponse, fromError, ok } from "../lib/responses.js";
import { readJsonBody, validateMusicBody } from "../lib/validate.js";
import {
  getErrorFields,
  logDiagnostic,
} from "../../../../js/shared/worker-observability.mjs";

export async function handleMusic({ request, env, correlationId }) {
  let input = null;
  let selection = null;
  try {
    const body = await readJsonBody(request);
    if (!body) {
      return errorResponse("Invalid JSON body.", { status: 400, code: "bad_request" });
    }

    input = validateMusicBody(body);
    selection = resolveModelSelection("music", input);
    const output = await invokeMusic(env, selection.model, { ...input, correlationId });
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
      request_mode: input?.mode || null,
      lyrics_mode: input?.lyricsMode || null,
      ...getErrorFields(error),
    });
    return fromError(error, "Music generation failed");
  }
}
