// Closed migration continuation. Preserve genuine results and their failed
// original reports; execute only required cases without a valid prior result.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';
import {sha256} from './local-release-plan.mjs';
import {browserRows,verifyBrowserRepairCoverage} from './browser-fixture-repair.mjs';

export const LOCAL_BROWSER_POLICY='local-browser-continuation-v1';
export const BROWSER_ORIGINS=Object.freeze({
  previous:'97e0ec95eb10e2f827f3d013b202c5852819db90',
  progress:'a4d3f433b96b7c0e9f51cc909b9e78ad7b3be694',
  corrected:'004ff2eca022dae6a8c48c6c29e8d8114236c79e',
  production:'903f46807424efa062460d8c95efbf2f104d66e8',productionRun:'37195464481',
  coreProgress:'8c471701860db3a07b08224f676589b10a1103cc',
  coreCorrected:'136def1dcd6b8b6475632132d33c2b80ec52fec6',
  final:'115eecc584c459808019b708623f341b5ee4f37c',
});
const rawHashes={
  previous:'cbee4ba34cc3c3bfbc71428351050a6f01416a836967fcbf8cf0788a3045e01e',
  progress:'c92b7c84a55b792de0918b4e1e9fc85318c43ad0a27c262d8b94da23966f9c8f',
  corrected:'728aa52b0144bdbd198e1e15a712f8bfde08cf4513e881bc14e67cb12a9f26f7',
  production:'094e6513e4efa457fa6424a250f77bc914cdc3a3790590e73dc31b3396e10ed2',
  coreProgress:'1769babff07d3b1731ef014a02b5593ac041dfc25ae38736d3bc5518988847a1',
  coreCorrected:'0b340b593b033065415ffb32bd2786416031c25d4013fdc667612890f973adc8',
  coreFinal:'44e79807276bb4506a2130e8a3efe71e5a2af918fc612c106d0225852590d86f',
  authFinal:'31ceaf8102c23ba456446b9256aa0e85e9f6d0c5c9fa6e863dfa42d9ac3bc21a',
};
const rowHashes={
  previous:'617fd1c410187d1e2a1549da366b8ce3cfbfcb95206ea647f536eca1f27d05ab',
  progress:'bc53792d564dcc02dc3b064ae6c6b834837e357ae5949f09a478d7fcb05cc132',
  corrected:'3f0cfc3107dcbea944eb0f3081ebaa1258f8e98c5c4d70ed4c6f3745bbb9a578',
  production:'6e230eba3d38c0f4b692a57e15ce87b58d1d359a1c8600fd196b91da8172164b',
  coreProgress:'2b89315fc47f0313178e28fa78dd0265263e15abaeb2197f64a1bfc51f4d19cc',
  coreCorrected:'d61a8238de71bb34b4fdd836724a07986a4d18ba07913f6509254e218060f89e',
  coreFinal:'47d1d2e7d4e7d7e7a0b89e3e449ccae0afad3924a5f1eec6f1da4720cd6e2e8d',
  authFinal:'6dcdfdbc83e54e093faf83eba1da8649797fe387526cdfdf6288a961b20e81e2',
};
const discoveryHashes={auth:'7f7b08cedcd4e7883649e1210b89e8179b867ce7e9611481df2b8a22c0c6b903',homepage:'d42e2742b87f5099c47f0930ef310c3333060cd26fe4711194607e854004cfd3'};
export const passedBrowserCase=row=>row.expectedStatus==='passed'&&row.status==='expected'&&row.results?.length===1&&row.results[0].status==='passed'&&row.results[0].retry===0&&!row.results[0].error;
const identity=({key,file,title,project})=>({key,file,title,project});
const sorted=rows=>[...rows].sort((a,b)=>a.key.localeCompare(b.key,'en'));
export function readMigrationBrowserPool(directory) {
  const pool={};
  for(const [name,hash]of Object.entries(rawHashes)) {
    const bytes=fs.readFileSync(path.join(directory,'reuse',`browser-${name}.json`));
    assert.equal(sha256(bytes),hash,`Changed/missing original browser evidence: ${name}`);
    const report=JSON.parse(bytes);
    if(name==='production') {
      const repair=report.browserRepair;assert.equal(repair.publicationSha,BROWSER_ORIGINS.production);
      assert.equal(repair.run,BROWSER_ORIGINS.productionRun);assert.equal(repair.attempt,'1');
      const coverage=verifyBrowserRepairCoverage(repair.evidence,repair.source.sha);
      assert.deepEqual(coverage,repair.coverage);assert.equal(report.tests,224);
      pool[name]=sorted([...repair.evidence.previous.filter(passedBrowserCase),...repair.evidence.progress.rows.filter(passedBrowserCase),...repair.evidence.scoped]);
    } else pool[name]=browserRows(report);
  }
  migrationBrowserPool(pool);return pool;
}
export function migrationBrowserPool(pool) {
  assert.deepEqual(Object.keys(pool).sort(),Object.keys(rowHashes).sort());
  for(const [key,hash]of Object.entries(rowHashes))assert.equal(sha256(JSON.stringify(pool[key])),hash,`Changed browser case provenance: ${key}`);
  const rows=[...pool.previous.filter(passedBrowserCase),...pool.progress.filter(passedBrowserCase),...pool.corrected.filter(passedBrowserCase)];
  assert.equal(rows.length,707);assert.equal(new Set(rows.map(row=>row.key)).size,707);
  for(const row of [...pool.progress,...pool.corrected])assert.deepEqual(identity(row),identity(pool.previous.find(old=>old.key===row.key)));
  const retained=new Map(rows.map(row=>[row.key,row]));
  assert.equal(pool.coreProgress.length,245);
  assert.equal(pool.coreProgress.filter(passedBrowserCase).length,225);
  assert.equal(pool.coreCorrected.length,20);
  assert.equal(pool.coreCorrected.filter(passedBrowserCase).length,19);
  assert.equal(pool.coreFinal.length,1);assert.equal(pool.authFinal.length,2);
  for(const row of pool.coreCorrected)assert.deepEqual(identity(row),identity(pool.coreProgress.find(old=>old.key===row.key)));
  for(const row of pool.coreFinal)assert.deepEqual(identity(row),identity(pool.coreCorrected.find(old=>old.key===row.key)));
  for(const row of pool.authFinal)assert.deepEqual(identity(row),identity(pool.previous.find(old=>old.key===row.key)));
  for(const row of [...pool.production,...pool.coreProgress.filter(passedBrowserCase),...pool.coreCorrected.filter(passedBrowserCase),...pool.coreFinal,...pool.authFinal]) {
    assert(passedBrowserCase(row));
    if(retained.has(row.key))assert.deepEqual(identity(row),identity(retained.get(row.key)));
    else retained.set(row.key,row);
  }
  return retained;
}
// Separately testable union, including missing, failed, skipped and retry-only
// controls. It never changes the status of an original failed report.
export function verifyBrowserUnion(discovery,retained,fresh) {
  assert(discovery.length>0);assert.equal(new Set(discovery.map(row=>row.key)).size,discovery.length);
  assert.equal(new Set(fresh.map(row=>row.key)).size,fresh.length);
  const needed=discovery.filter(row=>!retained.has(row.key));
  assert.deepEqual(sorted(fresh).map(identity),sorted(needed).map(identity),'Fresh execution must cover exactly the unresolved required cases');
  for(const row of fresh)assert(passedBrowserCase(row),'Fresh browser case failed/skipped/retried');
  for(const row of discovery)if(retained.has(row.key)) {
    assert.deepEqual(identity(retained.get(row.key)),identity(row));assert(passedBrowserCase(retained.get(row.key)));
  }
  return {required:discovery.length,reused:discovery.length-needed.length,executed:fresh.length};
}
export function verifyMigrationBrowserReport(report,sha) {
  assert.equal(report.policy,LOCAL_BROWSER_POLICY);assert.equal(report.sha,sha);
  assert.deepEqual(report.origins,BROWSER_ORIGINS);assert(['auth','homepage'].includes(report.scope));
  assert.equal(sha256(JSON.stringify(report.discovery)),discoveryHashes[report.scope],'Incomplete/changed required browser discovery');
  const counts=verifyBrowserUnion(report.discovery,migrationBrowserPool(report.pool),report.fresh);
  assert.deepEqual(counts,report.counts);return counts;
}
export function runMigrationBrowserContinuation(scope,env=process.env) {
  assert(['auth','homepage'].includes(scope));assert.equal(env.GITHUB_JOB,'browser-validation');assert.equal(env.CI,'1');
  const pool=readMigrationBrowserPool('.local-release'),retained=migrationBrowserPool(pool);
  const script=scope==='auth'?'test:auth':'test:homepage-core';
  const run=(name,args,discovery=false)=>{
    const file=path.resolve(`test-results/local-${scope}-${name}.json`);fs.rmSync(file,{force:true});
    const child=spawnSync('npm',['run',script,'--',...args,`--reporter=${discovery?'json':'list,json'}`],{env:{...env,PLAYWRIGHT_JSON_OUTPUT_NAME:file},stdio:discovery?'pipe':'inherit',maxBuffer:16*1024*1024});
    assert.equal(child.status,0,`Local browser ${scope}/${name} failed; preserve its report and do not repeat its passing cases`);
    return JSON.parse(fs.readFileSync(file));
  };
  const discoveryReport=run('discovery',['--list'],true),discovery=browserRows(discoveryReport,{discovery:true});
  assert.equal(sha256(JSON.stringify(discovery)),discoveryHashes[scope]);
  const pending=new Set(discovery.filter(row=>!retained.has(row.key)).map(row=>row.key)),list=[];
  const visit=(suite,parents=[])=>{
    for(const spec of suite.specs||[])for(const test of spec.tests||[])if(pending.has(`${test.projectName}:${spec.id}`))list.push(`[${test.projectName}] › ${spec.file} › ${[...parents,spec.title].join(' › ')}`);
    for(const child of suite.suites||[])visit(child,[...parents,child.title]);
  };discoveryReport.suites.forEach(suite=>visit(suite));assert.equal(list.length,pending.size);
  const listFile=`test-results/local-${scope}-pending.txt`;fs.writeFileSync(listFile,list.join('\n')+'\n');
  const args=['--test-list',listFile,'--retries=0',`--output=test-results/local-${scope}-artifacts`];
  const selected=pending.size?browserRows(run('selected-discovery',[...args,'--list'],true),{discovery:true}):[];
  assert.deepEqual(selected,discovery.filter(row=>pending.has(row.key)),'CLI selection changed required unresolved cases');
  const fresh=pending.size?browserRows(run('fresh',args)):[];
  const report={policy:LOCAL_BROWSER_POLICY,sha:env.GITHUB_SHA,scope,origins:BROWSER_ORIGINS,pool,discovery,fresh,
    counts:verifyBrowserUnion(discovery,retained,fresh)};
  verifyMigrationBrowserReport(report,env.GITHUB_SHA);
  fs.writeFileSync(`test-results/candidate-${scope}.json`,JSON.stringify(report));
  console.log(JSON.stringify({scope,...report.counts,originalFailuresPreserved:true}));
}

