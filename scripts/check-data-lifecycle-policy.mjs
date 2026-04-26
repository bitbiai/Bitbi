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
const archiveMigration = fs.readFileSync(
  path.join(repoRoot, "workers/auth/migrations/0033_harden_data_export_archives.sql"),
  "utf8"
);
const helper = fs.readFileSync(
  path.join(repoRoot, "workers/auth/src/lib/data-lifecycle.js"),
  "utf8"
);
const archiveHelper = fs.readFileSync(
  path.join(repoRoot, "workers/auth/src/lib/data-export-archive.js"),
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

for (const columnName of [
  "manifest_version",
  "status",
  "downloaded_at",
  "error_code",
]) {
  if (!archiveMigration.includes(`ADD COLUMN ${columnName}`)) {
    issues.push(`migration 0033 is missing data_export_archives column ${columnName}.`);
  }
}

for (const indexName of [
  "idx_data_export_archives_request_status",
  "idx_data_export_archives_status_expires",
]) {
  if (!archiveMigration.includes(`CREATE INDEX IF NOT EXISTS ${indexName}`)) {
    issues.push(`migration 0033 is missing required export archive index ${indexName}.`);
  }
}

for (const [method, pathname, expectedId] of [
  ["POST", "/api/admin/data-lifecycle/requests", "admin.data-lifecycle.requests.create"],
  ["GET", "/api/admin/data-lifecycle/requests", "admin.data-lifecycle.requests.list"],
  ["GET", "/api/admin/data-lifecycle/requests/dlr_123", "admin.data-lifecycle.requests.read"],
  ["POST", "/api/admin/data-lifecycle/requests/dlr_123/plan", "admin.data-lifecycle.requests.plan"],
  ["POST", "/api/admin/data-lifecycle/requests/dlr_123/approve", "admin.data-lifecycle.requests.approve"],
  ["POST", "/api/admin/data-lifecycle/requests/dlr_123/generate-export", "admin.data-lifecycle.requests.generate-export"],
  ["GET", "/api/admin/data-lifecycle/requests/dlr_123/export", "admin.data-lifecycle.requests.export.read"],
  ["GET", "/api/admin/data-lifecycle/exports/dla_123", "admin.data-lifecycle.exports.read"],
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
  if (pattern.test(helper) || pattern.test(archiveHelper)) {
    issues.push(`data lifecycle helper appears to select a forbidden secret field: ${pattern}.`);
  }
}

if (/\.delete\(/.test(helper) || /DELETE FROM users/i.test(helper) || /DELETE FROM users/i.test(archiveHelper)) {
  issues.push("data lifecycle helpers must not execute irreversible user delete operations.");
}

if (!archiveHelper.includes('ARCHIVE_BUCKET_BINDING = "AUDIT_ARCHIVE"')) {
  issues.push("data export archive helper must use the private AUDIT_ARCHIVE binding.");
}

if (!archiveHelper.includes("MAX_ARCHIVE_ITEMS") || !archiveHelper.includes("MAX_ARCHIVE_BYTES")) {
  issues.push("data export archive helper must enforce item-count and byte-size bounds.");
}

if (/key:\s*entry\.r2_key/.test(archiveHelper) || /key:\s*row\.r2_key/.test(archiveHelper)) {
  issues.push("data export archive helper must not expose raw internal R2 keys in archive JSON.");
}

if (!archiveHelper.includes("internalKeyIncluded: false") || !archiveHelper.includes("keySha256")) {
  issues.push("data export archive helper must expose only safe internal-key references for media manifest entries.");
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
