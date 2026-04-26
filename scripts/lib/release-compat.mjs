import fs from "node:fs";
import path from "node:path";

const MANUAL_PREREQUISITE_KINDS = new Set([
  "secret",
  "cloudflare_feature",
  "cloudflare_queue",
  "cloudflare_r2_bucket",
  "dashboard_rule",
  "transform_rule",
  "dashboard_setting",
]);
const DEPLOY_STEP_TYPES = new Set(["schema-checkpoint", "worker", "static"]);

function stripJsonComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

export function parseJsonc(source, label = "JSONC document") {
  try {
    return JSON.parse(stripJsonComments(source));
  } catch (error) {
    throw new Error(`Failed to parse ${label}: ${error.message}`);
  }
}

export function extractLatestMigrationFilename(files) {
  const sorted = [...files].sort();
  return sorted[sorted.length - 1] || null;
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function findNamedBinding(rows, binding) {
  return Array.isArray(rows)
    ? rows.find((entry) => entry?.binding === binding || entry?.name === binding) || null
    : null;
}

function findQueueConsumer(rows, queueName) {
  return Array.isArray(rows) ? rows.find((entry) => entry?.queue === queueName) || null : null;
}

function findMigrationEntry(rows, tag) {
  return Array.isArray(rows) ? rows.find((entry) => entry?.tag === tag) || null : null;
}

function routeEntryMatches(actualRoute, expectedRoute) {
  const actual = actualRoute && typeof actualRoute === "object" ? actualRoute : {};
  const expected = expectedRoute && typeof expectedRoute === "object" ? expectedRoute : {};
  return Object.entries(expected).every(([key, value]) => actual[key] === value);
}

function includesRouteLiteral(source, value) {
  return typeof source === "string" && source.includes(value);
}

function normalizeUniqueStrings(values) {
  return [...new Set((values || []).filter((value) => typeof value === "string" && value.length > 0))].sort();
}

function describeList(values) {
  return values.length > 0 ? values.join(", ") : "(none)";
}

function compareExactStringSets(expectedValues, actualValues, label, issues) {
  const expected = normalizeUniqueStrings(expectedValues);
  const actual = normalizeUniqueStrings(actualValues);
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const missing = expected.filter((value) => !actualSet.has(value));
  const unexpected = actual.filter((value) => !expectedSet.has(value));

  if (missing.length > 0) {
    issues.push(`${label} is missing: ${describeList(missing)}.`);
  }
  if (unexpected.length > 0) {
    issues.push(`${label} has unexpected entries: ${describeList(unexpected)}.`);
  }
}

function extractLiteralMethodRoutes(source) {
  const routes = new Set();
  const inlinePattern = /pathname\s*===\s*"([^"]+)"\s*&&\s*method\s*===\s*"([A-Z]+)"/g;
  for (const match of source.matchAll(inlinePattern)) {
    routes.add(`${match[2]} ${match[1]}`);
  }
  const blockPattern = /if\s*\(\s*pathname\s*===\s*"([^"]+)"\s*\)\s*\{\s*if\s*\(\s*method\s*!==\s*"([A-Z]+)"\s*\)/gs;
  for (const match of source.matchAll(blockPattern)) {
    routes.add(`${match[2]} ${match[1]}`);
  }
  return [...routes].sort();
}

function extractDelegatedLiteralPaths(source) {
  const paths = new Set();
  const pattern = /pathname\s*===\s*"([^"]+)"\s*\)\s*\{/g;
  for (const match of source.matchAll(pattern)) {
    paths.add(match[1]);
  }
  return [...paths].sort();
}

function extractStartsWithPrefixes(source) {
  const prefixes = new Set();
  const pattern = /pathname\.startsWith\("([^"]+)"\)/g;
  for (const match of source.matchAll(pattern)) {
    prefixes.add(match[1]);
  }
  return [...prefixes].sort();
}

function normalizeRoutePattern(regexSource) {
  return regexSource
    .replace(/\\\//g, "/")
    .replace(/\(\[[^\]]+\]\+\)/g, ":id")
    .replace(/\(\[\^\/\]\+\)/g, ":param")
    .replace(/\([^)]*\)/g, ":param")
    .replace(/\\/g, "");
}

function extractPatternMethodRoutes(source) {
  const patternsByVariable = new Map();
  const declarationPattern = /const\s+([A-Za-z0-9_]+)\s*=\s*pathname\.match\(\/\^(.+?)\$\/\);/g;
  for (const match of source.matchAll(declarationPattern)) {
    patternsByVariable.set(match[1], normalizeRoutePattern(match[2]));
  }

  const routes = new Set();
  const usagePattern = /if\s*\(\s*([A-Za-z0-9_]+)\s*&&\s*method\s*===\s*"([A-Z]+)"\s*\)/g;
  for (const match of source.matchAll(usagePattern)) {
    const routePattern = patternsByVariable.get(match[1]);
    if (routePattern) {
      routes.add(`${match[2]} ${routePattern}`);
    }
  }
  return [...routes].sort();
}

function extractPathLiterals(source, prefix) {
  const routes = new Set();
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`['"](${escapedPrefix}[^'"]+)['"]`, "g");
  for (const match of source.matchAll(pattern)) {
    routes.add(match[1]);
  }
  return [...routes].sort();
}

