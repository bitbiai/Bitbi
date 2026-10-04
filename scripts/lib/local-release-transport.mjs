import {smoothProfile,isSmoothContinuation,verifySmoothImageReuse} from './local-release-browser.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { sha256, LOCAL_POLICY } from './local-release-plan.mjs';
import { verifyLocalEvidence, rebindLocalCandidate } from './local-release-evidence.mjs';
import { REPOSITORY, tree } from '../pages-candidate.mjs';
import { verifyMediaImage } from '../private-media-image.mjs';
import { requiresPrivateMediaImage } from './ci-test-selection.mjs';

const TASK = 'bitbi-local-validation';
const ACCOUNT = 'bitbiai';
const headers = (token, accept = 'application/vnd.github+json') => ({ Authorization: `Bearer ${token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' });
async function request(endpoint, token, body) {
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/${endpoint}`, { method: body ? 'POST' : 'GET', headers: { ...headers(token), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
  assert(response.ok, `Local evidence GitHub ${endpoint.split('?')[0]} returned ${response.status}`);
  return response.json();
}
export function validateLocator(record, expected) {
  assert.equal(record.repository_url, `https://api.github.com/repos/${REPOSITORY}`);
  assert.equal(record.task, TASK); assert.equal(record.environment, TASK);
  assert.equal(record.production_environment, false);
  assert.equal(record.creator?.login, ACCOUNT, 'Local evidence requires the authorized repository owner');
  const locator = record.payload?.localValidation;
  assert.equal(locator?.policy, LOCAL_POLICY);
  for (const key of ['sha','base']) assert.equal(locator[key], expected[key]);
  assert(Number.isSafeInteger(locator.asset) && locator.asset > 0);
  assert(Number.isSafeInteger(locator.release) && locator.release > 0);
  assert.match(locator.digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(locator.name, `bitbi-local-${expected.sha}-${locator.digest.slice(7,23)}.zip`);
  return locator;
}
export function extractEvidence(archive, destination) {
  // Same fail-closed archive boundary as frontend-source; larger individual
  // files are allowed only for the already tested Linux media image archive.
  execFileSync('python3', ['-I','-c', `import sys,zipfile,pathlib,stat
root=pathlib.Path(sys.argv[2])
with zipfile.ZipFile(sys.argv[1]) as z:
 entries=z.infolist()
 assert len(entries)<=30000 and sum(e.file_size for e in entries)<=3*1024**3
 for e in entries:
  p=pathlib.PurePosixPath(e.filename);mode=(e.external_attr>>16)&0xffff
  assert not p.is_absolute() and '..' not in p.parts and '\\\\' not in e.filename
  assert stat.S_IFMT(mode) in (0,stat.S_IFREG,stat.S_IFDIR)
  assert e.file_size<=(2*1024**3 if e.filename=='test-results/private-media-image/image.tar' else 64*1024**2)
  target=root.joinpath(*p.parts)
  if e.is_dir():target.mkdir(parents=True,exist_ok=True)
  else:
   target.parent.mkdir(parents=True,exist_ok=True)
   with target.open('xb') as f:
    with z.open(e) as source:
     import shutil
     shutil.copyfileobj(source,f)
`, archive, destination], { stdio: 'pipe', timeout: 180000 });
}
export async function uploadLocalEvidence(directory, { token = process.env.GH_TOKEN || execFileSync('gh',['auth','token'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim() } = {}) {
  const bundle = path.join(directory, 'bundle'), evidence = JSON.parse(fs.readFileSync(path.join(bundle,'evidence.json')));
  verifyLocalEvidence(bundle, evidence);
  const remote = await request('git/ref/heads/main',token);
  execFileSync('git',['merge-base','--is-ancestor',remote.object.sha,evidence.sha],{stdio:'pipe'});
  const zip = path.join(directory,'evidence.zip');
  execFileSync('python3',['-I','-c',`import sys,pathlib,zipfile
root=pathlib.Path(sys.argv[1])
with zipfile.ZipFile(sys.argv[2],'w',compression=zipfile.ZIP_DEFLATED,compresslevel=1) as z:
 for p in sorted(root.rglob('*')):
  assert not p.is_symlink()
  if p.is_file():z.write(p,p.relative_to(root).as_posix())
`,bundle,zip],{stdio:'pipe',timeout:180000});
  const bytes = fs.readFileSync(zip), digest = `sha256:${sha256(bytes)}`, name = `bitbi-local-${evidence.sha}-${digest.slice(7,23)}.zip`;
  assert(bytes.length < 2 * 1024 ** 3, 'GitHub asset size boundary exceeded');
  // An unpublished draft is transport only: no public release event, tag push,
  // additional Full run, new secret or production environment write.
  const tag = `local-validation-${evidence.sha}-${digest.slice(7,23)}`;
  fs.writeFileSync(path.join(directory,'transport-intent.json'),JSON.stringify({sha:evidence.sha,digest,tag,name})+'\n');
  const drafts=(await request('releases?per_page=100',token)).filter(item=>item.tag_name===tag);
  assert(drafts.length<=1,'Ambiguous transport draft');
  const release = drafts[0] || await request('releases',token,{ tag_name:tag, target_commitish:remote.object.sha,
    name:`Local validation ${evidence.sha.slice(0,12)}`,body:'Private transport for the existing protected static workflow. Do not publish this draft.',draft:true,prerelease:true });
  assert.equal(release.draft,true);assert.equal(release.author?.login,ACCOUNT);
  const assets=(await request(`releases/${release.id}/assets?per_page=100`,token)).filter(item=>item.name===name);
  assert(assets.length<=1,'Ambiguous transport asset');
  let asset=assets[0];
  if(!asset) {
    const uploaded=await fetch(`https://uploads.github.com/repos/${REPOSITORY}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`,{
      method:'POST',headers:{...headers(token),'Content-Type':'application/zip'},body:bytes,signal:AbortSignal.timeout(300000)});
    assert(uploaded.ok,`Local evidence upload failed (${uploaded.status}); preserve draft ${release.id} for reconciliation`);
    asset=await uploaded.json();
  }
  assert.equal(asset.state,'uploaded','Unresolved prior upload; do not replay');
  assert.equal(asset.digest,digest); assert.equal(asset.uploader?.login,ACCOUNT);
  const locator = { policy:LOCAL_POLICY, sha:evidence.sha, base:evidence.base, release:release.id, asset:asset.id, name, digest };
  const previous=(await request(`deployments?environment=${TASK}&task=${TASK}&per_page=100`,token)).filter(item=>item.payload?.localValidation?.digest===digest);
  assert(previous.length<=1,'Ambiguous transport receipt');
  const record = previous[0] || await request('deployments',token,{ ref:remote.object.sha, task:TASK, environment:TASK,
    auto_merge:false,required_contexts:[],production_environment:false,transient_environment:true,
    description:'Evidence transport only; no production activation',payload:{localValidation:locator} });
  validateLocator(record,evidence);
  fs.writeFileSync(path.join(directory,'transport.json'),JSON.stringify({receipt:record.id,...locator},null,2)+'\n');
  return { receipt:record.id, ...locator };
}
export function stageImportedCandidate(unpack,verified,rebound,transport,{destination='candidate'}={}) {
  assert(!fs.existsSync(destination),'Refuse to replace existing candidate');
  fs.cpSync(path.join(unpack,'candidate'),destination,{recursive:true});
  const records=path.join(destination,'test-results/local-validation');
  fs.mkdirSync(records,{recursive:true});
  // Evidence metadata belongs to the established report boundary. Its file/hash
  // maps are not product source; candidate/site remains subject to the secret scan.
  fs.cpSync(unpack,records,{recursive:true,filter:file=>file!==path.join(unpack,'test-results/private-media-image/image.tar')});
  fs.writeFileSync(path.join(destination,'manifest.json'),JSON.stringify(rebound.manifest));
  for(const proof of rebound.proofs)fs.writeFileSync(path.join(destination,`proof-${proof.job}.json`),JSON.stringify(proof));
  fs.writeFileSync(path.join(records,'transport.json'),JSON.stringify(transport));
  assert.deepEqual(tree(path.join(destination,'site')),verified.manifest.files);
}
export async function importLocalEvidence(expected, { token = process.env.GH_TOKEN, receipt, run = process.env.GITHUB_RUN_ID, attempt = process.env.GITHUB_RUN_ATTEMPT } = {}) {
  assert(token,'Missing existing GitHub import token');
  let record;
  if (receipt) record = await request(`deployments/${receipt}`,token);
  else {
    const records = await request(`deployments?environment=${TASK}&task=${TASK}&per_page=100`,token);
    const matches = records.filter(item => item.payload?.localValidation?.sha === expected.sha);
    assert(matches.length > 0, 'Missing local release evidence. Run the local release entrypoint before pushing; hosted tests are not a fallback.');
    record = matches[0];
  }
  const locator = validateLocator(record,expected);
  const asset = await request(`releases/assets/${locator.asset}`,token);
  assert.equal(asset.name,locator.name); assert.equal(asset.digest,locator.digest); assert.equal(asset.state,'uploaded');
  assert.equal(asset.uploader?.login,ACCOUNT); assert(asset.size > 0 && asset.size < 2 * 1024 ** 3);
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/releases/assets/${locator.asset}`,{headers:headers(token,'application/octet-stream'),signal:AbortSignal.timeout(300000)});
  assert(response.ok, `Cannot read local evidence asset (${response.status}); no test fallback`);
  const bytes = Buffer.from(await response.arrayBuffer()); assert.equal(`sha256:${sha256(bytes)}`,locator.digest);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-local-evidence-'));
  try {
    const archive=path.join(temporary,'evidence.zip'), unpack=path.join(temporary,'unpack');fs.writeFileSync(archive,bytes);fs.mkdirSync(unpack);
    extractEvidence(archive,unpack);
    const verified=verifyLocalEvidence(unpack,expected), rebound=rebindLocalCandidate(verified,{run,attempt,receipt:record.id});
    const media=requiresPrivateMediaImage(verified.evidence.selection.files);
    if(media) {
      const mediaDir=path.join(unpack,'test-results/private-media-image');
      const original=JSON.parse(fs.readFileSync(path.join(mediaDir,'image.json')));
      const retained=isSmoothContinuation(verified.evidence.permissionContinuation?.source);
      if(retained)verifySmoothImageReuse(original,expected.sha);
      verifyMediaImage(original,{base:expected.base,sha:retained?original.sha:expected.sha,run:retained?smoothProfile(verified.evidence.permissionContinuation.source).run:verified.evidence.id,attempt:'1',archive:path.join(mediaDir,'image.tar')});
      fs.mkdirSync('test-results',{recursive:true});fs.cpSync(mediaDir,'test-results/private-media-image',{recursive:true});
      fs.writeFileSync('test-results/private-media-image/image.json',JSON.stringify({...original,run:String(run),attempt:String(attempt),
        localValidation:{policy:LOCAL_POLICY,...(retained?{publicationSha:expected.sha}:{}),run:original.run,attempt:original.attempt,evidence:verified.digest,recordHash:sha256(JSON.stringify(original))}}));
    }
    // Retain the original immutable local report and proof identities, not an
    // invented GitHub execution result. The Actions envelope identifies import.
    stageImportedCandidate(unpack,verified,rebound,{receipt:record.id,...locator});
    if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,`media_image=${media}\n`);
    return { receipt:record.id,manifest:rebound.manifest };
  } finally { fs.rmSync(temporary,{recursive:true,force:true}); }
}
