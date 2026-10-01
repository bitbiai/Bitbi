import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('actual static build executes knowledge and implementation checks before publication bytes', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const fixture = mkdtempSync(join(tmpdir(), 'bitbi-assistant-build-'));
  const copy = file => { mkdirSync(dirname(join(fixture, file)), { recursive: true }); cpSync(join(root, file), join(fixture, file), { recursive: true }); };
  try {
    for (const file of ['config', 'js/shared', 'workers/shared', 'workers/auth/src', 'workers/auth/package.json', 'scripts/lib',
      'scripts/build-static-site.mjs', 'scripts/check-website-assistant-knowledge.mjs', 'scripts/check-website-assistant-contract.mjs', 'css/components/website-assistant.css']) copy(file);
    const sources = JSON.parse(readFileSync(join(root, 'config/website-assistant-sources.json'), 'utf8')).sources;
    for (const { file } of sources) copy(file);
    const run = entry => spawnSync(process.execPath, [join(fixture, 'scripts', entry)], { cwd: fixture, encoding: 'utf8', timeout: 10000 });
    // The real build executes both checks; no guard or build function is mocked.
    const valid = run('build-static-site.mjs');
    assert.equal(valid.status, 0, valid.stderr + valid.stdout);
    assert.ok(existsSync(join(fixture, '_site/index.html')));
    for (const privatePath of ['config/website-assistant-sources.json', 'config/website-assistant.json', 'workers/shared/website-assistant-content.mjs', 'tests/helpers/website-assistant-policy.mjs']) {
      assert.equal(existsSync(join(fixture, '_site', privatePath)), false, 'Source provenance and synthetic activation fixtures are not public artifacts');
    }
    const canvas = join(fixture, 'canvas/index.html'), original = readFileSync(canvas, 'utf8');
    writeFileSync(canvas, original.replace('Your positions and settings save automatically.', 'test changed product behavior'));
    rmSync(join(fixture, '_site'), { recursive: true });
    const stale = run('build-static-site.mjs');
    assert.notEqual(stale.status, 0); assert.match(stale.stderr, /reviewed public fact changed/);
    assert.equal(existsSync(join(fixture, '_site')), false, 'Rejected facts must not produce publication bytes');
    writeFileSync(canvas, original);
    const retrieval = join(fixture, 'workers/shared/website-assistant-knowledge.mjs');
    writeFileSync(retrieval, readFileSync(retrieval, 'utf8') + '\n// test altered retrieval implementation\n');
    const changed = run('build-static-site.mjs');
    assert.notEqual(changed.status, 0); assert.match(changed.stderr, /assistant inputs changed/);
    assert.equal(existsSync(join(fixture, '_site')), false);
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});
