import {SMOOTH_BROWSER_POLICY,SMOOTH_BROWSER_CONTINUATION,isSmoothContinuation,assertSmoothContinuationTree,verifySmoothBrowserReport,verifySmoothImageReuse,verifyImportedSmoothImage,restoreSmoothBrowserProof,passedBrowserCase} from './lib/local-release-browser.mjs';
import {browserRows} from './lib/browser-fixture-repair.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { yaml } from '../node_modules/playwright-core/lib/utilsBundle.js';
import { selectCiTests } from './lib/ci-test-selection.mjs';
import { validationPlan, selectedCommands, sha256, commandRuntimes, nativeBrowserKey, verifyImportWorkflow } from './lib/local-release-plan.mjs';
import { environmentInputs, environmentKey, TOOL_PREFLIGHT, toolchainPins } from './lib/local-release-environment.mjs';
import { validateLocator, extractEvidence, stageImportedCandidate } from './lib/local-release-transport.mjs';
import { scanRepoForSecrets } from './lib/quality-gates.mjs';
import { verifyLocalEvidence, rebindLocalCandidate, verifyNativeLocalReports, workerListResults, verifyWorkerUnion, assertLocalRepairTree, verifyLocalWorkerRepair, localWorkerContinuation, tapResults, verifyNativeCaseUnion, NATIVE_REPAIRED_CASES, verifyNativeBrowserEnvironment, verifyMigrationCandidateBytes, LOCAL_HOMEPAGE_REPORTS, verifyRetainedHomepageReports, verifyRetainedFrontendLog } from './lib/local-release-evidence.mjs';
import {readMigrationBrowserPool,migrationBrowserPool,verifyBrowserUnion,verifyMigrationBrowserReport,BROWSER_ORIGINS,LOCAL_BROWSER_POLICY} from './lib/local-release-browser.mjs';
import { prepareFrontend, verifyFrontend, stopFrontendRuntime } from './lib/frontend-hosting.mjs';
import { gitSelection, tree, MEDIA_POLICY, candidateProof, validateSource, verifyManifest, verifyProofs } from './pages-candidate.mjs';
import { assertHostedBootstrapAllowed, assertLocalBootstrapAllowed } from '../tests/helpers/q2-runtime/linux-hosted.mjs';
import { acquireLocalReleaseLock, prepareCandidateRestore, copyEvidenceToolInputs } from './local-release.mjs';
import { LOCAL_IMPORT_REPAIR, assertImportRepairWorkflow, localRepairCommand, verifyImportRepairEvidence } from './lib/local-release-evidence.mjs';
import {PERMISSION_CONTINUATION,PERMISSION_REFRESH,assertPermissionContinuationTree,permissionContinuationPrefix,CANVAS_STAGE_CASES,canvasStageContinuation} from './lib/local-release-evidence.mjs';

function testPermissionContinuation() {
  const head='f'.repeat(40),corrected=fs.readFileSync('scripts/test-frontend-review.mjs');
  const reader=(files,bytes=corrected)=>args=>args[0]==='show'?bytes:Buffer.from(args[0]==='diff'?files.join('\n'):'');
  assertPermissionContinuationTree(head,reader(['scripts/test-frontend-review.mjs']));
  for(const file of ['js/pages/canvas/main.js','package-lock.json','.github/workflows/static.yml','config/release-validation.yml','tests/canvas.spec.js'])
    assert.throws(()=>assertPermissionContinuationTree(head,reader(['scripts/test-frontend-review.mjs',file])),/changed product/);
  assert.throws(()=>assertPermissionContinuationTree(head,reader(['scripts/test-frontend-review.mjs'],Buffer.from('unchecked write permissions'))),/Unreviewed/);
  assert.throws(()=>permissionContinuationPrefix(Buffer.from('{}'),{}),/original failed/);
  assert(PERMISSION_REFRESH.has(17)&&PERMISSION_REFRESH.has(34)&&!PERMISSION_REFRESH.has(18),'Changed verifiers/build refresh; unchanged discovery retains proof');
  const file='.local-release/reuse/test-results/permission-checkpoint.json';
  if(fs.existsSync(file)) {
    const bytes=fs.readFileSync(file),original=JSON.parse(bytes),actualHead=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
    const context={head:actualHead,base:original.base,planHash:validationPlan().digest,environment:original.environment,
      commands:selectedCommands(gitSelection(original.base,actualHead),{GITHUB_SHA:actualHead,CANDIDATE_BASE:original.base})};
    assertPermissionContinuationTree(actualHead,undefined,{smooth:isSmoothContinuation(original.sha)});assert([PERMISSION_CONTINUATION.source,PERMISSION_CONTINUATION.tail,SMOOTH_BROWSER_CONTINUATION.source,SMOOTH_BROWSER_CONTINUATION.progress,SMOOTH_BROWSER_CONTINUATION.accepted,SMOOTH_BROWSER_CONTINUATION.completed].includes(permissionContinuationPrefix(bytes,context).sha));
    for(const mutate of [r=>r.commands[0].exitCode=1,r=>r.commands[0].logHash='wrong',r=>r.commands.pop(),r=>r.status=r.status==='passed'?'failed':'passed']) {
      const wrong=structuredClone(original);mutate(wrong);assert.throws(()=>permissionContinuationPrefix(Buffer.from(JSON.stringify(wrong)),context));
    }
    for(const mutate of [c=>c.base='b'.repeat(40),c=>c.planHash='changed',c=>c.environment.key='changed',c=>c.commands[18].run='skip']) {
      const wrong=structuredClone(context);mutate(wrong);assert.throws(()=>permissionContinuationPrefix(bytes,wrong));
    }
    if(original.sha===PERMISSION_CONTINUATION.tail) {
      const before=tapResults(fs.readFileSync('.local-release/reuse/stage-failed.log','utf8'));
      const corrected=CANVAS_STAGE_CASES.map(title=>({title,status:'passed'}));verifyNativeCaseUnion(before,corrected,CANVAS_STAGE_CASES);
      for(const after of [[],corrected.slice(1),[...corrected,corrected[0]],corrected.map((r,i)=>i?r:{...r,status:'failed'})])assert.throws(()=>verifyNativeCaseUnion(before,after,CANVAS_STAGE_CASES));
      const command=context.commands[41].run;assert(canvasStageContinuation(command).includes('npx playwright test'));assert(canvasStageContinuation(command).includes('node scripts/test-q2-runtime.mjs --suite canvas-audio'));
      const syntax=spawnSync('/bin/bash',['-n'],{input:canvasStageContinuation(command),encoding:'utf8'});assert.equal(syntax.status,0,syntax.stderr);
    }
  }
  console.log('Permission continuation: exact failed checkpoint/tree, immutable passes, changed scope/toolchain and forged-success controls passed.');
}


