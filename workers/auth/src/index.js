import { json } from "./lib/response.js";
import { nowIso } from "./lib/tokens.js";
import {
  getDurationMs,
  getCorrelationId,
  getErrorFields,
  logDiagnostic,
} from "../../../js/shared/worker-observability.mjs";
import { handleHealth } from "./routes/health.js";
import { handleMe, handleRegister, handleLogin, handleLogout } from "./routes/auth.js";
import { handleForgotPassword, handleValidateReset, handleResetPassword } from "./routes/password.js";
import { handleVerifyEmail, handleResendVerification, handleRequestReverification } from "./routes/verification.js";
import { handleAdmin } from "./routes/admin.js";
import { handleMedia } from "./routes/media.js";
import { handleAI } from "./routes/ai.js";
import { handleGallery } from "./routes/gallery.js";
import { handleVideoGallery } from "./routes/video-gallery.js";
import { handleGetProfile, handleUpdateProfile } from "./routes/profile.js";
import { handleGetAvatar, handleUploadAvatar, handleDeleteAvatar } from "./routes/avatar.js";
import { handleFavorites } from "./routes/favorites.js";
import {
  handleWalletSiweNonce,
  handleWalletSiweVerify,
  handleWalletStatus,
  handleWalletUnlink,
} from "./routes/wallet.js";
import {
  AI_IMAGE_DERIVATIVE_RECOVERY_REENQUEUE_COOLDOWN_MS,
  AI_IMAGE_DERIVATIVE_VERSION,
  enqueueAiImageDerivativeJob,
  getAiImageDerivativeRetryDelaySeconds,
  listAiImagesNeedingDerivativeWork,
  processAiImageDerivativeMessage,
} from "./lib/ai-image-derivatives.js";
import {
  ACTIVITY_INGEST_QUEUE_NAME,
} from "./lib/activity.js";
import {
  isLikelyActivityIngestMessage,
  processActivityIngestQueueBatch,
} from "./lib/activity-ingestion.js";
import {
  AI_GENERATED_TEMP_OBJECT_PREFIX,
  isAiGeneratedTempObjectExpired,
} from "./routes/ai/generated-image-save-reference.js";
import { archiveColdActivityLogs } from "./lib/activity-archive.js";
import {
  assertSharedRateLimitInfraReady,
  isProductionEnvironment,
} from "./lib/rate-limit.js";
import {
  assertAuthCoreConfig,
  logWorkerConfigFailure,
  workerConfigUnavailableResponse,
  WorkerConfigError,
} from "./lib/config.js";
import {
  AI_VIDEO_JOBS_QUEUE_NAME,
  getAiVideoJobRetryDelaySeconds,
  processAiVideoJobMessage,
} from "./lib/ai-video-jobs.js";
import { getRoutePolicy } from "./app/route-policy.js";
export { AuthPublicRateLimiterDurableObject } from "./lib/public-rate-limiter-do.js";

const AI_IMAGE_DERIVATIVES_QUEUE_NAME = "bitbi-ai-image-derivatives";

function getAllowedOrigins(env) {
  const base = env.APP_BASE_URL || "https://bitbi.ai";
  try {
    return [new URL(base).origin];
  } catch {
    return ["https://bitbi.ai"];
  }
}

