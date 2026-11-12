// One closed fixture repair. Retain genuine first-attempt browser passes and
// original failures; this is not a general changed-source test cache.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {sha256,commandRuntimes} from './local-release-plan.mjs';
import {browserRows} from './browser-fixture-repair.mjs';
import {passedBrowserCase,verifyBrowserUnion} from './local-release-browser.mjs';
import {LINEAR_REFRESH,assertLinearInputs} from './local-release-linear.mjs';
import {verifyResourceEvidence} from './local-release-environment.mjs';
import {verifyMigrationCandidateBytes} from './local-release-evidence.mjs';
import {gitSelection,tree,candidateProof} from '../pages-candidate.mjs';

export const STATIC_FIXTURE_POLICY='local-h3-pricing-static-fixture-v1';
export const STATIC_FIXTURE_REUSE=Object.freeze({
  source:'1b3b6deb20796971ef1030d8dce412e526f5a8c5',
  resourceRepairParent:'b0b162495177591348801973f3ff348cf128c5ec',
  base:'de2bbc54ef3777722bfada0ee87b88fdfc5db645',
  run:'1b3b6deb20796971ef1030d8dce412e526f5a8c5-deec4835-d54b-4cad-bba0-a3de40267de4',
  // Hashes from the immutable terminal original, never a relabelled success.
  checkpoint:"fcf73883a0958a9c1488c54b88f20653b79d6239c979fd31826f9c8ad9d3d7b0",inventory:"f120cbc7ed3619c79775d71cf2e7e55c5a7fc3836a1a614607a03b92237b5a20",report:"a8530d65b0d5b4a49698dac57d326484de0b8a97e02ceb2308b1959fc3003f71",rows:"7c975a02e8b7df503b07c9fbd97496a51b90c4bc859ceab8655748fa26b11224",discovery:"4aabaac3e14480de40599b2e873d524fb4c0dd7725cccb890f944fd0f6d2af20",exclusions:"c0c8119854b64da4fc905a8cf575021f15d2727c45a30a29bf1a12eb83207ca4",
  required:2390,fixture:'4cd3f24b7a8fd3be329c1b77cbfa94ecc3a38f3440c309e8bb95ca21895dbf41',
});
export const STATIC_PROOF_REUSE=Object.freeze({
  source:'b8387ec7f7a5d6b4dfd520b5b6ea95b54021bd8b',
  run:'b8387ec7f7a5d6b4dfd520b5b6ea95b54021bd8b-a5386997-d501-46df-89f0-e321438fc36b',
  checkpoint:'56cece7ea43476b5e353d741a840593bc2f81fb180aaccb584100f678fac6cde',
  bundle:'2c573708f541d9280f1459cbedbd3a1831ea262e52f11e0cc868d6a544315231',
  reports:'e4d7ee4abeb57007192a0385121af82da888716f4c844c3b615803991db008e7',
  candidate:'2a25befe12f825918e295d08b1aa70e337fe54c62f509f2a6e1bb3c68593ca4b',
});
const p=STATIC_FIXTURE_REUSE;
const fixture='tests/oma2-q3-model-pricing.spec.js';
const allowed=new Set([fixture,'scripts/local-release.mjs','scripts/lib/local-release-static-fixture.mjs',
  'scripts/lib/local-release-evidence.mjs','scripts/pages-candidate.mjs',
  'scripts/test-local-release.mjs','scripts/test-local-release-static-fixture.mjs',
  'docs/production-readiness/MAIN_ONLY_RELEASE_RUNBOOK.md','docs/runbooks/REGRESSION_REGISTER.md']);
const resourceRepairFiles=new Set(['scripts/lib/local-release-static-fixture.mjs','scripts/test-local-release-static-fixture.mjs',
  'docs/production-readiness/MAIN_ONLY_RELEASE_RUNBOOK.md','docs/runbooks/REGRESSION_REGISTER.md']);
const proofRepairFiles=new Set([...resourceRepairFiles,'scripts/local-release.mjs','scripts/pages-candidate.mjs',
  'scripts/lib/local-release-workspace.mjs','scripts/test-local-release-workspace.mjs']);
