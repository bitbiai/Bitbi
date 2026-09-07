const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { SqliteD1Database, applyAuthMigrations } = require('./helpers/sqlite-d1.js');
const load = name => import(pathToFileURL(path.join(process.cwd(), name)).href);

async function fixture(run) {
  const db = new SqliteD1Database();
  try {
    applyAuthMigrations(db, { through: '0084_add_memvid_stream_upload_receipts.sql' });
    const [{ default: worker }, helpers, flow] = await Promise.all([
      load('workers/auth/src/index.js'), load('tests/helpers/q4-stream-fixture.mjs'),
      load('services/homepage-ffmpeg-processor/memvid-preview-flow.mjs'),
    ]);
    const env = { DB: db, BITBI_ENV: 'production', APP_BASE_URL: 'https://bitbi.ai', ALLOW_LEGACY_SECURITY_SECRET_FALLBACK: 'false',
      STREAM_ACCOUNT_ID: 'synthetic-q4-account', STREAM_API_TOKEN: 'test-q4-provider-no-credentials',
      ENABLE_MEMVID_STREAM_PREVIEWS: 'true', MEMVID_STREAM_PREVIEW_PROCESSOR_SECRET: helpers.STREAM_SECRET };
    for (const name of ['SESSION_HASH_SECRET', 'PAGINATION_SIGNING_SECRET', 'ADMIN_MFA_ENCRYPTION_KEY', 'ADMIN_MFA_PROOF_SECRET', 'ADMIN_MFA_RECOVERY_HASH_SECRET', 'AI_SAVE_REFERENCE_SIGNING_SECRET'])
      env[name] = `q4-synthetic-${name}-not-live-0000000000000000`;
    let outbound = 0;
    const originalFetch = global.fetch;
    global.fetch = async () => { outbound += 1; throw new Error('Synthetic test forbids real outbound'); };
    try {
      env.USER_IMAGES = { get: async () => ({ body: new TextEncoder().encode('synthetic-source'), size: 16, httpMetadata: { contentType: 'video/mp4' } }) };
      const rawFetch = (url, init) => worker.fetch(new Request(url, init), env, { waitUntil: () => {} });
      const api = helpers.streamApi(rawFetch);
      const seeded = await helpers.seedStreamJob(db);
      await run({ db, api, rawFetch, seeded, ...helpers, ...flow });
      expect(outbound).toBe(0);
      expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
    } finally { global.fetch = originalFetch; }
  } finally { db.close(); }
}
const receiptPath = job => `jobs/${job.id}/receipt`;
const begin = (f, job) => f.api(receiptPath(job), { phase: 'begin', claim_token: job.claim_token, source_fingerprint: job.source.fingerprint });

test('Q4 Stream protocol fences legacy processors and only one concurrent claim owns a job', async () => fixture(async f => {
  expect((await f.api('jobs/claim', undefined, 'wrong-synthetic-secret')).status).toBe(403);
  expect((await f.api('jobs/claim')).body.data.receipt_protocol).toBe(2);
  expect((await f.api('jobs/claim', { limit: 1 })).status).toBe(409);
  expect((await f.db.prepare('SELECT status FROM memvid_stream_previews').first()).status).toBe('queued');
  const results = await Promise.all([f.claimStream(f.api), f.claimStream(f.api)]);
  expect(results.filter(Boolean)).toHaveLength(1);
  const job = results.find(Boolean);
  expect((await begin(f, job)).status).toBe(200);
  expect((await begin(f, job)).status).toBe(409);
  expect((await f.api(receiptPath(job))).body.data.phase).toBe('upload_unknown');
}));

