import fs from "node:fs";
import path from "node:path";

const DEFAULT_SCAN_TARGETS = Object.freeze([
  "docs/production-readiness",
  "docs/tenant-assets/evidence",
  "docs/runbooks",
  "docs/audits",
  "CURRENT_IMPLEMENTATION_HANDOFF.md",
  "SAAS_PROGRESS_AND_CURRENT_STATE_REPORT.md",
  "DATA_INVENTORY.md",
]);

const TEXT_EXTENSIONS = new Set([".md", ".txt", ".json", ".jsonl", ".yml", ".yaml"]);
const MAX_FILE_BYTES = 512 * 1024;
const MAX_FILES = 600;

const MARKERS = Object.freeze([
  {
    id: "stripe_api_key",
    label: "Stripe API key",
    pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9_]{8,}\b/g,
  },
  {
    id: "stripe_webhook_secret",
    label: "Stripe webhook secret",
    pattern: /\bwhsec_[A-Za-z0-9_]{8,}\b/g,
  },
  {
    id: "stripe_signature",
    label: "Stripe signature header",
    pattern: /\bStripe-Signature\b|^\s*stripe-signature\s*:/gim,
  },
  {
    id: "authorization_header",
    label: "Authorization header",
    pattern: /^\s*Authorization\s*:|Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gim,
  },
  {
    id: "cookie_header",
    label: "Cookie header",
    pattern: /^\s*(?:Cookie|Set-Cookie)\s*:/gim,
  },
  {
    id: "raw_idempotency_key",
    label: "Raw idempotency key",
    pattern: /^\s*Idempotency-Key\s*:\s*\S+|\bidempotencyKey\s*[:=]\s*["']?[A-Za-z0-9_.:-]{12,}/gim,
  },
  {
    id: "raw_request_hash",
    label: "Raw request hash",
    pattern: /\b(?:request_hash|requestHash)\s*[:=]\s*["']?[a-f0-9]{32,}/gim,
  },
  {
    id: "raw_r2_key",
    label: "Raw R2/storage key",
    pattern: /\b(?:r2_key|storage_key|storageKey|object_key|objectKey)\s*[:=]\s*["']?(?!\[redacted\])[^"',\s}]{8,}/gim,
  },
  {
    id: "raw_payload",
    label: "Raw provider payload",
    pattern: /\b(?:raw_payload|rawPayload|payload_body|payloadBody)\s*[:=]/gim,
  },
  {
    id: "secret_token_value",
    label: "Secret/token value",
    pattern: /\b(?:secret|token|password)\s*[:=]\s*["']?(?!\[redacted\]|present|missing)[A-Za-z0-9_./+=:-]{12,}/gim,
  },
]);

function statOrNull(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function normalizeRelativePath(repoRoot, filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, "/");
}

function isTextEvidenceFile(filePath) {
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function listEvidenceFiles(repoRoot, targets = DEFAULT_SCAN_TARGETS) {
  const files = [];
  const visit = (absolutePath) => {
    if (files.length >= MAX_FILES) return;
    const stat = statOrNull(absolutePath);
    if (!stat) return;
    if (stat.isFile()) {
      if (isTextEvidenceFile(absolutePath) && stat.size <= MAX_FILE_BYTES) {
        files.push({ absolutePath, stat });
      }
      return;
    }
    if (!stat.isDirectory()) return;
    const entries = fs.readdirSync(absolutePath, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith("."))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      visit(path.join(absolutePath, entry.name));
      if (files.length >= MAX_FILES) return;
    }
  };

  for (const target of targets) {
    visit(path.resolve(repoRoot, target));
    if (files.length >= MAX_FILES) break;
  }
  return files;
}

export function detectUnsafeEvidenceMarkers(content) {
  const text = String(content || "");
  return MARKERS.map((marker) => {
    const matches = text.match(marker.pattern) || [];
    marker.pattern.lastIndex = 0;
    return matches.length
      ? { id: marker.id, label: marker.label, count: matches.length }
      : null;
  }).filter(Boolean);
}

function classifySource(relativePath, content) {
  const lowerPath = relativePath.toLowerCase();
  const text = `${relativePath}\n${content}`.toLowerCase();
  if (lowerPath.includes("docs/tenant-assets/evidence")) {
    if (text.includes("manual-review") || text.includes("manual review")) return "manual_review";
    if (text.includes("legacy-media-reset") || text.includes("legacy reset")) return "legacy_reset";
    return "tenant_assets";
  }
  if (lowerPath.includes("docs/production-readiness")) {
    if (text.includes("billing") || text.includes("stripe") || text.includes("subscription") || text.includes("credit")) return "billing";
    if (text.includes("cutover") || text.includes("release plan")) return "release_cutover";
    return "production_readiness";
  }
  if (text.includes("tenant-assets") || text.includes("tenant asset")) return "tenant_assets";
  if (text.includes("manual-review") || text.includes("manual review")) return "manual_review";
  if (text.includes("legacy-media-reset") || text.includes("legacy reset")) return "legacy_reset";
  if (text.includes("platform-budget") || text.includes("ai budget")) return "ai_budget";
  if (text.includes("data-lifecycle") || text.includes("data lifecycle") || text.includes("data export")) return "data_lifecycle";
  if (text.includes("release-cutover") || text.includes("cutover") || text.includes("release plan")) return "release_cutover";
  if (text.includes("production-readiness") || text.includes("readiness")) return "production_readiness";
  return "operations";
}

function classifyEvidence(relativePath, content, unsafeMarkers) {
  const lowerPath = relativePath.toLowerCase();
  const text = String(content || "").toLowerCase();
  if (unsafeMarkers.length > 0) return "rejected/unsafe";
  if (
    lowerPath.includes("post_cleanup_tenant_asset_evidence_rebaseline") ||
    lowerPath.includes("2026-05-19-post-cleanup-rebaseline/")
  ) {
    return "pending";
  }
  if (
    /^post-cleanup status:\s*`?superseded_by_manual_media_cleanup`?/m.test(text) ||
    /^p2-01 note:.*no longer current after manual media cleanup/m.test(text)
  ) {
    return "stale/superseded";
  }
  if (lowerPath.includes("/archive/") || lowerPath.includes("historical") || lowerPath.includes("retired")) return "historical";
  if (lowerPath.includes("template") || text.includes("operator to fill") || text.includes("evidence template")) return "template";
  if (/\baccepted\b|\bpass\b|evidence collected:\s*\*\*true\*\*/i.test(content)) return "accepted";
  if (/\bpending\b|\bblocked\b|\boperator evidence\b|\bto fill\b/i.test(content)) return "pending";
  return "pending";
}

function classifyUnsafeReviewCandidate(relativePath, content) {
  const lowerPath = relativePath.toLowerCase();
  const text = String(content || "").toLowerCase();
  if (lowerPath.includes("/archive/") || lowerPath.includes("historical") || lowerPath.includes("retired")) {
    return {
      triage: "historical_archive_candidate",
      action: "manual review before redaction; preserve frozen history unless policy requires rotation/redaction",
    };
  }
  if (lowerPath.includes("template") || text.includes("operator to fill") || text.includes("example only")) {
    return {
      triage: "template_example_candidate",
      action: "replace with fragmented or redacted examples; do not use provider-secret-looking literals",
    };
  }
  if (text.includes("[redacted]") || text.includes("redacted marker") || text.includes("placeholder only")) {
    return {
      triage: "accepted_redacted_marker",
      action: "verify the marker is a redacted label only and contains no raw value",
    };
  }
  if (
    lowerPath.startsWith("docs/production-readiness/")
    || lowerPath.startsWith("docs/tenant-assets/evidence/")
    || lowerPath === "current_implementation_handoff.md"
    || lowerPath === "saas_progress_and_current_state_report.md"
    || lowerPath === "data_inventory.md"
  ) {
    return {
      triage: "active_current_blocker",
      action: "redact or replace before using as current evidence; do not bypass push protection",
    };
  }
  return {
    triage: "needs_manual_review",
    action: "review path and marker IDs; redact if active evidence, preserve only if intentionally historical",
  };
}

export function classifyEvidenceFile({ repoRoot, absolutePath, stat }) {
  const relativePath = normalizeRelativePath(repoRoot, absolutePath);
  const content = fs.readFileSync(absolutePath, "utf8");
  const unsafeMarkers = detectUnsafeEvidenceMarkers(content);
  const classification = classifyEvidence(relativePath, content, unsafeMarkers);
  const unsafeReview = unsafeMarkers.length > 0
    ? classifyUnsafeReviewCandidate(relativePath, content)
    : null;
  return {
    path: relativePath,
    source: classifySource(relativePath, content),
    classification,
    unsafe: unsafeMarkers.length > 0,
    unsafeMarkers,
    unsafeReview,
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  };
}

function countBy(items, keyName) {
  const counts = {};
  for (const item of items) {
    const key = item[keyName] || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function buildUnsafeReviewSummary(unsafeItems) {
  const candidates = unsafeItems.map((item) => ({
    path: item.path,
    markerIds: item.unsafeMarkers.map((marker) => marker.id).sort(),
    triage: item.unsafeReview?.triage || "needs_manual_review",
    action: item.unsafeReview?.action || "review marker IDs without printing raw values",
  }));
  return {
    byTriage: countBy(candidates, "triage"),
    candidates,
  };
}

export function buildEvidenceIndex({
  repoRoot = process.cwd(),
  targets = DEFAULT_SCAN_TARGETS,
  generatedAt = new Date().toISOString(),
} = {}) {
  const files = listEvidenceFiles(repoRoot, targets);
  const items = files
    .map((file) => classifyEvidenceFile({ repoRoot, ...file }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const unsafeItems = items.filter((item) => item.unsafe);
  return {
    ok: unsafeItems.length === 0,
    version: "omega-p1-wave10-evidence-index-v2",
    generatedAt,
    mode: "local_filesystem_only",
    liveR2Listed: false,
    externalCallsMade: false,
    secretsPrinted: false,
    bounded: true,
    redacted: true,
    scannedFiles: items.length,
    maxFiles: MAX_FILES,
    maxFileBytes: MAX_FILE_BYTES,
    summary: {
      bySource: countBy(items, "source"),
      byClassification: countBy(items, "classification"),
      unsafeCount: unsafeItems.length,
    },
    unsafeReviewSummary: buildUnsafeReviewSummary(unsafeItems),
    items,
  };
}

export function renderEvidenceIndexMarkdown(index) {
  const sourceRows = Object.entries(index.summary.bySource)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([source, count]) => `| ${source} | ${count} |`)
    .join("\n");
  const classificationRows = Object.entries(index.summary.byClassification)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([classification, count]) => `| ${classification} | ${count} |`)
    .join("\n");
  const itemRows = index.items
    .slice(0, 100)
    .map((item) => `| \`${item.path}\` | ${item.source} | ${item.classification} | ${item.unsafeMarkers.map((marker) => `${marker.id} (${marker.count})`).join(", ") || "-"} | ${item.unsafeReview?.triage || "-"} |`)
    .join("\n");
  const triageRows = Object.entries(index.unsafeReviewSummary?.byTriage || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([triage, count]) => `| ${triage} | ${count} |`)
    .join("\n");
  const candidateRows = (index.unsafeReviewSummary?.candidates || [])
    .slice(0, 100)
    .map((candidate) => `| \`${candidate.path}\` | ${candidate.markerIds.join(", ")} | ${candidate.triage} |`)
    .join("\n");
  return `# Evidence Archive Index

Generated: ${index.generatedAt}

- Mode: **${index.mode}**
- Files scanned: **${index.scannedFiles}**
- Unsafe evidence files: **${index.summary.unsafeCount}**
- Live R2 listed: **${index.liveR2Listed}**
- External calls made: **${index.externalCallsMade}**
- Secrets printed: **${index.secretsPrinted}**

## Sources

| Source | Count |
| --- | ---: |
${sourceRows || "| none | 0 |"}

## Classifications

| Classification | Count |
| --- | ---: |
${classificationRows || "| none | 0 |"}

## Unsafe Marker Review Summary

| Triage | Count |
| --- | ---: |
${triageRows || "| none | 0 |"}

| Path | Marker IDs | Triage |
| --- | --- | --- |
${candidateRows || "| none | - | - |"}

## Items

| Path | Source | Classification | Unsafe markers | Triage |
| --- | --- | --- | --- | --- |
${itemRows || "| none | - | - | - | - |"}
`;
}

export function assertEvidenceIndexOutputRedacted(text) {
  const output = String(text || "");
  for (const marker of MARKERS) {
    marker.pattern.lastIndex = 0;
    if (marker.pattern.test(output)) {
      marker.pattern.lastIndex = 0;
      throw new Error(`Evidence index output contains unsafe marker: ${marker.id}`);
    }
    marker.pattern.lastIndex = 0;
  }
  return true;
}
