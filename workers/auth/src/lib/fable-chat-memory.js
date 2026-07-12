import {
  FABLE_CHAT_DEFAULT_MEMORY_MODE,
  FABLE_CHAT_LITE_MEMORY_CHUNK_MAX_TOKENS,
  FABLE_CHAT_LITE_MEMORY_CHUNK_MIN_TOKENS,
  FABLE_CHAT_LITE_MEMORY_CHUNK_TARGET_TOKENS,
  FABLE_CHAT_LITE_MEMORY_MAX_SOURCE_ESTIMATED_TOKENS,
  FABLE_CHAT_LITE_MEMORY_PLAN_VERSION,
  FABLE_CHAT_LITE_MEMORY_RAW_MAX_TOKENS,
  FABLE_CHAT_LITE_MEMORY_RAW_MAX_TURNS,
  FABLE_CHAT_LITE_MEMORY_RAW_MIN_TOKENS,
  FABLE_CHAT_LITE_MEMORY_RAW_MIN_TURNS,
  FABLE_CHAT_LITE_MEMORY_TRIGGER_TOKENS,
  FABLE_CHAT_MEMORY_CONTRACT_VERSION,
  FABLE_CHAT_MEMORY_BASE_SOFT_TARGETS,
  FABLE_CHAT_MEMORY_DIAGNOSTIC_VERSION,
  FABLE_CHAT_MEMORY_ESTIMATOR_VERSION,
  FABLE_CHAT_MEMORY_LEASE_MINUTES,
  FABLE_CHAT_MEMORY_MAX_COMPACTIONS_PER_MAINTENANCE,
  FABLE_CHAT_MEMORY_MAX_SOURCE_CHARACTERS,
  FABLE_CHAT_MEMORY_MAX_SOURCE_ESTIMATED_TOKENS,
  FABLE_CHAT_MEMORY_MAX_SOURCE_TURNS,
  FABLE_CHAT_MEMORY_MODEL_ID,
  FABLE_CHAT_MEMORY_PROMPT_VERSION,
  FABLE_CHAT_MEMORY_MINIMUM_VIABLE_TARGETS,
  FABLE_CHAT_MEMORY_SAFETY_MARGINS,
  FABLE_CHAT_STANDARD_MEMORY_CHUNK_MAX_TOKENS,
  FABLE_CHAT_STANDARD_MEMORY_CHUNK_MIN_TOKENS,
  FABLE_CHAT_STANDARD_MEMORY_CHUNK_TARGET_TOKENS,
  FABLE_CHAT_STANDARD_MEMORY_RAW_MIN_TOKENS,
  FABLE_CHAT_STANDARD_MEMORY_TRIGGER_TOKENS,
  buildFableChatHiddenMemoryInstruction,
  buildFableChatMemoryProviderSourcePayload,
  buildFableChatMemorySummarizerSystemPrompt,
  calculateFableChatMemoryCostUsd,
  escapeFableChatMemoryPromptData,
  estimateFableChatMemoryInputTokens,
  estimateFableChatMemoryTextTokens,
  getFableChatMemoryAcceptanceCeiling,
  getFableChatMemoryPlanningCeiling,
  normalizeFableChatMemoryMode,
  normalizeFableChatMemoryRejectionCategory,
  normalizeFableChatMemorySummary,
} from "../../../shared/fable-chat-memory-contract.mjs";
import { proxyToAiLab } from "./admin-ai-proxy.js";
import {
  FABLE_CHAT_MEMORY_INTERNAL_PATH,
  admitFableChatMemoryBudgetUsage,
  prepareFableChatMemoryBudget,
  recordFableChatMemoryBudgetOutcome,
} from "./fable-chat-memory-budget.js";
import { addMinutesIso, nowIso, randomTokenHex, sha256Hex } from "./tokens.js";
import {
  getErrorFields,
  logDiagnostic,
} from "../../../../js/shared/worker-observability.mjs";

const MEMORY_SCAN_TURN_LIMIT = 768;
const MEMORY_ID_PATTERN = /^fbc_[a-f0-9]{32}$/;
const DISALLOWED_CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function checkpointId() {
  return `fbk_${randomTokenHex(16)}`;
}

function normalizeConversationId(value) {
  const id = String(value || "").trim();
  if (!MEMORY_ID_PATTERN.test(id)) throw new TypeError("Conversation ID is invalid.");
  return id;
}

function isUniqueConstraintError(error) {
  return /(?:UNIQUE constraint failed|D1_ERROR[^\n]*UNIQUE)/i.test(String(error?.message || error));
}

function safeErrorCode(value, fallback = "fable_chat_memory_failed") {
  const code = String(value || "").toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 80);
  return code || fallback;
}

export function resolveFableChatMemoryDiagnosticCategory(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  return normalizeFableChatMemoryRejectionCategory(value);
}

export function classifyFableChatMemoryProviderFailure(responseStatus, body) {
  const status = Math.max(0, Math.floor(Number(responseStatus) || 0));
  const rejectionCategory = resolveFableChatMemoryDiagnosticCategory(
    body?.diagnosticCategory
  );
  return {
    state: status >= 500 ? "unknown" : "failed",
    errorCode: rejectionCategory || safeErrorCode(
      body?.code,
      `memory_provider_status_${status}`
    ),
    rejectionCategory,
  };
}

