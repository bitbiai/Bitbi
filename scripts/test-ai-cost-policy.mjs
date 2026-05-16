import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AI_COST_INVENTORY_DOC,
  AI_COST_POLICY_BASELINE_PATH,
  ROUTE_POLICY_PATH,
  analyzeAiCostPolicy,
  parseAiCostPolicyArgs,
  renderAiCostPolicyReport,
} from "./check-ai-cost-policy.mjs";
import { AI_COST_OPERATION_REGISTRY } from "../workers/auth/src/lib/ai-cost-operations.js";
import { AI_COST_BUDGET_SCOPES } from "../workers/auth/src/lib/ai-cost-operations.js";

const DEFAULT_BASELINE_GAPS = Object.freeze([
  {
    id: "admin-ai-baseline",
    route: "/api/admin/ai/test-text",
    routePolicyIds: [
      "admin.ai.test-text",
      "admin.ai.test-image",
      "admin.ai.test-embeddings",
      "admin.ai.test-music",
      "admin.ai.test-video-debug",
      "admin.ai.video-jobs.create",
      "admin.ai.compare",
      "admin.ai.live-agent",
    ],
    functions: ["proxyToAiLab", "proxyLiveAgentToAiLab"],
    category: "admin",
    reason: "Known admin provider-cost routes remain unmetered or partially covered pending platform budget policy.",
    temporaryAllowanceReason: "Admin-only routes remain accepted only while Phase 4.2 defines platform admin lab budget contract/helpers.",
    targetBudgetScope: AI_COST_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET,
    targetFuturePhase: "Phase 4.2 admin AI budget policy contract/helpers",
    severity: "P2",
    ownerDomain: "admin-ai",
    killSwitchTarget: "ENABLE_ADMIN_AI_BUDGETED_TESTS",
    futureEnforcementPath: "Phase 4.2 helper contract, then one narrow admin route migration.",
    providerCostBearing: true,
    registryOperationIds: [
      "admin.text.test",
      "admin.image.test.unmetered",
      "admin.embeddings.test",
      "admin.music.test",
      "admin.video.sync_debug",
      "admin.video.job.create",
      "admin.compare",
      "admin.live_agent",
    ],
    coveredByRegistryMetadata: true,
    allowedUnmigratedForNow: true,
    external_or_internal_only: true,
  },
  {
    id: "openclaw-baseline",
    route: "/api/openclaw/news-pulse/ingest",
    routePolicyIds: ["openclaw.news_pulse.ingest"],
    functions: ["generateNewsPulseVisual"],
    category: "background",
    reason: "Known platform visual generation remains outside member/org billing pending platform budget policy.",
    temporaryAllowanceReason: "OpenClaw visuals remain accepted only while Phase 4.5 defines visual budget controls.",
    targetBudgetScope: AI_COST_BUDGET_SCOPES.OPENCLAW_NEWS_PULSE_BUDGET,
    targetFuturePhase: "Phase 4.6 OpenClaw/News Pulse visual budget controls",
    severity: "P2",
    ownerDomain: "openclaw-news-pulse",
    killSwitchTarget: "ENABLE_OPENCLAW_NEWS_PULSE_AI_BUDGET",
    futureEnforcementPath: "Phase 4.6 OpenClaw/News Pulse visual budget controls.",
    providerCostBearing: true,
    registryOperationIds: ["platform.news_pulse.visual.ingest", "platform.news_pulse.visual.scheduled"],
    coveredByRegistryMetadata: true,
    allowedUnmigratedForNow: true,
    external_or_internal_only: true,
  },
  {
    id: "internal-ai-worker-baseline",
    route: "/internal/ai/*",
    functions: ["invokeAi", "invokeAiVideo", "createVideoProviderTask", "pollVideoProviderTask"],
    category: "internal",
    reason: "Known internal service routes rely on caller-side gateway or admin policy controls.",
    temporaryAllowanceReason: "Internal service routes remain accepted only while Phase 4.6 defines caller-policy guards.",
    targetBudgetScope: AI_COST_BUDGET_SCOPES.INTERNAL_AI_WORKER_CALLER_ENFORCED,
    targetFuturePhase: "Phase 4.7 internal AI Worker route caller-policy guard",
    severity: "P2",
    ownerDomain: "ai-worker",
    killSwitchTarget: "caller route budget kill switch required",
    futureEnforcementPath: "Phase 4.7 internal AI Worker caller-policy guard.",
    providerCostBearing: true,
    registryOperationIds: [
      "internal.text.generate",
      "internal.image.generate",
      "internal.embeddings.generate",
      "internal.music.generate",
      "internal.video.generate",
      "internal.video_task.create",
      "internal.video_task.poll",
      "internal.compare",
      "internal.live_agent",
    ],
    coveredByRegistryMetadata: true,
    allowedUnmigratedForNow: true,
    external_or_internal_only: true,
  },
]);

