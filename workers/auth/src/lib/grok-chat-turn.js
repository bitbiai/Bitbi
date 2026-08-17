import {
  FABLE_CHAT_MAX_ASSISTANT_MESSAGE_CHARACTERS,
  FABLE_CHAT_MAX_REASONING_SUMMARY_CHARACTERS,
  FABLE_CHAT_TURN_EXPIRY_MINUTES,
} from "../../../shared/fable-chat-contract.mjs";
import {
  GROK_4_6_MODEL_ID,
  GROK_ATTACHED_ATTACHMENT_RETENTION_SECONDS,
  GROK_CONTEXT_FORMAT_VERSION,
  GROK_PROMPT_CACHE_FORMAT_VERSION,
  GROK_PROVIDER_STATE_FORMAT_VERSION,
  GROK_SYSTEM_PROMPT_VERSION,
  GROK_TOOL_REGISTRY_VERSION,
  normalizeGrokProviderSettings,
  stableJsonStringify,
} from "../../../shared/grok-chat-contract.mjs";
import {
  FableChatError,
  getFableChatTurnResult,
  normalizeFableChatConversationId,
  normalizeFableChatIdempotencyKey,
  normalizeFableChatMessageId,
  normalizeFableChatUserMessage,
  sanitizeFableChatGatewayMetadata,
  sanitizeFableChatUsage,
} from "./fable-chat.js";
import { normalizeGrokAttachmentIds } from "./grok-chat-context.js";
import { addMinutesIso, nowIso, randomTokenHex, sha256Hex } from "./tokens.js";

const ENCODER = new TextEncoder();
const TOOL_CALL_ID_PATTERN = /^(?:call-|call_)[A-Za-z0-9_-]{1,180}$/;
const TOOL_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const SAFE_PROVIDER_STRING_PATTERN = /^[A-Za-z0-9._:/-]{1,180}$/;
const DISALLOWED_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function opaqueId(prefix) {
  return `${prefix}_${randomTokenHex(16)}`;
}

function parseObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function safeProviderString(value, maxLength = 180) {
  if (value == null || value === "") return null;
  const normalized = String(value).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength);
  return normalized || null;
}

function normalizeCitation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rawUrl = value.url;
  if (typeof rawUrl !== "string" || rawUrl.length > 2_048) return null;
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hostname.length > 253) return null;
  const title = String(value.title || "Source")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, 256) || "Source";
  return {
    url: url.href,
    title,
    type: "web_search_result_location",
    source: url.hostname.toLowerCase(),
  };
}

function normalizeCitations(value) {
  const output = [];
  const seen = new Set();
  for (const raw of Array.isArray(value) ? value : []) {
    const citation = normalizeCitation(raw);
    if (!citation || seen.has(citation.url)) continue;
    seen.add(citation.url);
    output.push(citation);
    if (output.length >= 20) break;
  }
  return output;
}

function normalizeToolCalls(value, openCalls) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) {
    throw new TypeError("Provider tool calls are invalid.");
  }
  return value.map((raw) => {
    const id = String(raw?.id || "").trim();
    const type = raw?.type;
    const name = String(raw?.function?.name || "").trim();
    const args = raw?.function?.arguments;
    if (type !== "function" || !TOOL_CALL_ID_PATTERN.test(id) || !TOOL_NAME_PATTERN.test(name)
      || typeof args !== "string" || ENCODER.encode(args).byteLength > 16 * 1024
      || openCalls.has(id)) {
      throw new TypeError("Provider tool calls are invalid.");
    }
    JSON.parse(args);
    openCalls.add(id);
    return { id, type: "function", function: { name, arguments: args } };
  });
}

