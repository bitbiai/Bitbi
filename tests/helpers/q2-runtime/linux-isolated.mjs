import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readIsolatedBoundary, assertIsolatedBoundary } from './linux-isolation-contract.mjs';

// This is the FIRST Node/project entry after fixed system setpriv. No loopback
// setup or other privileged operation is performed by Node.
assert.equal(process.platform, 'linux');
const report = { passed: false, checks: [], scope: 'Local hosted isolation, not production/runtime acceptance' };
let boundary, primary;
try {
  boundary = JSON.parse(fs.readFileSync('/runtime/boundary.json', 'utf8'));
  assertIsolatedBoundary(readIsolatedBoundary(boundary), boundary);
  assert.equal(process.getuid(), 65534); assert.equal(process.getgid(), 65534);
  assert.ok(process.getgroups().every(group => group === 65534));
  const status = fs.readFileSync('/proc/self/status', 'utf8');
  report.privilegeState = Object.fromEntries(['Uid', 'Gid', 'Groups', 'CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb', 'NoNewPrivs']
    .map(key => [key, status.match(new RegExp(`^${key}:[\\t ]*(.*)$`, 'm'))?.[1] ?? null]));
  for (const key of ['Uid', 'Gid']) assert.deepEqual(report.privilegeState[key].trim().split(/\s+/), ['65534', '65534', '65534', '65534']);
  assert.match(status, /^Groups:[\t ]*$/m, 'Supplementary groups must be empty (Node may include its effective GID)');
  for (const key of ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']) {
    assert.match(status, new RegExp(`^${key}:\\s+0+$`, 'm'), `${key} must be empty`);
  }
  assert.match(status, /^NoNewPrivs:\s+1$/m);
  for (const name of ['net', 'mnt', 'pid', 'ipc']) {
    assert.notEqual(fs.readlinkSync('/proc/self/ns/' + name), boundary.parent_namespaces[name]);
  }
  assert.equal(process.pid, 1, 'The unprivileged entry must be init in its private PID namespace');
  assert.deepEqual(fs.readdirSync('/proc').filter(name => /^\d+$/.test(name)), ['1'], 'No host processes may be visible');
  assert.equal(process.env.HOME, '/home/q2');
  assert.equal(Number(process.versions.node.split('.')[0]), 22);
  assert.equal(createHash('sha256').update(fs.readFileSync(process.execPath)).digest('hex'), boundary.node_sha256);
  const nodeFile = fs.statSync(process.execPath);
  assert.ok(nodeFile.isFile()); assert.equal(nodeFile.uid, 0); assert.equal(nodeFile.mode & 0o7777, 0o555);
  const mounts = fs.readFileSync('/proc/self/mountinfo', 'utf8').trim().split('\n').map(line => line.split(' '));
  for (const target of ['/runtime/node', '/runtime/curl', '/runtime/setpriv', '/workspace']) {
    const flags = mounts.find(fields => fields[4] === target)?.[5].split(',');
    assert.ok(flags && ['ro', 'nosuid', 'nodev'].every(flag => flags.includes(flag)) && !flags.includes('noexec'),
      'Executable inputs require an isolated RO/nosuid/nodev executable mount: ' + target);
  }
  report.nodeVersion = process.versions.node; report.kernelRelease = os.release(); report.nodeSha256 = boundary.node_sha256;
  report.namespaces = Object.fromEntries(['net', 'mnt', 'pid', 'ipc'].map(name => [name, fs.readlinkSync('/proc/self/ns/' + name)]));
  assert.equal(fs.statSync(process.env.HOME).mode & 0o777, 0o700);
  for (const key of Object.keys(process.env)) assert.ok(['PATH', 'LANG', 'TZ', 'HOME', 'TMPDIR'].includes(key), 'Unexpected inherited environment key');
  for (const file of ['/run', '/var/run/docker.sock', '/home/runner', '/root', '/workspace/.git', boundary.host_socket_path]) {
    assert.equal(fs.existsSync(file), false, 'Host/credential path must be absent: ' + file);
  }
  for (const fd of fs.readdirSync('/proc/self/fd')) {
    try { assert.ok(!fs.readlinkSync('/proc/self/fd/' + fd).startsWith('socket:'), 'An unexpected socket was inherited'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const interfaces = os.networkInterfaces();
  assert.deepEqual(Object.keys(interfaces), ['lo']);
  const allInterfaces = fs.readFileSync('/proc/net/dev', 'utf8').trim().split('\n').slice(2).map(line => line.split(':')[0].trim());
  assert.deepEqual(allInterfaces, ['lo'], 'Unconfigured host interfaces must also be absent');
  const ipv4Routes = fs.readFileSync('/proc/net/route', 'utf8').trim().split('\n').slice(1);
  assert.deepEqual(ipv4Routes, [], 'No IPv4 main-table route may leave this fresh namespace');
  const ipv6Routes = fs.readFileSync('/proc/net/ipv6_route', 'utf8').trim().split('\n').filter(Boolean);
  assert.ok(ipv6Routes.every(line => line.trim().split(/\s+/).at(-1) === 'lo'), 'No IPv6 route may reference a non-loopback device');
  report.network = { allInterfaces, ipv4Routes, ipv6Routes };
  assert.ok(interfaces.lo.some(address => address.address === '127.0.0.1'));
  assert.throws(() => process.setuid(0), { code: 'EPERM' });
  assert.throws(() => process.setgid(0), { code: 'EPERM' });
  assert.ok(fs.readFileSync('/proc/self/mountinfo', 'utf8').split('\n').some(line => line.split(' ')[4] === '/workspace'
    && line.split(' ')[5].split(',').includes('ro')), 'Workspace must actually be a read-only mount');
  assert.throws(() => fs.writeFileSync('/workspace/q2-isolation-must-not-write', ''), error => ['EROFS', 'EACCES'].includes(error.code));
  report.checks.push('unprivileged_uid_gid_groups', 'capabilities_empty_nnp', 'private_net_mount_pid_ipc',
    'minimal_root_private_home_no_host_sockets', 'no_privilege_regain', 'workspace_read_only');
  // Separate executable child checks inherited restrictions and real native
  // curl/TCP behavior. A timeout or DNS error never counts as network denial.
  const child = spawnSync(process.execPath, ['/workspace/tests/helpers/q2-runtime/linux-child-probe.mjs'],
    { env: process.env, encoding: 'utf8', timeout: 15000, maxBuffer: 128 * 1024 });
  assert.equal(child.error, undefined, 'Native isolation child must complete');
  assert.equal(child.status, 0, 'Native isolation child failed: ' + child.stderr.slice(0, 1000));
  const proof = JSON.parse(fs.readFileSync('/artifacts/linux-child-probe.json', 'utf8'));
  assert.equal(proof.passed, true);
  report.checks.push('native_child_denial_and_loopback_control');
  // Catch actual loader/library/executable-mount failures before the long
  // Worker suite. This is still preflight, not the Q2 business acceptance.
  const requireAuth = createRequire('/workspace/workers/auth/package.json');
  const lock = JSON.parse(fs.readFileSync('/workspace/workers/auth/package-lock.json', 'utf8'));
  report.nativeTools = {};
  for (const name of ['workerd', 'esbuild']) {
    const installed = JSON.parse(fs.readFileSync(`/workspace/workers/auth/node_modules/${name}/package.json`, 'utf8'));
    assert.equal(installed.version, lock.packages[`node_modules/${name}`].version);
    report.nativeTools[name] = installed.version;
  }
  const workerd = requireAuth('workerd').default;
  const version = spawnSync(workerd, ['--version'], { env: process.env, encoding: 'utf8', timeout: 15000, maxBuffer: 64 * 1024 });
  assert.equal(version.error, undefined);
  assert.equal(version.status, 0, 'Pinned workerd loader failed: ' + version.stderr.slice(0, 1000));
  assert.equal(version.signal, null);
  assert.match(version.stdout, /workerd/);
  report.nativeTools.workerdExecutableSha256 = createHash('sha256').update(fs.readFileSync(workerd)).digest('hex');
  const transformed = requireAuth('esbuild').transformSync('export const q2 = 2;', { loader: 'js', format: 'esm' });
  assert.match(transformed.code, /q2/);
  report.checks.push('pinned_workerd_loader_and_esbuild_native_start');
  report.passed = true;
  fs.writeFileSync('/artifacts/isolation-result.json', JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  if (boundary.mode === 'runtime') {
    // The builder deliberately sanitizes/replaces its environment. Keep it in
    // an unprivileged child; the supervising entry can check its own original
    // boundary after all runtime work returns, including a failed build/test.
    const runtime = spawnSync(process.execPath, ['/workspace/tests/helpers/q2-runtime/linux-runtime-child.mjs'],
      { env: process.env, stdio: 'inherit' });
    assert.equal(runtime.error, undefined, 'Native runtime child must start');
    assert.equal(runtime.signal, null, 'Native runtime child terminated by signal');
    assert.equal(runtime.status, 0, 'Native runtime child failed; retained suite reports are authoritative');
  } else assert.equal(boundary.mode, 'preflight');
} catch (error) {
  if (!fs.existsSync('/artifacts/isolation-result.json')) {
    report.error = { name: error.name, message: error.message };
    fs.writeFileSync('/artifacts/isolation-result.json', JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  }
  primary = error;
} finally {
  const final = { passed: false, phase: 'after-execution', scope: 'Child isolation postcheck; not a product pass' };
  let postcheck;
  try {
    assert.ok(boundary, 'Initial private boundary missing');
    const snapshot = readIsolatedBoundary(boundary);
    final.snapshot = snapshot; final.namespaces = snapshot.namespaces;
    assertIsolatedBoundary(snapshot, boundary);
    assert.throws(() => process.setuid(0), { code: 'EPERM' });
    assert.throws(() => fs.writeFileSync('/workspace/q2-isolation-must-not-write', ''), error => ['EROFS', 'EACCES'].includes(error.code));
    const child = spawnSync(process.execPath, ['/workspace/tests/helpers/q2-runtime/linux-child-probe.mjs', '--final'],
      { env: process.env, encoding: 'utf8', timeout: 15000, maxBuffer: 128 * 1024 });
    assert.equal(child.error, undefined); assert.equal(child.status, 0, child.stderr);
    assert.equal(JSON.parse(fs.readFileSync('/artifacts/linux-child-probe-final.json', 'utf8')).passed, true);
    final.passed = true;
  } catch (error) { postcheck = error; final.error = { name: error.name, message: error.message }; }
  fs.writeFileSync('/artifacts/isolation-final.json', JSON.stringify(final, null, 2) + '\n', { flag: 'wx' });
  if (primary || postcheck) throw new AggregateError([primary, postcheck].filter(Boolean),
    [primary && 'Execution: ' + primary.message, postcheck && 'Boundary postcheck: ' + postcheck.message].filter(Boolean).join('; '));
}
