import {
  PLATFORM_ADMIN_LAB_BUDGET_SCOPE,
  normalizePlatformBudgetScope,
} from "./platform-budget-caps.js";
import {
  buildPlatformBudgetRepairOperatorReport,
  exportPlatformBudgetRepairReportJson,
  exportPlatformBudgetRepairReportMarkdown,
  normalizePlatformBudgetRepairReportFilters,
} from "./platform-budget-repair-report.js";
import { nowIso, randomTokenHex, sha256Hex } from "./tokens.js";

export const PLATFORM_BUDGET_EVIDENCE_ARCHIVES_TABLE = "platform_budget_evidence_archives";
export const PLATFORM_BUDGET_EVIDENCE_ARCHIVE_VERSION = "platform-budget-evidence-archive-v1";
export const PLATFORM_BUDGET_EVIDENCE_ARCHIVE_ENDPOINT = "/api/admin/ai/platform-budget-evidence-archives";
export const PLATFORM_BUDGET_EVIDENCE_ARCHIVE_PREFIX = "platform-budget-evidence/";
export const PLATFORM_BUDGET_EVIDENCE_ARCHIVE_BUCKET_BINDING = "AUDIT_ARCHIVE";
export const PLATFORM_BUDGET_EVIDENCE_ARCHIVE_BUCKET_LABEL = "AUDIT_ARCHIVE";

const DEFAULT_RETENTION_DAYS = 90;
const MAX_RETENTION_DAYS = 365;
const DEFAULT_LIST_LIMIT = 25;
const MAX_LIST_LIMIT = 100;
const DEFAULT_CLEANUP_LIMIT = 25;
const MAX_CLEANUP_LIMIT = 50;
const MAX_ARCHIVE_BYTES = 768 * 1024;
const MAX_REASON_LENGTH = 500;
const SAFE_ID_PATTERN = /^[A-Za-z0-9._:@/-]{1,220}$/;
const SAFE_ARCHIVE_ID_PATTERN = /^pbea_[a-f0-9]{32}$/;
const UNSAFE_KEY_PATTERN =
  /(secret|token|cookie|authorization|auth_header|private[_-]?key|stripe|cloudflare|api[_-]?key|prompt|lyrics|message|provider[_-]?body|raw|idempotency|fingerprint|r2[_-]?key)/i;
const UNSAFE_VALUE_PATTERN =
  /(sk_(?:live|test)_|whsec_|bearer\s+[a-z0-9._-]+|cloudflare|api[_ -]?token|private\s+key|-----BEGIN|cookie:|authorization:)/i;
const ALLOWED_ARCHIVE_TYPES = new Set(["repair_report", "combined_evidence"]);
const ALLOWED_FORMATS = new Set(["json", "markdown"]);
const ARCHIVE_CONTENT_TYPES = Object.freeze({
  json: "application/json; charset=utf-8",
  markdown: "text/markdown; charset=utf-8",
});

export class PlatformBudgetEvidenceArchiveError extends Error {
  constructor(message, { status = 400, code = "platform_budget_evidence_archive_error", fields = {} } = {}) {
    super(message);
    this.name = "PlatformBudgetEvidenceArchiveError";
    this.status = status;
    this.code = code;
    this.fields = Object.freeze({ ...fields });
  }
}

function archiveError(message, code, fields = {}, status = 400) {
  return new PlatformBudgetEvidenceArchiveError(message, { status, code, fields });
}

function safeText(value, maxLength = 240) {
  if (value == null || value === "") return null;
  const text = String(value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  if (UNSAFE_VALUE_PATTERN.test(text)) return "[redacted]";
  return text.slice(0, maxLength);
}

function safeId(value, maxLength = 220) {
  const text = safeText(value, maxLength);
  if (!text || !SAFE_ID_PATTERN.test(text)) return null;
  return text;
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

function safeJson(value, depth = 0) {
  if (depth > 4) return null;
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return safeText(value, 300);
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => safeJson(entry, depth + 1));
  if (typeof value !== "object") return null;
  const out = {};
  for (const [key, raw] of Object.entries(value).slice(0, 60)) {
    const safeKey = safeId(key, 100);
    if (!safeKey || UNSAFE_KEY_PATTERN.test(safeKey)) continue;
    out[safeKey] = safeJson(raw, depth + 1);
  }
  return out;
}

function missingTableError(error) {
  return /no such table/i.test(String(error?.message || ""));
}

function assertDb(env) {
  if (!env?.DB?.prepare) {
    throw archiveError("Platform budget evidence archive store is unavailable.", "platform_budget_evidence_archive_store_unavailable", {}, 503);
  }
}

function requireArchiveBucket(env) {
  const bucket = env?.[PLATFORM_BUDGET_EVIDENCE_ARCHIVE_BUCKET_BINDING];
  if (!bucket || typeof bucket.put !== "function" || typeof bucket.get !== "function" || typeof bucket.delete !== "function") {
    throw archiveError("Platform budget evidence archive storage is unavailable.", "platform_budget_evidence_archive_storage_unavailable", {}, 503);
  }
  return bucket;
}

function normalizeLimit(value, { defaultValue = DEFAULT_LIST_LIMIT, maxValue = MAX_LIST_LIMIT } = {}) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) return defaultValue;
  return Math.max(1, Math.min(maxValue, numeric));
}