test('Q4 Stream real processor keeps UID across download failure, receipt response loss and resume without Create', async () => fixture(async f => {
  const job = await f.claimStream(f.api); let creates = 0, downloads = 0, receipts = 0;
  const callReceipt = async (_, body) => {
    const r = await f.api(receiptPath(job), body); expect(r.status).toBe(200);
    if (++receipts === 1) throw new Error('Synthetic response lost after committed receipt');
    return r.body;
  };
  const operations = {
    convert: async () => ({ output: 'synthetic-file', metadata: {} }),
    begin: async () => (await begin(f, job)).body.data,
    upload: async () => { creates += 1; return { uid: f.STREAM_UID }; },
    receipt: callReceipt,
    downloads: async () => { downloads += 1; throw new Error('Synthetic download failed'); },
    complete: async () => { throw new Error('Must not complete failed download'); },
  };
  await expect(f.runMemvidPreviewFlow(job, operations)).rejects.toThrow('Synthetic download failed');
  expect({ creates, downloads, receipts }).toEqual({ creates: 1, downloads: 1, receipts: 2 });
  expect((await f.api(receiptPath(job))).body.data.stream_uid).toBe(f.STREAM_UID);
  expect((await f.api(`jobs/${job.id}/fail`, { claim_token: job.claim_token, error_code: 'download_failed' })).body.data.next_action).toBe('resume_same_job');
  // Re-enter actual orchestration from durable API state, no captured old job/context.
  const resumed = await f.claimStream(f.api);
  expect(resumed.claim_token).not.toBe(job.claim_token);
  await f.runMemvidPreviewFlow(resumed, { ...operations,
    convert: async () => { throw new Error('Known receipt never reconverts'); },
    downloads: async () => ({ status: 'ready', url: f.STREAM_DOWNLOAD }),
    complete: async fresh => { expect((await f.api(`jobs/${fresh.id}/complete`, f.completionBody(fresh))).status).toBe(200); },
  });
  expect(creates).toBe(1);
  expect((await f.api(`jobs/${resumed.id}/complete`, f.completionBody(resumed))).body.data.duplicate).toBe(true);
  expect((await f.api(`jobs/${resumed.id}/fail`, { claim_token: resumed.claim_token, error_code: 'late_fail' })).body.data.status).toBe('ready');
  expect((await f.db.prepare('SELECT phase FROM memvid_stream_upload_receipts').first()).phase).toBe('complete');
}));

test('Q4 Stream unknown upload is held after failure and expired lease, never blindly reclaimed', async () => fixture(async f => {
  const job = await f.claimStream(f.api); await begin(f, job);
  await f.api(`jobs/${job.id}/fail`, { claim_token: job.claim_token, error_code: 'upload_response_lost' });
  await f.db.prepare("UPDATE memvid_stream_upload_receipts SET claim_expires_at='2000-01-01T00:00:00.000Z'").run();
  expect(await f.claimStream(f.api)).toBeUndefined();
  expect((await f.api(receiptPath(job))).body.data.phase).toBe('upload_unknown');
  expect((await f.db.prepare('SELECT status FROM memvid_stream_previews').first()).status).toBe('processing');
}));

test('Q4 Stream late source-deleted receipt survives and cannot publish or change resource identity', async () => fixture(async f => {
  const job = await f.claimStream(f.api); const permit = await begin(f, job);
  await f.db.prepare('DELETE FROM ai_text_assets WHERE id=?').bind(f.seeded.asset).run();
  const body = { upload_token: permit.body.data.upload_token, stream_uid: f.STREAM_UID, source_fingerprint: job.source.fingerprint };
  expect((await f.api(receiptPath(job), body)).body.data.retired).toBe(true);
  expect((await f.api(receiptPath(job), body)).status).toBe(200);
  expect((await f.api(receiptPath(job), { ...body, stream_uid: 'f'.repeat(32) })).status).toBe(409);
  expect((await f.api(`jobs/${job.id}/complete`, f.completionBody(job))).status).toBe(409);
  expect((await f.db.prepare('SELECT COUNT(*) AS n FROM memvid_stream_previews').first()).n).toBe(0);
  expect((await f.db.prepare('SELECT stream_uid,retired_at FROM memvid_stream_upload_receipts').first()).stream_uid).toBe(f.STREAM_UID);
}));

test('Q4 Stream unpublish during upload preserves the receipt and prevents publication', async () => fixture(async f => {
  const job = await f.claimStream(f.api); const permit = await begin(f, job);
  await f.db.prepare("UPDATE ai_text_assets SET visibility='private' WHERE id=?").bind(f.seeded.asset).run();
  await f.api(receiptPath(job), { upload_token: permit.body.data.upload_token, stream_uid: f.STREAM_UID, source_fingerprint: job.source.fingerprint });
  expect((await f.api(`jobs/${job.id}/complete`, f.completionBody(job))).status).toBe(409);
  expect(await f.claimStream(f.api)).toBeUndefined();
}));

