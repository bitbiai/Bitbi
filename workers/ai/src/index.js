import { methodNotAllowed, notFound } from "./lib/responses.js";
import { handleCompare } from "./routes/compare.js";
import { handleEmbeddings } from "./routes/embeddings.js";
import { handleImage } from "./routes/image.js";
import { handleLiveAgent } from "./routes/live-agent.js";
import { handleModels } from "./routes/models.js";
import { handleText } from "./routes/text.js";
import {
  getCorrelationId,
  withCorrelationId,
} from "../../../js/shared/worker-observability.mjs";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;
    const ctx = { request, env, url, pathname, method, correlationId: getCorrelationId(request) };
    let response = null;

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

    if (pathname === "/internal/ai/compare") {
      if (method !== "POST") response = methodNotAllowed(["POST"]);
      else response = await handleCompare(ctx);
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
