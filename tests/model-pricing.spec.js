const {test,expect}=require('@playwright/test');
const {SqliteD1Database,applyAuthMigrations}=require('./helpers/sqlite-d1');
const load=async()=>({...await import('../js/shared/model-tariff.mjs'),...await import('../js/shared/model-pricing-catalog.mjs'),...await import('../workers/auth/src/lib/model-tariffs.js')});
test('model pricing preserves all factory defaults, canonical registry membership and immutable migration baseline',async()=>{
 const m=await load(),DB=new SqliteD1Database();applyAuthMigrations(DB);
 try{const catalog=m.modelPricingCatalog();expect(new Set(catalog.map(v=>v.id)).size).toBe(catalog.length);
 const snapshot=JSON.parse((await DB.prepare("SELECT baseline_json FROM model_pricing_factory WHERE configuration_key='@catalog'").first()).baseline_json);
 expect(snapshot).toEqual({version:m.FACTORY_TARIFF_VERSION,models:catalog.map(v=>({id:v.id,enabled:v.enabled,controls:m.modelPricingControls(v),...m.modelFactoryPrice(v.id)}))});
 for(const model of catalog){const {price,basis}=m.modelFactoryPrice(model.id);expect(m.applyModelTariff(price,{revision:0,rules:{}},basis).credits).toBe(price.credits);}
 expect(m.canonicalPricingModel('black-forest-labs/flux-2-klein-9b')).toBe('@cf/black-forest-labs/flux-2-klein-9b');
 }finally{DB.close();}
});
test('model pricing exact configuration and quantity rates preserve rounding, references, duration and quality boundaries',async()=>{
 const m=await load();
 for(const [model,settings,units]of [['minimax/h3',{resolution:'768P',duration:5},{second:5}],['xai/grok-imagine-image-2.0',{quality:'low',resolution:'2k',referenceImageCount:2},{image:1,referenceImage:2}],['openai/gpt-image-2',{quality:'high',size:'1024x1536',referenceImageCount:2},{image:1,referenceImage:2}],['minimax/music-2.6',{separateLyricsGeneration:true},{request:1}]]){
  const {price,basis}=m.modelFactoryPrice(model,settings);expect(basis.units).toEqual(units);
  const rates=Object.fromEntries(Object.keys(units).map(key=>[key,1.1])),key=m.tariffKey(model,basis.configuration),snapshot={revision:7,rules:{[key]:{rates}}};
  expect(m.applyModelTariff(price,snapshot,basis).credits).toBe(Math.ceil(Object.values(units).reduce((a,b)=>a+b,0)*1.1));
  expect(m.applyModelTariff(price,snapshot,{...basis,configuration:{...basis.configuration,quality:'unrelated'}}).credits).toBe(price.credits);
 }
 expect(()=>m.validateTariffRates({second:-1},['second'])).toThrow();expect(()=>m.validateTariffRates({second:0},['second'])).toThrow();
 expect(()=>m.validateTariffRates({second:1,unknown:1},['second'])).toThrow();
 const h3=m.modelPricingCatalog().find(v=>v.id==='minimax/h3');for(const settings of [{resolution:'1080P'},{duration:3},{duration:5.5},{prompt:'not a tariff dimension'},{operation:'extend'}])expect(()=>m.validateModelPricingSettings(h3,settings)).toThrow();
});
test('model pricing pins factory output settlement and custom rates independent of later tariff or provider changes',async()=>{
 const m=await load(),DB=new SqliteD1Database();applyAuthMigrations(DB);const env={DB};
 try{const pinned=await m.pinModelTariff(env,{modelId:'minimax/h3',input:{duration:5,resolution:'768P'},credits:262});
 expect(m.settlePinnedModelTariff(pinned,9999,{second:4})).toBe(210);
 expect(()=>m.settlePinnedModelTariff(pinned,9999,{second:6})).toThrow();
 const custom={...pinned,credits:37,tariff:{...pinned.tariff,rates:{second:7.25}}};expect(m.settlePinnedModelTariff(custom,9999,{second:4})).toBe(29);
 expect((await m.pinModelTariff(env,{modelId:'minimax/h3',credits:9999,existing:{creditCost:37,metadata:{model_tariff:custom}}}))).toEqual(custom);
 expect((await m.pinModelTariff(env,{modelId:'minimax/h3',credits:9999,existing:{creditCost:17,metadata:{}}})).credits).toBe(17);
 }finally{DB.close();}
});
test('model pricing persistence is compare-and-swap, rejects capability bypass and never changes provider economics',async()=>{
 const m=await load(),DB=new SqliteD1Database();applyAuthMigrations(DB);const env={DB},input={revision:0,action:'save',modelId:'minimax/h3',settings:{resolution:'768P',duration:5},rates:{second:7.25}};
 try{await m.changeModelTariff(env,{id:'synthetic-admin'},input);
 await expect(m.changeModelTariff(env,{id:'synthetic-admin'},input)).rejects.toMatchObject({code:'model_pricing_conflict'});
 const quote=await m.quoteModelTariff(env,{modelId:input.modelId,input:input.settings});expect(quote.credits).toBe(37);expect(quote.providerCostUsd).toBe(.4);
 expect((await m.quoteModelTariff(env,{modelId:input.modelId,input:{resolution:'2K',duration:5}})).credits).toBe(426);
 const {buildAdminVideoJobBudgetPolicyContext}=await import('../workers/auth/src/lib/ai-video-jobs.js');
 const admin=await buildAdminVideoJobBudgetPolicyContext({env,request:new Request('https://bitbi.ai/api/admin/ai/video-jobs',{headers:{'X-Bitbi-Tariff-Revision':'1'}}),adminUser:{id:'synthetic-admin',role:'admin'},modelId:input.modelId,payload:{...input.settings,model:input.modelId},createdAt:new Date().toISOString()});
 expect(admin.summary.estimated_credits).toBe(37);expect(admin.summary.estimated_cost_units).toBe(262);expect(admin.summary.model_tariff.tariff.revision).toBe(1);
 await expect(m.changeModelTariff(env,{id:'synthetic-admin'},{...input,revision:1,rates:{second:1000000}})).rejects.toThrow(/credit limit/);
 const {providerPriceEvidence}=await import('../workers/auth/src/lib/model-provider-prices.js');expect(providerPriceEvidence(m.modelPricingCatalog().find(v=>v.id===input.modelId),null,Date.parse('2026-11-21')).status).toBe('stale');
 await m.changeModelTariff(env,{id:'synthetic-admin'},{...input,revision:1,action:'reset_model'});
 expect((await m.quoteModelTariff(env,{modelId:input.modelId,input:input.settings})).credits).toBe(262);
 expect((await DB.prepare('SELECT COUNT(*) AS n FROM model_pricing_changes').first()).n).toBe(2);
 expect((await DB.prepare('SELECT COUNT(*) AS n FROM model_pricing_factory').first()).n).toBe(2);
 }finally{DB.close();}
});
