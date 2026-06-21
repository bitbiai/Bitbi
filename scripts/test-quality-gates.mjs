import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  checkMaintainabilityFileBudgets,
  collectLargeMaintainabilityFiles,
  scanDomSinksAgainstBaseline,
  scanSecretText,
  validateToolchainFiles,
} from "./lib/quality-gates.mjs";

{
  const violations = scanSecretText("const token = 'sk-proj-abcdefghijklmnopqrstuvwxyz123456';\n", "fixture.js"); // example fixture only
  assert(violations.some((violation) => violation.rule === "openai-or-compatible-key"));
}

{
  const violations = scanSecretText("const name = 'AI_SERVICE_AUTH_SECRET';\n", "fixture.js");
  assert.equal(violations.length, 0);
}

{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bitbi-dom-scan-"));
  fs.mkdirSync(path.join(tmp, "js"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "js/clean.js"), "node.textContent = value;\n");
  fs.writeFileSync(path.join(tmp, "js/reviewed.js"), "node.inner" + "HTML = SAFE_STATIC_MARKUP;\n");
  fs.writeFileSync(path.join(tmp, "js/new.js"), "target.insertAdjacent" + "HTML('beforeend', markup);\n");
  const violations = scanDomSinksAgainstBaseline(tmp, {
    version: 1,
    sinks: {
      "js/reviewed.js": {
        innerHTML: 1,
      },
    },
  });
  assert.deepEqual(violations, [
    {
      file: "js/new.js",
      sink: "insertAdjacentHTML",
      count: 1,
      allowed: 0,
    },
  ]);
}

{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bitbi-toolchain-"));
  fs.mkdirSync(path.join(tmp, ".github/workflows"), { recursive: true });
  fs.writeFileSync(path.join(tmp, ".nvmrc"), "22\n");
  fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({
    engines: {
      node: ">=22 <23",
      npm: ">=10",
    },
  }));
  fs.writeFileSync(path.join(tmp, ".github/workflows/static.yml"), "node-version: 22\nnpm run check:worker-dependency-audits\n");
  assert.deepEqual(validateToolchainFiles(tmp), []);
}

{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bitbi-toolchain-"));
  fs.mkdirSync(path.join(tmp, ".github/workflows"), { recursive: true });
  fs.writeFileSync(path.join(tmp, ".nvmrc"), "22\n");
  fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({
    engines: {
      node: ">=22 <23",
      npm: ">=10",
    },
  }));
  fs.writeFileSync(
    path.join(tmp, ".github/workflows/static.yml"),
    "node-version: 22\nnpm --prefix \"$worker\" audit --audit-level=low\n"
  );
  assert(validateToolchainFiles(tmp).some((issue) => issue.includes("worker dependency audit guard")));
  assert(validateToolchainFiles(tmp).some((issue) => issue.includes("instead of direct worker npm audit")));
}

{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bitbi-maintainability-"));
  fs.mkdirSync(path.join(tmp, "js/pages/admin"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "tests"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "js/pages/admin/ai-lab.js"), "x".repeat(12));
  fs.writeFileSync(path.join(tmp, "tests/smoke.spec.js"), "x".repeat(8));

  assert.deepEqual(checkMaintainabilityFileBudgets(tmp, [
    { path: "js/pages/admin/ai-lab.js", maxBytes: 20, reason: "fixture under budget" },
  ]), []);
  assert.deepEqual(checkMaintainabilityFileBudgets(tmp, [
    { path: "js/pages/admin/ai-lab.js", maxBytes: 10, reason: "fixture over budget" },
  ]), [
    {
      path: "js/pages/admin/ai-lab.js",
      bytes: 12,
      maxBytes: 10,
      reason: "fixture over budget",
    },
  ]);

  assert.deepEqual(collectLargeMaintainabilityFiles(tmp, { minBytes: 10 }), [
    {
      path: "js/pages/admin/ai-lab.js",
      bytes: 12,
    },
  ]);
}

{
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  assert.deepEqual(checkMaintainabilityFileBudgets(repoRoot), []);
}

console.log("Quality gate tests passed.");
