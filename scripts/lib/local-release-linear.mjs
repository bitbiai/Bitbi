// One bounded publication repair: preserve the accepted merge's evidence while
// publishing its identical product tree through main's required linear history.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {sha256} from './local-release-plan.mjs';
import {gitSelection, tree} from '../pages-candidate.mjs';
import {verifyLocalEvidence, verifyMigrationCandidateBytes} from './local-release-evidence.mjs';

export const LINEAR_REUSE=Object.freeze({
  source:'0f0bae56fbe963482f62088db1e165389e6f9ca4',
  linear:'b36082f47d696ad411b3d75fa22672d7e32cc1b9',
  remote:'29ea08dae36052d0e9bf22bc6f50e9e04332baf5',
  base:'469895277cd290268eb763c8bea84efd5a3fc3c7',
  tree:'b55d422bc64f1485dc8339b21b7e7cbdaa5107d7',
  evidence:'15b9df32ba0fcce77f0d95b03d3c2f71b0c19f04ce1f9a78f7d0fd167d9dfede',
  inventory:'b5524c914a4e1687a0c36895fd51428abba45365567db52414de6e6587e6dd4c',
  objects:'feac13e6f04ddec5f91e76661f47d3f616194494ad076f07c0a083f244f0516b',
  transport:'437a743486277f4b54bc541a9e70572e5f07fcb1020560d00cf6ae9f4e8ac4c8',
  receipt:7263740013,
});
const allowed=new Set([
  'scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs',
  'scripts/test-local-release.mjs','scripts/lib/local-release-linear.mjs',
  'scripts/test-local-release-linear.mjs','scripts/lib/local-release-history.mjs',
  'scripts/test-local-release-history.mjs','docs/production-readiness/MAIN_ONLY_RELEASE_RUNBOOK.md',
]);
export const LINEAR_REFRESH=new Set([
  'Preflight complete static release plan','Run quality gate tests','Check committed secrets',
  'Check targeted JavaScript syntax','Run release compatibility tests','Run release planner tests',
  'Run static deploy safety tests','Run CI test selection fixtures','Test local release evidence and orchestration',
  'Run doc currentness tests','Check documentation currentness','Record candidate build',
  'Validate static website references','Check frontend hosting package','Validate JS import paths',
  'Check target="_blank" links have rel="noopener"','Validate page metadata',
  'Restore exact candidate static site','Confirm tested candidate bytes','Confirm tested browser candidate bytes',
]);
const git=args=>execFileSync('git',['--no-replace-objects',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const json=file=>JSON.parse(fs.readFileSync(file));
const originAt=directory=>path.join(directory,'reuse/linear-origin');
const marker=()=>({source:LINEAR_REUSE.source,evidence:LINEAR_REUSE.evidence,linear:LINEAR_REUSE.linear,tree:LINEAR_REUSE.tree,objects:LINEAR_REUSE.objects,receipt:LINEAR_REUSE.receipt,archive:LINEAR_REUSE.transport});
const effective=selection=>Object.fromEntries(Object.entries(selection).filter(([key])=>!['files','reasons'].includes(key)));
const retainedName=name=>!name.startsWith('frontend-')&&name!=='homepage-runtime.json';
const stableEnvironment=value=>Object.fromEntries(Object.entries(value).filter(([key])=>!['reused','preparationMs'].includes(key)));

export function assertLinearInputs(original,evidence) {
  assert.equal(evidence.planHash,original.planHash,'Changed command plan');
  assert.deepEqual(effective(evidence.selection),effective(original.selection),'Changed selected acceptance scope');
  assert.deepEqual(stableEnvironment(evidence.environment),stableEnvironment(original.environment),'Changed execution environment');
  assert.deepEqual(stableEnvironment(evidence.nativeBrowsers),stableEnvironment(original.nativeBrowsers),'Changed native browser environment');
}

export function assertLinearTree(head) {
  assert.match(head,/^[a-f0-9]{40}$/);
  assert.equal(git(['rev-parse',`${LINEAR_REUSE.linear}^{tree}`]),LINEAR_REUSE.tree,'Changed linear anchor tree');
  assert.equal(git(['show','-s','--format=%P',LINEAR_REUSE.linear]),LINEAR_REUSE.remote,'Wrong linear anchor parent');
  git(['merge-base','--is-ancestor',LINEAR_REUSE.base,head]);
  git(['merge-base','--is-ancestor',LINEAR_REUSE.linear,head]);
  const commits=git(['rev-list',`${LINEAR_REUSE.linear}..${head}`]).split('\n').filter(Boolean);
  assert(commits.length<=1,'Only the reviewed direct tooling successor may reuse this evidence');
  if(commits.length)assert.equal(git(['show','-s','--format=%P',head]),LINEAR_REUSE.linear,'Publication must remain linear');
  const files=git(['diff','--name-only','--no-renames',LINEAR_REUSE.linear,head]).split('\n').filter(Boolean);
  assert(files.every(file=>allowed.has(file)),'Product, fixture, dependency, workflow or configuration changed');
  return files;
}

export function importLinearSource(directory) {
  const bundle=path.resolve(directory,'reuse/linear-source.bundle');
  assert.equal(sha256(fs.readFileSync(bundle)),LINEAR_REUSE.objects,'Changed original Git object bundle');
  assert.equal(git(['bundle','list-heads',bundle]),`${LINEAR_REUSE.source} refs/heads/accepted-local`,'Wrong original object head');
  git(['bundle','verify',bundle]);
  // Import objects only: neither checkout nor local/remote refs are changed.
  git(['fetch','--no-tags','--no-write-fetch-head',bundle,'refs/heads/accepted-local']);
  assert.equal(git(['rev-parse',`${LINEAR_REUSE.source}^{tree}`]),LINEAR_REUSE.tree,'Original source tree mismatch');
  git(['merge-base','--is-ancestor',LINEAR_REUSE.base,LINEAR_REUSE.source]);
}

function originalEvidence(directory) {
  importLinearSource(directory);
  const origin=originAt(directory);
  assert.equal(sha256(fs.readFileSync(path.join(origin,'evidence.json'))),LINEAR_REUSE.evidence,'Changed original acceptance');
  assert.equal(sha256(JSON.stringify(tree(origin))),LINEAR_REUSE.inventory,'Changed original report/log/runtime inventory');
  const verified=verifyLocalEvidence(origin,{sha:LINEAR_REUSE.source,base:LINEAR_REUSE.base});
  assert.equal(verified.evidence.sourceTree,LINEAR_REUSE.tree);
  assert.equal(verified.evidence.commands.length,54);
  assert(verified.evidence.commands.every(row=>row.exitCode===0&&!row.reusedFrom&&!row.continuation),'Original acceptance must be complete and fresh');
  assert.equal(verified.evidence.linearContinuation,undefined,'Nested linear continuation is forbidden');
  return verified;
}

// Report paths stay original; fresh hosting evidence must never be replaced by
// the old frontend-runtime log or its policy/review records.
export function copyLinearReports(origin,destination) {
  const source=path.join(origin,'test-results'),target=path.join(destination,'test-results');
  fs.mkdirSync(target,{recursive:true});
  for(const name of fs.readdirSync(source).filter(retainedName))fs.cpSync(path.join(source,name),path.join(target,name),{recursive:true});
}

export function prepareLinearReuse(originalDirectory,directory,state,commands) {
  assertLinearTree(state.sha);assert.equal(state.base,LINEAR_REUSE.base);
  const origin=originAt(directory);fs.mkdirSync(path.dirname(origin),{recursive:true});
  assert(!fs.existsSync(origin),'Do not overwrite an existing linear origin');
  assert.equal(sha256(fs.readFileSync(path.join(originalDirectory,'evidence.zip'))),LINEAR_REUSE.transport,'Wrong uploaded source archive');
  fs.cpSync(path.join(originalDirectory,'bundle'),origin,{recursive:true});
  fs.copyFileSync(path.join(originalDirectory,'linear-source.bundle'),path.join(directory,'reuse/linear-source.bundle'));
  const {evidence:original}=originalEvidence(directory);
  assertLinearInputs(original,state);
  assert.equal(commands.length,54);assert.equal(state.selection.full,true);
  copyLinearReports(origin,directory);
  fs.cpSync(path.join(origin,'runtime'),path.join(directory,'runtime'),{recursive:true});
  fs.mkdirSync(path.join(directory,'logs'),{recursive:true});
  const rows=commands.map((command,index)=>{
    const previous=original.commands[index];assert.equal(command.name,previous.command.name,'Changed command order');
    if(LINEAR_REFRESH.has(command.name))return null;
    assert.deepEqual(command,JSON.parse(JSON.stringify(previous.command).replaceAll(LINEAR_REUSE.source,state.sha)),'Changed retained execution command');
    fs.copyFileSync(path.join(origin,previous.log),path.join(directory,previous.log));
    return {...previous,command,originalCommand:previous.command,reusedFrom:LINEAR_REUSE.source};
  });
  return {...state,commands:rows,linearContinuation:marker()};
}

export function verifyLinearRuntime(previous,current,sha) {
  assert.equal(previous.sourceCommit,LINEAR_REUSE.source);
  assert.equal(previous.status,'passed');
  assert.deepEqual(current,{...previous,sourceCommit:sha},'Changed browser runtime beyond freshly checked source identity');
}

export function verifyLinearReuse(directory,evidence,commands,{allowPending=false}={}) {
  assertLinearTree(evidence.sha);assert.equal(evidence.base,LINEAR_REUSE.base);
  assert.deepEqual(evidence.linearContinuation,marker(),'Wrong linear origin provenance');
  const {evidence:original,manifest:oldManifest}=originalEvidence(directory);
  assertLinearInputs(original,evidence);
  assert.deepEqual(evidence.selection,gitSelection(evidence.base,evidence.sha),'Incomplete final selection');
  assert.equal(commands.length,54);assert.equal(evidence.commands.length,54);
  for(let index=0;index<commands.length;index++) {
    const command=commands[index],row=evidence.commands[index],previous=original.commands[index];
    assert.equal(command.name,previous.command.name,'Changed command inventory');
    if(LINEAR_REFRESH.has(command.name)) {
      if(allowPending&&!row)continue;
      assert(row&&!row.reusedFrom&&!row.originalCommand,'Changed-input check requires fresh execution');
      assert.equal(row.exitCode,0);continue;
    }
    const expected={...previous,command,originalCommand:previous.command,reusedFrom:LINEAR_REUSE.source};
    assert.deepEqual(command,JSON.parse(JSON.stringify(previous.command).replaceAll(LINEAR_REUSE.source,evidence.sha)),'Changed retained command');
    assert.deepEqual(row,expected,'Retained acceptance differs from its actual original execution');
    assert.equal(sha256(fs.readFileSync(path.join(directory,row.log))),previous.logHash,'Changed retained log');
  }
  if(!allowPending)verifyLinearRuntime(json(path.join(originAt(directory),'test-results/homepage-runtime.json')),json(path.join(directory,'test-results/homepage-runtime.json')),evidence.sha);
  const oldReports=tree(path.join(originAt(directory),'test-results'));
  for(const [file,hash] of Object.entries(oldReports))if(retainedName(file.split('/')[0]))
    assert.equal(sha256(fs.readFileSync(path.join(directory,'test-results',file))),hash,`Changed retained report: ${file}`);
  for(const [file,hash] of Object.entries(tree(path.join(originAt(directory),'runtime'))))
    assert.equal(sha256(fs.readFileSync(path.join(directory,'runtime',file))),hash,`Changed retained runtime evidence: ${file}`);
  if(!allowPending) {
    const manifest=json(path.join(directory,'candidate/manifest.json'));
    assert.equal(manifest.sha,evidence.sha);assert.equal(manifest.base,evidence.base);
    assert.deepEqual(manifest.hosting,oldManifest.hosting,'Changed frontend runtime package');
    verifyMigrationCandidateBytes(directory,oldManifest,manifest,{allowLabGuard:false});
  }
  return {original,oldManifest};
}
