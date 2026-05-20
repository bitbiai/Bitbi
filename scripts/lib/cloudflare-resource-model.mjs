import fs from "node:fs";
import path from "node:path";
import { loadReleaseCompatibilityContext, validateReleaseCompatibility } from "./release-compat.mjs";

export const CLOUDFLARE_RESOURCE_MODEL_VERSION = "current-baseline-cloudflare-resource-model-v1";

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeString(value) {
  return typeof value === "string" ? value : "";
}

function makeResource({
  id,
  className,
  label,
  worker = null,
  repoDeclared = true,
  repoValidated = false,
  liveVerificationRequired = true,
  optionalFailClosed = false,
  dashboardManaged = false,
  blockedPending = true,
  status = "pending",
  message = "",
  expected = null,
  actual = null,
  evidence = null,
}) {
  const classifications = [];
  if (repoDeclared) classifications.push("repo-declared");
  if (repoValidated) classifications.push("repo-validated");
  if (liveVerificationRequired) classifications.push("live-verification-required");
  if (optionalFailClosed) classifications.push("optional/fail-closed");
  if (dashboardManaged) classifications.push("dashboard-managed");
  if (blockedPending) classifications.push("blocked/pending");
  return {
    id,
    class: className,
    label,
    worker,
    status,
    classifications,
    repoDeclared,
    repoValidated,
    liveVerificationRequired,
    optionalFailClosed,
    dashboardManaged,
    blockedPending,
    message,
    expected,
    actual,
    evidence,
  };
}

