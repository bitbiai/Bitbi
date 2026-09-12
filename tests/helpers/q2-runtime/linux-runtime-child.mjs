// Only started after the hosted bootstrap has dropped all privileges.
import assert from 'node:assert/strict';
assert.equal(process.platform, 'linux');
assert.equal(process.getuid(), 65534);
assert.equal(process.getgid(), 65534);
const {readFileSync} = await import('node:fs');
const {suite} = JSON.parse(readFileSync('/runtime/boundary.json'));
assert.ok(!suite || suite === 'member-generation');
const { runQ2Runtime } = await import('./runner.mjs');
await runQ2Runtime(['--artifacts', '/artifacts'], suite);
