import {fileURLToPath} from 'node:url';
import {mediaCommand} from '../services/homepage-ffmpeg-processor/canvas-full-video.mjs';

// A cheap execution check precedes expensive Worker/media suites. Only tool
// names and bounded version tokens may enter logs; never command arguments.
export async function checkMediaTools({ffmpeg='ffmpeg',ffprobe='ffprobe'}={}) {
  const versions={};
  for(const [tool,command] of Object.entries({ffmpeg,ffprobe})) {
    const output=await mediaCommand(command,['-version'],{timeout:10000});
    const version=output.match(new RegExp('^'+tool+' version ([A-Za-z0-9.+:_-]{1,100})(?:\\s|$)'))?.[1];
    if(!version)throw Object.assign(new Error('media_tool_version_unrecognized'),{code:'media_tool_version_unrecognized',diagnostic:{tool}});
    versions[tool]=version;
  }
  return versions;
}

if(process.argv[1]===fileURLToPath(import.meta.url)) {
  try {console.log(JSON.stringify({mediaTools:await checkMediaTools()}));}
  catch(error) {
    console.error(JSON.stringify({code:error.code,diagnostic:error.diagnostic}));
    process.exitCode=1;
  }
}
