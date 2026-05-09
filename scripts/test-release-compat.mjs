import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractLatestMigrationFilename,
  loadReleaseCompatibilityContext,
  validateReleaseCompatibility,
} from "./lib/release-compat.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const baseManifest = {
  schemaVersion: 1,
  release: {
    schemaCheckpoints: {
      auth: {
        migrationDirectory: "workers/auth/migrations",
        latest: "0041_add_member_credit_ledger.sql",
        databaseName: "bitbi-auth-db",
      },
    },
    workers: {
      ai: {
        name: "bitbi-ai",
        wranglerPath: "workers/ai/wrangler.jsonc",
        workersDev: false,
        previewUrls: false,
        bindings: {
          ai: "AI",
          durableObjects: {
            SERVICE_AUTH_REPLAY: { className: "AiServiceAuthReplayDurableObject" },
          },
        },
        migrations: [
          {
            tag: "v1-service-auth-replay",
            newSqliteClasses: ["AiServiceAuthReplayDurableObject"],
          },
        ],
      },
      auth: {
        name: "bitbi-auth",
        wranglerPath: "workers/auth/wrangler.jsonc",
        vars: ["APP_BASE_URL", "RESEND_FROM_EMAIL", "BITBI_ENV"],
        expectedVars: {
          APP_BASE_URL: "https://bitbi.ai",
          RESEND_FROM_EMAIL: "BITBI <noreply@contact.bitbi.ai>",
          BITBI_ENV: "production",
        },
        triggers: {
          crons: ["0 3 * * *"],
        },
        routes: [
          {
            pattern: "bitbi.ai/api/*",
            zone_name: "bitbi.ai",
          },
        ],
        bindings: {
          ai: "AI",
          images: "IMAGES",
          d1: {
            DB: { databaseName: "bitbi-auth-db" },
          },
          r2: {
            PRIVATE_MEDIA: { bucketName: "bitbi-private-media" },
            USER_IMAGES: { bucketName: "bitbi-user-images" },
            AUDIT_ARCHIVE: { bucketName: "bitbi-audit-archive" },
          },
          services: {
            AI_LAB: { service: "bitbi-ai", worker: "ai" },
          },
          durableObjects: {
            PUBLIC_RATE_LIMITER: { className: "AuthPublicRateLimiterDurableObject" },
          },
          queues: {
            producers: {
              ACTIVITY_INGEST_QUEUE: { queue: "bitbi-auth-activity-ingest" },
              AI_IMAGE_DERIVATIVES_QUEUE: { queue: "bitbi-ai-image-derivatives" },
              AI_VIDEO_JOBS_QUEUE: { queue: "bitbi-ai-video-jobs" },
            },
            consumers: [
              {
                queue: "bitbi-auth-activity-ingest",
                max_batch_size: 50,
                max_batch_timeout: 5,
                max_retries: 6,
              },
              {
                queue: "bitbi-ai-image-derivatives",
                max_batch_size: 5,
                max_batch_timeout: 5,
                max_retries: 8,
              },
              {
                queue: "bitbi-ai-video-jobs",
                max_batch_size: 3,
                max_batch_timeout: 5,
                max_retries: 4,
              },
            ],
          },
        },
        migrations: [
          {
            tag: "v1-public-rate-limiter",
            newSqliteClasses: ["AuthPublicRateLimiterDurableObject"],
          },
        ],
      },
      contact: {
        name: "bitbi-contact",
        wranglerPath: "workers/contact/wrangler.jsonc",
        vars: ["BITBI_ENV"],
        expectedVars: {
          BITBI_ENV: "production",
        },
        workersDev: false,
        routes: [
          {
            pattern: "contact.bitbi.ai",
            custom_domain: true,
          },
        ],
        bindings: {
          durableObjects: {
            PUBLIC_RATE_LIMITER: { className: "ContactPublicRateLimiterDurableObject" },
          },
        },
        migrations: [
          {
            tag: "v1-public-rate-limiter",
            newSqliteClasses: ["ContactPublicRateLimiterDurableObject"],
          },
        ],
      },
    },
    deployOrder: [
      { id: "auth-migrations", type: "schema-checkpoint", checkpoint: "auth" },
      { id: "ai-worker", type: "worker", worker: "ai" },
      {
        id: "auth-worker",
        type: "worker",
        worker: "auth",
        dependsOn: ["auth-migrations", "ai-worker"],
      },
      {
        id: "contact-worker",
        type: "worker",
        worker: "contact",
      },
      {
        id: "static-site",
        type: "static",
        dependsOn: ["auth-worker", "contact-worker"],
      },
    ],
    manualPrerequisites: [
      {
        id: "auth-session-secret",
        kind: "secret",
        worker: "auth",
        name: "SESSION_SECRET",
        requiredForRelease: true,
        documentation: "workers/auth/CLAUDE.md",
        summary: "Legacy compatibility fallback.",
      },
      {
        id: "auth-session-hash-secret",
        kind: "secret",
        worker: "auth",
        name: "SESSION_HASH_SECRET",
        requiredForRelease: true,
        documentation: "workers/auth/CLAUDE.md",
        summary: "Required for session token hashing.",
      },
      {
        id: "auth-pagination-signing-secret",
        kind: "secret",
        worker: "auth",
        name: "PAGINATION_SIGNING_SECRET",
        requiredForRelease: true,
        documentation: "workers/auth/CLAUDE.md",
        summary: "Required for pagination cursor signing.",
      },
      {
        id: "auth-admin-mfa-encryption-key",
        kind: "secret",
        worker: "auth",
        name: "ADMIN_MFA_ENCRYPTION_KEY",
        requiredForRelease: true,
        documentation: "workers/auth/CLAUDE.md",
        summary: "Required for admin MFA secret encryption.",
      },
      {
        id: "auth-admin-mfa-proof-secret",
        kind: "secret",
        worker: "auth",
        name: "ADMIN_MFA_PROOF_SECRET",
        requiredForRelease: true,
        documentation: "workers/auth/CLAUDE.md",
        summary: "Required for admin MFA proof signing.",
      },
      {
        id: "auth-admin-mfa-recovery-hash-secret",
        kind: "secret",
        worker: "auth",
        name: "ADMIN_MFA_RECOVERY_HASH_SECRET",
        requiredForRelease: true,
        documentation: "workers/auth/CLAUDE.md",
        summary: "Required for admin MFA recovery code hashing.",
      },
      {
        id: "auth-ai-save-reference-signing-secret",
        kind: "secret",
        worker: "auth",
        name: "AI_SAVE_REFERENCE_SIGNING_SECRET",
        requiredForRelease: true,
        documentation: "workers/auth/CLAUDE.md",
        summary: "Required for generated image save reference signing.",
      },
      {
        id: "auth-resend-secret",
        kind: "secret",
        worker: "auth",
        name: "RESEND_API_KEY",
        requiredForRelease: true,
        documentation: "workers/auth/CLAUDE.md",
        summary: "Required for auth email delivery.",
      },
      {
        id: "auth-ai-service-auth-secret",
        kind: "secret",
        worker: "auth",
        name: "AI_SERVICE_AUTH_SECRET",
        requiredForRelease: true,
        documentation: "workers/auth/CLAUDE.md",
        summary: "Required for signing internal AI requests.",
      },
      {
        id: "auth-billing-webhook-test-secret",
        kind: "secret",
        worker: "auth",
        name: "BILLING_WEBHOOK_TEST_SECRET",
        requiredForRelease: false,
        documentation: "PHASE2I_BILLING_EVENT_INGESTION_REPORT.md",
        summary: "Optional synthetic billing webhook verification secret; absent secret keeps the route fail-closed.",
      },
      {
        id: "auth-stripe-secret-key",
        kind: "secret",
        worker: "auth",
        name: "STRIPE_SECRET_KEY",
        requiredForRelease: false,
        documentation: "PHASE2J_STRIPE_TESTMODE_CREDIT_PACK_CHECKOUT_REPORT.md",
        summary: "Optional Stripe Testmode secret key; absent key keeps Stripe checkout fail-closed.",
      },
      {
        id: "auth-stripe-webhook-secret",
        kind: "secret",
        worker: "auth",
        name: "STRIPE_WEBHOOK_SECRET",
        requiredForRelease: false,
        documentation: "PHASE2J_STRIPE_TESTMODE_CREDIT_PACK_CHECKOUT_REPORT.md",
        summary: "Optional Stripe Testmode webhook endpoint secret; absent secret keeps Stripe webhooks fail-closed.",
      },
      {
        id: "auth-stripe-mode-var",
        kind: "dashboard_setting",
        worker: "auth",
        name: "STRIPE_MODE",
        requiredForRelease: false,
        documentation: "PHASE2J_STRIPE_TESTMODE_CREDIT_PACK_CHECKOUT_REPORT.md",
        summary: "Optional Stripe mode flag; Phase 2-J only supports test mode.",
      },
      {
        id: "auth-enable-admin-stripe-test-checkout-var",
        kind: "dashboard_setting",
        worker: "auth",
        name: "ENABLE_ADMIN_STRIPE_TEST_CHECKOUT",
        requiredForRelease: false,
        documentation: "PHASE2K_ADMIN_STRIPE_TESTMODE_LOCKDOWN_REPORT.md",
        summary: "Optional admin-only Stripe Testmode checkout kill switch; absent or non-true keeps checkout creation fail-closed.",
      },
      {
        id: "auth-stripe-checkout-success-url-var",
        kind: "dashboard_setting",
        worker: "auth",
        name: "STRIPE_CHECKOUT_SUCCESS_URL",
        requiredForRelease: false,
        documentation: "PHASE2J_STRIPE_TESTMODE_CREDIT_PACK_CHECKOUT_REPORT.md",
        summary: "Optional HTTPS success URL for Stripe Testmode checkout sessions.",
      },
      {
        id: "auth-stripe-checkout-cancel-url-var",
        kind: "dashboard_setting",
        worker: "auth",
        name: "STRIPE_CHECKOUT_CANCEL_URL",
        requiredForRelease: false,
        documentation: "PHASE2J_STRIPE_TESTMODE_CREDIT_PACK_CHECKOUT_REPORT.md",
        summary: "Optional HTTPS cancel URL for Stripe Testmode checkout sessions.",
      },
      {
        id: "auth-enable-live-stripe-credit-packs-var",
        kind: "dashboard_setting",
        worker: "auth",
        name: "ENABLE_LIVE_STRIPE_CREDIT_PACKS",
        requiredForRelease: false,
        documentation: "PHASE2L_LIVE_STRIPE_CREDIT_PACKS_AND_CREDITS_DASHBOARD_REPORT.md",
        summary: "Optional live Stripe credit-pack kill switch; absent or non-true keeps live checkout creation fail-closed.",
      },
      {
        id: "auth-stripe-live-secret-key",
        kind: "secret",
        worker: "auth",
        name: "STRIPE_LIVE_SECRET_KEY",
        requiredForRelease: false,
        documentation: "PHASE2L_LIVE_STRIPE_CREDIT_PACKS_AND_CREDITS_DASHBOARD_REPORT.md",
        summary: "Optional live Stripe secret key for Phase 2-L live credit-pack checkout.",
      },
      {
        id: "auth-stripe-live-webhook-secret",
        kind: "secret",
        worker: "auth",
        name: "STRIPE_LIVE_WEBHOOK_SECRET",
        requiredForRelease: false,
        documentation: "PHASE2L_LIVE_STRIPE_CREDIT_PACKS_AND_CREDITS_DASHBOARD_REPORT.md",
        summary: "Optional live Stripe webhook secret for Phase 2-L live credit-pack webhooks.",
      },
      {
        id: "auth-stripe-live-checkout-success-url-var",
        kind: "dashboard_setting",
        worker: "auth",
        name: "STRIPE_LIVE_CHECKOUT_SUCCESS_URL",
        requiredForRelease: false,
        documentation: "PHASE2L_LIVE_STRIPE_CREDIT_PACKS_AND_CREDITS_DASHBOARD_REPORT.md",
        summary: "Optional HTTPS success URL for live Stripe credit-pack checkout sessions.",
      },
      {
        id: "auth-stripe-live-checkout-cancel-url-var",
        kind: "dashboard_setting",
        worker: "auth",
        name: "STRIPE_LIVE_CHECKOUT_CANCEL_URL",
        requiredForRelease: false,
        documentation: "PHASE2L_LIVE_STRIPE_CREDIT_PACKS_AND_CREDITS_DASHBOARD_REPORT.md",
        summary: "Optional HTTPS cancel URL for live Stripe credit-pack checkout sessions.",
      },
      {
        id: "ai-service-auth-secret",
        kind: "secret",
        worker: "ai",
        name: "AI_SERVICE_AUTH_SECRET",
        requiredForRelease: true,
        documentation: "workers/ai/src/index.js",
        summary: "Required for verifying internal AI requests.",
      },
      {
        id: "ai-vidu-api-key",
        kind: "secret",
        worker: "ai",
        name: "VIDU_API_KEY",
        requiredForRelease: false,
        documentation: "AI_VIDEO_ASYNC_JOB_DESIGN.md",
        summary: "Required for async Vidu Q3 Pro provider tasks.",
      },
      {
        id: "contact-resend-secret",
        kind: "secret",
        worker: "contact",
        name: "RESEND_API_KEY",
        requiredForRelease: true,
        documentation: "workers/contact/src/index.js",
        summary: "Required for contact email delivery.",
      },
      {
        id: "auth-images-enabled",
        kind: "cloudflare_feature",
        worker: "auth",
        binding: "IMAGES",
        requiredForRelease: true,
        documentation: "docs/ai-image-derivatives-runbook.md",
        summary: "Cloudflare Images must be enabled for IMAGES.",
      },
      {
        id: "auth-activity-ingest-queue-created",
        kind: "cloudflare_queue",
        worker: "auth",
        binding: "ACTIVITY_INGEST_QUEUE",
        queue: "bitbi-auth-activity-ingest",
        requiredForRelease: true,
        documentation: "workers/auth/CLAUDE.md",
        summary: "The auth activity ingest queue must exist before auth deploy.",
      },
      {
        id: "auth-derivatives-queue-created",
        kind: "cloudflare_queue",
        worker: "auth",
        binding: "AI_IMAGE_DERIVATIVES_QUEUE",
        queue: "bitbi-ai-image-derivatives",
        requiredForRelease: true,
        documentation: "docs/ai-image-derivatives-runbook.md",
        summary: "The derivatives queue must exist before auth deploy.",
      },
      {
        id: "auth-ai-video-jobs-queue-created",
        kind: "cloudflare_queue",
        worker: "auth",
        binding: "AI_VIDEO_JOBS_QUEUE",
        queue: "bitbi-ai-video-jobs",
        requiredForRelease: true,
        documentation: "AI_VIDEO_ASYNC_JOB_DESIGN.md",
        summary: "The async AI video jobs queue must exist before auth deploy.",
      },
      {
        id: "auth-audit-archive-bucket-created",
        kind: "cloudflare_r2_bucket",
        worker: "auth",
        binding: "AUDIT_ARCHIVE",
        requiredForRelease: true,
        documentation: "workers/auth/CLAUDE.md",
        summary: "The private audit archive bucket must exist before auth deploy.",
      },
      {
        id: "auth-sensitive-post-waf-rule",
        kind: "dashboard_rule",
        requiredForRelease: false,
        documentation: "docs/cloudflare-rate-limiting-wave1.md",
        summary: "Dashboard-managed WAF rule remains manual-only.",
      },
      {
        id: "static-security-transform-rules",
        kind: "transform_rule",
        requiredForRelease: false,
        documentation: "docs/privacy-compliance-audit.md",
        summary: "Static security headers remain dashboard-managed.",
      },
      {
        id: "cloudflare-rum-setting",
        kind: "dashboard_setting",
        requiredForRelease: false,
        documentation: "docs/privacy-compliance-audit.md",
        summary: "RUM dashboard state remains manual-only.",
      },
    ],
  },
  assetVersion: {
    placeholder: "__ASSET_VERSION__",
  },
  authIndexRoutes: {
    literalRoutes: [
      "GET /api/health",
      "GET /api/public/news-pulse",
      "GET /api/me",
      "POST /api/register",
      "POST /api/login",
      "POST /api/logout",
      "GET /api/wallet/status",
      "POST /api/wallet/siwe/nonce",
      "POST /api/wallet/siwe/verify",
      "POST /api/wallet/unlink",
      "GET /api/profile",
      "PATCH /api/profile",
      "GET /api/profile/avatar",
      "GET /api/account/credits-dashboard",
      "POST /api/account/billing/checkout/live-credit-pack",
      "POST /api/profile/avatar",
      "DELETE /api/profile/avatar",
      "POST /api/forgot-password",
      "GET /api/reset-password/validate",
      "POST /api/reset-password",
      "GET /api/verify-email",
      "POST /api/resend-verification",
      "POST /api/request-reverification",
      "POST /api/billing/webhooks/test",
      "POST /api/billing/webhooks/stripe",
      "POST /api/billing/webhooks/stripe/live",
    ],
    delegatedExactPaths: [
      "/api/favorites",
      "/api/orgs",
    ],
    delegatedPrefixes: [
      "/api/admin/",
      "/api/ai/",
      "/api/gallery/",
      "/api/orgs/",
    ],
    protectedMediaPrefixes: [],
  },
  memberAi: {
    authRoutes: {
      literalRoutes: [
        "GET /api/ai/quota",
        "POST /api/ai/generate-image",
        "POST /api/ai/generate-text",
        "GET /api/ai/folders",
        "POST /api/ai/folders",
        "GET /api/ai/images",
        "GET /api/ai/assets",
        "PATCH /api/ai/assets/bulk-move",
        "POST /api/ai/assets/bulk-delete",
        "POST /api/ai/images/save",
        "POST /api/ai/audio/save",
        "PATCH /api/ai/images/bulk-move",
        "POST /api/ai/images/bulk-delete",
      ],
      patternRoutes: [
        "PATCH /api/ai/folders/:id",
        "DELETE /api/ai/folders/:id",
        "GET /api/ai/images/:id/file",
        "GET /api/ai/images/:id/thumb",
        "GET /api/ai/images/:id/medium",
        "GET /api/ai/text-assets/:id/file",
        "GET /api/ai/text-assets/:id/poster",
        "DELETE /api/ai/images/:id",
        "PATCH /api/ai/images/:id/publication",
        "PATCH /api/ai/images/:id/rename",
        "PATCH /api/ai/text-assets/:id/publication",
        "PATCH /api/ai/text-assets/:id/rename",
        "DELETE /api/ai/text-assets/:id",
      ],
    },
  },
  adminAi: {
    staticAuthApiPaths: [
      "/admin/ai/models",
      "/admin/ai/test-text",
      "/admin/ai/test-image",
      "/admin/ai/test-embeddings",
      "/admin/ai/test-music",
      "/admin/ai/test-video",
      "/admin/ai/video-jobs",
      "/admin/ai/video-jobs/poison",
      "/admin/ai/video-jobs/failed",
      "/admin/ai/compare",
      "/admin/ai/live-agent",
      "/admin/ai/save-text-asset",
      "/admin/ai/usage-attempts/cleanup-expired",
    ],
    authToAiRoutes: {
      "/api/admin/ai/models": "/internal/ai/models",
      "/api/admin/ai/test-text": "/internal/ai/test-text",
      "/api/admin/ai/test-image": "/internal/ai/test-image",
      "/api/admin/ai/test-embeddings": "/internal/ai/test-embeddings",
      "/api/admin/ai/test-music": "/internal/ai/test-music",
      "/api/admin/ai/test-video": "/internal/ai/test-video",
      "/api/admin/ai/compare": "/internal/ai/compare",
      "/api/admin/ai/live-agent": "/internal/ai/live-agent",
    },
    debugOnlyRoutes: [
      "/api/admin/ai/test-video",
    ],
    internalOnlyRoutes: [
      "/internal/ai/video-task/create",
      "/internal/ai/video-task/poll",
    ],
    authOnlyRoutes: [
      "/api/admin/ai/image-derivatives/backfill",
      "/api/admin/ai/save-text-asset",
      "/api/admin/ai/video-jobs",
      "/api/admin/ai/video-jobs/poison",
      "/api/admin/ai/video-jobs/failed",
      "/api/admin/ai/usage-attempts",
      "/api/admin/ai/usage-attempts/cleanup-expired",
      "/api/admin/ai/proxy-video",
    ],
    authOnlyPatternRoutes: [
      "GET /api/admin/ai/video-jobs/:id",
      "GET /api/admin/ai/video-jobs/poison/:id",
      "GET /api/admin/ai/video-jobs/failed/:id",
      "GET /api/admin/ai/usage-attempts/:id",
      "GET /api/admin/ai/video-jobs/:id/:param",
    ],
  },
  adminAuthRoutes: {
    literalRoutes: [
      "GET /api/admin/me",
      "GET /api/admin/users",
      "GET /api/admin/stats",
      "GET /api/admin/orgs",
      "GET /api/admin/billing/plans",
      "GET /api/admin/billing/events",
      "GET /api/admin/avatars/latest",
      "GET /api/admin/activity",
      "GET /api/admin/user-activity",
      "GET /api/admin/data-lifecycle/requests",
      "POST /api/admin/data-lifecycle/requests",
      "GET /api/admin/data-lifecycle/exports",
      "POST /api/admin/data-lifecycle/exports/cleanup-expired",
      "GET /api/admin/mfa/status",
      "POST /api/admin/mfa/setup",
      "POST /api/admin/mfa/enable",
      "POST /api/admin/mfa/verify",
      "POST /api/admin/mfa/disable",
      "POST /api/admin/mfa/recovery-codes/regenerate",
    ],
    patternRoutes: [
      "GET /api/admin/data-lifecycle/requests/:id",
      "GET /api/admin/orgs/:id",
      "GET /api/admin/orgs/:id/billing",
      "POST /api/admin/orgs/:id/credits/grant",
      "GET /api/admin/users/:id/billing",
      "POST /api/admin/users/:id/credits/grant",
      "GET /api/admin/billing/events/:id",
      "POST /api/admin/data-lifecycle/requests/:id/plan",
      "POST /api/admin/data-lifecycle/requests/:id/approve",
      "POST /api/admin/data-lifecycle/requests/:id/generate-export",
      "POST /api/admin/data-lifecycle/requests/:id/execute-safe",
      "GET /api/admin/data-lifecycle/requests/:id/export",
      "GET /api/admin/data-lifecycle/exports/:id",
    ],
    staticAuthApiPaths: [
      "/admin/mfa/status",
      "/admin/mfa/setup",
      "/admin/mfa/enable",
      "/admin/mfa/verify",
      "/admin/mfa/disable",
      "/admin/mfa/recovery-codes/regenerate",
    ],
  },
};

