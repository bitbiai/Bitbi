import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { MAINTAINABILITY_FILE_BUDGETS, evaluateMaintainabilityFileBudgets, scanSecretText } from "./lib/quality-gates.mjs";

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bitbi-pre-push-"));
const repo = path.join(tmp, "working tree");
const remote = path.join(tmp, "remote.git");
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
Object.assign(env, { HOME: tmp, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" });
function run(program, args, cwd = repo, expected = 0, input) {
  const result = spawnSync(program, args, { cwd, env, input, encoding: "utf8" });
  assert.equal(result.error, undefined);
  if (expected === 0) assert.equal(result.status, 0, result.stdout + result.stderr);
  else assert.notEqual(result.status, 0, "Expected a hard failure, not a skipped check");
  return result.stdout + result.stderr;
}
const git = (...args) => run("git", args);
const install = (args = [], expected = 0) => run(process.execPath, ["scripts/install-pre-push.mjs", ...args], repo, expected);
const write = (file, bytes) => { fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true }); fs.writeFileSync(path.join(repo, file), bytes); };
const commit = (message) => { git("add", "."); git("commit", "-m", message); return git("rev-parse", "HEAD").trim(); };
const tip = () => run("git", ["--git-dir", remote, "rev-parse", "refs/heads/main"], tmp).trim();
const ai = MAINTAINABILITY_FILE_BUDGETS.find((b) => b.path === "js/pages/admin/ai-lab.js");
const other = MAINTAINABILITY_FILE_BUDGETS.find((b) => b.path === "css/admin/admin.css");
assert.equal(ai.maxBytes, 365_000); // Historical failure must stay a meaningful red counterexample.

try {
  fs.mkdirSync(repo); fs.mkdirSync(path.join(tmp, "empty-template"));
  run("git", ["init", "--initial-branch=main", `--template=${path.join(tmp, "empty-template")}`, repo], tmp);
  run("git", ["init", "--bare", `--template=${path.join(tmp, "empty-template")}`, remote], tmp);
  git("config", "user.name", "Synthetic hook test"); git("config", "user.email", "hook@example.test");
  git("config", "commit.gpgsign", "false"); git("remote", "add", "origin", remote);
  for (const file of [".githooks/pre-push", "scripts/check-push-quality.mjs", "scripts/lib/quality-gates.mjs", "scripts/install-pre-push.mjs"]) {
    write(file, fs.readFileSync(path.join(source, file)));
  }
  fs.chmodSync(path.join(repo, ".githooks/pre-push"), 0o755);
  assert.deepEqual(scanSecretText(fs.readFileSync(path.join(repo, ".githooks/pre-push"), "utf8"), ".githooks/pre-push"), []);
  run("sh", ["-n", ".githooks/pre-push"]);
  assert.match(install(["--check"], 1), /not installed/);

  // Do not hide someone else's default or configured hooks.
  write(".git/hooks/pre-commit", "#!/bin/sh\nexit 0\n"); fs.chmodSync(path.join(repo, ".git/hooks/pre-commit"), 0o755);
  assert.match(install([], 1), /Existing executable Git hooks/);
  assert.equal(fs.readFileSync(path.join(repo, ".git/hooks/pre-commit"), "utf8"), "#!/bin/sh\nexit 0\n");
  fs.unlinkSync(path.join(repo, ".git/hooks/pre-commit")); // Only this synthetic fixture.
  git("config", "core.hooksPath", "owned-hooks");
  assert.match(install([], 1), /Existing core.hooksPath/);
  assert.equal(git("config", "--get", "core.hooksPath").trim(), "owned-hooks");
  git("config", "--unset", "core.hooksPath");
  assert.match(install(), /active in/); install(["--check"]); install();
  assert.equal(git("config", "--local", "--get", "core.hooksPath").trim(), ".githooks");

  write(ai.path, "x".repeat(ai.maxBytes - 10_000));
  const green = commit("compliant fixture");
  assert.match(git("push", "origin", "main"), /Pre-push budgets passed/); assert.equal(tip(), green);

  // Exact historical byte count, synthetic contents. The real source is never executed here.
  write(ai.path, "x".repeat(369_320)); const red = commit("historical over-budget size");
  assert.match(run("git", ["push", "origin", "main"], repo, 1), /369320 bytes; budget 365000; over by 4320 bytes/);
  assert.equal(tip(), green);
  write(ai.path, "small working copy\n");
  assert.match(run("git", ["push", "origin", "main"], repo, 1), /369320 bytes; budget 365000; over by 4320 bytes/);
  assert.equal(git("rev-parse", "HEAD").trim(), red); assert.equal(tip(), green);
  assert.equal(fs.readFileSync(path.join(repo, ai.path), "utf8"), "small working copy\n");

  const fixed = commit("compliant successor");
  write(ai.path, "x".repeat(369_320));
  assert.match(git("push", "origin", "main"), /Pre-push budgets passed/); assert.equal(tip(), fixed);
  write(ai.path, "small working copy\n");
  const input = (sha, name = "main") => `refs/heads/${name} ${sha} refs/heads/${name} ${"0".repeat(40)}\n`;
  assert.match(run(process.execPath, ["scripts/check-push-quality.mjs"], repo, 1, input(fixed) + input(red, "oversized")), /over by 4320/);
  const policy = fs.readFileSync(path.join(repo, "scripts/lib/quality-gates.mjs"));
  write("scripts/lib/quality-gates.mjs", policy.toString().replace("365_000", "999_000"));
  assert.match(run(process.execPath, ["scripts/check-push-quality.mjs"], repo, 1, input(red)), /Push policy differs/);
  write("scripts/lib/quality-gates.mjs", policy);
  assert.match(run(process.execPath, ["scripts/check-push-quality.mjs"], repo, 1, "malformed\n"), /Invalid pre-push/);
  run(process.execPath, ["scripts/check-push-quality.mjs"], repo, 0, input("0".repeat(40)));

  // Another real policy entry is checked using the shared limit, not an AI-only special case.
  write(other.path, "x".repeat(other.maxBytes + 1)); commit("second budget violation");
  assert.match(run("git", ["push", "origin", "main"], repo, 1), /css\/admin\/admin.css:.*over by 1 bytes/); assert.equal(tip(), fixed);
  write(other.path, "/* small */\n"); fs.unlinkSync(path.join(repo, ai.path)); fs.symlinkSync("../target", path.join(repo, ai.path));
  commit("non-regular budget input");
  assert.match(run("git", ["push", "origin", "main"], repo, 1), /not a regular committed file/); assert.equal(tip(), fixed);
  assert.throws(() => evaluateMaintainabilityFileBudgets(() => NaN), /Invalid file size/);
  console.log("Pre-push integration passed: installed hook, local bare-remote red/green, unchanged remote on rejection, dirty-tree independence, shared policy, multi-ref, malformed and non-regular inputs; no external remote.");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true }); // Owned synthetic fixture only.
}
