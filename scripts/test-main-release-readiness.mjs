import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildMainReleaseDeployUnits,
  collectMainReleaseReadiness,
  getLatestAuthMigrationFromManifest,
  renderMainReleaseReadinessMarkdown,
  renderMainReleaseReadinessText,
} from "./check-main-release-readiness.mjs";

function makeReleaseManifest(latestAuthMigration) {
  return {
    release: {
      schemaCheckpoints: {
        auth: {
          latest: latestAuthMigration,
        },
      },
    },
  };
}

function makeRepo({ latestAuthMigration = "0099_future_test_migration.sql", manifest } = {}) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bitbi-main-release-"));
  fs.mkdirSync(path.join(repoRoot, "config"), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, "config", "release-compat.json"),
    JSON.stringify(manifest || makeReleaseManifest(latestAuthMigration))
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
  const latestAuthMigration = "0099_future_test_migration.sql";
  const repoRoot = makeRepo({ latestAuthMigration });
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
  assert.equal(readiness.latestAuthMigration, latestAuthMigration);
  assert.deepEqual(readiness.expectedDeployUnits, [
    `auth schema checkpoint ${latestAuthMigration}`,
    "auth Worker",
  ]);
  assert(text.includes(latestAuthMigration));
  assert(text.includes("Direct-main release is riskier"));
  assert(text.includes("Production readiness: BLOCKED"));
  assert(text.includes("Live billing readiness: BLOCKED"));
  assert(text.includes(`auth schema checkpoint ${latestAuthMigration}`));
  assert(!text.includes("auth schema checkpoint 0057"));
  assert(!text.includes("static site"));
  assert(text.includes("auth Worker"));
  assert(!text.includes("Expected Phase 2.1-2.4 deploy units"));
  assert(text.includes(`Production D1 migration status through ${latestAuthMigration}`));
  assert(!text.includes(secretValue));
  assert(markdown.includes("# BITBI Main-Only Release Readiness Gate"));
  assert(markdown.includes("Final verdict: **BLOCKED**"));
  assert(markdown.includes("Expected current deploy units"));
  assert(markdown.includes(latestAuthMigration));
  assert(markdown.includes(`auth schema checkpoint ${latestAuthMigration}`));
  assert(!markdown.includes(secretValue));
  assert.deepEqual(
    gitRunner.calls.map((args) => args.join(" ")),
    ["branch --show-current", "rev-parse HEAD", "status --short"]
  );
}

{
  const latestAuthMigration = "0077_another_dynamic_fixture.sql";
  const repoRoot = makeRepo({ latestAuthMigration });
  const readiness = collectMainReleaseReadiness({
    repoRoot,
    gitRunner: makeGitRunner(),
  });
  assert.equal(readiness.ok, true);
  assert.equal(readiness.latestAuthMigration, latestAuthMigration);
  assert.deepEqual(
    buildMainReleaseDeployUnits(latestAuthMigration),
    [`auth schema checkpoint ${latestAuthMigration}`, "auth Worker"]
  );
  assert(renderMainReleaseReadinessText(readiness).includes(latestAuthMigration));
}

{
  assert.equal(
    getLatestAuthMigrationFromManifest(makeReleaseManifest("0098_manifest_helper.sql")),
    "0098_manifest_helper.sql"
  );
  assert.equal(getLatestAuthMigrationFromManifest(makeReleaseManifest("   ")), null);
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
  const repoRoot = makeRepo({
    manifest: {
      release: {
        schemaCheckpoints: {
          auth: {},
        },
      },
    },
  });
  const readiness = collectMainReleaseReadiness({
    repoRoot,
    gitRunner: makeGitRunner(),
  });
  assert.equal(readiness.ok, false);
  assert.equal(readiness.latestAuthMigration, "unknown");
  assert(readiness.issues.some((issue) => issue.includes("release.schemaCheckpoints.auth.latest")));
  assert(renderMainReleaseReadinessText(readiness).includes("auth schema checkpoint unavailable"));
}

{
  const repoRoot = makeRepo({
    manifest: {
      release: {
        schemaCheckpoints: {
          auth: {
            latest: 99,
          },
        },
      },
    },
  });
  const readiness = collectMainReleaseReadiness({
    repoRoot,
    gitRunner: makeGitRunner(),
  });
  assert.equal(readiness.ok, false);
  assert(readiness.issues.some((issue) => issue.includes("release.schemaCheckpoints.auth.latest")));
}

{
  const repoRoot = makeRepo();
  fs.writeFileSync(
    path.join(repoRoot, "config", "release-compat.json"),
    "{ malformed json"
  );
  assert.throws(
    () =>
      collectMainReleaseReadiness({
        repoRoot,
        gitRunner: makeGitRunner(),
      }),
    /config\/release-compat\.json/
  );
}

{
  const repoRoot = makeRepo();
  fs.rmSync(path.join(repoRoot, "config", "release-compat.json"));
  assert.throws(
    () =>
      collectMainReleaseReadiness({
        repoRoot,
        gitRunner: makeGitRunner(),
      }),
    /config\/release-compat\.json/
  );
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
