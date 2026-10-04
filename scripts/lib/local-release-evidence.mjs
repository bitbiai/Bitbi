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