function workflowRequiresJob(workflowSource, jobName, needsMatcher) {
  const blockPattern = new RegExp(`^\\s{2}${jobName}:\\n([\\s\\S]*?)(?=^\\s{2}[a-zA-Z0-9_-]+:|$)`, "m");
  const match = workflowSource.match(blockPattern);
  if (!match) return false;
  return needsMatcher.test(match[1]);
}

function pathExists(context, relativePath) {
  if (typeof context?.pathExists === "function") {
    return context.pathExists(relativePath);
  }
  return true;
}

function getReleaseSection(manifest) {
  return isPlainObject(manifest?.release) ? manifest.release : {};
}

function getWorkers(manifest) {
  const workers = getReleaseSection(manifest).workers;
  return isPlainObject(workers) ? workers : {};
}

function getSchemaCheckpoints(manifest) {
  const schemaCheckpoints = getReleaseSection(manifest).schemaCheckpoints;
  return isPlainObject(schemaCheckpoints) ? schemaCheckpoints : {};
}

function getWorkerManifest(manifest, workerId) {
  return getWorkers(manifest)[workerId] || null;
}

function hasManifestBinding(workerManifest, bindingName) {
  const bindings = workerManifest?.bindings || {};
  if (bindings.ai === bindingName || bindings.images === bindingName) return true;
  if (isPlainObject(bindings.d1) && bindingName in bindings.d1) return true;
  if (isPlainObject(bindings.r2) && bindingName in bindings.r2) return true;
  if (isPlainObject(bindings.services) && bindingName in bindings.services) return true;
  if (isPlainObject(bindings.durableObjects) && bindingName in bindings.durableObjects) return true;
  if (isPlainObject(bindings.queues?.producers) && bindingName in bindings.queues.producers) return true;
  return false;
}

function hasManifestQueue(workerManifest, queueName) {
  const queueBindings = workerManifest?.bindings?.queues;
  if (!queueBindings) return false;

  for (const producer of Object.values(queueBindings.producers || {})) {
    if (producer?.queue === queueName) return true;
  }
  for (const consumer of queueBindings.consumers || []) {
    if (consumer?.queue === queueName) return true;
  }
  return false;
}

function getBindingNames(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((entry) => entry?.binding || entry?.name)
    .filter((value) => typeof value === "string" && value.length > 0);
}

function getQueueConsumerNames(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((entry) => entry?.queue)
    .filter((value) => typeof value === "string" && value.length > 0);
}

function getMigrationTags(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((entry) => entry?.tag)
    .filter((value) => typeof value === "string" && value.length > 0);
}

function validateReleaseManifestShape(manifest) {
  const issues = [];
  if (manifest?.schemaVersion !== 1) {
    issues.push(
      `Release manifest schemaVersion must be 1, found ${JSON.stringify(manifest?.schemaVersion)}.`
    );
  }

  const release = getReleaseSection(manifest);
  if (!isPlainObject(release) || Object.keys(release).length === 0) {
    issues.push("Release manifest is missing the top-level release contract section.");
    return issues;
  }

  if (!isPlainObject(release.schemaCheckpoints) || Object.keys(release.schemaCheckpoints).length === 0) {
    issues.push("Release manifest must declare at least one schema checkpoint.");
  }
  if (!isPlainObject(release.workers) || Object.keys(release.workers).length === 0) {
    issues.push("Release manifest must declare at least one validated worker.");
  }
  if (!Array.isArray(release.deployOrder) || release.deployOrder.length === 0) {
    issues.push("Release manifest must declare a non-empty deployOrder.");
  }
  if (!Array.isArray(release.manualPrerequisites) || release.manualPrerequisites.length === 0) {
    issues.push(
      "Release manifest must declare manualPrerequisites for remaining manual-only Cloudflare state."
    );
  }

  return issues;
}

function validateSchemaCheckpointContracts(manifest, context) {
  const issues = [];
  for (const [checkpointId, checkpointManifest] of Object.entries(getSchemaCheckpoints(manifest))) {
    if (!checkpointManifest?.migrationDirectory || typeof checkpointManifest.migrationDirectory !== "string") {
      issues.push(`Release manifest schema checkpoint "${checkpointId}" is missing migrationDirectory.`);
      continue;
    }
    if (!checkpointManifest?.latest || typeof checkpointManifest.latest !== "string") {
      issues.push(`Release manifest schema checkpoint "${checkpointId}" is missing latest.`);
      continue;
    }
    const checkpointContext = context?.schemaCheckpoints?.[checkpointId];
    if (!checkpointContext?.exists) {
      issues.push(
        `Release manifest schema checkpoint "${checkpointId}" references missing migration directory "${checkpointManifest.migrationDirectory}".`
      );
      continue;
    }
    const latestMigration = extractLatestMigrationFilename(checkpointContext.files || []);
    if (!latestMigration) {
      issues.push(`No ${checkpointId} migrations were found in "${checkpointManifest.migrationDirectory}".`);
      continue;
    }
    if (checkpointManifest.latest !== latestMigration) {
      issues.push(
        `Release manifest schema checkpoint "${checkpointId}" is ${checkpointManifest.latest}, but the latest ${checkpointId} migration is ${latestMigration}.`
      );
    }
  }
  return issues;
}