export function buildFableChatMemoryCompactionFingerprintInput({
  profile,
  current,
  sourceBaseProfile,
  previous,
  previousSummary,
  sourceTurns,
  summaryPlan = null,
  diagnosticVersion = FABLE_CHAT_MEMORY_DIAGNOSTIC_VERSION,
  litePlanVersion = profile === "lite" ? FABLE_CHAT_LITE_MEMORY_PLAN_VERSION : 1,
  adminRevisionVersion = 0,
}) {
  const fingerprint = {
    contract_version: FABLE_CHAT_MEMORY_CONTRACT_VERSION,
    prompt_version: FABLE_CHAT_MEMORY_PROMPT_VERSION,
    diagnostic_version: diagnosticVersion,
    model_id: FABLE_CHAT_MEMORY_MODEL_ID,
    profile,
    base_checkpoint_id: current?.id || null,
    source_base_profile: sourceBaseProfile,
    source_base_checkpoint_id: sourceBaseProfile === "standard" && !current
      ? previous?.id || null
      : null,
    previous_summary: previousSummary,
    source_turns: sourceTurns,
  };
  if (diagnosticVersion >= 5) {
    const normalizedProfile = normalizeFableChatMemoryMode(profile);
    Object.assign(fingerprint, {
      planning_ceiling: getFableChatMemoryPlanningCeiling(normalizedProfile),
      base_soft_target: Math.max(
        0,
        Number(summaryPlan?.profileBaseSoftTarget)
          || FABLE_CHAT_MEMORY_BASE_SOFT_TARGETS[normalizedProfile]
      ),
      acceptance_ceiling: getFableChatMemoryAcceptanceCeiling(normalizedProfile),
      safety_margin: FABLE_CHAT_MEMORY_SAFETY_MARGINS[normalizedProfile],
      minimum_viable_target: FABLE_CHAT_MEMORY_MINIMUM_VIABLE_TARGETS[normalizedProfile],
      fixed_schema_overhead: Math.max(0, Number(summaryPlan?.fixedSchemaOverhead) || 0),
      source_overhead_estimate: Math.max(0, Number(summaryPlan?.sourceOverheadEstimate) || 0),
      effective_soft_target: Math.max(0, Number(summaryPlan?.effectiveSoftTarget) || 0),
      source_catalog_count: Math.max(0, Number(summaryPlan?.sourceCatalog?.length) || 0),
    });
  }
  if (profile === "lite") {
    fingerprint.lite_plan_version = litePlanVersion;
  }
  if (Number(adminRevisionVersion) > 0) {
    fingerprint.admin_revision_version = Math.floor(Number(adminRevisionVersion));
  }
  return fingerprint;
}

function parseStoredSources(value) {
  if (typeof value !== "string" || !value) return [];
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set();
  const output = [];
  for (const source of parsed.slice(0, 16)) {
    if (!source || typeof source !== "object" || Array.isArray(source)) continue;
    const title = typeof source.title === "string" ? source.title.trim().slice(0, 256) : "";
    if (DISALLOWED_CONTROL_PATTERN.test(title)) continue;
    let url;
    try {
      const parsedUrl = new URL(String(source.url || ""));
      if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password) continue;
      url = parsedUrl.toString();
    } catch {
      continue;
    }
    if (url.length > 2_048 || seen.has(url)) continue;
    seen.add(url);
    output.push({ title, url });
  }
  return output;
}

function estimateVisibleTurnTokens(turn) {
  return 24
    + estimateFableChatMemoryTextTokens(turn.user.text)
    + estimateFableChatMemoryTextTokens(turn.assistant.text)
    + estimateFableChatMemoryTextTokens(JSON.stringify(turn.assistant.sources || []));
}

function rowToSourceTurn(row) {
  const turn = {
    turnId: row.turn_id,
    turnOrder: Number(row.turn_order),
    user: {
      id: row.user_message_id,
      role: "user",
      text: String(row.user_content || ""),
    },
    assistant: {
      id: row.assistant_message_id,
      role: "assistant",
      text: String(row.assistant_content || ""),
      sources: parseStoredSources(row.citations_json),
    },
  };
  return { ...turn, estimatedTokens: estimateVisibleTurnTokens(turn) };
}

function checkpointFromRow(row, profile) {
  if (!row) return null;
  try {
    const normalized = normalizeFableChatMemorySummary(row.hidden_summary_content, { mode: profile });
    if (normalized.estimatedTokens !== Number(row.estimated_summary_tokens)) return null;
    return {
      id: row.id,
      profile,
      version: Number(row.summary_version),
      canonicalSummary: normalized.canonical,
      summary: normalized.summary,
      estimatedSummaryTokens: normalized.estimatedTokens,
      coverageTurnOrder: Number(row.coverage_turn_order),
      coverageThroughTurnId: row.coverage_through_turn_id,
      coverageThroughMessageId: row.coverage_through_message_id,
      inputFingerprint: row.input_fingerprint,
    };
  } catch {
    return null;
  }
}

