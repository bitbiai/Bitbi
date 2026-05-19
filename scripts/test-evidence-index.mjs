import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertEvidenceIndexOutputRedacted,
  buildEvidenceIndex,
  detectUnsafeEvidenceMarkers,
  renderEvidenceIndexMarkdown,
} from "./lib/evidence-index.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bitbi-evidence-index-"));

function write(relativePath, content) {
  const target = path.join(tmp, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

// Built from fragments so GitHub Push Protection does not treat this test fixture as a real secret.
const rawSecret = ["s", "k", "live", "evidenceindexsecret1234567890"].join("_").replace("s_k_", "sk_");
const rawSignature = `${["Stripe", "Signature"].join("-")}: t=1,v1=abcdef`;
const rawR2Key = "storage_key: data-exports/private/raw-key.json";

write("docs/production-readiness/evidence/accepted.md", "# Accepted Evidence\n\nPASS: evidence collected: **true**\n");
write("docs/production-readiness/EVIDENCE_TEMPLATE.md", "# Evidence Template\n\noperator to fill\n");
write("docs/production-readiness/evidence/billing-pending.md", "# Billing Evidence\n\nLive billing readiness remains blocked and pending operator evidence.\n");
write("docs/production-readiness/UNSAFE_TEMPLATE.md", `# Unsafe Template\n\noperator to fill\nexample only\n${rawSignature}\n`);
write("docs/audits/archive/historical.md", "# Historical Evidence\n\nHistorical phase report.\n");
write("docs/audits/archive/unsafe-historical.md", `# Historical Unsafe Evidence\n\nHistorical phase report with ${rawR2Key}\n`);
write("docs/tenant-assets/evidence/unsafe.md", `# Unsafe Evidence\n\n${rawSecret}\n${rawSignature}\n${rawR2Key}\nIdempotency-Key: raw-key-1234567890\nrequest_hash: abcdef0123456789abcdef0123456789\n`);

const markers = detectUnsafeEvidenceMarkers(`${rawSecret}\n${rawSignature}\n${rawR2Key}`);
assert(markers.some((marker) => marker.id === "stripe_api_key"));
assert(markers.some((marker) => marker.id === "stripe_signature"));
assert(markers.some((marker) => marker.id === "raw_r2_key"));

const index = buildEvidenceIndex({
  repoRoot: tmp,
  targets: [
    "docs/production-readiness",
    "docs/tenant-assets/evidence",
    "docs/audits",
  ],
  generatedAt: "2026-05-19T12:00:00.000Z",
});

assert.equal(index.mode, "local_filesystem_only");
assert.equal(index.liveR2Listed, false);
assert.equal(index.externalCallsMade, false);
assert.equal(index.scannedFiles, 7);
assert.equal(index.summary.byClassification.accepted, 1);
assert.equal(index.summary.byClassification.template, 1);
assert.equal(index.summary.byClassification.pending, 1);
assert.equal(index.summary.byClassification.historical, 1);
assert.equal(index.summary.byClassification["rejected/unsafe"], 3);
assert.equal(index.summary.unsafeCount, 3);
assert(index.items.some((item) => item.path.endsWith("billing-pending.md") && item.source === "billing"));
assert(index.items.some((item) => item.path.endsWith("unsafe.md") && item.unsafeMarkers.some((marker) => marker.id === "raw_idempotency_key")));
assert.equal(index.unsafeReviewSummary.byTriage.active_current_blocker, 1);
assert.equal(index.unsafeReviewSummary.byTriage.historical_archive_candidate, 1);
assert.equal(index.unsafeReviewSummary.byTriage.template_example_candidate, 1);
assert(index.unsafeReviewSummary.candidates.every((candidate) => Array.isArray(candidate.markerIds)));
assert(index.unsafeReviewSummary.candidates.some((candidate) => candidate.path.endsWith("unsafe-historical.md") && candidate.triage === "historical_archive_candidate"));
assert(index.unsafeReviewSummary.candidates.some((candidate) => candidate.path.endsWith("UNSAFE_TEMPLATE.md") && candidate.triage === "template_example_candidate"));

const jsonOutput = `${JSON.stringify(index, null, 2)}\n`;
const markdown = renderEvidenceIndexMarkdown(index);
assert(jsonOutput.includes("stripe_api_key"));
assert(markdown.includes("Evidence Archive Index"));
assert(markdown.includes("rejected/unsafe"));
assert(markdown.includes("Unsafe Marker Review Summary"));
assert(markdown.includes("active_current_blocker"));
assert(markdown.includes("historical_archive_candidate"));
for (const unsafe of [rawSecret, rawSignature, rawR2Key, "raw-key-1234567890", "abcdef0123456789abcdef0123456789"]) {
  assert(!jsonOutput.includes(unsafe));
  assert(!markdown.includes(unsafe));
}
assertEvidenceIndexOutputRedacted(jsonOutput);
assertEvidenceIndexOutputRedacted(markdown);