function normalizeReason(value) {
  const reason = safeText(value, MAX_REASON_LENGTH) || "";
  if (reason.length < 6) {
    throw archiveError("A bounded operator reason is required.", "platform_budget_evidence_archive_reason_required", {}, 400);
  }
  return reason;
}

function normalizeArchiveType(value) {
  const archiveType = safeId(value || "repair_report", 80);
  if (!archiveType || !ALLOWED_ARCHIVE_TYPES.has(archiveType)) {
    throw archiveError("Unsupported platform budget evidence archive type.", "platform_budget_evidence_archive_type_unsupported", {
      archiveType: archiveType || null,
    }, 400);
  }
  return archiveType;
}

function normalizeFormat(value) {
  const format = String(value || "json").trim().toLowerCase();
  if (!ALLOWED_FORMATS.has(format)) {
    throw archiveError("Unsupported platform budget evidence archive format.", "platform_budget_evidence_archive_format_unsupported", {
      format: format || null,
    }, 400);
  }
  return format;
}

function normalizeRetentionDays(value) {
  if (value == null || value === "") return DEFAULT_RETENTION_DAYS;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw archiveError("Retention days must be a positive integer.", "platform_budget_evidence_archive_retention_invalid", {}, 400);
  }
  return Math.max(1, Math.min(MAX_RETENTION_DAYS, numeric));
}

function normalizeBoolean(value, defaultValue = false) {
  if (value == null || value === "") return defaultValue;
  if (value === true || value === false) return value;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  return defaultValue;
}

function normalizeIdempotencyKey(value) {
  const key = safeId(value, 180);
  if (!key) {
    throw archiveError("Idempotency-Key header is required.", "idempotency_key_required", {}, 428);
  }
  return key;
}

