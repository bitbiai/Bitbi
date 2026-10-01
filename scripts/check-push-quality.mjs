import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { evaluateMaintainabilityFileBudgets, MAINTAINABILITY_FILE_BUDGETS, isSecretScanPath, scanSecretText } from "./lib/quality-gates.mjs";

const policyFiles = [".githooks/pre-push", "scripts/check-push-quality.mjs", "scripts/lib/quality-gates.mjs"];
const oidPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const git = (args, maxBuffer = 2 * 1024 * 1024) => {
  try {
    return execFileSync("git", args, {
      maxBuffer, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_NO_LAZY_FETCH: "1", GIT_NO_REPLACE_OBJECTS: "1" },
    });
  } catch {
    // Never include Git's captured streams: blob contents may contain credentials.
    throw new Error("Cannot read committed Git inputs; no quality approval.");
  }
};

// No checkout, archive, package execution, network or mutation: scan Git objects.
export function checkPushInput(input) {
  const root = git(["rev-parse", "--show-toplevel"]).toString().trim();
  const checked = new Set();
  for (const line of input.split("\n").filter(Boolean)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 4 || !oidPattern.test(fields[1]) || !oidPattern.test(fields[3])) {
      throw new Error("Invalid pre-push ref record; no quality approval.");
    }
    const [, localOid, remoteRef] = fields;
    if (/^0+$/.test(localOid)) continue; // Ref deletion has no proposed source tree.
    if (!remoteRef.startsWith("refs/heads/")) continue; // This guard covers branch tips.
    const commit = git(["rev-parse", "--verify", `${localOid}^{commit}`]).toString().trim();
    if (checked.has(commit)) continue;
    checked.add(commit);

    // Never run code extracted from another commit. A differing/dirty policy fails closed.
    for (const file of policyFiles) {
      const committed = git(["show", `${commit}:${file}`]);
      if (!committed.equals(fs.readFileSync(path.join(root, file)))) {
        throw new Error(`Push policy differs from ${commit.slice(0, 12)}: ${file}. Use its matching reviewed policy; do not bypass the hook.`);
      }
    }
    const entries = git(["ls-tree", "-r", "-l", "-z", commit, "--", ...MAINTAINABILITY_FILE_BUDGETS.map((b) => b.path)]).toString().split("\0").filter(Boolean);
    const sizes = new Map();
    for (const entry of entries) {
      const match = /^(100644|100755) blob [a-f0-9]+\s+(\d+)\t(.+)$/.exec(entry);
      if (!match) throw new Error("Budgeted path is not a regular committed file; no quality approval.");
      sizes.set(match[3], Number(match[2]));
    }
    // A replaced directory is also an error, rather than a silently missing budgeted file.
    for (const budget of MAINTAINABILITY_FILE_BUDGETS) {
      if (!sizes.has(budget.path) && entries.some((entry) => entry.includes(`\t${budget.path}/`))) {
        throw new Error(`Budgeted path is a directory: ${budget.path}`);
      }
    }
    const issues = evaluateMaintainabilityFileBudgets((file) => sizes.get(file) ?? null);
    if (issues.length) {
      throw new Error(issues.map((issue) => `${issue.path}: ${issue.bytes} bytes; budget ${issue.maxBytes}; over by ${issue.bytes - issue.maxBytes} bytes`).join("\n"));
    }
    const tree = git(["ls-tree", "-r", "-l", "-z", commit]).toString().split("\0").filter(Boolean);
    let scanned = 0;
    const violations = [];
    for (const entry of tree) {
      const match = /^(100644|100755) blob ([a-f0-9]+)\s+(\d+)\t([\s\S]+)$/.exec(entry);
      if (!match || !isSecretScanPath(match[4])) continue; // CI scans regular text files only.
      const bytes = Number(match[3]);
      if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error("Invalid committed text size; no quality approval.");
      const blob = git(["cat-file", "blob", match[2]], bytes + 1);
      if (blob.length !== bytes) throw new Error("Committed text size mismatch; no quality approval.");
      violations.push(...scanSecretText(blob.toString("utf8"), match[4]));
      scanned += 1;
    }
    if (violations.length) {
      throw new Error(`Potential committed secrets found:\n${violations.map(({ file, line, rule }) => `${file}:${line}: ${rule}`).join("\n")}`);
    }
    console.log(`Pre-push budgets passed: ${remoteRef} ${commit.slice(0, 12)} (${MAINTAINABILITY_FILE_BUDGETS.length} budgets).`);
    console.log(`Pre-push secret scan passed: ${remoteRef} ${commit.slice(0, 12)} (${scanned} committed text files).`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { checkPushInput(fs.readFileSync(0, "utf8")); }
  catch (error) { console.error(`Pre-push quality check failed: ${error.message}`); process.exitCode = 1; }
}
