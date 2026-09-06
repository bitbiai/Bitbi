import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

// Launched exclusively as the unshare child. Configuring lo affects only this
// verified new network namespace; never the host's interfaces or firewall.
assert.equal(process.platform, 'linux');
const parentNamespace = process.argv[2];
assert.match(parentNamespace || '', /^net:\[\d+\]$/);
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'), parentNamespace, 'A fresh network namespace is mandatory');
const ip = ['/usr/sbin/ip', '/sbin/ip', '/usr/bin/ip', '/bin/ip'].find(file => fs.existsSync(file));
assert.ok(ip, 'iproute2 must already be available; this runner installs nothing');
const configured = spawnSync(ip, ['link', 'set', 'lo', 'up'], { env: process.env, encoding: 'utf8' });
assert.equal(configured.status, 0, 'Cannot enable loopback in isolated namespace');
const interfaces = os.networkInterfaces();
assert.deepEqual(Object.keys(interfaces), ['lo'], 'Only loopback may exist in native test namespace');
assert.ok(interfaces.lo.some(address => address.address === '127.0.0.1'));
const { runQ2Runtime } = await import('./runner.mjs');
await runQ2Runtime(process.argv.slice(3));
