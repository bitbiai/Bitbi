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
const rawWebhookSecret = ["wh", "sec", "evidenceindexwebhook1234567890"].join("_").replace("wh_sec_", "whsec_");
const rawAuthorization = ["Authorization", ": Bearer ", "evidenceindexbearer", "token1234567890"].join("");
const rawGenericToken = ["token", ": ", "evidenceindex", "token1234567890"].join("");
const rawIdempotency = ["Idempotency", "-Key: ", "raw-key-", "1234567890"].join("");
const rawRequestHash = ["request_hash", ": ", "abcdef0123456789", "abcdef0123456789"].join("");
const rawPrivateKeyHeader = ["-----BEGIN ", "PRIVATE KEY", "-----"].join("");

write("docs/production-readiness/evidence/accepted.md", "# Accepted Evidence\n\nPASS: evidence collected: **true**\n");
write("docs/production-readiness/EVIDENCE_TEMPLATE.md", "# Evidence Template\n\noperator to fill\n");
write("docs/production-readiness/evidence/billing-pending.md", "# Billing Evidence\n\nLive billing readiness remains blocked and pending operator evidence.\n");
write("docs/production-readiness/UNSAFE_TEMPLATE.md", `# Unsafe Template\n\noperator to fill\nexample only\n${rawSignature}\n`);
write("docs/production-readiness/sanitized-placeholder.md", `# Sanitized Placeholder\n\n${["Stripe", "Signature"].join("-")}: [redacted]\nAuthorization: Bearer [redacted]\nIdempotency-Key: [unsafe-marker-value-suppressed]\ntoken: [REDACTED_UNSAFE_MARKER_OPERATOR_REVIEWED]\nsecret: [redacted]\n`);
write("docs/audits/archive/historical.md", "# Historical Evidence\n\nHistorical phase report.\n");
write("docs/audits/archive/unsafe-historical.md", `# Historical Unsafe Evidence\n\nHistorical phase report with ${rawR2Key}\n`);
write("docs/tenant-assets/evidence/POST_CLEANUP_TENANT_ASSET_EVIDENCE_REBASELINE.md", "# Post-Cleanup Rebaseline\n\nDecision status: `post_cleanup_evidence_pending`\n\n| File | Classification |\n| --- | --- |\n| `old.md` | `stale/superseded_by_manual_media_cleanup` |\n");
write("docs/tenant-assets/evidence/post-cleanup-stale.md", "# Stale Tenant Asset Evidence\n\nPost-cleanup status: `superseded_by_manual_media_cleanup`\n\nHistorical retained evidence only. Do not use these pre-cleanup counts as active current truth.\n");
write("docs/tenant-assets/evidence/unsafe.md", `# Unsafe Evidence\n\n${rawSecret}\n${rawSignature}\n${rawR2Key}\n${rawWebhookSecret}\n${rawAuthorization}\n${rawGenericToken}\n${rawIdempotency}\n${rawRequestHash}\n${rawPrivateKeyHeader}\n`);

