import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const contained = (base, candidate) => candidate === base || candidate.startsWith(base + path.sep);

const fileIdentity = info => [info.dev, info.ino, info.size, info.mode, info.uid, info.gid, info.mtimeNs, info.ctimeNs].map(String);
export function executableMetadata(file) {
  const info = fs.statSync(file, { bigint: true });
  return { path: file, regular: info.isFile(), uid: Number(info.uid), gid: Number(info.gid),
    mode: (Number(info.mode) & 0o7777).toString(8), bytes: Number(info.size),
    device: String(info.dev), inode: String(info.ino) };
}

// Ordinary-user I/O only. A hosted toolcache may be writable or owned by its
// provisioner. Do not execute it as root or chmod it: stage the exact running
// executable's bytes, then let the fixed bootstrap protect its own copy.
export function stageNodeExecutable(source, running, destination) {
  const fd = fs.openSync(source, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  let created = false;
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    assert.ok(before.isFile() && (before.mode & 0o111n) !== 0n && (before.mode & 0o6000n) === 0n,
      'Node source must be a regular executable without set-ID bits');
    const active = fs.statSync(running, { bigint: true });
    assert.equal(before.dev, active.dev, 'Toolchain must match the running executable device');
    assert.equal(before.ino, active.ino, 'Toolchain must match the running executable inode');
    const bytes = fs.readFileSync(fd), digest = hash(bytes);
    assert.equal(digest, hash(fs.readFileSync(running)), 'Running executable bytes changed');
    assert.deepEqual(fileIdentity(fs.fstatSync(fd, { bigint: true })), fileIdentity(before), 'Node source changed while staging');
    assert.equal(BigInt(bytes.length), before.size);
    fs.writeFileSync(destination, bytes, { flag: 'wx', mode: 0o500 }); created = true;
    fs.chmodSync(destination, 0o500);
    return { sha256: digest, bytes: bytes.length, runningInodeMatched: true,
      source: { regular: true, uid: Number(before.uid), gid: Number(before.gid), mode: (Number(before.mode) & 0o7777).toString(8) } };
  } catch (error) {
    if (created) fs.unlinkSync(destination);
    throw error;
  } finally { fs.closeSync(fd); }
}

export function parseRuntimeArgs(args, env = {}) {
  const result = { preflight: false, artifacts: env.Q2_RUNTIME_ARTIFACTS || null };
  let explicitArtifacts = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--preflight' && !result.preflight) result.preflight = true;
    else if (args[i] === '--artifacts' && !explicitArtifacts && args[i + 1] && !args[i + 1].startsWith('--')) {
      result.artifacts = args[++i]; explicitArtifacts = true;
    } else throw new Error('Usage: test-q2-runtime [--preflight] [--artifacts <outside-repository-directory>]');
  }
  return result;
}

export function assertHostedBootstrapAllowed(env, { platform, uid, gid }) {
  assert.equal(platform, 'linux');
  assert.equal(env.GITHUB_ACTIONS, 'true', 'Hosted GitHub Actions is required');
  assert.equal(env.RUNNER_ENVIRONMENT, 'github-hosted', 'Self-hosted runners are not approved');
  assert.equal(env.RUNNER_OS, 'Linux');
  assert.equal(env.Q2_RUNTIME_ALLOW_HOSTED_BOOTSTRAP, '1', 'Explicit hosted bootstrap opt-in is required');
  assert.ok(Number.isInteger(uid) && uid > 0 && uid !== 65534, 'Launcher must use the ordinary runner UID');
  assert.ok(Number.isInteger(gid) && gid > 0 && gid !== 65534, 'Launcher must use the ordinary runner GID');
}

