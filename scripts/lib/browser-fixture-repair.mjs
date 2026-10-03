// One reviewed incident, not a general test cache. Original failed evidence is
// immutable; only the repaired definitions and the unexecuted command run again.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {CANVAS_RELEASE_SCOPES,canvasReleaseProject} from './homepage-test-selection.mjs';

export const BROWSER_REPAIR = Object.freeze({
  policy:'browser-fixture-repair-v1',
  sha:'81d0eb6bb3a44666b3b94f2ea74935ca30e821e6',run:'36908129676',attempt:'1',
  artifact:11189078669,artifactName:'playwright-report-selected',
  archiveHash:'ad154a1f65e02ebc1a08eb2ff30b9f65b693a88f631eb1799c9162afe1f3b62c',
  reportHash:'77dc56899e75f19a0f404471471b4dbd0dd4d626c6e12b4a1d84ac1ca05aaeaa',
  casesHash:'045ae4436a774d504b4dad44a41bdb784b45c649d484a77ff5356b0205a2dcda',
});
// The next failure was deployment admission, after all remaining browser cases
// passed. Reuse that immutable proof for the closed, tooling-only correction.
export const BROWSER_REPAIR_ACCEPTANCE=Object.freeze({
  publicationSha:'db158dfebc4b7ee88059f2a83a74737766efebbf',run:'36919040626',attempt:'1',
  artifact:11190838786,archiveHash:'721a3c6e815bdd8726710ddd5480c612ac18195be2b52a340218390411e5da3b',
});
export const BROWSER_PUBLICATION_FILES=new Set([
  'scripts/lib/media-publication.mjs','scripts/test-media-auth-config.mjs','scripts/test-release-plan.mjs',
  'scripts/lib/browser-fixture-repair.mjs','scripts/test-browser-fixture-repair.mjs',
  'scripts/lib/media-repair-source.mjs','scripts/lib/frontend-source.mjs','scripts/pages-candidate.mjs',
  'scripts/test-pages-workflow.mjs','scripts/test-pages-candidate.mjs',
  'docs/production-readiness/MAIN_ONLY_RELEASE_RUNBOOK.md','docs/runbooks/REGRESSION_REGISTER.md',
]);
export const BROWSER_REPAIR_SPECS=Object.freeze({
  'tests/auth-admin.spec.js':[
    'ff1f46fd2c3f1945eb9684d93dc28fc7988a99d362a380c6d42ea3fe4fff5c10',
    'f944b138fed1a4e7fb89513b77379ad07f278c5bbcb1f1fba25f82c46c5f926a',
  ],
  'tests/website-assistant.spec.js':[
    '0d9e19ffb1d111b31f4780e2f9d329cc5c40698731725645690c053d70363d0d',
    '4a684299b670dc99f404613fc300a5776c6cbb44537066b38d5d3c51ee588491',
  ],
});
export const BROWSER_REPAIR_FILES=new Set([
  ...BROWSER_PUBLICATION_FILES,
  ...Object.keys(BROWSER_REPAIR_SPECS),'.github/workflows/static.yml',
  'scripts/lib/browser-fixture-repair.mjs','scripts/test-browser-fixture-repair.mjs',
  'scripts/lib/media-repair-source.mjs','scripts/lib/frontend-source.mjs',
  'scripts/pages-candidate.mjs','scripts/lib/frontend-receipts.mjs',
  'scripts/select-ci-tests.mjs','scripts/test-ci-test-selection.mjs',
  'scripts/test-pages-candidate.mjs','scripts/test-pages-workflow.mjs',
  'scripts/test-frontend-review.mjs','docs/production-readiness/MAIN_ONLY_RELEASE_RUNBOOK.md',
  'docs/runbooks/REGRESSION_REGISTER.md',
]);
// Second reviewed incident, with its own immutable source and exact test delta.
// Keep the earlier incident verifiable for historical production receipts.
export const OMNI_BROWSER_REPAIR=Object.freeze({
  policy:'browser-fixture-repair-v1',
  sha:'730b41161d10dd45472bb16e27334be178b1a97b',run:'37108321888',attempt:'1',
  artifact:11269450752,artifactName:'playwright-report-selected',
  archiveHash:'781b85b48b9ebfff9ac7cc50562cb72486de4d16b3ade9000170a5a050d3278c',
  reportHash:'b02f9e4529f320b78c055f6dcda7e24e1c2541f6a328e6623b7a28d49adc2d6e',
  casesHash:'bc2b85cdcaf0dd44f19130aea1734439dfce11d97a9f06cfb2f15ea2a53c3dd7',
});
export const OMNI_BROWSER_REPAIR_SPECS=Object.freeze({
  'tests/auth-admin.spec.js':['3253de68de2e549348daf8760988b047c816ef58c14480c31b5c9c9ba31ee9e0','a5e7ca1357c44e39962a83e8634445af014cde62d176ca67ee48eb4836686a31'],
  'tests/helpers/generation-selectors.cjs':['30d2eb1158c9d457fbcf2468959d3db383e4d81bfc740d8cbe2b0ae7de341f6a','64a8225b2e3876d82aacb3cd8d95635ad37070e680618c829eb0cae8ebdc64b2'],
});
export const OMNI_BROWSER_REPAIR_FILES=new Set([
  ...Object.keys(OMNI_BROWSER_REPAIR_SPECS),
  'scripts/lib/browser-fixture-repair.mjs','scripts/test-browser-fixture-repair.mjs',
  'scripts/lib/media-repair-source.mjs','scripts/lib/frontend-source.mjs','scripts/pages-candidate.mjs',
  'docs/production-readiness/MAIN_ONLY_RELEASE_RUNBOOK.md','docs/runbooks/REGRESSION_REGISTER.md',
]);
// Seedance's unchanged product candidate: 315 Worker + 188 native checks passed.
// 59 browser failures: missing availability fixtures, catalog drift, save-flush
// synchronization and one WebKit navigation internal error before media setup.
// Reuse all 258 genuine passes; execute only the 59 original failed cases.
// The two passing WebKit save cases keep identical assertions/product bytes;
// their added response synchronization changes no protected behavior.
export const SEEDANCE_BROWSER_REPAIR=Object.freeze({
  policy:'browser-fixture-repair-v1',
  sha:'22bfa3bea68847f4a4defa11d4b328224f25344e',run:'37130840933',attempt:'1',
  artifact:11276754743,artifactName:'playwright-report-selected',
  archiveHash:'81dfe191a08e021a16a46674f65041afabe1b2d6869f868e4ee9f3782841c47e',
  reportHash:'56a7dcead054cac7c81d2c17b84be6294ecdad542d5442cb3bf74165ef1ee860',
  casesHash:'3cffd4fd147b11bde044432f8b7ba4b64cf8c9249d5587abc9ab9e00a95debbb',
});
export const SEEDANCE_BROWSER_REPAIR_SPECS=Object.freeze({
  "tests/auth-admin.spec.js":["a5e7ca1357c44e39962a83e8634445af014cde62d176ca67ee48eb4836686a31", "b659b8001ba0af775373ca53ec9815150deb7285edd26bb336f51d9798b6d547"],
  "tests/canvas.spec.js":["b1386c43c32be4e386e66ea933a6dfaf72aa316d06c8213aeb570ad3a4d77ab1", "812f4877caa470a62fe009081a8ac55d83d1bb0a211d9308059d3a74591cf410"],
  "tests/oma2-q1-canvas.spec.js":["f14c590766f4537ce706a8c9cebfb7f550887adae6fe80d19caa15bd8a5379d0", "ea87da66f7a6503319b34b1afd064473247d41f8f6d7aa55ae7714b4067cb0bc"],
  "tests/oma2-q1-member.spec.js":["4c38dd6a7b7d47a4dff68c7e4b0b6433ae90f5e71aa45075d31780f95c4dd26c", "11b2ba3b84bdc80567d0f246c6d5fb273609db2af365430dd72b294e5b388539"],
  "tests/smoke.spec.js":["bf114a2564b3c1b704b1dc1fc785cfa718cbb565bd11ee386e1b1cc42912b45c", "fa30ed853180a23d1df3efb9113eac671ab5b422541cb297b44ffe80ab6dedf2"],
  "tests/helpers/generation-selectors.cjs":["64a8225b2e3876d82aacb3cd8d95635ad37070e680618c829eb0cae8ebdc64b2", "193e555c649a22926a3280bf5f9251d8fed38d26dd84d65eaca16153b732c317"],
});
export const SEEDANCE_BROWSER_REPAIR_CASES=Object.freeze([
  ["auth-admin.spec.js", "@canvas-model-ui shows every admin Video AI model in publisher/name dropdown order"],
  ["canvas.spec.js", "Canvas music audition en: decoded gain, timeline, selection and no render", ["webkit-canvas"]],
  ["canvas.spec.js", "de: Canvas dimension dropdowns normalize restored values and preserve outputs"],
  ["canvas.spec.js", "en: Canvas dimension dropdowns normalize restored values and preserve outputs"],
  ["oma2-q1-canvas.spec.js", "P13 de: failure remains through unrelated success, blocks switch/run, retries original identity", ["chromium"]],
  ["oma2-q1-canvas.spec.js", "P13 en: failure remains through unrelated success, blocks switch/run, retries original identity", ["chromium"]],
  ["oma2-q1-member.spec.js", "@canvas-model-ui durable generation FLUX review de generation_execution_failed: visible, non-spinning, preserved intent and read-only reload"],
  ["oma2-q1-member.spec.js", "@canvas-model-ui durable generation FLUX review de generation_provider_outcome_unknown: visible, non-spinning, preserved intent and read-only reload"],
  ["oma2-q1-member.spec.js", "@canvas-model-ui durable generation FLUX review de generation_schema_rejected_review: visible, non-spinning, preserved intent and read-only reload"],
  ["oma2-q1-member.spec.js", "@canvas-model-ui durable generation FLUX review en generation_execution_failed: visible, non-spinning, preserved intent and read-only reload"],
  ["oma2-q1-member.spec.js", "@canvas-model-ui durable generation FLUX review en generation_provider_outcome_unknown: visible, non-spinning, preserved intent and read-only reload"],
  ["oma2-q1-member.spec.js", "@canvas-model-ui durable generation FLUX review en generation_schema_rejected_review: visible, non-spinning, preserved intent and read-only reload"],
  ["smoke.spec.js", "@canvas-model-ui GPT Image 2.5 Generate Lab de actual factory generation price and edit gate"],
  ["smoke.spec.js", "@canvas-model-ui GPT Image 2.5 Generate Lab de decoded upload and controls"],
  ["smoke.spec.js", "@canvas-model-ui GPT Image 2.5 Generate Lab de: retained HTTPS delivery, reload and saved original"],
  ["smoke.spec.js", "@canvas-model-ui GPT Image 2.5 Generate Lab en actual factory generation price and edit gate"],
  ["smoke.spec.js", "@canvas-model-ui GPT Image 2.5 Generate Lab en decoded upload and controls"],
  ["smoke.spec.js", "@canvas-model-ui GPT Image 2.5 Generate Lab en: retained HTTPS delivery, reload and saved original"],
  ["smoke.spec.js", "@canvas-model-ui Generate Lab Admin de actual payer balance and refreshed generation"],
  ["smoke.spec.js", "@canvas-model-ui Generate Lab Admin en actual payer balance and refreshed generation"],
  ["smoke.spec.js", "@canvas-model-ui Generate Lab Grok video de operations use owned inputs and responsive pricing"],
  ["smoke.spec.js", "@canvas-model-ui Generate Lab Grok video en operations use owned inputs and responsive pricing"],
  ["smoke.spec.js", "@canvas-model-ui Generate Lab dimensions and publisher dropdowns de"],
  ["smoke.spec.js", "@canvas-model-ui Generate Lab dimensions and publisher dropdowns en"],
  ["smoke.spec.js", "@canvas-model-ui Generate Lab renders the desktop member workspace with supported models"],
  ["smoke.spec.js", "@canvas-model-ui Grok Imagine Image 2.0 Generate Lab de registry controls and responsive price"],
  ["smoke.spec.js", "@canvas-model-ui Grok Imagine Image 2.0 Generate Lab en registry controls and responsive price"],
  ["smoke.spec.js", "@canvas-model-ui H3 Generate Lab de: roles, durable single status and explicit Assets recovery"],
  ["smoke.spec.js", "@canvas-model-ui H3 Generate Lab en: roles, durable single status and explicit Assets recovery"],
  ["smoke.spec.js", "@canvas-model-ui MODELS opens the homepage models overlay from the hero CTA without navigation"],
  ["smoke.spec.js", "@canvas-model-ui tablet and phone Models navigation remains usable"],
]);
export const SEEDANCE_BROWSER_REPAIR_FILES=new Set([
  ...Object.keys(SEEDANCE_BROWSER_REPAIR_SPECS),
  'scripts/lib/browser-fixture-repair.mjs','scripts/test-browser-fixture-repair.mjs',
  'scripts/lib/media-repair-source.mjs',
  'docs/production-readiness/MAIN_ONLY_RELEASE_RUNBOOK.md','docs/runbooks/REGRESSION_REGISTER.md',
]);
export function browserRepairIncident(sha) {
  const incident=[BROWSER_REPAIR,OMNI_BROWSER_REPAIR,SEEDANCE_BROWSER_REPAIR].find(p=>p.sha===sha);
  assert(incident,'Different browser repair source');return incident;
}
export const browserHash=value=>crypto.createHash('sha256').update(value).digest('hex');
const git=args=>execFileSync('git',args,{stdio:['ignore','pipe','pipe']});
export function assertBrowserRepairTrees(source,head) {
  const incident=browserRepairIncident(source),omni=incident===OMNI_BROWSER_REPAIR;
  const seedance=incident===SEEDANCE_BROWSER_REPAIR;
  const allowed=seedance?SEEDANCE_BROWSER_REPAIR_FILES:omni?OMNI_BROWSER_REPAIR_FILES:BROWSER_REPAIR_FILES;
  const entries=sha=>git(['ls-tree','-rz',sha]).toString().split('\0').filter(Boolean).map(line=>{const [identity,file]=line.split('\t');return{identity,file};});
  const before=entries(source),after=entries(head);
  assert.deepEqual(after.filter(r=>!allowed.has(r.file)),before.filter(r=>!allowed.has(r.file)),'Browser repair changed protected product/build/backend/dependency/test inputs');
  for(const row of after.filter(r=>allowed.has(r.file)))assert(/^100(?:644|755) blob [a-f0-9]{40}$/.test(row.identity),'Browser repair requires regular Git files');
  for(const [file,hashes] of Object.entries(seedance?SEEDANCE_BROWSER_REPAIR_SPECS:omni?OMNI_BROWSER_REPAIR_SPECS:BROWSER_REPAIR_SPECS)) {
    assert.equal(browserHash(git(['show',`${source}:${file}`])),hashes[0],`Unreviewed original spec: ${file}`);
    assert.equal(browserHash(git(['show',`${head}:${file}`])),hashes[1],`Unreviewed repaired spec: ${file}`);
  }
}
export function assertBrowserPublicationTree(head) {
  const source=BROWSER_REPAIR_ACCEPTANCE.publicationSha;
  git(['merge-base','--is-ancestor',source,head]);
  const entries=sha=>git(['ls-tree','-rz',sha]).toString().split('\0').filter(Boolean).map(line=>{const [identity,file]=line.split('\t');return{identity,file};});
  const before=entries(source),after=entries(head);
  assert.deepEqual(after.filter(r=>!BROWSER_PUBLICATION_FILES.has(r.file)),before.filter(r=>!BROWSER_PUBLICATION_FILES.has(r.file)),'Completed browser acceptance inputs changed');
  for(const row of after.filter(r=>BROWSER_PUBLICATION_FILES.has(r.file)))assert(/^100(?:644|755) blob [a-f0-9]{40}$/.test(row.identity),'Publication repair requires regular Git files');
}
export function assertCompletedBrowserRepair({run,jobs,artifacts}) {
  const expected=BROWSER_REPAIR_ACCEPTANCE;
  assert.equal(run.repository?.full_name,'bitbiai/Bitbi');assert.equal(run.head_repository?.full_name,'bitbiai/Bitbi');
  assert.equal(String(run.id),expected.run);assert.equal(String(run.run_attempt),expected.attempt);assert.equal(run.head_sha,expected.publicationSha);
  assert.equal(run.head_branch,'main');assert.equal(run.path,'.github/workflows/static.yml');assert.equal(run.event,'push');
  assert.equal(run.status,'completed');assert.equal(run.conclusion,'failure','Original deployment failure must remain failed');
  const byName=name=>{const matches=jobs.filter(j=>j.name===name);assert.equal(matches.length,1,`Missing/ambiguous completed repair job ${name}`);const job=matches[0];assert.equal(job.head_sha,expected.publicationSha);assert.equal(job.status,'completed');return job;};
  assert.equal(byName('release-compatibility').conclusion,'success');
  for(const name of ['worker-validation','homepage-validation'])assert.equal(byName(name).conclusion,'skipped','Upstream evidence comes from the original source');
  const browser=byName('browser-validation');assert.equal(browser.conclusion,'success');let prior=-1;
  for(const name of ['Install carousel browser matrix','Restore unchanged browser repair candidate','Restore exact candidate static site','Run repaired browser acceptance','Confirm tested browser candidate bytes','Upload tested browser candidate identity']) {
    const matches=browser.steps.filter(s=>s.name===name);assert.equal(matches.length,1,`Missing completed browser step ${name}`);
    const step=matches[0];assert.equal(step.status,'completed');assert.equal(step.conclusion,'success');const index=browser.steps.indexOf(step);assert(index>prior,'Completed browser preparation/proof order changed');prior=index;
  }
  const deploy=byName('deploy');assert.equal(deploy.conclusion,'failure');
  assert.deepEqual(deploy.steps.filter(s=>s.conclusion==='failure').map(s=>s.name),['Apply verified candidate backend prerequisites']);
  for(const name of ['Preserve backend activation evidence','Deploy and verify Cloudflare frontend','Record durable frontend receipt'])assert(deploy.steps.some(s=>s.name===name&&s.status==='completed'&&s.conclusion==='skipped'),'Unexpected prior activation evidence');
  assert(jobs.filter(j=>j.name!=='deploy').every(j=>['success','skipped'].includes(j.conclusion)),'Unrelated completed-source failure');
  const name=`pages-proof-browser-validation-${expected.publicationSha}-${expected.run}-${expected.attempt}`;
  const found=artifacts.filter(a=>a.name===name);assert.equal(found.length,1,'Missing/ambiguous completed browser proof');
  const a=found[0];assert.equal(a.id,expected.artifact);assert.equal(a.digest,`sha256:${expected.archiveHash}`);assert.equal(a.expired,false);assert(Date.parse(a.expires_at)>Date.now());assert(a.size_in_bytes>0);
  assert.equal(a.workflow_run?.id,Number(expected.run));assert.equal(a.workflow_run?.head_sha,expected.publicationSha);
  return a;
}
export function assertBrowserSourceIdentity(expected) {
  const incident=browserRepairIncident(expected.sha);
  for(const key of ['sha','run','attempt'])assert.equal(String(expected[key]),incident[key],`Different browser repair ${key}`);
}
export function assertBrowserReportArtifact(artifacts,source=BROWSER_REPAIR.sha) {
  const incident=browserRepairIncident(source);
  const found=artifacts.filter(a=>a.name===incident.artifactName);
  assert.equal(found.length,1,'Missing/ambiguous original failed browser report');
  const a=found[0];assert.equal(a.id,incident.artifact);assert.equal(a.digest,`sha256:${incident.archiveHash}`);
  assert.equal(a.expired,false);assert(Date.parse(a.expires_at)>Date.now(),'Expired browser repair report');
  assert.equal(a.workflow_run?.id,Number(incident.run));assert.equal(a.workflow_run?.head_sha,incident.sha);
  return a;
}
export function assertOriginalBrowserJob(job) {
  const omni=browserRepairIncident(job.head_sha)!==BROWSER_REPAIR;
  assert.equal(job.status,'completed');assert.equal(job.conclusion,'failure');
  const expected=[[omni?'Install browsers for selected frontend tests':'Install carousel browser matrix','success'],['Download candidate build','success'],['Restore exact candidate static site','success'],[omni?'Run selected auth and admin tests':'Run full static browser regression','failure'],['Confirm tested browser candidate bytes','skipped']];
  assert.deepEqual((job.steps||[]).filter(s=>s.conclusion==='failure').map(s=>s.name),[expected[3][0]],'Unrelated original browser failure');
  let prior=-1;
  for(const [name,conclusion] of expected) {
    const matches=(job.steps||[]).filter(s=>s.name===name);assert.equal(matches.length,1,`Missing original browser setup/result: ${name}`);
    const step=matches[0];assert.equal(step.status,'completed');assert.equal(step.conclusion,conclusion,`Unexpected original browser result: ${name}`);
    const index=job.steps.indexOf(step);assert(index>prior,'Original candidate setup did not precede browser execution');prior=index;
  }
}
export function browserRows(report,{discovery=false}={}) {
  assert(Array.isArray(report.suites)&&Array.isArray(report.errors||[])&&(report.errors||[]).length===0,'Malformed/errored browser report');
  const rows=[];
  const visit=suite=>{
    for(const spec of suite.specs||[])for(const t of spec.tests||[]) {
      assert(typeof spec.id==='string'&&typeof spec.title==='string'&&typeof t.projectName==='string');
      const row={key:`${t.projectName}:${spec.id}`,file:spec.file,title:spec.title,project:t.projectName};
      if(!discovery)Object.assign(row,{expectedStatus:t.expectedStatus,status:t.status,results:(t.results||[]).map(r=>({status:r.status,retry:r.retry??0,error:Boolean(r.error||(r.errors||[]).length)}))});
      rows.push(row);
    }
    (suite.suites||[]).forEach(visit);
  };
  report.suites.forEach(visit);rows.sort((a,b)=>a.key.localeCompare(b.key,'en'));
  assert(rows.length>0&&new Set(rows.map(r=>r.key)).size===rows.length,'Empty/duplicate browser case set');
  if(!discovery) {
    const statuses=['expected','unexpected','flaky','skipped'];
    assert(rows.every(r=>statuses.includes(r.status)),'Invalid executed case status');
    for(const status of statuses)assert(Number.isInteger(report.stats?.[status])&&report.stats[status]>=0&&report.stats[status]===rows.filter(r=>r.status===status).length,`Malformed/inconsistent browser ${status} statistics`);
  }
  return rows;
}
const navTitle='cold workspace exposes grouped tasks and each group can collapse independently';
const httpSuffix=': real HTTP UI, route, knowledge and budget boundary with synthetic AI';
const controlSuffix=': keyboard chat waits for initial Help focus and a blocked submit cannot report completion';
const omniAdminTitle='@canvas-model-ui shows every admin Video AI model in publisher/name dropdown order';
const omniMemberTitle='@canvas-model-ui Generate Lab dimensions and publisher dropdowns';
export function repairedCase(row,source=BROWSER_REPAIR.sha) {
  if(browserRepairIncident(source)===SEEDANCE_BROWSER_REPAIR)return ['chromium','webkit-canvas'].includes(row.project)&&SEEDANCE_BROWSER_REPAIR_CASES.some(([file,title,projects=['chromium','webkit-canvas']])=>row.file===file&&row.title===title&&projects.includes(row.project));
  if(browserRepairIncident(source)===OMNI_BROWSER_REPAIR)return ['chromium','webkit-canvas'].includes(row.project)&&(
    row.file==='auth-admin.spec.js'&&row.title===omniAdminTitle
    ||row.file==='smoke.spec.js'&&['en','de'].some(locale=>row.title===`${omniMemberTitle} ${locale}`));
  return row.file==='auth-admin.spec.js'&&row.title===navTitle&&['chromium','webkit-appearance'].includes(row.project)
    ||row.file==='website-assistant.spec.js'&&['chromium','webkit-assistant'].includes(row.project)&&['en','de'].some(locale=>[httpSuffix,controlSuffix].some(suffix=>row.title===`website assistant ${locale}${suffix}`));
}
const identity=row=>({key:row.key,file:row.file,title:row.title,project:row.project});
const keys=rows=>rows.map(r=>r.key).sort();
const passed=row=>row.expectedStatus==='passed'&&row.status==='expected'&&row.results?.length===1&&row.results[0].status==='passed'&&row.results[0].retry===0&&!row.results[0].error;
const intentionalCarouselSkip=row=>row.file==='homepage-carousel-focused.spec.js'&&row.title==='WebKit switches categories instantly with one precise scroll and no settling corrections'&&['chromium','firefox'].includes(row.project)&&row.expectedStatus==='skipped'&&row.status==='skipped'&&row.results?.length===1&&row.results[0].status==='skipped'&&!row.results[0].error;
const tailSkip=row=>intentionalCarouselSkip(row)||row.file==='homepage-carousel-focused.spec.js'&&row.expectedStatus==='skipped'&&row.status==='skipped'&&row.results?.length===1&&row.results[0].status==='skipped'&&!row.results[0].error&&(
  row.title==='settles exact transitions, keeps populated walls warm, and honors the latest rapid choice'&&row.project==='webkit'
  ||row.title==='page-work measurement detects deliberately blocking work on a real carousel input'&&['firefox','webkit'].includes(row.project));
