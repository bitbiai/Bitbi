import { spawnSync } from "node:child_process";
import { loadReleaseCompatibilityContext, validateReleaseCompatibility } from "./release-compat.mjs";

const REQUIRED_MANUAL_PREREQUISITES = Object.freeze([
  {
    id: "auth-session-secret",
    worker: "auth",
    kind: "secret",
    name: "SESSION_SECRET",
  },
  {
    id: "auth-session-hash-secret",
    worker: "auth",
    kind: "secret",
    name: "SESSION_HASH_SECRET",
  },
  {
    id: "auth-pagination-signing-secret",
    worker: "auth",
    kind: "secret",
    name: "PAGINATION_SIGNING_SECRET",
  },
  {
    id: "auth-admin-mfa-encryption-key",
    worker: "auth",
    kind: "secret",
    name: "ADMIN_MFA_ENCRYPTION_KEY",
  },
  {
    id: "auth-admin-mfa-proof-secret",
    worker: "auth",
    kind: "secret",
    name: "ADMIN_MFA_PROOF_SECRET",
  },
  {
    id: "auth-admin-mfa-recovery-hash-secret",
    worker: "auth",
    kind: "secret",
    name: "ADMIN_MFA_RECOVERY_HASH_SECRET",
  },
  {
    id: "auth-ai-save-reference-signing-secret",
    worker: "auth",
    kind: "secret",
    name: "AI_SAVE_REFERENCE_SIGNING_SECRET",
  },
  {
    id: "auth-resend-secret",
    worker: "auth",
    kind: "secret",
    name: "RESEND_API_KEY",
  },
  {
    id: "auth-ai-service-auth-secret",
    worker: "auth",
    kind: "secret",
    name: "AI_SERVICE_AUTH_SECRET",
  },
  {
    id: "ai-service-auth-secret",
    worker: "ai",
    kind: "secret",
    name: "AI_SERVICE_AUTH_SECRET",
  },
  {
    id: "contact-resend-secret",
    worker: "contact",
    kind: "secret",
    name: "RESEND_API_KEY",
  },
]);

const REQUIRED_AI_DURABLE_OBJECT = Object.freeze({
  worker: "ai",
  binding: "SERVICE_AUTH_REPLAY",
  className: "AiServiceAuthReplayDurableObject",
  migrationTag: "v1-service-auth-replay",
});

const REQUIRED_AUTH_BINDINGS = Object.freeze([
  "DB",
  "PRIVATE_MEDIA",
  "USER_IMAGES",
  "AUDIT_ARCHIVE",
  "AI",
  "IMAGES",
  "AI_LAB",
  "PUBLIC_RATE_LIMITER",
  "ACTIVITY_INGEST_QUEUE",
  "AI_IMAGE_DERIVATIVES_QUEUE",
  "AI_VIDEO_JOBS_QUEUE",
]);

function getReleaseSection(context) {
  return context?.manifest?.release || {};
}

function getWorkerManifest(context, workerId) {
  return getReleaseSection(context).workers?.[workerId] || null;
}

function findManualPrerequisite(context, id) {
  return (getReleaseSection(context).manualPrerequisites || []).find((entry) => entry?.id === id) || null;
}

function findNamedBinding(rows, name) {
  return Array.isArray(rows)
    ? rows.find((entry) => entry?.name === name || entry?.binding === name) || null
    : null;
}

function hasManifestBinding(workerManifest, bindingName) {
  const bindings = workerManifest?.bindings || {};
  if (bindings.ai === bindingName || bindings.images === bindingName) return true;
  if (bindings.d1 && bindingName in bindings.d1) return true;
  if (bindings.r2 && bindingName in bindings.r2) return true;
  if (bindings.services && bindingName in bindings.services) return true;
  if (bindings.durableObjects && bindingName in bindings.durableObjects) return true;
  if (bindings.queues?.producers && bindingName in bindings.queues.producers) return true;
  return false;
}

function findMigration(rows, tag) {
  return Array.isArray(rows) ? rows.find((entry) => entry?.tag === tag) || null : null;
}

function makeCheck(id, status, message, details = {}) {
  return {
    id,
    status,
    message,
    ...details,
  };
}

function addIssue(issues, check, severity = "error") {
  issues.push({
    severity,
    id: check.id,
    message: check.message,
  });
}

function checkRequiredManualPrerequisites(context, checks, issues) {
  for (const required of REQUIRED_MANUAL_PREREQUISITES) {
    const entry = findManualPrerequisite(context, required.id);
    if (!entry) {
      const check = makeCheck(
        `manual-prerequisite:${required.id}`,
        "fail",
        `Release manifest is missing required manual prerequisite "${required.id}".`
      );
      checks.push(check);
      addIssue(issues, check);
      continue;
    }
    const mismatches = [];
    for (const field of ["worker", "kind", "name"]) {
      if (entry[field] !== required[field]) {
        mismatches.push(`${field}=${JSON.stringify(entry[field])}`);
      }
    }
    if (entry.requiredForRelease !== true) {
      mismatches.push("requiredForRelease=false");
    }
    if (mismatches.length > 0) {
      const check = makeCheck(
        `manual-prerequisite:${required.id}`,
        "fail",
        `Manual prerequisite "${required.id}" is not release-blocking or has unexpected fields: ${mismatches.join(", ")}.`
      );
      checks.push(check);
      addIssue(issues, check);
      continue;
    }
    checks.push(makeCheck(
      `manual-prerequisite:${required.id}`,
      "pass",
      `Release manifest declares required ${required.worker} secret "${required.name}" without exposing a value.`
    ));
  }
}