function addIssue(issues, resource, severity = "error") {
  issues.push({
    id: resource.id,
    severity,
    message: resource.message,
    class: resource.class,
    worker: resource.worker,
  });
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function findByName(rows, name) {
  return normalizeArray(rows).find((entry) => entry?.name === name || entry?.binding === name) || null;
}

function findByQueue(rows, queueName) {
  return normalizeArray(rows).find((entry) => entry?.queue === queueName) || null;
}

function findMigration(rows, tag) {
  return normalizeArray(rows).find((entry) => entry?.tag === tag) || null;
}

function routeMatches(actual, expected) {
  if (!isObject(actual) || !isObject(expected)) return false;
  return Object.entries(expected).every(([key, value]) => actual[key] === value);
}

function addPassFail(resources, issues, spec) {
  const resource = makeResource(spec);
  resources.push(resource);
  if (resource.status === "drift" || resource.status === "missing") {
    addIssue(issues, resource);
  }
  return resource;
}

function addWorkerResources(resources, issues, workerId, workerManifest, workerConfig) {
  const wrangler = workerConfig?.wrangler || {};
  addPassFail(resources, issues, {
    id: `worker:${workerId}`,
    className: "worker",
    label: workerManifest.name,
    worker: workerId,
    repoValidated: wrangler.name === workerManifest.name,
    status: wrangler.name === workerManifest.name ? "repo_validated" : "drift",
    message: wrangler.name === workerManifest.name
      ? `Worker ${workerId} name is aligned in release-compat and Wrangler.`
      : `Worker ${workerId} name drift: release-compat expects ${workerManifest.name}, Wrangler has ${wrangler.name || "(missing)"}.`,
    expected: { name: workerManifest.name, wranglerPath: workerManifest.wranglerPath },
    actual: { name: wrangler.name || null, wranglerPath: workerConfig?.wranglerPath || null },
  });

  if ("workersDev" in workerManifest || "previewUrls" in workerManifest) {
    for (const [manifestKey, wranglerKey] of [["workersDev", "workers_dev"], ["previewUrls", "preview_urls"]]) {
      if (!(manifestKey in workerManifest)) continue;
      const expected = workerManifest[manifestKey];
      const actual = wrangler[wranglerKey];
      addPassFail(resources, issues, {
        id: `worker:${workerId}:${manifestKey}`,
        className: "worker_deploy_surface",
        label: `${workerManifest.name} ${manifestKey}`,
        worker: workerId,
        repoValidated: actual === expected,
        status: actual === expected ? "repo_validated" : "drift",
        message: actual === expected
          ? `${workerManifest.name} ${manifestKey} is aligned.`
          : `${workerManifest.name} ${manifestKey} drift: expected ${expected}, got ${actual}.`,
        expected,
        actual,
      });
    }
  }

  for (const route of normalizeArray(workerManifest.routes)) {
    const matched = normalizeArray(wrangler.routes).some((entry) => routeMatches(entry, route));
    addPassFail(resources, issues, {
      id: `route:${workerId}:${route.pattern}`,
      className: "route",
      label: route.pattern,
      worker: workerId,
      repoValidated: matched,
      status: matched ? "repo_validated" : "drift",
      message: matched
        ? `Route ${route.pattern} is aligned in release-compat and Wrangler.`
        : `Route ${route.pattern} is missing or drifted in ${workerManifest.wranglerPath}.`,
      expected: route,
      actual: normalizeArray(wrangler.routes),
    });
  }

  for (const varName of normalizeArray(workerManifest.vars)) {
    const expected = workerManifest.expectedVars?.[varName];
    const actual = wrangler.vars?.[varName];
    addPassFail(resources, issues, {
      id: `var:${workerId}:${varName}`,
      className: "worker_var",
      label: varName,
      worker: workerId,
      repoValidated: expected === undefined ? actual !== undefined : actual === expected,
      liveVerificationRequired: false,
      blockedPending: false,
      status: expected === undefined ? (actual !== undefined ? "repo_validated" : "missing") : (actual === expected ? "repo_validated" : "drift"),
      message: expected === undefined
        ? `${varName} is declared in Wrangler.`
        : `${varName} expected repo value is ${actual === expected ? "aligned" : "drifted"}.`,
      expected: expected ?? "present",
      actual: actual === undefined ? null : actual,
    });
  }
}

function addBindingResources(resources, issues, workerId, workerManifest, workerConfig) {
  const wrangler = workerConfig?.wrangler || {};
  const bindings = workerManifest.bindings || {};

  if (bindings.ai) {
    const actual = wrangler.ai?.binding || null;
    addPassFail(resources, issues, {
      id: `binding:${workerId}:ai:${bindings.ai}`,
      className: "workers_ai",
      label: bindings.ai,
      worker: workerId,
      repoValidated: actual === bindings.ai,
      status: actual === bindings.ai ? "repo_validated" : "missing",
      message: actual === bindings.ai ? `${workerId} Workers AI binding is declared.` : `${workerId} is missing Workers AI binding ${bindings.ai}.`,
      expected: bindings.ai,
      actual,
    });
  }

  if (bindings.images) {
    const actual = wrangler.images?.binding || null;
    addPassFail(resources, issues, {
      id: `binding:${workerId}:images:${bindings.images}`,
      className: "cloudflare_images",
      label: bindings.images,
      worker: workerId,
      repoValidated: actual === bindings.images,
      status: actual === bindings.images ? "repo_validated" : "missing",
      message: actual === bindings.images ? `${workerId} Cloudflare Images binding is declared.` : `${workerId} is missing Images binding ${bindings.images}.`,
      expected: bindings.images,
      actual,
    });
  }

  for (const [binding, spec] of Object.entries(bindings.d1 || {})) {
    const actual = findByName(wrangler.d1_databases, binding);
    const valid = actual?.database_name === spec.databaseName;
    addPassFail(resources, issues, {
      id: `binding:${workerId}:d1:${binding}`,
      className: "d1",
      label: binding,
      worker: workerId,
      repoValidated: valid,
      status: valid ? "repo_validated" : "missing",
      message: valid ? `D1 ${binding} is aligned to ${spec.databaseName}.` : `D1 ${binding} is missing or not aligned to ${spec.databaseName}.`,
      expected: { binding, databaseName: spec.databaseName },
      actual: actual ? { binding: actual.binding, databaseName: actual.database_name } : null,
    });
  }

  for (const [binding, spec] of Object.entries(bindings.r2 || {})) {
    const actual = findByName(wrangler.r2_buckets, binding);
    const valid = actual?.bucket_name === spec.bucketName;
    addPassFail(resources, issues, {
      id: `binding:${workerId}:r2:${binding}`,
      className: "r2",
      label: binding,
      worker: workerId,
      repoValidated: valid,
      status: valid ? "repo_validated" : "missing",
      message: valid ? `R2 ${binding} is aligned to ${spec.bucketName}.` : `R2 ${binding} is missing or not aligned to ${spec.bucketName}.`,
      expected: { binding, bucketName: spec.bucketName },
      actual: actual ? { binding: actual.binding, bucketName: actual.bucket_name } : null,
    });
  }

  for (const [binding, spec] of Object.entries(bindings.services || {})) {
    const actual = findByName(wrangler.services, binding);
    const valid = actual?.service === spec.service;
    addPassFail(resources, issues, {
      id: `binding:${workerId}:service:${binding}`,
      className: "service_binding",
      label: binding,
      worker: workerId,
      repoValidated: valid,
      status: valid ? "repo_validated" : "drift",
      message: valid ? `Service binding ${binding} targets ${spec.service}.` : `Service binding ${binding} target drift; expected ${spec.service}.`,
      expected: spec,
      actual: actual ? { binding: actual.binding, service: actual.service, environment: actual.environment || null } : null,
    });
  }

  for (const [binding, spec] of Object.entries(bindings.durableObjects || {})) {
    const actual = findByName(wrangler.durable_objects?.bindings, binding);
    const valid = actual?.class_name === spec.className;
    addPassFail(resources, issues, {
      id: `binding:${workerId}:do:${binding}`,
      className: "durable_object",
      label: binding,
      worker: workerId,
      repoValidated: valid,
      status: valid ? "repo_validated" : "missing",
      message: valid ? `Durable Object ${binding} is aligned to ${spec.className}.` : `Durable Object ${binding} is missing or not aligned to ${spec.className}.`,
      expected: spec,
      actual: actual ? { name: actual.name, className: actual.class_name } : null,
    });
  }

  for (const [binding, spec] of Object.entries(bindings.queues?.producers || {})) {
    const actual = normalizeArray(wrangler.queues?.producers).find((entry) => entry?.binding === binding);
    const valid = actual?.queue === spec.queue;
    addPassFail(resources, issues, {
      id: `binding:${workerId}:queue-producer:${binding}`,
      className: "queue",
      label: binding,
      worker: workerId,
      repoValidated: valid,
      status: valid ? "repo_validated" : "missing",
      message: valid ? `Queue producer ${binding} targets ${spec.queue}.` : `Queue producer ${binding} is missing or drifted; expected ${spec.queue}.`,
      expected: spec,
      actual: actual ? { binding: actual.binding, queue: actual.queue } : null,
    });
  }

  for (const expectedConsumer of normalizeArray(bindings.queues?.consumers)) {
    const actual = findByQueue(wrangler.queues?.consumers, expectedConsumer.queue);
    const valid = actual && sameJson(
      {
        queue: actual.queue,
        max_batch_size: actual.max_batch_size,
        max_batch_timeout: actual.max_batch_timeout,
        max_retries: actual.max_retries,
      },
      expectedConsumer
    );
    addPassFail(resources, issues, {
      id: `binding:${workerId}:queue-consumer:${expectedConsumer.queue}`,
      className: "queue",
      label: expectedConsumer.queue,
      worker: workerId,
      repoValidated: valid,
      status: valid ? "repo_validated" : "drift",
      message: valid ? `Queue consumer ${expectedConsumer.queue} is aligned.` : `Queue consumer ${expectedConsumer.queue} is missing or drifted.`,
      expected: expectedConsumer,
      actual: actual || null,
    });
  }
}

function addMigrationAndCronResources(resources, issues, workerId, workerManifest, workerConfig) {
  const wrangler = workerConfig?.wrangler || {};
  for (const migration of normalizeArray(workerManifest.migrations)) {
    const actual = findMigration(wrangler.migrations, migration.tag);
    const expectedClasses = normalizeArray(migration.newSqliteClasses).sort();
    const actualClasses = normalizeArray(actual?.new_sqlite_classes).sort();
    const valid = sameJson(expectedClasses, actualClasses);
    addPassFail(resources, issues, {
      id: `migration:${workerId}:${migration.tag}`,
      className: "durable_object_migration",
      label: migration.tag,
      worker: workerId,
      repoValidated: valid,
      status: valid ? "repo_validated" : "drift",
      message: valid ? `Wrangler migration ${migration.tag} is aligned.` : `Wrangler migration ${migration.tag} is missing or drifted.`,
      expected: migration,
      actual: actual || null,
    });
  }

  for (const cron of normalizeArray(workerManifest.triggers?.crons)) {
    const valid = normalizeArray(wrangler.triggers?.crons).includes(cron);
    addPassFail(resources, issues, {
      id: `cron:${workerId}:${cron}`,
      className: "cron",
      label: cron,
      worker: workerId,
      repoValidated: valid,
      status: valid ? "repo_validated" : "missing",
      message: valid ? `Cron trigger ${cron} is declared.` : `Cron trigger ${cron} is missing from Wrangler.`,
      expected: cron,
      actual: normalizeArray(wrangler.triggers?.crons),
    });
  }
}

function addSchemaResources(resources, issues, context) {
  const checkpoints = context.manifest?.release?.schemaCheckpoints || {};
  for (const [checkpointId, checkpoint] of Object.entries(checkpoints)) {
    const files = context.schemaCheckpoints?.[checkpointId]?.files || [];
    const valid = files.includes(checkpoint.latest);
    const resource = makeResource({
      id: `schema:${checkpointId}`,
      className: "d1_migration_checkpoint",
      label: checkpoint.latest,
      worker: "auth",
      repoValidated: valid,
      status: valid ? "repo_validated" : "missing",
      message: valid
        ? `Latest migration checkpoint ${checkpoint.latest} exists locally for ${checkpoint.databaseName}.`
        : `Latest migration checkpoint ${checkpoint.latest} is missing locally.`,
      expected: checkpoint,
      actual: { files },
    });
    resources.push(resource);
    if (!valid) addIssue(issues, resource);
  }
}

function addManualPrerequisiteResources(resources, manifest) {
  for (const entry of normalizeArray(manifest?.release?.manualPrerequisites)) {
    if (entry.kind === "secret") {
      const required = entry.requiredForRelease === true;
      resources.push(makeResource({
        id: `secret:${entry.worker}:${entry.name}`,
        className: "secret",
        label: entry.name,
        worker: entry.worker || null,
        repoValidated: true,
        liveVerificationRequired: true,
        optionalFailClosed: !required,
        dashboardManaged: false,
        blockedPending: true,
        status: required ? "live_verification_required" : "optional_fail_closed",
        message: required
          ? `Required secret ${entry.name} is declared by name only; live presence must be verified without reading value.`
          : `Optional secret ${entry.name} is fail-closed or feature-gated when absent.`,
        evidence: entry.documentation || null,
      }));
      continue;
    }
    resources.push(makeResource({
      id: `dashboard:${entry.id}`,
      className: entry.kind || "dashboard_managed",
      label: entry.name || entry.id,
      worker: entry.worker || null,
      repoValidated: false,
      liveVerificationRequired: true,
      optionalFailClosed: entry.requiredForRelease !== true,
      dashboardManaged: true,
      blockedPending: true,
      status: "dashboard_managed_pending",
      message: `${entry.id} is dashboard/operator-managed and cannot be proven by repo config alone.`,
      evidence: entry.documentation || null,
    }));
  }
}

function addStaticResources(resources, repoRoot) {
  const workflowPath = ".github/workflows/static.yml";
  const exists = fs.existsSync(path.join(repoRoot, workflowPath));
  resources.push(makeResource({
    id: "static:github-pages-workflow",
    className: "github_pages_static",
    label: workflowPath,
    repoValidated: exists,
    liveVerificationRequired: true,
    status: exists ? "repo_validated" : "missing",
    message: exists
      ? "GitHub Pages static workflow exists; live Pages deployment still requires operator evidence."
      : "GitHub Pages static workflow is missing.",
    expected: workflowPath,
    actual: exists ? workflowPath : null,
  }));
  resources.push(makeResource({
    id: "static:asset-version-rewrite",
    className: "static_build",
    label: "asset version rewrite",
    repoValidated: fs.existsSync(path.join(repoRoot, "scripts/build-static-site.mjs")),
    liveVerificationRequired: true,
    status: fs.existsSync(path.join(repoRoot, "scripts/build-static-site.mjs")) ? "repo_validated" : "missing",
    message: "Static asset version rewrite is repo-supported; deployed asset version must be verified post-deploy.",
    expected: "scripts/build-static-site.mjs",
    actual: fs.existsSync(path.join(repoRoot, "scripts/build-static-site.mjs")) ? "present" : "missing",
  }));
}

function summarize(resources, issues) {
  const byClass = {};
  const byStatus = {};
  const byClassification = {};
  for (const resource of resources) {
    byClass[resource.class] = (byClass[resource.class] || 0) + 1;
    byStatus[resource.status] = (byStatus[resource.status] || 0) + 1;
    for (const classification of resource.classifications) {
      byClassification[classification] = (byClassification[classification] || 0) + 1;
    }
  }
  return {
    totalResources: resources.length,
    issueCount: issues.length,
    byClass,
    byStatus,
    byClassification,
  };
}

export function buildCloudflareResourceModel({ repoRoot = process.cwd(), context = null, generatedAt = new Date().toISOString() } = {}) {
  const effectiveContext = context || loadReleaseCompatibilityContext(repoRoot);
  const resources = [];
  const issues = [];
  const releaseIssues = validateReleaseCompatibility(effectiveContext);
  for (const issue of releaseIssues) {
    issues.push({
      id: "release-compat",
      severity: "error",
      message: issue,
      class: "release_contract",
      worker: null,
    });
  }

  const workers = effectiveContext.manifest?.release?.workers || {};
  for (const [workerId, workerManifest] of Object.entries(workers)) {
    const workerConfig = effectiveContext.workerConfigs?.[workerId] || {};
    addWorkerResources(resources, issues, workerId, workerManifest, workerConfig);
    addBindingResources(resources, issues, workerId, workerManifest, workerConfig);
    addMigrationAndCronResources(resources, issues, workerId, workerManifest, workerConfig);
  }
  addSchemaResources(resources, issues, effectiveContext);
  addManualPrerequisiteResources(resources, effectiveContext.manifest);
  addStaticResources(resources, repoRoot);

  return {
    ok: issues.length === 0,
    version: CLOUDFLARE_RESOURCE_MODEL_VERSION,
    generatedAt,
    mode: "repo_config_only",
    localOnly: true,
    nonMutating: true,
    cloudflareApiCallsMade: false,
    liveCloudflareEvidenceAttached: false,
    productionReadiness: "blocked",
    liveEvidenceRequired: true,
    repoTruthIsLiveProof: false,
    summary: summarize(resources, issues),
    resources,
    issues,
    blockedClaims: [
      { id: "production_readiness", status: "blocked" },
      { id: "live_billing_readiness", status: "blocked" },
      { id: "tenant_isolation", status: "not_claimed" },
      { id: "ownership_backfill_readiness", status: "blocked" },
      { id: "access_switch_readiness", status: "blocked" },
      { id: "confirmed_legacy_media_reset_readiness", status: "blocked" },
    ],
    redaction: {
      secretValuesPrinted: false,
      onlySecretNamesIncluded: true,
      rawCloudflareResponsesIncluded: false,
    },
  };
}

function formatCounts(counts) {
  const entries = Object.entries(counts || {}).sort(([left], [right]) => left.localeCompare(right));
  if (!entries.length) return "- none";
  return entries.map(([key, count]) => `- ${key}: ${count}`).join("\n");
}

export function renderCloudflareResourceModelMarkdown(model) {
  return `# Cloudflare Resource Verification Model

Generated: ${model.generatedAt}

- Mode: **${model.mode}**
- Local only: **${model.localOnly}**
- Cloudflare API calls made: **${model.cloudflareApiCallsMade}**
- Live Cloudflare evidence attached: **${model.liveCloudflareEvidenceAttached}**
- Production readiness: **${model.productionReadiness}**
- Repo truth is live proof: **${model.repoTruthIsLiveProof}**

## Summary

- Total resources: **${model.summary.totalResources}**
- Issues: **${model.summary.issueCount}**

### By Class

${formatCounts(model.summary.byClass)}

### By Status

${formatCounts(model.summary.byStatus)}

## Resources

| ID | Class | Worker | Status | Classifications |
| --- | --- | --- | --- | --- |
${model.resources.map((resource) => `| \`${resource.id}\` | ${resource.class} | ${resource.worker || "-"} | ${resource.status} | ${resource.classifications.join(", ")} |`).join("\n")}

## Issues

${model.issues.length ? model.issues.map((issue) => `- ${issue.severity}: ${issue.id} - ${issue.message}`).join("\n") : "- none"}

## Blocked Claims

${model.blockedClaims.map((claim) => `- ${claim.id}: **${claim.status}**`).join("\n")}
`;
}
