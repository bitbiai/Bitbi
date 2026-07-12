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
  FABLE_CHAT_DEFAULT_WEB_SEARCH_ENABLED,
  FABLE_CHAT_EFFORTS,
  FABLE_CHAT_INTERNAL_JSON_MAX_BYTES,
  FABLE_CHAT_MAX_ASSISTANT_MESSAGE_CHARACTERS,
  FABLE_CHAT_MAX_CONTEXT_PRIOR_TURNS,
  FABLE_CHAT_MAX_PROVIDER_BLOCKS,
  FABLE_CHAT_MAX_REASONING_SUMMARY_CHARACTERS,
  FABLE_CHAT_MAX_SEARCH_QUERY_CHARACTERS,
  FABLE_CHAT_MAX_SEARCH_RESULT_ENCRYPTED_CONTENT_BYTES,
  FABLE_CHAT_MAX_SEARCH_RESULT_ERROR_CODE_CHARACTERS,
  FABLE_CHAT_MAX_SEARCH_RESULT_TITLE_CHARACTERS,
  FABLE_CHAT_MAX_SOURCE_URL_CHARACTERS,
  FABLE_CHAT_MAX_THINKING_SIGNATURE_BYTES,
  FABLE_CHAT_MAX_USER_MESSAGE_CHARACTERS,
  FABLE_CHAT_MAX_WEB_SEARCH_RESULTS,
  FABLE_CHAT_PROMPT_CACHE_POLICY,
  FABLE_CHAT_PROMPT_CACHE_MAX_BREAKPOINTS,
  FABLE_CHAT_PROMPT_CACHE_VERSION,
  FABLE_CHAT_SYSTEM_PRESET_IDS,
  FABLE_CHAT_SYSTEM_PRESET_VERSION,
  FABLE_CHAT_THINKING_DISPLAYS,
  FABLE_CHAT_LEGACY_WEB_SEARCH_CONTRACT_VERSION,
  FABLE_CHAT_WEB_SEARCH_CONTRACT_VERSION,
  FABLE_CHAT_WEB_SEARCH_TOOL_NAME,
  buildFableChatSystemPrompt,
  getFableChatOutputTokenLimit,
  getFableChatWebSearchMaxUses,
} from "../../../shared/fable-chat-contract.mjs";
import {
  FABLE_CHAT_MEMORY_CONTRACT_VERSION,
  FABLE_CHAT_DEFAULT_MEMORY_MODE,
  FABLE_CHAT_MEMORY_INTERNAL_MAX_BYTES,
  FABLE_CHAT_MEMORY_MAX_SOURCE_CHARACTERS,
  FABLE_CHAT_MEMORY_MAX_SOURCE_ESTIMATED_TOKENS,
  FABLE_CHAT_LITE_MEMORY_MAX_SOURCE_ESTIMATED_TOKENS,
  FABLE_CHAT_MEMORY_MAX_SOURCE_TURNS,
  FABLE_CHAT_MEMORY_PROMPT_VERSION,
  FABLE_CHAT_MEMORY_SUPPORTED_DIAGNOSTIC_VERSIONS,
  FABLE_CHAT_LITE_MEMORY_SUPPORTED_PLAN_VERSIONS,
  buildFableChatMemoryProviderSourcePayload,
  buildFableChatHiddenMemoryInstruction,
  buildFableChatMemorySummarizerSystemPrompt,
  escapeFableChatMemoryPromptData,
  estimateFableChatMemoryInputTokens,
  normalizeFableChatMemoryMode,
  normalizeFableChatMemorySummary,
} from "../../../shared/fable-chat-memory-contract.mjs";

export const INTERNAL_AI_JSON_MAX_BYTES = 512 * 1024;
export { FABLE_CHAT_INTERNAL_JSON_MAX_BYTES };
export { FABLE_CHAT_MEMORY_INTERNAL_MAX_BYTES };

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
  "webSearchEnabled",
  "webSearchMaxUses",
  "webSearchContractVersion",
  "memoryMode",
  "memoryContractVersion",
  "memoryCheckpointVersion",
  "memorySummary",
]);
const FABLE_CHAT_ALLOWED_MESSAGE_FIELDS = new Set(["role", "content"]);
const FABLE_CHAT_ALLOWED_TEXT_BLOCK_FIELDS = new Set(["type", "text", "citations", "cache_control"]);
const FABLE_CHAT_ALLOWED_THINKING_BLOCK_FIELDS = new Set(["type", "thinking", "signature"]);
const FABLE_CHAT_ALLOWED_SERVER_TOOL_FIELDS = new Set(["type", "id", "name", "input"]);
const FABLE_CHAT_ALLOWED_SEARCH_RESULT_FIELDS = new Set(["type", "tool_use_id", "content", "caller"]);
const FABLE_CHAT_TOOL_ID_PATTERN = /^srvtoolu_[A-Za-z0-9_-]{8,160}$/;
const FABLE_CHAT_SEARCH_ERROR_CODES = new Set([
  "too_many_requests", "invalid_tool_input", "max_uses_exceeded",
  "query_too_long", "request_too_large", "unavailable",
]);
const FABLE_CHAT_LEGACY_CONTEXT_FORMAT_VERSION = "native-anthropic-turns-v2";
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

