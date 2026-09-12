import fs from 'node:fs';
import path from 'node:path';
import { prepareBuild, createRuntime } from './environment.mjs';
import { safeError } from './assertions.mjs';
import { runMemberGenerationTests } from '../../member-generation-runtime.mjs';
import { runNativeTests } from '../../q2-runtime-native.mjs';
import { runReferenceTests } from '../../q2-runtime-references.mjs';
import { runRecoveryTests } from '../../q2-runtime-recovery.mjs';
import { runStreamTests } from '../../q4-runtime-stream.mjs';
import { runMemoryTests } from '../../q4-runtime-memory.mjs';
import { runVideoTests } from '../../q4-runtime-video.mjs';
import { runSubscriptionTests } from '../../q4-runtime-subscription.mjs';

import { runPublicVideoTests } from '../../q4-runtime-public-video.mjs';

export const runtimeSuites = Object.freeze([
  ['member-generation', runMemberGenerationTests, {q4Control:'member-generation-control.mjs'}],
  ['native', runNativeTests, {}], ['references', runReferenceTests, { referenceOnly: true }], ['recovery', runRecoveryTests, { restricted: true }],
  ['q4-public-video', runPublicVideoTests, {}],
  ['q4-stream', runStreamTests, { restricted: true }],
  ['q4-memory', runMemoryTests, { restricted: true, q4Control: 'q4-memory-control.mjs' }],
  ['q4-video', runVideoTests, { restricted: true, q4Control: 'q4-video-control.mjs' }],
  ['q4-subscription', runSubscriptionTests, { restricted: true }],
].map(([name, run, options]) => Object.freeze([name, run, Object.freeze(options)])));

// Local-only entry. The CI/operator wrapper must additionally deny non-loopback
// networking at OS level for native children (sandbox-exec / network namespace).
// Miniflare outbound denial and sanitized bindings are defense in depth, not an
// invented attestation of that external OS boundary.
export async function runQ2Runtime(args) {
let artifactParent;
if (args.length) {
  if (args.length !== 2 || args[0] !== '--artifacts') throw new Error('Usage: node scripts/test-q2-runtime.mjs [--artifacts <outside-repository-directory>]');
  artifactParent = args[1];
}
let build;
const reports = [];
try {
  build = prepareBuild(artifactParent);
  for (const [name, run, options] of runtimeSuites) {
    const report = { suite: name, records: [], metrics: [], trace: [], failure: null };
    let runtime;
    try {
      runtime = await createRuntime(build, name, options);
      runtime.metrics = report.metrics; runtime.trace = report.trace;
      runtime.test = async (testName, operation) => {
        runtime.stage = testName;
        await operation();
        report.records.push({ name: testName, status: 'PASS' });
        process.stdout.write(JSON.stringify({ suite: name, ...report.records.at(-1) }) + '\n');
      };
      await run(runtime);
    } catch (error) {
      report.failure = { stage: runtime?.stage || 'runtime_start', ...safeError(error) };
      process.exitCode = 1;
    } finally {
      if (runtime) {
        report.counters = runtime.counters;
        try { await runtime.close(); } catch (error) { report.failure ||= { stage: 'dispose', ...safeError(error) }; process.exitCode = 1; }
      }
    }
    reports.push(report);
    fs.writeFileSync(path.join(build.workDir, `${name}-result.json`), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  }
} catch (error) {
  reports.push({ suite: 'build', failure: safeError(error), records: [] }); process.exitCode = 1;
} finally { build?.esbuild.stop(); }
const result = { passed: reports.reduce((sum, report) => sum + report.records.length, 0), failedSuites: reports.filter(report => report.failure).length,
  workDir: build?.workDir || null, provenance: build?.provenance || null, reports,
  scope: 'Current local Wrangler build and repository SQL in native workerd/D1/R2/DO. No deployment/live/provider/realTLS, old invocation drain, queue retention or old-A rollback claim.' };
if (build) fs.writeFileSync(path.join(build.workDir, 'result.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
// Input hashes are retained in the artifact; keep terminal output concise.
process.stdout.write(JSON.stringify({ passed: result.passed, failedSuites: result.failedSuites, workDir: result.workDir,
  failures: reports.filter(report => report.failure).map(({ suite, failure }) => ({ suite, ...failure })) }) + '\n');

}
