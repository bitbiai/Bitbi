#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const EXPECTED_MAIN_RELEASE_AUTH_MIGRATION =
  "0048_add_member_ai_usage_attempts.sql";

const MAIN_RELEASE_DEPLOY_UNITS = Object.freeze([
  "auth Worker",
  "static/pages",
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function defaultGitRunner(repoRoot, args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
  };
}

function runGit(repoRoot, args, gitRunner = defaultGitRunner) {
  const result = gitRunner(repoRoot, args);
  if (!result?.ok) return null;
  return String(result.stdout || "").trim();
}

function summarizeStatus(statusText) {
  const lines = String(statusText || "").split(/\r?\n/).filter(Boolean);
  const summary = {
    clean: lines.length === 0,
    total: lines.length,
    modified: 0,
    added: 0,
    deleted: 0,
    renamed: 0,
    untracked: 0,
    other: 0,
  };

  for (const line of lines) {
    const code = line.slice(0, 2);
    if (code === "??") summary.untracked += 1;
    else if (code.includes("M")) summary.modified += 1;
    else if (code.includes("A")) summary.added += 1;
    else if (code.includes("D")) summary.deleted += 1;
    else if (code.includes("R")) summary.renamed += 1;
    else summary.other += 1;
  }

  return summary;
}

function formatStatusSummary(status) {
  if (status.clean) return "clean";
  return `dirty (${status.total} entries: ${status.modified} modified, ${status.added} added, ${status.deleted} deleted, ${status.renamed} renamed, ${status.untracked} untracked, ${status.other} other)`;
}

export function collectMainReleaseReadiness(options = {}) {
  const repoRoot = options.repoRoot || process.cwd();
  const allowDirty = options.allowDirty === true;
  const gitRunner = options.gitRunner || defaultGitRunner;
  const releaseCompatPath = path.join(repoRoot, "config", "release-compat.json");
  const manifest = readJson(releaseCompatPath);
  const latestAuthMigration =
    manifest?.release?.schemaCheckpoints?.auth?.latest || "unknown";

  const branch = runGit(repoRoot, ["branch", "--show-current"], gitRunner) || "unknown";
  const commit = runGit(repoRoot, ["rev-parse", "HEAD"], gitRunner) || "unknown";
  const statusText = runGit(repoRoot, ["status", "--short"], gitRunner) || "";
  const status = summarizeStatus(statusText);
  const issues = [];

  if (latestAuthMigration !== EXPECTED_MAIN_RELEASE_AUTH_MIGRATION) {
    issues.push(
      `Latest auth migration mismatch: expected ${EXPECTED_MAIN_RELEASE_AUTH_MIGRATION}, found ${latestAuthMigration}.`
    );
  }

  if (!status.clean && !allowDirty) {
    issues.push(
      "Worktree is dirty. Commit or stash changes before a direct-main release, or rerun with --allow-dirty for local planning only."
    );
  }

  return {
    ok: issues.length === 0,
    generatedAt: options.generatedAt || new Date().toISOString(),
    branch,
    commit,
    status,
    allowDirty,
    latestAuthMigration,
    expectedDeployUnits: MAIN_RELEASE_DEPLOY_UNITS,
    verdict: "BLOCKED",
    productionReadiness: "BLOCKED",
    liveBillingReadiness: "BLOCKED",
    warnings: [
      "Direct-main release is riskier than staging because no separate staging environment is used.",
      "Production readiness remains BLOCKED until operator evidence is complete and reviewed.",
      "Live billing readiness remains BLOCKED; this check does not enable billing or approve Stripe live use.",
      "Phase 2.1-2.4 runtime visibility requires both auth Worker and static/pages deployment from the reviewed main commit.",
      `Production D1 migration status through ${EXPECTED_MAIN_RELEASE_AUTH_MIGRATION} must be verified manually before live smoke checks.`,
      "This check never deploys, runs remote migrations, calls Stripe APIs, changes secrets, or mutates Cloudflare/GitHub settings.",
    ],
    requiredManualEvidence: [
      "Clean reviewed main commit and release-plan output.",
      `Production auth D1 migration evidence through ${EXPECTED_MAIN_RELEASE_AUTH_MIGRATION}.`,
      "Auth Worker deployed commit evidence.",
      "Static/pages deployed commit evidence.",
      "Live readiness evidence collector output with explicit URLs.",
      "Admin login/MFA smoke evidence.",
      "Billing review queue/detail/resolution smoke evidence.",
      "Billing reconciliation smoke evidence.",
      "No raw payload/signature/secret/card rendering evidence.",
      "No Stripe action and no credit mutation evidence.",
      "Rollback owner and previous artifact/version evidence.",
    ],
    issues,
  };
}

function renderWarnings(warnings, { markdown = false } = {}) {
  return warnings.map((warning) => `${markdown ? "-" : "-"} ${warning}`).join("\n");
}

function renderEvidenceList(items, { markdown = false } = {}) {
  return items.map((item) => `${markdown ? "-" : "-"} ${item}`).join("\n");
}

export function renderMainReleaseReadinessText(readiness) {
  return [
    "BITBI main-only release readiness gate",
    `Generated at: ${readiness.generatedAt}`,
    `Result: ${readiness.ok ? "PASS" : "FAIL"}`,
    `Branch: ${readiness.branch}`,
    `Commit: ${readiness.commit}`,
    `Worktree: ${formatStatusSummary(readiness.status)}${readiness.allowDirty ? " (allowed for local planning)" : ""}`,
    `Latest auth migration: ${readiness.latestAuthMigration}`,
    `Expected Phase 2.1-2.4 deploy units: ${readiness.expectedDeployUnits.join(", ")}`,
    `Production readiness: ${readiness.productionReadiness}`,
    `Live billing readiness: ${readiness.liveBillingReadiness}`,
    "",
    "Warnings:",
    renderWarnings(readiness.warnings),
    "",
    "Required manual evidence:",
    renderEvidenceList(readiness.requiredManualEvidence),
    readiness.issues.length ? "\nIssues:\n" + readiness.issues.map((issue) => `- ${issue}`).join("\n") : "",
    "",
    "Run `npm run release:plan` for the current diff before any operator-approved main deployment.",
  ].filter((line) => line !== "").join("\n");
}

export function renderMainReleaseReadinessMarkdown(readiness) {
  return `# BITBI Main-Only Release Readiness Gate

Generated at: ${readiness.generatedAt}

Result: **${readiness.ok ? "PASS" : "FAIL"}**

Final verdict: **${readiness.verdict}**

Production readiness: **${readiness.productionReadiness}**

Live billing readiness: **${readiness.liveBillingReadiness}**

## Repo Baseline

- Branch: \`${readiness.branch}\`
- Commit: \`${readiness.commit}\`
- Worktree: ${formatStatusSummary(readiness.status)}${readiness.allowDirty ? " (allowed for local planning)" : ""}
- Latest auth D1 migration from \`config/release-compat.json\`: \`${readiness.latestAuthMigration}\`
- Expected Phase 2.1-2.4 deploy units: ${readiness.expectedDeployUnits.map((unit) => `\`${unit}\``).join(", ")}

