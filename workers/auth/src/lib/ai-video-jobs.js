import {
  ADMIN_AI_VIDEO_HAPPYHORSE_T2V_MODEL_ID,
  ADMIN_AI_VIDEO_MODEL_ID,
  ADMIN_AI_VIDEO_VIDU_Q3_PRO_MODEL_ID,
  AdminAiValidationError,
  resolveAdminAiModelSelection,
} from "../../../../js/shared/admin-ai-contract.mjs";
import { calculateHappyHorseT2vCreditPricing } from "../../../../js/shared/happyhorse-t2v-pricing.mjs";
import {
  getDurationMs,
  getErrorFields,
  logDiagnostic,
} from "../../../../js/shared/worker-observability.mjs";
import { proxyToAiLab } from "./admin-ai-proxy.js";
import { WorkerConfigError } from "./config.js";
import { addDaysIso, nowIso, randomTokenHex, sha256Hex } from "./tokens.js";

export const AI_VIDEO_JOBS_QUEUE_NAME = "bitbi-ai-video-jobs";
export const AI_VIDEO_JOB_QUEUE_SCHEMA_VERSION = 1;
export const AI_VIDEO_JOB_QUEUE_TYPE = "ai_video_job.process";
export const AI_VIDEO_JOB_SCOPE_ADMIN = "admin";

const JOB_COLUMN_NAMES = [
  "id",
  "user_id",
  "scope",
  "status",
  "provider",
  "model",
  "prompt",
  "input_json",
  "request_hash",
  "provider_task_id",
  "idempotency_key",
  "attempt_count",
  "max_attempts",
  "next_attempt_at",
  "locked_until",
  "output_r2_key",
  "output_url",
  "output_content_type",
  "output_size_bytes",
  "poster_r2_key",
  "poster_url",
  "poster_content_type",
  "poster_size_bytes",
  "provider_state",
  "error_code",
  "error_message",
  "created_at",
  "updated_at",
  "completed_at",
  "expires_at",
];

const JOB_COLUMNS = JOB_COLUMN_NAMES.join(", ");
const JOB_WITH_USER_JOIN_COLUMNS = `${JOB_COLUMN_NAMES.map((column) => `ai_video_jobs.${column} AS ${column}`).join(", ")}, users.email AS user_email`;
const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled", "expired"]);
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const DEFAULT_MAX_ATTEMPTS = 3;
const JOB_LEASE_MS = 2 * 60 * 1000;
const MAX_SAFE_ERROR_LENGTH = 240;
export const VIDEO_OUTPUT_MAX_BYTES = 100 * 1024 * 1024;
export const VIDEO_POSTER_MAX_BYTES = 5 * 1024 * 1024;
export const VIDEO_OUTPUT_CONTENT_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
export const VIDEO_POSTER_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function normalizeAiVideoIdempotencyKey(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    throw new AdminAiValidationError(
      "Idempotency-Key header is required.",
      428,
      "idempotency_key_required"
    );
  }
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(raw)) {
    throw new AdminAiValidationError(
      "Invalid Idempotency-Key header.",
      400,
      "invalid_idempotency_key"
    );
  }
  return raw;
}

