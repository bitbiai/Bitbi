const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createAuthTestEnv } = require('./auth-worker-harness.js');
const load = (file) => import(pathToFileURL(path.join(process.cwd(), file)).href);

function registerVideoTransportOutcomeContractTests() {
  test.describe('REL-01 finite Admin proxy and Vidu dispatch proof', () => {
    test('trusted service outcome is retained privately and stripped from the public response', async () => {
      const proxy = await load('workers/auth/src/lib/admin-ai-proxy.js');
      for (const outcome of ['failed', 'succeeded']) {
        const env = createAuthTestEnv();
        env.AI_LAB = { fetch: async () => Response.json({ ok: false, code: 'upstream_error' }, { status: 502, headers: { 'x-bitbi-provider-outcome': outcome } }) };
        const response = await proxy.proxyToAiLab(env, '/internal/ai/test-music', { method: 'POST', body: {} },
          { id: 'local-admin', email: 'local@example.invalid' }, 'local-evidence', null, { consumeResponse: proxy.consumeAiLabJsonResponse });
        expect(response.status).toBe(502);
        expect(proxy.getAiLabProviderOutcome(response)).toBe(outcome);
        expect(response.headers.has('x-bitbi-provider-outcome')).toBe(false);
        expect(await response.json()).toMatchObject({ ok: false, code: 'upstream_error' });
      }
    });

    test('client header and fabricated Response cannot supply trusted provider outcome', async () => {
      const proxy = await load('workers/auth/src/lib/admin-ai-proxy.js');
      const env = createAuthTestEnv(); let internalRequest;
      env.AI_LAB = { fetch: async (request) => { internalRequest = request; return Response.json({ ok: false, code: 'upstream_error' }, { status: 502 }); } };
      const client = new Request('https://bitbi.ai/api/admin/ai/test-music', { headers: { 'x-bitbi-provider-outcome': 'failed' } });
      const response = await proxy.proxyToAiLab(env, '/internal/ai/test-music', { method: 'POST', body: { providerOutcome: 'failed' } },
        { id: 'local-admin', email: 'local@example.invalid' }, 'local-spoof', { request: client }, { consumeResponse: proxy.consumeAiLabJsonResponse });
      expect(internalRequest.headers.has('x-bitbi-provider-outcome')).toBe(false);
      expect(proxy.getAiLabProviderOutcome(response)).toBeNull();
      expect(proxy.getAiLabProviderOutcome(new Response(null, { headers: { 'x-bitbi-provider-outcome': 'failed' } }))).toBeNull();
    });

    test('finite Auth-AI JSON body stall cancels owned body at deadline', async () => {
      const proxy = await load('workers/auth/src/lib/admin-ai-proxy.js');
      const env = createAuthTestEnv();
      let cancelled = 0; let transportSignal;
      env.AI_LAB = { fetch: async (request) => {
        transportSignal = request.signal;
        return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"ok":')); }, cancel() { cancelled += 1; } }), { headers: { 'content-type': 'application/json' } });
      } };
      const response = await proxy.proxyToAiLab(env, '/internal/ai/test-text', { method: 'POST', body: {} }, { id: 'local-admin', email: 'local@example.invalid' }, 'local-deadline', null,
        { timeoutMs: 10, consumeResponse: proxy.consumeAiLabJsonResponse });
      expect(response.status).toBe(504);
      expect((await response.json()).code).toBe('request_timeout');
      expect(transportSignal.aborted).toBe(true);
      expect(cancelled).toBe(1);
    });

    test('finite Auth-AI body consumption forwards caller cancellation without extending streaming policy', async () => {
      const proxy = await load('workers/auth/src/lib/admin-ai-proxy.js');
      const env = createAuthTestEnv(); const caller = new AbortController();
      let start; const started = new Promise((resolve) => { start = resolve; });
      let cancelled = 0; let transportSignal;
      env.AI_LAB = { fetch: async (request) => {
        transportSignal = request.signal; start();
        return new Response(new ReadableStream({ cancel() { cancelled += 1; } }), { headers: { 'content-type': 'application/json' } });
      } };
      const result = proxy.proxyToAiLab(env, '/internal/ai/test-text', { method: 'POST', body: {} }, { id: 'local-admin', email: 'local@example.invalid' }, 'local-caller', null,
        { timeoutMs: 1000, signal: caller.signal, consumeResponse: proxy.consumeAiLabJsonResponse });
      await started; caller.abort(new Error('local caller cancellation'));
      expect((await result).status).toBe(503);
      expect(transportSignal.aborted).toBe(true);
      expect(cancelled).toBe(1);
    });

    for (const kind of ['message_only', 'timeout', 'caller_abort']) {
      test(`Vidu ${kind} is insufficient proof for a second billable create`, async () => {
        const { invokeVideo } = await load('workers/ai/src/lib/invoke-ai-video.js');
        const helper = await load('workers/ai/src/lib/generation-timeout.js');
        const error = kind === 'timeout' ? helper.createGenerationTimeoutError()
          : kind === 'caller_abort' ? new DOMException('Request validation failed', 'AbortError')
            : new Error('Model execution failed: Request validation failed');
        let creates = 0; let firstCalls = 0; const originalFetch = globalThis.fetch;
        globalThis.fetch = async () => { creates += 1; throw new Error('Unexpected alternate provider create'); };
        try {
          const env = { AI: { run: async () => { firstCalls += 1; throw error; } }, VIDU_API_KEY: 'local-mock-only' };
          await expect(invokeVideo(env, { id: 'vidu/q3-pro' }, { prompt: 'local fixture', duration: 5, resolution: '720p' })).rejects.toThrow();
          expect(firstCalls).toBe(1);
          expect(creates).toBe(0);
        } finally { globalThis.fetch = originalFetch; }
      });
    }

    test('explicit mocked non-dispatch proof preserves known-safe Vidu fallback and payload', async () => {
      const { invokeVideo } = await load('workers/ai/src/lib/invoke-ai-video.js');
      const error = Object.assign(new Error('Request validation failed'), { providerOutcome: 'not_dispatched' });
      const originalFetch = globalThis.fetch; const paths = []; let payload;
      globalThis.fetch = async (url, init) => {
        const pathname = new URL(url).pathname; paths.push(pathname);
        if (pathname === '/ent/v2/text2video') {
          payload = JSON.parse(init.body);
          return Response.json({ task_id: 'mock-vidu-task', state: 'created' });
        }
        if (pathname === '/ent/v2/tasks/mock-vidu-task/creations') return Response.json({ state: 'success', creations: [{ url: 'https://fixture.invalid/vidu.mp4' }] });
        throw new Error('Unexpected mocked Vidu path');
      };
      try {
        const result = await invokeVideo({ AI: { run: async () => { throw error; } }, VIDU_API_KEY: 'local-mock-only', __VIDU_POLL_INTERVAL_MS: 0, __VIDU_POLL_TIMEOUT_MS: 1000 },
          { id: 'vidu/q3-pro' }, { prompt: 'local fixture', duration: 5, resolution: '720p' });
        expect(result.videoUrl).toBe('https://fixture.invalid/vidu.mp4');
        expect(paths).toEqual(['/ent/v2/text2video', '/ent/v2/tasks/mock-vidu-task/creations']);
        expect(payload).toMatchObject({ model: 'viduq3-pro', prompt: 'local fixture', duration: 5, resolution: '720p' });
      } finally { globalThis.fetch = originalFetch; }
    });

    test('Vidu create response body timeout cancels body and never repeats create', async () => {
      const { invokeVideo } = await load('workers/ai/src/lib/invoke-ai-video.js');
      const error = Object.assign(new Error('Request validation failed'), { providerOutcome: 'not_dispatched' });
      const originalFetch = globalThis.fetch; const originalTimeout = globalThis.setTimeout;
      let creates = 0; let cancelled = 0;
      globalThis.setTimeout = (callback, delay, ...args) => originalTimeout(callback, delay === 600000 ? 10 : delay, ...args);
      globalThis.fetch = async () => {
        creates += 1;
        return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"task_id":')); }, cancel() { cancelled += 1; } }), { headers: { 'content-type': 'application/json' } });
      };
      try {
        await expect(invokeVideo({ AI: { run: async () => { throw error; } }, VIDU_API_KEY: 'local-mock-only' }, { id: 'vidu/q3-pro' },
          { prompt: 'local fixture', duration: 5, resolution: '720p' })).rejects.toThrow();
        expect(creates).toBe(1);
        expect(cancelled).toBe(1);
      } finally { globalThis.fetch = originalFetch; globalThis.setTimeout = originalTimeout; }
    });
  });
}
module.exports = { registerVideoTransportOutcomeContractTests };