async function readLatestCheckpoint(env, adminUserId, conversationId, profile) {
  const row = await env.DB.prepare(
    `SELECT m.id, m.profile, m.summary_version, m.hidden_summary_content,
            m.estimated_summary_tokens, m.coverage_turn_order,
            m.coverage_through_turn_id, m.coverage_through_message_id,
            m.input_fingerprint
       FROM fable_chat_memory_checkpoints m
       INNER JOIN fable_chat_conversations c ON c.id = m.conversation_id
       LEFT JOIN fable_chat_memory_checkpoint_invalidations i ON i.checkpoint_id = m.id
      WHERE m.conversation_id = ? AND m.admin_user_id = ? AND m.profile = ?
        AND m.status = 'succeeded' AND i.checkpoint_id IS NULL
        AND c.admin_user_id = ? AND c.deleted_at IS NULL
      ORDER BY m.summary_version DESC, m.id DESC
      LIMIT 1`
  ).bind(conversationId, adminUserId, profile, adminUserId).first();
  return checkpointFromRow(row, profile);
}

export async function getFableChatMemorySelection(env, adminUserId, conversationId, mode) {
  const id = normalizeConversationId(conversationId);
  const profile = normalizeFableChatMemoryMode(mode || FABLE_CHAT_DEFAULT_MEMORY_MODE);
  const checkpoint = await readLatestCheckpoint(env, adminUserId, id, profile);
  if (!checkpoint) {
    return {
      mode: profile,
      contractVersion: FABLE_CHAT_MEMORY_CONTRACT_VERSION,
      checkpointId: null,
      checkpointVersion: 0,
      coverageTurnOrder: -1,
      summary: null,
    };
  }
  return {
    mode: profile,
    contractVersion: FABLE_CHAT_MEMORY_CONTRACT_VERSION,
    checkpointId: checkpoint.id,
    checkpointVersion: checkpoint.version,
    coverageTurnOrder: checkpoint.coverageTurnOrder,
    summary: checkpoint.canonicalSummary,
  };
}

export function buildFableChatSystemWithMemory(baseSystem, selection) {
  if (!selection?.summary || !selection?.checkpointVersion) return baseSystem;
  const instruction = buildFableChatHiddenMemoryInstruction(
    selection.mode,
    selection.checkpointVersion,
    selection.summary
  );
  return `${baseSystem}\n\n${instruction}`;
}

export function selectFableChatMemoryRawTurns(priorTurnsNewestFirst, selection) {
  if (!selection?.summary || !selection?.checkpointVersion) return priorTurnsNewestFirst;
  if (selection.mode === "standard") {
    return priorTurnsNewestFirst.filter((turn) => (
      Number(turn.turnOrder) > Number(selection.coverageTurnOrder)
    ));
  }
  const selected = [];
  let tokens = 0;
  for (const turn of priorTurnsNewestFirst) {
    if (selected.length >= FABLE_CHAT_LITE_MEMORY_RAW_MAX_TURNS) break;
    const turnTokens = Math.max(1, Number(turn.visibleEstimatedTokens) || 1);
    if (
      selected.length >= FABLE_CHAT_LITE_MEMORY_RAW_MIN_TURNS
      && tokens >= FABLE_CHAT_LITE_MEMORY_RAW_MIN_TOKENS
      && tokens + turnTokens > FABLE_CHAT_LITE_MEMORY_RAW_MAX_TOKENS
    ) break;
    selected.push(turn);
    tokens += turnTokens;
  }
  return selected;
}

async function readConversationMemoryMode(env, adminUserId, conversationId) {
  const row = await env.DB.prepare(
    `SELECT memory_mode, admin_revision_version FROM fable_chat_conversations
      WHERE id = ? AND admin_user_id = ? AND deleted_at IS NULL
      LIMIT 1`
  ).bind(conversationId, adminUserId).first();
  if (!row) return null;
  try {
    return {
      mode: normalizeFableChatMemoryMode(row.memory_mode || FABLE_CHAT_DEFAULT_MEMORY_MODE),
      adminRevisionVersion: Math.max(0, Number(row.admin_revision_version || 0)),
    };
  } catch {
    return { mode: FABLE_CHAT_DEFAULT_MEMORY_MODE, adminRevisionVersion: 0 };
  }
}

