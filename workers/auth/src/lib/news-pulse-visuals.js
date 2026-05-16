import { logDiagnostic } from "../../../../js/shared/worker-observability.mjs";
import {
  ADMIN_PLATFORM_BUDGET_SCOPES,
  buildAdminPlatformBudgetFingerprint,
  classifyAdminPlatformBudgetPlan,
} from "./admin-platform-budget-policy.js";
import {
  AdminPlatformBudgetSwitchError,
  assertBudgetSwitchEnabled,
  budgetSwitchLogFields,
} from "./admin-platform-budget-switches.js";
import { getAiCostOperationRegistryEntry } from "./ai-cost-operations.js";

export const NEWS_PULSE_VISUAL_MODEL_ID = "@cf/black-forest-labs/flux-1-schnell";
export const NEWS_PULSE_VISUAL_INGEST_OPERATION_ID = "platform.news_pulse.visual.ingest";
export const NEWS_PULSE_VISUAL_SCHEDULED_OPERATION_ID = "platform.news_pulse.visual.scheduled";
export const NEWS_PULSE_VISUAL_BUDGET_KILL_SWITCH = "ENABLE_NEWS_PULSE_VISUAL_BUDGET";
export const NEWS_PULSE_VISUAL_OBJECT_PREFIX = "news-pulse/thumbs/";
export const NEWS_PULSE_VISUAL_ROUTE_PREFIX = "/api/public/news-pulse/thumbs/";
export const NEWS_PULSE_VISUAL_MAX_ATTEMPTS = 3;
export const NEWS_PULSE_VISUAL_BATCH_LIMIT = 2;
export const NEWS_PULSE_VISUAL_INGEST_BATCH_LIMIT = 4;
export const NEWS_PULSE_VISUAL_THUMB_SIZE = 256;
export const NEWS_PULSE_VISUAL_CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=604800";

const COMPONENT = "news-pulse-visuals";
const DEFAULT_GENERATED_IMAGE_MIME_TYPE = "image/png";
const THUMB_MIME_TYPE = "image/webp";
const MAX_ERROR_LENGTH = 240;
const MAX_PROMPT_LENGTH = 420;
const MAX_BUDGET_POLICY_JSON_BYTES = 8 * 1024;

const DISALLOWED_PROMPT_PATTERN = /\b(logo|logos|trademark|brand mark|wordmark|watermark|readable text|letters?|words?|typography|headline|caption|copyrighted|copyright|character|celebrity|portrait|likeness|face|person|people|human|politician|candidate|campaign|election|vote|propaganda|persuasion|sexual|explicit|nude|nudity|porn|gore|disney|marvel|pokemon|nintendo|star wars|mickey|batman|superman)\b/i;

const STRIPPED_BRAND_TERMS = [
  "adobe",
  "amazon",
  "anthropic",
  "apple",
  "deepmind",
  "facebook",
  "gemini",
  "google",
  "meta",
  "microsoft",
  "nvidia",
  "openai",
  "runway",
  "stability",
  "xai",
];

function cleanText(value, maxLength = 240) {
  return String(value ?? "")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/[<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function safeIdentifier(value, maxLength = 160) {
  const text = cleanText(value, maxLength);
  if (!text || /\b(secret|token|cookie|authorization|bearer|private key|stripe|r2 key)\b/i.test(text)) return null;
  return text;
}

function stripBrandTerms(value, source = "") {
  let text = cleanText(value, 320);
  const sourceTerms = cleanText(source, 120)
    .split(/[^a-z0-9]+/i)
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length >= 3);
  for (const term of new Set([...STRIPPED_BRAND_TERMS, ...sourceTerms])) {
    text = text.replace(new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), " ");
  }
  return text.replace(/\s+/g, " ").trim();
}

function isValidSourceUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function classifyVisualTheme(item = {}) {
  const text = `${item.category || ""} ${item.title || ""} ${item.summary || ""}`.toLowerCase();
  if (/\b(video|film|motion|animation|bewegtbild|kamera|clip)\b/.test(text)) return "AI video creation signal";
  if (/\b(audio|music|sound|song|voice|musik|stimme|klang)\b/.test(text)) return "AI sound design signal";
  if (/\b(image|photo|visual|art|design|bild|foto|kunst|firefly)\b/.test(text)) return "AI visual creation signal";
  if (/\b(agent|workflow|automation|tool|workspace|creator|kreativ|arbeitsablauf)\b/.test(text)) return "creative AI workflow signal";
  if (/\b(model|multimodal|llm|language|reasoning|frontier|modell|sprachmodell)\b/.test(text)) return "AI model update signal";
  if (/\b(policy|safety|regulation|gesetz|sicherheit|governance)\b/.test(text)) return "AI governance signal";
  return "AI and creative technology signal";
}

