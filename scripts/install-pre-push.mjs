import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const hooksPath = ".githooks";
const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function config(...args) {
  const result = spawnSync("git", ["config", ...args], { encoding: "utf8" });
  if (result.status !== 0 && result.status !== 1) throw new Error("Cannot inspect Git hook configuration.");
  return result.status === 0 ? result.stdout.trim() : null;
}
function executable(file) {
  try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile(); }
  catch (error) { if (error.code === "ENOENT" || error.code === "EACCES") return false; throw error; }
}

try {
  if (process.argv.slice(2).some((arg) => arg !== "--check")) throw new Error("Usage: node scripts/install-pre-push.mjs [--check]");
  const root = git("rev-parse", "--show-toplevel");
  const effective = config("--get", "core.hooksPath");
  const local = config("--local", "--get", "core.hooksPath");
  if (effective !== null && (effective !== hooksPath || local !== hooksPath)) {
    throw new Error("Existing core.hooksPath is preserved. Integrate the reviewed check with the existing hooks before installation.");
  }
  const hook = path.join(root, hooksPath, "pre-push");
  if (!executable(hook)) throw new Error("Versioned .githooks/pre-push is absent or not executable; installation not verified.");
  for (const file of ["scripts/check-push-quality.mjs", "scripts/lib/quality-gates.mjs"]) {
    if (!fs.statSync(path.join(root, file)).isFile()) throw new Error(`Required checker missing: ${file}`);
  }
  if (effective === null) {
    // Changing hooksPath would hide any existing hook, not just pre-push.
    const defaults = path.resolve(root, git("rev-parse", "--git-common-dir"), "hooks");
    if (fs.existsSync(defaults) && fs.readdirSync(defaults).some((name) => !name.endsWith(".sample") && executable(path.join(defaults, name)))) {
      throw new Error("Existing executable Git hooks are preserved; integrate them explicitly before changing hooksPath.");
    }
    // Local config is shared by linked worktrees. Do not silently activate a different hook there.
    const worktrees = git("worktree", "list", "--porcelain", "-z").split("\0").filter((field) => field.startsWith("worktree ")).map((field) => field.slice(9));
    for (const worktree of worktrees) {
      if (fs.realpathSync(worktree) !== fs.realpathSync(root) && fs.existsSync(path.join(worktree, hooksPath))) {
        throw new Error("Another worktree has .githooks; preserve it and resolve per-worktree configuration explicitly.");
      }
    }
  }
  if (process.argv.includes("--check")) {
    if (effective !== hooksPath || local !== hooksPath) throw new Error("Pre-push budgets are not installed here. Run npm run hooks:install.");
  } else if (effective === null) {
    git("config", "--local", "core.hooksPath", hooksPath);
  }
  if (config("--get", "core.hooksPath") !== hooksPath) throw new Error("Hook activation could not be verified.");
  console.log(`Pre-push budgets active in ${root}. Other clones/worktrees are not certified; run hooks:check in each intended checkout.`);
} catch (error) {
  console.error(`Pre-push installation failed: ${error.message}`); process.exitCode = 1;
}
