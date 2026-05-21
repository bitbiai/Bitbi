import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanDocCurrentness } from "./lib/doc-currentness.mjs";

const latest = "0060_add_app_settings.sql";

function makeRepo(latestMigration = latest) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "bitbi-doc-currentness-"));
  fs.mkdirSync(path.join(repo, "config"), { recursive: true });
  fs.writeFileSync(path.join(repo, "config", "release-compat.json"), JSON.stringify({
    release: {
      schemaCheckpoints: {
        auth: {
          latest: latestMigration,
        },
      },
    },
  }));
  return repo;
}

function writeFile(repo, relativePath, text) {
  const absolutePath = path.join(repo, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, text);
}

{
  const repo = makeRepo();
  writeFile(repo, "README.md", `Current release truth: latest auth D1 migration is ${latest}.\nStart at docs/audits/NEXT_AUDIT_BASELINE.md.\n`);
  writeFile(repo, "docs/audits/NEXT_AUDIT_BASELINE.md", `Latest auth D1 migration: \`${latest}\`\n`);
  writeFile(repo, "CURRENT_IMPLEMENTATION_HANDOFF.md", `Latest auth D1 migration: \`${latest}\`\nActive baseline: docs/audits/NEXT_AUDIT_BASELINE.md\n`);
  const result = scanDocCurrentness(repo, {
    currentDocs: ["README.md", "docs/audits/NEXT_AUDIT_BASELINE.md", "CURRENT_IMPLEMENTATION_HANDOFF.md"],
  });
  assert.deepEqual(result.violations, []);
  assert.equal(result.categoryCounts.active_current, 3);
}

{
  const repo = makeRepo();
  writeFile(repo, "README.md", `Current release truth: ${latest}\nProduction readiness remains BLOCKED.\nStart at docs/audits/NEXT_AUDIT_BASELINE.md.\n`);
  writeFile(repo, "docs/audits/NEXT_AUDIT_BASELINE.md", `Latest auth D1 migration: ${latest}\n`);
  const result = scanDocCurrentness(repo, {
    currentDocs: ["README.md", "docs/audits/NEXT_AUDIT_BASELINE.md"],
  });
  assert.deepEqual(result.violations, []);
}

{
  const repo = makeRepo();
  writeFile(repo, "README.md", `Current release truth: ${latest}\n`);
  writeFile(repo, "docs/audits/NEXT_AUDIT_BASELINE.md", `Latest auth D1 migration: ${latest}\n`);
  const result = scanDocCurrentness(repo, {
    currentDocs: ["README.md", "docs/audits/NEXT_AUDIT_BASELINE.md"],
  });
  assert(result.violations.some((violation) => violation.type === "missing-active-baseline-reference"
    && violation.file === "README.md"));
}

{
  const repo = makeRepo();
  writeFile(repo, "README.md", [
    `Current release truth: ${latest}`,
    "Start at docs/audits/NEXT_AUDIT_BASELINE.md.",
    "Production readiness: READY",
    "",
  ].join("\n"));
  writeFile(repo, "docs/audits/NEXT_AUDIT_BASELINE.md", `Latest auth D1 migration: ${latest}\n`);
  const result = scanDocCurrentness(repo, {
    currentDocs: ["README.md", "docs/audits/NEXT_AUDIT_BASELINE.md"],
  });
  assert(result.violations.some((violation) => violation.type === "blocked-claim-overclaim"
    && violation.rule === "production-readiness-overclaim"));
}

{
  const repo = makeRepo();
  writeFile(repo, "README.md", [
    `Current release truth: ${latest}`,
    "Start at docs/audits/NEXT_AUDIT_BASELINE.md.",
    "Tenant isolation verified.",
    "",
  ].join("\n"));
  writeFile(repo, "docs/audits/NEXT_AUDIT_BASELINE.md", `Latest auth D1 migration: ${latest}\n`);
  const result = scanDocCurrentness(repo, {
    currentDocs: ["README.md", "docs/audits/NEXT_AUDIT_BASELINE.md"],
  });
  assert(result.violations.some((violation) => violation.type === "blocked-claim-overclaim"
    && violation.rule === "tenant-isolation-overclaim"));
}

