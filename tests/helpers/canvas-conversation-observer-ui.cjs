const {responseBytes}=require('./canvas-agent-ui.cjs');

module.exports=async({page,expect,locale,info,mockSharedAuth,createCanvasApiMock,scenario='queued'})=>{
  const {SqliteD1Database,applyAuthMigrations}=require('./sqlite-d1.js');
  const {createAuthTestEnv}=require('./auth-worker-harness.js');
  const {canvasAgentConversationFixture}=await import('./canvas-agent-conversation-control.mjs');
  const DB=new SqliteD1Database();applyAuthMigrations(DB);
  const requests=[],errors=[],routeTasks=new Set(),de=locale==='de',proactive=['incident','manual_incident'].includes(scenario);let c,offline=false,failedReads=0,saveOutage=false,noticeOutage=false;
  try {
    c=await canvasAgentConversationFixture({...createAuthTestEnv(),DB},{scope:`observer-${locale}-${scenario}`,locale});
    const f=c.f;
    if(proactive)await DB.prepare('UPDATE canvas_projects SET locale=? WHERE id=?').bind(locale,f.project).run();
    await c.approve(3000);
    if(scenario==='diagnostic_revocation'){
      const current=await c.read();await c.data(await c.post('/allowance',{capCredits:3000,diagnostics:true,expectedConversationRevision:current.revision}));
      await c.data((await c.send('A 45 second film about a playful dog.')).response);
      f.env.ENABLE_GROK_4_7='false';
    }
    if(proactive)for(let i=0;i<8;i++)await c.data((await c.send(de?'Wie weit bist du?':'How far along are you?')).response);
    await page.setViewportSize({width:1440,height:900});
    if(scenario!=='queued')await page.clock.install({time:new Date()});
    await mockSharedAuth(page,true,'user',f.owner);createCanvasApiMock(page);
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/api/account/canvas/**',route=>{
      const task=(async()=>{
      const req=route.request(),url=new URL(req.url()),body=req.postData()?req.postDataJSON():undefined,headers={};
      for(const name of ['Idempotency-Key','X-Bitbi-Tariff-Revision'])if(req.headers()[name.toLowerCase()])headers[name]=req.headers()[name.toLowerCase()];
      requests.push({path:url.pathname,method:req.method(),body});
      if(saveOutage&&url.pathname===f.projectPath&&req.method()==='PATCH')return route.fulfill({status:503,json:{ok:false,code:'synthetic_save_unavailable'}});
      if(noticeOutage&&url.pathname.endsWith('/notifications/client'))return route.abort('internetdisconnected');
      if(offline&&url.pathname===c.route&&req.method()==='GET'){failedReads++;return route.abort('internetdisconnected');}
      const response=await f.request(url.pathname+url.search,req.method(),body,headers),bytes=await responseBytes(response);
      if(!page.isClosed())await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:bytes});
      })();routeTasks.add(task);return task.finally(()=>routeTasks.delete(task));
    });
    await page.goto(de?'/de/canvas/':'/canvas/');await page.locator('#canvasAgentToggle').click();
    const panel=page.locator('#canvasAgentPanel'),composer=panel.locator('.canvas-agent__composer'),transcript=panel.locator('.canvas-agent__messages');
    if(scenario==='diagnostic_revocation'){
      const projectBefore=await DB.prepare('SELECT revision,assembly_json FROM canvas_projects WHERE id=?').bind(f.project).first();
      for(const state of ['active','saved']){
        if(state==='saved'){
          const current=await c.read();await c.data(await c.post('/allowance',{capCredits:3000,diagnostics:true,expectedConversationRevision:current.revision}));
          await c.control('save');await page.reload();await page.locator('#canvasAgentToggle').click();
        }
        const before=await c.read();expect(before.state).toBe(state);expect(before.allowance.diagnosticsAuthorized).toBe(true);
        if(state==='active')expect(before.pendingTurnId).toBeTruthy();
        await panel.getByRole('tab',{name:de?'Projekt & Produktion':'Project & production',exact:true}).click();
        await panel.locator('.canvas-agent__advanced > summary').click();await panel.locator('.canvas-agent__finance > summary').click();
        await expect(panel.getByRole('button',{name:de?'Gesprächsbudget und automatische Erklärungen ändern':'Change conversation allowance and automatic explanations',exact:true})).toBeDisabled();
        const revoke=panel.getByRole('button',{name:de?'Automatische KI-Erklärungen ausschalten':'Turn off automatic AI explanations',exact:true});
        await expect(revoke).toBeEnabled();
        const accepted=page.waitForResponse(response=>new URL(response.url()).pathname===c.route+'/allowance'&&response.request().method()==='POST');
        await revoke.click();const response=await accepted;expect(response.status()).toBe(200);
        expect(response.request().postDataJSON()).toEqual({capCredits:3000,diagnostics:false,expectedConversationRevision:before.revision});
        expect(response.request().headers()['idempotency-key']).toBeTruthy();
        const after=await c.read();expect(after.allowance.diagnosticsAuthorized).toBe(false);expect(after.allowance.capCredits).toBe(3000);
        expect(after.pendingTurnId).toBe(before.pendingTurnId);expect(after.state).toBe(state);expect(after.briefRevision).toBe(before.briefRevision);
        await expect(revoke).toBeHidden();
      }
      expect(requests.filter(row=>row.path===c.route+'/allowance'&&row.method==='POST')).toHaveLength(2);
      expect(await DB.prepare('SELECT revision,assembly_json FROM canvas_projects WHERE id=?').bind(f.project).first()).toEqual(projectBefore);
      expect(c.calls).toHaveLength(0);expect(errors).toEqual([]);
      expect((await DB.prepare('SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=? AND amount<0').bind(f.owner).first()).n).toBe(0);
      return;
    }
    if(proactive){
      // The browser clock does not advance the real Worker/D1 route harness.
      // Drain those responses between ticks; otherwise an artificial 61s jump
      // creates HTTP timeouts unrelated to incident deduplication.
      const advance=async milliseconds=>{for(let remaining=milliseconds;remaining>0;remaining-=1000){await page.clock.runFor(Math.min(1000,remaining));while(routeTasks.size)await Promise.all([...routeTasks]);}};
      const {syncCanvasProjectIncidents}=await import('../../workers/auth/src/lib/canvas-agent-incidents.js');
      const {appendCanvasAgentEvent}=await import('../../workers/auth/src/lib/canvas-agent-progress.js');
      const input=composer.locator('textarea'),viewport=panel.locator('.canvas-agent__transcript'),badge=page.locator('#canvasNotificationsToggle .canvas-notifications__badge');
      await expect(input).toBeEnabled();await expect(transcript).toContainText(de?'Wie weit bist du?':'How far along are you?');
      const before=await c.read(),projectBefore=await DB.prepare('SELECT revision,assembly_json FROM canvas_projects WHERE id=?').bind(f.project).first();
      const userPosts=requests.filter(r=>r.path.endsWith('/conversation/messages')).length;
      const readCount=()=>requests.filter(r=>r.path===c.route&&r.method==='GET').length;
      await input.fill(de?'Ungesendeter kreativer Entwurf':'Unsent creative draft');
      await viewport.evaluate(node=>{node.scrollTop=0;node.dispatchEvent(new Event('scroll'));});
      await advance(100);
      const anchor=await viewport.evaluate(node=>({id:node.querySelector('[data-message-id]').dataset.messageId,top:node.scrollTop}));
      const readsBefore=readCount();
      if(scenario==='incident'){
        await DB.prepare("UPDATE canvas_agent_runs SET status='blocked',phase='planning',error_code='canvas_agent_plan_invalid' WHERE id=?").bind(f.runId).run();
        const run=await DB.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(f.runId).first();
        for(let i=0;i<2;i++)await appendCanvasAgentEvent(f.env,run,'synthetic-invalid-plan','error',{code:'canvas_agent_plan_invalid',tool:'production.reconcile',phase:'planning'});
      }else{
        // The normal title-save/reportError caller loses a server response;
        // notification transport also fails, so local application copy must
        // speak immediately without claiming the production itself stopped.
        saveOutage=true;noticeOutage=true;
        await page.locator('#canvasProjectTitle').fill('Unsaved manual title');await input.focus();
        await advance(2000);
        await expect(transcript).toContainText(de?'noch nicht synchronisiert':'not synchronized yet');
        await expect(transcript).toContainText(de?'kann den Ausgang noch nicht sicher bestätigen':'cannot yet confirm its outcome');
        await expect(badge).toBeVisible();
        noticeOutage=false;await page.evaluate(()=>window.dispatchEvent(new Event('online')));
        await expect.poll(async()=>Number((await DB.prepare('SELECT COUNT(*) AS n FROM canvas_notification_clients WHERE project_id=?').bind(f.project).first()).n)).toBe(1);
      }
      // This is the actual server background collector, not a browser request
      // or a prefilled final conversation response. Replaying its work must
      // publish exactly one persisted explanation with no inference allowance.
      await syncCanvasProjectIncidents(f.env,{projectId:f.project,userId:f.owner,allowInference:false});
      await syncCanvasProjectIncidents(f.env,{projectId:f.project,userId:f.owner,allowInference:false});
      expect((await DB.prepare('SELECT COUNT(*) AS n FROM canvas_agent_incident_explanations x JOIN canvas_agent_incidents i ON i.id=x.incident_id WHERE i.project_id=?').bind(f.project).first()).n).toBe(1);
      await advance(31000);
      await expect(transcript).toContainText(de?'Canvas-Systemerklärung':'Canvas system explanation');
      await expect(transcript).toContainText(scenario==='incident'?(de?'Der Produktionsplan konnte nicht übernommen werden':'The production plan could not be accepted'):(de?'kein Nachweis dafür, dass die Produktion angehalten wurde':'does not establish that production stopped'));
      await expect(transcript).toContainText(de?'KI-Analyse':'AI analysis');
      await expect(transcript.locator('[data-message-id^="local:incident:"]')).toHaveCount(0);
      expect(readCount()).toBeGreaterThan(readsBefore);
      await expect(input).toBeFocused();await expect(input).toHaveValue(de?'Ungesendeter kreativer Entwurf':'Unsent creative draft');
      expect(await viewport.evaluate(node=>node.scrollTop)).toBeLessThanOrEqual(anchor.top+2);
      await expect(panel.locator('.canvas-agent__new-messages')).toBeVisible();
      await expect(transcript.locator('.canvas-agent__model-label')).toHaveCount(0);
      await expect(panel.locator('.canvas-agent__conversation-actions section')).toHaveCount(0);
      const after=await c.read();expect(after.revision,'Explanation leaves conversation revision unchanged').toBe(before.revision);expect(after.briefRevision,'Explanation leaves brief revision unchanged').toBe(before.briefRevision);expect(after.explanationRevision).toBeGreaterThan(before.explanationRevision||0);
      expect(await DB.prepare('SELECT revision,assembly_json FROM canvas_projects WHERE id=?').bind(f.project).first()).toEqual(projectBefore);
      expect(c.calls).toHaveLength(0);expect(requests.filter(r=>r.path.endsWith('/conversation/messages'))).toHaveLength(userPosts);
      expect((await DB.prepare('SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=? AND amount<0').bind(f.owner).first()).n).toBe(0);
      const transcriptCount=await transcript.locator('[data-message-id]').count();await advance(61000);
      const diagnostic=JSON.stringify({before:transcriptCount,messages:await transcript.locator('[data-message-id]').evaluateAll(rows=>rows.map(row=>({id:row.dataset.messageId,text:row.textContent}))),incidents:(await DB.prepare('SELECT source_notification_id,source_key,state,revision FROM canvas_agent_incidents WHERE project_id=?').bind(f.project).all()).results,requests:requests.slice(-20).map(({path,method})=>({path,method}))});
      const diagnosticPath=info.outputPath('proactive-dedup-state.json');require('fs').writeFileSync(diagnosticPath,diagnostic);await info.attach('proactive-dedup-state',{contentType:'application/json',path:diagnosticPath});
      expect(await transcript.locator('[data-message-id]').count(),'Duplicate observation must not append chat messages').toBe(transcriptCount);
      await page.locator('#canvasNotificationsToggle').click();await expect(page.locator('#canvasNotificationsPanel')).toContainText(scenario==='incident'?'canvas_agent_plan_invalid':'synthetic_save_unavailable');
      await page.keyboard.press('Escape');await expect(badge).toBeVisible();
      await panel.getByRole('tab',{name:de?'Projekt & Produktion':'Project & production',exact:true}).click();
      await panel.locator('.canvas-agent__advanced > summary').click();await panel.locator('.canvas-agent__finance > summary').click();
      await panel.getByRole('button',{name:de?'Gesprächsbudget und automatische Erklärungen ändern':'Change conversation allowance and automatic explanations',exact:true}).click();
      await expect(panel.locator('[name=diagnostics]')).not.toBeChecked();await expect(panel.locator('[name=briefingBudget]')).toHaveValue('3000');
      if(scenario==='incident'){
        const messageId=after.messages.find(message=>message.kind==='incident_explanation').id;
        await transcript.locator(`[data-message-id="${messageId}"]`).evaluate(node=>{window.incidentMessageNode=node;});
        await panel.locator('[name=diagnostics]').check();
        const approved=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/conversation/allowance')&&response.request().method()==='POST');
        await panel.locator('.canvas-agent__allowance').getByRole('button',{name:de?'Dieses Gesprächsbudget freigeben':'Authorize this briefing allowance',exact:true}).click();
        expect((await approved).status()).toBe(200);expect((await c.read()).allowance.diagnosticsAuthorized).toBe(true);
        await syncCanvasProjectIncidents(f.env,{projectId:f.project,userId:f.owner});await c.deliver();
        const explanation=de?'Der gespeicherte Plan wurde bei der Prüfung abgelehnt. Die Erklärung startet keine neue Produktion.':'The stored plan was rejected during validation. This explanation does not start another production.';
        await c.complete({text:explanation,intent:'status'});await c.deliver();await advance(31000);
        const modelReply=transcript.locator(`[data-message-id="${messageId}"]`);
        await expect(modelReply).toContainText(explanation);await expect(modelReply.locator('.canvas-agent__model-label')).toHaveText('Grok 4.7');
        expect(await modelReply.evaluate(node=>node===window.incidentMessageNode)).toBe(true);
        expect((await c.read()).messages.filter(message=>message.kind==='incident_explanation')).toHaveLength(1);
        expect(c.calls).toHaveLength(1);expect((await c.read()).allowance.capCredits).toBe(3000);
        expect((await DB.prepare('SELECT status FROM canvas_agent_runs WHERE id=?').bind(f.runId).first()).status).toBe('blocked');
      }
      expect(errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await info.attach('proactive-error-delivery',{contentType:'application/json',body:JSON.stringify({scenario,locale,source:'original operation/notification -> real D1 incident collector -> persisted conversation -> idle observer',providerCalls:c.calls.length,explanationCount:1,creativeRevisionUnchanged:true})});
      return;
    }
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
  } finally {if(!page.isClosed()){await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}))).catch(()=>{});await page.unrouteAll({behavior:'wait'});await page.close();}if(c)await c.f.atClock(async()=>{});c?.restore();DB.close();}
};