function createValidContext() {
  const existingPaths = new Set([
    "workers/auth/wrangler.jsonc",
    "workers/ai/wrangler.jsonc",
    "workers/ai/src/index.js",
    "workers/contact/wrangler.jsonc",
    "workers/auth/CLAUDE.md",
    "workers/contact/src/index.js",
    "docs/ai-image-derivatives-runbook.md",
    "AI_VIDEO_ASYNC_JOB_DESIGN.md",
    "PHASE2I_BILLING_EVENT_INGESTION_REPORT.md",
    "PHASE2J_STRIPE_TESTMODE_CREDIT_PACK_CHECKOUT_REPORT.md",
    "PHASE2K_ADMIN_STRIPE_TESTMODE_LOCKDOWN_REPORT.md",
    "PHASE2L_LIVE_STRIPE_CREDIT_PACKS_AND_CREDITS_DASHBOARD_REPORT.md",
    "docs/cloudflare-rate-limiting-wave1.md",
    "docs/privacy-compliance-audit.md",
  ]);

  return {
    manifest: structuredClone(baseManifest),
    schemaCheckpoints: {
      auth: {
        exists: true,
        migrationDirectory: "workers/auth/migrations",
        files: [
          "0024_add_text_asset_poster.sql",
          "0025_add_media_favorite_types.sql",
          "0026_add_cursor_pagination_support.sql",
          "0027_add_admin_mfa.sql",
          "0028_add_admin_mfa_failed_attempts.sql",
          "0029_add_ai_video_jobs.sql",
          "0030_harden_ai_video_jobs_phase1b.sql",
          "0031_add_activity_search_index.sql",
          "0033_harden_data_export_archives.sql",
          "0034_add_organizations.sql",
          "0036_add_ai_usage_attempts.sql",
          "0037_add_billing_event_ingestion.sql",
          "0038_add_stripe_credit_pack_checkout.sql",
          "0039_raise_credit_balance_cap_for_pricing_packs.sql",
          "0040_add_live_stripe_credit_pack_scope.sql",
          "0041_add_member_credit_ledger.sql",
        ],
      },
    },
    workerConfigs: {
      ai: {
        exists: true,
        wranglerPath: "workers/ai/wrangler.jsonc",
        wrangler: {
          name: "bitbi-ai",
          workers_dev: false,
          preview_urls: false,
          ai: { binding: "AI" },
          durable_objects: {
            bindings: [
              {
                name: "SERVICE_AUTH_REPLAY",
                class_name: "AiServiceAuthReplayDurableObject",
              },
            ],
          },
          migrations: [
            {
              tag: "v1-service-auth-replay",
              new_sqlite_classes: ["AiServiceAuthReplayDurableObject"],
            },
          ],
        },
      },
      auth: {
        exists: true,
        wranglerPath: "workers/auth/wrangler.jsonc",
        wrangler: {
          name: "bitbi-auth",
          vars: {
            APP_BASE_URL: "https://bitbi.ai",
            RESEND_FROM_EMAIL: "BITBI <noreply@contact.bitbi.ai>",
            BITBI_ENV: "production",
          },
          triggers: {
            crons: ["0 3 * * *"],
          },
          routes: [
            {
              pattern: "bitbi.ai/api/*",
              zone_name: "bitbi.ai",
            },
          ],
          ai: { binding: "AI" },
          images: { binding: "IMAGES" },
          d1_databases: [{ binding: "DB", database_name: "bitbi-auth-db" }],
          durable_objects: {
            bindings: [
              {
                binding: "PUBLIC_RATE_LIMITER",
                class_name: "AuthPublicRateLimiterDurableObject",
              },
            ],
          },
          migrations: [
            {
              tag: "v1-public-rate-limiter",
              new_sqlite_classes: ["AuthPublicRateLimiterDurableObject"],
            },
          ],
          r2_buckets: [
            { binding: "PRIVATE_MEDIA", bucket_name: "bitbi-private-media" },
            { binding: "USER_IMAGES", bucket_name: "bitbi-user-images" },
            { binding: "AUDIT_ARCHIVE", bucket_name: "bitbi-audit-archive" },
          ],
          services: [{ binding: "AI_LAB", service: "bitbi-ai" }],
          queues: {
            producers: [
              {
                binding: "ACTIVITY_INGEST_QUEUE",
                queue: "bitbi-auth-activity-ingest",
              },
              {
                binding: "AI_IMAGE_DERIVATIVES_QUEUE",
                queue: "bitbi-ai-image-derivatives",
              },
              {
                binding: "AI_VIDEO_JOBS_QUEUE",
                queue: "bitbi-ai-video-jobs",
              },
            ],
            consumers: [
              {
                queue: "bitbi-auth-activity-ingest",
                max_batch_size: 50,
                max_batch_timeout: 5,
                max_retries: 6,
              },
              {
                queue: "bitbi-ai-image-derivatives",
                max_batch_size: 5,
                max_batch_timeout: 5,
                max_retries: 8,
              },
              {
                queue: "bitbi-ai-video-jobs",
                max_batch_size: 3,
                max_batch_timeout: 5,
                max_retries: 4,
              },
            ],
          },
        },
      },
      contact: {
        exists: true,
        wranglerPath: "workers/contact/wrangler.jsonc",
        wrangler: {
          name: "bitbi-contact",
          workers_dev: false,
          vars: {
            BITBI_ENV: "production",
          },
          routes: [
            {
              pattern: "contact.bitbi.ai",
              custom_domain: true,
            },
          ],
          durable_objects: {
            bindings: [
              {
                binding: "PUBLIC_RATE_LIMITER",
                class_name: "ContactPublicRateLimiterDurableObject",
              },
            ],
          },
          migrations: [
            {
              tag: "v1-public-rate-limiter",
              new_sqlite_classes: ["ContactPublicRateLimiterDurableObject"],
            },
          ],
        },
      },
    },
    pathExists(relativePath) {
      return existingPaths.has(relativePath);
    },
    authApiSource: `
      export function apiAdminMfaStatus() { return request('GET', '/admin/mfa/status'); }
      export function apiAdminMfaSetup() { return request('POST', '/admin/mfa/setup'); }
      export function apiAdminMfaEnable() { return request('POST', '/admin/mfa/enable'); }
      export function apiAdminMfaVerify() { return request('POST', '/admin/mfa/verify'); }
      export function apiAdminMfaDisable() { return request('POST', '/admin/mfa/disable'); }
      export function apiAdminMfaRegenerateRecoveryCodes() { return request('POST', '/admin/mfa/recovery-codes/regenerate'); }
      export function apiAdminAiModels() { return request('GET', '/admin/ai/models'); }
      export function apiAdminAiTestText() { return request('POST', '/admin/ai/test-text'); }
      export function apiAdminAiTestImage() { return request('POST', '/admin/ai/test-image'); }
      export function apiAdminAiTestEmbeddings() { return request('POST', '/admin/ai/test-embeddings'); }
      export function apiAdminAiTestMusic() { return request('POST', '/admin/ai/test-music'); }
      export function apiAdminAiTestVideo() { return request('POST', '/admin/ai/test-video'); }
      export function apiAdminAiCreateVideoJob() { return request('POST', '/admin/ai/video-jobs'); }
      export function apiAdminAiListVideoJobPoisonMessages() { return request('GET', '/admin/ai/video-jobs/poison'); }
      export function apiAdminAiListFailedVideoJobs() { return request('GET', '/admin/ai/video-jobs/failed'); }
      export function apiAdminAiCompare() { return request('POST', '/admin/ai/compare'); }
      export function apiAdminAiLiveAgent() { return request('POST', '/admin/ai/live-agent'); }
      export function apiAdminAiSaveTextAsset() { return request('POST', '/admin/ai/save-text-asset'); }
      export function apiAdminAiCleanupUsageAttempts() { return request('POST', '/admin/ai/usage-attempts/cleanup-expired'); }
    `,
    authIndexSource: `
      if (pathname === "/api/health" && method === "GET") return handleHealth();
      if (pathname === "/api/public/news-pulse" && method === "GET") return handlePublicNewsPulse();
      if (pathname === "/api/me" && method === "GET") return handleMe();
      if (pathname === "/api/register" && method === "POST") return handleRegister();
      if (pathname === "/api/login" && method === "POST") return handleLogin();
      if (pathname === "/api/logout" && method === "POST") return handleLogout();
      if (pathname === "/api/wallet/status" && method === "GET") return handleWalletStatus();
      if (pathname === "/api/wallet/siwe/nonce" && method === "POST") return handleWalletSiweNonce();
      if (pathname === "/api/wallet/siwe/verify" && method === "POST") return handleWalletSiweVerify();
      if (pathname === "/api/wallet/unlink" && method === "POST") return handleWalletUnlink();
      if (pathname === "/api/profile" && method === "GET") return handleGetProfile();
      if (pathname === "/api/profile" && method === "PATCH") return handleUpdateProfile();
      if (pathname === "/api/profile/avatar" && method === "GET") return handleGetAvatar();
      if (pathname === "/api/account/credits-dashboard" && method === "GET") return handleAccountCredits();
      if (pathname === "/api/account/billing/checkout/live-credit-pack" && method === "POST") return handleAccountCredits();
      if (pathname === "/api/profile/avatar" && method === "POST") return handleUploadAvatar();
      if (pathname === "/api/profile/avatar" && method === "DELETE") return handleDeleteAvatar();
      if (pathname === "/api/favorites") { return handleFavorites(); }
      if (pathname === "/api/orgs") { return handleOrgs(); }
      if (pathname.startsWith("/api/orgs/")) { return handleOrgs(); }
      if (pathname === "/api/billing/webhooks/test" && method === "POST") return handleBillingWebhooks();
      if (pathname === "/api/billing/webhooks/stripe" && method === "POST") return handleBillingWebhooks();
      if (pathname === "/api/billing/webhooks/stripe/live" && method === "POST") return handleBillingWebhooks();
      if (pathname.startsWith("/api/admin/")) { return handleAdmin(); }
      if (pathname === "/api/forgot-password" && method === "POST") return handleForgotPassword();
      if (pathname === "/api/reset-password/validate" && method === "GET") return handleValidateReset();
      if (pathname === "/api/reset-password" && method === "POST") return handleResetPassword();
      if (pathname === "/api/verify-email" && method === "GET") return handleVerifyEmail();
      if (pathname === "/api/resend-verification" && method === "POST") return handleResendVerification();
      if (pathname === "/api/request-reverification" && method === "POST") return handleRequestReverification();
      if (pathname.startsWith("/api/ai/")) { return handleAI(); }
      if (pathname.startsWith("/api/gallery/")) { return handleGallery(); }
    `,
    authAiSource: `
      if (pathname === "/api/ai/quota" && method === "GET") return handleQuota();
      if (pathname === "/api/ai/generate-image" && method === "POST") return handleGenerateImage();
      if (pathname === "/api/ai/generate-text" && method === "POST") return handleGenerateText();
      if (pathname === "/api/ai/folders" && method === "GET") return handleGetFolders();
      if (pathname === "/api/ai/folders" && method === "POST") return handleCreateFolder();
      if (pathname === "/api/ai/images" && method === "GET") return handleGetImages();
      if (pathname === "/api/ai/assets" && method === "GET") return handleGetAssets();
      if (pathname === "/api/ai/assets/bulk-move" && method === "PATCH") return handleBulkMoveAssets();
      if (pathname === "/api/ai/assets/bulk-delete" && method === "POST") return handleBulkDeleteAssets();
      if (pathname === "/api/ai/images/save" && method === "POST") return handleSaveImage();
      if (pathname === "/api/ai/audio/save" && method === "POST") return handleSaveAudio();
      if (pathname === "/api/ai/images/bulk-move" && method === "PATCH") return handleBulkMove();
      if (pathname === "/api/ai/images/bulk-delete" && method === "POST") return handleBulkDelete();
      const folderMatch = pathname.match(/^\/api\/ai\/folders\/([a-f0-9]+)$/);
      if (folderMatch && method === "PATCH") return handleRenameFolder();
      if (folderMatch && method === "DELETE") return handleDeleteFolder();
      const fileMatch = pathname.match(/^\/api\/ai\/images\/([a-f0-9]+)\/file$/);
      if (fileMatch && method === "GET") return handleGetImageFile();
      const thumbMatch = pathname.match(/^\/api\/ai\/images\/([a-f0-9]+)\/thumb$/);
      if (thumbMatch && method === "GET") return handleGetImageDerivative();
      const mediumMatch = pathname.match(/^\/api\/ai\/images\/([a-f0-9]+)\/medium$/);
      if (mediumMatch && method === "GET") return handleGetImageDerivative();
      const textFileMatch = pathname.match(/^\/api\/ai\/text-assets\/([a-f0-9]+)\/file$/);
      if (textFileMatch && method === "GET") return handleGetTextAssetFile();
      const textPosterMatch = pathname.match(/^\/api\/ai\/text-assets\/([a-f0-9]+)\/poster$/);
      if (textPosterMatch && method === "GET") return handleGetTextAssetPoster();
      const deleteMatch = pathname.match(/^\/api\/ai\/images\/([a-f0-9]+)$/);
      if (deleteMatch && method === "DELETE") return handleDeleteImage();
      const publicationMatch = pathname.match(/^\/api\/ai\/images\/([a-f0-9]+)\/publication$/);
      if (publicationMatch && method === "PATCH") return handleUpdateImagePublication();
      const imageRenameMatch = pathname.match(/^\/api\/ai\/images\/([a-f0-9]+)\/rename$/);
      if (imageRenameMatch && method === "PATCH") return handleRenameImage();
      const textPublicationMatch = pathname.match(/^\/api\/ai\/text-assets\/([a-f0-9]+)\/publication$/);
      if (textPublicationMatch && method === "PATCH") return handleUpdateTextAssetPublication();
      const textRenameMatch = pathname.match(/^\/api\/ai\/text-assets\/([a-f0-9]+)\/rename$/);
      if (textRenameMatch && method === "PATCH") return handleRenameTextAsset();
      const textDeleteMatch = pathname.match(/^\/api\/ai\/text-assets\/([a-f0-9]+)$/);
      if (textDeleteMatch && method === "DELETE") return handleDeleteTextAsset();
    `,
    authAdminSource: `
      if (pathname === "/api/admin/me" && method === "GET") return handleAdminMe();
      if (pathname === "/api/admin/users" && method === "GET") return handleAdminUsers();
      if (pathname === "/api/admin/stats" && method === "GET") return handleAdminStats();
      if (pathname === "/api/admin/orgs" && method === "GET") return handleAdminOrgs();
      if (pathname === "/api/admin/billing/plans" && method === "GET") return handleAdminBillingPlans();
      if (pathname === "/api/admin/billing/events" && method === "GET") return handleAdminBillingEvents();
      if (pathname === "/api/admin/avatars/latest" && method === "GET") return handleAdminLatestAvatars();
      if (pathname === "/api/admin/activity" && method === "GET") return handleAdminActivity();
      if (pathname === "/api/admin/user-activity" && method === "GET") return handleAdminUserActivity();
      if (pathname === "/api/admin/data-lifecycle/requests" && method === "GET") return handleDataLifecycleRequests();
      if (pathname === "/api/admin/data-lifecycle/requests" && method === "POST") return handleCreateDataLifecycleRequest();
      if (pathname === "/api/admin/data-lifecycle/exports" && method === "GET") return handleDataLifecycleExports();
      if (pathname === "/api/admin/data-lifecycle/exports/cleanup-expired" && method === "POST") return handleDataLifecycleExportCleanup();
      const dataLifecycleDetailMatch = pathname.match(/^\\/api\\/admin\\/data-lifecycle\\/requests\\/([^/]+)$/);
      if (dataLifecycleDetailMatch && method === "GET") return handleDataLifecycleRequest();
      const dataLifecyclePlanMatch = pathname.match(/^\\/api\\/admin\\/data-lifecycle\\/requests\\/([^/]+)\\/plan$/);
      if (dataLifecyclePlanMatch && method === "POST") return handleDataLifecyclePlan();
      const dataLifecycleApproveMatch = pathname.match(/^\\/api\\/admin\\/data-lifecycle\\/requests\\/([^/]+)\\/approve$/);
      if (dataLifecycleApproveMatch && method === "POST") return handleDataLifecycleApprove();
      const dataLifecycleGenerateExportMatch = pathname.match(/^\\/api\\/admin\\/data-lifecycle\\/requests\\/([^/]+)\\/generate-export$/);
      if (dataLifecycleGenerateExportMatch && method === "POST") return handleDataLifecycleGenerateExport();
      const dataLifecycleExecuteSafeMatch = pathname.match(/^\\/api\\/admin\\/data-lifecycle\\/requests\\/([^/]+)\\/execute-safe$/);
      if (dataLifecycleExecuteSafeMatch && method === "POST") return handleDataLifecycleExecuteSafe();
      const dataLifecycleRequestExportMatch = pathname.match(/^\\/api\\/admin\\/data-lifecycle\\/requests\\/([^/]+)\\/export$/);
      if (dataLifecycleRequestExportMatch && method === "GET") return handleDataLifecycleRequestExport();
      const dataLifecycleArchiveMatch = pathname.match(/^\\/api\\/admin\\/data-lifecycle\\/exports\\/([^/]+)$/);
      if (dataLifecycleArchiveMatch && method === "GET") return handleDataLifecycleArchive();
      const adminOrgMatch = pathname.match(/^\\/api\\/admin\\/orgs\\/([^/]+)$/);
      if (adminOrgMatch && method === "GET") return handleAdminOrg();
      const adminOrgBillingMatch = pathname.match(/^\\/api\\/admin\\/orgs\\/([^/]+)\\/billing$/);
      if (adminOrgBillingMatch && method === "GET") return handleAdminOrgBilling();
      const adminOrgCreditGrantMatch = pathname.match(/^\\/api\\/admin\\/orgs\\/([^/]+)\\/credits\\/grant$/);
      if (adminOrgCreditGrantMatch && method === "POST") return handleAdminOrgCreditGrant();
      const adminUserBillingMatch = pathname.match(/^\\/api\\/admin\\/users\\/([^/]+)\\/billing$/);
      if (adminUserBillingMatch && method === "GET") return handleAdminUserBilling();
      const adminUserCreditGrantMatch = pathname.match(/^\\/api\\/admin\\/users\\/([^/]+)\\/credits\\/grant$/);
      if (adminUserCreditGrantMatch && method === "POST") return handleAdminUserCreditGrant();
      const adminBillingEventMatch = pathname.match(/^\\/api\\/admin\\/billing\\/events\\/([^/]+)$/);
      if (adminBillingEventMatch && method === "GET") return handleAdminBillingEvent();
    `,
    authAdminMfaSource: `
      if (pathname === "/api/admin/mfa/status" && method === "GET") return handleAdminMfaStatus();
      if (pathname === "/api/admin/mfa/setup" && method === "POST") return handleAdminMfaSetup();
      if (pathname === "/api/admin/mfa/enable" && method === "POST") return handleAdminMfaEnable();
      if (pathname === "/api/admin/mfa/verify" && method === "POST") return handleAdminMfaVerify();
      if (pathname === "/api/admin/mfa/disable" && method === "POST") return handleAdminMfaDisable();
      if (pathname === "/api/admin/mfa/recovery-codes/regenerate" && method === "POST") return handleAdminMfaRegenerate();
    `,
    authAdminAiSource: `
      if (pathname === "/api/admin/ai/models" && method === "GET") return proxyToAiLab("/internal/ai/models");
      if (pathname === "/api/admin/ai/test-text" && method === "POST") return proxyToAiLab("/internal/ai/test-text");
      if (pathname === "/api/admin/ai/test-image" && method === "POST") return proxyToAiLab("/internal/ai/test-image");
      if (pathname === "/api/admin/ai/test-embeddings" && method === "POST") return proxyToAiLab("/internal/ai/test-embeddings");
      if (pathname === "/api/admin/ai/test-music" && method === "POST") return proxyToAiLab("/internal/ai/test-music");
      if (pathname === "/api/admin/ai/test-video" && method === "POST") return proxyToAiLab("/internal/ai/test-video");
      if (pathname === "/api/admin/ai/video-jobs" && method === "POST") return handleCreateVideoJob();
      if (pathname === "/api/admin/ai/video-jobs/poison" && method === "GET") return handleVideoJobPoisonList();
      if (pathname === "/api/admin/ai/video-jobs/failed" && method === "GET") return handleVideoJobFailedList();
      if (pathname === "/api/admin/ai/usage-attempts" && method === "GET") return handleUsageAttemptList();
      if (pathname === "/api/admin/ai/usage-attempts/cleanup-expired" && method === "POST") return handleUsageAttemptCleanup();
      const videoJobPoisonMatch = pathname.match(/^\\/api\\/admin\\/ai\\/video-jobs\\/poison\\/([^/]+)$/);
      if (videoJobPoisonMatch && method === "GET") return handleVideoJobPoisonDetail();
      const videoJobFailedMatch = pathname.match(/^\\/api\\/admin\\/ai\\/video-jobs\\/failed\\/([^/]+)$/);
      if (videoJobFailedMatch && method === "GET") return handleVideoJobFailedDetail();
      const usageAttemptMatch = pathname.match(/^\\/api\\/admin\\/ai\\/usage-attempts\\/([^/]+)$/);
      if (usageAttemptMatch && method === "GET") return handleUsageAttemptDetail();
      const videoJobStatusMatch = pathname.match(/^\\/api\\/admin\\/ai\\/video-jobs\\/([^/]+)$/);
      if (videoJobStatusMatch && method === "GET") return handleVideoJobStatus();
      const videoJobOutputMatch = pathname.match(/^\\/api\\/admin\\/ai\\/video-jobs\\/([^/]+)\\/(output|poster)$/);
      if (videoJobOutputMatch && method === "GET") return handleVideoJobOutput();
      if (pathname === "/api/admin/ai/compare" && method === "POST") return proxyToAiLab("/internal/ai/compare");
      if (pathname === "/api/admin/ai/live-agent" && method === "POST") return proxyLiveAgentToAiLab();
      if (pathname === "/api/admin/ai/image-derivatives/backfill" && method === "POST") return handleBackfill();
      if (pathname === "/api/admin/ai/save-text-asset" && method === "POST") return handleSaveTextAsset();
      if (pathname === "/api/admin/ai/proxy-video" && method === "POST") return rejectProxyVideo();
    `,
    authAdminAiProxySource: `
      export async function proxyLiveAgentToAiLab() {
        return fetch("/internal/ai/live-agent");
      }
    `,
    aiIndexSource: `
      if (pathname === "/internal/ai/models" && method === "GET") return handleModels();
      if (pathname === "/internal/ai/test-text" && method === "POST") return handleText();
      if (pathname === "/internal/ai/test-image" && method === "POST") return handleImage();
      if (pathname === "/internal/ai/test-embeddings" && method === "POST") return handleEmbeddings();
      if (pathname === "/internal/ai/test-music" && method === "POST") return handleMusic();
      if (pathname === "/internal/ai/test-video" && method === "POST") return handleVideo();
      if (pathname === "/internal/ai/video-task/create" && method === "POST") return handleVideoTaskCreate();
      if (pathname === "/internal/ai/video-task/poll" && method === "POST") return handleVideoTaskPoll();
      if (pathname === "/internal/ai/compare" && method === "POST") return handleCompare();
      if (pathname === "/internal/ai/live-agent" && method === "POST") return handleLiveAgent();
    `,
    workflowSource: `
  release-compatibility:
    steps:
      - run: npm run check:toolchain
      - run: npm run test:quality-gates
      - run: npm run check:secrets
      - run: npm run check:dom-sinks
      - run: npm run check:route-policies
      - run: npm run test:operational-readiness
      - run: npm run check:operational-readiness
      - run: npm run check:live-health
      - run: npm run check:live-security-headers
      - run: npm run check:js
      - run: npm run check:worker-body-parsers
      - run: npm run check:admin-activity-query-shape
      - run: npm run check:data-lifecycle
      - run: npm run test:release-compat
      - run: npm run test:release-plan
      - run: npm run test:asset-version
      - run: npm run validate:release
      - run: npm run validate:asset-version
  worker-validation:
    needs: release-compatibility
  deploy:
    needs: [release-compatibility, worker-validation]
    steps:
      - run: npm run build:static
    `,
  };
}

