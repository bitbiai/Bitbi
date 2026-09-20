// A release-ending processor repair can reuse an independently accepted static
// package. The package keeps its ORIGINAL SHA/run/proofs; only the closed repair
// delta receives new acceptance. This is not a general cross-SHA test cache.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {api,collection,sourceAttempt,validateSource,gitSelection,isRequiredValidationRun,requiredJobs,REPOSITORY} from '../pages-candidate.mjs';
export const MEDIA_REPAIR_FILES=new Set([
  'services/homepage-ffmpeg-processor/video-reference.mjs',
  'services/homepage-ffmpeg-processor/video-reference.test.mjs',
  'services/homepage-ffmpeg-processor/canvas-full-video.mjs',
  'workers/auth/src/lib/private-media-smoke.js','tests/helpers/private-media-control.mjs',
  'scripts/private-media-image.mjs','scripts/lib/media-publication.mjs',
  'scripts/lib/backend-publication.mjs','scripts/lib/media-repair-source.mjs',
  'scripts/pages-candidate.mjs','scripts/lib/frontend-source.mjs',
  'scripts/frontend-release.mjs','scripts/lib/frontend-receipts.mjs',
  'scripts/select-ci-tests.mjs','scripts/lib/ci-test-selection.mjs',
  '.github/workflows/static.yml','scripts/test-pages-candidate.mjs',
  'scripts/test-pages-workflow.mjs','scripts/test-frontend-review.mjs',
  'scripts/test-ci-test-selection.mjs','scripts/test-release-plan.mjs',
  'docs/runbooks/REGRESSION_REGISTER.md',
]);
const git=args=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
export function assertRepairFiles(files) {
  assert(files.length>0&&files.includes('services/homepage-ffmpeg-processor/video-reference.mjs'),'Not a reference processor repair');
  assert(files.every(f=>MEDIA_REPAIR_FILES.has(f)),'Changed input is outside media repair equivalence');
}
export function repairDelta(source,head,base) {
  for(const sha of [source,head,base])assert(/^[a-f0-9]{40}$/.test(sha||''),'Exact repair identities required');
  git(['merge-base','--is-ancestor',base,source]);git(['merge-base','--is-ancestor',source,head]);
  const files=git(['diff','--name-only','--no-renames',source,head]).split('\n').filter(Boolean);assertRepairFiles(files);return files;
}
export function repairSelection(full,files) {
  assertRepairFiles(files);
  return {...full,policy:'media-repair-v1',docsOnly:false,memberModels:false,full:false,homepage:false,homepageMedia:false,carousel:false,assets:false,auth:false,
    adminRelease:false,memberAssets:false,publicMedia:false,modelStatus:false,canvasText:false,workspaceHelp:false,
    workers:true,mediaLifecycle:true,static:true,mediaRepair:true,dependencies:false,workerDependencies:false,
    reasons:{...Object.fromEntries(Object.keys(full.reasons).map(k=>[k,[]])),workers:['Fresh processor Linux image, native D1/R2 smoke and SDK lifecycle'],static:['Authenticated unchanged frontend source; no new browser execution claimed'],dependencies:[],workerDependencies:[]}};
}
export function assertRepairAcceptance(jobs,sha) {
  const requirements=requiredJobs({workers:true,mediaLifecycle:true,files:['services/homepage-ffmpeg-processor/video-reference.mjs']});
  requirements['release-compatibility']=requirements['release-compatibility'].filter(s=>s!=='Record candidate build');
  requirements['release-compatibility'].push('Select tests from changed files');
  requirements['worker-validation'].push('Verify repaired native media smoke');
  for(const [name,steps] of Object.entries(requirements)) {
    const found=jobs.filter(j=>j.name===name);assert.equal(found.length,1,'Missing repair job');const j=found[0];
    assert.equal(j.head_sha,sha);assert.equal(j.status,'completed');assert.equal(j.conclusion,'success');
    for(const step of steps)assert(j.steps.some(s=>s.name===step&&s.status==='completed'&&s.conclusion==='success'),`Missing repair acceptance: ${step}`);
  }
}
export async function verifyRepairSource(env=process.env,{complete=false}={}) {
  const sha=env.REPAIR_SOURCE_SHA,head=env.GITHUB_SHA,base=env.CANDIDATE_BASE;
  const files=repairDelta(sha,head,base);
  assert.equal(env.GITHUB_REPOSITORY,REPOSITORY);assert.equal(env.GITHUB_REF,'refs/heads/main');
  const e={repository:REPOSITORY,sha,publicationSha:head,base,run:env.REPAIR_SOURCE_RUN,attempt:env.REPAIR_SOURCE_ATTEMPT,currentRun:env.GITHUB_RUN_ID,selection:gitSelection(base,sha)};
  const [run,jobs,artifacts,later,ref]=await Promise.all([sourceAttempt(e.run,e.attempt,e.selection),collection(`actions/runs/${e.run}/attempts/${e.attempt}/jobs`,'jobs'),collection(`actions/runs/${e.run}/artifacts`,'artifacts'),collection(`actions/runs?head_sha=${sha}`,'workflow_runs'),api('git/ref/heads/main')]);
  const relevant=later.filter(r=>isRequiredValidationRun(r,e.selection));
  for(const r of relevant.filter(r=>Date.parse(r.created_at)>Date.parse(run.created_at)&&r.conclusion!=='success'))r.jobs=await collection(`actions/runs/${r.id}/attempts/${r.run_attempt}/jobs`,'jobs');
  const selected=validateSource({run,jobs,artifacts,laterRuns:relevant,mainSha:ref.object.sha},e,{mediaRepair:true});
  assert(selected.every(a=>Date.parse(a.expires_at)>Date.now()),'Expired repair source');
  // Any newer attempt at the repair head must also be accounted for.
  const currentRuns=await collection(`actions/runs?head_sha=${head}`,'workflow_runs');
  for(const r of currentRuns.filter(r=>String(r.id)!==String(env.GITHUB_RUN_ID)&&isRequiredValidationRun(r,repairSelection(e.selection,files)))) {
    assert.equal(r.status,'completed','Another repair validation is running');
    const rs=await collection(`actions/runs/${r.id}/attempts/${r.run_attempt}/jobs`,'jobs');
    assertRepairAcceptance(rs,head);
  }
  if(complete)assertRepairAcceptance(await collection(`actions/runs/${env.GITHUB_RUN_ID}/attempts/${env.GITHUB_RUN_ATTEMPT}/jobs`,'jobs'),head);
  return {expected:e,files,artifacts:selected};
}
export async function discoverRepairSource(env=process.env) {
  // Only main's own completed run, still within the unpublished range. No
  // stale success, PR source, changing UI bytes or missing cases qualifies.
  if(env.GITHUB_REF!=='refs/heads/main')return null;
  const runs=await api('actions/workflows/static.yml/runs?branch=main&per_page=20');
  for(const r of runs.workflow_runs.filter(r=>r.status==='completed'&&['success','failure'].includes(r.conclusion))) {
    try {repairDelta(r.head_sha,env.GITHUB_SHA,env.CANDIDATE_BASE);}catch{continue;}
    // Once a matching source is found, fail closed on invalid evidence rather
    // than searching past it for older green results.
    const inputs={REPAIR_SOURCE_SHA:r.head_sha,REPAIR_SOURCE_RUN:String(r.id),REPAIR_SOURCE_ATTEMPT:String(r.run_attempt)};
    return {...inputs,...await verifyRepairSource({...env,...inputs})};
  }
  return null;
}