function writeBaseline(repoRoot, knownGaps = DEFAULT_BASELINE_GAPS) {
  fs.mkdirSync(path.join(repoRoot, path.dirname(AI_COST_POLICY_BASELINE_PATH)), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, AI_COST_POLICY_BASELINE_PATH), JSON.stringify({
    version: "test-ai-cost-policy-baseline",
    knownGaps,
  }, null, 2));
}

function makeRepo({ inventoryExtra = "", routePolicyExtra = "" } = {}) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bitbi-ai-cost-policy-"));
  writeBaseline(repoRoot);
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
  assert(result.knownPolicyGaps.some((gap) => gap.route === "admin.ai.test-embeddings"));
  assert.equal(result.unknownPolicyGaps.length, 0);
  assert(!result.policyGaps.some((gap) => gap.route === "ai.generate-text"));
}

{
  const repoRoot = makeRepo();
  const strict = analyzeAiCostPolicy(repoRoot, { strict: true });
  assert.equal(strict.ok, false);
  assert(strict.policyGaps.length > 0);
  assert(strict.strictIssues.some((issue) => issue.includes("Strict mode rejects allowed baseline gap")));
}

{
  const repoRoot = makeRepo();
  const secretValue = "super-secret-ai-provider-token";
  process.env.AI_PROVIDER_SECRET = secretValue;
  const output = renderAiCostPolicyReport(analyzeAiCostPolicy(repoRoot));
  assert(!output.includes(secretValue));
  assert(output.includes("Registry summary:"));
  assert(output.includes("Mode: baseline-enforced"));
  assert(output.includes("Migrated member gateway routes:"));
  assert(output.includes("Hardened admin/platform budget operations:"));
  assert(output.includes("Read-only admin/platform budget evidence:"));
  assert(output.includes("npm run report:ai-budget-evidence"));
  assert(output.includes("admin.image.test.charged: implemented/hardened; scope=admin_org_credit_account"));
  assert(output.includes("admin.video.job.create: implemented/hardened; scope=platform_admin_lab_budget"));
  assert(output.includes("Known baseline gaps:"));
  assert(output.includes("killSwitch="));
  assert(output.includes("Admin gaps by budget scope:"));
  assert(output.includes("Platform/background gaps by budget scope:"));
  assert(output.includes("Internal AI Worker caller-enforced gaps:"));
  assert(output.includes("Known baseline policy gaps:"));
  assert(output.includes("Member music gateway prep gaps:"));
  assert(output.includes("member.music.audio.generate"));
  assert(output.includes("member music parent gateway migration is represented in the registry"));
  assert(output.includes("member image, music, and video are the migrated member AI Cost Gateway routes"));
  assert(output.includes("Missing pre-provider reservation"));
  assert(output.includes("Cover/background provider-cost policy"));
  assert(output.includes("Recommended next phase:"));
  assert(output.includes("Phase 4.5 covers only admin async video job budget metadata/enforcement"));
  assert(output.includes("Phase 4.6 should migrate OpenClaw/News Pulse visual budget controls"));
  assert(output.includes("Strict mode intentionally remains failing"));
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
  assert.equal(result.ok, false);
  assert.equal(analyzeAiCostPolicy(repoRoot, { strict: true }).ok, false);
}