function addDaysFromIso(iso, days) {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function archiveId() {
  return `pbea_${randomTokenHex(16)}`;
}

export function isApprovedPlatformBudgetEvidenceArchiveKey(key) {
  const value = String(key || "");
  if (!value || value.includes("..") || value.startsWith("/") || /[\u0000-\u001f\u007f]/.test(value)) return false;
  if (!value.startsWith(PLATFORM_BUDGET_EVIDENCE_ARCHIVE_PREFIX)) return false;
  return /^platform-budget-evidence\/platform_admin_lab_budget\/pbea_[a-f0-9]{32}\.(json|md)$/.test(value);
}

export function buildPlatformBudgetEvidenceArchiveKey({ budgetScope, archiveId: id, format }) {
  const normalizedScope = normalizePlatformBudgetScope(budgetScope || PLATFORM_ADMIN_LAB_BUDGET_SCOPE);
  if (normalizedScope !== PLATFORM_ADMIN_LAB_BUDGET_SCOPE) {
    throw archiveError("Only platform_admin_lab_budget archives are supported in this phase.", "platform_budget_evidence_archive_scope_unsupported", {
      budgetScope: normalizedScope,
    }, 400);
  }
  if (!SAFE_ARCHIVE_ID_PATTERN.test(String(id || ""))) {
    throw archiveError("Invalid platform budget evidence archive id.", "platform_budget_evidence_archive_id_invalid", {}, 400);
  }
  const extension = format === "markdown" ? "md" : "json";
  const key = `${PLATFORM_BUDGET_EVIDENCE_ARCHIVE_PREFIX}${normalizedScope}/${id}.${extension}`;
  if (!isApprovedPlatformBudgetEvidenceArchiveKey(key)) {
    throw archiveError("Archive storage key is outside the approved platform budget evidence prefix.", "platform_budget_evidence_archive_key_unsafe", {}, 400);
  }
  return key;
}

function normalizeFilters(input = {}, format = "json") {
  const rawFilters = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const filters = normalizePlatformBudgetRepairReportFilters({
    ...rawFilters,
    budgetScope: rawFilters.budgetScope || rawFilters.budget_scope || PLATFORM_ADMIN_LAB_BUDGET_SCOPE,
    format,
    limit: rawFilters.limit || 50,
  });
  return Object.freeze({
    budgetScope: filters.budgetScope,
    status: filters.status,
    candidateType: filters.candidateType,
    requestedAction: filters.requestedAction,
    dryRun: filters.dryRun,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    includeDetails: filters.includeDetails,
    includeCandidates: filters.includeCandidates,
    limit: filters.limit,
    format: filters.format,
  });
}

export function normalizePlatformBudgetEvidenceArchiveCreateRequest(input = {}) {
  const format = normalizeFormat(input.format);
  const archiveType = normalizeArchiveType(input.archiveType || input.archive_type);
  const includeDetails = normalizeBoolean(input.includeDetails ?? input.include_details, false);
  const includeCandidates = normalizeBoolean(input.includeCandidates ?? input.include_candidates, archiveType === "combined_evidence");
  const filters = normalizeFilters({
    ...(input.filters && typeof input.filters === "object" && !Array.isArray(input.filters) ? input.filters : {}),
    includeDetails,
    includeCandidates,
    format,
  }, format);
  if (filters.budgetScope !== PLATFORM_ADMIN_LAB_BUDGET_SCOPE) {
    throw archiveError("Only platform_admin_lab_budget archives are supported in this phase.", "platform_budget_evidence_archive_scope_unsupported", {
      budgetScope: filters.budgetScope,
    }, 400);
  }
  return Object.freeze({
    budgetScope: filters.budgetScope,
    archiveType,
    format,
    contentType: ARCHIVE_CONTENT_TYPES[format],
    filters,
    includeDetails,
    includeCandidates,
    retentionDays: normalizeRetentionDays(input.retentionDays ?? input.retention_days),
    reason: normalizeReason(input.reason),
  });
}

export function normalizePlatformBudgetEvidenceArchiveListOptions(input = {}) {
  const budgetScope = normalizePlatformBudgetScope(input.budgetScope || input.budget_scope || PLATFORM_ADMIN_LAB_BUDGET_SCOPE);
  if (budgetScope !== PLATFORM_ADMIN_LAB_BUDGET_SCOPE) {
    throw archiveError("Only platform_admin_lab_budget archive listing is supported in this phase.", "platform_budget_evidence_archive_scope_unsupported", {
      budgetScope,
    }, 400);
  }
  const status = safeId(input.status || input.archiveStatus || input.archive_status, 80);
  const archiveType = input.archiveType || input.archive_type ? normalizeArchiveType(input.archiveType || input.archive_type) : null;
  const format = input.format ? normalizeFormat(input.format) : null;
  return Object.freeze({
    budgetScope,
    status,
    archiveType,
    format,
    limit: normalizeLimit(input.limit, { defaultValue: DEFAULT_LIST_LIMIT, maxValue: MAX_LIST_LIMIT }),
  });
}

export function normalizePlatformBudgetEvidenceArchiveCleanupOptions(input = {}) {
  return Object.freeze({
    budgetScope: normalizePlatformBudgetScope(input.budgetScope || input.budget_scope || PLATFORM_ADMIN_LAB_BUDGET_SCOPE),
    limit: normalizeLimit(input.limit, { defaultValue: DEFAULT_CLEANUP_LIMIT, maxValue: MAX_CLEANUP_LIMIT }),
    reason: normalizeReason(input.reason),
  });
}

function stableStringify(value) {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

async function buildCreateRequestHashes(request, idempotencyKey) {
  const requestHash = await sha256Hex(stableStringify({
    budgetScope: request.budgetScope,
    archiveType: request.archiveType,
    format: request.format,
    filters: request.filters,
    retentionDays: request.retentionDays,
    reason: request.reason,
  }));
  const idempotencyKeyHash = await sha256Hex(`platform-budget-evidence-archive:${idempotencyKey}`);
  return { requestHash, idempotencyKeyHash };
}

async function archiveStorageReference(storageKey) {
  return {
    private: true,
    bucketBinding: PLATFORM_BUDGET_EVIDENCE_ARCHIVE_BUCKET_LABEL,
    prefix: PLATFORM_BUDGET_EVIDENCE_ARCHIVE_PREFIX,
    keySha256: storageKey ? await sha256Hex(storageKey) : null,
    internalKeyIncluded: false,
  };
}

export async function serializePlatformBudgetEvidenceArchive(row = null, options = {}) {
  if (!row) return null;
  const storage = options.includeStorageReference
    ? await archiveStorageReference(row.storage_key)
    : {
      private: true,
      bucketBinding: PLATFORM_BUDGET_EVIDENCE_ARCHIVE_BUCKET_LABEL,
      prefix: PLATFORM_BUDGET_EVIDENCE_ARCHIVE_PREFIX,
      internalKeyIncluded: false,
    };
  return Object.freeze({
    id: row.id,
    budgetScope: row.budget_scope,
    archiveType: row.archive_type,
    archiveStatus: row.archive_status,
    contentType: row.content_type,
    format: row.format,
    sha256: row.sha256 || null,
    sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes),
    filters: safeJson(parseJsonObject(row.filters_json)),
    summary: safeJson(parseJsonObject(row.summary_json)),
    idempotencyKeyPresent: Boolean(row.idempotency_key_hash),
    reason: safeText(row.reason, MAX_REASON_LENGTH),
    createdByUserId: safeId(row.created_by_user_id, 180),
    createdByEmail: safeText(row.created_by_email, 180),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at || null,
    deletedAt: row.deleted_at || null,
    errorCode: row.error_code || null,
    errorMessage: safeText(row.error_message, 240),
    storage,
    replayed: options.replayed === true,
  });
}

function archiveSummaryFromReport(report, request = {}) {
  const summary = report?.summary || {};
  return safeJson({
    reportVersion: report?.version || null,
    source: report?.source || "local_d1_read_only",
    budgetScope: report?.budgetScope || request.budgetScope,
    archiveType: request.archiveType,
    format: request.format,
    totalRepairActions: summary.totalRepairActions ?? 0,
    executableRepairsApplied: summary.executableRepairsApplied ?? 0,
    reviewOnlyActionsRecorded: summary.reviewOnlyActionsRecorded ?? 0,
    failedRepairAttempts: summary.failedRepairAttempts ?? 0,
    createdUsageEventCount: summary.createdUsageEventCount ?? 0,
    criticalReconciliationIssueCount: summary.criticalReconciliationIssueCount ?? null,
    unresolvedRepairCandidates: summary.unresolvedRepairCandidates ?? null,
    productionReadiness: report?.productionReadiness || "blocked",
    liveBillingReadiness: report?.liveBillingReadiness || "blocked",
  });
}

function buildArchiveEnvelope({ id, request, createdAt, expiresAt, report, sha256 = null, sizeBytes = null }) {
  return safeJson({
    version: PLATFORM_BUDGET_EVIDENCE_ARCHIVE_VERSION,
    id,
    archiveType: request.archiveType,
    source: "local_d1_read_only",
    budgetScope: request.budgetScope,
    format: request.format,
    generatedAt: createdAt,
    expiresAt,
    contentType: request.contentType,
    filters: request.filters,
    retentionDays: request.retentionDays,
    reason: request.reason,
    sha256,
    sizeBytes,
    productionReadiness: "blocked",
    liveBillingReadiness: "blocked",
    automaticRepair: false,
    repairAppliedByArchive: false,
    providerCalls: false,
    stripeCalls: false,
    creditMutation: false,
    sourceMutation: false,
    limitations: [
      "Archive creation stores a sanitized operator evidence snapshot only.",
      "No repair is applied by archive creation.",
      "No provider, Stripe, Cloudflare, credit, source attempt/job, member/org billing, or customer billing mutation occurs.",
      "Archive cleanup is bounded and restricted to the platform-budget-evidence/ prefix.",
    ],
    reportSummary: archiveSummaryFromReport(report, request),
  });
}

export function redactPlatformBudgetEvidenceArchivePayload(payload) {
  return safeJson(payload);
}

async function buildArchiveContent({ id, request, report, createdAt, expiresAt }) {
  const envelope = buildArchiveEnvelope({ id, request, createdAt, expiresAt, report });
  if (request.format === "markdown") {
    const body = [
      "# Platform Budget Evidence Archive",
      "",
      `Archive ID: ${id}`,
      `Budget scope: ${request.budgetScope}`,
      `Archive type: ${request.archiveType}`,
      `Generated: ${createdAt}`,
      `Expires: ${expiresAt || "none"}`,
      "Production readiness: blocked",
      "Live billing readiness: blocked",
      "",
      "This archive is sanitized operator evidence. It applies no repair, calls no provider, calls no Stripe API, and mutates no credits or source rows.",
      "",
      exportPlatformBudgetRepairReportMarkdown(report),
    ].join("\n");
    return body;
  }
  return `${JSON.stringify({
    archive: envelope,
    report: redactPlatformBudgetEvidenceArchivePayload(report),
  }, null, 2)}\n`;
}

async function readArchiveById(env, id) {
  return env.DB.prepare(
    `SELECT id, budget_scope, archive_type, archive_status, storage_bucket, storage_key,
            content_type, format, sha256, size_bytes, filters_json, summary_json,
            idempotency_key_hash, request_hash, reason, created_by_user_id, created_by_email,
            created_at, updated_at, expires_at, deleted_at, error_code, error_message
       FROM ${PLATFORM_BUDGET_EVIDENCE_ARCHIVES_TABLE}
      WHERE id = ?
      LIMIT 1`
  ).bind(id).first();
}

async function readArchiveByIdempotencyHash(env, idempotencyKeyHash) {
  return env.DB.prepare(
    `SELECT id, budget_scope, archive_type, archive_status, storage_bucket, storage_key,
            content_type, format, sha256, size_bytes, filters_json, summary_json,
            idempotency_key_hash, request_hash, reason, created_by_user_id, created_by_email,
            created_at, updated_at, expires_at, deleted_at, error_code, error_message
       FROM ${PLATFORM_BUDGET_EVIDENCE_ARCHIVES_TABLE}
      WHERE idempotency_key_hash = ?
      LIMIT 1`
  ).bind(idempotencyKeyHash).first();
}

async function insertArchiveMetadata(env, row) {
  await env.DB.prepare(
    `INSERT INTO ${PLATFORM_BUDGET_EVIDENCE_ARCHIVES_TABLE}
      (id, budget_scope, archive_type, archive_status, storage_bucket, storage_key,
       content_type, format, sha256, size_bytes, filters_json, summary_json,
       idempotency_key_hash, request_hash, reason, created_by_user_id, created_by_email,
       created_at, updated_at, expires_at, deleted_at, error_code, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.id,
    row.budget_scope,
    row.archive_type,
    row.archive_status,
    row.storage_bucket,
    row.storage_key,
    row.content_type,
    row.format,
    row.sha256,
    row.size_bytes,
    row.filters_json,
    row.summary_json,
    row.idempotency_key_hash,
    row.request_hash,
    row.reason,
    row.created_by_user_id,
    row.created_by_email,
    row.created_at,
    row.updated_at,
    row.expires_at,
    row.deleted_at,
    row.error_code,
    row.error_message,
  ).run();
}

async function markArchiveCreated(env, { id, sha256, sizeBytes, summaryJson, now }) {
  await env.DB.prepare(
    `UPDATE ${PLATFORM_BUDGET_EVIDENCE_ARCHIVES_TABLE}
        SET archive_status = 'created',
            sha256 = ?,
            size_bytes = ?,
            summary_json = ?,
            error_code = NULL,
            error_message = NULL,
            updated_at = ?
      WHERE id = ?`
  ).bind(sha256, sizeBytes, summaryJson, now, id).run();
}

async function markArchiveFailure(env, { id, code, message, now }) {
  await env.DB.prepare(
    `UPDATE ${PLATFORM_BUDGET_EVIDENCE_ARCHIVES_TABLE}
        SET archive_status = 'failed',
            error_code = ?,
            error_message = ?,
            updated_at = ?
      WHERE id = ?`
  ).bind(code, safeText(message, 240), now, id).run();
}

export async function createPlatformBudgetEvidenceArchive(env, {
  requestInput = {},
  idempotencyKey,
  adminUser = null,
} = {}) {
  assertDb(env);
  const key = normalizeIdempotencyKey(idempotencyKey);
  const bucket = requireArchiveBucket(env);
  const request = normalizePlatformBudgetEvidenceArchiveCreateRequest(requestInput);
  const { requestHash, idempotencyKeyHash } = await buildCreateRequestHashes(request, key);

  try {
    const existing = await readArchiveByIdempotencyHash(env, idempotencyKeyHash);
    if (existing) {
      if (existing.request_hash !== requestHash) {
        throw archiveError("Idempotency-Key was already used for a different archive request.", "platform_budget_evidence_archive_idempotency_conflict", {}, 409);
      }
      return {
        archive: await serializePlatformBudgetEvidenceArchive(existing, { replayed: true }),
        replayed: true,
      };
    }
  } catch (error) {
    if (error instanceof PlatformBudgetEvidenceArchiveError) throw error;
    if (missingTableError(error)) {
      throw archiveError("Platform budget evidence archive table is unavailable.", "platform_budget_evidence_archive_table_unavailable", {}, 503);
    }
    throw error;
  }

  const createdAt = nowIso();
  const expiresAt = addDaysFromIso(createdAt, request.retentionDays);
  const id = archiveId();
  const storageKey = buildPlatformBudgetEvidenceArchiveKey({ budgetScope: request.budgetScope, archiveId: id, format: request.format });
  const report = await buildPlatformBudgetRepairOperatorReport(env, {
    ...request.filters,
    includeDetails: request.includeDetails,
    includeCandidates: request.includeCandidates,
    format: request.format,
  });
  const body = await buildArchiveContent({ id, request, report, createdAt, expiresAt });
  const sizeBytes = new TextEncoder().encode(body).byteLength;
  if (sizeBytes > MAX_ARCHIVE_BYTES) {
    throw archiveError("Platform budget evidence archive is too large for bounded storage.", "platform_budget_evidence_archive_too_large", {
      sizeBytes,
      maxBytes: MAX_ARCHIVE_BYTES,
    }, 413);
  }
  const digest = await sha256Hex(body);
  const summary = archiveSummaryFromReport(report, request);
  const row = {
    id,
    budget_scope: request.budgetScope,
    archive_type: request.archiveType,
    archive_status: "failed",
    storage_bucket: PLATFORM_BUDGET_EVIDENCE_ARCHIVE_BUCKET_LABEL,
    storage_key: storageKey,
    content_type: request.contentType,
    format: request.format,
    sha256: null,
    size_bytes: null,
    filters_json: JSON.stringify(request.filters),
    summary_json: JSON.stringify(summary),
    idempotency_key_hash: idempotencyKeyHash,
    request_hash: requestHash,
    reason: request.reason,
    created_by_user_id: adminUser?.id || null,
    created_by_email: adminUser?.email || null,
    created_at: createdAt,
    updated_at: createdAt,
    expires_at: expiresAt,
    deleted_at: null,
    error_code: "archive_storage_pending",
    error_message: "Archive storage has not completed.",
  };

  try {
    await insertArchiveMetadata(env, row);
  } catch (error) {
    if (missingTableError(error)) {
      throw archiveError("Platform budget evidence archive table is unavailable.", "platform_budget_evidence_archive_table_unavailable", {}, 503);
    }
    throw error;
  }

  try {
    await bucket.put(storageKey, body, {
      httpMetadata: { contentType: request.contentType },
      customMetadata: {
        archiveId: id,
        budgetScope: request.budgetScope,
        archiveType: request.archiveType,
        sha256: digest,
      },
    });
    await markArchiveCreated(env, { id, sha256: digest, sizeBytes, summaryJson: JSON.stringify(summary), now: nowIso() });
    const stored = await readArchiveById(env, id);
    return {
      archive: await serializePlatformBudgetEvidenceArchive(stored, { includeStorageReference: true }),
      replayed: false,
    };
  } catch (error) {
    const code = error instanceof PlatformBudgetEvidenceArchiveError
      ? error.code
      : "platform_budget_evidence_archive_storage_failed";
    await markArchiveFailure(env, { id, code, message: error?.message || "Archive storage failed.", now: nowIso() });
    if (error instanceof PlatformBudgetEvidenceArchiveError) throw error;
    throw archiveError("Platform budget evidence archive storage failed.", code, {}, 503);
  }
}

export async function listPlatformBudgetEvidenceArchives(env, input = {}) {
  assertDb(env);
  const options = normalizePlatformBudgetEvidenceArchiveListOptions(input);
  try {
    const rows = await env.DB.prepare(
      `SELECT id, budget_scope, archive_type, archive_status, storage_bucket, storage_key,
              content_type, format, sha256, size_bytes, filters_json, summary_json,
              idempotency_key_hash, request_hash, reason, created_by_user_id, created_by_email,
              created_at, updated_at, expires_at, deleted_at, error_code, error_message
         FROM ${PLATFORM_BUDGET_EVIDENCE_ARCHIVES_TABLE}
        WHERE budget_scope = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?`
    ).bind(options.budgetScope, options.limit).all();
    const archives = [];
    for (const row of rows.results || []) {
      if (options.status && row.archive_status !== options.status) continue;
      if (options.archiveType && row.archive_type !== options.archiveType) continue;
      if (options.format && row.format !== options.format) continue;
      archives.push(await serializePlatformBudgetEvidenceArchive(row));
    }
    return {
      available: true,
      budgetScope: options.budgetScope,
      appliedLimit: options.limit,
      archives,
    };
  } catch (error) {
    if (missingTableError(error)) {
      throw archiveError("Platform budget evidence archive table is unavailable.", "platform_budget_evidence_archive_table_unavailable", {}, 503);
    }
    throw error;
  }
}

export async function getPlatformBudgetEvidenceArchive(env, id) {
  assertDb(env);
  const safeArchiveId = safeId(id, 80);
  if (!safeArchiveId || !SAFE_ARCHIVE_ID_PATTERN.test(safeArchiveId)) {
    throw archiveError("Invalid platform budget evidence archive id.", "platform_budget_evidence_archive_id_invalid", {}, 400);
  }
  try {
    const row = await readArchiveById(env, safeArchiveId);
    if (!row) throw archiveError("Platform budget evidence archive was not found.", "platform_budget_evidence_archive_not_found", { id: safeArchiveId }, 404);
    return await serializePlatformBudgetEvidenceArchive(row, { includeStorageReference: true });
  } catch (error) {
    if (error instanceof PlatformBudgetEvidenceArchiveError) throw error;
    if (missingTableError(error)) {
      throw archiveError("Platform budget evidence archive table is unavailable.", "platform_budget_evidence_archive_table_unavailable", {}, 503);
    }
    throw error;
  }
}

export async function getPlatformBudgetEvidenceArchiveDownload(env, id) {
  assertDb(env);
  const bucket = requireArchiveBucket(env);
  const safeArchiveId = safeId(id, 80);
  if (!safeArchiveId || !SAFE_ARCHIVE_ID_PATTERN.test(safeArchiveId)) {
    throw archiveError("Invalid platform budget evidence archive id.", "platform_budget_evidence_archive_id_invalid", {}, 400);
  }
  const row = await readArchiveById(env, safeArchiveId);
  if (!row) throw archiveError("Platform budget evidence archive was not found.", "platform_budget_evidence_archive_not_found", { id: safeArchiveId }, 404);
  if (row.archive_status !== "created") {
    throw archiveError("Platform budget evidence archive is not downloadable.", "platform_budget_evidence_archive_not_downloadable", {
      status: row.archive_status,
    }, 409);
  }
  if (row.expires_at && row.expires_at <= nowIso()) {
    throw archiveError("Platform budget evidence archive is expired.", "platform_budget_evidence_archive_expired", { id: safeArchiveId }, 410);
  }
  if (!isApprovedPlatformBudgetEvidenceArchiveKey(row.storage_key)) {
    throw archiveError("Platform budget evidence archive storage key is unsafe.", "platform_budget_evidence_archive_key_unsafe", { id: safeArchiveId }, 409);
  }
  const object = await bucket.get(row.storage_key);
  if (!object) {
    throw archiveError("Platform budget evidence archive object was not found.", "platform_budget_evidence_archive_object_missing", { id: safeArchiveId }, 404);
  }
  const text = typeof object.text === "function"
    ? await object.text()
    : typeof object.body === "string"
      ? object.body
      : object.body instanceof Uint8Array
        ? new TextDecoder().decode(object.body)
        : object.body instanceof ArrayBuffer
          ? new TextDecoder().decode(object.body)
          : "";
  const extension = row.format === "markdown" ? "md" : "json";
  return {
    archive: await serializePlatformBudgetEvidenceArchive(row),
    body: text,
    contentType: row.content_type || ARCHIVE_CONTENT_TYPES[row.format] || ARCHIVE_CONTENT_TYPES.json,
    filename: `platform-budget-evidence-${row.id}.${extension}`,
  };
}

export async function expirePlatformBudgetEvidenceArchive(env, {
  id,
  reason,
  idempotencyKey,
  adminUser = null,
} = {}) {
  assertDb(env);
  normalizeIdempotencyKey(idempotencyKey);
  const safeArchiveId = safeId(id, 80);
  if (!safeArchiveId || !SAFE_ARCHIVE_ID_PATTERN.test(safeArchiveId)) {
    throw archiveError("Invalid platform budget evidence archive id.", "platform_budget_evidence_archive_id_invalid", {}, 400);
  }
  const normalizedReason = normalizeReason(reason);
  const now = nowIso();
  const row = await readArchiveById(env, safeArchiveId);
  if (!row) throw archiveError("Platform budget evidence archive was not found.", "platform_budget_evidence_archive_not_found", { id: safeArchiveId }, 404);
  if (!isApprovedPlatformBudgetEvidenceArchiveKey(row.storage_key)) {
    throw archiveError("Platform budget evidence archive storage key is unsafe.", "platform_budget_evidence_archive_key_unsafe", { id: safeArchiveId }, 409);
  }
  if (row.archive_status === "expired" || row.archive_status === "deleted") {
    return {
      archive: await serializePlatformBudgetEvidenceArchive(row),
      expired: row.archive_status === "expired",
      replayed: true,
    };
  }
  await env.DB.prepare(
    `UPDATE ${PLATFORM_BUDGET_EVIDENCE_ARCHIVES_TABLE}
        SET archive_status = 'expired',
            reason = ?,
            updated_at = ?,
            expires_at = ?
      WHERE id = ?`
  ).bind(normalizedReason, now, now, safeArchiveId).run();
  const updated = await readArchiveById(env, safeArchiveId);
  return {
    archive: await serializePlatformBudgetEvidenceArchive(updated),
    expired: true,
    requestedByUserId: adminUser?.id || null,
  };
}

async function markArchiveCleanupFailure(env, row, code, message) {
  await env.DB.prepare(
    `UPDATE ${PLATFORM_BUDGET_EVIDENCE_ARCHIVES_TABLE}
        SET archive_status = 'cleanup_failed',
            error_code = ?,
            error_message = ?,
            updated_at = ?
      WHERE id = ?`
  ).bind(code, safeText(message, 240), nowIso(), row.id).run();
}

export async function cleanupExpiredPlatformBudgetEvidenceArchives(env, input = {}) {
  assertDb(env);
  const bucket = requireArchiveBucket(env);
  const options = normalizePlatformBudgetEvidenceArchiveCleanupOptions(input);
  if (options.budgetScope !== PLATFORM_ADMIN_LAB_BUDGET_SCOPE) {
    throw archiveError("Only platform_admin_lab_budget archive cleanup is supported in this phase.", "platform_budget_evidence_archive_scope_unsupported", {
      budgetScope: options.budgetScope,
    }, 400);
  }
  const now = nowIso();
  const rows = await env.DB.prepare(
    `SELECT id, budget_scope, archive_type, archive_status, storage_bucket, storage_key,
            content_type, format, sha256, size_bytes, filters_json, summary_json,
            idempotency_key_hash, request_hash, reason, created_by_user_id, created_by_email,
            created_at, updated_at, expires_at, deleted_at, error_code, error_message
       FROM ${PLATFORM_BUDGET_EVIDENCE_ARCHIVES_TABLE}
      WHERE budget_scope = ?
        AND archive_status IN ('created', 'expired', 'cleanup_failed')
        AND (archive_status = 'expired' OR (expires_at IS NOT NULL AND expires_at <= ?))
      ORDER BY expires_at ASC, created_at ASC, id ASC
      LIMIT ?`
  ).bind(options.budgetScope, now, options.limit).all();

  const results = [];
  let deletedCount = 0;
  let failedCount = 0;
  for (const row of rows.results || []) {
    const keySha256 = row.storage_key ? await sha256Hex(row.storage_key) : null;
    if (row.storage_bucket !== PLATFORM_BUDGET_EVIDENCE_ARCHIVE_BUCKET_LABEL || !isApprovedPlatformBudgetEvidenceArchiveKey(row.storage_key)) {
      failedCount += 1;
      await markArchiveCleanupFailure(env, row, "platform_budget_evidence_archive_key_unsafe", "Archive storage key is outside the approved platform budget evidence prefix.");
      results.push({
        id: row.id,
        status: "cleanup_failed",
        keySha256,
        internalKeyIncluded: false,
        errorCode: "platform_budget_evidence_archive_key_unsafe",
      });
      continue;
    }
    try {
      await bucket.delete(row.storage_key);
      const cleanupAt = nowIso();
      await env.DB.prepare(
        `UPDATE ${PLATFORM_BUDGET_EVIDENCE_ARCHIVES_TABLE}
            SET archive_status = 'deleted',
                deleted_at = ?,
                updated_at = ?,
                error_code = NULL,
                error_message = NULL
          WHERE id = ?`
      ).bind(cleanupAt, cleanupAt, row.id).run();
      deletedCount += 1;
      results.push({
        id: row.id,
        status: "deleted",
        keySha256,
        internalKeyIncluded: false,
      });
    } catch (error) {
      failedCount += 1;
      await markArchiveCleanupFailure(env, row, "platform_budget_evidence_archive_cleanup_failed", error?.message || "Archive cleanup failed.");
      results.push({
        id: row.id,
        status: "cleanup_failed",
        keySha256,
        internalKeyIncluded: false,
        errorCode: "platform_budget_evidence_archive_cleanup_failed",
      });
    }
  }
  return {
    ok: true,
    budgetScope: options.budgetScope,
    source: "local_d1_r2_admin_approved_cleanup",
    appliedLimit: options.limit,
    scannedCount: (rows.results || []).length,
    deletedCount,
    failedCount,
    results,
    notes: [
      "Cleanup is bounded and restricted to the platform-budget-evidence/ prefix.",
      "No repair, provider, Stripe, credit, source row, member/org billing, or customer billing mutation is performed.",
    ],
  };
}

export function platformBudgetEvidenceArchiveErrorResponse(error) {
  const fields = error?.fields || {};
  return {
    ok: false,
    error: error?.message || "Platform budget evidence archive request failed.",
    code: error?.code || "platform_budget_evidence_archive_error",
    budget_scope: fields.budgetScope || null,
    archive_id: fields.id || null,
  };
}
