import fs from 'node:fs';
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadReleaseCompatibilityContext } from "./lib/release-compat.mjs";
import {
  createReleasePlan,
  createReleasePlanFromRepo,
  runReleaseApply,
} from "./lib/release-plan.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function createContext() {
  const context = loadReleaseCompatibilityContext(repoRoot);
  context.repoRoot = repoRoot;
  return context;
}

for (const file of ["workers/auth/recovery/c-entry.mjs", "workers/auth/recovery/restriction-adapter.mjs"]) {
  const plan = createReleasePlanFromRepo(repoRoot, { files: [file] });
  assert.deepEqual(Object.keys(plan.impacts.workers), ["auth"]);
  assert.deepEqual(plan.impacts.uncategorizedFiles, []);
  assert.equal(plan.impacts.static.required, false);
  assert.deepEqual(plan.schemaApplies, []);
  assert.deepEqual(plan.workerDeploys.map(step => step.worker), ["auth"]);
}

{
  const plan = createReleasePlanFromRepo(repoRoot, {
    files: ["workers/contact/src/index.js"],
  });
  assert.deepEqual(Object.keys(plan.impacts.workers), ["contact"]);
  assert.equal(plan.impacts.static.required, false);
  assert.deepEqual(plan.schemaApplies, []);
  assert.deepEqual(
    plan.workerDeploys.map((step) => step.worker),
    ["contact"]
  );
  assert(plan.recommendedChecks.includes("npm run test:workers"));
}

{
  const plan = createReleasePlanFromRepo(repoRoot, {
    files: ["admin/index.html"],
  });
  assert.equal(plan.impacts.static.required, true);
  assert.deepEqual(Object.keys(plan.impacts.workers), []);
  assert.deepEqual(plan.deploySteps.map((step) => step.type), ["static"]);
  assert(plan.recommendedChecks.includes("npm run test:static"));
  assert(plan.recommendedChecks.includes("npm run test:asset-version"));
}

{
  const plan = createReleasePlanFromRepo(repoRoot, {
    files: ["workers/auth/src/index.js", "js/pages/admin/main.js"],
  });
  assert.deepEqual(Object.keys(plan.impacts.workers), ["auth"]);
  assert.equal(plan.impacts.static.required, true);
  assert.deepEqual(
    plan.deploySteps.map((step) => step.id),
    ["auth-worker", "static-site"]
  );
}

{
  const processorFiles = [
    "services/homepage-ffmpeg-processor/Dockerfile",
    "services/homepage-ffmpeg-processor/README.md",
    "services/homepage-ffmpeg-processor/package.json",
    "services/homepage-ffmpeg-processor/processor.mjs",
  ];
  const plan = createReleasePlanFromRepo(repoRoot, {
    files: processorFiles,
  });
  assert.deepEqual(Object.keys(plan.impacts.services), ["homepage-ffmpeg-processor"]);
  assert.deepEqual(plan.impacts.uncategorizedFiles, []);
  assert.deepEqual(plan.impacts.services["homepage-ffmpeg-processor"].changedFiles, processorFiles);
  assert.equal(plan.impacts.static.required, false);
  assert.deepEqual(
    plan.deploySteps.map((step) => step.id),
    ["media-worker", "auth-worker", "homepage-ffmpeg-processor"]
  );
  assert.equal(plan.deploySteps.at(-1).type, "service");
  assert(plan.remainingManualSteps.some((step) => step.includes("Deploy service: homepage-ffmpeg-processor")));
}

{
  const plan = createReleasePlanFromRepo(repoRoot, {
    files: [
      "workers/auth/migrations/0062_homepage_hero_external_ffmpeg_and_memvid_stream_previews.sql",
      "workers/auth/src/routes/homepage-hero-videos.js",
      "services/homepage-ffmpeg-processor/processor.mjs",
      "js/pages/admin/homepage-hero-videos.js",
    ],
  });
  assert.deepEqual(Object.keys(plan.impacts.schemaCheckpoints), ["auth"]);
  assert.deepEqual(Object.keys(plan.impacts.workers).sort(), ["auth", "media"]);
  assert.deepEqual(Object.keys(plan.impacts.services), ["homepage-ffmpeg-processor"]);
  assert.equal(plan.impacts.static.required, true);
  assert.deepEqual(plan.impacts.uncategorizedFiles, []);
  assert.deepEqual(
    plan.deploySteps.map((step) => step.id),
    ["auth-migrations", "media-worker", "auth-worker", "homepage-ffmpeg-processor", "static-site"]
  );
}

{
  const plan = createReleasePlanFromRepo(repoRoot, {
    files: ["workers/auth/migrations/0030_harden_ai_video_jobs_phase1b.sql"],
  });
  assert.deepEqual(Object.keys(plan.impacts.schemaCheckpoints), ["auth"]);
  assert.deepEqual(Object.keys(plan.impacts.workers), ["auth"]);
  assert.deepEqual(
    plan.deploySteps.map((step) => step.id),
    ["auth-migrations", "auth-worker"]
  );
  assert.deepEqual(
    plan.schemaApplies.map((step) => step.databaseName),
    ["bitbi-auth-db"]
  );
}

{
  const plan = createReleasePlanFromRepo(repoRoot, {
    files: ["workers/contact/src/index.js"],
  });
  assert.deepEqual(plan.schemaApplies, []);
  assert.deepEqual(plan.workerDeploys.map((step) => step.id), ["contact-worker"]);
  assert.deepEqual(plan.workerDeploys[0].includesWranglerMigrations, ["v1-public-rate-limiter"]);
}

{
  const plan = createReleasePlanFromRepo(repoRoot, {
    files: ["workers/auth/src/index.js"],
  });
  assert(
    plan.manualPrerequisites.required.some((entry) => entry.id === "auth-session-secret")
  );
  assert(
    plan.manualPrerequisites.required.some((entry) => entry.id === "auth-audit-archive-bucket-created")
  );
}

{
  const plan = createReleasePlanFromRepo(repoRoot, {
    files: ["config/release-compat.json"],
  });
  assert.equal(plan.deploySteps.length, 0);
  assert.deepEqual(plan.impacts.validationOnlyFiles, ["config/release-compat.json"]);
  assert(
    plan.compatibilityNotes.some((note) => note.includes("Auth/AI caller-policy compatibility"))
  );
  assert.equal(plan.isNoop, true);
}

{
  // Agent-policy-only change set from commit 57fb66592664c726ae4479ad27497e9426d28c30.
  const policyFiles = ["AGENTS.md", "workers/auth/AGENTS.md", "workers/auth/CLAUDE.md"];
  const plan = createReleasePlanFromRepo(repoRoot, { files: policyFiles });
  assert.deepEqual(plan.impacts.validationOnlyFiles, policyFiles);
  assert.deepEqual(plan.impacts.uncategorizedFiles, []);
  assert.deepEqual(plan.workerDeploys, []);
  assert.deepEqual(plan.schemaApplies, []);
  assert.deepEqual(plan.deploySteps, []);
  assert.equal(plan.impacts.static.required, false);
  assert.equal(plan.isNoop, true);
}

{
  const instructionFiles = [
    "AGENTS.md",
    "CLAUDE.md",
    "workers/ai/AGENTS.md",
    "workers/ai/CLAUDE.md",
    "workers/auth/AGENTS.md",
    "workers/auth/CLAUDE.md",
    "workers/contact/AGENTS.md",
    "workers/contact/CLAUDE.md",
  ];
  const plan = createReleasePlanFromRepo(repoRoot, { files: instructionFiles });
  assert.deepEqual(plan.impacts.validationOnlyFiles, instructionFiles);
  assert.deepEqual(plan.impacts.uncategorizedFiles, []);
  assert.deepEqual(plan.deploySteps, []);
  assert.equal(plan.isNoop, true);
}