## Warnings

${renderWarnings(readiness.warnings, { markdown: true })}

## Required Manual Evidence

${renderEvidenceList(readiness.requiredManualEvidence, { markdown: true })}

## Issues

${readiness.issues.length ? readiness.issues.map((issue) => `- ${issue}`).join("\n") : "- None from local gate."}

This gate is local-only and non-mutating. Run \`npm run release:plan\` for the current diff before any operator-approved main deployment.
`;
}

export function parseMainReleaseArgs(argv) {
  const options = {
    allowDirty: false,
    markdown: false,
    help: false,
  };

  for (const arg of argv) {
    if (arg === "--allow-dirty") {
      options.allowDirty = true;
    } else if (arg === "--markdown") {
      options.markdown = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printUsage() {
  console.log(`Usage: node scripts/check-main-release-readiness.mjs [options]

Options:
  --allow-dirty   Allow a dirty worktree for local planning only.
  --markdown      Print markdown evidence output.
  --help, -h      Show this help.

This command is local-only and non-mutating. It never deploys, runs remote migrations, calls Stripe APIs, changes secrets, or mutates Cloudflare/GitHub settings.`);
}

async function main() {
  let options;
  try {
    options = parseMainReleaseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`check:main-release-readiness failed: ${error.message}`);
    process.exit(1);
  }

  if (options.help) {
    printUsage();
    return;
  }

  try {
    const readiness = collectMainReleaseReadiness({
      repoRoot: process.cwd(),
      allowDirty: options.allowDirty,
    });
    const output = options.markdown
      ? renderMainReleaseReadinessMarkdown(readiness)
      : renderMainReleaseReadinessText(readiness);
    console.log(output);
    if (!readiness.ok) process.exit(1);
  } catch (error) {
    console.error(`check:main-release-readiness failed: ${error.message}`);
    process.exit(1);
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  await main();
}