function validateWorkerContracts(manifest, context) {
  const issues = [];
  const workerConfigs = context?.workerConfigs || {};

  for (const [workerId, workerManifest] of Object.entries(getWorkers(manifest))) {
    if (!workerManifest?.wranglerPath || typeof workerManifest.wranglerPath !== "string") {
      issues.push(`Release manifest worker "${workerId}" is missing wranglerPath.`);
      continue;
    }
    if (!workerManifest?.name || typeof workerManifest.name !== "string") {
      issues.push(`Release manifest worker "${workerId}" is missing name.`);
      continue;
    }

    const workerConfig = workerConfigs[workerId];
    if (!pathExists(context, workerManifest.wranglerPath) || !workerConfig?.exists) {
      issues.push(
        `Release manifest worker "${workerId}" references missing wrangler config "${workerManifest.wranglerPath}".`
      );
      continue;
    }

    const wrangler = workerConfig.wrangler;
    if (!wrangler || typeof wrangler !== "object") {
      issues.push(`Failed to load wrangler config for worker "${workerId}".`);
      continue;
    }

    if (wrangler.name !== workerManifest.name) {
      issues.push(
        `Worker "${workerId}" wrangler name is "${wrangler.name}" but the release manifest requires "${workerManifest.name}".`
      );
    }

    for (const variableName of workerManifest.vars || []) {
      if (!(variableName in (wrangler.vars || {}))) {
        issues.push(`Worker "${workerId}" is missing required wrangler var "${variableName}".`);
      }
    }

    for (const [variableName, expectedValue] of Object.entries(workerManifest.expectedVars || {})) {
      if ((wrangler.vars || {})[variableName] !== expectedValue) {
        issues.push(
          `Worker "${workerId}" wrangler var "${variableName}" must equal ${JSON.stringify(expectedValue)}.`
        );
      }
    }

    if (typeof workerManifest.workersDev === "boolean" && wrangler.workers_dev !== workerManifest.workersDev) {
      issues.push(
        `Worker "${workerId}" workers_dev must be ${JSON.stringify(workerManifest.workersDev)}.`
      );
    }

    if (typeof workerManifest.previewUrls === "boolean" && wrangler.preview_urls !== workerManifest.previewUrls) {
      issues.push(
        `Worker "${workerId}" preview_urls must be ${JSON.stringify(workerManifest.previewUrls)}.`
      );
    }

    for (const expectedRoute of workerManifest.routes || []) {
      const matchedRoute = Array.isArray(wrangler.routes)
        ? wrangler.routes.find((route) => routeEntryMatches(route, expectedRoute)) || null
        : null;
      if (!matchedRoute) {
        issues.push(
          `Worker "${workerId}" wrangler routes are missing ${JSON.stringify(expectedRoute)}.`
        );
      }
    }

    for (const expectedCron of workerManifest.triggers?.crons || []) {
      const actualCrons = Array.isArray(wrangler.triggers?.crons) ? wrangler.triggers.crons : [];
      if (!actualCrons.includes(expectedCron)) {
        issues.push(`Worker "${workerId}" is missing cron trigger "${expectedCron}".`);
      }
    }

    const bindings = workerManifest.bindings || {};
    if (bindings.ai && wrangler.ai?.binding !== bindings.ai) {
      issues.push(`Worker "${workerId}" AI binding must be "${bindings.ai}".`);
    }
    if (bindings.images && wrangler.images?.binding !== bindings.images) {
      issues.push(`Worker "${workerId}" IMAGES binding must be "${bindings.images}".`);
    }

    for (const [binding, spec] of Object.entries(bindings.d1 || {})) {
      const row = findNamedBinding(wrangler.d1_databases, binding);
      if (!row) {
        issues.push(`Worker "${workerId}" is missing D1 binding "${binding}".`);
        continue;
      }
      if (spec?.databaseName && row.database_name !== spec.databaseName) {
        issues.push(
          `Worker "${workerId}" D1 binding "${binding}" targets "${row.database_name}" but the release manifest requires "${spec.databaseName}".`
        );
      }
    }
    compareExactStringSets(
      Object.keys(bindings.d1 || {}),
      getBindingNames(wrangler.d1_databases),
      `Worker "${workerId}" D1 binding contract`,
      issues
    );

    for (const [binding, spec] of Object.entries(bindings.r2 || {})) {
      const row = findNamedBinding(wrangler.r2_buckets, binding);
      if (!row) {
        issues.push(`Worker "${workerId}" is missing R2 binding "${binding}".`);
        continue;
      }
      if (spec?.bucketName && row.bucket_name !== spec.bucketName) {
        issues.push(
          `Worker "${workerId}" R2 binding "${binding}" targets "${row.bucket_name}" but the release manifest requires "${spec.bucketName}".`
        );
      }
    }
    compareExactStringSets(
      Object.keys(bindings.r2 || {}),
      getBindingNames(wrangler.r2_buckets),
      `Worker "${workerId}" R2 binding contract`,
      issues
    );

    for (const [binding, spec] of Object.entries(bindings.services || {})) {
      const row = findNamedBinding(wrangler.services, binding);
      if (!row) {
        issues.push(`Worker "${workerId}" is missing service binding "${binding}".`);
        continue;
      }
      if (spec?.service && row.service !== spec.service) {
        issues.push(
          `Worker "${workerId}" service binding "${binding}" targets "${row.service}" but the release manifest requires "${spec.service}".`
        );
      }

      if (spec?.worker) {
        const targetWorkerManifest = getWorkerManifest(manifest, spec.worker);
        if (!targetWorkerManifest) {
          issues.push(
            `Worker "${workerId}" service binding "${binding}" references unknown worker "${spec.worker}".`
          );
          continue;
        }
        if (targetWorkerManifest.name !== spec.service) {
          issues.push(
            `Worker "${workerId}" service binding "${binding}" expects service "${spec.service}" but worker "${spec.worker}" is declared as "${targetWorkerManifest.name}".`
          );
        }
        const targetWorkerConfig = workerConfigs[spec.worker];
        if (targetWorkerConfig?.exists && targetWorkerConfig?.wrangler?.name !== spec.service) {
          issues.push(
            `Worker "${spec.worker}" wrangler name is "${targetWorkerConfig.wrangler.name}" but service binding "${binding}" requires "${spec.service}".`
          );
        }
      }
    }
    compareExactStringSets(
      Object.keys(bindings.services || {}),
      getBindingNames(wrangler.services),
      `Worker "${workerId}" service binding contract`,
      issues
    );

    for (const [binding, spec] of Object.entries(bindings.durableObjects || {})) {
      const row = findNamedBinding(wrangler.durable_objects?.bindings, binding);
      if (!row) {
        issues.push(`Worker "${workerId}" is missing Durable Object binding "${binding}".`);
        continue;
      }
      if (spec?.className && row.class_name !== spec.className) {
        issues.push(
          `Worker "${workerId}" Durable Object binding "${binding}" targets class "${row.class_name}" but the release manifest requires "${spec.className}".`
        );
      }
    }
    compareExactStringSets(
      Object.keys(bindings.durableObjects || {}),
      getBindingNames(wrangler.durable_objects?.bindings),
      `Worker "${workerId}" Durable Object binding contract`,
      issues
    );

    for (const [binding, spec] of Object.entries(bindings.queues?.producers || {})) {
      const row = findNamedBinding(wrangler.queues?.producers, binding);
      if (!row) {
        issues.push(`Worker "${workerId}" is missing queue producer binding "${binding}".`);
        continue;
      }
      if (spec?.queue && row.queue !== spec.queue) {
        issues.push(
          `Worker "${workerId}" queue producer binding "${binding}" targets "${row.queue}" but the release manifest requires "${spec.queue}".`
        );
      }
    }
    compareExactStringSets(
      Object.keys(bindings.queues?.producers || {}),
      getBindingNames(wrangler.queues?.producers),
      `Worker "${workerId}" queue producer contract`,
      issues
    );

    for (const consumerSpec of bindings.queues?.consumers || []) {
      const row = findQueueConsumer(wrangler.queues?.consumers, consumerSpec?.queue);
      if (!row) {
        issues.push(`Worker "${workerId}" is missing queue consumer for "${consumerSpec?.queue}".`);
        continue;
      }
      for (const fieldName of ["max_batch_size", "max_batch_timeout", "max_retries"]) {
        if (
          typeof consumerSpec?.[fieldName] === "number" &&
          row?.[fieldName] !== consumerSpec[fieldName]
        ) {
          issues.push(
            `Worker "${workerId}" queue consumer "${consumerSpec.queue}" must set ${fieldName}=${consumerSpec[fieldName]}.`
          );
        }
      }
    }
    compareExactStringSets(
      (bindings.queues?.consumers || []).map((entry) => entry?.queue),
      getQueueConsumerNames(wrangler.queues?.consumers),
      `Worker "${workerId}" queue consumer contract`,
      issues
    );

    for (const migrationSpec of workerManifest.migrations || []) {
      const row = findMigrationEntry(wrangler.migrations, migrationSpec?.tag);
      if (!row) {
        issues.push(`Worker "${workerId}" is missing wrangler migration tag "${migrationSpec?.tag}".`);
        continue;
      }
      compareExactStringSets(
        migrationSpec?.newSqliteClasses || [],
        row?.new_sqlite_classes || [],
        `Worker "${workerId}" wrangler migration "${migrationSpec.tag}" new_sqlite_classes`,
        issues
      );
    }
    compareExactStringSets(
      (workerManifest.migrations || []).map((entry) => entry?.tag),
      getMigrationTags(wrangler.migrations),
      `Worker "${workerId}" wrangler migration tag contract`,
      issues
    );
  }

  return issues;
}

