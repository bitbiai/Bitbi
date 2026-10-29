import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { selectCiTests } from './lib/ci-test-selection.mjs';
import { CANVAS_VOICE_FILES, verifyCanvasVoiceDiscovery, verifyCanvasVoiceNativeBrowserReport } from './lib/canvas-voice-selection.mjs';
import { gitSelection, requiredJobs, verifyCanvasCandidateReports, candidateProof } from './pages-candidate.mjs';
import { commandRuntimes, selectedCommands } from './lib/local-release-plan.mjs';
import { flattenHomepageDiscovery } from './lib/homepage-test-selection.mjs';

const selected = selectCiTests([...CANVAS_VOICE_FILES]);
assert.equal(selected.canvasVoice, true); assert.equal(selected.full, false);
assert(selected.workers && selected.auth && selected.static && !selected.homepage);
for (const file of ['workers/auth/src/lib/stripe-billing.js','workers/auth/package-lock.json','workers/auth/src/lib/canvas-voice-unknown.js',
  'services/homepage-ffmpeg-processor/canvas-full-video.mjs','tests/canvas-voice-unknown.test.mjs'])
  assert.notEqual(selectCiTests([...CANVAS_VOICE_FILES,file]).canvasVoice, true, 'An unrelated input cannot inherit a closed Voice profile');
assert(selectCiTests([...CANVAS_VOICE_FILES],{forceFull:true}).full);
const commands = selectedCommands(selected);
const browser = commands.find(value => value.name === 'Run selected auth and admin tests').run;
const completeDiscoveryCommand = browser.split('\n').find(line => line.includes('PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/canvas-complete-discovery.json'));
assert.match(completeDiscoveryCommand, /tests\/canvas\.spec\.js --project=chromium --project=webkit-canvas --list --reporter=json$/);
assert(!completeDiscoveryCommand.includes('--grep'), 'Independent discovery must include the complete Canvas entrypoint');
const run = commands.find(value => value.name === 'Run worker route tests').run;
for (const required of ['q2-canvas-voice-film.spec.js','q2-canvas-conversation-decisions.spec.js','q2-canvas-media-action-policy.spec.js',
  '--suite canvas-voice','--suite canvas-reliability','--suite canvas']) assert(run.includes(required), 'Missing actual guarded caller: '+required);
const native = commands.find(value => value.name === 'Run native Canvas Voice browser journey');
assert(native); assert.equal(commandRuntimes(native)[0].runtime,'native-browser-v1');
assert.throws(()=>commandRuntimes({...native,run:native.run+' --skip-guards'}));
assert(requiredJobs(selected)['browser-validation'].includes(native.name));
assert(requiredJobs({...selected,full:true})['browser-validation'].includes(native.name));
const nativeReport={schema:1,sourceSha:'a'.repeat(40),records:[['chromium_en',48000],['webkit_de',44100]].map(([name,rate])=>({
  name:'canvas_voice_browser_'+name,status:'PASS',connections:1,microphoneCalls:1,runCount:1,replayRunCount:1,productionRun:'b'.repeat(32),
  captureSampleRate:rate,turns:8,captureDurationMs:27000,appends:250,workletLoaded:true,sessionCompleted:true,productionSurvivesVoiceStop:true,
  bargeInVerified:true,retainedInterruptionMs:120,silenceFrames:5,
  syntheticMicrophone:true,syntheticProvider:true,savedBrief:{duration:{targetDurationSeconds:12},fields:{story:{value:'Synthetic'},style:{value:'Cartoon'},audio:{value:'Music'}}}}))};
verifyCanvasVoiceNativeBrowserReport(nativeReport,nativeReport.sourceSha);
for(const change of [r=>{r.sourceSha='c'.repeat(40);},r=>r.records.pop(),r=>{r.records[1].status='FAIL';},r=>{r.records[0].runCount=2;},
  r=>{r.records[0].workletLoaded=false;},r=>{r.records[0].captureDurationMs=20000;},r=>{r.records[1].savedBrief.fields.audio={};},
  r=>{r.records[0].bargeInVerified=false;},r=>{r.records[0].retainedInterruptionMs=0;},r=>{r.records[1].silenceFrames=0;},
  r=>{delete r.records[1].bargeInVerified;},r=>{delete r.records[0].retainedInterruptionMs;},r=>{r.records[1].silenceFrames='5';}]) {
  const broken=structuredClone(nativeReport);change(broken);assert.throws(()=>verifyCanvasVoiceNativeBrowserReport(broken,nativeReport.sourceSha));
}

