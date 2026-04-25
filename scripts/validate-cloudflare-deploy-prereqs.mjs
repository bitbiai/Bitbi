import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadCloudflareDeployPrereqContext,
  validateCloudflareDeployPrereqs,
} from "./lib/cloudflare-deploy-prereqs.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const options = {
    live: false,
    requireLive: false,
    requireProductionReady: false,
    json: false,
  };
  for (const arg of argv) {
    if (arg === "--live") {
      options.live = true;
    } else if (arg === "--require-live") {
      options.requireLive = true;
      options.live = true;
    } else if (arg === "--require-production-ready") {
      options.requireProductionReady = true;
      options.requireLive = true;
      options.live = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function formatStatus(value) {
  return String(value || "").toUpperCase();
}

function formatText(result) {
  const lines = [];
  lines.push("Cloudflare deploy prerequisite validation");
  lines.push(`- Repo config ready: ${formatStatus(result.repoConfigReady ? "pass" : "fail")}`);
  lines.push(`- Live validation: ${formatStatus(result.liveValidation)}`);
  lines.push(`- Production deploy ready: ${formatStatus(result.productionDeployReady ? "pass" : "blocked")}`);
  lines.push("");
  lines.push("Checks:");
  for (const check of result.checks) {
    lines.push(`- ${formatStatus(check.status)} ${check.id}: ${check.message}`);
  }
  if (result.productionBlockers.length > 0) {
    lines.push("");
    lines.push("Production deploy blockers:");
    for (const blocker of result.productionBlockers) {
      lines.push(`- ${blocker}`);
    }
  }
  if (result.issues.length > 0) {
    lines.push("");
    lines.push("Issues:");
    for (const issue of result.issues) {
      lines.push(`- ${issue.severity}: ${issue.id} — ${issue.message}`);
    }
  }
  return lines.join("\n");
}

function usage() {
  return [
    "node scripts/validate-cloudflare-deploy-prereqs.mjs [--json] [--live] [--require-live] [--require-production-ready]",
    "",
    "Default mode validates repo-controlled release/wrangler config and reports live Cloudflare validation as skipped.",
    "--live checks Cloudflare secret names through wrangler where credentials are available; secret values are never printed.",
    "--require-live fails if live validation cannot pass.",
    "--require-production-ready requires live validation plus manual/resource verification readiness.",
  ].join("\n");
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    process.exit(0);
  }
  const context = loadCloudflareDeployPrereqContext(repoRoot);
  const result = validateCloudflareDeployPrereqs(context, options);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatText(result));
  }
  process.exit(result.ok ? 0 : 1);
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}
