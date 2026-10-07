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
  completed:'3ee89ea4b885cc3856ae50357b37de3a07c57577',completedCheckpoint:'be73fc580c057a2e6626a57db683a3508b3347a92fe86c287e76fe3942366edc',
  accepted:'8fa6359ea254ddd32adc86768e7585388131ff84',acceptedCheckpoint:'c0c61042c6fa100b5a820f979d9837d4347971ff305625604ae62c2c3e8c4666',acceptedReport:'19be3e7b4f9ff1dc91778ec25f5ce215eb2c4ca9f70569cf249a7aafd59b64e5',
  progress:'0d161a2812837db56e1b0da972ca3a4b0f6a5f96',progressCheckpoint:'70e6681c57c6ebbdaa78a2cff59cc79b6360ee64a2e41819111747bc32d7ca52',
  run:'a286659009951d8c862a4921ad049b65c9cc4b35-d0412998-3e94-425c-a142-041dffe70d19',
  checkpoint:'6a13e066b667c7eb5479426d6470cf707153524b5e28f2ba1f0e342ed1a9b6f2',report:'2638a5c7f026e567fc769259b98b0870540d8f5c2f306a71c17752eb618244f2',rows:'51208eddcaf2efd3d4a9637a0787a497e98a990babd0b68f0f51f9b64e41c50c',discovery:'a963815b36f428532fbeed6d60328ea7157eef1b164019e4e756908438f5dc89',image:'6fadf1fb2110ca06ef256ba4f3992915f43bf7f51c5a5cd33dcff7bbdfa3c02e',
  specs:{'tests/canvas.spec.js':'b473f43fc2d88cf3da5bd9fb3c8da97c2cdde61ad4b8366bd2c86bb6cb624681','tests/helpers/canvas-music-preview.cjs':'af192385d85f174cb2256158023f5799099c3079475dd5c431c643c10c4a270f'},
});
// A second closed fixture repair uses the same report/union/image mechanism.
// No product, runtime, policy or discovery change may inherit these passes.
export const AUDIO_FIT_CONTINUATION=Object.freeze({
  "source": "d54db31724403c61464f6d4a7f451d2aaaeab3e8",
  "run": "d54db31724403c61464f6d4a7f451d2aaaeab3e8-06031e98-820d-45f7-bf77-498f2136e253",
  "checkpoint": "702de03a6bb3c57f3865ccdd327812c9176972c843c05cf0a2535d00cbfe0b71",
  "report": "6d927dd1588f3b6084104c7ece2e2c6b2e1c9b3b563a21a79034918923d9365b",
  "rows": "264b4f39537cd32ed25be416ce7687e06abc137b5128c44dd63844e336334306",
  "discovery": "52fa9da5cec7e31be9795d18e98448de748eeecc1f009ac54b6eb348649d223f",
  "image": "01a44478774f378580865fa39814c672e4901b58ddcd20239bf17dad3fbf7e0e",
  "manifest": "1fe61fa747fab3e0c907208b2fa010bc383c65bac215a7a83f2ebe30f1cdc9e0",
  "proof": "930998afc3e7e012b0516cbef0b41f36fd687aa5b14d4404027377014b217552",
  "specs": {
    "tests/helpers/canvas-smooth-ui.cjs": "171686ddb6f4113df8e8c332509039afc8f2a708c70c4561b0eeacfeffcde544"
  }
});
// Same closed continuation for the Inspector fixture HTTP/focus correction.
export const INSPECTOR_CONTINUATION=Object.freeze({
  "source": "e9642235763d10bece8aa967abdd570eabab4e0d",
  "run": "e9642235763d10bece8aa967abdd570eabab4e0d-7ed2e01b-d9ec-40c0-a0c7-89383d248a8e",
  "checkpoint": "710195012babdfaaaa06f229579dc2551e8e2ea2240e6f1ea2b4fa9d29376f9b",
  "report": "9b50432147bc18a7381e325e00e69d29e678914f78cb971d628c5f7a670a37b7",
  "rows": "877fdd450ae4684ff3b08b7f8e018827fd457a04d0e7a235d02370bd344d9448",
  "discovery": "8d40b239cde1becbb0a98b90dec9123e5a03bb4354bb58844bd49434004a3938",
  "manifest": "7b95854c08e5c977dabd0279bc32a915fdb46374ce0595e7dd9b7b8339d7e652",
  "proof": "cb5f6448e46fb11a4bfb76162a5e3794906d24b12c46545a499a66ab031c8f5b",
  "last": 41,
  "counts": {
    "required": 20,
    "reused": 20,
    "executed": 0
  },
  "browserProgress": {
  "sha": "f5507cd34f2cfd2b328bb07a8cec94e67af35cd8",
  "run": "f5507cd34f2cfd2b328bb07a8cec94e67af35cd8-3087e41a-3f75-4ad0-ae43-b0397a4af1d1",
  "report": "a5b50be1482c823514effb1804b3db11588b25118aa6700d182dbd43aa9bbd25",
  "rows": "898fe678e97e31cec3565eeee91a6b56ccff5935638e0e3b71c36570998fbb12"
},
  "browserAccepted": {
  "sha": "23576af264ad29274c28ec6989c83f5455a0e48c",
  "run": "23576af264ad29274c28ec6989c83f5455a0e48c-f203e568-67e1-42c4-a024-3714c9942b65",
  "report": "abbbecdd4ec25e068a10b81dc4b5c039743d2e15191e565f7625346ba46820c3",
  "rows": "1943f8cf10661069277f2d1006c4893983625e39ce3d82e1887e2b1342ca4944"
},
  "specs": {
    "tests/canvas.spec.js": "d836213db8d1fe56f61a282c74a598e1c314dd1b932c70b94789531e3538ac3a",
    "tests/helpers/canvas-inspector-ui.cjs": "21c2df5c038c8bd4fb300ad4a61e708aeca5319eec6268689c2c7d536d518917"
  }
});
// Only workspace controls/fixtures changed: completed media, API and transition
// cases retain their original source; the four workspace cases execute fresh.
export const WORKSPACE_CONTINUATION=Object.freeze({
  "source": "3d8b108d020158033c66cfca972134b479eb2641",
  "run": "3d8b108d020158033c66cfca972134b479eb2641-c3a18548-5d7a-464a-b5eb-11d3158163e2",
  "checkpoint": "ec8c697dcc0328bc024a5c7b1b56e1174fa7a9112bf482a0709a3e49997b1907",
  "report": "74606826cc84296245a859e27a57792b6fcc0aa572a0fe66acecbefaa5584c80",
  "rows": "10c4005887a137ddc60fe74034c1c697cf6605bffb3d71759970d22cdb00c5f3",
  "discovery": "6b651f5dc53b1116df09ede911aee97c40e3ceaf45b074be626a1088aa093b97",
  "image": "e45ba8867a83a40720763514088731d5d2ad771889136c2358d165c899110132",
  "manifest": "ab7ba98853c6f62764586b3cde00d4a44784c0dba9786458fa3f95bffc437c40",
  "proof": "6e594b0404650af5b05a3529b901e37ad4a6ad5d18c37641ae170d56a98fdef5",
  "last": 45,
  "counts": {
    "required": 8,
    "reused": 8,
    "executed": 0
  },
  "specs": {
    "tests/helpers/canvas-workspace-transitions-ui.cjs": "449c366554ee9a42d1b9232c1e1fcc61d666dacd617e881ca78d604f17f7f7de",
    "js/pages/canvas/workspace-view.js": "a7a6fc093a8d61ed1f9ce2a2ef03cae43d5a288f66dbb54d6fd32b38e05572fd",
    "scripts/setup-media-tools.sh": "347998ad9e8c577db11b92387656e2ab3cc811c5a96ea4f87641c45f49affed8",
    "scripts/test-pages-workflow.mjs": "08b28465fc0976521cab77ea30dbd85da6dd3c586babc19c04b82a9b203fd4fc",
    "scripts/lib/ci-test-selection.mjs": "9a9b73a16092de0e5e2a647494ec7584099965930fbef005a7fa6a699acda09d"
  },
  "reviewedSource": "1d90f8c910fbf4ef45404a76a8fd567df0917f24",
  "browserProgress": {
    "sha": "38538d77a6b4c7de43b6d6ed317b9036d6fc1225",
    "run": "38538d77a6b4c7de43b6d6ed317b9036d6fc1225-7705f9d9-845e-448d-85c8-455d7247fdb1",
    "report": "d3e65ca94ba49321fd2afcc68b961d9ab77ed2b9cd162f94eac7d9e6fd179ff4",
    "rows": "6443c19e4340d0b5974fe0607dd173d51fbe49ad0afdc569affa31003effbd7f"
  },
  "browserAccepted": {
    "sha": "47528c1bded04ca1422f4b3084ba851541265ff5",
    "run": "47528c1bded04ca1422f4b3084ba851541265ff5-339be6c0-96b4-4b84-9d3d-9bb0572b9818",
    "report": "8e6e0e3e36c2707333747d0e43281d341d018342db67a6afb32dc76abd756c2b",
    "rows": "e2c02612ed315e2919e03df14d3cf2ada887f8b14a238ea67e895f60584b886a"
  }
});
export const smoothProfile=source=>source===WORKSPACE_CONTINUATION.source?WORKSPACE_CONTINUATION:source===INSPECTOR_CONTINUATION.source?INSPECTOR_CONTINUATION:source===AUDIO_FIT_CONTINUATION.source?AUDIO_FIT_CONTINUATION:SMOOTH_BROWSER_CONTINUATION;
export const isSmoothContinuation=sha=>[WORKSPACE_CONTINUATION.source,INSPECTOR_CONTINUATION.source,AUDIO_FIT_CONTINUATION.source,SMOOTH_BROWSER_CONTINUATION.source,SMOOTH_BROWSER_CONTINUATION.progress,SMOOTH_BROWSER_CONTINUATION.accepted,SMOOTH_BROWSER_CONTINUATION.completed].includes(sha);
const smoothTooling=new Set(['scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs','scripts/lib/local-release-browser.mjs',
  'scripts/lib/local-release-transport.mjs','scripts/pages-candidate.mjs','scripts/test-local-release.mjs',
  'scripts/lib/media-publication.mjs','scripts/lib/backend-publication.mjs','scripts/test-media-activation-reuse.mjs',
  'docs/production-readiness/MAIN_ONLY_RELEASE_RUNBOOK.md','docs/runbooks/REGRESSION_REGISTER.md']);