function testSmoothContinuation() {
  const p=SMOOTH_BROWSER_CONTINUATION,head='f'.repeat(40);
  const staging=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-proof-inputs-'));
  try {
    const source=path.join(staging,'source'),target=path.join(staging,'target');fs.mkdirSync(path.join(source,'test-results/canvas-artifacts'),{recursive:true});fs.mkdirSync(path.join(source,'docs'));
    for(const file of ['test-results/canvas-artifacts/error-context.md','test-results/canvas-artifacts/result.json','docs/UNKNOWN.md'])fs.writeFileSync(path.join(source,file),'retained');
    fs.mkdirSync(path.join(source,'reuse/test-results'),{recursive:true});fs.writeFileSync(path.join(source,'reuse/test-results/permission-checkpoint.json'),JSON.stringify({candidateFiles:{'site/js/api-token.js':'a'.repeat(64)}},null,2));
    copyEvidenceToolInputs(source,target);assert(fs.existsSync(path.join(source,'test-results/canvas-artifacts/error-context.md')));
    assert(!fs.existsSync(path.join(target,'test-results/canvas-artifacts/error-context.md')));assert(fs.existsSync(path.join(target,'test-results/canvas-artifacts/result.json')));assert(fs.existsSync(path.join(target,'docs/UNKNOWN.md')));assert.equal(scanRepoForSecrets(target).length,0);
    fs.writeFileSync(path.join(target,'product.js'),'const token = '+JSON.stringify('Z'.repeat(40))+';');assert(scanRepoForSecrets(target).length>0,'Product secrets must still block after staging proof metadata');
  }finally{fs.rmSync(staging,{recursive:true,force:true});}
  const read=(changed=Object.keys(p.specs),broken=false)=>args=>args[0]==='show'?broken?Buffer.from('invalid expectation'):execFileSync('git',['show',`${p.accepted}:${args[1].split(':')[1]}`]):Buffer.from(args[0]==='diff'?changed.join('\n'):'');
  assertSmoothContinuationTree(head,read());
  // Closed historical evidence uses its pinned Git fixture, never today's
  // independently changed Canvas tests. A changed fixture still rejects.
  for(const file of Object.keys(p.specs)) {
    const current=fs.readFileSync(file);
    if(sha256(current)!==p.specs[file])assert.throws(()=>assertSmoothContinuationTree(head,args=>args[0]==='show'&&args[1].endsWith(':'+file)?current:read()(args)),/Unreviewed/);
  }
  for(const file of ['js/pages/canvas/full-video.js','services/homepage-ffmpeg-processor/canvas-seams.mjs','workers/auth/src/routes/canvas.js','package-lock.json','.github/workflows/static.yml'])
    assert.throws(()=>assertSmoothContinuationTree(head,read([...Object.keys(p.specs),file])),/cannot inherit/);
  assert.throws(()=>assertSmoothContinuationTree(head,read(undefined,true)),/Unreviewed/);
  const dir='.local-release',file=path.join(dir,'reuse/smooth-browser.json');
  if(fs.existsSync(file)) {
    const bytes=fs.readFileSync(file);assert.equal(sha256(bytes),p.report);const previous=browserRows(JSON.parse(bytes));
    const discovery=browserRows(JSON.parse(fs.readFileSync(path.join(dir,'test-results/canvas-discovery.json'))),{discovery:true});
    const fresh=previous.filter(row=>!passedBrowserCase(row)).map(row=>({...row,expectedStatus:'passed',status:'expected',results:[{status:'passed',retry:0,error:false}]}));
    const report={policy:SMOOTH_BROWSER_POLICY,sha:head,source:p.source,previous,discovery,fresh,counts:{required:228,reused:208,executed:20}};
    assert.deepEqual(verifySmoothBrowserReport(report,head),report.counts);
    const manifest={sha:head,selection:{auth:true,canvasText:true,canvasAudio:true}};
    const proof=()=>candidateProof(manifest,{job:'browser-validation',readJson:name=>name.endsWith('canvas-discovery.json')?JSON.parse(fs.readFileSync(path.join(dir,'test-results/canvas-discovery.json'))):report});
    assert.equal(proof().tests,228);
    for(const mutate of [r=>r.fresh.pop(),r=>r.fresh.push(r.fresh[0]),r=>r.fresh[0].results[0].status='failed',r=>r.fresh[0].results[0].retry=1,r=>r.previous[0].status='unexpected',r=>r.discovery.pop()]) {
      const original=structuredClone(report);mutate(report);assert.throws(proof);Object.assign(report,original);
    }
    if(fs.existsSync(path.join(dir,'reuse/smooth-accepted.json'))) {
      const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-browser-proof-'));
      try {fs.mkdirSync(path.join(tmp,'reuse'));fs.mkdirSync(path.join(tmp,'test-results'));fs.copyFileSync(path.join(dir,'reuse/smooth-accepted.json'),path.join(tmp,'reuse/smooth-accepted.json'));
        const rebound=restoreSmoothBrowserProof(tmp,{sha:head});restoreSmoothBrowserProof(tmp,{sha:head,verifyOnly:true});assert.equal(verifySmoothBrowserReport(rebound,head).required,228);
        rebound.reusedFrom.sha=head;assert.throws(()=>verifySmoothBrowserReport(rebound,head));
      }finally{fs.rmSync(tmp,{recursive:true,force:true});}
    }
    const image=JSON.parse(fs.readFileSync(path.join(dir,'test-results/private-media-image/image.json')));assert.equal(verifySmoothImageReuse(image,head,{read:read()}),p.source);
    const imported={...image,run:'123',attempt:'1',localValidation:{policy:'development-mac-v1',publicationSha:head,run:image.run,attempt:image.attempt,evidence:'a'.repeat(64),recordHash:sha256(JSON.stringify(image))}};
    const verify=record=>verifyImportedSmoothImage(record,{sha:head,run:'123',attempt:'1'},{read:read()});assert.equal(verify(imported),p.source);
    for(const mutate of [r=>r.sha=head,r=>r.image='sha256:'+'b'.repeat(64),r=>r.sourceFiles={},r=>r.localValidation.publicationSha='c'.repeat(40),r=>r.run='999',r=>r.tests.pop(),r=>r.localValidation.run='other']) {
      const bad=structuredClone(imported);mutate(bad);assert.throws(()=>verify(bad));
    }
    console.log('Synthetic counterchecks only: 208 retained/20 required union; missing, failed, retry-only, forged source and changed image rejected through actual candidate/import verifiers.');
  }
}

