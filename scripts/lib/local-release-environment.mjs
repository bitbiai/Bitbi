import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

export const PROFILE = 'bitbi-release';
export const CONTEXT = `colima-${PROFILE}`;
export const PACKAGES = ['', 'workers/contact', 'workers/auth', 'workers/ai', 'workers/media'];
export const TOOL_PREFLIGHT='for tool in zip unzip python3 git curl ffmpeg ffprobe; do command -v "$tool" >/dev/null; done';
export const cacheRoot = () => path.join(os.homedir(), 'Library/Caches/bitbi-local-release');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const require=createRequire(import.meta.url);
const parseYaml=source=>require('../../node_modules/playwright-core/lib/utilsBundle.js').yaml.parse(source);

const GiB=1024 ** 3;
const RESOURCE_PROFILES={
  'compact-16g-v1':{name:'compact-16g-v1',minimumHostGiB:16,vm:{cpus:4,memoryGiB:4,diskGiB:80},container:{cpus:4,memoryGiB:3,shmGiB:1}},
  'standard-24g-v1':{name:'standard-24g-v1',minimumHostGiB:24,vm:{cpus:6,memoryGiB:12,diskGiB:80},container:{cpus:4,memoryGiB:10,shmGiB:1}},
};
export function resourceProfile(hostMemoryBytes=os.totalmem()) {
  assert(Number.isSafeInteger(hostMemoryBytes)&&hostMemoryBytes>=16*GiB,'Local release requires at least 16 GiB host RAM');
  return structuredClone(RESOURCE_PROFILES[hostMemoryBytes<24*GiB?'compact-16g-v1':'standard-24g-v1']);
}
export function verifyVmResources(resources,configuration,actual) {
  assert.deepEqual(resources,RESOURCE_PROFILES[resources?.name],'Unknown local release resource profile');
  for(const [field,value] of Object.entries({cpu:resources.vm.cpus,memory:resources.vm.memoryGiB,disk:resources.vm.diskGiB}))
    assert.equal(configuration?.[field],value,`Release VM ${field} conflicts with ${resources.name}; stop and explicitly reconfigure only ${PROFILE}`);
  assert.equal(actual?.cpus,resources.vm.cpus,'Running release VM CPU allocation differs from the selected profile');
  // Linux reserves some guest RAM for its kernel; validate observed capacity,
  // not an impossible equality between MemTotal and the configured VM size.
  assert(Number.isSafeInteger(actual?.memoryBytes)&&actual.memoryBytes>=(resources.vm.memoryGiB-0.5)*GiB&&actual.memoryBytes<=resources.vm.memoryGiB*GiB,
    'Running release VM memory differs from the selected profile');
}
export function verifyContainerResources(resources,actual) {
  assert.deepEqual(resources,RESOURCE_PROFILES[resources?.name],'Unknown local release resource profile');
  assert.deepEqual(actual,{cpus:resources.container.cpus,memoryBytes:resources.container.memoryGiB*GiB,shmBytes:resources.container.shmGiB*GiB},
    'Running test container limits differ from the selected resource profile');
}
export function verifyResourceEvidence(environment,{requireContainer=true}={}) {
  const {resources,resourceObservation:observed}=environment;
  assert(Number.isSafeInteger(observed?.hostMemoryBytes),'Missing observed host memory');
  assert.deepEqual(resources,resourceProfile(observed?.hostMemoryBytes),'Resource profile differs from the observed host capacity');
  verifyVmResources(resources,observed.vm.configuration,observed.vm.actual);
  if(requireContainer)verifyContainerResources(resources,observed.container);
}
export function verifyResourceSelection(resources,privateMediaImageRequired) {
  assert.deepEqual(resources,RESOURCE_PROFILES[resources?.name],'Unknown local release resource profile');
  assert.equal(typeof privateMediaImageRequired,'boolean','Missing private media image selection');
  assert(resources.name!=='compact-16g-v1'||!privateMediaImageRequired,
    'Compact 16 GiB hosts are not qualified for selected private AMD64 media-image acceptance; use a qualified standard host. No selected test was skipped.');
}
export function toolchainPins(root='.') {
  const source=fs.readFileSync(path.join(root,'scripts/local-release.Dockerfile'),'utf8');
  const node=source.match(/^FROM node:(\d+\.\d+\.\d+)-/m)?.[1];
  const playwright=source.match(/^FROM mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-/m)?.[1];
  assert(node && playwright,'Missing immutable local runtime pins');
  const image=source.match(/^FROM (mcr\.microsoft\.com\/playwright:[^\s]+)/m)?.[1];
  const plan=parseYaml(fs.readFileSync(path.join(root,'config/release-validation.yml'),'utf8'));
  assert.equal(plan.jobs['homepage-validation'].container.image,image,'Local browser image differs from the selected release contract');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'))).packages['node_modules/@playwright/test'].version,playwright,'Browser image differs from the lock');
  return {node:'v'+node,playwright,platform:'linux/arm64'};
}
export function environmentInputs(root = '.') {
  return Object.fromEntries(['scripts/local-release.Dockerfile', 'scripts/lib/local-release-environment.mjs', ...PACKAGES.flatMap(dir => ['package.json', 'package-lock.json'].map(file => path.posix.join(dir, file)))].map(file => [file, hash(fs.readFileSync(path.join(root, file)))]));
}
export function environmentKey(inputs, platform = 'linux/arm64') {
  return hash(JSON.stringify({ schema: 1, platform, inputs }));
}
export function docker(args, options = {}) {
  return execFileSync('docker', ['--context', CONTEXT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, maxBuffer: 8 * 1024 * 1024, ...options });
}
export function ensureEnvironment(root = '.') {
  assert.equal(process.platform, 'darwin', 'Local release preparation belongs on the development Mac');
  const started = Date.now(), hostMemoryBytes=os.totalmem(),resources=resourceProfile(hostMemoryBytes),inputs = environmentInputs(root), key = environmentKey(inputs);
  const pins=toolchainPins(root);
  const directory = path.join(cacheRoot(), 'environments', key);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stateFile = path.join(directory, 'ready.json');
  const profileFile=path.join(os.homedir(),'.colima',PROFILE,'colima.yaml');
  if(fs.existsSync(profileFile)) {
    const profile=parseYaml(fs.readFileSync(profileFile,'utf8'));
    assert.deepEqual(profile.mounts,[{location:cacheRoot(),writable:true}],
      'The dedicated release VM must expose only the project test cache; stop it and apply the documented mount configuration');
    assert.equal(profile.forwardAgent,false,'Do not forward the development SSH agent');
  }
  if (spawnSync('docker', ['--context', CONTEXT, 'info'], { stdio: 'ignore' }).status !== 0) {
    execFileSync('colima', ['start', '--profile', PROFILE, '--cpu', String(resources.vm.cpus), '--memory', String(resources.vm.memoryGiB), '--disk', String(resources.vm.diskGiB), '--vm-type', 'vz', ...(resources.name==='compact-16g-v1'?['--vz-rosetta=false']:[]), '--activate=false', '--ssh-agent=false', '--ssh-config=false', '--mount',`${cacheRoot()}:w`], { stdio: 'inherit', timeout: 240000 });
  }
  const configuration=parseYaml(fs.readFileSync(profileFile,'utf8')),info=JSON.parse(docker(['info','--format','{{json .}}']));
  const resourceObservation={hostMemoryBytes,vm:{configuration:{cpu:configuration.cpu,memory:configuration.memory,disk:configuration.disk},actual:{cpus:info.NCPU,memoryBytes:info.MemTotal}}};
  verifyResourceEvidence({resources,resourceObservation},{requireContainer:false});
  const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile)) : null;
  if (state && state.key === key) {
    const present = spawnSync('docker', ['--context', CONTEXT, 'image', 'inspect', state.image], { encoding: 'utf8' });
    if (present.status === 0) {
      const actual = JSON.parse(present.stdout)[0];
      assert.equal(actual.Id, state.image); assert.equal(actual.Architecture, 'arm64');
      return { ...state, resources,resourceObservation,reused: true, preparationMs: Date.now() - started };
    }
  }
  const runtimeKey = hash(fs.readFileSync(path.join(root, 'scripts/local-release.Dockerfile')));
  const runtimeTag = `bitbi-release-runtime:${runtimeKey}`;
  if (spawnSync('docker', ['--context', CONTEXT, 'image', 'inspect', runtimeTag], { stdio: 'ignore' }).status !== 0) {
    docker(['build', '--platform', 'linux/arm64', '-t', runtimeTag, '-'], { input: fs.readFileSync(path.join(root, 'scripts/local-release.Dockerfile')), stdio: ['pipe', 'inherit', 'inherit'], timeout: 900000 });
  }
  const build = fs.mkdtempSync(path.join(directory, 'install-'));
  try {
    let recipe = '';
    for (const [index, dir] of PACKAGES.entries()) {
      for (const file of ['package.json', 'package-lock.json']) {
        const dest = path.join(build, dir, file); fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(path.join(root, dir, file), dest);
      }
      recipe += `FROM ${runtimeTag} AS deps${index}\nUSER root\nWORKDIR /opt/bitbi-deps/${dir}\nCOPY ${dir ? dir + '/' : ''}package*.json ./\nRUN npm ci && npm ls --depth=0\n`;
    }
    recipe += `FROM ${runtimeTag}\nUSER root\n`;
    for (const [index, dir] of PACKAGES.entries()) recipe += `COPY --from=deps${index} /opt/bitbi-deps/${dir ? dir + '/' : ''}node_modules /opt/bitbi-deps/${dir ? dir + '/' : ''}node_modules\n`;
    recipe += 'USER 1001:1001\n';
    fs.writeFileSync(path.join(build, 'Dockerfile'), recipe);
    const tag = `bitbi-release-dependencies:${key}`;
    docker(['build', '--platform', 'linux/arm64', '-t', tag, build], { stdio: 'inherit', timeout: 900000 });
    const image = JSON.parse(docker(['image', 'inspect', tag]))[0];
    const record = { key, inputs, image: image.Id, ...pins, createdAt: new Date().toISOString() };
    fs.writeFileSync(stateFile, JSON.stringify(record, null, 2) + '\n');
    return { ...record, resources,resourceObservation,reused: false, preparationMs: Date.now() - started };
  } finally { fs.rmSync(build, { recursive: true, force: true }); }
}