function assertVideoJobConfig(env) {
  if (!env?.DB) {
    throw new WorkerConfigError("Required D1 binding is missing.", {
      reason: "db_binding_missing",
    });
  }
  if (!env?.AI_VIDEO_JOBS_QUEUE || typeof env.AI_VIDEO_JOBS_QUEUE.send !== "function") {
    throw new WorkerConfigError("Required AI video jobs queue binding is missing.", {
      reason: "ai_video_jobs_queue_binding_missing",
    });
  }
  if (!env?.AI_LAB || typeof env.AI_LAB.fetch !== "function") {
    throw new WorkerConfigError("Required AI service binding is missing.", {
      reason: "ai_lab_binding_missing",
    });
  }
  if (!env?.USER_IMAGES || typeof env.USER_IMAGES.put !== "function" || typeof env.USER_IMAGES.get !== "function") {
    throw new WorkerConfigError("Required user media R2 binding is missing.", {
      reason: "user_images_binding_missing",
    });
  }
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function sanitizePublicError(value, fallback = "Video job failed.") {
  const text = String(value || fallback).replace(/\s+/g, " ").trim();
  return text.slice(0, MAX_SAFE_ERROR_LENGTH) || fallback;
}

function resolveProvider(modelId) {
  if (modelId === ADMIN_AI_VIDEO_VIDU_Q3_PRO_MODEL_ID) return "vidu";
  if (modelId === ADMIN_AI_VIDEO_MODEL_ID || modelId === ADMIN_AI_VIDEO_HAPPYHORSE_T2V_MODEL_ID) return "workers-ai";
  return "unknown";
}

function buildJobStoredInput(payload, modelId) {
  if (modelId !== ADMIN_AI_VIDEO_HAPPYHORSE_T2V_MODEL_ID) {
    return payload;
  }
  const pricing = calculateHappyHorseT2vCreditPricing({
    resolution: payload.resolution,
    ratio: payload.ratio,
    duration: payload.duration,
    watermark: payload.watermark,
  });
  return {
    ...payload,
    __admin_generation_metadata: {
      releaseStatus: "admin_only",
      adminCreditsCharged: 0,
      futureMemberPricing: {
        credits: pricing.credits,
        providerCostUsd: pricing.providerCostUsd,
        minimumSellPriceUsd: pricing.minimumSellPriceUsd,
        effectiveProfitMargin: pricing.effectiveProfitMargin,
        formula: pricing.formula,
      },
    },
  };
}

function stripStoredInputMetadata(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const stripped = {};
  for (const [key, value] of Object.entries(input)) {
    if (key.startsWith("__")) continue;
    stripped[key] = value;
  }
  return stripped;
}

function addMillisecondsIso(ms, baseMs = Date.now()) {
  return new Date(baseMs + ms).toISOString();
}

function normalizeJobRow(row) {
  if (!row) return null;
  return {
    ...row,
    attempt_count: Number(row.attempt_count || 0),
    max_attempts: Number(row.max_attempts || DEFAULT_MAX_ATTEMPTS),
  };
}

function buildQueueMessage(job, correlationId, reason = "created") {
  return {
    schema_version: AI_VIDEO_JOB_QUEUE_SCHEMA_VERSION,
    type: AI_VIDEO_JOB_QUEUE_TYPE,
    job_id: job.id,
    user_id: job.user_id,
    attempt: Number(job.attempt_count || 0) + 1,
    correlation_id: correlationId || null,
    reason,
    enqueued_at: nowIso(),
  };
}

export function serializeAiVideoJob(job) {
  const serialized = {
    jobId: job.id,
    status: job.status,
    provider: job.provider,
    model: job.model,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    completedAt: job.completed_at || null,
    statusUrl: `/api/admin/ai/video-jobs/${encodeURIComponent(job.id)}`,
  };

  if (job.status === "succeeded" && job.output_url) {
    serialized.outputUrl = job.output_url;
  }
  if (job.status === "succeeded" && job.poster_url) {
    serialized.posterUrl = job.poster_url;
  }

  if (job.status === "failed") {
    serialized.error = {
      code: job.error_code || "video_job_failed",
      message: sanitizePublicError(job.error_message),
    };
  }

  return serialized;
}

function assertAiVideoInspectionConfig(env) {
  if (!env?.DB) {
    throw new WorkerConfigError("Required D1 binding is missing.", {
      reason: "db_binding_missing",
    });
  }
}

function normalizeInspectionLimit(value, { defaultLimit = 20, maxLimit = 50 } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return defaultLimit;
  return Math.min(maxLimit, Math.max(1, Math.trunc(parsed)));
}

function parseInspectionCursor(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  const separator = raw.lastIndexOf("|");
  if (separator <= 0 || separator === raw.length - 1) return null;
  const createdAt = raw.slice(0, separator);
  const id = raw.slice(separator + 1);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(createdAt) || !/^[A-Za-z0-9_-]{1,160}$/.test(id)) {
    return null;
  }
  return { createdAt, id };
}

function encodeInspectionCursor(row) {
  if (!row?.created_at || !row?.id) return null;
  return `${row.created_at}|${row.id}`;
}