export function requiresStaticFixtureRefresh(name){return LINEAR_REFRESH.has(name);}
const json=file=>JSON.parse(fs.readFileSync(file));
const git=args=>execFileSync('git',['--no-replace-objects',...args],{stdio:['ignore','pipe','pipe']});
const marker=()=>({policy:STATIC_FIXTURE_POLICY,source:p.source,run:p.run,checkpoint:p.checkpoint});
const originAt=directory=>path.join(directory,'reuse/test-results/static-fixture-origin');
const identity=({key,file,title,project})=>({key,file,title,project});
const retainedName=name=>!name.startsWith('frontend-')&&!['homepage-runtime.json','candidate-static.json'].includes(name);

export function assertStaticFixtureInputs(original,current,{preparing=false}={}) {
  const before=structuredClone(original),after=structuredClone(current);
  verifyResourceEvidence(before.environment);
  verifyResourceEvidence(after.environment,{requireContainer:!preparing||after.environment.resourceObservation?.container!==undefined});
  // Docker MemTotal is guest-usable RAM, not its configured allocation. It can
  // change across boots (observed +8192 bytes). Validate both raw observations
  // with the existing reservation bounds, then compare their resource identity.
  // Persisted evidence is never normalized; every other environment field stays exact.
  for(const value of [before,after])value.environment.resourceObservation.vm.actual.memoryBytes=value.environment.resources.vm.memoryGiB*1024**3;
  if(preparing&&after.environment.resourceObservation.container===undefined)delete before.environment.resourceObservation.container;
  assertLinearInputs(before,after);
}

export function copyStaticFixtureReports(source,destination) {
  const target=path.join(destination,'test-results');fs.mkdirSync(target,{recursive:true});
  // Native work is later copied back into Linux. Never stage an old runtime
  // identity or failed static report where it could overwrite fresh evidence.
  for(const name of fs.readdirSync(path.join(source,'test-results')).filter(retainedName))
    fs.cpSync(path.join(source,'test-results',name),path.join(target,name),{recursive:true});
}

export function assertStaticFixtureTree(sha) {
  assert.match(sha,/^[a-f0-9]{40}$/);
  const parent=git(['show','-s','--format=%P',sha]).toString().trim();
  if(parent===STATIC_PROOF_REUSE.source) {
    assertStaticFixtureTree(parent);
    const repair=git(['diff','--name-only','--no-renames',parent,sha]).toString().trim().split('\n').filter(Boolean);
    assert(repair.length&&repair.every(file=>proofRepairFiles.has(file)),'Proof transport repair may change only its caller, verifier, tests and documentation');
    for(const file of repair)assert.match(git(['ls-tree',sha,'--',file]).toString(),/^100644 blob /,'Only regular nonexecutable reviewed files may change');
    return repair;
  }
  assert([p.source,p.resourceRepairParent].includes(parent),'Only the reviewed direct fixture/tooling successor may reuse this source');
  if(parent===p.resourceRepairParent) {
    assert.equal(git(['show','-s','--format=%P',parent]).toString().trim(),p.source);
    const repair=git(['diff','--name-only','--no-renames',parent,sha]).toString().trim().split('\n').filter(Boolean);
    assert(repair.length&&repair.every(file=>resourceRepairFiles.has(file)),'Resource repair may change only its verifier, tests and documentation');
  }
  const files=git(['diff','--name-only','--no-renames',p.source,sha]).toString().trim().split('\n').filter(Boolean);
  assert(files.includes(fixture)&&files.every(file=>allowed.has(file)),'Product, shared fixture, dependency, workflow or configuration changed');
  assert.equal(sha256(git(['show',`${sha}:${fixture}`])),p.fixture,'Corrected pricing fixture differs');
  for(const file of files)assert.match(git(['ls-tree',sha,'--',file]).toString(),/^100644 blob /,'Only regular nonexecutable reviewed files may change');
  return files;
}