function validateDeployOrder(manifest) {
  const issues = [];
  const release = getReleaseSection(manifest);
  const steps = Array.isArray(release.deployOrder) ? release.deployOrder : [];
  const stepIds = new Map();
  const stepIndexes = new Map();
  const workerStepIds = new Map();
  const checkpointStepIds = new Map();
  const staticStepIds = [];

  for (const [index, step] of steps.entries()) {
    if (!step?.id || typeof step.id !== "string") {
      issues.push(`Release manifest deployOrder entry at index ${index} is missing id.`);
      continue;
    }
    if (stepIds.has(step.id)) {
      issues.push(`Release manifest deployOrder reuses step id "${step.id}".`);
      continue;
    }
    stepIds.set(step.id, step);
    stepIndexes.set(step.id, index);

    if (!DEPLOY_STEP_TYPES.has(step.type)) {
      issues.push(`Release manifest deploy step "${step.id}" has unsupported type "${step.type}".`);
      continue;
    }

    if (step.type === "worker") {
      if (!step.worker || typeof step.worker !== "string") {
        issues.push(`Release manifest deploy step "${step.id}" is missing worker.`);
        continue;
      }
      if (!getWorkerManifest(manifest, step.worker)) {
        issues.push(`Release manifest deploy step "${step.id}" references unknown worker "${step.worker}".`);
        continue;
      }
      if (workerStepIds.has(step.worker)) {
        issues.push(
          `Release manifest deployOrder defines multiple deploy steps for worker "${step.worker}".`
        );
      } else {
        workerStepIds.set(step.worker, step.id);
      }
    }

    if (step.type === "schema-checkpoint") {
      if (!step.checkpoint || typeof step.checkpoint !== "string") {
        issues.push(`Release manifest deploy step "${step.id}" is missing checkpoint.`);
        continue;
      }
      if (!getSchemaCheckpoints(manifest)[step.checkpoint]) {
        issues.push(
          `Release manifest deploy step "${step.id}" references unknown schema checkpoint "${step.checkpoint}".`
        );
        continue;
      }
      if (checkpointStepIds.has(step.checkpoint)) {
        issues.push(
          `Release manifest deployOrder defines multiple deploy steps for schema checkpoint "${step.checkpoint}".`
        );
      } else {
        checkpointStepIds.set(step.checkpoint, step.id);
      }
    }

    if (step.type === "static") {
      staticStepIds.push(step.id);
    }
  }

  for (const workerId of Object.keys(getWorkers(manifest))) {
    if (!workerStepIds.has(workerId)) {
      issues.push(`Release manifest deployOrder is missing a deploy step for worker "${workerId}".`);
    }
  }
  for (const checkpointId of Object.keys(getSchemaCheckpoints(manifest))) {
    if (!checkpointStepIds.has(checkpointId)) {
      issues.push(
        `Release manifest deployOrder is missing a deploy step for schema checkpoint "${checkpointId}".`
      );
    }
  }
  if (staticStepIds.length === 0) {
    issues.push("Release manifest deployOrder must include a static deploy step.");
  } else if (staticStepIds.length > 1) {
    issues.push(
      `Release manifest deployOrder defines multiple static deploy steps: ${staticStepIds.join(", ")}.`
    );
  }

  for (const step of steps) {
    if (!step?.id || !stepIds.has(step.id)) continue;
    const dependsOn = Array.isArray(step.dependsOn) ? step.dependsOn : [];
    for (const dependencyId of dependsOn) {
      if (!stepIds.has(dependencyId)) {
        issues.push(
          `Release manifest deploy step "${step.id}" depends on unknown step "${dependencyId}".`
        );
        continue;
      }
      if ((stepIndexes.get(dependencyId) ?? -1) >= (stepIndexes.get(step.id) ?? -1)) {
        issues.push(
          `Release manifest deploy step "${step.id}" must appear after dependency "${dependencyId}".`
        );
      }
    }
  }

  for (const [workerId, workerManifest] of Object.entries(getWorkers(manifest))) {
    const workerStepId = workerStepIds.get(workerId);
    if (!workerStepId) continue;
    const workerStep = stepIds.get(workerStepId);
    const dependsOn = new Set(Array.isArray(workerStep?.dependsOn) ? workerStep.dependsOn : []);

    for (const serviceSpec of Object.values(workerManifest.bindings?.services || {})) {
      if (!serviceSpec?.worker) continue;
      const dependencyStepId = workerStepIds.get(serviceSpec.worker);
      if (dependencyStepId && !dependsOn.has(dependencyStepId)) {
        issues.push(
          `Release manifest deploy step "${workerStepId}" must depend on "${dependencyStepId}" because worker "${workerId}" binds service worker "${serviceSpec.worker}".`
        );
      }
    }

    const workerDatabaseNames = new Set(
      Object.values(workerManifest.bindings?.d1 || {})
        .map((spec) => spec?.databaseName)
        .filter((value) => typeof value === "string" && value.length > 0)
    );
    for (const [checkpointId, checkpointManifest] of Object.entries(getSchemaCheckpoints(manifest))) {
      if (!checkpointManifest?.databaseName || !workerDatabaseNames.has(checkpointManifest.databaseName)) {
        continue;
      }
      const checkpointStepId = checkpointStepIds.get(checkpointId);
      if (checkpointStepId && !dependsOn.has(checkpointStepId)) {
        issues.push(
          `Release manifest deploy step "${workerStepId}" must depend on "${checkpointStepId}" because worker "${workerId}" uses D1 database "${checkpointManifest.databaseName}".`
        );
      }
    }
  }

  if (staticStepIds.length === 1) {
    const staticStepId = staticStepIds[0];
    const staticIndex = stepIndexes.get(staticStepId) ?? -1;
    for (const dependencyStepId of workerStepIds.values()) {
      const workerIndex = stepIndexes.get(dependencyStepId) ?? -1;
      if (workerIndex >= staticIndex) {
        issues.push(
          `Release manifest deploy step "${staticStepId}" must appear after "${dependencyStepId}" so static deploy runs last.`
        );
      }
    }
  }

  return issues;
}

