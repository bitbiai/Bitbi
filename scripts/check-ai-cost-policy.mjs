#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AI_COST_BUDGET_SCOPES,
  AI_COST_LIVE_BUDGET_CAP_STATUSES,
  AI_COST_OPERATION_REGISTRY,
  getAiCostProviderCallSourceFiles,
  getAiCostRoutePolicyBaselines,
  summarizeAiCostOperationRegistry,
  validateAiCostOperationRegistry,
} from "../workers/auth/src/lib/ai-cost-operations.js";

export const AI_COST_INVENTORY_DOC = "docs/ai-cost-gateway/AI_COST_ROUTE_INVENTORY.md";
export const ROUTE_POLICY_PATH = "workers/auth/src/app/route-policy.js";
export const AI_COST_POLICY_BASELINE_PATH = "config/ai-cost-policy-baseline.json";

export const COST_POLICY_ROUTES = Object.freeze(getAiCostRoutePolicyBaselines());
export const PROVIDER_CALL_SOURCE_FILES = Object.freeze(getAiCostProviderCallSourceFiles());

const KNOWN_GAP_CATEGORIES = new Set(["admin", "platform", "internal", "background"]);
const KNOWN_GAP_SEVERITIES = new Set(["P0", "P1", "P2", "P3"]);
const KNOWN_BUDGET_SCOPES = new Set(Object.values(AI_COST_BUDGET_SCOPES));
const LIVE_BUDGET_CAP_STATUSES = new Set(AI_COST_LIVE_BUDGET_CAP_STATUSES);
const MIGRATED_MEMBER_OPERATION_IDS = Object.freeze([
  "member.image.generate",
  "member.music.generate",
  "member.video.generate",
]);
const RUNTIME_BUDGET_SWITCH_OPERATION_IDS = Object.freeze([
  "admin.image.test.charged",
  "admin.image.test.unmetered",
  "admin.video.job.create",
  "platform.news_pulse.visual.ingest",
  "platform.news_pulse.visual.scheduled",
  "admin.text.test",
  "admin.embeddings.test",
  "admin.music.test",
  "admin.compare",
  "admin.live_agent",
]);
const PHASE_4_17_PLATFORM_ADMIN_LAB_CAP_OPERATION_IDS = new Set([
  "admin.video.job.create",
  "admin.text.test",
  "admin.embeddings.test",
  "admin.music.test",
  "admin.compare",
  "admin.live_agent",
]);

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

function readJsonFile(repoRoot, relativePath) {
  return JSON.parse(readFile(repoRoot, relativePath));
}

function normalizePathname(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\.?\//, "");
}

function asList(value) {
  if (Array.isArray(value)) return value.map((entry) => String(entry || "").trim()).filter(Boolean);
  const normalized = String(value || "").trim();
  return normalized ? [normalized] : [];
}

