module.exports=async({page,expect,locale,info,mockSharedAuth,createCanvasApiMock})=>{
    const {SqliteD1Database,applyAuthMigrations}=require('./sqlite-d1.js');
    const {createAuthTestEnv}=require('./auth-worker-harness.js');
    const {canvasAgentModelOperationFixture}=await import('./canvas-agent-model-operation-control.mjs');
    const DB=new SqliteD1Database();applyAuthMigrations(DB);
    const requests=[],errors=[],de=locale==='de';let activePage=page;
    try {
        const f=await canvasAgentModelOperationFixture({...createAuthTestEnv(),DB},{scope:'model-browser-'+locale});
        await f.deliver();
        const pending=await f.observe(),op=await f.operation();
        expect(f.calls.length).toBe(1);expect(pending.modelOperation.outcome).toBe('pending');
        expect(pending.reservedCredits).toBeGreaterThan(0);expect(pending.chargedCredits).toBe(0);
        const reserved=await DB.prepare('SELECT credit_cost,billing_status,provider_outcome FROM member_ai_usage_attempts_v2 WHERE id=?').bind(op.usage_attempt_id).first();
        expect(reserved.billing_status).toBe('reserved');expect(reserved.provider_outcome).toBe('dispatched');
        expect(pending.reservedCredits).toBe(reserved.credit_cost);
        expect((await DB.prepare('SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=? AND amount<0').bind(f.owner).first()).n).toBe(0);
        const install=async target=>{
            await target.setViewportSize({width:de?390:1440,height:1000});
            await mockSharedAuth(target,true,'user',f.owner);createCanvasApiMock(target);target.on('pageerror',error=>errors.push(error.message));
            await target.route('**/api/account/canvas/**',async route=>{
                const req=route.request(),url=new URL(req.url());requests.push({path:url.pathname,method:req.method()});
                const response=await f.request(url.pathname+url.search,req.method(),req.postData()??undefined,
                    req.headers()['idempotency-key']?{'Idempotency-Key':req.headers()['idempotency-key']}:{});
                const body=await require('./canvas-agent-ui.cjs').responseBytes(response);
                if(!target.isClosed())await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body});
            });
            await target.goto(de?'/de/canvas/':'/canvas/');await target.locator('#canvasAgentToggle').click();await target.locator('#canvasAgentPanel').getByRole('tab',{name:de?'Projekt & Produktion':'Project & production',exact:true}).click();
        };
        await install(activePage);
        let panel=activePage.locator('#canvasAgentPanel');
        const value=label=>panel.locator('.canvas-agent__production > .canvas-agent__summary').getByText(label,{exact:true}).locator('xpath=following-sibling::dd[1]');
        await expect(panel.locator('h3')).toHaveText(de?'Antwort des Anbieters ausstehend':'Waiting for the provider response');
        await expect(value(de?'Produktionsschritt':'Production step')).toHaveText(de?'Geschichte und Einstellungen planen':'Planning story and settings');
        await expect(value(de?'Im Guthaben reserviert (Credits)':'Reserved in wallet (credits)')).toHaveText(String(pending.reservedCredits));
        await expect(value(de?'Bereits abgerechnet (Credits)':'Already charged (credits)')).toHaveText('0');
        // Expiry crosses the immutable receipt deadline with a coherent clock;
        // it uses the real observer, not a mocked run/status response.
        const unknown=await f.expire();expect(unknown.modelOperation.outcome).toBe('unknown');
        await panel.getByRole('button',{name:de?'Status prüfen':'Check status',exact:true}).click();
        await expect(panel.locator('h3')).toHaveText(de?'Anbieterergebnis ungeklärt':'Provider outcome unknown');
        await expect(panel.getByRole('button',{name:de?'Fortsetzen':'Resume',exact:true})).toBeHidden();
        const reopened=await activePage.context().newPage();await activePage.close();activePage=reopened;
        await install(activePage);panel=activePage.locator('#canvasAgentPanel');
        await expect(panel.locator('h3')).toHaveText(de?'Anbieterergebnis ungeklärt':'Provider outcome unknown');
        await expect(value(de?'Im Guthaben reserviert (Credits)':'Reserved in wallet (credits)')).toHaveText(String(pending.reservedCredits));
        expect((await f.observe()).id).toBe(f.runId);expect(f.calls.length).toBe(1);
        expect(requests.filter(request=>request.method!=='GET')).toEqual([]);
        const unrelated=await f.complete({id:'unrelated-provider-run'});
        expect(unrelated.status).toBe(409);expect((await unrelated.json()).code).toBe('canvas_agent_model_identity_mismatch');
        await panel.getByRole('button',{name:de?'Status prüfen':'Check status',exact:true}).click();
        await expect(panel.locator('h3')).toHaveText(de?'Anbieterergebnis ungeklärt':'Provider outcome unknown');
        await expect(value(de?'Bereits abgerechnet (Credits)':'Already charged (credits)')).toHaveText('0');
        expect((await f.data(await f.request(f.projectPath))).nodes).toHaveLength(0);
        // The signed late result arrives independently of the page. Duplicate
        // callbacks/queue deliveries must share the original usage and graph.
        expect((await f.complete()).status).toBe(200);expect((await f.complete()).status).toBe(200);
        await f.deliver();
        const settled=await f.observe(),project=await f.data(await f.request(f.projectPath));
        expect(settled.modelOperation.outcome).toBe('completed');expect(settled.modelOperation.operationId).toBe(op.id);
        expect(settled.status).toBe('running');expect(settled.phase).toBe('generating');expect(settled.reservedCredits).toBe(0);
        const usage=await DB.prepare('SELECT idempotency_key,billing_status,provider_outcome FROM member_ai_usage_attempts_v2 WHERE id=?').bind(op.usage_attempt_id).first();
        const debits=(await DB.prepare('SELECT amount FROM member_credit_ledger WHERE user_id=? AND idempotency_key=? AND amount<0').bind(f.owner,usage.idempotency_key).all()).results;
        expect(usage.billing_status).toBe('finalized');expect(usage.provider_outcome).toBe('succeeded');expect(debits).toHaveLength(1);
        expect(-debits[0].amount).toBeGreaterThan(0);expect(-debits[0].amount).toBeLessThan(pending.reservedCredits);
        expect(settled.chargedCredits).toBe(-debits[0].amount);
        expect(project.nodes.filter(node=>node.type==='video_generation')).toHaveLength(3);
        expect(project.project.assembly.clips).toHaveLength(3);
        // Planning has created editable clips, but no media request or result.
        // Establish the displayed waiting count from persisted execution facts.
        const mediaSteps=(await DB.prepare(`SELECT s.node_id,s.status,s.usage_attempt_id,s.receipt_json,n.output_json,n.asset_id
            FROM canvas_agent_steps s JOIN canvas_nodes n ON n.id=s.node_id
            WHERE s.run_id=? AND s.kind='node' AND n.user_id=? AND n.project_id=? AND n.type='video_generation'`)
            .bind(f.runId,f.owner,f.project).all()).results;
        expect(mediaSteps).toHaveLength(3);
        expect(mediaSteps.map(step=>step.node_id).sort()).toEqual(project.nodes.filter(node=>node.type==='video_generation').map(node=>node.id).sort());
        for(const step of mediaSteps)expect(step).toEqual({node_id:step.node_id,status:'ready',usage_attempt_id:null,receipt_json:null,output_json:null,asset_id:null});
        expect((await DB.prepare('SELECT COUNT(*) AS n FROM canvas_runs WHERE user_id=? AND project_id=?').bind(f.owner,f.project).first()).n).toBe(0);
        expect((await DB.prepare('SELECT COUNT(*) AS n FROM member_generation_jobs WHERE user_id=?').bind(f.owner).first()).n).toBe(0);
        expect(settled.mediaProgress).toEqual({waiting:3,generating:0,saved:0,blocked:0});
        await panel.getByRole('button',{name:de?'Status prüfen':'Check status',exact:true}).click();
        await expect(panel.locator('h3')).toHaveText(de?'Medien erstellen':'Creating media');
        await expect(value(de?'Im Guthaben reserviert (Credits)':'Reserved in wallet (credits)')).toHaveText('0');
        await expect(value(de?'Bereits abgerechnet (Credits)':'Already charged (credits)')).toHaveText(String(-debits[0].amount));
        await expect(panel.locator('.canvas-agent__counts')).toHaveText(de?'3 warten · 0 in Generierung · 0 gespeichert · 0 blockiert':'3 waiting · 0 generating · 0 saved · 0 blocked');
        expect(f.calls.length).toBe(1);expect(requests.filter(request=>request.method!=='GET')).toEqual([]);expect(errors).toEqual([]);
        expect(await activePage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        await info.attach('model-recovery-evidence',{body:Buffer.from(JSON.stringify({runId:f.runId,operationId:op.id,providerCalls:f.calls.length,
            originalReservation:pending.reservedCredits,charged:settled.chargedCredits,reserved:settled.reservedCredits,ledgerDebits:debits.length,persistedClips:project.project.assembly.clips.length})),contentType:'application/json'});
        await panel.screenshot({path:info.outputPath(`canvas-agent-model-recovery-${locale}.png`)});
    } finally {if(!activePage.isClosed())await activePage.close();DB.close();}
};