function validateManualPrerequisites(manifest, context) {
  const issues = [];
  const release = getReleaseSection(manifest);
  const manualPrerequisites = Array.isArray(release.manualPrerequisites)
    ? release.manualPrerequisites
    : [];
  const seenIds = new Set();

  for (const entry of manualPrerequisites) {
    if (!entry?.id || typeof entry.id !== "string") {
      issues.push("Release manifest manualPrerequisites entries must have an id.");
      continue;
    }
    if (seenIds.has(entry.id)) {
      issues.push(`Release manifest manualPrerequisites reuses id "${entry.id}".`);
      continue;
    }
    seenIds.add(entry.id);

    if (!MANUAL_PREREQUISITE_KINDS.has(entry.kind)) {
      issues.push(
        `Release manifest manual prerequisite "${entry.id}" has unsupported kind "${entry.kind}".`
      );
    }
    if (typeof entry.requiredForRelease !== "boolean") {
      issues.push(
        `Release manifest manual prerequisite "${entry.id}" must declare requiredForRelease as true or false.`
      );
    }
    if (!entry.summary || typeof entry.summary !== "string") {
      issues.push(`Release manifest manual prerequisite "${entry.id}" is missing summary.`);
    }
    if (!entry.documentation || typeof entry.documentation !== "string") {
      issues.push(`Release manifest manual prerequisite "${entry.id}" is missing documentation.`);
    } else if (!pathExists(context, entry.documentation)) {
      issues.push(
        `Release manifest manual prerequisite "${entry.id}" references missing documentation "${entry.documentation}".`
      );
    }

    if (entry.worker) {
      const workerManifest = getWorkerManifest(manifest, entry.worker);
      if (!workerManifest) {
        issues.push(
          `Release manifest manual prerequisite "${entry.id}" references unknown worker "${entry.worker}".`
        );
        continue;
      }
      if (entry.binding && !hasManifestBinding(workerManifest, entry.binding)) {
        issues.push(
          `Release manifest manual prerequisite "${entry.id}" references missing binding "${entry.binding}" on worker "${entry.worker}".`
        );
      }
      if (entry.queue && !hasManifestQueue(workerManifest, entry.queue)) {
        issues.push(
          `Release manifest manual prerequisite "${entry.id}" references queue "${entry.queue}" that is not declared for worker "${entry.worker}".`
        );
      }
    }

    if (entry.kind === "secret" && (!entry.name || typeof entry.name !== "string")) {
      issues.push(`Release manifest manual prerequisite "${entry.id}" is missing secret name.`);
    }
    if (entry.kind === "cloudflare_queue" && (!entry.queue || typeof entry.queue !== "string")) {
      issues.push(`Release manifest manual prerequisite "${entry.id}" is missing queue.`);
    }
  }

  return issues;
}

