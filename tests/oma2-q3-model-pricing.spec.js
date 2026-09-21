const {test,expect}=require('@playwright/test');
const path=require('node:path');
const {SqliteD1Database,applyAuthMigrations}=require('./helpers/sqlite-d1');
async function setup(page,baseURL,{gate=0}={}){
 const DB=new SqliteD1Database();applyAuthMigrations(DB);
 const catalog=await import('../js/shared/model-pricing-catalog.mjs'),tariff=await import('../workers/auth/src/lib/model-tariffs.js'),math=await import('../js/shared/model-tariff.mjs');
 const env={DB}, calls=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('bitbi_cookie_consent',JSON.stringify({v:'1',ts:Date.now(),necessary:true,analytics:false,marketing:false})));
 const evidence=await import('../workers/auth/src/lib/model-provider-prices.js');
 const response=async()=>{const state=await tariff.getModelTariff(env);return {...state,models:catalog.modelPricingCatalog().map(model=>{const {price,basis}=catalog.modelFactoryPrice(model.id);return{...model,pricingControls:catalog.modelPricingControls(model),factory:price,providerEvidence:evidence.providerPriceEvidence(model,price),effective:math.applyModelTariff(price,state,basis),basis};})};};
 await page.context().route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());if(url.origin!==new URL(baseURL).origin)return route.abort();if(!url.pathname.startsWith('/api/'))return route.continue();
  calls.push({path:url.pathname,method:req.method(),body:req.postDataJSON(),revision:req.headers()['x-bitbi-tariff-revision']});
  const user=gate===401?null:{id:'pricing-admin',email:'pricing@example.invalid',role:gate===403?'user':'admin'};
  try{
   let data={ok:true,stats:{}};
   if(url.pathname==='/api/me')data={loggedIn:!!user,user};
   else if(url.pathname==='/api/admin/me')return route.fulfill({status:gate||200,json:{ok:!gate,user}});
   else if(url.pathname==='/api/model-pricing')data={ok:true,...await tariff.getModelTariff(env)};
   else if(url.pathname==='/api/admin/ai/model-pricing'&&req.method()==='GET')data={ok:true,...await response()};
   else if(url.pathname==='/api/admin/ai/model-pricing'&&req.method()==='PATCH')data={ok:true,...await tariff.changeModelTariff(env,user,req.postDataJSON())};
   else if(url.pathname==='/api/admin/ai/model-pricing/quote'){const {modelId,settings}=req.postDataJSON();data={ok:true,price:await tariff.quoteModelTariff(env,{modelId,input:settings})};}
   return route.fulfill({json:data});
  }catch(e){return route.fulfill({status:e.status||400,json:{ok:false,code:e.code,error:e.message}});}
 });
 return {calls,errors,DB,tariff,env};
}
const root=page=>page.locator('#sectionModelPricing');
async function open(page){await page.goto('/admin/index.html#model-pricing');await expect(root(page).locator('.model-pricing__row').first()).toBeVisible();}
for(const [locale,width]of [['en',1440],['de',390]])test.describe(`${locale} pricing controls`,()=>{
 test.use({hasTouch:width<500});
 test('Admin exact configuration preview, cancel, save, reload and reset with keyboard/touch',async({page,baseURL},info)=>{
  await page.setViewportSize({width,height:900});const f=await setup(page,baseURL);
  try{await open(page);if(locale==='de')await root(page).getByLabel('Pricing language').selectOption('de');
  const search=root(page).getByRole('searchbox');await search.fill('MiniMax H3');const row=root(page).locator('.model-pricing__row');await expect(row).toHaveCount(1);
  if(width<500)await row.tap();else{await row.focus();await page.keyboard.press('Enter');}
  const dialog=page.getByRole('dialog',{name:'MiniMax H3',exact:true});await expect(dialog.locator('.model-pricing__breakdown')).toContainText('262');
  await dialog.locator('input[step="0.00000001"]').fill('7.25');await expect(dialog.locator('.model-pricing__preview')).toContainText('37');
  await dialog.getByRole('button',{name:locale==='de'?'Abbrechen':'Cancel',exact:true}).click();await expect(dialog).toHaveCount(0);expect(f.calls.filter(c=>c.method==='PATCH')).toHaveLength(0);
  await row.click();await expect(dialog.locator('.model-pricing__breakdown')).toContainText('262');await dialog.locator('input[step="0.00000001"]').fill('7.25');
  await dialog.getByRole('button',{name:locale==='de'?'Tarif speichern':'Save tariff',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(row).toContainText('37');
  expect(f.calls.filter(c=>c.method==='PATCH')[0].body).toMatchObject({revision:0,action:'save',modelId:'minimax/h3',settings:{resolution:'768P'},rates:{second:7.25}});
  await page.reload();await expect(root(page).locator('.model-pricing__row').first()).toBeVisible();if(locale==='de')await root(page).getByLabel('Pricing language').selectOption('de');
  await root(page).getByRole('searchbox').fill('MiniMax H3');await root(page).locator('.model-pricing__row').click();await expect(dialog.locator('.model-pricing__breakdown')).toContainText('37');
  await dialog.locator('[name=resolution]').selectOption('2K');await expect(dialog.locator('.model-pricing__breakdown')).toContainText('426');await expect(dialog.locator('.model-pricing__breakdown')).not.toContainText('37');
  await dialog.locator('[name=resolution]').selectOption('768P');await expect(dialog.locator('.model-pricing__breakdown')).toContainText('37');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:path.join(info.outputDir,`${locale}-${width}-pricing.png`)});
  await dialog.getByRole('button',{name:locale==='de'?'Konfiguration zurücksetzen':'Reset configuration',exact:true}).click();await expect(dialog).toHaveCount(0);
  await expect(root(page).locator('.model-pricing__row')).toContainText('262');expect(f.errors).toEqual([]);
  await page.screenshot({path:path.join(info.outputDir,`${locale}-${width}-overview.png`)});
  expect(f.calls.every(c=>!/(generate|video-jobs|\/run)$/.test(c.path))).toBe(true);
  }finally{f.DB.close();}
 });
});
for(const gate of [401,403,428])test(`pricing ${gate} denial never loads protected economics`,async({page,baseURL})=>{
 const f=await setup(page,baseURL,{gate});try{await page.goto('/admin/index.html#model-pricing');await expect(page.locator('#adminDenied')).toBeVisible();expect(f.calls.some(c=>c.path==='/api/admin/ai/model-pricing')).toBe(false);expect(f.errors).toEqual([]);}finally{f.DB.close();}
});
test('pricing conflict preserves editor; a new retail snapshot refreshes existing cross-surface estimators and request revision',async({page,baseURL})=>{
 const f=await setup(page,baseURL);try{
 await open(page);await root(page).getByRole('searchbox').fill('MiniMax H3');await root(page).locator('.model-pricing__row').click();const dialog=page.getByRole('dialog',{name:'MiniMax H3',exact:true});await expect(dialog.locator('.model-pricing__breakdown')).toContainText('262');await dialog.locator('input[step="0.00000001"]').fill('7.25');
 await f.tariff.changeModelTariff(f.env,{id:'other-admin'},{revision:0,action:'save',modelId:'minimax/h3',settings:{duration:5,resolution:'768P'},rates:{second:9}});
 await dialog.getByRole('button',{name:'Save tariff',exact:true}).click();await expect(dialog).toBeVisible();await expect(dialog.getByRole('status')).toContainText('Another administrator');
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
 for(const route of ['/','/de/','/generate-lab/','/de/generate-lab/','/canvas/','/de/canvas/','/admin/index.html#ai-lab']){
  await page.goto(route);const result=await page.evaluate(async()=>{const client=await import('/js/shared/model-pricing-client.js');await client.refreshModelPricing();const {calculateAiVideoCreditCost}=await import('/js/shared/ai-model-pricing.mjs');return {credits:calculateAiVideoCreditCost('minimax/h3',{duration:5,resolution:'768P'}).credits,headers:client.modelPricingRequestHeaders()};});
  expect(result.credits,route).toBe(45);expect(result.headers['X-Bitbi-Tariff-Revision'],route).toBe('1');
  if(route.includes('/generate-lab/')){await page.locator('[data-media-type=video]').click();await page.locator('[data-model-id="minimax/h3"]').click();await expect(page.locator('#labCost')).toContainText('45');await page.locator('#labVideoDuration').selectOption('6');await expect(page.locator('#labCost')).toContainText('54');}
  if(route==='/generate-lab/'){await page.evaluate(async()=>{const api=await import('/js/shared/auth-api.js');return api.apiAiGenerateVideo({model:'minimax/h3',duration:5,resolution:'768P'});});expect(f.calls.find(c=>c.path==='/api/ai/generate-video').revision).toBe('1');}
  if(route==='/canvas/'){await page.evaluate(async()=>{const {canvasApi}=await import('/js/pages/canvas/api.js');return canvasApi.runNode('synthetic-project','synthetic-node','synthetic-pricing-key');});expect(f.calls.find(c=>c.path.endsWith('/synthetic-node/run')).revision).toBe('1');}
 }
 const cleared=await page.evaluate(async()=>{const client=await import('/js/shared/model-pricing-client.js'),math=await import('/js/shared/model-tariff.mjs');await client.refreshModelPricing();const original=window.fetch;let finish;window.fetch=()=>new Promise(resolve=>{finish=resolve;});try{const pending=client.refreshModelPricing();client.modelPricingSession('/logout',{ok:true},{});finish(new Response(JSON.stringify({revision:99,rules:{private:{modelId:'private-admin'}}}),{status:200}));await pending;return math.getBrowserTariff();}finally{window.fetch=original;}});expect(cleared).toBe(null);
 }finally{f.DB.close();}
});
