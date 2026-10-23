// Guard fixtures only. These records never become release acceptance evidence.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {LINEAR_REUSE,LINEAR_REFRESH,assertLinearInputs,assertLinearTree,importLinearSource,copyLinearReports,verifyLinearRuntime,verifyLinearReuse} from './lib/local-release-linear.mjs';
import {sha256} from './lib/local-release-plan.mjs';
import {verifyLocalEvidence,verifyMigrationCandidateBytes} from './lib/local-release-evidence.mjs';

export async function testLinearReuse() {
  const root=process.cwd(),scratch=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-linear-guard-'));
  const git=(args,options={})=>execFileSync('git',args,{encoding:'utf8',stdio:['pipe','pipe','pipe'],...options}).trim();
  const write=(file,bytes)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);};
  try {
    // Private objects/index: the real worktree, refs and accepted source stay untouched.
    const repository=path.join(scratch,'git');git(['init','--bare',repository]);
    const objects=path.resolve(root,git(['rev-parse','--git-path','objects']));
    write(path.join(repository,'objects/info/alternates'),objects+'\n');
    const options={cwd:repository,env:{...process.env,GIT_INDEX_FILE:path.join(scratch,'index'),GIT_AUTHOR_NAME:'Release fixture',GIT_AUTHOR_EMAIL:'fixture@invalid.test',GIT_COMMITTER_NAME:'Release fixture',GIT_COMMITTER_EMAIL:'fixture@invalid.test'}};
    const command=(args,input)=>git(args,{...options,...(input===undefined?{}:{input})});
    const commit=(tree,parents)=>command(['commit-tree',tree,...parents.flatMap(parent=>['-p',parent])],'Verifier fixture\n');
    const check=(head)=>{process.chdir(repository);try{return assertLinearTree(head);}finally{process.chdir(root);}};
    assert.deepEqual(check(LINEAR_REUSE.linear),[]);
    command(['read-tree',LINEAR_REUSE.linear]);
    const blob=command(['hash-object','-w','--stdin'],'// Release-only fixture\n');
    command(['update-index','--add','--cacheinfo','100644',blob,'scripts/lib/local-release-linear.mjs']);
    const allowedTree=command(['write-tree']),allowedHead=commit(allowedTree,[LINEAR_REUSE.linear]);
    assert.deepEqual(check(allowedHead),['scripts/lib/local-release-linear.mjs']);
    assert.throws(()=>check(commit(allowedTree,[allowedHead])),/direct tooling successor/);
    assert.throws(()=>check(commit(allowedTree,[LINEAR_REUSE.linear,LINEAR_REUSE.remote])),/remain linear/);
    assert.throws(()=>check(commit(LINEAR_REUSE.tree,[LINEAR_REUSE.remote])));
    for(const file of ['workers/auth/src/routes/canvas.js','tests/canvas.spec.js','package-lock.json','config/release-compat.json','.github/workflows/static.yml']) {
      command(['read-tree',LINEAR_REUSE.linear]);
      command(['update-index','--add','--cacheinfo','100644',blob,file]);
      assert.throws(()=>check(commit(command(['write-tree']),[LINEAR_REUSE.linear])),/Product, fixture, dependency, workflow or configuration changed/);
    }
    command(['read-tree',LINEAR_REUSE.linear]);
    command(['update-index','--cacheinfo','100755',command(['rev-parse',`${LINEAR_REUSE.linear}:index.html`]),'index.html']);
    assert.throws(()=>check(commit(command(['write-tree']),[LINEAR_REUSE.linear])),/configuration changed/,'File modes are product bytes too');
    const badBundle=path.join(scratch,'wrong-objects');write(path.join(badBundle,'reuse/linear-source.bundle'),'untrusted objects');
    assert.throws(()=>importLinearSource(badBundle),/Changed original Git object bundle/);
    process.chdir(repository);
    try {assert.throws(()=>verifyLinearReuse(scratch,{sha:allowedHead,base:LINEAR_REUSE.base,linearContinuation:{}},[]),/Wrong linear origin provenance/);} finally {process.chdir(root);}

    const original={planHash:'plan',selection:{full:true,workers:true,files:['old'],reasons:['old']},
      environment:{key:'locked-key',image:'locked-image',node:'v22',inputs:{'package-lock.json':'locked'},reused:false,preparationMs:12},
      nativeBrowsers:{key:'native-key',kernel:'locked-kernel',binaries:{webkit:'locked-webkit'},reused:false,preparationMs:20}};
    const reused=structuredClone(original);
    reused.selection.files=['final'];reused.selection.reasons=['final'];
    for(const key of ['environment','nativeBrowsers'])Object.assign(reused[key],{reused:true,preparationMs:1});
    assertLinearInputs(original,reused);
    for(const [parts,value] of [
      [['planHash'],'other'],[['selection','full'],false],[['selection','workers'],false],
      [['environment','image'],'other'],[['environment','key'],'other'],[['environment','node'],'v23'],
      [['environment','inputs','package-lock.json'],'other'],[['nativeBrowsers','key'],'other'],
      [['nativeBrowsers','kernel'],'other'],[['nativeBrowsers','binaries','webkit'],'other'],
    ]) {
      const changed=structuredClone(reused);let target=changed;
      for(const part of parts.slice(0,-1))target=target[part];target[parts.at(-1)]=value;
      assert.throws(()=>assertLinearInputs(original,changed),/Changed/,parts.join('.'));
    }

    const runtime={status:'passed',sourceCommit:LINEAR_REUSE.source,node:'pinned-node',privileges:{NoNewPrivs:'1'}};
    const currentRuntime={...runtime,sourceCommit:allowedHead};
    verifyLinearRuntime(runtime,currentRuntime,allowedHead);
    for(const broken of [{...currentRuntime,sourceCommit:LINEAR_REUSE.source},{...currentRuntime,node:'other'},{...currentRuntime,status:'failed'},{...currentRuntime,privileges:{NoNewPrivs:'0'}}])assert.throws(()=>verifyLinearRuntime(runtime,broken,allowedHead));
    const old=path.join(scratch,'origin'),target=path.join(scratch,'target');
    write(path.join(old,'test-results/candidate-static.json'),'original browser receipt');
    write(path.join(old,'test-results/nested/receipt.json'),'original native receipt');
    write(path.join(old,'test-results/frontend-runtime.log'),'old hosting log');
    write(path.join(target,'test-results/frontend-runtime.log'),'fresh hosting log');
    copyLinearReports(old,target);
    assert.equal(fs.readFileSync(path.join(target,'test-results/candidate-static.json'),'utf8'),'original browser receipt');
    assert.equal(fs.readFileSync(path.join(target,'test-results/nested/receipt.json'),'utf8'),'original native receipt');
    assert.equal(fs.readFileSync(path.join(target,'test-results/frontend-runtime.log'),'utf8'),'fresh hosting log');
    for(const name of ['Preflight complete static release plan','Test local release evidence and orchestration','Record candidate build','Check frontend hosting package','Confirm tested candidate bytes','Confirm tested browser candidate bytes'])assert(LINEAR_REFRESH.has(name),`Missing fresh check: ${name}`);
    for(const name of ['Run worker route tests','Run Linux homepage functional acceptance','Run full static browser regression'])assert(!LINEAR_REFRESH.has(name),`Unchanged product suite repeated: ${name}`);

    // The permitted difference is candidate identity, never a script/fixture fix.
    const before=`<script src="app.js?v=${LINEAR_REUSE.source.slice(0,12)}"></script>`,after=before.replace(LINEAR_REUSE.source.slice(0,12),LINEAR_REUSE.linear.slice(0,12));
    const candidate=path.join(scratch,'candidate-proof');write(path.join(candidate,'candidate/site/index.html'),after);
    const prior={sha:LINEAR_REUSE.source,files:{'index.html':sha256(before)}},next={sha:LINEAR_REUSE.linear,files:{'index.html':sha256(after)}};
    verifyMigrationCandidateBytes(candidate,prior,next,{allowLabGuard:false});
    assert.throws(()=>verifyMigrationCandidateBytes(candidate,prior,{...next,files:{...next.files,'other.js':'0'.repeat(64)}},{allowLabGuard:false}),/membership changed/);
    write(path.join(candidate,'candidate/site/index.html'),after+'<script>changed()</script>');
    assert.throws(()=>verifyMigrationCandidateBytes(candidate,prior,{...next,files:{'index.html':sha256(after+'<script>changed()</script>')}},{allowLabGuard:false}),/Unreviewed product\/build change/);

    // The canonical continuation carries real immutable acceptance. Public clones
    // have no private cache dependency; final protected import still requires it.
    const supplied=path.join(root,'.local-release/reuse/linear-origin');
    if(fs.existsSync(supplied)) {
      const accepted=verifyLocalEvidence(supplied,{sha:LINEAR_REUSE.source,base:LINEAR_REUSE.base});
      assert.equal(accepted.evidence.commands.length,54);
      assert.equal(sha256(fs.readFileSync(path.join(supplied,'evidence.json'))),LINEAR_REUSE.evidence);
      const rejected=path.join(scratch,'rejected');
      const evidence={...accepted.evidence,status:'failed'};write(path.join(rejected,'evidence.json'),JSON.stringify(evidence));
      assert.throws(()=>verifyLocalEvidence(rejected,{sha:LINEAR_REUSE.source,base:LINEAR_REUSE.base}),/incomplete or failed/);
    }
    console.log('Linear publication guards passed: real Git lineage/bytes, report separation, candidate identity, and fail-closed provenance.');
  } finally {process.chdir(root);fs.rmSync(scratch,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await testLinearReuse();
