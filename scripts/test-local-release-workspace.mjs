import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACKAGES } from './lib/local-release-environment.mjs';
import { dependencyTargets, readMounts, verifyDependencyMounts, prepareReleaseWorkspace } from './lib/local-release-workspace.mjs';
import { stageRuntimeInputs } from '../tests/helpers/q2-runtime/linux-hosted.mjs';
import { selectCiTests } from './lib/ci-test-selection.mjs';

export function testReleaseWorkspace() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bitbi-workspace-test-')));
  try {
    const source = path.join(base, 'source');
    for (const dir of PACKAGES) fs.mkdirSync(path.join(source, dir), { recursive: true });
    assert.equal(dependencyTargets(source).length, PACKAGES.length);
    const target = path.join(source, 'node_modules'), native = path.join(base, 'native/node_modules');
    fs.symlinkSync(native, target); // intentionally dangling in the Linux source view
    assert.throws(() => dependencyTargets(source), /Missing native dependency identity/);
    assert.throws(() => dependencyTargets(source, { '': '/unexpected/node_modules' }), /Unknown dependency symlink/);
    const targets = dependencyTargets(source, { '': native });
    assert.equal(targets[0].nativeLink, true);
    assert(fs.lstatSync(target).isSymbolicLink(), 'Validation must not alter the original resume source');
    assert.throws(() => dependencyTargets(source, { unknown: native }), /Unknown native dependency/);
    fs.unlinkSync(target);
    fs.mkdirSync(target);
    assert.equal(dependencyTargets(source)[0].nativeLink, false);
    fs.writeFileSync(path.join(target, 'keep'), 'do not delete');
    assert.throws(() => dependencyTargets(source), /Unexpected populated/);
    assert.equal(fs.readFileSync(path.join(target, 'keep'), 'utf8'), 'do not delete');
    fs.unlinkSync(path.join(target, 'keep'));
    fs.rmdirSync(path.join(source, 'workers/contact'));
    fs.symlinkSync(base, path.join(source, 'workers/contact'));
    assert.throws(() => dependencyTargets(source), /Expected real directory|Symlinked/);
    fs.unlinkSync(path.join(source, 'workers/contact'));
    fs.mkdirSync(path.join(source, 'workers/contact'));

    // Portable metadata controls only. Actual Linux bind/mutation acceptance is
    // a separate container run; two ordinary directories must NOT pass as a bind.
    const line = (directory, options = 'ro,relatime') => `100 25 0:40 / ${directory.replaceAll(' ', '\\040')} ${options} - overlay overlay rw\n`;
    const mounts = readMounts(line(target));
    assert.equal(mounts[0].target, target);
    verifyDependencyMounts([{ source: target, target }], mounts);
    assert.throws(() => verifyDependencyMounts([{ source: target, target }], []), /Missing or stacked/);
    assert.throws(() => verifyDependencyMounts([{ source: target, target }], [...mounts, ...mounts]), /Missing or stacked/);
    assert.throws(() => verifyDependencyMounts([{ source: target, target }], readMounts(line(target, 'rw,relatime'))), /Writable/);
    assert.throws(() => verifyDependencyMounts([{ source: target, target }], readMounts(line(target) + line(target + '/nested'))), /Nested/);
    const other = path.join(base, 'not-the-image'); fs.mkdirSync(other);
    assert.throws(() => verifyDependencyMounts([{ source: target, target: other }], readMounts(line(target) + line(other))), /inode differs/);
    assert.equal(readMounts(line('/path with space'))[0].target, '/path with space');
    assert.throws(() => readMounts('bad metadata'), /Malformed/);

    // The unchanged real Q2 copier accepts directory dependencies plus their
    // internal relative links, while its escaping-link countercontrol rejects.
    fs.mkdirSync(path.join(target, 'package'));
    fs.mkdirSync(path.join(target, '.bin'));
    fs.writeFileSync(path.join(target, 'package/main.mjs'), 'export default 1;\n');
    fs.symlinkSync('../package/main.mjs', path.join(target, '.bin/tool'));
    const staged = path.join(base, 'staged'); fs.mkdirSync(staged);
    assert.equal(stageRuntimeInputs(source, staged, ['node_modules']).files, 1);
    assert.equal(fs.readlinkSync(path.join(staged, 'node_modules/.bin/tool')), '../package/main.mjs');
    fs.symlinkSync('/outside', path.join(target, 'escape'));
    const broken = path.join(base, 'broken'); fs.mkdirSync(broken);
    assert.throws(() => stageRuntimeInputs(source, broken, ['node_modules']));

    const image = 'sha256:' + 'a'.repeat(64), calls = [];
    const run = args => { calls.push(args); return args[0] === 'inspect' ? image + '\n' : JSON.stringify({ policy: 'image-dependency-bind-v1', packages: PACKAGES.length }); };
    assert.equal(prepareReleaseWorkspace('bitbi-release-fixture', image, { run, nativePackages: { '': native } }).packages, 5);
    assert.deepEqual(calls.map(args => args[0]), ['inspect', 'exec']);
    assert.deepEqual(calls[1], ['exec', 'bitbi-release-fixture', 'node', '/source/scripts/lib/local-release-workspace.mjs', '--prepare', JSON.stringify({ '': native })]);
    assert.throws(() => prepareReleaseWorkspace('bitbi-release-fixture', image, { run: () => 'sha256:' + 'b'.repeat(64) }), /image differs/);
    assert.throws(() => prepareReleaseWorkspace('bitbi-release-fixture', 'mutable-tag', { run }), /immutable/);
    assert.throws(() => prepareReleaseWorkspace('unrelated-service', image, { run }), /container name/);
    assert.throws(() => prepareReleaseWorkspace('bitbi-release-fixture', image, { run: args => args[0] === 'inspect' ? image : '{"packages":0}' }));

    for (const file of ['scripts/lib/local-release-workspace.mjs', 'scripts/test-local-release-workspace.mjs']) {
      const selection = selectCiTests([file]);
      assert.equal(selection.static, true, file);
      assert.equal(selection.workers, false, file);
      assert.equal(selection.docsOnly, false, file);
    }
    console.log('Workspace preparation controls passed: image identity, fail-closed paths/mount metadata, unchanged Q2 staging and caller selection (portable; not Linux bind acceptance).');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) testReleaseWorkspace();
