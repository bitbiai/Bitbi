import assert from "node:assert/strict";
import fs from "node:fs";
import { extractInlineScripts } from "./runtime-work-inventory.mjs";
import { escapeMarkdownTableCell } from "./lib/markdown-table.mjs";
import { escapeMediaInventoryMarkdownCell } from "./media-derivative-inventory.mjs";
import { renderTenantAssetEvidenceSummaryMarkdown } from "./summarize-tenant-asset-evidence.mjs";
import { exportManualReviewPostCleanupEvidenceMarkdown } from "../workers/auth/src/lib/tenant-asset-manual-review-post-cleanup.js";

const inlineScripts = extractInlineScripts([
  '<script type="application/json" data-note="quoted > attribute">',
  "window.__first = true;",
  "</script >",
  '<SCRIPT data-kind="mixed">',
  "window.__second = true;",
  "</SCRIPT>",
  '<script src="/external.js">window.__external = true;</script>',
  '<script data-broken="yes">window.__broken = true;',
].join("\n"));

assert.deepEqual(inlineScripts, [
  "\nwindow.__first = true;\n",
  "\nwindow.__second = true;\n",
]);

assert.equal(escapeMarkdownTableCell("a\\b|c\r\nnext"), "a\\\\b\\|c next");
assert.equal(escapeMediaInventoryMarkdownCell("a\\b|c\nnext"), "a\\\\b\\|c next");
assert(!escapeMediaInventoryMarkdownCell("a\\b|c\nnext").includes("\n"));

const tenantSummaryMarkdown = renderTenantAssetEvidenceSummaryMarkdown({
  generatedAt: "2026-06-03T00:00:00.000Z",
  reportGeneratedAt: "2026-06-03T00:00:00.000Z",
  sourcePath: "fixtures/codeql.json",
  evidenceEnvironment: "synthetic_fixture",
  mainOnlyEvidence: false,
  syntheticFixture: true,
  operator: "operator\\name|with pipe",
  commitSha: "abc123",
  decisionStatus: "blocked",
  safetyFlags: {
    pipeAndSlash: "a\\b|c\nnext",
  },
  counts: { total: 1 },
  highRiskCounts: { unsafe: 0 },
});

assert(tenantSummaryMarkdown.includes("a\\\\b\\|c next"));

const manualReviewMarkdown = exportManualReviewPostCleanupEvidenceMarkdown({
  generatedAt: "2026-06-03T00:00:00.000Z",
  sourceEndpoint: "/api/admin/tenant-assets/manual-review/post-cleanup/dry-run",
  dryRun: true,
  summary: {
    totalReviewItems: 1,
    supersededCandidates: 1,
    categoryCounts: {},
  },
  safeSampleItems: [{
    id: "item\\id|pipe\nnext",
    assetDomain: "folders-images",
    issueCategory: "metadata_missing",
    classification: "superseded",
    reason: "reason\\with|pipe",
  }],
  blockedClaims: [],
});

assert(manualReviewMarkdown.includes("item\\\\id\\|pipe next"));
assert(manualReviewMarkdown.includes("reason\\\\with\\|pipe"));

const homepageHeroVideosSource = fs.readFileSync(
  new URL("../js/pages/admin/homepage-hero-videos.js", import.meta.url),
  "utf8",
);
const manualHeroVideoUploadSource = fs.readFileSync(
  new URL("../js/pages/admin/manual-hero-video-upload.js", import.meta.url),
  "utf8",
);

assert(!homepageHeroVideosSource.includes("video.setAttribute('src', localObjectUrl)"));
assert(!homepageHeroVideosSource.includes("localObjectUrl"));
assert(!manualHeroVideoUploadSource.includes("video.setAttribute('src', localObjectUrl)"));
assert(!manualHeroVideoUploadSource.includes("localObjectUrl"));
assert(manualHeroVideoUploadSource.includes("URL.createObjectURL(videoBlob)"));
assert(manualHeroVideoUploadSource.includes("URL.revokeObjectURL(objectUrl)"));

console.log("CodeQL security helper regression checks passed.");
