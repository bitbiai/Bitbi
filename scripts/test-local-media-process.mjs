import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {MEDIA_IMAGE_STEP_TIMEOUT_MS,runMediaImageChild,runMediaImageStep,restoreMediaTestDiagnostics,cleanupMediaTestContainer,persistMediaTestContainer} from './lib/local-media-test-process.mjs';

export async function testLocalMediaProcess() {
  assert.equal(MEDIA_IMAGE_STEP_TIMEOUT_MS,1200000,'The parent media deadline stays at twenty minutes');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-media-parent-'));
  const sha='a'.repeat(40),image='sha256:'+'b'.repeat(64),run='synthetic-local-run',attempt='1';
  const producer=new URL('./private-media-image.mjs',import.meta.url).href;
  const actualContainer=identity=>({Name:'/'+identity.name,Config:{Image:identity.image,Labels:{
    'ai.bitbi.media-test.owner':identity.owner.nonce,'ai.bitbi.media-test.sha':sha,'ai.bitbi.media-test.run':run,'ai.bitbi.media-test.attempt':attempt,
    'ai.bitbi.media-test.pid':String(identity.pid),'ai.bitbi.media-test.group':identity.group,
  }}});
  try {
    for(const mode of ['success','failure','timeout','signal']) {
      const cwd=path.join(root,mode),directory=path.join(cwd,'test-results/private-media-image');fs.mkdirSync(directory,{recursive:true});
      fs.writeFileSync(path.join(directory,'image.json'),'old success');fs.writeFileSync(path.join(directory,'image.tar'),'old image');
      const operations=[],cleaned=[];
      const script=`import fs from 'node:fs';import {executeMediaTestGroups} from ${JSON.stringify(producer)};
        const directory='test-results/private-media-image';
        executeMediaTestGroups({policy:'full',image:${JSON.stringify(image)},sourceFiles:{fixture:'synthetic'},directory,mounts:[],run(args){
          const active=JSON.parse(fs.readFileSync(directory+'/active-container.json'));
          fs.writeFileSync('ready.json',JSON.stringify({active,args}));
          fs.writeFileSync(directory+'/image.json','new incomplete receipt');fs.writeFileSync(directory+'/image.tar','new incomplete image');
          if(${JSON.stringify(mode)}==='failure')process.exit(23);
          if(${JSON.stringify(mode)}!=='success')Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);
          return 'synthetic completed group';
        },cleanup(){throw Error('The killed child cannot own parent cleanup');}});
        fs.writeFileSync(directory+'/image.json','completed fixture');`;
      const pending=runMediaImageChild({cwd,env:{PATH:process.env.PATH},stdio:'ignore',sha,run,attempt,args:['--input-type=module','-e',script],timeout:mode==='timeout'?1000:5000},
        {cleanup:scope=>cleanupMediaTestContainer(scope,args=>{
          operations.push(args);const ready=JSON.parse(fs.readFileSync(path.join(cwd,'ready.json'))),identity=ready.active;
          assert.equal(scope.pid,identity.pid,'The real launched child owns the persisted identity');
          const labels=ready.args.flatMap((value,index)=>value==='--label'?[ready.args[index+1]]:[]);
          assert(labels.includes(`ai.bitbi.media-test.owner=${scope.owner.nonce}`),'The actual Docker entry carries the parent nonce');
          if(args[0]==='container'){assert.deepEqual(args,['container','inspect',identity.name]);return JSON.stringify([actualContainer(identity)]);}
          assert.deepEqual(args,['rm','--force',identity.name]);cleaned.push(identity.name);return identity.name;
        })});
      if(mode==='signal') {
        const deadline=Date.now()+3000;while(!fs.existsSync(path.join(cwd,'ready.json'))&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
        assert(fs.existsSync(path.join(cwd,'ready.json')),'Observe the active real child before signalling its parent');
        assert(process.listenerCount('SIGTERM')>0,'The parent handler must be installed before sending the actual signal');
        process.kill(process.pid,'SIGTERM');
      }
      const result=await pending;
      assert(fs.existsSync(path.join(cwd,'ready.json')),'The child actually entered its persisted container invocation');
      assert(!fs.existsSync(path.join(directory,'active-container.json')),'Parent or successful child clears only its current identity');
      if(mode==='success') {
        assert.equal(result.status,0);assert.deepEqual(operations,[]);assert.equal(fs.readFileSync(path.join(directory,'image.json'),'utf8'),'completed fixture');
      } else {
        assert.notEqual(result.status,0);assert.equal(cleaned.length,1);assert.equal(operations.length,2);
        if(mode==='timeout')assert.equal(result.error.code,'ETIMEDOUT');if(mode==='signal')assert.equal(result.signal,'SIGTERM');
        if(mode==='failure')assert.equal(result.status,23);
        assert(!fs.existsSync(path.join(directory,'image.json')),'A failed/aborted child cannot leave even a freshly written incomplete receipt');
        assert(!fs.existsSync(path.join(directory,'image.tar')),'A failed/aborted child cannot leave a publishable archive');
      }
    }
    {
      const cwd=path.join(root,'cleanup-rejected'),directory=path.join(cwd,'test-results/private-media-image');fs.mkdirSync(directory,{recursive:true});
      const failure=Error('synthetic Docker cleanup denied');let capture,copyAttempted=false;
      const script=`import fs from 'node:fs';import {executeMediaTestGroups} from ${JSON.stringify(producer)};
        const directory='test-results/private-media-image';executeMediaTestGroups({policy:'full',image:${JSON.stringify(image)},sourceFiles:{fixture:'synthetic'},directory,mounts:[],run(){
          fs.appendFileSync(directory+'/test.log','current media failure diagnostics\\n');
          fs.writeFileSync(directory+'/image.json','incomplete success');process.exit(29);
        }});`;
      await assert.rejects(runMediaImageStep({cwd,env:{PATH:process.env.PATH},stdio:'ignore',sha,run,attempt,args:['--input-type=module','-e',script],timeout:5000},
        {diagnosticsRoot:root,onDiagnostics:value=>{capture=value;},cleanup:()=>{throw failure;},copyToWorkspace:()=>{
          copyAttempted=true;assert(capture&&fs.existsSync(path.join(capture.directory,'active-container.json')),'Host identity is secured before any failing Docker copy');
          throw Error('synthetic Docker snapshot copy also denied');
        }}),error=>error===failure);
      assert(copyAttempted);assert(capture.failed);assert(!capture.directory.startsWith(cwd+path.sep));
      const originalLog=fs.readFileSync(path.join(directory,'test.log')),originalIdentity=fs.readFileSync(path.join(directory,'active-container.json'));
      assert(originalLog.toString().includes('current media failure diagnostics'));assert(!fs.existsSync(path.join(directory,'image.json')));
      // Execute the destructive Linux snapshot boundary from the caller, with
      // independent stale content. Without restoration this control loses the
      // current identity and can incorrectly make a resume look safe.
      fs.rmSync(path.join(cwd,'test-results'),{recursive:true});fs.mkdirSync(directory,{recursive:true});
      fs.writeFileSync(path.join(directory,'test.log'),'old Linux log');fs.writeFileSync(path.join(directory,'image.json'),'old Linux success');
      assert.throws(()=>assert.deepEqual(fs.readFileSync(path.join(directory,'test.log')),originalLog));
      assert(!fs.existsSync(path.join(directory,'active-container.json')),'The pre-repair snapshot loses the unresolved identity');
      restoreMediaTestDiagnostics(capture,cwd);
      assert.deepEqual(fs.readFileSync(path.join(directory,'test.log')),originalLog);assert.deepEqual(fs.readFileSync(path.join(directory,'active-container.json')),originalIdentity);
      assert(!fs.existsSync(path.join(directory,'image.json')),'The failed host attempt cannot inherit a stale Linux success');
      await assert.rejects(runMediaImageChild({cwd,env:{},stdio:'ignore',sha,run,attempt,args:['-e','process.exit(0)']}),/requires reconciliation/,'A resumed caller cannot silently ignore the retained unresolved container');
      console.log('Media cleanup rejection: exact host log/identity survive copy failure and destructive snapshot; stale success and silent restart rejected.');
    }
    const directory=path.join(root,'negative'),owner={version:1,nonce:randomUUID(),sha,run,attempt},pid=12345;fs.mkdirSync(directory);
    const identity={owner,pid,name:`bitbi-media-test-${pid}-${randomUUID()}-canvas-core`,image,group:'canvas-core'};
    const scope={directory,owner,pid};
    for(const change of [entry=>{entry.owner.run='foreign-run';},entry=>{entry.owner.nonce=randomUUID();},entry=>{entry.pid++;},entry=>{entry.name='unrelated-container';},entry=>{entry.image='mutable:tag';}]) {
      const foreign=structuredClone(identity);change(foreign);fs.writeFileSync(path.join(directory,'active-container.json'),JSON.stringify(foreign));let called=0;
      assert.throws(()=>cleanupMediaTestContainer(scope,()=>{called++;}));assert.equal(called,0,'Malformed or foreign persisted authority cannot reach Docker');
    }
    fs.writeFileSync(path.join(directory,'active-container.json'),'{');assert.throws(()=>cleanupMediaTestContainer(scope,()=>assert.fail('Malformed JSON reached Docker')));
    fs.rmSync(path.join(directory,'active-container.json'));
    fs.symlinkSync('/dev/null',path.join(directory,'active-container.json'));assert.throws(()=>cleanupMediaTestContainer(scope,()=>assert.fail('Unsafe file reached Docker')),/Unsafe/);fs.unlinkSync(path.join(directory,'active-container.json'));
    for(const change of [actual=>{actual.Name='/other';},actual=>{actual.Config.Image='sha256:'+'c'.repeat(64);},actual=>{actual.Config.Labels['ai.bitbi.media-test.owner']=randomUUID();},actual=>{actual.Config.Labels['ai.bitbi.media-test.run']='foreign-run';}]) {
      persistMediaTestContainer(directory,identity);const actual=actualContainer(identity);change(actual);const calls=[];
      assert.throws(()=>cleanupMediaTestContainer(scope,args=>{calls.push(args);return JSON.stringify([actual]);}));
      assert.deepEqual(calls,[['container','inspect',identity.name]],'A foreign actual container cannot reach removal');fs.unlinkSync(path.join(directory,'active-container.json'));
    }
    persistMediaTestContainer(directory,identity);
    assert.deepEqual(cleanupMediaTestContainer(scope,()=>{throw Object.assign(Error('already removed'),{status:1,stderr:'Error response from daemon: No such container: '+identity.name});}),{active:false,name:identity.name});
    persistMediaTestContainer(directory,identity);
    assert.throws(()=>cleanupMediaTestContainer(scope,()=>{throw Object.assign(Error('denied'),{status:1,stderr:'permission denied'});}),/denied/);
    assert(fs.existsSync(path.join(directory,'active-container.json')),'Unknown Docker observation retains the exact reconciliation identity');
    console.log('Local media parent: real child failure/timeout and actual parent SIGTERM; exact labelled cleanup; foreign/malformed identities and stale success artifacts counterchecked.');
  } finally {fs.rmSync(root,{recursive:true,force:true});}
}
if(process.argv[1]===new URL(import.meta.url).pathname)await testLocalMediaProcess();
