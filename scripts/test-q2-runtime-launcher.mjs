import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { selectCiTests } from './lib/ci-test-selection.mjs';
import { createReleasePlanFromRepo, evaluateStaticDeploySafety } from './lib/release-plan.mjs';
import { canonicalInterfaces, canonicalRoutes, networkFieldDiff, assertHostedCompletion, throwHostedFailures, parseRuntimeArgs, assertHostedBootstrapAllowed, stageInputPlan, stageRuntimeInputs, resolveArtifactParent, stageNodeExecutable } from '../tests/helpers/q2-runtime/linux-hosted.mjs';

import { assertIsolatedBoundary } from '../tests/helpers/q2-runtime/linux-isolation-contract.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

// These are orchestration regressions, not Linux namespace acceptance. The real
// hosted job must separately emit kernel/UID/network/native-runtime evidence.
test('launcher inputs retain Worker coverage while static release tooling keeps its bounded selection', () => {
  for (const name of [
    'scripts/test-q2-runtime.mjs', 'scripts/test-q2-runtime-launcher.mjs',
    'tests/helpers/q2-runtime/linux-hosted.mjs',
    'tests/helpers/q2-runtime/linux-bootstrap.py',
    'tests/helpers/q2-runtime/test_linux_bootstrap.py',
    'tests/helpers/q2-runtime/linux-child-probe.mjs',
    'tests/helpers/q2-runtime/linux-isolated.mjs',
    'tests/helpers/q2-runtime/environment.mjs',
    '.github/workflows/static.yml', '.github/workflows/full-regression.yml',
  ]) {
    const selection = selectCiTests([name]);
    const staticTooling = name === '.github/workflows/static.yml';
    assert.equal(selection.workers, !staticTooling, name);
    assert.equal(selection.full, name === '.github/workflows/full-regression.yml', name);
    if (staticTooling) {
      assert.equal(selection.static, true, name);
      assert.equal(selection.homepage, false, name);
    }
    assert.equal(selection.docsOnly, false, name);
    const plan = createReleasePlanFromRepo(root, { files: [name] });
    assert.deepEqual(plan.deploySteps, [], name);
    assert.deepEqual(plan.impacts.uncategorizedFiles, [], name);
    const safety = evaluateStaticDeploySafety(plan, { eventName: 'push' });
    assert.equal(safety.mode, 'validation_only', name);
    assert.equal(safety.staticRequired, false, name);
  }
});

test('argument parser rejects ambiguity; artifacts override is explicit', () => {
  assert.deepEqual(parseRuntimeArgs([], {}), { preflight: false, artifacts: null });
  assert.deepEqual(parseRuntimeArgs(['--preflight'], { Q2_RUNTIME_ARTIFACTS: '/tmp/outer' }), { preflight: true, artifacts: '/tmp/outer' });
  assert.deepEqual(parseRuntimeArgs(['--artifacts', '/tmp/chosen', '--preflight'], { Q2_RUNTIME_ARTIFACTS: '/tmp/outer' }), { preflight: true, artifacts: '/tmp/chosen' });
  for (const args of [['--preflight', '--preflight'], ['--artifacts'], ['--artifacts', '--preflight'], ['--artifacts', '/tmp/a', '--artifacts', '/tmp/b'], ['--remote'], ['--host-network']]) {
    assert.throws(() => parseRuntimeArgs(args), /Usage:/);
  }
});

test('privileged path is unavailable without explicit hosted Linux context', () => {
  const env = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_OS: 'Linux', Q2_RUNTIME_ALLOW_HOSTED_BOOTSTRAP: '1' };
  const identity = { platform: 'linux', uid: 1001, gid: 1001 };
  assert.doesNotThrow(() => assertHostedBootstrapAllowed(env, identity));
  for (const key of Object.keys(env)) {
    const missing = { ...env }; delete missing[key];
    assert.throws(() => assertHostedBootstrapAllowed(missing, identity));
  }
  for (const patch of [{ platform: 'darwin' }, { uid: 0 }, { gid: 0 }, { uid: 65534 }, { gid: 65534 }, { uid: NaN }]) {
    assert.throws(() => assertHostedBootstrapAllowed(env, { ...identity, ...patch }));
  }
  assert.throws(() => assertHostedBootstrapAllowed({ ...env, RUNNER_ENVIRONMENT: 'self-hosted' }, identity));
  // This tests admission to the launcher, not any claim of kernel isolation.
});

