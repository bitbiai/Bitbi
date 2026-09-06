import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { parseJsonc } from '../../../scripts/lib/release-compat.mjs';
import { readMigrations, sha256 } from './sql.mjs';

export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const authRoot = path.join(repoRoot, 'workers/auth');
const requireAuth = createRequire(path.join(authRoot, 'package.json'));

function copySources(from, to, ledger, relative = '') {
  const info = fs.lstatSync(from);
  if (info.isSymbolicLink()) throw new Error(`Source symlink is not an approved build input: ${relative}`);
  if (info.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from).sort()) copySources(path.join(from, name), path.join(to, name), ledger, path.join(relative, name));
  } else if (info.isFile()) {
    if (/(^|\/)(\.env|\.dev\.vars)(\.|$)/.test(relative)) throw new Error('Environment file is not a test build input');
    const bytes = fs.readFileSync(from);
    fs.mkdirSync(path.dirname(to), { recursive: true }); fs.writeFileSync(to, bytes, { flag: 'wx' });
    ledger.push({ path: relative, sha256: sha256(bytes) });
  }
}

export function prepareBuild(artifactParent = os.tmpdir()) {
  assert.equal(Number(process.versions.node.split('.')[0]), 22, 'Use the repository Node22 toolchain');
  const absoluteParent = fs.realpathSync(path.resolve(artifactParent));
  const relativeParent = path.relative(repoRoot, absoluteParent);
  assert.ok(relativeParent === '..' || relativeParent.startsWith(`..${path.sep}`) || path.isAbsolute(relativeParent), 'Runtime artifacts must be outside repository');
  const workDir = fs.mkdtempSync(path.join(absoluteParent, 'bitbi-q2-runtime-'));
  fs.chmodSync(workDir, 0o700);
  for (const folder of ['tmp', 'cache', 'registry', 'build', 'input', 'xdg']) fs.mkdirSync(path.join(workDir, folder));
  const preserved = {};
  for (const key of ['PATH', 'SystemRoot', 'SYSTEMROOT', 'WINDIR']) if (process.env[key]) preserved[key] = process.env[key];
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, preserved, { TMPDIR: path.join(workDir, 'tmp'), TEMP: path.join(workDir, 'tmp'), TMP: path.join(workDir, 'tmp'),
    TZ: 'UTC', CI: '1', DO_NOT_TRACK: '1', NO_UPDATE_CHECK: '1', WRANGLER_SEND_METRICS: 'false', WRANGLER_SEND_ERROR_REPORTS: 'false',
    WRANGLER_HIDE_BANNER: 'true', WRANGLER_NO_SKILLS_UPDATE_PROMPTS: 'true', CLOUDFLARE_CF_FETCH_ENABLED: 'false',
    WRANGLER_CACHE_DIR: path.join(workDir, 'cache'), WRANGLER_LOG_PATH: path.join(workDir, 'wrangler-logs'),
    XDG_CONFIG_HOME: path.join(workDir, 'xdg'), XDG_CACHE_HOME: path.join(workDir, 'cache'),
    MINIFLARE_CACHE_DIR: path.join(workDir, 'cache'), MINIFLARE_REGISTRY_PATH: path.join(workDir, 'registry') });
  const lock = JSON.parse(fs.readFileSync(path.join(authRoot, 'package-lock.json'), 'utf8'));
  const versions = { node: process.versions.node };
  for (const name of ['wrangler', 'miniflare', 'workerd', 'esbuild']) {
    const installed = JSON.parse(fs.readFileSync(path.join(authRoot, 'node_modules', name, 'package.json'), 'utf8'));
    assert.equal(installed.version, lock.packages[`node_modules/${name}`].version, `Installed ${name} must match auth lock`);
    versions[name] = installed.version;
  }
  const workerd = requireAuth('workerd');
  process.env.MINIFLARE_WORKERD_PATH = workerd.default;
  const esbuild = requireAuth('esbuild');
  const config = parseJsonc(fs.readFileSync(path.join(authRoot, 'wrangler.jsonc'), 'utf8'));
  assert.equal(config.main, 'src/index.js');
  assert.ok(!config.build?.command, 'Custom build hooks need separate review');
  const input = path.join(workDir, 'input'), sourceLedger = [];
  for (const relative of ['workers/auth/src', 'workers/shared', 'js/shared', 'config', 'workers/auth/package.json', 'workers/auth/package-lock.json', 'workers/auth/wrangler.jsonc', 'package.json', 'package-lock.json']) {
    copySources(path.join(repoRoot, relative), path.join(input, relative), sourceLedger, relative);
  }
  const copiedAuth = path.join(input, 'workers/auth');
  fs.symlinkSync(path.join(authRoot, 'node_modules'), path.join(copiedAuth, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const rootLock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8'));
  const viem = JSON.parse(fs.readFileSync(path.join(repoRoot, 'node_modules/viem/package.json'), 'utf8'));
  assert.equal(viem.version, rootLock.packages['node_modules/viem'].version, 'Current wallet build dependency must match root lock');
  fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(input, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const emptyEnv = path.join(workDir, 'empty.env'); fs.writeFileSync(emptyEnv, '', { flag: 'wx' });
  const buildDir = path.join(workDir, 'build');
  const args = [path.join(authRoot, 'node_modules/wrangler/bin/wrangler.js'), 'deploy', '--cwd', copiedAuth,
    '--config', path.join(copiedAuth, 'wrangler.jsonc'), '--env-file', emptyEnv, '--dry-run', '--outdir', buildDir,
    '--metafile', path.join(buildDir, 'bundle-meta.json'), '--outfile', path.join(buildDir, 'worker-upload.multipart'),
    '--no-autoconfig', '--no-install-skills', '--no-experimental-provision', '--no-experimental-auto-create', '--containers-rollout', 'none'];
  const built = spawnSync(process.execPath, args, { cwd: copiedAuth, env: process.env, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  fs.writeFileSync(path.join(workDir, 'wrangler-build.log'), (built.stdout || '') + (built.stderr || ''), { flag: 'wx' });
  assert.equal(built.status, 0, `Local Wrangler dry-run must succeed; retained build log: ${path.join(workDir, 'wrangler-build.log')}`);
  const bundlePath = path.join(buildDir, 'index.js'), bundle = fs.readFileSync(bundlePath, 'utf8');
  const migrations = readMigrations(repoRoot);
  assert.equal(migrations.at(-1).path, '0083_add_r2_cleanup_reference_fence.sql', 'Update native Q2 matrix for a newer schema');
  const provenance = { versions, compatibilityDate: config.compatibility_date, bundleSha256: sha256(bundle), sourceLedger,
    workerdBinarySha256: sha256(fs.readFileSync(workerd.default)), migrations: migrations.map(({ path: name, sha256: hash }) => ({ path: name, sha256: hash })) };
  fs.writeFileSync(path.join(workDir, 'build-provenance.json'), JSON.stringify(provenance, null, 2), { flag: 'wx' });
  return { workDir, bundlePath, bundle, config, migrations, provenance, esbuild };
}

export async function createRuntime(build, name, { restricted = false, referenceOnly = false } = {}) {
  const executionDir = path.join(build.workDir, name); fs.mkdirSync(executionDir);
  for (const folder of ['state', 'isolated', 'tmp', 'registry']) fs.mkdirSync(path.join(executionDir, folder));
  const counters = { outboundDenied: 0, serviceDenied: 0, structuredLogs: 0, toolLogs: 0 };
  const { Miniflare, convertV4MiniflareOptions, Log, LogLevel } = requireAuth('miniflare');
  class Quiet extends Log { logWithLevel() { counters.toolLogs += 1; } logReady() { counters.toolLogs += 1; } }
  const controlToken = randomBytes(32).toString('hex'), webhookSecret = 'whsec_q2_test-synthetic_workerd_only';
  const bindings = { BITBI_ENV: 'production', APP_BASE_URL: 'https://bitbi.ai', ALLOW_LEGACY_SECURITY_SECRET_FALLBACK: 'false', STRIPE_MODE: 'test',
    STRIPE_LIVE_WEBHOOK_SECRET: webhookSecret, STRIPE_WEBHOOK_SECRET: webhookSecret, NEWS_PULSE_SOURCE_URLS: '',
    ENABLE_NEWS_PULSE_VISUAL_BUDGET: 'false', Q2_CONTROL_TOKEN: controlToken };
  for (const key of ['SESSION_HASH_SECRET', 'PAGINATION_SIGNING_SECRET', 'ADMIN_MFA_ENCRYPTION_KEY', 'ADMIN_MFA_PROOF_SECRET', 'ADMIN_MFA_RECOVERY_HASH_SECRET', 'AI_SAVE_REFERENCE_SIGNING_SECRET']) bindings[key] = `q2-synthetic-${key}-not-live-0000000000000000`;
  const deny = async () => { counters.outboundDenied += 1; throw new Error('Native test outbound denied'); };
  const denyService = async () => { counters.serviceDenied += 1; throw new Error('Native test provider service denied'); };
  const shared = { modules: true, compatibilityDate: build.config.compatibility_date, bindings, d1Databases: { DB: `q2-${name}-db` },
    r2Buckets: { USER_IMAGES: `q2-${name}-images`, PRIVATE_MEDIA: `q2-${name}-private`, AUDIT_ARCHIVE: `q2-${name}-archive` },
    outboundService: deny, serviceBindings: { AI_LAB: denyService }, unsafeRegisterWorker: false };
  const limiterOwner = restricted ? 'q2-restricted' : 'q2-candidate';
  const limiter = owner => ({ PUBLIC_RATE_LIMITER: { className: 'AuthPublicRateLimiterDurableObject', useSQLite: true, ...(owner ? { scriptName: owner } : {}) } });
  const queues = { ACTIVITY_INGEST_QUEUE: `q2-${name}-activity`, AI_IMAGE_DERIVATIVES_QUEUE: `q2-${name}-derivatives`, AI_VIDEO_JOBS_QUEUE: `q2-${name}-videos` };
  const workers = [];
  if (restricted) {
    const adapterPath = path.join(repoRoot, 'workers/auth/recovery/restriction-adapter.mjs');
    const adapter = fs.readFileSync(adapterPath, 'utf8');
    const entry = fs.readFileSync(path.join(repoRoot, 'workers/auth/recovery/c-entry.mjs'), 'utf8');
    const modules = [{ name: 'c-entry.mjs', contents: entry }, { name: 'b-index.js', contents: build.bundle }, { name: 'restriction-adapter.mjs', contents: adapter }];
    for (const module of modules) fs.writeFileSync(path.join(executionDir, module.name), module.contents, { flag: 'wx' });
    fs.writeFileSync(path.join(executionDir, 'c-module-identity.json'), JSON.stringify(modules.map(module => ({ name: module.name, sha256: sha256(module.contents) })), null, 2), { flag: 'wx' });
    workers.push({ ...shared, name: 'q2-restricted', routes: ['https://bitbi.ai/*'], modulesRoot: executionDir,
      modules: modules.map(module => ({ type: 'ESModule', path: path.join(executionDir, module.name), contents: module.contents })), durableObjects: limiter(), queueProducers: queues });
  }
  if (referenceOnly) workers.push({ ...shared, name: 'q2-candidate', script: 'export default {fetch(){return new Response(null,{status:404});}};' });
  else {
    workers.push({ ...shared, name: 'q2-candidate', script: build.bundle, durableObjects: limiter(restricted ? limiterOwner : null), queueProducers: queues });
    const control = await build.esbuild.build({ entryPoints: [fileURLToPath(new URL('./control.mjs', import.meta.url))], bundle: true, write: false,
      format: 'esm', platform: 'browser', target: 'es2022', metafile: true, logLevel: 'silent', legalComments: 'none' });
    assert.equal(control.outputFiles.length, 1);
    assert.ok(Object.values(control.metafile.outputs).every(output => output.imports.length === 0));
    fs.writeFileSync(path.join(executionDir, 'control-metafile.json'), JSON.stringify(control.metafile, null, 2), { flag: 'wx' });
    workers.push({ ...shared, name: 'q2-control', script: control.outputFiles[0].text, durableObjects: limiter(limiterOwner) });
  }
  const mf = new Miniflare(convertV4MiniflareOptions({ rootPath: executionDir, host: '127.0.0.1', port: 0, cf: false,
    telemetry: { enabled: false }, logRequests: false, verbose: false, log: new Quiet(LogLevel.NONE), unsafeTriggerHandlers: true,
    unsafeLocalExplorer: false, unsafeObservability: false, unsafeInspectDurableObjects: false, handleStructuredLogs() { counters.structuredLogs += 1; },
    unsafeDevRegistryPath: path.join(executionDir, 'registry'), resourcePersistencePath: path.join(executionDir, 'state'),
    isolatedResourcePersistencePath: path.join(executionDir, 'isolated'), resourceTmpPath: path.join(executionDir, 'tmp'), workers }));
  try {
    await mf.ready;
    const db = await mf.getD1Database('DB', 'q2-candidate'), bucket = await mf.getR2Bucket('USER_IMAGES', 'q2-candidate');
    const sql = (query, ...args) => db.prepare(query).bind(...args);
    const rows = async (query, ...args) => (await sql(query, ...args).all()).results;
    const scalar = async (query, ...args) => sql(query, ...args).first('value');
    const controlWorker = referenceOnly ? null : await mf.getWorker('q2-control');
    const control = (route, body) => controlWorker.fetch(`https://q2-control.invalid${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-q2-control': controlToken }, body: JSON.stringify(body) });
    return { mf, db, bucket, sql, rows, scalar, control, counters, webhookSecret, migrations: build.migrations, config: build.config, executionDir, close: () => mf.dispose() };
  } catch (error) { await mf.dispose(); throw error; }
}