export function stageInputPlan() {
  return [
    'package.json', 'package-lock.json', 'node_modules',
    'workers/auth/package.json', 'workers/auth/package-lock.json', 'workers/auth/wrangler.jsonc',
    'workers/auth/node_modules', 'workers/auth/src', 'workers/auth/migrations', 'workers/auth/recovery',
    'workers/shared', 'js/shared', 'config', 'scripts/lib/release-compat.mjs',
    'tests/helpers/q2-runtime', 'tests/q2-runtime-native.mjs',
    'tests/q2-runtime-references.mjs', 'tests/q2-runtime-recovery.mjs',
    'tests/q4-runtime-public-video.mjs', 'tests/q4-runtime-stream.mjs', 'tests/q4-runtime-memory.mjs', 'tests/q4-runtime-video.mjs', 'tests/q4-runtime-subscription.mjs',
    'tests/helpers/q4-stream-fixture.mjs', 'tests/helpers/q4-memory-control.mjs', 'tests/helpers/q4-memory-fixture.mjs',
    'tests/helpers/q4-video-control.mjs', 'tests/helpers/q4-subscription-payloads.cjs',
  ];
}

export function resolveArtifactParent(repo, supplied) {
  const source = fs.realpathSync(repo), target = path.resolve(supplied);
  let ancestor = target;
  while (!fs.existsSync(ancestor)) {
    const next = path.dirname(ancestor);
    assert.notEqual(next, ancestor, 'Artifact parent has no existing ancestor');
    ancestor = next;
  }
  const canonical = path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, target));
  assert.ok(!contained(source, canonical), 'Artifacts must be outside the repository');
  return canonical;
}

function forbidden(name) {
  return ['.git', '.ssh', '.aws', '.codex', '.wrangler', '.npmrc', '.netrc'].includes(name)
    || /^(?:\.env|\.dev\.vars)(?:\.|$)/.test(name);
}

// Called only by the ordinary user. No dependency scripts/imports are executed.
export function stageRuntimeInputs(repo, destination, inputs = stageInputPlan()) {
  const sourceRoot = fs.realpathSync(repo);
  const targetRoot = fs.realpathSync(destination);
  assert.ok(!contained(sourceRoot, targetRoot), 'Staging must be outside the repository');
  const dependencyRoots = ['node_modules', 'workers/auth/node_modules'].map(p => path.join(sourceRoot, p));
  let files = 0, symlinks = 0;
  function copy(relative) {
    assert.ok(!path.isAbsolute(relative) && !relative.split(path.sep).includes('..'));
    assert.ok(!relative.split(path.sep).some(forbidden), 'Credential/Git input is forbidden');
    const from = path.join(sourceRoot, relative), to = path.join(targetRoot, relative);
    const info = fs.lstatSync(from);
    fs.mkdirSync(path.dirname(to), { recursive: true, mode: 0o755 });
    if (info.isSymbolicLink()) {
      assert.ok(dependencyRoots.some(base => contained(base, from)), 'Only dependency-internal symlinks are allowed');
      const link = fs.readlinkSync(from), real = fs.realpathSync(from);
      assert.ok(!path.isAbsolute(link) && dependencyRoots.some(base => contained(base, real)), 'Dependency symlink escapes staged dependencies');
      fs.symlinkSync(link, to); symlinks += 1;
    } else if (info.isDirectory()) {
      fs.mkdirSync(to, { recursive: true, mode: 0o755 });
      for (const name of fs.readdirSync(from).sort()) copy(path.join(relative, name));
    } else {
      assert.ok(info.isFile(), 'Sockets, devices and other special build inputs are forbidden');
      assert.equal(info.mode & 0o6000, 0, 'Set-ID build inputs are forbidden');
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(to, info.mode & 0o111 ? 0o755 : 0o644); files += 1;
    }
  }
  for (const input of inputs) copy(input);
  return { files, symlinks, inputs };
}

const ordered = rows => rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
export function canonicalInterfaces(input) {
  assert.ok(Array.isArray(input), 'Expected interface metadata array');
  return ordered(input.map(row => ({ name: row.ifname, index: row.ifindex,
    flags: [...row.flags].sort(), mtu: row.mtu, state: row.operstate ?? null,
    linkType: row.link_type ?? null, master: row.master ?? null,
    address: row.address ?? null,
    addresses: ordered(row.addr_info.map(a => ({ family: a.family, address: a.local,
      peer: a.peer ?? null, broadcast: a.broadcast ?? null, prefix: a.prefixlen,
      scope: a.scope, label: a.label ?? null, flags: [...(a.flags || [])].sort() }))) })));
}

