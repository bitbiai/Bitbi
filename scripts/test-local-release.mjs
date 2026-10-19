import {SMOOTH_BROWSER_POLICY,SMOOTH_BROWSER_CONTINUATION, WORKSPACE_CONTINUATION,AUDIO_FIT_CONTINUATION, INSPECTOR_CONTINUATION,EXPORT_BROWSER_CONTINUATION,smoothProfile,smoothRetained,isSmoothContinuation,assertSmoothContinuationTree,verifySmoothBrowserReport,verifySmoothImageReuse,verifyImportedSmoothImage,restoreSmoothBrowserProof,passedBrowserCase} from './lib/local-release-browser.mjs';
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
import {testLocalMediaProcess} from './test-local-media-process.mjs';

const assistantPreflightTail=process.argv.includes('--assistant-preflight-only');
if(assistantPreflightTail)assert.deepEqual(process.argv.slice(2),['--assistant-preflight-only']);

if(process.argv.includes('--assistant-native-progress-only')) {
  assert.deepEqual(process.argv.slice(2),['--assistant-native-progress-only']);
  await testAssistantNativeProgress();process.exit(0);
}

if(process.argv.includes('--assistant-native-only')) {
  assert.deepEqual(process.argv.slice(2),['--assistant-native-only']);
  await testAssistantNativeContinuation();process.exit(0);
}

if(process.argv.includes('--assistant-worker-only')) {
  assert.deepEqual(process.argv.slice(2),['--assistant-worker-only']);
  await testAssistantWorkerContinuation();process.exit(0);
}

if(process.argv.includes('--stored-plan-worker-only')) {
  assert.deepEqual(process.argv.slice(2),['--stored-plan-worker-only']);
  await testStoredPlanWorkerContinuation();process.exit(0);
}

if(process.argv.includes('--stored-plan-only')) {
  assert.deepEqual(process.argv.slice(2),['--stored-plan-only']);
  await testStoredPlanContinuation();process.exit(0);
}

if(process.argv.includes('--settlement-browser-only')) {
  assert.deepEqual(process.argv.slice(2),['--settlement-browser-only']);
  await testSettlementBrowserContinuation();process.exit(0);
}

if(process.argv.includes('--settlement-native-progress-only')) {
  assert.deepEqual(process.argv.slice(2),['--settlement-native-progress-only']);
  await testSettlementNativeProgress();process.exit(0);
}

if(process.argv.includes('--settlement-native-only')) {
  assert.deepEqual(process.argv.slice(2),['--settlement-native-only']);
  await testSettlementNativeContinuation();process.exit(0);
}

if(process.argv.includes('--settlement-hosting-only')) {
  assert.deepEqual(process.argv.slice(2),['--settlement-hosting-only']);
  await testSettlementHostingContinuation();process.exit(0);
}

if(process.argv.includes('--settlement-preflight-only')) {
  assert.deepEqual(process.argv.slice(2),['--settlement-preflight-only']);
  await testCanvasPolicyNativeContinuation();await testCanvasPolicyNativeProgress();await testSettlementPreflightContinuation();process.exit(0);
}

if(process.argv.includes('--canvas-policy-native-progress-only')) {
  assert.deepEqual(process.argv.slice(2),['--canvas-policy-native-progress-only']);
  await testCanvasPolicyNativeProgress();process.exit(0);
}

if(process.argv.includes('--canvas-policy-worker-only')) {
  assert(process.argv.length===3||process.argv.length===4);
  await testCanvasPolicyWorkerContinuation(process.argv[3]||null);process.exit(0);
}

if(process.argv.includes('--autonomy-worker-selection-only')) {
  assert.deepEqual(process.argv.slice(2),['--autonomy-worker-selection-only']);
  await testAutonomyWorkerSelection();process.exit(0);
}

if(process.argv.includes('--autonomy-doc-progress-only')) {
  assert.deepEqual(process.argv.slice(2),['--autonomy-doc-progress-only']);
  await testAutonomyDocProgress();process.exit(0);
}

function testPermissionContinuation() {
  // The reviewed historical successor is immutable; today's hosting tests may
  // legitimately evolve without changing this closed continuation's proof.
  const head='f'.repeat(40),corrected=execFileSync('git',['show',`${PERMISSION_CONTINUATION.tail}:scripts/test-frontend-review.mjs`]);
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
    assertPermissionContinuationTree(actualHead,undefined,{smooth:isSmoothContinuation(original.sha),source:original.sha});const acceptedSource=permissionContinuationPrefix(bytes,context).sha;assert([PERMISSION_CONTINUATION.source,PERMISSION_CONTINUATION.tail].includes(acceptedSource)||isSmoothContinuation(acceptedSource));
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


function testSmoothContinuation(p=SMOOTH_BROWSER_CONTINUATION) {
  const head='f'.repeat(40),workspace=p===WORKSPACE_CONTINUATION,audioFit=p===AUDIO_FIT_CONTINUATION,inspector=p===INSPECTOR_CONTINUATION,exportRepair=p===EXPORT_BROWSER_CONTINUATION;
  const staging=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-proof-inputs-'));
  try {
    const source=path.join(staging,'source'),target=path.join(staging,'target');fs.mkdirSync(path.join(source,'test-results/canvas-artifacts'),{recursive:true});fs.mkdirSync(path.join(source,'docs'));
    for(const file of ['test-results/canvas-artifacts/error-context.md','test-results/canvas-artifacts/result.json','docs/UNKNOWN.md'])fs.writeFileSync(path.join(source,file),'retained');
    fs.mkdirSync(path.join(source,'reuse/test-results'),{recursive:true});fs.writeFileSync(path.join(source,'reuse/test-results/permission-checkpoint.json'),JSON.stringify({candidateFiles:{'site/js/api-token.js':'a'.repeat(64)}},null,2));
    copyEvidenceToolInputs(source,target);assert(fs.existsSync(path.join(source,'test-results/canvas-artifacts/error-context.md')));
    assert(!fs.existsSync(path.join(target,'test-results/canvas-artifacts/error-context.md')));assert(fs.existsSync(path.join(target,'test-results/canvas-artifacts/result.json')));assert(fs.existsSync(path.join(target,'docs/UNKNOWN.md')));assert.equal(scanRepoForSecrets(target).length,0);
    fs.writeFileSync(path.join(target,'product.js'),'const token = '+JSON.stringify('Z'.repeat(40))+';');assert(scanRepoForSecrets(target).length>0,'Product secrets must still block after staging proof metadata');
  }finally{fs.rmSync(staging,{recursive:true,force:true});}
  const reviewedFixture=file=>{
    if(exportRepair)return execFileSync('git',['show','5f0384373bd7e1505beaa5f243e2f085e2958c95:'+file]);
    if(workspace)return execFileSync('git',['show',`${p.reviewedSource}:${file}`]);
    if(inspector) {
      if(file==='tests/canvas.spec.js')return Buffer.from(execFileSync('git',['show',`${p.source}:${file}`],{encoding:'utf8'}).replace('  // The music toggle belongs to Sound & Music; the independent join toggle is OFF.\n',"  // The music toggle belongs to Sound & Music; the independent join toggle is OFF.\n  await openCanvasSettings(page,'merge');\n"));
      // Only the failed merge transport and narrow-layout keyboard action move.
      // All generation cases and desktop icon checks retain their original input.
      return Buffer.from(execFileSync('git',['show',`${p.source}:${file}`],{encoding:'utf8'})
        .replace("  const completed={id:id(12),status:'ready',storage:'canvas',asset:{id:id(13),file_url:video},preview_base:{file_url:video},", "  const media='/api/plain/canvas-preview/video.mp4'; // The candidate server's real ranged media fixture; tests/ is not published.\n  const completed={id:id(12),status:'ready',storage:'canvas',asset:{id:id(13),file_url:media},preview_base:{file_url:media},")
        .replace('  await result.evaluate(v=>v.play());','  await result.scrollIntoViewIfNeeded();await expect(result).toBeInViewport();\n  await result.evaluate(v=>v.play());')
        .replace("toHaveAttribute('href',video+'?download=1')","toHaveAttribute('href',media+'?download=1')")
        .replace("  await select(2);const card=","  await select(2);if(locale==='de')await page.locator('#canvasGraphToggle').click();const card=")
        .replace('    await page.locator(`#canvasAssetsGrid [data-asset-id="${picker.assets[index].id}"]`).click();', '    if(locale===\'de\')await page.getByRole(\'tablist\',{name:\'Saved image cards\',exact:true}).getByRole(\'tab\',{name:`Show image ${index+1}`,exact:true}).click();\n    await page.locator(`#canvasAssetsGrid [data-asset-id="${picker.assets[index].id}"]`).click();'));
    }
    if(!audioFit)return execFileSync('git',['show',`${p.accepted}:${file}`]);
    const before=execFileSync('git',['show',`${p.source}:${file}`],{encoding:'utf8'});
    const old="name:de?'Gesamtes Video erstellen':'Create full video'";
    assert.equal(before.split(old).length,2,'Reviewed repair changes exactly one button query');
    // DE explicitly enabled music before clicking. Keep the exact role/name
    // contract; require the existing music-specific button, not a broad match.
    return Buffer.from(before.replace(old,"name:de?(fitAudio?'Gesamtes Video mit Hintergrundmusik erstellen':'Gesamtes Video erstellen'):'Create full video'"));
  };
  const read=(changed=Object.keys(p.specs),broken=false)=>args=>args[0]==='show'?broken?Buffer.from('invalid expectation'):reviewedFixture(args[1].split(':')[1]):Buffer.from(args[0]==='diff'?changed.join('\n'):'');
  const verifyTree=reader=>assertSmoothContinuationTree(head,reader,{source:p.source});
  verifyTree(read());
  // Closed historical evidence uses its pinned Git fixture, never today's
  // independently changed Canvas tests. A changed fixture still rejects.
  for(const file of Object.keys(p.specs)) {
    const current=fs.readFileSync(file);
    if(sha256(current)!==p.specs[file])assert.throws(()=>verifyTree(args=>args[0]==='show'&&args[1].endsWith(':'+file)?current:read()(args)),/Unreviewed/);
    const original=execFileSync('git',['show',`${p.source}:${file}`]);
    assert.throws(()=>verifyTree(args=>args[0]==='show'&&args[1].endsWith(':'+file)?original:read()(args)),/Unreviewed/);
  }
  for(const file of ['js/pages/canvas/full-video.js','services/homepage-ffmpeg-processor/canvas-seams.mjs','workers/auth/src/routes/canvas.js','package-lock.json','.github/workflows/static.yml'])
    assert.throws(()=>verifyTree(read([...Object.keys(p.specs),file])),/cannot inherit/);
  assert.throws(()=>verifyTree(read(undefined,true)),/Unreviewed/);
  const dir='.local-release',file=path.join(dir,'reuse/smooth-browser.json'),checkpoint=path.join(dir,'reuse/test-results/permission-checkpoint.json');
  if(workspace){
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-workspace-byte-proof-')),file='js/pages/canvas/workspace-view.js';
    try {
      const old=execFileSync('git',['show',`${p.source}:${file}`],{encoding:'utf8'}).replaceAll('__ASSET_VERSION__',p.source.slice(0,12)),fresh=reviewedFixture(file).toString().replaceAll('__ASSET_VERSION__',head.slice(0,12));
      fs.mkdirSync(path.dirname(path.join(dir,'candidate/site',file)),{recursive:true});fs.writeFileSync(path.join(dir,'candidate/site',file),fresh);
      const original={sha:p.source,files:{[file]:sha256(old)}},next={sha:head,files:{[file]:sha256(fresh)}};
      verifyMigrationCandidateBytes(dir,original,next,{workspaceRepair:true});
      assert.throws(()=>verifyMigrationCandidateBytes(dir,original,next));
      fs.appendFileSync(path.join(dir,'candidate/site',file),'\n// unreviewed');next.files[file]=sha256(fs.readFileSync(path.join(dir,'candidate/site',file)));
      assert.throws(()=>verifyMigrationCandidateBytes(dir,original,next,{workspaceRepair:true}),/Changed workspace repair/);
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  }
  if(fs.existsSync(file)&&fs.existsSync(checkpoint)&&smoothProfile(JSON.parse(fs.readFileSync(checkpoint)).sha)===p) {
    const bytes=fs.readFileSync(file);assert.equal(sha256(bytes),p.report);const previous=browserRows(JSON.parse(bytes));
    const discovery=browserRows(JSON.parse(fs.readFileSync(path.join(dir,'test-results/canvas-discovery.json'))),{discovery:true});
    const progress=p.browserProgress?{sha:p.browserProgress.sha,rows:browserRows(JSON.parse(fs.readFileSync(path.join(dir,'reuse/smooth-progress.json'))))}:undefined;
    const accepted=p.browserAccepted?{sha:p.browserAccepted.sha,rows:browserRows(JSON.parse(fs.readFileSync(path.join(dir,'reuse/smooth-accepted-cases.json'))))}:undefined;
    const retained=smoothRetained(previous,progress,p,accepted);
    const fresh=previous.filter(row=>!retained.has(row.key)).map(row=>({...row,expectedStatus:'passed',status:'expected',results:[{status:'passed',retry:0,error:false}]}));
    const counts=workspace||inspector||exportRepair?p.counts:audioFit?{required:4,reused:2,executed:2}:{required:228,reused:208,executed:20};
    const report={policy:SMOOTH_BROWSER_POLICY,sha:head,source:p.source,previous,...(progress?{progress}:{}),...(accepted?{accepted}:{}),discovery,fresh,counts};
    assert.deepEqual(verifySmoothBrowserReport(report,head),report.counts);
    const manifest={sha:head,selection:{auth:true,canvasText:true,...(exportRepair?{canvasTransitions:true,canvasExportRepair:true}:workspace?{canvasTransitions:true}:inspector?{canvasInspector:true}:audioFit?{canvasAudioFit:true}:{canvasAudio:true})}};
    const proof=()=>candidateProof(manifest,{job:'browser-validation',readJson:name=>name.endsWith('canvas-discovery.json')?JSON.parse(fs.readFileSync(path.join(dir,'test-results/canvas-discovery.json'))):report});
    assert.equal(proof().tests,counts.required);
    for(const mutate of [...(fresh.length?[r=>r.fresh.pop(),r=>r.fresh.push(r.fresh[0]),r=>r.fresh[0].results[0].status='failed',r=>r.fresh[0].results[0].retry=1]:[r=>r.fresh.push(r.previous.find(passedBrowserCase))]),r=>r.previous.find(passedBrowserCase).status='unexpected',r=>r.discovery.pop(),...(inspector||workspace?[r=>delete r.progress,r=>r.progress.rows.pop(),r=>r.progress.rows.find(passedBrowserCase).results[0].status='failed',r=>delete r.accepted,r=>r.accepted.rows[0].results[0].retry=1]:[])]) {
      const original=structuredClone(report);mutate(report);assert.throws(proof);Object.assign(report,original);
    }
    if(!workspace&&!inspector&&!audioFit&&fs.existsSync(path.join(dir,'reuse/smooth-accepted.json'))) {
      const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-browser-proof-'));
      try {fs.mkdirSync(path.join(tmp,'reuse'));fs.mkdirSync(path.join(tmp,'test-results'));fs.copyFileSync(path.join(dir,'reuse/smooth-accepted.json'),path.join(tmp,'reuse/smooth-accepted.json'));
        const rebound=restoreSmoothBrowserProof(tmp,{sha:head});restoreSmoothBrowserProof(tmp,{sha:head,verifyOnly:true});assert.equal(verifySmoothBrowserReport(rebound,head).required,228);
        rebound.reusedFrom.sha=head;assert.throws(()=>verifySmoothBrowserReport(rebound,head));
      }finally{fs.rmSync(tmp,{recursive:true,force:true});}
    }
    if(inspector){console.log('Inspector continuation counterchecks: 20 retained / 0 repeated; missing, failed, skipped, retried and altered source evidence rejected.');return;}
    const image=JSON.parse(fs.readFileSync(path.join(dir,'test-results/private-media-image/image.json')));assert.equal(verifySmoothImageReuse(image,head,{read:read()}),p.source);
    const imported={...image,run:'123',attempt:'1',localValidation:{policy:'development-mac-v1',publicationSha:head,run:image.run,attempt:image.attempt,evidence:'a'.repeat(64),recordHash:sha256(JSON.stringify(image))}};
    const verify=record=>verifyImportedSmoothImage(record,{sha:head,run:'123',attempt:'1'},{read:read()});assert.equal(verify(imported),p.source);
    for(const mutate of [r=>r.sha=head,r=>r.image='sha256:'+'b'.repeat(64),r=>r.sourceFiles={},r=>r.localValidation.publicationSha='c'.repeat(40),r=>r.run='999',r=>r.tests.pop(),r=>r.localValidation.run='other']) {
      const bad=structuredClone(imported);mutate(bad);assert.throws(()=>verify(bad));
    }
    console.log(`Synthetic counterchecks only: ${counts.reused} retained/${counts.executed} required union; missing, failed, retry-only, forged source and changed image rejected through actual candidate/import verifiers.`);
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
    assert.throws(()=>assertLocalRepairTree(commitFile(file,text.replace('cancel-in-progress: false','cancel-in-progress: true'))),/Only the actual/);
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
  const diagnostic={ts:'2026-10-18T11:25:24.771Z',service:'bitbi-auth',component:'ai-save-audio',event:'ai_audio_save_fetch_failed',level:'warn'};
  const interleaved=log.replace('(1ms)','(1ms)'+JSON.stringify(diagnostic));
  assert.deepEqual(workerListResults(interleaved,fixture.discovery),workerListResults(log,fixture.discovery),'A complete Auth JSON suffix does not hide an independently identified reporter result');
  for(const suffix of ['untrusted trailing text','{',JSON.stringify(diagnostic).slice(0,-1),'null','[]',JSON.stringify({...diagnostic,service:'foreign'}),JSON.stringify({...diagnostic,ts:'unknown'}),JSON.stringify({...diagnostic,event:null}),JSON.stringify({...diagnostic,level:'passed'}),JSON.stringify(diagnostic)+JSON.stringify(diagnostic)])
    assert.throws(()=>workerListResults(log.replace('(1ms)','(1ms)'+suffix),fixture.discovery));
  assert.throws(()=>workerListResults(interleaved.replace(' › kept',' › foreign'),fixture.discovery));
  assert.throws(()=>workerListResults(interleaved+'\n'+interleaved.split('\n')[0],fixture.discovery),'Duplicate result attempts must not create a pass');
  assert.throws(()=>workerListResults(interleaved.replace(' (1ms)',' (1m'),fixture.discovery),'A truncated reporter record remains missing');
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

if(!assistantPreflightTail) {
// BEGIN PINNED LOCAL WORKFLOW GUARD
const workflow = yaml.parse(fs.readFileSync('.github/workflows/static.yml','utf8'));
const historicalWorkflow = yaml.parse(execFileSync('git',['show','770c595a9885e411462d89097847a08da972b184:.github/workflows/static.yml'],{encoding:'utf8'}));
const recoveryNames = ['Verify Canvas deployment-only source','Check new Canvas deployment-only guards',
  'Prepare Canvas backend recovery checks','Check Canvas backend recovery guards',
  'Check corrected Canvas processor capability','Preserve Canvas recovery check evidence'];
const historicalStart = historicalWorkflow.jobs['reuse-candidate'].steps.findIndex(step=>step.name===recoveryNames[0]);
const historicalRecovery = historicalWorkflow.jobs['reuse-candidate'].steps.slice(historicalStart,historicalStart+recoveryNames.length);
assert.deepEqual(historicalRecovery.map(step=>step.name),recoveryNames);
function verifyNoRepeatedGithubSuites(value) {
  assert.deepEqual(Object.keys(value.jobs),['release-compatibility','reuse-candidate','deploy','recover-frontend']);
  assert.deepEqual(value.jobs.deploy.needs,['release-compatibility','reuse-candidate']);
  const reuse=value.jobs['reuse-candidate'],start=reuse.steps.findIndex(step=>step.name===recoveryNames[0]);
  assert.equal(reuse.if,historicalWorkflow.jobs['reuse-candidate'].if);
  assert.equal(start,historicalStart,'Historical checks cannot move ahead of their source gate');
  assert.deepEqual(reuse.steps.slice(start,start+recoveryNames.length),historicalRecovery,
    'Only the exact historical commands, conditions, source gate and evidence steps are exempt');
  const normal=structuredClone(value);
  // These two old checks are guarded by an exact-source recovery resolver.
  // Every other occurrence, including a duplicate or moved command, is banned.
  for(const offset of [3,4])normal.jobs['reuse-candidate'].steps[start+offset].run='';
  const source=JSON.stringify(normal);
  for(const name of ['test:workers','test:homepage-core','test:auth','test:static','test:q2-runtime','test:quality-gates','playwright test','Validate JS import paths','Validate page metadata','Check target='])
    assert(!source.includes(name),`Migrated check still executes on GitHub: ${name}`);
  assert(source.includes('node scripts/local-release.mjs import'));
  assert(!source.includes('continue-on-error'));
}
verifyNoRepeatedGithubSuites(workflow);
for(const mutate of [
  value=>delete value.jobs['reuse-candidate'].steps[historicalStart+3].if,
  value=>value.jobs.deploy.steps.push(value.jobs['reuse-candidate'].steps.splice(historicalStart+3,1)[0]),
  value=>value.jobs['reuse-candidate'].steps[historicalStart+4].run+=' --grep changed',
  value=>value.jobs.deploy.steps.push({run:historicalRecovery[4].run}),
  value=>value.jobs['reuse-candidate'].steps[historicalStart].run='echo active=true',
]) {
  const broken=structuredClone(workflow);mutate(broken);
  assert.throws(()=>verifyNoRepeatedGithubSuites(broken),'A broadened historical exception must fail');
}
{
  const {CANVAS_AGENT_DEPLOY_SOURCE:accepted,CANVAS_AGENT_RECOVERY_SOURCE:activated,resolveCanvasAgentDeploySource}=await import('./lib/canvas-agent-deploy-continuation.mjs');
  const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'bitbiai/Bitbi',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',
    GITHUB_SHA:head,CANDIDATE_BASE:accepted.base,CANDIDATE_RUN:accepted.run,CANDIDATE_ATTEMPT:accepted.attempt};
  assert.equal(resolveCanvasAgentDeploySource({...env,GITHUB_SHA:activated.sha}),accepted,'The pinned historical source calibrates the closed resolver');
  assert.equal(resolveCanvasAgentDeploySource({...env,CANDIDATE_RUN:'ordinary-current-candidate'}),null);
  assert.throws(()=>resolveCanvasAgentDeploySource(env),/Continuation is not the direct source successor/,
    'Current product bytes cannot borrow the old candidate identity to rerun historical checks');
}
// END PINNED LOCAL WORKFLOW GUARD
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

await testLocalMediaProcess();
await testLocalRepair();
testImportRepair();
}
testPermissionContinuation();
testSmoothContinuation();
testSmoothContinuation(AUDIO_FIT_CONTINUATION);
testSmoothContinuation(INSPECTOR_CONTINUATION);
testSmoothContinuation(WORKSPACE_CONTINUATION);
testSmoothContinuation(EXPORT_BROWSER_CONTINUATION);

{
 const {CANVAS_PREFLIGHT,assertCanvasPreflightTree,canvasPreflightPrefix,canvasWorkspaceStageContinuation,verifyWorkspaceGuardUnion}=await import('./lib/local-release-evidence.mjs');
 const mock=(files=['tests/helpers/q2-runtime/linux-hosted.mjs'],bad=false)=>args=>args[0]==='merge-base'?Buffer.from(''):args[0]==='diff'?Buffer.from(files.join('\n')):bad?Buffer.from('altered'):execFileSync('git',['show',WORKSPACE_CONTINUATION.source+':'+args[1].split(':').slice(1).join(':')]);
 assertCanvasPreflightTree('f'.repeat(40),mock());
 for(const file of ['workers/auth/src/routes/canvas.js','config/release-compat.json','services/homepage-ffmpeg-processor/canvas-full-video.mjs','tests/canvas.spec.js'])assert.throws(()=>assertCanvasPreflightTree('f'.repeat(40),mock([file])),/changed product/);
 assert.throws(()=>assertCanvasPreflightTree('f'.repeat(40),mock(undefined,true)),/Only the reviewed/);
 assert.throws(()=>canvasPreflightPrefix(Buffer.from('{}'),{sha:'f'.repeat(40)},mock()),/Changed failed preflight/);
 const name='default native runtime plan stages every actual suite and control input',before=Array.from({length:30},(_,i)=>({title:i===14?name:`unchanged ${i}`,status:i===14?'failed':'passed'})),after=[{title:name,status:'passed'}];
 verifyWorkspaceGuardUnion(before,after);
 for(const changed of [[],[{title:name,status:'failed'}],[...after,...after],[{title:'other',status:'passed'}]])assert.throws(()=>verifyWorkspaceGuardUnion(before,changed));
 assert.throws(()=>canvasWorkspaceStageContinuation('echo incomplete'));
 console.log('Workspace continuation: 29 unchanged guard cases retained; missing, failed, duplicate, foreign, altered-source and forged-checkpoint controls reject.');
}

// Historical continuation fixtures use their immutable accepted revision, never
// evolving working-tree files; the real verifier still pins the original hashes.
const historicalExportFile=file=>execFileSync('git',['show','5f0384373bd7e1505beaa5f243e2f085e2958c95:'+file]);

function testModelWorkerEvidence(directory,head,command,{verifyModelWorkerRepair,modelWorkerContinuation}) {
 const verify=()=>verifyModelWorkerRepair(directory,head);
 const pending=verifyModelWorkerRepair(directory,head,{allowPending:true});
 assert(!pending.result,'Source evidence alone must not claim completed Worker acceptance');
 const previous=pending.previous,passed=row=>row.results.length===1&&row.results[0].status==='passed'&&row.results[0].retry===0&&!row.results[0].error;
 assert.equal(previous.length,1454);assert.equal(previous.filter(passed).length,1452);
 const failures=previous.filter(row=>!passed(row));
 assert.deepEqual(failures.map(row=>[row.file,row.title]).sort(),[
  ['q2-canvas-agent-model-operation.spec.js','Canvas durable model operation callback-guards'],
  ['q2-canvas-agent-provider.spec.js','Canvas late background results normalize after disablement, with exact usage and no new provider call'],
 ]);
 assert(failures.every(row=>row.results.length===2&&row.results.every(result=>result.status==='failed')),'Both original attempts remain failed');
 assert.throws(verify,'A source-only checkpoint cannot replace the two fresh results');
 const reports=path.join(directory,'test-results');fs.mkdirSync(reports,{recursive:true});
 // These isolated verifier inputs are explicitly synthetic. Their identities
 // come from the complete real failed execution; no product test is run here.
 const spec=row=>({id:row.id,file:row.file,title:row.title,line:1,column:1,tests:[{projectName:''}]});
 const discovery={config:{workers:1},suites:[{title:'Synthetic full discovery for verifier controls',specs:previous.map(spec)}],errors:[]};
 const fresh={config:{workers:1},suites:[{title:'Synthetic fresh results for verifier controls',specs:failures.map(row=>({...spec(row),tests:[{projectName:'',expectedStatus:'passed',status:'expected',results:[{status:'passed',retry:0}]}]}))}],errors:[],stats:{expected:2,unexpected:0,flaky:0,skipped:0}};
 const discoveryFile=path.join(reports,'model-worker-discovery.json'),freshFile=path.join(reports,'model-worker-fresh.json');
 const save=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2));
 save(discoveryFile,discovery);assert(!verifyModelWorkerRepair(directory,head,{allowPending:true}).result);
 assert.throws(verify,'Complete discovery alone cannot replace executed results');
 save(freshFile,fresh);
 const accepted=verify();assert.deepEqual(accepted.result,{originalPassed:1452,progressPassed:2,correctedPassed:0,total:1454});
 const progress=failures.map(row=>({...row,results:[{status:'passed',retry:0}]}));
 const union={previous,discovery:previous.map(({results,...identity})=>identity),progress,corrected:[]};
 assert.deepEqual(verifyWorkerUnion(union),accepted.result);
 for(const change of [r=>r.previous.pop(),r=>r.discovery.pop(),r=>r.discovery.push(r.discovery[0]),r=>r.discovery[0].title='Foreign case',
  r=>r.progress.pop(),r=>r.progress.push(r.progress[0]),r=>r.progress.push(previous.find(passed)),r=>r.progress[0].results[0].status='failed',
  r=>r.progress[0].results[0].retry=1,r=>r.progress[0].results[0].error=true,r=>r.progress[0].id='foreign-case',r=>r.corrected.push(r.progress[0])]){
  const changed=structuredClone(union);change(changed);assert.throws(()=>verifyWorkerUnion(changed));
 }
 for(const file of ['reuse/preflight-checkpoint.json','reuse/preflight-failed.log','reuse/original-worker-discovery.json','reuse/original-worker-last-run.json','test-results/model-worker-discovery.json','test-results/model-worker-fresh.json']){
  const target=path.join(directory,file),bytes=fs.readFileSync(target);
  fs.unlinkSync(target);assert.throws(verify);fs.writeFileSync(target,'{}');assert.throws(verify);fs.writeFileSync(target,bytes);
 }
 for(const change of [r=>{r.suites[0].specs.pop();r.stats.expected=1;},r=>{r.suites[0].specs.push(r.suites[0].specs[0]);r.stats.expected=3;},
  r=>r.suites[0].specs[0].id='foreign-case',r=>r.suites[0].specs[0].title='Foreign title',r=>r.suites[0].specs[0].file='workers.spec.js',
  r=>r.suites[0].specs[0].tests[0].results[0].retry=1,r=>r.suites[0].specs[0].tests[0].results[0].error={message:'Synthetic failure'},
  r=>{const test=r.suites[0].specs[0].tests[0];test.status='unexpected';test.results[0].status='failed';r.stats.expected=1;r.stats.unexpected=1;},
  r=>{const test=r.suites[0].specs[0].tests[0];test.status='skipped';test.results[0].status='skipped';r.stats.expected=1;r.stats.skipped=1;},
  r=>{const test=r.suites[0].specs[0].tests[0];test.status='flaky';test.results=[{status:'failed',retry:0},{status:'passed',retry:1}];r.stats.expected=1;r.stats.flaky=1;},
  r=>r.config.workers=2,r=>delete r.config.workers,r=>r.errors.push({message:'Synthetic report error'})]){
  const changed=structuredClone(fresh);change(changed);save(freshFile,changed);assert.throws(verify);
 }
 save(freshFile,fresh);
 for(const change of [r=>r.suites[0].specs.pop(),r=>r.suites[0].specs.push(r.suites[0].specs[0]),r=>r.suites[0].specs[0].title='Foreign discovery',r=>r.suites[0].specs[0].file='foreign.spec.js']){
  const changed=structuredClone(discovery);change(changed);save(discoveryFile,changed);assert.throws(verify);
 }
 save(discoveryFile,discovery);assert.deepEqual(verify().result,accepted.result);
 const continued=modelWorkerContinuation(command.run);
 assert(continued.includes('--retries=0')&&continued.includes('model-worker-fresh.json'));
 assert(continued.includes('npm run test:homepage-ffmpeg-processor')&&continued.includes('npm run test:q2-runtime'),'The unexecuted media/native tail remains mandatory');
 assert(!continued.includes('npm run test:workers'),'The complete Worker suite must not execute again');
 assert.throws(()=>modelWorkerContinuation('echo no Worker command'));
 assert.throws(()=>modelWorkerContinuation(command.run+'\nnpm run test:workers'));
 const syntax=spawnSync('/bin/bash',['-n'],{input:continued,encoding:'utf8'});assert.equal(syntax.status,0,syntax.stderr);
 console.log('Worker continuation: real 1452/2 source union, incomplete acceptance, altered reports, omitted/duplicate/foreign/failed/skipped/retried cases and changed command controls reject.');
}

for(const source of ['9443369e0780144d2ffeea3900d3b86ccd57bc85','b71dd6212ee83e9fad0d60a8cf9c03dbaa0087d5','a56a8baf0a74dfc826e5b8ae884b4022ebf2633d','51fb4088d317baea440d037d9301c7f48e07e41e']){
 const {MODEL_WORKER_PREFLIGHT,verifyModelWorkerRepair,modelWorkerContinuation,MODEL_WORKFLOW_PREFLIGHT,MODEL_SELECTION_PREFLIGHT,canvasPreflightProfile,assertCanvasPreflightTree,canvasPreflightPrefix,verifyCanvasPreflight}=await import('./lib/local-release-evidence.mjs');
 const p=canvasPreflightProfile(source),workerRepair=p===MODEL_WORKER_PREFLIGHT,workflowRepair=p===MODEL_WORKFLOW_PREFLIGHT,selectionRepair=p===MODEL_SELECTION_PREFLIGHT,failedIndex=workerRepair?41:workflowRepair?17:selectionRepair?16:13;
 const chained=selectionRepair||workflowRepair||workerRepair,originDirectory=workerRepair?'model-workflow-origin':workflowRepair?'model-selection-origin':'model-operation-origin';
 assert(p);assert.deepEqual(p.retain,workerRepair?[1,4,5,6,7,8,9,10,11,12,13,14,15,16,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,40]:workflowRepair?[1,4,5,6,7,8,9,10,11,12,13,14,15,16]:selectionRepair?[1,4,5,6,7,8,9,10,11,12,13,14,15]:[1,4,5,6,7,8,9,12]);
 for(const affected of (workerRepair?[0,2,3,17,34,35,36,37,38,39,41,42,48,51]:workflowRepair?[0,2,3,17,18,41,42,48,51]:selectionRepair?[0,2,3,16,17,41,42,48,51]:[0,2,3,10,11,13,18,41,42,48,51]))assert(!p.retain.includes(affected),'Changed checks and all unexecuted acceptance must run');
 // Query real isolated Git trees, sharing only read-only original objects. This
 // never changes the checkout/index and does not execute a retained command.
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-model-preflight-'));
 const bare=path.join(temporary,'git');
 const gitEnv={...process.env,GIT_AUTHOR_NAME:'Synthetic',GIT_AUTHOR_EMAIL:'synthetic@example.invalid',GIT_COMMITTER_NAME:'Synthetic',GIT_COMMITTER_EMAIL:'synthetic@example.invalid'};
 const read=(args,input)=>execFileSync('git',['--git-dir',bare,...args],{env:gitEnv,input,stdio:['pipe','pipe','pipe']});
 try{
  execFileSync('git',['init','--bare',bare],{stdio:'pipe'});
  const objects=path.resolve(execFileSync('git',['rev-parse','--git-path','objects'],{encoding:'utf8'}).trim());
  fs.writeFileSync(path.join(bare,'objects/info/alternates'),objects+'\n');
  const fixes=workerRepair?{
   'tests/helpers/canvas-agent-model-operation-cases.mjs':execFileSync('git',['cat-file','blob','72adeca318d1daeb00fc5fcb5d0161668f7c3c85']),
   'tests/q2-canvas-agent-provider.spec.js':execFileSync('git',['cat-file','blob','be9047002640b1aba8bab058e58027d0f0fdf248']),
  }:workflowRepair?{
   'scripts/test-local-release.mjs':fs.readFileSync('scripts/test-local-release.mjs'),
  }:selectionRepair?{
   'scripts/test-ci-test-selection.mjs':execFileSync('git',['cat-file','blob','f9a66de2cd4adf47a4512a697584cc6f6c672ea2']),
  }:{
   'config/release-compat.json':execFileSync('git',['cat-file','blob','3b7535583f87d15e6ef6318bc07c863d7a6f086d']),
   'scripts/test-release-compat.mjs':execFileSync('git',['cat-file','blob','c3293d9abcef4eface7f39b25fc4a41b711da96d']),
  };
  const commit=(changes,parent=p.source)=>{
   read(['read-tree',p.source]);
   for(const [file,value]of Object.entries(changes)){
    if(value===null){read(['update-index','--index-info'],Buffer.from(`0 ${'0'.repeat(40)}\t${file}\n`));continue;}
    const blob=read(['hash-object','-w','--stdin'],value.content??value).toString().trim();
    read(['update-index','--add','--cacheinfo',`${value.mode||'100644'},${blob},${file}`]);
   }
   const tree=read(['write-tree']).toString().trim();
   return read(['commit-tree',tree,'-p',parent],Buffer.from('Synthetic continuation boundary\n')).toString().trim();
  };
  const accepted=commit(fixes);assertCanvasPreflightTree(accepted,read,p);
  for(const file of ['workers/auth/src/index.js','js/pages/canvas/agent.js','tests/canvas.spec.js','package-lock.json','.github/workflows/static.yml','config/release-validation.yml','scripts/lib/ci-test-selection.mjs',...(chained?['config/release-compat.json','scripts/test-release-compat.mjs']:[]),...((workflowRepair||workerRepair)?['scripts/test-ci-test-selection.mjs']:[]),...(workerRepair?['tests/grok-chat-workers.spec.js','tests/q2-canvas-agent-model-operation.spec.js']:[])]){
   const changed=commit({...fixes,[file]:Buffer.from('Unrelated change')});
   assert.throws(()=>assertCanvasPreflightTree(changed,read,p),/changed product, tests, selection or environment/);
  }
  for(const file of Object.keys(fixes))assert.throws(()=>assertCanvasPreflightTree(commit({...fixes,[file]:Buffer.from('Unreviewed repair')}),read,p),/Unreviewed/);
  assert.throws(()=>assertCanvasPreflightTree(commit(chained?{}:{'config/release-compat.json':fixes['config/release-compat.json']}),read,p),/Missing reviewed/);
  for(const value of [null,{mode:'120000',content:Buffer.from('outside')}])assert.throws(()=>assertCanvasPreflightTree(commit({...fixes,'scripts/local-release.mjs':value}),read,p),/ordinary file/);
  assert.throws(()=>assertCanvasPreflightTree(commit(fixes,accepted),read,p),/direct source successor/);
  assert.throws(()=>canvasPreflightPrefix(Buffer.from(JSON.stringify({sha:p.source})),{sha:accepted},read),/Changed failed preflight checkpoint/);
  if(workflowRepair){
   const file='scripts/test-local-release.mjs',original=fixes[file].toString(),marker=['// BEGIN','PINNED LOCAL WORKFLOW GUARD'].join(' ');
   for(const changed of [original.replace(marker,marker+'\n// changed guard'),original+marker])assert.throws(()=>assertCanvasPreflightTree(commit({[file]:Buffer.from(changed)}),read,p),/Unreviewed workflow guard/);
  }
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}

 // The real resumed caller supplies the original private checkpoint and logs as
 // evidence inputs, never Git fixtures. Require them for this direct successor.
 const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 const parents=execFileSync('git',['rev-list','--parents','-n','1',head],{encoding:'utf8'}).trim().split(/\s+/);
 const evidenceRoot='.local-release',checkpoint=path.join(evidenceRoot,'reuse/preflight-checkpoint.json');
 if(parents.length===2&&parents[1]===p.source){
  assert(fs.existsSync(checkpoint),'Continuation must exercise its real checkpoint and retained logs');
  const bytes=fs.readFileSync(checkpoint),original=JSON.parse(bytes);
  const selection=gitSelection(original.base,head),commands=selectedCommands(selection,{GITHUB_SHA:head,CANDIDATE_BASE:original.base});
  const context={sha:head,base:original.base,planHash:validationPlan().digest,selection,environment:original.environment,commands};
  assert.equal(canvasPreflightPrefix(bytes,context).sha,p.source);
  for(const change of [o=>o.status='passed',o=>o.commands[failedIndex].exitCode=0,o=>o.commands[1].exitCode=1,o=>o.commands[1].logHash='changed',o=>o.commands.pop()]){
   const altered=structuredClone(original);change(altered);assert.throws(()=>canvasPreflightPrefix(Buffer.from(JSON.stringify(altered)),context));
  }
  for(const change of [c=>c.base='b'.repeat(40),c=>c.planHash='changed',c=>c.environment.key='changed',c=>c.environment.image='changed',c=>c.selection.full=true,c=>c.commands.pop(),c=>c.commands[13].run='echo skipped',c=>c.commands[48].run='echo skipped']){
   const altered=structuredClone(context);change(altered);assert.throws(()=>canvasPreflightPrefix(bytes,altered));
  }
  const bundle=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-model-prefix-proof-'));
  try{
   fs.mkdirSync(path.join(bundle,'reuse'));fs.mkdirSync(path.join(bundle,'logs'));
   fs.copyFileSync(checkpoint,path.join(bundle,'reuse/preflight-checkpoint.json'));
   const failed=fs.readFileSync(path.join(evidenceRoot,'reuse/preflight-failed.log'));
   fs.writeFileSync(path.join(bundle,'reuse/preflight-failed.log'),failed);
   // Fresh rows are explicitly synthetic only for the verifier's rejection
   // controls. Actual release acceptance still requires all normal final proofs.
   const rows=commands.map((command,index)=>{
    if(p.retain.includes(index)){
     const row={...original.commands[index],reusedFrom:original.commands[index].reusedFrom||p.source};
     fs.copyFileSync(path.join(evidenceRoot,row.log),path.join(bundle,row.log));return row;
    }
    return {command,exitCode:0,log:`logs/${index}.log`,durationMs:1,logHash:sha256('Synthetic fresh verifier row')};
   });
   const evidence={...context,commands:rows,preflightContinuation:{source:p.source,checkpoint:p.checkpoint}};
   if(chained)fs.cpSync(path.join(evidenceRoot,'reuse',originDirectory),path.join(bundle,'reuse',originDirectory),{recursive:true});
   if(workerRepair){
    for(const file of ['original-worker-discovery.json','original-worker-last-run.json'])fs.copyFileSync(path.join(evidenceRoot,'reuse',file),path.join(bundle,'reuse',file));
    testModelWorkerEvidence(bundle,head,commands[41],{verifyModelWorkerRepair,modelWorkerContinuation});
    evidence.commands[41].continuation=modelWorkerContinuation(commands[41].run);
   }
   verifyCanvasPreflight(bundle,evidence,commands);
   for(const index of (workerRepair?[0,17,34,41,48]:workflowRepair?[0,17,18,48]:selectionRepair?[0,16,17,48]:[0,10,13,18,48])){
    const forged=structuredClone(evidence);forged.commands[index].reusedFrom=p.source;
    assert.throws(()=>verifyCanvasPreflight(bundle,forged,commands));
   }
   const retained=path.join(bundle,original.commands[1].log),retainedBytes=fs.readFileSync(retained);
   fs.unlinkSync(retained);assert.throws(()=>verifyCanvasPreflight(bundle,evidence,commands));
   fs.writeFileSync(retained,'forged retained success');assert.throws(()=>verifyCanvasPreflight(bundle,evidence,commands));
   fs.writeFileSync(retained,retainedBytes);
   fs.writeFileSync(path.join(bundle,'reuse/preflight-failed.log'),'pretend compatibility passed');assert.throws(()=>verifyCanvasPreflight(bundle,evidence,commands),/Changed original failed/);
   fs.unlinkSync(path.join(bundle,'reuse/preflight-failed.log'));assert.throws(()=>verifyCanvasPreflight(bundle,evidence,commands));
   fs.writeFileSync(path.join(bundle,'reuse/preflight-failed.log'),failed);verifyCanvasPreflight(bundle,evidence,commands);
   if(chained){
    const provenance=structuredClone(evidence);provenance.commands[1].reusedFrom=p.source;
    assert.throws(()=>verifyCanvasPreflight(bundle,provenance,commands),'Earlier retained rows must keep their original source');
    for(const file of ['reuse/preflight-checkpoint.json','reuse/preflight-failed.log','logs/1.log',...(workflowRepair?['reuse/model-operation-origin/reuse/preflight-checkpoint.json','reuse/model-operation-origin/reuse/preflight-failed.log','reuse/model-operation-origin/logs/1.log']:[]),...(workerRepair?['reuse/model-selection-origin/reuse/preflight-checkpoint.json','reuse/model-selection-origin/reuse/preflight-failed.log','reuse/model-selection-origin/reuse/model-operation-origin/reuse/preflight-checkpoint.json','reuse/model-selection-origin/reuse/model-operation-origin/logs/1.log']:[])]){
     const origin=path.join(bundle,'reuse',originDirectory,file),originalBytes=fs.readFileSync(origin);
     fs.unlinkSync(origin);assert.throws(()=>verifyCanvasPreflight(bundle,evidence,commands));
     fs.writeFileSync(origin,'forged origin');assert.throws(()=>verifyCanvasPreflight(bundle,evidence,commands));
     fs.writeFileSync(origin,originalBytes);
    }
    verifyCanvasPreflight(bundle,evidence,commands);
   }
  }finally{fs.rmSync(bundle,{recursive:true,force:true});}
  console.log(`Model preflight ${p.source.slice(0,8)}: actual checkpoint, failed log and ${p.retain.length} retained command logs verified; failure, missing, forged, command, selection and origin controls reject.`);
 }
 console.log('Model-operation continuation: real Git trees reject product, environment, selection, wrong repair, deleted input, symlink and foreign-parent changes.');
}

{
 const {EXPORT_PREFLIGHT,canvasPreflightProfile,assertCanvasPreflightTree,canvasPreflightPrefix}=await import('./lib/local-release-evidence.mjs');
 assert.equal(canvasPreflightProfile(EXPORT_PREFLIGHT.source),EXPORT_PREFLIGHT);assert.equal(canvasPreflightProfile('unknown'),null);
 const read=args=>args[0]==='diff'?Buffer.from('scripts/test-homepage-selection.mjs'):args[0]==='show'?historicalExportFile('scripts/test-homepage-selection.mjs'):Buffer.from('');
 assertCanvasPreflightTree('f'.repeat(40),read,EXPORT_PREFLIGHT);
 assert.throws(()=>assertCanvasPreflightTree('f'.repeat(40),args=>args[0]==='diff'?Buffer.from('js/pages/canvas/full-video.js'):read(args),EXPORT_PREFLIGHT));
 assert.throws(()=>assertCanvasPreflightTree('f'.repeat(40),args=>args[0]==='show'?Buffer.from('forged'):read(args),EXPORT_PREFLIGHT));
 assert.throws(()=>canvasPreflightPrefix(Buffer.from(JSON.stringify({sha:EXPORT_PREFLIGHT.source})),{sha:'f'.repeat(40)},read),/Changed failed preflight checkpoint/);
 assert(!EXPORT_PREFLIGHT.retain.includes(15),'Failed command must execute');
 for(const affected of [0,2,3,12])assert(!EXPORT_PREFLIGHT.retain.includes(affected),'Changed source checks cannot inherit a pass');
}

{
 const {EXPORT_NATIVE_PREFLIGHT,assertCanvasPreflightTree,verifyExportGuardUnion,canvasExportStageContinuation}=await import('./lib/local-release-evidence.mjs');
 const read=args=>args[0]==='diff'?Buffer.from('tests/helpers/q2-runtime/linux-hosted.mjs'):args[0]==='show'?historicalExportFile(args[1].split(':').slice(1).join(':')):Buffer.from('');
 assertCanvasPreflightTree('f'.repeat(40),read,EXPORT_NATIVE_PREFLIGHT);
 assert.throws(()=>assertCanvasPreflightTree('f'.repeat(40),args=>args[0]==='diff'?Buffer.from('workers/auth/src/index.js'):read(args),EXPORT_NATIVE_PREFLIGHT));
 assert.throws(()=>assertCanvasPreflightTree('f'.repeat(40),args=>args[0]==='show'?Buffer.from('forged'):read(args),EXPORT_NATIVE_PREFLIGHT));
 const names=['default native runtime plan stages every actual suite and control input','focused native scopes dispatch through the actual child and preserve boundaries'];
 const before=Array.from({length:32},(_,i)=>({title:names[i]||'unchanged '+i,status:i<2?'failed':'passed'})),after=names.map(title=>({title,status:'passed'}));
 verifyExportGuardUnion(before,after);
 for(const changed of [[],after.slice(1),[...after,after[0]],after.map((r,i)=>i?r:{...r,status:'failed'}),[...after,{title:'unchanged 3',status:'passed'}]])assert.throws(()=>verifyExportGuardUnion(before,changed));
 assert.throws(()=>canvasExportStageContinuation('echo incomplete'));
 const command="node --test tests/canvas-workspace-transitions.test.mjs tests/q2-recovery-staging.test.mjs scripts/test-q2-runtime-launcher.mjs &&\nnode scripts/test-q2-runtime.mjs --suite canvas-transitions";
 const continued=canvasExportStageContinuation(command);
 assert.equal((continued.match(/node scripts\/test-q2-runtime.mjs/g)||[]).length,1,'Exactly one native execution remains');
 assert(!continued.includes('node --test'),'Already passed guards are represented by their verified report union');
 const parsed=spawnSync('/bin/bash',['-n'],{input:continued,encoding:'utf8'});assert.equal(parsed.status,0,parsed.stderr);

}

{
 const {EXPORT_MEDIA_PREFLIGHT,assertCanvasPreflightTree,canvasPreflightProfile}=await import('./lib/local-release-evidence.mjs');
 const read=args=>args[0]==='diff'?Buffer.from('services/homepage-ffmpeg-processor/canvas-transitions.mjs'):args[0]==='show'?historicalExportFile('services/homepage-ffmpeg-processor/canvas-transitions.mjs'):Buffer.from('');
 assert.equal(canvasPreflightProfile(EXPORT_MEDIA_PREFLIGHT.source),EXPORT_MEDIA_PREFLIGHT);
 assertCanvasPreflightTree('f'.repeat(40),read,EXPORT_MEDIA_PREFLIGHT);
 for(const file of ['workers/auth/src/lib/canvas-video-processing.js','tests/helpers/canvas-workspace-transition-control.mjs','services/homepage-ffmpeg-processor/canvas-diagnostics.mjs'])assert.throws(()=>assertCanvasPreflightTree('f'.repeat(40),args=>args[0]==='diff'?Buffer.from(file):read(args),EXPORT_MEDIA_PREFLIGHT));
 assert.throws(()=>assertCanvasPreflightTree('f'.repeat(40),args=>args[0]==='show'?Buffer.from('forged'):read(args),EXPORT_MEDIA_PREFLIGHT));
 assert(EXPORT_MEDIA_PREFLIGHT.retain.includes(41));assert(!EXPORT_MEDIA_PREFLIGHT.retain.includes(42));
}

{
 const {EXAMPLE_PREFLIGHT,assertCanvasPreflightTree,canvasPreflightProfile,canvasPreflightPrefix}=await import('./lib/local-release-evidence.mjs');
 const read=args=>args[0]==='diff'?Buffer.from('scripts/test-local-release.mjs'):args[0]==='show'?execFileSync('git',['show','39023dadfc72786cf641ecc911cce8b5733120f8:scripts/test-local-release.mjs']):Buffer.from('');
 assert.equal(canvasPreflightProfile(EXAMPLE_PREFLIGHT.source),EXAMPLE_PREFLIGHT);
 assertCanvasPreflightTree('f'.repeat(40),read,EXAMPLE_PREFLIGHT);
 for(const file of ['js/pages/canvas/transition-example.js','assets/canvas/transition-examples/fade.gif','config/release-validation.yml','package-lock.json'])assert.throws(()=>assertCanvasPreflightTree('f'.repeat(40),args=>args[0]==='diff'?Buffer.from(file):read(args),EXAMPLE_PREFLIGHT));
 assert.throws(()=>assertCanvasPreflightTree('f'.repeat(40),args=>args[0]==='show'?Buffer.from('forged'):read(args),EXAMPLE_PREFLIGHT));
 assert.throws(()=>canvasPreflightPrefix(Buffer.from('{}'),{sha:'f'.repeat(40)},read));
 for(const changed of [0,2,3,12,17])assert(!EXAMPLE_PREFLIGHT.retain.includes(changed));
 assert.equal(EXAMPLE_PREFLIGHT.retain.length,13,'Only unchanged completed checks are retained');
 console.log('Historical export fixtures remain pinned; GIF preflight continuation rejects changed product, commands, dependencies and forged evidence.');
}

{
 const {EXAMPLE_BROWSER_PREFLIGHT,assertCanvasPreflightTree,canvasExampleBrowserContinuation}=await import('./lib/local-release-evidence.mjs');
 const file='tests/helpers/canvas-transition-examples-ui.cjs';
 const corrected=execFileSync('git',['show',EXAMPLE_BROWSER_PREFLIGHT.source+':'+file]).toString()
  .replace('// Real keyboard selection, retaining the existing save operation.','// Native macOS headless menus do not commit ArrowDown; type-ahead selects\n // the localized option using the keyboard and the existing change/save handler.')
  .replace("await select.press('ArrowDown');await select.press('Tab');","await select.press(de?'w':'c');await page.keyboard.press('Tab');");
 const read=args=>Buffer.from(args[0]==='diff'?file:args[0]==='show'?corrected:'');
 assertCanvasPreflightTree('f'.repeat(40),read,EXAMPLE_BROWSER_PREFLIGHT);
 for(const path of ['js/pages/canvas/transition-example.js','tests/canvas-transition-examples.test.mjs','assets/canvas/transition-examples/fade.gif','config/release-validation.yml'])assert.throws(()=>assertCanvasPreflightTree('f'.repeat(40),args=>args[0]==='diff'?Buffer.from(path):read(args),EXAMPLE_BROWSER_PREFLIGHT));
 assert.throws(()=>assertCanvasPreflightTree('f'.repeat(40),args=>args[0]==='show'?Buffer.from('forged'):read(args),EXAMPLE_BROWSER_PREFLIGHT));
 const original="  node --test tests/canvas-transition-examples.test.mjs\n  npm run test:static -- --grep 'Canvas transition examples' --retries=0";
 assert.equal(canvasExampleBrowserContinuation(original),"  npm run test:static -- --grep 'Canvas transition examples' --retries=0");
 assert.throws(()=>canvasExampleBrowserContinuation(original+original));assert.throws(()=>canvasExampleBrowserContinuation('echo incomplete'));
 assert(EXAMPLE_BROWSER_PREFLIGHT.retain.includes(36));assert(!EXAMPLE_BROWSER_PREFLIGHT.retain.includes(41));
 console.log('GIF keyboard continuation preserves the decoded-asset and hosting proofs while requiring all four fresh browser results.');
}

{
 const {EXAMPLE_CACHE_CONTINUATION:p}=await import('./lib/local-release-browser.mjs');
 const blob=execFileSync('git',['cat-file','blob','55602ba09ce5b71e4488b61a0c4a5efcb80f6306']);
 const read=args=>args[0]==='show'?blob:Buffer.from(args[0]==='diff'?'tests/helpers/canvas-transition-examples-ui.cjs':'');
 assertSmoothContinuationTree('f'.repeat(40),read,{source:p.source});
 for(const file of ['js/pages/canvas/transition-example.js','assets/canvas/transition-examples/fade.gif','tests/canvas-transition-examples.test.mjs','config/release-validation.yml'])assert.throws(()=>assertSmoothContinuationTree('f'.repeat(40),args=>args[0]==='diff'?Buffer.from(file):read(args),{source:p.source}));
 assert.throws(()=>assertSmoothContinuationTree('f'.repeat(40),args=>args[0]==='show'?Buffer.from('forged'):read(args),{source:p.source}));
 const rawPath='.local-release/reuse/smooth-browser.json';
 if(fs.existsSync(rawPath)&&sha256(fs.readFileSync(rawPath))===p.report){
  const raw=JSON.parse(fs.readFileSync(rawPath)),previous=browserRows(raw),discovery=browserRows(raw,{discovery:true});
  const bytes=fs.readFileSync('.local-release/reuse/smooth-progress.json');assert.equal(sha256(bytes),p.browserProgress.report);
  const progress={sha:p.browserProgress.sha,rows:browserRows(JSON.parse(bytes))},retained=smoothRetained(previous,progress,p);
  const fresh=previous.filter(row=>!retained.has(row.key)).map(row=>({...row,expectedStatus:'passed',status:'expected',results:[{status:'passed',retry:0,error:false}]}));
  const report={policy:SMOOTH_BROWSER_POLICY,sha:'f'.repeat(40),source:p.source,previous,progress,discovery,fresh,counts:p.counts};
  const proof=r=>candidateProof({sha:r.sha,selection:{auth:true,canvasText:true,canvasExamples:true}},{job:'browser-validation',readJson:name=>name.endsWith('canvas-discovery.json')?raw:r});
  assert.equal(proof(report).tests,4);
  for(const change of [r=>r.fresh.pop(),r=>r.fresh.push(r.fresh[0]),r=>r.fresh[0].results[0].status='failed',r=>r.fresh[0].results[0].retry=1,r=>r.previous.find(passedBrowserCase).status='unexpected',r=>r.discovery.pop(),r=>delete r.progress,r=>r.progress.rows.find(passedBrowserCase).results[0].status='failed']){const broken=structuredClone(report);change(broken);assert.throws(()=>proof(broken));}
  console.log('Synthetic union counterchecks: real 2 Chromium and 1 WebKit passes retained; missing, failed, retried, duplicate or substituted WebKit results block candidate acceptance.');
 }
}

{
 const {MODEL_BROWSER_POLICY,MODEL_BROWSER_PREFLIGHT:p,verifyModelBrowserReport}=await import('./lib/local-release-browser.mjs');
 const {canvasPreflightProfile,assertCanvasPreflightTree,canvasPreflightPrefix,verifyModelBrowserRepair,modelBrowserContinuation}=await import('./lib/local-release-evidence.mjs');
 assert.equal(canvasPreflightProfile(p.source),p);
 assert.deepEqual(Object.keys(p.specs),['tests/helpers/canvas-agent-ui.cjs']);
 for(const index of [0,2,3,14,15,16,17,18,34,35,37,38,39,47,48,49,50,51])assert(!p.retain.includes(index),'Changed verifiers and unfinished acceptance cannot inherit a pass');
 for(const index of [40,41,42,43,44,45,46])assert(p.retain.includes(index),'Completed Worker, media, native and upstream browser evidence must remain retained');
 const fixture='tests/helpers/canvas-agent-ui.cjs',fix=execFileSync('git',['cat-file','blob','3d6b12e8bc9728da44c3849ae167f579b39dc642']);
 assert.equal(sha256(fix),p.specs[fixture]);
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-model-browser-tree-')),bare=path.join(tmp,'git');
 const env={...process.env,GIT_AUTHOR_NAME:'Synthetic',GIT_AUTHOR_EMAIL:'synthetic@example.invalid',GIT_COMMITTER_NAME:'Synthetic',GIT_COMMITTER_EMAIL:'synthetic@example.invalid'};
 const read=(args,input)=>execFileSync('git',['--git-dir',bare,...args],{env,input,stdio:['pipe','pipe','pipe']});
 try{
  execFileSync('git',['init','--bare',bare],{stdio:'pipe'});
  fs.writeFileSync(path.join(bare,'objects/info/alternates'),path.resolve(execFileSync('git',['rev-parse','--git-path','objects'],{encoding:'utf8'}).trim())+'\n');
  const commit=(changes,parent=p.source)=>{
   read(['read-tree',p.source]);
   for(const [file,value]of Object.entries(changes)){
    if(value===null){read(['update-index','--index-info'],Buffer.from(`0 ${'0'.repeat(40)}\t${file}\n`));continue;}
    const blob=read(['hash-object','-w','--stdin'],value.content??value).toString().trim();
    read(['update-index','--add','--cacheinfo',`${value.mode||'100644'},${blob},${file}`]);
   }
   return read(['commit-tree',read(['write-tree']).toString().trim(),'-p',parent],Buffer.from('Synthetic browser continuation boundary\n')).toString().trim();
  };
  const accepted=commit({[fixture]:fix});assertCanvasPreflightTree(accepted,read,p);
  for(const file of ['js/pages/canvas/agent.js','workers/auth/src/index.js','tests/canvas.spec.js','tests/helpers/canvas-agent-model-recovery-ui.cjs','tests/helpers/canvas-agent-model-operation-cases.mjs','tests/q2-canvas-agent-provider.spec.js','package-lock.json','.github/workflows/static.yml','config/release-validation.yml','config/release-compat.json','scripts/lib/ci-test-selection.mjs','scripts/lib/homepage-test-selection.mjs'])
   assert.throws(()=>assertCanvasPreflightTree(commit({[fixture]:fix,[file]:Buffer.from('Unrelated change')}),read,p),/changed product, tests, selection or environment/);
  assert.throws(()=>assertCanvasPreflightTree(commit({}),read,p),/Missing reviewed browser fixture/);
  assert.throws(()=>assertCanvasPreflightTree(commit({[fixture]:Buffer.from('Unreviewed fixture')}),read,p),/Unreviewed browser fixture/);
  for(const value of [null,{mode:'120000',content:Buffer.from('outside')}])
   assert.throws(()=>assertCanvasPreflightTree(commit({[fixture]:fix,'scripts/local-release.mjs':value}),read,p),/ordinary file/);
  assert.throws(()=>assertCanvasPreflightTree(commit({[fixture]:fix},accepted),read,p),/direct source successor/);
  assert.throws(()=>canvasPreflightPrefix(Buffer.from(JSON.stringify({sha:p.source})),{sha:accepted},read),/Changed failed preflight checkpoint/);
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}

 const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 const parents=execFileSync('git',['rev-list','--parents','-n','1',head],{encoding:'utf8'}).trim().split(/\s+/);
 if(parents.length===2&&parents[1]===p.source){
  // Private failed evidence is supplied by the resumed real caller, never
  // committed as a fixture or rewritten as successful historical execution.
  const root='.local-release',checkpoint=path.join(root,'reuse/preflight-checkpoint.json');
  assert(fs.existsSync(checkpoint),'Browser continuation requires its actual failed source checkpoint');
  const bytes=fs.readFileSync(checkpoint),original=JSON.parse(bytes);
  const selection=gitSelection(original.base,head),commands=selectedCommands(selection,{GITHUB_SHA:head,CANDIDATE_BASE:original.base});
  const context={sha:head,base:original.base,planHash:validationPlan().digest,selection,environment:original.environment,commands};
  assert.equal(canvasPreflightPrefix(bytes,context).sha,p.source);
  for(const change of [r=>r.status='passed',r=>r.commands[49].exitCode=0,r=>r.commands[41].exitCode=1,r=>r.commands[40].logHash='changed',r=>r.commands.pop(),r=>delete r.preflightContinuation]){
   const broken=structuredClone(original);change(broken);assert.throws(()=>canvasPreflightPrefix(Buffer.from(JSON.stringify(broken)),context));
  }
  for(const change of [r=>r.base='b'.repeat(40),r=>r.planHash='changed',r=>r.environment.key='changed',r=>r.environment.image='changed',r=>r.selection.full=true,r=>r.commands.pop(),r=>r.commands[41].run='echo skipped',r=>r.commands[49].run='echo skipped']){
   const broken=structuredClone(context);change(broken);assert.throws(()=>canvasPreflightPrefix(bytes,broken));
  }
  const proof=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-model-browser-proof-'));
  try{
   fs.mkdirSync(path.join(proof,'reuse'));
   for(const file of ['preflight-checkpoint.json','preflight-failed.log','model-browser-original.json','model-browser-standard.json'])fs.copyFileSync(path.join(root,'reuse',file),path.join(proof,'reuse',file));
   fs.cpSync(path.join(root,'reuse/model-worker-origin'),path.join(proof,'reuse/model-worker-origin'),{recursive:true});
   const reports=path.join(proof,'test-results');fs.mkdirSync(reports);
   for(const file of Object.keys(p.homepageReports))fs.copyFileSync(path.join(root,'test-results',file),path.join(reports,file));
   const verify=()=>verifyModelBrowserRepair(proof,head);
   const pending=verifyModelBrowserRepair(proof,head,{allowPending:true});assert.equal(pending.result,null);
   assert.throws(verify,'Source evidence alone cannot replace fresh browser execution');
   const previous=pending.previous,discovery=previous.map(({key,file,title,project})=>({key,file,title,project}));
   const retained=new Map(previous.filter(passedBrowserCase).map(row=>[row.key,row]));
   const unresolved=previous.filter(row=>!retained.has(row.key));
   assert.deepEqual(unresolved.map(row=>[row.project,row.title]).sort(),['chromium','webkit-canvas'].flatMap(project=>['en','de'].map(locale=>[project,`Canvas agent ${locale}: outcome`])).sort(),'Only the four failed outcome cases may run again');
   const fresh=unresolved.map(row=>({...row,expectedStatus:'passed',status:'expected',results:[{status:'passed',retry:0,error:false}]}));
   const report={policy:MODEL_BROWSER_POLICY,sha:head,source:p.source,scope:'homepage',previous,discovery,fresh,counts:verifyBrowserUnion(discovery,retained,fresh)};
   assert.deepEqual(report.counts,{required:566,reused:562,executed:4});assert.equal(report.counts.required,p.required);
   // Synthetic fresh rows calibrate the verifier only; the final release must
   // separately provide executed raw reports with these exact unresolved IDs.
   const rawRows=rows=>({config:{workers:1},suites:[{title:'Synthetic verifier controls',specs:rows.map(row=>({id:row.key.slice(row.project.length+1),file:row.file,title:row.title,tests:[{projectName:row.project,expectedStatus:row.expectedStatus,status:row.status,results:row.results}]}))}],errors:[],stats:{expected:rows.length,unexpected:0,flaky:0,skipped:0}});
   const raw=rawRows(fresh);
   const wrapperFile=path.join(reports,'candidate-homepage.json'),freshFile=path.join(reports,'model-browser-fresh.json'),discoveryFile=path.join(reports,'model-browser-discovery.json');
   const save=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2));
   fs.copyFileSync(path.join(proof,'reuse/model-browser-original.json'),discoveryFile);
   save(freshFile,raw);assert.throws(verify,'Raw execution without its bound union is incomplete');save(wrapperFile,report);
   assert.throws(verify,'Completed core evidence cannot replace unexecuted Auth acceptance');
   assert.deepEqual(verifyModelBrowserReport(report,head),report.counts);
   const standard=JSON.parse(fs.readFileSync(path.join(proof,'reuse/model-browser-standard.json')));
   // Match the independent ordinary package.json test:auth file/project scope.
   const authDiscovery=browserRows(standard,{discovery:true}).filter(row=>row.project==='chromium'&&(/^(auth-admin|wallet-nav|locale|oma2-q1-member)\.spec\.js$/.test(row.file)||/^oma2-q3-.*\.spec\.js$/.test(row.file)));
   assert.equal(authDiscovery.length,709);assert.equal(sha256(JSON.stringify(authDiscovery)),p.authDiscovery);
   const overlap=authDiscovery.filter(row=>retained.has(row.key));
   assert.equal(overlap.length,25);assert(overlap.every(row=>row.file==='locale.spec.js'&&row.project==='chromium'));
   const authFresh=authDiscovery.filter(row=>!retained.has(row.key)).map(row=>({...row,expectedStatus:'passed',status:'expected',results:[{status:'passed',retry:0,error:false}]}));
   assert.equal(authFresh.length,684);assert(authFresh.every(row=>row.file!=='locale.spec.js'));
   const auth={...report,scope:'auth',discovery:authDiscovery,fresh:authFresh,counts:{required:709,reused:25,executed:684}};
   const authRaw=rawRows(authFresh),authFile=path.join(reports,'candidate-auth.json'),authFreshFile=path.join(reports,'model-browser-auth-fresh.json'),authDiscoveryFile=path.join(reports,'model-browser-auth-discovery.json');
   save(authDiscoveryFile,rawRows(authDiscovery));save(authFreshFile,authRaw);assert.throws(verify,'Raw Auth execution must have its bound union');save(authFile,auth);
   const expected={homepage:report.counts,auth:auth.counts};assert.deepEqual(verify().result,expected);
   assert.deepEqual(verifyModelBrowserReport(auth,head),auth.counts);
   const candidate=r=>candidateProof({sha:head,selection:{homepage:true}},{job:'browser-validation',readJson:()=>r});
   assert.equal(candidate(report).tests,p.required);
   const combined=(core=report,account=auth)=>candidateProof({sha:head,selection:{homepage:true,auth:true}},{job:'browser-validation',readJson:file=>file.endsWith('candidate-auth.json')?account:core});
   assert.equal(combined().tests,p.required+709);
   assert.throws(()=>combined(auth,report),'Reports from different scopes cannot be substituted');
   for(const change of [r=>r.policy='unknown',r=>r.sha='f'.repeat(40),r=>r.source='f'.repeat(40),r=>r.scope='auth',r=>r.previous.pop(),r=>r.previous.find(passedBrowserCase).results[0].status='failed',
    r=>r.discovery.pop(),r=>r.discovery.push(r.discovery[0]),r=>r.discovery[0].title='Foreign discovery',r=>r.fresh.pop(),r=>r.fresh.push(r.fresh[0]),r=>r.fresh.push(previous.find(passedBrowserCase)),
    r=>r.fresh[0].key='foreign-case',r=>r.fresh[0].file='foreign.spec.js',r=>r.fresh[0].project='foreign',r=>r.fresh[0].expectedStatus='failed',r=>r.fresh[0].status='skipped',r=>r.fresh[0].results[0].status='skipped',
    r=>r.fresh[0].results[0].status='failed',r=>r.fresh[0].results[0].retry=1,r=>r.fresh[0].results[0].error=true,r=>r.fresh[0].results.unshift({status:'failed',retry:0,error:true}),r=>r.counts.reused++,r=>delete r.fresh]){
    const broken=structuredClone(report);change(broken);assert.throws(()=>candidate(broken));
   }
   assert.throws(()=>candidateProof({sha:head,selection:{}},{job:'homepage-validation',reportFile:'test-results/candidate-homepage.json',readJson:()=>report}));
   for(const change of [r=>r.discovery.pop(),r=>r.discovery.push(r.discovery[0]),r=>r.discovery[0].project='webkit-canvas',r=>r.discovery[0].key='foreign',
    r=>r.fresh.pop(),r=>r.fresh.push(r.fresh[0]),r=>r.fresh.push(previous.find(row=>row.key===overlap[0].key)),r=>r.fresh[0].results[0].status='skipped',r=>r.fresh[0].results[0].status='failed',r=>r.fresh[0].results[0].retry=1,
    r=>r.previous.find(row=>row.key===overlap[0].key).results[0].status='skipped',r=>r.previous.find(row=>row.key===overlap[0].key).results[0].retry=1,r=>r.previous.find(row=>row.key===overlap[0].key).project='webkit-canvas',r=>r.counts.reused=0]){
    const broken=structuredClone(auth);change(broken);assert.throws(()=>combined(report,broken));
   }
   for(const file of ['reuse/preflight-checkpoint.json','reuse/preflight-failed.log','reuse/model-browser-original.json','reuse/model-browser-standard.json','reuse/model-worker-origin/reuse/preflight-checkpoint.json','reuse/model-worker-origin/reuse/preflight-failed.log','reuse/model-worker-origin/reuse/original-worker-last-run.json','reuse/model-worker-origin/test-results/model-worker-fresh.json','reuse/model-worker-origin/logs/41.log','reuse/model-worker-origin/reuse/model-workflow-origin/reuse/preflight-checkpoint.json','reuse/model-worker-origin/reuse/model-workflow-origin/reuse/model-selection-origin/reuse/model-operation-origin/logs/1.log','test-results/model-browser-discovery.json','test-results/model-browser-fresh.json','test-results/candidate-homepage.json','test-results/model-browser-auth-discovery.json','test-results/model-browser-auth-fresh.json','test-results/candidate-auth.json',...Object.keys(p.homepageReports).map(file=>'test-results/'+file)]){
    const target=path.join(proof,file),saved=fs.readFileSync(target);
    fs.unlinkSync(target);assert.throws(verify);fs.writeFileSync(target,'{}');assert.throws(verify);fs.writeFileSync(target,saved);
   }
   for(const change of [r=>r.config.workers=2,r=>delete r.config.workers,r=>r.errors.push({message:'Synthetic report error'}),r=>r.suites[0].specs[0].id='foreign',
    r=>{r.suites[0].specs.pop();r.stats.expected--;},r=>{r.suites[0].specs.push(r.suites[0].specs[0]);r.stats.expected++;},r=>r.suites[0].specs[0].tests[0].results[0].retry=1,
    r=>{const test=r.suites[0].specs[0].tests[0];test.status='skipped';test.results[0].status='skipped';r.stats.expected--;r.stats.skipped++;}]){
    for(const [file,accepted]of [[freshFile,raw],[authFreshFile,authRaw]]){const broken=structuredClone(accepted);change(broken);save(file,broken);assert.throws(verify);save(file,accepted);}
   }
   assert.deepEqual(verify().result,expected);
   assert.equal(modelBrowserContinuation(commands[49].run),'node scripts/local-release.mjs model-browser-continuation');
   for(const changed of ['echo skipped',commands[49].run+'\nnpm run test:homepage-core',commands[49].run.replace('--reporter=list,json','--reporter=list')])assert.throws(()=>modelBrowserContinuation(changed));
   const ordinaryAuth='PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/candidate-auth.json npm run test:auth -- --output=test-results/browser-artifacts --reporter=list,json';
   const continuedAuth=modelBrowserContinuation(commands[50].run,'auth');
   assert.equal(continuedAuth,commands[50].run.replace(ordinaryAuth,'node scripts/local-release.mjs model-browser-continuation auth'),'Only the ordinary Auth branch may change');
   assert(!continuedAuth.includes('npm run test:auth'),'Already passed locale cases must not repeat through the full Auth caller');
   for(const changed of ['echo skipped',commands[50].run+'\n'+ordinaryAuth,commands[50].run.replace(ordinaryAuth,'echo skipped')])assert.throws(()=>modelBrowserContinuation(changed,'auth'));
   assert.throws(()=>modelBrowserContinuation(commands[50].run,'foreign'));
   const syntax=spawnSync('/bin/bash',['-n'],{input:continuedAuth,encoding:'utf8'});assert.equal(syntax.status,0,syntax.stderr);
   console.log(`Browser continuation: original ${previous.length}-case report and recursive Worker chain verified; ${retained.size} unchanged passes plus ${fresh.length} synthetic fresh verifier controls, with missing/foreign/failed/skipped/retried/duplicate evidence rejected.`);
  }finally{fs.rmSync(proof,{recursive:true,force:true});}
 }
 console.log('Model browser continuation: actual isolated Git rejects unrelated product/tests, missing or changed correction, foreign parent, deleted file and symlink.');
}

