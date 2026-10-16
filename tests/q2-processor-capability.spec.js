const { test, expect } = require('@playwright/test');
const { SqliteD1Database, applyAuthMigrations } = require('./helpers/sqlite-d1.js');
const { createAuthTestEnv } = require('./helpers/auth-worker-harness.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');

test('Canvas processor advertises only backend-authorized inspections and preserves GitHub exports', async () => {
  const { default: worker } = await import('../workers/auth/src/index.js');
  const { processCanvasExports, inspectClip } = await import('../services/homepage-ffmpeg-processor/canvas-full-video.mjs');
  const DB = new SqliteD1Database(); applyAuthMigrations(DB);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-processor-capability-'));
  const originalFetch = global.fetch, originalExitCode = process.exitCode;
  const pending = [], requests = [], external = [];
  const sha = 'e'.repeat(40), owner = 'bitbi-private-media-release-smoke';
  const project = createHash('sha256').update(`media-smoke:${sha}:github`).digest('hex').slice(0, 32);
  const base = '/api/internal/homepage/hero-videos/canvas-exports/jobs';
  const env = { ...createAuthTestEnv(), DB,
    MEMVID_STREAM_PREVIEW_PROCESSOR_SECRET: 'synthetic-github-capability',
    PRIVATE_MEDIA_PROCESSOR_SECRET: 'synthetic-cloudflare-capability',
    PRIVATE_MEDIA_SOURCE_SHA: sha,
    AI: { async run() { throw Error('Unexpected paid provider'); } },
    AI_LAB: { async fetch() { throw Error('Unexpected AI service'); } },
  };
  // The shared lightweight bucket exposes stored bodies. This actual smoke
  // caller also consumes R2ObjectBody.arrayBuffer(), so preserve that contract
  // locally without changing other harness users or the Worker implementation.
  const getObject = env.USER_IMAGES.get.bind(env.USER_IMAGES);
  env.USER_IMAGES.get = async (...args) => {
    const object = await getObject(...args);
    return object && { ...object, arrayBuffer: () => new Response(object.body).arrayBuffer() };
  };
  const context = { waitUntil(promise) { pending.push(promise); } };
  const send = async (pathname, init = {}) => {
    const url = new URL(pathname, 'https://bitbi.ai');
    expect(url.origin).toBe('https://bitbi.ai');
    expect(url.pathname.startsWith('/api/internal/homepage/hero-videos/')).toBe(true);
    const response = await worker.fetch(new Request(url, init), env, context);
    requests.push({ path: url.pathname, method: init.method || 'GET', status: response.status });
    return response;
  };
  const transport = (secret, oldAdvertisement = false) => {
    const authHeaders = extra => ({ Authorization: `Bearer ${secret}`, ...extra });
    return {
      baseUrl: 'https://bitbi.ai', limit: 1, authHeaders, fetchImpl: send,
      async requestJson(url, init = {}) {
        const response = await send(url, { ...init, headers: authHeaders(init.headers) });
        const body = await response.json();
        if (!response.ok) throw Object.assign(Error(body.code || 'processor_http_error'), { status: response.status, body });
        // Independent broken control: reproduce only the old handshake bit.
        // The processor, HTTP routes, backend credentials and DB stay real.
        if (oldAdvertisement && url === base + '/claim' && !init.method) body.data.inspections = 1;
        return body;
      },
    };
  };
  const job = () => DB.prepare('SELECT id,status,attempt_count,processing_token,locked_until,asset_id,error_code FROM canvas_video_processing WHERE id=? AND user_id=?').bind(project, owner).first();
  try {
    global.fetch = async (...args) => { external.push(String(args[0])); throw Error('Unexpected external request'); };
    const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures/media', name)).toString('base64');
    const seeded = await send('/api/internal/homepage/hero-videos/private-media/smoke', {
      method: 'POST', headers: { Authorization: `Bearer ${env.PRIVATE_MEDIA_PROCESSOR_SECRET}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start', sha, backend: 'github', fixture: fixture('canvas-end-frame.mp4'), referenceFixture: fixture('h3-overrun.mp4') }),
    });
    const seededBody = await seeded.json();
    expect(seededBody, `Seed HTTP ${seeded.status}: ${seededBody.code || 'no error code'}`).toMatchObject({ ok: true, data: { accepted: true, sha, backend: 'github' } });
    expect(seeded.status).toBe(200);
    const before = await job();
    expect(before).toMatchObject({ status: 'queued', attempt_count: 0, processing_token: null, locked_until: null, asset_id: null });

    requests.length = 0;
    await expect(processCanvasExports(transport(env.MEMVID_STREAM_PREVIEW_PROCESSOR_SECRET, true))).rejects.toMatchObject({
      status: 403, body: { ok: false, code: 'processor_auth_failed' },
    });
    expect(requests).toEqual([
      { path: base + '/claim', method: 'GET', status: 200 },
      { path: base + '/inspections/claim', method: 'POST', status: 403 },
    ]);
    expect(await job()).toEqual(before); // Rejection preceded export admission.

    const github = transport(env.MEMVID_STREAM_PREVIEW_PROCESSOR_SECRET);
    expect((await github.requestJson(base + '/claim')).data).toEqual({ protocol: 1, recipeProtocol: 9, previewBase: 1, inspections: 0 });
    requests.length = 0;
    await processCanvasExports(github);
    expect(requests.some(row => row.path.includes('/inspections/'))).toBe(false);
    expect(requests.filter(row => row.path === base + '/claim' && row.method === 'POST')).toEqual([
      { path: base + '/claim', method: 'POST', status: 200 },
    ]);
    expect(requests.filter(row => row.path === `${base}/${project}/complete`)).toEqual([
      { path: `${base}/${project}/complete`, method: 'POST', status: 200 },
    ]);
    const completed = await job();
    expect(completed).toMatchObject({ status: 'preview_pending', asset_id: project, locked_until: null, error_code: null });
    const asset = await DB.prepare('SELECT r2_key FROM ai_text_assets WHERE id=? AND user_id=?').bind(project, owner).first();
    expect(asset).not.toBeNull();
    const output = await env.USER_IMAGES.get(asset.r2_key);
    expect(output).not.toBeNull();
    const file = path.join(directory, 'saved.mp4'); fs.writeFileSync(file, Buffer.from(await output.arrayBuffer()));
    const measured = await inspectClip(file);
    expect(measured.videoDuration).toBeGreaterThan(0);
    expect(Number(measured.video.nb_frames)).toBeGreaterThan(1);

    const cloudflare = transport(env.PRIVATE_MEDIA_PROCESSOR_SECRET);
    expect((await cloudflare.requestJson(base + '/claim')).data).toEqual({ protocol: 1, recipeProtocol: 9, previewBase: 1, inspections: 1 });
    requests.length = 0;
    await processCanvasExports(cloudflare);
    expect(requests).toEqual([
      { path: base + '/claim', method: 'GET', status: 200 },
      { path: base + '/inspections/claim', method: 'POST', status: 200 },
      { path: base + '/claim', method: 'POST', status: 200 },
    ]);
    const denied = await send(base + '/inspections/claim', { method: 'POST', headers: github.authHeaders({ 'Content-Type': 'application/json' }), body: '{"protocol":1}' });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ ok: false, code: 'processor_auth_failed' });
    expect(await job()).toEqual(completed);
    expect((await DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
    await Promise.allSettled(pending);
    expect(external).toEqual([]);
    expect(process.exitCode).toBe(originalExitCode);
  } finally {
    await Promise.allSettled(pending);
    global.fetch = originalFetch; process.exitCode = originalExitCode;
    DB.close(); fs.rmSync(directory, { recursive: true, force: true });
  }
});
