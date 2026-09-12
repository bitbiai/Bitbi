import { hostingPolicy, prepareFrontend, verifyFrontend, cloudflarePublishedBase } from './lib/frontend-hosting.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { selectCiTests } from './lib/ci-test-selection.mjs';
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
// One selection contract for recording, executing and accepting the unpublished range.
export function requiredJobs(selection) {
  if (!selection) return REQUIRED_JOBS; // Frozen schema-1 Q4 evidence only.
  const jobs = { 'release-compatibility': ['Preflight complete static release plan','Run quality gate tests','Record candidate build', 'Check frontend hosting package'] };
  jobs['release-compatibility'].push(
    'Check committed secrets', 'Check DOM sink baseline', 'Check auth route policy coverage',
    'Check targeted JavaScript syntax', 'Run release compatibility tests', 'Run release planner tests',
    'Run static deploy safety tests', 'Run CI test selection fixtures',
    'Run asset version tests', 'Validate asset version sources',
  );
  if (selection.dependencies) jobs['release-compatibility'].push('Audit root dependencies');
  if (selection.workerDependencies) jobs['release-compatibility'].push('Validate worker package dependencies');
  if (selection.workers) jobs['worker-validation'] = REQUIRED_JOBS['worker-validation'];
  if (selection.homepage || selection.carousel) {
    jobs['homepage-validation'] = REQUIRED_JOBS['homepage-validation'];
    jobs['homepage-webkit-media'] = REQUIRED_JOBS['homepage-webkit-media'];
  }
  const browser = [];
  if (selection.adminRelease) browser.push('Run selected Admin release acceptance');
  else if (selection.full) browser.push('Run full static browser regression');
  else for (const [key,step] of [['homepage','Run selected homepage core tests'],['carousel','Run selected homepage carousel tests'],['assets','Run selected Assets Manager tests'],['auth','Run selected auth and admin tests']]) if (selection[key]) browser.push(step);
  if (browser.length) jobs['browser-validation'] = [...browser,'Confirm tested browser candidate bytes'];
  return jobs;
}
export function proofJobs(selection) {
  return Object.keys(requiredJobs(selection)).filter(job => job.startsWith('homepage-') || (selection && job === 'browser-validation'));
}
// Full is supplementary for impact-selected releases; it is mandatory when
// the change itself selects full acceptance. Normal static failures still block.
export function isRequiredValidationRun(run, selection) {
  return run.path === '.github/workflows/static.yml'
    || run.path === '.github/workflows/ui-fast-deploy.yml'
    || (run.path === '.github/workflows/full-regression.yml' && (!selection || selection.full));
}
export function gitSelection(base, sha) {
  assert(/^[a-f0-9]{40}$/.test(base || ''), 'Missing exact release base');
  assert(/^[a-f0-9]{40}$/.test(sha || ''), 'Missing exact release head');
  execFileSync('git',['merge-base','--is-ancestor',base,sha],{stdio:'pipe'});
  return selectCiTests(execFileSync('git',['diff','--name-only','--no-renames',`${base}...${sha}`,'--'],{encoding:'utf8'}).trim().split('\n').filter(Boolean));
}
export function validatePublishedDeployment(deployment,status,run,job) {
  assert.equal(deployment.environment,'github-pages'); assert.equal(status.state,'success');
  assert(/^[a-f0-9]{40}$/.test(deployment.sha));
  const match=status.log_url?.match(/^https:\/\/github\.com\/bitbiai\/Bitbi\/actions\/runs\/(\d+)\/job\/(\d+)$/);
  assert(match,'Deployment lacks an exact own-repository Actions job');
  assert.equal(String(run.id),match[1]); assert.equal(String(job.id),match[2]);
  assert.equal(run.repository?.full_name,REPOSITORY); assert.equal(run.head_repository?.full_name,REPOSITORY);
  assert.equal(run.head_sha,deployment.sha); assert.equal(job.head_sha,deployment.sha); assert.equal(run.head_branch,'main');
  assert(['.github/workflows/static.yml','.github/workflows/ui-fast-deploy.yml'].includes(run.path));
  assert(['push','workflow_dispatch'].includes(run.event));
  assert.equal(job.status,'completed'); assert.equal(job.conclusion,'success');
  assert(job.steps?.some(s=>s.name==='Deploy to GitHub Pages'&&s.status==='completed'&&s.conclusion==='success'),'No successful Pages write');
  return deployment.sha;
}
async function publishedBase() {
  const policy=fs.existsSync('config/static-hosting.json')?hostingPolicy():null;
  if(policy?.provider==='cloudflare') {
    const hosted=await cloudflarePublishedBase(api,policy);
    if(hosted)return hosted;
  }
  // Only a successful deployment receipt, never a green validation or HEAD^.
  for (let page=1;page<=10;page++) {
    const deployments=await api(`deployments?environment=github-pages&per_page=100&page=${page}`);
    for (const deployment of deployments) {
      const statuses=await api(`deployments/${deployment.id}/statuses?per_page=100`);
      const status=statuses[0];
      if(status?.state!=='success') continue;
      const match=status.log_url?.match(/\/actions\/runs\/(\d+)\/job\/(\d+)$/); assert(match,'Unassigned successful deployment');
      const [run,job]=await Promise.all([api(`actions/runs/${match[1]}`),api(`actions/jobs/${match[2]}`)]);
      const sha=validatePublishedDeployment(deployment,status,run,job);
      if(policy?.provider==='cloudflare') {
        assert.equal(sha,policy.bootstrapPagesSha,'Unreviewed bootstrap Pages SHA');
        assert.equal(deployment.id,policy.bootstrapPagesDeployment,'Unreviewed bootstrap deployment');
      }
      return {sha,deployment:deployment.id,run:run.id};
    }
    if(deployments.length<100) break;
  }
  throw new Error('No verified successful Pages baseline; do not guess an unpublished range');
}
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export function tree(directory) {
  assert(fs.lstatSync(directory).isDirectory()&&!fs.lstatSync(directory).isSymbolicLink(),'Candidate root is not a real directory');
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
  assert([1,2].includes(manifest.schema)); assert.equal(manifest.repository,REPOSITORY);
  for(const field of ['sha','base','run','attempt']) assert.equal(String(manifest[field]),String(expected[field]),`Candidate ${field} mismatch`);
  assert.equal(manifest.mediaPolicy,MEDIA_POLICY,'Different media acceptance policy');
  if (manifest.schema===1) {
    assert.equal(manifest.base,Q4_BASE,'Legacy evidence is Q4-only');
    if (!allowPartial) assert.equal(manifest.full,true,'Not a complete legacy Q4 acceptance');
  } else {
    assert(expected.selection,'Missing expected scope');
    assert.deepEqual(manifest.selection,expected.selection,'Different release/test scope');
    assert.equal(manifest.full,manifest.selection.full,'Do not relabel partial selection as full');
  }
  assert.deepEqual(tree(site),manifest.files,'Static bytes differ from tested candidate');
  return digest(JSON.stringify(manifest));
}
export function validateSource({run,jobs,artifacts,laterRuns,mainSha}, expected, {previewBranch, currentPublication=false}={}) {
  assert.equal(expected.repository,REPOSITORY,'Foreign repository');
  if (!expected.selection) assert.equal(expected.base,Q4_BASE,'Incomplete legacy Q4 release scope');
  assert.equal(mainSha,expected.sha,'Superseded candidate');
  assert.equal(run.repository?.full_name,REPOSITORY); assert.equal(run.head_repository?.full_name,REPOSITORY);
  assert.equal(run.head_sha,expected.sha,'Source SHA mismatch'); assert.equal(run.head_branch,previewBranch||'main');
  if(previewBranch && previewBranch!=='main')assert.equal(run.event,'workflow_dispatch','Branch preview must use explicit dispatch');
  assert.equal(String(run.id),String(expected.run)); assert.equal(String(run.run_attempt),String(expected.attempt),'Source attempt mismatch');
  assert.equal(run.path,'.github/workflows/static.yml','Wrong validation workflow');
  assert(['push','workflow_dispatch'].includes(run.event),'Untrusted source event');
  if(currentPublication) {
    assert(!previewBranch);assert.equal(String(run.id),String(expected.currentRun));
    assert.equal(run.status,'in_progress');
    assert(jobs.some(j=>j.name==='deploy'&&j.status==='in_progress'),'No current publishing job');
  } else {
    assert.equal(run.status,'completed');
    assert(['success','failure'].includes(run.conclusion),'Source acceptance cancelled or incomplete');
  }
  if(previewBranch) {assert.equal(run.conclusion,'success');assert(jobs.some(j=>j.name==='deploy'&&j.conclusion==='skipped'),'Preview unexpectedly published');}
  if(run.conclusion==='failure') {
    assert(jobs.some(j=>j.name==='deploy'&&j.conclusion==='failure'),'Unexplained source failure');
    assert(jobs.filter(j=>j.name!=='deploy').every(j=>['success','skipped'].includes(j.conclusion)),'Source validation failed');
  }
  for(const [name,steps] of Object.entries(requiredJobs(expected.selection))) {
    const found=jobs.filter(j=>j.name===name); assert.equal(found.length,1,`Missing/duplicate suite ${name}`);
    const j=found[0]; assert.equal(j.head_sha,expected.sha); assert.equal(j.status,'completed'); assert.equal(j.conclusion,'success',`Suite ${name} did not pass`);
    for(const name of steps) assert(j.steps?.some(s=>s.name===name&&s.status==='completed'&&s.conclusion==='success'),`Required step did not execute: ${name}`);
  }
  // Never select an older green run around a known later failure or pending
  // validation of this SHA. The current publication request is not validation.
  for(const later of laterRuns.filter(r=>String(r.id)!==String(expected.currentRun)&&Date.parse(r.created_at)>Date.parse(run.created_at))) {
    // Extended/scheduled Full regression is separate from a narrow release's
    // selected acceptance. Never use it to certify or replace that acceptance.
    if (expected.selection && !expected.selection.full && later.path === '.github/workflows/full-regression.yml') continue;
    // A publish-only failure is not a new functional failure. Actual skipped
    // validation jobs plus the explicit reuse job distinguish that path.
    if(later.jobs?.some(j=>j.name==='reuse-candidate') && Object.keys(REQUIRED_JOBS).every(name=>later.jobs.some(j=>j.name===name&&j.conclusion==='skipped')))continue;
    assert.equal(later.status,'completed','Later validation is unresolved');
    assert.equal(later.conclusion,'success','Later candidate failure blocks reuse');
  }
  const suffix=`${expected.sha}-${expected.run}-${expected.attempt}`;
  const names=[`pages-candidate-${suffix}`,...proofJobs(expected.selection).map(job=>`pages-proof-${job}-${suffix}`)];
  return names.map(name=>{
    const found=artifacts.filter(a=>a.name===name); assert.equal(found.length,1,`Missing/ambiguous artifact ${name}`);
    const a=found[0];assert.equal(a.expired,false,'Expired candidate artifact');assert(a.size_in_bytes>0);
    assert.equal(a.workflow_run?.id,Number(expected.run));assert.equal(a.workflow_run?.head_sha,expected.sha);
    assert(/^sha256:[a-f0-9]{64}$/.test(a.digest),'Missing immutable artifact digest'); return a;
  });
}
export function verifyProofs(manifest,proofs) {
  for(const job of [...proofJobs(manifest.selection),...(manifest.hosting?['frontend-runtime']:[])]) {
    const p=proofs.find(p=>p.job===job); assert(p,`Missing tested build proof ${job}`);
    assert.equal(p.manifestHash,digest(JSON.stringify(manifest)),'Different OS build inputs');
    assert.equal(p.status,'passed');assert(p.reportHash&&p.tests>0,'No executed browser report');
  }
}
// Bind each discovered required case to its executed result in the same job.
// Discovery alone is not acceptance; neither a healthy neighbour nor a skip
// can substitute for a missing News/Admin/MFA/smoke scenario.
export function verifyAdminReport(report, discovery, scopes = [
    ['reader',['oma2-q3-newsfeed.spec.js','oma2-q3-shell.spec.js','oma2-q3-auth-lifecycle.spec.js']],
    ['mfa',['auth-admin.spec.js']],['smoke',['smoke.spec.js']],
  ]) {
  const collect = report => {
    const rows=[];
    const visit=suite=>{for(const spec of suite.specs||[])for(const test of spec.tests||[])
      rows.push({key:`${test.projectName}:${spec.id}`,project:test.projectName,file:path.basename(spec.file),results:test.results||[]});
      (suite.suites||[]).forEach(visit);}; (report.suites||[]).forEach(visit); return rows;
  };
  const expected=collect(discovery), actual=collect(report);
  for(const engine of ['chromium','webkit'])for(const [scope,files] of scopes)for(const file of files)assert(expected.some(r=>r.project===`${engine}-${scope}`&&r.file===file),`Missing required Admin discovery ${engine}/${file}`);
  assert.equal(new Set(expected.map(r=>r.key)).size,expected.length,'Duplicate Admin discovery');
  assert.equal(actual.length,expected.length,'Admin case set changed after discovery');
  for(const e of expected) {
    const found=actual.filter(r=>r.key===e.key&&r.file===e.file);
    assert.equal(found.length,1,`Missing executed Admin case ${e.key}/${e.file}`);
    assert.deepEqual(found[0].results.map(r=>r.status),['passed'],`Admin case did not pass without retry: ${e.key}/${e.file}`);
  }
}