function validateFableChatHttpsUrl(value, field) {
  const normalized = normalizeFableChatText(value, field, FABLE_CHAT_MAX_SOURCE_URL_CHARACTERS);
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new AdminAiValidationError(`${field} must be a valid HTTPS URL.`, 400, "validation_error");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new AdminAiValidationError(`${field} must be a valid HTTPS URL.`, 400, "validation_error");
  }
  return normalized;
}

function validateFableChatCitations(value, field, counters) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) {
    throw new AdminAiValidationError(`${field} is invalid.`, 400, "validation_error");
  }
  const citations = value.map((citation, index) => {
    const itemField = `${field}[${index}]`;
    const entry = assertPlainObject(citation, itemField);
    assertOnlyFields(
      entry,
      new Set(["type", "url", "title", "encrypted_index", "cited_text"]),
      itemField
    );
    if (entry.type !== "web_search_result_location") {
      throw new AdminAiValidationError(`${itemField}.type is not supported.`, 400, "validation_error");
    }
    const normalized = {
      type: "web_search_result_location",
      url: validateFableChatHttpsUrl(entry.url, `${itemField}.url`),
      title: normalizeFableChatOptionalText(entry.title, `${itemField}.title`, 512),
      encrypted_index: normalizeFableChatText(
        entry.encrypted_index,
        `${itemField}.encrypted_index`,
        FABLE_CHAT_MAX_SEARCH_RESULT_ENCRYPTED_CONTENT_BYTES
      ),
      cited_text: normalizeFableChatOptionalText(entry.cited_text, `${itemField}.cited_text`, 2_048),
    };
    counters.citationSources.add(new URL(normalized.url).href);
    if (counters.citationSources.size > 16) {
      throw new AdminAiValidationError(`${field} exceeds the citation limit.`, 400, "validation_error");
    }
    counters.totalContentLength += JSON.stringify(normalized).length;
    return normalized;
  });
  return citations;
}

function validateFableChatToolId(value, field) {
  const id = normalizeFableChatText(value, field, 180);
  if (!FABLE_CHAT_TOOL_ID_PATTERN.test(id)) {
    throw new AdminAiValidationError(`${field} is invalid.`, 400, "validation_error");
  }
  return id;
}