export function verifyBrowserRepairCoverage(evidence,source=BROWSER_REPAIR.sha) {
  const {previous}=evidence;
  assert.equal(browserHash(JSON.stringify(previous)),browserRepairIncident(source).casesHash,'Original failed case evidence changed');
  return verifyBrowserCaseCoverage(evidence,source);
}
// Pure case-union check, separately counterchecked with synthetic reports. Only
// verifyBrowserRepairCoverage grants incident acceptance after the pinned hash.
export function verifyBrowserCaseCoverage({previous,discovery,scoped,carouselDiscovery,carousel},source=BROWSER_REPAIR.sha) {
  const seedance=browserRepairIncident(source)===SEEDANCE_BROWSER_REPAIR;
  if(seedance||browserRepairIncident(source)===OMNI_BROWSER_REPAIR) {
    const total=seedance?317:303,freshCount=seedance?59:6,reusedCount=total-freshCount;
    assert.equal(previous.length,total);assert.equal(discovery.length,total,'Required Canvas discovery changed');
    for(const rows of [previous,discovery,scoped])assert.equal(new Set(keys(rows)).size,rows.length,'Duplicate repair case');
    assert.deepEqual(carouselDiscovery,[]);assert.deepEqual(carousel,[],'This source has no unexecuted browser tail');
    assert.deepEqual(keys(discovery),keys(previous),'Original required cases changed');
    const fresh=discovery.filter(row=>repairedCase(row,source));assert.equal(fresh.length,freshCount);
    assert.deepEqual(keys(scoped),keys(fresh),'All repaired EN/DE/engine cases and their controls are required');
    for(const row of scoped){assert.deepEqual(identity(row),identity(fresh.find(r=>r.key===row.key)));assert(passed(row),'Repaired case failed/skipped/retried');}
    const reused=[];
    for(const row of discovery) {
      const old=previous.find(r=>r.key===row.key);assert.deepEqual(identity(old),identity(row),'Original case identity changed');
      if(repairedCase(row,source)){assert.equal(old.status,'unexpected');assert.equal(old.results.length,1);assert((seedance?['failed','timedOut']:['failed']).includes(old.results[0].status),'Original failure shape changed');}
      else {assert(passed(old),'Old failure cannot be reused');reused.push(row.key);}
    }
    assert.equal(reused.length,reusedCount);
    assert.equal(previous.filter(r=>!passed(r)).length,seedance?59:6);
    return {reused:reused.sort(),fresh:keys(scoped),carousel:[],reusedPassed:reusedCount,reusedSkipped:0,freshPassed:freshCount,carouselPassed:0,carouselSkipped:0};
  }
  assert.equal(previous.length,1600);assert.equal(discovery.length,1604,'Required final discovery changed');
  for(const rows of [previous,discovery,scoped,carouselDiscovery,carousel])assert.equal(new Set(keys(rows)).size,rows.length,'Duplicate repair case');
  const expectedFresh=discovery.filter(row=>repairedCase(row));
  assert.equal(expectedFresh.length,10,'All repaired EN/DE/engine definitions and controls are required');
  assert.deepEqual(keys(scoped),keys(expectedFresh),'Fresh repair execution differs from required scope');
  for(const row of scoped){assert.deepEqual(identity(row),identity(expectedFresh.find(r=>r.key===row.key)));assert(passed(row),`Repaired case failed/skipped/retried: ${row.key}`);}
  const reused=[];
  for(const row of discovery) {
    if(repairedCase(row))continue;
    const old=previous.find(r=>r.key===row.key);assert(old,'Required case lacks original or fresh execution');
    assert.deepEqual(identity(old),identity(row),'Original case identity changed');
    assert(passed(old)||intentionalCarouselSkip(old),`Old failure cannot be reused: ${row.key}`);reused.push(row.key);
  }
  for(const old of previous)assert(discovery.some(row=>row.key===old.key),'Original required case removed');
  assert.equal(reused.length,1594); // 1593 passes and one unchanged engine-specific skip.
  assert.equal(previous.filter(r=>!passed(r)&&!intentionalCarouselSkip(r)).length,3,'Original failure shape changed');
  assert.equal(carouselDiscovery.length,39,'Complete previously unexecuted carousel tail required');
  assert.deepEqual(keys(carousel),keys(carouselDiscovery),'Carousel execution differs from discovery');
  for(const row of carousel) {
    assert.deepEqual(identity(row),identity(carouselDiscovery.find(r=>r.key===row.key)));
    assert(row.file==='homepage-carousel-focused.spec.js'&&['chromium','firefox','webkit'].includes(row.project),'Unexpected carousel case');
    assert(passed(row)||tailSkip(row),`Carousel case failed/skipped/retried: ${row.key}`);
  }
  for(const project of ['chromium','firefox','webkit'])assert.equal(carousel.filter(r=>r.project===project).length,13,'Missing carousel engine');
  return {reused:reused.sort(),fresh:keys(scoped),carousel:keys(carousel),reusedPassed:1593,reusedSkipped:1,freshPassed:scoped.length,carouselPassed:carousel.filter(passed).length,carouselSkipped:carousel.filter(tailSkip).length};
}
export function verifyBrowserRepairProof(proof,manifest,{publicationSha,run,attempt}={}) {
  assert.equal(proof.job,'browser-validation');assert.equal(proof.status,'passed');
  assert.equal(proof.manifestHash,browserHash(JSON.stringify(manifest)));
  assertBrowserSourceIdentity(manifest);const p=proof.browserRepair;
  const incident=browserRepairIncident(manifest.sha);
  assert(p,'Missing browser repair provenance');assert.equal(p.policy,incident.policy);
  assert.deepEqual(p.source,incident,'Original failed run/report provenance changed');
  for(const key of ['publicationSha','run','attempt']) {
    assert(typeof p[key]==='string'&&p[key]);if({publicationSha,run,attempt}[key]!==undefined)assert.equal(p[key],String({publicationSha,run,attempt}[key]),`Repair ${key} mismatch`);
  }
  assert(/^[a-f0-9]{40}$/.test(p.publicationSha)&&p.publicationSha!==manifest.sha);
  const coverage=verifyBrowserRepairCoverage(p.evidence,manifest.sha);assert.deepEqual(p.coverage,coverage);
  assert.equal(proof.reportHash,browserHash(JSON.stringify(p.evidence)));
  assert.equal(proof.tests,coverage.reusedPassed+coverage.freshPassed+coverage.carouselPassed);
  return coverage;
}
export async function originalBrowserRows(env=process.env) {
  const incident=browserRepairIncident(env.REPAIR_SOURCE_SHA||BROWSER_REPAIR.sha);
  assert(env.GH_TOKEN,'Read-only Actions token required');
  const response=await fetch(`https://api.github.com/repos/bitbiai/Bitbi/actions/artifacts/${incident.artifact}/zip`,{headers:{Authorization:`Bearer ${env.GH_TOKEN}`},signal:AbortSignal.timeout(30000)});
  assert(response.ok,'Cannot read exact original browser artifact');const bytes=Buffer.from(await response.arrayBuffer());
  assert.equal(browserHash(bytes),incident.archiveHash,'Original browser archive changed');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-browser-source-'));
  try {
    const archive=path.join(dir,'source.zip');fs.writeFileSync(archive,bytes);
    const report=execFileSync('python3',['-I','-c',"import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1]) as z:\n n=sys.argv[2]\n assert sum(x.filename==n for x in z.infolist())==1\n assert z.getinfo(n).file_size<16*1024*1024\n sys.stdout.buffer.write(z.read(n))",archive,incident!==BROWSER_REPAIR?'test-results/candidate-auth.json':'test-results/candidate-static.json'],{maxBuffer:16*1024*1024,timeout:30000});
    assert.equal(browserHash(report),incident.reportHash,'Original browser JSON changed');
    const rows=browserRows(JSON.parse(report));assert.equal(browserHash(JSON.stringify(rows)),incident.casesHash);return rows;
  } finally{fs.rmSync(dir,{recursive:true,force:true});}
}
export async function runBrowserRepair(manifest,env=process.env) {
  const incident=browserRepairIncident(env.REPAIR_SOURCE_SHA),omni=incident!==BROWSER_REPAIR,seedance=incident===SEEDANCE_BROWSER_REPAIR;
  assert.equal(env.GITHUB_JOB,'browser-validation');
  assertBrowserRepairTrees(env.REPAIR_SOURCE_SHA,env.GITHUB_SHA);assertBrowserSourceIdentity(manifest);
  const previous=await originalBrowserRows(env);fs.mkdirSync('test-results',{recursive:true});
  const run=(name,args,{discovery=false}={})=>{
    const file=path.resolve(`test-results/repair-${name}.json`);fs.rmSync(file,{force:true});
    const result=spawnSync(process.execPath,['node_modules/@playwright/test/cli.js','test',...args,...(discovery?['--list']:['--retries=0']),`--reporter=${discovery?'json':'list,json'}`],{env:{...env,PLAYWRIGHT_JSON_OUTPUT_NAME:file,STATIC_TEST_ROOT:'_site'},stdio:discovery?'pipe':'inherit',maxBuffer:8*1024*1024});
    assert.equal(result.status,0,`Browser repair ${name} command failed`);return browserRows(JSON.parse(fs.readFileSync(file)),{discovery});
  };
  const canvasArgs=[...CANVAS_RELEASE_SCOPES.flatMap(([,files])=>files.map(f=>`tests/${f}`)),...new Set(CANVAS_RELEASE_SCOPES.flatMap(([scope])=>['chromium','webkit'].map(engine=>`--project=${canvasReleaseProject(engine,scope)}`))),'--grep','Canvas|P13|@canvas-model-ui'];
  const discovery=run('discovery',['-c','playwright.config.js',...(omni?canvasArgs:[])],{discovery:true});
  const seedanceGrep=SEEDANCE_BROWSER_REPAIR_CASES.map(([,title])=>title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$').join('|');
  const args=['-c','playwright.config.js',...(seedance?[...new Set(SEEDANCE_BROWSER_REPAIR_CASES.map(([file])=>'tests/'+file)),'--project=chromium','--project=webkit-canvas','--grep',seedanceGrep]:omni?['tests/auth-admin.spec.js','tests/smoke.spec.js','--project=chromium','--project=webkit-canvas','--grep',`${omniAdminTitle}|${omniMemberTitle}`]:['tests/auth-admin.spec.js','tests/website-assistant.spec.js','--project=chromium','--project=webkit-appearance','--project=webkit-assistant','--grep',`${navTitle}|website assistant (en|de)(${httpSuffix}|${controlSuffix})`]),'--output=test-results/browser-repair-artifacts'];
  const argsByProject=seedance?['chromium','webkit-canvas'].map(project=>[
    '-c','playwright.config.js',...new Set(SEEDANCE_BROWSER_REPAIR_CASES.map(([file])=>'tests/'+file)),
    '--project='+project,'--grep',SEEDANCE_BROWSER_REPAIR_CASES.filter(([,title,projects=['chromium','webkit-canvas']])=>projects.includes(project)).map(([,title])=>title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$').join('|'),
    '--output=test-results/browser-repair-artifacts-'+project,
  ]):[args];
  const sortRows=rows=>rows.sort((a,b)=>a.key.localeCompare(b.key,'en'));
  const scopedDiscovery=sortRows(argsByProject.flatMap((args,i)=>run('scoped-discovery-'+i,args,{discovery:true})));
  assert.deepEqual(scopedDiscovery,discovery.filter(row=>repairedCase(row,incident.sha)),'Scoped command differs from reviewed repaired cases');
  const scoped=sortRows(argsByProject.flatMap((args,i)=>run('scoped-'+i,args)));
  const carouselArgs=['-c','playwright.carousel.config.js','--output=test-results/carousel-repair-artifacts'];
  const carouselDiscovery=omni?[]:run('carousel-discovery',carouselArgs,{discovery:true});
  const carousel=omni?[]:run('carousel',carouselArgs);
  const evidence={previous,discovery,scoped,carouselDiscovery,carousel};const coverage=verifyBrowserRepairCoverage(evidence,incident.sha);
  const browserRepair={policy:incident.policy,source:incident,publicationSha:env.GITHUB_SHA,run:String(env.GITHUB_RUN_ID),attempt:String(env.GITHUB_RUN_ATTEMPT),evidence,coverage};
  const proof={job:'browser-validation',status:'passed',manifestHash:browserHash(JSON.stringify(manifest)),reportHash:browserHash(JSON.stringify(evidence)),tests:coverage.reusedPassed+coverage.freshPassed+coverage.carouselPassed,browserRepair};
  verifyBrowserRepairProof(proof,manifest,{publicationSha:env.GITHUB_SHA,run:env.GITHUB_RUN_ID,attempt:env.GITHUB_RUN_ATTEMPT});
  fs.writeFileSync('test-results/browser-repair-proof.json',JSON.stringify(proof));
  console.log(`Preserved original failed source ${incident.run}/1: ${coverage.reusedPassed} unchanged passes, ${coverage.reusedSkipped} intentional engine skip; ${coverage.freshPassed} fresh repairs/controls, ${coverage.carouselPassed} fresh carousel passes (${coverage.carouselSkipped} engine skips).`);
}
