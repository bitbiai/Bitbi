import { assertValidServiceRequest, ServiceAuthError } from "../../../js/shared/service-auth.mjs";
import {
  AiWorkerConfigError,
  assertAiWorkerConfig,
  logAiWorkerConfigFailure,
  workerConfigUnavailableResponse,
} from "./lib/config.js";
import { errorResponse, methodNotAllowed, notFound } from "./lib/responses.js";
import { handleCompare } from "./routes/compare.js";
import { handleEmbeddings } from "./routes/embeddings.js";
import { handleImage } from "./routes/image.js";
import { handleLiveAgent } from "./routes/live-agent.js";
import { handleMusic } from "./routes/music.js";
import { handleModels } from "./routes/models.js";
import { handleText } from "./routes/text.js";
import { handleVideo } from "./routes/video.js";
import { INTERNAL_AI_JSON_MAX_BYTES } from "./lib/validate.js";
import {
  getCorrelationId,
  withCorrelationId,
} from "../../../js/shared/worker-observability.mjs";
import { recordServiceAuthNonce } from "./lib/service-auth-replay.js";
import { isRequestBodyError } from "../../../js/shared/request-body.mjs";
export { AiServiceAuthReplayDurableObject } from "./lib/service-auth-replay-do.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;
    const ctx = { request, env, url, pathname, method, correlationId: getCorrelationId(request) };
    let response = null;

    if (pathname.startsWith("/internal/ai/")) {
      try {
        assertAiWorkerConfig(env);
        await assertValidServiceRequest(request, {
          secret: env.AI_SERVICE_AUTH_SECRET,
          maxBodyBytes: INTERNAL_AI_JSON_MAX_BYTES,
          recordNonce: ({ nonce, replayWindowMs }) => recordServiceAuthNonce(env, {
            nonce,
            replayWindowMs,
          }),
        });
      } catch (error) {
        if (error instanceof AiWorkerConfigError || error?.code === "service_auth_unavailable") {
          logAiWorkerConfigFailure({
            error,
            correlationId: ctx.correlationId,
            requestInfo: { request, pathname, method },
          });
          return workerConfigUnavailableResponse(ctx.correlationId);
        }
        if (error instanceof ServiceAuthError) {
          return withCorrelationId(errorResponse(
            "Unauthorized.",
            { status: error.status || 401, code: error.code || "service_auth_invalid" }
          ), ctx.correlationId);
        }
        if (isRequestBodyError(error)) {
          return withCorrelationId(errorResponse(
            error.publicMessage || "Invalid request body.",
            { status: error.status || 400, code: error.code || "bad_request" }
          ), ctx.correlationId);
        }
        throw error;
      }
    }

    if (pathname === "/internal/ai/models") {
      if (method !== "GET") response = methodNotAllowed(["GET"]);
      else response = await handleModels(ctx);
      return withCorrelationId(response, ctx.correlationId);
    }

    if (pathname === "/internal/ai/test-text") {
      if (method !== "POST") response = methodNotAllowed(["POST"]);
      else response = await handleText(ctx);
      return withCorrelationId(response, ctx.correlationId);
    }

    if (pathname === "/internal/ai/test-image") {
      if (method !== "POST") response = methodNotAllowed(["POST"]);
      else response = await handleImage(ctx);
      return withCorrelationId(response, ctx.correlationId);
    }

    if (pathname === "/internal/ai/test-embeddings") {
      if (method !== "POST") response = methodNotAllowed(["POST"]);
      else response = await handleEmbeddings(ctx);
      return withCorrelationId(response, ctx.correlationId);
    }

    if (pathname === "/internal/ai/test-music") {
      if (method !== "POST") response = methodNotAllowed(["POST"]);
      else response = await handleMusic(ctx);
      return withCorrelationId(response, ctx.correlationId);
    }

    if (pathname === "/internal/ai/compare") {
      if (method !== "POST") response = methodNotAllowed(["POST"]);
      else response = await handleCompare(ctx);
      return withCorrelationId(response, ctx.correlationId);
    }

    if (pathname === "/internal/ai/test-video") {
      if (method !== "POST") response = methodNotAllowed(["POST"]);
      else response = await handleVideo(ctx);
      return withCorrelationId(response, ctx.correlationId);
    }

    if (pathname === "/internal/ai/live-agent") {
      if (method !== "POST") response = methodNotAllowed(["POST"]);
      else response = await handleLiveAgent(ctx);
      return withCorrelationId(response, ctx.correlationId);
    }

    return withCorrelationId(notFound(), ctx.correlationId);
  },
};