{
 const {AUTONOMY_NATIVE_PREFLIGHT:p,canvasPreflightProfile,assertCanvasPreflightTree,canvasPreflightPrefix,verifyAutonomyNativeRepair,autonomyNativeContinuation}=await import('./lib/local-release-evidence.mjs');
 assert.equal(canvasPreflightProfile(p.source),p);
 const fixture='scripts/test-q2-runtime-launcher.mjs',doc='docs/runbooks/REGRESSION_REGISTER.md',title='Canvas reference fixture reads the staged bytes from a non-repository cwd';
 assert.deepEqual(Object.keys(p.specs),[fixture,doc]);
 const fixed=execFileSync('git',['cat-file','blob','164fe75cb39e9a6dad6645e6aecc8a74c75fbebf']);
 const fixedDoc=execFileSync('git',['cat-file','blob','c00726e7c9940c1a9886e3cc4d8a0affcddf8d54']);
 assert.equal(sha256(fixed),p.specs[fixture]);assert.equal(sha256(fixedDoc),p.specs[doc]);
 const reviewed={[fixture]:fixed,[doc]:fixedDoc};
 for(const index of [0,2,3,12,17,28,29,34,35,37,38,39,41,42,43,44,45,46,47,48,49,50,51,52])assert(!p.retain.includes(index),'Changed verifiers and unexecuted acceptance cannot inherit passes');
 for(const index of [1,4,13,14,15,16,18,27,30,33,36,40])assert(p.retain.includes(index),'Unchanged completed commands keep their existing evidence');
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-autonomy-native-tree-')),bare=path.join(temporary,'git');
 const env={...process.env,GIT_AUTHOR_NAME:'Synthetic',GIT_AUTHOR_EMAIL:'synthetic@example.invalid',GIT_COMMITTER_NAME:'Synthetic',GIT_COMMITTER_EMAIL:'synthetic@example.invalid'};
 const read=(args,input)=>execFileSync('git',['--git-dir',bare,...args],{env,input,stdio:['pipe','pipe','pipe']});
 try{
  execFileSync('git',['init','--bare',bare],{stdio:'pipe'});
  fs.writeFileSync(path.join(bare,'objects/info/alternates'),path.resolve(execFileSync('git',['rev-parse','--git-path','objects'],{encoding:'utf8'}).trim())+'\n');
  const commit=(changes,parent=p.source)=>{
   read(['read-tree',p.source]);
   for(const [file,value]of Object.entries(changes)){
    if(value===null){read(['update-index','--index-info'],Buffer.from(`0 ${'0'.repeat(40)}\t${file}\n`));continue;}
    const blob=read(['hash-object','-w','--stdin'],value.content??value).toString().trim();
    read(['update-index','--add','--cacheinfo',`${value.mode||'100644'},${blob},${file}`]);
   }
   return read(['commit-tree',read(['write-tree']).toString().trim(),'-p',parent],Buffer.from('Synthetic autonomy launcher continuation boundary\n')).toString().trim();
  };
  const accepted=commit(reviewed);assertCanvasPreflightTree(accepted,read,p);
  for(const file of ['workers/auth/src/routes/canvas-agent.js','workers/auth/migrations/0107_canvas_agent_autonomy.sql','workers/shared/canvas-agent-plan.mjs','js/pages/canvas/agent.js','tests/canvas.spec.js','tests/helpers/canvas-agent-autonomy-ui.cjs','tests/helpers/q2-runtime/canvas-agent.mjs','services/homepage-ffmpeg-processor/canvas-full-video.mjs','package.json','package-lock.json','.github/workflows/static.yml','config/release-validation.yml','config/release-compat.json','scripts/lib/ci-test-selection.mjs','docs/runbooks/REGRESSION_REGISTER.md'])
   assert.throws(()=>assertCanvasPreflightTree(commit({...reviewed,[file]:Buffer.from('Unrelated change')}),read,p));
  for(const changes of [{},{[fixture]:fixed},{[doc]:fixedDoc}])assert.throws(()=>assertCanvasPreflightTree(commit(changes),read,p),'Both reviewed corrections are required');
  for(const file of [fixture,doc])for(const value of [Buffer.from('Unreviewed correction'),read(['show',`${p.source}:${file}`])])assert.throws(()=>assertCanvasPreflightTree(commit({...reviewed,[file]:value}),read,p));
  for(const value of [null,{mode:'120000',content:Buffer.from('outside')}])assert.throws(()=>assertCanvasPreflightTree(commit({...reviewed,'scripts/local-release.mjs':value}),read,p));
  assert.throws(()=>assertCanvasPreflightTree(commit(reviewed,accepted),read,p),'A later descendant is not the closed direct successor');
  assert.throws(()=>canvasPreflightPrefix(Buffer.from(JSON.stringify({sha:p.source})),{sha:accepted},read));
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}

 const before=Array.from({length:27},(_,index)=>({title:index===0?title:`Previously passed launcher ${index}`,status:index===0?'failed':'passed'}));
 const after=[{title,status:'passed'}];verifyNativeCaseUnion(before,after,[title]);
 for(const rows of [[],[{title,status:'failed'}],[{title,status:'skipped'}],[...after,...after],[...after,before[1]],[{title:'Foreign launcher',status:'passed'}],[...after,{title:'Foreign skipped launcher',status:'skipped'}]])
  assert.throws(()=>verifyNativeCaseUnion(before,rows,[title]));
 for(const rows of [before.slice(1),[...before,before[1]],before.map((row,index)=>index===0?{...row,status:'passed'}:row),before.map((row,index)=>index===1?{...row,status:'failed'}:row)])
  assert.throws(()=>verifyNativeCaseUnion(rows,after,[title]));
 assert.throws(()=>autonomyNativeContinuation('echo omitted Worker branch'));
 // Exercise only shell sequencing with a local stub: no suite, provider or
 // native runner is invoked, and a failed boundary must prevent its successors.
 const flow=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-autonomy-native-flow-'));
 try{
  const shell=autonomyNativeContinuation('if false; then\n  exit 99\nelse\n  npm run test:workers\nfi\n');
  const stub=`set -e\nnode() {\n case "$1:$2" in\n scripts/local-release.mjs:verify-autonomy-native-pending) stage=pending;;\n --test:*) stage=launcher; printf '%s\\n' 'Synthetic launcher diagnostic';;\n scripts/local-release.mjs:verify-autonomy-native-repair) stage=proof;;\n scripts/test-q2-runtime.mjs:) stage=native;;\n *) return 98;;\n esac\n printf '%s\\n' "$stage" >> "$TRACE"\n if [ "$stage" = "$FAIL_STAGE" ]; then return 61; fi\n}\n`;
  const stages=['pending','launcher','proof','native'];
  for(const failed of ['',...stages]){
   const trace=path.join(flow,'trace');fs.rmSync(trace,{force:true});fs.rmSync(path.join(flow,'.local-release'),{recursive:true,force:true});
   const result=spawnSync('/bin/bash',['-c',stub+shell],{cwd:flow,env:{...process.env,TRACE:trace,FAIL_STAGE:failed},encoding:'utf8'});
   assert.equal(result.status,failed?61:0,result.stderr);
   assert.deepEqual(fs.readFileSync(trace,'utf8').trim().split('\n'),failed?stages.slice(0,stages.indexOf(failed)+1):stages);
   if(failed==='launcher')assert.match(fs.readFileSync(path.join(flow,'.local-release/test-results/autonomy-launcher-fresh.tap'),'utf8'),/Synthetic launcher diagnostic/);
  }
 }finally{fs.rmSync(flow,{recursive:true,force:true});}

 const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 const parents=execFileSync('git',['rev-list','--parents','-n','1',head],{encoding:'utf8'}).trim().split(/\s+/);
 if(parents.length===2&&parents[1]===p.source){
  // Actual private failed evidence is staged by the single resumed release
  // caller. It is never a committed fixture or rewritten as a historical pass.
  const root='.local-release',checkpoint=path.join(root,'reuse/preflight-checkpoint.json');
  assert(fs.existsSync(checkpoint),'Autonomy continuation requires its actual source checkpoint');
  const bytes=fs.readFileSync(checkpoint),original=JSON.parse(bytes);
  const selection=gitSelection(original.base,head),commands=selectedCommands(selection,{GITHUB_SHA:head,CANDIDATE_BASE:original.base});
  const context={sha:head,base:original.base,planHash:validationPlan().digest,selection,environment:original.environment,commands};
  assert.equal(commands.length,53);assert.equal(canvasPreflightPrefix(bytes,context).sha,p.source);
  for(const change of [r=>r.status='passed',r=>r.sha='f'.repeat(40),r=>r.commands[41].exitCode=0,r=>r.commands[0].exitCode=1,r=>r.commands[1].logHash='changed',r=>r.commands.pop(),r=>r.commands[1].reusedFrom='foreign']){
   const broken=structuredClone(original);change(broken);assert.throws(()=>canvasPreflightPrefix(Buffer.from(JSON.stringify(broken)),context));
  }
  for(const change of [r=>r.base='b'.repeat(40),r=>r.planHash='changed',r=>r.environment.key='changed',r=>r.environment.image='changed',r=>r.selection.full=!r.selection.full,r=>r.commands.pop(),r=>r.commands[41].run='echo skipped',r=>r.commands[49].run='echo skipped']){
   const broken=structuredClone(context);change(broken);assert.throws(()=>canvasPreflightPrefix(bytes,broken));
  }
  const proof=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-autonomy-native-proof-'));
  try{
   fs.mkdirSync(path.join(proof,'reuse'));fs.mkdirSync(path.join(proof,'test-results'));
   for(const file of ['preflight-checkpoint.json','preflight-failed.log'])fs.copyFileSync(path.join(root,'reuse',file),path.join(proof,'reuse',file));
   const verify=()=>verifyAutonomyNativeRepair(proof,head);
   assert.equal(verifyAutonomyNativeRepair(proof,head,{allowPending:true}).result,null);
   assert.throws(verify,'Retained Worker/processor/26 launcher passes cannot replace the failed launcher or unexecuted native tail');
   const source=fs.readFileSync(path.join(proof,'reuse/preflight-failed.log'),'utf8');
   const originalLauncher=tapResults(source.slice(source.lastIndexOf('TAP version 13')));
   assert.equal(originalLauncher.length,27);assert.equal(originalLauncher.filter(row=>row.status==='passed').length,26);
   assert.deepEqual(originalLauncher.filter(row=>row.status!=='passed'),[{title,status:'failed'}]);
   const reportFile=path.join(proof,'test-results/autonomy-launcher-fresh.tap');
   const tap=rows=>['TAP version 13',...rows.flatMap((row,index)=>[`# Subtest: ${row.title}`,`${row.status==='failed'?'not ok':'ok'} ${index+1} - ${row.title}${row.status==='skipped'?' # SKIP test name does not match pattern':''}`]),`1..${rows.length}`,`# tests ${rows.length}`,'# suites 0',`# pass ${rows.filter(row=>row.status==='passed').length}`,`# fail ${rows.filter(row=>row.status==='failed').length}`,'# cancelled 0',`# skipped ${rows.filter(row=>row.status==='skipped').length}`,'# todo 0',''].join('\n');
   const accepted=tap(after),save=value=>fs.writeFileSync(reportFile,value);
   // Synthetic fresh TAP calibrates only this verifier. Actual publication
   // still requires the separately executed failed case and native tail.
   save(accepted);const expected={workerPassed:1471,processorPassed:true,launcherRetained:26,launcherFresh:1,launcherTotal:27};assert.deepEqual(verify().result,expected);
   for(const rows of [[],[{title,status:'failed'}],[{title,status:'skipped'}],[...after,...after],[...after,originalLauncher.find(row=>row.status==='passed')],[{title:'Foreign launcher result',status:'passed'}],[...after,{title:'Foreign skipped result',status:'skipped'}]]){save(tap(rows));assert.throws(verify);}
   for(const content of ['',accepted.replace('ok 1 -','not ok 1 -'),accepted.replace('# fail 0','# fail 1'),accepted.replace('# cancelled 0','# cancelled 1')]){save(content);assert.throws(verify);}
   save(accepted);
   for(const file of ['reuse/preflight-checkpoint.json','reuse/preflight-failed.log','test-results/autonomy-launcher-fresh.tap']){
    const target=path.join(proof,file),saved=fs.readFileSync(target);fs.unlinkSync(target);assert.throws(verify);fs.writeFileSync(target,'forged success');assert.throws(verify);fs.writeFileSync(target,saved);
   }
   assert.deepEqual(verify().result,expected);
   const continuation=autonomyNativeContinuation(commands[41].run);
   assert(!continuation.includes('npm run test:workers'),'The already passed full Worker chain must not repeat');
   assert(continuation.includes(`--test-name-pattern='^${title}$'`));
   assert(continuation.endsWith('  node scripts/test-q2-runtime.mjs\nfi\n'),'The unexecuted native suite must remain the final ordinary branch action');
   assert(continuation.includes('verify-autonomy-native-pending')&&continuation.includes('verify-autonomy-native-repair'));
   for(const changed of ['echo skipped',commands[41].run+'\n  npm run test:workers',commands[41].run.replace('  npm run test:workers','  echo skipped')])assert.throws(()=>autonomyNativeContinuation(changed));
   const syntax=spawnSync('/bin/bash',['-n'],{input:continuation,encoding:'utf8'});assert.equal(syntax.status,0,syntax.stderr);
   console.log('Autonomy launcher continuation: exact failed checkpoint and 1471 Worker/processor/26 launcher passes retained; missing, tampered, failed, skipped, duplicate, foreign and repeated-passed fresh inputs reject. Native runtime remains required.');
  }finally{fs.rmSync(proof,{recursive:true,force:true});}
 }
 console.log('Autonomy launcher continuation: actual Git pins the reviewed fixture and rejects product, schema, selection, environment, unrelated documentation, symlink, deletion and foreign-parent changes.');
}

