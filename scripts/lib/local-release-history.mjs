import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// The caller refreshes origin and supplies its observed tip. This guard only
// reads objects: a protected linear-history push must introduce no merge commit.
export function assertLinearPublicationHistory(head, remoteHead, { cwd = '.' } = {}) {
  for (const [name, value] of Object.entries({ head, remoteHead }))
    assert(typeof value === 'string' && value.length === 40 && /^[a-f0-9]{40}$/i.test(value), `${name} must be a full 40-hex commit ID`);
  const git = args => execFileSync('git', ['--no-replace-objects', ...args], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  for (const [name, value] of Object.entries({ head, remoteHead }))
    assert.equal(git(['cat-file', '-t', value]), 'commit', `${name} must identify a commit object`);
  try {
    git(['merge-base', '--is-ancestor', remoteHead, head]);
  } catch (error) {
    if (error.status === 1)
      throw new Error('Publication requires the observed remote tip to be an ancestor of HEAD; integrate remote work before validation');
    throw error;
  }
  assert.equal(git(['rev-list', '--merges', `${remoteHead}..${head}`]), '',
    'Publication would introduce merge commits into protected linear history; prepare a linear candidate before validation');
}
