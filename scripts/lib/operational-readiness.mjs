import fs from "node:fs";
import path from "node:path";

export const REQUIRED_OPERATIONAL_DOCS = Object.freeze([
  "PHASE1F_OPERATIONAL_READINESS_REPORT.md",
  "docs/OBSERVABILITY_EVENTS.md",
  "docs/SLO_ALERT_BASELINE.md",
  "docs/BACKUP_RESTORE_DRILL.md",
]);

export const REQUIRED_RUNBOOKS = Object.freeze([
  "docs/runbooks/auth-worker-incident.md",
  "docs/runbooks/ai-worker-incident.md",
  "docs/runbooks/async-video-jobs-incident.md",
  "docs/runbooks/d1-incident.md",
  "docs/runbooks/r2-media-incident.md",
  "docs/runbooks/queue-backlog-incident.md",
  "docs/runbooks/cloudflare-secret-mismatch.md",
  "docs/runbooks/admin-mfa-lockout.md",
  "docs/runbooks/contact-worker-incident.md",
  "docs/runbooks/release-rollback.md",
]);

const HEALTH_TARGETS = Object.freeze([
  {
    id: "auth",
    flag: "--auth-base-url",
    env: "AUTH_BASE_URL",
    fallbackEnv: "BITBI_BASE_URL",
    useSharedBaseUrl: true,
    path: "/api/health",
  },
  {
    id: "ai",
    flag: "--ai-base-url",
    env: "AI_BASE_URL",
    path: "/health",
  },
  {
    id: "contact",
    flag: "--contact-base-url",
    env: "CONTACT_BASE_URL",
    path: "/health",
  },
]);

export const SECURITY_HEADER_REQUIREMENTS = Object.freeze([
  {
    name: "x-content-type-options",
    expected: "nosniff",
    required: true,
    source: "worker-or-dashboard",
  },
  {
    name: "referrer-policy",
    required: false,
    source: "dashboard-transform-rule",
  },
  {
    name: "permissions-policy",
    required: false,
    source: "dashboard-transform-rule",
  },
  {
    name: "content-security-policy",
    required: false,
    source: "future-repo-or-dashboard-policy",
  },
]);

function getFlagValue(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : "";
}

export function hasFlag(args, flag) {
  return args.includes(flag);
}

export function sanitizeUrlForDisplay(value) {
  try {
    return new URL(value).origin;
  } catch {
    return "[invalid-url]";
  }
}

