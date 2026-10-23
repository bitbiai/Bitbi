import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertLinearPublicationHistory } from './lib/local-release-history.mjs';

export function testLinearPublicationHistory() {
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bitbi-linear-publication-'));
try {
  const git = args => execFileSync('git', args, {
    cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(directory, 'no-global-config') },
  }).trim();
  git(['init', '--initial-branch=main', '--template=']);
  git(['config', 'user.name', 'Release history fixture']);
  git(['config', 'user.email', 'release-history@example.invalid']);
  const commit = name => {
    git(['-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '--no-gpg-sign', '-m', name]);
    return git(['rev-parse', 'HEAD']);
  };
  fs.writeFileSync(path.join(directory, 'tracked.txt'), 'original\n');
  git(['add', 'tracked.txt']);
  const base = commit('base');
  const linear = commit('linear child');
  git(['checkout', '-b', 'other', base]);
  const divergent = commit('other child');
  git(['checkout', 'main']);
  git(['-c', 'core.hooksPath=/dev/null', 'merge', '--no-ff', '--no-gpg-sign', '-m', 'merge fixture', 'other']);
  const merged = git(['rev-parse', 'HEAD']);
  const afterMerge = commit('linear child after existing merge');
  const blob = git(['rev-parse', `${base}:tracked.txt`]);
  git(['tag', '-a', 'annotated', '-m', 'tag is not a commit', base]);
  const tag = git(['rev-parse', 'refs/tags/annotated']);
  // Leave both staged and unstaged work, plus an untracked file. Every call must
  // preserve these as well as all refs, including rejection paths.
  fs.writeFileSync(path.join(directory, 'tracked.txt'), 'staged\n');
  git(['add', 'tracked.txt']);
  fs.appendFileSync(path.join(directory, 'tracked.txt'), 'unstaged\n');
  fs.writeFileSync(path.join(directory, 'untracked.txt'), 'preserve me\n');
  const snapshot = () => ({
    refs: git(['show-ref']), head: git(['rev-parse', 'HEAD']),
    status: git(['status', '--porcelain=v1']), index: git(['ls-files', '--stage']),
    staged: git(['diff', '--cached']), unstaged: git(['diff']),
    untracked: fs.readFileSync(path.join(directory, 'untracked.txt'), 'utf8'),
  });
  let checks = 0;
  const check = (head, remoteHead, failure) => {
    const before = snapshot();
    const invoke = () => assertLinearPublicationHistory(head, remoteHead, { cwd: directory });
    if (failure) assert.throws(invoke, failure);
    else assert.doesNotThrow(invoke);
    assert.deepEqual(snapshot(), before, 'History guard must preserve refs, index and local work');
    checks++;
  };
  check(linear, base);
  check(linear, linear);
  check(afterMerge, merged); // Already-published history is outside this range.
  check(merged, base, /introduce merge commits/);
  check(afterMerge, base, /introduce merge commits/); // Not just the tip commit.
  check(base, linear, /remote tip to be an ancestor/);
  check(linear, divergent, /remote tip to be an ancestor/);
  check(blob, base, /commit object/);
  check(linear, tag, /commit object/);
  check('0'.repeat(40), base, /Command failed/);
  for (const invalid of [null, '', 'main', linear.slice(0, 12), `${linear}\n`, '--all', 'g'.repeat(40)]) {
    check(invalid, base, /full 40-hex commit ID/);
    check(linear, invalid, /full 40-hex commit ID/);
  }
  console.log(`Local release history: ${checks} actual-Git controls passed; refs and local work preserved`);
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) testLinearPublicationHistory();