export function sanitizeNewsPulseVisualPromptHint(value, item = {}) {
  const cleaned = stripBrandTerms(value, item.source);
  if (!cleaned || DISALLOWED_PROMPT_PATTERN.test(cleaned)) return "";
  return cleaned.slice(0, 180);
}

export function buildSafeNewsPulseVisualPrompt(item = {}) {
  const hint = sanitizeNewsPulseVisualPromptHint(item.visual_prompt, item);
  const theme = hint || classifyVisualTheme(item);
  const prompt = [
    "abstract futuristic AI editorial thumbnail",
    theme,
    "dark neon cyber aesthetic",
    "no logos",
    "no readable text",
    "no brand trademarks",
    "no people",
    "no political campaign imagery",
    "clean square composition",
    "high contrast",
    "suitable as a small news thumbnail",
  ].join(", ");
  return cleanText(prompt, MAX_PROMPT_LENGTH);
}

export function buildNewsPulseVisualObjectKey(itemId) {
  const safeId = String(itemId || "")
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .slice(0, 128);
  if (!safeId) return null;
  return `${NEWS_PULSE_VISUAL_OBJECT_PREFIX}${safeId}.webp`;
}

export function isNewsPulseVisualObjectKey(key) {
  const value = String(key || "");
  return value.startsWith(NEWS_PULSE_VISUAL_OBJECT_PREFIX) &&
    value.endsWith(".webp") &&
    !value.includes("..") &&
    !value.includes("\\") &&
    !value.slice(NEWS_PULSE_VISUAL_OBJECT_PREFIX.length).includes("/");
}

export function getNewsPulseVisualThumbUrl(itemId) {
  return `${NEWS_PULSE_VISUAL_ROUTE_PREFIX}${encodeURIComponent(String(itemId || ""))}`;
}

function sanitizeVisualError(error) {
  const raw = cleanText(error?.message || String(error || "News Pulse thumbnail generation failed."), MAX_ERROR_LENGTH);
  if (!raw || /\b(prompt|secret|token|credential|authorization|api key|bearer)\b/i.test(raw)) {
    return "News Pulse thumbnail generation failed.";
  }
  return raw;
}

function isMissingNewsPulseVisualSchema(error) {
  const message = String(error?.message || error);
  return message.includes("no such table") && message.includes("news_pulse_items") ||
    message.includes("no such column") && message.includes("visual_");
}

function parseBase64Image(value) {
  if (typeof value !== "string" || !value) return null;
  const dataUriMatch = value.match(/^data:(image\/[a-z+.-]+);base64,(.+)$/i);
  if (dataUriMatch) {
    return {
      bytes: Uint8Array.from(atob(dataUriMatch[2]), (ch) => ch.charCodeAt(0)),
      mimeType: dataUriMatch[1],
    };
  }
  if (value.length > 100 && /^[A-Za-z0-9+/\n\r]+=*$/.test(value.slice(0, 200))) {
    return {
      bytes: Uint8Array.from(atob(value), (ch) => ch.charCodeAt(0)),
      mimeType: DEFAULT_GENERATED_IMAGE_MIME_TYPE,
    };
  }
  return null;
}

async function toArrayBuffer(value) {
  if (value == null) return null;
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return value.buffer.byteLength === value.byteLength
      ? value.buffer
      : value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  if (typeof value.arrayBuffer === "function") {
    try {
      return await value.arrayBuffer();
    } catch {
      return null;
    }
  }
  if (typeof value.getReader === "function") {
    try {
      return await new Response(value).arrayBuffer();
    } catch {
      return null;
    }
  }
  return null;
}

async function extractGeneratedImageBytes(result) {
  const candidates = [];
  if (result && typeof result === "object" && !ArrayBuffer.isView(result) && !(result instanceof ArrayBuffer)) {
    if (result.image != null) candidates.push(result.image);
    if (Array.isArray(result.images) && result.images.length > 0) candidates.push(result.images[0]);
    if (result.data != null) candidates.push(result.data);
    if (result.output != null) candidates.push(result.output);
  }
  candidates.push(result);

  for (const candidate of candidates) {
    const parsed = parseBase64Image(candidate);
    if (parsed?.bytes?.byteLength) return parsed;

    const buffer = await toArrayBuffer(candidate);
    if (buffer?.byteLength) {
      return {
        bytes: new Uint8Array(buffer),
        mimeType: DEFAULT_GENERATED_IMAGE_MIME_TYPE,
      };
    }
  }
  return null;
}

