const {test,expect}=require('@playwright/test');
const path=require('node:path');
const admin={id:'status-admin',role:'admin',email:'status@example.invalid'};
async function snapshot(){
 const {modelStatusCatalog,summarizeModelStatus}=await import('../workers/auth/src/lib/admin-model-status.js');
 const catalog=modelStatusCatalog({}),now=Date.now(),at=new Date(now-600000).toISOString();
 const video=catalog.find(m=>m.mediaTypes.includes('video')),image=catalog.find(m=>m.mediaTypes.includes('image'));
 const rows=[{id:'success',model_id:image.id,operation_key:'admin.ai.image',status:'succeeded',provider_outcome:'succeeded',completed_at:at},...['fail1','fail2'].map(id=>({id,model_id:video.id,operation_key:'admin.ai.video',status:'provider_failed',provider_outcome:'failed',error_code:'upstream_error',completed_at:at}))];
 return {observedAt:new Date(now).toISOString(),freshForSeconds:300,...summarizeModelStatus(catalog,[{name:'admin',rows}],now),sources:[{name:'member',available:true},{name:'admin',available:true}],provider:{observedAt:at,stale:false,components:[{name:'Workers AI',state:'operational'}]},coverage:{}};
}
async function setup(page,baseURL,{gate=0,handler}={}){
 await page.addInitScript(()=>localStorage.setItem('bitbi_cookie_consent',JSON.stringify({v:'1',ts:Date.now(),necessary:true,analytics:false,marketing:false})));
 const data=await snapshot(),calls=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.context().route('**/*',async route=>{
  const r=route.request(),u=new URL(r.url());if(u.origin!==new URL(baseURL).origin)return route.abort();if(!u.pathname.startsWith('/api/'))return route.continue();
  calls.push({path:u.pathname,method:r.method()});
  if(u.pathname==='/api/admin/ai/model-status'&&handler)return handler(route,data);
  const user=gate===401?null:gate===403?{...admin,role:'user'}:admin;
  const body=u.pathname==='/api/me'?{loggedIn:!!user,user}:u.pathname==='/api/admin/me'?{ok:!gate,user}:u.pathname==='/api/admin/ai/model-status'?{ok:true,data}:{ok:true,stats:{}};
  return route.fulfill({status:u.pathname==='/api/admin/me'&&gate?gate:200,contentType:'application/json',body:JSON.stringify(body)});
 });return{calls,errors,data};
}
const section=page=>page.locator('#sectionModelStatus');
const open=async page=>{await page.goto('/admin/index.html#model-status');await expect(section(page).locator('.model-status__model').first()).toBeVisible();};
for(const [locale,width]of [['en',1280],['de',390]])test.describe(`${locale} model status input context`,()=>{
 test.use({hasTouch:width<500});
 test(`${locale} model status reader desktop/mobile, filtering, keyboard/touch and safe details`,async({page,baseURL},info)=>{
 await page.setViewportSize({width,height:900});const e=await setup(page,baseURL);await open(page);
 if(locale==='de')await section(page).getByRole('button',{name:'DE',exact:true}).click();
 await expect(page.getByRole('heading',{name:locale==='de'?'Modellstatus':'Model status',exact:true,level:1})).toBeVisible();
 expect(await section(page).locator('.model-status__model').count()).toBe(e.data.models.length);
 const first=section(page).locator('summary').first();await first.focus();await page.keyboard.press('Enter');await expect(section(page).locator('.model-status__detail').first()).toBeVisible();
 const search=section(page).getByRole('searchbox');await search.fill('not-a-model');await expect(section(page).locator('.model-status__model')).toHaveCount(0);await search.fill('');
 await section(page).getByRole('combobox').first().selectOption('video');expect(await section(page).locator('.model-status__model').count()).toBe(e.data.models.filter(m=>m.mediaTypes.includes('video')).length);
 await section(page).getByRole('combobox').first().selectOption('');
 if(width<500)await section(page).locator('summary').first().tap();else await section(page).locator('summary').first().click();
 for(const c of await section(page).getByRole('combobox').all())expect((await c.boundingBox()).height).toBeGreaterThanOrEqual(44);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(process.env.MODEL_STATUS_SCREENSHOTS||info.outputDir,`${info.project.name}-${locale}-${width}.png`),fullPage:true});await page.screenshot({path:path.join(process.env.MODEL_STATUS_SCREENSHOTS||info.outputDir,`${info.project.name}-${locale}-${width}-viewport.png`)});
 await page.reload();await expect(section(page).locator('.model-status__model')).toHaveCount(e.data.models.length);
 await page.evaluate(()=>location.hash='dashboard');await expect(section(page).locator('.model-status__model')).toHaveCount(0);
 expect(e.calls.every(c=>c.method==='GET')).toBe(true);expect(e.errors).toEqual([]);
 expect(await page.evaluate(()=>JSON.stringify([localStorage,sessionStorage]).includes('model-a'))).toBe(false);
});
});
for(const gate of [401,403,428])test(`model status ${gate} admin/session/MFA denial never loads observations`,async({page,baseURL})=>{
 const e=await setup(page,baseURL,{gate});await page.goto('/admin/index.html#model-status');await expect(page.locator('#adminDenied')).toBeVisible();expect(e.calls.some(c=>c.path==='/api/admin/ai/model-status')).toBe(false);expect(e.errors).toEqual([]);
});
test('model status refresh is single-flight; errors retain stale data; authorization expiry clears private view',async({page,baseURL})=>{
 let count=0;const e=await setup(page,baseURL,{handler:async(route,data)=>{count++;await route.fulfill({status:count===2?503:count===3?403:200,contentType:'application/json',body:JSON.stringify(count===1?{ok:true,data}:{ok:false})});}});
 await open(page);await section(page).getByRole('button',{name:'Refresh',exact:true}).click();await expect(section(page).getByRole('status')).toContainText('not current');await expect(section(page).locator('.model-status__badge.is-successful')).toHaveCount(0);
 await expect(section(page).locator('.model-status__model')).toHaveCount(e.data.models.length);
 await section(page).getByRole('button',{name:'Refresh',exact:true}).click();await expect(section(page)).toContainText('Admin access or MFA');await expect(section(page).locator('.model-status__model')).toHaveCount(0);expect(count).toBe(3);expect(e.errors).toEqual([]);
});
test('model status pending request is cancelled on leave and cannot restore old protected content',async({page,baseURL})=>{
 let release;const waiting=new Promise(r=>release=r);let started=false;
 const e=await setup(page,baseURL,{handler:async(route,data)=>{started=true;await waiting;await route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,data})}).catch(()=>{});}});
 await page.goto('/admin/index.html#model-status');await expect(section(page).getByRole('button',{name:'Refresh'})).toBeDisabled();expect(started).toBe(true);
 await page.evaluate(()=>location.hash='dashboard');release();await expect(section(page)).toBeEmpty();expect(e.calls.filter(c=>c.path==='/api/admin/ai/model-status')).toHaveLength(1);expect(e.errors).toEqual([]);
});
