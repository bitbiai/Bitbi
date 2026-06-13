import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");

const migration = read("workers/auth/migrations/0066_add_operator_billing_cleanup.sql");
const cleanupLib = read("workers/auth/src/lib/operator-billing-cleanup.js");
const adminBilling = read("workers/auth/src/routes/admin-billing.js");
const routePolicy = read("workers/auth/src/app/route-policy.js");
const billingEvents = read("workers/auth/src/lib/billing-events.js");
const authApi = read("js/shared/auth-api.js");
const adminBillingUi = read("js/pages/admin/control-plane/billing.js");
const adminHtml = read("admin/index.html");
const releaseCompat = JSON.parse(read("config/release-compat.json"));

for (const table of [
  "billing_operator_item_states",
  "billing_operator_cleanup_runs",
  "billing_operator_cleanup_run_items",
  "billing_operator_purge_tombstones",
]) {
  assert(migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `missing migration table ${table}`);
}

assert(migration.includes("CHECK (state IN ('archived'))"), "archive state must be constrained");
assert(migration.includes("CHECK (run_type IN ('archive', 'restore', 'purge_preview', 'purge_apply'))"), "cleanup run types must be constrained");
assert(migration.includes("CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_operator_purge_tombstones_provider_event"), "provider-event tombstones must be unique");
assert(migration.includes("CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_operator_purge_tombstones_checkout_session"), "checkout tombstones must be unique");

for (const exportName of [
  "archiveOperatorBillingItems",
  "restoreOperatorBillingItems",
  "previewOperatorBillingPurge",
  "applyOperatorBillingPurge",
  "findOperatorBillingPurgeTombstoneForProviderEvent",
  "getArchivedBillingItemKeys",
  "getBillingArchiveSummary",
]) {
  assert(cleanupLib.includes(`export async function ${exportName}`), `missing cleanup export ${exportName}`);
}
assert(cleanupLib.includes("export function isBillingProviderEventArchived"), "cleanup lib must expose provider-event archive matching");

assert(cleanupLib.includes("ICH VERSTEHE: DATENBANK-LÖSCHUNG IST ENDGÜLTIG"), "exact German purge confirmation must be required");
assert(cleanupLib.includes("exportEvidenceAcknowledged"), "purge apply must require export acknowledgement");
assert(cleanupLib.includes("operator_cleanup_preview_mismatch"), "purge apply must verify current preview hash");
assert(cleanupLib.includes("member_credit_ledger") && cleanupLib.includes("Hard-Delete ist blockiert"), "ledger-linked hard deletes must be blocked");
assert(cleanupLib.includes("INSERT OR IGNORE INTO billing_operator_purge_tombstones"), "purge apply must create tombstones before provider deletion");
assert(!/\brefund\b|\brefunds\b|subscriptions\.cancel|checkout\.sessions\.create|STRIPE_SECRET_KEY/.test(cleanupLib), "cleanup lib must not add Stripe mutation or secret handling");

for (const route of [
  "/api/admin/billing/operator-archive",
  "/api/admin/billing/operator-archive/restore",
  "/api/admin/billing/operator-purge-preview",
  "/api/admin/billing/operator-purge",
]) {
  assert(adminBilling.includes(route), `admin billing route missing ${route}`);
}

for (const policyId of [
  "admin.billing.operator_archive.list",
  "admin.billing.operator_archive.create",
  "admin.billing.operator_archive.restore",
  "admin.billing.operator_purge.preview",
  "admin.billing.operator_purge.apply",
]) {
  assert(routePolicy.includes(policyId), `route policy missing ${policyId}`);
}

assert(routePolicy.includes("same-origin JSON"), "write route notes must preserve same-origin JSON expectation");
assert(routePolicy.includes("admin MFA"), "cleanup route policy notes must mention admin MFA");
assert(routePolicy.includes("never calls Stripe"), "cleanup policy must document no Stripe mutation");

assert(billingEvents.includes("findOperatorBillingPurgeTombstoneForProviderEvent"), "billing ingestion must check operator purge tombstones");
assert(billingEvents.includes("operator_purge_tombstone_matched"), "tombstone-matched provider events must be classified safely");
assert(billingEvents.includes("side effects are disabled"), "tombstone replay must not create side effects");
assert(billingEvents.includes("includeArchived = false"), "billing provider/review lists must default to active-only");
assert(billingEvents.includes("isBillingProviderEventArchived"), "billing provider events must exclude archived provider/review rows");
assert(billingEvents.includes("isBillingItemKeyArchived"), "reconciliation rows must use explicit archived item filtering");
assert(billingEvents.includes("archiveSummary"), "billing active reports must expose a separate archive summary");
assert(billingEvents.includes("Archived billing records are excluded from active counters"), "reconciliation must explain active/archive split");

assert(adminBilling.includes("wantsArchivedBillingRows"), "admin route must require explicit archived mode");
assert(adminBilling.includes("archivedExcludedByDefault"), "admin event/review responses must state archived default exclusion");
assert(adminBilling.includes("readinessNotProvenByArchive"), "admin evidence/live status must not treat archives as readiness evidence");
assert(adminBilling.includes("Archiving is not production-readiness evidence"), "admin evidence/live status must explain archive is not readiness evidence");

for (const wrapperName of [
  "apiAdminBillingOperatorArchive",
  "apiAdminArchiveBillingItems",
  "apiAdminRestoreBillingItems",
]) {
  assert(authApi.includes(`export function ${wrapperName}`), `missing frontend API wrapper ${wrapperName}`);
}
assert(authApi.includes("Idempotency-Key"), "archive/restore frontend writes must send idempotency keys");

for (const uiNeedle of [
  "loadOperatorBillingArchive",
  "visibleBillingEventRefs",
  "visibleBillingReviewRefs",
  "Archivierte Einträge sind in dieser aktiven Ansicht ausgeblendet",
  "Archived records hidden from active counters",
  "Wiederherstellen",
]) {
  assert(adminBillingUi.includes(uiNeedle), `billing UI missing archive behavior ${uiNeedle}`);
}
assert(adminHtml.includes("Billing Archiv"), "admin HTML must expose a dedicated billing archive panel");
assert(adminHtml.includes("Archivierte Zahlungsereignisse werden nicht gelöscht"), "admin archive panel must explain archive is not deletion");
assert(adminHtml.includes("Sichtbare Einträge archivieren"), "provider event log must expose visible-row archive control");

assert.equal(
  releaseCompat.release.schemaCheckpoints.auth.latest,
  "0066_add_operator_billing_cleanup.sql",
  "release manifest must point to latest operator cleanup migration"
);

for (const route of [
  "GET /api/admin/billing/operator-archive",
  "POST /api/admin/billing/operator-archive",
  "POST /api/admin/billing/operator-archive/restore",
  "POST /api/admin/billing/operator-purge-preview",
  "POST /api/admin/billing/operator-purge",
]) {
  assert(releaseCompat.adminAuthRoutes.literalRoutes.includes(route), `release admin auth route missing ${route}`);
}

console.log("Operator billing cleanup tests passed.");
