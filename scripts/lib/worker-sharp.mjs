import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

export const WORKER_PROJECTS = ['workers/auth', 'workers/contact', 'workers/ai'];
export const PATCHED_SHARP = '0.35.4';
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

// Exact, temporary Miniflare override for GHSA-rgj7-g3m4-5g8c. This is a
// resolution guard, never an npm-audit exception. Revisit with the parent bump.
export function validateSharpLock(pkg, lock) {
  assert.equal(pkg.overrides?.miniflare?.sharp, PATCHED_SHARP, 'Miniflare sharp override');
  const packages = lock.packages;
  assert(packages?.['node_modules/miniflare']?.dependencies?.sharp, 'Miniflare sharp dependency missing');
  const sharp = packages['node_modules/sharp'];
  assert.equal(sharp?.version, PATCHED_SHARP, 'resolved sharp must be patched');
  assert.equal(sharp.dev, true, 'sharp remains development tooling');
  for (const [key, entry] of Object.entries(packages)) {
    if (key.endsWith('/node_modules/sharp') || key === 'node_modules/sharp') {
      assert.equal(entry.version, PATCHED_SHARP, `unpatched nested resolution: ${key}`);
    }
  }
  for (const platform of ['darwin-arm64', 'darwin-x64', 'linux-x64']) {
    assert(sharp.optionalDependencies?.[`@img/sharp-${platform}`], `missing native platform ${platform}`);
    assert(sharp.optionalDependencies?.[`@img/sharp-libvips-${platform}`], `missing native libraries ${platform}`);
  }
  for (const [name, version] of Object.entries(sharp.optionalDependencies || {})) {
    assert.equal(version, name.startsWith('@img/sharp-libvips-') ? '1.3.3' : PATCHED_SHARP, `patched native package ${name}`);
    const entry = packages[`node_modules/${name}`];
    assert.equal(entry?.version, version, `native lock resolution ${name}`);
    assert(entry.integrity && entry.optional && entry.dev, `native package metadata ${name}`);
  }
  return Object.fromEntries(Object.entries(packages).filter(([key]) => key === 'node_modules/sharp' || key.startsWith('node_modules/@img/sharp')));
}

export function validateInstalledSharp(workerRoot) {
  const pkg = read(path.join(workerRoot, 'package.json'));
  const lock = read(path.join(workerRoot, 'package-lock.json'));
  validateSharpLock(pkg, lock);
  const requireWorker = createRequire(path.join(workerRoot, 'package.json'));
  const miniflarePath = requireWorker.resolve('miniflare/package.json');
  const requireMiniflare = createRequire(miniflarePath);
  const sharp = requireMiniflare('sharp');
  assert.equal(read(miniflarePath).version, lock.packages['node_modules/miniflare'].version);
  assert.equal(sharp.versions.sharp, PATCHED_SHARP, 'actual Miniflare import must resolve patched sharp');
  const heif = String(sharp.versions.heif || '').split('.').map(Number);
  assert(heif.length === 3 && heif.every(Number.isInteger) &&
    (heif[0] > 1 || (heif[0] === 1 && (heif[1] > 23 || (heif[1] === 23 && heif[2] >= 2)))),
  'actual loaded libheif must be >=1.23.2, including global-library builds');
  return { sharp: sharp.versions.sharp, vips: sharp.versions.vips, heif: sharp.versions.heif,
    miniflare: read(miniflarePath).version, platform: process.platform, arch: process.arch };
}
