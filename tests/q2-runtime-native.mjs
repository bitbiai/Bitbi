import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { check, expectNativeRejection } from './helpers/q2-runtime/assertions.mjs';
import { splitSql, sha256 } from './helpers/q2-runtime/sql.mjs';

// Actual Wrangler B fetch/scheduled + native D1/R2/DO; the source-delete control
// uses the real exported helper. No provider, permissive SQL adapter or paid call.
export async function runNativeTests(f) {
  const {mf,db,bucket,sql,rows,scalar,control,counters,webhookSecret,migrations,config,test}=f;
  const fixture=JSON.parse(fs.readFileSync(new URL('./helpers/q2-runtime/historical-fixture.json',import.meta.url),'utf8'));
  const source=fs.readFileSync(new URL('./helpers/q2-runtime/'+fixture.fixture,import.meta.url),'utf8');
  assert.equal(sha256(source),fixture.sha256,'Historical regression fixture must remain frozen');
  const frozen=splitSql(source);
  const now = new Date().toISOString();
  const ADMIN = 'q2-workerd-admin', MEMBER = 'q2-workerd-member', LEGACY_ADMIN = 'q2-workerd-legacy-admin';
  const LIVE_KEY = `users/${MEMBER}/live.webp`, ATOMIC_KEY = `users/${MEMBER}/atomic.webp`, LEGACY_KEY = `users/${MEMBER}/legacy-orphan.webp`;
  async function applyMigration(migration) {
    f.stage = `migration_${path.basename(migration.path).slice(0, 4)}`;
    await db.batch(migration.statements.map(statement => db.prepare(statement)));
  }
  for (const migration of migrations.filter(row => Number(path.basename(row.path).slice(0, 4)) <= 81)) await applyMigration(migration);
  const insertImage = (id, key) => sql(`INSERT INTO ai_images
    (id,user_id,r2_key,prompt,model,size_bytes,created_at,derivatives_status,derivatives_version,thumb_key,medium_key)
    VALUES (?,?,?,'synthetic native runtime fixture','synthetic-model',3,?,'ready',1,?,?)`, id, MEMBER, key, now, key, key).run();
  f.stage = 'seed_populated_pre_0082_0083';
  for (const [id, role] of [[ADMIN,'admin'], [LEGACY_ADMIN,'admin'], [MEMBER,'user']]) {
    await sql(`INSERT INTO users(id,email,password_hash,created_at,role,status,email_verified_at,verification_method)
      VALUES (?,?,'synthetic-unused',?,?,'active',?,'email')`, id, `${id}@example.invalid`, now, role, now).run();
  }
  await sql(`INSERT INTO admin_mfa_credentials(admin_user_id,secret_ciphertext,secret_iv,pending_secret_ciphertext,pending_secret_iv,enabled_at,last_accepted_timestep,created_at,updated_at)
    VALUES (?,'synthetic-opaque-cipher','synthetic-opaque-iv',NULL,NULL,?,12345,?,?)`, LEGACY_ADMIN, now, now, now).run();
  await sql(`INSERT INTO admin_mfa_recovery_codes(id,admin_user_id,code_hash,created_at,used_at)
    VALUES ('q2-legacy-recovery',?,'synthetic-opaque-hash',?,NULL)`, LEGACY_ADMIN, now).run();
  await insertImage('q2-workerd-live-image', LIVE_KEY);
  for (const key of [LIVE_KEY, LEGACY_KEY]) {
    await bucket.put(key, new Uint8Array([1,2,3]));
    await sql("INSERT INTO r2_cleanup_queue(r2_key,status,created_at) VALUES (?,'pending',?)", key, now).run();
  }
  const beforeCredential = await sql('SELECT * FROM admin_mfa_credentials WHERE admin_user_id=?', LEGACY_ADMIN).first();
  const beforeRecovery = await rows('SELECT * FROM admin_mfa_recovery_codes WHERE admin_user_id=?', LEGACY_ADMIN);
  await test('populated_0082_preserves_credentials_recovery_and_adds_nullable_guard', async () => {
    await applyMigration(migrations.find(row => path.basename(row.path).startsWith('0082_')));
    const after = await sql('SELECT * FROM admin_mfa_credentials WHERE admin_user_id=?', LEGACY_ADMIN).first();
    check(after.mutation_token === null, 'Existing credential mutation guard must initialize NULL');
    delete after.mutation_token;
    check(JSON.stringify(after) === JSON.stringify(beforeCredential), '0082 must preserve every old credential field');
    check(JSON.stringify(await rows('SELECT * FROM admin_mfa_recovery_codes WHERE admin_user_id=?', LEGACY_ADMIN)) === JSON.stringify(beforeRecovery), '0082 recovery preservation');
  });
  await test('frozen_original_0083_rejects_atomically_in_native_D1', async () => {
    const before=JSON.stringify(await rows('SELECT * FROM admin_mfa_credentials ORDER BY admin_user_id'));
    await expectNativeRejection(()=>db.batch(frozen.statements.map(statement=>db.prepare(statement))), 'too many terms in compound SELECT');
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM sqlite_schema WHERE name IN ('r2_object_tombstones','r2_cleanup_live_references')"),0);
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM r2_cleanup_queue WHERE status='pending'"),2);
    assert.equal(JSON.stringify(await rows('SELECT * FROM admin_mfa_credentials ORDER BY admin_user_id')),before);
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM ai_images'),1);
    for(const key of [LIVE_KEY,LEGACY_KEY]) check(await bucket.head(key),'Frozen migration rejection preserves native bytes');
  });
  await test('current_0083_final_statement_failure_rolls_back_the_entire_migration', async () => {
    const migration=migrations.find(row=>row.path.startsWith('0083_'));
    const beforeSchema=JSON.stringify(await rows('SELECT type,name,sql FROM sqlite_schema ORDER BY type,name'));
    const beforeCredentials=JSON.stringify(await rows('SELECT * FROM admin_mfa_credentials ORDER BY admin_user_id'));
    await expectNativeRejection(()=>db.batch([
      ...migration.statements.map(statement=>db.prepare(statement)),
      db.prepare("INSERT INTO admin_mfa_credentials(admin_user_id,created_at,updated_at) VALUES('q2-workerd-admin',NULL,'synthetic')"),
    ]),'NOT NULL constraint failed: admin_mfa_credentials.created_at');
    assert.equal(JSON.stringify(await rows('SELECT type,name,sql FROM sqlite_schema ORDER BY type,name')),beforeSchema);
    assert.equal(JSON.stringify(await rows('SELECT * FROM admin_mfa_credentials ORDER BY admin_user_id')),beforeCredentials);
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM r2_cleanup_queue WHERE status='pending'"),2);
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM r2_cleanup_queue WHERE status='legacy_held'"),0);
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM ai_images'),1);
    for(const key of [LIVE_KEY,LEGACY_KEY]) check(await bucket.head(key),'Failed current migration preserves native bytes');
    assert.deepEqual(await rows('PRAGMA foreign_key_check'),[]);
  });
  await test('populated_0083_holds_legacy_intents_preserves_live_references_and_bytes', async () => {
    await applyMigration(migrations.find(row => path.basename(row.path).startsWith('0083_')));
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM r2_cleanup_queue WHERE status='legacy_held'"), 2);
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM r2_object_tombstones'), 0);
    check(await scalar('SELECT COUNT(*) AS value FROM r2_cleanup_live_references WHERE r2_key=?', LIVE_KEY) >= 1, 'Existing source remains a live reference');
    for (const key of [LIVE_KEY,LEGACY_KEY]) check(await bucket.head(key), 'Migration must preserve native R2 bytes');
    await sql("INSERT INTO r2_cleanup_queue(r2_key,status,created_at) VALUES ('users/q2-workerd-member/late-legacy.webp','pending',?)", now).run();
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM r2_cleanup_queue WHERE status='legacy_held'"), 3);
  });
  await test('native_D1_batch_rollback_zero_row_meta_and_RETURNING', async () => {
    await sql('CREATE TABLE q2_native_probe(id TEXT PRIMARY KEY,value INTEGER NOT NULL)').run();
    await expectNativeRejection(
      ()=>db.batch([db.prepare("INSERT INTO q2_native_probe VALUES ('rolled-back',1)"), db.prepare("INSERT INTO q2_native_probe VALUES ('invalid',NULL)")]),
      'NOT NULL constraint failed: q2_native_probe.value');
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM q2_native_probe'), 0);
    const inserted = await sql("INSERT INTO q2_native_probe VALUES ('counter',0)").run();
    assert.equal(inserted.meta.changes, 1);
    const zero = await sql("UPDATE q2_native_probe SET value=value+1 WHERE id='absent' RETURNING id").run();
    assert.equal(zero.meta.changes, 0); assert.deepEqual(zero.results, []);
    const claimed = await sql("UPDATE q2_native_probe SET value=value+1 WHERE id='counter' AND value=0 RETURNING id,value").run();
    assert.equal(claimed.meta.changes, 1); assert.deepEqual(claimed.results, [{id:'counter',value:1}]);
    assert.equal((await sql("UPDATE q2_native_probe SET value=2 WHERE id='counter' AND value=0").run()).meta.changes, 0);
  });
  const jar = new Map();
  const accept = response => { for (const cookie of response.headers.getSetCookie()) {
    const first = cookie.split(';')[0], at = first.indexOf('='), name = first.slice(0,at), value = first.slice(at+1);
    if (/Max-Age=0(?:;|$)/i.test(cookie)) jar.delete(name); else jar.set(name,value);
  } };
  const cookieHeader = () => [...jar].map(([key,value]) => `${key}=${value}`).join('; ');
  const request = (route, body, cookie = cookieHeader()) => mf.dispatchFetch(`https://bitbi.ai${route}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, Origin: 'https://bitbi.ai',
      'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.63', 'x-bitbi-correlation-id': 'q2-native-runtime' },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const privateHeaders = response => {
    for (const [name,value] of [['cache-control','no-store'],['x-content-type-options','nosniff'],['x-frame-options','DENY'],['content-type','application/json; charset=utf-8']]) check(response.headers.get(name) === value, `Required response header ${name}`);
  };
  const clearCookies = (response, names) => {
    privateHeaders(response);
    const values = response.headers.getSetCookie();
    assert.deepEqual(values.map(value => value.split('=')[0]).sort(), [...names].sort());
    for (const value of values) for (const part of ['Max-Age=0','HttpOnly','Path=/','SameSite=Lax','Secure']) check(value.includes(part), `Expired cookie attribute ${part}`);
    check(values.every(value => !/Domain=/i.test(value)), 'Host cookie must omit Domain');
  };
  let setup, sessionCookie2;
  await test('actual_B_HTTP_login_separate_cookies_enrollment_and_admin_proof', async () => {
    const password='Q2 synthetic native runtime password 123!';
    check((await control('/password',{userId:ADMIN,password})).status === 200, 'Synthetic password initialization');
    const login = await request('/api/login',{email:`${ADMIN}@example.invalid`,password});
    assert.equal(login.status,200); privateHeaders(login);
    assert.equal(login.headers.getSetCookie().length,3); accept(login);
    check(jar.has('__Host-bitbi_session'), 'Login must return secure session cookie');
    const denied = await request('/api/admin/registration/status');
    assert.equal(denied.status,403); clearCookies(denied,['__Host-bitbi_admin_mfa','bitbi_admin_mfa']);
    const setupResponse = await request('/api/admin/mfa/setup',{});
    assert.equal(setupResponse.status,200); setup=(await setupResponse.json()).setup;
    const code=(await (await control('/totp',{secret:setup.secret})).json()).code;
    const enabled=await request('/api/admin/mfa/enable',{code});
    assert.equal(enabled.status,200); accept(enabled);
    check(jar.has('__Host-bitbi_admin_mfa'), 'Persisted MFA must issue proof');
    assert.equal((await request('/api/admin/registration/status')).status,200);
    check(await scalar('SELECT COUNT(*) AS value FROM admin_mfa_credentials WHERE admin_user_id=? AND mutation_token IS NOT NULL AND enabled_at IS NOT NULL',ADMIN) === 1,'Enable must persist guard before proof');
    sessionCookie2=(await (await control('/session',{userId:ADMIN})).json()).cookie;
    const mismatched=await request('/api/admin/registration/status',undefined,`${sessionCookie2}; __Host-bitbi_admin_mfa=${jar.get('__Host-bitbi_admin_mfa')}`);
    assert.equal(mismatched.status,403); clearCookies(mismatched,['__Host-bitbi_admin_mfa','bitbi_admin_mfa']);
  });
  await test('actual_B_MFA_invalid_proof_preserves_two_expiry_fields_and_recovery_is_once', async () => {
    jar.set('__Host-bitbi_admin_mfa','malformed-synthetic-proof'); jar.set('bitbi_admin_mfa','synthetic-legacy-proof');
    const denied=await request('/api/admin/registration/status');
    assert.equal(denied.status,403); check((await denied.json()).code==='admin_mfa_invalid_or_expired','Invalid proof code');
    clearCookies(denied,['__Host-bitbi_admin_mfa','bitbi_admin_mfa']); accept(denied);
    const recovery=await request('/api/admin/mfa/verify',{recovery_code:setup.recoveryCodes[0]});
    assert.equal(recovery.status,200); accept(recovery);
    assert.equal((await request('/api/admin/registration/status')).status,200);
    assert.equal((await request('/api/admin/mfa/verify',{recovery_code:setup.recoveryCodes[0]})).status,400);
    const concurrent=await Promise.all([request('/api/admin/mfa/verify',{recovery_code:setup.recoveryCodes[1]}),request('/api/admin/mfa/verify',{recovery_code:setup.recoveryCodes[1]},sessionCookie2)]);
    const statuses=concurrent.map(response=>response.status).sort();
    check(statuses[0]===200 && [400,409].includes(statuses[1]), 'One successful concurrent native recovery claim');
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM admin_mfa_recovery_codes WHERE admin_user_id=? AND used_at IS NOT NULL',ADMIN),2);
  });
  await test('actual_B_logout_preserves_four_expiry_fields', async () => {
    const logout=await request('/api/logout',{});
    assert.equal(logout.status,200); clearCookies(logout,['__Host-bitbi_session','bitbi_session','__Host-bitbi_admin_mfa','bitbi_admin_mfa']); accept(logout);
    check(jar.size===0,'Logout must clear complete local jar');
  });
  const checkout='q2-workerd-checkout', checkoutSession='cs_live_q2_workerd_pack', eventId='evt_q2_workerd_pack';
  const event={id:eventId,object:'event',type:'checkout.session.completed',livemode:true,created:Math.floor(Date.now()/1000),data:{object:{
    id:checkoutSession,object:'checkout.session',livemode:true,mode:'payment',payment_status:'paid',amount_total:999,currency:'eur',
    customer:'cus_q2_workerd_fixture',payment_intent:'pi_live_q2_workerd_fixture',metadata:{checkout_scope:'member',user_id:MEMBER,credit_pack_id:'live_credits_5000',credits:'5000',internal_checkout_session_id:checkout}}}};
  const deliver=async()=>{
    const raw=JSON.stringify(event), timestamp=Math.floor(Date.now()/1000);
    const digest=crypto.createHmac('sha256',webhookSecret).update(`${timestamp}.${raw}`).digest('hex');
    return mf.dispatchFetch('https://bitbi.ai/api/billing/webhooks/stripe/live',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':`t=${timestamp},v1=${digest}`,'CF-Connecting-IP':'192.0.2.64'},body:raw});
  };
  await test('actual_B_signed_pack_failure_retains_receipt_without_partial_grant', async () => {
    // This Member pack does not use the Organization cap. Migration0039
    // raises the original0035 seed from1000 to100000; keep that real migrated
    // state unchanged instead of adding a fixture entitlement override.
    assert.equal(await scalar("SELECT value_numeric AS value FROM entitlements WHERE id='ent_free_credits_balance_max'"),100000);
    await sql(`INSERT INTO billing_member_checkout_sessions(id,provider,provider_mode,provider_checkout_session_id,user_id,credit_pack_id,credits,amount_cents,currency,status,idempotency_key_hash,request_fingerprint_hash,authorization_scope,metadata_json,created_at,updated_at)
      VALUES (?,'stripe','live',?,?,'live_credits_5000',5000,999,'eur','created',?,?,'member','{}',?,?)`,checkout,checkoutSession,MEMBER,'a'.repeat(64),'b'.repeat(64),now,now).run();
    await sql("CREATE TRIGGER q2_workerd_fail_grant BEFORE INSERT ON member_credit_ledger BEGIN SELECT RAISE(ABORT,'synthetic native pre-grant failure'); END").run();
    const failed=await deliver(); assert.equal(failed.status,503);
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM billing_provider_events WHERE provider_event_id=? AND processing_status=\'failed\'',eventId),1);
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM member_credit_ledger WHERE user_id=?',MEMBER),0);
    assert.equal(await scalar('SELECT COALESCE(SUM(balance),0) AS value FROM member_credit_buckets WHERE user_id=?',MEMBER),0);
    assert.equal((await sql('SELECT status FROM billing_member_checkout_sessions WHERE id=?',checkout).first()).status,'created');
    await sql('DROP TRIGGER q2_workerd_fail_grant').run();
  });
  await test('actual_B_identical_signed_pack_resumes_once_to_5000_and_duplicate_is_zero', async () => {
    const resumed=await deliver(); assert.equal(resumed.status,200);
    assert.equal((await resumed.json()).creditGrant?.creditsGranted,5000);
    const duplicate=await deliver(); assert.equal(duplicate.status,200);
    assert.equal((await duplicate.json()).creditGrant?.creditsGranted,0);
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM member_credit_ledger WHERE user_id=?',MEMBER),1);
    assert.equal(await scalar('SELECT SUM(amount) AS value FROM member_credit_ledger WHERE user_id=?',MEMBER),5000);
    assert.equal(await scalar('SELECT SUM(balance) AS value FROM member_credit_buckets WHERE user_id=?',MEMBER),5000);
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM member_credit_bucket_events WHERE user_id=?',MEMBER),1);
    assert.equal((await sql('SELECT status FROM billing_member_checkout_sessions WHERE id=?',checkout).first()).status,'completed');
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM billing_event_actions WHERE json_extract(summary_json,'$.fulfillmentStatus')='completed' AND dry_run=0"),1);
  });
  await test('native_L01_source_delete_failure_rolls_back_outbox_and_preserves_R2', async () => {
    await insertImage('q2-workerd-atomic-image',ATOMIC_KEY); await bucket.put(ATOMIC_KEY,new Uint8Array([4,5,6]));
    await sql("CREATE TRIGGER q2_workerd_fail_source BEFORE DELETE ON ai_images WHEN OLD.id='q2-workerd-atomic-image' BEGIN SELECT RAISE(ABORT,'synthetic native source failure'); END").run();
    const failed=await control('/delete-image',{imageId:'q2-workerd-atomic-image'});
    assert.equal(failed.status,500);
    const failedBody=await failed.json();
    assert.equal(failedBody.code,'batch_error');
    assert.equal(failedBody.causeMarker,'synthetic_native_source_failure');
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM ai_images WHERE id=\'q2-workerd-atomic-image\''),1);
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM r2_cleanup_queue WHERE r2_key=?',ATOMIC_KEY),0);
    check(await bucket.head(ATOMIC_KEY),'Source rollback preserves native R2');
    await sql('DROP TRIGGER q2_workerd_fail_source').run();
  });
  await test('native_L01_committed_source_delete_retains_real_outbox_when_retirement_is_blocked', async () => {
    await sql(`CREATE TRIGGER q2_workerd_hold_retirement BEFORE INSERT ON r2_object_tombstones WHEN NEW.r2_key='${ATOMIC_KEY}' BEGIN SELECT RAISE(ABORT,'synthetic native retirement pause'); END`).run();
    assert.equal((await control('/delete-image',{imageId:'q2-workerd-atomic-image'})).status,200);
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM ai_images WHERE id=\'q2-workerd-atomic-image\''),0);
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM r2_cleanup_queue WHERE r2_key=? AND status='q2_pending'",ATOMIC_KEY),1);
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM r2_object_tombstones WHERE r2_key=?',ATOMIC_KEY),0);
    check(await bucket.head(ATOMIC_KEY),'Inline claim failure must preserve pending native R2');
    await sql('DROP TRIGGER q2_workerd_hold_retirement').run();
    await sql("INSERT INTO r2_cleanup_queue(r2_key,status,created_at) VALUES (?,'q2_pending',?)",LIVE_KEY,now).run();
  });
  check(config.triggers.crons.includes('0 3 * * *'),'Configured Q2 daily scheduled hook');
  const scheduled=()=>mf.dispatchFetch('http://127.0.0.1/cdn-cgi/local/scheduled?cron=0%203%20*%20*%20*&format=json');
  await test('actual_B_native_scheduled_hook_consumes_only_retired_unreferenced_outbox', async () => {
    const response=await scheduled(); assert.equal(response.status,200);
    check((await response.json()).outcome==='ok','Native scheduled event outcome');
    check(await bucket.head(ATOMIC_KEY)===null,'Actual scheduled consumer deletes eligible native R2');
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM r2_cleanup_queue WHERE r2_key=?',ATOMIC_KEY),0);
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM r2_object_tombstones WHERE r2_key=?',ATOMIC_KEY),1);
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM r2_cleanup_queue WHERE r2_key=? AND status='q2_held'",LIVE_KEY),1);
    for (const key of [LIVE_KEY,LEGACY_KEY]) check(await bucket.head(key),'Scheduled consumer must preserve referenced/legacy bytes');
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM r2_cleanup_queue WHERE status='legacy_held'"),3);
    assert.equal((await scheduled()).status,200);
  });
  await test('native_L01_permanent_tombstone_blocks_references_and_R2_create_only_is_real', async () => {
    for (const [operation,marker] of [
      [()=>insertImage('q2-retired-reference',ATOMIC_KEY),'r2_object_key_retired'],
      [()=>sql('UPDATE r2_object_tombstones SET retired_at=? WHERE r2_key=?',now,ATOMIC_KEY).run(),'r2_object_retirement_is_permanent'],
      [()=>sql('DELETE FROM r2_object_tombstones WHERE r2_key=?',ATOMIC_KEY).run(),'r2_object_retirement_is_permanent'],
    ]) await expectNativeRejection(operation,marker);
    const key=`users/${MEMBER}/native-create-only.webp`;
    assert.equal((await control('/managed-put',{key})).status,200);
    const duplicatePut=await control('/managed-put',{key});
    assert.equal(duplicatePut.status,409);
    assert.equal((await duplicatePut.json()).code,'object_key_already_exists');
    assert.deepEqual([...new Uint8Array(await (await bucket.get(key)).arrayBuffer())],[9,8,7]);
  });
  await test('final_native_integrity_and_no_outbound_attempts',async()=>{
    assert.deepEqual(await rows('PRAGMA foreign_key_check'),[]);
    assert.equal(counters.outboundDenied,0); assert.equal(counters.serviceDenied,0);
    assert.equal(await scalar('SELECT SUM(amount) AS value FROM member_credit_ledger WHERE user_id=?',MEMBER),5000);
    for (const binding of ['PRIVATE_MEDIA','AUDIT_ARCHIVE']) assert.equal((await (await mf.getR2Bucket(binding,'q2-candidate')).list()).objects.length,0);
  });
}