{
  const file = ".agents/skills/deploy-checklist/SKILL.md";
  const plan = createReleasePlanFromRepo(repoRoot, { files: [file] });
  assert.deepEqual(plan.impacts.validationOnlyFiles, [file]);
  assert.deepEqual(plan.impacts.uncategorizedFiles, []);
  assert.deepEqual(plan.deploySteps, []);
  assert.equal(plan.isNoop, true);
}

{
  const unknownFiles = [
    ".agents/skills/deploy-checklist/SKILL.md.backup",
    ".agents/skills/deploy-checklist/deploy.mjs",
    ".agents/skills/unknown/SKILL.md",
    "UNCLASSIFIED.md",
    "workers/auth/AGENTS.md.backup",
    "workers/auth/CLAUDE.md.backup",
    "workers/auth/UNCLASSIFIED.md",
    "workers/unknown/AGENTS.md",
  ];
  const plan = createReleasePlanFromRepo(repoRoot, { files: unknownFiles });
  assert.deepEqual(plan.impacts.validationOnlyFiles, []);
  assert.deepEqual(plan.impacts.uncategorizedFiles, unknownFiles);
}

{
  const plan = createReleasePlanFromRepo(repoRoot, {
    files: [".gitignore"],
  });
  assert.equal(plan.deploySteps.length, 0);
  assert.deepEqual(plan.impacts.validationOnlyFiles, [".gitignore"]);
  assert.deepEqual(plan.impacts.uncategorizedFiles, []);
  assert.equal(plan.isNoop, true);
}

{
  const plan = createReleasePlanFromRepo(repoRoot, {
    files: [
      "playwright.config.js",
      "playwright.carousel.config.js",
      "playwright.homepage.config.js",
      "playwright.homepage-performance.config.js",
      "playwright.homepage-webkit.config.js",
      "playwright.workers.config.js",
    ],
  });
  assert.equal(plan.deploySteps.length, 0);
  assert.deepEqual(plan.impacts.validationOnlyFiles, [
    "playwright.carousel.config.js",
    "playwright.config.js",
    "playwright.homepage-performance.config.js",
    "playwright.homepage-webkit.config.js",
    "playwright.homepage.config.js",
    "playwright.workers.config.js",
  ]);
  assert.deepEqual(plan.impacts.uncategorizedFiles, []);
  assert.equal(plan.isNoop, true);
}

{
  const plan = createReleasePlanFromRepo(repoRoot, {
    files: [
      "github-actions-stuck-evidence/actions-permissions-before.json",
      "github-actions-stuck-evidence/queued-runs.json",
    ],
  });
  assert.equal(plan.deploySteps.length, 0);
  assert.deepEqual(plan.impacts.validationOnlyFiles, [
    "github-actions-stuck-evidence/actions-permissions-before.json",
    "github-actions-stuck-evidence/queued-runs.json",
  ]);
  assert.deepEqual(plan.impacts.uncategorizedFiles, []);
  assert.equal(plan.isNoop, true);
}

{
  const plan = createReleasePlanFromRepo(repoRoot, {
    files: [
      "tests/workers.spec.js",
      "AGENTS.md",
      "docs/audits/archive/retired-audit-root-docs/ALPHA_AUDIT_2026_05_15.md",
      "docs/audits/archive/retired-audit-root-docs/AUDIT_NEXT_LEVEL.md",
      "docs/audits/archive/root-phase-reports/PHASE0_REMEDIATION_REPORT.md",
      "docs/audits/archive/root-phase-reports/PHASE0B_REMEDIATION_REPORT.md",
      "docs/audits/archive/root-phase-reports/PHASE1A_REMEDIATION_REPORT.md",
      "docs/audits/archive/root-phase-reports/PHASE1B_REMEDIATION_REPORT.md",
      "docs/audits/archive/root-phase-reports/PHASE1_OBSERVABILITY_BASELINE.md",
      "docs/audits/archive/root-phase-reports/PHASE_MEMBER_SUBSCRIPTIONS_PRO_REPORT.md",
      "docs/audits/archive/root-phase-reports/AI_VIDEO_ASYNC_JOB_DESIGN.md",
      "DATA_INVENTORY.md",
      "CURRENT_IMPLEMENTATION_HANDOFF.md",
      "SAAS_PROGRESS_AND_CURRENT_STATE_REPORT.md",
      "docs/audits/README.md",
    ],
  });
  assert.equal(plan.deploySteps.length, 0);
  assert.deepEqual(plan.impacts.validationOnlyFiles, [
    "AGENTS.md",
    "CURRENT_IMPLEMENTATION_HANDOFF.md",
    "DATA_INVENTORY.md",
    "SAAS_PROGRESS_AND_CURRENT_STATE_REPORT.md",
    "docs/audits/README.md",
    "docs/audits/archive/retired-audit-root-docs/ALPHA_AUDIT_2026_05_15.md",
    "docs/audits/archive/retired-audit-root-docs/AUDIT_NEXT_LEVEL.md",
    "docs/audits/archive/root-phase-reports/AI_VIDEO_ASYNC_JOB_DESIGN.md",
    "docs/audits/archive/root-phase-reports/PHASE0B_REMEDIATION_REPORT.md",
    "docs/audits/archive/root-phase-reports/PHASE0_REMEDIATION_REPORT.md",
    "docs/audits/archive/root-phase-reports/PHASE1A_REMEDIATION_REPORT.md",
    "docs/audits/archive/root-phase-reports/PHASE1B_REMEDIATION_REPORT.md",
    "docs/audits/archive/root-phase-reports/PHASE1_OBSERVABILITY_BASELINE.md",
    "docs/audits/archive/root-phase-reports/PHASE_MEMBER_SUBSCRIPTIONS_PRO_REPORT.md",
    "tests/workers.spec.js",
  ]);
  assert.equal(plan.isNoop, true);
}

{
  const plan = createReleasePlanFromRepo(repoRoot, {
    files: ["workers/ai/package-lock.json"],
  });
  assert.deepEqual(Object.keys(plan.impacts.workers), ["ai"]);
  assert.deepEqual(
    plan.deploySteps.map((step) => step.id),
    ["ai-worker"]
  );
  assert(plan.recommendedChecks.includes("npm run test:workers"));
}

{
  const plan = createReleasePlanFromRepo(repoRoot, {
    files: ["js/shared/admin-ai-contract.mjs"],
  });
  assert.deepEqual(Object.keys(plan.impacts.workers).sort(), ["ai", "auth"]);
  assert.equal(plan.impacts.static.required, true);
}

{
  const plan = createReleasePlanFromRepo(repoRoot, {
    files: ["workers/shared/ai-caller-policy.mjs"],
  });
  assert.deepEqual(Object.keys(plan.impacts.workers).sort(), ["ai", "auth"]);
  assert.equal(plan.impacts.static.required, false);
  assert.deepEqual(plan.impacts.uncategorizedFiles, []);
  assert.deepEqual(
    plan.deploySteps.map((step) => step.id),
    ["ai-worker", "auth-worker"]
  );
  assert(
    plan.compatibilityNotes.some((note) => note.includes("Auth/AI caller-policy compatibility"))
  );
  assert(plan.remainingManualSteps.some((step) => step.includes("deploy AI Worker before Auth Worker")));
}