function normalizeProviderState(value, assistantContent) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.formatVersion !== GROK_PROVIDER_STATE_FORMAT_VERSION
    || Number(value.version) !== 1 || !Array.isArray(value.messages)
    || value.messages.length < 1 || value.messages.length > 64) {
    throw new TypeError("Provider state is invalid.");
  }
  const openCalls = new Set();
  const messages = [];
  for (const raw of value.messages) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new TypeError("Provider state is invalid.");
    }
    if (raw.role === "assistant") {
      const content = raw.content == null ? null : String(raw.content);
      if (content != null && (content.length > FABLE_CHAT_MAX_ASSISTANT_MESSAGE_CHARACTERS
        || DISALLOWED_CONTROLS.test(content))) {
        throw new TypeError("Provider state is invalid.");
      }
      const toolCalls = raw.tool_calls == null ? null : normalizeToolCalls(raw.tool_calls, openCalls);
      const reasoning = raw.reasoning_content == null ? null : String(raw.reasoning_content);
      if (reasoning != null && (ENCODER.encode(reasoning).byteLength > 2 * 1024 * 1024
        || DISALLOWED_CONTROLS.test(reasoning))) {
        throw new TypeError("Provider reasoning state is invalid.");
      }
      if (content == null && !toolCalls) throw new TypeError("Provider state is invalid.");
      messages.push({
        role: "assistant",
        content,
        ...(toolCalls ? { tool_calls: toolCalls } : {}),
        ...(reasoning ? { reasoning_content: reasoning } : {}),
      });
      continue;
    }
    if (raw.role === "tool") {
      const id = String(raw.tool_call_id || "").trim();
      const content = raw.content;
      if (!TOOL_CALL_ID_PATTERN.test(id) || !openCalls.has(id) || typeof content !== "string"
        || ENCODER.encode(content).byteLength > 32 * 1024 || DISALLOWED_CONTROLS.test(content)) {
        throw new TypeError("Provider tool result state is invalid.");
      }
      openCalls.delete(id);
      messages.push({ role: "tool", tool_call_id: id, content });
      continue;
    }
    throw new TypeError("Provider state is invalid.");
  }
  if (openCalls.size > 0) throw new TypeError("Provider tool lifecycle is incomplete.");
  const last = messages[messages.length - 1];
  if (last.role !== "assistant" || String(last.content || "").trim() !== assistantContent) {
    throw new TypeError("Provider state does not match the visible response.");
  }
  const citations = normalizeCitations(value.citations);
  const outputFiles = (Array.isArray(value.outputFiles) ? value.outputFiles : []).slice(0, 16)
    .map((entry) => {
      const id = String(entry?.id || "").trim();
      const name = String(entry?.name || "").trim();
      if (!/^[A-Za-z0-9_-]{1,180}$/.test(id)) return null;
      return { id, ...(name && name.length <= 256 && !/[\u0000-\u001f\u007f/\\]/.test(name)
        ? { name } : {}) };
    }).filter(Boolean);
  const normalized = {
    version: 1,
    formatVersion: GROK_PROVIDER_STATE_FORMAT_VERSION,
    messages,
    citations,
    outputFiles,
    responseId: safeProviderString(value.responseId),
    systemFingerprint: safeProviderString(value.systemFingerprint),
    serviceTier: value.serviceTier === "default" ? "default" : null,
  };
  const serialized = stableJsonStringify(normalized);
  const bytes = ENCODER.encode(serialized).byteLength;
  if (bytes < 2 || bytes > 4 * 1024 * 1024) throw new TypeError("Provider state is too large.");
  return { normalized, serialized, bytes, citations };
}

function serializeTurn(row) {
  if (!row) return null;
  return {
    id: row.id,
    model: row.model_id,
    status: row.status,
    userMessageId: row.user_message_id,
    assistantMessageId: row.assistant_message_id || null,
    retryOfTurnId: row.retry_of_turn_id || null,
    errorCode: row.error_code || null,
    requestFingerprint: row.request_fingerprint,
    idempotencyKeyHash: row.idempotency_key_hash,
    effort: row.effort,
    effectiveMaxOutputTokens: Number(row.effective_max_output_tokens || 0),
    outputTruncated: Number(row.output_truncated || 0) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || null,
    expiresAt: row.expires_at,
  };
}

