import fs from 'node:fs';
import net from 'node:net';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

assert.ok(process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--final'));
const reportPath = process.argv[2] === '--final' ? '/artifacts/linux-child-probe-final.json' : '/artifacts/linux-child-probe.json';
const report = { passed: false, checks: [], uid: process.getuid(), gid: process.getgid() };
const runCurl = args => new Promise((resolve, reject) => {
  const child = spawn('/runtime/curl', args, { env: { LANG: 'C', HOME: '/home/q2' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', bytes => { stdout += bytes; }); child.stderr.on('data', bytes => { stderr += bytes; });
  child.once('error', reject); child.once('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
});
const connectionError = options => new Promise((resolve, reject) => {
  const socket = net.connect(options);
  const timer = setTimeout(() => { socket.destroy(); reject(new Error('A timeout is not a network-boundary proof')); }, 3000);
  socket.once('connect', () => { clearTimeout(timer); socket.destroy(); reject(new Error('Forbidden connection succeeded')); });
  socket.once('error', error => { clearTimeout(timer); resolve(error.code); });
});
let server;
try {
  assert.equal(report.uid, 65534); assert.equal(report.gid, 65534);
  assert.ok(process.getgroups().every(group => group === 65534));
  const status = fs.readFileSync('/proc/self/status', 'utf8');
  report.privilegeState = Object.fromEntries(['Uid', 'Gid', 'Groups', 'CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb', 'NoNewPrivs']
    .map(key => [key, status.match(new RegExp(`^${key}:[\\t ]*(.*)$`, 'm'))?.[1] ?? null]));
  for (const key of ['Uid', 'Gid']) assert.deepEqual(report.privilegeState[key].trim().split(/\s+/), ['65534', '65534', '65534', '65534']);
  assert.match(status, /^Groups:[\t ]*$/m);
  for (const key of ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']) assert.match(status, new RegExp(`^${key}:\\s+0+$`, 'm'));
  assert.match(status, /^NoNewPrivs:\s+1$/m);
  assert.throws(() => process.setuid(0), { code: 'EPERM' });
  report.checks.push('native_child_inherits_uid_groups_caps_nnp');
  report.denials = [];
  for (const [family, host, url] of [[4, '192.0.2.1', 'http://192.0.2.1:9/'], [6, '2001:db8::1', 'http://[2001:db8::1]:9/']]) {
    const nodeError = await connectionError({ host, port: 9, family });
    assert.equal(nodeError, 'ENETUNREACH');
    const denied = await runCurl(['--noproxy', '*', '--connect-timeout', '2', '--max-time', '3', '--verbose', url]);
    assert.equal(denied.status, 7); assert.equal(denied.signal, null);
    assert.match(denied.stderr, /Network is unreachable/);
    report.denials.push({ family, nodeError, nativeCurlExit: denied.status, networkUnreachable: true });
  }
  report.checks.push('native_tcp_ipv4_ipv6_ENETUNREACH', 'system_curl_ipv4_ipv6_network_unreachable');
  const boundary = JSON.parse(fs.readFileSync('/runtime/boundary.json', 'utf8'));
  assert.equal(await connectionError({ path: boundary.host_socket_path }), 'ENOENT');
  report.checks.push('existing_host_unix_socket_absent');
  server = net.createServer(socket => socket.once('data', () => socket.end('HTTP/1.1 200 OK\r\nContent-Length: 11\r\nConnection: close\r\n\r\nq2-loopback')));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const local = await runCurl(['--noproxy', '*', '--connect-timeout', '2', '--max-time', '3', '--silent', '--show-error',
    `http://127.0.0.1:${server.address().port}/`]);
  assert.equal(local.status, 0); assert.equal(local.stdout, 'q2-loopback');
  report.checks.push('native_curl_loopback_positive_control'); report.passed = true;
} catch (error) { report.error = { name: error.name, message: error.message }; process.exitCode = 1; }
finally {
  if (server) await new Promise(resolve => server.close(resolve));
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
}