test('Q4 Stream whole claim and completion batches roll back on a later SQL fault', async () => fixture(async f => {
  f.db.exec("CREATE TRIGGER q4_claim_fault BEFORE UPDATE ON memvid_stream_previews BEGIN SELECT RAISE(ABORT,'q4_claim_fault'); END;");
  await expect(f.api('jobs/claim', { receipt_protocol: 2, limit: 1 })).rejects.toThrow('q4_claim_fault');
  expect((await f.db.prepare('SELECT COUNT(*) AS n FROM memvid_stream_upload_receipts').first()).n).toBe(0);
  expect((await f.db.prepare('SELECT status FROM memvid_stream_previews').first()).status).toBe('queued');
  f.db.exec('DROP TRIGGER q4_claim_fault;');
  const job = await f.claimStream(f.api); const permit = await begin(f, job);
  await f.api(receiptPath(job), { upload_token: permit.body.data.upload_token, stream_uid: f.STREAM_UID, source_fingerprint: job.source.fingerprint });
  f.db.exec("CREATE TRIGGER q4_complete_fault BEFORE UPDATE ON memvid_stream_previews BEGIN SELECT RAISE(ABORT,'q4_complete_fault'); END;");
  await expect(f.api(`jobs/${job.id}/complete`, f.completionBody(job))).rejects.toThrow('q4_complete_fault');
  expect((await f.db.prepare('SELECT phase FROM memvid_stream_upload_receipts').first()).phase).toBe('received');
  f.db.exec('DROP TRIGGER q4_complete_fault;');
  expect((await f.api(`jobs/${job.id}/complete`, f.completionBody(job))).status).toBe(200);
}));

for (const cut of ['receipt_reply_lost', 'download_failed']) {
  test(`Q4 actual processor CLI ${cut} survives OS process restart without another provider Create`, async () => fixture(async f => {
    const { runProcessorProcess } = require('./helpers/q4-processor-process.cjs');
    let creates = 0, conversions = 0, interrupted = false;
    const onRequest = async request => {
      const url = new URL(request.url);
      if (url.origin === 'https://bitbi.ai') {
        expect(request.headers.authorization).toBe(`Bearer ${f.STREAM_SECRET}`);
        if (url.pathname.endsWith('/source')) conversions += 1;
        const response = await f.rawFetch(request.url, { method: request.method, headers: request.headers, ...(request.body ? { body: request.body } : {}) });
        const text = await response.text();
        if (!interrupted && cut === 'receipt_reply_lost' && url.pathname.endsWith('/receipt') && request.body && JSON.parse(request.body).stream_uid) {
          expect(response.status).toBe(200); interrupted = true; return { kill: true };
        }
        return { status: response.status, body: text, headers: Object.fromEntries(response.headers) };
      }
      expect(url.origin).toBe('https://api.cloudflare.com');
      expect(request.headers.authorization).toBe('Bearer test-q4-provider-no-credentials');
      if (url.pathname.endsWith('/stream') && request.method === 'POST') {
        const form = JSON.parse(request.body), meta = JSON.parse(form.meta);
        expect(meta.bitbi_preview_job_id).toBe(f.seeded.id); expect(meta.bitbi_upload_intent).toMatch(/^[a-f0-9]{48}$/);
        expect(form.fileBytes).toBeGreaterThan(0); creates += 1;
        return { status: 200, body: JSON.stringify({ success: true, result: { uid: f.STREAM_UID } }) };
      }
      expect(url.pathname).toContain(`/stream/${f.STREAM_UID}`);
      if (!interrupted && cut === 'download_failed') {
        interrupted = true; return { status: 503, body: JSON.stringify({ success: false, errors: [{ code: 1000, message: 'synthetic download unavailable' }] }) };
      }
      const result = url.pathname.endsWith('/downloads')
        ? { default: { status: 'ready', url: f.STREAM_DOWNLOAD } }
        : { status: { state: 'ready' }, readyToStream: true };
      return { status: 200, body: JSON.stringify({ success: true, result }) };
    };
    const first = await runProcessorProcess({ onRequest });
    if (cut === 'receipt_reply_lost') expect(first.signal).toBe('SIGKILL');
    else expect(first.code).toBe(1);
    expect(interrupted).toBe(true); expect(creates).toBe(1);
    const receipt = await f.db.prepare('SELECT phase,stream_uid FROM memvid_stream_upload_receipts').first();
    expect(receipt).toMatchObject({ phase: 'received', stream_uid: f.STREAM_UID });
    await f.db.prepare("UPDATE memvid_stream_upload_receipts SET claim_expires_at='2000-01-01T00:00:00.000Z'").run();
    const second = await runProcessorProcess({ onRequest });
    expect(second, second.stderr).toMatchObject({ code: 0, signal: null });
    expect({ creates, conversions }).toEqual({ creates: 1, conversions: 1 });
    expect((await f.db.prepare('SELECT status,stream_uid FROM memvid_stream_previews').first())).toMatchObject({ status: 'ready', stream_uid: f.STREAM_UID });
    expect(first.stdout + first.stderr + second.stdout + second.stderr).not.toContain('test-q4-provider-no-credentials');
  }));
}