{
 const {AUTONOMY_BROWSER_POLICY:policy,AUTONOMY_BROWSER_PREFLIGHT:p,AUTONOMY_BROWSER_PROGRESS:progressProfile,assertAutonomyBrowserTree,verifyAutonomyBrowserReport}=await import('./lib/local-release-browser.mjs');
 const {canvasPreflightProfile,canvasPreflightPrefix,verifyAutonomyBrowserRepair,verifyAutonomyBrowserProgress,autonomyReleasePlanContinuation,autonomyReleasePlanSource,autonomyBrowserContinuation,verifyAutonomyRetentionWorkers,autonomyRetentionContinuation}=await import('./lib/local-release-evidence.mjs');
 assert.equal(canvasPreflightProfile(p.source),p);
 assert.equal(progressProfile.source,'0f82b547f0bed2b6af78723fbba1ea835abe63ac');
 assert.deepEqual(progressProfile.retain,[13],'Only the newly completed unchanged compatibility check joins retained evidence');
 assert.deepEqual(progressProfile.specs,{'scripts/test-canvas-agent-release.mjs':'f871928546c81fc5436616a85dab3d1ead7485476209ef3e0debbeaed277a415'});
 assert.equal(autonomyReleasePlanContinuation('npm run test:release-plan'),'node scripts/local-release.mjs autonomy-release-plan-continuation');
 for(const command of ['echo skipped','npm run test:release-plan\nnpm run test:release-plan','npm run test:release-plan && echo omitted','node scripts/test-canvas-agent-release.mjs'])assert.throws(()=>autonomyReleasePlanContinuation(command));
 const planner=execFileSync('git',['show',`${progressProfile.source}:scripts/test-release-plan.mjs`]).toString(),tailSource=autonomyReleasePlanSource(planner);
 const unexecuted=planner.slice(planner.indexOf("await import('./test-canvas-agent-release.mjs');"));
 assert(tailSource.endsWith(unexecuted),'Every unexecuted planner assertion stays byte-identical and ordered');
 assert.equal(tailSource.slice(0,-unexecuted.length),planner.split('\n{\n')[0]+'\n','Only imports, paths and createContext precede the unexecuted tail');
 for(const passed of ['Seedance: reviewed custom tariff migration','Release planner tests passed.','Auth configuration: reviewed absent-to-off',"await import('./test-media-auth-config.mjs');"])assert(!tailSource.includes(passed),'Completed planner controls must not execute again');
 for(const source of [planner+'\n',planner.replace("await import('./test-canvas-agent-release.mjs');",''),planner.replace("await import('./test-canvas-agent-release.mjs');","await import('./foreign.mjs');"),tailSource])assert.throws(()=>autonomyReleasePlanSource(source));
 // Exact historical Git objects, independent of later working-tree changes.
 const blobs={
  'tests/helpers/canvas-agent-autonomy-ui.cjs':'4f19b52ef05b624842ffdf28c66a5a2643f24f63',
  'tests/helpers/canvas-audio-ui.cjs':'a63d88b4b69bb0669b08718b4746c3eecbf1291b',
  'tests/helpers/canvas-transition-examples-ui.cjs':'64f3a31b6c15b98b623cb1efb557a4563c281906',
  'scripts/lib/local-release-transport.mjs':'e80f855f06aa5b528a8be242a87ab62a91f4e4ac',
  'scripts/lib/media-publication.mjs':'bd5d9bf28f7952a26443ba3e54cbc1c9c5529bb1',
  'scripts/lib/backend-publication.mjs':'0149213630775cc74061091e5801456b5577cf30',
  'scripts/test-media-activation-reuse.mjs':'79125feaa83c36cce1595631ff3e222cf1339d2d',
  'docs/runbooks/REGRESSION_REGISTER.md':'dadc34bfa59ff0224c4c6bb14168c0d7966af18c',
  'scripts/lib/ci-test-selection.mjs':'a8b05cbafeaf17cbabfee2b548a4ce4d40e9bd05',
  'scripts/test-ci-test-selection.mjs':'a5db414ce43654cd13b69ac18f283f16beb54729',
  'workers/auth/migrations/0108_canvas_creative_export_retention.sql':'862b2ff01edbc51bd0da5b385b33ac70ce3f9b6d',
  'config/release-compat.json':'7ef4a5831921a8d534e6b0f0d96a43465bc8c31f',
  'scripts/lib/canvas-export-readiness.mjs':'905b324c51c08dae063dc26352338242b6f8c083',
  'scripts/test-q2-runtime-launcher.mjs':'a0dd10df9f94488dfbba772ea2609382d29f6777',
  'tests/q2-canvas-agent.spec.js':'a91d919ad099aa8d2f796a0e7f144e467c43e69a',
  'tests/helpers/canvas-assembly-control.mjs':'c02ea921519d6aa5d83f3b61eccc98143f15a187',
  'tests/helpers/q2-runtime/canvas.mjs':'e97ffa6ccee50ee581b6e6f4370cfcdb4161718c',
  'tests/helpers/q2-runtime/control.mjs':'12fac0838fb3557792ff8b67699e3f2f6f867a2f',
  'tests/helpers/q2-runtime/environment.mjs':'2642b8688f9ecdf9b0220749b0ca2d471f6dbcdb',
  'tests/helpers/q2-runtime/linux-bootstrap.py':'fbdb2d399fd191ee47829d82c02aa9eef572fd57',
  'tests/helpers/q2-runtime/linux-hosted.mjs':'941942c2f481141a6b727ab430499a7bcc38977b',
  'tests/helpers/q2-runtime/linux-runtime-child.mjs':'40471063a1075d9f3a7454b405efbcec51ab7e1f',
  'tests/helpers/q2-runtime/runner.mjs':'54416c24265fe65cab909deac062d1a1aab5e021',
 };
 assert.deepEqual(Object.keys(blobs).sort(),Object.keys(p.specs).sort());
 for(const index of [0,2,3,12,13,14,15,16,17,18,21,23,24,28,29,31,34,35,37,38,39,41,45,48,49,50,51,52])assert(!p.retain.includes(index),'Changed or unexecuted acceptance and candidate-state restoration must be refreshed');
 for(const index of [36,40,42,43,44,46,47])assert(p.retain.includes(index),'Unchanged completed runtime/image/HTTP acceptance stays bound to its source');
 const reviewed=Object.fromEntries(Object.entries(blobs).map(([file,blob])=>{
  const bytes=execFileSync('git',['cat-file','blob',blob]);assert.equal(sha256(bytes),p.specs[file]);return [file,bytes];
 }));
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-autonomy-browser-tree-')),bare=path.join(temporary,'git');
 const env={...process.env,GIT_AUTHOR_NAME:'Synthetic',GIT_AUTHOR_EMAIL:'synthetic@example.invalid',GIT_COMMITTER_NAME:'Synthetic',GIT_COMMITTER_EMAIL:'synthetic@example.invalid'};
 const read=(args,input)=>execFileSync('git',['--git-dir',bare,...args],{env,input,stdio:['pipe','pipe','pipe']});
 try{
  execFileSync('git',['init','--bare',bare],{stdio:'pipe'});
  fs.writeFileSync(path.join(bare,'objects/info/alternates'),path.resolve(execFileSync('git',['rev-parse','--git-path','objects'],{encoding:'utf8'}).trim())+'\n');
  const commit=(changes,parent=p.source,base=p.source)=>{
   read(['read-tree',base]);
   for(const [file,value]of Object.entries(changes)){
    if(value===null){read(['update-index','--index-info'],Buffer.from(`0 ${'0'.repeat(40)}\t${file}\n`));continue;}
    const blob=read(['hash-object','-w','--stdin'],value.content??value).toString().trim();
    read(['update-index','--add','--cacheinfo',`${value.mode||'100644'},${blob},${file}`]);
   }
   return read(['commit-tree',read(['write-tree']).toString().trim(),'-p',parent],Buffer.from('Synthetic autonomy browser continuation boundary\n')).toString().trim();
  };
  const accepted=commit(reviewed);assertAutonomyBrowserTree(accepted,read);
  for(const file of ['js/pages/canvas/agent.js','workers/auth/src/routes/canvas-agent.js','workers/auth/migrations/0103_canvas_assembly.sql','workers/auth/migrations/0999_unreviewed.sql','tests/canvas.spec.js','tests/helpers/canvas-agent-ui.cjs','package-lock.json','.github/workflows/static.yml','config/release-validation.yml','scripts/lib/ci-test-selection.mjs','scripts/lib/homepage-test-selection.mjs','README.md'])
   assert.throws(()=>assertAutonomyBrowserTree(commit({...reviewed,[file]:Buffer.from('Unrelated change')}),read));
  for(const file of Object.keys(reviewed)){
   const absent={...reviewed};delete absent[file];assert.throws(()=>assertAutonomyBrowserTree(commit(absent),read),'Every exact reviewed input is required');
   assert.throws(()=>assertAutonomyBrowserTree(commit({...reviewed,[file]:Buffer.from('Unreviewed correction')}),read));
  }
  for(const value of [null,{mode:'120000',content:Buffer.from('outside')}])assert.throws(()=>assertAutonomyBrowserTree(commit({...reviewed,'scripts/local-release.mjs':value}),read));
  assert.throws(()=>assertAutonomyBrowserTree(commit(reviewed,accepted),read),'A descendant is not the closed direct successor');
  assert.throws(()=>canvasPreflightPrefix(Buffer.from(JSON.stringify({sha:p.source})),{sha:accepted},read));
  const progress='0f82b547f0bed2b6af78723fbba1ea835abe63ac',file='scripts/test-canvas-agent-release.mjs';
  const correction=execFileSync('git',['cat-file','blob','29f5f55d7fb6dc4f9cc1fa51bccd8925fb32d02e']);
  assert.equal(sha256(correction),'f871928546c81fc5436616a85dab3d1ead7485476209ef3e0debbeaed277a415');
  const tail=changes=>commit(changes,progress,progress),fixed=tail({[file]:correction});
  assertAutonomyBrowserTree(fixed,read);
  for(const changes of [{},{[file]:Buffer.from('Unreviewed expectation')},{[file]:null},{[file]:{mode:'120000',content:Buffer.from('outside')}}])assert.throws(()=>assertAutonomyBrowserTree(tail(changes),read));
  for(const unrelated of ['js/pages/canvas/agent.js','config/release-compat.json','workers/auth/migrations/0108_canvas_creative_export_retention.sql','scripts/test-release-plan.mjs','scripts/lib/ci-test-selection.mjs'])
   assert.throws(()=>assertAutonomyBrowserTree(tail({[file]:correction,[unrelated]:Buffer.from('Unreviewed progress change')}),read));
  assert.throws(()=>assertAutonomyBrowserTree(commit({[file]:correction},fixed,progress),read),'Only the exact failed progress source can parent this correction');
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
 for(const scope of ['homepage','auth','foreign'])assert.throws(()=>autonomyBrowserContinuation('echo omitted acceptance',scope));

 const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 const parents=execFileSync('git',['rev-list','--parents','-n','1',head],{encoding:'utf8'}).trim().split(/\s+/);
 if(parents.length===2&&[p.source,'0f82b547f0bed2b6af78723fbba1ea835abe63ac'].includes(parents[1])){
  const root='.local-release',bytes=fs.readFileSync(path.join(root,'reuse/preflight-checkpoint.json')),original=JSON.parse(bytes);
  const selection=gitSelection(original.base,head),commands=selectedCommands(selection,{GITHUB_SHA:head,CANDIDATE_BASE:original.base});
  const context={sha:head,base:original.base,planHash:validationPlan().digest,selection,environment:original.environment,commands};
  assert.equal(canvasPreflightPrefix(bytes,context).sha,p.source);
  for(const change of [r=>r.status='passed',r=>r.sha='f'.repeat(40),r=>r.commands[50].exitCode=0,r=>r.commands[41].exitCode=1,r=>r.commands[40].logHash='changed',r=>r.commands.pop(),r=>delete r.preflightContinuation]){
   const broken=structuredClone(original);change(broken);assert.throws(()=>canvasPreflightPrefix(Buffer.from(JSON.stringify(broken)),context));
  }
  for(const change of [r=>r.base='b'.repeat(40),r=>r.planHash='changed',r=>r.environment.key='changed',r=>r.environment.image='changed',r=>r.selection.full=!r.selection.full,r=>r.commands.pop(),r=>r.commands[41].run='echo skipped',r=>r.commands[50].run='echo skipped']){
   const broken=structuredClone(context);change(broken);assert.throws(()=>canvasPreflightPrefix(bytes,broken));
  }
  const proof=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-autonomy-browser-proof-'));
  try{
   fs.cpSync(path.join(root,'reuse'),path.join(proof,'reuse'),{recursive:true});
   const reports=path.join(proof,'test-results');fs.mkdirSync(reports);
   fs.cpSync(path.join(root,'runtime'),path.join(proof,'runtime'),{recursive:true});
   fs.cpSync(path.join(root,'test-results/private-media-image'),path.join(reports,'private-media-image'),{recursive:true,mode:fs.constants.COPYFILE_FICLONE});
   for(const file of Object.keys(p.homepageReports))fs.copyFileSync(path.join(root,'test-results',file),path.join(reports,file));
   const verify=()=>verifyAutonomyBrowserRepair(proof,head),pending=verifyAutonomyBrowserRepair(proof,head,{allowPending:true});
   assert.equal(pending.result,null);assert.throws(verify,'Retained acceptance cannot replace the required new cases');
   if(parents[1]===progressProfile.source){
    const progress=()=>verifyAutonomyBrowserProgress(proof,head),accepted=progress();
    assert.equal(accepted.original.sha,progressProfile.source);assert.equal(accepted.original.status,'failed');assert.equal(accepted.original.commands.length,51);
    assert(accepted.original.commands.slice(0,14).every(row=>row.exitCode===0));assert.equal(accepted.original.commands[14].exitCode,1);assert.equal(accepted.original.commands[15],null);
    assert.deepEqual(accepted.retained,[13]);assert.equal(accepted.original.commands[42].reusedFrom,p.source,'The original image stays attributed to its completed e8 execution');
    for(const file of ['checkpoint.json','logs/0.log','logs/13.log','logs/14.log']){
     const target=path.join(proof,'reuse/autonomy-browser-progress',file),saved=fs.readFileSync(target);
     fs.unlinkSync(target);assert.throws(progress);assert.throws(()=>verifyAutonomyBrowserRepair(proof,head,{allowPending:true}));fs.writeFileSync(target,'{}');assert.throws(progress);fs.writeFileSync(target,saved);
    }
    const target=path.join(proof,'reuse/autonomy-browser-progress/checkpoint.json'),saved=fs.readFileSync(target);
    for(const change of [r=>r.status='passed',r=>r.commands[14].exitCode=0,r=>r.commands[13].exitCode=1,r=>r.commands[13].logHash='foreign',r=>r.commands[15]=r.commands[13],r=>r.commands[42].reusedFrom=progressProfile.source,r=>delete r.preflightContinuation]){
     const broken=JSON.parse(saved);change(broken);fs.writeFileSync(target,JSON.stringify(broken));assert.throws(progress);fs.writeFileSync(target,saved);
    }
    assert.deepEqual(progress().retained,[13]);
   }
   const previous=pending.previous,discovery=previous.map(({key,file,title,project})=>({key,file,title,project}));
   const changed=previous.filter(row=>row.file==='canvas.spec.js'&&(/^Canvas autonomy (en|de): persisted budget_edits$/.test(row.title)||/^Canvas editable film (en|de): rerun remove reorder sound export reopen$/.test(row.title)||/^Canvas asset audio (en|de): typed references, persistent controls and real export$/.test(row.title)||(row.project==='webkit-canvas'&&row.title==='Canvas transition examples de: isolated illustrations and motion controls')));
   const changedDefinitions=['chromium','webkit-canvas'].flatMap(project=>['en','de'].flatMap(locale=>[[project,`Canvas autonomy ${locale}: persisted budget_edits`],[project,`Canvas editable film ${locale}: rerun remove reorder sound export reopen`],[project,`Canvas asset audio ${locale}: typed references, persistent controls and real export`]]));
   changedDefinitions.push(['webkit-canvas','Canvas transition examples de: isolated illustrations and motion controls']);
   assert.deepEqual(changed.map(row=>[row.project,row.title]).sort(),changedDefinitions.sort());
   const changedKeys=new Set(changed.map(row=>row.key)),retained=new Map(previous.filter(row=>passedBrowserCase(row)&&!changedKeys.has(row.key)).map(row=>[row.key,row]));
   const passed=row=>({...row,expectedStatus:'passed',status:'expected',results:[{status:'passed',retry:0,error:false}]});
   const fresh=discovery.filter(row=>!retained.has(row.key)).map(passed);
   assert(changed.every(row=>fresh.some(item=>item.key===row.key)),'Changed passing definitions also require fresh execution');
   const report={policy,sha:head,source:p.source,scope:'homepage',previous,discovery,fresh,counts:verifyBrowserUnion(discovery,retained,fresh)};
   assert.deepEqual(report.counts,{required:586,reused:573,executed:13});assert.equal(p.required,586);
   assert.equal(previous.filter(passedBrowserCase).length,578,'Original retries and failures are not direct successes');
   const rawRows=rows=>({config:{workers:1},suites:[{title:'Synthetic verifier controls',specs:rows.map(row=>({id:row.key.slice(row.project.length+1),file:row.file,title:row.title,line:1,column:1,tests:[{projectName:row.project,expectedStatus:row.expectedStatus,status:row.status,results:row.results}]}))}],errors:[],stats:{expected:rows.length,unexpected:0,flaky:0,skipped:0}});
   const save=(file,value)=>fs.writeFileSync(path.join(reports,file),JSON.stringify(value,null,2));
   save('autonomy-browser-discovery.json',rawRows(discovery));save('autonomy-browser-fresh.json',rawRows(fresh));save('candidate-homepage.json',report);
   assert.deepEqual(verifyAutonomyBrowserReport(report,head),report.counts);assert.throws(verify,'Core proof alone cannot substitute unexecuted Auth/native acceptance');
   const standard=JSON.parse(fs.readFileSync(path.join(proof,'reuse/autonomy-browser-standard.json')));
   const authDiscovery=browserRows(standard,{discovery:true}).filter(row=>row.project==='chromium'&&(/^(auth-admin|wallet-nav|locale|oma2-q1-member)\.spec\.js$/.test(row.file)||/^oma2-q3-.*\.spec\.js$/.test(row.file)));
   assert.equal(authDiscovery.length,709);assert.equal(sha256(JSON.stringify(authDiscovery)),p.authDiscovery);
   const overlap=authDiscovery.filter(row=>retained.has(row.key));assert.equal(overlap.length,25);assert(overlap.every(row=>row.file==='locale.spec.js'&&row.project==='chromium'));
   const authFresh=authDiscovery.filter(row=>!retained.has(row.key)).map(passed),auth={...report,scope:'auth',discovery:authDiscovery,fresh:authFresh,counts:{required:709,reused:25,executed:684}};
   save('autonomy-browser-auth-discovery.json',rawRows(authDiscovery));save('autonomy-browser-auth-fresh.json',rawRows(authFresh));save('candidate-auth.json',auth);
   assert.deepEqual(verifyAutonomyBrowserReport(auth,head),auth.counts);
   assert.throws(verify,'Both browser scopes still cannot replace the new Worker/native boundaries');
   // Source labels are actual immutable Worker passes. The two new synthetic
   // rows and native reports below calibrate validation, never release acceptance.
   const oldWorkerLog=fs.readFileSync(path.join(proof,'reuse/autonomy-native-origin/reuse/preflight-failed.log'),'utf8');
   const oldLabels=oldWorkerLog.split('\n').flatMap(line=>{const match=line.match(/^\s+✓\s+\d+\s+(tests\/.*?)\s+\([\d.]+(?:ms|s|m)\)\s*$/);return match?[match[1].replace(/:\d+:\d+(?= › )/,'')]:[];});
   assert.equal(oldLabels.length,1471);
   const workerDiscovery=oldLabels.map((label,index)=>{const at=label.indexOf(' › ');assert(at>6);return {key:':retained-'+index,project:'',file:label.slice(6,at),title:label.slice(at+3)};});
   const newWorkers=['Canvas native control canvasAssemblyRetentionCase','Canvas assembly retention migration preserves historical export dispositions'].map((title,index)=>passed({key:':retention-'+index,project:'',file:'q2-canvas-agent.spec.js',title}));
   const allWorkers=rawRows([...workerDiscovery,...newWorkers]);save('autonomy-retention-discovery.json',allWorkers);
   assert.equal(verifyAutonomyRetentionWorkers(proof,head,{allowPending:true}).result,null);assert.throws(()=>verifyAutonomyRetentionWorkers(proof,head));
   save('autonomy-retention-workers.json',rawRows(newWorkers));
   const workerCounts={workerRetained:1471,workerFresh:2,workerTotal:1473};assert.deepEqual(verifyAutonomyRetentionWorkers(proof,head).result,workerCounts);
   const launcherTitles=['Canvas reference fixture reads the staged bytes from a non-repository cwd','focused native scopes dispatch through the actual child and preserve boundaries'];
   const launcher=['TAP version 13',...launcherTitles.map((title,index)=>`ok ${index+1} - ${title}`),'1..2','# tests 2','# suites 0','# pass 2','# fail 0','# cancelled 0','# skipped 0','# todo 0',''].join('\n');
   fs.writeFileSync(path.join(reports,'autonomy-retention-launcher.tap'),launcher);
   const nativeReference='/tmp/bitbi-release/q2-runtime-evidence/synthetic-retention-verifier',nativeRoot=path.join(proof,'runtime/q2-runtime-evidence/synthetic-retention-verifier');
   fs.mkdirSync(path.join(nativeRoot,'reports'),{recursive:true});
   const nativeSave=(file,value)=>fs.writeFileSync(path.join(nativeRoot,file),JSON.stringify(value));
   const nativeNames=['canvas_assembly_retention_populated_migration','canvas_assembly_completed_delivery_retention'];
   const nativeResult={failedSuites:0,passed:2,reports:[{suite:'canvas-retention',failure:null,records:nativeNames.map(name=>({name,status:'PASS'}))}]};
   nativeSave('launcher-result.json',{origin:'development-mac-v1',status:0,failure:null,childBoundaryVerified:true,postcheckFailures:[],mode:'runtime'});
   for(const file of ['isolation-result.json','isolation-final.json'])nativeSave('reports/'+file,{passed:true});
   nativeSave('reports/result.json',nativeResult);fs.writeFileSync(path.join(reports,'autonomy-retention-native.log'),JSON.stringify({q2LinuxEvidence:nativeReference})+'\n');
   const expected={homepage:report.counts,auth:auth.counts,retention:{...workerCounts,nativeRetained:308,nativeFresh:2,launcherFresh:2}};
   assert.deepEqual(verify().result,expected);
   for(const change of [r=>r.suites[0].specs.pop(),r=>r.suites[0].specs.push(r.suites[0].specs[0]),r=>r.suites[0].specs[0].title='Foreign retained definition',r=>r.suites[0].specs.at(-1).title='Foreign new definition',r=>r.suites[0].specs.at(-1).file='foreign.spec.js']){
    const broken=structuredClone(allWorkers);change(broken);save('autonomy-retention-discovery.json',broken);assert.throws(()=>verifyAutonomyRetentionWorkers(proof,head,{allowPending:true}));save('autonomy-retention-discovery.json',allWorkers);
   }
   for(const rows of [[],newWorkers.slice(1),[...newWorkers,newWorkers[0]],[newWorkers[0],passed(workerDiscovery[0])],newWorkers.map((row,index)=>index?row:{...row,title:'Foreign new case'}),newWorkers.map((row,index)=>index?row:{...row,results:[{status:'passed',retry:1,error:false}]}),newWorkers.map((row,index)=>index?row:{...row,status:'skipped',results:[{status:'skipped',retry:0,error:false}]})]){
    save('autonomy-retention-workers.json',rawRows(rows));assert.throws(()=>verifyAutonomyRetentionWorkers(proof,head));save('autonomy-retention-workers.json',rawRows(newWorkers));
   }
   for(const changed of [launcher.replace('ok 1 -','not ok 1 -'),launcher.replace(launcherTitles[0],'Foreign launcher'),launcher.replace('# pass 2','# pass 1'),launcher+'ok 3 - Foreign skipped launcher # SKIP\n']){
    fs.writeFileSync(path.join(reports,'autonomy-retention-launcher.tap'),changed);assert.throws(verify);fs.writeFileSync(path.join(reports,'autonomy-retention-launcher.tap'),launcher);
   }
   for(const change of [r=>r.failedSuites=1,r=>r.reports[0].records.pop(),r=>r.reports[0].records.push(r.reports[0].records[0]),r=>r.reports[0].records[0].name='Foreign native case',r=>r.reports[0].records[0].status='SKIP',r=>r.reports[0].failure={message:'Actual native failure'}]){
    const broken=structuredClone(nativeResult);change(broken);nativeSave('reports/result.json',broken);assert.throws(verify);nativeSave('reports/result.json',nativeResult);
   }
   for(const [file,change]of [['launcher-result.json',r=>r.childBoundaryVerified=false],['launcher-result.json',r=>r.postcheckFailures.push('Network boundary failed')],['reports/isolation-result.json',r=>r.passed=false],['reports/isolation-final.json',r=>r.passed=false]]){
    const target=path.join(nativeRoot,file),saved=JSON.parse(fs.readFileSync(target)),broken=structuredClone(saved);change(broken);nativeSave(file,broken);assert.throws(verify);nativeSave(file,saved);
   }
   assert.deepEqual(verify().result,expected);
   const candidate=(core=report,account=auth)=>candidateProof({sha:head,selection:{homepage:true,auth:true}},{job:'browser-validation',readJson:file=>file.endsWith('candidate-auth.json')?account:core});
   assert.equal(candidate().tests,586+709);assert.throws(()=>candidate(auth,report));
   const repeatedLocale={...auth,fresh:[...auth.fresh,previous.find(row=>row.key===overlap[0].key)]};assert.throws(()=>verifyAutonomyBrowserReport(repeatedLocale,head),'The retained Auth locale case cannot execute twice');
   assert.throws(()=>candidateProof({sha:head,selection:{}},{job:'homepage-validation',reportFile:'test-results/candidate-homepage.json',readJson:()=>report}));
   for(const accepted of [report,auth])for(const change of [r=>r.policy='foreign',r=>r.sha='f'.repeat(40),r=>r.source='f'.repeat(40),r=>r.scope='foreign',r=>r.previous.pop(),r=>r.previous.find(passedBrowserCase).results[0].status='failed',r=>r.discovery.pop(),r=>r.discovery.push(r.discovery[0]),r=>r.discovery[0].project='foreign',r=>r.fresh.pop(),r=>r.fresh.push(r.fresh[0]),r=>r.fresh.push(previous.find(row=>retained.has(row.key))),r=>r.fresh[0].key='foreign',r=>r.fresh[0].file='foreign.spec.js',r=>r.fresh[0].expectedStatus='failed',r=>r.fresh[0].status='skipped',r=>r.fresh[0].results[0].status='skipped',r=>r.fresh[0].results[0].status='failed',r=>r.fresh[0].results[0].retry=1,r=>r.fresh[0].results[0].error=true,r=>r.fresh[0].results.unshift({status:'failed',retry:0,error:true}),r=>r.counts.reused++,r=>delete r.fresh]){
    const broken=structuredClone(accepted);change(broken);assert.throws(()=>verifyAutonomyBrowserReport(broken,head));
   }
   const formerlyPassed=changed.filter(passedBrowserCase);assert.equal(formerlyPassed.length,5,'Changed passing definitions require fresh evidence too');
   for(const row of formerlyPassed){const broken=structuredClone(report);broken.fresh=broken.fresh.filter(item=>item.key!==row.key);broken.counts.reused++;broken.counts.executed--;assert.throws(()=>verifyAutonomyBrowserReport(broken,head),'An old pass cannot validate a changed definition');}
   for(const file of ['reuse/preflight-checkpoint.json','reuse/preflight-failed.log','reuse/autonomy-browser-original.json','reuse/autonomy-browser-standard.json','reuse/autonomy-native-origin/reuse/preflight-checkpoint.json','reuse/autonomy-native-origin/reuse/preflight-failed.log','reuse/autonomy-native-origin/test-results/autonomy-launcher-fresh.tap','reuse/autonomy-native-origin/logs/41.log','test-results/autonomy-browser-discovery.json','test-results/autonomy-browser-fresh.json','test-results/candidate-homepage.json','test-results/autonomy-browser-auth-discovery.json','test-results/autonomy-browser-auth-fresh.json','test-results/candidate-auth.json','test-results/autonomy-retention-discovery.json','test-results/autonomy-retention-workers.json','test-results/autonomy-retention-launcher.tap','test-results/autonomy-retention-native.log','test-results/private-media-image/image.json','test-results/private-media-image/test.log','runtime/q2-runtime-evidence/synthetic-retention-verifier/launcher-result.json','runtime/q2-runtime-evidence/synthetic-retention-verifier/reports/isolation-result.json','runtime/q2-runtime-evidence/synthetic-retention-verifier/reports/isolation-final.json','runtime/q2-runtime-evidence/synthetic-retention-verifier/reports/result.json',...Object.keys(p.nativeProof),...Object.keys(p.homepageReports).map(file=>'test-results/'+file)]){
    const target=path.join(proof,file),saved=fs.readFileSync(target);fs.unlinkSync(target);assert.throws(verify);fs.writeFileSync(target,'{}');assert.throws(verify);fs.writeFileSync(target,saved);
   }
   for(const [file,rows]of [['autonomy-browser-fresh.json',fresh],['autonomy-browser-auth-fresh.json',authFresh]])for(const change of [r=>r.config.workers=2,r=>delete r.config.workers,r=>r.errors.push({message:'Synthetic error'}),r=>r.suites[0].specs[0].id='foreign',r=>r.suites[0].specs[0].tests[0].results[0].retry=1,r=>{r.suites[0].specs.pop();r.stats.expected--;},r=>{const t=r.suites[0].specs[0].tests[0];t.status='skipped';t.results[0].status='skipped';r.stats.expected--;r.stats.skipped++;}]){
    const broken=structuredClone(rawRows(rows));change(broken);save(file,broken);assert.throws(verify);save(file,rawRows(rows));
   }
   assert.equal(autonomyBrowserContinuation(commands[50].run),'node scripts/local-release.mjs autonomy-browser-continuation');
   const ordinaryAuth='PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/candidate-auth.json npm run test:auth -- --output=test-results/browser-artifacts --reporter=list,json';
   const continuedAuth=autonomyBrowserContinuation(commands[51].run,'auth');
   assert.equal(continuedAuth,commands[51].run.replace(ordinaryAuth,'node scripts/local-release.mjs autonomy-browser-continuation auth'));assert(!continuedAuth.includes('npm run test:auth'));
   for(const changed of ['echo skipped',commands[50].run+'\nnpm run test:homepage-core',commands[50].run.replace('--reporter=list,json','--reporter=list')])assert.throws(()=>autonomyBrowserContinuation(changed));
   for(const changed of ['echo skipped',commands[51].run+'\n'+ordinaryAuth,commands[51].run.replace(ordinaryAuth,'echo skipped')])assert.throws(()=>autonomyBrowserContinuation(changed,'auth'));
   const syntax=spawnSync('/bin/bash',['-n'],{input:continuedAuth,encoding:'utf8'});assert.equal(syntax.status,0,syntax.stderr);
   const retentionCommand=autonomyRetentionContinuation(commands[41].run);
   assert(!retentionCommand.includes('npm run test:workers'));assert(!retentionCommand.includes('npm run test:homepage-ffmpeg-processor'));assert(!retentionCommand.includes('npm run test:q2-runtime'));
   for(const title of [...newWorkers.map(row=>row.title),...launcherTitles])assert(retentionCommand.includes(title));
   assert(retentionCommand.includes('--workers=1 --retries=0'));assert(retentionCommand.includes('node scripts/test-q2-runtime.mjs --suite canvas-retention'));
   for(const changed of ['echo skipped',commands[41].run+'\n  npm run test:workers',commands[41].run.replace('  npm run test:workers','  echo skipped')])assert.throws(()=>autonomyRetentionContinuation(changed));
   assert.deepEqual(verify().result,expected);
   console.log('Autonomy browser continuation: exact source chain, changed-definition refresh, original failure retention, scope union and missing/foreign/skipped/retried/duplicate evidence controls. Synthetic fresh rows test the verifier only.');
  }finally{fs.rmSync(proof,{recursive:true,force:true});}
 }
 console.log('Autonomy browser continuation: actual isolated Git rejects missing or unreviewed pins, product/schema/selection changes, deletion, symlink and foreign ancestry.');
}

async function testAutonomyDocProgress() {
 const {AUTONOMY_BROWSER_PREFLIGHT:base,AUTONOMY_BROWSER_PROGRESS:planner,AUTONOMY_BROWSER_DOC_PROGRESS:p,assertAutonomyBrowserTree}=await import('./lib/local-release-browser.mjs');
 const {verifyAutonomyBrowserDocProgress,autonomyDocGuardContinuation,autonomyDocSelectionContinuation,autonomyDocInventoryContinuation}=await import('./lib/local-release-evidence.mjs');
 assert.equal(p.source,'6373ce25c5e8a646966c3747b8c4bec4bc46b193');
 assert.deepEqual(p.retain,[13,14,15,18,21,23,24]);
 const current=fs.readFileSync('scripts/test-local-release.mjs','utf8'),entry="if(process.argv.includes('--autonomy-doc-progress-only')) {\n  assert.deepEqual(process.argv.slice(2),['--autonomy-doc-progress-only']);\n  await testAutonomyDocProgress();process.exit(0);\n}\n\n";
 assert.equal(current.slice(0,current.indexOf('\nasync function testAutonomyDocProgress() {')).replace(entry,''),execFileSync('git',['show',`${p.source}:scripts/test-local-release.mjs`]).toString(),'Previously passed guard groups must remain byte-identical');
 assert.equal(autonomyDocGuardContinuation('npm run test:local-release'),'npm run test:local-release -- --autonomy-doc-progress-only');
 for(const command of ['echo skipped','npm run test:local-release -- --repair-only','npm run test:local-release\nnpm run test:local-release'])assert.throws(()=>autonomyDocGuardContinuation(command));
 assert.equal(autonomyDocSelectionContinuation('npm run test:ci-selection'),'npm run test:ci-selection -- --doc-inventory-only');
 for(const command of ['echo skipped','npm run test:ci-selection\nnpm run test:ci-selection','npm run test:ci-selection -- --unreviewed'])assert.throws(()=>autonomyDocSelectionContinuation(command));
 assert.equal(autonomyDocInventoryContinuation('npm run test:doc-currentness'),'node scripts/test-doc-currentness.mjs --local-release-inventory-only');
 for(const command of ['echo skipped','npm run test:doc-currentness\nnpm run test:doc-currentness','npm run test:doc-currentness -- --unreviewed'])assert.throws(()=>autonomyDocInventoryContinuation(command));
 const blobs={
  'scripts/lib/doc-currentness.mjs':'d8f420a03c576d50f8e2db4144a4230bf3ad6394',
  'scripts/test-doc-currentness.mjs':'c918339375fe8904527bc04959b8c67103fa4ec6',
  'scripts/lib/ci-test-selection.mjs':'674556fe37ef9fe8d6b363c48f57bab122d351ff',
  'scripts/test-ci-test-selection.mjs':'22121e383b0ecda8d14680f4063b574525aacdb7',
  'docs/runbooks/REGRESSION_REGISTER.md':'a3ed37f71e0529f03e3142e7e112631fd0622a9a',
 };
 assert.deepEqual(Object.keys(blobs).sort(),Object.keys(p.specs).sort());
 const reviewed=Object.fromEntries(Object.entries(blobs).map(([file,blob])=>{const bytes=execFileSync('git',['cat-file','blob',blob]);assert.equal(sha256(bytes),p.specs[file]);return [file,bytes];}));
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-autonomy-doc-progress-')),bare=path.join(temporary,'git');
 const env={...process.env,GIT_AUTHOR_NAME:'Synthetic',GIT_AUTHOR_EMAIL:'synthetic@example.invalid',GIT_COMMITTER_NAME:'Synthetic',GIT_COMMITTER_EMAIL:'synthetic@example.invalid'};
 const read=(args,input)=>execFileSync('git',['--git-dir',bare,...args],{env,input,stdio:['pipe','pipe','pipe']});
 try {
  execFileSync('git',['init','--bare',bare],{stdio:'pipe'});
  fs.writeFileSync(path.join(bare,'objects/info/alternates'),path.resolve(execFileSync('git',['rev-parse','--git-path','objects'],{encoding:'utf8'}).trim())+'\n');
  const commit=(changes,parent=p.source)=>{
   read(['read-tree',p.source]);
   for(const [file,value]of Object.entries(changes)){
    if(value===null){read(['update-index','--index-info'],Buffer.from(`0 ${'0'.repeat(40)}\t${file}\n`));continue;}
    const blob=read(['hash-object','-w','--stdin'],value.content??value).toString().trim();read(['update-index','--add','--cacheinfo',`${value.mode||'100644'},${blob},${file}`]);
   }
   return read(['commit-tree',read(['write-tree']).toString().trim(),'-p',parent],Buffer.from('Synthetic closed documentation continuation\n')).toString().trim();
  };
  const accepted=commit(reviewed);assertAutonomyBrowserTree(accepted,read);
  for(const file of Object.keys(reviewed)){
   const absent={...reviewed};delete absent[file];assert.throws(()=>assertAutonomyBrowserTree(commit(absent),read));
   for(const value of [null,Buffer.from('Unreviewed bytes'),{mode:'120000',content:Buffer.from('outside')}])assert.throws(()=>assertAutonomyBrowserTree(commit({...reviewed,[file]:value}),read));
  }
  for(const file of ['js/pages/canvas/agent.js','workers/auth/src/routes/canvas-agent.js','config/release-compat.json','workers/auth/migrations/0108_canvas_creative_export_retention.sql','tests/helpers/canvas-agent-autonomy-ui.cjs','scripts/test-release-plan.mjs','.github/workflows/static.yml','package-lock.json'])assert.throws(()=>assertAutonomyBrowserTree(commit({...reviewed,[file]:Buffer.from('Unrelated change')}),read));
  assert.throws(()=>assertAutonomyBrowserTree(commit(reviewed,accepted),read));
  assert.throws(()=>assertAutonomyBrowserTree(commit(reviewed,planner.source),read));
  const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();assertAutonomyBrowserTree(head);
  const proof=path.join(temporary,'proof');fs.cpSync('.local-release/reuse',path.join(proof,'reuse'),{recursive:true});
  const verify=()=>verifyAutonomyBrowserDocProgress(proof,head),progress=verify();
  assert.equal(progress.original.sha,p.source);assert.equal(progress.original.status,'failed');assert.equal(progress.original.commands.length,51);
  assert(progress.original.commands.slice(0,29).every(row=>row.exitCode===0));assert.equal(progress.original.commands[29].exitCode,1);assert.equal(progress.original.commands[31],null);
  assert.equal(progress.original.commands[13].reusedFrom,planner.source);assert.equal(progress.original.commands[42].reusedFrom,base.source);assert.deepEqual(progress.retained,p.retain);
  for(const file of ['reuse/autonomy-browser-doc-progress/checkpoint.json','reuse/autonomy-browser-doc-progress/logs/14.log','reuse/autonomy-browser-doc-progress/logs/17.log','reuse/autonomy-browser-doc-progress/logs/29.log','reuse/autonomy-browser-progress/checkpoint.json','reuse/autonomy-browser-progress/logs/14.log','reuse/preflight-checkpoint.json']){
   const target=path.join(proof,file),saved=fs.readFileSync(target);fs.unlinkSync(target);assert.throws(verify);fs.writeFileSync(target,'{}');assert.throws(verify);fs.writeFileSync(target,saved);
  }
  const file=path.join(proof,'reuse/autonomy-browser-doc-progress/checkpoint.json'),saved=fs.readFileSync(file);
  for(const mutate of [r=>r.status='passed',r=>r.commands[29].exitCode=0,r=>r.commands[17].exitCode=1,r=>r.commands[14].continuation='npm run test:release-plan',r=>r.commands[31]=r.commands[28],r=>r.commands[42].reusedFrom=p.source,r=>delete r.preflightProgress]){
   const wrong=JSON.parse(saved);mutate(wrong);fs.writeFileSync(file,JSON.stringify(wrong));assert.throws(verify);fs.writeFileSync(file,saved);
  }
  assert.deepEqual(verify().retained,p.retain);
 } finally {fs.rmSync(temporary,{recursive:true,force:true});}
 console.log('Autonomy documentation continuation: exact source chain, completed checks and original failed scanner proof; missing, altered, foreign, repeated-prefix and forged-success controls passed.');
}

async function testAutonomyWorkerSelection() {
 const {AUTONOMY_BROWSER_PREFLIGHT:base,AUTONOMY_BROWSER_WORKER_PROGRESS:p,assertAutonomyBrowserTree}=await import('./lib/local-release-browser.mjs');
 const {verifyAutonomyBrowserWorkerProgress,autonomyWorkerGuardContinuation,verifyAutonomyRetentionSelection,verifyAutonomyRetentionWorkers,autonomyRetentionContinuation}=await import('./lib/local-release-evidence.mjs');
 assert.equal(p.source,'f5816a676d00b5831d9101794d16363c53a2f914');assert.deepEqual(p.specs,{});
 assert.deepEqual(p.retain,[13,14,15,16,18,21,23,24,28,29,31]);
 const current=fs.readFileSync('scripts/test-local-release.mjs','utf8'),entry="if(process.argv.includes('--autonomy-worker-selection-only')) {\n  assert.deepEqual(process.argv.slice(2),['--autonomy-worker-selection-only']);\n  await testAutonomyWorkerSelection();process.exit(0);\n}\n\n";
 assert.equal(current.slice(0,current.indexOf('\nasync function testAutonomyWorkerSelection() {')).replace(entry,''),execFileSync('git',['show',`${p.source}:scripts/test-local-release.mjs`]).toString(),'Previously passed guard groups remain byte-identical');
 assert.equal(autonomyWorkerGuardContinuation('npm run test:local-release'),'npm run test:local-release -- --autonomy-worker-selection-only');
 for(const command of ['echo skipped','npm run test:local-release -- --repair-only','npm run test:local-release\nnpm run test:local-release'])assert.throws(()=>autonomyWorkerGuardContinuation(command));
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-autonomy-worker-selection-')),bare=path.join(temporary,'git');
 const env={...process.env,GIT_AUTHOR_NAME:'Synthetic',GIT_AUTHOR_EMAIL:'synthetic@example.invalid',GIT_COMMITTER_NAME:'Synthetic',GIT_COMMITTER_EMAIL:'synthetic@example.invalid'};
 const read=(args,input)=>execFileSync('git',['--git-dir',bare,...args],{env,input,stdio:['pipe','pipe','pipe']});
 try {
  execFileSync('git',['init','--bare',bare],{stdio:'pipe'});fs.writeFileSync(path.join(bare,'objects/info/alternates'),path.resolve(execFileSync('git',['rev-parse','--git-path','objects'],{encoding:'utf8'}).trim())+'\n');
  const commit=(file,value,parent=p.source)=>{
   read(['read-tree',p.source]);
   if(value===null)read(['update-index','--index-info'],Buffer.from(`0 ${'0'.repeat(40)}\t${file}\n`));
   else{const blob=read(['hash-object','-w','--stdin'],value.content??value).toString().trim();read(['update-index','--add','--cacheinfo',`${value.mode||'100644'},${blob},${file}`]);}
   return read(['commit-tree',read(['write-tree']).toString().trim(),'-p',parent],Buffer.from('Synthetic closed Worker selection correction\n')).toString().trim();
  };
  const accepted=commit('scripts/test-local-release.mjs',Buffer.from('Synthetic tooling boundary'));assertAutonomyBrowserTree(accepted,read);
  for(const file of ['tests/q2-canvas-agent.spec.js','tests/helpers/canvas-assembly-control.mjs','workers/auth/src/routes/canvas-agent.js','workers/auth/migrations/0108_canvas_creative_export_retention.sql','config/release-compat.json','playwright.workers.config.js','package-lock.json','.github/workflows/static.yml'])assert.throws(()=>assertAutonomyBrowserTree(commit(file,Buffer.from('Unreviewed change')),read));
  for(const value of [null,{mode:'120000',content:Buffer.from('outside')}])assert.throws(()=>assertAutonomyBrowserTree(commit('scripts/test-local-release.mjs',value),read));
  assert.throws(()=>assertAutonomyBrowserTree(commit('scripts/test-local-release.mjs',Buffer.from('Foreign parent'),accepted),read));
  const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),proof=path.join(temporary,'proof');assertAutonomyBrowserTree(head);fs.cpSync('.local-release/reuse',path.join(proof,'reuse'),{recursive:true});
  const verify=()=>verifyAutonomyBrowserWorkerProgress(proof,head),progress=verify();
  assert.equal(progress.original.status,'failed');assert.equal(progress.original.sha,p.source);assert(progress.original.commands.slice(0,41).every(row=>row.exitCode===0));assert.equal(progress.original.commands[41].exitCode,1);assert.equal(progress.original.commands[45],null);assert.equal(progress.original.commands[42].reusedFrom,base.source);assert.deepEqual(progress.retained,p.retain);
  const folder=path.join(proof,'reuse/autonomy-browser-worker-progress'),full=JSON.parse(fs.readFileSync(path.join(folder,'test-results/autonomy-retention-discovery.json')));
  const failed=JSON.parse(fs.readFileSync(path.join(folder,'test-results/autonomy-retention-workers.json')));assert.equal(failed.suites.length,0);assert.equal(failed.errors.length,1);assert.match(failed.errors[0].message,/No tests found/);
  const titles=['Canvas native control canvasAssemblyRetentionCase','Canvas assembly retention migration preserves historical export dispositions'],filter=`(${titles.join('|')})$`;
  const list=grep=>{
   const args=['node_modules/playwright/cli.js','test','-c','playwright.workers.config.js','tests/q2-canvas-agent.spec.js','--grep',grep,'--list','--reporter=json'];
   const child=spawnSync(process.execPath,args,{encoding:'utf8',env:{...process.env,PLAYWRIGHT_JSON_OUTPUT_NAME:''},timeout:30000,maxBuffer:16*1024*1024});assert.ifError(child.error);assert.equal(child.signal,null);
   return {status:child.status,report:JSON.parse(child.stdout)};
  };
  const old=list('^'+filter);assert.equal(old.status,1);assert.equal(old.report.suites.length,0);assert.equal(old.report.errors.length,1);assert.match(old.report.errors[0].message,/No tests found/);
  const selected=list(filter);assert.equal(selected.status,0);assert.deepEqual(selected.report.errors,[]);
  const specs=value=>value.suites.flatMap(suite=>[...(suite.specs||[]),...specs({suites:suite.suites||[]})]);
  const actual=specs(selected.report).map(({id,file,title})=>({id,file,title})),expected=specs(full).filter(spec=>titles.includes(spec.title)).map(({id,file,title})=>({id,file,title}));
  assert.equal(actual.length,2);assert.equal(expected.length,2);assert.deepEqual(actual,expected);assert.deepEqual(actual.map(row=>row.file),['q2-canvas-agent.spec.js','q2-canvas-agent.spec.js']);assert.deepEqual(actual.map(row=>row.title),titles);
  verifyAutonomyRetentionSelection(full,selected.report);assert.throws(()=>verifyAutonomyRetentionSelection(full,old.report));
  for(const mutate of [r=>r.errors.push({message:'Discovery failed'}),r=>specs(r)[0].id='foreign',r=>specs(r)[0].file='foreign.spec.js',r=>specs(r)[0].title='Existing unrelated test',r=>r.suites[0].specs.pop(),r=>r.suites[0].specs.push(r.suites[0].specs[0])]){
   const broken=structuredClone(selected.report);mutate(broken);assert.throws(()=>verifyAutonomyRetentionSelection(full,broken));
  }
  // Synthetic completion calibrates the new file boundary only; it is never
  // written to release acceptance paths or counted as an executed Worker case.
  const simulated=structuredClone(selected.report);simulated.config.workers=1;simulated.stats={expected:2,unexpected:0,flaky:0,skipped:0};
  for(const spec of specs(simulated))for(const test of spec.tests)Object.assign(test,{expectedStatus:'passed',status:'expected',results:[{status:'passed',retry:0}]});
  const syntheticReports=path.join(proof,'test-results');fs.mkdirSync(syntheticReports);const save=(file,value)=>fs.writeFileSync(path.join(syntheticReports,file),JSON.stringify(value,null,2));
  save('autonomy-retention-discovery.json',full);save('autonomy-retention-workers.json',simulated);
  assert.throws(()=>verifyAutonomyRetentionWorkers(proof,head),'Matching execution cannot substitute the missing selection proof');
  save('autonomy-retention-selected-discovery.json',selected.report);assert.deepEqual(verifyAutonomyRetentionWorkers(proof,head).result,{workerRetained:1471,workerFresh:2,workerTotal:1473});
  save('autonomy-retention-selected-discovery.json',old.report);assert.throws(()=>verifyAutonomyRetentionWorkers(proof,head),'The original empty selection cannot authorize a fabricated successful execution');
  const continuation=autonomyRetentionContinuation(progress.original.commands[41].command.run),needle=`--grep '${filter}'`;
  assert.equal(continuation.split(needle).length,3,'Discovery and execution use the same exact corrected filter');assert(!continuation.includes(`--grep '^${filter}'`));
  assert(continuation.indexOf('verify-autonomy-retention-selection')<continuation.indexOf('PLAYWRIGHT_JSON_OUTPUT_NAME=.local-release/test-results/autonomy-retention-workers.json'),'Selected identities are admitted before any new test executes');
  const reports='.local-release/test-results';fs.mkdirSync(reports,{recursive:true});for(const [name,value]of [['old',old],['corrected',selected]])fs.writeFileSync(path.join(reports,`autonomy-worker-selection-control-${name}.json`),JSON.stringify(value,null,2));
  for(const file of ['checkpoint.json','logs/17.log','logs/29.log','logs/41.log','test-results/autonomy-retention-discovery.json','test-results/autonomy-retention-workers.json']){
   const target=path.join(folder,file),saved=fs.readFileSync(target);fs.unlinkSync(target);assert.throws(verify);fs.writeFileSync(target,'{}');assert.throws(verify);fs.writeFileSync(target,saved);
  }
  for(const file of ['reuse/autonomy-browser-doc-progress/checkpoint.json','reuse/autonomy-browser-progress/checkpoint.json','reuse/preflight-checkpoint.json']){
   const target=path.join(proof,file),saved=fs.readFileSync(target);fs.unlinkSync(target);assert.throws(verify);fs.writeFileSync(target,saved);
  }
  assert.deepEqual(verify().retained,p.retain);
 } finally {fs.rmSync(temporary,{recursive:true,force:true});}
 console.log('Autonomy Worker selection: actual CLI discovery rejects the old anchored filter and selects exactly two unchanged identities; source chains, missing/foreign/duplicate results and prior-pass preservation controls passed. No test cases executed.');
}

