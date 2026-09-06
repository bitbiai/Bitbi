import { parseRuntimeArgs } from '../tests/helpers/q2-runtime/linux-hosted.mjs';

const options = parseRuntimeArgs(process.argv.slice(2), process.env);
// Project/dependency imports occur only after the Linux child verifies its
// namespace, filesystem boundary and complete privilege drop.
if(process.platform==='linux') {
  const { runHostedLinux } = await import('../tests/helpers/q2-runtime/linux-hosted.mjs');
  await runHostedLinux(options);
} else if(process.platform==='darwin') {
  if (options.preflight) throw new Error('--preflight is the hosted Linux isolation preflight');
  // Local acceptance invokes this entry under the reviewed sandbox-exec profile.
  const { runQ2Runtime } = await import('../tests/helpers/q2-runtime/runner.mjs');
  await runQ2Runtime(options.artifacts ? ['--artifacts', options.artifacts] : []);
} else throw new Error('Q2 native harness requires an approved OS network boundary for this platform.');
