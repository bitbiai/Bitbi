import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { SITE_ROOT_DIRS, SITE_ROOT_FILES } from "./asset-version.mjs";
import { loadReleaseCompatibilityContext, validateReleaseCompatibility } from "./release-compat.mjs";

const IGNORED_CHANGE_PREFIXES = [
  "_site/",
  "node_modules/",
  "playwright-report/",
  "test-results/",
  ".wrangler/",
];

const STATIC_BUILD_RELATED_FILES = new Set([
  "scripts/build-static-site.mjs",
  "scripts/lib/asset-version.mjs",
  "scripts/test-asset-version.mjs",
  "scripts/validate-asset-version.mjs",
]);

const VALIDATION_ONLY_PREFIXES = [
  ".github/workflows/",
  "config/",
  "docs/",
  "scripts/",
  "tests/",
  "workers/auth/CLAUDE.md",
  "workers/contact/CLAUDE.md",
  "workers/ai/CLAUDE.md",
];

const SHARED_WORKER_FILE_MAP = Object.freeze({
  "js/shared/admin-ai-contract.mjs": ["auth", "ai"],
  "js/shared/ai-image-models.mjs": ["auth"],
  "js/shared/durable-rate-limit-do.mjs": ["auth", "contact"],
  "js/shared/public-media-contract.mjs": ["auth"],
  "js/shared/remote-media-policy.mjs": ["auth"],
  "js/shared/request-body.mjs": ["auth", "ai", "contact"],
  "js/shared/worker-observability.mjs": ["auth", "ai", "contact"],
});

const ALWAYS_RECOMMENDED_CHECKS = Object.freeze([
  "npm run check:toolchain",
  "npm run test:quality-gates",
  "npm run check:secrets",
  "npm run check:dom-sinks",
  "npm run check:route-policies",
  "npm run test:operational-readiness",
  "npm run check:operational-readiness",
  "npm run check:live-health",
  "npm run check:live-security-headers",
  "npm run check:js",
  "npm run test:release-compat",
  "npm run validate:release",
  "npm run validate:cloudflare-prereqs",
  "npm run check:worker-body-parsers",
]);

const WORKER_RECOMMENDED_CHECKS = Object.freeze([
  "npm run test:workers",
]);

const STATIC_RECOMMENDED_CHECKS = Object.freeze([
  "npm run test:asset-version",
  "npm run validate:asset-version",
  "npm run test:static",
]);

const STATIC_DEPLOY_MESSAGE =
  "Static deploy remains manual in this flow: push or merge to main to trigger the existing GitHub Pages workflow (.github/workflows/static.yml).";

function normalizePathname(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\.?\//, "");
}

function normalizeUnique(values) {
  return [...new Set((values || []).map(normalizePathname).filter(Boolean))].sort();
}

function uniqueInOrder(values) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function getReleaseSection(context) {
  return context?.manifest?.release || {};
}

function getWorkers(context) {
  return getReleaseSection(context).workers || {};
}

function getSchemaCheckpoints(context) {
  return getReleaseSection(context).schemaCheckpoints || {};
}

function getDeployOrder(context) {
  return Array.isArray(getReleaseSection(context).deployOrder) ? getReleaseSection(context).deployOrder : [];
}

function isStaticSourcePath(relativePath) {
  const normalized = normalizePathname(relativePath);
  if (STATIC_BUILD_RELATED_FILES.has(normalized)) return true;
  if (SITE_ROOT_FILES.includes(normalized)) return true;
  return SITE_ROOT_DIRS.some((dir) => normalized === dir || normalized.startsWith(`${dir}/`));
}