async function readVisibleTurnsAfter(
  env,
  adminUserId,
  conversationId,
  coverageTurnOrder,
  { preserveZero = false } = {}
) {
  const numericCoverage = Number(coverageTurnOrder);
  const appliedCoverage = preserveZero && Number.isFinite(numericCoverage)
    ? Math.max(-1, numericCoverage)
    : Math.max(-1, numericCoverage || -1);
  const rows = await env.DB.prepare(
    `SELECT t.id AS turn_id, um.turn_order,
            um.id AS user_message_id,
            COALESCE((SELECT r.content FROM fable_chat_admin_message_revisions r
              WHERE r.message_id = um.id ORDER BY r.revision_number DESC, r.id DESC LIMIT 1), um.content) AS user_content,
            am.id AS assistant_message_id,
            COALESCE((SELECT r.content FROM fable_chat_admin_message_revisions r
              WHERE r.message_id = am.id ORDER BY r.revision_number DESC, r.id DESC LIMIT 1), am.content) AS assistant_content,
            COALESCE((SELECT r.citations_json FROM fable_chat_admin_message_revisions r
              WHERE r.message_id = am.id ORDER BY r.revision_number DESC, r.id DESC LIMIT 1), am.citations_json) AS citations_json
       FROM fable_chat_turns t
       INNER JOIN fable_chat_conversations c ON c.id = t.conversation_id
       INNER JOIN fable_chat_messages um ON um.id = t.user_message_id
        AND um.conversation_id = t.conversation_id AND um.admin_user_id = t.admin_user_id
        AND um.role = 'user' AND um.state = 'succeeded'
       INNER JOIN fable_chat_messages am ON am.id = t.assistant_message_id
        AND am.conversation_id = t.conversation_id AND am.admin_user_id = t.admin_user_id
        AND am.role = 'assistant' AND am.state = 'succeeded'
      WHERE t.conversation_id = ? AND t.admin_user_id = ? AND t.status = 'succeeded'
        AND c.admin_user_id = ? AND c.deleted_at IS NULL
        AND um.turn_order > ?
        AND COALESCE((SELECT CASE tr.action WHEN 'delete' THEN 1 ELSE 0 END
          FROM fable_chat_admin_turn_revisions tr WHERE tr.turn_id = t.id
          ORDER BY tr.revision_number DESC, tr.id DESC LIMIT 1), 0) = 0
      ORDER BY um.turn_order ASC, t.id ASC
      LIMIT ?`
  ).bind(
    conversationId,
    adminUserId,
    adminUserId,
    appliedCoverage,
    MEMORY_SCAN_TURN_LIMIT
  ).all();
  return (rows?.results || []).map(rowToSourceTurn);
}

function totalTurnTokens(turns) {
  return turns.reduce((total, turn) => total + turn.estimatedTokens, 0);
}

function chooseSequentialChunk(turns, {
  targetTokens,
  minTokens,
  maxTokens,
  minimumRemainingTokens = 0,
}) {
  if (turns.length === 0) return [];
  const total = totalTurnTokens(turns);
  let cumulative = 0;
  const candidates = [];
  const fallback = [];
  for (let index = 0; index < Math.min(turns.length, FABLE_CHAT_MEMORY_MAX_SOURCE_TURNS); index += 1) {
    cumulative += turns[index].estimatedTokens;
    const remaining = total - cumulative;
    if (remaining < minimumRemainingTokens) break;
    const candidate = {
      count: index + 1,
      tokens: cumulative,
      distance: Math.abs(cumulative - targetTokens),
    };
    fallback.push(candidate);
    if (cumulative >= minTokens && cumulative <= maxTokens) candidates.push(candidate);
    if (cumulative > maxTokens && index > 0) break;
  }
  const pool = candidates.length > 0 ? candidates : fallback;
  if (pool.length === 0) return [];
  pool.sort((left, right) => left.distance - right.distance || left.count - right.count);
  return turns.slice(0, pool[0].count);
}

