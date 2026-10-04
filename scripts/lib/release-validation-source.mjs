import fs from 'node:fs';
import path from 'node:path';

// Contract tests inspect both the actual local command owner and the unchanged
// protected publication steps. This is test input, never a runnable workflow or
// a source of fabricated GitHub job results. local-release tests separately
// inspect the real workflow and assert that no migrated suite remains there.
export function releaseValidationSource(root = '.') {
  const commands = fs.readFileSync(path.join(root, 'config/release-validation.yml'), 'utf8');
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/static.yml'), 'utf8');
  return commands + '\n' + workflow.slice(workflow.indexOf('  reuse-candidate:'));
}