function isIgnoredChange(relativePath) {
  const normalized = normalizePathname(relativePath);
  return IGNORED_CHANGE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function isValidationOnlyPath(relativePath) {
  const normalized = normalizePathname(relativePath);
  if (STATIC_BUILD_RELATED_FILES.has(normalized)) return false;
  if (isStaticSourcePath(normalized)) return false;
  return VALIDATION_ONLY_PREFIXES.some((prefix) => normalized.startsWith(prefix))
    || normalized === "package.json"
    || normalized === "package-lock.json"
    || normalized === ".nvmrc"
    || normalized === ".node-version"
    || normalized === "CLAUDE.md"
    || normalized === "README.md"
    || /^AUDIT_[A-Z0-9_]+\.md$/.test(normalized)
    || /^PHASE0[A-Z0-9_]*\.md$/.test(normalized)
    || /^PHASE1[A-Z0-9_]*\.md$/.test(normalized)
    || normalized === "AI_VIDEO_ASYNC_JOB_DESIGN.md";
}

function isWorkerPackagePath(relativePath, worker) {
  const normalized = normalizePathname(relativePath);
  return normalized === `${worker.workerDirectory}/package.json`
    || normalized === `${worker.workerDirectory}/package-lock.json`;
}

function getWorkerDirectory(workerManifest) {
  return path.dirname(workerManifest.wranglerPath);
}

function getWorkerSourceDirectory(workerManifest) {
  return `${getWorkerDirectory(workerManifest)}/src`;
}

function getWorkersUsingDatabase(context, databaseName) {
  const impacted = [];
  for (const [workerId, workerManifest] of Object.entries(getWorkers(context))) {
    const d1Bindings = workerManifest?.bindings?.d1 || {};
    const usesDatabase = Object.values(d1Bindings).some((spec) => spec?.databaseName === databaseName);
    if (usesDatabase) impacted.push(workerId);
  }
  return impacted.sort();
}

function buildUnitModel(context) {
  const workers = {};
  for (const [workerId, workerManifest] of Object.entries(getWorkers(context))) {
    workers[workerId] = {
      workerId,
      name: workerManifest.name,
      wranglerPath: workerManifest.wranglerPath,
      workerDirectory: getWorkerDirectory(workerManifest),
      sourceDirectory: getWorkerSourceDirectory(workerManifest),
      migrations: Array.isArray(workerManifest.migrations) ? workerManifest.migrations : [],
    };
  }

  const schemaCheckpoints = {};
  for (const [checkpointId, checkpointManifest] of Object.entries(getSchemaCheckpoints(context))) {
    schemaCheckpoints[checkpointId] = {
      checkpointId,
      migrationDirectory: checkpointManifest.migrationDirectory,
      latest: checkpointManifest.latest,
      databaseName: checkpointManifest.databaseName,
      workerIds: getWorkersUsingDatabase(context, checkpointManifest.databaseName),
    };
  }

  return {
    workers,
    schemaCheckpoints,
    static: {
      id: "static-site",
      roots: [...SITE_ROOT_FILES, ...SITE_ROOT_DIRS],
      workflowPath: ".github/workflows/static.yml",
      deploymentModel: "github-pages-push-to-main",
    },
  };
}

function addImpact(target, key, relativePath, reason) {
  if (!target[key]) {
    target[key] = {
      changedFiles: [],
      reasons: [],
    };
  }
  target[key].changedFiles.push(relativePath);
  if (reason) target[key].reasons.push(reason);
}

export function classifyChangedFiles(context, changedFiles) {
  const units = buildUnitModel(context);
  const impacts = {
    workers: {},
    schemaCheckpoints: {},
    static: { changedFiles: [], reasons: [] },
    validationOnlyFiles: [],
    ignoredFiles: [],
    uncategorizedFiles: [],
  };

  for (const input of normalizeUnique(changedFiles)) {
    if (isIgnoredChange(input)) {
      impacts.ignoredFiles.push(input);
      continue;
    }

    let matched = false;

    if (isStaticSourcePath(input)) {
      impacts.static.changedFiles.push(input);
      impacts.static.reasons.push("changes the GitHub Pages source/build inputs");
      matched = true;
    }

    for (const [workerId, worker] of Object.entries(units.workers)) {
      if (
        input === worker.wranglerPath ||
        input.startsWith(`${worker.sourceDirectory}/`) ||
        isWorkerPackagePath(input, worker)
      ) {
        addImpact(impacts.workers, workerId, input, "changes the worker runtime/config");
        matched = true;
      }
    }

    for (const [checkpointId, checkpoint] of Object.entries(units.schemaCheckpoints)) {
      if (
        input === checkpoint.migrationDirectory ||
        input.startsWith(`${checkpoint.migrationDirectory}/`)
      ) {
        addImpact(impacts.schemaCheckpoints, checkpointId, input, "changes a schema checkpoint migration");
        for (const workerId of checkpoint.workerIds) {
          addImpact(
            impacts.workers,
            workerId,
            input,
            `uses D1 database "${checkpoint.databaseName}" behind checkpoint "${checkpointId}"`
          );
        }
        matched = true;
      }
    }

    for (const [sharedPath, workerIds] of Object.entries(SHARED_WORKER_FILE_MAP)) {
      if (input === sharedPath) {
        for (const workerId of workerIds) {
          addImpact(impacts.workers, workerId, input, "changes a shared file imported by this worker");
        }
        matched = true;
      }
    }

    if (isValidationOnlyPath(input)) {
      impacts.validationOnlyFiles.push(input);
      matched = true;
    }

    if (!matched) {
      impacts.uncategorizedFiles.push(input);
    }
  }

  impacts.static.changedFiles = normalizeUnique(impacts.static.changedFiles);
  impacts.static.reasons = normalizeUnique(impacts.static.reasons);
  impacts.validationOnlyFiles = normalizeUnique(impacts.validationOnlyFiles);
  impacts.ignoredFiles = normalizeUnique(impacts.ignoredFiles);
  impacts.uncategorizedFiles = normalizeUnique(impacts.uncategorizedFiles);

  for (const group of Object.values(impacts.workers)) {
    group.changedFiles = normalizeUnique(group.changedFiles);
    group.reasons = normalizeUnique(group.reasons);
  }
  for (const group of Object.values(impacts.schemaCheckpoints)) {
    group.changedFiles = normalizeUnique(group.changedFiles);
    group.reasons = normalizeUnique(group.reasons);
  }

  return impacts;
}

function buildDeploySteps(context, impacts) {
  const steps = [];
  const impactedWorkerIds = new Set(Object.keys(impacts.workers));
  const impactedCheckpointIds = new Set(Object.keys(impacts.schemaCheckpoints));
  const staticRequired = impacts.static.changedFiles.length > 0;
  const deployOrder = getDeployOrder(context);
  const workers = getWorkers(context);
  const checkpoints = getSchemaCheckpoints(context);

  for (const step of deployOrder) {
    if (step.type === "schema-checkpoint" && impactedCheckpointIds.has(step.checkpoint)) {
      const checkpoint = checkpoints[step.checkpoint];
      const workerId = getWorkersUsingDatabase(context, checkpoint.databaseName)[0] || null;
      const workerManifest = workerId ? workers[workerId] : null;
      steps.push({
        id: step.id,
        type: step.type,
        checkpoint: step.checkpoint,
        databaseName: checkpoint.databaseName,
        migrationDirectory: checkpoint.migrationDirectory,
        latestMigration: checkpoint.latest,
        workerId,
        cwd: workerManifest ? getWorkerDirectory(workerManifest) : null,
        command: workerManifest
          ? ["npx", "wrangler", "d1", "migrations", "apply", checkpoint.databaseName, "--remote"]
          : null,
      });
    }

    if (step.type === "worker" && impactedWorkerIds.has(step.worker)) {
      const workerManifest = workers[step.worker];
      steps.push({
        id: step.id,
        type: step.type,
        worker: step.worker,
        workerName: workerManifest.name,
        wranglerPath: workerManifest.wranglerPath,
        cwd: workerManifest ? getWorkerDirectory(workerManifest) : null,
        command: ["npx", "wrangler", "deploy"],
        includesWranglerMigrations: Array.isArray(workerManifest?.migrations)
          ? workerManifest.migrations.map((entry) => entry.tag)
          : [],
      });
    }

    if (step.type === "static" && staticRequired) {
      steps.push({
        id: step.id,
        type: step.type,
        deploymentModel: "github-pages-push-to-main",
        workflowPath: ".github/workflows/static.yml",
        applySupported: false,
      });
    }
  }

  return steps;
}

function buildManualPrerequisites(context, impactedWorkerIds, staticRequired) {
  const entries = Array.isArray(getReleaseSection(context).manualPrerequisites)
    ? getReleaseSection(context).manualPrerequisites
    : [];
  const required = [];
  const optional = [];

  for (const entry of entries) {
    const scopedToWorker = typeof entry.worker === "string" && entry.worker.length > 0;
    const appliesToStatic = !scopedToWorker && staticRequired;
    const appliesToWorker = !scopedToWorker || impactedWorkerIds.has(entry.worker);
    if (!appliesToWorker && !appliesToStatic) continue;

    const target = entry.requiredForRelease ? required : optional;
    target.push({
      id: entry.id,
      kind: entry.kind,
      worker: entry.worker || null,
      binding: entry.binding || null,
      queue: entry.queue || null,
      name: entry.name || null,
      documentation: entry.documentation || null,
      summary: entry.summary || null,
    });
  }

  return {
    required,
    optional,
  };
}

function buildRecommendedChecks(impacts) {
  const checks = [...ALWAYS_RECOMMENDED_CHECKS];
  if (Object.keys(impacts.workers).length > 0 || Object.keys(impacts.schemaCheckpoints).length > 0) {
    checks.push(...WORKER_RECOMMENDED_CHECKS);
  }
  if (impacts.static.changedFiles.length > 0) {
    checks.push(...STATIC_RECOMMENDED_CHECKS);
  }
  return uniqueInOrder(checks);
}

function buildConsistencyIssues(context, changedFiles, impacts) {
  const issues = [];
  const workerConfigs = context.workerConfigs || {};
  const schemaCheckpoints = context.schemaCheckpoints || {};
  const normalizedFiles = normalizeUnique(changedFiles);

  for (const workerId of Object.keys(impacts.workers)) {
    if (!workerConfigs[workerId]?.exists) {
      issues.push(`Impacted worker "${workerId}" is missing its wrangler config.`);
    }
  }

  for (const checkpointId of Object.keys(impacts.schemaCheckpoints)) {
    const checkpoint = schemaCheckpoints[checkpointId];
    if (!checkpoint?.exists) {
      issues.push(`Impacted schema checkpoint "${checkpointId}" is missing migration directory "${getSchemaCheckpoints(context)[checkpointId]?.migrationDirectory}".`);
      continue;
    }
    const latest = getSchemaCheckpoints(context)[checkpointId]?.latest;
    if (latest && !checkpoint.files.includes(latest)) {
      issues.push(`Impacted schema checkpoint "${checkpointId}" is missing required migration "${latest}".`);
    }
  }

  for (const file of normalizedFiles) {
    const checkpointId = Object.keys(getSchemaCheckpoints(context)).find((id) => file.startsWith(`${getSchemaCheckpoints(context)[id].migrationDirectory}/`));
    if (checkpointId && !fs.existsSync(path.join(context.repoRoot, file))) {
      issues.push(`Changed migration file "${file}" no longer exists on disk.`);
    }
  }

  return normalizeUnique(issues);
}

export function createReleasePlan(context, { changedFiles, source = { mode: "explicit" } } = {}) {
  const normalizedFiles = normalizeUnique(changedFiles);
  const impacts = classifyChangedFiles(context, normalizedFiles);
  const deploySteps = buildDeploySteps(context, impacts);
  const impactedWorkerIds = new Set(Object.keys(impacts.workers));
  const manualPrerequisites = buildManualPrerequisites(
    context,
    impactedWorkerIds,
    impacts.static.changedFiles.length > 0
  );
  const recommendedChecks = buildRecommendedChecks(impacts);
  const consistencyIssues = buildConsistencyIssues(context, normalizedFiles, impacts);

  return {
    source,
    changedFiles: normalizedFiles,
    impacts: {
      workers: Object.fromEntries(
        Object.entries(impacts.workers).map(([workerId, data]) => [
          workerId,
          {
            workerName: getWorkers(context)[workerId]?.name || workerId,
            ...data,
          },
        ])
      ),
      schemaCheckpoints: Object.fromEntries(
        Object.entries(impacts.schemaCheckpoints).map(([checkpointId, data]) => [
          checkpointId,
          {
            databaseName: getSchemaCheckpoints(context)[checkpointId]?.databaseName || null,
            latestMigration: getSchemaCheckpoints(context)[checkpointId]?.latest || null,
            ...data,
          },
        ])
      ),
      static: {
        required: impacts.static.changedFiles.length > 0,
        deploymentModel: "github-pages-push-to-main",
        workflowPath: ".github/workflows/static.yml",
        changedFiles: impacts.static.changedFiles,
        reasons: impacts.static.reasons,
      },
      validationOnlyFiles: impacts.validationOnlyFiles,
      ignoredFiles: impacts.ignoredFiles,
      uncategorizedFiles: impacts.uncategorizedFiles,
    },
    deploySteps,
    workerDeploys: deploySteps.filter((step) => step.type === "worker"),
    schemaApplies: deploySteps.filter((step) => step.type === "schema-checkpoint"),
    staticDeploy: deploySteps.find((step) => step.type === "static") || {
      id: "static-site",
      type: "static",
      applySupported: false,
      required: false,
      deploymentModel: "github-pages-push-to-main",
      workflowPath: ".github/workflows/static.yml",
    },
    recommendedChecks,
    manualPrerequisites,
    consistencyIssues,
    remainingManualSteps: [
      ...(impacts.static.changedFiles.length > 0 ? [STATIC_DEPLOY_MESSAGE] : []),
      ...manualPrerequisites.required.map((entry) => `Manual prerequisite: ${entry.id} — ${entry.summary}`),
    ],
    isNoop:
      normalizedFiles.length === 0 ||
      (
        deploySteps.length === 0 &&
        impacts.validationOnlyFiles.length === normalizedFiles.length &&
        impacts.uncategorizedFiles.length === 0
      ),
  };
}

function runShellCommand(command, { cwd = null, execute = false } = {}) {
  const pretty = cwd ? `(cd ${cwd} && ${command.join(" ")})` : command.join(" ");
  if (!execute) {
    return {
      ok: true,
      dryRun: true,
      pretty,
      command,
      cwd,
      code: 0,
    };
  }

  const result = spawnSync(command[0], command.slice(1), {
    cwd,
    stdio: "inherit",
  });

  return {
    ok: result.status === 0,
    dryRun: false,
    pretty,
    command,
    cwd,
    code: result.status ?? 1,
  };
}

function buildSourceLabel(source) {
  if (source?.mode === "explicit") return "explicit file list";
  if (source?.mode === "git-diff") {
    return source.head ? `git diff ${source.base}...${source.head}` : `git diff ${source.base}...HEAD`;
  }
  if (source?.mode === "git-status") return "working tree diff vs HEAD";
  return source?.mode || "unknown";
}

export function formatReleasePlan(plan) {
  const lines = [];
  lines.push("Release plan");
  lines.push(`- Changed-file source: ${buildSourceLabel(plan.source)}`);
  lines.push(`- Changed files: ${plan.changedFiles.length}`);

  if (plan.changedFiles.length > 0) {
    for (const file of plan.changedFiles) {
      lines.push(`  - ${file}`);
    }
  }

  const impactedWorkers = Object.keys(plan.impacts.workers);
  const impactedCheckpoints = Object.keys(plan.impacts.schemaCheckpoints);
  lines.push("- Impacted deploy units:");
  if (impactedCheckpoints.length === 0 && impactedWorkers.length === 0 && !plan.impacts.static.required) {
    lines.push("  - none");
  } else {
    for (const checkpointId of impactedCheckpoints) {
      const data = plan.impacts.schemaCheckpoints[checkpointId];
      lines.push(`  - schema checkpoint ${checkpointId} (${data.latestMigration})`);
    }
    for (const workerId of impactedWorkers) {
      lines.push(`  - worker ${workerId} (${plan.impacts.workers[workerId].workerName})`);
    }
    if (plan.impacts.static.required) {
      lines.push("  - static/pages deploy");
    }
  }

  if (plan.impacts.validationOnlyFiles.length > 0) {
    lines.push("- Validation-only changes:");
    for (const file of plan.impacts.validationOnlyFiles) {
      lines.push(`  - ${file}`);
    }
  }

  if (plan.impacts.uncategorizedFiles.length > 0) {
    lines.push("- Uncategorized changes:");
    for (const file of plan.impacts.uncategorizedFiles) {
      lines.push(`  - ${file}`);
    }
  }

  lines.push("- Recommended checks:");
  for (const check of plan.recommendedChecks) {
    lines.push(`  - ${check}`);
  }

  lines.push("- Deploy order:");
  if (plan.deploySteps.length === 0) {
    lines.push("  - no runtime deploy steps required");
  } else {
    for (const step of plan.deploySteps) {
      if (step.type === "schema-checkpoint") {
        lines.push(`  - ${step.id}: apply D1 migrations for ${step.databaseName}`);
      } else if (step.type === "worker") {
        const migrationNote = step.includesWranglerMigrations?.length
          ? ` (wrangler migrations included: ${step.includesWranglerMigrations.join(", ")})`
          : "";
        lines.push(`  - ${step.id}: deploy worker ${step.worker}${migrationNote}`);
      } else if (step.type === "static") {
        lines.push(`  - ${step.id}: ${STATIC_DEPLOY_MESSAGE}`);
      }
    }
  }

  if (plan.manualPrerequisites.required.length > 0 || plan.manualPrerequisites.optional.length > 0) {
    lines.push("- Manual prerequisites:");
    for (const entry of plan.manualPrerequisites.required) {
      lines.push(`  - required: ${entry.id} — ${entry.summary}`);
    }
    for (const entry of plan.manualPrerequisites.optional) {
      lines.push(`  - optional: ${entry.id} — ${entry.summary}`);
    }
  }

  if (plan.consistencyIssues.length > 0) {
    lines.push("- Plan consistency issues:");
    for (const issue of plan.consistencyIssues) {
      lines.push(`  - ${issue}`);
    }
  }

  return lines.join("\n");
}

export function parseReleaseCliArgs(argv) {
  const options = {
    execute: false,
    jsonOnly: false,
    base: null,
    head: null,
    files: [],
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--execute") {
      options.execute = true;
      continue;
    }
    if (arg === "--json" || arg === "--json-only") {
      options.jsonOnly = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--base") {
      options.base = argv[index + 1] || null;
      index += 1;
      continue;
    }
    if (arg === "--head") {
      options.head = argv[index + 1] || null;
      index += 1;
      continue;
    }
    if (arg === "--file") {
      options.files.push(argv[index + 1] || "");
      index += 1;
      continue;
    }
    if (arg === "--files") {
      const value = argv[index + 1] || "";
      options.files.push(...value.split(","));
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  options.files = normalizeUnique(options.files);
  return options;
}

export function formatReleaseUsage(commandName) {
  return [
    `${commandName} [--file <path>] [--files a,b,c] [--base <git-ref>] [--head <git-ref>] [--json] [--execute]`,
    "",
    "Examples:",
    `  ${commandName} --file workers/auth/src/index.js`,
    `  ${commandName} --base origin/main --head HEAD`,
    `  ${commandName} --files workers/auth/src/index.js,js/pages/admin/main.js`,
  ].join("\n");
}

function runGit(args, { cwd }) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `git ${args.join(" ")} failed`);
  }
  return result.stdout || "";
}

