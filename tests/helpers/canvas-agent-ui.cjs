const path = require('node:path');

// Keep the actual Worker stream protocol, but end this test connection after
// its first heartbeat. This exercises reconnect without a 25s held fixture or
// a live reader outlasting its database. It never advances production.
exports.responseBytes=async response=>{
    if(!response.headers.get('content-type')?.startsWith('text/event-stream'))return Buffer.from(await response.arrayBuffer());
    const reader=response.body.getReader(),chunks=[];let bytes=0;
    try{
        for(;;){const {done,value}=await reader.read();if(done)break;chunks.push(Buffer.from(value));bytes+=value.byteLength;
            if(bytes>2_000_000)throw new Error('Unexpected unbounded Canvas event fixture');
            if(Buffer.concat(chunks).toString('utf8').includes('event: heartbeat\n'))break;}
    }finally{await reader.cancel();}
    return Buffer.concat(chunks);
};

async function fixture({page,locale,mockSharedAuth,createCanvasApiMock}) {
    await page.setViewportSize({width:locale==='de'?390:1440,height:960});
    await mockSharedAuth(page);
    const canvas=createCanvasApiMock(page), project='1'.repeat(32), now=new Date().toISOString();
    canvas.projects=[{id:project,title:'Editable film',locale,revision:0,created_at:now,updated_at:now}];
    const state={run:null,available:true,posts:[],controls:[],loseResponse:false,reads:0,events:[],budgetPosts:[]};
    await page.route('**/api/account/canvas/**',async route=>{
        const request=route.request(),url=new URL(request.url());
        if(!url.pathname.includes('/agent'))return route.fallback();
        if(url.pathname.endsWith('/events'))return route.fulfill({status:200,contentType:'text/event-stream',body:'event: heartbeat\ndata: {}\n\n'});
        const respond=()=>route.fulfill({json:{ok:true,data:{availability:{available:state.available,code:state.available?null:'grok_47_unverified',model:'xai/grok-4.7'},run:state.run,events:state.events,eventCursor:state.events.at(-1)?.id||0,hasMore:false}}});
        if(request.method()==='GET'){state.reads++;if(state.failRead){state.failRead=false;return route.fulfill({status:503,json:{ok:false,code:'synthetic_observation_unavailable'}});}if(state.holdRead){state.holdRead=false;state.pendingRead=route;return;}return respond();}
        const body=request.postDataJSON(),key=request.headers()['idempotency-key'];
        if(url.pathname.endsWith('/budget')){
            state.budgetPosts.push({body,key,tariff:request.headers()['x-bitbi-tariff-revision']});
            if(state.rejectBudget)return route.fulfill({status:409,json:{ok:false,code:'canvas_agent_project_changed'}});
            if(state.loseBudget){state.loseBudget=false;return route.abort('failed');}
            state.run={...state.run,budgetCredits:body.decision==='accept'?body.proposedCapCredits:state.run.budgetCredits,budgetRequest:null,status:'running'};
            return respond();
        }
        if(url.pathname.endsWith('/control')){
            state.controls.push({body,key});
            if(state.failControl){state.failControl=false;return route.fulfill({status:409,json:{ok:false,code:'canvas_agent_review_required'}});}
            state.run={...state.run,status:({pause:'paused',resume:'running',cancel:'cancelled',takeover:'taken_over'})[body.action]};
            return respond();
        }
        state.posts.push({body,key});
        if(state.run?.requestKey!==key)state.run={id:'a'.repeat(32),projectId:project,requestKey:key,brief:body.brief,status:'running',phase:'generating',completed:0,total:3,targetDurationSeconds:body.targetDurationSeconds??60,toleranceSeconds:.5,budgetCredits:body.budgetCredits,allocatedCredits:0,projectRevision:0,result:null};
        if(state.loseResponse){state.loseResponse=false;return route.abort('failed');}
        return respond();
    });
    await page.route('**/api/ai/videos/agent-fixture/file',route=>route.fulfill({path:path.join(__dirname,'../fixtures/media/canvas-preview.mp4'),contentType:'video/mp4'}));
    const open=async()=>{await page.goto(locale==='de'?'/de/canvas/':'/canvas/');await page.locator('#canvasAgentToggle').click();};
    await open();
    return {canvas,state,project,open,panel:page.locator('#canvasAgentPanel'),form:page.locator('.canvas-agent__form')};
}

