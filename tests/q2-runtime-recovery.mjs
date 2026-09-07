import assert from 'node:assert/strict';
import path from 'node:path';
import crypto from 'node:crypto';
import {check} from './helpers/q2-runtime/assertions.mjs';

// Canonical current C entry and restriction adapter import exactly the same
// Wrangler-built B bytes used for setup/resume. No old-A or queue-parking claim.
export async function runRecoveryTests(f) {
  const {mf,db,bucket,sql,rows,scalar,control,counters,webhookSecret,migrations,test}=f;
  const traced=async(kind,route,operation)=>{const response=await operation();f.trace.push({kind,route,status:response.status});return response;};
  const now=new Date().toISOString(), ADMIN='q2-workerd-admin', MEMBER='q2-workerd-member';
  const full=await mf.getWorker('q2-candidate');
  const restricted=await mf.getWorker('q2-restricted');
  await test('local_Miniflare_proxy_still_rejects_unconfigured_Origin',async()=>{
    const response=await full.fetch('https://bitbi.ai/api/login',{method:'POST',headers:{Origin:'https://unconfigured-origin.invalid','Content-Type':'application/json'},body:'{}'});
    assert.equal(response.status,403);
    check((await response.text()).includes('Invalid Origin header'),'Expected Miniflare transport rejection; not product authorization evidence');
  });
  for(const migration of migrations.filter(row=>Number(path.basename(row.path).slice(0,4))<=82)){
    f.stage=`fixture_migration_${path.basename(migration.path).slice(0,4)}`;
    await db.batch(migration.statements.map(statement=>db.prepare(statement)));
  }
  for(const [id,role] of [[ADMIN,'admin'],[MEMBER,'user']])await sql(`INSERT INTO users(id,email,password_hash,created_at,role,status,email_verified_at,verification_method)
    VALUES (?,?,'synthetic-unused',?,?,'active',?,'email')`,id,`${id}@example.invalid`,now,role,now).run();
  const jar=new Map();
  const accept=response=>{for(const cookie of response.headers.getSetCookie()){
    const pair=cookie.split(';')[0],at=pair.indexOf('='),name=pair.slice(0,at);
    if(/Max-Age=0(?:;|$)/i.test(cookie))jar.delete(name);else jar.set(name,pair.slice(at+1));
  }};
  const cookies=()=>[...jar].map(([name,value])=>`${name}=${value}`).join('; ');
  const request=(worker,route,body,cookie=cookies())=>traced(worker===full?'B':'C',route,()=>worker.fetch(`https://bitbi.ai${route}`,{
    method:body===undefined?'GET':'POST',headers:{Cookie:cookie,Origin:'https://bitbi.ai','Content-Type':'application/json','CF-Connecting-IP':'192.0.2.71'},
    body:body===undefined?undefined:JSON.stringify(body),
  }));
  const privateHeaders=response=>{
    for(const [name,value] of [['cache-control','no-store'],['x-content-type-options','nosniff'],['x-frame-options','DENY']])assert.equal(response.headers.get(name),value);
  };
  const expiry=(response,names)=>{
    privateHeaders(response);
    assert.deepEqual(response.headers.getSetCookie().map(value=>value.split('=')[0]).sort(),[...names].sort());
    for(const value of response.headers.getSetCookie()){
      for(const attribute of ['Max-Age=0','HttpOnly','Secure','SameSite=Lax','Path=/'])check(value.includes(attribute),'Missing cookie attribute');
      check(!/Domain=/i.test(value),'Host-only cookie');
    }
  };
  const password='Q2 synthetic restricted workerd password 234!';
  let setup;
  await test('fixture_actual_B_login_and_enrollment_populates_real_0082_MFA',async()=>{
    assert.equal((await control('/password',{userId:ADMIN,password})).status,200);
    const login=await request(full,'/api/login',{email:`${ADMIN}@example.invalid`,password});
    assert.equal(login.status,200);accept(login);
    const response=await request(full,'/api/admin/mfa/setup',{});assert.equal(response.status,200);setup=(await response.json()).setup;
    const code=(await (await control('/totp',{secret:setup.secret})).json()).code;
    const enabled=await request(full,'/api/admin/mfa/enable',{code});assert.equal(enabled.status,200);accept(enabled);
    assert.equal((await request(full,'/api/admin/registration/status')).status,200);
  });
  const checkout='q2-workerd-c-checkout', session='cs_live_q2_workerd_c_pack', eventId='evt_q2_workerd_c_pack';
  const event={id:eventId,object:'event',type:'checkout.session.completed',livemode:true,created:Math.floor(Date.now()/1000),data:{object:{
    id:session,object:'checkout.session',livemode:true,mode:'payment',payment_status:'paid',amount_total:999,currency:'eur',customer:'cus_q2_workerd_c',payment_intent:'pi_live_q2_workerd_c',
    metadata:{checkout_scope:'member',user_id:MEMBER,credit_pack_id:'live_credits_5000',credits:'5000',internal_checkout_session_id:checkout}}}};
  const deliver=worker=>{
    const raw=JSON.stringify(event),timestamp=Math.floor(Date.now()/1000),digest=crypto.createHmac('sha256',webhookSecret).update(`${timestamp}.${raw}`).digest('hex');
    return worker.fetch('https://bitbi.ai/api/billing/webhooks/stripe/live',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':`t=${timestamp},v1=${digest}`,'CF-Connecting-IP':'192.0.2.72'},body:raw});
  };
  await test('fixture_actual_B_signed_pack_is_completed_once_before_C_restriction',async()=>{
    await sql(`INSERT INTO billing_member_checkout_sessions(id,provider,provider_mode,provider_checkout_session_id,user_id,credit_pack_id,credits,amount_cents,currency,status,idempotency_key_hash,request_fingerprint_hash,authorization_scope,metadata_json,created_at,updated_at)
      VALUES (?,'stripe','live',?,?,'live_credits_5000',5000,999,'eur','created',?,?,'member','{}',?,?)`,checkout,session,MEMBER,'a'.repeat(64),'b'.repeat(64),now,now).run();
    const first=await deliver(full);assert.equal(first.status,202);assert.equal((await first.json()).creditGrant.creditsGranted,5000);
    assert.equal(await scalar('SELECT SUM(amount) AS value FROM member_credit_ledger WHERE user_id=?',MEMBER),5000);
    assert.equal(await scalar('SELECT SUM(balance) AS value FROM member_credit_buckets WHERE user_id=?',MEMBER),5000);
    const linked=await sql('SELECT status,payment_status,member_credit_ledger_entry_id FROM billing_member_checkout_sessions WHERE id=?',checkout).first();
    assert.equal(linked.status,'completed');assert.equal(linked.payment_status,'paid');check(!!linked.member_credit_ledger_entry_id,'Exact member ledger linkage');
  });
  const retiredKey=`users/${MEMBER}/retired-recovery.webp`, liveKey=`users/${MEMBER}/live-recovery.webp`;
  {
    await test('current_0083_preserves_populated_MFA_and_pack_then_seeds_permanent_tombstone',async()=>{
      const before=JSON.stringify(await rows('SELECT * FROM admin_mfa_credentials ORDER BY admin_user_id'));
      const migration=migrations.find(row=>path.basename(row.path).startsWith('0083_'));
      check(!!migration,'Current repository0083 required');
      await db.batch(migration.statements.map(statement=>db.prepare(statement)));
      assert.equal(JSON.stringify(await rows('SELECT * FROM admin_mfa_credentials ORDER BY admin_user_id')),before);
      assert.equal(await scalar('SELECT SUM(amount) AS value FROM member_credit_ledger WHERE user_id=?',MEMBER),5000);
      await sql('INSERT INTO r2_object_tombstones(r2_key,retired_at) VALUES(?,?)',retiredKey,now).run();
      await sql("INSERT INTO r2_cleanup_queue(r2_key,status,created_at) VALUES(?,'q2_deleting',?)",retiredKey,now).run();
      await bucket.put(retiredKey,new Uint8Array([7,8,9]));await bucket.put(liveKey,new Uint8Array([1,2,3]));
      await sql(`INSERT INTO ai_images(id,user_id,r2_key,prompt,model,size_bytes,created_at,derivatives_status,derivatives_version)
        VALUES('q2-c-live',?,?,'synthetic fixture','synthetic-model',3,?,'ready',1)`,MEMBER,liveKey,now).run();
    });
  }
  for (const migration of migrations.filter(row => Number(row.path.slice(0,4)) > 83)) {
    await db.batch(migration.statements.map(statement => db.prepare(statement)));
  }
  await test('actual_three_module_C_login_MFA_verification_cookie_clear_and_protected_diagnosis',async()=>{
    jar.clear();
    const login=await request(restricted,'/api/login',{email:`${ADMIN}@example.invalid`,password});
    assert.equal(login.status,200);privateHeaders(login);assert.equal(login.headers.getSetCookie().length,3);accept(login);
    const missing=await request(restricted,'/api/admin/registration/status');assert.equal(missing.status,403);assert.equal((await missing.json()).code,'admin_mfa_required');privateHeaders(missing);assert.deepEqual(missing.headers.getSetCookie(),[]);
    jar.set('__Host-bitbi_admin_mfa','malformed-synthetic-proof');jar.set('bitbi_admin_mfa','malformed-legacy-proof');
    const invalid=await request(restricted,'/api/admin/registration/status');assert.equal(invalid.status,403);assert.equal((await invalid.json()).code,'admin_mfa_invalid_or_expired');expiry(invalid,['__Host-bitbi_admin_mfa','bitbi_admin_mfa']);accept(invalid);
    const verified=await request(restricted,'/api/admin/mfa/verify',{recovery_code:setup.recoveryCodes[0]});
    assert.equal(verified.status,200);assert.equal(verified.headers.getSetCookie().length,1);accept(verified);
    for(const route of ['/api/health','/api/admin/me','/api/admin/mfa/status','/api/admin/readiness/status','/api/admin/registration/status']){
      const response=await request(restricted,route);assert.equal(response.status,200);privateHeaders(response);
    }
    const replay=await request(restricted,'/api/admin/mfa/verify',{recovery_code:setup.recoveryCodes[0]});assert.equal(replay.status,400);assert.equal((await replay.json()).code,'ADMIN_MFA_INVALID_RECOVERY_CODE');assert.deepEqual(replay.headers.getSetCookie(),[]);
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM admin_mfa_recovery_codes WHERE admin_user_id=? AND used_at IS NOT NULL',ADMIN),1);
  });
  const state=async()=>{
    const tables=['admin_mfa_credentials','admin_mfa_recovery_codes','sessions','member_credit_ledger','member_credit_buckets','member_credit_bucket_events','billing_member_checkout_sessions','billing_provider_events','billing_event_actions','ai_images','r2_cleanup_queue'];
    tables.push('r2_object_tombstones');
    const result={};for(const table of tables)result[table]=await rows(`SELECT * FROM ${table} ORDER BY rowid`);return JSON.stringify(result);
  };
  await test('actual_C_503_denies_writes_including_real_signed_pack_and_preserves_D1_states',async()=>{
    const before=await state();
    for(const [method,route] of [
      ['POST','/api/admin/mfa/setup'],['POST','/api/admin/mfa/enable'],['POST','/api/admin/mfa/disable'],['POST','/api/admin/mfa/recovery-codes/regenerate'],
      ['GET','/api/verify-email?token=synthetic'],['GET','/api/account/credits-dashboard'],['POST','/api/account/billing/checkout/live-credit-pack'],
      ['POST','/api/admin/billing/live-credit-pack-repairs'],['POST','/api/admin/r2/objects/upload'],['POST','/api/admin/r2/objects/copy'],['POST','/api/admin/r2/objects/move'],
      ['POST','/api/ai/generate'],['POST','/api/admin/ai/live-agent'],['POST','/api/openclaw/news-pulse/ingest'],
      ['POST','/api/internal/homepage/hero-videos/jobs/claim'],['POST','/api/internal/memvid-stream-previews/jobs/synthetic/complete'],
    ]){
      const response=await restricted.fetch(`https://bitbi.ai${route}`,{method,headers:{Cookie:cookies(),Origin:'https://bitbi.ai','Content-Type':'application/json'},...(method==='POST'?{body:'{}'}:{})});
      assert.equal(response.status,503);assert.equal((await response.json()).code,'release_access_restricted');assert.deepEqual(response.headers.getSetCookie(),[]);
    }
    const webhook=await deliver(restricted);assert.equal(webhook.status,503);assert.equal((await webhook.json()).code,'release_access_restricted');
    assert.equal(await state(),before);
    assert.equal(counters.outboundDenied,0);assert.equal(counters.serviceDenied,0);
  });
  await test('actual_C_two_scheduled_hooks_preserve_existing_tombstone_outbox_and_R2_bytes',async()=>{
    const before=await state();
    for(const cron of ['0 3 * * *','*/30 * * * *']){
      const response=await mf.dispatchFetch(`http://127.0.0.1/cdn-cgi/local/scheduled?cron=${encodeURIComponent(cron)}&format=json`);
      assert.equal(response.status,200);assert.equal((await response.json()).outcome,'ok');
    }
    assert.equal(await state(),before);
    for(const [key,bytes] of [[retiredKey,[7,8,9]],[liveKey,[1,2,3]]])assert.deepEqual([...new Uint8Array(await (await bucket.get(key)).arrayBuffer())],bytes);
  });
  await test('actual_B_resume_after_C_preserves_single_pack_and_C_logout_preserves_durable_MFA',async()=>{
    const ledger=JSON.stringify(await rows('SELECT * FROM member_credit_ledger WHERE user_id=? ORDER BY id',MEMBER));
    const resumed=await deliver(full);assert.equal(resumed.status,200);const body=await resumed.json();assert.equal(body.duplicate,true);assert.equal(body.creditGrant.creditsGranted,0);
    assert.equal(JSON.stringify(await rows('SELECT * FROM member_credit_ledger WHERE user_id=? ORDER BY id',MEMBER)),ledger);
    assert.equal(await scalar('SELECT SUM(balance) AS value FROM member_credit_buckets WHERE user_id=?',MEMBER),5000);
    const before=JSON.stringify(await rows('SELECT * FROM admin_mfa_credentials ORDER BY admin_user_id'));
    const logout=await request(restricted,'/api/logout',{});assert.equal(logout.status,200);expiry(logout,['__Host-bitbi_session','bitbi_session','__Host-bitbi_admin_mfa','bitbi_admin_mfa']);accept(logout);assert.equal(jar.size,0);
    const anonymous=await request(restricted,'/api/admin/me');assert.equal(anonymous.status,401);const anonymousBody=await anonymous.json();assert.equal(anonymousBody.ok,false);assert.equal(anonymousBody.error,'Not authenticated.');
    assert.equal(JSON.stringify(await rows('SELECT * FROM admin_mfa_credentials ORDER BY admin_user_id')),before);
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM admin_mfa_recovery_codes WHERE admin_user_id=? AND used_at IS NOT NULL',ADMIN),1);
  });
  await test('final_C_fixture_integrity_no_provider_or_external_attempts',async()=>{
    assert.deepEqual(await rows('PRAGMA foreign_key_check'),[]);assert.equal(counters.outboundDenied,0);assert.equal(counters.serviceDenied,0);
    for(const binding of ['PRIVATE_MEDIA','AUDIT_ARCHIVE'])assert.equal((await (await mf.getR2Bucket(binding,'q2-restricted')).list()).objects.length,0);
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM r2_object_tombstones WHERE r2_key=?',retiredKey),1);
  });
}
