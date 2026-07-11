import {
  FABLE_CHAT_CONTEXT_ESTIMATOR_VERSION,
  FABLE_CHAT_CONTEXT_FORMAT_VERSION,
  FABLE_CHAT_MAX_CITATIONS,
  FABLE_CHAT_MAX_CITATIONS_JSON_BYTES,
  FABLE_CHAT_MAX_PROVIDER_BLOCKS,
  FABLE_CHAT_MAX_PROVIDER_BLOCKS_JSON_BYTES,
  FABLE_CHAT_MAX_REASONING_SUMMARY_CHARACTERS,
  FABLE_CHAT_MAX_SEARCH_QUERY_CHARACTERS,
  FABLE_CHAT_MAX_SEARCH_RESULT_ENCRYPTED_CONTENT_BYTES,
  FABLE_CHAT_MAX_SEARCH_RESULT_ERROR_CODE_CHARACTERS,
  FABLE_CHAT_MAX_SEARCH_RESULT_TITLE_CHARACTERS,
  FABLE_CHAT_MAX_SOURCE_TITLE_CHARACTERS,
  FABLE_CHAT_MAX_SOURCE_URL_CHARACTERS,
  FABLE_CHAT_MAX_THINKING_SIGNATURE_BYTES,
  FABLE_CHAT_MAX_WEB_SEARCH_RESULTS,
  FABLE_CHAT_PROMPT_CACHE_MINIMUM_TOKENS,
  FABLE_CHAT_PROMPT_CACHE_POLICY,
  FABLE_CHAT_PROMPT_CACHE_VERSION,
  FABLE_CHAT_WEB_SEARCH_TOOL_NAME,
} from "../../../shared/fable-chat-contract.mjs";

const TEXT_ENCODER = new TextEncoder();
const DISALLOWED_CONTENT_CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const ESTIMATOR_MARGIN_MULTIPLIER = 1.12;
const ESTIMATOR_FIXED_MARGIN_TOKENS = 256;
const MESSAGE_OVERHEAD_TOKENS = 12;
const CONTENT_BLOCK_OVERHEAD_TOKENS = 8;
const TOOL_ID_PATTERN = /^srvtoolu_[A-Za-z0-9_-]{8,160}$/;
const SEARCH_ERROR_CODES = new Set([
  "too_many_requests",
  "invalid_tool_input",
  "max_uses_exceeded",
  "query_too_long",
  "request_too_large",
  "unavailable",
]);

export function utf8ByteLength(value) {
  return TEXT_ENCODER.encode(String(value || "")).byteLength;
}

export function estimateFableChatTextTokens(value) {
  const text = String(value || "");
  if (!text) return 0;
  const bytes = utf8ByteLength(text);
  const codePoints = Array.from(text).length;
  return Math.max(Math.ceil(bytes / 3), Math.ceil(codePoints / 2));
}

function assertSafeProviderText(value, field, maxCharacters) {
  if (typeof value !== "string" || value.length > maxCharacters) {
    throw new TypeError(`${field} is invalid.`);
  }
  if (DISALLOWED_CONTENT_CONTROL_PATTERN.test(value)) {
    throw new TypeError(`${field} contains unsupported control characters.`);
  }
  return value;
}

function assertOnlyProviderFields(value, allowed, field) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new TypeError(`${field} is invalid.`);
  }
}

function normalizeHttpsUrl(value, field) {
  const url = assertSafeProviderText(value, field, FABLE_CHAT_MAX_SOURCE_URL_CHARACTERS);
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new TypeError(`${field} is invalid.`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new TypeError(`${field} is invalid.`);
  }
  return url;
}