async function buildCompactionCandidate(env, adminUserId, conversationId, profile) {
  const conversationState = await readConversationMemoryMode(env, adminUserId, conversationId);
  if (!conversationState) return null;
  const current = await readLatestCheckpoint(env, adminUserId, conversationId, profile);
  let previous = current;
  let sourceBaseProfile = current ? profile : null;
  let coverageTurnOrder = current?.coverageTurnOrder ?? -1;
  if (profile === "lite" && !current) {
    const standard = await readLatestCheckpoint(env, adminUserId, conversationId, "standard");
    if (standard) {
      previous = standard;
      sourceBaseProfile = "standard";
      coverageTurnOrder = standard.coverageTurnOrder;
    }
  }
  const turns = await readVisibleTurnsAfter(
    env,
    adminUserId,
    conversationId,
    coverageTurnOrder,
    { preserveZero: profile === "lite" }
  );
  const totalTokens = totalTurnTokens(turns);
  let sourceTurns = [];
  if (profile === "standard") {
    if (totalTokens < FABLE_CHAT_STANDARD_MEMORY_TRIGGER_TOKENS) return null;
    sourceTurns = chooseSequentialChunk(turns, {
      targetTokens: FABLE_CHAT_STANDARD_MEMORY_CHUNK_TARGET_TOKENS,
      minTokens: FABLE_CHAT_STANDARD_MEMORY_CHUNK_MIN_TOKENS,
      maxTokens: FABLE_CHAT_STANDARD_MEMORY_CHUNK_MAX_TOKENS,
      minimumRemainingTokens: FABLE_CHAT_STANDARD_MEMORY_RAW_MIN_TOKENS,
    });
  } else {
    const initializingFromStandard = !current && sourceBaseProfile === "standard";
    if (!initializingFromStandard && totalTokens < FABLE_CHAT_LITE_MEMORY_TRIGGER_TOKENS) {
      return null;
    }
    sourceTurns = chooseSequentialChunk(turns, {
      targetTokens: FABLE_CHAT_LITE_MEMORY_CHUNK_TARGET_TOKENS,
      minTokens: FABLE_CHAT_LITE_MEMORY_CHUNK_MIN_TOKENS,
      maxTokens: FABLE_CHAT_LITE_MEMORY_CHUNK_MAX_TOKENS,
    });
    if (sourceTurns.length === 0 && !initializingFromStandard) return null;
  }
  if (sourceTurns.length === 0 && !previous) return null;
  const lastSource = sourceTurns.at(-1) || null;
  const nextCoverage = lastSource ? {
    turnOrder: lastSource.turnOrder,
    turnId: lastSource.turnId,
    messageId: lastSource.assistant.id,
  } : {
    turnOrder: previous.coverageTurnOrder,
    turnId: previous.coverageThroughTurnId,
    messageId: previous.coverageThroughMessageId,
  };
  const cleanTurns = sourceTurns.map(({ estimatedTokens, ...turn }) => turn);
  const previousSummary = previous?.summary || null;
  const litePlanVersion = profile === "lite" ? FABLE_CHAT_LITE_MEMORY_PLAN_VERSION : 1;
  const { sourcePayload, budgetPlan } = buildFableChatMemoryProviderSourcePayload({
    mode: profile,
    dynamicBudget: true,
    litePlanVersion,
    previousSummary,
    sourceTurns: cleanTurns,
  });
  const estimatedInputTokens = estimateFableChatMemoryInputTokens(
    `${buildFableChatMemorySummarizerSystemPrompt(profile, {
      sourceIdContract: true,
      effectiveSoftTarget: budgetPlan.effectiveSoftTarget,
      litePlanVersion,
    })}\n${escapeFableChatMemoryPromptData(sourcePayload)}`
  );
  if (
    sourcePayload.length > FABLE_CHAT_MEMORY_MAX_SOURCE_CHARACTERS
    || estimatedInputTokens > FABLE_CHAT_MEMORY_MAX_SOURCE_ESTIMATED_TOKENS
    || (profile === "lite"
      && estimatedInputTokens > FABLE_CHAT_LITE_MEMORY_MAX_SOURCE_ESTIMATED_TOKENS)
  ) return null;
  const inputFingerprint = await sha256Hex(JSON.stringify(
    buildFableChatMemoryCompactionFingerprintInput({
      profile,
      current,
      sourceBaseProfile,
      previous,
      previousSummary,
      sourceTurns: cleanTurns,
      summaryPlan: budgetPlan,
      litePlanVersion,
      adminRevisionVersion: conversationState.adminRevisionVersion,
    })
  ));
  return {
    profile,
    current,
    previous,
    sourceBaseProfile,
    sourceTurns: cleanTurns,
    sourcePayload,
    budgetPlan,
    litePlanVersion,
    estimatedInputTokens,
    inputFingerprint,
    coverage: nextCoverage,
  };
}

async function expireStaleCompaction(env, adminUserId, conversationId, profile) {
  const completedAt = nowIso();
  await env.DB.prepare(
    `UPDATE fable_chat_memory_checkpoints
        SET status = 'unknown', error_code = 'memory_compaction_expired',
            updated_at = ?, completed_at = ?
      WHERE conversation_id = ? AND admin_user_id = ? AND profile = ?
        AND status IN ('pending', 'running') AND expires_at <= ?`
  ).bind(completedAt, completedAt, conversationId, adminUserId, profile, completedAt).run();
}

async function claimCompaction(env, adminUserId, conversationId, candidate, {
  id,
  version,
}) {
  await expireStaleCompaction(env, adminUserId, conversationId, candidate.profile);
  const existing = await env.DB.prepare(
    `SELECT id, status FROM fable_chat_memory_checkpoints
      WHERE conversation_id = ? AND admin_user_id = ? AND profile = ?
        AND input_fingerprint = ?
      LIMIT 1`
  ).bind(
    conversationId,
    adminUserId,
    candidate.profile,
    candidate.inputFingerprint
  ).first();
  if (existing) return null;
  const createdAt = nowIso();
  try {
    const result = await env.DB.prepare(
      `INSERT INTO fable_chat_memory_checkpoints (
         id, conversation_id, admin_user_id, profile, summary_version,
         summarizer_model_id, summarizer_prompt_version, status,
         base_checkpoint_id, source_base_profile, source_base_checkpoint_id,
         hidden_summary_content, estimated_summary_tokens, coverage_turn_order,
         coverage_through_turn_id, coverage_through_message_id,
         source_start_turn_id, source_end_turn_id, source_start_turn_order,
         source_end_turn_order, source_turn_count, estimated_input_tokens,
         input_fingerprint, usage_json, provider_duration_ms, provider_cost_usd_micros,
         error_code, created_at, updated_at, completed_at, expires_at
       )
       SELECT ?, c.id, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, NULL, NULL, ?, ?, ?,
              ?, ?, ?, ?, ?, ?, ?, '{}', NULL, NULL, NULL, ?, ?, NULL, ?
         FROM fable_chat_conversations c
        WHERE c.id = ? AND c.admin_user_id = ? AND c.deleted_at IS NULL`
    ).bind(
      id,
      adminUserId,
      candidate.profile,
      version,
      FABLE_CHAT_MEMORY_MODEL_ID,
      FABLE_CHAT_MEMORY_PROMPT_VERSION,
      candidate.current?.id || null,
      candidate.sourceBaseProfile,
      candidate.sourceBaseProfile === "standard" && !candidate.current
        ? candidate.previous?.id || null
        : null,
      candidate.coverage.turnOrder,
      candidate.coverage.turnId,
      candidate.coverage.messageId,
      candidate.sourceTurns[0]?.turnId || null,
      candidate.sourceTurns.at(-1)?.turnId || null,
      candidate.sourceTurns[0]?.turnOrder ?? null,
      candidate.sourceTurns.at(-1)?.turnOrder ?? null,
      candidate.sourceTurns.length,
      candidate.estimatedInputTokens,
      candidate.inputFingerprint,
      createdAt,
      createdAt,
      addMinutesIso(FABLE_CHAT_MEMORY_LEASE_MINUTES),
      conversationId,
      adminUserId
    ).run();
    if (!Number(result?.meta?.changes || 0)) return null;
    return { id, version };
  } catch (error) {
    if (isUniqueConstraintError(error)) return null;
    throw error;
  }
}