function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'q2-launcher-unit-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'repo'), staged = path.join(base, 'staged');
  fs.mkdirSync(repo); fs.mkdirSync(staged);
  const put = (name, bytes = 'synthetic') => {
    const file = path.join(repo, name); fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes); return file;
  };
  return { base, repo, staged, put };
}

test('a writable toolcache source yields a separate protected snapshot of the running bytes', t => {
  const f = fixture(t), source = f.put('node', 'synthetic executable bytes; never executed');
  fs.chmodSync(source, 0o777);
  const before = fs.statSync(source), bytes = fs.readFileSync(source);
  const target = path.join(f.staged, 'toolchain-node');
  const result = stageNodeExecutable(source, source, target);
  assert.equal(result.source.mode, '777');
  assert.equal(result.runningInodeMatched, true);
  assert.equal(result.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(fs.readFileSync(target), bytes);
  assert.equal(fs.statSync(target).mode & 0o7777, 0o500);
  assert.notEqual(fs.statSync(target).ino, before.ino);
  assert.equal(fs.statSync(source).mode, before.mode);
  assert.deepEqual(fs.readFileSync(source), bytes);
  fs.writeFileSync(source, 'subsequent host change');
  assert.deepEqual(fs.readFileSync(target), bytes, 'Host in-place changes cannot alter the snapshot');
  // The old guard rejects this input; the new boundary protects its own copy.
  assert.notEqual(before.mode & 0o022, 0);
});

test('executable staging rejects another running inode, symlinks, non-executables and overwrite', t => {
  const f = fixture(t), source = f.put('node', 'same bytes'), other = f.put('other', 'same bytes');
  fs.chmodSync(source, 0o755); fs.chmodSync(other, 0o755);
  const target = path.join(f.staged, 'node');
  assert.throws(() => stageNodeExecutable(source, other, target), /running executable inode/);
  assert.equal(fs.existsSync(target), false);
  const link = path.join(f.repo, 'node-link'); fs.symlinkSync('node', link);
  assert.throws(() => stageNodeExecutable(link, source, target), /ELOOP/);
  fs.chmodSync(source, 0o644);
  assert.throws(() => stageNodeExecutable(source, source, target), /regular executable/);
  fs.chmodSync(source, 0o755); fs.writeFileSync(target, 'retained');
  assert.throws(() => stageNodeExecutable(source, source, target), /EEXIST/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'retained');
});

test('staging rejects a changed source and set-ID stat before publishing bytes', t => {
  const f = fixture(t), source = f.put('node', 'synthetic'), target = path.join(f.staged, 'node');
  fs.chmodSync(source, 0o755);
  const original = fs.fstatSync;
  let reads = 0;
  t.mock.method(fs, 'fstatSync', function (...args) {
    const info = original.apply(fs, args);
    if (++reads === 2) info.ctimeNs += 1n;
    return info;
  });
  assert.throws(() => stageNodeExecutable(source, source, target), /changed while staging/);
  assert.equal(fs.existsSync(target), false);
  t.mock.restoreAll();
  t.mock.method(fs, 'fstatSync', function (...args) { const info = original.apply(fs, args); info.mode |= 0o4000n; return info; });
  assert.throws(() => stageNodeExecutable(source, source, target), /without set-ID/);
  assert.equal(fs.existsSync(target), false);
});

test('fixed Python snapshot behavior is covered without sudo, namespaces or product execution', t => {
  const result = spawnSync('/usr/bin/python3', ['-I', '-S', path.join(root, 'tests/helpers/q2-runtime/test_linux_bootstrap.py')],
    { env: { PATH: '/usr/bin:/bin', TMPDIR: os.tmpdir(), PYTHONDONTWRITEBYTECODE: '1' }, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /OK/);
  t.diagnostic(result.stderr.trim());
});

test('staging copies bytes and internal dependency links without executing packages', t => {
  const f = fixture(t);
  f.put('node_modules/tool/cli.js', 'throw new Error("must not execute");');
  fs.mkdirSync(path.join(f.repo, 'node_modules/.bin'));
  fs.symlinkSync('../tool/cli.js', path.join(f.repo, 'node_modules/.bin/tool'));
  f.put('workers/auth/src/index.js', 'export default {};');
  const result = stageRuntimeInputs(f.repo, f.staged, ['node_modules', 'workers/auth/src']);
  assert.equal(result.files, 2); assert.equal(result.symlinks, 1);
  assert.equal(fs.readFileSync(path.join(f.staged, 'workers/auth/src/index.js'), 'utf8'), 'export default {};');
  assert.equal(fs.readlinkSync(path.join(f.staged, 'node_modules/.bin/tool')), '../tool/cli.js');
  assert.ok(stageInputPlan().includes('workers/auth/migrations'));
  assert.ok(stageInputPlan().includes('tests/helpers/q2-runtime'));
  assert.ok(stageInputPlan().every(name => !name.split('/').includes('.git')));
});

test('staging rejects credential files and never overwrites existing artifacts', t => {
  const f = fixture(t);
  for (const name of ['.git/config', '.npmrc', '.env', 'workers/auth/.dev.vars', 'node_modules/pkg/.env.production']) {
    f.put(name);
    assert.throws(() => stageRuntimeInputs(f.repo, f.staged, [name]), /Credential\/Git input/);
  }
  f.put('input.js', 'new'); fs.writeFileSync(path.join(f.staged, 'input.js'), 'retained');
  assert.throws(() => stageRuntimeInputs(f.repo, f.staged, ['input.js']), /EEXIST/);
  assert.equal(fs.readFileSync(path.join(f.staged, 'input.js'), 'utf8'), 'retained');
  assert.throws(() => stageRuntimeInputs(f.repo, f.repo, ['input.js']), /outside/);
  assert.throws(() => stageRuntimeInputs(f.repo, f.staged, ['../secret']));
});

test('staging refuses source symlinks and escaping dependency links', t => {
  const f = fixture(t);
  f.put('source.js'); fs.symlinkSync('source.js', path.join(f.repo, 'alias.js'));
  assert.throws(() => stageRuntimeInputs(f.repo, f.staged, ['alias.js']), /dependency-internal/);
  f.put('node_modules/pkg/real.js');
  fs.symlinkSync('../source.js', path.join(f.repo, 'node_modules/escape'));
  assert.throws(() => stageRuntimeInputs(f.repo, f.staged, ['node_modules/escape']), /escapes/);
});

test('staging refuses set-ID metadata before copying a file', t => {
  const f = fixture(t), setId = f.put('set-id');
  // The macOS execution sandbox strips set-ID bits on chmod. Inject only the
  // reported stat mode here; this policy unit is not a kernel-isolation test.
  const lstat = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', function (file, ...args) {
    const info = lstat.call(fs, file, ...args);
    if (file === setId) info.mode |= 0o4000;
    return info;
  });
  assert.throws(() => stageRuntimeInputs(f.repo, f.staged, ['set-id']), /Set-ID/);
  assert.equal(fs.existsSync(path.join(f.staged, 'set-id')), false);
});

