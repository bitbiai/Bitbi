import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AI_COST_INVENTORY_DOC,
  ROUTE_POLICY_PATH,
  analyzeAiCostPolicy,
  parseAiCostPolicyArgs,
  renderAiCostPolicyReport,
} from "./check-ai-cost-policy.mjs";

function makeRepo({ inventoryExtra = "", routePolicyExtra = "" } = {}) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bitbi-ai-cost-policy-"));
  fs.mkdirSync(path.join(repoRoot, path.dirname(ROUTE_POLICY_PATH)), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, path.dirname(AI_COST_INVENTORY_DOC)), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "workers/auth/src/routes/ai"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "workers/auth/src/routes"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "workers/auth/src/lib"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "workers/ai/src/routes"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "workers/ai/src/lib"), { recursive: true });

  fs.writeFileSync(path.join(repoRoot, ROUTE_POLICY_PATH), `
export const ROUTE_POLICIES = Object.freeze([
  userJsonWrite("ai.generate-image", "POST", "/api/ai/generate-image", "ai-studio", "aiGenerateImageJson", "ai-generate-user", {
    billing: { idempotency: "required for member personal and organization-scoped provider-cost image generation; member personal provider execution is guarded by member_ai_usage_attempts and organization provider execution is guarded by ai_usage_attempts" },
  }),
  userJsonWrite("ai.generate-text", "POST", "/api/ai/generate-text", "ai-studio", "aiGenerateJson", "ai-generate-text-user", {
    billing: { idempotency: "required; provider execution and text replay are guarded by ai_usage_attempts" },
  }),
  userJsonWrite("ai.generate-music", "POST", "/api/ai/generate-music", "ai-studio", "aiGenerateJson", "ai-generate-music-user", {
    billing: { idempotency: "required; member music generation is guarded by one bundled member_ai_usage_attempts parent reservation covering lyrics/audio/cover provider-cost work" },
  }),
  userJsonWrite("ai.generate-video", "POST", "/api/ai/generate-video", "ai-studio", "aiGenerateVideoJson", "ai-generate-video-user", {
    billing: { idempotency: "required; member video generation is guarded by one bundled member_ai_usage_attempts parent reservation before provider-cost work" },
  }),
  adminJsonWrite("admin.ai.test-image", "POST", "/api/admin/ai/test-image", "admin-ai", "adminJson", "admin-ai-image-ip", {
    notes: "Charged admin image tests require organization_id, Idempotency-Key, server-side credit calculation, sufficient organization credits, and no charge on provider failure.",
  }),
  adminJsonWrite("admin.ai.test-text", "POST", "/api/admin/ai/test-text", "admin-ai", "adminJson", "admin-ai-text-ip", {}),
  adminJsonWrite("admin.ai.test-embeddings", "POST", "/api/admin/ai/test-embeddings", "admin-ai", "adminJson", "admin-ai-embeddings-ip", {}),
  adminJsonWrite("admin.ai.test-music", "POST", "/api/admin/ai/test-music", "admin-ai", "adminJson", "admin-ai-music-ip", {}),
  adminJsonWrite("admin.ai.test-video-debug", "POST", "/api/admin/ai/test-video", "admin-ai", "adminJson", "admin-ai-video-ip", {}),
  adminJsonWrite("admin.ai.video-jobs.create", "POST", "/api/admin/ai/video-jobs", "admin-ai", "adminVideoJobJson", "admin-ai-video-job-create-ip", {
    notes: "Idempotency-Key header is required by the handler.",
  }),
  adminJsonWrite("admin.ai.compare", "POST", "/api/admin/ai/compare", "admin-ai", "adminJson", "admin-ai-compare-ip", {}),
  adminJsonWrite("admin.ai.live-agent", "POST", "/api/admin/ai/live-agent", "admin-ai", "adminJson", "admin-ai-liveagent-ip", {}),
  policy({ id: "openclaw.news_pulse.ingest", method: "POST", path: "/api/openclaw/news-pulse/ingest", notes: "OpenClaw HMAC ingest." }),
  ${routePolicyExtra}
]);
`);

  fs.writeFileSync(path.join(repoRoot, AI_COST_INVENTORY_DOC), `
# Inventory

/api/ai/generate-image
/api/ai/generate-text
/api/ai/generate-music
/api/ai/generate-video
/api/admin/ai/test-image
/api/admin/ai/test-text
/api/admin/ai/test-embeddings
/api/admin/ai/test-music
/api/admin/ai/test-video
/api/admin/ai/video-jobs
/api/admin/ai/compare
/api/admin/ai/live-agent
/api/openclaw/news-pulse/ingest
workers/auth/src/routes/ai/images-write.js
workers/ai/src/routes/text.js
${inventoryExtra}
`);

  fs.writeFileSync(
    path.join(repoRoot, "workers/auth/src/routes/ai/images-write.js"),
    "export async function f(env) { return env.AI.run('model', {}); }\n"
  );
  fs.writeFileSync(
    path.join(repoRoot, "workers/ai/src/routes/text.js"),
    "export async function f(env) { return env.AI.run('model', {}); }\n"
  );
  return repoRoot;
}

