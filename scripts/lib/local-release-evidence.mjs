// Local execution is trusted only through authenticated repository-writer
// transport, exact committed inputs and complete command/report/candidate hashes.
// It does not grant environment approval or authorize a production write.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { LOCAL_POLICY, selectedCommands, validationPlan, sha256 } from './local-release-plan.mjs';
import { environmentInputs, environmentKey, toolchainPins } from './local-release-environment.mjs';
import { gitSelection, tree, verifyManifest, verifyProofs, candidateProof, proofJobs, REPOSITORY } from '../pages-candidate.mjs';
import { verifyFrontend } from './frontend-hosting.mjs';
import { browserRows } from './browser-fixture-repair.mjs';

export const LOCAL_REQUIRED_JOBS = { 'release-compatibility': [
  'Preflight complete static release plan', 'Select tests from changed files',
  'Verify local release evidence and candidate bytes', 'Upload immutable candidate build',
] };
export function localPolicyAt(sha) {
  if (!/^[a-f0-9]{40}$/.test(sha || '')) return false;
  try { return execFileSync('git', ['show', `${sha}:config/release-validation.yml`], { encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }).includes('version: 1'); }
  catch { return false; }
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
  tailSource:'ed7a7d6a6084b79aabcff903f7cc66698f8e0c86',
  tailCheckpoint:'38f1757fa3b5e8134c65b5c89f11cbcd06c8495461cd99b6b29a1395c797a29f',
  tailLog:'a4905f85e7c5c5a3c19f37a8c30479f35f5459c617ebd4e4d34ebae52e2ac114',
  specs: {
    'scripts/test-q2-runtime-launcher.mjs':'195741c2c1decc256225dcdcc2b3dbd64e9bee37439661544a1c00d45617badc',
    'tests/admin-model-status.spec.js':'7c0a013cff629249a73148363f9304322e07c4c635b5bbf0c8ac00d12c4c8a64',
    'tests/appearance.spec.js':'4344d83d6712d4348b5b37db72e2bee024684891ff74a6eaa8c033890cc0d4e4',
    'tests/workers.spec.js':'e4bff15e0ce29398175e7d88e007029e853c7fb90751e7a766d0e1bcc3e0133d',
  },
});
export const LOCAL_REPAIR_REFRESH = new Set([0,3,4,13,18,32,33,35,42]);
const repairTooling = new Set(['scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs','scripts/test-local-release.mjs',
  'AGENTS.md','docs/production-readiness/MAIN_ONLY_RELEASE_RUNBOOK.md','docs/runbooks/REGRESSION_REGISTER.md']);
