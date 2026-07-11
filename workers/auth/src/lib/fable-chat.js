import {
  FABLE_CHAT_CONTEXT_CHARACTER_COMPAT_LIMIT,
  FABLE_CHAT_CONTEXT_ESTIMATOR_VERSION,
  FABLE_CHAT_CONTEXT_FORMAT_VERSION,
  FABLE_CHAT_DEFAULT_EFFORT,
  FABLE_CHAT_DEFAULT_SYSTEM_PRESET_ID,
  FABLE_CHAT_DEFAULT_THINKING_DISPLAY,
  FABLE_CHAT_DEFAULT_TITLE,
  FABLE_CHAT_DEFAULT_WEB_SEARCH_ENABLED,
  FABLE_CHAT_EFFORTS,
  FABLE_CHAT_HARD_OUTPUT_TOKEN_LIMIT,
  FABLE_CHAT_MAX_ASSISTANT_MESSAGE_CHARACTERS,
  FABLE_CHAT_MAX_CITATIONS,
  FABLE_CHAT_MAX_CONTEXT_PRIOR_TURNS,
  FABLE_CHAT_MAX_REASONING_SUMMARY_CHARACTERS,
  FABLE_CHAT_MAX_SOURCE_TITLE_CHARACTERS,
  FABLE_CHAT_MAX_SOURCE_URL_CHARACTERS,
  FABLE_CHAT_MAX_TITLE_CHARACTERS,
  FABLE_CHAT_MAX_USER_MESSAGE_CHARACTERS,
  FABLE_CHAT_MODEL_ID,
  FABLE_CHAT_PROMPT_CACHE_POLICY,
  FABLE_CHAT_PROMPT_CACHE_VERSION,
  FABLE_CHAT_PROVIDER_BLOCKS_VERSION,
  FABLE_CHAT_SYSTEM_PRESET_IDS,
  FABLE_CHAT_SYSTEM_PRESET_VERSION,
  FABLE_CHAT_THINKING_DISPLAYS,
  FABLE_CHAT_TURN_EXPIRY_MINUTES,
  FABLE_CHAT_WEB_SEARCH_CONTRACT_VERSION,
  FABLE_CHAT_WEB_SEARCH_MAX_USES,
  FABLE_CHAT_WEB_SEARCH_TOOL_TYPE,
  buildFableChatSystemPrompt,
  getFableChatEffectiveInputTokenLimit,
  getFableChatOutputTokenLimit,
} from "../../../shared/fable-chat-contract.mjs";
import {
  extractFableChatAssistantText,
  extractFableChatCitations,
  extractFableChatReasoningSummary,
  countFableChatWebSearchBlocks,
  normalizeFableChatProviderBlocks,
  selectFableChatModelContext,
  utf8ByteLength,
} from "./fable-chat-context.js";
import {
  decodePaginationCursor,
  encodePaginationCursor,
  readCursorInteger,
  readCursorString,
  resolvePaginationLimit,
} from "./pagination.js";
import { addMinutesIso, nowIso, randomTokenHex, sha256Hex } from "./tokens.js";

export {
  FABLE_CHAT_DEFAULT_EFFORT,
  FABLE_CHAT_DEFAULT_TITLE,
  FABLE_CHAT_HARD_OUTPUT_TOKEN_LIMIT,
  FABLE_CHAT_MAX_ASSISTANT_MESSAGE_CHARACTERS,
  FABLE_CHAT_MAX_TITLE_CHARACTERS,
  FABLE_CHAT_MAX_USER_MESSAGE_CHARACTERS,
  FABLE_CHAT_MODEL_ID,
};
export const FABLE_CHAT_CONTEXT_CHARACTER_LIMIT = FABLE_CHAT_CONTEXT_CHARACTER_COMPAT_LIMIT;
export const FABLE_CHAT_CONTEXT_PRIOR_TURN_LIMIT = FABLE_CHAT_MAX_CONTEXT_PRIOR_TURNS;
export const FABLE_CHAT_DEFAULT_OUTPUT_TOKENS = getFableChatOutputTokenLimit(FABLE_CHAT_DEFAULT_EFFORT);
export const FABLE_CHAT_SYSTEM_PROMPT = buildFableChatSystemPrompt(
  FABLE_CHAT_DEFAULT_SYSTEM_PRESET_ID,
  FABLE_CHAT_SYSTEM_PRESET_VERSION
);

const CONVERSATION_CURSOR_TYPE = "admin_fable_chat_conversations";
const MESSAGE_CURSOR_TYPE = "admin_fable_chat_messages";
const CURSOR_TTL_MS = 24 * 60 * 60_000;
const TURN_EXPIRY_MINUTES = FABLE_CHAT_TURN_EXPIRY_MINUTES;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const CONVERSATION_ID_PATTERN = /^fbc_[a-f0-9]{32}$/;
const MESSAGE_ID_PATTERN = /^fbm_[a-f0-9]{32}$/;
const DISALLOWED_CONTENT_CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export class FableChatError extends Error {
  constructor(message, { status = 400, code = "fable_chat_error", fields = {} } = {}) {
    super(message);
    this.name = "FableChatError";
    this.status = status;
    this.code = code;
    this.fields = Object.freeze({ ...fields });
  }
}

function opaqueId(prefix) {
  return `${prefix}_${randomTokenHex(16)}`;
}

function assertPlainObject(value, fieldName = "Request body") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FableChatError(`${fieldName} must be an object.`, {
      code: "validation_error",
    });
  }
}

function assertOnlyFields(value, allowed) {
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new FableChatError("Request contains unsupported fields.", {
      code: "validation_error",
    });
  }
}

function normalizeLineEndings(value) {
  return String(value).replace(/\r\n?/g, "\n");
}

function hasDisallowedControls(value) {
  return DISALLOWED_CONTENT_CONTROL_PATTERN.test(value);
}

export function normalizeFableChatIdempotencyKey(value) {
  const key = String(value || "").trim();
  if (!key) {
    throw new FableChatError("Idempotency-Key header is required.", {
      status: 428,
      code: "idempotency_key_required",
    });
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new FableChatError("Invalid Idempotency-Key header.", {
      code: "invalid_idempotency_key",
    });
  }
  return key;
}

export function normalizeFableChatConversationId(value) {
  const id = String(value || "").trim();
  if (!CONVERSATION_ID_PATTERN.test(id)) {
    throw new FableChatError("Conversation not found.", {
      status: 404,
      code: "not_found",
    });
  }
  return id;
}

export function normalizeFableChatMessageId(value) {
  const id = String(value || "").trim();
  if (!MESSAGE_ID_PATTERN.test(id)) {
    throw new FableChatError("Message not found.", {
      status: 404,
      code: "not_found",
    });
  }
  return id;
}

export function normalizeFableChatEffort(value) {
  const effort = String(value || "").trim();
  if (!FABLE_CHAT_EFFORTS.includes(effort)) {
    throw new FableChatError("effort must be medium, high, xhigh, or max.", {
      code: "validation_error",
    });
  }
  return effort;
}

export function normalizeFableChatSystemPresetId(value) {
  const presetId = String(value || "").trim();
  if (!FABLE_CHAT_SYSTEM_PRESET_IDS.includes(presetId)) {
    throw new FableChatError("systemPresetId is not supported.", {
      code: "validation_error",
    });
  }
  return presetId;
}

function normalizeSummarizedThinking(value) {
  if (typeof value !== "boolean") {
    throw new FableChatError("summarizedThinking must be a boolean.", {
      code: "validation_error",
    });
  }
  return value ? "summarized" : "omitted";
}

export function normalizeFableChatWebSearchEnabled(value) {
  if (typeof value !== "boolean") {
    throw new FableChatError("webSearchEnabled must be a boolean.", {
      code: "validation_error",
    });
  }
  return value;
}

function validateFableChatSettingsFields(body, { allowEmpty = false } = {}) {
  assertPlainObject(body);
  assertOnlyFields(body, new Set([
    "effort", "systemPresetId", "summarizedThinking", "webSearchEnabled",
  ]));
  if (!allowEmpty && Object.keys(body).length === 0) {
    throw new FableChatError("At least one conversation setting is required.", {
      code: "validation_error",
    });
  }
  return {
    ...(body.effort === undefined ? {} : { effort: normalizeFableChatEffort(body.effort) }),
    ...(body.systemPresetId === undefined
      ? {}
      : { systemPresetId: normalizeFableChatSystemPresetId(body.systemPresetId) }),
    ...(body.summarizedThinking === undefined
      ? {}
      : { thinkingDisplay: normalizeSummarizedThinking(body.summarizedThinking) }),
    ...(body.webSearchEnabled === undefined
      ? {}
      : { webSearchEnabled: normalizeFableChatWebSearchEnabled(body.webSearchEnabled) }),
  };
}

export function validateCreateFableChatBody(body) {
  return validateFableChatSettingsFields(body, { allowEmpty: true });
}

export function validateUpdateFableChatSettingsBody(body) {
  return validateFableChatSettingsFields(body);
}

