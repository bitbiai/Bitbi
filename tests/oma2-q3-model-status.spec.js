const {test,expect}=require('@playwright/test');
const path=require('node:path');
const {SqliteD1Database,applyAuthMigrations}=require('./helpers/sqlite-d1');
let databases=[];test.afterEach(()=>{for(const db of databases)db.close();databases=[];});
const admin={id:'status-admin',role:'admin',email:'status@example.invalid'};
async function snapshot(){
 const {modelStatusCatalog,summarizeModelStatus}=await import('../workers/auth/src/lib/admin-model-status.js');
 const catalog=modelStatusCatalog({}),now=Date.now(),at=new Date(now-600000).toISOString();
 const video=catalog.find(m=>m.mediaTypes.includes('video')),image=catalog.find(m=>m.mediaTypes.includes('image'));
 const rows=[{id:'success',model_id:image.id,operation_key:'admin.ai.image',status:'succeeded',provider_outcome:'succeeded',completed_at:at},...['fail1','fail2'].map(id=>({id,model_id:video.id,operation_key:'admin.ai.video',status:'provider_failed',provider_outcome:'failed',error_code:'upstream_error',completed_at:at}))];
 return {observedAt:new Date(now).toISOString(),freshForSeconds:300,...summarizeModelStatus(catalog,[{name:'admin',rows}],now),sources:[{name:'member',available:true},{name:'admin',available:true}],provider:{observedAt:at,stale:false,components:[{name:'Workers AI',state:'operational'}]},coverage:{}};
}
async function setup(page,baseURL,{gate=0,handler,failSave=false}={}){
 await page.addInitScript(()=>localStorage.setItem('bitbi_cookie_consent',JSON.stringify({v:'1',ts:Date.now(),necessary:true,analytics:false,marketing:false})));
 const DB=new SqliteD1Database();databases.push(DB);applyAuthMigrations(DB);
 await DB.prepare("INSERT INTO users(id,email,password_hash,created_at,role,status) VALUES(?,?,'synthetic',?,'admin','active')").bind(admin.id,admin.email,new Date().toISOString()).run();
 const availability=await import('../workers/auth/src/lib/model-availability.js'),assistant=await import('./helpers/website-assistant-fixture.mjs');
 const env={DB,...assistant.harness().env};
 const data=await snapshot(),calls=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.context().route('**/*',async route=>{
  const r=route.request(),u=new URL(r.url());if(u.origin!==new URL(baseURL).origin)return route.abort();if(!u.pathname.startsWith('/api/'))return route.continue();
  calls.push({path:u.pathname,method:r.method(),body:r.postDataJSON()});
  if(u.pathname==='/api/admin/ai/model-availability'){try{if(r.method()==='PATCH'&&failSave)return route.fulfill({status:503,json:{ok:false,code:'unavailable'}});return route.fulfill({json:{ok:true,data:r.method()==='PATCH'?await availability.changeModelAvailability(env,admin,r.postDataJSON()):await availability.adminModelAvailability(env)}});}catch(error){return route.fulfill({status:error.status||503,json:{ok:false,code:error.code}});}}
  if(u.pathname==='/api/admin/ai/model-status'&&handler)return handler(route,data);
  const user=gate===401?null:gate===403?{...admin,role:'user'}:admin;
  const body=u.pathname==='/api/me'?{loggedIn:!!user,user}:u.pathname==='/api/admin/me'?{ok:!gate,user}:u.pathname==='/api/admin/ai/model-status'?{ok:true,data}:{ok:true,stats:{}};
  return route.fulfill({status:u.pathname==='/api/admin/me'&&gate?gate:200,contentType:'application/json',body:JSON.stringify(body)});
 });return{calls,errors,data,env,availability};
}
const section=page=>page.locator('#sectionModelStatus');
const open=async page=>{await page.goto('/admin/index.html#model-status');await expect(section(page).locator('.model-status__model').first()).toBeVisible();};
for(const [locale,width]of [['en',1280],['de',390]])test.describe(`${locale} model status input context`,()=>{
 test.use({hasTouch:width<500});
 test(`${locale} model status reader desktop/mobile, filtering, keyboard/touch and safe details`,async({page,baseURL},info)=>{
 await page.setViewportSize({width,height:900});const e=await setup(page,baseURL);await open(page);
 await expect(page.getByRole('heading',{name:'Model status',exact:true,level:1})).toBeVisible();
 expect(await section(page).locator('.model-status__model').count()).toBe(e.data.models.length);
 const first=section(page).locator('.model-status__model > summary').first();await first.focus();await page.keyboard.press('Enter');await expect(section(page).locator('.model-status__detail').first()).toBeVisible();
 const search=section(page).getByRole('searchbox',{name:'Find a model or provider',exact:true});await search.fill('not-a-model');await expect(section(page).locator('.model-status__model')).toHaveCount(0);await search.fill('');
 await section(page).locator('.model-status__filters select').first().selectOption('video');expect(await section(page).locator('.model-status__model').count()).toBe(e.data.models.filter(m=>m.mediaTypes.includes('video')).length);
 await section(page).locator('.model-status__filters select').first().selectOption('');
 if(width<500)await section(page).locator('.model-status__model > summary').first().tap();else await section(page).locator('.model-status__model > summary').first().click();
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
 await open(page);await section(page).getByRole('button',{name:'Refresh',exact:true}).click();await expect(section(page).locator('.model-status__notice')).toContainText('not current');await expect(section(page).locator('.model-status__badge.is-successful')).toHaveCount(0);
 await expect(section(page).locator('.model-status__model')).toHaveCount(e.data.models.length);
 await section(page).getByRole('button',{name:'Refresh',exact:true}).click();await expect(section(page)).toContainText('Admin access or MFA');await expect(section(page).locator('.model-status__model')).toHaveCount(0);expect(count).toBe(3);expect(e.errors).toEqual([]);
});
test('model status pending request is cancelled on leave and cannot restore old protected content',async({page,baseURL})=>{
 let release;const waiting=new Promise(r=>release=r);let started=false;
 const e=await setup(page,baseURL,{handler:async(route,data)=>{started=true;await waiting;await route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,data})}).catch(()=>{});}});
 await page.goto('/admin/index.html#model-status');await expect(section(page).getByRole('button',{name:'Refresh',exact:true})).toBeDisabled();expect(started).toBe(true);
 await page.evaluate(()=>location.hash='dashboard');release();await expect(section(page)).toBeEmpty();expect(e.calls.filter(c=>c.path==='/api/admin/ai/model-status')).toHaveLength(1);expect(e.errors).toEqual([]);
});

