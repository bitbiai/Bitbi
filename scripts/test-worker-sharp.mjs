import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateSharpLock, WORKER_PROJECTS } from './lib/worker-sharp.mjs';

let baseline;
for (const worker of WORKER_PROJECTS) {
  const load = file => JSON.parse(fs.readFileSync(new URL(`../${worker}/${file}`, import.meta.url)));
  const pkg = load('package.json'), lock = load('package-lock.json');
  const resolved = validateSharpLock(pkg, lock);
  if (baseline) assert.deepEqual(resolved, baseline, 'all three independently installed worker locks agree');
  baseline = resolved;
  const old = structuredClone(lock); old.packages['node_modules/sharp'].version = '0.35.2';
  assert.throws(() => validateSharpLock(pkg, old), /resolved sharp must be patched/);
  const nested = structuredClone(lock);
  nested.packages['node_modules/miniflare/node_modules/sharp'] = {version: '0.35.2'};
  assert.throws(() => validateSharpLock(pkg, nested), /unpatched nested resolution/);
  const missing = structuredClone(lock); delete missing.packages['node_modules/@img/sharp-linux-x64'];
  assert.throws(() => validateSharpLock(pkg, missing), /native lock resolution/);
  const oldNative = structuredClone(lock);
  oldNative.packages['node_modules/sharp'].optionalDependencies['@img/sharp-libvips-linux-x64'] = '1.3.1';
  assert.throws(() => validateSharpLock(pkg, oldNative), /patched native package/);
  const noOverride = structuredClone(pkg); delete noOverride.overrides.miniflare;
  assert.throws(() => validateSharpLock(noOverride, lock), /Miniflare sharp override/);
}
console.log('Worker sharp lock consistency and old/nested/missing-platform countercontrols passed.');
