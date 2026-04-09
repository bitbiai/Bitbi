import { invokeEmbeddings } from "../lib/invoke-ai.js";
import { getModelSummary, resolveModelSelection } from "../lib/model-registry.js";
import { errorResponse, fromError, ok } from "../lib/responses.js";
import { readJsonBody, validateEmbeddingsBody } from "../lib/validate.js";

export async function handleEmbeddings({ request, env }) {
  try {
    const body = await readJsonBody(request);
    if (!body) {
      return errorResponse("Invalid JSON body.", { status: 400 });
    }

    const input = validateEmbeddingsBody(body);
    const selection = resolveModelSelection("embeddings", input);
    const output = await invokeEmbeddings(env, selection.model, input);
    const warnings = [...selection.warnings];

    return ok({
      task: "embeddings",
      model: getModelSummary(selection.model),
      preset: selection.preset,
      result: {
        vectors: output.vectors,
        dimensions: output.shape?.[1] || output.vectors[0]?.length || null,
        count: output.vectors.length,
        shape: output.shape,
        pooling: output.pooling,
      },
      elapsedMs: output.elapsedMs,
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  } catch (error) {
    console.error("AI lab embeddings route failed", error);
    return fromError(error, "Embedding generation failed");
  }
}