{
  const plan = createReleasePlanFromRepo(repoRoot, {
    files: ["workers/shared/fable-chat-contract.mjs"],
  });
  assert.deepEqual(Object.keys(plan.impacts.workers).sort(), ["ai", "auth"]);
  assert.equal(plan.impacts.static.required, false);
  assert.deepEqual(plan.impacts.uncategorizedFiles, []);
  assert.deepEqual(
    plan.deploySteps.map((step) => step.id),
    ["ai-worker", "auth-worker"]
  );
}

{
  const plan = createReleasePlanFromRepo(repoRoot, {
    files: [
      "workers/shared/chat-model-contract.mjs",
      "workers/shared/grok-chat-contract.mjs",
    ],
  });
  assert.deepEqual(Object.keys(plan.impacts.workers).sort(), ["ai", "auth"]);
  assert.equal(plan.impacts.static.required, false);
  assert.deepEqual(plan.impacts.uncategorizedFiles, []);
  assert.deepEqual(
    plan.deploySteps.map((step) => step.id),
    ["ai-worker", "auth-worker"]
  );
}

{
  const plan = createReleasePlanFromRepo(repoRoot, {
    files: ["workers/shared/fable-chat-memory-contract.mjs"],
  });
  assert.deepEqual(Object.keys(plan.impacts.workers).sort(), ["ai", "auth"]);
  assert.equal(plan.impacts.static.required, false);
  assert.deepEqual(plan.impacts.uncategorizedFiles, []);
  assert.deepEqual(
    plan.deploySteps.map((step) => step.id),
    ["ai-worker", "auth-worker"]
  );
}

{
  const plan = createReleasePlanFromRepo(repoRoot, {
    files: ["js/shared/request-body.mjs"],
  });
  assert.deepEqual(Object.keys(plan.impacts.workers).sort(), ["ai", "auth", "contact"]);
  assert.equal(plan.impacts.static.required, true);
  assert(plan.recommendedChecks.includes("npm run test:workers"));
}

{
  const calls = [];
  const result = runReleaseApply(
    repoRoot,
    {
      files: ["workers/auth/src/index.js"],
    },
    {
      runCommand(command, options) {
        calls.push({ command, ...options });
        return {
          ok: true,
          dryRun: !options.execute,
          pretty: options.cwd ? `(cd ${options.cwd} && ${command.join(" ")})` : command.join(" "),
          command,
          cwd: options.cwd,
          code: 0,
        };
      },
    }
  );
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.deepEqual(
    calls.map((entry) => entry.command.join(" ")),
    ["npx wrangler deploy"]
  );
  assert(calls.every((entry) => entry.execute === false));
}

{
  const calls = [];
  const result = runReleaseApply(
    repoRoot,
    {
      execute: true,
      files: [
        "workers/auth/migrations/0029_add_ai_video_jobs.sql",
        "workers/auth/migrations/0030_harden_ai_video_jobs_phase1b.sql",
        "workers/ai/src/index.js",
        "workers/auth/src/index.js",
      ],
    },
    {
      runCommand(command, options) {
        calls.push({ command, ...options });
        return {
          ok: true,
          dryRun: !options.execute,
          pretty: options.cwd ? `(cd ${options.cwd} && ${command.join(" ")})` : command.join(" "),
          command,
          cwd: options.cwd,
          code: 0,
        };
      },
    }
  );
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, false);
  assert.deepEqual(
    calls.map((entry) => ({
      command: entry.command.join(" "),
      cwd: entry.cwd || null,
      execute: entry.execute,
    })),
    [
      { command: "npm run check:toolchain", cwd: null, execute: true },
      { command: "npm run test:quality-gates", cwd: null, execute: true },
      { command: "npm run check:secrets", cwd: null, execute: true },
      { command: "npm run check:dom-sinks", cwd: null, execute: true },
      { command: "npm run check:route-policies", cwd: null, execute: true },
      { command: "npm run test:operational-readiness", cwd: null, execute: true },
      { command: "npm run check:operational-readiness", cwd: null, execute: true },
      { command: "npm run check:live-health", cwd: null, execute: true },
      { command: "npm run check:live-security-headers", cwd: null, execute: true },
      { command: "npm run test:live-canary", cwd: null, execute: true },
      { command: "npm run check:js", cwd: null, execute: true },
      { command: "npm run test:release-compat", cwd: null, execute: true },
      { command: "npm run validate:release", cwd: null, execute: true },
      { command: "npm run validate:cloudflare-prereqs", cwd: null, execute: true },
      { command: "npm run test:cloudflare-resource-model", cwd: null, execute: true },
      { command: "npm run test:readiness-dossier", cwd: null, execute: true },
      { command: "npm run test:rollback-drill", cwd: null, execute: true },
      { command: "npm run test:release-rc", cwd: null, execute: true },
      { command: "npm run test:rc-check", cwd: null, execute: true },
      { command: "npm run rc:check", cwd: null, execute: true },
      { command: "npm run release:rc", cwd: null, execute: true },
      { command: "npm run check:worker-body-parsers", cwd: null, execute: true },
      { command: "npm run check:admin-activity-query-shape", cwd: null, execute: true },
      { command: "npm run check:data-lifecycle", cwd: null, execute: true },
      { command: "npm run test:doc-currentness", cwd: null, execute: true },
      { command: "npm run check:doc-currentness", cwd: null, execute: true },
      { command: "npm run test:readiness-evidence", cwd: null, execute: true },
      { command: "npm run test:main-release-readiness", cwd: null, execute: true },
      { command: "npm run test:ai-cost-gateway", cwd: null, execute: true },
      { command: "npm run test:ai-cost-operations", cwd: null, execute: true },
      { command: "npm run test:admin-platform-budget-policy", cwd: null, execute: true },
      { command: "npm run test:admin-platform-budget-evidence", cwd: null, execute: true },
      { command: "npm run check:ai-cost-policy", cwd: null, execute: true },
      { command: "npm run test:workers", cwd: null, execute: true },
      {
        command: "npx wrangler d1 migrations apply bitbi-auth-db --remote",
        cwd: "workers/auth",
        execute: true,
      },
      {
        command: "npx wrangler deploy",
        cwd: "workers/ai",
        execute: true,
      },
      {
        command: "npx wrangler deploy",
        cwd: "workers/auth",
        execute: true,
      },
    ]
  );
}

{
  const context = createContext();
  const plan = createReleasePlan(context, {
    changedFiles: ["workers/auth/migrations/9999_missing.sql"],
    source: { mode: "explicit" },
  });
  assert(
    plan.consistencyIssues.some((issue) =>
      issue.includes('Changed migration file "workers/auth/migrations/9999_missing.sql" no longer exists on disk.')
    )
  );
}

{
  const plan = createReleasePlanFromRepo(repoRoot, { files: ['playwright.admin-release.config.js'] });
  assert.deepEqual(plan.impacts.uncategorizedFiles, []);
  assert.equal(plan.impacts.static.required, false);
  assert.deepEqual(plan.workerDeploys, []);
  assert.deepEqual(plan.schemaApplies, []);
  const unknown = createReleasePlanFromRepo(repoRoot, { files: ['playwright.admin-unknown.config.js'] });
  assert.deepEqual(unknown.impacts.uncategorizedFiles, ['playwright.admin-unknown.config.js']);
}

