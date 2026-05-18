#!/usr/bin/env node

import {
  collectReleaseCutoverEvidence,
  renderReleaseCutoverEvidenceMarkdown,
  writeReleaseCutoverEvidence,
} from "./lib/release-cutover-evidence.mjs";

function parseArgs(argv) {
  const options = {
    markdown: false,
    json: false,
    allowDirtyPlanning: false,
    force: false,
    output: null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--markdown") {
      options.markdown = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--allow-dirty") {
      options.allowDirtyPlanning = true;
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--output") {
      index += 1;
      if (!argv[index]) throw new Error("--output requires a path.");
      options.output = argv[index];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.markdown && options.json) {
    throw new Error("Use either --markdown or --json, not both.");
  }
  return options;
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(`release:cutover-evidence failed: ${error.message}`);
  process.exit(1);
}

if (options.help) {
  console.log(`Usage: node scripts/release-cutover-evidence.mjs [options]

Default output is JSON to stdout. The command is local-only and non-mutating.

Options:
  --json                         Print JSON output. This is the default.
  --markdown                     Print markdown output.
  --allow-dirty                  Classify a dirty worktree as local planning evidence only.
  --output <path>                Write output under docs/production-readiness/evidence/.
  --force                        Allow overwriting an existing --output file.

This command never deploys, runs remote migrations, calls live endpoints, calls Stripe/providers, mutates Cloudflare/D1/R2/Queues/GitHub, executes reset/delete, backfills ownership, or switches tenant access checks.`);
  process.exit(0);
}

try {
  const evidence = collectReleaseCutoverEvidence({
    repoRoot: process.cwd(),
    allowDirtyPlanning: options.allowDirtyPlanning,
  });
  const output = options.markdown
    ? renderReleaseCutoverEvidenceMarkdown(evidence)
    : `${JSON.stringify(evidence, null, 2)}\n`;

  if (options.output) {
    const relativePath = writeReleaseCutoverEvidence(process.cwd(), options.output, output, {
      force: options.force,
    });
    console.log(`Wrote release cutover evidence to ${relativePath}`);
  }

  if (!options.output || options.markdown || options.json) {
    process.stdout.write(output);
  }
} catch (error) {
  console.error(`release:cutover-evidence failed: ${error.message}`);
  process.exit(1);
}
