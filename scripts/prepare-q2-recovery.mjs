// Local artifact preparation only. This script never contacts Cloudflare.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fs.realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const inside = (parent, child) => child === parent || child.startsWith(parent + path.sep);

export function prepareRecovery({ candidate, expectedSha256, outdir }) {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256 || '')) throw new Error('An exact candidate SHA-256 is required.');
  const input = fs.realpathSync(candidate);
  if (!fs.statSync(input).isFile()) throw new Error('Candidate must be a regular module file.');
  const bytes = fs.readFileSync(input);
  if (sha256(bytes) !== expectedSha256) throw new Error('Candidate hash mismatch.');
  const output = path.resolve(outdir);
  const parent = fs.realpathSync(path.dirname(output));
  const resolvedOutput = path.join(parent, path.basename(output));
  if (inside(root, resolvedOutput)) throw new Error('Recovery artifacts must remain outside the repository.');
  // mkdir is exclusive: existing directories, files and symlinks are rejected.
  fs.mkdirSync(resolvedOutput, { mode: 0o700 });
  const modules = [
    ['b-index.js', bytes],
    ['c-entry.mjs', fs.readFileSync(path.join(root, 'workers/auth/recovery/c-entry.mjs'))],
    ['restriction-adapter.mjs', fs.readFileSync(path.join(root, 'workers/auth/recovery/restriction-adapter.mjs'))],
  ];
  const files = modules.map(([name, content]) => {
    fs.writeFileSync(path.join(resolvedOutput, name), content, { flag: 'wx', mode: 0o600 });
    return { name, size: content.length, sha256: sha256(content) };
  });
  const inputs = ['workers/auth/wrangler.jsonc', 'workers/auth/package-lock.json',
    'workers/auth/migrations/0081_add_ai_dispatch_outcome_guards.sql',
    'workers/auth/migrations/0082_add_admin_mfa_mutation_guard.sql',
    'workers/auth/migrations/0083_add_r2_cleanup_reference_fence.sql'].map(name => ({
    name, sha256: sha256(fs.readFileSync(path.join(root, name))),
  }));
  const manifest = {
    format: 'bitbi-q2-restricted-recovery-v1', entrypoint: 'c-entry.mjs', files, inputs,
    candidateSha256: expectedSha256, preparedAt: new Date().toISOString(),
    validation: 'UNVERIFIED: requires the native runtime suite against these exact modules and schema inputs',
    activation: 'NOT PERFORMED; requires separately satisfied release gates',
    limits: [
      'Single self-contained Wrangler module required; hash equality alone does not prove its dependency closure or serving identity.',
      'Restricted login/MFA/diagnostics only, not full business recovery.',
      '0081/0082/0083 required; no schema rollback, credential replay or cleanup reactivation.',
      'Queue delivery must be paused by the authorized operator; retryAll is only an unexpected-delivery fallback.',
      'Admission does not terminate old invocations. A proven old-writer boundary is independently required.',
    ],
  };
  fs.writeFileSync(path.join(resolvedOutput, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { directory: resolvedOutput, manifest };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: {
      candidate: { type: 'string' }, sha256: { type: 'string' }, outdir: { type: 'string' },
    }});
    if (!values.candidate || !values.sha256 || !values.outdir) throw new Error('Usage: node scripts/prepare-q2-recovery.mjs --candidate <actual Wrangler index.js> --sha256 <hash> --outdir <new private directory>');
    const { directory, manifest } = prepareRecovery({ candidate: values.candidate, expectedSha256: values.sha256, outdir: values.outdir });
    console.log(JSON.stringify({ directory, files: manifest.files, activation: manifest.activation }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
