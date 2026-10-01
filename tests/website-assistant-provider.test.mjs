import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assistantAdmission, ASSISTANT_POLICY, measuredAssistantCost } from '../workers/auth/src/lib/website-assistant-policy.js';
import { assistantModelEvents, openAssistantModel } from '../workers/auth/src/lib/website-assistant-provider.js';
import { testAssistantPolicy, testAssistantStream } from './helpers/website-assistant-policy.mjs';

const version = 'test-kb-v1';
const env = { WEBSITE_ASSISTANT_ENABLED: 'true' };
const admission = (policy) => assistantAdmission(env, policy, { knowledgeVersion: version });

test('unapproved production policy never admits inference; every activation prerequisite fails closed', () => {
  assert.equal(admission(ASSISTANT_POLICY).ready, false);
  const valid = testAssistantPolicy(version);
  assert.equal(admission(valid).ready, true);
  for (const change of [{ accessConfirmed: false }, { processingTermsReviewed: false }, { euOnlyRequired: true }, { pricing: null },
    { spendingApproval: null }, { acceptance: null }, { model: '@cf/unapproved/model' },
    { pricing: { ...valid.pricing, inputUsdMicrosPerMillion: 0 } },
    { pricing: { ...valid.pricing, validUntil: '2020-01-01' } },
    { spendingApproval: { ...valid.spendingApproval, dailyUsdMicros: 1 } },
    { acceptance: { ...valid.acceptance, knowledgeVersion: 'old-content' } }]) {
    assert.equal(admission({ ...valid, ...change }).ready, false, JSON.stringify(Object.keys(change)));
  }
  assert.equal(assistantAdmission({}, valid, { knowledgeVersion: version }).ready, false);
  assert.equal(assistantAdmission(env, { ...valid, acceptance: null }, { knowledgeVersion: version, privateAcceptance: true }).ready, true);
});

test('conservative reservation and measured cost have explicit different semantics', () => {
  const ready = admission(testAssistantPolicy(version));
  assert.equal(ready.reservationMicros, 26317);
  assert.equal(measuredAssistantCost({ prompt_tokens: 120, completion_tokens: 20 }, ready), 16);
  for (const usage of [null, {}, { prompt_tokens: -1, completion_tokens: 1 }, { prompt_tokens: 1, completion_tokens: 900 },
    { prompt_tokens: 0, completion_tokens: 1 }, { prompt_tokens: 1, completion_tokens: 0 },
    { prompt_tokens: 0, completion_tokens: 0 }]) assert.equal(measuredAssistantCost(usage, ready), null);
});

test('real adapter selects only admitted model, streaming and bounded output without gateway or retries', async () => {
  const ready = admission(testAssistantPolicy(version)); let calls = 0;
  const stream = await openAssistantModel({ AI: { async run(model, options, extra) {
    calls += 1; assert.equal(model, ready.model); assert.equal(options.stream, true);
    assert.equal(options.max_tokens, 512); assert.equal(extra, undefined); assert.equal(options.tools, undefined);
    return testAssistantStream();
  } } }, ready, [{ role: 'user', content: 'test' }]);
  const events = [];
  for await (const event of assistantModelEvents(stream)) events.push(event);
  assert.equal(calls, 1); assert.equal(events.filter(event => event.text).length, 2);
  assert.deepEqual(events.at(-1).usage, { prompt_tokens: 120, completion_tokens: 20 });
});

test('truncation, unbounded output and malformed provider events are errors, not success', async () => {
  const collect = async stream => { for await (const event of assistantModelEvents(stream)) assert.ok(event); };
  await assert.rejects(collect(testAssistantStream({ complete: false })), /incomplete/);
  await assert.rejects(collect(testAssistantStream({ chunks: ['x'.repeat(8001)] })), /protocol/);
  await assert.rejects(collect(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: invalid\n\n')); controller.close(); } })), /protocol/);
});

test('cancellation cancels a stalled upstream reader without an automatic provider retry', async () => {
  let cancelled = false;
  const abort = new AbortController();
  const stream = new ReadableStream({ cancel() { cancelled = true; } });
  const consume = (async () => { for await (const event of assistantModelEvents(stream, { signal: abort.signal })) assert.ok(event); })();
  abort.abort();
  await assert.rejects(consume, /cancelled/); assert.equal(cancelled, true);
});

const encode = value => new TextEncoder().encode(value);
const usageEvent = usage => `data: ${JSON.stringify({ usage })}\n\n`;

async function collectEvents(stream, options) {
  const result = [];
  for await (const event of assistantModelEvents(stream, options)) result.push(event);
  return result;
}

test('never-resolving upstream cancellation cannot hold an aborted read or completed response open', { timeout: 1000 }, async () => {
  let cancelled = 0;
  const abort = new AbortController();
  const pending = collectEvents(new ReadableStream({ cancel() { cancelled += 1; return new Promise(() => {}); } }), { signal: abort.signal });
  abort.abort();
  await assert.rejects(pending, /cancelled/);
  assert.equal(cancelled, 1);
  const result = await collectEvents(new ReadableStream({
    start(controller) { controller.enqueue(encode('data: {"response":"Complete."}\n\ndata: [DONE]\n\n')); },
    cancel() { cancelled += 1; return new Promise(() => {}); },
  }));
  assert.deepEqual(result, [{ text: 'Complete.' }]);
  assert.equal(cancelled, 2);
});

test('only consistent final usage is measured; conflicting, zero, missing and malformed counters keep the reservation', async () => {
  const valid = { prompt_tokens: 120, completion_tokens: 20 };
  for (const usages of [
    [valid, { prompt_tokens: 120, completion_tokens: 21 }],
    [{ prompt_tokens: 0, completion_tokens: 0 }],
    [{ prompt_tokens: 120, completion_tokens: 20, total_tokens: 1 }],
    [{ prompt_tokens: '120', completion_tokens: 20 }],
    [{}, valid], [],
  ]) {
    const events = await collectEvents(new ReadableStream({ start(controller) {
      controller.enqueue(encode('data: {"response":"A supported answer."}\n\n' + usages.map(usageEvent).join('') + 'data: [DONE]\n\n'));
      controller.close();
    } }));
    assert.equal(events.map(event => event.text || '').join(''), 'A supported answer.');
    assert.equal(events.filter(event => event.usage).length, 0);
  }
  const consistent = await collectEvents(new ReadableStream({ start(controller) {
    controller.enqueue(encode('data: {"response":"A supported answer."}\n\n' + usageEvent(valid) + usageEvent(valid) + 'data: [DONE]\n\n'));
    controller.close();
  } }));
  assert.deepEqual(consistent.filter(event => event.usage), [{ usage: valid }]);
});

test('split UTF-8 and CRLF boundaries preserve text while incomplete and oversized events still fail', async () => {
  const bytes = encode('data: {"response":"Grüße aus BITBI."}\r\n\r\ndata: [DONE]\r\n\r\n');
  const split = await collectEvents(new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
    controller.close();
  } }));
  assert.deepEqual(split, [{ text: 'Grüße aus BITBI.' }]);
  await assert.rejects(collectEvents(new ReadableStream({ start(controller) {
    controller.enqueue(encode('data: ' + ' '.repeat(16385))); controller.close();
  } })), /protocol/);
  await assert.rejects(collectEvents(new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array([100, 97, 116, 97, 58, 32, 255])); controller.close();
  } })), /encoded|encoding/i);
});
