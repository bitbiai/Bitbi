import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadCloudflareDeployPrereqContext,
  validateCloudflareDeployPrereqs,
} from "./lib/cloudflare-deploy-prereqs.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function createContext() {
  return loadCloudflareDeployPrereqContext(repoRoot);
}

function getCheck(result, id) {
  return result.checks.find((check) => check.id === id) || null;
}

const authSecretNames = [
  "SESSION_SECRET",
  "SESSION_HASH_SECRET",
  "PAGINATION_SIGNING_SECRET",
  "ADMIN_MFA_ENCRYPTION_KEY",
  "ADMIN_MFA_PROOF_SECRET",
  "ADMIN_MFA_RECOVERY_HASH_SECRET",
  "AI_SAVE_REFERENCE_SIGNING_SECRET",
  "AI_SERVICE_AUTH_SECRET",
  "RESEND_API_KEY",
];

{
  const result = validateCloudflareDeployPrereqs(createContext());
  assert.equal(result.ok, true);
  assert.equal(result.repoConfigReady, true);
  assert.equal(result.productionDeployReady, false);
  assert.equal(result.liveValidation, "skipped");
  assert.equal(getCheck(result, "ai-service-auth-replay:wrangler-binding")?.status, "pass");
  assert(result.productionBlockers.some((entry) => entry.includes("Live Cloudflare")));
}

{
  const context = createContext();
  context.workerConfigs.ai.wrangler.durable_objects.bindings = [];
  const result = validateCloudflareDeployPrereqs(context);
  assert.equal(result.ok, false);
  assert.equal(getCheck(result, "ai-service-auth-replay:wrangler-binding")?.status, "fail");
  assert(result.issues.some((issue) => issue.id === "ai-service-auth-replay:wrangler-binding"));
}

{
  const context = createContext();
  delete context.manifest.release.workers.auth.bindings.queues.producers.AI_VIDEO_JOBS_QUEUE;
  const result = validateCloudflareDeployPrereqs(context);
  assert.equal(result.ok, false);
  assert.equal(getCheck(result, "auth-binding:AI_VIDEO_JOBS_QUEUE:manifest")?.status, "fail");
}

{
  const context = createContext();
  context.workerConfigs.ai.wrangler.migrations = [];
  const result = validateCloudflareDeployPrereqs(context);
  assert.equal(result.ok, false);
  assert.equal(getCheck(result, "ai-service-auth-replay:wrangler-migration")?.status, "fail");
}

{
  const context = createContext();
  context.manifest.release.manualPrerequisites = context.manifest.release.manualPrerequisites.filter(
    (entry) => entry.id !== "ai-service-auth-secret"
  );
  const result = validateCloudflareDeployPrereqs(context);
  assert.equal(result.ok, false);
  assert.equal(getCheck(result, "manual-prerequisite:ai-service-auth-secret")?.status, "fail");
}

{
  const context = createContext();
  context.manifest.release.manualPrerequisites = context.manifest.release.manualPrerequisites.filter(
    (entry) => entry.id !== "auth-session-hash-secret"
  );
  const result = validateCloudflareDeployPrereqs(context);
  assert.equal(result.ok, false);
  assert.equal(getCheck(result, "manual-prerequisite:auth-session-hash-secret")?.status, "fail");
}

{
  const result = validateCloudflareDeployPrereqs(createContext(), { requireLive: true });
  assert.equal(result.ok, false);
  assert.equal(result.liveValidation, "failed");
  assert.equal(getCheck(result, "live-cloudflare-validation")?.status, "fail");
}

{
  const calls = [];
  const runner = (cmd, args) => {
    calls.push([cmd, ...args].join(" "));
    return {
      status: 0,
      stdout: JSON.stringify(authSecretNames.map((name) => ({ name }))),
      stderr: "",
    };
  };
  const result = validateCloudflareDeployPrereqs(createContext(), { live: true, runner });
  assert.equal(result.ok, true);
  assert.equal(result.productionDeployReady, false);
  assert.equal(result.liveValidation, "passed");
  assert.equal(getCheck(result, "live-secret:auth:AI_SERVICE_AUTH_SECRET")?.status, "pass");
  assert.equal(getCheck(result, "live-secret:ai:AI_SERVICE_AUTH_SECRET")?.status, "pass");
  assert.equal(getCheck(result, "live-secret:contact:RESEND_API_KEY")?.status, "pass");
  assert(result.productionBlockers.some((entry) => entry.includes("Durable Object migration/resource deployment")));
  assert(calls.some((call) => call.includes("workers/auth/wrangler.jsonc")));
  assert(calls.some((call) => call.includes("workers/ai/wrangler.jsonc")));
  assert(calls.some((call) => call.includes("workers/contact/wrangler.jsonc")));
}

{
  const runner = (cmd, args) => {
    const configIndex = args.indexOf("--config");
    const configPath = configIndex >= 0 ? args[configIndex + 1] : "";
    const names = configPath.includes("workers/ai/")
      ? []
      : authSecretNames.map((name) => ({ name }));
    return {
      status: 0,
      stdout: JSON.stringify(names),
      stderr: "",
    };
  };
  const result = validateCloudflareDeployPrereqs(createContext(), { live: true, runner });
  assert.equal(result.ok, false);
  assert.equal(result.liveValidation, "failed");
  assert.equal(getCheck(result, "live-secret:ai:AI_SERVICE_AUTH_SECRET")?.status, "fail");
}

{
  const runner = () => ({
    status: 0,
    stdout: JSON.stringify(authSecretNames.map((name) => ({ name }))),
    stderr: "",
  });
  const result = validateCloudflareDeployPrereqs(createContext(), {
    live: true,
    requireProductionReady: true,
    runner,
  });
  assert.equal(result.ok, false);
  assert.equal(result.liveValidation, "passed");
  assert.equal(result.productionDeployReady, false);
  assert.equal(getCheck(result, "production-deploy-ready")?.status, "fail");
}

console.log("Cloudflare deploy prerequisite tests passed.");
