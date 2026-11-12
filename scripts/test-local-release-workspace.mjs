import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACKAGES,docker } from './lib/local-release-environment.mjs';
import { dependencyTargets, readMounts, verifyDependencyMounts, prepareReleaseWorkspace,transferNativeReports } from './lib/local-release-workspace.mjs';
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

    const reports=path.join(base,'reports');fs.mkdirSync(path.join(reports,'test-results/private'),{recursive:true,mode:0o700});
    fs.writeFileSync(path.join(reports,'test-results/private/report.json'),'private',{mode:0o600});
    const transport=[];transferNativeReports('bitbi-release-fixture',reports,{run:args=>transport.push(args)});
    assert.deepEqual(transport,[['exec','bitbi-release-fixture','node','/source/scripts/lib/local-release-workspace.mjs','--report-directories'],
      ['cp',`${reports}/test-results/.`,'bitbi-release-fixture:/workspace/test-results/'],
      ['exec','bitbi-release-fixture','node','/source/scripts/lib/local-release-workspace.mjs','--report-owner']]);
    assert.equal(fs.statSync(path.join(reports,'test-results/private/report.json')).mode&0o777,0o600);
    fs.symlinkSync('/outside',path.join(reports,'test-results/escape'));
    assert.throws(()=>transferNativeReports('bitbi-release-fixture',reports,{run:()=>assert.fail('Invalid tree must reject before transport')}),/regular files/);
    assert.throws(()=>transferNativeReports('unrelated-service',reports,{run}),/container name/);

    for (const file of ['scripts/lib/local-release-workspace.mjs', 'scripts/test-local-release-workspace.mjs']) {
      const selection = selectCiTests([file]);
      assert.equal(selection.static, true, file);
      assert.equal(selection.workers, false, file);
      assert.equal(selection.docsOnly, false, file);
    }
    console.log('Workspace preparation controls passed: image identity, fail-closed paths/mount metadata, unchanged Q2 staging and caller selection (portable; not Linux bind acceptance).');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
}

// Actual root-copy -> unprivileged-consumer regression, run by the guarded host
// qualification against a dedicated disposable release container. Never creates
// a VM, starts services or acquires root in the ordinary portable test caller.
export function testNativeReportTransfer(name) {
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-private-report-')));
  const files=['test-results/candidate-static.json','test-results/private/attempt/report.json','candidate-proofs/proof.json'];
  const identity=()=>files.map(file=>({file,mode:fs.statSync(path.join(root,file)).mode&0o777,bytes:fs.readFileSync(path.join(root,file),'utf8')}));
  const read=(uid)=>{
    const code=`const fs=require('fs'),assert=require('assert/strict');assert.equal(process.getuid(),${uid});const rows=${JSON.stringify(files)}.map(file=>({file,mode:fs.statSync('/workspace/'+file).mode&511,bytes:fs.readFileSync('/workspace/'+file,'utf8')}));console.log(JSON.stringify(rows));`;
    return docker(['exec',name,'/usr/bin/setpriv',`--reuid=${uid}`,`--regid=${uid}`,'--clear-groups','--bounding-set=-all','--inh-caps=-all','--ambient-caps=-all','--no-new-privs','node','-e',code]);
  };
  try {
    for(const file of files){fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true,mode:0o700});fs.writeFileSync(path.join(root,file),JSON.stringify({private:file}),{mode:0o600});}
    const before=identity();let rejectedBeforeOwnership=false;
    transferNativeReports(name,root,{run:args=>{
      if(args.at(-1)==='--report-owner'){
        assert.throws(()=>read(1001),/EACCES|permission denied/,'Missing ownership transfer must fail for the real consumer');rejectedBeforeOwnership=true;
      }
      return docker(args);
    }});
    assert(rejectedBeforeOwnership);assert.deepEqual(JSON.parse(read(1001)),before);assert.deepEqual(identity(),before,'Host originals changed');
    assert.throws(()=>read(1002),/EACCES|permission denied/,'Private reports must remain inaccessible to an unrelated user');
    docker(['exec',name,'node','-e',"const fs=require('fs'),assert=require('assert/strict');for(const p of ['test-results','test-results/private','test-results/private/attempt','candidate-proofs']){const s=fs.statSync('/workspace/'+p);assert.equal(s.uid,1001);assert.equal(s.gid,1001);assert.equal(s.mode&511,448);}fs.writeFileSync('/tmp/do-not-own','outside');fs.symlinkSync('/tmp/do-not-own','/workspace/test-results/escape');"]);
    assert.throws(()=>transferNativeReports(name,root),/regular files/,'Destination symlink must reject before copying');
    docker(['exec',name,'node','-e',"const fs=require('fs'),assert=require('assert/strict');assert.equal(fs.statSync('/tmp/do-not-own').uid,0);assert.equal(fs.readFileSync('/tmp/do-not-own','utf8'),'outside');"]);
    console.log('Actual native report transport passed: missing-fix EACCES; UID1001 reads exact private bytes;0600/0700 preserved;UID1002 denied;host originals unchanged;destination symlink rejected without touching its target.');
  } finally {fs.rmSync(root,{recursive:true,force:true});}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if(process.argv[2]==='--native-report-linux'){assert.equal(process.argv.length,4);testNativeReportTransfer(process.argv[3]);}
  else {assert.equal(process.argv.length,2);testReleaseWorkspace();}
}
