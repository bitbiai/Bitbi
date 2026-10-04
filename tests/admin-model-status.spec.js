const {test,expect}=require('@playwright/test');
const {SqliteD1Database,applyAuthMigrations}=require('./helpers/sqlite-d1');
const load=()=>import('../workers/auth/src/lib/admin-model-status.js');
const now=Date.parse('2026-09-13T12:00:00Z'), time=offset=>new Date(now+offset).toISOString();
const registry=[{id:'model-a',label:'Model A',mediaTypes:['video'],configuration:[{scope:'admin',enabled:true}]}];
const row=(id,extra={})=>({id,model_id:'model-a',operation_key:'admin.video',status:'succeeded',provider_outcome:'succeeded',completed_at:time(-1000),created_at:time(-2000),...extra});
test('model status follows registry membership, canonical IDs and unknown vendors without a second catalog',async()=>{
 const {modelStatusCatalog}=await load();
 const item={id:'future/model',label:'Future',vendor:'Unknown vendor',capabilities:{generationEnabled:false}};
 const catalog=modelStatusCatalog({}, {models:{image:[item],video:[item]}},[{...item,mediaType:'image'}],[]);
 expect(catalog).toHaveLength(1);expect(catalog[0].mediaTypes).toEqual(['image','video']);expect(catalog[0].scopes).toEqual(['admin','member']);
 expect(modelStatusCatalog({}, {models:{}},[],[])).toEqual([]);
 const actual=modelStatusCatalog({});expect(new Set(actual.map(m=>m.id)).size).toBe(actual.length);expect(actual.some(m=>m.mediaTypes.includes('chat'))).toBe(true);
});
test('model status expires success, counts durable attempts once and never treats cache/input/unknown failures as outages',async()=>{
 const {summarizeModelStatus:s}=await load();const assess=rows=>s(registry,[{name:'admin',rows}],now).models[0];
 expect(assess([row('one'),row('one')]).paths[0].completed).toBe(1);
 expect(assess([row('old',{completed_at:time(-25*3600000),updated_at:time(0)})]).state).toBe('unknown');
 expect(assess([row('cache',{cache_hit:true})]).state).toBe('unknown');
 expect(assess([row('waiting',{status:'provider_running',provider_outcome:'dispatched',completed_at:null})]).paths[0].pending).toBe(1);
 for(const code of ['validation_error','insufficient_credits','forbidden','generation_timeout','provider_unavailable','unknown'])expect(assess([row('f',{status:'provider_failed',provider_outcome:'failed',error_code:code})]).state).toBe('unknown');
 const failure=(id,at,code='upstream_error')=>row(id,{status:'provider_failed',provider_outcome:'failed',error_code:code,completed_at:time(at)});
 expect(assess([failure('a',-500),failure('b',-300)]).state).toBe('degraded');
 expect(assess([failure('a',-3000),failure('b',-2000),row('success'),failure('c',-300)]).state).toBe('successful');
 expect(assess(['a','b','c'].map(id=>failure(id,-300,'provider_http_503'))).state).toBe('unavailable');
 expect(assess([failure('a',-300),failure('b',-200),row('success',{operation_key:'admin.other'})]).state).toBe('degraded');
 expect(s([{...registry[0],configuration:[{enabled:false}]}],[{name:'admin',rows:[row('one')]}],now).models[0].state).toBe('disabled');
});
test('model status separates provider completion, ownership/storage, video preview and music cover; no cross-path inherited success',async()=>{
 const {summarizeModelStatus:s}=await load();
 const r=row('video',{billing_status:'finalized',asset_present:1,job_status:'preview_pending',cover_status:null});
 const pending=s(registry,[{name:'member',rows:[r]}],now);
 expect(pending.models[0].state).toBe('unknown');expect(pending.models[0].reason).toBe('asset_retained_preview_pending');expect(pending.pipeline.previewPending).toBe(1);expect(pending.pipeline.stored).toBe(1);
 expect(s(registry,[{name:'member',rows:[{...r,job_status:'succeeded',asset_completed_at:time(-500)}]}],now).models[0].state).toBe('successful');
 expect(s(registry,[{name:'member',rows:[{...r,job_status:'succeeded',asset_present:0,asset_completed_at:time(-500)}]}],now).models[0].state).toBe('unknown');
 expect(s(registry,[{name:'member',rows:[{...r,job_status:'succeeded',completed_at:time(-25*3600000),asset_completed_at:time(-500)}]}],now).models[0].state).toBe('unknown');
 const missing=s(registry,[{name:'member',rows:[{...r,model_id:null,cover_status:'pending'}]}],now);expect(missing.unattributed).toBe(1);expect(missing.pipeline.coverPending).toBe(1);
});
test('model status real SQL is bounded/indexed, excludes private fields, caches reads and degrades independently on source errors',async()=>{
 const {readModelStatusSources,getAdminModelStatus,MODEL_STATUS_SOURCES,modelStatusQuery}=await load();
 const DB=new SqliteD1Database();applyAuthMigrations(DB);
 try {
  const sources=await readModelStatusSources({DB},now);expect(sources.every(s=>s.available)).toBe(true);
  for(const source of MODEL_STATUS_SOURCES){const plan=await DB.prepare('EXPLAIN QUERY PLAN '+modelStatusQuery(source)).bind(source.statuses[0],time(-86400000)).all();expect(plan.results.some(r=>/status_expires/.test(r.detail))).toBe(true);}
  let calls=0;const fetcher=async url=>{expect(url).toBe('https://www.cloudflarestatus.com/api/v2/components.json');calls++;return Response.json({components:[{name:'Workers AI',status:'operational',updated_at:time(0)},{name:'Unrelated',status:'major_outage'}]});};
  const env={DB};const a=await getAdminModelStatus(env,{now,fetcher});const b=await getAdminModelStatus(env,{now:now+100,fetcher});expect(calls).toBe(1);expect(b).toBe(a);expect(a.models.every(m=>['unknown','disabled'].includes(m.state))).toBe(true);expect(a.provider.components).toHaveLength(1);
  const before=DB.prepare;DB.prepare=()=>{throw Error('private failure detail');};
  const partial=await getAdminModelStatus(env,{now:now+300001,fetcher:async()=>{throw Error('secret');}});DB.prepare=before;
  expect(partial.stale).toBe(true);expect(partial.provider.stale).toBe(true);expect(JSON.stringify(partial)).not.toMatch(/private failure|secret|prompt|user_id|r2_key/);
 }finally{DB.close();}
});

