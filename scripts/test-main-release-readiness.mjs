import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  EXPECTED_MAIN_RELEASE_AUTH_MIGRATION,
  collectMainReleaseReadiness,
  renderMainReleaseReadinessMarkdown,
  renderMainReleaseReadinessText,
} from "./check-main-release-readiness.mjs";

function makeRepo() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bitbi-main-release-"));
  fs.mkdirSync(path.join(repoRoot, "config"), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, "config", "release-compat.json"),
    JSON.stringify({
      release: {
        schemaCheckpoints: {
          auth: {
            latest: EXPECTED_MAIN_RELEASE_AUTH_MIGRATION,
          },
        },
      },
    })
  );
  return repoRoot;
}

function makeGitRunner({ status = "" } = {}) {
  const calls = [];
  const runner = (_repoRoot, args) => {
    calls.push(args);
    const command = args.join(" ");
    if (command === "branch --show-current") {
      return { ok: true, stdout: "main\n" };
    }
    if (command === "rev-parse HEAD") {
      return { ok: true, stdout: "abc123mainrelease\n" };
    }
    if (command === "status --short") {
      return { ok: true, stdout: status };
    }
    throw new Error(`Unexpected git command: ${command}`);
  };
  runner.calls = calls;
  return runner;
}

{
  const repoRoot = makeRepo();
  const secretValue = "super-secret-main-release-value";
  const gitRunner = makeGitRunner();
  const readiness = collectMainReleaseReadiness({
    repoRoot,
    gitRunner,
    generatedAt: "2026-05-15T00:00:00.000Z",
  });
  const text = renderMainReleaseReadinessText(readiness);
  const markdown = renderMainReleaseReadinessMarkdown(readiness);

  assert.equal(readiness.ok, true);
  assert.equal(readiness.branch, "main");
  assert.equal(readiness.commit, "abc123mainrelease");
  assert.equal(readiness.latestAuthMigration, EXPECTED_MAIN_RELEASE_AUTH_MIGRATION);
  assert(text.includes(EXPECTED_MAIN_RELEASE_AUTH_MIGRATION));
  assert(text.includes("Direct-main release is riskier"));
  assert(text.includes("Production readiness: BLOCKED"));
  assert(text.includes("Live billing readiness: BLOCKED"));
  assert(text.includes("auth schema checkpoint 0057"));
  assert(!text.includes("static site"));
  assert(text.includes("auth Worker"));
  assert(!text.includes("Expected Phase 2.1-2.4 deploy units"));
  assert(text.includes("Production D1 migration status through 0057_add_ai_asset_manual_review_state.sql"));
  assert(!text.includes(secretValue));
  assert(markdown.includes("# BITBI Main-Only Release Readiness Gate"));
  assert(markdown.includes("Final verdict: **BLOCKED**"));
  assert(markdown.includes("Expected current deploy units"));
  assert(!markdown.includes(secretValue));
  assert.deepEqual(
    gitRunner.calls.map((args) => args.join(" ")),
    ["branch --show-current", "rev-parse HEAD", "status --short"]
  );
}

{
  const repoRoot = makeRepo();
  const dirtyGitRunner = makeGitRunner({
    status: " M docs/production-readiness/README.md\n?? notes.txt\n",
  });
  const readiness = collectMainReleaseReadiness({
    repoRoot,
    gitRunner: dirtyGitRunner,
  });
  assert.equal(readiness.ok, false);
  assert.equal(readiness.status.clean, false);
  assert(readiness.issues.some((issue) => /dirty/i.test(issue)));
}

{
  const repoRoot = makeRepo();
  const dirtyGitRunner = makeGitRunner({
    status: " M docs/production-readiness/README.md\n",
  });
  const readiness = collectMainReleaseReadiness({
    repoRoot,
    gitRunner: dirtyGitRunner,
    allowDirty: true,
  });
  assert.equal(readiness.ok, true);
  assert.equal(readiness.allowDirty, true);
  assert(renderMainReleaseReadinessMarkdown(readiness).includes("allowed for local planning"));
}

{
  const repoRoot = makeRepo();
  fs.writeFileSync(
    path.join(repoRoot, "config", "release-compat.json"),
    JSON.stringify({
      release: {
        schemaCheckpoints: {
          auth: {
            latest: "0046_wrong.sql",
          },
        },
      },
    })
  );
  const readiness = collectMainReleaseReadiness({
    repoRoot,
    gitRunner: makeGitRunner(),
  });
  assert.equal(readiness.ok, false);
  assert(readiness.issues.some((issue) => issue.includes("Latest auth migration mismatch")));
}

{
  const repoRoot = makeRepo();
  const gitRunner = makeGitRunner();
  collectMainReleaseReadiness({
    repoRoot,
    gitRunner,
  });
  const joinedCalls = gitRunner.calls.map((args) => args.join(" ")).join("\n");
  assert(!joinedCalls.includes("wrangler"));
  assert(!joinedCalls.includes("deploy"));
  assert(!joinedCalls.includes("migrations apply"));
  assert(!joinedCalls.includes("stripe"));
}

console.log("Main-release readiness tests passed.");
