import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRoutePolicy } from "../workers/auth/src/app/route-policy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const migration = fs.readFileSync(
  path.join(repoRoot, "workers/auth/migrations/0032_add_data_lifecycle_requests.sql"),
  "utf8"
);
const helper = fs.readFileSync(
  path.join(repoRoot, "workers/auth/src/lib/data-lifecycle.js"),
  "utf8"
);
const route = fs.readFileSync(
  path.join(repoRoot, "workers/auth/src/routes/admin-data-lifecycle.js"),
  "utf8"
);

const issues = [];

for (const table of [
  "data_lifecycle_requests",
  "data_lifecycle_request_items",
  "data_export_archives",
]) {
  if (!migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`)) {
    issues.push(`migration 0032 is missing table ${table}.`);
  }
}

for (const indexName of [
  "idx_data_lifecycle_requests_created_id",
  "idx_data_lifecycle_items_request_created_id",
]) {
  if (!migration.includes(`CREATE INDEX IF NOT EXISTS ${indexName}`)) {
    issues.push(`migration 0032 is missing required lifecycle index ${indexName}.`);
  }
}

for (const [method, pathname, expectedId] of [
  ["POST", "/api/admin/data-lifecycle/requests", "admin.data-lifecycle.requests.create"],
  ["GET", "/api/admin/data-lifecycle/requests", "admin.data-lifecycle.requests.list"],
  ["GET", "/api/admin/data-lifecycle/requests/dlr_123", "admin.data-lifecycle.requests.read"],
  ["POST", "/api/admin/data-lifecycle/requests/dlr_123/plan", "admin.data-lifecycle.requests.plan"],
  ["POST", "/api/admin/data-lifecycle/requests/dlr_123/approve", "admin.data-lifecycle.requests.approve"],
]) {
  const policy = getRoutePolicy(method, pathname);
  if (policy?.id !== expectedId) {
    issues.push(`${method} ${pathname} resolves to ${policy?.id || "none"}, expected ${expectedId}.`);
  }
  if (method !== "GET" && policy?.csrf !== "same-origin-required") {
    issues.push(`${expectedId} must require same-origin CSRF policy.`);
  }
  if (policy?.auth !== "admin" || policy?.mfa === "none") {
    issues.push(`${expectedId} must require admin auth and an MFA policy.`);
  }
  if (!policy?.rateLimit?.failClosed) {
    issues.push(`${expectedId} must use a fail-closed rate-limit policy.`);
  }
}

const forbiddenSecretSelects = [
  /SELECT[^`"']*password_hash/is,
  /SELECT[^`"']*token_hash/is,
  /SELECT[^`"']*code_hash/is,
  /SELECT[^`"']*secret_ciphertext/is,
  /SELECT[^`"']*pending_secret_ciphertext/is,
  /SELECT[^`"']*AI_SERVICE_AUTH_SECRET/is,
];

for (const pattern of forbiddenSecretSelects) {
  if (pattern.test(helper)) {
    issues.push(`data lifecycle helper appears to select a forbidden secret field: ${pattern}.`);
  }
}

if (/\.delete\(/.test(helper) || /DELETE FROM users/i.test(helper)) {
  issues.push("data lifecycle helper must not execute irreversible delete operations in Phase 1-H.");
}

if (!route.includes("normalizeDataLifecycleIdempotencyKey")) {
  issues.push("admin data lifecycle mutations must enforce Idempotency-Key.");
}

if (issues.length > 0) {
  console.error("Data lifecycle policy guard failed:");
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log("Data lifecycle policy guard passed.");
