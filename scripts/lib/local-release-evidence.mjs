import {canvasPolicyPrefix,canvasPolicyTailInventory} from '../../tests/helpers/q2-runtime/canvas-policy-tail.mjs';
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
import { AUTONOMY_BROWSER_WORKER_PROGRESS, isAutonomyBrowserWorkerProgress, AUTONOMY_BROWSER_DOC_PROGRESS, isAutonomyBrowserDocProgress, AUTONOMY_BROWSER_PROGRESS, isAutonomyBrowserProgress, AUTONOMY_BROWSER_POLICY, AUTONOMY_BROWSER_PREFLIGHT, assertAutonomyBrowserTree, verifyAutonomyBrowserReport, verifyAutonomyImageReuse, MODEL_BROWSER_POLICY, MODEL_BROWSER_PREFLIGHT, verifyModelBrowserReport, LOCAL_BROWSER_POLICY, readMigrationBrowserPool, SMOOTH_BROWSER_POLICY, SMOOTH_BROWSER_CONTINUATION, EXAMPLE_CACHE_CONTINUATION, WORKSPACE_CONTINUATION, AUDIO_FIT_CONTINUATION, INSPECTOR_CONTINUATION,EXPORT_BROWSER_CONTINUATION, smoothProfile, isSmoothContinuation, assertSmoothContinuationTree, verifySmoothBrowserReport, restoreSmoothBrowserProof } from './local-release-browser.mjs';
export {AUTONOMY_BROWSER_WORKER_PROGRESS,AUTONOMY_BROWSER_DOC_PROGRESS,AUTONOMY_BROWSER_PROGRESS,AUTONOMY_BROWSER_PREFLIGHT,MODEL_BROWSER_PREFLIGHT} from './local-release-browser.mjs';

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
  const p=source===SETTLEMENT_NATIVE_PROGRESS.source?{...SETTLEMENT_NATIVE_PROGRESS,tail:source}:source===SETTLEMENT_NATIVE_PREFLIGHT.source?{...SETTLEMENT_NATIVE_PREFLIGHT,tail:source}:source===CANVAS_POLICY_NATIVE_PREFLIGHT.source?{...CANVAS_POLICY_NATIVE_PREFLIGHT,tail:source}:source===CANVAS_POLICY_WORKER_PREFLIGHT.source?{...CANVAS_POLICY_WORKER_PREFLIGHT,tail:source}:source===AUTONOMY_BROWSER_PREFLIGHT.source?{...AUTONOMY_BROWSER_PREFLIGHT,tail:source}:source===AUTONOMY_NATIVE_PREFLIGHT.source?{...AUTONOMY_NATIVE_PREFLIGHT,tail:source}:source===MODEL_BROWSER_PREFLIGHT.source?{...MODEL_BROWSER_PREFLIGHT,tail:source}:source===EXAMPLE_BROWSER_PREFLIGHT.source?{...EXAMPLE_BROWSER_PREFLIGHT,tail:source}:[EXAMPLE_CACHE_CONTINUATION.source,EXPORT_BROWSER_CONTINUATION.source,WORKSPACE_CONTINUATION.source,AUDIO_FIT_CONTINUATION.source,INSPECTOR_CONTINUATION.source].includes(source)?{...smoothProfile(source),tail:source}:PERMISSION_CONTINUATION,read=(file,hash)=>{const bytes=fs.readFileSync(path.join(directory,'reuse',file));assert.equal(sha256(bytes),hash);return JSON.parse(bytes);};
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
  if(evidence.preflightContinuation)verifyCanvasPreflight(directory,evidence,commands);
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
    else if(evidence.preflightContinuation?.source===AUTONOMY_BROWSER_PREFLIGHT.source&&['Run selected homepage core tests','Run selected auth and admin tests'].includes(command.name))assert.equal(result.browserContinuation,AUTONOMY_BROWSER_POLICY);
    else if(evidence.preflightContinuation?.source===MODEL_BROWSER_PREFLIGHT.source&&['Run selected homepage core tests','Run selected auth and admin tests'].includes(command.name))assert.equal(result.browserContinuation,MODEL_BROWSER_POLICY);
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
export function verifyModelBrowserRepair(directory,head,{allowPending=false}={}) {
  const p=MODEL_BROWSER_PREFLIGHT;assertCanvasPreflightTree(head,gitBytes,p);
  const pinned=(file,hash)=>{const bytes=fs.readFileSync(path.join(directory,'reuse',file));assert.equal(sha256(bytes),hash,`Changed original browser evidence: ${file}`);return bytes;};
  const original=JSON.parse(pinned('preflight-checkpoint.json',p.checkpoint));
  assert.equal(original.sha,p.source);assert.equal(original.status,'failed');assert.equal(original.commands.length,50);
  assert(original.commands.slice(0,49).every(row=>row.exitCode===0));assert.equal(original.commands[49].exitCode,1);
  pinned('preflight-failed.log',p.failedLog);
  const origin=path.join(directory,'reuse/model-worker-origin');
  verifyCanvasPreflight(origin,original,selectedCommands(original.selection,{GITHUB_SHA:original.sha,CANDIDATE_BASE:original.base}));
  for(const row of original.commands.slice(0,49))assert.equal(sha256(fs.readFileSync(path.join(origin,row.log))),row.logHash,'Changed retained upstream execution log');
  const previous=browserRows(JSON.parse(pinned('model-browser-original.json',p.report)));
  assert.equal(sha256(JSON.stringify(previous)),p.rows);assert.equal(previous.length,p.required);
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
export const canvasPreflightProfile=source=>[SETTLEMENT_NATIVE_PROGRESS,SETTLEMENT_NATIVE_PREFLIGHT,SETTLEMENT_HOSTING_PREFLIGHT,SETTLEMENT_PREFLIGHT,CANVAS_POLICY_NATIVE_PREFLIGHT,CANVAS_POLICY_WORKER_PREFLIGHT,AUTONOMY_BROWSER_PREFLIGHT,AUTONOMY_NATIVE_PREFLIGHT,CANVAS_PREFLIGHT,EXPORT_PREFLIGHT,EXPORT_NATIVE_PREFLIGHT,EXPORT_MEDIA_PREFLIGHT,EXAMPLE_PREFLIGHT,EXAMPLE_BROWSER_PREFLIGHT,MODEL_OPERATION_PREFLIGHT,MODEL_SELECTION_PREFLIGHT,MODEL_WORKFLOW_PREFLIGHT,MODEL_WORKER_PREFLIGHT,MODEL_BROWSER_PREFLIGHT].find(p=>p.source===source)||null;
export function assertCanvasPreflightTree(head,read=gitBytes,profile=CANVAS_PREFLIGHT){
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
export function canvasPreflightPrefix(bytes,{sha,base,planHash,environment,commands,selection},read=gitBytes){
  const original=JSON.parse(bytes),profile=canvasPreflightProfile(original.sha)||CANVAS_PREFLIGHT;
  assertCanvasPreflightTree(sha,read,profile);assert.equal(sha256(bytes),profile.checkpoint,'Changed failed preflight checkpoint');
  assert.equal(original.sha,profile.source);assert.equal(original.status,'failed');
  assert.equal(original.base,base);assert.equal(original.planHash,planHash);assert.equal(original.environment.key,environment.key);
  assert.equal(original.commands.length,profile===AUTONOMY_BROWSER_PREFLIGHT?51:profile===MODEL_BROWSER_PREFLIGHT?50:profile===MODEL_WORKER_PREFLIGHT?42:[SETTLEMENT_NATIVE_PROGRESS,SETTLEMENT_NATIVE_PREFLIGHT].includes(profile)?42:profile===SETTLEMENT_HOSTING_PREFLIGHT?37:[SETTLEMENT_PREFLIGHT,MODEL_WORKFLOW_PREFLIGHT].includes(profile)?18:profile===MODEL_SELECTION_PREFLIGHT?17:profile===MODEL_OPERATION_PREFLIGHT?14:profile===EXAMPLE_BROWSER_PREFLIGHT?42:profile===EXAMPLE_PREFLIGHT?18:profile===EXPORT_PREFLIGHT?16:profile===EXPORT_MEDIA_PREFLIGHT?43:42);assert.equal(original.commands[profile===AUTONOMY_BROWSER_PREFLIGHT?50:profile===MODEL_BROWSER_PREFLIGHT?49:profile===MODEL_WORKER_PREFLIGHT?41:[SETTLEMENT_NATIVE_PROGRESS,SETTLEMENT_NATIVE_PREFLIGHT].includes(profile)?41:profile===SETTLEMENT_HOSTING_PREFLIGHT?36:[SETTLEMENT_PREFLIGHT,MODEL_WORKFLOW_PREFLIGHT].includes(profile)?17:profile===MODEL_SELECTION_PREFLIGHT?16:profile===MODEL_OPERATION_PREFLIGHT?13:profile===EXAMPLE_BROWSER_PREFLIGHT?41:profile===EXAMPLE_PREFLIGHT?17:profile===EXPORT_PREFLIGHT?15:profile===EXPORT_MEDIA_PREFLIGHT?42:41].exitCode,1);
  if(profile===SETTLEMENT_PREFLIGHT){
    assert(!original.preflightContinuation&&!original.preflightProgress&&!original.permissionContinuation&&!original.repair,'Unexpected earlier settlement continuation');
    assert(original.commands.slice(0,17).every(row=>row.exitCode===0&&!row.reusedFrom&&!row.continuation),'Original passing prefix changed');
    assert.equal(original.commands[17].command.name,'Test local release evidence and orchestration');
    assert.equal(original.commands[17].logHash,profile.failedLog,'Changed original failed verifier');
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
  if(profile===MODEL_SELECTION_PREFLIGHT)assert.deepEqual(original.preflightContinuation,{source:MODEL_OPERATION_PREFLIGHT.source,checkpoint:MODEL_OPERATION_PREFLIGHT.checkpoint},'Missing original preflight chain');
  if(profile===MODEL_WORKFLOW_PREFLIGHT)assert.deepEqual(original.preflightContinuation,{source:MODEL_SELECTION_PREFLIGHT.source,checkpoint:MODEL_SELECTION_PREFLIGHT.checkpoint},'Missing original preflight chain');
  if(profile===MODEL_WORKER_PREFLIGHT)assert.deepEqual(original.preflightContinuation,{source:MODEL_WORKFLOW_PREFLIGHT.source,checkpoint:MODEL_WORKFLOW_PREFLIGHT.checkpoint},'Missing original preflight chain');
  if(profile===AUTONOMY_BROWSER_PREFLIGHT)assert.deepEqual(original.preflightContinuation,{source:AUTONOMY_NATIVE_PREFLIGHT.source,checkpoint:AUTONOMY_NATIVE_PREFLIGHT.checkpoint},'Missing original preflight chain');
  if(profile===MODEL_BROWSER_PREFLIGHT)assert.deepEqual(original.preflightContinuation,{source:MODEL_WORKER_PREFLIGHT.source,checkpoint:MODEL_WORKER_PREFLIGHT.checkpoint},'Missing original preflight chain');
  if([SETTLEMENT_NATIVE_PROGRESS,SETTLEMENT_NATIVE_PREFLIGHT,SETTLEMENT_HOSTING_PREFLIGHT,SETTLEMENT_PREFLIGHT,CANVAS_POLICY_NATIVE_PREFLIGHT,CANVAS_POLICY_WORKER_PREFLIGHT,MODEL_OPERATION_PREFLIGHT,MODEL_SELECTION_PREFLIGHT,MODEL_WORKFLOW_PREFLIGHT,MODEL_WORKER_PREFLIGHT,MODEL_BROWSER_PREFLIGHT].includes(profile)){
    const flags=({files,reasons,...metadata})=>metadata;
    assert.deepEqual(flags(selection),flags(original.selection),'Changed selection cannot inherit preflight evidence');
    assert.equal(environment.image,original.environment.image,'Changed execution image');
    if([SETTLEMENT_NATIVE_PROGRESS,SETTLEMENT_NATIVE_PREFLIGHT,SETTLEMENT_HOSTING_PREFLIGHT,SETTLEMENT_PREFLIGHT,CANVAS_POLICY_NATIVE_PREFLIGHT,CANVAS_POLICY_WORKER_PREFLIGHT].includes(profile))assert.deepEqual(environment.inputs,original.environment.inputs,'Changed execution inputs');
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
  if([SETTLEMENT_NATIVE_PROGRESS,SETTLEMENT_NATIVE_PREFLIGHT,SETTLEMENT_HOSTING_PREFLIGHT,SETTLEMENT_PREFLIGHT,CANVAS_POLICY_NATIVE_PREFLIGHT,CANVAS_POLICY_WORKER_PREFLIGHT,MODEL_OPERATION_PREFLIGHT,MODEL_SELECTION_PREFLIGHT,MODEL_WORKFLOW_PREFLIGHT,MODEL_WORKER_PREFLIGHT,MODEL_BROWSER_PREFLIGHT].includes(profile))assert.equal(sha256(fs.readFileSync(path.join(directory,'reuse/preflight-failed.log'))),profile.failedLog,'Changed original failed preflight log');
  if(profile===AUTONOMY_NATIVE_PREFLIGHT){
    verifyAutonomyNativeRepair(directory,evidence.sha);restoreCanvasHostingProof(directory,{verifyOnly:true});
    assert.equal(sha256(fs.readFileSync(path.join(directory,'test-results/frontend-runtime.log'))),profile.hostingLog,'Changed retained hosting log');
  }
  if(profile===AUTONOMY_BROWSER_PREFLIGHT){verifyAutonomyBrowserRepair(directory,evidence.sha);restoreCanvasHostingProof(directory,{verifyOnly:true});}
  if(profile===MODEL_BROWSER_PREFLIGHT){verifyModelBrowserRepair(directory,evidence.sha);restoreCanvasHostingProof(directory,{verifyOnly:true});}
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