async function markCompactionState(env, id, status, errorCode = null) {
  const now = nowIso();
  const result = await env.DB.prepare(
    `UPDATE fable_chat_memory_checkpoints
        SET status = ?, error_code = ?, updated_at = ?,
            completed_at = CASE WHEN ? IN ('failed', 'unknown') THEN ? ELSE completed_at END
      WHERE id = ? AND status IN ('pending', 'running')`
  ).bind(status, errorCode ? safeErrorCode(errorCode) : null, now, status, now, id).run();
  return Number(result?.meta?.changes || 0) > 0;
}

async function finalizeCompaction(env, adminUserId, conversationId, claim, candidate, output) {
  const normalized = normalizeFableChatMemorySummary(output.summary, { mode: candidate.profile });
  if (normalized.estimatedTokens !== Number(output.estimatedSummaryTokens)) {
    throw new TypeError("Memory summary token metadata is inconsistent.");
  }
  const usage = {};
  for (const key of ["input_tokens", "output_tokens", "total_tokens"]) {
    const value = Number(output.usage?.[key]);
    if (Number.isFinite(value) && value >= 0) usage[key] = Math.floor(value);
  }
  const calculatedCost = calculateFableChatMemoryCostUsd(usage).totalCostUsd;
  if (!Number.isFinite(Number(output.providerCostUsd))
    || Math.abs(Number(output.providerCostUsd) - calculatedCost) > 0.00000001) {
    throw new TypeError("Memory provider cost metadata is inconsistent.");
  }
  const completedAt = nowIso();
  const result = await env.DB.prepare(
    `UPDATE fable_chat_memory_checkpoints
        SET status = 'succeeded', hidden_summary_content = ?, estimated_summary_tokens = ?,
            usage_json = ?, provider_duration_ms = ?, provider_cost_usd_micros = ?,
            error_code = NULL, updated_at = ?, completed_at = ?
      WHERE id = ? AND conversation_id = ? AND admin_user_id = ? AND profile = ?
        AND status = 'running' AND input_fingerprint = ?
        AND EXISTS (
          SELECT 1 FROM fable_chat_conversations c
           WHERE c.id = fable_chat_memory_checkpoints.conversation_id
             AND c.admin_user_id = fable_chat_memory_checkpoints.admin_user_id
             AND c.deleted_at IS NULL
        )`
  ).bind(
    normalized.canonical,
    normalized.estimatedTokens,
    JSON.stringify(usage),
    Math.max(0, Math.floor(Number(output.elapsedMs) || 0)),
    Math.max(0, Math.round(calculatedCost * 1_000_000)),
    completedAt,
    completedAt,
    claim.id,
    conversationId,
    adminUserId,
    candidate.profile,
    candidate.inputFingerprint
  ).run();
  if (!Number(result?.meta?.changes || 0)) {
    const error = new Error("Memory checkpoint finalization lost its concurrency claim.");
    error.code = "fable_chat_memory_finalize_conflict";
    throw error;
  }
  return {
    checkpointId: claim.id,
    checkpointVersion: claim.version,
    estimatedSummaryTokens: normalized.estimatedTokens,
    providerCostUsd: calculatedCost,
    usage,
  };
}