{
  const repoRoot = makeRepo();
  writeBaseline(repoRoot, [
    DEFAULT_BASELINE_GAPS[0],
    {
      ...DEFAULT_BASELINE_GAPS[0],
      reason: "Duplicate fixture.",
    },
  ]);
  const result = analyzeAiCostPolicy(repoRoot);
  assert.equal(result.ok, false);
  assert(result.baselineIssues.some((issue) => issue.includes("Duplicate AI cost policy baseline id")));
}

{
  const repoRoot = makeRepo();
  writeBaseline(repoRoot, [{
    ...DEFAULT_BASELINE_GAPS[0],
    id: "missing-budget-scope",
    targetBudgetScope: undefined,
  }]);
  const result = analyzeAiCostPolicy(repoRoot);
  assert.equal(result.ok, false);
  assert(result.baselineIssues.some((issue) => issue.includes("invalid targetBudgetScope")));
}

{
  const repoRoot = makeRepo();
  writeBaseline(repoRoot, [{
    ...DEFAULT_BASELINE_GAPS[0],
    id: "missing-temporary-reason",
    temporaryAllowanceReason: undefined,
  }]);
  const result = analyzeAiCostPolicy(repoRoot);
  assert.equal(result.ok, false);
  assert(result.baselineIssues.some((issue) => issue.includes("missing temporaryAllowanceReason")));
}

{
  const repoRoot = makeRepo();
  writeBaseline(repoRoot, [{
    ...DEFAULT_BASELINE_GAPS[0],
    id: "missing-kill-switch-target",
    killSwitchTarget: undefined,
    killSwitchExemptionReason: undefined,
  }]);
  const result = analyzeAiCostPolicy(repoRoot);
  assert.equal(result.ok, false);
  assert(result.baselineIssues.some((issue) => issue.includes("missing killSwitchTarget")));
}

{
  const repoRoot = makeRepo();
  writeBaseline(repoRoot, [{
    ...DEFAULT_BASELINE_GAPS[0],
    id: "missing-future-enforcement-path",
    futureEnforcementPath: undefined,
  }]);
  const result = analyzeAiCostPolicy(repoRoot);
  assert.equal(result.ok, false);
  assert(result.baselineIssues.some((issue) => issue.includes("missing futureEnforcementPath")));
}

{
  const repoRoot = makeRepo();
  writeBaseline(repoRoot, [{
    ...DEFAULT_BASELINE_GAPS[0],
    id: "bad-file-reference",
    files: ["workers/auth/src/routes/missing-provider-cost-route.js"],
    external_or_internal_only: false,
  }]);
  const result = analyzeAiCostPolicy(repoRoot);
  assert.equal(result.ok, false);
  assert(result.baselineIssues.some((issue) => issue.includes("referenced file does not exist")));
}

{
  const repoRoot = makeRepo();
  const duplicatedRegistry = [
    ...AI_COST_OPERATION_REGISTRY,
    AI_COST_OPERATION_REGISTRY[0],
  ];
  const result = analyzeAiCostPolicy(repoRoot, { registryEntries: duplicatedRegistry });
  assert.equal(result.ok, false);
  assert(result.registryIssues.some((issue) => issue.includes("Duplicate AI cost operation id")));
}

{
  const repoRoot = makeRepo();
  const regressedRegistry = AI_COST_OPERATION_REGISTRY.map((entry) =>
    entry.operationConfig?.operationId === "member.video.generate"
      ? {
        ...entry,
        currentStatus: "missing",
        currentEnforcement: {
          ...entry.currentEnforcement,
          reservation: "missing",
        },
      }
      : entry
  );
  const result = analyzeAiCostPolicy(repoRoot, { registryEntries: regressedRegistry });
  assert.equal(result.ok, false);
  assert(result.fatalIssues.some((issue) => issue.includes("member.video.generate")));
}

{
  assert.deepEqual(parseAiCostPolicyArgs([]), { strict: false, help: false });
  assert.deepEqual(parseAiCostPolicyArgs(["--strict"]), { strict: true, help: false });
  assert.deepEqual(parseAiCostPolicyArgs(["--help"]), { strict: false, help: true });
  assert.throws(() => parseAiCostPolicyArgs(["--deploy"]), /Unknown argument/);
}

console.log("AI cost policy tests passed.");
