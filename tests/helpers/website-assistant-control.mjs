import standardControl from './q2-runtime/control.mjs';
import { assistantDefaultSettings, callAssistantControl } from '../../workers/auth/src/lib/website-assistant-control.js';
// Existing native harness control only. The production router has no fixture
// switch. This control requires the harness token and uses no external model.
import { createWebsiteAssistantHandler } from '../../workers/auth/src/routes/website-assistant.js';
import { knowledgeVersion } from '../../workers/shared/website-assistant-knowledge.mjs';
import { reserveAssistantBudget, settleAssistantBudget } from '../../workers/auth/src/lib/website-assistant-budget.js';
import { testAssistantPolicy, testAssistantStream } from './website-assistant-policy.mjs';

const check = (condition, message) => { if (!condition) throw new Error(message); };

function isolatedBudget(env, prefix) {
  return { PUBLIC_RATE_LIMITER: {
    idFromName: name => env.PUBLIC_RATE_LIMITER.idFromName(`test-website-assistant-${prefix}-${name}`),
    get: id => env.PUBLIC_RATE_LIMITER.get(id),
  } };
}

async function controlScenario(env) {
  const testEnv = isolatedBudget(env, crypto.randomUUID());
  const defaults = assistantDefaultSettings(testAssistantPolicy(knowledgeVersion));
  const initial = await callAssistantControl(testEnv);
  const enabled = await callAssistantControl(testEnv, 'write', { revision: 0, settings: { ...defaults, mode: 'public' }, actor: 'test-admin' });
  const limits = { dailyMicros: 1000, monthlyMicros: 5000, dailyRequests: 10, concurrentRequests: 2, leaseMs: 5000 };
  const requestId = crypto.randomUUID();
  const first = await reserveAssistantBudget(testEnv, { requestId, reservationMicros: 100, limits,
    controlRevision: enabled.control.revision, audience: 'public', model: defaults.model, evidence: 'synthetic' });
  const off = await callAssistantControl(testEnv, 'write', { revision: 1, settings: defaults, actor: 'test-admin' });
  const stale = await reserveAssistantBudget(testEnv, { requestId: crypto.randomUUID(), reservationMicros: 100, limits,
    controlRevision: 1, audience: 'public', model: defaults.model });
  const denied = await reserveAssistantBudget(testEnv, { requestId: crypto.randomUUID(), reservationMicros: 100, limits,
    controlRevision: 2, audience: 'public', model: defaults.model });
  const settled = await settleAssistantBudget(testEnv, { requestId, outcome: 'completed', costMicros: 25,
    usage: { inputTokens: 10, outputTokens: 2 }, latencyMs: 50 });
  const restored = await callAssistantControl(testEnv, 'restore', { revision: 2, actor: 'test-admin' });
  const writes = await Promise.all(['friendly', 'neutral'].map(tone => callAssistantControl(testEnv, 'write', {
    revision: restored.control.revision, settings: { ...defaults, tone }, actor: 'test-admin',
  })));
  const readback = await callAssistantControl(testEnv);
  return { initial, enabled, first, off, stale, denied, settled, restored, writes, readback };
}

async function budgetScenario(env, name) {
  const budgetEnv = isolatedBudget(env, crypto.randomUUID());
  const limits = { dailyMicros: 1000, monthlyMicros: 10000, dailyRequests: 100, concurrentRequests: 10, leaseMs: 5000 };
  const reserve = (overrides = {}) => reserveAssistantBudget(budgetEnv, { requestId: crypto.randomUUID(), reservationMicros: 100, limits, ...overrides });
  if (name === 'atomic') {
    const results = await Promise.all(Array.from({ length: 40 }, () => reserve()));
    return { admitted: results.filter(result => result.permitted).length, denied: results.filter(result => result.code === 'assistant_daily_budget').length };
  }
  if (name === 'settlement') {
    limits.dailyMicros = 100;
    const requestId = crypto.randomUUID();
    const first = await reserve({ requestId });
    const settle = () => settleAssistantBudget(budgetEnv, { requestId, costMicros: 25, usage: { inputTokens: 30, outputTokens: 10 }, outcome: 'completed' });
    const settled = await settle();
    const again = await settle();
    const duplicate = await reserve({ requestId });
    const remainder = await reserve({ reservationMicros: 75 });
    const exceeded = await reserve({ reservationMicros: 1 });
    return { first, settled, again, duplicate, remainder, exceeded };
  }
  if (name === 'cancelled' || name === 'missing-usage') {
    limits.concurrentRequests = 1;
    const requestId = crypto.randomUUID();
    const first = await reserve({ requestId });
    const settled = await settleAssistantBudget(budgetEnv, { requestId, costMicros: 0, usage: null, outcome: name === 'cancelled' ? 'cancelled' : 'completed' });
    const next = await reserve();
    return { first, settled, next };
  }
  if (name === 'request-cap') {
    limits.dailyRequests = 1;
    const requestId = crypto.randomUUID();
    const first = await reserve({ requestId });
    await settleAssistantBudget(budgetEnv, { requestId, costMicros: 1, usage: { inputTokens: 1, outputTokens: 1 }, outcome: 'completed' });
    return { first, next: await reserve() };
  }
  throw new Error('Unknown budget fixture');
}

