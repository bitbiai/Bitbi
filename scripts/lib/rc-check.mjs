import { spawnSync } from "node:child_process";

export const RC_CHECK_VERSION = "omega-p1-wave10-rc-check-v1";

export const FINAL_RC_COMMANDS = Object.freeze([
  { category: "repository", command: "git status --short" },
  { category: "audit", command: "npm audit --audit-level=low" },
  { category: "audit", command: "npm --prefix workers/auth audit --audit-level=low" },
  { category: "audit", command: "npm --prefix workers/contact audit --audit-level=low" },
  { category: "audit", command: "npm --prefix workers/ai audit --audit-level=low" },
  { category: "static-analysis", command: "npm run check:js" },
  { category: "static-analysis", command: "npm run check:secrets" },
  { category: "static-analysis", command: "npm run check:route-policies" },
  { category: "static-analysis", command: "npm run check:dom-sinks" },
  { category: "static-analysis", command: "npm run check:data-lifecycle" },
  { category: "static-analysis", command: "npm run check:admin-activity-query-shape" },
  { category: "tests", command: "npm run test:workers" },
  { category: "tests", command: "npm run test:static" },
  { category: "tests", command: "npm run test:tenant-assets" },
  { category: "tests", command: "npm run test:readiness-evidence" },
  { category: "tests", command: "npm run test:live-canary" },
  { category: "tests", command: "npm run test:main-release-readiness" },
  { category: "tests", command: "npm run test:cloudflare-resource-model" },
  { category: "tests", command: "npm run test:readiness-dossier" },
  { category: "tests", command: "npm run test:rollback-drill" },
  { category: "tests", command: "npm run test:evidence-index" },
  { category: "tests", command: "npm run test:release-rc" },
  { category: "tests", command: "npm run test:rc-check" },
  { category: "docs", command: "npm run check:doc-currentness" },
  { category: "docs", command: "npm run test:doc-currentness" },
  { category: "release", command: "npm run validate:release" },
  { category: "release", command: "npm run test:release-compat" },
  { category: "release", command: "npm run test:release-plan" },
  { category: "release", command: "npm run release:plan" },
  { category: "release", command: "npm run release:rc" },
  { category: "release", command: "npm run release:rc:markdown" },
  { category: "release", command: "npm run release:cutover-evidence" },
  { category: "release", command: "npm run release:cutover-evidence:markdown" },
  { category: "readiness", command: "npm run cloudflare:resource-model" },
  { category: "readiness", command: "npm run cloudflare:resource-model:markdown" },
  { category: "readiness", command: "npm run readiness:dossier" },
  { category: "readiness", command: "npm run readiness:dossier:markdown" },
  { category: "release", command: "npm run release:rollback-drill" },
  { category: "evidence", command: "npm run evidence:index" },
  { category: "evidence", command: "npm run evidence:index:markdown" },
  { category: "repository", command: "git diff --check" },
]);

const FORBIDDEN_COMMAND_PATTERNS = Object.freeze([
  /\bdeploy\b/i,
  /\bmigrations\s+apply\b.*\s--remote\b/i,
  /\brelease:apply\b/i,
  /\bwrangler\b.*\bdelete\b/i,
]);

function countByCategory(commands) {
  const counts = {};
  for (const entry of commands) {
    counts[entry.category] = (counts[entry.category] || 0) + 1;
  }
  return counts;
}

function parseCommand(command) {
  return String(command || "").trim().split(/\s+/).filter(Boolean);
}

function defaultRunner(entry, { repoRoot }) {
  const parts = parseCommand(entry.command);
  const result = spawnSync(parts[0], parts.slice(1), {
    cwd: repoRoot,
    stdio: "inherit",
  });
  return {
    ok: result.status === 0,
    code: result.status ?? 1,
  };
}

function commandHasForbiddenMutation(command) {
  return FORBIDDEN_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}

export function createRcCheckPlan({ generatedAt = new Date().toISOString() } = {}) {
  const commands = FINAL_RC_COMMANDS.map((entry, index) => ({
    id: `rc-check-${String(index + 1).padStart(2, "0")}`,
    category: entry.category,
    command: entry.command,
    localOnly: true,
    liveUrlRequired: false,
    secretsRequired: false,
    mutating: false,
  }));
  const forbiddenMatches = commands
    .filter((entry) => commandHasForbiddenMutation(entry.command))
    .map((entry) => entry.command);
  return {
    ok: forbiddenMatches.length === 0,
    version: RC_CHECK_VERSION,
    generatedAt,
    mode: "plan_only",
    localOnly: true,
    defaultRunsCommands: false,
    executionOptInFlag: "--run",
    stopOnFailure: true,
    liveUrlsRequired: false,
    secretsRequired: false,
    deployCommandsIncluded: false,
    remoteMigrationCommandsIncluded: false,
    cloudflareMutationIncluded: false,
    stripeCallsIncluded: false,
    providerCallsIncluded: false,
    commandCount: commands.length,
    summary: {
      byCategory: countByCategory(commands),
      forbiddenMatches,
    },
    commands,
    redaction: {
      envPrinted: false,
      secretValuesPrinted: false,
      adminCookiesPrinted: false,
    },
  };
}

export function runRcCheck({
  repoRoot = process.cwd(),
  generatedAt = new Date().toISOString(),
  execute = false,
  runner = defaultRunner,
} = {}) {
  const plan = createRcCheckPlan({ generatedAt });
  if (!execute) return plan;
  const executions = [];
  for (const entry of plan.commands) {
    const startedAt = new Date().toISOString();
    const result = runner(entry, { repoRoot });
    const execution = {
      id: entry.id,
      command: entry.command,
      category: entry.category,
      startedAt,
      finishedAt: new Date().toISOString(),
      ok: result.ok === true,
      code: Number.isInteger(result.code) ? result.code : (result.ok === true ? 0 : 1),
    };
    executions.push(execution);
    if (!execution.ok) {
      return {
        ...plan,
        ok: false,
        mode: "executed_local_matrix",
        defaultRunsCommands: false,
        failedCommand: execution,
        executions,
      };
    }
  }
  return {
    ...plan,
    ok: true,
    mode: "executed_local_matrix",
    executions,
  };
}

export function renderRcCheckMarkdown(plan) {
  const rows = plan.commands
    .map((entry) => `| ${entry.id} | ${entry.category} | \`${entry.command}\` | ${entry.localOnly ? "yes" : "no"} |`)
    .join("\n");
  const categoryRows = Object.entries(plan.summary?.byCategory || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([category, count]) => `- ${category}: ${count}`)
    .join("\n");
  return `# BITBI Release Candidate Validation Matrix

Generated: ${plan.generatedAt}

- Mode: **${plan.mode}**
- Local only: **${plan.localOnly}**
- Default runs commands: **${plan.defaultRunsCommands}**
- Execution opt-in flag: \`${plan.executionOptInFlag}\`
- Stop on failure: **${plan.stopOnFailure}**
- Live URLs required: **${plan.liveUrlsRequired}**
- Secrets required: **${plan.secretsRequired}**
- Deploy commands included: **${plan.deployCommandsIncluded}**
- Remote migration commands included: **${plan.remoteMigrationCommandsIncluded}**
- Secret values printed: **${plan.redaction.secretValuesPrinted}**

## Summary

${categoryRows || "- none"}

## Commands

| ID | Category | Command | Local only |
| --- | --- | --- | --- |
${rows}
`;
}
