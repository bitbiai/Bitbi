#!/usr/bin/env node

import {
  assertEvidenceIndexOutputRedacted,
  buildEvidenceIndex,
  renderEvidenceIndexMarkdown,
} from "./lib/evidence-index.mjs";

function parseArgs(argv) {
  const options = {
    format: "json",
    help: false,
  };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--json") options.format = "json";
    else if (arg === "--markdown") options.format = "markdown";
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(`evidence:index failed: ${error.message}`);
  process.exit(1);
}

if (options.help) {
  console.log(`Usage: node scripts/evidence-index.mjs [options]

Default behavior is local-only, redacted, bounded, and non-mutating.

Options:
  --json       Print JSON evidence index. This is the default.
  --markdown   Print Markdown evidence index.

This helper scans committed/local repo evidence files only. It does not read live
R2, call Cloudflare, call Stripe, call providers, deploy, migrate, delete,
repair, issue refunds, create checkouts, mutate credits, or mutate subscriptions.
Unsafe-marker review output is limited to file paths, marker references, marker
classes, document classification, readiness impact, and recommended action. Raw
candidate values are suppressed and unresolved candidates keep ok:false.`);
  process.exit(0);
}

try {
  const index = buildEvidenceIndex({ repoRoot: process.cwd() });
  const output = options.format === "markdown"
    ? renderEvidenceIndexMarkdown(index)
    : `${JSON.stringify(index, null, 2)}\n`;
  assertEvidenceIndexOutputRedacted(output);
  process.stdout.write(output);
} catch (error) {
  console.error(`evidence:index failed: ${error.message}`);
  process.exit(1);
}