export async function assistantRouteScenario(env, name) {
  const tasks = [], trace = { providerCalls: 0, cancelled: 0, privateReads: 0 };
  const policy = testAssistantPolicy(knowledgeVersion);
  const language = name === 'de' ? 'de' : 'en';
  const body = { page: 'canvas', locale: language, contentVersion: knowledgeVersion, history: [],
    message: language === 'de' ? 'Wie starte ich einen Canvas-Workflow?' : 'How do I start a Canvas workflow?' };
  if (name === 'unknown') body.message = 'Tell me about the moons of Neptune';
  if (name === 'stale') body.contentVersion = 'test-old-content';
  if (name === 'private-context') body.projectTitle = 'test-private-project';
  const testEnv = { ...env, ...isolatedBudget(env, crypto.randomUUID()), WEBSITE_ASSISTANT_ENABLED: 'true',
    DB: { prepare() { trace.privateReads++; throw new Error('Private account reads prohibited'); } },
    AI: { async run(model, payload, options) {
      trace.providerCalls++;
      check(model === policy.model && options === undefined, 'No model substitution or gateway logging');
      check(payload.stream === true && payload.max_tokens === policy.limits.outputTokens, 'Bounded streaming model contract');
      check(payload.messages.length === 2 && payload.messages[0].role === 'system' && payload.messages[1].role === 'user', 'Server controls instruction roles');
      check(payload.messages[0].content.includes('canvas-start'), 'Retrieved public source is included');
      check(!payload.messages[0].content.includes('test-private-project'), 'Private context cannot enter evidence');
      if (name === 'error') throw new Error('test-private-upstream-diagnostic');
      if (name === 'cancel') return new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('data: {"response":"Open Canvas."}\n\n')); },
        cancel() { trace.cancelled++; },
      });
      return testAssistantStream({ chunks: language === 'de' ? ['Öffnen Sie Canvas. ', 'Verbinden Sie Nodes und führen Sie zuerst Upstream aus.'] : ['Open Canvas. ', 'Connect nodes and run upstream first.'] });
    } },
  };
  const seeded = await callAssistantControl(testEnv, 'write', { revision: 0, settings: { ...assistantDefaultSettings(policy), mode: 'public' }, actor: 'test-admin' });
  check(seeded.ok === true, 'Synthetic approved control must be explicitly enabled');
  const handle = createWebsiteAssistantHandler({ policy });
  const url = new URL(name === 'config' ? 'https://bitbi.ai/api/public/assistant/config?page=canvas&locale=en' : 'https://bitbi.ai/api/public/assistant/chat');
  const request = new Request(url, { method: name === 'config' ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://bitbi.ai', 'CF-Connecting-IP': '192.0.2.123' }, body: name === 'config' ? undefined : JSON.stringify(body) });
  const result = await handle({ request, env: testEnv, url, pathname: url.pathname, method: request.method, isSecure: true, execCtx: { waitUntil(task) { tasks.push(task); } } });
  let output;
  if (name === 'cancel') {
    const reader = result.body.getReader();
    const decoder = new TextDecoder();
    output = '';
    while (!output.includes('event: delta')) {
      const chunk = await reader.read();
      check(!chunk.done, 'A real streamed delta must precede cancellation');
      output += decoder.decode(chunk.value);
    }
    await reader.cancel();
  } else output = await result.text();
  await Promise.all(tasks);
  return { status: result.status, contentType: result.headers.get('content-type'), output, ...trace };
}

export default {
  async fetch(request, env) {
    if (request.method !== 'POST' || request.headers.get('x-q2-control') !== env.Q2_CONTROL_TOKEN) return new Response(null, { status: 403 });
    const path = new URL(request.url).pathname;
    if (['/session', '/password', '/totp'].includes(path)) return standardControl.fetch(request, env);
    const body = await request.json();
    if (path === '/assistant-control' && body.name === 'lifecycle') return Response.json(await controlScenario(env));
    if (path === '/assistant-budget' && ['atomic', 'settlement', 'cancelled', 'missing-usage', 'request-cap'].includes(body.name)) return Response.json(await budgetScenario(env, body.name));
    if (path === '/assistant-route' && ['en', 'de', 'config', 'unknown', 'stale', 'private-context', 'error', 'cancel'].includes(body.name)) return Response.json(await assistantRouteScenario(env, body.name));
    return new Response(null, { status: 404 });
  },
};
