import {
  FABLE_CHAT_DEFAULT_MEMORY_MODE,
  FABLE_CHAT_MEMORY_MODEL_ID,
  FABLE_CHAT_STANDARD_MEMORY_TRIGGER_TOKENS,
  FABLE_CHAT_LITE_MEMORY_TRIGGER_TOKENS,
  estimateFableChatMemoryTextTokens,
  getFableChatMemoryAcceptanceCeiling,
  normalizeFableChatMemorySummary,
} from "../../../shared/fable-chat-memory-contract.mjs";
import {
  FABLE_CHAT_DEFAULT_EFFORT,
  FABLE_CHAT_DEFAULT_SYSTEM_PRESET_ID,
  FABLE_CHAT_DEFAULT_THINKING_DISPLAY,
  FABLE_CHAT_EFFORTS,
  FABLE_CHAT_SYSTEM_PRESET_IDS,
  FABLE_CHAT_THINKING_DISPLAYS,
  FABLE_CHAT_WEB_FETCH_CONTRACT_VERSION,
  FABLE_CHAT_WEB_FETCH_MAX_CONTENT_TOKENS,
  FABLE_CHAT_WEB_FETCH_MAX_USES,
  FABLE_CHAT_WEB_FETCH_TOOL_TYPE,
  getFableChatOutputTokenLimit,
  getFableChatWebSearchMaxUses,
} from "../../../shared/fable-chat-contract.mjs";
import { nowIso, randomTokenHex, sha256Hex } from "./tokens.js";

const CONVERSATION_ID_PATTERN = /^fbc_[a-f0-9]{32}$/;
const MESSAGE_ID_PATTERN = /^fbm_[a-f0-9]{32}$/;
const TURN_ID_PATTERN = /^fbt_[a-f0-9]{32}$/;
const CHECKPOINT_ID_PATTERN = /^fbk_[a-f0-9]{32}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,160}$/;
const CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const MAX_LIST_LIMIT = 100;
const MAX_OFFSET = 100_000;
const MAX_REASON = 500;
const MAX_TITLE = 120;
const MAX_MESSAGE = 400_000;
const MAX_CITATIONS = 16;
const MAX_URL = 2_048;
const MAX_SOURCE_TITLE = 256;

export class FableChatAdminDataError extends Error {
  constructor(message, { status = 400, code = "validation_error" } = {}) {
    super(message);
    this.name = "FableChatAdminDataError";
    this.status = status;
    this.code = code;
  }
}

function opaqueId(prefix) {
  return `${prefix}_${randomTokenHex(16)}`;
}

function requiredId(value, pattern, label) {
  const id = String(value || "").trim();
  if (!pattern.test(id)) throw new FableChatAdminDataError(`${label} is invalid.`);
  return id;
}

export const normalizeAdminFableConversationId = (value) => (
  requiredId(value, CONVERSATION_ID_PATTERN, "Conversation ID")
);
export const normalizeAdminFableMessageId = (value) => (
  requiredId(value, MESSAGE_ID_PATTERN, "Message ID")
);
export const normalizeAdminFableTurnId = (value) => requiredId(value, TURN_ID_PATTERN, "Turn ID");
export const normalizeAdminFableCheckpointId = (value) => (
  requiredId(value, CHECKPOINT_ID_PATTERN, "Checkpoint ID")
);

function boundedInteger(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new FableChatAdminDataError("Pagination value is invalid.");
  }
  return parsed;
}

function normalizedSearch(value, max = 200) {
  const text = String(value || "").trim();
  if (text.length > max || CONTROL_PATTERN.test(text)) {
    throw new FableChatAdminDataError("Search value is invalid.");
  }
  return text;
}

function normalizedReason(value) {
  const reason = String(value || "").trim();
  if (reason.length < 3 || reason.length > MAX_REASON || CONTROL_PATTERN.test(reason)) {
    throw new FableChatAdminDataError("An administrative reason between 3 and 500 characters is required.");
  }
  return reason;
}

function normalizedTitle(value) {
  const title = String(value || "").replace(/\s+/g, " ").trim();
  if (!title || title.length > MAX_TITLE || CONTROL_PATTERN.test(title)) {
    throw new FableChatAdminDataError("Title is invalid.");
  }
  return title;
}

function normalizedContent(value) {
  const content = String(value ?? "").replace(/\r\n?/g, "\n").trim();
  if (!content || content.length > MAX_MESSAGE || CONTROL_PATTERN.test(content)) {
    throw new FableChatAdminDataError("Message content is invalid.");
  }
  return content;
}

function normalizeCitations(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MAX_CITATIONS) {
    throw new FableChatAdminDataError("Citations are invalid.");
  }
  const seen = new Set();
  const output = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new FableChatAdminDataError("Citations are invalid.");
    }
    const title = String(item.title || "").trim().slice(0, MAX_SOURCE_TITLE);
    if (CONTROL_PATTERN.test(title)) throw new FableChatAdminDataError("Citation title is invalid.");
    let url;
    try {
      const parsed = new URL(String(item.url || ""));
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error();
      url = parsed.toString();
    } catch {
      throw new FableChatAdminDataError("Citation URL must be a safe HTTPS URL.");
    }
    if (url.length > MAX_URL) throw new FableChatAdminDataError("Citation URL is too long.");
    if (seen.has(url)) continue;
    seen.add(url);
    output.push({ title, url });
  }
  return output;
}

