import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const CHECK_TARGETS = [
  "scripts/check-dom-sinks.mjs",
  "scripts/check-js.mjs",
  "scripts/check-route-policies.mjs",
  "scripts/check-secrets.mjs",
  "scripts/check-toolchain.mjs",
  "scripts/lib/quality-gates.mjs",
  "scripts/release-preflight.mjs",
  "scripts/test-quality-gates.mjs",
  "workers/auth/src/lib/ai-video-jobs.js",
  "workers/auth/src/lib/security-secrets.js",
  "workers/auth/src/app/route-policy.js",
  "workers/auth/src/routes/admin-ai.js",
  "workers/ai/src/routes/video-task.js",
  "js/pages/admin/ai-lab.js",
  "js/shared/auth-api.js",
  "js/shared/admin-ai-contract.mjs",
  "js/shared/request-body.mjs",
  "js/shared/service-auth.mjs",
];

const failures = [];
for (const relativePath of CHECK_TARGETS) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    failures.push(`${relativePath}: missing check target`);
    continue;
  }
  const result = spawnSync(process.execPath, ["--check", absolutePath], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    failures.push(`${relativePath}: ${result.stderr || result.stdout || "syntax check failed"}`);
  }
}

if (failures.length > 0) {
  console.error("JavaScript syntax check failed:");
  for (const failure of failures) {
    console.error(`- ${failure.trim()}`);
  }
  process.exit(1);
}

console.log(`JavaScript syntax guard passed for ${CHECK_TARGETS.length} targeted files.`);