for(const width of [1280,390])test(`area switches save server state with keyboard, reload and independent areas at ${width}`,async({page,baseURL},info)=>{
 await page.setViewportSize({width,height:900});const f=await setup(page,baseURL);await open(page);
 const view=page.getByRole('region',{name:'Model availability'});
 await expect(view.locator('[data-availability-model]')).toHaveCount(25);await expect(view.locator('[data-area="main"]')).toHaveCount(1);
 const row=view.locator('[data-availability-model="minimax/h3"]'),gen=row.locator('[data-area="generation"]'),canvas=row.locator('[data-area="canvas"]');
 await gen.focus();await page.keyboard.press('Space');await expect(gen).toHaveAttribute('aria-checked','false');await expect(view.getByRole('status')).toContainText('Saved.');await expect(canvas).toHaveAttribute('aria-checked','true');
 expect(f.calls.filter(c=>c.method==='PATCH')[0].body).toEqual({modelId:'minimax/h3',area:'generation',enabled:false,revision:0});
 await page.reload();await expect(gen).toHaveAttribute('aria-checked','false');await canvas.click();await expect(canvas).toHaveAttribute('aria-checked','false');
 await gen.click();await expect(gen).toHaveAttribute('aria-checked','true');await expect(canvas).toHaveAttribute('aria-checked','false');
 expect((await gen.boundingBox()).height).toBeGreaterThanOrEqual(44);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await view.getByRole('searchbox').fill('Apertus');await expect(view.locator('[data-availability-model]')).toHaveCount(1);await expect(view.getByRole('switch')).toHaveAttribute('aria-checked','false');
 await view.getByRole('switch').click();await expect(view.getByRole('status')).toContainText('Main remains off');await expect(view.getByRole('switch')).toHaveAttribute('aria-checked','false');
 await view.getByRole('searchbox').fill('');await page.evaluate(()=>document.documentElement.dataset.theme='light');await page.screenshot({path:path.join(info.outputDir,`availability-light-${width}.png`),fullPage:false});await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.screenshot({path:path.join(info.outputDir,`availability-dark-${width}.png`),fullPage:false});
 expect(f.errors).toEqual([]);
});
test('area failed save is never shown as saved and reload keeps the previous persisted OFF state',async({page,baseURL})=>{
 const f=await setup(page,baseURL,{failSave:true});await f.availability.changeModelAvailability(f.env,admin,{modelId:'minimax/h3',area:'generation',enabled:false,revision:0});
 await open(page);const view=page.getByRole('region',{name:'Model availability'}),button=view.locator('[data-availability-model="minimax/h3"] [data-area="generation"]');
 await expect(button).toHaveAttribute('aria-checked','false');await button.click();await expect(view.getByRole('status')).toContainText('not confirmed');await expect(button).toHaveAttribute('aria-checked','false');
 await page.reload();await expect(button).toHaveAttribute('aria-checked','false');expect(f.calls.filter(c=>c.method==='PATCH')).toHaveLength(1);expect(f.errors).toEqual([]);
});

