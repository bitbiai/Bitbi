import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { ensureEnvironment, docker, PACKAGES, cacheRoot, TOOL_PREFLIGHT, toolchainPins } from './lib/local-release-environment.mjs';
import { LOCAL_POLICY, validationPlan, selectedCommands, sha256, commandRuntimes, nativeBrowserKey } from './lib/local-release-plan.mjs';
import { gitSelection, tree, REPOSITORY, publishedBase } from './pages-candidate.mjs';
import { verifyLocalEvidence, LOCAL_WORKER_REPAIR, LOCAL_IMPORT_REPAIR, localRepairCommand, verifyImportRepairEvidence, LOCAL_REPAIR_REFRESH, LOCAL_CORE_REUSE, LOCAL_HOMEPAGE_REPORTS, verifyRetainedHomepageReports, assertLocalRepairTree, verifyLocalWorkerRepair, localWorkerContinuation } from './lib/local-release-evidence.mjs';
import { BROWSER_ORIGINS, readMigrationBrowserPool, runMigrationBrowserContinuation, SMOOTH_BROWSER_CONTINUATION, AUDIO_FIT_CONTINUATION, INSPECTOR_CONTINUATION, smoothProfile, SMOOTH_BROWSER_POLICY, isSmoothContinuation, runSmoothBrowserContinuation } from './lib/local-release-browser.mjs';
import {PERMISSION_CONTINUATION,PERMISSION_REFRESH,SMOOTH_REFRESH,permissionRefresh,assertPermissionContinuationTree,permissionContinuationPrefix,canvasStageContinuation} from './lib/local-release-evidence.mjs';

const git = (args, cwd = '.') => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim();
const json = file => JSON.parse(fs.readFileSync(file));
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const safeEnv = () => ({ PATH: process.env.PATH, HOME: os.homedir(), TMPDIR: os.tmpdir(), LANG: 'en_US.UTF-8' });

export function ensureNativeBrowsers(root='.') {
  assert.equal(process.platform,'darwin');assert.equal(process.arch,'arm64');
  const pins=toolchainPins(root);assert.equal(process.version,pins.node,'Use the pinned Node runtime for native browser acceptance');
  const started=Date.now(), packages={}, inputs={};
  for(const dir of PACKAGES) {
    const files=['package.json','package-lock.json'].map(name=>path.join(root,dir,name));
    const hashes=files.map(file=>sha256(fs.readFileSync(file)));
    files.forEach((file,index)=>{inputs[path.posix.join(dir,path.basename(file))]=hashes[index];});
    const key=sha256(JSON.stringify({hashes,node:pins.node,platform:'darwin/arm64'}));
    const target=path.join(cacheRoot(),'native-dependencies',key),ready=path.join(target,'ready.json');
    if(!fs.existsSync(ready)) {
      fs.mkdirSync(target,{recursive:true});
      for(const file of files)fs.copyFileSync(file,path.join(target,path.basename(file)));
      execFileSync('npm',['ci'],{cwd:target,env:{...safeEnv(),CI:'1',WRANGLER_SEND_METRICS:'false'},stdio:'inherit',timeout:300000});
      execFileSync('npm',['ls','--depth=0'],{cwd:target,env:safeEnv(),stdio:'pipe'});
      save(ready,{key,node:pins.node,hashes});
    }
    assert.deepEqual(json(ready),{key,node:pins.node,hashes});
    assert(fs.existsSync(path.join(target,'node_modules')),'Native dependency cache missing; inspect before preparing it again');
    packages[dir]=path.join(target,'node_modules');
  }
  const browserRoot=path.join(os.homedir(),'Library/Caches/ms-playwright');
  const browserEnv={...safeEnv(),CI:'1',PLAYWRIGHT_BROWSERS_PATH:browserRoot,WRANGLER_SEND_METRICS:'false'};
  const playwright=path.join(packages[''],'playwright/index.mjs');
  assert.equal(json(path.join(packages[''],'playwright/package.json')).version,pins.playwright);
  const versions=Object.fromEntries(json(path.join(packages[''],'playwright-core/browsers.json')).browsers.filter(b=>['chromium','webkit'].includes(b.name)).map(b=>[b.name,b.browserVersion]));
  const inventory=`import{registry}from ${JSON.stringify(path.join(packages[''],'playwright-core/lib/server/registry/index.js'))};console.log(JSON.stringify(['chromium','chromium-headless-shell','webkit'].map(name=>({name,path:registry.findExecutable(name).executablePath()}))));`;
  const locate=()=>JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',inventory],{env:browserEnv,encoding:'utf8'}));
  let executables=locate();
  if(executables.some(item=>!fs.existsSync(item.path))) {
    execFileSync(process.execPath,[path.join(packages[''],'playwright/cli.js'),'install','chromium','webkit'],{env:browserEnv,stdio:'inherit',timeout:300000});
    executables=locate();
  }
  const mediaTools={};
  for(const name of ['ffmpeg','ffprobe']) {
    const executable=execFileSync('/bin/sh',['-c',`command -v ${name}`],{env:safeEnv(),encoding:'utf8'}).trim();
    mediaTools[name]=execFileSync(executable,['-version'],{env:safeEnv(),encoding:'utf8',timeout:10000}).split('\n')[0];
    executables.push({name,path:executable});
  }
  const binaries=executables.map(item=>({name:item.name,hash:sha256(fs.readFileSync(item.path))}));
  inputs['tests/fixtures/media/test-video.mp4']=sha256(fs.readFileSync(path.join(root,'tests/fixtures/media/test-video.mp4')));
  const identity={node:pins.node,playwright:pins.playwright,platform:'darwin/arm64',kernel:os.release(),inputs,binaries};
  const key=nativeBrowserKey(identity);
  const ready=path.join(cacheRoot(),'native-browser-ready.json');
  let record=fs.existsSync(ready)?json(ready):null,reused=record?.key===key;
  if(!reused) {
    // These are user-media decoder prerequisites, not decorative Hero tests.
    const fixture=fs.readFileSync(path.join(root,'tests/fixtures/media/test-video.mp4')).toString('base64');
    const probe=`import{chromium,webkit}from ${JSON.stringify(playwright)};const output={};
      for(const[name,engine]of Object.entries({chromium,webkit})){console.error('Native browser prerequisite: '+name);const browser=await engine.launch({timeout:10000});try{const page=await browser.newPage();await page.route('**/*',route=>route.abort());await page.setContent('<video muted playsinline></video>');
        const decoded=await page.evaluate(async src=>{const video=document.querySelector('video');video.src=src;return await new Promise(resolve=>{const timer=setTimeout(()=>resolve(false),3000);video.onloadeddata=()=>{clearTimeout(timer);resolve(video.videoWidth>0&&video.videoHeight>0&&video.readyState>=2)};video.onerror=()=>{clearTimeout(timer);resolve(false)};video.load();});},'data:video/mp4;base64,${fixture}');
        output[name]={version:browser.version(),h264Decoded:decoded};if(!decoded)throw Error(name+' cannot decode the required user-media fixture');}finally{await browser.close();}}
      console.log(JSON.stringify(output));`;
    const capabilities=JSON.parse(execFileSync(process.execPath,['--input-type=module'],{input:probe,env:browserEnv,encoding:'utf8',timeout:30000,stdio:['pipe','pipe','inherit']}));
    for(const [name,version] of Object.entries(versions))assert.equal(capabilities[name].version,version);
    record={policy:'native-browser-v1',key,...identity,capabilities,mediaTools,verifiedAt:new Date().toISOString()};save(ready,record);
  }
  return {...record,packages,browserRoot,reused,preparationMs:Date.now()-started};
}