export function verifyStaticBrowserUnion(discovery,previous,fresh,excluded) {
  assert.deepEqual(discovery,previous.map(identity),'Complete browser discovery changed');
  assert.equal(new Set(excluded).size,excluded.length,'Duplicate browser exclusion');
  const skip=new Set(excluded);
  for(const key of skip) {
    const row=previous.find(row=>row.key===key);
    assert(row?.expectedStatus==='skipped'&&row.status==='skipped'&&row.results.every(result=>result.status==='skipped'&&!result.error&&result.retry===0),'Only original intentional exclusions may remain excluded');
  }
  assert.deepEqual(previous.filter(row=>row.expectedStatus==='skipped'&&row.status==='skipped').map(row=>row.key),excluded,'Changed browser exclusion set');
  const retained=new Map(previous.filter(passedBrowserCase).map(row=>[row.key,row]));
  const counts=verifyBrowserUnion(discovery.filter(row=>!skip.has(row.key)),retained,fresh);
  return {...counts,excluded:excluded.length,discovered:discovery.length};
}

export function verifyStaticBrowserReport(report,sha) {
  assert.equal(report.policy,STATIC_FIXTURE_POLICY);assert.equal(report.sha,sha);assert.equal(report.source,p.source);
  assert.equal(report.scope,'static');
  for(const key of ['previous','discovery','excluded'])assert.equal(sha256(JSON.stringify(report[key])),p[{previous:'rows',discovery:'discovery',excluded:'exclusions'}[key]],`Changed pinned static ${key}`);
  assert.equal(report.discovery.length,p.required);
  const counts=verifyStaticBrowserUnion(report.discovery,report.previous,report.fresh,report.excluded);
  assert.deepEqual(report.counts,counts);assertStaticFixtureTree(sha);return counts;
}

function originalEvidence(directory) {
  const origin=originAt(directory),raw=fs.readFileSync(path.join(origin,'checkpoint.json'));
  assert.equal(sha256(raw),p.checkpoint,'Original failed checkpoint changed');
  const original=JSON.parse(raw),bundle=path.join(origin,'bundle');
  assert.equal(original.sha,p.source);assert.equal(original.base,p.base);assert.equal(original.id,p.run);assert.equal(original.status,'failed');
  assert.equal(original.commands.length,53);assert.equal(original.commands[52].exitCode,1);
  assert.equal(original.commands[52].command.name,'Run full static browser regression');
  assert(original.commands.slice(0,52).every(row=>row.exitCode===0&&!row.reusedFrom&&!row.continuation),'Original prefix must be genuine fresh passes');
  assert.equal(sha256(JSON.stringify(tree(bundle))),p.inventory,'Original report/log/runtime/candidate inventory changed');
  for(const row of original.commands)assert.equal(sha256(fs.readFileSync(path.join(bundle,row.log))),row.logHash,'Original command log changed');
  const rawReport=fs.readFileSync(path.join(origin,'failed-static.json'));
  assert.equal(sha256(rawReport),p.report,'Original failed static report changed');
  const previous=browserRows(JSON.parse(rawReport));assert.equal(sha256(JSON.stringify(previous)),p.rows);
  const manifest=json(path.join(bundle,'candidate/manifest.json'));assert.equal(manifest.sha,p.source);assert.equal(manifest.base,p.base);
  return {original,bundle,previous,manifest};
}

export function prepareStaticFixtureReuse(originalDirectory,directory,state,commands) {
  if(json(path.join(originalDirectory,'checkpoint.json')).sha===STATIC_PROOF_REUSE.source)
    return prepareStaticProofReuse(originalDirectory,directory,state,commands);
  assertStaticFixtureTree(state.sha);assert.equal(state.base,p.base);assert.equal(path.basename(originalDirectory),p.run);
  const origin=originAt(directory);assert(!fs.existsSync(origin),'Do not overwrite original fixture evidence');fs.mkdirSync(origin,{recursive:true});
  fs.copyFileSync(path.join(originalDirectory,'checkpoint.json'),path.join(origin,'checkpoint.json'));
  fs.copyFileSync(path.join(originalDirectory,'source/test-results/candidate-static.json'),path.join(origin,'failed-static.json'));
  fs.cpSync(path.join(originalDirectory,'bundle'),path.join(origin,'bundle'),{recursive:true});
  const {original,bundle}=originalEvidence(directory);assertStaticFixtureInputs(original,state,{preparing:true});
  assert.equal(commands.length,55);assert.equal(state.selection.full,true);
  copyStaticFixtureReports(bundle,directory);
  fs.cpSync(path.join(bundle,'runtime'),path.join(directory,'runtime'),{recursive:true});
  fs.mkdirSync(path.join(directory,'logs'),{recursive:true});
  const rows=commands.map((command,index)=>{
    if(index>=52||requiresStaticFixtureRefresh(command.name))return null;
    const before=original.commands[index];
    assert.deepEqual(command,JSON.parse(JSON.stringify(before.command).replaceAll(p.source,state.sha)),'Changed retained command');
    fs.copyFileSync(path.join(bundle,before.log),path.join(directory,before.log));
    return {...before,command,originalCommand:before.command,reusedFrom:p.source};
  });
  return {...state,startedAt:original.startedAt,commands:rows,staticFixtureContinuation:marker()};
}