async function runOneCompaction(ctx, adminUser, conversationId, profile) {
  const candidate = await buildCompactionCandidate(
    ctx.env,
    adminUser.id,
    conversationId,
    profile
  );
  if (!candidate) return { attempted: false, succeeded: false };
  const provisionalId = checkpointId();
  const versionRow = await ctx.env.DB.prepare(
    `SELECT COALESCE(MAX(summary_version), 0) + 1 AS next_version
       FROM fable_chat_memory_checkpoints
      WHERE conversation_id = ? AND admin_user_id = ? AND profile = ?`
  ).bind(conversationId, adminUser.id, profile).first();
  let budget;
  try {
    budget = await prepareFableChatMemoryBudget({
      env: ctx.env,
      adminUser,
      conversationId,
      checkpointId: provisionalId,
      checkpointVersion: Number(versionRow?.next_version || 1),
      profile,
      inputFingerprint: candidate.inputFingerprint,
      estimatedInputTokens: candidate.estimatedInputTokens,
      summaryPlan: candidate.budgetPlan,
      correlationId: ctx.correlationId,
    });
  } catch (error) {
    logDiagnostic({
      service: "bitbi-auth",
      component: "fable-chat-memory",
      event: "fable_chat_memory_budget_skipped",
      level: "warn",
      correlationId: ctx.correlationId,
      admin_user_id: adminUser.id,
      conversation_id: conversationId,
      profile,
      ...getErrorFields(error, { includeMessage: false }),
    });
    return { attempted: false, succeeded: false };
  }
  const provisionalVersion = Number(versionRow?.next_version || 1);
  const claim = await claimCompaction(
    ctx.env,
    adminUser.id,
    conversationId,
    candidate,
    { id: provisionalId, version: provisionalVersion }
  );
  if (!claim) return { attempted: false, succeeded: false };
  let providerStarted = false;
  try {
    await admitFableChatMemoryBudgetUsage({
      env: ctx.env,
      adminUserId: adminUser.id,
      checkpointId: claim.id,
      inputFingerprint: candidate.inputFingerprint,
      units: budget.units,
      metadata: budget.metadata,
    });
    if (!await markCompactionState(ctx.env, claim.id, "running")) {
      throw Object.assign(new Error("Memory compaction lost its admission claim."), {
        code: "fable_chat_memory_claim_conflict",
      });
    }
    providerStarted = true;
    const response = await proxyToAiLab(
      ctx.env,
      FABLE_CHAT_MEMORY_INTERNAL_PATH,
      {
        method: "POST",
        body: {
          profile,
          memoryContractVersion: FABLE_CHAT_MEMORY_CONTRACT_VERSION,
          promptVersion: FABLE_CHAT_MEMORY_PROMPT_VERSION,
          diagnosticVersion: FABLE_CHAT_MEMORY_DIAGNOSTIC_VERSION,
          ...(profile === "lite" ? { litePlanVersion: candidate.litePlanVersion } : {}),
          previousSummaryProfile: candidate.previous ? candidate.sourceBaseProfile : null,
          previousSummary: candidate.previous?.summary || null,
          sourceTurns: candidate.sourceTurns,
        },
        callerPolicy: budget.callerPolicy,
      },
      adminUser,
      ctx.correlationId,
      ctx
    );
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok || body?.ok !== true) {
      const failure = classifyFableChatMemoryProviderFailure(response.status, body);
      await markCompactionState(
        ctx.env,
        claim.id,
        failure.state,
        failure.errorCode
      );
      await recordFableChatMemoryBudgetOutcome(ctx.env, claim.id, {
        finalState: failure.state,
      });
      if (failure.rejectionCategory) {
        logDiagnostic({
          service: "bitbi-auth",
          component: "fable-chat-memory",
          event: "fable_chat_memory_compaction_rejected",
          level: "warn",
          correlationId: ctx.correlationId,
          admin_user_id: adminUser.id,
          conversation_id: conversationId,
          checkpoint_id: claim.id,
          checkpoint_version: claim.version,
          profile,
          final_state: failure.state,
          rejection_category: failure.rejectionCategory,
          diagnostic_version: FABLE_CHAT_MEMORY_DIAGNOSTIC_VERSION,
          upstream_status: response.status,
        });
      }
      return { attempted: true, succeeded: false };
    }
    if (body?.model?.id !== FABLE_CHAT_MEMORY_MODEL_ID) {
      throw Object.assign(new TypeError("Memory model identity is invalid."), {
        code: "fable_chat_memory_invalid_provider_result",
        rejectionCategory: "invalid_model_identity",
      });
    }
    const finalized = await finalizeCompaction(
      ctx.env,
      adminUser.id,
      conversationId,
      claim,
      candidate,
      {
        summary: body?.result?.summary,
        estimatedSummaryTokens: body?.result?.estimatedSummaryTokens,
        usage: body?.result?.usage,
        providerCostUsd: body?.result?.providerCostUsd,
        elapsedMs: body?.elapsedMs,
      }
    );
    await recordFableChatMemoryBudgetOutcome(ctx.env, claim.id, {
      finalState: "succeeded",
      durationMs: body?.elapsedMs,
      usage: finalized.usage,
      providerCostUsd: finalized.providerCostUsd,
    });
    logDiagnostic({
      service: "bitbi-auth",
      component: "fable-chat-memory",
      event: "fable_chat_memory_compaction_succeeded",
      level: "info",
      correlationId: ctx.correlationId,
      admin_user_id: adminUser.id,
      conversation_id: conversationId,
      checkpoint_id: claim.id,
      checkpoint_version: claim.version,
      profile,
      source_turn_count: candidate.sourceTurns.length,
      estimated_input_tokens: candidate.estimatedInputTokens,
      estimated_summary_tokens: finalized.estimatedSummaryTokens,
      provider_duration_ms: Math.max(0, Math.floor(Number(body?.elapsedMs) || 0)),
      source_catalog_count: Math.max(
        0,
        Math.floor(Number(body?.result?.sourceDiagnostics?.source_catalog_count) || 0)
      ),
      returned_source_id_count: Math.max(
        0,
        Math.floor(Number(body?.result?.sourceDiagnostics?.returned_source_id_count) || 0)
      ),
      resolved_source_id_count: Math.max(
        0,
        Math.floor(Number(body?.result?.sourceDiagnostics?.resolved_source_id_count) || 0)
      ),
      unknown_source_id_count: Math.max(
        0,
        Math.floor(Number(body?.result?.sourceDiagnostics?.unknown_source_id_count) || 0)
      ),
      duplicate_source_id_count: Math.max(
        0,
        Math.floor(Number(body?.result?.sourceDiagnostics?.duplicate_source_id_count) || 0)
      ),
      malformed_source_id_count: Math.max(
        0,
        Math.floor(Number(body?.result?.sourceDiagnostics?.malformed_source_id_count) || 0)
      ),
      source_id_shape_valid: body?.result?.sourceDiagnostics?.source_id_shape_valid === true,
      planning_ceiling: Math.max(
        0,
        Math.floor(Number(body?.result?.sourceDiagnostics?.planning_ceiling) || 0)
      ),
      base_soft_target: Math.max(
        0,
        Math.floor(Number(body?.result?.sourceDiagnostics?.base_soft_target) || 0)
      ),
      acceptance_ceiling: Math.max(
        0,
        Math.floor(Number(body?.result?.sourceDiagnostics?.acceptance_ceiling) || 0)
      ),
      fixed_schema_overhead: Math.max(
        0,
        Math.floor(Number(body?.result?.sourceDiagnostics?.fixed_schema_overhead) || 0)
      ),
      source_overhead_estimate: Math.max(
        0,
        Math.floor(Number(body?.result?.sourceDiagnostics?.source_overhead_estimate) || 0)
      ),
      safety_margin: Math.max(
        0,
        Math.floor(Number(body?.result?.sourceDiagnostics?.safety_margin) || 0)
      ),
      effective_summary_target: Math.max(
        0,
        Math.floor(Number(body?.result?.sourceDiagnostics?.effective_summary_target) || 0)
      ),
      effective_soft_target: Math.max(
        0,
        Math.floor(Number(body?.result?.sourceDiagnostics?.effective_soft_target) || 0)
      ),
      final_estimated_summary_size: Math.max(
        0,
        Math.floor(Number(body?.result?.sourceDiagnostics?.final_estimated_summary_size) || 0)
      ),
      final_limit_exceeded: body?.result?.sourceDiagnostics?.final_limit_exceeded === true,
    });
    return { attempted: true, succeeded: true };
  } catch (error) {
    const state = providerStarted ? "unknown" : "failed";
    try {
      await markCompactionState(
        ctx.env,
        claim.id,
        state,
        error?.rejectionCategory || error?.code
      );
      await recordFableChatMemoryBudgetOutcome(ctx.env, claim.id, { finalState: state });
    } catch {
      // The durable lease later resolves a stranded provider attempt to unknown.
    }
    logDiagnostic({
      service: "bitbi-auth",
      component: "fable-chat-memory",
      event: "fable_chat_memory_compaction_failed",
      level: "warn",
      correlationId: ctx.correlationId,
      admin_user_id: adminUser.id,
      conversation_id: conversationId,
      checkpoint_id: claim.id,
      profile,
      final_state: state,
      rejection_category: resolveFableChatMemoryDiagnosticCategory(
        error?.rejectionCategory
      ),
      diagnostic_version: FABLE_CHAT_MEMORY_DIAGNOSTIC_VERSION,
      ...getErrorFields(error, { includeMessage: false }),
    });
    return { attempted: true, succeeded: false };
  }
}

