const VALID_AUTH = new Set(["anonymous", "optional-user", "user", "admin"]);
const VALID_MFA = new Set(["none", "admin-production-required", "admin-bootstrap-allowed"]);
const VALID_CSRF = new Set(["same-origin-required", "safe-method", "exempt-with-reason", "not-browser-facing"]);
const VALID_SENSITIVITY = new Set(["low", "medium", "high"]);

const REQUIRED_CONFIG = Object.freeze({
  authCore: ["DB"],
  authPublicLimiter: ["DB", "PUBLIC_RATE_LIMITER"],
  userImages: ["DB", "USER_IMAGES", "PUBLIC_RATE_LIMITER"],
  privateMedia: ["DB", "PRIVATE_MEDIA", "PUBLIC_RATE_LIMITER"],
  adminAi: ["DB", "PUBLIC_RATE_LIMITER", "AI_LAB", "AI_SERVICE_AUTH_SECRET"],
  adminVideoJobs: ["DB", "PUBLIC_RATE_LIMITER", "AI_LAB", "AI_SERVICE_AUTH_SECRET", "AI_VIDEO_JOBS_QUEUE", "USER_IMAGES"],
  stripeTestCheckout: ["DB", "PUBLIC_RATE_LIMITER", "ENABLE_ADMIN_STRIPE_TEST_CHECKOUT", "STRIPE_MODE", "STRIPE_SECRET_KEY", "STRIPE_CHECKOUT_SUCCESS_URL", "STRIPE_CHECKOUT_CANCEL_URL"],
  stripeTestWebhook: ["DB", "PUBLIC_RATE_LIMITER", "STRIPE_MODE", "STRIPE_WEBHOOK_SECRET"],
  stripeLiveCheckout: ["DB", "PUBLIC_RATE_LIMITER", "ENABLE_LIVE_STRIPE_CREDIT_PACKS", "STRIPE_LIVE_SECRET_KEY", "STRIPE_LIVE_WEBHOOK_SECRET", "STRIPE_LIVE_CHECKOUT_SUCCESS_URL", "STRIPE_LIVE_CHECKOUT_CANCEL_URL"],
  stripeLiveWebhook: ["DB", "PUBLIC_RATE_LIMITER", "STRIPE_LIVE_WEBHOOK_SECRET"],
});

function policy(input) {
  return Object.freeze({
    csrf: "safe-method",
    mfa: "none",
    body: { kind: "none", noneReason: "No request body is parsed." },
    rateLimit: { noneReason: "Read-only route or protected by downstream ownership checks." },
    config: REQUIRED_CONFIG.authCore,
    audit: { noneReason: "No durable audit event is emitted for this route." },
    sensitivity: "medium",
    ...input,
  });
}

const safeRead = (id, method, path, owner, extra = {}) => policy({
  id,
  method,
  path,
  auth: extra.auth || "user",
  owner,
  ...extra,
});

const userJsonWrite = (id, method, path, owner, bodyMaxBytesName, rateLimitId, extra = {}) => policy({
  id,
  method,
  path,
  auth: "user",
  csrf: "same-origin-required",
  body: { kind: "json", maxBytesName: bodyMaxBytesName, contentType: "application/json" },
  rateLimit: { id: rateLimitId, failClosed: true },
  audit: extra.audit || { event: `${id}.attempt` },
  owner,
  ...extra,
});

const adminRead = (id, path, owner, extra = {}) => policy({
  id,
  method: "GET",
  path,
  auth: "admin",
  mfa: extra.mfa || "admin-production-required",
  owner,
  sensitivity: "high",
  ...extra,
});

const adminJsonWrite = (id, method, path, owner, bodyMaxBytesName, rateLimitId, extra = {}) => policy({
  id,
  method,
  path,
  auth: "admin",
  mfa: extra.mfa || "admin-production-required",
  csrf: "same-origin-required",
  body: bodyMaxBytesName
    ? { kind: "json", maxBytesName: bodyMaxBytesName, contentType: "application/json" }
    : { kind: "none", noneReason: "No request body is parsed." },
  rateLimit: { id: rateLimitId, failClosed: true },
  audit: extra.audit || { event: `${id}.attempt` },
  owner,
  sensitivity: "high",
  ...extra,
});