async function readTurn(env, { turnId = null, adminUserId = null, conversationId = null,
  idempotencyKeyHash = null } = {}) {
  if (turnId) {
    return env.DB.prepare(
      `SELECT * FROM fable_chat_turns WHERE id = ? AND model_id = ? LIMIT 1`
    ).bind(turnId, GROK_4_6_MODEL_ID).first();
  }
  return env.DB.prepare(
    `SELECT t.* FROM fable_chat_turns t
      INNER JOIN fable_chat_conversations c ON c.id = t.conversation_id
     WHERE t.conversation_id = ? AND t.admin_user_id = ? AND t.idempotency_key_hash = ?
       AND t.model_id = ? AND c.admin_user_id = t.admin_user_id AND c.deleted_at IS NULL
     LIMIT 1`
  ).bind(conversationId, adminUserId, idempotencyKeyHash, GROK_4_6_MODEL_ID).first();
}

export async function buildGrokChatRequestFingerprint({
  conversationId,
  message,
  retryMessageId = null,
  settings,
  memorySelection,
  attachmentIdentities = [],
}) {
  const providerSettings = normalizeGrokProviderSettings(settings?.providerSettings);
  const attachments = [...attachmentIdentities].map((entry) => ({
    id: String(entry.id),
    sha256: String(entry.sha256),
    mime_type: String(entry.mimeType),
    byte_size: Number(entry.byteSize),
    width: Number(entry.width),
    height: Number(entry.height),
  })).sort((left, right) => left.id.localeCompare(right.id));
  const fingerprint = {
    version: 1,
    conversation_id: normalizeFableChatConversationId(conversationId),
    message: normalizeFableChatUserMessage(message),
    retry_message_id: retryMessageId ? normalizeFableChatMessageId(retryMessageId) : null,
    model_id: GROK_4_6_MODEL_ID,
    context_format_version: GROK_CONTEXT_FORMAT_VERSION,
    prompt_cache_format_version: GROK_PROMPT_CACHE_FORMAT_VERSION,
    provider_state_format_version: GROK_PROVIDER_STATE_FORMAT_VERSION,
    system_prompt_version: GROK_SYSTEM_PROMPT_VERSION,
    tool_registry_version: GROK_TOOL_REGISTRY_VERSION,
    system_preset_id: settings.systemPresetId,
    system_preset_version: Number(settings.systemPresetVersion),
    memory: {
      mode: memorySelection?.mode || settings.memoryMode,
      contract_version: Number(memorySelection?.contractVersion || 1),
      checkpoint_id: memorySelection?.checkpointId || null,
      checkpoint_version: Number(memorySelection?.checkpointVersion || 0),
      coverage_turn_order: Number(memorySelection?.coverageTurnOrder ?? -1),
    },
    provider_settings: providerSettings,
    attachments,
    admin_revision_version: Number(settings.adminRevisionVersion || 0),
  };
  return sha256Hex(stableJsonStringify(fingerprint));
}

export function matchesGrokChatTurnRequest(existing, requestFingerprint) {
  return (existing?.requestFingerprint ?? existing?.request_fingerprint) === requestFingerprint;
}