exports.admission=async({page,expect,locale,info,mockSharedAuth,createCanvasApiMock})=>{
    const {canvas,state,panel,form}=await fixture({page,locale,mockSharedAuth,createCanvasApiMock});
    await expect(form.locator('textarea')).toBeEnabled();
    await form.locator('textarea').fill('A comic film about a house being built, a pool with ducks and arriving guests.');
    await form.locator('button[type="submit"]').click();
    // An omitted duration is deliberate automatic planning; money still needs
    // explicit authorization. A submit without a cap cannot create any run.
    expect(state.posts).toEqual([]);
    await expect(panel).toContainText(locale==='de'?'Ausgabenfreigabe':'authorize the spend');
    expect(canvas.requests.filter(request=>request.method==='POST')).toEqual([]);
    await form.locator('[name="budget"]').fill('300');
    await form.locator('[name="authorize"]').check();
    await form.evaluate(node=>{node.requestSubmit();node.requestSubmit();});
    await expect.poll(()=>state.posts.length).toBe(1);
    expect(Object.hasOwn(state.posts[0].body,'targetDurationSeconds')).toBe(false);
    expect(state.posts[0].body.durationChoice).toBe('automatic');
    expect(state.posts[0].body.budgetCredits).toBe(300);
    await expect(form.locator('[name="delegateDuration"]')).toHaveCount(0);
    await expect(panel.locator('.canvas-agent__counts')).toHaveText(locale==='de'?'0 / 3 abgeschlossen':'0 / 3 completed');
    // Completion requires an actual owned saved URL; play its real media bytes.
    state.run={...state.run,status:'completed',phase:'completed',completed:3,result:{exportId:'export-v1',assetId:'agent-fixture',fileUrl:'/api/ai/videos/agent-fixture/file',measuredDurationSeconds:60,technicalValidation:'processor_measured',visualReview:'sampled_frames',evaluation:{accepted:true,issues:[],confidence:'medium',samplingLimit:'Selected frames only.'}}};
    await panel.getByRole('button',{name:locale==='de'?'Status prüfen':'Check status',exact:true}).click();
    const video=panel.locator('video');await expect(video).toBeVisible();
    await video.evaluate(async node=>{node.muted=true;await node.play();});
    await expect.poll(()=>video.evaluate(node=>node.currentTime)).toBeGreaterThan(0);
    await video.evaluate(node=>node.pause());
    await expect(panel.locator('.canvas-agent__production details')).toContainText(locale==='de'?'keine vollständige Prüfung der Bewegung':'motion was not reviewed exhaustively');
    expect(await form.locator('input,textarea').evaluateAll(nodes=>nodes.every(node=>node.labels.length>0))).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await panel.screenshot({path:info.outputPath(`canvas-agent-${locale}.png`)});
    // WebKit does not focus an aside for locator.press(). Exercise the real
    // keyboard path from an interactive descendant; a consumed key must retain it.
    const statusButton=panel.getByRole('button',{name:locale==='de'?'Status prüfen':'Check status',exact:true});
    await statusButton.focus();
    await panel.evaluate(node=>{node.consumedEscape=event=>{if(event.key==='Escape')event.preventDefault();};node.addEventListener('keydown',node.consumedEscape,true);});
    await statusButton.press('Escape');await expect(panel).toBeVisible();
    await panel.evaluate(node=>node.removeEventListener('keydown',node.consumedEscape,true));
    await statusButton.press('Escape');
    await expect(page.locator('#canvasAgentToggle')).toBeFocused();
    await expect(panel).toBeHidden();
};

