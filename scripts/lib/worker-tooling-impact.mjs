import { execFileSync, spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { parseJsonc } from './release-compat.mjs';

// Undici is the reviewed Wrangler/Miniflare HTTP client, not a compiler or an
// application dependency. Only compatible leaf patches with unchanged runtime
// inputs can avoid an unnecessary deployment. Audits and Worker tests still run.
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const read = (root, ref, file) => JSON.parse(git(root, ['show', `${ref}:${file}`]));
const without = (value, key) => Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
function forwardPatch(before, after) {
  const a = /^(\d+)\.(\d+)\.(\d+)$/.exec(before || '');
  const b = /^(\d+)\.(\d+)\.(\d+)$/.exec(after || '');
  return a && b && a[1] === b[1] && a[2] === b[2] && Number(b[3]) > Number(a[3]);
}
export function isUndiciToolingPatch(before, after) {
  const [a, b] = [before, after].map(({ manifest, lock }) => ({ manifest, lock, entry: lock.packages?.['node_modules/undici'] }));
  if (a.entry?.dev !== true || b.entry?.dev !== true || !forwardPatch(a.entry.version, b.entry.version)) return false;
  if (a.manifest.overrides?.undici !== a.entry.version || b.manifest.overrides?.undici !== b.entry.version) return false;
  if (!isDeepStrictEqual(without(a.manifest, 'overrides'), without(b.manifest, 'overrides'))
      || !isDeepStrictEqual(without(a.manifest.overrides, 'undici'), without(b.manifest.overrides, 'undici'))) return false;
  if (!isDeepStrictEqual(without(a.lock, 'packages'), without(b.lock, 'packages'))
      || !isDeepStrictEqual(without(a.lock.packages, 'node_modules/undici'), without(b.lock.packages, 'node_modules/undici'))) return false;
  const stripVersion = entry => Object.fromEntries(Object.entries(entry).filter(([key]) => !['version', 'resolved', 'integrity'].includes(key)));
  return isDeepStrictEqual(stripVersion(a.entry), stripVersion(b.entry))
    && b.entry.resolved === `https://registry.npmjs.org/undici/-/undici-${b.entry.version}.tgz`
    && /^sha512-[A-Za-z0-9+/]+=*$/.test(b.entry.integrity || '');
}

function relativeSourcesStayReviewed(root, base, head, prefix) {
  const roots = [`${prefix}/src`, 'workers/shared', 'js/shared'];
  const modes = new Map(git(root, ['ls-tree', '-r', '--format=%(objectmode) %(path)', head, '--', ...roots])
    .split('\n').map(line => {const at = line.indexOf(' ');return [line.slice(at + 1), line.slice(0, at)];}));
  const pending = [`${prefix}/src/index.js`], visited = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    // JSON imports are inert data. The existing Auth baseline is outside src,
    // so require its parsed value to remain unchanged across the release range.
    if (file.endsWith('.json')) {
      if (!isDeepStrictEqual(read(root, base, file), read(root, head, file))) return false;
      continue;
    }
    if (!roots.some(directory => file.startsWith(`${directory}/`)) || !/\.(?:[cm]?js|ts)$/.test(file)
        || !['100644', '100755'].includes(modes.get(file))) return false;
    const source = git(root, ['show', `${head}:${file}`]);
    // Limit the exception to the repository's literal module layout. Computed
    // module imports cannot be proven by this small source check.
    if (/\b(?:import|require)\s*\(\s*[^\s'"`]/.test(source)) return false;
    for (const [, , relative] of source.matchAll(/(['"`])(\.\.?\/[^'"`\r\n]*)\1/g)) {
      if (relative.includes('\\') || relative.includes('${')) return false;
      pending.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), relative.split(/[?#]/)[0])));
    }
  }
  return true;
}

function runtimeUsesTooling(root, base, head, prefix, { manifest, lock }, runtimePaths) {
  const config = parseJsonc(git(root, ['show', `${head}:${prefix}/wrangler.jsonc`]));
  // This exception covers the existing direct-source build only. A generated
  // entry, alternate resolver or custom module collection needs separate proof.
  if (config.main !== 'src/index.js' || ['build', 'alias', 'tsconfig', 'rules', 'env',
    'define', 'base_dir', 'no_bundle', 'find_additional_modules', 'additional_modules']
    .some(key => Object.hasOwn(config, key))) return true;
  git(root, ['show', `${head}:${prefix}/src/index.js`]);
  const allowedScripts = { test: 'npm --prefix ../.. run test:workers', deploy: 'wrangler deploy',
    dev: 'wrangler dev', start: 'wrangler dev' };
  if (Object.entries(manifest.scripts || {}).some(([key, value]) => allowedScripts[key] !== value)) return true;
  // esbuild can discover a tsconfig without an explicit Wrangler option.
  const configs = git(root, ['ls-tree', '-r', '--name-only', head, '--', 'tsconfig.json',
    'workers/tsconfig.json', `${prefix}/tsconfig.json`, `${prefix}/src`]);
  if (configs.split('\n').some(file => /(^|\/)tsconfig\.json$/.test(file))) return true;
  if (!relativeSourcesStayReviewed(root, base, head, prefix)) return true;

  // dev:true alone is insufficient: application code can import Miniflare (or
  // another ancestor) and bring the patched HTTP client into its runtime graph.
  const tooling = new Set(['undici', ...Object.keys(manifest.devDependencies || {})]);
  let changed;
  do {
    changed = false;
    for (const [file, entry] of Object.entries(lock.packages)) {
      if (!file.includes('node_modules/')) continue;
      const name = file.split('node_modules/').at(-1);
      if (!tooling.has(name) && Object.keys({ ...entry.dependencies, ...entry.optionalDependencies,
        ...entry.peerDependencies }).some(dependency => tooling.has(dependency))) {
        tooling.add(name);changed = true;
      }
    }
  } while (changed);
  const names = [...tooling].map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  // Match package/subpath string literals and explicit node_modules paths. This
  // intentionally also rejects non-import references; uncertain use stays a deploy.
  const pattern = `['"\x60](${names})(/|['"\x60])|node_modules/(${names})(/|['"\x60])`;
  const usage = spawnSync('git', ['grep', '-l', '-E', pattern, head, '--', ...runtimePaths],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return usage.status !== 1;
}

export function toolingOnlyWorkerPackages(root, source, changedFiles) {
  if (!root || source?.mode !== 'git-diff' || !source.base) return [];
  const result = [];
  try {
    const head = git(root, ['rev-parse', '--verify', `${source.head || 'HEAD'}^{commit}`]);
    const base = git(root, ['merge-base', source.base, head]);
    const runtimeLock = ref => Object.fromEntries(Object.entries(read(root, ref, 'package-lock.json').packages)
      .filter(([name, entry]) => name && !entry.dev));
    if (!isDeepStrictEqual(runtimeLock(base), runtimeLock(head))) return [];
    for (const worker of ['auth', 'ai', 'contact']) {
      const prefix = `workers/${worker}`;
      const files = [`${prefix}/package.json`, `${prefix}/package-lock.json`];
      if (!files.some(file => changedFiles.includes(file))) continue;
      const runtimePaths = [`${prefix}/src`, `${prefix}/wrangler.jsonc`, 'workers/shared', 'js/shared'];
      if (git(root, ['diff', '--name-only', base, head, '--', ...runtimePaths])) continue;
      const at = ref => ({ manifest: read(root, ref, files[0]), lock: read(root, ref, files[1]) });
      const before = at(base), after = at(head);
      if (isUndiciToolingPatch(before, after) && !runtimeUsesTooling(root, base, head, prefix, after, runtimePaths)) {
        result.push(...files.filter(file => changedFiles.includes(file)));
      }
    }
  } catch {
    // Missing/invalid source evidence must not narrow a deployment plan.
    return [];
  }
  return result;
}
