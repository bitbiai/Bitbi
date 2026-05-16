import { json } from "./response.js";
import { nowIso, randomTokenHex, sha256Hex } from "./tokens.js";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["", "0", "false", "no", "off"]);
const SAFE_FLAG_NAME_PATTERN = /^[A-Z][A-Z0-9_]{2,95}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9._:@/-]{1,160}$/;
const SAFE_SWITCH_KEY_PATTERN = /^ENABLE_[A-Z0-9_]{8,95}$/;
const MAX_REASON_LENGTH = 500;
const UNSAFE_METADATA_KEY_PATTERN = /(secret|token|cookie|authorization|auth_header|private[_-]?key|stripe|cloudflare|api[_-]?key)/i;

export const ADMIN_RUNTIME_BUDGET_SWITCH_TABLE = "admin_runtime_budget_switches";
export const ADMIN_RUNTIME_BUDGET_SWITCH_EVENTS_TABLE = "admin_runtime_budget_switch_events";

export const ADMIN_PLATFORM_BUDGET_SWITCH_DEFINITIONS = Object.freeze([
  Object.freeze({
    switchKey: "ENABLE_ADMIN_AI_BFL_IMAGE_BUDGET",
    flagName: "ENABLE_ADMIN_AI_BFL_IMAGE_BUDGET",
    label: "Admin BFL Image Budget",
    description: "Allows charged Admin Image tests for BFL priced models when selected-organization credits also pass.",
    category: "admin_image",
    budgetScope: "admin_org_credit_account",
    operationIds: Object.freeze(["admin.image.test.charged"]),
    ownerDomain: "admin-ai-image",
    defaultAppEnabled: false,
    riskLevel: "high",
    requiresMasterFlag: true,
    recommendedOperatorNote: "Enable only for bounded charged Admin Image testing with selected organization context.",
    relatedRoutes: Object.freeze(["POST /api/admin/ai/test-image"]),
    liveCapStatus: "not_implemented",
    liveCapFuturePhase: "Phase 4.17",
  }),
  Object.freeze({
    switchKey: "ENABLE_ADMIN_AI_GPT_IMAGE_BUDGET",
    flagName: "ENABLE_ADMIN_AI_GPT_IMAGE_BUDGET",
    label: "Admin GPT Image Budget",
    description: "Allows charged Admin Image tests for GPT priced models when selected-organization credits also pass.",
    category: "admin_image",
    budgetScope: "admin_org_credit_account",
    operationIds: Object.freeze(["admin.image.test.charged"]),
    ownerDomain: "admin-ai-image",
    defaultAppEnabled: false,
    riskLevel: "high",
    requiresMasterFlag: true,
    recommendedOperatorNote: "Enable only for bounded charged Admin Image testing with selected organization context.",
    relatedRoutes: Object.freeze(["POST /api/admin/ai/test-image"]),
    liveCapStatus: "not_implemented",
    liveCapFuturePhase: "Phase 4.17",
  }),
  Object.freeze({
    switchKey: "ENABLE_ADMIN_AI_UNMETERED_IMAGE_TESTS",
    flagName: "ENABLE_ADMIN_AI_UNMETERED_IMAGE_TESTS",
    label: "Admin Unmetered Image Tests",
    description: "Allows the explicit-unmetered FLUX.2 Dev Admin Image exception.",
    category: "admin_image",
    budgetScope: "explicit_unmetered_admin",
    operationIds: Object.freeze(["admin.image.test.unmetered"]),
    ownerDomain: "admin-ai-image",
    defaultAppEnabled: false,
    riskLevel: "high",
    requiresMasterFlag: true,
    recommendedOperatorNote: "Keep disabled unless the explicit-unmetered exception is accepted for a bounded test.",
    relatedRoutes: Object.freeze(["POST /api/admin/ai/test-image"]),
    liveCapStatus: "not_implemented",
    liveCapFuturePhase: "Phase 4.17 explicit-unmetered cap decision",
  }),
  Object.freeze({
    switchKey: "ENABLE_ADMIN_AI_VIDEO_JOB_BUDGET",
    flagName: "ENABLE_ADMIN_AI_VIDEO_JOB_BUDGET",
    label: "Admin Video Jobs Budget",
    description: "Allows budget-classified async Admin Video job creation and queueing.",
    category: "admin_video",
    budgetScope: "platform_admin_lab_budget",
    operationIds: Object.freeze(["admin.video.job.create"]),
    ownerDomain: "admin-video-jobs",
    defaultAppEnabled: false,
    riskLevel: "high",
    requiresMasterFlag: true,
    recommendedOperatorNote: "Enable only when async video job queue and budget metadata evidence are verified.",
    relatedRoutes: Object.freeze(["POST /api/admin/ai/video-jobs"]),
    liveCapStatus: "not_implemented",
    liveCapFuturePhase: "Phase 4.17",
  }),
  Object.freeze({
    switchKey: "ENABLE_NEWS_PULSE_VISUAL_BUDGET",
    flagName: "ENABLE_NEWS_PULSE_VISUAL_BUDGET",
    label: "News Pulse Visual Budget",
    description: "Allows OpenClaw / News Pulse provider-generated visual backfill; public reads remain unaffected.",
    category: "platform_background",
    budgetScope: "openclaw_news_pulse_budget",
    operationIds: Object.freeze(["platform.news_pulse.visual.ingest", "platform.news_pulse.visual.scheduled"]),
    ownerDomain: "news-pulse-visuals",
    defaultAppEnabled: false,
    riskLevel: "high",
    requiresMasterFlag: true,
    recommendedOperatorNote: "Enable only for bounded visual backfill windows; existing ready visuals are not controlled here.",
    relatedRoutes: Object.freeze(["POST /api/openclaw/news-pulse/ingest", "scheduled News Pulse visual backfill"]),
    liveCapStatus: "not_implemented",
    liveCapFuturePhase: "Phase 4.18",
  }),
  Object.freeze({
    switchKey: "ENABLE_ADMIN_AI_TEXT_BUDGET",
    flagName: "ENABLE_ADMIN_AI_TEXT_BUDGET",
    label: "Admin Text Budget",
    description: "Allows Admin Text test provider calls with budget metadata and durable metadata-only attempts.",
    category: "admin_lab",
    budgetScope: "platform_admin_lab_budget",
    operationIds: Object.freeze(["admin.text.test"]),
    ownerDomain: "admin-ai",
    defaultAppEnabled: false,
    riskLevel: "medium",
    requiresMasterFlag: true,
    recommendedOperatorNote: "Enable only for bounded Admin AI Lab text testing.",
    relatedRoutes: Object.freeze(["POST /api/admin/ai/test-text"]),
    liveCapStatus: "not_implemented",
    liveCapFuturePhase: "Phase 4.17",
  }),
  Object.freeze({
    switchKey: "ENABLE_ADMIN_AI_EMBEDDINGS_BUDGET",
    flagName: "ENABLE_ADMIN_AI_EMBEDDINGS_BUDGET",
    label: "Admin Embeddings Budget",
    description: "Allows Admin Embeddings test provider calls with budget metadata and durable metadata-only attempts.",
    category: "admin_lab",
    budgetScope: "platform_admin_lab_budget",
    operationIds: Object.freeze(["admin.embeddings.test"]),
    ownerDomain: "admin-ai",
    defaultAppEnabled: false,
    riskLevel: "medium",
    requiresMasterFlag: true,
    recommendedOperatorNote: "Enable only for bounded Admin AI Lab embeddings testing.",
    relatedRoutes: Object.freeze(["POST /api/admin/ai/test-embeddings"]),
    liveCapStatus: "not_implemented",
    liveCapFuturePhase: "Phase 4.17",
  }),
  Object.freeze({
    switchKey: "ENABLE_ADMIN_AI_MUSIC_BUDGET",
    flagName: "ENABLE_ADMIN_AI_MUSIC_BUDGET",
    label: "Admin Music Budget",
    description: "Allows Admin Music test provider calls with budget metadata and durable metadata-only attempts.",
    category: "admin_lab",
    budgetScope: "platform_admin_lab_budget",
    operationIds: Object.freeze(["admin.music.test"]),
    ownerDomain: "admin-ai",
    defaultAppEnabled: false,
    riskLevel: "high",
    requiresMasterFlag: true,
    recommendedOperatorNote: "Enable only for bounded Admin Music tests; no public/member music behavior changes.",
    relatedRoutes: Object.freeze(["POST /api/admin/ai/test-music"]),
    liveCapStatus: "not_implemented",
    liveCapFuturePhase: "Phase 4.17",
  }),
  Object.freeze({
    switchKey: "ENABLE_ADMIN_AI_COMPARE_BUDGET",
    flagName: "ENABLE_ADMIN_AI_COMPARE_BUDGET",
    label: "Admin Compare Budget",
    description: "Allows Admin Compare multi-model provider fanout with budget metadata and durable metadata-only attempts.",
    category: "admin_lab",
    budgetScope: "platform_admin_lab_budget",
    operationIds: Object.freeze(["admin.compare"]),
    ownerDomain: "admin-ai",
    defaultAppEnabled: false,
    riskLevel: "high",
    requiresMasterFlag: true,
    recommendedOperatorNote: "Enable only for bounded Admin Compare tests; compare can fan out to multiple provider calls.",
    relatedRoutes: Object.freeze(["POST /api/admin/ai/compare"]),
    liveCapStatus: "not_implemented",
    liveCapFuturePhase: "Phase 4.17",
  }),
  Object.freeze({
    switchKey: "ENABLE_ADMIN_AI_LIVE_AGENT_BUDGET",
    flagName: "ENABLE_ADMIN_AI_LIVE_AGENT_BUDGET",
    label: "Admin Live-Agent Budget",
    description: "Allows Admin Live-Agent streaming provider calls with durable metadata-only stream attempts.",
    category: "admin_lab",
    budgetScope: "platform_admin_lab_budget",
    operationIds: Object.freeze(["admin.live_agent"]),
    ownerDomain: "admin-ai",
    defaultAppEnabled: false,
    riskLevel: "high",
    requiresMasterFlag: true,
    recommendedOperatorNote: "Enable only for bounded Admin Live-Agent testing; live platform caps are not enforced yet.",
    relatedRoutes: Object.freeze(["POST /api/admin/ai/live-agent"]),
    liveCapStatus: "not_implemented",
    liveCapFuturePhase: "Phase 4.17",
  }),
]);