export function normalizeFableChatUserMessage(value) {
  if (typeof value !== "string") {
    throw new FableChatError("message must be a string.", {
      code: "validation_error",
    });
  }
  const message = normalizeLineEndings(value).trim();
  if (!message) {
    throw new FableChatError("message must not be empty.", {
      code: "validation_error",
    });
  }
  if (message.length > FABLE_CHAT_MAX_USER_MESSAGE_CHARACTERS) {
    throw new FableChatError(
      `message must be at most ${FABLE_CHAT_MAX_USER_MESSAGE_CHARACTERS} characters.`,
      { code: "validation_error" }
    );
  }
  if (hasDisallowedControls(message)) {
    throw new FableChatError("message contains unsupported control characters.", {
      code: "validation_error",
    });
  }
  return message;
}

export function validateSendFableChatBody(body) {
  assertPlainObject(body);
  assertOnlyFields(body, new Set(["message", "retry_message_id"]));
  return {
    message: normalizeFableChatUserMessage(body.message),
    retryMessageId: body.retry_message_id == null || body.retry_message_id === ""
      ? null
      : normalizeFableChatMessageId(body.retry_message_id),
  };
}

export function normalizeFableChatTitle(value) {
  if (typeof value !== "string") {
    throw new FableChatError("title must be a string.", {
      code: "validation_error",
    });
  }
  const title = normalizeLineEndings(value).replace(/\s+/g, " ").trim();
  if (!title || title.length > FABLE_CHAT_MAX_TITLE_CHARACTERS || hasDisallowedControls(title)) {
    throw new FableChatError(
      `title must contain 1 to ${FABLE_CHAT_MAX_TITLE_CHARACTERS} valid characters.`,
      { code: "validation_error" }
    );
  }
  return title;
}

export function validateRenameFableChatBody(body) {
  assertPlainObject(body);
  assertOnlyFields(body, new Set(["title"]));
  return { title: normalizeFableChatTitle(body.title) };
}

export function buildInitialFableChatTitle(message) {
  const normalized = normalizeFableChatUserMessage(message)
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length <= FABLE_CHAT_MAX_TITLE_CHARACTERS) return normalized;
  return `${normalized.slice(0, FABLE_CHAT_MAX_TITLE_CHARACTERS - 3).trimEnd()}...`;
}

function parseJsonObject(value) {
  if (!value || typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeStoredSources(value) {
  if (!Array.isArray(value)) return [];
  const sources = new Map();
  for (const entry of value.slice(0, FABLE_CHAT_MAX_CITATIONS)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    if (Object.keys(entry).some((key) => !["url", "title", "type"].includes(key))) continue;
    if (entry.type !== "web_search_result_location") continue;
    if (typeof entry.url !== "string" || entry.url.length > FABLE_CHAT_MAX_SOURCE_URL_CHARACTERS) {
      continue;
    }
    let url;
    try {
      url = new URL(entry.url);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" || url.username || url.password) continue;
    const title = typeof entry.title === "string"
      ? entry.title.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, FABLE_CHAT_MAX_SOURCE_TITLE_CHARACTERS)
      : "";
    if (!sources.has(url.href)) {
      sources.set(url.href, {
        url: url.href,
        title,
        type: "web_search_result_location",
      });
    }
  }
  return [...sources.values()];
}

function safeProviderString(value, maxLength = 160) {
  if (value == null || value === "") return null;
  return String(value).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength) || null;
}

function safeProviderErrorCode(value) {
  const normalized = safeProviderString(value, 80);
  return normalized && /^[A-Za-z0-9._:-]+$/.test(normalized)
    ? normalized
    : "provider_failed";
}

export function sanitizeFableChatUsage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output = {};
  for (const key of [
    "input_tokens",
    "output_tokens",
    "cache_read_input_tokens",
    "cache_creation_input_tokens",
  ]) {
    const numeric = Number(value[key]);
    if (Number.isFinite(numeric) && numeric >= 0) output[key] = Math.floor(numeric);
  }
  const thinkingTokens = Number(value?.output_tokens_details?.thinking_tokens);
  if (Number.isFinite(thinkingTokens) && thinkingTokens >= 0) {
    output.output_tokens_details = { thinking_tokens: Math.floor(thinkingTokens) };
  }
  const searchRequests = Number(value?.server_tool_use?.web_search_requests);
  if (Number.isFinite(searchRequests) && searchRequests >= 0) {
    output.server_tool_use = { web_search_requests: Math.min(1, Math.floor(searchRequests)) };
  }
  return output;
}

export function sanitizeFableChatGatewayMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const keySource = safeProviderString(value.keySource, 40);
  return keySource ? { key_source: keySource } : {};
}

export function resolveFableChatConversationSettings(row) {
  if (!row) return null;
  const effort = FABLE_CHAT_EFFORTS.includes(row.effort) ? row.effort : FABLE_CHAT_DEFAULT_EFFORT;
  const presetId = FABLE_CHAT_SYSTEM_PRESET_IDS.includes(row.system_preset_id)
    ? row.system_preset_id
    : FABLE_CHAT_DEFAULT_SYSTEM_PRESET_ID;
  const presetVersion = Number(row.system_preset_version || FABLE_CHAT_SYSTEM_PRESET_VERSION);
  const thinkingDisplay = FABLE_CHAT_THINKING_DISPLAYS.includes(row.thinking_display)
    ? row.thinking_display
    : FABLE_CHAT_DEFAULT_THINKING_DISPLAY;
  const effectiveMaxOutputTokens = getFableChatOutputTokenLimit(effort);
  return {
    effort,
    effectiveMaxOutputTokens,
    effectiveInputTokenLimit: getFableChatEffectiveInputTokenLimit(effectiveMaxOutputTokens),
    systemPresetId: presetId,
    systemPresetVersion: presetVersion,
    summarizedThinking: thinkingDisplay === "summarized",
    thinkingDisplay,
    promptCachePolicy: row.prompt_cache_policy || FABLE_CHAT_PROMPT_CACHE_POLICY,
    promptCacheVersion: Number(row.prompt_cache_version || FABLE_CHAT_PROMPT_CACHE_VERSION),
    webSearchEnabled: Number(row.web_search_enabled || 0) === 1,
    webSearchToolVersion: FABLE_CHAT_WEB_SEARCH_TOOL_TYPE,
    webSearchMaxUses: FABLE_CHAT_WEB_SEARCH_MAX_USES,
    webSearchContractVersion: FABLE_CHAT_WEB_SEARCH_CONTRACT_VERSION,
    updatedAt: row.settings_updated_at || row.created_at,
  };
}

export function serializeFableChatConversation(row) {
  if (!row) return null;
  const settings = resolveFableChatConversationSettings(row);
  return {
    id: row.id,
    title: row.title,
    model: FABLE_CHAT_MODEL_ID,
    turnCount: Number(row.turn_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    settings,
  };
}

export function serializeFableChatMessage(row) {
  if (!row) return null;
  const metadata = parseJsonObject(row.metadata_json);
  let sources = [];
  if (row.role === "assistant" && typeof row.citations_json === "string") {
    try {
      const parsed = JSON.parse(row.citations_json);
      if (Array.isArray(parsed)) sources = normalizeStoredSources(parsed);
    } catch {
      sources = [];
    }
  }
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    state: row.state,
    createdAt: row.created_at,
    ...(row.role === "assistant" && row.reasoning_summary
      ? { reasoningSummary: row.reasoning_summary }
      : {}),
    ...(row.role === "assistant" && metadata.output_truncated === true
      ? { truncated: true }
      : {}),
    ...(row.role === "assistant" && sources.length > 0 ? { sources } : {}),
  };
}

function serializeFableChatTurn(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    userMessageId: row.user_message_id,
    assistantMessageId: row.assistant_message_id || null,
    retryOfTurnId: row.retry_of_turn_id || null,
    errorCode: row.error_code || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || null,
    expiresAt: row.expires_at,
    requestFingerprint: row.request_fingerprint,
    idempotencyKeyHash: row.idempotency_key_hash,
    effort: row.effort || FABLE_CHAT_DEFAULT_EFFORT,
    effectiveMaxOutputTokens: Number(
      row.effective_max_output_tokens
      || getFableChatOutputTokenLimit(row.effort || FABLE_CHAT_DEFAULT_EFFORT)
    ),
    systemPresetId: row.system_preset_id || FABLE_CHAT_DEFAULT_SYSTEM_PRESET_ID,
    systemPresetVersion: Number(row.system_preset_version || FABLE_CHAT_SYSTEM_PRESET_VERSION),
    thinkingDisplay: row.thinking_display || FABLE_CHAT_DEFAULT_THINKING_DISPLAY,
    webSearchEnabled: Number(row.web_search_enabled || 0) === 1,
    webSearchRequestCount: Number(row.web_search_request_count || 0),
    webSearchResultCount: Number(row.web_search_result_count || 0),
    outputTruncated: Number(row.output_truncated || 0) === 1,
  };
}

async function readConversationRow(env, adminUserId, conversationId) {
  return env.DB.prepare(
    `SELECT id, admin_user_id, model_id, title, title_source, turn_count,
            effort, system_preset_id, system_preset_version, thinking_display,
            prompt_cache_policy, prompt_cache_version, web_search_enabled, settings_updated_at,
            created_at, updated_at, deleted_at
       FROM fable_chat_conversations
      WHERE id = ? AND admin_user_id = ? AND deleted_at IS NULL
      LIMIT 1`
  ).bind(conversationId, adminUserId).first();
}

