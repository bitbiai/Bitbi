import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { prepareRecovery } from '../scripts/prepare-q2-recovery.mjs';

const root = fs.realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'q2-stager-regression-'));
const input = path.join(tmp, 'candidate.js');
const bytes = Buffer.from('export default { fetch() {}, scheduled() {}, queue() {} };\n');
fs.writeFileSync(input, bytes);
const hash = crypto.createHash('sha256').update(bytes).digest('hex');
const stage = outdir => prepareRecovery({ candidate: input, expectedSha256: hash, outdir });

test('wrong candidate hash writes no output', () => {
  const output = path.join(tmp, 'wrong-hash');
  assert.throws(() => prepareRecovery({ candidate: input, expectedSha256: '0'.repeat(64), outdir: output }), /hash mismatch/);
  assert.equal(fs.existsSync(output), false);
});
test('private stage preserves every module byte and remains explicitly unverified', () => {
  const output = path.join(tmp, 'prepared');
  const { manifest } = stage(output);
  assert.deepEqual(fs.readFileSync(path.join(output, 'b-index.js')), bytes);
  for (const name of ['c-entry.mjs', 'restriction-adapter.mjs']) {
    assert.deepEqual(fs.readFileSync(path.join(output, name)), fs.readFileSync(path.join(root, 'workers/auth/recovery', name)));
  }
  assert.equal(manifest.files.length, 3);
  for (const file of manifest.files) {
    const content = fs.readFileSync(path.join(output, file.name));
    assert.equal(file.sha256, crypto.createHash('sha256').update(content).digest('hex'));
    assert.equal(file.size, content.length);
    if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(output, file.name)).mode & 0o777, 0o600);
  }
  if (process.platform !== 'win32') assert.equal(fs.statSync(output).mode & 0o777, 0o700);
  assert.match(manifest.validation, /^UNVERIFIED/);
  assert.match(manifest.activation, /^NOT PERFORMED/);
  assert.throws(() => stage(output), /EEXIST/);
  assert.deepEqual(fs.readFileSync(path.join(output, 'b-index.js')), bytes);
});
test('repository paths and symlink aliases cannot receive private artifacts', () => {
  assert.throws(() => stage(path.join(root, 'q2-stager-must-not-exist')), /outside the repository/);
  const link = path.join(tmp, 'repo-alias');
  fs.symlinkSync(root, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => stage(path.join(link, 'q2-stager-must-not-exist')), /outside the repository/);
  assert.equal(fs.existsSync(path.join(root, 'q2-stager-must-not-exist')), false);
});
test('existing files and dangling links are not overwritten', () => {
  const file = path.join(tmp, 'existing'); fs.writeFileSync(file, 'preserve');
  assert.throws(() => stage(file), /EEXIST/); assert.equal(fs.readFileSync(file, 'utf8'), 'preserve');
  const link = path.join(tmp, 'dangling'); fs.symlinkSync(path.join(tmp, 'absent'), link);
  assert.throws(() => stage(link), /EEXIST/); assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
});