export function verifyStaticFixtureReuse(directory,evidence,commands,{allowPending=false}={}) {
  if(evidence.staticProofContinuation)return verifyStaticProofReuse(directory,evidence,commands,{allowPending});
  assertStaticFixtureTree(evidence.sha);assert.equal(evidence.base,p.base);assert.deepEqual(evidence.staticFixtureContinuation,marker());
  const {original,bundle,previous,manifest:oldManifest}=originalEvidence(directory);
  assertStaticFixtureInputs(original,evidence);assert.deepEqual(evidence.selection,gitSelection(evidence.base,evidence.sha));
  assert.equal(commands.length,55);assert.equal(evidence.commands.length,55);
  for(const [index,command]of commands.entries()) {
    const row=evidence.commands[index],before=original.commands[index];
    if(index>=52||requiresStaticFixtureRefresh(command.name)) {
      if(allowPending&&!row)continue;
      assert(row&&!row.reusedFrom&&!row.originalCommand,'Affected or unexecuted check must run');assert.equal(row.exitCode,0);
      if(index===52) {
        assert.equal(row.browserContinuation,STATIC_FIXTURE_POLICY);assert.equal(row.continuation,'node scripts/local-release.mjs static-fixture-continuation');
        assert.deepEqual(row.runtimes,commandRuntimes(command).map(part=>part.runtime),'Native static and Linux carousel must both execute');
      } else assert(!row.continuation&&!row.browserContinuation,'Unexpected command substitution');
      continue;
    }
    assert.deepEqual(command,JSON.parse(JSON.stringify(before.command).replaceAll(p.source,evidence.sha)));
    assert.deepEqual(row,{...before,command,originalCommand:before.command,reusedFrom:p.source},'Retained command no longer matches original execution');
    assert.equal(sha256(fs.readFileSync(path.join(directory,row.log))),before.logHash);
  }
  for(const [file,hash]of Object.entries(tree(path.join(bundle,'runtime'))))assert.equal(sha256(fs.readFileSync(path.join(directory,'runtime',file))),hash,'Retained native/runtime evidence changed');
  for(const [file,hash]of Object.entries(tree(path.join(bundle,'test-results'))))if(retainedName(file.split('/')[0]))
    assert.equal(sha256(fs.readFileSync(path.join(directory,'test-results',file))),hash,`Retained report changed: ${file}`);
  if(!allowPending) {
    const before=json(path.join(bundle,'test-results/homepage-runtime.json'));
    assert.deepEqual(json(path.join(directory,'test-results/homepage-runtime.json')),{...before,sourceCommit:evidence.sha},'Changed Linux runtime beyond verified source association');
    const manifest=json(path.join(directory,'candidate/manifest.json'));assert.equal(manifest.sha,evidence.sha);assert.deepEqual(manifest.hosting,oldManifest.hosting);
    verifyMigrationCandidateBytes(directory,oldManifest,manifest,{allowLabGuard:false});
    const report=json(path.join(directory,'test-results/candidate-static.json'));verifyStaticBrowserFiles(directory,report,evidence.sha);
    assert.deepEqual(report.previous,previous);
  }
  return {original,previous,oldManifest};
}