function testImportRepair({closed=false}={}) {
  const file='.github/workflows/static.yml',text=fs.readFileSync(file,'utf8'),workflow=yaml.parse(text);
  verifyImportWorkflow(workflow);
  const changes=[
    w=>delete w.jobs['release-compatibility'].permissions,
    w=>w.jobs['release-compatibility'].permissions.contents='read',
    w=>w.jobs['release-compatibility'].permissions.issues='write',
    w=>w.permissions.contents='write',w=>w.jobs.deploy.permissions.contents='write',
    w=>w.jobs['release-compatibility'].env={GH_TOKEN:'${{ github.token }}'},
    w=>w.jobs['release-compatibility'].steps.find(s=>s.name==='Install dependencies').env={GH_TOKEN:'${{ github.token }}'},
    w=>w.jobs['release-compatibility'].steps.find(s=>s.name==='Install dependencies').run='npm ci',
    w=>w.jobs['release-compatibility'].steps.find(s=>s.name==='Checkout').with['persist-credentials']=true,
    w=>w.jobs['release-compatibility'].steps.find(s=>s.id==='local_evidence').if='false',
    w=>w.jobs['release-compatibility'].steps.find(s=>s.id==='local_evidence')['continue-on-error']=true,
    w=>w.jobs['release-compatibility'].steps=w.jobs['release-compatibility'].steps.filter(s=>s.id!=='local_evidence'),
  ];
  for(const change of changes){const wrong=structuredClone(workflow);change(wrong);assert.throws(()=>verifyImportWorkflow(wrong));}
  const missing=structuredClone(workflow);delete missing.jobs['release-compatibility'].permissions;
  const before=closed?execFileSync('git',['show',`${LOCAL_IMPORT_REPAIR.source}:${file}`],{encoding:'utf8'}):yaml.stringify(missing);
  if(closed) {
    assertImportRepairWorkflow(before,text);
    for(const changed of [before,text.replace('cancel-in-progress: false','cancel-in-progress: true'),text.replace('digest-mismatch: error','digest-mismatch: warn')])
      assert.throws(()=>assertImportRepairWorkflow(before,changed));
  }
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-import-repair-'));
  try {
    // Exercise the actual early caller, not just a helper with a synthetic object.
    fs.mkdirSync(path.join(tmp,'.github/workflows'),{recursive:true});fs.mkdirSync(path.join(tmp,'config'));
    fs.copyFileSync('config/release-validation.yml',path.join(tmp,'config/release-validation.yml'));
    fs.writeFileSync(path.join(tmp,file),text);validationPlan(tmp);
    fs.writeFileSync(path.join(tmp,file),before);assert.throws(()=>validationPlan(tmp),/approved import-job permission/);
    if(closed) {
    const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
    const gitEnv={...process.env,GIT_INDEX_FILE:path.join(tmp,'index')};
    function commitFile(name,bytes) {
      execFileSync('git',['read-tree',head],{env:gitEnv});
      const blob=execFileSync('git',['hash-object','-w','--stdin'],{input:bytes,encoding:'utf8'}).trim();
      execFileSync('git',['update-index','--cacheinfo',`100644,${blob},${name}`],{env:gitEnv});
      const tree=execFileSync('git',['write-tree'],{env:gitEnv,encoding:'utf8'}).trim();
      return execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit-tree',tree,'-p',head],{input:'Synthetic import permission boundary\n',encoding:'utf8'}).trim();
    }
    const allowed=commitFile(file,text);assertLocalRepairTree(allowed);
    assert.equal(localRepairCommand(allowed),'npm run test:local-release -- --import-repair-only');
    assert.throws(()=>assertLocalRepairTree(commitFile(file,text.replace('cancel-in-progress: false','cancel-in-progress: true'))),/Only the reviewed/);
    assert.throws(()=>assertLocalRepairTree(commitFile('tests/canvas.spec.js','changed input')),/Changed product/);
    const directory=process.env.LOCAL_IMPORT_EVIDENCE||(fs.existsSync('.local-release/reuse/test-results/import-source-evidence.json')?'.local-release':null);
    if(directory) {
      const source=verifyImportRepairEvidence(directory,allowed);
      assert.equal(source.original.commands.length,53);
      fs.mkdirSync(path.join(tmp,'reuse/test-results'),{recursive:true});
      for(const name of ['import-source-evidence.json','import-source-manifest.json','import-source-contract.log'])
        fs.copyFileSync(path.join(directory,'reuse/test-results',name),path.join(tmp,'reuse/test-results',name));
      for(const name of fs.readdirSync(path.join(tmp,'reuse/test-results'))) {
        const file=path.join(tmp,'reuse/test-results',name),bytes=fs.readFileSync(file);
        fs.unlinkSync(file);assert.throws(()=>verifyImportRepairEvidence(tmp,allowed));
        fs.writeFileSync(file,'changed');assert.throws(()=>verifyImportRepairEvidence(tmp,allowed));fs.writeFileSync(file,bytes);
      }
    }
    }
    const site=path.join(tmp,'candidate/site');fs.mkdirSync(site,{recursive:true});
    fs.writeFileSync(path.join(site,'index.html'),'<script src="/app.js?v=aaaaaaaaaaaa"></script>');
    const original={sha:'a'.repeat(40),files:tree(site)};
    fs.writeFileSync(path.join(site,'index.html'),'<script src="/app.js?v=bbbbbbbbbbbb"></script>');
    verifyMigrationCandidateBytes(tmp,original,{sha:'b'.repeat(40),files:tree(site)},{allowLabGuard:false});
    fs.appendFileSync(path.join(site,'index.html'),'changed product');
    assert.throws(()=>verifyMigrationCandidateBytes(tmp,original,{sha:'b'.repeat(40),files:tree(site)},{allowLabGuard:false}),/Unreviewed product/);
    const staging=path.join(tmp,'imported'),manifest={files:tree(site)};
    const bytes=JSON.stringify({candidateFiles:{'js/csrf-token.js':'a'.repeat(64)}},null,2);
    fs.writeFileSync(path.join(tmp,'evidence.json'),bytes);
    assert(scanRepoForSecrets(tmp).some(issue=>issue.file==='evidence.json'),'Exercise the metadata/hash false positive');
    // Keep destination outside unpack so the actual recursive import cannot copy itself.
    const unpack=path.join(tmp,'unpack');fs.mkdirSync(unpack);fs.cpSync(path.join(tmp,'candidate'),path.join(unpack,'candidate'),{recursive:true});
    fs.copyFileSync(path.join(tmp,'evidence.json'),path.join(unpack,'evidence.json'));
    stageImportedCandidate(unpack,{manifest},{manifest,proofs:[]},{receipt:1},{destination:staging});
    assert.equal(fs.readFileSync(path.join(staging,'test-results/local-validation/evidence.json'),'utf8'),bytes);
    assert.deepEqual(scanRepoForSecrets(staging),[]);
    assert.throws(()=>stageImportedCandidate(unpack,{manifest},{manifest,proofs:[]},{},{destination:staging}),/Refuse to replace/);
    fs.writeFileSync(path.join(staging,'site/app.js'),`const key = '${['sk','synthetic'].join('-')}${'x'.repeat(32)}';`);
    assert(scanRepoForSecrets(staging).some(issue=>issue.file==='site/app.js'),'Actual candidate secret still blocks the import scan');
  } finally {fs.rmSync(tmp,{recursive:true,force:true});}
  console.log('Import permission: scoped writer, private-token exposure, lifecycle scripts, blocking import, exact Git delta and original evidence/candidate counterchecks passed. No product tests executed.');
}
if(process.argv.includes('--import-repair-only')) {testImportRepair({closed:true});process.exit(0);}