{
  assert.equal(
    extractLatestMigrationFilename([
      "0001_init.sql",
      "0017_add_ai_image_derivatives.sql",
      "0016_add_ai_text_assets.sql",
    ]),
    "0017_add_ai_image_derivatives.sql"
  );
}

{
  const issues = validateReleaseCompatibility(createValidContext());
  assert.deepEqual(issues, []);
}

{
  const issues = validateReleaseCompatibility(loadReleaseCompatibilityContext(repoRoot));
  assert.deepEqual(issues, []);
}

{
  const context = createValidContext();
  context.manifest.release.schemaCheckpoints.auth.latest = "0016_add_ai_text_assets.sql";
  const issues = validateReleaseCompatibility(context);
  assert(issues.some((issue) => issue.includes('schema checkpoint "auth"')));
}

{
  const context = createValidContext();
  context.workerConfigs.auth.wrangler.queues.producers = context.workerConfigs.auth.wrangler.queues.producers.filter(
    (row) => row.binding !== "ACTIVITY_INGEST_QUEUE"
  );
  const issues = validateReleaseCompatibility(context);
  assert(
    issues.some((issue) =>
      issue.includes('Worker "auth" is missing queue producer binding "ACTIVITY_INGEST_QUEUE"')
    )
  );
}

{
  const context = createValidContext();
  context.workerConfigs.auth.wrangler.r2_buckets = [
    { binding: "PRIVATE_MEDIA", bucket_name: "bitbi-private-media" },
    { binding: "AUDIT_ARCHIVE", bucket_name: "bitbi-audit-archive" },
  ];
  const issues = validateReleaseCompatibility(context);
  assert(issues.some((issue) => issue.includes('missing R2 binding "USER_IMAGES"')));
}

