import { repairDelta, repairKind, verifyRepairSource } from './media-repair-source.mjs';
import { BROWSER_REPAIR_ACCEPTANCE, verifyBrowserRepairProof } from './browser-fixture-repair.mjs';
// Read-only GitHub provenance and archive verification shared by preparation
// and the immediately-before-upload boundary. No local JSON grants CI trust.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {api,collection,sourceAttempt,gitSelection,isRequiredValidationRun,validateSource,verifyManifest,verifyProofs,proofJobs,tree,REPOSITORY} from '../pages-candidate.mjs';
import {hash,readJson,verifyFrontend} from './frontend-hosting.mjs';

export function sourceExpectation(preview, env=process.env) {
  assert.equal(env.GITHUB_REPOSITORY,REPOSITORY,'Explicit own repository required');
  for(const key of ['GITHUB_SHA','CANDIDATE_BASE'])assert(/^[a-f0-9]{40}$/.test(env[key]||''),`Missing exact ${key}`);
  for(const key of ['CANDIDATE_RUN','CANDIDATE_ATTEMPT'])assert(/^[1-9][0-9]*$/.test(env[key]||''),`Missing exact ${key}`);
  const branch=preview?env.CANDIDATE_BRANCH:'main';assert(branch,'Explicit preview branch required');
  execFileSync('git',['check-ref-format',`refs/heads/${branch}`],{stdio:'pipe'});
  assert.equal(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),env.GITHUB_SHA,'Checkout is not source SHA');
  execFileSync('git',['diff','--quiet','HEAD','--'],{stdio:'pipe'});
  if(env.REPAIR_SOURCE_SHA){assert(!preview);repairDelta(env.REPAIR_SOURCE_SHA,env.GITHUB_SHA,env.CANDIDATE_BASE);}
  return {repository:REPOSITORY,sha:env.REPAIR_SOURCE_SHA||env.GITHUB_SHA,...(env.REPAIR_SOURCE_SHA?{publicationSha:env.GITHUB_SHA}:{}),base:env.CANDIDATE_BASE,run:env.CANDIDATE_RUN,attempt:env.CANDIDATE_ATTEMPT,currentRun:env.GITHUB_RUN_ID,branch,selection:gitSelection(env.CANDIDATE_BASE,env.REPAIR_SOURCE_SHA||env.GITHUB_SHA)};
}
export async function sourceArchives(preview, env=process.env) {
  const e=sourceExpectation(preview,env);
  const kind=env.REPAIR_SOURCE_SHA&&repairKind(repairDelta(env.REPAIR_SOURCE_SHA,env.GITHUB_SHA,env.CANDIDATE_BASE));
  const browserRepair=['browser-fixture','browser-publication'].includes(kind),completedBrowser=kind==='browser-publication';
  const preparation=browserRepair&&!completedBrowser&&['release-compatibility','browser-validation'].includes(env.GITHUB_JOB);
  const repairSource=env.REPAIR_SOURCE_SHA?await verifyRepairSource(env,{complete:env.GITHUB_JOB==='deploy'}):null;
  const [run,jobs,artifacts,laterRuns,ref]=await Promise.all([
    sourceAttempt(e.run,e.attempt,e.selection),collection(`actions/runs/${e.run}/attempts/${e.attempt}/jobs`,'jobs'),
    collection(`actions/runs/${e.run}/artifacts`,'artifacts'),collection(`actions/runs?head_sha=${e.sha}`,'workflow_runs'),
    api(`git/ref/heads/${e.branch.split('/').map(encodeURIComponent).join('/')}`),
  ]);
  const relevant=laterRuns.filter(r=>isRequiredValidationRun(r,e.selection));
  for(const later of relevant.filter(r=>String(r.id)!==String(e.currentRun)&&Date.parse(r.created_at)>Date.parse(run.created_at)&&r.conclusion!=='success'))later.jobs=await collection(`actions/runs/${later.id}/attempts/${later.run_attempt}/jobs`,'jobs');
  const currentPublication=!preview && env.GITHUB_ACTIONS==='true' && env.GITHUB_JOB==='deploy' && env.GITHUB_REF==='refs/heads/main' && e.run===env.GITHUB_RUN_ID;
  const selected=validateSource({run,jobs,artifacts,laterRuns:relevant,mainSha:ref.object.sha},e,{previewBranch:preview?e.branch:undefined,currentPublication,mediaRepair:Boolean(env.REPAIR_SOURCE_SHA),browserRepair});
  if(completedBrowser) {
    assert(repairSource.completedBrowserArtifact,'Missing authenticated completed browser acceptance');
    selected.push(repairSource.completedBrowserArtifact);
  } else if(browserRepair&&!preparation) {
    assert.equal(env.GITHUB_JOB,'deploy','Composite repair source is publication-only');
    const fresh=await collection(`actions/runs/${env.GITHUB_RUN_ID}/artifacts`,'artifacts');
    const name=`pages-proof-browser-validation-${env.GITHUB_SHA}-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`;
    const found=fresh.filter(a=>a.name===name);assert.equal(found.length,1,'Missing/ambiguous current repaired browser proof');
    const a=found[0];assert.equal(a.expired,false);assert(a.size_in_bytes>0);assert(/^sha256:[a-f0-9]{64}$/.test(a.digest));
    assert.equal(a.workflow_run?.id,Number(env.GITHUB_RUN_ID));assert.equal(a.workflow_run?.head_sha,env.GITHUB_SHA);
    selected.push(a);
  }
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-source-'));
  const unpack=path.join(temporary,'package');fs.mkdirSync(unpack);
  try {
    for(const artifact of selected) {
      assert(Date.parse(artifact.expires_at)>Date.now(),'Expired/undated source archive');
      const response=await fetch(`https://api.github.com/repos/${REPOSITORY}/actions/artifacts/${artifact.id}/zip`,{headers:{Authorization:`Bearer ${env.GH_TOKEN}`},signal:AbortSignal.timeout(30000)});
      assert(response.ok,'Cannot download exact source archive');const bytes=Buffer.from(await response.arrayBuffer());
      assert.equal(`sha256:${hash(bytes)}`,artifact.digest,'Source artifact digest mismatch');
      const file=path.join(temporary,`${artifact.id}.zip`);fs.writeFileSync(file,bytes);
      // Reject path escapes, symlinks/devices, duplicate files and oversized
      // expansion BEFORE extracting. Standard-library ZIP, no new dependency.
      execFileSync('python3',['-I','-c',`import sys,zipfile,pathlib,stat
root=pathlib.Path(sys.argv[2])
with zipfile.ZipFile(sys.argv[1]) as z:
 entries=z.infolist()
 assert len(entries)<=21000 and sum(e.file_size for e in entries)<=512*1024*1024
 for e in entries:
  p=pathlib.PurePosixPath(e.filename);mode=(e.external_attr>>16)&0xffff
  assert not p.is_absolute() and '..' not in p.parts and '\\\\' not in e.filename
  assert stat.S_IFMT(mode) in (0,stat.S_IFREG,stat.S_IFDIR) and e.file_size<=25*1024*1024
  target=root.joinpath(*p.parts)
  if e.is_dir():target.mkdir(parents=True,exist_ok=True)
  else:
   target.parent.mkdir(parents=True,exist_ok=True)
   with target.open('xb') as f:f.write(z.read(e))
`,file,unpack],{stdio:'pipe',timeout:30000});
    }
    return {expected:e,selected,temporary,unpack,browserRepair,preparation,completedBrowser};
  }catch(error){fs.rmSync(temporary,{recursive:true,force:true});throw error;}
}
export async function verifyUploadSource({preview=false,download=false}={}) {
  if(!download)verifyFrontend(readJson('candidate/manifest.json'),tree);
  const source=await sourceArchives(preview);
  try {
    if(download){assert(!fs.existsSync('candidate'),'Refuse to overwrite candidate');fs.cpSync(source.unpack,'candidate',{recursive:true});}
    assert.deepEqual(tree('candidate'),tree(source.unpack),'Local package/proofs differ from authenticated CI archives');
    const manifest=readJson('candidate/manifest.json');
    verifyManifest(manifest,source.expected,'candidate/site');verifyFrontend(manifest,tree);
    const proofs=fs.readdirSync('candidate').filter(f=>/^proof-.*\.json$/.test(f)).map(f=>readJson(`candidate/${f}`));
    if(source.preparation) {
      assert(download,'Partial browser evidence is download preparation only, never upload authorization');
      verifyPreparedBrowserProofs(manifest,proofs);
    } else {
      verifyProofs(manifest,proofs);
      if(source.browserRepair)verifyBrowserRepairProof(proofs.find(p=>p.job==='browser-validation'),manifest,source.completedBrowser?BROWSER_REPAIR_ACCEPTANCE:{publicationSha:process.env.GITHUB_SHA,run:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT});
    }
    assert.equal((await api(`git/ref/heads/${source.expected.branch.split('/').map(encodeURIComponent).join('/')}`)).object.sha,source.expected.publicationSha||source.expected.sha,'Branch advanced during archive verification');
    assert.deepEqual(sourceExpectation(preview),source.expected,'Local source changed during verification');
    return {manifest,proofs,source:{scope:preview?'preview':'production',branch:source.expected.branch,sha:manifest.sha,run:manifest.run,attempt:manifest.attempt,artifacts:source.selected.map(({id,digest})=>({id,digest}))}};
  }finally{fs.rmSync(source.temporary,{recursive:true,force:true});}
}
// Preparation preserves selected independent evidence but never grants upload
// acceptance for the failed browser command. Unselected jobs need no fake proof.
export function verifyPreparedBrowserProofs(manifest,proofs) {
  assert(!proofs.some(p=>p.job==='browser-validation'),'Unexpected original browser proof');
  for(const job of [...proofJobs(manifest.selection).filter(job=>job!=='browser-validation'),...(manifest.hosting?['frontend-runtime']:[])]) {
    const p=proofs.filter(p=>p.job===job);assert.equal(p.length,1,`Missing original ${job} proof`);
    assert.equal(p[0].status,'passed');assert.equal(p[0].manifestHash,hash(JSON.stringify(manifest)));assert(p[0].tests>0&&p[0].reportHash);
  }
}