const SWITCH_DEFINITION_BY_KEY = new Map(
  ADMIN_PLATFORM_BUDGET_SWITCH_DEFINITIONS.map((definition) => [definition.switchKey, definition])
);

export class AdminPlatformBudgetSwitchError extends Error {
  constructor(message, { status = 503, fields = {} } = {}) {
    super(message);
    this.name = "AdminPlatformBudgetSwitchError";
    this.code = "admin_ai_budget_disabled";
    this.status = status;
    this.fields = Object.freeze({ ...fields });
  }
}

export class AdminRuntimeBudgetSwitchError extends Error {
  constructor(message, { status = 400, code = "admin_ai_budget_switch_error", fields = {} } = {}) {
    super(message);
    this.name = "AdminRuntimeBudgetSwitchError";
    this.code = code;
    this.status = status;
    this.fields = Object.freeze({ ...fields });
  }
}

function safeString(value, maxLength = 160) {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  if (!text || !SAFE_ID_PATTERN.test(text)) return null;
  return text.slice(0, maxLength);
}

function safeSwitchKey(value) {
  const text = String(value || "").trim();
  return SAFE_SWITCH_KEY_PATTERN.test(text) ? text : null;
}

function sanitizeReason(value) {
  if (value == null) return "";
  return String(value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_REASON_LENGTH);
}

function sanitizeMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  for (const [key, raw] of Object.entries(value).slice(0, 12)) {
    const safeKey = safeString(key, 60);
    if (!safeKey) continue;
    if (UNSAFE_METADATA_KEY_PATTERN.test(safeKey)) continue;
    if (raw == null || typeof raw === "boolean" || typeof raw === "number") {
      out[safeKey] = raw;
      continue;
    }
    if (typeof raw === "string") {
      out[safeKey] = raw.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 160);
    }
  }
  return out;
}

function safeFlagName(value) {
  const text = String(value || "").trim();
  return SAFE_FLAG_NAME_PATTERN.test(text) ? text : null;
}

export function normalizeBudgetSwitchValue(value) {
  if (value === true) return true;
  if (value === false || value == null) return false;
  if (typeof value === "number") return value === 1;
  const normalized = String(value).trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return false;
}

export function isBudgetSwitchEnabled(env, flagName) {
  const safeFlag = safeFlagName(flagName);
  if (!safeFlag) return false;
  return normalizeBudgetSwitchValue(env?.[safeFlag]);
}

export function getBudgetSwitchState(env, flagName) {
  const safeFlag = safeFlagName(flagName);
  const configured = Boolean(
    safeFlag &&
    env &&
    Object.prototype.hasOwnProperty.call(env, safeFlag) &&
    String(env[safeFlag] ?? "").trim() !== ""
  );
  return Object.freeze({
    flagName: safeFlag,
    configured,
    enabled: safeFlag ? isBudgetSwitchEnabled(env, safeFlag) : false,
    status: !safeFlag ? "unknown" : isBudgetSwitchEnabled(env, safeFlag) ? "enabled" : (configured ? "disabled" : "missing"),
  });
}