{
  const context = createValidContext();
  context.workerConfigs.auth.wrangler.r2_buckets = [
    { binding: "PRIVATE_MEDIA", bucket_name: "bitbi-private-media" },
    { binding: "USER_IMAGES", bucket_name: "bitbi-user-images" },
  ];
  const issues = validateReleaseCompatibility(context);
  assert(issues.some((issue) => issue.includes('missing R2 binding "AUDIT_ARCHIVE"')));
}

{
  const context = createValidContext();
  context.workerConfigs.contact.exists = false;
  context.workerConfigs.contact.wrangler = null;
  const basePathExists = context.pathExists;
  context.pathExists = (relativePath) =>
    relativePath === "workers/contact/wrangler.jsonc" ? false : basePathExists(relativePath);
  const issues = validateReleaseCompatibility(context);
  assert(
    issues.some((issue) =>
      issue.includes('references missing wrangler config "workers/contact/wrangler.jsonc"')
    )
  );
}

{
  const context = createValidContext();
  context.manifest.release.deployOrder[2].dependsOn = ["auth-migrations"];
  const issues = validateReleaseCompatibility(context);
  assert(
    issues.some((issue) =>
      issue.includes('must depend on "ai-worker" because worker "auth" binds service worker "ai"')
    )
  );
}