const proofMarker=()=>({source:STATIC_PROOF_REUSE.source,run:STATIC_PROOF_REUSE.run,checkpoint:STATIC_PROOF_REUSE.checkpoint});
function proofOrigin(directory) {
  const relative='reuse/test-results/static-proof-origin';
  const direct=path.join(directory,relative);
  return fs.existsSync(direct)?direct:path.join(directory,'.local-release',relative);
}
function assertProofTree(sha) {
  assert.equal(git(['show','-s','--format=%P',sha]).toString().trim(),STATIC_PROOF_REUSE.source,'Proof reuse requires the exact direct tooling successor');
  assertStaticFixtureTree(sha);
}
export function isStaticProofSuccessor(sha) {
  assert.match(sha,/^[a-f0-9]{40}$/);
  return git(['show','-s','--format=%P',sha]).toString().trim()===STATIC_PROOF_REUSE.source;
}
export function verifyStaticProofOrigin(directory) {
  const q=STATIC_PROOF_REUSE,origin=proofOrigin(directory),raw=fs.readFileSync(path.join(origin,'checkpoint.json'));
  assert.equal(sha256(raw),q.checkpoint,'Changed failed proof checkpoint');
  const prior=JSON.parse(raw);assert.equal(prior.sha,q.source);assert.equal(prior.id,q.run);assert.equal(prior.status,'failed');
  assert.equal(prior.commands.length,55);assert(prior.commands.slice(0,54).every(row=>row.exitCode===0));
  assert.equal(prior.commands[54].exitCode,1);assert.equal(prior.commands[54].command.name,'Confirm tested browser candidate bytes');
  for(const [folder,hash]of [['bundle',q.bundle],['source/test-results',q.reports],['source/candidate',q.candidate]])
    assert.equal(sha256(JSON.stringify(tree(path.join(origin,folder)))),hash,`Changed proof origin ${folder}`);
  const bundle=path.join(origin,'bundle'),source=path.join(origin,'source');
  // Validate the actual failed origin, not a manufactured success. Only a clone
  // used for prefix verification omits the pinned failing final command.
  const pending=structuredClone(prior);pending.commands[54]=null;
  verifyStaticFixtureReuse(bundle,pending,prior.commands.map(row=>row.command),{allowPending:true});
  const manifest=json(path.join(source,'candidate/manifest.json'));
  assert.equal(manifest.sha,q.source);assert.equal(manifest.base,p.base);assert.deepEqual(manifest.selection,prior.selection);
  const original=originalEvidence(bundle).manifest;
  assert.deepEqual(manifest.hosting,original.hosting);verifyMigrationCandidateBytes(source,original,manifest,{allowLabGuard:false});
  candidateProof(manifest,{job:'browser-validation',evidenceDirectory:source,readJson:file=>json(path.join(source,file))});
  return {origin,prior,bundle,source,manifest};
}

function prepareStaticProofReuse(originalDirectory,directory,state,commands) {
  assertProofTree(state.sha);assert.equal(path.basename(originalDirectory),STATIC_PROOF_REUSE.run);
  const origin=path.join(directory,'reuse/test-results/static-proof-origin');assert(!fs.existsSync(origin),'Do not overwrite proof origin');
  fs.mkdirSync(path.join(origin,'source'),{recursive:true});
  fs.copyFileSync(path.join(originalDirectory,'checkpoint.json'),path.join(origin,'checkpoint.json'));
  fs.cpSync(path.join(originalDirectory,'bundle'),path.join(origin,'bundle'),{recursive:true});
  for(const folder of ['test-results','candidate'])fs.cpSync(path.join(originalDirectory,'source',folder),path.join(origin,'source',folder),{recursive:true});
  const {prior,bundle,source}=verifyStaticProofOrigin(directory);
  assertStaticFixtureInputs(prior,state,{preparing:true});assert.equal(commands.length,55);
  copyStaticFixtureReports(bundle,directory);
  // The bundle was collected before the final browser job. Its immutable tail
  // lives in the finally snapshot, including private raw reports and Voice.
  for(const name of ['candidate-static.json','candidate-carousel.json','static-fixture-attempts','canvas-voice-native-browser'])
    fs.cpSync(path.join(source,'test-results',name),path.join(directory,'test-results',name),{recursive:true});
  fs.cpSync(path.join(bundle,'runtime'),path.join(directory,'runtime'),{recursive:true});
  fs.mkdirSync(path.join(directory,'logs'),{recursive:true});
  const rows=commands.map((command,index)=>{
    if(requiresStaticFixtureRefresh(command.name))return null;
    const before=prior.commands[index];assert.equal(before.exitCode,0);
    assert.deepEqual(command,JSON.parse(JSON.stringify(before.command).replaceAll(prior.sha,state.sha)),'Changed proof-retained command');
    fs.copyFileSync(path.join(bundle,before.log),path.join(directory,before.log));
    return {...before,command,originalCommand:before.command,reusedFrom:prior.sha};
  });
  return {...state,startedAt:prior.startedAt,commands:rows,staticFixtureContinuation:marker(),staticProofContinuation:proofMarker()};
}

