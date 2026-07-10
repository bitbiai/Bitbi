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
import {
  FABLE_CHAT_CONTEXT_FORMAT_VERSION,
  FABLE_CHAT_EFFORTS,
  FABLE_CHAT_INTERNAL_JSON_MAX_BYTES,
  FABLE_CHAT_MAX_ASSISTANT_MESSAGE_CHARACTERS,
  FABLE_CHAT_MAX_CONTEXT_PRIOR_TURNS,
  FABLE_CHAT_MAX_PROVIDER_BLOCKS,
  FABLE_CHAT_MAX_REASONING_SUMMARY_CHARACTERS,
  FABLE_CHAT_MAX_THINKING_SIGNATURE_BYTES,
  FABLE_CHAT_MAX_USER_MESSAGE_CHARACTERS,
  FABLE_CHAT_PROMPT_CACHE_POLICY,
  FABLE_CHAT_PROMPT_CACHE_VERSION,
  FABLE_CHAT_SYSTEM_PRESET_IDS,
  FABLE_CHAT_SYSTEM_PRESET_VERSION,
  FABLE_CHAT_THINKING_DISPLAYS,
  buildFableChatSystemPrompt,
  getFableChatOutputTokenLimit,
} from "../../../shared/fable-chat-contract.mjs";

export const INTERNAL_AI_JSON_MAX_BYTES = 512 * 1024;
export { FABLE_CHAT_INTERNAL_JSON_MAX_BYTES };

export const FABLE_CHAT_LIMITS = Object.freeze({
  maxMessages: (FABLE_CHAT_MAX_CONTEXT_PRIOR_TURNS * 2) + 1,
  maxMessageLength: FABLE_CHAT_MAX_ASSISTANT_MESSAGE_CHARACTERS,
  maxSystemLength: 8_000,
  maxTotalContentLength: 3 * 1024 * 1024,
  maxOutputTokens: 32_768,
});

const FABLE_CHAT_ALLOWED_BODY_FIELDS = new Set([
  "messages",
  "effort",
  "maxTokens",
  "systemPresetId",
  "systemPresetVersion",
  "thinkingDisplay",
  "promptCachePolicy",
  "promptCacheVersion",
  "contextFormatVersion",
]);
const FABLE_CHAT_ALLOWED_MESSAGE_FIELDS = new Set(["role", "content"]);
const FABLE_CHAT_ALLOWED_TEXT_BLOCK_FIELDS = new Set(["type", "text", "cache_control"]);
const FABLE_CHAT_ALLOWED_THINKING_BLOCK_FIELDS = new Set(["type", "thinking", "signature"]);
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