export async function getFableChatConversation(env, adminUserId, conversationId) {
  return serializeFableChatConversation(
    await readConversationRow(env, adminUserId, normalizeFableChatConversationId(conversationId))
  );
}

export async function getFableChatConversationSettings(env, adminUserId, conversationId) {
  const row = await readConversationRow(
    env,
    adminUserId,
    normalizeFableChatConversationId(conversationId)
  );
  return row ? resolveFableChatConversationSettings(row) : null;
}

export async function createFableChatConversation(env, adminUserId, settings = {}) {
  const id = opaqueId("fbc");
  const now = nowIso();
  const effort = settings.effort || FABLE_CHAT_DEFAULT_EFFORT;
  const systemPresetId = settings.systemPresetId || FABLE_CHAT_DEFAULT_SYSTEM_PRESET_ID;
  const thinkingDisplay = settings.thinkingDisplay || FABLE_CHAT_DEFAULT_THINKING_DISPLAY;
  const webSearchEnabled = settings.webSearchEnabled ?? FABLE_CHAT_DEFAULT_WEB_SEARCH_ENABLED;
  await env.DB.prepare(
    `INSERT INTO fable_chat_conversations (
       id, admin_user_id, model_id, title, title_source, turn_count,
       effort, system_preset_id, system_preset_version, thinking_display,
       prompt_cache_policy, prompt_cache_version, web_search_enabled, settings_updated_at,
       created_at, updated_at, deleted_at
     ) VALUES (?, ?, ?, ?, 'automatic', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
  ).bind(
    id,
    adminUserId,
    FABLE_CHAT_MODEL_ID,
    FABLE_CHAT_DEFAULT_TITLE,
    effort,
    systemPresetId,
    FABLE_CHAT_SYSTEM_PRESET_VERSION,
    thinkingDisplay,
    FABLE_CHAT_PROMPT_CACHE_POLICY,
    FABLE_CHAT_PROMPT_CACHE_VERSION,
    webSearchEnabled ? 1 : 0,
    now,
    now,
    now
  ).run();
  return getFableChatConversation(env, adminUserId, id);
}

function validateCursorOwner(cursor, adminUserId) {
  if (readCursorString(cursor, "u", { maxLength: 120 }) !== adminUserId) {
    throw new FableChatError("Invalid cursor.", { code: "validation_error" });
  }
  const expiresAt = readCursorInteger(cursor, "exp", { min: 0 });
  if (expiresAt < Date.now()) {
    throw new FableChatError("Cursor has expired.", { code: "validation_error" });
  }
}

export async function listFableChatConversations(env, adminUserId, {
  limit = null,
  cursor = null,
} = {}) {
  const appliedLimit = resolvePaginationLimit(limit, { defaultValue: 30, maxValue: 50 });
  const decoded = cursor
    ? await decodePaginationCursor(env, cursor, CONVERSATION_CURSOR_TYPE)
    : null;
  let cursorUpdatedAt = null;
  let cursorId = null;
  if (decoded) {
    validateCursorOwner(decoded, adminUserId);
    cursorUpdatedAt = readCursorString(decoded, "c", { maxLength: 40 });
    cursorId = readCursorString(decoded, "i", { maxLength: 40 });
  }

  const rows = await env.DB.prepare(
    `SELECT id, admin_user_id, model_id, title, title_source, turn_count,
            effort, system_preset_id, system_preset_version, thinking_display,
            prompt_cache_policy, prompt_cache_version, web_search_enabled, settings_updated_at,
            created_at, updated_at, deleted_at
       FROM fable_chat_conversations
      WHERE admin_user_id = ?
        AND deleted_at IS NULL
        AND (? IS NULL OR updated_at < ? OR (updated_at = ? AND id < ?))
      ORDER BY updated_at DESC, id DESC
      LIMIT ?`
  ).bind(
    adminUserId,
    cursorUpdatedAt,
    cursorUpdatedAt,
    cursorUpdatedAt,
    cursorId,
    appliedLimit + 1
  ).all();
  const values = rows?.results || [];
  const hasMore = values.length > appliedLimit;
  const page = hasMore ? values.slice(0, appliedLimit) : values;
  const last = page.at(-1) || null;
  return {
    conversations: page.map(serializeFableChatConversation),
    appliedLimit,
    hasMore,
    nextCursor: hasMore && last
      ? await encodePaginationCursor(env, CONVERSATION_CURSOR_TYPE, {
          u: adminUserId,
          c: last.updated_at,
          i: last.id,
          exp: Date.now() + CURSOR_TTL_MS,
        })
      : null,
  };
}

export async function updateFableChatConversationSettings(
  env,
  adminUserId,
  conversationId,
  updates
) {
  const id = normalizeFableChatConversationId(conversationId);
  const current = await readConversationRow(env, adminUserId, id);
  if (!current) return null;
  const effort = updates.effort || current.effort || FABLE_CHAT_DEFAULT_EFFORT;
  const systemPresetId = updates.systemPresetId
    || current.system_preset_id
    || FABLE_CHAT_DEFAULT_SYSTEM_PRESET_ID;
  const thinkingDisplay = updates.thinkingDisplay
    || current.thinking_display
    || FABLE_CHAT_DEFAULT_THINKING_DISPLAY;
  const webSearchEnabled = updates.webSearchEnabled ?? (Number(current.web_search_enabled || 0) === 1);
  const updatedAt = nowIso();
  const result = await env.DB.prepare(
    `UPDATE fable_chat_conversations
        SET effort = ?, system_preset_id = ?, system_preset_version = ?,
            thinking_display = ?, prompt_cache_policy = ?, prompt_cache_version = ?,
            web_search_enabled = ?, settings_updated_at = ?, updated_at = ?
      WHERE id = ? AND admin_user_id = ? AND deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM fable_chat_turns t
           WHERE t.conversation_id = fable_chat_conversations.id
             AND t.admin_user_id = ? AND t.status IN ('pending', 'running')
        )`
  ).bind(
    effort,
    systemPresetId,
    FABLE_CHAT_SYSTEM_PRESET_VERSION,
    thinkingDisplay,
    FABLE_CHAT_PROMPT_CACHE_POLICY,
    FABLE_CHAT_PROMPT_CACHE_VERSION,
    webSearchEnabled ? 1 : 0,
    updatedAt,
    updatedAt,
    id,
    adminUserId,
    adminUserId
  ).run();
  if (!Number(result?.meta?.changes || 0)) {
    const existing = await readConversationRow(env, adminUserId, id);
    if (!existing) return null;
    throw new FableChatError("Conversation settings cannot change while a message is running.", {
      status: 409,
      code: "fable_chat_settings_locked",
    });
  }
  return getFableChatConversation(env, adminUserId, id);
}

export async function renameFableChatConversation(env, adminUserId, conversationId, title) {
  const id = normalizeFableChatConversationId(conversationId);
  const normalizedTitle = normalizeFableChatTitle(title);
  const result = await env.DB.prepare(
    `UPDATE fable_chat_conversations
        SET title = ?, title_source = 'manual', updated_at = ?
      WHERE id = ? AND admin_user_id = ? AND deleted_at IS NULL`
  ).bind(normalizedTitle, nowIso(), id, adminUserId).run();
  if (!result?.meta?.changes) return null;
  return getFableChatConversation(env, adminUserId, id);
}

export async function deleteFableChatConversation(env, adminUserId, conversationId) {
  const id = normalizeFableChatConversationId(conversationId);
  await expireStaleFableChatTurns(env, adminUserId, id);
  const deletedAt = nowIso();
  const result = await env.DB.prepare(
    `UPDATE fable_chat_conversations
        SET deleted_at = ?, updated_at = ?
      WHERE id = ? AND admin_user_id = ? AND deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM fable_chat_turns t
           WHERE t.conversation_id = fable_chat_conversations.id
             AND t.admin_user_id = ? AND t.status IN ('pending', 'running')
        )`
  ).bind(deletedAt, deletedAt, id, adminUserId, adminUserId).run();
  if (Number(result?.meta?.changes || 0) > 0) return { deleted: true, active: false };
  const conversation = await readConversationRow(env, adminUserId, id);
  if (!conversation) return null;
  return { deleted: false, active: true };
}

export async function listFableChatMessages(env, adminUserId, conversationId, {
  limit = null,
  cursor = null,
} = {}) {
  const id = normalizeFableChatConversationId(conversationId);
  const conversation = await readConversationRow(env, adminUserId, id);
  if (!conversation) return null;
  const appliedLimit = resolvePaginationLimit(limit, { defaultValue: 80, maxValue: 100 });
  const decoded = cursor ? await decodePaginationCursor(env, cursor, MESSAGE_CURSOR_TYPE) : null;
  let cursorTurnOrder = null;
  let cursorRoleOrder = null;
  let cursorId = null;
  if (decoded) {
    validateCursorOwner(decoded, adminUserId);
    if (readCursorString(decoded, "q", { maxLength: 40 }) !== id) {
      throw new FableChatError("Invalid cursor.", { code: "validation_error" });
    }
    cursorTurnOrder = readCursorInteger(decoded, "n", { min: 0 });
    cursorRoleOrder = readCursorInteger(decoded, "o", { min: 0, max: 1 });
    cursorId = readCursorString(decoded, "i", { maxLength: 40 });
  }

  const rows = await env.DB.prepare(
    `SELECT m.id, m.turn_order, m.role, m.role_order, m.content, m.state,
            m.metadata_json, m.reasoning_summary, m.citations_json, m.created_at, m.updated_at
       FROM fable_chat_messages m
       INNER JOIN fable_chat_conversations c ON c.id = m.conversation_id
      WHERE m.conversation_id = ?
        AND m.admin_user_id = ?
        AND c.admin_user_id = ?
        AND c.deleted_at IS NULL
        AND (
          ? IS NULL OR m.turn_order < ? OR
          (m.turn_order = ? AND m.role_order < ?) OR
          (m.turn_order = ? AND m.role_order = ? AND m.id < ?)
        )
      ORDER BY m.turn_order DESC, m.role_order DESC, m.id DESC
      LIMIT ?`
  ).bind(
    id,
    adminUserId,
    adminUserId,
    cursorTurnOrder,
    cursorTurnOrder,
    cursorTurnOrder,
    cursorRoleOrder,
    cursorTurnOrder,
    cursorRoleOrder,
    cursorId,
    appliedLimit + 1
  ).all();
  const values = rows?.results || [];
  const hasMore = values.length > appliedLimit;
  const pageDescending = hasMore ? values.slice(0, appliedLimit) : values;
  const last = pageDescending.at(-1) || null;
  const latestContext = await env.DB.prepare(
    `SELECT t.context_included_turns, t.context_omitted_turns,
            t.context_character_count, t.estimated_input_tokens,
            t.effective_input_token_limit, t.context_estimator_version,
            t.cache_breakpoint_json, t.effective_max_output_tokens
       FROM fable_chat_turns t
       INNER JOIN fable_chat_conversations c ON c.id = t.conversation_id
      WHERE t.conversation_id = ? AND t.admin_user_id = ? AND t.status = 'succeeded'
        AND c.admin_user_id = ? AND c.deleted_at IS NULL
      ORDER BY t.completed_at DESC, t.id DESC
      LIMIT 1`
  ).bind(id, adminUserId, adminUserId).first();
  return {
    conversation: serializeFableChatConversation(conversation),
    messages: pageDescending.slice().reverse().map(serializeFableChatMessage),
    context: {
      includedTurns: Number(latestContext?.context_included_turns || 0),
      omittedTurns: Number(latestContext?.context_omitted_turns || 0),
      olderTurnsOmitted: Number(latestContext?.context_omitted_turns || 0) > 0,
      estimatedInputTokens: Number(latestContext?.estimated_input_tokens || 0),
      effectiveInputTokenLimit: Number(latestContext?.effective_input_token_limit || 0),
      estimatorVersion: latestContext?.context_estimator_version
        || FABLE_CHAT_CONTEXT_ESTIMATOR_VERSION,
      effectiveMaxOutputTokens: Number(latestContext?.effective_max_output_tokens || 0),
    },
    appliedLimit,
    hasMore,
    nextCursor: hasMore && last
      ? await encodePaginationCursor(env, MESSAGE_CURSOR_TYPE, {
          u: adminUserId,
          q: id,
          n: Number(last.turn_order),
          o: Number(last.role_order),
          i: last.id,
          exp: Date.now() + CURSOR_TTL_MS,
        })
      : null,
  };
}

async function readTurnByIdempotencyHash(env, adminUserId, conversationId, idempotencyKeyHash) {
  return env.DB.prepare(
    `SELECT t.id, t.conversation_id, t.admin_user_id, t.idempotency_key_hash, t.request_fingerprint,
            t.user_message_id, t.assistant_message_id, t.retry_of_turn_id, t.status, t.model_id,
            t.context_included_turns, t.context_omitted_turns, t.context_character_count,
            t.effort, t.effective_max_output_tokens, t.system_preset_id,
            t.system_preset_version, t.thinking_display, t.prompt_cache_policy,
            t.prompt_cache_version, t.context_format_version, t.estimated_input_tokens,
            t.effective_input_token_limit, t.context_estimator_version,
            t.web_search_enabled, t.web_search_tool_version, t.web_search_max_uses,
            t.web_search_contract_version, t.web_search_request_count, t.web_search_result_count,
            t.cache_breakpoint_json, t.settings_snapshot_json, t.provider_duration_ms,
            t.output_truncated,
            t.provider_model, t.stop_reason, t.stop_sequence, t.usage_json,
            t.gateway_metadata_json, t.error_code, t.created_at, t.updated_at,
            t.completed_at, t.expires_at
       FROM fable_chat_turns t
       INNER JOIN fable_chat_conversations c ON c.id = t.conversation_id
      WHERE t.conversation_id = ? AND t.admin_user_id = ? AND t.idempotency_key_hash = ?
        AND c.admin_user_id = ? AND c.deleted_at IS NULL
      LIMIT 1`
  ).bind(conversationId, adminUserId, idempotencyKeyHash, adminUserId).first();
}

async function readTurnById(env, turnId) {
  return env.DB.prepare(
    `SELECT id, conversation_id, admin_user_id, idempotency_key_hash, request_fingerprint,
            user_message_id, assistant_message_id, retry_of_turn_id, status, model_id, context_included_turns,
            context_omitted_turns, context_character_count, effort, effective_max_output_tokens,
            system_preset_id, system_preset_version, thinking_display, prompt_cache_policy,
            prompt_cache_version, context_format_version, estimated_input_tokens,
            effective_input_token_limit, context_estimator_version, cache_breakpoint_json,
            web_search_enabled, web_search_tool_version, web_search_max_uses,
            web_search_contract_version, web_search_request_count, web_search_result_count,
            settings_snapshot_json, provider_duration_ms, output_truncated,
            provider_model, stop_reason,
            stop_sequence, usage_json, gateway_metadata_json, error_code, created_at,
            updated_at, completed_at, expires_at
       FROM fable_chat_turns WHERE id = ? LIMIT 1`
  ).bind(turnId).first();
}

export async function getFableChatTurnByIdempotencyKey(
  env,
  adminUserId,
  conversationId,
  idempotencyKey
) {
  const id = normalizeFableChatConversationId(conversationId);
  const key = normalizeFableChatIdempotencyKey(idempotencyKey);
  const idempotencyKeyHash = await sha256Hex(key);
  const row = await readTurnByIdempotencyHash(env, adminUserId, id, idempotencyKeyHash);
  return row ? serializeFableChatTurn(row) : null;
}

export async function buildFableChatRequestFingerprint({
  conversationId,
  message,
  retryMessageId = null,
  settings,
}) {
  if (!settings || typeof settings !== "object") {
    throw new FableChatError("Conversation settings are unavailable.", {
      status: 503,
      code: "fable_chat_settings_unavailable",
    });
  }
  return sha256Hex(JSON.stringify({
    version: 3,
    conversation_id: normalizeFableChatConversationId(conversationId),
    message: normalizeFableChatUserMessage(message),
    retry_message_id: retryMessageId ? normalizeFableChatMessageId(retryMessageId) : null,
    model_id: FABLE_CHAT_MODEL_ID,
    effort: normalizeFableChatEffort(settings.effort),
    effective_max_output_tokens: getFableChatOutputTokenLimit(settings.effort),
    system_preset_id: normalizeFableChatSystemPresetId(settings.systemPresetId),
    system_preset_version: Number(settings.systemPresetVersion),
    thinking_display: FABLE_CHAT_THINKING_DISPLAYS.includes(settings.thinkingDisplay)
      ? settings.thinkingDisplay
      : FABLE_CHAT_DEFAULT_THINKING_DISPLAY,
    prompt_cache_policy: settings.promptCachePolicy,
    prompt_cache_version: Number(settings.promptCacheVersion),
    context_format_version: FABLE_CHAT_CONTEXT_FORMAT_VERSION,
    web_search_enabled: settings.webSearchEnabled === true,
    web_search_tool_version: FABLE_CHAT_WEB_SEARCH_TOOL_TYPE,
    web_search_max_uses: FABLE_CHAT_WEB_SEARCH_MAX_USES,
    web_search_contract_version: FABLE_CHAT_WEB_SEARCH_CONTRACT_VERSION,
  }));
}

function isUniqueConstraintError(error) {
  return /(?:UNIQUE constraint failed|D1_ERROR[^\n]*UNIQUE)/i.test(String(error?.message || error));
}

export async function beginFableChatTurn(env, {
  adminUserId,
  conversationId,
  idempotencyKey,
  requestFingerprint,
  message,
  retryMessageId = null,
  settings,
  context,
}) {
  const id = normalizeFableChatConversationId(conversationId);
  const key = normalizeFableChatIdempotencyKey(idempotencyKey);
  const normalizedMessage = normalizeFableChatUserMessage(message);
  const normalizedRetryMessageId = retryMessageId
    ? normalizeFableChatMessageId(retryMessageId)
    : null;
  const idempotencyKeyHash = await sha256Hex(key);
  const existing = await readTurnByIdempotencyHash(env, adminUserId, id, idempotencyKeyHash);
  if (existing) {
    if (existing.request_fingerprint !== requestFingerprint) {
      throw new FableChatError("Idempotency-Key conflicts with a different chat request.", {
        status: 409,
        code: "idempotency_conflict",
      });
    }
    return { kind: "existing", turn: serializeFableChatTurn(existing) };
  }

  const conversation = await readConversationRow(env, adminUserId, id);
  if (!conversation) {
    throw new FableChatError("Conversation not found.", { status: 404, code: "not_found" });
  }
  const appliedSettings = resolveFableChatConversationSettings(conversation);
  if (
    !settings
    || appliedSettings.effort !== settings.effort
    || appliedSettings.systemPresetId !== settings.systemPresetId
    || appliedSettings.systemPresetVersion !== Number(settings.systemPresetVersion)
    || appliedSettings.thinkingDisplay !== settings.thinkingDisplay
    || appliedSettings.promptCachePolicy !== settings.promptCachePolicy
    || appliedSettings.promptCacheVersion !== Number(settings.promptCacheVersion)
    || appliedSettings.webSearchEnabled !== (settings.webSearchEnabled === true)
  ) {
    throw new FableChatError("Conversation settings changed before this message was admitted.", {
      status: 409,
      code: "fable_chat_settings_conflict",
    });
  }
  const effectiveMaxOutputTokens = getFableChatOutputTokenLimit(appliedSettings.effort);
  const safeContext = {
    includedTurns: Math.max(0, Number(context?.includedTurns || 0)),
    omittedTurns: Math.max(0, Number(context?.omittedTurns || 0)),
    characterCount: Math.max(0, Number(context?.characterCount || 0)),
    estimatedInputTokens: Math.max(0, Number(context?.estimatedInputTokens || 0)),
    effectiveInputTokenLimit: Math.max(1, Number(context?.effectiveInputTokenLimit || 1)),
    estimatorVersion: context?.estimatorVersion || FABLE_CHAT_CONTEXT_ESTIMATOR_VERSION,
    cacheBreakpoint: context?.cacheBreakpoint && typeof context.cacheBreakpoint === "object"
      ? context.cacheBreakpoint
      : { enabled: false },
  };
  const settingsSnapshot = {
    modelId: FABLE_CHAT_MODEL_ID,
    effort: appliedSettings.effort,
    effectiveMaxOutputTokens,
    systemPresetId: appliedSettings.systemPresetId,
    systemPresetVersion: appliedSettings.systemPresetVersion,
    thinkingDisplay: appliedSettings.thinkingDisplay,
    promptCachePolicy: appliedSettings.promptCachePolicy,
    promptCacheVersion: appliedSettings.promptCacheVersion,
    contextFormatVersion: FABLE_CHAT_CONTEXT_FORMAT_VERSION,
    webSearchEnabled: appliedSettings.webSearchEnabled,
    webSearchToolVersion: FABLE_CHAT_WEB_SEARCH_TOOL_TYPE,
    webSearchMaxUses: FABLE_CHAT_WEB_SEARCH_MAX_USES,
    webSearchContractVersion: FABLE_CHAT_WEB_SEARCH_CONTRACT_VERSION,
  };

  const userMessageId = normalizedRetryMessageId || opaqueId("fbm");
  let messageGroupId = null;
  let turnOrder = Number(conversation.turn_count || 0);
  let retryOfTurnId = null;
  if (normalizedRetryMessageId) {
    const retryMessage = await env.DB.prepare(
      `SELECT m.id, m.message_group_id, m.turn_order, m.content, m.state,
              (
                SELECT t.id FROM fable_chat_turns t
                 WHERE t.user_message_id = m.id AND t.admin_user_id = m.admin_user_id
                   AND t.conversation_id = m.conversation_id
                   AND t.status = 'failed'
                 ORDER BY t.created_at DESC, t.id DESC
                 LIMIT 1
              ) AS failed_turn_id
         FROM fable_chat_messages m
         INNER JOIN fable_chat_conversations c ON c.id = m.conversation_id
        WHERE m.id = ? AND m.conversation_id = ? AND m.admin_user_id = ?
          AND m.role = 'user' AND m.turn_order = c.turn_count - 1
          AND c.admin_user_id = ? AND c.deleted_at IS NULL
        LIMIT 1`
    ).bind(normalizedRetryMessageId, id, adminUserId, adminUserId).first();
    if (
      !retryMessage
      || retryMessage.state !== "failed"
      || retryMessage.content !== normalizedMessage
      || !retryMessage.failed_turn_id
    ) {
      throw new FableChatError("The failed message is no longer eligible for retry.", {
        status: 409,
        code: "fable_chat_retry_conflict",
      });
    }
    messageGroupId = retryMessage.message_group_id;
    turnOrder = Number(retryMessage.turn_order);
    retryOfTurnId = retryMessage.failed_turn_id;
  }

  const turnId = opaqueId("fbt");
  if (!messageGroupId) messageGroupId = opaqueId("fbg");
  const createdAt = nowIso();
  const expiresAt = addMinutesIso(TURN_EXPIRY_MINUTES);
  const title = buildInitialFableChatTitle(normalizedMessage);
  try {
    const turnStatement = env.DB.prepare(
        `INSERT INTO fable_chat_turns (
           id, conversation_id, admin_user_id, idempotency_key_hash, request_fingerprint,
           user_message_id, assistant_message_id, retry_of_turn_id, status, model_id, context_included_turns,
           context_omitted_turns, context_character_count, effort, effective_max_output_tokens,
           system_preset_id, system_preset_version, thinking_display, prompt_cache_policy,
           prompt_cache_version, context_format_version, estimated_input_tokens,
           effective_input_token_limit, context_estimator_version, cache_breakpoint_json,
           web_search_enabled, web_search_tool_version, web_search_max_uses,
           web_search_contract_version, web_search_request_count, web_search_result_count,
           settings_snapshot_json, provider_duration_ms, output_truncated, provider_model, stop_reason,
           stop_sequence, usage_json, gateway_metadata_json, error_code, created_at,
           updated_at, completed_at, expires_at
         )
         SELECT ?, c.id, ?, ?, ?, ?, NULL, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, 0, 0, ?, NULL, 0, NULL, NULL, NULL, '{}', '{}', NULL, ?, ?, NULL, ?
           FROM fable_chat_conversations c
          WHERE c.id = ? AND c.admin_user_id = ? AND c.deleted_at IS NULL
            AND c.effort = ? AND c.system_preset_id = ? AND c.system_preset_version = ?
            AND c.thinking_display = ? AND c.prompt_cache_policy = ?
            AND c.prompt_cache_version = ? AND c.web_search_enabled = ?`
      ).bind(
        turnId,
        adminUserId,
        idempotencyKeyHash,
        requestFingerprint,
        userMessageId,
        retryOfTurnId,
        FABLE_CHAT_MODEL_ID,
        safeContext.includedTurns,
        safeContext.omittedTurns,
        safeContext.characterCount,
        appliedSettings.effort,
        effectiveMaxOutputTokens,
        appliedSettings.systemPresetId,
        appliedSettings.systemPresetVersion,
        appliedSettings.thinkingDisplay,
        appliedSettings.promptCachePolicy,
        appliedSettings.promptCacheVersion,
        FABLE_CHAT_CONTEXT_FORMAT_VERSION,
        safeContext.estimatedInputTokens,
        safeContext.effectiveInputTokenLimit,
        safeContext.estimatorVersion,
        JSON.stringify(safeContext.cacheBreakpoint),
        appliedSettings.webSearchEnabled ? 1 : 0,
        FABLE_CHAT_WEB_SEARCH_TOOL_TYPE,
        FABLE_CHAT_WEB_SEARCH_MAX_USES,
        FABLE_CHAT_WEB_SEARCH_CONTRACT_VERSION,
        JSON.stringify(settingsSnapshot),
        createdAt,
        createdAt,
        expiresAt,
        id,
        adminUserId,
        appliedSettings.effort,
        appliedSettings.systemPresetId,
        appliedSettings.systemPresetVersion,
        appliedSettings.thinkingDisplay,
        appliedSettings.promptCachePolicy,
        appliedSettings.promptCacheVersion,
        appliedSettings.webSearchEnabled ? 1 : 0
      );
    const statements = [];
    if (normalizedRetryMessageId) {
      statements.push(turnStatement);
      statements.push(
        env.DB.prepare(
          `UPDATE fable_chat_messages
              SET state = 'pending', updated_at = ?
            WHERE id = ? AND conversation_id = ? AND admin_user_id = ?
              AND role = 'user' AND state = 'failed'
              AND EXISTS (
                SELECT 1 FROM fable_chat_conversations c
                 WHERE c.id = fable_chat_messages.conversation_id
                   AND c.admin_user_id = fable_chat_messages.admin_user_id
                   AND c.deleted_at IS NULL AND c.effort = ?
                   AND c.system_preset_id = ? AND c.system_preset_version = ?
                   AND c.thinking_display = ? AND c.prompt_cache_policy = ?
                   AND c.prompt_cache_version = ? AND c.web_search_enabled = ?
              )`
        ).bind(
          createdAt,
          userMessageId,
          id,
          adminUserId,
          appliedSettings.effort,
          appliedSettings.systemPresetId,
          appliedSettings.systemPresetVersion,
          appliedSettings.thinkingDisplay,
          appliedSettings.promptCachePolicy,
          appliedSettings.promptCacheVersion,
          appliedSettings.webSearchEnabled ? 1 : 0
        )
      );
      statements.push(
        env.DB.prepare(
          `UPDATE fable_chat_conversations SET updated_at = ?
            WHERE id = ? AND admin_user_id = ? AND deleted_at IS NULL
              AND effort = ? AND system_preset_id = ? AND system_preset_version = ?
              AND thinking_display = ? AND prompt_cache_policy = ?
              AND prompt_cache_version = ? AND web_search_enabled = ?`
        ).bind(
          createdAt,
          id,
          adminUserId,
          appliedSettings.effort,
          appliedSettings.systemPresetId,
          appliedSettings.systemPresetVersion,
          appliedSettings.thinkingDisplay,
          appliedSettings.promptCachePolicy,
          appliedSettings.promptCacheVersion,
          appliedSettings.webSearchEnabled ? 1 : 0
        )
      );
    } else {
      statements.push(
        env.DB.prepare(
          `INSERT INTO fable_chat_messages (
             id, conversation_id, message_group_id, admin_user_id, turn_order, role, role_order,
             content, state, model_id, metadata_json, created_at, updated_at
           )
           SELECT ?, c.id, ?, ?, ?, 'user', 0, ?, 'pending', NULL, '{}', ?, ?
            FROM fable_chat_conversations c
            WHERE c.id = ? AND c.admin_user_id = ? AND c.deleted_at IS NULL
              AND c.effort = ? AND c.system_preset_id = ? AND c.system_preset_version = ?
              AND c.thinking_display = ? AND c.prompt_cache_policy = ?
              AND c.prompt_cache_version = ? AND c.web_search_enabled = ?`
        ).bind(
          userMessageId,
          messageGroupId,
          adminUserId,
          turnOrder,
          normalizedMessage,
          createdAt,
          createdAt,
          id,
          adminUserId,
          appliedSettings.effort,
          appliedSettings.systemPresetId,
          appliedSettings.systemPresetVersion,
          appliedSettings.thinkingDisplay,
          appliedSettings.promptCachePolicy,
          appliedSettings.promptCacheVersion,
          appliedSettings.webSearchEnabled ? 1 : 0
        )
      );
      statements.push(turnStatement);
      statements.push(
        env.DB.prepare(
          `UPDATE fable_chat_conversations
              SET title = CASE
                    WHEN turn_count = 0 AND title_source = 'automatic' THEN ?
                    ELSE title
                  END,
                  turn_count = turn_count + 1,
                  updated_at = ?
            WHERE id = ? AND admin_user_id = ? AND deleted_at IS NULL
              AND effort = ? AND system_preset_id = ? AND system_preset_version = ?
              AND thinking_display = ? AND prompt_cache_policy = ?
              AND prompt_cache_version = ? AND web_search_enabled = ?`
        ).bind(
          title,
          createdAt,
          id,
          adminUserId,
          appliedSettings.effort,
          appliedSettings.systemPresetId,
          appliedSettings.systemPresetVersion,
          appliedSettings.thinkingDisplay,
          appliedSettings.promptCachePolicy,
          appliedSettings.promptCacheVersion,
          appliedSettings.webSearchEnabled ? 1 : 0
        )
      );
    }
    await env.DB.batch(statements);
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      if (!await readConversationRow(env, adminUserId, id)) {
        throw new FableChatError("Conversation not found.", { status: 404, code: "not_found" });
      }
      throw error;
    }
    const raced = await readTurnByIdempotencyHash(env, adminUserId, id, idempotencyKeyHash);
    if (raced) {
      if (raced.request_fingerprint !== requestFingerprint) {
        throw new FableChatError("Idempotency-Key conflicts with a different chat request.", {
          status: 409,
          code: "idempotency_conflict",
        });
      }
      return { kind: "existing", turn: serializeFableChatTurn(raced) };
    }
    throw new FableChatError("The message is already being processed.", {
      status: 409,
      code: "fable_chat_message_in_progress",
    });
  }

  const created = await readTurnById(env, turnId);
  if (!created) {
    if (await readConversationRow(env, adminUserId, id)) {
      throw new FableChatError("Conversation settings changed before this message was admitted.", {
        status: 409,
        code: "fable_chat_settings_conflict",
      });
    }
    throw new FableChatError("Conversation not found.", { status: 404, code: "not_found" });
  }
  return { kind: "created", turn: serializeFableChatTurn(created) };
}

export async function markFableChatTurnRunning(env, turnId) {
  const result = await env.DB.prepare(
    `UPDATE fable_chat_turns SET status = 'running', updated_at = ?
      WHERE id = ? AND status = 'pending'`
  ).bind(nowIso(), turnId).run();
  if (!result?.meta?.changes) {
    throw new FableChatError("The message is already being processed.", {
      status: 409,
      code: "fable_chat_message_in_progress",
    });
  }
  return serializeFableChatTurn(await readTurnById(env, turnId));
}

export async function markFableChatTurnFailed(env, turnId, errorCode = "provider_failed") {
  const completedAt = nowIso();
  const safeErrorCode = safeProviderErrorCode(errorCode);
  const turn = await readTurnById(env, turnId);
  if (!turn) return null;
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE fable_chat_turns
          SET status = 'failed', error_code = ?, updated_at = ?, completed_at = ?
        WHERE id = ? AND status IN ('pending', 'running')`
    ).bind(safeErrorCode, completedAt, completedAt, turnId),
    env.DB.prepare(
      `UPDATE fable_chat_messages SET state = 'failed', updated_at = ?
        WHERE id = ? AND conversation_id = ? AND admin_user_id = ?
          AND role = 'user' AND state = 'pending'`
    ).bind(completedAt, turn.user_message_id, turn.conversation_id, turn.admin_user_id),
  ]);
  return serializeFableChatTurn(await readTurnById(env, turnId));
}

