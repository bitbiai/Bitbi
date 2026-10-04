// One reviewed incident, not a general test cache. Original failed evidence is
// immutable; only the repaired definitions and the unexecuted command run again.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {CANVAS_AUDIO_SCOPES,CANVAS_RELEASE_SCOPES,canvasReleaseProject} from './homepage-test-selection.mjs';

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
// Canvas merge: source product bytes and all 315 Worker / 188 native checks
// remain unchanged. Reuse 322 passes; run exactly the five failed browser cases.
// The other three merge-selection variants retain every behavioral assertion;
// their sole diff waits for completed deletion before selecting another node.
export const CANVAS_MERGE_BROWSER_REPAIR=Object.freeze({
  policy:'browser-fixture-repair-v1',
  sha:'11f1c54d3b8fbabce998dd29db7a15d698873849',run:'37150831760',attempt:'1',
  artifact:11284467133,artifactName:'playwright-report-selected',
  archiveHash:'0381214908bc5468aafed983c375d45774f2e7e96720de5eaf75d9d4916592b4',
  reportHash:'513fe17202c9020c1512ec2e0ea13c8da805cf48c400b818d1147bcb8f8ce5f5',
  casesHash:'7c11bc9e053ed493b3ea87d132fa8dac8c94d38cf19248d7e93593376b94de3c',
});
export const CANVAS_MERGE_BROWSER_REPAIR_SPECS=Object.freeze({
  'tests/canvas.spec.js':['9132a1a92037a5df82f816c63d1715d103a0b3214df8579a4e30d251785abc97','5e30e5209dffa7225b37633f8401332fd945f2dd857ecd14792a81b279cb09d5'],
  'tests/helpers/canvas-music-preview.cjs':['08e5368d13cc0ffdb920a1aa334e2926465995d67401d47500758a2bdca60c1d','bf9030dfd662328995c680b679c882f2254fe0323ad2a5d698aea953d6d7d6c0'],
});
export const CANVAS_MERGE_BROWSER_REPAIR_CASES=Object.freeze([
  ['canvas.spec.js','Canvas music audition en: decoded gain, timeline, selection and no render'],
  ['canvas.spec.js','Canvas music audition de: decoded gain, timeline, selection and no render'],
  ['canvas.spec.js','Canvas merge selection de: current strand, live titles, deletion and stale refresh',['chromium']],
]);
export const CANVAS_MERGE_BROWSER_REPAIR_FILES=new Set([
  ...Object.keys(CANVAS_MERGE_BROWSER_REPAIR_SPECS),
  'scripts/lib/browser-fixture-repair.mjs','scripts/test-browser-fixture-repair.mjs',
  'scripts/lib/media-repair-source.mjs',
  'docs/production-readiness/MAIN_ONLY_RELEASE_RUNBOOK.md','docs/runbooks/REGRESSION_REGISTER.md',
]);
// Canvas audio: reuse the unchanged product, four Linux native cases, tested
// processor image and 218 browser passes. Only the six failed cases run anew.
export const CANVAS_AUDIO_BROWSER_REPAIR=Object.freeze({
  policy:'browser-fixture-repair-v1',
  sha:'3e6f82edfee135702e607ee667d70c628788bd40',run:'37189472421',attempt:'1',
  artifact:11298836413,artifactName:'playwright-report-selected',
  archiveHash:'07dcf5a95ba1f8731f8df769e78a26b896669dd46a5222a1b411f0e1fa90670e',
  reportHash:'21239bb362fff7994371571708110ec6a46c24e164285c888024e2116ba2bc67',
  casesHash:'f85d2197d54ace19f18f21dca871fcced44dc252103db55e9bb7a2dfd133ab0d',
});
export const CANVAS_AUDIO_BROWSER_PROGRESS=Object.freeze({
  sha:'6ae6dfb01bdd9f1762a7fa4e492e6df0bea01d48',run:'37192908814',attempt:'1',
  artifact:11299483349,artifactName:'playwright-report-selected',
  archiveHash:'3af39480ded8c5cfbc3b4975723fcd687025e3728d9a44d3cef9ae7f25a68ffc',
  reports:{'test-results/repair-scoped-0.json':'169d2324857fce6549809ea2d2bd293cf11c3a9a704d66b21a3462f75fbf104b',
    'test-results/repair-scoped-1.json':'7934c7b8d156f521c2420ae46fcc139cbb3e23f5580a9593cdadc36342abe6b2'},
  casesHash:'59e4d084429b0281a2f107df0de312bc63aee23333d8f0483c9a54ed82298044',
  helperHash:'10e4c19b447bd4646a7075c295444555bc3dfb27a51038e4d92f07ae5025e8a2',
});
export const CANVAS_AUDIO_BROWSER_REPAIR_SPECS=Object.freeze({
  'tests/helpers/canvas-audio-ui.cjs':['5edd386fb3c398ed743bab53be1a4e13cce221293b8e34c677902183c235b58d','92151cb4d32b5095cdd3247b645f1b34d7728f920b001f6997cf32ddbeef5446'],
  'tests/helpers/canvas-music-preview.cjs':['92ae2db9261d089c0c04825bbb7d95efb67b8a2c5ac831f1bdc97455cf0a01af','fe86fc479d33b492ad479f9fb52fa87ea87926d3daa65c73737f157fcc2f83b3'],
});
export const CANVAS_AUDIO_BROWSER_REPAIR_CASES=Object.freeze([
  ...['en','de'].map(locale=>['canvas.spec.js',`Canvas asset audio ${locale}: typed references, persistent controls and real export`]),
  ...['en','de'].map(locale=>['canvas.spec.js',`Canvas music audition ${locale}: decoded gain, timeline, selection and no render`,['webkit-canvas']]),
]);
export const CANVAS_AUDIO_BROWSER_REPAIR_FILES=new Set([
  ...Object.keys(CANVAS_AUDIO_BROWSER_REPAIR_SPECS),
  'scripts/lib/browser-fixture-repair.mjs','scripts/test-browser-fixture-repair.mjs',
  'scripts/lib/media-repair-source.mjs','scripts/lib/media-publication.mjs','scripts/pages-candidate.mjs',
  'docs/production-readiness/MAIN_ONLY_RELEASE_RUNBOOK.md','docs/runbooks/REGRESSION_REGISTER.md',
]);
export function browserRepairIncident(sha) {
  const incident=[BROWSER_REPAIR,OMNI_BROWSER_REPAIR,SEEDANCE_BROWSER_REPAIR,CANVAS_MERGE_BROWSER_REPAIR,CANVAS_AUDIO_BROWSER_REPAIR].find(p=>p.sha===sha);
  assert(incident,'Different browser repair source');return incident;
}
export const browserHash=value=>crypto.createHash('sha256').update(value).digest('hex');
const git=args=>execFileSync('git',args,{stdio:['ignore','pipe','pipe']});
export function assertBrowserRepairTrees(source,head) {
  const incident=browserRepairIncident(source),omni=incident===OMNI_BROWSER_REPAIR;
  const seedance=incident===SEEDANCE_BROWSER_REPAIR,merge=incident===CANVAS_MERGE_BROWSER_REPAIR,audio=incident===CANVAS_AUDIO_BROWSER_REPAIR;
  const allowed=audio?CANVAS_AUDIO_BROWSER_REPAIR_FILES:merge?CANVAS_MERGE_BROWSER_REPAIR_FILES:seedance?SEEDANCE_BROWSER_REPAIR_FILES:omni?OMNI_BROWSER_REPAIR_FILES:BROWSER_REPAIR_FILES;
  const entries=sha=>git(['ls-tree','-rz',sha]).toString().split('\0').filter(Boolean).map(line=>{const [identity,file]=line.split('\t');return{identity,file};});
  const before=entries(source),after=entries(head);
  assert.deepEqual(after.filter(r=>!allowed.has(r.file)),before.filter(r=>!allowed.has(r.file)),'Browser repair changed protected product/build/backend/dependency/test inputs');
  for(const row of after.filter(r=>allowed.has(r.file)))assert(/^100(?:644|755) blob [a-f0-9]{40}$/.test(row.identity),'Browser repair requires regular Git files');
  for(const [file,hashes] of Object.entries(audio?CANVAS_AUDIO_BROWSER_REPAIR_SPECS:merge?CANVAS_MERGE_BROWSER_REPAIR_SPECS:seedance?SEEDANCE_BROWSER_REPAIR_SPECS:omni?OMNI_BROWSER_REPAIR_SPECS:BROWSER_REPAIR_SPECS)) {
    assert.equal(browserHash(git(['show',`${source}:${file}`])),hashes[0],`Unreviewed original spec: ${file}`);
    const expected=audio&&head===CANVAS_AUDIO_BROWSER_PROGRESS.sha&&file==='tests/helpers/canvas-audio-ui.cjs'?CANVAS_AUDIO_BROWSER_PROGRESS.helperHash:hashes[1];
    assert.equal(browserHash(git(['show',`${head}:${file}`])),expected,`Unreviewed repaired spec: ${file}`);
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
  if(job.head_sha===CANVAS_AUDIO_BROWSER_REPAIR.sha) {
    const setup=job.steps.filter(s=>s.name==='Install Canvas browser media tools');
    assert.equal(setup.length,1,'Missing Canvas audio media preparation');
    assert.equal(setup[0].status,'completed');assert.equal(setup[0].conclusion,'success');
    assert(job.steps.indexOf(setup[0])<job.steps.findIndex(s=>s.name===expected[3][0]),'Media tools must precede audio execution');
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
  if(browserRepairIncident(source)===CANVAS_AUDIO_BROWSER_REPAIR)return CANVAS_AUDIO_BROWSER_REPAIR_CASES.some(([file,title,projects=['chromium','webkit-canvas']])=>row.file===file&&row.title===title&&projects.includes(row.project));
  if(browserRepairIncident(source)===CANVAS_MERGE_BROWSER_REPAIR)return CANVAS_MERGE_BROWSER_REPAIR_CASES.some(([file,title,projects=['chromium','webkit-canvas']])=>row.file===file&&row.title===title&&projects.includes(row.project));
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
  if(source===CANVAS_AUDIO_BROWSER_REPAIR.sha) {
    assert.deepEqual(evidence.progress?.source,CANVAS_AUDIO_BROWSER_PROGRESS,'Missing exact intermediate failed-run provenance');
    assert.equal(browserHash(JSON.stringify(evidence.progress.rows)),CANVAS_AUDIO_BROWSER_PROGRESS.casesHash,'Intermediate browser results changed');
  }
  return verifyBrowserCaseCoverage(evidence,source);
}
// Pure case-union check, separately counterchecked with synthetic reports. Only
// verifyBrowserRepairCoverage grants incident acceptance after the pinned hash.
export function verifyBrowserCaseCoverage({previous,discovery,scoped,carouselDiscovery,carousel,progress},source=BROWSER_REPAIR.sha) {
  const seedance=browserRepairIncident(source)===SEEDANCE_BROWSER_REPAIR,merge=browserRepairIncident(source)===CANVAS_MERGE_BROWSER_REPAIR,audio=browserRepairIncident(source)===CANVAS_AUDIO_BROWSER_REPAIR;
  if(audio&&progress) {
    const repaired=discovery.filter(row=>repairedCase(row,source));
    assert.equal(repaired.length,6);assert.equal(progress.rows.length,6);
    assert.deepEqual(keys(progress.rows),keys(repaired),'Intermediate execution differs from the original six repairs');
    for(const row of progress.rows)assert.deepEqual(identity(row),identity(repaired.find(r=>r.key===row.key)));
    const retained=progress.rows.filter(passed),pending=progress.rows.filter(row=>!passed(row));
    assert.equal(retained.length,5);assert.equal(pending.length,1);
    assert.equal(pending[0].project,'webkit-canvas');assert.equal(pending[0].title,'Canvas asset audio de: typed references, persistent controls and real export');
    assert.equal(pending[0].status,'unexpected');assert.deepEqual(pending[0].results,[{status:'failed',retry:0,error:true}]);
    assert.deepEqual(keys(scoped),keys(pending),'Only the unresolved DE WebKit case may execute again');
    // Reuse the existing strict full-discovery union. No failed intermediate
    // result is substituted, and all original 224 identities remain required.
    const full=verifyBrowserCaseCoverage({previous,discovery,scoped:[...retained,...scoped].sort((a,b)=>a.key.localeCompare(b.key,'en')),carouselDiscovery,carousel},source);
    return {...full,reused:[...full.reused,...keys(retained)].sort(),fresh:keys(scoped),reusedPassed:223,freshPassed:1,progressPassed:5};
  }
  if(audio||merge||seedance||browserRepairIncident(source)===OMNI_BROWSER_REPAIR) {
    const total=audio?224:merge?327:seedance?317:303,freshCount=merge?5:seedance?59:6,reusedCount=total-freshCount;
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
      if(repairedCase(row,source)){assert.equal(old.status,'unexpected');assert.equal(old.results.length,1);assert((audio||seedance||merge?['failed','timedOut']:['failed']).includes(old.results[0].status),'Original failure shape changed');}
      else {assert(passed(old),'Old failure cannot be reused');reused.push(row.key);}
    }
    assert.equal(reused.length,reusedCount);
    assert.equal(previous.filter(r=>!passed(r)).length,freshCount);
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
  return archivedBrowserRows(incident,env,incident.reports||{[incident!==BROWSER_REPAIR?'test-results/candidate-auth.json':'test-results/candidate-static.json']:incident.reportHash});
}
async function archivedBrowserRows(incident,env,reports) {
  assert(env.GH_TOKEN,'Read-only Actions token required');
  const response=await fetch(`https://api.github.com/repos/bitbiai/Bitbi/actions/artifacts/${incident.artifact}/zip`,{headers:{Authorization:`Bearer ${env.GH_TOKEN}`},signal:AbortSignal.timeout(30000)});
  assert(response.ok,'Cannot read exact original browser artifact');const bytes=Buffer.from(await response.arrayBuffer());
  assert.equal(browserHash(bytes),incident.archiveHash,'Original browser archive changed');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-browser-source-'));
  try {
    const archive=path.join(dir,'source.zip');fs.writeFileSync(archive,bytes);
    const rows=[];
    for(const [name,expectedHash] of Object.entries(reports)) {
      const report=execFileSync('python3',['-I','-c',"import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1]) as z:\n n=sys.argv[2]\n assert sum(x.filename==n for x in z.infolist())==1\n assert z.getinfo(n).file_size<16*1024*1024\n sys.stdout.buffer.write(z.read(n))",archive,name],{maxBuffer:16*1024*1024,timeout:30000});
      assert.equal(browserHash(report),expectedHash,'Original browser JSON changed');rows.push(...browserRows(JSON.parse(report)));
    }
    rows.sort((a,b)=>a.key.localeCompare(b.key,'en'));
    assert.equal(browserHash(JSON.stringify(rows)),incident.casesHash);return rows;
  } finally{fs.rmSync(dir,{recursive:true,force:true});}
}
export function assertCanvasAudioProgress({run,jobs,artifact}) {
  const p=CANVAS_AUDIO_BROWSER_PROGRESS;
  assert.equal(String(run.id),p.run);assert.equal(String(run.run_attempt),p.attempt);assert.equal(run.head_sha,p.sha);
  assert.equal(run.head_branch,'main');assert.equal(run.path,'.github/workflows/static.yml');assert.equal(run.event,'push');
  assert.equal(run.repository?.full_name,'bitbiai/Bitbi');assert.equal(run.head_repository?.full_name,'bitbiai/Bitbi');
  assert.equal(run.status,'completed');assert.equal(run.conclusion,'failure','Intermediate failed run remains failed');
  for(const [name,conclusion] of [['release-compatibility','success'],['worker-validation','skipped'],['homepage-validation','skipped'],['browser-validation','failure'],['deploy','skipped']]) {
    const found=jobs.filter(j=>j.name===name);assert.equal(found.length,1);const job=found[0];
    assert.equal(job.head_sha,p.sha);assert.equal(job.status,'completed');assert.equal(job.conclusion,conclusion);
    if(name==='browser-validation') {
      assert.deepEqual(job.steps.filter(s=>s.conclusion==='failure').map(s=>s.name),['Run repaired browser acceptance']);
      let prior=-1;
      for(const stepName of ['Install Canvas browser media tools','Restore unchanged browser repair candidate','Restore exact candidate static site','Run repaired browser acceptance']) {
        const steps=job.steps.filter(s=>s.name===stepName);assert.equal(steps.length,1);const step=steps[0];
        assert.equal(step.status,'completed');assert.equal(step.conclusion,stepName==='Run repaired browser acceptance'?'failure':'success');
        assert(job.steps.indexOf(step)>prior);prior=job.steps.indexOf(step);
      }
    }
  }
  assert.equal(artifact.id,p.artifact);assert.equal(artifact.name,p.artifactName);assert.equal(artifact.digest,`sha256:${p.archiveHash}`);
  assert.equal(artifact.expired,false);assert(Date.parse(artifact.expires_at)>Date.now());assert(artifact.size_in_bytes>0);
  assert.equal(artifact.workflow_run?.id,Number(p.run));assert.equal(artifact.workflow_run?.head_sha,p.sha);
}
export async function canvasAudioProgress(env=process.env) {
  const p=CANVAS_AUDIO_BROWSER_PROGRESS;
  assertBrowserRepairTrees(CANVAS_AUDIO_BROWSER_REPAIR.sha,p.sha);
  const read=async endpoint=>{
    const response=await fetch(`https://api.github.com/repos/bitbiai/Bitbi/${endpoint}`,{headers:{Authorization:`Bearer ${env.GH_TOKEN}`},signal:AbortSignal.timeout(30000)});
    assert(response.ok,'Cannot authenticate intermediate browser evidence');return response.json();
  };
  const [run,data,artifact]=await Promise.all([read(`actions/runs/${p.run}/attempts/${p.attempt}`),read(`actions/runs/${p.run}/attempts/${p.attempt}/jobs?per_page=100`),read(`actions/artifacts/${p.artifact}`)]);
  assert.equal(data.jobs.length,data.total_count);assertCanvasAudioProgress({run,jobs:data.jobs,artifact});
  return {source:p,rows:await archivedBrowserRows(p,env,p.reports)};
}
export async function runBrowserRepair(manifest,env=process.env) {
  const incident=browserRepairIncident(env.REPAIR_SOURCE_SHA),omni=incident!==BROWSER_REPAIR,seedance=incident===SEEDANCE_BROWSER_REPAIR;
  const scopedCases=incident===CANVAS_AUDIO_BROWSER_REPAIR?CANVAS_AUDIO_BROWSER_REPAIR_CASES:incident===CANVAS_MERGE_BROWSER_REPAIR?CANVAS_MERGE_BROWSER_REPAIR_CASES:seedance?SEEDANCE_BROWSER_REPAIR_CASES:null;
  assert.equal(env.GITHUB_JOB,'browser-validation');
  assertBrowserRepairTrees(env.REPAIR_SOURCE_SHA,env.GITHUB_SHA);assertBrowserSourceIdentity(manifest);
  const previous=await originalBrowserRows(env);fs.mkdirSync('test-results',{recursive:true});
  const progress=incident===CANVAS_AUDIO_BROWSER_REPAIR?await canvasAudioProgress(env):undefined;
  const run=(name,args,{discovery=false}={})=>{
    const file=path.resolve(`test-results/repair-${name}.json`);fs.rmSync(file,{force:true});
    const result=spawnSync(process.execPath,['node_modules/@playwright/test/cli.js','test',...args,...(discovery?['--list']:['--retries=0']),`--reporter=${discovery?'json':'list,json'}`],{env:{...env,PLAYWRIGHT_JSON_OUTPUT_NAME:file,STATIC_TEST_ROOT:'_site'},stdio:discovery?'pipe':'inherit',maxBuffer:8*1024*1024});
    assert.equal(result.status,0,`Browser repair ${name} command failed`);return browserRows(JSON.parse(fs.readFileSync(file)),{discovery});
  };
  const scopes=incident===CANVAS_AUDIO_BROWSER_REPAIR?CANVAS_AUDIO_SCOPES:CANVAS_RELEASE_SCOPES;
  const canvasArgs=[...scopes.flatMap(([,files])=>files.map(f=>`tests/${f}`)),...new Set(scopes.flatMap(([scope])=>['chromium','webkit'].map(engine=>`--project=${canvasReleaseProject(engine,scope)}`))),'--grep','Canvas|P13|@canvas-model-ui'];
  const discovery=run('discovery',['-c','playwright.config.js',...(omni?canvasArgs:[])],{discovery:true});
  const seedanceGrep=SEEDANCE_BROWSER_REPAIR_CASES.map(([,title])=>title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$').join('|');
  const args=['-c','playwright.config.js',...(seedance?[...new Set(SEEDANCE_BROWSER_REPAIR_CASES.map(([file])=>'tests/'+file)),'--project=chromium','--project=webkit-canvas','--grep',seedanceGrep]:omni?['tests/auth-admin.spec.js','tests/smoke.spec.js','--project=chromium','--project=webkit-canvas','--grep',`${omniAdminTitle}|${omniMemberTitle}`]:['tests/auth-admin.spec.js','tests/website-assistant.spec.js','--project=chromium','--project=webkit-appearance','--project=webkit-assistant','--grep',`${navTitle}|website assistant (en|de)(${httpSuffix}|${controlSuffix})`]),'--output=test-results/browser-repair-artifacts'];
  const retained=row=>progress?.rows.some(r=>r.file===row.file&&r.title===row.title&&r.project===row.project&&passed(r));
  const casesFor=project=>scopedCases.filter(([file,title,projects=['chromium','webkit-canvas']])=>projects.includes(project)&&!retained({file,title,project}));
  const argsByProject=scopedCases?['chromium','webkit-canvas'].filter(project=>casesFor(project).length).map(project=>[
    '-c','playwright.config.js',...new Set(scopedCases.map(([file])=>'tests/'+file)),
    '--project='+project,'--grep',casesFor(project).map(([,title])=>title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$').join('|'),
    '--output=test-results/browser-repair-artifacts-'+project,
  ]):[args];
  const sortRows=rows=>rows.sort((a,b)=>a.key.localeCompare(b.key,'en'));
  const scopedDiscovery=sortRows(argsByProject.flatMap((args,i)=>run('scoped-discovery-'+i,args,{discovery:true})));
  assert.deepEqual(scopedDiscovery,discovery.filter(row=>repairedCase(row,incident.sha)&&!retained(row)),'Scoped command differs from reviewed repaired cases');
  const scoped=sortRows(argsByProject.flatMap((args,i)=>run('scoped-'+i,args)));
  const carouselArgs=['-c','playwright.carousel.config.js','--output=test-results/carousel-repair-artifacts'];
  const carouselDiscovery=omni?[]:run('carousel-discovery',carouselArgs,{discovery:true});
  const carousel=omni?[]:run('carousel',carouselArgs);
  const evidence={previous,discovery,scoped,carouselDiscovery,carousel,...(progress?{progress}:{})};const coverage=verifyBrowserRepairCoverage(evidence,incident.sha);
  const browserRepair={policy:incident.policy,source:incident,publicationSha:env.GITHUB_SHA,run:String(env.GITHUB_RUN_ID),attempt:String(env.GITHUB_RUN_ATTEMPT),evidence,coverage};
  const proof={job:'browser-validation',status:'passed',manifestHash:browserHash(JSON.stringify(manifest)),reportHash:browserHash(JSON.stringify(evidence)),tests:coverage.reusedPassed+coverage.freshPassed+coverage.carouselPassed,browserRepair};
  verifyBrowserRepairProof(proof,manifest,{publicationSha:env.GITHUB_SHA,run:env.GITHUB_RUN_ID,attempt:env.GITHUB_RUN_ATTEMPT});
  fs.writeFileSync('test-results/browser-repair-proof.json',JSON.stringify(proof));
  console.log(`Preserved original failed source ${incident.run}/1: ${coverage.reusedPassed} unchanged passes, ${coverage.reusedSkipped} intentional engine skip; ${coverage.freshPassed} fresh repairs/controls, ${coverage.carouselPassed} fresh carousel passes (${coverage.carouselSkipped} engine skips).`);
}