function validateAuthIndexRoutes(manifest, context) {
  const issues = [];
  const contract = manifest?.authIndexRoutes || {};
  if (!Array.isArray(contract.literalRoutes) || contract.literalRoutes.length === 0) {
    issues.push("Release manifest authIndexRoutes.literalRoutes must be a non-empty array.");
    return issues;
  }

  compareExactStringSets(
    contract.literalRoutes,
    extractLiteralMethodRoutes(context.authIndexSource),
    "Auth index literal route contract",
    issues
  );
  compareExactStringSets(
    contract.delegatedExactPaths || [],
    extractDelegatedLiteralPaths(context.authIndexSource),
    "Auth index delegated exact-path contract",
    issues
  );

  const actualPrefixes = extractStartsWithPrefixes(context.authIndexSource);
  const protectedMediaPrefixes = ["/api/thumbnails/", "/api/images/", "/api/music/", "/api/soundlab-thumbs/"];
  compareExactStringSets(
    contract.delegatedPrefixes || [],
    actualPrefixes.filter((value) => !protectedMediaPrefixes.includes(value)),
    "Auth index delegated prefix contract",
    issues
  );
  compareExactStringSets(
    contract.protectedMediaPrefixes || [],
    actualPrefixes.filter((value) => protectedMediaPrefixes.includes(value)),
    "Auth index protected media prefix contract",
    issues
  );

  return issues;
}

function validateMemberAiCompatibility(manifest, context) {
  const issues = [];
  const contract = manifest?.memberAi?.authRoutes || {};
  if (!Array.isArray(contract.literalRoutes) || contract.literalRoutes.length === 0) {
    issues.push("Release manifest memberAi.authRoutes.literalRoutes must be a non-empty array.");
    return issues;
  }

  compareExactStringSets(
    contract.literalRoutes,
    extractLiteralMethodRoutes(context.authAiSource),
    "Member AI literal route contract",
    issues
  );
  compareExactStringSets(
    contract.patternRoutes || [],
    extractPatternMethodRoutes(context.authAiSource),
    "Member AI pattern route contract",
    issues
  );

  return issues;
}

