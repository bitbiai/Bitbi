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
  "github-actions-stuck-evidence/",
  "scripts/",
  "tests/",
  "workers/auth/CLAUDE.md",
  "workers/contact/CLAUDE.md",
  "workers/ai/CLAUDE.md",
];

const SHARED_WORKER_FILE_MAP = Object.freeze({
  "workers/shared/ai-caller-policy.mjs": ["auth", "ai"],
  "workers/shared/fable-chat-contract.mjs": ["auth", "ai"],
  "js/shared/admin-ai-contract.mjs": ["auth", "ai"],
  "js/shared/ai-image-models.mjs": ["auth"],
  "js/shared/durable-rate-limit-do.mjs": ["auth", "contact"],
  "js/shared/generation-timeout.mjs": ["auth", "ai"],
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
  "npm run test:live-canary",
  "npm run check:js",
  "npm run test:release-compat",
  "npm run validate:release",
  "npm run validate:cloudflare-prereqs",
  "npm run test:cloudflare-resource-model",
  "npm run test:readiness-dossier",
  "npm run test:rollback-drill",
  "npm run test:release-rc",
  "npm run test:rc-check",
  "npm run rc:check",
  "npm run release:rc",
  "npm run check:worker-body-parsers",
  "npm run check:admin-activity-query-shape",
  "npm run check:data-lifecycle",
  "npm run test:doc-currentness",
  "npm run check:doc-currentness",
  "npm run test:readiness-evidence",
  "npm run test:main-release-readiness",
  "npm run test:ai-cost-gateway",
  "npm run test:ai-cost-operations",
  "npm run test:admin-platform-budget-policy",
  "npm run test:admin-platform-budget-evidence",
  "npm run check:ai-cost-policy",
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

export const STATIC_DEPLOY_DEPENDENCY_ACKNOWLEDGEMENT = "I_CONFIRM_RELEASE_PLAN_DEPENDENCIES_HANDLED";

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

function getServices(context) {
  const services = getReleaseSection(context).services;
  return services && typeof services === "object" && !Array.isArray(services) ? services : {};
}

function getSchemaCheckpoints(context) {
  return getReleaseSection(context).schemaCheckpoints || {};
}

function getDeployOrder(context) {
  return Array.isArray(getReleaseSection(context).deployOrder) ? getReleaseSection(context).deployOrder : [];
}

function getAuthAiCallerPolicyContract(context) {
  const contract = getReleaseSection(context).authAiCallerPolicy;
  return contract && typeof contract === "object" && !Array.isArray(contract) ? contract : null;
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
    || normalized === "playwright.config.js"
    || normalized === "playwright.workers.config.js"
    || normalized === ".nvmrc"
    || normalized === ".node-version"
    || normalized === ".gitignore"
    || normalized === "AGENTS.md"
    || normalized === "CLAUDE.md"
    || normalized === "README.md"
    || /^ALPHA_AUDIT_[0-9_]+\.md$/.test(normalized)
    || /^AUDIT_[A-Z0-9_]+\.md$/.test(normalized)
    || /^CURRENT_[A-Z0-9_]+\.md$/.test(normalized)
    || /^DATA_[A-Z0-9_]+\.md$/.test(normalized)
    || /^PHASE0[A-Z0-9_]*\.md$/.test(normalized)
    || /^PHASE1[A-Z0-9_]*\.md$/.test(normalized)
    || /^PHASE2[A-Z0-9_]*\.md$/.test(normalized)
    || /^PHASE_ADMIN[A-Z0-9_]*\.md$/.test(normalized)
    || /^PHASE_MEMBER[A-Z0-9_]*\.md$/.test(normalized)
    || /^PHASE_PRICING[A-Z0-9_]*\.md$/.test(normalized)
    || /^SAAS_[A-Z0-9_]+\.md$/.test(normalized)
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

  const services = {};
  for (const [serviceId, serviceManifest] of Object.entries(getServices(context))) {
    services[serviceId] = {
      serviceId,
      name: serviceManifest.name || serviceId,
      type: serviceManifest.type || "service",
      path: normalizePathname(serviceManifest.path || ""),
      documentation: serviceManifest.documentation || null,
      summary: serviceManifest.summary || null,
    };
  }

  return {
    workers,
    services,
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
    services: {},
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

    for (const [serviceId, service] of Object.entries(units.services)) {
      if (service.path && (input === service.path || input.startsWith(`${service.path}/`))) {
        addImpact(impacts.services, serviceId, input, "changes a non-static processor/service deploy unit");
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
  for (const group of Object.values(impacts.services)) {
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
  const impactedServiceIds = new Set(Object.keys(impacts.services));
  const impactedCheckpointIds = new Set(Object.keys(impacts.schemaCheckpoints));
  const staticRequired = impacts.static.changedFiles.length > 0;
  const deployOrder = getDeployOrder(context);
  const workers = getWorkers(context);
  const services = getServices(context);
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

    if (step.type === "service" && impactedServiceIds.has(step.service)) {
      const serviceManifest = services[step.service] || {};
      steps.push({
        id: step.id,
        type: step.type,
        service: step.service,
        serviceName: serviceManifest.name || step.service,
        serviceType: serviceManifest.type || "service",
        path: normalizePathname(serviceManifest.path || ""),
        documentation: serviceManifest.documentation || null,
        summary: serviceManifest.summary || null,
        command: null,
        applySupported: false,
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

function buildCompatibilityNotes(context, changedFiles, impacts) {
  const notes = [];
  const normalizedFiles = new Set(normalizeUnique(changedFiles));
  const contract = getAuthAiCallerPolicyContract(context);
  if (!contract) return notes;

  const contractFiles = new Set([
    "config/release-compat.json",
    contract.sharedPolicyFile,
    contract.aiPolicyFile,
    contract.authProxyFile,
  ].filter(Boolean));
  for (const route of contract.routes || []) {
    for (const source of route?.authSources || []) {
      if (source?.sourceFile) contractFiles.add(source.sourceFile);
    }
  }

  const changedContractFiles = [...contractFiles].filter((file) => normalizedFiles.has(file));
  const authAiWorkersImpacted = Boolean(impacts.workers.auth && impacts.workers.ai);
  if (changedContractFiles.length > 0 || authAiWorkersImpacted) {
    notes.push(
      "Auth/AI caller-policy compatibility: provider-cost internal AI route changes are paired; deploy AI Worker before Auth Worker and keep auth-worker dependent on ai-worker."
    );
  }

  return normalizeUnique(notes);
}

export function createReleasePlan(context, { changedFiles, source = { mode: "explicit" } } = {}) {
  const normalizedFiles = normalizeUnique(changedFiles);
  const impacts = classifyChangedFiles(context, normalizedFiles);
  const deploySteps = buildDeploySteps(context, impacts);
  const impactedWorkerIds = new Set(Object.keys(impacts.workers));
  const impactedServiceIds = new Set(Object.keys(impacts.services));
  const manualPrerequisites = buildManualPrerequisites(
    context,
    impactedWorkerIds,
    impacts.static.changedFiles.length > 0
  );
  const recommendedChecks = buildRecommendedChecks(impacts);
  const consistencyIssues = buildConsistencyIssues(context, normalizedFiles, impacts);
  const compatibilityNotes = buildCompatibilityNotes(context, normalizedFiles, impacts);

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
      services: Object.fromEntries(
        Object.entries(impacts.services).map(([serviceId, data]) => [
          serviceId,
          {
            serviceName: getServices(context)[serviceId]?.name || serviceId,
            serviceType: getServices(context)[serviceId]?.type || "service",
            path: normalizePathname(getServices(context)[serviceId]?.path || ""),
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
    compatibilityNotes,
    manualPrerequisites,
    consistencyIssues,
    remainingManualSteps: [
      ...(impacts.static.changedFiles.length > 0 ? [STATIC_DEPLOY_MESSAGE] : []),
      ...[...impactedServiceIds].map((serviceId) => {
        const service = getServices(context)[serviceId] || {};
        return `Deploy service: ${service.name || serviceId} — ${service.summary || "non-static processor/service deploy unit"}`;
      }),
      ...compatibilityNotes,
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
  const impactedServices = Object.keys(plan.impacts.services || {});
  const impactedCheckpoints = Object.keys(plan.impacts.schemaCheckpoints);
  lines.push("- Impacted deploy units:");
  if (
    impactedCheckpoints.length === 0 &&
    impactedWorkers.length === 0 &&
    impactedServices.length === 0 &&
    !plan.impacts.static.required
  ) {
    lines.push("  - none");
  } else {
    for (const checkpointId of impactedCheckpoints) {
      const data = plan.impacts.schemaCheckpoints[checkpointId];
      lines.push(`  - schema checkpoint ${checkpointId} (${data.latestMigration})`);
    }
    for (const workerId of impactedWorkers) {
      lines.push(`  - worker ${workerId} (${plan.impacts.workers[workerId].workerName})`);
    }
    for (const serviceId of impactedServices) {
      const service = plan.impacts.services[serviceId];
      lines.push(`  - service ${serviceId} (${service.serviceName || service.serviceType || "service"})`);
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
      } else if (step.type === "service") {
        lines.push(`  - ${step.id}: deploy service ${step.service}`);
      } else if (step.type === "static") {
        lines.push(`  - ${step.id}: ${STATIC_DEPLOY_MESSAGE}`);
      }
    }
  }

  if (plan.compatibilityNotes.length > 0) {
    lines.push("- Compatibility notes:");
    for (const note of plan.compatibilityNotes) {
      lines.push(`  - ${note}`);
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

export function evaluateStaticDeploySafety(plan, {
  eventName = "",
  acknowledgement = "",
} = {}) {
  const reasons = [];
  const warnings = [];
  const workflowEvent = String(eventName || "").trim();
  const normalizedAcknowledgement = String(acknowledgement || "").trim();
  const malformed = !plan || typeof plan !== "object" || Array.isArray(plan);

  if (malformed) {
    return {
      ok: false,
      allowed: false,
      mode: "blocked",
      failClosed: true,
      bypassedByAcknowledgement: false,
      acknowledgementAccepted: false,
      acknowledgementRequired: STATIC_DEPLOY_DEPENDENCY_ACKNOWLEDGEMENT,
      reasons: ["Release plan could not be parsed as an object."],
      warnings,
      changedFiles: [],
      staticRequired: false,
      workerDeploys: [],
      schemaApplies: [],
      nonStaticDeploySteps: [],
      requiredManualPrerequisites: [],
    };
  }

  const changedFiles = Array.isArray(plan.changedFiles) ? plan.changedFiles : [];
  const deploySteps = Array.isArray(plan.deploySteps) ? plan.deploySteps : [];
  const workerDeploys = Array.isArray(plan.workerDeploys) ? plan.workerDeploys : [];
  const schemaApplies = Array.isArray(plan.schemaApplies) ? plan.schemaApplies : [];
  const impacts = plan.impacts && typeof plan.impacts === "object" ? plan.impacts : {};
  const staticRequired = impacts.static?.required === true || deploySteps.some((step) => step?.type === "static");
  const impactedWorkers = Object.keys(impacts.workers || {});
  const impactedServices = Object.keys(impacts.services || {});
  const impactedCheckpoints = Object.keys(impacts.schemaCheckpoints || {});
  const uncategorizedFiles = Array.isArray(impacts.uncategorizedFiles) ? impacts.uncategorizedFiles : [];
  const validationOnlyFiles = Array.isArray(impacts.validationOnlyFiles) ? impacts.validationOnlyFiles : [];
  const ignoredFiles = Array.isArray(impacts.ignoredFiles) ? impacts.ignoredFiles : [];
  const consistencyIssues = Array.isArray(plan.consistencyIssues) ? plan.consistencyIssues : [];
  const requiredManualPrerequisites = Array.isArray(plan.manualPrerequisites?.required)
    ? plan.manualPrerequisites.required
    : [];
  const serviceDeploys = deploySteps.filter((step) => step?.type === "service");
  const nonStaticDeploySteps = deploySteps.filter((step) => step?.type !== "static");
  const staticDeploySteps = deploySteps.filter((step) => step?.type === "static");
  const missingCoreFields = !plan.impacts || !Array.isArray(plan.deploySteps);

  if (missingCoreFields) {
    reasons.push("Release plan is missing required deploy impact fields.");
  }
  if (uncategorizedFiles.length > 0) {
    reasons.push(`Release plan has uncategorized changed files: ${uncategorizedFiles.join(", ")}.`);
  }
  if (consistencyIssues.length > 0) {
    reasons.push(`Release plan has consistency issues: ${consistencyIssues.join("; ")}.`);
  }

  const runtimeReasons = [];
  if (workerDeploys.length > 0 || impactedWorkers.length > 0) {
    runtimeReasons.push(`Worker deploys are required: ${(workerDeploys.map((step) => step.worker || step.id).filter(Boolean).join(", ") || impactedWorkers.join(", "))}.`);
  }
  if (serviceDeploys.length > 0 || impactedServices.length > 0) {
    runtimeReasons.push(`Service deploys are required: ${(serviceDeploys.map((step) => step.service || step.id).filter(Boolean).join(", ") || impactedServices.join(", "))}.`);
  }
  if (schemaApplies.length > 0 || impactedCheckpoints.length > 0) {
    runtimeReasons.push(`Schema applies are required: ${(schemaApplies.map((step) => step.checkpoint || step.id).filter(Boolean).join(", ") || impactedCheckpoints.join(", "))}.`);
  }
  if (nonStaticDeploySteps.length > 0) {
    runtimeReasons.push(`Non-static deploy steps are present: ${nonStaticDeploySteps.map((step) => step.id || step.type || "unknown").join(", ")}.`);
  }
  if (requiredManualPrerequisites.length > 0) {
    runtimeReasons.push(`Required manual prerequisites are present: ${requiredManualPrerequisites.map((entry) => entry.id || entry.name || entry.kind).join(", ")}.`);
  }
  reasons.push(...runtimeReasons);

  const relevantChangedFiles = changedFiles.filter((file) => !ignoredFiles.includes(file));
  const noRuntimeOrPlanBlockers =
    workerDeploys.length === 0 &&
    schemaApplies.length === 0 &&
    nonStaticDeploySteps.length === 0 &&
    requiredManualPrerequisites.length === 0 &&
    uncategorizedFiles.length === 0 &&
    consistencyIssues.length === 0 &&
    impactedWorkers.length === 0 &&
    impactedServices.length === 0 &&
    impactedCheckpoints.length === 0;
  const validationOnly =
    !missingCoreFields &&
    !staticRequired &&
    noRuntimeOrPlanBlockers &&
    (
      relevantChangedFiles.length === 0 ||
      validationOnlyFiles.length === relevantChangedFiles.length
    );
  const staticOnly =
    !missingCoreFields &&
    staticRequired &&
    staticDeploySteps.length > 0 &&
    noRuntimeOrPlanBlockers;

  const acknowledgementAccepted =
    workflowEvent === "workflow_dispatch" &&
    normalizedAcknowledgement === STATIC_DEPLOY_DEPENDENCY_ACKNOWLEDGEMENT;
  const acknowledgementEligible =
    acknowledgementAccepted &&
    !missingCoreFields &&
    uncategorizedFiles.length === 0 &&
    consistencyIssues.length === 0 &&
    runtimeReasons.length > 0;
  const pushSkipEligible =
    workflowEvent === "push" &&
    !missingCoreFields &&
    plan.source?.mode !== "untrusted-ci-context" &&
    uncategorizedFiles.length === 0 &&
    consistencyIssues.length === 0 &&
    runtimeReasons.length > 0;

  let mode = "blocked";
  let allowed = false;
  let bypassedByAcknowledgement = false;
  let skipped = false;

  if (validationOnly) {
    mode = "validation_only";
    allowed = true;
  } else if (staticOnly) {
    mode = "static_only";
    allowed = true;
  } else if (acknowledgementEligible) {
    mode = "workflow_dispatch_acknowledged";
    allowed = true;
    bypassedByAcknowledgement = true;
    warnings.push("Manual workflow_dispatch acknowledgement accepted. This records operator ownership only and does not prove production readiness.");
  } else if (pushSkipEligible) {
    mode = "push_skipped_non_static_dependencies";
    skipped = true;
    warnings.push("Static deploy skipped because release plan requires non-static deploy steps first.");
  }

  if (!allowed && !skipped && reasons.length === 0) {
    reasons.push("Release plan is neither validation-only nor static-only.");
  }
  const decision = allowed ? "allowed" : skipped ? "skipped" : "blocked";

  return {
    ok: allowed,
    allowed,
    skipped,
    decision,
    mode,
    failClosed: decision === "blocked",
    bypassedByAcknowledgement,
    acknowledgementAccepted,
    acknowledgementRequired: STATIC_DEPLOY_DEPENDENCY_ACKNOWLEDGEMENT,
    reasons: normalizeUnique(reasons),
    warnings,
    changedFiles,
    staticRequired,
    workerDeploys,
    serviceDeploys,
    schemaApplies,
    nonStaticDeploySteps,
    requiredManualPrerequisites,
  };
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