console.log("Release planner tests passed.");

for (const file of ["js/shared/canvas-model-contract.mjs", "js/shared/canvas-video-input.mjs"]) {
 const plan = createReleasePlanFromRepo(repoRoot, { files: [file] });
 assert.deepEqual(plan.workerDeploys.map(step => step.worker), ["auth"]);
 assert.equal(plan.impacts.static.required, true);
 assert.deepEqual(plan.schemaApplies, []);
 assert.deepEqual(plan.impacts.uncategorizedFiles, []);
}

{
 const {backendContinuationSupported}=await import('./lib/backend-continuation.mjs');
 const {evaluateStaticDeploySafety}=await import('./lib/release-plan.mjs');
 const {verifyBackendActivation}=await import('./lib/backend-publication.mjs');
 const plan=createReleasePlanFromRepo(repoRoot,{files:['workers/auth/src/routes/canvas.js','workers/auth/migrations/0088_add_canvas_video_processing.sql','services/homepage-ffmpeg-processor/canvas-full-video.mjs','js/pages/canvas/main.js']});
 assert(backendContinuationSupported(plan));
 assert.equal(evaluateStaticDeploySafety(plan,{eventName:'push'}).allowed,false);
 assert.equal(evaluateStaticDeploySafety(plan,{eventName:'push',dependenciesVerified:true}).mode,'verified_backend_dependencies');
 for(const extra of ['workers/ai/src/index.js','workers/ai/wrangler.jsonc','unknown-backend-entry.js']) {
   const invalid=createReleasePlanFromRepo(repoRoot,{files:[...plan.changedFiles,extra]});assert(!backendContinuationSupported(invalid));assert(!evaluateStaticDeploySafety(invalid,{eventName:'push',dependenciesVerified:true}).allowed);
 }
 const receipt={sha:'a'.repeat(40),base:'b'.repeat(40),run:'123',attempt:'1',worker:'bitbi-auth',migration:'0088_add_canvas_video_processing.sql',version:'version-1',deployment:'deployment-1'};
 const state={sha:receipt.sha,base:receipt.base,runId:'123',attempt:'1',migration:receipt.migration,processorSha:receipt.sha,version:{id:receipt.version,annotations:{'workers/message':`bitbi-auth:${receipt.sha}`}},deployment:{id:receipt.deployment,versions:[{version_id:receipt.version,percentage:100}]}};
 verifyBackendActivation(receipt,state);
 for(const key of ['sha','base','runId','attempt','migration','processorSha'])assert.throws(()=>verifyBackendActivation(receipt,{...state,[key]:'wrong'}));
 assert.throws(()=>verifyBackendActivation(receipt,{...state,deployment:{...state.deployment,versions:[{version_id:'old',percentage:100}]}}));
 assert.throws(()=>verifyBackendActivation(receipt,{...state,version:{id:receipt.version}}));
 console.log('Protected backend continuation: scope, exact source/attempt/schema/processor, and sole active Auth version controls passed.');
}

{
 const {advanceBackend}=await import('./lib/backend-publication.mjs');
 const actions=[],sha='a'.repeat(40);
 const steps={sha,pending:['0088'],activeVersion:{},assertCurrent:async()=>actions.push('current'),applyMigration:async()=>actions.push('schema'),assertSchema:async()=>actions.push('schema-read'),deploy:async()=>actions.push('auth'),readActive:async()=>{actions.push('active-read');return {version:'new'};}};
 assert.deepEqual(await advanceBackend(steps),{version:'new'});assert.deepEqual(actions,['current','schema','schema-read','current','auth','active-read']);
 for(const failure of ['assertCurrent','applyMigration','assertSchema','deploy']) {
   actions.length=0;await assert.rejects(advanceBackend({...steps,[failure]:async()=>{throw Error(failure);}}));
   assert(!actions.includes('active-read'));if(failure!=='deploy')assert(!actions.includes('auth'));
 }
 actions.length=0;await advanceBackend({...steps,pending:[],activeVersion:{annotations:{'workers/message':`bitbi-auth:${sha}`}}});
 assert.deepEqual(actions,['current','schema-read','current','active-read'],'Repeated same candidate verifies without another migration/Auth deploy');
}

{
 const {assertMediaAuthConfig}=await import('./lib/media-publication.mjs');
 const before=JSON.parse(fs.readFileSync(path.join(repoRoot,'workers/auth/wrangler.jsonc')));
 const after=structuredClone(before);delete before.vars.PRIVATE_MEDIA_SOURCE_SHA;before.services=before.services.filter(s=>s.binding!=='PRIVATE_MEDIA_PROCESSOR');before.secrets.required=before.secrets.required.filter(s=>s!=='PRIVATE_MEDIA_PROCESSOR_SECRET');
 assertMediaAuthConfig(before,after);
 const loggingBefore=structuredClone(before);loggingBefore.observability.logs.invocation_logs=true;
 assertMediaAuthConfig(loggingBefore,after);
 const unsafeLogs=structuredClone(after);unsafeLogs.observability.logs.invocation_logs=true;
 assert.throws(()=>assertMediaAuthConfig(before,unsafeLogs),/invocation logs disabled/);
 const alteredLogs=structuredClone(after);alteredLogs.observability.logs.enabled=false;
 assert.throws(()=>assertMediaAuthConfig(before,alteredLogs),/Unreviewed Auth/);
 const invalid=structuredClone(after);invalid.routes=[];assert.throws(()=>assertMediaAuthConfig(before,invalid),/Unreviewed Auth/);
 const media=createReleasePlanFromRepo(repoRoot,{files:['workers/media/src/index.js','workers/auth/wrangler.jsonc','workers/auth/migrations/0089_add_private_media_services.sql','admin/index.html']});
 const {backendContinuationSupported}=await import('./lib/backend-continuation.mjs');assert(backendContinuationSupported(media));
 assert.equal(media.schemaApplies[0].checkpoint,'auth');
}

