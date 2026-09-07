// Test-only same-origin HTTP media transport, using serve's existing locked
// static handler and the actual product Range helper. No Cloud credentials.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { publicVideoResponse } from '../../workers/auth/src/lib/public-video-response.mjs';
const require = createRequire(import.meta.url);
const serve = require('serve-handler');
const compression = require('compression')();
const video = fs.readFileSync(new URL('../fixtures/media/test-video.mp4', import.meta.url));
const root = path.resolve(process.argv[2] || '.');
const metadata = { size: video.length, etag: 'fixture-video', httpEtag: '"fixture-video"', uploaded: new Date('2026-09-07T00:00:00Z') };
const bucket = {
  head: async () => metadata,
  get: async (_key, options) => ({ ...metadata, body: options?.range
    ? video.subarray(options.range.offset, options.range.offset + options.range.length) : video }),
};
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost:3000');
    if (url.pathname === '/plain-video') { res.writeHead(200, { 'Content-Type':'text/html' });res.end('<!doctype html><title>Native transport fixture</title><body></body>');return; }
    if (/^\/api\/(homepage\/hero-videos|gallery\/memvids|plain)\/.*\/file$/.test(url.pathname) || url.pathname === '/api/plain/file') {
      if (req.method !== 'GET') { res.writeHead(404); res.end(); return; }
      if (url.searchParams.has('broken')) { res.writeHead(200, { 'Content-Type':'video/mp4', 'Content-Length':16 }); res.end(Buffer.alloc(16)); return; }
      const response = await publicVideoResponse(new Request(url, { headers:req.headers }), bucket, 'fixture', () => new Headers({
        'Content-Type':'video/mp4', 'Content-Length':String(video.length), 'Cache-Control':'public, max-age=31536000, immutable', 'X-Content-Type-Options':'nosniff', 'X-Test-Media-Transport':'http',
      }));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      await pipeline(Readable.fromWeb(response.body), res);
      return;
    }
    await new Promise((resolve,reject)=>compression(req,res,error=>error?reject(error):resolve()));
    await serve(req, res, { public:root });
  } catch (error) {
    // Browser cancellation of an outgoing media face is a normal HTTP close.
    if (req.destroyed || res.destroyed) return;
    res.writeHead(500); res.end('Synthetic media server error'); console.error(error);
  }
});
server.listen(3000, '127.0.0.1');
for (const signal of ['SIGTERM','SIGINT']) process.once(signal, () => { server.close(); server.closeAllConnections(); });
