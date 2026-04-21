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
        latest: "0017_add_ai_image_derivatives.sql",
        databaseName: "bitbi-auth-db",
      },
    },
    workers: {
      ai: {
        name: "bitbi-ai",
        wranglerPath: "workers/ai/wrangler.jsonc",
        bindings: {
          ai: "AI",
        },
      },
      auth: {
        name: "bitbi-auth",
        wranglerPath: "workers/auth/wrangler.jsonc",
        vars: ["APP_BASE_URL", "RESEND_FROM_EMAIL"],
        bindings: {
          ai: "AI",
          images: "IMAGES",
          d1: {
            DB: { databaseName: "bitbi-auth-db" },
          },
          r2: {
            PRIVATE_MEDIA: { bucketName: "bitbi-private-media" },
            USER_IMAGES: { bucketName: "bitbi-user-images" },
          },
          services: {
            AI_LAB: { service: "bitbi-ai", worker: "ai" },
          },
          queues: {
            producers: {
              AI_IMAGE_DERIVATIVES_QUEUE: { queue: "bitbi-ai-image-derivatives" },
            },
            consumers: [
              {
                queue: "bitbi-ai-image-derivatives",
                max_batch_size: 5,
                max_batch_timeout: 5,
                max_retries: 8,
              },
            ],
          },
        },
      },
      contact: {
        name: "bitbi-contact",
        wranglerPath: "workers/contact/wrangler.jsonc",
        bindings: {
          d1: {
            DB: { databaseName: "bitbi-auth-db" },
          },
        },
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
        dependsOn: ["auth-migrations"],
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
        summary: "Required for auth sessions and signed pagination cursors.",
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
  adminAi: {
    staticAuthApiPaths: [
      "/admin/ai/models",
      "/admin/ai/test-text",
      "/admin/ai/test-image",
      "/admin/ai/test-embeddings",
      "/admin/ai/compare",
      "/admin/ai/live-agent",
      "/admin/ai/save-text-asset",
    ],
    authToAiRoutes: {
      "/api/admin/ai/models": "/internal/ai/models",
      "/api/admin/ai/test-text": "/internal/ai/test-text",
      "/api/admin/ai/compare": "/internal/ai/compare",
      "/api/admin/ai/live-agent": "/internal/ai/live-agent",
    },
  },
};

function createValidContext() {
  const existingPaths = new Set([
    "workers/auth/wrangler.jsonc",
    "workers/ai/wrangler.jsonc",
    "workers/contact/wrangler.jsonc",
    "workers/auth/CLAUDE.md",
    "workers/contact/src/index.js",
    "docs/ai-image-derivatives-runbook.md",
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
          "0016_add_ai_text_assets.sql",
          "0017_add_ai_image_derivatives.sql",
        ],
      },
    },
    workerConfigs: {
      ai: {
        exists: true,
        wranglerPath: "workers/ai/wrangler.jsonc",
        wrangler: {
          name: "bitbi-ai",
          ai: { binding: "AI" },
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
          },
          ai: { binding: "AI" },
          images: { binding: "IMAGES" },
          d1_databases: [{ binding: "DB", database_name: "bitbi-auth-db" }],
          r2_buckets: [
            { binding: "PRIVATE_MEDIA", bucket_name: "bitbi-private-media" },
            { binding: "USER_IMAGES", bucket_name: "bitbi-user-images" },
          ],
          services: [{ binding: "AI_LAB", service: "bitbi-ai" }],
          queues: {
            producers: [
              {
                binding: "AI_IMAGE_DERIVATIVES_QUEUE",
                queue: "bitbi-ai-image-derivatives",
              },
            ],
            consumers: [
              {
                queue: "bitbi-ai-image-derivatives",
                max_batch_size: 5,
                max_batch_timeout: 5,
                max_retries: 8,
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
          d1_databases: [{ binding: "DB", database_name: "bitbi-auth-db" }],
        },
      },
    },
    pathExists(relativePath) {
      return existingPaths.has(relativePath);
    },
    authApiSource: `
      export function apiAdminAiModels() { return request('GET', '/admin/ai/models'); }
      export function apiAdminAiTestText() { return request('POST', '/admin/ai/test-text'); }
      export function apiAdminAiTestImage() { return request('POST', '/admin/ai/test-image'); }
      export function apiAdminAiTestEmbeddings() { return request('POST', '/admin/ai/test-embeddings'); }
      export function apiAdminAiCompare() { return request('POST', '/admin/ai/compare'); }
      export function apiAdminAiLiveAgent() { return request('POST', '/admin/ai/live-agent'); }
      export function apiAdminAiSaveTextAsset() { return request('POST', '/admin/ai/save-text-asset'); }
    `,
    authAdminAiSource: `
      if (pathname === "/api/admin/ai/models") return proxyToAiLab("/internal/ai/models");
      if (pathname === "/api/admin/ai/test-text") return proxyToAiLab("/internal/ai/test-text");
      if (pathname === "/api/admin/ai/compare") return proxyToAiLab("/internal/ai/compare");
      if (pathname === "/api/admin/ai/live-agent") return proxyLiveAgentToAiLab();
    `,
    authAdminAiProxySource: `
      export async function proxyLiveAgentToAiLab() {
        return fetch("/internal/ai/live-agent");
      }
    `,
    aiIndexSource: `
      if (pathname === "/internal/ai/models") return handleModels();
      if (pathname === "/internal/ai/test-text") return handleText();
      if (pathname === "/internal/ai/compare") return handleCompare();
      if (pathname === "/internal/ai/live-agent") return handleLiveAgent();
    `,
    workflowSource: `
  release-compatibility:
    steps:
      - run: npm run test:release-compat
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
  context.workerConfigs.auth.wrangler.r2_buckets = [
    { binding: "PRIVATE_MEDIA", bucket_name: "bitbi-private-media" },
  ];
  const issues = validateReleaseCompatibility(context);
  assert(issues.some((issue) => issue.includes('missing R2 binding "USER_IMAGES"')));
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

console.log("Release compatibility tests passed.");
