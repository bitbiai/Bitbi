#!/usr/bin/env node

import {
  createRcCheckPlan,
  renderRcCheckMarkdown,
  runRcCheck,
} from "./lib/rc-check.mjs";

function parseArgs(argv) {
  const options = {
    run: false,
    format: "json",
    help: false,
  };
  for (const arg of argv) {
    if (arg === "--run") options.run = true;
    else if (arg === "--json") options.format = "json";
    else if (arg === "--markdown") options.format = "markdown";
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(`Usage: node scripts/rc-check.mjs [--json|--markdown] [--run]

Default behavior prints the final Release Candidate validation matrix. Use --run
to execute the local-only matrix and stop on the first failure. This command does
not deploy, run remote migrations, require live URLs, or require secrets.`);
    process.exit(0);
  }

  const result = options.run
    ? runRcCheck({ repoRoot: process.cwd(), execute: true })
    : createRcCheckPlan();
  const output = options.format === "markdown"
    ? renderRcCheckMarkdown(result)
    : `${JSON.stringify(result, null, 2)}\n`;
  process.stdout.write(output);
  process.exit(result.ok ? 0 : 1);
} catch (error) {
  console.error(`rc:check failed: ${error.message || String(error)}`);
  process.exit(1);
}
