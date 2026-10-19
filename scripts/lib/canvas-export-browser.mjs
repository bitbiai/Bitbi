import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {browserRows} from './browser-fixture-repair.mjs';
import {passedBrowserCase,verifyBrowserUnion} from './local-release-browser.mjs';
import {EXPORT_DELIVERY_BROWSER_PREFLIGHT,EXPORT_DELIVERY_BROWSER_GREP,assertExportDeliverySelectionTree} from './canvas-export-release.mjs';

export const EXPORT_DELIVERY_BROWSER_POLICY='local-canvas-export-bfcache-v1';
const digest=value=>createHash('sha256').update(value).digest('hex');
const retainedRows=previous=>new Map(previous.filter(row=>passedBrowserCase(row)&&row.title.startsWith('Canvas editable film ')).map(row=>[row.key,row]));

export function verifyExportDeliveryBrowserReport(report,sha){
  const p=EXPORT_DELIVERY_BROWSER_PREFLIGHT;
  assert.equal(report.policy,EXPORT_DELIVERY_BROWSER_POLICY);assert.equal(report.sha,sha);assert.equal(report.source,p.source);
  assert.equal(digest(JSON.stringify(report.previous)),p.rows,'Original failed browser results changed');
  assert.equal(digest(JSON.stringify(report.discovery)),p.discovery,'Required browser discovery changed');
  const retained=retainedRows(report.previous);assert.equal(retained.size,4,'Only the four unchanged editable-film passes are reusable');
  const counts=verifyBrowserUnion(report.discovery,retained,report.fresh);
  assert.deepEqual(counts,{required:8,reused:4,executed:4});assert.deepEqual(report.counts,counts);
  return counts;
}

export function runExportDeliveryBrowserContinuation(env=process.env){
  const p=EXPORT_DELIVERY_BROWSER_PREFLIGHT;
  assert.equal(env.GITHUB_JOB,'browser-validation');assert.equal(env.CI,'1');
  assertExportDeliverySelectionTree(env.GITHUB_SHA,args=>execFileSync('git',args,{stdio:['ignore','pipe','pipe']}),p);
  const raw=fs.readFileSync('.local-release/reuse/export-browser-original.json');
  assert.equal(digest(raw),p.report,'Changed original browser report');
  const previous=browserRows(JSON.parse(raw)),retained=retainedRows(previous);
  const base=['run','test:static','--','tests/canvas.spec.js','--project=chromium','--project=webkit-canvas','--grep',EXPORT_DELIVERY_BROWSER_GREP];
  const run=(name,args,discovery=false)=>{
    const file=path.resolve(`test-results/export-browser-${name}.json`);fs.rmSync(file,{force:true});
    const child=spawnSync('npm',[...base,...args,`--reporter=${discovery?'json':'list,json'}`],{
      env:{...env,PLAYWRIGHT_JSON_OUTPUT_NAME:file},stdio:discovery?'pipe':'inherit',maxBuffer:16*1024*1024,
    });
    assert.equal(child.status,0,`Export ${name} failed; preserve the original report and its four passed cases`);
    return JSON.parse(fs.readFileSync(file));
  };
  const rawDiscovery=run('discovery',['--list'],true),discovery=browserRows(rawDiscovery,{discovery:true});
  assert.equal(digest(JSON.stringify(discovery)),p.discovery);assert.equal(retained.size,4);
  fs.writeFileSync('test-results/canvas-discovery.json',JSON.stringify(rawDiscovery));
  const pending=new Set(discovery.filter(row=>!retained.has(row.key)).map(row=>row.key));assert.equal(pending.size,4);
  const list=[];
  const visit=(suite,parents=[])=>{
    for(const spec of suite.specs||[])for(const test of spec.tests||[])if(pending.has(`${test.projectName}:${spec.id}`))
      list.push(`[${test.projectName}] › ${spec.file} › ${[...parents,spec.title].join(' › ')}`);
    for(const child of suite.suites||[])visit(child,[...parents,child.title]);
  };rawDiscovery.suites.forEach(suite=>visit(suite));assert.equal(list.length,4);
  const file='test-results/export-browser-pending.txt';fs.writeFileSync(file,list.join('\n')+'\n');
  const args=['--test-list',file,'--retries=0','--workers=1','--output=test-results/export-browser-artifacts'];
  const selected=browserRows(run('selected',[...args,'--list'],true),{discovery:true});
  assert.deepEqual(selected,discovery.filter(row=>pending.has(row.key)),'Only the unresolved lifecycle cases may execute');
  const fresh=browserRows(run('fresh',args));
  const report={policy:EXPORT_DELIVERY_BROWSER_POLICY,sha:env.GITHUB_SHA,source:p.source,previous,discovery,fresh,
    counts:verifyBrowserUnion(discovery,retained,fresh)};
  verifyExportDeliveryBrowserReport(report,env.GITHUB_SHA);
  fs.writeFileSync('test-results/candidate-auth.json',JSON.stringify(report));
  console.log(JSON.stringify({...report.counts,originalFailuresPreserved:true}));
}
