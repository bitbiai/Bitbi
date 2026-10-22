const {responseBytes}=require('./canvas-agent-ui.cjs');

// Real authenticated Worker routes and SQLite persistence; no model/provider
// calls are needed to configure the assistant's future media permissions.
module.exports=async({page,expect,locale,info,mockSharedAuth,createCanvasApiMock})=>{
 const {SqliteD1Database,applyAuthMigrations}=require('./sqlite-d1.js'),{createAuthTestEnv}=require('./auth-worker-harness.js');
 const {canvasAgentConversationFixture}=await import('./canvas-agent-conversation-control.mjs');
 const DB=new SqliteD1Database();applyAuthMigrations(DB);let c;
 const de=locale==='de',requests=[],errors=[];
 try{
  c=await canvasAgentConversationFixture({...createAuthTestEnv(),DB},{scope:'media-policy-browser-'+locale,locale});const f=c.f,path=f.route+'/media-policy';
  await mockSharedAuth(page,true,'user',f.owner);createCanvasApiMock(page);await page.setViewportSize({width:1440,height:820});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/account/canvas/**',async route=>{
   const req=route.request(),url=new URL(req.url()),body=req.postData()?req.postDataJSON():undefined,headers={};
   for(const name of ['Idempotency-Key','X-Bitbi-Tariff-Revision'])if(req.headers()[name.toLowerCase()])headers[name]=req.headers()[name.toLowerCase()];
   requests.push({path:url.pathname,method:req.method(),body,key:headers['Idempotency-Key']});
   const response=await f.request(url.pathname+url.search,req.method(),body,headers),bytes=await responseBytes(response);
   if(!page.isClosed())await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:bytes});
  });
  const read=async()=>c.data(await f.request(path)),before=await read(),projectBefore=await DB.prepare('SELECT revision FROM canvas_projects WHERE id=?').bind(f.project).first();
  const chosen=['image','video','music'].map(kind=>before.inventory.find(model=>model.capability===kind&&model.available));
  expect(chosen.every(Boolean)).toBe(true);expect(before.policy).toMatchObject({revision:0,mode:'automatic',models:[]});
  await page.goto(de?'/de/canvas/':'/canvas/');await page.locator('#canvasAgentToggle').click();
  const panel=page.locator('#canvasAgentPanel'),dialog=page.locator('#canvasMediaPolicy'),trigger=panel.getByRole('button',{name:de?'Modelle & Limits':'Models & limits',exact:true});
  const composer=panel.locator('textarea[name=message]');await composer.fill(de?'Mein Entwurf bleibt erhalten.':'Keep my draft.');
  await trigger.click();await expect(dialog).toBeVisible();await expect(dialog.locator('input[value=automatic]')).toBeChecked();
  await dialog.locator('input[value=selected]').check();await expect(dialog.locator('.canvas-media-policy__selection')).toContainText(de?'Keine Modelle ausgewählt':'No models selected');
  const save=dialog.getByRole('button',{name:de?'Auswahl speichern':'Save selection',exact:true});await save.click();await expect(dialog).not.toBeVisible();
  expect((await read()).policy).toMatchObject({revision:1,mode:'selected',models:[]});
  const row=model=>dialog.locator('.canvas-media-policy__model').filter({has:page.getByText(model.label,{exact:true})});
  await trigger.click();
  await dialog.getByRole('group',{name:de?'Medientyp':'Media type',exact:true}).getByRole('button',{name:de?'Video':'Video',exact:true}).click();await expect(dialog.locator('.canvas-media-policy__category[data-kind=image]')).not.toBeVisible();await expect(dialog.locator('.canvas-media-policy__category[data-kind=video]')).toBeVisible();
  await dialog.getByRole('group',{name:de?'Medientyp':'Media type',exact:true}).getByRole('button',{name:de?'Alle':'All',exact:true}).click();
  for(const model of chosen)await row(model).getByRole('checkbox').check();
  await row(chosen[0]).getByRole('combobox').selectOption('cap');await row(chosen[0]).getByRole('spinbutton').fill('17');
  await row(chosen[1]).getByRole('combobox').selectOption('cap');await expect(row(chosen[1]).getByRole('spinbutton')).toHaveValue('0');
  await expect(row(chosen[2]).getByRole('combobox')).toHaveValue('none');
  const mutations=()=>requests.filter(request=>request.path===path&&request.method==='PUT');
  await row(chosen[0]).getByRole('spinbutton').fill('-1');const invalidBefore=mutations().length;await save.click();expect(mutations()).toHaveLength(invalidBefore);await expect(row(chosen[0]).getByRole('spinbutton')).toBeFocused();
  await row(chosen[0]).getByRole('spinbutton').fill('17');await save.click();await expect(dialog).not.toBeVisible();
  const expected=[{modelId:chosen[0].id,creditLimit:17},{modelId:chosen[1].id,creditLimit:0},{modelId:chosen[2].id,creditLimit:null}].sort((a,b)=>a.modelId.localeCompare(b.modelId));
  expect((await read()).policy).toMatchObject({revision:2,mode:'selected',models:expected});
  const accepted=mutations().at(-1);expect((await f.request(path,'PUT',accepted.body,{'Idempotency-Key':accepted.key})).ok).toBe(true);expect((await read()).policy.revision).toBe(2);
  await expect(composer).toHaveValue(de?'Mein Entwurf bleibt erhalten.':'Keep my draft.');await panel.locator('#canvasAgentchatTab').focus();
  await page.locator('#canvasAgentExpand').click();await trigger.click();await expect(dialog).toBeVisible();await expect(row(chosen[0]).getByRole('spinbutton')).toHaveValue('17');
  await dialog.locator('.canvas-media-policy__body').evaluate(node=>{node.scrollTop=0;});await dialog.screenshot({path:info.outputPath(`canvas-media-policy-${locale}-desktop.png`)});
  await dialog.press('Escape');await expect(dialog).not.toBeVisible();await expect(trigger).toBeFocused();await expect(page.locator('#canvasAgentExpand')).toHaveAttribute('aria-expanded','true');
  await page.reload();await page.locator('#canvasAgentToggle').click();await trigger.click();await expect(row(chosen[0]).getByRole('spinbutton')).toHaveValue('17');await expect(row(chosen[1]).getByRole('spinbutton')).toHaveValue('0');await expect(row(chosen[2]).getByRole('combobox')).toHaveValue('none');
  await dialog.press('Escape');const second=await c.data(await f.request('/api/account/canvas/projects','POST',{title:'Independent media policy',locale}));expect(second.project.id).not.toBe(f.project);
  await page.reload();await page.locator('.canvas-project-item__open').filter({hasText:'Independent media policy'}).click();await page.locator('#canvasAgentToggle').click();await trigger.click();await expect(dialog.locator('input[value=automatic]')).toBeChecked();
  await dialog.press('Escape');await page.locator('.canvas-project-item__open').filter({hasText:'Durable reasoning fixture'}).click();await trigger.click();await expect(dialog.locator('input[value=selected]')).toBeChecked();await expect(row(chosen[0]).getByRole('spinbutton')).toHaveValue('17');
  // A second device changes the same authoritative policy while this draft is
  // open. The stale tab may not overwrite it or silently approve the old scope.
  await row(chosen[0]).getByRole('spinbutton').fill('18');
  expect((await f.request(path,'PUT',{expectedRevision:2,mode:'automatic',models:[]},{'Idempotency-Key':'policy-second-device-'+locale})).ok).toBe(true);
  await save.click();await expect(dialog.getByRole('status').first()).toContainText(de?'inzwischen geändert':'changed elsewhere');await expect(save).toBeDisabled();
  expect((await read()).policy).toMatchObject({revision:3,mode:'automatic',models:[]});
  await dialog.getByRole('button',{name:de?'Erneut laden':'Reload',exact:true}).click();await expect(dialog.locator('input[value=automatic]')).toBeChecked();
  await page.setViewportSize({width:390,height:640});await expect(dialog).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const bounds=await dialog.evaluate(node=>{const r=node.getBoundingClientRect(),f=node.querySelector('footer').getBoundingClientRect();return{top:r.top,right:r.right,bottom:r.bottom,footer:f.bottom,height:innerHeight,width:innerWidth};});
  expect(bounds.top).toBeGreaterThanOrEqual(0);expect(bounds.right).toBeLessThanOrEqual(bounds.width);expect(bounds.bottom).toBeLessThanOrEqual(bounds.height);expect(bounds.footer).toBeLessThanOrEqual(bounds.height);
  await dialog.screenshot({path:info.outputPath(`canvas-media-policy-${locale}-mobile.png`)});await dialog.getByRole('button',{name:de?'Abbrechen':'Cancel',exact:true}).click();
  const after=await DB.prepare('SELECT revision FROM canvas_projects WHERE id=?').bind(f.project).first();expect(after).toEqual(projectBefore);expect(c.calls).toHaveLength(0);expect(f.calls).toHaveLength(0);
  expect((await DB.prepare('SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=? AND amount<0').bind(f.owner).first()).n).toBe(0);
  expect(requests.filter(request=>request.method==='POST'&&(/\/(run|messages|immediate|start|export)$/.test(request.path)))).toEqual([]);expect(errors).toEqual([]);
  await info.attach('media-policy-evidence',{contentType:'application/json',body:JSON.stringify({actualRoutes:true,persistedPolicies:3,zeroDistinctFromNull:true,staleWriteRejected:true,noInference:true,noCreativeRevision:true,bounds})});
 }finally{c?.restore();if(!page.isClosed())await page.close();DB.close();}
};

module.exports.approval=async({page,expect,locale,info,mockSharedAuth,createCanvasApiMock})=>{
 const {SqliteD1Database,applyAuthMigrations}=require('./sqlite-d1.js'),{createAuthTestEnv}=require('./auth-worker-harness.js');
 const {canvasAgentConversationFixture}=await import('./canvas-agent-conversation-control.mjs');
 const DB=new SqliteD1Database();applyAuthMigrations(DB);let c,releaseOld;
 const de=locale==='de',requests=[],errors=[];let held=false;
 try{
  c=await canvasAgentConversationFixture({...createAuthTestEnv(),DB},{scope:'media-policy-summary-'+locale,locale});const f=c.f,path=f.route+'/media-policy';
  const original=await c.data(await f.request(path)),chosen=['image','video','music'].map(kind=>original.inventory.find(model=>model.capability===kind&&model.available));
  expect(chosen.every(Boolean)).toBe(true);
  await c.data(await f.request(path,'PUT',{expectedRevision:0,mode:'selected',models:chosen.map((model,index)=>({modelId:model.id,creditLimit:index===0?17:null}))},{'Idempotency-Key':'summary-policy-'+locale}));
  await c.data((await c.send(de?'Ein lustiger Hundefilm, 45 Sekunden, mit Musik.':'A funny dog film, 45 seconds, with music.')).response);
  await c.data((await c.send('3000 Credits')).response);
  expect((await c.read()).pendingDecision.kind).toBe('production_start');
  await mockSharedAuth(page,true,'user',f.owner);createCanvasApiMock(page);await page.setViewportSize({width:1440,height:900});page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/account/canvas/**',async route=>{
   const req=route.request(),url=new URL(req.url()),body=req.postData()?req.postDataJSON():undefined,headers={};
   for(const name of ['Idempotency-Key','X-Bitbi-Tariff-Revision'])if(req.headers()[name.toLowerCase()])headers[name]=req.headers()[name.toLowerCase()];
   requests.push({path:url.pathname,method:req.method()});
   if(url.pathname===path&&req.method()==='GET'&&!held){held=true;await new Promise(resolve=>{releaseOld=resolve;});if(!page.isClosed())await route.fulfill({json:{ok:true,data:original}});return;}
   const response=await f.request(url.pathname+url.search,req.method(),body,headers),bytes=await responseBytes(response);if(!page.isClosed())await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:bytes});
  });
  await page.goto(de?'/de/canvas/':'/canvas/');await page.locator('#canvasAgentToggle').click();
  const panel=page.locator('#canvasAgentPanel'),decision=panel.locator('.canvas-agent__decision'),summary=decision.locator('.canvas-media-policy__summary');
  // The conversation envelope itself carries accepted terms. Do not wait for
  // or let a delayed older catalog response replace the approval summary.
  await expect(decision).toBeVisible();await expect(summary).toContainText(de?'3 ausgewählte Modelle':'3 selected models');await summary.locator('summary').click();await expect(summary).toContainText('17 Credits');
  await expect(summary).not.toContainText(de?'Freigegebenes Projektlimit':'Approved project budget');
  expect(releaseOld).toBeTruthy();releaseOld();releaseOld=null;
  await expect.poll(()=>requests.filter(request=>request.path===path&&request.method==='GET').length).toBe(2);await expect(summary).toContainText(de?'3 ausgewählte Modelle':'3 selected models');
  await expect(summary).toContainText(chosen[0].label);await expect(summary).not.toContainText(de?'Modelle & Limits: Automatisch':'Models & limits: Automatic');
  await panel.locator('.canvas-agent__make-now').click();const quick=panel.locator('.canvas-agent__immediate');await expect(quick).toHaveAttribute('data-state','approval_required');
  await expect(quick.locator('.canvas-media-policy__summary')).toBeVisible();await expect(quick.locator('.canvas-media-policy__summary')).toContainText(de?'3 ausgewählte Modelle':'3 selected models');
  await quick.locator('.canvas-media-policy__summary summary').click();await expect(quick.locator('.canvas-media-policy__summary')).toContainText('17 Credits');
  await expect(quick.locator('.canvas-media-policy__summary')).not.toContainText(de?'Freigegebenes Projektlimit':'Approved project budget');
  const approve=quick.getByRole('button',{name:de?'Limit freigeben und Film starten':'Authorize cap and start film',exact:true});await expect(approve).toBeVisible();
  expect(await quick.locator('.canvas-media-policy__summary').evaluate((node)=>Boolean(node.compareDocumentPosition(node.parentNode.querySelector('.canvas-button--primary'))&Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  expect(c.calls).toHaveLength(0);expect(f.calls).toHaveLength(0);expect(requests.filter(request=>request.path.endsWith('/immediate/approve'))).toEqual([]);expect(errors).toEqual([]);
  await panel.screenshot({path:info.outputPath(`canvas-policy-approval-${locale}.png`)});
 }finally{releaseOld?.();c?.restore();if(!page.isClosed())await page.close();DB.close();}
};
