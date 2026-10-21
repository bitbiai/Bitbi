import {requiresPrivateMediaImage} from './ci-test-selection.mjs';
import {EXPORT_DELIVERY_BROWSER_POLICY,verifyExportDeliveryBrowserReport} from './canvas-export-browser.mjs';
import {EXPORT_DELIVERY_PREFLIGHT,EXPORT_DELIVERY_SELECTION_PREFLIGHT,EXPORT_DELIVERY_DISCOVERY_PREFLIGHT,EXPORT_DELIVERY_HOSTING_PREFLIGHT,EXPORT_DELIVERY_SDK_PREFLIGHT,EXPORT_DELIVERY_BROWSER_PREFLIGHT,exportDeliveryCorrectionProfile,assertExportDeliveryTree,assertExportDeliverySelectionTree,exportDeliveryPrefix,exportDeliverySelectionPrefix,verifyExportDeliveryReuse} from './canvas-export-release.mjs';
import {READINESS_CONTINUATION,assertReadinessTree,STORED_PLAN_CONTINUATION,assertStoredPlanTree} from './local-release-browser.mjs';
import {canvasReadinessRecoveryInventory} from '../../tests/helpers/q2-runtime/canvas-readiness-recovery.mjs';
import {canvasSettlementContinuationInventory,canvasSettlementRecoveryRetainedInventory,canvasSettlementRecoveryInventory} from '../../tests/helpers/q2-runtime/canvas-policy-tail.mjs';
import {canvasNotificationControlInventory,canvasNotificationControlDiscoveryCount,canvasNotificationControlDiscoveryHash,canvasPolicyPrefix,canvasPolicyTailInventory} from '../../tests/helpers/q2-runtime/canvas-policy-tail.mjs';
// Local execution is trusted only through authenticated repository-writer
// transport, exact committed inputs and complete command/report/candidate hashes.
// It does not grant environment approval or authorize a production write.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { LOCAL_POLICY, selectedCommands, validationPlan, sha256, commandRuntimes, nativeBrowserKey } from './local-release-plan.mjs';
import { environmentInputs, environmentKey, toolchainPins } from './local-release-environment.mjs';
import { gitSelection, tree, verifyManifest, verifyProofs, candidateProof, proofJobs, REPOSITORY } from '../pages-candidate.mjs';
import { verifyFrontend } from './frontend-hosting.mjs';
import { browserRows } from './browser-fixture-repair.mjs';
import { INCIDENT_BROWSER_PREFLIGHT,incidentBrowserAffectedTitles,RELIABILITY_BROWSER_PREFLIGHT,reliabilityBrowserAffectedTitles,reliabilityBrowserRetryTitles,modelBrowserRetained,passedBrowserCase, ASSISTANT_BROWSER_PREFLIGHT, SETTLEMENT_BROWSER_PREFLIGHT, AUTONOMY_BROWSER_WORKER_PROGRESS, isAutonomyBrowserWorkerProgress, AUTONOMY_BROWSER_DOC_PROGRESS, isAutonomyBrowserDocProgress, AUTONOMY_BROWSER_PROGRESS, isAutonomyBrowserProgress, AUTONOMY_BROWSER_POLICY, AUTONOMY_BROWSER_PREFLIGHT, assertAutonomyBrowserTree, verifyAutonomyBrowserReport, verifyAutonomyImageReuse, MODEL_BROWSER_POLICY, MODEL_BROWSER_PREFLIGHT, verifyModelBrowserReport, LOCAL_BROWSER_POLICY, readMigrationBrowserPool, SMOOTH_BROWSER_POLICY, SMOOTH_BROWSER_CONTINUATION, EXAMPLE_CACHE_CONTINUATION, WORKSPACE_CONTINUATION, AUDIO_FIT_CONTINUATION, INSPECTOR_CONTINUATION,EXPORT_BROWSER_CONTINUATION, smoothProfile, isSmoothContinuation, assertSmoothContinuationTree, verifySmoothBrowserReport, restoreSmoothBrowserProof } from './local-release-browser.mjs';
export {INCIDENT_BROWSER_PREFLIGHT,RELIABILITY_BROWSER_PREFLIGHT,ASSISTANT_BROWSER_PREFLIGHT,SETTLEMENT_BROWSER_PREFLIGHT,AUTONOMY_BROWSER_WORKER_PROGRESS,AUTONOMY_BROWSER_DOC_PROGRESS,AUTONOMY_BROWSER_PROGRESS,AUTONOMY_BROWSER_PREFLIGHT,MODEL_BROWSER_PREFLIGHT} from './local-release-browser.mjs';

export const LOCAL_REQUIRED_JOBS = { 'release-compatibility': [
  'Preflight complete static release plan', 'Select tests from changed files',
  'Verify local release evidence and candidate bytes', 'Upload immutable candidate build',
] };
export const LOCAL_IMPORT_REPAIR = Object.freeze({
  source:'e637dce9b775d3ebb39fad8e3de0396b064c3a36',
  workflow:'7db39e78c84654e4ff0c5fb5434ebca371d0ded7fef2dca9fb9fa1826f686134',
  evidence:'19f68bf54dcc33f75d0ab519c0e57ca13751d76ad8a1882828e059a4794bb737',
  manifest:'9e103aee168dfd6f47d6533b6d16a9493f37d067a8fb5efad2940cc31e6a53f9',
  contractLog:'210230e351867cda65c454a613854b68fafa526f384c4bb8c12a9ee25e7c104c',
  transport:'e9842950b4eef16554d55c734aad02d1d01040affb9987454896e475def27993',
});
export function assertImportRepairWorkflow(before,after) {
  assert.equal(sha256(before),LOCAL_IMPORT_REPAIR.workflow,'Unknown original import workflow');
  const expected=before.replace('  release-compatibility:\n',
    '  release-compatibility:\n    # Owner-approved draft evidence access; all other jobs keep their own rights.\n    permissions:\n      contents: write\n      actions: read\n      deployments: read\n')
    .replace('      - name: Install dependencies\n        run: npm ci\n','      - name: Install dependencies\n        run: npm ci --ignore-scripts\n');
  assert.equal(after,expected,'Only the reviewed import-job permission/install correction may inherit evidence');
}
export function localRepairCommand(head) {
  const workflow='.github/workflows/static.yml';
  const before=gitBytes(['show',`${LOCAL_IMPORT_REPAIR.source}:${workflow}`]).toString();
  const after=gitBytes(['show',`${head}:${workflow}`]).toString();
  if(after===before)return 'npm run test:local-release -- --repair-only';
  assertImportRepairWorkflow(before,after);
  return 'npm run test:local-release -- --import-repair-only';
}
export function verifyImportRepairEvidence(directory,head) {
  gitBytes(['merge-base','--is-ancestor',LOCAL_IMPORT_REPAIR.source,head]);
  const files=gitBytes(['diff','--name-only',LOCAL_IMPORT_REPAIR.source,head]).toString().trim().split('\n').filter(Boolean);
  assert(files.every(file=>repairTooling.has(file)||file==='.github/workflows/static.yml'||file==='scripts/lib/local-release-transport.mjs'),'Import repair changed product/test/toolchain inputs');
  assert.equal(sha256(gitBytes(['show',`${head}:scripts/lib/local-release-transport.mjs`])),LOCAL_IMPORT_REPAIR.transport,'Unreviewed import transport change');
  const read=(name,hash)=>{
    const bytes=fs.readFileSync(path.join(directory,'reuse/test-results',name));
    assert.equal(sha256(bytes),hash,`Changed permission-repair source evidence: ${name}`);return bytes;
  };
  const original=JSON.parse(read('import-source-evidence.json',LOCAL_IMPORT_REPAIR.evidence));
  const manifest=JSON.parse(read('import-source-manifest.json',LOCAL_IMPORT_REPAIR.manifest));
  read('import-source-contract.log',LOCAL_IMPORT_REPAIR.contractLog);
  assert.equal(original.sha,LOCAL_IMPORT_REPAIR.source);assert.equal(original.status,'passed');
  assert.equal(original.commands[18].exitCode,0);assert.equal(original.commands[18].logHash,LOCAL_IMPORT_REPAIR.contractLog);
  assert.equal(manifest.sha,original.sha);
  return {original,manifest};
}
export function localPolicyAt(sha) {
  if (!/^[a-f0-9]{40}$/.test(sha || '')) return false;
  try { return execFileSync('git', ['show', `${sha}:config/release-validation.yml`], { encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }).includes('version: 1'); }
  catch { return false; }
}
export function verifyNativeBrowserEnvironment(record,root='.') {
  assert(record,'Missing native user-media browser preparation');
  assert.equal(record.policy,'native-browser-v1');assert.equal(record.platform,'darwin/arm64');
  const pins=toolchainPins(root);
  assert.equal(record.node,pins.node);assert.equal(record.playwright,pins.playwright);
  assert.match(record.kernel,/^\d+\.\d+\.\d+$/);
  const inputs=Object.fromEntries(Object.entries(environmentInputs(root)).filter(([file])=>file.endsWith('package.json')||file.endsWith('package-lock.json')));
  inputs['tests/fixtures/media/test-video.mp4']=sha256(fs.readFileSync(path.join(root,'tests/fixtures/media/test-video.mp4')));
  assert.deepEqual(record.inputs,inputs,'Changed native dependencies or decoder fixture');
  assert.deepEqual(record.binaries.map(item=>item.name),['chromium','chromium-headless-shell','webkit','ffmpeg','ffprobe']);
  for(const binary of record.binaries)assert.match(binary.hash,/^[a-f0-9]{64}$/);
  assert.equal(record.key,nativeBrowserKey(record),'Changed native runtime identity');
  const browsers=JSON.parse(fs.readFileSync(path.join(root,'node_modules/playwright-core/browsers.json'))).browsers;
  for(const name of ['chromium','webkit']) {
    assert.equal(record.capabilities?.[name]?.version,browsers.find(browser=>browser.name===name).browserVersion);
    assert.equal(record.capabilities[name].h264Decoded,true,`Missing decoded user-media prerequisite: ${name}`);
  }
  for(const name of ['ffmpeg','ffprobe'])assert.match(record.mediaTools?.[name]||'',new RegExp(`^${name} version \\d+\\.`));
  assert(Number.isFinite(Date.parse(record.verifiedAt)),'Missing native preparation timestamp');
}
export function verifyNativeLocalReports(directory, log, {preflight=false}={}) {
  const references=log.split('\n').flatMap(line=>{
    try { const value=JSON.parse(line);return value.q2LinuxEvidence ? [value.q2LinuxEvidence] : []; }
    catch {return [];}
  });
  assert(references.length>0,'Missing executed native Linux report');
  for(const reference of references) {
    assert.match(reference,/^\/tmp\/bitbi-release\/q2-runtime-evidence\/[A-Za-z0-9_./-]+$/);
    assert(!reference.split('/').includes('..'));
    const folder=path.join(directory,'runtime',reference.slice('/tmp/bitbi-release/'.length));
    const read=name=>JSON.parse(fs.readFileSync(path.join(folder,name)));
    const launcher=read('launcher-result.json');
    assert.equal(launcher.origin,LOCAL_POLICY);assert.equal(launcher.status,0);assert.equal(launcher.failure,null);
    assert.equal(launcher.childBoundaryVerified,true);assert.deepEqual(launcher.postcheckFailures,[]);
    assert.equal(launcher.mode,preflight?'preflight':'runtime');
    for(const file of ['isolation-result.json','isolation-final.json'])assert.equal(read('reports/'+file).passed,true);
    if(!preflight) {
      const reports=fs.readdirSync(path.join(folder,'reports')).filter(name=>name==='result.json'||name.endsWith('__result.json'));
      assert.equal(reports.length,1,'Missing/ambiguous native execution result');
      const result=read('reports/'+reports[0]);
      assert.equal(result.failedSuites,0);assert(result.passed>0);
      assert(result.reports.every(suite=>!suite.failure && suite.records.length>0 && suite.records.every(row=>row.status==='PASS')));
      assert.equal(result.passed,result.reports.reduce((sum,suite)=>sum+suite.records.length,0));
    }
  }
}
// Closed continuation of the first local Linux migration run. The failed command
// remains failed in its original checkpoint. Only its verified passing cases and
// commands with unchanged inputs can be retained; the FFmpeg/native tail is fresh.
export const LOCAL_WORKER_REPAIR = Object.freeze({
  source: 'a918c74933980ea20e1265e33914498fcf6ddcca',
  checkpoint: 'a9f47581f1101dba0fd3682da24bf2d58a32ef3f4f330f6baf1db8ca6428975c',
  log: 'bb76d028242fe8495038f95212c8c4480d490fc000dc65ddbddae56866403ca5',
  lastRun: '44c1511bd0dbe12bdc363f4172de481b71b8a59fd6d3e9ef80d108a14a977742',
  discovery: '47ff91445f1b653623b9f3d3c9b7f2545a471ce14be9f9358f9e70f2f2f62d11',
  progress: 'f361eac86ea39088f32c788931ad69c5b376b5a8',
  progressReport: '5550b01be1886957c94e34f71a92a522156a92f0972e76b772d147b0ba0645f9',
  progressReceipt: 'a5d430fe4365cfed8d8e0b1ac1885736a65170fb7a5e13add80863707fe682c8',
  corrected: '0e078f74eb85b73b7d5f413deb8f5291d8b1d3c5',
  correctedReport: '5492305521021af2ffaa243dbae5feb254f320fcc917728d22b6ce0f6edbfd9d',
  correctedReceipt: '44d0453864c2a5d7cc285c8a77ace471fbc0bb329afbe3dcf9f2bb81f742f05a',
  nativeSource:'b1efd966923876520ec5b1a69e896203f7d56c12',
  nativeCheckpoint:'c8f2f3b1f83106169d21ec0ab6bc405c5cafc430436c6205721588401b2f38c3',
  nativeLog:'52e3de550b9f7ad24f78802f7afadcacd965c6b9248214ef23a97889f33250e7',
  manifest:'050e0629fbae7721fb97cb4f89cabd374263cbc23e17fb7c9ab2ea620daeccf4',
  frontendProof:'39780d92a6e1046bdad051f28154bafcd5177c57639a3ba726984fbc78cb6b49',
  coreSource:'8c471701860db3a07b08224f676589b10a1103cc',
  coreCheckpoint:'53903614dccdce7864296187c108921ad2e034cd7c43a91da56a007dc8e69cc6',
  functionalReport:'8b23a73b88974644b54bf4306d3fd56e2cafc8b1c9eb12edfec76f19560f3685',
  functionalDiscovery:'8127969d0a51d7a513c17bf679c05bd06dd5a14470e241def4e8a78371c0a959',
  frontendLog:'05b095f36934fdc0c876ed9b8f4a5142c03b4b9e4a0fc176da7912b0bda5e786',
  tailSource:'ed7a7d6a6084b79aabcff903f7cc66698f8e0c86',
  tailCheckpoint:'38f1757fa3b5e8134c65b5c89f11cbcd06c8495461cd99b6b29a1395c797a29f',
  tailLog:'a4905f85e7c5c5a3c19f37a8c30479f35f5459c617ebd4e4d34ebae52e2ac114',
  specs: {
    'scripts/lib/local-release-transport.mjs':LOCAL_IMPORT_REPAIR.transport,
    'scripts/test-frontend-hosting.mjs':'b55a18f11e17cb3846098dd81ee2940e0d616458b90a8297615c08e8c10bbf30',
    'scripts/lib/frontend-hosting.mjs':'c007308e23e210302fd1d2c6e864fb6cb032445cfb9a66f3b3d7924b6d7180fe',
    'tests/smoke.spec.js':'9163a19228e9cc1deec52ba824b07f3c0d95b1a73fa844fc9f394db82422ebe4',
    'js/pages/generate-lab/main.js':'ab851f5fb287503f137aecd324e6eb0b77fa92aa2b83a0e6bd863365df5a3267',
    'tests/auth-admin.spec.js':'53f92668d3233a8581d564ba4c2b0a5050d483b50bd4ede259e61d7bd1d65948',
    'tests/helpers/model-help-contract.cjs':'1477ed43927165b514bfeea6df1864d92f5e6e4cee8ae8f2f819ee539c5df7f5',
    'tests/locale.spec.js':'3935284793e20a98275e5708a17f317bc3f3faa20232b5934d73427680b1c589',
    'tests/oma2-q1-member.spec.js':'2383a1772442878b3a6deb2efc147fa620ea69866c034140a3faea1930e04ef9',
    'tests/oma2-q3-model-pricing.spec.js':'bdbf1735402063d0ba3d123d14b7ab4a6a58110cac71fd6ef44cde098749d9e9',
    'tests/oma2-q3-model-status.spec.js':'509b6e12eaf929fbaa1849540878058a63b588c89d77582ac185f9f823ddf206',
    'tests/oma2-q3-workflows.spec.js':'c27c6b3a5422749539b7e82c5417594eafc638898a0b882f0f17fe0dbdc5183b',
    'scripts/test-q2-runtime-launcher.mjs':'195741c2c1decc256225dcdcc2b3dbd64e9bee37439661544a1c00d45617badc',
    'tests/admin-model-status.spec.js':'7c0a013cff629249a73148363f9304322e07c4c635b5bbf0c8ac00d12c4c8a64',
    'tests/appearance.spec.js':'4344d83d6712d4348b5b37db72e2bee024684891ff74a6eaa8c033890cc0d4e4',
    'tests/workers.spec.js':'e4bff15e0ce29398175e7d88e007029e853c7fb90751e7a766d0e1bcc3e0133d',
  },
});
export const LOCAL_REPAIR_REFRESH = new Set([0,3,4,13,18,32,33,35,42]);
export const LOCAL_CORE_REUSE = new Set([43,44,46,47]);
export const LOCAL_HOMEPAGE_REPORTS = ['homepage-functional.json','homepage-discovery.json'];
export function verifyRetainedHomepageReports(directory) {
  for(const [index,name]of LOCAL_HOMEPAGE_REPORTS.entries())assert.equal(
    sha256(fs.readFileSync(path.join(directory,'test-results',name))),
    LOCAL_WORKER_REPAIR[index===0?'functionalReport':'functionalDiscovery'],
    `Missing/changed retained homepage report: ${name}`);
}
export function verifyRetainedFrontendLog(log,proof) {
  assert.equal(sha256(log),LOCAL_WORKER_REPAIR.frontendLog,'Changed original runtime log');
  // The original proof preceded the final already-asserted HTTP response log.
  // Preserve both immutable records, including that exact late diagnostic.
  assert.equal(log.slice(3023),'[wrangler:info] GET /api/me 301 Moved Permanently (2ms)\n');
  assert.equal(proof.tests,28);
  assert.equal(proof.reportHash,sha256(JSON.stringify({tests:28,log:log.slice(0,3023)})));
}
const repairTooling = new Set(['scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs','scripts/lib/local-release-plan.mjs','scripts/test-local-release.mjs',
  'scripts/lib/local-release-browser.mjs','scripts/pages-candidate.mjs','scripts/lib/ci-test-selection.mjs',
  'AGENTS.md','docs/production-readiness/MAIN_ONLY_RELEASE_RUNBOOK.md','docs/runbooks/REGRESSION_REGISTER.md']);
const gitBytes=(args)=>execFileSync('git',args,{stdio:['ignore','pipe','pipe'],maxBuffer:64*1024*1024});
// Closed continuation of the first ordinary local release after the approved
// import permission change. No product, dependency, workflow or test scope may
// change; the original failed hosting check remains failed and executes fresh.
export const PERMISSION_CONTINUATION=Object.freeze({
  source:'e4ca9f58705166dfacfaf0851d2f9e550523b784',
  checkpoint:'bb41b8fbd37f02ad1577a201c14797742a5b0fb9c080ec094665a82f291d217a',
  review:'043124e8a6424338b71d3f8e40a053050173d39897eb7216c760159eaa9f0f01',
  tail:'c5f7535cc5169aa5517cfb222ac1e2619cf322df',tailCheckpoint:'28a18e79412e421ccd45bcca49d5099a35c61c0040698411c82d6952524489ac',
  tailLog:'25ca0e1b60ecf644630e7dabb19ae078b0ab869e3d63ffb6270cae3a642abf1f',
  manifest:'17888ff6905d96e22e351413df20df733950812efe6659ec1134650a902517b9',
  proof:'7ecb38a572c271104cb4fb6457b0aa0229d7a68a2642474ce9bf215c6d121457',
});
export const CANVAS_STAGE_CASES=['default native runtime plan stages every actual suite and control input','Canvas reference fixture reads the staged bytes from a non-repository cwd'];
export function canvasStageContinuation(command) {
  assert(command.includes('node scripts/test-q2-runtime.mjs --suite canvas-audio'));
  const prior='node --test tests/q2-recovery-staging.test.mjs scripts/test-q2-runtime-launcher.mjs';assert(command.includes(prior));
  // A callback keeps the regex's dollar/quote literal; String replacement text
  // would interpret $' as the entire remaining shell program.
  return command.replaceAll(prior,()=>`node --test --test-name-pattern='^(${CANVAS_STAGE_CASES.join('|')})$' scripts/test-q2-runtime-launcher.mjs`);
}
export const PERMISSION_REFRESH=new Set([0,2,3,4,7,12,17,28,29,33,34,35]);
export const SMOOTH_REFRESH=new Set([...PERMISSION_REFRESH,14,44]);
export const permissionRefresh=sha=>sha===EXAMPLE_CACHE_CONTINUATION.source?new Set([0,2,3,12,17,23,34,40,41]):sha===EXPORT_BROWSER_CONTINUATION.source?new Set([0,2,3,12,17,23,29,33,34,35,44]):sha===WORKSPACE_CONTINUATION.source?new Set([0,2,3,4,7,12,14,15,16,17,23,29,33,34,35,44]):sha===INSPECTOR_CONTINUATION.source?new Set([0,2,3,4,7,12,14,17,23,29,33,34,35,40,41]):sha===AUDIO_FIT_CONTINUATION.source?new Set([0,2,3,4,7,12,14,17,29,33,34,35,44]):sha===SMOOTH_BROWSER_CONTINUATION.completed?new Set([0,2,3,4,7,12,14,17,29,33,34,35,44,46]):sha===SMOOTH_BROWSER_CONTINUATION.accepted?new Set([0,2,3,4,12,17,33,34,35,44]):sha===SMOOTH_BROWSER_CONTINUATION.progress?new Set([0,2,3,4,12,14,17,29,33,34,35,44]):isSmoothContinuation(sha)?SMOOTH_REFRESH:PERMISSION_REFRESH;
export function assertPermissionContinuationTree(head,read=gitBytes,{smooth=false,source}={}) {
  if(smooth){assertSmoothContinuationTree(head,read,{source});return;}
  const p=PERMISSION_CONTINUATION;
  read(['merge-base','--is-ancestor',p.source,head]);
  const allowed=new Set(['scripts/test-frontend-review.mjs','scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs','scripts/test-local-release.mjs',
    'docs/production-readiness/MAIN_ONLY_RELEASE_RUNBOOK.md','docs/runbooks/REGRESSION_REGISTER.md','tests/helpers/q2-runtime/linux-hosted.mjs','scripts/test-q2-runtime-launcher.mjs']);
  const files=read(['diff','--name-only',p.source,head]).toString().trim().split('\n').filter(Boolean);
  assert(files.length&&files.every(file=>allowed.has(file)),'Permission continuation changed product, workflow, scope or dependency inputs');
  assert.equal(sha256(read(['show',`${head}:scripts/test-frontend-review.mjs`])),p.review,'Unreviewed hosting permission assertion');
  for(const [file,hash] of Object.entries({'tests/helpers/q2-runtime/linux-hosted.mjs':'b251234f00c50e3519287cf584ca742515075f42ce3ba5e15fbaa30ab5af4efb','scripts/test-q2-runtime-launcher.mjs':'b6eb66ffccad62b1fc2b35e236e43c15d2f7f892df6547b2b935aef0df5212e8'}))
    if(files.includes(file))assert.equal(sha256(read(['show',`${head}:${file}`])),hash,'Unreviewed isolated-stage correction');
}
export function permissionContinuationPrefix(bytes,{head,base,planHash,environment,commands}) {
  const p=PERMISSION_CONTINUATION;
  const original=JSON.parse(bytes);
  const completed=original.sha===SMOOTH_BROWSER_CONTINUATION.completed,accepted=original.sha===SMOOTH_BROWSER_CONTINUATION.accepted,progress=original.sha===SMOOTH_BROWSER_CONTINUATION.progress,smooth=isSmoothContinuation(original.sha),tail=original.sha===p.tail,last=completed?47:accepted?46:progress?29:smooth?(smoothProfile(original.sha).last??45):tail?41:36;
  assert.equal(sha256(bytes),completed?SMOOTH_BROWSER_CONTINUATION.completedCheckpoint:accepted?SMOOTH_BROWSER_CONTINUATION.acceptedCheckpoint:progress?SMOOTH_BROWSER_CONTINUATION.progressCheckpoint:smooth?smoothProfile(original.sha).checkpoint:tail?p.tailCheckpoint:p.checkpoint,'Changed original failed permission checkpoint');
  assert.equal(original.sha,completed?SMOOTH_BROWSER_CONTINUATION.completed:accepted?SMOOTH_BROWSER_CONTINUATION.accepted:progress?SMOOTH_BROWSER_CONTINUATION.progress:smooth?smoothProfile(original.sha).source:tail?p.tail:p.source);assert.equal(original.status,completed?'passed':'failed');assert.equal(original.commands.length,completed?47:progress?46:last+1);
  assert(original.commands.slice(0,last).every(row=>row.exitCode===0));if(!completed)assert.equal(original.commands[last].exitCode,1);
  if(!completed)assert.equal(original.commands[last].command.name,accepted?'Confirm tested browser candidate bytes':progress?'Check documentation currentness':smooth?'Run selected auth and admin tests':tail?'Run worker route tests':'Check frontend hosting package');
  assert.equal(original.base,base);assert.equal(original.planHash,planHash);assert.equal(original.environment.key,environment.key);
  for(const [i,row] of original.commands.entries())if(row)assert.deepEqual(JSON.parse(JSON.stringify(row.command).replaceAll(original.sha,head)),commands[i],'Changed selected command');
  return original;
}
function verifyPermissionContinuation(directory,evidence,commands) {
  const p=PERMISSION_CONTINUATION,completed=evidence.permissionContinuation.source===SMOOTH_BROWSER_CONTINUATION.completed,accepted=evidence.permissionContinuation.source===SMOOTH_BROWSER_CONTINUATION.accepted,progress=evidence.permissionContinuation.source===SMOOTH_BROWSER_CONTINUATION.progress,smooth=isSmoothContinuation(evidence.permissionContinuation.source);assertPermissionContinuationTree(evidence.sha,gitBytes,{smooth,source:evidence.permissionContinuation.source});
  const tail=evidence.permissionContinuation.source===p.tail;
  assert.deepEqual(evidence.permissionContinuation,{source:completed?SMOOTH_BROWSER_CONTINUATION.completed:accepted?SMOOTH_BROWSER_CONTINUATION.accepted:progress?SMOOTH_BROWSER_CONTINUATION.progress:smooth?smoothProfile(evidence.permissionContinuation.source).source:tail?p.tail:p.source,checkpoint:completed?SMOOTH_BROWSER_CONTINUATION.completedCheckpoint:accepted?SMOOTH_BROWSER_CONTINUATION.acceptedCheckpoint:progress?SMOOTH_BROWSER_CONTINUATION.progressCheckpoint:smooth?smoothProfile(evidence.permissionContinuation.source).checkpoint:tail?p.tailCheckpoint:p.checkpoint});assert(!evidence.repair);
  const original=permissionContinuationPrefix(fs.readFileSync(path.join(directory,'reuse/test-results/permission-checkpoint.json')),{...evidence,head:evidence.sha,commands});
  for(const [i,row] of evidence.commands.entries()) {
    if(i<(completed?47:accepted?46:smooth?(smoothProfile(original.sha).last??45):tail?41:36)&&original.commands[i]?.exitCode===0&&!permissionRefresh(original.sha).has(i)) {
      assert.equal(row.reusedFrom,original.commands[i].reusedFrom||original.sha);
      assert.deepEqual({...row,command:original.commands[i].command,reusedFrom:undefined},{...original.commands[i],reusedFrom:undefined},'Changed retained passing execution');
      assert.equal(sha256(fs.readFileSync(path.join(directory,row.log))),original.commands[i].logHash);
    }else assert(!row.reusedFrom&&(!row.continuation||tail&&i===41),'Affected or unexecuted command cannot inherit a pass');
  }
  if(smooth) {
    if(original.sha===EXAMPLE_CACHE_CONTINUATION.source)assert.equal(sha256(fs.readFileSync(path.join(directory,'reuse/example-asset-pass.log'))),EXAMPLE_BROWSER_PREFLIGHT.assetLog,'Missing retained decoded GIF acceptance');
    const raw=fs.readFileSync(path.join(directory,'reuse/smooth-browser.json'));assert.equal(sha256(raw),smoothProfile(original.sha).report);
    const report=JSON.parse(fs.readFileSync(path.join(directory,'test-results/candidate-auth.json')));
    assert.deepEqual(report.previous,browserRows(JSON.parse(raw)));
    for(const [profile,key,file] of [[smoothProfile(original.sha).browserProgress,'progress','smooth-progress.json'],[smoothProfile(original.sha).browserAccepted,'accepted','smooth-accepted-cases.json']])
      if(profile){const bytes=fs.readFileSync(path.join(directory,'reuse',file));assert.equal(sha256(bytes),profile.report);assert.deepEqual(report[key],{sha:profile.sha,rows:browserRows(JSON.parse(bytes))});}
    if(report.fresh.length)assert.deepEqual(report.fresh,browserRows(JSON.parse(fs.readFileSync(path.join(directory,'test-results/smooth-fresh.json')))));
    else assert(smoothProfile(original.sha).browserAccepted,'Missing fresh browser execution');
    verifySmoothBrowserReport(report,evidence.sha);if(accepted||completed)restoreSmoothBrowserProof(directory,{sha:evidence.sha,verifyOnly:true});restoreCanvasHostingProof(directory,{verifyOnly:true});
  }
  if(tail) {
    const before=fs.readFileSync(path.join(directory,'reuse/stage-failed.log'),'utf8');assert.equal(sha256(before),p.tailLog);
    assert.equal(evidence.commands[41].continuation,canvasStageContinuation(commands[41].run));
    verifyNativeCaseUnion(tapResults(before),tapResults(fs.readFileSync(path.join(directory,'logs/41.log'),'utf8')),CANVAS_STAGE_CASES);
    restoreCanvasHostingProof(directory,{verifyOnly:true});
  }
}
export function restoreCanvasHostingProof(directory,{verifyOnly=false}={}) {
  const preflight=path.join(directory,'reuse/preflight-checkpoint.json');
  const permission=path.join(directory,'reuse/test-results/permission-checkpoint.json');
  const checkpoint=fs.existsSync(permission)?permission:preflight;
  const source=fs.existsSync(checkpoint)?JSON.parse(fs.readFileSync(checkpoint)).sha:null;
  const p=source===INCIDENT_BROWSER_PREFLIGHT.source?{...INCIDENT_BROWSER_PREFLIGHT,tail:source}:source===ASSISTANT_BROWSER_PREFLIGHT.source?{...ASSISTANT_BROWSER_PREFLIGHT,tail:source}:source===ASSISTANT_NATIVE_RATE.source?{...ASSISTANT_NATIVE_RATE,tail:source}:source===ASSISTANT_NATIVE_TAIL.source?{...ASSISTANT_NATIVE_TAIL,tail:source}:source===ASSISTANT_NATIVE_PROGRESS.source?{...ASSISTANT_NATIVE_PROGRESS,tail:source}:source===ASSISTANT_NATIVE_PREFLIGHT.source?{...ASSISTANT_NATIVE_PREFLIGHT,tail:source}:source===SETTLEMENT_BROWSER_PREFLIGHT.source?{...SETTLEMENT_BROWSER_PREFLIGHT,tail:source}:source===SETTLEMENT_NATIVE_PROGRESS.source?{...SETTLEMENT_NATIVE_PROGRESS,tail:source}:source===SETTLEMENT_NATIVE_PREFLIGHT.source?{...SETTLEMENT_NATIVE_PREFLIGHT,tail:source}:source===CANVAS_POLICY_NATIVE_PREFLIGHT.source?{...CANVAS_POLICY_NATIVE_PREFLIGHT,tail:source}:source===CANVAS_POLICY_WORKER_PREFLIGHT.source?{...CANVAS_POLICY_WORKER_PREFLIGHT,tail:source}:source===AUTONOMY_BROWSER_PREFLIGHT.source?{...AUTONOMY_BROWSER_PREFLIGHT,tail:source}:source===AUTONOMY_NATIVE_PREFLIGHT.source?{...AUTONOMY_NATIVE_PREFLIGHT,tail:source}:source===MODEL_BROWSER_PREFLIGHT.source?{...MODEL_BROWSER_PREFLIGHT,tail:source}:source===EXAMPLE_BROWSER_PREFLIGHT.source?{...EXAMPLE_BROWSER_PREFLIGHT,tail:source}:[EXAMPLE_CACHE_CONTINUATION.source,EXPORT_BROWSER_CONTINUATION.source,WORKSPACE_CONTINUATION.source,AUDIO_FIT_CONTINUATION.source,INSPECTOR_CONTINUATION.source].includes(source)?{...smoothProfile(source),tail:source}:PERMISSION_CONTINUATION,read=(file,hash)=>{const bytes=fs.readFileSync(path.join(directory,'reuse',file));assert.equal(sha256(bytes),hash);return JSON.parse(bytes);};
  const original=read('hosting-manifest.json',p.manifest),oldProof=read('hosting-proof.json',p.proof);
  const manifest=JSON.parse(fs.readFileSync(path.join(directory,'candidate/manifest.json')));
  verifyMigrationCandidateBytes(directory,original,manifest,{allowLabGuard:false,workspaceRepair:source===WORKSPACE_CONTINUATION.source});assert.deepEqual(manifest.hosting,original.hosting);
  const proof={...oldProof,manifestHash:sha256(JSON.stringify(manifest)),reusedFrom:{sha:p.tail,manifestHash:oldProof.manifestHash}};
  if(verifyOnly)assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory,'candidate/proof-frontend-runtime.json'))),proof);
  else fs.writeFileSync(path.join(directory,'candidate/proof-frontend-runtime.json'),JSON.stringify(proof));
}
export function assertLocalRepairTree(head) {
  const p=LOCAL_WORKER_REPAIR;
  gitBytes(['merge-base','--is-ancestor',p.corrected,head]);
  const changed=gitBytes(['diff','--name-only',p.source,head]).toString().trim().split('\n').filter(Boolean);
  assert(changed.every(file=>repairTooling.has(file)||Object.hasOwn(p.specs,file)||file==='.github/workflows/static.yml'), 'Changed product/toolchain/shared fixture cannot inherit local passes');
  if(changed.includes('.github/workflows/static.yml'))localRepairCommand(head);
  for(const [file,hash] of Object.entries(p.specs))assert.equal(sha256(gitBytes(['show',`${head}:${file}`])),hash,'Changed fixture outside the closed repair');
  const before=gitBytes(['show',`${p.source}:js/pages/generate-lab/main.js`]).toString();
  const after=gitBytes(['show',`${head}:js/pages/generate-lab/main.js`]).toString();
  assert.equal(after.replace('    // Concurrent UI triggers may have awaited the same pricing refresh.\n    if (state.busy) return;\n',''),before,'Product reuse permits only the verified concurrent-waiter guard');
}
export function parseDiscovery(text) {
  // The original --list stderr contains Node's SQLite warning. Preserve the raw
  // artifact and parse only Playwright's JSON payload; do not invent run results.
  const start=text.indexOf('{\n  "config"');assert(start>=0,'Missing Playwright discovery JSON');
  return JSON.parse(text.slice(start));
}
export function workerDiscovery(report) {
  const rows=[];
  const visit=(suite,parents=[])=>{
    for(const spec of suite.specs||[])for(const test of spec.tests||[]) {
      assert.equal(test.projectName,'');
      rows.push({id:spec.id,file:spec.file,title:spec.title,label:`tests/${spec.file}:${spec.line}:${spec.column} › ${[...parents,spec.title].join(' › ')}`});
    }
    for(const child of suite.suites||[])visit(child,[...parents,child.title]);
  };
  for(const suite of report.suites)visit(suite);
  assert(rows.length>0&&new Set(rows.map(row=>row.id)).size===rows.length,'Empty/duplicate Worker discovery');
  return rows;
}
export function workerListResults(log,discovery) {
  const byLabel=new Map(discovery.map(row=>[row.label,row]));assert.equal(byLabel.size,discovery.length);
  const results=new Map();
  for(const line of log.split('\n')) {
    const match=line.match(/^\s+([✓✘])\s+\d+\s+(tests\/.*?)\s+\([\d.]+(?:ms|s|m)\)(.*)$/);
    if(!match)continue;
    // A completed reporter record may share its line with concurrent Auth
    // structured logging. Accept only one complete, typed JSON log object;
    // arbitrary text, truncated JSON and foreign logger records remain errors.
    if(match[3].trim()){
      const event=JSON.parse(match[3]);
      assert(event&&!Array.isArray(event)&&typeof event==='object'&&event.service==='bitbi-auth'
        &&typeof event.ts==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(event.ts)
        &&['debug','info','warn','error'].includes(event.level)
        &&typeof event.component==='string'&&/^[a-z0-9_-]{1,100}$/.test(event.component)
        &&typeof event.event==='string'&&/^[a-z0-9_-]{1,100}$/.test(event.event),'Unrecognized trailing Worker log record');
    }
    const retry=match[2].match(/ \(retry #(\d+)\)$/),label=match[2].replace(/ \(retry #\d+\)$/,'');
    const row=byLabel.get(label);assert(row,`Undiscovered Worker result: ${label}`);
    const runs=results.get(row.id)||[],attempt=retry?Number(retry[1]):0;
    assert(!runs.some(result=>result.retry===attempt),'Duplicate Worker result attempt');
    runs.push({status:match[1]==='✓'?'passed':'failed',retry:attempt});results.set(row.id,runs);
  }
  assert.equal(results.size,discovery.length,'Missing executed Worker case');
  return discovery.map(row=>({...row,results:results.get(row.id)}));
}
const passedOnce=row=>row.results?.length===1&&row.results[0].status==='passed'&&row.results[0].retry===0&&!row.results[0].error;
export function verifyWorkerUnion({previous,discovery,progress,corrected}) {
  const keys=rows=>rows.map(row=>row.id).sort();
  for(const rows of [previous,discovery,progress,corrected])assert.equal(new Set(keys(rows)).size,rows.length,'Duplicate Worker case');
  assert.deepEqual(keys(previous),keys(discovery),'Required Worker discovery changed');
  const originalFailed=previous.filter(row=>!passedOnce(row));
  assert.deepEqual(keys(progress),keys(originalFailed),'All original failures require fresh progress evidence');
  const pending=progress.filter(row=>!passedOnce(row));
  assert.deepEqual(keys(corrected),keys(pending),'Only unresolved Worker cases may execute again');
  for(const row of corrected)assert(passedOnce(row),'Corrected Worker case failed/skipped/retried');
  for(const row of [...progress,...corrected]) {
    const original=previous.find(other=>other.id===row.id);assert(original);
    assert.equal(row.file,original.file);assert.equal(row.title,original.title);
  }
  for(const row of discovery) {
    const original=previous.find(other=>other.id===row.id);
    assert.equal(row.file,original.file);assert.equal(row.title,original.title);
  }
  return {originalPassed:previous.length-originalFailed.length,progressPassed:progress.length-pending.length,correctedPassed:corrected.length,total:discovery.length};
}
function executedWorkers(report) {
  const rows=browserRows(report);
  return rows.map(row=>({...row,id:row.key.slice(1),results:row.results.map(result=>({...result,error:result.error||row.expectedStatus!=='passed'||row.status!=='expected'}))}));
}
export function verifyLocalWorkerRepair(directory,head,{discoveryFile=path.join(directory,'test-results/worker-discovery.json')}={}) {
  assertLocalRepairTree(head);
  const p=LOCAL_WORKER_REPAIR,root=path.join(directory,'reuse');
  const pinned=(file,hash)=>{const bytes=fs.readFileSync(path.join(root,file));assert.equal(sha256(bytes),hash,`Changed original repair evidence ${file}`);return bytes.toString();};
  const original=JSON.parse(pinned('checkpoint.json',p.checkpoint));
  assert.equal(original.sha,p.source);assert.equal(original.status,'failed');assert.equal(original.commands.length,43);
  assert(original.commands.slice(0,42).every(row=>row.exitCode===0));assert.equal(original.commands[42].exitCode,1);
  const log=pinned('worker.log',p.log),last=JSON.parse(pinned('last-run.json',p.lastRun));
  const before=workerDiscovery(parseDiscovery(pinned('original-discovery.json',p.discovery)));
  assert.match(log,/Running 1408 tests using 1 worker/);assert.match(log,/\n\s+4 failed\n/);assert.match(log,/\n\s+1404 passed \(1\.8m\)/);
  const previous=workerListResults(log,before);assert.equal(previous.length,1408);
  assert.deepEqual(previous.filter(row=>!passedOnce(row)).map(row=>row.id).sort(),last.failedTests.sort());assert.equal(last.status,'failed');
  const progress=executedWorkers(JSON.parse(pinned('progress.json',p.progressReport)));
  const corrected=executedWorkers(JSON.parse(pinned('corrected.json',p.correctedReport)));
  for(const [name,sha,hash] of [['progress',p.progress,p.progressReceipt],['corrected',p.corrected,p.correctedReceipt]]) {
    const receipt=JSON.parse(pinned(`${name}-receipt.json`,hash));assert.equal(receipt.sha,sha);assert.equal(receipt.image,original.environment.image);
    gitBytes(['merge-base','--is-ancestor',sha,head]);
  }
  const tail=JSON.parse(pinned('tail-checkpoint.json',p.tailCheckpoint));
  assert.equal(tail.sha,p.tailSource);assert.equal(tail.status,'failed');assert.equal(tail.commands[42].exitCode,1);
  const tailLog=pinned('tail.log',p.tailLog);
  assert.match(tailLog,/Private video reference FFmpeg: .*passed\./);
  assert.match(tailLog,/# pass 25\n# fail 2\n# cancelled 0\n# skipped 0/);
  assert.deepEqual(tapResults(tailLog).filter(row=>row.status!=='passed').map(row=>row.title),NATIVE_REPAIRED_CASES);
  const discovery=workerDiscovery(parseDiscovery(fs.readFileSync(discoveryFile,'utf8')));
  const result=verifyWorkerUnion({previous,discovery,progress,corrected});
  assert.deepEqual(result,{originalPassed:1404,progressPassed:3,correctedPassed:1,total:1408});
  return {original,result};
}
export function localWorkerContinuation() {
  const script=JSON.parse(fs.readFileSync('package.json')).scripts['test:workers'];
  assert.equal(script,'node scripts/check-media-tools.mjs && npm run test:website-assistant && node scripts/check-q4-selection.mjs && playwright test -c playwright.workers.config.js && npm run test:homepage-ffmpeg-processor && npm run test:q2-runtime','Worker chain changed');
  assert.equal(JSON.parse(fs.readFileSync('package.json')).scripts['test:q2-runtime'],'node --test tests/q2-recovery-staging.test.mjs scripts/test-q2-runtime-launcher.mjs && node scripts/test-q2-runtime.mjs');
  return 'PLAYWRIGHT_JSON_OUTPUT_NAME= npx playwright test -c playwright.workers.config.js --list --reporter=json > .local-release/test-results/worker-discovery.json\nnode scripts/local-release.mjs verify-worker-repair .local-release\n'+
    `node --test --test-name-pattern='^(${NATIVE_REPAIRED_CASES.join('|')})$' scripts/test-q2-runtime-launcher.mjs\nnode scripts/test-q2-runtime.mjs`;

}
export const NATIVE_REPAIRED_CASES=['existing Worker gates retain native suite, fail early and upload only after execution','native artifact paths use runner context only after runner assignment'];
export function tapResults(log) {
  return log.split('\n').flatMap(line=>{const match=line.match(/^(ok|not ok) \d+ - (.*?)(?: # (SKIP|TODO).*)?$/);return match?[{title:match[2],status:match[3]?'skipped':match[1]==='ok'?'passed':'failed'}]:[];});
}
export function verifyNativeCaseUnion(before,after,required=NATIVE_REPAIRED_CASES) {
  assert.equal(before.length,27);assert.equal(new Set(before.map(row=>row.title)).size,27);
  assert.deepEqual(before.filter(row=>row.status!=='passed').map(row=>row.title),required);
  const executed=after.filter(row=>row.status!=='skipped');
  assert.deepEqual(executed.map(row=>row.title),required);
  assert(executed.every(row=>row.status==='passed'),'Corrected launcher contract failed');
  assert(after.every(row=>before.some(old=>old.title===row.title)),'Foreign launcher test result');
  assert.equal(new Set(after.map(row=>row.title)).size,after.length,'Duplicate launcher result');
}
export function verifyLocalReuse(directory,evidence) {
  const {original}=verifyLocalWorkerRepair(directory,evidence.sha);
  const coreBytes=fs.readFileSync(path.join(directory,'reuse/core-checkpoint.json'));
  assert.equal(sha256(coreBytes),LOCAL_WORKER_REPAIR.coreCheckpoint);
  const core=JSON.parse(coreBytes);assert.equal(core.sha,LOCAL_WORKER_REPAIR.coreSource);
  assert.equal(core.environment.key,evidence.environment.key);
  assert.equal(core.nativeBrowsers.key,evidence.nativeBrowsers.key);
  verifyRetainedHomepageReports(directory);
  const nativeBytes=fs.readFileSync(path.join(directory,'reuse/native-checkpoint.json'));
  assert.equal(sha256(nativeBytes),LOCAL_WORKER_REPAIR.nativeCheckpoint);
  const native=JSON.parse(nativeBytes);assert.equal(native.sha,LOCAL_WORKER_REPAIR.nativeSource);assert.equal(native.commands[42].exitCode,0);
  assert.equal(evidence.commands[42].reusedFrom,native.sha);assert.equal(evidence.commands[42].logHash,LOCAL_WORKER_REPAIR.nativeLog);
  assert.equal(evidence.commands[42].logHash,native.commands[42].logHash);assert.equal(evidence.commands[42].durationMs,native.commands[42].durationMs);
  assert.deepEqual(native.environment.inputs,evidence.environment.inputs);
  verifyNativeCaseUnion(tapResults(fs.readFileSync(path.join(directory,'reuse/tail.log'),'utf8')),tapResults(fs.readFileSync(path.join(directory,evidence.commands[42].log),'utf8')));
  assert.equal(evidence.repair?.source,original.sha);assert.equal(evidence.repair?.checkpoint,LOCAL_WORKER_REPAIR.checkpoint);
  assert.equal(evidence.base,original.base);assert.equal(evidence.startedAt,original.startedAt);
  assert.deepEqual(evidence.environment.inputs,original.environment.inputs);
  assert.equal(evidence.environment.image,original.environment.image);
  assert.equal(evidence.planHash,original.planHash);
  const repairCommand=localRepairCommand(evidence.sha);
  assert.equal(evidence.commands[18].supplement,repairCommand);
  if(repairCommand.endsWith('--import-repair-only')) {
    const source=verifyImportRepairEvidence(directory,evidence.sha);
    assert.equal(evidence.repair.importSource,source.original.sha);
    assert.equal(evidence.repair.importEvidence,LOCAL_IMPORT_REPAIR.evidence);
  }
  assert.equal(sha256(fs.readFileSync(path.join(directory,'reuse/local-contract.log'))),original.commands[18].logHash);
  const oldSelection={...original.selection},newSelection={...evidence.selection};
  // The retained Worker fixture file also selects independent Auth browser
  // acceptance under the unchanged selector. That new downstream job must run.
  assert.equal(oldSelection.auth,false);assert.equal(newSelection.auth,true);oldSelection.auth=true;
  assert.equal(oldSelection.homepage,false);assert.equal(newSelection.homepage,true);oldSelection.homepage=true;
  for(const selection of [oldSelection,newSelection]){delete selection.files;delete selection.reasons;}
  assert.deepEqual(oldSelection,newSelection,'Changed selected scope cannot reuse local commands');
  for(const [index,result] of evidence.commands.entries()) {
    const prior=original.commands[index];
    if(index===42){assert.equal(result.continuation,localWorkerContinuation());continue;}
    if(LOCAL_CORE_REUSE.has(index)) {
      const saved=core.commands[index];assert.equal(saved.exitCode,0);
      assert.equal(result.reusedFrom,core.sha);assert.equal(result.logHash,saved.logHash);
      assert.equal(result.durationMs,saved.durationMs);
      assert.deepEqual(result.command,JSON.parse(JSON.stringify(saved.command).replaceAll(core.sha,evidence.sha)));
      continue;
    }
    if(LOCAL_REPAIR_REFRESH.has(index)||index>=43){assert(!result.reusedFrom,'Changed-input check requires fresh execution');continue;}
    assert.equal(result.reusedFrom,original.sha,'Missing original command identity');
    assert.equal(result.exitCode,0);assert.equal(prior.exitCode,0);
    assert.equal(result.logHash,prior.logHash);assert.equal(result.durationMs,prior.durationMs);
    assert.deepEqual(result.command,JSON.parse(JSON.stringify(prior.command).replaceAll(original.sha,evidence.sha)),'Changed retained command');
  }
  const oldManifest=JSON.parse(fs.readFileSync(path.join(directory,'reuse/manifest.json')));
  assert.equal(sha256(fs.readFileSync(path.join(directory,'reuse/manifest.json'))),LOCAL_WORKER_REPAIR.manifest);
  const manifest=JSON.parse(fs.readFileSync(path.join(directory,'candidate/manifest.json')));
  verifyMigrationCandidateBytes(directory,oldManifest,manifest);
  if(evidence.repair.importSource) {
    const source=verifyImportRepairEvidence(directory,evidence.sha);
    verifyMigrationCandidateBytes(directory,source.manifest,manifest,{allowLabGuard:false});
  }
  assert.deepEqual(manifest.hosting,oldManifest.hosting,'Changed frontend runtime cannot reuse a proof');
  const proof=JSON.parse(fs.readFileSync(path.join(directory,'candidate/proof-frontend-runtime.json')));
  const oldProof=JSON.parse(fs.readFileSync(path.join(directory,'reuse/proof-frontend-runtime.json')));
  assert.equal(sha256(fs.readFileSync(path.join(directory,'reuse/proof-frontend-runtime.json'))),LOCAL_WORKER_REPAIR.frontendProof);
  assert.deepEqual(proof,{...oldProof,manifestHash:sha256(JSON.stringify(manifest)),reusedFrom:{sha:original.sha,manifestHash:oldProof.manifestHash}});
  verifyProofs(oldManifest,[oldProof]);
}

export function verifyMigrationCandidateBytes(directory,oldManifest,manifest,{allowLabGuard=true,workspaceRepair=false}={}) {
  assert.deepEqual(Object.keys(manifest.files),Object.keys(oldManifest.files),'Candidate membership changed');
  const oldToken=oldManifest.sha.slice(0,12),newToken=manifest.sha.slice(0,12);
  for(const [file,hash]of Object.entries(oldManifest.files)) {
    const bytes=fs.readFileSync(path.join(directory,'candidate/site',file));
    assert.equal(sha256(bytes),manifest.files[file],'Final candidate bytes changed');
    if(sha256(bytes)===hash)continue;
    let normalized=bytes.toString().replaceAll(`?v=${newToken}`,`?v=${oldToken}`);
    if(file==='js/pages/admin/ai-lab.js')normalized=normalized.replace(`const ADMIN_AI_UI_VERSION = '${newToken}';`,`const ADMIN_AI_UI_VERSION = '${oldToken}';`);
    if(workspaceRepair&&file==='js/pages/canvas/workspace-view.js') {
      const p=WORKSPACE_CONTINUATION;assert.equal(oldManifest.sha,p.source);
      const reviewed=gitBytes(['show',`${p.reviewedSource}:${file}`]);assert.equal(sha256(reviewed),p.specs[file]);
      assert.equal(bytes.toString(),reviewed.toString().replaceAll('__ASSET_VERSION__',newToken),'Changed workspace repair');
      normalized=gitBytes(['show',`${p.source}:${file}`]).toString().replaceAll('__ASSET_VERSION__',oldToken);
    }
    if(allowLabGuard&&file==='js/pages/generate-lab/main.js')normalized=normalized.replace('    // Concurrent UI triggers may have awaited the same pricing refresh.\n    if (state.busy) return;\n','');
    assert.equal(sha256(normalized),hash,`Unreviewed product/build change: ${file}`);
  }
}

export function verifyLocalEvidence(directory, expected, { now = Date.now(), selection = gitSelection(expected.base, expected.sha) } = {}) {
  const evidence = JSON.parse(fs.readFileSync(path.join(directory, 'evidence.json')));
  assert.equal(evidence.policy, LOCAL_POLICY);
  assert.equal(evidence.repository, REPOSITORY);
  for (const key of ['sha','base']) assert.equal(evidence[key], expected[key], `Local ${key} mismatch`);
  assert.equal(evidence.sourceTree, execFileSync('git', ['rev-parse', `${expected.sha}^{tree}`], { encoding: 'utf8' }).trim());
  assert.equal(evidence.status, 'passed', 'Local acceptance incomplete or failed');
  assert.equal(evidence.planHash, validationPlan().digest, 'Local command contract changed');
  assert.deepEqual(evidence.selection, selection, 'Incomplete unpublished range/selection');
  assert(now >= Date.parse(evidence.completedAt) && now - Date.parse(evidence.startedAt) <= 7 * 86400000, 'Local acceptance stale or future dated');
  assert(Date.parse(evidence.completedAt) >= Date.parse(evidence.startedAt));
  assert.deepEqual(evidence.environment.inputs, environmentInputs(), 'Toolchain/dependency inputs changed');
  assert.equal(evidence.environment.key, environmentKey(evidence.environment.inputs));
  assert.equal(evidence.environment.platform, 'linux/arm64');
  assert.match(evidence.environment.image, /^sha256:[a-f0-9]{64}$/);
  for(const [key,value] of Object.entries(toolchainPins()))assert.equal(evidence.environment[key],value);
  assert.equal(evidence.ci, true); assert.equal(evidence.origin, 'development-mac');
  const env = { GITHUB_SHA: expected.sha, CANDIDATE_BASE: expected.base };
  const commands = selectedCommands(selection, env);
  if(evidence.readinessContinuation)verifyReadinessContinuation(directory,evidence,commands);
  else if(evidence.storedPlanContinuation)verifyStoredPlanContinuation(directory,evidence,commands);
  else if(evidence.preflightContinuation)verifyCanvasPreflight(directory,evidence,commands);
  else if(evidence.permissionContinuation)verifyPermissionContinuation(directory,evidence,commands);
  else if(evidence.repair)verifyLocalReuse(directory,evidence);
  else assert(evidence.commands.every(row=>!row.reusedFrom&&!row.continuation),'Unverified local evidence reuse');
  if(commands.some(command=>commandRuntimes(command).some(part=>part.runtime==='native-browser-v1')))
    verifyNativeBrowserEnvironment(evidence.nativeBrowsers);
  assert.equal(evidence.commands.length, commands.length, 'Missing/extra local commands');
  for (const [index, command] of commands.entries()) {
    const result = evidence.commands[index];
    assert.deepEqual(result.command, command, `Changed local command ${command.name}`);
    assert.equal(result.exitCode, 0, `Local command failed: ${command.name}`);
    const runtimes=commandRuntimes(command).map(part=>part.runtime);
    if(runtimes.includes('native-browser-v1'))assert.deepEqual(result.runtimes,runtimes,'Missing/mismatched browser execution environment');
    if(evidence.repair&&['Run selected auth and admin tests','Run selected homepage core tests'].includes(command.name))assert.equal(result.browserContinuation,LOCAL_BROWSER_POLICY);
    else if(evidence.preflightContinuation?.source===EXPORT_DELIVERY_BROWSER_PREFLIGHT.source&&command.name==='Run selected auth and admin tests')assert.equal(result.browserContinuation,EXPORT_DELIVERY_BROWSER_POLICY);
    else if(evidence.preflightContinuation?.source===AUTONOMY_BROWSER_PREFLIGHT.source&&['Run selected homepage core tests','Run selected auth and admin tests'].includes(command.name))assert.equal(result.browserContinuation,AUTONOMY_BROWSER_POLICY);
    else if((evidence.readinessContinuation||evidence.storedPlanContinuation||[INCIDENT_BROWSER_PREFLIGHT.source,RELIABILITY_BROWSER_PREFLIGHT.source,ASSISTANT_BROWSER_PREFLIGHT.source,SETTLEMENT_BROWSER_PREFLIGHT.source,MODEL_BROWSER_PREFLIGHT.source].includes(evidence.preflightContinuation?.source))&&['Run selected homepage core tests','Run selected auth and admin tests'].includes(command.name))assert.equal(result.browserContinuation,MODEL_BROWSER_POLICY);
    else if(isSmoothContinuation(evidence.permissionContinuation?.source)&&command.name==='Run selected auth and admin tests')assert.equal(result.browserContinuation,SMOOTH_BROWSER_POLICY);
    else assert(!result.browserContinuation,'Unreviewed browser continuation');
    assert(result.durationMs >= 0 && Number.isFinite(result.durationMs));
    assert.equal(result.log, `logs/${index}.log`);
    assert.equal(sha256(fs.readFileSync(path.join(directory, result.log))), result.logHash, 'Missing/changed execution log');
    if(command.name==='Verify native Linux isolation before Worker tests' || /test-q2-runtime|test:workers/.test(command.run)) {
      verifyNativeLocalReports(directory,fs.readFileSync(path.join(directory,result.log),'utf8'),{preflight:command.name==='Verify native Linux isolation before Worker tests'});
    }
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'candidate/manifest.json')));
  assert.equal(manifest.schema, 2, 'Local source manifest must retain its original identity');
  verifyManifest(manifest, { ...expected, selection, run: evidence.id, attempt: '1' }, path.join(directory, 'candidate/site'));
  verifyFrontend(manifest, relative => tree(path.join(directory, relative)), {siteDirectory:path.join(directory,'candidate/site')});
  const proofs = fs.readdirSync(path.join(directory, 'candidate')).filter(file => /^proof-.*\.json$/.test(file)).map(file => JSON.parse(fs.readFileSync(path.join(directory, 'candidate', file))));
  verifyProofs(manifest, proofs);
  assert.equal(proofs.length, proofJobs(selection).length + 1, 'Duplicate/extra local proofs');
  for (const job of proofJobs(selection)) {
    const expectedProof = candidateProof(manifest, { job, reportFile: 'test-results/homepage-functional.json',
      readJson: file => JSON.parse(fs.readFileSync(path.join(directory, file))) });
    assert.deepEqual(proofs.find(proof => proof.job === job), expectedProof, 'Local proof differs from required executed reports');
  }
  if(evidence.repair) {
    const pool=readMigrationBrowserPool(directory);
    for(const scope of ['auth','homepage']) {
      const report=JSON.parse(fs.readFileSync(path.join(directory,`test-results/candidate-${scope}.json`)));
      assert.equal(report.policy,LOCAL_BROWSER_POLICY);assert.deepEqual(report.pool,pool);
      if(report.fresh.length)assert.deepEqual(report.fresh,browserRows(JSON.parse(fs.readFileSync(path.join(directory,`test-results/local-${scope}-fresh.json`)))),'Changed actual browser execution report');
      else assert.equal(report.counts.executed,0,'Retained coverage is not fresh execution');
    }
  }
  const runtimeLog=fs.readFileSync(path.join(directory,'test-results/frontend-runtime.log'),'utf8');
  assert(runtimeLog.length>0,'Missing native frontend runtime evidence');
  const native=proofs.find(proof=>proof.job==='frontend-runtime');
  if(evidence.repair)verifyRetainedFrontendLog(runtimeLog,native);
  else assert.equal(native.reportHash,sha256(JSON.stringify({tests:native.tests,log:runtimeLog})),'Changed native frontend runtime report');
  assert.deepEqual(tree(path.join(directory, 'candidate')), evidence.candidateFiles, 'Changed local candidate/proofs');
  return { evidence, manifest, proofs, digest: sha256(fs.readFileSync(path.join(directory, 'evidence.json'))) };
}

export function rebindLocalCandidate(verified, { run, attempt, receipt }) {
  const { manifest: original, evidence, proofs, digest } = verified;
  assert(/^[1-9]\d*$/.test(String(run)) && /^[1-9]\d*$/.test(String(attempt)));
  const manifest = { ...original, schema: 3, run: String(run), attempt: String(attempt),
    localValidation: { policy: LOCAL_POLICY, digest, receipt, id: evidence.id, manifestHash: sha256(JSON.stringify(original)) } };
  return { manifest, proofs: proofs.map(proof => ({ ...proof, manifestHash: sha256(JSON.stringify(manifest)),
    localValidation: { evidence: digest, originalManifestHash: proof.manifestHash } })) };
}

// A failed preflight has no browser/image/product acceptance to inherit. Retain
// only its unchanged checks; the migration admission and all remaining work run.
export const CANVAS_PREFLIGHT=Object.freeze({source:'cc9010a92a52eeeb53355cadfc5b759c2565d924',checkpoint:'b940595d55f417156672bdc6ef06aeb9a6da9df936c0ec3aee6135d265d5186e',guardProgress:'ce2dcf9af4fceab0103b57bc16a5f27c09209f64ea9e577e73612176b768ef27',guardLog:'53b48f35d020611ff8e4a2e48d725322b7a9dc69de1dfb746fd9ea5f8281d66b',retain:[1,4,5,6,7,8,9,10,11,13,14,15,16,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32]});
export const EXPORT_PREFLIGHT=Object.freeze({source:'4493221379c9737eb470a4fcfd779fafde0ce132',checkpoint:'03a5e299915592e5886062d1ed70c7cb8a1c9ee8e81a6c569435bc1f6a4e06c7',retain:[1,4,5,6,7,8,9,10,11,13,14]});
export const EXPORT_NATIVE_PREFLIGHT=Object.freeze({source:'6e237824ececae944aa4eaaaded13b1538b0fcbe',checkpoint:'44630f8495bee813fb782bef88526908dbf72698525f8d597dfd54bc3e4d98f6',guardLog:'5927bab36495253925156015766f104eb7e688c668fcae2eb6c3e62760d446ba',guardProgress:'d049d7cd8fefacdf8349c7990d82356f6473752435790f05a4bf5697fd14a4af',progressRun:'91d76d89ccea8c2caee616e643c60ab192f8d5b0-a16143b4-483a-408f-b91f-3fd16e82faec',retain:[1,4,5,6,7,8,9,10,11,13,14,16,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32]});
export const EXPORT_MEDIA_PREFLIGHT=Object.freeze({source:'dc29be7a208ec93811ba2deb01815fe7821bda9a',checkpoint:'fa4154127a67a1402f14f3cec008ed63f92fe2d3389d37e34c0fb96957d7cba9',retain:[1,4,5,6,7,8,9,10,11,13,14,16,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,40,41]});
export const EXAMPLE_PREFLIGHT=Object.freeze({source:'f01b86a9c31bedbf7ee86a865dfc68b3d55d4586',checkpoint:'bab4842dcb5f1667b32b430dba8756c48ef645c83f316fa0497f4060ee2aac62',retain:[1,4,5,6,7,8,9,10,11,13,14,15,16]});
// One stale workflow assertion stopped the ordinary preflight before product
// acceptance. Only this direct tooling successor may retain unchanged checks;
// source-sensitive gates, verifier consumers and all unexecuted suites run.
export const INCIDENT_PREFLIGHT=Object.freeze({
  source:'899e2fa058556b8c0ddcf1e6ac2811c8b9019653',
  checkpoint:'5621bad6ca8acd925f3f09314daceb309ab71a46a4f86d5373d4624529d9ba85',
  failedLog:'d58f4800e0f2e4e282c1f8cb02ebac03d1a659c53f72f8253e36f86847f023a6',
  specs:Object.freeze({'scripts/test-local-release.mjs':'8fcc752ff8b7b8872456834837b87a55f8144f0e2da2095ace53548f4bb96bb2'}),
  retain:Object.freeze([1,4,5,6,7,8,9,10,11,13]),
});
export const EXAMPLE_BROWSER_PREFLIGHT=Object.freeze({source:'39023dadfc72786cf641ecc911cce8b5733120f8',checkpoint:'8396c2799e716cfb68acee6a67be69eaa32b9847f2fee065b7fe09e2695e31d0',manifest:'3888814901cdc0452493fe44dfeebee42196a6dba71cd6906591ad0fab9051e3',proof:'05f4b71df385a0b5e0428eb1f82afe205e2924ac679a2e0ab33e4e52f88c8ba9',assetLog:'719002717e2c040584a2359e09bf0c71c24fe0bef62cc644dfd7ac0bd00122b9',retain:[1,4,5,6,7,8,9,10,11,13,14,15,16,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,35,36,37,38,39]});
export const MODEL_OPERATION_PREFLIGHT=Object.freeze({
  source:'9443369e0780144d2ffeea3900d3b86ccd57bc85',
  checkpoint:'075686750e84a22eedaee8ff466dffc1ae5a11af1756d887cfebb5d7d1b82921',
  failedLog:'4420aeaccd1c699d2ef3e6dea26675065f184a18082c9ea6ad028e5a87bd6647',
  retain:[1,4,5,6,7,8,9,12],
});
// One failed launcher fixture after the complete unchanged Worker and processor
// chain. This direct-successor repair grants no product or test-selection reuse.
export const AUTONOMY_NATIVE_PREFLIGHT=Object.freeze({
  source:'77e48e23cbbe720703b588d3f20d74441f74dd0f',
  checkpoint:'bef1d28963770d5d826bb032290b10a0f1f4080d7a86189f4708c7296a41e6f6',
  failedLog:'0bf2e795dbdfb119f6446440d021be6ae084b2080f3cf9cfd6530a2602cb14be',
  manifest:'d9d3bb7a26e12d05f270c3a1e823b513f11e6e830ee6834808e85ce8fc762b78',
  proof:'32b972956ee2ac1def1f15b68157f76fb29c2abe186f6403cf72069cd5b5a61f',
  hostingLog:'b9a0c3ec6a1a5b6e5d558e606737f0abe878f84602dc525e5e20804f6f2365b1',
  specs:Object.freeze({'scripts/test-q2-runtime-launcher.mjs':'358a85a7798eac2204c73525c4b591db1e8523fed92363e05ae61c2e5d1fabc0',
    'docs/runbooks/REGRESSION_REGISTER.md':'69d06430dba5e2210d84e7f0d3e124344ab82f141d531c8c12810bcb94aef854'}),
  retain:[1,4,5,6,7,8,9,10,11,13,14,15,16,18,19,20,21,22,23,24,25,26,27,30,31,32,33,36,40],
});
const autonomyLauncherCase='Canvas reference fixture reads the staged bytes from a non-repository cwd';
export function verifyAutonomyNativeRepair(directory,head,{allowPending=false}={}) {
  const p=AUTONOMY_NATIVE_PREFLIGHT;assertCanvasPreflightTree(head,gitBytes,p);
  const pinned=(file,hash)=>{const bytes=fs.readFileSync(path.join(directory,'reuse',file));assert.equal(sha256(bytes),hash,`Changed original autonomy evidence: ${file}`);return bytes;};
  const original=JSON.parse(pinned('preflight-checkpoint.json',p.checkpoint));
  assert.equal(original.sha,p.source);assert.equal(original.status,'failed');assert.equal(original.commands.length,42);
  assert(!original.preflightContinuation&&!original.permissionContinuation&&!original.repair,'Unexpected earlier continuation');
  assert(original.commands.slice(0,41).every(row=>row.exitCode===0&&!row.reusedFrom&&!row.continuation));
  assert.equal(original.commands[41].exitCode,1);assert.equal(original.commands[41].logHash,p.failedLog);
  const log=pinned('preflight-failed.log',p.failedLog).toString();
  assert.match(log,/Running 1471 tests using 1 worker/);assert.match(log,/\n\s+1471 passed \(1\.9m\)/);
  const workerLines=log.split('\n').flatMap(line=>{const m=line.match(/^\s+([✓✘])\s+(\d+)\s+(tests\/.*?)\s+\([\d.]+(?:ms|s|m)\)\s*$/);return m?[{status:m[1],number:Number(m[2]),label:m[3]}]:[];});
  assert.equal(workerLines.length,1471);assert.equal(new Set(workerLines.map(row=>row.label)).size,1471);
  assert.deepEqual(workerLines.map(row=>row.number),Array.from({length:1471},(_,i)=>i+1));
  assert(workerLines.every(row=>row.status==='✓'&&!row.label.includes('(retry #')),'Worker acceptance was not a complete first pass');
  const prefix=log.split('Running 1471 tests using 1 worker')[0];
  assert.match(prefix,/# tests 61\n# suites 0\n# pass 61\n# fail 0\n# cancelled 0\n# skipped 0/);
  assert.match(prefix,/Q4 normal Worker discovery:/);assert.match(prefix,/"mediaTools":\{"ffmpeg":"6\.1\.1-3ubuntu5","ffprobe":"6\.1\.1-3ubuntu5"\}/);
  const marker='> test:q2-runtime\n> node --test tests/q2-recovery-staging.test.mjs scripts/test-q2-runtime-launcher.mjs && node scripts/test-q2-runtime.mjs\n';
  assert.equal(log.split(marker).length,2,'Missing exact unexecuted native boundary');
  const [prior,launcher]=log.split(marker);assert(prior.includes('> test:homepage-ffmpeg-processor\n'));
  assert.match(prior,/Private video reference FFmpeg: .*passed\./);
  assert.match(launcher,/# tests 27\n# suites 0\n# pass 26\n# fail 1\n# cancelled 0\n# skipped 0\n# todo 0/);
  assert(!launcher.includes('q2LinuxEvidence'),'The original native tail must remain unexecuted');
  const before=tapResults(launcher);
  assert.equal(before.length,27);assert.equal(new Set(before.map(row=>row.title)).size,27);
  assert.deepEqual(before.filter(row=>row.status!=='passed'),[{title:autonomyLauncherCase,status:'failed'}]);
  if(allowPending)return {original,result:null};
  const fresh=fs.readFileSync(path.join(directory,'test-results/autonomy-launcher-fresh.tap'),'utf8');
  assert.match(fresh,/# pass 1\n# fail 0\n# cancelled 0\n# skipped \d+\n# todo 0/);
  verifyNativeCaseUnion(before,tapResults(fresh),[autonomyLauncherCase]);
  return {original,result:{workerPassed:1471,processorPassed:true,launcherRetained:26,launcherFresh:1,launcherTotal:27}};
}
export function autonomyNativeContinuation(command) {
  const scripts=JSON.parse(fs.readFileSync('package.json')).scripts;
  assert.equal(scripts['test:workers'],'node scripts/check-media-tools.mjs && npm run test:website-assistant && node scripts/check-q4-selection.mjs && playwright test -c playwright.workers.config.js && npm run test:homepage-ffmpeg-processor && npm run test:q2-runtime','Worker chain changed');
  assert.equal(scripts['test:q2-runtime'],'node --test tests/q2-recovery-staging.test.mjs scripts/test-q2-runtime-launcher.mjs && node scripts/test-q2-runtime.mjs','Native chain changed');
  assert.equal(command.split('  npm run test:workers').length,2);assert(command.endsWith('else\n  npm run test:workers\nfi\n'),'Missing complete ordinary Worker branch');
  const fresh=[
    'mkdir -p .local-release/test-results',
    'node scripts/local-release.mjs verify-autonomy-native-pending .local-release',
    `node --test --test-name-pattern='^${autonomyLauncherCase}$' scripts/test-q2-runtime-launcher.mjs > .local-release/test-results/autonomy-launcher-fresh.tap 2>&1 || { status=$?; cat .local-release/test-results/autonomy-launcher-fresh.tap; exit "$status"; }`,
    'cat .local-release/test-results/autonomy-launcher-fresh.tap',
    'node scripts/local-release.mjs verify-autonomy-native-repair .local-release',
    'node scripts/test-q2-runtime.mjs',
  ].map(line=>'  '+line).join('\n');
  return command.replace('  npm run test:workers',()=>fresh);
}
export const MODEL_SELECTION_PREFLIGHT=Object.freeze({
  source:'b71dd6212ee83e9fad0d60a8cf9c03dbaa0087d5',
  checkpoint:'00c88e0722249f029e5e668fdc0bc059839c892f9d5241da62f07422c9c29137',
  failedLog:'d87b51c21ec4b8e1119cd189e883dd6af8fb725813d8cc2c1a9d0c68f494c7ff',
  retain:[1,4,5,6,7,8,9,10,11,12,13,14,15],
});
export const MODEL_WORKFLOW_PREFLIGHT=Object.freeze({
  source:'a56a8baf0a74dfc826e5b8ae884b4022ebf2633d',
  checkpoint:'d8d9811b1520813b751ab85399d5b0d406c2c995212b00b345cdc690c8af0567',
  failedLog:'d40de384b1c3ed3efea311572ac5e3ecfb224a0ca5bbe09925fa3b5fff0d5606',
  retain:[1,4,5,6,7,8,9,10,11,12,13,14,15,16],
});
// Reviewed historical-fixture and exact consent-guard corrections before any
// product suite began. Source-sensitive gates refresh; all product tests run.
export const ASSISTANT_PREFLIGHT=Object.freeze({
  source:'176378274f476d018d7890c8467e1d4242e99476',
  checkpoint:'495e983e62c2ad7478ed7309df51e57faa3915432d961335a776c635c30a047d',
  failedLog:'779ebea94cd6430da13414c6717f7a08326ed81558d3e18e2dcd51c714961dca',
  specs:Object.freeze({
    'scripts/test-local-release.mjs':'400ea9b42f16c24af6cb320bb54853bf3b093c3bf9831fe1f77a758050ef3f8b',
    'workers/auth/src/lib/canvas-agent-conversation-decisions.js':'fcd25278ea4408e04204cdc8dba5bfe4c4b808e7e462815aea6acdacc8292eab',
    'tests/helpers/canvas-conversation-decisions-control.mjs':'a9e159a1d8d2ba3dd4a2f974997341aaa68acfd30831fc468901289cd5790b4c',
    'tests/q2-canvas-conversation-decisions.spec.js':'6d0b8bf3cc5526d610894151d0801074e4c2b70f4885cdce054074a1a9f8d977',
    'tests/helpers/q2-runtime/canvas.mjs':'c0748624de39afb4ad56484c2c2ec832fee6870dc814a84b67650f19cedc34ff',
    'docs/production-readiness/CANVAS_AGENT.md':'04c44f1941f2e67784bf40a2cf523363e5e1aa82bd8f895c88538e4b7c2a0c47',
  }),
  retain:[1,4,5,6,7,8,9,10,11,13,16],
});
export function assistantPreflightGuardContinuation(command) {
  assert.equal(command,'npm run test:local-release','Unexpected assistant preflight guard caller');
  return command+' -- --assistant-preflight-only';
}
// Closed repair of a historical-inventory verifier, before any product suite
// executed. The original failed checkpoint is retained, never promoted to a
// pass. Changed source guards/planner consumers and the failed verifier refresh.
export const SETTLEMENT_PREFLIGHT=Object.freeze({
  source:'c9d5be520ddf1bdace51bb32d83b59d4f1b4dabe',
  checkpoint:'75a5236350c4ce09aeb9bff92bde142428817512341ae703ec8d806a7bb1051c',
  failedLog:'1c9422a1ffb183ec8752187cc8a3d7cac41596f4eb80602de9a3cac76e4326d5',
  specs:Object.freeze({
    'tests/helpers/q2-runtime/canvas-policy-tail.mjs':'101ca8ffc0b8eea21cb2079a0ac5556a962a11f6fb986520dfe31b868773cffb',
    'scripts/test-q2-runtime-launcher.mjs':'31a0b38e5da6fd7137b4c237f80a759e3cf8629d40d7b3dd8bf8fff743e389b9',
    'docs/runbooks/REGRESSION_REGISTER.md':'ccbf3b47869c4c096b0ad38d65efb4414aad636394a20a40cfb4dfd514bf11e1',
  }),
  retain:[1,4,5,6,7,8,9,10,11,13,16],
});
export function settlementPreflightGuardContinuation(command) {
  assert.equal(command,'npm run test:local-release','Unexpected settlement preflight guard caller');
  return 'npm run test:local-release -- --settlement-preflight-only';
}
export const SETTLEMENT_HOSTING_PREFLIGHT=Object.freeze({
  source:'5219f08ae9579bbfecd67ed638e37845f1066d5c',
  checkpoint:'b30deafb4afe8a68a3466bf4f3c4d8ba01a515f03dd7d8a3471e4a0d4d75ff69',
  failedLog:'03f8ac00b83e1b29670a8b922976dc6ef990f52d0acbcba62ef109f78b8be7ba',
  specs:Object.freeze({
    'scripts/test-frontend-review.mjs':'0236af3d65ebf21ef8f3c5137a804e2b69a91fbea6d387d2caf3074a42478ce2',
    'tests/helpers/canvas-agent-conversation-control.mjs':'d29500c85d57c077b450661232ed9c2c8c43dc9394268e6217691a08105c5c28',
    'docs/runbooks/REGRESSION_REGISTER.md':'834db8a0e1854f89459534c3fea725512144c9305f909a3df5d7c6de48dc4cdf',
  }),
  retain:[1,4,5,6,7,8,9,10,11,13,16,18,19,20,21,22,23,24,25,26,27,28,30,31,32,33,35],
});
export function settlementHostingGuardContinuation(command){
  assert.equal(command,'npm run test:local-release','Unexpected settlement hosting guard caller');
  return command+' -- --settlement-hosting-only';
}
export const SETTLEMENT_NATIVE_PREFLIGHT=Object.freeze({
  source:'cf8553cf1293e37be771d8ae23bd14602b427200',
  checkpoint:'5bcdc8701bb9adf380cfbbd04cd9d67d53d6d17374d2f1c8b4b27cc501ae6043',
  failedLog:'224f61db4126178ce2633a1f755a3c3b8f696179ca16ba5df8fcedbfd4287171',
  manifest:'2e5402d8205cb5efc258bd9a2b3dd6548a9afe7c847cf72194f81abb0ba2805d',
  proof:'5ce8590a2af4c2e08e08e2d5c12574ece67e2ce21517f59705aee0997d97e379',
  hostingLog:'b698c4e579b3498a6f1f6f913928bd3b333c296d2c7bc6c26d19a113a203c843',
  workerLast:'91d1c43004802cd49950d78eb11c8fa7d05da8ffffe219a8b13b2f561bc00903',
  specs:Object.freeze({
    'tests/helpers/q2-runtime/linux-hosted.mjs':'6bfe75f5cf39e077fd378eb032df813ec5498f69ab4629492ab008e5503045f4',
    'scripts/test-q2-runtime-launcher.mjs':'8c51bded1e1f5ac19b0229359eccee69e3f2d058191bfa3bf6227547f1676811',
    'docs/runbooks/REGRESSION_REGISTER.md':'e1f5f6b39503374bad02c990e2f784cda7066ae1ae9993cff9e9e57cb1a66a93',
  }),
  retain:[1,4,5,6,7,8,9,10,11,13,16,18,19,20,21,22,23,24,25,26,27,28,30,31,32,33,35,36,37,38,39],
});
export function settlementNativeGuardContinuation(command){
  assert.equal(command,'npm run test:local-release','Unexpected settlement native guard caller');return command+' -- --settlement-native-only';
}
export const SETTLEMENT_NATIVE_PROGRESS=Object.freeze({
  source:'a0aad4af95ee955c6d92dd6528b1a10295026b57',
  checkpoint:'1f1308c89da68fe3a10934671b77e3bf50f75975c8ead2ca852ae9374301bc4e',
  failedLog:'ec71d274a0fc9249e64cbe5313445bd61ec2fbc6712da49d8ebba7b9e032ce1f',
  manifest:'a279921daca72185926b79ac70db8af8f3484e34d6385b0d76982c7b9d5cf377',
  proof:'a03778357acaf03cb0f42ae62aaa01881b0c467330ffb122c751fcf492d14208',
  hostingLog:SETTLEMENT_NATIVE_PREFLIGHT.hostingLog,
  guardTap:'403e801ef162565993e84e96f2db9e0d6a77972f25d07a2d952911f72bff536f',
  discovery:'9b6eeec2794f164398e66045abe95f6a6748cad0a9425afa572e768d8732d615',
  specs:Object.freeze({'docs/runbooks/REGRESSION_REGISTER.md':'9b68653c5f81a4a69e6dad58e300884e3a02e96a95582b744025565a1991f17f'}),
  retain:[...SETTLEMENT_NATIVE_PREFLIGHT.retain,40],
});
export function settlementNativeProgressGuard(command){
  assert.equal(command,'npm run test:local-release');return command+' -- --settlement-native-progress-only';
}
export function verifySettlementNativeProgress(directory,head){
  const p=SETTLEMENT_NATIVE_PROGRESS;assertCanvasPreflightTree(head,gitBytes,p);
  const bytes=fs.readFileSync(path.join(directory,'reuse/preflight-checkpoint.json'));assert.equal(sha256(bytes),p.checkpoint);const original=JSON.parse(bytes);
  assert.equal(original.sha,p.source);assert.equal(original.status,'failed');assert.equal(original.commands.length,42);assert(original.commands.slice(0,41).every(row=>row.exitCode===0));assert.equal(original.commands[41].exitCode,1);
  const log=fs.readFileSync(path.join(directory,'reuse/preflight-failed.log'),'utf8');assert.equal(sha256(log),p.failedLog);assert(!log.includes('q2LinuxEvidence'),'Original native runtime must remain unexecuted');
  const origin=path.join(directory,'reuse/settlement-native-origin');
  for(const [file,hash]of [['settlement-launcher-fresh.tap',p.guardTap],['settlement-worker-discovery.json',p.discovery]])assert.equal(sha256(fs.readFileSync(path.join(origin,'test-results',file))),hash,'Changed completed staging guard or discovery');
  verifyCanvasPreflight(origin,original,selectedCommands(original.selection,{GITHUB_SHA:original.sha,CANDIDATE_BASE:original.base}));
  return {original,result:{workerPassed:1574,processorPassed:true,launcherRetained:30,nativePending:true}};
}
export function settlementNativeProgressContinuation(command){
  // Retain the already completed staging assertion and discovery. Only the
  // verifier and the never-started native child remain in this exact branch.
  settlementNativeContinuation(command);
  return command.replace('  npm run test:workers',()=> '  node scripts/local-release.mjs verify-settlement-native-progress .local-release\n  node scripts/test-q2-runtime.mjs');
}
export const settlementLauncherCase='default native runtime plan stages every actual suite and control input';
export function settlementLauncherResults(log){
  const rows=tapResults(log),wrapper='tests/q2-recovery-staging.test.mjs';
  if(rows.some(row=>row.title===wrapper)){
    // Node22 emits a passed file envelope for the second file when the exact
    // name filter selects none of its tests. It is not a product/test pass.
    assert.deepEqual(rows,[{title:settlementLauncherCase,status:'passed'},{title:wrapper,status:'passed'}]);
    assert.deepEqual(log.match(/^1\.\.\d+$/gm),['1..0','1..2']);
    assert(log.includes(`1..0\n# Subtest: ${wrapper}\nok 2 - ${wrapper}\n`),'The extra row must be the known empty-file envelope');
    assert.match(log,/# tests 2\n# suites 0\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0/);
    return rows.slice(0,1);
  }
  assert.match(log,/# pass 1\n# fail 0\n# cancelled 0\n# skipped \d+\n# todo 0/);return rows;
}
export function verifySettlementNativeRepair(directory,head,{allowPending=false}={}){
  const p=SETTLEMENT_NATIVE_PREFLIGHT;assertCanvasPreflightTree(head,gitBytes,p);
  const pinned=(file,hash)=>{const bytes=fs.readFileSync(path.join(directory,'reuse',file));assert.equal(sha256(bytes),hash,`Changed original settlement evidence: ${file}`);return bytes;};
  const original=JSON.parse(pinned('preflight-checkpoint.json',p.checkpoint));
  assert.equal(original.sha,p.source);assert.equal(original.status,'failed');assert.equal(original.commands.length,42);assert(original.commands.slice(0,41).every(row=>row.exitCode===0));assert.equal(original.commands[41].exitCode,1);
  const log=pinned('preflight-failed.log',p.failedLog).toString();
  const prefix=log.split('Running 1574 tests using 1 worker')[0];assert.notEqual(prefix,log);
  assert.match(prefix,/# tests 61\n# suites 0\n# pass 61\n# fail 0\n# cancelled 0\n# skipped 0/);assert(prefix.includes('Q4 normal Worker discovery:'));
  assert.match(log,/\n\s+1574 passed \(/);
  const lines=log.split('\n').flatMap(line=>{const m=line.match(/^\s+([✓✘])\s+(\d+)\s+(tests\/.*?)\s+\([\d.]+(?:ms|s|m)\)/);return m?[{status:m[1],number:Number(m[2]),label:m[3]}]:[];});
  assert.equal(lines.length,1574);assert.equal(new Set(lines.map(row=>row.label)).size,1574);assert.deepEqual(lines.map(row=>row.number),Array.from({length:1574},(_,i)=>i+1));assert(lines.every(row=>row.status==='✓'&&!row.label.includes('(retry #')));
  assert.deepEqual(JSON.parse(pinned('settlement-worker-last.json',p.workerLast)),{status:'passed',failedTests:[]});
  const marker='> test:q2-runtime\n> node --test tests/q2-recovery-staging.test.mjs scripts/test-q2-runtime-launcher.mjs && node scripts/test-q2-runtime.mjs\n';
  assert.equal(log.split(marker).length,2,'Missing exact unexecuted native boundary');const [prior,launcher]=log.split(marker);
  assert(prior.includes('> test:homepage-ffmpeg-processor\n'));assert.match(prior,/Private video reference FFmpeg: .*passed\./);assert(prior.includes('Canvas assembly: real 120-second/2880-frame export'));
  assert.match(launcher,/# tests 30\n# suites 0\n# pass 29\n# fail 1\n# cancelled 0\n# skipped 0\n# todo 0/);assert(!launcher.includes('q2LinuxEvidence'));
  const before=tapResults(launcher);assert.equal(before.length,30);assert.equal(new Set(before.map(row=>row.title)).size,30);assert.deepEqual(before.filter(row=>row.status!=='passed'),[{title:settlementLauncherCase,status:'failed'}]);
  const discoveryFile=path.join(directory,'test-results/settlement-worker-discovery.json');
  if(fs.existsSync(discoveryFile)){
    const report=parseDiscovery(fs.readFileSync(discoveryFile,'utf8'));assert.deepEqual(report.errors,[]);const discovered=workerDiscovery(report);assert.equal(discovered.length,1574);
    const executed=workerListResults(log,discovered);assert(executed.every(passedOnce),'Changed, missing or repeated Worker acceptance');
  }else assert(allowPending,'Missing fresh Worker discovery');
  if(allowPending)return {original,before,result:null};
  const fresh=fs.readFileSync(path.join(directory,'test-results/settlement-launcher-fresh.tap'),'utf8');
  const after=settlementLauncherResults(fresh);assert.deepEqual(after.filter(row=>row.status!=='skipped'),[{title:settlementLauncherCase,status:'passed'}]);assert.equal(new Set(after.map(row=>row.title)).size,after.length);assert(after.every(row=>before.some(old=>old.title===row.title)));
  return {original,before,result:{workerPassed:1574,processorPassed:true,launcherRetained:29,launcherFresh:1,launcherTotal:30}};
}
export function settlementNativeContinuation(command){
  const scripts=JSON.parse(fs.readFileSync('package.json')).scripts;
  assert.equal(scripts['test:workers'],'node scripts/check-media-tools.mjs && npm run test:website-assistant && node scripts/check-q4-selection.mjs && playwright test -c playwright.workers.config.js && npm run test:homepage-ffmpeg-processor && npm run test:q2-runtime');
  assert.equal(scripts['test:q2-runtime'],'node --test tests/q2-recovery-staging.test.mjs scripts/test-q2-runtime-launcher.mjs && node scripts/test-q2-runtime.mjs');
  assert.equal(command.split('  npm run test:workers').length,2);assert(command.endsWith('else\n  npm run test:workers\nfi\n'));
  const fresh=[
    'mkdir -p .local-release/test-results',
    'PLAYWRIGHT_JSON_OUTPUT_NAME= npx playwright test -c playwright.workers.config.js --list --reporter=json > .local-release/test-results/settlement-worker-discovery.json',
    'node scripts/local-release.mjs verify-settlement-native-pending .local-release',
    `node --test --test-name-pattern='^${settlementLauncherCase}$' tests/q2-recovery-staging.test.mjs scripts/test-q2-runtime-launcher.mjs > .local-release/test-results/settlement-launcher-fresh.tap 2>&1 || { status=$?; cat .local-release/test-results/settlement-launcher-fresh.tap; exit "$status"; }`,
    'cat .local-release/test-results/settlement-launcher-fresh.tap',
    'node scripts/local-release.mjs verify-settlement-native-repair .local-release',
    'node scripts/test-q2-runtime.mjs',
  ].map(line=>'  '+line).join('\n');
  return command.replace('  npm run test:workers',()=>fresh);
}
// Exact failed assistant candidate: immutable Linux passes are retained while
// the twelve failed cases and the unexecuted media/native tail must complete.
export const ASSISTANT_NATIVE_PREFLIGHT=Object.freeze({
  source:'05cb5a3d86081fc1a1965a3641ae190ae585b8da',
  checkpoint:'d19cd01538a39c9e4c1639435c47fe7352cf3113944e225e585f696abe37353c',
  failedLog:'61a6acaa968da26e2f1ae8c5e73a575a851c54cfc8e297c029db5d9fa554c792',
  completedGuardLog:'b3dae0c4edbb4cc0d5b4f7d163fc24dfda6351774bbe0a55b427fbc2672cfcc5',
  discovery:'e56023d69ee241644efc3454c803b3a2006588a4a4c2d782f6b425f040d370af',
  workerReport:'a2376c23ed59cf97bf94abe93509e1d5e351c75d453349f7a9988a03a5a8bd6e',
  manifest:'b8b327bee9994cddc1b44619d2e609ab6bac640fe90f12320dd446e2ca25b407',
  proof:'7a9cfd882664f8eb84d658b5000e9d54c40c051966df739110519c3de3ffc0ef',
  hostingLog:'b3f925ee38e175922ea5e5278aa7772f83ea8600163b5b47b0a8304a99a1e322',
  specs:Object.freeze({
    'scripts/test-q2-runtime-launcher.mjs':'4b3388dcb141461117249beaeea79f823fd2f6714043dc80950b1878a38548cd',
    'tests/helpers/q2-runtime/canvas.mjs':'e6693f0432187636414cb43bd8f92dcd5a42fbc0e56f93553f194e63f25a309d',
    'scripts/test-local-release.mjs':'7f256873552a60bfb4275e3cb9a82eab7ca2cd3ca208ca5b4d264b2e5f71c59e',
  }),
  retain:[1,4,5,6,7,8,9,10,11,13,16,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,35,36,37,38,39],
});
export const assistantLauncherFailures=Object.freeze([
  'Canvas rejected reference verifier preserves populated receipts and catches new or changed usage, charges and dispatch',
  'Canvas reference fixture reads the staged bytes from a non-repository cwd',
  'Canvas policy tail fixes the complete actual inventory and never repeats retained callbacks',
  'Canvas action tail preserves all setup and executes only the final fifteen required callbacks',
]);
export function assistantNativeGuardContinuation(command){
  assert.equal(command,'npm run test:local-release');return command+' -- --assistant-native-only';
}
export function assistantNativeContinuation(command){
  const scripts=JSON.parse(fs.readFileSync('package.json')).scripts;
  assert.equal(scripts['test:workers'],'node scripts/check-media-tools.mjs && npm run test:website-assistant && node scripts/check-q4-selection.mjs && playwright test -c playwright.workers.config.js && npm run test:homepage-ffmpeg-processor && npm run test:q2-runtime');
  assert.equal(scripts['test:q2-runtime'],'node --test tests/q2-recovery-staging.test.mjs scripts/test-q2-runtime-launcher.mjs && node scripts/test-q2-runtime.mjs');
  assert.equal(command.split('  npm run test:workers').length,2);assert(command.endsWith('else\n  npm run test:workers\nfi\n'));
  const fresh=[
    'mkdir -p .local-release/test-results',
    'PLAYWRIGHT_JSON_OUTPUT_NAME= npx playwright test -c playwright.workers.config.js --list --reporter=json > .local-release/test-results/assistant-native-worker-discovery.json',
    'node scripts/local-release.mjs verify-assistant-native-pending .local-release',
    `node --test --test-name-pattern='^(?:${assistantLauncherFailures.join('|')})$' scripts/test-q2-runtime-launcher.mjs > .local-release/test-results/assistant-launcher-fresh.tap 2>&1 || { status=$?; cat .local-release/test-results/assistant-launcher-fresh.tap; exit "$status"; }`,
    'cat .local-release/test-results/assistant-launcher-fresh.tap',
    'node scripts/local-release.mjs verify-assistant-native-repair .local-release',
    'node scripts/test-q2-runtime.mjs',
  ].map(line=>'  '+line).join('\n');
  return command.replace('  npm run test:workers',()=>fresh);
}
export function verifyAssistantLauncherUnion(before,after){
  assert.equal(before.length,30);assert.equal(new Set(before.map(row=>row.title)).size,30);
  assert.deepEqual(before.filter(row=>row.status!=='passed'),assistantLauncherFailures.map(title=>({title,status:'failed'})));
  assert.deepEqual(after,assistantLauncherFailures.map(title=>({title,status:'passed'})),'Exactly the four failed guards must pass once; completed cases cannot repeat');
  return {launcherRetained:26,launcherFresh:4,launcherTotal:30};
}
export function verifyAssistantNativeRepair(directory,head,{allowPending=false}={}){
  const p=ASSISTANT_NATIVE_PREFLIGHT;assertCanvasPreflightTree(head,gitBytes,p);
  const pinned=(file,hash)=>{const bytes=fs.readFileSync(path.join(directory,file));assert.equal(sha256(bytes),hash,`Changed original assistant native evidence: ${file}`);return bytes;};
  const original=JSON.parse(pinned('reuse/preflight-checkpoint.json',p.checkpoint));
  const manifest=JSON.parse(pinned('reuse/hosting-manifest.json',p.manifest)),hosting=JSON.parse(pinned('reuse/hosting-proof.json',p.proof));
  assert.equal(manifest.sha,p.source);assert.equal(hosting.manifestHash,sha256(JSON.stringify(manifest)));assert.equal(hosting.job,'frontend-runtime');assert.equal(hosting.status,'passed');
  assert.equal(original.sha,p.source);assert.equal(original.status,'failed');assert.equal(original.commands.length,42);
  assert(original.commands.slice(0,41).every(row=>row.exitCode===0));assert.equal(original.commands[41].exitCode,1);
  const origin=path.join(directory,'reuse/test-results/assistant-worker-origin');
  verifyCanvasPreflight(origin,original,selectedCommands(original.selection,{GITHUB_SHA:original.sha,CANDIDATE_BASE:original.base}));
  for(const [file,hash]of [['logs/17.log',p.completedGuardLog],['test-results/assistant-worker-discovery.json',p.discovery],['test-results/assistant-worker-fresh.json',p.workerReport]])
    pinned('reuse/test-results/assistant-worker-origin/'+file,hash);
  const log=pinned('reuse/preflight-failed.log',p.failedLog).toString();
  const marker='> test:q2-runtime\n> node --test tests/q2-recovery-staging.test.mjs scripts/test-q2-runtime-launcher.mjs && node scripts/test-q2-runtime.mjs\n';
  assert.equal(log.split(marker).length,2,'Missing exact unexecuted native boundary');const [prior,launcher]=log.split(marker);
  assert.match(prior,/\n\s+13 passed \(/);assert(prior.includes('"originalPassed":1617,"correctedPassed":12,"newPassed":1,"total":1630'));
  assert(prior.includes('> test:homepage-ffmpeg-processor\n'));assert(prior.includes('Canvas assembly: real 120-second/2880-frame export'));
  assert.match(prior,/Private video reference FFmpeg: .*passed\./);
  assert.match(launcher,/# tests 30\n# suites 0\n# pass 26\n# fail 4\n# cancelled 0\n# skipped 0\n# todo 0/);assert(!launcher.includes('q2LinuxEvidence'),'Original native runtime remains unexecuted');
  const before=tapResults(launcher);assert.equal(before.length,30);assert.equal(new Set(before.map(row=>row.title)).size,30);
  assert.deepEqual(before.filter(row=>row.status!=='passed'),assistantLauncherFailures.map(title=>({title,status:'failed'})));
  // Discovery is observational. The source guard fixes all test registrations;
  // this independently proves the complete Worker identity set is unchanged.
  const currentFile=path.join(directory,'test-results/assistant-native-worker-discovery.json');
  if(fs.existsSync(currentFile)){
    const current=parseDiscovery(fs.readFileSync(currentFile,'utf8'));assert.deepEqual(current.errors,[]);
    const old=parseDiscovery(fs.readFileSync(path.join(origin,'test-results/assistant-worker-discovery.json'),'utf8'));
    const identities=report=>workerDiscovery(report).map(({id,file,title})=>({id,file,title})).sort((a,b)=>a.id.localeCompare(b.id));
    assert.equal(identities(current).length,1630);assert.deepEqual(identities(current),identities(old),'Changed Worker discovery cannot inherit acceptance');
  }else assert(allowPending,'Missing current complete Worker discovery');
  if(allowPending)return {original,before,result:null};
  const fresh=fs.readFileSync(path.join(directory,'test-results/assistant-launcher-fresh.tap'),'utf8');
  assert.match(fresh,/# tests 4\n# suites 0\n# pass 4\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0/);
  const result={workerPassed:1630,processorPassed:true,...verifyAssistantLauncherUnion(before,tapResults(fresh))};
  return {original,before,result};
}
export const ASSISTANT_NATIVE_PROGRESS=Object.freeze({
  source:'0870426fde4432bad9374710a85d1f01797775a9',
  checkpoint:'82ee379f0c37482c65d9854ae0b363052c794273a242a3a6ac78624cb4528ded',
  failedLog:'58c6c1ff622c6128a54816599f765288771c0c3e0205a002672d384c3e04fc78',
  completedGuardLog:'22a1886e25ad2c20ddb0ef738982522e4874ef896603ef76371cb6b5f4a57b0c',
  discovery:'477fadcf6bc9f91e2d7ef834ff9c5db2f9e6c059602081bd8c00f19da04cf8e0',
  launcherTap:'3700de667b6f58b6ed7fece334d2def3c7670b1b07155b12cddac8af5a439fb2',
  manifest:'707601f7588c7036f0f66f87d7b3f273911ffdf807794f28ca28ff1bffafdc94',
  proof:'7cbc8c89bca37139deed71b91aca27e8619f1e46d78e4c1c9214877c93850a67',
  hostingLog:ASSISTANT_NATIVE_PREFLIGHT.hostingLog,
  nativeProof:Object.freeze({
    'launcher-result.json':'29ebdb8db10df8e59c6551f0feff29e67612a363d45819164c32cfb68e2f39da',
    'reports/isolation-result.json':'c609013b5a939b464aaa1834e97286e6ec5c0f4eb4c069f1af40770a6527b11e',
    'reports/isolation-final.json':'3722a729b374515d022042aa6df90f8f984b91c3086a0a52d42884219ce98055',
    'reports/bitbi-q2-runtime-JoVPlq__result.json':'877c1fce36b78878bc207852903b8e6e23ec345054c38b585a88a1bc94ee2a82',
    'reports/bitbi-q2-runtime-JoVPlq__build-provenance.json':'00e0829bc09798532824ef04cdb9fc6d1821f49694fce29a589ab37c1e950bcd',
  }),
  specs:Object.freeze({
    'tests/helpers/canvas-agent-natural-control.mjs':'e08647661dd2b9756ba8426031aba82a97f3f4f405f428771619bc48c7b20005',
    'tests/helpers/q2-runtime/canvas.mjs':'1b4e9d5a9c3f814ee6f723234894389ad2fd346be24d37304ee1188af873be7f',
    'tests/helpers/q2-runtime/canvas-policy-tail.mjs':'194be83d2d8daeb50dadc99201b315a39eb3a11b7ac041bdd78e05b3e29d2b70',
    'tests/helpers/q2-runtime/runner.mjs':'7ff1d62a09ba14d83b324fe10dc1e834a46311e7cc77962ee96be68743053a86',
    'tests/helpers/q2-runtime/linux-hosted.mjs':'43f9b3586b1b53495d3c3282e6ff6939450962ae0427b7489fc1c7207b4a20c9',
    'tests/helpers/q2-runtime/linux-runtime-child.mjs':'1361d5f241743122faaf2f110b8cecbcc20fcff96637b5792f5659d6590f3c85',
    'tests/helpers/q2-runtime/linux-bootstrap.py':'6f6fc789c28bb5c255da9368e2f2271004e32d8e85d5e7355e043820be0573af',
    'scripts/test-local-release.mjs':'e3b472e68c1e36298e97aeec13968dca2e7bc1aa29ca0aa4dd10eadda4a02acc',
  }),
  retain:[1,4,5,6,7,8,9,10,11,13,16,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,35,36,37,38,39],
});
export function assistantNativeProgressGuard(command){assert.equal(command,'npm run test:local-release');return command+' -- --assistant-native-progress-only';}
export function assistantNativeProgressContinuation(command){
  assert.equal(command.split('  npm run test:workers').length,2);assert(command.endsWith('else\n  npm run test:workers\nfi\n'));
  const fresh=[
    'set -o pipefail',
    'mkdir -p .local-release/test-results',
    'PLAYWRIGHT_JSON_OUTPUT_NAME= npx playwright test -c playwright.workers.config.js --list --reporter=json > .local-release/test-results/assistant-native-progress-discovery.json',
    'node scripts/local-release.mjs verify-assistant-native-progress-pending .local-release',
    'node scripts/test-q2-runtime.mjs --suite canvas-assistant-continuation 2>&1 | tee .local-release/test-results/assistant-native-progress.log',
    'mkdir -p .local-release/runtime',
    'cp -a /tmp/bitbi-release/q2-runtime-evidence .local-release/runtime/',
    'node scripts/local-release.mjs verify-assistant-native-progress .local-release',
  ].map(line=>'  '+line).join('\n');
  return command.replace('  npm run test:workers',()=>fresh);
}
function assistantPreviousNative(result){
  assert.equal(result.passed,184);assert.equal(result.failedSuites,1);assert.equal(result.reports.length,14);
  const canvas=result.reports.find(row=>row.suite==='canvas');assert(canvas);
  assert.deepEqual(canvas.records,[{name:'canvas_assistant_models_populated_migration',status:'PASS'}]);
  assert.deepEqual(canvas.failure,{stage:'canvas_natural_chat_populated_migration_preserves_original_authority',name:'Error',message:'Forward migration preserves exact paid identities, original ledger, transcript, brief and graph bytes'});
  const records=result.reports.flatMap(suite=>{assert(suite===canvas||!suite.failure);return suite.records.map(row=>({suite:suite.suite,...row}));});
  assert.equal(records.length,184);assert(records.every(row=>row.status==='PASS'));assert.equal(new Set(records.map(row=>row.suite+':'+row.name)).size,184);
  return canvas;
}
export function verifyAssistantNativeProgressUnion(previous,fresh){
  const canvas=assistantPreviousNative(previous);
  assert.equal(fresh.failedSuites,0);assert.equal(fresh.reports.length,1);const report=fresh.reports[0];assert.equal(report.suite,'canvas');assert(!report.failure);
  const metrics=report.metrics.filter(row=>row.assistantContinuation);assert.equal(metrics.length,1);const evidence=metrics[0].assistantContinuation;
  assert.deepEqual(evidence.retained,canvas.records.map(row=>row.name));assert.equal(evidence.currentfullcount,251);
  assert.equal(evidence.discovery.length,251);assert.equal(new Set(evidence.discovery).size,251);
  assert.equal(sha256(JSON.stringify(evidence.discovery)),'3bcde3da85495a7cfa8190ca3ad20f8f255c7b065941f88cfbf5d1c75cd3640f');
  assert.deepEqual(evidence.discovery.slice(0,1),evidence.retained);assert.deepEqual(evidence.fresh,evidence.discovery.slice(1));
  assert.deepEqual(report.records,evidence.fresh.map(name=>({name,status:'PASS'})),'Every failed/unstarted Canvas callback must pass once in the original order');
  assert.equal(fresh.passed,250);
  return {workerPassed:1630,processorPassed:true,launcherPassed:30,nativeRetained:184,nativeFresh:250,nativeTotal:434};
}
export function verifyAssistantNativeProgress(directory,head,{allowPending=false}={}){
  const p=ASSISTANT_NATIVE_PROGRESS;assertCanvasPreflightTree(head,gitBytes,p);
  const pinned=(file,hash)=>{const bytes=fs.readFileSync(path.join(directory,file));assert.equal(sha256(bytes),hash,`Changed original assistant progress evidence: ${file}`);return bytes;};
  const original=JSON.parse(pinned('reuse/preflight-checkpoint.json',p.checkpoint));
  assert.equal(original.sha,p.source);assert.equal(original.status,'failed');assert.equal(original.commands.length,42);
  assert(original.commands.slice(0,41).every(row=>row.exitCode===0));assert.equal(original.commands[41].exitCode,1);
  const origin=path.join(directory,'reuse/test-results/assistant-native-origin');
  verifyCanvasPreflight(origin,original,selectedCommands(original.selection,{GITHUB_SHA:original.sha,CANDIDATE_BASE:original.base}));
  for(const [file,hash]of [['logs/17.log',p.completedGuardLog],['test-results/assistant-native-worker-discovery.json',p.discovery],['test-results/assistant-launcher-fresh.tap',p.launcherTap]])pinned('reuse/test-results/assistant-native-origin/'+file,hash);
  const log=pinned('reuse/preflight-failed.log',p.failedLog).toString();assert(log.includes('/tmp/bitbi-release/q2-runtime-evidence/native-t5EM7C'));
  const manifest=JSON.parse(pinned('reuse/hosting-manifest.json',p.manifest)),hosting=JSON.parse(pinned('reuse/hosting-proof.json',p.proof));
  assert.equal(manifest.sha,p.source);assert.equal(hosting.manifestHash,sha256(JSON.stringify(manifest)));assert.equal(hosting.job,'frontend-runtime');assert.equal(hosting.status,'passed');
  const records=Object.fromEntries(Object.entries(p.nativeProof).map(([file,hash])=>[file,JSON.parse(pinned('reuse/test-results/assistant-native-original/'+file,hash))]));
  const launcher=records['launcher-result.json'];assert.equal(launcher.status,1);assert.equal(launcher.mode,'runtime');assert.equal(launcher.origin,LOCAL_POLICY);assert.equal(launcher.childBoundaryVerified,false);assert.equal(launcher.hostedImage.GITHUB_SHA,p.source);
  assert.equal(launcher.hostInterfacesUnchanged,true);assert.equal(launcher.hostRoutesUnchanged,true);assert.deepEqual(launcher.postcheckFailures,[]);
  for(const file of ['reports/isolation-result.json','reports/isolation-final.json'])assert.equal(records[file].passed,true);
  const previous=records['reports/bitbi-q2-runtime-JoVPlq__result.json'];assistantPreviousNative(previous);
  assert.deepEqual(previous.provenance,records['reports/bitbi-q2-runtime-JoVPlq__build-provenance.json']);
  const discoveryFile=path.join(directory,'test-results/assistant-native-progress-discovery.json');
  if(fs.existsSync(discoveryFile)){
    const current=parseDiscovery(fs.readFileSync(discoveryFile,'utf8'));assert.deepEqual(current.errors,[]);
    const prior=parseDiscovery(fs.readFileSync(path.join(origin,'test-results/assistant-native-worker-discovery.json'),'utf8'));
    const identities=report=>workerDiscovery(report).map(({id,file,title})=>({id,file,title})).sort((a,b)=>a.id.localeCompare(b.id));
    assert.equal(identities(current).length,1630);assert.deepEqual(identities(current),identities(prior),'Changed Worker discovery cannot inherit success');
  }else assert(allowPending,'Missing current complete Worker discovery');
  if(allowPending)return {original,previous,result:null};
  const freshLog=fs.readFileSync(path.join(directory,'test-results/assistant-native-progress.log'),'utf8');verifyNativeLocalReports(directory,freshLog);
  const references=freshLog.split('\n').flatMap(line=>{try{const row=JSON.parse(line);return row.q2LinuxEvidence?[row.q2LinuxEvidence]:[];}catch{return [];}});assert.equal(references.length,1);
  const folder=path.join(directory,'runtime',references[0].slice('/tmp/bitbi-release/'.length)),entry=JSON.parse(fs.readFileSync(path.join(folder,'launcher-result.json')));assert.equal(entry.hostedImage.GITHUB_SHA,head);
  const reports=path.join(folder,'reports'),files=fs.readdirSync(reports).filter(file=>file==='result.json'||file.endsWith('__result.json'));assert.equal(files.length,1);
  const fresh=JSON.parse(fs.readFileSync(path.join(reports,files[0])));
  assert.equal(fresh.provenance.bundleSha256,previous.provenance.bundleSha256,'Retained native application bundle changed');assert.deepEqual(fresh.provenance.sourceLedger,previous.provenance.sourceLedger,'Retained native application source changed');
  return {original,previous,result:verifyAssistantNativeProgressUnion(previous,fresh)};
}
export const ASSISTANT_NATIVE_TAIL=Object.freeze({
  source:'9f61cd1d89f95f19a8855a5f8672217b903141c9',
  checkpoint:'fb9a7e3f55e0f83a5ab24ac16b573fa5a27573c41b7bc2ad9e02edffc2e04e6a',
  failedLog:'ea420e4650ba19ef8502ee33f4e899ed9081367d5c4458a912c44ac824dfb716',
  completedGuardLog:'d5348aaf51787e2088a49aca72902ecd314b12a8fa3a462d0b41f9d584ab6c45',
  discovery:'ae809dfad35128610c5a259d5708f943dde96a7ae4a8b420475965a851dc5e77',
  manifest:'9fae5b35ddf60bab4c443bbaf8b6723bedebcb44f4b8caaa1391d90a67a98ded',
  proof:'9459722f0b565bbb88138e57fd8504e9738c31cac3f0cbb87d4e0e6f3a4d2d67',
  hostingLog:ASSISTANT_NATIVE_PROGRESS.hostingLog,
  nativeProof:Object.freeze({
    'launcher-result.json':'7ac4133b98c295c0f48246ca40c86072f3d7ef71ed379b0f14fca8ce8637bd8f',
    'reports/isolation-result.json':'c609013b5a939b464aaa1834e97286e6ec5c0f4eb4c069f1af40770a6527b11e',
    'reports/isolation-final.json':'3722a729b374515d022042aa6df90f8f984b91c3086a0a52d42884219ce98055',
    'reports/bitbi-q2-runtime-2UY4o2__result.json':'f595ef138a20f16b8a307c2d86047ba8ac9bc4413972cb1d605b26ff9404bb2a',
    'reports/bitbi-q2-runtime-2UY4o2__build-provenance.json':'00e0829bc09798532824ef04cdb9fc6d1821f49694fce29a589ab37c1e950bcd',
  }),
  specs:Object.freeze({
    'tests/helpers/canvas-image-scheduling-control.mjs':'964bf001d85ef486f994977741046f8ae43a80cd5801136fff989ddb5ebda452',
    'tests/helpers/q2-runtime/canvas.mjs':'e546d4c0b71de6f0daf2b79b153ed19912d977b6ea411bc93bf2b9907009322d',
    'tests/helpers/q2-runtime/environment.mjs':'0a664caff2dc1acb15b369800fe848066c10c96c6b5d4871e57e0378ffe95f71',
    'tests/helpers/q2-runtime/control.mjs':'f27fd4b13bef67600d657d6616e500b272424a4b14980cf231a6b0031814dc33',
    'tests/helpers/q2-runtime/canvas-policy-tail.mjs':'ea6f5e7387e027baa3123cdd42d04f4d2745b99a311601b1050fe9ba985ae8e4',
    'tests/helpers/q2-runtime/runner.mjs':'8536bf54df555bd7ba1ad394d950aac330b5c3208826d3a34872a486169d626a',
    'tests/helpers/q2-runtime/linux-hosted.mjs':'9165d89321f423d504f4b282070309f2e22fe2ff6f9cda147476f70cdfa8a326',
    'tests/helpers/q2-runtime/linux-runtime-child.mjs':'4202c7bd55bd5027eb9736687af6c99d9c18fb133616db2ce29b64b8d32d0835',
    'tests/helpers/q2-runtime/linux-bootstrap.py':'aee271d243495d10cc8057034f0715833a21864a9a275b697f3d2b07e6adb573',
    'scripts/test-local-release.mjs':'1a564b1bb0b1d5e67e848d72bcc2eb0e7cd32396b061983135f7ff1214b8abf5',
  }),
  retain:ASSISTANT_NATIVE_PROGRESS.retain,
});
export function assistantNativeTailGuard(command){assert.equal(command,'npm run test:local-release');return command+' -- --assistant-native-tail-only';}
export function assistantNativeTailContinuation(command){
  return assistantNativeProgressContinuation(command).replaceAll('assistant-native-progress','assistant-native-tail').replace('--suite canvas-assistant-continuation','--suite canvas-assistant-tail');
}
function assistantPartialNative(partial){
  assert.equal(partial.passed,142);assert.equal(partial.failedSuites,1);assert.equal(partial.reports.length,1);
  const report=partial.reports[0];assert.equal(report.suite,'canvas');assert.equal(report.records.length,142);assert(report.records.every(row=>row.status==='PASS'));
  assert.deepEqual(report.failure,{stage:'canvas_image_scheduling_parallel_fifteen',name:'Error',message:'Queue returned before provider acceptance: queued/image_generation_capacity_wait'});
  const names=report.records.map(row=>row.name);assert.equal(new Set(names).size,142);
  assert.equal(sha256(JSON.stringify(names)),'ae9be218bbb351ca2d4f2588362d13187af7dfa9a3a7d363aa402bb5311ab7ae');
  return names;
}
export function verifyAssistantNativeTailUnion(previous,partial,fresh){
  const first=assistantPreviousNative(previous).records.map(row=>row.name),passed=assistantPartialNative(partial);
  assert.equal(fresh.failedSuites,0);assert.equal(fresh.reports.length,1);assert.equal(fresh.passed,108);
  const report=fresh.reports[0];assert.equal(report.suite,'canvas');assert(!report.failure);
  const metrics=report.metrics.filter(row=>row.assistantTail);assert.equal(metrics.length,1);const evidence=metrics[0].assistantTail;
  assert.deepEqual(evidence.retained,[...first,...passed]);assert.equal(evidence.currentfullcount,251);assert.equal(evidence.discovery.length,251);assert.equal(new Set(evidence.discovery).size,251);
  assert.equal(sha256(JSON.stringify(evidence.discovery)),'3bcde3da85495a7cfa8190ca3ad20f8f255c7b065941f88cfbf5d1c75cd3640f');
  assert.deepEqual(evidence.discovery.slice(0,143),evidence.retained);assert.deepEqual(evidence.fresh,evidence.discovery.slice(143));
  assert.deepEqual(report.records,evidence.fresh.map(name=>({name,status:'PASS'})),'All failed/unstarted callbacks must pass once without rerunning retained cases');
  return {workerPassed:1630,processorPassed:true,launcherPassed:30,nativeRetained:326,nativeFresh:108,nativeTotal:434};
}
export function verifyAssistantNativeTail(directory,head,{allowPending=false}={}){
  const p=ASSISTANT_NATIVE_TAIL;assertCanvasPreflightTree(head,gitBytes,p);
  const pinned=(file,hash)=>{const bytes=fs.readFileSync(path.join(directory,file));assert.equal(sha256(bytes),hash,`Changed original assistant tail evidence: ${file}`);return bytes;};
  const original=JSON.parse(pinned('reuse/preflight-checkpoint.json',p.checkpoint));assert.equal(original.sha,p.source);assert.equal(original.status,'failed');assert.equal(original.commands.length,42);
  assert(original.commands.slice(0,41).every(row=>row.exitCode===0));assert.equal(original.commands[41].exitCode,1);
  assert.deepEqual(original.preflightContinuation,{source:ASSISTANT_NATIVE_PROGRESS.source,checkpoint:ASSISTANT_NATIVE_PROGRESS.checkpoint});
  const origin=path.join(directory,'reuse/test-results/assistant-native-progress-origin');
  const {previous}=verifyAssistantNativeProgress(origin,p.source,{allowPending:true});
  const commands=selectedCommands(original.selection,{GITHUB_SHA:p.source,CANDIDATE_BASE:original.base});
  for(const [index,row]of original.commands.entries()){
    assert.deepEqual(row.command,commands[index]);assert.equal(sha256(fs.readFileSync(path.join(origin,row.log))),row.logHash,'Changed completed original command evidence');
  }
  assert.equal(original.commands[17].continuation,assistantNativeProgressGuard(commands[17].run));assert.equal(original.commands[41].continuation,assistantNativeProgressContinuation(commands[41].run));
  pinned('reuse/test-results/assistant-native-progress-origin/logs/17.log',p.completedGuardLog);
  pinned('reuse/test-results/assistant-native-progress-origin/test-results/assistant-native-progress-discovery.json',p.discovery);
  const log=pinned('reuse/preflight-failed.log',p.failedLog).toString();assert(log.includes('/tmp/bitbi-release/q2-runtime-evidence/native-9yIkV6'));
  const manifest=JSON.parse(pinned('reuse/hosting-manifest.json',p.manifest)),hosting=JSON.parse(pinned('reuse/hosting-proof.json',p.proof));
  assert.equal(manifest.sha,p.source);assert.equal(hosting.manifestHash,sha256(JSON.stringify(manifest)));assert.equal(hosting.job,'frontend-runtime');assert.equal(hosting.status,'passed');
  restoreCanvasHostingProof(origin,{verifyOnly:true});
  const records=Object.fromEntries(Object.entries(p.nativeProof).map(([file,hash])=>[file,JSON.parse(pinned('reuse/test-results/assistant-native-progress-original/'+file,hash))]));
  const launcher=records['launcher-result.json'];assert.equal(launcher.status,1);assert.equal(launcher.mode,'runtime');assert.equal(launcher.origin,LOCAL_POLICY);assert.equal(launcher.childBoundaryVerified,false);assert.equal(launcher.hostedImage.GITHUB_SHA,p.source);
  assert.equal(launcher.hostInterfacesUnchanged,true);assert.equal(launcher.hostRoutesUnchanged,true);assert.deepEqual(launcher.postcheckFailures,[]);
  for(const file of ['reports/isolation-result.json','reports/isolation-final.json'])assert.equal(records[file].passed,true);
  const partial=records['reports/bitbi-q2-runtime-2UY4o2__result.json'];assistantPartialNative(partial);assert.deepEqual(partial.provenance,records['reports/bitbi-q2-runtime-2UY4o2__build-provenance.json']);
  assert.equal(partial.provenance.bundleSha256,previous.provenance.bundleSha256);assert.deepEqual(partial.provenance.sourceLedger,previous.provenance.sourceLedger);
  const discoveryFile=path.join(directory,'test-results/assistant-native-tail-discovery.json');
  if(fs.existsSync(discoveryFile)){
    const current=parseDiscovery(fs.readFileSync(discoveryFile,'utf8'));assert.deepEqual(current.errors,[]);
    const prior=parseDiscovery(fs.readFileSync(path.join(origin,'test-results/assistant-native-progress-discovery.json'),'utf8'));
    const identities=report=>workerDiscovery(report).map(({id,file,title})=>({id,file,title})).sort((a,b)=>a.id.localeCompare(b.id));
    assert.equal(identities(current).length,1630);assert.deepEqual(identities(current),identities(prior),'Changed Worker discovery cannot inherit success');
  }else assert(allowPending,'Missing current complete Worker discovery');
  if(allowPending)return {original,previous,partial,result:null};
  const freshLog=fs.readFileSync(path.join(directory,'test-results/assistant-native-tail.log'),'utf8');verifyNativeLocalReports(directory,freshLog);
  const references=freshLog.split('\n').flatMap(line=>{try{const row=JSON.parse(line);return row.q2LinuxEvidence?[row.q2LinuxEvidence]:[];}catch{return [];}});assert.equal(references.length,1);
  const folder=path.join(directory,'runtime',references[0].slice('/tmp/bitbi-release/'.length)),entry=JSON.parse(fs.readFileSync(path.join(folder,'launcher-result.json')));assert.equal(entry.hostedImage.GITHUB_SHA,head);
  const reports=path.join(folder,'reports'),files=fs.readdirSync(reports).filter(file=>file==='result.json'||file.endsWith('__result.json'));assert.equal(files.length,1);
  const fresh=JSON.parse(fs.readFileSync(path.join(reports,files[0])));
  assert.equal(fresh.provenance.bundleSha256,previous.provenance.bundleSha256,'Retained native application bundle changed');assert.deepEqual(fresh.provenance.sourceLedger,previous.provenance.sourceLedger,'Retained native application source changed');
  return {original,previous,partial,result:verifyAssistantNativeTailUnion(previous,partial,fresh)};
}
export const ASSISTANT_NATIVE_RATE=Object.freeze({
  source:'e04050428109ff251abcc6a6f469eb4d5a71bd16',
  checkpoint:'f62eace0adbad2dc975b39dee4bd2e942ceeb2be43efacd4d5eb5236633e7b29',
  failedLog:'2b97ed5e3c96508313192da7357c2b0828073b477cab998975a6f944ba0c7ebe',
  completedGuardLog:'eae304951dc4c5e34247b14950df087baaea15d4e0e87379df99c53482fac4a1',
  discovery:'555f8d630d6935c3a67c3e663595c11b69c0c9efcb408eb605934085cf1744d1',
  manifest:'af7e4c9fb7d645a65e4076c4e04714463c19160bea6c41c20b73ec3802f74d8e',
  proof:'cae47c355bd690188ee92d341e643f11c8c5405764a55223648acd73a0084dfe',
  hostingLog:ASSISTANT_NATIVE_TAIL.hostingLog,
  nativeProof:Object.freeze({
    'launcher-result.json':'a23e00cd1e57a25fe6d1a3eaa74cfecc51fd5daf037b986d78257a20a920f803',
    'reports/isolation-result.json':'c609013b5a939b464aaa1834e97286e6ec5c0f4eb4c069f1af40770a6527b11e',
    'reports/isolation-final.json':'3722a729b374515d022042aa6df90f8f984b91c3086a0a52d42884219ce98055',
    'reports/bitbi-q2-runtime-GnqR5x__result.json':'2aee66f1e91c8e0e2f0caddec37057e3abdb82538f596579a15cd8d650318c10',
    'reports/bitbi-q2-runtime-GnqR5x__build-provenance.json':'00e0829bc09798532824ef04cdb9fc6d1821f49694fce29a589ab37c1e950bcd',
  }),
  specs:Object.freeze({
    'tests/helpers/canvas-image-scheduling-control.mjs':'f588e199d5ec371f5237bcc4fca8cb56d3cffbd1fce0c06f5b82e26ec916e6b7',
    'tests/helpers/q2-runtime/control.mjs':'48c7c3363330b09baba2ac0ddd3f7e4edb81482fa53d380e9f93a395be366036',
    'tests/helpers/q2-runtime/environment.mjs':'0ed82f35d40f7169e3f2f211ec1ad200397c42089a4eb029a52e37950e63f4b0',
    'tests/helpers/q2-runtime/canvas-policy-tail.mjs':'f17d290e61463ac6ba44643e4c47d40402fd5831b536e55c39d0bc4701d76ae3',
    'tests/helpers/q2-runtime/runner.mjs':'78b376d7b0ea14ebe0723eba39b07b3699942929ebd059f20f5b09e98a949f63',
    'tests/helpers/q2-runtime/linux-hosted.mjs':'19b0a91a86ed6bccef8bd011ee4c0f2bcce9983fae28ed2d449e6b9339f2d722',
    'tests/helpers/q2-runtime/linux-runtime-child.mjs':'a45901518ff1e003c2120ab1aaa1544d432ab9db7b380ba56d8e55cb0a13cc33',
    'tests/helpers/q2-runtime/linux-bootstrap.py':'2f21a671ce815f3d3ef10b7fae5437810f8f9b8cf43e487914cfa1970ca11cd8',
    'scripts/test-local-release.mjs':'696db13ca6156ce5846516f4f1db81c75742ed641eda065bcd01a0a7775aec2d',
  }),
  retain:ASSISTANT_NATIVE_TAIL.retain,
});
export function assistantNativeRateGuard(command){assert.equal(command,'npm run test:local-release');return command+' -- --assistant-native-rate-only';}
export function assistantNativeRateContinuation(command){
  return assistantNativeTailContinuation(command).replaceAll('assistant-native-tail','assistant-native-rate').replace('--suite canvas-assistant-tail','--suite canvas-assistant-rate-tail');
}
function assistantAdvancedNative(advanced){
  assert.equal(advanced.passed,8);assert.equal(advanced.failedSuites,1);assert.equal(advanced.reports.length,1);
  const report=advanced.reports[0];assert.equal(report.suite,'canvas');assert.equal(report.records.length,8);assert(report.records.every(row=>row.status==='PASS'));
  assert.deepEqual(report.failure,{stage:'canvas_image_scheduling_rate_admission',name:'Error',message:'Original bounded cohort is admitted after the real limiter boundary'});
  const names=report.records.map(row=>row.name);assert.equal(new Set(names).size,8);
  assert.equal(sha256(JSON.stringify(names)),'401a5e659ca1dfdfcf3da71143b87d21a55e5222b00f7b157a4c97cf2ae6626d');
  return names;
}
export function verifyAssistantNativeRateUnion(previous,partial,advanced,fresh){
  const retained=[...assistantPreviousNative(previous).records.map(row=>row.name),...assistantPartialNative(partial),...assistantAdvancedNative(advanced)];
  assert.equal(fresh.failedSuites,0);assert.equal(fresh.reports.length,1);assert.equal(fresh.passed,100);
  const report=fresh.reports[0];assert.equal(report.suite,'canvas');assert(!report.failure);
  const metrics=report.metrics.filter(row=>row.assistantRateTail);assert.equal(metrics.length,1);const evidence=metrics[0].assistantRateTail;
  assert.deepEqual(evidence.retained,retained);assert.equal(evidence.currentfullcount,251);assert.equal(evidence.discovery.length,251);assert.equal(new Set(evidence.discovery).size,251);
  assert.equal(sha256(JSON.stringify(evidence.discovery)),'3bcde3da85495a7cfa8190ca3ad20f8f255c7b065941f88cfbf5d1c75cd3640f');
  assert.deepEqual(evidence.discovery.slice(0,151),evidence.retained);assert.deepEqual(evidence.fresh,evidence.discovery.slice(151));
  assert.deepEqual(report.records,evidence.fresh.map(name=>({name,status:'PASS'})),'All failed/unstarted callbacks must pass once without rerunning retained cases');
  return {workerPassed:1630,processorPassed:true,launcherPassed:30,nativeRetained:334,nativeFresh:100,nativeTotal:434};
}
export function verifyAssistantNativeRate(directory,head,{allowPending=false}={}){
  const p=ASSISTANT_NATIVE_RATE;assertCanvasPreflightTree(head,gitBytes,p);
  const pinned=(file,hash)=>{const bytes=fs.readFileSync(path.join(directory,file));assert.equal(sha256(bytes),hash,`Changed original assistant tail evidence: ${file}`);return bytes;};
  const original=JSON.parse(pinned('reuse/preflight-checkpoint.json',p.checkpoint));assert.equal(original.sha,p.source);assert.equal(original.status,'failed');assert.equal(original.commands.length,42);
  assert(original.commands.slice(0,41).every(row=>row.exitCode===0));assert.equal(original.commands[41].exitCode,1);
  assert.deepEqual(original.preflightContinuation,{source:ASSISTANT_NATIVE_TAIL.source,checkpoint:ASSISTANT_NATIVE_TAIL.checkpoint});
  const origin=path.join(directory,'reuse/test-results/assistant-native-tail-origin');
  const {previous,partial}=verifyAssistantNativeTail(origin,p.source,{allowPending:true});
  const commands=selectedCommands(original.selection,{GITHUB_SHA:p.source,CANDIDATE_BASE:original.base});
  for(const [index,row]of original.commands.entries()){
    assert.deepEqual(row.command,commands[index]);assert.equal(sha256(fs.readFileSync(path.join(origin,row.log))),row.logHash,'Changed completed original command evidence');
  }
  assert.equal(original.commands[17].continuation,assistantNativeTailGuard(commands[17].run));assert.equal(original.commands[41].continuation,assistantNativeTailContinuation(commands[41].run));
  pinned('reuse/test-results/assistant-native-tail-origin/logs/17.log',p.completedGuardLog);
  pinned('reuse/test-results/assistant-native-tail-origin/test-results/assistant-native-tail-discovery.json',p.discovery);
  const log=pinned('reuse/preflight-failed.log',p.failedLog).toString();assert(log.includes('/tmp/bitbi-release/q2-runtime-evidence/native-Oz9Lkm'));
  const manifest=JSON.parse(pinned('reuse/hosting-manifest.json',p.manifest)),hosting=JSON.parse(pinned('reuse/hosting-proof.json',p.proof));
  assert.equal(manifest.sha,p.source);assert.equal(hosting.manifestHash,sha256(JSON.stringify(manifest)));assert.equal(hosting.job,'frontend-runtime');assert.equal(hosting.status,'passed');
  restoreCanvasHostingProof(origin,{verifyOnly:true});
  const records=Object.fromEntries(Object.entries(p.nativeProof).map(([file,hash])=>[file,JSON.parse(pinned('reuse/test-results/assistant-native-tail-original/'+file,hash))]));
  const launcher=records['launcher-result.json'];assert.equal(launcher.status,1);assert.equal(launcher.mode,'runtime');assert.equal(launcher.origin,LOCAL_POLICY);assert.equal(launcher.childBoundaryVerified,false);assert.equal(launcher.hostedImage.GITHUB_SHA,p.source);
  assert.equal(launcher.hostInterfacesUnchanged,true);assert.equal(launcher.hostRoutesUnchanged,true);assert.deepEqual(launcher.postcheckFailures,[]);
  for(const file of ['reports/isolation-result.json','reports/isolation-final.json'])assert.equal(records[file].passed,true);
  const advanced=records['reports/bitbi-q2-runtime-GnqR5x__result.json'];assistantAdvancedNative(advanced);assert.deepEqual(advanced.provenance,records['reports/bitbi-q2-runtime-GnqR5x__build-provenance.json']);
  assert.equal(advanced.provenance.bundleSha256,previous.provenance.bundleSha256);assert.deepEqual(advanced.provenance.sourceLedger,previous.provenance.sourceLedger);
  const discoveryFile=path.join(directory,'test-results/assistant-native-rate-discovery.json');
  if(fs.existsSync(discoveryFile)){
    const current=parseDiscovery(fs.readFileSync(discoveryFile,'utf8'));assert.deepEqual(current.errors,[]);
    const prior=parseDiscovery(fs.readFileSync(path.join(origin,'test-results/assistant-native-tail-discovery.json'),'utf8'));
    const identities=report=>workerDiscovery(report).map(({id,file,title})=>({id,file,title})).sort((a,b)=>a.id.localeCompare(b.id));
    assert.equal(identities(current).length,1630);assert.deepEqual(identities(current),identities(prior),'Changed Worker discovery cannot inherit success');
  }else assert(allowPending,'Missing current complete Worker discovery');
  if(allowPending)return {original,previous,partial,advanced,result:null};
  const freshLog=fs.readFileSync(path.join(directory,'test-results/assistant-native-rate.log'),'utf8');verifyNativeLocalReports(directory,freshLog);
  const references=freshLog.split('\n').flatMap(line=>{try{const row=JSON.parse(line);return row.q2LinuxEvidence?[row.q2LinuxEvidence]:[];}catch{return [];}});assert.equal(references.length,1);
  const folder=path.join(directory,'runtime',references[0].slice('/tmp/bitbi-release/'.length)),entry=JSON.parse(fs.readFileSync(path.join(folder,'launcher-result.json')));assert.equal(entry.hostedImage.GITHUB_SHA,head);
  const reports=path.join(folder,'reports'),files=fs.readdirSync(reports).filter(file=>file==='result.json'||file.endsWith('__result.json'));assert.equal(files.length,1);
  const fresh=JSON.parse(fs.readFileSync(path.join(reports,files[0])));
  assert.equal(fresh.provenance.bundleSha256,previous.provenance.bundleSha256,'Retained native application bundle changed');assert.deepEqual(fresh.provenance.sourceLedger,previous.provenance.sourceLedger,'Retained native application source changed');
  return {original,previous,partial,advanced,result:verifyAssistantNativeRateUnion(previous,partial,advanced,fresh)};
}
export const ASSISTANT_WORKER_PREFLIGHT=Object.freeze({
  source:'f530bcff45bb177ff8ef567751bcf6b3d107f9d6',
  checkpoint:'785fae86dd50aafbec41ffe5de89df431d63121b5a7ada92cb9bc5a8bf38e27a',
  failedLog:'689f204b68d97586e37d6c7c71ca2fe0cf0d51ae75ec070d8b83c63b973c9d0c',
  completedGuardLog:'b813077d8ff69b9b643d418210e1785a866c49f1d7673666e72361f69772aafd',
  lastRun:'50ffe121db4db4587d182032bc6e26f7103e2d666229fa91496972fa258381b0',
  discovery:'6bc5b466de483c4b26b5b6d909f3bdfd83957118749e17bd3bdc1b0f60a464f2',
  specs:Object.freeze({
    'workers/ai/src/lib/canvas-agent-plan.js':'0cbff6a86456060647194f482c9c804cb1ac5243fa1394b86d028509d7da5064',
    'workers/auth/src/lib/canvas-agent-conversation.js':'ade4600f0cf83715a4f024601a1e395fc8b643a9d8a1e11029559b9b1b3ea6e3',
    'js/shared/canvas-conversation-decision-intent.mjs':'27bc7b57d347b4d56584f1f3adc604f929a08f010aaf022d110653a4532ffb7b',
    'tests/helpers/canvas-agent-conversation-control.mjs':'c34d6eca95ecbca19db71ab4a0dea00919e51927b20a6ea1bd2748839d126442',
    'tests/helpers/canvas-agent-natural-control.mjs':'ea8edb6413d3391dfedca3426b0c3be6cb61a038b7f2d067e51124d8383998dd',
    'workers/auth/src/lib/member-generation-jobs.js':'8e0fe734d16e33f66b9712ee3a43bf4d5a2b747a0fc5117ab480bfc8e7d54b6e',
    'workers/auth/src/routes/ai/images-write.js':'3cb2e83704205e00190fe42ad13148cbb31a9d79c0ff7c9f6980ca0ea06c16a2',
    'tests/helpers/member-generation-control.mjs':'3cd97f3c4f7ad1f69213aa6557b8b724f24c036cac0802e50f69d56e934ef73f',
    'tests/rel01/routes/workers.spec.js':'1b6efcdd7299571c7e49a3380ec4c5f71abcd518ad152ad0cd20cce0f5886a82',
    'tests/helpers/release-transition-legacy-contract.cjs':'4d93f64b8b0d14d43da91c46ebcdf0d6e532c38a8f4d81faef1bbd1d198213c1',
    'tests/workers.spec.js':'6f57c6433e56319dc78500c5446556567af2ca8f2b3b6f72d85e32a89daa0431',
    'workers/auth/src/lib/image-generation-capacity.js':'aa589011d819492946ac17c8810e5bd9efe565cb49e9df2b728360d6dabd5031',
    'tests/helpers/canvas-image-scheduling-control.mjs':'9a7052f77e769e0f08dd3da83c372927601846113fff211af1aba49f63f007e2',
    'tests/q2-canvas-image-scheduling.spec.js':'bae02899922677f36f017af5f610d14d384f4d9e3138b023ebfb74123a7379b2',
    'tests/helpers/q2-runtime/canvas.mjs':'1e62dfa85e7371ef325260237d5f794d5630c2264ef892e35f46d77f12bc6f5f',
    'docs/production-readiness/CANVAS_AGENT.md':'5d2e18eb5c3330c068130fb27e9b5443dcb442e371eef9a7b30671ec34421480',
    'scripts/lib/ci-test-selection.mjs':'9cd67a10a945f7123214cdc6e039a63360cf0f805ef3c1ca318991775d463519',
    'scripts/test-ci-test-selection.mjs':'eff7710d9e212802af27f325db6809b3652e8c1352df61cd202b1106c5d79863',
    'scripts/test-local-release.mjs':'7208cc9da48c13e8f572a5e41b10b66fd7c7d616902d66c0af4d69d10c0f0a6f',
  }),
  retain:[1,4,5,6,8,9,10,11,13,18,19,20,21,22,23,24,25,26,27,28,30,31,32,33],
});
export const assistantWorkerFailures=Object.freeze([
  'Canvas conversation briefing through authenticated durable production boundaries',
  'Canvas conversation isolation through authenticated durable production boundaries',
  'Canvas conversational actions consent update ordinary owned project services',
  'Canvas conversational actions budget-controls update ordinary owned project services',
  'Canvas queued legacy v1 dialogue prepares its exact approved old prompt and quote after the action policy release',
  'REL-01 actual member image route: unknown timeout blocks replay with late success',
  'REL-01 actual member image route: unknown timeout blocks replay with late failure',
  'Release transition: already completed old marker may continue once; its migrated receipt blocks new work and settlement',
  'connected text output becomes the authoritative image prompt when the target has no override',
  'durable member generation: asset-naming-image',
  'durable member generation: asset-naming-image-manual',
  'durable member generation: image',
]);
export const assistantWorkerNewCase=Object.freeze({file:'q2-canvas-image-scheduling.spec.js',title:'Canvas image durable scheduling organization-recovery'});
export function assistantWorkerGuardContinuation(command) {
  assert.equal(command,'npm run test:local-release');return command+' -- --assistant-worker-only';
}
export function assistantWorkerContinuation(command) {
  assert.equal(JSON.parse(fs.readFileSync('package.json')).scripts['test:workers'],
    'node scripts/check-media-tools.mjs && npm run test:website-assistant && node scripts/check-q4-selection.mjs && playwright test -c playwright.workers.config.js && npm run test:homepage-ffmpeg-processor && npm run test:q2-runtime','Worker chain changed');
  assert.equal(command.split('  npm run test:workers').length,2);
  assert(command.endsWith('else\n  npm run test:workers\nfi\n'),'Missing complete ordinary Worker branch');
  const fresh=[
    'mkdir -p .local-release/test-results',
    'PLAYWRIGHT_JSON_OUTPUT_NAME= npx playwright test -c playwright.workers.config.js --list --reporter=json > .local-release/test-results/assistant-worker-discovery.json',
    'node scripts/local-release.mjs verify-assistant-worker-pending .local-release',
    `PLAYWRIGHT_JSON_OUTPUT_NAME=.local-release/test-results/assistant-worker-fresh.json npx playwright test -c playwright.workers.config.js --grep '(?:${[...assistantWorkerFailures,assistantWorkerNewCase.title].join('|')})$' --output=test-results/assistant-worker-artifacts --workers=1 --retries=0 --reporter=list,json`,
    'node scripts/local-release.mjs verify-assistant-worker-repair .local-release',
    'npm run test:homepage-ffmpeg-processor',
    'npm run test:q2-runtime',
  ].map(line=>'  '+line).join('\n');
  return command.replace('  npm run test:workers',()=>fresh);
}
export function verifyAssistantWorkerRepair(directory,head,{allowPending=false}={}) {
  const p=ASSISTANT_WORKER_PREFLIGHT;assertCanvasPreflightTree(head,gitBytes,p);
  const pinned=(file,hash)=>{const bytes=fs.readFileSync(path.join(directory,'reuse',file));assert.equal(sha256(bytes),hash,`Changed original assistant evidence: ${file}`);return bytes;};
  const original=JSON.parse(pinned('preflight-checkpoint.json',p.checkpoint));
  assert.equal(original.sha,p.source);assert.equal(original.status,'failed');assert.equal(original.commands.length,42);
  assert(original.commands.slice(0,41).every(row=>row.exitCode===0));assert.equal(original.commands[41].exitCode,1);
  const origin=path.join(directory,'reuse/test-results/assistant-preflight-origin');
  verifyCanvasPreflight(origin,original,selectedCommands(original.selection,{GITHUB_SHA:original.sha,CANDIDATE_BASE:original.base}));
  assert.equal(sha256(fs.readFileSync(path.join(origin,'logs/17.log'))),p.completedGuardLog,'Changed completed verifier tail');
  const log=pinned('preflight-failed.log',p.failedLog).toString(),last=JSON.parse(pinned('original-worker-last-run.json',p.lastRun));
  const before=workerDiscovery(parseDiscovery(pinned('original-worker-discovery.json',p.discovery).toString()));
  assert.equal(before.length,1629);assert(log.includes('Running 1629 tests using 1 worker'));
  assert.match(log,/\n\s+12 failed\n/);assert.match(log,/\n\s+1617 passed \(3\.1m\)/);
  const prefix=log.split('Running 1629 tests using 1 worker')[0];
  assert.match(prefix,/# tests 61\n# suites 0\n# pass 61\n# fail 0\n# cancelled 0\n# skipped 0/);
  assert.match(prefix,/Q4 normal Worker discovery:/);assert.match(prefix,/"mediaTools":\{"ffmpeg":"6\.1\.1-3ubuntu5","ffprobe":"6\.1\.1-3ubuntu5"\}/);
  assert(!log.includes('> test:homepage-ffmpeg-processor\n')&&!log.includes('> test:q2-runtime\n'),'Original media/native tail was never executed');
  const previous=workerListResults(log,before),failed=previous.filter(row=>!passedOnce(row));
  assert.deepEqual(failed.map(row=>row.title).sort(),[...assistantWorkerFailures].sort());
  assert(failed.every(row=>row.results.length===2&&row.results.every((result,index)=>result.status==='failed'&&result.retry===index)),'Both original failures remain failed');
  assert.equal(last.status,'failed');assert.deepEqual(failed.map(row=>row.id).sort(),[...last.failedTests].sort());
  const discoveryFile=path.join(directory,'test-results/assistant-worker-discovery.json');let discovery=null;
  if(fs.existsSync(discoveryFile)){
    const report=parseDiscovery(fs.readFileSync(discoveryFile,'utf8'));assert.deepEqual(report.errors,[]);discovery=workerDiscovery(report);
    assistantWorkerDiscovery(before,discovery);
  }
  if(allowPending)return {original,previous,discovery,result:null};
  assert(discovery,'Missing fresh full Worker discovery');
  const fresh=JSON.parse(fs.readFileSync(path.join(directory,'test-results/assistant-worker-fresh.json')));
  assert.deepEqual(fresh.errors,[]);assert.equal(fresh.config.workers,1);
  assert.equal(fresh.stats.expected,13);assert.equal(fresh.stats.unexpected,0);assert.equal(fresh.stats.flaky,0);assert.equal(fresh.stats.skipped,0);
  const result=verifyAssistantWorkerUnion({previous,discovery,progress:executedWorkers(fresh)});
  assert.deepEqual(result,{originalPassed:1617,correctedPassed:12,newPassed:1,total:1630});
  return {original,previous,discovery,result};
}
function assistantWorkerDiscovery(previous,discovery) {
  const identities=rows=>rows.map(({id,file,title})=>({id,file,title})).sort((a,b)=>a.id.localeCompare(b.id));
  const originalIds=new Set(previous.map(row=>row.id));
  assert.equal(originalIds.size,previous.length,'Duplicate original Worker identity');
  assert.equal(new Set(discovery.map(row=>row.id)).size,discovery.length,'Duplicate current Worker identity');
  const added=discovery.filter(row=>!originalIds.has(row.id));
  assert.equal(added.length,1,'Only the reviewed organization case may enter discovery');
  assert.deepEqual({file:added[0].file,title:added[0].title},assistantWorkerNewCase);
  assert.deepEqual(identities(discovery.filter(row=>originalIds.has(row.id))),identities(previous),'Changed existing Worker discovery cannot inherit cases');
  return added[0];
}
export function verifyAssistantWorkerUnion({previous,discovery,progress}) {
  const added=assistantWorkerDiscovery(previous,discovery),fresh=progress.filter(row=>row.id===added.id);
  assert.equal(fresh.length,1,'New organization case needs exactly one result');
  assert.deepEqual({file:fresh[0].file,title:fresh[0].title},assistantWorkerNewCase);
  assert(passedOnce(fresh[0]),'New organization case must pass once without retries');
  const result=verifyWorkerUnion({previous,discovery:discovery.filter(row=>row.id!==added.id),progress:progress.filter(row=>row.id!==added.id),corrected:[]});
  return {originalPassed:result.originalPassed,correctedPassed:result.progressPassed,newPassed:1,total:result.total+1};
}
export const MODEL_WORKER_PREFLIGHT=Object.freeze({
  source:'51fb4088d317baea440d037d9301c7f48e07e41e',
  checkpoint:'f2b17d5c79fc4413132c88f71967bf41e4d70c595e9b8c750270509cd1b7d9a6',
  failedLog:'d0407c6271a6bcf157c3f5ea80be8ac6b58186bf6d91125d4e0ab5f1f6dcf32e',
  lastRun:'1dad35b2cfea78889cabc8c084d3053c4b11bfdc85a1f75918e30e95156625df',
  discovery:'03eac7b33f2d09a4a75d5ed5035dda738943c3ce93bbb9f19c98ea0eb4aa2f54',
  specs:Object.freeze({
    'tests/q2-canvas-agent-provider.spec.js':'5c9bbd86d08102a1c945b8154ca023b186189a03049dc0d72e06d0d854fe4da2',
    'tests/helpers/canvas-agent-model-operation-cases.mjs':'13a34b7c2e3c2f767b3fde4c3fa611fb3c5af384ca8be517df51e4a3d10fcf1c',
  }),
  retain:[1,4,5,6,7,8,9,10,11,12,13,14,15,16,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,40],
});
// Closed continuation of the failed natural-chat candidate. Only its two
// stale policy test cases (including historical/negative controls) may change;
// product/runtime/discovery remain pinned.
export const CANVAS_POLICY_WORKER_PREFLIGHT=Object.freeze({
  source:'61109a3558f8e446f319bb160d40c7f76c8187f5',
  manifest:'f25e50c9de4d21f6d2c6575b629525c0a71e86ec8d159f6df64545f3221c2c5d',
  proof:'5c15b010ac62d1d0cc7fc04327f6ffcd603a43d22664538f6368d3117d511b4b',
  hostingLog:'aef626922741ac309b18c2d537f80145ca02975eca7896ae517a392c5ef543bb',
  nativeReport:'db385b9933acb415ab8f48aeb71d79184d223850c688da72c2c16bfb6c17fea0',
  nativeProvenance:'2ae067eb439dbe0215d2e23b484d8b451b3a441905ee4d049e4b56e91f0a565f',
  checkpoint:'af9092dad3dee9102996bf5eb0f620f218e0f94778bab64ac348b59b98b40cca',
  failedLog:'2d601fcd38499b23414a2ba4fa984409a127dcf5e985a59470ad07fac03af52e',
  lastRun:'d9768a76ff6e183719a58e0d77a84d085d54af73e9f6f856fdfeb6b893c0ad52',
  discovery:'015672ee5e1c4b0f1a3168276ca2d704e7fb181c1bb33fd29340f80225872914',
  specs:Object.freeze({'tests/q2-canvas-agent-provider.spec.js':'4a6aeae32503b44d41f312b7fa4539a9850994828f6e01dd3f5fe22ccb1db9b6'}),
  retain:[1,4,5,6,7,8,9,10,11,12,13,14,15,16,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,36,40],
});
// Closed native continuation: the preceding failed command retains its genuine
// processor/launcher passes and 187 native records, never its failed status.
export const CANVAS_POLICY_NATIVE_PREFLIGHT=Object.freeze({
  source:'f58a9e5d87069df43e2094511b6e1376e5c252ab',
  checkpoint:'8a697bd671f810d9466c8859f0a67d6c7f09e32b5fa1ec68a7bca1ccd562ce66',
  failedLog:'a2cefbe2803e36fd2eadb0541ceec99e84cbea1967bb8cc6a6a07b3644479be3',
  manifest:'68a74d199d3f139d0eef144100942be745df463c62e661385fbcabeffcd0195b',
  proof:'3c27812324696318ba069e39d7ed0e655c9246ef12aa7b09d08e6ba7dc145625',
  hostingLog:CANVAS_POLICY_WORKER_PREFLIGHT.hostingLog,
  unitTap:'e2bd41ec8db60f75c6537bf1388f4ec4ce1b7bc9de3b1ed77f3fadbd1fb1ee67',
  unitProvenance:'fa921b07aeb7bf22ce057f340c6424b9626f82db8c4e46ca2825b86544de80a0',
  nativeProof:Object.freeze({
    'launcher-result.json':'f07c21c0abc886aadf274ce6e4c7d93c965b6881e1750d0093c33bd406e40455',
    'reports/isolation-result.json':'c609013b5a939b464aaa1834e97286e6ec5c0f4eb4c069f1af40770a6527b11e',
    'reports/isolation-final.json':'3722a729b374515d022042aa6df90f8f984b91c3086a0a52d42884219ce98055',
    'reports/bitbi-q2-runtime-kF85Dh__result.json':'09bc5b3bcfa3aafb89827c543c32723183a6777781e5510d1da684e417debb01',
  }),
  specs:Object.freeze({
    'tests/helpers/q2-runtime/canvas.mjs':'e957a81095b0d5ac5484f2de724833abd0f9b871ef56705aeff08974da06ad6b',
    'tests/helpers/q2-runtime/canvas-policy-tail.mjs':'ee9eca4f3801894dc74459352562d7d1105aa74766d094d5f2629e4eb629fc9a',
    'tests/helpers/q2-runtime/runner.mjs':'b6d2bd9d05f92a3f1f2d365f3bb89e76d0119b19912c85521e718fe91df5e4fa',
    'tests/helpers/q2-runtime/linux-hosted.mjs':'ca8a172c3e2f5df2a57bf5c30af63cda76a92229eb1bace2f94a45aecfec2b87',
    'tests/helpers/q2-runtime/linux-bootstrap.py':'52da65d74cc9b24487d50c3df77a506a334125ba2638391b3fb11810613c7914',
    'tests/helpers/q2-runtime/linux-runtime-child.mjs':'3dc9107cb891b88812f4f8e7a6c9d81aae7c2412daf35dc352a22fd2910af233',
    'scripts/test-q2-runtime-launcher.mjs':'1f899218b6d6b083471b57817727842b8e0cf90bb33819ab6811674569ea39bf',
    'docs/runbooks/REGRESSION_REGISTER.md':'ccf104f141fdc5439ddda8f4c26457621149a8cfe34e42c3cdfe81b577aff923',
  }),
  retain:[1,4,5,6,7,8,9,10,11,12,13,14,15,16,18,19,20,21,22,23,24,25,26,27,28,30,31,32,33,36,40],
});
export const CANVAS_POLICY_NATIVE_PROGRESS=Object.freeze({
  source:'100645a3a501d98aff50e6235fbeaf4844016790',
  run:'100645a3a501d98aff50e6235fbeaf4844016790-ecbda8cf-b05e-4af3-9b1a-02d9aa46a8e1',
  baseRun:'f58a9e5d87069df43e2094511b6e1376e5c252ab-5ee9481b-6705-41e6-a6a1-c74f652e4709',
  checkpoint:'4c72145d129a77f26d55354bd238d4ce5dd8c0d73c14c29066cb09817a5ee977',
  failedLog:'856b883d3abe7ded5aa83cb6e87788d05f0328afb45c3b56b2ef741be01009ba',
  guardTap:'ee0f09f85d4b5b6af9477493f637e465dfcfeaa230ee85cd287b92efb97fdd55',
  originalGuardLog:'8a727ff452296bdf8663a28dba675f675dac4357493322618cf013571fe8c44f',
  nativeProof:Object.freeze({
    'launcher-result.json':'cd53d33a5e6802dfe79b74ec58323a06a121990458148b6efa574e243906ebea',
    'reports/isolation-result.json':'c609013b5a939b464aaa1834e97286e6ec5c0f4eb4c069f1af40770a6527b11e',
    'reports/isolation-final.json':'3722a729b374515d022042aa6df90f8f984b91c3086a0a52d42884219ce98055',
    'reports/bitbi-q2-runtime-OBO7jU__result.json':'166a3189cabfd6f9eec2b61f5dd26cf329b9af44af45e83aef42120a4e579a87',
  }),
  specs:Object.freeze({
    'workers/auth/src/routes/canvas.js':'22eb4f32d7401dfaf355115bdd04bd2d5a117fdb6be30ab4c3212f3f3ed62411',
    'tests/helpers/canvas-agent-natural-control.mjs':'807e3fa413a3398659859644a1437577e05661d2c4b03697d2df5ec23e09fd28',
    'tests/helpers/q2-runtime/canvas-policy-tail.mjs':'101ca8ffc0b8eea21cb2079a0ac5556a962a11f6fb986520dfe31b868773cffb',
    'tests/helpers/q2-runtime/runner.mjs':'3b827ebaebbb3f286cdecc9ca690e38ac535044fe6288f21647fd960ac457593',
    'tests/helpers/q2-runtime/linux-hosted.mjs':'7b1c56d995269f7d08b02859ebfe1c35e26fee8e93ce2debb5c0e160af91e33a',
    'tests/helpers/q2-runtime/linux-runtime-child.mjs':'ff434eec0adb1306a5fddc0e6ea6a1dab1fa12d2a0c0f9f3c516582604f50d13',
    'tests/helpers/q2-runtime/linux-bootstrap.py':'6317cd37939f4cac12253f3f92631c8e3577228853632e23e28a999a30365cf8',
    'scripts/test-q2-runtime-launcher.mjs':'f8d433e91cedc25bb55b628e2ac83838cb6b156d6204bf7213062e789dd7b35c',
    'docs/runbooks/REGRESSION_REGISTER.md':'c8cf68133dcee96f40b8ef50d53669299af6912173d36f146c2759adda374cc4',
  }),
  retain:CANVAS_POLICY_NATIVE_PREFLIGHT.retain,
});
export const isCanvasPolicyNativeProgress=(head,read=gitBytes)=>read(['rev-list','--parents','-n','1',head]).toString().trim().split(/\s+/)[1]===CANVAS_POLICY_NATIVE_PROGRESS.source;
export function verifyCanvasPolicyNativeProgress(directory,head){
  const p=CANVAS_POLICY_NATIVE_PROGRESS;assert(isCanvasPolicyNativeProgress(head),'Not the closed native action successor');assertCanvasPreflightTree(head,gitBytes,CANVAS_POLICY_NATIVE_PREFLIGHT);
  const root=path.join(directory,'reuse/canvas-policy-native-progress');
  const pinned=(file,hash)=>{const bytes=fs.readFileSync(path.join(root,file));assert.equal(sha256(bytes),hash,`Changed native progress evidence: ${file}`);return bytes;};
  const original=JSON.parse(pinned('checkpoint.json',p.checkpoint));
  assert.equal(original.sha,p.source);assert.equal(original.status,'failed');assert.equal(original.commands.length,42);assert(original.commands.slice(0,41).every(row=>row.exitCode===0));assert.equal(original.commands[41].exitCode,1);
  assert.deepEqual(original.preflightContinuation,{source:CANVAS_POLICY_NATIVE_PREFLIGHT.source,checkpoint:CANVAS_POLICY_NATIVE_PREFLIGHT.checkpoint});assert(!original.preflightProgress);
  const base=JSON.parse(fs.readFileSync(path.join(directory,'reuse/preflight-checkpoint.json')));
  for(const key of ['base','planHash'])assert.equal(original[key],base[key]);assert.equal(original.environment.key,base.environment.key);assert.equal(original.nativeBrowsers.key,base.nativeBrowsers.key);
  pinned('failed.log',p.failedLog);pinned('guard-command.log',p.originalGuardLog);assert.equal(original.commands[17].logHash,p.originalGuardLog);
  assert.deepEqual(tapResults(pinned('guard.tap',p.guardTap).toString()).filter(row=>row.status!=='skipped'),[{title:'Canvas policy tail fixes the complete actual inventory and never repeats retained callbacks',status:'passed'}]);
  const records=Object.fromEntries(Object.entries(p.nativeProof).map(([file,hash])=>[file,JSON.parse(pinned('native/'+file,hash))]));
  const entry=records['launcher-result.json'];assert.equal(entry.status,1);assert.equal(entry.childBoundaryVerified,false);assert.equal(entry.mode,'runtime');assert.equal(entry.origin,LOCAL_POLICY);assert.equal(entry.hostInterfacesUnchanged,true);assert.equal(entry.hostRoutesUnchanged,true);assert.deepEqual(entry.postcheckFailures,[]);
  for(const file of ['reports/isolation-result.json','reports/isolation-final.json'])assert.equal(records[file].passed,true);
  const result=records['reports/bitbi-q2-runtime-OBO7jU__result.json'];assert.equal(result.passed,168);assert.equal(result.failedSuites,1);assert.deepEqual(result.reports.map(row=>row.suite),['canvas']);
  assert.deepEqual(result.reports[0].records,canvasPolicyTailInventory.slice(0,168).map(name=>({name,status:'PASS'})));
  assert.deepEqual(result.reports[0].failure,{stage:canvasPolicyTailInventory[168],name:'Error',message:'Real actions must finish: music_source:completed/canvas_agent_action_completed,music_fade_out:completed/canvas_agent_action_completed,original_audio_volume:failed/canvas_project_changed,music_enabled:failed/canvas_agent_action_dependency_failed'});
  return {original,previous:result.reports[0].records,retained:p.retain};
}
export function verifyCanvasPolicyNativeProgressUnion(previous,progress,fresh){
  assert.deepEqual(progress,canvasPolicyTailInventory.slice(0,168).map(name=>({name,status:'PASS'})),'Changed retained native progress');
  assert.deepEqual(fresh.map(row=>row.name),canvasPolicyTailInventory.slice(168),'Missing or repeated remaining action case');
  verifyCanvasPolicyNativeUnion(previous,[...progress,...fresh]);
  return {nativeRetained:355,nativeFresh:15,nativeTotal:370,processorRetained:true,launcherRetained:28};
}
export function canvasPolicyNativeGuardContinuation(command){
  assert.equal(command,'npm run test:local-release');return command+' -- --canvas-policy-native-progress-only';
}
export function verifyCanvasPolicyNativeUnion(previous,fresh){
  assert.equal(previous.length,187,'Missing retained native case');
  assert(previous.every(row=>typeof row.suite==='string'&&row.suite&&typeof row.name==='string'&&row.status==='PASS'));
  assert.equal(new Set(previous.map(row=>row.suite+':'+row.name)).size,187,'Duplicate retained native case');
  assert.deepEqual(previous.filter(row=>row.suite==='canvas').map(row=>row.name),canvasPolicyPrefix,'Changed retained Canvas prefix');
  assert.deepEqual(fresh.map(row=>row.name),canvasPolicyTailInventory,'The complete remaining Canvas inventory must execute once in order');
  assert(fresh.every(row=>row.status==='PASS'),'Remaining Canvas native case failed');
  assert.equal(new Set(fresh.map(row=>row.name)).size,fresh.length,'Duplicate remaining Canvas case');
  assert(fresh.every(row=>!previous.some(old=>old.suite==='canvas'&&old.name===row.name)),'Already proven Canvas cases must not repeat');
  return {nativeRetained:187,nativeFresh:fresh.length,nativeTotal:187+fresh.length,processorRetained:true,launcherRetained:27};
}
export function verifyCanvasPolicyNativeRepair(directory,head,{allowPending=false}={}){
  const p=CANVAS_POLICY_NATIVE_PREFLIGHT;assertCanvasPreflightTree(head,gitBytes,p);
  assert.equal(canvasPolicyTailInventory.length,183);assert.equal(sha256(JSON.stringify(canvasPolicyTailInventory)),'3508520a93ef1a06908ad615b72d1654b8d9c01db20207cf17ab0695f85d878a','Closed remaining native inventory changed');
  const pinned=(file,hash)=>{const bytes=fs.readFileSync(path.join(directory,'reuse',file));assert.equal(sha256(bytes),hash,`Changed original native evidence: ${file}`);return bytes;};
  const original=JSON.parse(pinned('preflight-checkpoint.json',p.checkpoint));
  assert.equal(original.sha,p.source);assert.equal(original.status,'failed');assert.equal(original.commands.length,42);
  assert(original.commands.slice(0,41).every(row=>row.exitCode===0));assert.equal(original.commands[41].exitCode,1);
  const origin=path.join(directory,'reuse/canvas-policy-worker-origin');
  verifyCanvasPreflight(origin,original,selectedCommands(original.selection,{GITHUB_SHA:original.sha,CANDIDATE_BASE:original.base}));
  const log=pinned('preflight-failed.log',p.failedLog).toString();
  assert.match(log,/homepage ffmpeg processor tests passed/);assert.match(log,/Private video reference FFmpeg: .*passed\./);
  const boundary='> test:q2-runtime\n> node --test tests/q2-recovery-staging.test.mjs scripts/test-q2-runtime-launcher.mjs && node scripts/test-q2-runtime.mjs\n';
  assert.equal(log.split(boundary).length,2);const launcher=tapResults(log.split(boundary)[1]);
  assert.equal(launcher.length,27);assert.equal(new Set(launcher.map(row=>row.title)).size,27);assert(launcher.every(row=>row.status==='passed'));
  const records=Object.fromEntries(Object.entries(p.nativeProof).map(([file,hash])=>[file,JSON.parse(pinned('canvas-native-original/'+file,hash))]));
  const entry=records['launcher-result.json'];assert.equal(entry.status,1);assert.equal(entry.childBoundaryVerified,false);assert.equal(entry.mode,'runtime');assert.equal(entry.origin,LOCAL_POLICY);
  assert.equal(entry.hostInterfacesUnchanged,true);assert.equal(entry.hostRoutesUnchanged,true);assert.deepEqual(entry.postcheckFailures,[]);
  for(const file of ['reports/isolation-result.json','reports/isolation-final.json'])assert.equal(records[file].passed,true);
  const result=records['reports/bitbi-q2-runtime-kF85Dh__result.json'];assert.equal(result.passed,187);assert.equal(result.failedSuites,1);assert.equal(result.reports.length,14);
  const canvas=result.reports.find(suite=>suite.suite==='canvas');assert(canvas);assert.deepEqual(canvas.records,canvasPolicyPrefix.map(name=>({name,status:'PASS'})));
  assert.deepEqual(canvas.failure,{stage:canvasPolicyTailInventory[0],name:'AssertionError',message:'Expected values to be strictly equal:',actual:1,expected:0});
  const previous=result.reports.flatMap(suite=>{assert(suite===canvas||!suite.failure);return suite.records.map(row=>({suite:suite.suite,...row}));});
  assert.equal(previous.length,187);assert(previous.every(row=>row.status==='PASS'));assert.equal(new Set(previous.map(row=>row.suite+':'+row.name)).size,187);
  const unit=pinned('canvas-native-unit.tap',p.unitTap).toString(),unitProvenance=JSON.parse(pinned('canvas-native-unit-provenance.json',p.unitProvenance));
  assert.equal(unitProvenance.kind,'post_execution_tool_output_transcription');assert.equal(unitProvenance.exitCode,0);
  assert.equal(unitProvenance.headObservedAfterExecution,p.source);assert.equal(unitProvenance.runtimeObservedAfterExecution.node,'v22.23.1');assert.equal(unitProvenance.runtimeObservedAfterExecution.platform,'darwin');
  assert.deepEqual(tapResults(unit),[{title:'Canvas rejected reference verifier preserves populated receipts and catches new or changed usage, charges and dispatch',status:'passed'}]);
  assert.match(unit,/# tests 1\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0/);
  const progress=isCanvasPolicyNativeProgress(head)?verifyCanvasPolicyNativeProgress(directory,head):null;
  const allPrevious=progress?[...previous,...progress.previous.map(row=>({suite:'canvas',...row}))]:previous;
  if(allowPending)return {original,previous:allPrevious,result:null};
  const guard=fs.readFileSync(path.join(directory,'test-results/canvas-policy-native-launcher.tap'),'utf8'),guardRows=tapResults(guard);
  const title=progress?'Canvas action tail preserves all setup and executes only the final fifteen required callbacks':'Canvas policy tail fixes the complete actual inventory and never repeats retained callbacks';
  assert.deepEqual(guardRows.filter(row=>row.status!=='skipped'),[{title,status:'passed'}]);
  assert.equal(new Set(guardRows.map(row=>row.title)).size,guardRows.length);
  const allowed=new Set([...launcher.map(row=>row.title),...tapResults(unit).map(row=>row.title),'Canvas policy tail fixes the complete actual inventory and never repeats retained callbacks',title]);
  assert(guardRows.every(row=>allowed.has(row.title)),'Foreign launcher result');assert.match(guard,/# pass 1\n# fail 0\n# cancelled 0\n# skipped \d+\n# todo 0/);
  const freshLog=fs.readFileSync(path.join(directory,'test-results/canvas-policy-native.log'),'utf8');
  const fresh=autonomyNativeRecords(directory,freshLog,{suite:'canvas'});
  return {original,previous:allPrevious,result:progress?verifyCanvasPolicyNativeProgressUnion(previous,progress.previous,fresh):verifyCanvasPolicyNativeUnion(previous,fresh)};
}
export function canvasPolicyNativeContinuation(command,{progress=false}={}){
  const original=modelWorkerContinuation(command,CANVAS_POLICY_WORKER_PREFLIGHT);
  assert(original.includes('npm run test:homepage-ffmpeg-processor')&&original.includes('npm run test:q2-runtime'));
  const fresh=[
    'set -o pipefail',
    'mkdir -p .local-release/test-results',
    'node scripts/local-release.mjs verify-canvas-policy-native-pending .local-release',
    `node --test --test-name-pattern='^${progress?'Canvas action tail preserves all setup and executes only the final fifteen required callbacks':'Canvas policy tail fixes the complete actual inventory and never repeats retained callbacks'}$' scripts/test-q2-runtime-launcher.mjs > .local-release/test-results/canvas-policy-native-launcher.tap 2>&1 || { status=$?; cat .local-release/test-results/canvas-policy-native-launcher.tap; exit "$status"; }`,
    'cat .local-release/test-results/canvas-policy-native-launcher.tap',
    `node scripts/test-q2-runtime.mjs --suite ${progress?'canvas-actions-tail':'canvas-policy-tail'} 2>&1 | tee .local-release/test-results/canvas-policy-native.log`,
    'mkdir -p .local-release/runtime',
    'cp -a /tmp/bitbi-release/q2-runtime-evidence .local-release/runtime/',
    'node scripts/local-release.mjs verify-canvas-policy-native-repair .local-release',
  ].map(line=>'  '+line).join('\n');
  return command.replace('  npm run test:workers',()=>fresh);
}
const canvasPolicyWorkerFailures=[
  'Canvas background evaluation prepares bounded images and keeps persisted validation context free of media',
  'Canvas creative planning receives authoritative budget, conditional constraints and bounded repair without mandatory duration',
];
export const verifyCanvasPolicyWorkerRepair=(directory,head,options={})=>verifyModelWorkerRepair(directory,head,{...options,profile:CANVAS_POLICY_WORKER_PREFLIGHT});
export const canvasPolicyWorkerContinuation=command=>modelWorkerContinuation(command,CANVAS_POLICY_WORKER_PREFLIGHT);
const modelWorkerFailures=[
  'Canvas durable model operation callback-guards',
  'Canvas late background results normalize after disablement, with exact usage and no new provider call',
];
export function verifyModelWorkerRepair(directory,head,{allowPending=false,profile: p=MODEL_WORKER_PREFLIGHT}={}) {
  assert([MODEL_WORKER_PREFLIGHT,CANVAS_POLICY_WORKER_PREFLIGHT].includes(p),'Unknown Worker continuation');
  const policy=p===CANVAS_POLICY_WORKER_PREFLIGHT,total=policy?1547:1454,passed=total-2;assertCanvasPreflightTree(head,gitBytes,p);
  const pinned=(file,hash)=>{const bytes=fs.readFileSync(path.join(directory,'reuse',file));assert.equal(sha256(bytes),hash,`Changed original Worker evidence: ${file}`);return bytes;};
  const original=JSON.parse(pinned('preflight-checkpoint.json',p.checkpoint));
  assert.equal(original.sha,p.source);assert.equal(original.status,'failed');assert.equal(original.commands.length,42);
  assert(original.commands.slice(0,41).every(row=>row.exitCode===0));assert.equal(original.commands[41].exitCode,1);
  if(policy)assert(!original.preflightContinuation&&!original.permissionContinuation&&!original.repair&&original.commands.every(row=>!row.reusedFrom&&!row.continuation),'Unexpected earlier continuation');
  else verifyCanvasPreflight(path.join(directory,'reuse/model-workflow-origin'),original,selectedCommands(original.selection,{GITHUB_SHA:original.sha,CANDIDATE_BASE:original.base}));
  const log=pinned('preflight-failed.log',p.failedLog).toString();
  const last=JSON.parse(pinned('original-worker-last-run.json',p.lastRun));
  const before=workerDiscovery(parseDiscovery(pinned('original-worker-discovery.json',p.discovery).toString()));
  assert.equal(before.length,total);assert(log.includes(`Running ${total} tests using 1 worker`));
  assert.match(log,/\n\s+2 failed\n/);assert.match(log,policy?/\n\s+1545 passed \(2\.4m\)/:/\n\s+1452 passed \(1\.9m\)/);
  // The prefix completed before Playwright. Neither it nor the 1452 passing
  // cases is permission to claim the still-unexecuted processor/native tail.
  const prefix=log.split(`Running ${total} tests using 1 worker`)[0];
  assert.match(prefix,/# tests 61\n# suites 0\n# pass 61\n# fail 0\n# cancelled 0\n# skipped 0/);
  assert.match(prefix,/Q4 normal Worker discovery:/);assert.match(prefix,/"mediaTools":\{"ffmpeg":"6\.1\.1-3ubuntu5","ffprobe":"6\.1\.1-3ubuntu5"\}/);
  const previous=workerListResults(log,before),failed=previous.filter(row=>!passedOnce(row));
  assert.deepEqual(failed.map(row=>row.title).sort(),[...(policy?canvasPolicyWorkerFailures:modelWorkerFailures)].sort());
  if(policy){
    assert(failed.every(row=>row.file==='q2-canvas-agent-provider.spec.js'&&row.results.length===2&&row.results.every((result,index)=>result.status==='failed'&&result.retry===index)),'Original policy failures must remain failed');
    assert(!log.includes('> test:homepage-ffmpeg-processor\n')&&!log.includes('> test:q2-runtime\n'),'The original media/native tail must remain unexecuted');
  }
  assert.equal(last.status,'failed');assert.deepEqual(failed.map(row=>row.id).sort(),[...last.failedTests].sort());
  const discoveryFile=path.join(directory,'test-results/model-worker-discovery.json');
  let discovery=null;
  if(fs.existsSync(discoveryFile)){
    const report=parseDiscovery(fs.readFileSync(discoveryFile,'utf8'));assert.deepEqual(report.errors,[]);
    discovery=workerDiscovery(report);
    const identities=rows=>rows.map(({id,file,title})=>({id,file,title})).sort((a,b)=>a.id.localeCompare(b.id));
    assert.deepEqual(identities(discovery),identities(before),'Changed Worker discovery cannot inherit cases');
  }
  // This one approved correction used the same pinned Node/Playwright versions
  // on macOS, through direct-import prepare/normalize handlers (no workerd,
  // D1, provider or media). Its post-execution source comparison is explicit;
  // neither its receipt nor the failed Linux run claims native/media acceptance.
  let nativeReport=null;
  if(policy){
    nativeReport=JSON.parse(pinned('canvas-policy-node-report.json',p.nativeReport));
    const provenance=JSON.parse(pinned('canvas-policy-node-provenance.json',p.nativeProvenance));
    assert.equal(provenance.head,p.source);assert.equal(provenance.node,'v22.23.1');
    assert.equal(provenance.platform,'darwin');assert.equal(provenance.arch,'arm64');
    assert.equal(provenance.playwright,'1.58.2');assert.equal(provenance.productDiff,'');
    assert.equal(provenance.sha256,p.specs[provenance.file]);assert.equal(provenance.reportSha256,p.nativeReport);
    for(const [file,hash]of Object.entries(provenance.sourceInputs))assert.equal(sha256(gitBytes(['show',`${head}:${file}`])),hash,'Changed native Node acceptance input');
    assert.equal(nativeReport.config.version,provenance.playwright);assert.equal(nativeReport.config.forbidOnly,false);
    assert.equal(nativeReport.config.projects.length,1);assert.equal(nativeReport.config.projects[0].retries,0);
  }
  if(allowPending)return {original,previous,discovery,result:null};
  assert(discovery,'Missing fresh full Worker discovery');
  const fresh=nativeReport||JSON.parse(fs.readFileSync(path.join(directory,'test-results/model-worker-fresh.json')));
  assert.deepEqual(fresh.errors,[]);assert.equal(fresh.config.workers,1);
  assert.equal(fresh.stats.expected,2);assert.equal(fresh.stats.unexpected,0);assert.equal(fresh.stats.flaky,0);assert.equal(fresh.stats.skipped,0);
  const result=verifyWorkerUnion({previous,discovery,progress:executedWorkers(fresh),corrected:[]});
  assert.deepEqual(result,{originalPassed:passed,progressPassed:2,correctedPassed:0,total});
  return {original,previous,discovery,result};
}
export function modelWorkerContinuation(command,profile=MODEL_WORKER_PREFLIGHT) {
  assert([MODEL_WORKER_PREFLIGHT,CANVAS_POLICY_WORKER_PREFLIGHT].includes(profile),'Unknown Worker continuation');
  const policy=profile===CANVAS_POLICY_WORKER_PREFLIGHT,name=policy?'canvas-policy-worker':'model-worker';
  const script=JSON.parse(fs.readFileSync('package.json')).scripts['test:workers'];
  assert.equal(script,'node scripts/check-media-tools.mjs && npm run test:website-assistant && node scripts/check-q4-selection.mjs && playwright test -c playwright.workers.config.js && npm run test:homepage-ffmpeg-processor && npm run test:q2-runtime','Worker chain changed');
  assert.equal(command.split('  npm run test:workers').length,2);assert(command.endsWith('else\n  npm run test:workers\nfi\n'),'Missing complete ordinary Worker branch');
  const fresh=[
    'mkdir -p .local-release/test-results',
    'PLAYWRIGHT_JSON_OUTPUT_NAME= npx playwright test -c playwright.workers.config.js --list --reporter=json > .local-release/test-results/model-worker-discovery.json',
    ...(policy?[]:[
      `node scripts/local-release.mjs verify-${name}-pending .local-release`,
      `PLAYWRIGHT_JSON_OUTPUT_NAME=.local-release/test-results/model-worker-fresh.json npx playwright test -c playwright.workers.config.js tests/q2-canvas-agent-model-operation.spec.js tests/q2-canvas-agent-provider.spec.js --grep '(${modelWorkerFailures.join('|')})$' --workers=1 --retries=0 --reporter=list,json`,
    ]),
    `node scripts/local-release.mjs verify-${name}-repair .local-release`,
    'npm run test:homepage-ffmpeg-processor',
    'npm run test:q2-runtime',
  ].map(line=>'  '+line).join('\n');
  // Keep the grep end-anchor/quote literal; string replacement expands $'.
  return command.replace('  npm run test:workers',()=>fresh);
}
export function modelBrowserContinuation(command,scope='homepage') {
  if(scope==='auth'){
    const original='  PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/candidate-auth.json npm run test:auth -- --output=test-results/browser-artifacts --reporter=list,json';
    assert.equal(command.split(original).length,2);assert(command.endsWith('else\n'+original+'\nfi\n'),'Changed ordinary Auth browser branch');
    return command.replace(original,()=> '  node scripts/local-release.mjs model-browser-continuation auth');
  }
  assert.equal(scope,'homepage');
  assert.equal(command.trim(),'PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/candidate-homepage.json npm run test:homepage-core -- --output=test-results/browser-artifacts --reporter=list,json','Changed ordinary core browser command');
  return 'node scripts/local-release.mjs model-browser-continuation';
}
export const assistantBrowserContinuation=(command,scope='homepage')=>modelBrowserContinuation(command,scope).replace('model-browser-continuation','assistant-browser-continuation');
export function assistantBrowserGuard(command){assert.equal(command,'npm run test:local-release');return command+' -- --assistant-browser-only';}
export const settlementBrowserContinuation=(command,scope='homepage')=>modelBrowserContinuation(command,scope).replace('model-browser-continuation','settlement-browser-continuation');
export function settlementBrowserGuard(command){assert.equal(command,'npm run test:local-release');return command+' -- --settlement-browser-only';}
export function verifyModelBrowserRepair(directory,head,{allowPending=false,profile:p=MODEL_BROWSER_PREFLIGHT}={}) {
  if(p===INCIDENT_BROWSER_PREFLIGHT)return verifyIncidentBrowserReports(directory,head,{allowPending});
  if(p===RELIABILITY_BROWSER_PREFLIGHT)return verifyReliabilityBrowserReports(directory,head,{allowPending});
  assert([MODEL_BROWSER_PREFLIGHT,SETTLEMENT_BROWSER_PREFLIGHT,ASSISTANT_BROWSER_PREFLIGHT].includes(p),'Unknown closed browser profile');assertCanvasPreflightTree(head,gitBytes,p);
  const pinned=(file,hash)=>{const bytes=fs.readFileSync(path.join(directory,'reuse',file));assert.equal(sha256(bytes),hash,`Changed original browser evidence: ${file}`);return bytes;};
  const original=JSON.parse(pinned('preflight-checkpoint.json',p.checkpoint));
  assert.equal(original.sha,p.source);assert.equal(original.status,'failed');assert.equal(original.commands.length,50);
  assert(original.commands.slice(0,49).every(row=>row.exitCode===0));assert.equal(original.commands[49].exitCode,1);
  pinned('preflight-failed.log',p.failedLog);
  const origin=path.join(directory,p===ASSISTANT_BROWSER_PREFLIGHT?'reuse/assistant-native-rate-origin':p===SETTLEMENT_BROWSER_PREFLIGHT?'reuse/settlement-native-progress-origin':'reuse/model-worker-origin');
  verifyCanvasPreflight(origin,original,selectedCommands(original.selection,{GITHUB_SHA:original.sha,CANDIDATE_BASE:original.base}));
  for(const row of original.commands.slice(0,49))assert.equal(sha256(fs.readFileSync(path.join(origin,row.log))),row.logHash,'Changed retained upstream execution log');
  const previous=browserRows(JSON.parse(pinned('model-browser-original.json',p.report)));
  assert.equal(sha256(JSON.stringify(previous)),p.rows);assert.equal(previous.length,p.required);
  if(p===ASSISTANT_BROWSER_PREFLIGHT){
    const failed=previous.filter(row=>!passedBrowserCase(row));
    assert.deepEqual(failed.map(row=>`${row.project}:${row.title}`).sort(),p.failedCases,'Only the original failed browser identities may execute again');
    for(const [file,hash]of Object.entries(p.nativeProof))assert.equal(sha256(fs.readFileSync(path.join(origin,file))),hash,'Changed completed native acceptance');
    assert.equal(sha256(fs.readFileSync(path.join(origin,'candidate/manifest.json'))),p.manifest,'Changed original candidate manifest');
    assert.equal(sha256(fs.readFileSync(path.join(origin,'candidate/proof-frontend-runtime.json'))),p.proof,'Changed original hosting proof');
    // verifyCanvasPreflight above verifies the complete immutable rate-tail
    // union: 1630 Worker, real media, 30 launcher and all 434 native cases.
    assert.equal(sha256(fs.readFileSync(path.join(origin,'test-results/frontend-runtime.log'))),p.hostingLog);
  }
  if(p===SETTLEMENT_BROWSER_PREFLIGHT){
    const failed=previous.filter(row=>!passedBrowserCase(row));assert.equal(failed.length,4);
    assert.deepEqual(failed.map(row=>`${row.project}:${row.title}`).sort(),['chromium:Canvas agent de: outcome','chromium:Canvas agent en: outcome','webkit-canvas:Canvas agent de: outcome','webkit-canvas:Canvas agent en: outcome']);
    for(const [file,hash]of Object.entries(p.nativeProof))assert.equal(sha256(fs.readFileSync(path.join(directory,file))),hash,'Changed completed native acceptance');
    assert.equal(autonomyNativeRecords(directory,fs.readFileSync(path.join(origin,'logs/41.log'),'utf8')).length,385,'Incomplete retained native acceptance');
  }
  const standard=browserRows(JSON.parse(pinned('model-browser-standard.json',p.standardDiscovery)),{discovery:true});
  const auth=standard.filter(row=>row.project==='chromium'&&(/^(auth-admin|wallet-nav|locale|oma2-q1-member)\.spec\.js$/.test(row.file)||row.file.startsWith('oma2-q3-')));
  assert.equal(sha256(JSON.stringify(auth)),p.authDiscovery);assert.equal(auth.length,p.authRequired);
  const overlap=previous.filter(row=>auth.some(item=>item.key===row.key));
  assert.equal(overlap.length,p.authReused);assert(overlap.every(row=>row.file==='locale.spec.js'&&row.project==='chromium'&&row.expectedStatus==='passed'&&row.status==='expected'&&row.results.length===1&&row.results[0].status==='passed'&&row.results[0].retry===0&&!row.results[0].error),'Only the actual first-attempt locale passes may be retained for Auth');
  for(const [file,hash]of Object.entries(p.homepageReports))assert.equal(sha256(fs.readFileSync(path.join(directory,'test-results',file))),hash,'Changed retained homepage acceptance');
  if(allowPending)return {original,previous,result:null};
  const result={};
  for(const scope of ['homepage','auth']){
    const prefix=scope==='auth'?'model-browser-auth':'model-browser';
    const raw=JSON.parse(fs.readFileSync(path.join(directory,`test-results/${prefix}-fresh.json`)));
    assert.deepEqual(raw.errors,[]);assert.equal(raw.config.workers,1);
    const discovery=browserRows(JSON.parse(fs.readFileSync(path.join(directory,`test-results/${prefix}-discovery.json`))),{discovery:true});
    const report=JSON.parse(fs.readFileSync(path.join(directory,`test-results/candidate-${scope}.json`)));
    assert.equal(report.scope,scope);assert.deepEqual(report.previous,previous);assert.deepEqual(report.discovery,discovery);assert.deepEqual(report.fresh,browserRows(raw));
    result[scope]=verifyModelBrowserReport(report,head);
  }
  return {original,previous,result};
}
export function autonomyBrowserContinuation(command,scope='homepage') {
  return modelBrowserContinuation(command,scope).replace('model-browser-continuation','autonomy-browser-continuation');
}
export const autonomyRetentionWorkers=['Canvas native control canvasAssemblyRetentionCase','Canvas assembly retention migration preserves historical export dispositions'];
export const autonomyRetentionLaunchers=['Canvas reference fixture reads the staged bytes from a non-repository cwd','focused native scopes dispatch through the actual child and preserve boundaries'];
export const autonomyRetentionNative=['canvas_assembly_retention_populated_migration','canvas_assembly_completed_delivery_retention'];
export function verifyAutonomyRetentionSelection(full,selected) {
  assert.deepEqual(full.errors,[]);assert.deepEqual(selected.errors,[],'Selected Worker discovery failed');
  const identity=rows=>rows.map(({id,file,title})=>({id,file,title})).sort((a,b)=>a.id.localeCompare(b.id));
  const expected=workerDiscovery(full).filter(row=>row.file==='q2-canvas-agent.spec.js'&&autonomyRetentionWorkers.includes(row.title));
  assert.equal(expected.length,2);assert.equal(new Set(expected.map(row=>row.id)).size,2);
  const actual=workerDiscovery(selected);assert.equal(actual.length,2,'Worker filter must discover exactly two cases');
  assert.deepEqual(identity(actual),identity(expected),'Worker filter changed selected identities');return identity(actual);
}
export function verifyAutonomyRetentionWorkers(directory,head,{allowPending=false}={}) {
  assertAutonomyBrowserTree(head);
  const log=fs.readFileSync(path.join(directory,'reuse/autonomy-native-origin/reuse/preflight-failed.log'),'utf8');assert.equal(sha256(log),AUTONOMY_NATIVE_PREFLIGHT.failedLog);
  const label=value=>value.replace(/:\d+:\d+(?= › )/,'');
  const previous=log.split('\n').flatMap(line=>{const match=line.match(/^\s+✓\s+\d+\s+(tests\/.*?)\s+\([\d.]+(?:ms|s|m)\)\s*$/);return match?[label(match[1])]:[];});
  assert.equal(previous.length,1471);assert.equal(new Set(previous).size,1471);
  const raw=parseDiscovery(fs.readFileSync(path.join(directory,'test-results/autonomy-retention-discovery.json'),'utf8'));
  assert.deepEqual(raw.errors,[]);const discovery=workerDiscovery(raw);assert.equal(discovery.length,1473);
  const labels=discovery.map(row=>label(row.label));assert.equal(new Set(labels).size,1473);
  assert(previous.every(item=>labels.includes(item)),'Changed or missing retained Worker definition');
  const fresh=discovery.filter(row=>!previous.includes(label(row.label)));
  assert.deepEqual(fresh.map(row=>[row.file,row.title]).sort(),autonomyRetentionWorkers.map(title=>['q2-canvas-agent.spec.js',title]).sort(),'Only the two reviewed retention cases may be new');
  if(allowPending)return {discovery,result:null};
  verifyAutonomyRetentionSelection(raw,parseDiscovery(fs.readFileSync(path.join(directory,'test-results/autonomy-retention-selected-discovery.json'),'utf8')));
  const executed=JSON.parse(fs.readFileSync(path.join(directory,'test-results/autonomy-retention-workers.json')));
  assert.deepEqual(executed.errors,[]);assert.equal(executed.config.workers,1);assert.deepEqual(Object.fromEntries(['expected','unexpected','flaky','skipped'].map(k=>[k,executed.stats[k]])),{expected:2,unexpected:0,flaky:0,skipped:0});
  const rows=executedWorkers(executed);assert.equal(rows.length,2);assert.equal(new Set(rows.map(r=>r.id)).size,2);assert(rows.every(passedOnce),'Retention Worker case failed/skipped/retried');
  const identities=items=>items.map(({id,file,title})=>({id,file,title})).sort((a,b)=>a.id.localeCompare(b.id));assert.deepEqual(identities(rows),identities(fresh));
  return {discovery,result:{workerRetained:1471,workerFresh:2,workerTotal:1473}};
}
export function autonomyRetentionContinuation(command) {
  assert.equal(JSON.parse(fs.readFileSync('package.json')).scripts['test:workers'],'node scripts/check-media-tools.mjs && npm run test:website-assistant && node scripts/check-q4-selection.mjs && playwright test -c playwright.workers.config.js && npm run test:homepage-ffmpeg-processor && npm run test:q2-runtime','Worker chain changed');
  assert.equal(command.split('  npm run test:workers').length,2);assert(command.endsWith('else\n  npm run test:workers\nfi\n'),'Missing complete ordinary Worker branch');
  const fresh=[
    'mkdir -p .local-release/test-results',
    'PLAYWRIGHT_JSON_OUTPUT_NAME= npx playwright test -c playwright.workers.config.js --list --reporter=json > .local-release/test-results/autonomy-retention-discovery.json',
    'node scripts/local-release.mjs verify-autonomy-retention-pending .local-release',
    `PLAYWRIGHT_JSON_OUTPUT_NAME= npx playwright test -c playwright.workers.config.js tests/q2-canvas-agent.spec.js --grep '(${autonomyRetentionWorkers.join('|')})$' --list --reporter=json > .local-release/test-results/autonomy-retention-selected-discovery.json`,
    'node scripts/local-release.mjs verify-autonomy-retention-selection .local-release',
    `PLAYWRIGHT_JSON_OUTPUT_NAME=.local-release/test-results/autonomy-retention-workers.json npx playwright test -c playwright.workers.config.js tests/q2-canvas-agent.spec.js --grep '(${autonomyRetentionWorkers.join('|')})$' --workers=1 --retries=0 --reporter=list,json`,
    'node scripts/local-release.mjs verify-autonomy-retention-workers .local-release',
    `node --test --test-name-pattern='^(${autonomyRetentionLaunchers.join('|')})$' scripts/test-q2-runtime-launcher.mjs > .local-release/test-results/autonomy-retention-launcher.tap 2>&1 || { status=$?; cat .local-release/test-results/autonomy-retention-launcher.tap; exit "$status"; }`,
    'cat .local-release/test-results/autonomy-retention-launcher.tap',
    'node scripts/test-q2-runtime.mjs --suite canvas-retention 2>&1 | tee .local-release/test-results/autonomy-retention-native.log',
  ].map(line=>'  '+line).join('\n');
  return command.replace('  npm run test:workers',()=>fresh);
}
function autonomyNativeRecords(directory,log,{suite=null}={}) {
  verifyNativeLocalReports(directory,log);
  const refs=log.split('\n').flatMap(line=>{try{const v=JSON.parse(line);return v.q2LinuxEvidence?[v.q2LinuxEvidence]:[];}catch{return [];}});assert.equal(refs.length,1);
  const folder=path.join(directory,'runtime',refs[0].slice('/tmp/bitbi-release/'.length),'reports');
  const files=fs.readdirSync(folder).filter(file=>file==='result.json'||file.endsWith('__result.json'));assert.equal(files.length,1);
  const reports=JSON.parse(fs.readFileSync(path.join(folder,files[0]))).reports;
  if(suite)assert.deepEqual(reports.map(report=>report.suite),[suite],'Unexpected native execution suite');
  return reports.flatMap(report=>report.records);
}
// One failed planner assertion after a completed prefix. The original e8
// acceptance remains authoritative; this receipt adds only the genuine 0f work.
export function verifyAutonomyBrowserProgress(directory,head) {
  assertAutonomyBrowserTree(head);assert(isAutonomyBrowserProgress(head),'Not the exact autonomy planner successor');
  const p=AUTONOMY_BROWSER_PROGRESS,folder=path.join(directory,'reuse/autonomy-browser-progress');
  const bytes=fs.readFileSync(path.join(folder,'checkpoint.json'));
  assert.equal(sha256(bytes),p.checkpoint,'Changed failed autonomy planner checkpoint');
  const original=JSON.parse(bytes),baseBytes=fs.readFileSync(path.join(directory,'reuse/preflight-checkpoint.json'));
  assert.equal(sha256(baseBytes),AUTONOMY_BROWSER_PREFLIGHT.checkpoint);const base=JSON.parse(baseBytes);
  assert.equal(original.sha,p.source);assert.equal(original.id,p.run);assert.equal(original.status,'failed');
  assert.deepEqual(original.preflightContinuation,{source:base.sha,checkpoint:AUTONOMY_BROWSER_PREFLIGHT.checkpoint});
  for(const key of ['base','planHash'])assert.equal(original[key],base[key]);
  const stableEnvironment=({preparationMs,...identity})=>identity;
  assert.deepEqual(stableEnvironment(original.environment),stableEnvironment(base.environment));assert.equal(original.commands.length,51);
  const flags=({files,reasons,...rest})=>rest;assert.deepEqual(flags(original.selection),flags(base.selection));
  const commands=selectedCommands(original.selection,{GITHUB_SHA:original.sha,CANDIDATE_BASE:original.base});
  for(let i=0;i<original.commands.length;i++){
    const row=original.commands[i];
    if(i<=14){
      assert(row);assert.equal(row.exitCode,i===14?1:0);assert.deepEqual(row.command,commands[i]);
      assert.equal(sha256(fs.readFileSync(path.join(folder,'logs',`${i}.log`))),row.logHash,'Changed autonomy planner progress log');
    }else if(!AUTONOMY_BROWSER_PREFLIGHT.retain.includes(i))assert.equal(row,null,'Unexecuted command acquired evidence');
    if(AUTONOMY_BROWSER_PREFLIGHT.retain.includes(i))assert.deepEqual(row,{...base.commands[i],reusedFrom:base.commands[i].reusedFrom||base.sha},'Changed inherited autonomy proof');
  }
  const failed=fs.readFileSync(path.join(folder,'logs/14.log'));
  assert.equal(sha256(failed),p.failedLog,'Changed failed planner prefix log');
  assert(failed.toString().includes('test-canvas-agent-release.mjs:22:9'));
  return {original,retained:[...p.retain]};
}
export function verifyAutonomyBrowserDocProgress(directory,head) {
  assertAutonomyBrowserTree(head);assert(isAutonomyBrowserDocProgress(head),'Not the exact autonomy documentation successor');
  const previous=verifyAutonomyBrowserProgress(directory,head).original,p=AUTONOMY_BROWSER_DOC_PROGRESS;
  const folder=path.join(directory,'reuse/autonomy-browser-doc-progress'),bytes=fs.readFileSync(path.join(folder,'checkpoint.json'));
  assert.equal(sha256(bytes),p.checkpoint,'Changed failed documentation checkpoint');const original=JSON.parse(bytes);
  assert.equal(original.sha,p.source);assert.equal(original.id,p.run);assert.equal(original.status,'failed');
  assert.deepEqual(original.preflightContinuation,previous.preflightContinuation);
  assert.deepEqual(original.preflightProgress,{source:previous.sha,checkpoint:AUTONOMY_BROWSER_PROGRESS.checkpoint});
  for(const key of ['base','planHash'])assert.equal(original[key],previous[key]);
  const stable=({preparationMs,...identity})=>identity;assert.deepEqual(stable(original.environment),stable(previous.environment));
  const flags=({files,reasons,...identity})=>identity;assert.deepEqual(flags(original.selection),flags(previous.selection));
  assert.equal(original.commands.length,51);const commands=selectedCommands(original.selection,{GITHUB_SHA:original.sha,CANDIDATE_BASE:original.base});
  for(let i=0;i<original.commands.length;i++){
    const row=original.commands[i];
    if(i<=29){
      assert(row);assert.equal(row.exitCode,i===29?1:0);assert.deepEqual(row.command,commands[i]);
      assert.equal(sha256(fs.readFileSync(path.join(folder,'logs',`${i}.log`))),row.logHash,'Changed documentation progress log');
    }else if(!AUTONOMY_BROWSER_PREFLIGHT.retain.includes(i))assert.equal(row,null,'Unexecuted command acquired evidence');
    if(AUTONOMY_BROWSER_PREFLIGHT.retain.includes(i))assert.deepEqual(row,previous.commands[i],'Changed inherited autonomy proof');
    if(AUTONOMY_BROWSER_PROGRESS.retain.includes(i))assert.deepEqual(row,{...previous.commands[i],reusedFrom:previous.sha});
  }
  assert.equal(sha256(fs.readFileSync(path.join(folder,'logs/29.log'))),p.failedLog,'Changed failed documentation log');
  assert.equal(original.commands[14].continuation,autonomyReleasePlanContinuation(commands[14].run));
  const planner=fs.readFileSync(path.join(folder,'logs/14.log'),'utf8');
  assert(planner.includes('Autonomy planner continuation: complete remaining release-plan assertions passed.'));
  assert(!planner.includes('Release planner tests passed.')&&!planner.includes('Auth configuration: reviewed absent-to-off'),'Completed planner prefix repeated');
  return {original,retained:[...p.retain]};
}
export function verifyAutonomyBrowserWorkerProgress(directory,head) {
  assertAutonomyBrowserTree(head);assert(isAutonomyBrowserWorkerProgress(head),'Not the exact autonomy Worker selection successor');
  const previous=verifyAutonomyBrowserDocProgress(directory,head).original,p=AUTONOMY_BROWSER_WORKER_PROGRESS;
  const folder=path.join(directory,'reuse/autonomy-browser-worker-progress'),bytes=fs.readFileSync(path.join(folder,'checkpoint.json'));
  assert.equal(sha256(bytes),p.checkpoint,'Changed failed Worker selection checkpoint');const original=JSON.parse(bytes);
  assert.equal(original.sha,p.source);assert.equal(original.id,p.run);assert.equal(original.status,'failed');
  assert.deepEqual(original.preflightContinuation,previous.preflightContinuation);
  assert.deepEqual(original.preflightProgress,{source:previous.sha,checkpoint:AUTONOMY_BROWSER_DOC_PROGRESS.checkpoint});
  for(const key of ['base','planHash'])assert.equal(original[key],previous[key]);
  const stable=({preparationMs,...identity})=>identity;assert.deepEqual(stable(original.environment),stable(previous.environment));
  const flags=({files,reasons,...identity})=>identity;assert.deepEqual(flags(original.selection),flags(previous.selection));
  assert.equal(original.commands.length,51);const commands=selectedCommands(original.selection,{GITHUB_SHA:original.sha,CANDIDATE_BASE:original.base});
  for(let i=0;i<original.commands.length;i++){
    const row=original.commands[i];
    if(i<=41){
      assert(row);assert.equal(row.exitCode,i===41?1:0);assert.deepEqual(row.command,commands[i]);
      assert.equal(sha256(fs.readFileSync(path.join(folder,'logs',`${i}.log`))),row.logHash,'Changed Worker selection progress log');
    }else if(!AUTONOMY_BROWSER_PREFLIGHT.retain.includes(i))assert.equal(row,null,'Unexecuted command acquired evidence');
    if(AUTONOMY_BROWSER_PREFLIGHT.retain.includes(i))assert.deepEqual(row,previous.commands[i],'Changed inherited autonomy proof');
    if(AUTONOMY_BROWSER_DOC_PROGRESS.retain.includes(i))assert.deepEqual(row,{...previous.commands[i],reusedFrom:previous.commands[i].reusedFrom||previous.sha});
  }
  assert.equal(sha256(fs.readFileSync(path.join(folder,'logs/41.log'))),p.failedLog,'Changed failed Worker selection log');
  for(const [file,hash]of [['autonomy-retention-discovery.json',p.discovery],['autonomy-retention-workers.json',p.failedWorkers]])assert.equal(sha256(fs.readFileSync(path.join(folder,'test-results',file))),hash,'Changed original Worker discovery outcome');
  const discovery=JSON.parse(fs.readFileSync(path.join(folder,'test-results/autonomy-retention-discovery.json')));assert.deepEqual(discovery.errors,[]);assert.equal(workerDiscovery(discovery).length,1473);
  const failed=JSON.parse(fs.readFileSync(path.join(folder,'test-results/autonomy-retention-workers.json')));
  assert.deepEqual(failed.suites,[]);assert.equal(failed.errors.length,1);assert(failed.errors[0].message.includes('No tests found.'));
  assert.deepEqual(Object.fromEntries(['expected','unexpected','flaky','skipped'].map(key=>[key,failed.stats[key]])),{expected:0,unexpected:0,flaky:0,skipped:0});
  return {original,retained:[...p.retain]};
}
export function autonomyWorkerGuardContinuation(command) {
  assert.equal(command,'npm run test:local-release','Unexpected Worker selection guard caller');
  return 'npm run test:local-release -- --autonomy-worker-selection-only';
}
export function autonomyDocInventoryContinuation(command) {
  assert.equal(command,'npm run test:doc-currentness','Unexpected documentation inventory caller');
  return 'node scripts/test-doc-currentness.mjs --local-release-inventory-only';
}
export function autonomyDocSelectionContinuation(command) {
  assert.equal(command,'npm run test:ci-selection','Unexpected documentation selection caller');
  return 'npm run test:ci-selection -- --doc-inventory-only';
}
export function autonomyDocGuardContinuation(command) {
  assert.equal(command,'npm run test:local-release','Unexpected documentation progress guard caller');
  return 'npm run test:local-release -- --autonomy-doc-progress-only';
}
export function autonomyReleasePlanContinuation(command) {
  assert.equal(command,'npm run test:release-plan','Unexpected planner continuation caller');
  return 'node scripts/local-release.mjs autonomy-release-plan-continuation';
}
export function autonomyReleasePlanSource(source) {
  assert.equal(sha256(source),AUTONOMY_BROWSER_PROGRESS.plannerSource,'Changed planner source cannot inherit prefix evidence');
  const text=source.toString(),begin=text.indexOf('\n{\n  const {backendContinuationSupported}'),tail=text.indexOf("await import('./test-canvas-agent-release.mjs');");
  assert(begin>0&&tail>begin);assert.equal(text.indexOf("await import('./test-canvas-agent-release.mjs');",tail+1),-1);
  return text.slice(0,begin)+'\n'+text.slice(tail);
}
export async function runAutonomyReleasePlanContinuation() {
  const head=gitBytes(['rev-parse','HEAD']).toString().trim();
  verifyAutonomyBrowserProgress(path.resolve('.local-release'),head);
  const source=autonomyReleasePlanSource(fs.readFileSync('scripts/test-release-plan.mjs'));
  const file=path.resolve(`scripts/.autonomy-release-plan-${process.pid}.mjs`);
  fs.writeFileSync(file,source,{flag:'wx'});
  try {
    console.log('Autonomy planner continuation: retained the pinned completed prefix; starting test-canvas-agent-release.mjs.');
    const {pathToFileURL}=await import('node:url');await import(pathToFileURL(file).href);
    console.log('Autonomy planner continuation: complete remaining release-plan assertions passed.');
  }
  finally {fs.rmSync(file,{force:true});}
}
export function verifyAutonomyBrowserRepair(directory,head,{allowPending=false}={}) {
  const p=AUTONOMY_BROWSER_PREFLIGHT;assertCanvasPreflightTree(head,gitBytes,p);
  if(isAutonomyBrowserWorkerProgress(head))verifyAutonomyBrowserWorkerProgress(directory,head);
  else if(isAutonomyBrowserDocProgress(head))verifyAutonomyBrowserDocProgress(directory,head);
  else if(isAutonomyBrowserProgress(head))verifyAutonomyBrowserProgress(directory,head);
  const pinned=(file,hash)=>{const bytes=fs.readFileSync(path.join(directory,'reuse',file));assert.equal(sha256(bytes),hash,`Changed original autonomy browser evidence: ${file}`);return bytes;};
  const original=JSON.parse(pinned('preflight-checkpoint.json',p.checkpoint));
  assert.equal(original.sha,p.source);assert.equal(original.status,'failed');assert.equal(original.commands.length,51);
  assert(original.commands.slice(0,50).every(row=>row.exitCode===0));assert.equal(original.commands[50].exitCode,1);pinned('preflight-failed.log',p.failedLog);
  const origin=path.join(directory,'reuse/autonomy-native-origin');
  verifyCanvasPreflight(origin,original,selectedCommands(original.selection,{GITHUB_SHA:original.sha,CANDIDATE_BASE:original.base}));
  for(const row of original.commands.slice(0,50))assert.equal(sha256(fs.readFileSync(path.join(origin,row.log))),row.logHash,'Changed retained upstream execution log');
  const previous=browserRows(JSON.parse(pinned('autonomy-browser-original.json',p.report)));assert.equal(sha256(JSON.stringify(previous)),p.rows);assert.equal(previous.length,p.required);
  const standard=browserRows(JSON.parse(pinned('autonomy-browser-standard.json',p.standardDiscovery)),{discovery:true});
  const auth=standard.filter(row=>row.project==='chromium'&&(/^(auth-admin|wallet-nav|locale|oma2-q1-member)\.spec\.js$/.test(row.file)||row.file.startsWith('oma2-q3-')));
  assert.equal(sha256(JSON.stringify(auth)),p.authDiscovery);assert.equal(auth.length,p.authRequired);
  const overlap=previous.filter(row=>auth.some(item=>item.key===row.key));assert.equal(overlap.length,p.authReused);
  assert(overlap.every(row=>row.file==='locale.spec.js'&&row.project==='chromium'&&row.expectedStatus==='passed'&&row.status==='expected'&&row.results.length===1&&row.results[0].status==='passed'&&row.results[0].retry===0&&!row.results[0].error),'Only actual first-attempt Locale passes may be retained for Auth');
  for(const [file,hash]of Object.entries(p.homepageReports))assert.equal(sha256(fs.readFileSync(path.join(directory,'test-results',file))),hash,'Changed retained homepage acceptance');
  const image=JSON.parse(fs.readFileSync(path.join(directory,'test-results/private-media-image/image.json')));verifyAutonomyImageReuse(image,head);
  // The archive and grouped logs are independently verified at normal image import/publication.
  assert.equal(sha256(fs.readFileSync(path.join(directory,'test-results/private-media-image/image.tar'))),image.archiveDigest);
  assert.equal(sha256(fs.readFileSync(path.join(directory,'test-results/private-media-image/test.log'))),image.testLogDigest,'Changed retained media test log');
  for(const [file,hash]of Object.entries(p.nativeProof))assert.equal(sha256(fs.readFileSync(path.join(directory,file))),hash,'Changed retained native execution report');
  const oldNative=autonomyNativeRecords(directory,fs.readFileSync(path.join(origin,'logs/41.log'),'utf8'));assert.equal(oldNative.length,308);assert.equal(new Set(oldNative.map(r=>r.name)).size,308);
  if(allowPending)return {original,previous,result:null};
  const result={};
  for(const scope of ['homepage','auth']){
    const prefix=scope==='auth'?'autonomy-browser-auth':'autonomy-browser';
    const raw=JSON.parse(fs.readFileSync(path.join(directory,`test-results/${prefix}-fresh.json`)));assert.deepEqual(raw.errors,[]);assert.equal(raw.config.workers,1);
    const discovery=browserRows(JSON.parse(fs.readFileSync(path.join(directory,`test-results/${prefix}-discovery.json`))),{discovery:true});
    const report=JSON.parse(fs.readFileSync(path.join(directory,`test-results/candidate-${scope}.json`)));
    assert.deepEqual(Object.fromEntries(['expected','unexpected','flaky','skipped'].map(k=>[k,raw.stats[k]])),{expected:report.fresh.length,unexpected:0,flaky:0,skipped:0},'Fresh browser statistics contradict exact first-pass coverage');
    assert.equal(report.scope,scope);assert.deepEqual(report.previous,previous);assert.deepEqual(report.discovery,discovery);assert.deepEqual(report.fresh,browserRows(raw));result[scope]=verifyAutonomyBrowserReport(report,head);
  }
  const workers=verifyAutonomyRetentionWorkers(directory,head).result;
  const launcher=fs.readFileSync(path.join(directory,'test-results/autonomy-retention-launcher.tap'),'utf8');
  assert.match(launcher,/# pass 2\n# fail 0\n# cancelled 0\n# skipped \d+\n# todo 0/);
  const launcherRows=tapResults(launcher);assert.equal(new Set(launcherRows.map(r=>r.title)).size,launcherRows.length);
  const oldLauncher=tapResults(fs.readFileSync(path.join(origin,'reuse/preflight-failed.log'),'utf8').split('> test:q2-runtime\n> node --test tests/q2-recovery-staging.test.mjs scripts/test-q2-runtime-launcher.mjs && node scripts/test-q2-runtime.mjs\n')[1]);
  assert(launcherRows.every(row=>oldLauncher.some(old=>old.title===row.title)),'Unknown launcher case cannot be hidden as a skip');
  assert.deepEqual(launcherRows.filter(r=>r.status!=='skipped').sort((a,b)=>a.title.localeCompare(b.title)),autonomyRetentionLaunchers.map(title=>({title,status:'passed'})).sort((a,b)=>a.title.localeCompare(b.title)));
  const native=autonomyNativeRecords(directory,fs.readFileSync(path.join(directory,'test-results/autonomy-retention-native.log'),'utf8'));
  assert.deepEqual(native.map(r=>r.name).sort(),[...autonomyRetentionNative].sort());assert(native.every(r=>r.status==='PASS'));
  result.retention={...workers,nativeRetained:308,nativeFresh:2,launcherFresh:2};return {original,previous,result};
}
export function canvasExampleBrowserContinuation(command){
  const passed='  node --test tests/canvas-transition-examples.test.mjs\n';
  assert.equal(command.split(passed).length,2);assert(command.includes("--grep 'Canvas transition examples'"));
  return command.replace(passed,''); // Pinned decoded-asset pass remains in the archived original log.
}
export const canvasPreflightProfile=source=>[MEDIA_WINDOW_PREFLIGHT,MEDIA_COMPLETION_PREFLIGHT,INCIDENT_BROWSER_PREFLIGHT,INCIDENT_NATIVE_PREFLIGHT,INCIDENT_WORKER_PREFLIGHT,INCIDENT_PREFLIGHT,RELIABILITY_BROWSER_PREFLIGHT,RELIABILITY_NATIVE_PREFLIGHT,RELIABILITY_WORKER_PREFLIGHT,EXPORT_DELIVERY_BROWSER_PREFLIGHT,EXPORT_DELIVERY_SDK_PREFLIGHT,EXPORT_DELIVERY_HOSTING_PREFLIGHT,EXPORT_DELIVERY_DISCOVERY_PREFLIGHT,EXPORT_DELIVERY_SELECTION_PREFLIGHT,EXPORT_DELIVERY_PREFLIGHT,ASSISTANT_BROWSER_PREFLIGHT,ASSISTANT_NATIVE_RATE,ASSISTANT_NATIVE_TAIL,ASSISTANT_NATIVE_PROGRESS,ASSISTANT_NATIVE_PREFLIGHT,ASSISTANT_WORKER_PREFLIGHT,ASSISTANT_PREFLIGHT,SETTLEMENT_BROWSER_PREFLIGHT,SETTLEMENT_NATIVE_PROGRESS,SETTLEMENT_NATIVE_PREFLIGHT,SETTLEMENT_HOSTING_PREFLIGHT,SETTLEMENT_PREFLIGHT,CANVAS_POLICY_NATIVE_PREFLIGHT,CANVAS_POLICY_WORKER_PREFLIGHT,AUTONOMY_BROWSER_PREFLIGHT,AUTONOMY_NATIVE_PREFLIGHT,CANVAS_PREFLIGHT,EXPORT_PREFLIGHT,EXPORT_NATIVE_PREFLIGHT,EXPORT_MEDIA_PREFLIGHT,EXAMPLE_PREFLIGHT,EXAMPLE_BROWSER_PREFLIGHT,MODEL_OPERATION_PREFLIGHT,MODEL_SELECTION_PREFLIGHT,MODEL_WORKFLOW_PREFLIGHT,MODEL_WORKER_PREFLIGHT,MODEL_BROWSER_PREFLIGHT].find(p=>p.source===source)||null;
export function assertCanvasPreflightTree(head,read=gitBytes,profile=CANVAS_PREFLIGHT){
  if([MEDIA_WINDOW_PREFLIGHT,MEDIA_COMPLETION_PREFLIGHT].includes(profile))return assertMediaCompletionTree(head,read);
  if(profile===INCIDENT_BROWSER_PREFLIGHT)return assertIncidentBrowserTree(head,read);
  if(profile===INCIDENT_NATIVE_PREFLIGHT)return assertIncidentNativeTree(head,read);
  if(profile===INCIDENT_WORKER_PREFLIGHT)return assertIncidentWorkerTree(head,read);
  if(profile===INCIDENT_PREFLIGHT){
    assert.deepEqual(read(['rev-list','--parents','-n','1',head]).toString().trim().split(/\s+/),[head,profile.source],'Incident preflight requires the direct reviewed successor');
    const files=read(['diff','--name-only',profile.source,head]).toString().trim().split('\n').filter(Boolean);
    const allowed=['scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs','scripts/test-local-release.mjs'];
    assert(files.every(file=>allowed.includes(file)),'Incident preflight changed product, schema, selection or environment');
    for(const [file,hash]of Object.entries(profile.specs)){
      assert(files.includes(file),'Missing reviewed workflow assertion correction');
      assert.equal(sha256(read(['show',`${head}:${file}`])),hash,'Unreviewed workflow assertion correction');
    }
    for(const file of files)assert(/^100644 blob [0-9a-f]{40}\t/.test(read(['ls-tree',head,'--',file]).toString()),'Continuation input must remain an ordinary file');
    return;
  }
  if(profile===RELIABILITY_BROWSER_PREFLIGHT)return assertReliabilityBrowserTree(head,read);
  if(profile===RELIABILITY_NATIVE_PREFLIGHT)return assertReliabilityNativeTree(head,read);
  if(profile===RELIABILITY_WORKER_PREFLIGHT)return assertReliabilityWorkerTree(head,read);
  if(exportDeliveryCorrectionProfile(profile.source))return assertExportDeliverySelectionTree(head,read,profile);
  if(profile===EXPORT_DELIVERY_PREFLIGHT)return assertExportDeliveryTree(head,read);
  if(profile===ASSISTANT_BROWSER_PREFLIGHT){
    assertCanvasPreflightTree(profile.source,read,ASSISTANT_NATIVE_RATE);
    assert.deepEqual(read(['rev-list','--parents','-n','1',head]).toString().trim().split(/\s+/),[head,profile.source],'Assistant browser continuation requires the direct reviewed successor');
    const files=read(['diff','--name-only',profile.source,head]).toString().trim().split('\n').filter(Boolean);
    assert(files.every(file=>[...Object.keys(profile.specs),'scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs','scripts/lib/local-release-browser.mjs'].includes(file)),'Assistant browser continuation changed unreviewed product, runtime or test inputs');
    for(const [file,hash]of Object.entries(profile.specs)){
      assert(files.includes(file),'Missing reviewed browser fixture correction');assert.equal(sha256(read(['show',`${head}:${file}`])),hash,'Unreviewed browser fixture correction');
    }
    for(const file of files)assert(/^100644 blob [0-9a-f]{40}\t/.test(read(['ls-tree',head,'--',file]).toString()),'Continuation input must remain an ordinary file');
    const verifier='scripts/test-local-release.mjs',before=read(['show',`${profile.source}:${verifier}`]).toString(),after=read(['show',`${head}:${verifier}`]).toString();
    const entry="if(process.argv.includes('--assistant-browser-only')) {\n  assert.deepEqual(process.argv.slice(2),['--assistant-browser-only']);\n  await testAssistantBrowserContinuation();process.exit(0);\n}\n\n";
    const tail='\nasync function testAssistantBrowserContinuation() {';
    assert.equal(after.split(entry).length,2,'Missing exact focused browser verifier entry');assert.equal(after.split(tail).length,2,'Missing new browser continuation counterchecks');
    assert.equal(after.slice(0,after.indexOf(tail)).replace(entry,''),before,'Previously completed verifier groups changed');
    assert(after.endsWith('\nawait testAssistantBrowserContinuation();\n'),'New browser verifier counterchecks must run in the ordinary entrypoint');
    return;
  }
  if(profile===ASSISTANT_NATIVE_RATE){
    assertCanvasPreflightTree(profile.source,read,ASSISTANT_NATIVE_TAIL);
    assert.deepEqual(read(['rev-list','--parents','-n','1',head]).toString().trim().split(/\s+/),[head,profile.source],'Assistant native rate tail requires the direct reviewed successor');
    const files=read(['diff','--name-only',profile.source,head]).toString().trim().split('\n').filter(Boolean);
    assert(files.every(file=>[...Object.keys(profile.specs),'scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs'].includes(file)),'Assistant native rate tail changed an unreviewed input');
    for(const [file,hash]of Object.entries(profile.specs)){
      assert(files.includes(file),'Missing reviewed native rate tail correction');assert.equal(sha256(read(['show',`${head}:${file}`])),hash,'Unreviewed native rate tail correction');
    }
    for(const file of files)assert(/^100644 blob [0-9a-f]{40}\t/.test(read(['ls-tree',head,'--',file]).toString()),'Continuation input must remain an ordinary file');
    return;
  }
  if(profile===ASSISTANT_NATIVE_TAIL){
    assertCanvasPreflightTree(profile.source,read,ASSISTANT_NATIVE_PROGRESS);
    assert.deepEqual(read(['rev-list','--parents','-n','1',head]).toString().trim().split(/\s+/),[head,profile.source],'Assistant native tail requires the direct reviewed successor');
    const files=read(['diff','--name-only',profile.source,head]).toString().trim().split('\n').filter(Boolean);
    assert(files.every(file=>[...Object.keys(profile.specs),'scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs'].includes(file)),'Assistant native tail changed an unreviewed input');
    for(const [file,hash]of Object.entries(profile.specs)){
      assert(files.includes(file),'Missing reviewed native tail correction');assert.equal(sha256(read(['show',`${head}:${file}`])),hash,'Unreviewed native tail correction');
    }
    for(const file of files)assert(/^100644 blob [0-9a-f]{40}\t/.test(read(['ls-tree',head,'--',file]).toString()),'Continuation input must remain an ordinary file');
    return;
  }
  if(profile===ASSISTANT_NATIVE_PROGRESS){
    assertCanvasPreflightTree(profile.source,read,ASSISTANT_NATIVE_PREFLIGHT);
    assert.deepEqual(read(['rev-list','--parents','-n','1',head]).toString().trim().split(/\s+/),[head,profile.source],'Assistant native progress requires the direct reviewed successor');
    const files=read(['diff','--name-only',profile.source,head]).toString().trim().split('\n').filter(Boolean);
    assert(files.every(file=>[...Object.keys(profile.specs),'scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs'].includes(file)),'Assistant native progress changed an unreviewed input');
    for(const [file,hash]of Object.entries(profile.specs)){
      assert(files.includes(file),'Missing reviewed native progress correction');assert.equal(sha256(read(['show',`${head}:${file}`])),hash,'Unreviewed native progress correction');
    }
    for(const file of files)assert(/^100644 blob [0-9a-f]{40}\t/.test(read(['ls-tree',head,'--',file]).toString()),'Continuation input must remain an ordinary file');
    return;
  }
  if(profile===ASSISTANT_NATIVE_PREFLIGHT){
    assertCanvasPreflightTree(profile.source,read,ASSISTANT_WORKER_PREFLIGHT);
    assert.deepEqual(read(['rev-list','--parents','-n','1',head]).toString().trim().split(/\s+/),[head,profile.source],'Assistant native continuation requires the direct reviewed successor');
    const files=read(['diff','--name-only',profile.source,head]).toString().trim().split('\n').filter(Boolean);
    assert(files.every(file=>[...Object.keys(profile.specs),'scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs'].includes(file)),'Assistant native continuation changed an unreviewed input');
    for(const [file,hash]of Object.entries(profile.specs)){
      assert(files.includes(file),'Missing reviewed native fixture correction');assert.equal(sha256(read(['show',`${head}:${file}`])),hash,'Unreviewed native fixture correction');
    }
    for(const file of files)assert(/^100644 blob [0-9a-f]{40}\t/.test(read(['ls-tree',head,'--',file]).toString()),'Continuation input must remain an ordinary file');
    return;
  }
  if(profile===ASSISTANT_WORKER_PREFLIGHT){
    assertCanvasPreflightTree(profile.source,read,ASSISTANT_PREFLIGHT);
    assert.deepEqual(read(['rev-list','--parents','-n','1',head]).toString().trim().split(/\s+/),[head,profile.source],'Assistant Worker continuation requires the direct reviewed successor');
    const files=read(['diff','--name-only',profile.source,head]).toString().trim().split('\n').filter(Boolean);
    assert(files.every(file=>[...Object.keys(profile.specs),'scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs','scripts/test-local-release.mjs'].includes(file)),'Assistant Worker continuation changed an unreviewed product, test, schema or environment');
    for(const [file,hash]of Object.entries(profile.specs)){
      assert(files.includes(file),'Missing reviewed assistant correction');assert.equal(sha256(read(['show',`${head}:${file}`])),hash,'Unreviewed assistant correction');
    }
    for(const file of files)assert(/^100644 blob [0-9a-f]{40}\t/.test(read(['ls-tree',head,'--',file]).toString()),'Continuation input must remain an ordinary file');
    return;
  }
  if(profile===ASSISTANT_PREFLIGHT){
    assert.deepEqual(read(['rev-list','--parents','-n','1',head]).toString().trim().split(/\s+/),[head,profile.source],'Assistant preflight requires the direct reviewed successor');
    const files=read(['diff','--name-only',profile.source,head]).toString().trim().split('\n').filter(Boolean);
    assert(files.every(file=>[...Object.keys(profile.specs),'scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs'].includes(file)),
      'Assistant preflight changed unreviewed product, schema, selection or environment');
    for(const [file,hash]of Object.entries(profile.specs)){
      assert(files.includes(file),'Missing reviewed historical fixture correction');
      assert.equal(sha256(read(['show',`${head}:${file}`])),hash,'Unreviewed historical fixture correction');
    }
    for(const file of files)assert(/^100644 blob [0-9a-f]{40}\t/.test(read(['ls-tree',head,'--',file]).toString()),'Continuation input must remain an ordinary file');
    return;
  }
  if(profile===SETTLEMENT_BROWSER_PREFLIGHT){
    assertCanvasPreflightTree(profile.source,read,SETTLEMENT_NATIVE_PROGRESS);
    assert.deepEqual(read(['rev-list','--parents','-n','1',head]).toString().trim().split(/\s+/),[head,profile.source],'Native preflight requires the direct reviewed successor');
    const files=read(['diff','--name-only',profile.source,head]).toString().trim().split('\n').filter(Boolean);
    assert(files.every(file=>[...Object.keys(profile.specs),'scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs','scripts/lib/local-release-browser.mjs','scripts/test-local-release.mjs'].includes(file)),'Native continuation changed product, schema, selection or environment');
    for(const [file,hash]of Object.entries(profile.specs)){
      assert(files.includes(file),'Missing reviewed native staging correction');assert.equal(sha256(read(['show',`${head}:${file}`])),hash,'Unreviewed native staging correction');
    }
    for(const file of files)assert(/^100644 blob [0-9a-f]{40}\t/.test(read(['ls-tree',head,'--',file]).toString()),'Continuation input must remain an ordinary file');
    const verifier='scripts/test-local-release.mjs',before=read(['show',`${profile.source}:${verifier}`]).toString(),after=read(['show',`${head}:${verifier}`]).toString();
    const entry="if(process.argv.includes('--settlement-browser-only')) {\n  assert.deepEqual(process.argv.slice(2),['--settlement-browser-only']);\n  await testSettlementBrowserContinuation();process.exit(0);\n}\n\n";
    const tail='\nasync function testSettlementBrowserContinuation() {';
    assert.equal(after.split(entry).length,2,'Missing exact focused native verifier entry');assert.equal(after.split(tail).length,2,'Missing new native continuation counterchecks');
    assert.equal(after.slice(0,after.indexOf(tail)).replace(entry,''),before,'Previously completed verifier groups changed');
    assert(after.endsWith('\nawait testSettlementBrowserContinuation();\n'),'New native verifier counterchecks must run in the ordinary entrypoint');
    return;
  }
  if(profile===SETTLEMENT_NATIVE_PROGRESS){
    assertCanvasPreflightTree(profile.source,read,SETTLEMENT_NATIVE_PREFLIGHT);
    assert.deepEqual(read(['rev-list','--parents','-n','1',head]).toString().trim().split(/\s+/),[head,profile.source],'Native preflight requires the direct reviewed successor');
    const files=read(['diff','--name-only',profile.source,head]).toString().trim().split('\n').filter(Boolean);
    assert(files.every(file=>[...Object.keys(profile.specs),'scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs','scripts/test-local-release.mjs'].includes(file)),'Native continuation changed product, schema, selection or environment');
    for(const [file,hash]of Object.entries(profile.specs)){
      assert(files.includes(file),'Missing reviewed native staging correction');assert.equal(sha256(read(['show',`${head}:${file}`])),hash,'Unreviewed native staging correction');
    }
    for(const file of files)assert(/^100644 blob [0-9a-f]{40}\t/.test(read(['ls-tree',head,'--',file]).toString()),'Continuation input must remain an ordinary file');
    const verifier='scripts/test-local-release.mjs',before=read(['show',`${profile.source}:${verifier}`]).toString(),after=read(['show',`${head}:${verifier}`]).toString();
    const entry="if(process.argv.includes('--settlement-native-progress-only')) {\n  assert.deepEqual(process.argv.slice(2),['--settlement-native-progress-only']);\n  await testSettlementNativeProgress();process.exit(0);\n}\n\n";
    const tail='\nasync function testSettlementNativeProgress() {';
    assert.equal(after.split(entry).length,2,'Missing exact focused native verifier entry');assert.equal(after.split(tail).length,2,'Missing new native continuation counterchecks');
    assert.equal(after.slice(0,after.indexOf(tail)).replace(entry,''),before,'Previously completed verifier groups changed');
    assert(after.endsWith('\nawait testSettlementNativeProgress();\n'),'New native verifier counterchecks must run in the ordinary entrypoint');
    return;
  }
  if(profile===SETTLEMENT_NATIVE_PREFLIGHT){
    assertCanvasPreflightTree(profile.source,read,SETTLEMENT_HOSTING_PREFLIGHT);
    assert.deepEqual(read(['rev-list','--parents','-n','1',head]).toString().trim().split(/\s+/),[head,profile.source],'Native preflight requires the direct reviewed successor');
    const files=read(['diff','--name-only',profile.source,head]).toString().trim().split('\n').filter(Boolean);
    assert(files.every(file=>[...Object.keys(profile.specs),'scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs','scripts/test-local-release.mjs'].includes(file)),'Native continuation changed product, schema, selection or environment');
    for(const [file,hash]of Object.entries(profile.specs)){
      assert(files.includes(file),'Missing reviewed native staging correction');assert.equal(sha256(read(['show',`${head}:${file}`])),hash,'Unreviewed native staging correction');
    }
    for(const file of files)assert(/^100644 blob [0-9a-f]{40}\t/.test(read(['ls-tree',head,'--',file]).toString()),'Continuation input must remain an ordinary file');
    const verifier='scripts/test-local-release.mjs',before=read(['show',`${profile.source}:${verifier}`]).toString(),after=read(['show',`${head}:${verifier}`]).toString();
    const entry="if(process.argv.includes('--settlement-native-only')) {\n  assert.deepEqual(process.argv.slice(2),['--settlement-native-only']);\n  await testSettlementNativeContinuation();process.exit(0);\n}\n\n";
    const tail='\nasync function testSettlementNativeContinuation() {';
    assert.equal(after.split(entry).length,2,'Missing exact focused native verifier entry');assert.equal(after.split(tail).length,2,'Missing new native continuation counterchecks');
    assert.equal(after.slice(0,after.indexOf(tail)).replace(entry,''),before,'Previously completed verifier groups changed');
    assert(after.endsWith('\nawait testSettlementNativeContinuation();\n'),'New native verifier counterchecks must run in the ordinary entrypoint');
    return;
  }
  if(profile===SETTLEMENT_HOSTING_PREFLIGHT){
    assertCanvasPreflightTree(profile.source,read,SETTLEMENT_PREFLIGHT);
    assert.deepEqual(read(['rev-list','--parents','-n','1',head]).toString().trim().split(/\s+/),[head,profile.source],'Hosting preflight requires the direct reviewed successor');
    const files=read(['diff','--name-only',profile.source,head]).toString().trim().split('\n').filter(Boolean);
    assert(files.every(file=>[...Object.keys(profile.specs),'scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs','scripts/test-local-release.mjs'].includes(file)),'Hosting continuation changed product, schema, selection or environment');
    for(const [file,hash]of Object.entries(profile.specs)){
      assert(files.includes(file),'Missing reviewed hosting fixture correction');assert.equal(sha256(read(['show',`${head}:${file}`])),hash,'Unreviewed hosting fixture correction');
    }
    for(const file of files)assert(/^100644 blob [0-9a-f]{40}\t/.test(read(['ls-tree',head,'--',file]).toString()),'Continuation input must remain an ordinary file');
    const verifier='scripts/test-local-release.mjs',before=read(['show',`${profile.source}:${verifier}`]).toString(),after=read(['show',`${head}:${verifier}`]).toString();
    const entry="if(process.argv.includes('--settlement-hosting-only')) {\n  assert.deepEqual(process.argv.slice(2),['--settlement-hosting-only']);\n  await testSettlementHostingContinuation();process.exit(0);\n}\n\n";
    const tail='\nasync function testSettlementHostingContinuation() {';
    assert.equal(after.split(entry).length,2,'Missing exact focused hosting verifier entry');assert.equal(after.split(tail).length,2,'Missing new hosting continuation counterchecks');
    assert.equal(after.slice(0,after.indexOf(tail)).replace(entry,''),before,'Previously completed verifier groups changed');
    assert(after.endsWith('\nawait testSettlementHostingContinuation();\n'),'New hosting verifier counterchecks must run in the ordinary entrypoint');
    return;
  }
  if(profile===SETTLEMENT_PREFLIGHT){
    assert.deepEqual(read(['rev-list','--parents','-n','1',head]).toString().trim().split(/\s+/),[head,profile.source],'Settlement preflight requires the direct reviewed successor');
    const files=read(['diff','--name-only',profile.source,head]).toString().trim().split('\n').filter(Boolean);
    assert(files.every(file=>[...Object.keys(profile.specs),'scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs','scripts/test-local-release.mjs'].includes(file)),'Settlement preflight changed product, schema, selection or environment');
    for(const [file,hash]of Object.entries(profile.specs)){
      assert(files.includes(file),'Missing reviewed historical inventory correction');
      assert.equal(sha256(read(['show',`${head}:${file}`])),hash,'Unreviewed historical inventory correction');
    }
    for(const file of files)assert(/^100644 blob [0-9a-f]{40}\t/.test(read(['ls-tree',head,'--',file]).toString()),'Continuation input must remain an ordinary file');
    const verifier='scripts/test-local-release.mjs',before=read(['show',`${profile.source}:${verifier}`]).toString(),after=read(['show',`${head}:${verifier}`]).toString();
    const entry="if(process.argv.includes('--settlement-preflight-only')) {\n  assert.deepEqual(process.argv.slice(2),['--settlement-preflight-only']);\n  await testCanvasPolicyNativeContinuation();await testCanvasPolicyNativeProgress();await testSettlementPreflightContinuation();process.exit(0);\n}\n\n";
    const tail='\nasync function testSettlementPreflightContinuation() {';
    assert.equal(after.split(entry).length,2,'Missing exact focused verifier entry');
    assert.equal(after.split(tail).length,2,'Missing new continuation counterchecks');
    assert.equal(after.slice(0,after.indexOf(tail)).replace(entry,''),before,'Previously completed verifier groups changed');
    assert(after.endsWith('\nawait testSettlementPreflightContinuation();\n'),'New verifier counterchecks must run in the ordinary entrypoint');
    return;
  }
  if(profile===CANVAS_POLICY_NATIVE_PREFLIGHT&&isCanvasPolicyNativeProgress(head,read)){
    const p=CANVAS_POLICY_NATIVE_PROGRESS;assertCanvasPreflightTree(p.source,read,profile);
    assert.deepEqual(read(['rev-list','--parents','-n','1',head]).toString().trim().split(/\s+/),[head,p.source]);
    const files=read(['diff','--name-only',p.source,head]).toString().trim().split('\n').filter(Boolean);
    assert(files.every(file=>[...Object.keys(p.specs),'scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs','scripts/test-local-release.mjs'].includes(file)),'Native progress changed unreviewed product, tests, selection or environment');
    for(const[file,hash]of Object.entries(p.specs)){assert(files.includes(file),'Missing reviewed native action correction');assert.equal(sha256(read(['show',`${head}:${file}`])),hash,'Unreviewed native action correction');}
    for(const file of files)assert(/^100644 blob [0-9a-f]{40}\t/.test(read(['ls-tree',head,'--',file]).toString()),'Continuation input must remain an ordinary file');
    return;
  }
  if(profile===AUTONOMY_BROWSER_PREFLIGHT){assertCanvasPreflightTree(profile.source,read,AUTONOMY_NATIVE_PREFLIGHT);return assertAutonomyBrowserTree(head,read);}
  if(profile===AUTONOMY_NATIVE_PREFLIGHT){
    assert.deepEqual(read(['rev-list','--parents','-n','1',head]).toString().trim().split(/\s+/),[head,profile.source],'Autonomy native continuation requires the direct source successor');
    const files=read(['diff','--name-only',profile.source,head]).toString().trim().split('\n').filter(Boolean);
    assert(files.every(file=>[...Object.keys(profile.specs),'scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs','scripts/test-local-release.mjs'].includes(file)),'Autonomy native continuation changed product, tests, selection or environment');
    for(const [file,hash]of Object.entries(profile.specs)){
      assert(files.includes(file),'Missing reviewed autonomy fixture correction');
      assert.equal(sha256(read(['show',`${head}:${file}`])),hash,'Unreviewed autonomy fixture correction');
    }
    for(const file of files)assert(/^100644 blob [0-9a-f]{40}\t/.test(read(['ls-tree',head,'--',file]).toString()),'Continuation input must remain an ordinary file');
    return;
  }
  if(profile===MODEL_BROWSER_PREFLIGHT){
    assertCanvasPreflightTree(profile.source,read,MODEL_WORKER_PREFLIGHT);
    assert.deepEqual(read(['rev-list','--parents','-n','1',head]).toString().trim().split(/\s+/),[head,profile.source],'Browser continuation requires the direct source successor');
    const files=read(['diff','--name-only',profile.source,head]).toString().trim().split('\n').filter(Boolean);
    assert(files.every(file=>[...Object.keys(profile.specs),'scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs','scripts/lib/local-release-browser.mjs','scripts/pages-candidate.mjs','scripts/test-local-release.mjs'].includes(file)),'Browser continuation changed product, tests, selection or environment');
    for(const [file,hash]of Object.entries(profile.specs)){
      assert(files.includes(file),'Missing reviewed browser fixture correction');
      assert.equal(sha256(read(['show',`${head}:${file}`])),hash,'Unreviewed browser fixture correction');
    }
    for(const file of files)assert(/^100644 blob [0-9a-f]{40}\t/.test(read(['ls-tree',head,'--',file]).toString()),'Continuation input must remain an ordinary file');
    return;
  }
  if(profile===MODEL_WORKER_PREFLIGHT||profile===CANVAS_POLICY_WORKER_PREFLIGHT||profile===CANVAS_POLICY_NATIVE_PREFLIGHT){
    if(profile===CANVAS_POLICY_NATIVE_PREFLIGHT)assertCanvasPreflightTree(profile.source,read,CANVAS_POLICY_WORKER_PREFLIGHT);
    if(profile===MODEL_WORKER_PREFLIGHT)assertCanvasPreflightTree(profile.source,read,MODEL_WORKFLOW_PREFLIGHT);
    assert.deepEqual(read(['rev-list','--parents','-n','1',head]).toString().trim().split(/\s+/),[head,profile.source],'Worker continuation requires the direct source successor');
    const files=read(['diff','--name-only',profile.source,head]).toString().trim().split('\n').filter(Boolean);
    assert(files.every(file=>[...Object.keys(profile.specs),'scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs','scripts/test-local-release.mjs'].includes(file)),'Worker continuation changed product, tests, selection or environment');
    for(const [file,hash]of Object.entries(profile.specs)){
      assert(files.includes(file),'Missing reviewed Worker fixture correction');
      assert.equal(sha256(read(['show',`${head}:${file}`])),hash,'Unreviewed Worker fixture correction');
    }
    for(const file of files)assert(/^100644 blob [0-9a-f]{40}\t/.test(read(['ls-tree',head,'--',file]).toString()),'Continuation input must remain an ordinary file');
    return;
  }
  if(profile===MODEL_WORKFLOW_PREFLIGHT){
    assertCanvasPreflightTree(profile.source,read,MODEL_SELECTION_PREFLIGHT);
    assert.deepEqual(read(['rev-list','--parents','-n','1',head]).toString().trim().split(/\s+/),[head,profile.source],'Workflow continuation requires the direct source successor');
    const files=read(['diff','--name-only',profile.source,head]).toString().trim().split('\n').filter(Boolean);
    assert(files.every(file=>['scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs','scripts/test-local-release.mjs'].includes(file)),'Workflow continuation changed product, tests, selection or environment');
    assert(files.includes('scripts/test-local-release.mjs'),'Missing reviewed workflow guard correction');
    const source=read(['show',`${head}:scripts/test-local-release.mjs`]).toString();
    const start='// BEGIN PINNED LOCAL WORKFLOW GUARD',end='// END PINNED LOCAL WORKFLOW GUARD';
    assert.equal(source.split(start).length,2,'Unreviewed workflow guard boundary');assert.equal(source.split(end).length,2,'Unreviewed workflow guard boundary');
    assert.equal(sha256(source.split(start)[1].split(end)[0]),'4878af4143b1aa2f0b6973245bba1ba5d84cf5d259767d0fcebe9fb7e2ec8df3','Unreviewed workflow guard correction');
    for(const file of files)assert(/^100644 blob [0-9a-f]{40}\t/.test(read(['ls-tree',head,'--',file]).toString()),'Continuation input must remain an ordinary file');
    return;
  }
  if(profile===MODEL_SELECTION_PREFLIGHT){
    assertCanvasPreflightTree(profile.source,read,MODEL_OPERATION_PREFLIGHT);
    assert.deepEqual(read(['rev-list','--parents','-n','1',head]).toString().trim().split(/\s+/),[head,profile.source],'Selection continuation requires the direct source successor');
    const files=read(['diff','--name-only',profile.source,head]).toString().trim().split('\n').filter(Boolean);
    assert(files.every(file=>['scripts/test-ci-test-selection.mjs','scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs','scripts/test-local-release.mjs'].includes(file)),'Selection continuation changed product, tests, selection or environment');
    assert(files.includes('scripts/test-ci-test-selection.mjs'),'Missing reviewed selection assertion correction');
    assert.equal(sha256(read(['show',`${head}:scripts/test-ci-test-selection.mjs`])),'f6e963565f82c5ed7ad9a1a3e955650c6eca5d3c4ead2798c502cc65798b7128','Unreviewed selection assertion correction');
    for(const file of files)assert(/^100644 blob [0-9a-f]{40}\t/.test(read(['ls-tree',head,'--',file]).toString()),'Continuation input must remain an ordinary file');
    return;
  }
  if(profile===MODEL_OPERATION_PREFLIGHT){
    assert.deepEqual(read(['rev-list','--parents','-n','1',head]).toString().trim().split(/\s+/),[head,profile.source],'Model-operation continuation requires the direct source successor');
    const files=read(['diff','--name-only',profile.source,head]).toString().trim().split('\n').filter(Boolean);
    const fixes={
      'config/release-compat.json':'aa3f49cf46e960a5e066d89adf5fc2f1e778bda177cc6409e5180971c9f29c3d',
      'scripts/test-release-compat.mjs':'459818a9f29c3d58122a522fdf4bed7883e93a432d847000aa0b8af4f0a37d8e',
    };
    assert(files.every(file=>[...Object.keys(fixes),'scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs','scripts/test-local-release.mjs'].includes(file)),'Model-operation continuation changed product, tests, selection or environment');
    for(const [file,hash]of Object.entries(fixes)){
      assert(files.includes(file),'Missing reviewed manifest correction');
      assert.equal(sha256(read(['show',`${head}:${file}`])),hash,'Unreviewed model-operation manifest correction');
    }
    for(const file of files)assert(/^100644 blob [0-9a-f]{40}\t/.test(read(['ls-tree',head,'--',file]).toString()),'Continuation input must remain an ordinary file');
    return;
  }
  if(profile===EXAMPLE_BROWSER_PREFLIGHT){
    read(['merge-base','--is-ancestor',profile.source,head]);
    const files=read(['diff','--name-only',profile.source,head]).toString().trim().split('\n').filter(Boolean);
    assert(files.every(file=>['tests/helpers/canvas-transition-examples-ui.cjs','scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs','scripts/test-local-release.mjs'].includes(file)),'Example keyboard continuation changed product or unrelated acceptance');
    assert.equal(sha256(read(['show',`${head}:tests/helpers/canvas-transition-examples-ui.cjs`])),'2a5beedfa8614b4ea8bc6fadc9eb6689d4ad5b8e652fe7943d465cba1327c0eb','Only the native keyboard fixture correction may reuse these passes');
    return;
  }
  if(profile===EXAMPLE_PREFLIGHT){
    read(['merge-base','--is-ancestor',profile.source,head]);
    const files=read(['diff','--name-only',profile.source,head]).toString().trim().split('\n').filter(Boolean);
    assert(files.every(file=>['scripts/test-local-release.mjs','scripts/lib/local-release-evidence.mjs','docs/runbooks/REGRESSION_REGISTER.md'].includes(file)),'GIF preflight continuation changed product, selection or environment');
    assert.equal(sha256(read(['show',`${head}:scripts/test-local-release.mjs`])),'2a15ccca6174bdceef33559d7aec5844ba9275d42a1bd6c1e44c6e36ab1b9ede','Only the historical fixture correction may retain this prefix');
    return;
  }

  if(profile===EXPORT_MEDIA_PREFLIGHT){
    read(['merge-base','--is-ancestor',profile.source,head]);
    const files=read(['diff','--name-only',profile.source,head]).toString().trim().split('\n').filter(Boolean);
    assert(files.every(file=>['services/homepage-ffmpeg-processor/canvas-transitions.mjs','scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs','scripts/test-local-release.mjs'].includes(file)),'Media continuation changed passed Worker, API or fixture inputs');
    assert.equal(sha256(read(['show',`${head}:services/homepage-ffmpeg-processor/canvas-transitions.mjs`])),'dae0551ce2e71ce98124681f8de666b2b6188960281a22ae78f7a777c19bf467','Only the frame-preserving timebase correction may reuse the native result');
    return;
  }
  if(profile===EXPORT_NATIVE_PREFLIGHT){
    read(['merge-base','--is-ancestor',profile.source,head]);
    const files=read(['diff','--name-only',profile.source,head]).toString().trim().split('\n').filter(Boolean);
    const expected={
      'tests/helpers/canvas-workspace-transition-control.mjs':'e08ff557e80b5d11f05bb4b707b47b8024d47587208cacb1cc2b54306e7e4f5d',
      'tests/helpers/q2-runtime/linux-hosted.mjs':'566290b6ed2c86b4f3628b4639ede33b73a0f74fbf9065d7e611dc81cc428447',
      'tests/helpers/q2-runtime/environment.mjs':'59d03b8fd837a1f832fc961e33aafe04cf3f239ab6effe56a92ce4c340d9bd0c',
      'scripts/test-q2-runtime-launcher.mjs':'079e54120c1b7e50b6a2fb8e015c54af86bae1e9d2a0176f6f582ebf6e825657',
    };
    assert(files.every(file=>[...Object.keys(expected),'scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs','scripts/test-local-release.mjs'].includes(file)),'Native prefix changed product or unrelated test inputs');
    for(const [file,hash]of Object.entries(expected))assert.equal(sha256(read(['show',`${head}:${file}`])),hash,'Changed scoped native preparation correction');
    return;
  }
  if(profile===EXPORT_PREFLIGHT){
    read(['merge-base','--is-ancestor',profile.source,head]);
    const files=read(['diff','--name-only',profile.source,head]).toString().trim().split('\n').filter(Boolean);
    assert(files.every(file=>['scripts/test-homepage-selection.mjs','scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs','scripts/test-local-release.mjs'].includes(file)),'Export preflight changed product, fixture or command inputs');
    assert.equal(sha256(read(['show',`${head}:scripts/test-homepage-selection.mjs`])),'d2f2793e66d1dd827e9a9408897bb9b0a8d3a1e70f49598e84c55bd144a74be7','Only the seven-branch discovery correction may retain this prefix');
    return;
  }

  const p=CANVAS_PREFLIGHT;read(['merge-base','--is-ancestor',p.source,head]);
  const files=read(['diff','--name-only',p.source,head]).toString().trim().split('\n').filter(Boolean);
  assert(files.every(file=>['scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs','scripts/test-local-release.mjs','tests/helpers/q2-runtime/linux-hosted.mjs','tests/helpers/canvas-workspace-transitions-ui.cjs','tests/helpers/q2-runtime/linux-bootstrap.py','tests/helpers/q2-runtime/environment.mjs','tests/canvas-workspace-transitions.test.mjs'].includes(file)),'Preflight continuation changed product/test/toolchain inputs');
  for(const [file,expected] of Object.entries({"tests/helpers/q2-runtime/environment.mjs":"521a0cb02860d26f47a9c397f89f6376df8c307b7ff1b6de8a1e29a3467547a6","tests/canvas-workspace-transitions.test.mjs":"8e47da53e23997815e7ca7dc6eca5c72b8337a60972bba2877dc95df28c72af1","tests/helpers/q2-runtime/linux-bootstrap.py":"e22052bdb1254f7e282f1c8d137bd443e3c54484d206a5800761eb0dd36a5ba4","tests/helpers/q2-runtime/linux-hosted.mjs": "78a5d0e55049ee6b4489f6fbf32917408f40e5a2c232e2700b2f0867ff4e9ad6", "tests/helpers/canvas-workspace-transitions-ui.cjs": "7326beff758492c53fa238cf76ccf30d9eb8465416768ed257e25844d5e20d96"}))assert.equal(sha256(read(['show',`${head}:${file}`])),expected,'Only the reviewed isolated-stage and new browser fixture corrections may inherit this prefix');
}
const workspaceStageCase='default native runtime plan stages every actual suite and control input';
export function canvasWorkspaceStageContinuation(command){
  const original='node --test tests/canvas-workspace-transitions.test.mjs tests/q2-recovery-staging.test.mjs scripts/test-q2-runtime-launcher.mjs';
  assert(command.includes(original)&&command.includes('node scripts/test-q2-runtime.mjs --suite canvas-transitions'));
  const at=command.indexOf(original),tail=command.slice(at+original.length),join=tail.match(/^\s*&&\s*/);assert(join);return command.slice(0,at)+"node --test --test-name-pattern='^Canvas native migration checkpoint rejects missing, duplicate and undeclared migrations$' tests/canvas-workspace-transitions.test.mjs &&\n"+tail.slice(join[0].length);
}
export function verifyWorkspaceGuardUnion(before,after){
  assert.equal(before.length,30);assert.equal(new Set(before.map(r=>r.title)).size,30);
  assert.deepEqual(before.filter(r=>r.status!=='passed'),[{title:workspaceStageCase,status:'failed'}]);
  assert.deepEqual(after.filter(r=>r.status!=='skipped'),[{title:workspaceStageCase,status:'passed'}]);
  assert.equal(new Set(after.map(r=>r.title)).size,after.length);
  assert(after.every(r=>before.some(old=>old.title===r.title)));
}
export function canvasPreflightPrefix(bytes,{sha,base,planHash,environment,nativeBrowsers,commands,selection},read=gitBytes){
  const original=JSON.parse(bytes),profile=canvasPreflightProfile(original.sha)||CANVAS_PREFLIGHT;
  if([MEDIA_WINDOW_PREFLIGHT,MEDIA_COMPLETION_PREFLIGHT].includes(profile))return mediaCompletionPrefix(bytes,{sha,base,planHash,environment,nativeBrowsers,commands,selection},read);
  if(profile===INCIDENT_BROWSER_PREFLIGHT)return incidentBrowserPrefix(bytes,{sha,base,planHash,environment,nativeBrowsers,commands,selection},read);
  if(profile===INCIDENT_NATIVE_PREFLIGHT)return incidentNativePrefix(bytes,{sha,base,planHash,environment,nativeBrowsers,commands,selection},read);
  if(profile===INCIDENT_WORKER_PREFLIGHT)return incidentWorkerPrefix(bytes,{sha,base,planHash,environment,nativeBrowsers,commands,selection},read);
  if(profile===RELIABILITY_BROWSER_PREFLIGHT)return reliabilityBrowserPrefix(bytes,{sha,base,planHash,environment,nativeBrowsers,commands,selection},read);
  if(profile===RELIABILITY_NATIVE_PREFLIGHT)return reliabilityNativePrefix(bytes,{sha,base,planHash,environment,nativeBrowsers,commands,selection},read);
  if(profile===RELIABILITY_WORKER_PREFLIGHT)return reliabilityWorkerPrefix(bytes,{sha,base,planHash,environment,nativeBrowsers,commands,selection},read);
  if(exportDeliveryCorrectionProfile(profile.source))return exportDeliverySelectionPrefix(bytes,{sha,base,planHash,environment,nativeBrowsers,commands,selection},read,profile);
  if(profile===EXPORT_DELIVERY_PREFLIGHT)return exportDeliveryPrefix(bytes,{sha,base,planHash,environment,nativeBrowsers,commands,selection},read);
  assertCanvasPreflightTree(sha,read,profile);assert.equal(sha256(bytes),profile.checkpoint,'Changed failed preflight checkpoint');
  assert.equal(original.sha,profile.source);assert.equal(original.status,'failed');
  assert.equal(original.base,base);assert.equal(original.planHash,planHash);assert.equal(original.environment.key,environment.key);
  assert.equal(original.commands.length,profile===AUTONOMY_BROWSER_PREFLIGHT?51:[ASSISTANT_BROWSER_PREFLIGHT,SETTLEMENT_BROWSER_PREFLIGHT,MODEL_BROWSER_PREFLIGHT].includes(profile)?50:[ASSISTANT_NATIVE_RATE,ASSISTANT_NATIVE_TAIL,ASSISTANT_NATIVE_PROGRESS,ASSISTANT_NATIVE_PREFLIGHT,ASSISTANT_WORKER_PREFLIGHT,MODEL_WORKER_PREFLIGHT].includes(profile)?42:[SETTLEMENT_NATIVE_PROGRESS,SETTLEMENT_NATIVE_PREFLIGHT].includes(profile)?42:profile===SETTLEMENT_HOSTING_PREFLIGHT?37:[INCIDENT_PREFLIGHT,ASSISTANT_PREFLIGHT,SETTLEMENT_PREFLIGHT,MODEL_WORKFLOW_PREFLIGHT].includes(profile)?18:profile===MODEL_SELECTION_PREFLIGHT?17:profile===MODEL_OPERATION_PREFLIGHT?14:profile===EXAMPLE_BROWSER_PREFLIGHT?42:profile===EXAMPLE_PREFLIGHT?18:profile===EXPORT_PREFLIGHT?16:profile===EXPORT_MEDIA_PREFLIGHT?43:42);assert.equal(original.commands[profile===AUTONOMY_BROWSER_PREFLIGHT?50:[ASSISTANT_BROWSER_PREFLIGHT,SETTLEMENT_BROWSER_PREFLIGHT,MODEL_BROWSER_PREFLIGHT].includes(profile)?49:[ASSISTANT_NATIVE_RATE,ASSISTANT_NATIVE_TAIL,ASSISTANT_NATIVE_PROGRESS,ASSISTANT_NATIVE_PREFLIGHT,ASSISTANT_WORKER_PREFLIGHT,MODEL_WORKER_PREFLIGHT].includes(profile)?41:[SETTLEMENT_NATIVE_PROGRESS,SETTLEMENT_NATIVE_PREFLIGHT].includes(profile)?41:profile===SETTLEMENT_HOSTING_PREFLIGHT?36:[INCIDENT_PREFLIGHT,ASSISTANT_PREFLIGHT,SETTLEMENT_PREFLIGHT,MODEL_WORKFLOW_PREFLIGHT].includes(profile)?17:profile===MODEL_SELECTION_PREFLIGHT?16:profile===MODEL_OPERATION_PREFLIGHT?13:profile===EXAMPLE_BROWSER_PREFLIGHT?41:profile===EXAMPLE_PREFLIGHT?17:profile===EXPORT_PREFLIGHT?15:profile===EXPORT_MEDIA_PREFLIGHT?42:41].exitCode,1);
  if(profile===ASSISTANT_BROWSER_PREFLIGHT){
    assert.deepEqual(original.preflightContinuation,{source:ASSISTANT_NATIVE_RATE.source,checkpoint:ASSISTANT_NATIVE_RATE.checkpoint});
    assert(!original.preflightProgress&&!original.permissionContinuation&&!original.repair);assert(original.commands.slice(0,49).every(row=>row.exitCode===0));
    assert.equal(original.commands[49].command.name,'Run selected homepage core tests');assert.equal(original.commands[49].logHash,profile.failedLog);
    assert.equal(nativeBrowsers?.key,original.nativeBrowsers?.key,'Changed native browser environment cannot inherit browser passes');
  }
  if(profile===ASSISTANT_NATIVE_RATE){
    assert.deepEqual(original.preflightContinuation,{source:ASSISTANT_NATIVE_TAIL.source,checkpoint:ASSISTANT_NATIVE_TAIL.checkpoint});
    assert(!original.preflightProgress&&!original.permissionContinuation&&!original.repair);assert(original.commands.slice(0,41).every(row=>row.exitCode===0));
    assert.equal(original.commands[41].command.name,'Run worker route tests');assert.equal(original.commands[41].logHash,profile.failedLog);assert.equal(original.commands[17].logHash,profile.completedGuardLog);
  }
  if(profile===ASSISTANT_NATIVE_TAIL){
    assert.deepEqual(original.preflightContinuation,{source:ASSISTANT_NATIVE_PROGRESS.source,checkpoint:ASSISTANT_NATIVE_PROGRESS.checkpoint});
    assert(!original.preflightProgress&&!original.permissionContinuation&&!original.repair);assert(original.commands.slice(0,41).every(row=>row.exitCode===0));
    assert.equal(original.commands[41].command.name,'Run worker route tests');assert.equal(original.commands[41].logHash,profile.failedLog);assert.equal(original.commands[17].logHash,profile.completedGuardLog);
  }
  if(profile===ASSISTANT_NATIVE_PROGRESS){
    assert.deepEqual(original.preflightContinuation,{source:ASSISTANT_NATIVE_PREFLIGHT.source,checkpoint:ASSISTANT_NATIVE_PREFLIGHT.checkpoint});
    assert(!original.preflightProgress&&!original.permissionContinuation&&!original.repair);assert(original.commands.slice(0,41).every(row=>row.exitCode===0));
    assert.equal(original.commands[41].command.name,'Run worker route tests');assert.equal(original.commands[41].logHash,profile.failedLog);assert.equal(original.commands[17].logHash,profile.completedGuardLog);
  }
  if(profile===ASSISTANT_NATIVE_PREFLIGHT){
    assert.deepEqual(original.preflightContinuation,{source:ASSISTANT_WORKER_PREFLIGHT.source,checkpoint:ASSISTANT_WORKER_PREFLIGHT.checkpoint});
    assert(!original.preflightProgress&&!original.permissionContinuation&&!original.repair);
    assert(original.commands.slice(0,41).every(row=>row.exitCode===0));
    assert.equal(original.commands[41].command.name,'Run worker route tests');assert.equal(original.commands[41].logHash,profile.failedLog);
    assert.equal(original.commands[17].logHash,profile.completedGuardLog,'Changed completed focused verifier');
  }
  if(profile===ASSISTANT_WORKER_PREFLIGHT){
    assert.deepEqual(original.preflightContinuation,{source:ASSISTANT_PREFLIGHT.source,checkpoint:ASSISTANT_PREFLIGHT.checkpoint});
    assert(!original.preflightProgress&&!original.permissionContinuation&&!original.repair);
    assert(original.commands.slice(0,41).every(row=>row.exitCode===0));
    assert.equal(original.commands[41].command.name,'Run worker route tests');assert.equal(original.commands[41].logHash,profile.failedLog);
    assert.equal(original.commands[17].logHash,profile.completedGuardLog,'Changed completed verifier tail');
  }
  if([INCIDENT_PREFLIGHT,ASSISTANT_PREFLIGHT,SETTLEMENT_PREFLIGHT].includes(profile)){
    assert(!original.preflightContinuation&&!original.preflightProgress&&!original.permissionContinuation&&!original.repair,'Unexpected earlier settlement continuation');
    assert(original.commands.slice(0,17).every(row=>row.exitCode===0&&!row.reusedFrom&&!row.continuation),'Original passing prefix changed');
    assert.equal(original.commands[17].command.name,'Test local release evidence and orchestration');
    assert.equal(original.commands[17].logHash,profile.failedLog,'Changed original failed verifier');
  }
  if(profile===INCIDENT_PREFLIGHT){
    assert.equal(nativeBrowsers?.key,original.nativeBrowsers?.key,'Changed native browser environment');
    assert.deepEqual(nativeBrowsers?.inputs,original.nativeBrowsers?.inputs,'Changed native browser inputs');
    assert.deepEqual(nativeBrowsers?.binaries,original.nativeBrowsers?.binaries,'Changed native browser binaries');
  }
  if(profile===SETTLEMENT_HOSTING_PREFLIGHT){
    assert.deepEqual(original.preflightContinuation,{source:SETTLEMENT_PREFLIGHT.source,checkpoint:SETTLEMENT_PREFLIGHT.checkpoint});
    assert(!original.preflightProgress&&!original.permissionContinuation&&!original.repair,'Unexpected earlier hosting continuation');
    assert(original.commands.slice(0,36).every(row=>row.exitCode===0),'Original passing hosting prefix changed');
    assert.equal(original.commands[36].command.name,'Check frontend hosting package');assert.equal(original.commands[36].logHash,profile.failedLog,'Changed original failed hosting fixture');
  }
  if(profile===SETTLEMENT_NATIVE_PREFLIGHT){
    assert.deepEqual(original.preflightContinuation,{source:SETTLEMENT_HOSTING_PREFLIGHT.source,checkpoint:SETTLEMENT_HOSTING_PREFLIGHT.checkpoint});
    assert(!original.preflightProgress&&!original.permissionContinuation&&!original.repair);assert(original.commands.slice(0,41).every(row=>row.exitCode===0));
    assert.equal(original.commands[41].command.name,'Run worker route tests');assert.equal(original.commands[41].logHash,profile.failedLog);
  }
  if(profile===SETTLEMENT_NATIVE_PROGRESS){
    assert.deepEqual(original.preflightContinuation,{source:SETTLEMENT_NATIVE_PREFLIGHT.source,checkpoint:SETTLEMENT_NATIVE_PREFLIGHT.checkpoint});
    assert(!original.preflightProgress&&!original.permissionContinuation&&!original.repair);assert(original.commands.slice(0,41).every(row=>row.exitCode===0));assert.equal(original.commands[41].logHash,profile.failedLog);
  }
  if(profile===SETTLEMENT_BROWSER_PREFLIGHT){
    assert.deepEqual(original.preflightContinuation,{source:SETTLEMENT_NATIVE_PROGRESS.source,checkpoint:SETTLEMENT_NATIVE_PROGRESS.checkpoint});
    assert(!original.preflightProgress&&!original.permissionContinuation&&!original.repair);assert(original.commands.slice(0,49).every(row=>row.exitCode===0));assert.equal(original.commands[49].logHash,profile.failedLog);
  }
  if(profile===MODEL_SELECTION_PREFLIGHT)assert.deepEqual(original.preflightContinuation,{source:MODEL_OPERATION_PREFLIGHT.source,checkpoint:MODEL_OPERATION_PREFLIGHT.checkpoint},'Missing original preflight chain');
  if(profile===MODEL_WORKFLOW_PREFLIGHT)assert.deepEqual(original.preflightContinuation,{source:MODEL_SELECTION_PREFLIGHT.source,checkpoint:MODEL_SELECTION_PREFLIGHT.checkpoint},'Missing original preflight chain');
  if(profile===MODEL_WORKER_PREFLIGHT)assert.deepEqual(original.preflightContinuation,{source:MODEL_WORKFLOW_PREFLIGHT.source,checkpoint:MODEL_WORKFLOW_PREFLIGHT.checkpoint},'Missing original preflight chain');
  if(profile===AUTONOMY_BROWSER_PREFLIGHT)assert.deepEqual(original.preflightContinuation,{source:AUTONOMY_NATIVE_PREFLIGHT.source,checkpoint:AUTONOMY_NATIVE_PREFLIGHT.checkpoint},'Missing original preflight chain');
  if(profile===MODEL_BROWSER_PREFLIGHT)assert.deepEqual(original.preflightContinuation,{source:MODEL_WORKER_PREFLIGHT.source,checkpoint:MODEL_WORKER_PREFLIGHT.checkpoint},'Missing original preflight chain');
  if([INCIDENT_PREFLIGHT,ASSISTANT_BROWSER_PREFLIGHT,ASSISTANT_NATIVE_RATE,ASSISTANT_NATIVE_TAIL,ASSISTANT_NATIVE_PROGRESS,ASSISTANT_NATIVE_PREFLIGHT,ASSISTANT_WORKER_PREFLIGHT,ASSISTANT_PREFLIGHT,SETTLEMENT_BROWSER_PREFLIGHT,SETTLEMENT_NATIVE_PROGRESS,SETTLEMENT_NATIVE_PREFLIGHT,SETTLEMENT_HOSTING_PREFLIGHT,SETTLEMENT_PREFLIGHT,CANVAS_POLICY_NATIVE_PREFLIGHT,CANVAS_POLICY_WORKER_PREFLIGHT,MODEL_OPERATION_PREFLIGHT,MODEL_SELECTION_PREFLIGHT,MODEL_WORKFLOW_PREFLIGHT,MODEL_WORKER_PREFLIGHT,MODEL_BROWSER_PREFLIGHT].includes(profile)){
    const flags=({files,reasons,...metadata})=>metadata;
    assert.deepEqual(flags(selection),flags(original.selection),'Changed selection cannot inherit preflight evidence');
    assert.equal(environment.image,original.environment.image,'Changed execution image');
    if([INCIDENT_PREFLIGHT,ASSISTANT_BROWSER_PREFLIGHT,ASSISTANT_NATIVE_RATE,ASSISTANT_NATIVE_TAIL,ASSISTANT_NATIVE_PROGRESS,ASSISTANT_NATIVE_PREFLIGHT,ASSISTANT_WORKER_PREFLIGHT,ASSISTANT_PREFLIGHT,SETTLEMENT_BROWSER_PREFLIGHT,SETTLEMENT_NATIVE_PROGRESS,SETTLEMENT_NATIVE_PREFLIGHT,SETTLEMENT_HOSTING_PREFLIGHT,SETTLEMENT_PREFLIGHT,CANVAS_POLICY_NATIVE_PREFLIGHT,CANVAS_POLICY_WORKER_PREFLIGHT].includes(profile))assert.deepEqual(environment.inputs,original.environment.inputs,'Changed execution inputs');
    assert.equal(commands.length,52,'Changed release command closure');
    assert.deepEqual(commands,selectedCommands(original.selection,{GITHUB_SHA:sha,CANDIDATE_BASE:base}),'Changed release command closure');
  }
  if([AUTONOMY_NATIVE_PREFLIGHT,AUTONOMY_BROWSER_PREFLIGHT].includes(profile)){
    const flags=({files,reasons,...metadata})=>metadata;
    assert.deepEqual(flags(selection),flags(original.selection),'Changed selection cannot inherit preflight evidence');
    assert.deepEqual(environment.inputs,original.environment.inputs,'Changed execution inputs');
    assert.equal(environment.image,original.environment.image,'Changed execution image');
    assert.equal(commands.length,53,'Changed release command closure');
    assert.deepEqual(commands,selectedCommands(original.selection,{GITHUB_SHA:sha,CANDIDATE_BASE:base}),'Changed release command closure');
  }
  for(const i of profile.retain){assert.equal(original.commands[i].exitCode,0);assert.deepEqual(original.commands[i].command,commands[i]);}
  return original;
}
const exportGuardCases=['default native runtime plan stages every actual suite and control input','focused native scopes dispatch through the actual child and preserve boundaries'];
export function canvasExportStageContinuation(command){
  const original='node --test tests/canvas-workspace-transitions.test.mjs tests/q2-recovery-staging.test.mjs scripts/test-q2-runtime-launcher.mjs';
  assert(command.includes(original)&&command.includes('node scripts/test-q2-runtime.mjs --suite canvas-transitions'));
  const at=command.indexOf(original),tail=command.slice(at+original.length),join=tail.match(/^\s*&&\s*/);assert(join);
  return command.slice(0,at)+tail.slice(join[0].length);
}
export function verifyExportGuardUnion(before,after){
  assert.equal(before.length,32);assert.equal(new Set(before.map(r=>r.title)).size,32);
  assert.deepEqual(before.filter(r=>r.status!=='passed').map(r=>r.title).sort(),[...exportGuardCases].sort());
  assert(before.filter(r=>r.status!=='passed').every(r=>r.status==='failed'));
  assert.deepEqual(after.filter(r=>r.status!=='skipped').map(r=>({title:r.title,status:r.status})).sort((a,b)=>a.title.localeCompare(b.title)),exportGuardCases.map(title=>({title,status:'passed'})).sort((a,b)=>a.title.localeCompare(b.title)));
  assert.equal(new Set(after.map(r=>r.title)).size,after.length);assert(after.every(r=>before.some(old=>old.title===r.title)));
}
export function verifyCanvasPreflight(directory,evidence,commands){
  if([MEDIA_WINDOW_PREFLIGHT.source,MEDIA_COMPLETION_PREFLIGHT.source].includes(evidence.preflightContinuation?.source))return verifyMediaCompletionContinuation(directory,evidence,commands);
  if(evidence.preflightContinuation?.source===INCIDENT_BROWSER_PREFLIGHT.source)return verifyIncidentBrowserContinuation(directory,evidence,commands);
  if(evidence.preflightContinuation?.source===INCIDENT_NATIVE_PREFLIGHT.source)return verifyIncidentNativeContinuation(directory,evidence,commands);
  if(evidence.preflightContinuation?.source===INCIDENT_WORKER_PREFLIGHT.source)return verifyIncidentWorkerContinuation(directory,evidence,commands);
  if(evidence.preflightContinuation?.source===RELIABILITY_BROWSER_PREFLIGHT.source)return verifyReliabilityBrowserContinuation(directory,evidence,commands);
  if(evidence.preflightContinuation?.source===RELIABILITY_NATIVE_PREFLIGHT.source)return verifyReliabilityNativeContinuation(directory,evidence,commands);
  if(evidence.preflightContinuation?.source===RELIABILITY_WORKER_PREFLIGHT.source)return verifyReliabilityWorkerContinuation(directory,evidence,commands);
  if(evidence.preflightContinuation?.source===EXPORT_DELIVERY_PREFLIGHT.source||exportDeliveryCorrectionProfile(evidence.preflightContinuation?.source)){
    verifyExportDeliveryReuse(directory,evidence,commands,{read:gitBytes,readFile:fs.readFileSync});
    if(evidence.preflightContinuation.source===EXPORT_DELIVERY_BROWSER_PREFLIGHT.source){
      const raw=fs.readFileSync(path.join(directory,'reuse/export-browser-original.json'));
      assert.equal(sha256(raw),EXPORT_DELIVERY_BROWSER_PREFLIGHT.report,'Changed original export browser failures/passes');
      const report=JSON.parse(fs.readFileSync(path.join(directory,'test-results/candidate-auth.json')));
      assert.deepEqual(report.previous,browserRows(JSON.parse(raw)));
      assert.deepEqual(report.discovery,browserRows(JSON.parse(fs.readFileSync(path.join(directory,'test-results/canvas-discovery.json'))),{discovery:true}));
      verifyExportDeliveryBrowserReport(report,evidence.sha);
    }
    return;
  }
  const profile=canvasPreflightProfile(evidence.preflightContinuation?.source);assert(profile,'Unknown preflight origin');
  assert.deepEqual(evidence.preflightContinuation,{source:profile.source,checkpoint:profile.checkpoint});
  const original=canvasPreflightPrefix(fs.readFileSync(path.join(directory,'reuse/preflight-checkpoint.json')),{...evidence,commands});
  if(profile===SETTLEMENT_HOSTING_PREFLIGHT)verifyCanvasPreflight(path.join(directory,'reuse/settlement-preflight-origin'),original,selectedCommands(original.selection,{GITHUB_SHA:original.sha,CANDIDATE_BASE:original.base}));
  if(profile===SETTLEMENT_NATIVE_PREFLIGHT){
    verifyCanvasPreflight(path.join(directory,'reuse/settlement-hosting-origin'),original,selectedCommands(original.selection,{GITHUB_SHA:original.sha,CANDIDATE_BASE:original.base}));
    verifySettlementNativeRepair(directory,evidence.sha);restoreCanvasHostingProof(directory,{verifyOnly:true});
    assert.equal(sha256(fs.readFileSync(path.join(directory,'test-results/frontend-runtime.log'))),profile.hostingLog);
  }
  if(profile===SETTLEMENT_NATIVE_PROGRESS){
    verifySettlementNativeProgress(directory,evidence.sha);restoreCanvasHostingProof(directory,{verifyOnly:true});
    assert.equal(sha256(fs.readFileSync(path.join(directory,'test-results/frontend-runtime.log'))),profile.hostingLog);
  }
  if([ASSISTANT_BROWSER_PREFLIGHT,SETTLEMENT_BROWSER_PREFLIGHT].includes(profile)){verifyModelBrowserRepair(directory,evidence.sha,{profile});restoreCanvasHostingProof(directory,{verifyOnly:true});}
  if([INCIDENT_PREFLIGHT,ASSISTANT_BROWSER_PREFLIGHT,ASSISTANT_NATIVE_RATE,ASSISTANT_NATIVE_TAIL,ASSISTANT_NATIVE_PROGRESS,ASSISTANT_NATIVE_PREFLIGHT,ASSISTANT_WORKER_PREFLIGHT,ASSISTANT_PREFLIGHT,SETTLEMENT_BROWSER_PREFLIGHT,SETTLEMENT_NATIVE_PROGRESS,SETTLEMENT_NATIVE_PREFLIGHT,SETTLEMENT_HOSTING_PREFLIGHT,SETTLEMENT_PREFLIGHT,CANVAS_POLICY_NATIVE_PREFLIGHT,CANVAS_POLICY_WORKER_PREFLIGHT,MODEL_OPERATION_PREFLIGHT,MODEL_SELECTION_PREFLIGHT,MODEL_WORKFLOW_PREFLIGHT,MODEL_WORKER_PREFLIGHT,MODEL_BROWSER_PREFLIGHT].includes(profile))assert.equal(sha256(fs.readFileSync(path.join(directory,'reuse/preflight-failed.log'))),profile.failedLog,'Changed original failed preflight log');
  if(profile===AUTONOMY_NATIVE_PREFLIGHT){
    verifyAutonomyNativeRepair(directory,evidence.sha);restoreCanvasHostingProof(directory,{verifyOnly:true});
    assert.equal(sha256(fs.readFileSync(path.join(directory,'test-results/frontend-runtime.log'))),profile.hostingLog,'Changed retained hosting log');
  }
  if(profile===AUTONOMY_BROWSER_PREFLIGHT){verifyAutonomyBrowserRepair(directory,evidence.sha);restoreCanvasHostingProof(directory,{verifyOnly:true});}
  if(profile===MODEL_BROWSER_PREFLIGHT){verifyModelBrowserRepair(directory,evidence.sha);restoreCanvasHostingProof(directory,{verifyOnly:true});}
  if(profile===ASSISTANT_NATIVE_RATE){verifyAssistantNativeRate(directory,evidence.sha);restoreCanvasHostingProof(directory,{verifyOnly:true});assert.equal(sha256(fs.readFileSync(path.join(directory,'test-results/frontend-runtime.log'))),profile.hostingLog);}
  if(profile===ASSISTANT_NATIVE_TAIL){verifyAssistantNativeTail(directory,evidence.sha);restoreCanvasHostingProof(directory,{verifyOnly:true});assert.equal(sha256(fs.readFileSync(path.join(directory,'test-results/frontend-runtime.log'))),profile.hostingLog);}
  if(profile===ASSISTANT_NATIVE_PROGRESS){verifyAssistantNativeProgress(directory,evidence.sha);restoreCanvasHostingProof(directory,{verifyOnly:true});assert.equal(sha256(fs.readFileSync(path.join(directory,'test-results/frontend-runtime.log'))),profile.hostingLog);}
  if(profile===ASSISTANT_NATIVE_PREFLIGHT){verifyAssistantNativeRepair(directory,evidence.sha);restoreCanvasHostingProof(directory,{verifyOnly:true});assert.equal(sha256(fs.readFileSync(path.join(directory,'test-results/frontend-runtime.log'))),profile.hostingLog);}
  if(profile===ASSISTANT_WORKER_PREFLIGHT)verifyAssistantWorkerRepair(directory,evidence.sha);
  if(profile===MODEL_WORKER_PREFLIGHT)verifyModelWorkerRepair(directory,evidence.sha);
  if(profile===CANVAS_POLICY_NATIVE_PREFLIGHT){
    verifyCanvasPolicyNativeRepair(directory,evidence.sha);restoreCanvasHostingProof(directory,{verifyOnly:true});
    assert.equal(evidence.nativeBrowsers?.key,original.nativeBrowsers?.key,'Changed retained hosting browser environment');
    assert.equal(sha256(fs.readFileSync(path.join(directory,'test-results/frontend-runtime.log'))),profile.hostingLog,'Changed retained hosting log');
  }
  if(profile===CANVAS_POLICY_WORKER_PREFLIGHT){
    verifyCanvasPolicyWorkerRepair(directory,evidence.sha);restoreCanvasHostingProof(directory,{verifyOnly:true});
    assert.equal(evidence.nativeBrowsers?.key,original.nativeBrowsers?.key,'Changed retained hosting browser environment');
    assert.equal(sha256(fs.readFileSync(path.join(directory,'test-results/frontend-runtime.log'))),profile.hostingLog,'Changed retained hosting log');
  }
  if(profile===MODEL_WORKFLOW_PREFLIGHT)verifyCanvasPreflight(path.join(directory,'reuse/model-selection-origin'),original,selectedCommands(original.selection,{GITHUB_SHA:original.sha,CANDIDATE_BASE:original.base}));
  if(profile===MODEL_SELECTION_PREFLIGHT)verifyCanvasPreflight(path.join(directory,'reuse/model-operation-origin'),original,selectedCommands(original.selection,{GITHUB_SHA:original.sha,CANDIDATE_BASE:original.base}));
  if(profile===EXAMPLE_BROWSER_PREFLIGHT){
    const log=fs.readFileSync(path.join(directory,'reuse/example-asset-pass.log'));assert.equal(sha256(log),profile.assetLog);
    assert(log.toString().includes('ok 1 - Every offered transition has a small distinct decoded GIF'));
    restoreCanvasHostingProof(directory,{verifyOnly:true});
  }
  const workerProgress=profile===AUTONOMY_BROWSER_PREFLIGHT&&isAutonomyBrowserWorkerProgress(evidence.sha);
  const docProgress=profile===AUTONOMY_BROWSER_PREFLIGHT&&isAutonomyBrowserDocProgress(evidence.sha);
  const nativeProgress=profile===CANVAS_POLICY_NATIVE_PREFLIGHT&&isCanvasPolicyNativeProgress(evidence.sha);
  const progress=nativeProgress?verifyCanvasPolicyNativeProgress(directory,evidence.sha):workerProgress?verifyAutonomyBrowserWorkerProgress(directory,evidence.sha):docProgress?verifyAutonomyBrowserDocProgress(directory,evidence.sha):profile===AUTONOMY_BROWSER_PREFLIGHT&&isAutonomyBrowserProgress(evidence.sha)?verifyAutonomyBrowserProgress(directory,evidence.sha):null;
  const progressProfile=nativeProgress?CANVAS_POLICY_NATIVE_PROGRESS:workerProgress?AUTONOMY_BROWSER_WORKER_PROGRESS:docProgress?AUTONOMY_BROWSER_DOC_PROGRESS:AUTONOMY_BROWSER_PROGRESS;
  if(progress)assert.deepEqual(evidence.preflightProgress,{source:progressProfile.source,checkpoint:progressProfile.checkpoint});
  else assert(!evidence.preflightProgress,'Unexpected planner progress receipt');
  for(const [i,row]of evidence.commands.entries()){
    if(progress&&progress.retained.includes(i)){
      assert.deepEqual(row,{...progress.original.commands[i],reusedFrom:progress.original.commands[i].reusedFrom||progress.original.sha});
      assert.equal(sha256(fs.readFileSync(path.join(directory,row.log))),row.logHash);
    }else if(profile===ASSISTANT_BROWSER_PREFLIGHT&&i===17){
      assert(!row.reusedFrom);assert.equal(row.continuation,assistantBrowserGuard(commands[i].run));
      const log=fs.readFileSync(path.join(directory,row.log),'utf8');
      assert(log.includes('Assistant browser continuation: retained upstream and first-attempt browser passes require exact-source receipts; missing, forged, retried, duplicated and changed-discovery controls reject.'));
      for(const completed of ['Local command mapping, no hosted duplicate suites','Assistant Worker continuation:','Assistant native continuation:','Assistant native progress:','Assistant native tail:','Assistant native rate tail:'])assert(!log.includes(completed),'Completed verifier groups repeated');
    }else if(profile===ASSISTANT_BROWSER_PREFLIGHT&&[49,50].includes(i)){
      assert(!row.reusedFrom);assert.equal(row.browserContinuation,MODEL_BROWSER_POLICY);assert.equal(row.continuation,assistantBrowserContinuation(commands[i].run,i===50?'auth':'homepage'));
    }else if(profile===ASSISTANT_NATIVE_RATE&&i===17){
      assert(!row.reusedFrom);assert.equal(row.continuation,assistantNativeRateGuard(commands[i].run));
      const log=fs.readFileSync(path.join(directory,row.log),'utf8');
      assert(log.includes('Assistant native rate tail: 1630 Worker, media, 30 launcher and 334 native passes retained; exact 100 remaining Canvas callbacks required with full isolation and inventory evidence.'));
      for(const completed of ['Local command mapping, no hosted duplicate suites','Assistant Worker continuation:','Assistant native continuation:','Assistant native progress:','Assistant native tail:'])assert(!log.includes(completed),'Completed verifier groups repeated');
    }else if(profile===ASSISTANT_NATIVE_RATE&&i===41){
      assert(!row.reusedFrom);assert.equal(row.continuation,assistantNativeRateContinuation(commands[i].run));
    }else if(profile===ASSISTANT_NATIVE_TAIL&&i===17){
      assert(!row.reusedFrom);assert.equal(row.continuation,assistantNativeTailGuard(commands[i].run));
      const log=fs.readFileSync(path.join(directory,row.log),'utf8');
      assert(log.includes('Assistant native tail: 1630 Worker, media, 30 launcher and 326 native passes retained; exact 108 remaining Canvas callbacks required with full isolation and inventory evidence.'));
      for(const completed of ['Local command mapping, no hosted duplicate suites','Assistant Worker continuation:','Assistant native continuation:','Assistant native progress:'])assert(!log.includes(completed),'Completed verifier groups repeated');
    }else if(profile===ASSISTANT_NATIVE_TAIL&&i===41){
      assert(!row.reusedFrom);assert.equal(row.continuation,assistantNativeTailContinuation(commands[i].run));
    }else if(profile===ASSISTANT_NATIVE_PROGRESS&&i===17){
      assert(!row.reusedFrom);assert.equal(row.continuation,assistantNativeProgressGuard(commands[i].run));
      const log=fs.readFileSync(path.join(directory,row.log),'utf8');
      assert(log.includes('Assistant native progress: 1630 Worker, media, 30 launcher and 184 native passes retained; exact 250 remaining Canvas callbacks required with full isolation and inventory evidence.'));
      for(const completed of ['Local command mapping, no hosted duplicate suites','Assistant Worker continuation:','Assistant native continuation:'])assert(!log.includes(completed),'Completed verifier groups repeated');
    }else if(profile===ASSISTANT_NATIVE_PROGRESS&&i===41){
      assert(!row.reusedFrom);assert.equal(row.continuation,assistantNativeProgressContinuation(commands[i].run));
    }else if(profile===ASSISTANT_NATIVE_PREFLIGHT&&i===17){
      assert(!row.reusedFrom);assert.equal(row.continuation,assistantNativeGuardContinuation(commands[i].run));
      const log=fs.readFileSync(path.join(directory,row.log),'utf8');
      assert(log.includes('Assistant native continuation: 1630 Worker cases, real media checks and 26 launcher passes retained; four corrected launcher cases and the complete native runtime remain mandatory.'));
      for(const completed of ['Local command mapping, no hosted duplicate suites','Assistant Worker continuation:','Assistant preflight continuation:'])assert(!log.includes(completed),'Completed verifier groups repeated');
    }else if(profile===ASSISTANT_NATIVE_PREFLIGHT&&i===41){
      assert(!row.reusedFrom);assert.equal(row.continuation,assistantNativeContinuation(commands[i].run));
    }else if(profile===ASSISTANT_WORKER_PREFLIGHT&&i===17){
      assert(!row.reusedFrom);assert.equal(row.continuation,assistantWorkerGuardContinuation(commands[i].run));
      const log=fs.readFileSync(path.join(directory,row.log),'utf8');
      assert(log.includes('Assistant Worker continuation: 1617 original passes, 12 corrected cases and one new organization case require exact-source receipts; missing, forged, retried, duplicate and changed-discovery controls reject.'));
      for(const completed of ['Local command mapping, no hosted duplicate suites','Permission continuation: exact failed checkpoint/tree','Assistant preflight continuation: historical fixture pinned'])assert(!log.includes(completed),'Completed verifier groups repeated');
    }else if(profile===ASSISTANT_WORKER_PREFLIGHT&&i===41){
      assert(!row.reusedFrom);assert.equal(row.continuation,assistantWorkerContinuation(commands[i].run));
    }else if(profile===ASSISTANT_PREFLIGHT&&i===17){
      assert(!row.reusedFrom);assert.equal(row.continuation,assistantPreflightGuardContinuation(commands[i].run));
      const log=fs.readFileSync(path.join(directory,row.log),'utf8');
      assert(log.includes('Assistant preflight continuation: historical fixture pinned, retained prefix authenticated, changed inputs rejected and remaining verifier tail completed.'));
      for(const completed of ['Local command mapping, no hosted duplicate suites','Synthetic evidence: matching exact Git','Pinned chromium launch and keyboard smoke',
        'Local media parent: real child failure/timeout','Closed local continuation: complete case union','Import permission: scoped writer'])
        assert(!log.includes(completed),'Previously passed verifier groups repeated');
    }else if(profile===SETTLEMENT_BROWSER_PREFLIGHT&&i===17){
      assert(!row.reusedFrom);assert.equal(row.continuation,settlementBrowserGuard(commands[i].run));
      const log=fs.readFileSync(path.join(directory,row.log),'utf8');assert(log.includes('Settlement browser continuation:634-case discovery,630 retained outcomes,4 required corrections,25 Auth overlaps and385 native passes remain bound to original evidence.'));
      assert(!log.includes('Settlement native progress:')&&!log.includes('Settlement native continuation:'));
    }else if(profile===SETTLEMENT_BROWSER_PREFLIGHT&&[49,50].includes(i)){
      assert(!row.reusedFrom);assert.equal(row.browserContinuation,MODEL_BROWSER_POLICY);assert.equal(row.continuation,settlementBrowserContinuation(commands[i].run,i===50?'auth':'homepage'));
    }else if(profile===SETTLEMENT_NATIVE_PROGRESS&&i===17){
      assert(!row.reusedFrom);assert.equal(row.continuation,settlementNativeProgressGuard(commands[i].run));
      const log=fs.readFileSync(path.join(directory,row.log),'utf8');assert(log.includes('Settlement native progress: actual saved Node22 empty-file envelope verified; staging assertion retained once and native child still required.'));
      assert(!log.includes('Settlement native continuation:')&&!log.includes('Settlement hosting continuation:')&&!log.includes('Settlement preflight continuation:'));
    }else if(profile===SETTLEMENT_NATIVE_PROGRESS&&i===41){
      assert(!row.reusedFrom);assert.equal(row.continuation,settlementNativeProgressContinuation(commands[i].run));
    }else if(profile===SETTLEMENT_NATIVE_PREFLIGHT&&i===17){
      assert(!row.reusedFrom);assert.equal(row.continuation,settlementNativeGuardContinuation(commands[i].run));
      const log=fs.readFileSync(path.join(directory,row.log),'utf8');assert(log.includes('Settlement native continuation: immutable1574 Worker and FFmpeg passes,29 retained launcher cases and one required correction verified; full native runtime remains mandatory.'));
      assert(!log.includes('Settlement hosting continuation:')&&!log.includes('Settlement preflight continuation:')&&!log.includes('Canvas native continuation:'));
    }else if(profile===SETTLEMENT_NATIVE_PREFLIGHT&&i===41){
      assert(!row.reusedFrom);assert.equal(row.continuation,settlementNativeContinuation(commands[i].run));
    }else if(profile===SETTLEMENT_HOSTING_PREFLIGHT&&i===17){
      assert(!row.reusedFrom);assert.equal(row.continuation,settlementHostingGuardContinuation(commands[i].run));
      const log=fs.readFileSync(path.join(directory,row.log),'utf8');
      assert(log.includes('Settlement hosting continuation: original completed guards, exact fixture repair, immutable evidence chain and fresh downstream acceptance enforced.'));
      assert(!log.includes('Canvas native continuation:')&&!log.includes('Settlement preflight continuation:'),'Previously passed verifier groups repeated');
    }else if(profile===SETTLEMENT_PREFLIGHT&&i===17){
      assert(!row.reusedFrom);assert.equal(row.continuation,settlementPreflightGuardContinuation(commands[i].run));
      const log=fs.readFileSync(path.join(directory,row.log),'utf8');
      assert(log.includes('Canvas native continuation: exact source/artifact boundaries and187 retained+183 required native cases verified;'));
      assert(log.includes('Settlement preflight continuation: pinned failed source, exact historical discovery, retained logs and changed-input rejection verified; completed verifier groups and product tests never repeated.'));
      assert(!log.includes('Model-operation continuation: real Git trees'),'Previously passed verifier groups repeated');
    }else if(nativeProgress&&i===17){
      assert(!row.reusedFrom);assert.equal(row.continuation,canvasPolicyNativeGuardContinuation(commands[i].run));
    }else if(workerProgress&&i===17){
      assert(!row.reusedFrom);assert.equal(row.continuation,autonomyWorkerGuardContinuation(commands[i].run));
    }else if(docProgress&&i===28){
      assert(!row.reusedFrom);assert.equal(row.continuation,autonomyDocInventoryContinuation(commands[i].run));
    }else if(docProgress&&i===16){
      assert(!row.reusedFrom);assert.equal(row.continuation,autonomyDocSelectionContinuation(commands[i].run));
    }else if(docProgress&&i===17){
      assert(!row.reusedFrom);assert.equal(row.continuation,autonomyDocGuardContinuation(commands[i].run));
    }else if(progress&&i===14){
      assert(!row.reusedFrom);assert.equal(row.continuation,autonomyReleasePlanContinuation(commands[i].run));
      const log=fs.readFileSync(path.join(directory,row.log),'utf8');
      assert(log.includes('Autonomy planner continuation: retained the pinned completed prefix; starting test-canvas-agent-release.mjs.'));
      assert(log.includes('Autonomy planner continuation: complete remaining release-plan assertions passed.'));
      assert(!log.includes('Release planner tests passed.')&&!log.includes('Auth configuration: reviewed absent-to-off'),'Completed planner prefix repeated');
    }else if(profile.retain.includes(i)){
      assert.deepEqual({...row,reusedFrom:undefined},{...original.commands[i],reusedFrom:undefined});assert.equal(row.reusedFrom,original.commands[i].reusedFrom||original.sha);
      assert.equal(sha256(fs.readFileSync(path.join(directory,row.log))),original.commands[i].logHash);
    }else if([50,51].includes(i)&&profile===AUTONOMY_BROWSER_PREFLIGHT){
      assert(!row.reusedFrom);assert.equal(row.browserContinuation,AUTONOMY_BROWSER_POLICY);assert.equal(row.continuation,autonomyBrowserContinuation(commands[i].run,i===51?'auth':'homepage'));
    }else if(i===41&&profile===AUTONOMY_BROWSER_PREFLIGHT){
      assert(!row.reusedFrom);assert.equal(row.continuation,autonomyRetentionContinuation(commands[i].run));
    }else if([49,50].includes(i)&&profile===MODEL_BROWSER_PREFLIGHT){
      assert(!row.reusedFrom);assert.equal(row.browserContinuation,MODEL_BROWSER_POLICY);assert.equal(row.continuation,modelBrowserContinuation(commands[i].run,i===50?'auth':'homepage'));
    }else if(i===41&&profile===AUTONOMY_NATIVE_PREFLIGHT){
      assert(!row.reusedFrom);assert.equal(row.continuation,autonomyNativeContinuation(commands[i].run));
    }else if(i===41&&profile===CANVAS_POLICY_NATIVE_PREFLIGHT){
      assert(!row.reusedFrom);assert.equal(row.continuation,canvasPolicyNativeContinuation(commands[i].run,{progress:nativeProgress}));
    }else if(i===41&&profile===CANVAS_POLICY_WORKER_PREFLIGHT){
      assert(!row.reusedFrom);assert.equal(row.continuation,canvasPolicyWorkerContinuation(commands[i].run));
    }else if(i===41&&profile===MODEL_WORKER_PREFLIGHT){
      assert(!row.reusedFrom);assert.equal(row.continuation,modelWorkerContinuation(commands[i].run));
    }else if(i===41&&profile===EXAMPLE_BROWSER_PREFLIGHT){
      assert(!row.reusedFrom);assert.equal(row.continuation,canvasExampleBrowserContinuation(commands[i].run));
    }else if(i===41&&profile===CANVAS_PREFLIGHT){
      assert(!row.reusedFrom);assert.equal(row.continuation,canvasWorkspaceStageContinuation(commands[i].run));
      const prior=fs.readFileSync(path.join(directory,'reuse/stage-guard.log'));assert.equal(sha256(prior),CANVAS_PREFLIGHT.guardLog);
      const progress=fs.readFileSync(path.join(directory,'reuse/stage-progress.log'));assert.equal(sha256(progress),CANVAS_PREFLIGHT.guardProgress);
      verifyWorkspaceGuardUnion(tapResults(prior.toString()),tapResults(progress.toString()));assert.deepEqual(tapResults(fs.readFileSync(path.join(directory,row.log),'utf8')).filter(r=>r.status!=='skipped'),[{title:'Canvas native migration checkpoint rejects missing, duplicate and undeclared migrations',status:'passed'}],'Only the new moving-checkpoint countercheck executes; passed guards must not repeat');
    }else if(i===41&&profile===EXPORT_NATIVE_PREFLIGHT){
      assert(!row.reusedFrom);assert.equal(row.continuation,canvasExportStageContinuation(commands[i].run));
      const prior=fs.readFileSync(path.join(directory,'reuse/stage-guard.log'));assert.equal(sha256(prior),profile.guardLog);
      const progress=fs.readFileSync(path.join(directory,'reuse/stage-progress.log'));assert.equal(sha256(progress),profile.guardProgress);
      verifyExportGuardUnion(tapResults(prior.toString()),tapResults(progress.toString()));
      assert.deepEqual(tapResults(fs.readFileSync(path.join(directory,row.log),'utf8')),[],'Passed native guards must not execute again');
    }else assert(!row.reusedFrom&&!row.continuation,'Affected or unexecuted check cannot inherit preflight success');
  }
}

export const STORED_PLAN_REFRESH=new Set([
  'Preflight complete static release plan','Run quality gate tests','Check committed secrets',
  'Check operational readiness docs','Check targeted JavaScript syntax','Test local release evidence and orchestration',
  'Check documentation currentness','Record candidate build','Validate static website references','Validate JS import paths',
  'Check target="_blank" links have rel="noopener"','Validate page metadata',
  'Verify native Linux isolation before Worker tests','Run worker route tests',
  'Restore exact candidate static site','Confirm tested browser candidate bytes',
]);
const storedPlanKey=command=>command.job+':'+command.name;
export function storedPlanPrefix(bytes,{sha,base,planHash,environment,nativeBrowsers,commands,selection},read=gitBytes){
  const p=STORED_PLAN_CONTINUATION;assertStoredPlanTree(sha,read);assert.equal(sha256(bytes),p.checkpoint,'Changed completed release checkpoint');
  const original=JSON.parse(bytes);assert.equal(original.sha,p.source);assert.equal(original.status,'passed');assert.equal(base,p.source,'Continuation must use the currently published source');
  assert.equal(original.planHash,planHash);assert.equal(original.environment.key,environment.key);assert.equal(original.environment.image,environment.image);assert.deepEqual(original.environment.inputs,environment.inputs);assert.equal(original.nativeBrowsers.key,nativeBrowsers?.key);verifyNativeBrowserEnvironment(nativeBrowsers);
  assert.equal(original.commands.length,52);assert(original.commands.every(row=>row.exitCode===0));
  assert.equal(selection.full,false);assert.equal(selection.workers,true);assert.equal(selection.auth,true);assert.equal(selection.homepage,false);
  assert.equal(commands.length,46,'Changed scoped release command closure');
  const prior=new Map(original.commands.map(row=>[storedPlanKey(row.command),row]));
  for(const command of commands){assert(prior.has(storedPlanKey(command)),'New release command requires explicit evidence');if(!STORED_PLAN_REFRESH.has(command.name))assert.deepEqual(command,prior.get(storedPlanKey(command)).command,'Changed retained command');}
  return original;
}
export function verifyStoredPlanPlacement(directory,context,original){
  const p=STORED_PLAN_CONTINUATION.placement,root=path.join(directory,'reuse/test-results/stored-plan-placement');
  assert.equal(gitBytes(['rev-parse',`${context.sha}^`]).toString().trim(),p.source,'Placement receipt requires its exact source successor');
  const read=(file,hash)=>{const bytes=fs.readFileSync(path.join(root,file));assert.equal(sha256(bytes),hash,'Changed original placement incident evidence');return bytes;};
  const partial=JSON.parse(read('checkpoint.json',p.checkpoint));read('preflight.log',p.preflight);read('failed.log',p.failed);
  assert.equal(partial.sha,p.source);assert.equal(partial.status,'failed');assert.equal(partial.base,original.sha);assert.equal(partial.environment.key,context.environment.key);assert.equal(partial.planHash,context.planHash);
  assert.deepEqual(partial.storedPlanContinuation,{source:original.sha,checkpoint:STORED_PLAN_CONTINUATION.checkpoint});assert(!partial.storedPlanPlacement);
  assert.equal(partial.commands.length,context.commands.length);assert.equal(partial.commands[0].exitCode,0);assert.equal(partial.commands[0].logHash,p.preflight);assert.equal(partial.commands[2].exitCode,1);assert.equal(partial.commands[2].logHash,p.failed);
  assert.deepEqual({...partial.commands[0].command,env:{...partial.commands[0].command.env,STATIC_DEPLOY_HEAD_REF:context.sha}},context.commands[0]);
  const old=new Map(original.commands.map(row=>[storedPlanKey(row.command),row]));
  for(const[i,command]of context.commands.entries()){
    if(i===0||i===2)continue;const row=partial.commands[i];
    if(STORED_PLAN_REFRESH.has(command.name))assert.equal(row,null,'Unexpected fresh execution after the failed scanner');
    else assert.deepEqual(row,{...old.get(storedPlanKey(command)),command,log:`logs/${i}.log`,reusedFrom:original.sha},'Changed previously retained command');
  }
  return partial;
}
export const STORED_PLAN_WORKER_REFRESH=new Set([2,3,12,17,34,41,43,45]);
export const storedPlanFreshIndexes=profile=>profile===STORED_PLAN_CONTINUATION.native?new Set([...STORED_PLAN_WORKER_REFRESH,7,29,40]):STORED_PLAN_WORKER_REFRESH;
export function verifyStoredPlanWorkerProgress(directory,head){
  const p=STORED_PLAN_CONTINUATION.worker,root=path.join(directory,'reuse/test-results/stored-plan-worker-progress');
  assertStoredPlanTree(head);const bytes=fs.readFileSync(path.join(root,'checkpoint.json'));assert.equal(sha256(bytes),p.checkpoint);
  const partial=JSON.parse(bytes);assert.equal(partial.sha,p.source);assert.equal(partial.status,'failed');assert.equal(partial.commands.length,46);
  const expected=selectedCommands(partial.selection,{GITHUB_SHA:partial.sha,CANDIDATE_BASE:partial.base});assert.equal(expected.length,46);
  for(let i=0;i<46;i++){const row=partial.commands[i];if([43,45].includes(i)){assert.equal(row,null);continue;}assert.deepEqual(row.command,expected[i]);assert.equal(row.exitCode,i===41?1:0);assert.equal(sha256(fs.readFileSync(path.join(root,row.log))),row.logHash);}
  assert.equal(partial.commands[17].logHash,p.guard);assert.equal(partial.commands[41].logHash,p.failed);
  const {original}=verifyStoredPlanOrigin(directory,head);verifyStoredPlanPlacement(root,{...partial,commands:expected},original);
  verifyNativeLocalReports(root,fs.readFileSync(path.join(root,'logs/40.log'),'utf8'),{preflight:true});
  const reportBytes=fs.readFileSync(path.join(root,'test-results/worker-failed.json'));assert.equal(sha256(reportBytes),p.report);
  const report=JSON.parse(reportBytes);assert.deepEqual(report.errors,[]);assert.equal(report.config.workers,1);
  const rows=executedWorkers(report),passed=rows.filter(passedOnce),failed=rows.filter(row=>!passedOnce(row));
  assert.equal(rows.length,9);assert.equal(passed.length,8);assert.equal(report.stats.expected,8);assert.equal(report.stats.unexpected,1);assert.equal(report.stats.flaky,0);assert.equal(report.stats.skipped,0);
  assert.deepEqual(rows.map(row=>row.title).sort(),[...storedPlanWorkerNames].sort());
  assert.deepEqual(failed.map(row=>row.title),['Canvas stored planning settlement continuation-revalidation']);assert.equal(failed[0].results.length,1);assert.equal(failed[0].results[0].status,'failed');assert.equal(failed[0].results[0].retry,0);
  const retry=STORED_PLAN_CONTINUATION.workerRetry,retryRoot=path.join(directory,'reuse/test-results/stored-plan-worker-retry');
  if(fs.existsSync(path.join(retryRoot,'checkpoint.json'))){
    const nextBytes=fs.readFileSync(path.join(retryRoot,'checkpoint.json'));assert.equal(sha256(nextBytes),retry.checkpoint);
    const next=JSON.parse(nextBytes),commands=selectedCommands(next.selection,{GITHUB_SHA:next.sha,CANDIDATE_BASE:next.base});assert.equal(next.sha,retry.source);assert.equal(next.status,'failed');assert.equal(next.commands.length,46);assert.equal(commands.length,46);
    assert.deepEqual(next.storedPlanWorkerProgress,{source:p.source,checkpoint:p.checkpoint});assert.equal(next.environment.key,partial.environment.key);assert.equal(next.environment.image,partial.environment.image);assert.equal(next.nativeBrowsers.key,partial.nativeBrowsers.key);assert.equal(next.planHash,partial.planHash);
    for(let i=0;i<46;i++){const row=next.commands[i];if([43,45].includes(i)){assert.equal(row,null);continue;}assert.deepEqual(row.command,commands[i]);assert.equal(row.exitCode,i===41?1:0);assert.equal(sha256(fs.readFileSync(path.join(retryRoot,row.log))),row.logHash);if(!STORED_PLAN_WORKER_REFRESH.has(i))assert.deepEqual(row,{...partial.commands[i],command:commands[i],reusedFrom:p.source});}
    assert.equal(next.commands[17].logHash,retry.guard);assert.equal(next.commands[41].logHash,retry.failed);
    const resultBytes=fs.readFileSync(path.join(retryRoot,'test-results/worker-failed.json'));assert.equal(sha256(resultBytes),retry.report);
    const result=JSON.parse(resultBytes),rows=executedWorkers(result);assert.deepEqual(result.errors,[]);assert.equal(result.config.workers,1);assert.equal(result.stats.expected,0);assert.equal(result.stats.unexpected,1);assert.equal(result.stats.flaky,0);assert.equal(result.stats.skipped,0);
    assert.deepEqual(rows.map(row=>[row.file,row.title,row.id]),failed.map(row=>[row.file,row.title,row.id]));assert.equal(rows[0].results.length,1);assert.equal(rows[0].results[0].status,'failed');assert.equal(rows[0].results[0].retry,0);
    const progress={partial:next,passed,failed:rows,profile:retry};
    return fs.existsSync(path.join(directory,'reuse/test-results/stored-plan-native-progress/checkpoint.json'))?verifyStoredPlanNativeProgress(directory,head,progress):progress;
  }
  return {partial,passed,failed,profile:p};
}
export function verifyStoredPlanNativeProgress(directory,head,previous){
  const p=STORED_PLAN_CONTINUATION.native,root=path.join(directory,'reuse/test-results/stored-plan-native-progress');
  const pinned=(file,hash)=>{const bytes=fs.readFileSync(path.join(root,file));assert.equal(sha256(bytes),hash,'Changed native continuation evidence: '+file);return bytes;};
  const partial=JSON.parse(pinned('checkpoint.json',p.checkpoint));assert.equal(partial.sha,p.source);assert.equal(partial.status,'failed');assert.equal(partial.commands.length,46);
  const commands=selectedCommands(partial.selection,{GITHUB_SHA:partial.sha,CANDIDATE_BASE:partial.base});assert.equal(commands.length,46);
  assert.deepEqual(partial.storedPlanWorkerProgress,{source:previous.profile.source,checkpoint:previous.profile.checkpoint});assert.equal(partial.environment.key,previous.partial.environment.key);assert.equal(partial.environment.image,previous.partial.environment.image);assert.equal(partial.nativeBrowsers.key,previous.partial.nativeBrowsers.key);assert.equal(partial.planHash,previous.partial.planHash);
  for(let i=0;i<46;i++){const row=partial.commands[i];if([43,45].includes(i)){assert.equal(row,null);continue;}assert.deepEqual(row.command,commands[i]);assert.equal(row.exitCode,i===41?1:0);assert.equal(sha256(fs.readFileSync(path.join(root,row.log))),row.logHash);if(!STORED_PLAN_WORKER_REFRESH.has(i))assert.deepEqual(row,{...previous.partial.commands[i],command:commands[i],reusedFrom:previous.partial.sha});}
  assert.equal(partial.commands[41].logHash,p.failed);assert.equal(partial.commands[17].logHash,STORED_PLAN_CONTINUATION.workerRetry.guard);
  const report=JSON.parse(pinned('test-results/worker-completed.json',p.report)),completed=executedWorkers(report);assert.deepEqual(report.errors,[]);assert.equal(report.config.workers,1);assert.equal(report.stats.expected,1);assert.equal(report.stats.unexpected,0);assert.equal(report.stats.flaky,0);assert.equal(report.stats.skipped,0);assert(completed.every(passedOnce));assert.deepEqual(completed.map(row=>[row.file,row.title,row.id]),previous.failed.map(row=>[row.file,row.title,row.id]));
  const nativeLog=pinned('native.log',p.nativeLog).toString();assert(nativeLog.includes('/tmp/bitbi-release/q2-runtime-evidence/native-Braz4y'));
  const records=Object.fromEntries(Object.entries(p.proof).map(([file,hash])=>[file,JSON.parse(pinned('runtime/q2-runtime-evidence/native-Braz4y/'+file,hash))]));
  const launcher=records['launcher-result.json'];assert.equal(launcher.origin,LOCAL_POLICY);assert.equal(launcher.status,1);assert.equal(launcher.mode,'runtime');assert.equal(launcher.childBoundaryVerified,false);assert.equal(launcher.hostInterfacesUnchanged,true);assert.equal(launcher.hostRoutesUnchanged,true);assert.deepEqual(launcher.postcheckFailures,[]);assert.equal(launcher.hostedImage.GITHUB_SHA,p.source);
  for(const file of ['reports/isolation-result.json','reports/isolation-final.json'])assert.equal(records[file].passed,true);
  const result=records['reports/bitbi-q2-runtime-hkzCI4__result.json'];assert.equal(result.passed,2);assert.equal(result.failedSuites,1);assert.equal(result.reports.length,1);assert.equal(result.reports[0].suite,'canvas');
  assert.deepEqual(result.reports[0].records,canvasSettlementRecoveryRetainedInventory.map(name=>({name,status:'PASS'})));assert.deepEqual(result.reports[0].failure,{stage:canvasSettlementRecoveryInventory[0],name:'Error',message:'D1_ERROR: Expression tree is too large (maximum depth 100): SQLITE_ERROR'});
  return {...previous,partial,profile:p,completed,native:result.reports[0].records};
}
export const STORED_PLAN_GUARD_REFRESH=new Set([2,3,12,17,29,34,40,41,43,45]);
export function verifyStoredPlanGuard(directory,head,progress){
  const p=STORED_PLAN_CONTINUATION.guard,root=path.join(directory,'reuse/test-results/stored-plan-guard');assert.equal(gitBytes(['rev-parse',head+'^']).toString().trim(),p.source);assertStoredPlanTree(head);
  const bytes=fs.readFileSync(path.join(root,'checkpoint.json'));assert.equal(sha256(bytes),p.checkpoint);const partial=JSON.parse(bytes);assert.equal(partial.sha,p.source);assert.equal(partial.status,'failed');assert.equal(partial.commands.length,46);
  assert.deepEqual(partial.storedPlanWorkerProgress,{source:progress.profile.source,checkpoint:progress.profile.checkpoint});assert.equal(partial.environment.key,progress.partial.environment.key);assert.equal(partial.nativeBrowsers.key,progress.partial.nativeBrowsers.key);assert.equal(partial.planHash,progress.partial.planHash);
  const commands=selectedCommands(partial.selection,{GITHUB_SHA:partial.sha,CANDIDATE_BASE:partial.base});assert.equal(commands.length,46);
  for(let i=0;i<46;i++){const row=partial.commands[i];if([29,34,40,41,43,45].includes(i)){assert.equal(row,null);continue;}assert.deepEqual(row.command,commands[i]);assert.equal(row.exitCode,i===17?1:0);assert.equal(sha256(fs.readFileSync(path.join(root,row.log))),row.logHash);if(!storedPlanFreshIndexes(progress.profile).has(i))assert.deepEqual(row,{...progress.partial.commands[i],command:commands[i],reusedFrom:progress.partial.sha});}
  assert.equal(partial.commands[17].logHash,p.failed);return partial;
}
export function verifyStoredPlanOrigin(directory,head){
  assertStoredPlanTree(head);const origin=path.join(directory,'reuse/test-results/stored-plan-origin');
  const bytes=fs.readFileSync(path.join(origin,'evidence.json'));assert.equal(sha256(bytes),STORED_PLAN_CONTINUATION.checkpoint);
  const original=JSON.parse(bytes);verifyLocalEvidence(origin,{sha:original.sha,base:original.base});return {origin,original};
}
export function restoreStoredPlanProofs(directory,head,{browser=false,verifyOnly=false}={}){
  const {origin}=verifyStoredPlanOrigin(directory,head),read=file=>JSON.parse(fs.readFileSync(path.join(origin,file)));
  const original=read('candidate/manifest.json'),manifest=JSON.parse(fs.readFileSync(path.join(directory,'candidate/manifest.json')));
  assert.equal(manifest.sha,head);verifyMigrationCandidateBytes(directory,original,manifest,{allowLabGuard:false});assert.deepEqual(manifest.hosting,original.hosting);
  const old=read('candidate/proof-frontend-runtime.json'),proof={...old,manifestHash:sha256(JSON.stringify(manifest)),reusedFrom:{sha:original.sha,manifestHash:old.manifestHash}};
  if(verifyOnly)assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory,'candidate/proof-frontend-runtime.json'))),proof);
  else fs.writeFileSync(path.join(directory,'candidate/proof-frontend-runtime.json'),JSON.stringify(proof));
  if(browser){
    const current=browserRows(parseDiscovery(fs.readFileSync(path.join(directory,'test-results/stored-plan-auth-discovery.json'),'utf8')),{discovery:true});
    const oldReport=read('test-results/candidate-auth.json');assert.deepEqual(current,oldReport.discovery,'Current Auth discovery changed');
    const report={...oldReport,sha:head,retainedSource:original.sha};verifyModelBrowserReport(report,head);
    if(verifyOnly)assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory,'test-results/candidate-auth.json'))),report);
    else fs.writeFileSync(path.join(directory,'test-results/candidate-auth.json'),JSON.stringify(report));
  }
}
export const storedPlanWorkerNames=Object.freeze([
  ...['inert-music-normalization','inert-music-boundary','continuation','continuation-crash','continuation-authority','continuation-evidence','continuation-revalidation'].map(name=>'Canvas stored planning settlement '+name),
  'Canvas settled-plan continuation requires its own digest and verified runtime flags',
  'Canvas settled-plan retained AI source requires real Git ancestry and unchanged complete build inputs',
]);
export function verifyStoredPlanWorkerUnion(previous,discovery,fresh){
  const key=row=>row.file+':'+row.title,keys=rows=>rows.map(key).sort();
  for(const rows of [previous,discovery,fresh])assert.equal(new Set(keys(rows)).size,rows.length,'Duplicate continuation Worker identity');
  assert.equal(previous.length,1574);
  const old=new Set(keys(previous)),added=discovery.filter(row=>!old.has(key(row)));
  assert.deepEqual(discovery.filter(row=>old.has(key(row))).map(row=>[row.id,key(row)]).sort(),previous.map(row=>[row.id,key(row)]).sort(),'Retained Worker discovery changed');
  assert.deepEqual(added.map(row=>row.title).sort(),[...storedPlanWorkerNames].sort(),'Unreviewed/missing new Worker case');
  assert(added.every(row=>['q2-canvas-agent-settlement-review.spec.js','q2-canvas-settlement-operator.spec.js'].includes(row.file)));
  assert.deepEqual(keys(fresh),keys(added),'Only new Worker cases may execute');assert(fresh.every(passedOnce),'New Worker case failed/skipped/retried');
  for(const row of fresh)assert.equal(row.id,added.find(other=>key(other)===key(row)).id);
  return {retained:previous.length,executed:fresh.length,required:discovery.length};
}
export function verifyStoredPlanWorkers(directory,head,{pending=false}={}){
  const {origin}=verifyStoredPlanOrigin(directory,head);
  const previous=workerDiscovery(parseDiscovery(fs.readFileSync(path.join(origin,'test-results/settlement-worker-discovery.json'),'utf8')));
  const read=name=>parseDiscovery(fs.readFileSync(path.join(directory,'test-results',name),'utf8'));
  const full=read('stored-plan-worker-discovery.json'),selected=read('stored-plan-selected-discovery.json');assert.deepEqual(full.errors,[]);assert.deepEqual(selected.errors,[]);
  const discovery=workerDiscovery(full),chosen=workerDiscovery(selected);
  const progress=fs.existsSync(path.join(directory,'reuse/test-results/stored-plan-worker-progress/checkpoint.json'))?verifyStoredPlanWorkerProgress(directory,head):null;
  if(progress)assert.deepEqual(chosen.map(row=>[row.file,row.title,row.id]),progress.failed.map(row=>[row.file,row.title,row.id]));
  // The selection guard uses disposable synthetic outcomes only to validate the
  // exact query identities before any execution; these are never saved as passes.
  verifyStoredPlanWorkerUnion(previous,discovery,[...(progress?.passed||[]),...chosen.map(row=>({...row,results:[{status:'passed',retry:0}]}))]);
  if(pending)return {retained:previous.length,pending:progress?.native?0:chosen.length};
  if(progress?.native)assert.equal(sha256(fs.readFileSync(path.join(directory,'test-results/stored-plan-worker-corrected.json'))),progress.profile.report,'Retained Node report changed');
  const raw=read(progress?'stored-plan-worker-corrected.json':'stored-plan-worker-fresh.json');assert.deepEqual(raw.errors,[]);assert.equal(raw.config.workers,1);assert.equal(raw.stats.unexpected,0);assert.equal(raw.stats.flaky,0);assert.equal(raw.stats.skipped,0);
  const fresh=executedWorkers(raw);if(progress)assert.deepEqual(fresh.map(row=>[row.file,row.title,row.id]),progress.failed.map(row=>[row.file,row.title,row.id]));
  const counts=verifyStoredPlanWorkerUnion(previous,discovery,[...(progress?.passed||[]),...fresh]);assert.equal(raw.stats.expected,fresh.length);return {...counts,...(progress?.native?{retainedNew:9,executedNow:0}:progress?{retainedNew:8,executedNow:1}:{})};
}
export function verifyStoredPlanNative(previous,result,retained=[]){
  assert.equal(previous.failedSuites,0);assert.equal(previous.passed,385);assert.equal(result.failedSuites,0);assert.equal(result.reports.length,1);
  const expected=retained.length?canvasSettlementRecoveryInventory:canvasSettlementContinuationInventory;if(retained.length)assert.deepEqual(retained,canvasSettlementRecoveryRetainedInventory.map(name=>({name,status:'PASS'})));
  const fresh=result.reports[0];assert.equal(fresh.suite,'canvas');assert(!fresh.failure);assert.deepEqual(fresh.records,expected.map(name=>({name,status:'PASS'})));assert.equal(result.passed,fresh.records.length);
  const metrics=fresh.metrics.filter(row=>row.settlementContinuation);assert.equal(metrics.length,1);
  const old=previous.reports.find(row=>row.suite==='canvas').records.map(row=>row.name),actual=metrics[0].settlementContinuation;
  assert.deepEqual(actual.retained,old);assert.deepEqual(actual.fresh,expected);if(retained.length){assert.deepEqual(actual.inventory,canvasSettlementContinuationInventory);assert.deepEqual(actual.retainedContinuation,retained.map(row=>row.name));}assert.equal(new Set(actual.discovery).size,actual.discovery.length);
  assert.deepEqual(actual.discovery.filter(name=>!canvasSettlementContinuationInventory.includes(name)),old);assert.deepEqual(actual.discovery.filter(name=>canvasSettlementContinuationInventory.includes(name)),canvasSettlementContinuationInventory);
  return {retained:385+retained.length,executed:fresh.records.length,required:385+retained.length+fresh.records.length};
}
export function storedPlanWorkerCommand(command,progress=false,native=false){
  assert(command.endsWith('else\n  npm run test:workers\nfi\n'));assert.equal(command.split('  npm run test:workers').length,2);
  const names=progress?['Canvas stored planning settlement continuation-revalidation']:storedPlanWorkerNames,file=progress?'stored-plan-worker-corrected.json':'stored-plan-worker-fresh.json';
  const pattern='(?:'+names.map(name=>name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')$';
  const args='npx playwright test -c playwright.workers.config.js tests/q2-canvas-agent-settlement-review.spec.js tests/q2-canvas-settlement-operator.spec.js --grep '+JSON.stringify(pattern)+' --workers=1 --retries=0 --output=test-results/stored-plan-worker-artifacts';
  const nativeFile=native?'stored-plan-native-recovery.log':'stored-plan-native.log',suite=native?'canvas-settlement-recovery':'canvas-settlement-continuation';
  return command.replace('  npm run test:workers',()=>[
    'mkdir -p test-results',
    'PLAYWRIGHT_JSON_OUTPUT_NAME= npx playwright test -c playwright.workers.config.js --list --reporter=json > test-results/stored-plan-worker-discovery.json',
    'PLAYWRIGHT_JSON_OUTPUT_NAME= '+args+' --list --reporter=json > test-results/stored-plan-selected-discovery.json',
    'node scripts/local-release.mjs verify-stored-plan-workers .local-release pending',
    ...(native?[]:['if [ ! -f test-results/'+file+' ]; then PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/'+file+' '+args+' --reporter=list,json; fi']),
    'node scripts/local-release.mjs verify-stored-plan-workers .local-release',
    'if [ ! -f test-results/'+nativeFile+' ]; then node scripts/test-q2-runtime.mjs --suite '+suite+' > test-results/'+nativeFile+' 2>&1 || { status=$?; cat test-results/'+nativeFile+'; exit "$status"; }; fi',
    'node scripts/local-release.mjs verify-stored-plan-native .local-release',
    'cat test-results/'+nativeFile,
    'PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/stored-plan-auth-discovery.json npm run test:auth -- --list --reporter=json',
  ].map(line=>'  '+line).join('\n'));
}
export function storedPlanCommand(command,{progress=false,native=false}={}){
  if(command.name==='Test local release evidence and orchestration'){assert.equal(command.run,'npm run test:local-release');return command.run+(progress?' -- --stored-plan-worker-only':' -- --stored-plan-only');}
  if(command.name==='Run worker route tests')return storedPlanWorkerCommand(command.run,progress,native);
  return command.run;
}
export function verifyStoredPlanContinuation(directory,evidence,commands){
  const p=STORED_PLAN_CONTINUATION;assert.deepEqual(evidence.storedPlanContinuation,{source:p.source,checkpoint:p.checkpoint});
  const {origin,original}=verifyStoredPlanOrigin(directory,evidence.sha);
  storedPlanPrefix(fs.readFileSync(path.join(origin,'evidence.json')),{...evidence,commands});
  const progress=evidence.storedPlanWorkerProgress?verifyStoredPlanWorkerProgress(directory,evidence.sha):null;
  if(progress)assert.deepEqual(evidence.storedPlanWorkerProgress,{source:progress.profile.source,checkpoint:progress.profile.checkpoint});
  const guard=evidence.storedPlanGuard?verifyStoredPlanGuard(directory,evidence.sha,progress):null;if(guard)assert.deepEqual(evidence.storedPlanGuard,{source:STORED_PLAN_CONTINUATION.guard.source,checkpoint:STORED_PLAN_CONTINUATION.guard.checkpoint});
  const placement=evidence.storedPlanPlacement?verifyStoredPlanPlacement(directory,{...evidence,commands},original):null;
  if(placement)assert.deepEqual(evidence.storedPlanPlacement,{source:STORED_PLAN_CONTINUATION.placement.source,checkpoint:STORED_PLAN_CONTINUATION.placement.checkpoint});
  const old=new Map(original.commands.map(row=>[storedPlanKey(row.command),row]));
  for(const[i,command]of commands.entries()){
    const row=evidence.commands[i],before=old.get(storedPlanKey(command));
    if(guard&&!STORED_PLAN_GUARD_REFRESH.has(i))assert.deepEqual(row,{...guard.commands[i],command,reusedFrom:guard.sha},'Changed shell-verifier retained command');
    else if(!guard&&progress&&!storedPlanFreshIndexes(progress.profile).has(i))assert.deepEqual(row,{...progress.partial.commands[i],command,reusedFrom:progress.partial.sha},'Changed retained preflight/Worker-prefix receipt');
    else if(placement&&i===0)assert.deepEqual(row,{...placement.commands[0],command,reusedFrom:placement.sha},'Changed passed preflight receipt');
    else if(STORED_PLAN_REFRESH.has(command.name)){assert(!row.reusedFrom);const effective=storedPlanCommand(command,{progress:!!progress,native:!!progress?.native});if(effective!==command.run)assert.equal(row.continuation,effective);else assert(!row.continuation);}
    else assert.deepEqual(row,{...before,command,log:`logs/${i}.log`,reusedFrom:p.source},'Changed retained command receipt');
  }
  restoreStoredPlanProofs(directory,evidence.sha,{browser:true,verifyOnly:true});verifyStoredPlanWorkers(directory,evidence.sha);
  const worker=commands.findIndex(row=>row.name==='Run worker route tests'),log=fs.readFileSync(path.join(directory,evidence.commands[worker].log),'utf8');
  verifyStoredPlanNativeReceipt(directory,evidence.sha,log);
}
export function verifyStoredPlanNativeReceipt(directory,head,log){
  const {origin}=verifyStoredPlanOrigin(directory,head);
  const native=JSON.parse(fs.readFileSync(path.join(origin,'runtime/q2-runtime-evidence/native-Dvjqr1/reports/bitbi-q2-runtime-gLE6HW__result.json')));
  verifyNativeLocalReports(directory,log);
  const refs=log.split('\n').flatMap(line=>{try{const r=JSON.parse(line);return r.q2LinuxEvidence?[r.q2LinuxEvidence]:[];}catch{return [];}});assert.equal(refs.length,1,'Fresh native scope must execute once');
  const reports=path.join(directory,'runtime',refs[0].slice('/tmp/bitbi-release/'.length),'reports'),files=fs.readdirSync(reports).filter(file=>file==='result.json'||file.endsWith('__result.json'));assert.equal(files.length,1);
  const progress=fs.existsSync(path.join(directory,'reuse/test-results/stored-plan-native-progress/checkpoint.json'))?verifyStoredPlanWorkerProgress(directory,head):null,result=JSON.parse(fs.readFileSync(path.join(reports,files[0])));
  if(progress){const launcher=JSON.parse(fs.readFileSync(path.join(reports,'../launcher-result.json')));assert.equal(launcher.hostedImage.GITHUB_SHA,head);assert.equal(result.provenance.sourceLedger.find(row=>row.path==='workers/auth/src/lib/canvas-agent-settlement-review.js')?.sha256,progress.profile.specs['workers/auth/src/lib/canvas-agent-settlement-review.js']);}
  return verifyStoredPlanNative(native,result,progress?.native||[]);
}

// A successful published source may retain unchanged acceptance only through
// this exact reviewed successor. This is not a general cross-source cache.
export const READINESS_REFRESH=new Set([
  'Preflight complete static release plan','Run quality gate tests','Check committed secrets',
  'Check operational readiness docs','Check targeted JavaScript syntax','Run CI test selection fixtures','Test local release evidence and orchestration',
  'Check documentation currentness','Record candidate build','Validate static website references','Validate JS import paths',
  'Check target="_blank" links have rel="noopener"','Validate page metadata',
  'Verify native Linux isolation before Worker tests','Run worker route tests',
  'Restore exact candidate static site','Confirm tested browser candidate bytes',
]);
export const readinessWorkerNames=Object.freeze([
  ...['accepted-pending','accepted-saved','retry-recover','retry-exhausted','disabled','model-disabled','revoked','expired','edited','unknown'].map(name=>'Canvas readiness recovery '+name),
  'Canvas readiness diagnostics distinguish configuration, authentication, protocol and temporary observation failures',
  ...['operator','stale-control','cancelled','expired','edited'].map(name=>'Canvas H3 settled late receipt readiness-'+name),
]);
export const readinessLauncherName='Canvas readiness recovery pins retained discovery and admits only fresh native callbacks';
export function readinessPrefix(bytes,{sha,base,planHash,environment,nativeBrowsers,commands,selection},read=gitBytes){
  const p=READINESS_CONTINUATION;assertReadinessTree(sha,read);assert.equal(sha256(bytes),p.checkpoint,'Changed completed readiness source proof');
  const original=JSON.parse(bytes);assert.equal(original.sha,p.source);assert.equal(original.status,'passed');assert.equal(base,p.source,'Readiness release must use the currently published base');
  assert.equal(original.planHash,planHash);assert.equal(original.environment.key,environment.key);assert.equal(original.environment.image,environment.image);assert.deepEqual(original.environment.inputs,environment.inputs);assert.equal(original.nativeBrowsers.key,nativeBrowsers?.key);verifyNativeBrowserEnvironment(nativeBrowsers);
  assert.equal(original.commands.length,52);assert(original.commands.every(row=>row.exitCode===0));
  assert.equal(selection.full,false);assert.equal(selection.workers,true);assert.equal(selection.auth,true);assert.equal(selection.homepage,false);assert.equal(commands.length,46,'Changed scoped readiness command closure');
  const prior=new Map(original.commands.map(row=>[storedPlanKey(row.command),row]));
  for(const command of commands){assert(prior.has(storedPlanKey(command)),'New command needs explicit readiness evidence');if(!READINESS_REFRESH.has(command.name))assert.deepEqual(command,prior.get(storedPlanKey(command)).command,'Changed retained command');}
  return original;
}
export function verifyReadinessOrigin(directory,head){
  assertReadinessTree(head);const origin=path.join(directory,'reuse/test-results/readiness-origin'),bytes=fs.readFileSync(path.join(origin,'evidence.json'));
  assert.equal(sha256(bytes),READINESS_CONTINUATION.checkpoint);const original=JSON.parse(bytes);
  verifyLocalEvidence(origin,{sha:original.sha,base:original.base});return {origin,original};
}
export const READINESS_PROGRESS_RETAIN=Object.freeze([7,16]);
export function verifyReadinessProgress(directory,head,commands){
  const p=READINESS_CONTINUATION.progress,root=path.join(directory,'reuse/test-results/readiness-progress');assertReadinessTree(head);
  assert([p.fixedTest,READINESS_CONTINUATION.worker.fixedTest].includes(sha256(gitBytes(['show',`${head}:scripts/test-local-release.mjs`]))),'Changed reviewed retry countercontrol');
  const pinned=(file,hash)=>{const bytes=fs.readFileSync(path.join(root,file));assert.equal(sha256(bytes),hash,'Changed original readiness progress evidence: '+file);return bytes;};
  const partial=JSON.parse(pinned('checkpoint.json',p.checkpoint));assert.equal(partial.sha,p.source);assert.equal(partial.sourceTree,p.tree);assert.equal(partial.base,READINESS_CONTINUATION.source);assert.equal(partial.status,'failed');assert.equal(partial.commands.length,46);
  assert.deepEqual(partial.readinessContinuation,{source:READINESS_CONTINUATION.source,checkpoint:READINESS_CONTINUATION.checkpoint});assert(!partial.readinessProgress);
  assert.equal(partial.planHash,validationPlan().digest);assert.deepEqual(partial.selection.files,gitSelection(READINESS_CONTINUATION.source,head).files);
  for(const[file,hash]of Object.entries(p.tools))pinned('source/'+file,hash);
  const original=JSON.parse(fs.readFileSync(path.join(directory,'reuse/test-results/readiness-origin/evidence.json')));assert.equal(partial.environment.key,original.environment.key);assert.equal(partial.nativeBrowsers.key,original.nativeBrowsers.key);
  assert(partial.commands.slice(0,17).every(row=>row?.exitCode===0));assert.equal(partial.commands[17].exitCode,1);assert.equal(partial.commands[17].logHash,p.failed);pinned('logs/17.log',p.failed);
  assert.equal(partial.commands[17].continuation,'npm run test:local-release -- --readiness-only');
  for(const i of READINESS_PROGRESS_RETAIN){const row=partial.commands[i];assert.equal(row.exitCode,0);assert(!row.reusedFrom);assert.deepEqual(row.command,commands[i]);pinned(row.log,row.logHash);}
  assert.equal(partial.commands[7].command.name,'Check operational readiness docs');assert.equal(partial.commands[16].continuation,'npm run test:ci-selection -- --canvas-readiness-only');
  return partial;
}
export const READINESS_WORKER_RETAIN=Object.freeze([7,16,29,35,37,38,39,40]);
export function verifyReadinessStaleFixture(before,after){
  const start="    if(name==='readiness-stale-control'){",end="    if(name==='readiness-cancelled')";
  const split=value=>{assert.equal(value.split(start).length,2);assert.equal(value.split(end).length,2);const a=value.indexOf(start),b=value.indexOf(end);assert(b>a);return [value.slice(0,a),value.slice(a,b),value.slice(b)];};
  const a=split(before),b=split(after);assert.equal(a[0],b[0]);assert.equal(a[2],b[2],'An already passed helper branch changed');assert(a[1].includes('SET budget_revision=budget_revision+1'));assert(b[1].includes('SET updated_at=?')&&!b[1].includes('SET budget_revision='));
}
export function verifyReadinessWorkerProgress(directory,head){
  const p=READINESS_CONTINUATION.worker,root=path.join(directory,'reuse/test-results/readiness-worker-progress');assertReadinessTree(head);
  assert.equal(sha256(gitBytes(['show',`${head}:scripts/test-local-release.mjs`])),p.fixedTest,'Changed reviewed readiness Worker verifier');
  const pinned=(file,hash)=>{const bytes=fs.readFileSync(path.join(root,file));assert.equal(sha256(bytes),hash,'Changed readiness Worker progress evidence: '+file);return bytes;};
  const partial=JSON.parse(pinned('checkpoint.json',p.checkpoint));assert.equal(partial.sha,p.source);assert.equal(partial.sourceTree,p.tree);assert.equal(partial.base,READINESS_CONTINUATION.source);assert.equal(partial.status,'failed');assert.equal(partial.commands.length,46);
  assert.deepEqual(partial.readinessContinuation,{source:READINESS_CONTINUATION.source,checkpoint:READINESS_CONTINUATION.checkpoint});assert.deepEqual(partial.readinessProgress,{source:READINESS_CONTINUATION.progress.source,checkpoint:READINESS_CONTINUATION.progress.checkpoint});assert(!partial.readinessWorkerProgress);
  const commands=selectedCommands(partial.selection,{GITHUB_SHA:p.source,CANDIDATE_BASE:partial.base}),current=selectedCommands(gitSelection(partial.base,head),{GITHUB_SHA:head,CANDIDATE_BASE:partial.base});
  verifyReadinessProgress(directory,head,current);assert.equal(partial.planHash,validationPlan().digest);assert.deepEqual(partial.selection.files,gitSelection(partial.base,head).files);
  const original=JSON.parse(fs.readFileSync(path.join(directory,'reuse/test-results/readiness-origin/evidence.json')));assert.equal(partial.environment.key,original.environment.key);assert.equal(partial.nativeBrowsers.key,original.nativeBrowsers.key);
  for(const[file,hash]of Object.entries(p.tools))pinned('source/'+file,hash);
  const helper='tests/helpers/canvas-agent-h3-recovery-control.mjs',before=fs.readFileSync(path.join(root,'source',helper),'utf8'),after=gitBytes(['show',`${head}:${helper}`]).toString();
  verifyReadinessStaleFixture(before,after);
  assert(partial.commands.slice(0,41).every(row=>row?.exitCode===0));assert.equal(partial.commands[41].exitCode,1);assert.equal(partial.commands[41].logHash,p.failed);pinned('logs/41.log',p.failed);pinned('logs/17.log',partial.commands[17].logHash);
  assert.equal(partial.commands[17].continuation,'npm run test:local-release -- --readiness-only');assert.equal(partial.commands[41].continuation,readinessWorkerCommand(commands[41].run));
  for(const i of READINESS_WORKER_RETAIN){const row=partial.commands[i];assert.deepEqual(row.command,commands[i]);assert.deepEqual(row.command,current[i]);pinned(row.log,row.logHash);}
  verifyNativeLocalReports(directory,fs.readFileSync(path.join(root,'logs/40.log'),'utf8'),{preflight:true});
  const raw=parseDiscovery(pinned('worker-failed.json',p.report).toString()),full=parseDiscovery(pinned('worker-discovery.json',p.discovery).toString()),selected=parseDiscovery(pinned('selected-discovery.json',p.selected).toString());
  assert.deepEqual(raw.errors,[]);assert.deepEqual(full.errors,[]);assert.deepEqual(selected.errors,[]);assert.equal(raw.config.workers,1);assert.equal(raw.stats.expected,15);assert.equal(raw.stats.unexpected,1);assert.equal(raw.stats.flaky,0);assert.equal(raw.stats.skipped,0);
  const rows=executedWorkers(raw),passed=rows.filter(passedOnce),failed=rows.filter(row=>!passedOnce(row));assert.equal(passed.length,15);assert.equal(failed.length,1);assert.equal(failed[0].title,'Canvas H3 settled late receipt readiness-stale-control');assert.equal(failed[0].results.length,1);assert.equal(failed[0].results[0].status,'failed');assert.equal(failed[0].results[0].retry,0);assert(JSON.stringify(raw).includes('canvas_agent_budget_consent_required'));
  const ids=values=>values.map(({id,file,title})=>({id,file,title})).sort((a,b)=>a.id.localeCompare(b.id));assert.deepEqual(ids(rows),ids(workerDiscovery(selected)));
  const previous=workerDiscovery(parseDiscovery(fs.readFileSync(path.join(directory,'reuse/test-results/readiness-origin/test-results/assistant-native-rate-discovery.json'),'utf8')));
  verifyReadinessWorkerUnion(previous,workerDiscovery(full),rows.map(row=>({...row,results:[{status:'passed',retry:0}]})));
  return {partial,passed,failed,discovery:workerDiscovery(full)};
}
export function restoreReadinessProofs(directory,head,{browser=false,verifyOnly=false}={}){
  const {origin}=verifyReadinessOrigin(directory,head),read=file=>JSON.parse(fs.readFileSync(path.join(origin,file)));
  const original=read('candidate/manifest.json'),manifest=JSON.parse(fs.readFileSync(path.join(directory,'candidate/manifest.json')));
  assert.equal(manifest.sha,head);verifyMigrationCandidateBytes(directory,original,manifest,{allowLabGuard:false});assert.deepEqual(manifest.hosting,original.hosting);
  const old=read('candidate/proof-frontend-runtime.json'),proof={...old,manifestHash:sha256(JSON.stringify(manifest)),reusedFrom:{sha:original.sha,manifestHash:old.manifestHash}};
  if(verifyOnly)assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory,'candidate/proof-frontend-runtime.json'))),proof);
  else fs.writeFileSync(path.join(directory,'candidate/proof-frontend-runtime.json'),JSON.stringify(proof));
  if(browser){
    const current=browserRows(parseDiscovery(fs.readFileSync(path.join(directory,'test-results/readiness-auth-discovery.json'),'utf8')),{discovery:true});
    const previous=read('test-results/candidate-auth.json');assert.deepEqual(current,previous.discovery,'Current Auth discovery changed');
    const report={...previous,sha:head,retainedSource:original.sha};verifyModelBrowserReport(report,head);
    if(verifyOnly)assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory,'test-results/candidate-auth.json'))),report);
    else fs.writeFileSync(path.join(directory,'test-results/candidate-auth.json'),JSON.stringify(report));
  }
}
export function verifyReadinessWorkerUnion(previous,discovery,fresh){
  const key=row=>row.file+':'+row.title,keys=rows=>rows.map(key).sort();
  for(const rows of [previous,discovery,fresh])assert.equal(new Set(keys(rows)).size,rows.length,'Duplicate readiness Worker identity');
  assert.equal(previous.length,1630);assert(readinessWorkerNames.length>0,'Missing readiness Worker inventory');
  const old=new Set(keys(previous)),added=discovery.filter(row=>!old.has(key(row)));
  assert.deepEqual(discovery.filter(row=>old.has(key(row))).map(row=>[row.id,key(row)]).sort(),previous.map(row=>[row.id,key(row)]).sort(),'Retained Worker discovery changed');
  assert.deepEqual(added.map(row=>row.title).sort(),[...readinessWorkerNames].sort(),'Unreviewed or missing new Worker case');
  assert(added.every(row=>['q2-canvas-agent-readiness.spec.js','q2-canvas-agent-h3-recovery.spec.js'].includes(row.file)));
  assert.deepEqual(keys(fresh),keys(added),'Only the new readiness Worker cases may execute');assert(fresh.every(passedOnce),'New readiness case failed, skipped or retried');
  for(const row of fresh)assert.equal(row.id,added.find(other=>key(other)===key(row)).id);
  return {retained:previous.length,executed:fresh.length,required:discovery.length};
}
export function verifyReadinessWorkers(directory,head,{pending=false}={}){
  const {origin}=verifyReadinessOrigin(directory,head),read=name=>parseDiscovery(fs.readFileSync(path.join(directory,'test-results',name),'utf8'));
  const previous=workerDiscovery(parseDiscovery(fs.readFileSync(path.join(origin,'test-results/assistant-native-rate-discovery.json'),'utf8')));
  const full=read('readiness-worker-discovery.json'),selected=read('readiness-selected-discovery.json');assert.deepEqual(full.errors,[]);assert.deepEqual(selected.errors,[]);
  const discovery=workerDiscovery(full),chosen=workerDiscovery(selected);
  const progress=fs.existsSync(path.join(directory,'reuse/test-results/readiness-worker-progress/checkpoint.json'))?verifyReadinessWorkerProgress(directory,head):null;
  if(progress)assert.deepEqual(chosen.map(row=>[row.id,row.file,row.title]),progress.failed.map(row=>[row.id,row.file,row.title]),'Only the original failed readiness identity may execute');
  // Validate the real query before dispatch. These disposable outcomes are
  // selection counterchecks only and are never recorded as acceptance.
  verifyReadinessWorkerUnion(previous,discovery,[...(progress?.passed||[]),...chosen.map(row=>({...row,results:[{status:'passed',retry:0}]}))]);
  if(pending)return {retained:previous.length+(progress?.passed.length||0),pending:chosen.length};
  const raw=read(progress?'readiness-worker-corrected.json':'readiness-worker-fresh.json');assert.deepEqual(raw.errors,[]);assert.equal(raw.config.workers,1);assert.equal(raw.stats.unexpected,0);assert.equal(raw.stats.flaky,0);assert.equal(raw.stats.skipped,0);
  const fresh=executedWorkers(raw);assert.equal(raw.stats.expected,fresh.length);
  if(progress)assert.deepEqual(fresh.map(row=>[row.id,row.file,row.title]),progress.failed.map(row=>[row.id,row.file,row.title]));
  const counts=verifyReadinessWorkerUnion(previous,discovery,[...(progress?.passed||[]),...fresh]);
  return progress?{retained:counts.retained+progress.passed.length,executed:fresh.length,required:counts.required}:counts;
}
export function verifyReadinessNativeUnion(previous,result,inventory){
  assert.equal(previous.length,251);assert.equal(sha256(JSON.stringify(previous)),'3bcde3da85495a7cfa8190ca3ad20f8f255c7b065941f88cfbf5d1c75cd3640f');
  assert(inventory.length>0);assert.equal(result.failedSuites,0);assert.equal(result.reports.length,1);assert.equal(result.passed,inventory.length);
  const report=result.reports[0];assert.equal(report.suite,'canvas');assert(!report.failure);assert.deepEqual(report.records,inventory.map(name=>({name,status:'PASS'})));
  const metrics=report.metrics.filter(row=>row.readinessRecovery);assert.equal(metrics.length,1);const actual=metrics[0].readinessRecovery;
  assert.deepEqual(actual.retained,previous);assert.deepEqual(actual.fresh,inventory);assert.equal(new Set(actual.discovery).size,actual.discovery.length);
  assert.deepEqual(actual.discovery.filter(name=>!inventory.includes(name)),previous);assert.deepEqual(actual.discovery.filter(name=>inventory.includes(name)),inventory);
  return {retained:434,executed:inventory.length,required:434+inventory.length};
}
export function verifyReadinessNativeReceipt(directory,head,log){
  const {origin}=verifyReadinessOrigin(directory,head);
  const previous=JSON.parse(fs.readFileSync(path.join(origin,'runtime/q2-runtime-evidence/native-ILK5Yo/reports/bitbi-q2-runtime-ZXIurt__result.json'))).reports[0].metrics.find(row=>row.assistantRateTail).assistantRateTail.discovery;
  verifyNativeLocalReports(directory,log);
  const refs=log.split('\n').flatMap(line=>{try{const row=JSON.parse(line);return row.q2LinuxEvidence?[row.q2LinuxEvidence]:[];}catch{return [];}});assert.equal(refs.length,1,'Readiness native scope must execute once');
  const folder=path.join(directory,'runtime',refs[0].slice('/tmp/bitbi-release/'.length)),launcher=JSON.parse(fs.readFileSync(path.join(folder,'launcher-result.json')));assert.equal(launcher.hostedImage.GITHUB_SHA,head);
  const reports=path.join(folder,'reports'),files=fs.readdirSync(reports).filter(file=>file==='result.json'||file.endsWith('__result.json'));assert.equal(files.length,1);
  const result=JSON.parse(fs.readFileSync(path.join(reports,files[0])));
  for(const[file,hash]of Object.entries(READINESS_CONTINUATION.specs).filter(([file])=>file.startsWith('workers/auth/src/')))assert.equal(result.provenance.sourceLedger.find(row=>row.path===file)?.sha256,hash,'Native readiness runtime source changed');
  return verifyReadinessNativeUnion(previous,result,canvasReadinessRecoveryInventory);
}
export function readinessWorkerCommand(command,{progress=false}={}){
  assert(command.endsWith('else\n  npm run test:workers\nfi\n'));assert.equal(command.split('  npm run test:workers').length,2);
  const names=progress?['Canvas H3 settled late receipt readiness-stale-control']:readinessWorkerNames,file=progress?'readiness-worker-corrected.json':'readiness-worker-fresh.json';
  const pattern='(?:'+names.map(name=>name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')$';
  const args='npx playwright test -c playwright.workers.config.js tests/q2-canvas-agent-readiness.spec.js tests/q2-canvas-agent-h3-recovery.spec.js --grep '+JSON.stringify(pattern)+' --workers=1 --retries=0 --output=test-results/readiness-worker-artifacts';
  return command.replace('  npm run test:workers',()=>[
    'mkdir -p test-results',
    'PLAYWRIGHT_JSON_OUTPUT_NAME= npx playwright test -c playwright.workers.config.js --list --reporter=json > test-results/readiness-worker-discovery.json',
    'PLAYWRIGHT_JSON_OUTPUT_NAME= '+args+' --list --reporter=json > test-results/readiness-selected-discovery.json',
    'node scripts/local-release.mjs verify-readiness-workers .local-release pending',
    'if [ ! -f test-results/'+file+' ]; then PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/'+file+' '+args+' --reporter=list,json; fi',
    'node scripts/local-release.mjs verify-readiness-workers .local-release',
    'if [ ! -f test-results/readiness-launcher.tap ]; then node --test --test-name-pattern='+JSON.stringify('^'+readinessLauncherName+'$')+' scripts/test-q2-runtime-launcher.mjs > test-results/readiness-launcher.tap 2>&1 || { status=$?; cat test-results/readiness-launcher.tap; exit "$status"; }; fi',
    'cat test-results/readiness-launcher.tap',
    'if [ ! -f test-results/readiness-native.log ]; then node scripts/test-q2-runtime.mjs --suite canvas-readiness-recovery > test-results/readiness-native.log 2>&1 || { status=$?; cat test-results/readiness-native.log; exit "$status"; }; fi',
    'node scripts/local-release.mjs verify-readiness-native .local-release',
    'cat test-results/readiness-native.log',
    'PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/readiness-auth-discovery.json npm run test:auth -- --list --reporter=json',
  ].map(line=>'  '+line).join('\n'));
}
export function readinessCommand(command,{workerProgress=false}={}){
  if(command.name==='Run CI test selection fixtures'){assert.equal(command.run,'npm run test:ci-selection');return command.run+' -- --canvas-readiness-only';}
  if(command.name==='Test local release evidence and orchestration'){assert.equal(command.run,'npm run test:local-release');return command.run+(workerProgress?' -- --readiness-worker-only':' -- --readiness-only');}
  if(command.name==='Run worker route tests')return readinessWorkerCommand(command.run,{progress:workerProgress});
  return command.run;
}
export function verifyReadinessContinuation(directory,evidence,commands){
  const p=READINESS_CONTINUATION;assert.deepEqual(evidence.readinessContinuation,{source:p.source,checkpoint:p.checkpoint});
  const {origin,original}=verifyReadinessOrigin(directory,evidence.sha);readinessPrefix(fs.readFileSync(path.join(origin,'evidence.json')),{...evidence,commands});
  const progress=evidence.readinessProgress?verifyReadinessProgress(directory,evidence.sha,commands):null;
  if(progress)assert.deepEqual(evidence.readinessProgress,{source:progress.sha,checkpoint:READINESS_CONTINUATION.progress.checkpoint});
  const workerProgress=evidence.readinessWorkerProgress?verifyReadinessWorkerProgress(directory,evidence.sha):null;
  if(workerProgress)assert.deepEqual(evidence.readinessWorkerProgress,{source:workerProgress.partial.sha,checkpoint:READINESS_CONTINUATION.worker.checkpoint});
  const old=new Map(original.commands.map(row=>[storedPlanKey(row.command),row]));
  for(const[i,command]of commands.entries()){
    const row=evidence.commands[i];
    if(workerProgress&&READINESS_WORKER_RETAIN.includes(i))assert.deepEqual(row,{...workerProgress.partial.commands[i],command,reusedFrom:workerProgress.partial.sha},'Changed retained readiness Worker prefix');
    else if(progress&&READINESS_PROGRESS_RETAIN.includes(i))assert.deepEqual(row,{...progress.commands[i],command,reusedFrom:progress.sha},'Changed retained passed readiness check');
    else if(READINESS_REFRESH.has(command.name)){assert(!row.reusedFrom);const effective=readinessCommand(command,{workerProgress:!!workerProgress});if(effective!==command.run)assert.equal(row.continuation,effective);else assert(!row.continuation);}
    else assert.deepEqual(row,{...old.get(storedPlanKey(command)),command,log:`logs/${i}.log`,reusedFrom:p.source},'Changed retained readiness evidence');
  }
  restoreReadinessProofs(directory,evidence.sha,{browser:true,verifyOnly:true});verifyReadinessWorkers(directory,evidence.sha);
  const unit=fs.readFileSync(path.join(directory,'test-results/readiness-launcher.tap'),'utf8'),rows=tapResults(unit);assert.deepEqual(rows.filter(row=>row.status!=='skipped'),[{title:readinessLauncherName,status:'passed'}]);assert.match(unit,/# pass 1\n# fail 0\n# cancelled 0\n# skipped \d+\n# todo 0/);
  const worker=commands.findIndex(row=>row.name==='Run worker route tests'),log=fs.readFileSync(path.join(directory,evidence.commands[worker].log),'utf8');
  // Synchronous import verification must not leave a floating async check.
  verifyReadinessNativeReceipt(directory,evidence.sha,log);
}

// Closed fixture correction. No product, schema, provider, command or discovery
// changes are accepted. MockD1's newly recognized private-media query is reached
// by the five failed Memvid dispatch fixtures; the two passing dispatch guards
// exit before that query. Real private-media tests retain their SQLite caller.
export const RELIABILITY_WORKER_PREFLIGHT=Object.freeze({
  source:'d6f7cd48c8da12bea29183f64879680c9c2d1cc3',
  fixtureSource:'486c4e7ba74057e617d306798cbb4874576fbf01',
  checkpoint:'c65d6436e84d2c12600a85b5691e18a8c27185de3c956af7a8a3a1c72943d875',
  failedLog:'b7c1cda0e6d39d49ed19a91c3157c51ee0d53bab351b569d1d03ab8b00428e67',
  lastRun:'0ea3cbd2a164156f081dd97b8c6726de314dfbc526141f6fa68c1b933fba2b0e',
  discovery:'3aa8c85406ab74ee7596ed9e1120f45f1e479c28e816e829834554ec3a498409',
  specs:Object.freeze({
    'tests/helpers/auth-worker-harness.js':'b3fb051cb6cfef7b53a84537d27f9c46d295668fa06536cd6539bbdb03b818fc',
    'tests/helpers/canvas-agent-action-recovery-control.mjs':'86a5f9894080cfd730cf7e383a6f985528f6b63177ccd820e8009eed8196a912',
    'tests/helpers/canvas-agent-autonomy-control.mjs':'0b15c9709f23ac0bb36e4a7e0c8f8d3111260928aa4061745ae663f2b11698b7',
    'tests/helpers/canvas-project-lifecycle-control.mjs':'bf244ef37d9600d1668798652b3c65fa882a3e37c9ab5995057fd35b5b897bb1',
  }),
  retain:Object.freeze([1,4,5,6,7,8,9,10,11,13,14,15,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,38,39,40]),
});
export const reliabilityWorkerFailures=Object.freeze([
  'Canvas conversational action recovery confirmation-replay preserves original authority and receipts',
  'Canvas autonomous project lost-lease',
  'Canvas reliability project deletion preserves committed results and immutable source identities',
  'Admin one-click Memvid Stream preview run queues missing previews, repairs downloads, and dispatches when configured',
  'Admin one-click Memvid Stream preview run sanitizes GitHub dispatch failures',
  'scheduled Memvid Stream catch-up dispatches existing queued publish backlog below threshold',
  'publish-trigger dispatch starts at threshold and cooldown prevents workflow storms',
  'scheduled Memvid Stream catch-up dispatches a below-threshold backlog',
]);
const reliabilityTools=['scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs','scripts/test-local-release.mjs'];
export function assertReliabilityWorkerTree(head,read=gitBytes){
  const p=RELIABILITY_WORKER_PREFLIGHT,files=(base,sha)=>read(['diff','--name-only',base,sha]).toString().trim().split('\n').filter(Boolean).sort();
  assert.deepEqual(read(['rev-list','--parents','-n','1',p.fixtureSource]).toString().trim().split(/\s+/),[p.fixtureSource,p.source]);
  assert.deepEqual(files(p.source,p.fixtureSource),Object.keys(p.specs).sort(),'Unreviewed fixture correction');
  assert.deepEqual(read(['rev-list','--parents','-n','1',head]).toString().trim().split(/\s+/),[head,p.fixtureSource],'Continuation must preserve original failed source and fixture commit');
  assert.deepEqual(files(p.fixtureSource,head),[...reliabilityTools].sort(),'Only existing continuation/verifier entrypoints may change');
  for(const[file,hash]of Object.entries(p.specs))assert.equal(sha256(read(['show',`${head}:${file}`])),hash,`Changed reviewed fixture: ${file}`);
  const file='scripts/test-local-release.mjs',before=read(['show',`${p.source}:${file}`]).toString(),after=read(['show',`${head}:${file}`]).toString();
  const entry="if(process.argv.includes('--reliability-worker-only')) {\n  assert.deepEqual(process.argv.slice(2),['--reliability-worker-only']);\n  await testReliabilityWorkerContinuation();process.exit(0);\n}\n\n",tail='\nasync function testReliabilityWorkerContinuation() {';
  assert.equal(after.split(entry).length,2);assert.equal(after.split(tail).length,2);
  assert.equal(after.split(tail)[0].replace(entry,''),before,'Already passed verifier assertions changed');
  assert(after.endsWith('\nawait testReliabilityWorkerContinuation();\n'));
}
export function reliabilityWorkerPrefix(bytes,current,read=gitBytes){
  const p=RELIABILITY_WORKER_PREFLIGHT,original=JSON.parse(bytes);assertReliabilityWorkerTree(current.sha,read);
  assert.equal(sha256(bytes),p.checkpoint,'Changed original failed checkpoint');
  assert.equal(original.sha,p.source);assert.equal(original.status,'failed');assert.equal(original.commands.length,42);
  assert(!original.preflightContinuation&&!original.permissionContinuation&&!original.repair);
  assert(original.commands.slice(0,41).every(row=>row.exitCode===0&&!row.reusedFrom&&!row.continuation));
  assert.equal(original.commands[41].exitCode,1);assert.equal(original.commands[41].logHash,p.failedLog);
  for(const key of ['base','planHash'])assert.equal(original[key],current[key]);
  const environment=({reused,preparationMs,...rest})=>rest;assert.deepEqual(environment(original.environment),environment(current.environment),'Changed pinned execution environment');
  assert.equal(original.nativeBrowsers?.key,current.nativeBrowsers?.key);
  const flags=({files,reasons,...rest})=>rest;assert.deepEqual(flags(original.selection),flags(current.selection));
  assert.deepEqual(current.commands,selectedCommands(original.selection,{GITHUB_SHA:current.sha,CANDIDATE_BASE:current.base}),'Changed command closure');
  for(const index of p.retain)assert.deepEqual(original.commands[index].command,current.commands[index]);
  return original;
}
export function verifyReliabilityWorkerRepair(directory,head,{allowPending=false,read=gitBytes}={}){
  const p=RELIABILITY_WORKER_PREFLIGHT;assertReliabilityWorkerTree(head,read);
  const pinned=(file,hash)=>{const raw=fs.readFileSync(path.join(directory,'reuse',file));assert.equal(sha256(raw),hash,`Changed retained Worker evidence: ${file}`);return raw;};
  const original=JSON.parse(pinned('preflight-checkpoint.json',p.checkpoint));
  assert.equal(original.sha,p.source);assert.equal(original.status,'failed');
  const log=pinned('preflight-failed.log',p.failedLog).toString(),last=JSON.parse(pinned('original-worker-last-run.json',p.lastRun));
  const before=workerDiscovery(parseDiscovery(pinned('original-worker-discovery.json',p.discovery).toString()));
  assert.equal(before.length,1653);assert.match(log,/Running 1653 tests using 1 worker/);assert.match(log,/\n\s+8 failed\n/);assert.match(log,/\n\s+1645 passed /);
  const prefix=log.split('Running 1653 tests using 1 worker')[0];
  assert.match(prefix,/# tests 61\n# suites 0\n# pass 61\n# fail 0\n# cancelled 0\n# skipped 0/);
  assert.match(prefix,/Q4 normal Worker discovery:/);assert.match(prefix,/"mediaTools":\{"ffmpeg":"6\.1\.1-3ubuntu5","ffprobe":"6\.1\.1-3ubuntu5"\}/);
  assert(!log.includes('> test:homepage-ffmpeg-processor\n')&&!log.includes('> test:q2-runtime\n'),'Unstarted media/native tail cannot inherit acceptance');
  const previous=workerListResults(log,before),failed=previous.filter(row=>!passedOnce(row));
  assert.deepEqual(failed.map(row=>row.title).sort(),[...reliabilityWorkerFailures].sort());
  assert(failed.every(row=>row.results.length===2&&row.results.every((result,index)=>result.status==='failed'&&result.retry===index)),'Original failed attempts must remain failed');
  assert.equal(last.status,'failed');assert.deepEqual(failed.map(row=>row.id).sort(),[...last.failedTests].sort());
  const file=path.join(directory,'test-results/reliability-worker-discovery.json');let discovery=null;
  if(fs.existsSync(file)){
    const report=parseDiscovery(fs.readFileSync(file,'utf8'));assert.deepEqual(report.errors,[]);discovery=workerDiscovery(report);
    const identities=rows=>rows.map(({id,file,title})=>({id,file,title})).sort((a,b)=>a.id.localeCompare(b.id));
    assert.deepEqual(identities(discovery),identities(before),'Full Worker discovery changed');
  }
  if(allowPending)return {original,previous,discovery};
  assert(discovery,'Missing actual candidate full discovery');
  const fresh=JSON.parse(fs.readFileSync(path.join(directory,'test-results/reliability-worker-fresh.json')));
  assert.deepEqual(fresh.errors,[]);assert.equal(fresh.config.workers,1);assert(fresh.config.projects.every(project=>project.retries===0));
  assert.deepEqual({expected:fresh.stats.expected,unexpected:fresh.stats.unexpected,flaky:fresh.stats.flaky,skipped:fresh.stats.skipped},{expected:8,unexpected:0,flaky:0,skipped:0});
  const result=verifyWorkerUnion({previous,discovery,progress:executedWorkers(fresh),corrected:[]});
  assert.deepEqual(result,{originalPassed:1645,progressPassed:8,correctedPassed:0,total:1653});return {original,previous,discovery,result};
}
export function reliabilityWorkerContinuation(command){
  assert.equal(JSON.parse(fs.readFileSync('package.json')).scripts['test:workers'],'node scripts/check-media-tools.mjs && npm run test:website-assistant && node scripts/check-q4-selection.mjs && playwright test -c playwright.workers.config.js && npm run test:homepage-ffmpeg-processor && npm run test:q2-runtime');
  assert.equal(command.split('  npm run test:workers').length,2);assert(command.endsWith('else\n  npm run test:workers\nfi\n'));
  const grep=reliabilityWorkerFailures.map(value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|');
  const fresh=[
    'mkdir -p .local-release/test-results',
    'PLAYWRIGHT_JSON_OUTPUT_NAME= npx playwright test -c playwright.workers.config.js --list --reporter=json > .local-release/test-results/reliability-worker-discovery.json',
    'node scripts/local-release.mjs verify-reliability-worker-pending .local-release',
    `PLAYWRIGHT_JSON_OUTPUT_NAME= npx playwright test -c playwright.workers.config.js --grep '(?:${grep})$' --list --reporter=json > .local-release/test-results/reliability-worker-selected.json`,
    'node scripts/local-release.mjs verify-reliability-worker-selection .local-release',
    `PLAYWRIGHT_JSON_OUTPUT_NAME=.local-release/test-results/reliability-worker-fresh.json npx playwright test -c playwright.workers.config.js --grep '(?:${grep})$' --output=test-results/reliability-worker-artifacts --workers=1 --retries=0 --reporter=list,json`,
    'node scripts/local-release.mjs verify-reliability-worker-repair .local-release',
    'npm run test:homepage-ffmpeg-processor','npm run test:q2-runtime',
  ].map(line=>'  '+line).join('\n');return command.replace('  npm run test:workers',()=>fresh);
}
export function verifyReliabilityWorkerSelection(directory,head,options={}){
  const {previous}=verifyReliabilityWorkerRepair(directory,head,{...options,allowPending:true});
  const report=parseDiscovery(fs.readFileSync(path.join(directory,'test-results/reliability-worker-selected.json'),'utf8'));assert.deepEqual(report.errors,[]);
  const rows=workerDiscovery(report),identity=rows=>rows.map(({id,file,title})=>({id,file,title})).sort((a,b)=>a.id.localeCompare(b.id));
  assert.deepEqual(identity(rows),identity(previous.filter(row=>!passedOnce(row))),'Only the eight original failures may execute');return rows;
}
export function reliabilityWorkerGuard(command){assert.equal(command,'npm run test:local-release');return command+' -- --reliability-worker-only';}
export function verifyReliabilityWorkerContinuation(directory,evidence,commands){
  const p=RELIABILITY_WORKER_PREFLIGHT;assert.deepEqual(evidence.preflightContinuation,{source:p.source,checkpoint:p.checkpoint});
  const original=reliabilityWorkerPrefix(fs.readFileSync(path.join(directory,'reuse/preflight-checkpoint.json')),{...evidence,commands});
  verifyReliabilityWorkerRepair(directory,evidence.sha);verifyReliabilityWorkerSelection(directory,evidence.sha);
  assert.equal(evidence.commands.length,commands.length,'Incomplete continued command closure');
  for(const[i,row]of evidence.commands.entries()){
    if(p.retain.includes(i))assert.deepEqual(row,{...original.commands[i],reusedFrom:p.source},'Retained command identity/hash changed');
    else{assert(!row.reusedFrom&&!row.browserContinuation,'Affected/unexecuted command cannot inherit acceptance');
      if(i===17)assert.equal(row.continuation,reliabilityWorkerGuard(commands[i].run));
      else if(i===41)assert.equal(row.continuation,reliabilityWorkerContinuation(commands[i].run));
      else assert(!row.continuation,'Unreviewed command continuation');
    }
  }
}

// Native workerd limits compound SELECTs to five terms. Preserve the original
// failed report and the two independent completed suites; the other 13 suites
// repeat their real setup, including 27 dependent checks, against corrected SQL.
export const RELIABILITY_NATIVE_PREFLIGHT=Object.freeze({
  source:'66ae26841e0ef48b8cda32b17214614a03984823',schemaSource:'a1a45903b1bacab1ade45832811d6c02651e9dd7',productSource:'65a10a52d059b9f0a62c38569268c2f0f98bf94b',
  checkpoint:'323fa4abe9e3137f26b94aa393e6a373a7d9ceef8619a06969559921cb05629c',
  failedLog:'e82e7e67ecdbfaedbef4e1d77d5f5a7762b603ae08ed13213d1d9a8da884b60b',
  workerReport:'376982c33a62f7b0f76b9cd06aaa87650ae1042a72c382c8bcd94d305cffa979',
  discovery:'592bf0c3033fda66a9d8541eb5f69d035c2f2c2564a01eae69b47b42e9de6335',
  nativeDirectory:'q2-runtime-evidence/native-0yGGKD',
  nativeProof:Object.freeze({
    'launcher-result.json':'3190754f071f33e0746f732bd0202b2af3eff343e357052511c72166c1ccb2cb',
    'reports/isolation-result.json':'c609013b5a939b464aaa1834e97286e6ec5c0f4eb4c069f1af40770a6527b11e',
    'reports/isolation-final.json':'3722a729b374515d022042aa6df90f8f984b91c3086a0a52d42884219ce98055',
    'reports/bitbi-q2-runtime-5g5JAc__result.json':'a2c75ff9d77871f2f52527abce27db643ab8c12935b374d72b9b4db8f517d764',
    'reports/bitbi-q2-runtime-5g5JAc__build-provenance.json':'9b2c17367d9a0c7202ef7bc2d76cdb75f745b27b549f261382b04bb0df8d43d3',
  }),
  specs:Object.freeze({
    'workers/auth/migrations/0113_canvas_notifications_and_lifecycle.sql':'514a62df68e3241ac216404f3d9a825bd2f95e962ef2cbe989e4da7b85ba6cbc',
    'tests/helpers/q2-runtime/canvas-reliability.mjs':'f14d1ac7ffb7b450c5e92a9c0e7670f06eddc3bf469eb25c671b9130175d06e2',
    'workers/auth/src/lib/canvas-notifications.js':'854412ee85afc283cb349bcfe0b107b5231fc44c46cd8e7fae632a756f0eff14',
    'tests/helpers/canvas-notifications-control.mjs':'fd8dd047fc56dcc80059de2fe972dc7605293a63fa0f5358de63ade653037ce5',
  }),
  retain:Object.freeze([1,4,5,6,8,9,10,11,13,14,15,18,19,20,21,22,23,24,25,26,30,31,32,33,38,39]),
});
export const reliabilityNativeWorkerNames=Object.freeze([
  'Canvas reliability project deletion preserves committed results and immutable source identities',
  'Canvas reliability notifications preserve ownership, explicit acknowledgements and real operation states',
  'Canvas reliability populated notification migration preserves old receipts without fabricated reads',
  ...['bootstrap','duration','explicit','button','isolation','allowance'].map(name=>`Canvas conversational decision ${name} binds real project authority without inference`),
  ...['immediate','delegation','stale-project','stale-brief','stale-price','consent-isolation','concurrent-approval'].map(name=>`Canvas natural chat ${name} uses the existing durable production authority`),
]);
export const reliabilityNativeSuites=Object.freeze(['website-assistant','canvas','canvas-reliability','model-status','model-pricing','appearance','member-generation','native','recovery','q4-public-video','q4-stream','q4-video','q4-subscription']);
const reliabilityNativeTools=[...reliabilityTools,'tests/helpers/q2-runtime/runner.mjs','tests/helpers/q2-runtime/linux-hosted.mjs','tests/helpers/q2-runtime/linux-runtime-child.mjs','tests/helpers/q2-runtime/linux-bootstrap.py','scripts/test-q2-runtime-launcher.mjs'];
export function assertReliabilityNativeTree(head,read=gitBytes){
  const p=RELIABILITY_NATIVE_PREFLIGHT,files=(base,sha)=>read(['diff','--name-only',base,sha]).toString().trim().split('\n').filter(Boolean).sort();
  assertReliabilityWorkerTree(p.source,read);
  assert.deepEqual(read(['rev-list','--parents','-n','1',p.schemaSource]).toString().trim().split(/\s+/),[p.schemaSource,p.source]);
  assert.deepEqual(files(p.source,p.schemaSource),['workers/auth/migrations/0113_canvas_notifications_and_lifecycle.sql','tests/helpers/q2-runtime/canvas-reliability.mjs','docs/runbooks/REGRESSION_REGISTER.md'].sort());
  assert.deepEqual(read(['rev-list','--parents','-n','1',p.productSource]).toString().trim().split(/\s+/),[p.productSource,p.schemaSource]);
  assert.deepEqual(files(p.schemaSource,p.productSource),['workers/auth/src/lib/canvas-notifications.js','tests/helpers/canvas-notifications-control.mjs','tests/helpers/q2-runtime/canvas-reliability.mjs','docs/runbooks/REGRESSION_REGISTER.md'].sort());
  assert.deepEqual(read(['rev-list','--parents','-n','1',head]).toString().trim().split(/\s+/),[head,p.productSource]);
  assert.deepEqual(files(p.productSource,head),[...reliabilityNativeTools].sort(),'Unreviewed product/fixture change');
  for(const[file,hash]of Object.entries(p.specs))assert.equal(sha256(read(['show',`${head}:${file}`])),hash,`Changed native correction ${file}`);
  const before=file=>read(['show',`${p.source}:${file}`]).toString(),after=file=>read(['show',`${head}:${file}`]).toString();
  for(const file of reliabilityNativeTools.filter(file=>file.startsWith('tests/'))){
    let expected=before(file);
    if(file.endsWith('/runner.mjs'))expected=expected.replace('export function selectedRuntimeSuites(suite) {\n',"export function selectedRuntimeSuites(suite) {\n  // Closed continuation after the 0113 native migration failure. Full retains all 15 suites.\n  if(suite==='canvas-notification-migration')return runtimeSuites.filter(([name])=>!['references','q4-memory'].includes(name));\n");
    else if(file.endsWith('.py'))expected=expected.replace('+ ["canvas-reliability"])','+ ["canvas-reliability"] + ["canvas-notification-migration"])');
    else expected=expected.replaceAll("'canvas-export-delivery','canvas-reliability'","'canvas-export-delivery','canvas-notification-migration','canvas-reliability'").replaceAll('canvas-export-delivery|canvas-reliability','canvas-export-delivery|canvas-notification-migration|canvas-reliability');
    assert.equal(after(file),expected,'Only the closed suite alias may alter native launch inputs');
  }
  const entry="if(process.argv.includes('--reliability-native-only')) {\n  assert.deepEqual(process.argv.slice(2),['--reliability-native-only']);\n  await testReliabilityNativeContinuation();process.exit(0);\n}\n\n";
  const text=after('scripts/test-local-release.mjs'),tail='\nasync function testReliabilityNativeContinuation() {';
  assert.equal(text.split(entry).length,2);assert.equal(text.split(tail).length,2);assert.equal(text.split(tail)[0].replace(entry,''),before('scripts/test-local-release.mjs'));
  const launcher=after('scripts/test-q2-runtime-launcher.mjs'),marker="\ntest('Canvas notification migration continuation retains only independent completed suites',async()=>{";
  assert.equal(launcher.split(marker).length,2);assert.equal(launcher.split(marker)[0],before('scripts/test-q2-runtime-launcher.mjs'));
}
export function reliabilityNativePrefix(bytes,current,read=gitBytes){
  const p=RELIABILITY_NATIVE_PREFLIGHT;assertReliabilityNativeTree(current.sha,read);assert.equal(sha256(bytes),p.checkpoint);
  const old=JSON.parse(bytes);assert.equal(old.sha,p.source);assert.equal(old.status,'failed');assert.equal(old.commands.length,42);
  assert(old.commands.slice(0,41).every(row=>row.exitCode===0));assert.equal(old.commands[41].exitCode,1);assert.equal(old.commands[41].logHash,p.failedLog);
  assert.deepEqual(old.preflightContinuation,{source:RELIABILITY_WORKER_PREFLIGHT.source,checkpoint:RELIABILITY_WORKER_PREFLIGHT.checkpoint});
  for(const key of ['base','planHash'])assert.equal(old[key],current[key]);
  const env=({reused,preparationMs,...rest})=>rest;assert.deepEqual(env(old.environment),env(current.environment));assert.equal(old.nativeBrowsers.key,current.nativeBrowsers.key);
  const flags=({files,reasons,...rest})=>rest;assert.deepEqual(flags(old.selection),flags(current.selection));
  assert.deepEqual(current.commands,selectedCommands(old.selection,{GITHUB_SHA:current.sha,CANDIDATE_BASE:current.base}));
  for(const index of p.retain)assert.deepEqual(old.commands[index].command,current.commands[index]);return old;
}
export function verifyReliabilityNativeUnion(previous,fresh){
  assert.equal(previous.passed,40);assert.equal(previous.failedSuites,13);assert.equal(previous.reports.length,15);
  const retained=previous.reports.filter(row=>['references','q4-memory'].includes(row.suite));assert.equal(retained.length,2);assert(retained.every(row=>!row.failure));
  assert.deepEqual(retained.map(row=>row.records.length),[3,10]);assert(retained.flatMap(row=>row.records).every(row=>row.status==='PASS'));
  const partial=previous.reports.filter(row=>!retained.includes(row));assert.deepEqual(partial.map(row=>row.suite),reliabilityNativeSuites);
  assert(partial.every(row=>row.failure?.message.includes('too many terms in compound SELECT')));
  assert.equal(partial.reduce((n,row)=>n+row.records.length,0),27);
  assert.equal(fresh.failedSuites,0);assert.deepEqual(fresh.reports.map(row=>row.suite),reliabilityNativeSuites);
  let count=0;for(const row of fresh.reports){assert(!row.failure);assert(row.records.length>0);assert(row.records.every(item=>item.status==='PASS'));assert.equal(new Set(row.records.map(item=>item.name)).size,row.records.length);
    for(const old of partial.find(other=>other.suite===row.suite).records)assert(row.records.some(item=>item.name===old.name),'Dependent setup assertion disappeared');count+=row.records.length;}
  assert.equal(fresh.passed,count);assert.equal(fresh.reports.find(row=>row.suite==='canvas-reliability').records.length,6);
  return {nativeRetained:13,nativeFresh:count,dependentChecksRepeated:27,nativeTotal:count+13};
}
export function verifyReliabilityNativeProvenance(previous,fresh,build){
  assert.deepEqual(fresh,build,'Report does not match native build provenance');
  const unchanged=({migrations,sourceLedger,bundleSha256,...rest})=>rest;assert.deepEqual(unchanged(fresh),unchanged(previous),'Native dependencies/runtime changed');
  const source='workers/auth/src/lib/canvas-notifications.js',ledger=previous.sourceLedger.map(row=>row.path===source?{...row,sha256:RELIABILITY_NATIVE_PREFLIGHT.specs[source]}:row);
  assert.equal(ledger.filter(row=>row.path===source).length,1);assert.notEqual(previous.sourceLedger.find(row=>row.path===source).sha256,ledger.find(row=>row.path===source).sha256);
  assert.deepEqual(fresh.sourceLedger,ledger,'Only the exact reviewed notification bind repair may change application sources');
  assert.match(fresh.bundleSha256,/^[a-f0-9]{64}$/);assert.notEqual(fresh.bundleSha256,previous.bundleSha256,'Old application bundle cannot claim the notification bind repair');
  const file='0113_canvas_notifications_and_lifecycle.sql',expected=previous.migrations.map(row=>row.path===file?{...row,sha256:RELIABILITY_NATIVE_PREFLIGHT.specs['workers/auth/migrations/'+file]}:row);
  assert.equal(expected.filter(row=>row.path===file).length,1);assert.notEqual(previous.migrations.find(row=>row.path===file).sha256,expected.find(row=>row.path===file).sha256);
  assert.deepEqual(fresh.migrations,expected,'Fresh native runtime must use the corrected exact SQL with unchanged migration history');
}
export function verifyReliabilityNativeRepair(directory,head,{allowPending=false,read=gitBytes}={}){
  const p=RELIABILITY_NATIVE_PREFLIGHT;assertReliabilityNativeTree(head,read);
  const pinned=(file,hash)=>{const bytes=fs.readFileSync(path.join(directory,file));assert.equal(sha256(bytes),hash,`Changed native origin evidence ${file}`);return bytes;};
  const old=JSON.parse(pinned('reuse/preflight-checkpoint.json',p.checkpoint)),origin=path.join(directory,'reuse/reliability-native-origin');
  const complete=verifyReliabilityWorkerRepair(origin,p.source,{read});verifyReliabilityWorkerSelection(origin,p.source,{read});
  const discovery=workerDiscovery(parseDiscovery(pinned('reuse/reliability-native-origin/test-results/reliability-worker-discovery.json',p.discovery).toString()));
  const accepted=JSON.parse(pinned('reuse/reliability-native-origin/test-results/reliability-worker-fresh.json',p.workerReport));
  const resolved=new Map(executedWorkers(accepted).map(row=>[row.id,row]));const previous=complete.previous.map(row=>resolved.get(row.id)||row);assert(previous.every(passedOnce));
  const log=pinned('reuse/preflight-failed.log',p.failedLog).toString();assert.match(log,/"originalPassed":1645,"progressPassed":8,"correctedPassed":0,"total":1653/);
  assert(log.includes('Canvas assembly: real 120-second/2880-frame export'));assert.match(log,/Private video reference FFmpeg: .*passed\./);
  const launcher=log.split('> test:q2-runtime\n');assert.equal(launcher.length,2);assert.match(launcher[1],/# tests 33\n# suites 0\n# pass 33\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0/);
  const records=Object.fromEntries(Object.entries(p.nativeProof).map(([file,hash])=>[file,JSON.parse(pinned('reuse/reliability-native-original/'+file,hash))]));
  const native=records['reports/bitbi-q2-runtime-5g5JAc__result.json'];assert.deepEqual(native.provenance,records['reports/bitbi-q2-runtime-5g5JAc__build-provenance.json']);
  assert.equal(records['launcher-result.json'].hostedImage.GITHUB_SHA,p.source);assert.equal(records['launcher-result.json'].status,1);
  for(const file of ['reports/isolation-result.json','reports/isolation-final.json'])assert.equal(records[file].passed,true);
  const identity=rows=>rows.map(({id,file,title})=>({id,file,title})).sort((a,b)=>a.id.localeCompare(b.id));
  const currentFile=path.join(directory,'test-results/reliability-native-discovery.json');let current=null;
  if(fs.existsSync(currentFile)){const result=parseDiscovery(fs.readFileSync(currentFile,'utf8'));assert.deepEqual(result.errors,[]);current=workerDiscovery(result);assert.deepEqual(identity(current),identity(discovery));}
  const affected=previous.filter(row=>reliabilityNativeWorkerNames.includes(row.title));assert.equal(affected.length,16);
  if(allowPending)return {old,previous,native,current,affected};assert(current,'Missing current full Worker discovery');
  verifyReliabilityNativeWorkers(previous,current,JSON.parse(fs.readFileSync(path.join(directory,'test-results/reliability-native-workers.json'))));
  const freshLog=fs.readFileSync(path.join(directory,'test-results/reliability-native.log'),'utf8');verifyNativeLocalReports(directory,freshLog);
  const refs=freshLog.split('\n').flatMap(line=>{try{const row=JSON.parse(line);return row.q2LinuxEvidence?[row.q2LinuxEvidence]:[];}catch{return [];}});assert.equal(refs.length,1);
  const folder=path.join(directory,'runtime',refs[0].slice('/tmp/bitbi-release/'.length));assert.equal(JSON.parse(fs.readFileSync(path.join(folder,'launcher-result.json'))).hostedImage.GITHUB_SHA,head);
  const names=fs.readdirSync(path.join(folder,'reports')).filter(name=>name==='result.json'||name.endsWith('__result.json'));assert.equal(names.length,1);
  const nativeFresh=JSON.parse(fs.readFileSync(path.join(folder,'reports',names[0]))),buildFile=names[0].replace(/result\.json$/,'build-provenance.json');
  verifyReliabilityNativeProvenance(native.provenance,nativeFresh.provenance,JSON.parse(fs.readFileSync(path.join(folder,'reports',buildFile))));
  const alias=tapResults(fs.readFileSync(path.join(directory,'test-results/reliability-native-alias.tap'),'utf8'));
  assert.deepEqual(alias.filter(row=>row.status!=='skipped'),[{title:'Canvas notification migration continuation retains only independent completed suites',status:'passed'}]);
  return {old,previous,native,result:{workerRetained:1637,workerFresh:16,workerTotal:1653,processorRetained:true,launcherRetained:33,launcherFresh:1,...verifyReliabilityNativeUnion(native,nativeFresh)}};
}
export function verifyReliabilityNativeWorkers(previous,discovery,report){
  const identity=rows=>rows.map(({id,file,title})=>({id,file,title})).sort((a,b)=>a.id.localeCompare(b.id));
  assert.equal(previous.length,1653);assert.equal(new Set(previous.map(row=>row.id)).size,1653);assert(previous.every(passedOnce));
  assert.deepEqual(identity(discovery),identity(previous));const affected=previous.filter(row=>reliabilityNativeWorkerNames.includes(row.title));assert.equal(affected.length,16);
  assert.deepEqual(report.errors,[]);assert.equal(report.config.workers,1);assert(report.config.projects.every(row=>row.retries===0));
  assert.deepEqual({expected:report.stats.expected,unexpected:report.stats.unexpected,flaky:report.stats.flaky,skipped:report.stats.skipped},{expected:16,unexpected:0,flaky:0,skipped:0});
  const fresh=executedWorkers(report);assert.deepEqual(identity(fresh),identity(affected));assert(fresh.every(passedOnce),'Every affected view caller must pass once');
  return {workerRetained:1637,workerFresh:16,workerTotal:1653};
}
export function verifyReliabilityNativeSelection(directory,head,options={}){
  const {affected}=verifyReliabilityNativeRepair(directory,head,{...options,allowPending:true});const report=parseDiscovery(fs.readFileSync(path.join(directory,'test-results/reliability-native-selected.json'),'utf8'));assert.deepEqual(report.errors,[]);
  const identity=rows=>rows.map(({id,file,title})=>({id,file,title})).sort((a,b)=>a.id.localeCompare(b.id));assert.deepEqual(identity(workerDiscovery(report)),identity(affected));return affected;
}
export function reliabilityNativeGuard(command){assert.equal(command,'npm run test:local-release');return command+' -- --reliability-native-only';}
export function reliabilityNativeContinuation(command){
  assert.equal(command.split('  npm run test:workers').length,2);assert(command.endsWith('else\n  npm run test:workers\nfi\n'));
  const grep=reliabilityNativeWorkerNames.map(value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|');
  const lines=['set -o pipefail','mkdir -p .local-release/test-results',
    'PLAYWRIGHT_JSON_OUTPUT_NAME= npx playwright test -c playwright.workers.config.js --list --reporter=json > .local-release/test-results/reliability-native-discovery.json',
    'node scripts/local-release.mjs verify-reliability-native-pending .local-release',
    `PLAYWRIGHT_JSON_OUTPUT_NAME= npx playwright test -c playwright.workers.config.js --grep '(?:${grep})$' --list --reporter=json > .local-release/test-results/reliability-native-selected.json`,
    'node scripts/local-release.mjs verify-reliability-native-selection .local-release',
    `PLAYWRIGHT_JSON_OUTPUT_NAME=.local-release/test-results/reliability-native-workers.json npx playwright test -c playwright.workers.config.js --grep '(?:${grep})$' --output=test-results/reliability-native-workers --workers=1 --retries=0 --reporter=list,json`,
    'node scripts/test-q2-runtime.mjs --suite canvas-notification-migration 2>&1 | tee .local-release/test-results/reliability-native.log',
    'mkdir -p .local-release/runtime','cp -a /tmp/bitbi-release/q2-runtime-evidence .local-release/runtime/',
    'node scripts/local-release.mjs verify-reliability-native-repair .local-release'];return command.replace('  npm run test:workers',()=>lines.map(line=>'  '+line).join('\n'));
}
export function verifyReliabilityNativeContinuation(directory,evidence,commands){
  const p=RELIABILITY_NATIVE_PREFLIGHT;assert.deepEqual(evidence.preflightContinuation,{source:p.source,checkpoint:p.checkpoint});
  const old=reliabilityNativePrefix(fs.readFileSync(path.join(directory,'reuse/preflight-checkpoint.json')),{...evidence,commands});
  verifyReliabilityNativeRepair(directory,evidence.sha);verifyReliabilityNativeSelection(directory,evidence.sha);assert.equal(evidence.commands.length,commands.length);
  for(const[i,row]of evidence.commands.entries())if(p.retain.includes(i))assert.deepEqual(row,{...old.commands[i],reusedFrom:p.source});
  else{assert(!row.reusedFrom&&!row.browserContinuation);if(i===17)assert.equal(row.continuation,reliabilityNativeGuard(commands[i].run));else if(i===41)assert.equal(row.continuation,reliabilityNativeContinuation(commands[i].run));else assert(!row.continuation);}
}

const reliabilityBrowserTools=['scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs','scripts/lib/local-release-browser.mjs','scripts/test-local-release.mjs'];
export function assertReliabilityBrowserTree(head,read=gitBytes){
  const p=RELIABILITY_BROWSER_PREFLIGHT,files=(base,sha)=>read(['diff','--name-only',base,sha]).toString().trim().split('\n').filter(Boolean).sort();
  assertReliabilityNativeTree(p.source,read);
  assert.deepEqual(read(['rev-list','--parents','-n','1',p.productSource]).toString().trim().split(/\s+/),[p.productSource,p.source]);
  assert.deepEqual(files(p.source,p.productSource),Object.keys(p.specs).sort(),'Unreviewed notification correction');
  assert.deepEqual(read(['rev-list','--parents','-n','1',p.toolingSource]).toString().trim().split(/\s+/),[p.toolingSource,p.productSource]);
  assert.deepEqual(files(p.productSource,p.toolingSource),[...reliabilityBrowserTools,...Object.keys(p.toolSpecs)].sort(),'Unreviewed original continuation changes');
  assert.deepEqual(read(['rev-list','--parents','-n','1',p.progress.source]).toString().trim().split(/\s+/),[p.progress.source,p.toolingSource]);
  assert.deepEqual(files(p.toolingSource,p.progress.source),['scripts/lib/local-release-browser.mjs','scripts/lib/local-release-evidence.mjs','scripts/test-local-release.mjs',...Object.keys(p.selectionSpecs)].sort(),'Unreviewed continuation selection correction');
  const q=p.workerProgress;
  assert.deepEqual(read(['rev-list','--parents','-n','1',q.source]).toString().trim().split(/\s+/),[q.source,p.progress.source]);
  assert.deepEqual(files(p.progress.source,q.source),[...reliabilityBrowserTools].sort(),'Unreviewed continuation guard correction');
  if(head!==q.source){
    assert.deepEqual(read(['rev-list','--parents','-n','1',q.fixtureSource]).toString().trim().split(/\s+/),[q.fixtureSource,q.source]);
    assert.deepEqual(files(q.source,q.fixtureSource),[q.fixture],'Unreviewed notification envelope correction');
    assert.deepEqual(read(['rev-list','--parents','-n','1',q.guardSource]).toString().trim().split(/\s+/),[q.guardSource,q.fixtureSource]);
    assert.deepEqual(files(q.fixtureSource,q.guardSource),[...reliabilityBrowserTools].sort(),'Unreviewed continuation Worker correction');
    const branchSource='7e3f937e8f93bb66944175b51b6a1c8896ecd4a7';
    assert.deepEqual(read(['rev-list','--parents','-n','1',branchSource]).toString().trim().split(/\s+/),[branchSource,q.guardSource]);
    assert.deepEqual(files(q.guardSource,branchSource),['scripts/lib/local-release-browser.mjs','scripts/lib/local-release-evidence.mjs','scripts/test-local-release.mjs'],'Unreviewed continuation selected-branch guard correction');
    const b=p.browserProgress;
    assert.deepEqual(read(['rev-list','--parents','-n','1',b.source]).toString().trim().split(/\s+/),[b.source,branchSource]);
    assert.deepEqual(files(branchSource,b.source),['scripts/lib/local-release-evidence.mjs'],'Unreviewed continuation guard diagnostic correction');
    assert.equal(sha256(read(['show',`${b.source}:scripts/test-local-release.mjs`])),q.guardTestHash,'Changed reviewed selected-branch guard');
    if(head!==b.source){
      assert.deepEqual(read(['rev-list','--parents','-n','1',b.fixtureSource]).toString().trim().split(/\s+/),[b.fixtureSource,b.source]);
      assert.deepEqual(files(b.source,b.fixtureSource),Object.keys(b.specs).sort(),'Unreviewed continuation browser correction');
      const t=p.proposalProgress;
      assert.deepEqual(read(['rev-list','--parents','-n','1',t.source]).toString().trim().split(/\s+/),[t.source,b.fixtureSource]);
      assert.deepEqual(files(b.fixtureSource,t.source),[...reliabilityBrowserTools].sort(),'Unreviewed continuation browser proof');
      if(head!==t.source){
        assert.deepEqual(read(['rev-list','--parents','-n','1',t.fixtureSource]).toString().trim().split(/\s+/),[t.fixtureSource,t.source]);
        assert.deepEqual(files(t.source,t.fixtureSource),[t.fixture],'Unreviewed continuation proposal correction');
        assert.deepEqual(read(['rev-list','--parents','-n','1',head]).toString().trim().split(/\s+/),[head,t.fixtureSource]);
        assert.deepEqual(files(t.fixtureSource,head),[...reliabilityBrowserTools].sort(),'Unreviewed continuation proposal proof');
      }
    }
  }
  const currentBrowser=head!==q.source&&head!==p.browserProgress.source;
  const currentProposal=currentBrowser&&head!==p.proposalProgress.source;
  const specs={...p.specs,...p.toolSpecs,...p.selectionSpecs,...(head===q.source?{}:{[q.fixture]:q.fixtureHash}),...(currentBrowser?p.browserProgress.specs:{}),...(currentProposal?{[p.proposalProgress.fixture]:p.proposalProgress.fixtureHash}:{})};
  for(const[file,hash]of Object.entries(specs))assert.equal(sha256(read(['show',`${head}:${file}`])),hash,`Changed reviewed notification input ${file}`);
  const before=read(['show',`${p.source}:scripts/test-local-release.mjs`]).toString(),after=read(['show',`${head}:scripts/test-local-release.mjs`]).toString();
  const entry="if(process.argv.includes('--reliability-browser-only')) {\n  assert.deepEqual(process.argv.slice(2),['--reliability-browser-only']);\n  await testReliabilityBrowserContinuation();process.exit(0);\n}\n\n",tail='\nasync function testReliabilityBrowserContinuation() {';
  const progressEntry="if(process.argv.includes('--reliability-control-progress-only')) {\n  assert.deepEqual(process.argv.slice(2),['--reliability-control-progress-only']);\n  await testReliabilityControlProgress();process.exit(0);\n}\n\n",progressTail='\nasync function testReliabilityControlProgress() {';
  const browserEntry="if(process.argv.includes('--reliability-browser-progress-only')) {\n  assert.deepEqual(process.argv.slice(2),['--reliability-browser-progress-only']);\n  await testReliabilityBrowserProgress();process.exit(0);\n}\n\n",browserTail='\nasync function testReliabilityBrowserProgress() {';
  const proposalEntry="if(process.argv.includes('--reliability-proposal-progress-only')) {\n  assert.deepEqual(process.argv.slice(2),['--reliability-proposal-progress-only']);\n  await testReliabilityProposalProgress();process.exit(0);\n}\n\n",proposalTail='\nasync function testReliabilityProposalProgress() {';
  if(currentProposal){assert.equal(after.split(proposalEntry).length,2);assert.equal(after.split(proposalTail).length,2);assert.equal(after.split(proposalTail)[0].replace(proposalEntry,''),read(['show',`${p.proposalProgress.source}:scripts/test-local-release.mjs`]).toString(),'Previously passed browser progress guard changed');}
  assert.equal(after.split(entry).length,2);assert.equal(after.split(tail).length,2);assert.equal(after.split(tail)[0].replace(entry,'').replace(progressEntry,'').replace(browserEntry,'').replace(proposalEntry,''),before,'Previously passed verifier assertions changed');
  if(head!==q.source){assert.equal(after.split(progressEntry).length,2);assert.equal(after.split(progressTail).length,2);assert.equal(after.split(progressTail)[0].replace(progressEntry,'').replace(browserEntry,'').replace(proposalEntry,''),read(['show',`${q.source}:scripts/test-local-release.mjs`]).toString(),'Previously passed notification guard assertions changed');}
  if(currentBrowser){assert.equal(after.split(browserEntry).length,2);assert.equal(after.split(browserTail).length,2);assert.equal(after.split(browserTail)[0].replace(browserEntry,'').replace(proposalEntry,''),read(['show',`${p.browserProgress.source}:scripts/test-local-release.mjs`]).toString(),'Previously passed Worker progress guard changed');}
  const nativeBefore=read(['show',`${p.source}:tests/helpers/q2-runtime/canvas-policy-tail.mjs`]).toString(),nativeAfter=read(['show',`${head}:tests/helpers/q2-runtime/canvas-policy-tail.mjs`]).toString();
  assert(nativeAfter.startsWith(nativeBefore),'Existing native callback wrappers changed');
  const launcherBefore=read(['show',`${p.source}:scripts/test-q2-runtime-launcher.mjs`]).toString(),launcherAfter=read(['show',`${head}:scripts/test-q2-runtime-launcher.mjs`]).toString();
  assert(launcherAfter.startsWith(launcherBefore),'Previously passed launcher assertions changed');
}
export function reliabilityBrowserPrefix(bytes,current,read=gitBytes){
  const p=RELIABILITY_BROWSER_PREFLIGHT;assertReliabilityBrowserTree(current.sha,read);assert.equal(sha256(bytes),p.checkpoint);
  const old=JSON.parse(bytes);assert.equal(old.sha,p.source);assert.equal(old.status,'failed');assert.equal(old.commands.length,50);
  assert(old.commands.slice(0,49).every(row=>row.exitCode===0));assert.equal(old.commands[49].exitCode,1);assert.equal(old.commands[49].logHash,p.failedLog);
  assert.deepEqual(old.preflightContinuation,{source:RELIABILITY_NATIVE_PREFLIGHT.source,checkpoint:RELIABILITY_NATIVE_PREFLIGHT.checkpoint});
  for(const key of ['base','planHash'])assert.equal(old[key],current[key]);
  const env=({reused,preparationMs,...rest})=>rest;assert.deepEqual(env(old.environment),env(current.environment));assert.equal(old.nativeBrowsers.key,current.nativeBrowsers.key);
  const flags=({files,reasons,...rest})=>rest;assert.deepEqual(flags(old.selection),flags(current.selection));assert.equal(requiresPrivateMediaImage(current.selection.files),false,'No private-media image was tested in the original scope');
  assert.deepEqual(current.commands,selectedCommands(old.selection,{GITHUB_SHA:current.sha,CANDIDATE_BASE:current.base}));assert.equal(current.commands.length,52);
  for(const index of p.retain)assert.deepEqual(old.commands[index].command,current.commands[index]);return old;
}
// Only the unchanged documentation and selector gates from the real partial
// follow-up are retained. Source-sensitive checks and the failed guard stay fresh.
export function verifyReliabilityBrowserProgress(directory,head,commands,{read=gitBytes}={}){
  const p=RELIABILITY_BROWSER_PREFLIGHT,g=p.progress,folder=path.join(directory,'reuse/reliability-browser-progress');assertReliabilityBrowserTree(head,read);
  const pinned=(file,hash)=>{const bytes=fs.readFileSync(path.join(folder,file));assert.equal(sha256(bytes),hash,`Changed notification guard progress ${file}`);return bytes;};
  const original=JSON.parse(pinned('checkpoint.json',g.checkpoint));assert.equal(original.sha,g.source);assert.equal(original.sourceTree,g.tree);assert.equal(original.status,'failed');assert.equal(original.commands.length,50);
  assert.deepEqual(original.preflightContinuation,{source:p.source,checkpoint:p.checkpoint});assert(!original.preflightProgress);
  const prior=JSON.parse(fs.readFileSync(path.join(directory,'reuse/preflight-checkpoint.json')));
  assert.equal(original.base,prior.base);assert.equal(original.planHash,validationPlan().digest);assert.equal(original.environment.key,prior.environment.key);assert.equal(original.environment.image,prior.environment.image);assert.equal(original.nativeBrowsers.key,prior.nativeBrowsers.key);
  assert.deepEqual(original.selection,gitSelection(original.base,g.source));assert.deepEqual(original.selection.files,gitSelection(original.base,head).files);
  assert.deepEqual(commands,selectedCommands(original.selection,{GITHUB_SHA:head,CANDIDATE_BASE:original.base}));
  const acceptedCommands=selectedCommands(original.selection,{GITHUB_SHA:g.source,CANDIDATE_BASE:original.base});
  for(const[i,row]of original.commands.entries()){
    if(p.retain.includes(i)){assert.deepEqual(row,{...prior.commands[i],reusedFrom:prior.commands[i].reusedFrom||p.source});continue;}
    if(i>17){assert.equal(row,null,'An unexecuted command cannot acquire a pass');continue;}
    assert.deepEqual(row.command,acceptedCommands[i]);assert.equal(row.exitCode,i===17?1:0);assert(!row.reusedFrom&&!row.browserContinuation);pinned(row.log,row.logHash);
    if(i===17){assert.equal(row.logHash,g.failed);assert.equal(row.continuation,reliabilityBrowserGuard(commands[i].run));}else assert(!row.continuation);
  }
  for(const i of g.retain){assert.deepEqual(original.commands[i].command,commands[i]);assert.equal(original.commands[i].exitCode,0);assert(!original.commands[i].reusedFrom);pinned(original.commands[i].log,original.commands[i].logHash);}
  return {original,retained:g.retain};
}
export function verifyReliabilityControlProgress(directory,head,commands,{read=gitBytes}={}){
  const p=RELIABILITY_BROWSER_PREFLIGHT,q=p.workerProgress,folder=path.join(directory,'reuse/reliability-control-progress');assertReliabilityBrowserTree(head,read);
  const pinned=(file,hash)=>{const bytes=fs.readFileSync(path.join(folder,file));assert.equal(sha256(bytes),hash,`Changed notification Worker progress ${file}`);return bytes;};
  const original=JSON.parse(pinned('checkpoint.json',q.checkpoint));assert.equal(original.sha,q.source);assert.equal(original.sourceTree,q.tree);assert.equal(original.status,'failed');assert.equal(original.commands.length,50);
  const accepted=selectedCommands(original.selection,{GITHUB_SHA:q.source,CANDIDATE_BASE:original.base});
  const prior=JSON.parse(fs.readFileSync(path.join(directory,'reuse/preflight-checkpoint.json'))),guard=verifyReliabilityBrowserProgress(directory,head,commands,{read}).original;
  assert.deepEqual(original.preflightContinuation,{source:p.source,checkpoint:p.checkpoint});assert.deepEqual(original.preflightProgress,{source:p.progress.source,checkpoint:p.progress.checkpoint});
  for(const key of ['base','planHash'])assert.equal(original[key],prior[key]);assert.equal(original.environment.key,prior.environment.key);assert.equal(original.nativeBrowsers.key,prior.nativeBrowsers.key);
  assert.deepEqual(original.selection,gitSelection(original.base,q.source));assert.deepEqual(original.selection.files,gitSelection(original.base,head).files);
  for(const[i,row]of original.commands.entries()){
    if(p.progress.retain.includes(i)){assert.deepEqual(row,{...guard.commands[i],reusedFrom:guard.sha});continue;}
    if(p.retain.includes(i)){assert.deepEqual(row,{...prior.commands[i],reusedFrom:prior.commands[i].reusedFrom||p.source});continue;}
    if(i>41){assert.equal(row,null);continue;}assert.deepEqual(row.command,accepted[i]);assert.equal(row.exitCode,i===41?1:0);assert(!row.reusedFrom&&!row.browserContinuation);pinned(row.log,row.logHash);
    if(i===17){assert.equal(row.logHash,q.guardLog);assert.equal(row.continuation,reliabilityBrowserGuard(accepted[i].run));}
    else if(i===41){assert.equal(row.logHash,q.failed);assert.equal(row.continuation,reliabilityControlContinuation(accepted[i].run));}else assert(!row.continuation);
  }
  for(const i of q.retain){assert.deepEqual(original.commands[i].command,commands[i]);assert.equal(original.commands[i].exitCode,0);pinned(original.commands[i].log,original.commands[i].logHash);}
  const full=parseDiscovery(pinned('test-results/reliability-control-discovery.json',q.discovery).toString()),selected=parseDiscovery(pinned('test-results/reliability-control-selected.json',q.selected).toString()),report=JSON.parse(pinned('test-results/reliability-control-workers.json',q.report));
  for(const r of [full,selected,report])assert.deepEqual(r.errors,[]);assert.equal(workerDiscovery(full).length,1653);
  const rows=executedWorkers(report),identity=rs=>rs.map(({id,file,title})=>({id,file,title})).sort((a,b)=>a.id.localeCompare(b.id));
  assert.deepEqual(identity(rows),identity(workerDiscovery(selected)));assert.deepEqual(identity(rows),identity(workerDiscovery(full).filter(row=>reliabilityNativeWorkerNames.includes(row.title))));
  assert.equal(report.config.workers,1);assert(report.config.projects.every(row=>row.retries===0));assert.deepEqual({expected:report.stats.expected,unexpected:report.stats.unexpected,flaky:report.stats.flaky,skipped:report.stats.skipped},{expected:15,unexpected:1,flaky:0,skipped:0});
  const failed=rows.filter(row=>!passedOnce(row));assert.equal(failed.length,1);assert.equal(failed[0].title,q.failedTitle);assert.deepEqual(failed[0].results,[{status:'failed',retry:0,error:true}]);
  const alias=pinned('test-results/reliability-control-alias.tap',q.alias);assert.deepEqual(tapResults(alias.toString()).filter(row=>row.status!=='skipped'),[{title:'Canvas notification controls continuation pins original discovery and refreshes only actual consumers',status:'passed'}]);
  return {original,retained:q.retain,rows,failed};
}
export function verifyReliabilityControlWorkerUnion(previous,discovery,progress,report){
  const identity=rs=>rs.map(({id,file,title})=>({id,file,title})).sort((a,b)=>a.id.localeCompare(b.id));assert.equal(previous.length,1653);assert(previous.every(passedOnce));assert.deepEqual(identity(previous),identity(discovery));
  const affected=previous.filter(row=>reliabilityNativeWorkerNames.includes(row.title));assert.equal(affected.length,16);assert.deepEqual(identity(progress),identity(affected));
  const failed=progress.filter(row=>!passedOnce(row));assert.equal(failed.length,1);assert.equal(failed[0].title,RELIABILITY_BROWSER_PREFLIGHT.workerProgress.failedTitle);assert.deepEqual(failed[0].results,[{status:'failed',retry:0,error:true}]);
  assert.deepEqual(report.errors,[]);assert.equal(report.config.workers,1);assert(report.config.projects.every(row=>row.retries===0));assert.deepEqual({expected:report.stats.expected,unexpected:report.stats.unexpected,flaky:report.stats.flaky,skipped:report.stats.skipped},{expected:1,unexpected:0,flaky:0,skipped:0});
  const fresh=executedWorkers(report);assert.deepEqual(identity(fresh),identity(failed));assert(fresh.every(passedOnce));
  return {workerRetained:1652,workerFresh:1,workerTotal:1653};
}
export function verifyReliabilityBrowserOrigin(directory,head,{read=gitBytes}={}){
  const p=RELIABILITY_BROWSER_PREFLIGHT;assertReliabilityBrowserTree(head,read);
  const pinned=(file,hash)=>{const bytes=fs.readFileSync(path.join(directory,file));assert.equal(sha256(bytes),hash,`Changed notification origin evidence ${file}`);return bytes;};
  const original=JSON.parse(pinned('reuse/preflight-checkpoint.json',p.checkpoint));assert.equal(original.sha,p.source);assert.equal(original.status,'failed');assert.equal(original.commands.length,50);
  const origin=path.join(directory,'reuse/reliability-browser-origin'),commands=selectedCommands(original.selection,{GITHUB_SHA:p.source,CANDIDATE_BASE:original.base});assert.equal(commands.length,52);
  // The prior run stopped at browser command49. Validate its real completed
  // prefix and native union, never fabricate the unexecuted Auth/final commands.
  for(const[i,row]of original.commands.entries()){
    assert.deepEqual(row.command,commands[i]);assert.equal(row.exitCode,i===49?1:0);assert.equal(sha256(fs.readFileSync(path.join(origin,row.log))),row.logHash);
  }
  pinned('reuse/preflight-failed.log',p.failedLog);
  const prior=verifyReliabilityNativeRepair(origin,p.source,{read});verifyReliabilityNativeSelection(origin,p.source,{read});
  const originalPrefix=reliabilityNativePrefix(fs.readFileSync(path.join(origin,'reuse/preflight-checkpoint.json')),{...original,commands},read);
  for(const[i,row]of original.commands.entries())if(i<49){
    if(RELIABILITY_NATIVE_PREFLIGHT.retain.includes(i))assert.deepEqual(row,{...originalPrefix.commands[i],reusedFrom:originalPrefix.commands[i].reusedFrom||RELIABILITY_NATIVE_PREFLIGHT.source});
    else{assert(!row.reusedFrom&&!row.browserContinuation);if(i===17)assert.equal(row.continuation,reliabilityNativeGuard(commands[i].run));else if(i===41)assert.equal(row.continuation,reliabilityNativeContinuation(commands[i].run));else assert(!row.continuation);}
  }
  const freshOriginal=JSON.parse(pinned('reuse/reliability-browser-origin/test-results/reliability-native-workers.json',p.workerReport));
  const resolved=new Map(executedWorkers(freshOriginal).map(row=>[row.id,row])),workers=prior.previous.map(row=>resolved.get(row.id)||row);assert.equal(workers.length,1653);assert(workers.every(passedOnce));
  const native=JSON.parse(pinned('reuse/reliability-browser-origin/'+p.nativeResult,p.nativeHash));
  assert.deepEqual(native.provenance,JSON.parse(pinned('reuse/reliability-browser-origin/'+p.nativeResult.replace(/result\.json$/,'build-provenance.json'),p.nativeBuild)));
  assert.equal(native.passed,443);assert.equal(native.failedSuites,0);assert(native.reports.flatMap(row=>row.records).every(row=>row.status==='PASS'));
  const previous=browserRows(JSON.parse(pinned('reuse/model-browser-original.json',p.report)));assert.equal(previous.length,p.required);assert.equal(sha256(JSON.stringify(previous)),p.rows);
  const affected=previous.filter(row=>reliabilityBrowserAffectedTitles.includes(row.title));assert.equal(affected.length,52);assert.equal(new Set(affected.map(row=>row.title)).size,26);
  assert(previous.filter(row=>!passedBrowserCase(row)).every(row=>affected.includes(row)),'Unreviewed additional browser failure');
  const standard=browserRows(JSON.parse(pinned('reuse/model-browser-standard.json',p.standardDiscovery)),{discovery:true});
  const auth=standard.filter(row=>row.project==='chromium'&&(/^(auth-admin|wallet-nav|locale|oma2-q1-member)\.spec\.js$/.test(row.file)||row.file.startsWith('oma2-q3-')));
  assert.equal(sha256(JSON.stringify(auth)),p.authDiscovery);assert.equal(auth.length,p.authRequired);
  const overlap=previous.filter(row=>auth.some(item=>item.key===row.key));assert.equal(overlap.length,p.authReused);assert(overlap.every(row=>row.file==='locale.spec.js'&&passedBrowserCase(row)));
  for(const[file,hash]of Object.entries(p.homepageReports))pinned('test-results/'+file,hash);
  return {original,origin,workers,native,previous,retainedNative:prior.native.reports.filter(row=>['references','q4-memory'].includes(row.suite))};
}
export function verifyReliabilityControlNativeUnion(previous,fresh,retainedNative){
  assert.equal(previous.passed,443);assert.equal(previous.failedSuites,0);assert.equal(previous.reports.length,13);
  assert.deepEqual(retainedNative.map(row=>[row.suite,row.records.length]),[['references',3],['q4-memory',10]]);assert(retainedNative.flatMap(row=>row.records).every(row=>row.status==='PASS'));
  const canvas=previous.reports.find(row=>row.suite==='canvas'),reliability=previous.reports.find(row=>row.suite==='canvas-reliability');
  assert.equal(canvas.records.length,canvasNotificationControlDiscoveryCount);assert.equal(sha256(JSON.stringify(canvas.records.map(row=>row.name))),canvasNotificationControlDiscoveryHash);assert.equal(reliability.records.length,6);
  assert(previous.reports.flatMap(row=>row.records).every(row=>row.status==='PASS'));assert.equal(fresh.passed,19);assert.equal(fresh.failedSuites,0);assert.deepEqual(fresh.reports.map(row=>row.suite),['canvas','canvas-reliability']);
  assert.deepEqual(fresh.reports[0].records,canvasNotificationControlInventory.map(name=>({name,status:'PASS'})));assert.deepEqual(fresh.reports[1].records,reliability.records);
  const metrics=fresh.reports[0].metrics.filter(row=>row.notificationControls);assert.equal(metrics.length,1);
  assert.deepEqual(metrics[0].notificationControls,{retained:canvas.records.map(row=>row.name).filter(name=>!canvasNotificationControlInventory.includes(name)),discovery:canvas.records.map(row=>row.name),fresh:[...canvasNotificationControlInventory]});
  return {nativeRetained:437,nativeFresh:19,nativeTotal:456};
}
export function verifyReliabilityControlProvenance(previous,fresh,build){
  assert.deepEqual(fresh,build,'Actual fresh build provenance must match the executed runtime');
  const source='js/shared/canvas-notification-contract.mjs',hash=RELIABILITY_BROWSER_PREFLIGHT.specs[source];assert.equal(previous.sourceLedger.filter(row=>row.path===source).length,1);
  assert.deepEqual(fresh.sourceLedger,previous.sourceLedger.map(row=>row.path===source?{...row,sha256:hash}:row),'Only reviewed notification copy may change compiled source inputs');
  for(const key of ['versions','compatibilityDate','workerdBinarySha256'])assert.deepEqual(fresh[key],previous[key]);assert.match(fresh.bundleSha256,/^[a-f0-9]{64}$/);
  const migration='0113_canvas_notifications_and_lifecycle.sql';assert.equal(previous.migrations.filter(row=>row.path===migration).length,1);assert.equal(fresh.migrations.filter(row=>row.path===migration).length,1);
  assert.deepEqual(fresh.migrations,previous.migrations.map(row=>row.path===migration?{...row,sha256:RELIABILITY_BROWSER_PREFLIGHT.specs['workers/auth/migrations/'+migration]}:row));
}
export function verifyReliabilityControlRepair(directory,head,{allowPending=false,read=gitBytes}={}){
  const prior=verifyReliabilityBrowserOrigin(directory,head,{read}),fullFile=path.join(directory,'test-results/reliability-control-discovery.json');
  if(!fs.existsSync(fullFile)){assert(allowPending,'Missing complete Worker discovery');return prior;}
  const full=parseDiscovery(fs.readFileSync(fullFile,'utf8'));assert.deepEqual(full.errors,[]);const discovery=workerDiscovery(full),identity=rows=>rows.map(({id,file,title})=>({id,file,title})).sort((a,b)=>a.id.localeCompare(b.id));assert.deepEqual(identity(discovery),identity(prior.workers));
  const progress=fs.existsSync(path.join(directory,'reuse/reliability-control-progress/checkpoint.json'))?verifyReliabilityControlProgress(directory,head,selectedCommands(gitSelection(prior.original.base,head),{GITHUB_SHA:head,CANDIDATE_BASE:prior.original.base}),{read}):null;
  if(allowPending)return {...prior,discovery,progress};
  const selected=parseDiscovery(fs.readFileSync(path.join(directory,'test-results/reliability-control-selected.json'),'utf8'));assert.deepEqual(selected.errors,[]);assert.deepEqual(identity(workerDiscovery(selected)),identity(progress?progress.failed:prior.workers.filter(row=>reliabilityNativeWorkerNames.includes(row.title))));
  const report=JSON.parse(fs.readFileSync(path.join(directory,'test-results/reliability-control-workers.json'))),workerCounts=progress?verifyReliabilityControlWorkerUnion(prior.workers,discovery,progress.rows,report):verifyReliabilityNativeWorkers(prior.workers,discovery,report);
  const log=fs.readFileSync(path.join(directory,'test-results/reliability-control.log'),'utf8');verifyNativeLocalReports(directory,log);
  const refs=log.split('\n').flatMap(line=>{try{const row=JSON.parse(line);return row.q2LinuxEvidence?[row.q2LinuxEvidence]:[];}catch{return [];}});assert.equal(refs.length,1);
  const folder=path.join(directory,'runtime',refs[0].slice('/tmp/bitbi-release/'.length));assert.equal(JSON.parse(fs.readFileSync(path.join(folder,'launcher-result.json'))).hostedImage.GITHUB_SHA,head);
  const names=fs.readdirSync(path.join(folder,'reports')).filter(name=>name==='result.json'||name.endsWith('__result.json'));assert.equal(names.length,1);
  const fresh=JSON.parse(fs.readFileSync(path.join(folder,'reports',names[0]))),build=JSON.parse(fs.readFileSync(path.join(folder,'reports',names[0].replace(/result\.json$/,'build-provenance.json'))));
  verifyReliabilityControlProvenance(prior.native.provenance,fresh.provenance,build);
  const aliasBytes=fs.readFileSync(path.join(directory,'test-results/reliability-control-alias.tap'));if(progress)assert.equal(sha256(aliasBytes),RELIABILITY_BROWSER_PREFLIGHT.workerProgress.alias,'Changed retained native alias proof');
  const alias=tapResults(aliasBytes.toString());assert.deepEqual(alias.filter(row=>row.status!=='skipped'),[{title:'Canvas notification controls continuation pins original discovery and refreshes only actual consumers',status:'passed'}]);
  return {...prior,result:{...workerCounts,...verifyReliabilityControlNativeUnion(prior.native,fresh,prior.retainedNative)}};
}
export function verifyReliabilityControlSelection(directory,head){
  const prior=verifyReliabilityControlRepair(directory,head,{allowPending:true}),report=parseDiscovery(fs.readFileSync(path.join(directory,'test-results/reliability-control-selected.json'),'utf8'));assert.deepEqual(report.errors,[]);
  const identity=rows=>rows.map(({id,file,title})=>({id,file,title})).sort((a,b)=>a.id.localeCompare(b.id));assert.deepEqual(identity(workerDiscovery(report)),identity(prior.progress?prior.progress.failed:prior.workers.filter(row=>reliabilityNativeWorkerNames.includes(row.title))));return workerDiscovery(report).length;
}
export function verifyReliabilityBrowserTail(directory,head,commands,{read=gitBytes}={}){
  const p=RELIABILITY_BROWSER_PREFLIGHT,b=p.browserProgress,folder=path.join(directory,'reuse/reliability-browser-tail'),origin=path.join(folder,'origin');assertReliabilityBrowserTree(head,read);
  const pinned=(file,hash)=>{const bytes=fs.readFileSync(path.join(folder,file));assert.equal(sha256(bytes),hash,`Changed notification browser progress ${file}`);return bytes;};
  const original=JSON.parse(pinned('checkpoint.json',b.checkpoint));assert.equal(original.sha,b.source);assert.equal(original.sourceTree,b.tree);assert.equal(original.status,'failed');assert.equal(original.commands.length,50);
  const accepted=selectedCommands(original.selection,{GITHUB_SHA:b.source,CANDIDATE_BASE:original.base});
  const prior=JSON.parse(fs.readFileSync(path.join(origin,'reuse/preflight-checkpoint.json'))),worker=verifyReliabilityControlProgress(origin,b.source,accepted,{read});
  const finished=verifyReliabilityControlRepair(origin,b.source,{read});assert.deepEqual(finished.result,{workerRetained:1652,workerFresh:1,workerTotal:1653,nativeRetained:437,nativeFresh:19,nativeTotal:456});
  assert.deepEqual(original.preflightContinuation,{source:p.source,checkpoint:p.checkpoint});assert.deepEqual(original.preflightProgress,{source:p.workerProgress.source,checkpoint:p.workerProgress.checkpoint});
  for(const key of ['base','planHash'])assert.equal(original[key],prior[key]);assert.equal(original.environment.key,prior.environment.key);assert.equal(original.nativeBrowsers.key,prior.nativeBrowsers.key);
  assert.deepEqual(original.selection,gitSelection(original.base,b.source));assert.deepEqual(original.selection.files,gitSelection(original.base,head).files);assert.deepEqual(commands,selectedCommands(original.selection,{GITHUB_SHA:head,CANDIDATE_BASE:original.base}));
  for(const[i,row]of original.commands.entries()){
    assert.equal(sha256(fs.readFileSync(path.join(origin,row.log))),row.logHash);
    if(worker.retained.includes(i)){assert.deepEqual(row,{...worker.original.commands[i],reusedFrom:worker.original.commands[i].reusedFrom||worker.original.sha});continue;}
    if(p.retain.includes(i)){assert.deepEqual(row,{...prior.commands[i],reusedFrom:prior.commands[i].reusedFrom||p.source});continue;}
    assert.deepEqual(row.command,accepted[i]);assert.equal(row.exitCode,i===49?1:0);assert(!row.reusedFrom);
    if(i===17)assert.equal(row.continuation,reliabilityControlProgressGuard(accepted[i].run));else if(i===41)assert.equal(row.continuation,reliabilityControlContinuation(accepted[i].run,{progress:true}));
    else if(i===49){assert.equal(row.logHash,b.failed);assert.equal(row.continuation,reliabilityBrowserContinuation(accepted[i].run));assert.equal(row.browserContinuation,MODEL_BROWSER_POLICY);}else assert(!row.continuation&&!row.browserContinuation);
  }
  for(const i of b.retain){assert.equal(original.commands[i].exitCode,0);assert.deepEqual(original.commands[i].command,commands[i]);}
  pinned('origin/'+b.nativeResult,b.native);pinned('origin/'+b.nativeResult.replace(/result\.json$/,'build-provenance.json'),b.nativeBuild);pinned('origin/test-results/reliability-control-workers.json',b.worker);
  const report=JSON.parse(pinned('browser.json',b.report)),rows=browserRows(report);assert.equal(report.config.workers,1);assert(report.config.projects.every(row=>row.retries===0));assert.deepEqual(report.errors,[]);
  assert.deepEqual({expected:report.stats.expected,unexpected:report.stats.unexpected,flaky:report.stats.flaky,skipped:report.stats.skipped},{expected:39,unexpected:13,flaky:0,skipped:0});
  const discovery=browserRows(JSON.parse(pinned('discovery.json',b.discovery)),{discovery:true}),selected=browserRows(JSON.parse(pinned('selected.json',b.selected)),{discovery:true});assert.equal(sha256(JSON.stringify(discovery)),p.discovery);
  assert.deepEqual(rows.map(({key,file,title,project})=>({key,file,title,project})),selected);assert.deepEqual(selected,discovery.filter(row=>reliabilityBrowserAffectedTitles.includes(row.title)));
  const progress={sha:b.source,rows};modelBrowserRetained(browserRows(JSON.parse(fs.readFileSync(path.join(directory,'reuse/model-browser-original.json')))),p,progress);
  return {original,retained:b.retain,progress,origin};
}
export function verifyReliabilityProposalTail(directory,head,commands,{read=gitBytes}={}){
  const p=RELIABILITY_BROWSER_PREFLIGHT,b=p.proposalProgress,folder=path.join(directory,'reuse/reliability-proposal-tail'),origin=path.join(folder,'origin');assertReliabilityBrowserTree(head,read);
  const pinned=(file,hash)=>{const bytes=fs.readFileSync(path.join(folder,file));assert.equal(sha256(bytes),hash,`Changed proposal progress ${file}`);return bytes;};
  const original=JSON.parse(pinned('checkpoint.json',b.checkpoint));assert.equal(original.sha,b.source);assert.equal(original.sourceTree,b.tree);assert.equal(original.status,'failed');assert.equal(original.commands.length,50);
  const accepted=selectedCommands(original.selection,{GITHUB_SHA:b.source,CANDIDATE_BASE:original.base}),tail=verifyReliabilityBrowserTail(origin,b.source,accepted,{read}),prior=JSON.parse(fs.readFileSync(path.join(origin,'reuse/preflight-checkpoint.json')));
  assert.deepEqual(original.preflightContinuation,{source:p.source,checkpoint:p.checkpoint});assert.deepEqual(original.preflightProgress,{source:p.browserProgress.source,checkpoint:p.browserProgress.checkpoint});
  for(const key of ['base','planHash'])assert.equal(original[key],prior[key]);assert.equal(original.environment.key,prior.environment.key);assert.equal(original.nativeBrowsers.key,prior.nativeBrowsers.key);
  assert.deepEqual(original.selection,gitSelection(original.base,b.source));assert.deepEqual(original.selection.files,gitSelection(original.base,head).files);assert.deepEqual(commands,selectedCommands(original.selection,{GITHUB_SHA:head,CANDIDATE_BASE:original.base}));
  for(const[i,row]of original.commands.entries()){
    assert.equal(sha256(fs.readFileSync(path.join(origin,row.log))),row.logHash);
    if(tail.retained.includes(i)){assert.deepEqual(row,{...tail.original.commands[i],reusedFrom:tail.original.commands[i].reusedFrom||tail.original.sha});continue;}
    if(p.retain.includes(i)){assert.deepEqual(row,{...prior.commands[i],reusedFrom:prior.commands[i].reusedFrom||p.source});continue;}
    assert.deepEqual(row.command,accepted[i]);assert.equal(row.exitCode,i===49?1:0);assert(!row.reusedFrom);
    if(i===17)assert.equal(row.continuation,reliabilityBrowserProgressGuard(accepted[i].run));else if(i===49){assert.equal(row.logHash,b.failed);assert.equal(row.continuation,reliabilityBrowserContinuation(accepted[i].run));assert.equal(row.browserContinuation,MODEL_BROWSER_POLICY);}else assert(!row.continuation&&!row.browserContinuation);
  }
  for(const i of b.retain){assert.equal(original.commands[i].exitCode,0);assert.deepEqual(original.commands[i].command,commands[i]);}
  const raw=JSON.parse(pinned('browser.json',b.report)),rows=browserRows(raw);assert.equal(raw.config.workers,1);assert(raw.config.projects.every(row=>row.retries===0));assert.deepEqual(raw.errors,[]);
  assert.deepEqual({expected:raw.stats.expected,unexpected:raw.stats.unexpected,flaky:raw.stats.flaky,skipped:raw.stats.skipped},{expected:12,unexpected:4,flaky:0,skipped:0});
  const discovery=browserRows(JSON.parse(pinned('discovery.json',b.discovery)),{discovery:true}),selected=browserRows(JSON.parse(pinned('selected.json',b.selected)),{discovery:true});assert.equal(sha256(JSON.stringify(discovery)),p.discovery);
  assert.deepEqual(rows.map(({key,file,title,project})=>({key,file,title,project})),selected);assert.deepEqual(selected,discovery.filter(row=>reliabilityBrowserRetryTitles.includes(row.title)));
  const progress={...tail.progress,accepted:{sha:b.source,rows}};modelBrowserRetained(browserRows(JSON.parse(fs.readFileSync(path.join(directory,'reuse/model-browser-original.json')))),p,progress);
  return {original,retained:b.retain,progress,origin};
}
export function reliabilityProposalProgressGuard(command){assert.equal(command,'npm run test:local-release');return command+' -- --reliability-proposal-progress-only';}
export function reliabilityBrowserProgressGuard(command){assert.equal(command,'npm run test:local-release');return command+' -- --reliability-browser-progress-only';}
export function verifyReliabilityBrowserReports(directory,head,{allowPending=false}={}){
  const prior=verifyReliabilityBrowserOrigin(directory,head),tail=fs.existsSync(path.join(directory,'reuse/reliability-proposal-tail/checkpoint.json'))?verifyReliabilityProposalTail(directory,head,selectedCommands(gitSelection(prior.original.base,head),{GITHUB_SHA:head,CANDIDATE_BASE:prior.original.base})):fs.existsSync(path.join(directory,'reuse/reliability-browser-tail/checkpoint.json'))?verifyReliabilityBrowserTail(directory,head,selectedCommands(gitSelection(prior.original.base,head),{GITHUB_SHA:head,CANDIDATE_BASE:prior.original.base})):null;
  if(allowPending)return {...prior,...(tail?{progress:tail.progress}:{}),result:null};
  const result={};for(const scope of ['homepage','auth']){
    const prefix=scope==='auth'?'model-browser-auth':'model-browser',raw=JSON.parse(fs.readFileSync(path.join(directory,`test-results/${prefix}-fresh.json`)));assert.deepEqual(raw.errors,[]);assert.equal(raw.config.workers,1);assert(raw.config.projects.every(row=>row.retries===0));
    const discovery=browserRows(JSON.parse(fs.readFileSync(path.join(directory,`test-results/${prefix}-discovery.json`))),{discovery:true}),report=JSON.parse(fs.readFileSync(path.join(directory,`test-results/candidate-${scope}.json`)));
    assert.equal(report.scope,scope);assert.deepEqual(report.previous,prior.previous);assert.deepEqual(report.progress,tail?.progress);assert.deepEqual(report.discovery,discovery);assert.deepEqual(report.fresh,browserRows(raw));result[scope]=verifyModelBrowserReport(report,head);
  }return {...prior,result};
}
export const reliabilityBrowserContinuation=(command,scope='homepage')=>modelBrowserContinuation(command,scope).replace('model-browser-continuation','reliability-browser-continuation');
export function reliabilityBrowserGuard(command){assert.equal(command,'npm run test:local-release');return command+' -- --reliability-browser-only';}
export function reliabilityControlProgressGuard(command){assert.equal(command,'npm run test:local-release');return command+' -- --reliability-control-progress-only';}
export function reliabilityControlContinuation(command,{progress=false}={}){
  let value=reliabilityNativeContinuation(command).replaceAll('reliability-native','reliability-control').replace('--suite canvas-notification-migration','--suite canvas-notification-controls');
  if(progress){const grep=reliabilityNativeWorkerNames.map(name=>name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|');assert.equal(value.split(grep).length,3);value=value.replaceAll(grep,RELIABILITY_BROWSER_PREFLIGHT.workerProgress.failedTitle);}
  return value;
}
export function verifyReliabilityBrowserContinuation(directory,evidence,commands){
  const p=RELIABILITY_BROWSER_PREFLIGHT;assert.deepEqual(evidence.preflightContinuation,{source:p.source,checkpoint:p.checkpoint});
  const old=reliabilityBrowserPrefix(fs.readFileSync(path.join(directory,'reuse/preflight-checkpoint.json')),{...evidence,commands}),proposalProgress=evidence.preflightProgress?.source===p.proposalProgress.source,browserProgress=proposalProgress||evidence.preflightProgress?.source===p.browserProgress.source;
  if(!browserProgress)verifyReliabilityControlRepair(directory,evidence.sha);verifyReliabilityBrowserReports(directory,evidence.sha);assert.equal(evidence.commands.length,commands.length);
  const workerProgress=evidence.preflightProgress?.source===p.workerProgress.source;
  const progress=evidence.preflightProgress?(proposalProgress?verifyReliabilityProposalTail(directory,evidence.sha,commands):browserProgress?verifyReliabilityBrowserTail(directory,evidence.sha,commands):workerProgress?verifyReliabilityControlProgress(directory,evidence.sha,commands):verifyReliabilityBrowserProgress(directory,evidence.sha,commands)):null;
  if(progress){const q=proposalProgress?p.proposalProgress:browserProgress?p.browserProgress:workerProgress?p.workerProgress:p.progress;assert.deepEqual(evidence.preflightProgress,{source:q.source,checkpoint:q.checkpoint});}
  for(const[i,row]of evidence.commands.entries())if(progress?.retained.includes(i))assert.deepEqual(row,{...progress.original.commands[i],reusedFrom:progress.original.commands[i].reusedFrom||progress.original.sha});
  else if(p.retain.includes(i))assert.deepEqual(row,{...old.commands[i],reusedFrom:old.commands[i].reusedFrom||p.source});
  else{assert(!row.reusedFrom);if([49,50].includes(i)){assert.equal(row.browserContinuation,MODEL_BROWSER_POLICY);assert.equal(row.continuation,reliabilityBrowserContinuation(commands[i].run,i===50?'auth':'homepage'));}
    else{assert(!row.browserContinuation);if(i===17)assert.equal(row.continuation,proposalProgress?reliabilityProposalProgressGuard(commands[i].run):browserProgress?reliabilityBrowserProgressGuard(commands[i].run):workerProgress?reliabilityControlProgressGuard(commands[i].run):reliabilityBrowserGuard(commands[i].run));else if(i===41)assert.equal(row.continuation,reliabilityControlContinuation(commands[i].run,{progress:workerProgress}));else assert(!row.continuation);}}
}

// Closed test-fixture repair after 1665 Worker passes. Product bytes, all test
// entrypoints/discovery and the completed 61-case Node prefix stay unchanged.
// Four historical recovery fixtures address only the seven original failures;
// media/native/browser acceptance has not executed and remains fully required.
export const INCIDENT_WORKER_PREFLIGHT=Object.freeze({
  source:'fbd3ecae2575184a58cff0b4a8132159c758308c',
  checkpoint:'f7cb5ff90b4b8ef8743fb5c8997a1cd75fec7cc9bed18d3e66d30503e24f782b',
  failedLog:'42da5628ec46280ad8be9ef74ae4d380c99074650287c20edefb276410ac8a94',
  completedGuardLog:'187755e40b02145b32cabcdcc6d15bf3efe8d73114e42a7d37b7b05242c0df62',
  lastRun:'505f9ce123cbcb4992d9589ce8f740f53b2b2f9d1a2c5bdc9494d335bc69b332',
  discovery:'e8fff5382820a61b07e7a632835b5a93ed862081acd2336f77895ddc685f6507',
  specs:Object.freeze({
    'tests/helpers/canvas-agent-explanation-control.mjs':'8bcd1ff59e47ac0c261a5781ce00c2cdf583cfa0407ce2ae0a6d9fff200ec55a',
    'tests/helpers/canvas-agent-conversation-recovery-control.mjs':'86bb884fe84029030f01655538242a7492268d0063f46aac511b8445b778a617',
    'tests/helpers/canvas-notifications-control.mjs':'60692c61edc4e71b36da91220a9a3add8b8ca7557302b51b4c5d83569a1e6e51',
    'tests/helpers/canvas-agent-natural-control.mjs':'6fd192613c7116438730d892d81771ff7f4565cd6237c35ab6b31a924563d319',
  }),
  retain:Object.freeze([1,4,5,6,7,8,9,10,11,13,14,15,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,38,39,40]),
});
export const incidentWorkerFailures=Object.freeze([
  'Canvas informed explanation budget-scope preserves source facts and financial scope',
  'Canvas conversation recovery prepare through signed transport and persisted receipts',
  'Canvas conversation recovery rejected through signed transport and persisted receipts',
  'Canvas conversation recovery rejected-tail through signed transport and persisted receipts',
  'Canvas conversation recovery stale-policy through signed transport and persisted receipts',
  'Canvas natural-chat migration preserves paid identities and saved conversations without inventing action consent',
  'Canvas reliability notifications preserve ownership, explicit acknowledgements and real operation states',
]);
export function assertIncidentWorkerTree(head,read=gitBytes){
  const p=INCIDENT_WORKER_PREFLIGHT;assertCanvasPreflightTree(p.source,read,INCIDENT_PREFLIGHT);
  assert.deepEqual(read(['rev-list','--parents','-n','1',head]).toString().trim().split(/\s+/),[head,p.source],'Incident Worker continuation requires the direct reviewed successor');
  const files=read(['diff','--name-only',p.source,head]).toString().trim().split('\n').filter(Boolean);
  const allowed=[...Object.keys(p.specs),...reliabilityTools];
  assert(files.every(file=>allowed.includes(file)),'Incident Worker continuation changed product, schema, discovery or environment');
  for(const[file,hash]of Object.entries(p.specs)){assert(files.includes(file),'Missing reviewed fixture correction');assert.equal(sha256(read(['show',`${head}:${file}`])),hash,`Unreviewed fixture: ${file}`);}
  for(const file of files)assert(/^100644 blob [0-9a-f]{40}\t/.test(read(['ls-tree',head,'--',file]).toString()),'Continuation input must remain an ordinary file');
  const file='scripts/test-local-release.mjs',before=read(['show',`${p.source}:${file}`]).toString(),after=read(['show',`${head}:${file}`]).toString();
  const entry="if(process.argv.includes('--incident-worker-only')) {\n  assert.deepEqual(process.argv.slice(2),['--incident-worker-only']);\n  await testIncidentWorkerContinuation();process.exit(0);\n}\n\n",tail='\nasync function testIncidentWorkerContinuation() {';
  assert.equal(after.split(entry).length,2);assert.equal(after.split(tail).length,2);
  assert.equal(after.split(tail)[0].replace(entry,''),before,'Already passed verifier assertions changed');
  assert(after.endsWith('\nawait testIncidentWorkerContinuation();\n'));
}
export function incidentWorkerPrefix(bytes,current,read=gitBytes){
  const p=INCIDENT_WORKER_PREFLIGHT,original=JSON.parse(bytes);assertIncidentWorkerTree(current.sha,read);
  assert.equal(sha256(bytes),p.checkpoint,'Changed original failed checkpoint');
  assert.equal(original.sha,p.source);assert.equal(original.status,'failed');assert.equal(original.commands.length,42);
  assert.deepEqual(original.preflightContinuation,{source:INCIDENT_PREFLIGHT.source,checkpoint:INCIDENT_PREFLIGHT.checkpoint});
  assert(!original.preflightProgress&&!original.permissionContinuation&&!original.repair);
  assert(original.commands.slice(0,41).every(row=>row.exitCode===0&&!row.continuation));
  for(const[i,row]of original.commands.entries())assert.equal(row.reusedFrom,INCIDENT_PREFLIGHT.retain.includes(i)?INCIDENT_PREFLIGHT.source:undefined,'Unreviewed nested reuse');
  assert.equal(original.commands[41].exitCode,1);assert.equal(original.commands[41].logHash,p.failedLog);assert.equal(original.commands[17].logHash,p.completedGuardLog);
  for(const key of ['base','planHash'])assert.equal(original[key],current[key]);
  const environment=({reused,preparationMs,...rest})=>rest;assert.deepEqual(environment(original.environment),environment(current.environment),'Changed pinned execution environment');
  assert.equal(original.nativeBrowsers?.key,current.nativeBrowsers?.key);
  const flags=({files,reasons,...rest})=>rest;assert.deepEqual(flags(original.selection),flags(current.selection));
  assert.deepEqual(current.commands,selectedCommands(original.selection,{GITHUB_SHA:current.sha,CANDIDATE_BASE:current.base}),'Changed command closure');
  for(const index of p.retain)assert.deepEqual(original.commands[index].command,current.commands[index]);
  return original;
}
export function verifyIncidentWorkerOrigin(directory,original){
  const origin=path.join(directory,'reuse/incident-preflight-origin');
  verifyCanvasPreflight(origin,original,selectedCommands(original.selection,{GITHUB_SHA:original.sha,CANDIDATE_BASE:original.base}));
  const log=fs.readFileSync(path.join(origin,'logs/17.log'));
  assert.equal(sha256(log),INCIDENT_WORKER_PREFLIGHT.completedGuardLog,'Changed passed verifier groups');
  for(const text of ['Local command mapping, no hosted duplicate suites','Incident preflight: actual isolated Git trees','Incident preflight: actual checkpoint, failed log and 10 retained logs verified'])assert(log.toString().includes(text),'Incomplete passed verifier evidence');
}
export function verifyIncidentWorkerRepair(directory,head,{allowPending=false,read=gitBytes}={}){
  const p=INCIDENT_WORKER_PREFLIGHT;assertIncidentWorkerTree(head,read);
  const pinned=(file,hash)=>{const raw=fs.readFileSync(path.join(directory,'reuse',file));assert.equal(sha256(raw),hash,`Changed retained Worker evidence: ${file}`);return raw;};
  const original=JSON.parse(pinned('preflight-checkpoint.json',p.checkpoint));
  assert.equal(original.sha,p.source);assert.equal(original.status,'failed');
  verifyIncidentWorkerOrigin(directory,original);
  const log=pinned('preflight-failed.log',p.failedLog).toString(),last=JSON.parse(pinned('original-worker-last-run.json',p.lastRun));
  const before=workerDiscovery(parseDiscovery(pinned('original-worker-discovery.json',p.discovery).toString()));
  assert.equal(before.length,1672);assert.match(log,/Running 1672 tests using 1 worker/);assert.match(log,/\n\s+7 failed\n/);assert.match(log,/\n\s+1665 passed /);
  const prefix=log.split('Running 1672 tests using 1 worker')[0];
  assert.match(prefix,/# tests 61\n# suites 0\n# pass 61\n# fail 0\n# cancelled 0\n# skipped 0/);
  assert.match(prefix,/Q4 normal Worker discovery:/);assert.match(prefix,/"mediaTools":\{"ffmpeg":"6\.1\.1-3ubuntu5","ffprobe":"6\.1\.1-3ubuntu5"\}/);
  assert(!log.includes('> test:homepage-ffmpeg-processor\n')&&!log.includes('> test:q2-runtime\n'),'Unstarted media/native tail cannot inherit acceptance');
  const previous=workerListResults(log,before),failed=previous.filter(row=>!passedOnce(row));
  assert.deepEqual(failed.map(row=>row.title).sort(),[...incidentWorkerFailures].sort());
  assert(failed.every(row=>row.results.length===2&&row.results.every((result,index)=>result.status==='failed'&&result.retry===index)),'Original failed attempts must remain failed');
  assert.equal(last.status,'failed');assert.deepEqual(failed.map(row=>row.id).sort(),[...last.failedTests].sort());
  const file=path.join(directory,'test-results/incident-worker-discovery.json');let discovery=null;
  if(fs.existsSync(file)){
    const report=parseDiscovery(fs.readFileSync(file,'utf8'));assert.deepEqual(report.errors,[]);discovery=workerDiscovery(report);
    const identities=rows=>rows.map(({id,file,title})=>({id,file,title})).sort((a,b)=>a.id.localeCompare(b.id));
    assert.deepEqual(identities(discovery),identities(before),'Full Worker discovery changed');
  }
  if(allowPending)return {original,previous,discovery};
  assert(discovery,'Missing actual candidate full discovery');
  const fresh=JSON.parse(fs.readFileSync(path.join(directory,'test-results/incident-worker-fresh.json')));
  assert.deepEqual(fresh.errors,[]);assert.equal(fresh.config.workers,1);assert(fresh.config.projects.every(project=>project.retries===0));
  assert.deepEqual({expected:fresh.stats.expected,unexpected:fresh.stats.unexpected,flaky:fresh.stats.flaky,skipped:fresh.stats.skipped},{expected:7,unexpected:0,flaky:0,skipped:0});
  const result=verifyWorkerUnion({previous,discovery,progress:executedWorkers(fresh),corrected:[]});
  assert.deepEqual(result,{originalPassed:1665,progressPassed:7,correctedPassed:0,total:1672});return {original,previous,discovery,result};
}
export function incidentWorkerContinuation(command){
  assert.equal(JSON.parse(fs.readFileSync('package.json')).scripts['test:workers'],'node scripts/check-media-tools.mjs && npm run test:website-assistant && node scripts/check-q4-selection.mjs && playwright test -c playwright.workers.config.js && npm run test:homepage-ffmpeg-processor && npm run test:q2-runtime');
  assert.equal(command.split('  npm run test:workers').length,2);assert(command.endsWith('else\n  npm run test:workers\nfi\n'));
  const grep=incidentWorkerFailures.map(value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|');
  const fresh=[
    'mkdir -p .local-release/test-results',
    'PLAYWRIGHT_JSON_OUTPUT_NAME= npx playwright test -c playwright.workers.config.js --list --reporter=json > .local-release/test-results/incident-worker-discovery.json',
    'node scripts/local-release.mjs verify-incident-worker-pending .local-release',
    `PLAYWRIGHT_JSON_OUTPUT_NAME= npx playwright test -c playwright.workers.config.js --grep '(?:${grep})$' --list --reporter=json > .local-release/test-results/incident-worker-selected.json`,
    'node scripts/local-release.mjs verify-incident-worker-selection .local-release',
    `PLAYWRIGHT_JSON_OUTPUT_NAME=.local-release/test-results/incident-worker-fresh.json npx playwright test -c playwright.workers.config.js --grep '(?:${grep})$' --output=test-results/incident-worker-artifacts --workers=1 --retries=0 --reporter=list,json`,
    'node scripts/local-release.mjs verify-incident-worker-repair .local-release',
    'npm run test:homepage-ffmpeg-processor','npm run test:q2-runtime',
  ].map(line=>'  '+line).join('\n');return command.replace('  npm run test:workers',()=>fresh);
}
export function verifyIncidentWorkerSelection(directory,head,options={}){
  const {previous}=verifyIncidentWorkerRepair(directory,head,{...options,allowPending:true});
  const report=parseDiscovery(fs.readFileSync(path.join(directory,'test-results/incident-worker-selected.json'),'utf8'));assert.deepEqual(report.errors,[]);
  const rows=workerDiscovery(report),identity=rows=>rows.map(({id,file,title})=>({id,file,title})).sort((a,b)=>a.id.localeCompare(b.id));
  assert.deepEqual(identity(rows),identity(previous.filter(row=>!passedOnce(row))),'Only the seven original failures may execute');return rows;
}
export function incidentWorkerGuard(command){assert.equal(command,'npm run test:local-release');return command+' -- --incident-worker-only';}
export function verifyIncidentWorkerContinuation(directory,evidence,commands){
  const p=INCIDENT_WORKER_PREFLIGHT;assert.deepEqual(evidence.preflightContinuation,{source:p.source,checkpoint:p.checkpoint});
  const original=incidentWorkerPrefix(fs.readFileSync(path.join(directory,'reuse/preflight-checkpoint.json')),{...evidence,commands});
  verifyIncidentWorkerRepair(directory,evidence.sha);verifyIncidentWorkerSelection(directory,evidence.sha);
  assert.equal(evidence.commands.length,commands.length,'Incomplete continued command closure');
  verifyIncidentWorkerRecords(directory,evidence,commands,original);
}
function verifyIncidentWorkerRecords(directory,evidence,commands,original){
  const p=INCIDENT_WORKER_PREFLIGHT;
  for(const[i,row]of evidence.commands.entries()){
    if(p.retain.includes(i)){assert.deepEqual(row,{...original.commands[i],reusedFrom:original.commands[i].reusedFrom||p.source},'Retained command identity/hash changed');assert.equal(sha256(fs.readFileSync(path.join(directory,row.log))),row.logHash);}
    else{assert(!row.reusedFrom&&!row.browserContinuation,'Affected/unexecuted command cannot inherit acceptance');
      if(i===17){assert.equal(row.continuation,incidentWorkerGuard(commands[i].run));const log=fs.readFileSync(path.join(directory,row.log),'utf8');assert(log.includes('Incident Worker continuation: 1665 retained passes and seven required fresh cases; nested provenance, exact discovery, changed-source and tamper controls verified.'));assert(!log.includes('Local command mapping, no hosted duplicate suites')&&!log.includes('Incident preflight: actual isolated Git trees'),'Passed guard groups repeated');}
      else if(i===41)assert.equal(row.continuation,incidentWorkerContinuation(commands[i].run));
      else assert(!row.continuation,'Unreviewed command continuation');
    }
  }
}

// One stale historical launcher expectation failed after the complete Worker
// union and real FFmpeg acceptance. Preserve those results and the 34 passed
// launcher cases; the isolated native child and browser suites remain fresh.
export const INCIDENT_NATIVE_PREFLIGHT=Object.freeze({
  source:'8fda637658c843e484ddac1da8af30251c47b511',
  checkpoint:'6d951ca29c7d83658dcd0adafbf58041255d2a83e6f19272a9afbac7bd86f23d',
  failedLog:'7a6c98320444f5fc06488344c3a2bb516f9cdd28a42a2605f6ea587597232f1f',
  completedGuardLog:'18e5393ecee38c0320c8b9d0b6394f983afc0604b7cb1f434306ab12cc5dcc03',
  reports:Object.freeze({
    'incident-worker-discovery.json':'5a9157c6605b4b97e6d7a91ec1af24e4d6c7fea9544b9e3fda591229fa7d1020',
    'incident-worker-selected.json':'de77017cc945f8b03e4fb29a97a605de7cdaccd44381df12d965f2430572fd7e',
    'incident-worker-fresh.json':'8dfe5abcb9befc2e42644d500bdb18d922536b2a949271a2afa97da6a3242ad3',
  }),
  specs:Object.freeze({'scripts/test-q2-runtime-launcher.mjs':'04981035ff52a09941666dbcffea64de0116474e44ba46e52dacb5141c266078'}),
  retain:INCIDENT_WORKER_PREFLIGHT.retain,
});
export const incidentLauncherFailure='Canvas notification controls continuation pins original discovery and refreshes only actual consumers';
export function assertIncidentNativeTree(head,read=gitBytes){
  const p=INCIDENT_NATIVE_PREFLIGHT;assertIncidentWorkerTree(p.source,read);
  assert.deepEqual(read(['rev-list','--parents','-n','1',head]).toString().trim().split(/\s+/),[head,p.source],'Incident native continuation requires the direct reviewed successor');
  const files=read(['diff','--name-only',p.source,head]).toString().trim().split('\n').filter(Boolean);
  assert(files.every(file=>[...Object.keys(p.specs),...reliabilityTools].includes(file)),'Incident native continuation changed passed product, media, Worker or launcher inputs');
  for(const[file,hash]of Object.entries(p.specs)){assert(files.includes(file),'Missing reviewed launcher correction');assert.equal(sha256(read(['show',`${head}:${file}`])),hash,'Unreviewed launcher correction');}
  for(const file of files)assert(/^100644 blob [0-9a-f]{40}\t/.test(read(['ls-tree',head,'--',file]).toString()),'Continuation input must remain an ordinary file');
  const file='scripts/test-local-release.mjs',before=read(['show',`${p.source}:${file}`]).toString(),after=read(['show',`${head}:${file}`]).toString();
  const entry="if(process.argv.includes('--incident-native-only')) {\n  assert.deepEqual(process.argv.slice(2),['--incident-native-only']);\n  await testIncidentNativeContinuation();process.exit(0);\n}\n\n",tail='\nasync function testIncidentNativeContinuation() {';
  assert.equal(after.split(entry).length,2);assert.equal(after.split(tail).length,2);
  assert.equal(after.split(tail)[0].replace(entry,''),before,'Already passed verifier assertions changed');
  assert(after.endsWith('\nawait testIncidentNativeContinuation();\n'));
}
export function incidentNativePrefix(bytes,current,read=gitBytes){
  const p=INCIDENT_NATIVE_PREFLIGHT,original=JSON.parse(bytes);assertIncidentNativeTree(current.sha,read);
  assert.equal(sha256(bytes),p.checkpoint,'Changed original failed launcher checkpoint');
  assert.equal(original.sha,p.source);assert.equal(original.status,'failed');assert.equal(original.commands.length,42);
  assert.deepEqual(original.preflightContinuation,{source:INCIDENT_WORKER_PREFLIGHT.source,checkpoint:INCIDENT_WORKER_PREFLIGHT.checkpoint});
  assert(!original.preflightProgress&&!original.permissionContinuation&&!original.repair);
  assert(original.commands.slice(0,41).every(row=>row.exitCode===0));
  assert.equal(original.commands[41].exitCode,1);assert.equal(original.commands[41].logHash,p.failedLog);assert.equal(original.commands[17].logHash,p.completedGuardLog);
  assert.equal(original.commands[17].continuation,incidentWorkerGuard(original.commands[17].command.run));
  assert.equal(original.commands[41].continuation,incidentWorkerContinuation(original.commands[41].command.run));
  for(const key of ['base','planHash'])assert.equal(original[key],current[key]);
  const environment=({reused,preparationMs,...rest})=>rest;assert.deepEqual(environment(original.environment),environment(current.environment),'Changed pinned execution environment');
  assert.equal(original.nativeBrowsers?.key,current.nativeBrowsers?.key);
  const flags=({files,reasons,...rest})=>rest;assert.deepEqual(flags(original.selection),flags(current.selection));
  assert.deepEqual(current.commands,selectedCommands(original.selection,{GITHUB_SHA:current.sha,CANDIDATE_BASE:current.base}),'Changed command closure');
  for(const index of p.retain)assert.deepEqual(original.commands[index].command,current.commands[index]);
  return original;
}
export function verifyIncidentLauncherUnion(before,after){
  assert.equal(before.length,35);assert.equal(new Set(before.map(row=>row.title)).size,35);
  assert.deepEqual(before.filter(row=>row.status!=='passed'),[{title:incidentLauncherFailure,status:'failed'}]);
  assert.deepEqual(after,[{title:incidentLauncherFailure,status:'passed'}],'Only the failed launcher must pass once; retained cases cannot repeat');
  return {launcherRetained:34,launcherFresh:1,launcherTotal:35};
}
export function verifyIncidentNativeRepair(directory,head,{allowPending=false}={}){
  const p=INCIDENT_NATIVE_PREFLIGHT;assertIncidentNativeTree(head);
  const pinned=(file,hash)=>{const bytes=fs.readFileSync(path.join(directory,file));assert.equal(sha256(bytes),hash,`Changed incident native evidence: ${file}`);return bytes;};
  const original=JSON.parse(pinned('reuse/preflight-checkpoint.json',p.checkpoint)),origin=path.join(directory,'reuse/incident-worker-origin');
  const prior=verifyIncidentWorkerRepair(origin,p.source);verifyIncidentWorkerSelection(origin,p.source);
  const commands=selectedCommands(original.selection,{GITHUB_SHA:original.sha,CANDIDATE_BASE:original.base});
  incidentWorkerPrefix(fs.readFileSync(path.join(origin,'reuse/preflight-checkpoint.json')),{...original,commands});
  verifyIncidentWorkerRecords(origin,original,commands,prior.original);
  pinned('reuse/incident-worker-origin/logs/17.log',p.completedGuardLog);
  for(const[file,hash]of Object.entries(p.reports))pinned('reuse/incident-worker-origin/test-results/'+file,hash);
  const log=pinned('reuse/preflight-failed.log',p.failedLog).toString();
  const marker='> test:q2-runtime\n> node --test tests/q2-recovery-staging.test.mjs scripts/test-q2-runtime-launcher.mjs && node scripts/test-q2-runtime.mjs\n';
  assert.equal(log.split(marker).length,2,'Missing exact unexecuted native boundary');const [prefix,launcher]=log.split(marker);
  assert.match(prefix,/\n\s+7 passed \(/);assert(prefix.includes('"originalPassed":1665,"progressPassed":7,"correctedPassed":0,"total":1672'));
  assert(prefix.includes('> test:homepage-ffmpeg-processor\n'));assert.match(prefix,/homepage ffmpeg processor tests passed/);assert.match(prefix,/Private video reference FFmpeg: .*passed\./);
  assert.match(launcher,/# tests 35\n# suites 0\n# pass 34\n# fail 1\n# cancelled 0\n# skipped 0\n# todo 0/);assert(!launcher.includes('q2LinuxEvidence'),'Native child was not executed');
  const before=tapResults(launcher);verifyIncidentLauncherUnion(before,[{title:incidentLauncherFailure,status:'passed'}]);
  const file=path.join(directory,'test-results/incident-native-worker-discovery.json');
  if(fs.existsSync(file)){const current=parseDiscovery(fs.readFileSync(file,'utf8'));assert.deepEqual(current.errors,[]);const identities=rows=>rows.map(({id,file,title})=>({id,file,title})).sort((a,b)=>a.id.localeCompare(b.id));assert.deepEqual(identities(workerDiscovery(current)),identities(prior.discovery),'Changed complete Worker discovery');}
  else assert(allowPending,'Missing current Worker discovery');
  if(allowPending)return{original,before,worker:prior.result};
  const fresh=fs.readFileSync(path.join(directory,'test-results/incident-launcher-fresh.tap'),'utf8');
  assert.match(fresh,/# tests 1\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0/);
  return{original,before,result:{...prior.result,...verifyIncidentLauncherUnion(before,tapResults(fresh))}};
}
export function incidentNativeGuard(command){assert.equal(command,'npm run test:local-release');return command+' -- --incident-native-only';}
export function incidentNativeContinuation(command){
  const scripts=JSON.parse(fs.readFileSync('package.json')).scripts;
  assert.equal(scripts['test:workers'],'node scripts/check-media-tools.mjs && npm run test:website-assistant && node scripts/check-q4-selection.mjs && playwright test -c playwright.workers.config.js && npm run test:homepage-ffmpeg-processor && npm run test:q2-runtime');
  assert.equal(scripts['test:q2-runtime'],'node --test tests/q2-recovery-staging.test.mjs scripts/test-q2-runtime-launcher.mjs && node scripts/test-q2-runtime.mjs');
  assert.equal(command.split('  npm run test:workers').length,2);assert(command.endsWith('else\n  npm run test:workers\nfi\n'));
  const fresh=[
    'mkdir -p .local-release/test-results',
    'PLAYWRIGHT_JSON_OUTPUT_NAME= npx playwright test -c playwright.workers.config.js --list --reporter=json > .local-release/test-results/incident-native-worker-discovery.json',
    'node scripts/local-release.mjs verify-incident-native-pending .local-release',
    `node --test --test-name-pattern='^${incidentLauncherFailure}$' scripts/test-q2-runtime-launcher.mjs > .local-release/test-results/incident-launcher-fresh.tap 2>&1 || { status=$?; cat .local-release/test-results/incident-launcher-fresh.tap; exit "$status"; }`,
    'cat .local-release/test-results/incident-launcher-fresh.tap',
    'node scripts/local-release.mjs verify-incident-native-repair .local-release',
    'node scripts/test-q2-runtime.mjs',
  ].map(line=>'  '+line).join('\n');return command.replace('  npm run test:workers',()=>fresh);
}
export function verifyIncidentNativeContinuation(directory,evidence,commands){
  const p=INCIDENT_NATIVE_PREFLIGHT;assert.deepEqual(evidence.preflightContinuation,{source:p.source,checkpoint:p.checkpoint});
  const original=incidentNativePrefix(fs.readFileSync(path.join(directory,'reuse/preflight-checkpoint.json')),{...evidence,commands});
  verifyIncidentNativeRepair(directory,evidence.sha);assert.equal(evidence.commands.length,commands.length,'Incomplete continued command closure');
  verifyIncidentNativeRecords(directory,evidence,commands,original);
}
function verifyIncidentNativeRecords(directory,evidence,commands,original){
  const p=INCIDENT_NATIVE_PREFLIGHT;
  for(const[i,row]of evidence.commands.entries()){
    if(p.retain.includes(i)){assert.deepEqual(row,{...original.commands[i],reusedFrom:original.commands[i].reusedFrom||p.source});assert.equal(sha256(fs.readFileSync(path.join(directory,row.log))),row.logHash);}
    else{assert(!row.reusedFrom&&!row.browserContinuation,'Affected/unexecuted command cannot inherit acceptance');
      if(i===17){assert.equal(row.continuation,incidentNativeGuard(commands[i].run));const log=fs.readFileSync(path.join(directory,row.log),'utf8');assert(log.includes('Incident native continuation: 1672 Worker, FFmpeg and 34 launcher passes retained; one launcher and the full native runtime remain mandatory.'));assert(!log.includes('Incident Worker continuation:')&&!log.includes('Local command mapping, no hosted duplicate suites'),'Passed guard groups repeated');}
      else if(i===41)assert.equal(row.continuation,incidentNativeContinuation(commands[i].run));
      else assert(!row.continuation,'Unreviewed continuation');
    }
  }
}

export function assertIncidentBrowserTree(head,read=gitBytes){
  const p=INCIDENT_BROWSER_PREFLIGHT;assertIncidentNativeTree(p.source,read);
  assert.deepEqual(read(['rev-list','--parents','-n','1',head]).toString().trim().split(/\s+/),[head,p.source],'Incident browser continuation requires the direct reviewed successor');
  const files=read(['diff','--name-only',p.source,head]).toString().trim().split('\n').filter(Boolean);
  assert(files.every(file=>[...Object.keys(p.specs),...reliabilityTools,'scripts/lib/local-release-browser.mjs'].includes(file)),'Incident browser continuation changed passed product, runtime or test inputs');
  for(const[file,hash]of Object.entries(p.specs)){assert(files.includes(file),'Missing reviewed browser correction');assert.equal(sha256(read(['show',`${head}:${file}`])),hash,'Unreviewed browser correction');}
  for(const file of files)assert(/^100644 blob [0-9a-f]{40}\t/.test(read(['ls-tree',head,'--',file]).toString()),'Continuation input must remain an ordinary file');
  const file='scripts/test-local-release.mjs',before=read(['show',`${p.source}:${file}`]).toString(),after=read(['show',`${head}:${file}`]).toString();
  const entry="if(process.argv.includes('--incident-browser-only')) {\n  assert.deepEqual(process.argv.slice(2),['--incident-browser-only']);\n  await testIncidentBrowserContinuation();process.exit(0);\n}\n\n",tail='\nasync function testIncidentBrowserContinuation() {';
  assert.equal(after.split(entry).length,2);assert.equal(after.split(tail).length,2);assert.equal(after.split(tail)[0].replace(entry,''),before,'Already passed verifier assertions changed');assert(after.endsWith('\nawait testIncidentBrowserContinuation();\n'));
}
export function incidentBrowserPrefix(bytes,current,read=gitBytes){
  const p=INCIDENT_BROWSER_PREFLIGHT,original=JSON.parse(bytes);assertIncidentBrowserTree(current.sha,read);
  assert.equal(sha256(bytes),p.checkpoint);assert.equal(original.sha,p.source);assert.equal(original.status,'failed');assert.equal(original.commands.length,50);
  assert.deepEqual(original.preflightContinuation,{source:INCIDENT_NATIVE_PREFLIGHT.source,checkpoint:INCIDENT_NATIVE_PREFLIGHT.checkpoint});assert(!original.preflightProgress&&!original.permissionContinuation&&!original.repair);
  assert(original.commands.slice(0,49).every(row=>row.exitCode===0));assert.equal(original.commands[49].exitCode,1);assert.equal(original.commands[49].logHash,p.failedLog);
  for(const key of ['base','planHash'])assert.equal(original[key],current[key]);
  const environment=({reused,preparationMs,...rest})=>rest;assert.deepEqual(environment(original.environment),environment(current.environment),'Changed pinned execution environment');assert.equal(original.nativeBrowsers?.key,current.nativeBrowsers?.key);
  const flags=({files,reasons,...rest})=>rest;assert.deepEqual(flags(original.selection),flags(current.selection));assert.deepEqual(current.commands,selectedCommands(original.selection,{GITHUB_SHA:current.sha,CANDIDATE_BASE:current.base}));
  for(const index of p.retain)assert.deepEqual(original.commands[index].command,current.commands[index]);return original;
}
export function verifyIncidentBrowserOrigin(directory,head){
  const p=INCIDENT_BROWSER_PREFLIGHT;assertIncidentBrowserTree(head);
  const pinned=(file,hash)=>{const bytes=fs.readFileSync(path.join(directory,file));assert.equal(sha256(bytes),hash,`Changed incident browser origin: ${file}`);return bytes;};
  const original=JSON.parse(pinned('reuse/preflight-checkpoint.json',p.checkpoint)),origin=path.join(directory,'reuse/incident-native-origin');
  pinned('reuse/preflight-failed.log',p.failedLog);
  const prior=verifyIncidentNativeRepair(origin,p.source),commands=selectedCommands(original.selection,{GITHUB_SHA:original.sha,CANDIDATE_BASE:original.base});
  incidentNativePrefix(fs.readFileSync(path.join(origin,'reuse/preflight-checkpoint.json')),{...original,commands});verifyIncidentNativeRecords(origin,original,commands,prior.original);
  for(const row of original.commands.slice(0,49))assert.equal(sha256(fs.readFileSync(path.join(origin,row.log))),row.logHash,'Changed retained completed command');
  pinned('reuse/incident-native-origin/logs/17.log',p.completedGuardLog);const native=pinned('reuse/incident-native-origin/logs/41.log',p.nativeLog).toString();
  for(const[file,hash]of Object.entries(p.nativeProof))pinned('reuse/incident-native-origin/'+file,hash);
  assert.equal(autonomyNativeRecords(origin,native).length,473);verifyNativeLocalReports(origin,fs.readFileSync(path.join(origin,'logs/40.log'),'utf8'),{preflight:true});
  const previous=browserRows(JSON.parse(pinned('reuse/model-browser-original.json',p.report)));assert.equal(sha256(JSON.stringify(previous)),p.rows);assert.equal(previous.length,p.required);
  const failures=previous.filter(row=>!passedBrowserCase(row));assert.equal(failures.length,5);assert.equal(failures.filter(row=>row.status==='flaky').length,1);assert(failures.every(row=>incidentBrowserAffectedTitles.includes(row.title)));
  const retained=modelBrowserRetained(previous,p);assert.equal(retained.size,654);assert.equal(previous.filter(row=>incidentBrowserAffectedTitles.includes(row.title)).length,8);
  const standard=browserRows(JSON.parse(pinned('reuse/model-browser-standard.json',p.standardDiscovery)),{discovery:true}),auth=standard.filter(row=>row.project==='chromium'&&(/^(auth-admin|wallet-nav|locale|oma2-q1-member)\.spec\.js$/.test(row.file)||row.file.startsWith('oma2-q3-')));
  assert.equal(sha256(JSON.stringify(auth)),p.authDiscovery);assert.equal(auth.length,709);const overlap=previous.filter(row=>auth.some(item=>item.key===row.key));assert.equal(overlap.length,25);assert(overlap.every(row=>row.file==='locale.spec.js'&&passedBrowserCase(row)));
  for(const[file,hash]of Object.entries(p.homepageReports))pinned('test-results/'+file,hash);
  const homepage=JSON.parse(fs.readFileSync(path.join(directory,'test-results/homepage-functional.json')));assert.deepEqual({expected:homepage.stats.expected,unexpected:homepage.stats.unexpected,flaky:homepage.stats.flaky,skipped:homepage.stats.skipped},{expected:45,unexpected:0,flaky:0,skipped:5});
  const manifest=JSON.parse(pinned('reuse/hosting-manifest.json',p.manifest));pinned('reuse/hosting-proof.json',p.proof);pinned('test-results/frontend-runtime.log',p.hostingLog);
  pinned('reuse/incident-native-origin/candidate/manifest.json',p.manifest);verifyMigrationCandidateBytes(origin,manifest,manifest,{allowLabGuard:false});
  return{original,previous,auth};
}
export function verifyIncidentBrowserReports(directory,head,{allowPending=false}={}){
  const p=INCIDENT_BROWSER_PREFLIGHT,origin=verifyIncidentBrowserOrigin(directory,head);if(allowPending)return{...origin,result:null};
  const result={};for(const scope of ['homepage','auth']){
    const prefix=scope==='auth'?'model-browser-auth':'model-browser',raw=JSON.parse(fs.readFileSync(path.join(directory,`test-results/${prefix}-fresh.json`)));
    assert.deepEqual(raw.errors,[]);assert.equal(raw.config.workers,1);assert(raw.config.projects.every(project=>project.retries===0));
    const discovery=browserRows(JSON.parse(fs.readFileSync(path.join(directory,`test-results/${prefix}-discovery.json`))),{discovery:true}),selected=browserRows(JSON.parse(fs.readFileSync(path.join(directory,`test-results/${prefix}-selected-discovery.json`))),{discovery:true});
    const report=JSON.parse(fs.readFileSync(path.join(directory,`test-results/candidate-${scope}.json`)));assert.equal(report.scope,scope);assert.deepEqual(report.previous,origin.previous);assert.deepEqual(report.discovery,discovery);assert.deepEqual(report.fresh,browserRows(raw));
    assert.deepEqual(selected,discovery.filter(row=>!modelBrowserRetained(origin.previous,p).has(row.key)));result[scope]=verifyModelBrowserReport(report,head);
  }assert.deepEqual(result,{homepage:{required:662,reused:654,executed:8},auth:{required:709,reused:25,executed:684}});return{...origin,result};
}
export const incidentBrowserContinuation=(command,scope='homepage')=>modelBrowserContinuation(command,scope).replace('model-browser-continuation','incident-browser-continuation');
export function incidentBrowserGuard(command){assert.equal(command,'npm run test:local-release');return command+' -- --incident-browser-only';}
export function verifyIncidentBrowserContinuation(directory,evidence,commands){
  const p=INCIDENT_BROWSER_PREFLIGHT;assert.deepEqual(evidence.preflightContinuation,{source:p.source,checkpoint:p.checkpoint});
  const original=incidentBrowserPrefix(fs.readFileSync(path.join(directory,'reuse/preflight-checkpoint.json')),{...evidence,commands});verifyIncidentBrowserReports(directory,evidence.sha);restoreCanvasHostingProof(directory,{verifyOnly:true});
  assert.equal(evidence.commands.length,commands.length);for(const[i,row]of evidence.commands.entries()){
    if(p.retain.includes(i)){assert.deepEqual(row,{...original.commands[i],reusedFrom:original.commands[i].reusedFrom||p.source});assert.equal(sha256(fs.readFileSync(path.join(directory,row.log))),row.logHash);}
    else{assert(!row.reusedFrom,'Affected/unexecuted command cannot inherit acceptance');if(i===17){assert.equal(row.continuation,incidentBrowserGuard(commands[i].run));const log=fs.readFileSync(path.join(directory,row.log),'utf8');assert(log.includes('Incident browser continuation: 654 homepage passes retained; eight changed consumers and 684 Auth cases required.'));assert(!log.includes('Incident native continuation:')&&!log.includes('Incident Worker continuation:'));}
      else if([49,50].includes(i)){assert.equal(row.browserContinuation,MODEL_BROWSER_POLICY);assert.equal(row.continuation,incidentBrowserContinuation(commands[i].run,i===50?'auth':'homepage'));}
      else assert(!row.continuation&&!row.browserContinuation,'Unreviewed continuation');
    }
  }
}

// Closed native-fixture continuation. Product/Worker/media inputs are identical;
// the original failed H3 source is retained as a real admission countercontrol.
export const MEDIA_COMPLETION_PREFLIGHT=Object.freeze({
  source:'193163f6f1b9c1b9cf6b458d95859a98c1a6e0aa',
  checkpoint:'42e1b554c882e04dcb15bd831f23a4746487e787d6fab36aa36773f36a232619',
  failedLog:'b4a4fe699f634f0ff6629faebec5e8e064a0e21eee4a782881de0a73b33933b5',
  fixture:'864c878c1dbdfa0d19af49b912414d98225df0b4ed1edf6b00392e9d0c6cf6be',
  nativeDirectory:'q2-runtime-evidence/native-stp4rg',
  nativeReport:'reports/bitbi-q2-runtime-TUnUE6__result.json',
  nativeHash:'5137da226a71bb7280b8c4dfb68018b37b4e63148a7d1ef8eb58ffdfacc436d0',
  retain:Object.freeze([1,5,6,7,8,9,10,11,13,18,19,20,21,22,24,25,26,27,30,31,32,38,39,40]),
});
// The follow-up changed only the missing launcher inventory and this closed
// continuation. All 1696 executed Worker cases and real media checks are pinned;
// the launcher and every native case still run on the corrected candidate.
export const MEDIA_WINDOW_PREFLIGHT=Object.freeze({
  source:'164985327f244caf614799e822b76854c85e28bd',
  checkpoint:'edcb61ba04f6aa16fcb942c7d78e8c3c4325bf37a0643a951f21e4229723449f',
  failedLog:'2af2c808787030066fe4e4fae5ab2b212337764f126d6f838645e4ac840817c8',
  fixture:'6e236cb88d8ea104537b9f774bc66b61af90772daf479a5a1aeae8539b935efb',
  retain:MEDIA_COMPLETION_PREFLIGHT.retain,
});
function mediaCompletionProfile(head,read=gitBytes){
  const parent=read(['rev-parse',`${head}^`]).toString().trim();
  const p=[MEDIA_COMPLETION_PREFLIGHT,MEDIA_WINDOW_PREFLIGHT].find(p=>p.source===parent);
  assert(p,'Unknown media continuation parent');return p;
}
export function assertMediaCompletionTree(head,read=gitBytes){
  const p=mediaCompletionProfile(head,read);
  assert.deepEqual(read(['rev-list','--parents','-n','1',head]).toString().trim().split(/\s+/),[head,p.source]);
  const files=read(['diff','--name-only',p.source,head]).toString().trim().split('\n');
  assert(files.every(file=>[p===MEDIA_WINDOW_PREFLIGHT?'scripts/test-q2-runtime-launcher.mjs':'tests/helpers/q2-runtime/canvas-reliability.mjs','scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs','scripts/test-local-release.mjs'].includes(file)),'Media continuation changed passed product or test inputs');
  assert.equal(sha256(read(['show',`${head}:${p===MEDIA_WINDOW_PREFLIGHT?'scripts/test-q2-runtime-launcher.mjs':'tests/helpers/q2-runtime/canvas-reliability.mjs'}`])),p.fixture,'Unreviewed native source fixture');
  for(const file of files)assert(/^100644 blob [0-9a-f]{40}\t/.test(read(['ls-tree',head,'--',file]).toString()));
  const file='scripts/test-local-release.mjs',before=read(['show',`${p.source}:${file}`]).toString(),after=read(['show',`${head}:${file}`]).toString();
  const name=p===MEDIA_WINDOW_PREFLIGHT?'media-window':'media-completion',fn=p===MEDIA_WINDOW_PREFLIGHT?'testMediaWindowContinuation':'testMediaCompletionContinuation';
  const entry=`if(process.argv.includes('--${name}-only')) {\n  assert.deepEqual(process.argv.slice(2),['--${name}-only']);\n  await ${fn}();process.exit(0);\n}\n\n`,tail=`\nasync function ${fn}() {`;
  assert.equal(after.split(entry).length,2);assert.equal(after.split(tail).length,2);
  assert.equal(after.split(tail)[0].replace(entry,''),before,'Previously passed verifier assertions changed');
  assert(after.endsWith(`\nawait ${fn}();\n`));
}
export function mediaCompletionPrefix(bytes,current,read=gitBytes){
  const p=mediaCompletionProfile(current.sha,read);assertMediaCompletionTree(current.sha,read);assert.equal(sha256(bytes),p.checkpoint);
  const original=JSON.parse(bytes);assert.equal(original.sha,p.source);assert.equal(original.status,'failed');
  assert(!original.preflightContinuation&&!original.permissionContinuation&&!original.repair);
  assert.equal(original.commands.length,42);assert(original.commands.slice(0,41).every(row=>row.exitCode===0));
  assert.equal(original.commands[41].exitCode,1);assert.equal(original.commands[41].logHash,p.failedLog);
  for(const key of ['base','planHash'])assert.equal(original[key],current[key]);
  const env=({reused,preparationMs,...rest})=>rest;assert.deepEqual(env(original.environment),env(current.environment));
  assert.equal(original.nativeBrowsers.key,current.nativeBrowsers.key);
  const flags=({files,reasons,...rest})=>rest;
  if(p===MEDIA_WINDOW_PREFLIGHT){assert.equal(original.selection.static,false);assert.equal(current.selection.static,true);assert.deepEqual({...flags(original.selection),static:true},flags(current.selection));}
  else assert.deepEqual(flags(original.selection),flags(current.selection));
  assert.deepEqual(current.commands,selectedCommands(original.selection,{GITHUB_SHA:current.sha,CANDIDATE_BASE:current.base}));
  for(const index of p.retain)assert.deepEqual(original.commands[index].command,current.commands[index]);
  return original;
}
export function verifyMediaCompletionNativeUnion(before,after){
  assert.equal(before.failedSuites,1);assert.equal(before.passed,470);
  const original=before.reports.find(row=>row.suite==='canvas-reliability');
  assert.deepEqual(original.failure,{stage:'canvas_reliability_media_completion_resume',name:'Error',message:'The next dependent video is admitted'});
  assert.equal(original.records.length,20);assert(original.records.every(row=>row.status==='PASS'));
  const retained=before.reports.filter(row=>row.suite!=='canvas-reliability');
  assert.equal(retained.reduce((sum,row)=>sum+row.records.length,0),450);
  assert(retained.every(row=>!row.failure&&row.records.every(record=>record.status==='PASS')));
  assert.equal(after.failedSuites,0);assert.equal(after.passed,42);assert.equal(after.reports.length,1);
  const fresh=after.reports[0];assert.equal(fresh.suite,'canvas-reliability');assert(!fresh.failure);assert.equal(fresh.records.length,42);
  assert(fresh.records.every(row=>row.status==='PASS'));const names=fresh.records.map(row=>row.name);assert.equal(new Set(names).size,42);
  assert.deepEqual(names.slice(0,20),original.records.map(row=>row.name));
  assert.deepEqual(names.slice(20),[
    ...['resume','automatic','lost-ack','missing-storage','edited','adopt-current','unknown','cancelled','expired','foreign'].map(name=>'canvas_reliability_media_completion_'+name),
    ...['fresh','resume','transient','bounded','unknown','guards','diagnostics','stored'].map(name=>'canvas_reliability_local_planning_'+name),
    ...['recover','guards','race','format'].map(name=>'canvas_reliability_plan_correction_review_'+name),
  ]);
  assert.equal(after.provenance.bundleSha256,before.provenance.bundleSha256,'Native application changed');
  assert.deepEqual(after.provenance.sourceLedger,before.provenance.sourceLedger);
  assert.equal(after.provenance.workerdBinarySha256,before.provenance.workerdBinarySha256);
  assert.deepEqual(after.provenance.migrations,before.provenance.migrations);
  return {nativeRetained:450,nativeFresh:42,nativeTotal:492,workerRetained:1694};
}
export function verifyMediaCompletionRepair(directory,head,{allowPending=false}={}){
  const p=mediaCompletionProfile(head);assertMediaCompletionTree(head);
  const pinned=(file,hash)=>{const raw=fs.readFileSync(path.join(directory,file));assert.equal(sha256(raw),hash,`Changed media completion evidence: ${file}`);return raw;};
  const original=JSON.parse(pinned('reuse/preflight-checkpoint.json',p.checkpoint));
  const log=pinned('reuse/preflight-failed.log',p.failedLog).toString();
  if(p===MEDIA_WINDOW_PREFLIGHT){
    assert.match(log,/\n\s+1696 passed \(/);assert(!/\d+ failed \(/.test(log));
    assert(log.includes('homepage ffmpeg processor tests passed')&&log.includes('Private video reference FFmpeg:'));
    assert.match(log,/# tests 35\n# suites 0\n# pass 34\n# fail 1\n# cancelled 0\n# skipped 0\n# todo 0/);
    assert(log.includes('not ok 29 - Canvas reliability runs additive native callers with the complete staged helper graph'));
    if(allowPending)return{original,workerRetained:1696};
    const fresh=fs.readFileSync(path.join(directory,'test-results/media-completion-native.log'),'utf8');
    assert.match(fresh,/# tests 35\n# suites 0\n# pass 35\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0/);
    verifyNativeLocalReports(directory,fresh);
    const refs=fresh.split('\n').flatMap(line=>{try{const row=JSON.parse(line);return row.q2LinuxEvidence?[row.q2LinuxEvidence]:[];}catch{return [];}});assert.equal(refs.length,1);
    const folder=path.join(directory,'runtime',refs[0].slice('/tmp/bitbi-release/'.length)),entry=JSON.parse(fs.readFileSync(path.join(folder,'launcher-result.json')));
    assert.equal(entry.hostedImage.GITHUB_SHA,head);
    const reports=path.join(folder,'reports'),files=fs.readdirSync(reports).filter(file=>file==='result.json'||file.endsWith('__result.json'));assert.equal(files.length,1);
    const result=JSON.parse(fs.readFileSync(path.join(reports,files[0])));
    assert.equal(result.failedSuites,0);assert.equal(result.passed,494);
    const reliability=result.reports.find(row=>row.suite==='canvas-reliability');assert.equal(reliability.records.length,44);
    for(const name of ['completion-window','proof-recheck'])assert(reliability.records.some(row=>row.name==='canvas_reliability_media_completion_'+name&&row.status==='PASS'));
    return{original,result:{workerRetained:1696,nativeFresh:494,launcherFresh:35}};
  }
  assert.match(log,/\n\s+1694 passed \(/);assert(!/\d+ failed \(/.test(log));
  assert(log.includes('homepage ffmpeg processor tests passed')&&log.includes('Private video reference FFmpeg:'));
  assert.match(log,/# tests 35\n# suites 0\n# pass 35\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0/);
  const before=JSON.parse(pinned('reuse/media-native/'+p.nativeReport,p.nativeHash));
  if(allowPending)return{original,before};
  const freshLog=fs.readFileSync(path.join(directory,'test-results/media-completion-native.log'),'utf8');verifyNativeLocalReports(directory,freshLog);
  const refs=freshLog.split('\n').flatMap(line=>{try{const row=JSON.parse(line);return row.q2LinuxEvidence?[row.q2LinuxEvidence]:[];}catch{return [];}});assert.equal(refs.length,1);
  const folder=path.join(directory,'runtime',refs[0].slice('/tmp/bitbi-release/'.length));
  const entry=JSON.parse(fs.readFileSync(path.join(folder,'launcher-result.json')));assert.equal(entry.hostedImage.GITHUB_SHA,head);
  const reports=path.join(folder,'reports'),files=fs.readdirSync(reports).filter(file=>file==='result.json'||file.endsWith('__result.json'));assert.equal(files.length,1);
  return{original,result:verifyMediaCompletionNativeUnion(before,JSON.parse(fs.readFileSync(path.join(reports,files[0]))))};
}
export function mediaCompletionGuard(command,source=MEDIA_COMPLETION_PREFLIGHT.source){assert.equal(command,'npm run test:local-release');assert([MEDIA_COMPLETION_PREFLIGHT.source,MEDIA_WINDOW_PREFLIGHT.source].includes(source));return command+(source===MEDIA_WINDOW_PREFLIGHT.source?' -- --media-window-only':' -- --media-completion-only');}
export function mediaCompletionContinuation(command,source=MEDIA_COMPLETION_PREFLIGHT.source){
  assert([MEDIA_COMPLETION_PREFLIGHT.source,MEDIA_WINDOW_PREFLIGHT.source].includes(source));
  assert.equal(command.split('  npm run test:workers').length,2);assert(command.endsWith('else\n  npm run test:workers\nfi\n'));
  const verify=pending=>`node --input-type=module -e 'import{execFileSync}from"node:child_process";import{verifyMediaCompletionRepair}from"./scripts/lib/local-release-evidence.mjs";console.log(JSON.stringify(verifyMediaCompletionRepair(".local-release",execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),{allowPending:${pending}}).result||${JSON.stringify(source===MEDIA_WINDOW_PREFLIGHT.source?{workerRetained:1696,nativePending:494}:{workerRetained:1694,nativePending:42})}));'`;
  return command.replace('  npm run test:workers',()=>[
    'mkdir -p .local-release/test-results',verify(true),
    source===MEDIA_WINDOW_PREFLIGHT.source?'npm run test:q2-runtime > .local-release/test-results/media-completion-native.log 2>&1 || { status=$?; cat .local-release/test-results/media-completion-native.log; exit "$status"; }':'node scripts/test-q2-runtime.mjs --suite canvas-reliability > .local-release/test-results/media-completion-native.log 2>&1 || { status=$?; cat .local-release/test-results/media-completion-native.log; exit "$status"; }',
    'cat .local-release/test-results/media-completion-native.log',
    // Runtime reports are collected by the ordinary release lifecycle after the
    // command; the final verifier checks the union and candidate source then.
  ].map(line=>'  '+line).join('\n'));
}
export function verifyMediaCompletionContinuation(directory,evidence,commands){
  const p=mediaCompletionProfile(evidence.sha);assert.deepEqual(evidence.preflightContinuation,{source:p.source,checkpoint:p.checkpoint});
  const original=mediaCompletionPrefix(fs.readFileSync(path.join(directory,'reuse/preflight-checkpoint.json')),{...evidence,commands});
  verifyMediaCompletionRepair(directory,evidence.sha);assert.equal(evidence.commands.length,commands.length);
  for(const[i,row]of evidence.commands.entries()){
    if(p.retain.includes(i)){assert.deepEqual(row,{...original.commands[i],reusedFrom:p.source});assert.equal(sha256(fs.readFileSync(path.join(directory,row.log))),row.logHash);}
    else{assert(!row.reusedFrom&&!row.browserContinuation);if(i===17)assert.equal(row.continuation,mediaCompletionGuard(commands[i].run,p.source));else if(i===41)assert.equal(row.continuation,mediaCompletionContinuation(commands[i].run,p.source));else assert(!row.continuation);}
  }
}
