#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getAiCostProviderCallSourceFiles,
  getAiCostRoutePolicyBaselines,
  summarizeAiCostOperationRegistry,
  validateAiCostOperationRegistry,
} from "../workers/auth/src/lib/ai-cost-operations.js";

export const AI_COST_INVENTORY_DOC = "docs/ai-cost-gateway/AI_COST_ROUTE_INVENTORY.md";
export const ROUTE_POLICY_PATH = "workers/auth/src/app/route-policy.js";

export const COST_POLICY_ROUTES = Object.freeze(getAiCostRoutePolicyBaselines());
export const PROVIDER_CALL_SOURCE_FILES = Object.freeze(getAiCostProviderCallSourceFiles());

const PROVIDER_CALL_PATTERNS = Object.freeze([
  "env.AI.run",
  "env?.AI.run",
  "AI_LAB.fetch",
  "proxyToAiLab(",
  "proxyLiveAgentToAiLab(",
  "createVideoProviderTask(",
  "pollVideoProviderTask(",
]);

function readFile(repoRoot, relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function normalizePathname(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\.?\//, "");
}

function walkFiles(root, relativeDir, output = []) {
  const absoluteDir = path.join(root, relativeDir);
  if (!fs.existsSync(absoluteDir)) return output;
  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    const relativePath = normalizePathname(path.join(relativeDir, entry.name));
    if (entry.isDirectory()) {
      walkFiles(root, relativePath, output);
    } else if (entry.isFile() && /\.(mjs|js)$/.test(entry.name)) {
      output.push(relativePath);
    }
  }
  return output;
}

function findPolicySnippet(routePolicyText, policyId) {
  const needle = `"${policyId}"`;
  const index = routePolicyText.indexOf(needle);
  if (index === -1) return null;
  const start = routePolicyText.lastIndexOf("\n  ", index);
  const snippetStart = start === -1 ? index : start + 1;
  const openParen = routePolicyText.indexOf("(", snippetStart);
  if (openParen === -1 || openParen > index) {
    const end = routePolicyText.indexOf("\n  ", index + needle.length);
    return routePolicyText.slice(snippetStart, end === -1 ? routePolicyText.length : end);
  }

  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let position = openParen; position < routePolicyText.length; position += 1) {
    const char = routePolicyText[position];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return routePolicyText.slice(snippetStart, position + 1);
      }
    }
  }
  return routePolicyText.slice(snippetStart, Math.min(routePolicyText.length, index + 1400));
}

function classifyIdempotency(snippet) {
  if (!snippet) return "missing";
  const lower = snippet.toLowerCase();
  if (lower.includes("required when")) return "partial";
  if (lower.includes("idempotency") && lower.includes("recommended")) return "recommended";
  if (lower.includes("idempotency") && lower.includes("optional")) return "optional";
  if (lower.includes("idempotency-key") && lower.includes("required")) return "required";
  if (lower.includes("idempotency") && lower.includes("required")) return "required";
  return "absent";
}

function isPolicyGap(route, actual) {
  if (route.expected === "required") {
    return actual !== "required";
  }
  if (route.expected === "explicit-admin-unmetered") {
    return actual === "absent" || actual === "missing";
  }
  if (route.expected === "platform-budget-or-deterministic-key") {
    return actual === "absent" || actual === "missing";
  }
  return false;
}

export function scanProviderCallSources(repoRoot) {
  const files = [
    ...walkFiles(repoRoot, "workers/auth/src"),
    ...walkFiles(repoRoot, "workers/ai/src"),
  ];
  const findings = [];
  for (const relativePath of files) {
    const text = readFile(repoRoot, relativePath);
    const matchedPatterns = PROVIDER_CALL_PATTERNS.filter((pattern) => text.includes(pattern));
    if (matchedPatterns.length === 0) continue;
    findings.push({
      file: relativePath,
      patterns: matchedPatterns,
      inventoried: PROVIDER_CALL_SOURCE_FILES.includes(relativePath),
    });
  }
  return findings;
}

