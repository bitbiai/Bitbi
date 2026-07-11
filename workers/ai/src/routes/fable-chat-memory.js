import { QWEN3_30B_A3B_MODEL_ID } from "../../../../js/shared/admin-ai-contract.mjs";
import { invokeFableChatMemory } from "../lib/invoke-ai.js";
import { errorResponse, fromError, ok } from "../lib/responses.js";
import {
  readFableChatMemoryJsonBody,
  validateFableChatMemoryBody,
} from "../lib/validate.js";
import {
  getDurationMs,
  getErrorFields,
  getRequestLogFields,
  logDiagnostic,
} from "../../../../js/shared/worker-observability.mjs";

export async function handleFableChatMemory({ request, env, correlationId, pathname, method }) {
  const startedAt = Date.now();
  try {
    const body = await readFableChatMemoryJsonBody(request);
    if (!body) {
      return errorResponse("Invalid JSON body.", { status: 400, code: "bad_request" });
    }
    const input = validateFableChatMemoryBody(body);
    const output = await invokeFableChatMemory(env, {
      ...input,
      correlationId,
    });
    return ok({
      task: "fable-chat-memory",
      model: {
        id: QWEN3_30B_A3B_MODEL_ID,
        label: "Qwen3 30B-A3B",
        provider: "Cloudflare Workers AI",
      },
      result: {
        summary: output.canonicalSummary,
        estimatedSummaryTokens: output.estimatedSummaryTokens,
        sourceDiagnostics: output.sourceDiagnostics,
        usage: output.usage,
        providerCostUsd: output.providerCostUsd,
        responseModel: output.responseModel,
        finishReason: output.finishReason,
      },
      elapsedMs: output.elapsedMs,
    });
  } catch (error) {
    const rejected = Boolean(error?.rejectionCategory);
    logDiagnostic({
      service: "bitbi-ai",
      component: "route-fable-chat-memory",
      event: rejected
        ? "fable_chat_memory_provider_rejected"
        : "admin_fable_chat_memory_failed",
      level: "error",
      correlationId,
      duration_ms: getDurationMs(startedAt),
      cf_ray_id: request.headers.get("cf-ray") || null,
      ...getRequestLogFields({ request, pathname, method }),
      ...getErrorFields(error, { includeMessage: false }),
      ...(rejected ? error.memoryDiagnostic : {}),
    });
    return fromError(error, "Fable memory compaction failed");
  }
}
