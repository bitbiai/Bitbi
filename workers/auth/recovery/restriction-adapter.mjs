// EXTERNAL DRAFT ONLY. Not an authorization to deploy or pause traffic.
// Admission at actual fetch/scheduled/queue hooks; no changed auth implementation.
// Profile is fixed by the built entry; request headers and env cannot enable it.
const RECOVERY_ROUTES = new Set([
  "GET /api/health",
  "POST /api/login",
  "POST /api/logout",
  "GET /api/admin/mfa/status",
  "POST /api/admin/mfa/verify",
  "GET /api/admin/me",
  "GET /api/admin/readiness/status",
  "GET /api/admin/registration/status",
]);
export const restrictedRecoveryRoutes = Object.freeze([...RECOVERY_ROUTES]);

function unavailable(profile) {
  return new Response(JSON.stringify({
    ok: false,
    code: "release_access_restricted",
    error: "The service is temporarily restricted for a controlled release. No operation was started by this entry.",
    profile,
  }), { status: 503, headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  } });
}

function entry(worker, profile) {
  if (!worker || typeof worker.fetch !== "function" || typeof worker.queue !== "function" || typeof worker.scheduled !== "function") {
    throw new TypeError("The verified complete Auth worker entry is required.");
  }
  return Object.freeze({
    async fetch(request, env, ctx) {
      const route = `${request.method.toUpperCase()} ${new URL(request.url).pathname}`;
      if (profile === "c-restricted" && RECOVERY_ROUTES.has(route)) {
        // The actual entry retains CSRF, configuration checks, session, MFA CAS,
        // rate limiting and all response cookies. No response reconstruction.
        return worker.fetch(request, env, ctx);
      }
      return unavailable(profile);
    },
    async scheduled(event, _env, _ctx) {
      // Deliberately start no catch-up, provider dispatch, cleanup or archive.
      // This log confirms this invocation only, never that old invocations ended.
      console.warn(JSON.stringify({ event: "q2_release_scheduled_suppressed", profile, cron: String(event?.cron || "unknown") }));
    },
    async queue(batch, _env, _ctx) {
      // EMERGENCY FALLBACK ONLY. Delivery must already be suspended/retained by
      // an approved platform operation. retryAll consumes the queue retry budget;
      // it is not indefinite parking and must not be treated as drain evidence.
      // Never return normally without marking the batch for retry (auto-ack).
      if (!batch || typeof batch.retryAll !== "function") {
        throw new TypeError("Unexpected queue delivery during release restriction.");
      }
      batch.retryAll();
      console.error(JSON.stringify({ event: "q2_release_unexpected_queue_delivery", profile, queue: String(batch.queue || "unknown"), messageCount: batch.messages?.length ?? null }));
    },
  });
}

// Pre-migration admission stop. Does not access DB or R2, but importing an A
// artifact still requires separately verified complete bytes/exports/closure.
export const createQuiescenceEntry = worker => entry(worker, "bridge");
// POST-0082/0083 only. It is C with restricted functionality, never old artifact A.
export const createRestrictedRecoveryEntry = worker => entry(worker, "c-restricted");
