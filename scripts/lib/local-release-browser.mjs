// Closed migration continuation. Preserve genuine results and their failed
// original reports; execute only required cases without a valid prior result.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {sha256} from './local-release-plan.mjs';
import {browserRows,verifyBrowserRepairCoverage} from './browser-fixture-repair.mjs';

export const LOCAL_BROWSER_POLICY='local-browser-continuation-v1';
export const BROWSER_ORIGINS=Object.freeze({
  previous:'97e0ec95eb10e2f827f3d013b202c5852819db90',
  progress:'a4d3f433b96b7c0e9f51cc909b9e78ad7b3be694',
  corrected:'004ff2eca022dae6a8c48c6c29e8d8114236c79e',
  production:'903f46807424efa062460d8c95efbf2f104d66e8',productionRun:'37195464481',
});
const rawHashes={
  previous:'cbee4ba34cc3c3bfbc71428351050a6f01416a836967fcbf8cf0788a3045e01e',
  progress:'c92b7c84a55b792de0918b4e1e9fc85318c43ad0a27c262d8b94da23966f9c8f',
  corrected:'728aa52b0144bdbd198e1e15a712f8bfde08cf4513e881bc14e67cb12a9f26f7',
  production:'094e6513e4efa457fa6424a250f77bc914cdc3a3790590e73dc31b3396e10ed2',
};
const rowHashes={
  previous:'617fd1c410187d1e2a1549da366b8ce3cfbfcb95206ea647f536eca1f27d05ab',
  progress:'bc53792d564dcc02dc3b064ae6c6b834837e357ae5949f09a478d7fcb05cc132',
  corrected:'3f0cfc3107dcbea944eb0f3081ebaa1258f8e98c5c4d70ed4c6f3745bbb9a578',
  production:'6e230eba3d38c0f4b692a57e15ce87b58d1d359a1c8600fd196b91da8172164b',
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
  for(const row of pool.production) {
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
  const selected=browserRows(run('selected-discovery',[...args,'--list'],true),{discovery:true});
  assert.deepEqual(selected,discovery.filter(row=>pending.has(row.key)),'CLI selection changed required unresolved cases');
  const fresh=browserRows(run('fresh',args));
  const report={policy:LOCAL_BROWSER_POLICY,sha:env.GITHUB_SHA,scope,origins:BROWSER_ORIGINS,pool,discovery,fresh,
    counts:verifyBrowserUnion(discovery,retained,fresh)};
  verifyMigrationBrowserReport(report,env.GITHUB_SHA);
  fs.writeFileSync(`test-results/candidate-${scope}.json`,JSON.stringify(report));
  console.log(JSON.stringify({scope,...report.counts,originalFailuresPreserved:true}));
}
