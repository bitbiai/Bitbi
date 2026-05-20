import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  createReleasePlanFromRepo,
  evaluateStaticDeploySafety,
  formatReleasePlan,
  parseReleaseCliArgs,
  STATIC_DEPLOY_DEPENDENCY_ACKNOWLEDGEMENT,
} from "./lib/release-plan.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function usage() {
  return [
    "node scripts/check-static-deploy-safety.mjs [--file <path>] [--files a,b] [--base <git-ref>] [--head <git-ref>] [--plan-json <path>] [--event-name <name>] [--acknowledgement <text>]",
    "",
    "Fails closed when the release plan requires Worker deploys, schema applies, required manual prerequisites, or non-static deploy steps before Pages deploy.",
    "In GitHub Actions push/workflow_dispatch contexts, a trusted base/head range is required unless workflow_dispatch uses the exact manual acknowledgement.",
    `Manual workflow_dispatch acknowledgement phrase: ${STATIC_DEPLOY_DEPENDENCY_ACKNOWLEDGEMENT}`,
  ].join("\n");
}

function parseArgs(argv) {
  const releaseArgs = [];
  const options = {
    planJson: null,
    eventName: process.env.BITBI_STATIC_DEPLOY_GUARD_EVENT_NAME
      || process.env.STATIC_DEPLOY_EVENT
      || process.env.GITHUB_EVENT_NAME
      || "",
    acknowledgement: process.env.BITBI_STATIC_DEPLOY_GUARD_ACK
      || process.env.STATIC_DEPLOY_ACK
      || "",
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--plan-json") {
      options.planJson = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg === "--event-name") {
      options.eventName = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg === "--acknowledgement") {
      options.acknowledgement = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    releaseArgs.push(arg);
  }

  const releaseOptions = parseReleaseCliArgs(releaseArgs);
  releaseOptions.base = releaseOptions.base
    || process.env.BITBI_STATIC_DEPLOY_GUARD_BASE_REF
    || process.env.STATIC_DEPLOY_BASE_REF
    || null;
  releaseOptions.head = releaseOptions.head
    || process.env.BITBI_STATIC_DEPLOY_GUARD_HEAD_REF
    || process.env.STATIC_DEPLOY_HEAD_REF
    || null;

  return {
    ...options,
    planJson: options.planJson || process.env.BITBI_STATIC_DEPLOY_GUARD_FIXTURE || null,
    releaseOptions,
  };
}