{
  const context = createValidContext();
  context.manifest.release.manualPrerequisites = [];
  const issues = validateReleaseCompatibility(context);
  assert(
    issues.some((issue) => issue.includes("must declare manualPrerequisites"))
  );
}

{
  const context = createValidContext();
  context.manifest.adminAi.staticAuthApiPaths = context.manifest.adminAi.staticAuthApiPaths.filter(
    (route) => route !== "/admin/ai/test-video"
  );
  const issues = validateReleaseCompatibility(context);
  assert(
    issues.some((issue) =>
      issue.includes("Admin AI static auth API path contract") &&
      issue.includes("/admin/ai/test-video")
    )
  );
}

{
  const context = createValidContext();
  context.manifest.adminAi.debugOnlyRoutes = [];
  const issues = validateReleaseCompatibility(context);
  assert(
    issues.some((issue) =>
      issue.includes('must be declared in debugOnlyRoutes')
    )
  );
}

{
  const context = createValidContext();
  context.manifest.adminAi.authOnlyPatternRoutes = [];
  const issues = validateReleaseCompatibility(context);
  assert(
    issues.some((issue) =>
      issue.includes("Admin AI external pattern route ownership contract") &&
      issue.includes("GET /api/admin/ai/video-jobs/:id")
    )
  );
}