function testNativeRouting() {
  const commands=selectedCommands(selectCiTests(['config/static-hosting.json']),{GITHUB_SHA:'a'.repeat(40),CANDIDATE_BASE:'b'.repeat(40)});
  for(const command of commands) {
    const parts=commandRuntimes(command);
    assert.equal(parts.map(part=>part.run).join('\n').trim(),command.run.trim(),'Runtime routing changed or omitted a selected command');
    if(command.job==='homepage-validation')assert.deepEqual(parts.map(part=>part.runtime),['linux']);
    if(command.name==='Run full static browser regression')assert.deepEqual(parts.map(part=>part.runtime),['native-browser-v1','linux']);
  }
  const full=commands.find(command=>command.name==='Run full static browser regression');assert(full);
  assert.throws(()=>commandRuntimes({...full,run:full.run+'\nnpm run extra-test'}));
  assert.throws(()=>commandRuntimes({...full,run:full.run.replace('test:homepage-carousel','test:auth')}));
  for(const [name,run,runtime]of [
    ['Run selected homepage carousel tests','npm run test:homepage-carousel','linux'],
    ['Run selected auth and admin tests','npm run test:auth','native-browser-v1'],
    ['Run selected homepage core tests','npm run test:homepage-core','native-browser-v1'],
    ['Confirm tested browser candidate bytes','node scripts/pages-candidate.mjs proof','linux'],
  ])assert.deepEqual(commandRuntimes({job:'browser-validation',name,run}),[{runtime,run}]);
  const inputs=Object.fromEntries(Object.entries(environmentInputs()).filter(([file])=>file.endsWith('package.json')||file.endsWith('package-lock.json')));
  inputs['tests/fixtures/media/test-video.mp4']=sha256(fs.readFileSync('tests/fixtures/media/test-video.mp4'));
  const pins=toolchainPins(),browsers=JSON.parse(fs.readFileSync('node_modules/playwright-core/browsers.json')).browsers;
  const record={policy:'native-browser-v1',node:pins.node,playwright:pins.playwright,platform:'darwin/arm64',kernel:'27.0.0',inputs,
    binaries:['chromium','chromium-headless-shell','webkit','ffmpeg','ffprobe'].map(name=>({name,hash:'a'.repeat(64)})),
    capabilities:Object.fromEntries(['chromium','webkit'].map(name=>[name,{version:browsers.find(browser=>browser.name===name).browserVersion,h264Decoded:true}])),
    mediaTools:{ffmpeg:'ffmpeg version 8.1.1',ffprobe:'ffprobe version 8.1.1'},verifiedAt:new Date().toISOString()};
  record.key=nativeBrowserKey(record);verifyNativeBrowserEnvironment(record);
  assert.throws(()=>verifyNativeBrowserEnvironment(null));
  for(const change of [r=>r.capabilities.chromium.h264Decoded=false,r=>delete r.capabilities.webkit,r=>r.capabilities.webkit.version='old',
    r=>r.inputs['package-lock.json']='changed',r=>r.inputs['tests/fixtures/media/test-video.mp4']='changed',r=>r.binaries.pop(),
    r=>r.binaries[0].hash='changed',r=>r.key='changed',r=>r.platform='linux/arm64',r=>delete r.mediaTools.ffprobe,r=>r.verifiedAt='unknown']) {
    const broken=structuredClone(record);change(broken);assert.throws(()=>verifyNativeBrowserEnvironment(broken));
  }
  console.log('Native browser routing preserves every selected command and the Linux carousel matrix; missing codec/tool/version/input evidence blocks acceptance.');
}
if(process.argv.includes('--native-only')) {testNativeRouting();process.exit(0);}
function testBrowserContinuation() {
  const row=(key,status='passed')=>({key,file:'fixture.spec.js',title:key,project:'chromium',expectedStatus:'passed',status:status==='passed'?'expected':'unexpected',results:[{status,retry:0,error:status!=='passed'}]});
  const identity=({key,file,title,project})=>({key,file,title,project});
  const retained=new Map([['kept',row('kept')]]),fresh=[row('fixed')],discovery=[...retained.values(),...fresh].map(identity);
  assert.deepEqual(verifyBrowserUnion(discovery,retained,fresh),{required:2,reused:1,executed:1});
  for(const changed of [[],[row('fixed','failed')],[row('fixed','skipped')],[{...row('fixed'),results:[{status:'passed',retry:1,error:false}]}],
    [row('fixed'),row('fixed')],[row('foreign')],[row('kept'),row('fixed')],[{...row('fixed'),project:'webkit'}]])assert.throws(()=>verifyBrowserUnion(discovery,retained,changed));
  assert.throws(()=>verifyBrowserUnion([...discovery,discovery[0]],retained,fresh));
  assert.throws(()=>verifyBrowserUnion(discovery,new Map([['kept',row('kept','failed')]]),fresh));
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-candidate-delta-'));
  try {
    const site=path.join(tmp,'candidate/site');fs.mkdirSync(path.join(site,'js/pages/generate-lab'),{recursive:true});fs.mkdirSync(path.join(site,'js/pages/admin'),{recursive:true});
    const source='export const fixture = true;\n',guard='    // Concurrent UI triggers may have awaited the same pricing refresh.\n    if (state.busy) return;\n';
    fs.writeFileSync(path.join(site,'index.html'),'<script src="/fixture.js?v=aaaaaaaaaaaa"></script>');
    fs.writeFileSync(path.join(site,'js/pages/generate-lab/main.js'),source);
    fs.writeFileSync(path.join(site,'js/pages/admin/ai-lab.js'),"const ADMIN_AI_UI_VERSION = 'aaaaaaaaaaaa';\n");
    const old={sha:'a'.repeat(40),files:tree(site)};
    fs.writeFileSync(path.join(site,'index.html'),'<script src="/fixture.js?v=bbbbbbbbbbbb"></script>');
    fs.writeFileSync(path.join(site,'js/pages/generate-lab/main.js'),guard+source);
    fs.writeFileSync(path.join(site,'js/pages/admin/ai-lab.js'),"const ADMIN_AI_UI_VERSION = 'bbbbbbbbbbbb';\n");
    const current={sha:'b'.repeat(40),files:tree(site)};verifyMigrationCandidateBytes(tmp,old,current);
    fs.appendFileSync(path.join(site,'js/pages/admin/ai-lab.js'),'unexpected');
    assert.throws(()=>verifyMigrationCandidateBytes(tmp,old,{...current,files:tree(site)}));
    fs.writeFileSync(path.join(site,'js/pages/admin/ai-lab.js'),"const ADMIN_AI_UI_VERSION = 'bbbbbbbbbbbb';\n");
    fs.appendFileSync(path.join(site,'js/pages/generate-lab/main.js'),'unexpected');
    assert.throws(()=>verifyMigrationCandidateBytes(tmp,old,current));
    assert.throws(()=>verifyMigrationCandidateBytes(tmp,old,{...current,files:tree(site)}),/Unreviewed product/);
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
  const directory=process.env.LOCAL_BROWSER_EVIDENCE||(fs.existsSync('.local-release/reuse/browser-previous.json')?'.local-release':null);
  if(directory) {
    const pool=readMigrationBrowserPool(directory),retained=migrationBrowserPool(pool);
    assert(retained.size>=707);assert.equal(pool.production.length,224);assert.equal(pool.coreProgress.filter(row=>row.status==='expected').length,225);
    const discovery=pool.previous.map(identity),pending=discovery.filter(row=>!retained.has(row.key));
    assert.equal(pending.length,0);
    const report={policy:LOCAL_BROWSER_POLICY,sha:'a'.repeat(40),scope:'auth',origins:BROWSER_ORIGINS,pool,discovery,fresh:[],counts:{required:709,reused:709,executed:0}};
    assert.deepEqual(verifyMigrationBrowserReport(report,report.sha),report.counts);
    assert.throws(()=>verifyMigrationBrowserReport({...report,counts:{...report.counts,executed:2}},report.sha),'Retained execution must never be labelled fresh');
    const changed=structuredClone(pool);changed.previous[0].title+=' changed';assert.throws(()=>migrationBrowserPool(changed));
    console.log('All real Auth/core passes retained with exact case provenance; no product test repeats.');
  }
  console.log('Browser continuation: exact discovery/union, omitted/duplicate/failed/skipped/retried/foreign cases and unreviewed candidate bytes counterchecked.');
}
if(process.argv.includes('--browser-only')) {testBrowserContinuation();process.exit(0);}

async function testLocalRepair() {
  let output='';
  const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>process.stdout.write('last-response\\n',()=>process.exit(0)));console.log('ready');setInterval(()=>{},1000)"],{stdio:['ignore','pipe','pipe']});
  try {
    await new Promise((resolve,reject)=>{child.on('error',reject);child.stdout.on('data',bytes=>{output+=bytes; if(output.includes('ready'))resolve();});});
    await stopFrontendRuntime(child);assert(output.endsWith('last-response\n'),'Proof must wait for final diagnostic bytes');
  }finally{if(child.exitCode===null)child.kill('SIGKILL');}

  testNativeRouting();
  testBrowserContinuation();
  const restored=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-local-restore-'));
  try {
    fs.mkdirSync(path.join(restored,'candidate/site'),{recursive:true});fs.writeFileSync(path.join(restored,'candidate/site/index.html'),'tested');
    fs.writeFileSync(path.join(restored,'candidate/manifest.json'),JSON.stringify({files:tree(path.join(restored,'candidate/site'))}));
    prepareCandidateRestore(restored);
    fs.cpSync(path.join(restored,'candidate/site'),path.join(restored,'_site'),{recursive:true});prepareCandidateRestore(restored);
    assert(!fs.existsSync(path.join(restored,'_site')));assert.equal(fs.readFileSync(path.join(restored,'candidate/site/index.html'),'utf8'),'tested');
    fs.cpSync(path.join(restored,'candidate/site'),path.join(restored,'_site'),{recursive:true});fs.writeFileSync(path.join(restored,'_site/index.html'),'changed');
    assert.throws(()=>prepareCandidateRestore(restored),/changed candidate bytes/);assert(fs.existsSync(path.join(restored,'_site/index.html')));
    fs.rmSync(path.join(restored,'_site'),{recursive:true});fs.symlinkSync(path.join(restored,'candidate/site'),path.join(restored,'_site'));
    assert.throws(()=>prepareCandidateRestore(restored),/Unexpected candidate input/);
  } finally {fs.rmSync(restored,{recursive:true,force:true});}

  const row=(id,status='passed')=>({id,file:'workers.spec.js',title:id,label:`tests/workers.spec.js:1:1 › ${id}`,results:[{status,retry:0,error:status!=='passed'}]});
  const previous=[row('kept'),row('fixed','failed'),row('pending','failed')];
  const fixture={previous,discovery:previous.map(({results,...identity})=>identity),progress:[row('fixed'),row('pending','failed')],corrected:[row('pending')]};
  assert.deepEqual(verifyWorkerUnion(fixture),{originalPassed:1,progressPassed:1,correctedPassed:1,total:3});
  for(const change of [f=>f.corrected.splice(0),f=>f.corrected[0].results[0].status='skipped',f=>f.corrected[0].results[0].retry=1,
    f=>f.discovery.pop(),f=>f.discovery.push(f.discovery[0]),f=>f.discovery[0].title='different',f=>f.progress.push(f.previous[0]),
    f=>f.previous[0].results[0].status='failed',f=>f.corrected.push(f.progress[0])]) {
    const broken=structuredClone(fixture);change(broken);assert.throws(()=>verifyWorkerUnion(broken));
  }
  const log=previous.map((r,i)=>`  ${i?'✘':'✓'} ${i+1} ${r.label} (1ms)`).join('\n');
  assert.equal(workerListResults(log,fixture.discovery).length,3);
  assert.throws(()=>workerListResults(log.split('\n').slice(1).join('\n'),fixture.discovery));
  assert.throws(()=>workerListResults(log.replace(' › pending',' › foreign'),fixture.discovery));
  assert(localWorkerContinuation().endsWith('node scripts/test-q2-runtime.mjs'));
  assert(!localWorkerContinuation().includes('npm run test:homepage-ffmpeg-processor'),'Passed processor must not be repeated');
  const nativeBefore=[...Array.from({length:25},(_,i)=>({title:`kept-${i}`,status:'passed'})),...NATIVE_REPAIRED_CASES.map(title=>({title,status:'failed'}))];
  const nativeAfter=NATIVE_REPAIRED_CASES.map(title=>({title,status:'passed'}));verifyNativeCaseUnion(nativeBefore,nativeAfter);
  assert.throws(()=>verifyNativeCaseUnion(nativeBefore,nativeAfter.slice(1)));
  assert.throws(()=>verifyNativeCaseUnion(nativeBefore,[{...nativeAfter[0],status:'failed'},nativeAfter[1]]));
  assert.throws(()=>verifyNativeCaseUnion(nativeBefore,[...nativeAfter,nativeAfter[0]]));
  assert.deepEqual(tapResults('ok 1 - foo # SKIP\nnot ok 2 - bar'),[{title:'foo',status:'skipped'},{title:'bar',status:'failed'}]);
  // Genuine stored Linux reports are optional test inputs; never manufactured.
  // The closed continuation itself always requires them at the actual verifier.
  if(fs.existsSync('.local-release/reuse/checkpoint.json')) {
    const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
    assertLocalRepairTree(head);
    verifyRetainedHomepageReports('.local-release');
    const manifest=JSON.parse(fs.readFileSync('.local-release/candidate/manifest.json'));
    const mapped=relative=>tree(path.join('.local-release',relative));
    verifyFrontend(manifest,mapped,{siteDirectory:'.local-release/candidate/site'});
    assert.throws(()=>verifyFrontend(manifest,mapped,{siteDirectory:'.local-release/missing-site'}));
    const log=fs.readFileSync('.local-release/test-results/frontend-runtime.log','utf8');
    const proof=JSON.parse(fs.readFileSync('.local-release/reuse/proof-frontend-runtime.json'));
    verifyRetainedFrontendLog(log,proof);
    assert.throws(()=>verifyRetainedFrontendLog(log+'changed',proof));
    assert.throws(()=>verifyRetainedFrontendLog(log,{...proof,tests:29}));
    const reports=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-homepage-reports-'));
    try {
      fs.mkdirSync(path.join(reports,'test-results'));
      for(const name of LOCAL_HOMEPAGE_REPORTS)fs.copyFileSync(path.join('.local-release/test-results',name),path.join(reports,'test-results',name));
      verifyRetainedHomepageReports(reports);
      for(const name of LOCAL_HOMEPAGE_REPORTS) {
        const file=path.join(reports,'test-results',name),bytes=fs.readFileSync(file);
        fs.unlinkSync(file);assert.throws(()=>verifyRetainedHomepageReports(reports));
        fs.writeFileSync(file,'{}');assert.throws(()=>verifyRetainedHomepageReports(reports));fs.writeFileSync(file,bytes);
      }
    }finally{fs.rmSync(reports,{recursive:true,force:true});}
    assert.equal(verifyLocalWorkerRepair('.local-release',head).result.total,1408);
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-local-repair-'));
    try {
      fs.cpSync('.local-release/reuse',path.join(tmp,'reuse'),{recursive:true});
      fs.mkdirSync(path.join(tmp,'test-results'));
      fs.copyFileSync('.local-release/test-results/worker-discovery.json',path.join(tmp,'test-results/worker-discovery.json'));
      for(const name of ['checkpoint.json','worker.log','last-run.json','original-discovery.json','progress.json','corrected.json','progress-receipt.json','corrected-receipt.json','tail-checkpoint.json','tail.log']) {
        const file=path.join(tmp,'reuse',name),original=fs.readFileSync(file);
        fs.unlinkSync(file);assert.throws(()=>verifyLocalWorkerRepair(tmp,head));
        fs.writeFileSync(file,Buffer.concat([original,Buffer.from('changed')]));assert.throws(()=>verifyLocalWorkerRepair(tmp,head));fs.writeFileSync(file,original);
      }
      const gitEnv={...process.env,GIT_INDEX_FILE:path.join(tmp,'index')};
      execFileSync('git',['read-tree','HEAD'],{env:gitEnv});
      const blob=execFileSync('git',['hash-object','-w','--stdin'],{input:'changed product',encoding:'utf8'}).trim();
      execFileSync('git',['update-index','--cacheinfo',`100644,${blob},frontend/index.mjs`],{env:gitEnv});
      const tree=execFileSync('git',['write-tree'],{env:gitEnv,encoding:'utf8'}).trim();
      const changed=execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit-tree',tree,'-p',head],{input:'Synthetic protected-tree countercheck\n',encoding:'utf8'}).trim();
      assert.throws(()=>assertLocalRepairTree(changed),/Changed product/);
    } finally {fs.rmSync(tmp,{recursive:true,force:true});}
    console.log('Original 1404 + corrected 3 + corrected 1 Worker cases verified; 20 real artifact tamper/missing controls and changed-product Git countercheck rejected.');
  }
  console.log('Closed local continuation: complete case union, missing/duplicate/failed/retried/substituted controls passed; passed processor/native reports remain required and the new browser job must execute.');
}
if(process.argv.includes('--repair-only')) {await testLocalRepair();process.exit(0);}