async function testCanvasPolicyWorkerContinuation(originalDirectory=null) {
 const {CANVAS_POLICY_WORKER_PREFLIGHT:p,canvasPreflightProfile,assertCanvasPreflightTree,canvasPreflightPrefix,
  verifyCanvasPolicyWorkerRepair,canvasPolicyWorkerContinuation,verifyCanvasPreflight,restoreCanvasHostingProof}=await import('./lib/local-release-evidence.mjs');
 assert.equal(canvasPreflightProfile(p.source),p);
 const file='tests/q2-canvas-agent-provider.spec.js',current=fs.readFileSync(file);
 const fixed=sha256(current)===p.specs[file]?current:execFileSync('git',['cat-file','blob','81df34620b2936db9956c2838d2e547e33d1f1af']);
 assert.equal(sha256(fixed),p.specs[file]);assert(!/\btest\.only\s*\(/.test(fixed.toString()));
 for(const index of [0,2,3,17,34,35,37,38,39,41,42,43,44,45,46,47,48,49,50,51])assert(!p.retain.includes(index),'Changed gates, candidate identity and unfinished tail cannot inherit passes');
 for(const index of [1,4,12,13,14,15,16,18,27,30,33,36,40])assert(p.retain.includes(index),'Unchanged completed acceptance must not repeat');
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-canvas-policy-continuation-')),bare=path.join(temporary,'git');
 const previousGitDir=process.env.GIT_DIR;
 const env={...process.env,GIT_AUTHOR_NAME:'Synthetic',GIT_AUTHOR_EMAIL:'synthetic@example.invalid',GIT_COMMITTER_NAME:'Synthetic',GIT_COMMITTER_EMAIL:'synthetic@example.invalid'};
 const read=(args,input)=>execFileSync('git',['--git-dir',bare,...args],{env,input,stdio:['pipe','pipe','pipe']});
 try {
  execFileSync('git',['init','--bare',bare],{stdio:'pipe'});
  fs.writeFileSync(path.join(bare,'objects/info/alternates'),path.resolve(execFileSync('git',['rev-parse','--git-path','objects'],{encoding:'utf8'}).trim())+'\n');
  const commit=(changes,parent=p.source)=>{
   read(['read-tree',p.source]);
   for(const [name,value]of Object.entries(changes)){
    if(value===null){read(['update-index','--index-info'],Buffer.from(`0 ${'0'.repeat(40)}\t${name}\n`));continue;}
    const blob=read(['hash-object','-w','--stdin'],value.content??value).toString().trim();
    read(['update-index','--add','--cacheinfo',`${value.mode||'100644'},${blob},${name}`]);
   }
   return read(['commit-tree',read(['write-tree']).toString().trim(),'-p',parent],Buffer.from('Synthetic closed policy correction boundary\n')).toString().trim();
  };
  const changes={[file]:fixed},head=commit(changes);assertCanvasPreflightTree(head,read,p);
  for(const name of ['workers/ai/src/index.js','workers/shared/canvas-agent/manifest.mjs','js/shared/service-auth.mjs','tests/helpers/auth-worker-harness.js','tests/canvas.spec.js','package.json','package-lock.json','playwright.workers.config.js','.github/workflows/static.yml','config/release-validation.yml','scripts/lib/ci-test-selection.mjs','docs/runbooks/REGRESSION_REGISTER.md'])
   assert.throws(()=>assertCanvasPreflightTree(commit({...changes,[name]:Buffer.from('Unrelated mutation')}),read,p));
  for(const replacement of [Buffer.from('Unreviewed assertion'),read(['show',`${p.source}:${file}`])])assert.throws(()=>assertCanvasPreflightTree(commit({[file]:replacement}),read,p));
  for(const replacement of [null,{mode:'120000',content:Buffer.from('outside')}])assert.throws(()=>assertCanvasPreflightTree(commit({...changes,'scripts/local-release.mjs':replacement}),read,p));
  assert.throws(()=>assertCanvasPreflightTree(commit(changes,head),read,p));
  assert.throws(()=>canvasPreflightPrefix(Buffer.from('{}'),{sha:head},read));
  const actualHead=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),parents=execFileSync('git',['rev-list','--parents','-n','1',actualHead],{encoding:'utf8'}).trim().split(/\s+/);
  const actualCandidate=parents.length===2&&parents[1]===p.source;
  if(originalDirectory||actualCandidate){
   const proof=path.join(temporary,'proof');fs.mkdirSync(path.join(proof,'reuse'),{recursive:true});fs.mkdirSync(path.join(proof,'test-results'));fs.mkdirSync(path.join(proof,'logs'));
   const root=originalDirectory?path.join(originalDirectory,'bundle'):'.local-release';
   if(originalDirectory){
    const copy=(from,to)=>fs.copyFileSync(from,path.join(proof,'reuse',to));
    copy(path.join(originalDirectory,'checkpoint.json'),'preflight-checkpoint.json');copy(path.join(root,'logs/41.log'),'preflight-failed.log');
    copy(path.join(originalDirectory,'original-worker-discovery.json'),'original-worker-discovery.json');copy(path.join(originalDirectory,'source/test-results/.last-run.json'),'original-worker-last-run.json');
    const native=path.resolve(originalDirectory,'../../canvas-policy-fixture-repair-61109a35');
    copy(path.join(native,'report.json'),'canvas-policy-node-report.json');copy(path.join(native,'provenance.json'),'canvas-policy-node-provenance.json');
    copy(path.join(root,'candidate/manifest.json'),'hosting-manifest.json');copy(path.join(root,'candidate/proof-frontend-runtime.json'),'hosting-proof.json');
   }else fs.cpSync(path.join(root,'reuse'),path.join(proof,'reuse'),{recursive:true});
   fs.copyFileSync(path.join(root,'test-results/frontend-runtime.log'),path.join(proof,'test-results/frontend-runtime.log'));
   fs.cpSync(path.join(root,'candidate'),path.join(proof,'candidate'),{recursive:true});
   const bytes=fs.readFileSync(path.join(proof,'reuse/preflight-checkpoint.json')),original=JSON.parse(bytes);
   const candidate=originalDirectory?head:actualHead;
   if(originalDirectory)process.env.GIT_DIR=bare;
   const selection=original.selection,commands=selectedCommands(selection,{GITHUB_SHA:candidate,CANDIDATE_BASE:original.base});
   const context={sha:candidate,base:original.base,planHash:validationPlan().digest,selection,environment:original.environment,nativeBrowsers:original.nativeBrowsers,commands};
   assert.equal(canvasPreflightPrefix(bytes,context).sha,p.source);
   const verify=()=>verifyCanvasPolicyWorkerRepair(proof,candidate);
   const pending=verifyCanvasPolicyWorkerRepair(proof,candidate,{allowPending:true});assert.equal(pending.result,null);
   assert.throws(verify,'Even the two real native Node passes require fresh complete Linux discovery');
   const previous=pending.previous,passed=row=>row.results.length===1&&row.results[0].status==='passed'&&row.results[0].retry===0;
   assert.equal(previous.length,1547);assert.equal(previous.filter(passed).length,1545);
   const rawLog=fs.readFileSync(path.join(proof,'reuse/preflight-failed.log'),'utf8'),joinedTitle='member audio save rejects non-HTTPS schemes in audioUrl payloads';
   const joinedLine=rawLog.split('\n').find(line=>line.includes(joinedTitle)&&line.includes('(1ms){'));
   assert(joinedLine,'The pinned original concurrent-log boundary must be exercised');
   const joinedCase=previous.find(row=>row.title===joinedTitle);assert(joinedCase&&passed(joinedCase));
   const identities=previous.map(({results,...identity})=>identity);
   for(const suffix of ['trailing text','{','null',JSON.stringify({service:'foreign'})])assert.throws(()=>workerListResults(rawLog.replace(joinedLine,joinedLine.slice(0,joinedLine.indexOf('(1ms)')+5)+suffix),identities));
   assert.throws(()=>workerListResults(rawLog.replace(joinedLine,''),identities),'Removing the actual result must not infer a pass from the final count');
   assert.throws(()=>workerListResults(rawLog+'\n'+joinedLine,identities),'Repeating the actual result cannot replace another case');
   const failures=previous.filter(row=>!passed(row));assert(failures.every(row=>row.results.length===2&&row.results.every(result=>result.status==='failed')));
   // Isolated verifier fixture only: the actual continuation performs --list.
   // No product test executes and no synthetic results enter release evidence.
   const discovery={config:{workers:1},suites:[{title:'Synthetic discovery identity countercheck',specs:previous.map(row=>({id:row.id,file:row.file,title:row.title,line:1,column:1,tests:[{projectName:''}]}))}],errors:[]};
   const discoveryFile=path.join(proof,'test-results/model-worker-discovery.json'),save=value=>fs.writeFileSync(discoveryFile,JSON.stringify(value,null,2));save(discovery);
   const expected={originalPassed:1545,progressPassed:2,correctedPassed:0,total:1547};assert.deepEqual(verify().result,expected);
   const union={previous,discovery:previous.map(({results,...identity})=>identity),progress:failures.map(row=>({...row,results:[{status:'passed',retry:0}]})),corrected:[]};
   assert.deepEqual(verifyWorkerUnion(union),expected);
   for(const mutate of [r=>r.previous.pop(),r=>r.discovery.pop(),r=>r.discovery.push(r.discovery[0]),r=>r.discovery[0].title='Foreign case',r=>r.progress.pop(),r=>r.progress.push(r.progress[0]),r=>r.progress.push(previous.find(passed)),r=>r.progress[0].results[0].status='failed',r=>r.progress[0].results[0].retry=1,r=>r.progress[0].results[0].error=true,r=>r.progress[0].id='foreign',r=>r.corrected.push(r.progress[0])]){const broken=structuredClone(union);mutate(broken);assert.throws(()=>verifyWorkerUnion(broken));}
   for(const name of ['preflight-checkpoint.json','preflight-failed.log','original-worker-discovery.json','original-worker-last-run.json','canvas-policy-node-report.json','canvas-policy-node-provenance.json']){
    const target=path.join(proof,'reuse',name),saved=fs.readFileSync(target);fs.unlinkSync(target);assert.throws(verify);fs.writeFileSync(target,'{}');assert.throws(verify);fs.writeFileSync(target,saved);
   }
   for(const mutate of [r=>r.suites[0].specs.pop(),r=>r.suites[0].specs.push(r.suites[0].specs[0]),r=>r.suites[0].specs[0].id='foreign',r=>r.suites[0].specs[0].title='Foreign case',r=>r.errors.push({message:'Missing discovery'})]){const broken=structuredClone(discovery);mutate(broken);save(broken);assert.throws(verify);}save(discovery);
   for(const mutate of [r=>r.status='passed',r=>r.commands[41].exitCode=0,r=>r.commands[1].exitCode=1,r=>r.commands[1].logHash='changed',r=>r.commands.pop()]){const broken=structuredClone(original);mutate(broken);assert.throws(()=>canvasPreflightPrefix(Buffer.from(JSON.stringify(broken)),context));}
   for(const mutate of [r=>r.base='b'.repeat(40),r=>r.planHash='changed',r=>r.environment.key='changed',r=>r.environment.image='changed',r=>r.environment.inputs['package-lock.json']='changed',r=>r.selection.full=true,r=>r.commands.pop(),r=>r.commands[41].run='echo skipped',r=>r.commands[48].run='echo skipped']){const broken=structuredClone(context);mutate(broken);assert.throws(()=>canvasPreflightPrefix(bytes,broken));}
   const rows=commands.map((command,index)=>{
    if(p.retain.includes(index)){const row={...original.commands[index],reusedFrom:p.source};fs.copyFileSync(path.join(root,row.log),path.join(proof,row.log));return row;}
    return {command,exitCode:0,log:`logs/${index}.log`,durationMs:1,logHash:sha256('Synthetic fresh verifier row')};
   });
   const evidence={...context,commands:rows,preflightContinuation:{source:p.source,checkpoint:p.checkpoint}};
   evidence.commands[41].continuation=canvasPolicyWorkerContinuation(commands[41].run);restoreCanvasHostingProof(proof);
   verifyCanvasPreflight(proof,evidence,commands);
   for(const index of [0,2,3,17,34,41,42,48,51]){const forged=structuredClone(evidence);forged.commands[index].reusedFrom=p.source;assert.throws(()=>verifyCanvasPreflight(proof,forged,commands));}
   for(const name of ['reuse/hosting-manifest.json','reuse/hosting-proof.json','test-results/frontend-runtime.log','logs/36.log','candidate/proof-frontend-runtime.json']){const target=path.join(proof,name),saved=fs.readFileSync(target);fs.writeFileSync(target,'forged retained proof');assert.throws(()=>verifyCanvasPreflight(proof,evidence,commands));fs.writeFileSync(target,saved);}
   const changedBrowser=structuredClone(evidence);changedBrowser.nativeBrowsers.key='changed';assert.throws(()=>verifyCanvasPreflight(proof,changedBrowser,commands));
   const candidateManifest=JSON.parse(fs.readFileSync(path.join(proof,'candidate/manifest.json'))),asset=Object.keys(candidateManifest.files).find(name=>name.endsWith('.js'));
   const assetPath=path.join(proof,'candidate/site',asset),assetBytes=fs.readFileSync(assetPath);fs.appendFileSync(assetPath,'\n// Unreviewed product bytes');assert.throws(()=>verifyCanvasPreflight(proof,evidence,commands));fs.writeFileSync(assetPath,assetBytes);
   const manifestPath=path.join(proof,'candidate/manifest.json'),manifestBytes=fs.readFileSync(manifestPath);
   fs.appendFileSync(assetPath,'\n// Unreviewed product bytes');candidateManifest.files[asset]=sha256(fs.readFileSync(assetPath));fs.writeFileSync(manifestPath,JSON.stringify(candidateManifest));
   assert.throws(()=>restoreCanvasHostingProof(proof),'Changed bytes cannot be admitted by recalculating their new manifest hash');fs.writeFileSync(assetPath,assetBytes);fs.writeFileSync(manifestPath,manifestBytes);
   assert.deepEqual(verify().result,expected);
  }
  const shell=canvasPolicyWorkerContinuation('if false; then\n  exit 99\nelse\n  npm run test:workers\nfi\n');
  assert(shell.includes('--list --reporter=json'));assert(!shell.includes('--grep')&&!shell.includes('npm run test:workers'),'No accepted Worker case may execute again');
  assert(shell.includes('npm run test:homepage-ffmpeg-processor')&&shell.includes('npm run test:q2-runtime'));
  assert.throws(()=>canvasPolicyWorkerContinuation('echo skipped'));assert.throws(()=>canvasPolicyWorkerContinuation(shell+'\nnpm run test:workers'));
  const syntax=spawnSync('/bin/bash',['-n'],{input:shell,encoding:'utf8'});assert.equal(syntax.status,0,syntax.stderr);
  const flow=path.join(temporary,'flow');fs.mkdirSync(flow);
  const stub=`set -e\nnpx() { stage=discovery; printf '%s\\n' "$stage" >> "$TRACE"; [ "$FAIL_STAGE" != "$stage" ]; }\nnode() { stage=union; printf '%s\\n' "$stage" >> "$TRACE"; [ "$FAIL_STAGE" != "$stage" ]; }\nnpm() { case "$2" in test:homepage-ffmpeg-processor) stage=media;; test:q2-runtime) stage=native;; *) return 98;; esac; printf '%s\\n' "$stage" >> "$TRACE"; [ "$FAIL_STAGE" != "$stage" ]; }\n`;
  const stages=['discovery','union','media','native'];
  for(const failed of ['',...stages]){const trace=path.join(flow,'trace');fs.rmSync(trace,{force:true});const result=spawnSync('/bin/bash',['-c',stub+shell],{cwd:flow,env:{...process.env,TRACE:trace,FAIL_STAGE:failed},encoding:'utf8'});assert.equal(result.status,failed?1:0,result.stderr);assert.deepEqual(fs.readFileSync(trace,'utf8').trim().split('\n'),failed?stages.slice(0,stages.indexOf(failed)+1):stages);}
 }finally{if(previousGitDir===undefined)delete process.env.GIT_DIR;else process.env.GIT_DIR=previousGitDir;fs.rmSync(temporary,{recursive:true,force:true});}
 console.log('Canvas policy continuation: closed Git/source/runtime/report/discovery union controls passed; original1545 Linux +2 native Node results retained honestly; media/native/browser tail remains required. No product cases executed.');
}
await testCanvasPolicyWorkerContinuation();