test('Q4 Stream expired old completion cannot publish; fresh claim completes the same UID', async () => fixture(async f => {
  const old = await f.claimStream(f.api), permit = await begin(f, old);
  await f.api(receiptPath(old), { upload_token: permit.body.data.upload_token, stream_uid: f.STREAM_UID, source_fingerprint: old.source.fingerprint });
  await f.db.prepare("UPDATE memvid_stream_upload_receipts SET claim_expires_at='2000-01-01T00:00:00.000Z'").run();
  expect((await f.api(`jobs/${old.id}/complete`, f.completionBody(old))).status).toBe(409);
  const fresh = await f.claimStream(f.api);
  expect(fresh.claim_token).not.toBe(old.claim_token); expect(fresh.stream_uid).toBe(f.STREAM_UID);
  expect((await f.api(`jobs/${old.id}/complete`, f.completionBody(old))).status).toBe(409);
  expect((await begin(f, fresh)).status).toBe(409);
  expect((await f.api(`jobs/${fresh.id}/complete`, f.completionBody(fresh))).status).toBe(200);
}));

// Moved from the legacy MockD1 monolith: the same public URL/privacy contract
// now goes through a claimed receipt and native SQLite rather than bypassing it.
test('Memvid Stream preview completion stores ready MP4 download metadata and rejects unsafe URLs', async () => fixture(async f => {
  const job = await f.claimStream(f.api), permit = await begin(f, job);
  await f.api(receiptPath(job), { upload_token: permit.body.data.upload_token, stream_uid: f.STREAM_UID, source_fingerprint: job.source.fingerprint });
  const valid = f.completionBody(job);
  expect((await f.api(`jobs/${job.id}/complete`, { ...valid, provider_metadata: { download_status: 'ready', download_url: `https://customer-fixture.cloudflarestream.com/${'f'.repeat(32)}/downloads/default.mp4` } })).status).toBe(400);
  expect((await f.api(`jobs/${job.id}/complete`, { ...valid, provider_metadata: { download_status: 'ready', download_url: 'https://evil.example/downloads/default.mp4' } })).status).toBe(400);
  expect((await f.api(`jobs/${job.id}/complete`, { ...valid, provider_metadata: { ...valid.provider_metadata, cloudflare_stream_download_percent_complete: 100 } })).status).toBe(200);
  const row = await f.db.prepare('SELECT status,provider_metadata_json FROM memvid_stream_previews').first();
  expect(row.status).toBe('ready');
  expect(JSON.parse(row.provider_metadata_json).provider_metadata).toMatchObject({ download_status: 'ready', download_url: f.STREAM_DOWNLOAD,
    cloudflare_stream_download_status: 'ready', cloudflare_stream_download_url: f.STREAM_DOWNLOAD, cloudflare_stream_download_percent_complete: 100 });
  const response = await f.rawFetch('https://bitbi.ai/api/gallery/memvids?limit=1');
  const body = await response.json(); expect(response.status).toBe(200);
  expect(body.data.items[0].stream_preview.playback.mp4_url).toBe(f.STREAM_DOWNLOAD);
  expect(JSON.stringify(body)).not.toContain(f.seeded.key);
}));

test('Q4 Stream late A failure cannot overwrite B processing diagnostics after a new claim', async () => fixture(async f => {
  const a = await f.claimStream(f.api), prepare = f.db.prepare.bind(f.db);
  let b, intercepted = false;
  f.db.prepare = query => {
    const statement = prepare(query);
    if (/UPDATE memvid_stream_previews SET error_code=/.test(query)) {
      const bind = statement.bind.bind(statement);
      statement.bind = (...args) => {
        const bound = bind(...args), run = bound.run.bind(bound);
        bound.run = async () => {
        expect(intercepted).toBe(false); intercepted = true;
        b = await f.claimStream(f.api);
        expect(b.claim_token).not.toBe(a.claim_token);
        await prepare("UPDATE memvid_stream_previews SET error_code='b_processing',error_message='B owns this operation'").run();
          return run();
        };
        return bound;
      };
    }
    return statement;
  };
  try { expect((await f.api(`jobs/${a.id}/fail`, { claim_token: a.claim_token, error_code: 'a_failed' })).status).toBe(200); }
  finally { f.db.prepare = prepare; }
  expect(intercepted).toBe(true);
  expect((await prepare('SELECT error_code,error_message FROM memvid_stream_previews').first())).toMatchObject({ error_code: 'b_processing', error_message: 'B owns this operation' });
  expect((await prepare('SELECT claim_token FROM memvid_stream_upload_receipts').first()).claim_token).toBe(b.claim_token);
}));
