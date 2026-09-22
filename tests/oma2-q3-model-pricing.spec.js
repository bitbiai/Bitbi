const {test,expect}=require('@playwright/test');
const path=require('node:path');
const {SqliteD1Database,applyAuthMigrations}=require('./helpers/sqlite-d1');
async function setup(page,baseURL,{gate=0}={}){
 const DB=new SqliteD1Database();applyAuthMigrations(DB);
 const catalog=await import('../js/shared/model-pricing-catalog.mjs'),tariff=await import('../workers/auth/src/lib/model-tariffs.js'),math=await import('../js/shared/model-tariff.mjs');
 const env={DB}, calls=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 const project={id:'a'.repeat(32),title:'Pricing fixture',locale:'en'},node={id:'b'.repeat(32),project_id:project.id,type:'video_generation',title:'H3 pricing',model_id:'minimax/h3',x:80,y:80,config:{prompt:'A synthetic scene',duration:5,resolution:'768P',aspectRatio:'16:9'},content:{},output:null};
 const canvasModels=(await import('../js/shared/canvas-model-contract.mjs')).listCanvasModelsForRole('admin');
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
   else if(url.pathname==='/api/account/canvas/projects')data={ok:true,data:{projects:[project]}};
   else if(url.pathname==='/api/account/canvas/models')data={ok:true,data:{models:canvasModels,organizations:[],access:{role:'admin',is_admin:true}}};
   else if(url.pathname===`/api/account/canvas/projects/${project.id}`)data={ok:true,data:{project,nodes:[node],edges:[],runs:[]}};
   else if(url.pathname===`/api/account/canvas/projects/${project.id}/nodes/${node.id}/run`)data={ok:true,data:{run:{id:'c'.repeat(32),node_id:node.id,status:'succeeded',output:null}}};
   else if(url.pathname.startsWith('/api/account/credits-dashboard'))data={ok:true,data:{dashboard:{balance:{totalCredits:1000}}}};
   else if(url.pathname==='/api/admin/ai/model-pricing'&&req.method()==='GET')data={ok:true,...await response()};
   else if(url.pathname==='/api/admin/ai/model-pricing'&&req.method()==='PATCH')data={ok:true,...await tariff.changeModelTariff(env,user,req.postDataJSON())};
   else if(url.pathname==='/api/admin/ai/model-pricing/quote'){const {modelId,settings}=req.postDataJSON();data={ok:true,price:await tariff.quoteModelTariff(env,{modelId,input:settings})};}
   return route.fulfill({json:data});
  }catch(e){return route.fulfill({status:e.status||400,json:{ok:false,code:e.code,error:e.message}});}
 });
 return {calls,errors,DB,tariff,env,project,node};
}
const root=page=>page.locator('#sectionModelPricing');
async function open(page){await page.goto('/admin/index.html#model-pricing');await expect(root(page).locator('.model-pricing__row').first()).toBeVisible();}
async function pricingLifecycle(page){
 const catalog=await import('../js/shared/model-pricing-catalog.mjs'),math=await import('../js/shared/model-tariff.mjs');
 const {basis}=catalog.modelFactoryPrice('minimax/h3',{duration:5,resolution:'768P'});
 const snapshot={revision:1,rules:{[math.tariffKey('minimax/h3',basis.configuration)]:{rates:{second:9}}}};
 await page.route('**/pricing-lifecycle.html',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><title>Controlled pricing lifecycle</title></html>'}));
 for(const order of ['me-first','pricing-first']){
  await page.goto('/pricing-lifecycle.html');
  const observed=await page.evaluate(async({snapshot,order})=>{
   const original=window.fetch,requests=[];
   window.fetch=(input,options={})=>{
    const path=new URL(input,location.href).pathname;
    if(!['/api/me','/api/model-pricing'].includes(path))return original(input,options);
    // Deliberately allow late transport responses after abort: the client must
    // fence them itself. Every release below is explicit, with no timer/retry.
    return new Promise(resolve=>requests.push({path,signal:options.signal,respond:resolve,resolve:(body,status=200)=>resolve(new Response(JSON.stringify(body),{status}))}));
   };
   const client=await import('/js/shared/model-pricing-client.js'),auth=await import('/js/shared/auth-state.js'),math=await import('/js/shared/model-tariff.mjs');
   const {calculateAiVideoCreditCost}=await import('/js/shared/ai-model-pricing.mjs');
   const facts=()=>({credits:calculateAiVideoCreditCost('minimax/h3',{duration:5,resolution:'768P'}).credits,revision:client.modelPricingRequestHeaders()['X-Bitbi-Tariff-Revision'],snapshot:math.getBrowserTariff()?.revision??null});
   const priceRequests=()=>requests.filter(r=>r.path==='/api/model-pricing');
   const user={id:'lifecycle-user',role:'user',credits:100};
   const me=auth.initAuth(),waiting=client.refreshModelPricing().then(facts),first=priceRequests()[0];
   if(order==='pricing-first'){first.resolve(snapshot);await waiting;}
   requests.find(r=>r.path==='/api/me').resolve({loggedIn:true,user});await me;
   const current=client.refreshModelPricing();first.resolve(snapshot);priceRequests().at(-1).resolve(snapshot);
   await current;const initial=await waiting;
   const pending=client.refreshModelPricing(),request=priceRequests().at(-1),count=priceRequests().length;
   auth.patchAuthUser({credits:90,displayName:'Updated profile'});
   const duringUpdate={...facts(),requests:priceRequests().length-count,aborted:request.signal.aborted};
   const sameMe=auth.initAuth();requests.filter(r=>r.path==='/api/me').at(-1).resolve({loggedIn:true,user:{...user,credits:80}});await sameMe;
   request.resolve(snapshot);priceRequests().at(-1).resolve(snapshot);await client.refreshModelPricing();await pending;
   const afterUpdate=facts();
   const superseded=client.refreshModelPricing().then(facts),old=priceRequests().at(-1);
   const otherMe=auth.initAuth();requests.filter(r=>r.path==='/api/me').at(-1).resolve({loggedIn:true,user:{id:'other-user',role:'user'}});await otherMe;
   old.resolve({...snapshot,revision:99});const replacement=client.refreshModelPricing();priceRequests().at(-1).resolve(snapshot);await replacement;
   const afterSwitch=await superseded;
   const stale=client.refreshModelPricing();priceRequests().at(-1).resolve({revision:0,rules:{}});await stale;const afterStale=facts();
   const unavailable=client.refreshModelPricing();priceRequests().at(-1).resolve({},503);await unavailable;const afterNetwork=facts();
   const denied=[];
   for(const status of [401,403,428]){
    const deniedWait=client.refreshModelPricing();priceRequests().at(-1).resolve({},status);await deniedWait;denied.push(facts());
    const revalidate=auth.initAuth();requests.filter(r=>r.path==='/api/me').at(-1).resolve({loggedIn:true,user:{id:'other-user',role:'user'}});await revalidate;
    const restored=client.refreshModelPricing();priceRequests().at(-1).resolve(snapshot);await restored;
   }
   const logoutWait=client.refreshModelPricing(),late=priceRequests().at(-1);
   client.modelPricingSession('/logout',{ok:true},{});late.resolve({...snapshot,revision:99});await logoutWait;
   const afterLogout={...facts(),aborted:late.signal.aborted};
   // Logout clears the previous session; a NEW public retail read still works.
   const guestRead=client.refreshModelPricing();priceRequests().at(-1).resolve(snapshot);await guestRead;const afterGuestRead=facts();
   const relogin=auth.initAuth();requests.filter(r=>r.path==='/api/me').at(-1).resolve({loggedIn:true,user});await relogin;
   const accepted=client.refreshModelPricing();priceRequests().at(-1).resolve(snapshot);await accepted;
   let bodyReady,finishBody;const bodyStarted=new Promise(resolve=>{bodyReady=resolve;});
   const lateBody=client.refreshModelPricing();priceRequests().at(-1).respond({ok:true,status:200,json:()=>{bodyReady();return new Promise(resolve=>{finishBody=resolve;});}});
   await bodyStarted;client.modelPricingSession('/logout',{ok:true},{});finishBody({...snapshot,revision:99});await lateBody;
   const afterLateBody=facts();
   const noLateMe=auth.initAuth();requests.filter(r=>r.path==='/api/me').at(-1).resolve({loggedIn:false,user:null});await noLateMe;
   client.modelPricingSession('/admin/me',{ok:false,status:403},{ok:false});
   const afterDenial=facts();window.fetch=original;
   return {initial,duringUpdate,afterUpdate,afterSwitch,afterStale,afterNetwork,denied,afterLogout,afterGuestRead,afterLateBody,afterDenial};
  },{snapshot,order});
  const ready={credits:45,revision:'1',snapshot:1};
  expect(observed.initial,order).toEqual(ready);
  expect(observed.duringUpdate,order).toEqual({...ready,requests:0,aborted:false});
  expect(observed.afterUpdate,order).toEqual(ready);expect(observed.afterSwitch,order).toEqual(ready);
  expect(observed.afterStale,order).toEqual(ready);expect(observed.afterNetwork,order).toEqual(ready);
  for(const denied of observed.denied)expect(denied,order).toMatchObject({revision:'0',snapshot:null});
  expect(observed.afterLogout,order).toMatchObject({revision:'0',snapshot:null,aborted:true});
  expect(observed.afterGuestRead,order).toEqual(ready);
  expect(observed.afterLateBody,order).toMatchObject({revision:'0',snapshot:null});
  expect(observed.afterDenial,order).toMatchObject({revision:'0',snapshot:null});
 }
}
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
for(const [locale,width]of [['en',1440],['de',390]])test(`GPT Image 2.5 pricing dimensions and reference tariff guard ${locale}`,async({page,baseURL},info)=>{
 const f=await setup(page,baseURL);await page.setViewportSize({width,height:900});
 try{await open(page);if(locale==='de')await root(page).getByLabel('Pricing language').selectOption('de');
  for(const suffix of ['sunburst','flare']){
   await root(page).getByRole('searchbox').fill(`gpt-image-2.5-${suffix}`);const row=root(page).locator('.model-pricing__row');await expect(row).toHaveCount(1);
   await expect(row).toContainText(locale==='de'?'Werkspreis':'Factory');await row.focus();await page.keyboard.press('Enter');
   const dialog=page.getByRole('dialog',{name:`GPT Image 2.5 ${suffix==='sunburst'?'Sunburst':'Flare'}`,exact:true});await expect(dialog).toBeVisible();
   const options={quality:['low','medium','high','xhigh','max','auto'],size:['1024x1024','1024x1536','1536x1024','auto'],background:['transparent','opaque','auto'],outputFormat:['png','webp','jpeg']};
   for(const [name,values]of Object.entries(options))expect(await dialog.locator(`[name=${name}] option`).evaluateAll(nodes=>nodes.map(node=>node.value))).toEqual(values);
   await dialog.locator('[name=quality]').selectOption('max');await dialog.locator('[name=size]').selectOption('auto');await dialog.locator('[name=background]').selectOption('transparent');await dialog.locator('[name=outputFormat]').selectOption('webp');
   await dialog.locator('[name=referenceImageCount]').fill('16');await dialog.locator('[name=referenceImageCount]').press('Tab');await expect(dialog.locator('[name=operation]')).toHaveValue('edit');
   await expect(dialog.getByRole('status')).toContainText('reference editing pricing is unavailable');
   expect(f.calls.filter(call=>call.path.endsWith('/model-pricing/quote')).at(-1).body).toMatchObject({modelId:`openai/gpt-image-2.5-${suffix}`,settings:{quality:'max',size:'auto',background:'transparent',outputFormat:'webp',operation:'edit',referenceImageCount:16}});
   await expect(dialog.getByRole('button',{name:locale==='de'?'Tarif speichern':'Save tariff',exact:true})).toBeDisabled();
   await dialog.locator('[name=outputFormat]').selectOption('jpeg');await expect(dialog.getByRole('status')).toContainText('Transparent background requires PNG or WebP');
   await dialog.locator('[name=outputFormat]').selectOption('png');await dialog.locator('[name=operation]').selectOption('generate');await expect(dialog.locator('[name=referenceImageCount]')).toHaveValue('0');
   await expect(dialog.locator('[role=status]')).toHaveText('');
   for(const theme of ['dark','light','soft']){
    await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);await expect(dialog.locator('[name=background]')).toBeVisible();
    expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    if(suffix==='flare')await page.screenshot({path:path.join(info.outputDir,`${locale}-${width}-gpt25-${theme}.png`)});
   }
   if(suffix==='sunburst'){
    await expect(dialog.locator('.model-pricing__rates input')).toHaveCount(2);
    await dialog.locator('.model-pricing__rates input').nth(0).fill('7.25');await dialog.locator('.model-pricing__rates input').nth(1).fill('2.5');
    await expect(dialog.locator('.model-pricing__preview')).toContainText('8');
    await dialog.getByRole('button',{name:locale==='de'?'Tarif speichern':'Save tariff',exact:true}).click();await expect(dialog).toHaveCount(0);
    await row.click();const reopened=page.getByRole('dialog',{name:'GPT Image 2.5 Sunburst',exact:true});
    await reopened.getByLabel(locale==='de'?'Individuelle Konfigurationen':'Custom configurations').selectOption('0');
    await expect(reopened.locator('[name=background]')).toHaveValue('transparent');await expect(reopened.locator('[name=outputFormat]')).toHaveValue('png');
    await expect(reopened.locator('.model-pricing__breakdown')).toContainText('8');
    await reopened.getByRole('button',{name:locale==='de'?'Konfiguration zurücksetzen':'Reset configuration',exact:true}).click();await expect(reopened).toHaveCount(0);
   }else await dialog.getByRole('button',{name:locale==='de'?'Abbrechen':'Cancel',exact:true}).click();
  }
  expect(f.calls.filter(call=>call.method==='PATCH')).toHaveLength(2);expect(f.errors).toEqual([]);
 }finally{f.DB.close();}
});
test('pricing conflict preserves editor; a new retail snapshot refreshes existing cross-surface estimators and request revision',async({page,baseURL})=>{
 const f=await setup(page,baseURL);try{
 await pricingLifecycle(page);
 await open(page);await root(page).getByRole('searchbox').fill('MiniMax H3');await root(page).locator('.model-pricing__row').click();const dialog=page.getByRole('dialog',{name:'MiniMax H3',exact:true});await expect(dialog.locator('.model-pricing__breakdown')).toContainText('262');await dialog.locator('input[step="0.00000001"]').fill('7.25');
 await f.tariff.changeModelTariff(f.env,{id:'other-admin'},{revision:0,action:'save',modelId:'minimax/h3',settings:{duration:5,resolution:'768P'},rates:{second:9}});
 await dialog.getByRole('button',{name:'Save tariff',exact:true}).click();await expect(dialog).toBeVisible();await expect(dialog.getByRole('status')).toContainText('Another administrator');
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
 for(const route of ['/','/de/','/generate-lab/','/de/generate-lab/','/canvas/','/de/canvas/','/admin/index.html#ai-lab']){
  await page.goto(route);const result=await page.evaluate(async()=>{const client=await import('/js/shared/model-pricing-client.js');await client.refreshModelPricing();const {calculateAiVideoCreditCost}=await import('/js/shared/ai-model-pricing.mjs');return {credits:calculateAiVideoCreditCost('minimax/h3',{duration:5,resolution:'768P'}).credits,headers:client.modelPricingRequestHeaders()};});
  expect(result.credits,route).toBe(45);expect(result.headers['X-Bitbi-Tariff-Revision'],route).toBe('1');
  if(route.includes('/generate-lab/')){await page.locator('[data-media-type=video]').click();await page.locator('[data-model-id="minimax/h3"]').click();await expect(page.locator('#labCost')).toContainText('45');await page.locator('#labVideoDuration').selectOption('6');await expect(page.locator('#labCost')).toContainText('54');}
  if(route==='/generate-lab/'){await page.evaluate(async()=>{const api=await import('/js/shared/auth-api.js');return api.apiAiGenerateVideo({model:'minimax/h3',duration:5,resolution:'768P'});});expect(f.calls.find(c=>c.path==='/api/ai/generate-video').revision).toBe('1');}
  if(route==='/canvas/'||route==='/de/canvas/'){
   await page.locator(`.canvas-node[data-node-id="${f.node.id}"]`).click();
   await expect(page.locator('#canvasInspectorBody .canvas-cost-note')).toHaveText(route.startsWith('/de/')?'Geschätzte Credits: 45':'Estimated credits: 45');
   const before=f.calls.filter(c=>c.path.endsWith(`/${f.node.id}/run`)).length;
   await page.locator('#canvasInspectorBody').getByRole('button',{name:route.startsWith('/de/')?'Ausführen':'Run',exact:true}).click();
   await expect.poll(()=>f.calls.filter(c=>c.path.endsWith(`/${f.node.id}/run`)).length).toBe(before+1);
   expect(f.calls.filter(c=>c.path.endsWith(`/${f.node.id}/run`)).at(-1)).toMatchObject({revision:'1',method:'POST',body:{}});
  }
 }
 const cleared=await page.evaluate(async()=>{const client=await import('/js/shared/model-pricing-client.js'),math=await import('/js/shared/model-tariff.mjs');await client.refreshModelPricing();const original=window.fetch;let finish;window.fetch=()=>new Promise(resolve=>{finish=resolve;});try{const pending=client.refreshModelPricing();client.modelPricingSession('/logout',{ok:true},{});finish(new Response(JSON.stringify({revision:99,rules:{private:{modelId:'private-admin'}}}),{status:200}));await pending;return math.getBrowserTariff();}finally{window.fetch=original;}});expect(cleared).toBe(null);
 }finally{f.DB.close();}
});
