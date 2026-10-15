import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateSharpLock, validateSharpVersions, PATCHED_SHARP, WORKER_PROJECTS } from './lib/worker-sharp.mjs';

const versions={sharp:PATCHED_SHARP,heif:'1.23.2',rsvg:'2.63.2'};
validateSharpVersions(versions);
validateSharpVersions({...versions,heif:'1.24.0',rsvg:'2.64.0'});
for(const [key,values] of [['sharp',['0.35.4']],['heif',['1.23.1','1.22.9',undefined,'garbage']],['rsvg',['2.63.1','2.62.99',undefined,'2.63.2-unverified']]])
  for(const value of values)assert.throws(()=>validateSharpVersions({...versions,[key]:value}),/actual Miniflare|actual loaded/);

let baseline;
for (const worker of WORKER_PROJECTS) {
  const load = file => JSON.parse(fs.readFileSync(new URL(`../${worker}/${file}`, import.meta.url)));
  const pkg = load('package.json'), lock = load('package-lock.json');
  const resolved = validateSharpLock(pkg, lock);
  if (baseline) assert.deepEqual(resolved, baseline, 'all three independently installed worker locks agree');
  baseline = resolved;
  const old = structuredClone(lock); old.packages['node_modules/sharp'].version = '0.35.4';
  assert.throws(() => validateSharpLock(pkg, old), /resolved sharp must be patched/);
  const nested = structuredClone(lock);
  nested.packages['node_modules/miniflare/node_modules/sharp'] = {version: '0.35.2'};
  assert.throws(() => validateSharpLock(pkg, nested), /unpatched nested resolution/);
  const missing = structuredClone(lock); delete missing.packages['node_modules/@img/sharp-linux-x64'];
  assert.throws(() => validateSharpLock(pkg, missing), /native lock resolution/);
  const oldNative = structuredClone(lock);
  oldNative.packages['node_modules/sharp'].optionalDependencies['@img/sharp-libvips-linux-x64'] = '1.3.3';
  assert.throws(() => validateSharpLock(pkg, oldNative), /patched native package/);
  const noOverride = structuredClone(pkg); delete noOverride.overrides.sharp;
  assert.throws(() => validateSharpLock(noOverride, lock), /project sharp override/);
  const nestedOverride = structuredClone(noOverride);
  nestedOverride.overrides.miniflare = { sharp: PATCHED_SHARP };
  assert.throws(() => validateSharpLock(nestedOverride, lock), /project sharp override/);
}
console.log('Worker sharp lock consistency and old/nested/missing-platform countercontrols passed.');
