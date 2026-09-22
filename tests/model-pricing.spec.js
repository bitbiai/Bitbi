const {test,expect}=require('@playwright/test');
const {SqliteD1Database,applyAuthMigrations}=require('./helpers/sqlite-d1');
const load=async()=>({...await import('../js/shared/model-tariff.mjs'),...await import('../js/shared/model-pricing-catalog.mjs'),...await import('../workers/auth/src/lib/model-tariffs.js')});
test('model pricing preserves all factory defaults, canonical registry membership and immutable migration baseline',async()=>{
 const m=await load(),DB=new SqliteD1Database();applyAuthMigrations(DB);
 try{const catalog=m.modelPricingCatalog();expect(new Set(catalog.map(v=>v.id)).size).toBe(catalog.length);
 const snapshot=JSON.parse((await DB.prepare("SELECT baseline_json FROM model_pricing_factory WHERE configuration_key='@catalog'").first()).baseline_json);
 // The migration is historical evidence. New aliases must not rewrite it or
 // reprice any of the model/configurations it originally recorded.
 const historicalIds=new Set(snapshot.models.map(v=>v.id));
 expect(snapshot).toEqual({version:m.FACTORY_TARIFF_VERSION,models:catalog.filter(v=>historicalIds.has(v.id)).map(v=>({id:v.id,enabled:v.enabled,controls:m.modelPricingControls(v),...m.modelFactoryPrice(v.id)}))});
 expect([...historicalIds].every(id=>catalog.some(v=>v.id===id))).toBe(true);
 for(const model of catalog){const {price,basis}=m.modelFactoryPrice(model.id);expect(m.applyModelTariff(price,{revision:0,rules:{}},basis).credits).toBe(price.credits);}
 expect(m.canonicalPricingModel('black-forest-labs/flux-2-klein-9b')).toBe('@cf/black-forest-labs/flux-2-klein-9b');
 }finally{DB.close();}
});

test('GPT Image 2.5 pricing covers every adapter configuration, ordered reference quantities and independent exact tariff keys',async()=>{
 const m=await load();
 const c=await import('../js/shared/gpt-image-25-contract.mjs');
 const {gptImage25FactoryPrice}=await import('../js/shared/gpt-image-25-pricing.mjs');
 const keys=new Set();
 for(const modelId of c.GPT_IMAGE_25_MODEL_IDS)for(const quality of c.GPT_IMAGE_25_QUALITY_OPTIONS)for(const size of c.GPT_IMAGE_25_SIZE_OPTIONS)for(const background of c.GPT_IMAGE_25_BACKGROUND_OPTIONS)for(const outputFormat of c.GPT_IMAGE_25_OUTPUT_FORMAT_OPTIONS){
  const settings={quality,size,background,outputFormat};
  if(background==='transparent'&&outputFormat==='jpeg'){expect(()=>gptImage25FactoryPrice(modelId,settings)).toThrow(/PNG or WebP/);continue;}
  for(const referenceImageCount of [0,1,16]){
   const factory=gptImage25FactoryPrice(modelId,{...settings,referenceImageCount});
   const basis=m.mediaTariffBasis(factory,'image');
   expect(basis).toEqual({configuration:{...settings,operation:referenceImageCount?'edit':'generate'},units:{image:1,referenceImage:referenceImageCount}});
   const key=m.tariffKey(modelId,basis.configuration);if(referenceImageCount!==16){expect(keys.has(key)).toBe(false);keys.add(key);}
   const snapshot={revision:4,rules:{[key]:{rates:{image:7.25,referenceImage:2.5}}}};
   expect(m.applyModelTariff({...factory,credits:100},snapshot,basis).credits).toBe(Math.ceil(7.25+2.5*referenceImageCount));
   const other={...basis,configuration:{...basis.configuration,outputFormat:outputFormat==='png'?'webp':'png'}};
   expect(m.applyModelTariff({...factory,credits:100},snapshot,other).credits).toBe(100);
  }
 }
 expect(keys.size).toBe(768);
 for(const modelId of c.GPT_IMAGE_25_MODEL_IDS)for(const referenceImageCount of [-1,17,1.5,'1'])expect(()=>gptImage25FactoryPrice(modelId,{referenceImageCount})).toThrow();
 expect(()=>gptImage25FactoryPrice(c.GPT_IMAGE_25_MODEL_IDS[0],{operation:'generate',referenceImageCount:1})).toThrow();
 expect(()=>gptImage25FactoryPrice(c.GPT_IMAGE_25_MODEL_IDS[0],{operation:'edit',referenceImageCount:0})).toThrow();
});