export function copyEvidenceToolInputs(source,target) {
  // Browser error-context Markdown is an archived diagnostic, never a first-party
  // document. Keep it in the original bundle; only proof inputs enter this workspace.
  fs.cpSync(source,target,{recursive:true,filter:file=>!/^test-results\/.*\.md$/.test(path.relative(source,file))});
}

export function prepareCandidateRestore(root='.') {
  const site=path.join(root,'_site');
  if(!fs.existsSync(site)){assert(!fs.lstatSync(site,{throwIfNoEntry:false}),'Dangling candidate input');return;}
  assert(fs.lstatSync(site).isDirectory()&&!fs.lstatSync(site).isSymbolicLink(),'Unexpected candidate input');
  const manifest=json(path.join(root,'candidate/manifest.json'));
  assert.deepEqual(tree(site),manifest.files,'Previous job changed candidate bytes; refuse restore');
  assert.deepEqual(tree(path.join(root,'candidate/site')),manifest.files,'Stored candidate changed');
  fs.rmSync(site,{recursive:true}); // disposable generated output, never source
}

export function acquireLocalReleaseLock(directory=cacheRoot()) {
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const file=path.join(directory,'active-release.json');
  try { fs.writeFileSync(file,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}),{flag:'wx',mode:0o600}); }
  catch(error) {
    if(error.code!=='EEXIST')throw error;
    const previous=json(file);assert(Number.isSafeInteger(previous.pid)&&previous.pid>0,'Malformed local release lock; inspect before recovery');
    let absent=false;try{process.kill(previous.pid,0);}catch(probe){if(probe.code==='ESRCH')absent=true;else throw probe;}
    if(!absent)throw Error(`Another local release is active (PID ${previous.pid}); no second setup, suite or push was started.`);
    // A terminated process cannot own the lock. Existing failed/run checkpoints
    // still require diagnosis and explicit resume; removing a stale lock is no pass.
    fs.unlinkSync(file);return acquireLocalReleaseLock(directory);
  }
  return ()=>{assert.equal(json(file).pid,process.pid);fs.unlinkSync(file);};
}
async function withReleaseLock(operation) {
  const unlock=acquireLocalReleaseLock();try{return await operation();}finally{unlock();}
}

