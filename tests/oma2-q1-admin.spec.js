const { test, expect } = require('@playwright/test');

// Browser-only Q1 regressions. No Worker imports, provider calls or real mutations.
// The caller must serve the static repository and restrict the OS network to that server.
const viewports = [{ width: 1440, height: 900 }, { width: 390, height: 844 }];
const admin = { id: 'q1-admin', email: 'q1-admin@example.test', role: 'admin' };

async function setup(page, baseURL, handler = () => null) {
  const allowedOrigin = new URL(baseURL).origin;
  const unexpected = [];
  await page.context().route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== allowedOrigin) {
      unexpected.push({ method: request.method(), url: request.url() });
      return route.abort();
    }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    let result;
    if (url.pathname === '/api/admin/me') result = { status: 200, body: { ok: true, user: admin } };
    else if (url.pathname === '/api/me') result = { status: 200, body: { loggedIn: true, user: admin } };
    else result = await handler(request, url);
    if (!result) {
      if (!['GET', 'HEAD'].includes(request.method())) unexpected.push({ method: request.method(), path: url.pathname });
      result = { status: 503, body: { ok: false, error: 'Q1 fixture unavailable' } };
    }
    if (result.abort) return route.abort('failed');
    return route.fulfill({ status: result.status, contentType: 'application/json', body: JSON.stringify(result.body) });
  });
  await page.addInitScript(() => {
    localStorage.setItem('bitbi_cookie_consent', JSON.stringify({ v: '1', ts: Date.now(), necessary: true, analytics: false, marketing: false }));
  });
  return unexpected;
}

