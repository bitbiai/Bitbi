import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_LOCAL_CHECKS = Object.freeze([
  ["npm", "run", "check:doc-currentness"],
  ["npm", "run", "validate:release"],
]);

const STRIPE_TESTMODE_ENV_NAMES = Object.freeze([
  "STRIPE_MODE",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_CHECKOUT_SUCCESS_URL",
  "STRIPE_CHECKOUT_CANCEL_URL",
  "ENABLE_ADMIN_STRIPE_TEST_CHECKOUT",
]);

const STRIPE_LIVE_ENV_NAMES = Object.freeze([
  "ENABLE_LIVE_STRIPE_CREDIT_PACKS",
  "STRIPE_LIVE_SECRET_KEY",
  "STRIPE_LIVE_WEBHOOK_SECRET",
  "STRIPE_LIVE_CHECKOUT_SUCCESS_URL",
  "STRIPE_LIVE_CHECKOUT_CANCEL_URL",
  "ENABLE_LIVE_STRIPE_SUBSCRIPTIONS",
  "STRIPE_LIVE_SUBSCRIPTION_PRICE_ID",
  "STRIPE_LIVE_SUBSCRIPTION_SUCCESS_URL",
  "STRIPE_LIVE_SUBSCRIPTION_CANCEL_URL",
]);

const LIVE_EVIDENCE_ENV_NAMES = Object.freeze([
  "BITBI_READINESS_LIVE_BASE_URL",
  "BITBI_READINESS_STATIC_BASE_URL",
  "BITBI_READINESS_ADMIN_COOKIE",
]);

const SAFE_HEADER_NAMES = Object.freeze([
  "Cache-Control",
  "Content-Type",
  "Content-Security-Policy",
  "X-Content-Type-Options",
  "X-Frame-Options",
  "Referrer-Policy",
  "Permissions-Policy",
  "Strict-Transport-Security",
]);

const EVIDENCE_OUTPUT_DIR = "docs/production-readiness/evidence";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readTextIfExists(repoRoot, relativePath) {
  try {
    return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
  } catch {
    return "";
  }
}

function runGit(repoRoot, args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) return null;
  return String(result.stdout || "").trim();
}

