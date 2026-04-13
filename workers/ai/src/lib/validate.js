export {
  AdminAiValidationError as ValidationError,
  validateAdminAiCompareBody as validateCompareBody,
  validateAdminAiEmbeddingsBody as validateEmbeddingsBody,
  validateAdminAiImageBody as validateImageBody,
  validateAdminAiLiveAgentBody as validateLiveAgentBody,
  validateAdminAiTextBody as validateTextBody,
} from "../../../../js/shared/admin-ai-contract.mjs";

export async function readJsonBody(request) {
  try {
    const ct = request.headers.get("content-type") || "";
    if (!ct.includes("application/json")) return null;
    return await request.json();
  } catch {
    return null;
  }
}