function checkAiReplayDurableObject(context, checks, issues) {
  const workerManifest = getWorkerManifest(context, REQUIRED_AI_DURABLE_OBJECT.worker);
  const wrangler = context?.workerConfigs?.[REQUIRED_AI_DURABLE_OBJECT.worker]?.wrangler || null;

  const manifestBinding = workerManifest?.bindings?.durableObjects?.[REQUIRED_AI_DURABLE_OBJECT.binding] || null;
  if (!manifestBinding || manifestBinding.className !== REQUIRED_AI_DURABLE_OBJECT.className) {
    const check = makeCheck(
      "ai-service-auth-replay:manifest-binding",
      "fail",
      `Release manifest must declare ${REQUIRED_AI_DURABLE_OBJECT.binding} as ${REQUIRED_AI_DURABLE_OBJECT.className}.`
    );
    checks.push(check);
    addIssue(issues, check);
  } else {
    checks.push(makeCheck(
      "ai-service-auth-replay:manifest-binding",
      "pass",
      `Release manifest declares ${REQUIRED_AI_DURABLE_OBJECT.binding}.`
    ));
  }

  const wranglerBinding = findNamedBinding(wrangler?.durable_objects?.bindings, REQUIRED_AI_DURABLE_OBJECT.binding);
  if (!wranglerBinding || wranglerBinding.class_name !== REQUIRED_AI_DURABLE_OBJECT.className) {
    const check = makeCheck(
      "ai-service-auth-replay:wrangler-binding",
      "fail",
      `AI wrangler config must declare Durable Object binding ${REQUIRED_AI_DURABLE_OBJECT.binding}.`
    );
    checks.push(check);
    addIssue(issues, check);
  } else {
    checks.push(makeCheck(
      "ai-service-auth-replay:wrangler-binding",
      "pass",
      `AI wrangler config declares ${REQUIRED_AI_DURABLE_OBJECT.binding}.`
    ));
  }

  const manifestMigration = findMigration(workerManifest?.migrations, REQUIRED_AI_DURABLE_OBJECT.migrationTag);
  if (!manifestMigration?.newSqliteClasses?.includes(REQUIRED_AI_DURABLE_OBJECT.className)) {
    const check = makeCheck(
      "ai-service-auth-replay:manifest-migration",
      "fail",
      `Release manifest must include migration ${REQUIRED_AI_DURABLE_OBJECT.migrationTag}.`
    );
    checks.push(check);
    addIssue(issues, check);
  } else {
    checks.push(makeCheck(
      "ai-service-auth-replay:manifest-migration",
      "pass",
      `Release manifest declares migration ${REQUIRED_AI_DURABLE_OBJECT.migrationTag}.`
    ));
  }

  const wranglerMigration = findMigration(wrangler?.migrations, REQUIRED_AI_DURABLE_OBJECT.migrationTag);
  if (!wranglerMigration?.new_sqlite_classes?.includes(REQUIRED_AI_DURABLE_OBJECT.className)) {
    const check = makeCheck(
      "ai-service-auth-replay:wrangler-migration",
      "fail",
      `AI wrangler config must include Durable Object migration ${REQUIRED_AI_DURABLE_OBJECT.migrationTag}.`
    );
    checks.push(check);
    addIssue(issues, check);
  } else {
    checks.push(makeCheck(
      "ai-service-auth-replay:wrangler-migration",
      "pass",
      `AI wrangler config declares migration ${REQUIRED_AI_DURABLE_OBJECT.migrationTag}.`
    ));
  }
}

function checkAuthCriticalBindings(context, checks, issues) {
  const workerManifest = getWorkerManifest(context, "auth");
  for (const bindingName of REQUIRED_AUTH_BINDINGS) {
    if (!hasManifestBinding(workerManifest, bindingName)) {
      const check = makeCheck(
        `auth-binding:${bindingName}:manifest`,
        "fail",
        `Release manifest is missing required auth binding "${bindingName}".`
      );
      checks.push(check);
      addIssue(issues, check);
      continue;
    }
    checks.push(makeCheck(
      `auth-binding:${bindingName}:manifest`,
      "pass",
      `Release manifest declares auth binding "${bindingName}".`
    ));
  }
}

