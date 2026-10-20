import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {hash} from './lib/frontend-hosting.mjs';
import {requiresPrivateMediaImage,selectCiTests,canvasCompletionRouteSources} from './lib/ci-test-selection.mjs';
import {mediaTestOwnerFromEnv,persistMediaTestContainer,clearMediaTestContainer,mediaTestContainerLabels} from './lib/local-media-test-process.mjs';
export const MEDIA_TEST_TIMEOUT_MS=600000;
const docker=args=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:MEDIA_TEST_TIMEOUT_MS,maxBuffer:8*1024*1024});
const TEST_RUNTIME=Object.freeze(['run','--rm','--network','none','--env','MEMBER_GENERATION_POSTERS_ONLY=1','--platform','linux/amd64','--read-only','--cpus','1','--memory','6g','--tmpfs','/tmp:rw,size=2g']);
const PRIVATE_TESTS="await (await import('./private-media-runner.test.mjs')).testPrivateMediaRunner(); await (await import('./private-media-runner.test.mjs')).testContainerLifecycle();";
export function mediaTestGroups(policy='full') {
  if(policy==='full')return [
    {id:'canvas-core',script:"await (await import('./canvas-full-video.test.mjs')).testCanvasConcatenationCore();"},
    {id:'canvas-transitions',script:"await (await import('./canvas-transitions.test.mjs')).testCanvasTransitions();"},
    {id:'private-runtime-references',script:PRIVATE_TESTS+" await (await import('./video-reference.test.mjs')).testVideoReferences();"},
  ];
  assert(['canvas-workspace-transitions-v1','canvas-audio-fit-v1'].includes(policy),'Unknown media test policy');
  return [{id:policy,script:(policy==='canvas-workspace-transitions-v1'?"await (await import('./canvas-transitions.test.mjs')).testCanvasTransitions();":"await (await import('./canvas-audio-fit.test.mjs')).testAudioFit();")+' '+PRIVATE_TESTS}];
}
const testCommand=(group,image)=>[...TEST_RUNTIME,image,'node','--input-type=module','-e',group.script];
const inputDigest=sourceFiles=>hash(JSON.stringify(sourceFiles));
export function verifyMediaTestGroups(record,log) {
  assert.equal(record.testExecution,'fixed-groups-v1','Missing fixed media group execution');
  const expected=mediaTestGroups(record.testPolicy||'full');
  assert.deepEqual(record.testGroups?.map(group=>group.id),expected.map(group=>group.id),'Incomplete, repeated or reordered media groups');
  let remaining=String(log);
  for(const [index,group] of record.testGroups.entries()) {
    assert.equal(group.status,'passed','Failed media group');assert.equal(group.image,record.image,'Media group used another image');
    assert.equal(group.sourceDigest,inputDigest(record.sourceFiles),'Media group inputs changed');
    assert.equal(group.commandDigest,hash(JSON.stringify(testCommand(expected[index],record.image))),'Media group command changed');
    assert(Number.isSafeInteger(group.elapsedMs)&&group.elapsedMs>=0,'Missing media group timing');
    assert(/^[a-f0-9]{64}$/.test(group.outputDigest),'Missing media group output');
    const start=JSON.stringify({group:group.id,event:'started'})+'\n',end='\n'+JSON.stringify({group:group.id,event:'passed'})+'\n';
    assert(remaining.startsWith(start),'Missing media group start observation');
    const stop=remaining.indexOf(end,start.length);assert(stop>=start.length,'Missing media group completion observation');
    assert.equal(hash(remaining.slice(start.length,stop)),group.outputDigest,'Media group output changed');
    remaining=remaining.slice(stop+end.length);
  }
  assert.equal(remaining,'','Unexpected media group observations');
  assert.equal(record.testLogDigest,hash(log),'Media group log changed');
}
export function executeMediaTestGroups({policy,image,sourceFiles,mounts,directory,owner=mediaTestOwnerFromEnv(),run=docker,cleanup=name=>execFileSync('docker',['rm','--force',name],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000})}) {
  // A failed/restarted attempt must never leave an old success receipt available.
  for(const file of ['image.json','image.tar','test.log'])fs.rmSync(path.join(directory,file),{force:true});
  const logFile=path.join(directory,'test.log'),groups=[];
  fs.writeFileSync(logFile,'');
  for(const group of mediaTestGroups(policy)) {
    const name=`bitbi-media-test-${process.pid}-${randomUUID()}-${group.id}`,started=Date.now();
    const identity=owner?{owner,pid:process.pid,name,image,group:group.id}:null;
    if(identity)persistMediaTestContainer(directory,identity);
    fs.appendFileSync(logFile,JSON.stringify({group:group.id,event:'started'})+'\n');
    console.log(`Media image test group: ${group.id} (${name})`);
    let output;
    try {
      output=run([...TEST_RUNTIME,'--name',name,...(identity?mediaTestContainerLabels(identity):[]),...mounts,image,'node','--input-type=module','-e',group.script]);
    } catch(error) {
      fs.appendFileSync(logFile,String(error.stdout||'')+String(error.stderr||'')+'\n'+JSON.stringify({group:group.id,event:'failed',code:error.code||null,signal:error.signal||null})+'\n');
      // Killing the Docker CLI on timeout does not stop its container. Remove
      // only this invocation's unique name, retaining the original failure.
      try{cleanup(name);if(identity)clearMediaTestContainer(directory,identity);}catch{fs.appendFileSync(logFile,JSON.stringify({group:group.id,event:'cleanup_failed'})+'\n');}
      throw error;
    }
    if(identity)clearMediaTestContainer(directory,identity);
    fs.appendFileSync(logFile,output+'\n'+JSON.stringify({group:group.id,event:'passed'})+'\n');
    const elapsedMs=Date.now()-started;
    groups.push({id:group.id,status:'passed',image,sourceDigest:inputDigest(sourceFiles),commandDigest:hash(JSON.stringify(testCommand(group,image))),elapsedMs,outputDigest:hash(output)});
    console.log(`Media image test group passed: ${group.id} (${elapsedMs}ms)`);
  }
  return {testExecution:'fixed-groups-v1',testGroups:groups,testLogDigest:hash(fs.readFileSync(logFile))};
}
export function mediaTestMounts(tests=['canvas-transitions.test.mjs','canvas-full-video.test.mjs','canvas-assembly.test.mjs','canvas-creative-trim.test.mjs','canvas-audio-fit.test.mjs','canvas-seams.test.mjs','private-media-runner.test.mjs','video-reference.test.mjs']) {
  const directory=path.resolve('services/homepage-ffmpeg-processor');
  for(const file of tests) {
    assert(/^[a-z0-9-]+\.test\.mjs$/.test(file),'Invalid processor test mount');
    const source=fs.readFileSync(path.join(directory,file),'utf8');
    for(const match of source.matchAll(/\b(?:from\s*|import\s*\()\s*['"]\.\/([^'"]+\.test\.mjs)['"]/g)) {
      assert(tests.includes(match[1]),`Processor test dependency is not mounted: ${file} -> ${match[1]}`);
    }
  }
  return tests.flatMap(file=>['--mount',`type=bind,source=${path.join(directory,file)},target=/app/${file},readonly`]);
}
export function mediaFullTestProof(sourceFiles) {
  return ['two-five-clips','copy-normalize-audio','background-music-decoded','per-clip-audio-decoded','smooth-joins-decoded','audio-fit-decoded','transitions-decoded',
    ...(Object.hasOwn(sourceFiles,'services/homepage-ffmpeg-processor/canvas-assembly.test.mjs')?['assembly-duration-decoded','owned-frame-inspection']:[]),
    'private-drain-poster','container-process-restart','h3-video-reference'];
}
export function mediaImageInputs() {
  const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','services/homepage-ffmpeg-processor','workers/media'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
  const lifecycle='scripts/lib/local-media-test-process.mjs';
  return Object.fromEntries([...new Set([...files,'scripts/private-media-image.mjs',...(fs.existsSync(lifecycle)?[lifecycle]:[]),'tests/fixtures/media/h3-overrun.mp4','workers/auth/src/lib/h3-reference-metadata.js'])].sort().map(file=>[file,hash(fs.readFileSync(file))]));
}
export function verifyMediaImage(record,{sha,run,attempt,archive,base}) {
  assert.equal(record.sha,sha);assert.equal(record.run,run);assert.equal(record.attempt,attempt);
  assert.equal(record.dirty,false,'Local dirty image is not a production candidate');
  assert.deepEqual(record.sourceFiles,mediaImageInputs(),'Media build inputs changed');
  assert.equal(record.platform,'linux/amd64');assert(record.ffmpeg&&record.ffprobe);
  assert(/^sha256:[a-f0-9]{64}$/.test(record.image));assert.equal(record.archiveDigest,hash(fs.readFileSync(archive)));
  if(record.testPolicy==='canvas-workspace-transitions-v1'){
    assert(base&&record.base===base,'Focused image needs the verified release base');
    assert.equal(mediaTestPolicy(base,sha),'canvas-workspace-transitions-v1','Changed media inputs require broader coverage');
    assert.deepEqual(record.tests,['transitions-decoded','private-drain-poster','container-process-restart']);
  }else if(record.testPolicy==='canvas-audio-fit-v1') {
    assert(base&&record.base===base,'Focused image needs the verified release base');
    assert.equal(mediaTestPolicy(base,sha),'canvas-audio-fit-v1','Changed media inputs require broader coverage');
    assert.deepEqual(record.tests,['audio-fit-decoded','private-drain-poster','container-process-restart']);
  }else assert.deepEqual(record.tests,mediaFullTestProof(record.sourceFiles));
  // Older published images predate the assembly fixture and retain their exact
  // original proof contract. New sources cannot downgrade to that old receipt.
  if(Object.hasOwn(record.sourceFiles,'services/homepage-ffmpeg-processor/canvas-assembly.test.mjs')||record.testExecution!==undefined)
    verifyMediaTestGroups(record,fs.readFileSync(path.join(path.dirname(archive),'test.log')));
}
export function mediaTestPolicy(base,sha) {
  assert(/^[a-f0-9]{40}$/.test(base||'')&&/^[a-f0-9]{40}$/.test(sha||''),'Exact image range required');
  execFileSync('git',['merge-base','--is-ancestor',base,sha]);
  const files=execFileSync('git',['diff','--name-only',`${base}...${sha}`],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
  const selected=selectCiTests(files,{canvasRouteSources:canvasCompletionRouteSources(base,sha)});
  return selected.canvasTransitions?'canvas-workspace-transitions-v1':selected.canvasAudioFit?'canvas-audio-fit-v1':'full';
}
export function buildMediaImage() {
  const sha=process.env.GITHUB_SHA||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();assert(/^[a-f0-9]{40}$/.test(sha));
  const base=process.env.CANDIDATE_BASE,testPolicy=base?mediaTestPolicy(base,sha):'full',transitions=testPolicy==='canvas-workspace-transitions-v1',focused=transitions||testPolicy==='canvas-audio-fit-v1';
  const tag=`bitbi-private-media:${sha}`,dir='test-results/private-media-image';fs.mkdirSync(dir,{recursive:true});
  for(const file of ['image.json','image.tar','test.log'])fs.rmSync(path.join(dir,file),{force:true});
  docker(['build','--platform','linux/amd64','--label',`org.opencontainers.image.revision=${sha}`,'-t',tag,'services/homepage-ffmpeg-processor']);
  const image=JSON.parse(docker(['image','inspect',tag]))[0];assert.equal(image.Architecture,'amd64');assert.equal(image.Os,'linux');
  const versions={};for(const bin of ['ffmpeg','ffprobe'])versions[bin]=docker([...TEST_RUNTIME,image.Id,bin,'-version']).split('\n')[0];
  const mounts=mediaTestMounts();
  for(const file of ['workers/auth/src/lib/h3-reference-metadata.js','tests/fixtures/media/h3-overrun.mp4'])mounts.push('--mount',`type=bind,source=${path.resolve(file)},target=/${file},readonly`);
  if(transitions){fs.mkdirSync(`${dir}/transitions`,{recursive:true});mounts.push('--mount',`type=bind,source=${path.resolve(dir,'transitions')},target=/evidence`,'--env','CANVAS_TRANSITION_EVIDENCE_DIR=/evidence');}
  const sourceFiles=mediaImageInputs();
  const execution=executeMediaTestGroups({policy:testPolicy,image:image.Id,sourceFiles,mounts,directory:dir});
  assert.deepEqual(mediaImageInputs(),sourceFiles,'Media sources changed during image acceptance');
  docker(['save','--output',`${dir}/image.tar`,tag]);
  const record={sha,sourceFiles,dirty:Boolean(execFileSync('git',['status','--porcelain','--','services/homepage-ffmpeg-processor','workers/media'],{encoding:'utf8'}).trim()),run:process.env.GITHUB_RUN_ID||'local',attempt:process.env.GITHUB_RUN_ATTEMPT||'local',platform:'linux/amd64',image:image.Id,tag,...versions,...execution,
    base,testPolicy,tests:transitions?['transitions-decoded','private-drain-poster','container-process-restart']:focused?['audio-fit-decoded','private-drain-poster','container-process-restart']:mediaFullTestProof(mediaImageInputs()),archiveDigest:hash(fs.readFileSync(`${dir}/image.tar`))};
  fs.writeFileSync(`${dir}/image.json`,JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify(record));
  return record;
}
if(process.argv[1]===new URL(import.meta.url).pathname) {
  if(process.argv.includes('--if-needed')) {
    const files=execFileSync('git',['diff','--name-only',`${process.env.CANDIDATE_BASE}...${process.env.GITHUB_SHA}`],{encoding:'utf8'}).trim().split('\n');
    const required=requiresPrivateMediaImage(files);
    if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,`required=${required}\n`);
    if(required)buildMediaImage();
  } else buildMediaImage();
}
