import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ROUTE_POLICIES,
  getRoutePolicy,
  validateRoutePolicies,
} from "../workers/auth/src/app/route-policy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const ROUTE_POLICY_MARKER = /route-policy:\s*([a-z0-9_.-]+)/i;
const METHOD_COMPARISON = /\bmethod\s*===\s*["'](POST|PUT|PATCH|DELETE)["']/;

const MUTATING_DISPATCH_FILES = [
  "workers/auth/src/index.js",
  "workers/auth/src/routes/admin.js",
  "workers/auth/src/routes/admin-billing.js",
  "workers/auth/src/routes/admin-storage.js",
  "workers/auth/src/routes/admin-tenant-assets.js",
  "workers/auth/src/routes/admin-data-lifecycle.js",
  "workers/auth/src/routes/admin-ai.js",
  "workers/auth/src/routes/admin-mfa.js",
  "workers/auth/src/routes/ai.js",
  "workers/auth/src/routes/favorites.js",
  "workers/auth/src/routes/orgs.js",
];

const REQUIRED_LOOKUPS = [
  ["POST", "/api/admin/ai/video-jobs", "admin.ai.video-jobs.create"],
  ["GET", "/api/admin/ai/video-jobs/poison", "admin.ai.video-jobs.poison.list"],
  ["GET", "/api/admin/ai/video-jobs/poison/poison-123", "admin.ai.video-jobs.poison.read"],
  ["GET", "/api/admin/ai/video-jobs/failed", "admin.ai.video-jobs.failed.list"],
  ["GET", "/api/admin/ai/video-jobs/failed/job-123", "admin.ai.video-jobs.failed.read"],
  ["GET", "/api/admin/ai/usage-attempts", "admin.ai.usage-attempts.list"],
  ["POST", "/api/admin/ai/usage-attempts/cleanup-expired", "admin.ai.usage-attempts.cleanup-expired"],
  ["GET", "/api/admin/ai/usage-attempts/aua_123", "admin.ai.usage-attempts.read"],
  ["GET", "/api/admin/ai/video-jobs/job-123", "admin.ai.video-jobs.status"],
  ["GET", "/api/admin/ai/video-jobs/job-123/output", "admin.ai.video-jobs.output"],
  ["POST", "/api/admin/ai/test-video", "admin.ai.test-video-debug"],
  ["GET", "/api/admin/data-lifecycle/requests", "admin.data-lifecycle.requests.list"],
  ["POST", "/api/admin/data-lifecycle/requests", "admin.data-lifecycle.requests.create"],
  ["GET", "/api/admin/data-lifecycle/requests/dlr_123", "admin.data-lifecycle.requests.read"],
  ["POST", "/api/admin/data-lifecycle/requests/dlr_123/plan", "admin.data-lifecycle.requests.plan"],
  ["POST", "/api/admin/data-lifecycle/requests/dlr_123/approve", "admin.data-lifecycle.requests.approve"],
  ["POST", "/api/admin/data-lifecycle/requests/dlr_123/generate-export", "admin.data-lifecycle.requests.generate-export"],
  ["POST", "/api/admin/data-lifecycle/requests/dlr_123/execute-safe", "admin.data-lifecycle.requests.execute-safe"],
  ["GET", "/api/admin/data-lifecycle/requests/dlr_123/export", "admin.data-lifecycle.requests.export.read"],
  ["GET", "/api/admin/data-lifecycle/exports", "admin.data-lifecycle.exports.list"],
  ["POST", "/api/admin/data-lifecycle/exports/cleanup-expired", "admin.data-lifecycle.exports.cleanup-expired"],
  ["GET", "/api/admin/data-lifecycle/exports/dla_123", "admin.data-lifecycle.exports.read"],
  ["GET", "/api/admin/tenant-assets/folders-images/evidence", "admin.tenant-assets.folders-images.evidence.read"],
  ["GET", "/api/admin/tenant-assets/folders-images/evidence/export", "admin.tenant-assets.folders-images.evidence.export"],
  ["POST", "/api/admin/tenant-assets/folders-images/manual-review/import", "admin.tenant-assets.folders-images.manual-review.import"],
  ["GET", "/api/admin/tenant-assets/folders-images/manual-review/items", "admin.tenant-assets.folders-images.manual-review.items.list"],
  ["GET", "/api/admin/tenant-assets/folders-images/manual-review/items/ta_mri_123", "admin.tenant-assets.folders-images.manual-review.items.read"],
  ["GET", "/api/admin/tenant-assets/folders-images/manual-review/items/ta_mri_123/events", "admin.tenant-assets.folders-images.manual-review.items.events"],
  ["GET", "/api/admin/tenant-assets/folders-images/manual-review/evidence", "admin.tenant-assets.folders-images.manual-review.evidence.read"],
  ["GET", "/api/admin/tenant-assets/folders-images/manual-review/evidence/export", "admin.tenant-assets.folders-images.manual-review.evidence.export"],
  ["GET", "/api/orgs", "orgs.list"],
  ["POST", "/api/orgs", "orgs.create"],
  ["GET", "/api/orgs/org_0123456789abcdef0123456789abcdef", "orgs.read"],
  ["GET", "/api/orgs/org_0123456789abcdef0123456789abcdef/members", "orgs.members.list"],
  ["POST", "/api/orgs/org_0123456789abcdef0123456789abcdef/members", "orgs.members.add"],
  ["GET", "/api/orgs/org_0123456789abcdef0123456789abcdef/entitlements", "orgs.entitlements.read"],
  ["GET", "/api/orgs/org_0123456789abcdef0123456789abcdef/billing", "orgs.billing.read"],
  ["GET", "/api/orgs/org_0123456789abcdef0123456789abcdef/usage", "orgs.usage.read"],
  ["POST", "/api/orgs/org_0123456789abcdef0123456789abcdef/billing/checkout/credit-pack", "orgs.billing.checkout.credit-pack"],
  ["GET", "/api/orgs/org_0123456789abcdef0123456789abcdef/organization-dashboard", "orgs.organization-dashboard.read"],
  ["GET", "/api/admin/orgs", "admin.orgs.list"],
  ["GET", "/api/admin/orgs/org_0123456789abcdef0123456789abcdef", "admin.orgs.read"],
  ["GET", "/api/admin/billing/plans", "admin.billing.plans.list"],
  ["GET", "/api/admin/orgs/org_0123456789abcdef0123456789abcdef/billing", "admin.orgs.billing.read"],
  ["POST", "/api/admin/orgs/org_0123456789abcdef0123456789abcdef/credits/grant", "admin.orgs.credits.grant"],
  ["GET", "/api/admin/billing/events", "admin.billing.events.list"],
  ["GET", "/api/admin/billing/events/bpe_0123456789abcdef0123456789abcdef", "admin.billing.events.read"],
  ["GET", "/api/admin/billing/reconciliation", "admin.billing.reconciliation.read"],
  ["GET", "/api/admin/billing/reviews", "admin.billing.reviews.list"],
  ["GET", "/api/admin/billing/reviews/bpe_0123456789abcdef0123456789abcdef", "admin.billing.reviews.read"],
  ["POST", "/api/admin/billing/reviews/bpe_0123456789abcdef0123456789abcdef/resolution", "admin.billing.reviews.resolve"],
  ["POST", "/api/billing/webhooks/test", "billing.webhooks.test"],
  ["POST", "/api/billing/webhooks/stripe", "billing.webhooks.stripe"],
  ["POST", "/api/ai/generate-text", "ai.generate-text"],
];

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function policyMap() {
  return new Map(ROUTE_POLICIES.map((entry) => [entry.id, entry]));
}

function getMarkerForLine(lines, lineIndex) {
  const start = Math.max(0, lineIndex - 8);
  const window = lines.slice(start, lineIndex + 1).join("\n");
  const matches = [...window.matchAll(new RegExp(ROUTE_POLICY_MARKER, "gi"))];
  return matches.at(-1)?.[1] || null;
}

function scanMutatingDispatchMarkers(issues) {
  const byId = policyMap();
  const seenMutatingMarkers = new Set();

  for (const relativePath of MUTATING_DISPATCH_FILES) {
    const source = readRepoFile(relativePath);
    const lines = source.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      const method = line.match(METHOD_COMPARISON)?.[1];
      if (!method) continue;

      const marker = getMarkerForLine(lines, index);
      const location = `${relativePath}:${index + 1}`;
      if (!marker) {
        issues.push(`${location}: mutating route branch is missing a route-policy marker.`);
        continue;
      }

      const entry = byId.get(marker);
      if (!entry) {
        issues.push(`${location}: route-policy marker "${marker}" is not registered.`);
        continue;
      }
      if (entry.method !== method) {
        issues.push(`${location}: route-policy "${marker}" declares ${entry.method}, but branch checks ${method}.`);
      }
      seenMutatingMarkers.add(marker);
    }
  }

  for (const entry of ROUTE_POLICIES) {
    if (!MUTATING_METHODS.has(entry.method)) continue;
    if (!seenMutatingMarkers.has(entry.id)) {
      issues.push(`${entry.id}: mutating registered policy is not tied to a route-policy marker in the dispatcher files.`);
    }
  }
}