export function listAdminPlatformBudgetSwitchDefinitions() {
  return ADMIN_PLATFORM_BUDGET_SWITCH_DEFINITIONS.map((definition) => Object.freeze({
    switchKey: definition.switchKey,
    flagName: definition.flagName,
    label: definition.label,
    description: definition.description,
    category: definition.category,
    budgetScope: definition.budgetScope,
    operationIds: [...definition.operationIds],
    ownerDomain: definition.ownerDomain,
    defaultAppEnabled: definition.defaultAppEnabled,
    riskLevel: definition.riskLevel,
    requiresMasterFlag: definition.requiresMasterFlag,
    recommendedOperatorNote: definition.recommendedOperatorNote,
    relatedRoutes: [...definition.relatedRoutes],
    liveCapStatus: definition.liveCapStatus,
    liveCapFuturePhase: definition.liveCapFuturePhase,
  }));
}

export function getAdminPlatformBudgetSwitchDefinition(switchKey) {
  const safeKey = safeSwitchKey(switchKey);
  return safeKey ? SWITCH_DEFINITION_BY_KEY.get(safeKey) || null : null;
}

function extractSwitchFields(planOrConfig = {}, options = {}) {
  const plan = planOrConfig || {};
  const killSwitch = plan.killSwitchPolicy || plan.killSwitch || {};
  const auditFields = plan.auditFields || plan.audit_fields || {};
  const summary = plan.summary || {};
  const flagName = safeFlagName(
    options.flagName ||
    plan.flagName ||
    plan.budget_switch_flag ||
    killSwitch.flagName ||
    plan.kill_switch_flag_name ||
    summary.kill_switch_flag_name ||
    auditFields.kill_switch_flag_name
  );
  return Object.freeze({
    flagName,
    operationId: safeString(
      options.operationId || plan.operationId || summary.operation_id || plan.operation_id || auditFields.operation_id,
      120
    ),
    budgetScope: safeString(
      options.budgetScope || plan.budgetScope || summary.budget_scope || plan.budget_scope || auditFields.budget_scope,
      120
    ),
    ownerDomain: safeString(
      options.ownerDomain || plan.ownerDomain || summary.owner_domain || plan.owner_domain || auditFields.owner_domain,
      120
    ),
    providerFamily: safeString(
      options.providerFamily || plan.providerFamily || summary.provider_family || plan.provider_family || auditFields.provider_family,
      80
    ),
    disabledBehavior: safeString(
      options.disabledBehavior || killSwitch.disabledBehavior || summary.kill_switch_disabled_behavior || "fail_closed",
      80
    ),
  });
}