{
 const {verifyMediaEvidence}=await import('./lib/media-publication.mjs');
 const sha='a'.repeat(40),digest='b'.repeat(64),scope={sha,run:'123',attempt:'1'};
 const receipt={media:{sha,sourceRun:'123',sourceAttempt:'1',imageDigest:`registry.cloudflare.com/${'c'.repeat(32)}/bitbi-private-media@sha256:${digest}`,artifact:{id:123,digest:`sha256:${digest}`}},smoke:['github','cloudflare'].map(backend=>({backend,sha,completedMs:100,outputs:Array.from({length:3},()=>({videoDigest:digest,posterDigest:digest}))}))};
 verifyMediaEvidence(receipt,scope);
 assert.throws(()=>verifyMediaEvidence(receipt,{...scope,videoReferences:true}),/reference acceptance/);
 const references={...receipt,smoke:receipt.smoke.map(s=>({...s,videoReference:{videoDigest:digest,originalDigest:'2c67d78cda7252be0cb6ef14396d92abb3b7193940ecc977a5c9fcc823bd1609',metadata:{frames:360,duration:15,audioDuration:15}}}))};
 verifyMediaEvidence(references,{...scope,videoReferences:true});
 for(const patch of [{originalDigest:digest},{metadata:{frames:362,duration:15.083333,audioDuration:15}},{metadata:{frames:360,duration:15,audioDuration:0}}]) {
  const bad=structuredClone(references);Object.assign(bad.smoke[0].videoReference,patch);
  assert.throws(()=>verifyMediaEvidence(bad,{...scope,videoReferences:true}));
 }
 assert.throws(()=>verifyMediaEvidence(receipt,{...scope,publicPreviews:true}),/public preview/);
 const previews={...receipt,smoke:receipt.smoke.map(s=>({...s,publicPreviews:Array.from({length:2},()=>({videoDigest:digest,posterDigest:digest}))}))};
 verifyMediaEvidence(previews,{...scope,publicPreviews:true});
 const wrongPreview=structuredClone(previews);wrongPreview.smoke[0].publicPreviews[1].posterDigest='wrong';
 assert.throws(()=>verifyMediaEvidence(wrongPreview,{...scope,publicPreviews:true}),/public preview/);
 for(const key of ['sha','run','attempt'])assert.throws(()=>verifyMediaEvidence(receipt,{...scope,[key]:'wrong'}));
 for(const bad of [{},{...receipt,media:null},{...receipt,smoke:receipt.smoke.slice(0,1)},{...receipt,smoke:receipt.smoke.map(s=>({...s,outputs:[]}))}])assert.throws(()=>verifyMediaEvidence(bad,scope));
 const {advanceBackend}=await import('./lib/backend-publication.mjs');
 const seen=[],steps={sha,pending:['0089'],activeVersion:{},assertCurrent:async()=>{},applyMigration:async()=>seen.push('schema'),assertSchema:async()=>{},prepareMedia:async()=>seen.push('media'),deploy:async()=>seen.push('auth'),readActive:async()=>seen.push('read'),verifyMedia:async()=>seen.push('smoke')};
 await advanceBackend(steps);assert.deepEqual(seen,['schema','media','auth','read','smoke']);
 for(const fail of ['prepareMedia','deploy','verifyMedia']){seen.length=0;await assert.rejects(advanceBackend({...steps,[fail]:async()=>{throw Error('synthetic failure');}}));if(fail==='prepareMedia')assert(!seen.includes('auth'));}
 console.log('Media release: schema/image/Auth/smoke order, failed upload, missing smoke and wrong artifact source remain blocking.');
}

{
 const {backendCommand,verifyAuthTriggers,activateAuthVersion,advanceBackend,verifyAuthBundle}=await import('./lib/backend-publication.mjs');
 const {hash}=await import('./lib/frontend-hosting.mjs');
 const response=(body,name='index.js')=>{const data=new FormData();data.set(name,new Blob([body]),name);return new Response(data);};
 await verifyAuthBundle(hash('candidate bytes'),async()=>response('candidate bytes'));
 for(const bad of [()=>response('changed'),()=>response('candidate bytes','wrong.js'),()=>new Response('',{status:403})])await assert.rejects(verifyAuthBundle(hash('candidate bytes'),async()=>bad()));
 const reports=[];const failure=Object.assign(Error('private error'),{status:1,stdout:'binding SECRET: PRIVATE_VALUE',stderr:'Trigger configuration was only partially updated:\n  Routes:\n Authentication error [code: 10000]\nhttps://example.test/?token=PRIVATE_VALUE'});
 assert.throws(()=>backendCommand(['deploy','--secrets-file','/private/SECRET'],()=>{throw failure;},r=>reports.push(r)),/redacted backend diagnostics/);
 assert.deepEqual(reports[0].apiCodes,[10000]);assert.deepEqual(reports[0].categories,['Routes']);assert(reports[0].partialTriggers&&reports[0].authenticationFailure);
 assert(!JSON.stringify(reports).includes('PRIVATE_VALUE'));assert(!JSON.stringify(reports).includes('SECRET'));
 const config=JSON.parse(fs.readFileSync(path.join(repoRoot,'workers/auth/wrangler.jsonc'))),prefix='workers/scripts/bitbi-auth';
 const fixture={ [`${prefix}/routes`]:config.routes.map(r=>({...r,script:'bitbi-auth'})),[`${prefix}/schedules`]:{schedules:config.triggers.crons.map(cron=>({cron}))},[`${prefix}/subdomain`]:{enabled:false,previews_enabled:false}};
 for(const q of config.queues.consumers)fixture[`queues?name=${q.queue}`]=[{queue_name:q.queue,settings:{delivery_paused:false},consumers:[{type:'worker',script:'bitbi-auth',settings:{batch_size:q.max_batch_size,max_retries:q.max_retries,max_wait_time_ms:q.max_batch_timeout*1000,retry_delay:0}}]}];
 const reader=data=>async key=>{assert(Object.hasOwn(data,key),`unexpected API ${key}`);return structuredClone(data[key]);};
 await verifyAuthTriggers(config,reader(fixture));
 const firstQueue=`queues?name=${config.queues.consumers[0].queue}`;
 for(const mutate of [f=>f[`${prefix}/routes`].pop(),f=>f[`${prefix}/routes`][0].script='other',f=>f[`${prefix}/schedules`].schedules.pop(),f=>f[`${prefix}/subdomain`].previews_enabled=true,f=>f[firstQueue][0].settings.delivery_paused=true,f=>f[firstQueue][0].consumers[0].settings.max_retries=0,f=>f[firstQueue][0].consumers.push({})]) {
   const bad=structuredClone(fixture);mutate(bad);await assert.rejects(verifyAuthTriggers(config,reader(bad)));
 }
 await assert.rejects(verifyAuthTriggers(config,async()=>{throw Error('read denied');}));
 const calls=[],sha='a'.repeat(40),id='12345678-1234-1234-1234-123456789abc';
 await activateAuthVersion({sha,secretFile:'/private/secrets.json',assertCurrent:async()=>calls.push('current'),command:args=>{calls.push(args);return `Worker Version ID: ${id}`;}});
 assert.deepEqual(calls,[['versions','upload','--keep-vars','--secrets-file','/private/secrets.json','--var',`PRIVATE_MEDIA_SOURCE_SHA:${sha}`,'--message',`bitbi-auth:${sha}`],'current',['versions','deploy',`${id}@100%`,'--yes','--message',`bitbi-auth:${sha}`]]);
 for(const kind of ['upload','identity','superseded','activation']) {
   const seen=[];await assert.rejects(activateAuthVersion({sha,secretFile:'private',assertCurrent:async()=>{if(kind==='superseded')throw Error(kind);},command:args=>{seen.push(args[1]);if(args[1]===(kind==='activation'?'deploy':'upload')&&kind!=='superseded'&&kind!=='identity')throw Error(kind);return kind==='identity'?'missing':`Worker Version ID: ${id}`;}}));
   assert.deepEqual(seen,kind==='activation'?['upload','deploy']:['upload']);
 }
 const actions=[],steps={sha,pending:[],activeVersion:{annotations:{'workers/message':`bitbi-auth:${sha}`}},assertCurrent:async()=>{},assertSchema:async()=>{},prepareMedia:async()=>actions.push('media'),deploy:async()=>actions.push('auth'),readActive:async()=>actions.push('read'),verifyMedia:async()=>actions.push('smoke')};
 await assert.rejects(advanceBackend({...steps,verifyConfiguration:async()=>{throw Error('unfinished trigger');}}));assert.deepEqual(actions,[]);
 let checked=0;await assert.rejects(advanceBackend({...steps,verifyConfiguration:async()=>{if(++checked===2)throw Error('changed trigger');}}));assert.deepEqual(actions,['media','read']);
 console.log('Auth publication: safe failure diagnostics, exact unchanged trigger readback, version-only activation and partial/superseded failure controls passed.');
}

