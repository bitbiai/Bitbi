import assert from 'node:assert/strict';
import { knowledgeVersion } from '../workers/shared/website-assistant-knowledge.mjs';

export async function runWebsiteAssistantTests(f) {
  const control = async (path, name) => {
    const response = await f.control(path, { name });
    assert.equal(response.status, 200, `Native fixture ${name} must execute`);
    return response.json();
  };
  await f.test('website_assistant_actual_router_disabled_and_origin_guard', async () => {
    const config = await f.mf.dispatchFetch('https://bitbi.ai/api/public/assistant/config?page=canvas&locale=de');
    assert.equal(config.status, 200);
    assert.deepEqual(await config.json(), { enabled: false });
    const post = origin => f.mf.dispatchFetch('https://bitbi.ai/api/public/assistant/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: '{}' });
    assert.equal((await post('https://attacker.invalid')).status, 403);
    assert.equal((await post()).status, 403);
    const disabled = await post('https://bitbi.ai');
    assert.equal(disabled.status, 503);
    assert.equal((await disabled.json()).code, 'assistant_unavailable');
    const nativeControl = await f.mf.getWorker('q2-control');
    assert.equal((await nativeControl.fetch('https://q2-control.invalid/assistant-route', { method: 'POST', body: '{"name":"en"}' })).status, 403);
  });
  await f.test('website_assistant_native_durable_budget_parallel_admission_is_atomic', async () => {
    assert.deepEqual(await control('/assistant-budget', 'atomic'), { admitted: 10, denied: 30 });
  });
  await f.test('website_assistant_native_settlement_refunds_only_measured_usage_once', async () => {
    const r = await control('/assistant-budget', 'settlement');
    assert.equal(r.first.permitted, true);
    assert.equal(r.settled.measured, true);
    assert.equal(r.settled.chargedMicros, 25);
    assert.equal(r.again.code, 'assistant_budget_already_settled');
    assert.equal(r.duplicate.code, 'assistant_duplicate_request');
    assert.equal(r.remainder.permitted, true);
    assert.equal(r.exceeded.code, 'assistant_daily_budget');
  });
  for (const name of ['cancelled', 'missing-usage']) await f.test(`website_assistant_native_${name}_retains_cost_and_concurrency`, async () => {
    const r = await control('/assistant-budget', name);
    assert.equal(r.first.permitted, true);
    assert.equal(r.settled.measured, false);
    assert.equal(r.settled.chargedMicros, 100);
    assert.equal(r.next.code, 'assistant_concurrency');
  });
  await f.test('website_assistant_native_daily_request_limit_remains_after_settlement', async () => {
    const r = await control('/assistant-budget', 'request-cap');
    assert.equal(r.first.permitted, true);
    assert.equal(r.next.code, 'assistant_daily_requests');
  });
  await f.test('website_assistant_native_page_config_returns_versioned_supported_questions', async () => {
    const r = await control('/assistant-route', 'config');
    assert.equal(r.status, 200);
    const data = JSON.parse(r.output);
    assert.equal(data.enabled, true);
    assert.equal(data.contentVersion, knowledgeVersion);
    assert.equal(data.suggestions.length, 3);
    assert.equal(r.providerCalls, 0);
    assert.equal(r.privateReads, 0);
  });
  for (const language of ['en', 'de']) await f.test(`website_assistant_native_${language}_grounded_stream_and_measured_usage`, async () => {
    const r = await control('/assistant-route', language);
    assert.equal(r.status, 200);
    assert.match(r.contentType, /text\/event-stream/);
    assert.match(r.output, /event: meta/);
    assert.match(r.output, /canvas-start/);
    assert.match(r.output, language === 'de' ? /https:\/\/bitbi.ai\/de\/canvas\// : /https:\/\/bitbi.ai\/canvas\//);
    assert.match(r.output, /event: delta/);
    assert.match(r.output, /event: done/);
    assert.match(r.output, /"prompt_tokens":120,"completion_tokens":20/);
    assert.equal(r.providerCalls, 1);
    assert.equal(r.privateReads, 0);
  });
  await f.test('website_assistant_native_unknown_has_no_inference_or_false_grounding', async () => {
    const r = await control('/assistant-route', 'unknown');
    assert.equal(r.status, 200);
    assert.match(r.output, /"grounded":false/);
    assert.match(r.output, /"sources":\[\]/);
    assert.equal(r.providerCalls, 0);
    assert.equal(r.privateReads, 0);
  });
  for (const [name, status, code] of [['stale', 409, 'context_changed'], ['private-context', 400, 'request_invalid']]) await f.test(`website_assistant_native_${name}_blocked_before_provider`, async () => {
    const r = await control('/assistant-route', name);
    assert.equal(r.status, status);
    assert.equal(JSON.parse(r.output).code, code);
    assert.equal(r.providerCalls, 0);
  });
  await f.test('website_assistant_native_provider_failure_is_sanitized_without_retry', async () => {
    const r = await control('/assistant-route', 'error');
    assert.match(r.output, /event: error/);
    assert.match(r.output, /provider_error/);
    assert.doesNotMatch(r.output, /test-private-upstream-diagnostic/);
    assert.doesNotMatch(r.output, /event: done/);
    assert.equal(r.providerCalls, 1);
  });
  await f.test('website_assistant_native_reader_cancellation_does_not_replay_inference', async () => {
    const r = await control('/assistant-route', 'cancel');
    assert.match(r.output, /event: delta/);
    assert.doesNotMatch(r.output, /event: done/);
    assert.equal(r.providerCalls, 1);
    assert.equal(r.cancelled, 1);
    assert.equal(r.privateReads, 0);
  });
  await f.test('website_assistant_native_no_external_service_or_private_storage_access', async () => {
    assert.equal(f.counters.outboundDenied, 0);
    assert.equal(f.counters.serviceDenied, 0);
    const tables = await f.rows("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'");
    assert.deepEqual(tables, [], 'Public help needs no account database or private media fixtures');
  });
  await f.test('website_assistant_native_control_disable_and_restore_preserve_atomic_spend', async () => {
    const r = await control('/assistant-control', 'lifecycle');
    assert.equal(r.initial.control.settings.mode, 'off');
    assert.equal(r.initial.control.revision, 0);
    assert.equal(r.enabled.control.settings.mode, 'public');
    assert.equal(r.first.permitted, true);
    assert.equal(r.off.control.settings.mode, 'off');
    assert.equal(r.stale.code, 'assistant_control_changed');
    assert.equal(r.denied.code, 'assistant_control_changed');
    assert.equal(r.settled.chargedMicros, 25);
    assert.equal(r.restored.control.settings.mode, 'off', 'Recovery never silently reactivates inference');
    assert.equal(r.writes.filter(result => result.ok).length, 1);
    assert.equal(r.writes.find(result => !result.ok).code, 'assistant_configuration_conflict');
    assert.equal(r.readback.usage.daily.requests, 1);
    assert.equal(r.readback.usage.daily.chargedMicros, 25);
    assert.equal(r.readback.usage.monthly.inputTokens, 10);
    assert.equal(r.readback.usage.lastSuccessfulInference.evidence, 'synthetic', 'The ledger must preserve the synthetic evidence classification');
    assert.equal(r.readback.control.audit[0].actor, 'test-admin');
  });

  // Use the actual production router, native D1 session and MFA guards. Only
  // nonpaid configuration is exercised; the bundled production policy is off.
  for (const migration of f.migrations) await f.db.batch(migration.statements.map(sql => f.db.prepare(sql)));
  const now = new Date().toISOString();
  for (const [id, role] of [['q2-workerd-admin', 'admin'], ['q2-workerd-member', 'user']]) {
    await f.sql('INSERT INTO users(id,email,password_hash,created_at,role,status,email_verified_at,verification_method) VALUES(?,?,?,?,?,?,?,?)',
      id, id + '@example.invalid', 'synthetic', now, role, 'active', now, 'email').run();
  }
  let requestIndex = 30;
  const route = '/api/admin/website-assistant';
  const call = (cookie, method = 'GET', path = route, body, origin = 'https://bitbi.ai') => f.mf.dispatchFetch('https://bitbi.ai' + path, {
    method, headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': `192.0.2.${++requestIndex}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const cookie = async userId => (await (await f.control('/session', { userId })).json()).cookie;
  let admin = await cookie('q2-workerd-admin');
  const member = await cookie('q2-workerd-member');
  await f.test('website_assistant_native_admin_direct_reads_mutations_and_diagnostics_require_admin_mfa', async () => {
    for (const [identity, status] of [['', 401], [member, 403], [admin, 403]]) {
      for (const [method, suffix] of [['GET', ''], ['PUT', '/config'], ['POST', '/restore'], ['POST', '/check'], ['POST', '/acceptance']]) {
        assert.equal((await call(identity, method, route + suffix, method === 'GET' ? undefined : {})).status, status, `${method} ${suffix} authorization`);
      }
    }
  });
  const password = 'Assistant synthetic password 123!';
  await f.control('/password', { userId: 'q2-workerd-admin', password });
  const login = await call('', 'POST', '/api/login', { email: 'q2-workerd-admin@example.invalid', password });
  assert.equal(login.status, 200);
  admin = login.headers.getSetCookie().find(value => value.startsWith('__Host-bitbi_session=')).split(';')[0];
  const setupResponse = await call(admin, 'POST', '/api/admin/mfa/setup', {});
  assert.equal(setupResponse.status, 200);
  const setup = (await setupResponse.json()).setup;
  const code = (await (await f.control('/totp', { secret: setup.secret })).json()).code;
  const enabledMfa = await call(admin, 'POST', '/api/admin/mfa/enable', { code });
  assert.equal(enabledMfa.status, 200);
  admin += '; ' + enabledMfa.headers.getSetCookie().find(value => value.startsWith('__Host-bitbi_admin_mfa=')).split(';')[0];
  const overview = async () => {
    const response = await call(admin);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /no-store/);
    return response.json();
  };
  await f.test('website_assistant_native_admin_settings_survive_reads_with_conflicts_and_safe_recovery', async () => {
    const before = await overview();
    assert.equal(before.config.settings.mode, 'off');
    assert.equal(before.config.revision, 0);
    assert.equal(before.runtime.publicReady, false);
    assert.equal(before.connection.lastSuccessfulInference, null, 'No genuine model success has occurred');
    assert.equal(before.usage.providerBilledMicros, null);
    const settings = { ...before.config.settings, tone: 'friendly', outputTokens: 256 };
    assert.equal((await call(admin, 'PUT', route + '/config', { revision: 0, settings }, 'https://attacker.invalid')).status, 403);
    const results = await Promise.all(['friendly', 'neutral'].map(tone => call(admin, 'PUT', route + '/config', { revision: 0, settings: { ...settings, tone } })));
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    const after = await overview();
    assert.equal(after.config.revision, 1);
    assert.equal(after.config.settings.outputTokens, 256);
    assert.equal(after.audit[0].actor, 'q2-workerd-admin');
    assert.equal(after.audit[0].changed.includes('outputTokens'), true);
    const restore = await call(admin, 'POST', route + '/restore', { revision: 1 });
    assert.equal(restore.status, 200);
    const recovered = await overview();
    assert.equal(recovered.config.revision, 2);
    assert.deepEqual(recovered.config.settings, before.config.settings);
    assert.equal(recovered.usage.daily.requests, 0);
    const checked = await call(admin, 'POST', route + '/check', {});
    assert.equal(checked.status, 200);
    assert.equal((await overview()).config.revision, 2, 'Configuration check must not mutate settings');
  });
  await f.test('website_assistant_native_unverified_activation_and_paid_admin_test_fail_closed', async () => {
    const before = await overview();
    for (const mode of ['admin', 'public']) {
      const result = await call(admin, 'PUT', route + '/config', { revision: before.config.revision, settings: { ...before.config.settings, mode } });
      assert.equal(result.status, 409);
    }
    const inference = await call(admin, 'POST', route + '/acceptance', {
      page: 'canvas', locale: 'en', contentVersion: knowledgeVersion, history: [], message: 'How do I start a Canvas workflow?',
    });
    assert.equal(inference.status, 503);
    const publicConfig = await call('', 'GET', '/api/public/assistant/config?page=canvas&locale=de');
    assert.deepEqual(await publicConfig.json(), { enabled: false });
    assert.equal((await overview()).config.settings.mode, 'off');
    assert.equal((await overview()).usage.daily.requests, 0);
    assert.equal(f.counters.outboundDenied, 0);
    assert.equal(f.counters.serviceDenied, 0);
  });
}
