import assert from 'node:assert/strict';
import { HOMEPAGE_WEBKIT_REQUIRED } from './lib/homepage-test-selection.mjs';
export const MEDIA_POLICY = 'decorative-core-v1';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const REPOSITORY = 'bitbiai/Bitbi';
export const Q4_BASE = '8292a4926bb1bf24679db9dd2b87cd6882f4d4f7';
export const REQUIRED_JOBS = {
  'release-compatibility': ['Preflight complete static release plan', 'Audit root dependencies', 'Validate worker package dependencies', 'Run quality gate tests', 'Record candidate build'],
  'worker-validation': ['Verify native Linux isolation before Worker tests', 'Run worker route tests'],
  'homepage-validation': ['Run Linux homepage functional acceptance', 'Record controlled homepage performance diagnostics', 'Confirm tested candidate bytes'],
  'homepage-webkit-media': ['Run required native WebKit media with private HOME and loopback only', 'Confirm tested candidate bytes'],
  'browser-validation': ['Run full static browser regression'],
};
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export function tree(directory) {
  const files = {};
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name, 'en'))) {
      const full = path.join(dir,entry.name), relative = path.relative(directory,full).split(path.sep).join('/');
      assert(!entry.isSymbolicLink(), `Candidate symlink: ${relative}`);
      if(entry.isDirectory()) visit(full);
      else { assert(entry.isFile(), `Non-regular candidate input: ${relative}`); files[relative]=digest(fs.readFileSync(full)); }
    }
  }
  visit(directory); assert(Object.keys(files).length>0,'Empty static candidate'); return files;
}
export function verifyManifest(manifest, expected, site, { allowPartial = false } = {}) {
  assert.equal(manifest.schema,1); assert.equal(manifest.repository,REPOSITORY);
  for(const field of ['sha','base','run','attempt']) assert.equal(String(manifest[field]),String(expected[field]),`Candidate ${field} mismatch`);
  assert.equal(manifest.mediaPolicy,MEDIA_POLICY,'Different media acceptance policy');
  if (!allowPartial) assert.equal(manifest.full,true,'Not a complete candidate acceptance');
  assert.deepEqual(tree(site),manifest.files,'Static bytes differ from tested candidate');
  return digest(JSON.stringify(manifest));
}
export function validateSource({run,jobs,artifacts,laterRuns,mainSha}, expected) {
  assert.equal(expected.repository,REPOSITORY,'Foreign repository');
  assert.equal(expected.base,Q4_BASE,'Incomplete Q4 release scope');
  assert.equal(mainSha,expected.sha,'Superseded candidate');
  assert.equal(run.repository?.full_name,REPOSITORY); assert.equal(run.head_repository?.full_name,REPOSITORY);
  assert.equal(run.head_sha,expected.sha,'Source SHA mismatch'); assert.equal(run.head_branch,'main');
  assert.equal(String(run.id),String(expected.run)); assert.equal(String(run.run_attempt),String(expected.attempt),'Source attempt mismatch');
  assert.equal(run.path,'.github/workflows/static.yml','Wrong validation workflow');
  assert(['push','workflow_dispatch'].includes(run.event),'Untrusted source event');
  assert.equal(run.status,'completed');
  assert(['success','failure'].includes(run.conclusion),'Source acceptance cancelled or incomplete');
  if(run.conclusion==='failure') {
    assert(jobs.some(j=>j.name==='deploy'&&j.conclusion==='failure'),'Unexplained source failure');
    assert(jobs.filter(j=>j.name!=='deploy').every(j=>['success','skipped'].includes(j.conclusion)),'Source validation failed');
  }
  for(const [name,steps] of Object.entries(REQUIRED_JOBS)) {
    const found=jobs.filter(j=>j.name===name); assert.equal(found.length,1,`Missing/duplicate suite ${name}`);
    const j=found[0]; assert.equal(j.head_sha,expected.sha); assert.equal(j.status,'completed'); assert.equal(j.conclusion,'success',`Suite ${name} did not pass`);
    for(const name of steps) assert(j.steps?.some(s=>s.name===name&&s.status==='completed'&&s.conclusion==='success'),`Required step did not execute: ${name}`);
  }
  // Never select an older green run around a known later failure or pending
  // validation of this SHA. The current publication request is not validation.
  for(const later of laterRuns.filter(r=>String(r.id)!==String(expected.currentRun)&&Date.parse(r.created_at)>Date.parse(run.created_at))) {
    // A publish-only failure is not a new functional failure. Actual skipped
    // validation jobs plus the explicit reuse job distinguish that path.
    if(later.jobs?.some(j=>j.name==='reuse-candidate') && Object.keys(REQUIRED_JOBS).every(name=>later.jobs.some(j=>j.name===name&&j.conclusion==='skipped')))continue;
    assert.equal(later.status,'completed','Later validation is unresolved');
    assert.equal(later.conclusion,'success','Later candidate failure blocks reuse');
  }
  const suffix=`${expected.sha}-${expected.run}-${expected.attempt}`;
  const names=[`pages-candidate-${suffix}`,`pages-proof-homepage-validation-${suffix}`,`pages-proof-homepage-webkit-media-${suffix}`];
  return names.map(name=>{
    const found=artifacts.filter(a=>a.name===name); assert.equal(found.length,1,`Missing/ambiguous artifact ${name}`);
    const a=found[0];assert.equal(a.expired,false,'Expired candidate artifact');assert(a.size_in_bytes>0);
    assert.equal(a.workflow_run?.id,Number(expected.run));assert.equal(a.workflow_run?.head_sha,expected.sha);
    assert(/^sha256:[a-f0-9]{64}$/.test(a.digest),'Missing immutable artifact digest'); return a;
  });
}
export function verifyProofs(manifest,proofs) {
  for(const job of ['homepage-validation','homepage-webkit-media']) {
    const p=proofs.find(p=>p.job===job); assert(p,`Missing tested build proof ${job}`);
    assert.equal(p.manifestHash,digest(JSON.stringify(manifest)),'Different OS build inputs');
    assert.equal(p.status,'passed');assert(p.reportHash&&p.tests>0,'No executed browser report');
  }
}
async function api(endpoint) {
  assert(process.env.GH_TOKEN,'Missing read-only Actions token');
  const response=await fetch(`https://api.github.com/repos/${REPOSITORY}/${endpoint}`,{headers:{Authorization:`Bearer ${process.env.GH_TOKEN}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(20000)});
  assert(response.ok,`GitHub ${endpoint.split('?')[0]} returned ${response.status}`);return response.json();
}
async function collection(endpoint,key) {
  const rows=[];
  for(let page=1;page<=10;page++) { const data=await api(`${endpoint}${endpoint.includes('?')?'&':'?'}per_page=100&page=${page}`);rows.push(...data[key]);if(rows.length>=data.total_count)return rows; }
  throw new Error('Evidence pagination exceeded bounded scope');
}
function expected(env=process.env) { return {repository:env.GITHUB_REPOSITORY,sha:env.GITHUB_SHA,base:env.CANDIDATE_BASE,run:env.CANDIDATE_RUN||env.GITHUB_RUN_ID,attempt:env.CANDIDATE_ATTEMPT||env.GITHUB_RUN_ATTEMPT,currentRun:env.GITHUB_RUN_ID}; }
async function main(command) {
  const e=expected(),dir='candidate',manifestFile=path.join(dir,'manifest.json');
  if(command==='current') { assert.equal((await api('git/ref/heads/main')).object.sha,e.sha,'Superseded candidate');return; }
  if(command==='source') {
    assert(/^\d+$/.test(e.run||'')&&/^\d+$/.test(e.attempt||''),'Explicit source run/attempt required');
    const [run,jobs,artifacts,laterRuns,ref]=await Promise.all([api(`actions/runs/${e.run}`),collection(`actions/runs/${e.run}/attempts/${e.attempt}/jobs`,'jobs'),collection(`actions/runs/${e.run}/artifacts`,'artifacts'),collection(`actions/runs?head_sha=${e.sha}`,'workflow_runs'),api('git/ref/heads/main')]);
    const relevant=laterRuns.filter(r=>['.github/workflows/static.yml','.github/workflows/full-regression.yml','.github/workflows/ui-fast-deploy.yml'].includes(r.path));
    for(const later of relevant.filter(r=>String(r.id)!==String(e.currentRun)&&Date.parse(r.created_at)>Date.parse(run.created_at)&&r.conclusion!=='success'))later.jobs=await collection(`actions/runs/${later.id}/attempts/${later.run_attempt}/jobs`,'jobs');
    const selected=validateSource({run,jobs,artifacts,laterRuns:relevant,mainSha:ref.object.sha},e);
    if(process.env.CANDIDATE_ARTIFACT_IDS)assert.equal(selected.map(a=>a.id).join(','),process.env.CANDIDATE_ARTIFACT_IDS,'Candidate artifacts changed after selection');
    fs.writeFileSync('candidate-source.json',JSON.stringify({expected:e,artifacts:selected.map(({id,name,digest})=>({id,name,digest}))}));
    if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,`artifact_ids=${selected.map(a=>a.id).join(',')}\n`);
    console.log(`Accepted exact source ${e.run}/${e.attempt} for ${e.sha}`);return;
  }
  if(command==='record') {
    assert.equal(e.repository,REPOSITORY);assert(['true','false'].includes(process.env.CANDIDATE_FULL));assert.equal(e.base,Q4_BASE);assert(/^[a-f0-9]{40}$/.test(e.sha));
    fs.mkdirSync(dir,{recursive:true});fs.cpSync('_site',path.join(dir,'site'),{recursive:true});
    const manifest={schema:1,repository:e.repository,sha:e.sha,base:e.base,run:String(e.run),attempt:String(e.attempt),full:process.env.CANDIDATE_FULL==='true',mediaPolicy:MEDIA_POLICY,files:tree('_site')};
    fs.writeFileSync(manifestFile,JSON.stringify(manifest));return;
  }
  const manifest=JSON.parse(fs.readFileSync(manifestFile));
  const hash=verifyManifest(manifest,e,path.join(dir,'site'),{allowPartial:command!=='publish'});
  if(command==='restore') {assert(!fs.existsSync('_site'),'Refuse to replace an existing test/build server input');fs.cpSync(path.join(dir,'site'),'_site',{recursive:true});return;}
  if(command==='proof') {
    verifyManifest(manifest,e,'_site',{allowPartial:true});
    const report=JSON.parse(fs.readFileSync(process.env.CANDIDATE_REPORT));assert(report.stats.expected>0&&report.stats.unexpected===0&&report.stats.flaky===0,'Browser acceptance missing or failed');
    if(['homepage-webkit-media','homepage-validation'].includes(process.env.GITHUB_JOB)) {
      const engine=process.env.GITHUB_JOB==='homepage-webkit-media'?'webkit':'chromium';
      if(engine==='webkit') assert.equal(report.stats.skipped,0,'Native core cases skipped');
      const passed=new Set();
      const visit=suite=>{
        for(const spec of suite.specs||[]) for(const test of spec.tests||[])
          if(test.projectName===engine && test.results?.length===1 && test.results[0].status==='passed') passed.add(spec.title);
        (suite.suites||[]).forEach(visit);
      };
      (report.suites||[]).forEach(visit);
      for(const title of HOMEPAGE_WEBKIT_REQUIRED) assert(passed.has(title),'Missing executed core media scenario: '+title);
    }
    fs.mkdirSync('candidate-proofs',{recursive:true});fs.writeFileSync(`candidate-proofs/proof-${process.env.GITHUB_JOB}.json`,JSON.stringify({job:process.env.GITHUB_JOB,status:'passed',manifestHash:hash,reportHash:digest(fs.readFileSync(process.env.CANDIDATE_REPORT)),tests:report.stats.expected}));return;
  }
  if(command==='publish') {
    const proofs=fs.readdirSync(dir).filter(f=>f.startsWith('proof-')&&f.endsWith('.json')).map(f=>JSON.parse(fs.readFileSync(path.join(dir,f))));verifyProofs(manifest,proofs);
    assert(!fs.existsSync('_site'),'Unexpected replacement build');fs.cpSync(path.join(dir,'site'),'_site',{recursive:true});return;
  }
  throw new Error(`Unknown candidate command: ${command}`);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv[2]).catch(error=>{console.error(error.message);process.exitCode=1;});
