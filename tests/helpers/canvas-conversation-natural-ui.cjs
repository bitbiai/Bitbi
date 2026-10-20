const {responseBytes}=require('./canvas-agent-ui.cjs');

module.exports=async({page,expect,locale,info,mockSharedAuth,createCanvasApiMock})=>{
  const {SqliteD1Database,applyAuthMigrations}=require('./sqlite-d1.js');
  const {createAuthTestEnv}=require('./auth-worker-harness.js');
  const {canvasAgentConversationFixture}=await import('./canvas-agent-conversation-control.mjs');
  const DB=new SqliteD1Database();applyAuthMigrations(DB);
  const de=locale==='de',requests=[],errors=[];let c;
  try{
    c=await canvasAgentConversationFixture({...createAuthTestEnv(),DB},{scope:'natural-browser-'+locale,locale});
    const f=c.f;await mockSharedAuth(page,true,'user',f.owner);createCanvasApiMock(page);
    await page.setViewportSize({width:de?1280:1440,height:de?560:900});
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/api/account/canvas/**',async route=>{
      const request=route.request(),url=new URL(request.url()),body=request.postData()?request.postDataJSON():undefined,headers={};
      for(const name of ['Idempotency-Key','X-Bitbi-Tariff-Revision'])if(request.headers()[name.toLowerCase()])headers[name]=request.headers()[name.toLowerCase()];
      requests.push({path:url.pathname,method:request.method(),body,key:headers['Idempotency-Key']});
      const response=await f.request(url.pathname+url.search,request.method(),body,headers),bytes=await responseBytes(response);
      if(!page.isClosed())await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:bytes});
    });
    await page.goto(de?'/de/canvas/':'/canvas/');await page.locator('#canvasAgentToggle').click();
    const panel=page.locator('#canvasAgentPanel'),composer=panel.locator('.canvas-agent__composer'),input=composer.locator('textarea');
    const now=panel.getByRole('button',{name:de?'Mach mir den Film jetzt!':'Make my film now!',exact:true});
    await expect(now).toBeVisible();await panel.locator('.canvas-agent__approval-prompt').click();
    const allowance=panel.locator('.canvas-agent__allowance');await allowance.locator('input').fill('3000');
    await allowance.getByRole('button').click();await expect(allowance).toBeHidden();
    const idea=de?'Ein lustiger 45 Sekunden Film mit Musik: Eine Schnecke sitzt auf einem Blatt, das Ameisen abschneiden.':'A funny 45 second film with music: a snail sits on a leaf that ants cut off.';
    await input.fill(idea);await input.press('Enter');
    const bee=panel.locator('.canvas-agent__bee:visible');await expect(bee).toHaveCount(1);
    await expect(bee).toHaveAttribute('aria-hidden','true');
    await expect(panel.locator('.canvas-agent__thinking')).toContainText(de?'Einen Moment':'One moment');
    await expect(panel.locator('.canvas-agent__thinking .canvas-agent__diagnostic code')).toBeHidden();
    expect(c.calls).toHaveLength(0);
    const bounds=()=>panel.evaluate(node=>{const r=node.getBoundingClientRect(),composer=node.querySelector('.canvas-agent__composer').getBoundingClientRect(),start=node.querySelector('.canvas-agent__make-now').getBoundingClientRect(),help=document.querySelector('#bitbiHelpTrigger').getBoundingClientRect(),transcript=node.querySelector('.canvas-agent__transcript');return {height:transcript.clientHeight,composerBottom:composer.bottom,startBottom:start.bottom,panelBottom:r.bottom,helpBottom:help.bottom,composerTop:composer.top,viewport:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth};});
    const measured=await bounds();expect(measured.height).toBeGreaterThan(60);expect(measured.startBottom).toBeLessThanOrEqual(measured.panelBottom);expect(measured.composerBottom).toBeLessThan(measured.viewport);expect(measured.helpBottom).toBeLessThan(measured.composerTop);expect(measured.overflow).toBe(false);
    const help=page.locator('#bitbiHelpTrigger');await expect(panel.locator('.canvas-panel__head #bitbiHelpTrigger')).toHaveCount(1);
    await help.focus();await help.press('Enter');await expect(page.locator('#bitbiHelpPanel')).toBeVisible();
    await page.keyboard.press('Escape');await expect(page.locator('#bitbiHelpPanel')).toBeHidden();await expect(help).toBeFocused();await expect(panel).toBeVisible();
    const animation=()=>bee.evaluate(node=>getComputedStyle(node).animationName);
    expect(await animation()).not.toBe('none');await page.emulateMedia({reducedMotion:'reduce'});await expect.poll(animation).toBe('none');
    // A hidden panel freezes motion without changing durable work or transcript.
    await page.emulateMedia({reducedMotion:'no-preference'});await page.locator('#canvasAgentToggle').click();
    expect(await panel.locator('.canvas-agent__bee').first().evaluate(node=>getComputedStyle(node).animationPlayState)).toBe('paused');
    await expect(page.locator('#bitbiHelpMenu > #bitbiHelpTrigger')).toHaveCount(1);
    await page.locator('#canvasAgentToggle').click();await expect(bee).toBeVisible();
    await panel.screenshot({path:info.outputPath(`canvas-natural-pending-${locale}.png`)});
    await now.click();const intent=panel.locator('.canvas-agent__immediate');await expect(intent).toHaveAttribute('data-state','waiting');
    expect(c.calls).toHaveLength(0);expect((await c.read()).immediateIntent.quote).toBeNull();
    const approval=intent.getByRole('button',{name:de?'Limit freigeben und Film starten':'Authorize cap and start film',exact:true});await expect(approval).toBeHidden();
    await c.deliver();await c.complete({text:de?'Die 45 Sekunden lange Komödie mit Musik ist vorgemerkt.':'The 45 second comedy with music is noted.',fields:{story:idea,audio:'background music'},intent:'ready'});await c.deliver();
    await expect(intent).toHaveAttribute('data-state','approval_required',{timeout:15000});await expect(bee).toHaveCount(0);await expect(approval).toBeVisible();
    const saved=(await c.read()).immediateIntent;expect(saved.quote.scope.targetDurationSeconds).toBe(45);expect(saved.quote.scope.brief).toContain(idea);expect(saved.quote.proposedCapCredits).toBeGreaterThan(0);expect(saved.quote.evaluationCredits).toBeGreaterThan(0);
    await expect(intent.locator('dt').filter({hasText:de?'Begrenzte visuelle Prüfung':'Bounded visual review'}).locator('xpath=following-sibling::dd[1]')).toHaveText(String(saved.quote.evaluationCredits));
    await expect(panel.getByRole('tab',{name:de?'Gespräch':'Conversation',exact:true})).toHaveAttribute('aria-selected','true');
    expect(requests.filter(r=>r.path.endsWith('/immediate/approve'))).toHaveLength(0);
    await panel.screenshot({path:info.outputPath(`canvas-natural-approval-${locale}.png`)});
    await approval.evaluate(node=>{node.click();node.click();});
    await expect(intent).toHaveAttribute('data-state','started');
    const approved=requests.filter(r=>r.path.endsWith('/immediate/approve'));expect(approved).toHaveLength(1);expect(approved[0].body).toMatchObject({authorized:true,capCredits:saved.quote.proposedCapCredits,intentId:saved.id});
    expect(c.calls).toHaveLength(1);expect(requests.filter(r=>r.path.endsWith('/conversation/start'))).toHaveLength(0);
    const run=(await f.data(await f.request(f.route))).run;expect(run.status).toBe('queued');
    await page.reload();await page.locator('#canvasAgentToggle').click();await expect(intent).toHaveAttribute('data-state','started');
    await expect(panel.locator('.canvas-agent__chat-run')).toBeVisible();
    expect((await f.data(await f.request(f.route))).run.id).toBe(run.id);expect(errors).toEqual([]);
    await info.attach('natural-start-evidence',{contentType:'application/json',body:JSON.stringify({transport:'authenticated routes, D1, actual queue and signed synthetic inference callback',pendingBee:true,explicitApproval:true,cap:saved.quote.proposedCapCredits,originalRun:run.id,providerCalls:c.calls.length,bounds:measured})});
  }finally{c?.restore();if(!page.isClosed())await page.close();DB.close();}
};
