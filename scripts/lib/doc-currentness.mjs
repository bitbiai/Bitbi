import fs from "node:fs";
import path from "node:path";

export const CURRENT_SOURCE_DOC_PATHS = Object.freeze([
  "README.md",
  "CURRENT_IMPLEMENTATION_HANDOFF.md",
  "SAAS_PROGRESS_AND_CURRENT_STATE_REPORT.md",
  "AUDIT_ACTION_PLAN.md",
  "AUDIT_NEXT_LEVEL.md",
  "DATA_INVENTORY.md",
  "docs/DATA_RETENTION_POLICY.md",
  "docs/privacy-data-flow-audit.md",
  "workers/auth/CLAUDE.md",
  "docs/audits/README.md",
  "ALPHA_AUDIT_2026_05_15.md",
]);

const STALE_LATEST_PATTERNS = Object.freeze([
  {
    id: "latest-auth-migration",
    regex: /\b(?:latest|current)\s+(?:auth\s+)?(?:D1\s+)?migration\b.*\b004[06](?:_[a-z0-9_]+)?(?:\.sql)?\b/i,
  },
  {
    id: "latest-auth-d1-migration",
    regex: /\blatest\s+auth\s+D1\s+migration\b.*\b004[06](?:_[a-z0-9_]+)?(?:\.sql)?\b/i,
  },
  {
    id: "auth-migrations-through",
    regex: /\bauth\s+migrations?\b.*\b(?:through|to)\b\s+`?\b004[06](?:_[a-z0-9_]+)?(?:\.sql)?\b`?/i,
  },
  {
    id: "apply-auth-migrations-through",
    regex: /\bapply(?:ing)?\b.*\bauth\s+migrations?\b.*\b(?:through|to)\b\s+`?\b004[06](?:_[a-z0-9_]+)?(?:\.sql)?\b`?/i,
  },
  {
    id: "migrations-numbered-through",
    regex: /\bmigrations?\s+in\s+`?migrations\/?`?.*\bthrough\b\s+`?\b004[06](?:_[a-z0-9_]+)?(?:\.sql)?\b`?/i,
  },
  {
    id: "release-compat-tracks",
    regex: /\brelease\s+compat(?:ibility)?\b.*\b(?:tracks|declares|records|validates)\b.*\b004[06](?:_[a-z0-9_]+)?(?:\.sql)?\b/i,
  },
]);

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function loadLatestAuthMigration(repoRoot) {
  const releaseCompatPath = path.join(repoRoot, "config", "release-compat.json");
  const manifest = readJsonFile(releaseCompatPath);
  const latest = manifest?.release?.schemaCheckpoints?.auth?.latest;
  if (!latest || typeof latest !== "string") {
    throw new Error("config/release-compat.json is missing release.schemaCheckpoints.auth.latest");
  }
  return latest;
}

function normalizePathname(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\.?\//, "");
}

function safeExcerpt(line) {
  const cleaned = String(line || "").replace(/\s+/g, " ").trim();
  return cleaned.length > 180 ? `${cleaned.slice(0, 177)}...` : cleaned;
}

export function scanDocCurrentness(repoRoot, options = {}) {
  const latest = options.latest || loadLatestAuthMigration(repoRoot);
  const currentDocs = (options.currentDocs || CURRENT_SOURCE_DOC_PATHS).map(normalizePathname);
  const requireLatest = options.requireLatest !== false;
  const violations = [];
  const scannedDocs = [];

  for (const relativePath of currentDocs) {
    const absolutePath = path.join(repoRoot, relativePath);
    if (!fs.existsSync(absolutePath)) {
      violations.push({
        type: "missing-current-doc",
        file: relativePath,
        line: null,
        rule: "current-doc-exists",
        message: "Configured current source-of-truth document is missing.",
      });
      continue;
    }

    const text = fs.readFileSync(absolutePath, "utf8");
    scannedDocs.push(relativePath);

    if (requireLatest && !text.includes(latest)) {
      violations.push({
        type: "missing-current-latest",
        file: relativePath,
        line: null,
        rule: "current-doc-mentions-latest-auth-migration",
        message: `Current source-of-truth doc must mention latest auth migration ${latest}.`,
      });
    }

    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const pattern of STALE_LATEST_PATTERNS) {
        if (!pattern.regex.test(line)) continue;
        violations.push({
          type: "stale-latest-migration",
          file: relativePath,
          line: index + 1,
          rule: pattern.id,
          message: `Current doc appears to claim 0040 or 0046 as the latest/current auth migration; expected ${latest}.`,
          excerpt: safeExcerpt(line),
        });
        break;
      }
    });
  }

  return {
    latest,
    scannedDocs,
    violations,
  };
}