const workflow = yaml.parse(fs.readFileSync('.github/workflows/static.yml','utf8'));
assert.deepEqual(Object.keys(workflow.jobs),['release-compatibility','reuse-candidate','deploy','recover-frontend']);
assert.deepEqual(workflow.jobs.deploy.needs,['release-compatibility','reuse-candidate']);
const source = JSON.stringify(workflow);
for(const name of ['test:workers','test:homepage-core','test:auth','test:static','test:q2-runtime','test:quality-gates','playwright test','Validate JS import paths','Validate page metadata','Check target=']) assert(!source.includes(name),`Migrated check still executes on GitHub: ${name}`);
assert(source.includes('node scripts/local-release.mjs import'));
assert(!source.includes('continue-on-error'));
assert.equal(workflow.permissions.deployments,'read');
assert.equal(workflow.jobs.deploy.permissions.deployments,'write');
const fast=yaml.parse(fs.readFileSync('.github/workflows/ui-fast-deploy.yml','utf8'));
assert.deepEqual(Object.keys(fast.on),['workflow_dispatch']);
assert.equal(Object.keys(fast.jobs).length,1);
assert(!JSON.stringify(fast).match(/contents: write/));
assert(fast.jobs.guard.steps.every(step=>!/^\s*(?:npm|npx|node|wrangler)\b/m.test(step.run||'')));
assert(fast.jobs.guard.steps.some(step=>step.run?.includes('exit 1')),'Legacy fast entry point must reject without claiming acceptance');
assert(fs.readFileSync('scripts/release-preflight.mjs','utf8').includes('await preflightLocal(options)'));
const blockedLegacy=spawnSync(process.execPath,['scripts/release-apply.mjs','--execute'],{encoding:'utf8'});
assert.equal(blockedLegacy.status,1);assert.match(blockedLegacy.stderr,/Use npm run release:local/);

