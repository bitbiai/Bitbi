import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { PACKAGES, docker } from './local-release-environment.mjs';

const modules = (root, dir) => path.join(root, dir, 'node_modules');
const realDirectory = directory => {
  assert(fs.lstatSync(directory).isDirectory(), `Expected real directory: ${directory}`);
  assert.equal(fs.realpathSync(directory), directory, `Symlinked directory: ${directory}`);
};

const reportFolders = ['test-results', 'candidate-proofs'];
function regularReportTree(directory) {
  realDirectory(directory);
  for (const name of fs.readdirSync(directory)) {
    const file = path.join(directory, name), stat = fs.lstatSync(file);
    if (stat.isDirectory()) regularReportTree(file);
    else assert(stat.isFile(), 'Native report transport accepts only regular files/directories');
  }
}

function reportDirectoriesInsideContainer(ownership) {
  assert.equal(process.platform, 'linux');assert.equal(process.getuid(), 0);
  assert.equal(process.env.BITBI_LOCAL_RELEASE_CONTAINER, '1');
  realDirectory('/workspace');
  for (const folder of reportFolders) {
    const directory = path.join('/workspace', folder);
    fs.mkdirSync(directory, {recursive:true,mode:0o700});
    regularReportTree(directory);
    // Docker cp creates root-owned files. Preserve private modes and bytes;
    // transfer ownership only in these disposable output trees, never source,
    // dependencies or the host originals. Refuse links rather than follow them.
    if (ownership) execFileSync('chown', ['-R','-P','-h','1001:1001',directory]);
  }
}

export function transferNativeReports(name, work, {run = docker} = {}) {
  assert(/^bitbi-release-[a-zA-Z0-9-]+$/.test(name), 'Unexpected release container name');
  realDirectory(work);
  const folders = reportFolders.filter(folder => fs.lstatSync(path.join(work, folder), {throwIfNoEntry:false}));
  for (const folder of folders) regularReportTree(path.join(work, folder));
  const helper = '/source/scripts/lib/local-release-workspace.mjs';
  run(['exec',name,'node',helper,'--report-directories']);
  for (const folder of folders) run(['cp',`${path.join(work,folder)}/.`,`${name}:/workspace/${folder}/`]);
  run(['exec',name,'node',helper,'--report-owner']);
}

// Resume source may contain only the exact native cache links installed by the
// caller. Never follow those host paths, copy dependency trees, or delete an
// unknown populated directory. Validate every input before changing any of them.
export function dependencyTargets(root, nativePackages = {}) {
  realDirectory(root);
  assert(Object.keys(nativePackages).every(dir => PACKAGES.includes(dir)), 'Unknown native dependency package');
  return PACKAGES.map(dir => {
    const target = modules(root, dir);
    realDirectory(path.dirname(target));
    const stat = fs.lstatSync(target, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) {
      const expected = nativePackages[dir];
      assert(typeof expected === 'string' && path.isAbsolute(expected) && path.basename(expected) === 'node_modules', 'Missing native dependency identity');
      assert.equal(fs.readlinkSync(target), expected, 'Unknown dependency symlink');
    } else if (stat) {
      realDirectory(target);
      assert.equal(fs.readdirSync(target).length, 0, 'Unexpected populated dependency directory');
    }
    return { target, nativeLink: !!stat?.isSymbolicLink() };
  });
}

export function readMounts(text = fs.readFileSync('/proc/self/mountinfo', 'utf8')) {
  const decode = value => value.replace(/\\([0-7]{3})/g, (_, code) => String.fromCharCode(parseInt(code, 8)));
  return text.trim().split('\n').filter(Boolean).map(line => {
    const fields = line.split(' ');
    assert(fields.length >= 10 && fields.includes('-'), 'Malformed mount metadata');
    return { target: decode(fields[4]), options: fields[5].split(',') };
  });
}

