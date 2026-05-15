#!/usr/bin/env node

import {
  collectReadinessEvidence,
  renderReadinessEvidenceMarkdown,
  writeReadinessEvidenceMarkdown,
} from "./lib/readiness-evidence.mjs";

function parseArgs(argv) {
  const options = {
    markdown: false,
    runLocalChecks: false,
    includeLive: false,
    force: false,
    output: null,
    urls: {},
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--markdown" || arg === "--template") {
      options.markdown = true;
    } else if (arg === "--run-local-checks") {
      options.runLocalChecks = true;
    } else if (arg === "--include-live") {
      options.includeLive = true;
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--output") {
      index += 1;
      if (!argv[index]) throw new Error("--output requires a path.");
      options.output = argv[index];
    } else if (arg === "--static-url") {
      index += 1;
      if (!argv[index]) throw new Error("--static-url requires a URL.");
      options.urls.staticUrl = argv[index];
    } else if (arg === "--auth-worker-url") {
      index += 1;
      if (!argv[index]) throw new Error("--auth-worker-url requires a URL.");
      options.urls.authWorkerUrl = argv[index];
    } else if (arg === "--ai-worker-url") {
      index += 1;
      if (!argv[index]) throw new Error("--ai-worker-url requires a URL.");
      options.urls.aiWorkerUrl = argv[index];
    } else if (arg === "--contact-worker-url") {
      index += 1;
      if (!argv[index]) throw new Error("--contact-worker-url requires a URL.");
      options.urls.contactWorkerUrl = argv[index];
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
  console.error(`readiness:evidence failed: ${error.message}`);
  process.exit(1);
}

if (options.help) {
  console.log(`Usage: node scripts/collect-readiness-evidence.mjs [options]

Default behavior is local-only, redacted, and non-mutating.

Options:
  --markdown                    Print markdown evidence output. This is also the default.
  --template                    Alias for --markdown.
  --output <path>               Write markdown under docs/production-readiness/evidence/.
  --force                       Allow overwriting an existing --output file.
  --run-local-checks            Run a small deterministic local check subset.
  --include-live                Enable read-only GET checks for explicitly supplied URLs only.
  --static-url <url>            Static site URL for status/header evidence.
  --auth-worker-url <url>       Auth Worker base URL; checks GET /api/health.
  --ai-worker-url <url>         AI Worker base URL; checks GET /health.
  --contact-worker-url <url>    Contact Worker base URL; checks GET /health.

The helper never deploys, migrates, writes to Cloudflare/D1/R2/Queues/Stripe/GitHub, or prints secret values.
Live/staging checks remain skipped unless --include-live is passed with explicit URLs.`);
  process.exit(0);
}

try {
  const evidence = await collectReadinessEvidence({
    repoRoot: process.cwd(),
    runLocalChecks: options.runLocalChecks,
    includeLive: options.includeLive,
    urls: options.urls,
  });
  const markdown = renderReadinessEvidenceMarkdown(evidence);
  if (options.output) {
    const relativePath = writeReadinessEvidenceMarkdown(process.cwd(), options.output, markdown, {
      force: options.force,
    });
    console.log(`Wrote redacted readiness evidence to ${relativePath}`);
  }
  if (!options.output || options.markdown) {
    console.log(markdown);
  }
} catch (error) {
  console.error(`readiness:evidence failed: ${error.message}`);
  process.exit(1);
}
