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
import { LOCAL_BROWSER_POLICY, readMigrationBrowserPool } from './local-release-browser.mjs';

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
export function assertPermissionContinuationTree(head,read=gitBytes) {
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
  const tail=original.sha===p.tail,last=tail?41:36;
  assert.equal(sha256(bytes),tail?p.tailCheckpoint:p.checkpoint,'Changed original failed permission checkpoint');
  assert.equal(original.sha,tail?p.tail:p.source);assert.equal(original.status,'failed');assert.equal(original.commands.length,last+1);
  assert(original.commands.slice(0,last).every(row=>row.exitCode===0));assert.equal(original.commands[last].exitCode,1);
  assert.equal(original.commands[last].command.name,tail?'Run worker route tests':'Check frontend hosting package');
  assert.equal(original.base,base);assert.equal(original.planHash,planHash);assert.equal(original.environment.key,environment.key);
  for(const [i,row] of original.commands.entries())assert.deepEqual(JSON.parse(JSON.stringify(row.command).replaceAll(original.sha,head)),commands[i],'Changed selected command');
  return original;
}
function verifyPermissionContinuation(directory,evidence,commands) {
  const p=PERMISSION_CONTINUATION;assertPermissionContinuationTree(evidence.sha);
  const tail=evidence.permissionContinuation.source===p.tail;
  assert.deepEqual(evidence.permissionContinuation,{source:tail?p.tail:p.source,checkpoint:tail?p.tailCheckpoint:p.checkpoint});assert(!evidence.repair);
  const original=permissionContinuationPrefix(fs.readFileSync(path.join(directory,'reuse/permission-checkpoint.json')),{...evidence,head:evidence.sha,commands});
  for(const [i,row] of evidence.commands.entries()) {
    if(i<(tail?41:36)&&!PERMISSION_REFRESH.has(i)) {
      assert.equal(row.reusedFrom,original.commands[i].reusedFrom||original.sha);
      assert.deepEqual({...row,command:original.commands[i].command,reusedFrom:undefined},{...original.commands[i],reusedFrom:undefined},'Changed retained passing execution');
      assert.equal(sha256(fs.readFileSync(path.join(directory,row.log))),original.commands[i].logHash);
    }else assert(!row.reusedFrom&&(!row.continuation||tail&&i===41),'Affected or unexecuted command cannot inherit a pass');
  }
  if(tail) {
    const before=fs.readFileSync(path.join(directory,'reuse/stage-failed.log'),'utf8');assert.equal(sha256(before),p.tailLog);
    assert.equal(evidence.commands[41].continuation,canvasStageContinuation(commands[41].run));
    verifyNativeCaseUnion(tapResults(before),tapResults(fs.readFileSync(path.join(directory,'logs/41.log'),'utf8')),CANVAS_STAGE_CASES);
    restoreCanvasHostingProof(directory,{verifyOnly:true});
  }
}
export function restoreCanvasHostingProof(directory,{verifyOnly=false}={}) {
  const p=PERMISSION_CONTINUATION,read=(file,hash)=>{const bytes=fs.readFileSync(path.join(directory,'reuse',file));assert.equal(sha256(bytes),hash);return JSON.parse(bytes);};
  const original=read('hosting-manifest.json',p.manifest),oldProof=read('hosting-proof.json',p.proof);
  const manifest=JSON.parse(fs.readFileSync(path.join(directory,'candidate/manifest.json')));
  verifyMigrationCandidateBytes(directory,original,manifest,{allowLabGuard:false});assert.deepEqual(manifest.hosting,original.hosting);
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
    const match=line.match(/^\s+([✓✘])\s+\d+\s+(tests\/.*?)\s+\([\d.]+(?:ms|s|m)\)\s*$/);
    if(!match)continue;
    const retry=match[2].match(/ \(retry #(\d+)\)$/),label=match[2].replace(/ \(retry #\d+\)$/,'');
    const row=byLabel.get(label);assert(row,`Undiscovered Worker result: ${label}`);
    const runs=results.get(row.id)||[];runs.push({status:match[1]==='✓'?'passed':'failed',retry:retry?Number(retry[1]):0});results.set(row.id,runs);
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

export function verifyMigrationCandidateBytes(directory,oldManifest,manifest,{allowLabGuard=true}={}) {
  assert.deepEqual(Object.keys(manifest.files),Object.keys(oldManifest.files),'Candidate membership changed');
  const oldToken=oldManifest.sha.slice(0,12),newToken=manifest.sha.slice(0,12);
  for(const [file,hash]of Object.entries(oldManifest.files)) {
    const bytes=fs.readFileSync(path.join(directory,'candidate/site',file));
    assert.equal(sha256(bytes),manifest.files[file],'Final candidate bytes changed');
    if(sha256(bytes)===hash)continue;
    let normalized=bytes.toString().replaceAll(`?v=${newToken}`,`?v=${oldToken}`);
    if(file==='js/pages/admin/ai-lab.js')normalized=normalized.replace(`const ADMIN_AI_UI_VERSION = '${newToken}';`,`const ADMIN_AI_UI_VERSION = '${oldToken}';`);
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
  if(evidence.permissionContinuation)verifyPermissionContinuation(directory,evidence,commands);
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
