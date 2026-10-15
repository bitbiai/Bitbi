const path = require('node:path');

async function fixture({page,locale,mockSharedAuth,createCanvasApiMock}) {
    await page.setViewportSize({width:locale==='de'?390:1440,height:960});
    await mockSharedAuth(page);
    const canvas=createCanvasApiMock(page), project='1'.repeat(32), now=new Date().toISOString();
    canvas.projects=[{id:project,title:'Editable film',locale,revision:0,created_at:now,updated_at:now}];
    const state={run:null,available:true,posts:[],controls:[],loseResponse:false,reads:0};
    await page.route('**/api/account/canvas/**',async route=>{
        const request=route.request(),url=new URL(request.url());
        if(!url.pathname.includes('/agent'))return route.fallback();
        const respond=()=>route.fulfill({json:{ok:true,data:{availability:{available:state.available,code:state.available?null:'grok_47_unverified',model:'xai/grok-4.7'},run:state.run}}});
        if(request.method()==='GET'){state.reads++;if(state.holdRead){state.holdRead=false;state.pendingRead=route;return;}return respond();}
        const body=request.postDataJSON(),key=request.headers()['idempotency-key'];
        if(url.pathname.endsWith('/control')){
            state.controls.push({body,key});
            state.run={...state.run,status:({pause:'paused',resume:'running',cancel:'cancelled',takeover:'taken_over'})[body.action]};
            return respond();
        }
        state.posts.push({body,key});
        if(state.run?.requestKey!==key)state.run={id:'a'.repeat(32),projectId:project,requestKey:key,brief:body.brief,status:body.targetDurationSeconds||body.durationChoice==='delegated'?'running':'clarification_required',phase:body.targetDurationSeconds||body.durationChoice==='delegated'?'generating':'clarification_required',completed:0,total:3,targetDurationSeconds:body.durationChoice==='delegated'?60:body.targetDurationSeconds,toleranceSeconds:.5,budgetCredits:body.budgetCredits,allocatedCredits:0,projectRevision:0,result:null};
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
    await expect.poll(()=>state.posts.length).toBe(1);
    expect(state.posts[0].body.targetDurationSeconds).toBeNull();
    expect(state.posts[0].body.budgetCredits).toBeNull();
    await expect(form.locator('[name="delegateDuration"]')).toBeVisible();
    await expect(panel).toContainText(locale==='de'?'Wie lang':'How long');
    expect(canvas.requests.filter(request=>request.method==='POST')).toEqual([]);
    await page.reload();await page.locator('#canvasAgentToggle').click();
    await expect(form.locator('textarea')).toHaveValue(state.run.brief);
    await expect(form.locator('[name="delegateDuration"]')).toBeVisible();
    await form.locator('[name="delegateDuration"]').check();
    await expect(page.locator('#canvasAgentDurationHint')).toContainText('60 s');
    await form.locator('[name="budget"]').fill('300');
    await form.locator('[name="authorize"]').check();
    await form.evaluate(node=>{node.requestSubmit();node.requestSubmit();});
    await expect.poll(()=>state.posts.length).toBe(2);
    expect(state.posts[1].body.durationChoice).toBe('delegated');
    expect(state.posts[1].body.budgetCredits).toBe(300);
    expect(state.posts[1].key).not.toBe(state.posts[0].key);
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
    await expect.poll(()=>state.posts.length).toBe(1);expect(state.posts[0].body.targetDurationSeconds).toBeNull();
    await expect(panel).toContainText(locale==='de'?'Wie lang':'How long');
    await form.locator('textarea').fill(locale==='de'?'Einen 2-minütigen Film mit 10-sekündigen Szenen.':cases[0][0]);
    await form.locator('[name="budget"]').fill('900');await form.locator('[name="authorize"]').check();await form.locator('button[type="submit"]').click();
    await expect.poll(()=>state.posts.length).toBe(2);expect(state.posts[1].body.targetDurationSeconds).toBe(120);
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