{
  const context = createValidContext();
  context.manifest.adminAuthRoutes.literalRoutes = context.manifest.adminAuthRoutes.literalRoutes.filter(
    (route) => route !== "POST /api/admin/mfa/verify"
  );
  const issues = validateReleaseCompatibility(context);
  assert(
    issues.some((issue) =>
      issue.includes("Admin auth literal route contract") &&
      issue.includes("POST /api/admin/mfa/verify")
    )
  );
}

{
  const context = createValidContext();
  context.manifest.adminAuthRoutes.patternRoutes = [];
  const issues = validateReleaseCompatibility(context);
  assert(
    issues.some((issue) =>
      issue.includes("Admin auth pattern route contract") &&
      issue.includes("POST /api/admin/data-lifecycle/requests/:id/approve")
    )
  );
}

{
  const context = createValidContext();
  context.workerConfigs.auth.wrangler.vars.BITBI_ENV = "staging";
  const issues = validateReleaseCompatibility(context);
  assert(
    issues.some((issue) =>
      issue.includes('Worker "auth" wrangler var "BITBI_ENV" must equal')
    )
  );
}

{
  const context = createValidContext();
  context.workerConfigs.auth.wrangler.durable_objects.bindings = [];
  const issues = validateReleaseCompatibility(context);
  assert(
    issues.some((issue) =>
      issue.includes('Worker "auth" is missing Durable Object binding "PUBLIC_RATE_LIMITER"')
    )
  );
}