exports.recovery=async({page,expect,locale,mockSharedAuth,createCanvasApiMock})=>{
    const {canvas,state,panel,form}=await fixture({page,locale,mockSharedAuth,createCanvasApiMock});
    await expect(form.locator('textarea')).toBeEnabled();
    await form.locator('textarea').fill('A realistic 120 second housebuilding film, with ducks in the pool and visitors arriving.');
    await form.locator('[name="budget"]').fill('900');await form.locator('[name="authorize"]').check();
    canvas.projects[0].revision=7;
    state.loseResponse=true;
    await form.locator('button[type="submit"]').click();
    await expect.poll(()=>state.posts.length).toBe(1);
    expect(state.posts[0].body.targetDurationSeconds).toBe(120);
    expect(state.posts[0].body.expectedRevision).toBe(7);
    await expect(panel.getByRole('button',{name:locale==='de'?'Ursprünglichen Start bestätigen':'Confirm original start',exact:true})).toBeVisible();
    await expect(form.locator('[name="delegateDuration"]')).toBeHidden();
    // Explicit retry must carry precisely the original immutable authorization.
    await panel.getByRole('button',{name:locale==='de'?'Ursprünglichen Start bestätigen':'Confirm original start',exact:true}).click();
    await expect.poll(()=>state.posts.length).toBe(2);
    expect(state.posts[1]).toEqual(state.posts[0]);
    await page.reload();await page.locator('#canvasAgentToggle').click();
    await expect(panel.locator('.canvas-agent__counts')).toContainText('0 / 3');
    expect(state.posts.length).toBe(2);
    state.run={...state.run,phase:'waiting_limit'};
    await panel.getByRole('button',{name:locale==='de'?'Status prüfen':'Check status',exact:true}).click();
    await expect(panel.locator('h3')).toHaveText(locale==='de'?'Warten auf das nächste Zeitfenster':'Waiting for the next time window');
    await expect(panel).toContainText(locale==='de'?'im nächsten Zeitfenster automatisch fortgesetzt':'continue automatically in the next time window');
    expect(state.posts.length).toBe(2);
    const stale=structuredClone(state.run);state.holdRead=true;
    await panel.getByRole('button',{name:locale==='de'?'Status prüfen':'Check status',exact:true}).click();
    await expect.poll(()=>Boolean(state.pendingRead)).toBe(true);
    await panel.getByRole('button',{name:locale==='de'?'Pausieren':'Pause',exact:true}).click();
    await expect(panel.locator('h3')).toHaveText(locale==='de'?'Pausiert':'Paused');
    await expect(panel.getByRole('button',{name:locale==='de'?'Fortsetzen':'Resume',exact:true})).toBeVisible();
    await state.pendingRead.fulfill({json:{ok:true,data:{availability:{available:true},run:stale}}});
    await expect(panel.getByRole('button',{name:locale==='de'?'Fortsetzen':'Resume',exact:true})).toBeVisible();
    await panel.getByRole('button',{name:locale==='de'?'Fortsetzen':'Resume',exact:true}).click();
    await expect(panel.getByRole('button',{name:locale==='de'?'Pausieren':'Pause',exact:true})).toBeVisible();
    await panel.getByRole('button',{name:locale==='de'?'Manuell übernehmen':'Take over manually',exact:true}).click();
    await expect.poll(()=>state.controls.map(control=>control.body.action)).toEqual(['pause','resume','takeover']);
    await expect(panel).toBeHidden();
    await page.reload();await page.locator('#canvasAgentToggle').click();
    await expect(panel.locator('h3')).toHaveText(locale==='de'?'Manuell übernommen':'Taken over manually');
    expect(state.posts.length).toBe(2);
    expect(state.controls.every(control=>Boolean(control.key))).toBe(true);
};

