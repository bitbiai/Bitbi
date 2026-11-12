// Guard fixtures, never product/release acceptance.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {STATIC_FIXTURE_POLICY,STATIC_FIXTURE_REUSE,assertStaticFixtureTree,assertStaticFixtureInputs,copyStaticFixtureReports,verifyStaticBrowserUnion,recoverStaticFixtureCompletion,verifyStaticBrowserFiles,prepareStaticFixtureReuse,verifyStaticFixtureReuse} from './lib/local-release-static-fixture.mjs';
import {sha256,commandRuntimes,selectedCommands,LOCAL_POLICY} from './lib/local-release-plan.mjs';
import {gitSelection,candidateProof,REPOSITORY} from './pages-candidate.mjs';
import {verifyLocalEvidence} from './lib/local-release-evidence.mjs';
import {browserRows} from './lib/browser-fixture-repair.mjs';
import {passedBrowserCase} from './lib/local-release-browser.mjs';
import {resourceProfile} from './lib/local-release-environment.mjs';

const p=STATIC_FIXTURE_REUSE,identity=({key,file,title,project})=>({key,file,title,project});
export async function testStaticFixtureReuse() {
  const root=process.cwd(),scratch=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-static-fixture-guard-'));
  const write=(file,bytes)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);};
  const git=(args,options={})=>execFileSync('git',args,{encoding:'utf8',stdio:['pipe','pipe','pipe'],...options}).trim();
  try {
    const repository=path.join(scratch,'git');git(['init','--bare',repository]);
    write(path.join(repository,'objects/info/alternates'),path.resolve(root,git(['rev-parse','--git-path','objects']))+'\n');
    const options={cwd:repository,env:{...process.env,GIT_INDEX_FILE:path.join(scratch,'index'),GIT_AUTHOR_NAME:'Release guard',GIT_AUTHOR_EMAIL:'guard@invalid.test',GIT_COMMITTER_NAME:'Release guard',GIT_COMMITTER_EMAIL:'guard@invalid.test'}};
    const command=(args,input)=>git(args,{...options,...(input===undefined?{}:{input})});
    const commit=(tree,parents=[p.source])=>command(['commit-tree',tree,...parents.flatMap(parent=>['-p',parent])],'Verifier fixture\n');
    const check=head=>{process.chdir(repository);try{return assertStaticFixtureTree(head);}finally{process.chdir(root);}};
    command(['read-tree',p.source]);
    const file='tests/oma2-q3-model-pricing.spec.js';
    // Freeze the reviewed historical bytes; future legitimate spec edits must not
    // alter this positive guard fixture or acquire reuse of the old acceptance.
    const fixed=Buffer.from(execFileSync('git',['show',`${p.source}:${file}`],{encoding:'utf8'}).replace("   await root(page).getByRole('searchbox').fill(`gpt-image-2.5-${suffix}`);const row=root(page).locator('.model-pricing__row').filter({has:page.getByText('MiniMax H3',{exact:true})});await expect(root(page).locator('.model-pricing__row')).toHaveCount(2);await expect(row).toHaveCount(1);","   await root(page).getByRole('searchbox').fill(`gpt-image-2.5-${suffix}`);const row=root(page).locator('.model-pricing__row');await expect(row).toHaveCount(1);await expect(row).toContainText(`GPT Image 2.5 ${suffix==='sunburst'?'Sunburst':'Flare'}`);"));
    const blob=command(['hash-object','-w','--stdin'],fixed);
    assert.equal(sha256(fixed),p.fixture);command(['update-index','--cacheinfo','100644',blob,file]);
    const correctedTree=command(['write-tree']),head=commit(correctedTree);
    assert.deepEqual(check(head),[file]);
    assert.throws(()=>check(commit(correctedTree,[head])),/direct fixture\/tooling successor/);
    assert.throws(()=>check(commit(correctedTree,[p.source,p.base])),/direct fixture\/tooling successor/);
    command(['read-tree',p.resourceRepairParent]);
    command(['update-index','--cacheinfo','100644',blob,'scripts/lib/local-release-static-fixture.mjs']);
    const resourceTree=command(['write-tree']),resourceHead=commit(resourceTree,[p.resourceRepairParent]);
    assert(check(resourceHead).includes('scripts/lib/local-release-static-fixture.mjs'));
    assert.throws(()=>check(commit(resourceTree,[resourceHead])),/direct fixture\/tooling successor/);
    command(['update-index','--cacheinfo','100644',blob,'scripts/local-release.mjs']);
    assert.throws(()=>check(commit(command(['write-tree']),[p.resourceRepairParent])),/Resource repair may change only/);
    for(const wrong of ['workers/auth/src/routes/canvas.js','tests/helpers/canvas-agent-ui.cjs','package-lock.json','config/release-compat.json','.github/workflows/static.yml']) {
      command(['read-tree',correctedTree]);command(['update-index','--add','--cacheinfo','100644',blob,wrong]);
      assert.throws(()=>check(commit(command(['write-tree']))),/Product, shared fixture, dependency, workflow or configuration changed/);
    }
    command(['read-tree',correctedTree]);command(['update-index','--cacheinfo','100755',blob,file]);
    assert.throws(()=>check(commit(command(['write-tree']))),/regular nonexecutable/);
    command(['read-tree',correctedTree]);command(['update-index','--cacheinfo','100644',command(['hash-object','-w','--stdin'],fixed+'\n'),file]);
    assert.throws(()=>check(commit(command(['write-tree']))),/fixture differs/);

    const GiB=1024**3,resources=resourceProfile(16*GiB);
    const original={planHash:'plan',selection:{full:true,workers:true,files:['old']},environment:{key:'image',resources,resourceObservation:{hostMemoryBytes:16*GiB,
      vm:{configuration:{cpu:4,memory:4,disk:80},actual:{cpus:4,memoryBytes:4095193088}},container:{cpus:4,memoryBytes:3*GiB,shmBytes:GiB}},reused:false,preparationMs:1},nativeBrowsers:{key:'native',reused:false,preparationMs:1}},current=structuredClone(original);
    current.selection.files=['new'];current.environment.reused=true;assertStaticFixtureInputs(original,current);
    const unchanged=JSON.stringify(original);
    for(const delta of [-8192,8192]) {
      const drift=structuredClone(current);drift.environment.resourceObservation.vm.actual.memoryBytes+=delta;
      const observed=JSON.stringify(drift);assertStaticFixtureInputs(original,drift);
      const preparedDrift=structuredClone(drift);delete preparedDrift.environment.resourceObservation.container;
      assertStaticFixtureInputs(original,preparedDrift,{preparing:true});
      assert.equal(JSON.stringify(drift),observed,'Raw current observation must remain unchanged');
    }
    assert.equal(JSON.stringify(original),unchanged,'Raw original observation must remain unchanged');
    for(const mutate of [
      e=>delete e.resources,e=>delete e.resourceObservation,e=>delete e.resourceObservation.vm.actual.memoryBytes,
      e=>e.resourceObservation.vm.actual.memoryBytes=2*GiB,e=>e.resourceObservation.vm.actual.memoryBytes=5*GiB,
      e=>e.resourceObservation.vm.actual.memoryBytes=NaN,e=>e.resourceObservation.vm.actual.memoryBytes=4095193088.5,e=>e.resourceObservation.vm.actual.cpus=2,
      e=>e.resourceObservation.vm.configuration.cpu=2,e=>e.resourceObservation.vm.configuration.memory=12,e=>e.resourceObservation.vm.configuration.disk=40,
      e=>e.resourceObservation.hostMemoryBytes=24*GiB,e=>e.resourceObservation.hostMemoryBytes=20*GiB,
      e=>e.resourceObservation.container.memoryBytes=2*GiB,e=>e.resourceObservation.container.shmBytes=0,
      e=>e.resources.container.memoryGiB=2,e=>e.key='changed-key',e=>e.image='changed-image',e=>e.node='changed-toolchain',
    ]) {
      const broken=structuredClone(current);mutate(broken.environment);
      assert.throws(()=>assertStaticFixtureInputs(original,broken));
      assert.throws(()=>assertStaticFixtureInputs(broken,current),'Both raw observations must be validated');
    }
    for(const mutate of [e=>e.nativeBrowsers.key='changed',e=>e.planHash='changed',e=>e.selection.workers=false]) {
      const broken=structuredClone(current);mutate(broken);assert.throws(()=>assertStaticFixtureInputs(original,broken));
    }
    const preparing=structuredClone(current);delete preparing.environment.resourceObservation.container;
    assertStaticFixtureInputs(original,preparing,{preparing:true});assert.throws(()=>assertStaticFixtureInputs(original,preparing));
    preparing.environment.resourceObservation.hostMemoryBytes=24*GiB;assert.throws(()=>assertStaticFixtureInputs(original,preparing,{preparing:true}));
    current.environment.resourceObservation.container.cpus=2;assert.throws(()=>assertStaticFixtureInputs(original,current,{preparing:true}));

    const row=(id,status='passed')=>({key:`chromium:${id}`,file:'fixture.spec.js',title:id,project:'chromium',expectedStatus:'passed',status:status==='passed'?'expected':'unexpected',results:[{status,retry:0,error:status!=='passed'}]});
    const pass=row('retained'),fail=row('pending','failed'),skip={...row('excluded','skipped'),expectedStatus:'skipped',status:'skipped',results:[{status:'skipped',retry:0,error:false}]};
    const previous=[pass,fail,skip],discovery=previous.map(identity),fresh=[row('pending')];
    assert.deepEqual(verifyStaticBrowserUnion(discovery,previous,fresh,[skip.key]),{required:2,reused:1,executed:1,excluded:1,discovered:3});
    for(const broken of [[],[...fresh,...fresh],[row('retained')],[row('pending','failed')],[row('pending','skipped')],[{...fresh[0],results:[{status:'passed',retry:1,error:false}]}]])assert.throws(()=>verifyStaticBrowserUnion(discovery,previous,broken,[skip.key]));
    assert.throws(()=>verifyStaticBrowserUnion(discovery.slice(1),previous,fresh,[skip.key]));
    assert.throws(()=>verifyStaticBrowserUnion(discovery,previous,fresh,[skip.key,skip.key]));
    assert.throws(()=>verifyStaticBrowserUnion(discovery,previous,fresh,[fail.key,skip.key]));
    const unexecuted={...row('not-executed','skipped'),status:'skipped',results:[]};
    assert.throws(()=>verifyStaticBrowserUnion([...discovery,identity(unexecuted)],[...previous,unexecuted],fresh,[skip.key]),/unresolved required/);
    assert.equal(verifyStaticBrowserUnion([...discovery,identity(unexecuted)],[...previous,unexecuted],[...fresh,row('not-executed')],[skip.key]).executed,2);

    const source=path.join(scratch,'source'),target=path.join(scratch,'target');
    for(const name of ['frontend-runtime.log','homepage-runtime.json','candidate-static.json','native/report.json'])write(path.join(source,'test-results',name),'old '+name);
    for(const name of ['frontend-runtime.log','homepage-runtime.json'])write(path.join(target,'test-results',name),'fresh '+name);
    copyStaticFixtureReports(source,target);
    assert.equal(fs.readFileSync(path.join(target,'test-results/homepage-runtime.json'),'utf8'),'fresh homepage-runtime.json');
    assert.equal(fs.readFileSync(path.join(target,'test-results/frontend-runtime.log'),'utf8'),'fresh frontend-runtime.log');
    assert(!fs.existsSync(path.join(target,'test-results/candidate-static.json')));
    assert.equal(fs.readFileSync(path.join(target,'test-results/native/report.json'),'utf8'),'old native/report.json');
    const interrupted=path.join(scratch,'interrupted'),attempt=path.join(interrupted,'test-results/static-fixture-attempts/00000000-0000-4000-8000-000000000000');
    write(path.join(attempt,'attempt.json'),JSON.stringify({sha:head,policy:STATIC_FIXTURE_POLICY}));
    assert.equal(recoverStaticFixtureCompletion(interrupted,head,previous),null);
    write(path.join(attempt,'fresh-started.json'),'{}');
    assert.throws(()=>recoverStaticFixtureCompletion(interrupted,head,previous),/Interrupted fresh execution/);
    write(path.join(interrupted,'test-results/candidate-static.json'),JSON.stringify({policy:STATIC_FIXTURE_POLICY,sha:head,source:p.source,scope:'static',previous,discovery,fresh,excluded:[skip.key]}));
    assert.throws(()=>recoverStaticFixtureCompletion(interrupted,head,previous),/pinned static/);

    // Execute the real dispatcher body with browser/VM subprocesses stubbed.
    // This catches the actual native -> Linux boundary, not a second dispatcher.
    const runner=fs.readFileSync('scripts/local-release.mjs','utf8');
    const start=runner.indexOf('        for(const part of commandRuntimes(command)) {'),end=runner.indexOf('\n        }\n      } finally { fs.closeSync(fd); }',start);
    assert(start>0&&end>start);const body=runner.slice(start,end);
    const globals={...await import('./lib/local-release-evidence.mjs'),...await import('./lib/local-release-browser.mjs'),...await import('./lib/canvas-export-release.mjs'),...await import('./lib/canvas-export-browser.mjs'),...await import('./lib/local-release-static-fixture.mjs'),commandRuntimes};
    const full=selectedCommands(gitSelection(p.base,p.source),{GITHUB_SHA:p.source,CANDIDATE_BASE:p.base}).find(command=>command.name==='Run full static browser regression');
    const execute=nativeStatus=>{
      const calls=[],context={...globals,assert,path,command:full,state:{staticFixtureContinuation:{policy:STATIC_FIXTURE_POLICY}},nativeBrowsers:{browserRoot:'locked',packages:{}},PACKAGES:[],directory:'/guard',work:'/guard/work',bundle:'/guard/bundle',name:'guard-container',index:52,env:{},fd:1,sha:head,result:null,
        fs:{mkdirSync(){},existsSync(){return false;},rmSync(){},cpSync(){},symlinkSync(){}},docker(){},json:()=>({files:{}}),tree:()=>({}),git:()=>'',safeEnv:()=>({}),cacheRoot:()=>'/guard/cache',
        spawnSync:(file,args)=>{calls.push({file,args});return {status:file==='/bin/bash'?nativeStatus:0};}};
      vm.runInNewContext(body,context);return calls;
    };
    const calls=execute(0);assert.equal(calls.length,2);assert.equal(calls[0].file,'/bin/bash');assert.equal(calls[0].args.at(-1),'node scripts/local-release.mjs static-fixture-continuation');
    assert.equal(calls[1].file,'docker');assert.equal(calls[1].args.at(-1),commandRuntimes(full)[1].run);assert.match(calls[1].args.at(-1),/test:homepage-carousel/);
    assert.equal(execute(1).length,1,'Failed native cannot claim carousel execution');
    const writer=runner.slice(runner.indexOf('      record.runtimes=commandRuntimes(command)'),runner.indexOf('      state.commands[index] = record;'));
    const context={...globals,state:{staticFixtureContinuation:{policy:STATIC_FIXTURE_POLICY}},command:full,index:52,record:{},sha:head};vm.runInNewContext(writer,context);
    assert.equal(context.record.browserContinuation,STATIC_FIXTURE_POLICY);assert.deepEqual([...context.record.runtimes],['native-browser-v1','linux']);
    assert.equal(context.record.continuation,'node scripts/local-release.mjs static-fixture-continuation');

    // Protected entrypoints reject a policy-shaped report without pinned/raw proof.
    assert.throws(()=>candidateProof({sha:head,selection:{full:true}},{job:'browser-validation',evidenceDirectory:target,readJson:()=>({policy:STATIC_FIXTURE_POLICY,sha:head,source:p.source,scope:'static',previous,discovery,fresh,excluded:[skip.key]})}));
    write(path.join(target,'evidence.json'),JSON.stringify({policy:LOCAL_POLICY,repository:REPOSITORY,status:'failed',sha:p.source,base:p.base,sourceTree:git(['rev-parse',`${p.source}^{tree}`]),staticFixtureContinuation:{policy:STATIC_FIXTURE_POLICY}}));
    assert.throws(()=>verifyLocalEvidence(target,{sha:p.source,base:p.base}),/incomplete or failed/);
    // Private release clones supply the pinned original. Exercise actual source
    // admission, prefix retention, raw-proof import and same-source recovery.
    // Synthesized fresh rows below are confined to scratch guard fixtures.
    const supplied=path.join(root,'.local-release/reuse/test-results/static-fixture-origin');
    if(fs.existsSync(supplied)) {
      const originalRun=path.join(scratch,p.run),prefix=path.join(scratch,'prefix');
      write(path.join(originalRun,'checkpoint.json'),fs.readFileSync(path.join(supplied,'checkpoint.json')));
      write(path.join(originalRun,'source/test-results/candidate-static.json'),fs.readFileSync(path.join(supplied,'failed-static.json')));
      fs.cpSync(path.join(supplied,'bundle'),path.join(originalRun,'bundle'),{recursive:true});
      const before=JSON.parse(fs.readFileSync(path.join(originalRun,'checkpoint.json'))),commands=selectedCommands(before.selection,{GITHUB_SHA:head,CANDIDATE_BASE:p.base});
      const state={...structuredClone(before),sha:head,sourceTree:correctedTree,id:'guard-only',status:'running',commands:[]};
      state.environment.resourceObservation.vm.actual.memoryBytes+=8192;
      process.chdir(repository);
      try {
        state.selection=gitSelection(p.base,head);
        const prepared=prepareStaticFixtureReuse(originalRun,prefix,state,commands);
        verifyStaticFixtureReuse(prefix,prepared,commands,{allowPending:true});
        assert.equal(prepared.commands.filter(Boolean).length,52-commands.slice(0,52).filter(command=>globals.requiresStaticFixtureRefresh(command.name)).length);
        assert(prepared.commands.slice(52).every(row=>row===null));
        const changed=structuredClone(prepared);changed.environment.image='changed';assert.throws(()=>verifyStaticFixtureReuse(prefix,changed,commands,{allowPending:true}),/Changed execution/);
        const originReport=JSON.parse(fs.readFileSync(path.join(supplied,'failed-static.json'))),old=browserRows(originReport),all=old.map(identity),excluded=old.filter(row=>row.expectedStatus==='skipped'&&row.status==='skipped').map(row=>row.key),fresh=old.filter(row=>!passedBrowserCase(row)&&!excluded.includes(row.key)).map(row=>({...row,status:'expected',results:[{status:'passed',retry:0,error:false}]}));
        const raw=rows=>({errors:[],suites:[{specs:rows.map(row=>({id:row.key.slice(row.project.length+1),file:row.file,title:row.title,tests:[{projectName:row.project,expectedStatus:row.expectedStatus||'passed',status:row.status||'expected',results:(row.results||[]).map(({error,...result})=>result)}]}))}],stats:{expected:rows.filter(row=>row.status==='expected').length,unexpected:rows.filter(row=>row.status==='unexpected').length,flaky:rows.filter(row=>row.status==='flaky').length,skipped:rows.filter(row=>row.status==='skipped').length}});
        const attempt='test-results/static-fixture-attempts/10000000-0000-4000-8000-000000000000',at=path.join(prefix,attempt),reports={discovery:raw(all),'selected-discovery':raw(fresh),fresh:raw(fresh)};
        write(path.join(at,'attempt.json'),JSON.stringify({policy:STATIC_FIXTURE_POLICY,sha:head}));
        write(path.join(at,'fresh-started.json'),JSON.stringify({sha:head,args:['--test-list',`${attempt}/pending.txt`,'--workers=1','--retries=0',`--output=${attempt}/artifacts`]}));
        const hashes={};for(const [name,report]of Object.entries(reports)){const bytes=JSON.stringify(report);write(path.join(at,`${name}.json`),bytes);write(path.join(at,`${name}-exit.json`),JSON.stringify({status:0,signal:null}));hashes[name]=sha256(bytes);}
        const report={policy:STATIC_FIXTURE_POLICY,sha:head,source:p.source,scope:'static',previous:old,discovery:all,fresh,excluded,attempt,raw:hashes,counts:verifyStaticBrowserUnion(all,old,fresh,excluded)};
        assert.equal(verifyStaticBrowserFiles(prefix,report,head).executed,8);
        // Missing final publication can be reconstructed from complete immutable raw proof.
        assert.deepEqual(recoverStaticFixtureCompletion(prefix,head,old),report);
        assert.deepEqual(recoverStaticFixtureCompletion(prefix,head,old),report,'Completed native success must not rerun after carousel failure');
        const manifest={sha:head,selection:{full:true}};
        const readJson=file=>{if(file==='test-results/candidate-static.json')return report;if(file==='test-results/candidate-carousel.json')return raw([fresh[0]]);throw new Error('Unexecuted native Voice remains required');};
        assert.throws(()=>candidateProof(manifest,{job:'browser-validation',evidenceDirectory:prefix,readJson}),/Unexecuted native Voice remains required/,'Different-cwd raw proof must reach the unresolved tail');
        write(path.join(at,'fresh.json'),JSON.stringify({...reports.fresh,errors:[{message:'changed'}]}));
        assert.throws(()=>verifyStaticBrowserFiles(prefix,report,head));assert.throws(()=>recoverStaticFixtureCompletion(prefix,head,old));
        assert.throws(()=>candidateProof(manifest,{job:'browser-validation',evidenceDirectory:prefix,readJson}),error=>!error.message.includes('Voice'));
        console.log('Pinned-origin guard path passed: actual prefix admission, eight-case synthetic union, changed raw rejection, same-source recovery and cross-directory final proof tail.');
      } finally {process.chdir(root);}
    }
    console.log('Static fixture guards passed: exact Git tree, real dispatcher native/Linux split, immutable attempts, reports, exclusions and fail-closed proof admission.');
  } finally {process.chdir(root);fs.rmSync(scratch,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await testStaticFixtureReuse();