async function renderNewsPulseThumb(env, imageBytes) {
  if (!env?.IMAGES || typeof env.IMAGES.input !== "function") {
    throw new Error("Images binding is unavailable.");
  }
  const transformResult = await env.IMAGES.input(imageBytes)
    .transform({
      width: NEWS_PULSE_VISUAL_THUMB_SIZE,
      height: NEWS_PULSE_VISUAL_THUMB_SIZE,
      fit: "scale-down",
    })
    .output({
      format: THUMB_MIME_TYPE,
      quality: 82,
    });

  let response;
  if (typeof transformResult.response === "function") {
    response = transformResult.response();
  } else if (typeof transformResult.arrayBuffer === "function") {
    response = transformResult;
  } else if (typeof transformResult.image === "function") {
    response = new Response(transformResult.image(), {
      headers: {
        "content-type": typeof transformResult.contentType === "function"
          ? transformResult.contentType()
          : THUMB_MIME_TYPE,
      },
    });
  } else {
    throw new Error("Images transform returned an invalid thumbnail result.");
  }

  const buffer = await toArrayBuffer(response);
  if (!buffer?.byteLength) throw new Error("Images transform returned an empty thumbnail.");
  return {
    bytes: new Uint8Array(buffer),
    mimeType: response.headers?.get("content-type") || THUMB_MIME_TYPE,
  };
}

function safeBatchLimit(limit) {
  return Math.min(Math.max(Number(limit) || NEWS_PULSE_VISUAL_BATCH_LIMIT, 1), 4);
}