function getStatusSummary(repoRoot) {
  const status = runGit(repoRoot, ["status", "--short"]);
  if (status === null || status === "") {
    return {
      available: status !== null,
      clean: status === "",
      total: 0,
      modified: 0,
      added: 0,
      deleted: 0,
      renamed: 0,
      untracked: 0,
      other: 0,
    };
  }

  const summary = {
    available: true,
    clean: false,
    total: 0,
    modified: 0,
    added: 0,
    deleted: 0,
    renamed: 0,
    untracked: 0,
    other: 0,
  };

  for (const line of status.split(/\r?\n/).filter(Boolean)) {
    summary.total += 1;
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

function envPresence(env, names) {
  return names.map((name) => ({
    name,
    present: Object.prototype.hasOwnProperty.call(env, name) && String(env[name] || "") !== "",
  }));
}

function collectRequiredSecrets(manifest) {
  return (manifest?.release?.manualPrerequisites || [])
    .filter((entry) => entry?.kind === "secret" && entry?.requiredForRelease === true && entry?.name)
    .map((entry) => entry.name)
    .filter((name, index, names) => names.indexOf(name) === index)
    .sort();
}

function collectWorkerBindings(manifest, workerId) {
  const worker = manifest?.release?.workers?.[workerId] || {};
  const bindings = worker.bindings || {};
  return {
    ai: bindings.ai || null,
    images: bindings.images || null,
    d1: Object.keys(bindings.d1 || {}).sort(),
    r2: Object.keys(bindings.r2 || {}).sort(),
    services: Object.keys(bindings.services || {}).sort(),
    durableObjects: Object.keys(bindings.durableObjects || {}).sort(),
    queues: {
      producers: Object.keys(bindings.queues?.producers || {}).sort(),
      consumers: (bindings.queues?.consumers || []).map((entry) => entry.queue).filter(Boolean).sort(),
    },
  };
}

function runLocalChecks(repoRoot, checks = DEFAULT_LOCAL_CHECKS) {
  return checks.map((command) => {
    const [bin, ...args] = command;
    const result = spawnSync(bin, args, {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    return {
      command: command.join(" "),
      status: result.status === 0 ? "PASS" : "FAIL",
      code: result.status,
    };
  });
}

function localContractResult({ id, label, classification, status, evidence, sideEffects = "none" }) {
  return {
    id,
    label,
    classification,
    status,
    sideEffects,
    evidence,
  };
}

function collectLocalSafetyContracts(repoRoot, manifest) {
  const authIndex = readTextIfExists(repoRoot, "workers/auth/src/index.js");
  const aiPolicy = readTextIfExists(repoRoot, "workers/ai/src/lib/caller-policy.js");
  const aiUsagePolicy = readTextIfExists(repoRoot, "workers/auth/src/lib/ai-usage-policy.js");
  const storageRedaction = readTextIfExists(repoRoot, "workers/auth/src/lib/storage-key-redaction.js");
  const dataLifecycle = readTextIfExists(repoRoot, "workers/auth/src/lib/data-lifecycle.js");
  const callerPolicyContract = manifest?.release?.authAiCallerPolicy;

  return [
    localContractResult({
      id: "auth-ai-caller-policy-release-contract",
      label: "Auth/AI caller-policy rollout contract",
      classification: "local-only",
      status: callerPolicyContract?.version === "auth-ai-caller-policy-v1" ? "PASS" : "FAIL",
      evidence: callerPolicyContract?.version === "auth-ai-caller-policy-v1"
        ? "config/release-compat.json declares the Auth/AI caller-policy compatibility contract."
        : "config/release-compat.json does not declare the Auth/AI caller-policy compatibility contract.",
    }),
    localContractResult({
      id: "ai-worker-missing-caller-policy-fail-closed",
      label: "AI Worker missing caller-policy rejection",
      classification: "local-only",
      status: aiPolicy.includes("ai_caller_policy_required") && aiPolicy.includes("Caller policy is required")
        ? "PASS"
        : "FAIL",
      evidence: "workers/ai/src/lib/caller-policy.js is checked for the missing caller-policy fail-closed response.",
    }),
    localContractResult({
      id: "fetch-metadata-cross-site-write-guard",
      label: "Fetch Metadata cross-site write guard",
      classification: "local-only",
      status: authIndex.includes("Sec-Fetch-Site") && authIndex.includes("cross-site") ? "PASS" : "FAIL",
      evidence: "workers/auth/src/index.js is checked for Sec-Fetch-Site cross-site rejection logic.",
    }),
    localContractResult({
      id: "admin-ai-legacy-unmetered-blocked",
      label: "Admin AI legacy/unclassified cost path blocked",
      classification: "local-only",
      status: aiUsagePolicy.includes("admin_ai_legacy_unmetered_blocked") ? "PASS" : "FAIL",
      evidence: "workers/auth/src/lib/ai-usage-policy.js is checked for the legacy admin AI blocked classification.",
    }),
    localContractResult({
      id: "storage-key-redaction-evidence-path",
      label: "Storage key redaction in evidence serializers",
      classification: "local-only",
      status: storageRedaction.includes("redactStorageObjectKey") && dataLifecycle.includes("sanitizeStorageEvidenceSummary")
        ? "PASS"
        : "FAIL",
      evidence: "storage-key-redaction.js and data-lifecycle evidence serialization are checked for private key redaction helpers.",
    }),
  ];
}

function sanitizeHeaderValue(value) {
  if (value == null) return null;
  const normalized = String(value).replace(/[\r\n]+/g, " ").trim();
  return normalized.length > 240 ? `${normalized.slice(0, 237)}...` : normalized;
}

function collectSafeHeaders(headers) {
  const out = {};
  for (const name of SAFE_HEADER_NAMES) {
    const value = headers?.get?.(name) ?? headers?.get?.(name.toLowerCase()) ?? null;
    if (value != null) out[name] = sanitizeHeaderValue(value);
  }
  return out;
}

function normalizeOperatorUrl(input, { appendPath = null } = {}) {
  if (!input) return null;
  const url = new URL(String(input));
  if (url.username || url.password) {
    throw new Error("Readiness evidence URLs must not include usernames or passwords.");
  }
  url.search = "";
  url.hash = "";
  if (appendPath && url.pathname !== appendPath && !url.pathname.endsWith(appendPath)) {
    url.pathname = appendPath;
  }
  return url;
}

function safeReadinessStatusFields(parsed) {
  const fields = {};
  if (typeof parsed?.ok === "boolean") fields.ok = parsed.ok;
  if (typeof parsed?.version === "string") fields.version = parsed.version;
  const latestAuthMigration = parsed?.releaseTruth?.latestAuthMigration;
  if (typeof latestAuthMigration === "string") fields.latestAuthMigration = latestAuthMigration;
  const deployVerificationRequired = parsed?.releaseTruth?.deployVerificationRequired;
  if (typeof deployVerificationRequired === "boolean") {
    fields.deployVerificationRequired = deployVerificationRequired;
  }
  const liveEvidenceStatus = parsed?.liveEvidenceState?.status;
  if (typeof liveEvidenceStatus === "string") fields.liveEvidenceStatus = liveEvidenceStatus;
  const resetGate = Array.isArray(parsed?.runtimeSafetyGates)
    ? parsed.runtimeSafetyGates.find((entry) => entry?.id === "legacy_media_reset_confirmed_execution")
    : null;
  if (resetGate && typeof resetGate.enabled === "boolean") {
    fields.resetConfirmedExecutionEnabled = resetGate.enabled;
  }
  if (Array.isArray(parsed?.blockedClaims)) {
    fields.blockedClaimsCount = parsed.blockedClaims.length;
  }
  return fields;
}

async function safeReadJson(response, mode = "default") {
  try {
    const text = await response.text();
    if (!text.trim()) return { parsed: false, fields: {} };
    const parsed = JSON.parse(text);
    if (mode === "admin-readiness") {
      return { parsed: true, fields: safeReadinessStatusFields(parsed) };
    }
    const fields = {};
    for (const key of ["ok", "service", "status"]) {
      const value = parsed?.[key];
      if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
        fields[key] = value;
      }
    }
    return { parsed: true, fields };
  } catch {
    return { parsed: false, fields: {} };
  }
}

async function collectHttpEvidence({
  id,
  label,
  inputUrl,
  appendPath = null,
  parseJson = false,
  jsonMode = "default",
  headers = {},
  fetchImpl,
}) {
  if (!inputUrl) {
    return {
      id,
      label,
      mode: "skipped",
      reason: "No URL was provided.",
    };
  }

  let url;
  try {
    url = normalizeOperatorUrl(inputUrl, { appendPath });
  } catch (error) {
    return {
      id,
      label,
      mode: "error",
      error: error.message,
    };
  }

  try {
    const response = await fetchImpl(url.href, {
      method: "GET",
      headers,
      redirect: "follow",
    });
    const json = parseJson ? await safeReadJson(response, jsonMode) : { parsed: null, fields: {} };
    let finalOrigin = null;
    try {
      finalOrigin = response.url ? new URL(response.url).origin : url.origin;
    } catch {
      finalOrigin = url.origin;
    }
    return {
      id,
      label,
      mode: "checked",
      method: "GET",
      suppliedOrigin: url.origin,
      finalOrigin,
      status: response.status,
      ok: response.ok,
      headers: collectSafeHeaders(response.headers),
      json,
    };
  } catch (error) {
    return {
      id,
      label,
      mode: "error",
      method: "GET",
      suppliedOrigin: url.origin,
      error: error?.name === "AbortError" ? "Request timed out." : "Read-only HTTP check failed.",
    };
  }
}

function normalizeAdminCookieHeader(value) {
  if (!value) return null;
  const header = String(value).trim();
  if (!header) return null;
  if (/[\r\n\u0000]/.test(header)) {
    throw new Error("BITBI_READINESS_ADMIN_COOKIE must not contain control characters.");
  }
  return header;
}

async function collectAdminReadinessEvidence({ inputUrl, adminCookieHeader, fetchImpl }) {
  if (!inputUrl) {
    return {
      id: "admin-readiness-status",
      label: "Admin readiness status",
      mode: "skipped",
      reason: "No admin readiness URL was provided.",
    };
  }
  if (!adminCookieHeader) {
    return {
      id: "admin-readiness-status",
      label: "Admin readiness status",
      mode: "skipped",
      reason:
        "Admin readiness status was not requested because BITBI_READINESS_ADMIN_COOKIE was not provided. No unauthenticated probe was sent.",
    };
  }

  return collectHttpEvidence({
    id: "admin-readiness-status",
    label: "Admin readiness status",
    inputUrl,
    appendPath: "/api/admin/readiness/status",
    parseJson: true,
    jsonMode: "admin-readiness",
    headers: {
      Accept: "application/json",
      Cookie: adminCookieHeader,
    },
    fetchImpl,
  });
}

async function collectAdminEndpointEvidence({ id, label, inputUrl, appendPath, adminCookieHeader, fetchImpl }) {
  if (!inputUrl) {
    return {
      id,
      label,
      mode: "skipped",
      reason: "No admin base URL was provided.",
    };
  }
  if (!adminCookieHeader) {
    return {
      id,
      label,
      mode: "skipped",
      reason:
        "Admin read-only check was not requested because BITBI_READINESS_ADMIN_COOKIE was not provided. No unauthenticated probe was sent.",
    };
  }

  return collectHttpEvidence({
    id,
    label,
    inputUrl,
    appendPath,
    parseJson: true,
    headers: {
      Accept: "application/json",
      Cookie: adminCookieHeader,
    },
    fetchImpl,
  });
}

async function collectLiveChecks(options) {
  const includeLive = options.includeLive === true;
  const urls = options.urls || {};
  const hasAnyUrl = Boolean(
    urls.staticUrl ||
      urls.authWorkerUrl ||
      urls.aiWorkerUrl ||
      urls.contactWorkerUrl ||
      urls.adminReadinessUrl
  );

  if (!includeLive) {
    return {
      mode: "skipped",
      evidenceCollected: false,
      operatorReviewRequired: true,
      reason: "Live/staging checks are skipped by default. Pass --include-live and explicit URLs to run read-only HTTP checks.",
      results: [],
    };
  }

  if (!hasAnyUrl) {
    return {
      mode: "skipped",
      evidenceCollected: false,
      operatorReviewRequired: true,
      reason: "--include-live was provided, but no explicit URLs were supplied. No live/staging URLs were guessed.",
      results: [],
    };
  }

  let adminCookieHeader = null;
  try {
    adminCookieHeader = normalizeAdminCookieHeader(options.env?.BITBI_READINESS_ADMIN_COOKIE);
  } catch (error) {
    return {
      mode: "error",
      evidenceCollected: false,
      operatorReviewRequired: true,
      reason: error.message,
      results: [],
    };
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return {
      mode: "error",
      evidenceCollected: false,
      operatorReviewRequired: true,
      reason: "No fetch implementation is available for read-only HTTP checks.",
      results: [],
    };
  }

  const results = await Promise.all([
    collectHttpEvidence({
      id: "static-site",
      label: "Static site",
      inputUrl: urls.staticUrl,
      parseJson: false,
      fetchImpl,
    }),
    collectHttpEvidence({
      id: "auth-worker-health",
      label: "Auth Worker health",
      inputUrl: urls.authWorkerUrl,
      appendPath: "/api/health",
      parseJson: true,
      fetchImpl,
    }),
    collectHttpEvidence({
      id: "unknown-api-safe-failure",
      label: "Unknown API safe failure",
      inputUrl: urls.authWorkerUrl,
      appendPath: "/api/__readiness_missing_route__",
      parseJson: true,
      fetchImpl,
    }),
    collectHttpEvidence({
      id: "ai-worker-health",
      label: "AI Worker health",
      inputUrl: urls.aiWorkerUrl,
      appendPath: "/health",
      parseJson: true,
      fetchImpl,
    }),
    collectHttpEvidence({
      id: "contact-worker-health",
      label: "Contact Worker health",
      inputUrl: urls.contactWorkerUrl,
      appendPath: "/health",
      parseJson: true,
      fetchImpl,
    }),
    collectAdminReadinessEvidence({
      inputUrl: urls.adminReadinessUrl,
      adminCookieHeader,
      fetchImpl,
    }),
    collectAdminEndpointEvidence({
      id: "admin-billing-evidence-status",
      label: "Admin billing evidence status",
      inputUrl: urls.adminReadinessUrl,
      appendPath: "/api/admin/billing/evidence/status",
      adminCookieHeader,
      fetchImpl,
    }),
    collectAdminEndpointEvidence({
      id: "admin-operations-timeline",
      label: "Admin operations timeline",
      inputUrl: urls.adminReadinessUrl,
      appendPath: "/api/admin/operations/timeline",
      adminCookieHeader,
      fetchImpl,
    }),
    collectAdminEndpointEvidence({
      id: "admin-tenant-domain-evidence",
      label: "Admin tenant domain evidence",
      inputUrl: urls.adminReadinessUrl,
      appendPath: "/api/admin/tenant-assets/domains/evidence",
      adminCookieHeader,
      fetchImpl,
    }),
  ]);

  return {
    mode: "checked",
    evidenceCollected: results.some((result) => result.mode === "checked"),
    operatorReviewRequired: true,
    reason: "Read-only live/staging HTTP checks were run only for explicitly supplied URLs. Human review is still required.",
    results,
  };
}

export async function collectReadinessEvidence(options = {}) {
  const repoRoot = options.repoRoot || process.cwd();
  const env = options.env || process.env;
  const releaseCompatPath = path.join(repoRoot, "config", "release-compat.json");
  const manifest = readJson(releaseCompatPath);
  const latestAuthMigration = manifest?.release?.schemaCheckpoints?.auth?.latest || "unknown";
  const requiredSecretNames = collectRequiredSecrets(manifest);
  const runChecks = options.runLocalChecks === true;
  const liveChecks = await collectLiveChecks({ ...options, env });
  const localSafetyContracts = collectLocalSafetyContracts(repoRoot, manifest);

  return {
    generatedAt: new Date().toISOString(),
    verdict: "BLOCKED",
    evidenceCollected: liveChecks.evidenceCollected === true,
    operatorReviewRequired: true,
    repo: {
      branch: runGit(repoRoot, ["branch", "--show-current"]) || "unknown",
      commit: runGit(repoRoot, ["rev-parse", "HEAD"]) || "unknown",
      status: getStatusSummary(repoRoot),
    },
    release: {
      latestAuthMigration,
      databaseName: manifest?.release?.schemaCheckpoints?.auth?.databaseName || "unknown",
    },
    bindings: {
      auth: collectWorkerBindings(manifest, "auth"),
      ai: collectWorkerBindings(manifest, "ai"),
      contact: collectWorkerBindings(manifest, "contact"),
    },
    envPresence: {
      requiredSecrets: envPresence(env, requiredSecretNames),
      stripeTestmode: envPresence(env, STRIPE_TESTMODE_ENV_NAMES),
      stripeLive: envPresence(env, STRIPE_LIVE_ENV_NAMES),
      liveEvidence: envPresence(env, LIVE_EVIDENCE_ENV_NAMES),
    },
    localChecks: runChecks
      ? { mode: "run", results: runLocalChecks(repoRoot, options.localChecks || DEFAULT_LOCAL_CHECKS) }
      : { mode: "skipped", reason: "Safe local checks are not run by default; pass --run-local-checks to run the deterministic local subset." },
    localSafetyContracts,
    liveChecks,
    blockers: [
      liveChecks.evidenceCollected
        ? "Read-only live/staging HTTP evidence was collected, but Cloudflare resource, secret, and migration evidence remains unverified by this helper."
        : "No live/staging Cloudflare validation evidence was collected by this helper.",
      "No remote D1 migration status evidence was collected by this helper.",
      "Admin readiness, billing evidence, operations timeline, and tenant domain checks require an operator-provided admin cookie and remain skipped otherwise.",
      "No Stripe Testmode checkout/webhook evidence was collected by this helper.",
      "No Stripe live credit-pack or BITBI Pro subscription canary evidence was collected by this helper.",
      "No restore drill, alert, WAF, static header, or RUM dashboard evidence was collected by this helper.",
    ],
  };
}

export function resolveEvidenceOutputPath(repoRoot, outputPath, { force = false } = {}) {
  if (!outputPath) throw new Error("An output path is required.");
  const allowedRoot = path.resolve(repoRoot, EVIDENCE_OUTPUT_DIR);
  const target = path.resolve(repoRoot, outputPath);
  if (target !== allowedRoot && !target.startsWith(`${allowedRoot}${path.sep}`)) {
    throw new Error(`Output path must be under ${EVIDENCE_OUTPUT_DIR}/`);
  }
  if (fs.existsSync(target) && !force) {
    throw new Error("Output file already exists. Pass --force to overwrite.");
  }
  return target;
}

export function writeReadinessEvidenceMarkdown(repoRoot, outputPath, markdown, { force = false } = {}) {
  const target = resolveEvidenceOutputPath(repoRoot, outputPath, { force });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, markdown);
  return path.relative(repoRoot, target).replace(/\\/g, "/");
}

function formatStatusSummary(status) {
  if (!status.available) return "unknown (git status unavailable)";
  if (status.clean) return "clean";
  return `dirty (${status.total} entries: ${status.modified} modified, ${status.added} added, ${status.deleted} deleted, ${status.renamed} renamed, ${status.untracked} untracked, ${status.other} other)`;
}

function formatPresenceRows(rows) {
  if (!rows.length) return "| None declared | missing |\n";
  return rows
    .map((entry) => `| \`${entry.name}\` | ${entry.present ? "present (value redacted)" : "missing"} |`)
    .join("\n");
}

function formatList(values) {
  if (!values || values.length === 0) return "none declared";
  return values.map((value) => `\`${value}\``).join(", ");
}

function formatBindings(bindings) {
  return [
    `- AI binding: ${bindings.ai ? `\`${bindings.ai}\`` : "none declared"}`,
    `- Images binding: ${bindings.images ? `\`${bindings.images}\`` : "none declared"}`,
    `- D1 bindings: ${formatList(bindings.d1)}`,
    `- R2 bindings: ${formatList(bindings.r2)}`,
    `- Service bindings: ${formatList(bindings.services)}`,
    `- Durable Objects: ${formatList(bindings.durableObjects)}`,
    `- Queue producers: ${formatList(bindings.queues.producers)}`,
    `- Queue consumers: ${formatList(bindings.queues.consumers)}`,
  ].join("\n");
}

function formatLocalChecks(localChecks) {
  if (localChecks.mode === "skipped") return `Skipped. ${localChecks.reason}`;
  return localChecks.results
    .map((entry) => `- \`${entry.command}\`: ${entry.status}${entry.code === 0 ? "" : ` (exit ${entry.code})`}`)
    .join("\n");
}

function formatLocalSafetyContracts(contracts) {
  if (!Array.isArray(contracts) || contracts.length === 0) {
    return "| None | pending | local-only | none | No local safety contracts were evaluated. |\n";
  }
  return contracts
    .map((entry) =>
      `| \`${entry.id}\` | ${entry.status} | ${entry.classification} | ${entry.sideEffects} | ${entry.evidence} |`
    )
    .join("\n");
}

function formatJsonResult(json) {
  if (!json || json.parsed == null) return "not parsed";
  if (!json.parsed) return "parse failed";
  const entries = Object.entries(json.fields || {});
  if (!entries.length) return "parsed; no public-safe fields found";
  return entries.map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(", ");
}

function formatHeaderRows(headers) {
  const entries = Object.entries(headers || {});
  if (!entries.length) return "  - Safe headers: none found";
  return [
    "  - Safe headers:",
    ...entries.map(([name, value]) => `    - \`${name}\`: \`${value}\``),
  ].join("\n");
}

function formatLiveResults(liveChecks) {
  const prefix = `${liveChecks.mode.toUpperCase()}: ${liveChecks.reason}`;
  if (!Array.isArray(liveChecks.results) || liveChecks.results.length === 0) return prefix;
  return [
    prefix,
    "",
    ...liveChecks.results.map((result) => {
      if (result.mode === "skipped") {
        return `- ${result.label}: SKIPPED (${result.reason})`;
      }
      if (result.mode === "error") {
        return `- ${result.label}: ERROR (${result.error})`;
      }
      return [
        `- ${result.label}: checked`,
        `  - Method: \`${result.method}\``,
        `  - Supplied origin: \`${result.suppliedOrigin}\``,
        `  - Final origin: \`${result.finalOrigin}\``,
        `  - HTTP status: \`${result.status}\``,
        `  - OK: \`${result.ok}\``,
        `  - JSON: ${formatJsonResult(result.json)}`,
        formatHeaderRows(result.headers),
      ].join("\n");
    }),
  ].join("\n");
}

export function renderReadinessEvidenceMarkdown(evidence) {
  return `# BITBI Production/Staging Evidence Pack

Generated at: ${evidence.generatedAt}

Final verdict: **${evidence.verdict}**

Evidence collected: **${evidence.evidenceCollected ? "true" : "false"}**

Operator review required: **${evidence.operatorReviewRequired ? "true" : "false"}**

This evidence pack is local and redacted by default. It is not a production readiness claim or live billing readiness claim.

## Repo Baseline

- Branch: \`${evidence.repo.branch}\`
- Commit: \`${evidence.repo.commit}\`
- Worktree: ${formatStatusSummary(evidence.repo.status)}
- Latest auth D1 migration from \`config/release-compat.json\`: \`${evidence.release.latestAuthMigration}\`
- Auth D1 database name from release config: \`${evidence.release.databaseName}\`

## Local Checks

${formatLocalChecks(evidence.localChecks)}

## Local Safety Canary Contracts

These checks inspect repository code/config only. They do not call live endpoints, Stripe, providers, R2, D1, queues, or Cloudflare APIs.

| ID | Status | Classification | Side effects | Evidence |
| --- | --- | --- | --- | --- |
${formatLocalSafetyContracts(evidence.localSafetyContracts)}

## Cloudflare Auth Worker Binding Declarations

${formatBindings(evidence.bindings.auth)}

## Cloudflare AI Worker Binding Declarations

${formatBindings(evidence.bindings.ai)}

## Cloudflare Contact Worker Binding Declarations

${formatBindings(evidence.bindings.contact)}

## Required Secret Presence

Values are never printed.

| Name | Status |
| --- | --- |
${formatPresenceRows(evidence.envPresence.requiredSecrets)}

## Stripe Testmode Configuration Presence

Values are never printed.

| Name | Status |
| --- | --- |
${formatPresenceRows(evidence.envPresence.stripeTestmode)}

## Stripe Live Configuration Presence

Values are never printed.

| Name | Status |
| --- | --- |
${formatPresenceRows(evidence.envPresence.stripeLive)}

## Live/Staging Evidence Inputs

Values are never printed.

| Name | Status |
| --- | --- |
${formatPresenceRows(evidence.envPresence.liveEvidence)}

## Live Checks

${formatLiveResults(evidence.liveChecks)}

## Blockers

${evidence.blockers.map((blocker) => `- ${blocker}`).join("\n")}
`;
}
