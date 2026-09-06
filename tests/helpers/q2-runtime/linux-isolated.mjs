import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// This is the FIRST Node/project entry after fixed system setpriv. No loopback
// setup or other privileged operation is performed by Node.
assert.equal(process.platform, 'linux');
const report = { passed: false, checks: [], scope: 'Local hosted isolation, not production/runtime acceptance' };
try {
  const boundary = JSON.parse(fs.readFileSync('/runtime/boundary.json', 'utf8'));
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
  report.passed = true;
  fs.writeFileSync('/artifacts/isolation-result.json', JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  if (boundary.mode === 'runtime') {
    const { runQ2Runtime } = await import('./runner.mjs');
    await runQ2Runtime(['--artifacts', '/artifacts']);
  } else assert.equal(boundary.mode, 'preflight');
} catch (error) {
  if (!fs.existsSync('/artifacts/isolation-result.json')) {
    report.error = { name: error.name, message: error.message };
    fs.writeFileSync('/artifacts/isolation-result.json', JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  }
  throw error;
}
