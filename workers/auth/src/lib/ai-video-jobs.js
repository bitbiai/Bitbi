import {
  ADMIN_AI_VIDEO_MODEL_ID,
  ADMIN_AI_VIDEO_VIDU_Q3_PRO_MODEL_ID,
  AdminAiValidationError,
  resolveAdminAiModelSelection,
} from "../../../../js/shared/admin-ai-contract.mjs";
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

export function normalizeAiVideoIdempotencyKey(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
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
  if (modelId === ADMIN_AI_VIDEO_MODEL_ID) return "workers-ai";
  return "unknown";
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

  if (job.status === "failed") {
    serialized.error = {
      code: job.error_code || "video_job_failed",
      message: sanitizePublicError(job.error_message),
    };
  }

  return serialized;
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

async function getQueueJob(env, jobId) {
  return normalizeJobRow(await env.DB.prepare(
    `SELECT ${JOB_WITH_USER_JOIN_COLUMNS} FROM ai_video_jobs INNER JOIN users ON users.id = ai_video_jobs.user_id WHERE ai_video_jobs.id = ?`
  ).bind(jobId).first());
}

async function insertJob(env, job) {
  await env.DB.prepare(
    `INSERT INTO ai_video_jobs (${JOB_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
  const inputJson = stableStringify(payload);
  const requestHash = await sha256Hex(inputJson);
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
    "UPDATE ai_video_jobs SET status = 'starting', attempt_count = attempt_count + 1, locked_until = ?, updated_at = ? WHERE id = ? AND status IN ('queued', 'starting', 'provider_pending', 'processing') AND (locked_until IS NULL OR locked_until < ?) AND (next_attempt_at IS NULL OR next_attempt_at <= ?)"
  ).bind(lockedUntil, now, jobId, now, now).run();
  return Number(result?.meta?.changes || 0) > 0;
}

async function updateJobSucceeded(env, jobId, result, now) {
  await env.DB.prepare(
    "UPDATE ai_video_jobs SET status = 'succeeded', output_url = ?, error_code = NULL, error_message = NULL, locked_until = NULL, updated_at = ?, completed_at = ? WHERE id = ?"
  ).bind(result?.videoUrl || null, now, now, jobId).run();
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

export async function processAiVideoJobMessage(env, body, { messageAttempts = 0 } = {}) {
  const startedAt = Date.now();
  let payload;
  try {
    payload = validateQueueMessage(body);
  } catch (error) {
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

  const adminUser = {
    id: job.user_id,
    email: job.user_email || "",
  };
  const response = await proxyToAiLab(
    env,
    "/internal/ai/test-video",
    { method: "POST", body: parsedInput },
    adminUser,
    payload.correlationId,
    null
  );

  let responseBody = null;
  try {
    responseBody = await response.clone().json();
  } catch {
    responseBody = null;
  }

  const completedAt = nowIso();
  if (response.ok && responseBody?.ok && responseBody?.result?.videoUrl) {
    await updateJobSucceeded(env, job.id, responseBody.result, completedAt);
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