function checkPolicySemantics(issues) {
  for (const entry of ROUTE_POLICIES) {
    if (MUTATING_METHODS.has(entry.method) && entry.csrf !== "same-origin-required" && entry.csrf !== "not-browser-facing") {
      issues.push(`${entry.id}: mutating route must require same-origin CSRF or be explicitly non-browser-facing.`);
    }
    if (entry.body?.kind !== "none" && !entry.body?.maxBytesName) {
      issues.push(`${entry.id}: body-parsing route is missing maxBytesName.`);
    }
    if (entry.path.startsWith("/api/admin/") && (entry.auth !== "admin" || entry.mfa === "none")) {
      issues.push(`${entry.id}: admin route must declare admin auth and MFA policy.`);
    }
    if (entry.path.includes("/internal/") && entry.csrf !== "not-browser-facing") {
      issues.push(`${entry.id}: internal routes must be marked not-browser-facing.`);
    }
    if (entry.sensitivity === "high" && entry.rateLimit?.id && entry.rateLimit.failClosed !== true) {
      issues.push(`${entry.id}: high-sensitivity rate limit must be fail-closed.`);
    }
    if (entry.debugGate && !entry.rateLimit?.id) {
      issues.push(`${entry.id}: debug-gated route must still declare a rate limit.`);
    }
  }
}

function checkLookupExamples(issues) {
  for (const [method, pathname, expectedId] of REQUIRED_LOOKUPS) {
    const entry = getRoutePolicy(method, pathname);
    if (entry?.id !== expectedId) {
      issues.push(`${method} ${pathname}: expected policy ${expectedId}, got ${entry?.id || "none"}.`);
    }
  }
}

const issues = [
  ...validateRoutePolicies(),
];
scanMutatingDispatchMarkers(issues);
checkPolicySemantics(issues);
checkLookupExamples(issues);

if (issues.length > 0) {
  console.error("Route policy guard failed:");
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log(`Route policy guard passed for ${ROUTE_POLICIES.length} registered auth-worker route policies.`);