export const ROUTE_POLICIES = Object.freeze([
  safeRead("health.read", "GET", "/api/health", "platform", {
    auth: "anonymous",
    sensitivity: "low",
    config: ["DB"],
    rateLimit: { noneReason: "Health check is read-only and intentionally public." },
  }),
  safeRead("public.news_pulse.read", "GET", "/api/public/news-pulse", "homepage", {
    auth: "anonymous",
    sensitivity: "low",
    config: ["DB"],
    rateLimit: { noneReason: "Read-only public homepage pulse; response is small, cached, and bounded." },
  }),
  safeRead("auth.me.read", "GET", "/api/me", "auth", {
    auth: "optional-user",
    rateLimit: { noneReason: "Read-only session introspection; session lookup remains bounded." },
  }),
  policy({
    id: "auth.register",
    method: "POST",
    path: "/api/register",
    auth: "anonymous",
    csrf: "same-origin-required",
    body: { kind: "json", maxBytesName: "authJson", contentType: "application/json" },
    rateLimit: { id: "auth-register-ip-and-email", failClosed: true },
    config: ["DB", "PUBLIC_RATE_LIMITER", "RESEND_API_KEY"],
    audit: { event: "user.register" },
    owner: "auth",
    sensitivity: "high",
  }),
  policy({
    id: "auth.login",
    method: "POST",
    path: "/api/login",
    auth: "anonymous",
    csrf: "same-origin-required",
    body: { kind: "json", maxBytesName: "authJson", contentType: "application/json" },
    rateLimit: { id: "auth-login-ip", failClosed: true },
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    audit: { event: "user.login" },
    owner: "auth",
    sensitivity: "high",
  }),
  userJsonWrite("auth.logout", "POST", "/api/logout", "auth", null, "none", {
    auth: "optional-user",
    body: { kind: "none", noneReason: "Logout reads only the session cookie." },
    rateLimit: { noneReason: "Authenticated cookie deletion only; no expensive work." },
    audit: { event: "user.logout" },
  }),
  safeRead("wallet.status.read", "GET", "/api/wallet/status", "wallet", {
    auth: "optional-user",
  }),
  policy({
    id: "wallet.siwe.nonce",
    method: "POST",
    path: "/api/wallet/siwe/nonce",
    auth: "anonymous",
    csrf: "same-origin-required",
    body: { kind: "json", maxBytesName: "authJson", contentType: "application/json" },
    rateLimit: { id: "wallet-siwe-nonce-intent-ip", failClosed: true },
    config: REQUIRED_CONFIG.authPublicLimiter,
    audit: { event: "wallet.siwe_nonce" },
    owner: "wallet",
    sensitivity: "high",
  }),
  policy({
    id: "wallet.siwe.verify",
    method: "POST",
    path: "/api/wallet/siwe/verify",
    auth: "anonymous",
    csrf: "same-origin-required",
    body: { kind: "json", maxBytesName: "authJson", contentType: "application/json" },
    rateLimit: { id: "wallet-siwe-verify-intent-ip", failClosed: true },
    config: REQUIRED_CONFIG.authPublicLimiter,
    audit: { event: "wallet.siwe_verify" },
    owner: "wallet",
    sensitivity: "high",
  }),
  userJsonWrite("wallet.unlink", "POST", "/api/wallet/unlink", "wallet", null, "wallet-unlink-user", {
    body: { kind: "none", noneReason: "Unlink reads only the authenticated session." },
    audit: { event: "wallet_unlink" },
  }),
  safeRead("profile.read", "GET", "/api/profile", "profile"),
  userJsonWrite("profile.update", "PATCH", "/api/profile", "profile", "smallJson", "profile-update-user", {
    audit: { event: "update_profile" },
  }),
  safeRead("account.credits.dashboard.read", "GET", "/api/account/credits-dashboard", "billing", {
    config: ["DB"],
    notes: "Returns only the authenticated member's personal credit balance and sanitized transaction history.",
  }),
  userJsonWrite("account.billing.checkout.live-credit-pack", "POST", "/api/account/billing/checkout/live-credit-pack", "billing", "smallJson", "account-billing-live-checkout-user", {
    config: REQUIRED_CONFIG.stripeLiveCheckout,
    audit: { event: "stripe_live_member_credit_pack_checkout_created" },
    sensitivity: "high",
    notes: "Live Stripe one-time credit-pack checkout for the authenticated member's personal credit balance. Requires active account session, ENABLE_LIVE_STRIPE_CREDIT_PACKS=true, Stripe live key and webhook readiness, Idempotency-Key, current terms and immediate-delivery consent, known live credit pack, same-origin mutation protection, and no credit grant at checkout creation.",
  }),
  safeRead("profile.avatar.read", "GET", "/api/profile/avatar", "profile", {
    config: ["DB", "PRIVATE_MEDIA"],
  }),
  userJsonWrite("profile.avatar.upload", "POST", "/api/profile/avatar", "profile", "avatarMultipart", "avatar-upload-ip", {
    body: { kind: "json-or-multipart", maxBytesName: "avatarMultipart", contentType: "application/json or multipart/form-data" },
    config: REQUIRED_CONFIG.privateMedia,
    audit: { event: "avatar_uploaded" },
  }),
  userJsonWrite("profile.avatar.delete", "DELETE", "/api/profile/avatar", "profile", null, "avatar-delete-user", {
    body: { kind: "none", noneReason: "Avatar delete reads only the authenticated session." },
    config: ["DB", "PRIVATE_MEDIA"],
    rateLimit: { id: "avatar-delete-ip", failClosed: true },
    audit: { event: "avatar_deleted" },
  }),
  safeRead("favorites.list", "GET", "/api/favorites", "favorites"),
  userJsonWrite("favorites.add", "POST", "/api/favorites", "favorites", "smallJson", "favorites-add-ip"),
  userJsonWrite("favorites.remove", "DELETE", "/api/favorites", "favorites", "smallJson", "favorites-remove-ip"),
  safeRead("orgs.list", "GET", "/api/orgs", "organizations", {
    rateLimit: { noneReason: "Read-only membership list scoped to the authenticated user." },
  }),
  userJsonWrite("orgs.create", "POST", "/api/orgs", "organizations", "smallJson", "org-create-user", {
    audit: { event: "organization_created" },
  }),
  safeRead("orgs.read", "GET", "/api/orgs/:id", "organizations", {
    rateLimit: { noneReason: "Read-only organization detail requires active membership." },
  }),
  safeRead("orgs.members.list", "GET", "/api/orgs/:id/members", "organizations", {
    rateLimit: { noneReason: "Read-only member list requires active membership and is capped." },
  }),
  userJsonWrite("orgs.members.add", "POST", "/api/orgs/:id/members", "organizations", "smallJson", "org-member-write-user", {
    audit: { event: "organization_member_added" },
  }),
  safeRead("orgs.entitlements.read", "GET", "/api/orgs/:id/entitlements", "billing", {
    rateLimit: { noneReason: "Read-only entitlement summary requires active organization membership." },
  }),
  safeRead("orgs.billing.read", "GET", "/api/orgs/:id/billing", "billing", {
    rateLimit: { noneReason: "Read-only billing summary requires organization admin/owner membership." },
  }),
  safeRead("orgs.usage.read", "GET", "/api/orgs/:id/usage", "billing", {
    rateLimit: { noneReason: "Read-only usage summary requires organization admin/owner membership and is capped." },
  }),
  adminJsonWrite("orgs.billing.checkout.credit-pack", "POST", "/api/orgs/:id/billing/checkout/credit-pack", "billing", "smallJson", "org-billing-checkout-user", {
    config: REQUIRED_CONFIG.stripeTestCheckout,
    audit: { event: "stripe_credit_pack_checkout_created" },
    sensitivity: "high",
    notes: "Stripe Testmode only. Requires platform admin, owner/admin organization role, ENABLE_ADMIN_STRIPE_TEST_CHECKOUT=true, Idempotency-Key, known credit pack, and no credit grant at checkout creation. Not public billing and not org-owner/member checkout.",
  }),
  userJsonWrite("orgs.billing.checkout.live-credit-pack", "POST", "/api/orgs/:id/billing/checkout/live-credit-pack", "billing", "smallJson", "org-billing-live-checkout-user", {
    config: REQUIRED_CONFIG.stripeLiveCheckout,
    audit: { event: "stripe_live_credit_pack_checkout_created" },
    sensitivity: "high",
    notes: "Live Stripe one-time credit-pack checkout for an organization. Requires platform admin or active organization owner only; organization admin/member/viewer access is denied. Normal members use /api/account/billing/checkout/live-credit-pack for personal credits. Requires ENABLE_LIVE_STRIPE_CREDIT_PACKS=true, Stripe live key and webhook readiness, Idempotency-Key, current terms and immediate-delivery consent, known live credit pack, same-origin mutation protection, and no credit grant at checkout creation.",
  }),
  safeRead("orgs.billing.credits-dashboard.read", "GET", "/api/orgs/:id/billing/credits-dashboard", "billing", {
    sensitivity: "high",
    rateLimit: { noneReason: "Read-only credits dashboard requires platform admin or active organization owner and returns sanitized billing data only." },
    notes: "Organization credits dashboard for platform admins and active organization owners only; organization admins, members, viewers, and non-members are denied.",
  }),
  safeRead("orgs.organization-dashboard.read", "GET", "/api/orgs/:id/organization-dashboard", "organizations", {
    sensitivity: "high",
    rateLimit: { noneReason: "Read-only organization dashboard requires platform admin or active organization owner and returns sanitized organization, role, balance, ledger, and member summaries." },
    notes: "Organization context dashboard for platform admins and active organization owners only; organization admins, members, viewers, and non-members are denied. Used to align Credits and Admin AI Lab organization selection.",
  }),
  policy({
    id: "password.forgot",
    method: "POST",
    path: "/api/forgot-password",
    auth: "anonymous",
    csrf: "same-origin-required",
    body: { kind: "json", maxBytesName: "authJson", contentType: "application/json" },
    rateLimit: { id: "auth-forgot-ip-and-email", failClosed: true },
    config: ["DB", "PUBLIC_RATE_LIMITER", "RESEND_API_KEY"],
    audit: { noneReason: "Returns generic success to prevent enumeration; user activity logs only after reset completion." },
    owner: "auth",
    sensitivity: "high",
  }),
  safeRead("password.reset.validate", "GET", "/api/reset-password/validate", "auth", {
    auth: "anonymous",
    rateLimit: { id: "auth-reset-validate-ip", failClosed: true },
    sensitivity: "high",
  }),
  policy({
    id: "password.reset",
    method: "POST",
    path: "/api/reset-password",
    auth: "anonymous",
    csrf: "same-origin-required",
    body: { kind: "json", maxBytesName: "authJson", contentType: "application/json" },
    rateLimit: { id: "auth-reset-ip", failClosed: true },
    config: REQUIRED_CONFIG.authPublicLimiter,
    audit: { event: "reset_password" },
    owner: "auth",
    sensitivity: "high",
  }),
  safeRead("verification.email.verify", "GET", "/api/verify-email", "auth", {
    auth: "anonymous",
    csrf: "exempt-with-reason",
    csrfReason: "GET verification links are intentionally opened from email clients.",
    rateLimit: { id: "auth-verify-ip", failClosed: true },
    sensitivity: "high",
  }),
  policy({
    id: "verification.resend",
    method: "POST",
    path: "/api/resend-verification",
    auth: "anonymous",
    csrf: "same-origin-required",
    body: { kind: "json", maxBytesName: "authJson", contentType: "application/json" },
    rateLimit: { id: "auth-resend-ip", failClosed: true },
    config: ["DB", "PUBLIC_RATE_LIMITER", "RESEND_API_KEY"],
    audit: { noneReason: "Generic resend response avoids account enumeration." },
    owner: "auth",
    sensitivity: "high",
  }),
  userJsonWrite("verification.request-reverification", "POST", "/api/request-reverification", "auth", "authJson", "auth-reverify-ip", {
    config: ["DB", "PUBLIC_RATE_LIMITER", "RESEND_API_KEY"],
    audit: { event: "request_reverification" },
  }),

  adminRead("admin.me", "/api/admin/me", "admin", {
    mfa: "admin-bootstrap-allowed",
    rateLimit: { noneReason: "Bootstrap identity route; admin auth and production MFA state are evaluated inside the handler." },
  }),
  adminRead("admin.users.list", "/api/admin/users", "admin"),
  adminJsonWrite("admin.users.role.update", "PATCH", "/api/admin/users/:id/role", "admin", "smallJson", "admin-action-ip", { audit: { event: "change_role" } }),
  adminJsonWrite("admin.users.status.update", "PATCH", "/api/admin/users/:id/status", "admin", "smallJson", "admin-action-ip", { audit: { event: "change_status" } }),
  adminJsonWrite("admin.users.sessions.revoke", "POST", "/api/admin/users/:id/revoke-sessions", "admin", null, "admin-action-ip", { audit: { event: "revoke_sessions" } }),
  adminJsonWrite("admin.users.delete", "DELETE", "/api/admin/users/:id", "admin", null, "admin-action-ip", { audit: { event: "delete_user" } }),
  adminRead("admin.stats.read", "/api/admin/stats", "admin"),
  adminRead("admin.orgs.list", "/api/admin/orgs", "organizations", {
    config: REQUIRED_CONFIG.authPublicLimiter,
    rateLimit: { id: "admin-org-read-ip", failClosed: true },
  }),
  adminRead("admin.orgs.read", "/api/admin/orgs/:id", "organizations", {
    config: REQUIRED_CONFIG.authPublicLimiter,
    rateLimit: { id: "admin-org-read-ip", failClosed: true },
  }),
  adminRead("admin.billing.plans.list", "/api/admin/billing/plans", "billing", {
    config: REQUIRED_CONFIG.authPublicLimiter,
    rateLimit: { id: "admin-billing-read-ip", failClosed: true },
  }),
  adminRead("admin.orgs.billing.read", "/api/admin/orgs/:id/billing", "billing", {
    config: REQUIRED_CONFIG.authPublicLimiter,
    rateLimit: { id: "admin-billing-read-ip", failClosed: true },
  }),
  adminJsonWrite("admin.orgs.credits.grant", "POST", "/api/admin/orgs/:id/credits/grant", "billing", "smallJson", "admin-billing-write-ip", {
    config: REQUIRED_CONFIG.authPublicLimiter,
    audit: { event: "organization_credit_granted" },
  }),
  adminRead("admin.users.billing.read", "/api/admin/users/:id/billing", "billing", {
    config: REQUIRED_CONFIG.authPublicLimiter,
    rateLimit: { id: "admin-billing-read-ip", failClosed: true },
  }),
  adminJsonWrite("admin.users.credits.grant", "POST", "/api/admin/users/:id/credits/grant", "billing", "smallJson", "admin-billing-write-ip", {
    config: REQUIRED_CONFIG.authPublicLimiter,
    audit: { event: "user_credit_granted" },
  }),
  adminRead("admin.billing.events.list", "/api/admin/billing/events", "billing", {
    config: REQUIRED_CONFIG.authPublicLimiter,
    rateLimit: { id: "admin-billing-read-ip", failClosed: true },
    notes: "Read-only sanitized inspection of provider-neutral billing event metadata. Raw webhook payloads and signatures are not returned.",
  }),
  adminRead("admin.billing.events.read", "/api/admin/billing/events/:id", "billing", {
    config: REQUIRED_CONFIG.authPublicLimiter,
    rateLimit: { id: "admin-billing-read-ip", failClosed: true },
    notes: "Read-only sanitized billing event detail and dry-run action plan inspection.",
  }),
  adminRead("admin.avatars.latest", "/api/admin/avatars/latest", "admin", { config: ["DB"] }),
  adminRead("admin.avatars.read", "/api/admin/avatars/:userId", "admin", { config: ["DB", "PRIVATE_MEDIA"] }),
  adminRead("admin.activity.read", "/api/admin/activity", "admin", {
    config: ["DB", "PAGINATION_SIGNING_SECRET"],
    rateLimit: { noneReason: "Read-only admin audit search uses signed keyset cursors and bounded indexed query shapes." },
  }),
  adminRead("admin.user-activity.read", "/api/admin/user-activity", "admin", {
    config: ["DB", "PAGINATION_SIGNING_SECRET"],
    rateLimit: { noneReason: "Read-only admin user-activity search uses signed keyset cursors and bounded indexed query shapes." },
  }),
  adminRead("admin.data-lifecycle.requests.list", "/api/admin/data-lifecycle/requests", "privacy", {
    config: REQUIRED_CONFIG.authPublicLimiter,
    rateLimit: { id: "admin-data-lifecycle-ip", failClosed: true },
  }),
  adminJsonWrite("admin.data-lifecycle.requests.create", "POST", "/api/admin/data-lifecycle/requests", "privacy", "adminJson", "admin-data-lifecycle-ip", {
    config: REQUIRED_CONFIG.authPublicLimiter,
    audit: { event: "data_lifecycle_request_created" },
  }),
  adminRead("admin.data-lifecycle.requests.read", "/api/admin/data-lifecycle/requests/:id", "privacy", {
    config: REQUIRED_CONFIG.authPublicLimiter,
    rateLimit: { id: "admin-data-lifecycle-ip", failClosed: true },
  }),
  adminJsonWrite("admin.data-lifecycle.requests.plan", "POST", "/api/admin/data-lifecycle/requests/:id/plan", "privacy", "smallJson", "admin-data-lifecycle-ip", {
    config: REQUIRED_CONFIG.authPublicLimiter,
    audit: { event: "data_lifecycle_request_planned" },
  }),
  adminJsonWrite("admin.data-lifecycle.requests.approve", "POST", "/api/admin/data-lifecycle/requests/:id/approve", "privacy", "smallJson", "admin-data-lifecycle-ip", {
    config: REQUIRED_CONFIG.authPublicLimiter,
    audit: { event: "data_lifecycle_request_approved" },
  }),
  adminJsonWrite("admin.data-lifecycle.requests.generate-export", "POST", "/api/admin/data-lifecycle/requests/:id/generate-export", "privacy", "smallJson", "admin-data-lifecycle-ip", {
    config: ["DB", "PUBLIC_RATE_LIMITER", "AUDIT_ARCHIVE"],
    audit: { event: "data_lifecycle_export_archive_generated" },
  }),
  adminJsonWrite("admin.data-lifecycle.requests.execute-safe", "POST", "/api/admin/data-lifecycle/requests/:id/execute-safe", "privacy", "smallJson", "admin-data-lifecycle-ip", {
    config: ["DB", "PUBLIC_RATE_LIMITER", "AUDIT_ARCHIVE"],
    audit: { event: "data_lifecycle_safe_actions_executed" },
  }),
  adminRead("admin.data-lifecycle.requests.export.read", "/api/admin/data-lifecycle/requests/:id/export", "privacy", {
    config: ["DB", "PUBLIC_RATE_LIMITER", "AUDIT_ARCHIVE"],
    rateLimit: { id: "admin-data-lifecycle-ip", failClosed: true },
  }),
  adminRead("admin.data-lifecycle.exports.list", "/api/admin/data-lifecycle/exports", "privacy", {
    config: ["DB", "PUBLIC_RATE_LIMITER", "AUDIT_ARCHIVE", "PAGINATION_SIGNING_SECRET"],
    rateLimit: { id: "admin-data-lifecycle-ip", failClosed: true },
  }),
  adminJsonWrite("admin.data-lifecycle.exports.cleanup-expired", "POST", "/api/admin/data-lifecycle/exports/cleanup-expired", "privacy", "smallJson", "admin-data-lifecycle-ip", {
    config: ["DB", "PUBLIC_RATE_LIMITER", "AUDIT_ARCHIVE"],
    audit: { event: "data_lifecycle_export_archive_cleanup_completed" },
  }),
  adminRead("admin.data-lifecycle.exports.read", "/api/admin/data-lifecycle/exports/:archiveId", "privacy", {
    config: ["DB", "PUBLIC_RATE_LIMITER", "AUDIT_ARCHIVE"],
    rateLimit: { id: "admin-data-lifecycle-ip", failClosed: true },
  }),

  adminRead("admin.mfa.status", "/api/admin/mfa/status", "admin-mfa", {
    mfa: "admin-bootstrap-allowed",
    rateLimit: { noneReason: "Read-only MFA status bootstrap route." },
  }),
  adminJsonWrite("admin.mfa.setup", "POST", "/api/admin/mfa/setup", "admin-mfa", null, "admin-mfa-setup-admin-and-ip", {
    mfa: "admin-bootstrap-allowed",
    config: REQUIRED_CONFIG.authPublicLimiter,
    body: { kind: "none", noneReason: "Setup creates a pending secret without parsing a request body." },
    audit: { event: "admin_mfa_setup_created" },
  }),
  adminJsonWrite("admin.mfa.enable", "POST", "/api/admin/mfa/enable", "admin-mfa", "smallJson", "admin-mfa-enable-admin-and-ip", {
    mfa: "admin-bootstrap-allowed",
    config: REQUIRED_CONFIG.authPublicLimiter,
    audit: { event: "admin_mfa_enabled" },
  }),
  adminJsonWrite("admin.mfa.verify", "POST", "/api/admin/mfa/verify", "admin-mfa", "smallJson", "admin-mfa-verify-admin-and-ip", {
    mfa: "admin-bootstrap-allowed",
    config: REQUIRED_CONFIG.authPublicLimiter,
    audit: { event: "admin_mfa_verified" },
  }),
  adminJsonWrite("admin.mfa.disable", "POST", "/api/admin/mfa/disable", "admin-mfa", "smallJson", "admin-mfa-disable-admin-and-ip", {
    config: REQUIRED_CONFIG.authPublicLimiter,
    audit: { event: "admin_mfa_disabled" },
  }),
  adminJsonWrite("admin.mfa.recovery.regenerate", "POST", "/api/admin/mfa/recovery-codes/regenerate", "admin-mfa", "smallJson", "admin-mfa-recovery-regenerate-admin-and-ip", {
    config: REQUIRED_CONFIG.authPublicLimiter,
    audit: { event: "admin_mfa_recovery_codes_regenerated" },
  }),

  adminRead("admin.ai.models", "/api/admin/ai/models", "admin-ai", {
    config: REQUIRED_CONFIG.adminAi,
    rateLimit: { id: "admin-ai-models-ip", failClosed: true },
  }),
  adminJsonWrite("admin.ai.test-text", "POST", "/api/admin/ai/test-text", "admin-ai", "adminJson", "admin-ai-text-ip", { config: REQUIRED_CONFIG.adminAi }),
  adminJsonWrite("admin.ai.test-image", "POST", "/api/admin/ai/test-image", "admin-ai", "adminJson", "admin-ai-image-ip", {
    config: REQUIRED_CONFIG.adminAi,
    sensitivity: "high",
    notes: "Admin area only. Platform admin required. BFL Flux 1 Schnell and Flux 2 Klein 9B admin image tests require organization_id, Idempotency-Key, server-side credit calculation, sufficient organization credits, and no charge on provider failure. No public/member/owner route exposure.",
  }),
  adminJsonWrite("admin.ai.test-embeddings", "POST", "/api/admin/ai/test-embeddings", "admin-ai", "adminJson", "admin-ai-embeddings-ip", { config: REQUIRED_CONFIG.adminAi }),
  adminJsonWrite("admin.ai.test-music", "POST", "/api/admin/ai/test-music", "admin-ai", "adminJson", "admin-ai-music-ip", { config: REQUIRED_CONFIG.adminAi }),
  adminJsonWrite("admin.ai.test-video-debug", "POST", "/api/admin/ai/test-video", "admin-ai", "adminJson", "admin-ai-video-ip", {
    config: REQUIRED_CONFIG.adminAi,
    debugGate: "ALLOW_SYNC_VIDEO_DEBUG=true",
    audit: { event: "admin_ai_sync_video_debug_used" },
  }),
  adminJsonWrite("admin.ai.video-jobs.create", "POST", "/api/admin/ai/video-jobs", "admin-ai", "adminVideoJobJson", "admin-ai-video-job-create-ip", {
    config: REQUIRED_CONFIG.adminVideoJobs,
    audit: { event: "ai_video_job_created" },
  }),
  adminRead("admin.ai.video-jobs.poison.list", "/api/admin/ai/video-jobs/poison", "admin-ai", {
    config: REQUIRED_CONFIG.adminVideoJobs,
    rateLimit: { id: "admin-ai-video-ops-ip", failClosed: true },
  }),
  adminRead("admin.ai.video-jobs.poison.read", "/api/admin/ai/video-jobs/poison/:id", "admin-ai", {
    config: REQUIRED_CONFIG.adminVideoJobs,
    rateLimit: { id: "admin-ai-video-ops-ip", failClosed: true },
  }),
  adminRead("admin.ai.video-jobs.failed.list", "/api/admin/ai/video-jobs/failed", "admin-ai", {
    config: REQUIRED_CONFIG.adminVideoJobs,
    rateLimit: { id: "admin-ai-video-ops-ip", failClosed: true },
  }),
  adminRead("admin.ai.video-jobs.failed.read", "/api/admin/ai/video-jobs/failed/:id", "admin-ai", {
    config: REQUIRED_CONFIG.adminVideoJobs,
    rateLimit: { id: "admin-ai-video-ops-ip", failClosed: true },
  }),
  adminRead("admin.ai.usage-attempts.list", "/api/admin/ai/usage-attempts", "billing", {
    config: ["DB", "PUBLIC_RATE_LIMITER", "PAGINATION_SIGNING_SECRET"],
    rateLimit: { id: "admin-ai-usage-attempts-ip", failClosed: true },
  }),
  adminJsonWrite("admin.ai.usage-attempts.cleanup-expired", "POST", "/api/admin/ai/usage-attempts/cleanup-expired", "billing", "smallJson", "admin-ai-usage-attempts-write-ip", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    audit: { event: "ai_usage_attempt_cleanup_completed" },
    notes: "Releases expired reservations and deletes only expired, attempt-linked temporary AI replay objects under the approved tmp/ai-generated/ prefix.",
  }),
  adminRead("admin.ai.usage-attempts.read", "/api/admin/ai/usage-attempts/:id", "billing", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    rateLimit: { id: "admin-ai-usage-attempts-ip", failClosed: true },
  }),
  adminRead("admin.ai.video-jobs.status", "/api/admin/ai/video-jobs/:id", "admin-ai", {
    config: REQUIRED_CONFIG.adminVideoJobs,
    rateLimit: { id: "admin-ai-video-job-status-ip", failClosed: true },
  }),
  adminRead("admin.ai.video-jobs.output", "/api/admin/ai/video-jobs/:id/output", "admin-ai", {
    config: REQUIRED_CONFIG.adminVideoJobs,
    rateLimit: { id: "admin-ai-video-job-output-ip", failClosed: true },
  }),
  adminRead("admin.ai.video-jobs.poster", "/api/admin/ai/video-jobs/:id/poster", "admin-ai", {
    config: REQUIRED_CONFIG.adminVideoJobs,
    rateLimit: { id: "admin-ai-video-job-output-ip", failClosed: true },
  }),
  adminJsonWrite("admin.ai.compare", "POST", "/api/admin/ai/compare", "admin-ai", "adminJson", "admin-ai-compare-ip", { config: REQUIRED_CONFIG.adminAi }),
  adminJsonWrite("admin.ai.live-agent", "POST", "/api/admin/ai/live-agent", "admin-ai", "adminJson", "admin-ai-liveagent-ip", { config: REQUIRED_CONFIG.adminAi }),
  adminJsonWrite("admin.ai.derivatives.backfill", "POST", "/api/admin/ai/image-derivatives/backfill", "admin-ai", "adminJson", "admin-ai-derivative-backfill-ip", {
    config: ["DB", "PUBLIC_RATE_LIMITER", "AI_IMAGE_DERIVATIVES_QUEUE"],
    audit: { event: "admin_ai_derivative_backfill_enqueued" },
  }),
  adminJsonWrite("admin.ai.save-text-asset", "POST", "/api/admin/ai/save-text-asset", "admin-ai", "adminJson", "admin-ai-save-text-ip", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    audit: { event: "admin_ai_text_asset_saved" },
  }),
  adminJsonWrite("admin.ai.proxy-video", "POST", "/api/admin/ai/proxy-video", "admin-ai", "adminJson", "admin-ai-video-proxy-ip", {
    config: REQUIRED_CONFIG.authPublicLimiter,
    audit: { event: "admin_ai_proxy_video_rejected" },
  }),

  safeRead("ai.quota.read", "GET", "/api/ai/quota", "ai-studio"),
  userJsonWrite("ai.generate-image", "POST", "/api/ai/generate-image", "ai-studio", "aiGenerateImageJson", "ai-generate-user", {
    config: ["DB", "PUBLIC_RATE_LIMITER", "AI", "USER_IMAGES"],
    audit: { event: "ai_generate_image" },
    sensitivity: "high",
    billing: {
      mode: "optional-organization-context",
      feature: "ai.image.generate",
      idempotency: "required when organization_id is supplied; provider execution is guarded by ai_usage_attempts",
    },
  }),
  userJsonWrite("ai.generate-text", "POST", "/api/ai/generate-text", "ai-studio", "aiGenerateJson", "ai-generate-text-user", {
    config: ["DB", "PUBLIC_RATE_LIMITER", "AI_LAB", "AI_SERVICE_AUTH_SECRET"],
    audit: { event: "ai_generate_text" },
    sensitivity: "high",
    billing: {
      mode: "required-organization-context",
      feature: "ai.text.generate",
      idempotency: "required; provider execution and text replay are guarded by ai_usage_attempts",
    },
  }),
  userJsonWrite("ai.generate-music", "POST", "/api/ai/generate-music", "ai-studio", "aiGenerateJson", "ai-generate-music-user", {
    config: ["DB", "PUBLIC_RATE_LIMITER", "AI_LAB", "AI_SERVICE_AUTH_SECRET", "USER_IMAGES"],
    audit: { event: "ai_generate_music" },
    sensitivity: "high",
    billing: {
      mode: "member-credit-account",
      feature: "ai.music.generate",
      idempotency: "recommended; member usage events prevent duplicate credit consumption when Idempotency-Key is supplied",
    },
  }),
  userJsonWrite("ai.generate-video", "POST", "/api/ai/generate-video", "ai-studio", "aiGenerateVideoJson", "ai-generate-video-user", {
    config: ["DB", "PUBLIC_RATE_LIMITER", "AI", "USER_IMAGES"],
    audit: { event: "ai_generate_video" },
    sensitivity: "high",
    billing: {
      mode: "member-credit-account",
      feature: "ai.video.generate",
      idempotency: "recommended; member usage events prevent duplicate credit consumption when Idempotency-Key is supplied",
    },
  }),
  policy({
    id: "billing.webhooks.test",
    method: "POST",
    path: "/api/billing/webhooks/test",
    auth: "anonymous",
    csrf: "not-browser-facing",
    body: { kind: "raw", maxBytesName: "billingWebhookRaw", contentType: "application/json" },
    rateLimit: { id: "billing-webhook-test-ip", failClosed: true },
    config: ["DB", "PUBLIC_RATE_LIMITER", "BILLING_WEBHOOK_TEST_SECRET"],
    audit: { event: "billing_provider_event_received" },
    owner: "billing",
    sensitivity: "high",
    providerSignature: "synthetic-test-only",
    notes: "Provider-neutral webhook foundation. Raw body is verified before JSON parse; live provider billing side effects are disabled.",
  }),
  policy({
    id: "billing.webhooks.stripe",
    method: "POST",
    path: "/api/billing/webhooks/stripe",
    auth: "anonymous",
    csrf: "not-browser-facing",
    body: { kind: "raw", maxBytesName: "billingWebhookRaw", contentType: "application/json" },
    rateLimit: { id: "billing-webhook-stripe-ip", failClosed: true },
    config: REQUIRED_CONFIG.stripeTestWebhook,
    audit: { event: "stripe_billing_webhook_received" },
    owner: "billing",
    sensitivity: "high",
    providerSignature: "stripe-testmode-only",
    notes: "Stripe Testmode webhook foundation. Raw body is verified with Stripe-Signature before JSON parse; live-mode events and live billing side effects are disabled. Credit grants require an existing checkout session created by an active platform admin.",
  }),
  policy({
    id: "billing.webhooks.stripe.live",
    method: "POST",
    path: "/api/billing/webhooks/stripe/live",
    auth: "anonymous",
    csrf: "not-browser-facing",
    body: { kind: "raw", maxBytesName: "billingWebhookRaw", contentType: "application/json" },
    rateLimit: { id: "billing-webhook-stripe-live-ip", failClosed: true },
    config: REQUIRED_CONFIG.stripeLiveWebhook,
    audit: { event: "stripe_live_billing_webhook_received" },
    owner: "billing",
    sensitivity: "high",
    providerSignature: "stripe-live-only",
    notes: "Live Stripe webhook for one-time credit packs only. Raw body is verified with STRIPE_LIVE_WEBHOOK_SECRET before JSON parse; Testmode events are rejected. Credit grants require an existing live checkout session created by a current platform admin or active organization owner.",
  }),
  safeRead("ai.folders.list", "GET", "/api/ai/folders", "ai-studio"),
  userJsonWrite("ai.folders.create", "POST", "/api/ai/folders", "ai-studio", "smallJson", "ai-folder-write-user"),
  userJsonWrite("ai.folders.rename", "PATCH", "/api/ai/folders/:id", "ai-studio", "smallJson", "ai-folder-write-user"),
  userJsonWrite("ai.folders.delete", "DELETE", "/api/ai/folders/:id", "ai-studio", null, "ai-folder-write-user", {
    body: { kind: "none", noneReason: "Folder delete uses the path id only." },
  }),
  safeRead("ai.images.list", "GET", "/api/ai/images", "ai-studio"),
  safeRead("ai.assets.list", "GET", "/api/ai/assets", "ai-studio"),
  userJsonWrite("ai.assets.bulk-move", "PATCH", "/api/ai/assets/bulk-move", "ai-studio", "adminJson", "ai-asset-bulk-write-user"),
  userJsonWrite("ai.assets.bulk-delete", "POST", "/api/ai/assets/bulk-delete", "ai-studio", "adminJson", "ai-asset-bulk-write-user"),
  userJsonWrite("ai.images.save", "POST", "/api/ai/images/save", "ai-studio", "aiSaveImageJson", "ai-save-image-user", {
    config: REQUIRED_CONFIG.userImages,
    audit: { event: "ai_image_stored" },
  }),
  userJsonWrite("ai.audio.save", "POST", "/api/ai/audio/save", "ai-studio", "aiSaveAudioJson", "ai-audio-save-user", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    audit: { event: "ai_audio_saved" },
  }),
  userJsonWrite("ai.images.bulk-move", "PATCH", "/api/ai/images/bulk-move", "ai-studio", "adminJson", "ai-image-bulk-write-user"),
  userJsonWrite("ai.images.bulk-delete", "POST", "/api/ai/images/bulk-delete", "ai-studio", "adminJson", "ai-image-bulk-write-user"),
  safeRead("ai.images.file", "GET", "/api/ai/images/:id/file", "ai-studio", { config: ["DB", "USER_IMAGES"] }),
  safeRead("ai.images.thumb", "GET", "/api/ai/images/:id/thumb", "ai-studio", { config: ["DB", "USER_IMAGES"] }),
  safeRead("ai.images.medium", "GET", "/api/ai/images/:id/medium", "ai-studio", { config: ["DB", "USER_IMAGES"] }),
  userJsonWrite("ai.images.delete", "DELETE", "/api/ai/images/:id", "ai-studio", null, "ai-delete-image-user", {
    body: { kind: "none", noneReason: "Image delete uses the path id only." },
    config: REQUIRED_CONFIG.userImages,
  }),
  userJsonWrite("ai.images.publication", "PATCH", "/api/ai/images/:id/publication", "ai-studio", "smallJson", "ai-publication-write-user"),
  userJsonWrite("ai.images.rename", "PATCH", "/api/ai/images/:id/rename", "ai-studio", "adminJson", "ai-image-rename-user"),
  safeRead("ai.text-assets.file", "GET", "/api/ai/text-assets/:id/file", "ai-studio", { config: ["DB", "USER_IMAGES"] }),
  safeRead("ai.text-assets.file.head", "HEAD", "/api/ai/text-assets/:id/file", "ai-studio", { config: ["DB", "USER_IMAGES"] }),
  safeRead("ai.text-assets.poster", "GET", "/api/ai/text-assets/:id/poster", "ai-studio"),
  userJsonWrite("ai.text-assets.poster.attach", "POST", "/api/ai/text-assets/:id/poster", "ai-studio", "aiSaveVideoPosterJson", "ai-text-asset-write-user", {
    config: REQUIRED_CONFIG.userImages,
    audit: { event: "video_poster_attached" },
  }),
  userJsonWrite("ai.text-assets.publication", "PATCH", "/api/ai/text-assets/:id/publication", "ai-studio", "smallJson", "ai-publication-write-user"),
  userJsonWrite("ai.text-assets.rename", "PATCH", "/api/ai/text-assets/:id/rename", "ai-studio", "smallJson", "ai-text-asset-write-user"),
  userJsonWrite("ai.text-assets.delete", "DELETE", "/api/ai/text-assets/:id", "ai-studio", null, "ai-text-asset-write-user", {
    body: { kind: "none", noneReason: "Text asset delete uses the path id only." },
  }),

]);

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compilePattern(pattern) {
  const source = String(pattern)
    .split("/")
    .map((segment) => segment.startsWith(":") ? "[^/]+" : escapeRegExp(segment))
    .join("/");
  return new RegExp(`^${source}$`);
}