const plan = validationPlan();
assert.equal(Object.keys(plan.jobs).length,4);
const expected = { GITHUB_SHA:'a'.repeat(40), CANDIDATE_BASE:'b'.repeat(40) };
for (const files of [['index.html'],['workers/auth/src/index.js'],['js/pages/admin/model-pricing.js'],['js/pages/canvas/full-video.js'],['services/homepage-ffmpeg-processor/canvas-full-video.mjs'],['docs/readme.md']]) {
  const selection = selectCiTests(files), commands = selectedCommands(selection,expected);
  assert(commands.length > 25);
  assert.equal(commands.filter(c=>c.name==='Run quality gate tests').length,1);
  assert(commands.some(c=>c.name==='Check frontend hosting package'));
  assert.equal(commands.some(c=>c.name==='Run worker route tests'),selection.workers&&!selection.mediaLifecycle);
  assert.equal(commands.some(c=>c.name==='Run Linux homepage functional acceptance'),selection.homepage||selection.carousel);
  assert(!commands.some(c=>c.name==='Verify repaired native media smoke'),'Missing output cannot accidentally select a historical native repeat');
  assert(!commands.some(c=>/\b(?:npm|node|npx) (?:run|scripts|playwright|--)[^\n]*\|\| true/.test(c.run)),'Test failures cannot be suppressed');
  assert(commands.every(c=>!c.run.includes('${{')));
}
const inputs=environmentInputs(), key=environmentKey(inputs);
assert.equal(environmentKey({...inputs}),key);
for(const file of Object.keys(inputs)) assert.notEqual(environmentKey({...inputs,[file]:'changed'}),key,file);
assert.notEqual(environmentKey(inputs,'linux/amd64'),key);