export function restoreStaticProofReports(directory) {
  const {source}=verifyStaticProofOrigin(directory);
  for(const name of ['candidate-static.json','candidate-carousel.json'])
    fs.copyFileSync(path.join(source,'test-results',name),path.join(directory,'test-results',name));
}

// Shared by CLI final proof and protected import recomputation. Raw execution
// source fields remain b838; only the new proof is bound to the new candidate.
export function verifyStaticProofCandidate(directory,manifest) {
  assertProofTree(manifest.sha);
  const {source,manifest:before}=verifyStaticProofOrigin(directory);
  assert.equal(manifest.base,p.base);assert.deepEqual(manifest.selection,gitSelection(p.base,manifest.sha));
  assert.deepEqual(manifest.hosting,before.hosting,'Changed hosting cannot reuse browser proof');
  verifyMigrationCandidateBytes(directory,before,manifest,{allowLabGuard:false});
  for(const name of ['candidate-static.json','candidate-carousel.json','static-fixture-attempts','canvas-voice-native-browser']) {
    const from=path.join(source,'test-results',name),to=path.join(directory,'test-results',name);
    if(fs.statSync(from).isDirectory())assert.deepEqual(tree(to),tree(from),'Retained browser tree changed');
    else assert.equal(sha256(fs.readFileSync(to)),sha256(fs.readFileSync(from)),'Retained browser report changed');
  }
  return STATIC_PROOF_REUSE.source;
}

function verifyStaticProofReuse(directory,evidence,commands,{allowPending}) {
  assertProofTree(evidence.sha);assert.equal(evidence.base,p.base);
  assert.deepEqual(evidence.staticFixtureContinuation,marker());assert.deepEqual(evidence.staticProofContinuation,proofMarker());
  const {prior,bundle}=verifyStaticProofOrigin(directory);assertStaticFixtureInputs(prior,evidence);
  assert.deepEqual(evidence.selection,gitSelection(evidence.base,evidence.sha));assert.equal(evidence.startedAt,prior.startedAt);
  assert.equal(commands.length,55);assert.equal(evidence.commands.length,55);
  for(const [index,command]of commands.entries()) {
    const row=evidence.commands[index],before=prior.commands[index];
    if(requiresStaticFixtureRefresh(command.name)) {
      if(allowPending&&!row)continue;
      assert(row&&!row.reusedFrom&&!row.originalCommand&&!row.continuation&&!row.browserContinuation,'Affected proof tooling must execute');assert.equal(row.exitCode,0);
    } else {
      assert.deepEqual(command,JSON.parse(JSON.stringify(before.command).replaceAll(prior.sha,evidence.sha)));
      assert.deepEqual(row,{...before,command,originalCommand:before.command,reusedFrom:prior.sha},'Retained proof command differs');
      assert.equal(sha256(fs.readFileSync(path.join(directory,row.log))),before.logHash);
    }
  }
  for(const [file,hash]of Object.entries(tree(path.join(bundle,'runtime'))))assert.equal(sha256(fs.readFileSync(path.join(directory,'runtime',file))),hash,'Retained runtime changed');
  for(const [file,hash]of Object.entries(tree(path.join(bundle,'test-results'))))if(retainedName(file.split('/')[0]))
    assert.equal(sha256(fs.readFileSync(path.join(directory,'test-results',file))),hash,`Retained report changed: ${file}`);
  if(!allowPending) {
    const before=json(path.join(bundle,'test-results/homepage-runtime.json'));
    assert.deepEqual(json(path.join(directory,'test-results/homepage-runtime.json')),{...before,sourceCommit:evidence.sha});
    verifyStaticProofCandidate(directory,json(path.join(directory,'candidate/manifest.json')));
  }
  return {prior};
}