function parseJsonObject(value) {
  if (typeof value !== "string" || !value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseCitations(value) {
  try {
    return normalizeCitations(JSON.parse(value || "[]"));
  } catch {
    return [];
  }
}

function estimateTurnTokens(row) {
  return 24
    + estimateFableChatMemoryTextTokens(row.user_content || "")
    + estimateFableChatMemoryTextTokens(row.assistant_content || "")
    + estimateFableChatMemoryTextTokens(row.assistant_citations_json || "[]");
}

function listPage(input = {}) {
  return {
    limit: boundedInteger(input.limit, 30, { min: 1, max: MAX_LIST_LIMIT }),
    offset: boundedInteger(input.offset, 0, { min: 0, max: MAX_OFFSET }),
  };
}

function normalizeLifecycleFilter(value) {
  const state = String(value || "all");
  if (!new Set(["all", "active", "deleted"]).has(state)) {
    throw new FableChatAdminDataError("Lifecycle filter is invalid.");
  }
  return state;
}

function normalizedOptionalDate(value) {
  if (!value) return null;
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new FableChatAdminDataError("Date filter is invalid.");
  return date.toISOString();
}

function normalizeBooleanFilter(value) {
  if (value == null || value === "") return null;
  if (value === true || value === "true" || value === "1" || value === 1) return 1;
  if (value === false || value === "false" || value === "0" || value === 0) return 0;
  throw new FableChatAdminDataError("Boolean filter is invalid.");
}

function safeUsage(value) {
  const parsed = parseJsonObject(value);
  const output = {};
  for (const key of [
    "input_tokens", "output_tokens", "total_tokens", "cache_creation_input_tokens",
    "cache_read_input_tokens", "cache_creation_5m_input_tokens",
  ]) {
    const number = Number(parsed[key]);
    if (Number.isFinite(number) && number >= 0) output[key] = Math.floor(number);
  }
  const fetchRequests = Number(parsed?.server_tool_use?.web_fetch_requests);
  if (Number.isFinite(fetchRequests) && fetchRequests >= 0) {
    output.web_fetch_requests = Math.min(FABLE_CHAT_WEB_FETCH_MAX_USES, Math.floor(fetchRequests));
  }
  return output;
}

function safeBudgetMetadata(value) {
  const parsed = parseJsonObject(value);
  const allowed = [
    "phase", "source", "model_id", "provider_family", "accounting_basis", "profile",
    "memory_contract_version", "prompt_version", "diagnostic_version", "final_state",
    "duration_ms", "input_tokens", "output_tokens", "total_tokens", "provider_cost_usd",
    "estimated_input_bucket_tokens", "reserved_output_tokens", "estimated_provider_cost_usd",
    "planning_ceiling", "acceptance_ceiling", "effective_soft_target",
    "web_fetch_enabled", "web_fetch_max_uses", "web_fetch_reserved_input_tokens",
    "web_fetch_request_count",
  ];
  return Object.fromEntries(allowed.filter((key) => parsed[key] != null).map((key) => [key, parsed[key]]));
}

export async function getFableChatAdminOverview(env) {
  const [conversations, messages, turnRows, checkpointRows, sizes] = await Promise.all([
    env.DB.prepare(
      `SELECT
         SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) AS active_conversations,
         SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS deleted_conversations,
         SUM(CASE WHEN web_search_enabled = 1 THEN 1 ELSE 0 END) AS web_search_conversations,
         SUM(CASE WHEN web_fetch_enabled = 1 THEN 1 ELSE 0 END) AS web_fetch_conversations,
         MAX(updated_at) AS most_recent_activity
       FROM fable_chat_conversations`
    ).first(),
    env.DB.prepare(`SELECT COUNT(*) AS visible_messages FROM fable_chat_messages`).first(),
    env.DB.prepare(
      `SELECT status, COUNT(*) AS count FROM fable_chat_turns GROUP BY status`
    ).all(),
    env.DB.prepare(
      `SELECT profile, status, COUNT(*) AS count
         FROM fable_chat_memory_checkpoints GROUP BY profile, status`
    ).all(),
    env.DB.prepare(
      `SELECT COALESCE(SUM(length(CAST(content AS BLOB))), 0) AS transcript_bytes
         FROM fable_chat_messages`
    ).first(),
  ]);
  const turnCounts = Object.fromEntries((turnRows.results || []).map((row) => [row.status, Number(row.count)]));
  const checkpoints = { standard: 0, lite: 0, failures: 0 };
  for (const row of checkpointRows.results || []) {
    if (row.status === "succeeded") checkpoints[row.profile] = Number(row.count || 0);
    if (["failed", "unknown"].includes(row.status)) checkpoints.failures += Number(row.count || 0);
  }
  return {
    activeConversations: Number(conversations.active_conversations || 0),
    deletedConversations: Number(conversations.deleted_conversations || 0),
    visibleMessages: Number(messages?.visible_messages || 0),
    completedTurns: Number(turnCounts.succeeded || 0),
    attempts: {
      pending: Number(turnCounts.pending || 0),
      running: Number(turnCounts.running || 0),
      succeeded: Number(turnCounts.succeeded || 0),
      failed: Number(turnCounts.failed || 0),
      unknown: Number(turnCounts.unknown || 0),
    },
    standardCheckpoints: checkpoints.standard,
    liteCheckpoints: checkpoints.lite,
    compactionFailures: checkpoints.failures,
    estimatedTranscriptBytes: Number(sizes?.transcript_bytes || 0),
    mostRecentActivity: conversations.most_recent_activity || null,
    webSearchConversations: Number(conversations.web_search_conversations || 0),
    webFetchConversations: Number(conversations.web_fetch_conversations || 0),
  };
}

export async function listFableChatAdminConversations(env, input = {}) {
  const { limit, offset } = listPage(input);
  const search = normalizedSearch(input.search);
  const lifecycle = normalizeLifecycleFilter(input.lifecycle);
  const owner = normalizedSearch(input.owner, 254).toLowerCase();
  const from = normalizedOptionalDate(input.from);
  const to = normalizedOptionalDate(input.to);
  const webSearch = normalizeBooleanFilter(input.webSearchEnabled);
  const reasoning = normalizeBooleanFilter(input.reasoningSummaryEnabled);
  const attemptStatus = input.attemptStatus ? String(input.attemptStatus) : null;
  const checkpointStatus = input.checkpointStatus ? String(input.checkpointStatus) : null;
  const errorCategory = normalizedSearch(input.errorCategory, 80);
  const recordStatuses = ["pending", "running", "succeeded", "failed", "unknown"];
  if (attemptStatus && !recordStatuses.includes(attemptStatus)) {
    throw new FableChatAdminDataError("Attempt status filter is invalid.");
  }
  if (checkpointStatus && !recordStatuses.includes(checkpointStatus)) {
    throw new FableChatAdminDataError("Checkpoint status filter is invalid.");
  }
  const memoryMode = input.memoryMode ? String(input.memoryMode) : null;
  if (memoryMode && !["standard", "lite"].includes(memoryMode)) {
    throw new FableChatAdminDataError("Memory filter is invalid.");
  }
  const effort = input.effort ? String(input.effort) : null;
  if (effort && !FABLE_CHAT_EFFORTS.includes(effort)) {
    throw new FableChatAdminDataError("Effort filter is invalid.");
  }
  const preset = input.preset ? String(input.preset) : null;
  if (preset && !FABLE_CHAT_SYSTEM_PRESET_IDS.includes(preset)) {
    throw new FableChatAdminDataError("Preset filter is invalid.");
  }
  const sort = String(input.sort || "updated_desc");
  const orderBy = {
    updated_desc: "c.updated_at DESC, c.id DESC",
    updated_asc: "c.updated_at ASC, c.id ASC",
    created_desc: "c.created_at DESC, c.id DESC",
    title_asc: "c.title COLLATE NOCASE ASC, c.id ASC",
  }[sort];
  if (!orderBy) throw new FableChatAdminDataError("Sort value is invalid.");
  const lifecycleSql = lifecycle === "active"
    ? "c.deleted_at IS NULL"
    : lifecycle === "deleted" ? "c.deleted_at IS NOT NULL" : "1=1";
  const searchPattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
  const ownerPattern = `%${owner.replace(/[\\%_]/g, "\\$&")}%`;
  const where = `
    ${lifecycleSql}
    AND (? = '' OR c.id LIKE ? ESCAPE '\\' OR c.title LIKE ? ESCAPE '\\')
    AND (? = '' OR lower(u.email) LIKE ? ESCAPE '\\' OR lower(c.admin_user_id) LIKE ? ESCAPE '\\')
    AND (? IS NULL OR c.updated_at >= ?)
    AND (? IS NULL OR c.updated_at <= ?)
    AND (? IS NULL OR c.web_search_enabled = ?)
    AND (? IS NULL OR (c.thinking_display = 'summarized') = ?)
    AND (? IS NULL OR c.memory_mode = ?)
    AND (? IS NULL OR c.effort = ?)
    AND (? IS NULL OR c.system_preset_id = ?)
    AND (? IS NULL OR (SELECT t.status FROM fable_chat_turns t
      WHERE t.conversation_id = c.id ORDER BY t.created_at DESC, t.id DESC LIMIT 1) = ?)
    AND (? IS NULL OR (SELECT m.status FROM fable_chat_memory_checkpoints m
      WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) = ?)
    AND (? = '' OR EXISTS (SELECT 1 FROM fable_chat_turns t
      WHERE t.conversation_id = c.id AND t.error_code = ?)
      OR EXISTS (SELECT 1 FROM fable_chat_memory_checkpoints m
        WHERE m.conversation_id = c.id AND m.error_code = ?))`;
  const bindings = [
    search, searchPattern, searchPattern,
    owner, ownerPattern, ownerPattern,
    from, from, to, to, webSearch, webSearch, reasoning, reasoning,
    memoryMode, memoryMode, effort, effort, preset, preset,
    attemptStatus, attemptStatus, checkpointStatus, checkpointStatus,
    errorCategory, errorCategory, errorCategory,
  ];
  const [rowsResult, countResult] = await Promise.all([
    env.DB.prepare(
      `SELECT c.id, c.admin_user_id, u.email AS owner_email, c.title, c.model_id,
              c.effort, c.system_preset_id, c.thinking_display, c.web_search_enabled,
              c.web_fetch_enabled,
              c.memory_mode, c.turn_count, c.created_at, c.updated_at, c.deleted_at,
              c.settings_updated_at, c.admin_revision_version,
              c.web_replay_pruned_through_turn_order, c.web_replay_pruned_at,
              (SELECT MAX(m.created_at) FROM fable_chat_messages m
                WHERE m.conversation_id = c.id) AS last_message_at,
              (SELECT COUNT(*) FROM fable_chat_messages m
                WHERE m.conversation_id = c.id) AS message_count,
              (SELECT COUNT(*) FROM fable_chat_turns t
                WHERE t.conversation_id = c.id AND t.status = 'succeeded') AS completed_turn_count,
              (SELECT t.status FROM fable_chat_turns t
                WHERE t.conversation_id = c.id ORDER BY t.created_at DESC, t.id DESC LIMIT 1) AS latest_attempt_status,
              (SELECT m.profile || ':' || m.status FROM fable_chat_memory_checkpoints m
                LEFT JOIN fable_chat_memory_checkpoint_invalidations i ON i.checkpoint_id = m.id
                WHERE m.conversation_id = c.id AND i.checkpoint_id IS NULL
                ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS latest_checkpoint_state,
              (SELECT m.coverage_turn_order FROM fable_chat_memory_checkpoints m
                LEFT JOIN fable_chat_memory_checkpoint_invalidations i ON i.checkpoint_id = m.id
                WHERE m.conversation_id = c.id AND m.status = 'succeeded' AND i.checkpoint_id IS NULL
                  AND m.profile = c.memory_mode
                ORDER BY m.summary_version DESC, m.id DESC LIMIT 1) AS coverage_turn_order
         FROM fable_chat_conversations c
         INNER JOIN users u ON u.id = c.admin_user_id
        WHERE ${where}
        ORDER BY ${orderBy}
        LIMIT ? OFFSET ?`
    ).bind(...bindings, limit, offset).all(),
    env.DB.prepare(
      `SELECT COUNT(*) AS count
         FROM fable_chat_conversations c
         INNER JOIN users u ON u.id = c.admin_user_id
        WHERE ${where}`
    ).bind(...bindings).first(),
  ]);
  return {
    conversations: (rowsResult.results || []).map((row) => ({
      id: row.id,
      ownerId: row.admin_user_id,
      ownerEmail: row.owner_email,
      title: row.title,
      modelId: row.model_id,
      state: row.deleted_at ? "deleted" : "active",
      settings: {
        effort: row.effort,
        effectiveMaxOutputTokens: getFableChatOutputTokenLimit(row.effort),
        preset: row.system_preset_id,
        reasoningSummaryEnabled: row.thinking_display === "summarized",
        webSearchEnabled: Number(row.web_search_enabled) === 1,
        webSearchMaxUses: getFableChatWebSearchMaxUses(row.effort),
        webFetchEnabled: Number(row.web_fetch_enabled) === 1,
        webFetchMaxUses: FABLE_CHAT_WEB_FETCH_MAX_USES,
        memoryMode: row.memory_mode || FABLE_CHAT_DEFAULT_MEMORY_MODE,
      },
      counts: {
        messages: Number(row.message_count || 0),
        turns: Number(row.completed_turn_count || 0),
      },
      latestAttemptStatus: row.latest_attempt_status || null,
      latestCheckpointState: row.latest_checkpoint_state || null,
      coverageTurnOrder: row.coverage_turn_order == null ? -1 : Number(row.coverage_turn_order),
      adminRevisionVersion: Number(row.admin_revision_version || 0),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastMessageAt: row.last_message_at || null,
      deletedAt: row.deleted_at || null,
      webReplay: {
        prunedThroughTurnOrder: Number(row.web_replay_pruned_through_turn_order ?? -1),
        prunedAt: row.web_replay_pruned_at || null,
      },
    })),
    total: Number(countResult?.count || 0),
    limit,
    offset,
  };
}

async function readAdminConversationRow(env, conversationId, { includeDeleted = true } = {}) {
  const id = normalizeAdminFableConversationId(conversationId);
  return env.DB.prepare(
    `SELECT c.*, u.email AS owner_email
       FROM fable_chat_conversations c INNER JOIN users u ON u.id = c.admin_user_id
      WHERE c.id = ? ${includeDeleted ? "" : "AND c.deleted_at IS NULL"} LIMIT 1`
  ).bind(id).first();
}

async function latestCoverage(env, conversationId, ownerId, profile) {
  return env.DB.prepare(
    `SELECT m.id, m.summary_version, m.coverage_turn_order
       FROM fable_chat_memory_checkpoints m
       LEFT JOIN fable_chat_memory_checkpoint_invalidations i ON i.checkpoint_id = m.id
      WHERE m.conversation_id = ? AND m.admin_user_id = ? AND m.profile = ?
        AND m.status = 'succeeded' AND i.checkpoint_id IS NULL
      ORDER BY m.summary_version DESC, m.id DESC LIMIT 1`
  ).bind(conversationId, ownerId, profile).first();
}

async function readEffectiveCompleteTurns(env, conversationId, ownerId, { afterTurnOrder = -1 } = {}) {
  const rows = await env.DB.prepare(
    `SELECT t.id AS turn_id, um.turn_order,
            COALESCE((SELECT r.content FROM fable_chat_admin_message_revisions r
              WHERE r.message_id = um.id ORDER BY r.revision_number DESC, r.id DESC LIMIT 1), um.content) AS user_content,
            COALESCE((SELECT r.content FROM fable_chat_admin_message_revisions r
              WHERE r.message_id = am.id ORDER BY r.revision_number DESC, r.id DESC LIMIT 1), am.content) AS assistant_content,
            COALESCE((SELECT r.citations_json FROM fable_chat_admin_message_revisions r
              WHERE r.message_id = am.id ORDER BY r.revision_number DESC, r.id DESC LIMIT 1), am.citations_json, '[]') AS assistant_citations_json
       FROM fable_chat_turns t
       INNER JOIN fable_chat_messages um ON um.id = t.user_message_id AND um.state = 'succeeded'
       INNER JOIN fable_chat_messages am ON am.id = t.assistant_message_id AND am.state = 'succeeded'
      WHERE t.conversation_id = ? AND t.admin_user_id = ? AND t.status = 'succeeded'
        AND um.turn_order > ?
        AND COALESCE((SELECT CASE tr.action WHEN 'delete' THEN 1 ELSE 0 END
          FROM fable_chat_admin_turn_revisions tr WHERE tr.turn_id = t.id
          ORDER BY tr.revision_number DESC, tr.id DESC LIMIT 1), 0) = 0
      ORDER BY um.turn_order ASC, t.id ASC LIMIT 768`
  ).bind(conversationId, ownerId, afterTurnOrder).all();
  return rows.results || [];
}

export async function getFableChatAdminConversationDetail(env, conversationId) {
  const row = await readAdminConversationRow(env, conversationId);
  if (!row) return null;
  const [turnCounts, messageCounts, standard, lite, latestTurn, storage] = await Promise.all([
    env.DB.prepare(
      `SELECT status, COUNT(*) AS count FROM fable_chat_turns
        WHERE conversation_id = ? AND admin_user_id = ? GROUP BY status`
    ).bind(row.id, row.admin_user_id).all(),
    env.DB.prepare(
      `SELECT role, state, COUNT(*) AS count FROM fable_chat_messages
        WHERE conversation_id = ? AND admin_user_id = ? GROUP BY role, state`
    ).bind(row.id, row.admin_user_id).all(),
    latestCoverage(env, row.id, row.admin_user_id, "standard"),
    latestCoverage(env, row.id, row.admin_user_id, "lite"),
    env.DB.prepare(
      `SELECT id, status, error_code, effort, system_preset_id, thinking_display,
              web_search_enabled, web_search_effective_max_uses, memory_mode,
              web_fetch_enabled, web_fetch_tool_version, web_fetch_max_uses,
              web_fetch_max_content_tokens, web_fetch_contract_version,
              web_fetch_request_count, web_fetch_result_count, web_fetch_error_result_count,
              estimated_input_tokens, provider_duration_ms, completed_at, created_at
         FROM fable_chat_turns WHERE conversation_id = ? AND admin_user_id = ?
         ORDER BY created_at DESC, id DESC LIMIT 1`
    ).bind(row.id, row.admin_user_id).first(),
    env.DB.prepare(
      `SELECT COALESCE(SUM(length(CAST(content AS BLOB))),0) AS transcript_bytes,
              (SELECT COALESCE(SUM(serialized_bytes),0) FROM fable_chat_provider_messages
                WHERE conversation_id = ?) AS provider_bytes
         FROM fable_chat_messages WHERE conversation_id = ?`
    ).bind(row.id, row.id).first(),
  ]);
  const activeProfile = row.memory_mode || FABLE_CHAT_DEFAULT_MEMORY_MODE;
  const activeCoverage = activeProfile === "lite" ? lite : standard;
  const uncoveredTurns = await readEffectiveCompleteTurns(env, row.id, row.admin_user_id, {
    afterTurnOrder: Number(activeCoverage?.coverage_turn_order ?? -1),
  });
  return {
    conversation: {
      id: row.id,
      ownerId: row.admin_user_id,
      ownerEmail: row.owner_email,
      title: row.title,
      modelId: row.model_id,
      state: row.deleted_at ? "deleted" : "active",
      titleSource: row.title_source,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at || null,
      settingsUpdatedAt: row.settings_updated_at || null,
      adminRevisionVersion: Number(row.admin_revision_version || 0),
      settings: {
        effort: row.effort || FABLE_CHAT_DEFAULT_EFFORT,
        effectiveMaxOutputTokens: getFableChatOutputTokenLimit(row.effort),
        preset: row.system_preset_id || FABLE_CHAT_DEFAULT_SYSTEM_PRESET_ID,
        presetVersion: Number(row.system_preset_version || 1),
        reasoningSummaryEnabled: row.thinking_display === "summarized",
        thinkingDisplay: row.thinking_display,
        webSearchEnabled: Number(row.web_search_enabled) === 1,
        webSearchMaxUses: getFableChatWebSearchMaxUses(row.effort),
        webFetchEnabled: Number(row.web_fetch_enabled) === 1,
        webFetchToolVersion: FABLE_CHAT_WEB_FETCH_TOOL_TYPE,
        webFetchMaxUses: FABLE_CHAT_WEB_FETCH_MAX_USES,
        webFetchMaxContentTokens: FABLE_CHAT_WEB_FETCH_MAX_CONTENT_TOKENS,
        webFetchContractVersion: FABLE_CHAT_WEB_FETCH_CONTRACT_VERSION,
        memoryMode: activeProfile,
        promptCachePolicy: row.prompt_cache_policy,
        promptCacheVersion: Number(row.prompt_cache_version || 1),
      },
      webReplay: {
        prunedThroughTurnOrder: Number(row.web_replay_pruned_through_turn_order ?? -1),
        prunedThroughMessageId: row.web_replay_pruned_through_message_id || null,
        prunedAt: row.web_replay_pruned_at || null,
        version: Number(row.web_replay_pruning_version || 1),
      },
    },
    counts: {
      messages: Object.fromEntries((messageCounts.results || []).map((item) => [`${item.role}_${item.state}`, Number(item.count)])),
      turns: Object.fromEntries((turnCounts.results || []).map((item) => [item.status, Number(item.count)])),
    },
    memory: {
      activeProfile,
      standard: standard ? { checkpointId: standard.id, version: Number(standard.summary_version), coverageTurnOrder: Number(standard.coverage_turn_order) } : null,
      lite: lite ? { checkpointId: lite.id, version: Number(lite.summary_version), coverageTurnOrder: Number(lite.coverage_turn_order) } : null,
      uncoveredEstimatedTokens: uncoveredTurns.reduce((sum, turn) => sum + estimateTurnTokens(turn), 0),
      triggerThreshold: activeProfile === "lite"
        ? FABLE_CHAT_LITE_MEMORY_TRIGGER_TOKENS
        : FABLE_CHAT_STANDARD_MEMORY_TRIGGER_TOKENS,
    },
    latestAttempt: latestTurn ? {
      id: latestTurn.id,
      status: latestTurn.status,
      errorCode: latestTurn.error_code || null,
      effort: latestTurn.effort,
      preset: latestTurn.system_preset_id,
      reasoningSummaryEnabled: latestTurn.thinking_display === "summarized",
      webSearchEnabled: Number(latestTurn.web_search_enabled) === 1,
      webSearchMaxUses: Number(latestTurn.web_search_effective_max_uses || 1),
      webFetchEnabled: Number(latestTurn.web_fetch_enabled) === 1,
      webFetchRequestCount: Number(latestTurn.web_fetch_request_count || 0),
      webFetchResultCount: Number(latestTurn.web_fetch_result_count || 0),
      webFetchErrorResultCount: Number(latestTurn.web_fetch_error_result_count || 0),
      memoryMode: latestTurn.memory_mode,
      estimatedInputTokens: Number(latestTurn.estimated_input_tokens || 0),
      providerDurationMs: latestTurn.provider_duration_ms == null ? null : Number(latestTurn.provider_duration_ms),
      createdAt: latestTurn.created_at,
      completedAt: latestTurn.completed_at || null,
    } : null,
    storage: {
      transcriptBytes: Number(storage?.transcript_bytes || 0),
      privateProviderBytes: Number(storage?.provider_bytes || 0),
    },
  };
}

export async function listFableChatAdminTranscript(env, conversationId, input = {}) {
  const conversation = await readAdminConversationRow(env, conversationId);
  if (!conversation) return null;
  const { limit, offset } = listPage(input);
  const [rows, count] = await Promise.all([
    env.DB.prepare(
      `SELECT m.id, m.message_group_id, m.turn_order, m.role, m.role_order,
              m.content AS original_content, m.state, m.model_id, m.metadata_json,
              m.reasoning_summary, m.citations_json AS original_citations_json,
              m.created_at, m.updated_at, t.id AS turn_id, t.status AS turn_status,
              (SELECT r.content FROM fable_chat_admin_message_revisions r
                WHERE r.message_id = m.id ORDER BY r.revision_number DESC, r.id DESC LIMIT 1) AS revised_content,
              (SELECT r.citations_json FROM fable_chat_admin_message_revisions r
                WHERE r.message_id = m.id ORDER BY r.revision_number DESC, r.id DESC LIMIT 1) AS revised_citations_json,
              (SELECT MAX(r.revision_number) FROM fable_chat_admin_message_revisions r
                WHERE r.message_id = m.id) AS message_revision,
              (SELECT tr.action FROM fable_chat_admin_turn_revisions tr
                WHERE tr.turn_id = t.id ORDER BY tr.revision_number DESC, tr.id DESC LIMIT 1) AS turn_revision_action,
              (SELECT MAX(tr.revision_number) FROM fable_chat_admin_turn_revisions tr
                WHERE tr.turn_id = t.id) AS turn_revision
         FROM fable_chat_messages m
         INNER JOIN fable_chat_turns t ON t.conversation_id = m.conversation_id
          AND t.admin_user_id = m.admin_user_id
          AND (t.user_message_id = m.id OR t.assistant_message_id = m.id)
        WHERE m.conversation_id = ? AND m.admin_user_id = ?
        ORDER BY m.turn_order ASC, m.role_order ASC, m.id ASC LIMIT ? OFFSET ?`
    ).bind(conversation.id, conversation.admin_user_id, limit, offset).all(),
    env.DB.prepare(
      `SELECT COUNT(*) AS count FROM fable_chat_messages
        WHERE conversation_id = ? AND admin_user_id = ?`
    ).bind(conversation.id, conversation.admin_user_id).first(),
  ]);
  return {
    messages: (rows.results || []).map((row) => {
      const citations = parseCitations(row.revised_citations_json ?? row.original_citations_json);
      return {
        id: row.id,
        turnId: row.turn_id,
        turnOrder: Number(row.turn_order),
        role: row.role,
        state: row.state,
        turnStatus: row.turn_status,
        content: row.revised_content ?? row.original_content,
        citations,
        reasoningSummary: row.reasoning_summary || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        revision: Number(row.message_revision || 0),
        turnRevision: Number(row.turn_revision || 0),
        administrativelyDeleted: row.turn_revision_action === "delete",
      };
    }),
    total: Number(count?.count || 0),
    limit,
    offset,
  };
}

export async function listFableChatAdminAttempts(env, conversationId, input = {}) {
  const conversation = await readAdminConversationRow(env, conversationId);
  if (!conversation) return null;
  const { limit, offset } = listPage(input);
  const status = input.status ? String(input.status) : null;
  if (status && !["pending", "running", "succeeded", "failed", "unknown"].includes(status)) {
    throw new FableChatAdminDataError("Attempt status filter is invalid.");
  }
  const error = normalizedSearch(input.error, 80);
  const rows = await env.DB.prepare(
    `SELECT t.id, t.retry_of_turn_id, t.status, t.model_id, t.effort,
            t.effective_max_output_tokens, t.system_preset_id, t.system_preset_version,
            t.thinking_display, t.web_search_enabled, t.web_search_effective_max_uses,
            t.web_search_executed_request_count, t.web_search_executed_result_count,
            t.web_fetch_enabled, t.web_fetch_tool_version, t.web_fetch_max_uses,
            t.web_fetch_max_content_tokens, t.web_fetch_contract_version,
            t.web_fetch_request_count, t.web_fetch_result_count,
            t.web_fetch_error_result_count,
            t.memory_mode, t.memory_contract_version, t.memory_checkpoint_id,
            t.memory_checkpoint_version, t.memory_coverage_turn_order,
            t.context_included_turns, t.context_omitted_turns, t.estimated_input_tokens,
            t.effective_input_token_limit, t.context_estimator_version,
            t.provider_model, t.stop_reason, t.error_code, t.usage_json,
            t.provider_duration_ms, t.output_truncated,
            t.web_replay_pruning_version, t.web_replay_pruned_through_turn_order,
            t.web_replay_pruned_at, t.web_replay_pruned_pair_count,
            t.web_replay_pruned_estimated_tokens, t.admin_revision_version,
            t.created_at, t.updated_at, t.completed_at, t.expires_at,
            CASE WHEN t.idempotency_key_hash IS NOT NULL THEN 1 ELSE 0 END AS has_idempotency_hash,
            CASE WHEN t.request_fingerprint IS NOT NULL THEN 1 ELSE 0 END AS has_request_fingerprint,
            CASE WHEN pm.message_id IS NOT NULL THEN 1 ELSE 0 END AS has_private_provider_blocks,
            COALESCE(pm.serialized_bytes, 0) AS private_provider_bytes,
            pm.format_version AS private_provider_format
       FROM fable_chat_turns t
       LEFT JOIN fable_chat_provider_messages pm ON pm.message_id = t.assistant_message_id
      WHERE t.conversation_id = ? AND t.admin_user_id = ?
        AND (? IS NULL OR t.status = ?)
        AND (? = '' OR t.error_code = ?)
      ORDER BY t.created_at DESC, t.id DESC LIMIT ? OFFSET ?`
  ).bind(
    conversation.id, conversation.admin_user_id, status, status, error, error, limit, offset
  ).all();
  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM fable_chat_turns
      WHERE conversation_id = ? AND admin_user_id = ?
        AND (? IS NULL OR status = ?) AND (? = '' OR error_code = ?)`
  ).bind(conversation.id, conversation.admin_user_id, status, status, error, error).first();
  return {
    attempts: (rows.results || []).map((row) => ({
      id: row.id,
      retryOfTurnId: row.retry_of_turn_id || null,
      status: row.status,
      modelId: row.model_id,
      effort: row.effort,
      effectiveMaxOutputTokens: Number(row.effective_max_output_tokens || 0),
      preset: row.system_preset_id,
      presetVersion: Number(row.system_preset_version || 1),
      reasoningSummaryEnabled: row.thinking_display === "summarized",
      webSearch: {
        enabled: Number(row.web_search_enabled) === 1,
        maxUses: Number(row.web_search_effective_max_uses || 1),
        requestCount: Number(row.web_search_executed_request_count || 0),
        resultCount: Number(row.web_search_executed_result_count || 0),
      },
      webFetch: {
        enabled: Number(row.web_fetch_enabled) === 1,
        toolVersion: row.web_fetch_tool_version || FABLE_CHAT_WEB_FETCH_TOOL_TYPE,
        maxUses: Number(row.web_fetch_max_uses || FABLE_CHAT_WEB_FETCH_MAX_USES),
        maxContentTokens: Number(
          row.web_fetch_max_content_tokens || FABLE_CHAT_WEB_FETCH_MAX_CONTENT_TOKENS
        ),
        contractVersion: Number(
          row.web_fetch_contract_version || FABLE_CHAT_WEB_FETCH_CONTRACT_VERSION
        ),
        requestCount: Number(row.web_fetch_request_count || 0),
        resultCount: Number(row.web_fetch_result_count || 0),
        errorResultCount: Number(row.web_fetch_error_result_count || 0),
      },
      memory: {
        mode: row.memory_mode,
        contractVersion: Number(row.memory_contract_version || 1),
        checkpointId: row.memory_checkpoint_id || null,
        checkpointVersion: Number(row.memory_checkpoint_version || 0),
        coverageTurnOrder: Number(row.memory_coverage_turn_order ?? -1),
      },
      context: {
        includedTurns: Number(row.context_included_turns || 0),
        omittedTurns: Number(row.context_omitted_turns || 0),
        estimatedInputTokens: Number(row.estimated_input_tokens || 0),
        effectiveInputTokenLimit: Number(row.effective_input_token_limit || 0),
        estimatorVersion: row.context_estimator_version,
      },
      providerModel: row.provider_model || null,
      stopReason: row.stop_reason || null,
      errorCode: row.error_code || null,
      usage: safeUsage(row.usage_json),
      providerDurationMs: row.provider_duration_ms == null ? null : Number(row.provider_duration_ms),
      outputTruncated: Number(row.output_truncated) === 1,
      webReplay: {
        version: Number(row.web_replay_pruning_version || 1),
        prunedThroughTurnOrder: Number(row.web_replay_pruned_through_turn_order ?? -1),
        prunedAt: row.web_replay_pruned_at || null,
        pairCount: Number(row.web_replay_pruned_pair_count || 0),
        estimatedTokensRemoved: Number(row.web_replay_pruned_estimated_tokens || 0),
      },
      evidence: {
        idempotencyHashPresent: Number(row.has_idempotency_hash) === 1,
        requestFingerprintPresent: Number(row.has_request_fingerprint) === 1,
        privateProviderBlocksPresent: Number(row.has_private_provider_blocks) === 1,
        privateProviderBytes: Number(row.private_provider_bytes || 0),
        privateProviderFormat: row.private_provider_format || null,
      },
      adminRevisionVersion: Number(row.admin_revision_version || 0),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at || null,
      expiresAt: row.expires_at,
    })),
    total: Number(count?.count || 0), limit, offset,
  };
}

export async function listFableChatAdminCheckpoints(env, conversationId, input = {}) {
  const conversation = await readAdminConversationRow(env, conversationId);
  if (!conversation) return null;
  const { limit, offset } = listPage(input);
  const profile = input.profile ? String(input.profile) : null;
  if (profile && !["standard", "lite"].includes(profile)) {
    throw new FableChatAdminDataError("Checkpoint profile filter is invalid.");
  }
  const rows = await env.DB.prepare(
    `SELECT m.id, m.profile, m.summary_version, m.summarizer_model_id,
            m.summarizer_prompt_version, m.status, m.base_checkpoint_id,
            m.source_base_profile, m.source_base_checkpoint_id,
            m.estimated_summary_tokens, m.coverage_turn_order,
            m.coverage_through_turn_id, m.coverage_through_message_id,
            m.source_start_turn_order, m.source_end_turn_order, m.source_turn_count,
            m.estimated_input_tokens, m.provider_duration_ms, m.provider_cost_usd_micros,
            m.error_code, m.created_at, m.updated_at, m.completed_at, m.expires_at,
            CASE WHEN m.input_fingerprint IS NOT NULL THEN 1 ELSE 0 END AS fingerprint_present,
            COALESCE(json_array_length(json_extract(m.hidden_summary_content, '$.sources')), 0) AS source_count,
            i.invalidated_at, i.reason AS invalidation_reason, i.mutation_version
       FROM fable_chat_memory_checkpoints m
       LEFT JOIN fable_chat_memory_checkpoint_invalidations i ON i.checkpoint_id = m.id
      WHERE m.conversation_id = ? AND m.admin_user_id = ? AND (? IS NULL OR m.profile = ?)
      ORDER BY m.created_at DESC, m.id DESC LIMIT ? OFFSET ?`
  ).bind(conversation.id, conversation.admin_user_id, profile, profile, limit, offset).all();
  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM fable_chat_memory_checkpoints
      WHERE conversation_id = ? AND admin_user_id = ? AND (? IS NULL OR profile = ?)`
  ).bind(conversation.id, conversation.admin_user_id, profile, profile).first();
  return {
    checkpoints: (rows.results || []).map((row) => ({
      id: row.id,
      profile: row.profile,
      version: Number(row.summary_version),
      status: row.status,
      validForContext: row.status === "succeeded" && !row.invalidated_at,
      modelId: row.summarizer_model_id,
      promptVersion: Number(row.summarizer_prompt_version),
      baseCheckpointId: row.base_checkpoint_id || null,
      sourceBaseProfile: row.source_base_profile || null,
      sourceBaseCheckpointId: row.source_base_checkpoint_id || null,
      estimatedSummaryTokens: row.estimated_summary_tokens == null ? null : Number(row.estimated_summary_tokens),
      acceptanceCeiling: getFableChatMemoryAcceptanceCeiling(row.profile),
      coverageTurnOrder: Number(row.coverage_turn_order),
      coverageThroughTurnId: row.coverage_through_turn_id || null,
      coverageThroughMessageId: row.coverage_through_message_id || null,
      sourceStartTurnOrder: row.source_start_turn_order == null ? null : Number(row.source_start_turn_order),
      sourceEndTurnOrder: row.source_end_turn_order == null ? null : Number(row.source_end_turn_order),
      sourceTurnCount: Number(row.source_turn_count || 0),
      sourceCount: Number(row.source_count || 0),
      estimatedInputTokens: Number(row.estimated_input_tokens || 0),
      providerDurationMs: row.provider_duration_ms == null ? null : Number(row.provider_duration_ms),
      providerCostUsd: row.provider_cost_usd_micros == null ? null : Number(row.provider_cost_usd_micros) / 1_000_000,
      errorCode: row.error_code || null,
      fingerprintPresent: Number(row.fingerprint_present) === 1,
      invalidation: row.invalidated_at ? {
        invalidatedAt: row.invalidated_at,
        reason: row.invalidation_reason,
        mutationVersion: Number(row.mutation_version),
      } : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at || null,
      expiresAt: row.expires_at,
    })),
    total: Number(count?.count || 0), limit, offset,
  };
}

export async function revealFableChatAdminCheckpointSummary(env, conversationId, checkpointId) {
  const conversation = await readAdminConversationRow(env, conversationId);
  if (!conversation) return null;
  const row = await env.DB.prepare(
    `SELECT id, profile, status, summarizer_model_id, hidden_summary_content,
            estimated_summary_tokens, coverage_turn_order
       FROM fable_chat_memory_checkpoints
      WHERE id = ? AND conversation_id = ? AND admin_user_id = ? LIMIT 1`
  ).bind(normalizeAdminFableCheckpointId(checkpointId), conversation.id, conversation.admin_user_id).first();
  if (!row?.hidden_summary_content) return null;
  const normalized = normalizeFableChatMemorySummary(row.hidden_summary_content, { mode: row.profile });
  return {
    checkpointId: row.id,
    profile: row.profile,
    status: row.status,
    modelId: row.summarizer_model_id,
    estimatedSummaryTokens: normalized.estimatedTokens,
    coverageTurnOrder: Number(row.coverage_turn_order),
    summary: normalized.canonical,
  };
}

export async function listFableChatAdminBudgetUsage(env, conversationId, input = {}) {
  const conversation = await readAdminConversationRow(env, conversationId);
  if (!conversation) return null;
  const { limit, offset } = listPage(input);
  const whereSql = `b.actor_user_id = ? AND (
        b.source_attempt_id IN (SELECT id FROM fable_chat_turns WHERE conversation_id = ?)
        OR b.source_attempt_id IN (SELECT id FROM fable_chat_memory_checkpoints WHERE conversation_id = ?)
      )`;
  const [rows, count] = await Promise.all([env.DB.prepare(
    `SELECT b.id, b.budget_scope, b.operation_key, b.source_route, b.units,
            b.window_day, b.window_month, b.status, b.metadata_json, b.created_at,
            b.source_attempt_id, b.source_job_id
       FROM platform_budget_usage_events b
      WHERE ${whereSql}
      ORDER BY b.created_at DESC, b.id DESC LIMIT ? OFFSET ?`
  ).bind(conversation.admin_user_id, conversation.id, conversation.id, limit, offset).all(),
  env.DB.prepare(`SELECT COUNT(*) AS count FROM platform_budget_usage_events b WHERE ${whereSql}`)
    .bind(conversation.admin_user_id, conversation.id, conversation.id).first()]);
  return {
    usage: (rows.results || []).map((row) => ({
      id: row.id,
      budgetScope: row.budget_scope,
      operationKey: row.operation_key,
      sourceRoute: row.source_route,
      sourceAttemptId: row.source_attempt_id || null,
      sourceJobId: row.source_job_id || null,
      units: Number(row.units || 0),
      windowDay: row.window_day,
      windowMonth: row.window_month,
      status: row.status,
      metadata: safeBudgetMetadata(row.metadata_json),
      createdAt: row.created_at,
      immutable: true,
    })),
    total: Number(count?.count || 0),
    limit, offset,
  };
}

export async function getFableChatAdminWebSearch(env, conversationId) {
  const conversation = await readAdminConversationRow(env, conversationId);
  if (!conversation) return null;
  const rows = await env.DB.prepare(
    `SELECT t.id, t.status, t.web_search_enabled, t.web_search_tool_version,
            t.web_search_effective_max_uses, t.web_search_executed_request_count,
            t.web_search_executed_result_count, t.web_search_effective_contract_version,
            t.web_fetch_enabled, t.web_fetch_tool_version, t.web_fetch_max_uses,
            t.web_fetch_max_content_tokens, t.web_fetch_contract_version,
            t.web_fetch_request_count, t.web_fetch_result_count,
            t.web_fetch_error_result_count, t.web_fetch_replay_pruned_pair_count,
            t.web_fetch_replay_pruned_estimated_tokens,
            t.web_replay_pruning_version, t.web_replay_pruned_through_turn_order,
            t.web_replay_pruned_through_message_id, t.web_replay_pruned_at,
            t.web_replay_pruned_pair_count, t.web_replay_pruned_estimated_tokens,
            am.id AS assistant_message_id,
            COALESCE((SELECT r.citations_json FROM fable_chat_admin_message_revisions r
              WHERE r.message_id = am.id ORDER BY r.revision_number DESC, r.id DESC LIMIT 1), am.citations_json, '[]') AS citations_json,
            t.created_at, t.completed_at
       FROM fable_chat_turns t
       LEFT JOIN fable_chat_messages am ON am.id = t.assistant_message_id
      WHERE t.conversation_id = ? AND t.admin_user_id = ?
        AND (t.web_search_enabled = 1 OR t.web_search_executed_request_count > 0
          OR t.web_replay_pruned_pair_count > 0 OR t.web_fetch_enabled = 1
          OR t.web_fetch_request_count > 0 OR t.web_fetch_replay_pruned_pair_count > 0)
      ORDER BY t.created_at DESC, t.id DESC LIMIT 100`
  ).bind(conversation.id, conversation.admin_user_id).all();
  return {
    conversation: {
      webSearchEnabled: Number(conversation.web_search_enabled) === 1,
      maxUses: getFableChatWebSearchMaxUses(conversation.effort),
      webFetchEnabled: Number(conversation.web_fetch_enabled) === 1,
      webFetchToolVersion: FABLE_CHAT_WEB_FETCH_TOOL_TYPE,
      webFetchMaxUses: FABLE_CHAT_WEB_FETCH_MAX_USES,
      webFetchMaxContentTokens: FABLE_CHAT_WEB_FETCH_MAX_CONTENT_TOKENS,
      webFetchContractVersion: FABLE_CHAT_WEB_FETCH_CONTRACT_VERSION,
      replayPrunedThroughTurnOrder: Number(conversation.web_replay_pruned_through_turn_order ?? -1),
      replayPrunedAt: conversation.web_replay_pruned_at || null,
    },
    turns: (rows.results || []).map((row) => ({
      id: row.id,
      status: row.status,
      enabled: Number(row.web_search_enabled) === 1,
      toolVersion: row.web_search_tool_version,
      maxUses: Number(row.web_search_effective_max_uses || 1),
      requestCount: Number(row.web_search_executed_request_count || 0),
      resultCount: Number(row.web_search_executed_result_count || 0),
      contractVersion: Number(row.web_search_effective_contract_version || 1),
      webFetch: {
        enabled: Number(row.web_fetch_enabled) === 1,
        toolVersion: row.web_fetch_tool_version || FABLE_CHAT_WEB_FETCH_TOOL_TYPE,
        maxUses: Number(row.web_fetch_max_uses || FABLE_CHAT_WEB_FETCH_MAX_USES),
        maxContentTokens: Number(
          row.web_fetch_max_content_tokens || FABLE_CHAT_WEB_FETCH_MAX_CONTENT_TOKENS
        ),
        contractVersion: Number(
          row.web_fetch_contract_version || FABLE_CHAT_WEB_FETCH_CONTRACT_VERSION
        ),
        requestCount: Number(row.web_fetch_request_count || 0),
        resultCount: Number(row.web_fetch_result_count || 0),
        errorResultCount: Number(row.web_fetch_error_result_count || 0),
        replayPrunedPairCount: Number(row.web_fetch_replay_pruned_pair_count || 0),
        replayPrunedEstimatedTokens: Number(
          row.web_fetch_replay_pruned_estimated_tokens || 0
        ),
      },
      citations: parseCitations(row.citations_json),
      replay: {
        version: Number(row.web_replay_pruning_version || 1),
        prunedThroughTurnOrder: Number(row.web_replay_pruned_through_turn_order ?? -1),
        prunedThroughMessageId: row.web_replay_pruned_through_message_id || null,
        prunedAt: row.web_replay_pruned_at || null,
        pairCount: Number(row.web_replay_pruned_pair_count || 0),
        estimatedTokensRemoved: Number(row.web_replay_pruned_estimated_tokens || 0),
      },
      createdAt: row.created_at,
      completedAt: row.completed_at || null,
    })),
  };
}

function normalizeWriteKey(value) {
  const key = String(value || "").trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new FableChatAdminDataError("A valid Idempotency-Key is required.", {
      status: key ? 400 : 428,
      code: key ? "invalid_idempotency_key" : "idempotency_key_required",
    });
  }
  return key;
}

