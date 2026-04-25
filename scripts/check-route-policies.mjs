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
  "workers/auth/src/routes/admin-ai.js",
  "workers/auth/src/routes/admin-mfa.js",
  "workers/auth/src/routes/ai.js",
  "workers/auth/src/routes/favorites.js",
];

const REQUIRED_LOOKUPS = [
  ["POST", "/api/admin/ai/video-jobs", "admin.ai.video-jobs.create"],
  ["GET", "/api/admin/ai/video-jobs/poison", "admin.ai.video-jobs.poison.list"],
  ["GET", "/api/admin/ai/video-jobs/poison/poison-123", "admin.ai.video-jobs.poison.read"],
  ["GET", "/api/admin/ai/video-jobs/failed", "admin.ai.video-jobs.failed.list"],
  ["GET", "/api/admin/ai/video-jobs/failed/job-123", "admin.ai.video-jobs.failed.read"],
  ["GET", "/api/admin/ai/video-jobs/job-123", "admin.ai.video-jobs.status"],
  ["GET", "/api/admin/ai/video-jobs/job-123/output", "admin.ai.video-jobs.output"],
  ["POST", "/api/admin/ai/test-video", "admin.ai.test-video-debug"],
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