async function testCanvasPolicyNativeContinuation() {
 const {CANVAS_POLICY_NATIVE_PREFLIGHT:p,canvasPreflightProfile,assertCanvasPreflightTree,canvasPreflightPrefix,
  verifyCanvasPolicyNativeUnion,verifyCanvasPolicyNativeRepair,canvasPolicyNativeContinuation,verifyCanvasPreflight,restoreCanvasHostingProof}=await import('./lib/local-release-evidence.mjs');
 const {canvasPolicyPrefix,canvasPolicyTailInventory}=await import('../tests/helpers/q2-runtime/canvas-policy-tail.mjs');
 assert.equal(canvasPreflightProfile(p.source),p);
 const expected={nativeRetained:187,nativeFresh:183,nativeTotal:370,processorRetained:true,launcherRetained:27};
 const fresh=canvasPolicyTailInventory.map(name=>({name,status:'PASS'}));
 const previous=[...canvasPolicyPrefix.map(name=>({suite:'canvas',name,status:'PASS'})),...Array.from({length:183},(_,i)=>({suite:'synthetic-other',name:'retained-'+i,status:'PASS'}))];
 assert.deepEqual(verifyCanvasPolicyNativeUnion(previous,fresh),expected);
 for(const mutate of [r=>r.previous.pop(),r=>r.previous.push(r.previous[0]),r=>r.previous[0].status='FAIL',r=>r.previous[0].name='foreign-prefix',r=>r.previous[0].suite='foreign',r=>r.fresh.pop(),r=>r.fresh.shift(),r=>r.fresh.push(r.fresh[0]),r=>r.fresh[0].name='foreign',r=>r.fresh[0].status='FAIL',r=>r.fresh[0].status='SKIP',r=>r.fresh[0]=r.previous[0],r=>[r.fresh[0],r.fresh[1]]=[r.fresh[1],r.fresh[0]]]){
  const broken=structuredClone({previous,fresh});mutate(broken);assert.throws(()=>verifyCanvasPolicyNativeUnion(broken.previous,broken.fresh));
 }
 for(const i of [0,2,3,17,29,34,35,37,38,39,41,42,43,44,45,46,47,48,49,50,51])assert(!p.retain.includes(i),'Changed inputs and unfinished acceptance cannot inherit passes');
 for(const i of [1,12,16,18,28,33,36,40])assert(p.retain.includes(i),'Unchanged passed commands remain retained');
 const command='if false; then\n  exit 99\nelse\n  npm run test:workers\nfi\n',shell=canvasPolicyNativeContinuation(command);
 assert(shell.includes('set -o pipefail'));assert(shell.includes('--suite canvas-policy-tail'));
 assert(shell.includes('cp -a /tmp/bitbi-release/q2-runtime-evidence .local-release/runtime/'));
 for(const repeat of ['npm run test:workers','npm run test:homepage-ffmpeg-processor','npm run test:q2-runtime','--suite canvas\n','--grep'])assert(!shell.includes(repeat),'Completed product acceptance must not repeat');
 for(const broken of ['echo skipped',command+'  npm run test:workers',command.replace('  npm run test:workers','  echo skipped')])assert.throws(()=>canvasPolicyNativeContinuation(broken));
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-canvas-native-continuation-')),bare=path.join(temporary,'git');
 try{
  // Closed source guards use real Git trees; no product case executes here.
  const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const descendants=execFileSync('git',['rev-list','--ancestry-path','--reverse',`${p.source}..${head}`],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
  const reviewed=descendants[0];
  if(reviewed){
   execFileSync('git',['init','--bare',bare],{stdio:'pipe'});
   fs.writeFileSync(path.join(bare,'objects/info/alternates'),path.resolve(execFileSync('git',['rev-parse','--git-path','objects'],{encoding:'utf8'}).trim())+'\n');
   const env={...process.env,GIT_AUTHOR_NAME:'Synthetic',GIT_AUTHOR_EMAIL:'synthetic@example.invalid',GIT_COMMITTER_NAME:'Synthetic',GIT_COMMITTER_EMAIL:'synthetic@example.invalid'};
   const read=(args,input)=>execFileSync('git',['--git-dir',bare,...args],{env,input,stdio:['pipe','pipe','pipe']});
   const fixes=Object.fromEntries(Object.entries(p.specs).map(([file,hash])=>{const bytes=read(['show',`${reviewed}:${file}`]);assert.equal(sha256(bytes),hash);return [file,bytes];}));
   const commit=(changes,parent=p.source)=>{
    read(['read-tree',p.source]);for(const [name,value]of Object.entries(changes)){
     if(value===null){read(['update-index','--index-info'],Buffer.from(`0 ${'0'.repeat(40)}\t${name}\n`));continue;}
     const blob=read(['hash-object','-w','--stdin'],value.content??value).toString().trim();read(['update-index','--add','--cacheinfo',`${value.mode||'100644'},${blob},${name}`]);
    }
    return read(['commit-tree',read(['write-tree']).toString().trim(),'-p',parent],Buffer.from('Synthetic closed native continuation\n')).toString().trim();
   };
   const candidate=commit(fixes);assertCanvasPreflightTree(candidate,read,p);
   for(const file of ['workers/auth/src/index.js','workers/auth/migrations/0110_canvas_agent_conversation_actions.sql','tests/helpers/q2-runtime/environment.mjs','tests/helpers/canvas-assembly-control.mjs','tests/canvas.spec.js','package.json','package-lock.json','.github/workflows/static.yml','config/release-validation.yml'])
    assert.throws(()=>assertCanvasPreflightTree(commit({...fixes,[file]:Buffer.from('Unreviewed source')}),read,p));
   for(const file of Object.keys(fixes))assert.throws(()=>assertCanvasPreflightTree(commit({...fixes,[file]:Buffer.from('Changed correction')}),read,p));
   assert.throws(()=>assertCanvasPreflightTree(commit({...fixes,'scripts/local-release.mjs':null}),read,p));
   assert.throws(()=>assertCanvasPreflightTree(commit({...fixes,'scripts/local-release.mjs':{mode:'120000',content:Buffer.from('outside')}}),read,p));
   assert.throws(()=>assertCanvasPreflightTree(commit(fixes,candidate),read,p));
  }
  const parents=execFileSync('git',['rev-list','--parents','-n','1',head],{encoding:'utf8'}).trim().split(/\s+/);
  if(parents.length===2&&parents[1]===p.source){
   const root='.local-release',proof=path.join(temporary,'proof');
   fs.mkdirSync(proof);fs.cpSync(path.join(root,'reuse'),path.join(proof,'reuse'),{recursive:true});
   fs.mkdirSync(path.join(proof,'test-results'));fs.mkdirSync(path.join(proof,'logs'));
   fs.copyFileSync(path.join(root,'test-results/frontend-runtime.log'),path.join(proof,'test-results/frontend-runtime.log'));
   fs.cpSync(path.join(root,'candidate'),path.join(proof,'candidate'),{recursive:true});
   const checkpoint=fs.readFileSync(path.join(proof,'reuse/preflight-checkpoint.json')),original=JSON.parse(checkpoint);
   const selection=gitSelection(original.base,head),commands=selectedCommands(selection,{GITHUB_SHA:head,CANDIDATE_BASE:original.base});
   const context={sha:head,base:original.base,planHash:validationPlan().digest,selection,environment:original.environment,nativeBrowsers:original.nativeBrowsers,commands};
   assert.equal(canvasPreflightPrefix(checkpoint,context).sha,p.source);
   const verify=()=>verifyCanvasPolicyNativeRepair(proof,head),pending=verifyCanvasPolicyNativeRepair(proof,head,{allowPending:true});
   assert.equal(pending.result,null);assert.equal(pending.previous.length,187);assert.deepEqual(verifyCanvasPolicyNativeUnion(pending.previous,fresh),expected);
   assert.throws(verify,'The original failed native invocation cannot replace its unexecuted Canvas tail');
   const nativeOriginal=JSON.parse(fs.readFileSync(path.join(proof,'reuse/canvas-native-original/reports/bitbi-q2-runtime-kF85Dh__result.json')));
   assert.equal(nativeOriginal.failedSuites,1);assert.deepEqual(nativeOriginal.reports.find(row=>row.suite==='canvas').failure,{stage:fresh[0].name,name:'AssertionError',message:'Expected values to be strictly equal:',actual:1,expected:0});
   const guardTitle='Canvas policy tail fixes the complete actual inventory and never repeats retained callbacks';
   const guardFile=path.join(proof,'test-results/canvas-policy-native-launcher.tap');
   const guard=['TAP version 13',`# Subtest: ${guardTitle}`,`ok 1 - ${guardTitle}`,'1..1','# tests 1','# suites 0','# pass 1','# fail 0','# cancelled 0','# skipped 0','# todo 0',''].join('\n');fs.writeFileSync(guardFile,guard);
   // Synthetic fresh reports calibrate the verifier only, in this disposable
   // directory. They never enter the real release bundle or claim kernel proof.
   const relative='q2-runtime-evidence/synthetic-native-tail',runtime=path.join(proof,'runtime',relative);fs.mkdirSync(path.join(runtime,'reports'),{recursive:true});
   const write=(file,value)=>fs.writeFileSync(path.join(runtime,file),JSON.stringify(value));
   const launcher={origin:'bitbi-local-linux-v1',status:0,failure:null,childBoundaryVerified:true,postcheckFailures:[],mode:'runtime'};
   launcher.origin=JSON.parse(fs.readFileSync(path.join(proof,'reuse/canvas-native-original/launcher-result.json'))).origin;
   write('launcher-result.json',launcher);write('reports/isolation-result.json',{passed:true});write('reports/isolation-final.json',{passed:true});
   const result={failedSuites:0,passed:183,reports:[{suite:'canvas',records:fresh,failure:null}]};write('reports/result.json',result);
   const logFile=path.join(proof,'test-results/canvas-policy-native.log');fs.writeFileSync(logFile,JSON.stringify({q2LinuxEvidence:'/tmp/bitbi-release/'+relative})+'\n');
   assert.deepEqual(verify().result,expected);
   for(const file of ['preflight-checkpoint.json','preflight-failed.log','canvas-native-unit.tap','canvas-native-unit-provenance.json',...Object.keys(p.nativeProof).map(file=>'canvas-native-original/'+file),'canvas-policy-worker-origin/reuse/preflight-checkpoint.json']){
    const target=path.join(proof,'reuse',file),saved=fs.readFileSync(target);fs.unlinkSync(target);assert.throws(verify);fs.writeFileSync(target,'{}');assert.throws(verify);fs.writeFileSync(target,saved);
   }
   for(const mutate of [r=>r.status='passed',r=>r.commands[41].exitCode=0,r=>r.commands.pop(),r=>r.commands[36].logHash='changed']){const changed=structuredClone(original);mutate(changed);assert.throws(()=>canvasPreflightPrefix(Buffer.from(JSON.stringify(changed)),context));}
   for(const mutate of [r=>r.base='b'.repeat(40),r=>r.planHash='changed',r=>r.environment.key='changed',r=>r.environment.image='changed',r=>r.environment.inputs['package-lock.json']='changed',r=>r.selection.full=!r.selection.full,r=>r.commands.pop(),r=>r.commands[41].run='echo omitted']){const changed=structuredClone(context);mutate(changed);assert.throws(()=>canvasPreflightPrefix(checkpoint,changed));}
   for(const mutate of [r=>r.failedSuites=1,r=>r.passed=182,r=>r.reports[0].failure={stage:'failed'},r=>r.reports[0].suite='foreign',r=>r.reports.push(structuredClone(r.reports[0])),r=>r.reports[0].records.pop(),r=>r.reports[0].records.push(r.reports[0].records[0]),r=>r.reports[0].records[0].name=canvasPolicyPrefix[0],r=>r.reports[0].records[0].status='FAIL']){const changed=structuredClone(result);mutate(changed);write('reports/result.json',changed);assert.throws(verify);}write('reports/result.json',result);
   for(const mutate of [r=>r.status=1,r=>r.childBoundaryVerified=false,r=>r.postcheckFailures=['lost boundary'],r=>r.mode='preflight']){const changed=structuredClone(launcher);mutate(changed);write('launcher-result.json',changed);assert.throws(verify);}write('launcher-result.json',launcher);
   for(const file of ['reports/isolation-result.json','reports/isolation-final.json']){write(file,{passed:false});assert.throws(verify);write(file,{passed:true});}
   write('reports/duplicate__result.json',result);assert.throws(verify);fs.unlinkSync(path.join(runtime,'reports/duplicate__result.json'));
   for(const content of ['',guard.replace('ok 1 -','not ok 1 -'),guard.replace('# pass 1','# pass 0'),guard.replaceAll(guardTitle,'Foreign launcher result'),guard+`ok 2 - ${guardTitle}\n`]){fs.writeFileSync(guardFile,content);assert.throws(verify);}fs.writeFileSync(guardFile,guard);
   const log=fs.readFileSync(logFile);for(const content of ['',log.toString()+log.toString(),JSON.stringify({q2LinuxEvidence:'/tmp/bitbi-release/q2-runtime-evidence/../outside'})]){fs.writeFileSync(logFile,content);assert.throws(verify);}fs.writeFileSync(logFile,log);
   const rows=commands.map((command,i)=>{if(p.retain.includes(i)){const row={...original.commands[i],reusedFrom:original.commands[i].reusedFrom||p.source};fs.copyFileSync(path.join(root,row.log),path.join(proof,row.log));return row;}return {command,exitCode:0,log:`logs/${i}.log`,durationMs:1,logHash:sha256('Synthetic verifier command row')};});
   const evidence={...context,commands:rows,preflightContinuation:{source:p.source,checkpoint:p.checkpoint}};rows[41].continuation=canvasPolicyNativeContinuation(commands[41].run);restoreCanvasHostingProof(proof);verifyCanvasPreflight(proof,evidence,commands);
   for(const i of [17,29,34,41,42,48,51]){const forged=structuredClone(evidence);forged.commands[i].reusedFrom=p.source;assert.throws(()=>verifyCanvasPreflight(proof,forged,commands));}
   for(const file of ['reuse/hosting-manifest.json','reuse/hosting-proof.json','test-results/frontend-runtime.log','logs/36.log','candidate/proof-frontend-runtime.json']){const target=path.join(proof,file),saved=fs.readFileSync(target);fs.writeFileSync(target,'forged');assert.throws(()=>verifyCanvasPreflight(proof,evidence,commands));fs.writeFileSync(target,saved);}
   const changedBrowser=structuredClone(evidence);changedBrowser.nativeBrowsers.key='changed';assert.throws(()=>verifyCanvasPreflight(proof,changedBrowser,commands));
   const manifestFile=path.join(proof,'candidate/manifest.json'),manifestBytes=fs.readFileSync(manifestFile),manifest=JSON.parse(manifestBytes),asset=Object.keys(manifest.files).find(name=>name.endsWith('.js')),assetFile=path.join(proof,'candidate/site',asset),assetBytes=fs.readFileSync(assetFile);
   fs.appendFileSync(assetFile,'\n// Foreign product bytes');manifest.files[asset]=sha256(fs.readFileSync(assetFile));fs.writeFileSync(manifestFile,JSON.stringify(manifest));assert.throws(()=>restoreCanvasHostingProof(proof),'Rehashed product changes cannot inherit hosting');fs.writeFileSync(assetFile,assetBytes);fs.writeFileSync(manifestFile,manifestBytes);
   assert.deepEqual(verify().result,expected);
  }
  // Exercise the actual shell's stop/copy/verification ordering without running
  // the launcher, native product cases, provider or any external command.
  const flow=path.join(temporary,'flow');fs.mkdirSync(flow);
  const stub=`set -e\nnode() { case "$*" in *verify-canvas-policy-native-pending*) stage=pending;; *--test*) stage=guard;; *test-q2-runtime.mjs*) stage=native;; *verify-canvas-policy-native-repair*) stage=final;; *) return 98;; esac; printf '%s\\n' "$stage" >> "$TRACE"; [ "$FAIL_STAGE" != "$stage" ]; }\ncp() { printf 'copy\\n' >> "$TRACE"; [ "$FAIL_STAGE" != copy ]; }\n`;
  const stages=['pending','guard','native','copy','final'];
  for(const failed of ['',...stages]){const trace=path.join(flow,'trace');fs.rmSync(trace,{force:true});const result=spawnSync('/bin/bash',['-c',stub+shell],{cwd:flow,env:{...process.env,TRACE:trace,FAIL_STAGE:failed},encoding:'utf8'});assert.equal(result.status,failed?1:0,result.stderr);assert.deepEqual(fs.readFileSync(trace,'utf8').trim().split('\n'),failed?stages.slice(0,stages.indexOf(failed)+1):stages);}
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
 console.log('Canvas native continuation: exact source/artifact boundaries and187 retained+183 required native cases verified; failed originals remain failed and unchanged product checks never repeat. Synthetic counterchecks execute no product cases.');
}
await testCanvasPolicyNativeContinuation();

async function testCanvasPolicyNativeProgress() {
 const {CANVAS_POLICY_NATIVE_PREFLIGHT:base,CANVAS_POLICY_NATIVE_PROGRESS:p,isCanvasPolicyNativeProgress,
  assertCanvasPreflightTree,verifyCanvasPolicyNativeProgress,verifyCanvasPolicyNativeProgressUnion,
  verifyCanvasPolicyNativeRepair,canvasPolicyNativeContinuation,canvasPolicyNativeGuardContinuation,
  verifyCanvasPreflight,restoreCanvasHostingProof}=await import('./lib/local-release-evidence.mjs');
 const {canvasPolicyPrefix,canvasPolicyTailInventory}=await import('../tests/helpers/q2-runtime/canvas-policy-tail.mjs');
 const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 if(!isCanvasPolicyNativeProgress(head)){
  assert(!process.argv.includes('--canvas-policy-native-progress-only'),'The closed continuation requires its reviewed source successor');
  return; // Historical continuation; ordinary future releases retain their full checks.
 }
 const entry="if(process.argv.includes('--canvas-policy-native-progress-only')) {\n  assert.deepEqual(process.argv.slice(2),['--canvas-policy-native-progress-only']);\n  await testCanvasPolicyNativeProgress();process.exit(0);\n}\n\n";
 const current=fs.readFileSync('scripts/test-local-release.mjs','utf8');
 assert.equal(current.slice(0,current.indexOf('\nasync function testCanvasPolicyNativeProgress() {')).replace(entry,''),execFileSync('git',['show',`${p.source}:scripts/test-local-release.mjs`]).toString(),'Completed verifier groups must remain byte-identical');
 assert.equal(canvasPolicyNativeGuardContinuation('npm run test:local-release'),'npm run test:local-release -- --canvas-policy-native-progress-only');
 for(const command of ['echo skipped','npm run test:local-release -- --unreviewed','npm run test:local-release\nnpm run test:local-release'])assert.throws(()=>canvasPolicyNativeGuardContinuation(command));
 const expected={nativeRetained:355,nativeFresh:15,nativeTotal:370,processorRetained:true,launcherRetained:28};
 const previous=[...canvasPolicyPrefix.map(name=>({suite:'canvas',name,status:'PASS'})),...Array.from({length:183},(_,i)=>({suite:'synthetic-other',name:'retained-'+i,status:'PASS'}))];
 const progress=canvasPolicyTailInventory.slice(0,168).map(name=>({name,status:'PASS'}));
 const fresh=canvasPolicyTailInventory.slice(168).map(name=>({name,status:'PASS'}));
 assert.equal(fresh[0].name,'canvas_conversational_actions_native_assembly');
 assert.deepEqual(verifyCanvasPolicyNativeProgressUnion(previous,progress,fresh),expected);
 for(const mutate of [r=>r.previous.pop(),r=>r.progress.pop(),r=>r.progress.push(r.progress[0]),r=>r.progress[0].status='FAIL',r=>r.progress[0].name='foreign',r=>r.fresh.pop(),r=>r.fresh.push(r.fresh[0]),r=>r.fresh[0]=r.progress[0],r=>r.fresh[0].status='SKIP',r=>r.fresh[0].status='FAIL',r=>r.fresh[0].name='foreign',r=>[r.fresh[0],r.fresh[1]]=[r.fresh[1],r.fresh[0]]]){
  const bad=structuredClone({previous,progress,fresh});mutate(bad);assert.throws(()=>verifyCanvasPolicyNativeProgressUnion(bad.previous,bad.progress,bad.fresh));
 }
 const command='if false; then\n  exit 99\nelse\n  npm run test:workers\nfi\n',shell=canvasPolicyNativeContinuation(command,{progress:true});
 assert(shell.includes('set -o pipefail')&&shell.includes('--suite canvas-actions-tail'));
 assert(shell.indexOf('cp -a /tmp/bitbi-release/q2-runtime-evidence .local-release/runtime/')<shell.indexOf('verify-canvas-policy-native-repair'));
 for(const repeat of ['npm run test:workers','npm run test:homepage-ffmpeg-processor','npm run test:q2-runtime','--suite canvas-policy-tail','--suite canvas\n'])assert(!shell.includes(repeat),'Completed cases must not repeat');
 for(const bad of ['echo skipped',command+'  npm run test:workers'])assert.throws(()=>canvasPolicyNativeContinuation(bad,{progress:true}));
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-canvas-native-progress-')),bare=path.join(temporary,'git');
 try {
  assert(isCanvasPolicyNativeProgress(head));assertCanvasPreflightTree(head,undefined,base);
  execFileSync('git',['init','--bare',bare],{stdio:'pipe'});
  fs.writeFileSync(path.join(bare,'objects/info/alternates'),path.resolve(execFileSync('git',['rev-parse','--git-path','objects'],{encoding:'utf8'}).trim())+'\n');
  const env={...process.env,GIT_AUTHOR_NAME:'Synthetic',GIT_AUTHOR_EMAIL:'synthetic@example.invalid',GIT_COMMITTER_NAME:'Synthetic',GIT_COMMITTER_EMAIL:'synthetic@example.invalid'};
  const read=(args,input)=>execFileSync('git',['--git-dir',bare,...args],{env,input,stdio:['pipe','pipe','pipe']});
  const fixes=Object.fromEntries(Object.entries(p.specs).map(([file,hash])=>{const bytes=read(['show',`${head}:${file}`]);assert.equal(sha256(bytes),hash);return [file,bytes];}));
  const commit=(changes,parent=p.source)=>{
   read(['read-tree',p.source]);for(const [file,value]of Object.entries(changes)){
    if(value===null){read(['update-index','--index-info'],Buffer.from(`0 ${'0'.repeat(40)}\t${file}\n`));continue;}
    const blob=read(['hash-object','-w','--stdin'],value.content??value).toString().trim();read(['update-index','--add','--cacheinfo',`${value.mode||'100644'},${blob},${file}`]);
   }
   return read(['commit-tree',read(['write-tree']).toString().trim(),'-p',parent],Buffer.from('Synthetic closed D1 action continuation\n')).toString().trim();
  };
  const accepted=commit(fixes);assertCanvasPreflightTree(accepted,read,base);
  for(const file of Object.keys(fixes))for(const value of [null,Buffer.from('Unreviewed correction'),{mode:'120000',content:Buffer.from('outside')}])assert.throws(()=>assertCanvasPreflightTree(commit({...fixes,[file]:value}),read,base));
  for(const file of ['workers/auth/src/lib/canvas-agent-actions.js','workers/auth/migrations/0110_canvas_agent_conversation_actions.sql','tests/helpers/q2-runtime/environment.mjs','tests/canvas.spec.js','package-lock.json','.github/workflows/static.yml','config/release-validation.yml'])assert.throws(()=>assertCanvasPreflightTree(commit({...fixes,[file]:Buffer.from('Unrelated change')}),read,base));
  assert.throws(()=>assertCanvasPreflightTree(commit(fixes,accepted),read,base));
  const root='.local-release',proof=path.join(temporary,'proof');fs.mkdirSync(proof);
  for(const name of ['reuse','candidate','test-results'])fs.cpSync(path.join(root,name),path.join(proof,name),{recursive:true});
  fs.mkdirSync(path.join(proof,'logs'));
  const verifyProgress=()=>verifyCanvasPolicyNativeProgress(proof,head),actual=verifyProgress();
  assert.equal(actual.original.sha,p.source);assert.equal(actual.original.status,'failed');assert.equal(actual.original.commands[41].exitCode,1);assert.equal(actual.previous.length,168);
  const pending=verifyCanvasPolicyNativeRepair(proof,head,{allowPending:true});assert.equal(pending.previous.length,355);assert.equal(pending.result,null);
  const verify=()=>verifyCanvasPolicyNativeRepair(proof,head);assert.throws(verify,'The failed action tail is not a completed native run');
  for(const file of ['checkpoint.json','failed.log','guard.tap','guard-command.log',...Object.keys(p.nativeProof).map(file=>'native/'+file)]){
   const target=path.join(proof,'reuse/canvas-policy-native-progress',file),saved=fs.readFileSync(target);
   fs.unlinkSync(target);assert.throws(verifyProgress);fs.writeFileSync(target,'{}');assert.throws(verifyProgress);fs.writeFileSync(target,saved);
  }
  const title='Canvas action tail preserves all setup and executes only the final fifteen required callbacks';
  const guard=['TAP version 13',`# Subtest: ${title}`,`ok 1 - ${title}`,'1..1','# tests 1','# suites 0','# pass 1','# fail 0','# cancelled 0','# skipped 0','# todo 0',''].join('\n');
  const guardFile=path.join(proof,'test-results/canvas-policy-native-launcher.tap');fs.writeFileSync(guardFile,guard);
  // Disposable synthetic reports exercise validation only; they never enter
  // release evidence or claim that workerd executed a product case.
  const relative='q2-runtime-evidence/synthetic-actions-tail',runtime=path.join(proof,'runtime',relative);fs.mkdirSync(path.join(runtime,'reports'),{recursive:true});
  const write=(file,value)=>fs.writeFileSync(path.join(runtime,file),JSON.stringify(value));
  const launcher={origin:JSON.parse(fs.readFileSync(path.join(proof,'reuse/canvas-native-original/launcher-result.json'))).origin,status:0,failure:null,childBoundaryVerified:true,postcheckFailures:[],mode:'runtime'};
  write('launcher-result.json',launcher);write('reports/isolation-result.json',{passed:true});write('reports/isolation-final.json',{passed:true});
  const result={failedSuites:0,passed:15,reports:[{suite:'canvas',records:fresh,failure:null}]};write('reports/result.json',result);
  const logFile=path.join(proof,'test-results/canvas-policy-native.log');fs.writeFileSync(logFile,JSON.stringify({q2LinuxEvidence:'/tmp/bitbi-release/'+relative})+'\n');
  assert.deepEqual(verify().result,expected);
  for(const mutate of [r=>r.failedSuites=1,r=>r.passed=14,r=>r.reports[0].failure={stage:'failed'},r=>r.reports[0].suite='foreign',r=>r.reports.push(structuredClone(r.reports[0])),r=>r.reports[0].records.pop(),r=>r.reports[0].records.push(r.reports[0].records[0]),r=>r.reports[0].records[0]=progress[0],r=>r.reports[0].records[0].status='FAIL']){const bad=structuredClone(result);mutate(bad);write('reports/result.json',bad);assert.throws(verify);}write('reports/result.json',result);
  for(const mutate of [r=>r.status=1,r=>r.childBoundaryVerified=false,r=>r.postcheckFailures=['lost isolation'],r=>r.mode='preflight']){const bad=structuredClone(launcher);mutate(bad);write('launcher-result.json',bad);assert.throws(verify);}write('launcher-result.json',launcher);
  for(const file of ['reports/isolation-result.json','reports/isolation-final.json']){write(file,{passed:false});assert.throws(verify);write(file,{passed:true});}
  write('reports/duplicate__result.json',result);assert.throws(verify);fs.unlinkSync(path.join(runtime,'reports/duplicate__result.json'));
  for(const content of ['',guard.replace('ok 1 -','not ok 1 -'),guard.replaceAll(title,'Foreign guard'),guard+`ok 2 - ${title}\n`]){fs.writeFileSync(guardFile,content);assert.throws(verify);}fs.writeFileSync(guardFile,guard);
  const log=fs.readFileSync(logFile);for(const content of ['',log.toString()+log.toString()]){fs.writeFileSync(logFile,content);assert.throws(verify);}fs.writeFileSync(logFile,log);
  const original=JSON.parse(fs.readFileSync(path.join(proof,'reuse/preflight-checkpoint.json')));
  const selection=gitSelection(original.base,head),commands=selectedCommands(selection,{GITHUB_SHA:head,CANDIDATE_BASE:original.base});
  const context={sha:head,base:original.base,planHash:validationPlan().digest,selection,environment:original.environment,nativeBrowsers:original.nativeBrowsers,commands};
  const rows=commands.map((command,i)=>{if(base.retain.includes(i)){const row={...original.commands[i],reusedFrom:original.commands[i].reusedFrom||base.source};fs.copyFileSync(path.join(root,row.log),path.join(proof,row.log));return row;}return {command,exitCode:0,log:`logs/${i}.log`,durationMs:1,logHash:sha256('Synthetic verifier command row')};});
  const evidence={...context,commands:rows,preflightContinuation:{source:base.source,checkpoint:base.checkpoint},preflightProgress:{source:p.source,checkpoint:p.checkpoint}};
  rows[17].continuation=canvasPolicyNativeGuardContinuation(commands[17].run);rows[41].continuation=canvasPolicyNativeContinuation(commands[41].run,{progress:true});
  restoreCanvasHostingProof(proof);verifyCanvasPreflight(proof,evidence,commands);
  for(const i of [17,29,34,41,42,48,51]){const bad=structuredClone(evidence);bad.commands[i].reusedFrom=p.source;assert.throws(()=>verifyCanvasPreflight(proof,bad,commands));}
  for(const mutate of [r=>delete r.preflightProgress,r=>r.preflightProgress.source='f'.repeat(40),r=>r.commands[17].continuation='npm run test:local-release',r=>r.commands[41].continuation=canvasPolicyNativeContinuation(commands[41].run)]){const bad=structuredClone(evidence);mutate(bad);assert.throws(()=>verifyCanvasPreflight(proof,bad,commands));}
  assert.deepEqual(verify().result,expected);
  const flow=path.join(temporary,'flow');fs.mkdirSync(flow);
  const stub=`set -e\nnode() { case "$*" in *verify-canvas-policy-native-pending*) stage=pending;; *--test*) stage=guard;; *test-q2-runtime.mjs*) stage=native;; *verify-canvas-policy-native-repair*) stage=final;; *) return 98;; esac; printf '%s\\n' "$stage" >> "$TRACE"; [ "$FAIL_STAGE" != "$stage" ]; }\ncp() { printf 'copy\\n' >> "$TRACE"; [ "$FAIL_STAGE" != copy ]; }\n`;
  const stages=['pending','guard','native','copy','final'];
  for(const failed of ['',...stages]){const trace=path.join(flow,'trace');fs.rmSync(trace,{force:true});const result=spawnSync('/bin/bash',['-c',stub+shell],{cwd:flow,env:{...process.env,TRACE:trace,FAIL_STAGE:failed},encoding:'utf8'});assert.equal(result.status,failed?1:0,result.stderr);assert.deepEqual(fs.readFileSync(trace,'utf8').trim().split('\n'),failed?stages.slice(0,stages.indexOf(failed)+1):stages);}
 } finally {fs.rmSync(temporary,{recursive:true,force:true});}
 console.log('Canvas D1 continuation: exact failed progress and355 retained+15 required native cases verified; original failures, source scope, isolation, inventory and fresh action acceptance remain enforced. No product cases executed.');
}
await testCanvasPolicyNativeProgress();

async function testSettlementPreflightContinuation() {
 const {SETTLEMENT_PREFLIGHT:p,canvasPreflightProfile,assertCanvasPreflightTree,canvasPreflightPrefix,
  verifyCanvasPreflight,settlementPreflightGuardContinuation}=await import('./lib/local-release-evidence.mjs');
 assert.equal(canvasPreflightProfile(p.source),p);
 assert.deepEqual(p.retain,[1,4,5,6,7,8,9,10,11,13,16]);
 assert.equal(settlementPreflightGuardContinuation('npm run test:local-release'),'npm run test:local-release -- --settlement-preflight-only');
 for(const command of ['echo skipped','npm run test:local-release -- --other','npm run test:local-release\nnpm run test:workers'])
  assert.throws(()=>settlementPreflightGuardContinuation(command));
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-settlement-preflight-')),bare=path.join(temporary,'git'),previousGitDir=process.env.GIT_DIR;
 try {
  execFileSync('git',['init','--bare',bare],{stdio:'pipe'});
  fs.writeFileSync(path.join(bare,'objects/info/alternates'),path.resolve(execFileSync('git',['rev-parse','--git-path','objects'],{encoding:'utf8'}).trim())+'\n');
  const env={...process.env,GIT_AUTHOR_NAME:'Synthetic',GIT_AUTHOR_EMAIL:'synthetic@example.invalid',GIT_COMMITTER_NAME:'Synthetic',GIT_COMMITTER_EMAIL:'synthetic@example.invalid'};
  const read=(args,input)=>execFileSync('git',['--git-dir',bare,...args],{env,input,stdio:['pipe','pipe','pipe']});
  const tooling=['scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs','scripts/test-local-release.mjs'];
  const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const reviewed=read(['rev-list','--ancestry-path','--reverse',`${p.source}..${head}`]).toString().trim().split('\n')[0];
  assert(reviewed,'The closed historical fixture requires its committed reviewed successor');
  const fixes=Object.fromEntries([...Object.keys(p.specs),...tooling].map(file=>[file,read(['show',`${reviewed}:${file}`])]));
  for(const [file,hash]of Object.entries(p.specs))assert.equal(sha256(fixes[file]),hash,'Reviewed correction must match its exact pin');
  const commit=(changes,parent=p.source)=>{
   read(['read-tree',p.source]);for(const [file,value]of Object.entries(changes)){
    if(value===null){read(['update-index','--index-info'],Buffer.from(`0 ${'0'.repeat(40)}\t${file}\n`));continue;}
    const blob=read(['hash-object','-w','--stdin'],value.content??value).toString().trim();read(['update-index','--add','--cacheinfo',`${value.mode||'100644'},${blob},${file}`]);
   }
   return read(['commit-tree',read(['write-tree']).toString().trim(),'-p',parent],Buffer.from('Synthetic closed settlement verifier continuation\n')).toString().trim();
  };
  const accepted=commit(fixes);assertCanvasPreflightTree(accepted,read,p);
  for(const file of Object.keys(p.specs))for(const value of [null,Buffer.from('Unreviewed historical correction'),{mode:'120000',content:Buffer.from('outside')}])
   assert.throws(()=>assertCanvasPreflightTree(commit({...fixes,[file]:value}),read,p));
  for(const file of ['workers/auth/src/lib/canvas-agent-settlement-review.js','workers/auth/migrations/0111_canvas_agent_settlement_reviews.sql','tests/helpers/canvas-agent-settlement-review-control.mjs','package-lock.json','.github/workflows/static.yml','config/release-validation.yml'])
   assert.throws(()=>assertCanvasPreflightTree(commit({...fixes,[file]:Buffer.from('Unreviewed product or acceptance')}),read,p));
  for(const file of tooling)for(const value of [null,{mode:'120000',content:Buffer.from('outside')}])
   assert.throws(()=>assertCanvasPreflightTree(commit({...fixes,[file]:value}),read,p));
  assert.throws(()=>assertCanvasPreflightTree(commit({...fixes,'scripts/test-local-release.mjs':Buffer.from('Completed verifier groups removed')}),read,p));
  assert.throws(()=>assertCanvasPreflightTree(commit(fixes,accepted),read,p),'Only the exact direct successor may retain the failed prefix');
  const origin='.local-release',checkpointPath=path.join(origin,'reuse/preflight-checkpoint.json');
  if(fs.existsSync(checkpointPath)&&JSON.parse(fs.readFileSync(checkpointPath)).sha===p.source){
   const bytes=fs.readFileSync(checkpointPath),original=JSON.parse(bytes),proof=path.join(temporary,'proof');
   fs.mkdirSync(path.join(proof,'reuse'),{recursive:true});fs.mkdirSync(path.join(proof,'logs'));
   for(const file of ['preflight-checkpoint.json','preflight-failed.log'])fs.copyFileSync(path.join(origin,'reuse',file),path.join(proof,'reuse',file));
   process.env.GIT_DIR=bare;
   const selection=gitSelection(original.base,accepted),commands=selectedCommands(selection,{GITHUB_SHA:accepted,CANDIDATE_BASE:original.base});
   const context={sha:accepted,base:original.base,planHash:validationPlan().digest,selection,environment:original.environment,nativeBrowsers:original.nativeBrowsers,commands};
   assert.equal(canvasPreflightPrefix(bytes,context).sha,p.source);
   for(const mutate of [r=>r.status='passed',r=>r.commands[17].exitCode=0,r=>r.commands[1].exitCode=1,r=>r.commands.pop()]){
    const changed=structuredClone(original);mutate(changed);assert.throws(()=>canvasPreflightPrefix(Buffer.from(JSON.stringify(changed)),context));
   }
   for(const mutate of [r=>r.base='f'.repeat(40),r=>r.planHash='changed',r=>r.environment.key='changed',r=>r.environment.image='changed',r=>r.environment.inputs['package-lock.json']='changed',r=>r.selection.full=!r.selection.full,r=>r.commands.pop(),r=>r.commands[17].run='echo skipped']){
    const changed=structuredClone(context);mutate(changed);assert.throws(()=>canvasPreflightPrefix(bytes,changed));
   }
   const rows=commands.map((command,index)=>{
    if(p.retain.includes(index)){
     const row={...original.commands[index],reusedFrom:p.source};fs.copyFileSync(path.join(origin,row.log),path.join(proof,row.log));return row;
    }
    const log=`logs/${index}.log`,content=index===17
     ?'Canvas native continuation: exact source/artifact boundaries and187 retained+183 required native cases verified; failed originals remain failed and unchanged product checks never repeat. Synthetic counterchecks execute no product cases.\nSettlement preflight continuation: pinned failed source, exact historical discovery, retained logs and changed-input rejection verified; completed verifier groups and product tests never repeated.\n'
     :'Synthetic fresh verifier row; no product acceptance claimed.\n';fs.writeFileSync(path.join(proof,log),content);
    return {command,exitCode:0,log,logHash:sha256(content),durationMs:1,...(index===17?{continuation:settlementPreflightGuardContinuation(command.run)}:{})};
   });
   const evidence={...context,commands:rows,preflightContinuation:{source:p.source,checkpoint:p.checkpoint}};
   verifyCanvasPreflight(proof,evidence,commands);
   for(const index of [0,2,3,12,14,15,17,18,41]){const forged=structuredClone(evidence);forged.commands[index].reusedFrom=p.source;assert.throws(()=>verifyCanvasPreflight(proof,forged,commands));}
   const wrong=structuredClone(evidence);wrong.commands[17].continuation='npm run test:local-release';assert.throws(()=>verifyCanvasPreflight(proof,wrong,commands),'Completed verifier prefix cannot repeat');
   for(const file of ['reuse/preflight-failed.log','logs/1.log']){
    const target=path.join(proof,file),saved=fs.readFileSync(target);fs.writeFileSync(target,'forged evidence');assert.throws(()=>verifyCanvasPreflight(proof,evidence,commands));fs.writeFileSync(target,saved);
   }
   verifyCanvasPreflight(proof,evidence,commands);
  }
 } finally {if(previousGitDir===undefined)delete process.env.GIT_DIR;else process.env.GIT_DIR=previousGitDir;fs.rmSync(temporary,{recursive:true,force:true});}
 console.log('Settlement preflight continuation: pinned failed source, exact historical discovery, retained logs and changed-input rejection verified; completed verifier groups and product tests never repeated.');
}
await testSettlementPreflightContinuation();

async function testSettlementHostingContinuation() {
 const {SETTLEMENT_HOSTING_PREFLIGHT:p,canvasPreflightProfile,assertCanvasPreflightTree,canvasPreflightPrefix,
  verifyCanvasPreflight,settlementHostingGuardContinuation}=await import('./lib/local-release-evidence.mjs');
 assert.equal(canvasPreflightProfile(p.source),p);
 assert.deepEqual(p.retain,[1,4,5,6,7,8,9,10,11,13,16,18,19,20,21,22,23,24,25,26,27,28,30,31,32,33,35]);
 assert.equal(settlementHostingGuardContinuation('npm run test:local-release'),'npm run test:local-release -- --settlement-hosting-only');
 for(const command of ['echo skipped','npm run test:local-release -- --other','npm run test:local-release\nnpm run test:workers'])assert.throws(()=>settlementHostingGuardContinuation(command));
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-settlement-hosting-')),bare=path.join(temporary,'git'),previousGitDir=process.env.GIT_DIR;
 try {
  execFileSync('git',['init','--bare',bare],{stdio:'pipe'});
  fs.writeFileSync(path.join(bare,'objects/info/alternates'),path.resolve(execFileSync('git',['rev-parse','--git-path','objects'],{encoding:'utf8'}).trim())+'\n');
  const env={...process.env,GIT_AUTHOR_NAME:'Synthetic',GIT_AUTHOR_EMAIL:'synthetic@example.invalid',GIT_COMMITTER_NAME:'Synthetic',GIT_COMMITTER_EMAIL:'synthetic@example.invalid'};
  const read=(args,input)=>execFileSync('git',['--git-dir',bare,...args],{env,input,stdio:['pipe','pipe','pipe']});
  const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),reviewed=read(['rev-list','--ancestry-path','--reverse',`${p.source}..${head}`]).toString().trim().split('\n')[0];
  assert(reviewed,'The closed hosting fixture requires its committed reviewed successor');
  const tooling=['scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs','scripts/test-local-release.mjs'];
  const fixes=Object.fromEntries([...Object.keys(p.specs),...tooling].map(file=>[file,read(['show',`${reviewed}:${file}`])]));
  for(const[file,hash]of Object.entries(p.specs))assert.equal(sha256(fixes[file]),hash);
  const commit=(changes,parent=p.source)=>{
   read(['read-tree',p.source]);for(const[file,value]of Object.entries(changes)){
    if(value===null){read(['update-index','--index-info'],Buffer.from(`0 ${'0'.repeat(40)}\t${file}\n`));continue;}
    const blob=read(['hash-object','-w','--stdin'],value.content??value).toString().trim();read(['update-index','--add','--cacheinfo',`${value.mode||'100644'},${blob},${file}`]);
   }
   return read(['commit-tree',read(['write-tree']).toString().trim(),'-p',parent],Buffer.from('Synthetic closed hosting fixture continuation\n')).toString().trim();
  };
  const accepted=commit(fixes);assertCanvasPreflightTree(accepted,read,p);
  for(const file of Object.keys(p.specs))for(const value of [null,Buffer.from('Unreviewed fixture'),{mode:'120000',content:Buffer.from('outside')}])assert.throws(()=>assertCanvasPreflightTree(commit({...fixes,[file]:value}),read,p));
  for(const file of ['workers/auth/src/lib/canvas-agent-settlement-review.js','workers/auth/migrations/0111_canvas_agent_settlement_reviews.sql','tests/helpers/canvas-agent-settlement-review-control.mjs','frontend/index.mjs','package-lock.json','.github/workflows/static.yml','config/release-validation.yml'])assert.throws(()=>assertCanvasPreflightTree(commit({...fixes,[file]:Buffer.from('Unreviewed product or acceptance')}),read,p));
  for(const file of tooling)for(const value of [null,{mode:'120000',content:Buffer.from('outside')}])assert.throws(()=>assertCanvasPreflightTree(commit({...fixes,[file]:value}),read,p));
  assert.throws(()=>assertCanvasPreflightTree(commit({...fixes,'scripts/test-local-release.mjs':Buffer.from('Completed verifier groups removed')}),read,p));
  assert.throws(()=>assertCanvasPreflightTree(commit(fixes,accepted),read,p));
  const root='.local-release',checkpoint=path.join(root,'reuse/preflight-checkpoint.json');
  if(fs.existsSync(checkpoint)&&JSON.parse(fs.readFileSync(checkpoint)).sha===p.source){
   const bytes=fs.readFileSync(checkpoint),original=JSON.parse(bytes),proof=path.join(temporary,'proof');
   fs.mkdirSync(proof);fs.cpSync(path.join(root,'reuse'),path.join(proof,'reuse'),{recursive:true});fs.mkdirSync(path.join(proof,'logs'));
   process.env.GIT_DIR=bare;
   const selection=gitSelection(original.base,accepted),commands=selectedCommands(selection,{GITHUB_SHA:accepted,CANDIDATE_BASE:original.base});
   const context={sha:accepted,base:original.base,planHash:validationPlan().digest,selection,environment:original.environment,nativeBrowsers:original.nativeBrowsers,commands};
   assert.equal(canvasPreflightPrefix(bytes,context).sha,p.source);
   for(const mutate of [r=>r.status='passed',r=>r.commands[36].exitCode=0,r=>r.commands[17].exitCode=1,r=>r.commands.pop(),r=>delete r.preflightContinuation]){
    const changed=structuredClone(original);mutate(changed);assert.throws(()=>canvasPreflightPrefix(Buffer.from(JSON.stringify(changed)),context));
   }
   for(const mutate of [r=>r.base='f'.repeat(40),r=>r.planHash='changed',r=>r.environment.key='changed',r=>r.environment.image='changed',r=>r.environment.inputs['package-lock.json']='changed',r=>r.selection.full=!r.selection.full,r=>r.commands.pop(),r=>r.commands[36].run='echo skipped']){
    const changed=structuredClone(context);mutate(changed);assert.throws(()=>canvasPreflightPrefix(bytes,changed));
   }
   const rows=commands.map((command,index)=>{
    if(p.retain.includes(index)){
     const row={...original.commands[index],reusedFrom:original.commands[index].reusedFrom||p.source};fs.copyFileSync(path.join(root,row.log),path.join(proof,row.log));return row;
    }
    const log=`logs/${index}.log`,content=index===17?'Settlement hosting continuation: original completed guards, exact fixture repair, immutable evidence chain and fresh downstream acceptance enforced.\n':'Synthetic fresh verifier row; no product acceptance claimed.\n';
    fs.writeFileSync(path.join(proof,log),content);return {command,exitCode:0,log,logHash:sha256(content),durationMs:1,...(index===17?{continuation:settlementHostingGuardContinuation(command.run)}:{})};
   });
   const evidence={...context,commands:rows,preflightContinuation:{source:p.source,checkpoint:p.checkpoint}};
   verifyCanvasPreflight(proof,evidence,commands);
   for(const index of [0,2,3,12,14,15,17,29,34,36,37,41]){const bad=structuredClone(evidence);bad.commands[index].reusedFrom=p.source;assert.throws(()=>verifyCanvasPreflight(proof,bad,commands));}
   const bad=structuredClone(evidence);bad.commands[17].continuation='npm run test:local-release -- --settlement-preflight-only';assert.throws(()=>verifyCanvasPreflight(proof,bad,commands),'Completed verifier groups cannot repeat');
   for(const file of ['reuse/preflight-checkpoint.json','reuse/preflight-failed.log','reuse/settlement-preflight-origin/reuse/preflight-checkpoint.json','reuse/settlement-preflight-origin/reuse/preflight-failed.log','reuse/settlement-preflight-origin/logs/17.log','logs/18.log']){
    const target=path.join(proof,file),saved=fs.readFileSync(target);fs.unlinkSync(target);assert.throws(()=>verifyCanvasPreflight(proof,evidence,commands));fs.writeFileSync(target,'forged proof');assert.throws(()=>verifyCanvasPreflight(proof,evidence,commands));fs.writeFileSync(target,saved);
   }
   verifyCanvasPreflight(proof,evidence,commands);
  }
 }finally{if(previousGitDir===undefined)delete process.env.GIT_DIR;else process.env.GIT_DIR=previousGitDir;fs.rmSync(temporary,{recursive:true,force:true});}
 console.log('Settlement hosting continuation: original completed guards, exact fixture repair, immutable evidence chain and fresh downstream acceptance enforced.');
}
await testSettlementHostingContinuation();

async function testSettlementNativeContinuation() {
 const {SETTLEMENT_NATIVE_PREFLIGHT:p,canvasPreflightProfile,assertCanvasPreflightTree,canvasPreflightPrefix,verifySettlementNativeRepair,
  settlementNativeGuardContinuation,settlementNativeContinuation,settlementLauncherCase}=await import('./lib/local-release-evidence.mjs');
 assert.equal(canvasPreflightProfile(p.source),p);
 assert.deepEqual(p.retain,[1,4,5,6,7,8,9,10,11,13,16,18,19,20,21,22,23,24,25,26,27,28,30,31,32,33,35,36,37,38,39]);
 assert.equal(settlementNativeGuardContinuation('npm run test:local-release'),'npm run test:local-release -- --settlement-native-only');
 for(const command of ['echo skipped','npm run test:local-release -- --other'])assert.throws(()=>settlementNativeGuardContinuation(command));
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-settlement-native-')),bare=path.join(temporary,'git'),previousGitDir=process.env.GIT_DIR;
 try {
  execFileSync('git',['init','--bare',bare],{stdio:'pipe'});fs.writeFileSync(path.join(bare,'objects/info/alternates'),path.resolve(execFileSync('git',['rev-parse','--git-path','objects'],{encoding:'utf8'}).trim())+'\n');
  const env={...process.env,GIT_AUTHOR_NAME:'Synthetic',GIT_AUTHOR_EMAIL:'synthetic@example.invalid',GIT_COMMITTER_NAME:'Synthetic',GIT_COMMITTER_EMAIL:'synthetic@example.invalid'};
  const read=(args,input)=>execFileSync('git',['--git-dir',bare,...args],{env,input,stdio:['pipe','pipe','pipe']});
  const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),reviewed=read(['rev-list','--ancestry-path','--reverse',`${p.source}..${head}`]).toString().trim().split('\n')[0];assert(reviewed);
  const tooling=['scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs','scripts/test-local-release.mjs'];
  const fixes=Object.fromEntries([...Object.keys(p.specs),...tooling].map(file=>[file,read(['show',`${reviewed}:${file}`])]));for(const[file,hash]of Object.entries(p.specs))assert.equal(sha256(fixes[file]),hash);
  const commit=(changes,parent=p.source)=>{
   read(['read-tree',p.source]);for(const[file,value]of Object.entries(changes)){
    if(value===null){read(['update-index','--index-info'],Buffer.from(`0 ${'0'.repeat(40)}\t${file}\n`));continue;}
    const blob=read(['hash-object','-w','--stdin'],value.content??value).toString().trim();read(['update-index','--add','--cacheinfo',`${value.mode||'100644'},${blob},${file}`]);
   }return read(['commit-tree',read(['write-tree']).toString().trim(),'-p',parent],Buffer.from('Synthetic closed native staging continuation\n')).toString().trim();
  };
  const accepted=commit(fixes);assertCanvasPreflightTree(accepted,read,p);
  for(const file of Object.keys(p.specs))for(const value of [null,Buffer.from('Unreviewed fixture'),{mode:'120000',content:Buffer.from('outside')}])assert.throws(()=>assertCanvasPreflightTree(commit({...fixes,[file]:value}),read,p));
  for(const file of ['workers/auth/src/lib/canvas-agent-settlement-review.js','workers/auth/migrations/0111_canvas_agent_settlement_reviews.sql','tests/helpers/canvas-agent-settlement-review-control.mjs','tests/q2-canvas-agent-settlement-review.spec.js','services/homepage-ffmpeg-processor/index.mjs','frontend/index.mjs','package-lock.json','.github/workflows/static.yml','config/release-validation.yml'])assert.throws(()=>assertCanvasPreflightTree(commit({...fixes,[file]:Buffer.from('Unreviewed passed input')}),read,p));
  for(const file of tooling)for(const value of [null,{mode:'120000',content:Buffer.from('outside')}])assert.throws(()=>assertCanvasPreflightTree(commit({...fixes,[file]:value}),read,p));
  assert.throws(()=>assertCanvasPreflightTree(commit({...fixes,'scripts/test-local-release.mjs':Buffer.from('Completed verifier groups removed')}),read,p));assert.throws(()=>assertCanvasPreflightTree(commit(fixes,accepted),read,p));
  const root='.local-release',checkpoint=path.join(root,'reuse/preflight-checkpoint.json');
  if(fs.existsSync(checkpoint)&&JSON.parse(fs.readFileSync(checkpoint)).sha===p.source){
   const bytes=fs.readFileSync(checkpoint),original=JSON.parse(bytes),proof=path.join(temporary,'proof');fs.mkdirSync(proof);fs.cpSync(path.join(root,'reuse'),path.join(proof,'reuse'),{recursive:true});fs.mkdirSync(path.join(proof,'test-results'));
   process.env.GIT_DIR=bare;
   const selection=gitSelection(original.base,accepted),commands=selectedCommands(selection,{GITHUB_SHA:accepted,CANDIDATE_BASE:original.base}),context={sha:accepted,base:original.base,planHash:validationPlan().digest,selection,environment:original.environment,nativeBrowsers:original.nativeBrowsers,commands};
   assert.equal(canvasPreflightPrefix(bytes,context).sha,p.source);
   for(const mutate of [r=>r.status='passed',r=>r.commands[41].exitCode=0,r=>r.commands[40].exitCode=1,r=>r.commands.pop(),r=>delete r.preflightContinuation]){const bad=structuredClone(original);mutate(bad);assert.throws(()=>canvasPreflightPrefix(Buffer.from(JSON.stringify(bad)),context));}
   for(const mutate of [r=>r.base='f'.repeat(40),r=>r.planHash='changed',r=>r.environment.key='changed',r=>r.environment.image='changed',r=>r.environment.inputs['package-lock.json']='changed',r=>r.selection.full=!r.selection.full,r=>r.commands.pop(),r=>r.commands[41].run='echo skipped']){const bad=structuredClone(context);mutate(bad);assert.throws(()=>canvasPreflightPrefix(bytes,bad));}
   const pending=verifySettlementNativeRepair(proof,accepted,{allowPending:true});assert.equal(pending.before.length,30);assert.equal(pending.result,null);assert.throws(()=>verifySettlementNativeRepair(proof,accepted));
   for(const file of ['preflight-checkpoint.json','preflight-failed.log','settlement-worker-last.json']){
    const target=path.join(proof,'reuse',file),saved=fs.readFileSync(target);fs.unlinkSync(target);assert.throws(()=>verifySettlementNativeRepair(proof,accepted,{allowPending:true}));fs.writeFileSync(target,'forged proof');assert.throws(()=>verifySettlementNativeRepair(proof,accepted,{allowPending:true}));fs.writeFileSync(target,saved);
   }
   // Synthetic discovery/launcher artifacts test the verifier only; execution
   // remains the pinned original log and the fresh native child run, respectively.
   const log=fs.readFileSync(path.join(proof,'reuse/preflight-failed.log'),'utf8'),specs=log.split('\n').flatMap(line=>{
    const m=line.match(/^\s+✓\s+(\d+)\s+tests\/(.*?):(\d+):(\d+) › (.*?)\s+\([\d.]+(?:ms|s|m)\)/);return m?[{id:`synthetic-${m[1]}`,file:m[2],line:Number(m[3]),column:Number(m[4]),title:m[5],tests:[{projectName:''}]}]:[];
   });assert.equal(specs.length,1574);
   const discovery={config:{},errors:[],suites:[{specs}]},discoveryFile=path.join(proof,'test-results/settlement-worker-discovery.json');fs.writeFileSync(discoveryFile,JSON.stringify(discovery,null,2));
   verifySettlementNativeRepair(proof,accepted,{allowPending:true});
   for(const mutate of [r=>r.errors.push({message:'discovery failed'}),r=>r.suites[0].specs.pop(),r=>r.suites[0].specs.push(r.suites[0].specs[0]),r=>r.suites[0].specs[0].title='Unexecuted case']){const bad=structuredClone(discovery);mutate(bad);fs.writeFileSync(discoveryFile,JSON.stringify(bad,null,2));assert.throws(()=>verifySettlementNativeRepair(proof,accepted,{allowPending:true}));}fs.writeFileSync(discoveryFile,JSON.stringify(discovery,null,2));
   const tap=`TAP version 13\nok 1 - ${settlementLauncherCase}\n1..1\n# tests 1\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n`,tapFile=path.join(proof,'test-results/settlement-launcher-fresh.tap');fs.writeFileSync(tapFile,tap);
   assert.deepEqual(verifySettlementNativeRepair(proof,accepted).result,{workerPassed:1574,processorPassed:true,launcherRetained:29,launcherFresh:1,launcherTotal:30});
   for(const content of ['',tap.replace('ok 1 -','not ok 1 -'),tap.replaceAll(settlementLauncherCase,'Wrong case'),tap+`ok 2 - ${settlementLauncherCase}\n`,tap+'ok 2 - argument parser rejects ambiguity; artifacts override is explicit\n']){fs.writeFileSync(tapFile,content);assert.throws(()=>verifySettlementNativeRepair(proof,accepted));}fs.writeFileSync(tapFile,tap);
   const shell=settlementNativeContinuation(commands[41].run);assert(shell.includes(`--test-name-pattern='^${settlementLauncherCase}$'`));assert(!shell.includes('  npm run test:workers\n'));assert(!shell.includes('npm run test:homepage-ffmpeg-processor'));
   assert.throws(()=>settlementNativeContinuation('npm run test:workers'));
   const flow=path.join(temporary,'flow');fs.mkdirSync(flow);const trace=path.join(flow,'trace');
   const stub=`set -e\nnpx(){ printf 'discovery\\n' >> "$TRACE"; [ "$FAIL_STAGE" != discovery ]; }\nnode(){ case "$*" in *verify-settlement-native-pending*) stage=pending;; *--test*) stage=guard;; *verify-settlement-native-repair*) stage=verify;; *test-q2-runtime.mjs*) stage=native;; *) return 98;; esac; printf '%s\\n' "$stage" >> "$TRACE"; [ "$FAIL_STAGE" != "$stage" ]; }\ncat(){ :; }\n`;
   const stages=['discovery','pending','guard','verify','native'];for(const failed of ['',...stages]){fs.rmSync(trace,{force:true});const result=spawnSync('/bin/bash',['-c',stub+shell],{cwd:flow,env:{...process.env,TRACE:trace,FAIL_STAGE:failed},encoding:'utf8'});assert.equal(result.status,failed?1:0,result.stderr);assert.deepEqual(fs.readFileSync(trace,'utf8').trim().split('\n'),failed?stages.slice(0,stages.indexOf(failed)+1):stages);}
  }
 }finally{if(previousGitDir===undefined)delete process.env.GIT_DIR;else process.env.GIT_DIR=previousGitDir;fs.rmSync(temporary,{recursive:true,force:true});}
 console.log('Settlement native continuation: immutable1574 Worker and FFmpeg passes,29 retained launcher cases and one required correction verified; full native runtime remains mandatory.');
}
await testSettlementNativeContinuation();