export function resolveChangedFiles(repoRoot, options = {}) {
  if (Array.isArray(options.files) && options.files.length > 0) {
    return {
      source: {
        mode: "explicit",
        files: normalizeUnique(options.files),
      },
      changedFiles: normalizeUnique(options.files),
    };
  }

  if (options.base) {
    const diffArgs = ["diff", "--name-only", options.head ? `${options.base}...${options.head}` : `${options.base}...HEAD`, "--"];
    const output = runGit(diffArgs, { cwd: repoRoot });
    return {
      source: {
        mode: "git-diff",
        base: options.base,
        head: options.head || null,
      },
      changedFiles: normalizeUnique(output.split("\n")),
    };
  }

  const changed = new Set();

  for (const line of runGit(["diff", "--name-only", "HEAD", "--"], { cwd: repoRoot }).split("\n")) {
    if (line.trim()) changed.add(normalizePathname(line));
  }
  for (const line of runGit(["ls-files", "--others", "--exclude-standard"], { cwd: repoRoot }).split("\n")) {
    if (line.trim()) changed.add(normalizePathname(line));
  }

  return {
    source: { mode: "git-status" },
    changedFiles: [...changed].sort(),
  };
}

export function createReleasePlanFromRepo(repoRoot, options = {}) {
  const context = loadReleaseCompatibilityContext(repoRoot);
  context.repoRoot = repoRoot;
  const { source, changedFiles } = resolveChangedFiles(repoRoot, options);
  return createReleasePlan(context, { changedFiles, source });
}

