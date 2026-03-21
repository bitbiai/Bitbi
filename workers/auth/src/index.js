import { json } from "./lib/response.js";
import { nowIso } from "./lib/tokens.js";
import { handleHealth } from "./routes/health.js";
import { handleMe, handleRegister, handleLogin, handleLogout } from "./routes/auth.js";
import { handleForgotPassword, handleValidateReset, handleResetPassword } from "./routes/password.js";
import { handleVerifyEmail, handleResendVerification, handleRequestReverification } from "./routes/verification.js";
import { handleAdmin } from "./routes/admin.js";
import { handleMedia } from "./routes/media.js";
import { handleGetProfile, handleUpdateProfile } from "./routes/profile.js";
import { handleGetAvatar, handleUploadAvatar, handleDeleteAvatar } from "./routes/avatar.js";

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

    // Protected media
    if (
      (pathname.startsWith("/api/thumbnails/") ||
        pathname.startsWith("/api/images/") ||
        pathname === "/api/music/exclusive-track-01") &&
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
  },
};
