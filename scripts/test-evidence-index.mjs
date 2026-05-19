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
write("docs/audits/archive/historical.md", "# Historical Evidence\n\nHistorical phase report.\n");
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
assert.equal(index.scannedFiles, 5);
assert.equal(index.summary.byClassification.accepted, 1);
assert.equal(index.summary.byClassification.template, 1);
assert.equal(index.summary.byClassification.pending, 1);
assert.equal(index.summary.byClassification.historical, 1);
assert.equal(index.summary.byClassification["rejected/unsafe"], 1);
assert.equal(index.summary.unsafeCount, 1);
assert(index.items.some((item) => item.path.endsWith("billing-pending.md") && item.source === "billing"));
assert(index.items.some((item) => item.path.endsWith("unsafe.md") && item.unsafeMarkers.some((marker) => marker.id === "raw_idempotency_key")));

const jsonOutput = `${JSON.stringify(index, null, 2)}\n`;
const markdown = renderEvidenceIndexMarkdown(index);
assert(jsonOutput.includes("stripe_api_key"));
assert(markdown.includes("Evidence Archive Index"));
assert(markdown.includes("rejected/unsafe"));
for (const unsafe of [rawSecret, rawSignature, "raw-key-1234567890", "abcdef0123456789abcdef0123456789"]) {
  assert(!jsonOutput.includes(unsafe));
  assert(!markdown.includes(unsafe));
}
assertEvidenceIndexOutputRedacted(jsonOutput);
assertEvidenceIndexOutputRedacted(markdown);
