import fs from "node:fs";
import path from "node:path";

export const CURRENT_SOURCE_DOC_PATHS = Object.freeze([
  "README.md",
  "docs/audits/NEXT_AUDIT_BASELINE.md",
  "CURRENT_IMPLEMENTATION_HANDOFF.md",
  "docs/audits/ALPHA_AUDIT_CURRENT_SUMMARY.md",
  "SAAS_PROGRESS_AND_CURRENT_STATE_REPORT.md",
  "DATA_INVENTORY.md",
  "docs/DATA_RETENTION_POLICY.md",
  "docs/privacy-data-flow-audit.md",
  "workers/auth/CLAUDE.md",
  "docs/audits/README.md",
  "docs/production-readiness/README.md",
  "docs/production-readiness/EVIDENCE_TEMPLATE.md",
  "docs/ai-cost-gateway/README.md",
  "docs/ai-cost-gateway/ADMIN_PLATFORM_BUDGET_POLICY.md",
  "docs/ai-cost-gateway/LIVE_PLATFORM_BUDGET_CAPS_DESIGN.md",
]);

export const CURRENT_DOC_LINE_LIMITS = Object.freeze({
  "docs/audits/NEXT_AUDIT_BASELINE.md": 180,
  "CURRENT_IMPLEMENTATION_HANDOFF.md": 120,
  "SAAS_PROGRESS_AND_CURRENT_STATE_REPORT.md": 160,
  "docs/audits/ALPHA_AUDIT_CURRENT_SUMMARY.md": 160,
});

export const CURRENT_DOC_PHASE_MENTION_LIMITS = Object.freeze({
  "docs/audits/NEXT_AUDIT_BASELINE.md": 0,
  "CURRENT_IMPLEMENTATION_HANDOFF.md": 0,
  "SAAS_PROGRESS_AND_CURRENT_STATE_REPORT.md": 0,
  "docs/audits/ALPHA_AUDIT_CURRENT_SUMMARY.md": 0,
});

const MARKDOWN_SCAN_IGNORES = Object.freeze([
  "playwright-report/",
  "test-results/",
  "js/vendor/",
]);

const MARKDOWN_SCAN_IGNORED_SEGMENTS = new Set([
  ".git",
  ".wrangler",
  "_site",
  "node_modules",
]);

const SUPERSEDED_STALE_DOCS = new Set([
  "docs/privacy-compliance-audit.md",
  "docs/privacy-text-followup.md",
  "docs/codebase-issue-task-proposals.md",
  "docs/cloudflare-rate-limiting-wave1.md",
  "docs/gallery-exclusive-little-monster-cleanup.md",
  "docs/soundlab-free-exclusive-cleanup.md",
]);

const ACTIVE_RUNBOOK_POLICY_DOCS = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "workers/auth/AGENTS.md",
  "docs/BACKUP_RESTORE_DRILL.md",
  "docs/DATA_DELETION_EXECUTOR_DESIGN.md",
  "docs/OBSERVABILITY_EVENTS.md",
  "docs/SLO_ALERT_BASELINE.md",
  "docs/ai-image-derivatives-runbook.md",
  "docs/production-readiness/MAIN_ONLY_RELEASE_CHECKLIST.md",
  "docs/production-readiness/MAIN_ONLY_RELEASE_RUNBOOK.md",
  "docs/production-readiness/PHASE2_BILLING_REVIEW_STAGING_CHECKLIST.md",
  "docs/production-readiness/PHASE3_MEMBER_IMAGE_GATEWAY_MAIN_CHECKLIST.md",
]);