{
  const repo = makeRepo();
  writeFile(repo, "README.md", "Latest auth D1 migration: `0040_add_live_stripe_credit_pack_scope.sql`\n");
  const result = scanDocCurrentness(repo, {
    currentDocs: ["README.md"],
    requireLatest: false,
  });
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].type, "stale-latest-migration");
}

{
  const repo = makeRepo();
  writeFile(repo, "README.md", "Latest auth D1 migration: `0059_add_data_lifecycle_completion_state.sql`\n");
  const result = scanDocCurrentness(repo, {
    currentDocs: ["README.md"],
    requireLatest: false,
  });
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].type, "stale-latest-migration");
  assert.match(result.violations[0].message, /0059_add_data_lifecycle_completion_state\.sql/);
}

{
  const repo = makeRepo();
  writeFile(repo, "README.md", "Current auth migration: `0059`\n");
  const result = scanDocCurrentness(repo, {
    currentDocs: ["README.md"],
    requireLatest: false,
  });
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].type, "stale-latest-migration");
  assert.match(result.violations[0].message, /0059/);
}

{
  const repo = makeRepo();
  writeFile(repo, "README.md", "Remote auth D1 migration status verified through `0058_add_legacy_media_reset_actions.sql` before deploy.\n");
  const result = scanDocCurrentness(repo, {
    currentDocs: ["README.md"],
    requireLatest: false,
  });
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].type, "stale-latest-migration");
  assert.equal(result.violations[0].rule, "auth-d1-migration-verified-through");
}

{
  const repo = makeRepo();
  writeFile(repo, "README.md", "auth D1 migration verified through `0048_add_member_ai_usage_attempts.sql` before Auth Worker deploy.\n");
  const result = scanDocCurrentness(repo, {
    currentDocs: ["README.md"],
    requireLatest: false,
  });
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].type, "stale-latest-migration");
  assert.match(result.violations[0].message, /0048_add_member_ai_usage_attempts\.sql/);
}

{
  const repo = makeRepo();
  writeFile(repo, "README.md", `Current release truth: latest auth D1 migration is ${latest}.\n`);
  writeFile(repo, "docs/production-readiness/MAIN_ONLY_RELEASE_CHECKLIST.md", "Required migration through `0059_add_data_lifecycle_completion_state.sql` before current deploy.\n");
  const result = scanDocCurrentness(repo, {
    currentDocs: ["README.md"],
    requireLatest: false,
  });
  assert(result.violations.some((violation) => violation.type === "stale-latest-migration"
    && violation.file === "docs/production-readiness/MAIN_ONLY_RELEASE_CHECKLIST.md"
    && violation.rule === "required-migration-through"));
  assert.equal(
    result.markdownInventory.find((entry) => entry.path === "docs/production-readiness/MAIN_ONLY_RELEASE_CHECKLIST.md")?.category,
    "active_runbook_policy"
  );
}

{
  const repo = makeRepo("0061_future_release_contract.sql");
  writeFile(repo, "README.md", "Latest auth D1 migration: `0060_add_app_settings.sql`\n");
  const result = scanDocCurrentness(repo, {
    currentDocs: ["README.md"],
    requireLatest: false,
  });
  assert.equal(result.latest, "0061_future_release_contract.sql");
  assert.equal(result.violations.length, 1);
  assert.match(result.violations[0].message, /0061_future_release_contract\.sql/);
}

{
  const repo = makeRepo();
  writeFile(repo, "README.md", "Current auth migration: `0060`\n");
  const result = scanDocCurrentness(repo, {
    currentDocs: ["README.md"],
    requireLatest: false,
  });
  assert.deepEqual(result.violations, []);
}

{
  const repo = makeRepo();
  writeFile(repo, "README.md", `Current release truth: ${latest}\n`);
  writeFile(repo, "docs/audits/archive/root-phase-reports/PHASE2L_LIVE_STRIPE_CREDIT_PACKS_AND_CREDITS_DASHBOARD_REPORT.md", "Latest auth D1 migration at that historical phase: `0040_add_live_stripe_credit_pack_scope.sql`\n");
  const result = scanDocCurrentness(repo, {
    currentDocs: ["README.md"],
  });
  assert.deepEqual(result.violations, []);
  assert.equal(result.categoryCounts.historical_phase_report, 1);
}

