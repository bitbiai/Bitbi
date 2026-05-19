#!/usr/bin/env node

import {
  buildCloudflareResourceModel,
  renderCloudflareResourceModelMarkdown,
} from "./lib/cloudflare-resource-model.mjs";

function parseArgs(argv) {
  const options = { markdown: false, help: false };
  for (const arg of argv) {
    if (arg === "--markdown") options.markdown = true;
    else if (arg === "--json") options.markdown = false;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  return `Usage: node scripts/cloudflare-resource-model.mjs [--json|--markdown]

Builds a local-only Cloudflare resource prerequisite model from config/release-compat.json and Wrangler configs.

This command never calls Cloudflare APIs, never deploys, never runs remote migrations, never lists or mutates R2, and never prints secret values.`;
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    process.exit(0);
  }
  const model = buildCloudflareResourceModel({ repoRoot: process.cwd() });
  process.stdout.write(options.markdown
    ? renderCloudflareResourceModelMarkdown(model)
    : `${JSON.stringify(model, null, 2)}\n`);
  process.exit(model.ok ? 0 : 1);
} catch (error) {
  console.error(`cloudflare:resource-model failed: ${error.message || String(error)}`);
  process.exit(1);
}
