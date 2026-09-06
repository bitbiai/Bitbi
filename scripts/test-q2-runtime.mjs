import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runQ2Runtime} from '../tests/helpers/q2-runtime/runner.mjs';

// Linux CI must isolate native subprocesses too. No sudo, host firewall changes,
// package installation or silent fallback when user namespaces are unavailable.
if(process.platform==='linux') {
  const unshare='/usr/bin/unshare';
  if(!fs.existsSync(unshare)) throw new Error('Q2 native harness requires Linux unshare; unavailable is a hard failure.');
  const parentNamespace=fs.readlinkSync('/proc/self/ns/net');
  const environment={PATH:process.env.PATH||'/usr/bin:/bin',TZ:'UTC'};
  if(process.env.TMPDIR) environment.TMPDIR=process.env.TMPDIR;
  const child=spawnSync(unshare,['--user','--map-root-user','--net',process.execPath,
    fileURLToPath(new URL('../tests/helpers/q2-runtime/linux-isolated.mjs',import.meta.url)),parentNamespace,...process.argv.slice(2)],
    {env:environment,stdio:'inherit'});
  if(child.error) throw new Error('Q2 Linux network namespace failed: '+child.error.code);
  if(child.status!==0) throw new Error('Q2 isolated native runner failed; network isolation is never skipped.');
} else if(process.platform==='darwin') {
  // Local acceptance invokes this entry under the reviewed sandbox-exec profile.
  await runQ2Runtime(process.argv.slice(2));
} else throw new Error('Q2 native harness requires an approved OS network boundary for this platform.');