export function verifyAssetReport(report, discovery) {
  verifyAdminReport(report, discovery, [['cards',['assets-manager-focused.spec.js']],['jobs',['oma2-q1-member.spec.js']],['actions',['auth-admin.spec.js']]]);
}

export async function api(endpoint) {
  assert(process.env.GH_TOKEN,'Missing read-only Actions token');
  const response=await fetch(`https://api.github.com/repos/${REPOSITORY}/${endpoint}`,{headers:{Authorization:`Bearer ${process.env.GH_TOKEN}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(20000)});
  assert(response.ok,`GitHub ${endpoint.split('?')[0]} returned ${response.status}`);return response.json();
}
export async function collection(endpoint,key) {
  const rows=[];
  for(let page=1;page<=10;page++) { const data=await api(`${endpoint}${endpoint.includes('?')?'&':'?'}per_page=100&page=${page}`);rows.push(...data[key]);if(rows.length>=data.total_count)return rows; }
  throw new Error('Evidence pagination exceeded bounded scope');
}
function expected(env=process.env) { return {repository:env.GITHUB_REPOSITORY,sha:env.GITHUB_SHA,base:env.CANDIDATE_BASE,run:env.CANDIDATE_RUN||env.GITHUB_RUN_ID,attempt:env.CANDIDATE_ATTEMPT||env.GITHUB_RUN_ATTEMPT,currentRun:env.GITHUB_RUN_ID}; }
function policyName(){return fs.existsSync('config/static-hosting.json')?hostingPolicy().provider:'github-pages';}
async function main(command) {
  const e=expected(),dir='candidate',manifestFile=path.join(dir,'manifest.json');
  if(command==='baseline') {
    const published=await publishedBase();
    const supplied=process.env.RELEASE_BASE_INPUT || '';
    const base=supplied ? execFileSync('git',['rev-parse','--verify',`${supplied}^{commit}`],{encoding:'utf8'}).trim() : published.sha;
    // An explicit historical range can be wider, never omit undelivered inputs.
    execFileSync('git',['merge-base','--is-ancestor',base,published.sha],{stdio:'pipe'});
    gitSelection(base,e.sha);
    if(process.env.GITHUB_ENV)fs.appendFileSync(process.env.GITHUB_ENV,`CANDIDATE_BASE=${base}\n`);
    if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,`base=${base}\n`);
    console.log(`Verified published ${policyName()} baseline ${published.sha} (deployment ${published.deployment}); release base ${base}`);return;
  }
  e.selection=gitSelection(e.base,e.sha);
  if(command==='current') {
    assert.equal((await api('git/ref/heads/main')).object.sha,e.sha,'Superseded candidate');
    if (fs.existsSync('config/static-hosting.json')) {
      const remote=await api('contents/config/static-hosting.json?ref=main');
      assert.deepEqual(JSON.parse(Buffer.from(remote.content,'base64')),hostingPolicy(),'Hosting authority changed');
    }
    return;
  }
  if(command==='source') {
    assert(/^\d+$/.test(e.run||'')&&/^\d+$/.test(e.attempt||''),'Explicit source run/attempt required');
    const [run,jobs,artifacts,laterRuns,ref]=await Promise.all([api(`actions/runs/${e.run}`),collection(`actions/runs/${e.run}/attempts/${e.attempt}/jobs`,'jobs'),collection(`actions/runs/${e.run}/artifacts`,'artifacts'),collection(`actions/runs?head_sha=${e.sha}`,'workflow_runs'),api('git/ref/heads/main')]);
    const relevant=laterRuns.filter(r=>isRequiredValidationRun(r,e.selection));
    for(const later of relevant.filter(r=>String(r.id)!==String(e.currentRun)&&Date.parse(r.created_at)>Date.parse(run.created_at)&&r.conclusion!=='success'))later.jobs=await collection(`actions/runs/${later.id}/attempts/${later.run_attempt}/jobs`,'jobs');
    const selected=validateSource({run,jobs,artifacts,laterRuns:relevant,mainSha:ref.object.sha},e);
    if(process.env.CANDIDATE_ARTIFACT_IDS)assert.equal(selected.map(a=>a.id).join(','),process.env.CANDIDATE_ARTIFACT_IDS,'Candidate artifacts changed after selection');
    fs.writeFileSync('candidate-source.json',JSON.stringify({expected:e,artifacts:selected.map(({id,name,digest})=>({id,name,digest}))}));
    if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,`artifact_ids=${selected.map(a=>a.id).join(',')}\n`);
    console.log(`Accepted exact source ${e.run}/${e.attempt} for ${e.sha}`);return;
  }
  if(command==='record') {
    assert.equal(e.repository,REPOSITORY);assert.equal(process.env.CANDIDATE_FULL,String(e.selection.full),'Selection and build scope differ');
    fs.mkdirSync(dir,{recursive:true});fs.cpSync('_site',path.join(dir,'site'),{recursive:true});
    const manifest={schema:2,selection:e.selection,repository:e.repository,sha:e.sha,base:e.base,run:String(e.run),attempt:String(e.attempt),full:process.env.CANDIDATE_FULL==='true',mediaPolicy:MEDIA_POLICY,files:tree('_site')};
    if (fs.existsSync('frontend/wrangler.jsonc')) prepareFrontend(manifest,tree);
    fs.writeFileSync(manifestFile,JSON.stringify(manifest));return;
  }
  const manifest=JSON.parse(fs.readFileSync(manifestFile));
  if (manifest.hosting) verifyFrontend(manifest,tree);
  if(manifest.schema===1)delete e.selection;
  const hash=verifyManifest(manifest,e,path.join(dir,'site'),{allowPartial:command!=='publish'});
  if(command==='restore') {assert(!fs.existsSync('_site'),'Refuse to replace an existing test/build server input');fs.cpSync(path.join(dir,'site'),'_site',{recursive:true});return;}
  if(command==='proof') {
    verifyManifest(manifest,e,'_site',{allowPartial:true});
    assert(proofJobs(manifest.selection).includes(process.env.GITHUB_JOB),'Unselected browser proof');
    const names=process.env.GITHUB_JOB==='browser-validation'
      ? (manifest.selection.adminRelease ? ['admin-release'] : manifest.selection.full ? ['static','carousel'] : ['homepage','carousel','assets','auth'].filter(key=>manifest.selection[key])).map(key=>`test-results/candidate-${key}.json`)
      : [process.env.CANDIDATE_REPORT];
    const reports=names.map(name=>JSON.parse(fs.readFileSync(name)));
    for(const report of reports) {
      const broad = process.env.GITHUB_JOB === 'browser-validation';
      assert((report.stats.expected + (broad ? report.stats.flaky : 0))>0&&report.stats.unexpected===0&&(broad||report.stats.flaky===0),'Browser acceptance missing or failed');
      let executed=0;
      const visit=suite=>{for(const spec of suite.specs||[])for(const test of spec.tests||[]) {
        const final = test.results?.at(-1);
        assert(!['failed','timedOut','interrupted'].includes(final?.status),'Failed browser result');
        if(final?.status==='passed')executed++;
      }(suite.suites||[]).forEach(visit);};(report.suites||[]).forEach(visit);
      assert(executed>0,'No executed cases');
    }
    const report=reports[0];
    if (manifest.selection?.assets && !manifest.selection.full && process.env.GITHUB_JOB === 'browser-validation') verifyAssetReport(reports[names.indexOf('test-results/candidate-assets.json')], JSON.parse(fs.readFileSync('test-results/assets-discovery.json')));
    if (manifest.selection?.adminRelease) verifyAdminReport(report, JSON.parse(fs.readFileSync('test-results/admin-discovery.json')));
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
    fs.mkdirSync('candidate-proofs',{recursive:true});fs.writeFileSync(`candidate-proofs/proof-${process.env.GITHUB_JOB}.json`,JSON.stringify({job:process.env.GITHUB_JOB,status:'passed',manifestHash:hash,reportHash:digest(JSON.stringify(reports)),tests:reports.reduce((n,r)=>n+r.stats.expected+r.stats.flaky,0)}));return;
  }
  if(command==='publish') {
    const proofs=fs.readdirSync(dir).filter(f=>f.startsWith('proof-')&&f.endsWith('.json')).map(f=>JSON.parse(fs.readFileSync(path.join(dir,f))));verifyProofs(manifest,proofs);
    assert(!fs.existsSync('_site'),'Unexpected replacement build');fs.cpSync(path.join(dir,'site'),'_site',{recursive:true});return;
  }
  throw new Error(`Unknown candidate command: ${command}`);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv[2]).catch(error=>{console.error(error.message);process.exitCode=1;});