function normalizePrivateCitation(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} is invalid.`);
  }
  assertOnlyProviderFields(
    value,
    ["type", "url", "title", "encrypted_index", "cited_text"],
    field
  );
  if (value.type !== "web_search_result_location") {
    throw new TypeError(`${field} is invalid.`);
  }
  return {
    type: "web_search_result_location",
    url: normalizeHttpsUrl(value.url, `${field}.url`),
    title: assertSafeProviderText(
      value.title,
      `${field}.title`,
      FABLE_CHAT_MAX_SEARCH_RESULT_TITLE_CHARACTERS
    ),
    encrypted_index: assertSafeProviderText(
      value.encrypted_index,
      `${field}.encrypted_index`,
      FABLE_CHAT_MAX_SEARCH_RESULT_ENCRYPTED_CONTENT_BYTES
    ),
    cited_text: assertSafeProviderText(value.cited_text, `${field}.cited_text`, 2_048),
  };
}

function normalizePrivateCitations(value, field) {
  if (!Array.isArray(value) || value.length === 0 || value.length > FABLE_CHAT_MAX_CITATIONS) {
    throw new TypeError(`${field} is invalid.`);
  }
  return value.map((citation, index) => normalizePrivateCitation(citation, `${field}[${index}]`));
}

function normalizeToolId(value, field) {
  const id = assertSafeProviderText(value, field, 180);
  if (!TOOL_ID_PATTERN.test(id)) throw new TypeError(`${field} is invalid.`);
  return id;
}

function normalizeSearchResult(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} is invalid.`);
  }
  assertOnlyProviderFields(
    value,
    ["type", "url", "title", "encrypted_content", "page_age"],
    field
  );
  if (value.type !== "web_search_result") throw new TypeError(`${field} is invalid.`);
  const pageAge = value.page_age == null
    ? null
    : assertSafeProviderText(value.page_age, `${field}.page_age`, 160);
  return {
    type: "web_search_result",
    url: normalizeHttpsUrl(value.url, `${field}.url`),
    title: assertSafeProviderText(
      value.title,
      `${field}.title`,
      FABLE_CHAT_MAX_SEARCH_RESULT_TITLE_CHARACTERS
    ),
    encrypted_content: assertSafeProviderText(
      value.encrypted_content,
      `${field}.encrypted_content`,
      FABLE_CHAT_MAX_SEARCH_RESULT_ENCRYPTED_CONTENT_BYTES
    ),
    page_age: pageAge,
  };
}

function normalizeSearchResultContent(value, field) {
  if (Array.isArray(value)) {
    if (value.length > FABLE_CHAT_MAX_WEB_SEARCH_RESULTS) {
      throw new TypeError(`${field} is invalid.`);
    }
    return value.map((result, index) => normalizeSearchResult(result, `${field}[${index}]`));
  }
  if (!value || typeof value !== "object") throw new TypeError(`${field} is invalid.`);
  assertOnlyProviderFields(value, ["type", "error_code"], field);
  const errorCode = assertSafeProviderText(
    value.error_code,
    `${field}.error_code`,
    FABLE_CHAT_MAX_SEARCH_RESULT_ERROR_CODE_CHARACTERS
  );
  if (value.type !== "web_search_tool_result_error" || !SEARCH_ERROR_CODES.has(errorCode)) {
    throw new TypeError(`${field} is invalid.`);
  }
  return { type: "web_search_tool_result_error", error_code: errorCode };
}

