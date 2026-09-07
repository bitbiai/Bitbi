#!/usr/bin/env node
// Synthetic encoder/probe output only; these tests exercise processor state and
// process restart, not actual transcoding quality or an installed ffmpeg build.
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('-encoders')) console.log(' V....D libwebp synthetic fixture');
else if (args.includes('-version')) console.log('synthetic encoder fixture');
else if (args.includes('-show_entries')) console.log(JSON.stringify({ streams: [{ width: 320, height: 180, duration: '3', r_frame_rate: '24/1' }] }));
else if (args.includes('-y') && args.includes('-i')) fs.writeFileSync(args.at(-1), 'synthetic-mp4-output');
else { console.error('Unsupported encoder fixture invocation'); process.exitCode = 1; }