function statusForDisabledBehavior(disabledBehavior) {
  if (disabledBehavior === "return_403") return 403;
  return 503;
}

export function budgetSwitchLogFields(planOrConfig = {}, options = {}) {
  const fields = extractSwitchFields(planOrConfig, options);
  return Object.freeze({
    budget_switch_flag: fields.flagName,
    operation_id: fields.operationId,
    budget_scope: fields.budgetScope,
    owner_domain: fields.ownerDomain,
    provider_family: fields.providerFamily,
    disabled_behavior: fields.disabledBehavior,
  });
}

export function assertBudgetSwitchEnabled(env, planOrConfig = {}, options = {}) {
  const fields = extractSwitchFields(planOrConfig, options);
  if (!fields.flagName || !isBudgetSwitchEnabled(env, fields.flagName)) {
    throw new AdminPlatformBudgetSwitchError(
      options.message || "Admin AI budget path is disabled.",
      {
        status: options.status || statusForDisabledBehavior(fields.disabledBehavior),
        fields,
      }
    );
  }
  return Object.freeze({
    ok: true,
    enabled: true,
    ...fields,
  });
}

function unavailableSwitchState(definition, masterState, code = "admin_runtime_budget_switches_unavailable") {
  return Object.freeze({
    ...serializeDefinition(definition),
    masterFlagStatus: masterState.status,
    masterConfigured: masterState.configured,
    masterEnabled: masterState.enabled === true,
    appSwitchStatus: "unavailable",
    appSwitchEnabled: false,
    appSwitchAvailable: false,
    effectiveEnabled: false,
    disabledReason: code,
    updatedAt: null,
    updatedBy: null,
    reason: null,
    metadata: {},
  });
}