export function analyzeAiCostPolicy(repoRoot, options = {}) {
  const strict = options.strict === true;
  const fatalIssues = [];
  const policyGaps = [];
  const inventoryIssues = [];
  const registryIssues = validateAiCostOperationRegistry();
  const registrySummary = summarizeAiCostOperationRegistry();
  const routePolicyPath = options.routePolicyPath || ROUTE_POLICY_PATH;
  const inventoryPath = options.inventoryPath || AI_COST_INVENTORY_DOC;

  for (const issue of registryIssues) {
    fatalIssues.push(`AI cost operation registry issue: ${issue}`);
  }

  let routePolicyText = "";
  try {
    routePolicyText = readFile(repoRoot, routePolicyPath);
  } catch (error) {
    fatalIssues.push(`Missing or unreadable route policy file: ${routePolicyPath}`);
  }

  let inventoryText = "";
  try {
    inventoryText = readFile(repoRoot, inventoryPath);
  } catch {
    fatalIssues.push(`Missing or unreadable AI cost inventory document: ${inventoryPath}`);
  }

  const routes = [];
  if (routePolicyText) {
    for (const route of COST_POLICY_ROUTES) {
      const snippet = findPolicySnippet(routePolicyText, route.id);
      const actualIdempotency = classifyIdempotency(snippet);
      const inInventory = inventoryText.includes(route.path)
        || inventoryText.includes(route.id)
        || inventoryText.includes(route.operationId);
      const record = {
        ...route,
        actualIdempotency,
        inInventory,
      };
      routes.push(record);
      if (!snippet) {
        fatalIssues.push(`Route policy entry not found for ${route.id} (${route.path}).`);
        continue;
      }
      if (!inInventory) {
        inventoryIssues.push(`Inventory is missing route ${route.id} (${route.path}).`);
      }
      if (isPolicyGap(route, actualIdempotency)) {
        policyGaps.push({
          route: route.id,
          path: route.path,
          expected: route.expected,
          actual: actualIdempotency,
          classification: route.classification,
          notes: route.notes || null,
        });
      }
    }
  }

  const providerSourceFindings = scanProviderCallSources(repoRoot);
  for (const finding of providerSourceFindings) {
    if (finding.inventoried) continue;
    inventoryIssues.push(
      `Provider-call source file is not represented in the baseline inventory: ${finding.file}`
    );
  }

  const ok = fatalIssues.length === 0 && (!strict || (policyGaps.length === 0 && inventoryIssues.length === 0));
  return {
    ok,
    strict,
    fatalIssues,
    policyGaps,
    inventoryIssues,
    registryIssues,
    registrySummary,
    routes,
    providerSourceFindings,
  };
}

function formatList(items, formatter) {
  if (!items.length) return "- None";
  return items.map(formatter).join("\n");
}

export function renderAiCostPolicyReport(result) {
  const highRisk = result.registrySummary.highRiskOperations.length
    ? result.registrySummary.highRiskOperations.join(", ")
    : "None";
  const providerSummary = result.providerSourceFindings
    .map((finding) => {
      const status = finding.inventoried ? "inventoried" : "not-in-inventory";
      return `- ${finding.file}: ${status} (${finding.patterns.join(", ")})`;
    })
    .join("\n") || "- None";

  return [
    "AI cost policy check",
    `Mode: ${result.strict ? "strict" : "report-only"}`,
    `Result: ${result.ok ? "PASS" : "FAIL"}`,
    "",
    "Registry summary:",
    `- Version: ${result.registrySummary.version}`,
    `- Total operations: ${result.registrySummary.totalOperations}`,
    `- Provider-cost operations: ${result.registrySummary.providerCostOperations}`,
    `- Member operations: ${result.registrySummary.memberOperations}`,
    `- Organization operations: ${result.registrySummary.organizationOperations}`,
    `- Admin/platform operations: ${result.registrySummary.adminPlatformOperations}`,
    `- Current missing mandatory idempotency: ${result.registrySummary.currentMissingMandatoryIdempotency}`,
    `- Current missing reservation: ${result.registrySummary.currentMissingReservation}`,
    `- Current no replay: ${result.registrySummary.currentNoReplay}`,
    `- Platform budget review operations: ${result.registrySummary.platformBudgetReviewOperations}`,
    `- Highest-risk operations: ${highRisk}`,
    "",
    "Registry issues:",
    formatList(result.registryIssues, (issue) => `- ${issue}`),
    "",
    "Fatal issues:",
    formatList(result.fatalIssues, (issue) => `- ${issue}`),
    "",
    "Current policy gaps:",
    formatList(result.policyGaps, (gap) =>
      `- ${gap.route} (${gap.path}): expected ${gap.expected}, route-policy currently ${gap.actual}; ${gap.classification}${gap.notes ? `; ${gap.notes}` : ""}`
    ),
    "",
    "Inventory issues:",
    formatList(result.inventoryIssues, (issue) => `- ${issue}`),
    "",
    "Provider-call source scan:",
    providerSummary,
    "",
    "Recommended next phase:",
    "- Phase 3.4 should migrate exactly one low-risk route, preferably member personal image generation, unless evidence shows another route is safer.",
    "",
    "Safety: this check is local-only. It does not read secret values, call AI providers, deploy, run migrations, or mutate Cloudflare/Stripe/GitHub resources.",
  ].join("\n");
}

export function parseAiCostPolicyArgs(argv) {
  const options = {
    strict: false,
    help: false,
  };
  for (const arg of argv) {
    if (arg === "--strict") options.strict = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function printUsage() {
  console.log(`Usage: node scripts/check-ai-cost-policy.mjs [options]

Options:
  --strict   Fail on current policy gaps and inventory issues.
  --help     Show this help.

Default mode is report-only. The command never calls AI providers, reads secret values, deploys, runs remote migrations, or mutates Cloudflare/Stripe/GitHub resources.`);
}

async function main() {
  let options;
  try {
    options = parseAiCostPolicyArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`check:ai-cost-policy failed: ${error.message}`);
    process.exit(1);
  }

  if (options.help) {
    printUsage();
    return;
  }

  const result = analyzeAiCostPolicy(process.cwd(), { strict: options.strict });
  console.log(renderAiCostPolicyReport(result));
  if (!result.ok) process.exit(1);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  await main();
}