// The same-source resume path consumes the same raw execution proof as import.
// Each attempt is immutable. A failed completed attempt is not silently retried.
export function verifyStaticBrowserFiles(directory,report,sha) {
  const counts=verifyStaticBrowserReport(report,sha);
  assert.match(report.attempt,/^test-results\/static-fixture-attempts\/[a-f0-9-]{36}$/);
  const attempt=path.join(directory,report.attempt),meta=json(path.join(attempt,'attempt.json'));
  assert.equal(meta.sha,sha);assert.equal(meta.policy,STATIC_FIXTURE_POLICY);
  assert.deepEqual(json(path.join(attempt,'fresh-started.json')),{sha,args:['--test-list',`${report.attempt}/pending.txt`,'--workers=1','--retries=0',`--output=${report.attempt}/artifacts`]});
  assert.deepEqual(Object.keys(report.raw).sort(),['discovery','fresh','selected-discovery']);
  const raw={};
  for(const name of Object.keys(report.raw)) {
    const bytes=fs.readFileSync(path.join(attempt,`${name}.json`));assert.equal(sha256(bytes),report.raw[name]);
    raw[name]=JSON.parse(bytes);
    assert.deepEqual(json(path.join(attempt,`${name}-exit.json`)),{status:0,signal:null},'Incomplete/failed execution cannot become acceptance');
    assert.deepEqual(raw[name].errors||[],[],'Browser process reported a global error');
  }
  assert.deepEqual(report.discovery,browserRows(raw.discovery,{discovery:true}));
  assert.deepEqual(report.fresh,browserRows(raw.fresh),'Fresh rows must match actual raw execution');
  assert.deepEqual(browserRows(raw['selected-discovery'],{discovery:true}),report.fresh.map(identity));
  return counts;
}

function reportFromAttempt(directory,attempt,sha,previous) {
  const absolute=path.join(directory,attempt),raw={};
  for(const name of ['discovery','selected-discovery','fresh'])raw[name]=sha256(fs.readFileSync(path.join(absolute,`${name}.json`)));
  const discovery=browserRows(json(path.join(absolute,'discovery.json')),{discovery:true}),fresh=browserRows(json(path.join(absolute,'fresh.json')));
  const excluded=previous.filter(row=>row.expectedStatus==='skipped'&&row.status==='skipped').map(row=>row.key);
  const report={policy:STATIC_FIXTURE_POLICY,sha,source:p.source,scope:'static',previous,discovery,fresh,excluded,attempt,raw,
    counts:verifyStaticBrowserUnion(discovery,previous,fresh,excluded)};
  verifyStaticBrowserFiles(directory,report,sha);return report;
}

export function recoverStaticFixtureCompletion(directory,sha,previous) {
  const completed=path.join(directory,'test-results/candidate-static.json');
  if(fs.existsSync(completed)) {
    const report=json(completed);verifyStaticBrowserFiles(directory,report,sha);assert.deepEqual(report.previous,previous);return report;
  }
  const attempts=path.join(directory,'test-results/static-fixture-attempts');
  if(!fs.existsSync(attempts))return null;
  for(const name of fs.readdirSync(attempts).sort()) {
    const attempt=`test-results/static-fixture-attempts/${name}`,absolute=path.join(directory,attempt);
    assert.equal(json(path.join(absolute,'attempt.json')).sha,sha,'Attempt belongs to another source');
    if(!fs.existsSync(path.join(absolute,'fresh.json'))) {
      assert(!fs.existsSync(path.join(absolute,'fresh-started.json')),'Interrupted fresh execution needs diagnosis; do not blindly retry');continue;
    }
    // A complete raw success can survive interruption before final publication.
    // An incomplete/failed report instead stops for diagnosis; it is never erased.
    const report=reportFromAttempt(directory,attempt,sha,previous);
    fs.writeFileSync(completed,JSON.stringify(report),{flag:'wx'});return report;
  }
  return null;
}