export async function maintainFableChatMemory(ctx, adminUser, conversationId) {
  const id = normalizeConversationId(conversationId);
  const conversationState = await readConversationMemoryMode(ctx.env, adminUser.id, id);
  if (!conversationState) return;
  const mode = conversationState.mode;
  let remaining = FABLE_CHAT_MEMORY_MAX_COMPACTIONS_PER_MAINTENANCE;
  const firstStandard = await runOneCompaction(ctx, adminUser, id, "standard");
  if (firstStandard.attempted) remaining -= 1;
  if (mode === "lite") {
    if (remaining > 0) await runOneCompaction(ctx, adminUser, id, "lite");
    return;
  }
  while (remaining > 0 && firstStandard.succeeded) {
    const result = await runOneCompaction(ctx, adminUser, id, "standard");
    if (!result.attempted || !result.succeeded) break;
    remaining -= 1;
  }
}

export function scheduleFableChatMemoryMaintenance(ctx, adminUser, conversationId) {
  const promise = maintainFableChatMemory(ctx, adminUser, conversationId).catch((error) => {
    logDiagnostic({
      service: "bitbi-auth",
      component: "fable-chat-memory",
      event: "fable_chat_memory_maintenance_failed",
      level: "warn",
      correlationId: ctx.correlationId,
      admin_user_id: adminUser.id,
      conversation_id: conversationId,
      ...getErrorFields(error, { includeMessage: false }),
    });
  });
  if (ctx.execCtx?.waitUntil) ctx.execCtx.waitUntil(promise);
  return promise;
}

export const FABLE_CHAT_MEMORY_CONTEXT_ESTIMATOR_VERSION = FABLE_CHAT_MEMORY_ESTIMATOR_VERSION;
