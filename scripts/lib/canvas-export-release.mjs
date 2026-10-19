import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

// A closed caller graph, not a wildcard for Canvas or release tooling. Unknown
// neighbours retain the ordinary fail-closed Full selection.
export const EXPORT_DELIVERY_POLICY='canvas-export-delivery-v1';
export const EXPORT_DELIVERY_FILES=Object.freeze([
  'docs/production-readiness/MAIN_ONLY_RELEASE_RUNBOOK.md',
  'js/pages/canvas/export-observer.js','js/pages/canvas/full-video.js',
  'workers/media/src/index.js','scripts/test-private-media-lifecycle.mjs',
  'workers/auth/src/lib/private-media-service.js','workers/auth/src/routes/private-media-service.js',
  'workers/auth/src/lib/canvas-video-processing.js','workers/auth/src/routes/canvas-video-processing.js',
  'workers/auth/src/lib/canvas-agent-graph.js',
  'services/homepage-ffmpeg-processor/canvas-diagnostics.mjs','services/homepage-ffmpeg-processor/canvas-full-video.mjs',
  'services/homepage-ffmpeg-processor/canvas-full-video.test.mjs','services/homepage-ffmpeg-processor/container-server.mjs',
  'services/homepage-ffmpeg-processor/private-media-runner.test.mjs',
  'tests/helpers/canvas-agent-control.mjs','tests/q2-canvas-agent.spec.js',
  'tests/helpers/private-media-control.mjs','tests/helpers/canvas-assembly-editing-ui.cjs','tests/helpers/canvas-export-lifecycle-ui.cjs',
  'tests/helpers/q2-runtime/canvas.mjs','tests/helpers/q2-runtime/control.mjs',
  'tests/helpers/q2-runtime/canvas-export-delivery.mjs','tests/helpers/q2-runtime/canvas-readiness-recovery.mjs',
  'tests/helpers/q2-runtime/runner.mjs','tests/helpers/q2-runtime/linux-hosted.mjs',
  'tests/helpers/q2-runtime/linux-runtime-child.mjs','tests/helpers/q2-runtime/linux-bootstrap.py',
  'scripts/test-q2-runtime-launcher.mjs','scripts/lib/canvas-export-release.mjs',
  'scripts/lib/ci-test-selection.mjs','scripts/lib/local-release-plan.mjs','scripts/lib/local-release-evidence.mjs',
  'scripts/pages-candidate.mjs','scripts/select-ci-tests.mjs','scripts/test-ci-test-selection.mjs','scripts/test-local-release.mjs',
]);
// Auth-only a4 retained the published frontend base below. These exact prior
// inputs were already accepted; keep them in the complete unpublished range,
// preserving their source/evidence instead of pretending frontend was at a4.
export const EXPORT_DELIVERY_PRIOR_FILES=Object.freeze([
  "docs/production-readiness/CANVAS_AGENT.md",
  "docs/runbooks/REGRESSION_REGISTER.md",
  "scripts/lib/ci-test-selection.mjs",
  "scripts/lib/local-release-browser.mjs",
  "scripts/lib/local-release-evidence.mjs",
  "scripts/local-release.mjs",
  "scripts/test-ci-test-selection.mjs",
  "scripts/test-local-release.mjs",
  "scripts/test-q2-runtime-launcher.mjs",
  "tests/helpers/canvas-agent-h3-recovery-control.mjs",
  "tests/helpers/canvas-agent-readiness-control.mjs",
  "tests/helpers/q2-runtime/canvas-readiness-recovery.mjs",
  "tests/helpers/q2-runtime/canvas.mjs",
  "tests/helpers/q2-runtime/control.mjs",
  "tests/helpers/q2-runtime/linux-bootstrap.py",
  "tests/helpers/q2-runtime/linux-hosted.mjs",
  "tests/helpers/q2-runtime/linux-runtime-child.mjs",
  "tests/helpers/q2-runtime/runner.mjs",
  "tests/q2-canvas-agent-h3-recovery.spec.js",
  "tests/q2-canvas-agent-readiness.spec.js",
  "workers/auth/src/lib/canvas-agent-assistant-models.js",
  "workers/auth/src/lib/canvas-agent-execution.js",
  "workers/auth/src/lib/canvas-agent-media-recovery.js",
  "workers/auth/src/lib/canvas-agent-planning.js"
]);
export const EXPORT_DELIVERY_UNPUBLISHED_FILES=Object.freeze([...new Set([...EXPORT_DELIVERY_FILES,...EXPORT_DELIVERY_PRIOR_FILES])].sort());
export const EXPORT_DELIVERY_INPUTS=Object.freeze({
  "scripts/lib/local-release-browser.mjs": "d4b09803a92664b519dd3d3cbd9163f3242dd66222a089bed5a6e515c58eb21d",
  "scripts/local-release.mjs": "3b70bcd75dbab472518fde29026cb376e8d767d812f5bcfb39753573737be863",
  "tests/helpers/canvas-agent-h3-recovery-control.mjs": "a55dc6ac891b71cb0043d4c1cc9b0390cf1a6d7f93ad4be6505c5477e35fb199",
  "tests/helpers/canvas-agent-readiness-control.mjs": "b9aa7f996ab253b21cffc4fc75a8b588568400c1cfdb5748a6555eeca48b2bdd",
  "tests/q2-canvas-agent-h3-recovery.spec.js": "84f460ad33ee19a6b5acb4a94d5c819604a3fb2b4135118c8ee7d327b96e9a56",
  "tests/q2-canvas-agent-readiness.spec.js": "dd6cbbeac4d7efc6a3feae1fed94b307663ccc27906769777bb3839ea73e2ba3",
  "workers/auth/src/lib/canvas-agent-assistant-models.js": "eec3d1761b695c8fdf41443284767d3c0a8604e76dddea54362ab609e533be31",
  "workers/auth/src/lib/canvas-agent-execution.js": "a79eb0e46ac16047f4a84066e4267578aa5dab31ffd7fea26bb6df589f104b2c",
  "workers/auth/src/lib/canvas-agent-media-recovery.js": "4f90e4510c173878ebaee41b491737729c7cf63a579cb347d275fd2b93547d0c",
  "workers/auth/src/lib/canvas-agent-planning.js": "a22b1e03c04b0e9d9e04a0bc3a42fbdb501d3668bbfce1ce30612e37a694cfdf",

  "js/pages/canvas/export-observer.js": "c681d8dee52dcc4f825f49529be626e138107abf81d47aa6867319ae44dbdcda",
  "js/pages/canvas/full-video.js": "8ac26198ea9d88829d725409eaba6c8c3d0f7476603ce780dc940758641e469a",
  "workers/media/src/index.js": "856e8fa091f9f37e13a4dbc3cd14c626a090e3c45dab5c4f862f4486cb4d4723",
  "scripts/test-private-media-lifecycle.mjs": "1cad7bc467b7e8c2290aa1d4e034ecd996ca7fdd85313b49d82e0ec8c4719d13",
  "workers/auth/src/lib/private-media-service.js": "228e5fcb8733904aaf1b6474a35af2d1d968f49cf9e6d7c4d04db2361d203a7e",
  "workers/auth/src/routes/private-media-service.js": "802eb1e6e98a90a63c80f49e2e61c82b283e273b31cdcf12992ca8db456b5c95",
  "workers/auth/src/lib/canvas-video-processing.js": "119ef20ca76be346dcd98efa7ec6732825d313ce97a65aac35eeef7220d22f90",
  "workers/auth/src/routes/canvas-video-processing.js": "3cf00c65090efcf81347b710d34f829e88475b747b4ae53ddc3a7e15ebcb7aed",
  "workers/auth/src/lib/canvas-agent-graph.js": "af675dec741a2305ec4f90828482878d48b17bd92de56f7de99ddf838af28b53",
  "services/homepage-ffmpeg-processor/canvas-diagnostics.mjs": "e362d8dac37fae98415f2660e16c482af8167583fefe3101958675cf21348a66",
  "services/homepage-ffmpeg-processor/canvas-full-video.mjs": "7e90ed5b53df4bc2b9cc89fad419356ed2c264ba28b37b61382a0fd8f8ca42ef",
  "services/homepage-ffmpeg-processor/canvas-full-video.test.mjs": "b30037efa4cd3aa06642cb951fbeab882e056237ff1c973e2b3987648a321413",
  "services/homepage-ffmpeg-processor/container-server.mjs": "8d100a1e9e79439830d097c97cdd9f81de5f9cc0152e6da041084409c1bf0dbb",
  "services/homepage-ffmpeg-processor/private-media-runner.test.mjs": "c7f6c3db7dee8cd2aefde7f61b5526c89384e7507af93542d79f768370142dc7",
  "tests/helpers/canvas-agent-control.mjs": "6bd26795ffea711abb362ed2bff46aff1fc61e4d65ae8c282e931ae4be070755",
  "tests/q2-canvas-agent.spec.js": "c5833df3d129f9797e02af2f9282cdce63a856175ca4b0fad5063a55f9bcf5d0",
  "tests/helpers/private-media-control.mjs": "a7a366a4c285e61e7ee19b1ed01225026208c9ebeaf496709ca847350a645694",
  "tests/helpers/canvas-assembly-editing-ui.cjs": "de1df74821bf60e57d77720367431e000326d5fe024baac111c0201f89e0c9af",
  "tests/helpers/canvas-export-lifecycle-ui.cjs": "e37e6e7e6431a8bb26e7445f15fdfb681c6b0cead117ee24586d6626ce63ab5f",
  "tests/helpers/q2-runtime/canvas.mjs": "ac7c86778b429bbf5c81c96a151ae67e8e18828371cd4329f215665041b440fd",
  "tests/helpers/q2-runtime/control.mjs": "fe95e87650766a2dc589a60033c0281059064aef877a04cf924d38b572fdc920"
});
export function exportDeliverySources(head=null){
  try{return Object.fromEntries(Object.keys(EXPORT_DELIVERY_INPUTS).map(file=>[file,createHash('sha256').update(head?execFileSync('git',['show',`${head}:${file}`],{stdio:['ignore','pipe','pipe']}):fs.readFileSync(new URL(`../../${file}`,import.meta.url))).digest('hex')]));}catch{return null;}
}
export function isExportDeliverySource(sources){
  return !!sources&&Object.entries(EXPORT_DELIVERY_INPUTS).every(([file,hash])=>sources[file]===hash);
}
export const EXPORT_DELIVERY_BROWSER_GREP='Canvas export lifecycle|Canvas editable film';
// Playwright matches file/project plus title. End anchors keep these exact
// names; a leading ^ would reject both registered tests before execution.
export const EXPORT_DELIVERY_WORKER_GREP='Canvas private full video: chain, ownership, poster retry and backfill$|Canvas agent Seedance native duration constrains trims before graph admission$';
export function verifyExportDeliveryDiscovery(rows){
  const expected=['chromium','webkit-canvas'].flatMap(project=>['en','de'].flatMap(locale=>[
    `Canvas export lifecycle ${locale}: observation and submission recovery`,
    `Canvas editable film ${locale}: rerun remove reorder sound export reopen`,
  ].map(title=>`${project}:canvas.spec.js:${title}`)));
  assert.deepEqual(rows.map(row=>`${row.project}:${row.file}:${row.title}`).sort(),expected.sort(),'Export delivery requires both real callers in both languages and engines');
  assert(rows.every(row=>row.expectedStatus==='passed'),'Export delivery cases must execute');
}
export function exportDeliveryCommand(command,selection){
  if(selection.policy!==EXPORT_DELIVERY_POLICY)return command;
  const runs={
    'Run CI test selection fixtures':'node scripts/test-ci-test-selection.mjs --canvas-export-delivery-only',
    'Test local release evidence and orchestration':'node scripts/test-local-release.mjs --export-delivery-only',
    'Run worker route tests':[
      'set -eu',
      "node --test --test-name-pattern='Canvas (readiness recovery|export delivery)' scripts/test-q2-runtime-launcher.mjs",
      `npx playwright test -c playwright.workers.config.js tests/workers.spec.js tests/q2-canvas-agent.spec.js --grep '${EXPORT_DELIVERY_WORKER_GREP}' --workers=1 --retries=0`,
      'node scripts/test-q2-runtime.mjs --suite canvas-export-delivery',
    ].join('\n'),
    'Run selected auth and admin tests':[
      'set -eu',
      'rm -f test-results/canvas-discovery.json test-results/candidate-auth.json',
      `PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/canvas-discovery.json npm run test:static -- tests/canvas.spec.js --project=chromium --project=webkit-canvas --grep '${EXPORT_DELIVERY_BROWSER_GREP}' --list --reporter=json`,
      `PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/candidate-auth.json npm run test:static -- tests/canvas.spec.js --project=chromium --project=webkit-canvas --grep '${EXPORT_DELIVERY_BROWSER_GREP}' --workers=1 --retries=0 --output=test-results/canvas-artifacts --reporter=list,json`,
    ].join('\n'),
  };
  return Object.hasOwn(runs,command.name)?{...command,run:runs[command.name]}:command;
}
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export const EXPORT_DELIVERY_PREFLIGHT=Object.freeze({
  source:'a4f16920ee3c8ddad924f49dab75235ad5a6fafb',
  base:'4dd1caccca2d05a3e69e61ed3f9fe0db67bbefd5',
  checkpoint:'3cb41025b275973d7ac54ae26b05d439e9fe00a2d143119e4f5ee4791e92ca9d',
  // Only unchanged short checks. Every affected product, launcher, selector,
  // proof, native runtime, browser and AMD64 image result is fresh.
  retain:Object.freeze([1,6,8,9,10,11,13,19,20,21,22,23,24,26,28,30,31,32,39]),
});
export const EXPORT_DELIVERY_SELECTION_PREFLIGHT=Object.freeze({
  source:'ffb4f0403aeefb559b15ca4ab95d65bed758068b',
  base:EXPORT_DELIVERY_PREFLIGHT.base,
  checkpoint:'b52d593308b62aa077a04bcdd78982164ec46b71cfad1d715373fbf844048ec1',
  failedLog:'248d70dbbe4804f8b3a3ba7a43266dbb2519088c27d9f5a7b9b7b2f26662293b',
  // DOM/routes and planner/safety callers see unchanged inputs and the exact
  // same real selection. Changed source/scanning/docs/verifiers remain fresh.
  retain:Object.freeze([...EXPORT_DELIVERY_PREFLIGHT.retain,4,5,14,15].sort((a,b)=>a-b)),
  previous:EXPORT_DELIVERY_PREFLIGHT,
});
export const EXPORT_DELIVERY_DISCOVERY_PREFLIGHT=Object.freeze({
  source:'fb976ca958e47d8c203ce7fb370ed13a514913cf',
  base:EXPORT_DELIVERY_PREFLIGHT.base,
  checkpoint:'5867141a7e81ac2b98df70d97c2fea2973759c8385f870fff44a53be70644aa2',
  failedLog:'df84ef310ed51b6e6b4a9fd2dccb003381ef27748b944225e0c45ca3107172c2',
  // The corrected runbook was accepted in this attempt and is unchanged.
  retain:Object.freeze([...EXPORT_DELIVERY_SELECTION_PREFLIGHT.retain,7].sort((a,b)=>a-b)),
  previous:EXPORT_DELIVERY_SELECTION_PREFLIGHT,
});
export const exportDeliveryCorrectionProfile=source=>[EXPORT_DELIVERY_DISCOVERY_PREFLIGHT,EXPORT_DELIVERY_SELECTION_PREFLIGHT].find(profile=>profile.source===source)||null;
export function assertExportDeliveryTree(head,read,parent=EXPORT_DELIVERY_PREFLIGHT.source){
  const p=EXPORT_DELIVERY_PREFLIGHT;
  assert.deepEqual(read(['rev-list','--parents','-n','1',head]).toString().trim().split(/\s+/),[head,parent],'Export delivery reuse requires the exact published successor');
  const files=read(['diff','--name-only',p.source,head]).toString().trim().split('\n').filter(Boolean);
  assert(files.includes('workers/media/src/index.js')&&files.includes('js/pages/canvas/export-observer.js'),'Missing reviewed export repair');
  assert(files.every(file=>EXPORT_DELIVERY_FILES.includes(file)||['docs/runbooks/REGRESSION_REGISTER.md','docs/production-readiness/MAIN_ONLY_RELEASE_RUNBOOK.md'].includes(file)),'Changed input outside export delivery reuse closure');
  for(const [file,hash]of Object.entries(EXPORT_DELIVERY_INPUTS))assert.equal(digest(read(['show',`${head}:${file}`])),hash,'Changed reviewed export source: '+file);
  return files;
}
export function exportDeliveryPrefix(bytes,context,read){
  const p=EXPORT_DELIVERY_PREFLIGHT,old=JSON.parse(bytes);
  assertExportDeliveryTree(context.sha,read);
  const unpublished=read(['diff','--name-only',p.base,context.sha]).toString().trim().split('\n').filter(Boolean).sort();
  assert.deepEqual(context.selection.files,unpublished,'Incomplete unpublished export delivery selection');
  assert(EXPORT_DELIVERY_PRIOR_FILES.every(file=>unpublished.includes(file)),'Missing accepted Auth-only release inputs');
  assert.equal(digest(bytes),p.checkpoint,'Changed published export baseline proof');
  return validateExportDeliveryPrefix(old,context);
}
export function validateExportDeliveryPrefix(old,context){
  const p=EXPORT_DELIVERY_PREFLIGHT;
  assert.equal(old.status,'passed');assert.equal(old.sha,p.source);assert.equal(old.base,p.base);assert.equal(context.base,p.base,'Frontend base must be the verified published source, not the Auth-only checkpoint');
  assert.deepEqual(old.selection.files,[...EXPORT_DELIVERY_PRIOR_FILES].sort(),'Changed accepted prior unpublished scope');
  assert.equal(old.planHash,context.planHash);assert.equal(old.environment.key,context.environment.key);
  assert.equal(old.commands.length,46);assert(old.commands.every(row=>row.exitCode===0));
  assert.equal(context.selection.policy,EXPORT_DELIVERY_POLICY);
  for(const index of p.retain)assert.deepEqual(old.commands[index].command,context.commands[index],'Changed retained check inputs or command');
  return old;
}
export function assertExportDeliverySelectionTree(head,read,p=EXPORT_DELIVERY_SELECTION_PREFLIGHT){
  // Keep the failed candidate reachable in the pushed ancestry. Evidence
  // archives contain reports, not orphan Git objects for the hosted verifier.
  assertExportDeliveryTree(head,read,p.source);
  for(let current=p;current.previous;current=current.previous)
    assert.deepEqual(read(['rev-list','--parents','-n','1',current.source]).toString().trim().split(/\s+/),[current.source,current.previous.source]);
  const files=read(['diff','--name-only',p.source,head]).toString().trim().split('\n').filter(Boolean);
  const allowed=['scripts/lib/canvas-export-release.mjs','scripts/lib/local-release-evidence.mjs','scripts/test-local-release.mjs',
    ...(p===EXPORT_DELIVERY_DISCOVERY_PREFLIGHT?['scripts/test-ci-test-selection.mjs']:['docs/production-readiness/MAIN_ONLY_RELEASE_RUNBOOK.md'])];
  assert(files.includes('scripts/lib/canvas-export-release.mjs'));
  assert(files.every(file=>allowed.includes(file)),'Changed input outside failed selection correction');
  // This correction changes only expected documentation membership and the
  // proof of reuse. Selection implementation and product inputs stay exact.
  for(const file of ['scripts/lib/ci-test-selection.mjs','scripts/lib/release-plan.mjs','scripts/test-release-plan.mjs','scripts/test-static-deploy-safety.mjs'])
    assert.equal(digest(read(['show',`${head}:${file}`])),digest(read(['show',`${p.source}:${file}`])),'Changed retained planner input');
}
export function validateExportDeliverySelectionPrefix(old,context,p=EXPORT_DELIVERY_SELECTION_PREFLIGHT){
  assert.equal(old.sha,p.source);assert.equal(old.status,'failed');assert.equal(old.base,p.base);assert.equal(context.base,p.base);
  assert.equal(old.planHash,context.planHash);assert.equal(old.environment.key,context.environment.key);
  assert.deepEqual(old.preflightContinuation,{source:p.previous.source,checkpoint:p.previous.checkpoint});
  assert.deepEqual(old.selection,context.selection,'Failed selection correction cannot change actual acceptance scope');
  assert.equal(old.commands.length,46);
  assert(old.commands.slice(0,16).every(row=>row?.exitCode===0));
  assert.equal(old.commands[16]?.exitCode,1);assert.equal(old.commands[16]?.logHash,p.failedLog);
  assert.equal(old.commands[16]?.command.name,'Run CI test selection fixtures');
  assert(old.commands.slice(17).every((row,i)=>EXPORT_DELIVERY_PREFLIGHT.retain.includes(i+17)?row?.exitCode===0:row===null),'Unexpected execution after failed selector');
  for(const index of p.retain)assert.deepEqual(old.commands[index].command,context.commands[index],'Changed retained check inputs or command');
  return old;
}
export function exportDeliverySelectionPrefix(bytes,context,read,p=EXPORT_DELIVERY_SELECTION_PREFLIGHT){
  assertExportDeliverySelectionTree(context.sha,read,p);
  assert.equal(digest(bytes),p.checkpoint,'Changed failed selection checkpoint');
  assert.deepEqual(context.selection.files,read(['diff','--name-only',p.base,context.sha]).toString().trim().split('\n').filter(Boolean).sort(),'Incomplete unpublished export selection');
  return validateExportDeliverySelectionPrefix(JSON.parse(bytes),context,p);
}
export function verifyExportDeliveryReuse(directory,evidence,commands,{read,readFile}){
  const p=exportDeliveryCorrectionProfile(evidence.preflightContinuation?.source)||EXPORT_DELIVERY_PREFLIGHT;
  assert.deepEqual(evidence.preflightContinuation,{source:p.source,checkpoint:p.checkpoint});
  const prefix=p===EXPORT_DELIVERY_PREFLIGHT?exportDeliveryPrefix:exportDeliverySelectionPrefix;
  const old=prefix(readFile(`${directory}/reuse/preflight-checkpoint.json`),{...evidence,commands},read,p);
  validateExportDeliveryRows(old,evidence,commands,file=>readFile(`${directory}/${file}`),p);
}
export function validateExportDeliveryRows(old,evidence,commands,readLog,p=EXPORT_DELIVERY_PREFLIGHT){
  assert.equal(evidence.commands.length,commands.length);
  for(const [index,row]of evidence.commands.entries()){
    if(p.retain.includes(index)){
      assert.deepEqual(row,{...old.commands[index],reusedFrom:old.commands[index].reusedFrom||old.sha});
      assert.equal(digest(readLog(row.log)),row.logHash,'Changed retained log');
    }else assert(!row.reusedFrom&&!row.continuation&&!row.browserContinuation,'Affected export acceptance must execute on candidate bytes');
  }
}