export async function runStaticFixtureContinuation(env=process.env) {
  assert.equal(env.CI,'1');assert.equal(env.GITHUB_JOB,'browser-validation');assertStaticFixtureTree(env.GITHUB_SHA);
  const {previous}=originalEvidence('.local-release');
  const completed=recoverStaticFixtureCompletion('.',env.GITHUB_SHA,previous);
  if(completed){console.log(JSON.stringify({...completed.counts,sameSourceCompletedStatic:true,carouselStillRequired:true}));return;}
  const attempt=`test-results/static-fixture-attempts/${randomUUID()}`;
  fs.mkdirSync(attempt,{recursive:true});fs.writeFileSync(path.join(attempt,'attempt.json'),JSON.stringify({policy:STATIC_FIXTURE_POLICY,sha:env.GITHUB_SHA}),{flag:'wx'});
  const retained=new Set(previous.filter(passedBrowserCase).map(row=>row.key));
  const excluded=previous.filter(row=>row.expectedStatus==='skipped'&&row.status==='skipped').map(row=>row.key);
  assert.equal(sha256(JSON.stringify(excluded)),p.exclusions);
  const run=(name,args,discovery=false)=>{
    const file=path.resolve(attempt,`${name}.json`);assert(!fs.existsSync(file),'Do not overwrite a fixture attempt');
    if(!discovery)fs.writeFileSync(path.join(attempt,'fresh-started.json'),JSON.stringify({sha:env.GITHUB_SHA,args}),{flag:'wx'});
    const child=spawnSync('npm',['run','test:static','--',...args,`--reporter=${discovery?'json':'list,json'}`],{env:{...env,PLAYWRIGHT_JSON_OUTPUT_NAME:file},stdio:discovery?'pipe':'inherit',maxBuffer:16*1024*1024});
    fs.writeFileSync(path.join(attempt,`${name}-exit.json`),JSON.stringify({status:child.status,signal:child.signal}),{flag:'wx'});
    assert.equal(child.status,0,`Static fixture ${name} failed; preserve the actual report`);return json(file);
  };
  const raw=run('discovery',['--list'],true),discovery=browserRows(raw,{discovery:true});
  assert.equal(sha256(JSON.stringify(discovery)),p.discovery);assert.equal(discovery.length,p.required);
  const pending=new Set(discovery.filter(row=>!retained.has(row.key)&&!excluded.includes(row.key)).map(row=>row.key)),list=[];
  const visit=(suite,parents=[])=>{
    for(const spec of suite.specs||[])for(const test of spec.tests||[])if(pending.has(`${test.projectName}:${spec.id}`))list.push(`[${test.projectName}] › ${spec.file} › ${[...parents,spec.title].join(' › ')}`);
    for(const child of suite.suites||[])visit(child,[...parents,child.title]);
  };
  raw.suites.forEach(suite=>visit(suite));assert(pending.size>0);assert.equal(list.length,pending.size);
  const listFile=path.join(attempt,'pending.txt');fs.writeFileSync(listFile,list.join('\n')+'\n',{flag:'wx'});
  const args=['--test-list',listFile,'--workers=1','--retries=0',`--output=${attempt}/artifacts`];
  const selected=browserRows(run('selected-discovery',[...args,'--list'],true),{discovery:true});
  assert.deepEqual(selected,discovery.filter(row=>pending.has(row.key)),'Actual caller selected different cases');
  run('fresh',args);
  const report=reportFromAttempt('.',attempt,env.GITHUB_SHA,previous);
  fs.writeFileSync('test-results/candidate-static.json',JSON.stringify(report),{flag:'wx'});
  console.log(JSON.stringify({...report.counts,originalFailuresPreserved:true}));
}
