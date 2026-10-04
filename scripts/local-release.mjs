import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { ensureEnvironment, docker, PACKAGES, cacheRoot, TOOL_PREFLIGHT } from './lib/local-release-environment.mjs';
import { LOCAL_POLICY, validationPlan, selectedCommands, sha256 } from './lib/local-release-plan.mjs';
import { gitSelection, tree, REPOSITORY, publishedBase } from './pages-candidate.mjs';
import { verifyLocalEvidence, LOCAL_WORKER_REPAIR, LOCAL_REPAIR_REFRESH, assertLocalRepairTree, verifyLocalWorkerRepair, localWorkerContinuation } from './lib/local-release-evidence.mjs';

const git = (args, cwd = '.') => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim();
const json = file => JSON.parse(fs.readFileSync(file));
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const safeEnv = () => ({ PATH: process.env.PATH, HOME: os.homedir(), TMPDIR: os.tmpdir(), LANG: 'en_US.UTF-8' });

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
  const {uploadLocalEvidence}=await import('./lib/local-release-transport.mjs');
  const transport=await uploadLocalEvidence(directory);
  // The single existing main-push workflow continues automatically. Test
  // evidence exists before push; a normal push never races an unfinished test.
  const sha=git(['rev-parse','HEAD']);
  const remote=git(['ls-remote','origin','refs/heads/main']).split(/\s/)[0];
  if(remote!==sha)execFileSync('git',['push','origin','HEAD:main'],{stdio:'inherit'});
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
  const originalDirectory=resume&&json(path.join(resume,'checkpoint.json')).sha!==sha?path.resolve(resume):null;
  if(originalDirectory)assertLocalRepairTree(sha);
  const directory = resume&&!originalDirectory ? path.resolve(resume) : path.join(cacheRoot(), 'runs', `${sha}-${randomUUID()}`);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const work = path.join(directory, 'source'), bundle = path.join(directory, 'bundle'), checkpoint = path.join(directory, 'checkpoint.json');
  const id = path.basename(directory), commands = selectedCommands(selection, { GITHUB_SHA: sha, CANDIDATE_BASE: base });
  let state = fs.existsSync(checkpoint) ? json(checkpoint) : { policy: LOCAL_POLICY, repository: REPOSITORY,
    id, sha, base, sourceTree: git(['rev-parse',`${sha}^{tree}`]), planHash: validationPlan().digest,
    selection, environment, origin: 'development-mac', ci: true, startedAt: new Date().toISOString(), status: 'running', commands: [] };
  if(originalDirectory) {
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
    fs.cpSync(path.join(originalDirectory,'runtime'),path.join(directory,'runtime'),{recursive:true});
    state={...state,startedAt:prior.startedAt,repair:{source:prior.sha,checkpoint:LOCAL_WORKER_REPAIR.checkpoint},commands:prior.commands.map((row,index)=>LOCAL_REPAIR_REFRESH.has(index)?null:{...row,command:commands[index],reusedFrom:prior.sha})};
  }
  assert.equal(state.sha, sha); assert.equal(state.base, base); assert.equal(state.planHash, validationPlan().digest);
  assert.equal(state.environment.key, environment.key, 'Changed dependencies invalidate this resume');
  if(state.status==='passed') {
    verifyLocalEvidence(bundle,{sha,base});
    console.log(`Reusing completed local acceptance for the same ${sha}; no suite repeated.`);
    return directory;
  }
  if (!fs.existsSync(work)) {
    execFileSync('git', ['clone','--local','--no-hardlinks','--no-checkout','.',work], { stdio: 'pipe' });
    git(['checkout','--detach',sha], work);
    git(['remote','set-url','origin','https://github.com/bitbiai/Bitbi.git'], work);
    if(originalDirectory)for(const name of ['candidate','_site','test-results'])fs.cpSync(path.join(originalDirectory,'source',name),path.join(work,name),{recursive:true});
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
    if(state.repair) {
      docker(['cp',bundle,`${name}:/workspace/.local-release`]);
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
        // Native Q2 alone needs the reviewed privileged bootstrap. All ordinary
        // test/build processes have an empty capability set and no-new-privs.
        const q2 = /test-q2-runtime|test:workers/.test(command.run);
        const args = ['exec', '--user', q2 ? '1001:1001' : '0:0', ...Object.entries({ ...command.env, GITHUB_JOB: command.job }).filter(([key]) => key !== 'GH_TOKEN').flatMap(([key,value]) => ['--env',`${key}=${value}`]), name];
        if (!q2) args.push('/usr/bin/setpriv','--reuid=1001','--regid=1001','--clear-groups','--bounding-set=-all','--inh-caps=-all','--ambient-caps=-all','--no-new-privs');
        const effective=state.repair&&index===42?localWorkerContinuation():state.repair&&index===18?'npm run test:local-release -- --repair-only':command.run;
        args.push('bash','--noprofile','--norc','-euo','pipefail','-c',effective);
        result = spawnSync('docker', ['--context','colima-bitbi-release',...args], { env: safeEnv(), stdio: ['ignore',fd,fd], timeout: 60 * 60 * 1000 });
        }
      } finally { fs.closeSync(fd); }
      const record = { command, exitCode: result.status ?? -1, durationMs: Date.now() - started, log, logHash: sha256(fs.readFileSync(logFile)) };
      if(state.repair&&index===42)record.continuation=localWorkerContinuation();
      if(state.repair&&index===18)record.supplement='npm run test:local-release -- --repair-only';
      state.commands[index] = record; state.status = record.exitCode === 0 ? 'running' : 'failed'; save(checkpoint, state);
      assert.equal(record.exitCode, 0, `Local check failed: ${command.name}. Evidence: ${logFile}. Resume this exact source with --resume ${directory}`);
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
    else if (command === 'verify-worker-repair') {assert.equal(args.length,1);console.log(JSON.stringify(verifyLocalWorkerRepair(path.resolve(args[0]),git(['rev-parse','HEAD'])).result));}
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