function normalizeItemIds(itemIds) {
  const ids = [];
  const seen = new Set();
  for (const raw of Array.isArray(itemIds) ? itemIds : []) {
    const id = String(raw || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function hasNewsPulseVisualBindings(env) {
  return Boolean(
    env?.DB &&
    env?.AI &&
    typeof env.AI.run === "function" &&
    env?.USER_IMAGES &&
    env?.IMAGES
  );
}

function newsPulseBudgetOperation({
  operationId = NEWS_PULSE_VISUAL_SCHEDULED_OPERATION_ID,
  trigger = "scheduled",
  actorType = trigger === "openclaw_ingest" ? "platform" : "background",
  actorRole = trigger === "openclaw_ingest" ? "openclaw-agent" : "scheduled-job",
  operationOverride = null,
} = {}) {
  const registryEntry = getAiCostOperationRegistryEntry(operationId);
  const registryConfig = registryEntry?.operationConfig || {};
  const budgetScope = registryEntry?.budgetPolicy?.targetBudgetScope
    || ADMIN_PLATFORM_BUDGET_SCOPES.OPENCLAW_NEWS_PULSE_BUDGET;
  return {
    operationId,
    featureKey: registryConfig.featureKey || "platform.news_pulse.visual",
    actorType,
    actorRole,
    budgetScope,
    ownerDomain: "openclaw-news-pulse",
    providerFamily: registryConfig.providerFamily || "workers_ai",
    modelId: NEWS_PULSE_VISUAL_MODEL_ID,
    modelResolverKey: registryConfig.modelResolverKey || "platform.news_pulse.visual_model",
    providerCost: true,
    estimatedCostUnits: 1,
    estimatedCredits: 0,
    idempotencyPolicy: registryConfig.idempotencyPolicy || "inherited",
    killSwitchPolicy: {
      flagName: NEWS_PULSE_VISUAL_BUDGET_KILL_SWITCH,
      defaultState: "disabled",
      requiredForProviderCall: true,
      disabledBehavior: "skip_provider_call",
      operatorCanOverride: false,
      scope: ADMIN_PLATFORM_BUDGET_SCOPES.OPENCLAW_NEWS_PULSE_BUDGET,
      notes: "Phase 4.15 enforces this runtime budget switch before News Pulse visual provider generation.",
    },
    budgetLimitPolicy: {
      mode: "metadata_only",
      reservation: "news_pulse_visual_row",
      runtimeLimitEnforced: false,
    },
    routeId: registryConfig.routeId || (trigger === "openclaw_ingest"
      ? "openclaw.news_pulse.ingest"
      : "scheduled.news_pulse.visuals"),
    routePath: registryConfig.routePath || (trigger === "openclaw_ingest"
      ? "/api/openclaw/news-pulse/ingest"
      : "/scheduled/news-pulse-visuals"),
    auditEventPrefix: registryConfig.observabilityEventPrefix || operationId,
    notes: "Phase 4.6 records openclaw_news_pulse_budget metadata before News Pulse visual provider calls; no credits are debited.",
    ...(operationOverride || {}),
  };
}

function compactNewsPulseVisualBudgetPolicy(plan, fingerprint, {
  item,
  now,
  trigger,
  actorId = null,
  runtimeStatus = "metadata_recorded",
  reason = null,
} = {}) {
  return {
    budget_policy_version: plan.policyVersion,
    operation_id: plan.operationId || null,
    actor_class: plan.actorType || null,
    actor_id: safeIdentifier(actorId, 120),
    budget_scope: plan.budgetScope || null,
    owner_domain: plan.ownerDomain || "openclaw-news-pulse",
    provider_family: plan.providerFamily || "workers_ai",
    model_id: plan.auditFields?.model_id || NEWS_PULSE_VISUAL_MODEL_ID,
    model_resolver_key: plan.auditFields?.model_resolver_key || "platform.news_pulse.visual_model",
    estimated_cost_units: plan.estimatedCostUnits ?? 1,
    estimated_credits: plan.estimatedCredits ?? 0,
    idempotency_policy: plan.idempotencyPolicy || "inherited",
    plan_status: plan.status,
    required_next_action: plan.requiredNextAction || "block_provider_call",
    kill_switch_flag_name: plan.killSwitchPolicy?.flagName || NEWS_PULSE_VISUAL_BUDGET_KILL_SWITCH,
    kill_switch_default_state: plan.killSwitchPolicy?.defaultState || "disabled",
    kill_switch_required_for_provider_call: plan.killSwitchPolicy?.requiredForProviderCall ?? true,
    runtime_budget_limit_enforced: false,
    runtime_env_kill_switch_enforced: true,
    credit_debit: false,
    trigger,
    visual: {
      item_id: safeIdentifier(item?.id, 128),
      locale: safeIdentifier(item?.locale, 16),
      content_hash: safeIdentifier(item?.content_hash, 160),
      visual_attempts: Math.max(Number(item?.visual_attempts || 0), 0) + 1,
    },
    runtime: {
      status: runtimeStatus,
      reason: safeIdentifier(reason, 120),
      updated_at: now,
      duplicate_provider_suppression: "visual_status_and_attempt_guard",
    },
    fingerprint,
    audit_fields: plan.auditFields || null,
    limitations: [
      "Phase 4.6 records caller-side metadata and validates policy before provider calls.",
      "Phase 4.15 enforces the runtime env kill-switch before provider calls; live platform budget caps remain future work.",
    ],
  };
}

function withBudgetRuntimeStatus(policy, { status, reason = null, now } = {}) {
  if (!policy) return null;
  return {
    ...policy,
    runtime: {
      ...(policy.runtime || {}),
      status,
      reason: safeIdentifier(reason, 120),
      updated_at: now,
    },
  };
}

function serializeBudgetPolicy(policy) {
  const json = stableStringify(policy);
  if (new TextEncoder().encode(json).byteLength <= MAX_BUDGET_POLICY_JSON_BYTES) return json;
  const compact = {
    ...policy,
    audit_fields: null,
    limitations: ["Budget policy metadata was compacted to stay within the row metadata bound."],
  };
  const compactJson = stableStringify(compact);
  if (new TextEncoder().encode(compactJson).byteLength <= MAX_BUDGET_POLICY_JSON_BYTES) return compactJson;
  return stableStringify({
    budget_policy_version: policy?.budget_policy_version || null,
    operation_id: policy?.operation_id || null,
    budget_scope: policy?.budget_scope || null,
    plan_status: policy?.plan_status || null,
    kill_switch_flag_name: policy?.kill_switch_flag_name || null,
    runtime: policy?.runtime || null,
    fingerprint: policy?.fingerprint || null,
    compacted: true,
  });
}

async function buildNewsPulseVisualBudgetContext({
  item,
  now,
  correlationId = null,
  trigger = "scheduled",
  actorId = null,
  actorRole = null,
  operationId = trigger === "openclaw_ingest"
    ? NEWS_PULSE_VISUAL_INGEST_OPERATION_ID
    : NEWS_PULSE_VISUAL_SCHEDULED_OPERATION_ID,
  operationOverride = null,
} = {}) {
  const operation = newsPulseBudgetOperation({
    operationId,
    trigger,
    actorType: trigger === "openclaw_ingest" ? "platform" : "background",
    actorRole: actorRole || (trigger === "openclaw_ingest" ? "openclaw-agent" : "scheduled-job"),
    operationOverride,
  });
  const plan = classifyAdminPlatformBudgetPlan({
    operation,
    actorUserId: actorId || null,
    actorRole: actorRole || operation.actorRole,
    modelId: NEWS_PULSE_VISUAL_MODEL_ID,
    reason: `news_pulse_visual_${trigger}`,
    correlationId,
  });
  let fingerprint = null;
  if (plan.ok) {
    fingerprint = await buildAdminPlatformBudgetFingerprint({
      operation,
      actorId: actorId || null,
      modelId: NEWS_PULSE_VISUAL_MODEL_ID,
      routeId: operation.routeId,
      routePath: operation.routePath,
      body: {
        item_id: item?.id || null,
        locale: item?.locale || null,
        content_hash: item?.content_hash || null,
        trigger,
        visual_attempts: Math.max(Number(item?.visual_attempts || 0), 0) + 1,
      },
    });
  }
  const planForPolicy = plan.ok ? plan : {
    ...plan,
    operationId: operation.operationId,
    actorType: operation.actorType,
    budgetScope: operation.budgetScope,
    ownerDomain: operation.ownerDomain,
    providerFamily: operation.providerFamily,
    idempotencyPolicy: operation.idempotencyPolicy,
    killSwitchPolicy: operation.killSwitchPolicy,
    estimatedCostUnits: operation.estimatedCostUnits,
    estimatedCredits: operation.estimatedCredits,
  };
  const policy = compactNewsPulseVisualBudgetPolicy(planForPolicy, fingerprint, {
    item,
    now,
    trigger,
    actorId,
    runtimeStatus: plan.ok ? "metadata_recorded" : "blocked_by_invalid_policy",
    reason: plan.ok ? "budget_policy_validated" : plan.error?.code || "budget_policy_invalid",
  });
  return { plan, policy };
}

async function recordNewsPulseVisualBudgetPolicy(env, item, { policy, now }) {
  const policyJson = serializeBudgetPolicy(policy);
  await env.DB.prepare(
    `UPDATE news_pulse_items
     SET visual_budget_policy_json = ?,
         visual_budget_policy_status = ?,
         visual_budget_policy_fingerprint = ?,
         visual_budget_policy_version = ?,
         visual_updated_at = ?
     WHERE id = ?`
  ).bind(
    policyJson,
    policy?.runtime?.status || policy?.plan_status || null,
    policy?.fingerprint || null,
    policy?.budget_policy_version || null,
    now,
    item.id
  ).run();
}

async function recordNewsPulseVisualBudgetPolicyBestEffort(env, item, { policy, now }) {
  try {
    await recordNewsPulseVisualBudgetPolicy(env, item, { policy, now });
  } catch {
    // Budget metadata is recorded before provider execution; final status updates are best effort.
  }
}

async function listNewsPulseVisualCandidates(env, {
  now,
  limit = NEWS_PULSE_VISUAL_BATCH_LIMIT,
  maxAttempts = NEWS_PULSE_VISUAL_MAX_ATTEMPTS,
} = {}) {
  const result = await env.DB.prepare(
    `SELECT id, locale, title, summary, source, url, category, published_at, visual_prompt, visual_status, visual_attempts, expires_at, updated_at
     FROM news_pulse_items
     WHERE status = 'active'
       AND (expires_at IS NULL OR expires_at > ?)
       AND (visual_status = 'missing' OR visual_status = 'failed')
       AND COALESCE(visual_attempts, 0) < ?
     ORDER BY published_at DESC, updated_at DESC
     LIMIT ?`
  ).bind(now, maxAttempts, safeBatchLimit(limit)).all();
  return result?.results || [];
}

async function getNewsPulseVisualCandidateById(env, itemId, {
  now,
  maxAttempts = NEWS_PULSE_VISUAL_MAX_ATTEMPTS,
} = {}) {
  return env.DB.prepare(
    `SELECT id, locale, title, summary, source, url, category, published_at, visual_prompt, visual_status, visual_attempts, expires_at, updated_at
     FROM news_pulse_items
     WHERE id = ?
       AND status = 'active'
       AND (expires_at IS NULL OR expires_at > ?)
       AND (visual_status = 'missing' OR visual_status = 'failed')
       AND COALESCE(visual_attempts, 0) < ?
     LIMIT 1`
  ).bind(itemId, now, maxAttempts).first();
}

async function acquireNewsPulseVisual(env, item, {
  now,
  maxAttempts = NEWS_PULSE_VISUAL_MAX_ATTEMPTS,
} = {}) {
  const result = await env.DB.prepare(
    `UPDATE news_pulse_items
     SET visual_status = 'pending',
         visual_error = NULL,
         visual_attempts = COALESCE(visual_attempts, 0) + 1,
         visual_updated_at = ?
     WHERE id = ?
       AND status = 'active'
       AND (expires_at IS NULL OR expires_at > ?)
       AND (visual_status = 'missing' OR visual_status = 'failed')
       AND COALESCE(visual_attempts, 0) < ?`
  ).bind(now, item.id, now, maxAttempts).run();
  return Number(result?.meta?.changes || 0) > 0;
}

async function markNewsPulseVisualReady(env, item, { prompt, objectKey, thumbUrl, now }) {
  await env.DB.prepare(
    `UPDATE news_pulse_items
     SET visual_type = 'generated',
         visual_url = ?,
         visual_prompt = ?,
         visual_status = 'ready',
         visual_object_key = ?,
         visual_thumb_url = ?,
         visual_generated_at = ?,
         visual_error = NULL,
         visual_updated_at = ?
     WHERE id = ? AND visual_status = 'pending'`
  ).bind(thumbUrl, prompt, objectKey, thumbUrl, now, now, item.id).run();
}

async function markNewsPulseVisualFailed(env, item, { error, now }) {
  await env.DB.prepare(
    `UPDATE news_pulse_items
     SET visual_status = 'failed',
         visual_error = ?,
         visual_updated_at = ?
     WHERE id = ? AND visual_status = 'pending'`
  ).bind(sanitizeVisualError(error), now, item.id).run();
}

async function markNewsPulseVisualSkipped(env, item, { reason, now }) {
  await env.DB.prepare(
    `UPDATE news_pulse_items
     SET visual_status = 'skipped',
         visual_error = ?,
         visual_updated_at = ?
     WHERE id = ? AND (visual_status = 'missing' OR visual_status = 'failed' OR visual_status = 'pending')`
  ).bind(cleanText(reason, MAX_ERROR_LENGTH), now, item.id).run();
}

async function generateNewsPulseVisualForItem(env, item, {
  now,
  correlationId = null,
  trigger = "scheduled",
  actorId = null,
  actorRole = null,
  operationId = trigger === "openclaw_ingest"
    ? NEWS_PULSE_VISUAL_INGEST_OPERATION_ID
    : NEWS_PULSE_VISUAL_SCHEDULED_OPERATION_ID,
  operationOverride = null,
} = {}) {
  if (!item?.id || !cleanText(item.title, 160) || !isValidSourceUrl(item.url)) {
    await markNewsPulseVisualSkipped(env, item, { reason: "missing_valid_title_or_source_url", now });
    return { status: "skipped", reason: "invalid_item" };
  }

  const objectKey = buildNewsPulseVisualObjectKey(item.id);
  if (!objectKey) {
    await markNewsPulseVisualSkipped(env, item, { reason: "invalid_item_id", now });
    return { status: "skipped", reason: "invalid_item_id" };
  }

  const prompt = buildSafeNewsPulseVisualPrompt(item);
  let budgetPolicy = null;
  try {
    const budgetContext = await buildNewsPulseVisualBudgetContext({
      item,
      now,
      correlationId,
      trigger,
      actorId,
      actorRole,
      operationId,
      operationOverride,
    });
    budgetPolicy = budgetContext.policy;
    await recordNewsPulseVisualBudgetPolicy(env, item, { policy: budgetPolicy, now });
    if (!budgetContext.plan.ok) {
      const blockedPolicy = withBudgetRuntimeStatus(budgetPolicy, {
        status: "blocked_by_invalid_policy",
        reason: budgetContext.plan.error?.code || "budget_policy_invalid",
        now,
      });
      await recordNewsPulseVisualBudgetPolicyBestEffort(env, item, { policy: blockedPolicy, now });
      await markNewsPulseVisualFailed(env, item, {
        error: new Error("News Pulse visual budget policy failed."),
        now,
      });
      logDiagnostic({
        service: "bitbi-auth",
        component: COMPONENT,
        event: "news_pulse_visual_budget_policy_blocked",
        level: "warn",
        correlationId,
        item_id: item.id,
        operation_id: budgetPolicy.operation_id,
        budget_scope: budgetPolicy.budget_scope,
        plan_status: budgetPolicy.plan_status,
      });
      return { status: "failed", reason: "budget_policy_invalid" };
    }
    try {
      assertBudgetSwitchEnabled(env, budgetContext.plan);
    } catch (error) {
      if (!(error instanceof AdminPlatformBudgetSwitchError)) throw error;
      const skippedPolicy = withBudgetRuntimeStatus(budgetPolicy, {
        status: "skipped_by_budget_switch",
        reason: "budget_switch_disabled",
        now,
      });
      await recordNewsPulseVisualBudgetPolicyBestEffort(env, item, { policy: skippedPolicy, now });
      await markNewsPulseVisualSkipped(env, item, { reason: "budget_switch_disabled", now });
      logDiagnostic({
        service: "bitbi-auth",
        component: COMPONENT,
        event: "news_pulse_visual_budget_switch_disabled",
        level: "warn",
        correlationId,
        item_id: item.id,
        ...budgetSwitchLogFields(error.fields || budgetContext.plan),
      });
      return {
        status: "skipped",
        reason: "budget_switch_disabled",
        flag: error.fields?.flagName || NEWS_PULSE_VISUAL_BUDGET_KILL_SWITCH,
      };
    }
  } catch (error) {
    await markNewsPulseVisualFailed(env, item, {
      error: new Error("News Pulse visual budget policy failed."),
      now,
    });
    logDiagnostic({
      service: "bitbi-auth",
      component: COMPONENT,
      event: "news_pulse_visual_budget_policy_record_failed",
      level: "warn",
      correlationId,
      item_id: item.id,
      error: sanitizeVisualError(error),
    });
    return { status: "failed", reason: "budget_policy_record_failed" };
  }

  let thumb;
  try {
    const result = await env.AI.run(NEWS_PULSE_VISUAL_MODEL_ID, { prompt, num_steps: 4 });
    const generated = await extractGeneratedImageBytes(result);
    if (!generated?.bytes?.byteLength) throw new Error("Image generation returned no bytes.");
    thumb = await renderNewsPulseThumb(env, generated.bytes);
  } catch (error) {
    await recordNewsPulseVisualBudgetPolicyBestEffort(env, item, {
      policy: withBudgetRuntimeStatus(budgetPolicy, {
        status: "failed",
        reason: "generation_failed",
        now,
      }),
      now,
    });
    await markNewsPulseVisualFailed(env, item, { error, now });
    logDiagnostic({
      service: "bitbi-auth",
      component: COMPONENT,
      event: "news_pulse_visual_generation_failed",
      level: "warn",
      correlationId,
      item_id: item.id,
      model: NEWS_PULSE_VISUAL_MODEL_ID,
      error: sanitizeVisualError(error),
    });
    return { status: "failed", reason: "generation_failed" };
  }

  try {
    await env.USER_IMAGES.put(objectKey, thumb.bytes, {
      httpMetadata: {
        contentType: thumb.mimeType || THUMB_MIME_TYPE,
      },
      customMetadata: {
        feature: "news-pulse",
        item_id: String(item.id).slice(0, 128),
      },
    });
  } catch (error) {
    await recordNewsPulseVisualBudgetPolicyBestEffort(env, item, {
      policy: withBudgetRuntimeStatus(budgetPolicy, {
        status: "failed",
        reason: "store_failed",
        now,
      }),
      now,
    });
    await markNewsPulseVisualFailed(env, item, { error, now });
    logDiagnostic({
      service: "bitbi-auth",
      component: COMPONENT,
      event: "news_pulse_visual_store_failed",
      level: "warn",
      correlationId,
      item_id: item.id,
      error: sanitizeVisualError(error),
    });
    return { status: "failed", reason: "store_failed" };
  }

  try {
    await markNewsPulseVisualReady(env, item, {
      prompt,
      objectKey,
      thumbUrl: getNewsPulseVisualThumbUrl(item.id),
      now,
    });
  } catch (error) {
    try {
      await env.USER_IMAGES.delete(objectKey);
    } catch {
      // Best effort only; a later successful generation overwrites the deterministic key.
    }
    await recordNewsPulseVisualBudgetPolicyBestEffort(env, item, {
      policy: withBudgetRuntimeStatus(budgetPolicy, {
        status: "failed",
        reason: "ready_record_failed",
        now,
      }),
      now,
    });
    await markNewsPulseVisualFailed(env, item, { error, now });
    throw error;
  }

  await recordNewsPulseVisualBudgetPolicyBestEffort(env, item, {
    policy: withBudgetRuntimeStatus(budgetPolicy, {
      status: "ready",
      reason: "stored",
      now,
    }),
    now,
  });

  logDiagnostic({
    service: "bitbi-auth",
    component: COMPONENT,
    event: "news_pulse_visual_ready",
    correlationId,
    item_id: item.id,
    model: NEWS_PULSE_VISUAL_MODEL_ID,
  });
  return { status: "ready", objectKey };
}

async function processNewsPulseVisualRows(env, rows, {
  now,
  correlationId = null,
  trigger = "scheduled",
  actorId = null,
  actorRole = null,
  operationId = trigger === "openclaw_ingest"
    ? NEWS_PULSE_VISUAL_INGEST_OPERATION_ID
    : NEWS_PULSE_VISUAL_SCHEDULED_OPERATION_ID,
  operationOverride = null,
} = {}) {
  let readyCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  for (const row of rows) {
    let acquired = false;
    try {
      acquired = await acquireNewsPulseVisual(env, row, { now });
      if (!acquired) {
        skippedCount += 1;
        continue;
      }
      const result = await generateNewsPulseVisualForItem(env, row, {
        now,
        correlationId,
        trigger,
        actorId,
        actorRole,
        operationId,
        operationOverride,
      });
      if (result.status === "ready") readyCount += 1;
      else if (result.status === "failed") failedCount += 1;
      else skippedCount += 1;
    } catch (error) {
      failedCount += 1;
      if (acquired) {
        try {
          await markNewsPulseVisualFailed(env, row, { error, now });
        } catch {
          // Preserve scheduled cleanup progress even if status recording fails.
        }
      }
      logDiagnostic({
        service: "bitbi-auth",
        component: COMPONENT,
        event: "news_pulse_visual_item_failed",
        level: "warn",
        correlationId,
        item_id: row?.id || null,
        error: sanitizeVisualError(error),
      });
    }
  }
  return { readyCount, failedCount, skippedCount };
}

export async function processNewsPulseVisualBackfill({
  env,
  now = new Date().toISOString(),
  limit = NEWS_PULSE_VISUAL_BATCH_LIMIT,
  correlationId = null,
  operationOverride = null,
} = {}) {
  if (!hasNewsPulseVisualBindings(env)) {
    return {
      skipped: true,
      reason: "bindings_missing",
      scannedCount: 0,
      readyCount: 0,
      failedCount: 0,
      skippedCount: 0,
    };
  }

  let rows;
  try {
    rows = await listNewsPulseVisualCandidates(env, { now, limit });
  } catch (error) {
    if (isMissingNewsPulseVisualSchema(error)) {
      return {
        skipped: true,
        reason: "schema_missing",
        scannedCount: 0,
        readyCount: 0,
        failedCount: 0,
        skippedCount: 0,
      };
    }
    throw error;
  }

  const processed = await processNewsPulseVisualRows(env, rows, {
    now,
    correlationId,
    trigger: "scheduled",
    actorRole: "scheduled-job",
    operationId: NEWS_PULSE_VISUAL_SCHEDULED_OPERATION_ID,
    operationOverride,
  });

  return {
    skipped: false,
    scannedCount: rows.length,
    readyCount: processed.readyCount,
    failedCount: processed.failedCount,
    skippedCount: processed.skippedCount,
  };
}

export async function processNewsPulseVisualBackfillForItemIds({
  env,
  itemIds = [],
  now = new Date().toISOString(),
  limit = NEWS_PULSE_VISUAL_INGEST_BATCH_LIMIT,
  correlationId = null,
  actorId = null,
  actorRole = "openclaw-agent",
  operationOverride = null,
} = {}) {
  if (!hasNewsPulseVisualBindings(env)) {
    return {
      skipped: true,
      reason: "bindings_missing",
      scannedCount: 0,
      readyCount: 0,
      failedCount: 0,
      skippedCount: 0,
    };
  }

  const ids = normalizeItemIds(itemIds);
  const candidateLimit = safeBatchLimit(limit);
  if (ids.length === 0) {
    return {
      skipped: true,
      reason: "item_ids_missing",
      scannedCount: 0,
      readyCount: 0,
      failedCount: 0,
      skippedCount: 0,
    };
  }

  let rows = [];
  try {
    for (const id of ids) {
      const row = await getNewsPulseVisualCandidateById(env, id, { now });
      if (row?.id) rows.push(row);
      if (rows.length >= candidateLimit) break;
    }
  } catch (error) {
    if (isMissingNewsPulseVisualSchema(error)) {
      return {
        skipped: true,
        reason: "schema_missing",
        scannedCount: 0,
        readyCount: 0,
        failedCount: 0,
        skippedCount: 0,
      };
    }
    throw error;
  }

  const processed = await processNewsPulseVisualRows(env, rows, {
    now,
    correlationId,
    trigger: "openclaw_ingest",
    actorId,
    actorRole,
    operationId: NEWS_PULSE_VISUAL_INGEST_OPERATION_ID,
    operationOverride,
  });
  return {
    skipped: false,
    scannedCount: rows.length,
    readyCount: processed.readyCount,
    failedCount: processed.failedCount,
    skippedCount: processed.skippedCount,
  };
}