export function normalizeFableChatProviderBlocks(value, {
  allowEmptyThinking = true,
} = {}) {
  let blocks = value;
  if (typeof blocks === "string") {
    try {
      blocks = JSON.parse(blocks);
    } catch {
      throw new TypeError("Provider content blocks are invalid.");
    }
  }
  if (!Array.isArray(blocks) || blocks.length === 0 || blocks.length > FABLE_CHAT_MAX_PROVIDER_BLOCKS) {
    throw new TypeError("Provider content blocks are invalid.");
  }

  const normalized = blocks.map((block, index) => {
    if (!block || typeof block !== "object" || Array.isArray(block)) {
      throw new TypeError(`Provider content block ${index} is invalid.`);
    }
    if (block.type === "text") {
      assertOnlyProviderFields(block, ["type", "text", "citations"], `Provider text block ${index}`);
      const text = assertSafeProviderText(block.text, `Provider text block ${index}`, 524_288);
      return {
        type: "text",
        text,
        ...(block.citations === undefined
          ? {}
          : { citations: normalizePrivateCitations(block.citations, `Provider text citations ${index}`) }),
      };
    }
    if (block.type === "thinking") {
      if (Object.keys(block).some((key) => !["type", "thinking", "signature"].includes(key))) {
        throw new TypeError(`Provider thinking block ${index} is invalid.`);
      }
      const thinking = assertSafeProviderText(
        block.thinking,
        `Provider thinking block ${index}`,
        FABLE_CHAT_MAX_REASONING_SUMMARY_CHARACTERS
      );
      if (!allowEmptyThinking && !thinking) {
        throw new TypeError(`Provider thinking block ${index} is invalid.`);
      }
      const signature = assertSafeProviderText(
        block.signature,
        `Provider thinking signature ${index}`,
        FABLE_CHAT_MAX_THINKING_SIGNATURE_BYTES
      );
      if (!signature || utf8ByteLength(signature) > FABLE_CHAT_MAX_THINKING_SIGNATURE_BYTES) {
        throw new TypeError(`Provider thinking signature ${index} is invalid.`);
      }
      return { type: "thinking", thinking, signature };
    }
    if (block.type === "server_tool_use") {
      assertOnlyProviderFields(
        block,
        ["type", "id", "name", "input"],
        `Provider server tool block ${index}`
      );
      if (block.name !== FABLE_CHAT_WEB_SEARCH_TOOL_NAME) {
        throw new TypeError(`Provider server tool block ${index} is invalid.`);
      }
      if (!block.input || typeof block.input !== "object" || Array.isArray(block.input)) {
        throw new TypeError(`Provider server tool block ${index} is invalid.`);
      }
      assertOnlyProviderFields(block.input, ["query"], `Provider server tool input ${index}`);
      return {
        type: "server_tool_use",
        id: normalizeToolId(block.id, `Provider server tool id ${index}`),
        name: FABLE_CHAT_WEB_SEARCH_TOOL_NAME,
        input: {
          query: assertSafeProviderText(
            block.input.query,
            `Provider server tool query ${index}`,
            FABLE_CHAT_MAX_SEARCH_QUERY_CHARACTERS
          ),
        },
      };
    }
    if (block.type === "web_search_tool_result") {
      assertOnlyProviderFields(
        block,
        ["type", "tool_use_id", "content", "caller"],
        `Provider search result block ${index}`
      );
      let caller;
      if (block.caller !== undefined) {
        if (!block.caller || typeof block.caller !== "object" || Array.isArray(block.caller)) {
          throw new TypeError(`Provider search result caller ${index} is invalid.`);
        }
        assertOnlyProviderFields(block.caller, ["type"], `Provider search result caller ${index}`);
        if (block.caller.type !== "direct") {
          throw new TypeError(`Provider search result caller ${index} is invalid.`);
        }
        caller = { type: "direct" };
      }
      return {
        type: "web_search_tool_result",
        tool_use_id: normalizeToolId(block.tool_use_id, `Provider search result id ${index}`),
        content: normalizeSearchResultContent(block.content, `Provider search result content ${index}`),
        ...(caller ? { caller } : {}),
      };
    }
    throw new TypeError(`Provider content block ${index} has an unsupported type.`);
  });

  const serialized = JSON.stringify(normalized);
  const citationCount = normalized.reduce((total, block) => total + (block.citations?.length || 0), 0);
  if (citationCount > FABLE_CHAT_MAX_CITATIONS) {
    throw new TypeError("Provider citations exceed their safe limit.");
  }
  if (utf8ByteLength(serialized) > FABLE_CHAT_MAX_PROVIDER_BLOCKS_JSON_BYTES) {
    throw new TypeError("Provider content blocks are too large.");
  }
  return normalized;
}

export function extractFableChatCitations(blocks) {
  const deduplicated = new Map();
  for (const block of normalizeFableChatProviderBlocks(blocks)) {
    if (block.type !== "text") continue;
    for (const citation of block.citations || []) {
      if (deduplicated.has(citation.url)) continue;
      deduplicated.set(citation.url, {
        url: citation.url,
        title: citation.title.slice(0, FABLE_CHAT_MAX_SOURCE_TITLE_CHARACTERS),
        type: citation.type,
      });
      if (deduplicated.size >= FABLE_CHAT_MAX_CITATIONS) break;
    }
    if (deduplicated.size >= FABLE_CHAT_MAX_CITATIONS) break;
  }
  const citations = [...deduplicated.values()];
  if (utf8ByteLength(JSON.stringify(citations)) > FABLE_CHAT_MAX_CITATIONS_JSON_BYTES) {
    throw new TypeError("Provider citations are too large.");
  }
  return citations;
}