{
 const {verifyMediaImage,mediaImageInputs}=await import('./private-media-image.mjs');
 const {hash}=await import('./lib/frontend-hosting.mjs');const os=await import('node:os');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'media-identity-')),archive=path.join(dir,'image.tar');fs.writeFileSync(archive,'synthetic archive bytes');
 try {
   const sha='a'.repeat(40),expected={sha,run:'123',attempt:'1',archive};
   const record={sha,run:'123',attempt:'1',dirty:false,sourceFiles:mediaImageInputs(),platform:'linux/amd64',ffmpeg:'synthetic-version',ffprobe:'synthetic-version',image:`sha256:${'b'.repeat(64)}`,archiveDigest:hash(fs.readFileSync(archive)),tests:['two-five-clips','copy-normalize-audio','private-drain-poster','container-process-restart','h3-video-reference']};
   verifyMediaImage(record,expected);
   for(const patch of [{sha:'wrong'},{run:'124'},{attempt:'2'},{dirty:true},{sourceFiles:{}},{archiveDigest:'wrong'},{platform:'linux/arm64'},{tests:[]}])assert.throws(()=>verifyMediaImage({...record,...patch},expected));
   fs.appendFileSync(archive,'changed');assert.throws(()=>verifyMediaImage(record,expected));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}

{
 const {waitMediaState,verifyMediaEvidence}=await import('./lib/media-publication.mjs');
 const observations=[],states=['running','stopping','stopped','provisioning','running','stopped'];let now=1000;
 const read=async endpoint=>{observations.push(endpoint);return {instances:[{id:'synthetic-instance',status:{state:states.shift(),updated_at:new Date(now).toISOString()}}]};};
 const options={read,now:()=>now,pause:async ms=>{now+=ms;}};
 const stoppedBefore=await waitMediaState('synthetic-app','stopped',options);
 const running=await waitMediaState('synthetic-app','running',options);
 const completed={observedAt:new Date(now).toISOString()};
 const stoppedAfter=await waitMediaState('synthetic-app','stopped',options);
 assert.equal(observations.length,6);assert(observations.every(p=>p==='containers/applications/synthetic-app/instances'));
 for(const state of ['failed','unhealthy','unknown'])await assert.rejects(waitMediaState('app','stopped',{...options,read:async()=>({instances:[{status:{state}}]})}));
 for(const instances of [[],[{},{}]])await assert.rejects(waitMediaState('app','stopped',{...options,read:async()=>({instances})}));
 await assert.rejects(waitMediaState('app','stopped',{...options,timeout:10000,read:async()=>({instances:[{status:{state:'running'}}]})}),/bounded production/);
 const sha='a'.repeat(40),digest='b'.repeat(64),scope={sha,run:'123',attempt:'1',lifecycle:true};
 const receipt={media:{sha,sourceRun:'123',sourceAttempt:'1',imageDigest:`registry.cloudflare.com/${'c'.repeat(32)}/bitbi-private-media@sha256:${digest}`,artifact:{id:123,digest:`sha256:${digest}`}},smoke:['github','cloudflare'].map(backend=>({backend,sha,completedMs:100,outputs:Array.from({length:3},()=>({videoDigest:digest,posterDigest:digest})),...(backend==='cloudflare'?{lifecycle:{stoppedBefore,running,completed,stoppedAfter}}:{})}))};
 verifyMediaEvidence(receipt,scope);
 for(const patch of [{lifecycle:null},{lifecycle:{stoppedBefore,running,completed,stoppedAfter:{...stoppedAfter,state:'running'}}},{lifecycle:{stoppedBefore,running,completed,stoppedAfter:{...stoppedAfter,instance:'another'}}}]) {
  const bad=structuredClone(receipt);Object.assign(bad.smoke[1],patch);assert.throws(()=>verifyMediaEvidence(bad,scope));
 }
 console.log('Media stop/wake/stop: independent platform states, missing/stuck/failed instance and wrong cycle rejected.');
}

