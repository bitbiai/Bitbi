const {responseBytes}=require('./canvas-agent-ui.cjs');
module.exports=async({page,expect,locale,info,mockSharedAuth,createCanvasApiMock,scenario='budget'})=>{
 const {SqliteD1Database,applyAuthMigrations}=require('./sqlite-d1.js'),{createAuthTestEnv}=require('./auth-worker-harness.js');
 const {canvasAgentConversationFixture}=await import('./canvas-agent-conversation-control.mjs');
 const {CANVAS_FABLE_MODEL}=await import('../../js/shared/canvas-assistant-models.mjs');
 const DB=new SqliteD1Database();applyAuthMigrations(DB);let c;
 const de=locale==='de',requests=[],errors=[];
 try{
  c=await canvasAgentConversationFixture({...createAuthTestEnv(),DB},{scope:'budget-browser-'+locale,locale});const f=c.f;
  await mockSharedAuth(page);createCanvasApiMock(page);await page.setViewportSize({width:de?1280:1440,height:de?600:900});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/account/canvas/**',async route=>{
   const req=route.request(),url=new URL(req.url()),body=req.postData()?req.postDataJSON():undefined,headers={};
   for(const name of ['Idempotency-Key','X-Bitbi-Tariff-Revision'])if(req.headers()[name.toLowerCase()])headers[name]=req.headers()[name.toLowerCase()];
   requests.push({path:url.pathname,method:req.method(),body,key:headers['Idempotency-Key']});
   const response=await f.request(url.pathname+url.search,req.method(),body,headers),bytes=await responseBytes(response);
   if(!page.isClosed())await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:bytes});
  });
  await page.goto(de?'/de/canvas/':'/canvas/');await page.locator('#canvasAgentToggle').click();
  const panel=page.locator('#canvasAgentPanel'),model=panel.getByRole('combobox',{name:de?'Assistentenmodell':'Assistant model',exact:true}),input=panel.locator('textarea[name=message]'),messages=panel.locator('.canvas-agent__messages'),viewport=panel.locator('.canvas-agent__transcript');
  await expect(model).toHaveValue('xai/grok-4.7');await model.selectOption(CANVAS_FABLE_MODEL);await expect.poll(async()=>(await c.read()).reasoningModel.modelId).toBe(CANVAS_FABLE_MODEL);
  expect(c.calls).toHaveLength(0);await page.reload();await page.locator('#canvasAgentToggle').click();await expect(model).toHaveValue(CANVAS_FABLE_MODEL);
  await model.selectOption('xai/grok-4.7');await expect.poll(async()=>(await c.read()).reasoningModel.modelId).toBe('xai/grok-4.7');
  const send=async text=>{await input.fill(text);const response=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/conversation/messages')&&r.request().method()==='POST');await input.press('Enter');const actual=await response;expect(actual.ok(),`${text}: ${actual.status()} ${await actual.text()} allowance=${JSON.stringify((await c.read()).allowance)}`).toBe(true);await expect(input).toHaveValue('');};
  if(scenario==='allowance'){
   const allowanceCap=(await c.read()).allowance.suggestedAllowanceCredits*2; // Includes the actual bounded prompt and the following consent messages.
   await send(de?`Gesprächsbudget ${allowanceCap} Credits`:`Briefing allowance ${allowanceCap} credits`);
   await expect(panel.locator('.canvas-agent__decision')).toContainText(String(allowanceCap));expect((await c.read()).allowance.capCredits).toBe(0);
   await send(de?'Ja':'Yes');expect((await c.read()).allowance.capCredits).toBe(allowanceCap);expect(c.calls).toHaveLength(0);
   await send(de?'Erkläre mir die unterstützten Kameraeinstellungen.':'Explain the supported camera settings.');
   await c.deliver();await expect(panel.locator('.canvas-agent__bee:not([hidden])')).toHaveCount(1);await expect(panel.locator('.canvas-agent__bee:not([hidden])')).toBeVisible();
   await c.complete({text:de?'Die verfügbaren Einstellungen findest du am jeweiligen Canvas-Node.':'Available settings are shown on each Canvas node.'});
   await expect(messages).toContainText(de?'verfügbaren Einstellungen':'Available settings',{timeout:15000});
   await expect(messages.locator('.canvas-agent__model-label')).toHaveText('Grok 4.7');
   await model.selectOption(CANVAS_FABLE_MODEL);await expect.poll(async()=>(await c.read()).reasoningModel.modelId).toBe(CANVAS_FABLE_MODEL);
   await page.reload();await page.locator('#canvasAgentToggle').click();await expect(model).toHaveValue(CANVAS_FABLE_MODEL);await expect(messages.locator('.canvas-agent__model-label')).toHaveText('Grok 4.7');
   expect(c.calls).toHaveLength(1);expect((await DB.prepare("SELECT COUNT(*) AS n FROM canvas_agent_runs WHERE project_id=? AND purpose='production' AND id!=?").bind(f.project,f.runId).first()).n).toBe(0);
   expect(errors).toEqual([]);await panel.screenshot({path:info.outputPath(`canvas-conversation-allowance-${locale}.png`)});return;
  }
  const idea=de?'Ein lustiger 45 Sekunden Film über Hunde, die im Park zusammen spielen.':'A funny 45 second film about dogs playing together in a park.';
  await send(idea);await expect(messages).toContainText(de?'höchstens kosten':'maximum credit budget');
  const before=await c.read();expect(before.allowance.capCredits).toBe(0);expect(before.pendingDecision.kind).toBe('production_budget');expect(c.calls).toHaveLength(0);
  await send(de?'3.000 Credits':'3,000 credits');const card=panel.locator('.canvas-agent__decision');await expect(card).toBeVisible();await expect(card).toContainText('3000');
  const originalBrief=JSON.stringify((await c.read()).brief);
  // Populate real local budget turns, then reload the saved conversation. None
  // authorizes inference or production; every amendment is still a proposal.
  for(let i=0;i<6;i++){const sent=await c.send(`${3001+i} Credits`);expect(sent.response.ok).toBe(true);}
  await page.reload();await page.locator('#canvasAgentToggle').click();await expect(model).toHaveValue('xai/grok-4.7');
  await viewport.evaluate(node=>{node.scrollTop=0;node.dispatchEvent(new Event('scroll'));});
  const anchor=messages.locator('li').first(),beforeY=(await anchor.boundingBox()).y;
  await send('3000 Credits');await expect(card).toContainText('3000');
  expect(Math.abs((await anchor.boundingBox()).y-beforeY)).toBeLessThan(3);
  await expect(panel.locator('.canvas-agent__new-messages')).toBeVisible();await panel.locator('.canvas-agent__new-messages').click();
  const measured=await panel.evaluate(node=>{const p=node.getBoundingClientRect(),c=node.querySelector('.canvas-agent__composer').getBoundingClientRect(),h=node.querySelector('.canvas-agent__model-header').getBoundingClientRect(),t=node.querySelector('.canvas-agent__transcript');return {headerBottom:h.bottom,composerTop:c.top,composerBottom:c.bottom,panelBottom:p.bottom,transcriptHeight:t.clientHeight,overflow:document.documentElement.scrollWidth>innerWidth};});
  expect(measured.transcriptHeight).toBeGreaterThan(60);expect(measured.headerBottom).toBeLessThan(measured.composerTop);expect(measured.composerBottom).toBeLessThanOrEqual(measured.panelBottom);expect(measured.overflow).toBe(false);
  expect(c.calls).toHaveLength(0);expect((await DB.prepare("SELECT COUNT(*) AS n FROM canvas_agent_runs WHERE project_id=? AND purpose='production' AND id!=?").bind(f.project,f.runId).first()).n).toBe(0);
  await send(de?'Ja, starte':'Yes, start');await expect(panel.locator('.canvas-agent__chat-run')).toBeVisible();
  const runs=(await DB.prepare("SELECT * FROM canvas_agent_runs WHERE project_id=? AND purpose='production' AND id!=?").bind(f.project,f.runId).all()).results;
  expect(runs).toHaveLength(1);expect(runs[0]).toMatchObject({budget_credits:3000,status:'queued',model_id:'xai/grok-4.7'});
  const accepted=requests.filter(r=>r.path.endsWith('/conversation/messages')).at(-1);expect((await c.post('/messages',accepted.body,accepted.key)).ok).toBe(true);
  expect(JSON.stringify((await c.read()).brief)).toBe(originalBrief);expect(c.calls).toHaveLength(0);
  await page.reload();await page.locator('#canvasAgentToggle').click();await expect(model).toHaveValue('xai/grok-4.7');await expect(messages).toContainText(idea);
  expect((await DB.prepare("SELECT COUNT(*) AS n FROM canvas_agent_runs WHERE project_id=? AND purpose='production' AND id!=?").bind(f.project,f.runId).first()).n).toBe(1);
  await panel.screenshot({path:info.outputPath(`canvas-conversation-budget-${locale}.png`)});expect(errors).toEqual([]);
  await info.attach('conversational-budget-evidence',{contentType:'application/json',body:JSON.stringify({actualRoutes:true,modelsPersisted:true,cap:3000,productions:1,providerCalls:0,briefPreserved:true,bounds:measured})});
 }finally{c?.restore();if(!page.isClosed())await page.close();DB.close();}
};