{
  const repo = makeRepo();
  writeFile(repo, "README.md", `Current release truth: ${latest}\n`);
  writeFile(repo, "docs/production-readiness/PHASE3_MEMBER_IMAGE_GATEWAY_MAIN_CHECKLIST.md", "Latest auth migration is `0048_add_member_ai_usage_attempts.sql`.\n");
  const result = scanDocCurrentness(repo, {
    currentDocs: ["README.md"],
  });
  assert.deepEqual(result.violations, []);
  assert.equal(
    result.markdownInventory.find((entry) => entry.path === "docs/production-readiness/PHASE3_MEMBER_IMAGE_GATEWAY_MAIN_CHECKLIST.md")?.category,
    "superseded_stale"
  );
}

{
  const repo = makeRepo();
  writeFile(repo, "README.md", `Current release truth: ${latest}\n`);
  writeFile(repo, "docs/audits/archive/root-phase-reports/PHASE2L_LIVE_STRIPE_CREDIT_PACKS_AND_CREDITS_DASHBOARD_REPORT.md", "Latest auth D1 migration at that historical phase: `0059_add_data_lifecycle_completion_state.sql`\n");
  const result = scanDocCurrentness(repo, {
    currentDocs: ["README.md"],
  });
  assert.deepEqual(result.violations, []);
  assert.equal(result.categoryCounts.historical_phase_report, 1);
}

{
  const repo = makeRepo();
  writeFile(repo, "README.md", `Current release truth: ${latest}\n`);
  writeFile(repo, "PHASE2L_LIVE_STRIPE_CREDIT_PACKS_AND_CREDITS_DASHBOARD_REPORT.md", "Historical report in the root.\n");
  const result = scanDocCurrentness(repo, {
    currentDocs: ["README.md"],
  });
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].type, "root-historical-report-not-archived");
}

{
  const repo = makeRepo();
  writeFile(repo, "README.md", `Current release truth: ${latest}\n`);
  writeFile(repo, "docs/audits/archive/retired-audit-root-docs/AUDIT_ACTION_PLAN.md", "Retired root audit doc.\n");
  const result = scanDocCurrentness(repo, {
    currentDocs: ["README.md"],
  });
  assert.deepEqual(result.violations, []);
  assert.equal(result.categoryCounts.historical_phase_report, 1);
}

{
  const repo = makeRepo();
  writeFile(repo, "README.md", `Current release truth: ${latest}\n`);
  writeFile(repo, "AUDIT_ACTION_PLAN.md", "Retired audit doc in the root.\n");
  const result = scanDocCurrentness(repo, {
    currentDocs: ["README.md"],
  });
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].type, "retired-root-audit-doc-not-archived");
}

{
  const repo = makeRepo();
  writeFile(repo, "README.md", `Current release truth: ${latest}\n`);
  writeFile(repo, "ALPHA_AUDIT_2026_05_15.md", "Retired alpha audit doc in the root.\n");
  const result = scanDocCurrentness(repo, {
    currentDocs: ["README.md"],
  });
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].type, "retired-root-audit-doc-not-archived");
}

{
  const repo = makeRepo();
  writeFile(repo, "README.md", "Current release truth is documented elsewhere.\n");
  const result = scanDocCurrentness(repo, {
    currentDocs: ["README.md"],
  });
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].type, "missing-current-latest");
}

{
  const repo = makeRepo();
  writeFile(repo, "README.md", `Current release truth: ${latest}\n`);
  writeFile(repo, "CURRENT_IMPLEMENTATION_HANDOFF.md", `Latest auth D1 migration: ${latest}\n${"history\n".repeat(351)}`);
  const result = scanDocCurrentness(repo, {
    currentDocs: ["README.md", "CURRENT_IMPLEMENTATION_HANDOFF.md"],
  });
  assert(result.violations.some((violation) => violation.type === "current-doc-too-long"));
}

