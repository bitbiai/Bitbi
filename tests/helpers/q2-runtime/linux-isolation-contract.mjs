import assert from 'node:assert/strict';
import fs from 'node:fs';

const namespaces = ['net', 'mnt', 'pid', 'ipc'];
const protectedMounts = ['/runtime/node', '/runtime/curl', '/runtime/setpriv', '/workspace'];
export function readIsolatedBoundary(boundary) {
  const status = fs.readFileSync('/proc/self/status', 'utf8');
  const mounts = fs.readFileSync('/proc/self/mountinfo', 'utf8').trim().split('\n').map(line => line.split(' '));
  return {
    privileges: Object.fromEntries(['Uid', 'Gid', 'Groups', 'CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb', 'NoNewPrivs']
      .map(key => [key, status.match(new RegExp(`^${key}:[\\t ]*(.*)$`, 'm'))?.[1] ?? null])),
    namespaces: Object.fromEntries(namespaces.map(name => [name, fs.readlinkSync('/proc/self/ns/' + name)])),
    interfaces: fs.readFileSync('/proc/net/dev', 'utf8').trim().split('\n').slice(2).map(line => line.split(':')[0].trim()),
    ipv4Routes: fs.readFileSync('/proc/net/route', 'utf8').trim().split('\n').slice(1),
    ipv6Devices: fs.readFileSync('/proc/net/ipv6_route', 'utf8').trim().split('\n').filter(Boolean).map(line => line.trim().split(/\s+/).at(-1)),
    mounts: Object.fromEntries(protectedMounts.map(target => [target, mounts.find(fields => fields[4] === target)?.[5].split(',') || []])),
    exposedPaths: ['/run', '/var/run/docker.sock', '/home/runner', '/root', '/workspace/.git', boundary.host_socket_path].filter(file => fs.existsSync(file)),
    unexpectedEnvironment: Object.keys(process.env).filter(key => !['PATH', 'LANG', 'TZ', 'HOME', 'TMPDIR'].includes(key)),
  };
}
export function assertIsolatedBoundary(snapshot, boundary) {
  for (const key of ['Uid', 'Gid']) assert.deepEqual(snapshot.privileges[key]?.trim().split(/\s+/), ['65534','65534','65534','65534'], key);
  assert.equal(snapshot.privileges.Groups?.trim(), '', 'Supplementary groups must be empty');
  for (const key of ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']) assert.match(snapshot.privileges[key] || '', /^0+$/, key);
  assert.equal(snapshot.privileges.NoNewPrivs, '1');
  for (const name of namespaces) {
    assert.ok(snapshot.namespaces[name] && boundary.private_namespaces[name], 'Missing private namespace');
    assert.notEqual(snapshot.namespaces[name], boundary.parent_namespaces[name], 'Host namespace exposed');
    assert.equal(snapshot.namespaces[name], boundary.private_namespaces[name], 'Private namespace changed');
  }
  assert.deepEqual(snapshot.interfaces, ['lo'], 'Only isolated loopback is allowed');
  assert.deepEqual(snapshot.ipv4Routes, [], 'No external IPv4 route');
  assert.ok(snapshot.ipv6Devices.every(device => device === 'lo'), 'No external IPv6 route');
  for (const target of protectedMounts) assert.ok(['ro','nosuid','nodev'].every(flag => snapshot.mounts[target]?.includes(flag)), 'Protected input mount: ' + target);
  assert.deepEqual(snapshot.exposedPaths, [], 'Host socket/credential paths exposed');
  assert.deepEqual(snapshot.unexpectedEnvironment, [], 'Unexpected inherited environment');
}