const refreshAvailability=page=>page.evaluate(async()=>{await(await import('/js/shared/model-pricing-client.js')).refreshModelPricing();});
for(const lang of ['en','de'])test(`area Generation Lab hides OFF without messaging or silent replacement ${lang}`,async({page,baseURL})=>{
 const f=await require('./helpers/appearance').setupAppearance(page,baseURL,{role:'user'});const id='@cf/black-forest-labs/flux-1-schnell';
 await page.goto(`${lang==='de'?'/de':''}/generate-lab/`);await expect(page.locator('#labImageModel option[value="'+id+'"]')).toHaveCount(1);await page.locator('#labImageModel').selectOption(id);
 await page.locator('#labPrompt').fill('Keep this draft');f.availability.models[id].generation=false;await refreshAvailability(page);
 await expect(page.locator('#labImageModel option[value="'+id+'"]')).toHaveCount(0);await expect(page.locator('#labImageModel')).toHaveValue('');await expect(page.locator('#labGenerate')).toBeDisabled();await expect(page.locator('#labPrompt')).toHaveValue('Keep this draft');
 await expect(page.locator('#labMessage')).toBeEmpty();expect(await page.getByText(/temporarily disabled|vorübergehend deaktiviert/).count()).toBe(0);
 f.availability.models[id].generation=true;await refreshAvailability(page);await expect(page.locator('#labImageModel')).toHaveValue(id);await expect(page.locator('#labGenerate')).toBeEnabled();expect(f.unexpectedWrites).toEqual([]);expect(f.errors).toEqual([]);
});
for(const lang of ['en','de'])test(`area Canvas retains existing output and edges, permits downstream reuse and restores without generation ${lang}`,async({page,baseURL})=>{
 const f=await require('./helpers/appearance').setupAppearance(page,baseURL,{role:'user'}),source=f.nodes[1],id='@cf/meta/llama-3.1-8b-instruct-fast';source.model_id=id;source.output={kind:'text',text:'Retained landscape instructions',runId:'retained-run'};
 const downstream={...structuredClone(source),id:'5'.repeat(32),title:'Downstream writer',model_id:'@cf/meta/llama-3.3-70b-instruct-fp8-fast',x:700,config:{...source.config,prompt:''},output:null};f.nodes.push(downstream);f.edges.push({id:'6'.repeat(32),project_id:f.project.id,source_node_id:source.id,target_node_id:downstream.id,source_port:'text',target_port:'input',config:{}});
 const before=JSON.stringify([f.nodes,f.edges]);await page.goto(`${lang==='de'?'/de':''}/canvas/`);const node=page.locator(`.canvas-node[data-node-id="${source.id}"]`);await node.click();
 f.availability.models[id].canvas=false;await refreshAvailability(page);const note=lang==='de'?'Dieses Modell wurde vorübergehend deaktiviert.':'This model has been temporarily disabled.';
 await expect(node).toContainText(note);const inspector=page.locator('#canvasInspectorBody');await expect(inspector).toContainText(note);await expect(inspector.getByRole('button',{name:lang==='de'?'Ausführen':'Run',exact:true})).toBeDisabled();
 await expect(inspector).toContainText('Retained landscape instructions');expect(JSON.stringify([f.nodes,f.edges])).toBe(before);
 const reused=await page.evaluate(async({source,downstream,edges})=>{const w=await import('/js/pages/canvas/workflow.js'),m=await import('/js/shared/canvas-model-contract.mjs');const models=m.listCanvasModels().map(model=>({...model,areaEnabled:model.id!==source.model_id}));const copy={runUpstream:'Missing result',noUsableOutput:'No output',modelDisabled:'Disabled',promptRequired:'Prompt required'};const analysis=w.analyzeNodeInputs(downstream,[source,downstream],edges,models,copy);return {text:analysis.effectivePrompt,error:w.validationForNode(downstream,analysis,copy),missing:w.nodeOutputValue({...source,output:null}).kind};},{source,downstream,edges:f.edges.filter(e=>e.target_node_id===downstream.id)});
 expect(reused.text).toContain('Retained landscape instructions');expect(reused.error).toBeNull();expect(reused.missing).toBe('none');
 f.availability.models[id].canvas=true;await refreshAvailability(page);await expect(node).not.toContainText(note);await expect(inspector.getByRole('button',{name:lang==='de'?'Ausführen':'Run',exact:true})).toBeEnabled();expect(JSON.stringify([f.nodes,f.edges])).toBe(before);expect(f.unexpectedWrites).toEqual([]);expect(f.errors).toEqual([]);
});