async function writeIdentity(actorAdminUserId, operation, idempotencyKey, payload) {
  const keyHash = await sha256Hex(normalizeWriteKey(idempotencyKey));
  const fingerprint = await sha256Hex(JSON.stringify({ operation, payload }));
  return { actorAdminUserId, operation, keyHash, fingerprint };
}

async function readWriteReceipt(env, identity) {
  const row = await env.DB.prepare(
    `SELECT request_fingerprint, result_json FROM fable_chat_admin_write_receipts
      WHERE actor_admin_user_id = ? AND operation = ? AND idempotency_key_hash = ? LIMIT 1`
  ).bind(identity.actorAdminUserId, identity.operation, identity.keyHash).first();
  if (!row) return null;
  if (row.request_fingerprint !== identity.fingerprint) {
    throw new FableChatAdminDataError("Idempotency-Key conflicts with another administrative action.", {
      status: 409,
      code: "idempotency_conflict",
    });
  }
  return { ...parseJsonObject(row.result_json), idempotentReplay: true };
}

function receiptStatement(env, identity, conversationId, result, createdAt) {
  return env.DB.prepare(
    `INSERT INTO fable_chat_admin_write_receipts (
       id, actor_admin_user_id, conversation_id, operation, idempotency_key_hash,
       request_fingerprint, result_json, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    opaqueId("fbw"), identity.actorAdminUserId, conversationId, identity.operation,
    identity.keyHash, identity.fingerprint, JSON.stringify(result), createdAt
  );
}

function mutationClaimStatement(env, identity, conversation, mutationVersion, createdAt) {
  return env.DB.prepare(
    `INSERT INTO fable_chat_admin_mutation_claims (
       id, conversation_id, actor_admin_user_id, operation,
       from_revision, to_revision, invalidated_from_turn_order, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    opaqueId("fbm"), conversation.id, identity.actorAdminUserId, identity.operation,
    Number(conversation.admin_revision_version || 0), mutationVersion,
    identity.invalidatedFromTurnOrder ?? null, createdAt
  );
}

function isUniqueError(error) {
  return /(?:UNIQUE constraint failed|D1_ERROR[^\n]*UNIQUE)/i.test(String(error?.message || error));
}

async function executeWrite(env, identity, conversation, statements, result) {
  const replay = await readWriteReceipt(env, identity);
  if (replay) return replay;
  const timestamp = nowIso();
  try {
    await env.DB.batch([
      mutationClaimStatement(env, identity, conversation, result.revision, timestamp),
      ...statements,
      receiptStatement(env, identity, conversation.id, result, timestamp),
    ]);
    return { ...result, idempotentReplay: false };
  } catch (error) {
    if (isUniqueError(error)) {
      const concurrent = await readWriteReceipt(env, identity);
      if (concurrent) return concurrent;
      throw new FableChatAdminDataError("Conversation changed. Refresh before trying again.", {
        status: 409,
        code: "revision_conflict",
      });
    }
    throw error;
  }
}

async function requireWritableConversation(env, conversationId, expectedRevision, {
  allowDeleted = true,
} = {}) {
  const row = await readAdminConversationRow(env, conversationId, { includeDeleted: allowDeleted });
  if (!row) throw new FableChatAdminDataError("Conversation not found.", { status: 404, code: "not_found" });
  const revision = boundedInteger(expectedRevision, -1, { min: 0, max: Number.MAX_SAFE_INTEGER });
  if (revision !== Number(row.admin_revision_version || 0)) {
    throw new FableChatAdminDataError("Conversation changed. Refresh before trying again.", {
      status: 409,
      code: "revision_conflict",
    });
  }
  const active = await env.DB.prepare(
    `SELECT id FROM fable_chat_turns WHERE conversation_id = ? AND admin_user_id = ?
      AND status IN ('pending', 'running') LIMIT 1`
  ).bind(row.id, row.admin_user_id).first();
  if (active) {
    throw new FableChatAdminDataError("Administrative changes are locked while a turn is active.", {
      status: 409,
      code: "fable_chat_admin_write_locked",
    });
  }
  return row;
}

function checkpointInvalidationStatement(env, conversation, actorAdminUserId, reason, mutationVersion, {
  atOrAfterTurnOrder = 0,
  checkpointId = null,
} = {}) {
  return env.DB.prepare(
    `INSERT OR IGNORE INTO fable_chat_memory_checkpoint_invalidations (
       checkpoint_id, conversation_id, admin_user_id, actor_admin_user_id,
       invalidated_at, reason, mutation_version
     )
     SELECT m.id, m.conversation_id, m.admin_user_id, ?, ?, ?, ?
       FROM fable_chat_memory_checkpoints m
      WHERE m.conversation_id = ? AND m.admin_user_id = ? AND m.status = 'succeeded'
        AND (? IS NULL OR m.id = ?)
        AND (? IS NOT NULL OR m.coverage_turn_order >= ?)`
  ).bind(
    actorAdminUserId, nowIso(), reason, mutationVersion,
    conversation.id, conversation.admin_user_id,
    checkpointId, checkpointId,
    checkpointId, atOrAfterTurnOrder
  );
}

function conversationRevisionStatement(env, conversation, mutationVersion, timestamp, extraSql = "", extraBindings = []) {
  return env.DB.prepare(
    `UPDATE fable_chat_conversations
        SET admin_revision_version = ?, admin_revision_updated_at = ?, updated_at = ?${extraSql}
      WHERE id = ? AND admin_user_id = ? AND admin_revision_version = ?`
  ).bind(
    mutationVersion, timestamp, timestamp, ...extraBindings,
    conversation.id, conversation.admin_user_id, Number(conversation.admin_revision_version || 0)
  );
}

export async function mutateFableChatAdminConversation(env, {
  actorAdminUserId,
  conversationId,
  operation,
  body,
  idempotencyKey,
}) {
  const normalizedConversationId = normalizeAdminFableConversationId(conversationId);
  const reason = normalizedReason(body?.reason);
  if (!new Set(["rename", "settings", "soft_delete", "restore"]).has(operation)) {
    throw new FableChatAdminDataError("Conversation operation is invalid.");
  }
  const requestedTitle = operation === "rename" ? normalizedTitle(body?.title) : null;
  const identity = await writeIdentity(actorAdminUserId, `conversation_${operation}`, idempotencyKey, {
    conversationId: normalizedConversationId,
    expectedRevision: Number(body?.expectedRevision),
    reason,
    title: requestedTitle,
    effort: body?.effort ?? null,
    preset: body?.preset ?? null,
    reasoningSummaryEnabled: body?.reasoningSummaryEnabled ?? null,
    webSearchEnabled: body?.webSearchEnabled ?? null,
    webFetchEnabled: body?.webFetchEnabled ?? null,
    memoryMode: body?.memoryMode ?? null,
  });
  const replay = await readWriteReceipt(env, identity);
  if (replay) return replay;
  const conversation = await requireWritableConversation(env, normalizedConversationId, body?.expectedRevision);
  const mutationVersion = Number(conversation.admin_revision_version || 0) + 1;
  const timestamp = nowIso();
  let extraSql = "";
  let extraBindings = [];
  const result = { operation, conversationId: conversation.id, revision: mutationVersion };
  if (operation === "rename") {
    extraSql = ", title = ?, title_source = 'manual'";
    extraBindings = [requestedTitle];
  } else if (operation === "settings") {
    const effort = String(body?.effort || conversation.effort);
    const preset = String(body?.preset || conversation.system_preset_id);
    const thinking = body?.reasoningSummaryEnabled == null
      ? conversation.thinking_display
      : body.reasoningSummaryEnabled ? "summarized" : "omitted";
    const memoryMode = String(body?.memoryMode || conversation.memory_mode);
    if (!FABLE_CHAT_EFFORTS.includes(effort)
      || !FABLE_CHAT_SYSTEM_PRESET_IDS.includes(preset)
      || !FABLE_CHAT_THINKING_DISPLAYS.includes(thinking)
      || !["standard", "lite"].includes(memoryMode)
      || (body?.webSearchEnabled != null && typeof body.webSearchEnabled !== "boolean")
      || (body?.webFetchEnabled != null && typeof body.webFetchEnabled !== "boolean")) {
      throw new FableChatAdminDataError("Conversation settings are invalid.");
    }
    const webSearch = body?.webSearchEnabled == null
      ? Number(conversation.web_search_enabled || 0)
      : body.webSearchEnabled ? 1 : 0;
    const webFetch = body?.webFetchEnabled == null
      ? Number(conversation.web_fetch_enabled || 0)
      : body.webFetchEnabled ? 1 : 0;
    extraSql = `, effort = ?, system_preset_id = ?, thinking_display = ?,
      web_search_enabled = ?, web_fetch_enabled = ?, memory_mode = ?, settings_updated_at = ?`;
    extraBindings = [effort, preset, thinking, webSearch, webFetch, memoryMode, timestamp];
    Object.assign(result, {
      settings: {
        effort, preset, reasoningSummaryEnabled: thinking === "summarized",
        webSearchEnabled: webSearch === 1, webFetchEnabled: webFetch === 1, memoryMode,
      },
    });
  } else if (operation === "soft_delete") {
    if (conversation.deleted_at) throw new FableChatAdminDataError("Conversation is already deleted.", { status: 409, code: "invalid_state" });
    extraSql = ", deleted_at = ?";
    extraBindings = [timestamp];
  } else if (operation === "restore") {
    if (!conversation.deleted_at) throw new FableChatAdminDataError("Conversation is already active.", { status: 409, code: "invalid_state" });
    extraSql = ", deleted_at = NULL";
  }
  return executeWrite(env, identity, conversation, [
    conversationRevisionStatement(env, conversation, mutationVersion, timestamp, extraSql, extraBindings),
  ], result);
}

export async function editFableChatAdminMessage(env, {
  actorAdminUserId,
  conversationId,
  messageId,
  body,
  idempotencyKey,
}) {
  const normalizedConversationId = normalizeAdminFableConversationId(conversationId);
  const id = normalizeAdminFableMessageId(messageId);
  const reason = normalizedReason(body?.reason);
  const requestedContent = body?.content == null ? null : normalizedContent(body.content);
  const requestedCitations = body?.citations == null ? null : normalizeCitations(body.citations);
  const identity = await writeIdentity(actorAdminUserId, "message_edit", idempotencyKey, {
    conversationId: normalizedConversationId,
    messageId: id,
    expectedMessageRevision: Number(body?.expectedMessageRevision),
    expectedRevision: Number(body?.expectedRevision),
    content: requestedContent,
    citations: requestedCitations,
    reason,
  });
  const replay = await readWriteReceipt(env, identity);
  if (replay) return replay;
  const conversation = await requireWritableConversation(env, normalizedConversationId, body?.expectedRevision, { allowDeleted: false });
  const row = await env.DB.prepare(
    `SELECT m.id, m.role, m.content, m.citations_json, m.turn_order, t.id AS turn_id, t.status,
            COALESCE((SELECT MAX(r.revision_number) FROM fable_chat_admin_message_revisions r
              WHERE r.message_id = m.id), 0) AS current_revision,
            (SELECT r.content FROM fable_chat_admin_message_revisions r
              WHERE r.message_id = m.id ORDER BY r.revision_number DESC, r.id DESC LIMIT 1) AS revised_content,
            (SELECT r.citations_json FROM fable_chat_admin_message_revisions r
              WHERE r.message_id = m.id ORDER BY r.revision_number DESC, r.id DESC LIMIT 1) AS revised_citations_json
       FROM fable_chat_messages m
       INNER JOIN fable_chat_turns t ON t.conversation_id = m.conversation_id
        AND (t.user_message_id = m.id OR t.assistant_message_id = m.id)
      WHERE m.id = ? AND m.conversation_id = ? AND m.admin_user_id = ? LIMIT 1`
  ).bind(id, conversation.id, conversation.admin_user_id).first();
  if (!row) throw new FableChatAdminDataError("Message not found.", { status: 404, code: "not_found" });
  if (row.status !== "succeeded") {
    throw new FableChatAdminDataError("Only finalized complete turns can be revised.", { status: 409, code: "invalid_state" });
  }
  const expectedMessageRevision = boundedInteger(body?.expectedMessageRevision, 0, { min: 0 });
  if (expectedMessageRevision !== Number(row.current_revision || 0)) {
    throw new FableChatAdminDataError("Message changed. Refresh before trying again.", { status: 409, code: "revision_conflict" });
  }
  const content = body?.content == null
    ? (row.revised_content ?? row.content)
    : requestedContent;
  const citations = row.role === "assistant"
    ? (body?.citations == null ? parseCitations(row.revised_citations_json ?? row.citations_json) : requestedCitations)
    : [];
  if (row.role === "user" && body?.citations != null) {
    throw new FableChatAdminDataError("User messages cannot have citations.");
  }
  const messageRevision = expectedMessageRevision + 1;
  const mutationVersion = Number(conversation.admin_revision_version || 0) + 1;
  const timestamp = nowIso();
  const result = {
    operation: "message_edit",
    conversationId: conversation.id,
    messageId: id,
    turnId: row.turn_id,
    revision: mutationVersion,
    messageRevision,
  };
  identity.invalidatedFromTurnOrder = Number(row.turn_order);
  return executeWrite(env, identity, conversation, [
    env.DB.prepare(
      `INSERT INTO fable_chat_admin_message_revisions (
         id, conversation_id, admin_user_id, message_id, turn_id, revision_number,
         content, citations_json, actor_admin_user_id, reason, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      opaqueId("fmr"), conversation.id, conversation.admin_user_id, id, row.turn_id,
      messageRevision, content, JSON.stringify(citations), actorAdminUserId, reason, timestamp
    ),
    checkpointInvalidationStatement(env, conversation, actorAdminUserId, reason, mutationVersion, {
      atOrAfterTurnOrder: Number(row.turn_order),
    }),
    conversationRevisionStatement(
      env,
      conversation,
      mutationVersion,
      timestamp,
      `, admin_replay_invalidated_from_turn_order = CASE
        WHEN admin_replay_invalidated_from_turn_order < 0
          OR admin_replay_invalidated_from_turn_order > ? THEN ?
        ELSE admin_replay_invalidated_from_turn_order END`,
      [Number(row.turn_order), Number(row.turn_order)]
    ),
  ], result);
}

export async function reviseFableChatAdminTurn(env, {
  actorAdminUserId,
  conversationId,
  turnId,
  action,
  body,
  idempotencyKey,
}) {
  if (!new Set(["delete", "restore"]).has(action)) {
    throw new FableChatAdminDataError("Turn operation is invalid.");
  }
  const normalizedConversationId = normalizeAdminFableConversationId(conversationId);
  const id = normalizeAdminFableTurnId(turnId);
  const reason = normalizedReason(body?.reason);
  const identity = await writeIdentity(actorAdminUserId, `turn_${action}`, idempotencyKey, {
    conversationId: normalizedConversationId,
    turnId: id,
    expectedTurnRevision: Number(body?.expectedTurnRevision),
    expectedRevision: Number(body?.expectedRevision),
    reason,
  });
  const replay = await readWriteReceipt(env, identity);
  if (replay) return replay;
  const conversation = await requireWritableConversation(env, normalizedConversationId, body?.expectedRevision, { allowDeleted: false });
  const row = await env.DB.prepare(
    `SELECT t.id, t.status, um.turn_order,
            COALESCE((SELECT MAX(r.revision_number) FROM fable_chat_admin_turn_revisions r
              WHERE r.turn_id = t.id), 0) AS current_revision,
            (SELECT r.action FROM fable_chat_admin_turn_revisions r
              WHERE r.turn_id = t.id ORDER BY r.revision_number DESC, r.id DESC LIMIT 1) AS current_action
       FROM fable_chat_turns t
       INNER JOIN fable_chat_messages um ON um.id = t.user_message_id
       INNER JOIN fable_chat_messages am ON am.id = t.assistant_message_id
      WHERE t.id = ? AND t.conversation_id = ? AND t.admin_user_id = ?
        AND t.status = 'succeeded' AND um.state = 'succeeded' AND am.state = 'succeeded' LIMIT 1`
  ).bind(id, conversation.id, conversation.admin_user_id).first();
  if (!row) throw new FableChatAdminDataError("Complete turn not found.", { status: 404, code: "not_found" });
  const expectedTurnRevision = boundedInteger(body?.expectedTurnRevision, Number(row.current_revision || 0), { min: 0 });
  if (expectedTurnRevision !== Number(row.current_revision || 0)) {
    throw new FableChatAdminDataError("Turn changed. Refresh before trying again.", { status: 409, code: "revision_conflict" });
  }
  const currentlyDeleted = row.current_action === "delete";
  if ((action === "delete" && currentlyDeleted) || (action === "restore" && !currentlyDeleted)) {
    throw new FableChatAdminDataError("Turn is already in that administrative state.", { status: 409, code: "invalid_state" });
  }
  const turnRevision = expectedTurnRevision + 1;
  const mutationVersion = Number(conversation.admin_revision_version || 0) + 1;
  const timestamp = nowIso();
  const result = {
    operation: `turn_${action}`, conversationId: conversation.id, turnId: id,
    revision: mutationVersion, turnRevision, administrativelyDeleted: action === "delete",
  };
  identity.invalidatedFromTurnOrder = Number(row.turn_order);
  return executeWrite(env, identity, conversation, [
    env.DB.prepare(
      `INSERT INTO fable_chat_admin_turn_revisions (
         id, conversation_id, admin_user_id, turn_id, revision_number, action,
         actor_admin_user_id, reason, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      opaqueId("ftr"), conversation.id, conversation.admin_user_id, id, turnRevision,
      action, actorAdminUserId, reason, timestamp
    ),
    checkpointInvalidationStatement(env, conversation, actorAdminUserId, reason, mutationVersion, {
      atOrAfterTurnOrder: Number(row.turn_order),
    }),
    conversationRevisionStatement(
      env,
      conversation,
      mutationVersion,
      timestamp,
      `, admin_replay_invalidated_from_turn_order = CASE
        WHEN admin_replay_invalidated_from_turn_order < 0
          OR admin_replay_invalidated_from_turn_order > ? THEN ?
        ELSE admin_replay_invalidated_from_turn_order END`,
      [Number(row.turn_order), Number(row.turn_order)]
    ),
  ], result);
}

export async function invalidateFableChatAdminCheckpoint(env, {
  actorAdminUserId,
  conversationId,
  checkpointId,
  body,
  idempotencyKey,
}) {
  const normalizedConversationId = normalizeAdminFableConversationId(conversationId);
  const id = normalizeAdminFableCheckpointId(checkpointId);
  const reason = normalizedReason(body?.reason);
  const identity = await writeIdentity(actorAdminUserId, "checkpoint_invalidate", idempotencyKey, {
    conversationId: normalizedConversationId,
    checkpointId: id,
    expectedRevision: Number(body?.expectedRevision),
    reason,
  });
  const replay = await readWriteReceipt(env, identity);
  if (replay) return replay;
  const conversation = await requireWritableConversation(env, normalizedConversationId, body?.expectedRevision, { allowDeleted: false });
  const checkpoint = await env.DB.prepare(
    `SELECT id, status FROM fable_chat_memory_checkpoints
      WHERE id = ? AND conversation_id = ? AND admin_user_id = ? LIMIT 1`
  ).bind(id, conversation.id, conversation.admin_user_id).first();
  if (!checkpoint) throw new FableChatAdminDataError("Checkpoint not found.", { status: 404, code: "not_found" });
  if (checkpoint.status !== "succeeded") {
    throw new FableChatAdminDataError("Only succeeded checkpoints can be invalidated.", { status: 409, code: "invalid_state" });
  }
  const mutationVersion = Number(conversation.admin_revision_version || 0) + 1;
  const timestamp = nowIso();
  const result = { operation: "checkpoint_invalidate", conversationId: conversation.id, checkpointId: id, revision: mutationVersion };
  return executeWrite(env, identity, conversation, [
    checkpointInvalidationStatement(env, conversation, actorAdminUserId, reason, mutationVersion, { checkpointId: id }),
    conversationRevisionStatement(env, conversation, mutationVersion, timestamp),
  ], result);
}

export async function purgeFableChatAdminConversation(env, {
  actorAdminUserId,
  conversationId,
  body,
  idempotencyKey,
}) {
  const normalizedConversationId = normalizeAdminFableConversationId(conversationId);
  const reason = normalizedReason(body?.reason);
  const identity = await writeIdentity(actorAdminUserId, "conversation_purge", idempotencyKey, {
    conversationId: normalizedConversationId,
    expectedRevision: Number(body?.expectedRevision),
    confirmation: String(body?.confirmation || ""),
    reason,
  });
  const replay = await readWriteReceipt(env, identity);
  if (replay) return replay;
  const conversation = await requireWritableConversation(env, normalizedConversationId, body?.expectedRevision);
  if (!conversation.deleted_at) {
    throw new FableChatAdminDataError("Conversation must be soft-deleted before permanent purge.", { status: 409, code: "invalid_state" });
  }
  if (String(body?.confirmation || "") !== conversation.id) {
    throw new FableChatAdminDataError("Typed confirmation must exactly match the conversation ID.", { status: 400, code: "confirmation_mismatch" });
  }
  const result = { operation: "conversation_purge", conversationId: conversation.id, purged: true };
  const timestamp = nowIso();
  const mutationVersion = Number(conversation.admin_revision_version || 0) + 1;
  try {
    await env.DB.batch([
      mutationClaimStatement(env, identity, conversation, mutationVersion, timestamp),
      receiptStatement(env, identity, conversation.id, result, timestamp),
      env.DB.prepare(
        `DELETE FROM fable_chat_conversations
          WHERE id = ? AND admin_user_id = ? AND deleted_at IS NOT NULL
            AND admin_revision_version = ?`
      ).bind(conversation.id, conversation.admin_user_id, Number(conversation.admin_revision_version || 0)),
    ]);
    return { ...result, idempotentReplay: false };
  } catch (error) {
    if (isUniqueError(error)) {
      const concurrent = await readWriteReceipt(env, identity);
      if (concurrent) return concurrent;
      throw new FableChatAdminDataError("Conversation changed. Refresh before trying again.", {
        status: 409,
        code: "revision_conflict",
      });
    }
    throw error;
  }
}

const RAW_RECORDS = Object.freeze({
  conversation: {
    pattern: CONVERSATION_ID_PATTERN,
    table: "fable_chat_conversations",
    idColumn: "id",
    safeColumns: [
      "id", "admin_user_id", "model_id", "title", "title_source", "turn_count",
      "effort", "system_preset_id", "system_preset_version", "thinking_display",
      "prompt_cache_policy", "prompt_cache_version", "web_search_enabled", "web_fetch_enabled",
      "memory_mode",
      "settings_updated_at", "web_replay_pruned_through_turn_order",
      "web_replay_pruned_through_message_id", "web_replay_pruned_at",
      "web_replay_pruning_version", "admin_revision_version", "admin_revision_updated_at",
      "admin_replay_invalidated_from_turn_order",
      "created_at", "updated_at", "deleted_at",
    ],
  },
  message: {
    pattern: MESSAGE_ID_PATTERN,
    table: "fable_chat_messages",
    idColumn: "id",
    safeColumns: [
      "id", "conversation_id", "message_group_id", "admin_user_id", "turn_order",
      "role", "role_order", "content", "state", "model_id", "metadata_json",
      "reasoning_summary", "citations_json", "created_at", "updated_at",
    ],
  },
  turn: {
    pattern: TURN_ID_PATTERN,
    table: "fable_chat_turns",
    idColumn: "id",
    safeColumns: [
      "id", "conversation_id", "admin_user_id", "user_message_id", "assistant_message_id",
      "retry_of_turn_id", "status", "model_id", "context_included_turns",
      "context_omitted_turns", "context_character_count", "provider_model", "stop_reason",
      "stop_sequence", "usage_json", "error_code", "effort", "effective_max_output_tokens",
      "system_preset_id", "system_preset_version", "thinking_display", "prompt_cache_policy",
      "prompt_cache_version", "context_format_version", "estimated_input_tokens",
      "effective_input_token_limit", "context_estimator_version", "cache_breakpoint_json",
      "settings_snapshot_json", "provider_duration_ms", "output_truncated",
      "web_search_enabled", "web_search_tool_version", "web_search_max_uses",
      "web_search_contract_version", "web_search_request_count", "web_search_result_count",
      "web_search_effective_max_uses", "web_search_effective_contract_version",
      "web_search_executed_request_count", "web_search_executed_result_count",
      "web_fetch_enabled", "web_fetch_tool_version", "web_fetch_max_uses",
      "web_fetch_max_content_tokens", "web_fetch_contract_version",
      "web_fetch_direct_only", "web_fetch_use_cache", "web_fetch_request_count",
      "web_fetch_result_count", "web_fetch_error_result_count",
      "web_fetch_replay_pruned_pair_count", "web_fetch_replay_pruned_estimated_tokens",
      "memory_mode", "memory_contract_version", "memory_checkpoint_id",
      "memory_checkpoint_version", "memory_coverage_turn_order", "web_replay_pruning_version",
      "web_replay_pruned_through_turn_order", "web_replay_pruned_through_message_id",
      "web_replay_pruned_at", "web_replay_pruned_pair_count",
      "web_replay_pruned_estimated_tokens", "admin_revision_version",
      "created_at", "updated_at", "completed_at", "expires_at",
    ],
    redacted: ["idempotency_key_hash", "request_fingerprint", "gateway_metadata_json"],
  },
  checkpoint: {
    pattern: CHECKPOINT_ID_PATTERN,
    table: "fable_chat_memory_checkpoints",
    idColumn: "id",
    safeColumns: [
      "id", "conversation_id", "admin_user_id", "profile", "summary_version",
      "summarizer_model_id", "summarizer_prompt_version", "status", "base_checkpoint_id",
      "source_base_profile", "source_base_checkpoint_id", "estimated_summary_tokens",
      "coverage_turn_order", "coverage_through_turn_id", "coverage_through_message_id",
      "source_start_turn_id", "source_end_turn_id", "source_start_turn_order",
      "source_end_turn_order", "source_turn_count", "estimated_input_tokens",
      "usage_json", "provider_duration_ms", "provider_cost_usd_micros", "error_code",
      "created_at", "updated_at", "completed_at", "expires_at",
    ],
    redacted: ["input_fingerprint", "hidden_summary_content"],
  },
});

function sanitizeRawJsonColumns(row) {
  const output = { ...row };
  if (output.usage_json != null) output.usage_json = safeUsage(output.usage_json);
  if (output.metadata_json != null) output.metadata_json = parseJsonObject(output.metadata_json);
  if (output.citations_json != null) output.citations_json = parseCitations(output.citations_json);
  if (output.settings_snapshot_json != null) {
    const snapshot = parseJsonObject(output.settings_snapshot_json);
    delete snapshot.requestFingerprint;
    delete snapshot.idempotencyKeyHash;
    output.settings_snapshot_json = snapshot;
  }
  if (output.cache_breakpoint_json != null) output.cache_breakpoint_json = parseJsonObject(output.cache_breakpoint_json);
  return output;
}

export async function inspectFableChatAdminRawRecord(env, conversationId, kind, recordId) {
  const conversation = await readAdminConversationRow(env, conversationId);
  if (!conversation) return null;
  const config = RAW_RECORDS[String(kind || "")];
  if (!config) throw new FableChatAdminDataError("Record type is not allowlisted.");
  const id = requiredId(recordId, config.pattern, "Record ID");
  const selected = [...config.safeColumns, ...(config.redacted || [])];
  const ownershipClause = kind === "conversation"
    ? "id = ? AND admin_user_id = ?"
    : `${config.idColumn} = ? AND conversation_id = ? AND admin_user_id = ?`;
  const bindings = kind === "conversation"
    ? [id, conversation.admin_user_id]
    : [id, conversation.id, conversation.admin_user_id];
  const row = await env.DB.prepare(
    `SELECT ${selected.join(", ")} FROM ${config.table}
      WHERE ${ownershipClause} LIMIT 1`
  ).bind(...bindings).first();
  if (!row) return null;
  const safe = sanitizeRawJsonColumns(row);
  for (const key of config.redacted || []) safe[key] = row[key] == null ? null : "[REDACTED]";
  return { kind, record: safe, immutable: kind === "turn" || kind === "checkpoint" };
}

export function getFableChatAdminAuditMetadata(result) {
  return {
    conversation_id: result?.conversationId || null,
    message_id: result?.messageId || null,
    turn_id: result?.turnId || null,
    checkpoint_id: result?.checkpointId || null,
    operation: result?.operation || null,
    revision: Number.isFinite(Number(result?.revision)) ? Number(result.revision) : null,
    idempotent_replay: result?.idempotentReplay === true,
    status: result?.purged === true ? "purged" : "recorded",
  };
}
