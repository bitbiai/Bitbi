import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildStaticSite,
  extractAssetVersionTokens,
  generateAssetVersionToken,
  validateAssetVersionSources,
} from "./lib/asset-version.mjs";

{
  assert.deepEqual(extractAssetVersionTokens('?v=__ASSET_VERSION__ foo ?v=abc123'), [
    "__ASSET_VERSION__",
    "abc123",
  ]);
}

{
  const issues = validateAssetVersionSources({
    placeholder: "__ASSET_VERSION__",
    files: {
      "index.html": '<script src="js/main.js?v=__ASSET_VERSION__"></script>',
    },
  });
  assert.deepEqual(issues, []);
}

{
  const issues = validateAssetVersionSources({
    placeholder: "__ASSET_VERSION__",
    files: {
      "index.html": '<script src="js/main.js?v=20260412-wave15"></script>',
    },
  });
  assert(issues.some((issue) => issue.includes('hardcoded asset version token "20260412-wave15"')));
}

{
  const issues = validateAssetVersionSources({
    placeholder: "__ASSET_VERSION__",
    files: {
      "CLAUDE.md": "Admin Release Token Checklist",
    },
  });
  assert(issues.some((issue) => issue.includes("manual asset-version choreography text")));
}

{
  assert.equal(generateAssetVersionToken({ ASSET_VERSION: "release-1234" }), "release-1234");
  assert.equal(
    generateAssetVersionToken({
      GITHUB_SHA: "bbe3d55d32d6f4c8e6a11223344556677889900",
      GITHUB_RUN_ID: "15234987654",
      GITHUB_RUN_ATTEMPT: "3",
    }),
    "bbe3d55d32d6-15234987654-3"
  );
  assert.equal(
    generateAssetVersionToken({
      GITHUB_SHA: "bbe3d55d32d6f4c8e6a11223344556677889900",
    }),
    "bbe3d55d32d6"
  );
}

{
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bitbi-asset-version-"));
  const repoRoot = path.join(tempRoot, "repo");
  const outDir = path.join(repoRoot, "_site");
  fs.mkdirSync(repoRoot, { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "index.html"), '<script src="js/app.js?v=__ASSET_VERSION__"></script>');
  fs.mkdirSync(path.join(repoRoot, "js"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "js/app.js"), 'export const version = "__ASSET_VERSION__";');

  buildStaticSite(repoRoot, {
    outDir,
    placeholder: "__ASSET_VERSION__",
    versionToken: "release-1234",
  });

  assert.equal(
    fs.readFileSync(path.join(outDir, "index.html"), "utf8"),
    '<script src="js/app.js?v=release-1234"></script>'
  );
  assert.equal(
    fs.readFileSync(path.join(outDir, "js/app.js"), "utf8"),
    'export const version = "release-1234";'
  );
}

console.log("Asset version tests passed.");