function serializeDefinition(definition) {
  return {
    switchKey: definition.switchKey,
    flagName: definition.flagName,
    label: definition.label,
    description: definition.description,
    category: definition.category,
    budgetScope: definition.budgetScope,
    operationIds: [...definition.operationIds],
    ownerDomain: definition.ownerDomain,
    defaultAppEnabled: definition.defaultAppEnabled,
    riskLevel: definition.riskLevel,
    requiresMasterFlag: definition.requiresMasterFlag,
    recommendedOperatorNote: definition.recommendedOperatorNote,
    relatedRoutes: [...definition.relatedRoutes],
    liveCapStatus: definition.liveCapStatus,
    liveCapFuturePhase: definition.liveCapFuturePhase,
  };
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

function serializeSwitchState(definition, masterState, row = null) {
  const appEnabled = row ? Number(row.enabled) === 1 : false;
  const appSwitchStatus = !row ? "missing" : (appEnabled ? "enabled" : "disabled");
  const masterEnabled = masterState.enabled === true;
  const effectiveEnabled = masterEnabled && appEnabled;
  const disabledReason = effectiveEnabled
    ? null
    : (!masterEnabled ? "cloudflare_master_disabled" : (row ? "admin_switch_disabled" : "admin_switch_missing"));
  const updatedByUserId = row?.updated_by_user_id || null;
  const updatedByEmail = row?.updated_by_email || null;
  return Object.freeze({
    ...serializeDefinition(definition),
    masterFlagStatus: masterState.status,
    masterConfigured: masterState.configured,
    masterEnabled,
    appSwitchStatus,
    appSwitchEnabled: appEnabled,
    appSwitchAvailable: true,
    effectiveEnabled,
    disabledReason,
    updatedAt: row?.updated_at || null,
    updatedBy: updatedByUserId || updatedByEmail ? {
      userId: updatedByUserId,
      email: updatedByEmail,
    } : null,
    reason: row?.reason || null,
    metadata: parseJsonObject(row?.metadata_json),
  });
}

async function readSwitchRow(env, switchKey) {
  if (!env?.DB?.prepare) {
    throw new AdminRuntimeBudgetSwitchError("Admin AI budget switch store is unavailable.", {
      status: 503,
      code: "admin_ai_budget_switch_store_unavailable",
      fields: { switchKey },
    });
  }
  return env.DB.prepare(
    `SELECT switch_key, enabled, reason, metadata_json, created_at, updated_at, updated_by_user_id, updated_by_email
       FROM ${ADMIN_RUNTIME_BUDGET_SWITCH_TABLE}
      WHERE switch_key = ?
      LIMIT 1`
  ).bind(switchKey).first();
}

async function readSwitchEvent(env, switchKey, idempotencyKey) {
  return env.DB.prepare(
    `SELECT id, switch_key, old_enabled, new_enabled, reason, changed_by_user_id, changed_by_email, idempotency_key, request_hash, created_at
       FROM ${ADMIN_RUNTIME_BUDGET_SWITCH_EVENTS_TABLE}
      WHERE switch_key = ? AND idempotency_key = ?
      LIMIT 1`
  ).bind(switchKey, idempotencyKey).first();
}

export async function getAdminRuntimeBudgetSwitchState(env, switchKey, { tolerateUnavailable = false } = {}) {
  const definition = getAdminPlatformBudgetSwitchDefinition(switchKey);
  if (!definition) {
    throw new AdminRuntimeBudgetSwitchError("Unknown Admin AI budget switch.", {
      status: 404,
      code: "admin_ai_budget_switch_not_found",
      fields: { switchKey: safeSwitchKey(switchKey) },
    });
  }
  const masterState = getBudgetSwitchState(env, definition.flagName);
  try {
    const row = await readSwitchRow(env, definition.switchKey);
    return serializeSwitchState(definition, masterState, row);
  } catch (error) {
    if (!tolerateUnavailable) {
      if (error instanceof AdminRuntimeBudgetSwitchError) throw error;
      throw new AdminRuntimeBudgetSwitchError("Admin AI budget switch store is unavailable.", {
        status: 503,
        code: "admin_ai_budget_switch_store_unavailable",
        fields: { switchKey: definition.switchKey },
      });
    }
    return unavailableSwitchState(definition, masterState);
  }
}

export async function listAdminRuntimeBudgetSwitchStates(env, { tolerateUnavailable = false } = {}) {
  const rowsByKey = new Map();
  let storeAvailable = true;
  let unavailableCode = null;
  try {
    if (!env?.DB?.prepare) {
      throw new Error("missing DB binding");
    }
    const result = await env.DB.prepare(
      `SELECT switch_key, enabled, reason, metadata_json, created_at, updated_at, updated_by_user_id, updated_by_email
         FROM ${ADMIN_RUNTIME_BUDGET_SWITCH_TABLE}`
    ).all();
    for (const row of result?.results || []) {
      rowsByKey.set(row.switch_key, row);
    }
  } catch (error) {
    storeAvailable = false;
    unavailableCode = "admin_ai_budget_switch_store_unavailable";
    if (!tolerateUnavailable) {
      throw new AdminRuntimeBudgetSwitchError("Admin AI budget switch store is unavailable.", {
        status: 503,
        code: unavailableCode,
        fields: {},
      });
    }
  }

  const switches = ADMIN_PLATFORM_BUDGET_SWITCH_DEFINITIONS.map((definition) => {
    const masterState = getBudgetSwitchState(env, definition.flagName);
    return storeAvailable
      ? serializeSwitchState(definition, masterState, rowsByKey.get(definition.switchKey) || null)
      : unavailableSwitchState(definition, masterState, unavailableCode);
  });
  const summary = Object.freeze({
    totalSwitches: switches.length,
    masterEnabledCount: switches.filter((entry) => entry.masterEnabled === true).length,
    appEnabledCount: switches.filter((entry) => entry.appSwitchEnabled === true).length,
    effectiveEnabledCount: switches.filter((entry) => entry.effectiveEnabled === true).length,
    disabledByMasterCount: switches.filter((entry) => entry.masterEnabled !== true).length,
    disabledByAppCount: switches.filter((entry) => entry.masterEnabled === true && entry.appSwitchEnabled !== true).length,
    unknownOrUnavailableCount: switches.filter((entry) => entry.appSwitchAvailable !== true || entry.masterFlagStatus === "unknown").length,
    d1SwitchStoreAvailable: storeAvailable,
    liveBudgetCapsStatus: "not_implemented",
  });
  return Object.freeze({ switches, summary });
}

export async function assertBudgetSwitchEffectiveEnabled(env, planOrConfig = {}, options = {}) {
  const fields = extractSwitchFields(planOrConfig, options);
  const definition = getAdminPlatformBudgetSwitchDefinition(fields.flagName);
  const flagName = definition?.flagName || fields.flagName;
  const masterState = getBudgetSwitchState(env, flagName);
  if (!definition || !flagName || masterState.enabled !== true) {
    throw new AdminPlatformBudgetSwitchError(
      options.message || "Admin AI budget path is disabled.",
      {
        status: options.status || statusForDisabledBehavior(fields.disabledBehavior),
        fields: {
          ...fields,
          flagName,
          masterFlagStatus: masterState.status,
          masterConfigured: masterState.configured,
          masterEnabled: masterState.enabled === true,
          appSwitchEnabled: false,
          appSwitchAvailable: null,
          effectiveEnabled: false,
          disabledReason: definition ? "cloudflare_master_disabled" : "unknown_budget_switch",
        },
      }
    );
  }

  let state;
  try {
    state = await getAdminRuntimeBudgetSwitchState(env, definition.switchKey);
  } catch (error) {
    throw new AdminPlatformBudgetSwitchError(
      options.message || "Admin AI budget path is disabled.",
      {
        status: options.status || 503,
        fields: {
          ...fields,
          flagName,
          masterFlagStatus: masterState.status,
          masterConfigured: masterState.configured,
          masterEnabled: true,
          appSwitchEnabled: false,
          appSwitchAvailable: false,
          effectiveEnabled: false,
          disabledReason: error?.code || "admin_ai_budget_switch_store_unavailable",
        },
      }
    );
  }

  if (state.effectiveEnabled !== true) {
    throw new AdminPlatformBudgetSwitchError(
      options.message || "Admin AI budget path is disabled.",
      {
        status: options.status || statusForDisabledBehavior(fields.disabledBehavior),
        fields: {
          ...fields,
          flagName,
          masterFlagStatus: state.masterFlagStatus,
          masterConfigured: state.masterConfigured,
          masterEnabled: state.masterEnabled,
          appSwitchEnabled: state.appSwitchEnabled,
          appSwitchAvailable: state.appSwitchAvailable,
          effectiveEnabled: false,
          disabledReason: state.disabledReason,
        },
      }
    );
  }

  return Object.freeze({
    ok: true,
    enabled: true,
    effectiveEnabled: true,
    ...fields,
    flagName,
    switchKey: definition.switchKey,
    masterFlagStatus: state.masterFlagStatus,
    appSwitchEnabled: true,
  });
}

export async function updateAdminRuntimeBudgetSwitch(env, {
  switchKey,
  enabled,
  reason,
  metadata = null,
  adminUser = null,
  idempotencyKey,
  now = nowIso(),
} = {}) {
  const definition = getAdminPlatformBudgetSwitchDefinition(switchKey);
  if (!definition) {
    throw new AdminRuntimeBudgetSwitchError("Unknown Admin AI budget switch.", {
      status: 404,
      code: "admin_ai_budget_switch_not_found",
      fields: { switchKey: safeSwitchKey(switchKey) },
    });
  }
  if (!env?.DB?.prepare) {
    throw new AdminRuntimeBudgetSwitchError("Admin AI budget switch store is unavailable.", {
      status: 503,
      code: "admin_ai_budget_switch_store_unavailable",
      fields: { switchKey: definition.switchKey },
    });
  }
  const normalizedEnabled = enabled === true;
  const normalizedReason = sanitizeReason(reason);
  if (!normalizedReason || normalizedReason.length < 6) {
    throw new AdminRuntimeBudgetSwitchError("A bounded reason is required.", {
      status: 400,
      code: "admin_ai_budget_switch_reason_required",
      fields: { switchKey: definition.switchKey },
    });
  }
  const safeIdempotencyKey = safeString(idempotencyKey, 160);
  if (!safeIdempotencyKey) {
    throw new AdminRuntimeBudgetSwitchError("Idempotency-Key header is required.", {
      status: 428,
      code: "idempotency_key_required",
      fields: { switchKey: definition.switchKey },
    });
  }
  const metadataJson = JSON.stringify({
    phase: "4.15.1",
    source: "admin_control_plane",
    live_budget_caps_status: "not_implemented",
    ...sanitizeMetadata(metadata),
  });
  const requestHash = await sha256Hex(JSON.stringify({
    switchKey: definition.switchKey,
    enabled: normalizedEnabled,
    reason: normalizedReason,
    metadata: metadataJson,
  }));
  const existingEvent = await readSwitchEvent(env, definition.switchKey, safeIdempotencyKey);
  if (existingEvent) {
    if (existingEvent.request_hash !== requestHash) {
      throw new AdminRuntimeBudgetSwitchError("Idempotency-Key was already used for a different switch update.", {
        status: 409,
        code: "idempotency_conflict",
        fields: { switchKey: definition.switchKey },
      });
    }
    return {
      state: await getAdminRuntimeBudgetSwitchState(env, definition.switchKey),
      event: {
        id: existingEvent.id,
        replayed: true,
        createdAt: existingEvent.created_at,
      },
    };
  }

  const existingRow = await readSwitchRow(env, definition.switchKey);
  const oldEnabled = existingRow ? (Number(existingRow.enabled) === 1 ? 1 : 0) : null;
  const adminUserId = safeString(adminUser?.id, 160);
  const adminEmail = String(adminUser?.email || "").trim().slice(0, 254) || null;
  await env.DB.prepare(
    `INSERT INTO ${ADMIN_RUNTIME_BUDGET_SWITCH_TABLE} (
       switch_key, enabled, reason, metadata_json, created_at, updated_at, updated_by_user_id, updated_by_email
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(switch_key) DO UPDATE SET
       enabled = excluded.enabled,
       reason = excluded.reason,
       metadata_json = excluded.metadata_json,
       updated_at = excluded.updated_at,
       updated_by_user_id = excluded.updated_by_user_id,
       updated_by_email = excluded.updated_by_email`
  ).bind(
    definition.switchKey,
    normalizedEnabled ? 1 : 0,
    normalizedReason,
    metadataJson,
    existingRow?.created_at || now,
    now,
    adminUserId,
    adminEmail
  ).run();
  const eventId = `budsw_${randomTokenHex(16)}`;
  await env.DB.prepare(
    `INSERT INTO ${ADMIN_RUNTIME_BUDGET_SWITCH_EVENTS_TABLE} (
       id, switch_key, old_enabled, new_enabled, reason, changed_by_user_id, changed_by_email,
       idempotency_key, request_hash, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    eventId,
    definition.switchKey,
    oldEnabled,
    normalizedEnabled ? 1 : 0,
    normalizedReason,
    adminUserId,
    adminEmail,
    safeIdempotencyKey,
    requestHash,
    now
  ).run();
  return {
    state: await getAdminRuntimeBudgetSwitchState(env, definition.switchKey),
    event: {
      id: eventId,
      replayed: false,
      createdAt: now,
    },
  };
}

export function budgetSwitchDisabledResponse(errorOrFields, options = {}) {
  const fields = errorOrFields instanceof AdminPlatformBudgetSwitchError
    ? errorOrFields.fields
    : extractSwitchFields(errorOrFields, options);
  const status = options.status || errorOrFields?.status || 503;
  return json({
    ok: false,
    error: options.message || "Admin AI budget path is disabled.",
    code: "admin_ai_budget_disabled",
    flag: fields.flagName || null,
    operation_id: fields.operationId || null,
    budget_scope: fields.budgetScope || null,
    owner_domain: fields.ownerDomain || null,
    master_flag_status: fields.masterFlagStatus || null,
    app_switch_enabled: fields.appSwitchEnabled ?? null,
    effective_enabled: fields.effectiveEnabled ?? false,
    disabled_reason: fields.disabledReason || null,
  }, { status });
}