export function canonicalRoutes(input) {
  assert.ok(Array.isArray(input), 'Expected route metadata array');
  const volatile = new Set(['expires', 'expire', 'age', 'cache', 'lastuse', 'last_used', 'used', 'users', 'refcnt', 'ts', 'tsage']);
  const stable = value => {
    if (Array.isArray(value)) return ordered(value.map(stable));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).filter(key => !volatile.has(key)).sort()
      .map(key => [key, stable(value[key])]));
  };
  return ordered(input.map(stable));
}

// Redact individual addresses with a per-execution secret, retained only in
// memory. Equality and field differences remain observable without host IPs.
export function networkFieldDiff(before, after, secret) {
  const protect = (value, key = '') => {
    if (Array.isArray(value)) return value.map(item => protect(item, key));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,protect(v,k)]));
    return typeof value === 'string' && !/^(name|family|scope|state|linkType|flags|master|label|dev|protocol|type|pref|table)$/.test(key)
      ? 'address-' + createHmac('sha256', secret).update(JSON.stringify(value)).digest('hex').slice(0, 20) : value;
  };
  // Interfaces are identified by kernel index + name, not their array position.
  // Insertion of an unrelated interface must not invent changes to every row.
  const keyed = rows => Array.isArray(rows) && rows.every(row => row && typeof row.name === 'string' && Number.isInteger(row.index))
    ? Object.fromEntries(rows.map(row => [`interface:${row.index}:${row.name}`, row])) : rows;
  const left = protect(keyed(before)), right = protect(keyed(after)), changes = [];
  function compare(a, b, field) {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    if (Array.isArray(a) && Array.isArray(b)) {
      for (let i = 0; i < Math.max(a.length, b.length); i++) compare(a[i], b[i], field + '[' + i + ']');
    } else if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) compare(a[key],b[key],field ? field + '.' + key : key);
    } else changes.push({ field, before: a ?? null, after: b ?? null });
  }
  compare(left, right, ''); return changes;
}

function readIp(args) {
  const ip = ['/usr/sbin/ip', '/usr/bin/ip'].find(file => fs.existsSync(file));
  assert.ok(ip, 'Preinstalled iproute2 is required');
  const result = spawnSync(ip, ['-j', ...args], { env: { PATH: '/usr/bin:/bin', LANG: 'C' }, encoding: 'utf8' });
  assert.equal(result.status, 0, 'Cannot read host network metadata');
  return JSON.parse(result.stdout);
}
function hostNetworkSnapshot() {
  const rows = canonicalInterfaces(readIp(['address', 'show']));
  return { rows, sha256: hash(JSON.stringify(rows)), names: rows.map(row => row.name), namespace: fs.readlinkSync('/proc/self/ns/net') };
}
function hostRouteSnapshot() {
  const rows = Object.fromEntries([4,6].map(family => ['ipv' + family, canonicalRoutes(readIp([`-${family}`, 'route', 'show', 'table', 'all']))]));
  return { rows, sha256: hash(JSON.stringify(rows)) };
}
const digestSnapshot = ({ rows, ...summary }) => summary;
export function assertHostedCompletion({ before, after, initial, final }) {
  assert.ok(before?.namespace && after?.namespace, 'Missing host namespace evidence');
  assert.equal(after.namespace, before.namespace, 'Launcher host network namespace changed');
  assert.equal(initial?.passed, true, 'Initial child isolation proof missing or failed');
  assert.equal(final?.passed, true, 'Final child isolation proof missing or failed');
  assert.deepEqual(final.namespaces, initial.namespaces, 'Child isolation namespaces changed');
  assert.notEqual(final.namespaces.net, before.namespace, 'Child shares the host network namespace');
  // Ambient interface/address/route inventories are retained as diagnostics.
  // The privileged bootstrap and child proofs establish our own boundary.
}

export function throwHostedFailures(primary, checks) {
  const errors = [...(primary ? [primary] : []), ...checks];
  if (errors.length) throw new AggregateError(errors, errors.map((error, i) => `${primary && i === 0 ? 'Execution' : 'Postcheck'}: ${error.message}`).join('; '));
}

