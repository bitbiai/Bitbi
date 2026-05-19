#!/usr/bin/env node

import {
  createRollbackDrill,
  renderRollbackDrillMarkdown,
} from "./lib/rollback-drill.mjs";

function parseArgs(argv) {
  const options = { markdown: true, help: false };
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
    console.log(`Usage: node scripts/rollback-drill.mjs [--markdown|--json]

Generates a non-mutating rollback drill artifact. It does not execute rollback, call Cloudflare/GitHub APIs, deploy, or run migrations.`);
    process.exit(0);
  }
  const drill = createRollbackDrill({ repoRoot: process.cwd() });
  process.stdout.write(options.markdown ? renderRollbackDrillMarkdown(drill) : `${JSON.stringify(drill, null, 2)}\n`);
} catch (error) {
  console.error(`release:rollback-drill failed: ${error.message || String(error)}`);
  process.exit(1);
}