exports.duration=async({page,expect,locale,mockSharedAuth,createCanvasApiMock})=>{
    const {canvas,state,panel,form}=await fixture({page,locale,mockSharedAuth,createCanvasApiMock});
    const cases=[
        ['A 120 second film with 10 second shots.',120],['Ein 120 Sekunden Film mit 10 Sekunden Szenen.',120],
        ['Ein zweiminütiger Film mit 10-sekündigen Szenen.',120],['Einen 2-minütigen Film mit 10-sekündigen Szenen.',120],['A film of 1 minute and 30 seconds.',90],
        ['Ein Film von 1 Minute und 30 Sekunden.',90],['A minute of ducks in a pool.',60],
        ['A 60 second film or a 120 second film.',null],['Ein 60 Sekunden Film oder ein 120 Sekunden Film.',null],
        ['A film of 60 or 120 seconds.',null],['Use 10 second shots.',null],['Shots last 10 seconds and 20 seconds.',null],
    ];
    const actual=await page.evaluate(async briefs=>{const {resolveCanvasAgentDuration}=await import('/js/shared/canvas-agent-contract.mjs');return briefs.map(brief=>resolveCanvasAgentDuration({brief})?.targetDurationSeconds??null);},cases.map(([brief])=>brief));
    expect(actual).toEqual(cases.map(([,seconds])=>seconds));
    await expect(form.locator('textarea')).toBeEnabled();
    await form.locator('textarea').fill(locale==='de'?'Ein 60 Sekunden Film oder ein 120 Sekunden Film.':'A 60 second film or a 120 second film.');await form.locator('button[type="submit"]').click();
    expect(state.posts).toEqual([]);
    await expect(panel).toContainText(locale==='de'?'Ausgabenfreigabe':'authorize the spend');
    await form.locator('textarea').fill(locale==='de'?'Einen 2-minütigen Film mit 10-sekündigen Szenen.':cases[0][0]);
    await form.locator('[name="budget"]').fill('900');await form.locator('[name="authorize"]').check();await form.locator('button[type="submit"]').click();
    await expect.poll(()=>state.posts.length).toBe(1);expect(state.posts[0].body.targetDurationSeconds).toBe(120);
    await expect(form.locator('[name="delegateDuration"]')).toBeHidden();
    expect(canvas.requests.filter(request=>request.method==='POST')).toEqual([]);
};

exports.unavailable=async({page,expect,locale,mockSharedAuth,createCanvasApiMock})=>{
    const {state,panel,form}=await fixture({page,locale,mockSharedAuth,createCanvasApiMock});
    state.available=false;
    await page.reload();await page.locator('#canvasAgentToggle').click();
    await expect(panel).toContainText(locale==='de'?'bestätigtem Zugriff':'confirmed access');
    await expect(form.locator('button[type="submit"]')).toBeDisabled();
    await form.evaluate(node=>node.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})));
    expect(state.posts).toEqual([]);
    // A hostile result cannot turn a completion label into a playable/saved claim.
    state.run={id:'a'.repeat(32),projectId:'1'.repeat(32),status:'completed',phase:'completed',result:{assetId:'foreign',fileUrl:'https://attacker.invalid/film.mp4'},errorCode:'<img src=x onerror=alert(1)>'};
    await page.reload();await page.locator('#canvasAgentToggle').click();
    await expect(panel.locator('h3')).toHaveText(locale==='de'?'Die Produktion benötigt Aufmerksamkeit. Vorhandene Ergebnisse bleiben im Projekt.':'The production needs attention. Existing results remain in the project.');
    await expect(panel.locator('video,img')).toHaveCount(0);
    await expect(panel.locator('.canvas-agent__production details dd').last()).toHaveText('<img src=x onerror=alert(1)>');
    expect(state.posts).toEqual([]);
};