function systemToolVersions() {
  const versions = {};
  for (const name of ['unshare', 'mount', 'setpriv', 'curl', 'python3']) {
    const executable = '/usr/bin/' + name;
    const result = spawnSync(executable, ['--version'], { env: { PATH: '/usr/bin:/bin', LANG: 'C' }, encoding: 'utf8' });
    assert.equal(result.status, 0, 'Cannot record required system tool version: ' + name);
    versions[name] = { version: (result.stdout || result.stderr).split('\n')[0].slice(0, 200),
      executableSha256: hash(fs.readFileSync(fs.realpathSync(executable))) };
  }
  return versions;
}

export async function runHostedLinux(options) {
  assertHostedBootstrapAllowed(process.env, { platform: process.platform, uid: process.getuid(), gid: process.getgid() });
  assert.equal(Number(process.versions.node.split('.')[0]), 22, 'Use the repository Node22 toolchain');
  const parent = resolveArtifactParent(root, options.artifacts || path.join(os.tmpdir(), 'bitbi-q2-runtime-evidence'));
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  assert.ok(!contained(fs.realpathSync(root), fs.realpathSync(parent)), 'Artifacts must be outside the repository');
  const output = fs.mkdtempSync(path.join(parent, options.preflight ? 'preflight-' : 'native-'));
  const session = fs.mkdtempSync('/tmp/bitbi-q2-linux-');
  const workspace = path.join(session, 'workspace'); fs.mkdirSync(workspace, { mode: 0o755 });
  const preparationBefore = hostNetworkSnapshot();
  const preparationRoutes = hostRouteSnapshot();
  const diffSecret = randomBytes(32);
  let before = null, routesBefore = null, after = null, routesAfter = null;
  const checks = [];
  const systemTools = systemToolVersions();
  const sentinel = net.createServer(socket => socket.destroy());
  await new Promise((resolve, reject) => { sentinel.once('error', reject); sentinel.listen(path.join(session, 'host-control.sock'), resolve); });
  await new Promise((resolve, reject) => {
    const socket = net.connect(path.join(session, 'host-control.sock'));
    socket.once('error', reject); socket.once('connect', () => socket.end()); socket.once('close', resolve);
  });
  let status = null, failure = null, staged = null, nodeSource = null, nodeStaging = null, initial = null, final = null;
  try {
    const executable = fs.realpathSync(process.execPath);
    nodeSource = executableMetadata(executable);
    process.stdout.write(JSON.stringify({ q2NodeSourceMetadata: nodeSource }) + '\n');
    assert.match(executable, /^(?:\/opt\/hostedtoolcache\/node\/22\.\d+\.\d+\/(?:x64|arm64)\/bin\/node|\/usr\/bin\/node)$/,
      'Node must be the canonical hosted Node22 toolchain');
    nodeStaging = stageNodeExecutable(executable, '/proc/self/exe', path.join(session, 'toolchain-node'));
    staged = stageRuntimeInputs(root, workspace);
    const bootstrap = path.join(workspace, 'tests/helpers/q2-runtime/linux-bootstrap.py');
    const args = ['-n', '/usr/bin/env', '-i', 'PATH=/usr/bin:/bin', 'LANG=C',
      'GITHUB_ACTIONS=true', 'RUNNER_ENVIRONMENT=github-hosted', 'RUNNER_OS=Linux', 'Q2_RUNTIME_ALLOW_HOSTED_BOOTSTRAP=1',
      '/usr/bin/python3', '-I', '-S', bootstrap, '--session', session, '--node-sha256', nodeStaging.sha256,
      '--uid', String(process.getuid()), '--gid', String(process.getgid()), '--mode', options.preflight ? 'preflight' : 'runtime'];
    // Snapshot immediately before the privileged/isolated execution. The
    // preceding phase only stages files as the ordinary runner user. Record
    // preparation and ambient drift separately from the child isolation proof.
    before = hostNetworkSnapshot(); routesBefore = hostRouteSnapshot();
    const result = spawnSync('/usr/bin/sudo', args, { env: { PATH: '/usr/bin:/bin', LANG: 'C' },
      stdio: ['ignore', 'inherit', 'inherit'] });
    status = result.status;
    // End the comparison before ordinary-user report copying/cleanup.
    try { after = hostNetworkSnapshot(); routesAfter = hostRouteSnapshot(); }
    catch (error) { checks.push(error); }
    if (result.error) throw new Error('Hosted bootstrap could not start: ' + result.error.code);
    const reports = path.join(session, 'reports');
    if (fs.existsSync(reports)) fs.cpSync(reports, path.join(output, 'reports'), { recursive: true, errorOnExist: true, force: false });
    assert.equal(result.signal, null, 'Hosted bootstrap terminated by signal');
    assert.equal(status, 0, 'Hosted bootstrap/native runtime failed; there is no unisolated fallback');
    initial = JSON.parse(fs.readFileSync(path.join(output, 'reports/isolation-result.json'), 'utf8'));
    final = JSON.parse(fs.readFileSync(path.join(output, 'reports/isolation-final.json'), 'utf8'));
    assertHostedCompletion({ before, after, initial, final });
  } catch (error) { failure = error; }
  finally {
    const hostedImage = {};
    for (const name of ['ImageOS', 'ImageVersion', 'RUNNER_ARCH', 'GITHUB_RUN_ID', 'GITHUB_SHA']) {
      if (process.env[name] && /^[A-Za-z0-9._-]{1,100}$/.test(process.env[name])) hostedImage[name] = process.env[name];
    }
    const report = { mode: options.preflight ? 'preflight' : 'runtime', status, failure: failure?.message || null, staged, hostedImage, systemTools, nodeSource, nodeStaging,
      hostUnixListenerPositiveControl: true,
      configuredBoundary: { namespaces: ['net', 'mount', 'pid', 'ipc'], userNamespace: false,
        bootstrapInterpreter: '/usr/bin/python3 -I -S', fixedSystemTools: ['/usr/bin/unshare', '/usr/bin/mount', '/usr/bin/setpriv'],
        privilegeDrop: ['--reuid=65534', '--regid=65534', '--clear-groups', '--bounding-set=-all', '--inh-caps=-all', '--ambient-caps=-all', '--no-new-privs'] },
      preparationInterfaceDrift: before ? networkFieldDiff(preparationBefore.rows, before.rows, diffSecret) : null,
      preparationRouteDrift: routesBefore ? networkFieldDiff(preparationRoutes.rows, routesBefore.rows, diffSecret) : null,
      hostNetworkBefore: before ? digestSnapshot(before) : null, hostNetworkAfter: after ? digestSnapshot(after) : null,
      hostInterfacesUnchanged: !!before && !!after && before.sha256 === after.sha256 && before.namespace === after.namespace,
      hostInterfaceDiff: before && after ? networkFieldDiff(before.rows, after.rows, diffSecret) : null,
      hostRoutesBefore: routesBefore ? digestSnapshot(routesBefore) : null, hostRoutesAfter: routesAfter ? digestSnapshot(routesAfter) : null,
      hostRoutesUnchanged: !!routesBefore && !!routesAfter && routesBefore.sha256 === routesAfter.sha256,
      hostRouteDiff: routesBefore && routesAfter ? networkFieldDiff(routesBefore.rows, routesAfter.rows, diffSecret) : null,
      childBoundaryVerified: initial?.passed === true && final?.passed === true && !failure,
      topologyScope: 'Ambient host changes are diagnostic, unattributed; child start/end boundaries are mandatory.',
      scope: 'Hosted Linux isolation evidence only; no Cloud/deployment or old invocation drain claim.' };
    if (before && after && before.namespace !== after.namespace) checks.push(new Error('Launcher host network namespace changed'));
    try { await new Promise(resolve => sentinel.close(resolve)); fs.rmSync(session, { recursive: true, force: true }); }
    catch (error) { checks.push(error); }
    report.postcheckFailures = checks.map(error => error.message);
    try { fs.writeFileSync(path.join(output, 'launcher-result.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); }
    catch (error) { checks.push(error); }
    process.stdout.write(JSON.stringify({ q2LinuxEvidence: output, hostInterfacesUnchanged: report.hostInterfacesUnchanged,
      hostRoutesUnchanged: report.hostRoutesUnchanged, executionFailure: failure?.message || null,
      postcheckFailures: checks.map(error => error.message) }) + '\n');
    throwHostedFailures(failure, checks);
  }
}