function parseSafeBodySummary(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function serializePoisonMessage(row) {
  return {
    id: row.id,
    queueName: row.queue_name,
    messageType: row.message_type || null,
    schemaVersion: row.schema_version || null,
    jobId: row.job_id || null,
    reasonCode: row.reason_code,
    bodySummary: parseSafeBodySummary(row.body_summary),
    correlationId: row.correlation_id || null,
    createdAt: row.created_at,
  };
}

function serializeFailedJobDiagnostic(row) {
  return {
    jobId: row.id,
    status: row.status,
    provider: row.provider,
    model: row.model,
    owner: {
      userId: row.user_id,
      email: row.user_email || null,
    },
    attemptCount: Number(row.attempt_count || 0),
    maxAttempts: Number(row.max_attempts || DEFAULT_MAX_ATTEMPTS),
    providerTaskPresent: !!row.provider_task_id,
    outputPresent: !!row.output_url,
    posterPresent: !!row.poster_url,
    error: {
      code: row.error_code || "video_job_failed",
      message: sanitizePublicError(row.error_message),
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || null,
  };
}

export async function listAdminAiVideoPoisonMessages(env, searchParams = new URLSearchParams()) {
  assertAiVideoInspectionConfig(env);
  const limit = normalizeInspectionLimit(searchParams.get("limit"));
  const cursor = parseInspectionCursor(searchParams.get("cursor"));
  const bindings = [];
  let whereClause = "";
  if (cursor) {
    whereClause = "WHERE created_at < ? OR (created_at = ? AND id < ?)";
    bindings.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  bindings.push(limit + 1);
  const result = await env.DB.prepare(
    `SELECT id, queue_name, message_type, schema_version, job_id, reason_code, body_summary, correlation_id, created_at FROM ai_video_job_poison_messages ${whereClause} ORDER BY created_at DESC, id DESC LIMIT ?`
  ).bind(...bindings).all();
  const rows = Array.isArray(result?.results) ? result.results : [];
  const page = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  return {
    messages: page.map(serializePoisonMessage),
    nextCursor: hasMore ? encodeInspectionCursor(page[page.length - 1]) : null,
  };
}

export async function getAdminAiVideoPoisonMessage(env, poisonId) {
  assertAiVideoInspectionConfig(env);
  const row = await env.DB.prepare(
    "SELECT id, queue_name, message_type, schema_version, job_id, reason_code, body_summary, correlation_id, created_at FROM ai_video_job_poison_messages WHERE id = ?"
  ).bind(poisonId).first();
  return row ? serializePoisonMessage(row) : null;
}

export async function listAdminAiVideoFailedJobs(env, searchParams = new URLSearchParams()) {
  assertAiVideoInspectionConfig(env);
  const limit = normalizeInspectionLimit(searchParams.get("limit"));
  const cursor = parseInspectionCursor(searchParams.get("cursor"));
  const bindings = [];
  let cursorClause = "";
  if (cursor) {
    cursorClause = "AND (ai_video_jobs.created_at < ? OR (ai_video_jobs.created_at = ? AND ai_video_jobs.id < ?))";
    bindings.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  bindings.push(limit + 1);
  const result = await env.DB.prepare(
    `SELECT ai_video_jobs.id AS id, ai_video_jobs.user_id AS user_id, users.email AS user_email, ai_video_jobs.status AS status, ai_video_jobs.provider AS provider, ai_video_jobs.model AS model, ai_video_jobs.provider_task_id AS provider_task_id, ai_video_jobs.attempt_count AS attempt_count, ai_video_jobs.max_attempts AS max_attempts, ai_video_jobs.output_url AS output_url, ai_video_jobs.poster_url AS poster_url, ai_video_jobs.error_code AS error_code, ai_video_jobs.error_message AS error_message, ai_video_jobs.created_at AS created_at, ai_video_jobs.updated_at AS updated_at, ai_video_jobs.completed_at AS completed_at FROM ai_video_jobs LEFT JOIN users ON users.id = ai_video_jobs.user_id WHERE ai_video_jobs.scope = 'admin' AND ai_video_jobs.status = 'failed' ${cursorClause} ORDER BY ai_video_jobs.created_at DESC, ai_video_jobs.id DESC LIMIT ?`
  ).bind(...bindings).all();
  const rows = Array.isArray(result?.results) ? result.results : [];
  const page = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  return {
    jobs: page.map(serializeFailedJobDiagnostic),
    nextCursor: hasMore ? encodeInspectionCursor(page[page.length - 1]) : null,
  };
}

export async function getAdminAiVideoFailedJob(env, jobId) {
  assertAiVideoInspectionConfig(env);
  const row = await env.DB.prepare(
    "SELECT ai_video_jobs.id AS id, ai_video_jobs.user_id AS user_id, users.email AS user_email, ai_video_jobs.status AS status, ai_video_jobs.provider AS provider, ai_video_jobs.model AS model, ai_video_jobs.provider_task_id AS provider_task_id, ai_video_jobs.attempt_count AS attempt_count, ai_video_jobs.max_attempts AS max_attempts, ai_video_jobs.output_url AS output_url, ai_video_jobs.poster_url AS poster_url, ai_video_jobs.error_code AS error_code, ai_video_jobs.error_message AS error_message, ai_video_jobs.created_at AS created_at, ai_video_jobs.updated_at AS updated_at, ai_video_jobs.completed_at AS completed_at FROM ai_video_jobs LEFT JOIN users ON users.id = ai_video_jobs.user_id WHERE ai_video_jobs.id = ? AND ai_video_jobs.scope = 'admin' AND ai_video_jobs.status = 'failed'"
  ).bind(jobId).first();
  return row ? serializeFailedJobDiagnostic(row) : null;
}

async function findIdempotentJob(env, userId, scope, idempotencyKey) {
  if (!idempotencyKey) return null;
  return normalizeJobRow(await env.DB.prepare(
    `SELECT ${JOB_COLUMNS} FROM ai_video_jobs WHERE user_id = ? AND scope = ? AND idempotency_key = ?`
  ).bind(userId, scope, idempotencyKey).first());
}

export async function getAdminAiVideoJob(env, adminUser, jobId) {
  return normalizeJobRow(await env.DB.prepare(
    `SELECT ${JOB_COLUMNS} FROM ai_video_jobs WHERE id = ? AND user_id = ? AND scope = 'admin'`
  ).bind(jobId, adminUser.id).first());
}

export async function getAdminAiVideoJobOutput(env, adminUser, jobId, kind = "output") {
  assertVideoJobConfig(env);
  const job = await getAdminAiVideoJob(env, adminUser, jobId);
  if (!job || job.status !== "succeeded") {
    return { job, object: null, key: null, contentType: null };
  }
  const key = kind === "poster" ? job.poster_r2_key : job.output_r2_key;
  if (!key) {
    return { job, object: null, key: null, contentType: null };
  }
  const object = await env.USER_IMAGES.get(key);
  const contentType =
    (kind === "poster" ? job.poster_content_type : job.output_content_type) ||
    object?.httpMetadata?.contentType ||
    (kind === "poster" ? "image/webp" : "video/mp4");
  return { job, object, key, contentType };
}

async function getQueueJob(env, jobId) {
  return normalizeJobRow(await env.DB.prepare(
    `SELECT ${JOB_WITH_USER_JOIN_COLUMNS} FROM ai_video_jobs INNER JOIN users ON users.id = ai_video_jobs.user_id WHERE ai_video_jobs.id = ?`
  ).bind(jobId).first());
}

async function insertJob(env, job) {
  await env.DB.prepare(
    `INSERT INTO ai_video_jobs (${JOB_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    job.id,
    job.user_id,
    job.scope,
    job.status,
    job.provider,
    job.model,
    job.prompt,
    job.input_json,
    job.request_hash,
    job.provider_task_id,
    job.idempotency_key,
    job.attempt_count,
    job.max_attempts,
    job.next_attempt_at,
    job.locked_until,
    job.output_r2_key,
    job.output_url,
    job.output_content_type,
    job.output_size_bytes,
    job.poster_r2_key,
    job.poster_url,
    job.poster_content_type,
    job.poster_size_bytes,
    job.provider_state,
    job.error_code,
    job.error_message,
    job.created_at,
    job.updated_at,
    job.completed_at,
    job.expires_at
  ).run();
}

async function markJobFailedToEnqueue(env, jobId, error, correlationId) {
  const now = nowIso();
  await env.DB.prepare(
    "UPDATE ai_video_jobs SET status = 'failed', error_code = ?, error_message = ?, updated_at = ?, completed_at = ? WHERE id = ?"
  ).bind(
    "queue_send_failed",
    sanitizePublicError("Video job could not be queued."),
    now,
    now,
    jobId
  ).run();

  logDiagnostic({
    service: "bitbi-auth",
    component: "ai-video-jobs",
    event: "ai_video_job_enqueue_failed",
    level: "error",
    correlationId,
    job_id: jobId,
    ...getErrorFields(error, { includeMessage: false }),
  });
}

export async function createAdminAiVideoJob({ env, adminUser, payload, idempotencyKey, correlationId }) {
  assertVideoJobConfig(env);

  const selection = resolveAdminAiModelSelection("video", {
    preset: payload.preset,
    model: payload.model,
  });
  const modelId = selection.model.id;
  const requestHash = await sha256Hex(stableStringify(payload));
  const inputJson = stableStringify(buildJobStoredInput(payload, modelId));
  const existing = await findIdempotentJob(env, adminUser.id, AI_VIDEO_JOB_SCOPE_ADMIN, idempotencyKey);
  if (existing) {
    if (existing.request_hash !== requestHash) {
      throw new AdminAiValidationError(
        "Idempotency-Key was already used for a different video request.",
        409,
        "idempotency_conflict"
      );
    }
    return { job: existing, existing: true };
  }

  const now = nowIso();
  const job = {
    id: `vidjob_${randomTokenHex(16)}`,
    user_id: adminUser.id,
    scope: AI_VIDEO_JOB_SCOPE_ADMIN,
    status: "queued",
    provider: resolveProvider(modelId),
    model: modelId,
    prompt: typeof payload.prompt === "string" ? payload.prompt : null,
    input_json: inputJson,
    request_hash: requestHash,
    provider_task_id: null,
    idempotency_key: idempotencyKey,
    attempt_count: 0,
    max_attempts: DEFAULT_MAX_ATTEMPTS,
    next_attempt_at: now,
    locked_until: null,
    output_r2_key: null,
    output_url: null,
    output_content_type: null,
    output_size_bytes: null,
    poster_r2_key: null,
    poster_url: null,
    poster_content_type: null,
    poster_size_bytes: null,
    provider_state: null,
    error_code: null,
    error_message: null,
    created_at: now,
    updated_at: now,
    completed_at: null,
    expires_at: addDaysIso(30),
  };

  await insertJob(env, job);

  try {
    await env.AI_VIDEO_JOBS_QUEUE.send(buildQueueMessage(job, correlationId));
  } catch (error) {
    await markJobFailedToEnqueue(env, job.id, error, correlationId);
    throw new WorkerConfigError("AI video job queue is unavailable.", {
      reason: "ai_video_jobs_queue_send_failed",
    });
  }

  logDiagnostic({
    service: "bitbi-auth",
    component: "ai-video-jobs",
    event: "ai_video_job_created",
    level: "info",
    correlationId,
    job_id: job.id,
    admin_user_id: adminUser.id,
    provider: job.provider,
    model: job.model,
    status: job.status,
  });

  logDiagnostic({
    service: "bitbi-auth",
    component: "ai-video-jobs",
    event: "ai_video_job_enqueued",
    level: "info",
    correlationId,
    job_id: job.id,
    provider: job.provider,
    model: job.model,
    status: job.status,
    attempt_count: 0,
  });

  return { job, existing: false };
}

function validateQueueMessage(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw permanentVideoJobError("Queue payload must be an object.", "bad_queue_payload");
  }
  if (body.type !== AI_VIDEO_JOB_QUEUE_TYPE || Number(body.schema_version) !== AI_VIDEO_JOB_QUEUE_SCHEMA_VERSION) {
    throw permanentVideoJobError("Queue payload type or schema version is invalid.", "bad_queue_payload");
  }
  const jobId = typeof body.job_id === "string" ? body.job_id.trim() : "";
  const userId = typeof body.user_id === "string" ? body.user_id.trim() : "";
  if (!jobId || !userId) {
    throw permanentVideoJobError("Queue payload job_id and user_id are required.", "bad_queue_payload");
  }
  return {
    jobId,
    userId,
    attempt: Math.max(1, Number(body.attempt || 1) || 1),
    correlationId: typeof body.correlation_id === "string" ? body.correlation_id : null,
  };
}

function permanentVideoJobError(message, code) {
  const error = new Error(message);
  error.code = code;
  error.permanent = true;
  return error;
}

async function acquireJobLease(env, jobId, now, lockedUntil) {
  const result = await env.DB.prepare(
    "UPDATE ai_video_jobs SET status = 'starting', attempt_count = attempt_count + 1, locked_until = ?, updated_at = ? WHERE id = ? AND status IN ('queued', 'starting', 'provider_pending', 'polling', 'processing', 'ingesting') AND (locked_until IS NULL OR locked_until < ?) AND (next_attempt_at IS NULL OR next_attempt_at <= ?)"
  ).bind(lockedUntil, now, jobId, now, now).run();
  return Number(result?.meta?.changes || 0) > 0;
}

async function updateJobProviderPending(env, jobId, result, now, nextAttemptAt) {
  await env.DB.prepare(
    "UPDATE ai_video_jobs SET status = ?, provider_task_id = COALESCE(?, provider_task_id), provider_state = ?, error_code = NULL, error_message = NULL, next_attempt_at = ?, locked_until = NULL, updated_at = ? WHERE id = ?"
  ).bind(
    result?.providerTaskId ? "provider_pending" : "polling",
    result?.providerTaskId || null,
    result?.providerState || null,
    nextAttemptAt,
    now,
    jobId
  ).run();
}

async function updateJobIngesting(env, jobId, providerState, now) {
  await env.DB.prepare(
    "UPDATE ai_video_jobs SET status = 'ingesting', provider_state = ?, locked_until = NULL, updated_at = ? WHERE id = ?"
  ).bind(providerState || null, now, jobId).run();
}

async function updateJobSucceeded(env, jobId, result, now) {
  await env.DB.prepare(
    "UPDATE ai_video_jobs SET status = 'succeeded', output_r2_key = ?, output_url = ?, output_content_type = ?, output_size_bytes = ?, poster_r2_key = ?, poster_url = ?, poster_content_type = ?, poster_size_bytes = ?, provider_task_id = COALESCE(?, provider_task_id), provider_state = ?, error_code = NULL, error_message = NULL, locked_until = NULL, updated_at = ?, completed_at = ? WHERE id = ?"
  ).bind(
    result?.outputR2Key || null,
    result?.outputUrl || null,
    result?.outputContentType || null,
    result?.outputSizeBytes ?? null,
    result?.posterR2Key || null,
    result?.posterUrl || null,
    result?.posterContentType || null,
    result?.posterSizeBytes ?? null,
    result?.providerTaskId || null,
    result?.providerState || "success",
    now,
    now,
    jobId
  ).run();
}

async function updateJobFailed(env, jobId, code, message, now) {
  await env.DB.prepare(
    "UPDATE ai_video_jobs SET status = 'failed', error_code = ?, error_message = ?, locked_until = NULL, updated_at = ?, completed_at = ? WHERE id = ?"
  ).bind(code, sanitizePublicError(message), now, now, jobId).run();
}

async function updateJobRetry(env, jobId, code, message, now, nextAttemptAt) {
  await env.DB.prepare(
    "UPDATE ai_video_jobs SET status = 'queued', error_code = ?, error_message = ?, next_attempt_at = ?, locked_until = NULL, updated_at = ? WHERE id = ?"
  ).bind(code, sanitizePublicError(message), nextAttemptAt, now, jobId).run();
}

function getResponseCode(body, response) {
  return body?.code || body?.error_code || (response.status >= 500 ? "upstream_error" : "video_job_failed");
}

function shouldRetry(response, job) {
  if (job.attempt_count >= job.max_attempts) return false;
  return RETRYABLE_STATUS_CODES.has(response.status);
}

export function getAiVideoJobRetryDelaySeconds(attempts = 0) {
  const attempt = Math.max(0, Number(attempts) || 0);
  return Math.min(300, Math.max(10, 10 * (2 ** attempt)));
}

function safeQueueBodySummary(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return JSON.stringify({ type: typeof body });
  }
  return JSON.stringify({
    keys: Object.keys(body).slice(0, 12).sort(),
    schema_version: body.schema_version ?? null,
    type: typeof body.type === "string" ? body.type.slice(0, 80) : null,
    job_id_present: typeof body.job_id === "string" && !!body.job_id,
    correlation_id_present: typeof body.correlation_id === "string" && !!body.correlation_id,
  });
}

async function recordAiVideoPoisonMessage(env, body, reasonCode, correlationId = null) {
  try {
    await env.DB.prepare(
      "INSERT INTO ai_video_job_poison_messages (id, queue_name, message_type, schema_version, job_id, reason_code, body_summary, correlation_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      `poison_${randomTokenHex(16)}`,
      AI_VIDEO_JOBS_QUEUE_NAME,
      typeof body?.type === "string" ? body.type.slice(0, 120) : null,
      body?.schema_version == null ? null : String(body.schema_version).slice(0, 40),
      typeof body?.job_id === "string" ? body.job_id.slice(0, 160) : null,
      String(reasonCode || "unknown").slice(0, 120),
      safeQueueBodySummary(body),
      correlationId,
      nowIso()
    ).run();

    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-video-jobs-queue",
      event: "ai_video_job_poison_message_recorded",
      level: "error",
      correlationId,
      reason_code: reasonCode,
    });
  } catch (error) {
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-video-jobs-queue",
      event: "ai_video_job_poison_message_record_failed",
      level: "error",
      correlationId,
      reason_code: reasonCode,
      ...getErrorFields(error, { includeMessage: false }),
    });
  }
}

async function enqueueAiVideoJobFollowup(env, job, correlationId, reason, delaySeconds = 0) {
  const message = buildQueueMessage(job, correlationId, reason);
  await env.AI_VIDEO_JOBS_QUEUE.send(
    message,
    delaySeconds > 0 ? { delaySeconds } : undefined
  );
  logDiagnostic({
    service: "bitbi-auth",
    component: "ai-video-jobs",
    event: reason === "poll" ? "ai_video_job_poll_scheduled" : "ai_video_job_enqueued",
    level: "info",
    correlationId,
    job_id: job.id,
    provider: job.provider,
    model: job.model,
    status: job.status,
    attempt_count: Number(job.attempt_count || 0),
    retry_delay_seconds: delaySeconds,
  });
}

function parseRetryAfterSeconds(result, fallbackSeconds) {
  const raw = Number(result?.retryAfterSeconds);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.min(300, Math.max(5, Math.ceil(raw)));
  }
  return fallbackSeconds;
}

function isPrivateIpv4(hostname) {
  const parts = String(hostname || "").split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => Number(part));
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isUnsafeRemoteHostname(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host.includes(":") && (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:"))) return true;
  return isPrivateIpv4(host);
}

function assertSafeRemoteUrl(value, label) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    const error = new Error(`${label} URL is missing.`);
    error.code = `${label}_url_missing`;
    error.permanent = true;
    throw error;
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    const error = new Error(`${label} URL is invalid.`);
    error.code = `${label}_url_invalid`;
    error.permanent = true;
    throw error;
  }
  if (url.protocol !== "https:" || url.username || url.password || isUnsafeRemoteHostname(url.hostname)) {
    const error = new Error(`${label} URL is not allowed.`);
    error.code = `${label}_url_not_allowed`;
    error.permanent = true;
    throw error;
  }
  return url.href;
}

async function readResponseBodyLimited(response, maxBytes, label) {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    const error = new Error(`${label} exceeds the maximum allowed size.`);
    error.code = `${label}_too_large`;
    error.permanent = true;
    throw error;
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) {
      const error = new Error(`${label} exceeds the maximum allowed size.`);
      error.code = `${label}_too_large`;
      error.permanent = true;
      throw error;
    }
    return buffer;
  }

  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {}
      const error = new Error(`${label} exceeds the maximum allowed size.`);
      error.code = `${label}_too_large`;
      error.permanent = true;
      throw error;
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged.buffer;
}

export async function fetchRemoteAsset(env, urlValue, {
  maxBytes,
  allowedContentTypes,
  label,
}) {
  const url = assertSafeRemoteUrl(urlValue, label);
  const fetcher = env.__TEST_FETCH || globalThis.fetch;
  if (typeof fetcher !== "function") {
    const error = new Error("Fetch is unavailable.");
    error.code = `${label}_fetch_unavailable`;
    throw error;
  }
  const response = await fetcher(url, { method: "GET" });
  if (!response.ok) {
    const error = new Error(`${label} download failed.`);
    error.status = response.status;
    error.code = `${label}_download_failed`;
    throw error;
  }
  const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!allowedContentTypes.has(contentType)) {
    const error = new Error(`${label} content type is not allowed.`);
    error.code = `${label}_content_type_not_allowed`;
    error.permanent = true;
    throw error;
  }
  const body = await readResponseBodyLimited(response, maxBytes, label);
  return {
    body,
    contentType,
    sizeBytes: body.byteLength,
  };
}

function videoOutputKey(jobId, userId) {
  return `users/${userId}/video-jobs/${jobId}/output.mp4`;
}

function videoPosterKey(jobId, userId, contentType) {
  const ext = contentType === "image/png" ? "png" : contentType === "image/jpeg" ? "jpg" : "webp";
  return `users/${userId}/video-jobs/${jobId}/poster.${ext}`;
}

async function ingestProviderVideoOutput(env, job, providerResult) {
  const output = await fetchRemoteAsset(env, providerResult.videoUrl, {
    maxBytes: VIDEO_OUTPUT_MAX_BYTES,
    allowedContentTypes: VIDEO_OUTPUT_CONTENT_TYPES,
    label: "video_output",
  });
  const outputKey = videoOutputKey(job.id, job.user_id);
  await env.USER_IMAGES.put(outputKey, output.body, {
    httpMetadata: { contentType: output.contentType },
  });

  let poster = null;
  if (providerResult.posterUrl) {
    try {
      const posterAsset = await fetchRemoteAsset(env, providerResult.posterUrl, {
        maxBytes: VIDEO_POSTER_MAX_BYTES,
        allowedContentTypes: VIDEO_POSTER_CONTENT_TYPES,
        label: "video_poster",
      });
      const posterKey = videoPosterKey(job.id, job.user_id, posterAsset.contentType);
      await env.USER_IMAGES.put(posterKey, posterAsset.body, {
        httpMetadata: { contentType: posterAsset.contentType },
      });
      poster = {
        key: posterKey,
        url: `/api/admin/ai/video-jobs/${encodeURIComponent(job.id)}/poster`,
        contentType: posterAsset.contentType,
        sizeBytes: posterAsset.sizeBytes,
      };
    } catch (error) {
      logDiagnostic({
        service: "bitbi-auth",
        component: "ai-video-jobs-ingest",
        event: "ai_video_job_poster_ingest_failed",
        level: "warn",
        job_id: job.id,
        ...getErrorFields(error, { includeMessage: false }),
      });
    }
  }

  return {
    outputR2Key: outputKey,
    outputUrl: `/api/admin/ai/video-jobs/${encodeURIComponent(job.id)}/output`,
    outputContentType: output.contentType,
    outputSizeBytes: output.sizeBytes,
    posterR2Key: poster?.key || null,
    posterUrl: poster?.url || null,
    posterContentType: poster?.contentType || null,
    posterSizeBytes: poster?.sizeBytes ?? null,
  };
}

async function callVideoProviderTask(env, path, job, parsedInput, correlationId) {
  const body = {
    ...stripStoredInputMetadata(parsedInput),
  };
  if (job.provider_task_id) {
    body.providerTaskId = job.provider_task_id;
  }
  return proxyToAiLab(
    env,
    path,
    { method: "POST", body },
    {
      id: job.user_id,
      email: job.user_email || "",
    },
    correlationId,
    null
  );
}

function getProviderTaskResult(responseBody) {
  return responseBody?.result && typeof responseBody.result === "object"
    ? responseBody.result
    : null;
}

export async function processAiVideoJobMessage(env, body, { messageAttempts = 0 } = {}) {
  assertVideoJobConfig(env);
  const startedAt = Date.now();
  let payload;
  try {
    payload = validateQueueMessage(body);
  } catch (error) {
    await recordAiVideoPoisonMessage(env, body, error.code || "bad_queue_payload", null);
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-video-jobs-queue",
      event: "ai_video_job_bad_queue_payload",
      level: "error",
      ...getErrorFields(error, { includeMessage: false }),
    });
    return { status: "failed", reason: error.code || "bad_queue_payload" };
  }

  const initialJob = await getQueueJob(env, payload.jobId);
  if (!initialJob) {
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-video-jobs-queue",
      event: "ai_video_job_missing",
      level: "warn",
      correlationId: payload.correlationId,
      job_id: payload.jobId,
    });
    return { status: "noop", reason: "missing_job" };
  }

  if (initialJob.user_id !== payload.userId || TERMINAL_STATUSES.has(initialJob.status)) {
    return { status: "noop", reason: TERMINAL_STATUSES.has(initialJob.status) ? "terminal_job" : "user_mismatch" };
  }

  const now = nowIso();
  const lockedUntil = addMillisecondsIso(JOB_LEASE_MS);
  const acquired = await acquireJobLease(env, initialJob.id, now, lockedUntil);
  if (!acquired) {
    return { status: "noop", reason: "lease_not_acquired" };
  }

  const job = await getQueueJob(env, initialJob.id);
  logDiagnostic({
    service: "bitbi-auth",
    component: "ai-video-jobs-queue",
    event: "ai_video_job_started",
    level: "info",
    correlationId: payload.correlationId,
    job_id: job.id,
    provider: job.provider,
    model: job.model,
    status: job.status,
    attempt_count: job.attempt_count,
  });

  let parsedInput;
  try {
    parsedInput = JSON.parse(job.input_json);
  } catch (error) {
    const failedAt = nowIso();
    await updateJobFailed(env, job.id, "bad_stored_payload", "Stored video request is invalid.", failedAt);
    return { status: "failed", reason: "bad_stored_payload", error };
  }

  const providerPath = job.provider_task_id
    ? "/internal/ai/video-task/poll"
    : "/internal/ai/video-task/create";
  const response = await callVideoProviderTask(env, providerPath, job, parsedInput, payload.correlationId);

  let responseBody = null;
  try {
    responseBody = await response.clone().json();
  } catch {
    responseBody = null;
  }

  const completedAt = nowIso();
  const providerResult = getProviderTaskResult(responseBody);
  if (response.ok && responseBody?.ok && providerResult?.status === "succeeded" && providerResult?.videoUrl) {
    await updateJobIngesting(env, job.id, providerResult.providerState || "success", completedAt);
    let ingested;
    try {
      ingested = await ingestProviderVideoOutput(env, job, providerResult);
    } catch (error) {
      const code = error?.code || "video_output_ingest_failed";
      if (!error?.permanent && job.attempt_count < job.max_attempts) {
        const delaySeconds = getAiVideoJobRetryDelaySeconds(messageAttempts);
        const nextAttemptAt = addMillisecondsIso(delaySeconds * 1000);
        await updateJobRetry(env, job.id, code, "Video output ingest failed.", completedAt, nextAttemptAt);
        return { status: "retry", jobId: job.id, delaySeconds, reason: code };
      }
      await updateJobFailed(env, job.id, code, "Video output ingest failed.", completedAt);
      return { status: "failed", jobId: job.id, reason: code };
    }

    await updateJobSucceeded(env, job.id, {
      ...ingested,
      providerTaskId: providerResult.providerTaskId || job.provider_task_id || null,
      providerState: providerResult.providerState || "success",
    }, nowIso());
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-video-jobs-queue",
      event: "ai_video_job_succeeded",
      level: "info",
      correlationId: payload.correlationId,
      job_id: job.id,
      provider: job.provider,
      model: job.model,
      status: "succeeded",
      attempt_count: job.attempt_count,
      duration_ms: getDurationMs(startedAt),
    });
    return { status: "succeeded", jobId: job.id };
  }

  if (response.ok && responseBody?.ok && providerResult?.status === "failed") {
    await updateJobFailed(env, job.id, "provider_failed", "Video provider reported failure.", completedAt);
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-video-jobs-queue",
      event: "ai_video_job_failed",
      level: "error",
      correlationId: payload.correlationId,
      job_id: job.id,
      provider: job.provider,
      model: job.model,
      status: "failed",
      attempt_count: job.attempt_count,
      error_code: "provider_failed",
      duration_ms: getDurationMs(startedAt),
    });
    return { status: "failed", jobId: job.id, reason: "provider_failed" };
  }

  if (response.ok && responseBody?.ok && providerResult?.status === "provider_pending") {
    const delaySeconds = parseRetryAfterSeconds(providerResult, getAiVideoJobRetryDelaySeconds(messageAttempts));
    const nextAttemptAt = addMillisecondsIso(delaySeconds * 1000);
    if (job.attempt_count >= job.max_attempts) {
      await updateJobFailed(
        env,
        job.id,
        "max_attempts_exhausted",
        "Video provider task did not complete before the retry limit.",
        completedAt
      );
      await recordAiVideoPoisonMessage(env, body, "max_attempts_exhausted", payload.correlationId);
      logDiagnostic({
        service: "bitbi-auth",
        component: "ai-video-jobs-queue",
        event: "ai_video_job_failed",
        level: "error",
        correlationId: payload.correlationId,
        job_id: job.id,
        provider: job.provider,
        model: job.model,
        status: "failed",
        attempt_count: job.attempt_count,
        error_code: "max_attempts_exhausted",
        duration_ms: getDurationMs(startedAt),
      });
      return { status: "failed", jobId: job.id, reason: "max_attempts_exhausted" };
    }
    await updateJobProviderPending(env, job.id, providerResult, completedAt, nextAttemptAt);
    try {
      await enqueueAiVideoJobFollowup(env, {
        ...job,
        status: "provider_pending",
        provider_task_id: providerResult.providerTaskId || job.provider_task_id || null,
      }, payload.correlationId, "poll", delaySeconds);
    } catch (error) {
      await updateJobRetry(env, job.id, "queue_send_failed", "Video polling could not be queued.", completedAt, nextAttemptAt);
      return { status: "retry", jobId: job.id, delaySeconds, reason: "queue_send_failed" };
    }
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-video-jobs-queue",
      event: "ai_video_job_poll_result",
      level: "info",
      correlationId: payload.correlationId,
      job_id: job.id,
      provider: job.provider,
      model: job.model,
      status: "provider_pending",
      attempt_count: job.attempt_count,
      retry_delay_seconds: delaySeconds,
      duration_ms: getDurationMs(startedAt),
    });
    return { status: "scheduled", jobId: job.id, delaySeconds, reason: "provider_pending" };
  }

  const code = getResponseCode(responseBody, response);
  const publicMessage = responseBody?.error || "Video provider request failed.";
  if (shouldRetry(response, job)) {
    const delaySeconds = getAiVideoJobRetryDelaySeconds(messageAttempts);
    const nextAttemptAt = addMillisecondsIso(delaySeconds * 1000);
    await updateJobRetry(env, job.id, code, publicMessage, completedAt, nextAttemptAt);
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-video-jobs-queue",
      event: "ai_video_job_retried",
      level: "warn",
      correlationId: payload.correlationId,
      job_id: job.id,
      provider: job.provider,
      model: job.model,
      status: "queued",
      attempt_count: job.attempt_count,
      retry_delay_seconds: delaySeconds,
      error_code: code,
      duration_ms: getDurationMs(startedAt),
    });
    return { status: "retry", jobId: job.id, delaySeconds, reason: code };
  }

  await updateJobFailed(env, job.id, code, publicMessage, completedAt);
  if (job.attempt_count >= job.max_attempts) {
    await recordAiVideoPoisonMessage(env, body, "max_attempts_exhausted", payload.correlationId);
  }
  logDiagnostic({
    service: "bitbi-auth",
    component: "ai-video-jobs-queue",
    event: "ai_video_job_failed",
    level: "error",
    correlationId: payload.correlationId,
    job_id: job.id,
    provider: job.provider,
    model: job.model,
    status: "failed",
    attempt_count: job.attempt_count,
    error_code: code,
    duration_ms: getDurationMs(startedAt),
  });
  return { status: "failed", jobId: job.id, reason: code };
}
