import { methodNotAllowed, notFound } from "./lib/responses.js";
import { handleCompare } from "./routes/compare.js";
import { handleEmbeddings } from "./routes/embeddings.js";
import { handleImage } from "./routes/image.js";
import { handleLiveAgent } from "./routes/live-agent.js";
import { handleModels } from "./routes/models.js";
import { handleText } from "./routes/text.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;
    const ctx = { request, env, url, pathname, method };

    if (pathname === "/internal/ai/models") {
      if (method !== "GET") return methodNotAllowed(["GET"]);
      return handleModels(ctx);
    }

    if (pathname === "/internal/ai/test-text") {
      if (method !== "POST") return methodNotAllowed(["POST"]);
      return handleText(ctx);
    }

    if (pathname === "/internal/ai/test-image") {
      if (method !== "POST") return methodNotAllowed(["POST"]);
      return handleImage(ctx);
    }

    if (pathname === "/internal/ai/test-embeddings") {
      if (method !== "POST") return methodNotAllowed(["POST"]);
      return handleEmbeddings(ctx);
    }

    if (pathname === "/internal/ai/compare") {
      if (method !== "POST") return methodNotAllowed(["POST"]);
      return handleCompare(ctx);
    }

    if (pathname === "/internal/ai/live-agent") {
      if (method !== "POST") return methodNotAllowed(["POST"]);
      return handleLiveAgent(ctx);
    }

    return notFound();
  },
};