export function validateCloudflareDeployPrereqs(context, options = {}) {
  const checks = [];
  const issues = [];
  const releaseIssues = validateReleaseCompatibility(context);
  for (const issue of releaseIssues) {
    const check = makeCheck("release-compat", "fail", issue);
    checks.push(check);
    addIssue(issues, check);
  }
  if (releaseIssues.length === 0) {
    checks.push(makeCheck("release-compat", "pass", "Release compatibility contract is valid."));
  }

  checkRequiredManualPrerequisites(context, checks, issues);
  checkAiReplayDurableObject(context, checks, issues);
  checkAuthCriticalBindings(context, checks, issues);

  const live = validateLiveCloudflarePrereqs(context, options);
  for (const check of live.checks) {
    checks.push(check);
  }
  for (const issue of live.issues) {
    issues.push(issue);
  }

  const liveManualChecks = checks.filter((check) => check.live === true && check.status === "manual");
  const productionBlockers = [
    ...(live.status === "skipped"
      ? ["Live Cloudflare secret/resource validation was skipped; production deploy requires manual or live verification."]
      : []),
    ...(live.status === "failed"
      ? live.issues.map((issue) => issue.message)
      : []),
    ...liveManualChecks.map((check) => check.message),
  ];
  const productionDeployReady = issues.filter((issue) => issue.severity === "error").length === 0
    && live.status === "passed"
    && productionBlockers.length === 0;
  if (options.requireProductionReady === true && !productionDeployReady) {
    const check = makeCheck(
      "production-deploy-ready",
      "fail",
      "Production deploy readiness was required, but live/manual Cloudflare prerequisites are not fully verified.",
      { live: true }
    );
    checks.push(check);
    addIssue(issues, check);
  }
  const blockingIssues = issues.filter((issue) => issue.severity === "error");
  return {
    ok: blockingIssues.length === 0,
    productionDeployReady,
    repoConfigReady: issues.filter((issue) => issue.severity === "error" && !issue.live).length === 0,
    liveValidation: live.status,
    checks,
    issues,
    productionBlockers,
  };
}

function runWranglerSecretList(workerId, workerConfig, runner = spawnSync) {
  const result = runner("npx", [
    "wrangler",
    "secret",
    "list",
    "--config",
    workerConfig.wranglerPath,
    "--json",
  ], {
    cwd: workerConfig.cwd || undefined,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `wrangler secret list failed for ${workerId}`);
  }
  const parsed = JSON.parse(result.stdout || "[]");
  if (!Array.isArray(parsed)) {
    throw new Error(`wrangler secret list returned non-array JSON for ${workerId}`);
  }
  return new Set(parsed.map((entry) => entry?.name).filter(Boolean));
}

export function validateLiveCloudflarePrereqs(context, options = {}) {
  const checks = [];
  const issues = [];
  const liveRequested = options.live === true;
  const requireLive = options.requireLive === true;
  const runner = options.runner || spawnSync;

  if (!liveRequested) {
    const check = makeCheck(
      "live-cloudflare-validation",
      requireLive ? "fail" : "skipped",
      "Live Cloudflare validation was not requested. Repo config was validated, but production deploy still requires live/manual secret and binding verification.",
      { live: true }
    );
    checks.push(check);
    if (requireLive) {
      issues.push({
        severity: "error",
        id: check.id,
        message: check.message,
        live: true,
      });
      return { status: "failed", checks, issues };
    }
    return { status: "skipped", checks, issues };
  }

  try {
    for (const required of REQUIRED_MANUAL_PREREQUISITES.filter((entry) => entry.kind === "secret")) {
      const workerConfig = context?.workerConfigs?.[required.worker];
      const secretNames = runWranglerSecretList(required.worker, workerConfig, runner);
      const hasSecret = secretNames.has(required.name);
      const check = makeCheck(
        `live-secret:${required.worker}:${required.name}`,
        hasSecret ? "pass" : "fail",
        hasSecret
          ? `Live Cloudflare secret name is present for ${required.worker}/${required.name}; value was not read.`
          : `Live Cloudflare secret name is missing for ${required.worker}/${required.name}.`,
        { live: true }
      );
      checks.push(check);
      if (!hasSecret) {
        issues.push({
          severity: "error",
          id: check.id,
          message: check.message,
          live: true,
        });
      }
    }
  } catch (error) {
    const check = makeCheck(
      "live-cloudflare-validation",
      "fail",
      `Live Cloudflare validation failed: ${error.message || String(error)}`,
      { live: true }
    );
    checks.push(check);
    issues.push({
      severity: "error",
      id: check.id,
      message: check.message,
      live: true,
    });
  }

  if (issues.length > 0) {
    return { status: "failed", checks, issues };
  }
  checks.push(makeCheck(
    "live-cloudflare-resource-validation",
    "manual",
    "Wrangler secret names were checked. Durable Object migration/resource deployment still requires staging verification; no secret values were read.",
    { live: true }
  ));
  return { status: "passed", checks, issues };
}

export function loadCloudflareDeployPrereqContext(repoRoot) {
  const context = loadReleaseCompatibilityContext(repoRoot);
  context.repoRoot = repoRoot;
  return context;
}
