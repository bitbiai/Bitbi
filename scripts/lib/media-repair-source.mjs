// A closed release-ending repair can reuse an independently accepted static
// package. The package keeps its ORIGINAL SHA/run/proofs; only the closed repair
// delta receives new acceptance. This is not a general cross-SHA test cache.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {api,collection,sourceAttempt,validateSource,gitSelection,isRequiredValidationRun,requiredJobs,REPOSITORY} from '../pages-candidate.mjs';
import {SEEDANCE_BROWSER_REPAIR,SEEDANCE_BROWSER_REPAIR_FILES,BROWSER_REPAIR,OMNI_BROWSER_REPAIR,OMNI_BROWSER_REPAIR_FILES,BROWSER_REPAIR_ACCEPTANCE,BROWSER_REPAIR_FILES,assertBrowserRepairTrees,assertBrowserPublicationTree,assertCompletedBrowserRepair} from './browser-fixture-repair.mjs';
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
// Release-reference validation may change without changing any tested website,
// backend, build, configuration or product-test bytes. This is a distinct policy
// from processor repair: it must not allocate media/Worker/browser validation.
export const TOOLING_REPAIR_FILES=new Set([
  '.github/workflows/static.yml','scripts/validate-site-references.mjs',
  'scripts/lib/media-repair-source.mjs','scripts/lib/backend-publication.mjs',
  'scripts/lib/backend-continuation.mjs','scripts/lib/ci-test-selection.mjs',
  'scripts/frontend-release.mjs','scripts/lib/frontend-receipts.mjs',
  'scripts/check-static-deploy-safety.mjs','scripts/test-static-deploy-safety.mjs',
  'scripts/test-pages-candidate.mjs','scripts/test-pages-workflow.mjs',
  'scripts/test-frontend-review.mjs','docs/runbooks/REGRESSION_REGISTER.md',
  'scripts/lib/image-delivery-acceptance.mjs','scripts/test-release-plan.mjs',
]);
// This candidate completed every selected product check, then stopped before
// schema/code activation because 0098 was absent from the deployment allowlist.
export const MODEL_AREA_SCHEMA_REPAIR=Object.freeze({sha:'eac93008c61a803b95554c7b50a5569b5191f3ae',run:'37119971202',attempt:'1',authVersion:'82d1f19a-90ea-45a3-90bf-f37f7f418235',activation:{sha:'d3e3602b8334e4126a37ddf0e7637bedc7662141',run:'37120854735',attempt:'1'}});
export function isModelAreaSchemaRepair(files) {
  return ['scripts/lib/backend-publication.mjs','scripts/lib/media-repair-source.mjs','scripts/test-release-plan.mjs'].every(f=>files.includes(f)) &&
    files.every(f=>['scripts/lib/backend-publication.mjs','scripts/lib/media-repair-source.mjs','scripts/test-release-plan.mjs','scripts/lib/frontend-receipts.mjs','scripts/test-frontend-review.mjs','docs/runbooks/REGRESSION_REGISTER.md'].includes(f)) &&
    files.includes('scripts/lib/frontend-receipts.mjs')===files.includes('scripts/test-frontend-review.mjs');
}
const git=args=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
export function repairKind(files) {
  if(isModelAreaSchemaRepair(files))return 'tooling';
  if(files.includes('tests/canvas.spec.js')&&files.includes('scripts/lib/browser-fixture-repair.mjs')) {
    assert(['tests/auth-admin.spec.js','tests/oma2-q1-member.spec.js','tests/oma2-q1-canvas.spec.js','tests/smoke.spec.js','tests/helpers/generation-selectors.cjs','scripts/lib/browser-fixture-repair.mjs','scripts/test-browser-fixture-repair.mjs','scripts/lib/media-repair-source.mjs'].every(f=>files.includes(f)),'Incomplete reviewed Seedance browser fixture repair');
    assert(files.every(f=>SEEDANCE_BROWSER_REPAIR_FILES.has(f)),'Changed input is outside Seedance browser fixture equivalence');
    return 'browser-fixture';
  }
  if(files.includes('tests/helpers/generation-selectors.cjs')) {
    assert(['tests/auth-admin.spec.js','scripts/lib/browser-fixture-repair.mjs','scripts/test-browser-fixture-repair.mjs','scripts/lib/media-repair-source.mjs','scripts/lib/frontend-source.mjs','scripts/pages-candidate.mjs'].every(f=>files.includes(f)),'Incomplete reviewed Omni browser fixture repair');
    assert(files.every(f=>OMNI_BROWSER_REPAIR_FILES.has(f)),'Changed input is outside Omni browser fixture equivalence');
    return 'browser-fixture';
  }
  if(files.includes('tests/auth-admin.spec.js')||files.includes('tests/website-assistant.spec.js')) {
    assert(['tests/auth-admin.spec.js','tests/website-assistant.spec.js','.github/workflows/static.yml','scripts/lib/browser-fixture-repair.mjs','scripts/test-browser-fixture-repair.mjs'].every(f=>files.includes(f)),'Incomplete reviewed browser fixture repair');
    assert(files.every(f=>BROWSER_REPAIR_FILES.has(f)),'Changed input is outside browser fixture equivalence');
    if(files.includes('scripts/lib/media-publication.mjs')) {
      assert(['scripts/test-release-plan.mjs','scripts/test-media-auth-config.mjs'].every(f=>files.includes(f)),'Publication guard repair lacks its focused regression/caller');
      return 'browser-publication';
    }
    return 'browser-fixture';
  }
  if(files.includes('scripts/validate-site-references.mjs')||files.includes('scripts/lib/image-delivery-acceptance.mjs')) {
    assert(files.includes('.github/workflows/static.yml'),'Reference repair lacks its real workflow caller');
    if(files.includes('scripts/lib/image-delivery-acceptance.mjs'))assert(['scripts/lib/backend-publication.mjs','scripts/test-release-plan.mjs'].every(f=>files.includes(f)),'Recovery acceptance repair lacks its caller/regression');
    assert(files.every(f=>TOOLING_REPAIR_FILES.has(f)),'Changed input is outside release tooling equivalence');
    return 'tooling';
  }
  assert(files.length>0&&files.includes('services/homepage-ffmpeg-processor/video-reference.mjs'),'Not a closed release repair');
  assert(files.every(f=>MEDIA_REPAIR_FILES.has(f)),'Changed input is outside media repair equivalence');
  return 'media';
}
export function assertRepairFiles(files) { repairKind(files); }
export function assertUnchangedReleaseInputs(source,head) {
  // Compare the complete protected Git trees independently of the name-only
  // selector: object hashes, modes and types catch changed/deleted/new inputs.
  const entries=sha=>git(['ls-tree','-rz',sha]).split('\0').filter(Boolean).map(line=>{
    const [identity,file]=line.split('\t');
    assert(identity&&file,'Invalid Git tree entry');return {identity,file};
  });
  const before=entries(source),after=entries(head);
  const protectedTree=rows=>rows.filter(row=>!TOOLING_REPAIR_FILES.has(row.file));
  assert.deepEqual(protectedTree(after),protectedTree(before),'Tested website/backend/build inputs changed');
  for(const row of after.filter(row=>TOOLING_REPAIR_FILES.has(row.file)))assert(/^100(?:644|755) blob [a-f0-9]{40}$/.test(row.identity),'Repair tooling must remain regular Git files');
}
export function repairDelta(source,head,base) {
  for(const sha of [source,head,base])assert(/^[a-f0-9]{40}$/.test(sha||''),'Exact repair identities required');
  git(['merge-base','--is-ancestor',base,source]);git(['merge-base','--is-ancestor',source,head]);
  const files=git(['diff','--name-only','--no-renames',source,head]).split('\n').filter(Boolean);assertRepairFiles(files);
  if(isModelAreaSchemaRepair(files))assert.equal(source,MODEL_AREA_SCHEMA_REPAIR.sha,'Unreviewed schema-admission source');
  if(repairKind(files)==='tooling')assertUnchangedReleaseInputs(source,head);
  if(['browser-fixture','browser-publication'].includes(repairKind(files)))assertBrowserRepairTrees(source,head);
  if(repairKind(files)==='browser-publication')assertBrowserPublicationTree(head);
  return files;
}
export function repairSelection(full,files) {
  const kind=repairKind(files),media=kind==='media',browser=kind==='browser-fixture';
  return {...full,policy:browser?BROWSER_REPAIR.policy:kind==='browser-publication'?'browser-fixture-publication-v1':media?'media-repair-v1':'release-tooling-repair-v1',docsOnly:false,memberModels:false,full:false,homepage:false,carousel:false,assets:false,auth:browser,browserRepair:browser,
    adminRelease:false,memberAssets:false,publicMedia:false,modelStatus:false,canvasText:false,workspaceHelp:false,
    appearance:false,modelPricing:false,imageModels:false,workers:media,mediaLifecycle:media,runtime:media,static:true,mediaRepair:media,dependencies:false,workerDependencies:false,
    reasons:{...Object.fromEntries(Object.keys(full.reasons).map(k=>[k,[]])),workers:media?['Fresh processor Linux image, native D1/R2 smoke and SDK lifecycle']:[],auth:browser?['Execute the incident-specific repaired definitions and controls; complete any unexecuted command tail']:[],static:[browser?'Preserve authenticated unchanged source cases; require fresh repaired/control/tail browser execution':'Authenticated unchanged frontend source; no new browser execution claimed'],dependencies:[],workerDependencies:[]}};
}
export function assertRepairAcceptance(jobs,sha,files=['services/homepage-ffmpeg-processor/video-reference.mjs']) {
  const kind=repairKind(files),media=kind==='media',browser=kind==='browser-fixture';
  const requirements=requiredJobs({workers:media,mediaLifecycle:media,browserRepair:browser,files});
  requirements['release-compatibility']=requirements['release-compatibility'].filter(s=>s!=='Record candidate build');
  requirements['release-compatibility'].push('Select tests from changed files');
  if(media)requirements['worker-validation'].push('Verify repaired native media smoke');
  else requirements['release-compatibility'].push('Validate static website references');
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
  const kind=repairKind(files);
  const selected=validateSource({run,jobs,artifacts,laterRuns:relevant,mainSha:ref.object.sha},e,{mediaRepair:true,browserRepair:['browser-fixture','browser-publication'].includes(kind)});
  let completedBrowserArtifact;
  if(kind==='browser-publication') {
    const accepted=BROWSER_REPAIR_ACCEPTANCE,selection={browserRepair:true};
    const [acceptedRun,acceptedJobs,acceptedArtifacts,acceptedLater]=await Promise.all([
      sourceAttempt(accepted.run,accepted.attempt,selection),collection(`actions/runs/${accepted.run}/attempts/${accepted.attempt}/jobs`,'jobs'),
      collection(`actions/runs/${accepted.run}/artifacts`,'artifacts'),collection(`actions/runs?head_sha=${accepted.publicationSha}`,'workflow_runs'),
    ]);
    completedBrowserArtifact=assertCompletedBrowserRepair({run:acceptedRun,jobs:acceptedJobs,artifacts:acceptedArtifacts});
    assertRepairAcceptance(acceptedJobs,accepted.publicationSha,repairDelta(sha,accepted.publicationSha,base));
    for(const later of acceptedLater.filter(r=>String(r.id)!==accepted.run&&isRequiredValidationRun(r,selection)&&Date.parse(r.created_at)>Date.parse(acceptedRun.created_at))) {
      assert.equal(later.status,'completed','Later repaired browser validation is unresolved');assert.equal(later.conclusion,'success','Later repaired browser failure blocks publication');
    }
  }
  assert(selected.every(a=>Date.parse(a.expires_at)>Date.now()),'Expired repair source');
  // Any newer attempt at the repair head must also be accounted for.
  const currentRuns=await collection(`actions/runs?head_sha=${head}`,'workflow_runs');
  for(const r of currentRuns.filter(r=>String(r.id)!==String(env.GITHUB_RUN_ID)&&isRequiredValidationRun(r,repairSelection(e.selection,files)))) {
    assert.equal(r.status,'completed','Another repair validation is running');
    const rs=await collection(`actions/runs/${r.id}/attempts/${r.run_attempt}/jobs`,'jobs');
    assertRepairAcceptance(rs,head,files);
  }
  if(complete)assertRepairAcceptance(await collection(`actions/runs/${env.GITHUB_RUN_ID}/attempts/${env.GITHUB_RUN_ATTEMPT}/jobs`,'jobs'),head,files);
  return {expected:e,files,artifacts:selected,completedBrowserArtifact};
}
export async function discoverRepairSource(env=process.env,{verify=verifyRepairSource,read=api}={}) {
  // Only main's own completed run, still within the unpublished range. No
  // stale success, PR source, changing UI bytes or missing cases qualifies.
  if(env.GITHUB_REF!=='refs/heads/main')return null;
  // A known continuation has an exact source. Do not depend on a recent-runs
  // listing and silently allocate passed product suites if discovery misses it.
  const schemaIntended=env.GITHUB_SHA!==MODEL_AREA_SCHEMA_REPAIR.sha&&(()=>{try {
    git(['merge-base','--is-ancestor',env.CANDIDATE_BASE,MODEL_AREA_SCHEMA_REPAIR.sha]);
    return git(['show',`${env.GITHUB_SHA}:scripts/lib/media-repair-source.mjs`]).includes(MODEL_AREA_SCHEMA_REPAIR.sha);
  }catch{return false;}})();
  if(schemaIntended) {
    const inputs={REPAIR_SOURCE_SHA:MODEL_AREA_SCHEMA_REPAIR.sha,REPAIR_SOURCE_RUN:MODEL_AREA_SCHEMA_REPAIR.run,REPAIR_SOURCE_ATTEMPT:MODEL_AREA_SCHEMA_REPAIR.attempt};
    return {...inputs,...await verify({...env,...inputs})};
  }
  // This incident cannot silently fall back to the already completed broad
  // suite when its intended continuation has invalid files/evidence.
  const intended=[SEEDANCE_BROWSER_REPAIR,OMNI_BROWSER_REPAIR,BROWSER_REPAIR].find(incident=>{try {
    // The source push itself executes its normal selected acceptance. Only a
    // later reviewed correction may enter this continuation.
    if(env.GITHUB_SHA===incident.sha)return false;
    git(['merge-base','--is-ancestor',env.CANDIDATE_BASE,incident.sha]);
    return git(['show',`${env.GITHUB_SHA}:scripts/lib/browser-fixture-repair.mjs`]).includes(incident.sha);
  }catch{return false;}});
  if(intended) {
    const inputs={REPAIR_SOURCE_SHA:intended.sha,REPAIR_SOURCE_RUN:intended.run,REPAIR_SOURCE_ATTEMPT:intended.attempt};
    return {...inputs,...await verify({...env,...inputs})};
  }
  const runs=await read('actions/workflows/static.yml/runs?branch=main&per_page=20');
  for(const r of runs.workflow_runs.filter(r=>r.status==='completed'&&['success','failure'].includes(r.conclusion))) {
    try {repairDelta(r.head_sha,env.GITHUB_SHA,env.CANDIDATE_BASE);}catch{continue;}
    const jobs=await collection(`actions/runs/${r.id}/attempts/${r.run_attempt}/jobs`,'jobs');
    // A completed publish-only continuation has no new validation/artifacts.
    // Only this positively identified shape may be passed over, never a red suite.
    if(jobs.some(j=>j.name==='reuse-candidate'&&j.status==='completed'&&j.conclusion==='success')&&Object.keys(requiredJobs(gitSelection(env.CANDIDATE_BASE,r.head_sha))).every(name=>jobs.filter(j=>j.name===name).length===1&&jobs.some(j=>j.name===name&&j.status==='completed'&&j.conclusion==='skipped')))continue;
    // Once a matching source is found, fail closed on invalid evidence rather
    // than searching past it for older green results.
    const inputs={REPAIR_SOURCE_SHA:r.head_sha,REPAIR_SOURCE_RUN:String(r.id),REPAIR_SOURCE_ATTEMPT:String(r.run_attempt)};
    return {...inputs,...await verify({...env,...inputs})};
  }
  return null;
}
