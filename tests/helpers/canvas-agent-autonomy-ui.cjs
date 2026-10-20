const {responseBytes}=require('./canvas-agent-ui.cjs');

async function mount({page,locale,mockSharedAuth,createCanvasApiMock,f,requests,errors,loseDecision,holdTakeover}) {
    await page.setViewportSize({width:locale==='de'?390:1440,height:1000});
    await mockSharedAuth(page,true,'user',f.owner);createCanvasApiMock(page);page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/api/account/canvas/**',async route=>{
        const req=route.request(),url=new URL(req.url()),body=req.postData()?req.postDataJSON():undefined;
        const headers={};for(const name of ['Idempotency-Key','X-Bitbi-Tariff-Revision'])if(req.headers()[name.toLowerCase()])headers[name]=req.headers()[name.toLowerCase()];
        requests.push({path:url.pathname,method:req.method(),body,key:headers['Idempotency-Key'],tariff:headers['X-Bitbi-Tariff-Revision']});
        const response=await f.request(url.pathname+url.search,req.method(),body,headers),bytes=await responseBytes(response);
        if(loseDecision?.value&&url.pathname.endsWith('/budget')&&req.method()==='POST'){loseDecision.value=false;return route.abort('failed');}
        if(holdTakeover?.response&&req.method()==='POST'&&url.pathname.endsWith('/control')&&body?.action==='takeover'){
            holdTakeover.response=false;holdTakeover.projectRead=true;
            await new Promise(resolve=>{holdTakeover.releaseResponse=()=>{delete holdTakeover.releaseResponse;resolve();};});
        }else if(holdTakeover?.projectRead&&req.method()==='GET'&&url.pathname===f.projectPath){
            holdTakeover.projectRead=false;
            await new Promise(resolve=>{holdTakeover.releaseProjectRead=()=>{delete holdTakeover.releaseProjectRead;resolve();};});
        }
        if(!page.isClosed())await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:bytes});
    });
    await page.goto(locale==='de'?'/de/canvas/':'/canvas/');await page.locator('#canvasAgentToggle').click();if(await page.locator('#canvasAgentPanel').isVisible())await page.locator('#canvasAgentPanel').getByRole('tab',{name:locale==='de'?'Projekt & Produktion':'Project & production',exact:true}).click();
    return page.locator('#canvasAgentPanel');
}

exports.proposal=async({page,expect,locale,info,mockSharedAuth,createCanvasApiMock})=>{
    const {SqliteD1Database,applyAuthMigrations}=require('./sqlite-d1.js'),{createAuthTestEnv}=require('./auth-worker-harness.js');
    const {canvasAgentAutonomyFixture}=await import('./canvas-agent-autonomy-control.mjs');
    const {freshCanvasAgentPlan}=await import('./canvas-agent-control.mjs');
    const DB=new SqliteD1Database();applyAuthMigrations(DB);const errors=[],requests=[],de=locale==='de';
    try{
        const plan=freshCanvasAgentPlan(),image=key=>({key,type:'image_generation',title:'House reference',modelId:'openai/gpt-image-2',prompt:'The same house next to its duck pool.',config:{},dependencies:[]});
        plan.nodes=[image('first'),image('reference'),{...plan.nodes[0],key:'shot',title:'House construction',config:{duration:4,resolution:'768P',aspectRatio:'16:9'},dependencies:[{key:'first',role:'first_frame'},{key:'reference',role:'reference_image'}]}];
        plan.assembly={...plan.assembly,targetDurationSeconds:4,clips:[{key:'shot',trim:{start:0,duration:4},transition:{preset:'none'}}]};
        const f=await canvasAgentAutonomyFixture({...createAuthTestEnv(),DB},{scope:'autonomy-ui-'+locale,locale,plan});
        expect(Object.hasOwn(f.input,'targetDurationSeconds')).toBe(false);
        await f.deliver();expect(f.calls).toHaveLength(1);
        const holdTakeover={},panel=await mount({page,locale,mockSharedAuth,createCanvasApiMock,f,requests,errors,holdTakeover});
        const inbox=page.locator('#canvasNotificationsPanel'),check=panel.getByRole('button',{name:de?'Status prüfen':'Check status',exact:true});
        await expect(panel.locator('h3')).toHaveText(de?'Antwort des Anbieters ausstehend':'Waiting for the provider response');
        await expect(panel.locator('.canvas-agent__events,.canvas-agent__activity')).toHaveCount(0);
        const originalNotices=await f.data(await f.request('/api/account/canvas/notifications'));
        const dispatched=originalNotices.items.find(item=>item.source==='event'&&item.details.tool==='model.background');
        expect(dispatched).toBeTruthy();await page.locator('#canvasNotificationsToggle').click();
        await expect(inbox.locator(`[data-notification-id="${dispatched.id}"]`)).toContainText(de?'Planungsauftrag angenommen.':'Planning request accepted.');
        await expect(inbox).not.toContainText('Keep the same house and neighboring duck pool');
        await inbox.getByRole('button',{name:de?'Meldungen schließen':'Close notifications',exact:true}).click();
        expect((await f.complete()).status).toBe(200);
        await check.click();await expect(panel.locator('.canvas-agent__plan')).toContainText('House construction');
        // The approved structured continuity is public project data; the
        // fixture's different provider reasoning_content must stay private.
        expect(plan.continuity).toBe('Keep the same house and pool positions across the three shots.');
        await expect(panel.locator('.canvas-agent__plan')).toContainText(plan.continuity);
        await expect(panel.locator('.canvas-agent__plan')).not.toContainText('Keep the same house and neighboring duck pool');
        expect((await f.data(await f.request(f.projectPath))).nodes).toHaveLength(0);
        // The real queue discovers the bad combination and retains its feedback
        // before any second model call or media submission.
        await f.deliver();const before=await f.observe();
        expect(before.proposedPlan.validation.issues.some(issue=>issue.code==='canvas_agent_h3_reference_modes_mixed')).toBe(true);
        await check.click();await expect(panel.locator('.canvas-agent__plan')).toContainText('H3 cannot combine');
        expect(f.calls).toHaveLength(1);
        await page.locator('#canvasNotificationsToggle').click();
        const eventIds=await inbox.locator('[data-notification-id^="event:"]').evaluateAll(nodes=>nodes.map(node=>node.dataset.notificationId));
        expect(eventIds.length).toBeGreaterThan(0);expect(new Set(eventIds).size).toBe(eventIds.length);
        await expect(inbox).not.toContainText('Keep the same house and neighboring duck pool');
        await inbox.getByRole('button',{name:de?'Meldungen schließen':'Close notifications',exact:true}).click();
        // Explicit manual takeover is the only browser mutation in this case.
        // A click and even an accepted server receipt precede completion of the
        // response and the follow-up project read. Reload only after both.
        const inspect=panel.getByRole('button',{name:de?'Projekt öffnen':'Open project',exact:true,includeHidden:true});
        holdTakeover.response=true;
        await panel.getByRole('button',{name:de?'Manuell übernehmen':'Take over manually',exact:true}).click();
        await expect.poll(()=>typeof holdTakeover.releaseResponse).toBe('function');
        expect((await f.observe()).status).toBe('taken_over');await expect(inspect).toBeDisabled();
        expect(requests.filter(item=>item.method!=='GET').map(item=>item.body)).toEqual([{action:'takeover'}]);
        const takeoverResponse=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname===`${f.projectPath}/agent/${f.runId}/control`);
        holdTakeover.releaseResponse();expect(await (await takeoverResponse).finished()).toBeNull();
        await expect.poll(()=>typeof holdTakeover.releaseProjectRead).toBe('function');
        // The run has been accepted, but control() renders its final state
        // only after view() completes. The open-project control remains busy.
        await expect(inspect).toBeDisabled();
        const projectResponse=page.waitForResponse(response=>response.request().method()==='GET'&&new URL(response.url()).pathname===f.projectPath);
        holdTakeover.releaseProjectRead();expect(await (await projectResponse).finished()).toBeNull();await expect(inspect).toBeEnabled();await expect(panel.locator('h3')).toHaveText(de?'Manuell übernommen':'Taken over manually');await expect(panel).toBeHidden();
        await page.reload();await page.locator('#canvasAgentToggle').click();if(await page.locator('#canvasAgentPanel').isVisible())await page.locator('#canvasAgentPanel').getByRole('tab',{name:locale==='de'?'Projekt & Produktion':'Project & production',exact:true}).click();
        await expect(panel.locator('h3')).toHaveText(de?'Manuell übernommen':'Taken over manually');
        await expect(panel.locator('.canvas-agent__plan')).toContainText('House construction');
        await expect(panel.locator('.canvas-agent__plan')).toContainText(plan.continuity);
        await expect(panel.locator('.canvas-agent__plan')).not.toContainText('Keep the same house and neighboring duck pool');
        await expect(panel.locator('.canvas-agent__cause')).toHaveCount(0);
        const after=await f.observe();expect(after.proposedPlan.revision).toBe(before.proposedPlan.revision);expect(after.chargedCredits).toBe(before.chargedCredits);
        await f.deliver();expect(f.calls).toHaveLength(1);expect((await f.data(await f.request(f.projectPath))).nodes).toHaveLength(0);
        expect(requests.filter(item=>item.method!=='GET').map(item=>item.body)).toEqual([{action:'takeover'}]);
        expect(errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        await info.attach('persisted-autonomy-proposal',{contentType:'application/json',body:JSON.stringify({runId:f.runId,providerCalls:f.calls.length,charged:after.chargedCredits,proposal:after.proposedPlan.revision,issue:before.proposedPlan.validation.issues[0].code,stopped:after.status,events:eventIds.length})});
        await panel.screenshot({path:info.outputPath(`canvas-autonomy-proposal-${locale}.png`)});
    }finally{if(!page.isClosed())await page.close();DB.close();}
};

exports.budget=async({page,expect,locale,info,mockSharedAuth,createCanvasApiMock,manualEdit=false})=>{
    const {SqliteD1Database,applyAuthMigrations}=require('./sqlite-d1.js'),{createAuthTestEnv}=require('./auth-worker-harness.js');
    const {canvasAgentBudgetFixture}=await import('./canvas-agent-autonomy-control.mjs');
    const {requestCanvasAgentBudget}=await import('../../workers/auth/src/lib/canvas-agent-budget.js');
    const DB=new SqliteD1Database();applyAuthMigrations(DB);const errors=[],requests=[],de=locale==='de';
    try{
        const f=await canvasAgentBudgetFixture({...createAuthTestEnv(),DB},'budget-ui-'+locale,locale);
        let editable=null;
        if(manualEdit){const response=await f.request(f.projectPath+'/nodes','POST',{type:'note',title:'My existing note',content:{text:'Manual work'}});expect(response.status).toBe(201);editable=(await response.json()).data.node;}
        const run=await f.createRun('ui-cap',200);
        await f.allocate(run,'existing',150);
        const amendment=await requestCanvasAgentBudget(f.env,run,{requiredCredits:100,reasonKey:'ui-budget',reasonCode:'canvas_agent_plan_correction',model:'xai/grok-4.7',action:'plan.repair'});
        const loseDecision={value:!manualEdit},panel=await mount({page,locale,mockSharedAuth,createCanvasApiMock,f,requests,errors,loseDecision});
        const box=panel.locator('.canvas-agent__budget'),accept=box.getByRole('button',{name:de?'Dieses neue Limit freigeben':'Authorize this new cap',exact:true});
        await expect(accept).toBeEnabled();await expect(box).toContainText('250');await expect(box).toContainText('50');
        const summary=panel.locator('.canvas-agent__production > .canvas-agent__summary');
        await expect(summary.getByText(de?'Abgerechnet und bereits beauftragt (Credits)':'Charged and already committed (credits)',{exact:true}).locator('xpath=following-sibling::dd[1]')).toHaveText('150');
        await expect(summary.getByText(de?'Noch innerhalb des Limits verfügbar (Credits)':'Remaining within the cap (credits)',{exact:true}).locator('xpath=following-sibling::dd[1]')).toHaveText('50');
        expect(requests.filter(item=>item.method!=='GET')).toEqual([]);
        if(manualEdit){
            let held=null;const nodePath=f.projectPath+'/nodes/'+editable.id;
            await page.route('**'+nodePath,route=>{if(route.request().method()==='PATCH'){held=route;return;}return route.fallback();});
            await page.locator('#canvasAgentToggle').click();if(await page.locator('#canvasAgentPanel').isVisible())await page.locator('#canvasAgentPanel').getByRole('tab',{name:locale==='de'?'Projekt & Produktion':'Project & production',exact:true}).click();
            if(de&&await page.locator('#canvasGraphToggle').getAttribute('aria-pressed')!=='true')await page.locator('#canvasGraphToggle').click();
            await page.locator(`[data-node-id="${editable.id}"]`).press('Enter');
            const inspector=page.locator('#canvasInspectorPanel'),inspectorToggle=page.locator('#canvasInspectorToggle');
            const titleControl=page.locator('#canvasInspectorBody').getByRole('textbox',{name:de?'Titel':'Title',exact:true});
            // Selecting a node does not reopen a closed detail panel. Calibrate
            // that boundary before opening the ordinary editor in either locale.
            await expect(inspector).toHaveCount(1);await expect(inspector).toBeHidden();
            await expect(inspectorToggle).toHaveAttribute('aria-expanded','false');await expect(titleControl).toBeHidden();
            expect(held).toBe(null);expect(requests.filter(item=>item.method!=='GET')).toEqual([]);
            await inspectorToggle.click();await expect(inspector).toBeVisible();await expect(titleControl).toBeVisible();
            await titleControl.fill('My manual node edit');
            // Hold the real ordinary save in flight. Without the first-decision
            // flush, the old revision could still authorize work ahead of it.
            await expect.poll(()=>Boolean(held)).toBe(true);
            await page.locator('#canvasAgentToggle').click();if(await page.locator('#canvasAgentPanel').isVisible())await page.locator('#canvasAgentPanel').getByRole('tab',{name:locale==='de'?'Projekt & Produktion':'Project & production',exact:true}).click();await expect(accept).toBeEnabled();
            const budgetResponse=page.waitForResponse(response=>response.url().endsWith('/budget')&&response.request().method()==='POST');
            await accept.click();await expect(accept).toBeDisabled();
            expect(requests.filter(item=>item.path.endsWith('/budget'))).toEqual([]);
            const saved=await f.request(nodePath,'PATCH',held.request().postDataJSON());expect(saved.status).toBe(200);
            await held.fulfill({status:saved.status,headers:Object.fromEntries(saved.headers),body:await responseBytes(saved)});
            const rejected=await budgetResponse;expect(rejected.status()).toBe(409);
            expect(await rejected.json()).toMatchObject({ok:false,code:'canvas_agent_budget_request_changed'});
            await require('./canvas-agent-ui.cjs').expectNotification({page,expect,locale},'canvas_agent_budget_request_changed',de?
                'Diese Budgetanfrage passt nicht mehr zum aktuellen Projekt oder Limit. Sie kann nicht mehr freigegeben werden.':
                'This budget request no longer matches the current project or cap. It can no longer be approved.');
            const decisions=requests.filter(item=>item.path.endsWith('/budget'));expect(decisions).toHaveLength(1);
            expect(decisions[0].body.expectedRevision).toBe(amendment.project_revision);
            expect((await DB.prepare('SELECT budget_credits FROM canvas_agent_runs WHERE id=?').bind(run.id).first()).budget_credits).toBe(200);
            expect((await DB.prepare('SELECT status FROM canvas_agent_budget_requests WHERE id=?').bind(amendment.id).first()).status).toBe('pending');
            expect((await DB.prepare('SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=? AND amount<0').bind(f.owner).first()).n).toBe(0);
            expect((await DB.prepare('SELECT title FROM canvas_nodes WHERE id=?').bind(editable.id).first()).title).toBe('My manual node edit');
            expect((await DB.prepare('SELECT revision FROM canvas_projects WHERE id=?').bind(f.project).first()).revision).toBe(amendment.project_revision+1);
            expect(f.unexpected).toEqual([]);expect(errors).toEqual([]);return;
        }
        await accept.click();
        const retry=panel.getByRole('button',{name:new RegExp(de?'Ursprüngliche Budgetentscheidung prüfen':'Check original budget decision')});
        await expect(retry).toBeVisible();
        // The server already accepted the first request. Reopening and retrying
        // can only observe/replay its immutable decision, never create a charge.
        expect((await DB.prepare('SELECT status FROM canvas_agent_budget_requests WHERE id=?').bind(amendment.id).first()).status).toBe('accepted');
        await page.reload();await page.locator('#canvasAgentToggle').click();if(await page.locator('#canvasAgentPanel').isVisible())await page.locator('#canvasAgentPanel').getByRole('tab',{name:locale==='de'?'Projekt & Produktion':'Project & production',exact:true}).click();await expect(retry).toBeVisible();await retry.click();await expect(retry).toBeHidden();
        const decisions=requests.filter(item=>item.path.endsWith('/budget'));
        expect(decisions).toHaveLength(2);expect(decisions[1]).toEqual(decisions[0]);
        expect(decisions[0].body).toEqual({requestId:amendment.id,requestRevision:amendment.revision,decision:'accept',proposedCapCredits:250,expectedRevision:amendment.project_revision});
        expect(decisions[0].tariff).toBe(String(amendment.tariff_revision));
        expect((await DB.prepare('SELECT budget_credits FROM canvas_agent_runs WHERE id=?').bind(run.id).first()).budget_credits).toBe(250);
        expect((await DB.prepare('SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=? AND amount<0').bind(f.owner).first()).n).toBe(0);
        expect(f.unexpected).toEqual([]);expect(errors).toEqual([]);
        await info.attach('persisted-budget-decision',{contentType:'application/json',body:JSON.stringify({requestId:amendment.id,cap:250,decisionPosts:2,sameIdentity:true,debits:0})});
    }finally{if(!page.isClosed())await page.close();DB.close();}
};
exports.budget_edits=options=>exports.budget({...options,manualEdit:true});