{
  const repoRoot = makeRepo();
  const result = analyzeAiCostPolicy(repoRoot);
  assert.equal(result.ok, true, JSON.stringify(result.fatalIssues));
  assert.equal(result.registrySummary.totalOperations, 31);
  assert.equal(result.registrySummary.memberOperations, 7);
  assert.equal(result.registrySummary.currentMissingMandatoryIdempotency, 0);
  assert(!result.registrySummary.highRiskOperations.includes("member.image.generate"));
  assert(!result.registrySummary.highRiskOperations.includes("member.music.audio.generate"));
  assert(!result.registrySummary.highRiskOperations.includes("member.video.generate"));
  assert(!result.policyGaps.some((gap) => gap.route === "ai.generate-music"));
  assert(!result.policyGaps.some((gap) => gap.route === "ai.generate-video"));
  assert(!result.policyGaps.some((gap) => gap.route === "ai.generate-image"));
  assert(result.policyGaps.some((gap) => gap.route === "admin.ai.test-embeddings"));
  assert(!result.policyGaps.some((gap) => gap.route === "ai.generate-text"));
}

{
  const repoRoot = makeRepo();
  const strict = analyzeAiCostPolicy(repoRoot, { strict: true });
  assert.equal(strict.ok, false);
  assert(strict.policyGaps.length > 0);
}

{
  const repoRoot = makeRepo();
  const secretValue = "super-secret-ai-provider-token";
  process.env.AI_PROVIDER_SECRET = secretValue;
  const output = renderAiCostPolicyReport(analyzeAiCostPolicy(repoRoot));
  assert(!output.includes(secretValue));
  assert(output.includes("Registry summary:"));
  assert(output.includes("Member music gateway prep gaps:"));
  assert(output.includes("member.music.audio.generate"));
  assert(output.includes("member music parent gateway migration is represented in the registry"));
  assert(output.includes("member image, music, and video are the migrated member AI Cost Gateway routes"));
  assert(output.includes("Missing pre-provider reservation"));
  assert(output.includes("Cover/background provider-cost policy"));
  assert(output.includes("Recommended next phase:"));
  assert(output.includes("Phase 3.9 should add an admin/platform AI cost telemetry"));
  assert(output.includes("does not read secret values"));
  delete process.env.AI_PROVIDER_SECRET;
}

{
  const repoRoot = makeRepo();
  const result = analyzeAiCostPolicy(repoRoot);
  const sourceFiles = result.providerSourceFindings.map((finding) => finding.file);
  assert(sourceFiles.includes("workers/auth/src/routes/ai/images-write.js"));
  assert(sourceFiles.includes("workers/ai/src/routes/text.js"));
}

{
  const repoRoot = makeRepo();
  fs.mkdirSync(path.join(repoRoot, "workers/auth/src/lib"), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, "workers/auth/src/lib/new-provider-cost-route.js"),
    "export async function f(env) { return env.AI.run('model', {}); }\n"
  );
  const result = analyzeAiCostPolicy(repoRoot);
  assert(result.inventoryIssues.some((issue) => issue.includes("new-provider-cost-route.js")));
  assert.equal(result.ok, true);
  assert.equal(analyzeAiCostPolicy(repoRoot, { strict: true }).ok, false);
}

{
  assert.deepEqual(parseAiCostPolicyArgs([]), { strict: false, help: false });
  assert.deepEqual(parseAiCostPolicyArgs(["--strict"]), { strict: true, help: false });
  assert.deepEqual(parseAiCostPolicyArgs(["--help"]), { strict: false, help: true });
  assert.throws(() => parseAiCostPolicyArgs(["--deploy"]), /Unknown argument/);
}

console.log("AI cost policy tests passed.");
