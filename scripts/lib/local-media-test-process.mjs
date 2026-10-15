import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';

export const MEDIA_IMAGE_STEP_TIMEOUT_MS=1200000;
const UUID='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const GROUPS=['canvas-core','canvas-transitions','private-runtime-references','canvas-workspace-transitions-v1','canvas-audio-fit-v1'];
const activeFile=directory=>path.join(directory,'active-container.json');
const exactKeys=(value,keys)=>assert.deepEqual(Object.keys(value||{}).sort(),keys.sort(),'Malformed media test identity');
export function validateMediaTestOwner(owner) {
  exactKeys(owner,['version','nonce','sha','run','attempt']);assert.equal(owner.version,1);
  assert(new RegExp(`^${UUID}$`).test(owner.nonce),'Malformed media test owner');
  assert(/^[a-f0-9]{40}$/.test(owner.sha),'Malformed media source');
  for(const field of ['run','attempt'])assert(typeof owner[field]==='string'&&/^[a-zA-Z0-9_.-]{1,160}$/.test(owner[field]),'Malformed media run scope');
  return owner;
}
export function mediaTestOwnerFromEnv(env=process.env) {
  return env.BITBI_MEDIA_TEST_OWNER===undefined?undefined:validateMediaTestOwner(JSON.parse(env.BITBI_MEDIA_TEST_OWNER));
}
function validateIdentity(identity,{owner,pid}) {
  exactKeys(identity,['owner','pid','name','image','group']);validateMediaTestOwner(identity.owner);
  assert.deepEqual(identity.owner,owner,'Foreign media test owner');assert.equal(identity.pid,pid,'Foreign media test process');
  assert(Number.isSafeInteger(pid)&&pid>0,'Malformed media process');assert(GROUPS.includes(identity.group),'Unknown media test group');
  assert(new RegExp(`^bitbi-media-test-${pid}-${UUID}-${identity.group}$`).test(identity.name),'Malformed media container name');
  assert(/^sha256:[a-f0-9]{64}$/.test(identity.image),'Malformed media image');return identity;
}
function readIdentity(directory,expected) {
  const file=activeFile(directory),stat=fs.lstatSync(file,{throwIfNoEntry:false});if(!stat)return null;
  assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<4096,'Unsafe media test identity file');
  return validateIdentity(JSON.parse(fs.readFileSync(file,'utf8')),expected);
}
export function mediaTestContainerLabels(identity) {
  return Object.entries({owner:identity.owner.nonce,sha:identity.owner.sha,run:identity.owner.run,attempt:identity.owner.attempt,pid:String(identity.pid),group:identity.group})
    .flatMap(([key,value])=>['--label',`ai.bitbi.media-test.${key}=${value}`]);
}
export function persistMediaTestContainer(directory,identity) {
  validateIdentity(identity,{owner:identity.owner,pid:identity.pid});assert(!fs.existsSync(activeFile(directory)),'Previous media test container requires reconciliation');
  const temporary=activeFile(directory)+`.${identity.pid}.tmp`;
  fs.writeFileSync(temporary,JSON.stringify(identity),{mode:0o600,flag:'wx'});fs.renameSync(temporary,activeFile(directory));
}
export function clearMediaTestContainer(directory,identity) {
  assert.deepEqual(readIdentity(directory,{owner:identity.owner,pid:identity.pid}),identity,'Media test identity changed during cleanup');
  fs.unlinkSync(activeFile(directory));
}
const docker=args=>execFileSync('docker',['--context','colima-bitbi-release',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000,maxBuffer:4*1024*1024});
export function cleanupMediaTestContainer({directory,owner,pid},command=docker) {
  validateMediaTestOwner(owner);const identity=readIdentity(directory,{owner,pid});if(!identity)return {active:false};
  let inspected;
  try{inspected=JSON.parse(command(['container','inspect',identity.name]));}
  catch(error){
    // An already auto-removed container is a confirmed absence only when Docker
    // names this exact object. Connection/permission/malformed replies fail closed.
    const message=String(error.stderr||'').trim();
    if(error.status!==1||!['Error response from daemon: No such container: ','Error: No such container: '].some(prefix=>message===prefix+identity.name))throw error;
    clearMediaTestContainer(directory,identity);return {active:false,name:identity.name};
  }
  assert(Array.isArray(inspected)&&inspected.length===1,'Ambiguous media test container');const actual=inspected[0];
  assert.equal(actual.Name,'/'+identity.name,'Foreign Docker container name');assert.equal(actual.Config?.Image,identity.image,'Foreign Docker media image');
  const labels=mediaTestContainerLabels(identity).filter((_,index)=>index%2===1);
  for(const label of labels){const split=label.indexOf('=');assert.equal(actual.Config?.Labels?.[label.slice(0,split)],label.slice(split+1),'Foreign Docker media ownership');}
  command(['rm','--force',identity.name]);clearMediaTestContainer(directory,identity);return {active:true,name:identity.name};
}
export function removeMediaSuccessArtifacts(directory) {
  for(const file of ['image.json','image.tar'])fs.rmSync(path.join(directory,file),{force:true});
}
const DIAGNOSTIC_FILES=['test.log','active-container.json'];
export function captureMediaTestDiagnostics(cwd,root,failed) {
  const source=path.join(cwd,'test-results/private-media-image');if(!fs.existsSync(source))return null;
  // The Linux snapshot replaces source/test-results. Keep the current host
  // identity outside that tree, including when Docker itself rejects cleanup.
  const directory=fs.mkdtempSync(path.join(root,'media-image-diagnostics-')),files=[];
  for(const file of DIAGNOSTIC_FILES) {
    const entry=path.join(source,file),stat=fs.lstatSync(entry,{throwIfNoEntry:false});if(!stat)continue;
    assert(stat.isFile()&&!stat.isSymbolicLink(),'Unsafe media diagnostic');fs.copyFileSync(entry,path.join(directory,file));files.push(file);
  }
  fs.writeFileSync(path.join(directory,'state.json'),JSON.stringify({failed,files}));return {directory,failed,files};
}
export function restoreMediaTestDiagnostics(capture,cwd) {
  if(!capture)return;const target=path.join(cwd,'test-results/private-media-image');fs.mkdirSync(target,{recursive:true});
  for(const file of DIAGNOSTIC_FILES) {
    fs.rmSync(path.join(target,file),{force:true});if(capture.files.includes(file))fs.copyFileSync(path.join(capture.directory,file),path.join(target,file));
  }
  if(capture.failed)removeMediaSuccessArtifacts(target);
}
export async function runMediaImageStep(options,{diagnosticsRoot,onDiagnostics,copyToWorkspace,...controls}) {
  let result,failure;
  try{result=await runMediaImageChild(options,controls);}catch(error){failure=error;}
  const capture=captureMediaTestDiagnostics(options.cwd,diagnosticsRoot,Boolean(failure||result?.status!==0));onDiagnostics(capture);
  try{copyToWorkspace();}catch(error){failure ||= error;}
  if(failure)throw failure;return result;
}
export async function runMediaImageChild({cwd,env,stdio,sha,run,attempt,command=process.execPath,args=['scripts/private-media-image.mjs','--if-needed'],timeout=MEDIA_IMAGE_STEP_TIMEOUT_MS},{cleanup=cleanupMediaTestContainer,signals=process}={}) {
  const owner=validateMediaTestOwner({version:1,nonce:randomUUID(),sha,run,attempt});
  const directory=path.join(cwd,'test-results/private-media-image');fs.mkdirSync(directory,{recursive:true});removeMediaSuccessArtifacts(directory);
  assert(!fs.existsSync(activeFile(directory)),'Previous media test container requires reconciliation before another invocation');
  let child,timer,interrupted=null,result;
  const terminate=signal=>{
    interrupted ||= signal;
    if(child?.pid){try{process.kill(-child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}}
  };
  const onInterrupt=()=>terminate('SIGINT'),onTerminate=()=>terminate('SIGTERM');
  try {
    child=spawn(command,args,{cwd,env:{...env,BITBI_MEDIA_TEST_OWNER:JSON.stringify(owner)},stdio,detached:true});
    signals.on('SIGINT',onInterrupt);signals.on('SIGTERM',onTerminate);
    timer=setTimeout(()=>terminate('ETIMEDOUT'),timeout);
    result=await new Promise(resolve=>{
      child.once('error',error=>resolve({status:null,signal:null,error}));
      child.once('close',(status,signal)=>resolve({status,signal}));
    });
    if(interrupted)result={status:null,signal:interrupted==='ETIMEDOUT'?result.signal:interrupted,error:Object.assign(Error('Media image child interrupted'),{code:interrupted})};
    return result;
  } finally {
    clearTimeout(timer);signals.off('SIGINT',onInterrupt);signals.off('SIGTERM',onTerminate);
    const failed=!result||result.status!==0||result.error||interrupted;
    if(failed)removeMediaSuccessArtifacts(directory);
    if(fs.existsSync(activeFile(directory))) {
      removeMediaSuccessArtifacts(directory);
      cleanup({directory,owner,pid:child?.pid});
      assert(failed,'Successful media child left an active test container');
    }
  }
}