export function countFableChatWebSearchBlocks(blocks) {
  const normalized = normalizeFableChatProviderBlocks(blocks);
  const requests = normalized.filter((block) => (
    block.type === "server_tool_use" && block.name === FABLE_CHAT_WEB_SEARCH_TOOL_NAME
  ));
  const requestIds = new Set(requests.map((block) => block.id));
  const allResults = normalized.filter((block) => block.type === "web_search_tool_result");
  const resultIds = new Set(allResults.map((block) => block.tool_use_id));
  if (
    requestIds.size !== requests.length
    || resultIds.size !== allResults.length
    || allResults.some((block) => !requestIds.has(block.tool_use_id))
    || requests.length !== allResults.length
  ) {
    throw new TypeError("Provider web-search blocks are inconsistent.");
  }
  return { requestCount: requests.length, resultCount: allResults.length };
}

export function extractFableChatAssistantText(blocks) {
  return normalizeFableChatProviderBlocks(blocks)
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n\n")
    .trim();
}

export function extractFableChatReasoningSummary(blocks) {
  const summary = normalizeFableChatProviderBlocks(blocks)
    .filter((block) => block.type === "thinking" && block.thinking)
    .map((block) => block.thinking)
    .join("\n\n")
    .trim();
  if (summary.length > FABLE_CHAT_MAX_REASONING_SUMMARY_CHARACTERS) {
    throw new TypeError("Provider reasoning summary is too large.");
  }
  return summary || null;
}

function estimateContentTokens(content) {
  if (typeof content === "string") return estimateFableChatTextTokens(content);
  if (!Array.isArray(content)) throw new TypeError("Message content is invalid.");
  let tokens = 0;
  for (const block of content) {
    tokens += CONTENT_BLOCK_OVERHEAD_TOKENS;
    if (block?.type === "text") {
      tokens += estimateFableChatTextTokens(block.text);
      if (block.citations) tokens += Math.ceil(utf8ByteLength(JSON.stringify(block.citations)) / 2);
    } else if (block?.type === "thinking") {
      tokens += estimateFableChatTextTokens(block.thinking);
      tokens += Math.ceil(utf8ByteLength(block.signature) / 2);
    } else if (block?.type === "server_tool_use" || block?.type === "web_search_tool_result") {
      tokens += Math.ceil(utf8ByteLength(JSON.stringify(block)) / 2);
    } else {
      throw new TypeError("Message content block is invalid.");
    }
  }
  return tokens;
}

export function estimateFableChatInputTokens({ system, messages }) {
  let rawTokens = MESSAGE_OVERHEAD_TOKENS + estimateFableChatTextTokens(system);
  for (const message of messages) {
    rawTokens += MESSAGE_OVERHEAD_TOKENS + estimateContentTokens(message.content);
  }
  return {
    rawTokens,
    estimatedInputTokens: Math.ceil(rawTokens * ESTIMATOR_MARGIN_MULTIPLIER)
      + ESTIMATOR_FIXED_MARGIN_TOKENS,
    estimatorVersion: FABLE_CHAT_CONTEXT_ESTIMATOR_VERSION,
  };
}

function cloneMessage(message) {
  return {
    role: message.role,
    content: typeof message.content === "string"
      ? message.content
      : JSON.parse(JSON.stringify(message.content)),
  };
}

function addCacheControlToLastStableMessage(messages) {
  if (messages.length < 2) return null;
  const stableMessageIndex = messages.length - 2;
  const stableMessage = messages[stableMessageIndex];
  let content = stableMessage.content;
  if (typeof content === "string") {
    content = [{ type: "text", text: content }];
  } else {
    content = JSON.parse(JSON.stringify(content));
  }
  let blockIndex = -1;
  for (let index = content.length - 1; index >= 0; index -= 1) {
    if (content[index]?.type === "text") {
      blockIndex = index;
      break;
    }
  }
  if (blockIndex < 0) return null;
  content[blockIndex] = {
    ...content[blockIndex],
    cache_control: { type: "ephemeral", ttl: "5m" },
  };
  stableMessage.content = content;
  return { messageIndex: stableMessageIndex, blockIndex };
}

function textCharacterCount(system, messages) {
  let characters = String(system || "").length;
  for (const message of messages) {
    if (typeof message.content === "string") {
      characters += message.content.length;
      continue;
    }
    for (const block of message.content || []) {
      if (block.type === "text") characters += String(block.text || "").length;
      if (block.type === "thinking") characters += String(block.thinking || "").length;
      if (block.type === "server_tool_use" || block.type === "web_search_tool_result") {
        characters += JSON.stringify(block).length;
      }
      if (block.type === "text" && block.citations) characters += JSON.stringify(block.citations).length;
    }
  }
  return characters;
}