test('GPT Image 2.5 generation prices use verified bounds while reference editing cannot be enabled by retail overrides',async()=>{
 const m=await load(),DB=new SqliteD1Database();applyAuthMigrations(DB);const env={DB};
 const c=await import('../js/shared/gpt-image-25-contract.mjs'),p=await import('../js/shared/ai-model-pricing.mjs');
 try{for(const id of c.GPT_IMAGE_25_MODEL_IDS){
  const model=m.modelPricingCatalog().find(v=>v.id===id);expect(model).toBeTruthy();expect(model.enabled).toBe(true);
  const fields=m.modelPricingControls(model);for(const [key,options]of [['quality',c.GPT_IMAGE_25_QUALITY_OPTIONS],['size',c.GPT_IMAGE_25_SIZE_OPTIONS],['background',c.GPT_IMAGE_25_BACKGROUND_OPTIONS],['outputFormat',c.GPT_IMAGE_25_OUTPUT_FORMAT_OPTIONS],['operation',['generate','edit']]])expect(fields.find(v=>v.key===key).options).toEqual(options);
  expect(fields.find(v=>v.key==='referenceImageCount')).toMatchObject({min:0,max:16});
  expect(()=>m.validateModelPricingSettings(model,{background:'transparent',outputFormat:'jpeg'})).toThrow();
  expect(()=>m.validateModelPricingSettings(model,{quality:'ultra'})).toThrow();
  expect(()=>m.validateModelPricingSettings(model,{inputToken:0})).toThrow();
  const {price}=m.modelFactoryPrice(id,{referenceImageCount:1});expect(price.credits).toBe(null);expect(price.providerCostUsd).toBe(null);
  expect(price.formula).toMatchObject({providerRatesUsdPerMillionTokens:{inputToken:5,cachedInputToken:1.25,inputImageToken:8,cachedInputImageToken:3,outputImageToken:30},fundingMultiplier:1.05,rateEvidenceStatus:'verified',quantityEvidenceStatus:'input_images_not_verified'});
  const {providerPriceEvidence}=await import('../workers/auth/src/lib/model-provider-prices.js');
  expect(providerPriceEvidence(model,price,Date.parse('2026-09-22'))).toMatchObject({status:'verified',sourceUrl:'https://developers.cloudflare.com/ai/models/',unit:'million_tokens',quantityEvidenceStatus:'generation_verified_reference_images_not_verified'});
  expect(p.calculateAiImageCreditCost(id,{referenceImageCount:1})).toBe(null);expect(p.isPricedAiImageModel(id)).toBe(true);
  expect(p.calculateAiImageCreditCost(id,{prompt:'x'}).credits).toBe(10);
  await expect(m.pinModelTariff(env,{modelId:id,input:{referenceImageCount:1},credits:1})).rejects.toMatchObject({code:'gpt_image_25_reference_pricing_unavailable',status:503});
  await expect(m.changeModelTariff(env,{id:'synthetic-admin'},{modelId:id,revision:0,action:'save',settings:{referenceImageCount:1},rates:{image:1,referenceImage:1}})).rejects.toThrow(/unavailable/);
 }}finally{DB.close();}
});