function validateAdminAiCompatibility(manifest, context) {
  const issues = [];
  const adminAi = manifest?.adminAi || {};
  const authAdminAiImplementationSource = [context.authAdminAiSource, context.authAdminAiProxySource]
    .filter((source) => typeof source === "string" && source.length > 0)
    .join("\n");
  const actualStaticAuthApiPaths = extractPathLiterals(context.authApiSource, "/admin/ai/");
  compareExactStringSets(
    adminAi.staticAuthApiPaths || [],
    actualStaticAuthApiPaths,
    "Admin AI static auth API path contract",
    issues
  );

  const actualAdminAiExternalRoutes = extractLiteralMethodRoutes(context.authAdminAiSource)
    .filter((route) => route.includes("/api/admin/ai/"))
    .map((route) => route.replace(/^[A-Z]+\s+/, ""));
  compareExactStringSets(
    [...Object.keys(adminAi.authToAiRoutes || {}), ...(adminAi.authOnlyRoutes || [])],
    actualAdminAiExternalRoutes,
    "Admin AI external route ownership contract",
    issues
  );
  const debugOnlyRoutes = Array.isArray(adminAi.debugOnlyRoutes) ? adminAi.debugOnlyRoutes : [];
  for (const route of debugOnlyRoutes) {
    if (!actualAdminAiExternalRoutes.includes(route)) {
      issues.push(`Admin AI debug-only route contract references missing external route "${route}".`);
    }
  }
  if (
    Object.prototype.hasOwnProperty.call(adminAi.authToAiRoutes || {}, "/api/admin/ai/test-video")
    && !debugOnlyRoutes.includes("/api/admin/ai/test-video")
  ) {
    issues.push('Admin AI synchronous video route "/api/admin/ai/test-video" must be declared in debugOnlyRoutes.');
  }
  const actualAdminAiExternalPatternRoutes = extractPatternMethodRoutes(context.authAdminAiSource)
    .filter((route) => route.includes("/api/admin/ai/"));
  compareExactStringSets(
    adminAi.authOnlyPatternRoutes || [],
    actualAdminAiExternalPatternRoutes,
    "Admin AI external pattern route ownership contract",
    issues
  );

  const actualAiInternalRoutes = extractLiteralMethodRoutes(context.aiIndexSource)
    .filter((route) => route.includes("/internal/ai/"))
    .map((route) => route.replace(/^[A-Z]+\s+/, ""));
  compareExactStringSets(
    [
      ...Object.values(adminAi.authToAiRoutes || {}),
      ...(adminAi.internalOnlyRoutes || []),
    ],
    actualAiInternalRoutes,
    "Admin AI internal route ownership contract",
    issues
  );

  for (const [externalRoute, internalRoute] of Object.entries(adminAi.authToAiRoutes || {})) {
    if (!includesRouteLiteral(authAdminAiImplementationSource, externalRoute)) {
      issues.push(`Auth admin AI proxy is missing external route "${externalRoute}".`);
    }
    if (!includesRouteLiteral(authAdminAiImplementationSource, internalRoute)) {
      issues.push(
        `Auth admin AI proxy does not forward "${externalRoute}" to "${internalRoute}".`
      );
    }
    if (!includesRouteLiteral(context.aiIndexSource, internalRoute)) {
      issues.push(`AI worker router is missing internal route "${internalRoute}".`);
    }
  }

  return issues;
}

function validateAdminAuthCompatibility(manifest, context) {
  const issues = [];
  const contract = manifest?.adminAuthRoutes || {};
  if (!Array.isArray(contract.literalRoutes) || contract.literalRoutes.length === 0) {
    issues.push("Release manifest adminAuthRoutes.literalRoutes must be a non-empty array.");
    return issues;
  }

  const actualLiteralRoutes = [
    ...extractLiteralMethodRoutes(context.authAdminSource || ""),
    ...extractLiteralMethodRoutes(context.authAdminMfaSource || ""),
  ].filter((route) => route.includes("/api/admin/"));

  compareExactStringSets(
    contract.literalRoutes,
    actualLiteralRoutes,
    "Admin auth literal route contract",
    issues
  );
  compareExactStringSets(
    contract.patternRoutes || [],
    extractPatternMethodRoutes(context.authAdminSource || ""),
    "Admin auth pattern route contract",
    issues
  );

  compareExactStringSets(
    contract.staticAuthApiPaths || [],
    extractPathLiterals(context.authApiSource || "", "/admin/mfa/"),
    "Admin MFA static auth API path contract",
    issues
  );

  return issues;
}