test('artifact paths are checked through existing symlink ancestors before creation', t => {
  const f = fixture(t);
  const absent = path.join(f.repo, 'must-not-create', 'artifacts');
  assert.throws(() => resolveArtifactParent(f.repo, absent), /outside/);
  assert.equal(fs.existsSync(path.dirname(absent)), false);
  const alias = path.join(f.base, 'repo-alias'); fs.symlinkSync(f.repo, alias);
  assert.throws(() => resolveArtifactParent(f.repo, path.join(alias, 'missing')), /outside/);
  const external = path.join(f.staged, 'new', 'artifacts');
  assert.equal(resolveArtifactParent(f.repo, external), path.resolve(external));
  assert.equal(fs.existsSync(external), false);
});

test('existing Worker gates retain native suite, fail early and upload only after execution', t => {
  const pkg = JSON.parse(read('package.json'));
  const command = pkg.scripts['test:workers'];
  const steps = command.split(/\s*&&\s*/);
  const required = ['node scripts/check-q4-selection.mjs',
    'playwright test -c playwright.workers.config.js',
    'npm run test:homepage-ffmpeg-processor', 'npm run test:q2-runtime'];
  let previous = -1;
  for (const step of required) {
    const index = steps.indexOf(step);
    assert.ok(index > previous, `Required step in order: ${step}`);
    assert.equal(steps.lastIndexOf(step), index, `Run required step once: ${step}`);
    previous = index;
  }
  // Exercise the real shell chain with harmless command doubles. Inserting a
  // required intermediate check must preserve stop-on-error, not adjacency.
  const f = fixture(t), bin = path.join(f.base, 'bin'), trace = path.join(f.base, 'trace');
  fs.mkdirSync(bin);
  for (const step of steps) assert.match(step, /^(?:node|playwright|npm) [a-zA-Z0-9_./: -]+$/);
  for (const name of ['node', 'playwright', 'npm']) {
    fs.writeFileSync(path.join(bin, name), '#!/bin/sh\ncommand="${0##*/} $*"\nprintf "%s\\n" "$command" >> "$TRACE"\n[ "$command" != "$FAIL_COMMAND" ] || exit 37\n', { mode: 0o700 });
  }
  for (const failedIndex of [-1, ...steps.map((_, index) => index)]) {
    fs.writeFileSync(trace, '');
    const result = spawnSync('/bin/sh', ['-c', command], { cwd: f.base,
      env: { PATH: bin, TRACE: trace, FAIL_COMMAND: steps[failedIndex] || '' }, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, failedIndex < 0 ? 0 : 37, result.stderr);
    assert.deepEqual(fs.readFileSync(trace, 'utf8').trim().split('\n'),
      failedIndex < 0 ? steps : steps.slice(0, failedIndex + 1), 'No downstream check starts after failure');
  }
  assert.match(pkg.scripts['test:q2-runtime'], /tests\/q2-recovery-staging\.test\.mjs/);
  assert.match(pkg.scripts['test:q2-runtime'], /scripts\/test-q2-runtime-launcher\.mjs/);
  assert.match(pkg.scripts['test:q2-runtime'], /&& node scripts\/test-q2-runtime\.mjs$/);
  for (const [file, job, runName] of [
    ['.github/workflows/static.yml', 'worker-validation', 'Run worker route tests'],
    ['.github/workflows/full-regression.yml', 'worker-tests', 'Run full Worker regression'],
  ]) {
    const content = read(file);
    const block = content.split(`  ${job}:\n`)[1]?.split(/^  [a-z][a-z-]+:\n/m)[0];
    assert.ok(block, `${file}: worker job exists`);
    assert.match(block, /runs-on: ubuntu-latest/);
    assert.match(block, /Q2_RUNTIME_ALLOW_HOSTED_BOOTSTRAP: '1'/);
    assert.match(block, /persist-credentials: false/);
    const authInstall = block.indexOf('run: npm --prefix workers/auth ci');
    const preflight = block.indexOf('run: node scripts/test-q2-runtime.mjs --preflight');
    const main = block.indexOf(`name: ${runName}`);
    const upload = block.indexOf('uses: actions/upload-artifact@v6');
    assert.ok(authInstall > 0 && authInstall < preflight && preflight < main && main < upload, file);
    assert.match(block.slice(main, upload), /run: npm run test:workers/);
    assert.match(block, /if: always\(\)/);
    assert.doesNotMatch(block, /continue-on-error|sudo npm|release:apply|wrangler deploy|migrations apply/);
  }
});

// GitHub resolves job.env before assigning a runner. YAML syntax alone cannot
// reject runner.temp there. Keep this focused on the two real Q2 callers:
// https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#context-availability
function assertArtifactContext(content, job) {
  const block = content.split(`  ${job}:\n`)[1]?.split(/^  [a-z][a-z-]+:\n/m)[0];
  assert.ok(block, 'Worker job must exist');
  const [beforeSteps] = block.split('    steps:\n');
  assert.doesNotMatch(beforeSteps, /\$\{\{[^\n}]*\brunner\s*\./, 'Runner context is unavailable in job env');
  const steps = block.split(/^      - /m).slice(1);
  for (const command of ['node scripts/test-q2-runtime.mjs --preflight', 'npm run test:workers']) {
    const matches = steps.filter(step => step.includes(`        run: ${command}\n`));
    assert.equal(matches.length, 1, `Actual native caller must exist once: ${command}`);
    assert.match(matches[0], /^        env:\n          Q2_RUNTIME_ARTIFACTS: \$\{\{ runner\.temp \}\}\/q2-runtime-evidence$/m,
      'Artifact environment must be available on each actual execution step');
  }
  const upload = steps.find(step => step.includes('uses: actions/upload-artifact@v6'));
  assert.ok(upload, 'Outer artifact upload must remain');
  assert.match(upload, /^          path: \$\{\{ runner\.temp \}\}\/q2-runtime-evidence\/$/m);
}

test('native artifact paths use runner context only after runner assignment', () => {
  for (const [file, job] of [['.github/workflows/static.yml', 'worker-validation'], ['.github/workflows/full-regression.yml', 'worker-tests']]) {
    const content = read(file);
    assertArtifactContext(content, job);
    // Reintroduce exactly the rejected job-level assignment from f316019d.
    const broken = content.replace("      Q2_RUNTIME_ALLOW_HOSTED_BOOTSTRAP: '1'\n",
      "      Q2_RUNTIME_ALLOW_HOSTED_BOOTSTRAP: '1'\n      Q2_RUNTIME_ARTIFACTS: ${{ runner.temp }}/q2-runtime-evidence\n");
    assert.throws(() => assertArtifactContext(broken, job), /Runner context is unavailable/);
    // Losing the path on either caller must not hide its result from upload.
    const stepEnv = '        env:\n          Q2_RUNTIME_ARTIFACTS: ${{ runner.temp }}/q2-runtime-evidence\n';
    assert.throws(() => assertArtifactContext(content.replace(stepEnv, ''), job), /Artifact environment/);
    const last = content.lastIndexOf(stepEnv);
    assert.ok(last >= 0);
    assert.throws(() => assertArtifactContext(content.slice(0, last) + content.slice(last + stepEnv.length), job), /Artifact environment/);
  }
});

// Resolve the actual repository module graph. This validates staging closure,
// not kernel isolation or native product acceptance; no suite executes here.
test('default native runtime plan stages every actual Q4 import and control input', async t => {
  const { runtimeSuites } = await import('../tests/helpers/q2-runtime/runner.mjs');
  const expected = [
    ['q4-public-video', 'tests/q4-runtime-public-video.mjs', 'runPublicVideoTests'],
    ['q4-stream', 'tests/q4-runtime-stream.mjs', 'runStreamTests'],
    ['q4-memory', 'tests/q4-runtime-memory.mjs', 'runMemoryTests'],
    ['q4-video', 'tests/q4-runtime-video.mjs', 'runVideoTests'],
    ['q4-subscription', 'tests/q4-runtime-subscription.mjs', 'runSubscriptionTests'],
  ];
  assert.deepEqual(runtimeSuites.filter(([name]) => name.startsWith('q4-')).map(([name]) => name), expected.map(([name]) => name));
  for (const [name, filename, exportName] of expected) {
    const actual = await import(pathToFileURL(path.join(root, filename)).href);
    assert.equal(runtimeSuites.find(([suite]) => suite === name)[1], actual[exportName], 'Run the actual exported suite function');
  }
  const controls = runtimeSuites.map(([, , options]) => options.q4Control)
    .filter(Boolean).map(name => `tests/helpers/${name}`);
  const entryPoints = ['tests/helpers/q2-runtime/runner.mjs', 'tests/helpers/q2-runtime/linux-isolated.mjs',
    'tests/helpers/q2-runtime/linux-runtime-child.mjs', ...controls];
  const requireAuth = createRequire(path.join(root, 'workers/auth/package.json'));
  const esbuild = requireAuth('esbuild');
  const compiled = esbuild.buildSync({ absWorkingDir: root, entryPoints, bundle: true, write: false,
    metafile: true, packages: 'external', platform: 'node', format: 'esm',
    outdir: 'unused-q4-closure-output', logLevel: 'silent' });
  const imports = Object.keys(compiled.metafile.inputs).sort();
  const plan = stageInputPlan();
  const coveredBy = (input, candidatePlan) => candidatePlan.some(item => input === item || input.startsWith(`${item}/`));
  const checkClosure = candidatePlan => {
    const missing = imports.filter(input => !coveredBy(input, candidatePlan));
    assert.deepEqual(missing, [], 'Every resolved repository import must exist in the Linux stage plan');
  };
  checkClosure(plan);
  for (const filename of [
    ...expected.map(([, filename]) => filename), ...controls,
    'tests/helpers/q4-stream-fixture.mjs', 'tests/helpers/q4-memory-fixture.mjs',
    'tests/helpers/q4-subscription-payloads.cjs',
  ]) {
    assert.ok(imports.includes(filename), `Actual resolved graph includes ${filename}`);
    assert.throws(() => checkClosure(plan.filter(item => item !== filename)), /Every resolved repository import/,
      `Removing ${filename} must fail before a hosted run`);
  }
  const f = fixture(t);
  const staged = stageRuntimeInputs(root, f.staged, imports);
  assert.equal(staged.files, imports.length);
  for (const filename of imports) assert.deepEqual(fs.readFileSync(path.join(f.staged, filename)), fs.readFileSync(path.join(root, filename)), filename);
  t.diagnostic(`Resolved and staged ${imports.length} actual source modules; ${expected.length} Q4 suites plus ${controls.length} native controls. Packages retain the existing locked dependency staging.`);
});


test('host network comparison canonicalizes order but retains interface, address, MTU and route changes', () => {
  const rows = [{ ifname: 'eth0', ifindex: 2, flags: ['UP','LOWER_UP'], mtu: 1500, operstate: 'UP',
    addr_info: [{ family:'inet', local:'192.0.2.1', prefixlen:24, scope:'global' }, {family:'inet6',local:'2001:db8::1',prefixlen:64,scope:'global'}] },
    {ifname:'lo',ifindex:1,flags:['LOOPBACK','UP'],mtu:65536,addr_info:[]}];
  const before = canonicalInterfaces(rows), reordered = structuredClone(rows).reverse();
  for (const row of reordered) { row.flags.reverse(); row.addr_info.reverse(); }
  assert.deepEqual(canonicalInterfaces(reordered),before);
  for (const mutate of [x=>x.push({ifname:'new0',ifindex:3,flags:[],mtu:1500,addr_info:[]}),
    x=>x[0].mtu++,x=>x[0].flags.pop(),x=>x[0].operstate='DOWN',x=>x[0].addr_info[0].local='192.0.2.2',
    x=>x[0].addr_info[0].prefixlen=16,x=>x[0].master='other']) {
    const changed = structuredClone(rows); mutate(changed); assert.notDeepEqual(canonicalInterfaces(changed),before);
    const diff = networkFieldDiff(before,canonicalInterfaces(changed),'synthetic-local-diff-key');
    assert.ok(diff.length); assert.ok(!JSON.stringify(diff).includes('192.0.2.'));
  }
  const routes=[{dst:'default',gateway:'192.0.2.254',dev:'eth0',metric:100,flags:['onlink','linkdown']},{dst:'2001:db8::/64',dev:'eth0',metric:256}];
  assert.deepEqual(canonicalRoutes(routes),canonicalRoutes(structuredClone(routes).reverse().map(x=>({...x,flags:x.flags?.reverse()})).map(x=>{if(!x.flags)delete x.flags;return x;})));
  for (const patch of [{gateway:'192.0.2.253'},{dev:'other'},{metric:101},{dst:'192.0.2.0/24'}])
    assert.notDeepEqual(canonicalRoutes(routes),canonicalRoutes([{...routes[0],...patch},routes[1]]));
  assert.deepEqual(canonicalRoutes(routes),canonicalRoutes(routes.map(x=>({...x,expires:2}))));
});

test('postcheck failures retain the earlier bootstrap or runtime failure', () => {
  const primary=new Error('native assertion failed'),post=new Error('network changed');
  assert.throws(()=>throwHostedFailures(primary,[post]),error=>error instanceof AggregateError
    && error.errors[0]===primary && error.errors[1]===post && /Execution: native assertion failed/.test(error.message));
  assert.throws(()=>throwHostedFailures(null,[post]),/Postcheck: network changed/);
  assert.throws(()=>throwHostedFailures(primary,[]),/Execution: native assertion failed/);
  assert.doesNotThrow(()=>throwHostedFailures(null,[]));
});


test('ambient host inventory is diagnostic; own namespace and child completion remain required', () => {
  const before = { namespace: 'host-net', sha256: 'old', names: ['eth0', 'lo'] };
  const after = { namespace: 'host-net', sha256: 'new', names: ['ambient0', 'eth0', 'lo'] };
  const initial = { passed: true, namespaces: { net: 'private-net', mnt: 'private-mnt', pid: 'private-pid', ipc: 'private-ipc' } };
  const final = structuredClone(initial);
  assert.doesNotThrow(() => assertHostedCompletion({ before, after, initial, final }));
  for (const patch of [{ after: { ...after, namespace: 'other-host' } }, { final: null }, { initial: { passed: false } },
    { final: { ...final, namespaces: { ...final.namespaces, net: 'host-net' } } }]) {
    assert.throws(() => assertHostedCompletion({ before, after, initial, final, ...patch }));
  }
  const row = (name, index) => ({ name, index, mtu: 1500, addresses: [] });
  const diff = networkFieldDiff([row('eth0',2), row('lo',1)], [row('ambient0',4), row('eth0',2), row('lo',1)], 'local-secret');
  assert.equal(diff.length, 1); assert.equal(diff[0].field, 'interface:4:ambient0');
});

test('child final boundary rejects privilege, routes, mounts, credentials and namespace loss', () => {
  const boundary = { parent_namespaces: {}, private_namespaces: {} };
  for (const name of ['net','mnt','pid','ipc']) { boundary.parent_namespaces[name] = 'host-' + name; boundary.private_namespaces[name] = 'private-' + name; }
  const good = { privileges: { Uid:'65534 65534 65534 65534', Gid:'65534 65534 65534 65534', Groups:'',
    CapInh:'0', CapPrm:'0', CapEff:'0', CapBnd:'0', CapAmb:'0', NoNewPrivs:'1' }, namespaces: { ...boundary.private_namespaces },
    interfaces:['lo'], ipv4Routes:[], ipv6Devices:['lo'], exposedPaths:[], unexpectedEnvironment:[],
    mounts:Object.fromEntries(['/runtime/node','/runtime/curl','/runtime/setpriv','/workspace'].map(n => [n,['ro','nosuid','nodev']])) };
  assert.doesNotThrow(() => assertIsolatedBoundary(good, boundary));
  const faults = [s => { s.privileges.Uid = '0 0 0 0'; }, s => { s.privileges.NoNewPrivs = '0'; },
    ...['CapInh','CapPrm','CapEff','CapBnd','CapAmb'].map(k => s => { s.privileges[k] = '1'; }),
    s => { s.privileges.Groups = '0'; }, s => { s.namespaces.net = 'host-net'; }, s => { delete s.namespaces.ipc; },
    s => { s.interfaces.push('eth0'); }, s => { s.ipv4Routes.push('outside'); }, s => { s.ipv6Devices.push('eth0'); },
    s => { s.mounts['/workspace'] = ['rw']; }, s => { s.exposedPaths.push('/var/run/docker.sock'); },
    s => { s.unexpectedEnvironment.push('CLOUDFLARE_API_TOKEN'); }];
  for (const fault of faults) { const state = structuredClone(good); fault(state); assert.throws(() => assertIsolatedBoundary(state, boundary)); }
});