const identity={platform:'linux',uid:1001,gid:1001};
const local={...identity,container:true,marker:{policy:'development-mac-v1',boundary:'disposable-container'}};
assertLocalBootstrapAllowed({BITBI_LOCAL_RELEASE_CONTAINER:'1'},local);
for(const patch of [{container:false},{uid:0},{gid:0},{marker:{}},{platform:'darwin'}]) assert.throws(()=>assertLocalBootstrapAllowed({BITBI_LOCAL_RELEASE_CONTAINER:'1'},{...local,...patch}));
for(const env of [{},{BITBI_LOCAL_RELEASE_CONTAINER:'1',GITHUB_ACTIONS:'true'},{BITBI_LOCAL_RELEASE_CONTAINER:'1',RUNNER_ENVIRONMENT:'github-hosted'}]) assert.throws(()=>assertLocalBootstrapAllowed(env,local));
const hosted={GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',RUNNER_OS:'Linux',Q2_RUNTIME_ALLOW_HOSTED_BOOTSTRAP:'1'};
assertHostedBootstrapAllowed(hosted,identity);
assert.throws(()=>assertHostedBootstrapAllowed({...hosted,RUNNER_ENVIRONMENT:'self-hosted'},identity));

const scope={sha:'a'.repeat(40),base:'b'.repeat(40)}, digest='sha256:'+'c'.repeat(64);
const record={repository_url:'https://api.github.com/repos/bitbiai/Bitbi',task:'bitbi-local-validation',environment:'bitbi-local-validation',production_environment:false,creator:{login:'bitbiai'},payload:{localValidation:{policy:'development-mac-v1',...scope,asset:1,release:2,digest,name:`bitbi-local-${scope.sha}-${digest.slice(7,23)}.zip`}}};
validateLocator(record,scope);
for(const patch of [{task:'deploy'},{production_environment:true},{creator:{login:'outsider'}},{payload:{}}]) assert.throws(()=>validateLocator({...record,...patch},scope));
assert.throws(()=>validateLocator(record,{...scope,sha:scope.base}));
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-local-archive-'));
try {
  const bin=path.join(temporary,'bin');fs.mkdirSync(bin);
  const tools=['zip','unzip','python3','git','curl','ffmpeg','ffprobe'];
  for(const tool of tools)fs.writeFileSync(path.join(bin,tool),'#!/bin/sh\nexit 0\n',{mode:0o755});
  const preflight=()=>spawnSync('/bin/bash',['-euc',TOOL_PREFLIGHT],{env:{PATH:bin}}).status;
  assert.equal(preflight(),0);
  for(const tool of tools){fs.renameSync(path.join(bin,tool),path.join(temporary,tool));assert.notEqual(preflight(),0,`Missing ${tool} must stop before suites`);fs.renameSync(path.join(temporary,tool),path.join(bin,tool));}
  const lockDir=path.join(temporary,'lock');const unlock=acquireLocalReleaseLock(lockDir);
  assert.throws(()=>acquireLocalReleaseLock(lockDir),/Another local release is active/);
  unlock();acquireLocalReleaseLock(lockDir)();
  const native=path.join(temporary,'runtime/q2-runtime-evidence/native-control');fs.mkdirSync(path.join(native,'reports'),{recursive:true});
  const launcher={origin:'development-mac-v1',mode:'runtime',status:0,failure:null,childBoundaryVerified:true,postcheckFailures:[]};
  const log=JSON.stringify({q2LinuxEvidence:'/tmp/bitbi-release/q2-runtime-evidence/native-control'});
  fs.writeFileSync(path.join(native,'launcher-result.json'),JSON.stringify(launcher));
  for(const name of ['isolation-result.json','isolation-final.json'])fs.writeFileSync(path.join(native,'reports',name),JSON.stringify({passed:true}));
  const result={failedSuites:0,passed:1,reports:[{failure:null,records:[{status:'PASS'}]}]};
  fs.writeFileSync(path.join(native,'reports/result.json'),JSON.stringify(result));verifyNativeLocalReports(temporary,log);
  assert.throws(()=>verifyNativeLocalReports(temporary,''),/Missing executed/);
  fs.writeFileSync(path.join(native,'reports/result.json'),JSON.stringify({...result,failedSuites:1}));assert.throws(()=>verifyNativeLocalReports(temporary,log));
  fs.unlinkSync(path.join(native,'reports/result.json'));assert.throws(()=>verifyNativeLocalReports(temporary,log));
  for(const entry of ['safe.txt','../escape','/absolute']) {
    const zip=path.join(temporary,'fixture.zip'), dest=fs.mkdtempSync(path.join(temporary,'unpack-'));
    const result=spawnSync('python3',['-I','-c','import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],"w") as z:z.writestr(sys.argv[2],"synthetic")',zip,entry]);assert.equal(result.status,0);
    if(entry==='safe.txt'){extractEvidence(zip,dest);assert.equal(sha256(fs.readFileSync(path.join(dest,entry))),sha256('synthetic'));}
    else assert.throws(()=>extractEvidence(zip,dest));
  }
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
console.log('Local command mapping, no hosted duplicate suites, dependency invalidation, distinct isolation origins and authenticated archive counterchecks passed.');

// Real Git/source/file queries, with explicitly synthetic execution records.
// No provider or production call is possible in this fixture.
const repo=process.cwd(), fixtureRoot=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-local-proof-'));
try {
  for(const file of [...Object.keys(environmentInputs()),'.github/workflows/static.yml','config/release-validation.yml','config/static-hosting.json','frontend/index.mjs','frontend/wrangler.jsonc']) {
    const dest=path.join(fixtureRoot,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(repo,file),dest);
  }
  process.chdir(fixtureRoot);
  const planPath='config/release-validation.yml',originalPlan=fs.readFileSync(planPath,'utf8');
  for(const setup of ['Install Worker media test tools','Install Canvas browser media tools']) {
    fs.writeFileSync(planPath,originalPlan.replace(setup,'Missing prerequisite'));
    assert.throws(()=>selectedCommands(selectCiTests(['workers/auth/src/index.js']),expected),/required preparation/);
  }
  fs.writeFileSync(planPath,originalPlan.replace('run: npm ci','run: npm run test:workers'));
  assert.throws(()=>selectedCommands(selectCiTests(['workers/auth/src/index.js']),expected),/preparation capability/);
  fs.writeFileSync(planPath,originalPlan);
  const git=(...args)=>execFileSync('git',['-c','user.name=Synthetic','-c','user.email=synthetic@example.invalid',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-b','main');git('add','.');git('commit','-qm','Synthetic original source');const base=git('rev-parse','HEAD');
  fs.writeFileSync('fixture.md','Synthetic local evidence contract');git('add','.');git('commit','-qm','Synthetic candidate');const sha=git('rev-parse','HEAD');
  const selection=gitSelection(base,sha), bundle=path.join(fixtureRoot,'bundle');fs.mkdirSync('candidate/site',{recursive:true});
  fs.writeFileSync('candidate/site/index.html','<p>Synthetic candidate</p>');
  const manifest={schema:2,repository:'bitbiai/Bitbi',sha,base,run:'synthetic-local',attempt:'1',full:false,selection,mediaPolicy:MEDIA_POLICY,files:tree('candidate/site')};
  prepareFrontend(manifest,tree);fs.writeFileSync('candidate/manifest.json',JSON.stringify(manifest));
  const nativeLog='Synthetic native HTTP fixture; this is not runtime acceptance';
  const proof={job:'frontend-runtime',status:'passed',manifestHash:sha256(JSON.stringify(manifest)),tests:1,reportHash:sha256(JSON.stringify({tests:1,log:nativeLog}))};
  fs.writeFileSync('candidate/proof-frontend-runtime.json',JSON.stringify(proof));fs.mkdirSync(bundle);fs.cpSync('candidate',path.join(bundle,'candidate'),{recursive:true});
  fs.mkdirSync(path.join(bundle,'logs'));fs.mkdirSync(path.join(bundle,'test-results'));fs.writeFileSync(path.join(bundle,'test-results/frontend-runtime.log'),nativeLog);
  const commandRows=selectedCommands(selection,{GITHUB_SHA:sha,CANDIDATE_BASE:base}).map((command,index)=>{
    const log=`logs/${index}.log`,bytes=`Synthetic successful command ${index}\n`;fs.writeFileSync(path.join(bundle,log),bytes);
    return {command,exitCode:0,durationMs:1,log,logHash:sha256(bytes)};
  });
  const eInputs=environmentInputs(), now=Date.now();
  const accepted={policy:'development-mac-v1',repository:'bitbiai/Bitbi',id:manifest.run,sha,base,sourceTree:git('rev-parse','HEAD^{tree}'),planHash:validationPlan().digest,
    selection,status:'passed',ci:true,origin:'development-mac',startedAt:new Date(now-1000).toISOString(),completedAt:new Date(now-1).toISOString(),
    environment:{inputs:eInputs,key:environmentKey(eInputs),platform:'linux/arm64',image:'sha256:'+'d'.repeat(64),node:'v22.23.1',playwright:'1.58.2'},commands:commandRows,candidateFiles:tree(path.join(bundle,'candidate'))};
  const write=value=>fs.writeFileSync(path.join(bundle,'evidence.json'),JSON.stringify(value));write(accepted);
  const verified=verifyLocalEvidence(bundle,{sha,base});
  const rebound=rebindLocalCandidate(verified,{run:123,attempt:1,receipt:9});
  verifyManifest(rebound.manifest,{sha,base,run:'123',attempt:'1',selection},path.join(bundle,'candidate/site'));verifyProofs(rebound.manifest,rebound.proofs);
  for(const change of [e=>e.status='failed',e=>e.sha='0'.repeat(40),e=>e.sourceTree='0'.repeat(40),e=>e.planHash='0'.repeat(64),e=>e.commands.pop(),e=>e.commands[0].exitCode=1,
    e=>e.commands[0].command.run='echo pretend',e=>e.ci=false,e=>e.environment.inputs['package-lock.json']='changed',e=>e.startedAt='2000-01-01T00:00:00Z',e=>e.selection.workers=true,e=>e.candidateFiles['site/index.html']='changed']) {
    const wrong=structuredClone(accepted);change(wrong);write(wrong);assert.throws(()=>verifyLocalEvidence(bundle,{sha,base}));
  }
  write(accepted);fs.renameSync(path.join(bundle,'test-results/frontend-runtime.log'),path.join(bundle,'saved.log'));assert.throws(()=>verifyLocalEvidence(bundle,{sha,base}));
  fs.renameSync(path.join(bundle,'saved.log'),path.join(bundle,'test-results/frontend-runtime.log'));
  fs.writeFileSync(path.join(bundle,'test-results/frontend-runtime.log'),'Changed report');assert.throws(()=>verifyLocalEvidence(bundle,{sha,base}));
  fs.writeFileSync(path.join(bundle,'test-results/frontend-runtime.log'),nativeLog);
  const run={id:123,run_attempt:1,repository:{full_name:'bitbiai/Bitbi'},head_repository:{full_name:'bitbiai/Bitbi'},head_sha:sha,head_branch:'main',path:'.github/workflows/static.yml',event:'push',status:'completed',conclusion:'success',created_at:new Date(now).toISOString()};
  const jobs=[{name:'release-compatibility',head_sha:sha,status:'completed',conclusion:'success',steps:['Preflight complete static release plan','Select tests from changed files','Verify local release evidence and candidate bytes','Upload immutable candidate build'].map(name=>({name,status:'completed',conclusion:'success'}))}];
  const artifacts=[{id:1,name:`pages-candidate-${sha}-123-1`,expired:false,size_in_bytes:1,digest:'sha256:'+'e'.repeat(64),workflow_run:{id:123,head_sha:sha}}];
  const expectedSource={repository:'bitbiai/Bitbi',sha,base,run:'123',attempt:'1',selection};
  assert.equal(validateSource({run,jobs,artifacts,mainSha:sha,laterRuns:[]},expectedSource).length,1);
  for(const conclusion of ['failure','skipped',undefined]) {
    const broken=structuredClone(jobs);broken[0].steps[2].conclusion=conclusion;
    assert.throws(()=>validateSource({run,jobs:broken,artifacts,mainSha:sha,laterRuns:[]},expectedSource));
  }
  console.log('Synthetic evidence: matching exact Git/candidate/commands accepted; 14 missing, stale, failed, changed and skipped controls rejected through the actual verifier.');
} finally { process.chdir(repo);fs.rmSync(fixtureRoot,{recursive:true,force:true}); }

if(process.env.BITBI_LOCAL_RELEASE_CONTAINER==='1') {
  // Real launch smoke for the new local image, not a replacement for selected
  // product suites. No provider/public site request or persisted browser state.
  const engines=await import('playwright');
  for(const engine of ['chromium','firefox','webkit']) {
    const browser=await engines[engine].launch();
    try {
      const page=await browser.newPage();await page.route('**/*',route=>route.abort());
      await page.setContent('<button aria-label="Local readiness">Ready</button>');
      await page.keyboard.press('Tab');
      assert.equal(await page.locator('button').evaluate(el=>el===document.activeElement),true);
      console.log(`Pinned ${engine} launch and keyboard smoke passed (${browser.version()}); synthetic local content only.`);
    }finally{await browser.close();}
  }
}

await testLocalRepair();
testImportRepair();
testPermissionContinuation();
testSmoothContinuation();