export function assertSmoothContinuationTree(head,read=args=>execFileSync('git',args,{stdio:['ignore','pipe','pipe']}),{source=SMOOTH_BROWSER_CONTINUATION.source}={}) {
  const p=smoothProfile(source);read(['merge-base','--is-ancestor',p.source,head]);
  const changed=read(['diff','--name-only',p.source,head]).toString().trim().split('\n').filter(Boolean);
  assert(changed.every(file=>smoothTooling.has(file)||Object.hasOwn(p.specs,file)),'Changed product/workflow/environment cannot inherit smooth-join evidence');
  for(const [file,hash]of Object.entries(p.specs))assert.equal(sha256(read(['show',`${head}:${file}`])),hash,'Unreviewed browser fixture correction');
}
export function verifySmoothBrowserReport(report,sha) {
  const p=smoothProfile(report.source);assert.equal(report.policy,SMOOTH_BROWSER_POLICY);assert.equal(report.sha,sha);
  if(report.reusedFrom){const {reusedFrom,...original}=report;original.sha=p.accepted;assert.deepEqual(reusedFrom,{sha:p.accepted,reportHash:p.acceptedReport});assert.equal(sha256(JSON.stringify(original)),p.acceptedReport);}
  assert.equal(report.source,p.source);assert.equal(sha256(JSON.stringify(report.previous)),p.rows,'Original failed browser results changed');
  assert.equal(sha256(JSON.stringify(report.discovery)),p.discovery,'Required browser discovery changed');
  const retained=smoothRetained(report.previous,report.progress,p,report.accepted);
  const counts=verifyBrowserUnion(report.discovery,retained,report.fresh);assert.deepEqual(report.counts,counts);return counts;
}
export function smoothRetained(previous,progress,p,accepted) {
  const retained=new Map(previous.filter(passedBrowserCase).map(row=>[row.key,row]));
  for(const [expected,actual] of [[p.browserProgress,progress],[p.browserAccepted,accepted]]) {
    if(!expected){assert.equal(actual,undefined,'Unexpected browser progress');continue;}
    assert.equal(actual?.sha,expected.sha,'Missing progress source');
    assert.equal(sha256(JSON.stringify(actual.rows)),expected.rows,'Progress execution changed');
    assert.deepEqual(sorted(actual.rows).map(identity),sorted(previous.filter(row=>!retained.has(row.key))).map(identity),'Progress must match exactly the previously unresolved cases');
    for(const row of actual.rows.filter(passedBrowserCase))retained.set(row.key,row);
  }
  return retained;
}
export function runSmoothBrowserContinuation(env=process.env) {
  const source=JSON.parse(fs.readFileSync('.local-release/reuse/test-results/permission-checkpoint.json')).sha,p=smoothProfile(source);
  assert.equal(env.GITHUB_JOB,'browser-validation');assert.equal(env.CI,'1');assertSmoothContinuationTree(env.GITHUB_SHA,undefined,{source});
  const raw=fs.readFileSync('.local-release/reuse/smooth-browser.json');assert.equal(sha256(raw),p.report);
  const readProgress=(profile,file)=>{if(!profile)return;const bytes=fs.readFileSync(`.local-release/reuse/${file}`);assert.equal(sha256(bytes),profile.report);return {sha:profile.sha,rows:browserRows(JSON.parse(bytes))};};
  const progress=readProgress(p.browserProgress,'smooth-progress.json'),accepted=readProgress(p.browserAccepted,'smooth-accepted-cases.json');
  const previous=browserRows(JSON.parse(raw)),retained=smoothRetained(previous,progress,p,accepted);
  const base=p===WORKSPACE_CONTINUATION?['test:static','--','tests/canvas.spec.js','--project=chromium','--project=webkit-canvas','--grep','Canvas workspace transitions']:p===INSPECTOR_CONTINUATION?['test:static','--','tests/canvas.spec.js','--project=chromium','--project=webkit-canvas','--grep','Canvas Inspector']:p===AUDIO_FIT_CONTINUATION?['test:static','--','tests/canvas.spec.js','--project=chromium','--project=webkit-canvas','--grep','Canvas audio fit']
    :['test:static','--','tests/canvas.spec.js','tests/oma2-q1-canvas.spec.js','--project=chromium','--project=webkit-canvas','--grep','Canvas|P13|@canvas-model-ui'];
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
  const selected=pending.size?browserRows(run('selected-discovery',[...args,'--list'],true),{discovery:true}):[];
  assert.deepEqual(selected,discovery.filter(row=>pending.has(row.key)));
  const fresh=pending.size?browserRows(run('fresh',args)):[];
  const report={policy:SMOOTH_BROWSER_POLICY,sha:env.GITHUB_SHA,source:p.source,previous,...(progress?{progress}:{}),...(accepted?{accepted}:{}),discovery,fresh,counts:verifyBrowserUnion(discovery,retained,fresh)};
  verifySmoothBrowserReport(report,env.GITHUB_SHA);fs.writeFileSync('test-results/candidate-auth.json',JSON.stringify(report));
  console.log(JSON.stringify({...report.counts,originalFailuresPreserved:true}));
}
export function verifySmoothImageReuse(record,sha,{read}={}) {
  const p=smoothProfile(record.sha);assertSmoothContinuationTree(sha,read,{source:p.source});
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
  const p=smoothProfile(media.imageSourceSha);assert.equal(media.imageSourceSha,p.source);assertSmoothContinuationTree(sha,undefined,{source:p.source});return media.imageSourceSha;
}

export function restoreSmoothBrowserProof(directory,{sha,verifyOnly=false}) {
  const p=SMOOTH_BROWSER_CONTINUATION,bytes=fs.readFileSync(path.join(directory,'reuse/smooth-accepted.json'));
  assert.equal(sha256(bytes),p.acceptedReport);const original=JSON.parse(bytes);verifySmoothBrowserReport(original,p.accepted);
  const report={...original,sha,reusedFrom:{sha:p.accepted,reportHash:p.acceptedReport}};verifySmoothBrowserReport(report,sha);
  const file=path.join(directory,'test-results/candidate-auth.json');
  if(verifyOnly)assert.deepEqual(JSON.parse(fs.readFileSync(file)),report);else fs.writeFileSync(file,JSON.stringify(report));
  return report;
}