test('GPT Image 2.5 accepted fixed quotes never reprice from missing usage, fallback credits or later tariffs',async()=>{
 const m=await load(),c=await import('../js/shared/gpt-image-25-contract.mjs');
 for(const modelId of c.GPT_IMAGE_25_MODEL_IDS){
  const configuration={quality:'auto',size:'auto',background:'transparent',outputFormat:'webp',operation:'edit'};
  const accepted={credits:49,tariff:{revision:3,key:m.tariffKey(modelId,configuration),configuration,units:{image:1,referenceImage:16},rates:{image:9,referenceImage:2.5},source:'custom'}};
  for(const actual of [undefined,{}, {image:0,referenceImage:0}, {inputToken:0,outputToken:0}, {image:2}])expect(m.settlePinnedModelTariff(accepted,9999,actual)).toBe(49);
  expect(await m.pinModelTariff({}, {modelId,input:{},credits:9999,existing:{creditCost:49,metadata:{model_tariff:accepted}}})).toEqual(accepted);
  expect(()=>m.settlePinnedModelTariff({...accepted,credits:null},1)).toThrow(/review/);
 }
 const {price,basis}=m.modelFactoryPrice('openai/gpt-image-2',{quality:'high',size:'1024x1536',referenceImageCount:2,background:'opaque',outputFormat:'webp'});
 expect(basis.configuration).toEqual({quality:'high',size:'1024x1536',operation:'generate'});
 const key='openai/gpt-image-2:{"operation":"generate","quality":"high","size":"1024x1536"}';
 expect(m.tariffKey(price.modelId,basis.configuration)).toBe(key);
 expect(m.applyModelTariff(price,{revision:1,rules:{[key]:{rates:{image:20,referenceImage:3}}}},basis).credits).toBe(26);
});
test('GPT Image 2.5 official output token schedule, prompt byte bounds, auto maximum and funding fee remain distinct',async()=>{
 const {gptImage25FactoryPrice,gptImage25OutputTokens}=await import('../js/shared/gpt-image-25-pricing.mjs');
 const tables={low:[196,158,659],medium:[439,343,1483],high:[1756,1372,5930],xhigh:[3122,2459,10542],max:[7024,5488,23719],auto:[7024,5488,23719]};
 for(const [quality,values]of Object.entries(tables))for(const [index,size]of ['1024x1024','1024x1536','auto'].entries()){
  expect(gptImage25OutputTokens({quality,size})).toEqual({tokens:values[index],bound:quality==='auto'||size==='auto'});
  if(index===1)expect(gptImage25OutputTokens({quality,size:'1536x1024'}).tokens).toBe(values[index]);
 }
 for(const id of ['openai/gpt-image-2.5-sunburst','openai/gpt-image-2.5-flare']){
  const small=gptImage25FactoryPrice(id,{prompt:'x',quality:'low'});expect(small.inferenceCostUsd).toBe(.005885);expect(small.providerCostUsd).toBeCloseTo(.005885*1.05,12);expect(small.credits).toBe(5);
  expect(small.formula).toMatchObject({textInputTokenBound:1,promptBoundIsMaximum:false,outputImageTokens:196,outputImageTokensAreBound:false});
  const unicode=gptImage25FactoryPrice(id,{prompt:'ä🌈'});expect(unicode.formula.textInputTokenBound).toBe(6);expect(JSON.stringify(unicode)).not.toContain('ä🌈');
  const overview=gptImage25FactoryPrice(id,{quality:'auto',size:'auto'});expect(overview.formula).toMatchObject({textInputTokenBound:96000,promptBoundIsMaximum:true,outputImageTokens:23719,outputImageTokensAreBound:true});
  expect(gptImage25FactoryPrice(id,{quality:'auto',size:'auto',prompt:'界'.repeat(32000)}).credits).toBe(overview.credits);
  expect(()=>gptImage25FactoryPrice(id,{prompt:'x'.repeat(32001)})).toThrow();
 }
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