function runGit(args) {
  return spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function isZeroSha(value) {
  return /^0{40}$/.test(String(value || "").trim());
}

function isCiEvent(eventName) {
  return eventName === "push" || eventName === "workflow_dispatch";
}

function hasExplicitFileList(options) {
  return Array.isArray(options.releaseOptions.files) && options.releaseOptions.files.length > 0;
}

function verifyCommitRef(ref) {
  if (!ref || isZeroSha(ref)) return false;
  const result = runGit(["rev-parse", "--verify", `${ref}^{commit}`]);
  return result.status === 0;
}

function verifyMergeBase(baseRef, headRef) {
  const result = runGit(["merge-base", baseRef, headRef]);
  return result.status === 0;
}

function getTrustedRangeIssue(options) {
  if (options.planJson || hasExplicitFileList(options) || !isCiEvent(options.eventName)) return null;

  const baseRef = String(options.releaseOptions.base || "").trim();
  const headRef = String(options.releaseOptions.head || "").trim();
  if (!baseRef || isZeroSha(baseRef)) {
    return "Missing or zero release-plan base ref for GitHub Actions static deploy guard.";
  }
  if (!headRef || isZeroSha(headRef)) {
    return "Missing or zero release-plan head ref for GitHub Actions static deploy guard.";
  }
  if (!verifyCommitRef(baseRef)) {
    return `Release-plan base ref is unavailable in checkout: ${baseRef}.`;
  }
  if (!verifyCommitRef(headRef)) {
    return `Release-plan head ref is unavailable in checkout: ${headRef}.`;
  }
  if (!verifyMergeBase(baseRef, headRef)) {
    return `Release-plan base/head refs do not have an available merge base: ${baseRef}...${headRef}.`;
  }
  return null;
}

function buildUntrustedRangePlan(reason, options) {
  return {
    source: {
      mode: "untrusted-ci-context",
      eventName: options.eventName || null,
      base: options.releaseOptions.base || null,
      head: options.releaseOptions.head || null,
      reason,
    },
    changedFiles: [],
    impacts: {
      workers: {},
      schemaCheckpoints: {},
      static: {
        required: false,
        deploymentModel: "github-pages-push-to-main",
        workflowPath: ".github/workflows/static.yml",
        changedFiles: [],
        reasons: [],
      },
      validationOnlyFiles: [],
      ignoredFiles: [],
      uncategorizedFiles: [],
    },
    deploySteps: [],
    workerDeploys: [],
    schemaApplies: [],
    staticDeploy: {
      id: "static-site",
      type: "static",
      applySupported: false,
      required: false,
      deploymentModel: "github-pages-push-to-main",
      workflowPath: ".github/workflows/static.yml",
    },
    recommendedChecks: [],
    compatibilityNotes: [],
    manualPrerequisites: {
      required: [
        {
          id: "static-deploy-trusted-range",
          kind: "github_actions_context",
          summary: reason,
        },
      ],
      optional: [],
    },
    consistencyIssues: [],
    remainingManualSteps: [],
    isNoop: false,
  };
}

function loadPlan(options) {
  if (!options.planJson) {
    const trustedRangeIssue = getTrustedRangeIssue(options);
    if (trustedRangeIssue) return buildUntrustedRangePlan(trustedRangeIssue, options);
    return createReleasePlanFromRepo(repoRoot, options.releaseOptions);
  }
  const raw = fs.readFileSync(path.resolve(repoRoot, options.planJson), "utf8");
  return JSON.parse(raw);
}

function summarizeList(items, formatter) {
  if (!items.length) return "none";
  return items.map(formatter).join(", ");
}

function formatPlanSource(source) {
  if (!source || typeof source !== "object") return "unknown";
  const parts = [source.mode || "unknown"];
  if (source.base) parts.push(`base=${source.base}`);
  if (source.head) parts.push(`head=${source.head}`);
  if (source.files) parts.push(`files=${source.files.length}`);
  if (source.reason) parts.push(`reason=${source.reason}`);
  return parts.join(" ");
}

function printResult(plan, result, options) {
  console.log("Static deploy safety check");
  console.log(`- Event: ${options.eventName || "local"}`);
  console.log(`- Plan source: ${formatPlanSource(plan.source)}`);
  console.log(`- Base ref: ${options.releaseOptions.base || "not set"}`);
  console.log(`- Head ref: ${options.releaseOptions.head || "not set"}`);
  console.log(`- Status: ${result.ok ? "allowed" : "blocked"}`);
  console.log(`- Mode: ${result.mode}`);
  console.log(`- Changed files: ${result.changedFiles.length}`);
  console.log(`- Static required: ${result.staticRequired ? "yes" : "no"}`);
  console.log(`- Worker deploys: ${summarizeList(result.workerDeploys, (step) => step.worker || step.id || "unknown")}`);
  console.log(`- Schema applies: ${summarizeList(result.schemaApplies, (step) => step.checkpoint || step.id || "unknown")}`);
  console.log(`- Non-static deploy steps: ${summarizeList(result.nonStaticDeploySteps, (step) => step.id || step.type || "unknown")}`);
  console.log(`- Required manual prerequisites: ${summarizeList(result.requiredManualPrerequisites, (entry) => entry.id || entry.name || entry.kind || "unknown")}`);
  if (result.bypassedByAcknowledgement) {
    console.log("- Manual acknowledgement: accepted for workflow_dispatch only; operator-owned and not a readiness claim.");
  }
  if (result.warnings.length > 0) {
    console.log("- Warnings:");
    for (const warning of result.warnings) console.log(`  - ${warning}`);
  }
  if (result.reasons.length > 0) {
    console.log("- Blocking reasons:");
    for (const reason of result.reasons) console.log(`  - ${reason}`);
  }

  if (!result.ok) {
    console.log("");
    console.log("Static Pages deploy blocked by release-plan-aware guard.");
    console.log("Run npm run release:plan and deploy affected units in release-plan order before manually dispatching or continuing static deploy.");
    console.log("Workers and remote migrations are not deployed by the GitHub Pages workflow.");
    console.log(`For workflow_dispatch only, use acknowledgement exactly: ${result.acknowledgementRequired}`);
    console.log("This acknowledgement is operator-owned; it is not production readiness, live billing readiness, or deploy approval by itself.");
    console.log("");
    console.log(formatReleasePlan(plan));
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || options.releaseOptions.help) {
    console.log(usage());
    process.exit(0);
  }
  const plan = loadPlan(options);
  const result = evaluateStaticDeploySafety(plan, {
    eventName: options.eventName,
    acknowledgement: options.acknowledgement,
  });
  printResult(plan, result, options);
  process.exit(result.ok ? 0 : 1);
} catch (error) {
  console.error("Static deploy safety check failed closed.");
  console.error(error?.message || String(error));
  console.error("Run npm run release:plan and resolve release-plan parsing or deploy-order issues before static deploy.");
  process.exit(1);
}