exports.activity=async({page,expect,locale,info,mockSharedAuth,createCanvasApiMock})=>{
    const {state,panel,project}=await fixture({page,locale,mockSharedAuth,createCanvasApiMock});
    const de=locale==='de',hostile='<img src=x onerror="window.canvasInjected=true">';
    state.run={id:'a'.repeat(32),projectId:project,status:'blocked',phase:'validating',budgetCredits:300,chargedCredits:127,reservedCredits:0,committedCredits:127,remainingCredits:173,
        summarySupport:{status:'unavailable',mode:'completed'},cause:{code:'canvas_agent_h3_reference_modes_mixed',step:'shot-2',recovery:'manual'},
        currentAction:{phase:'validating',model:'minimax/hailuo-3',tool:'plan.validate',text:'Checking reference inputs'},
        proposedPlan:{status:'invalid',title:'House and ducks',summary:hostile,shots:[{title:'Building the house',description:'Workers lift a wall.',model:'minimax/hailuo-3',durationSeconds:10}],validation:{issues:[{message:'First frame and reference mode conflict.'}],repairs:[]}},
        partialOutputs:[{type:'video',nodeId:'clip1',title:'Saved first clip',fileUrl:'/api/ai/videos/agent-fixture/file'},{type:'image',nodeId:'hostile',title:hostile,fileUrl:'https://attacker.invalid/image.png'}]};
    state.events=[{id:2,type:'action',text:'Plan received',tool:'plan.validate'},{id:1,type:'action',text:hostile},{id:2,type:'action',text:'Duplicate must not appear'}];
    const check=panel.getByRole('button',{name:de?'Status prüfen':'Check status',exact:true});
    // Load a persisted run without submitting a new production.
    await page.reload();await page.locator('#canvasAgentToggle').click();
    await expect(panel.locator('.canvas-agent__plan')).toContainText('Building the house');
    await expect(panel.locator('.canvas-agent__plan')).toContainText('First frame and reference mode conflict.');
    await expect(panel.locator('.canvas-agent__cause')).toContainText(de?'inkompatible Referenzmodi':'incompatible reference modes');
    await expect(panel.locator('.canvas-agent__cause')).toContainText(de?'angehalten':'stopped');
    await expect(panel.locator('.canvas-agent__activity')).toContainText(de?'keine laufenden Zusammenfassungen':'does not deliver live summaries');
    const log=panel.getByRole('log');await expect(log.locator('li')).toHaveCount(2);
    expect(await log.locator('li').evaluateAll(nodes=>nodes.map(node=>node.dataset.eventId))).toEqual(['1','2']);
    await expect(log.locator('li').first()).toContainText(hostile);
    await expect(panel.locator('img,script')).toHaveCount(0);expect(await page.evaluate(()=>window.canvasInjected)).toBeUndefined();
    const video=panel.locator('.canvas-agent__partial video');await expect(video).toBeVisible();
    await video.evaluate(async node=>{node.muted=true;await node.play();});await expect.poll(()=>video.evaluate(node=>node.currentTime)).toBeGreaterThan(0);await video.evaluate(node=>node.pause());
    state.events.push({id:3,type:'provider_summary',source:'provider',delivery:'completed',text:'The provider supplied this completed summary.'},{id:4,type:'provider_summary',source:'assistant',delivery:'streamed',text:'Synthetic thoughts must never appear.'});await check.click();
    await expect(log.locator('li')).toHaveCount(3);await expect(log.locator('li').last()).toContainText(de?'nach der Antwort':'after completion');
    await expect(log).not.toContainText('Synthetic thoughts');
    await check.click();await expect(log.locator('li')).toHaveCount(3);
    state.run={...state.run,status:'taken_over'};await check.click();
    await expect(panel.locator('.canvas-agent__cause')).toContainText('shot-2');
    await page.reload();await page.locator('#canvasAgentToggle').click();await expect(log.locator('li')).toHaveCount(3);
    await expect(panel.locator('.canvas-agent__plan')).toContainText('House and ducks');
    expect(state.posts).toEqual([]);expect(state.budgetPosts).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await panel.screenshot({path:info.outputPath(`canvas-agent-activity-${locale}.png`)});
};

