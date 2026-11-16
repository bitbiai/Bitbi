import assert from 'node:assert/strict';
import { expectNativeRejection } from './helpers/q2-runtime/assertions.mjs';

// Independent acceptance identities: updating a product version requires reviewing
// the supplied disclosure and this oracle, not deriving the expected value from it.
const VERSION = 'minimax-consent-v3-2026-11-16';
const MEMBER = 'q2-workerd-member', OTHER = 'q2-workerd-admin';
const ROUTE = '/api/account/minimax-consent';

export async function runMinimaxConsentTests(f) {
  const now = new Date().toISOString();
  const user = id => f.sql('INSERT INTO users(id,email,password_hash,created_at,status,role,email_verified_at,verification_method) VALUES(?,?,?,?,?,?,?,?)',
    id, `${id}@example.invalid`, 'synthetic', now, 'active', 'user', now, 'email').run();
  for (const migration of f.migrations) {
    if (migration.path === '0120_add_minimax_consent.sql') {
      await user(MEMBER); await user(OTHER);
      const before = await f.rows('SELECT * FROM users ORDER BY id');
      await f.test('minimax_0120_populated_transition_is_atomic_and_does_not_infer_consent', async () => {
        await assert.rejects(f.db.batch([...migration.statements.map(sql => f.db.prepare(sql)),
          f.db.prepare('INSERT INTO minimax_consent_current(user_id) VALUES(NULL)')]));
        assert.equal(await f.scalar("SELECT COUNT(*) AS value FROM sqlite_master WHERE name='minimax_consent_current'"), 0);
        assert.deepEqual(await f.rows('SELECT * FROM users ORDER BY id'), before);
        await f.db.batch(migration.statements.map(sql => f.db.prepare(sql)));
        assert.deepEqual(await f.rows('SELECT * FROM users ORDER BY id'), before);
        for (const table of ['minimax_consent_current', 'minimax_consent_events', 'minimax_consent_retention']) {
          assert.equal(await f.scalar(`SELECT COUNT(*) AS value FROM ${table}`), 0);
        }
        assert.deepEqual(await f.rows('PRAGMA foreign_key_check'), []);
      });
    } else await f.db.batch(migration.statements.map(sql => f.db.prepare(sql)));
  }
  let sequence = 0;
  const call = (cookie, method, path, body, origin = 'https://bitbi.ai', withKey = true) => f.mf.dispatchFetch('https://bitbi.ai' + path, {
    method, headers: { Cookie: cookie || '', Origin: origin, 'Content-Type': 'application/json',
      'CF-Connecting-IP': `192.0.2.${++sequence}`, 'Accept-Language': 'de-DE', 'Idempotency-Key': withKey ? `minimax-native-${sequence}` : '' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const cookie = async id => (await (await f.control('/session', { userId: id })).json()).cookie;
  const member = await cookie(MEMBER), other = await cookie(OTHER);
  const status = async identity => {
    const response = await call(identity, 'GET', ROUTE);
    assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /no-store/);
    return (await response.json()).consent;
  };
  const grant = (body = {}, identity = member) => call(identity, 'POST', ROUTE, { confirmed: true, source: 'first_use', locale: 'de', displayedTextVersion: VERSION, ...body });
  const revoke = identity => call(identity || member, 'POST', ROUTE + '/revoke', {});
  const eventCount = id => f.scalar('SELECT COUNT(*) AS value FROM minimax_consent_events WHERE user_id=?', id);
  const state = id => f.sql('SELECT * FROM minimax_consent_current WHERE user_id=?', id).first();
  const balances = () => Promise.all(['member_credit_ledger', 'member_credit_buckets', 'member_usage_events', 'member_ai_usage_attempts_v2', 'member_generation_jobs']
    .map(table => f.rows(`SELECT * FROM ${table} ORDER BY rowid`)));
  const generate = (model, identity = member, withKey = true) => call(identity, 'POST', model?.includes('h3') || model?.includes('grok-imagine-video') ? '/api/ai/generate-video' : '/api/ai/generate-music',
    model?.includes('h3') ? { model, prompt: 'Synthetic native consent motion', duration: 5, resolution: '768P' }
      : model?.includes('grok-imagine-video') ? { model, prompt: 'Synthetic native consent motion', duration: 5, resolution: '720p' }
        : model === 'elevenlabs/music-v2' ? { model, prompt: 'Synthetic instrumental music', musicLengthMs: 10000, forceInstrumental: true }
          : { prompt: 'Synthetic instrumental music', instrumental: true }, 'https://bitbi.ai', withKey);

  await f.test('minimax_account_API_requires_session_same_origin_and_explicit_boolean_grant', async () => {
    for (const [method, path, body] of [['GET', ROUTE], ['POST', ROUTE, { confirmed: true, source: 'first_use' }], ['POST', ROUTE + '/revoke', {}]]) {
      assert.equal((await call('', method, path, body)).status, 401);
    }
    for (const path of [ROUTE, ROUTE + '/revoke']) assert.equal((await call(member, 'POST', path, { confirmed: true, source: 'settings' }, 'https://untrusted.invalid')).status, 403);
    for (const body of [{}, { confirmed: false, source: 'first_use' }, { confirmed: 'true', source: 'settings' }, { confirmed: true, source: 'register' }]) {
      assert.equal((await call(member, 'POST', ROUTE, body)).status, 400);
    }
    for (const displayedTextVersion of [undefined, 'minimax-consent-older-material-version']) {
      const stale = await call(member, 'POST', ROUTE, { confirmed: true, source: 'first_use', displayedTextVersion });
      assert.equal(stale.status, 409);
    }
    assert.equal((await status(member)).granted, false); assert.equal(await eventCount(MEMBER), 0);
  });
  await f.test('minimax_H3_H3Lite_and_default_music_deny_before_native_credits_or_provider', async () => {
    const before = await balances(), counters = { ...f.counters };
    for (const model of ['minimax/h3', 'minimax/h3-lite', undefined]) {
      const response = await generate(model);
      const payload = await response.json();
      assert.equal(response.status, 403, `${model || 'default music'}: ${payload.code}`); assert.equal(payload.code, 'consent_required');
    }
    assert.deepEqual(await balances(), before);
    assert.equal(f.counters.outboundDenied, counters.outboundDenied); assert.equal(f.counters.serviceDenied, counters.serviceDenied);
  });
  await f.test('minimax_grant_is_owner_scoped_server_versioned_and_visible_in_me', async () => {
    const response = await grant({ userId: OTHER, textVersion: 'client-forged-version' });
    assert.equal(response.status, 200);
    const consent = (await response.json()).consent;
    assert.equal(consent.granted, true); assert.equal(consent.textVersion, VERSION); assert.equal(consent.locale, 'de'); assert.equal(consent.source, 'first_use');
    assert.match(consent.grantedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const events = await f.rows('SELECT * FROM minimax_consent_events WHERE user_id=?', MEMBER);
    assert.equal(events.length, 1);
    const { id, ...proof } = events[0]; assert.ok(id);
    assert.deepEqual(proof, { user_id: MEMBER, action: 'grant', text_version: VERSION, locale: 'de', source: 'first_use', created_at: consent.grantedAt });
    assert.equal(await eventCount(OTHER), 0); assert.equal((await status(other)).granted, false);
    const me = await call(member, 'GET', '/api/me'); assert.equal(me.status, 200);
    assert.deepEqual((await me.json()).user.minimaxConsent, consent);
    assert.equal(await f.scalar('SELECT COUNT(*) AS value FROM minimax_consent_retention WHERE event_id=?', id), 0);
  });
  await f.test('minimax_valid_consent_and_unrelated_models_reach_unchanged_idempotency_policy', async () => {
    const before = await balances();
    for (const [model, identity] of [['minimax/h3', member], ['minimax/h3-lite', member], [undefined, member], ['elevenlabs/music-v2', other], ['xai/grok-imagine-video', other]]) {
      const response = await generate(model, identity, false), payload = await response.json();
      assert.equal(response.status, 428, `${model || 'default music'}: ${payload.code}`);
      assert.equal(payload.code, 'idempotency_key_required', model);
    }
    assert.deepEqual(await balances(), before); assert.equal(f.counters.outboundDenied, 0); assert.equal(f.counters.serviceDenied, 0);
  });
  await f.test('minimax_current_and_audit_updates_rollback_together_on_native_fault', async () => {
    const before = await state(MEMBER), count = await eventCount(MEMBER);
    await f.sql(`CREATE TRIGGER minimax_test_current_fault BEFORE UPDATE ON minimax_consent_current WHEN NEW.user_id='${MEMBER}' BEGIN SELECT RAISE(ABORT,'synthetic minimax current failure'); END`).run();
    try {
      assert.equal((await grant({ source: 'settings', locale: 'en' })).status, 500);
      assert.deepEqual(await state(MEMBER), before); assert.equal(await eventCount(MEMBER), count);
      assert.equal((await revoke()).status, 500);
      assert.deepEqual(await state(MEMBER), before); assert.equal(await eventCount(MEMBER), count);
      assert.equal(await f.scalar('SELECT COUNT(*) AS value FROM minimax_consent_retention'), 0);
    } finally { await f.sql('DROP TRIGGER minimax_test_current_fault').run(); }
  });
  await f.test('minimax_immutable_proof_rejects_update_and_premature_delete', async () => {
    const before = await f.rows('SELECT * FROM minimax_consent_events WHERE user_id=?', MEMBER);
    await expectNativeRejection(() => f.sql("UPDATE minimax_consent_events SET locale='en' WHERE user_id=?", MEMBER).run(), 'minimax_consent_event_immutable');
    await expectNativeRejection(() => f.sql('DELETE FROM minimax_consent_events WHERE user_id=?', MEMBER).run(), 'minimax_consent_proof_retained');
    assert.deepEqual(await f.rows('SELECT * FROM minimax_consent_events WHERE user_id=?', MEMBER), before);
  });
  await f.test('minimax_age_alone_does_not_expire_but_material_text_version_change_does', async () => {
    await f.sql("UPDATE minimax_consent_current SET granted_at='2000-01-01T00:00:00.000Z' WHERE user_id=?", MEMBER).run();
    assert.equal((await status(member)).granted, true);
    await f.sql("UPDATE minimax_consent_current SET text_version='minimax-consent-older-material-version' WHERE user_id=?", MEMBER).run();
    assert.equal((await status(member)).granted, false);
    const response = await generate('minimax/music-2.6'); assert.equal(response.status, 403); assert.equal((await response.json()).code, 'consent_required');
    assert.equal((await grant({ source: 'settings', locale: 'en' })).status, 200);
    assert.equal((await status(member)).granted, true);
  });
  await f.test('minimax_one_step_revoke_closes_proof_cycle_regrant_starts_new_active_cycle', async () => {
    const before = await eventCount(MEMBER);
    const response = await revoke(); assert.equal(response.status, 200);
    const consent = (await response.json()).consent; assert.equal(consent.granted, false); assert.equal(consent.source, 'settings');
    assert.equal(await eventCount(MEMBER), before + 1);
    const deadline = `${Number(consent.revokedAt.slice(0, 4)) + 4}-01-01T00:00:00.000Z`;
    const retention = await f.rows('SELECT r.* FROM minimax_consent_retention r JOIN minimax_consent_events e ON e.id=r.event_id WHERE e.user_id=?', MEMBER);
    assert.equal(retention.length, before + 1); assert.ok(retention.every(row => row.retain_until === deadline));
    assert.equal((await revoke()).status, 200); assert.equal(await eventCount(MEMBER), before + 1);
    const denied = await generate('minimax/h3-lite'); assert.equal(denied.status, 403); assert.equal((await denied.json()).code, 'consent_required');
    assert.equal((await grant({ source: 'settings', locale: 'en' })).status, 200);
    const active = await f.sql("SELECT * FROM minimax_consent_events WHERE user_id=? AND action='grant' ORDER BY rowid DESC LIMIT 1", MEMBER).first();
    assert.equal(await f.scalar('SELECT COUNT(*) AS value FROM minimax_consent_retention WHERE event_id=?', active.id), 0);
    assert.deepEqual(await f.rows('SELECT r.* FROM minimax_consent_retention r JOIN minimax_consent_events e ON e.id=r.event_id WHERE e.user_id=?', MEMBER), retention);
  });
  await f.test('minimax_registration_optional_strict_true_atomic_and_anti_enumeration_safe', async () => {
    const outboundBefore = f.counters.outboundDenied;
    const password = 'Synthetic native registration 123!';
    for (const displayedTextVersion of [undefined, 'minimax-consent-older-material-version']) {
      const stale = await call('', 'POST', '/api/register', { email: 'native-consent-stale@example.invalid', password, minimaxConsent: true, displayedTextVersion });
      assert.equal(stale.status, 409);
      assert.equal(await f.scalar("SELECT COUNT(*) AS value FROM users WHERE email='native-consent-stale@example.invalid'"), 0);
    }
    let generic;
    for (const [suffix, flag, expected] of [['omitted', undefined, false], ['false', false, false], ['string', 'true', false], ['true', true, true]]) {
      const email = `native-consent-${suffix}@example.invalid`;
      const response = await call('', 'POST', '/api/register', { email, password, ...(flag === undefined ? {} : { minimaxConsent: flag }), locale: 'de', displayedTextVersion: VERSION });
      assert.equal(response.status, 201); const payload = await response.json(); generic ||= payload; assert.deepEqual(payload, generic);
      assert.equal(response.headers.has('set-cookie'), false);
      const registered = await f.sql('SELECT * FROM users WHERE email=?', email).first(); assert.ok(registered);
      assert.equal(await eventCount(registered.id), expected ? 1 : 0);
      if (expected) {
        const proof = await f.sql('SELECT * FROM minimax_consent_events WHERE user_id=?', registered.id).first();
        assert.equal(proof.source, 'register'); assert.equal(proof.locale, 'de'); assert.equal(proof.text_version, VERSION); assert.equal(proof.created_at, registered.created_at);
        assert.equal((await state(registered.id)).granted_at, proof.created_at);
      } else assert.equal(await state(registered.id), null);
    }
    const existing = await f.sql("SELECT id FROM users WHERE email='native-consent-omitted@example.invalid'").first();
    const duplicate = await call('', 'POST', '/api/register', { email: 'native-consent-omitted@example.invalid', password, minimaxConsent: true, displayedTextVersion: VERSION });
    assert.equal(duplicate.status, 201); assert.deepEqual(await duplicate.json(), generic); assert.equal(await eventCount(existing.id), 0);
    await f.sql("CREATE TRIGGER minimax_test_register_fault BEFORE INSERT ON minimax_consent_current BEGIN SELECT RAISE(ABORT,'synthetic minimax registration failure'); END").run();
    try {
      const failed = await call('', 'POST', '/api/register', { email: 'native-consent-failed@example.invalid', password, minimaxConsent: true, displayedTextVersion: VERSION });
      assert.equal(failed.status, 500);
      assert.equal(await f.scalar("SELECT COUNT(*) AS value FROM users WHERE email='native-consent-failed@example.invalid'"), 0);
      assert.equal(await f.scalar('SELECT COUNT(*) AS value FROM minimax_consent_events e LEFT JOIN users u ON e.user_id=u.id WHERE u.id IS NULL'), 0);
    } finally { await f.sql('DROP TRIGGER minimax_test_register_fault').run(); }
    assert.equal(f.counters.outboundDenied - outboundBefore, 4, 'Each new registration attempts its verification email only through the denied external boundary');
    assert.equal(f.counters.serviceDenied, 0);
  });
  await f.test('minimax_retention_deadline_enforced_while_closed_historical_cycle_is_purgeable', async () => {
    const id = 'minimax-expired-proof', retired = 'minimax-expired-current'; await user(id); await user(retired);
    await f.db.batch([
      f.sql("INSERT INTO minimax_consent_events VALUES(?,?,'grant',?,'en','first_use','2019-01-01T00:00:00.000Z')", 'expired-grant', id, VERSION),
      f.sql("INSERT INTO minimax_consent_events VALUES(?,?,'revoke',?,'en','settings','2020-06-01T00:00:00.000Z')", 'expired-revoke', id, VERSION),
      f.sql("INSERT INTO minimax_consent_events VALUES(?,?,'grant',?,'en','settings',?)", 'active-new-grant', id, VERSION, now),
      f.sql("INSERT INTO minimax_consent_current VALUES(?,?,NULL,?,'en','settings',?)", id, now, VERSION, now),
      f.sql("INSERT INTO minimax_consent_events VALUES(?,?,'grant',?,'en','first_use','2019-01-01T00:00:00.000Z')", 'retired-grant', retired, VERSION),
      f.sql("INSERT INTO minimax_consent_events VALUES(?,?,'revoke',?,'en','settings','2020-06-01T00:00:00.000Z')", 'retired-revoke', retired, VERSION),
      f.sql("INSERT INTO minimax_consent_current VALUES(?,'2019-01-01T00:00:00.000Z','2020-06-01T00:00:00.000Z',?,'en','settings','2020-06-01T00:00:00.000Z')", retired, VERSION),
    ]);
    assert.equal((await f.sql("SELECT retain_until FROM minimax_consent_retention WHERE event_id='expired-grant'").first()).retain_until, '2024-01-01T00:00:00.000Z');
    await expectNativeRejection(() => f.sql("DELETE FROM minimax_consent_events WHERE id='active-new-grant'").run(), 'minimax_consent_proof_retained');
    assert.ok(f.config.triggers.crons.includes('0 3 * * *'));
    const scheduled = await f.mf.dispatchFetch('http://127.0.0.1/cdn-cgi/local/scheduled?cron=0%203%20*%20*%20*&format=json');
    assert.equal(scheduled.status, 200); assert.equal((await scheduled.json()).outcome, 'ok');
    assert.equal(await eventCount(id), 1); assert.equal(await f.scalar("SELECT COUNT(*) AS value FROM minimax_consent_retention WHERE event_id IN ('expired-grant','expired-revoke')"), 0);
    assert.equal(await eventCount(retired), 0); assert.equal(await state(retired), null, 'Expired closed status is removed with its expired proof');
    assert.equal((await state(id)).revoked_at, null, 'A new active consent survives cleanup of its old closed cycle');
    assert.equal((await state(id)).granted_at, now);
    await expectNativeRejection(() => f.sql('DELETE FROM minimax_consent_events WHERE user_id=?', MEMBER).run(), 'minimax_consent_proof_retained');
  });
  await f.test('minimax_account_deletion_and_deleted_status_retain_immutable_proof_and_revoke_access', async () => {
    for (const mode of ['delete', 'status']) {
      const id = `minimax-account-${mode}`; await user(id);
      await f.db.batch([
        f.sql("INSERT INTO minimax_consent_events VALUES(?,?,'grant',?,'en','settings',?)", id, id, VERSION, now),
        f.sql("INSERT INTO minimax_consent_current VALUES(?,?,NULL,?,'en','settings',?)", id, now, VERSION, now),
      ]);
      if (mode === 'delete') await f.sql('DELETE FROM users WHERE id=?', id).run();
      else await f.sql("UPDATE users SET status='deleted' WHERE id=?", id).run();
      assert.equal(await eventCount(id), 2);
      const events = await f.rows('SELECT * FROM minimax_consent_events WHERE user_id=? ORDER BY rowid', id);
      assert.deepEqual(events.map(event => event.action), ['grant', 'revoke']);
      const current = await state(id); if (mode === 'delete') assert.equal(current, null); else assert.ok(current.revoked_at);
      const retention = await f.rows('SELECT r.* FROM minimax_consent_retention r JOIN minimax_consent_events e ON e.id=r.event_id WHERE e.user_id=?', id);
      assert.equal(retention.length, 2); assert.ok(retention.every(row => row.retain_until === `${Number(events[1].created_at.slice(0, 4)) + 4}-01-01T00:00:00.000Z`));
      await expectNativeRejection(() => f.sql('DELETE FROM minimax_consent_events WHERE user_id=?', id).run(), 'minimax_consent_proof_retained');
    }
    assert.deepEqual(await f.rows('PRAGMA foreign_key_check'), []);
    assert.equal(f.counters.serviceDenied, 0);
    f.metrics.push({ deniedRegistrationEmailRequests: 4, finalOutboundDenied: f.counters.outboundDenied, providerServiceCalls: f.counters.serviceDenied });
  });
}