async function testSettlementNativeProgress() {
 const {SETTLEMENT_NATIVE_PROGRESS:p,canvasPreflightProfile,assertCanvasPreflightTree,canvasPreflightPrefix,verifySettlementNativeProgress,
  settlementNativeProgressGuard,settlementNativeProgressContinuation,settlementLauncherResults,settlementLauncherCase}=await import('./lib/local-release-evidence.mjs');
 assert.equal(canvasPreflightProfile(p.source),p);assert(p.retain.includes(40));assert(!p.retain.includes(41));
 assert.equal(settlementNativeProgressGuard('npm run test:local-release'),'npm run test:local-release -- --settlement-native-progress-only');assert.throws(()=>settlementNativeProgressGuard('echo skipped'));
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-settlement-native-progress-')),bare=path.join(temporary,'git'),previousGitDir=process.env.GIT_DIR;
 try {
  execFileSync('git',['init','--bare',bare],{stdio:'pipe'});fs.writeFileSync(path.join(bare,'objects/info/alternates'),path.resolve(execFileSync('git',['rev-parse','--git-path','objects'],{encoding:'utf8'}).trim())+'\n');
  const env={...process.env,GIT_AUTHOR_NAME:'Synthetic',GIT_AUTHOR_EMAIL:'synthetic@example.invalid',GIT_COMMITTER_NAME:'Synthetic',GIT_COMMITTER_EMAIL:'synthetic@example.invalid'};
  const read=(args,input)=>execFileSync('git',['--git-dir',bare,...args],{env,input,stdio:['pipe','pipe','pipe']});
  const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),reviewed=read(['rev-list','--ancestry-path','--reverse',`${p.source}..${head}`]).toString().trim().split('\n')[0];assert(reviewed);
  const tooling=['scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs','scripts/test-local-release.mjs'];
  const fixes=Object.fromEntries([...Object.keys(p.specs),...tooling].map(file=>[file,read(['show',`${reviewed}:${file}`])]));for(const[file,hash]of Object.entries(p.specs))assert.equal(sha256(fixes[file]),hash);
  const commit=(changes,parent=p.source)=>{
   read(['read-tree',p.source]);for(const[file,value]of Object.entries(changes)){
    if(value===null){read(['update-index','--index-info'],Buffer.from(`0 ${'0'.repeat(40)}\t${file}\n`));continue;}
    const blob=read(['hash-object','-w','--stdin'],value.content??value).toString().trim();read(['update-index','--add','--cacheinfo',`${value.mode||'100644'},${blob},${file}`]);
   }return read(['commit-tree',read(['write-tree']).toString().trim(),'-p',parent],Buffer.from('Synthetic closed native verifier progress\n')).toString().trim();
  };
  const accepted=commit(fixes);assertCanvasPreflightTree(accepted,read,p);
  for(const file of Object.keys(p.specs))for(const value of [null,Buffer.from('Unreviewed fixture'),{mode:'120000',content:Buffer.from('outside')}])assert.throws(()=>assertCanvasPreflightTree(commit({...fixes,[file]:value}),read,p));
  for(const file of ['tests/helpers/q2-runtime/linux-hosted.mjs','scripts/test-q2-runtime-launcher.mjs','workers/auth/src/lib/canvas-agent-settlement-review.js','tests/helpers/canvas-agent-settlement-review-control.mjs','services/homepage-ffmpeg-processor/index.mjs','frontend/index.mjs','package-lock.json','config/release-validation.yml'])assert.throws(()=>assertCanvasPreflightTree(commit({...fixes,[file]:Buffer.from('Changed accepted input')}),read,p));
  for(const file of tooling)for(const value of [null,{mode:'120000',content:Buffer.from('outside')}])assert.throws(()=>assertCanvasPreflightTree(commit({...fixes,[file]:value}),read,p));
  assert.throws(()=>assertCanvasPreflightTree(commit({...fixes,'scripts/test-local-release.mjs':Buffer.from('Removed accepted verifier')}),read,p));assert.throws(()=>assertCanvasPreflightTree(commit(fixes,accepted),read,p));
  const root='.local-release',checkpoint=path.join(root,'reuse/preflight-checkpoint.json');
  if(fs.existsSync(checkpoint)&&JSON.parse(fs.readFileSync(checkpoint)).sha===p.source){
   const bytes=fs.readFileSync(checkpoint),original=JSON.parse(bytes),proof=path.join(temporary,'proof');fs.mkdirSync(proof);fs.cpSync(path.join(root,'reuse'),path.join(proof,'reuse'),{recursive:true});process.env.GIT_DIR=bare;
   const selection=gitSelection(original.base,accepted),commands=selectedCommands(selection,{GITHUB_SHA:accepted,CANDIDATE_BASE:original.base}),context={sha:accepted,base:original.base,planHash:validationPlan().digest,selection,environment:original.environment,nativeBrowsers:original.nativeBrowsers,commands};assert.equal(canvasPreflightPrefix(bytes,context).sha,p.source);
   const result=verifySettlementNativeProgress(proof,accepted);assert.deepEqual(result.result,{workerPassed:1574,processorPassed:true,launcherRetained:30,nativePending:true});
   const tap=fs.readFileSync(path.join(proof,'reuse/settlement-native-origin/test-results/settlement-launcher-fresh.tap'),'utf8');assert.deepEqual(settlementLauncherResults(tap),[{title:settlementLauncherCase,status:'passed'}]);
   for(const content of [tap.replace('ok 1 -','not ok 1 -'),tap.replace(`ok 1 - ${settlementLauncherCase}\n`,''),tap.replaceAll(settlementLauncherCase,'unselected assertion'),tap.replace('1..0\n','1..1\n'),tap.replaceAll('tests/q2-recovery-staging.test.mjs','foreign.test.mjs'),tap+'ok 3 - unrelated pass\n'])assert.throws(()=>settlementLauncherResults(content));
   for(const file of ['reuse/preflight-checkpoint.json','reuse/preflight-failed.log','reuse/settlement-native-origin/test-results/settlement-launcher-fresh.tap','reuse/settlement-native-origin/test-results/settlement-worker-discovery.json','reuse/settlement-native-origin/candidate/manifest.json','reuse/settlement-native-origin/candidate/proof-frontend-runtime.json','reuse/settlement-native-origin/candidate/site/index.html','reuse/settlement-native-origin/reuse/preflight-failed.log']){
    const target=path.join(proof,file),saved=fs.readFileSync(target);fs.unlinkSync(target);assert.throws(()=>verifySettlementNativeProgress(proof,accepted));fs.writeFileSync(target,'forged proof');assert.throws(()=>verifySettlementNativeProgress(proof,accepted));fs.writeFileSync(target,saved);
   }
   const shell=settlementNativeProgressContinuation(commands[41].run);assert(!shell.includes('--test-name-pattern'));assert(!shell.includes('--list'));assert(!shell.includes('npm run test:workers\n'));assert(shell.includes('verify-settlement-native-progress .local-release\n  node scripts/test-q2-runtime.mjs'));
   const flow=path.join(temporary,'flow');fs.mkdirSync(flow);const trace=path.join(flow,'trace'),stub=`set -e\nnode(){ case "$*" in *verify-settlement-native-progress*) stage=verify;; *test-q2-runtime.mjs*) stage=native;; *) return 98;; esac; printf '%s\\n' "$stage" >> "$TRACE"; [ "$FAIL_STAGE" != "$stage" ]; }\n`;
   for(const failed of ['','verify','native']){fs.rmSync(trace,{force:true});const q=spawnSync('/bin/bash',['-c',stub+shell],{cwd:flow,env:{...process.env,TRACE:trace,FAIL_STAGE:failed},encoding:'utf8'});assert.equal(q.status,failed?1:0,q.stderr);assert.deepEqual(fs.readFileSync(trace,'utf8').trim().split('\n'),failed==='verify'?['verify']:['verify','native']);}
  }
 }finally{if(previousGitDir===undefined)delete process.env.GIT_DIR;else process.env.GIT_DIR=previousGitDir;fs.rmSync(temporary,{recursive:true,force:true});}
 console.log('Settlement native progress: actual saved Node22 empty-file envelope verified; staging assertion retained once and native child still required.');
}
await testSettlementNativeProgress();

async function testSettlementBrowserContinuation() {
 const {SETTLEMENT_BROWSER_PREFLIGHT:p,canvasPreflightProfile,assertCanvasPreflightTree,canvasPreflightPrefix,verifyModelBrowserRepair,settlementBrowserGuard,settlementBrowserContinuation}=await import('./lib/local-release-evidence.mjs');
 const {MODEL_BROWSER_POLICY,verifyModelBrowserReport,verifyBrowserUnion,passedBrowserCase}=await import('./lib/local-release-browser.mjs');
 assert.equal(canvasPreflightProfile(p.source),p);assert.equal(settlementBrowserGuard('npm run test:local-release'),'npm run test:local-release -- --settlement-browser-only');assert.throws(()=>settlementBrowserGuard('echo skipped'));
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-settlement-browser-')),bare=path.join(temporary,'git'),previousGitDir=process.env.GIT_DIR;
 try {
  execFileSync('git',['init','--bare',bare],{stdio:'pipe'});fs.writeFileSync(path.join(bare,'objects/info/alternates'),path.resolve(execFileSync('git',['rev-parse','--git-path','objects'],{encoding:'utf8'}).trim())+'\n');
  const env={...process.env,GIT_AUTHOR_NAME:'Synthetic',GIT_AUTHOR_EMAIL:'synthetic@example.invalid',GIT_COMMITTER_NAME:'Synthetic',GIT_COMMITTER_EMAIL:'synthetic@example.invalid'},read=(args,input)=>execFileSync('git',['--git-dir',bare,...args],{env,input,stdio:['pipe','pipe','pipe']});
  const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),reviewed=read(['rev-list','--ancestry-path','--reverse',`${p.source}..${head}`]).toString().trim().split('\n')[0];assert(reviewed);
  const tooling=['scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs','scripts/lib/local-release-browser.mjs','scripts/test-local-release.mjs'];
  const fixes=Object.fromEntries([...Object.keys(p.specs),...tooling].map(file=>[file,read(['show',`${reviewed}:${file}`])]));for(const[file,hash]of Object.entries(p.specs))assert.equal(sha256(fixes[file]),hash);
  const commit=(changes,parent=p.source)=>{
   read(['read-tree',p.source]);for(const[file,value]of Object.entries(changes)){
    if(value===null){read(['update-index','--index-info'],Buffer.from(`0 ${'0'.repeat(40)}\t${file}\n`));continue;}
    const blob=read(['hash-object','-w','--stdin'],value.content??value).toString().trim();read(['update-index','--add','--cacheinfo',`${value.mode||'100644'},${blob},${file}`]);
   }return read(['commit-tree',read(['write-tree']).toString().trim(),'-p',parent],Buffer.from('Synthetic closed browser fixture continuation\n')).toString().trim();
  };
  const accepted=commit(fixes);assertCanvasPreflightTree(accepted,read,p);
  for(const file of Object.keys(p.specs))for(const value of [null,Buffer.from('Unreviewed fixture'),{mode:'120000',content:Buffer.from('outside')}])assert.throws(()=>assertCanvasPreflightTree(commit({...fixes,[file]:value}),read,p));
  for(const file of ['tests/canvas.spec.js','tests/helpers/q2-runtime/linux-hosted.mjs','workers/auth/src/lib/canvas-agent-settlement-review.js','frontend/index.mjs','js/pages/canvas/agent.js','package-lock.json','config/release-validation.yml'])assert.throws(()=>assertCanvasPreflightTree(commit({...fixes,[file]:Buffer.from('Changed accepted input')}),read,p));
  for(const file of tooling)for(const value of [null,{mode:'120000',content:Buffer.from('outside')}])assert.throws(()=>assertCanvasPreflightTree(commit({...fixes,[file]:value}),read,p));
  assert.throws(()=>assertCanvasPreflightTree(commit({...fixes,'scripts/test-local-release.mjs':Buffer.from('Removed accepted verifier')}),read,p));assert.throws(()=>assertCanvasPreflightTree(commit(fixes,accepted),read,p));
  const root='.local-release',checkpoint=path.join(root,'reuse/preflight-checkpoint.json');
  if(fs.existsSync(checkpoint)&&JSON.parse(fs.readFileSync(checkpoint)).sha===p.source){
   const bytes=fs.readFileSync(checkpoint),original=JSON.parse(bytes),proof=path.join(temporary,'proof');fs.mkdirSync(proof);for(const folder of ['reuse','runtime','test-results'])fs.cpSync(path.join(root,folder),path.join(proof,folder),{recursive:true});process.env.GIT_DIR=bare;
   const selection=gitSelection(original.base,accepted),commands=selectedCommands(selection,{GITHUB_SHA:accepted,CANDIDATE_BASE:original.base}),context={sha:accepted,base:original.base,planHash:validationPlan().digest,selection,environment:original.environment,nativeBrowsers:original.nativeBrowsers,commands};assert.equal(canvasPreflightPrefix(bytes,context).sha,p.source);
   const verify=()=>verifyModelBrowserRepair(proof,accepted,{allowPending:true,profile:p}),{previous}=verify();assert.equal(previous.filter(passedBrowserCase).length,630);
   for(const file of ['reuse/preflight-checkpoint.json','reuse/preflight-failed.log','reuse/model-browser-original.json','reuse/model-browser-standard.json','reuse/settlement-native-progress-origin/candidate/site/index.html',...Object.keys(p.nativeProof),'test-results/homepage-functional.json']){
    const target=path.join(proof,file),saved=fs.readFileSync(target);fs.unlinkSync(target);assert.throws(verify);fs.writeFileSync(target,'forged proof');assert.throws(verify);fs.writeFileSync(target,saved);
   }
   const raw=JSON.parse(fs.readFileSync(path.join(proof,'reuse/model-browser-original.json'))),standard=JSON.parse(fs.readFileSync(path.join(proof,'reuse/model-browser-standard.json'))),retained=new Map(previous.filter(passedBrowserCase).map(row=>[row.key,row]));
   const discoveries={homepage:browserRows(raw,{discovery:true}),auth:browserRows(standard,{discovery:true}).filter(row=>row.project==='chromium'&&(/^(auth-admin|wallet-nav|locale|oma2-q1-member)\.spec\.js$/.test(row.file)||row.file.startsWith('oma2-q3-')))};
   // Disposable synthetic successes validate the union only; they never become
   // release evidence and do not claim the four corrected browser cases ran.
   for(const [scope,discovery]of Object.entries(discoveries)){
    const fresh=discovery.filter(row=>!retained.has(row.key)).map(row=>({...row,expectedStatus:'passed',status:'expected',results:[{status:'passed',retry:0}]})),counts=verifyBrowserUnion(discovery,retained,fresh);
    assert.deepEqual(counts,scope==='homepage'?{required:634,reused:630,executed:4}:{required:709,reused:25,executed:684});
    const report={policy:MODEL_BROWSER_POLICY,sha:accepted,source:p.source,scope,previous,discovery,fresh,counts};assert.deepEqual(verifyModelBrowserReport(report,accepted),counts);
    for(const mutate of [r=>r.source='f'.repeat(40),r=>r.previous.pop(),r=>r.discovery.pop(),r=>r.fresh.pop(),r=>r.fresh.push(r.fresh[0]),r=>r.fresh[0].results[0].status='failed',r=>r.fresh[0].results[0].status='skipped',r=>r.fresh[0].results[0].retry=1,r=>r.fresh[0].title='Unselected case',r=>r.counts.executed=0]){const bad=structuredClone(report);mutate(bad);assert.throws(()=>verifyModelBrowserReport(bad,accepted));}
   }
   assert.equal(settlementBrowserContinuation(commands[49].run),'node scripts/local-release.mjs settlement-browser-continuation');assert(settlementBrowserContinuation(commands[50].run,'auth').includes('settlement-browser-continuation auth'));assert.throws(()=>settlementBrowserContinuation('echo skipped'));
  }
 }finally{if(previousGitDir===undefined)delete process.env.GIT_DIR;else process.env.GIT_DIR=previousGitDir;fs.rmSync(temporary,{recursive:true,force:true});}
 console.log('Settlement browser continuation:634-case discovery,630 retained outcomes,4 required corrections,25 Auth overlaps and385 native passes remain bound to original evidence.');
}
await testSettlementBrowserContinuation();

async function testStoredPlanContinuation() {
 const {STORED_PLAN_CONTINUATION:p,assertStoredPlanTree,verifyModelBrowserReport}=await import('./lib/local-release-browser.mjs');
 const {storedPlanPrefix,storedPlanCommand,storedPlanWorkerNames,verifyStoredPlanWorkerUnion,verifyStoredPlanNative,verifyStoredPlanOrigin,verifyStoredPlanPlacement,workerDiscovery}=await import('./lib/local-release-evidence.mjs');
 const {parseRuntimeArgs}=await import('../tests/helpers/q2-runtime/linux-hosted.mjs');
 const {selectedRuntimeSuites,runtimeSuites}=await import('../tests/helpers/q2-runtime/runner.mjs');
 const {canvasSettlementContinuationInventory,runCanvasSettlementContinuationTests}=await import('../tests/helpers/q2-runtime/canvas-policy-tail.mjs');
 assert.equal(parseRuntimeArgs(['--suite','canvas-settlement-continuation'],{}).suite,'canvas-settlement-continuation');
 assert.throws(()=>parseRuntimeArgs(['--suite','canvas-settlement-continuation-other'],{}));assert.throws(()=>parseRuntimeArgs(['--suite','canvas-settlement-continuation','--suite','canvas'],{}));
 assert.equal(selectedRuntimeSuites('canvas-settlement-continuation')[0][1],runCanvasSettlementContinuationTests);assert(!runtimeSuites.some(([,run])=>run===runCanvasSettlementContinuationTests));assert.deepEqual(selectedRuntimeSuites(),runtimeSuites);
 assert.equal(storedPlanCommand({name:'Test local release evidence and orchestration',run:'npm run test:local-release'}),'npm run test:local-release -- --stored-plan-only');
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-stored-plan-')),bare=path.join(temporary,'git'),previousGitDir=process.env.GIT_DIR;
 try {
  execFileSync('git',['init','--bare',bare],{stdio:'pipe'});fs.writeFileSync(path.join(bare,'objects/info/alternates'),path.resolve(execFileSync('git',['rev-parse','--git-path','objects'],{encoding:'utf8'}).trim())+'\n');
  const env={...process.env,GIT_AUTHOR_NAME:'Synthetic',GIT_AUTHOR_EMAIL:'synthetic@example.invalid',GIT_COMMITTER_NAME:'Synthetic',GIT_COMMITTER_EMAIL:'synthetic@example.invalid'},read=(args,input)=>execFileSync('git',['--git-dir',bare,...args],{env,input,stdio:['pipe','pipe','pipe'],maxBuffer:64*1024*1024});
  const tooling=['scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs','scripts/lib/local-release-browser.mjs','scripts/test-local-release.mjs'];
  const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),reviewed=read(['rev-list','--ancestry-path','--reverse',`${p.source}..${head}`]).toString().trim().split('\n')[0];
  const fixes=Object.fromEntries([...Object.keys(p.specs),...tooling].map(file=>[file,reviewed?read(['show',`${reviewed}:${file}`]):fs.readFileSync(file)]));
  const commit=(changes,parent=p.source)=>{read(['read-tree',p.source]);for(const[file,value]of Object.entries(changes)){
   if(value===null){read(['update-index','--index-info'],Buffer.from(`0 ${'0'.repeat(40)}\t${file}\n`));continue;}
   const blob=read(['hash-object','-w','--stdin'],value.content??value).toString().trim();read(['update-index','--add','--cacheinfo',`${value.mode||'100644'},${blob},${file}`]);
  }return read(['commit-tree',read(['write-tree']).toString().trim(),'-p',parent],Buffer.from('Synthetic stored-plan continuation\n')).toString().trim();};
  const accepted=commit(fixes);assertStoredPlanTree(accepted,read);
  for(const file of Object.keys(p.specs))for(const value of [null,Buffer.from('Unreviewed input'),{mode:'120000',content:Buffer.from('outside')}])assert.throws(()=>assertStoredPlanTree(commit({...fixes,[file]:value}),read));
  for(const file of ['workers/ai/src/lib/canvas-agent-plan.js','js/pages/canvas/agent.js','package-lock.json','config/release-validation.yml','tests/canvas.spec.js'])assert.throws(()=>assertStoredPlanTree(commit({...fixes,[file]:Buffer.from('Changed retained input')}),read));
  assert.throws(()=>assertStoredPlanTree(commit(fixes,accepted),read));assert.throws(()=>assertStoredPlanTree(commit({...fixes,'scripts/test-local-release.mjs':Buffer.from('Removed previous assertions')}),read));
  const root='.local-release',origin=path.join(root,'reuse/test-results/stored-plan-origin');
  if(!fs.existsSync(path.join(origin,'evidence.json'))){assert(!process.argv.includes('--stored-plan-only'),'The continuation verifier requires actual preserved source evidence');return;}
  process.env.GIT_DIR=bare;
  const original=JSON.parse(fs.readFileSync(path.join(origin,'evidence.json'))),selection=gitSelection(p.source,accepted),commands=selectedCommands(selection,{GITHUB_SHA:accepted,CANDIDATE_BASE:p.source});
  const context={sha:accepted,base:p.source,planHash:validationPlan().digest,environment:original.environment,nativeBrowsers:original.nativeBrowsers,commands,selection};
  assert.equal(storedPlanPrefix(fs.readFileSync(path.join(origin,'evidence.json')),context).sha,p.source);
  for(const patch of [{base:original.base},{environment:{...original.environment,image:'sha256:'+'0'.repeat(64)}},{commands:commands.slice(1)},{selection:{...selection,full:true}}])assert.throws(()=>storedPlanPrefix(fs.readFileSync(path.join(origin,'evidence.json')),{...context,...patch}));
  verifyStoredPlanOrigin(root,accepted);
  const scan=path.join(temporary,'scan');copyEvidenceToolInputs(root,scan);assert.deepEqual(scanRepoForSecrets(scan),[],'Generated evidence must use the existing results boundary');
  const misplaced=path.join(scan,'reuse/stored-plan-origin');fs.mkdirSync(misplaced,{recursive:true});fs.copyFileSync(path.join(origin,'evidence.json'),path.join(misplaced,'evidence.json'));
  const oldFindings=scanRepoForSecrets(scan);assert.equal(oldFindings.length,8);assert(oldFindings.every(row=>row.file==='reuse/stored-plan-origin/evidence.json'&&row.rule==='generic-secret-assignment'));fs.rmSync(misplaced,{recursive:true});
  fs.writeFileSync(path.join(scan,'ordinary-source.mjs'),'const apiKey = '+JSON.stringify('X'.repeat(40))+';');assert(scanRepoForSecrets(scan).some(row=>row.file==='ordinary-source.mjs'&&row.rule==='generic-secret-assignment'));fs.unlinkSync(path.join(scan,'ordinary-source.mjs'));
  if(fs.existsSync(path.join(root,'reuse/test-results/stored-plan-placement/checkpoint.json'))){
    const repair=commit({...fixes,...Object.fromEntries(tooling.map(file=>[file,fs.readFileSync(file)]))},p.placement.source);assertStoredPlanTree(repair,read);
    const repairSelection=gitSelection(p.source,repair),repairContext={...context,sha:repair,selection:repairSelection,commands:selectedCommands(repairSelection,{GITHUB_SHA:repair,CANDIDATE_BASE:p.source})};
    assert.equal(verifyStoredPlanPlacement(root,repairContext,original).commands[0].exitCode,0);
    assert.throws(()=>verifyStoredPlanPlacement(root,context,original));
    for(const file of ['checkpoint.json','preflight.log','failed.log']){const target=path.join(scan,'reuse/test-results/stored-plan-placement',file),bytes=fs.readFileSync(target);fs.writeFileSync(target,'forged');assert.throws(()=>verifyStoredPlanPlacement(scan,repairContext,original));fs.writeFileSync(target,bytes);}
    assert.throws(()=>assertStoredPlanTree(commit({...fixes,'workers/auth/src/lib/canvas-agent-graph.js':Buffer.from('Changed production input')},p.placement.source),read));
  }

  const old=workerDiscovery(JSON.parse(fs.readFileSync(path.join(origin,'test-results/settlement-worker-discovery.json'))));
  const fresh=storedPlanWorkerNames.map((title,i)=>({id:'synthetic-'+i,file:title.startsWith('Canvas settled-plan')?'q2-canvas-settlement-operator.spec.js':'q2-canvas-agent-settlement-review.spec.js',title,results:[{status:'passed',retry:0}]}));
  const discovery=[...old,...fresh];assert.deepEqual(verifyStoredPlanWorkerUnion(old,discovery,fresh),{retained:1574,executed:9,required:1583});
  for(const broken of [fresh.slice(1),[...fresh,fresh[0]],fresh.map((r,i)=>i? r:{...r,results:[{status:'failed',retry:0}]}),fresh.map((r,i)=>i? r:{...r,results:[{status:'passed',retry:1}]}),[...fresh,{...old[0],results:[{status:'passed',retry:0}]}]])assert.throws(()=>verifyStoredPlanWorkerUnion(old,discovery,broken));
  assert.throws(()=>verifyStoredPlanWorkerUnion(old,discovery.slice(1),fresh));assert.throws(()=>verifyStoredPlanWorkerUnion(old,[...discovery,{...fresh[0],id:'foreign',title:'Unknown new case'}],fresh));
  const priorNative=JSON.parse(fs.readFileSync(path.join(origin,'runtime/q2-runtime-evidence/native-Dvjqr1/reports/bitbi-q2-runtime-gLE6HW__result.json'))),oldNames=priorNative.reports.find(s=>s.suite==='canvas').records.map(r=>r.name);
  const insert=oldNames.indexOf('canvas_planning_settlement_identity')+1;assert(insert>0);const names=[...oldNames.slice(0,insert),...canvasSettlementContinuationInventory,...oldNames.slice(insert)];
  const result={passed:7,failedSuites:0,reports:[{suite:'canvas',records:canvasSettlementContinuationInventory.map(name=>({name,status:'PASS'})),metrics:[{settlementContinuation:{retained:oldNames,discovery:names,fresh:[...canvasSettlementContinuationInventory]}}],failure:null}]};
  assert.deepEqual(verifyStoredPlanNative(priorNative,result),{retained:385,executed:7,required:392});
  for(const mutate of [r=>r.reports[0].records.pop(),r=>r.reports[0].records[0].status='FAIL',r=>r.reports[0].metrics[0].settlementContinuation.retained.pop(),r=>r.reports[0].metrics[0].settlementContinuation.discovery.pop(),r=>r.reports[0].records.push(r.reports[0].records[0])]){const bad=structuredClone(result);mutate(bad);assert.throws(()=>verifyStoredPlanNative(priorNative,bad));}
  // Exercise the actual scope adapter with a known callback inventory and broken
  // providers; synthetic callbacks are never written into acceptance evidence.
  const source=fs.readFileSync('tests/helpers/q2-runtime/canvas-policy-tail.mjs','utf8'),asUrl=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
  const adapter=async inventory=>import(asUrl(source.replace("'./canvas.mjs'",JSON.stringify(asUrl('export async function runCanvasTests(f){for(const name of '+JSON.stringify(inventory)+')await f.test(name,async()=>f.calls.push(name));}')))));
  const f={calls:[],metrics:[],test:async(name,operation)=>operation()};await(await adapter(names)).runCanvasSettlementContinuationTests(f);assert.deepEqual(f.calls,canvasSettlementContinuationInventory);
  for(const invalid of [names.slice(1),[...names,names[0]],names.filter(name=>name!==canvasSettlementContinuationInventory[0]),[...names,'new-unreviewed-native-case']])await assert.rejects(() => adapter(invalid).then(module=>module.runCanvasSettlementContinuationTests({calls:[],metrics:[],test:async(name,operation)=>operation()})));
  const worker=commands.find(row=>row.name==='Run worker route tests'),actual=storedPlanCommand(worker);assert(actual.includes('--retries=0'));assert(actual.includes('--suite canvas-settlement-continuation'));assert(actual.includes('--list --reporter=json'));assert(!actual.includes('npm run test:workers'));
  for(const scope of ['auth','homepage']){const oldReport=JSON.parse(fs.readFileSync(path.join(origin,`test-results/candidate-${scope}.json`))),report={...oldReport,sha:accepted,retainedSource:p.source};verifyModelBrowserReport(report,accepted);for(const mutate of [r=>r.fresh.pop(),r=>r.discovery.pop(),r=>r.retainedSource='a'.repeat(40),r=>r.previous[0].title='forged']){const bad=structuredClone(report);mutate(bad);assert.throws(()=>verifyModelBrowserReport(bad,accepted));}}
  const snapshot=path.join(temporary,'proof');fs.cpSync(root,snapshot,{recursive:true});const proofOrigin=path.join(snapshot,'reuse/test-results/stored-plan-origin');
  for(const file of ['evidence.json','candidate/site/index.html','logs/41.log','test-results/candidate-auth.json','runtime/q2-runtime-evidence/native-Dvjqr1/reports/bitbi-q2-runtime-gLE6HW__result.json']){const target=path.join(proofOrigin,file),bytes=fs.readFileSync(target);fs.writeFileSync(target,'forged');assert.throws(()=>verifyStoredPlanOrigin(snapshot,accepted));fs.writeFileSync(target,bytes);}
 }finally{if(previousGitDir===undefined)delete process.env.GIT_DIR;else process.env.GIT_DIR=previousGitDir;fs.rmSync(temporary,{recursive:true,force:true});}
 console.log('Stored-plan continuation: actual accepted evidence calibrated;1574 Worker/385 native/browser outcomes retained;9 new Worker and7 new native identities mandatory; missing, forged, failed, duplicate and unrelated-source controls rejected.');
}
await testStoredPlanContinuation();