const COMPILED_POLICIES = ROUTE_POLICIES.map((entry) => ({
  ...entry,
  matcher: entry.path.includes("/:") ? compilePattern(entry.path) : null,
}));

export function getRoutePolicy(method, pathname) {
  const normalizedMethod = String(method || "").toUpperCase();
  const normalizedPathname = String(pathname || "");
  for (const policyEntry of COMPILED_POLICIES) {
    if (policyEntry.method !== normalizedMethod) continue;
    if (policyEntry.path === normalizedPathname || policyEntry.matcher?.test(normalizedPathname)) {
      const { matcher: _matcher, ...publicPolicy } = policyEntry;
      return publicPolicy;
    }
  }
  return null;
}

export function validateRoutePolicies(policies = ROUTE_POLICIES) {
  const issues = [];
  const ids = new Set();
  const routeKeys = new Set();

  for (const entry of policies) {
    if (!entry || typeof entry !== "object") {
      issues.push("Route policy entry must be an object.");
      continue;
    }

    if (!entry.id || typeof entry.id !== "string") issues.push("Route policy entry is missing id.");
    if (ids.has(entry.id)) issues.push(`Duplicate route policy id "${entry.id}".`);
    ids.add(entry.id);

    if (!entry.method || typeof entry.method !== "string") issues.push(`${entry.id}: missing method.`);
    if (!entry.path || typeof entry.path !== "string" || !entry.path.startsWith("/")) issues.push(`${entry.id}: missing absolute path.`);
    const routeKey = `${entry.method} ${entry.path}`;
    if (routeKeys.has(routeKey)) issues.push(`Duplicate route policy route "${routeKey}".`);
    routeKeys.add(routeKey);

    if (!VALID_AUTH.has(entry.auth)) issues.push(`${entry.id}: invalid auth policy "${entry.auth}".`);
    if (!VALID_MFA.has(entry.mfa)) issues.push(`${entry.id}: invalid MFA policy "${entry.mfa}".`);
    if (!VALID_CSRF.has(entry.csrf)) issues.push(`${entry.id}: invalid CSRF policy "${entry.csrf}".`);
    if (!VALID_SENSITIVITY.has(entry.sensitivity)) issues.push(`${entry.id}: invalid sensitivity "${entry.sensitivity}".`);
    if (!entry.owner || typeof entry.owner !== "string") issues.push(`${entry.id}: missing owner.`);
    if (!Array.isArray(entry.config)) issues.push(`${entry.id}: config must be an array.`);
    if (!entry.body || typeof entry.body !== "object") issues.push(`${entry.id}: missing body policy.`);
    if (!entry.rateLimit || typeof entry.rateLimit !== "object") issues.push(`${entry.id}: missing rateLimit policy.`);
    if (!entry.audit || typeof entry.audit !== "object") issues.push(`${entry.id}: missing audit policy.`);

    if (entry.method !== "GET" && entry.method !== "HEAD" && entry.csrf !== "same-origin-required" && entry.csrf !== "not-browser-facing") {
      issues.push(`${entry.id}: mutating browser-facing routes must require same-origin CSRF policy.`);
    }
    if (entry.csrf === "exempt-with-reason" && !entry.csrfReason) {
      issues.push(`${entry.id}: CSRF exemption requires csrfReason.`);
    }
    if (entry.auth === "admin" && entry.mfa === "none") {
      issues.push(`${entry.id}: admin routes must declare an MFA policy.`);
    }
    if (entry.path.startsWith("/api/admin/") && entry.auth !== "admin") {
      issues.push(`${entry.id}: /api/admin routes must use admin auth.`);
    }
    if (entry.sensitivity === "high" && !entry.rateLimit.id && !entry.rateLimit.noneReason) {
      issues.push(`${entry.id}: high-sensitivity route needs a rate limit id or explicit exemption.`);
    }
    if (entry.rateLimit.id && entry.rateLimit.failClosed !== true && entry.sensitivity === "high") {
      issues.push(`${entry.id}: high-sensitivity rate limits must be fail-closed.`);
    }
    if (entry.body.kind !== "none" && !entry.body.maxBytesName) {
      issues.push(`${entry.id}: body-parsing route must declare maxBytesName.`);
    }
    if (entry.body.kind === "none" && !entry.body.noneReason) {
      issues.push(`${entry.id}: no-body policy requires noneReason.`);
    }
  }

  return issues;
}
