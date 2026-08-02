import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { formatCiTestSelection, selectCiTests } from "./lib/ci-test-selection.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const options = {
    files: [],
    base: "",
    head: "HEAD",
    forceFull: false,
    githubOutput: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--file") options.files.push(argv[++index] || "");
    else if (arg === "--files") options.files.push(...String(argv[++index] || "").split(/[\n,]/));
    else if (arg === "--base") options.base = argv[++index] || "";
    else if (arg === "--head") options.head = argv[++index] || "HEAD";
    else if (arg === "--force-full") options.forceFull = true;
    else if (arg === "--github-output") options.githubOutput = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function runGit(args) {
  return spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
}

function resolveFiles(options) {
  const explicit = options.files.map((file) => String(file || "").trim()).filter(Boolean);
  if (explicit.length > 0) return { files: explicit, issue: "" };
  if (options.base) {
    const base = String(options.base).trim();
    const head = String(options.head || "HEAD").trim();
    const invalidRef = [base, head].find((ref) => (
      !ref
      || /^0+$/.test(ref)
      || runGit(["cat-file", "-e", `${ref}^{commit}`]).status !== 0
    ));
    if (invalidRef) {
      return { files: [], issue: `unresolved git ref: ${invalidRef || "empty"}` };
    }
    const result = runGit(["diff", "--name-only", "--no-renames", `${base}...${head}`, "--"]);
    if (result.status !== 0) {
      return { files: [], issue: result.stderr?.trim() || "git diff failed" };
    }
    return { files: result.stdout.split("\n"), issue: "" };
  }

  const changed = new Set();
  const tracked = runGit(["diff", "--name-only", "HEAD", "--"]);
  const untracked = runGit(["ls-files", "--others", "--exclude-standard"]);
  if (tracked.status !== 0 || untracked.status !== 0) {
    return { files: [], issue: "local git status could not be resolved" };
  }
  for (const file of `${tracked.stdout}\n${untracked.stdout}`.split("\n")) {
    if (file.trim()) changed.add(file.trim());
  }
  return { files: [...changed], issue: "" };
}

function appendLine(filePath, line) {
  fs.appendFileSync(filePath, `${line}\n`, "utf8");
}

function writeGithubOutput(selection) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) throw new Error("GITHUB_OUTPUT is required with --github-output");
  const outputs = {
    docs_only: selection.docsOnly,
    homepage: selection.homepage,
    carousel: selection.carousel,
    assets: selection.assets,
    workers: selection.workers,
    auth: selection.auth,
    dependencies: selection.dependencies,
    worker_dependencies: selection.workerDependencies,
    static: selection.static,
    full: selection.full,
    runtime: selection.runtime,
    changed_files_json: JSON.stringify(selection.files),
  };
  for (const [key, value] of Object.entries(outputs)) {
    appendLine(outputPath, `${key}=${String(value)}`);
  }
}

function writeGithubSummary(selection) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  const lines = [
    "## Change-based Test Selection",
    "",
    ...formatCiTestSelection(selection).split("\n").map((line) => `- ${line}`),
    "",
    "### Changed files",
    "",
    ...(selection.files.length > 0
      ? selection.files.map((file) => `- \`${file}\``)
      : ["- None resolved; full regression selected."]),
    "",
  ];
  appendLine(summaryPath, lines.join("\n"));
}

function usage() {
  return [
    "Usage: node scripts/select-ci-tests.mjs [options]",
    "  --file <path>        Add one changed file",
    "  --files <a,b>        Add comma/newline-separated changed files",
    "  --base <git-ref>     Resolve files from base...head",
    "  --head <git-ref>     Diff head (default HEAD)",
    "  --force-full         Select every suite",
    "  --github-output      Write stable booleans to GITHUB_OUTPUT",
  ].join("\n");
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    process.exit(0);
  }
  const resolved = resolveFiles(options);
  const selection = selectCiTests(resolved.files, {
    forceFull: options.forceFull || !!resolved.issue,
    forceReason: resolved.issue || "explicit full regression",
  });
  console.log(formatCiTestSelection(selection));
  console.log(JSON.stringify(selection, null, 2));
  if (options.githubOutput) {
    writeGithubOutput(selection);
    writeGithubSummary(selection);
  }
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}