export async function beginGrokChatTurn(env, {
  adminUserId,
  conversationId,
  idempotencyKey,
  requestFingerprint,
  message,
  retryMessageId = null,
  settings,
  memorySelection,
  context,
  attachmentIds = [],
}) {
  const id = normalizeFableChatConversationId(conversationId);
  const keyHash = await sha256Hex(normalizeFableChatIdempotencyKey(idempotencyKey));
  const normalizedMessage = normalizeFableChatUserMessage(message);
  const normalizedRetryId = retryMessageId ? normalizeFableChatMessageId(retryMessageId) : null;
  const normalizedAttachments = normalizeGrokAttachmentIds(attachmentIds);
  const existing = await readTurn(env, {
    adminUserId,
    conversationId: id,
    idempotencyKeyHash: keyHash,
  });
  if (existing) {
    if (!matchesGrokChatTurnRequest(existing, requestFingerprint)) {
      throw new FableChatError("Idempotency-Key conflicts with a different chat request.", {
        status: 409,
        code: "idempotency_conflict",
      });
    }
    return { kind: "existing", turn: serializeTurn(existing) };
  }
  const conversation = await env.DB.prepare(
    `SELECT id, turn_count, title_source, model_id, system_preset_id, system_preset_version,
            memory_mode, provider_settings_json, provider_settings_version, admin_revision_version
       FROM fable_chat_conversations
      WHERE id = ? AND admin_user_id = ? AND deleted_at IS NULL LIMIT 1`
  ).bind(id, adminUserId).first();
  if (!conversation || conversation.model_id !== GROK_4_6_MODEL_ID) {
    throw new FableChatError("Conversation not found.", { status: 404, code: "not_found" });
  }
  const storedSettings = normalizeGrokProviderSettings(parseObject(conversation.provider_settings_json));
  if (stableJsonStringify(storedSettings) !== stableJsonStringify(settings.providerSettings)
    || conversation.system_preset_id !== settings.systemPresetId
    || Number(conversation.system_preset_version) !== Number(settings.systemPresetVersion)
    || conversation.memory_mode !== settings.memoryMode
    || Number(conversation.admin_revision_version || 0) !== Number(settings.adminRevisionVersion || 0)) {
    throw new FableChatError("Conversation settings changed before this message was admitted.", {
      status: 409,
      code: "fable_chat_settings_conflict",
    });
  }
  let userMessageId = normalizedRetryId || opaqueId("fbm");
  let messageGroupId = opaqueId("fbg");
  let turnOrder = Number(conversation.turn_count || 0);
  let retryOfTurnId = null;
  if (normalizedRetryId) {
    const retry = await env.DB.prepare(
      `SELECT m.id, m.message_group_id, m.turn_order, m.content, m.state, m.metadata_json,
              (SELECT t.id FROM fable_chat_turns t
                WHERE t.user_message_id = m.id AND t.model_id = ? AND t.status = 'failed'
                ORDER BY t.created_at DESC, t.id DESC LIMIT 1) AS failed_turn_id
         FROM fable_chat_messages m
         INNER JOIN fable_chat_conversations c ON c.id = m.conversation_id
        WHERE m.id = ? AND m.conversation_id = ? AND m.admin_user_id = ?
          AND m.role = 'user' AND m.turn_order = c.turn_count - 1
          AND c.admin_user_id = m.admin_user_id AND c.deleted_at IS NULL LIMIT 1`
    ).bind(GROK_4_6_MODEL_ID, normalizedRetryId, id, adminUserId).first();
    const retryAttachments = normalizeGrokAttachmentIds(parseObject(retry?.metadata_json).attachment_ids);
    if (!retry || retry.state !== "failed" || retry.content !== normalizedMessage
      || !retry.failed_turn_id
      || stableJsonStringify(retryAttachments) !== stableJsonStringify(normalizedAttachments)) {
      throw new FableChatError("The failed message is no longer eligible for retry.", {
        status: 409,
        code: "fable_chat_retry_conflict",
      });
    }
    messageGroupId = retry.message_group_id;
    turnOrder = Number(retry.turn_order);
    retryOfTurnId = retry.failed_turn_id;
  }
  if (!normalizedRetryId && normalizedAttachments.length > 0) {
    const placeholders = normalizedAttachments.map(() => "?").join(", ");
    const attachmentRows = await env.DB.prepare(
      `SELECT id FROM fable_chat_attachments
        WHERE conversation_id = ? AND admin_user_id = ? AND model_id = ?
          AND state = 'pending' AND deleted_at IS NULL AND id IN (${placeholders})`
    ).bind(id, adminUserId, GROK_4_6_MODEL_ID, ...normalizedAttachments).all();
    if ((attachmentRows?.results || []).length !== normalizedAttachments.length) {
      throw new FableChatError("An attachment is no longer available.", {
        status: 409,
        code: "grok_attachment_conflict",
      });
    }
  }
  const turnId = opaqueId("fbt");
  const createdAt = nowIso();
  const expiresAt = addMinutesIso(FABLE_CHAT_TURN_EXPIRY_MINUTES);
  const title = normalizedMessage.replace(/\s+/g, " ").trim().slice(0, 80) || "New chat";
  const contextSnapshot = {
    modelId: GROK_4_6_MODEL_ID,
    contextFormatVersion: GROK_CONTEXT_FORMAT_VERSION,
    providerSettings: storedSettings,
    systemPresetId: settings.systemPresetId,
    systemPresetVersion: Number(settings.systemPresetVersion),
    memorySelection,
    attachmentIds: normalizedAttachments,
  };
  const statements = [];
  if (normalizedRetryId) {
    statements.push(env.DB.prepare(
      `UPDATE fable_chat_messages SET state = 'pending', updated_at = ?
        WHERE id = ? AND conversation_id = ? AND admin_user_id = ? AND state = 'failed'`
    ).bind(createdAt, userMessageId, id, adminUserId));
  } else {
    statements.push(env.DB.prepare(
      `INSERT INTO fable_chat_messages (
         id, conversation_id, message_group_id, admin_user_id, turn_order, role, role_order,
         content, state, model_id, metadata_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'user', 0, ?, 'pending', NULL, ?, ?, ?)`
    ).bind(
      userMessageId,
      id,
      messageGroupId,
      adminUserId,
      turnOrder,
      normalizedMessage,
      stableJsonStringify({ attachment_ids: normalizedAttachments }),
      createdAt,
      createdAt
    ));
  }
  statements.push(env.DB.prepare(
    `INSERT INTO fable_chat_turns (
       id, conversation_id, admin_user_id, idempotency_key_hash, request_fingerprint,
       user_message_id, retry_of_turn_id, status, model_id,
       context_included_turns, context_omitted_turns, context_character_count,
       effort, effective_max_output_tokens, system_preset_id, system_preset_version,
       thinking_display, prompt_cache_policy, prompt_cache_version, prompt_cache_ttl,
       context_format_version, estimated_input_tokens, effective_input_token_limit,
       context_estimator_version, cache_breakpoint_json, settings_snapshot_json,
       web_search_enabled, web_search_effective_max_uses,
       web_search_effective_contract_version, fable_tool_choice,
       memory_mode, memory_contract_version, memory_checkpoint_id,
       memory_checkpoint_version, memory_coverage_turn_order,
       provider_settings_json, provider_settings_version, provider_state_format_version,
       created_at, updated_at, expires_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, 'summarized',
       'automatic', 1, '5m', ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
  ).bind(
    turnId,
    id,
    adminUserId,
    keyHash,
    requestFingerprint,
    userMessageId,
    retryOfTurnId,
    GROK_4_6_MODEL_ID,
    Number(context?.includedTurns || 0),
    Number(context?.omittedTurns || 0),
    Number(context?.characterCount || 0),
    storedSettings.reasoningEffort,
    storedSettings.maxCompletionTokens,
    settings.systemPresetId,
    Number(settings.systemPresetVersion),
    GROK_CONTEXT_FORMAT_VERSION,
    Number(context?.estimatedInputTokens || 0),
    Number(context?.effectiveInputTokenLimit || 1),
    context?.estimatorVersion || "provider-weighted-grok-v1",
    stableJsonStringify(context?.cacheBreakpoint || {}),
    stableJsonStringify(contextSnapshot),
    storedSettings.webSearch.mode === "off" ? 0 : 1,
    storedSettings.toolChoice,
    settings.memoryMode,
    Number(memorySelection?.contractVersion || 1),
    memorySelection?.checkpointId || null,
    Number(memorySelection?.checkpointVersion || 0),
    Number(memorySelection?.coverageTurnOrder ?? -1),
    stableJsonStringify(storedSettings),
    GROK_PROVIDER_STATE_FORMAT_VERSION,
    createdAt,
    createdAt,
    expiresAt
  ));
  statements.push(env.DB.prepare(
    `UPDATE fable_chat_conversations
        SET title = CASE WHEN turn_count = 0 AND title_source = 'automatic' THEN ? ELSE title END,
            turn_count = CASE WHEN ? IS NULL THEN turn_count + 1 ELSE turn_count END,
            updated_at = ?
      WHERE id = ? AND admin_user_id = ? AND model_id = ? AND deleted_at IS NULL
        AND provider_settings_json = ? AND admin_revision_version = ?`
  ).bind(
    title,
    retryOfTurnId,
    createdAt,
    id,
    adminUserId,
    GROK_4_6_MODEL_ID,
    stableJsonStringify(storedSettings),
    Number(settings.adminRevisionVersion || 0)
  ));
  if (!normalizedRetryId && normalizedAttachments.length > 0) {
    const placeholders = normalizedAttachments.map(() => "?").join(", ");
    statements.push(env.DB.prepare(
      `UPDATE fable_chat_attachments
          SET message_id = ?, state = 'attached', attached_at = ?, expires_at = ?
        WHERE conversation_id = ? AND admin_user_id = ? AND model_id = ?
          AND state = 'pending' AND deleted_at IS NULL AND id IN (${placeholders})`
    ).bind(
      userMessageId,
      createdAt,
      new Date(Date.now() + GROK_ATTACHED_ATTACHMENT_RETENTION_SECONDS * 1_000).toISOString(),
      id,
      adminUserId,
      GROK_4_6_MODEL_ID,
      ...normalizedAttachments
    ));
  }
  try {
    const results = await env.DB.batch(statements);
    const conversationIndex = 2;
    if (!Number(results?.[0]?.meta?.changes || 0)
      || !Number(results?.[1]?.meta?.changes || 0)
      || !Number(results?.[conversationIndex]?.meta?.changes || 0)
      || (normalizedAttachments.length > 0 && !normalizedRetryId
        && Number(results?.[3]?.meta?.changes || 0) !== normalizedAttachments.length)) {
      throw new FableChatError("The chat request could not be admitted safely.", {
        status: 409,
        code: "fable_chat_settings_conflict",
      });
    }
  } catch (error) {
    const raced = await readTurn(env, {
      adminUserId,
      conversationId: id,
      idempotencyKeyHash: keyHash,
    });
    if (raced) {
      if (!matchesGrokChatTurnRequest(raced, requestFingerprint)) {
        throw new FableChatError("Idempotency-Key conflicts with a different chat request.", {
          status: 409,
          code: "idempotency_conflict",
        });
      }
      return { kind: "existing", turn: serializeTurn(raced) };
    }
    throw error;
  }
  const created = await readTurn(env, { turnId });
  if (!created) {
    throw new FableChatError("The chat request could not be admitted safely.", {
      status: 409,
      code: "fable_chat_settings_conflict",
    });
  }
  return { kind: "created", turn: serializeTurn(created) };
}

export async function finalizeGrokChatTurn(env, turnId, {
  assistantContent,
  reasoningSummary = null,
  providerState,
  context,
  providerModel = null,
  stopReason = null,
  usage = null,
  gatewayMetadata = null,
  providerDurationMs = null,
  webSearchRequestCount = 0,
  webSearchExecutedRequestCount = 0,
}) {
  if (typeof assistantContent !== "string") {
    throw new FableChatError("Assistant response is invalid.", {
      status: 502,
      code: "fable_chat_invalid_provider_result",
    });
  }
  const content = assistantContent.replace(/\r\n?/g, "\n").trim();
  if (!content || content.length > FABLE_CHAT_MAX_ASSISTANT_MESSAGE_CHARACTERS
    || DISALLOWED_CONTROLS.test(content)) {
    throw new FableChatError("Assistant response is invalid.", {
      status: 502,
      code: "fable_chat_invalid_provider_result",
    });
  }
  let state;
  try {
    state = normalizeProviderState(providerState, content);
  } catch {
    throw new FableChatError("Assistant provider state is invalid.", {
      status: 502,
      code: "fable_chat_invalid_provider_result",
    });
  }
  const turn = await readTurn(env, { turnId });
  if (!turn) throw new FableChatError("Chat turn not found.", { status: 404, code: "not_found" });
  if (turn.status === "succeeded") {
    return getFableChatTurnResult(env, turn.admin_user_id, turn.conversation_id, turnId);
  }
  if (turn.status !== "running") {
    throw new FableChatError("Chat turn cannot be finalized.", {
      status: 409,
      code: "fable_chat_turn_not_running",
    });
  }
  const userMessage = await env.DB.prepare(
    `SELECT id, message_group_id, turn_order FROM fable_chat_messages
      WHERE id = ? AND conversation_id = ? AND admin_user_id = ? AND role = 'user' LIMIT 1`
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
  const safeGateway = sanitizeFableChatGatewayMetadata(gatewayMetadata);
  const duration = Number.isFinite(Number(providerDurationMs))
    ? Math.max(0, Math.floor(Number(providerDurationMs))) : null;
  const safeStopReason = safeProviderString(stopReason, 80);
  const outputTruncated = safeStopReason === "max_tokens";
  const fullReasoning = typeof reasoningSummary === "string" && !DISALLOWED_CONTROLS.test(reasoningSummary)
    ? reasoningSummary : "";
  const storedReasoning = fullReasoning.slice(0, FABLE_CHAT_MAX_REASONING_SUMMARY_CHARACTERS) || null;
  const searchRequests = Number(webSearchRequestCount);
  const searchExecuted = Number(webSearchExecutedRequestCount);
  if (![0, 1].includes(searchRequests) || ![0, 1].includes(searchExecuted)
    || searchExecuted > searchRequests || (!turn.web_search_enabled && searchRequests > 0)) {
    throw new FableChatError("Assistant search metadata is invalid.", {
      status: 502,
      code: "fable_chat_invalid_provider_result",
    });
  }
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO fable_chat_messages (
         id, conversation_id, message_group_id, admin_user_id, turn_order, role, role_order,
         content, state, model_id, metadata_json, reasoning_summary, citations_json,
         created_at, updated_at
       ) SELECT ?, t.conversation_id, ?, t.admin_user_id, ?, 'assistant', 1,
                ?, 'succeeded', ?, ?, ?, ?, ?, ?
           FROM fable_chat_turns t INNER JOIN fable_chat_conversations c ON c.id = t.conversation_id
          WHERE t.id = ? AND t.status = 'running' AND t.model_id = ?
            AND c.admin_user_id = t.admin_user_id AND c.deleted_at IS NULL`
    ).bind(
      assistantMessageId,
      userMessage.message_group_id,
      Number(userMessage.turn_order),
      content,
      GROK_4_6_MODEL_ID,
      stableJsonStringify({
        output_truncated: outputTruncated,
        reasoning_truncated: fullReasoning.length > FABLE_CHAT_MAX_REASONING_SUMMARY_CHARACTERS,
        provider_state_format_version: GROK_PROVIDER_STATE_FORMAT_VERSION,
      }),
      storedReasoning,
      stableJsonStringify(state.citations),
      completedAt,
      completedAt,
      turnId,
      GROK_4_6_MODEL_ID
    ),
    env.DB.prepare(
      `INSERT INTO fable_chat_provider_states (
         message_id, conversation_id, admin_user_id, model_id, state_json,
         serialized_bytes, format_version, created_at
       ) SELECT ?, t.conversation_id, t.admin_user_id, ?, ?, ?, ?, ?
           FROM fable_chat_turns t INNER JOIN fable_chat_conversations c ON c.id = t.conversation_id
          WHERE t.id = ? AND t.status = 'running' AND t.model_id = ?
            AND c.admin_user_id = t.admin_user_id AND c.deleted_at IS NULL`
    ).bind(
      assistantMessageId,
      GROK_4_6_MODEL_ID,
      state.serialized,
      state.bytes,
      GROK_PROVIDER_STATE_FORMAT_VERSION,
      completedAt,
      turnId,
      GROK_4_6_MODEL_ID
    ),
    env.DB.prepare(
      `UPDATE fable_chat_messages SET state = 'succeeded', updated_at = ?
        WHERE id = ? AND conversation_id = ? AND admin_user_id = ? AND role = 'user'
          AND EXISTS (SELECT 1 FROM fable_chat_turns t
            WHERE t.id = ? AND t.status = 'running' AND t.user_message_id = fable_chat_messages.id)`
    ).bind(completedAt, turn.user_message_id, turn.conversation_id, turn.admin_user_id, turnId),
    env.DB.prepare(
      `UPDATE fable_chat_turns
          SET assistant_message_id = ?, status = 'succeeded',
              context_included_turns = ?, context_omitted_turns = ?, context_character_count = ?,
              provider_model = ?, stop_reason = ?, usage_json = ?, gateway_metadata_json = ?,
              estimated_input_tokens = ?, effective_input_token_limit = ?,
              context_estimator_version = ?, cache_breakpoint_json = ?,
              provider_duration_ms = ?, output_truncated = ?,
              web_search_request_count = ?, web_search_result_count = ?,
              web_search_executed_request_count = ?, web_search_executed_result_count = ?,
              error_code = NULL, updated_at = ?, completed_at = ?
        WHERE id = ? AND status = 'running' AND model_id = ?
          AND EXISTS (SELECT 1 FROM fable_chat_messages m
            WHERE m.id = ? AND m.model_id = ? AND m.state = 'succeeded')
          AND EXISTS (SELECT 1 FROM fable_chat_provider_states ps
            WHERE ps.message_id = ? AND ps.model_id = ?)`
    ).bind(
      assistantMessageId,
      Number(context?.includedTurns || 0),
      Number(context?.omittedTurns || 0),
      Number(context?.characterCount || 0),
      SAFE_PROVIDER_STRING_PATTERN.test(String(providerModel || "")) ? String(providerModel) : null,
      safeStopReason,
      stableJsonStringify(safeUsage),
      stableJsonStringify(safeGateway),
      Number(context?.estimatedInputTokens || 0),
      Number(context?.effectiveInputTokenLimit || 1),
      context?.estimatorVersion || "provider-weighted-grok-v1",
      stableJsonStringify(context?.cacheBreakpoint || {}),
      duration,
      outputTruncated ? 1 : 0,
      searchRequests,
      state.citations.length > 0 ? 1 : 0,
      searchExecuted,
      state.citations.length > 0 ? 1 : 0,
      completedAt,
      completedAt,
      turnId,
      GROK_4_6_MODEL_ID,
      assistantMessageId,
      GROK_4_6_MODEL_ID,
      assistantMessageId,
      GROK_4_6_MODEL_ID
    ),
    env.DB.prepare(
      `UPDATE fable_chat_conversations SET updated_at = ?
        WHERE id = ? AND admin_user_id = ? AND model_id = ? AND deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM fable_chat_turns t
            WHERE t.id = ? AND t.status = 'succeeded')`
    ).bind(completedAt, turn.conversation_id, turn.admin_user_id, GROK_4_6_MODEL_ID, turnId),
  ]);
  if (!Number(results?.[3]?.meta?.changes || 0)) {
    const current = await readTurn(env, { turnId });
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