export function verifyDependencyMounts(pairs, mounts = readMounts()) {
  for (const { source, target } of pairs) {
    for (const directory of [source, target]) {
      realDirectory(directory);
      const exact = mounts.filter(mount => mount.target === directory);
      assert.equal(exact.length, 1, `Missing or stacked dependency mount: ${directory}`);
      assert(exact[0].options.includes('ro') && !exact[0].options.includes('rw'), `Writable dependency mount: ${directory}`);
      assert(!mounts.some(mount => mount.target.startsWith(directory + '/')), `Nested dependency mount: ${directory}`);
    }
    const from = fs.statSync(source), to = fs.statSync(target);
    assert.equal(to.dev, from.dev, 'Dependency bind device differs');
    assert.equal(to.ino, from.ino, 'Dependency bind inode differs');
  }
}

function prepareInsideContainer(nativePackages) {
  assert.equal(process.platform, 'linux');
  assert.equal(process.getuid(), 0);
  assert.equal(process.env.BITBI_LOCAL_RELEASE_CONTAINER, '1');
  assert.deepEqual(JSON.parse(fs.readFileSync('/etc/bitbi-local-release.json')), { policy: 'development-mac-v1', boundary: 'disposable-container' });
  const sourceRoot = '/source', workspace = '/workspace', dependencies = '/opt/bitbi-deps';
  realDirectory(workspace);
  assert.equal(fs.readdirSync(workspace).length, 0, 'Workspace must be a fresh disposable directory');
  dependencyTargets(sourceRoot, nativePackages);
  realDirectory(dependencies);
  const pairs = PACKAGES.map(dir => ({ source: modules(dependencies, dir), target: modules(workspace, dir) }));
  const existingMounts = readMounts();
  for (const { source } of pairs) {
    realDirectory(source);
    assert(!existingMounts.some(mount => mount.target === source || mount.target.startsWith(source + '/')), 'Image dependency path already has a mount');
  }
  execFileSync('cp', ['-a', '/source/.', '/workspace/']);
  for (const { target, nativeLink } of dependencyTargets(workspace, nativePackages)) {
    if (nativeLink) fs.unlinkSync(target); // this disposable link only, never its target
    fs.mkdirSync(target, { recursive: true });
  }
  fs.mkdirSync('/tmp/bitbi-release/toolcache', { recursive: true });
  fs.mkdirSync('/tmp/bitbi-release/npm', { recursive: true });
  // Ownership traversal covers source/output only, before any dependency mount.
  execFileSync('chown', ['-R', '-P', '-h', '1001:1001', workspace, '/tmp/bitbi-release']);
  for (const { source, target } of pairs) {
    // Protect both aliases. Merely making the workspace bind readonly would
    // leave /opt/bitbi-deps writable through any permissive installed file.
    execFileSync('mount', ['--bind', source, source]);
    execFileSync('mount', ['-o', 'remount,bind,ro', source]);
    execFileSync('mount', ['--bind', source, target]);
    execFileSync('mount', ['-o', 'remount,bind,ro', target]);
  }
  verifyDependencyMounts(pairs);
  return { policy: 'image-dependency-bind-v1', packages: pairs.length };
}

// Used by the real release caller and isolated operator qualification. No VM,
// container, source checkout, credentials or evidence are created here.
export function prepareReleaseWorkspace(name, image, { nativePackages = {}, run = docker } = {}) {
  assert(/^bitbi-release-[a-zA-Z0-9-]+$/.test(name), 'Unexpected release container name');
  assert(/^sha256:[a-f0-9]{64}$/.test(image), 'Expected immutable dependency image ID');
  assert.equal(run(['inspect', '--format', '{{.Image}}', name]).trim(), image, 'Container dependency image differs');
  const output = run(['exec', name, 'node', '/source/scripts/lib/local-release-workspace.mjs', '--prepare', JSON.stringify(nativePackages)]);
  const result = JSON.parse(output);
  assert.deepEqual(result, { policy: 'image-dependency-bind-v1', packages: PACKAGES.length });
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (['--report-directories','--report-owner'].includes(process.argv[2])) {
    assert.equal(process.argv.length, 3);reportDirectoriesInsideContainer(process.argv[2] === '--report-owner');
  } else {
    assert.equal(process.argv[2], '--prepare');assert.equal(process.argv.length, 4);
    console.log(JSON.stringify(prepareInsideContainer(JSON.parse(process.argv[3]))));
  }
}