function sortedUnique(values) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))].sort();
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
  const policyObjectStart = routePolicyText.lastIndexOf("policy({", index);
  const policyObjectClosedBefore = routePolicyText.lastIndexOf("\n  }),", index);
  const start = policyObjectStart !== -1 && policyObjectStart > policyObjectClosedBefore
    ? routePolicyText.lastIndexOf("\n", policyObjectStart)
    : routePolicyText.lastIndexOf("\n  ", index);
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
  if (
    lower.includes("retired_debug_path")
    || lower.includes('debuggate: "disabled-by-default')
    || lower.includes("debuggate: 'disabled-by-default")
    || lower.includes('expectedidempotency: "disabled-by-default')
    || lower.includes("expectedidempotency: 'disabled-by-default")
  ) {
    return "disabled-by-default";
  }
  if (lower.includes("required when")) return "partial";
  if (lower.includes("idempotency-key") && lower.includes("required")) return "required";
  if (lower.includes("idempotency") && lower.includes("required")) return "required";
  if (lower.includes("idempotency") && lower.includes("deterministic")) return "deterministic-key";
  if (lower.includes("deterministic") && lower.includes("provider call")) return "deterministic-key";
  if (lower.includes("idempotency") && lower.includes("recommended")) return "recommended";
  if (lower.includes("idempotency") && lower.includes("optional")) return "optional";
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
  if (route.expected === "disabled-by-default") {
    return actual !== "disabled-by-default";
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

export function loadAiCostPolicyBaseline(repoRoot, baselinePath = AI_COST_POLICY_BASELINE_PATH) {
  return readJsonFile(repoRoot, baselinePath);
}

function getBaselineFiles(item) {
  return sortedUnique([...asList(item.file), ...asList(item.files)]);
}

function getBaselineRoutes(item) {
  return sortedUnique([...asList(item.route), ...asList(item.routes)]);
}

function getBaselineRoutePolicyIds(item) {
  return sortedUnique(asList(item.routePolicyIds));
}

function getBaselineOperationIds(item) {
  return sortedUnique(asList(item.registryOperationIds));
}

function isExternalOnlyBaselineItem(item) {
  return item?.external_or_internal_only === true || item?.externalOrInternalOnly === true;
}

function createKnownGapBaselineIndex(baseline) {
  const byId = new Map();
  const byFile = new Map();
  const byRoute = new Map();
  const byRoutePolicyId = new Map();
  const byOperationId = new Map();
  for (const item of baseline?.knownGaps || []) {
    if (!item?.id) continue;
    byId.set(item.id, item);
    for (const file of getBaselineFiles(item)) byFile.set(file, item);
    for (const route of getBaselineRoutes(item)) byRoute.set(route, item);
    for (const routePolicyId of getBaselineRoutePolicyIds(item)) byRoutePolicyId.set(routePolicyId, item);
    for (const operationId of getBaselineOperationIds(item)) byOperationId.set(operationId, item);
  }
  return Object.freeze({
    byId,
    byFile,
    byRoute,
    byRoutePolicyId,
    byOperationId,
  });
}

function routeReferenceExists(route, { routePolicyText, inventoryText, registryEntries }) {
  if (!route || route.includes("*")) return true;
  if (routePolicyText.includes(route) || inventoryText.includes(route)) return true;
  return registryEntries.some((entry) => entry.operationConfig?.routePath === route);
}

export function validateAiCostPolicyBaseline(repoRoot, {
  baseline,
  routePolicyText = "",
  inventoryText = "",
  registryEntries = AI_COST_OPERATION_REGISTRY,
} = {}) {
  const issues = [];
  const knownGaps = baseline?.knownGaps;
  const operationIds = new Set(registryEntries.map((entry) => entry.operationConfig?.operationId).filter(Boolean));
  const seenIds = new Set();

  if (!baseline || typeof baseline !== "object") {
    return ["AI cost policy baseline must be a JSON object."];
  }
  if (!baseline.version || typeof baseline.version !== "string") {
    issues.push("AI cost policy baseline is missing version.");
  }
  if (!Array.isArray(knownGaps)) {
    issues.push("AI cost policy baseline knownGaps must be an array.");
    return issues;
  }

  for (const item of knownGaps) {
    if (!item || typeof item !== "object") {
      issues.push("AI cost policy baseline item must be an object.");
      continue;
    }
    const id = String(item.id || "").trim();
    if (!id) {
      issues.push("AI cost policy baseline item is missing id.");
    } else if (seenIds.has(id)) {
      issues.push(`Duplicate AI cost policy baseline id "${id}".`);
    } else {
      seenIds.add(id);
    }

    if (!KNOWN_GAP_CATEGORIES.has(item.category)) {
      issues.push(`${id || "unknown"}: invalid baseline category "${item.category}".`);
    }
    if (!KNOWN_GAP_SEVERITIES.has(item.severity)) {
      issues.push(`${id || "unknown"}: invalid baseline severity "${item.severity}".`);
    }
    if (!item.reason || typeof item.reason !== "string") {
      issues.push(`${id || "unknown"}: missing baseline reason.`);
    }
    if (!item.temporaryAllowanceReason || typeof item.temporaryAllowanceReason !== "string") {
      issues.push(`${id || "unknown"}: missing temporaryAllowanceReason.`);
    }
    if (!KNOWN_BUDGET_SCOPES.has(item.targetBudgetScope)) {
      issues.push(`${id || "unknown"}: invalid targetBudgetScope "${item.targetBudgetScope}".`);
    }
    if (!item.targetFuturePhase || typeof item.targetFuturePhase !== "string") {
      issues.push(`${id || "unknown"}: missing targetFuturePhase.`);
    }
    if (!item.ownerDomain || typeof item.ownerDomain !== "string") {
      issues.push(`${id || "unknown"}: missing ownerDomain.`);
    }
    if (!item.killSwitchTarget && !item.killSwitchExemptionReason) {
      issues.push(`${id || "unknown"}: missing killSwitchTarget or killSwitchExemptionReason.`);
    }
    if (item.killSwitchTarget && typeof item.killSwitchTarget !== "string") {
      issues.push(`${id || "unknown"}: killSwitchTarget must be a string.`);
    }
    if (!item.futureEnforcementPath || typeof item.futureEnforcementPath !== "string") {
      issues.push(`${id || "unknown"}: missing futureEnforcementPath.`);
    }
    if (typeof item.providerCostBearing !== "boolean") {
      issues.push(`${id || "unknown"}: providerCostBearing must be boolean.`);
    }
    if (typeof item.coveredByRegistryMetadata !== "boolean") {
      issues.push(`${id || "unknown"}: coveredByRegistryMetadata must be boolean.`);
    }
    if (typeof item.allowedUnmigratedForNow !== "boolean") {
      issues.push(`${id || "unknown"}: allowedUnmigratedForNow must be boolean.`);
    }
    if (item.category === "member") {
      issues.push(`${id || "unknown"}: member provider-cost routes must not be accepted as known gaps.`);
    }

    const files = getBaselineFiles(item);
    const routes = getBaselineRoutes(item);
    const functions = sortedUnique(asList(item.functions));
    const routePolicyIds = getBaselineRoutePolicyIds(item);
    const itemOperationIds = getBaselineOperationIds(item);
    if (files.length === 0 && routes.length === 0 && functions.length === 0 && routePolicyIds.length === 0) {
      issues.push(`${id || "unknown"}: baseline item must reference at least one route, file, function, or route policy id.`);
    }
    if (item.providerCostBearing && item.coveredByRegistryMetadata !== true) {
      issues.push(`${id || "unknown"}: provider-cost baseline gaps must be covered by registry metadata.`);
    }
    if (item.coveredByRegistryMetadata && itemOperationIds.length === 0) {
      issues.push(`${id || "unknown"}: coveredByRegistryMetadata=true requires registryOperationIds.`);
    }
    for (const operationId of itemOperationIds) {
      if (MIGRATED_MEMBER_OPERATION_IDS.includes(operationId)) {
        issues.push(`${id || "unknown"}: migrated member operation "${operationId}" must not be baselined as a gap.`);
      }
      if (!operationIds.has(operationId)) {
        issues.push(`${id || "unknown"}: registryOperationId "${operationId}" does not exist.`);
      }
    }

    if (!isExternalOnlyBaselineItem(item)) {
      for (const file of files) {
        if (!fs.existsSync(path.join(repoRoot, file))) {
          issues.push(`${id || "unknown"}: referenced file does not exist: ${file}`);
        }
      }
      for (const route of routes) {
        if (!routeReferenceExists(route, { routePolicyText, inventoryText, registryEntries })) {
          issues.push(`${id || "unknown"}: referenced route is not present in route policy, inventory, or registry: ${route}`);
        }
      }
    }
  }

  return issues;
}

function findKnownGapForPolicyGap(baselineIndex, gap) {
  return baselineIndex.byRoutePolicyId.get(gap.route)
    || baselineIndex.byRoute.get(gap.path)
    || baselineIndex.byOperationId.get(gap.operationId)
    || null;
}

function findKnownGapForProviderSource(baselineIndex, finding) {
  return baselineIndex.byFile.get(finding.file) || null;
}

function validateMigratedMemberGatewayCoverage({ routePolicyText, registryEntries, routes }) {
  const issues = [];
  for (const operationId of MIGRATED_MEMBER_OPERATION_IDS) {
    const entry = registryEntries.find((candidate) => candidate.operationConfig?.operationId === operationId);
    if (!entry) {
      issues.push(`Migrated member gateway operation is missing from registry: ${operationId}.`);
      continue;
    }
    if (entry.currentStatus !== "implemented") {
      issues.push(`${operationId}: currentStatus must remain implemented.`);
    }
    for (const field of ["idempotency", "reservation", "replay", "creditCheck", "providerSuppression"]) {
      if (entry.currentEnforcement?.[field] !== "implemented") {
        issues.push(`${operationId}: currentEnforcement.${field} must remain implemented.`);
      }
    }
    const routePolicyId = entry.routePolicy?.id;
    if (!routePolicyId) {
      issues.push(`${operationId}: migrated member operation must include routePolicy metadata.`);
      continue;
    }
    const routeRecord = routes.find((route) => route.id === routePolicyId);
    const snippet = findPolicySnippet(routePolicyText, routePolicyId);
    const actualIdempotency = routeRecord?.actualIdempotency || classifyIdempotency(snippet);
    if (actualIdempotency !== "required") {
      issues.push(`${operationId}: route policy ${routePolicyId} must require idempotency.`);
    }
  }
  return issues;
}

function validateRuntimeBudgetSwitchCoverage(registryEntries) {
  const issues = [];
  const entriesById = new Map(registryEntries.map((entry) => [
    entry.operationConfig?.operationId,
    entry,
  ]));
  for (const operationId of RUNTIME_BUDGET_SWITCH_OPERATION_IDS) {
    const entry = entriesById.get(operationId);
    if (!entry) {
      issues.push(`${operationId}: missing runtime budget switch registry entry.`);
      continue;
    }
    const killSwitch = entry.budgetPolicy?.killSwitchTarget || entry.budgetPolicy?.targetEnforcement?.killSwitch;
    if (!killSwitch || typeof killSwitch !== "string" || killSwitch.includes("metadata target")) {
      issues.push(`${operationId}: runtime budget switch coverage requires a concrete runtime killSwitchTarget.`);
    }
    const runtimeSwitch = entry.budgetPolicy?.targetEnforcement?.runtimeKillSwitch;
    if (runtimeSwitch !== "implemented" && !String(killSwitch || "").includes("runtime_enforced")) {
      issues.push(`${operationId}: budgetPolicy must mark runtime kill-switch enforcement as implemented.`);
    }
  }
  return issues;
}

function validateLiveBudgetCapMetadata(registryEntries) {
  const issues = [];
  const capRequiredScopes = new Set([
    AI_COST_BUDGET_SCOPES.ADMIN_ORG_CREDIT_ACCOUNT,
    AI_COST_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET,
    AI_COST_BUDGET_SCOPES.PLATFORM_BACKGROUND_BUDGET,
    AI_COST_BUDGET_SCOPES.OPENCLAW_NEWS_PULSE_BUDGET,
    AI_COST_BUDGET_SCOPES.INTERNAL_AI_WORKER_CALLER_ENFORCED,
    AI_COST_BUDGET_SCOPES.EXPLICIT_UNMETERED_ADMIN,
  ]);
  for (const entry of registryEntries) {
    const operationId = entry.operationConfig?.operationId || "unknown";
    const providerCost = entry.operationConfig?.providerCost !== false;
    const policy = entry.budgetPolicy || null;
    if (!providerCost || !policy || !capRequiredScopes.has(policy.targetBudgetScope)) continue;
    if (!LIVE_BUDGET_CAP_STATUSES.has(policy.liveBudgetCapStatus)) {
      issues.push(`${operationId}: missing or invalid live budget cap status metadata.`);
    }
    if (!LIVE_BUDGET_CAP_STATUSES.has(policy.liveBudgetCapReadiness)) {
      issues.push(`${operationId}: missing or invalid live budget cap readiness metadata.`);
    }
    if (!policy.liveBudgetCapFuturePhase || typeof policy.liveBudgetCapFuturePhase !== "string") {
      issues.push(`${operationId}: missing live budget cap future phase.`);
    }
    if (!policy.liveBudgetCapScope || !KNOWN_BUDGET_SCOPES.has(policy.liveBudgetCapScope)) {
      issues.push(`${operationId}: invalid live budget cap scope.`);
    }
    if (policy.liveBudgetCapStatus === "cap_enforced" || policy.targetEnforcement?.liveBudgetCap === "implemented") {
      if (
        !PHASE_4_17_PLATFORM_ADMIN_LAB_CAP_OPERATION_IDS.has(operationId)
        || policy.targetBudgetScope !== AI_COST_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET
        || policy.liveBudgetCapStatus !== "cap_enforced"
        || policy.targetEnforcement?.liveBudgetCap !== "implemented"
      ) {
        issues.push(`${operationId}: live budget cap enforcement is only allowed for Phase 4.17 platform_admin_lab_budget operations.`);
      }
    }
    if (
      policy.targetEnforcement?.runtimeKillSwitch === "implemented"
      && policy.liveBudgetCapStatus !== "not_implemented"
      && policy.liveBudgetCapStatus !== "cap_enforced"
    ) {
      issues.push(`${operationId}: runtime kill-switch enforcement must remain distinct from non-enforced live budget cap metadata.`);
    }
  }
  return issues;
}

export function analyzeAiCostPolicy(repoRoot, options = {}) {
  const strict = options.strict === true;
  const fatalIssues = [];
  const policyGaps = [];
  const knownPolicyGaps = [];
  const unknownPolicyGaps = [];
  const inventoryIssues = [];
  const unknownProviderSources = [];
  const registryEntries = options.registryEntries || AI_COST_OPERATION_REGISTRY;
  const registryIssues = validateAiCostOperationRegistry(registryEntries);
  const registrySummary = summarizeAiCostOperationRegistry(registryEntries);
  const routePolicyPath = options.routePolicyPath || ROUTE_POLICY_PATH;
  const inventoryPath = options.inventoryPath || AI_COST_INVENTORY_DOC;
  const baselinePath = options.baselinePath || AI_COST_POLICY_BASELINE_PATH;
  const routesToCheck = Object.freeze(getAiCostRoutePolicyBaselines(registryEntries));
  const providerCallSourceFiles = Object.freeze(getAiCostProviderCallSourceFiles(registryEntries));

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

  let baseline = null;
  let baselineIndex = createKnownGapBaselineIndex({ knownGaps: [] });
  let baselineIssues = [];
  try {
    baseline = options.baseline || loadAiCostPolicyBaseline(repoRoot, baselinePath);
    baselineIndex = createKnownGapBaselineIndex(baseline);
    baselineIssues = validateAiCostPolicyBaseline(repoRoot, {
      baseline,
      routePolicyText,
      inventoryText,
      registryEntries,
    });
    for (const issue of baselineIssues) {
      fatalIssues.push(`AI cost policy baseline issue: ${issue}`);
    }
  } catch (error) {
    fatalIssues.push(`Missing or unreadable AI cost policy baseline: ${baselinePath} (${error.message})`);
  }

  const routes = [];
  if (routePolicyText) {
    for (const route of routesToCheck) {
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
        const gap = {
          route: route.id,
          path: route.path,
          operationId: route.operationId,
          expected: route.expected,
          actual: actualIdempotency,
          classification: route.classification,
          notes: route.notes || null,
        };
        policyGaps.push(gap);
        const knownGap = findKnownGapForPolicyGap(baselineIndex, gap);
        if (knownGap?.allowedUnmigratedForNow) {
          knownPolicyGaps.push({
            ...gap,
            baselineId: knownGap.id,
          });
        } else {
          unknownPolicyGaps.push(gap);
        }
      }
    }
  }

  const providerSourceFindings = scanProviderCallSources(repoRoot);
  for (const finding of providerSourceFindings) {
    const inventoried = providerCallSourceFiles.includes(finding.file);
    const knownGap = findKnownGapForProviderSource(baselineIndex, finding);
    finding.inventoried = inventoried;
    finding.baselineId = knownGap?.id || null;
    if (inventoried || knownGap?.allowedUnmigratedForNow) continue;
    const issue = `Provider-call source file is not represented in the operation registry or known-gap baseline: ${finding.file}`;
    inventoryIssues.push(issue);
    unknownProviderSources.push(finding);
    fatalIssues.push(issue);
  }

  const memberGatewayIssues = routePolicyText
    ? validateMigratedMemberGatewayCoverage({ routePolicyText, registryEntries, routes })
    : [];
  for (const issue of memberGatewayIssues) {
    fatalIssues.push(`Member gateway enforcement issue: ${issue}`);
  }
  for (const issue of validateRuntimeBudgetSwitchCoverage(registryEntries)) {
    fatalIssues.push(`Runtime budget switch coverage issue: ${issue}`);
  }
  for (const issue of validateLiveBudgetCapMetadata(registryEntries)) {
    fatalIssues.push(`Live budget cap metadata issue: ${issue}`);
  }
  for (const gap of unknownPolicyGaps) {
    fatalIssues.push(`Unbaselined AI cost policy gap: ${gap.route} (${gap.path}).`);
  }

  const strictIssues = strict
    ? [
      ...knownPolicyGaps.map((gap) => `Strict mode rejects known baseline policy gap ${gap.baselineId}: ${gap.route}.`),
      ...(baseline?.knownGaps || [])
        .filter((item) => item?.allowedUnmigratedForNow)
        .map((item) => `Strict mode rejects allowed baseline gap ${item.id}.`),
    ]
    : [];

  const ok = fatalIssues.length === 0 && strictIssues.length === 0;
  return {
    ok,
    strict,
    fatalIssues,
    strictIssues,
    policyGaps,
    knownPolicyGaps,
    unknownPolicyGaps,
    inventoryIssues,
    unknownProviderSources,
    baseline,
    baselineIssues,
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

function formatIdList(ids) {
  return ids.length ? ids.map((id) => `\`${id}\``).join(", ") : "None";
}

export function summarizeMemberMusicGatewayPrep(entries = AI_COST_OPERATION_REGISTRY) {
  const musicEntries = entries
    .filter((entry) => String(entry.operationConfig?.operationId || "").startsWith("member.music."))
    .sort((left, right) => left.operationConfig.operationId.localeCompare(right.operationConfig.operationId));
  const operationIds = musicEntries.map((entry) => entry.operationConfig.operationId);
  const missingMandatoryIdempotency = musicEntries
    .filter((entry) =>
      entry.operationConfig.idempotencyPolicy === "required"
      && entry.currentEnforcement?.idempotency !== "implemented"
    )
    .map((entry) => entry.operationConfig.operationId);
  const missingPreProviderReservation = musicEntries
    .filter((entry) =>
      entry.operationConfig.reservationPolicy === "required"
      && entry.currentEnforcement?.reservation !== "implemented"
    )
    .map((entry) => entry.operationConfig.operationId);
  const missingProviderSuppression = musicEntries
    .filter((entry) => !["implemented", "partial"].includes(entry.currentEnforcement?.providerSuppression))
    .map((entry) => entry.operationConfig.operationId);
  const missingReplay = musicEntries
    .filter((entry) =>
      entry.operationConfig.replayPolicy !== "disabled"
      && !["implemented", "partial"].includes(entry.currentEnforcement?.replay)
    )
    .map((entry) => entry.operationConfig.operationId);
  const cover = musicEntries.find((entry) => entry.operationConfig.operationId === "member.music.cover.generate");
  return Object.freeze({
    operationIds,
    unmigrated: musicEntries.some((entry) => entry.currentStatus === "missing"),
    missingMandatoryIdempotency,
    missingPreProviderReservation,
    missingProviderSuppression,
    missingReplay,
    partialSuccessRisks: Object.freeze([
      "audio success followed by storage failure remains no-charge but can waste provider spend",
      "billing finalization failure is terminal and still requires operator/customer support handling",
      "generated lyrics are not replayed raw from attempt metadata",
      "completed replay-unavailable attempts require a new idempotency key rather than automatic provider re-execution",
    ]),
    coverBudgetAmbiguity: cover
      ? "generated music cover/background cover is included in the parent bundled music reservation with no separate user-visible charge; Phase 3.7 records pending/succeeded/failed/skipped cover status on the parent attempt"
      : "generated music cover/background cover operation is missing from the registry",
  });
}

function renderMemberMusicGatewayPrep(summary) {
  return [
    `- Status: ${summary.unmigrated ? "member music is still partially unmigrated" : "member music parent gateway migration is represented in the registry; member image, music, and video are the migrated member AI Cost Gateway routes."}`,
    `- Sub-operations tracked: ${formatIdList(summary.operationIds)}`,
    `- Missing mandatory idempotency: ${formatIdList(summary.missingMandatoryIdempotency)}`,
    `- Missing pre-provider reservation: ${formatIdList(summary.missingPreProviderReservation)}`,
    `- Missing duplicate provider-call suppression: ${formatIdList(summary.missingProviderSuppression)}`,
    `- Missing replay/cache: ${formatIdList(summary.missingReplay)}`,
    `- Partial-success risks: ${summary.partialSuccessRisks.join("; ")}`,
    `- Cover/background provider-cost policy: ${summary.coverBudgetAmbiguity}`,
  ].join("\n");
}

function renderBudgetScopeGroup(title, gaps, scopes) {
  const scopeSet = new Set(scopes);
  const scoped = gaps.filter((gap) => scopeSet.has(gap.targetBudgetScope));
  const lines = [title];
  if (scoped.length === 0) {
    lines.push("- None");
    return lines.join("\n");
  }
  const grouped = new Map();
  for (const gap of scoped) {
    const scope = gap.targetBudgetScope || "unknown";
    const entries = grouped.get(scope) || [];
    entries.push(gap);
    grouped.set(scope, entries);
  }
  for (const [scope, entries] of [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`- ${scope}: ${entries.map((entry) => entry.id).sort().join(", ")}`);
  }
  return lines.join("\n");
}

function renderHardenedAdminBudgetOperations(entries = AI_COST_OPERATION_REGISTRY) {
  const hardened = entries
    .filter((entry) =>
      ["implemented", "partial"].includes(entry.budgetPolicy?.targetEnforcementStatus)
      && ["admin", "platform"].includes(entry.operationConfig?.actorType)
      && entry.budgetPolicy?.targetBudgetScope !== AI_COST_BUDGET_SCOPES.EXPLICIT_UNMETERED_ADMIN
      && entry.routePolicy?.expectedIdempotency !== "disabled-by-default"
    )
    .map((entry) => ({
      operationId: entry.operationConfig.operationId,
      scope: entry.budgetPolicy.targetBudgetScope,
      status: entry.currentStatus,
      route: entry.operationConfig.routePath,
    }))
    .sort((left, right) => left.operationId.localeCompare(right.operationId));
  if (!hardened.length) return "- None";
  return hardened
    .map((entry) => {
      const registryEntry = entries.find((candidate) => candidate.operationConfig?.operationId === entry.operationId);
      const label = entry.status === "implemented"
        ? "hardened"
        : registryEntry?.currentEnforcement?.providerSuppression === "implemented"
          && registryEntry?.currentEnforcement?.replay === "partial"
          ? "budget-metadata+durable-idempotency"
          : "budget-metadata";
      return `- ${entry.operationId}: ${entry.status}/${label}; scope=${entry.scope}; route=${entry.route}`;
    })
    .join("\n");
}

function renderExplicitUnmeteredAdminOperations(entries = AI_COST_OPERATION_REGISTRY) {
  const explicit = entries
    .filter((entry) =>
      entry.budgetPolicy?.currentBudgetScope === AI_COST_BUDGET_SCOPES.EXPLICIT_UNMETERED_ADMIN
      || entry.budgetPolicy?.targetBudgetScope === AI_COST_BUDGET_SCOPES.EXPLICIT_UNMETERED_ADMIN
    )
    .filter((entry) => entry.routePolicy?.expectedIdempotency !== "disabled-by-default")
    .map((entry) => ({
      operationId: entry.operationConfig.operationId,
      scope: entry.budgetPolicy.targetBudgetScope,
      status: entry.currentStatus,
      route: entry.operationConfig.routePath,
      killSwitch: entry.budgetPolicy.killSwitchTarget || entry.budgetPolicy.targetEnforcement?.killSwitch || "missing",
      notes: entry.budgetPolicy.notes || entry.operationConfig.notes || "",
    }))
    .sort((left, right) => left.operationId.localeCompare(right.operationId));
  if (!explicit.length) return "- None";
  return explicit
    .map((entry) =>
      `- ${entry.operationId}: ${entry.status}/explicit-unmetered; scope=${entry.scope}; route=${entry.route}; killSwitch=${entry.killSwitch}`
    )
    .join("\n");
}

function renderLiveBudgetCapStatus(entries = AI_COST_OPERATION_REGISTRY) {
  const budgeted = entries
    .filter((entry) =>
      entry.operationConfig?.providerCost !== false &&
      entry.budgetPolicy &&
      !String(entry.operationConfig?.operationId || "").startsWith("member.")
    )
    .map((entry) => ({
      operationId: entry.operationConfig.operationId,
      scope: entry.budgetPolicy.targetBudgetScope,
      status: entry.budgetPolicy.liveBudgetCapStatus || "not_implemented",
      readiness: entry.budgetPolicy.liveBudgetCapReadiness || "requires_schema",
      future: entry.budgetPolicy.liveBudgetCapFuturePhase || "missing",
    }))
    .sort((left, right) => left.operationId.localeCompare(right.operationId));
  if (!budgeted.length) return "- None";
  return budgeted
    .map((entry) =>
      `- ${entry.operationId}: cap=${entry.status}; readiness=${entry.readiness}; scope=${entry.scope}; future=${entry.future}`
    )
    .join("\n");
}

export function renderAiCostPolicyReport(result) {
  const highRisk = result.registrySummary.highRiskOperations.length
    ? result.registrySummary.highRiskOperations.join(", ")
    : "None";
  const providerSummary = result.providerSourceFindings
    .map((finding) => {
      const status = finding.inventoried
        ? "inventoried"
        : finding.baselineId
          ? `known-baseline-gap:${finding.baselineId}`
          : "unknown";
      return `- ${finding.file}: ${status} (${finding.patterns.join(", ")})`;
    })
    .join("\n") || "- None";
  const knownBaselineGaps = result.baseline?.knownGaps || [];
  const retiredDebugRoutes = (result.routes || []).filter((route) => route.expected === "disabled-by-default");

  return [
    "AI cost policy check",
    `Mode: ${result.strict ? "strict" : "baseline-enforced"}`,
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
    "Migrated member gateway routes:",
    "- POST /api/ai/generate-image member personal path: gateway-migrated",
    "- POST /api/ai/generate-music: gateway-migrated",
    "- POST /api/ai/generate-video: gateway-migrated",
    "",
    "Hardened admin/platform budget operations:",
    renderHardenedAdminBudgetOperations(),
    "",
    "Explicit unmetered admin operations:",
    renderExplicitUnmeteredAdminOperations(),
    "",
    "Live platform budget cap status:",
    "- Phase 4.17 implements the first narrow daily/monthly cap foundation for platform_admin_lab_budget only.",
    "- Other platform/admin budget scopes remain future work and are not cap-enforced.",
    "- Runtime budget kill-switches are separate from live budget caps.",
    renderLiveBudgetCapStatus(),
    "",
    "Read-only admin/platform budget evidence:",
    "- Phase 4.4 evidence collector: `npm run report:ai-budget-evidence` and `GET /api/admin/ai/budget-evidence` expose sanitized local registry/baseline/route-policy coverage.",
    "- Phase 4.5 admin async video job budget metadata is represented in the registry; evidence reporting remains read-only and blocked/verdict-only.",
    "- Phase 4.6 OpenClaw/News Pulse visual budget controls are represented in the registry and evidence report with metadata-only kill-switch targets.",
    "- Phase 4.7 internal AI Worker caller-policy guard is represented for async video task create/poll, while broader internal routes remain explicit baseline gaps.",
    "- Phase 4.8.1 admin text/embeddings, Phase 4.9 admin music, Phase 4.10 admin compare, and Phase 4.12 admin live-agent use admin_ai_usage_attempts for durable metadata-only duplicate suppression and conflict detection; Phase 4.8.2 adds bounded non-destructive cleanup and admin-only sanitized inspection; full result replay remains future work.",
    "- Phase 4.12 implements Admin Live-Agent budget metadata, required idempotency, caller-policy propagation, and metadata-only stream-session finalization; Phase 4.17 adds the first platform_admin_lab_budget daily/monthly cap foundation for this route family, while explicit output-token/duration caps remain future work.",
    "- Phase 4.13 retires sync video debug as disabled-by-default/emergency-only; async admin video jobs remain the supported budgeted admin video path.",
    "- Phase 4.14 classifies Admin Image branches: charged priced models remain admin_org_credit_account-covered, FLUX.2 Dev is explicit_unmetered_admin with safe budget/caller-policy metadata, and unclassified Admin Image models are blocked before provider calls.",
    "- Phase 4.15 enforces runtime budget kill-switches for already budget-classified admin/platform provider-cost paths; missing or false switches block before provider, queue, credit, or durable-attempt work where applicable.",
    "- Phase 4.16 adds live platform budget cap design/evidence only; Phase 4.17 adds the first platform_admin_lab_budget cap foundation without changing member/org billing behavior.",
    "",
    "Known baseline gaps:",
    formatList(knownBaselineGaps, (gap) =>
      `- ${gap.id}: ${gap.category}; ${gap.severity}; scope=${gap.targetBudgetScope || "missing"}; killSwitch=${gap.killSwitchTarget || gap.killSwitchExemptionReason || "missing"}; target ${gap.targetFuturePhase}; registry=${gap.coveredByRegistryMetadata ? "covered" : "missing"}; allowed=${gap.allowedUnmigratedForNow ? "yes" : "no"}`
    ),
    "",
    "Retired/disabled debug paths:",
    formatList(retiredDebugRoutes, (route) =>
      `- ${route.route || route.id}: ${route.path}; status=${route.actualIdempotency}; ${route.notes || "disabled-by-default"}`
    ),
    "",
    renderBudgetScopeGroup("Admin gaps by budget scope:", knownBaselineGaps, [
      AI_COST_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET,
      AI_COST_BUDGET_SCOPES.ADMIN_ORG_CREDIT_ACCOUNT,
      AI_COST_BUDGET_SCOPES.EXPLICIT_UNMETERED_ADMIN,
    ]),
    "",
    renderBudgetScopeGroup("Platform/background gaps by budget scope:", knownBaselineGaps, [
      AI_COST_BUDGET_SCOPES.PLATFORM_BACKGROUND_BUDGET,
      AI_COST_BUDGET_SCOPES.OPENCLAW_NEWS_PULSE_BUDGET,
    ]),
    "",
    renderBudgetScopeGroup("Internal AI Worker caller-enforced gaps:", knownBaselineGaps, [
      AI_COST_BUDGET_SCOPES.INTERNAL_AI_WORKER_CALLER_ENFORCED,
    ]),
    "",
    "Registry issues:",
    formatList(result.registryIssues, (issue) => `- ${issue}`),
    "",
    "Baseline issues:",
    formatList(result.baselineIssues || [], (issue) => `- ${issue}`),
    "",
    "Member music gateway prep gaps:",
    renderMemberMusicGatewayPrep(summarizeMemberMusicGatewayPrep()),
    "",
    "Fatal issues:",
    formatList(result.fatalIssues, (issue) => `- ${issue}`),
    "",
    "Strict-mode issues:",
    formatList(result.strictIssues || [], (issue) => `- ${issue}`),
    "",
    "Current policy gaps:",
    formatList(result.policyGaps, (gap) =>
      `- ${gap.route} (${gap.path}): expected ${gap.expected}, route-policy currently ${gap.actual}; ${gap.classification}${gap.notes ? `; ${gap.notes}` : ""}`
    ),
    "",
    "Known baseline policy gaps:",
    formatList(result.knownPolicyGaps || [], (gap) =>
      `- ${gap.route} (${gap.path}): baseline ${gap.baselineId}; expected ${gap.expected}, actual ${gap.actual}`
    ),
    "",
    "Unknown policy gaps:",
    formatList(result.unknownPolicyGaps || [], (gap) =>
      `- ${gap.route} (${gap.path}): expected ${gap.expected}, actual ${gap.actual}`
    ),
    "",
    "Inventory issues:",
    formatList(result.inventoryIssues, (issue) => `- ${issue}`),
    "",
    "Unknown provider-call sources:",
    formatList(result.unknownProviderSources || [], (finding) =>
      `- ${finding.file}: ${finding.patterns.join(", ")}`
    ),
    "",
    "Provider-call source scan:",
    providerSummary,
    "",
    "Recommended next phase:",
    "- Later phases should extend caps only after separate scope-specific designs; do not treat admin_org_credit_account, explicit_unmetered_admin, openclaw_news_pulse_budget, or internal_ai_worker_caller_enforced as covered by Phase 4.17.",
    "- Strict mode intentionally remains failing while accepted baseline gaps remain.",
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
  --strict   Also fail on known baseline gaps; intended for future use once the baseline is empty.
  --help     Show this help.

Default mode enforces the known-gap baseline: unregistered provider-cost sources, member route regressions, duplicate registry/baseline ids, and unbaselined policy gaps fail. The command never calls AI providers, reads secret values, deploys, runs remote migrations, or mutates Cloudflare/Stripe/GitHub resources.`);
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
