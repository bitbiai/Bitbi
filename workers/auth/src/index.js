import { json } from "./lib/response.js";
import { nowIso } from "./lib/tokens.js";
import { handleHealth } from "./routes/health.js";
import { handleMe, handleRegister, handleLogin, handleLogout } from "./routes/auth.js";
import { handleForgotPassword, handleValidateReset, handleResetPassword } from "./routes/password.js";
import { handleVerifyEmail, handleResendVerification, handleRequestReverification } from "./routes/verification.js";
import { handleAdmin } from "./routes/admin.js";
import { handleMedia } from "./routes/media.js";
import { handleAI } from "./routes/ai.js";
import { handleGetProfile, handleUpdateProfile } from "./routes/profile.js";
import { handleGetAvatar, handleUploadAvatar, handleDeleteAvatar } from "./routes/avatar.js";
import { handleFavorites } from "./routes/favorites.js";

function getAllowedOrigins(env) {
  const base = env.APP_BASE_URL || "https://bitbi.ai";
  try {
    return [new URL(base).origin];
  } catch {
    return ["https://bitbi.ai"];
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;
    const isSecure = url.protocol === "https:";
    const ctx = { request, env, url, pathname, method, isSecure };

    // Origin validation for state-changing requests (CSRF defense-in-depth)
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      const origin = request.headers.get("Origin");
      if (origin && !getAllowedOrigins(env).includes(origin)) {
        return json({ ok: false, error: "Forbidden" }, { status: 403 });
      }
    }

    if (pathname === "/api/health" && method === "GET") return handleHealth();
    if (pathname === "/api/me" && method === "GET") return handleMe(ctx);
    if (pathname === "/api/register" && method === "POST") return handleRegister(ctx);
    if (pathname === "/api/login" && method === "POST") return handleLogin(ctx);
    if (pathname === "/api/logout" && method === "POST") return handleLogout(ctx);

    // Profile
    if (pathname === "/api/profile" && method === "GET") return handleGetProfile(ctx);
    if (pathname === "/api/profile" && method === "PATCH") return handleUpdateProfile(ctx);

    // Avatar
    if (pathname === "/api/profile/avatar" && method === "GET") return handleGetAvatar(ctx);
    if (pathname === "/api/profile/avatar" && method === "POST") return handleUploadAvatar(ctx);
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
    if (pathname === "/api/forgot-password" && method === "POST") return handleForgotPassword(ctx);
    if (pathname === "/api/reset-password/validate" && method === "GET") return handleValidateReset(ctx);
    if (pathname === "/api/reset-password" && method === "POST") return handleResetPassword(ctx);

    // Email verification
    if (pathname === "/api/verify-email" && method === "GET") return handleVerifyEmail(ctx);
    if (pathname === "/api/resend-verification" && method === "POST") return handleResendVerification(ctx);
    if (pathname === "/api/request-reverification" && method === "POST") return handleRequestReverification(ctx);

    // AI Image Studio
    if (pathname.startsWith("/api/ai/")) {
      const result = await handleAI(ctx);
      if (result) return result;
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
    await env.DB.batch([
      env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
      env.DB.prepare("DELETE FROM password_reset_tokens WHERE used_at IS NOT NULL OR expires_at < ?").bind(now),
      env.DB.prepare("DELETE FROM email_verification_tokens WHERE used_at IS NOT NULL OR expires_at < ?").bind(now),
    ]);

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
          console.error(`R2 cleanup dead-lettered: r2_key=${row.r2_key}, attempts=${row.attempts}`);
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
  },
};