// Exercise the protected immutable-ref selector and its real output adapter.
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-voice-selection-'));
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const commit=message=>{git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm',message]);return git(['rev-parse','HEAD']);};
try {
  git(['init','-q']); fs.writeFileSync(path.join(root,'README.md'),'fixture'); const base=commit('base');
  const file='workers/auth/src/lib/canvas-voice-relay.js'; fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),'// synthetic\n');
  const head=commit('voice');const previous=process.cwd();let actual;
  try{process.chdir(root);actual=gitSelection(base,head);}finally{process.chdir(previous);}
  assert.equal(actual.canvasVoice,true); const output=path.join(root,'output');fs.writeFileSync(output,'');
  execFileSync(process.execPath,['scripts/select-ci-tests.mjs','--base',base,'--head',head,'--github-output'],{
    env:{...process.env,GIT_DIR:path.join(root,'.git'),GIT_WORK_TREE:root,GITHUB_OUTPUT:output,GITHUB_STEP_SUMMARY:''},stdio:'pipe'});
  assert.match(fs.readFileSync(output,'utf8'),/^canvas_voice=true$/m);fs.unlinkSync(output);
} finally {fs.rmSync(root,{recursive:true,force:true});}

const discovery=JSON.parse(execFileSync(process.execPath,['node_modules/@playwright/test/cli.js','test','tests/canvas.spec.js',
  '--project=chromium','--project=webkit-canvas','--list','--reporter=json'],{encoding:'utf8',maxBuffer:20*1024*1024}));
const standard=flattenHomepageDiscovery(discovery), pattern=/Canvas Voice|Canvas conversation|Canvas autonomy|Canvas editable film|Canvas agent|Canvas AI workspace/;
const rows=standard.filter(row=>pattern.test(row.title));verifyCanvasVoiceDiscovery(rows,standard);
assert.throws(()=>verifyCanvasVoiceDiscovery(rows.slice(1),standard));
assert.throws(()=>verifyCanvasVoiceDiscovery([...rows,{...rows[0]}],standard));
assert.throws(()=>verifyCanvasVoiceDiscovery(rows.map((row,i)=>i?row:{...row,expectedStatus:'skipped'}),standard));
const filtered=structuredClone(discovery);
const filter=suite=>{suite.specs=(suite.specs||[]).filter(spec=>pattern.test(spec.title));for(const spec of suite.specs)for(const test of spec.tests)test.results=[{status:'passed',retry:0}];for(const child of suite.suites||[])filter(child);};
filtered.suites.forEach(filter);
verifyCanvasCandidateReports(['test-results/candidate-auth.json'],[filtered],filtered,selected,discovery);
// A self-consistent narrowed discovery/report used to pass the protected caller:
// remove one Voice case while retaining all its explicit minimum-title checks.
const omitted=structuredClone(filtered);let removed=false;
const omitVoice=suite=>{
  if(!removed){const index=(suite.specs||[]).findIndex(spec=>spec.title.startsWith('Canvas Voice'));
    if(index>=0){suite.specs.splice(index,1);removed=true;}}
  for(const child of suite.suites||[])omitVoice(child);
};
omitted.suites.forEach(omitVoice);assert(removed);
assert.throws(()=>verifyCanvasCandidateReports(['test-results/candidate-auth.json'],[omitted],omitted,selected,discovery),/Voice discovery lost/);
assert.throws(()=>verifyCanvasCandidateReports(['test-results/candidate-auth.json'],[filtered],filtered,selected),/complete Canvas discovery/);
// Exercise candidateProof, not only the helper: both independent discovery and
// the native browser report must be read by the protected artifact verifier.
const executed=structuredClone(filtered);
executed.stats={expected:rows.length,unexpected:0,flaky:0};executed.errors=[];
const inputs={
  'test-results/candidate-auth.json':executed,
  'test-results/canvas-discovery.json':filtered,
  'test-results/canvas-complete-discovery.json':discovery,
  'test-results/canvas-voice-native-browser/result.json':nativeReport,
};
const manifest={selection:selected,sha:nativeReport.sourceSha};
const proof=overrides=>candidateProof(manifest,{job:'browser-validation',readJson:file=>{
  const value={...inputs,...overrides}[file];assert(value,'Missing proof input '+file);return value;
}});
assert.equal(proof().status,'passed');
assert.throws(()=>proof({'test-results/canvas-complete-discovery.json':null}),/Missing proof input/);
assert.throws(()=>proof({'test-results/canvas-discovery.json':omitted,'test-results/candidate-auth.json':{...omitted,stats:executed.stats,errors:[]}}),/Voice discovery lost/);
const broken=structuredClone(filtered);let changed=false;
const breakOne=suite=>{for(const spec of suite.specs||[])for(const test of spec.tests)if(!changed){test.results=[{status:'failed'}];changed=true;}for(const child of suite.suites||[])breakOne(child);};
broken.suites.forEach(breakOne);assert(changed);
assert.throws(()=>verifyCanvasCandidateReports(['test-results/candidate-auth.json'],[broken],filtered,selected,discovery));
console.log(`Voice selection: protected refs/output, actual ${rows.length}-case discovery, executed-report rejection and native caller routing verified.`);
