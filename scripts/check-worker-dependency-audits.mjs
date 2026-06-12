import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const WORKERS = Object.freeze(["workers/auth", "workers/contact", "workers/ai"]);

const ALLOWED_ESBUILD_ADVISORIES = new Set([
  "GHSA-gv7w-rqvm-qjhr",
  "GHSA-g7r4-m6w7-qqqr",
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function advisoryId(entry) {
  const url = String(entry?.url || "");
  const match = url.match(/GHSA-[A-Za-z0-9-]+/);
  return match ? match[0] : null;
}

function isAllowedWranglerEsbuildFinding(workerDir, name, finding) {
  const pkg = readJson(path.join(repoRoot, workerDir, "package.json"));
  const runtimeDeps = Object.keys(pkg.dependencies || {});
  if (runtimeDeps.includes("wrangler")) return false;
  if (!pkg.devDependencies?.wrangler) return false;

  if (name === "esbuild") {
    const effects = Array.isArray(finding.effects) ? finding.effects : [];
    const nodes = Array.isArray(finding.nodes) ? finding.nodes : [];
    const via = Array.isArray(finding.via) ? finding.via : [];
    const advisoryIds = via.filter((entry) => typeof entry === "object").map(advisoryId).filter(Boolean);
    return effects.length === 1
      && effects[0] === "wrangler"
      && nodes.every((node) => node === "node_modules/esbuild")
      && advisoryIds.length > 0
      && advisoryIds.every((id) => ALLOWED_ESBUILD_ADVISORIES.has(id));
  }

  if (name === "wrangler") {
    const via = Array.isArray(finding.via) ? finding.via : [];
    const nodes = Array.isArray(finding.nodes) ? finding.nodes : [];
    return finding.isDirect === true
      && via.length === 1
      && via[0] === "esbuild"
      && nodes.every((node) => node === "node_modules/wrangler");
  }

  return false;
}

function runAudit(workerDir) {
  const result = spawnSync("npm", ["--prefix", workerDir, "audit", "--audit-level=low", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  let report = null;
  try {
    report = JSON.parse(result.stdout || "{}");
  } catch (error) {
    return {
      ok: false,
      workerDir,
      errors: [`${workerDir}: npm audit did not return parseable JSON.`],
      output,
    };
  }

  const findings = Object.entries(report.vulnerabilities || {});
  const blocked = [];
  const allowed = [];
  for (const [name, finding] of findings) {
    if (isAllowedWranglerEsbuildFinding(workerDir, name, finding)) {
      allowed.push(name);
    } else {
      blocked.push(`${name} (${finding?.severity || "unknown"})`);
    }
  }

  if (blocked.length > 0) {
    return {
      ok: false,
      workerDir,
      errors: [`${workerDir}: blocked dependency audit findings: ${blocked.join(", ")}`],
      output,
    };
  }

  if (result.status === 0) {
    return { ok: true, workerDir, allowed };
  }

  if (allowed.length > 0 && findings.length === allowed.length) {
    return { ok: true, workerDir, allowed };
  }

  return {
    ok: false,
    workerDir,
    errors: [`${workerDir}: npm audit failed without a recognized narrow worker tooling exception.`],
    output,
  };
}

const failures = [];
for (const workerDir of WORKERS) {
  const result = runAudit(workerDir);
  if (!result.ok) {
    failures.push(result);
    continue;
  }
  if (result.allowed?.length) {
    console.warn(
      `${workerDir}: allowed current Wrangler dev-tooling audit finding (${result.allowed.join(", ")}). ` +
      "Wrangler depends on esbuild <0.28.1; this exception is limited to worker devDependency tooling and must be revisited when Wrangler ships a patched dependency chain."
    );
  } else {
    console.log(`${workerDir}: dependency audit passed with no findings.`);
  }
}

if (failures.length > 0) {
  console.error("Worker dependency audit failed.");
  for (const failure of failures) {
    for (const error of failure.errors) console.error(`- ${error}`);
    if (failure.output) console.error(failure.output);
  }
  process.exit(1);
}

console.log("Worker dependency audit guard passed.");