exports.budget=async({page,expect,locale,mockSharedAuth,createCanvasApiMock})=>{
    const {state,panel,project}=await fixture({page,locale,mockSharedAuth,createCanvasApiMock}),de=locale==='de';
    const request={id:'b'.repeat(32),revision:2,projectRevision:7,tariffRevision:29,currentCapCredits:300,additionalCredits:97,proposedCapCredits:397,status:'pending',reasonCode:'canvas_agent_plan_correction',model:'xai/grok-4.7',action:'plan.repair'};
    state.run={id:'a'.repeat(32),projectId:project,status:'paused',phase:'budget',budgetCredits:300,projectRevision:7,budgetRequest:request,allowedActions:['cancel','takeover']};
    await page.reload();await page.locator('#canvasAgentToggle').click();
    const box=panel.locator('.canvas-agent__budget'),accept=box.getByRole('button',{name:de?'Dieses neue Limit freigeben':'Authorize this new cap',exact:true}),decline=box.getByRole('button',{name:de?'Bisheriges Limit behalten':'Keep current cap',exact:true});
    await expect(accept).toBeEnabled();await expect(box).toContainText('397');expect(state.budgetPosts).toEqual([]);
    // A lost response keeps precisely the displayed cap, tariff and decision.
    state.loseBudget=true;await accept.evaluate(node=>{node.click();node.click();});
    await expect.poll(()=>state.budgetPosts.length).toBe(1);await expect(decline).toBeDisabled();
    expect(state.budgetPosts[0].body).toEqual({requestId:request.id,requestRevision:2,decision:'accept',proposedCapCredits:397,expectedRevision:7});
    expect(state.budgetPosts[0].tariff).toBe('29');
    await page.reload();await page.locator('#canvasAgentToggle').click();
    await expect(decline).toBeDisabled();expect(state.budgetPosts.length).toBe(1);
    await panel.getByRole('button',{name:new RegExp(de?'Ursprüngliche Budgetentscheidung prüfen':'Check original budget decision')}).click();
    await expect.poll(()=>state.budgetPosts.length).toBe(2);expect(state.budgetPosts[1]).toEqual(state.budgetPosts[0]);
    await expect(box).toBeHidden();
    // A changed request is not silently approved using the earlier decision.
    state.run={...state.run,status:'paused',budgetRequest:{...request,id:'c'.repeat(32),revision:3,projectRevision:8,currentCapCredits:397,additionalCredits:53,proposedCapCredits:450}};
    await panel.getByRole('button',{name:de?'Status prüfen':'Check status',exact:true}).click();
    await expect(accept).toBeEnabled();await expect(box).toContainText('450');expect(state.budgetPosts.length).toBe(2);
    state.rejectBudget=true;await accept.click();await expect.poll(()=>state.budgetPosts.length).toBe(3);
    await expect(panel).toContainText(de?'Preise oder Projekt wurden geändert':'Prices or the project changed');
    expect(state.budgetPosts[2].key).not.toBe(state.budgetPosts[0].key);
    state.rejectBudget=false;await decline.click();await expect.poll(()=>state.budgetPosts.length).toBe(4);
    expect(state.budgetPosts[3].body.decision).toBe('decline');expect(state.run.budgetCredits).toBe(397);
    expect(state.posts).toEqual([]);expect(state.controls).toEqual([]);
};

