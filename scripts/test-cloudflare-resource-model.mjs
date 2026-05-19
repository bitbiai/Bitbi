import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCloudflareResourceModel,
  renderCloudflareResourceModelMarkdown,
} from "./lib/cloudflare-resource-model.mjs";
import { loadReleaseCompatibilityContext } from "./lib/release-compat.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function createContext() {
  return loadReleaseCompatibilityContext(repoRoot);
}

function cloneContext() {
  return JSON.parse(JSON.stringify(createContext()));
}

function getResource(model, id) {
  return model.resources.find((resource) => resource.id === id) || null;
}

{
  const model = buildCloudflareResourceModel({
    repoRoot,
    context: createContext(),
    generatedAt: "2026-05-19T12:00:00.000Z",
  });
  assert.equal(model.ok, true);
  assert.equal(model.cloudflareApiCallsMade, false);
  assert.equal(model.liveCloudflareEvidenceAttached, false);
  assert.equal(model.productionReadiness, "blocked");
  assert.equal(getResource(model, "worker:auth")?.status, "repo_validated");
  assert.equal(getResource(model, "binding:auth:d1:DB")?.status, "repo_validated");
  assert.equal(getResource(model, "binding:auth:r2:AUDIT_ARCHIVE")?.status, "repo_validated");
  assert.equal(getResource(model, "binding:auth:queue-producer:AI_VIDEO_JOBS_QUEUE")?.status, "repo_validated");
  assert.equal(getResource(model, "binding:auth:service:AI_LAB")?.status, "repo_validated");
  assert.equal(getResource(model, "secret:auth:STRIPE_LIVE_SECRET_KEY")?.status, "optional_fail_closed");
  assert.equal(getResource(model, "secret:auth:SESSION_HASH_SECRET")?.status, "live_verification_required");
  assert.equal(getResource(model, "dashboard:auth-enable-live-stripe-credit-packs-var")?.status, "dashboard_managed_pending");
  assert(getResource(model, "dashboard:auth-enable-live-stripe-credit-packs-var")?.classifications.includes("dashboard-managed"));
  const markdown = renderCloudflareResourceModelMarkdown(model);
  assert(markdown.includes("Cloudflare Resource Verification Model"));
  assert(markdown.includes("Production readiness: **blocked**"));
  assert(!markdown.includes("secret-test-value"));
}

{
  const context = cloneContext();
  context.workerConfigs.auth.wrangler.d1_databases = [];
  const model = buildCloudflareResourceModel({ repoRoot, context });
  assert.equal(model.ok, false);
  assert.equal(getResource(model, "binding:auth:d1:DB")?.status, "missing");
  assert(model.issues.some((issue) => issue.id === "binding:auth:d1:DB"));
}

{
  const context = cloneContext();
  context.workerConfigs.auth.wrangler.routes = [{ pattern: "bitbi.ai/not-api/*", zone_name: "bitbi.ai" }];
  const model = buildCloudflareResourceModel({ repoRoot, context });
  assert.equal(model.ok, false);
  assert.equal(getResource(model, "route:auth:bitbi.ai/api/*")?.status, "drift");
}

{
  const context = cloneContext();
  context.workerConfigs.auth.wrangler.queues.producers = context.workerConfigs.auth.wrangler.queues.producers.filter(
    (entry) => entry.binding !== "AI_VIDEO_JOBS_QUEUE"
  );
  const model = buildCloudflareResourceModel({ repoRoot, context });
  assert.equal(model.ok, false);
  assert.equal(getResource(model, "binding:auth:queue-producer:AI_VIDEO_JOBS_QUEUE")?.status, "missing");
}

{
  const context = cloneContext();
  context.workerConfigs.auth.wrangler.services[0].service = "bitbi-ai-wrong";
  const model = buildCloudflareResourceModel({ repoRoot, context });
  assert.equal(model.ok, false);
  assert.equal(getResource(model, "binding:auth:service:AI_LAB")?.status, "drift");
}

{
  const context = cloneContext();
  context.manifest.release.manualPrerequisites = context.manifest.release.manualPrerequisites.filter(
    (entry) => entry.id !== "auth-stripe-live-secret-key"
  );
  const model = buildCloudflareResourceModel({ repoRoot, context });
  assert.equal(model.ok, true);
  assert.equal(getResource(model, "secret:auth:STRIPE_LIVE_SECRET_KEY"), null);
  assert(getResource(model, "secret:auth:SESSION_HASH_SECRET")?.classifications.includes("live-verification-required"));
}

console.log("Cloudflare resource model tests passed.");
