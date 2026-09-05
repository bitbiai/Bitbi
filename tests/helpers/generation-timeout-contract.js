const { test, expect } = require('@playwright/test');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function withDeadlineClock(run) {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timers = new Map();
  let nextId = 1;
  globalThis.setTimeout = (callback, delay) => {
    const id = nextId++;
    timers.set(id, { callback, delay });
    return id;
  };
  globalThis.clearTimeout = (id) => timers.delete(id);
  try {
    await run({
      pending: () => timers.size,
      expire() {
        const entry = timers.entries().next().value;
        if (!entry) throw new Error('Expected a pending generation deadline.');
        timers.delete(entry[0]);
        entry[1].callback();
      },
    });
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
}

function registerGenerationTimeoutContractTests({ loadAuthGenerationTimeoutModule, loadAiGenerationTimeoutModule }) {
  test.describe('REL-01 generation timeout contract', () => {
    for (const [worker, load] of [['Auth', loadAuthGenerationTimeoutModule], ['AI', loadAiGenerationTimeoutModule]]) {
      test(`${worker}: success preserves its result and clears timer and caller listener`, async () => {
        const helper = await load();
        const caller = new AbortController();
        const add = caller.signal.addEventListener.bind(caller.signal);
        const remove = caller.signal.removeEventListener.bind(caller.signal);
        let adds = 0;
        let removes = 0;
        caller.signal.addEventListener = (...args) => { adds += 1; return add(...args); };
        caller.signal.removeEventListener = (...args) => { removes += 1; return remove(...args); };
        await withDeadlineClock(async (clock) => {
          let taskSignal;
          const value = await helper.runWithGenerationTimeout((signal) => {
            taskSignal = signal;
            return 'complete';
          }, { signal: caller.signal, timeoutMs: 10 });
          expect(value).toBe('complete');
          expect(taskSignal).toBeInstanceOf(AbortSignal);
          expect(taskSignal.aborted).toBe(false);
          expect(clock.pending()).toBe(0);
          expect(adds).toBe(1);
          expect(removes).toBe(1);
        });
      });

      test(`${worker}: timeout aborts cooperative work once with the stable 504`, async () => {
        const helper = await load();
        await withDeadlineClock(async (clock) => {
          const started = deferred();
          let taskSignal;
          let aborts = 0;
          const pending = helper.runWithGenerationTimeout((signal) => {
            taskSignal = signal;
            signal?.addEventListener('abort', () => { aborts += 1; }, { once: true });
            started.resolve();
            return new Promise(() => {});
          }, { timeoutMs: 10 });
          const failure = pending.catch((error) => error);
          await started.promise;
          clock.expire();
          expect(await failure).toMatchObject({ name: 'GenerationTimeoutError', code: 'generation_timeout', status: 504 });
          expect(taskSignal?.aborted).toBe(true);
          expect(aborts).toBe(1);
          expect(clock.pending()).toBe(0);
        });
      });

      test(`${worker}: an already aborted caller never starts provider work`, async () => {
        const helper = await load();
        const caller = new AbortController();
        const reason = new DOMException('Caller canceled.', 'AbortError');
        caller.abort(reason);
        let calls = 0;
        const outcome = await helper.runWithGenerationTimeout(() => { calls += 1; return 'unexpected'; }, {
          signal: caller.signal,
        }).catch((error) => error);
        expect(outcome).toBe(reason);
        expect(helper.isGenerationTimeoutError(outcome)).toBe(false);
        expect(calls).toBe(0);
      });

      test(`${worker}: caller abort rejects promptly without becoming a timeout`, async () => {
        const helper = await load();
        const caller = new AbortController();
        const reason = new DOMException('Caller canceled.', 'AbortError');
        await withDeadlineClock(async (clock) => {
          const started = deferred();
          let taskSignal;
          const pending = helper.runWithGenerationTimeout((signal) => {
            taskSignal = signal;
            started.resolve();
            return new Promise(() => {});
          }, { signal: caller.signal, timeoutMs: 10 });
          const failure = pending.catch((error) => error);
          await started.promise;
          caller.abort(reason);
          // Expire any old implementation timer so the failing baseline stays bounded.
          if (clock.pending()) clock.expire();
          const error = await failure;
          expect(error).toBe(reason);
          expect(helper.isGenerationTimeoutError(error)).toBe(false);
          expect(taskSignal?.aborted).toBe(true);
          expect(clock.pending()).toBe(0);
        });
      });

      test(`${worker}: late rejection after a timeout is observed and a late stream is canceled`, async () => {
        const helper = await load();
        await withDeadlineClock(async (clock) => {
          const provider = deferred();
          const started = deferred();
          let cancels = 0;
          const pending = helper.runWithGenerationTimeout(() => { started.resolve(); return provider.promise; }, { timeoutMs: 10 });
          const failure = pending.catch((error) => error);
          await started.promise;
          clock.expire();
          expect(await failure).toMatchObject({ code: 'generation_timeout' });
          provider.resolve(new ReadableStream({ cancel() { cancels += 1; } }));
          await new Promise((resolve) => setImmediate(resolve));
          expect(cancels).toBe(1);
          const lateReject = deferred();
          const rejected = helper.runWithGenerationTimeout(() => lateReject.promise, { timeoutMs: 10 });
          const observed = rejected.catch((error) => error);
          await Promise.resolve();
          clock.expire();
          expect(await observed).toMatchObject({ code: 'generation_timeout' });
          lateReject.reject(new Error('Late mocked provider failure.'));
          await new Promise((resolve) => setImmediate(resolve));
          expect(clock.pending()).toBe(0);
        });
      });

      test(`${worker}: fetch preserves Request init and composes caller cancellation`, async () => {
        const helper = await load();
        const caller = new AbortController();
        const original = new Request('https://fixture.invalid/input', { headers: { 'x-original': 'yes' } });
        let seen;
        const result = await helper.fetchWithGenerationTimeout(async (request) => {
          seen = request;
          return new Response('ok');
        }, original, { method: 'POST', body: 'payload', headers: { 'x-override': 'yes' }, signal: caller.signal });
        expect(await result.text()).toBe('ok');
        expect(seen.method).toBe('POST');
        expect(seen.headers.get('x-override')).toBe('yes');
        expect(await seen.text()).toBe('payload');
        expect(caller.signal.aborted).toBe(false);
      });

      test(`${worker}: fetch honors an input Request signal without starting after cancellation`, async () => {
        const helper = await load();
        const caller = new AbortController();
        const request = new Request('https://fixture.invalid/input', { signal: caller.signal });
        const reason = new DOMException('Canceled before fetch.', 'AbortError');
        caller.abort(reason);
        let calls = 0;
        const result = await helper.fetchWithGenerationTimeout(async () => {
          calls += 1;
          return new Response('unexpected');
        }, request).catch((error) => error);
        expect(result).toBe(reason);
        expect(calls).toBe(0);
      });

      test(`${worker}: an explicit null init signal overrides the input Request signal`, async () => {
        const helper = await load();
        const caller = new AbortController();
        const request = new Request('https://fixture.invalid/input', { signal: caller.signal });
        caller.abort();
        let calls = 0;
        const response = await helper.fetchWithGenerationTimeout(async (input) => {
          calls += 1;
          expect(input.signal.aborted).toBe(false);
          return new Response('ok');
        }, request, { signal: null });
        expect(await response.text()).toBe('ok');
        expect(calls).toBe(1);
      });

      test(`${worker}: response validation failure cancels unread bytes and preserves its error`, async () => {
        const helper = await load();
        let cancellations = 0;
        const body = new ReadableStream({ cancel() { cancellations += 1; } });
        const reason = new Error('Mock content type rejected.');
        const result = await helper.fetchWithGenerationTimeout(async () => new Response(body), 'https://fixture.invalid/', undefined, {
          consumeResponse: () => { throw reason; },
        }).catch((error) => error);
        expect(result).toBe(reason);
        expect(cancellations).toBe(1);
        expect(body.locked).toBe(false);
      });

      test(`${worker}: an upstream AbortError is not relabeled as the local deadline`, async () => {
        const helper = await load();
        const reason = new DOMException('Upstream canceled.', 'AbortError');
        const result = await helper.fetchWithGenerationTimeout(async () => { throw reason; }, 'https://fixture.invalid/').catch((error) => error);
        expect(result).toBe(reason);
        expect(helper.isGenerationTimeoutError(result)).toBe(false);
      });

      test(`${worker}: headers-only fetch hands stream ownership to the caller`, async () => {
        const helper = await load();
        await withDeadlineClock(async (clock) => {
          let streamController;
          const body = new ReadableStream({ start(controller) { streamController = controller; } });
          const response = new Response(body, { headers: { 'content-type': 'text/event-stream' } });
          const result = await helper.fetchWithGenerationTimeout(async () => response, 'https://fixture.invalid/', undefined, { timeoutMs: 10 });
          expect(result).toBe(response);
          expect(clock.pending()).toBe(0);
          streamController.enqueue(new TextEncoder().encode('data: complete\n\n'));
          streamController.close();
          expect(await result.text()).toBe('data: complete\n\n');
        });
      });

      test(`${worker}: caller cancellation still reaches the fetch body after headers`, async () => {
        const helper = await load();
        const caller = new AbortController();
        const reason = new DOMException('Caller canceled returned stream.', 'AbortError');
        await withDeadlineClock(async (clock) => {
          let fetchSignal;
          const body = new ReadableStream();
          const response = await helper.fetchWithGenerationTimeout(async (_url, init) => {
            fetchSignal = init.signal;
            return new Response(body);
          }, 'https://fixture.invalid/', { signal: caller.signal }, { timeoutMs: 10 });
          expect(clock.pending()).toBe(0);
          expect(fetchSignal.aborted).toBe(false);
          caller.abort(reason);
          expect(fetchSignal.aborted).toBe(true);
          expect(fetchSignal.reason).toBe(reason);
          await response.body.cancel();
        });
      });

      test(`${worker}: explicit response consumption shares the fetch deadline`, async () => {
        const helper = await load();
        await withDeadlineClock(async (clock) => {
          const reading = deferred();
          const bodyDone = deferred();
          let fetchSignal;
          const pending = helper.fetchWithGenerationTimeout(async (_url, init) => {
            fetchSignal = init.signal;
            return new Response('fixture');
          }, 'https://fixture.invalid/', undefined, {
            timeoutMs: 10,
            consumeResponse: async () => { reading.resolve(); return bodyDone.promise; },
          });
          const outcome = pending.catch((error) => error);
          // The old implementation returns the Response without invoking consumption.
          await Promise.race([reading.promise, outcome]);
          if (clock.pending()) clock.expire();
          expect(await outcome).toMatchObject({ code: 'generation_timeout', status: 504 });
          expect(fetchSignal?.aborted).toBe(true);
          bodyDone.resolve('late bytes');
          await new Promise((resolve) => setImmediate(resolve));
          expect(clock.pending()).toBe(0);
        });
      });
    }

  });
}

module.exports = { deferred, withDeadlineClock, registerGenerationTimeoutContractTests };