exports.outcome=async({page,expect,locale,info,mockSharedAuth,createCanvasApiMock})=>{
    const {state,panel,form,project}=await fixture({page,locale,mockSharedAuth,createCanvasApiMock});
    const de=locale==='de',errors=[];page.on('pageerror',error=>errors.push(error.message));
    state.run={id:'a'.repeat(32),projectId:project,status:'review_required',phase:'planning',completed:0,total:0,
        targetDurationSeconds:45,toleranceSeconds:.5,budgetCredits:3000,allocatedCredits:127,chargedCredits:0,reservedCredits:127,pendingOutcomeCredits:127,
        errorCode:'canvas_agent_provider_timeout',result:null,allowedActions:['cancel','takeover'],
        modelOperation:{operationId:'b'.repeat(32),kind:'plan',outcome:'unknown',recovery:'review_required'}};
    const refresh=panel.getByRole('button',{name:de?'Status prüfen':'Check status',exact:true});
    const summary=panel.locator('.canvas-agent__production > .canvas-agent__summary');
    const value=label=>summary.getByText(label,{exact:true}).locator('xpath=following-sibling::dd[1]');
    await refresh.click();
    await expect(panel.locator('h3')).toHaveText(de?'Anbieterergebnis ungeklärt':'Provider outcome unknown');
    await expect(value(de?'Produktionsschritt':'Production step')).toHaveText(de?'Geschichte und Einstellungen planen':'Planning story and settings');
    await expect(value(de?'Bereits abgerechnet (Credits)':'Already charged (credits)')).toHaveText('0');
    await expect(value(de?'Im Guthaben reserviert (Credits)':'Reserved in wallet (credits)')).toHaveText('127');
    await expect(panel).toContainText(de?'Die Antwortfrist ist abgelaufen':'The response deadline has passed');
    await expect(panel).toContainText(de?'Sie wird nicht erneut gesendet':'It will not be sent again');
    const details=panel.locator('.canvas-agent__production > details');
    await expect(details).toHaveCount(1);await expect(details).toBeVisible();
    const detailsToggle=details.locator(':scope > summary');
    await expect(detailsToggle).toHaveText(de?'Produktionsdetails':'Production details');
    const expectClosed=options=>expect(details).not.toHaveAttribute('open','',options);
    await expectClosed();
    // A visible opened disclosure must fail the same closed-state assertion;
    // hidden availability diagnostics with the same label cannot satisfy it.
    await detailsToggle.click();await expect(details).toHaveAttribute('open','');
    let openRejected=false;
    try {await expectClosed({timeout:150});}catch(error){openRejected=String(error.message).includes('toHaveAttribute');}
    expect(openRejected).toBe(true);
    await detailsToggle.click();await expectClosed();
    await expect(form).toBeHidden();
    const resume=panel.getByRole('button',{name:de?'Fortsetzen':'Resume',exact:true,includeHidden:true});
    await expect(resume).toBeHidden();
    // A forged local click must not bypass the server-owned action projection.
    await resume.evaluate(node=>node.click());expect(state.controls).toEqual([]);
    state.run={...state.run,modelOperation:{...state.run.modelOperation,outcome:'pending',recovery:'receipt_ready'}};
    await refresh.click();await expect(panel.locator('h3')).toHaveText(de?'Anbieterantwort erhalten':'Provider response received');
    await expect(panel).toContainText(de?'Anbieterantwort ist gespeichert':'provider response has been saved');
    await expect(panel).not.toContainText(de?'Die Antwortfrist ist abgelaufen':'The response deadline has passed');
    state.run={...state.run,modelOperation:{...state.run.modelOperation,outcome:'unknown',recovery:'review_required'}};
    await page.reload();await page.locator('#canvasAgentToggle').click();
    await expect(value(de?'Im Guthaben reserviert (Credits)':'Reserved in wallet (credits)')).toHaveText('127');
    expect(state.posts).toEqual([]);expect(state.controls).toEqual([]);
    // Errors during production must be visible outside the hidden start form.
    state.failRead=true;await refresh.click();
    await expect(panel.getByText(de?'Der Status konnte nicht bestätigt werden. Prüfe den Status, bevor du einen neuen Auftrag startest.':'The status could not be confirmed. Check status before starting another production.',{exact:true})).toBeVisible();
    state.failControl=true;await panel.getByRole('button',{name:de?'Abbrechen':'Cancel',exact:true}).click();
    await expect(panel.locator('#canvasAgentBody > .canvas-agent__notice').filter({hasText:de?'Für die ursprüngliche Anfrage':'The original request'})).toBeVisible();
    expect(state.controls.map(control=>control.body.action)).toEqual(['cancel']);
    // A saved paused run with an unresolved dispatch still cannot resume, even
    // if a malformed older response advertises it as an allowed action.
    state.run={...state.run,status:'paused',phase:'evaluating',allowedActions:['resume','cancel','takeover'],modelOperation:{...state.run.modelOperation,kind:'evaluate'}};
    await refresh.click();await expect(resume).toBeHidden();await resume.evaluate(node=>node.click());
    await expect(panel.locator('h3')).toHaveText(de?'Pausiert · Anbieterergebnis ungeklärt':'Paused · Provider outcome unknown');
    await expect(value(de?'Produktionsschritt':'Production step')).toHaveText(de?'Einzelbilder prüfen':'Reviewing sampled frames');
    expect(state.controls).toHaveLength(1);
    // Unknown legacy receipts have no durable callback to promise; keep the
    // timeout and cost state honest when the additive projection is absent.
    state.run={...state.run,status:'blocked',modelOperation:undefined,allowedActions:undefined};
    await refresh.click();await expect(panel.locator('h3')).toHaveText(de?'Anbieterergebnis ungeklärt':'Provider outcome unknown');
    state.run={...state.run,status:'cancelled',modelOperation:{operationId:'b'.repeat(32),kind:'evaluate',outcome:'unknown',recovery:'review_required'},allowedActions:[]};
    await refresh.click();
    await expect(panel.locator('h3')).toHaveText(de?'Abgebrochen':'Cancelled');
    await expect(panel).toContainText(de?'Es werden keine neuen Schritte gestartet':'No new production steps will start');
    const revise=panel.getByRole('button',{name:de?'Weitere Änderung beschreiben':'Describe another change',exact:true,includeHidden:true});
    await expect(revise).toBeHidden();await revise.evaluate(node=>node.click());await expect(form).toBeHidden();
    state.run={...state.run,status:'blocked',errorCode:'canvas_agent_provider_rejected',reservedCredits:0,pendingOutcomeCredits:0,modelOperation:{...state.run.modelOperation,outcome:'rejected',recovery:null}};
    await refresh.click();await expect(panel.locator('h3')).toHaveText(de?'Modellanfrage abgelehnt':'Model request rejected');
    await expect(panel).toContainText(de?'kein automatischer Ersatzauftrag':'No replacement request');
    await expect(value(de?'Im Guthaben reserviert (Credits)':'Reserved in wallet (credits)')).toHaveText('0');
    state.run={...state.run,status:'paused',reservedCredits:127,allowedActions:['resume','cancel','takeover'],modelOperation:{...state.run.modelOperation,outcome:'failed',recovery:'billing_review'}};
    await refresh.click();await expect(panel.locator('h3')).toHaveText(de?'Pausiert · Modellanfrage fehlgeschlagen':'Paused · Model request failed');
    await expect(panel).toContainText(de?'Die endgültigen Kosten sind noch ungeklärt':'Final costs are still unresolved');
    await expect(value(de?'Im Guthaben reserviert (Credits)':'Reserved in wallet (credits)')).toHaveText('127');
    await expect(resume).toBeHidden();await resume.evaluate(node=>node.click());expect(state.controls).toHaveLength(1);
    state.run={...state.run,status:'review_required',modelOperation:{...state.run.modelOperation,outcome:'pending',recovery:'review_required'}};
    await refresh.click();await expect(panel.locator('h3')).toHaveText(de?'Modellanfrage benötigt Prüfung':'Model request needs review');
    await expect(panel).toContainText(de?'Die automatische Prüfung ist angehalten':'Automatic review has stopped');
    state.run={...state.run,status:'paused',allowedActions:null,modelOperation:{...state.run.modelOperation,outcome:'completed',recovery:null}};
    await refresh.click();await expect(resume).toBeHidden();await resume.evaluate(node=>node.click());expect(state.controls).toHaveLength(1);
    expect(state.posts).toEqual([]);expect(errors).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await panel.screenshot({path:info.outputPath(`canvas-agent-unknown-${locale}.png`)});
};
