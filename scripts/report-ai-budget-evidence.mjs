#!/usr/bin/env node

import {
  buildAdminPlatformBudgetEvidenceReport,
  renderAdminPlatformBudgetEvidenceMarkdown,
} from "../workers/auth/src/lib/admin-platform-budget-evidence.js";

function parseArgs(argv) {
  const options = {
    format: "json",
    generatedAt: null,
    help: false,
  };
  for (const arg of argv) {
    if (arg === "--json") {
      options.format = "json";
    } else if (arg === "--markdown" || arg === "--md") {
      options.format = "markdown";
    } else if (arg.startsWith("--generated-at=")) {
      options.generatedAt = arg.slice("--generated-at=".length);
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printUsage() {
  console.log(`Usage: node scripts/report-ai-budget-evidence.mjs [--json|--markdown] [--generated-at=ISO_DATE]

Builds the local read-only Admin/Platform AI budget evidence report.
It does not call providers, Stripe, Cloudflare, GitHub, D1, R2, or mutate credits.`);
}

export function renderBudgetEvidenceCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printUsage();
    return 0;
  }
  const report = buildAdminPlatformBudgetEvidenceReport({
    generatedAt: options.generatedAt || undefined,
  });
  if (options.format === "markdown") {
    console.log(renderAdminPlatformBudgetEvidenceMarkdown(report));
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exitCode = renderBudgetEvidenceCli();
  } catch (error) {
    console.error(`report:ai-budget-evidence failed: ${error.message}`);
    process.exitCode = 1;
  }
}
