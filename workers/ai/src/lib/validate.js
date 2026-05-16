export {
  AdminAiValidationError as ValidationError,
  validateAdminAiCompareBody as validateCompareBody,
  validateAdminAiEmbeddingsBody as validateEmbeddingsBody,
  validateAdminAiImageBody as validateImageBody,
  validateAdminAiLiveAgentBody as validateLiveAgentBody,
  validateAdminAiMusicBody as validateMusicBody,
  validateAdminAiTextBody as validateTextBody,
  validateAdminAiVideoBody as validateVideoBody,
} from "../../../../js/shared/admin-ai-contract.mjs";
import {
  isRequestBodyError,
  readJsonBodyLimited,
} from "../../../../js/shared/request-body.mjs";
import { AdminAiValidationError } from "../../../../js/shared/admin-ai-contract.mjs";
import { stripAiCallerPolicyFromBody } from "../../../shared/ai-caller-policy.mjs";

export const INTERNAL_AI_JSON_MAX_BYTES = 512 * 1024;

export async function readJsonBody(request) {
  try {
    const body = await readJsonBodyLimited(request, {
      maxBytes: INTERNAL_AI_JSON_MAX_BYTES,
      requiredContentType: false,
    });
    // Caller-policy metadata is signed inside the internal JSON body for Auth -> AI Worker
    // requests, then stripped before route validators build provider payloads.
    return stripAiCallerPolicyFromBody(body).body;
  } catch (error) {
    if (isRequestBodyError(error)) {
      throw new AdminAiValidationError(
        error.publicMessage || "Invalid request body.",
        error.status || 400,
        error.code === "invalid_json" ? "bad_request" : (error.code || "bad_request")
      );
    }
    return null;
  }
}