// Closed, source-bound continuation: new OFF field and a separate checkbox
// changed four old fixture assumptions, not product or decoder behavior.
export const SMOOTH_BROWSER_POLICY='local-canvas-smooth-continuation-v1';
export const SMOOTH_BROWSER_CONTINUATION=Object.freeze({
  source:'a286659009951d8c862a4921ad049b65c9cc4b35',
  run:'a286659009951d8c862a4921ad049b65c9cc4b35-d0412998-3e94-425c-a142-041dffe70d19',
  checkpoint:'6a13e066b667c7eb5479426d6470cf707153524b5e28f2ba1f0e342ed1a9b6f2',report:'2638a5c7f026e567fc769259b98b0870540d8f5c2f306a71c17752eb618244f2',rows:'51208eddcaf2efd3d4a9637a0787a497e98a990babd0b68f0f51f9b64e41c50c',discovery:'a963815b36f428532fbeed6d60328ea7157eef1b164019e4e756908438f5dc89',image:'6fadf1fb2110ca06ef256ba4f3992915f43bf7f51c5a5cd33dcff7bbdfa3c02e',
  specs:{'tests/canvas.spec.js':'b473f43fc2d88cf3da5bd9fb3c8da97c2cdde61ad4b8366bd2c86bb6cb624681','tests/helpers/canvas-music-preview.cjs':'af192385d85f174cb2256158023f5799099c3079475dd5c431c643c10c4a270f'},
});
const smoothTooling=new Set(['scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs','scripts/lib/local-release-browser.mjs',
  'scripts/lib/local-release-transport.mjs','scripts/pages-candidate.mjs','scripts/test-local-release.mjs',
  'scripts/lib/media-publication.mjs','scripts/lib/backend-publication.mjs',
  'docs/production-readiness/MAIN_ONLY_RELEASE_RUNBOOK.md','docs/runbooks/REGRESSION_REGISTER.md']);