async function testStoredPlanWorkerContinuation() {
 const {STORED_PLAN_CONTINUATION:p,assertStoredPlanTree}=await import('./lib/local-release-browser.mjs');
 const {verifyStoredPlanWorkerProgress,verifyStoredPlanWorkerUnion,storedPlanCommand,workerDiscovery,parseDiscovery,verifyStoredPlanNative,verifyStoredPlanGuard,STORED_PLAN_GUARD_REFRESH,storedPlanFreshIndexes,STORED_PLAN_WORKER_REFRESH}=await import('./lib/local-release-evidence.mjs');
 const root='.local-release',relative='reuse/test-results/stored-plan-worker-progress';
 if(!fs.existsSync(path.join(root,relative,'checkpoint.json'))){assert(!process.argv.includes('--stored-plan-worker-only'),'The Worker continuation requires its actual failed-source receipts');return;}
 const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),read=args=>execFileSync('git',args,{maxBuffer:64*1024*1024});
 const progress=verifyStoredPlanWorkerProgress(root,head),{partial,passed,failed,profile}=progress;assert.equal(partial.sha,profile.source);assert([p.worker.source,p.workerRetry.source,p.native.source].includes(profile.source));assert.equal(passed.length,8);assert.equal(failed.length,1);
 const helper='tests/helpers/canvas-agent-settlement-review-control.mjs';
 assert.throws(()=>assertStoredPlanTree(head,args=>args[0]==='show'&&args[1]===head+':'+helper?Buffer.from('unreviewed fixture'):read(args)));
 assert.throws(()=>assertStoredPlanTree(head,args=>args[0]==='diff'&&[p.worker.source,p.workerRetry.source,p.native.source,p.guard.source].includes(args[2])?Buffer.concat([read(args),Buffer.from('workers/auth/src/lib/canvas-agent-graph.js\n')]):read(args)));
 const old=workerDiscovery(parseDiscovery(fs.readFileSync(path.join(root,'reuse/test-results/stored-plan-origin/test-results/settlement-worker-discovery.json'),'utf8')));
 // Disposable verifier calibration only: actual acceptance still requires the
 // separate executed corrected report and complete current --list receipts.
 const corrected={...failed[0],results:[{status:'passed',retry:0,error:false}]},discovery=[...old,...passed,...failed];
 assert.deepEqual(verifyStoredPlanWorkerUnion(old,discovery,[...passed,corrected]),{retained:1574,executed:9,required:1583});
 for(const bad of [passed,[...passed,...failed],[...passed,corrected,passed[0]],[...passed,{...corrected,results:[{status:'passed',retry:1}]}], [...passed,{...corrected,id:'unreviewed'}]])assert.throws(()=>verifyStoredPlanWorkerUnion(old,discovery,bad));
 assert.throws(()=>verifyStoredPlanWorkerUnion(old,discovery.slice(1),[...passed,corrected]));
 assert.equal(storedPlanCommand(partial.commands[17].command,{progress:true}),'npm run test:local-release -- --stored-plan-worker-only');
 const command=storedPlanCommand(partial.commands[41].command,{progress:true,native:!!progress.native});
 assert(command.includes('--grep "(?:Canvas stored planning settlement continuation-revalidation)$"'));assert(command.includes('--output=test-results/stored-plan-worker-artifacts'));assert(command.includes('--retries=0'));if(!progress.native)assert(command.includes('stored-plan-worker-corrected.json'));assert(command.includes('--suite '+(progress.native?'canvas-settlement-recovery':'canvas-settlement-continuation')));assert(!command.includes('stored-plan-worker-fresh.json'));assert(!command.includes('npm run test:workers'));
 assert.deepEqual([...STORED_PLAN_WORKER_REFRESH],[2,3,12,17,34,41,43,45]);
 if(progress.native){
  // Execute the exact rendered selection with logging-only command shims.
  // Dormant CI branches are not evidence of executed cases; no external tool
  // or provider is reachable through these npx/node/npm replacements.
  const observe=script=>{
   const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-command-observation-')),bin=path.join(directory,'bin'),trace=path.join(directory,'trace.jsonl');fs.mkdirSync(bin);
   try{
    const shim='#!'+process.execPath+'\n'+"const fs=require('node:fs'),path=require('node:path');fs.appendFileSync(process.env.BITBI_COMMAND_TRACE,JSON.stringify({tool:path.basename(process.argv[1]),args:process.argv.slice(2)})+'\\n');\n";
    for(const tool of ['npx','node','npm'])fs.writeFileSync(path.join(bin,tool),shim,{mode:0o700});
    const result=spawnSync('/bin/bash',['--noprofile','--norc','-euo','pipefail','-c',script],{cwd:directory,env:{PATH:bin+':/usr/bin:/bin',BITBI_COMMAND_TRACE:trace},encoding:'utf8',timeout:10000});assert.equal(result.status,0,result.stderr);
    return fs.existsSync(trace)?fs.readFileSync(trace,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)):[];
   }finally{fs.rmSync(directory,{recursive:true,force:true});}
  };
  const assertSelected=calls=>{
   assert.equal(calls.length,7,'Missing or extra selected command observation');
   const discovery=calls.filter(row=>row.tool==='npx');assert.equal(discovery.length,2);assert(discovery.every(row=>row.args.includes('--list')&&row.args.includes('--reporter=json')&&!row.args.includes('--reporter=list,json')),'Completed Node cases executed');
   assert.deepEqual(calls.filter(row=>row.tool==='node').map(row=>row.args),[['scripts/local-release.mjs','verify-stored-plan-workers','.local-release','pending'],['scripts/local-release.mjs','verify-stored-plan-workers','.local-release'],['scripts/test-q2-runtime.mjs','--suite','canvas-settlement-recovery'],['scripts/local-release.mjs','verify-stored-plan-native','.local-release']]);
   assert.deepEqual(calls.filter(row=>row.tool==='npm').map(row=>row.args),[['run','test:auth','--','--list','--reporter=json']]);
  };
  assertSelected(observe(command));assert.throws(()=>assertSelected(observe(command+'\nnpx playwright test -c playwright.workers.config.js --retries=0\n')));assert.throws(()=>assertSelected(observe('true')));
  assert.deepEqual([...storedPlanFreshIndexes(profile)].sort((a,b)=>a-b),[2,3,7,12,17,29,34,40,41,43,45]);
  if(fs.existsSync(path.join(root,'reuse/test-results/stored-plan-guard/checkpoint.json'))){assert.equal(verifyStoredPlanGuard(root,head,progress).commands[17].exitCode,1);assert.deepEqual([...STORED_PLAN_GUARD_REFRESH],[2,3,12,17,29,34,40,41,43,45]);}

  const {canvasSettlementContinuationInventory:inventory,canvasSettlementRecoveryInventory:fresh,canvasSettlementRecoveryRetainedInventory:retained,runCanvasSettlementRecoveryTests}=await import('../tests/helpers/q2-runtime/canvas-policy-tail.mjs');
  const {parseRuntimeArgs}=await import('../tests/helpers/q2-runtime/linux-hosted.mjs'),{selectedRuntimeSuites,runtimeSuites}=await import('../tests/helpers/q2-runtime/runner.mjs');
  assert.equal(parseRuntimeArgs(['--suite','canvas-settlement-recovery'],{}).suite,'canvas-settlement-recovery');assert.throws(()=>parseRuntimeArgs(['--suite','canvas-settlement-recovery-other'],{}));assert.equal(selectedRuntimeSuites('canvas-settlement-recovery')[0][1],runCanvasSettlementRecoveryTests);assert(!runtimeSuites.some(([,run])=>run===runCanvasSettlementRecoveryTests));
  const previous=JSON.parse(fs.readFileSync(path.join(root,'reuse/test-results/stored-plan-origin/runtime/q2-runtime-evidence/native-Dvjqr1/reports/bitbi-q2-runtime-gLE6HW__result.json'))),oldNames=previous.reports.find(row=>row.suite==='canvas').records.map(row=>row.name),position=oldNames.indexOf('canvas_planning_settlement_identity')+1;assert(position>0);
  const names=[...oldNames.slice(0,position),...inventory,...oldNames.slice(position)],metrics={retained:oldNames,discovery:names,inventory:[...inventory],retainedContinuation:[...retained],fresh:[...fresh]};
  const result={passed:5,failedSuites:0,reports:[{suite:'canvas',records:fresh.map(name=>({name,status:'PASS'})),metrics:[{settlementContinuation:metrics}],failure:null}]};
  assert.deepEqual(verifyStoredPlanNative(previous,result,progress.native),{retained:387,executed:5,required:392});
  for(const mutate of [r=>r.reports[0].records.pop(),r=>r.reports[0].records.push(progress.native[0]),r=>r.reports[0].records[0].status='FAIL',r=>r.reports[0].metrics[0].settlementContinuation.discovery.pop(),r=>r.reports[0].metrics[0].settlementContinuation.retainedContinuation.pop()]){const bad=structuredClone(result);mutate(bad);assert.throws(()=>verifyStoredPlanNative(previous,bad,progress.native));}
  assert.throws(()=>verifyStoredPlanNative(previous,result,progress.native.slice(1)));
  const source=fs.readFileSync('tests/helpers/q2-runtime/canvas-policy-tail.mjs','utf8'),url=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64'),adapter=async names=>import(url(source.replace("'./canvas.mjs'",JSON.stringify(url('export async function runCanvasTests(f){for(const name of '+JSON.stringify(names)+')await f.test(name,async()=>f.calls.push(name));}')))));
  const fixture=()=>({calls:[],metrics:[],test:async(name,operation)=>operation()}),f=fixture();await(await adapter(names)).runCanvasSettlementRecoveryTests(f);assert.deepEqual(f.calls,fresh);assert.deepEqual(f.metrics,[{settlementContinuation:metrics}]);
  for(const bad of [names.slice(1),names.filter(name=>name!==retained[0]),names.filter(name=>name!==fresh[0]),[...names,names[0]]])await assert.rejects(()=>adapter(bad).then(module=>module.runCanvasSettlementRecoveryTests(fixture())));
 }

 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-stored-plan-worker-'));
 try{
  const snapshot=path.join(temporary,'proof');fs.cpSync(root,snapshot,{recursive:true});
  for(const file of ['checkpoint.json','logs/17.log','logs/41.log','test-results/worker-failed.json']){
   const target=path.join(snapshot,relative,file),bytes=fs.readFileSync(target);fs.writeFileSync(target,'forged');assert.throws(()=>verifyStoredPlanWorkerProgress(snapshot,head));fs.writeFileSync(target,bytes);
  }
  if(profile===p.workerRetry)for(const file of ['checkpoint.json','logs/17.log','logs/41.log','test-results/worker-failed.json']){const target=path.join(snapshot,'reuse/test-results/stored-plan-worker-retry',file),bytes=fs.readFileSync(target);fs.writeFileSync(target,'forged');assert.throws(()=>verifyStoredPlanWorkerProgress(snapshot,head));fs.writeFileSync(target,bytes);}
  if(progress.native)for(const file of ['checkpoint.json','logs/41.log','test-results/worker-completed.json','native.log',...Object.keys(profile.proof).map(file=>'runtime/q2-runtime-evidence/native-Braz4y/'+file)]){const target=path.join(snapshot,'reuse/test-results/stored-plan-native-progress',file),bytes=fs.readFileSync(target);fs.writeFileSync(target,'forged');assert.throws(()=>verifyStoredPlanWorkerProgress(snapshot,head));fs.writeFileSync(target,bytes);}
  if(fs.existsSync(path.join(snapshot,'reuse/test-results/stored-plan-guard/checkpoint.json')))for(const file of ['checkpoint.json','logs/17.log']){const target=path.join(snapshot,'reuse/test-results/stored-plan-guard',file),bytes=fs.readFileSync(target);fs.writeFileSync(target,'forged');assert.throws(()=>verifyStoredPlanGuard(snapshot,head,progress));fs.writeFileSync(target,bytes);}
  assert.equal(verifyStoredPlanWorkerProgress(snapshot,head).passed.length,8);
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
 console.log(progress.native?'Stored-plan native continuation: all nine Node outcomes and two native passes retained under original sources; five fresh native cases mandatory; discovery, isolation, source and forged/missing/duplicate proof counterchecks passed.':'Stored-plan Worker continuation: eight actual Linux passes retained; only failed revalidation selected, seven native cases still mandatory; changed source, omitted/failed/retried/duplicate outcomes and forged receipts rejected.');
}
await testStoredPlanWorkerContinuation();

async function testAssistantPreflightContinuation() {
 const {ASSISTANT_PREFLIGHT:p,canvasPreflightProfile,assertCanvasPreflightTree,canvasPreflightPrefix,
  verifyCanvasPreflight,assistantPreflightGuardContinuation}=await import('./lib/local-release-evidence.mjs');
 const marker='Assistant preflight continuation: historical fixture pinned, retained prefix authenticated, changed inputs rejected and remaining verifier tail completed.';
 assert.equal(canvasPreflightProfile(p.source),p);
 assert.deepEqual(p.retain,[1,4,5,6,7,8,9,10,11,13,16]);
 assert.equal(assistantPreflightGuardContinuation('npm run test:local-release'),'npm run test:local-release -- --assistant-preflight-only');
 for(const command of ['echo skipped','npm run test:local-release -- --other','npm run test:local-release\nnpm run test:workers'])
  assert.throws(()=>assistantPreflightGuardContinuation(command));
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-assistant-preflight-')),bare=path.join(temporary,'git'),previousGitDir=process.env.GIT_DIR;
 try {
  execFileSync('git',['init','--bare',bare],{stdio:'pipe'});
  fs.writeFileSync(path.join(bare,'objects/info/alternates'),path.resolve(execFileSync('git',['rev-parse','--git-path','objects'],{encoding:'utf8'}).trim())+'\n');
  const env={...process.env,GIT_AUTHOR_NAME:'Synthetic',GIT_AUTHOR_EMAIL:'synthetic@example.invalid',GIT_COMMITTER_NAME:'Synthetic',GIT_COMMITTER_EMAIL:'synthetic@example.invalid'};
  const read=(args,input)=>execFileSync('git',['--git-dir',bare,...args],{env,input,stdio:['pipe','pipe','pipe']});
  const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const reviewed=read(['rev-list','--ancestry-path','--reverse',`${p.source}..${head}`]).toString().trim().split('\n')[0];
  assert(reviewed,'The closed assistant fixture requires its committed reviewed successor');
  const tooling=['scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs','scripts/test-local-release.mjs'];
  const fixes=Object.fromEntries([...new Set([...Object.keys(p.specs),...tooling])].map(file=>[file,read(['show',`${reviewed}:${file}`])]));
  for(const [file,hash]of Object.entries(p.specs))assert.equal(sha256(fixes[file]),hash,'Reviewed correction must match its exact pin');
  const commit=(changes,parent=p.source)=>{
   read(['read-tree',p.source]);for(const [file,value]of Object.entries(changes)){
    if(value===null){read(['update-index','--index-info'],Buffer.from(`0 ${'0'.repeat(40)}\t${file}\n`));continue;}
    const blob=read(['hash-object','-w','--stdin'],value.content??value).toString().trim();read(['update-index','--add','--cacheinfo',`${value.mode||'100644'},${blob},${file}`]);
   }
   return read(['commit-tree',read(['write-tree']).toString().trim(),'-p',parent],Buffer.from('Synthetic assistant preflight guard continuation\n')).toString().trim();
  };
  const accepted=commit(fixes);assertCanvasPreflightTree(accepted,read,p);
  for(const file of Object.keys(p.specs))for(const value of [null,Buffer.from('Unreviewed correction'),{mode:'120000',content:Buffer.from('outside')}])
   assert.throws(()=>assertCanvasPreflightTree(commit({...fixes,[file]:value}),read,p));
  for(const file of ['workers/auth/src/routes/canvas.js','package-lock.json','.github/workflows/static.yml','config/release-validation.yml','config/release-compat.json'])
   assert.throws(()=>assertCanvasPreflightTree(commit({...fixes,[file]:Buffer.from('Unreviewed retained input')}),read,p));
  for(const file of tooling)assert.throws(()=>assertCanvasPreflightTree(commit({...fixes,[file]:{mode:'120000',content:Buffer.from('outside')}}),read,p));
  assert.throws(()=>assertCanvasPreflightTree(commit(fixes,accepted),read,p),'A later successor cannot silently inherit the prefix');
  const origin='.local-release',checkpointPath=path.join(origin,'reuse/preflight-checkpoint.json');
  const hasOriginal=fs.existsSync(checkpointPath)&&JSON.parse(fs.readFileSync(checkpointPath)).sha===p.source;
  assert(hasOriginal||!assistantPreflightTail,'Focused continuation requires the actual failed checkpoint');
  if(hasOriginal){
   const bytes=fs.readFileSync(checkpointPath),original=JSON.parse(bytes),proof=path.join(temporary,'proof');
   fs.mkdirSync(path.join(proof,'reuse'),{recursive:true});fs.mkdirSync(path.join(proof,'logs'));
   for(const file of ['preflight-checkpoint.json','preflight-failed.log'])fs.copyFileSync(path.join(origin,'reuse',file),path.join(proof,'reuse',file));
   process.env.GIT_DIR=bare;
   const selection=gitSelection(original.base,accepted),commands=selectedCommands(selection,{GITHUB_SHA:accepted,CANDIDATE_BASE:original.base});
   const context={sha:accepted,base:original.base,planHash:validationPlan().digest,selection,environment:original.environment,nativeBrowsers:original.nativeBrowsers,commands};
   assert.equal(canvasPreflightPrefix(bytes,context).sha,p.source);
   for(const mutate of [r=>r.status='passed',r=>r.commands[17].exitCode=0,r=>r.commands[1].exitCode=1,r=>r.commands.pop()]){
    const changed=structuredClone(original);mutate(changed);assert.throws(()=>canvasPreflightPrefix(Buffer.from(JSON.stringify(changed)),context));
   }
   for(const mutate of [r=>r.base='f'.repeat(40),r=>r.planHash='changed',r=>r.environment.key='changed',r=>r.environment.image='changed',r=>r.environment.inputs['package-lock.json']='changed',r=>r.selection.full=!r.selection.full,r=>r.commands.pop(),r=>r.commands[17].run='echo skipped']){
    const changed=structuredClone(context);mutate(changed);assert.throws(()=>canvasPreflightPrefix(bytes,changed));
   }
   // Synthetic verifier records calibrate the proof checker only; they are not
   // acceptance receipts and never enter the real release evidence directory.
   const rows=commands.map((command,index)=>{
    if(p.retain.includes(index)){
     const row={...original.commands[index],reusedFrom:p.source};fs.copyFileSync(path.join(origin,row.log),path.join(proof,row.log));return row;
    }
    const log=`logs/${index}.log`,content=index===17?marker+'\n':'Synthetic fresh verifier row; no product acceptance claimed.\n';fs.writeFileSync(path.join(proof,log),content);
    return {command,exitCode:0,log,logHash:sha256(content),durationMs:1,...(index===17?{continuation:assistantPreflightGuardContinuation(command.run)}:{})};
   });
   const evidence={...context,commands:rows,preflightContinuation:{source:p.source,checkpoint:p.checkpoint}};
   verifyCanvasPreflight(proof,evidence,commands);
   for(const index of [0,2,3,12,14,15,17,18,41]){const forged=structuredClone(evidence);forged.commands[index].reusedFrom=p.source;assert.throws(()=>verifyCanvasPreflight(proof,forged,commands));}
   const wrong=structuredClone(evidence);wrong.commands[17].continuation='npm run test:local-release';assert.throws(()=>verifyCanvasPreflight(proof,wrong,commands));
   for(const file of ['reuse/preflight-failed.log','logs/1.log','logs/17.log']){
    const target=path.join(proof,file),saved=fs.readFileSync(target);fs.writeFileSync(target,'forged evidence');assert.throws(()=>verifyCanvasPreflight(proof,evidence,commands));fs.writeFileSync(target,saved);
   }
   const target=path.join(proof,'logs/17.log'),saved=fs.readFileSync(target);
   for(const line of ['','Local command mapping, no hosted duplicate suites','Pinned chromium launch and keyboard smoke']){
    const changed=structuredClone(evidence),content=line?marker+'\n'+line+'\n':'Missing completion marker\n';
    fs.writeFileSync(target,content);changed.commands[17].logHash=sha256(content);assert.throws(()=>verifyCanvasPreflight(proof,changed,commands));
   }
   fs.writeFileSync(target,saved);verifyCanvasPreflight(proof,evidence,commands);
  }
 }finally{if(previousGitDir===undefined)delete process.env.GIT_DIR;else process.env.GIT_DIR=previousGitDir;fs.rmSync(temporary,{recursive:true,force:true});}
 console.log(marker);
}
await testAssistantPreflightContinuation();

async function testAssistantWorkerContinuation() {
 const {ASSISTANT_WORKER_PREFLIGHT:p,canvasPreflightProfile,assertCanvasPreflightTree,canvasPreflightPrefix,
  assistantWorkerFailures,assistantWorkerNewCase,assistantWorkerGuardContinuation,assistantWorkerContinuation,
  verifyAssistantWorkerRepair,verifyAssistantWorkerUnion}=await import('./lib/local-release-evidence.mjs');
 const marker='Assistant Worker continuation: 1617 original passes, 12 corrected cases and one new organization case require exact-source receipts; missing, forged, retried, duplicate and changed-discovery controls reject.';
 assert.equal(canvasPreflightProfile(p.source),p);
 assert.equal(assistantWorkerGuardContinuation('npm run test:local-release'),'npm run test:local-release -- --assistant-worker-only');
 for(const command of ['echo skipped','npm run test:local-release -- --other','npm run test:local-release\nnpm run test:workers'])assert.throws(()=>assistantWorkerGuardContinuation(command));
 for(const index of [0,2,3,7,12,14,15,16,17,29,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51])assert(!p.retain.includes(index),'Changed source gates and unfinished media/native/browser tail cannot inherit passes');
 const passed=Array.from({length:1617},(_,index)=>({id:'synthetic-passed-'+index,file:'unchanged.spec.js',title:'Synthetic retained '+index,results:[{status:'passed',retry:0}]}));
 const failed=assistantWorkerFailures.map((title,index)=>({id:'synthetic-failed-'+index,file:'failed.spec.js',title,results:[{status:'failed',retry:0},{status:'failed',retry:1}]}));
 const added={id:'synthetic-organization',...assistantWorkerNewCase},previous=[...passed,...failed],discovery=[...previous,added];
 const fresh=[...failed,added].map(row=>({...row,results:[{status:'passed',retry:0}]}));
 const union=(progress=fresh,required=discovery,prior=previous)=>verifyAssistantWorkerUnion({previous:prior,discovery:required,progress});
 assert.deepEqual(union(),{originalPassed:1617,correctedPassed:12,newPassed:1,total:1630});
 for(const bad of [fresh.slice(1),fresh.slice(0,-1),[...fresh,fresh[0]],[...fresh,passed[0]],fresh.map((row,index)=>index?row:{...row,results:[{status:'failed',retry:0}]}),
  fresh.map((row,index)=>index?row:{...row,results:[{status:'passed',retry:1}]}),fresh.map(row=>row.id===added.id?{...row,results:[{status:'passed',retry:1}]}:row),
  fresh.map(row=>row.id===added.id?{...row,title:'Wrong organization assertion'}:row)])assert.throws(()=>union(bad));
 for(const bad of [discovery.slice(1),discovery.slice(0,-1),[...discovery,added],[...discovery,{...added,id:'unreviewed'}],discovery.map((row,index)=>index?row:{...row,title:'Changed retained input'})])assert.throws(()=>union(fresh,bad));
 const brokenPrior=structuredClone(previous);brokenPrior[0].results=[{status:'failed',retry:0}];assert.throws(()=>union(fresh,discovery,brokenPrior));
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-assistant-worker-')),bare=path.join(temporary,'git'),previousGitDir=process.env.GIT_DIR;
 try {
  execFileSync('git',['init','--bare',bare],{stdio:'pipe'});
  fs.writeFileSync(path.join(bare,'objects/info/alternates'),path.resolve(execFileSync('git',['rev-parse','--git-path','objects'],{encoding:'utf8'}).trim())+'\n');
  const env={...process.env,GIT_AUTHOR_NAME:'Synthetic',GIT_AUTHOR_EMAIL:'synthetic@example.invalid',GIT_COMMITTER_NAME:'Synthetic',GIT_COMMITTER_EMAIL:'synthetic@example.invalid'};
  const read=(args,input)=>execFileSync('git',['--git-dir',bare,...args],{env,input,stdio:['pipe','pipe','pipe'],maxBuffer:64*1024*1024});
  const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),reviewed=read(['rev-list','--ancestry-path','--reverse',`${p.source}..${head}`]).toString().trim().split('\n')[0];
  assert(reviewed,'The closed Worker fixture requires its committed reviewed successor');
  const tooling=['scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs','scripts/test-local-release.mjs'];
  const fixes=Object.fromEntries([...new Set([...Object.keys(p.specs),...tooling])].map(file=>[file,read(['show',`${reviewed}:${file}`])]));
  for(const [file,hash]of Object.entries(p.specs))assert.equal(sha256(fixes[file]),hash,'Reviewed correction must match its exact pin');
  const commit=(changes,parent=p.source)=>{
   read(['read-tree',p.source]);for(const [file,value]of Object.entries(changes)){
    if(value===null){read(['update-index','--index-info'],Buffer.from(`0 ${'0'.repeat(40)}\t${file}\n`));continue;}
    const blob=read(['hash-object','-w','--stdin'],value.content??value).toString().trim();read(['update-index','--add','--cacheinfo',`${value.mode||'100644'},${blob},${file}`]);
   }return read(['commit-tree',read(['write-tree']).toString().trim(),'-p',parent],Buffer.from('Synthetic closed assistant Worker continuation\n')).toString().trim();
  };
  const accepted=commit(fixes);assertCanvasPreflightTree(accepted,read,p);
  for(const file of Object.keys(p.specs))for(const value of [null,Buffer.from('Unreviewed correction'),{mode:'120000',content:Buffer.from('outside')}])assert.throws(()=>assertCanvasPreflightTree(commit({...fixes,[file]:value}),read,p));
  for(const file of ['workers/auth/migrations/0112_canvas_assistant_models_and_scheduling.sql','frontend/index.mjs','services/homepage-ffmpeg-processor/index.mjs','package-lock.json','.github/workflows/static.yml','config/release-validation.yml'])assert.throws(()=>assertCanvasPreflightTree(commit({...fixes,[file]:Buffer.from('Unreviewed retained source')}),read,p));
  for(const file of tooling)assert.throws(()=>assertCanvasPreflightTree(commit({...fixes,[file]:{mode:'120000',content:Buffer.from('outside')}}),read,p));
  assert.throws(()=>assertCanvasPreflightTree(commit(fixes,accepted),read,p),'A later successor must not inherit the closed proof');
  const origin='.local-release',checkpoint=path.join(origin,'reuse/preflight-checkpoint.json');
  const hasOriginal=fs.existsSync(checkpoint)&&JSON.parse(fs.readFileSync(checkpoint)).sha===p.source;
  assert(hasOriginal||!process.argv.includes('--assistant-worker-only'),'Focused Worker continuation requires actual failed-source evidence');
  let originalCommand=selectedCommands(selectCiTests(['workers/auth/src/lib/image-generation-capacity.js']),{GITHUB_SHA:accepted,CANDIDATE_BASE:p.source}).find(row=>row.name==='Run worker route tests')?.run;
  let selectionRows=discovery;
  if(hasOriginal){
   const bytes=fs.readFileSync(checkpoint),original=JSON.parse(bytes),proof=path.join(temporary,'proof');
   fs.mkdirSync(proof);fs.cpSync(path.join(origin,'reuse'),path.join(proof,'reuse'),{recursive:true});fs.mkdirSync(path.join(proof,'test-results'));
   process.env.GIT_DIR=bare;
   const selection=gitSelection(original.base,accepted),commands=selectedCommands(selection,{GITHUB_SHA:accepted,CANDIDATE_BASE:original.base});
   const context={sha:accepted,base:original.base,planHash:validationPlan().digest,selection,environment:original.environment,nativeBrowsers:original.nativeBrowsers,commands};
   assert.equal(canvasPreflightPrefix(bytes,context).sha,p.source);
   for(const mutate of [row=>row.status='passed',row=>row.commands[41].exitCode=0,row=>row.commands[1].exitCode=1,row=>row.commands.pop(),row=>delete row.preflightContinuation]){
    const bad=structuredClone(original);mutate(bad);assert.throws(()=>canvasPreflightPrefix(Buffer.from(JSON.stringify(bad)),context));
   }
   for(const mutate of [row=>row.base='f'.repeat(40),row=>row.planHash='changed',row=>row.environment.key='changed',row=>row.environment.image='changed',row=>row.environment.inputs['package-lock.json']='changed',row=>row.selection.full=!row.selection.full,row=>row.commands.pop(),row=>row.commands[41].run='echo skipped']){
    const bad=structuredClone(context);mutate(bad);assert.throws(()=>canvasPreflightPrefix(bytes,bad));
   }
   const pending=verifyAssistantWorkerRepair(proof,accepted,{allowPending:true});
   assert.equal(pending.previous.length,1629);assert.equal(pending.result,null);assert.equal(pending.previous.filter(row=>row.results.length===1&&row.results[0].status==='passed').length,1617);
   assert.throws(()=>verifyAssistantWorkerRepair(proof,accepted),'Missing fresh execution is never a completed repair');
   originalCommand=original.commands[41].command.run;selectionRows=[...pending.previous,added];
   for(const file of ['reuse/preflight-checkpoint.json','reuse/preflight-failed.log','reuse/original-worker-last-run.json','reuse/original-worker-discovery.json','reuse/test-results/assistant-preflight-origin/reuse/preflight-checkpoint.json','reuse/test-results/assistant-preflight-origin/logs/17.log']){
    const target=path.join(proof,file),saved=fs.readFileSync(target);fs.unlinkSync(target);assert.throws(()=>verifyAssistantWorkerRepair(proof,accepted,{allowPending:true}));
    fs.writeFileSync(target,'forged evidence');assert.throws(()=>verifyAssistantWorkerRepair(proof,accepted,{allowPending:true}));fs.writeFileSync(target,saved);
   }
   verifyAssistantWorkerRepair(proof,accepted,{allowPending:true});
  }
  const command=assistantWorkerContinuation(originalCommand);
  const observe=script=>{
   const directory=fs.mkdtempSync(path.join(temporary,'commands-')),bin=path.join(directory,'bin'),trace=path.join(directory,'trace.jsonl');fs.mkdirSync(bin);
   const shim='#!'+process.execPath+'\n'+"const fs=require('node:fs'),path=require('node:path');fs.appendFileSync(process.env.BITBI_COMMAND_TRACE,JSON.stringify({tool:path.basename(process.argv[1]),args:process.argv.slice(2)})+'\\n');\n";
   for(const tool of ['npx','node','npm'])fs.writeFileSync(path.join(bin,tool),shim,{mode:0o700});
   const observed=spawnSync('/bin/bash',['--noprofile','--norc','-euo','pipefail','-c',script],{cwd:directory,env:{PATH:bin+':/usr/bin:/bin',BITBI_COMMAND_TRACE:trace,CI_MEMBER_ASSETS:'true',Q2_RUNTIME_ARTIFACTS:path.join(directory,'native')},encoding:'utf8',timeout:10000});
   assert.equal(observed.status,0,observed.stderr);
   return fs.existsSync(trace)?fs.readFileSync(trace,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)):[];
  };
  const assertSelected=calls=>{
   assert.equal(calls.length,6,'Missing or extra observed Worker command');
   const npx=calls.filter(row=>row.tool==='npx');assert.equal(npx.length,2);
   assert(npx[0].args.includes('--list')&&npx[0].args.includes('--reporter=json'),'Full discovery must run before execution');
   const args=npx[1].args,filter=args[args.indexOf('--grep')+1];assert(args.includes('--retries=0')&&args.includes('--workers=1')&&args.includes('--reporter=list,json')&&args.includes('--output=test-results/assistant-worker-artifacts'));
   assert.deepEqual(selectionRows.filter(row=>new RegExp(filter).test(row.label||row.title)).map(row=>row.title).sort(),[...assistantWorkerFailures,assistantWorkerNewCase.title].sort(),'Rendered selection must execute exactly the twelve failed cases plus the new organization control');
   assert.deepEqual(calls.filter(row=>row.tool==='node').map(row=>row.args),[['scripts/local-release.mjs','verify-assistant-worker-pending','.local-release'],['scripts/local-release.mjs','verify-assistant-worker-repair','.local-release']]);
   assert.deepEqual(calls.filter(row=>row.tool==='npm').map(row=>row.args),[['run','test:homepage-ffmpeg-processor'],['run','test:q2-runtime']],'Unexecuted real media/native chain remains mandatory');
  };
  assertSelected(observe(command));
  assert.throws(()=>assertSelected(observe('true')));
  assert.throws(()=>assertSelected(observe(command+'\nnpx playwright test -c playwright.workers.config.js --retries=0\n')));
  assert.throws(()=>assertSelected(observe(command.replace('npm run test:q2-runtime','true'))));
 }finally{if(previousGitDir===undefined)delete process.env.GIT_DIR;else process.env.GIT_DIR=previousGitDir;fs.rmSync(temporary,{recursive:true,force:true});}
 console.log(marker);
}
await testAssistantWorkerContinuation();

