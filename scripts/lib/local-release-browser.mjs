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
// One exact fixture correction, pinned to the completed failed local run. Keep
// both the original failures and successful overlapping Locale cases intact.
export const MODEL_BROWSER_POLICY='local-canvas-agent-browser-continuation-v1';
export const MODEL_BROWSER_PREFLIGHT=Object.freeze({
  source:'09accfa2f12ce4f0284ca06f1f8af5782f8704f2',
  run:'09accfa2f12ce4f0284ca06f1f8af5782f8704f2-52cb160a-2e45-4f05-9297-e2719019160e',
  checkpoint:'7e5466dd86287c5099e1befbcb0ae4f8d1305041e0d946579c45799f01cc6fe1',
  failedLog:'15bd9bdba31b12b905ffddc91d84fc04b8d4db71c1f9e275c6c3bc0380846d0b',
  report:'b65bb2e27f5e6dfc81090bd6a16b3665ca8a389ad10e66dce7ea02d470ce06b1',
  rows:'cb97a41ef9daf5ab2f0de4f9e889af9f0263086da35514dd3c3d551399a3ea90',
  discovery:'6c5d083fd145a5663254da73656e1fd51d0fe12a337095ef5c695fd1a6b686da',required:566,
  standardDiscovery:'a5569d74218c4b1adaacf0870d5b5d026596480513a98a1a8c2e9c4c94e24951',
  standardFile:'homepage-discovery-JDxj9q/standard.json',
  authDiscovery:'7f7b08cedcd4e7883649e1210b89e8179b867ce7e9611481df2b8a22c0c6b903',authRequired:709,authReused:25,
  manifest:'7581b14dac052bea8392a7f41827c056ef9afd8b8a28c1a7244f548d65287043',
  proof:'357c842b04bd21034b1698f345ed11c3990989866af5862f4fcf651434403ecf',
  homepageReports:Object.freeze({
    'homepage-functional.json':'7e5fba51da6a056628d532e72e2b23a2e646448fc41b29a754db33be489c58f3',
    'homepage-discovery.json':'c31395cc77f8a55cf63db15ae1deaf3c79685cacb59e029a6d40479a62ff0d0f',
  }),
  specs:Object.freeze({'tests/helpers/canvas-agent-ui.cjs':'8652ec65050fece55e7a9ab2365bc3d1234f021dc0beabfbfa92b2653e91e52f'}),
  retain:[1,4,5,6,7,8,9,10,11,12,13,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,36,40,41,42,43,44,45,46],
});
export const SETTLEMENT_BROWSER_PREFLIGHT=Object.freeze({
  source:'d633fe47fcd9b127aba24b2b0206410e0b9b10d6',
  checkpoint:'a5a4c0fd7ea8c2d8d6bf7400aeb586c8ce3958b2607c8526b6758f1e2564fc2d',
  failedLog:'59d0eef85e03243cf2aff60d4ab54edb5f1a43ead3b908cbc52722cb35e88ab0',
  report:'92d5b41e9f56a7511204fdf5cd9df85c13d6d83e10a153deab40fc38f46a0f37',
  rows:'448851dde130bf6471e2ed5c9273c94b6f82c82d151a90e0e0e3c477d039f54e',
  discovery:'08e2cd5bffd08957d78840020656a41af259833bc7afbd83594a40d71c1cfcb5',required:634,
  standardDiscovery:'a6cdcc296b4ca39be37075c475729acc77ff4abc5153849c9d2c469c8726e29d',standardFile:'homepage-discovery-mLaMKW/standard.json',
  authDiscovery:MODEL_BROWSER_PREFLIGHT.authDiscovery,authRequired:709,authReused:25,
  manifest:'ee332aae38e665b8ea761ffda477aee87a732ff5bf8e845c6b05784aef4858c2',
  proof:'845d1cd6452194d324a0b9a6254f8ae243925e5b76872b0eb5e1b49c8b206d35',
  hostingLog:'b698c4e579b3498a6f1f6f913928bd3b333c296d2c7bc6c26d19a113a203c843',
  nativeProof:Object.freeze({
    'runtime/q2-runtime-evidence/native-Dvjqr1/launcher-result.json':'bb5c9a4337b9698ba69896363cd711a5532d99755acad3bca4b20bcea7f55d50',
    'runtime/q2-runtime-evidence/native-Dvjqr1/reports/isolation-result.json':'c609013b5a939b464aaa1834e97286e6ec5c0f4eb4c069f1af40770a6527b11e',
    'runtime/q2-runtime-evidence/native-Dvjqr1/reports/isolation-final.json':'3722a729b374515d022042aa6df90f8f984b91c3086a0a52d42884219ce98055',
    'runtime/q2-runtime-evidence/native-Dvjqr1/reports/bitbi-q2-runtime-gLE6HW__result.json':'83d76c64fcecb0427d2e1b7699be69f347616adf8693509ad55e3e1efb21c66d',
  }),
  homepageReports:Object.freeze({'homepage-functional.json':'a7d09755b71cfb3fccf7a4497ff1a1f4a7b79ad940ff40d8a7f5126efce243b8','homepage-discovery.json':'810fe7dbee43cfc3b32bf4704b5eab1eca675598244ccc80566094b3e4ebf7ba'}),
  specs:Object.freeze({'tests/helpers/canvas-agent-ui.cjs':'d1d82b1a8b01d4faa68623998238b67c2884894e4f16350ecbaa01b4ffea2056','docs/runbooks/REGRESSION_REGISTER.md':'f0809a8f01b3a906e289739f93b6ffed241cf6f1dd1c120acae2118c5239f0bb'}),
  retain:[1,4,5,6,7,8,9,10,11,13,16,18,19,20,21,22,23,24,25,26,27,28,30,31,32,33,35,36,37,38,39,40,41,42,43,45,46],
});
// Closed continuation of the completed original planning-settlement release.
export const STORED_PLAN_CONTINUATION=Object.freeze({
  source:'976310e5bb02dd3bd317a1964bd90320f78db3d7',
  run:'976310e5bb02dd3bd317a1964bd90320f78db3d7-5bc79b8e-08f9-44fc-a595-a4ec869b099c',
  native:Object.freeze({"source":"927a77911937a601b4fc961e0afa921b6ac1dbc6","checkpoint":"fa932a2163022b4cef1e65bbfe1ed5dfa305b05e6c2f4b9f45fe2af63f4d5ce1","report":"53b79cd99b6120acd9b8112966d09826f7ee484ffa2d1c6fa875775512ba6cba","failed":"138ac934de5096288b5b7e1767ce40959cc485077dbc090d76f3d3cf731aa5e8","nativeLog":"36324cdbf433b01d94ffed084682425f7822219f744b4c7d39a7f4cacde59eb7","test":"65477ea29d643c8f0de50f9a617641ac5639efe6adc44142e5d35446addc7473","specs":{"workers/auth/src/lib/canvas-agent-settlement-review.js":"614a6c99e39bd5632a89eac2e1c42fe8ba357179a44e6ff89937b04301eba69c","docs/runbooks/REGRESSION_REGISTER.md":"06d4ab06a8494379e32dad91a572e911457175094f331645ed0ba87ac3f54ecd","tests/helpers/q2-runtime/canvas-policy-tail.mjs":"1e842d828f12e4564e6adc00f8f8e5cef5aa5229d95c21e3d3b7c76837303d14","tests/helpers/q2-runtime/runner.mjs":"2698a56c5e86d3e065c3cc23d93d9bb8159177d1678c82c2827525e02989ac69","tests/helpers/q2-runtime/linux-hosted.mjs":"7823502f86a81added414c8818fc86faa70456502d200e5cb64e9affcaee6552","tests/helpers/q2-runtime/linux-runtime-child.mjs":"1e3ac70426712b015e9f37d32dc7dd01069bcd920022c0cdaa4178bc1da13081","tests/helpers/q2-runtime/linux-bootstrap.py":"89b4e5dba6d88503eadbad2aad992779001fbc688d03623296abed750bd32edf"},"proof":{"launcher-result.json":"639e3aa350329357865e35285a6803bc0cd38565f1003f6b2214e5416e854dfd","reports/bitbi-q2-runtime-hkzCI4__result.json":"2ef38bb8559331d589cdf918065e013ce39b24817da62b3eb6bb19a42a05c985","reports/isolation-result.json":"c609013b5a939b464aaa1834e97286e6ec5c0f4eb4c069f1af40770a6527b11e","reports/isolation-final.json":"3722a729b374515d022042aa6df90f8f984b91c3086a0a52d42884219ce98055"}}),
  workerRetry:Object.freeze({source:'5d5d6bc62098b342bf5892ba454df39e81c55e77',checkpoint:'b01712671a5e6fd0c99f98315b3517932ed97fb11d322b40869512c704f65efe',report:'750e2ad2fb31b6ada728e3241ef63a7d4d61cd3f2f044ff5a0fd6611f9288530',failed:'41dce8472e188cded50010b2637c3816145da7b35b748c9e709c21431ad327ff',guard:'205c0fc9dc54a69405b5fb0ea18f1274ae16c2bbf1711fa72f06ab77110e26eb',helper:'ecac3ffa6441345892a8822dd499a05c67e85878a3efb554192ce4a63fd4cf76',test:'383366b4fd6d83787aae5333ba79278f824591a34703e7211b8cc04193e0455f'}),
  worker:Object.freeze({source:'aee29a0d536c6ed68673da5ba99dc90eb6a1e522',checkpoint:'b1567bccae2088398bacae57caaf0430a9b8cb2d9f06495f9a682846754105d3',report:'bfcba82a6b5526c028749f8d800c526348f8534948676e91ed1562fdfa68a5c8',failed:'1f4bf5fb0f16168312ae2c11370d705a6a893506e2799fea9384f5cf3f9ac52d',guard:'059202981b0cde5e2115300a0609b5e1ff2783ab86ec7e81472236c86dcb390c',helper:'2cce6ac9c6806f214ad635c96e37537b887a1e8c74f984061366c1dbc091da6e'}),
  placement:Object.freeze({source:'946d32c4cb5d35ab4653ed42a035b82a59b495d5',checkpoint:'7568ac5a524c7e7be11d56103d0afb5dcefc5354f617ea77246c8cfe40261b4a',preflight:'05cb0d53f874b72b53bed175cbd428236700b6ea586fd10cdaf092730e7a2f9e',failed:'4970a6841914aebbca609b757c44476b8c8ffed7deb4bb623ed3ccf4b1edbf86'}),
  checkpoint:'1fd347b91a4b2c3fdff267f8a8f06844555d571d36b7ec16ac50478242969ea9',
  reports:Object.freeze({
    homepage:'0fae2aba1a188087902d3bd2e82f5503008586b4a54019e5783c0fe378548b18',
    auth:'33165cccd272f1dcc78408ffeaea11a2fb4b66557c50fe123edcdabf718ac523',
  }),
  specs:Object.freeze({
    "docs/production-readiness/CANVAS_AGENT.md": "894002e5031185c5691faf2061df375f0444609451411e38fab37fc3035860f5",
    "docs/runbooks/REGRESSION_REGISTER.md": "266b0984c2e9447b4daa901da8139fdec41d093c3bf13027bbac93aa044c6355",
    "scripts/canvas-planning-settlement-review.mjs": "90ea2384ec0b9224373a67690ab191e5d8e6051c2c540249e90399e8ea41741e",
    "scripts/lib/canvas-settlement-operator.mjs": "31f42edbcdd4c71c8bc273e71c2bd8fdebef27432f310072866d1bb5369f8daa",
    "tests/helpers/canvas-agent-settlement-review-control.mjs": "1d3ad3b76365fcf8293eae0b1c1af4269849dec62a532e300b4087a7add446c6",
    "tests/helpers/q2-runtime/canvas-policy-tail.mjs": "653b5e6d88f7169cf632f88fd2853ca9847ba55bf6a84e3b42612579ea42ff3f",
    "tests/helpers/q2-runtime/canvas.mjs": "5ebbbecd334f464b4b004c46fed3ae84650d1d909964bbf5db3ae05ad6bd23ee",
    "tests/helpers/q2-runtime/linux-bootstrap.py": "e6cbce75e52736d35bde09503edc8b785505ef2a1bb6cf83620d016f93038b00",
    "tests/helpers/q2-runtime/linux-hosted.mjs": "2dbaa1a6a8172c816b7413b5290a3fe262157893977c3b58d1f9c4f66d9b7004",
    "tests/helpers/q2-runtime/linux-runtime-child.mjs": "afd9c1ef4c45c9dc23d6b8c0cf8a387e42f09c0be708c963b11da0cd183b0a1d",
    "tests/helpers/q2-runtime/runner.mjs": "399d87427b14957dcff5bed83f5a889b1c2d24334e6cac85bb7a886d6d128c7f",
    "tests/q2-canvas-agent-settlement-review.spec.js": "48590ea14af761f928258861bfa9c94c3e8772d21c78a400c610195d6aaac464",
    "tests/q2-canvas-settlement-operator.spec.js": "3a6da85ee131681868d09cec422afc8792034b9fd32e89d63b92982c6a8f18bd",
    "workers/auth/src/lib/canvas-agent-graph.js": "30a5c4e38fed4c0df532f6530a4b5f59de4f6887f4f2b8adef71493ba60a0420",
    "workers/auth/src/lib/canvas-agent-settlement-review.js": "667e584fe38e5d916ee1f4adf4fa95bb81a0d992112f79fe2992d02b5a805bc2"
}),
});
export function assertStoredPlanTree(head,read=args=>execFileSync('git',args,{maxBuffer:64*1024*1024})) {
  const p=STORED_PLAN_CONTINUATION;
  const tooling=['scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs','scripts/lib/local-release-browser.mjs','scripts/test-local-release.mjs'];
  const parents=read(['rev-list','--parents','-n','1',head]).toString().trim().split(/\s+/);
  const native=parents[1]===p.native.source,retry=parents[1]===p.workerRetry.source,worker=parents[1]===p.worker.source,helper='tests/helpers/canvas-agent-settlement-review-control.mjs';
  if(native){
    assert.deepEqual(parents,[head,p.native.source]);assertStoredPlanTree(p.native.source,read);
    const repair=read(['diff','--name-only',p.native.source,head]).toString().trim().split('\n').filter(Boolean);
    assert(repair.every(file=>tooling.includes(file)||Object.hasOwn(p.native.specs,file)),'Native continuation changed unrelated accepted input');
    for(const[file,hash]of Object.entries(p.native.specs)){assert(repair.includes(file));assert.equal(sha256(read(['show',`${head}:${file}`])),hash,'Changed native continuation input');}
  }else if(retry){
    assert.deepEqual(parents,[head,p.workerRetry.source]);assertStoredPlanTree(p.workerRetry.source,read);
    const repair=read(['diff','--name-only',p.workerRetry.source,head]).toString().trim().split('\n').filter(Boolean);
    assert(repair.includes(helper)&&repair.every(file=>tooling.includes(file)||file===helper),'Worker diagnostic repair changed unrelated accepted input');
  }else if(worker){
    assert.deepEqual(parents,[head,p.worker.source]);assertStoredPlanTree(p.worker.source,read);
    const repair=read(['diff','--name-only',p.worker.source,head]).toString().trim().split('\n').filter(Boolean);
    assert(repair.includes(helper)&&repair.every(file=>tooling.includes(file)||file===helper),'Worker continuation changed unrelated accepted input');
  }else if(parents[1]===p.placement.source){
    assert.deepEqual(parents,[head,p.placement.source]);assertStoredPlanTree(p.placement.source,read);
    const repair=read(['diff','--name-only',p.placement.source,head]).toString().trim().split('\n').filter(Boolean);
    assert(repair.length&&repair.every(file=>tooling.includes(file)),'Evidence-placement repair changed accepted runtime or test inputs');
  }else assert.deepEqual(parents,[head,p.source],'Stored-plan continuation must preserve the exact accepted-source chain');
  const files=read(['diff','--name-only',p.source,head]).toString().trim().split('\n').filter(Boolean);
  assert(files.length&&files.every(file=>tooling.includes(file)||Object.hasOwn(p.specs,file)),'Unreviewed runtime, test, policy, dependency or frontend change');
  for(const[file,hash]of Object.entries(p.specs)){assert(files.includes(file),`Missing reviewed change: ${file}`);assert.equal(sha256(read(['show',`${head}:${file}`])),native?(p.native.specs[file]||(file===helper?p.workerRetry.helper:hash)):file===helper&&retry?p.workerRetry.helper:worker&&file===helper?p.worker.helper:hash,`Changed reviewed input: ${file}`);}
  for(const file of files)assert.match(read(['ls-tree',head,'--',file]).toString(),/^100644 blob /,'Continuation must contain ordinary committed files');
  if(native){assert.equal(sha256(read(['show',`${head}:scripts/test-local-release.mjs`])),p.native.test,'Changed native continuation verifier');return;}
  if(retry){assert.equal(sha256(read(['show',`${head}:scripts/test-local-release.mjs`])),p.workerRetry.test,'Changed reviewed continuation counterchecks');return;}
  if(worker){
    const before=read(['show',`${p.worker.source}:scripts/test-local-release.mjs`]).toString(),after=read(['show',`${head}:scripts/test-local-release.mjs`]).toString();
    const entry="if(process.argv.includes('--stored-plan-worker-only')) {\n  assert.deepEqual(process.argv.slice(2),['--stored-plan-worker-only']);\n  await testStoredPlanWorkerContinuation();process.exit(0);\n}\n\n",tail='\nasync function testStoredPlanWorkerContinuation() {';
    assert.equal(after.split(tail).length,2);assert.equal(after.split(tail)[0].replace(entry,''),before,'Previously accepted release assertions changed');assert(after.endsWith('\nawait testStoredPlanWorkerContinuation();\n'));return;
  }
  const before=read(['show',`${p.source}:scripts/test-local-release.mjs`]).toString(),after=read(['show',`${head}:scripts/test-local-release.mjs`]).toString();
  const entry="if(process.argv.includes('--stored-plan-only')) {\n  assert.deepEqual(process.argv.slice(2),['--stored-plan-only']);\n  await testStoredPlanContinuation();process.exit(0);\n}\n\n",tail='\nasync function testStoredPlanContinuation() {';
  assert.equal(after.split(tail).length,2,'Missing unique continuation countercheck');assert.equal(after.split(tail)[0].replace(entry,''),before,'Existing release assertions changed');assert(after.endsWith('\nawait testStoredPlanContinuation();\n'));
}
export function verifyModelBrowserReport(report,sha) {
  if(report.retainedSource){
    assert.equal(report.retainedSource,STORED_PLAN_CONTINUATION.source);assertStoredPlanTree(sha);
    const {retainedSource,...original}=report;original.sha=retainedSource;
    assert.equal(sha256(JSON.stringify(original)),STORED_PLAN_CONTINUATION.reports[report.scope],'Retained complete browser evidence changed');
  }
  const p=report.source===SETTLEMENT_BROWSER_PREFLIGHT.source?SETTLEMENT_BROWSER_PREFLIGHT:MODEL_BROWSER_PREFLIGHT;
  assert.equal(report.policy,MODEL_BROWSER_POLICY);assert.equal(report.sha,sha);assert.equal(report.source,p.source);assert(['homepage','auth'].includes(report.scope));
  const auth=report.scope==='auth';
  assert.equal(sha256(JSON.stringify(report.previous)),p.rows,'Original failed browser results changed');
  assert.equal(sha256(JSON.stringify(report.discovery)),auth?p.authDiscovery:p.discovery,'Required browser discovery changed');
  assert.equal(report.previous.length,p.required);assert.equal(report.discovery.length,auth?p.authRequired:p.required);
  const retained=new Map(report.previous.filter(passedBrowserCase).map(row=>[row.key,row]));
  const counts=verifyBrowserUnion(report.discovery,retained,report.fresh);
  if(auth)assert.equal(counts.reused,p.authReused,'Auth must retain exactly the already passed locale cases');
  assert.deepEqual(report.counts,counts);return counts;
}
export async function runModelBrowserContinuation(scope='homepage',env=process.env,profile=MODEL_BROWSER_PREFLIGHT) {
  const {verifyModelBrowserRepair}=await import('./local-release-evidence.mjs');
  assert([MODEL_BROWSER_PREFLIGHT,SETTLEMENT_BROWSER_PREFLIGHT].includes(profile),'Unknown closed browser profile');
  assert(['homepage','auth'].includes(scope));assert.equal(env.GITHUB_JOB,'browser-validation');assert.equal(env.CI,'1');
  const {previous}=verifyModelBrowserRepair('.local-release',env.GITHUB_SHA,{allowPending:true,profile});
  const retained=new Map(previous.filter(passedBrowserCase).map(row=>[row.key,row]));
  const prefix=scope==='auth'?'model-browser-auth':'model-browser';
  const run=(name,args,discovery=false)=>{
    const file=path.resolve(`test-results/${prefix}-${name}.json`);fs.rmSync(file,{force:true});
    const child=spawnSync('npm',['run',scope==='auth'?'test:auth':'test:homepage-core','--',...args,`--reporter=${discovery?'json':'list,json'}`],{env:{...env,PLAYWRIGHT_JSON_OUTPUT_NAME:file},stdio:discovery?'pipe':'inherit',maxBuffer:16*1024*1024});
    assert.equal(child.status,0,`Model browser ${name} failed; preserve the actual report and passing cases`);
    return JSON.parse(fs.readFileSync(file));
  };
  const rawDiscovery=run('discovery',['--list'],true),discovery=browserRows(rawDiscovery,{discovery:true});
  assert.equal(sha256(JSON.stringify(discovery)),scope==='auth'?profile.authDiscovery:profile.discovery,'Required browser discovery changed');
  const pending=new Set(discovery.filter(row=>!retained.has(row.key)).map(row=>row.key)),list=[];
  const visit=(suite,parents=[])=>{
    for(const spec of suite.specs||[])for(const test of spec.tests||[])if(pending.has(`${test.projectName}:${spec.id}`))list.push(`[${test.projectName}] › ${spec.file} › ${[...parents,spec.title].join(' › ')}`);
    for(const child of suite.suites||[])visit(child,[...parents,child.title]);
  };
  rawDiscovery.suites.forEach(suite=>visit(suite));assert.equal(list.length,pending.size);assert(pending.size>0);
  const listFile=`test-results/${prefix}-pending.txt`;fs.writeFileSync(listFile,list.join('\n')+'\n');
  const args=['--test-list',listFile,'--workers=1','--retries=0',`--output=test-results/${prefix}-artifacts`];
  const selected=browserRows(run('selected-discovery',[...args,'--list'],true),{discovery:true});
  assert.deepEqual(selected,discovery.filter(row=>pending.has(row.key)),'CLI selection changed required unresolved cases');
  const fresh=browserRows(run('fresh',args));
  const report={policy:MODEL_BROWSER_POLICY,sha:env.GITHUB_SHA,source:profile.source,scope,previous,discovery,fresh,counts:verifyBrowserUnion(discovery,retained,fresh)};
  verifyModelBrowserReport(report,env.GITHUB_SHA);
  fs.writeFileSync(`test-results/candidate-${scope}.json`,JSON.stringify(report));
  console.log(JSON.stringify({scope,...report.counts,originalFailuresPreserved:true}));
}
// Closed e8 continuation: one reviewed forward retention trigger, its two
// native/Worker boundary cases, and the corrected budget-edit browser fixture.
export const AUTONOMY_BROWSER_POLICY='local-canvas-autonomy-browser-continuation-v1';
export const AUTONOMY_BROWSER_PREFLIGHT=Object.freeze({
  source:'e8cfedacd202f885488cc24d0eede042ca02bd54',
  run:'e8cfedacd202f885488cc24d0eede042ca02bd54-ea93ed48-d3f6-428f-933a-b8b7e4d749c0',
  checkpoint:'8cdebc1a2a20136dc1486a9b35bf39a2c4561fd599881eea8cf789a3cb181bfb',failedLog:'33503a970803345b2e0c2c81dfbdea143e767c141c545262ca5142394c5a6349',report:'94104a33883c8a0b6a6c9d09f5a9dc20ab41e0c5b6314472ef866a14e4fd2cf5',rows:'fa7db22ba36622204ba37d965c6f4b1fca884f7636837c2ebd3cb9388b895fff',
  discovery:'eaaf83cf4b618a7a407f35b8cda2f75317d9b1aed5b1c6ff67f6c375ed286e6e',required:586,
  standardDiscovery:'b7c290c9e9f17cdc3a45afe1280811d3bb4e4ef79ccc46f668a8b0feb95622ba',standardFile:'homepage-discovery-qUflmX/standard.json',
  authDiscovery:'7f7b08cedcd4e7883649e1210b89e8179b867ce7e9611481df2b8a22c0c6b903',authRequired:709,authReused:25,
  manifest:'7f1a69653fb35689f38d688e6fbe886a14804f99f6252b9fcd9f61a9f4ea94cc',
  proof:'c07c24eb2c518b07cc45b81c9349d0df22884e7485afb681f4b2a658477238c8',
  hostingLog:'b9a0c3ec6a1a5b6e5d558e606737f0abe878f84602dc525e5e20804f6f2365b1',
  image:'62ae744e4c2fa9c9c398caf429ec53aad3217e809126d2bb9e625dbe68ad4971',
  nativeProof:Object.freeze({
    "runtime/q2-runtime-evidence/native-wiWkQX/launcher-result.json": "ec9d262350f8ae06058c04b09e71ec110266c4db8ac91efba7cfccee21c2fb42",
    "runtime/q2-runtime-evidence/native-wiWkQX/reports/isolation-result.json": "c609013b5a939b464aaa1834e97286e6ec5c0f4eb4c069f1af40770a6527b11e",
    "runtime/q2-runtime-evidence/native-wiWkQX/reports/isolation-final.json": "3722a729b374515d022042aa6df90f8f984b91c3086a0a52d42884219ce98055",
    "runtime/q2-runtime-evidence/native-wiWkQX/reports/bitbi-q2-runtime-E0enGm__result.json": "d8df62ce34c6520482b34c10ed1a54e1a751bc424691e8e0982fbc7c2336ff6d"
}),
  homepageReports:Object.freeze({
    'homepage-functional.json':'6f2fc283a39c791921354bac0f5de8fe47709bbd3fe5389b734158c7ee55c9a7',
    'homepage-discovery.json':'de62eff3fde5feeeec1c50b303ef6acb820d49d1122497c3c154fed08b5e76f7',
  }),
  specs:Object.freeze({
    'workers/auth/migrations/0108_canvas_creative_export_retention.sql':'9ed90331adf6ca67df682568964cb600c5b382f10d14b2161cfb7db7a2c3635e',
    'config/release-compat.json':'6f4b660ef555f77d0f6ec382c5652d2be65293e0e5b2a8a319d855dce869e8da',
    'scripts/lib/canvas-export-readiness.mjs':'ff96ed062d3c8fe9140ce7edd0a953218fa033c87b6562e54f14173e71951062',
    'scripts/test-q2-runtime-launcher.mjs':'95c7b7d5d098830cf7c68c593f9c22fb5a1ab2538f553153b405241b2260b8d5',
    'tests/q2-canvas-agent.spec.js':'ac478b5eb8a4c9378b4b9a88e32819b23e346405b70186e483c36dec2c67e287',
    'tests/helpers/canvas-assembly-control.mjs':'088cc2885ffbdb3c167719344f6c19c03cfddd586532ab22624bae66fb1afbf7',
    'tests/helpers/q2-runtime/canvas.mjs':'5c44b40fe765ef1613f85d6c074b1574143681c686b1a218831f6f3a260e8f7b',
    'tests/helpers/q2-runtime/control.mjs':'dc89bb3a239b40c7bd33a872d3f4a57ccc67a8dee82efd17c6dc527a1fb68011',
    'tests/helpers/q2-runtime/environment.mjs':'7793a25d7f6aa117783cc8325cb5f817e7fe08425b31ac301f9a1b6b2e3ff388',
    'tests/helpers/q2-runtime/linux-bootstrap.py':'5cc0b75637b9be8d0558eaa9eaf2cb720c8352dbe48cbfeaab740a40acaf3426',
    'tests/helpers/q2-runtime/linux-hosted.mjs':'8a3d9bdf35cfcc02fed8f6ea164565b703a94a2add4b7cc453b11c1fd657522f',
    'tests/helpers/q2-runtime/linux-runtime-child.mjs':'85156ef0f2dcf55da65dc619ac7f7cc7adc213123bc1d91f481ebe542b46386c',
    'tests/helpers/q2-runtime/runner.mjs':'31fdb9bc46513b8132f657f88946dd913e496e3dafa55036877f9e2609b183a3',
    'tests/helpers/canvas-agent-autonomy-ui.cjs':'834fc1ebf3f601d3d6076d6d32fb55fbbe3466905d2a75180d47deb1759df59b',
    'tests/helpers/canvas-audio-ui.cjs':'bfde06da290bd75f6aac699d92256bcf449c640c92b610e7eb33c9d2d5d82e00',
    'tests/helpers/canvas-transition-examples-ui.cjs':'3d1c2702ae908aaf6b1b11eb6da6ce07b3628fc482af5eac5913d9e2be3cb429',
    'scripts/lib/local-release-transport.mjs':'e03e90c91cf704142675580042607f5aa230855ad476816764ef699377d32716',
    'scripts/lib/media-publication.mjs':'77ad15c91f11fa47e05bba677b5bae966d049ef7aafc2ba480acaf4156296e38',
    'scripts/lib/backend-publication.mjs':'295cf3ba17c09c64ce5352a6f7bc1ea66a144aecacf6f704817bc5596bdd5b11',
    'scripts/test-media-activation-reuse.mjs':'9e02689171d5fc4bf97fb09d14da01220c7a0e2c727cb923dd09795b7c22e286',
    'docs/runbooks/REGRESSION_REGISTER.md':'029dbcc62fa1d8bdeac90e1b72455f7e56ab96fa03af030ecfff60106b35e003',
    'scripts/lib/ci-test-selection.mjs':'80c03c4f45685f7426d37101e7446d1295c759e13a6b13f3cddf90d6249e218f',
    'scripts/test-ci-test-selection.mjs':'809a260b83aebf5c10e3b26e93507fe8cf7a6986c237b1633800eea663dc46cb',
  }),
  retain:[1,4,5,6,7,8,9,10,11,19,20,22,25,26,27,30,32,33,36,40,42,43,44,46,47],
});
export const AUTONOMY_BROWSER_PROGRESS=Object.freeze({
  source:'0f82b547f0bed2b6af78723fbba1ea835abe63ac',
  run:'0f82b547f0bed2b6af78723fbba1ea835abe63ac-b29e2669-d5e9-4c19-9ab6-193a87495fe9',
  checkpoint:'9d4885db4c290178c6cc4c95458a297c20d386e8f0da80965bdc66050fb58d12',
  failedLog:'37fb2a58f19e43985c319806706cfc348727c83bc2fbf72b0dccda58121255bc',
  plannerSource:'9d2b921935bf34f010c1eeef3a38d5b9ef92ba1843b7b7474504e2c8d7a7a8cb',
  specs:Object.freeze({'scripts/test-canvas-agent-release.mjs':'f871928546c81fc5436616a85dab3d1ead7485476209ef3e0debbeaed277a415'}),
  retain:[13],
});
export const AUTONOMY_BROWSER_DOC_PROGRESS=Object.freeze({
  source:'6373ce25c5e8a646966c3747b8c4bec4bc46b193',
  run:'6373ce25c5e8a646966c3747b8c4bec4bc46b193-e0d65a8a-3f68-4b37-9677-e38984665a6e',
  checkpoint:'7de8f09b807174082a2e65f3eb4cd862cb01e61b01fb683cd9e7ae20b4b05066',
  failedLog:'6be3a28031cd7dd8adc3c05effe2af093f8d44e2327ea20e50feb3527fd64c5f',
  specs:Object.freeze({
    'scripts/lib/doc-currentness.mjs':'abb23a053e5c047e465ff652eee2950a791ee1364c1ee3d74724915e75abdbdd',
    'scripts/test-doc-currentness.mjs':'4c06beb0a38dbe4df25517d12a3cc9e0b2e093cd530d43913ecb788aeca79140',
    'scripts/lib/ci-test-selection.mjs':'5cef2b97079d740c07f8f40eff5463143788764335c99be7e573c611801aa9bb',
    'scripts/test-ci-test-selection.mjs':'e37f4c178e6c08101d80f5c396bcdab3c0399243b14b1d3a73cdcb4b9987bdb6',
    'docs/runbooks/REGRESSION_REGISTER.md':'fc8ee6348a10ad48cbed5a7fb28a3a4aa9b7430d0ae6e6dab4b03af6f9656973',
  }),
  retain:[13,14,15,18,21,23,24],
});
export const AUTONOMY_BROWSER_WORKER_PROGRESS=Object.freeze({
  source:'f5816a676d00b5831d9101794d16363c53a2f914',
  run:'f5816a676d00b5831d9101794d16363c53a2f914-a3248baf-7cc4-45bc-82d0-bc3222286a50',
  checkpoint:'7aabe9fd125bb8c84626a221d6dd7585efc415556918d17c5cdc38eba48d602b',
  failedLog:'e5c05eabdeec527be92ec2277ea519cc7480b970dd79c3a83b08ba90ef5f4032',
  discovery:'e67292fb0a6f779295c3e22bffa4baaa63bd2cbd60a9b444992d93bdaf954a0c',
  failedWorkers:'d8a41f0e7bdf21a0fff67c16d8f8f6f46df5180b4a7abfd8a0c22f26f799d95e',
  specs:Object.freeze({}),
  retain:[13,14,15,16,18,21,23,24,28,29,31],
});
export const isAutonomyBrowserWorkerProgress=(head,read=args=>execFileSync('git',args))=>read(['rev-list','--parents','-n','1',head]).toString().trim().split(/\s+/)[1]===AUTONOMY_BROWSER_WORKER_PROGRESS.source;
export const isAutonomyBrowserDocProgress=(head,read=args=>execFileSync('git',args))=>read(['rev-list','--parents','-n','1',head]).toString().trim().split(/\s+/)[1]===AUTONOMY_BROWSER_DOC_PROGRESS.source||isAutonomyBrowserWorkerProgress(head,read);
export const isAutonomyBrowserProgress=(head,read=args=>execFileSync('git',args))=>read(['rev-list','--parents','-n','1',head]).toString().trim().split(/\s+/)[1]===AUTONOMY_BROWSER_PROGRESS.source||isAutonomyBrowserDocProgress(head,read);
export function assertAutonomyBrowserTree(head,read=args=>execFileSync('git',args)) {
  const progress=isAutonomyBrowserProgress(head,read),p=isAutonomyBrowserWorkerProgress(head,read)?AUTONOMY_BROWSER_WORKER_PROGRESS:isAutonomyBrowserDocProgress(head,read)?AUTONOMY_BROWSER_DOC_PROGRESS:progress?AUTONOMY_BROWSER_PROGRESS:AUTONOMY_BROWSER_PREFLIGHT;
  if(progress)assertAutonomyBrowserTree(p.source,read);
  assert.deepEqual(read(['rev-list','--parents','-n','1',head]).toString().trim().split(/\s+/),[head,p.source],'Autonomy browser continuation requires the direct source successor');
  const files=read(['diff','--name-only',p.source,head]).toString().trim().split('\n').filter(Boolean);
  assert(files.every(file=>[...Object.keys(p.specs),'scripts/local-release.mjs','scripts/lib/local-release-evidence.mjs','scripts/lib/local-release-browser.mjs','scripts/pages-candidate.mjs','scripts/test-local-release.mjs'].includes(file)),'Autonomy browser continuation changed unreviewed product, tests, selection or environment');
  for(const [file,hash]of Object.entries(p.specs)){
    assert(files.includes(file),'Missing reviewed autonomy correction');assert.equal(sha256(read(['show',`${head}:${file}`])),hash,'Unreviewed autonomy correction');
  }
  for(const file of files)assert(/^100644 blob [0-9a-f]{40}\t/.test(read(['ls-tree',head,'--',file]).toString()),'Continuation input must remain an ordinary file');
}
const autonomyAffected=row=>row.file==='canvas.spec.js'&&(/^Canvas autonomy (en|de): persisted budget_edits$/.test(row.title)||/^Canvas editable film (en|de): rerun remove reorder sound export reopen$/.test(row.title)||/^Canvas asset audio (en|de): typed references, persistent controls and real export$/.test(row.title)||(row.project==='webkit-canvas'&&row.title==='Canvas transition examples de: isolated illustrations and motion controls'));
export function verifyAutonomyBrowserReport(report,sha) {
  const p=AUTONOMY_BROWSER_PREFLIGHT;
  assert.equal(report.policy,AUTONOMY_BROWSER_POLICY);assert.equal(report.sha,sha);assert.equal(report.source,p.source);assert(['homepage','auth'].includes(report.scope));
  assert.equal(sha256(JSON.stringify(report.previous)),p.rows,'Original failed browser results changed');assert.equal(report.previous.length,p.required);
  const auth=report.scope==='auth';assert.equal(sha256(JSON.stringify(report.discovery)),auth?p.authDiscovery:p.discovery,'Required browser discovery changed');
  assert.equal(report.discovery.length,auth?p.authRequired:p.required);
  assert.equal(report.previous.filter(autonomyAffected).length,13,'Missing affected locale/browser definitions');
  const retained=new Map(report.previous.filter(row=>passedBrowserCase(row)&&!autonomyAffected(row)).map(row=>[row.key,row]));
  const counts=verifyBrowserUnion(report.discovery,retained,report.fresh);
  if(auth)assert.equal(counts.reused,p.authReused,'Auth must retain exactly the already passed locale cases');
  assert.deepEqual(report.counts,counts);return counts;
}
export function verifyAutonomyImageReuse(record,sha,{read}={}) {
  const p=AUTONOMY_BROWSER_PREFLIGHT;assertAutonomyBrowserTree(sha,read);
  assert.equal(record.sha,p.source);assert.equal(record.run,p.run);assert.equal(record.attempt,'1');
  assert.equal(sha256(JSON.stringify(record)),p.image,'Retained image/test identity changed');return record.sha;
}
export function verifyImportedAutonomyImage(record,{sha,run,attempt},options) {
  assert.equal(record.run,String(run));assert.equal(record.attempt,String(attempt));
  const {localValidation,...original}=record;assert.equal(localValidation?.policy,'development-mac-v1');
  assert.equal(localValidation.publicationSha,sha);assert.match(localValidation.evidence,/^[a-f0-9]{64}$/);
  original.run=localValidation.run;original.attempt=localValidation.attempt;
  assert.equal(sha256(JSON.stringify(original)),localValidation.recordHash);return verifyAutonomyImageReuse(original,sha,options);
}
export function autonomyReceiptImageSource(media,sha) {
  if(!media.imageSourceSha||media.imageSourceSha===sha)return sha;
  assert.equal(media.imageSourceSha,AUTONOMY_BROWSER_PREFLIGHT.source);assertAutonomyBrowserTree(sha);return media.imageSourceSha;
}
export async function runAutonomyBrowserContinuation(scope='homepage',env=process.env) {
  const {verifyAutonomyBrowserRepair}=await import('./local-release-evidence.mjs');
  assert(['homepage','auth'].includes(scope));assert.equal(env.GITHUB_JOB,'browser-validation');assert.equal(env.CI,'1');
  const {previous}=verifyAutonomyBrowserRepair('.local-release',env.GITHUB_SHA,{allowPending:true});
  const retained=new Map(previous.filter(row=>passedBrowserCase(row)&&!autonomyAffected(row)).map(row=>[row.key,row]));
  const prefix=scope==='auth'?'autonomy-browser-auth':'autonomy-browser';
  const run=(name,args,discovery=false)=>{
    const file=path.resolve(`test-results/${prefix}-${name}.json`);fs.rmSync(file,{force:true});
    const child=spawnSync('npm',['run',scope==='auth'?'test:auth':'test:homepage-core','--',...args,`--reporter=${discovery?'json':'list,json'}`],{env:{...env,PLAYWRIGHT_JSON_OUTPUT_NAME:file},stdio:discovery?'pipe':'inherit',maxBuffer:16*1024*1024});
    assert.equal(child.status,0,`Autonomy browser ${name} failed; preserve the actual report and passing cases`);
    return JSON.parse(fs.readFileSync(file));
  };
  const rawDiscovery=run('discovery',['--list'],true),discovery=browserRows(rawDiscovery,{discovery:true});
  assert.equal(sha256(JSON.stringify(discovery)),scope==='auth'?AUTONOMY_BROWSER_PREFLIGHT.authDiscovery:AUTONOMY_BROWSER_PREFLIGHT.discovery,'Required browser discovery changed');
  const pending=new Set(discovery.filter(row=>!retained.has(row.key)).map(row=>row.key)),list=[];
  const visit=(suite,parents=[])=>{
    for(const spec of suite.specs||[])for(const test of spec.tests||[])if(pending.has(`${test.projectName}:${spec.id}`))list.push(`[${test.projectName}] › ${spec.file} › ${[...parents,spec.title].join(' › ')}`);
    for(const child of suite.suites||[])visit(child,[...parents,child.title]);
  };
  rawDiscovery.suites.forEach(suite=>visit(suite));assert.equal(list.length,pending.size);assert(pending.size>0);
  const listFile=`test-results/${prefix}-pending.txt`;fs.writeFileSync(listFile,list.join('\n')+'\n');
  const args=['--test-list',listFile,'--workers=1','--retries=0',`--output=test-results/${prefix}-artifacts`];
  const selected=browserRows(run('selected-discovery',[...args,'--list'],true),{discovery:true});
  assert.deepEqual(selected,discovery.filter(row=>pending.has(row.key)),'CLI selection changed required unresolved cases');
  const fresh=browserRows(run('fresh',args));
  const report={policy:AUTONOMY_BROWSER_POLICY,sha:env.GITHUB_SHA,source:AUTONOMY_BROWSER_PREFLIGHT.source,scope,previous,discovery,fresh,counts:verifyBrowserUnion(discovery,retained,fresh)};
  verifyAutonomyBrowserReport(report,env.GITHUB_SHA);
  fs.writeFileSync(`test-results/candidate-${scope}.json`,JSON.stringify(report));
  console.log(JSON.stringify({scope,...report.counts,originalFailuresPreserved:true}));
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
// Closed preview-subject fixture correction; product, image and lifecycle cases are unchanged.
export const EXPORT_BROWSER_CONTINUATION=Object.freeze({
  "source": "044404c0bd8fe69437036dda0494d9c27baca8d3",
  "run": "044404c0bd8fe69437036dda0494d9c27baca8d3-b2d663c1-6f72-470c-82fa-0ac1e3b0b1b6",
  "checkpoint": "53542495c2a74e5a05568baa23a26ab44e287fc9299f4f3271df179f41a66248",
  "report": "6aa1d78140c1a40d6da0cf9ada580673b649137538bf35e253aecc58e5ec416d",
  "rows": "bb0d85bea9c28f100b988a34c5da52ab06757679e98f7e28ae9163880b59ff29",
  "discovery": "0cdf7aa41918b2b8fbec9ab7365a4d3c9e839afed7981d3819742889992ee6e3",
  "image": "22a44713d60d653f050c91a734c7e00048d57c1506d6a5a07eeb4b5c06d62a09",
  "manifest": "7e0255bf5e1d3adab8e53b67abfb938e481213b4a45de23df026c8f3301eaa4e",
  "proof": "46f4d738220eb7c019e805a4a9636cd3281740c2bd72c7e99ba3ed0e4ae6e0ef",
  "last": 45,
  "counts": {
    "required": 8,
    "reused": 4,
    "executed": 4
  },
  "specs": {
    "tests/helpers/canvas-workspace-transitions-ui.cjs": "6a7e0b291e8b03fb23f913992d3b604d71ee6911adca9e461b69854c191da12e"
  }
});
export const EXAMPLE_CACHE_CONTINUATION=Object.freeze({
 source:'f9220f6fd1ff0539e0f2d47782f1638c9672930d',run:'f9220f6fd1ff0539e0f2d47782f1638c9672930d-95415a1c-1c20-4361-a77c-d221fc4a8b79',
 checkpoint:'ad2abb8324963694c3478d6edb925eed2459261b56ec6cf6687601de778e3c59',report:'221fef3aed8cd9a640f629b7dc05e0bd061edb98462213163cc941f232af00e1',rows:'ed7491a8fc259cb0d54c9c36da30896107383f2be660d108d4c7eb033dfaf18f',discovery:'cc79002c30d8399e688321ec60f869af80e8df099c41a34794d59c4b005c8853',
 manifest:'4f4ca0134a77034220e0778dd10df56d300ab5c8f0fa75128f1ae00488149e38',proof:'292cdfd92c65254ccaa0d9e1cd9c135d677ae1183d34215a3d46c1f7bf42b8a5',last:41,counts:{required:4,reused:3,executed:1},
 browserProgress:{sha:'d17021f0fa78525b46006cc19093d5846d457ffb',run:'d17021f0fa78525b46006cc19093d5846d457ffb-9fbf697d-25f6-4f40-9a1e-f915f3b42ec1',report:'e1660b0172a8d05bbef00338bc7407c2d30bfc1ff3061eaca987e99b0dfc862e',rows:'1d3cdb453c72217477a7aef86a695245989ffa2d3d286ffdb33ccf7e40f840e3'},
 specs:{'tests/helpers/canvas-transition-examples-ui.cjs':'78feb5ef35d48fd397d96d8e1ec7e99af75992e06f767c7601edb7b0662c5230'},
});
export const smoothProfile=source=>source===EXAMPLE_CACHE_CONTINUATION.source?EXAMPLE_CACHE_CONTINUATION:source===EXPORT_BROWSER_CONTINUATION.source?EXPORT_BROWSER_CONTINUATION:source===WORKSPACE_CONTINUATION.source?WORKSPACE_CONTINUATION:source===INSPECTOR_CONTINUATION.source?INSPECTOR_CONTINUATION:source===AUDIO_FIT_CONTINUATION.source?AUDIO_FIT_CONTINUATION:SMOOTH_BROWSER_CONTINUATION;
export const isSmoothContinuation=sha=>[EXAMPLE_CACHE_CONTINUATION.source,EXPORT_BROWSER_CONTINUATION.source,WORKSPACE_CONTINUATION.source,INSPECTOR_CONTINUATION.source,AUDIO_FIT_CONTINUATION.source,SMOOTH_BROWSER_CONTINUATION.source,SMOOTH_BROWSER_CONTINUATION.progress,SMOOTH_BROWSER_CONTINUATION.accepted,SMOOTH_BROWSER_CONTINUATION.completed].includes(sha);
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
  const base=p===EXAMPLE_CACHE_CONTINUATION?['test:static','--','tests/canvas.spec.js','--project=chromium','--project=webkit-canvas','--grep','Canvas transition examples']:p===EXPORT_BROWSER_CONTINUATION?['test:static','--','tests/canvas.spec.js','--project=chromium','--project=webkit-canvas','--grep','Canvas workspace transitions .*: transitions|Canvas export lifecycle']:p===WORKSPACE_CONTINUATION?['test:static','--','tests/canvas.spec.js','--project=chromium','--project=webkit-canvas','--grep','Canvas workspace transitions']:p===INSPECTOR_CONTINUATION?['test:static','--','tests/canvas.spec.js','--project=chromium','--project=webkit-canvas','--grep','Canvas Inspector']:p===AUDIO_FIT_CONTINUATION?['test:static','--','tests/canvas.spec.js','--project=chromium','--project=webkit-canvas','--grep','Canvas audio fit']
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
