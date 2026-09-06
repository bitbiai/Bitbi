const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { withMfaFixture, load } = require('./q2-mfa-fixtures.cjs');
const { startWorkerHttp } = require('./helpers/q2-http.js');

// Real enrollment/session/proof/DO guards, native D1, full Worker fetch and
// loopback transport. R2 is synthetic. No permission or route guard is stubbed.
async function withRawWriterFixture(run) {
  await withMfaFixture(async (f) => {
    f.db.exec(fs.readFileSync(path.join(__dirname, '../workers/auth/migrations/0083_add_r2_cleanup_reference_fence.sql'), 'utf8'));
    const calls = [];
    const stores = {};
    for (const binding of ['USER_IMAGES', 'PRIVATE_MEDIA']) {
      const objects = stores[binding] = new Map([['operator/source.bin', new Uint8Array([10, 20])]]);
      f.env[binding] = {
        async head(key) { calls.push({ binding, operation: 'head', key }); return objects.has(key) ? { key, size: objects.get(key).length } : null; },
        async get(key) { calls.push({ binding, operation: 'get', key }); return objects.has(key) ? { body: objects.get(key), httpMetadata: { contentType: 'application/octet-stream' } } : null; },
        async put(key, value) { calls.push({ binding, operation: 'put', key }); objects.set(key, new Uint8Array(await new Response(value).arrayBuffer())); return { key }; },
        async delete(key) { calls.push({ binding, operation: 'delete', key }); objects.delete(key); },
      };
    }
    const auditMessages = [];
    f.env.ACTIVITY_INGEST_QUEUE = { async send(message) { auditMessages.push(message); } };
    const { default: worker } = await load('workers/auth/src/index.js');
    const transport = await startWorkerHttp(worker, f.env);
    const cookie = `${f.sessionCookie()}; ${f.enabled.response.headers.getSetCookie()[0].split(';')[0]}`;
    let sequence = 0;
    async function post(endpoint, body) {
      const multipart = body instanceof FormData;
      const encoded = multipart ? new Response(body) : null;
      return transport.request(endpoint, {
        method: 'POST',
        headers: {
          Origin: 'https://bitbi.ai', Cookie: cookie,
          'CF-Connecting-IP': '192.0.2.41',
          'Idempotency-Key': `q2-lifecycle-raw-${++sequence}`,
          'Content-Type': multipart ? encoded.headers.get('Content-Type') : 'application/json',
        },
        body: multipart ? Buffer.from(await encoded.arrayBuffer()) : JSON.stringify(body),
      });
    }
    try { await run({ ...f, calls, stores, post, auditMessages }); }
    finally { await transport.close(); }
  });
}

function upload(bucket, key) {
  const body = new FormData();
  body.set('bucket', bucket);
  body.set('key', key);
  body.set('reason', 'Q2 synthetic namespace test');
  body.set('overwrite', 'true');
  body.set('file', new File([new Uint8Array([1, 2, 3])], 'fixture.bin', { type: 'application/octet-stream' }));
  return body;
}

for (const prefix of ['users/synthetic/', 'van-ark-chat/synthetic/']) {
  test(`Q2 L01 actual authenticated raw upload/copy/move/folder cannot write managed ${prefix}`, async () => withRawWriterFixture(async (f) => {
    const target = `${prefix}target.bin`;
    const response = await f.post('/api/admin/r2/objects/upload', upload('USER_IMAGES', target));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('admin_r2_managed_target_blocked');
    expect(f.calls).toEqual([]);
    for (const operation of ['copy', 'move']) {
      const response = await f.post(`/api/admin/r2/objects/${operation}`, {
        bucket: 'USER_IMAGES', reason: 'Q2 synthetic namespace test',
        items: [{ key: 'operator/source.bin', targetKey: target, overwrite: true }],
      });
      expect(response.status).toBe(200);
      expect((await response.json()).data.results).toEqual([expect.objectContaining({ ok: false, code: 'admin_r2_managed_target_blocked' })]);
      expect(f.stores.USER_IMAGES.has('operator/source.bin')).toBe(true);
    }
    const folder = await f.post('/api/admin/r2/folders', { bucket: 'USER_IMAGES', prefix, reason: 'Q2 synthetic namespace test' });
    expect(folder.status).toBe(409);
    expect((await folder.json()).code).toBe('admin_r2_managed_target_blocked');
    expect(f.calls).toEqual([]);
    expect(f.stores.USER_IMAGES.has(target)).toBe(false);
  }));
}

test('Q2 L01 allowed raw prefixes and distinct buckets preserve normal upload/copy/move behavior', async () => withRawWriterFixture(async (f) => {
  for (const [bucket, key] of [['USER_IMAGES', 'operator/upload.bin'], ['PRIVATE_MEDIA', 'users/synthetic/upload.bin']]) {
    const response = await f.post('/api/admin/r2/objects/upload', upload(bucket, key));
    expect(response.status).toBe(200);
    expect((await response.json()).ok).toBe(true);
    expect([...f.stores[bucket].get(key)]).toEqual([1, 2, 3]);
  }
  const copy = await f.post('/api/admin/r2/objects/copy', { bucket: 'USER_IMAGES', reason: 'Q2 synthetic namespace test', items: [{ key: 'operator/source.bin', targetKey: 'operator/copied.bin' }] });
  expect(copy.status).toBe(200);
  expect((await copy.json()).data.results[0].ok).toBe(true);
  expect([...f.stores.USER_IMAGES.get('operator/copied.bin')]).toEqual([10, 20]);
  const move = await f.post('/api/admin/r2/objects/move', { bucket: 'USER_IMAGES', reason: 'Q2 synthetic namespace test', items: [{ key: 'operator/copied.bin', targetKey: 'operator/moved.bin' }] });
  expect(move.status).toBe(200);
  expect((await move.json()).data.results[0].ok).toBe(true);
  expect(f.stores.USER_IMAGES.has('operator/copied.bin')).toBe(false);
  expect([...f.stores.USER_IMAGES.get('operator/moved.bin')]).toEqual([10, 20]);
  expect(f.auditMessages.length).toBeGreaterThanOrEqual(4);
}));