const markers = detectUnsafeEvidenceMarkers(`${rawSecret}\n${rawSignature}\n${rawR2Key}\n${rawWebhookSecret}\n${rawAuthorization}\n${rawGenericToken}\n${rawIdempotency}\n${rawPrivateKeyHeader}`);
assert(markers.some((marker) => marker.id === "stripe_api_key"));
assert(markers.some((marker) => marker.id === "stripe_signature"));
assert(markers.some((marker) => marker.id === "raw_r2_key"));
assert(markers.some((marker) => marker.id === "stripe_webhook_secret"));
assert(markers.some((marker) => marker.id === "authorization_header"));
assert(markers.some((marker) => marker.id === "secret_token_value"));
assert(markers.some((marker) => marker.id === "raw_idempotency_key"));
assert(markers.some((marker) => marker.id === "private_key_material"));
assert(markers.every((marker) => marker.rawValueSuppressed === true));
assert(markers.every((marker) => typeof marker.markerClass === "string" && marker.markerClass.endsWith("_like")));
assert.equal(detectUnsafeEvidenceMarkers("Stripe-Signature: [redacted]\nAuthorization: Bearer [redacted]\nIdempotency-Key: [unsafe-marker-value-suppressed]\ntoken: [REDACTED_UNSAFE_MARKER_OPERATOR_REVIEWED]\nsecret: [redacted]\n").length, 0);

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
assert.equal(index.scannedFiles, 10);
assert.equal(index.summary.byClassification.accepted, 1);
assert.equal(index.summary.byClassification.template, 1);
assert.equal(index.summary.byClassification.pending, 3);
assert.equal(index.summary.byClassification.historical, 1);
assert.equal(index.summary.byClassification["stale/superseded"], 1);
assert.equal(index.summary.byClassification["rejected/unsafe"], 3);
assert.equal(index.summary.unsafeCount, 3);
assert(index.items.some((item) => item.path.endsWith("billing-pending.md") && item.source === "billing"));
assert(index.items.some((item) => item.path.endsWith("POST_CLEANUP_TENANT_ASSET_EVIDENCE_REBASELINE.md") && item.classification === "pending"));
assert(index.items.some((item) => item.path.endsWith("post-cleanup-stale.md") && item.classification === "stale/superseded"));
assert(index.items.some((item) => item.path.endsWith("unsafe.md") && item.unsafeMarkers.some((marker) => marker.id === "raw_idempotency_key")));
assert.equal(index.unsafeReviewSummary.byTriage.active_current_blocker, 1);
assert.equal(index.unsafeReviewSummary.byTriage.historical_archive_candidate, 1);
assert.equal(index.unsafeReviewSummary.byTriage.template_example_candidate, 1);
assert.equal(index.unsafeReviewSummary.byReadinessImpact.blocking, 1);
assert.equal(index.unsafeReviewSummary.byReadinessImpact.review_required, 2);
assert.equal(index.unsafeReviewSummary.byDocumentClassification.active_domain_design, 1);
assert.equal(index.unsafeReviewSummary.byDocumentClassification.historical_phase_report, 1);
assert.equal(index.unsafeReviewSummary.byDocumentClassification.template, 1);
assert.equal(index.unsafeReviewSummary.blockingCandidateCount, 3);
assert(index.unsafeReviewSummary.candidates.every((candidate) => Array.isArray(candidate.markerIds)));
assert(index.unsafeReviewSummary.candidates.every((candidate) => Array.isArray(candidate.markerClasses)));
assert(index.unsafeReviewSummary.candidates.every((candidate) => Array.isArray(candidate.markerReferences)));
assert(index.unsafeReviewSummary.candidates.every((candidate) => candidate.rawValueSuppressed === true));
assert(index.unsafeReviewSummary.candidates.every((candidate) => candidate.safePlaceholder === "[unsafe-marker-value-suppressed]"));
assert(index.unsafeReviewSummary.candidates.every((candidate) => ["blocking", "review_required", "sanitized", "unresolved"].includes(candidate.readinessImpact)));
assert(index.unsafeReviewSummary.candidates.every((candidate) => ["redact_sensitive_value", "replace_with_sanitized_placeholder", "leave_blocked_until_reviewed", "verify_false_positive"].includes(candidate.recommendedOperatorAction)));
assert(index.unsafeReviewSummary.candidates.some((candidate) => candidate.path.endsWith("unsafe-historical.md") && candidate.triage === "historical_archive_candidate"));
assert(index.unsafeReviewSummary.candidates.some((candidate) => candidate.path.endsWith("UNSAFE_TEMPLATE.md") && candidate.triage === "template_example_candidate"));
const activeUnsafeCandidate = index.unsafeReviewSummary.candidates.find((candidate) => candidate.path.endsWith("unsafe.md"));
assert(activeUnsafeCandidate);
for (const markerClass of [
  "secret_like",
  "stripe_signature_like",
  "private_storage_key_like",
  "webhook_secret_like",
  "authorization_header_like",
  "token_like",
  "idempotency_key_like",
  "request_hash_like",
  "private_key_like",
]) {
  assert(activeUnsafeCandidate.markerClasses.includes(markerClass));
}
assert(activeUnsafeCandidate.markers.every((marker) => marker.rawValueSuppressed === true));
assert(activeUnsafeCandidate.markers.every((marker) => marker.safePlaceholder === "[unsafe-marker-value-suppressed]"));
assert(activeUnsafeCandidate.markerReferences.every((reference) => /^umr_[a-f0-9]{12}$/.test(reference)));
const sanitizedPlaceholder = index.items.find((item) => item.path.endsWith("sanitized-placeholder.md"));
assert(sanitizedPlaceholder);
assert.equal(sanitizedPlaceholder.unsafe, false);
assert(!index.unsafeReviewSummary.candidates.some((candidate) => candidate.path.endsWith("sanitized-placeholder.md")));

const jsonOutput = `${JSON.stringify(index, null, 2)}\n`;
const markdown = renderEvidenceIndexMarkdown(index);
assert(jsonOutput.includes("stripe_api_key"));
assert(markdown.includes("Evidence Archive Index"));
assert(markdown.includes("rejected/unsafe"));
assert(markdown.includes("stale/superseded"));
assert(markdown.includes("Unsafe Marker Review Summary"));
assert(markdown.includes("Marker refs"));
assert(markdown.includes("Raw value suppressed"));
assert(markdown.includes("[unsafe-marker-value-suppressed]"));
assert(markdown.includes("active_current_blocker"));
assert(markdown.includes("historical_archive_candidate"));
for (const unsafe of [
  rawSecret,
  rawSignature,
  rawR2Key,
  rawWebhookSecret,
  rawAuthorization,
  rawGenericToken,
  rawIdempotency,
  rawRequestHash,
  rawPrivateKeyHeader,
]) {
  assert(!jsonOutput.includes(unsafe));
  assert(!markdown.includes(unsafe));
}
assertEvidenceIndexOutputRedacted(jsonOutput);
assertEvidenceIndexOutputRedacted(markdown);