const gitBytes=(args)=>execFileSync('git',args,{stdio:['ignore','pipe','pipe'],maxBuffer:64*1024*1024});
export function assertLocalRepairTree(head) {
  const p=LOCAL_WORKER_REPAIR;
  gitBytes(['merge-base','--is-ancestor',p.corrected,head]);
  const changed=gitBytes(['diff','--name-only',p.source,head]).toString().trim().split('\n').filter(Boolean);
  assert(changed.every(file=>repairTooling.has(file)||Object.hasOwn(p.specs,file)), 'Changed product/toolchain/shared fixture cannot inherit local passes');
  for(const [file,hash] of Object.entries(p.specs))assert.equal(sha256(gitBytes(['show',`${head}:${file}`])),hash,'Changed fixture outside the closed repair');
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
export function verifyNativeCaseUnion(before,after) {
  assert.equal(before.length,27);assert.equal(new Set(before.map(row=>row.title)).size,27);
  assert.deepEqual(before.filter(row=>row.status!=='passed').map(row=>row.title),NATIVE_REPAIRED_CASES);
  const executed=after.filter(row=>row.status!=='skipped');
  assert.deepEqual(executed.map(row=>row.title),NATIVE_REPAIRED_CASES);
  assert(executed.every(row=>row.status==='passed'),'Corrected launcher contract failed');
  assert(after.every(row=>before.some(old=>old.title===row.title)),'Foreign launcher test result');
  assert.equal(new Set(after.map(row=>row.title)).size,after.length,'Duplicate launcher result');
}
export function verifyLocalReuse(directory,evidence) {
  const {original}=verifyLocalWorkerRepair(directory,evidence.sha);
  verifyNativeCaseUnion(tapResults(fs.readFileSync(path.join(directory,'reuse/tail.log'),'utf8')),tapResults(fs.readFileSync(path.join(directory,evidence.commands[42].log),'utf8')));
  assert.equal(evidence.repair?.source,original.sha);assert.equal(evidence.repair?.checkpoint,LOCAL_WORKER_REPAIR.checkpoint);
  assert.equal(evidence.base,original.base);assert.equal(evidence.startedAt,original.startedAt);
  assert.deepEqual(evidence.environment.inputs,original.environment.inputs);
  assert.equal(evidence.environment.image,original.environment.image);
  assert.equal(evidence.planHash,original.planHash);
  assert.equal(evidence.commands[18].supplement,'npm run test:local-release -- --repair-only');
  assert.equal(sha256(fs.readFileSync(path.join(directory,'reuse/local-contract.log'))),original.commands[18].logHash);
  const oldSelection={...original.selection},newSelection={...evidence.selection};
  // The retained Worker fixture file also selects independent Auth browser
  // acceptance under the unchanged selector. That new downstream job must run.
  assert.equal(oldSelection.auth,false);assert.equal(newSelection.auth,true);oldSelection.auth=true;
  for(const selection of [oldSelection,newSelection]){delete selection.files;delete selection.reasons;}
  assert.deepEqual(oldSelection,newSelection,'Changed selected scope cannot reuse local commands');
  for(const [index,result] of evidence.commands.entries()) {
    const prior=original.commands[index];
    if(index===42){assert.equal(result.continuation,localWorkerContinuation());continue;}
    if(LOCAL_REPAIR_REFRESH.has(index)||index>=43){assert(!result.reusedFrom,'Changed-input check requires fresh execution');continue;}
    assert.equal(result.reusedFrom,original.sha,'Missing original command identity');
    assert.equal(result.exitCode,0);assert.equal(prior.exitCode,0);
    assert.equal(result.logHash,prior.logHash);assert.equal(result.durationMs,prior.durationMs);
    assert.deepEqual(result.command,JSON.parse(JSON.stringify(prior.command).replaceAll(original.sha,evidence.sha)),'Changed retained command');
  }
  const oldManifest=JSON.parse(fs.readFileSync(path.join(directory,'reuse/manifest.json')));
  const manifest=JSON.parse(fs.readFileSync(path.join(directory,'candidate/manifest.json')));
  verifyManifest(oldManifest,{sha:original.sha,base:original.base,run:original.id,attempt:'1',selection:original.selection},path.join(directory,'candidate/site'));
  assert.deepEqual(manifest.files,oldManifest.files);assert.deepEqual(manifest.hosting,oldManifest.hosting,'Changed frontend runtime cannot reuse a proof');
  const proof=JSON.parse(fs.readFileSync(path.join(directory,'candidate/proof-frontend-runtime.json')));
  const oldProof=JSON.parse(fs.readFileSync(path.join(directory,'reuse/proof-frontend-runtime.json')));
  assert.deepEqual(proof,{...oldProof,manifestHash:sha256(JSON.stringify(manifest)),reusedFrom:{sha:original.sha,manifestHash:oldProof.manifestHash}});
  verifyProofs(oldManifest,[oldProof]);
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
  if(evidence.repair)verifyLocalReuse(directory,evidence);
  else assert(evidence.commands.every(row=>!row.reusedFrom&&!row.continuation),'Unverified local evidence reuse');
  const env = { GITHUB_SHA: expected.sha, CANDIDATE_BASE: expected.base };
  const commands = selectedCommands(selection, env);
  assert.equal(evidence.commands.length, commands.length, 'Missing/extra local commands');
  for (const [index, command] of commands.entries()) {
    const result = evidence.commands[index];
    assert.deepEqual(result.command, command, `Changed local command ${command.name}`);
    assert.equal(result.exitCode, 0, `Local command failed: ${command.name}`);
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
  verifyFrontend(manifest, relative => tree(path.join(directory, relative)));
  const proofs = fs.readdirSync(path.join(directory, 'candidate')).filter(file => /^proof-.*\.json$/.test(file)).map(file => JSON.parse(fs.readFileSync(path.join(directory, 'candidate', file))));
  verifyProofs(manifest, proofs);
  assert.equal(proofs.length, proofJobs(selection).length + 1, 'Duplicate/extra local proofs');
  for (const job of proofJobs(selection)) {
    const expectedProof = candidateProof(manifest, { job, reportFile: 'test-results/homepage-functional.json',
      readJson: file => JSON.parse(fs.readFileSync(path.join(directory, file))) });
    assert.deepEqual(proofs.find(proof => proof.job === job), expectedProof, 'Local proof differs from required executed reports');
  }
  const runtimeLog=fs.readFileSync(path.join(directory,'test-results/frontend-runtime.log'),'utf8');
  assert(runtimeLog.length>0,'Missing native frontend runtime evidence');
  const native=proofs.find(proof=>proof.job==='frontend-runtime');
  assert.equal(native.reportHash,sha256(JSON.stringify({tests:native.tests,log:runtimeLog})),'Changed native frontend runtime report');
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
