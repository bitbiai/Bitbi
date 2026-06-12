#!/usr/bin/env node

import {
  assertBillingEvidenceIsRedacted,
  createBillingCanaryEvidenceSkeleton,
  renderBillingCanaryEvidenceMarkdown,
  writeBillingCanaryEvidence,
} from "./lib/billing-canary-evidence.mjs";
import fs from "node:fs";

function parseArgs(argv) {
  const options = {
    format: "markdown",
    output: null,
    force: false,
    adminStatusJson: null,
    operatorNote: "",
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--json") options.format = "json";
    else if (arg === "--markdown") options.format = "markdown";
    else if (arg === "--format") {
      index += 1;
      if (!argv[index] || !["json", "markdown"].includes(argv[index])) throw new Error("--format requires json or markdown.");
      options.format = argv[index];
    }
    else if (arg === "--force") options.force = true;
    else if (arg === "--output") {
      index += 1;
      if (!argv[index]) throw new Error("--output requires a path.");
      options.output = argv[index];
    } else if (arg === "--admin-status-json") {
      index += 1;
      if (!argv[index]) throw new Error("--admin-status-json requires a file path.");
      options.adminStatusJson = argv[index];
    } else if (arg === "--operator-note") {
      index += 1;
      if (!argv[index]) throw new Error("--operator-note requires text.");
      options.operatorNote = argv[index];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(`billing:canary-evidence failed: ${error.message}`);
  process.exit(1);
}

if (options.help) {
  console.log(`Usage: node scripts/billing-canary-evidence.mjs [options]

Default behavior is local-only, redacted, blocked, and non-mutating.

Options:
  --markdown        Print Markdown evidence skeleton. This is the default.
  --json            Print JSON evidence skeleton.
  --format <format> Use json or markdown.
  --output <path>   Write output under docs/production-readiness/evidence/.
  --force           Allow overwriting an existing --output file.
  --admin-status-json <file>
                    Merge a sanitized Admin Live Billing status JSON export.
  --operator-note <text>
                    Add a bounded operator note to the local evidence skeleton.

This helper never calls Stripe, creates Checkout Sessions, sends webhooks, deploys,
migrates, changes credits, issues refunds, mutates subscriptions, or touches
Cloudflare/D1/R2/Queues/GitHub/provider state.`);
  process.exit(0);
}

try {
  let adminStatus = null;
  if (options.adminStatusJson) {
    adminStatus = JSON.parse(fs.readFileSync(options.adminStatusJson, "utf8"));
  }
  const skeleton = createBillingCanaryEvidenceSkeleton({
    adminStatus,
    operatorFields: {
      notes: options.operatorNote || "",
    },
  });
  const output = options.format === "json"
    ? `${JSON.stringify(skeleton, null, 2)}\n`
    : renderBillingCanaryEvidenceMarkdown(skeleton);
  assertBillingEvidenceIsRedacted(output);
  if (options.output) {
    const relativePath = writeBillingCanaryEvidence(process.cwd(), options.output, output, {
      force: options.force,
    });
    console.log(`Wrote redacted billing canary evidence skeleton to ${relativePath}`);
  }
  if (!options.output) {
    process.stdout.write(output);
  }
} catch (error) {
  console.error(`billing:canary-evidence failed: ${error.message}`);
  process.exit(1);
}
