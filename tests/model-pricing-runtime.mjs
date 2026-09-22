import assert from 'node:assert/strict';
export async function runModelPricingTests(f) {
 for(const m of f.migrations) await f.db.batch(m.statements.map(s=>f.db.prepare(s)));
 const now=new Date().toISOString();
 for(const [id,role] of [['q2-workerd-admin','admin'],['q2-workerd-member','user']]) await f.sql('INSERT INTO users(id,email,password_hash,created_at,role,status,email_verified_at,verification_method) VALUES(?,?,?,?,?,?,?,?)',id,id+'@example.invalid','synthetic',now,role,'active',now,'email').run();
 await f.sql("INSERT INTO member_credit_ledger(id,user_id,amount,balance_after,entry_type,source,created_by_user_id,created_at) VALUES(?,?,10000,10000,'grant','synthetic',?,?)",'pricing-grant','q2-workerd-member','q2-workerd-admin',now).run();
 const org='org_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
 await f.sql('INSERT INTO organizations(id,name,slug,status,created_by_user_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',org,'Synthetic pricing organization','synthetic-pricing','active','q2-workerd-admin',now,now).run();
 await f.sql('INSERT INTO organization_memberships(id,organization_id,user_id,role,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)','pricing-membership',org,'q2-workerd-member','member','active',now,now).run();
 await f.sql('INSERT INTO organization_subscriptions(id,organization_id,plan_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?)','pricing-subscription',org,'plan_free','active',now,now).run();
 await f.sql("INSERT INTO credit_ledger(id,organization_id,amount,balance_after,entry_type,source,created_by_user_id,created_at) VALUES(?,?,10000,10000,'grant','synthetic',?,?)",'pricing-org-grant',org,'q2-workerd-admin',now).run();
 const call=(cookie,method,path,body)=>f.mf.dispatchFetch('https://bitbi.ai'+path,{method,headers:{Cookie:cookie,Origin:'https://bitbi.ai','Content-Type':'application/json','CF-Connecting-IP':'192.0.2.20'},...(body?{body:JSON.stringify(body)}:{})});
 const cookie=async id=>(await(await f.control('/session',{userId:id})).json()).cookie;
 let admin=await cookie('q2-workerd-admin');const member=await cookie('q2-workerd-member');const route='/api/admin/ai/model-pricing';
 await f.test('pricing_admin_read_write_and_MFA_boundaries',async()=>{
  for(const [c,status]of [['',401],[member,403],[admin,403]]) for(const method of ['GET','PATCH']) assert.equal((await call(c,method,route,method==='PATCH'?{}:null)).status,status);
 });
 const password='Model pricing synthetic password 123!';await f.control('/password',{userId:'q2-workerd-admin',password});
 const login=await call('','POST','/api/login',{email:'q2-workerd-admin@example.invalid',password});assert.equal(login.status,200);admin=login.headers.getSetCookie().find(c=>c.startsWith('__Host-bitbi_session=')).split(';')[0];
 const setupResponse=await call(admin,'POST','/api/admin/mfa/setup',{});assert.equal(setupResponse.status,200);const setup=(await setupResponse.json()).setup;
 const code=(await(await f.control('/totp',{secret:setup.secret})).json()).code;
 const enabled=await call(admin,'POST','/api/admin/mfa/enable',{code});assert.equal(enabled.status,200);admin+='; '+enabled.headers.getSetCookie().find(c=>c.startsWith('__Host-bitbi_admin_mfa=')).split(';')[0];
 const change=async (revision,action='save',rates={second:7.25},settings={resolution:'768P',duration:5})=>{
  const response=await call(admin,'PATCH',route,{revision,action,modelId:'minimax/h3',settings,...(action==='save'?{rates}:{})});assert.match(response.headers.get('content-type')||'',/json/,`pricing response ${response.status}: ${(await response.clone().text()).slice(0,600)}`);return {status:response.status,data:await response.json()};};
 const quote=async settings=>{const response=await call(admin,'POST',route+'/quote',{modelId:'minimax/h3',settings});assert.equal(response.status,200);return (await response.json()).price;};
 const control=async body=>{const response=await f.control('/model-pricing',body);assert.match(response.headers.get('content-type')||'',/json/,`pricing response ${response.status}: ${(await response.clone().text()).slice(0,600)}`);return {status:response.status,data:await response.json()};};
 await f.test('pricing_gpt_image_25_unverified_reference_cost_rejects_quotes_and_overrides_without_mutation',async()=>{
  const response=await call(admin,'GET',route);assert.equal(response.status,200);const catalog=(await response.json()).models;
  for(const modelId of ['openai/gpt-image-2.5-sunburst','openai/gpt-image-2.5-flare']){
   const model=catalog.find(value=>value.id===modelId);assert.ok(model);assert.equal(model.enabled,true);assert.ok(model.factory.credits>0);assert.ok(model.factory.providerCostUsd>0);
   assert.deepEqual(model.pricingControls.find(value=>value.key==='background').options,['transparent','opaque','auto']);
   assert.deepEqual(model.pricingControls.find(value=>value.key==='outputFormat').options,['png','webp','jpeg']);
   assert.equal(model.pricingControls.find(value=>value.key==='referenceImageCount').max,16);
   const unavailable=await call(admin,'POST',route+'/quote',{modelId,settings:{quality:'max',size:'auto',background:'transparent',outputFormat:'webp',referenceImageCount:16,operation:'edit'}});
   assert.equal(unavailable.status,503);assert.equal((await unavailable.json()).code,'gpt_image_25_reference_pricing_unavailable');
   const invalid=await call(admin,'POST',route+'/quote',{modelId,settings:{background:'transparent',outputFormat:'jpeg'}});assert.equal(invalid.status,400);
   const override=await call(admin,'PATCH',route,{modelId,revision:0,action:'save',settings:{referenceImageCount:1},rates:{image:1,referenceImage:1}});assert.equal(override.status,400);
  }
  assert.equal(await f.scalar('SELECT COUNT(*) AS value FROM model_pricing_changes'),0);
  assert.equal(await f.scalar('SELECT COUNT(*) AS value FROM member_ai_usage_attempts_v2'),0);
  assert.equal(await f.scalar('SELECT COUNT(*) AS value FROM ai_usage_attempts_v2'),0);
  assert.equal(f.counters.outboundDenied,0);assert.equal(f.counters.serviceDenied,0);
 });
 await f.test('pricing_factory_rollout_no_charge_change_and_configuration_specific_durable_override',async()=>{
  const csrf=await f.mf.dispatchFetch('https://bitbi.ai'+route,{method:'PATCH',headers:{Cookie:admin,Origin:'https://untrusted.invalid','Content-Type':'application/json'},body:'{}'});assert.equal(csrf.status,403);
  const before=await quote({duration:5,resolution:'768P'});assert.equal(before.credits,262);assert.equal(before.tariff.source,'factory');
  const saved=await change(0);assert.equal(saved.status,200);assert.equal(saved.data.revision,1);
  const after=await quote({duration:5,resolution:'768P'});assert.equal(after.credits,37);assert.equal(after.factoryCredits,262);assert.equal(after.providerCostUsd,before.providerCostUsd);
  assert.equal((await quote({duration:5,resolution:'2K'})).tariff.source,'factory');
  assert.equal(await f.scalar('SELECT COUNT(*) AS value FROM model_pricing_changes'),1);
  assert.equal(await f.scalar('SELECT COUNT(*) AS value FROM model_pricing_factory'),2);
  const publicResponse=await call('','GET','/api/model-pricing');assert.equal(publicResponse.status,200);assert.match(publicResponse.headers.get('cache-control'),/no-store/);
  assert.doesNotMatch(JSON.stringify(await publicResponse.json()),/providerCost|actor_user|baseline_json|source_url/);
 });
 await f.test('pricing_conflict_invalid_rates_and_stale_quote_rejected_before_reservation',async()=>{
  assert.equal((await change(0)).status,409);assert.equal((await change(1,'save',{second:-1})).status,400);
  const rejected=await control({key:'pricing-old-quote-0001',revision:0});assert.equal(rejected.status,409);assert.equal(rejected.data.code,'model_pricing_stale');
  assert.equal(await f.scalar('SELECT COUNT(*) AS value FROM member_ai_usage_attempts_v2'),0);
 });
 await f.test('pricing_accepted_job_pins_tariff_after_change_and_settles_once_under_pinned_units',async()=>{
  const accepted=await control({key:'pricing-accepted-0001',revision:1});assert.equal(accepted.status,200);assert.equal(accepted.data.credits,37);
  const orgAccepted=await control({key:'pricing-org-accepted',revision:1,organization:org});assert.equal(orgAccepted.status,200);assert.equal(orgAccepted.data.credits,37);
  assert.equal((await change(1,'save',{second:100})).status,200);
  const resumed=await control({key:'pricing-accepted-0001',revision:1});assert.equal(resumed.status,200);assert.equal(resumed.data.credits,37);assert.equal(resumed.data.attemptId,accepted.data.attemptId);
  const settled=await control({key:'pricing-accepted-0001',revision:1,settle:true,seconds:4});assert.equal(settled.status,200);assert.equal(settled.data.billing.credits_charged,29);
  const replay=await control({key:'pricing-accepted-0001',revision:1});assert.equal(replay.status,200);assert.equal(replay.data.kind,'completed');assert.equal(replay.data.tariff.tariff.revision,1);
  assert.equal(await f.scalar('SELECT COUNT(*) AS value FROM member_credit_ledger WHERE amount<0'),1);
  const orgResumed=await control({key:'pricing-org-accepted',revision:1,organization:org});assert.equal(orgResumed.status,200);assert.equal(orgResumed.data.credits,37);assert.equal(orgResumed.data.tariff.tariff.revision,1);
  const orgSettled=await control({key:'pricing-org-accepted',revision:1,organization:org,settle:true,seconds:4});assert.equal(orgSettled.status,200);assert.equal(orgSettled.data.billing.credits_charged,29);
  const orgReplay=await control({key:'pricing-org-accepted',revision:1,organization:org});assert.equal(orgReplay.status,200);assert.equal(orgReplay.data.tariff.tariff.revision,1);assert.equal(await f.scalar('SELECT COUNT(*) AS value FROM credit_ledger WHERE amount<0'),1);
  const fresh=await control({key:'pricing-new-quote-0002',revision:2});assert.equal(fresh.status,200);assert.equal(fresh.data.credits,500);
 });
 await f.test('pricing_native_revision_trigger_blocks_admission_after_quote_race',async()=>{
  const before=await f.scalar('SELECT COUNT(*) AS value FROM member_ai_usage_attempts_v2');
  await assert.rejects(()=>f.sql(`INSERT INTO member_ai_usage_attempts_v2 (id,user_id,feature_key,operation_key,route,idempotency_key,request_fingerprint,credit_cost,quantity,status,provider_status,billing_status,result_status,created_at,updated_at,expires_at,metadata_json)
    SELECT 'pricing-race',user_id,feature_key,operation_key,route,'pricing-race-key',request_fingerprint,credit_cost,quantity,'reserved','not_started','reserved','none',created_at,updated_at,expires_at,metadata_json FROM member_ai_usage_attempts_v2 WHERE metadata_json LIKE '%"revision":1%' LIMIT 1`).run(),/model_pricing_stale/);
  assert.equal(await f.scalar('SELECT COUNT(*) AS value FROM member_ai_usage_attempts_v2'),before);
 });
 await f.test('pricing_reset_preserves_factory_and_audit',async()=>{
  assert.equal((await change(2,'reset')).status,200);assert.equal((await quote({duration:5,resolution:'768P'})).credits,262);
  assert.equal(await f.scalar('SELECT COUNT(*) AS value FROM model_pricing_factory'),2);assert.equal(await f.scalar('SELECT COUNT(*) AS value FROM model_pricing_changes'),3);
  assert.equal(f.counters.outboundDenied,0);assert.equal(f.counters.serviceDenied,0);
 });
 await f.test('pricing_gpt_image_25_generation_pins_member_and_org_quotes_across_override_reset_and_replay',async()=>{
  let revision=3;
  for(const modelId of ['openai/gpt-image-2.5-sunburst','openai/gpt-image-2.5-flare']){
   const settings={quality:'high',size:'1024x1536',background:'transparent',outputFormat:'webp',referenceImageCount:0,operation:'generate'};
   const patch=async(action,rates)=>{const response=await call(admin,'PATCH',route,{modelId,revision,action,settings,...(rates?{rates}:{})});assert.equal(response.status,200);revision=(await response.json()).revision;};
   await patch('save',{image:7.25,referenceImage:2.5});
   const acceptedRevision=revision, suffix=modelId.split('-').at(-1);
   const request={modelId,settings,revision:acceptedRevision,key:`pricing-gpt25-${suffix}-member`};
   const memberBefore=await f.scalar('SELECT COUNT(*) AS value FROM member_credit_ledger WHERE amount<0'),orgBefore=await f.scalar('SELECT COUNT(*) AS value FROM credit_ledger WHERE amount<0');
   const memberAccepted=await control(request);assert.equal(memberAccepted.status,200);assert.equal(memberAccepted.data.credits,8);
   assert.equal(memberAccepted.data.tariff.factoryQuote.pricingVersion,'gpt-image-2.5-bounded-2026-09-22');
   assert.equal(memberAccepted.data.tariff.factoryQuote.textInputTokenBound,new TextEncoder().encode('Synthetic pricing fixture').length);
   assert.equal(memberAccepted.data.tariff.factoryQuote.outputImageTokens,1372);
   assert.equal(memberAccepted.data.tariff.factoryQuote.fundingMultiplier,1.05);
   const organizationRequest={...request,organization:org,key:`pricing-gpt25-${suffix}-org`};
   assert.equal((await control(organizationRequest)).data.credits,8);
   await patch('save',{image:57,referenceImage:2.5});
   const stale=await control({...request,key:`pricing-gpt25-${suffix}-stale`});assert.equal(stale.status,409);assert.equal(stale.data.code,'model_pricing_stale');
   for(const input of [request,organizationRequest]){
    const resumed=await control(input);assert.equal(resumed.status,200);assert.equal(resumed.data.credits,8);assert.equal(resumed.data.tariff.tariff.revision,acceptedRevision);
    assert.equal((await control({...input,settle:true})).data.billing.credits_charged,8);
    const replay=await control(input);assert.equal(replay.data.kind,'completed');assert.equal(replay.data.credits,8);
   }
   assert.equal(await f.scalar('SELECT COUNT(*) AS value FROM member_credit_ledger WHERE amount<0'),memberBefore+1);
   assert.equal(await f.scalar('SELECT COUNT(*) AS value FROM credit_ledger WHERE amount<0'),orgBefore+1);
   const fresh=await control({...request,revision,key:`pricing-gpt25-${suffix}-fresh`});assert.equal(fresh.data.credits,57);
   const quoteResponse=await call(admin,'POST',route+'/quote',{modelId,settings:{...settings,background:'opaque'}});assert.equal(quoteResponse.status,200);assert.equal((await quoteResponse.json()).price.tariff.source,'factory');
   await patch('reset');
   const reset=await call(admin,'POST',route+'/quote',{modelId,settings});assert.equal(reset.status,200);assert.equal((await reset.json()).price.tariff.source,'factory');
  }
  assert.equal(f.counters.outboundDenied,0);assert.equal(f.counters.serviceDenied,0);
 });
}
