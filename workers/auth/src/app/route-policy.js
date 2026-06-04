const VALID_AUTH = new Set(["anonymous", "optional-user", "user", "admin"]);
const VALID_MFA = new Set(["none", "admin-production-required", "admin-bootstrap-allowed"]);
const VALID_CSRF = new Set(["same-origin-required", "safe-method", "exempt-with-reason", "not-browser-facing"]);
const VALID_SENSITIVITY = new Set(["low", "medium", "high"]);

const REQUIRED_CONFIG = Object.freeze({
  authCore: ["DB"],
  authPublicLimiter: ["DB", "PUBLIC_RATE_LIMITER"],
  openClawIngest: ["DB", "PUBLIC_RATE_LIMITER", "OPENCLAW_INGEST_SECRET"],
  userImages: ["DB", "USER_IMAGES", "PUBLIC_RATE_LIMITER"],
  privateMedia: ["DB", "PRIVATE_MEDIA", "PUBLIC_RATE_LIMITER"],
  adminAi: ["DB", "PUBLIC_RATE_LIMITER", "AI_LAB", "AI_SERVICE_AUTH_SECRET"],
  adminVideoJobs: ["DB", "PUBLIC_RATE_LIMITER", "AI_LAB", "AI_SERVICE_AUTH_SECRET", "AI_VIDEO_JOBS_QUEUE", "USER_IMAGES"],
  adminAiVideoSource: ["DB", "USER_IMAGES", "AI_SAVE_REFERENCE_SIGNING_SECRET"],
  stripeTestCheckout: ["DB", "PUBLIC_RATE_LIMITER", "ENABLE_ADMIN_STRIPE_TEST_CHECKOUT", "STRIPE_MODE", "STRIPE_SECRET_KEY", "STRIPE_CHECKOUT_SUCCESS_URL", "STRIPE_CHECKOUT_CANCEL_URL"],
  stripeTestWebhook: ["DB", "PUBLIC_RATE_LIMITER", "STRIPE_MODE", "STRIPE_WEBHOOK_SECRET"],
  stripeLiveCheckout: ["DB", "PUBLIC_RATE_LIMITER", "ENABLE_LIVE_STRIPE_CREDIT_PACKS", "STRIPE_LIVE_SECRET_KEY", "STRIPE_LIVE_WEBHOOK_SECRET", "STRIPE_LIVE_CHECKOUT_SUCCESS_URL", "STRIPE_LIVE_CHECKOUT_CANCEL_URL"],
  stripeLiveSubscriptionCheckout: ["DB", "PUBLIC_RATE_LIMITER", "ENABLE_LIVE_STRIPE_SUBSCRIPTIONS", "STRIPE_LIVE_SECRET_KEY", "STRIPE_LIVE_WEBHOOK_SECRET", "STRIPE_LIVE_SUBSCRIPTION_PRICE_ID", "STRIPE_LIVE_SUBSCRIPTION_SUCCESS_URL", "STRIPE_LIVE_SUBSCRIPTION_CANCEL_URL"],
  stripeLiveSubscriptionManagement: ["DB", "PUBLIC_RATE_LIMITER", "STRIPE_LIVE_SECRET_KEY", "STRIPE_LIVE_SUBSCRIPTION_PRICE_ID"],
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
  safeRead("public.news_pulse.thumb.read", "GET", "/api/public/news-pulse/thumbs/:id", "homepage", {
    auth: "anonymous",
    sensitivity: "low",
    config: ["DB", "USER_IMAGES"],
    rateLimit: { noneReason: "Read-only public thumbnail route; object keys are looked up from ready D1 rows and never accepted from the request." },
  }),
  safeRead("homepage.hero-videos.read", "GET", "/api/homepage/hero-videos", "homepage", {
    auth: "anonymous",
    sensitivity: "low",
    config: ["DB"],
    rateLimit: { noneReason: "Read-only public homepage hero-video config; incomplete or missing configuration returns an empty configured set so the homepage falls back." },
    notes: "Returns only slot, version, and public derivative URLs. It never returns source asset URLs, private /api/ai/text-assets URLs, admin storage URLs, or R2 object keys.",
  }),
  safeRead("homepage.hero-videos.file", "GET", "/api/homepage/hero-videos/:slot/:version/file", "homepage", {
    auth: "anonymous",
    sensitivity: "low",
    config: ["DB", "USER_IMAGES"],
    rateLimit: { noneReason: "Read-only immutable public derivative media; object keys are selected from enabled succeeded slot rows only." },
    notes: "Serves optimized no-audio hero derivatives only; original source videos are not addressable through this route.",
  }),
  safeRead("homepage.hero-videos.poster", "GET", "/api/homepage/hero-videos/:slot/:version/poster", "homepage", {
    auth: "anonymous",
    sensitivity: "low",
    config: ["DB", "USER_IMAGES"],
    rateLimit: { noneReason: "Read-only immutable public derivative poster media; object keys are selected from enabled succeeded slot rows only." },
    notes: "Serves generated hero derivative posters only; original source asset keys are never returned.",
  }),
  policy({
    id: "openclaw.news_pulse.ingest",
    method: "POST",
    path: "/api/openclaw/news-pulse/ingest",
    auth: "anonymous",
    csrf: "not-browser-facing",
    body: { kind: "raw", maxBytesName: "openClawIngestRaw", contentType: "application/json" },
    rateLimit: { id: "openclaw-news-pulse-agent-and-ip", failClosed: true },
    config: REQUIRED_CONFIG.openClawIngest,
    audit: { event: "openclaw_news_pulse_ingest" },
    owner: "homepage",
    sensitivity: "high",
    providerSignature: "openclaw-hmac-sha256",
    billing: {
      budgetScope: "openclaw_news_pulse_budget",
      idempotency: "deterministic OpenClaw item id/content hash plus News Pulse visual status and attempt guards; ready, pending, and exhausted rows suppress duplicate visual provider calls",
      killSwitchTarget: "ENABLE_NEWS_PULSE_VISUAL_BUDGET",
      runtime: "Phase 4.15 enforces the runtime switch before OpenClaw-triggered visual provider calls; public News Pulse read routes remain read-only and not provider-cost-bearing. This is not live budget cap enforcement.",
    },
    notes: "Machine-to-machine OpenClaw ingest only. Raw body is HMAC signed with OPENCLAW_INGEST_SECRET, nonces are stored in D1 for replay protection, accepted items populate the existing public News Pulse cache, and any immediate visual backfill records openclaw_news_pulse_budget metadata before provider execution.",
  }),
  policy({
    id: "gallery.memvids.stream-preview.hover-start",
    method: "POST",
    path: "/api/gallery/memvids/:id/stream-preview/hover-start",
    auth: "anonymous",
    csrf: "same-origin-required",
    body: { kind: "json", maxBytesName: "memvidStreamPreviewTelemetryJson", contentType: "application/json" },
    rateLimit: { noneReason: "Cost telemetry only; request body is tiny and does not trigger provider work or media loading." },
    config: ["DB", "ENABLE_MEMVID_STREAM_PREVIEWS"],
    audit: { noneReason: "Aggregated cost telemetry is stored in memvid_stream_preview_events without user identity or secrets." },
    owner: "homepage",
    sensitivity: "medium",
    notes: "Records lazy desktop hover-start telemetry for ready Cloudflare Stream preview clips. It never serves media, exposes Stream API tokens, or generates previews.",
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
  userJsonWrite("account.billing.checkout.subscription", "POST", "/api/account/billing/checkout/subscription", "billing", "smallJson", "account-billing-live-subscription-checkout-user", {
    config: REQUIRED_CONFIG.stripeLiveSubscriptionCheckout,
    audit: { event: "stripe_live_member_subscription_checkout_created" },
    sensitivity: "high",
    notes: "Live Stripe subscription checkout for BITBI Pro. Requires active account session, ENABLE_LIVE_STRIPE_SUBSCRIPTIONS=true, Stripe live key and webhook readiness, configured live subscription Price ID, Idempotency-Key, current terms and immediate-delivery consent, same-origin mutation protection, and no subscription credits at checkout creation.",
  }),
  userJsonWrite("account.billing.subscription.cancel", "POST", "/api/account/billing/subscription/cancel", "billing", "smallJson", "account-billing-live-subscription-manage-user", {
    config: REQUIRED_CONFIG.stripeLiveSubscriptionManagement,
    audit: { event: "stripe_live_member_subscription_cancel_requested" },
    sensitivity: "high",
    notes: "Authenticated member-only BITBI Pro cancellation management. Calls Stripe Update Subscription with cancel_at_period_end=true, requires Idempotency-Key and explicit confirmation, and preserves paid-period access until current_period_end.",
  }),
  userJsonWrite("account.billing.subscription.reactivate", "POST", "/api/account/billing/subscription/reactivate", "billing", "smallJson", "account-billing-live-subscription-manage-user", {
    config: REQUIRED_CONFIG.stripeLiveSubscriptionManagement,
    audit: { event: "stripe_live_member_subscription_reactivation_requested" },
    sensitivity: "high",
    notes: "Authenticated member-only BITBI Pro cancellation reversal. Calls Stripe Update Subscription with cancel_at_period_end=false only for the signed-in user's still-active subscription that is already scheduled to cancel.",
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
  adminRead("admin.registration.status.read", "/api/admin/registration/status", "admin", {
    config: REQUIRED_CONFIG.authPublicLimiter,
    rateLimit: { id: "admin-action-ip", failClosed: true },
    notes: "Read-only admin registration availability status. Reports whether new account creation is enabled; existing login/session behavior is unaffected.",
  }),
  adminJsonWrite("admin.registration.status.update", "POST", "/api/admin/registration/status", "admin", "smallJson", "admin-action-ip", {
    config: REQUIRED_CONFIG.authPublicLimiter,
    audit: { event: "registration_availability_changed" },
    notes: "Admin-only registration availability switch. Requires admin MFA, same-origin JSON, fail-closed rate limiting, Idempotency-Key, and audit logging; affects new account creation only and does not disable login, password reset, MFA, admin sessions, or existing-user access.",
  }),
  adminRead("admin.readiness.status", "/api/admin/readiness/status", "admin", {
    config: REQUIRED_CONFIG.authPublicLimiter,
    rateLimit: { id: "admin-readiness-status-ip", failClosed: true },
    notes: "Read-only Admin Readiness & Evidence dashboard status. Returns bounded current-state claims, release checkpoint labels, hardening/evidence status, and default-off reset gate boolean only; it performs no provider, Stripe, Cloudflare API, D1 business-data mutation, R2 listing/mutation, reset execution, ownership backfill, or access-switch action.",
  }),
  adminJsonWrite("admin.users.role.update", "PATCH", "/api/admin/users/:id/role", "admin", "smallJson", "admin-action-ip", {
    audit: { event: "change_role" },
    notes: "High-risk admin security state update. Requires admin MFA, same-origin JSON, fail-closed rate limiting, and audit logging; no Idempotency-Key is required because the operation is a single target-state overwrite.",
  }),
  adminJsonWrite("admin.users.status.update", "PATCH", "/api/admin/users/:id/status", "admin", "smallJson", "admin-action-ip", {
    audit: { event: "change_status" },
    notes: "High-risk admin security state update. Requires admin MFA, same-origin JSON, fail-closed rate limiting, and audit logging; no Idempotency-Key is required because the operation is a single target-state overwrite.",
  }),
  adminJsonWrite("admin.users.sessions.revoke", "POST", "/api/admin/users/:id/revoke-sessions", "admin", "smallJson", "admin-action-ip", {
    audit: { event: "revoke_sessions" },
    notes: "High-risk admin session revocation. Requires confirm=true with confirmation=revoke_sessions, admin MFA, same-origin JSON, fail-closed rate limiting, and audit logging before deleting target-user sessions.",
  }),
  adminJsonWrite("admin.users.delete", "DELETE", "/api/admin/users/:id", "admin", "smallJson", "admin-action-ip", {
    audit: { event: "delete_user" },
    notes: "Irreversible high-risk admin operational user deletion. Requires confirm=true with confirmation=delete_user, admin MFA, same-origin JSON, fail-closed rate limiting, and audit logging; operational delete anonymizes/disables the account and user-owned operational data, may optionally start a dry-run/approval-required Data Lifecycle erasure workflow with a second acknowledgement, and does not claim immediate legal/GDPR erasure.",
  }),
  adminRead("admin.users.storage.read", "/api/admin/users/:id/storage", "admin", {
    config: ["DB", "USER_IMAGES", "PUBLIC_RATE_LIMITER", "PAGINATION_SIGNING_SECRET"],
    rateLimit: { id: "admin-storage-read-ip", failClosed: true },
    notes: "Admin-only selected-user Assets Manager inspection. Returns aggregate storage usage plus assets/folders scoped to the target user.",
  }),
  adminRead("admin.users.storage.reconciliation", "/api/admin/users/:id/storage/reconciliation", "admin", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    rateLimit: { id: "admin-storage-read-ip", failClosed: true },
    notes: "Admin-only D1 metadata storage reconciliation dry-run for a selected user. Computes recorded usage, known asset bytes, deltas, counts, and orphan metadata without R2 listing, R2 mutation, D1 mutation, quota repair, backfill, access-switching, or tenant-isolation claims.",
  }),
  adminRead("admin.users.storage.asset.file", "/api/admin/users/:id/assets/:assetId/file", "admin", {
    config: ["DB", "USER_IMAGES", "PUBLIC_RATE_LIMITER"],
    rateLimit: { id: "admin-storage-read-ip", failClosed: true },
    notes: "Admin-only private asset file read. The R2 key is looked up by target user and asset ID; keys are never accepted from the request.",
  }),
  adminJsonWrite("admin.users.storage.asset.rename", "PATCH", "/api/admin/users/:id/assets/:assetId/rename", "admin", "smallJson", "admin-storage-write-ip", {
    audit: { event: "admin_user_asset_renamed" },
    config: ["DB", "USER_IMAGES", "PUBLIC_RATE_LIMITER"],
    notes: "Admin storage metadata mutation. Requires admin MFA, same-origin JSON, fail-closed rate limiting, and audit logging; no raw R2 key is accepted from the request.",
  }),
  adminJsonWrite("admin.users.storage.asset.move", "PATCH", "/api/admin/users/:id/assets/:assetId/folder", "admin", "smallJson", "admin-storage-write-ip", {
    audit: { event: "admin_user_asset_moved" },
    config: ["DB", "USER_IMAGES", "PUBLIC_RATE_LIMITER"],
    notes: "Admin storage metadata mutation. Requires admin MFA, same-origin JSON, fail-closed rate limiting, and audit logging; no raw R2 key is accepted from the request.",
  }),
  adminJsonWrite("admin.users.storage.asset.visibility", "PATCH", "/api/admin/users/:id/assets/:assetId/visibility", "admin", "smallJson", "admin-storage-write-ip", {
    audit: { event: "admin_user_asset_visibility_updated" },
    config: ["DB", "USER_IMAGES", "PUBLIC_RATE_LIMITER"],
    notes: "Admin storage publication-state mutation. Requires admin MFA, same-origin JSON, fail-closed rate limiting, and audit logging; no raw R2 key is accepted from the request.",
  }),
  adminJsonWrite("admin.users.storage.asset.delete", "DELETE", "/api/admin/users/:id/assets/:assetId", "admin", "smallJson", "admin-storage-write-ip", {
    audit: { event: "admin_user_asset_deleted" },
    config: ["DB", "USER_IMAGES", "PUBLIC_RATE_LIMITER"],
    notes: "High-risk admin storage deletion. Requires Idempotency-Key, confirm=true with confirmation=delete_user_asset, bounded reason, admin MFA, same-origin JSON, fail-closed rate limiting, and audit logging; deletion resolves asset IDs to owned D1 rows and never accepts raw R2 keys from the request.",
  }),
  adminJsonWrite("admin.users.storage.folder.rename", "PATCH", "/api/admin/users/:id/folders/:folderId", "admin", "smallJson", "admin-storage-write-ip", {
    audit: { event: "admin_user_folder_renamed" },
    config: ["DB", "USER_IMAGES", "PUBLIC_RATE_LIMITER"],
    notes: "Admin storage folder metadata mutation. Requires admin MFA, same-origin JSON, fail-closed rate limiting, and audit logging.",
  }),
  adminJsonWrite("admin.users.storage.folder.delete", "DELETE", "/api/admin/users/:id/folders/:folderId", "admin", "smallJson", "admin-storage-write-ip", {
    audit: { event: "admin_user_folder_deleted" },
    config: ["DB", "USER_IMAGES", "PUBLIC_RATE_LIMITER"],
    notes: "High-risk admin storage folder deletion. Requires Idempotency-Key, confirm=true with confirmation=delete_user_folder, bounded reason, admin MFA, same-origin JSON, fail-closed rate limiting, and audit logging; folder IDs are scoped to the selected user.",
  }),
  adminRead("admin.stats.read", "/api/admin/stats", "admin"),
  adminRead("admin.operations.timeline", "/api/admin/operations/timeline", "admin", {
    config: ["DB"],
    rateLimit: { noneReason: "Read-only operator timeline aggregates bounded local D1 metadata and never lists R2 or calls external providers." },
    notes: "Admin-only read model for operational triage. Returns bounded redacted event summaries only; does not mutate D1/R2, list live R2, call Stripe/provider APIs, expose raw payloads/secrets/keys, or offer dangerous actions.",
  }),
  adminRead("admin.orgs.list", "/api/admin/orgs", "organizations", {
    config: REQUIRED_CONFIG.authPublicLimiter,
    rateLimit: { id: "admin-org-read-ip", failClosed: true },
  }),
  adminRead("admin.orgs.read", "/api/admin/orgs/:id", "organizations", {
    config: REQUIRED_CONFIG.authPublicLimiter,
    rateLimit: { id: "admin-org-read-ip", failClosed: true },
  }),
  adminRead("admin.orgs.user-access.list", "/api/admin/orgs/:id/user-access", "organizations", {
    config: REQUIRED_CONFIG.authPublicLimiter,
    rateLimit: { id: "admin-org-read-ip", failClosed: true },
    notes: "Admin-only organization user access read model. Returns bounded user membership state only; no tenant isolation claim and no Admin AI organization-context bypass.",
  }),
  adminJsonWrite("admin.orgs.users.assign", "PUT", "/api/admin/orgs/:id/users/:userId", "organizations", "smallJson", "admin-org-write-ip", {
    config: REQUIRED_CONFIG.authPublicLimiter,
    audit: { event: "organization_member_assigned" },
    notes: "Admin-only organization membership target-state assignment. Requires Idempotency-Key, admin MFA, same-origin JSON, fail-closed rate limiting, and audit logging; writes organization_memberships only and does not override tenant isolation, billing, AI budget safety, or Admin AI organization-context guards.",
  }),
  adminJsonWrite("admin.orgs.users.remove", "DELETE", "/api/admin/orgs/:id/users/:userId", "organizations", "smallJson", "admin-org-write-ip", {
    config: REQUIRED_CONFIG.authPublicLimiter,
    audit: { event: "organization_member_removed" },
    notes: "Admin-only organization membership target-state removal. Requires Idempotency-Key, admin MFA, same-origin JSON, fail-closed rate limiting, audit logging, and final owner/admin protection; writes organization_memberships status only and does not override tenant isolation, billing, AI budget safety, or Admin AI organization-context guards.",
  }),
  adminRead("admin.billing.plans.list", "/api/admin/billing/plans", "billing", {
    config: REQUIRED_CONFIG.authPublicLimiter,
    rateLimit: { id: "admin-billing-read-ip", failClosed: true },
  }),
  adminRead("admin.billing.evidence.status", "/api/admin/billing/evidence/status", "billing", {
    config: REQUIRED_CONFIG.authPublicLimiter,
    rateLimit: { id: "admin-billing-read-ip", failClosed: true },
    notes: "Read-only redacted live billing configuration evidence. Reports env presence/shape and static catalog facts only; does not call Stripe, create checkout sessions, mutate D1, process webhooks, or expose secrets.",
  }),
  adminRead("admin.orgs.billing.read", "/api/admin/orgs/:id/billing", "billing", {
    config: REQUIRED_CONFIG.authPublicLimiter,
    rateLimit: { id: "admin-billing-read-ip", failClosed: true },
  }),
  adminJsonWrite("admin.orgs.credits.grant", "POST", "/api/admin/orgs/:id/credits/grant", "billing", "smallJson", "admin-billing-write-ip", {
    config: REQUIRED_CONFIG.authPublicLimiter,
    audit: { event: "organization_credit_granted" },
    notes: "High-risk admin-only manual grant. Requires Idempotency-Key, bounded reason, admin MFA, same-origin JSON, fail-closed rate limiting, and audit logging; does not call Stripe or imply live billing readiness.",
  }),
  adminRead("admin.users.billing.read", "/api/admin/users/:id/billing", "billing", {
    config: REQUIRED_CONFIG.authPublicLimiter,
    rateLimit: { id: "admin-billing-read-ip", failClosed: true },
  }),
  adminJsonWrite("admin.users.credits.grant", "POST", "/api/admin/users/:id/credits/grant", "billing", "smallJson", "admin-billing-write-ip", {
    config: REQUIRED_CONFIG.authPublicLimiter,
    audit: { event: "user_credit_granted" },
    notes: "High-risk admin-only manual grant. Requires Idempotency-Key, bounded reason, admin MFA, same-origin JSON, fail-closed rate limiting, and audit logging; does not call Stripe or imply live billing readiness.",
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
  adminRead("admin.billing.reconciliation.read", "/api/admin/billing/reconciliation", "billing", {
    config: REQUIRED_CONFIG.authPublicLimiter,
    rateLimit: { id: "admin-billing-read-ip", failClosed: true },
    notes: "Read-only local-D1 billing reconciliation report for operators. Does not call Stripe, mutate credits, mutate subscriptions, resolve reviews, or remediate billing state.",
  }),
  adminRead("admin.billing.reviews.list", "/api/admin/billing/reviews", "billing", {
    config: REQUIRED_CONFIG.authPublicLimiter,
    rateLimit: { id: "admin-billing-read-ip", failClosed: true },
    notes: "Read-only operator review queue for live Stripe lifecycle events. Returns sanitized review metadata only.",
  }),
  adminRead("admin.billing.reviews.read", "/api/admin/billing/reviews/:id", "billing", {
    config: REQUIRED_CONFIG.authPublicLimiter,
    rateLimit: { id: "admin-billing-read-ip", failClosed: true },
    notes: "Read-only sanitized billing lifecycle review detail. Raw webhook payloads, signatures, secrets, and payment method data are not returned.",
  }),
  adminJsonWrite("admin.billing.reviews.resolve", "POST", "/api/admin/billing/reviews/:id/resolution", "billing", "smallJson", "admin-billing-write-ip", {
    config: REQUIRED_CONFIG.authPublicLimiter,
    audit: { event: "billing_review_resolution_recorded" },
    notes: "Admin-only manual resolved/dismissed marker for operator-review billing lifecycle events. Requires Idempotency-Key, admin MFA, same-origin JSON, fail-closed rate limiting, and audit logging; does not call Stripe, reverse credits, cancel subscriptions, alter raw provider payloads, or credit accounts.",
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
    notes: "High-risk admin lifecycle request creation. Requires Idempotency-Key, admin MFA, same-origin JSON, fail-closed rate limiting, and audit logging; creates planning metadata only and performs no export/delete execution.",
  }),
  adminRead("admin.data-lifecycle.requests.read", "/api/admin/data-lifecycle/requests/:id", "privacy", {
    config: REQUIRED_CONFIG.authPublicLimiter,
    rateLimit: { id: "admin-data-lifecycle-ip", failClosed: true },
  }),
  adminRead("admin.data-lifecycle.requests.evidence", "/api/admin/data-lifecycle/requests/:id/evidence", "privacy", {
    config: REQUIRED_CONFIG.authPublicLimiter,
    rateLimit: { id: "admin-data-lifecycle-ip", failClosed: true },
    notes: "Read-only admin data lifecycle evidence packet. Returns bounded JSON/Markdown/HTML summaries for legal/storage documentation and never renders raw R2 keys, raw idempotency keys, request hashes, cookies, auth headers, tokens, Stripe payloads, or secret values.",
  }),
  adminJsonWrite("admin.data-lifecycle.requests.plan", "POST", "/api/admin/data-lifecycle/requests/:id/plan", "privacy", "smallJson", "admin-data-lifecycle-ip", {
    config: REQUIRED_CONFIG.authPublicLimiter,
    audit: { event: "data_lifecycle_request_planned" },
    notes: "High-risk admin lifecycle planning requires Idempotency-Key, admin MFA, same-origin JSON, fail-closed rate limiting, and audit logging before mutating plan/item state.",
  }),
  adminJsonWrite("admin.data-lifecycle.requests.approve", "POST", "/api/admin/data-lifecycle/requests/:id/approve", "privacy", "smallJson", "admin-data-lifecycle-ip", {
    config: REQUIRED_CONFIG.authPublicLimiter,
    audit: { event: "data_lifecycle_request_approved" },
    notes: "High-risk admin lifecycle approval. Requires Idempotency-Key, confirm=true, admin MFA, same-origin JSON, fail-closed rate limiting, and audit logging before moving a reviewed request into approved state.",
  }),
  adminJsonWrite("admin.data-lifecycle.requests.generate-export", "POST", "/api/admin/data-lifecycle/requests/:id/generate-export", "privacy", "smallJson", "admin-data-lifecycle-ip", {
    config: ["DB", "PUBLIC_RATE_LIMITER", "AUDIT_ARCHIVE"],
    audit: { event: "data_lifecycle_export_archive_generated" },
    notes: "High-risk private export archive generation. Requires Idempotency-Key, confirm=true, admin MFA, same-origin JSON, fail-closed rate limiting, AUDIT_ARCHIVE, audit logging, bounded archive output, and raw private R2 key redaction.",
  }),
  adminJsonWrite("admin.data-lifecycle.requests.execute-safe", "POST", "/api/admin/data-lifecycle/requests/:id/execute-safe", "privacy", "smallJson", "admin-data-lifecycle-ip", {
    config: ["DB", "PUBLIC_RATE_LIMITER", "AUDIT_ARCHIVE"],
    audit: { event: "data_lifecycle_safe_actions_executed" },
    notes: "High-risk admin lifecycle safe executor. Requires Idempotency-Key; dryRun=false additionally requires confirm=true. Execution requires approved plan state, blocks destructive modes, emits audit logging, and does not expose raw private R2 keys.",
  }),
  adminJsonWrite("admin.data-lifecycle.requests.complete", "POST", "/api/admin/data-lifecycle/requests/:id/complete", "privacy", "smallJson", "admin-data-lifecycle-ip", {
    config: REQUIRED_CONFIG.authPublicLimiter,
    audit: { event: "data_lifecycle_request_completed" },
    notes: "High-risk admin lifecycle final completion marker. Requires Idempotency-Key, confirm=true, completion note, admin MFA, same-origin JSON, fail-closed rate limiting, and audit logging. It records final evidence/retention truth only and does not execute deletion or purge retained legal/billing/audit/provider records.",
  }),
  adminJsonWrite("admin.data-lifecycle.requests.reject", "POST", "/api/admin/data-lifecycle/requests/:id/reject", "privacy", "smallJson", "admin-data-lifecycle-ip", {
    config: REQUIRED_CONFIG.authPublicLimiter,
    audit: { event: "data_lifecycle_request_rejected" },
    notes: "High-risk admin lifecycle rejection marker. Requires Idempotency-Key, confirm=true, reason, admin MFA, same-origin JSON, fail-closed rate limiting, and audit logging; status-only update with no data deletion.",
  }),
  adminJsonWrite("admin.data-lifecycle.requests.close", "POST", "/api/admin/data-lifecycle/requests/:id/close", "privacy", "smallJson", "admin-data-lifecycle-ip", {
    config: REQUIRED_CONFIG.authPublicLimiter,
    audit: { event: "data_lifecycle_request_closed" },
    notes: "High-risk admin lifecycle close/legal-review-block marker. Requires Idempotency-Key, confirm=true, reason, admin MFA, same-origin JSON, fail-closed rate limiting, and audit logging; status-only update with no data deletion.",
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
    notes: "High-risk private export archive cleanup. Requires Idempotency-Key, confirm=true, admin MFA, same-origin JSON, fail-closed rate limiting, audit logging, approved data-exports/ prefix validation, bounded cleanup, and raw private R2 key redaction.",
  }),
  adminRead("admin.data-lifecycle.exports.read", "/api/admin/data-lifecycle/exports/:archiveId", "privacy", {
    config: ["DB", "PUBLIC_RATE_LIMITER", "AUDIT_ARCHIVE"],
    rateLimit: { id: "admin-data-lifecycle-ip", failClosed: true },
  }),
  adminRead("admin.tenant-assets.folders-images.evidence.read", "/api/admin/tenant-assets/folders-images/evidence", "privacy", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    rateLimit: { id: "admin-tenant-asset-evidence-ip", failClosed: true },
    sensitivity: "high",
    notes: "Phase 6.7 read-only tenant asset ownership evidence report for ai_folders and ai_images. It compares legacy user_id signals with ownership metadata using bounded local D1 reads only; no access-check switch, backfill, D1 mutation, R2 listing, provider call, Stripe call, credit mutation, or billing behavior change.",
  }),
  adminRead("admin.tenant-assets.folders-images.evidence.export", "/api/admin/tenant-assets/folders-images/evidence/export", "privacy", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    rateLimit: { id: "admin-tenant-asset-evidence-ip", failClosed: true },
    sensitivity: "high",
    notes: "Phase 6.7 bounded sanitized tenant asset ownership evidence export for ai_folders and ai_images. Supports JSON and Markdown, omits prompts and private R2 keys, and performs no access, data, R2, provider, Stripe, credit, or billing mutation.",
  }),
  adminRead("admin.tenant-assets.domains.evidence.read", "/api/admin/tenant-assets/domains/evidence", "privacy", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    rateLimit: { id: "admin-tenant-asset-evidence-ip", failClosed: true },
    sensitivity: "high",
    notes: "Read-only cross-domain tenant asset inventory and evidence-readiness report. It uses bounded local D1 metadata counts plus the repo domain registry, never lists or mutates R2, performs no D1 mutation, ownership backfill, access switch, reset/delete, provider call, Stripe call, Cloudflare/GitHub API call, credit mutation, or readiness claim.",
  }),
  adminRead("admin.tenant-assets.ownership-backfill.dry-run", "/api/admin/tenant-assets/ownership-backfill/dry-run", "privacy", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    rateLimit: { id: "admin-tenant-asset-evidence-ip", failClosed: true },
    sensitivity: "high",
    notes: "P2 read-only ownership backfill dry-run for supported ai_folders/ai_images rows. It classifies safe/manual-review/public/missing-evidence/deferred candidates, never lists R2, performs no D1 mutation, and does not claim tenant isolation or backfill readiness.",
  }),
  adminRead("admin.tenant-assets.ownership-backfill.evidence", "/api/admin/tenant-assets/ownership-backfill/evidence", "privacy", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    rateLimit: { id: "admin-tenant-asset-evidence-ip", failClosed: true },
    sensitivity: "high",
    notes: "P2 bounded sanitized ownership backfill evidence export. Supports JSON/Markdown/HTML and exposes no private R2 keys, raw prompts, raw idempotency keys, cookies, auth headers, tokens, secrets, provider payloads, or readiness claims.",
  }),
  adminJsonWrite("admin.tenant-assets.ownership-backfill.execute", "POST", "/api/admin/tenant-assets/ownership-backfill/execute", "privacy", "smallJson", "admin-tenant-isolation-execution-ip", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    sensitivity: "high",
    audit: { event: "tenant_isolation_ownership_backfill_executed" },
    notes: "P2 high-risk ownership backfill executor. Requires admin/MFA, Idempotency-Key, confirm=true, exact confirmation phrase BACKFILL OWNERSHIP, bounded reason, explicit supported domains, and fail-closed rate limiting. Dry-run is default. Non-dry-run may write ownership metadata only for locally classified safe ai_folders/ai_images rows; unsafe/manual-review/public/missing-evidence/deferred rows remain blocked. It performs no access switch, no reset/delete, no R2 listing/mutation, no provider/Stripe/Cloudflare calls, no billing/credit mutation, and no tenant isolation claim.",
  }),
  adminRead("admin.tenant-assets.access-switch.status", "/api/admin/tenant-assets/access-switch/status", "privacy", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    rateLimit: { id: "admin-tenant-asset-evidence-ip", failClosed: true },
    sensitivity: "high",
    notes: "P2 read-only access-switch status. It reports legacy access mode, lack of durable enforced switch support, disabled reasons, and blocked tenant isolation claims without changing runtime decisions.",
  }),
  adminRead("admin.tenant-assets.access-switch.shadow-diagnostics", "/api/admin/tenant-assets/access-switch/shadow-diagnostics", "privacy", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    rateLimit: { id: "admin-tenant-asset-evidence-ip", failClosed: true },
    sensitivity: "high",
    notes: "P2 read-only access-switch shadow diagnostics. It compares legacy user_id and ownership metadata signals using bounded D1 reads only; no runtime access decision changes, R2 listing, source row mutation, or tenant isolation claim.",
  }),
  adminRead("admin.tenant-assets.access-switch.evidence", "/api/admin/tenant-assets/access-switch/evidence", "privacy", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    rateLimit: { id: "admin-tenant-asset-evidence-ip", failClosed: true },
    sensitivity: "high",
    notes: "P2 bounded sanitized access-switch evidence export. It documents shadow diagnostics and disabled enforced-mode reasons only; no runtime switch is exposed.",
  }),
  adminRead("admin.tenant-assets.legacy-media-reset.status", "/api/admin/tenant-assets/legacy-media-reset/status", "privacy", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    rateLimit: { id: "admin-tenant-asset-legacy-media-reset-ip", failClosed: true },
    sensitivity: "high",
    notes: "P2 read-only legacy media reset status endpoint. It reports dry-run availability, confirmed execution gate boolean presence/status without exposing values, blocked evidence/readiness, and performs no reset, source mutation, or R2 action.",
  }),
  adminRead("admin.tenant-assets.legacy-media-reset.evidence", "/api/admin/tenant-assets/legacy-media-reset/evidence", "privacy", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    rateLimit: { id: "admin-tenant-asset-legacy-media-reset-ip", failClosed: true },
    sensitivity: "high",
    notes: "P2 bounded sanitized legacy media reset evidence export. Supports JSON/Markdown/HTML, includes status and dry-run evidence, exposes no raw private keys/idempotency keys, and performs no reset execution.",
  }),
  adminRead("admin.tenant-assets.tenant-isolation.evidence", "/api/admin/tenant-assets/tenant-isolation/evidence", "privacy", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    rateLimit: { id: "admin-tenant-asset-evidence-ip", failClosed: true },
    sensitivity: "high",
    notes: "P2 combined tenant isolation execution evidence packet for backfill, access-switch, and legacy reset. It is local D1/read-only except where separately approved executor endpoints are called, and it performs no mutation.",
  }),
  adminRead("admin.tenant-assets.legacy-media-reset.dry-run", "/api/admin/tenant-assets/legacy-media-reset/dry-run", "privacy", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    rateLimit: { id: "admin-tenant-asset-legacy-media-reset-ip", failClosed: true },
    sensitivity: "high",
    notes: "Phase 6.21 read-only legacy personal media reset dry run. It inventories D1 rows and reset classifications only; no delete executor, source asset mutation, review row mutation, ownership backfill, access-check switch, R2 listing/mutation, provider call, Stripe call, credit mutation, or billing behavior change.",
  }),
  adminRead("admin.tenant-assets.legacy-media-reset.dry-run.export", "/api/admin/tenant-assets/legacy-media-reset/dry-run/export", "privacy", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    rateLimit: { id: "admin-tenant-asset-legacy-media-reset-ip", failClosed: true },
    sensitivity: "high",
    notes: "Phase 6.21 bounded sanitized JSON/Markdown export for legacy media reset dry-run evidence. It uses D1-only counts, omits prompts/private R2 keys/raw metadata, and performs no deletion, R2 listing/mutation, ownership backfill, source row update, access switch, provider call, Stripe call, credit mutation, or billing behavior change.",
  }),
  adminJsonWrite("admin.tenant-assets.legacy-media-reset.execute", "POST", "/api/admin/tenant-assets/legacy-media-reset/execute", "privacy", "smallJson", "admin-tenant-asset-legacy-media-reset-ip", {
    config: ["DB", "PUBLIC_RATE_LIMITER", "USER_IMAGES"],
    sensitivity: "high",
    audit: { event: "tenant_asset_legacy_media_reset_execute_requested" },
    notes: "Phase 6.23 admin-approved legacy media reset executor. Defaults to dry-run; confirmed execution is hard-disabled unless optional env gate ENABLE_LEGACY_MEDIA_RESET_CONFIRMED_EXECUTION is exactly true. If that gate is enabled in a future approved phase, confirmed execution still requires Idempotency-Key, confirm=true, bounded reason, explicit public/no-credit/irreversible acknowledgements, admin MFA, same-origin JSON, and fail-closed rate limiting. It is limited to first-pass ai_folders/ai_images/derivative/public references, rejects video/music/text/profile/avatar/export/audit domains, performs no ownership backfill, no access switch, no billing/credit mutation, no provider/Stripe/Cloudflare API calls, and never lists R2 or exposes raw R2 keys.",
  }),
  adminRead("admin.tenant-assets.legacy-media-reset.actions.list", "/api/admin/tenant-assets/legacy-media-reset/actions", "privacy", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    rateLimit: { id: "admin-tenant-asset-legacy-media-reset-ip", failClosed: true },
    sensitivity: "high",
    notes: "Phase 6.23 read-only sanitized legacy media reset action list. It reads action/audit rows only and performs no deletion, source asset mutation, R2 action, ownership backfill, access switch, provider call, Stripe call, credit mutation, or billing behavior change.",
  }),
  adminRead("admin.tenant-assets.legacy-media-reset.actions.read", "/api/admin/tenant-assets/legacy-media-reset/actions/:id", "privacy", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    rateLimit: { id: "admin-tenant-asset-legacy-media-reset-ip", failClosed: true },
    sensitivity: "high",
    notes: "Phase 6.23 read-only sanitized legacy media reset action detail endpoint. It hides raw idempotency keys, request hashes, and private R2 keys.",
  }),
  adminRead("admin.tenant-assets.legacy-media-reset.actions.evidence", "/api/admin/tenant-assets/legacy-media-reset/actions/:id/evidence", "privacy", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    rateLimit: { id: "admin-tenant-asset-legacy-media-reset-ip", failClosed: true },
    sensitivity: "high",
    notes: "Phase 6.23 read-only legacy media reset action evidence report. It reports action/event counts and keeps accessSwitchReady=false, backfillReady=false, tenantIsolationClaimed=false, and productionReadiness=blocked.",
  }),
  adminRead("admin.tenant-assets.legacy-media-reset.actions.export", "/api/admin/tenant-assets/legacy-media-reset/actions/:id/export", "privacy", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    rateLimit: { id: "admin-tenant-asset-legacy-media-reset-ip", failClosed: true },
    sensitivity: "high",
    notes: "Phase 6.23 bounded sanitized JSON/Markdown export for legacy media reset action evidence. It exposes no raw private R2 keys or raw idempotency keys.",
  }),
  adminJsonWrite("admin.tenant-assets.folders-images.manual-review.import", "POST", "/api/admin/tenant-assets/folders-images/manual-review/import", "privacy", "smallJson", "admin-tenant-asset-manual-review-import-ip", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    sensitivity: "high",
    audit: { event: "tenant_asset_manual_review_import_requested" },
    notes: "Phase 6.15 admin-approved manual-review import executor. Defaults to dry-run; confirmed execution requires Idempotency-Key, confirm=true, and reason, and writes only ai_asset_manual_review_items/events. It performs no ownership backfill, access-check switch, ai_folders/ai_images update, R2 listing/mutation, provider call, Stripe call, credit mutation, or billing behavior change.",
  }),
  adminRead("admin.tenant-assets.folders-images.manual-review.items.list", "/api/admin/tenant-assets/folders-images/manual-review/items", "privacy", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    rateLimit: { id: "admin-tenant-asset-manual-review-queue-ip", failClosed: true },
    sensitivity: "high",
    notes: "Phase 6.16 read-only manual-review queue list for ai_folders/images review items. It is bounded and sanitized, exposes no raw prompts, private R2 keys, idempotency keys, request hashes, provider bodies, Stripe data, or Cloudflare tokens, and performs no status update, backfill, access switch, source asset mutation, R2 action, provider call, credit mutation, or billing behavior change.",
  }),
  adminRead("admin.tenant-assets.folders-images.manual-review.items.read", "/api/admin/tenant-assets/folders-images/manual-review/items/:id", "privacy", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    rateLimit: { id: "admin-tenant-asset-manual-review-queue-ip", failClosed: true },
    sensitivity: "high",
    notes: "Phase 6.16 read-only sanitized manual-review item detail endpoint. It reads only ai_asset_manual_review_items and optionally events; no source asset rows, ownership metadata, access checks, R2 objects, billing, credits, provider calls, or statuses are mutated.",
  }),
  adminRead("admin.tenant-assets.folders-images.manual-review.items.events", "/api/admin/tenant-assets/folders-images/manual-review/items/:id/events", "privacy", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    rateLimit: { id: "admin-tenant-asset-manual-review-queue-ip", failClosed: true },
    sensitivity: "high",
    notes: "Phase 6.16 read-only sanitized manual-review event history endpoint. It hides raw idempotency keys and request hashes and performs no status update, note, backfill, access switch, source asset mutation, R2 action, provider call, credit mutation, or billing behavior change.",
  }),
  adminJsonWrite("admin.tenant-assets.folders-images.manual-review.items.status.update", "POST", "/api/admin/tenant-assets/folders-images/manual-review/items/:id/status", "privacy", "smallJson", "admin-tenant-asset-manual-review-status-ip", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    sensitivity: "high",
    audit: { event: "tenant_asset_manual_review_status_update_requested" },
    notes: "Admin-approved manual-review status workflow. Requires Idempotency-Key, confirm=true, bounded reason, admin auth/MFA, same-origin JSON, and fail-closed rate limiting; writes only ai_asset_manual_review_items.review_status/review metadata and ai_asset_manual_review_events. It performs no ownership backfill, access-check switch, ai_folders/ai_images update, ownership metadata update, R2 listing/mutation, provider call, Stripe call, credit mutation, or billing behavior change.",
  }),
  adminRead("admin.tenant-assets.folders-images.manual-review.evidence.read", "/api/admin/tenant-assets/folders-images/manual-review/evidence", "privacy", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    rateLimit: { id: "admin-tenant-asset-manual-review-queue-ip", failClosed: true },
    sensitivity: "high",
    notes: "Phase 6.16 read-only manual-review queue evidence report. It summarizes review items/events and keeps accessSwitchReady=false, backfillReady=false, tenantIsolationClaimed=false, and productionReadiness=blocked.",
  }),
  adminRead("admin.tenant-assets.folders-images.manual-review.evidence.export", "/api/admin/tenant-assets/folders-images/manual-review/evidence/export", "privacy", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    rateLimit: { id: "admin-tenant-asset-manual-review-queue-ip", failClosed: true },
    sensitivity: "high",
    notes: "Phase 6.16 bounded sanitized JSON/Markdown export for manual-review queue evidence. It performs no status update, ownership backfill, access switch, source asset mutation, R2 action, provider call, Stripe call, credit mutation, or billing behavior change.",
  }),
  adminRead("admin.tenant-assets.manual-review.post-cleanup.dry-run", "/api/admin/tenant-assets/manual-review/post-cleanup/dry-run", "privacy", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    rateLimit: { id: "admin-tenant-asset-manual-review-queue-ip", failClosed: true },
    sensitivity: "high",
    notes: "OMEGA-P2-03 read-only post-cleanup manual-review classifier. It compares current D1 review rows with bounded ai_folders/ai_images metadata, exposes only redacted classifications, performs no D1 mutation, no source asset update, no R2 listing/mutation, no Backfill, no Access-Switch, no Reset, and no tenant-isolation claim.",
  }),
  adminRead("admin.tenant-assets.manual-review.post-cleanup.evidence", "/api/admin/tenant-assets/manual-review/post-cleanup/evidence", "privacy", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    rateLimit: { id: "admin-tenant-asset-manual-review-queue-ip", failClosed: true },
    sensitivity: "high",
    notes: "OMEGA-P2-03 bounded sanitized post-cleanup manual-review supersession evidence export. Supports JSON/Markdown/HTML, exposes no raw private R2 keys, raw idempotency keys, request hashes, secrets, tokens, cookies, provider payloads, Stripe data, or readiness claims, and performs no mutation.",
  }),
  adminJsonWrite("admin.tenant-assets.manual-review.post-cleanup.supersede", "POST", "/api/admin/tenant-assets/manual-review/post-cleanup/supersede", "privacy", "smallJson", "admin-tenant-asset-manual-review-supersede-ip", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    sensitivity: "high",
    audit: { event: "tenant_asset_manual_review_post_cleanup_supersede_requested" },
    notes: "OMEGA-P2-03 guarded manual-review supersession executor. Requires Admin/MFA, same-origin JSON, fail-closed rate limiting, Idempotency-Key, confirm=true, exact confirmation phrase SUPERSEDE STALE REVIEW ITEMS, bounded reason, and explicit batchLimit. Dry-run is default. Non-dry-run may write only ai_asset_manual_review_items review_status=superseded plus superseded events for rows currently classified safe superseded_asset_missing, superseded_after_manual_media_cleanup, or superseded_by_owner_metadata_present; active, blocked, pending manual-review, deferred, legal/privacy, and unknown rows remain untouched. It deletes no rows/assets, performs no Backfill, no Access-Switch, no Reset, no R2 listing/mutation, no provider/Stripe/Cloudflare calls, and no tenant isolation claim.",
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
  adminRead("admin.ai.media-source-candidates", "/api/admin/ai/media-source-candidates", "admin-ai", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    rateLimit: { id: "admin-ai-media-source-candidates-ip", failClosed: true },
    notes: "Read-only Admin AI Lab source picker for Grok Imagine 1.5 Preview. Returns bounded sanitized own saved image/video assets and published Mempic/Memvid metadata only; no R2 keys, signed provider URLs, raw tokens, or private media from other users.",
  }),
  adminRead("admin.ai.video-source-candidates", "/api/admin/ai/video-source-candidates", "admin-ai", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    rateLimit: { id: "admin-ai-video-source-candidates-ip", failClosed: true },
    notes: "Read-only Admin AI Lab source picker for Grok Imagine 1.5 Preview extend. Returns bounded sanitized own saved video assets and published Memvid metadata only; no R2 keys, signed provider URLs, raw tokens, or private videos from other users.",
  }),
  adminRead("admin.ai.budget-evidence.read", "/api/admin/ai/budget-evidence", "admin-ai", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    rateLimit: { id: "admin-ai-budget-evidence-ip", failClosed: true },
    notes: "Read-only Phase 4.4 Admin/Platform AI budget evidence report built from local registry, baseline, and route-policy metadata. No provider, Stripe, credit, D1 write, R2 write, or remediation action.",
  }),
  adminRead("admin.ai.budget-switches.read", "/api/admin/ai/budget-switches", "admin-ai", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    rateLimit: { id: "admin-ai-budget-switches-ip", failClosed: true },
    sensitivity: "high",
    notes: "Phase 4.15.1 admin-only AI budget switch list. Returns safe Cloudflare master status and D1 app switch state only; never returns Cloudflare values or secrets and does not mutate provider, billing, credit, or cap state.",
  }),
  adminJsonWrite("admin.ai.budget-switches.update", "PATCH", "/api/admin/ai/budget-switches/:switchKey", "admin-ai", "smallJson", "admin-ai-budget-switches-write-ip", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    sensitivity: "high",
    audit: { event: "admin_ai_budget_switch_updated" },
    notes: "Phase 4.15.1 app-level D1 switch update for allowlisted already budget-classified admin/platform AI paths. Requires Idempotency-Key, reason, admin auth/MFA, same-origin JSON, and fail-closed rate limiting. It does not call Cloudflare APIs, edit Worker variables, call providers, mutate credits, or enforce live platform caps.",
  }),
  adminRead("admin.ai.platform-budget-caps.read", "/api/admin/ai/platform-budget-caps", "admin-ai", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    rateLimit: { id: "admin-ai-platform-budget-caps-ip", failClosed: true },
    sensitivity: "high",
    notes: "Phase 4.17 admin-only platform_admin_lab_budget cap read API. Returns bounded daily/monthly cap limits and sanitized usage summaries only; no provider, Cloudflare, Stripe, credit, or billing mutation.",
  }),
  adminJsonWrite("admin.ai.platform-budget-caps.update", "PATCH", "/api/admin/ai/platform-budget-caps/:budgetScope", "admin-ai", "smallJson", "admin-ai-platform-budget-caps-write-ip", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    sensitivity: "high",
    audit: { event: "admin_ai_platform_budget_cap_updated" },
    notes: "Phase 4.17 D1-only platform_admin_lab_budget cap update. Requires Idempotency-Key, bounded reason, admin auth/MFA, same-origin JSON, and fail-closed rate limiting. It does not call providers, mutate Cloudflare, call Stripe, or change customer billing.",
  }),
  adminRead("admin.ai.platform-budget-usage.read", "/api/admin/ai/platform-budget-usage", "admin-ai", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    rateLimit: { id: "admin-ai-platform-budget-usage-ip", failClosed: true },
    sensitivity: "high",
    notes: "Phase 4.17 sanitized platform_admin_lab_budget usage summary. Bounded read-only reporting over platform_budget_usage_events; no raw prompts, provider bodies, Stripe data, Cloudflare values, or secrets.",
  }),
  adminRead("admin.ai.platform-budget-reconciliation.read", "/api/admin/ai/platform-budget-reconciliation", "admin-ai", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    rateLimit: { id: "admin-ai-platform-budget-reconciliation-ip", failClosed: true },
    sensitivity: "high",
    notes: "Phase 4.18 read-only platform_admin_lab_budget reconciliation and repair-evidence API. It reports bounded sanitized missing/duplicate/orphan/failed-source/window mismatch candidates only; no provider call, queue mutation, D1 write, credit mutation, Stripe call, Cloudflare mutation, or customer billing change.",
  }),
  adminJsonWrite("admin.ai.platform-budget-reconciliation.repair", "POST", "/api/admin/ai/platform-budget-reconciliation/repair", "admin-ai", "smallJson", "admin-ai-platform-budget-repair-write-ip", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    sensitivity: "high",
    audit: { event: "admin_ai_platform_budget_repair_requested" },
    notes: "Phase 4.19 explicit admin-approved platform_admin_lab_budget repair executor. Requires Idempotency-Key, bounded reason, confirmation for execution, admin auth/MFA, same-origin JSON, and fail-closed rate limiting. Only create_missing_usage_event can create a platform_budget_usage_events row from still-successful local D1 source evidence; review-only actions record repair audit rows only. No provider, AI Worker, Stripe, credit, source attempt/job, Cloudflare, or customer billing mutation.",
  }),
  adminRead("admin.ai.platform-budget-repair-actions.read", "/api/admin/ai/platform-budget-repair-actions", "admin-ai", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    rateLimit: { id: "admin-ai-platform-budget-repair-actions-ip", failClosed: true },
    sensitivity: "high",
    notes: "Phase 4.19 bounded read-only list of sanitized platform budget repair action audit rows. No provider, Stripe, credit, source attempt/job, or billing mutation.",
  }),
  adminRead("admin.ai.platform-budget-repair-actions.detail", "/api/admin/ai/platform-budget-repair-actions/:id", "admin-ai", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    rateLimit: { id: "admin-ai-platform-budget-repair-actions-ip", failClosed: true },
    sensitivity: "high",
    notes: "Phase 4.19 bounded read-only detail for one sanitized platform budget repair action audit row. Raw prompts, provider bodies, raw idempotency keys, secrets, Stripe data, Cloudflare values, and billing data are omitted.",
  }),
  adminRead("admin.ai.platform-budget-repair-report.read", "/api/admin/ai/platform-budget-repair-report", "admin-ai", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    rateLimit: { id: "admin-ai-platform-budget-repair-report-ip", failClosed: true },
    sensitivity: "high",
    notes: "Phase 4.20 read-only platform_admin_lab_budget repair evidence report. Supports bounded filters and sanitized local D1 summaries only; no provider, Stripe, credit, source attempt/job, usage event, repair action, Cloudflare, or billing mutation.",
  }),
  adminRead("admin.ai.platform-budget-repair-report.export", "/api/admin/ai/platform-budget-repair-report/export", "admin-ai", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    rateLimit: { id: "admin-ai-platform-budget-repair-report-ip", failClosed: true },
    sensitivity: "high",
    notes: "Phase 4.20 read-only platform_admin_lab_budget repair evidence export. Returns bounded sanitized JSON or Markdown evidence only; no repair execution, automatic repair, provider call, Stripe call, credit mutation, source row mutation, or billing mutation.",
  }),
  adminJsonWrite("admin.ai.platform-budget-evidence-archives.create", "POST", "/api/admin/ai/platform-budget-evidence-archives", "admin-ai", "smallJson", "admin-ai-platform-budget-evidence-archives-write-ip", {
    config: ["DB", "PUBLIC_RATE_LIMITER", "AUDIT_ARCHIVE"],
    sensitivity: "high",
    audit: { event: "admin_ai_platform_budget_evidence_archive_created" },
    notes: "Phase 4.21 admin-approved platform_admin_lab_budget evidence archive creation. Requires Idempotency-Key, bounded reason, admin auth/MFA, same-origin JSON, fail-closed rate limiting, and AUDIT_ARCHIVE. Writes only sanitized archive metadata plus an AUDIT_ARCHIVE object under platform-budget-evidence/; no repair, provider, Stripe, Cloudflare, credit, source attempt/job, member/org billing, or customer billing mutation.",
  }),
  adminRead("admin.ai.platform-budget-evidence-archives.read", "/api/admin/ai/platform-budget-evidence-archives", "admin-ai", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    rateLimit: { id: "admin-ai-platform-budget-evidence-archives-ip", failClosed: true },
    sensitivity: "high",
    notes: "Phase 4.21 bounded admin-only list of sanitized platform budget evidence archive metadata. It omits private R2 keys and raw archive content.",
  }),
  adminRead("admin.ai.platform-budget-evidence-archives.detail", "/api/admin/ai/platform-budget-evidence-archives/:id", "admin-ai", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    rateLimit: { id: "admin-ai-platform-budget-evidence-archives-ip", failClosed: true },
    sensitivity: "high",
    notes: "Phase 4.21 admin-only detail for one sanitized platform budget evidence archive metadata row. Private R2 keys, raw prompts, provider bodies, raw idempotency keys, Stripe data, Cloudflare values, and secrets are omitted.",
  }),
  adminRead("admin.ai.platform-budget-evidence-archives.download", "/api/admin/ai/platform-budget-evidence-archives/:id/download", "admin-ai", {
    config: ["DB", "PUBLIC_RATE_LIMITER", "AUDIT_ARCHIVE"],
    rateLimit: { id: "admin-ai-platform-budget-evidence-archives-ip", failClosed: true },
    sensitivity: "high",
    notes: "Phase 4.21 admin-only download of a previously created sanitized platform budget evidence archive from AUDIT_ARCHIVE. Reads only approved platform-budget-evidence/ prefix objects and performs no repair or billing/provider action.",
  }),
  adminJsonWrite("admin.ai.platform-budget-evidence-archives.expire", "POST", "/api/admin/ai/platform-budget-evidence-archives/:id/expire", "admin-ai", "smallJson", "admin-ai-platform-budget-evidence-archives-write-ip", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    sensitivity: "high",
    audit: { event: "admin_ai_platform_budget_evidence_archive_expired" },
    notes: "Phase 4.21 admin-approved archive expiry metadata update. Requires Idempotency-Key, bounded reason, admin auth/MFA, same-origin JSON, and fail-closed rate limiting. It does not delete R2 immediately and does not mutate repairs, usage events, source attempts/jobs, credits, Stripe, Cloudflare, providers, or customer billing.",
  }),
  adminJsonWrite("admin.ai.platform-budget-evidence-archives.cleanup-expired", "POST", "/api/admin/ai/platform-budget-evidence-archives/cleanup-expired", "admin-ai", "smallJson", "admin-ai-platform-budget-evidence-archives-write-ip", {
    config: ["DB", "PUBLIC_RATE_LIMITER", "AUDIT_ARCHIVE"],
    sensitivity: "high",
    audit: { event: "admin_ai_platform_budget_evidence_archive_cleanup_expired" },
    notes: "Phase 4.21 admin-triggered bounded cleanup for expired platform budget evidence archives. Deletes only AUDIT_ARCHIVE objects whose keys pass the approved platform-budget-evidence/ prefix check, marks archive metadata, and refuses unsafe keys. It never touches data-exports, user media, audit chunks, AI media, repairs, usage/source rows, credits, Stripe, providers, Cloudflare, or customer billing.",
  }),
  adminJsonWrite("admin.ai.test-text", "POST", "/api/admin/ai/test-text", "admin-ai", "adminJson", "admin-ai-text-ip", {
    config: REQUIRED_CONFIG.adminAi,
    billing: {
      budgetScope: "platform_admin_lab_budget",
      killSwitchTarget: "ENABLE_ADMIN_AI_TEXT_BUDGET",
      idempotency: "Idempotency-Key header is required. Phase 4.8.1 stores only a hash in admin_ai_usage_attempts, suppresses same-key duplicate provider calls for pending/completed/failed attempts, and conflicts same-key/different-request retries.",
      callerPolicy: "Phase 4.8.1 signs the internal /internal/ai/test-text call with __bitbi_ai_caller_policy using budget_metadata_only status.",
      runtimeEnforcement: "Phase 4.17 requires ENABLE_ADMIN_AI_TEXT_BUDGET as a Cloudflare master flag, a D1 app-level switch, and an allowing platform_admin_lab_budget cap check before durable metadata-only idempotency attempts or provider proxying.",
      replay: "Metadata-only: completed duplicate requests return no generated text and do not re-run the provider.",
    },
  }),
  adminJsonWrite("admin.ai.test-image", "POST", "/api/admin/ai/test-image", "admin-ai", "adminJson", "admin-ai-image-ip", {
    config: REQUIRED_CONFIG.adminAi,
    sensitivity: "high",
    billing: {
      chargedSubset: "Priced Admin Image models use admin_org_credit_account budget-policy metadata, selected organization credits, required Idempotency-Key, server-side pricing, insufficient-credit fail-closed behavior, no charge on provider failure, and signed caller-policy metadata.",
      explicitUnmeteredSubset: "FLUX.2 Dev is the only Phase 4.14 explicit_unmetered_admin exception. It remains admin-only, emits safe explicit-unmetered budget/caller-policy metadata, does not debit credits, and does not claim durable replay/idempotency.",
      blockedUnsupported: "Unknown or newly allowlisted but unclassified Admin Image models must be blocked before AI_LAB/provider execution with no credit or billing mutation.",
      killSwitchTargets: ["ENABLE_ADMIN_AI_BFL_IMAGE_BUDGET", "ENABLE_ADMIN_AI_GPT_IMAGE_BUDGET", "ENABLE_ADMIN_AI_XAI_IMAGE_BUDGET", "ENABLE_ADMIN_AI_UNMETERED_IMAGE_TESTS"],
      runtimeEnforcement: "Phase 4.15.1 requires the charged model-specific Cloudflare master flag plus D1 app switch before provider calls or credit debits, and requires ENABLE_ADMIN_AI_UNMETERED_IMAGE_TESTS master plus app switch before FLUX.2 Dev provider execution. Phase 4.17 platform_admin_lab_budget caps do not apply to admin_org_credit_account or explicit_unmetered_admin image branches.",
    },
    notes: "Admin area only. Platform admin required. Charged BFL/GPT image-test subset remains the existing selected-organization credit path; FLUX.2 Dev is explicitly unmetered admin lab behavior with safe metadata; unsupported/unbudgeted Admin Image branches are not normal provider-cost paths. No public/member/owner route exposure.",
  }),
  adminJsonWrite("admin.ai.test-embeddings", "POST", "/api/admin/ai/test-embeddings", "admin-ai", "adminJson", "admin-ai-embeddings-ip", {
    config: REQUIRED_CONFIG.adminAi,
    billing: {
      budgetScope: "platform_admin_lab_budget",
      killSwitchTarget: "ENABLE_ADMIN_AI_EMBEDDINGS_BUDGET",
      idempotency: "Idempotency-Key header is required. Phase 4.8.1 stores only a hash in admin_ai_usage_attempts, suppresses same-key duplicate provider calls for pending/completed/failed attempts, and conflicts same-key/different-request retries.",
      callerPolicy: "Phase 4.8.1 signs the internal /internal/ai/test-embeddings call with __bitbi_ai_caller_policy using budget_metadata_only status.",
      runtimeEnforcement: "Phase 4.17 requires ENABLE_ADMIN_AI_EMBEDDINGS_BUDGET as a Cloudflare master flag, a D1 app-level switch, and an allowing platform_admin_lab_budget cap check before durable metadata-only idempotency attempts or provider proxying.",
      replay: "Metadata-only: completed duplicate requests return no embedding vectors and do not re-run the provider.",
    },
  }),
  adminJsonWrite("admin.ai.test-music", "POST", "/api/admin/ai/test-music", "admin-ai", "adminJson", "admin-ai-music-ip", {
    config: REQUIRED_CONFIG.adminAi,
    billing: {
      budgetScope: "platform_admin_lab_budget",
      killSwitchTarget: "ENABLE_ADMIN_AI_MUSIC_BUDGET",
      idempotency: "Idempotency-Key header is required. Phase 4.9 stores only a hash in admin_ai_usage_attempts, suppresses same-key duplicate provider calls for pending/completed/failed attempts, and conflicts same-key/different-request retries.",
      callerPolicy: "Phase 4.9 signs the internal /internal/ai/test-music call with __bitbi_ai_caller_policy using budget_metadata_only status.",
      runtimeEnforcement: "Phase 4.17 requires ENABLE_ADMIN_AI_MUSIC_BUDGET as a Cloudflare master flag, a D1 app-level switch, and an allowing platform_admin_lab_budget cap check before durable metadata-only idempotency attempts or provider proxying.",
      replay: "Metadata-only: completed duplicate requests return no audio, lyrics, or provider body and do not re-run the provider.",
    },
  }),
  adminJsonWrite("admin.ai.test-video-debug", "POST", "/api/admin/ai/test-video", "admin-ai", "adminJson", "admin-ai-video-ip", {
    config: REQUIRED_CONFIG.adminAi,
    debugGate: "disabled-by-default; ALLOW_SYNC_VIDEO_DEBUG=true is retained only for emergency debug compatibility",
    audit: { event: "admin_ai_sync_video_debug_used" },
    retirement: {
      status: "retired_debug_path",
      phase: "Phase 4.13",
      supportedReplacement: "POST /api/admin/ai/video-jobs",
      normalProviderCostPath: false,
    },
    billing: {
      budgetScope: "platform_admin_lab_budget",
      idempotency: "Not required while disabled; this sync debug path is not a normal supported provider-cost route. If emergency execution is retained long-term, a later phase must add Idempotency-Key plus durable budget controls before normal use.",
      callerPolicy: "Emergency compatibility execution, when explicitly enabled by ALLOW_SYNC_VIDEO_DEBUG=true, sends baseline caller-policy metadata only. It is not budget-enforced and must not be treated as the supported admin video path.",
      runtimeEnforcement: "Phase 4.13 classifies the route as retired/disabled-by-default. Disabled requests return before body parsing, rate limiting, internal AI Worker calls, queue calls, provider calls, credit mutation, or billing mutation.",
      replacement: "Use Phase 4.5 admin async video jobs for supported budgeted admin video generation.",
    },
    notes: "Phase 4.13 keeps synchronous admin video debug disabled by default and classifies it as a retired emergency/debug compatibility path. Admin async video jobs are the supported budgeted admin video path.",
  }),
  adminJsonWrite("admin.ai.video-jobs.create", "POST", "/api/admin/ai/video-jobs", "admin-ai", "adminVideoJobJson", "admin-ai-video-job-create-ip", {
    config: REQUIRED_CONFIG.adminVideoJobs,
    audit: { event: "ai_video_job_created" },
    billing: {
      budgetScope: "platform_admin_lab_budget",
      killSwitchTarget: "ENABLE_ADMIN_AI_VIDEO_JOB_BUDGET",
      idempotency: "Idempotency-Key header is required; same-key same-request reuses the existing job and same-key different-request conflicts before queueing.",
      queueBudgetMetadata: "Phase 4.5 stores sanitized job-row budget_policy_json and includes a bounded queue budget_policy summary before provider-cost processing.",
      callerPolicy: "Phase 4.7 signs internal AI Worker calls with __bitbi_ai_caller_policy metadata for video-task create/poll; the AI Worker rejects missing/invalid policy for those two covered routes.",
      runtimeEnforcement: "Phase 4.17 requires ENABLE_ADMIN_AI_VIDEO_JOB_BUDGET as a Cloudflare master flag, a D1 app-level switch, and an allowing platform_admin_lab_budget cap check before job rows are created or provider-cost queue work is enqueued. Queue processing still verifies job budget metadata before internal video-task create/poll calls and records a de-duplicated usage event on success.",
    },
    notes: "Phase 4.5 covers only admin async video jobs with platform_admin_lab_budget metadata and duplicate queue/provider-task guards; Phase 4.7 adds internal AI caller-policy propagation for task create/poll. Phase 4.13 retires sync video debug as disabled-by-default/emergency-only; broader admin AI routes remain separate tracked gaps where not already migrated.",
  }),
  adminJsonWrite("admin.ai.video-jobs.recover", "POST", "/api/admin/ai/video-jobs/:id/recover", "admin-ai", "smallJson", "admin-ai-video-job-recover-ip", {
    config: REQUIRED_CONFIG.adminVideoJobs,
    audit: { event: "admin_ai_video_job_recovered_from_provider_response" },
    billing: {
      budgetScope: "platform_admin_lab_budget",
      idempotency: "Idempotency-Key header is required; same-key same-provider-response reuses the recovered job metadata, and same-key different-response conflicts before any remote fetch.",
      callerPolicy: "No provider execution and no credit debit. The route imports an already completed provider response by validating and ingesting the remote video output server-side through the existing admin video job R2 path.",
      runtimeEnforcement: "Admin-only, same-origin JSON, low rate limit, small body limit, safe remote URL policy, MIME/size validation, and audit event. Raw signed provider URLs and R2 keys are never returned or logged.",
    },
    notes: "Admin recovery path for long async video jobs that completed at the provider after status polling was rate-limited. Public routes are not opened; final UI output remains /api/admin/ai/video-jobs/:id/output.",
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
  adminRead("admin.ai.admin-usage-attempts.list", "/api/admin/ai/admin-usage-attempts", "admin-ai", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    rateLimit: { id: "admin-ai-admin-usage-attempts-ip", failClosed: true },
    notes: "Phase 4.8.2 read-only inspection for sanitized admin_ai_usage_attempts rows. Does not return raw prompts, embedding inputs, generated text, vectors, provider bodies, raw idempotency keys, secrets, cookies, tokens, Stripe data, Cloudflare tokens, or private R2 keys.",
  }),
  adminJsonWrite("admin.ai.admin-usage-attempts.cleanup-expired", "POST", "/api/admin/ai/admin-usage-attempts/cleanup-expired", "admin-ai", "smallJson", "admin-ai-admin-usage-attempts-write-ip", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    audit: { event: "admin_ai_usage_attempt_cleanup_completed" },
    notes: "Phase 4.8.2 bounded non-destructive cleanup. Defaults to dry-run and only marks expired pending/running admin_ai_usage_attempts as expired; no provider calls, credit debits, billing mutations, or row deletions.",
  }),
  adminRead("admin.ai.admin-usage-attempts.read", "/api/admin/ai/admin-usage-attempts/:id", "admin-ai", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    rateLimit: { id: "admin-ai-admin-usage-attempts-ip", failClosed: true },
    notes: "Phase 4.8.2 sanitized detail inspection for one admin_ai_usage_attempts row. Raw input/output/provider/idempotency material is omitted or redacted.",
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
  adminJsonWrite("admin.ai.compare", "POST", "/api/admin/ai/compare", "admin-ai", "adminJson", "admin-ai-compare-ip", {
    config: REQUIRED_CONFIG.adminAi,
    billing: {
      budgetScope: "platform_admin_lab_budget",
      killSwitchTarget: "ENABLE_ADMIN_AI_COMPARE_BUDGET",
      idempotency: "Idempotency-Key header is required. Phase 4.10 stores only a hash in admin_ai_usage_attempts, suppresses same-key duplicate provider fanout for pending/completed/failed attempts, and conflicts same-key/different-request retries.",
      callerPolicy: "Phase 4.10 signs the internal /internal/ai/compare call with __bitbi_ai_caller_policy using budget_metadata_only status.",
      runtimeEnforcement: "Phase 4.17 requires ENABLE_ADMIN_AI_COMPARE_BUDGET as a Cloudflare master flag, a D1 app-level switch, and an allowing platform_admin_lab_budget cap check before durable metadata-only idempotency attempts or proxying to the multi-model compare route.",
      replay: "Metadata-only: completed duplicate requests return no compare results and do not re-run provider fanout.",
    },
    notes: "Admin Compare is Phase 4.10-covered only for this auth route. Admin Live-Agent remains covered separately by Phase 4.12; Phase 4.13 retires sync video debug as disabled-by-default/emergency-only, and Phase 4.14 classifies Admin Image branches as charged, explicit-unmetered, or blocked.",
  }),
  adminJsonWrite("admin.ai.live-agent", "POST", "/api/admin/ai/live-agent", "admin-ai", "adminJson", "admin-ai-liveagent-ip", {
    config: REQUIRED_CONFIG.adminAi,
    billing: {
      budgetScope: "platform_admin_lab_budget",
      killSwitchTarget: "ENABLE_ADMIN_AI_LIVE_AGENT_BUDGET",
      idempotency: "Idempotency-Key header is required. Phase 4.12 stores only a hash in admin_ai_usage_attempts, suppresses same-key duplicate stream sessions for pending/completed/failed attempts, and conflicts same-key/different-request retries.",
      callerPolicy: "Phase 4.12 signs the internal /internal/ai/live-agent call with __bitbi_ai_caller_policy using budget_metadata_only status.",
      runtimeEnforcement: "Phase 4.17 requires ENABLE_ADMIN_AI_LIVE_AGENT_BUDGET as a Cloudflare master flag, a D1 app-level switch, and an allowing platform_admin_lab_budget cap check before durable metadata-only stream-session attempts or proxying to the streaming live-agent route. Explicit output-token and stream-duration caps remain future work.",
      replay: "Metadata-only: completed duplicate requests return no streamed output and do not re-run the provider stream.",
      streamFinalization: "Auth Worker wraps the upstream SSE body and marks the attempt succeeded only after stream completion, or failed on setup/stream errors observable by the wrapper.",
    },
    notes: "Admin Live-Agent is Phase 4.12-covered only for this auth route. Phase 4.13 retires sync video debug as disabled-by-default/emergency-only; Phase 4.14 classifies Admin Image branches as charged, explicit-unmetered, or blocked.",
  }),
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
      idempotency: "required for member personal and organization-scoped provider-cost image generation; member personal provider execution is guarded by member_ai_usage_attempts and organization provider execution is guarded by ai_usage_attempts",
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
      idempotency: "required; member music generation is guarded by one bundled member_ai_usage_attempts parent reservation covering lyrics/audio/cover provider-cost work",
    },
  }),
  userJsonWrite("ai.generate-video", "POST", "/api/ai/generate-video", "ai-studio", "aiGenerateVideoJson", "ai-generate-video-user", {
    config: ["DB", "PUBLIC_RATE_LIMITER", "AI", "USER_IMAGES"],
    audit: { event: "ai_generate_video" },
    sensitivity: "high",
    billing: {
      mode: "member-credit-account",
      feature: "ai.video.generate",
      idempotency: "required; member video generation is guarded by one bundled member_ai_usage_attempts parent reservation before provider-cost work",
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
    notes: "Live Stripe webhook for one-time credit packs and BITBI Pro subscriptions. Raw body is verified with STRIPE_LIVE_WEBHOOK_SECRET before JSON parse; Testmode events are rejected. Credit-pack grants require an existing live checkout session. Subscription credits are topped up only after a verified paid subscription invoice event and remain bucket-separated from purchased credits.",
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
  adminRead("admin.homepage.hero-videos.read", "/api/admin/homepage/hero-videos", "homepage", {
    config: ["DB"],
    notes: "Admin-only current homepage hero slot config. Sanitizes derivative records and does not return R2 keys.",
  }),
  adminRead("admin.homepage.hero-videos.feature-status.read", "/api/admin/homepage/hero-videos/feature-status", "homepage", {
    config: ["DB", "ENABLE_HOMEPAGE_HERO_EXTERNAL_FFMPEG", "ENABLE_HOMEPAGE_HERO_MANUAL_UPLOADS", "ENABLE_MEMVID_STREAM_PREVIEWS", "ENABLE_MEMVID_STREAM_PREVIEW_AUTOPLAY"],
    notes: "Admin-only runtime video delivery control status. Reports Worker defaults, Admin app_settings overrides, effective state, and provider readiness without exposing secret values.",
  }),
  adminJsonWrite("admin.homepage.hero-videos.feature-status.update", "PATCH", "/api/admin/homepage/hero-videos/feature-status/:key", "homepage", "smallJson", "admin-action-ip", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    audit: { event: "video_delivery_feature_switch_updated" },
    notes: "Requires Admin/MFA in production, same-origin JSON, Idempotency-Key, operator_reason, fail-closed rate limiting, and audit logging. Updates runtime app_settings rollout switches only; Worker env hard-disables still win.",
  }),
  adminJsonWrite("admin.homepage.hero-videos.preset.update", "PATCH", "/api/admin/homepage/hero-videos/preset", "homepage", "smallJson", "admin-action-ip", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    audit: { event: "homepage_hero_ffmpeg_preset_updated" },
    notes: "Requires Admin/MFA in production, same-origin JSON, Idempotency-Key, operator_reason, bounded structured preset validation, and audit logging. Raw ffmpeg arguments are not accepted.",
  }),
  adminRead("admin.homepage.hero-videos.candidates", "/api/admin/homepage/hero-videos/candidates", "homepage", {
    config: ["DB"],
    notes: "Admin-only candidate browser for published Memvids and the current admin user's saved video assets. Candidate responses expose route URLs only, never R2 object keys.",
  }),
  policy({
    id: "admin.homepage.hero-videos.uploads.create",
    method: "POST",
    path: "/api/admin/homepage/hero-videos/uploads",
    auth: "admin",
    mfa: "admin-production-required",
    csrf: "same-origin-required",
    body: { kind: "multipart", maxBytesName: "homepageHeroVideoUpload", contentType: "multipart/form-data" },
    rateLimit: { id: "admin-action-ip", failClosed: true },
    config: ["DB", "USER_IMAGES", "PUBLIC_RATE_LIMITER", "ENABLE_HOMEPAGE_HERO_MANUAL_UPLOADS"],
    audit: { event: "homepage_hero_video_source_uploaded" },
    owner: "homepage",
    sensitivity: "high",
    notes: "Requires Admin/MFA in production, same-origin mutation guard, Idempotency-Key, operator_reason, MIME and size validation, and audit logging. Uploaded originals remain private admin assets and are never served by the public homepage.",
  }),
  adminJsonWrite("admin.homepage.hero-videos.uploads.poster", "POST", "/api/admin/homepage/hero-videos/uploads/:assetId/poster", "homepage", "aiSaveVideoPosterJson", "admin-action-ip", {
    config: ["DB", "USER_IMAGES", "IMAGES", "PUBLIC_RATE_LIMITER", "ENABLE_HOMEPAGE_HERO_MANUAL_UPLOADS"],
    audit: { event: "homepage_hero_video_source_poster_attached" },
    notes: "Requires Admin/MFA in production, same-origin JSON, Idempotency-Key, operator_reason, enabled manual uploads, and bounded poster data URI. Attaches a private poster to an admin-owned hero source upload without exposing source R2 keys.",
  }),
  adminJsonWrite("admin.homepage.hero-videos.uploads.poster.retry", "POST", "/api/admin/homepage/hero-videos/uploads/:assetId/poster/retry", "homepage", "smallJson", "admin-action-ip", {
    config: ["DB", "USER_IMAGES", "PUBLIC_RATE_LIMITER", "ENABLE_HOMEPAGE_HERO_MANUAL_UPLOADS", "ENABLE_HOMEPAGE_HERO_EXTERNAL_FFMPEG", "HOMEPAGE_HERO_EXTERNAL_FFMPEG_SECRET"],
    audit: { event: "homepage_hero_video_source_poster_retry_requested" },
    notes: "Requires Admin/MFA in production, same-origin JSON, Idempotency-Key, operator_reason, enabled manual uploads, and configured external_ffmpeg processor. It queues private source poster extraction; no original source URLs or R2 keys are returned.",
  }),
  adminJsonWrite("admin.homepage.hero-videos.memvid-stream-previews.backfill", "POST", "/api/admin/homepage/hero-videos/memvid-stream-previews/backfill", "homepage", "smallJson", "admin-action-ip", {
    config: ["DB", "PUBLIC_RATE_LIMITER", "ENABLE_MEMVID_STREAM_PREVIEWS"],
    audit: { event: "memvid_stream_preview_backfill_queued" },
    notes: "Requires Admin/MFA in production, same-origin JSON, Idempotency-Key, operator_reason, fail-closed rate limiting, and audit logging. It queues short-preview metadata only; provider processing remains signed machine-to-machine and public APIs expose only ready Stream preview UIDs.",
  }),
  adminJsonWrite("admin.homepage.hero-videos.memvid-stream-previews.run", "POST", "/api/admin/homepage/hero-videos/memvid-stream-previews/run", "homepage", "smallJson", "admin-action-ip", {
    config: [
      "DB",
      "PUBLIC_RATE_LIMITER",
      "ENABLE_MEMVID_STREAM_PREVIEWS",
      "MEMVID_STREAM_PREVIEW_DISPATCH_PROVIDER",
      "GITHUB_ACTIONS_DISPATCH_TOKEN",
      "GITHUB_ACTIONS_DISPATCH_OWNER",
      "GITHUB_ACTIONS_DISPATCH_REPO",
      "GITHUB_ACTIONS_DISPATCH_WORKFLOW",
      "GITHUB_ACTIONS_DISPATCH_REF",
    ],
    audit: { event: "memvid_stream_preview_run_requested" },
    notes: "Requires Admin/MFA in production, same-origin JSON, Idempotency-Key, operator_reason, fail-closed rate limiting, and audit logging. It queues missing public Memvid previews, marks ready previews missing MP4 download metadata for repair, and optionally dispatches the processor workflow without exposing tokens.",
  }),
  adminRead("admin.homepage.hero-videos.derivatives.list", "/api/admin/homepage/hero-videos/derivatives", "homepage", {
    config: ["DB"],
    rateLimit: { noneReason: "Read-only Admin derivative recovery listing. The response is bounded by limit and never returns R2 keys, source file URLs, processor URLs, or secrets." },
    notes: "Lists recent Homepage Hero derivative records, including completed unassigned derivatives, so Admins can recover asynchronous processor output without rerunning conversion.",
  }),
  adminRead("admin.homepage.hero-videos.derivatives.detail", "/api/admin/homepage/hero-videos/derivatives/:id", "homepage", {
    config: ["DB"],
    rateLimit: { noneReason: "Read-only Admin derivative detail lookup used for bounded status polling after a conversion job is queued." },
    notes: "Returns safe derivative metadata only. It does not expose R2 keys, private source URLs, internal processor endpoints, or secrets.",
  }),
  adminJsonWrite("admin.homepage.hero-videos.derivatives.create", "POST", "/api/admin/homepage/hero-videos/derivatives", "homepage", "adminJson", "admin-action-ip", {
    config: ["DB", "USER_IMAGES", "PUBLIC_RATE_LIMITER"],
    audit: { event: "homepage_hero_video_derivative_requested" },
    notes: "Requires Admin/MFA in production, same-origin mutation guard, Idempotency-Key, and operator_reason. Creates a queued/processed derivative job through a provider adapter; public output is available only after succeeded derivative assignment.",
  }),
  adminJsonWrite("admin.homepage.hero-videos.derivatives.retry", "POST", "/api/admin/homepage/hero-videos/derivatives/:id/retry", "homepage", "smallJson", "admin-action-ip", {
    config: ["DB", "PUBLIC_RATE_LIMITER", "ENABLE_HOMEPAGE_HERO_EXTERNAL_FFMPEG", "HOMEPAGE_HERO_EXTERNAL_FFMPEG_SECRET"],
    audit: { event: "homepage_hero_video_derivative_retry_requested" },
    notes: "Requires Admin/MFA in production, same-origin JSON, Idempotency-Key, operator_reason, fail-closed rate limiting, and audit logging. It only requeues failed or queued external_ffmpeg derivative rows and never publishes original media.",
  }),
  adminJsonWrite("admin.homepage.hero-videos.slots.update", "PUT", "/api/admin/homepage/hero-videos/slots/:slot", "homepage", "smallJson", "admin-action-ip", {
    config: ["DB", "PUBLIC_RATE_LIMITER"],
    audit: { event: "homepage_hero_video_slot_updated" },
    notes: "Requires Admin/MFA in production, same-origin mutation guard, Idempotency-Key, and operator_reason. Only succeeded derivatives can be assigned to enabled public slots.",
  }),
  safeRead("internal.admin-ai.video-source", "GET", "/api/internal/ai/video-source/:token", "admin-ai", {
    auth: "anonymous",
    csrf: "not-browser-facing",
    sensitivity: "high",
    config: REQUIRED_CONFIG.adminAiVideoSource,
    rateLimit: { noneReason: "Provider-readable source endpoint is protected by a short-lived HMAC token scoped to one validated internal video source." },
    providerSignature: "hmac-token-path",
    notes: "Serves only the exact saved video asset or published Memvid encoded in a server-generated token for Grok Imagine 1.5 Preview extend. It does not accept URLs, R2 keys, cookies, sessions, or user-supplied storage paths; tokens and signed URLs are not stored in D1.",
  }),
  safeRead("internal.admin-ai.video-source.head", "HEAD", "/api/internal/ai/video-source/:token", "admin-ai", {
    auth: "anonymous",
    csrf: "not-browser-facing",
    sensitivity: "high",
    config: REQUIRED_CONFIG.adminAiVideoSource,
    rateLimit: { noneReason: "Provider-readable HEAD source check is protected by the same short-lived HMAC token as GET." },
    providerSignature: "hmac-token-path",
    notes: "HEAD only returns metadata for the exact token-scoped internal source. It does not expose R2 keys, signed provider URLs, cookies, or private storage paths.",
  }),
  safeRead("internal.admin-ai.media-source", "GET", "/api/internal/ai/media-source/:token", "admin-ai", {
    auth: "anonymous",
    csrf: "not-browser-facing",
    sensitivity: "high",
    config: REQUIRED_CONFIG.adminAiVideoSource,
    rateLimit: { noneReason: "Provider-readable source endpoint is protected by a short-lived HMAC token scoped to one validated internal image or video source." },
    providerSignature: "hmac-token-path",
    notes: "Serves only the exact saved image/video asset or published Mempic/Memvid encoded in a server-generated token for Grok Imagine 1.5 Preview. It does not accept URLs, R2 keys, cookies, sessions, or user-supplied storage paths; tokens and signed URLs are not stored in D1.",
  }),
  safeRead("internal.admin-ai.media-source.head", "HEAD", "/api/internal/ai/media-source/:token", "admin-ai", {
    auth: "anonymous",
    csrf: "not-browser-facing",
    sensitivity: "high",
    config: REQUIRED_CONFIG.adminAiVideoSource,
    rateLimit: { noneReason: "Provider-readable HEAD source check is protected by the same short-lived HMAC token as GET." },
    providerSignature: "hmac-token-path",
    notes: "HEAD only returns metadata for the exact token-scoped internal image or video source. It does not expose R2 keys, signed provider URLs, cookies, or private storage paths.",
  }),
  policy({
    id: "internal.homepage.hero-videos.jobs.claim",
    method: "POST",
    path: "/api/internal/homepage/hero-videos/jobs/claim",
    auth: "anonymous",
    csrf: "not-browser-facing",
    body: { kind: "json", maxBytesName: "homepageHeroProcessorJson", contentType: "application/json" },
    rateLimit: { noneReason: "Signed machine-to-machine processor endpoint; processor secret is required and jobs are bounded by limit." },
    config: ["DB", "ENABLE_HOMEPAGE_HERO_EXTERNAL_FFMPEG", "HOMEPAGE_HERO_EXTERNAL_FFMPEG_SECRET"],
    audit: { noneReason: "Processor claims are reflected in derivative status timestamps; admin request audit records the originating job creation." },
    owner: "homepage",
    sensitivity: "high",
    providerSignature: "processor-bearer-secret",
    notes: "Machine-to-machine external_ffmpeg job claim route. It returns no R2 keys or private source URLs, only signed internal source/completion endpoints.",
  }),
  policy({
    id: "internal.homepage.hero-videos.source-posters.jobs.claim",
    method: "POST",
    path: "/api/internal/homepage/hero-videos/source-posters/jobs/claim",
    auth: "anonymous",
    csrf: "not-browser-facing",
    body: { kind: "json", maxBytesName: "homepageHeroProcessorJson", contentType: "application/json" },
    rateLimit: { noneReason: "Signed machine-to-machine processor endpoint; processor secret is required and claimed source-poster work is bounded by limit." },
    config: ["DB", "ENABLE_HOMEPAGE_HERO_EXTERNAL_FFMPEG", "HOMEPAGE_HERO_EXTERNAL_FFMPEG_SECRET"],
    audit: { noneReason: "Processor claims update durable source poster state; admin retry/upload requests are audited separately." },
    owner: "homepage",
    sensitivity: "high",
    providerSignature: "processor-bearer-secret",
    notes: "Claims private manual hero upload source-poster extraction work. It returns only signed internal source/completion endpoints, never R2 keys or browser-usable private media URLs.",
  }),
  safeRead("internal.homepage.hero-videos.source-posters.jobs.source", "GET", "/api/internal/homepage/hero-videos/source-posters/jobs/:assetId/source", "homepage", {
    auth: "anonymous",
    csrf: "not-browser-facing",
    sensitivity: "high",
    config: ["DB", "USER_IMAGES", "ENABLE_HOMEPAGE_HERO_EXTERNAL_FFMPEG", "HOMEPAGE_HERO_EXTERNAL_FFMPEG_SECRET"],
    rateLimit: { noneReason: "Signed machine-to-machine processor source read; source key is resolved from D1 and never accepted from the request." },
    providerSignature: "processor-bearer-secret",
    notes: "Private manual hero source download for poster extraction only. Public homepage and public Memvid APIs never receive this URL.",
  }),
  policy({
    id: "internal.homepage.hero-videos.source-posters.jobs.complete",
    method: "POST",
    path: "/api/internal/homepage/hero-videos/source-posters/jobs/:assetId/complete",
    auth: "anonymous",
    csrf: "not-browser-facing",
    body: { kind: "multipart", maxBytesName: "homepageHeroProcessorUpload", contentType: "multipart/form-data" },
    rateLimit: { noneReason: "Signed machine-to-machine processor completion; poster MIME and size are bounded before R2 write." },
    config: ["DB", "USER_IMAGES", "IMAGES", "ENABLE_HOMEPAGE_HERO_EXTERNAL_FFMPEG", "HOMEPAGE_HERO_EXTERNAL_FFMPEG_SECRET"],
    audit: { noneReason: "Completion is stored on ai_text_assets poster fields and durable source poster metadata; admin retry/upload requests are audited separately." },
    owner: "homepage",
    sensitivity: "high",
    providerSignature: "processor-bearer-secret",
    notes: "Stores a private source-asset poster using existing saved-video poster fields. It does not publish or serve original source media.",
  }),
  policy({
    id: "internal.homepage.hero-videos.source-posters.jobs.fail",
    method: "POST",
    path: "/api/internal/homepage/hero-videos/source-posters/jobs/:assetId/fail",
    auth: "anonymous",
    csrf: "not-browser-facing",
    body: { kind: "json", maxBytesName: "homepageHeroProcessorJson", contentType: "application/json" },
    rateLimit: { noneReason: "Signed machine-to-machine failure callback; body is small and sanitized." },
    config: ["DB", "ENABLE_HOMEPAGE_HERO_EXTERNAL_FFMPEG", "HOMEPAGE_HERO_EXTERNAL_FFMPEG_SECRET"],
    audit: { noneReason: "Failure is stored on durable source poster metadata for Admin retry visibility." },
    owner: "homepage",
    sensitivity: "high",
    providerSignature: "processor-bearer-secret",
    notes: "Records sanitized source-poster processor errors without exposing raw ffmpeg stderr, source keys, or secrets.",
  }),
  safeRead("internal.homepage.hero-videos.jobs.source", "GET", "/api/internal/homepage/hero-videos/jobs/:id/source", "homepage", {
    auth: "anonymous",
    csrf: "not-browser-facing",
    sensitivity: "high",
    config: ["DB", "USER_IMAGES", "ENABLE_HOMEPAGE_HERO_EXTERNAL_FFMPEG", "HOMEPAGE_HERO_EXTERNAL_FFMPEG_SECRET"],
    rateLimit: { noneReason: "Signed machine-to-machine processor source read; source key is resolved from D1 and never accepted from the request." },
    providerSignature: "processor-bearer-secret",
    notes: "Private source download for the external_ffmpeg processor only. The browser-facing public homepage never receives this URL.",
  }),
  policy({
    id: "internal.homepage.hero-videos.jobs.complete",
    method: "POST",
    path: "/api/internal/homepage/hero-videos/jobs/:id/complete",
    auth: "anonymous",
    csrf: "not-browser-facing",
    body: { kind: "multipart", maxBytesName: "homepageHeroProcessorUpload", contentType: "multipart/form-data" },
    rateLimit: { noneReason: "Signed machine-to-machine processor completion; output size and MIME are bounded before R2 write." },
    config: ["DB", "USER_IMAGES", "ENABLE_HOMEPAGE_HERO_EXTERNAL_FFMPEG", "HOMEPAGE_HERO_EXTERNAL_FFMPEG_SECRET"],
    audit: { noneReason: "Completion is linked to the audited admin derivative request and stored in derivative status metadata." },
    owner: "homepage",
    sensitivity: "high",
    providerSignature: "processor-bearer-secret",
    notes: "Accepts only optimized MP4/WebP derivative outputs from the signed external_ffmpeg processor and never original source media.",
  }),
  policy({
    id: "internal.homepage.hero-videos.jobs.fail",
    method: "POST",
    path: "/api/internal/homepage/hero-videos/jobs/:id/fail",
    auth: "anonymous",
    csrf: "not-browser-facing",
    body: { kind: "json", maxBytesName: "homepageHeroProcessorJson", contentType: "application/json" },
    rateLimit: { noneReason: "Signed machine-to-machine failure callback; body is small and sanitized." },
    config: ["DB", "ENABLE_HOMEPAGE_HERO_EXTERNAL_FFMPEG", "HOMEPAGE_HERO_EXTERNAL_FFMPEG_SECRET"],
    audit: { noneReason: "Failure status is visible to admins on the derivative record and linked to the audited admin request." },
    owner: "homepage",
    sensitivity: "high",
    providerSignature: "processor-bearer-secret",
    notes: "Records sanitized external_ffmpeg errors without exposing raw provider stderr or secrets.",
  }),
  policy({
    id: "internal.memvid-stream-previews.jobs.claim",
    method: "POST",
    path: "/api/internal/memvid-stream-previews/jobs/claim",
    auth: "anonymous",
    csrf: "not-browser-facing",
    body: { kind: "json", maxBytesName: "homepageHeroProcessorJson", contentType: "application/json" },
    rateLimit: { noneReason: "Signed machine-to-machine processor endpoint; job claim is bounded and does not trigger browser playback." },
    config: ["DB", "ENABLE_MEMVID_STREAM_PREVIEWS", "MEMVID_STREAM_PREVIEW_PROCESSOR_SECRET"],
    audit: { noneReason: "Preview job state is recorded in memvid_stream_previews and admin backfill requests are audited separately." },
    owner: "homepage",
    sensitivity: "high",
    providerSignature: "processor-bearer-secret",
    notes: "Returns short-preview jobs only. It never returns public original file URLs, R2 keys, or Stream API tokens.",
  }),
  safeRead("internal.memvid-stream-previews.jobs.source", "GET", "/api/internal/memvid-stream-previews/jobs/:id/source", "homepage", {
    auth: "anonymous",
    csrf: "not-browser-facing",
    sensitivity: "high",
    config: ["DB", "USER_IMAGES", "ENABLE_MEMVID_STREAM_PREVIEWS", "MEMVID_STREAM_PREVIEW_PROCESSOR_SECRET"],
    rateLimit: { noneReason: "Signed machine-to-machine source read; key is resolved from queued preview metadata and never accepted from the request." },
    providerSignature: "processor-bearer-secret",
    notes: "Private processor-only source download used to prepare short hover preview clips.",
  }),
  policy({
    id: "internal.memvid-stream-previews.jobs.complete",
    method: "POST",
    path: "/api/internal/memvid-stream-previews/jobs/:id/complete",
    auth: "anonymous",
    csrf: "not-browser-facing",
    body: { kind: "json", maxBytesName: "homepageHeroProcessorJson", contentType: "application/json" },
    rateLimit: { noneReason: "Signed machine-to-machine completion with bounded JSON metadata." },
    config: ["DB", "ENABLE_MEMVID_STREAM_PREVIEWS", "MEMVID_STREAM_PREVIEW_PROCESSOR_SECRET"],
    audit: { noneReason: "Ready Stream UID is stored on the preview row and admin backfill request is audited separately." },
    owner: "homepage",
    sensitivity: "high",
    providerSignature: "processor-bearer-secret",
    notes: "Accepts only safe Cloudflare Stream UID metadata for short previews; no Stream API token or R2 key is exposed.",
  }),
  policy({
    id: "internal.memvid-stream-previews.jobs.fail",
    method: "POST",
    path: "/api/internal/memvid-stream-previews/jobs/:id/fail",
    auth: "anonymous",
    csrf: "not-browser-facing",
    body: { kind: "json", maxBytesName: "homepageHeroProcessorJson", contentType: "application/json" },
    rateLimit: { noneReason: "Signed machine-to-machine failure callback; body is small and sanitized." },
    config: ["DB", "ENABLE_MEMVID_STREAM_PREVIEWS", "MEMVID_STREAM_PREVIEW_PROCESSOR_SECRET"],
    audit: { noneReason: "Failure state is stored on the preview row." },
    owner: "homepage",
    sensitivity: "high",
    providerSignature: "processor-bearer-secret",
    notes: "Records sanitized Stream preview processing errors without exposing raw provider stderr or secrets.",
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