{
 const {mediaActive,activateMedia,currentMediaVersion}=await import('./lib/media-publication.mjs');
 const expected={sha:'a'.repeat(40),imageDigest:'registry/synthetic@sha256:'+'b'.repeat(64)};
 const env={CLOUDFLARE_ACCOUNT_ID:'synthetic-account'};
 const version={id:'version',annotations:{'workers/message':`bitbi-media:${expected.sha}:${expected.imageDigest}`},resources:{bindings:[{name:'MEDIA_CONTAINER',namespace_id:'namespace'},{name:'CLOUDFLARE_STREAM_API_TOKEN',type:'secret_text'},{name:'CLOUDFLARE_ACCOUNT_ID',text:env.CLOUDFLARE_ACCOUNT_ID}]}};
 const app={id:'application',account_id:env.CLOUDFLARE_ACCOUNT_ID,max_instances:1,instances:1,configuration:{image:'old-image'},durable_objects:{namespace_id:'namespace'},active_rollout_id:'current-rollout'};
 const detail={...app,configuration:{image:expected.imageDigest},version:4};delete detail.active_rollout_id;
 const rollout={id:'current-rollout',status:'completed',target_version:4,target_configuration:{image:expected.imageDigest},
  steps:[{status:'completed',step_size:{percentage:100}}],progress:{total_instances:1,updated_instances:1,version_distribution:{target_version_instances:1,current_version_instances:0,target_version_percentage:100}}};
 const instances={instances:[{id:'singleton',name:'private-media-singleton',application_id:app.id,image:expected.imageDigest,status:{state:'inactive'}}]};
 const deployment={id:'deployment',versions:[{version_id:'version',percentage:100}]};
 const fixture={
  'workers/scripts/bitbi-private-media/deployments':{deployments:[deployment]},'workers/scripts/bitbi-private-media/versions/version':version,
  'containers/applications':[app],'containers/applications/application':detail,
  'containers/applications/application/rollouts/current-rollout':rollout,'containers/applications/application/instances':instances,
 };
 const endpoints=[],read=async endpoint=>{endpoints.push(endpoint);assert(Object.hasOwn(fixture,endpoint),`Unexpected media read: ${endpoint}`);return structuredClone(fixture[endpoint]);};
 let now=0,pauses=0;
 const options={read,now:()=>now,pause:async ms=>{now+=ms;pauses++;},timeout:10000};
 // Run 35509493844: stale list configuration, completed CURRENT target, same
 // singleton assigned new bytes but inactive. This is assignment, not playback.
 const active=await mediaActive(expected,env,options);assert.equal(active.application,'application');assert.equal(active.rollout,rollout.id);assert.equal(active.assignedInstance,'singleton');assert.equal(pauses,0);
 assert(endpoints.includes('containers/applications/application/rollouts/current-rollout'));assert.equal(endpoints.filter(p=>p==='containers/applications').length,2);
 for(const fault of ['wrong-version','wrong-version-response','ambiguous-traffic','wrong-namespace','changed-limit','wrong-account','missing-preview-secret','wrong-preview-account','wrong-rollout','failed-rollout','wrong-instance','ambiguous-instance']) {
  const unsafe=async endpoint=>{const r=await read(endpoint);
   if(fault==='wrong-version'&&endpoint.includes('/versions/'))r.annotations['workers/message']='wrong';
   if(fault==='wrong-version-response'&&endpoint.includes('/versions/'))r.id='another';
   if(fault==='ambiguous-traffic'&&endpoint.endsWith('/deployments'))r.deployments[0].versions[0].percentage=50;
   if(fault==='wrong-namespace'&&Array.isArray(r))r[0].durable_objects.namespace_id='other';
   if(fault==='changed-limit'&&Array.isArray(r))r[0].max_instances=2;
   if(fault==='wrong-account'&&Array.isArray(r))r[0].account_id='other';
   if(fault==='missing-preview-secret'&&endpoint.includes('/versions/'))r.resources.bindings=r.resources.bindings.filter(b=>b.name!=='CLOUDFLARE_STREAM_API_TOKEN');
   if(fault==='wrong-preview-account'&&endpoint.includes('/versions/'))r.resources.bindings.find(b=>b.name==='CLOUDFLARE_ACCOUNT_ID').text='other-account';
   if(fault==='wrong-rollout'&&endpoint.includes('/rollouts/'))r.id='historical';
   if(fault==='failed-rollout'&&endpoint.includes('/rollouts/'))r.status='failed';
   if(fault==='wrong-instance'&&endpoint.endsWith('/instances'))r.instances[0].application_id='other';
   if(fault==='ambiguous-instance'&&endpoint.endsWith('/instances'))r.instances.push({...r.instances[0],id:'other'});
   return r;
  };
  let waited=false;
  await assert.rejects(mediaActive(expected,env,{...options,read:unsafe,pause:async()=>{waited=true;throw Error('Unexpected wait');}}));
  assert.equal(waited,false,`${fault} must fail without waiting`);
 }
 for(const fault of ['incomplete','wrong-target','partial-distribution','wrong-version','incomplete-step','missing-distribution','wrong-image','missing-instance','stale-detail']) {
  const unsafe=async endpoint=>{const r=await read(endpoint);
   if(endpoint.includes('/rollouts/')) {
    if(fault==='incomplete')r.status='progressing';
    if(fault==='wrong-target')r.target_configuration.image='other';
    if(fault==='partial-distribution')r.progress.version_distribution.target_version_percentage=50;
    if(fault==='wrong-version')r.target_version=3;
    if(fault==='incomplete-step')r.steps[0].status='running';
    if(fault==='missing-distribution')delete r.progress.version_distribution;
   }
   if(endpoint.endsWith('/instances')) {
    if(fault==='wrong-image')r.instances[0].image='old-image';
    if(fault==='missing-instance')r.instances=[];
   }
   if(fault==='stale-detail'&&endpoint==='containers/applications/application')r.configuration.image='old-image';
   return r;
  };
  const began=now;await assert.rejects(mediaActive(expected,env,{...options,read:unsafe}),/did not converge/);assert.equal(now-began,10000);
 }
 for(const fault of ['rollout','worker']) {
  let snapshots=0;
  await assert.rejects(mediaActive(expected,env,{...options,read:async endpoint=>{const r=await read(endpoint);
   if(endpoint===(fault==='rollout'?'containers/applications':'workers/scripts/bitbi-private-media/deployments')&&++snapshots===2){if(fault==='rollout')r[0].active_rollout_id='replacement';else r.deployments[0].id='replacement';}return r;
  }}),/superseded/);
 }
 // A completed historical rollout must never be searched/accepted in place of
 // a current incomplete one, even when list/detail/instance already match.
 let pending=true;
 await mediaActive(expected,env,{...options,read:async endpoint=>{const r=await read(endpoint);if(endpoint.includes('/rollouts/')&&pending)r.status='progressing';return r;},pause:async ms=>{now+=ms;pending=false;}});
 for(const count of [0,1]) {
  await mediaActive(expected,env,{...options,read:async endpoint=>{const r=await read(endpoint);
   if(endpoint==='containers/applications'){delete r[0].active_rollout_id;r[0].configuration.image=expected.imageDigest;r[0].instances=count;}
   if(endpoint==='containers/applications/application')r.instances=count;
   if(endpoint.endsWith('/instances')&&!count)r.instances=[];
   assert(!endpoint.includes('/rollouts/'),'First creation must not search past rollouts');return r;
  }});
 }
 await assert.rejects(mediaActive(expected,env,{...options,read:async endpoint=>{const r=await read(endpoint);
  if(endpoint==='containers/applications')delete r[0].active_rollout_id;
  assert(!endpoint.includes('/rollouts/'),'Missing current pointer cannot use historical success');return r;
 }}),/did not converge/);
 assert.deepEqual(await currentMediaVersion(async()=>{throw Error('Cloudflare read failed (404)');}),{});
 assert.deepEqual(await currentMediaVersion(async()=>({deployments:[]})),{});
 for(const code of [401,403,429,500])await assert.rejects(currentMediaVersion(async()=>{throw Error(`Cloudflare read failed (${code})`);}));
 assert.equal((await currentMediaVersion(read)).id,'version');
 await assert.rejects(currentMediaVersion(async endpoint=>{if(endpoint.endsWith('/deployments'))return {deployments:[{versions:[{version_id:'missing',percentage:100}]}]};throw Error('Cloudflare read failed (404)');}));
 const actions=[];await activateMedia(expected,{currentVersion:version,deploy:async()=>actions.push('deploy'),verify:async()=>actions.push('verify')});assert.deepEqual(actions,['verify']);
 actions.length=0;await activateMedia(expected,{currentVersion:{},deploy:async()=>actions.push('deploy'),verify:async()=>actions.push('verify')});assert.deepEqual(actions,['deploy','verify']);
 await assert.rejects(activateMedia(expected,{currentVersion:version,deploy:async()=>{},verify:async()=>{throw Error('not converged');}}),/not converged/);
 console.log('Container rollout: observed stale-list success, current target/distribution/assignment, bounded convergence, first creation, supersession and partial-deploy resume controls passed.');
}

{
 const {backendContinuationSupported}=await import('./lib/backend-continuation.mjs');
 const {advanceBackend,verifyAiActivation,activateAuthVersion}=await import('./lib/backend-publication.mjs');
 const plan=createReleasePlanFromRepo(repoRoot,{files:['js/shared/grok-text-contract.mjs','workers/ai/src/routes/text.js','workers/ai/src/lib/grok-chat.js','workers/auth/src/routes/canvas.js','js/pages/canvas/main.js']});
 assert(backendContinuationSupported(plan));assert(plan.workerDeploys.some(w=>w.worker==='ai'));assert(plan.workerDeploys.some(w=>w.worker==='auth'));
 const sha='a'.repeat(40),previousMedia='b'.repeat(40),id='12345678-1234-1234-1234-123456789abc';
 const receipt={sha,version:id,deployment:'deployment-ai'};
 const version={annotations:{'workers/message':`bitbi-ai:${sha}`},resources:{bindings:[{name:'AI',type:'ai'},{name:'SERVICE_AUTH_REPLAY',type:'durable_object_namespace'},{name:'AI_SERVICE_AUTH_SECRET',type:'secret_text'},{name:'ENABLE_GROK_4_6',text:'true'}]}};
 const deployment={id:receipt.deployment,versions:[{version_id:id,percentage:100}]};
 const read=async endpoint=>endpoint.endsWith('/deployments')?{deployments:[deployment]}:version;
 await verifyAiActivation(receipt,sha,read);
 for(const invalid of [{...receipt,sha:previousMedia},{...receipt,version:'wrong'},{...receipt,deployment:'stale'}])await assert.rejects(verifyAiActivation(invalid,sha,read));
 for(const failure of [null,'ai']) {
   const order=[];
   const operation=advanceBackend({sha,pending:[],activeVersion:{},assertCurrent:async()=>{},assertSchema:async()=>order.push('schema'),prepareAi:async()=>{order.push('ai');if(failure)throw Error('AI activation failed');},deploy:async()=>order.push('auth'),readActive:async()=>order.push('verify-auth')});
   if(failure){await assert.rejects(operation);assert.deepEqual(order,['schema','ai']);}else{await operation;assert.deepEqual(order,['schema','ai','auth','verify-auth']);}
 }
 const commands=[];await activateAuthVersion({sha,mediaSourceSha:previousMedia,secretFile:'/private/fixture.json',assertCurrent:async()=>{},command:args=>{commands.push(args);return `Worker Version ID: ${id}`;}});
 assert(commands[0].includes(`PRIVATE_MEDIA_SOURCE_SHA:${previousMedia}`));assert(!commands[0].includes(`PRIVATE_MEDIA_SOURCE_SHA:${sha}`));
}

