import assert from 'node:assert/strict';
export async function runModelStatusTests(f) {
 for(const m of f.migrations)await f.db.batch(m.statements.map(s=>f.db.prepare(s)));
 const now=new Date().toISOString(),expires=new Date(Date.now()+3600000).toISOString();
 for(const [id,role]of [['q2-workerd-admin','admin'],['q2-workerd-member','user']])await f.sql('INSERT INTO users(id,email,password_hash,created_at,role,status,email_verified_at,verification_method) VALUES(?,?,?,?,?,?,?,?)',id,id+'@example.invalid','synthetic',now,role,'active',now,'email').run();
 const worker={fetch:(...args)=>f.mf.dispatchFetch(...args)};let count=0;
 const get=(cookie='',body,route='/api/admin/ai/model-status')=>worker.fetch('https://bitbi.ai'+route,{method:body?'POST':'GET',headers:{Cookie:cookie,Origin:'https://bitbi.ai','Content-Type':'application/json','CF-Connecting-IP':`192.0.2.${++count}`},body:body?JSON.stringify(body):undefined});
 const cookie=async id=>(await(await f.control('/session',{userId:id})).json()).cookie;
 let admin=await cookie('q2-workerd-admin');const member=await cookie('q2-workerd-member');
 await f.test('model_status_actual_route_denies_guest_member_and_admin_without_MFA_before_status_reads',async()=>{
  assert.equal((await get()).status,401);assert.equal((await get(member)).status,403);assert.equal((await get(admin)).status,403);assert.equal(f.counters.outboundDenied,0);assert.equal(f.counters.serviceDenied,0);
 });
 f.stage='status_fixture_login';
 const password='Model status synthetic password 123!';
 await f.control('/password',{userId:'q2-workerd-admin',password});
 const login=await get('',{email:'q2-workerd-admin@example.invalid',password},'/api/login');assert.equal(login.status,200,'synthetic login response '+login.headers.get('content-type'));admin=login.headers.getSetCookie().find(c=>c.startsWith('__Host-bitbi_session=')).split(';')[0];
 f.stage='status_fixture_mfa_setup';
 const setupResponse=await get(admin,{},'/api/admin/mfa/setup');assert.equal(setupResponse.status,200,'MFA setup response '+setupResponse.headers.get('content-type'));const setup=(await setupResponse.json()).setup;
 const code=(await(await f.control('/totp',{secret:setup.secret})).json()).code;
 f.stage='status_fixture_mfa_enable';
 const enabled=await get(admin,{code},'/api/admin/mfa/enable');assert.equal(enabled.status,200,'MFA response '+enabled.headers.get('content-type'));
 admin+='; '+enabled.headers.getSetCookie().find(c=>c.startsWith('__Host-bitbi_admin_mfa=')).split(';')[0];
 await f.sql(`INSERT INTO admin_ai_usage_attempts_v2(id,operation_key,route,admin_user_id,idempotency_key_hash,request_fingerprint,provider_family,model_key,budget_scope,status,provider_status,provider_outcome,created_at,updated_at,completed_at,expires_at)
 VALUES('status-attempt','admin.ai.text','/api/admin/ai/text','q2-workerd-admin','status-key','synthetic','workers_ai','@cf/meta/llama-3.1-8b-instruct-fast','synthetic','succeeded','succeeded','succeeded',?,?,?,?)`,now,now,now,expires).run();
 await f.sql(`INSERT INTO member_ai_usage_attempts_v2(id,user_id,feature_key,operation_key,route,idempotency_key,request_fingerprint,credit_cost,status,provider_status,provider_outcome,billing_status,result_model,created_at,updated_at,completed_at,expires_at)
 VALUES('status-member','q2-workerd-member','ai.video','member.video','/api/ai/video','member-key','private-fingerprint',1,'succeeded','succeeded','succeeded','finalized','pixverse/v6',?,?,?,?)`,now,now,now,expires).run();
 await f.sql(`INSERT INTO ai_text_assets(id,user_id,title,file_name,mime_type,size_bytes,source_module,r2_key,created_at) VALUES('status-video','q2-workerd-member','PRIVATE TITLE','private.mp4','video/mp4',32,'video','private-object',?)`,now).run();
 await f.sql(`INSERT INTO member_generation_jobs(id,user_id,usage_attempt_id,media_type,request_key,input_r2_key,status,next_attempt_at,asset_id,created_at,updated_at) VALUES('status-job','q2-workerd-member','status-member','video','job-key','private-input','preview_pending',?,'status-video',?,?)`,now,now,now).run();
 await f.test('model_status_actual_route_reads_native_schema_without_AI_or_job_mutation_and_keeps_cache_private',async()=>{
  const before=await f.rows('SELECT * FROM admin_ai_usage_attempts_v2');
  const response=await get(admin);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
  const result=await response.json();assert.equal(result.ok,true);assert.ok(result.data.sources.every(s=>s.available));
  assert.ok(result.data.models.some(m=>m.lastSuccess===now));assert.equal(result.data.provider.stale,true,'Official feed unavailable is not a model outage');
  assert.deepEqual(await f.rows('SELECT * FROM admin_ai_usage_attempts_v2'),before);assert.equal(await f.scalar('SELECT COUNT(*) AS value FROM member_generation_jobs'),1);assert.equal(result.data.pipeline.previewPending,1);assert.equal(result.data.pipeline.stored,1);assert.equal(f.counters.serviceDenied,0);
  assert.doesNotMatch(JSON.stringify(result),/status-key|synthetic|q2-workerd-admin|request_fingerprint|PRIVATE TITLE|private-object|private-input/);
  const feedAttempts=f.counters.outboundDenied;assert.ok(feedAttempts<=1);const again=await get(admin);assert.equal(again.status,200);assert.equal(f.counters.outboundDenied,feedAttempts,'Cached refresh performs no additional public-feed request');
 });
}