{
  const repo = makeRepo();
  writeFile(repo, "README.md", `Current release truth: ${latest}\n`);
  writeFile(repo, "CURRENT_IMPLEMENTATION_HANDOFF.md", `Latest auth D1 migration: ${latest}\nPhase 1 did a thing.\n`);
  const result = scanDocCurrentness(repo, {
    currentDocs: ["README.md", "CURRENT_IMPLEMENTATION_HANDOFF.md"],
  });
  assert(result.violations.some((violation) => violation.type === "current-doc-phase-history"));
}

{
  const repo = makeRepo();
  writeFile(repo, "README.md", `Current release truth: ${latest}\n`);
  writeFile(repo, "docs/audits/README.md", `Current release truth: ${latest}\n`);
  writeFile(repo, "workers/auth/CLAUDE.md", `Current release truth: ${latest}\n`);
  writeFile(repo, "node_modules/foo/README.md", "Dependency readme.\n");
  writeFile(repo, "workers/ai/node_modules/foo/README.md", "Nested dependency readme.\n");
  writeFile(repo, "workers/auth/node_modules/foo/LICENSE.md", "Nested dependency license.\n");
  writeFile(repo, "workers/contact/node_modules/undici/docs/docs/api/Agent.md", "Deep nested dependency docs.\n");
  const result = scanDocCurrentness(repo, {
    currentDocs: ["README.md", "docs/audits/README.md", "workers/auth/CLAUDE.md"],
  });
  assert.deepEqual(result.violations, []);
  const inventoriedPaths = result.markdownInventory.map((entry) => entry.path);
  assert(inventoriedPaths.includes("docs/audits/README.md"));
  assert(inventoriedPaths.includes("workers/auth/CLAUDE.md"));
  assert(!inventoriedPaths.some((entryPath) => entryPath.split("/").includes("node_modules")));
}

{
  const repo = makeRepo();
  writeFile(repo, "README.md", `Current release truth: ${latest}\n`);
  writeFile(repo, "docs/unknown-note.md", "Unindexed note.\n");
  const result = scanDocCurrentness(repo, {
    currentDocs: ["README.md"],
  });
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].type, "unclassified-markdown");
}

{
  const repo = makeRepo();
  writeFile(repo, "README.md", `Current release truth: ${latest}\n`);
  writeFile(repo, "CLAUDE.md", [
    "Cloudflare Workers",
    "config/release-compat.json",
    "docs/audits/NEXT_AUDIT_BASELINE.md",
    "Production readiness remains BLOCKED",
    "Live billing readiness remains BLOCKED",
    "Tenant isolation remains NOT CLAIMED",
    "All non-admin changes must be implemented and checked for both English and German routes/pages/locales. Admin remains English-only and must not be localized or recreated under /de/admin unless explicitly requested.",
    "",
  ].join("\n"));
  const result = scanDocCurrentness(repo, {
    currentDocs: ["README.md"],
  });
  assert.deepEqual(result.violations, []);
  assert.equal(result.categoryCounts.active_runbook_policy, 1);
}

{
  const repo = makeRepo();
  writeFile(repo, "README.md", `Current release truth: ${latest}\n`);
  writeFile(repo, "CLAUDE.md", [
    "Bitbi is a static portfolio website.",
    "Cloudflare Workers",
    "config/release-compat.json",
    "docs/audits/NEXT_AUDIT_BASELINE.md",
    "Production readiness remains BLOCKED",
    "Live billing readiness remains BLOCKED",
    "Tenant isolation remains NOT CLAIMED",
    "All non-admin changes must be implemented and checked for both English and German routes/pages/locales. Admin remains English-only and must not be localized or recreated under /de/admin unless explicitly requested.",
    "",
  ].join("\n"));
  const result = scanDocCurrentness(repo, {
    currentDocs: ["README.md"],
  });
  assert(result.violations.some((violation) => violation.type === "active-guidance-doc-drift"));
}

