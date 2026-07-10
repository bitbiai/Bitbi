export {
  AdminAiValidationError as ValidationError,
  validateAdminAiCompareBody as validateCompareBody,
  validateAdminAiEmbeddingsBody as validateEmbeddingsBody,
  validateAdminAiLiveAgentBody as validateLiveAgentBody,
  validateAdminAiMusicBody as validateMusicBody,
  validateAdminAiTextBody as validateTextBody,
} from "../../../../js/shared/admin-ai-contract.mjs";
import {
  validateAdminAiImageBody,
  validateAdminAiVideoBody,
} from "../../../../js/shared/admin-ai-contract.mjs";
import {
  isRequestBodyError,
  readJsonBodyLimited,
} from "../../../../js/shared/request-body.mjs";
import { AdminAiValidationError } from "../../../../js/shared/admin-ai-contract.mjs";
import { stripAiCallerPolicyFromBody } from "../../../shared/ai-caller-policy.mjs";

export const INTERNAL_AI_JSON_MAX_BYTES = 512 * 1024;

export const FABLE_CHAT_LIMITS = Object.freeze({
  maxMessages: 49,
  maxMessageLength: 100_000,
  maxSystemLength: 8_000,
  maxTotalContentLength: 104_000,
  maxOutputTokens: 4_096,
});

const FABLE_CHAT_ALLOWED_BODY_FIELDS = new Set(["messages", "system", "maxTokens"]);
const FABLE_CHAT_ALLOWED_MESSAGE_FIELDS = new Set(["role", "content"]);
const UNSAFE_TEXT_CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function assertPlainObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AdminAiValidationError(`${field} must be an object.`, 400, "validation_error");
  }
  return value;
}

function assertOnlyFields(value, allowedFields, field) {
  const unsupported = Object.keys(value).find((key) => !allowedFields.has(key));
  if (unsupported) {
    throw new AdminAiValidationError(
      `${field}.${unsupported} is not supported.`,
      400,
      "validation_error"
    );
  }
}

function normalizeFableChatText(value, field, maxLength) {
  if (typeof value !== "string") {
    throw new AdminAiValidationError(`${field} must be a string.`, 400, "validation_error");
  }
  if (!value.trim()) {
    throw new AdminAiValidationError(`${field} must not be empty.`, 400, "validation_error");
  }
  if (value.length > maxLength) {
    throw new AdminAiValidationError(
      `${field} must be at most ${maxLength} characters.`,
      400,
      "validation_error"
    );
  }
  if (UNSAFE_TEXT_CONTROL_PATTERN.test(value)) {
    throw new AdminAiValidationError(
      `${field} contains unsupported control characters.`,
      400,
      "validation_error"
    );
  }
  return value;
}

export function validateFableChatBody(body) {
  const input = assertPlainObject(body, "body");
  assertOnlyFields(input, FABLE_CHAT_ALLOWED_BODY_FIELDS, "body");

  if (!Array.isArray(input.messages) || input.messages.length === 0) {
    throw new AdminAiValidationError(
      "messages must be a non-empty array.",
      400,
      "validation_error"
    );
  }
  if (input.messages.length > FABLE_CHAT_LIMITS.maxMessages) {
    throw new AdminAiValidationError(
      `messages must contain at most ${FABLE_CHAT_LIMITS.maxMessages} items.`,
      400,
      "validation_error"
    );
  }

  let totalContentLength = 0;
  const messages = input.messages.map((message, index) => {
    const entry = assertPlainObject(message, `messages[${index}]`);
    assertOnlyFields(entry, FABLE_CHAT_ALLOWED_MESSAGE_FIELDS, `messages[${index}]`);
    if (entry.role !== "user" && entry.role !== "assistant") {
      throw new AdminAiValidationError(
        `messages[${index}].role must be "user" or "assistant".`,
        400,
        "validation_error"
      );
    }
    if (index === 0 && entry.role !== "user") {
      throw new AdminAiValidationError(
        "messages must start with a user message.",
        400,
        "validation_error"
      );
    }
    if (index > 0 && entry.role === input.messages[index - 1]?.role) {
      throw new AdminAiValidationError(
        "messages must alternate between user and assistant roles.",
        400,
        "validation_error"
      );
    }

    const content = normalizeFableChatText(
      entry.content,
      `messages[${index}].content`,
      FABLE_CHAT_LIMITS.maxMessageLength
    );
    totalContentLength += content.length;
    return { role: entry.role, content };
  });

  if (messages[messages.length - 1].role !== "user") {
    throw new AdminAiValidationError(
      "messages must end with a user message.",
      400,
      "validation_error"
    );
  }

  let system = null;
  if (input.system !== undefined && input.system !== null && input.system !== "") {
    system = normalizeFableChatText(
      input.system,
      "system",
      FABLE_CHAT_LIMITS.maxSystemLength
    );
    totalContentLength += system.length;
  }
  if (totalContentLength > FABLE_CHAT_LIMITS.maxTotalContentLength) {
    throw new AdminAiValidationError(
      `Chat context must be at most ${FABLE_CHAT_LIMITS.maxTotalContentLength} characters.`,
      400,
      "validation_error"
    );
  }

  if (!Number.isInteger(input.maxTokens)
    || input.maxTokens < 1
    || input.maxTokens > FABLE_CHAT_LIMITS.maxOutputTokens) {
    throw new AdminAiValidationError(
      `maxTokens must be between 1 and ${FABLE_CHAT_LIMITS.maxOutputTokens}.`,
      400,
      "validation_error"
    );
  }

  return {
    messages,
    system,
    maxTokens: input.maxTokens,
  };
}

export function validateImageBody(body) {
  return validateAdminAiImageBody(body, { allowResolvedGrokImageMediaUrls: true });
}

export function validateVideoBody(body) {
  return validateAdminAiVideoBody(body, { allowResolvedGrokPreviewMediaUrls: true });
}

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