// The additive Canvas lifecycle uses the existing ordered backend continuation.
{
 const {backendContinuationSupported}=await import('./lib/backend-continuation.mjs');
 const files=['workers/auth/migrations/0090_add_canvas_private_outputs.sql','config/release-compat.json','workers/auth/src/lib/canvas-media-storage.js','workers/auth/src/routes/canvas.js','workers/ai/src/lib/invoke-ai.js','js/shared/grok-imagine-image-2-pricing.mjs','js/pages/canvas/main.js'];
 const plan=createReleasePlanFromRepo(repoRoot,{files});
 assert(backendContinuationSupported(plan));
 assert.deepEqual(plan.workerDeploys.map(w=>w.worker),['ai','auth']);
 assert.equal(plan.schemaApplies[0].latestMigration,JSON.parse(fs.readFileSync(path.join(repoRoot,'config/release-compat.json'))).release.schemaCheckpoints.auth.latest);
 assert(!plan.workerDeploys.some(w=>w.worker==='media'));
 assert(!backendContinuationSupported(createReleasePlanFromRepo(repoRoot,{files:[...files,'workers/ai/wrangler.jsonc']})));
 console.log('Canvas private outputs: additive schema, existing AI → Auth continuation, unchanged media and unreviewed config denial passed.');
}

{
 const {ensurePrivateVideoLogging}=await import('./lib/backend-publication.mjs');
 const initial={logpush:false,tags:['retained'],observability:{enabled:true,logs:{enabled:true,invocation_logs:true,persist:true},traces:{enabled:false}}};
 let state=structuredClone(initial),writes=0;
 const read=async()=>structuredClone(state),patch=async body=>{writes++;assert.deepEqual(Object.keys(body),['observability']);state.observability=body.observability;};
 await ensurePrivateVideoLogging({read,patch});assert.equal(writes,1);assert.equal(state.observability.logs.invocation_logs,false);
 await ensurePrivateVideoLogging({read,patch});assert.equal(writes,1,'Already-safe settings are not rewritten');
 await ensurePrivateVideoLogging({read,verifyOnly:true});
 await assert.rejects(ensurePrivateVideoLogging({read:async()=>initial,verifyOnly:true}),/logging remains enabled/);
 await assert.rejects(ensurePrivateVideoLogging({read:async()=>initial,patch:async()=>{throw Error('denied');}}),/denied/);
 await assert.rejects(ensurePrivateVideoLogging({read:async()=>initial,patch:async()=>{}}),/logging remains enabled/);
 console.log('Private video upload privacy: pre-activation readback, no-op reuse, denied/ineffective update and final receipt guard passed.');
}

// The H3 task adapter extends the reviewed AI service only; no media image or schema change.
{
 const {backendContinuationSupported}=await import('./lib/backend-continuation.mjs');
 const plan=createReleasePlanFromRepo(repoRoot,{files:['workers/ai/src/routes/video-task.js','workers/ai/src/lib/invoke-ai-video.js','workers/auth/src/lib/minimax-h3-callback.js','workers/auth/src/routes/ai/video-generate.js','js/shared/minimax-h3.mjs','js/pages/generate-lab/main.js']});
 assert(backendContinuationSupported(plan));assert.deepEqual(plan.workerDeploys.map(w=>w.worker),['ai','auth']);assert.equal(plan.schemaApplies.length,0);
 assert(!backendContinuationSupported(createReleasePlanFromRepo(repoRoot,{files:[...plan.changedFiles,'workers/ai/src/routes/unknown.js']})));
}

{
 const {mediaSmoke,mediaEvidenceRun}=await import('./lib/media-publication.mjs');
 const originalFetch=globalThis.fetch,keys=['REPAIR_SOURCE_SHA','CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID'];
 const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]])),calls=[];let reads=0;
 try {
  process.env.REPAIR_SOURCE_SHA='a'.repeat(40);process.env.CLOUDFLARE_API_TOKEN='synthetic';process.env.CLOUDFLARE_ACCOUNT_ID='c'.repeat(32);
  globalThis.fetch=async(url,init={})=>{
   if(String(url).endsWith('/instances')){reads++;return Response.json({success:true,result:{instances:[{id:'instance',status:{state:reads===1?'inactive':'running',exit_code:0}}]}});}
   assert.equal(url,'https://bitbi.ai/api/internal/homepage/hero-videos/private-media/smoke');
   const body=JSON.parse(init.body);calls.push(body);assert.equal(body.fixtureSha,'a'.repeat(40));assert.equal(body.sha,'b'.repeat(40));
   return Response.json({ok:true,data:body.action==='retry-reference'?{accepted:true}:{ready:false,failed:true,code:'media_smoke_reference_terminal'}});
  };
  await assert.rejects(mediaSmoke({sha:'b'.repeat(40),plan:{changedFiles:[]}},'synthetic',{application:'app'}),/media_smoke_reference_terminal/);
  assert.deepEqual(calls.map(c=>c.action),['retry-reference','result'],'Terminal failure exits immediately, no reseeding or polling');
  assert.deepEqual(mediaEvidenceRun({REPAIR_SOURCE_SHA:'old',GITHUB_RUN_ID:'new-run',GITHUB_RUN_ATTEMPT:'2',CANDIDATE_RUN:'old-run',CANDIDATE_ATTEMPT:'1'}),{run:'new-run',attempt:'2'});
 }finally{globalThis.fetch=originalFetch;for(const k of keys)if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k];}
 console.log('Repair smoke: exact existing fixture, no reseeding, terminal fail-fast and fresh image run/attempt passed.');
}

{
 const {backendContinuationSupported}=await import('./lib/backend-continuation.mjs');
 const files=['workers/auth/migrations/0094_model_pricing.sql','config/release-compat.json','workers/auth/src/lib/model-tariffs.js','workers/auth/src/routes/model-pricing.js','js/shared/model-tariff.mjs','js/shared/model-pricing-catalog.mjs','js/pages/admin/model-pricing.js'];
 const plan=createReleasePlanFromRepo(repoRoot,{files});
 assert(backendContinuationSupported(plan));assert.deepEqual(plan.workerDeploys.map(w=>w.worker),['ai','auth']);assert.equal(plan.schemaApplies[0].latestMigration,'0094_model_pricing.sql');
 assert(!plan.workerDeploys.some(w=>w.worker==='media'));
 assert.equal(plan.deploySteps[0].type,'schema-checkpoint');assert.equal(plan.deploySteps.at(-1).type,'static');
 console.log('Pricing: additive 0094 before AI/Auth and exact static artifact; unchanged media excluded.');
}
