import assert from "node:assert/strict";
import {
  createRcCheckPlan,
  FINAL_RC_COMMANDS,
  renderRcCheckMarkdown,
  runRcCheck,
} from "./lib/rc-check.mjs";

const plan = createRcCheckPlan({ generatedAt: "2026-05-19T12:00:00.000Z" });

assert.equal(plan.version, "omega-p1-wave10-rc-check-v1");
assert.equal(plan.localOnly, true);
assert.equal(plan.defaultRunsCommands, false);
assert.equal(plan.stopOnFailure, true);
assert.equal(plan.liveUrlsRequired, false);
assert.equal(plan.secretsRequired, false);
assert.equal(plan.deployCommandsIncluded, false);
assert.equal(plan.remoteMigrationCommandsIncluded, false);
assert.equal(plan.ok, true);
assert.equal(plan.commandCount, FINAL_RC_COMMANDS.length);

for (const required of [
  "npm audit --audit-level=low",
  "npm --prefix workers/auth audit --audit-level=low",
  "npm run check:js",
  "npm run check:secrets",
  "npm run check:route-policies",
  "npm run check:dom-sinks",
  "npm run check:data-lifecycle",
  "npm run check:admin-activity-query-shape",
  "npm run test:workers",
  "npm run test:static",
  "npm run test:tenant-assets",
  "npm run test:cloudflare-resource-model",
  "npm run test:readiness-dossier",
  "npm run test:rollback-drill",
  "npm run test:evidence-index",
  "npm run test:release-rc",
  "npm run test:rc-check",
  "npm run release:plan",
  "npm run cloudflare:resource-model",
  "npm run readiness:dossier",
  "npm run release:rollback-drill",
  "git diff --check",
]) {
  assert(plan.commands.some((entry) => entry.command === required), `${required} missing from RC matrix`);
}

for (const forbidden of [
  "wrangler deploy",
  "wrangler d1 migrations apply bitbi-auth-db --remote",
  "npm run release:apply",
]) {
  assert(!plan.commands.some((entry) => entry.command.includes(forbidden)), `${forbidden} must not be in RC matrix`);
}

const calls = [];
const failed = runRcCheck({
  execute: true,
  generatedAt: "2026-05-19T12:00:00.000Z",
  runner(entry) {
    calls.push(entry.command);
    return entry.command === "npm run check:secrets"
      ? { ok: false, code: 2 }
      : { ok: true, code: 0 };
  },
});
assert.equal(failed.ok, false);
assert.equal(failed.mode, "executed_local_matrix");
assert.equal(failed.failedCommand.command, "npm run check:secrets");
assert.equal(calls.at(-1), "npm run check:secrets");
assert(!calls.includes("npm run test:workers"));

const markdown = renderRcCheckMarkdown(plan);
assert(markdown.includes("Release Candidate Validation Matrix"));
assert(markdown.includes("npm run release:rc"));
assert(markdown.includes("Default runs commands: **false**"));
assert(!markdown.includes("Cookie:"));
assert(!markdown.includes("Authorization:"));

console.log("RC check tests passed.");
