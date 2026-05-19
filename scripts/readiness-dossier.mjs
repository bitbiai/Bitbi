#!/usr/bin/env node

import {
  createProductionReadinessDossier,
  renderProductionReadinessDossierMarkdown,
} from "./lib/readiness-dossier.mjs";

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

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(`Usage: node scripts/readiness-dossier.mjs [--json|--markdown]

Generates a local-only production readiness execution dossier. It does not call live endpoints by default, does not call Cloudflare/Stripe/provider APIs, does not deploy, and does not run migrations.`);
    process.exit(0);
  }
  const dossier = createProductionReadinessDossier({ repoRoot: process.cwd() });
  process.stdout.write(options.markdown
    ? renderProductionReadinessDossierMarkdown(dossier)
    : `${JSON.stringify(dossier, null, 2)}\n`);
} catch (error) {
  console.error(`readiness:dossier failed: ${error.message || String(error)}`);
  process.exit(1);
}
