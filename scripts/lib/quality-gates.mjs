import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_EXCLUDED_DIRS = new Set([
  ".git",
  ".wrangler",
  "_site",
  "node_modules",
  "playwright-report",
  "test-results",
]);

const TEXT_FILE_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsonc",
  ".md",
  ".mjs",
  ".sql",
  ".txt",
  ".yaml",
  ".yml",
]);

const SECRET_PATTERNS = [
  {
    id: "private-key",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----/,
  },
  {
    id: "openai-or-compatible-key",
    pattern: /\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{20,}\b/,
  },
  {
    id: "resend-key",
    pattern: /\bre_[A-Za-z0-9]{24,}\b/,
  },
  {
    id: "cloudflare-token",
    pattern: /\b(?:CFPAT|cfpat)[A-Za-z0-9_-]{20,}\b/,
  },
  {
    id: "bearer-token",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{30,}\b/i,
  },
];

const GENERIC_SECRET_ASSIGNMENT = /\b(?:api[_-]?key|secret|token|password)\b[^\n:=]{0,40}[:=]\s*["']([A-Za-z0-9._~+/=-]{32,})["']/i;

const SAFE_SECRET_LINE_MARKERS = [
  "AI_SERVICE_AUTH_SECRET",
  "RESEND_API_KEY",
  "SESSION_SECRET",
  "VIDU_API_KEY",
  "process.env",
  "env.",
  "example",
  "placeholder",
  "redacted",
  "dummy",
  "unused",
  "test-",
  "your_",
  "<secret",
];

const DOM_SINK_PATTERNS = [
  { id: "innerHTML", pattern: /\binnerHTML\s*=/g },
  { id: "outerHTML", pattern: /\bouterHTML\s*=/g },
  { id: "insertAdjacentHTML", pattern: /\binsertAdjacentHTML\s*\(/g },
  { id: "document.write", pattern: /\bdocument\.write\s*\(/g },
];

export function normalizeRepoPath(repoRoot, absolutePath) {
  return path.relative(repoRoot, absolutePath).replace(/\\/g, "/");
}

export function walkRepoFiles(repoRoot, {
  extensions = TEXT_FILE_EXTENSIONS,
  excludedDirs = DEFAULT_EXCLUDED_DIRS,
} = {}) {
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (excludedDirs.has(entry.name)) continue;
        walk(path.join(dir, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name);
      if (extensions && !extensions.has(ext)) continue;
      files.push(path.join(dir, entry.name));
    }
  }
  walk(repoRoot);
  return files.sort();
}

function lineIsAllowedSecretExample(line) {
  const normalized = String(line || "").toLowerCase();
  return SAFE_SECRET_LINE_MARKERS.some((marker) => normalized.includes(marker.toLowerCase()));
}

export function scanSecretText(source, file = "(inline)") {
  const violations = [];
  const lines = String(source || "").split("\n");
  for (const [lineIndex, line] of lines.entries()) {
    if (lineIsAllowedSecretExample(line)) continue;
    for (const rule of SECRET_PATTERNS) {
      if (rule.pattern.test(line)) {
        violations.push({
          file,
          line: lineIndex + 1,
          rule: rule.id,
        });
      }
    }
    if (!file.endsWith(".md") && GENERIC_SECRET_ASSIGNMENT.test(line)) {
      violations.push({
        file,
        line: lineIndex + 1,
        rule: "generic-secret-assignment",
      });
    }
  }
  return violations;
}

export function scanRepoForSecrets(repoRoot) {
  const violations = [];
  for (const absolutePath of walkRepoFiles(repoRoot)) {
    const file = normalizeRepoPath(repoRoot, absolutePath);
    const source = fs.readFileSync(absolutePath, "utf8");
    violations.push(...scanSecretText(source, file));
  }
  return violations;
}

export function collectDomSinkCounts(repoRoot) {
  const counts = {};
  const files = walkRepoFiles(repoRoot, {
    extensions: new Set([".html", ".js", ".mjs"]),
  });
  for (const absolutePath of files) {
    const file = normalizeRepoPath(repoRoot, absolutePath);
    const source = fs.readFileSync(absolutePath, "utf8");
    for (const rule of DOM_SINK_PATTERNS) {
      const matches = [...source.matchAll(rule.pattern)];
      if (matches.length === 0) continue;
      counts[file] ||= {};
      counts[file][rule.id] = matches.length;
    }
  }
  return counts;
}

export function scanDomSinksAgainstBaseline(repoRoot, baseline) {
  const current = collectDomSinkCounts(repoRoot);
  const allowed = baseline?.sinks && typeof baseline.sinks === "object" ? baseline.sinks : {};
  const violations = [];
  for (const [file, sinks] of Object.entries(current)) {
    for (const [sink, count] of Object.entries(sinks)) {
      const allowedCount = Number(allowed[file]?.[sink] || 0);
      if (count > allowedCount) {
        violations.push({
          file,
          sink,
          count,
          allowed: allowedCount,
        });
      }
    }
  }
  return violations;
}

export function stableObjectHash(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value, Object.keys(value || {}).sort()))
    .digest("hex");
}

export function validateToolchainFiles(repoRoot) {
  const issues = [];
  const nvmrcPath = path.join(repoRoot, ".nvmrc");
  const packagePath = path.join(repoRoot, "package.json");
  const workflowPath = path.join(repoRoot, ".github/workflows/static.yml");

  if (!fs.existsSync(nvmrcPath)) {
    issues.push(".nvmrc is missing.");
  } else {
    const value = fs.readFileSync(nvmrcPath, "utf8").trim();
    if (value !== "20") {
      issues.push(`.nvmrc must pin Node 20, found ${JSON.stringify(value)}.`);
    }
  }

  const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  if (pkg.engines?.node !== ">=20 <21") {
    issues.push('package.json engines.node must be ">=20 <21".');
  }
  if (pkg.engines?.npm !== ">=10") {
    issues.push('package.json engines.npm must be ">=10".');
  }

  const workflow = fs.readFileSync(workflowPath, "utf8");
  if (!/node-version:\s*20\b/.test(workflow)) {
    issues.push("Static workflow must use Node 20.");
  }

  return issues;
}
