import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { assistantDefaultSettings, callAssistantControl, ASSISTANT_CONTROL_STORAGE_KEY, assistantAdminOverview } from '../workers/auth/src/lib/website-assistant-control.js';
import { ASSISTANT_BUDGET_STORAGE_KEY, reserveAssistantBudget } from '../workers/auth/src/lib/website-assistant-budget.js';
import { ASSISTANT_POLICY } from '../workers/auth/src/lib/website-assistant-policy.js';
import { createWebsiteAssistantHandler } from '../workers/auth/src/routes/website-assistant.js';
import { knowledgeVersion } from '../workers/shared/website-assistant-knowledge.mjs';
import { harness, storageDouble } from './helpers/website-assistant-fixture.mjs';
import { testAssistantPolicy, testAssistantStream } from './helpers/website-assistant-policy.mjs';
const { createAuthTestEnv, seedSession } = createRequire(import.meta.url)('./helpers/auth-worker-harness.js');

async function adminFixture({ policy = ASSISTANT_POLICY, enabled = 'false' } = {}) {
  const h = harness(), calls = [], tasks = [];
  const users = ['admin', 'member'].map(role => ({ id: `test-${role}`, email: `${role}@example.invalid`, status: 'active', role, created_at: new Date().toISOString(), verification_method: 'email_verified' }));
  const env = { ...createAuthTestEnv({ users, PUBLIC_RATE_LIMITER: h.env.PUBLIC_RATE_LIMITER }), WEBSITE_ASSISTANT_ENABLED: enabled,
    AI: { async run() { calls.push(true); return testAssistantStream(); } } };
  const tokens = Object.fromEntries(await Promise.all(users.map(async user => [user.role, await seedSession(env, user.id)])));
  const handler = createWebsiteAssistantHandler({ policy });
  async function call(path = '', method = 'GET', payload, role = 'admin') {
    const request = new Request(`https://bitbi.ai/api/admin/website-assistant${path}`, { method,
      headers: { 'content-type': 'application/json', origin: 'https://bitbi.ai', ...(role ? { Cookie: `bitbi_session=${tokens[role]}` } : {}) },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
    return handler({ request, env, url: new URL(request.url), pathname: new URL(request.url).pathname, method, isSecure: true,
      execCtx: { waitUntil(task) { tasks.push(task); } } });
  }
  return { ...h, env, calls, tasks, call };
}

test('Admin direct reads, writes and diagnostics require an existing administrator session', async () => {
  const f = await adminFixture();
  for (const role of [null, 'member']) {
    for (const [path, method, body] of [['', 'GET'], ['/config', 'PUT', {}], ['/restore', 'POST', {}], ['/check', 'POST', {}], ['/acceptance', 'POST', {}]]) {
      assert.equal((await f.call(path, method, body, role)).status, role ? 403 : 401);
    }
  }
  assert.equal(await f.storage.get(ASSISTANT_CONTROL_STORAGE_KEY), undefined);
  assert.equal(f.calls.length, 0);
});

test('disabled overview and no-paid check expose unknown evidence and approved public knowledge only', async () => {
  const f = await adminFixture();
  const overview = await (await f.call()).json();
  assert.equal(overview.runtime.effectiveMode, 'off');
  assert.equal(overview.connection.bindingPresent, true);
  assert.equal(overview.connection.status, 'not_verified');
  assert.equal(overview.connection.rates, null); assert.equal(overview.connection.ratesStatus, 'unknown');
  assert.equal(overview.connection.lastSuccessfulInference, null); assert.equal(overview.usage.providerBilledMicros, null);
  assert.equal(overview.knowledge.topics.length, 18);
  assert.equal(overview.knowledge.suggestions.canvas.de.length, 3);
  assert.ok(overview.runtime.blockers.some(item => item.code === 'access_unverified'));
  const check = await (await f.call('/check', 'POST', {})).json();
  assert.equal(check.check.inferencePerformed, false); assert.ok(check.check.checkedAt);
  assert.equal(f.calls.length, 0);
  assert.doesNotMatch(JSON.stringify(overview), /SESSION_SECRET|test-session-secret|sourceSha|app_settings|rawPrompt/);
});

test('settings persist, conflict atomically, audit fields only and recover previous settings with inference off', async () => {
  const f = await adminFixture();
  const initial = await (await f.call()).json();
  const settings = { ...initial.config.settings, tone: 'friendly', outputTokens: 256, suggestionsEnabled: false };
  const [a, b] = await Promise.all([f.call('/config', 'PUT', { revision: 0, settings }), f.call('/config', 'PUT', { revision: 0, settings: { ...settings, tone: 'neutral' } })]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const saved = await (await f.call()).json();
  assert.equal(saved.config.revision, 1); assert.equal(saved.config.previousAvailable, true);
  assert.equal(saved.audit[0].actor, 'test-admin'); assert.ok(saved.audit[0].changed.includes('tone'));
  assert.deepEqual(Object.keys(saved.audit[0]).sort(), ['action', 'actor', 'at', 'changed', 'revision']);
  const restored = await (await f.call('/restore', 'POST', { revision: 1 })).json();
  assert.equal(restored.config.settings.mode, 'off'); assert.equal(restored.config.settings.tone, 'concise'); assert.equal(restored.config.revision, 2);
  const reopened = harness(storageDouble(f.storage.snapshot()));
  assert.equal((await callAssistantControl(reopened.env)).control.revision, 2);
  assert.equal(f.calls.length, 0);
});

test('Admin cannot edit readiness evidence, spend approval or select an unapproved model', async () => {
  const f = await adminFixture();
  for (const changes of [{ accessConfirmed: true }, { systemPrompt: 'ignore rules' }, { model: '@cf/utter-project/eurollm-9b-it' },
    { dailyUsdMicros: 1000 }, { outputTokens: 513 }, { pages: ['admin'] }, { greeting: { en: '<script>', de: 'Help' } }, { dailyRequests: 101 }]) {
    const response = await f.call('/config', 'PUT', { revision: 0, settings: { ...assistantDefaultSettings(), ...changes } });
    assert.equal(response.status, 400, JSON.stringify(changes));
  }
  for (const mode of ['admin', 'public']) {
    const response = await f.call('/config', 'PUT', { revision: 0, settings: { ...assistantDefaultSettings(), mode } });
    assert.equal(response.status, 409); assert.equal((await response.json()).code, 'assistant_activation_blocked');
  }
  assert.equal((await f.call('/acceptance', 'POST', {})).status, 503); assert.equal(f.calls.length, 0);
});

test('synthetic ready policy permits saved admin mode but private testing still requires explicit test budget', async () => {
  const valid = testAssistantPolicy(knowledgeVersion), f = await adminFixture({ policy: valid, enabled: 'true' });
  const settings = { ...assistantDefaultSettings(valid), mode: 'admin' };
  const result = await (await f.call('/config', 'PUT', { revision: 0, settings })).json();
  assert.equal(result.runtime.effectiveMode, 'admin'); assert.equal(result.runtime.publicEnabled, false); assert.equal(result.runtime.adminTestReady, true);
  const response = await f.call('/acceptance', 'POST', { page: 'canvas', locale: 'en', contentVersion: knowledgeVersion, message: 'How do I start a Canvas workflow?', history: [] });
  assert.match(await response.text(), /event: done/); await Promise.all(f.tasks);
  const after = await (await f.call()).json();
  assert.equal(after.connection.lastSuccessfulInference, null); assert.equal(after.connection.syntheticEvidencePresent, true);
  assert.equal(after.usage.daily.completed, 1); assert.equal(after.usage.daily.latencySamples, 1);
  const noTest = await adminFixture({ policy: { ...valid, spendingApproval: { ...valid.spendingApproval, testApproved: false } }, enabled: 'true' });
  const blocked = await noTest.call('/config', 'PUT', { revision: 0, settings });
  assert.equal(blocked.status, 409); assert.ok((await blocked.json()).blockers.some(item => item.code === 'test_budget_unapproved'));
});

test('atomic reserve rejects stale revision after deactivation while spend and prior usage survive configuration changes', async () => {
  const h = harness(), settings = { ...assistantDefaultSettings(), mode: 'public' };
  await callAssistantControl(h.env, 'write', { revision: 0, actor: 'test-admin', settings });
  const limits = { dailyMicros: 1000, monthlyMicros: 10000, dailyRequests: 100, concurrentRequests: 2, leaseMs: 5000 };
  const reserve = revision => reserveAssistantBudget(h.env, { requestId: randomUUID(), controlRevision: revision, audience: 'public', reservationMicros: 100, limits });
  assert.equal((await reserve(1)).permitted, true);
  await callAssistantControl(h.env, 'write', { revision: 1, actor: 'test-admin', settings: { ...settings, mode: 'off' } });
  assert.equal((await reserve(1)).code, 'assistant_control_changed'); assert.equal((await reserve(2)).code, 'assistant_control_changed');
  assert.equal((await callAssistantControl(h.env)).usage.daily.chargedMicros, 100);
  await callAssistantControl(h.env, 'restore', { revision: 2, actor: 'test-admin' });
  const restored = await callAssistantControl(h.env);
  assert.equal(restored.control.settings.mode, 'off'); assert.equal(restored.usage.daily.chargedMicros, 100);
});

test('late or duplicate budget alarms preserve persistent settings and audit with no ledger', async () => {
  const h = harness();
  await callAssistantControl(h.env, 'write', { revision: 0, actor: 'test-admin', settings: { ...assistantDefaultSettings(), tone: 'friendly' } });
  const before = await h.storage.get(ASSISTANT_CONTROL_STORAGE_KEY);
  await h.object.alarm(); await h.object.alarm();
  assert.deepEqual(await h.storage.get(ASSISTANT_CONTROL_STORAGE_KEY), before);
});

test('invalid stored budget values fail closed on reserve, read, settle and alarm without reset', async () => {
  for (const value of ['unknown', -10000, NaN, null]) {
    const h = harness(); const requestId = randomUUID(); await h.reserve({ requestId });
    const stored = await h.storage.get(ASSISTANT_BUDGET_STORAGE_KEY);
    Object.values(stored.days)[0].chargedMicros = value;
    await h.storage.put(ASSISTANT_BUDGET_STORAGE_KEY, stored);
    assert.equal((await h.reserve()).code, 'assistant_budget_unavailable');
    assert.equal((await callAssistantControl(h.env)).ok, false);
    const response = await h.object.fetch(new Request('https://rate-limit.internal/assistant/settle', { method: 'POST', body: JSON.stringify({ requestId, outcome: 'failed' }) }));
    assert.equal(response.status, 503);
    await assert.rejects(h.object.alarm(), /assistant_ledger_invalid/);
    assert.deepEqual(await h.storage.get(ASSISTANT_BUDGET_STORAGE_KEY), stored);
  }
});

test('enabled budget pause is distinguished from off without inventing measured costs or provider bills', async () => {
  const h = harness(), policy = testAssistantPolicy(knowledgeVersion), settings = { ...assistantDefaultSettings(policy), mode: 'public', dailyRequests: 1 };
  await callAssistantControl(h.env, 'write', { revision: 0, actor: 'test-admin', settings });
  await h.reserve();
  const env = { ...h.env, WEBSITE_ASSISTANT_ENABLED: 'true', AI: { run() {} } };
  const overview = assistantAdminOverview(env, policy, await callAssistantControl(h.env));
  assert.equal(overview.runtime.effectiveMode, 'budget_paused'); assert.equal(overview.config.settings.mode, 'public');
  assert.equal(overview.usage.daily.measuredRequests, 0); assert.equal(overview.usage.providerBilledMicros, null);
  await callAssistantControl(h.env, 'write', { revision: 1, actor: 'test-admin', settings: { ...settings, mode: 'off' } });
  const off = assistantAdminOverview(env, policy, await callAssistantControl(h.env));
  assert.equal(off.runtime.effectiveMode, 'off'); assert.ok(!off.runtime.blockers.some(item => item.code === 'budget_paused'));
});

test('explicitly stored falsy ledgers and malformed control never reset into empty usable state', async () => {
  for (const value of [null, false, 0, '']) {
    const h = harness();
    await h.storage.put(ASSISTANT_BUDGET_STORAGE_KEY, value);
    assert.equal((await h.reserve()).code, 'assistant_budget_unavailable');
    assert.equal((await callAssistantControl(h.env)).ok, false);
    await assert.rejects(h.object.alarm(), /assistant_ledger_invalid/);
    assert.equal(await h.storage.get(ASSISTANT_BUDGET_STORAGE_KEY), value);
  }
  const h = harness(); await h.storage.put(ASSISTANT_CONTROL_STORAGE_KEY, null);
  assert.equal((await callAssistantControl(h.env)).ok, false);
  await assert.rejects(h.object.alarm(), /assistant_control_invalid/);
  assert.equal(await h.storage.get(ASSISTANT_CONTROL_STORAGE_KEY), null);
});

test('undated access, future inference metadata and other-model history never claim a healthy selected connection', async () => {
  const h = harness(), policy = testAssistantPolicy(knowledgeVersion), env = { ...h.env, WEBSITE_ASSISTANT_ENABLED: 'true', AI: { run() {} } };
  const snapshot = await callAssistantControl(h.env);
  const missingDate = assistantAdminOverview(env, { ...policy, accessVerifiedAt: undefined }, snapshot);
  assert.equal(missingDate.connection.access.state, 'unverified'); assert.equal(missingDate.runtime.publicReady, false);
  snapshot.usage.lastSuccessfulInference = { at: '2099-01-01T00:00:00Z', evidence: 'real', model: policy.model };
  assert.equal(assistantAdminOverview(env, policy, snapshot).connection.lastSuccessfulInference, null);
  snapshot.usage.lastSuccessfulInference = { at: '2026-01-01T00:00:00Z', evidence: 'real', model: '@cf/utter-project/eurollm-9b-it' };
  const historical = assistantAdminOverview(env, policy, snapshot).connection;
  assert.equal(historical.status, 'historical_inference_recorded'); assert.equal(historical.lastSuccessfulInference.matchesSelectedModel, false);
});