async function verifiedLocalBase() {
  // Read credentials only in this outer, non-test process. No credentials are
  // copied into the persistent image, disposable source or execution logs.
  process.env.GH_TOKEN ||= execFileSync('gh',['auth','token'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  if (!process.env.CLOUDFLARE_API_TOKEN) {
    const stored=spawnSync('security',['find-generic-password','-s','BITBI-Frontend-Cutover','-w'],{encoding:'utf8',stdio:['ignore','pipe','ignore']});
    assert.equal(stored.status,0,'Existing scoped Cloudflare read credential unavailable; configure it through protected local setup');
    process.env.CLOUDFLARE_API_TOKEN=stored.stdout.trim();
  }
  process.env.CLOUDFLARE_ACCOUNT_ID ||= execFileSync('gh',['variable','get','CF_FRONTEND_ACCOUNT_ID','--repo',REPOSITORY],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  return (await publishedBase()).sha;
}

async function prepareRelease({ base, resume } = {}) {
  const published=await verifiedLocalBase();
  if(base)git(['merge-base','--is-ancestor',base,published]);else base=published;
  const head=git(['rev-parse','HEAD']);
  const runsDir=path.join(cacheRoot(),'runs');
  if(!resume && fs.existsSync(runsDir)) {
    const matches=fs.readdirSync(runsDir).filter(name=>name.startsWith(head+'-')).map(name=>path.join(runsDir,name))
      .filter(dir=>fs.existsSync(path.join(dir,'checkpoint.json'))&&json(path.join(dir,'checkpoint.json')).base===base);
    if(matches.length) {
      const prior=matches.sort((a,b)=>fs.statSync(path.join(b,'checkpoint.json')).mtimeMs-fs.statSync(path.join(a,'checkpoint.json')).mtimeMs)[0];
      assert.equal(json(path.join(prior,'checkpoint.json')).status,'passed',`Unfinished/failed local evidence: ${prior}. Diagnose first; an explicit --resume is required after correction or an established transient cause.`);
      resume=prior;
    }
  }
  return runLocalRelease({base,resume});
}

export const preflightLocal=options=>withReleaseLock(()=>prepareRelease(options));
export async function releaseLocal(options = {}) {
  return withReleaseLock(async()=>{
  const directory=await prepareRelease(options);
  const sha=json(path.join(directory,'checkpoint.json')).sha;
  assert.equal(git(['rev-parse','HEAD']),sha,'Source moved during acceptance; do not publish another commit');
  const {uploadLocalEvidence}=await import('./lib/local-release-transport.mjs');
  const transport=await uploadLocalEvidence(directory);
  // The single existing main-push workflow continues automatically. Test
  // evidence exists before push; a normal push never races an unfinished test.
  assert.equal(git(['rev-parse','HEAD']),sha,'Source moved during evidence upload');
  const remote=git(['ls-remote','origin','refs/heads/main']).split(/\s/)[0];
  if(remote!==sha)execFileSync('git',['push','origin',`${sha}:refs/heads/main`],{stdio:'inherit'});
  else {
    const runs=JSON.parse(execFileSync('gh',['run','list','--repo',REPOSITORY,'--workflow','static.yml','--commit',sha,'--limit','10','--json','databaseId,status,conclusion'],{encoding:'utf8'}));
    const current=runs.find(run=>run.status!=='completed'||run.conclusion==='success');
    if(!current)execFileSync('gh',['workflow','run','static.yml','--repo',REPOSITORY,'--ref','main'],{stdio:'inherit'});
  }
  save(path.join(directory,'continuation.json'),{sha,transport,workflow:'static.yml',state:'CI pending',checkedAt:new Date().toISOString()});
  console.log(JSON.stringify({sha,workflow:'https://github.com/bitbiai/Bitbi/actions/workflows/static.yml',state:'pushed; CI/publication not yet verified',directory}));
  });
}

function runLocalRelease({ base, resume }) {
  assert.equal(process.platform, 'darwin');
  assert.equal(git(['branch','--show-current']), 'main', 'Release preparation starts on main');
  const sha = git(['rev-parse','HEAD']);
  git(['ls-files','--error-unmatch','config/release-validation.yml','scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs','scripts/lib/local-release-transport.mjs']);
  assert.equal(git(['diff','--name-only','HEAD','--','scripts','config','frontend','package.json','package-lock.json','.github/workflows']), '',
    'Commit the release execution/toolchain inputs before validation; unrelated worktree edits are preserved');
  assert(/^[a-f0-9]{40}$/.test(base || ''), 'Supply the verified published --base SHA');
  git(['merge-base','--is-ancestor',base,sha]);
  const environment = ensureEnvironment(), selection = gitSelection(base, sha);
  const commands = selectedCommands(selection, { GITHUB_SHA: sha, CANDIDATE_BASE: base });
  const nativeBrowsers=commands.some(command=>commandRuntimes(command).some(part=>part.runtime==='native-browser-v1'))?ensureNativeBrowsers():null;
  const nativeEvidence=nativeBrowsers?Object.fromEntries(Object.entries(nativeBrowsers).filter(([key])=>!['packages','browserRoot'].includes(key))):null;
  const originalDirectory=resume&&json(path.join(resume,'checkpoint.json')).sha!==sha?path.resolve(resume):null;
  const permissionContinuation=originalDirectory&&[PERMISSION_CONTINUATION.source,PERMISSION_CONTINUATION.tail,INSPECTOR_CONTINUATION.source,AUDIO_FIT_CONTINUATION.source,SMOOTH_BROWSER_CONTINUATION.source,SMOOTH_BROWSER_CONTINUATION.progress,SMOOTH_BROWSER_CONTINUATION.accepted,SMOOTH_BROWSER_CONTINUATION.completed].includes(json(path.join(originalDirectory,'checkpoint.json')).sha);
  if(originalDirectory){if(permissionContinuation)assertPermissionContinuationTree(sha,undefined,{smooth:isSmoothContinuation(json(path.join(originalDirectory,'checkpoint.json')).sha),source:json(path.join(originalDirectory,'checkpoint.json')).sha});else assertLocalRepairTree(sha);}
  const directory = resume&&!originalDirectory ? path.resolve(resume) : path.join(cacheRoot(), 'runs', `${sha}-${randomUUID()}`);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const work = path.join(directory, 'source'), bundle = path.join(directory, 'bundle'), checkpoint = path.join(directory, 'checkpoint.json');
  const id = path.basename(directory);
  let state = fs.existsSync(checkpoint) ? json(checkpoint) : { policy: LOCAL_POLICY, repository: REPOSITORY,
    id, sha, base, sourceTree: git(['rev-parse',`${sha}^{tree}`]), planHash: validationPlan().digest,
    selection, environment, ...(nativeEvidence?{nativeBrowsers:nativeEvidence}:{}), origin: 'development-mac', ci: true, startedAt: new Date().toISOString(), status: 'running', commands: [] };
  if(permissionContinuation) {
    const bytes=fs.readFileSync(path.join(originalDirectory,'checkpoint.json'));
    const prior=permissionContinuationPrefix(bytes,{head:sha,base,planHash:state.planHash,environment,commands});
    const reuse=path.join(bundle,'reuse');fs.mkdirSync(path.join(reuse,'test-results'),{recursive:true});fs.mkdirSync(path.join(bundle,'logs'),{recursive:true});
    fs.writeFileSync(path.join(reuse,'test-results/permission-checkpoint.json'),bytes);
    const tail=prior.sha===PERMISSION_CONTINUATION.tail,smooth=isSmoothContinuation(prior.sha),progress=prior.sha===SMOOTH_BROWSER_CONTINUATION.progress,accepted=prior.sha===SMOOTH_BROWSER_CONTINUATION.accepted,completed=prior.sha===SMOOTH_BROWSER_CONTINUATION.completed;
    state={...state,startedAt:prior.startedAt,permissionContinuation:{source:prior.sha,checkpoint:completed?SMOOTH_BROWSER_CONTINUATION.completedCheckpoint:accepted?SMOOTH_BROWSER_CONTINUATION.acceptedCheckpoint:progress?SMOOTH_BROWSER_CONTINUATION.progressCheckpoint:smooth?smoothProfile(prior.sha).checkpoint:tail?PERMISSION_CONTINUATION.tailCheckpoint:PERMISSION_CONTINUATION.checkpoint},
      commands:prior.commands.map((row,i)=>!row||row.exitCode!==0||permissionRefresh(prior.sha).has(i)?null:{...row,command:commands[i],reusedFrom:row.reusedFrom||prior.sha})};
    for(const row of state.commands.filter(Boolean))fs.copyFileSync(path.join(originalDirectory,'bundle',row.log),path.join(bundle,row.log));
    if(smooth) {
      if(fs.existsSync(path.join(originalDirectory,'bundle/reuse')))fs.cpSync(path.join(originalDirectory,'bundle/reuse'),reuse,{recursive:true});
      if([AUDIO_FIT_CONTINUATION.source,INSPECTOR_CONTINUATION.source].includes(prior.sha))for(const [from,to]of [['candidate/manifest.json','hosting-manifest.json'],['candidate/proof-frontend-runtime.json','hosting-proof.json']])fs.copyFileSync(path.join(originalDirectory,'bundle',from),path.join(reuse,to));
      fs.rmSync(path.join(reuse,'permission-checkpoint.json'),{force:true});
      fs.writeFileSync(path.join(reuse,'test-results/permission-checkpoint.json'),bytes);
      if(!fs.existsSync(path.join(reuse,'smooth-browser.json')))fs.copyFileSync(path.join(originalDirectory,'source/test-results/candidate-auth.json'),path.join(reuse,'smooth-browser.json'));
      if(accepted)fs.copyFileSync(path.join(originalDirectory,'source/test-results/candidate-auth.json'),path.join(reuse,'smooth-accepted.json'));
      for(const item of ['runtime','test-results'])fs.cpSync(path.join(originalDirectory,'source',item==='runtime'?'../runtime':item),path.join(bundle,item),{recursive:true});
      fs.cpSync(path.join(originalDirectory,'runtime'),path.join(directory,'runtime'),{recursive:true});
    }
    if(tail) {
      for(const [from,to]of [['candidate/manifest.json','hosting-manifest.json'],['candidate/proof-frontend-runtime.json','hosting-proof.json'],['logs/41.log','stage-failed.log']])
        fs.copyFileSync(path.join(originalDirectory,'bundle',from),path.join(reuse,to));
      for(const item of ['runtime','test-results'])fs.cpSync(path.join(originalDirectory,'bundle',item),path.join(bundle,item),{recursive:true});
      fs.cpSync(path.join(originalDirectory,'runtime'),path.join(directory,'runtime'),{recursive:true});
    }
  } else if(originalDirectory) {
    const prior=json(path.join(originalDirectory,'checkpoint.json'));
    assert.equal(prior.sha,LOCAL_WORKER_REPAIR.source,'Only the pinned failed migration incident permits changed-source continuation');
    assert.equal(sha256(fs.readFileSync(path.join(originalDirectory,'checkpoint.json'))),LOCAL_WORKER_REPAIR.checkpoint);
    assert.equal(prior.base,base);assert.equal(prior.environment.key,environment.key);assert.equal(prior.planHash,state.planHash);
    fs.cpSync(path.join(originalDirectory,'bundle'),bundle,{recursive:true});
    const reuse=path.join(bundle,'reuse');fs.mkdirSync(reuse,{recursive:true});
    const copy=(from,to)=>fs.copyFileSync(from,path.join(reuse,to));
    for(const [from,to] of [['checkpoint.json','checkpoint.json'],['bundle/logs/42.log','worker.log'],['bundle/logs/18.log','local-contract.log'],['source/test-results/.last-run.json','last-run.json'],['bundle/candidate/manifest.json','manifest.json'],['bundle/candidate/proof-frontend-runtime.json','proof-frontend-runtime.json']])copy(path.join(originalDirectory,from),to);
    for(const [name,source] of [['progress',LOCAL_WORKER_REPAIR.progress],['corrected',LOCAL_WORKER_REPAIR.corrected]]) {
      const root=path.join(cacheRoot(),'repairs',source);
      copy(path.join(root,'test-results/worker-repaired.json'),`${name}.json`);copy(path.join(root,'evidence.json'),`${name}-receipt.json`);
      if(name==='corrected')fs.copyFileSync(path.join(root,'final-discovery.json'),path.join(bundle,'test-results/worker-discovery.json'));
      if(name==='progress')copy(path.join(root,'original-discovery.json'),'original-discovery.json');
    }
    const tails=fs.readdirSync(path.join(cacheRoot(),'runs')).filter(name=>name.startsWith(LOCAL_WORKER_REPAIR.tailSource+'-'))
      .map(name=>path.join(cacheRoot(),'runs',name)).filter(dir=>sha256(fs.readFileSync(path.join(dir,'checkpoint.json')))===LOCAL_WORKER_REPAIR.tailCheckpoint);
    assert.equal(tails.length,1,'Missing/ambiguous original partial native chain');
    copy(path.join(tails[0],'checkpoint.json'),'tail-checkpoint.json');copy(path.join(tails[0],'bundle/logs/42.log'),'tail.log');
    fs.cpSync(path.join(originalDirectory,'runtime'),path.join(directory,'runtime'),{recursive:true});
    state={...state,startedAt:prior.startedAt,repair:{source:prior.sha,checkpoint:LOCAL_WORKER_REPAIR.checkpoint},commands:prior.commands.map((row,index)=>LOCAL_REPAIR_REFRESH.has(index)?null:{...row,command:commands[index],reusedFrom:prior.sha})};
    const nativeRuns=fs.readdirSync(path.join(cacheRoot(),'runs')).filter(name=>name.startsWith(LOCAL_WORKER_REPAIR.nativeSource+'-'))
      .map(name=>path.join(cacheRoot(),'runs',name)).filter(dir=>sha256(fs.readFileSync(path.join(dir,'checkpoint.json')))===LOCAL_WORKER_REPAIR.nativeCheckpoint);
    assert.equal(nativeRuns.length,1,'Missing/ambiguous passed native continuation');
    const native=nativeRuns[0],completed=json(path.join(native,'checkpoint.json'));
    copy(path.join(native,'checkpoint.json'),'native-checkpoint.json');
    fs.copyFileSync(path.join(native,'bundle/logs/42.log'),path.join(bundle,'logs/42.log'));
    fs.cpSync(path.join(native,'runtime'),path.join(directory,'runtime'),{recursive:true});
    fs.cpSync(path.join(native,'runtime'),path.join(bundle,'runtime'),{recursive:true});
    state.commands[42]={...completed.commands[42],command:commands[42],reusedFrom:completed.sha};
    const browserRun=fs.readdirSync(path.join(cacheRoot(),'runs')).filter(name=>name.startsWith(BROWSER_ORIGINS.previous+'-'));
    assert.equal(browserRun.length,1,'Missing/ambiguous original browser incident');
    copy(path.join(cacheRoot(),'runs',browserRun[0],'source/test-results/candidate-auth.json'),'browser-previous.json');
    for(const name of ['progress','corrected'])copy(path.join(cacheRoot(),'repairs',BROWSER_ORIGINS[name],'browser-progress.json'),`browser-${name}.json`);
    copy(path.join(cacheRoot()+'-checkpoint','production-browser-proof/proof-browser-validation.json'),'browser-production.json');
    const coreRuns=fs.readdirSync(path.join(cacheRoot(),'runs')).filter(name=>name.startsWith(LOCAL_WORKER_REPAIR.coreSource+'-'));
    assert.equal(coreRuns.length,1,'Missing/ambiguous core continuation');
    const coreRoot=path.join(cacheRoot(),'runs',coreRuns[0]);
    copy(path.join(coreRoot,'checkpoint.json'),'core-checkpoint.json');
    assert.equal(sha256(fs.readFileSync(path.join(reuse,'core-checkpoint.json'))),LOCAL_WORKER_REPAIR.coreCheckpoint);
    const core=json(path.join(reuse,'core-checkpoint.json'));
    copy(path.join(coreRoot,'source/test-results/local-homepage-fresh.json'),'browser-coreProgress.json');
    const coreCorrected=fs.readdirSync(path.join(cacheRoot(),'runs')).filter(name=>name.startsWith(BROWSER_ORIGINS.coreCorrected+'-'));
    assert.equal(coreCorrected.length,1,'Missing/ambiguous corrected core evidence');
    copy(path.join(cacheRoot(),'runs',coreCorrected[0],'source/test-results/local-homepage-fresh.json'),'browser-coreCorrected.json');
    const finalRuns=fs.readdirSync(path.join(cacheRoot(),'runs')).filter(name=>name.startsWith(BROWSER_ORIGINS.final+'-'));
    assert.equal(finalRuns.length,1,'Missing/ambiguous final browser acceptance');
    for(const [scope,label]of [['homepage','coreFinal'],['auth','authFinal']])
      copy(path.join(cacheRoot(),'runs',finalRuns[0],`source/test-results/local-${scope}-fresh.json`),`browser-${label}.json`);
    for(const report of LOCAL_HOMEPAGE_REPORTS)fs.copyFileSync(path.join(coreRoot,'bundle/test-results',report),path.join(bundle,'test-results',report));
    verifyRetainedHomepageReports(bundle);
    for(const index of LOCAL_CORE_REUSE) {
      assert.equal(core.commands[index].exitCode,0);
      fs.copyFileSync(path.join(coreRoot,'bundle',core.commands[index].log),path.join(bundle,core.commands[index].log));
      state.commands[index]={...core.commands[index],command:commands[index],reusedFrom:core.sha};
    }
    readMigrationBrowserPool(bundle);
    if(localRepairCommand(sha).endsWith('--import-repair-only')) {
      const imports=fs.readdirSync(path.join(cacheRoot(),'runs')).filter(name=>name.startsWith(LOCAL_IMPORT_REPAIR.source+'-'));
      assert.equal(imports.length,1,'Missing/ambiguous passed source before permission repair');
      const originalBundle=path.join(cacheRoot(),'runs',imports[0],'bundle');
      fs.mkdirSync(path.join(reuse,'test-results'),{recursive:true});
      for(const [from,to]of [['evidence.json','import-source-evidence.json'],['candidate/manifest.json','import-source-manifest.json'],['logs/18.log','import-source-contract.log']])copy(path.join(originalBundle,from),'test-results/'+to);
      verifyImportRepairEvidence(bundle,sha);
      state.repair.importSource=LOCAL_IMPORT_REPAIR.source;state.repair.importEvidence=LOCAL_IMPORT_REPAIR.evidence;
    }
  }
  assert.equal(state.sha, sha); assert.equal(state.base, base); assert.equal(state.planHash, validationPlan().digest);
  assert.equal(state.environment.key, environment.key, 'Changed dependencies invalidate this resume');
  if(nativeBrowsers)assert.equal(state.nativeBrowsers?.key,nativeBrowsers.key,'Changed native browser environment invalidates this resume');
  if(state.status==='passed') {
    verifyLocalEvidence(bundle,{sha,base});
    console.log(`Reusing completed local acceptance for the same ${sha}; no suite repeated.`);
    return directory;
  }
  if (!fs.existsSync(work)) {
    execFileSync('git', ['clone','--local','--no-hardlinks','--no-checkout','.',work], { stdio: 'pipe' });
    git(['checkout','--detach',sha], work);
    git(['remote','set-url','origin','https://github.com/bitbiai/Bitbi.git'], work);
    if(state.permissionContinuation&&state.permissionContinuation.source!==PERMISSION_CONTINUATION.source)fs.cpSync(path.join(bundle,'test-results'),path.join(work,'test-results'),{recursive:true});
    if(originalDirectory&&!permissionContinuation)for(const name of ['candidate','_site','test-results'])fs.cpSync(path.join(originalDirectory,'source',name),path.join(work,name),{recursive:true});
    if(originalDirectory&&!permissionContinuation)for(const report of LOCAL_HOMEPAGE_REPORTS)fs.copyFileSync(path.join(bundle,'test-results',report),path.join(work,'test-results',report));
    // Exact committed source; unrelated owner's worktree edits are never copied.
  }
  fs.mkdirSync(path.join(bundle, 'logs'), { recursive: true });
  save(checkpoint, state);
  const name = `bitbi-release-${randomUUID()}`;
  const collect = () => {
    // Original CI jobs have separate output directories. Retain each completed
    // group's reports before Playwright's next group clears its own test output.
    for(const [source,target] of [['/workspace/candidate','candidate'],['/workspace/candidate-proofs','candidate'],['/workspace/test-results','test-results'],['/tmp/bitbi-release','runtime']]) {
      if(docker(['exec',name,'sh','-c',`if [ -d ${source} ]; then echo present; fi`]).trim()) {
        const dest=path.join(bundle,target);fs.mkdirSync(dest,{recursive:true});
        docker(['cp',`${name}:${source}/.`,dest]);
      }
    }
  };
  const env = { CI: '1', GITHUB_SHA: sha, GITHUB_REPOSITORY: REPOSITORY, CANDIDATE_BASE: base,
    HOME: '/home/pwuser',
    CANDIDATE_RUN: id, CANDIDATE_ATTEMPT: '1', CANDIDATE_FULL: String(selection.full),
    STATIC_TEST_ROOT: '_site', BITBI_LOCAL_RELEASE_CONTAINER: '1',
    Q2_RUNTIME_ARTIFACTS: '/tmp/bitbi-release/q2-runtime-evidence',
    REPAIR_SOURCE_SHA: '', REPAIR_SOURCE_RUN: '', REPAIR_SOURCE_ATTEMPT: '',
    RUNNER_TOOL_CACHE: '/tmp/bitbi-release/toolcache', npm_config_cache: '/tmp/bitbi-release/npm' };
  let created=false;
  try {
    // Only this disposable source directory is mounted. No user home, GitHub/
    // Cloudflare token, host socket, SSH agent or production binding enters it.
    docker(['run','-d','--name',name,'--platform','linux/arm64','--privileged','--cpus','4','--memory','10g','--shm-size','1g',
      '--mount',`type=bind,source=${work},target=/source,readonly`,'--user','0:0','--workdir','/workspace',
      ...Object.entries(env).flatMap(([key,value]) => ['--env',`${key}=${value}`]),
      environment.image,'sleep','infinity']);
    created=true;
    const prep = 'set -eu\ncp -a /source/. /workspace/\nmkdir -p /tmp/bitbi-release/toolcache /tmp/bitbi-release/npm\n' + PACKAGES.map(dir => `cp -a /opt/bitbi-deps/${dir ? dir + '/' : ''}node_modules ./${dir ? dir + '/' : ''}`).join('\n') + '\nchown -R 1001:1001 /workspace /tmp/bitbi-release';
    docker(['exec',name,'bash','-c',prep]);
    const savedRuntime=path.join(directory,'runtime');
    if(fs.existsSync(savedRuntime)) {
      docker(['cp',`${savedRuntime}/.`,`${name}:/tmp/bitbi-release/`]);
      docker(['exec',name,'chown','-R','1001:1001','/tmp/bitbi-release']);
    }
    const unprivileged=['exec',name,'/usr/bin/setpriv','--reuid=1001','--regid=1001','--clear-groups','--bounding-set=-all','--inh-caps=-all','--ambient-caps=-all','--no-new-privs'];
    if(state.repair||state.permissionContinuation) {
      const tooling=path.join(directory,'tooling-inputs');fs.rmSync(tooling,{recursive:true,force:true});copyEvidenceToolInputs(bundle,tooling);
      docker(['cp',tooling,`${name}:/workspace/.local-release`]);fs.rmSync(tooling,{recursive:true,force:true});
      docker(['exec',name,'chown','-R','1001:1001','/workspace/.local-release']);
    }
    docker([...unprivileged,'bash','-euc',TOOL_PREFLIGHT]);
    docker([...unprivileged,'node','scripts/check-media-tools.mjs']);
    docker([...unprivileged,'node','scripts/check-homepage-runtime.mjs']);
    for (let index = 0; index < commands.length; index++) {
      const command = commands[index], prior = state.commands[index];
      if (prior?.exitCode === 0) {
        assert.deepEqual(prior.command, command);
        assert.equal(sha256(fs.readFileSync(path.join(bundle, prior.log))), prior.logHash);
        continue; // Resume exact unchanged source only; no repeated passed command.
      }
      assert(state.commands.slice(0,index).every(row=>row?.exitCode===0),'Cannot skip an unresolved earlier command');
      const log = `logs/${index}.log`, logFile = path.join(bundle, log);
      if(fs.existsSync(logFile)) {
        const failures=path.join(directory,'failures');fs.mkdirSync(failures,{recursive:true});
        fs.copyFileSync(logFile,path.join(failures,`${index}-${Date.now()}.log`));
      }
      const fd = fs.openSync(logFile, 'w');
      const started = Date.now();
      console.log(`[local ${index + 1}/${commands.length}] ${command.job}: ${command.name}`);
      let result;
      try {
        if(command.name==='Build and test private media Linux image') {
          result=spawnSync(process.execPath,['scripts/private-media-image.mjs','--if-needed'],{cwd:work,
            env:{...safeEnv(),DOCKER_CONTEXT:'colima-bitbi-release',GITHUB_SHA:sha,GITHUB_RUN_ID:id,GITHUB_RUN_ATTEMPT:'1',CANDIDATE_BASE:base},
            stdio:['ignore',fd,fd],timeout:1200000});
          if(result.status===0 && fs.existsSync(path.join(work,'test-results/private-media-image'))) {
            docker(['exec',name,'mkdir','-p','/workspace/test-results']);
            docker(['cp',path.join(work,'test-results/private-media-image'),`${name}:/workspace/test-results/`]);
          }
        } else {
        for(const part of commandRuntimes(command)) {
        if(part.runtime==='native-browser-v1') {
          assert(nativeBrowsers,'Missing native browser preparation');
          const nativeHome=path.join(directory,'native-home');
          fs.mkdirSync(nativeHome,{recursive:true,mode:0o700});
          // Linux ARM Chromium lacks H264. The existing Mac distribution at the
          // same locked Playwright revision supplies the actual browser group.
          for(const dir of PACKAGES) {
            const modules=path.join(work,dir,'node_modules');
            if(fs.existsSync(modules))assert(fs.lstatSync(modules).isSymbolicLink(),'Unexpected native dependency directory');
            else fs.symlinkSync(nativeBrowsers.packages[dir],modules);
          }
          for(const item of ['candidate','_site']) {
            fs.rmSync(path.join(work,item),{recursive:true,force:true});
            docker(['cp',`${name}:/workspace/${item}`,path.join(work,item)]);
          }
          const nativeManifest=json(path.join(work,'candidate/manifest.json'));
          assert.deepEqual(tree(path.join(work,'_site')),nativeManifest.files,'Native input differs from the candidate');
          if(state.repair||state.permissionContinuation)fs.cpSync(path.join(bundle,'reuse'),path.join(work,'.local-release/reuse'),{recursive:true});
          // Each fresh browser invocation has a fresh profile/server. Shared
          // dependency installations are persistent, never browser/account state.
          const scope=command.name==='Run selected auth and admin tests'?'auth':command.name==='Run selected homepage core tests'?'homepage':null;
          const browserRun=isSmoothContinuation(state.permissionContinuation?.source)&&scope==='auth'?'node scripts/local-release.mjs smooth-browser-continuation':state.repair&&scope?`node scripts/local-release.mjs browser-continuation ${scope}`:part.run;
          result=spawnSync('/bin/bash',['--noprofile','--norc','-euo','pipefail','-c',browserRun],{cwd:work,
            env:{...safeEnv(),...env,...command.env,HOME:nativeHome,GITHUB_JOB:command.job,
              WRANGLER_SEND_METRICS:'false',npm_config_userconfig:path.join(nativeHome,'.npmrc'),
              PLAYWRIGHT_BROWSERS_PATH:nativeBrowsers.browserRoot,BITBI_LOCAL_RELEASE_CONTAINER:'',
              Q2_RUNTIME_ARTIFACTS:path.join(directory,'native-browser-runtime'),RUNNER_TOOL_CACHE:path.join(directory,'native-browser-tools'),npm_config_cache:path.join(cacheRoot(),'native-npm')},
            stdio:['ignore',fd,fd],timeout:60*60*1000});
          assert.equal(git(['status','--porcelain','--untracked-files=no'],work),'','Native tests modified committed inputs');
          assert.deepEqual(json(path.join(work,'candidate/manifest.json')),nativeManifest,'Native tests changed candidate metadata');
          assert.deepEqual(tree(path.join(work,'_site')),nativeManifest.files,'Native tests changed candidate bytes');
          for(const item of ['test-results','candidate-proofs'])if(fs.existsSync(path.join(work,item))) {
            docker(['exec',name,'mkdir','-p',`/workspace/${item}`]);docker(['cp',`${path.join(work,item)}/.`,`${name}:/workspace/${item}/`]);
          }
        } else {
        // Native Q2 alone needs the reviewed privileged bootstrap. All ordinary
        // test/build processes have an empty capability set and no-new-privs.
        const q2 = /test-q2-runtime|test:workers/.test(command.run);
        const args = ['exec', '--user', q2 ? '1001:1001' : '0:0', ...Object.entries({ ...command.env, GITHUB_JOB: command.job }).filter(([key]) => key !== 'GH_TOKEN').flatMap(([key,value]) => ['--env',`${key}=${value}`]), name];
        if (!q2) args.push('/usr/bin/setpriv','--reuid=1001','--regid=1001','--clear-groups','--bounding-set=-all','--inh-caps=-all','--ambient-caps=-all','--no-new-privs');
        const effective=state.permissionContinuation?.source===PERMISSION_CONTINUATION.tail&&index===41?canvasStageContinuation(part.run):state.repair&&index===42?localWorkerContinuation():state.repair&&index===18?localRepairCommand(sha):part.run;
        const execution=command.name==='Restore exact candidate static site'?'node scripts/local-release.mjs restore-boundary\n'+effective:effective;
        args.push('bash','--noprofile','--norc','-euo','pipefail','-c',execution);
        result = spawnSync('docker', ['--context','colima-bitbi-release',...args], { env: safeEnv(), stdio: ['ignore',fd,fd], timeout: 60 * 60 * 1000 });
        }
        if(result.status!==0)break;
        }
        }
      } finally { fs.closeSync(fd); }
      const record = { command, exitCode: result.status ?? -1, durationMs: Date.now() - started, log, logHash: sha256(fs.readFileSync(logFile)) };
      record.runtimes=commandRuntimes(command).map(part=>part.runtime);
      if(state.repair&&['Run selected auth and admin tests','Run selected homepage core tests'].includes(command.name))record.browserContinuation='local-browser-continuation-v1';
      if(isSmoothContinuation(state.permissionContinuation?.source)&&command.name==='Run selected auth and admin tests')record.browserContinuation=SMOOTH_BROWSER_POLICY;
      if(state.repair&&index===42)record.continuation=localWorkerContinuation();
      if(state.repair&&index===18)record.supplement=localRepairCommand(sha);
      if(state.permissionContinuation?.source===PERMISSION_CONTINUATION.tail&&index===41)record.continuation=canvasStageContinuation(command.run);
      state.commands[index] = record; state.status = record.exitCode === 0 ? 'running' : 'failed'; save(checkpoint, state);
      assert.equal(record.exitCode, 0, `Local check failed: ${command.name}. Evidence: ${logFile}. Resume this exact source with --resume ${directory}`);
      if(state.permissionContinuation&&state.permissionContinuation.source!==PERMISSION_CONTINUATION.source&&index===34)docker([...unprivileged,'node','--input-type=module','-e',"import fs from 'node:fs';import{restoreCanvasHostingProof}from'./scripts/lib/local-release-evidence.mjs';fs.cpSync('.local-release/reuse','reuse',{recursive:true});restoreCanvasHostingProof('.');fs.rmSync('reuse',{recursive:true});"]);
      if([SMOOTH_BROWSER_CONTINUATION.accepted,SMOOTH_BROWSER_CONTINUATION.completed].includes(state.permissionContinuation?.source)&&index===44)docker([...unprivileged,'node','--input-type=module','-e',"import fs from 'node:fs';import{restoreSmoothBrowserProof}from'./scripts/lib/local-release-browser.mjs';fs.cpSync('.local-release/reuse','reuse',{recursive:true});restoreSmoothBrowserProof('.',{sha:process.env.GITHUB_SHA});fs.rmSync('reuse',{recursive:true});"]);
      if(state.repair&&index===35) {
        // Candidate source metadata is new; the tested package remains byte-identical.
        // Preserve the original native report and explicit proof provenance.
        docker([...unprivileged,'node','--input-type=module','-e',`import fs from 'node:fs';import{createHash}from'node:crypto';
          const manifest=JSON.parse(fs.readFileSync('candidate/manifest.json')),proof=JSON.parse(fs.readFileSync('.local-release/reuse/proof-frontend-runtime.json'));
          fs.writeFileSync('candidate/proof-frontend-runtime.json',JSON.stringify({...proof,manifestHash:createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),reusedFrom:{sha:'${LOCAL_WORKER_REPAIR.source}',manifestHash:proof.manifestHash}}));`]);
      }
      if(state.repair&&index===42)docker(['cp',`${name}:/workspace/.local-release/test-results/worker-discovery.json`,path.join(bundle,'test-results/worker-discovery.json')]);
      if(commands[index+1]?.job!==command.job)collect();
    }
    // Keep executed reports and the original candidate identity intact.
    collect();
    assert.equal(docker(['exec','--user','1001:1001',name,'git','status','--porcelain','--untracked-files=no']).trim(),'','Tests modified committed inputs');
    state.candidateFiles = tree(path.join(bundle, 'candidate'));
    state.status = 'passed'; state.completedAt = new Date().toISOString();
    save(path.join(bundle,'evidence.json'),state);
    verifyLocalEvidence(bundle, { sha, base });
    save(checkpoint,state);
    console.log(JSON.stringify({ status: 'passed', sha, directory, environmentReused: environment.reused, preparationMs: environment.preparationMs }));
    return directory;
  } catch(error) {
    state.status='failed';save(checkpoint,state);
    throw error;
  } finally {
    if(created) {
      try {
        const savedRuntime=path.join(directory,'runtime');
        fs.rmSync(savedRuntime,{recursive:true,force:true});
        if(docker(['exec',name,'sh','-c','if [ -d /tmp/bitbi-release ]; then echo present; fi']).trim())docker(['cp',`${name}:/tmp/bitbi-release`,savedRuntime]);
        for (const item of ['candidate','candidate-proofs','_site','test-results']) {
          if (docker(['exec',name,'sh','-c',`if [ -d /workspace/${item} ]; then echo present; fi`]).trim()) {
            fs.rmSync(path.join(work,item),{recursive:true,force:true});
            docker(['cp',`${name}:/workspace/${item}`,path.join(work,item)]);
          }
        }
      } catch(error) {
        // Preserve the original failed command and its log. Incomplete snapshots
        // never acquire a passing receipt; an exact resume rechecks the reports.
        console.error(`Local snapshot failed (${error.code || error.status || 'unknown'}); evidence: ${directory}`);
      } finally {
        try { docker(['rm','-f',name]); }
        catch(error) { console.error(`Remove the task container ${name} before another run (${error.code || error.status || 'unknown'}).`); }
      }
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), command = args.shift();
    if (command === 'prepare') { assert.equal(args.length, 0); console.log(JSON.stringify(await withReleaseLock(()=>ensureEnvironment()))); }
    else if (command === 'restore-boundary') {assert.equal(args.length,0);prepareCandidateRestore();}
    else if (command === 'verify-worker-repair') {assert.equal(args.length,1);console.log(JSON.stringify(verifyLocalWorkerRepair(path.resolve(args[0]),git(['rev-parse','HEAD'])).result));}
    else if (command === 'smooth-browser-continuation') {assert.equal(args.length,0);runSmoothBrowserContinuation();}
    else if (command === 'browser-continuation') {assert.equal(args.length,1);assertLocalRepairTree(git(['rev-parse','HEAD']));runMigrationBrowserContinuation(args[0]);}
    else if (command === 'prepare-native') {assert.equal(args.length,0);console.log(JSON.stringify(await withReleaseLock(()=>ensureNativeBrowsers())));}
    else if (command === 'baseline') { assert.equal(args.length,0);console.log(await verifiedLocalBase()); }
    else if (command === 'import') {
      assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.equal(process.env.GITHUB_JOB, 'release-compatibility');
      assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
      const { importLocalEvidence } = await import('./lib/local-release-transport.mjs');
      const result = await importLocalEvidence({ sha: process.env.GITHUB_SHA, base: process.env.CANDIDATE_BASE });
      console.log(`Accepted local evidence ${result.receipt} for ${result.manifest.sha}; no suites executed on GitHub.`);
    }
    else if (command === 'upload') {
      assert.equal(args.length, 1);
      const { uploadLocalEvidence } = await import('./lib/local-release-transport.mjs');
      console.log(JSON.stringify(await withReleaseLock(()=>uploadLocalEvidence(path.resolve(args[0])))));
    }
    else if (command === 'test' || command === 'release' || command === 'preflight') {
      const options = {}; for (let i = 0; i < args.length; i += 2) { assert(['--base','--resume'].includes(args[i]) && args[i+1]); options[args[i].slice(2)] = args[i+1]; }
      if(command==='release')await releaseLocal(options);else if(command==='preflight')await preflightLocal(options);else await withReleaseLock(()=>runLocalRelease(options));
    } else throw new Error('Usage: local-release.mjs prepare | baseline | preflight|release [--base <wider-SHA>] [--resume <directory>] | test --base <verified-published-SHA> [--resume <directory>]');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