export async function markFableChatTurnUnknown(env, turnId, errorCode = "provider_outcome_unknown") {
  const completedAt = nowIso();
  const safeErrorCode = safeProviderErrorCode(errorCode);
  const turn = await readTurnById(env, turnId);
  if (!turn) return null;
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE fable_chat_turns
          SET status = 'unknown', error_code = ?, updated_at = ?, completed_at = ?
        WHERE id = ? AND status IN ('pending', 'running')`
    ).bind(safeErrorCode, completedAt, completedAt, turnId),
    env.DB.prepare(
      `UPDATE fable_chat_messages SET state = 'unknown', updated_at = ?
        WHERE id = ? AND conversation_id = ? AND admin_user_id = ?
          AND role = 'user' AND state = 'pending'`
    ).bind(completedAt, turn.user_message_id, turn.conversation_id, turn.admin_user_id),
  ]);
  return serializeFableChatTurn(await readTurnById(env, turnId));
}

export async function expireFableChatTurnIfStale(env, turn) {
  if (!turn || !["pending", "running"].includes(turn.status)) return turn;
  if (Date.parse(turn.expiresAt || "") > Date.now()) return turn;
  return markFableChatTurnUnknown(env, turn.id, "provider_outcome_unknown");
}

export async function expireStaleFableChatTurns(env, adminUserId, conversationId, {
  limit = 20,
} = {}) {
  const id = normalizeFableChatConversationId(conversationId);
  const rows = await env.DB.prepare(
    `SELECT t.id
       FROM fable_chat_turns t
       INNER JOIN fable_chat_conversations c ON c.id = t.conversation_id
      WHERE t.conversation_id = ? AND t.admin_user_id = ?
        AND c.admin_user_id = ? AND c.deleted_at IS NULL
        AND t.status IN ('pending', 'running') AND t.expires_at <= ?
      ORDER BY t.expires_at ASC, t.id ASC
      LIMIT ?`
  ).bind(id, adminUserId, adminUserId, nowIso(), Math.max(1, Math.min(50, Number(limit) || 20))).all();
  const expired = [];
  for (const row of rows?.results || []) {
    const turn = await markFableChatTurnUnknown(env, row.id, "provider_outcome_unknown");
    if (turn?.status === "unknown") expired.push(turn);
  }
  return expired;
}

export async function buildFableChatModelContext(env, {
  adminUserId,
  conversationId,
  currentMessage,
  settings = null,
}) {
  const id = normalizeFableChatConversationId(conversationId);
  const message = normalizeFableChatUserMessage(currentMessage);
  const conversation = await readConversationRow(env, adminUserId, id);
  if (!conversation) {
    throw new FableChatError("Conversation not found.", { status: 404, code: "not_found" });
  }
  const appliedSettings = resolveFableChatConversationSettings(conversation);
  if (settings && (
    settings.effort !== appliedSettings.effort
    || settings.systemPresetId !== appliedSettings.systemPresetId
    || Number(settings.systemPresetVersion) !== appliedSettings.systemPresetVersion
    || settings.thinkingDisplay !== appliedSettings.thinkingDisplay
    || settings.webSearchEnabled !== appliedSettings.webSearchEnabled
  )) {
    throw new FableChatError("Conversation settings changed before context was prepared.", {
      status: 409,
      code: "fable_chat_settings_conflict",
    });
  }
  const countRow = await env.DB.prepare(
    `SELECT COUNT(*) AS total_count
       FROM fable_chat_turns t
       INNER JOIN fable_chat_conversations c ON c.id = t.conversation_id
      WHERE t.conversation_id = ? AND t.admin_user_id = ? AND t.status = 'succeeded'
        AND c.admin_user_id = ? AND c.deleted_at IS NULL`
  ).bind(id, adminUserId, adminUserId).first();
  const rows = await env.DB.prepare(
    `SELECT t.id, um.turn_order,
            um.content AS user_content,
            am.content AS assistant_content,
            pm.content_blocks_json AS provider_content_blocks_json
       FROM fable_chat_turns t
       INNER JOIN fable_chat_conversations c ON c.id = t.conversation_id
       INNER JOIN fable_chat_messages um ON um.id = t.user_message_id
        AND um.conversation_id = t.conversation_id AND um.admin_user_id = t.admin_user_id
        AND um.role = 'user'
       INNER JOIN fable_chat_messages am ON am.id = t.assistant_message_id
        AND am.conversation_id = t.conversation_id AND am.admin_user_id = t.admin_user_id
        AND am.role = 'assistant'
       LEFT JOIN fable_chat_provider_messages pm ON pm.message_id = am.id
        AND pm.conversation_id = t.conversation_id AND pm.admin_user_id = t.admin_user_id
      WHERE t.conversation_id = ? AND t.admin_user_id = ? AND t.status = 'succeeded'
        AND c.admin_user_id = ? AND c.deleted_at IS NULL
        AND um.state = 'succeeded' AND am.state = 'succeeded'
      ORDER BY um.turn_order DESC, t.id DESC
      LIMIT ?`
  ).bind(id, adminUserId, adminUserId, FABLE_CHAT_MAX_CONTEXT_PRIOR_TURNS).all();

  const system = buildFableChatSystemPrompt(
    appliedSettings.systemPresetId,
    appliedSettings.systemPresetVersion
  );
  const effectiveInputTokenLimit = getFableChatEffectiveInputTokenLimit(
    appliedSettings.effectiveMaxOutputTokens
  );
  try {
    const selected = selectFableChatModelContext({
      system,
      priorTurnsNewestFirst: (rows?.results || []).map((row) => ({
        userContent: row.user_content,
        assistantContent: row.assistant_content,
        assistantProviderBlocks: row.provider_content_blocks_json || null,
      })),
      currentMessage: message,
      effectiveInputTokenLimit,
      totalPriorTurns: Number(countRow?.total_count || 0),
      promptCachePolicy: appliedSettings.promptCachePolicy,
      promptCacheVersion: appliedSettings.promptCacheVersion,
    });
    return {
      ...selected,
      maxTokens: appliedSettings.effectiveMaxOutputTokens,
      effort: appliedSettings.effort,
      systemPresetId: appliedSettings.systemPresetId,
      systemPresetVersion: appliedSettings.systemPresetVersion,
      thinkingDisplay: appliedSettings.thinkingDisplay,
      promptCachePolicy: appliedSettings.promptCachePolicy,
      promptCacheVersion: appliedSettings.promptCacheVersion,
      webSearchEnabled: appliedSettings.webSearchEnabled,
      webSearchContractVersion: FABLE_CHAT_WEB_SEARCH_CONTRACT_VERSION,
      context: {
        ...selected.context,
        characterLimit: FABLE_CHAT_CONTEXT_CHARACTER_LIMIT,
        priorTurnLimit: FABLE_CHAT_CONTEXT_PRIOR_TURN_LIMIT,
        outputTokenLimit: appliedSettings.effectiveMaxOutputTokens,
        hardOutputTokenLimit: FABLE_CHAT_HARD_OUTPUT_TOKEN_LIMIT,
      },
    };
  } catch (error) {
    if (error instanceof RangeError) {
      throw new FableChatError("The message exceeds the chat context budget.", {
        status: 413,
        code: "fable_chat_context_limit_exceeded",
      });
    }
    if (error instanceof TypeError) {
      throw new FableChatError("Stored conversation context is invalid.", {
        status: 503,
        code: "fable_chat_context_unavailable",
      });
    }
    throw error;
  }
}

export async function finalizeFableChatTurn(env, turnId, {
  assistantContent,
  providerBlocks = null,
  context,
  providerModel = null,
  stopReason = null,
  stopSequence = null,
  usage = null,
  gatewayMetadata = null,
  providerDurationMs = null,
  webSearchRequestCount = null,
  webSearchResultCount = null,
}) {
  if (typeof assistantContent !== "string") {
    throw new FableChatError("Assistant response is invalid.", {
      status: 502,
      code: "fable_chat_invalid_provider_result",
    });
  }
  const content = normalizeLineEndings(assistantContent).trim();
  if (
    !content ||
    content.length > FABLE_CHAT_MAX_ASSISTANT_MESSAGE_CHARACTERS ||
    hasDisallowedControls(content)
  ) {
    throw new FableChatError("Assistant response is invalid.", {
      status: 502,
      code: "fable_chat_invalid_provider_result",
    });
  }
  let privateProviderBlocks;
  try {
    privateProviderBlocks = providerBlocks
      ? normalizeFableChatProviderBlocks(providerBlocks)
      : [{ type: "text", text: content }];
    if (extractFableChatAssistantText(privateProviderBlocks) !== content) {
      throw new TypeError("Provider text does not match the visible assistant response.");
    }
  } catch {
    throw new FableChatError("Assistant response metadata is invalid.", {
      status: 502,
      code: "fable_chat_invalid_provider_result",
    });
  }
  const providerBlocksJson = JSON.stringify(privateProviderBlocks);
  const providerBlocksBytes = utf8ByteLength(providerBlocksJson);
  const safeCitations = extractFableChatCitations(privateProviderBlocks);
  const searchCounts = countFableChatWebSearchBlocks(privateProviderBlocks);
  const turn = await readTurnById(env, turnId);
  if (!turn) {
    throw new FableChatError("Chat turn not found.", { status: 404, code: "not_found" });
  }
  if (turn.status === "succeeded") {
    return getFableChatTurnResult(env, turn.admin_user_id, turn.conversation_id, turnId);
  }
  if (turn.status !== "running") {
    throw new FableChatError("Chat turn cannot be finalized.", {
      status: 409,
      code: "fable_chat_turn_not_running",
    });
  }
  if (
    searchCounts.requestCount > FABLE_CHAT_WEB_SEARCH_MAX_USES
    || searchCounts.resultCount > FABLE_CHAT_WEB_SEARCH_MAX_USES
    || (!turn.web_search_enabled && (searchCounts.requestCount > 0 || searchCounts.resultCount > 0))
    || (webSearchRequestCount != null && Number(webSearchRequestCount) !== searchCounts.requestCount)
    || (webSearchResultCount != null && Number(webSearchResultCount) !== searchCounts.resultCount)
  ) {
    throw new FableChatError("Assistant web-search metadata is invalid.", {
      status: 502,
      code: "fable_chat_invalid_provider_result",
    });
  }
  const reasoningSummary = turn.thinking_display === "summarized"
    ? extractFableChatReasoningSummary(privateProviderBlocks)
    : null;
  const userMessage = await env.DB.prepare(
    `SELECT id, message_group_id, turn_order FROM fable_chat_messages
      WHERE id = ? AND conversation_id = ? AND admin_user_id = ? AND role = 'user'
      LIMIT 1`
  ).bind(turn.user_message_id, turn.conversation_id, turn.admin_user_id).first();
  if (!userMessage) {
    throw new FableChatError("Chat turn cannot be finalized.", {
      status: 503,
      code: "fable_chat_persistence_unavailable",
    });
  }
  const assistantMessageId = opaqueId("fbm");
  const completedAt = nowIso();
  const safeUsage = sanitizeFableChatUsage(usage);
  const safeGatewayMetadata = sanitizeFableChatGatewayMetadata(gatewayMetadata);
  const safeStopReason = safeProviderString(stopReason, 80);
  const outputTruncated = safeStopReason === "max_tokens";
  const safeProviderDurationMs = providerDurationMs != null && Number.isFinite(Number(providerDurationMs))
    ? Math.max(0, Math.floor(Number(providerDurationMs)))
    : null;
  const batchResults = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO fable_chat_messages (
         id, conversation_id, message_group_id, admin_user_id, turn_order, role, role_order,
         content, state, model_id, metadata_json, reasoning_summary, citations_json, created_at, updated_at
       )
       SELECT ?, t.conversation_id, ?, t.admin_user_id, ?, 'assistant', 1,
              ?, 'succeeded', ?, ?, ?, ?, ?, ?
         FROM fable_chat_turns t
         INNER JOIN fable_chat_conversations c ON c.id = t.conversation_id
        WHERE t.id = ? AND t.status = 'running'
          AND c.admin_user_id = t.admin_user_id AND c.deleted_at IS NULL`
    ).bind(
      assistantMessageId,
      userMessage.message_group_id,
      Number(userMessage.turn_order),
      content,
      FABLE_CHAT_MODEL_ID,
      JSON.stringify({ output_truncated: outputTruncated }),
      reasoningSummary,
      JSON.stringify(safeCitations),
      completedAt,
      completedAt,
      turnId
    ),
    env.DB.prepare(
      `INSERT INTO fable_chat_provider_messages (
         message_id, conversation_id, admin_user_id, model_id, content_blocks_json,
         serialized_bytes, format_version, created_at
       )
       SELECT ?, t.conversation_id, t.admin_user_id, ?, ?, ?, ?, ?
         FROM fable_chat_turns t
         INNER JOIN fable_chat_conversations c ON c.id = t.conversation_id
        WHERE t.id = ? AND t.status = 'running'
          AND c.admin_user_id = t.admin_user_id AND c.deleted_at IS NULL`
    ).bind(
      assistantMessageId,
      FABLE_CHAT_MODEL_ID,
      providerBlocksJson,
      providerBlocksBytes,
      FABLE_CHAT_PROVIDER_BLOCKS_VERSION,
      completedAt,
      turnId
    ),
    env.DB.prepare(
      `UPDATE fable_chat_messages SET state = 'succeeded', updated_at = ?
        WHERE id = ? AND conversation_id = ? AND admin_user_id = ? AND role = 'user'
          AND EXISTS (
            SELECT 1 FROM fable_chat_turns t
             WHERE t.id = ? AND t.status = 'running'
               AND t.user_message_id = fable_chat_messages.id
          )`
    ).bind(
      completedAt,
      turn.user_message_id,
      turn.conversation_id,
      turn.admin_user_id,
      turnId
    ),
    env.DB.prepare(
      `UPDATE fable_chat_turns
          SET assistant_message_id = ?, status = 'succeeded',
              context_included_turns = ?, context_omitted_turns = ?,
              context_character_count = ?, provider_model = ?, stop_reason = ?,
              stop_sequence = ?, usage_json = ?, gateway_metadata_json = ?,
              estimated_input_tokens = ?, effective_input_token_limit = ?,
              context_estimator_version = ?, cache_breakpoint_json = ?,
              provider_duration_ms = ?, output_truncated = ?,
              web_search_request_count = ?, web_search_result_count = ?,
              error_code = NULL, updated_at = ?, completed_at = ?
        WHERE id = ? AND status = 'running'
          AND EXISTS (
            SELECT 1 FROM fable_chat_messages m
             WHERE m.id = ? AND m.conversation_id = fable_chat_turns.conversation_id
               AND m.admin_user_id = fable_chat_turns.admin_user_id
               AND m.role = 'assistant' AND m.state = 'succeeded'
          )
          AND EXISTS (
            SELECT 1 FROM fable_chat_provider_messages pm
             WHERE pm.message_id = ? AND pm.conversation_id = fable_chat_turns.conversation_id
               AND pm.admin_user_id = fable_chat_turns.admin_user_id
          )`
    ).bind(
      assistantMessageId,
      Number(context?.includedTurns || 0),
      Number(context?.omittedTurns || 0),
      Number(context?.characterCount || 0),
      safeProviderString(providerModel, 160),
      safeStopReason,
      safeProviderString(stopSequence, 160),
      JSON.stringify(safeUsage),
      JSON.stringify(safeGatewayMetadata),
      Number(context?.estimatedInputTokens || 0),
      Number(context?.effectiveInputTokenLimit || 1),
      context?.estimatorVersion || FABLE_CHAT_CONTEXT_ESTIMATOR_VERSION,
      JSON.stringify(context?.cacheBreakpoint || { enabled: false }),
      safeProviderDurationMs,
      outputTruncated ? 1 : 0,
      searchCounts.requestCount,
      searchCounts.resultCount,
      completedAt,
      completedAt,
      turnId,
      assistantMessageId,
      assistantMessageId
    ),
    env.DB.prepare(
      `UPDATE fable_chat_conversations SET updated_at = ?
        WHERE id = ? AND admin_user_id = ? AND deleted_at IS NULL
          AND EXISTS (
            SELECT 1 FROM fable_chat_turns t
             WHERE t.id = ? AND t.status = 'succeeded'
          )`
    ).bind(completedAt, turn.conversation_id, turn.admin_user_id, turnId),
  ]);
  if (!Number(batchResults?.[3]?.meta?.changes || 0)) {
    const current = await readTurnById(env, turnId);
    if (current?.status === "succeeded") {
      return getFableChatTurnResult(env, current.admin_user_id, current.conversation_id, turnId);
    }
    throw new FableChatError("The provider outcome could not be finalized safely.", {
      status: 409,
      code: "fable_chat_provider_outcome_unknown",
    });
  }
  return getFableChatTurnResult(env, turn.admin_user_id, turn.conversation_id, turnId);
}

