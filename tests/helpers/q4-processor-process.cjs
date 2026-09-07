const { fork } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// Real processor entrypoint + actual OS process termination. Provider transport
// and ffmpeg bytes are synthetic, while Auth handlers and parent DB are real.
async function runProcessorProcess({ onRequest }) {
  const root = process.cwd(), temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'q4-processor-'));
  const tool = path.join(root, 'tests/helpers/q4-ffmpeg-fixture.cjs');
  const env = { PATH: process.env.PATH, HOME: temporary, TMPDIR: temporary, WORK_DIR: temporary,
    AUTH_WORKER_BASE_URL: 'https://bitbi.ai', MEMVID_STREAM_PREVIEW_PROCESSOR_SECRET: 'q4-stream-processor-synthetic-not-a-production-secret',
    STREAM_ACCOUNT_ID: 'synthetic-q4-account', STREAM_API_TOKEN: 'test-q4-provider-no-credentials',
    PROCESS_HOMEPAGE_HERO: 'false', PROCESS_HOMEPAGE_SOURCE_POSTERS: 'false', PROCESS_MEMVID_STREAM_PREVIEWS: 'true', REPAIR_MEMVID_STREAM_DOWNLOADS: 'true',
    JOB_LIMIT: '1', FFMPEG_BIN: tool, FFPROBE_BIN: tool, CWEBP_BIN: tool };
  let stdout = '', stderr = '', requests = 0, transportFailure;
  const child = fork(path.join(root, 'services/homepage-ffmpeg-processor/processor.mjs'), [], {
    cwd: root, env, execArgv: ['--import', path.join(root, 'tests/helpers/q4-processor-transport.mjs')], silent: true,
  });
  child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
  child.on('message', async request => {
    requests += 1;
    try {
      const reply = await onRequest(request);
      if (reply.kill) { child.kill('SIGKILL'); return; }
      if (child.connected) child.send({ id: request.id, ...reply });
    } catch (error) { transportFailure = error; child.kill('SIGKILL'); }
  });
  try {
    const result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
    if (transportFailure) throw transportFailure;
    return { ...result, stdout, stderr, requests };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
module.exports = { runProcessorProcess };