async function openAdmin(page, section) {
  await page.goto('/admin/index.html#' + section, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#adminPanel')).toBeVisible();
}

for (const viewport of viewports) {
  test.describe(`Q1 Admin ${viewport.width}px`, () => {
    test.use({ viewport });

    for (const initial of ['report', 'empty', 403, 404, 503]) {
      test(`U02 historical counts stay unverified for ${initial}; explicit refresh recovers evidence`, async ({ page, baseURL }) => {
        let calls = 0;
        let recover = false;
        const unexpected = await setup(page, baseURL, (request, url) => {
          if (url.pathname !== '/api/admin/tenant-assets/domains/evidence') return null;
          calls += 1;
          if (!recover && typeof initial === 'number') return { status: initial, body: { ok: false, error: 'Q1 evidence request failed' } };
          return { status: 200, body: !recover && initial === 'empty' ? { ok: true } : {
            ok: true, report: { source: 'q1-domain-evidence', generatedAt: '2026-06-20T10:00:00.000Z', domains: [] },
          } };
        });
        await openAdmin(page, 'tenant-assets');
        const center = page.locator('#tenantAssetCenter');
        await expect(center.getByRole('heading', { name: 'Current storage integrity: not verified' })).toBeVisible();
        await expect(center.getByText('Not currently verified', { exact: true })).toBeVisible();
        await expect(center.getByRole('heading', { name: 'Historical storage baseline', exact: true })).toBeVisible();
        await expect(center).toContainText('2026-06-17T00:00:00.000Z');
        await expect(center.locator(':scope > :not(details) .badge--active')).toHaveCount(0);
        await expect(center.locator('details.admin-advanced-disclosure')).not.toHaveAttribute('open', '');
        if (typeof initial === 'number') {
          await expect(center.locator('[role="alert"]')).toBeVisible();
          await expect(center).toContainText('Domain evidence could not be refreshed');
        } else if (initial === 'empty') await expect(center).toContainText('no usable domain report');
        else await expect(center.getByText('q1-domain-evidence', { exact: true }).first()).toBeVisible();
        expect(calls).toBe(1);
        recover = true;
        // A real keyboard activation, without changing the API or product DOM.
        await center.getByRole('button', { name: 'Refresh evidence', exact: true }).press('Enter');
        await expect.poll(() => calls).toBe(2);
        await expect(center.getByRole('button', { name: 'Refresh evidence', exact: true })).toBeFocused();
        await expect(center.getByText('q1-domain-evidence', { exact: true }).first()).toBeVisible();
        await expect(center.locator('[role="alert"]')).toHaveCount(0);
        await expect(center.getByRole('heading', { name: 'Current storage integrity: not verified' })).toBeVisible();
        await expect(center.locator(':scope > :not(details) .badge--active')).toHaveCount(0);
        expect(unexpected).toEqual([]);
      });
    }

    for (const failureIndex of [-1, 0, 1, 2]) {
      test(`U08 exact upload balance with failure index ${failureIndex}; no automatic retry`, async ({ page, baseURL }) => {
        const uploads = [];
        let listings = 0;
        const unexpected = await setup(page, baseURL, (request, url) => {
          if (url.pathname === '/api/admin/r2/buckets') return { status: 200, body: { ok: true, data: { buckets: [{ id: 'USER_IMAGES', name: 'Q1 images', binding: 'USER_IMAGES' }] } } };
          if (url.pathname === '/api/admin/r2/objects') {
            listings += 1;
            return { status: 200, body: { ok: true, data: { folders: [], objects: [] } } };
          }
          if (url.pathname === '/api/admin/r2/objects/upload' && request.method() === 'POST') {
            uploads.push({ body: request.postDataBuffer()?.toString() || '', key: request.headers()['idempotency-key'] });
            const fails = uploads.length - 1 === failureIndex;
            return { status: fails ? 503 : 201, body: fails ? { ok: false, error: 'Q1 upload unavailable' } : { ok: true, data: { key: 'q1-' + uploads.length } } };
          }
          return null;
        });
        page.on('dialog', dialog => dialog.accept('Q1 synthetic batch verification'));
        await openAdmin(page, 'object-storage');
        await expect(page.locator('#objectStorageState')).toContainText('0 item(s)');
        await page.locator('#objectStorageUploadInput').setInputFiles(['a', 'b', 'c'].map(name => ({ name: name + '.txt', mimeType: 'text/plain', buffer: Buffer.from(name) })));
        const succeeded = failureIndex < 0 ? 3 : failureIndex;
        const failed = failureIndex < 0 ? 0 : 1;
        const notAttempted = 3 - succeeded - failed;
        const result = page.locator('#objectStorageUploadResult');
        await expect(result).toHaveText(new RegExp(`${succeeded} succeeded, ${failed} failed, ${notAttempted} not attempted`));
        await expect(result).toHaveAttribute('data-state', failed ? 'error' : 'success');
        await expect(page.locator('#objectStorageUploadBtn')).toBeEnabled();
        expect(uploads).toHaveLength(succeeded + failed);
        expect(new Set(uploads.map(item => item.key)).size).toBe(uploads.length);
        for (const upload of uploads) {
          expect(upload.key).toBeTruthy();
          expect(upload.body).toContain('Q1 synthetic batch verification');
          expect(upload.body).toContain('USER_IMAGES');
          expect(upload.body).toMatch(/name="overwrite"\r?\n\r?\nfalse/);
        }
        const beforeRefresh = listings;
        await page.locator('#objectStorageRefreshBtn').press('Enter');
        await expect.poll(() => listings).toBeGreaterThan(beforeRefresh);
        expect(uploads).toHaveLength(succeeded + failed);
        await expect(result).toHaveText(new RegExp(`${succeeded} succeeded, ${failed} failed, ${notAttempted} not attempted`));
        if (failed) await expect(page.locator('#adminToast .admin-toast__item--success')).toHaveCount(0);
        expect(unexpected).toEqual([]);
      });
    }

    test('U08 lost upload response is unconfirmed; confirmed success and unattempted files stay distinct', async ({ page, baseURL }) => {
      const uploads = [];
      const objects = [];
      let listings = 0;
      const unexpected = await setup(page, baseURL, (request, url) => {
        if (url.pathname === '/api/admin/r2/buckets') return { status: 200, body: { ok: true, data: { buckets: [{ id: 'USER_IMAGES', name: 'Q1 images', binding: 'USER_IMAGES' }] } } };
        if (url.pathname === '/api/admin/r2/objects') {
          listings += 1;
          return { status: 200, body: { ok: true, data: { folders: [], objects } } };
        }
        if (url.pathname === '/api/admin/r2/objects/upload' && request.method() === 'POST') {
          uploads.push({ body: request.postDataBuffer()?.toString() || '', key: request.headers()['idempotency-key'] });
          if (uploads.length === 2) return { abort: true };
          objects.push({ type: 'object', bucket: 'USER_IMAGES', key: 'a.txt', name: 'a.txt', size: 1, contentType: 'text/plain' });
          return { status: 201, body: { ok: true, data: { key: 'a.txt' } } };
        }
        return null;
      });
      page.on('dialog', dialog => dialog.accept('Q1 synthetic lost upload response'));
      await openAdmin(page, 'object-storage');
      await expect(page.locator('#objectStorageState')).toContainText('0 item(s)');
      await page.locator('#objectStorageUploadInput').setInputFiles(['a', 'b', 'c'].map(name => ({ name: name + '.txt', mimeType: 'text/plain', buffer: Buffer.from(name) })));
      const result = page.locator('#objectStorageUploadResult');
      const balance = '1 succeeded, 0 failed, 1 not attempted, 1 unconfirmed';
      await expect(result).toContainText(balance);
      await expect(result).toContainText('b.txt: Upload request failed; the object outcome is unknown. Verify the object before retrying.');
      await expect(result).toHaveAttribute('data-state', 'error');
      await expect(page.locator('#objectStorageUploadBtn')).toBeEnabled();
      await expect(page.locator('#objectStorageTable')).toContainText('a.txt');
      expect(uploads).toHaveLength(2);
      expect(uploads[0].body).toContain('filename="a.txt"');
      expect(uploads[1].body).toContain('filename="b.txt"');
      expect(new Set(uploads.map(upload => upload.key)).size).toBe(2);
      for (const upload of uploads) {
        expect(upload.key).toBeTruthy();
        expect(upload.body).toContain('Q1 synthetic lost upload response');
        expect(upload.body).toMatch(/name="overwrite"\r?\n\r?\nfalse/);
      }
      const beforeRefresh = listings;
      await page.locator('#objectStorageRefreshBtn').press('Enter');
      await expect.poll(() => listings).toBeGreaterThan(beforeRefresh);
      await expect(result).toContainText(balance);
      await expect(page.locator('#objectStorageTable')).toContainText('a.txt');
      expect(uploads).toHaveLength(2);
      expect(objects).toHaveLength(1);
      await expect(page.locator('#adminToast .admin-toast__item--success')).toHaveCount(0);
      expect(unexpected).toEqual([]);
    });

    for (const status of [200, 403, 404, 503]) {
      test(`U11 workbench availability follows API ${status}, separately from implementation`, async ({ page, baseURL }) => {
        const unexpected = await setup(page, baseURL, () => ({ status, body: status === 200 ? { ok: true } : { ok: false, error: 'Q1 probe unavailable' } }));
        await openAdmin(page, 'dashboard');
        const cards = page.locator('#adminWorkbenchTasks .admin-workbench-card');
        await expect(cards).toHaveCount(5);
        await expect(page.locator('#adminWorkbenchTasks')).toContainText('Implemented workflow');
        const withProbe = cards.filter({ hasNot: page.getByRole('heading', { name: 'Operations Triage', exact: true }) });
        await expect(withProbe.locator('.admin-workbench-card__top .badge--active')).toHaveCount(status === 200 ? 4 : 0);
        const ops = cards.filter({ has: page.getByRole('heading', { name: 'Operations Triage', exact: true }) });
        await expect(ops).toContainText('Availability not checked');
        await expect(ops.locator('.badge--active')).toHaveCount(0);
        const security = page.locator('#controlPlaneCapabilityGrid .admin-control-card').filter({ hasText: 'Security & Policy' });
        await expect(security).toContainText('Implemented in repository');
        await expect(security.locator('.badge--active')).toHaveCount(0);
        expect(unexpected).toEqual([]);
      });
    }

    for (const mode of ['complete-delta', 'complete-response', 'done-before-eof', 'partial-eof', 'read-error', 'malformed', 'cancel', 'timeout', 'empty', 'empty-json', 'json-fallback']) {
      test(`U16 ${mode}: completion, cleanup and next-request history`, async ({ page, baseURL }) => {
        const unexpected = await setup(page, baseURL);
        await page.addInitScript(({ mode }) => {
          const originalFetch = window.fetch.bind(window);
          const state = window.__q1Stream = { calls: [], cancellations: 0, mode };
          if (mode === 'timeout') window.BITBI_ADMIN_AI_LAB_TIMEOUTS = { liveAgent: 1000 };
          window.fetch = async (input, options = {}) => {
            const url = new URL(typeof input === 'string' ? input : input.url, location.href);
            if (url.pathname !== '/api/admin/ai/live-agent') return originalFetch(input, options);
            state.calls.push(JSON.parse(options.body));
            const current = state.calls.length === 1 ? mode : 'complete-delta';
            if (current === 'empty-json') return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
            if (current === 'json-fallback') return new Response(JSON.stringify({ result: { text: 'Complete answer' } }), { headers: { 'Content-Type': 'application/json' } });
            const encoder = new TextEncoder();
            let closed = false;
            const body = new ReadableStream({
              start(controller) {
                const emit = value => controller.enqueue(encoder.encode(value));
                const payload = current === 'complete-response' ? { response: 'Complete answer' } : { choices: [{ delta: { content: 'Complete answer' } }] };
                const text = 'data: ' + JSON.stringify(payload) + '\r\n\r\n';
                if (current !== 'empty') {
                  emit(text.slice(0, 17));
                  emit(text.slice(17, -3));
                  emit(text.slice(-3)); // Split JSON and CRLF across actual stream chunks.
                }
                if (current === 'done-before-eof') { emit('data:[DO'); emit('NE]\r'); emit('\n\r\n'); }
                const finish = () => {
                  if (closed) return;
                  closed = true;
                  if (current === 'read-error') controller.error(new Error('Q1 synthetic reader failure'));
                  else {
                    if (current === 'malformed') emit('data: {invalid-json}\n\n');
                    if (current.startsWith('complete') || current === 'empty') emit('data:[DONE]\r\n\r\n');
                    controller.close();
                  }
                };
                state.finish = finish;
                options.signal?.addEventListener('abort', () => { if (!closed) { closed = true; controller.error(new DOMException('Q1 aborted', 'AbortError')); } }, { once: true });
                if (state.calls.length > 1 || current === 'empty') finish();
              },
              cancel() { state.cancellations += 1; },
            });
            return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
          };
        }, { mode });
        await openAdmin(page, 'ai-lab');
        await page.locator('[data-ai-mode="live-agent"]').click();
        await page.locator('#aiLiveAgentInput').fill('First request');
        await page.locator('#aiLiveAgentSend').press('Enter');
        if (!['empty', 'empty-json', 'json-fallback'].includes(mode)) {
          await expect(page.locator('#aiLiveAgentTranscript')).toContainText('Complete answer');
          if (mode === 'cancel') await page.locator('#aiLiveAgentCancel').press('Enter');
          else if (mode !== 'timeout') {
            await expect(page.locator('#aiLiveAgentState')).not.toContainText('Response received.');
            await page.evaluate(() => window.__q1Stream.finish());
          }
        }
        const complete = mode.startsWith('complete') || mode === 'done-before-eof' || mode === 'json-fallback';
        const status = page.locator('#aiLiveAgentState');
        if (complete) await expect(status).toContainText('Response received.');
        else if (['empty', 'empty-json'].includes(mode)) await expect(status).toContainText('Model returned empty response.');
        else if (mode === 'cancel') await expect(status).toContainText('Request cancelled.');
        else if (mode === 'timeout') await expect(status).toContainText('timed out');
        else await expect(status).toContainText('Stream interrupted.');
        if (!complete && !['empty', 'empty-json'].includes(mode)) {
          await expect(page.locator('.admin-ai__chat-msg[data-completion="interrupted"]')).toContainText('assistant (interrupted)');
        }
        if (mode === 'empty-json') await expect(page.locator('.admin-ai__chat-msg--assistant')).toHaveCount(0);
        await expect(page.locator('#aiLiveAgentSend')).toBeEnabled();
        await expect(page.locator('#aiLiveAgentCancel')).toBeDisabled();
        await expect(page.locator('.admin-ai__chat-msg--streaming')).toHaveCount(0);
        await page.locator('#aiLiveAgentInput').fill('Follow-up request');
        await page.locator('#aiLiveAgentSend').press('Enter');
        await expect.poll(() => page.evaluate(() => window.__q1Stream.calls.length)).toBe(2);
        const result = await page.evaluate(() => ({ calls: window.__q1Stream.calls, cancellations: window.__q1Stream.cancellations }));
        expect(result.calls[1].messages.filter(message => message.role === 'assistant')).toEqual(complete ? [{ role: 'assistant', content: 'Complete answer' }] : []);
        expect(result.calls[1].messages.at(-1)).toEqual({ role: 'user', content: 'Follow-up request' });
        await expect(status).toContainText('Response received.');
        if (complete || mode === 'partial-eof' || ['empty', 'empty-json'].includes(mode)) expect(result.cancellations).toBe(0);
        expect(unexpected).toEqual([]);
      });
    }
  });
}
