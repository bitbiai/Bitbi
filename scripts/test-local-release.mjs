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