const areas=()=>import('../workers/auth/src/lib/model-availability.js');
async function areaFixture(){
 const DB=new SqliteD1Database();applyAuthMigrations(DB);
 await DB.prepare("INSERT INTO users(id,email,password_hash,created_at,role,status) VALUES('area-admin','area@example.invalid','synthetic',?,'admin','active')").bind(new Date().toISOString()).run();
 return {DB,actor:{id:'area-admin'}};
}
test('area policy covers the complete offered catalog, keeps defaults, and saves independent pairs with conflict protection',async()=>{
 const m=await areas(),{DB,actor}=await areaFixture(),env={DB};
 try {
  // Independent, reviewed public fixture plus the single designated Main model.
  // Exact identities/areas catch omissions, duplicates and substitutions that a count cannot.
  const approved=require('./fixtures/model-availability.json');
  const expected=[...Object.entries(approved.models).map(([id,flags])=>({id,areas:Object.keys(flags).sort()})),{id:'@cf/swiss-ai/apertus-v1.5-8b',areas:['main']}].sort((a,b)=>a.id.localeCompare(b.id));
  const checkCatalog=rows=>expect(rows.map(({id,areas})=>({id,areas:[...areas].sort()})).sort((a,b)=>a.id.localeCompare(b.id))).toEqual(expected);
  const catalog=m.areaCatalog();checkCatalog(catalog);
  expect(()=>checkCatalog(catalog.slice(1))).toThrow();
  expect(()=>checkCatalog([...catalog,catalog[0]])).toThrow();
  expect(()=>checkCatalog([{...catalog[0],id:'unapproved/model'},...catalog.slice(1)])).toThrow();
  expect(()=>checkCatalog(catalog.map(row=>row.id==='bytedance/seedance-2.0'?{...row,areas:['generation','canvas']}:row))).toThrow();
  const pricingBefore=(await DB.prepare('SELECT * FROM model_pricing_changes ORDER BY revision').all()).results;
  const publicBefore=await m.publicModelAvailability(env);expect(require('./fixtures/model-availability.json')).toEqual(publicBefore);expect(Object.values(publicBefore.models).every(v=>Object.values(v).every(Boolean))).toBe(true);
  const save=(area,enabled,revision,modelId='minimax/h3')=>m.changeModelAvailability(env,actor,{modelId,area,enabled,revision});
  await Promise.all([save('generation',false,0),save('canvas',false,0)]);
  await save('canvas',true,1);expect((await m.publicModelAvailability(env)).models['minimax/h3']).toEqual({generation:false,canvas:true});
  await expect(save('generation',true,0)).rejects.toMatchObject({code:'model_availability_conflict'});
  await expect(save('main',true,0)).rejects.toMatchObject({code:'model_availability_invalid'});
  await expect(m.changeModelAvailability(env,actor,{modelId:'minimax/h3',area:'generation',enabled:true,revision:1,reason:'not needed'})).rejects.toMatchObject({status:400});
  expect((await DB.prepare('SELECT * FROM model_pricing_changes ORDER BY revision').all()).results).toEqual(pricingBefore);
  expect((await m.readModelArea(env,'minimax/h3','generation')).history).toEqual([expect.objectContaining({actor:actor.id,enabled:false})]);
  expect(m.trustedModelArea(m.modelAreaEnvironment(env,'canvas'),'/api/ai/generate-video')).toBe('canvas');
  expect(m.trustedModelArea(env,'/api/ai/generate-video')).toBe('generation');expect(m.trustedModelArea(env,'/api/admin/ai/video')).toBe(null);
  await m.assertModelArea(env,'minimax/h3',null);
  await expect(m.assertModelArea(env,'minimax/h3','generation')).rejects.toMatchObject({code:'model_area_disabled'});
  await m.assertModelArea(env,'minimax/h3','generation',{attempt:{providerOutcome:'dispatched'}});
  await DB.prepare("UPDATE app_settings SET value_json='broken' WHERE key=?").bind('model_area:generation:minimax/h3').run();
  await expect(m.publicModelAvailability(env)).rejects.toMatchObject({code:'model_availability_invalid'});
 }finally{DB.close();}
});
test('area admission and atomic dispatch reject OFF races, release only undispatched holds, and retain dispatched results',async()=>{
 const m=await areas(),{DB,actor}=await areaFixture(),env={DB};
 const {claimAiDispatch,confirmAiDispatchSuccess}=await import('../workers/auth/src/lib/ai-dispatch-state.js');
 try{
  const stamp=new Date().toISOString(),expires=new Date(Date.now()+3600000).toISOString(),key='model_area:generation:minimax/h3';
  const insert=id=>DB.prepare(`INSERT INTO member_ai_usage_attempts_v2(id,user_id,feature_key,operation_key,route,idempotency_key,request_fingerprint,credit_cost,status,provider_status,provider_outcome,billing_status,created_at,updated_at,expires_at,metadata_json)
   VALUES(?,'area-admin','ai.video','member.video','/api/ai/generate-video',?,'fixture',100,'reserved','not_started','not_dispatched','reserved',?,?,?,?)`).bind(id,id,stamp,stamp,expires,JSON.stringify({model_area:{key}})).run();
  await insert('queued');await insert('running');const token=await claimAiDispatch(env,'member_ai_usage_attempts_v2','running',{availabilityKey:key});
  await m.changeModelAvailability(env,actor,{modelId:'minimax/h3',area:'generation',enabled:false,revision:0});
  await expect(insert('race')).rejects.toThrow(/model_area_disabled/);
  await expect(claimAiDispatch(env,'member_ai_usage_attempts_v2','queued',{availabilityKey:key})).rejects.toMatchObject({code:'model_area_disabled'});
  expect(await DB.prepare("SELECT provider_outcome,billing_status FROM member_ai_usage_attempts_v2 WHERE id='queued'").first()).toEqual({provider_outcome:'not_dispatched',billing_status:'released'});
  await confirmAiDispatchSuccess(env,'member_ai_usage_attempts_v2','running',{dispatchToken:token});
  expect(await DB.prepare("SELECT provider_outcome,billing_status FROM member_ai_usage_attempts_v2 WHERE id='running'").first()).toEqual({provider_outcome:'succeeded',billing_status:'reserved'});
  expect(await DB.prepare("SELECT COUNT(*) AS count FROM member_ai_usage_attempts_v2").first()).toEqual({count:2});
 }finally{DB.close();}
});
test('Main uses the existing durable control, stays off without approvals, and can enable without a contradictory deployment flag',async()=>{
 const m=await areas(),{harness}=await import('./helpers/website-assistant-fixture.mjs'),{testAssistantPolicy}=await import('./helpers/website-assistant-policy.mjs');
 const {knowledgeVersion}=await import('../workers/shared/website-assistant-knowledge.mjs');
 const {callAssistantControl}=await import('../workers/auth/src/lib/website-assistant-control.js');
 const h=harness(),env={...h.env,WEBSITE_ASSISTANT_ENABLED:'false',AI:{run:()=>{throw Error('No inference authorized');}}};
 const body={modelId:'@cf/swiss-ai/apertus-v1.5-8b',area:'main',enabled:true,revision:0},actor={id:'area-admin'};
 await expect(m.changeModelAvailability(env,actor,body)).rejects.toMatchObject({code:'assistant_activation_blocked'});
 expect((await callAssistantControl(env)).control.settings.mode).toBe('off');
 const policy=testAssistantPolicy(knowledgeVersion);await m.changeModelAvailability(env,actor,body,{policy});
 expect((await callAssistantControl(env)).control.settings.mode).toBe('public');
 await m.changeModelAvailability(env,actor,{...body,enabled:false,revision:1},{policy});
 expect((await callAssistantControl(env)).control.settings.mode).toBe('admin');
 expect((await callAssistantControl(env)).usage.daily.requests).toBe(0);
});
test('Admin Canvas obeys area admission and atomic dispatch while independent Admin Lab stays available',async()=>{
 const m=await areas(),{DB,actor}=await areaFixture(),env={DB},canvas=m.modelAreaEnvironment(env,'canvas');
 const a=await import('../workers/auth/src/lib/admin-ai-idempotency.js'),modelId='@cf/meta/llama-3.1-8b-instruct-fast';
 const begin=(scope,key)=>a.beginAdminAiIdempotencyAttempt({env:scope,operationKey:'admin.text.test',route:'/api/admin/ai/test-text',adminUserId:actor.id,idempotencyKey:key,requestFingerprint:key,modelKey:modelId,budgetScope:'admin_ai_lab',budgetPolicy:{estimated_cost_units:1}});
 try{
  const pending=await begin(canvas,'pending');
  await m.changeModelAvailability(env,actor,{modelId,area:'canvas',enabled:false,revision:0});
  await expect(begin(canvas,'new')).rejects.toMatchObject({code:'model_area_disabled'});
  await expect(a.markAdminAiIdempotencyProviderRunning(canvas,pending.attempt.id)).rejects.toMatchObject({code:'model_area_disabled'});
  const lab=await begin(env,'independent-lab');expect(lab.kind).toBe('created');
  expect(await DB.prepare('SELECT SUM(platform_exposure_units) AS units FROM admin_ai_usage_attempts_v2').first()).toEqual({units:0});
 }finally{DB.close();}
});
