import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanDocCurrentness } from "./lib/doc-currentness.mjs";

const latest = "0050_add_news_pulse_visual_budget_metadata.sql";

function makeRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "bitbi-doc-currentness-"));
  fs.mkdirSync(path.join(repo, "config"), { recursive: true });
  fs.writeFileSync(path.join(repo, "config", "release-compat.json"), JSON.stringify({
    release: {
      schemaCheckpoints: {
        auth: {
          latest,
        },
      },
    },
  }));
  return repo;
}

function writeFile(repo, relativePath, text) {
  const absolutePath = path.join(repo, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, text);
}

{
  const repo = makeRepo();
  writeFile(repo, "README.md", `Current release truth: latest auth D1 migration is ${latest}.\n`);
  writeFile(repo, "CURRENT_IMPLEMENTATION_HANDOFF.md", `Latest auth D1 migration: \`${latest}\`\n`);
  const result = scanDocCurrentness(repo, {
    currentDocs: ["README.md", "CURRENT_IMPLEMENTATION_HANDOFF.md"],
  });
  assert.deepEqual(result.violations, []);
}

{
  const repo = makeRepo();
  writeFile(repo, "README.md", "Latest auth D1 migration: `0040_add_live_stripe_credit_pack_scope.sql`\n");
  const result = scanDocCurrentness(repo, {
    currentDocs: ["README.md"],
    requireLatest: false,
  });
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].type, "stale-latest-migration");
}

{
  const repo = makeRepo();
  writeFile(repo, "README.md", `Current release truth: ${latest}\n`);
  writeFile(repo, "PHASE2L_LIVE_STRIPE_CREDIT_PACKS_AND_CREDITS_DASHBOARD_REPORT.md", "Latest auth D1 migration at that historical phase: `0040_add_live_stripe_credit_pack_scope.sql`\n");
  const result = scanDocCurrentness(repo, {
    currentDocs: ["README.md"],
  });
  assert.deepEqual(result.violations, []);
}

{
  const repo = makeRepo();
  writeFile(repo, "README.md", "Current release truth is documented elsewhere.\n");
  const result = scanDocCurrentness(repo, {
    currentDocs: ["README.md"],
  });
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].type, "missing-current-latest");
}

console.log("Doc currentness tests passed.");