{
  const repo = makeRepo();
  writeFile(repo, "README.md", `Current release truth: ${latest}\n`);
  writeFile(repo, "CLAUDE.md", [
    "Cloudflare Workers",
    "config/release-compat.json",
    "Production readiness remains BLOCKED",
    "Live billing readiness remains BLOCKED",
    "Tenant isolation remains NOT CLAIMED",
    "All non-admin changes must be implemented and checked for both English and German routes/pages/locales. Admin remains English-only and must not be localized or recreated under /de/admin unless explicitly requested.",
    "",
  ].join("\n"));
  const result = scanDocCurrentness(repo, {
    currentDocs: ["README.md"],
  });
  assert(result.violations.some((violation) => violation.type === "active-guidance-doc-missing-required-text"));
}

{
  const repo = makeRepo();
  writeFile(repo, "README.md", `Current release truth: ${latest}\n`);
  writeFile(repo, "CURRENT_IMPLEMENTATION_HANDOFF.md", `Latest auth D1 migration: ${latest}\nP2-02 carried an old package label.\n`);
  const result = scanDocCurrentness(repo, {
    currentDocs: ["README.md", "CURRENT_IMPLEMENTATION_HANDOFF.md"],
  });
  assert(result.violations.some((violation) => violation.type === "current-doc-phase-history"));
}

{
  const repo = makeRepo();
  writeFile(repo, "README.md", `Current release truth: ${latest}\n`);
  writeFile(repo, "docs/tenant-assets/TENANT_ASSET_OWNERSHIP_DESIGN.md", "Tenant design.\n");
  const result = scanDocCurrentness(repo, {
    currentDocs: ["README.md"],
  });
  assert.deepEqual(result.violations, []);
  assert.equal(result.categoryCounts.active_domain_design, 1);
}

{
  const repo = makeRepo();
  writeFile(repo, "README.md", `Current release truth: ${latest}\n`);
  writeFile(repo, "docs/tenant-assets/AI_FOLDERS_IMAGES_SCHEMA_ACCESS_PLAN.md", "Current release truth: latest auth D1 migration is `0059_add_data_lifecycle_completion_state.sql`.\n");
  const result = scanDocCurrentness(repo, {
    currentDocs: ["README.md"],
  });
  assert(result.violations.some((violation) => violation.type === "stale-latest-migration"
    && violation.file === "docs/tenant-assets/AI_FOLDERS_IMAGES_SCHEMA_ACCESS_PLAN.md"));
}

{
  const repo = makeRepo();
  writeFile(repo, "README.md", `Current release truth: ${latest}\n`);
  writeFile(repo, "js/pages/admin/control-plane/core.js", "const CURRENT_AUTH_SCHEMA_CHECKPOINT = '0059_add_data_lifecycle_completion_state.sql';\n");
  const result = scanDocCurrentness(repo, {
    currentDocs: ["README.md"],
  });
  assert(result.violations.some((violation) => violation.type === "stale-latest-migration"
    && violation.file === "js/pages/admin/control-plane/core.js"
    && violation.rule === "current-auth-schema-checkpoint"));
}

{
  const repo = makeRepo();
  writeFile(repo, "README.md", `Current release truth: ${latest}\n`);
  writeFile(repo, "js/pages/admin/control-plane/core.js", `const CURRENT_AUTH_SCHEMA_CHECKPOINT = '${latest}';\n`);
  writeFile(repo, "js/pages/admin/control-plane.js", "export * from './control-plane/core.js';\n");
  const result = scanDocCurrentness(repo, {
    currentDocs: ["README.md"],
  });
  assert.deepEqual(result.violations, []);
}

{
  const repo = makeRepo();
  writeFile(repo, "README.md", `Current release truth: ${latest}\n`);
  writeFile(repo, "js/pages/admin/control-plane.js", "const CURRENT_AUTH_SCHEMA_CHECKPOINT = '0059_add_data_lifecycle_completion_state.sql';\n");
  const result = scanDocCurrentness(repo, {
    currentDocs: ["README.md"],
  });
  assert(!result.violations.some((violation) => violation.file === "js/pages/admin/control-plane.js"));
}

console.log("Doc currentness tests passed.");