function validateWorkflowCompatibility(context) {
  const issues = [];
  const workflowSource = context.workflowSource;

  if (!includesRouteLiteral(workflowSource, "release-compatibility:")) {
    issues.push('Static workflow is missing the "release-compatibility" gate job.');
  }
  if (!includesRouteLiteral(workflowSource, "npm run test:release-compat")) {
    issues.push('Static workflow does not run "npm run test:release-compat".');
  }
  for (const command of [
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
  ]) {
    if (!includesRouteLiteral(workflowSource, command)) {
      issues.push(`Static workflow does not run "${command}".`);
    }
  }
  if (!includesRouteLiteral(workflowSource, "npm run test:release-plan")) {
    issues.push('Static workflow does not run "npm run test:release-plan".');
  }
  if (!includesRouteLiteral(workflowSource, "npm run validate:release")) {
    issues.push('Static workflow does not run "npm run validate:release".');
  }
  if (!includesRouteLiteral(workflowSource, "npm run test:asset-version")) {
    issues.push('Static workflow does not run "npm run test:asset-version".');
  }
  if (!includesRouteLiteral(workflowSource, "npm run validate:asset-version")) {
    issues.push('Static workflow does not run "npm run validate:asset-version".');
  }
  if (!workflowRequiresJob(workflowSource, "worker-validation", /needs:\s*release-compatibility/)) {
    issues.push('Worker validation job must depend on "release-compatibility".');
  }
  if (
    !workflowRequiresJob(
      workflowSource,
      "deploy",
      /needs:\s*\[\s*release-compatibility\s*,\s*worker-validation\s*\]/
    )
  ) {
    issues.push('Deploy job must depend on ["release-compatibility", "worker-validation"].');
  }
  if (!includesRouteLiteral(workflowSource, "npm run build:static")) {
    issues.push('Static workflow must build deploy assets via "npm run build:static".');
  }

  return issues;
}

export function validateReleaseCompatibility(context) {
  const issues = [];
  const manifest = context?.manifest || {};

  issues.push(...validateReleaseManifestShape(manifest));
  issues.push(...validateSchemaCheckpointContracts(manifest, context));
  issues.push(...validateWorkerContracts(manifest, context));
  issues.push(...validateDeployOrder(manifest));
  issues.push(...validateManualPrerequisites(manifest, context));
  issues.push(...validateAuthIndexRoutes(manifest, context));
  issues.push(...validateMemberAiCompatibility(manifest, context));
  issues.push(...validateAdminAiCompatibility(manifest, context));
  issues.push(...validateAdminAuthCompatibility(manifest, context));
  issues.push(...validateWorkflowCompatibility(context));

  return issues;
}

function loadSchemaCheckpointContext(repoRoot, manifest) {
  const schemaCheckpoints = {};
  for (const [checkpointId, checkpointManifest] of Object.entries(getSchemaCheckpoints(manifest))) {
    const relativeDir = checkpointManifest?.migrationDirectory;
    const absDir = relativeDir ? path.join(repoRoot, relativeDir) : null;
    const exists =
      !!absDir && fs.existsSync(absDir) && fs.statSync(absDir).isDirectory();
    schemaCheckpoints[checkpointId] = {
      migrationDirectory: relativeDir,
      exists,
      files: exists
        ? fs.readdirSync(absDir).filter((file) => file.endsWith(".sql"))
        : [],
    };
  }
  return schemaCheckpoints;
}

function loadWorkerConfigContext(repoRoot, manifest) {
  const workerConfigs = {};
  for (const [workerId, workerManifest] of Object.entries(getWorkers(manifest))) {
    const relativePath = workerManifest?.wranglerPath;
    const absPath = relativePath ? path.join(repoRoot, relativePath) : null;
    const exists = !!absPath && fs.existsSync(absPath);
    workerConfigs[workerId] = {
      wranglerPath: relativePath,
      exists,
      wrangler: exists
        ? parseJsonc(fs.readFileSync(absPath, "utf8"), relativePath)
        : null,
    };
  }
  return workerConfigs;
}

export function loadReleaseCompatibilityContext(repoRoot) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "config/release-compat.json"), "utf8")
  );

  return {
    manifest,
    schemaCheckpoints: loadSchemaCheckpointContext(repoRoot, manifest),
    workerConfigs: loadWorkerConfigContext(repoRoot, manifest),
    pathExists(relativePath) {
      return fs.existsSync(path.join(repoRoot, relativePath));
    },
    authApiSource: fs.readFileSync(path.join(repoRoot, "js/shared/auth-api.js"), "utf8"),
    authIndexSource: fs.readFileSync(path.join(repoRoot, "workers/auth/src/index.js"), "utf8"),
    authAiSource: fs.readFileSync(path.join(repoRoot, "workers/auth/src/routes/ai.js"), "utf8"),
    authAdminSource: [
      "workers/auth/src/routes/admin.js",
      "workers/auth/src/routes/admin-billing.js",
      "workers/auth/src/routes/admin-data-lifecycle.js",
      "workers/auth/src/routes/admin-orgs.js",
    ].map((relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8")).join("\n"),
    authAdminMfaSource: fs.readFileSync(
      path.join(repoRoot, "workers/auth/src/routes/admin-mfa.js"),
      "utf8"
    ),
    authAdminAiSource: fs.readFileSync(
      path.join(repoRoot, "workers/auth/src/routes/admin-ai.js"),
      "utf8"
    ),
    authAdminAiProxySource: fs.readFileSync(
      path.join(repoRoot, "workers/auth/src/lib/admin-ai-proxy.js"),
      "utf8"
    ),
    aiIndexSource: fs.readFileSync(path.join(repoRoot, "workers/ai/src/index.js"), "utf8"),
    workflowSource: fs.readFileSync(
      path.join(repoRoot, ".github/workflows/static.yml"),
      "utf8"
    ),
  };
}
