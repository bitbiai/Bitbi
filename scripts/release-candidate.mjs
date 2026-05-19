#!/usr/bin/env node

import {
  createReleaseCandidateManifest,
  renderReleaseCandidateMarkdown,
} from "./lib/release-candidate.mjs";

function parseArgs(argv) {
  const options = { format: "json", help: false };
  for (const arg of argv) {
    if (arg === "--json") options.format = "json";
    else if (arg === "--markdown") options.format = "markdown";
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(`Usage: node scripts/release-candidate.mjs [--json|--markdown]

Generates a local-only Release Candidate Go/No-Go manifest. It does not call live
endpoints, call Cloudflare/Stripe/provider APIs, deploy, run migrations, mutate
production data, execute rollback, enable reset, backfill ownership, or switch
tenant access checks.`);
    process.exit(0);
  }
  const manifest = createReleaseCandidateManifest({ repoRoot: process.cwd() });
  process.stdout.write(options.format === "markdown"
    ? renderReleaseCandidateMarkdown(manifest)
    : `${JSON.stringify(manifest, null, 2)}\n`);
} catch (error) {
  console.error(`release:rc failed: ${error.message || String(error)}`);
  process.exit(1);
}