const ACTIVE_DOMAIN_DESIGN_DOCS = new Set([
  "docs/ai-cost-gateway/AI_COST_GATEWAY_DESIGN.md",
  "docs/ai-cost-gateway/AI_COST_GATEWAY_ROADMAP.md",
  "docs/ai-cost-gateway/AI_COST_ROUTE_INVENTORY.md",
  "docs/ai-cost-gateway/MEMBER_MUSIC_COST_DECOMPOSITION.md",
  "docs/ai-cost-gateway/ADMIN_TEXT_EMBEDDINGS_IDEMPOTENCY_DESIGN.md",
  "docs/ai-cost-gateway/ADMIN_LIVE_AGENT_BUDGET_FLOW_AUDIT.md",
  "docs/ai-cost-gateway/ADMIN_SYNC_VIDEO_DEBUG_RETIREMENT_AUDIT.md",
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

function isIgnoredMarkdownPath(relativePath) {
  const normalized = normalizePathname(relativePath);
  if (normalized.split("/").some((segment) => MARKDOWN_SCAN_IGNORED_SEGMENTS.has(segment))) {
    return true;
  }
  return MARKDOWN_SCAN_IGNORES.some((prefix) => normalized.startsWith(prefix));
}

function isRootHistoricalReportPath(relativePath) {
  const normalized = normalizePathname(relativePath);
  if (normalized.includes("/")) return false;
  return /^PHASE.*\.md$/.test(normalized)
    || normalized === "AI_VIDEO_ASYNC_JOB_DESIGN.md";
}

function isRootRetiredAuditDocPath(relativePath) {
  const normalized = normalizePathname(relativePath);
  if (normalized.includes("/")) return false;
  return /^AUDIT_.*\.md$/.test(normalized)
    || /^ALPHA_AUDIT_.*\.md$/.test(normalized);
}

function walkMarkdownFiles(root, dir = root, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolutePath = path.join(dir, entry.name);
    const relativePath = normalizePathname(path.relative(root, absolutePath));
    if (isIgnoredMarkdownPath(relativePath)) continue;
    if (entry.isDirectory()) {
      walkMarkdownFiles(root, absolutePath, out);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(relativePath);
    }
  }
  return out.sort();
}

export function classifyFirstPartyMarkdownPath(relativePath, options = {}) {
  const currentDocs = new Set((options.currentDocs || CURRENT_SOURCE_DOC_PATHS).map(normalizePathname));
  const normalized = normalizePathname(relativePath);
  if (isIgnoredMarkdownPath(normalized)) return "ignored";
  if (currentDocs.has(normalized)) return "active_current";
  if (ACTIVE_RUNBOOK_POLICY_DOCS.has(normalized)) return "active_runbook_policy";
  if (normalized.startsWith(".agents/skills/") && normalized.endsWith("/SKILL.md")) return "active_runbook_policy";
  if (normalized.startsWith("docs/runbooks/") && normalized.endsWith(".md")) return "active_runbook_policy";
  if (normalized.startsWith("docs/ops/") && normalized.endsWith(".md")) return "active_runbook_policy";
  if (ACTIVE_DOMAIN_DESIGN_DOCS.has(normalized)) return "active_domain_design";
  if (normalized.startsWith("docs/tenant-assets/evidence/") && /^\d{4}-\d{2}-\d{2}-.+\.md$/.test(path.basename(normalized))) return "historical_phase_report";
  if (normalized.startsWith("docs/tenant-assets/") && normalized.endsWith(".md")) return "active_domain_design";
  if (normalized.startsWith("docs/audits/archive/") && normalized.endsWith(".md")) return "historical_phase_report";
  if (normalized === "docs/audits/ALPHA_AUDIT_PHASE_CHANGELOG.md") return "historical_phase_report";
  if (isRootHistoricalReportPath(normalized)) return "historical_root_report_not_archived";
  if (isRootRetiredAuditDocPath(normalized)) return "retired_root_audit_doc_not_archived";
  if (SUPERSEDED_STALE_DOCS.has(normalized)) return "superseded_stale";
  return "unknown_needs_review";
}

function safeExcerpt(line) {
  const cleaned = String(line || "").replace(/\s+/g, " ").trim();
  return cleaned.length > 180 ? `${cleaned.slice(0, 177)}...` : cleaned;
}

export function scanDocCurrentness(repoRoot, options = {}) {
  const latest = options.latest || loadLatestAuthMigration(repoRoot);
  const currentDocs = (options.currentDocs || CURRENT_SOURCE_DOC_PATHS).map(normalizePathname);
  const requireLatest = options.requireLatest !== false;
  const enforceLineLimits = options.enforceLineLimits !== false;
  const checkMarkdownInventory = options.checkMarkdownInventory !== false;
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
    const lines = text.split(/\r?\n/);

    if (enforceLineLimits && CURRENT_DOC_LINE_LIMITS[relativePath] && lines.length > CURRENT_DOC_LINE_LIMITS[relativePath]) {
      violations.push({
        type: "current-doc-too-long",
        file: relativePath,
        line: null,
        rule: "current-doc-line-limit",
        message: `Current source-of-truth doc has ${lines.length} lines; limit is ${CURRENT_DOC_LINE_LIMITS[relativePath]}. Move history to docs/audits/archive/ or ALPHA_AUDIT_PHASE_CHANGELOG.md.`,
      });
    }

    const phaseMentionLimit = CURRENT_DOC_PHASE_MENTION_LIMITS[relativePath];
    if (Number.isInteger(phaseMentionLimit)) {
      const phaseMentionCount = (text.match(/\bPhase\s+\d+(?:\.\d+)?\b/gi) || []).length;
      if (phaseMentionCount > phaseMentionLimit) {
        violations.push({
          type: "current-doc-phase-history",
          file: relativePath,
          line: null,
          rule: "current-doc-no-phase-history",
          message: `Current source-of-truth doc has ${phaseMentionCount} phase-number mention(s); limit is ${phaseMentionLimit}. Move historical narrative to frozen archive/changelog docs.`,
        });
      }
    }

    if (requireLatest && !text.includes(latest)) {
      violations.push({
        type: "missing-current-latest",
        file: relativePath,
        line: null,
        rule: "current-doc-mentions-latest-auth-migration",
        message: `Current source-of-truth doc must mention latest auth migration ${latest}.`,
      });
    }

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

  const markdownInventory = [];
  const categoryCounts = {};
  if (checkMarkdownInventory) {
    for (const markdownPath of walkMarkdownFiles(repoRoot)) {
      const category = classifyFirstPartyMarkdownPath(markdownPath, { currentDocs });
      if (category === "ignored") continue;
      markdownInventory.push({ path: markdownPath, category });
      categoryCounts[category] = (categoryCounts[category] || 0) + 1;
      if (category === "unknown_needs_review") {
        violations.push({
          type: "unclassified-markdown",
          file: markdownPath,
          line: null,
          rule: "markdown-inventory-classified",
          message: "First-party Markdown file is not classified by docs/audits/README.md and doc-currentness inventory rules.",
        });
      }
      if (category === "historical_root_report_not_archived") {
        violations.push({
          type: "root-historical-report-not-archived",
          file: markdownPath,
          line: null,
          rule: "root-historical-reports-archived",
          message: "Historical root Markdown reports must live in docs/audits/archive/root-phase-reports/.",
        });
      }
      if (category === "retired_root_audit_doc_not_archived") {
        violations.push({
          type: "retired-root-audit-doc-not-archived",
          file: markdownPath,
          line: null,
          rule: "retired-root-audit-docs-archived",
          message: "Legacy root audit Markdown docs must live in docs/audits/archive/retired-audit-root-docs/.",
        });
      }
    }
  }

  return {
    latest,
    scannedDocs,
    markdownInventory,
    categoryCounts,
    violations,
  };
}
