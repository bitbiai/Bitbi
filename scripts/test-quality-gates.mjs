import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
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
  fs.writeFileSync(path.join(tmp, ".nvmrc"), "20\n");
  fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({
    engines: {
      node: ">=20 <21",
      npm: ">=10",
    },
  }));
  fs.writeFileSync(path.join(tmp, ".github/workflows/static.yml"), "node-version: 20\n");
  assert.deepEqual(validateToolchainFiles(tmp), []);
}

console.log("Quality gate tests passed.");