export function validateReleasePlan(plan, context) {
  const issues = [...validateReleaseCompatibility(context), ...plan.consistencyIssues];
  if (plan.impacts.uncategorizedFiles.length > 0) {
    issues.push(`Release planner found uncategorized changed files: ${plan.impacts.uncategorizedFiles.join(", ")}.`);
  }
  return normalizeUnique(issues);
}

export function buildPreflightCommands(plan) {
  return plan.recommendedChecks.map((commandString) => {
    const parts = commandString.split(" ");
    return {
      label: commandString,
      cwd: null,
      command: parts,
    };
  });
}

export function buildApplyCommands(plan) {
  return plan.deploySteps
    .filter((step) => step.type === "schema-checkpoint" || step.type === "worker")
    .map((step) => ({
      label:
        step.type === "schema-checkpoint"
          ? `Apply ${step.checkpoint} migrations`
          : `Deploy ${step.worker} worker`,
      cwd: step.cwd,
      command: step.command,
      step,
    }));
}

export function runReleasePreflight(repoRoot, options = {}, deps = {}) {
  const context = loadReleaseCompatibilityContext(repoRoot);
  context.repoRoot = repoRoot;
  const { source, changedFiles } = resolveChangedFiles(repoRoot, options);
  const plan = createReleasePlan(context, { changedFiles, source });
  const issues = validateReleasePlan(plan, context);
  if (issues.length > 0) {
    return {
      ok: false,
      plan,
      issues,
      commands: [],
      executions: [],
    };
  }

  const runCommand = deps.runCommand || runShellCommand;
  const commands = buildPreflightCommands(plan);
  const executions = [];
  for (const command of commands) {
    const result = runCommand(command.command, {
      cwd: command.cwd,
      execute: true,
    });
    executions.push({
      ...command,
      ...result,
    });
    if (!result.ok) {
      return {
        ok: false,
        plan,
        issues: [`Preflight command failed: ${command.label}`],
        commands,
        executions,
      };
    }
  }

  return {
    ok: true,
    plan,
    issues: [],
    commands,
    executions,
  };
}