{
  const context = createValidContext();
  context.workerConfigs.contact.wrangler.migrations = [];
  const issues = validateReleaseCompatibility(context);
  assert(
    issues.some((issue) =>
      issue.includes('Worker "contact" is missing wrangler migration tag "v1-public-rate-limiter"')
    )
  );
}

{
  const context = createValidContext();
  context.workerConfigs.auth.wrangler.r2_buckets.push({
    binding: "TEMP_BUCKET",
    bucket_name: "bitbi-temp",
  });
  const issues = validateReleaseCompatibility(context);
  assert(
    issues.some((issue) =>
      issue.includes('Worker "auth" R2 binding contract has unexpected entries: TEMP_BUCKET.')
    )
  );
}

{
  const context = createValidContext();
  context.workerConfigs.auth.wrangler.queues.consumers.push({
    queue: "bitbi-untracked-queue",
    max_batch_size: 1,
    max_batch_timeout: 1,
    max_retries: 1,
  });
  const issues = validateReleaseCompatibility(context);
  assert(
    issues.some((issue) =>
      issue.includes(
        'Worker "auth" queue consumer contract has unexpected entries: bitbi-untracked-queue.'
      )
    )
  );
}

{
  const context = createValidContext();
  context.manifest.release.deployOrder = context.manifest.release.deployOrder.filter(
    (step) => step.type !== "static"
  );
  const issues = validateReleaseCompatibility(context);
  assert(
    issues.some((issue) =>
      issue.includes("deployOrder must include a static deploy step")
    )
  );
}

{
  const context = createValidContext();
  context.manifest.memberAi.authRoutes.literalRoutes =
    context.manifest.memberAi.authRoutes.literalRoutes.filter(
      (route) => route !== "POST /api/ai/audio/save"
    );
  const issues = validateReleaseCompatibility(context);
  assert(
    issues.some((issue) =>
      issue.includes("Member AI literal route contract") &&
      issue.includes("POST /api/ai/audio/save")
    )
  );
}

console.log("Release compatibility tests passed.");
