import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {hash} from './lib/frontend-hosting.mjs';
import {requiresPrivateMediaImage} from './lib/ci-test-selection.mjs';
const docker=args=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:600000,maxBuffer:8*1024*1024});
export function mediaImageInputs() {
  const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','services/homepage-ffmpeg-processor','workers/media'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
  return Object.fromEntries([...new Set(files)].sort().map(file=>[file,hash(fs.readFileSync(file))]));
}
export function verifyMediaImage(record,{sha,run,attempt,archive}) {
  assert.equal(record.sha,sha);assert.equal(record.run,run);assert.equal(record.attempt,attempt);
  assert.equal(record.dirty,false,'Local dirty image is not a production candidate');
  assert.deepEqual(record.sourceFiles,mediaImageInputs(),'Media build inputs changed');
  assert.equal(record.platform,'linux/amd64');assert(record.ffmpeg&&record.ffprobe);
  assert(/^sha256:[a-f0-9]{64}$/.test(record.image));assert.equal(record.archiveDigest,hash(fs.readFileSync(archive)));
  assert.deepEqual(record.tests,['two-five-clips','copy-normalize-audio','private-drain-poster','container-process-restart']);
}
export function buildMediaImage() {
  const sha=process.env.GITHUB_SHA||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();assert(/^[a-f0-9]{40}$/.test(sha));
  const tag=`bitbi-private-media:${sha}`,dir='test-results/private-media-image';fs.mkdirSync(dir,{recursive:true});
  docker(['build','--platform','linux/amd64','--label',`org.opencontainers.image.revision=${sha}`,'-t',tag,'services/homepage-ffmpeg-processor']);
  const image=JSON.parse(docker(['image','inspect',tag]))[0];assert.equal(image.Architecture,'amd64');assert.equal(image.Os,'linux');
  const command=['run','--rm','--network','none','--env','MEMBER_GENERATION_POSTERS_ONLY=1','--platform','linux/amd64','--read-only','--cpus','1','--memory','6g','--tmpfs','/tmp:rw,size=2g'];
  const versions={};for(const bin of ['ffmpeg','ffprobe'])versions[bin]=docker([...command,tag,bin,'-version']).split('\n')[0];
  const tests=['canvas-full-video.test.mjs','private-media-runner.test.mjs'];
  const mounts=tests.flatMap(file=>['--mount',`type=bind,source=${path.resolve('services/homepage-ffmpeg-processor',file)},target=/app/${file},readonly`]);
  const output=docker([...command,...mounts,tag,'node','--input-type=module','-e',"await (await import('./canvas-full-video.test.mjs')).testCanvasConcatenation(); await (await import('./private-media-runner.test.mjs')).testPrivateMediaRunner(); await (await import('./private-media-runner.test.mjs')).testContainerLifecycle();"]);
  fs.writeFileSync(`${dir}/test.log`,output);docker(['save','--output',`${dir}/image.tar`,tag]);
  const record={sha,sourceFiles:mediaImageInputs(),dirty:Boolean(execFileSync('git',['status','--porcelain','--','services/homepage-ffmpeg-processor','workers/media'],{encoding:'utf8'}).trim()),run:process.env.GITHUB_RUN_ID||'local',attempt:process.env.GITHUB_RUN_ATTEMPT||'local',platform:'linux/amd64',image:image.Id,tag,...versions,
    tests:['two-five-clips','copy-normalize-audio','private-drain-poster','container-process-restart'],archiveDigest:hash(fs.readFileSync(`${dir}/image.tar`))};
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
