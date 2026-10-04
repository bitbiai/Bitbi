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
export const cacheRoot = () => path.join(os.homedir(), 'Library/Caches/bitbi-local-release');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const require=createRequire(import.meta.url);
const parseYaml=source=>require('../../node_modules/playwright-core/lib/utilsBundle.js').yaml.parse(source);
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
  const started = Date.now(), inputs = environmentInputs(root), key = environmentKey(inputs);
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
    execFileSync('colima', ['start', '--profile', PROFILE, '--cpu', '6', '--memory', '12', '--disk', '80', '--vm-type', 'vz', '--activate=false', '--ssh-agent=false', '--mount',`${cacheRoot()}:w`], { stdio: 'inherit', timeout: 240000 });
  }
  const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile)) : null;
  if (state && state.key === key) {
    const present = spawnSync('docker', ['--context', CONTEXT, 'image', 'inspect', state.image], { encoding: 'utf8' });
    if (present.status === 0) {
      const actual = JSON.parse(present.stdout)[0];
      assert.equal(actual.Id, state.image); assert.equal(actual.Architecture, 'arm64');
      return { ...state, reused: true, preparationMs: Date.now() - started };
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
    return { ...record, reused: false, preparationMs: Date.now() - started };
  } finally { fs.rmSync(build, { recursive: true, force: true }); }
}
