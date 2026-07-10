import {
  FABLE_CHAT_CONTEXT_ESTIMATOR_VERSION,
  FABLE_CHAT_CONTEXT_FORMAT_VERSION,
  FABLE_CHAT_MAX_PROVIDER_BLOCKS,
  FABLE_CHAT_MAX_PROVIDER_BLOCKS_JSON_BYTES,
  FABLE_CHAT_MAX_REASONING_SUMMARY_CHARACTERS,
  FABLE_CHAT_MAX_THINKING_SIGNATURE_BYTES,
  FABLE_CHAT_PROMPT_CACHE_MINIMUM_TOKENS,
  FABLE_CHAT_PROMPT_CACHE_POLICY,
  FABLE_CHAT_PROMPT_CACHE_VERSION,
} from "../../../shared/fable-chat-contract.mjs";

const TEXT_ENCODER = new TextEncoder();
const DISALLOWED_CONTENT_CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const ESTIMATOR_MARGIN_MULTIPLIER = 1.12;
const ESTIMATOR_FIXED_MARGIN_TOKENS = 256;
const MESSAGE_OVERHEAD_TOKENS = 12;
const CONTENT_BLOCK_OVERHEAD_TOKENS = 8;

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
      if (Object.keys(block).some((key) => !["type", "text"].includes(key))) {
        throw new TypeError(`Provider text block ${index} is invalid.`);
      }
      const text = assertSafeProviderText(block.text, `Provider text block ${index}`, 524_288);
      return { type: "text", text };
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
    throw new TypeError(`Provider content block ${index} has an unsupported type.`);
  });

  const serialized = JSON.stringify(normalized);
  if (utf8ByteLength(serialized) > FABLE_CHAT_MAX_PROVIDER_BLOCKS_JSON_BYTES) {
    throw new TypeError("Provider content blocks are too large.");
  }
  return normalized;
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
    } else if (block?.type === "thinking") {
      tokens += estimateFableChatTextTokens(block.thinking);
      tokens += Math.ceil(utf8ByteLength(block.signature) / 2);
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
      : message.content.map((block) => ({ ...block })),
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
    content = content.map((block) => ({ ...block }));
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