async function testAssistantNativeContinuation() {
 const {ASSISTANT_NATIVE_PREFLIGHT:p,canvasPreflightProfile,assertCanvasPreflightTree,canvasPreflightPrefix,
  assistantNativeGuardContinuation,assistantNativeContinuation,assistantLauncherFailures,
  verifyAssistantNativeRepair,verifyAssistantLauncherUnion}=await import('./lib/local-release-evidence.mjs');
 const marker='Assistant native continuation: 1630 Worker cases, real media checks and 26 launcher passes retained; four corrected launcher cases and the complete native runtime remain mandatory.';
 assert.equal(canvasPreflightProfile(p.source),p);
 assert.equal(assistantNativeGuardContinuation('npm run test:local-release'),'npm run test:local-release -- --assistant-native-only');
 for(const command of ['echo skipped','npm run test:local-release -- --other','npm run test:local-release\nnpm run test:workers'])assert.throws(()=>assistantNativeGuardContinuation(command));
 for(const index of [0,2,3,12,14,15,17,34,40,41,42,43,44,45,46,47,48,49,50,51])assert(!p.retain.includes(index),'Fresh candidate, affected gates and unexecuted native/browser checks cannot inherit passes');
 assert(p.retain.includes(36),'Unchanged hosting evidence remains subject to exact-byte rebind after the mandatory fresh build');
 const retained=Array.from({length:26},(_,index)=>({title:'Synthetic retained launcher '+index,status:'passed'}));
 const before=[...retained,...assistantLauncherFailures.map(title=>({title,status:'failed'}))],after=assistantLauncherFailures.map(title=>({title,status:'passed'}));
 verifyAssistantLauncherUnion(before,after);
 for(const bad of [[],after.slice(1),[...after,after[0]],[...after,retained[0]],after.map((row,index)=>index?row:{...row,status:'failed'}),
  after.map((row,index)=>index?row:{...row,status:'skipped'}),after.map((row,index)=>index?row:{...row,title:'Foreign launcher'})])assert.throws(()=>verifyAssistantLauncherUnion(before,bad));
 for(const bad of [before.slice(1),[...before,before[0]],before.map((row,index)=>index?row:{...row,status:'failed'}),before.map(row=>row.title===assistantLauncherFailures[0]?{...row,status:'passed'}:row)])assert.throws(()=>verifyAssistantLauncherUnion(bad,after));
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-assistant-native-')),bare=path.join(temporary,'git'),previousGitDir=process.env.GIT_DIR;
 try {
  execFileSync('git',['init','--bare',bare],{stdio:'pipe'});
  fs.writeFileSync(path.join(bare,'objects/info/alternates'),path.resolve(execFileSync('git',['rev-parse','--git-path','objects'],{encoding:'utf8'}).trim())+'\n');
  const env={...process.env,GIT_AUTHOR_NAME:'Synthetic',GIT_AUTHOR_EMAIL:'synthetic@example.invalid',GIT_COMMITTER_NAME:'Synthetic',GIT_COMMITTER_EMAIL:'synthetic@example.invalid'};
  const read=(args,input)=>execFileSync('git',['--git-dir',bare,...args],{env,input,stdio:['pipe','pipe','pipe'],maxBuffer:64*1024*1024});
  const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),reviewed=read(['rev-list','--ancestry-path','--reverse',`${p.source}..${head}`]).toString().trim().split('\n')[0];
  assert(reviewed,'The closed native fixture requires its committed reviewed successor');
  const tooling=['scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs','scripts/test-local-release.mjs'];
  const fixes=Object.fromEntries([...new Set([...Object.keys(p.specs),...tooling])].map(file=>[file,read(['show',`${reviewed}:${file}`])]));
  for(const[file,hash]of Object.entries(p.specs))assert.equal(sha256(fixes[file]),hash,'Reviewed native correction must match its pin');
  const commit=(changes,parent=p.source)=>{
   read(['read-tree',p.source]);for(const[file,value]of Object.entries(changes)){
    if(value===null){read(['update-index','--index-info'],Buffer.from(`0 ${'0'.repeat(40)}\t${file}\n`));continue;}
    const blob=read(['hash-object','-w','--stdin'],value.content??value).toString().trim();read(['update-index','--add','--cacheinfo',`${value.mode||'100644'},${blob},${file}`]);
   }return read(['commit-tree',read(['write-tree']).toString().trim(),'-p',parent],Buffer.from('Synthetic closed assistant native continuation\n')).toString().trim();
  };
  const accepted=commit(fixes);assertCanvasPreflightTree(accepted,read,p);
  for(const file of Object.keys(p.specs))for(const value of [null,Buffer.from('Unreviewed fixture'),{mode:'120000',content:Buffer.from('outside')}])assert.throws(()=>assertCanvasPreflightTree(commit({...fixes,[file]:value}),read,p));
  for(const file of ['workers/auth/src/lib/image-generation-capacity.js','workers/auth/src/lib/canvas-agent-conversation.js','workers/auth/migrations/0112_canvas_assistant_models_and_scheduling.sql',
   'js/shared/canvas-conversation-decision-intent.mjs','frontend/index.mjs','package-lock.json','.github/workflows/static.yml','config/release-validation.yml'])assert.throws(()=>assertCanvasPreflightTree(commit({...fixes,[file]:Buffer.from('Unreviewed passed source')}),read,p));
  for(const file of tooling)assert.throws(()=>assertCanvasPreflightTree(commit({...fixes,[file]:{mode:'120000',content:Buffer.from('outside')}}),read,p));
  assert.throws(()=>assertCanvasPreflightTree(commit(fixes,accepted),read,p),'A later successor cannot inherit this closed proof');
  const origin='.local-release',checkpoint=path.join(origin,'reuse/preflight-checkpoint.json'),hasOriginal=fs.existsSync(checkpoint)&&JSON.parse(fs.readFileSync(checkpoint)).sha===p.source;
  assert(hasOriginal||!process.argv.includes('--assistant-native-only'),'Focused native continuation requires actual failed-source evidence');
  let originalCommand=selectedCommands(selectCiTests(['workers/auth/src/lib/image-generation-capacity.js']),{GITHUB_SHA:accepted,CANDIDATE_BASE:p.source}).find(row=>row.name==='Run worker route tests')?.run;
  let originalLauncher=before;
  if(hasOriginal){
   const bytes=fs.readFileSync(checkpoint),original=JSON.parse(bytes),proof=path.join(temporary,'proof');
   fs.mkdirSync(proof);fs.cpSync(path.join(origin,'reuse'),path.join(proof,'reuse'),{recursive:true});fs.mkdirSync(path.join(proof,'test-results'));
   process.env.GIT_DIR=bare;
   const selection=gitSelection(original.base,accepted),commands=selectedCommands(selection,{GITHUB_SHA:accepted,CANDIDATE_BASE:original.base});
   const context={sha:accepted,base:original.base,planHash:validationPlan().digest,selection,environment:original.environment,nativeBrowsers:original.nativeBrowsers,commands};
   assert.equal(canvasPreflightPrefix(bytes,context).sha,p.source);
   for(const mutate of [row=>row.status='passed',row=>row.commands[41].exitCode=0,row=>row.commands[40].exitCode=1,row=>row.commands.pop(),row=>delete row.preflightContinuation]){
    const bad=structuredClone(original);mutate(bad);assert.throws(()=>canvasPreflightPrefix(Buffer.from(JSON.stringify(bad)),context));
   }
   for(const mutate of [row=>row.base='f'.repeat(40),row=>row.planHash='changed',row=>row.environment.key='changed',row=>row.environment.image='changed',row=>row.environment.inputs['package-lock.json']='changed',
    row=>row.selection.full=!row.selection.full,row=>row.commands.pop(),row=>row.commands[41].run='echo skipped']){
    const bad=structuredClone(context);mutate(bad);assert.throws(()=>canvasPreflightPrefix(bytes,bad));
   }
   const pending=verifyAssistantNativeRepair(proof,accepted,{allowPending:true});
   assert.equal(pending.before.length,30);assert.equal(pending.before.filter(row=>row.status==='passed').length,26);assert.equal(pending.result,null);
   assert.throws(()=>verifyAssistantNativeRepair(proof,accepted),'Missing fresh launcher results are never success');
   originalLauncher=pending.before;originalCommand=original.commands[41].command.run;
   for(const file of ['reuse/preflight-checkpoint.json','reuse/preflight-failed.log','reuse/hosting-manifest.json','reuse/hosting-proof.json',
    'reuse/test-results/assistant-worker-origin/reuse/preflight-checkpoint.json','reuse/test-results/assistant-worker-origin/reuse/preflight-failed.log',
    'reuse/test-results/assistant-worker-origin/logs/17.log','reuse/test-results/assistant-worker-origin/test-results/assistant-worker-discovery.json',
    'reuse/test-results/assistant-worker-origin/test-results/assistant-worker-fresh.json']){
    const target=path.join(proof,file),saved=fs.readFileSync(target);fs.unlinkSync(target);assert.throws(()=>verifyAssistantNativeRepair(proof,accepted,{allowPending:true}));
    fs.writeFileSync(target,'forged evidence');assert.throws(()=>verifyAssistantNativeRepair(proof,accepted,{allowPending:true}));fs.writeFileSync(target,saved);
   }
   const originalDiscovery=fs.readFileSync(path.join(proof,'reuse/test-results/assistant-worker-origin/test-results/assistant-worker-discovery.json'));
   const discovery=JSON.parse(originalDiscovery),discoveryFile=path.join(proof,'test-results/assistant-native-worker-discovery.json');
   fs.writeFileSync(discoveryFile,originalDiscovery);verifyAssistantNativeRepair(proof,accepted,{allowPending:true});
   const firstSuite=report=>{const pending=[...report.suites];while(pending.length){const suite=pending.shift();if(suite.specs?.length)return suite;pending.push(...suite.suites||[]);}throw new Error('Missing original Worker discovery');};
   for(const mutate of [row=>row.errors.push({message:'discovery failed'}),row=>firstSuite(row).specs.pop(),row=>firstSuite(row).specs.push(firstSuite(row).specs[0]),row=>firstSuite(row).specs[0].title='Changed retained case']){
    const bad=structuredClone(discovery);mutate(bad);fs.writeFileSync(discoveryFile,JSON.stringify(bad,null,2));assert.throws(()=>verifyAssistantNativeRepair(proof,accepted,{allowPending:true}));
   }
   fs.writeFileSync(discoveryFile,originalDiscovery);
   // Synthetic evidence calibrates validation, not actual execution. Canonical
   // command 41 must produce the four real launcher outcomes and native result.
   const tap=`TAP version 13\n${assistantLauncherFailures.map((title,index)=>`ok ${index+1} - ${title}`).join('\n')}\n1..4\n# tests 4\n# suites 0\n# pass 4\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n`;
   const tapFile=path.join(proof,'test-results/assistant-launcher-fresh.tap');fs.writeFileSync(tapFile,tap);
   assert.deepEqual(verifyAssistantNativeRepair(proof,accepted).result,{workerPassed:1630,processorPassed:true,launcherRetained:26,launcherFresh:4,launcherTotal:30});
   for(const content of ['',tap.replace('ok 1 -','not ok 1 -'),tap.replaceAll(assistantLauncherFailures[0],'Foreign launcher case'),tap+`ok 5 - ${assistantLauncherFailures[0]}\n`,tap+`ok 5 - ${retained[0].title}\n`,tap.replace('ok 1 - '+assistantLauncherFailures[0],'ok 1 - '+assistantLauncherFailures[0]+' # SKIP')]){
    fs.writeFileSync(tapFile,content);assert.throws(()=>verifyAssistantNativeRepair(proof,accepted));
   }
   fs.writeFileSync(tapFile,tap);
  }
  const shell=assistantNativeContinuation(originalCommand);assert(!shell.includes('npm run test:workers')&&!shell.includes('npm run test:homepage-ffmpeg-processor'),'Passed Worker/media suites cannot execute again');
  assert.throws(()=>assistantNativeContinuation('npm run test:workers'));
  const flow=path.join(temporary,'flow');fs.mkdirSync(flow);const trace=path.join(flow,'trace.jsonl');
  const shim=`set -euo pipefail\nnpx(){ printf '%s\\n' "discovery|$*" >> "$TRACE"; [ "$FAIL_STAGE" != discovery ]; }\nnode(){ case "$*" in *verify-assistant-native-pending*) stage=pending;; *--test*) stage=launcher;; *verify-assistant-native-repair*) stage=verify;; *test-q2-runtime.mjs*) stage=native;; *) return 98;; esac; printf '%s\\n' "$stage|$*" >> "$TRACE"; [ "$FAIL_STAGE" != "$stage" ]; }\ncat(){ :; }\n`;
  const stages=['discovery','pending','launcher','verify','native'];
  for(const failed of ['',...stages]){
   fs.rmSync(trace,{force:true});const result=spawnSync('/bin/bash',['--noprofile','--norc','-euo','pipefail','-c',shim+shell],{cwd:flow,env:{...process.env,TRACE:trace,FAIL_STAGE:failed},encoding:'utf8',timeout:10000});
   assert.equal(result.status,failed?1:0,result.stderr);
   const rows=fs.readFileSync(trace,'utf8').trim().split('\n').map(line=>{const at=line.indexOf('|');return {stage:line.slice(0,at),args:line.slice(at+1)};});
   assert.deepEqual(rows.map(row=>row.stage),failed?stages.slice(0,stages.indexOf(failed)+1):stages,'No later work may run after a failed boundary');
   if(!failed){
    assert.equal(rows[0].args,'playwright test -c playwright.workers.config.js --list --reporter=json');
    const launcher=rows[2].args,match=launcher.match(/^--test --test-name-pattern=(.*?) scripts\/test-q2-runtime-launcher\.mjs$/);assert(match,'Only the one launcher file and exact failed-name filter may execute');
    assert.deepEqual(originalLauncher.filter(row=>new RegExp(match[1]).test(row.title)).map(row=>row.title),assistantLauncherFailures);
    assert.equal(rows[4].args,'scripts/test-q2-runtime.mjs','The complete previously unexecuted native runtime remains required');
   }
  }
 }finally{if(previousGitDir===undefined)delete process.env.GIT_DIR;else process.env.GIT_DIR=previousGitDir;fs.rmSync(temporary,{recursive:true,force:true});}
 console.log(marker);
}
await testAssistantNativeContinuation();

async function testAssistantNativeProgress() {
 const repositoryRoot=fs.realpathSync(new URL('..',import.meta.url));
 const {ASSISTANT_NATIVE_PROGRESS:p,canvasPreflightProfile,assertCanvasPreflightTree,canvasPreflightPrefix,
  assistantNativeProgressGuard,assistantNativeProgressContinuation,verifyAssistantNativeProgress,
  verifyAssistantNativeProgressUnion}=await import('./lib/local-release-evidence.mjs');
 const marker='Assistant native progress: 1630 Worker, media, 30 launcher and 184 native passes retained; exact 250 remaining Canvas callbacks required with full isolation and inventory evidence.';
 assert.equal(canvasPreflightProfile(p.source),p);
 assert.equal(assistantNativeProgressGuard('npm run test:local-release'),'npm run test:local-release -- --assistant-native-progress-only');
 for(const command of ['true','npm run test:local-release -- --assistant-native-only','npm run test:local-release\nnpm run test:workers'])assert.throws(()=>assistantNativeProgressGuard(command));
 for(const index of [0,2,3,12,14,15,17,34,40,41,42,43,44,45,46,47,48,49,50,51])assert(!p.retain.includes(index),'Affected verification and unexecuted browser gates remain fresh');
 assert(p.retain.includes(36),'Unchanged hosting proof still requires a fresh candidate and strict byte rebind');
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-assistant-native-progress-')),bare=path.join(temporary,'git'),previousGitDir=process.env.GIT_DIR;
 try {
  execFileSync('git',['init','--bare',bare],{stdio:'pipe'});
  fs.writeFileSync(path.join(bare,'objects/info/alternates'),path.resolve(execFileSync('git',['rev-parse','--git-path','objects'],{encoding:'utf8'}).trim())+'\n');
  const env={...process.env,GIT_AUTHOR_NAME:'Synthetic',GIT_AUTHOR_EMAIL:'synthetic@example.invalid',GIT_COMMITTER_NAME:'Synthetic',GIT_COMMITTER_EMAIL:'synthetic@example.invalid'};
  const read=(args,input)=>execFileSync('git',['--git-dir',bare,...args],{env,input,stdio:['pipe','pipe','pipe'],maxBuffer:64*1024*1024});
  const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),reviewed=read(['rev-list','--ancestry-path','--reverse',`${p.source}..${head}`]).toString().trim().split('\n')[0];
  assert(reviewed,'The closed native progress fixture requires its committed reviewed successor');
  const tooling=['scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs','scripts/test-local-release.mjs'];
  const fixes=Object.fromEntries([...new Set([...Object.keys(p.specs),...tooling])].map(file=>[file,read(['show',`${reviewed}:${file}`])]));
  for(const[file,hash]of Object.entries(p.specs))assert.equal(sha256(fixes[file]),hash,'Reviewed native progress correction must match its pin');
  const commit=(changes,parent=p.source)=>{
   read(['read-tree',p.source]);for(const[file,value]of Object.entries(changes)){
    if(value===null){read(['update-index','--index-info'],Buffer.from(`0 ${'0'.repeat(40)}\t${file}\n`));continue;}
    const blob=read(['hash-object','-w','--stdin'],value.content??value).toString().trim();read(['update-index','--add','--cacheinfo',`${value.mode||'100644'},${blob},${file}`]);
   }return read(['commit-tree',read(['write-tree']).toString().trim(),'-p',parent],Buffer.from('Synthetic closed assistant native progress\n')).toString().trim();
  };
  const accepted=commit(fixes);assertCanvasPreflightTree(accepted,read,p);
  for(const file of Object.keys(p.specs))for(const value of [null,Buffer.from('Unreviewed fixture'),{mode:'120000',content:Buffer.from('outside')}])assert.throws(()=>assertCanvasPreflightTree(commit({...fixes,[file]:value}),read,p));
  for(const file of ['workers/auth/src/lib/canvas-agent-conversation.js','workers/auth/migrations/0112_canvas_assistant_models_and_scheduling.sql',
   'js/pages/canvas/agent-conversation.js','package-lock.json','.github/workflows/static.yml','config/release-validation.yml','scripts/test-q2-runtime-launcher.mjs'])
   assert.throws(()=>assertCanvasPreflightTree(commit({...fixes,[file]:Buffer.from('Unreviewed passed source')}),read,p));
  for(const file of tooling)assert.throws(()=>assertCanvasPreflightTree(commit({...fixes,[file]:{mode:'120000',content:Buffer.from('outside')}}),read,p));
  assert.throws(()=>assertCanvasPreflightTree(commit(fixes,accepted),read,p),'Later successors cannot inherit this closed evidence');

  // Exercise actual registration and routing without invoking a product callback.
  // Frozen reviewed sources keep this historical guard independent of later cases.
  const sources=Object.fromEntries(['canvas.mjs','canvas-policy-tail.mjs','runner.mjs','linux-runtime-child.mjs','linux-hosted.mjs','linux-bootstrap.py']
   .map(name=>[name,read(['show',`${reviewed}:tests/helpers/q2-runtime/${name}`]).toString()]));
  const sourcesFile=path.join(temporary,'sources.json'),discoveryFile=path.join(temporary,'canvas-discovery.json');fs.writeFileSync(sourcesFile,JSON.stringify(sources));
  const child=spawnSync(process.execPath,['--experimental-vm-modules','--input-type=module','-e',`
   import assert from 'node:assert/strict';import fs from 'node:fs';import crypto from 'node:crypto';
   import{SourceTextModule,SyntheticModule,createContext}from'node:vm';
   import{verifyCanvasExportSchema,verifyCanvasAssemblyRetentionSchema}from'./scripts/lib/canvas-export-readiness.mjs';
   const sources=JSON.parse(fs.readFileSync(process.env.SCOPE_SOURCES)),context=createContext({Response,Headers});
   const synthetic=async(exports,ctx=context)=>{const module=new SyntheticModule(Object.keys(exports),function(){for(const[key,value]of Object.entries(exports))this.setExport(key,value);},{context:ctx});await module.link(()=>{});await module.evaluate();return module;};
   const basics={'node:assert/strict':{default:assert},'node:fs':{default:fs},'node:crypto':{createHash:crypto.createHash},'../../../scripts/lib/canvas-export-readiness.mjs':{verifyCanvasExportSchema,verifyCanvasAssemblyRetentionSchema}};
   const full=new SourceTextModule(sources['canvas.mjs'],{context});await full.link(name=>{assert(basics[name],name);return synthetic(basics[name]);});await full.evaluate();
   const tail=new SourceTextModule(sources['canvas-policy-tail.mjs'],{context,importModuleDynamically:name=>{assert(basics[name],name);return synthetic(basics[name]);}});
   await tail.link(name=>name==='./canvas.mjs'?full:synthetic(basics[name]));await tail.evaluate();
   const discover=async run=>{
    const names=[],setup=[],metrics=[],headers=new Headers();headers.append('set-cookie','__Host-bitbi_session=synthetic; Secure');headers.append('set-cookie','__Host-bitbi_admin_mfa=synthetic; Secure');
    const f={migrations:['0108','0109','0110','0112'].map(path=>({path,statements:[]})),db:{batch:async()=>{setup.push('migration');}},sql:()=>({run:async()=>{setup.push('sql');}}),
     rows:async()=>[{sql:'synthetic pre-migration schema'}],scalar:async()=>1,control:async route=>{setup.push(route);return Response.json({cookie:'synthetic',code:'synthetic'});},
     mf:{dispatchFetch:async()=>Response.json({setup:{secret:'synthetic'}},{headers})},canvasProvider:{requests:[]},counters:{outboundDenied:0},metrics,
     test:async(name,operation)=>{assert.equal(typeof operation,'function');names.push(name);}};
    await run(f);return{names,setup,metrics};
   };
   const all=await discover(full.namespace.runCanvasTests),selected=await discover(tail.namespace.runCanvasAssistantContinuationTests);
   assert.equal(all.names.length,251);assert.equal(crypto.createHash('sha256').update(JSON.stringify(all.names)).digest('hex'),'3bcde3da85495a7cfa8190ca3ad20f8f255c7b065941f88cfbf5d1c75cd3640f');
   assert.equal(all.names[0],'canvas_assistant_models_populated_migration');assert.equal(all.names[1],'canvas_natural_chat_populated_migration_preserves_original_authority');
   assert.deepEqual(selected.names,all.names.slice(1));assert.deepEqual(selected.setup,all.setup);assert(all.setup.includes('/canvas-assistant-migration-seed'));
   assert.deepEqual(JSON.parse(JSON.stringify(selected.metrics)),[{assistantContinuation:{retained:all.names.slice(0,1),discovery:all.names,currentfullcount:251,fresh:all.names.slice(1)}}]);
   fs.writeFileSync(process.env.SCOPE_DISCOVERY,JSON.stringify(all.names));
   for(const fault of [null,'first-missing','first-changed','tail-missing','tail-duplicate','tail-order','foreign','extra','operation-failed']){
    const names=[...all.names],executed=[],markers=[],ctx=createContext({});
    if(fault==='first-missing')names.shift();if(fault==='first-changed')names[0]='foreign-retained';if(fault==='tail-missing')names.pop();
    if(fault==='tail-duplicate')names.splice(2,0,names[1]);if(fault==='tail-order')[names[1],names[2]]=[names[2],names[1]];if(fault==='foreign')names[1]='foreign-fresh';if(fault==='extra')names.push('extra');
    const load=name=>synthetic(name==='./canvas.mjs'?{runCanvasTests:async f=>{markers.push('setup');for(const item of names)await f.test(item,async()=>{executed.push(item);if(fault==='operation-failed')throw Error('Synthetic callback failure');});markers.push('finished');}}:basics[name],ctx);
    const module=new SourceTextModule(sources['canvas-policy-tail.mjs'],{context:ctx,importModuleDynamically:load});await module.link(load);await module.evaluate();
    const run=()=>module.namespace.runCanvasAssistantContinuationTests({metrics:[],test:async(name,operation)=>{await operation();}});
    if(fault)await assert.rejects(run);else{await run();assert.deepEqual(executed,all.names.slice(1));assert.deepEqual(markers,['setup','finished']);}
    assert(!executed.includes(all.names[0]),'The retained passed callback cannot execute');if(fault==='operation-failed')assert.deepEqual(executed,[all.names[1]]);
   }
   const runnerContext=createContext({}),runner=new SourceTextModule(sources['runner.mjs'],{context:runnerContext});
   await runner.link(name=>{const statement=sources['runner.mjs'].split('\\n').find(line=>line.includes("from '"+name+"'")||line.includes('from "'+name+'"'));assert(statement,name);
    const named=statement.match(/import\\s*\\{([^}]+)\\}/);const exports=named?Object.fromEntries(named[1].split(',').map(key=>[key.trim(),name==='./canvas.mjs'?full.namespace[key.trim()]:name==='./canvas-policy-tail.mjs'?tail.namespace[key.trim()]:()=>{}])):{default:{}};
    return synthetic(exports,runnerContext);});await runner.evaluate();
   const select=runner.namespace.selectedRuntimeSuites;assert.deepEqual(Array.from(select('canvas-assistant-continuation'),row=>row[0]),['canvas']);assert.equal(select('canvas-assistant-continuation')[0][1],tail.namespace.runCanvasAssistantContinuationTests);
   assert.equal(select('canvas')[0][1],full.namespace.runCanvasTests);assert.equal(select(),runner.namespace.runtimeSuites);assert.throws(()=>select('canvas-assistant-continuation-other'));
   const parserSource=sources['linux-hosted.mjs'].split('export function parseRuntimeArgs(')[1].split('export function assertHostedBootstrapAllowed')[0];assert(parserSource);
   const parser=new SourceTextModule('export function parseRuntimeArgs('+parserSource,{context:createContext({})});await parser.link(()=>{throw Error('Unexpected parser dependency');});await parser.evaluate();
   assert.equal(parser.namespace.parseRuntimeArgs(['--suite','canvas-assistant-continuation'],{}).suite,'canvas-assistant-continuation');
   for(const args of [['--suite','canvas-assistant-continuation-other'],['--suite','canvas-assistant-continuation','--suite','canvas']])assert.throws(()=>parser.namespace.parseRuntimeArgs(args,{}));
   for(const suite of ['canvas-assistant-continuation','canvas-assistant-continuation-other'])for(const fault of [null,'platform','uid','gid']){
    const calls=[],ctx=createContext({process:{platform:fault==='platform'?'darwin':'linux',getuid:()=>fault==='uid'?0:65534,getgid:()=>fault==='gid'?0:65534}});
    const modules={'node:assert/strict':{default:assert},'node:fs':{readFileSync:file=>{assert.equal(file,'/runtime/boundary.json');calls.push('boundary');return JSON.stringify({suite});}},'./runner.mjs':{runQ2Runtime:async(args,selected)=>{assert.deepEqual(Array.from(args),['--artifacts','/artifacts']);assert.equal(selected,suite);calls.push('run');}}};
    const load=name=>{assert(modules[name]);calls.push(name);return synthetic(modules[name],ctx);};const module=new SourceTextModule(sources['linux-runtime-child.mjs'],{context:ctx,importModuleDynamically:load});await module.link(load);
    if(!fault&&suite==='canvas-assistant-continuation'){await module.evaluate();assert.deepEqual(calls,['node:assert/strict','node:fs','boundary','./runner.mjs','run']);}
    else{await assert.rejects(module.evaluate());assert(!calls.includes('./runner.mjs'));if(fault)assert(!calls.includes('boundary'));}
   }
  `],{cwd:repositoryRoot,env:{...process.env,SCOPE_SOURCES:sourcesFile,SCOPE_DISCOVERY:discoveryFile},encoding:'utf8',timeout:15000});
  assert.equal(child.status,0,child.stderr);const inventory=JSON.parse(fs.readFileSync(discoveryFile));
  assert.equal(new Set(inventory).size,251);
  const bootstrap=spawnSync('python3',['-c',`import argparse,ast,json,os
source=json.load(open(os.environ['SCOPE_SOURCES']))['linux-bootstrap.py']
calls=[node for node in ast.walk(ast.parse(source)) if isinstance(node,ast.Call) and isinstance(node.func,ast.Attribute) and node.func.attr=='add_argument' and node.args and isinstance(node.args[0],ast.Constant) and node.args[0].value=='--suite']
assert len(calls)==1
parser=argparse.ArgumentParser(exit_on_error=False)
exec(compile(ast.fix_missing_locations(ast.Module(body=[ast.Expr(value=calls[0])],type_ignores=[])),'reviewed-bootstrap','exec'),{'parser':parser})
assert parser.parse_args(['--suite','canvas-assistant-continuation']).suite=='canvas-assistant-continuation'
try: parser.parse_args(['--suite','canvas-assistant-continuation-other'])
except argparse.ArgumentError: pass
else: raise AssertionError('Foreign scope accepted')
`],{env:{...process.env,SCOPE_SOURCES:sourcesFile},encoding:'utf8',timeout:10000});assert.equal(bootstrap.status,0,bootstrap.stderr);

  const origin='.local-release',checkpoint=path.join(origin,'reuse/preflight-checkpoint.json'),hasOriginal=fs.existsSync(checkpoint)&&JSON.parse(fs.readFileSync(checkpoint)).sha===p.source;
  assert(hasOriginal||!process.argv.includes('--assistant-native-progress-only'),'Focused native progress requires the actual failed original evidence');
  let originalCommand=selectedCommands(selectCiTests(['workers/auth/src/lib/image-generation-capacity.js']),{GITHUB_SHA:accepted,CANDIDATE_BASE:p.source}).find(row=>row.name==='Run worker route tests')?.run;
  if(hasOriginal){
   const bytes=fs.readFileSync(checkpoint),original=JSON.parse(bytes),proof=path.join(temporary,'proof');fs.mkdirSync(proof);
   fs.cpSync(path.join(origin,'reuse'),path.join(proof,'reuse'),{recursive:true});fs.mkdirSync(path.join(proof,'test-results'));process.env.GIT_DIR=bare;
   const selection=gitSelection(original.base,accepted),commands=selectedCommands(selection,{GITHUB_SHA:accepted,CANDIDATE_BASE:original.base});
   const context={sha:accepted,base:original.base,planHash:validationPlan().digest,selection,environment:original.environment,nativeBrowsers:original.nativeBrowsers,commands};
   assert.equal(canvasPreflightPrefix(bytes,context).sha,p.source);
   for(const mutate of [row=>row.status='passed',row=>row.commands[41].exitCode=0,row=>row.commands[40].exitCode=1,row=>row.commands.pop(),row=>delete row.preflightContinuation]){
    const bad=structuredClone(original);mutate(bad);assert.throws(()=>canvasPreflightPrefix(Buffer.from(JSON.stringify(bad)),context));
   }
   for(const mutate of [row=>row.base='f'.repeat(40),row=>row.planHash='changed',row=>row.environment.key='changed',row=>row.environment.image='changed',row=>row.environment.inputs['package-lock.json']='changed',
    row=>row.selection.full=!row.selection.full,row=>row.commands.pop(),row=>row.commands[41].run='echo skipped']){
    const bad=structuredClone(context);mutate(bad);assert.throws(()=>canvasPreflightPrefix(bytes,bad));
   }
   const pending=verifyAssistantNativeProgress(proof,accepted,{allowPending:true});assert.equal(pending.previous.passed,184);assert.equal(pending.previous.failedSuites,1);assert.equal(pending.result,null);
   assert.throws(()=>verifyAssistantNativeProgress(proof,accepted),'Missing fresh native scope cannot claim success');originalCommand=original.commands[41].command.run;
   const previous=pending.previous,fresh={passed:250,failedSuites:0,reports:[{suite:'canvas',failure:null,records:inventory.slice(1).map(name=>({name,status:'PASS'})),
    metrics:[{assistantContinuation:{retained:inventory.slice(0,1),discovery:inventory,currentfullcount:251,fresh:inventory.slice(1)}}]}]};
   assert.deepEqual(verifyAssistantNativeProgressUnion(previous,fresh),{workerPassed:1630,processorPassed:true,launcherPassed:30,nativeRetained:184,nativeFresh:250,nativeTotal:434});
   for(const mutate of [row=>row.passed=249,row=>row.failedSuites=1,row=>row.reports[0].failure={stage:'failed'},row=>row.reports[0].suite='foreign',row=>row.reports.push(structuredClone(row.reports[0])),
    row=>row.reports[0].records.pop(),row=>row.reports[0].records.push(row.reports[0].records[0]),row=>row.reports[0].records.unshift({name:inventory[0],status:'PASS'}),
    row=>row.reports[0].records[0].status='SKIP',row=>row.reports[0].records[0].status='FAIL',row=>row.reports[0].records[0].name='foreign',
    row=>[row.reports[0].records[0],row.reports[0].records[1]]=[row.reports[0].records[1],row.reports[0].records[0]],row=>row.reports[0].metrics=[],row=>row.reports[0].metrics.push(row.reports[0].metrics[0]),
    row=>row.reports[0].metrics[0].assistantContinuation.currentfullcount=250,row=>row.reports[0].metrics[0].assistantContinuation.retained=[],
    row=>row.reports[0].metrics[0].assistantContinuation.discovery.pop(),row=>row.reports[0].metrics[0].assistantContinuation.discovery[20]='foreign',
    row=>row.reports[0].metrics[0].assistantContinuation.fresh.pop()]){
    const bad=structuredClone(fresh);mutate(bad);assert.throws(()=>verifyAssistantNativeProgressUnion(previous,bad));
   }
   for(const mutate of [row=>row.passed=185,row=>row.failedSuites=0,row=>row.reports.pop(),row=>row.reports.push(row.reports[0]),
    row=>row.reports.find(report=>report.suite==='canvas').failure=null,row=>row.reports.find(report=>report.suite==='canvas').failure.stage='different failure',
    row=>row.reports.find(report=>report.suite==='canvas').records=[],row=>row.reports[0].records[0].status='FAIL',row=>row.reports[0].records[1]=row.reports[0].records[0]]){
    const bad=structuredClone(previous);mutate(bad);assert.throws(()=>verifyAssistantNativeProgressUnion(bad,fresh));
   }
   for(const file of ['reuse/preflight-checkpoint.json','reuse/preflight-failed.log','reuse/hosting-manifest.json','reuse/hosting-proof.json',
    'reuse/test-results/assistant-native-origin/reuse/preflight-checkpoint.json','reuse/test-results/assistant-native-origin/reuse/preflight-failed.log',
    'reuse/test-results/assistant-native-origin/logs/17.log','reuse/test-results/assistant-native-origin/test-results/assistant-native-worker-discovery.json',
    'reuse/test-results/assistant-native-origin/test-results/assistant-launcher-fresh.tap',
    ...Object.keys(p.nativeProof).map(file=>'reuse/test-results/assistant-native-original/'+file)]){
    const target=path.join(proof,file),saved=fs.readFileSync(target);fs.unlinkSync(target);assert.throws(()=>verifyAssistantNativeProgress(proof,accepted,{allowPending:true}));
    fs.writeFileSync(target,'forged evidence');assert.throws(()=>verifyAssistantNativeProgress(proof,accepted,{allowPending:true}));fs.writeFileSync(target,saved);
   }
   const originalDiscovery=fs.readFileSync(path.join(proof,'reuse/test-results/assistant-native-origin/test-results/assistant-native-worker-discovery.json'));
   const discovery=JSON.parse(originalDiscovery),currentDiscovery=path.join(proof,'test-results/assistant-native-progress-discovery.json');fs.writeFileSync(currentDiscovery,originalDiscovery);
   verifyAssistantNativeProgress(proof,accepted,{allowPending:true});
   const firstSuite=report=>{const pending=[...report.suites];while(pending.length){const suite=pending.shift();if(suite.specs?.length)return suite;pending.push(...suite.suites||[]);}throw new Error('Missing original Worker discovery');};
   for(const mutate of [row=>row.errors.push({message:'discovery failed'}),row=>firstSuite(row).specs.pop(),row=>firstSuite(row).specs.push(firstSuite(row).specs[0]),row=>firstSuite(row).specs[0].title='Changed retained case']){
    const bad=structuredClone(discovery);mutate(bad);fs.writeFileSync(currentDiscovery,JSON.stringify(bad,null,2));assert.throws(()=>verifyAssistantNativeProgress(proof,accepted,{allowPending:true}));
   }
   fs.writeFileSync(currentDiscovery,originalDiscovery);
   const freshLog=path.join(proof,'test-results/assistant-native-progress.log');
   for(const content of ['',JSON.stringify({q2LinuxEvidence:'/tmp/bitbi-release/q2-runtime-evidence/missing'}),JSON.stringify({q2LinuxEvidence:'/tmp/bitbi-release/../foreign'})]){
    fs.writeFileSync(freshLog,content);assert.throws(()=>verifyAssistantNativeProgress(proof,accepted),'Missing, foreign or unverified native receipts cannot pass');
   }
  }
  const shell=assistantNativeProgressContinuation(originalCommand);assert.throws(()=>assistantNativeProgressContinuation('npm run test:workers'));
  assert(!shell.includes('npm run test:workers')&&!shell.includes('npm run test:homepage-ffmpeg-processor')&&!shell.includes('--test-name-pattern'),'Passed Worker/media/launcher cases cannot execute again');
  const flow=path.join(temporary,'flow');fs.mkdirSync(flow);const trace=path.join(flow,'trace');
  const shim=`npx(){ printf '%s\\n' "discovery|$*" >> "$TRACE"; [ "$FAIL_STAGE" != discovery ]; }\nnode(){ case "$*" in *verify-assistant-native-progress-pending*) stage=pending;; *test-q2-runtime.mjs*) stage=native;; *verify-assistant-native-progress*) stage=verify;; *) return 98;; esac; printf '%s\\n' "$stage|$*" >> "$TRACE"; [ "$FAIL_STAGE" != "$stage" ]; }\ncp(){ printf '%s\\n' "copy|$*" >> "$TRACE"; [ "$FAIL_STAGE" != copy ]; }\ntee(){ cat > "$1"; [ "$FAIL_STAGE" != tee ]; }\n`;
  const stages=['discovery','pending','native','copy','verify'];
  for(const failed of ['',...stages,'tee']){
   fs.rmSync(trace,{force:true});const result=spawnSync('/bin/bash',['--noprofile','--norc','-eu','-c',shim+shell],{cwd:flow,env:{...process.env,TRACE:trace,FAIL_STAGE:failed},encoding:'utf8',timeout:10000});
   assert.equal(result.status,failed?1:0,result.stderr);
   const rows=fs.readFileSync(trace,'utf8').trim().split('\n').map(line=>{const at=line.indexOf('|');return{stage:line.slice(0,at),args:line.slice(at+1)};});
   assert.deepEqual(rows.map(row=>row.stage),failed?stages.slice(0,stages.indexOf(failed==='tee'?'native':failed)+1):stages,'Every failure stops downstream work, including piped native/tee failures');
   if(!failed){assert.equal(rows[0].args,'playwright test -c playwright.workers.config.js --list --reporter=json');assert.equal(rows[1].args,'scripts/local-release.mjs verify-assistant-native-progress-pending .local-release');
    assert.equal(rows[2].args,'scripts/test-q2-runtime.mjs --suite canvas-assistant-continuation');assert.equal(rows[3].args,'-a /tmp/bitbi-release/q2-runtime-evidence .local-release/runtime/');
    assert.equal(rows[4].args,'scripts/local-release.mjs verify-assistant-native-progress .local-release');}
  }
 }finally{if(previousGitDir===undefined)delete process.env.GIT_DIR;else process.env.GIT_DIR=previousGitDir;fs.rmSync(temporary,{recursive:true,force:true});}
 console.log(marker);
}
await testAssistantNativeProgress();
