// The historical entry point shares exact-source evidence and resume with the
// normal release. It must not start another copy of already passed suites.
import { preflightLocal } from './local-release.mjs';

try {
  const args=process.argv.slice(2), options={};
  if(args.includes('--help') || args.includes('-h')) {
    console.log('npm run release:preflight -- [--base <wider-SHA>] [--resume <directory>]\nLocal acceptance only; npm run release:local continues upload, push and protected publication.');
  } else {
    for(let i=0;i<args.length;i+=2) {
      if(!['--base','--resume'].includes(args[i]) || !args[i+1])throw Error('Use an exact committed candidate and optional --base/--resume; file lists cannot certify a release.');
      options[args[i].slice(2)]=args[i+1];
    }
    console.log(await preflightLocal(options));
  }
} catch(error) { console.error(error.message);process.exitCode=1; }