export function estimateFableChatCacheEligibilityTokens({ system, messages }) {
  let bytes = utf8ByteLength(system);
  for (const message of messages) {
    if (typeof message.content === "string") {
      bytes += utf8ByteLength(message.content);
      continue;
    }
    for (const block of message.content || []) {
      if (block.type === "text") bytes += utf8ByteLength(block.text);
      if (block.type === "thinking") {
        bytes += utf8ByteLength(block.thinking) + utf8ByteLength(block.signature);
      }
      if (block.type === "server_tool_use" || block.type === "web_search_tool_result") {
        bytes += utf8ByteLength(JSON.stringify(block));
      }
      if (block.type === "text" && block.citations) {
        bytes += utf8ByteLength(JSON.stringify(block.citations));
      }
    }
  }
  // This deliberately under-estimates typical Fable tokenization for cache admission.
  return Math.floor(bytes / 8);
}

export function selectFableChatModelContext({
  system,
  priorTurnsNewestFirst,
  currentMessage,
  effectiveInputTokenLimit,
  totalPriorTurns,
  promptCachePolicy = FABLE_CHAT_PROMPT_CACHE_POLICY,
  promptCacheVersion = FABLE_CHAT_PROMPT_CACHE_VERSION,
}) {
  const current = { role: "user", content: currentMessage };
  const selectedNewestFirst = [];

  for (const turn of priorTurnsNewestFirst) {
    const assistantContent = turn.assistantProviderBlocks
      ? normalizeFableChatProviderBlocks(turn.assistantProviderBlocks)
      : String(turn.assistantContent || "");
    const candidateNewestFirst = [
      ...selectedNewestFirst,
      {
        user: { role: "user", content: String(turn.userContent || "") },
        assistant: { role: "assistant", content: assistantContent },
      },
    ];
    const candidateMessages = candidateNewestFirst
      .slice()
      .reverse()
      .flatMap((entry) => [cloneMessage(entry.user), cloneMessage(entry.assistant)]);
    candidateMessages.push(current);
    const estimate = estimateFableChatInputTokens({ system, messages: candidateMessages });
    if (estimate.estimatedInputTokens > effectiveInputTokenLimit) break;
    selectedNewestFirst.push(candidateNewestFirst.at(-1));
  }

  const selected = selectedNewestFirst.slice().reverse();
  const messages = selected.flatMap((entry) => [cloneMessage(entry.user), cloneMessage(entry.assistant)]);
  messages.push(current);

  const stablePrefixMessages = messages.slice(0, -1);
  const stablePrefixEstimate = stablePrefixMessages.length > 0
    ? estimateFableChatCacheEligibilityTokens({ system, messages: stablePrefixMessages })
    : 0;
  let cacheBreakpoint = {
    enabled: false,
    policy: promptCachePolicy,
    version: promptCacheVersion,
    estimatedPrefixTokens: stablePrefixEstimate,
  };
  if (
    promptCachePolicy === FABLE_CHAT_PROMPT_CACHE_POLICY
    && promptCacheVersion === FABLE_CHAT_PROMPT_CACHE_VERSION
    && stablePrefixEstimate >= FABLE_CHAT_PROMPT_CACHE_MINIMUM_TOKENS
  ) {
    const location = addCacheControlToLastStableMessage(messages);
    if (location) cacheBreakpoint = { ...cacheBreakpoint, enabled: true, ...location };
  }

  const estimate = estimateFableChatInputTokens({ system, messages });
  if (estimate.estimatedInputTokens > effectiveInputTokenLimit) {
    throw new RangeError("The current message exceeds the Fable chat input budget.");
  }
  const includedTurns = selected.length;
  const omittedTurns = Math.max(0, Number(totalPriorTurns || 0) - includedTurns);
  return {
    system,
    messages,
    context: {
      includedTurns,
      omittedTurns,
      olderTurnsOmitted: omittedTurns > 0,
      characterCount: textCharacterCount(system, messages),
      estimatedInputTokens: estimate.estimatedInputTokens,
      effectiveInputTokenLimit,
      estimatorVersion: FABLE_CHAT_CONTEXT_ESTIMATOR_VERSION,
      contextFormatVersion: FABLE_CHAT_CONTEXT_FORMAT_VERSION,
      cacheBreakpoint,
    },
  };
}
