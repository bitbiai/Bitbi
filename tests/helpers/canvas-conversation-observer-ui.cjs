const {responseBytes}=require('./canvas-agent-ui.cjs');

module.exports=async({page,expect,locale,info,mockSharedAuth,createCanvasApiMock,scenario='queued'})=>{
  const {SqliteD1Database,applyAuthMigrations}=require('./sqlite-d1.js');
  const {createAuthTestEnv}=require('./auth-worker-harness.js');
  const {canvasAgentConversationFixture}=await import('./canvas-agent-conversation-control.mjs');
  const DB=new SqliteD1Database();applyAuthMigrations(DB);
  const requests=[],errors=[],de=locale==='de';let c,offline=false,failedReads=0;
  try {
    c=await canvasAgentConversationFixture({...createAuthTestEnv(),DB},{scope:`observer-${locale}-${scenario}`,locale});
    const f=c.f;await c.approve(3000);
    await page.setViewportSize({width:1440,height:900});
    if(scenario!=='queued')await page.clock.install({time:new Date()});
    await mockSharedAuth(page,true,'user',f.owner);createCanvasApiMock(page);
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/api/account/canvas/**',async route=>{
      const req=route.request(),url=new URL(req.url()),body=req.postData()?req.postDataJSON():undefined,headers={};
      for(const name of ['Idempotency-Key','X-Bitbi-Tariff-Revision'])if(req.headers()[name.toLowerCase()])headers[name]=req.headers()[name.toLowerCase()];
      requests.push({path:url.pathname,method:req.method()});
      if(offline&&url.pathname===c.route&&req.method()==='GET'){failedReads++;return route.abort('internetdisconnected');}
      const response=await f.request(url.pathname+url.search,req.method(),body,headers),bytes=await responseBytes(response);
      if(!page.isClosed())await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:bytes});
    });
    await page.goto(de?'/de/canvas/':'/canvas/');await page.locator('#canvasAgentToggle').click();
    const panel=page.locator('#canvasAgentPanel'),composer=panel.locator('.canvas-agent__composer'),transcript=panel.locator('.canvas-agent__messages');
    const idea=de?'Ein 45 Sekunden Film über eine Biene, die in eine Fabrik fliegt.':'A 45 second film about a bee flying into a factory.';
    await composer.locator('textarea').fill(idea);
    const accepted=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/conversation/messages')&&response.request().method()==='POST');
    await composer.locator('button[type=submit]').click();
    const response=await accepted,snapshot=(await response.json()).data.conversation;
    expect(response.status()).toBe(202);expect(snapshot.pendingTurnId).toBeTruthy();
    const pendingReply=snapshot.messages.find(message=>message.id===snapshot.pendingTurnId+':reply');
    expect(pendingReply.delivery.stage).toBe('queued');
    expect(await DB.prepare('SELECT COUNT(*) AS n FROM canvas_agent_model_operations').first()).toEqual({n:0});
    expect((await DB.prepare("SELECT receipt_json FROM canvas_agent_steps WHERE run_id=(SELECT run_id FROM canvas_agent_turns WHERE id=?)").bind(snapshot.pendingTurnId).first()).receipt_json).toBeNull();
    expect(c.calls).toHaveLength(0);
    const readsAtAcknowledgement=requests.filter(r=>r.path===c.route&&r.method==='GET').length;
    await expect(transcript).toContainText(idea);
    // The first real response precedes queue consumption. Completing the actual
    // signed operation must reach this browser without reload or another action.
    await c.deliver();
    if(scenario==='late'){
      // Advance the actual browser's time past the former logical-turn cutoff.
      // This is a still-running original request, not a fresh message/reload.
      await page.clock.fastForward(6*60*1000);f.advance(6*60*1000);
    }
    if(scenario==='reconnect'){
      offline=true;await page.clock.runFor(15000);
      await expect.poll(()=>failedReads,{timeout:3000}).toBeGreaterThan(0);offline=false;
    }
    if(scenario==='visibility')await page.evaluate(()=>{
      Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});
      document.dispatchEvent(new Event('visibilitychange'));
    });
    if(scenario==='pageshow')await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
    await c.complete({text:de?'Die Biene fliegt in die Fabrik. Die Filmidee ist gespeichert.':'The bee flies into the factory. Your film idea is saved.',fields:{story:idea},intent:'ready'});
    // The queue can persist replies with the browser closed. Other scenarios
    // exercise receipt-only GET reconciliation without a second queue delivery.
    if(['queued','visibility','pageshow'].includes(scenario))await c.deliver();
    if(scenario==='visibility')await page.evaluate(()=>{
      Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});
      document.dispatchEvent(new Event('visibilitychange'));
    });
    if(scenario==='pageshow')await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
    if(scenario!=='queued')await page.clock.runFor(30000);
    try {
      await expect(transcript).toContainText(de?'Die Filmidee ist gespeichert.':'Your film idea is saved.',{timeout:12000});
    } finally {
      await info.attach('automatic-reply-observation',{contentType:'application/json',body:JSON.stringify({scenario,
        initialStage:pendingReply.delivery.stage,initialCanObserve:pendingReply.delivery.canObserve,
        initialProviderOperations:0,failedReads,readsAfterAcknowledgement:requests.filter(r=>r.path===c.route&&r.method==='GET').length-readsAtAcknowledgement,
        acceptedProviderCalls:c.calls.length,completedTurns:(await DB.prepare("SELECT COUNT(*) AS n FROM canvas_agent_turns WHERE project_id=? AND state='completed' AND run_id IS NOT NULL").bind(f.project).first()).n})});
    }
    expect(c.calls).toHaveLength(1);
    expect(requests.filter(r=>r.path===c.route&&r.method==='GET').length).toBeGreaterThan(readsAtAcknowledgement);
    expect((await DB.prepare('SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=? AND amount<0').bind(f.owner).first()).n).toBe(1);
    expect(requests.filter(r=>r.path.endsWith('/conversation/messages')&&r.method==='POST')).toHaveLength(1);
    expect(errors).toEqual([]);
  } finally {c?.restore();if(!page.isClosed())await page.close();DB.close();}
};