function buildUrl(baseUrl, pathname) {
  const url = new URL(baseUrl);
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function buildHealthTargets({ args = [], env = process.env } = {}) {
  const sharedBaseUrl = getFlagValue(args, "--base-url") || "";
  const targets = [];

  for (const target of HEALTH_TARGETS) {
    const explicit = getFlagValue(args, target.flag);
    const envValue = env[target.env] || (target.fallbackEnv ? env[target.fallbackEnv] : "");
    const baseUrl = explicit || envValue || (target.useSharedBaseUrl ? sharedBaseUrl : "");
    if (!baseUrl) continue;
    try {
      targets.push({
        id: target.id,
        url: buildUrl(baseUrl, target.path),
      });
    } catch {
      targets.push({
        id: target.id,
        url: null,
        error: `Invalid ${target.id} base URL.`,
      });
    }
  }

  return targets;
}

export async function evaluateHealthTargets({ targets, fetchImpl = globalThis.fetch, requireLive = false } = {}) {
  if (!Array.isArray(targets) || targets.length === 0) {
    return {
      ok: !requireLive,
      skipped: true,
      checks: [{
        id: "live-health",
        status: requireLive ? "FAIL" : "SKIPPED",
        message: requireLive
          ? "No live health URL was configured."
          : "No live health URL was configured; live health checks skipped.",
      }],
    };
  }

  const checks = [];
  for (const target of targets) {
    if (target.error || !target.url) {
      checks.push({
        id: target.id,
        status: "FAIL",
        message: target.error || "Missing target URL.",
      });
      continue;
    }

    try {
      const response = await fetchImpl(target.url, {
        method: "GET",
        headers: { "accept": "application/json" },
      });
      const status = Number(response?.status || 0);
      checks.push({
        id: target.id,
        status: status >= 200 && status < 300 ? "PASS" : "FAIL",
        message: `${target.id} health returned ${status || "no status"} at ${sanitizeUrlForDisplay(target.url)}.`,
      });
    } catch (error) {
      checks.push({
        id: target.id,
        status: "FAIL",
        message: `${target.id} health request failed at ${sanitizeUrlForDisplay(target.url)}: ${error?.name || "Error"}.`,
      });
    }
  }

  return {
    ok: checks.every((check) => check.status === "PASS"),
    skipped: false,
    checks,
  };
}

export function getSecurityHeaderBaseUrl({ args = [], env = process.env } = {}) {
  return getFlagValue(args, "--base-url") || env.BITBI_BASE_URL || "";
}

export async function evaluateSecurityHeaders({ baseUrl, fetchImpl = globalThis.fetch, requireLive = false } = {}) {
  if (!baseUrl) {
    return {
      ok: !requireLive,
      skipped: true,
      checks: [{
        id: "live-security-headers",
        status: requireLive ? "FAIL" : "SKIPPED",
        message: requireLive
          ? "No public base URL was configured."
          : "No public base URL was configured; live header checks skipped.",
      }],
    };
  }

  let url;
  try {
    url = buildUrl(baseUrl, "/");
  } catch {
    return {
      ok: false,
      skipped: false,
      checks: [{
        id: "live-security-headers",
        status: "FAIL",
        message: "Invalid public base URL.",
      }],
    };
  }

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { "accept": "text/html,*/*" },
    });
    const checks = [];
    const status = Number(response?.status || 0);
    checks.push({
      id: "static-status",
      status: status >= 200 && status < 400 ? "PASS" : "FAIL",
      message: `Static site returned ${status || "no status"} at ${sanitizeUrlForDisplay(url)}.`,
    });

    for (const requirement of SECURITY_HEADER_REQUIREMENTS) {
      const actual = response?.headers?.get?.(requirement.name) || "";
      if (!actual) {
        checks.push({
          id: `header:${requirement.name}`,
          status: requirement.required ? "FAIL" : "MANUAL",
          message: requirement.required
            ? `Missing required security header ${requirement.name}.`
            : `Header ${requirement.name} is not repo-verified; manual dashboard verification remains required.`,
        });
        continue;
      }
      if (requirement.expected && actual.toLowerCase() !== requirement.expected.toLowerCase()) {
        checks.push({
          id: `header:${requirement.name}`,
          status: requirement.required ? "FAIL" : "MANUAL",
          message: `Header ${requirement.name} has unexpected value.`,
        });
        continue;
      }
      checks.push({
        id: `header:${requirement.name}`,
        status: "PASS",
        message: `Header ${requirement.name} is present.`,
      });
    }

    return {
      ok: checks.every((check) => check.status === "PASS" || check.status === "MANUAL"),
      skipped: false,
      checks,
    };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      checks: [{
        id: "live-security-headers",
        status: "FAIL",
        message: `Security header request failed at ${sanitizeUrlForDisplay(url)}: ${error?.name || "Error"}.`,
      }],
    };
  }
}

export function validateOperationalReadinessFiles({ repoRoot } = {}) {
  const requiredFiles = [...REQUIRED_OPERATIONAL_DOCS, ...REQUIRED_RUNBOOKS];
  const checks = requiredFiles.map((relativePath) => {
    const absolutePath = path.join(repoRoot, relativePath);
    return {
      id: relativePath,
      status: fs.existsSync(absolutePath) ? "PASS" : "FAIL",
      message: fs.existsSync(absolutePath)
        ? `${relativePath} exists.`
        : `${relativePath} is missing.`,
    };
  });
  return {
    ok: checks.every((check) => check.status === "PASS"),
    checks,
  };
}

function printChecks(result, { stdout = console.log } = {}) {
  for (const check of result.checks || []) {
    stdout(`- ${check.status} ${check.id}: ${check.message}`);
  }
}

export async function runLiveHealthCli({
  args = process.argv.slice(2),
  env = process.env,
  fetchImpl = globalThis.fetch,
  stdout = console.log,
} = {}) {
  const requireLive = hasFlag(args, "--require-live");
  const result = await evaluateHealthTargets({
    targets: buildHealthTargets({ args, env }),
    fetchImpl,
    requireLive,
  });
  stdout("Live health check");
  printChecks(result, { stdout });
  return result.ok ? 0 : 1;
}

export async function runSecurityHeadersCli({
  args = process.argv.slice(2),
  env = process.env,
  fetchImpl = globalThis.fetch,
  stdout = console.log,
} = {}) {
  const requireLive = hasFlag(args, "--require-live");
  const result = await evaluateSecurityHeaders({
    baseUrl: getSecurityHeaderBaseUrl({ args, env }),
    fetchImpl,
    requireLive,
  });
  stdout("Live security header check");
  printChecks(result, { stdout });
  return result.ok ? 0 : 1;
}

export function runOperationalReadinessCli({
  repoRoot,
  stdout = console.log,
} = {}) {
  const result = validateOperationalReadinessFiles({ repoRoot });
  stdout("Operational readiness repo check");
  printChecks(result, { stdout });
  return result.ok ? 0 : 1;
}