export async function getFableChatTurnResult(env, adminUserId, conversationId, turnId) {
  const row = await env.DB.prepare(
    `SELECT t.id, t.status, t.user_message_id, t.assistant_message_id, t.error_code,
            t.context_included_turns, t.context_omitted_turns, t.context_character_count,
            t.estimated_input_tokens, t.effective_input_token_limit,
            t.context_estimator_version, t.cache_breakpoint_json,
            t.effort, t.effective_max_output_tokens, t.system_preset_id,
            t.system_preset_version, t.thinking_display, t.provider_duration_ms,
            t.web_search_enabled, t.web_search_request_count, t.web_search_result_count,
            t.output_truncated,
            t.usage_json, t.created_at, t.updated_at, t.completed_at, t.expires_at,
            um.id AS user_id, um.role AS user_role, um.content AS user_content,
            um.state AS user_state, um.metadata_json AS user_metadata_json,
            um.created_at AS user_created_at,
            am.id AS assistant_id, am.role AS assistant_role, am.content AS assistant_content,
            am.state AS assistant_state, am.metadata_json AS assistant_metadata_json,
            am.reasoning_summary AS assistant_reasoning_summary,
            am.citations_json AS assistant_citations_json,
            am.created_at AS assistant_created_at
       FROM fable_chat_turns t
       INNER JOIN fable_chat_conversations c ON c.id = t.conversation_id
       INNER JOIN fable_chat_messages um ON um.id = t.user_message_id
        AND um.conversation_id = t.conversation_id AND um.admin_user_id = t.admin_user_id
        AND um.role = 'user'
       LEFT JOIN fable_chat_messages am ON am.id = t.assistant_message_id
        AND am.conversation_id = t.conversation_id AND am.admin_user_id = t.admin_user_id
        AND am.role = 'assistant'
      WHERE t.id = ? AND t.conversation_id = ? AND t.admin_user_id = ?
        AND c.admin_user_id = ? AND c.deleted_at IS NULL
      LIMIT 1`
  ).bind(turnId, conversationId, adminUserId, adminUserId).first();
  if (!row) return null;
  const messages = [serializeFableChatMessage({
    id: row.user_id,
    role: row.user_role,
    content: row.user_content,
    state: row.user_state,
    metadata_json: row.user_metadata_json,
    created_at: row.user_created_at,
  })];
  if (row.assistant_id) {
    messages.push(serializeFableChatMessage({
      id: row.assistant_id,
      role: row.assistant_role,
      content: row.assistant_content,
      state: row.assistant_state,
      metadata_json: row.assistant_metadata_json,
      reasoning_summary: row.assistant_reasoning_summary,
      citations_json: row.assistant_citations_json,
      created_at: row.assistant_created_at,
    }));
  }
  return {
    turn: {
      id: row.id,
      status: row.status,
      userMessageId: row.user_message_id,
      assistantMessageId: row.assistant_message_id || null,
      errorCode: row.error_code || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at || null,
      expiresAt: row.expires_at,
      effort: row.effort || FABLE_CHAT_DEFAULT_EFFORT,
      effectiveMaxOutputTokens: Number(row.effective_max_output_tokens || 0),
      systemPresetId: row.system_preset_id || FABLE_CHAT_DEFAULT_SYSTEM_PRESET_ID,
      systemPresetVersion: Number(row.system_preset_version || FABLE_CHAT_SYSTEM_PRESET_VERSION),
      thinkingDisplay: row.thinking_display || FABLE_CHAT_DEFAULT_THINKING_DISPLAY,
      webSearchEnabled: Number(row.web_search_enabled || 0) === 1,
      webSearchRequestCount: Number(row.web_search_request_count || 0),
      webSearchResultCount: Number(row.web_search_result_count || 0),
      outputTruncated: Number(row.output_truncated || 0) === 1,
      providerDurationMs: row.provider_duration_ms == null
        ? null
        : Number(row.provider_duration_ms),
    },
    messages,
    context: {
      includedTurns: Number(row.context_included_turns || 0),
      omittedTurns: Number(row.context_omitted_turns || 0),
      olderTurnsOmitted: Number(row.context_omitted_turns || 0) > 0,
      characterCount: Number(row.context_character_count || 0),
      characterLimit: FABLE_CHAT_CONTEXT_CHARACTER_LIMIT,
      priorTurnLimit: FABLE_CHAT_CONTEXT_PRIOR_TURN_LIMIT,
      estimatedInputTokens: Number(row.estimated_input_tokens || 0),
      effectiveInputTokenLimit: Number(row.effective_input_token_limit || 0),
      estimatorVersion: row.context_estimator_version || FABLE_CHAT_CONTEXT_ESTIMATOR_VERSION,
      cacheBreakpoint: parseJsonObject(row.cache_breakpoint_json),
      outputTokenLimit: Number(row.effective_max_output_tokens || FABLE_CHAT_DEFAULT_OUTPUT_TOKENS),
      hardOutputTokenLimit: FABLE_CHAT_HARD_OUTPUT_TOKEN_LIMIT,
    },
    usage: sanitizeFableChatUsage(parseJsonObject(row.usage_json)),
  };
}