function requiresTrustedRequestContext(pathname, method) {
  if (pathname === "/api/verify-email" && method === "GET") {
    return false;
  }
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

function hasAllowedReferer(request, allowedOrigins) {
  const referer = request.headers.get("Referer");
  if (!referer) return false;
  try {
    return allowedOrigins.includes(new URL(referer).origin);
  } catch {
    return false;
  }
}

async function cleanupExpiredGeneratedImageTemps(env) {
  const listed = await env.USER_IMAGES.list({
    prefix: AI_GENERATED_TEMP_OBJECT_PREFIX,
    limit: 1000,
  });
  const objects = Array.isArray(listed?.objects) ? listed.objects : [];
  if (objects.length === 0) {
    return { scannedCount: 0, deletedCount: 0, failedCount: 0 };
  }

  const now = Date.now();
  let deletedCount = 0;
  let failedCount = 0;

  for (const object of objects) {
    if (!isAiGeneratedTempObjectExpired(object?.uploaded, now)) {
      continue;
    }
    try {
      await env.USER_IMAGES.delete(object.key);
      deletedCount += 1;
    } catch {
      failedCount += 1;
    }
  }

  return {
    scannedCount: objects.length,
    deletedCount,
    failedCount,
  };
}

export default {
  async fetch(request, env, execCtx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;
    const isSecure = url.protocol === "https:";
    const ctx = {
      request,
      env,
      url,
      pathname,
      method,
      isSecure,
      execCtx,
      correlationId: getCorrelationId(request),
      routePolicy: getRoutePolicy(method, pathname),
    };

    try {
      assertAuthCoreConfig(env);
    } catch (error) {
      if (error instanceof WorkerConfigError) {
        logWorkerConfigFailure({
          env,
          error,
          correlationId: ctx.correlationId,
          requestInfo: { request, pathname, method },
          component: "auth-config",
        });
        return workerConfigUnavailableResponse(ctx.correlationId);
      }
      throw error;
    }

    // Require a same-origin browser context for state-changing requests.
    // Email verification is exempt because it is intentionally opened from inbox links.
    if (requiresTrustedRequestContext(pathname, method)) {
      const allowedOrigins = getAllowedOrigins(env);
      const origin = request.headers.get("Origin");
      if (origin) {
        if (!allowedOrigins.includes(origin)) {
          return json({ ok: false, error: "Forbidden" }, { status: 403 });
        }
      } else if (!hasAllowedReferer(request, allowedOrigins)) {
        return json({ ok: false, error: "Forbidden" }, { status: 403 });
      }
    }

    if (pathname === "/api/health" && method === "GET") return handleHealth();
    if (pathname === "/api/me" && method === "GET") return handleMe(ctx);
    // route-policy: auth.register
    if (pathname === "/api/register" && method === "POST") return handleRegister(ctx);
    // route-policy: auth.login
    if (pathname === "/api/login" && method === "POST") return handleLogin(ctx);
    // route-policy: auth.logout
    if (pathname === "/api/logout" && method === "POST") return handleLogout(ctx);
    if (pathname === "/api/wallet/status" && method === "GET") return handleWalletStatus(ctx);
    // route-policy: wallet.siwe.nonce
    if (pathname === "/api/wallet/siwe/nonce" && method === "POST") return handleWalletSiweNonce(ctx);
    // route-policy: wallet.siwe.verify
    if (pathname === "/api/wallet/siwe/verify" && method === "POST") return handleWalletSiweVerify(ctx);
    // route-policy: wallet.unlink
    if (pathname === "/api/wallet/unlink" && method === "POST") return handleWalletUnlink(ctx);

    // Profile
    if (pathname === "/api/profile" && method === "GET") return handleGetProfile(ctx);
    // route-policy: profile.update
    if (pathname === "/api/profile" && method === "PATCH") return handleUpdateProfile(ctx);

    // Avatar
    if (pathname === "/api/profile/avatar" && method === "GET") return handleGetAvatar(ctx);
    // route-policy: profile.avatar.upload
    if (pathname === "/api/profile/avatar" && method === "POST") return handleUploadAvatar(ctx);
    // route-policy: profile.avatar.delete
    if (pathname === "/api/profile/avatar" && method === "DELETE") return handleDeleteAvatar(ctx);

    // Favorites
    if (pathname === "/api/favorites") {
      const result = await handleFavorites(ctx);
      if (result) return result;
    }

    // Admin routes
    if (pathname.startsWith("/api/admin/")) {
      const result = await handleAdmin(ctx);
      if (result) return result;
    }

    // Password reset
    // route-policy: password.forgot
    if (pathname === "/api/forgot-password" && method === "POST") return handleForgotPassword(ctx);
    if (pathname === "/api/reset-password/validate" && method === "GET") return handleValidateReset(ctx);
    // route-policy: password.reset
    if (pathname === "/api/reset-password" && method === "POST") return handleResetPassword(ctx);

    // Email verification
    if (pathname === "/api/verify-email" && method === "GET") return handleVerifyEmail(ctx);
    // route-policy: verification.resend
    if (pathname === "/api/resend-verification" && method === "POST") return handleResendVerification(ctx);
    // route-policy: verification.request-reverification
    if (pathname === "/api/request-reverification" && method === "POST") return handleRequestReverification(ctx);

    // AI Image Studio
    if (pathname.startsWith("/api/ai/")) {
      const result = await handleAI(ctx);
      if (result) return result;
    }

    // Public gallery
    if (pathname.startsWith("/api/gallery/")) {
      const result = await handleGallery(ctx);
      if (result) return result;
      const videoResult = await handleVideoGallery(ctx);
      if (videoResult) return videoResult;
    }

    // Protected media
    if (
      (pathname.startsWith("/api/thumbnails/") ||
        pathname.startsWith("/api/images/") ||
        pathname.startsWith("/api/music/") ||
        pathname.startsWith("/api/soundlab-thumbs/")) &&
      method === "GET"
    ) {
      const result = await handleMedia(ctx);
      if (result) return result;
    }

    return json(
      {
        ok: false,
        error: "Not found",
      },
      { status: 404 }
    );
  },

  async scheduled(event, env, ctx) {
    const now = nowIso();
    const dayStart = now.slice(0, 10) + "T00:00:00.000Z";
    await env.DB.batch([
      env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
      env.DB.prepare("DELETE FROM password_reset_tokens WHERE used_at IS NOT NULL OR expires_at < ?").bind(now),
      env.DB.prepare("DELETE FROM email_verification_tokens WHERE used_at IS NOT NULL OR expires_at < ?").bind(now),
    ]);

    try {
      await env.DB.prepare(
        "DELETE FROM siwe_challenges WHERE used_at IS NOT NULL OR expires_at < ?"
      ).bind(now).run();
    } catch (e) {
      if (!String(e).includes("no such table")) {
        throw e;
      }
    }

    try {
      await env.DB.prepare(
        "DELETE FROM ai_daily_quota_usage WHERE day_start < ? OR (status = 'reserved' AND expires_at < ?)"
      ).bind(dayStart, now).run();
    } catch (e) {
      if (!String(e).includes("no such table")) {
        throw e;
      }
    }

    try {
      const tempCleanup = await cleanupExpiredGeneratedImageTemps(env);
      if (tempCleanup.deletedCount > 0 || tempCleanup.failedCount > 0) {
        logDiagnostic({
          service: "bitbi-auth",
          component: "scheduled-ai-generated-temp-cleanup",
          event: "ai_generated_temp_cleanup_completed",
          level: tempCleanup.failedCount > 0 ? "warn" : "info",
          scanned_count: tempCleanup.scannedCount,
          deleted_count: tempCleanup.deletedCount,
          failed_count: tempCleanup.failedCount,
        });
      }
    } catch (error) {
      logDiagnostic({
        service: "bitbi-auth",
        component: "scheduled-ai-generated-temp-cleanup",
        event: "ai_generated_temp_cleanup_failed",
        level: "error",
        ...getErrorFields(error),
      });
    }

    try {
      await archiveColdActivityLogs(env, { nowIso: now });
    } catch (error) {
      logDiagnostic({
        service: "bitbi-auth",
        component: "scheduled-activity-archive",
        event: "activity_archive_run_failed",
        level: "error",
        ...getErrorFields(error),
      });
      throw error;
    }

    if (isProductionEnvironment(env)) {
      await assertSharedRateLimitInfraReady(env, {
        component: "scheduled-rate-limit-cleanup",
      });
    }
    try {
      await env.DB.prepare(
        "DELETE FROM rate_limit_counters WHERE expires_at < ?"
      ).bind(now).run();
    } catch (e) {
      if (!String(e).includes("no such table") || isProductionEnvironment(env)) {
        throw e;
      }
    }

    // Process R2 cleanup queue — retry failed blob deletions.
    // Wrapped in try/catch so the worker is safe to deploy before migration 0010.
    try {
      const pending = await env.DB.prepare(
        "SELECT id, r2_key FROM r2_cleanup_queue WHERE status = 'pending' AND attempts < 5 ORDER BY created_at ASC LIMIT 50"
      ).all();

      const stmts = [];

      if (pending.results && pending.results.length > 0) {
        const succeeded = [];
        const retried = [];
        for (const row of pending.results) {
          try {
            await env.USER_IMAGES.delete(row.r2_key);
            succeeded.push(row.id);
          } catch {
            retried.push(row.id);
          }
        }
        if (succeeded.length > 0) {
          const ph = succeeded.map(() => "?").join(",");
          stmts.push(env.DB.prepare(`DELETE FROM r2_cleanup_queue WHERE id IN (${ph})`).bind(...succeeded));
        }
        if (retried.length > 0) {
          const ph = retried.map(() => "?").join(",");
          stmts.push(env.DB.prepare(
            `UPDATE r2_cleanup_queue SET attempts = attempts + 1, last_attempt_at = ? WHERE id IN (${ph})`
          ).bind(now, ...retried));
        }
      }

      // Dead-letter entries only after actual retry exhaustion — never based
      // on raw age alone, so backlog/delayed crons cannot abandon untried jobs.
      const exhausted = await env.DB.prepare(
        "SELECT id, r2_key, attempts FROM r2_cleanup_queue WHERE status = 'pending' AND attempts >= 5 AND last_attempt_at IS NOT NULL"
      ).all();
      if (exhausted.results && exhausted.results.length > 0) {
        for (const row of exhausted.results) {
          logDiagnostic({
            service: "bitbi-auth",
            component: "scheduled-r2-cleanup",
            event: "r2_cleanup_dead_lettered",
            level: "error",
            r2_key: row.r2_key,
            attempts: row.attempts,
          });
        }
        const ph = exhausted.results.map(() => "?").join(",");
        stmts.push(env.DB.prepare(
          `UPDATE r2_cleanup_queue SET status = 'dead', last_attempt_at = ? WHERE id IN (${ph})`
        ).bind(now, ...exhausted.results.map(r => r.id)));
      }

      if (stmts.length > 0) await env.DB.batch(stmts);
    } catch (e) {
      // Table may not exist yet if migration 0010 hasn't been applied — skip cleanly
      if (!String(e).includes("no such table")) throw e;
    }

    // Re-enqueue a small derivative backlog so pending rows recover from
    // transient publish/consumer failures without operator intervention.
    const derivativeRecoveryStartedAt = Date.now();
    try {
      const page = await listAiImagesNeedingDerivativeWork(env, {
        limit: 25,
        includeFailed: false,
        attemptedBefore: new Date(
          Date.now() - AI_IMAGE_DERIVATIVE_RECOVERY_REENQUEUE_COOLDOWN_MS
        ).toISOString(),
        targetVersion: AI_IMAGE_DERIVATIVE_VERSION,
      });
      let enqueued = 0;
      for (const row of page.rows) {
        await enqueueAiImageDerivativeJob(env, {
          imageId: row.id,
          userId: row.user_id,
          originalKey: row.r2_key,
          derivativesVersion: AI_IMAGE_DERIVATIVE_VERSION,
          trigger: "scheduled",
        });
        enqueued += 1;
      }
      if (enqueued > 0) {
        logDiagnostic({
          service: "bitbi-auth",
          component: "scheduled-derivatives",
          event: "ai_derivative_recovery_enqueued",
          queued: enqueued,
          derivatives_version: AI_IMAGE_DERIVATIVE_VERSION,
          has_more: page.hasMore,
          duration_ms: getDurationMs(derivativeRecoveryStartedAt),
        });
      }
    } catch (e) {
      if (
        String(e).includes("no such table") ||
        String(e).includes("no such column") ||
        String(e).includes("queue binding is unavailable")
      ) {
        logDiagnostic({
          service: "bitbi-auth",
          component: "scheduled-derivatives",
          event: "ai_derivative_recovery_skipped",
          level: "warn",
          duration_ms: getDurationMs(derivativeRecoveryStartedAt),
          ...getErrorFields(e),
        });
      } else {
        logDiagnostic({
          service: "bitbi-auth",
          component: "scheduled-derivatives",
          event: "ai_derivative_recovery_failed",
          level: "error",
          duration_ms: getDurationMs(derivativeRecoveryStartedAt),
          ...getErrorFields(e),
        });
      }
    }
  },

  async queue(batch, env, ctx) {
    const queueName = typeof batch?.queue === "string" ? batch.queue : null;
    const messages = Array.isArray(batch?.messages) ? batch.messages : [];
    const isActivityBatch =
      queueName === ACTIVITY_INGEST_QUEUE_NAME ||
      messages.every((message) => isLikelyActivityIngestMessage(message?.body));
    if (isActivityBatch) {
      await processActivityIngestQueueBatch(batch, env);
      return;
    }

    const isAiDerivativeBatch =
      queueName === AI_IMAGE_DERIVATIVES_QUEUE_NAME ||
      messages.every((message) => message?.body?.type === "ai_image_derivative.generate");
    const isAiVideoBatch =
      queueName === AI_VIDEO_JOBS_QUEUE_NAME ||
      messages.every((message) => message?.body?.type === "ai_video_job.process");
    if (isAiVideoBatch) {
      for (const message of batch.messages) {
        const startedAt = Date.now();
        const rawBody = message?.body && typeof message.body === "object" ? message.body : {};
        const jobId = rawBody.job_id || "unknown";
        const attempts = message.attempts ?? 0;
        const correlationId = rawBody.correlation_id || null;

        try {
          const result = await processAiVideoJobMessage(env, message.body, { messageAttempts: attempts });
          if (result.status === "retry") {
            message.retry({ delaySeconds: result.delaySeconds || getAiVideoJobRetryDelaySeconds(attempts) });
          } else {
            message.ack();
          }
        } catch (error) {
          logDiagnostic({
            service: "bitbi-auth",
            component: "ai-video-jobs-queue",
            event: "ai_video_job_consumer_retry",
            level: "error",
            correlationId,
            job_id: jobId,
            attempts,
            retry_delay_seconds: getAiVideoJobRetryDelaySeconds(attempts),
            duration_ms: getDurationMs(startedAt),
            ...getErrorFields(error),
          });
          message.retry({ delaySeconds: getAiVideoJobRetryDelaySeconds(attempts) });
        }
      }
      return;
    }
    if (!isAiDerivativeBatch) {
      logDiagnostic({
        service: "bitbi-auth",
        component: "queue",
        event: "queue_batch_unrecognized",
        level: "error",
        queue: queueName,
        batch_size: messages.length,
      });
      for (const message of messages) {
        message.ack();
      }
      return;
    }

    for (const message of batch.messages) {
      const startedAt = Date.now();
      const rawBody = message?.body && typeof message.body === "object" ? message.body : {};
      const imageId = rawBody.image_id || "unknown";
      const version = rawBody.derivatives_version || "unknown";
      const attempts = message.attempts ?? 0;
      const correlationId = rawBody.correlation_id || null;
      // Must stay in sync with queues.consumers[0].max_retries in wrangler.jsonc (currently 8).
      const isLastAttempt = attempts >= 7;

      try {
        const result = await processAiImageDerivativeMessage(env, message.body, { isLastAttempt });
        if (result.status === "noop" && (result.reason === "already_processing" || result.reason === "lease_not_acquired")) {
          logDiagnostic({
            service: "bitbi-auth",
            component: "ai-image-derivatives-queue",
            event: "ai_derivative_consumer_skipped",
            level: "info",
            correlationId,
            image_id: result.payload.imageId,
            user_id: result.payload.userId,
            derivatives_version: result.payload.derivativesVersion,
            reason: result.reason,
            attempts,
            duration_ms: result.durationMs ?? getDurationMs(startedAt),
          });
        }
        if (result.status === "failed") {
          logDiagnostic({
            service: "bitbi-auth",
            component: "ai-image-derivatives-queue",
            event: "ai_derivative_consumer_failed",
            level: "error",
            correlationId,
            image_id: result.payload.imageId,
            user_id: result.payload.userId,
            derivatives_version: result.payload.derivativesVersion,
            reason: result.reason,
            attempts,
            duration_ms: result.durationMs ?? getDurationMs(startedAt),
            ...getErrorFields(result.error),
          });
        }
        message.ack();
      } catch (error) {
        logDiagnostic({
          service: "bitbi-auth",
          component: "ai-image-derivatives-queue",
          event: "ai_derivative_consumer_retry",
          level: "error",
          correlationId,
          image_id: imageId,
          derivatives_version: version,
          attempts,
          retry_delay_seconds: getAiImageDerivativeRetryDelaySeconds(attempts),
          duration_ms: getDurationMs(startedAt),
          ...getErrorFields(error),
        });
        message.retry({ delaySeconds: getAiImageDerivativeRetryDelaySeconds(attempts) });
      }
    }
  },
};