function validateFableChatSearchResultContent(value, field, counters) {
  if (Array.isArray(value)) {
    if (value.length > FABLE_CHAT_MAX_WEB_SEARCH_RESULTS) {
      throw new AdminAiValidationError(`${field} is invalid.`, 400, "validation_error");
    }
    return value.map((result, index) => {
      const itemField = `${field}[${index}]`;
      const entry = assertPlainObject(result, itemField);
      assertOnlyFields(
        entry,
        new Set(["type", "url", "title", "encrypted_content", "page_age"]),
        itemField
      );
      if (entry.type !== "web_search_result") {
        throw new AdminAiValidationError(`${itemField}.type is invalid.`, 400, "validation_error");
      }
      const normalized = {
        type: "web_search_result",
        url: validateFableChatHttpsUrl(entry.url, `${itemField}.url`),
        title: normalizeFableChatOptionalText(
          entry.title,
          `${itemField}.title`,
          FABLE_CHAT_MAX_SEARCH_RESULT_TITLE_CHARACTERS
        ),
        encrypted_content: normalizeFableChatText(
          entry.encrypted_content,
          `${itemField}.encrypted_content`,
          FABLE_CHAT_MAX_SEARCH_RESULT_ENCRYPTED_CONTENT_BYTES
        ),
        page_age: entry.page_age == null
          ? null
          : normalizeFableChatOptionalText(entry.page_age, `${itemField}.page_age`, 160),
      };
      counters.totalContentLength += JSON.stringify(normalized).length;
      return normalized;
    });
  }
  const entry = assertPlainObject(value, field);
  assertOnlyFields(entry, new Set(["type", "error_code"]), field);
  const errorCode = normalizeFableChatText(
    entry.error_code,
    `${field}.error_code`,
    FABLE_CHAT_MAX_SEARCH_RESULT_ERROR_CODE_CHARACTERS
  );
  if (entry.type !== "web_search_tool_result_error" || !FABLE_CHAT_SEARCH_ERROR_CODES.has(errorCode)) {
    throw new AdminAiValidationError(`${field} is invalid.`, 400, "validation_error");
  }
  return { type: "web_search_tool_result_error", error_code: errorCode };
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
      if (entry.citations !== undefined) {
        if (role !== "assistant") {
          throw new AdminAiValidationError(
            `${field}.citations are allowed only in assistant messages.`,
            400,
            "validation_error"
          );
        }
        normalized.citations = validateFableChatCitations(
          entry.citations,
          `${field}.citations`,
          counters
        );
      }
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
    if (entry.type === "server_tool_use") {
      if (role !== "assistant") {
        throw new AdminAiValidationError(`${field}.type is not supported.`, 400, "validation_error");
      }
      assertOnlyFields(entry, FABLE_CHAT_ALLOWED_SERVER_TOOL_FIELDS, field);
      if (entry.name !== FABLE_CHAT_WEB_SEARCH_TOOL_NAME) {
        throw new AdminAiValidationError(`${field}.name is not supported.`, 400, "validation_error");
      }
      const input = assertPlainObject(entry.input, `${field}.input`);
      assertOnlyFields(input, new Set(["query"]), `${field}.input`);
      const query = normalizeFableChatText(
        input.query,
        `${field}.input.query`,
        FABLE_CHAT_MAX_SEARCH_QUERY_CHARACTERS
      );
      counters.totalContentLength += query.length;
      return {
        type: "server_tool_use",
        id: validateFableChatToolId(entry.id, `${field}.id`),
        name: FABLE_CHAT_WEB_SEARCH_TOOL_NAME,
        input: { query },
      };
    }
    if (entry.type === "web_search_tool_result") {
      if (role !== "assistant") {
        throw new AdminAiValidationError(`${field}.type is not supported.`, 400, "validation_error");
      }
      assertOnlyFields(entry, FABLE_CHAT_ALLOWED_SEARCH_RESULT_FIELDS, field);
      let caller;
      if (entry.caller !== undefined) {
        caller = assertPlainObject(entry.caller, `${field}.caller`);
        assertOnlyFields(caller, new Set(["type"]), `${field}.caller`);
        if (caller.type !== "direct") {
          throw new AdminAiValidationError(`${field}.caller is invalid.`, 400, "validation_error");
        }
      }
      return {
        type: "web_search_tool_result",
        tool_use_id: validateFableChatToolId(entry.tool_use_id, `${field}.tool_use_id`),
        content: validateFableChatSearchResultContent(entry.content, `${field}.content`, counters),
        ...(caller ? { caller: { type: "direct" } } : {}),
      };
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

  const counters = { totalContentLength: 0, cacheBreakpoints: 0, citationSources: new Set() };
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

  if (counters.cacheBreakpoints > FABLE_CHAT_PROMPT_CACHE_MAX_BREAKPOINTS) {
    throw new AdminAiValidationError(
      `At most ${FABLE_CHAT_PROMPT_CACHE_MAX_BREAKPOINTS} server-owned prompt-cache breakpoints are allowed.`,
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
  const webSearchEnabled = input.webSearchEnabled ?? FABLE_CHAT_DEFAULT_WEB_SEARCH_ENABLED;
  const legacyContext = input.contextFormatVersion === FABLE_CHAT_LEGACY_CONTEXT_FORMAT_VERSION
    && input.webSearchEnabled === undefined
    && input.webSearchMaxUses === undefined
    && input.webSearchContractVersion === undefined;
  if (input.contextFormatVersion !== FABLE_CHAT_CONTEXT_FORMAT_VERSION && !legacyContext) {
    throw new AdminAiValidationError(
      "The Fable chat context format is not supported.",
      400,
      "validation_error"
    );
  }
  if (input.webSearchEnabled !== undefined && typeof input.webSearchEnabled !== "boolean") {
    throw new AdminAiValidationError(
      "webSearchEnabled must be a boolean.",
      400,
      "validation_error"
    );
  }
  const webSearchContractVersion = input.webSearchContractVersion
    ?? (legacyContext
      ? FABLE_CHAT_LEGACY_WEB_SEARCH_CONTRACT_VERSION
      : FABLE_CHAT_WEB_SEARCH_CONTRACT_VERSION);
  if (![FABLE_CHAT_LEGACY_WEB_SEARCH_CONTRACT_VERSION, FABLE_CHAT_WEB_SEARCH_CONTRACT_VERSION]
    .includes(webSearchContractVersion)) {
    throw new AdminAiValidationError(
      "The Fable chat web-search contract is not supported.",
      400,
      "validation_error"
    );
  }
  const expectedWebSearchMaxUses = webSearchContractVersion === FABLE_CHAT_LEGACY_WEB_SEARCH_CONTRACT_VERSION
    ? 1
    : getFableChatWebSearchMaxUses(input.effort);
  if (
    input.webSearchMaxUses !== undefined
      ? (!Number.isInteger(input.webSearchMaxUses)
        || input.webSearchMaxUses !== expectedWebSearchMaxUses)
      : webSearchContractVersion !== FABLE_CHAT_LEGACY_WEB_SEARCH_CONTRACT_VERSION
  ) {
    throw new AdminAiValidationError(
      "webSearchMaxUses does not match the selected effort.",
      400,
      "validation_error"
    );
  }

  const hasMemoryFields = [
    input.memoryMode,
    input.memoryContractVersion,
    input.memoryCheckpointVersion,
    input.memorySummary,
  ].some((value) => value !== undefined);
  let memoryMode = FABLE_CHAT_DEFAULT_MEMORY_MODE;
  let memoryContractVersion = FABLE_CHAT_MEMORY_CONTRACT_VERSION;
  let memoryCheckpointVersion = 0;
  let memorySummary = null;
  if (hasMemoryFields) {
    try {
      memoryMode = normalizeFableChatMemoryMode(input.memoryMode);
    } catch {
      throw new AdminAiValidationError(
        "memoryMode must be standard or lite.",
        400,
        "validation_error"
      );
    }
    if (input.memoryContractVersion !== FABLE_CHAT_MEMORY_CONTRACT_VERSION
      || !Number.isInteger(input.memoryCheckpointVersion)
      || input.memoryCheckpointVersion < 0) {
      throw new AdminAiValidationError(
        "The Fable memory selection is invalid.",
        400,
        "validation_error"
      );
    }
    memoryCheckpointVersion = input.memoryCheckpointVersion;
    if (memoryCheckpointVersion === 0) {
      if (input.memorySummary !== null) {
        throw new AdminAiValidationError(
          "The Fable memory selection is invalid.",
          400,
          "validation_error"
        );
      }
    } else {
      try {
        memorySummary = normalizeFableChatMemorySummary(input.memorySummary, {
          mode: memoryMode,
        }).canonical;
      } catch {
        throw new AdminAiValidationError(
          "The Fable memory summary is invalid.",
          400,
          "validation_error"
        );
      }
    }
  }

  const baseSystem = buildFableChatSystemPrompt(input.systemPresetId, input.systemPresetVersion);
  const system = memorySummary
    ? `${baseSystem}\n\n${buildFableChatHiddenMemoryInstruction(
        memoryMode,
        memoryCheckpointVersion,
        memorySummary
      )}`
    : baseSystem;
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
    webSearchEnabled,
    webSearchMaxUses: expectedWebSearchMaxUses,
    webSearchContractVersion,
    memoryMode,
    memoryContractVersion,
    memoryCheckpointVersion,
    memorySummary,
  };
}

const FABLE_CHAT_MEMORY_ID_PATTERN = /^(?:fbt|fbm)_[a-f0-9]{32}$/;
const FABLE_CHAT_MEMORY_ALLOWED_BODY_FIELDS = new Set([
  "profile", "memoryContractVersion", "promptVersion", "diagnosticVersion", "previousSummaryProfile",
  "previousSummary", "sourceTurns", "litePlanVersion",
]);
const FABLE_CHAT_MEMORY_ALLOWED_TURN_FIELDS = new Set([
  "turnId", "turnOrder", "user", "assistant",
]);
const FABLE_CHAT_MEMORY_ALLOWED_MESSAGE_FIELDS = new Set(["id", "role", "text", "sources"]);
const FABLE_CHAT_MEMORY_ALLOWED_SOURCE_FIELDS = new Set(["title", "url"]);

function validateFableChatMemoryId(value, field) {
  const id = normalizeFableChatText(value, field, 40);
  if (!FABLE_CHAT_MEMORY_ID_PATTERN.test(id)) {
    throw new AdminAiValidationError(`${field} is invalid.`, 400, "validation_error");
  }
  return id;
}

function validateFableChatMemorySource(value, field) {
  const source = assertPlainObject(value, field);
  assertOnlyFields(source, FABLE_CHAT_MEMORY_ALLOWED_SOURCE_FIELDS, field);
  return {
    title: normalizeFableChatOptionalText(source.title, `${field}.title`, 256),
    url: validateFableChatHttpsUrl(source.url, `${field}.url`),
  };
}

function validateFableChatMemoryMessage(value, field, expectedRole) {
  const message = assertPlainObject(value, field);
  assertOnlyFields(message, FABLE_CHAT_MEMORY_ALLOWED_MESSAGE_FIELDS, field);
  if (message.role !== expectedRole) {
    throw new AdminAiValidationError(`${field}.role is invalid.`, 400, "validation_error");
  }
  const sources = message.sources === undefined ? [] : message.sources;
  if (!Array.isArray(sources) || sources.length > 16) {
    throw new AdminAiValidationError(`${field}.sources is invalid.`, 400, "validation_error");
  }
  if (expectedRole === "user" && sources.length > 0) {
    throw new AdminAiValidationError(`${field}.sources is invalid.`, 400, "validation_error");
  }
  return {
    id: validateFableChatMemoryId(message.id, `${field}.id`),
    role: expectedRole,
    text: normalizeFableChatText(message.text, `${field}.text`, FABLE_CHAT_MAX_ASSISTANT_MESSAGE_CHARACTERS),
    ...(expectedRole === "assistant"
      ? { sources: sources.map((source, index) => validateFableChatMemorySource(
          source,
          `${field}.sources[${index}]`
        )) }
      : {}),
  };
}

export function validateFableChatMemoryBody(body) {
  const input = assertPlainObject(body, "body");
  assertOnlyFields(input, FABLE_CHAT_MEMORY_ALLOWED_BODY_FIELDS, "body");
  let profile;
  try {
    profile = normalizeFableChatMemoryMode(input.profile);
  } catch {
    throw new AdminAiValidationError(
      "profile must be standard or lite.",
      400,
      "validation_error"
    );
  }
  if (input.memoryContractVersion !== FABLE_CHAT_MEMORY_CONTRACT_VERSION
    || input.promptVersion !== FABLE_CHAT_MEMORY_PROMPT_VERSION) {
    throw new AdminAiValidationError(
      "The Fable memory contract is not supported.",
      400,
      "validation_error"
    );
  }
  const litePlanVersion = input.litePlanVersion === undefined ? 1 : input.litePlanVersion;
  if ((profile !== "lite" && input.litePlanVersion !== undefined)
    || !Number.isInteger(litePlanVersion)
    || !FABLE_CHAT_LITE_MEMORY_SUPPORTED_PLAN_VERSIONS.includes(litePlanVersion)) {
    throw new AdminAiValidationError(
      "The Lite memory plan is not supported.",
      400,
      "validation_error"
    );
  }
  const diagnosticVersion = input.diagnosticVersion === undefined
    ? 1
    : input.diagnosticVersion;
  if (!Number.isInteger(diagnosticVersion)
    || !FABLE_CHAT_MEMORY_SUPPORTED_DIAGNOSTIC_VERSIONS.includes(diagnosticVersion)) {
    throw new AdminAiValidationError(
      "The Fable memory diagnostic contract is not supported.",
      400,
      "validation_error"
    );
  }
  let previousSummary = null;
  let previousSummaryProfile = null;
  if (input.previousSummary !== null && input.previousSummary !== undefined) {
    try {
      previousSummaryProfile = normalizeFableChatMemoryMode(input.previousSummaryProfile);
      if (profile === "standard" && previousSummaryProfile !== "standard") {
        throw new TypeError("Standard memory cannot be expanded from Lite memory.");
      }
      previousSummary = normalizeFableChatMemorySummary(input.previousSummary, {
        mode: previousSummaryProfile,
      }).summary;
    } catch {
      throw new AdminAiValidationError(
        "previousSummary is invalid.",
        400,
        "validation_error"
      );
    }
  } else if (input.previousSummaryProfile !== null && input.previousSummaryProfile !== undefined) {
    throw new AdminAiValidationError(
      "previousSummaryProfile requires previousSummary.",
      400,
      "validation_error"
    );
  }
  if (!Array.isArray(input.sourceTurns) || input.sourceTurns.length > FABLE_CHAT_MEMORY_MAX_SOURCE_TURNS) {
    throw new AdminAiValidationError(
      `sourceTurns must contain at most ${FABLE_CHAT_MEMORY_MAX_SOURCE_TURNS} complete turns.`,
      400,
      "validation_error"
    );
  }
  if (input.sourceTurns.length === 0 && !previousSummary) {
    throw new AdminAiValidationError(
      "Memory compaction requires a previous summary or finalized source turns.",
      400,
      "validation_error"
    );
  }
  let previousOrder = -1;
  const seenIds = new Set();
  const sourceTurns = input.sourceTurns.map((value, index) => {
    const field = `sourceTurns[${index}]`;
    const turn = assertPlainObject(value, field);
    assertOnlyFields(turn, FABLE_CHAT_MEMORY_ALLOWED_TURN_FIELDS, field);
    if (!Number.isInteger(turn.turnOrder) || turn.turnOrder < 0 || turn.turnOrder <= previousOrder) {
      throw new AdminAiValidationError(`${field}.turnOrder is invalid.`, 400, "validation_error");
    }
    previousOrder = turn.turnOrder;
    const normalized = {
      turnId: validateFableChatMemoryId(turn.turnId, `${field}.turnId`),
      turnOrder: turn.turnOrder,
      user: validateFableChatMemoryMessage(turn.user, `${field}.user`, "user"),
      assistant: validateFableChatMemoryMessage(turn.assistant, `${field}.assistant`, "assistant"),
    };
    for (const id of [normalized.turnId, normalized.user.id, normalized.assistant.id]) {
      if (seenIds.has(id)) {
        throw new AdminAiValidationError(`${field} contains a duplicate ID.`, 400, "validation_error");
      }
      seenIds.add(id);
    }
    return normalized;
  });
  const usesSourceIdContract = diagnosticVersion >= 3;
  const usesDynamicSummaryBudget = diagnosticVersion >= 4;
  const providerSource = usesSourceIdContract
      ? buildFableChatMemoryProviderSourcePayload({
        mode: profile,
        dynamicBudget: usesDynamicSummaryBudget,
        litePlanVersion,
        previousSummary,
        sourceTurns,
      })
    : {
        sourcePayload: JSON.stringify({ previousSummary, sourceTurns }),
        sourceCatalog: [],
      };
  const { sourcePayload, sourceCatalog } = providerSource;
  if (sourcePayload.length > FABLE_CHAT_MEMORY_MAX_SOURCE_CHARACTERS) {
    throw new AdminAiValidationError(
      "Memory compaction source is too large.",
      413,
      "fable_chat_memory_source_too_large"
    );
  }
  const estimatedInputTokens = estimateFableChatMemoryInputTokens(
    `${buildFableChatMemorySummarizerSystemPrompt(profile, {
      sourceIdContract: usesSourceIdContract,
      effectiveSoftTarget: providerSource.budgetPlan?.effectiveSoftTarget || null,
      litePlanVersion,
    })}\n${escapeFableChatMemoryPromptData(sourcePayload)}`
  );
  if (estimatedInputTokens > FABLE_CHAT_MEMORY_MAX_SOURCE_ESTIMATED_TOKENS) {
    throw new AdminAiValidationError(
      "Memory compaction source exceeds its input budget.",
      413,
      "fable_chat_memory_source_too_large"
    );
  }
  if (profile === "lite" && litePlanVersion >= 2
    && estimatedInputTokens > FABLE_CHAT_LITE_MEMORY_MAX_SOURCE_ESTIMATED_TOKENS) {
    throw new AdminAiValidationError(
      "Lite memory compaction source exceeds its input budget.",
      413,
      "fable_chat_memory_source_too_large"
    );
  }
  return {
    profile,
    memoryContractVersion: FABLE_CHAT_MEMORY_CONTRACT_VERSION,
    promptVersion: FABLE_CHAT_MEMORY_PROMPT_VERSION,
    diagnosticVersion,
    litePlanVersion,
    previousSummary,
    previousSummaryProfile,
    sourceTurns,
    sourcePayload,
    sourceCatalog,
    memoryBudgetPlan: providerSource.budgetPlan,
    estimatedInputTokens,
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

export async function readFableChatMemoryJsonBody(request) {
  try {
    const body = await readJsonBodyLimited(request, {
      maxBytes: FABLE_CHAT_MEMORY_INTERNAL_MAX_BYTES,
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