function normalizeFableChatOptionalText(value, field, maxLength) {
  if (typeof value !== "string" || value.length > maxLength) {
    throw new AdminAiValidationError(`${field} is invalid.`, 400, "validation_error");
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

function validateFableChatCacheControl(value, field) {
  const cache = assertPlainObject(value, field);
  assertOnlyFields(cache, new Set(["type", "ttl"]), field);
  if (cache.type !== "ephemeral" || cache.ttl !== "5m") {
    throw new AdminAiValidationError(
      `${field} must request the server-owned ephemeral 5m policy.`,
      400,
      "validation_error"
    );
  }
  return { type: "ephemeral", ttl: "5m" };
}

function validateFableChatContent(content, { role, messageIndex, lastMessageIndex, counters }) {
  const maxLength = role === "user"
    ? FABLE_CHAT_MAX_USER_MESSAGE_CHARACTERS
    : FABLE_CHAT_MAX_ASSISTANT_MESSAGE_CHARACTERS;
  if (typeof content === "string") {
    const text = normalizeFableChatText(content, `messages[${messageIndex}].content`, maxLength);
    counters.totalContentLength += text.length;
    return text;
  }
  if (!Array.isArray(content) || content.length === 0 || content.length > FABLE_CHAT_MAX_PROVIDER_BLOCKS) {
    throw new AdminAiValidationError(
      `messages[${messageIndex}].content must be a bounded string or content-block array.`,
      400,
      "validation_error"
    );
  }
  let hasText = false;
  const blocks = content.map((block, blockIndex) => {
    const field = `messages[${messageIndex}].content[${blockIndex}]`;
    const entry = assertPlainObject(block, field);
    if (entry.type === "text") {
      assertOnlyFields(entry, FABLE_CHAT_ALLOWED_TEXT_BLOCK_FIELDS, field);
      const text = normalizeFableChatText(entry.text, `${field}.text`, maxLength);
      counters.totalContentLength += text.length;
      hasText = true;
      const normalized = { type: "text", text };
      if (entry.cache_control !== undefined) {
        if (messageIndex === lastMessageIndex) {
          throw new AdminAiValidationError(
            "The current user message cannot be prompt-cached.",
            400,
            "validation_error"
          );
        }
        counters.cacheBreakpoints += 1;
        normalized.cache_control = validateFableChatCacheControl(
          entry.cache_control,
          `${field}.cache_control`
        );
      }
      return normalized;
    }
    if (entry.type === "thinking") {
      if (role !== "assistant") {
        throw new AdminAiValidationError(
          `${field} thinking blocks are allowed only in assistant messages.`,
          400,
          "validation_error"
        );
      }
      assertOnlyFields(entry, FABLE_CHAT_ALLOWED_THINKING_BLOCK_FIELDS, field);
      const thinking = normalizeFableChatOptionalText(
        entry.thinking,
        `${field}.thinking`,
        FABLE_CHAT_MAX_REASONING_SUMMARY_CHARACTERS
      );
      const signature = normalizeFableChatText(
        entry.signature,
        `${field}.signature`,
        FABLE_CHAT_MAX_THINKING_SIGNATURE_BYTES
      );
      counters.totalContentLength += thinking.length + signature.length;
      return { type: "thinking", thinking, signature };
    }
    throw new AdminAiValidationError(
      `${field}.type is not supported.`,
      400,
      "validation_error"
    );
  });
  if (!hasText) {
    throw new AdminAiValidationError(
      `messages[${messageIndex}].content must contain a text block.`,
      400,
      "validation_error"
    );
  }
  return blocks;
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

  const counters = { totalContentLength: 0, cacheBreakpoints: 0 };
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

    const content = validateFableChatContent(entry.content, {
      role: entry.role,
      messageIndex: index,
      lastMessageIndex: input.messages.length - 1,
      counters,
    });
    return { role: entry.role, content };
  });

  if (messages[messages.length - 1].role !== "user") {
    throw new AdminAiValidationError(
      "messages must end with a user message.",
      400,
      "validation_error"
    );
  }

  if (counters.cacheBreakpoints > 1) {
    throw new AdminAiValidationError(
      "At most one server-owned prompt-cache breakpoint is allowed.",
      400,
      "validation_error"
    );
  }

  if (!FABLE_CHAT_EFFORTS.includes(input.effort)) {
    throw new AdminAiValidationError(
      "effort must be medium, high, xhigh, or max.",
      400,
      "validation_error"
    );
  }
  const expectedMaxTokens = getFableChatOutputTokenLimit(input.effort);
  if (!Number.isInteger(input.maxTokens) || input.maxTokens !== expectedMaxTokens) {
    throw new AdminAiValidationError(
      "maxTokens does not match the selected effort.",
      400,
      "validation_error"
    );
  }
  if (!FABLE_CHAT_SYSTEM_PRESET_IDS.includes(input.systemPresetId)
    || input.systemPresetVersion !== FABLE_CHAT_SYSTEM_PRESET_VERSION) {
    throw new AdminAiValidationError(
      "The Fable chat system preset is not supported.",
      400,
      "validation_error"
    );
  }
  if (!FABLE_CHAT_THINKING_DISPLAYS.includes(input.thinkingDisplay)) {
    throw new AdminAiValidationError(
      "thinkingDisplay must be omitted or summarized.",
      400,
      "validation_error"
    );
  }
  if (input.promptCachePolicy !== FABLE_CHAT_PROMPT_CACHE_POLICY
    || input.promptCacheVersion !== FABLE_CHAT_PROMPT_CACHE_VERSION) {
    throw new AdminAiValidationError(
      "The Fable chat prompt-cache policy is not supported.",
      400,
      "validation_error"
    );
  }
  if (input.contextFormatVersion !== FABLE_CHAT_CONTEXT_FORMAT_VERSION) {
    throw new AdminAiValidationError(
      "The Fable chat context format is not supported.",
      400,
      "validation_error"
    );
  }

  const system = buildFableChatSystemPrompt(input.systemPresetId, input.systemPresetVersion);
  counters.totalContentLength += system.length;
  if (counters.totalContentLength > FABLE_CHAT_LIMITS.maxTotalContentLength) {
    throw new AdminAiValidationError(
      `Chat context must be at most ${FABLE_CHAT_LIMITS.maxTotalContentLength} characters.`,
      400,
      "validation_error"
    );
  }

  return {
    messages,
    system,
    maxTokens: input.maxTokens,
    effort: input.effort,
    systemPresetId: input.systemPresetId,
    systemPresetVersion: input.systemPresetVersion,
    thinkingDisplay: input.thinkingDisplay,
    promptCachePolicy: input.promptCachePolicy,
    promptCacheVersion: input.promptCacheVersion,
    contextFormatVersion: input.contextFormatVersion,
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

export async function readFableChatJsonBody(request) {
  try {
    const body = await readJsonBodyLimited(request, {
      maxBytes: FABLE_CHAT_INTERNAL_JSON_MAX_BYTES,
      requiredContentType: false,
    });
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
