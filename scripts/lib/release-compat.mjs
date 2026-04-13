import fs from "node:fs";
import path from "node:path";

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

function hasNamedBinding(rows, binding) {
  return Array.isArray(rows) && rows.some((entry) => entry?.binding === binding);
}

function findServiceBinding(rows, binding) {
  return Array.isArray(rows) ? rows.find((entry) => entry?.binding === binding) || null : null;
}

function includesRouteLiteral(source, value) {
  return typeof source === "string" && source.includes(value);
}

function workflowRequiresJob(workflowSource, jobName, needsMatcher) {
  const blockPattern = new RegExp(`^\\s{2}${jobName}:\\n([\\s\\S]*?)(?=^\\s{2}[a-zA-Z0-9_-]+:|$)`, "m");
  const match = workflowSource.match(blockPattern);
  if (!match) return false;
  return needsMatcher.test(match[1]);
}

export function validateReleaseCompatibility(context) {
  const issues = [];
  const {
    manifest,
    migrationFiles,
    authWrangler,
    aiWrangler,
    authApiSource,
    authAdminAiSource,
    aiIndexSource,
    workflowSource,
  } = context;

  const latestMigration = extractLatestMigrationFilename(migrationFiles);
  if (!latestMigration) {
    issues.push("No auth migrations were found.");
  } else if (manifest.authWorker.currentSchemaMigration !== latestMigration) {
    issues.push(
      `Release manifest schema checkpoint is ${manifest.authWorker.currentSchemaMigration}, but the latest auth migration is ${latestMigration}.`
    );
  }

  for (const binding of manifest.authWorker.requiredBindings.d1 || []) {
    if (!hasNamedBinding(authWrangler.d1_databases, binding)) {
      issues.push(`Auth worker is missing D1 binding "${binding}".`);
    }
  }

  if (authWrangler.images?.binding !== manifest.authWorker.requiredBindings.images) {
    issues.push(
      `Auth worker IMAGES binding must be "${manifest.authWorker.requiredBindings.images}".`
    );
  }

  for (const binding of manifest.authWorker.requiredBindings.r2 || []) {
    if (!hasNamedBinding(authWrangler.r2_buckets, binding)) {
      issues.push(`Auth worker is missing R2 binding "${binding}".`);
    }
  }

  for (const [binding, serviceName] of Object.entries(manifest.authWorker.requiredBindings.services || {})) {
    const serviceBinding = findServiceBinding(authWrangler.services, binding);
    if (!serviceBinding) {
      issues.push(`Auth worker is missing service binding "${binding}".`);
      continue;
    }
    if (serviceBinding.service !== serviceName) {
      issues.push(
        `Auth worker service binding "${binding}" targets "${serviceBinding.service}" but release manifest requires "${serviceName}".`
      );
    }
    if (aiWrangler.name !== serviceName) {
      issues.push(
        `AI worker wrangler name is "${aiWrangler.name}" but auth service binding "${binding}" expects "${serviceName}".`
      );
    }
  }

  for (const route of manifest.adminAi.staticAuthApiPaths || []) {
    if (!includesRouteLiteral(authApiSource, route)) {
      issues.push(`Static auth API wrapper is missing route "${route}".`);
    }
  }

  for (const [externalRoute, internalRoute] of Object.entries(manifest.adminAi.authToAiRoutes || {})) {
    if (!includesRouteLiteral(authAdminAiSource, externalRoute)) {
      issues.push(`Auth admin AI proxy is missing external route "${externalRoute}".`);
    }
    if (!includesRouteLiteral(authAdminAiSource, internalRoute)) {
      issues.push(
        `Auth admin AI proxy does not forward "${externalRoute}" to "${internalRoute}".`
      );
    }
    if (!includesRouteLiteral(aiIndexSource, internalRoute)) {
      issues.push(`AI worker router is missing internal route "${internalRoute}".`);
    }
  }

  if (!includesRouteLiteral(workflowSource, "release-compatibility:")) {
    issues.push('Static workflow is missing the "release-compatibility" gate job.');
  }
  if (!includesRouteLiteral(workflowSource, "npm run test:release-compat")) {
    issues.push('Static workflow does not run "npm run test:release-compat".');
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

export function loadReleaseCompatibilityContext(repoRoot) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "config/release-compat.json"), "utf8")
  );
  const migrationDir = path.join(repoRoot, "workers/auth/migrations");
  const migrationFiles = fs
    .readdirSync(migrationDir)
    .filter((file) => file.endsWith(".sql"));

  return {
    manifest,
    migrationFiles,
    authWrangler: parseJsonc(
      fs.readFileSync(path.join(repoRoot, "workers/auth/wrangler.jsonc"), "utf8"),
      "workers/auth/wrangler.jsonc"
    ),
    aiWrangler: parseJsonc(
      fs.readFileSync(path.join(repoRoot, "workers/ai/wrangler.jsonc"), "utf8"),
      "workers/ai/wrangler.jsonc"
    ),
    authApiSource: fs.readFileSync(path.join(repoRoot, "js/shared/auth-api.js"), "utf8"),
    authAdminAiSource: fs.readFileSync(
      path.join(repoRoot, "workers/auth/src/routes/admin-ai.js"),
      "utf8"
    ),
    aiIndexSource: fs.readFileSync(path.join(repoRoot, "workers/ai/src/index.js"), "utf8"),
    workflowSource: fs.readFileSync(
      path.join(repoRoot, ".github/workflows/static.yml"),
      "utf8"
    ),
  };
}
