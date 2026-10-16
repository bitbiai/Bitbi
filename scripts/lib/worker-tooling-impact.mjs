import { execFileSync, spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { parseJsonc } from './release-compat.mjs';
import {normalizeCanvasAgentConfigDelta} from './canvas-agent-release.mjs';
import {validateSharpLock} from './worker-sharp.mjs';

// Undici is the reviewed Wrangler/Miniflare HTTP client, not a compiler or an
// application dependency. Only compatible leaf patches with unchanged runtime
// inputs can avoid an unnecessary deployment. Audits and Worker tests still run.
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const read = (root, ref, file) => JSON.parse(git(root, ['show', `${ref}:${file}`]));
const without = (value, key) => Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
// Auth intentionally shares this import-free, platform-neutral diagnostic
// contract with the private processor. Do not admit the whole service tree.
const externalRuntimeModules = prefix => prefix === 'workers/auth'
  ? ['services/homepage-ffmpeg-processor/canvas-diagnostics.mjs'] : [];
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

// Reviewed GHSA-wq5f-xc86-pv6w remediation only: Sharp and its existing native
// packages move together, while Miniflare, Wrangler and all other dependencies
// remain byte-equivalent JSON. This does not authorize future package upgrades.
export function isSharpToolingPatch(before,after) {
  try {
    const family=key=>key==='node_modules/sharp'||/^node_modules\/@img\/sharp-[a-z0-9-]+$/.test(key);
    const beforePackages=before.lock.packages,afterPackages=after.lock.packages;
    if(before.manifest.overrides?.sharp!=='0.35.4'||after.manifest.overrides?.sharp!=='0.35.5')return false;
    if(!isDeepStrictEqual(without(before.manifest,'overrides'),without(after.manifest,'overrides'))
      ||!isDeepStrictEqual(without(before.manifest.overrides,'sharp'),without(after.manifest.overrides,'sharp'))
      ||!isDeepStrictEqual(without(before.lock,'packages'),without(after.lock,'packages')))return false;
    const unchanged=packages=>Object.fromEntries(Object.entries(packages).filter(([key])=>!family(key)));
    if(!isDeepStrictEqual(unchanged(beforePackages),unchanged(afterPackages)))return false;
    const keys=Object.keys(beforePackages).filter(family).sort();
    if(!isDeepStrictEqual(keys,Object.keys(afterPackages).filter(family).sort()))return false;
    validateSharpLock(after.manifest,after.lock);
    const expected=(name,after)=>name.startsWith('@img/sharp-libvips-')?(after?'1.3.4':'1.3.3'):(after?'0.35.5':'0.35.4');
    const normalized=(entry,after)=>Object.fromEntries(Object.entries(entry).filter(([key])=>!['version','resolved','integrity'].includes(key)).map(([key,value])=>{
      if(!['dependencies','optionalDependencies'].includes(key))return [key,value];
      return [key,Object.fromEntries(Object.entries(value).map(([name,version])=>{
        if(!family('node_modules/'+name))return [name,version];
        if(version!==expected(name,after))throw new Error('Unreviewed native dependency');
        return [name,'reviewed-sharp-patch'];
      }))];
    }));
    for(const key of keys) {
      const a=beforePackages[key],b=afterPackages[key],name=key.slice('node_modules/'.length);
      if(a.dev!==true||b.dev!==true||a.version!==expected(name,false)||b.version!==expected(name,true)
        ||!isDeepStrictEqual(normalized(a,false),normalized(b,true)))return false;
      if(b.resolved!==`https://registry.npmjs.org/${name}/-/${name.split('/').at(-1)}-${b.version}.tgz`
        ||!/^sha512-[A-Za-z0-9+/]+=*$/.test(b.integrity||''))return false;
    }
    return true;
  }catch{return false;}
}

function relativeSourcesStayReviewed(root, base, head, prefix, { allowSourceChanges = false } = {}) {
  const roots = [`${prefix}/src`, 'workers/shared', 'js/shared'];
  const external = externalRuntimeModules(prefix);
  const modes = new Map(git(root, ['ls-tree', '-r', '--format=%(objectmode) %(path)', head, '--', ...roots, ...external])
    .split('\n').map(line => {const at = line.indexOf(' ');return [line.slice(at + 1), line.slice(0, at)];}));
  const pending = [`${prefix}/src/index.js`], visited = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    // Compare exact Git blobs in this Worker's reachable graph. A neighboring
    // frontend-only shared module is not an input, but changed/new reachable
    // modules (including whitespace-only edits) cannot inherit the exception.
    if (!allowSourceChanges && git(root, ['rev-parse', '--verify', `${base}:${file}`]) !== git(root, ['rev-parse', '--verify', `${head}:${file}`])) return false;
    // The release contract is an intentional Auth runtime input. Its change
    // still requires Auth deployment; it cannot inherit the unchanged-runtime
    // exemption below. Other external JSON keeps the existing strict proof.
    if (file.endsWith('.json')) {
      const before = read(root, base, file), after = read(root, head, file);
      if (!(allowSourceChanges && prefix === 'workers/auth' && file === 'config/release-compat.json')
          && !isDeepStrictEqual(before, after)) return false;
      continue;
    }
    if ((!roots.some(directory => file.startsWith(`${directory}/`)) && !external.includes(file)) || !/\.(?:[cm]?js|ts)$/.test(file)
        || !['100644', '100755'].includes(modes.get(file))) return false;
    const source = git(root, ['show', `${head}:${file}`]);
    // Limit the exception to the repository's literal module layout. Computed
    // module imports cannot be proven by this small source check.
    for (const call of source.matchAll(/\b(?:import|require)\s*\(/g)) {
      // Inspect the whole argument through its closing parenthesis: a leading
      // quote alone does not prove that concatenation/interpolation is absent.
      // Escapes, templates and extra arguments stay outside this narrow proof.
      if (!/^\s*(['"])[^'"\\\r\n]*\1\s*\)/.test(source.slice(call.index + call[0].length))) return false;
    }
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
  if (!relativeSourcesStayReviewed(root, base, head, prefix, { allowSourceChanges: true })) return true;

  // dev:true alone is insufficient: application code can import Miniflare (or
  // another ancestor) and bring the patched HTTP client into its runtime graph.
  const tooling = new Set(['undici','sharp',...Object.keys(lock.packages).filter(key=>key.startsWith('node_modules/@img/sharp-')).map(key=>key.slice('node_modules/'.length)), ...Object.keys(manifest.devDependencies || {})]);
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
  const usage = spawnSync('git', ['grep', '-l', '-E', pattern, head, '--', ...runtimePaths, ...externalRuntimeModules(prefix)],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return usage.status !== 1;
}

export function workerToolingPatchEvidence(root, source, changedFiles) {
  const empty = () => ({ toolingOnlyWorkerPackageFiles: [], reviewedToolingPatchFiles: [] });
  if (!root || source?.mode !== 'git-diff' || !source.base) return empty();
  const result = empty();
  try {
    const head = git(root, ['rev-parse', '--verify', `${source.head || 'HEAD'}^{commit}`]);
    const base = git(root, ['merge-base', source.base, head]);
    const runtimeLock = ref => Object.fromEntries(Object.entries(read(root, ref, 'package-lock.json').packages)
      .filter(([name, entry]) => name && !entry.dev));
    if (!isDeepStrictEqual(runtimeLock(base), runtimeLock(head))) return empty();
    for (const worker of ['auth', 'ai', 'contact']) {
      const prefix = `workers/${worker}`;
      const files = [`${prefix}/package.json`, `${prefix}/package-lock.json`];
      if (!files.some(file => changedFiles.includes(file))) continue;
      const runtimePaths = [`${prefix}/src`, `${prefix}/wrangler.jsonc`, 'workers/shared', 'js/shared'];
      const configChanged=Boolean(git(root, ['diff', '--name-only', base, head, '--', `${prefix}/wrangler.jsonc`]));
      const at = ref => ({ manifest: read(root, ref, files[0]), lock: read(root, ref, files[1]) });
      const before = at(base), after = at(head);
      const sharpPatch=isSharpToolingPatch(before,after);
      if(configChanged) {
        if(!sharpPatch||!['auth','ai'].includes(worker))continue;
        const config=ref=>parseJsonc(git(root,['show',`${ref}:${prefix}/wrangler.jsonc`]));
        const {previous,next}=normalizeCanvasAgentConfigDelta(config(base),config(head),worker);
        if(!isDeepStrictEqual(previous,next))continue;
      }
      if ((sharpPatch||isUndiciToolingPatch(before, after)) && !runtimeUsesTooling(root, base, head, prefix, after, runtimePaths)) {
        const changedPackages = files.filter(file => changedFiles.includes(file));
        // This proof concerns only the compatible development leaf. It does
        // not remove runtime deployment impact when application sources changed.
        result.reviewedToolingPatchFiles.push(...changedPackages);
        let unchanged = false;
        try {
          unchanged = !configChanged&&!git(root, ['diff', '--name-only', base, head, '--', `${prefix}/src`])
            && relativeSourcesStayReviewed(root, base, head, prefix);
        } catch { /* New or missing base module cannot prove unchanged input. */ }
        if (unchanged) result.toolingOnlyWorkerPackageFiles.push(...changedPackages);
      }
    }
  } catch {
    // Missing/invalid source evidence must not narrow a deployment plan.
    return empty();
  }
  return result;
}

export function toolingOnlyWorkerPackages(root, source, changedFiles) {
  return workerToolingPatchEvidence(root, source, changedFiles).toolingOnlyWorkerPackageFiles;
}