export function assertSmoothContinuationTree(head,read=args=>execFileSync('git',args,{stdio:['ignore','pipe','pipe']})) {
  const p=SMOOTH_BROWSER_CONTINUATION;read(['merge-base','--is-ancestor',p.source,head]);
  const changed=read(['diff','--name-only',p.source,head]).toString().trim().split('\n').filter(Boolean);
  assert(changed.every(file=>smoothTooling.has(file)||Object.hasOwn(p.specs,file)),'Changed product/workflow/environment cannot inherit smooth-join evidence');
  for(const [file,hash]of Object.entries(p.specs))assert.equal(sha256(read(['show',`${head}:${file}`])),hash,'Unreviewed browser fixture correction');
}
export function verifySmoothBrowserReport(report,sha) {
  const p=SMOOTH_BROWSER_CONTINUATION;assert.equal(report.policy,SMOOTH_BROWSER_POLICY);assert.equal(report.sha,sha);
  assert.equal(report.source,p.source);assert.equal(sha256(JSON.stringify(report.previous)),p.rows,'Original failed browser results changed');
  assert.equal(sha256(JSON.stringify(report.discovery)),p.discovery,'Required browser discovery changed');
  const retained=new Map(report.previous.filter(passedBrowserCase).map(row=>[row.key,row]));
  const counts=verifyBrowserUnion(report.discovery,retained,report.fresh);assert.deepEqual(report.counts,counts);return counts;
}
export function runSmoothBrowserContinuation(env=process.env) {
  const p=SMOOTH_BROWSER_CONTINUATION;assert.equal(env.GITHUB_JOB,'browser-validation');assert.equal(env.CI,'1');assertSmoothContinuationTree(env.GITHUB_SHA);
  const raw=fs.readFileSync('.local-release/reuse/smooth-browser.json');assert.equal(sha256(raw),p.report);
  const previous=browserRows(JSON.parse(raw)),retained=new Map(previous.filter(passedBrowserCase).map(row=>[row.key,row]));
  const base=['test:static','--','tests/canvas.spec.js','tests/oma2-q1-canvas.spec.js','--project=chromium','--project=webkit-canvas','--grep','Canvas|P13|@canvas-model-ui'];
  const run=(name,args,discovery=false)=>{
    const file=path.resolve(`test-results/smooth-${name}.json`);fs.rmSync(file,{force:true});
    const child=spawnSync('npm',['run',...base,...args,`--reporter=${discovery?'json':'list,json'}`],{env:{...env,PLAYWRIGHT_JSON_OUTPUT_NAME:file},stdio:discovery?'pipe':'inherit',maxBuffer:16*1024*1024});
    assert.equal(child.status,0,`Canvas ${name} failed; preserve original reports and passing cases`);return JSON.parse(fs.readFileSync(file));
  };
  const rawDiscovery=run('discovery',['--list'],true),discovery=browserRows(rawDiscovery,{discovery:true});
  assert.equal(sha256(JSON.stringify(discovery)),p.discovery);fs.writeFileSync('test-results/canvas-discovery.json',JSON.stringify(rawDiscovery));
  const pending=new Set(discovery.filter(row=>!retained.has(row.key)).map(row=>row.key)),list=[];
  const visit=(suite,parents=[])=>{
    for(const spec of suite.specs||[])for(const test of spec.tests||[])if(pending.has(`${test.projectName}:${spec.id}`))list.push(`[${test.projectName}] › ${spec.file} › ${[...parents,spec.title].join(' › ')}`);
    for(const child of suite.suites||[])visit(child,[...parents,child.title]);
  };rawDiscovery.suites.forEach(suite=>visit(suite));assert.equal(list.length,pending.size);
  const file='test-results/smooth-pending.txt';fs.writeFileSync(file,list.join('\n')+'\n');
  const args=['--test-list',file,'--retries=0','--output=test-results/smooth-repair-artifacts'];
  const selected=browserRows(run('selected-discovery',[...args,'--list'],true),{discovery:true});
  assert.deepEqual(selected,discovery.filter(row=>pending.has(row.key)));
  const fresh=browserRows(run('fresh',args));
  const report={policy:SMOOTH_BROWSER_POLICY,sha:env.GITHUB_SHA,source:p.source,previous,discovery,fresh,counts:verifyBrowserUnion(discovery,retained,fresh)};
  verifySmoothBrowserReport(report,env.GITHUB_SHA);fs.writeFileSync('test-results/candidate-auth.json',JSON.stringify(report));
  console.log(JSON.stringify({...report.counts,originalFailuresPreserved:true}));
}
export function verifySmoothImageReuse(record,sha,{read}={}) {
  const p=SMOOTH_BROWSER_CONTINUATION;assertSmoothContinuationTree(sha,read);
  assert.equal(record.sha,p.source);assert.equal(record.run,p.run);assert.equal(record.attempt,'1');
  assert.equal(sha256(JSON.stringify(record)),p.image,'Retained image/test identity changed');return record.sha;
}
export function verifyImportedSmoothImage(record,{sha,run,attempt},options) {
  assert.equal(record.run,String(run));assert.equal(record.attempt,String(attempt));
  const {localValidation,...original}=record;assert.equal(localValidation?.policy,'development-mac-v1');
  assert.equal(localValidation.publicationSha,sha);assert.match(localValidation.evidence,/^[a-f0-9]{64}$/);
  original.run=localValidation.run;original.attempt=localValidation.attempt;
  assert.equal(sha256(JSON.stringify(original)),localValidation.recordHash);
  return verifySmoothImageReuse(original,sha,options);
}
export function smoothReceiptImageSource(media,sha) {
  if(!media.imageSourceSha||media.imageSourceSha===sha)return sha;
  assert.equal(media.imageSourceSha,SMOOTH_BROWSER_CONTINUATION.source);assertSmoothContinuationTree(sha);return media.imageSourceSha;
}
