import assert from "node:assert/strict";
import {
  extractLatestMigrationFilename,
  validateReleaseCompatibility,
} from "./lib/release-compat.mjs";

const baseManifest = {
  authWorker: {
    currentSchemaMigration: "0017_add_ai_image_derivatives.sql",
    requiredBindings: {
      d1: ["DB"],
      images: "IMAGES",
      r2: ["PRIVATE_MEDIA", "USER_IMAGES"],
      services: {
        AI_LAB: "bitbi-ai",
      },
    },
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
    },
  },
};

function createValidContext() {
  return {
    manifest: structuredClone(baseManifest),
    migrationFiles: [
      "0016_add_ai_text_assets.sql",
      "0017_add_ai_image_derivatives.sql",
    ],
    authWrangler: {
      d1_databases: [{ binding: "DB" }],
      images: { binding: "IMAGES" },
      r2_buckets: [{ binding: "PRIVATE_MEDIA" }, { binding: "USER_IMAGES" }],
      services: [{ binding: "AI_LAB", service: "bitbi-ai" }],
    },
    aiWrangler: { name: "bitbi-ai" },
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
    `,
    authAdminAiProxySource: `
      export async function proxyLiveAgentToAiLab() {
        return fetch("/internal/ai/live-agent");
      }
    `,
    aiIndexSource: `
      if (pathname === "/internal/ai/models") return handleModels();
      if (pathname === "/internal/ai/test-text") return handleText();
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
  const context = createValidContext();
  context.manifest.adminAi.authToAiRoutes["/api/admin/ai/live-agent"] = "/internal/ai/live-agent";
  context.authAdminAiSource += `
      if (pathname === "/api/admin/ai/live-agent") return proxyLiveAgentToAiLab();
  `;
  const issues = validateReleaseCompatibility(context);
  assert.deepEqual(issues, []);
}

{
  const context = createValidContext();
  context.manifest.authWorker.currentSchemaMigration = "0016_add_ai_text_assets.sql";
  const issues = validateReleaseCompatibility(context);
  assert(issues.some((issue) => issue.includes("latest auth migration")));
}

{
  const context = createValidContext();
  context.authWrangler.services = [{ binding: "AI_LAB", service: "wrong-ai-service" }];
  const issues = validateReleaseCompatibility(context);
  assert(issues.some((issue) => issue.includes('targets "wrong-ai-service"')));
}

{
  const context = createValidContext();
  context.authApiSource = context.authApiSource.replace(
    "export function apiAdminAiCompare() { return request('POST', '/admin/ai/compare'); }",
    ""
  );
  const issues = validateReleaseCompatibility(context);
  assert(issues.some((issue) => issue.includes('Static auth API wrapper is missing route "/admin/ai/compare"')));
}

console.log("Release compatibility tests passed.");