export function runReleaseApply(repoRoot, options = {}, deps = {}) {
  const context = loadReleaseCompatibilityContext(repoRoot);
  context.repoRoot = repoRoot;
  const { source, changedFiles } = resolveChangedFiles(repoRoot, options);
  const plan = createReleasePlan(context, { changedFiles, source });
  const issues = validateReleasePlan(plan, context);
  if (issues.length > 0) {
    return {
      ok: false,
      dryRun: !options.execute,
      plan,
      issues,
      preflight: null,
      commands: [],
      executions: [],
    };
  }

  const runCommand = deps.runCommand || runShellCommand;
  const commands = buildApplyCommands(plan);

  if (!options.execute) {
    const executions = commands.map((command) => ({
      ...command,
      ...runCommand(command.command, { cwd: command.cwd, execute: false }),
    }));
    return {
      ok: true,
      dryRun: true,
      plan,
      issues: [],
      preflight: null,
      commands,
      executions,
    };
  }

  const preflight = runReleasePreflight(repoRoot, options, deps);
  if (!preflight.ok) {
    return {
      ok: false,
      dryRun: false,
      plan,
      issues: preflight.issues,
      preflight,
      commands,
      executions: [],
    };
  }

  const executions = [];
  for (const command of commands) {
    const result = runCommand(command.command, {
      cwd: command.cwd,
      execute: true,
    });
    executions.push({
      ...command,
      ...result,
    });
    if (!result.ok) {
      return {
        ok: false,
        dryRun: false,
        plan,
        issues: [`Apply command failed: ${command.label}`],
        preflight,
        commands,
        executions,
      };
    }
  }

  return {
    ok: true,
    dryRun: false,
    plan,
    issues: [],
    preflight,
    commands,
    executions,
  };
}
