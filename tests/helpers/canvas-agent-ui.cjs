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

// Observe the canonical notification surface; never synthesize the original
// failed/successful operation in order to display its acknowledgement.
exports.expectNotification=async({page,expect,locale},code,message=null)=>{
    const inbox=page.locator('#canvasNotificationsPanel');
    if(!await inbox.isVisible())await page.locator('#canvasNotificationsToggle').click();
    await inbox.getByRole('button',{name:locale==='de'?'Aktualisieren':'Refresh',exact:true}).click();
    const item=inbox.locator('.canvas-notifications__item').filter({hasText:code}).last();
    await expect(item).toBeVisible();await item.locator('summary').click();await expect(item.locator('code')).toContainText(code);
    if(message)await expect(item).toContainText(message);
    await inbox.getByRole('button',{name:locale==='de'?'Meldungen schließen':'Close notifications',exact:true}).click();
};

async function fixture({page,locale,mockSharedAuth,createCanvasApiMock}) {
    await page.setViewportSize({width:locale==='de'?390:1440,height:960});
    await mockSharedAuth(page);
    const canvas=createCanvasApiMock(page), project='1'.repeat(32), now=new Date().toISOString();
    canvas.projects=[{id:project,title:'Editable film',locale,revision:0,created_at:now,updated_at:now}];
    const state={run:null,available:true,posts:[],controls:[],loseResponse:false,reads:0,events:[],budgetPosts:[],chatPosts:[],allowancePosts:[],chatControls:[],actionPosts:[]};
    const conversation={revision:0,briefRevision:0,state:'active',draft:'',messages:[],brief:{version:1,revision:0,fields:{},duration:{targetDurationSeconds:null,choice:null,asked:false},openQuestions:[]},allowance:{capCredits:0,committedCredits:0,remainingCredits:0,tariffRevision:29},pendingTurnId:null,suggestedAllowanceCredits:20};
    state.conversation=conversation;const chatReceipts=new Map();
    await page.route('**/api/account/canvas/**',async route=>{
        const request=route.request(),url=new URL(request.url());
        if(!url.pathname.includes('/agent'))return route.fallback();
        if(url.pathname.includes('/agent/conversation')){
            const respondChat=()=>route.fulfill({json:{ok:true,data:{conversation,availability:{available:state.available},run:state.run}}});
            if(request.method()==='GET'){state.chatReads=(state.chatReads||0)+1;return respondChat();}
            const body=request.postDataJSON(),key=request.headers()['idempotency-key'];
            if(/\/actions\/[a-f0-9]{32}\/confirm$/.test(url.pathname)){
                state.actionPosts.push({body,key});
                if(!chatReceipts.has(key)){
                    const id=url.pathname.split('/').at(-2),action=conversation.actions.find(item=>item.id===id);
                    if(!action||body.expectedRevision!==0||body.expectedBriefRevision!==conversation.briefRevision)return route.fulfill({status:409,json:{ok:false,code:'canvas_agent_project_changed'}});
                    action.state='completed';action.confirmation=null;action.text='Saved explicit decision.';conversation.revision++;chatReceipts.set(key,true);
                }
                if(state.loseActionResponse){state.loseActionResponse=false;return route.abort('failed');}return respondChat();
            }
            if(url.pathname.endsWith('/start')){
                state.posts.push({body,key});
                if(!state.run)state.run={id:'a'.repeat(32),projectId:project,requestKey:key,status:'running',phase:'generating',completed:0,total:3,targetDurationSeconds:conversation.brief.duration.targetDurationSeconds??60,budgetCredits:body.budgetCredits,allocatedCredits:0,projectRevision:body.expectedRevision,result:null};
                if(state.loseResponse){state.loseResponse=false;return route.abort('failed');}
                return route.fulfill({json:{ok:true,data:{run:state.run}}});
            }
            const startText=body.text?.match(/^(?:Starte jetzt mit maximal|Start now with at most) (\d+) [Cc]redits$/);
            if(url.pathname.endsWith('/messages')&&startText){
                state.posts.push({body,key});
                if(!chatReceipts.has(key)){
                    if(body.expectedConversationRevision!==conversation.revision)return route.fulfill({status:409,json:{ok:false,code:'canvas_conversation_revision_conflict'}});
                    state.run={id:'a'.repeat(32),projectId:project,requestKey:key,status:'running',phase:'generating',completed:0,total:3,targetDurationSeconds:conversation.brief.duration.targetDurationSeconds??60,budgetCredits:Number(startText[1]),allocatedCredits:0,projectRevision:canvas.projects[0].revision,result:null};
                    conversation.revision++;chatReceipts.set(key,true);
                }
                if(state.loseResponse){state.loseResponse=false;return route.abort('failed');}
                return respondChat();
            }
            const kind=url.pathname.split('/').at(-1);
            if(kind==='messages'&&state.holdMessageAcceptance){
                state.holdMessageAcceptance=false;
                await new Promise(resolve=>{state.releaseMessageAcceptance=()=>{delete state.releaseMessageAcceptance;resolve();};});
            }
            (kind==='messages'?state.chatPosts:kind==='allowance'?state.allowancePosts:state.chatControls).push({body,key});
            if(chatReceipts.has(key))return respondChat();
            if(body.expectedConversationRevision!==conversation.revision)return route.fulfill({status:409,json:{ok:false,code:'canvas_conversation_revision_conflict'}});
            conversation.revision++;
            if(kind==='allowance')conversation.allowance={capCredits:body.capCredits,committedCredits:0,remainingCredits:body.capCredits,tariffRevision:29};
            if(kind==='control'){
                if(body.action==='save'){conversation.state='saved';conversation.draft=body.draft||'';}
                if(body.action==='resume')conversation.state='active';
                if(body.action==='cancel')conversation.state='cancelled';
                if(body.action==='delegate_duration'){conversation.brief.duration={choice:'delegated',targetDurationSeconds:null,asked:true};conversation.briefRevision++;}
                if(body.action==='clear'){conversation.messages=[];conversation.brief.fields={};conversation.brief.duration={choice:null,targetDurationSeconds:null,asked:false};conversation.briefRevision++;conversation.state='active';conversation.draft='';}
            }
            if(kind==='messages'){
                const id='message-'+conversation.revision,text=body.text;
                conversation.messages.push({id,role:'user',text,status:'completed'});
                const seconds=/\b120\b|2-minüt|zweiminüt|two.minute/.test(text)?120:/\b60\b/.test(text)&&!/120/.test(text)?60:null;
                const ambiguous=/60.*(?:or|oder).*120/.test(text);
                if(!conversation.brief.fields.story||text.length>30)conversation.brief.fields.story={value:text,provenance:'user_stated',sourceMessageId:id,revision:conversation.briefRevision+1};
                if(seconds&&!ambiguous)conversation.brief.duration={choice:'explicit',targetDurationSeconds:seconds,asked:conversation.brief.duration.asked};
                const ask=!conversation.brief.duration.choice&&!conversation.brief.duration.asked;
                if(ask)conversation.brief.duration.asked=true;
                conversation.briefRevision++;conversation.brief.revision=conversation.briefRevision;conversation.draft='';
                conversation.messages.push({id:id+'-reply',role:'assistant',text:ask?(locale==='de'?'Wie lang soll dein Film werden?':'How long should your film be?'):(locale==='de'?'Die Projektidee ist gespeichert.':'The project brief is saved.'),status:'completed'});
                conversation.allowance.committedCredits++;conversation.allowance.remainingCredits--;
            }
            chatReceipts.set(key,true);
            // Model the existing atomic conversation-action receipt, not a
            // browser success notice or an inferred production event.
            const outcome=kind==='allowance'?['canvas_allowance_accepted','allowance_propose']:
                kind==='control'?({save:['canvas_brief_saved','brief_save'],clear:['canvas_brief_cleared','conversation_clear'],cancel:['canvas_brief_cancelled','brief_cancel']})[body.action]:null;
            if(outcome)canvas.notifications.unshift({
                id:`conversation-control:${project}:${kind}:${body.expectedConversationRevision}`,
                source:'conversation',kind:kind==='allowance'?'authorization':'control',code:outcome[0],
                projectId:project,projectTitle:canvas.projects[0].title,projectDeleted:false,createdAt:new Date().toISOString(),
                readAt:null,resolved:true,confirmed:true,diagnosticRef:null,stage:null,status:'completed',severity:'success',
                details:{actionType:outcome[1]},
            });
            if(state.loseChatResponse){state.loseChatResponse=false;return route.abort('failed');}
            if(state.holdChatResponse){state.holdChatResponse=false;state.releaseChatResponse=respondChat;return;}
            return respondChat();
        }
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
    return {canvas,state,project,open,panel:page.locator('#canvasAgentPanel'),form:page.locator('.canvas-agent__production-approval'),composer:page.locator('.canvas-agent__composer')};
}

const showProject=(panel,locale)=>panel.getByRole('tab',{name:locale==='de'?'Projekt & Produktion':'Project & production',exact:true}).click();
const showChat=(panel,locale)=>panel.getByRole('tab',{name:locale==='de'?'Gespräch':'Conversation',exact:true}).click();
async function disclose(panel,selector){const node=panel.locator(selector);if(await node.getAttribute('open')===null)await node.locator(':scope > summary').click();}
async function showManual(panel,locale){await showProject(panel,locale);await disclose(panel,'.canvas-agent__manual-production');}
async function showFinance(panel,locale){await showProject(panel,locale);await disclose(panel,'.canvas-agent__advanced');await disclose(panel,'.canvas-agent__finance');}
async function showOptions(panel,locale){await showProject(panel,locale);await disclose(panel,'.canvas-agent__advanced');const options=panel.locator('.canvas-agent__briefing-options');if(await options.getAttribute('open')===null)await options.locator('summary').click();}

async function briefing({panel,locale,text,expect}) {
    const allowance=panel.locator('.canvas-agent__allowance');
    await expect(panel.locator('.canvas-agent__composer textarea')).toBeEnabled();
    await showChat(panel,locale);
    const prompt=panel.locator('.canvas-agent__approval-prompt');if(await prompt.isVisible())await prompt.click();
    if(await allowance.isVisible())await allowance.getByRole('button',{name:locale==='de'?'Dieses Gesprächsbudget freigeben':'Authorize this briefing allowance',exact:true}).click();
    await showChat(panel,locale);
    const composer=panel.locator('.canvas-agent__composer');await expect(composer.locator('textarea')).toBeEnabled();
    await composer.locator('textarea').fill(text);await composer.locator('button[type=submit]').click();
    await expect(panel.locator('.canvas-agent__messages')).toContainText(text);
    await expect(composer.locator('textarea')).toHaveValue('');
}

exports.admission=async({page,expect,locale,info,mockSharedAuth,createCanvasApiMock})=>{
    const {canvas,state,panel,form}=await fixture({page,locale,mockSharedAuth,createCanvasApiMock});
    const composer=panel.locator('.canvas-agent__composer');
    await expect(composer.locator('textarea')).toBeEnabled();
    await composer.locator('textarea').fill('A comic film about a house being built, a pool with ducks and arriving guests.');
    await composer.locator('button[type=submit]').click();
    expect(state.posts).toEqual([]);await expect.poll(()=>state.chatPosts.length).toBe(1);
    expect(state.allowancePosts).toEqual([]); // A free idea is not spending consent.
    await briefing({panel,locale,expect,text:'A comic film about a house being built, a pool with ducks and arriving guests.'});
    await expect(panel.locator('.canvas-agent__messages')).toContainText(locale==='de'?'Wie lang':'How long');
    await expect(form.locator('button[type=submit]')).toBeDisabled();
    await showOptions(panel,locale);
    await panel.getByRole('button',{name:locale==='de'?'Du wählst eine passende Dauer':'You choose a suitable duration',exact:true}).click();
    await expect(form.locator('button[type=submit]')).toBeEnabled();
    await showManual(panel,locale);await form.locator('button[type=submit]').click();expect(state.posts).toEqual([]);
    await form.locator('[name="budget"]').fill('300');await form.locator('[name="authorize"]').check();
    await form.evaluate(node=>{node.requestSubmit();node.requestSubmit();});
    await expect.poll(()=>state.posts.length).toBe(1);
    expect(state.posts[0].body).toMatchObject({text:locale==='de'?'Starte jetzt mit maximal 300 Credits':'Start now with at most 300 credits',expectedBriefRevision:3});
    expect(Object.hasOwn(state.posts[0].body,'brief')).toBe(false);
    expect(state.conversation.brief.duration.choice).toBe('delegated');
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
    await briefing({panel,locale,expect,text:'A realistic 120 second housebuilding film, with ducks in the pool and visitors arriving.'});
    await showManual(panel,locale);await form.locator('[name="budget"]').fill('900');await form.locator('[name="authorize"]').check();
    canvas.projects[0].revision=7;state.loseResponse=true;
    await form.locator('button[type="submit"]').click();
    await expect.poll(()=>state.posts.length).toBe(1);
    expect(state.conversation.brief.duration.targetDurationSeconds).toBe(120);
    expect(state.run.projectRevision).toBe(7);expect(state.posts[0].body.text).toContain('900');
    const retry=panel.getByRole('button',{name:locale==='de'?'Nachricht prüfen':'Check message',exact:true});
    await expect(retry).toBeVisible();
    await retry.click();await expect.poll(()=>state.posts.length).toBe(2);expect(state.posts[1]).toEqual(state.posts[0]);
    await page.reload();await page.locator('#canvasAgentToggle').click();await showProject(panel,locale);
    await expect(panel.locator('.canvas-agent__counts')).toContainText('0 / 3');
    expect(state.posts.length).toBe(2);
    state.run={...state.run,phase:'waiting_limit'};
    await panel.getByRole('button',{name:locale==='de'?'Status prüfen':'Check status',exact:true}).click();
    await expect(panel.locator('h3')).toHaveText(locale==='de'?'Warten auf das nächste Zeitfenster':'Waiting for the next time window');
    await expect(panel.locator('.canvas-agent__counts')).toContainText('0 / 3');
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
    await page.reload();await page.locator('#canvasAgentToggle').click();await showProject(panel,locale);
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
    await briefing({panel,locale,expect,text:locale==='de'?'Ein 60 Sekunden Film oder ein 120 Sekunden Film.':'A 60 second film or a 120 second film.'});
    expect(state.posts).toEqual([]);await expect(form.locator('button[type=submit]')).toBeDisabled();
    await briefing({panel,locale,expect,text:locale==='de'?'Einen 2-minütigen Film mit 10-sekündigen Szenen.':cases[0][0]});
    await showManual(panel,locale);await form.locator('[name="budget"]').fill('900');await form.locator('[name="authorize"]').check();await form.locator('button[type="submit"]').click();
    await expect.poll(()=>state.posts.length).toBe(1);expect(state.conversation.brief.duration.targetDurationSeconds).toBe(120);
    expect(state.conversation.messages.filter(message=>/How long|Wie lang/.test(message.text))).toHaveLength(1);
    expect(canvas.requests.filter(request=>request.method==='POST')).toEqual([]);

};

exports.unavailable=async({page,expect,locale,mockSharedAuth,createCanvasApiMock})=>{
    const {state,panel,form}=await fixture({page,locale,mockSharedAuth,createCanvasApiMock});
    state.available=false;
    await page.reload();await page.locator('#canvasAgentToggle').click();await showProject(panel,locale);
    await expect(panel).toContainText(locale==='de'?'bestätigtem Zugriff':'confirmed access');
    const composer=panel.locator('.canvas-agent__composer'),input=composer.locator('textarea'),send=composer.locator('button[type=submit]');
    // A zero-allowance conversation can still request a server-owned budget
    // decision without inference. Unavailability cannot disable that bootstrap.
    await showChat(panel,locale);await expect(send).toBeEnabled();
    expect(state.chatPosts).toEqual([]);expect(state.allowancePosts).toEqual([]);
    // Model a previously authorized allowance in this UI fixture; this is no
    // approval request or real charge. Ordinary inference must now stay gated.
    state.conversation.allowance={capCredits:20,committedCredits:0,remainingCredits:20,tariffRevision:29};
    await page.reload();await page.locator('#canvasAgentToggle').click();
    const creative=locale==='de'?'Ein lustiger Hund spielt neben einem Pool.':'A funny dog plays beside a pool.';
    await input.fill(creative);await expect(send).toBeDisabled();
    await input.fill(locale==='de'?'Gesprächsbudget 20 Credits':'Briefing allowance 20 credits');await expect(send).toBeEnabled();
    await input.fill(locale==='de'?'Wie kann ich diesen Film verbessern?':'How can I improve this film?');await expect(send).toBeEnabled();
    await input.fill(creative);await expect(send).toBeDisabled();
    await composer.evaluate(node=>node.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})));
    expect(state.chatPosts).toEqual([]);expect(state.allowancePosts).toEqual([]);
    await expect(form.locator('button[type=submit]')).toBeDisabled();
    await form.evaluate(node=>node.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})));
    expect(state.posts).toEqual([]);
    // A hostile result cannot turn a completion label into a playable/saved claim.
    state.run={id:'a'.repeat(32),projectId:'1'.repeat(32),status:'completed',phase:'completed',result:{assetId:'foreign',fileUrl:'https://attacker.invalid/film.mp4'},errorCode:'<img src=x onerror=alert(1)>'};
    await page.reload();await page.locator('#canvasAgentToggle').click();await showProject(panel,locale);
    await expect(panel.locator('h3')).toHaveText(locale==='de'?'Die Produktion benötigt Aufmerksamkeit. Vorhandene Ergebnisse bleiben im Projekt.':'The production needs attention. Existing results remain in the project.');
    await expect(panel.locator('video,img')).toHaveCount(0);
    await expect(panel.locator('.canvas-agent__production')).not.toContainText('<img src=x onerror=alert(1)>');
    expect(state.posts).toEqual([]);
};

exports.activity=async({page,expect,locale,info,mockSharedAuth,createCanvasApiMock})=>{
    const {state,panel,project,canvas}=await fixture({page,locale,mockSharedAuth,createCanvasApiMock});
    const de=locale==='de',hostile='<img src=x onerror="window.canvasInjected=true">';
    state.run={id:'a'.repeat(32),projectId:project,status:'blocked',phase:'validating',budgetCredits:300,chargedCredits:127,reservedCredits:0,committedCredits:127,remainingCredits:173,
        summarySupport:{status:'unavailable',mode:'completed'},cause:{code:'canvas_agent_h3_reference_modes_mixed',step:'shot-2',recovery:'manual'},
        currentAction:{phase:'validating',model:'minimax/hailuo-3',tool:'plan.validate',text:'Checking reference inputs'},
        proposedPlan:{status:'invalid',title:'House and ducks',summary:hostile,shots:[{title:'Building the house',description:'Workers lift a wall.',model:'minimax/hailuo-3',durationSeconds:10}],validation:{issues:[{message:'First frame and reference mode conflict.'}],repairs:[]}},
        partialOutputs:[{type:'video',nodeId:'clip1',title:'Saved first clip',fileUrl:'/api/ai/videos/agent-fixture/file'},{type:'image',nodeId:'hostile',title:hostile,fileUrl:'https://attacker.invalid/image.png'}]};
    state.events=[{id:2,type:'action',text:'Plan received',tool:'plan.validate'},{id:1,type:'action',text:hostile},{id:2,type:'action',text:'Duplicate must not appear'}];
    const check=panel.getByRole('button',{name:de?'Status prüfen':'Check status',exact:true});
    // Load a persisted run without submitting a new production.
    await page.reload();await page.locator('#canvasAgentToggle').click();await showProject(panel,locale);
    await expect(panel.locator('.canvas-agent__plan')).toContainText('Building the house');
    await expect(panel.locator('.canvas-agent__plan')).toContainText('First frame and reference mode conflict.');
    // Operational events are projected from the account inbox, not replayed
    // as assistant prose. Duplicate identities and hostile titles remain safe.
    const notice=(id,code,extra={})=>({id,source:'event',kind:'event',code,severity:'warning',projectId:project,
        projectTitle:hostile,createdAt:'2026-01-01T00:00:00.000Z',readAt:null,confirmed:true,...extra});
    canvas.notifications.push(notice('event-1','canvas_agent_h3_reference_modes_mixed'),notice('event-2','proposed'),notice('event-2','proposed'));
    await expect(panel.locator('.canvas-agent__activity,.canvas-agent__events')).toHaveCount(0);
    await page.locator('#canvasNotificationsToggle').click();const inbox=page.locator('#canvasNotificationsPanel');
    const items=inbox.locator('.canvas-notifications__item');await expect(items).toHaveCount(2);
    await expect(inbox).toContainText(hostile);await expect(inbox.locator('img,script')).toHaveCount(0);
    await inbox.locator('[data-notification-id="event-1"] summary').click();await expect(inbox).toContainText('canvas_agent_h3_reference_modes_mixed');
    expect(await page.evaluate(()=>window.canvasInjected)).toBeUndefined();
    await inbox.getByRole('button',{name:de?'Meldungen schließen':'Close notifications',exact:true}).click();
    await expect(panel.locator('img,script')).toHaveCount(0);
    const video=panel.locator('.canvas-agent__partial video');await expect(video).toBeVisible();
    await video.evaluate(async node=>{node.muted=true;await node.play();});await expect.poll(()=>video.evaluate(node=>node.currentTime)).toBeGreaterThan(0);await video.evaluate(node=>node.pause());
    state.events.push({id:3,type:'provider_summary',source:'provider',delivery:'completed',text:'The provider supplied this completed summary.'},{id:4,type:'provider_summary',source:'assistant',delivery:'streamed',text:'Synthetic thoughts must never appear.'});
    canvas.notifications.push(notice('event-3','proposed'));await check.click();
    await page.locator('#canvasNotificationsToggle').click();await expect(items).toHaveCount(3);
    await expect(inbox).not.toContainText('Synthetic thoughts');await expect(panel).not.toContainText('Synthetic thoughts');
    await inbox.getByRole('button',{name:de?'Meldungen schließen':'Close notifications',exact:true}).click();await check.click();
    state.run={...state.run,status:'taken_over'};await check.click();
    await page.reload();await page.locator('#canvasAgentToggle').click();await showProject(panel,locale);
    await page.locator('#canvasNotificationsToggle').click();await expect(items).toHaveCount(3);
    await inbox.getByRole('button',{name:de?'Meldungen schließen':'Close notifications',exact:true}).click();
    await expect(panel.locator('.canvas-agent__plan')).toContainText('House and ducks');
    expect(state.posts).toEqual([]);expect(state.budgetPosts).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await panel.screenshot({path:info.outputPath(`canvas-agent-activity-${locale}.png`)});
};

exports.budget=async({page,expect,locale,mockSharedAuth,createCanvasApiMock})=>{
    const {state,panel,project}=await fixture({page,locale,mockSharedAuth,createCanvasApiMock}),de=locale==='de';
    const request={id:'b'.repeat(32),revision:2,projectRevision:7,tariffRevision:29,currentCapCredits:300,additionalCredits:97,proposedCapCredits:397,status:'pending',reasonCode:'canvas_agent_plan_correction',model:'xai/grok-4.7',action:'plan.repair'};
    state.run={id:'a'.repeat(32),projectId:project,status:'paused',phase:'budget',budgetCredits:300,projectRevision:7,budgetRequest:request,allowedActions:['cancel','takeover']};
    await page.reload();await page.locator('#canvasAgentToggle').click();await showProject(panel,locale);
    const box=panel.locator('.canvas-agent__budget'),accept=box.getByRole('button',{name:de?'Dieses neue Limit freigeben':'Authorize this new cap',exact:true}),decline=box.getByRole('button',{name:de?'Bisheriges Limit behalten':'Keep current cap',exact:true});
    await expect(accept).toBeEnabled();await expect(box).toContainText('397');expect(state.budgetPosts).toEqual([]);
    // A lost response keeps precisely the displayed cap, tariff and decision.
    state.loseBudget=true;await accept.evaluate(node=>{node.click();node.click();});
    await expect.poll(()=>state.budgetPosts.length).toBe(1);await expect(decline).toBeDisabled();
    expect(state.budgetPosts[0].body).toEqual({requestId:request.id,requestRevision:2,decision:'accept',proposedCapCredits:397,expectedRevision:7});
    expect(state.budgetPosts[0].tariff).toBe('29');
    await page.reload();await page.locator('#canvasAgentToggle').click();await showProject(panel,locale);
    await expect(decline).toBeDisabled();expect(state.budgetPosts.length).toBe(1);
    await panel.getByRole('button',{name:new RegExp(de?'Ursprüngliche Budgetentscheidung prüfen':'Check original budget decision')}).click();
    await expect.poll(()=>state.budgetPosts.length).toBe(2);expect(state.budgetPosts[1]).toEqual(state.budgetPosts[0]);
    await expect(box).toBeHidden();
    // A changed request is not silently approved using the earlier decision.
    state.run={...state.run,status:'paused',budgetRequest:{...request,id:'c'.repeat(32),revision:3,projectRevision:8,currentCapCredits:397,additionalCredits:53,proposedCapCredits:450}};
    await panel.getByRole('button',{name:de?'Status prüfen':'Check status',exact:true}).click();
    await expect(accept).toBeEnabled();await expect(box).toContainText('450');expect(state.budgetPosts.length).toBe(2);
    state.rejectBudget=true;await accept.click();await expect.poll(()=>state.budgetPosts.length).toBe(3);
    await exports.expectNotification({page,expect,locale},'canvas_agent_project_changed');
    expect(state.budgetPosts[2].key).not.toBe(state.budgetPosts[0].key);
    state.rejectBudget=false;await decline.click();await expect.poll(()=>state.budgetPosts.length).toBe(4);
    expect(state.budgetPosts[3].body.decision).toBe('decline');expect(state.run.budgetCredits).toBe(397);
    expect(state.posts).toEqual([]);expect(state.controls).toEqual([]);
};

exports.outcome=async({page,expect,locale,info,mockSharedAuth,createCanvasApiMock})=>{
    const {state,panel,form,project,canvas}=await fixture({page,locale,mockSharedAuth,createCanvasApiMock});
    const de=locale==='de',errors=[];page.on('pageerror',error=>errors.push(error.message));
    state.run={id:'a'.repeat(32),projectId:project,status:'review_required',phase:'planning',completed:0,total:0,
        targetDurationSeconds:45,toleranceSeconds:.5,budgetCredits:3000,allocatedCredits:127,chargedCredits:0,reservedCredits:127,pendingOutcomeCredits:127,
        errorCode:'canvas_agent_provider_timeout',result:null,allowedActions:['cancel','takeover'],
        modelOperation:{operationId:'b'.repeat(32),kind:'plan',outcome:'unknown',recovery:'review_required'}};
    const originalUnknownRun=structuredClone(state.run);
    const runDiagnostic=async code=>{
        canvas.notifications.push({id:'outcome-'+canvas.notifications.length,source:'event',kind:'production',code,severity:'error',projectId:project,
            createdAt:new Date().toISOString(),readAt:null,confirmed:true,diagnosticRef:'canvas-synthetic-outcome',details:{runId:state.run.id}});
        await exports.expectNotification({page,expect,locale},code);
    };
    const refresh=panel.getByRole('button',{name:de?'Status prüfen':'Check status',exact:true});
    const summary=panel.locator('.canvas-agent__production > .canvas-agent__summary');
    const value=label=>summary.getByText(label,{exact:true}).locator('xpath=following-sibling::dd[1]');
    await showProject(panel,locale);await refresh.click();
    await expect(panel.locator('h3')).toHaveText(de?'Anbieterergebnis ungeklärt':'Provider outcome unknown');
    await expect(value(de?'Produktionsschritt':'Production step')).toHaveText(de?'Geschichte und Einstellungen planen':'Planning story and settings');
    await expect(value(de?'Bereits abgerechnet (Credits)':'Already charged (credits)')).toHaveText('0');
    await expect(value(de?'Im Guthaben reserviert (Credits)':'Reserved in wallet (credits)')).toHaveText('127');
    await runDiagnostic('canvas_agent_provider_timeout');
    expect(state.posts).toEqual([]);
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
    const resume=panel.locator('.canvas-agent__production').getByRole('button',{name:de?'Fortsetzen':'Resume',exact:true,includeHidden:true});
    await expect(resume).toBeHidden();
    // A forged local click must not bypass the server-owned action projection.
    await resume.evaluate(node=>node.click());expect(state.controls).toEqual([]);
    state.run={...state.run,modelOperation:{...state.run.modelOperation,outcome:'pending',recovery:'receipt_ready'}};
    await refresh.click();await expect(panel.locator('h3')).toHaveText(de?'Anbieterantwort erhalten':'Provider response received');
    await expect(panel.locator('.canvas-agent__production > details')).toContainText('b'.repeat(32));
    await expect(panel).not.toContainText(de?'Die Antwortfrist ist abgelaufen':'The response deadline has passed');
    state.run={...state.run,errorCode:'canvas_agent_receipt_review_required',pendingOutcomeCredits:0,
        currentAction:{code:'settlement_review',phase:'settlement_review',model:'xai/grok-4.7',tool:'billing.review'},
        modelOperation:{...state.run.modelOperation,outcome:'completed',recovery:'settlement_review'}};
    await refresh.click();
    await expect(panel.locator('h3')).toHaveText(de?'Gespeicherte Antwort: Abrechnung prüfen':'Saved response: billing review');
    await runDiagnostic('canvas_agent_receipt_review_required');
    expect(state.posts).toEqual([]);
    await expect(panel.locator('.canvas-agent__current')).toContainText('billing.review');
    await expect(panel).not.toContainText(de?'Der Anbieter hat einen Fehler bestätigt':'The provider confirmed a failure');
    await expect(resume).toBeHidden();await resume.evaluate(node=>node.click());expect(state.controls).toEqual([]);
    await expect(value(de?'Bereits abgerechnet (Credits)':'Already charged (credits)')).toHaveText('0');
    await expect(value(de?'Im Guthaben reserviert (Credits)':'Reserved in wallet (credits)')).toHaveText('127');
    // These are distinct saved states. Do not carry the completed answer's
    // accounting code, current action or cleared unknown commitment forward.
    state.run=structuredClone(originalUnknownRun);
    await page.reload();await page.locator('#canvasAgentToggle').click();await showProject(panel,locale);
    await expect(value(de?'Im Guthaben reserviert (Credits)':'Reserved in wallet (credits)')).toHaveText('127');
    expect(state.posts).toEqual([]);expect(state.controls).toEqual([]);
    // Errors during production must be visible outside the hidden start form.
    state.failRead=true;await refresh.click();
    await exports.expectNotification({page,expect,locale},'canvas_connection_interrupted');
    state.failControl=true;await panel.getByRole('button',{name:de?'Abbrechen':'Cancel',exact:true}).click();
    await exports.expectNotification({page,expect,locale},'canvas_agent_review_required');
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
    const legacyUnknownRun={...state.run,status:'blocked',modelOperation:undefined,allowedActions:undefined};
    state.run={...legacyUnknownRun,errorCode:'canvas_agent_receipt_review_required'};
    await refresh.click();await expect(panel.locator('h3')).toHaveText(de?'Blockiert':'Blocked');
    await expect(panel).not.toContainText(de?'Die Antwortfrist ist abgelaufen':'The response deadline has passed');
    state.run=legacyUnknownRun;
    await refresh.click();await expect(panel.locator('h3')).toHaveText(de?'Anbieterergebnis ungeklärt':'Provider outcome unknown');
    await expect(value(de?'Bereits abgerechnet (Credits)':'Already charged (credits)')).toHaveText('0');
    await expect(value(de?'Im Guthaben reserviert (Credits)':'Reserved in wallet (credits)')).toHaveText('127');
    state.run={...state.run,status:'cancelled',modelOperation:{operationId:'b'.repeat(32),kind:'evaluate',outcome:'unknown',recovery:'review_required'},allowedActions:[]};
    await refresh.click();
    await expect(panel.locator('h3')).toHaveText(de?'Abgebrochen':'Cancelled');
    await expect(resume).toBeHidden();expect(state.posts).toEqual([]);
    const revise=panel.getByRole('button',{name:de?'Weitere Änderung beschreiben':'Describe another change',exact:true,includeHidden:true});
    await expect(revise).toBeHidden();await revise.evaluate(node=>node.click());await showProject(panel,locale);await expect(form).toBeHidden();
    state.run={...state.run,status:'blocked',errorCode:'canvas_agent_provider_rejected',reservedCredits:0,pendingOutcomeCredits:0,modelOperation:{...state.run.modelOperation,outcome:'rejected',recovery:null}};
    await refresh.click();await expect(panel.locator('h3')).toHaveText(de?'Modellanfrage abgelehnt':'Model request rejected');
    await runDiagnostic('canvas_agent_provider_rejected');expect(state.posts).toEqual([]);
    await expect(value(de?'Im Guthaben reserviert (Credits)':'Reserved in wallet (credits)')).toHaveText('0');
    state.run={...state.run,status:'paused',reservedCredits:127,allowedActions:['resume','cancel','takeover'],modelOperation:{...state.run.modelOperation,outcome:'failed',recovery:'billing_review'}};
    await refresh.click();await expect(panel.locator('h3')).toHaveText(de?'Pausiert · Modellanfrage fehlgeschlagen':'Paused · Model request failed');
    await expect(panel.locator('.canvas-agent__production > details')).toContainText('b'.repeat(32));
    await expect(value(de?'Im Guthaben reserviert (Credits)':'Reserved in wallet (credits)')).toHaveText('127');
    await expect(resume).toBeHidden();await resume.evaluate(node=>node.click());expect(state.controls).toHaveLength(1);
    state.run={...state.run,status:'review_required',modelOperation:{...state.run.modelOperation,outcome:'pending',recovery:'review_required'}};
    await refresh.click();await expect(panel.locator('h3')).toHaveText(de?'Modellanfrage benötigt Prüfung':'Model request needs review');
    await expect(resume).toBeHidden();expect(state.posts).toEqual([]);
    state.run={...state.run,status:'paused',allowedActions:null,modelOperation:{...state.run.modelOperation,outcome:'completed',recovery:null}};
    await refresh.click();await expect(resume).toBeHidden();await resume.evaluate(node=>node.click());expect(state.controls).toHaveLength(1);
    // A complete new brief cannot turn an uncertain historical request into
    // permission for a new production, including after the old run is stopped.
    state.conversation.brief.fields.story={value:'A new film about the same house.',provenance:'user_stated'};
    state.conversation.brief.duration={choice:'explicit',targetDurationSeconds:120,asked:false};
    state.run={...state.run,status:'cancelled',modelOperation:{...state.run.modelOperation,outcome:'unknown',recovery:'review_required'}};
    await page.reload();await page.locator('#canvasAgentToggle').click();await showProject(panel,locale);
    await showManual(panel,locale);const produce=form.locator('button[type=submit]');await expect(form).toBeVisible();await expect(produce).toBeDisabled();
    await form.evaluate(node=>node.requestSubmit());expect(state.posts).toEqual([]);
    // Briefing uncertainty independently blocks paid sends and offers a status
    // read. The known-complete control below proves readiness is otherwise met.
    state.run={...state.run,status:'completed',modelOperation:{...state.run.modelOperation,outcome:'completed',recovery:null}};
    state.conversation.messages=[{id:'review',role:'assistant',text:'',status:'review_required'}];
    await page.reload();await page.locator('#canvasAgentToggle').click();await showProject(panel,locale);
    await expect(panel.locator('.canvas-agent__composer button[type=submit]')).toBeDisabled();await expect(produce).toBeDisabled();
    await showChat(panel,locale);await expect(panel.getByRole('button',{name:de?'Gespräch neu laden':'Reload conversation',exact:true})).toBeVisible();
    state.conversation.messages=[];state.conversation.revision++;
    await panel.getByRole('button',{name:de?'Gespräch neu laden':'Reload conversation',exact:true}).click();await expect(produce).toBeEnabled();
    expect(state.posts).toEqual([]);expect(errors).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await panel.screenshot({path:info.outputPath(`canvas-agent-unknown-${locale}.png`)});
};


exports.conversation=async({page,expect,locale,info,mockSharedAuth,createCanvasApiMock})=>{
    const {state,panel,composer,form,canvas,project}=await fixture({page,locale,mockSharedAuth,createCanvasApiMock}),de=locale==='de';
    const input=composer.locator('textarea'),button=name=>panel.getByRole('button',{name,exact:true});
    await expect(input).toBeEnabled();
    const text='A warm comic film about building a house next to a pool with ducks, ending with arriving visitors.';
    await input.fill(text);await showOptions(panel,locale);state.holdChatResponse=true;await button(de?'Für später speichern':'Save for later').click();
    await expect.poll(()=>Boolean(state.releaseChatResponse)).toBe(true);
    // A held response cannot produce a browser-authored success notice.
    // The server's atomic receipt may already exist before transport completes.
    expect(canvas.notificationClients.filter(item=>item.code==='canvas_brief_saved')).toHaveLength(0);
    await state.releaseChatResponse();
    await expect.poll(()=>canvas.notifications.filter(item=>item.code==='canvas_brief_saved').length).toBe(1);
    const savedNotice=structuredClone(canvas.notifications.find(item=>item.code==='canvas_brief_saved'));
    expect(savedNotice).toMatchObject({id:`conversation-control:${project}:control:0`,source:'conversation',kind:'control',confirmed:true,resolved:true,status:'completed',details:{actionType:'brief_save'}});
    await page.locator('#canvasNotificationsToggle').click();
    await expect(page.locator('#canvasNotificationsPanel')).toContainText(de?'Projektidee gespeichert.':'Project brief saved.');
    await page.locator('#canvasNotificationsPanel').getByRole('button',{name:de?'Meldungen schließen':'Close notifications',exact:true}).click();
    const savedRequest=structuredClone(state.chatControls[0]),savedRevision=state.conversation.revision;
    const submitControl=request=>page.evaluate(async({project,body,key})=>{
        const response=await fetch(`/api/account/canvas/projects/${project}/agent/conversation/control`,{
            method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body),
        });return {status:response.status,body:await response.json()};
    },{project,...request});
    expect((await submitControl(savedRequest)).status).toBe(200);
    expect(state.conversation.revision).toBe(savedRevision);
    expect(canvas.notifications.filter(item=>item.code==='canvas_brief_saved')).toHaveLength(1);
    expect(canvas.notifications.find(item=>item.id===savedNotice.id).createdAt).toBe(savedNotice.createdAt);
    const stale=await submitControl({...savedRequest,key:savedRequest.key+'-stale'});
    expect(stale).toMatchObject({status:409,body:{ok:false,code:'canvas_conversation_revision_conflict'}});
    expect(state.conversation.revision).toBe(savedRevision);
    expect(canvas.notifications.filter(item=>item.code==='canvas_brief_saved')).toHaveLength(1);
    expect(canvas.notificationClients.filter(item=>item.code==='canvas_brief_saved')).toHaveLength(0);
    expect(state.chatPosts).toEqual([]);expect(state.posts).toEqual([]);expect(state.allowancePosts).toEqual([]);
    await page.reload();await page.locator('#canvasAgentToggle').click();await expect(input).toHaveValue(text);
    await expect(composer.locator('button[type=submit]')).toBeDisabled();await showOptions(panel,locale);await button(de?'Briefing fortsetzen':'Resume briefing').click();await showChat(panel,locale);await expect(input).toBeEnabled();
    await briefing({panel,locale,expect,text});
    expect(state.allowancePosts).toHaveLength(1);expect(state.allowancePosts[0].body.capCredits).toBe(20);
    expect(canvas.notifications.filter(item=>item.code==='canvas_allowance_accepted')).toHaveLength(1);
    expect(canvas.notifications.find(item=>item.code==='canvas_allowance_accepted')).toMatchObject({source:'conversation',kind:'authorization',confirmed:true,details:{actionType:'allowance_propose'}});
    await expect(panel.locator('.canvas-agent__brief')).toContainText(text);
    await showOptions(panel,locale);await button(de?'Projektidee vorbereiten':'Prepare the brief').click();
    expect(state.conversation.brief.duration.choice).toBe(null);expect(state.posts).toEqual([]);
    await expect(form.locator('button[type=submit]')).toBeDisabled();
    // An interrupted response retains the original request across reload. The
    // fixture independently rejects stale revisions and de-duplicates its key.
    await showChat(panel,locale);await expect(input).toBeEnabled();state.loseChatResponse=true;state.holdMessageAcceptance=true;
    const beforeMessage={posts:state.chatPosts.length,revision:state.conversation.revision,briefRevision:state.conversation.briefRevision};
    await input.fill('A 120 second film.');await composer.locator('button[type=submit]').click();
    await expect.poll(()=>typeof state.releaseMessageAcceptance).toBe('function');
    const check=button(de?'Nachricht prüfen':'Check message');await expect(check).toBeVisible();await expect(check).toBeDisabled();
    // Local pending UI precedes acceptance: it cannot identify the new server
    // request while the transport is deliberately held at that boundary.
    expect(state.chatPosts).toHaveLength(beforeMessage.posts);expect(state.conversation.revision).toBe(beforeMessage.revision);
    expect(state.conversation.messages.filter(message=>message.role==='user'&&message.text==='A 120 second film.')).toHaveLength(0);
    state.releaseMessageAcceptance();
    await expect.poll(()=>state.chatPosts.length).toBe(beforeMessage.posts+1);await expect(check).toBeEnabled();
    const accepted=structuredClone(state.chatPosts.at(-1));
    expect(accepted.body).toEqual({text:'A 120 second film.',locale,expectedConversationRevision:beforeMessage.revision,expectedBriefRevision:beforeMessage.briefRevision});
    expect(accepted.key).toBeTruthy();expect(state.chatPosts.slice(0,-1).some(request=>request.key===accepted.key)).toBe(false);
    expect(state.conversation.revision).toBe(beforeMessage.revision+1);expect(state.conversation.briefRevision).toBe(beforeMessage.briefRevision+1);
    await page.reload();await page.locator('#canvasAgentToggle').click();await expect(check).toBeVisible();await expect(check).toBeEnabled();
    await check.click();await expect(check).toBeHidden();expect(state.chatPosts.at(-1)).toEqual(accepted);
    expect(state.chatPosts).toHaveLength(beforeMessage.posts+2);expect(state.conversation.revision).toBe(beforeMessage.revision+1);
    expect(state.conversation.messages.filter(message=>message.role==='user'&&message.text==='A 120 second film.')).toHaveLength(1);
    expect(state.conversation.messages.filter(message=>/How long|Wie lang/.test(message.text))).toHaveLength(1);
    await expect(panel.locator('.canvas-agent__brief')).toContainText('120 s');
    const hostile='<img src=x onerror="window.canvasInjected=true">';
    state.conversation.messages.push({id:'hostile',role:'assistant',text:hostile+' [open](javascript:alert(1))',status:'completed'});state.conversation.revision++;
    await page.reload();await page.locator('#canvasAgentToggle').click();
    await expect(panel.locator('.canvas-agent__messages')).toContainText(hostile);
    await expect(panel.locator('.canvas-agent__messages a, .canvas-agent__messages img, .canvas-agent__messages script')).toHaveCount(0);
    expect(await page.evaluate(()=>window.canvasInjected)).toBeUndefined();
    expect(state.posts).toEqual([]);expect(state.controls).toEqual([]);
    await showProject(panel,locale);await button(de?'Projektidee korrigieren':'Correct the brief').click();await expect(input).toBeFocused();
    await input.fill('Keep the same house; use a realistic style instead.');await input.press('Control+Enter');
    await expect(panel.locator('.canvas-agent__brief')).toContainText('realistic style instead');
    await showOptions(panel,locale);await button(de?'Briefing beenden':'End briefing').click();await expect(composer.locator('button[type=submit]')).toBeDisabled();
    expect(canvas.notifications.filter(item=>item.code==='canvas_brief_cancelled')).toHaveLength(1);
    expect(state.controls).toEqual([]);
    const privacy=panel.locator('.canvas-agent__privacy');await privacy.locator('summary').click();
    await button(de?'Gespräch und Projektidee löschen':'Delete conversation and brief').click();
    await button(de?'Gespräch jetzt löschen':'Delete conversation now').click();
    await expect(panel.locator('.canvas-agent__messages li')).toHaveCount(0);await expect(form).toBeHidden();
    expect(canvas.notifications.filter(item=>item.code==='canvas_brief_cleared')).toHaveLength(1);
    expect(state.chatControls.map(item=>item.body.action)).toContain('clear');expect(state.posts).toEqual([]);
    expect(await panel.locator('input,textarea').evaluateAll(nodes=>nodes.every(node=>node.labels.length>0))).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await panel.screenshot({path:info.outputPath(`canvas-conversation-${locale}.png`)});
};

exports.viewport=async({page,expect,locale,info,mockSharedAuth,createCanvasApiMock})=>{
    const {state,panel,composer}=await fixture({page,locale,mockSharedAuth,createCanvasApiMock}),de=locale==='de';
    await page.setViewportSize({width:de?390:1440,height:720});
    state.conversation.allowance={capCredits:3000,committedCredits:77,chargedCredits:0,reservedCredits:77,remainingCredits:2923,tariffRevision:29};
    state.conversation.brief.fields.delegatedChoices={value:'Choose reasonable defaults for optional creative details. This does not delegate duration or spending.',provenance:'delegated',revision:1};
    state.conversation.messages=Array.from({length:64},(_,i)=>({id:'long-'+i,role:i%2?'assistant':'user',text:`${i+1}. ${'A short scene near the same house and duck pool. '.repeat(i%5+1)}`,status:'completed'}));
    await page.reload();await page.locator('#canvasAgentToggle').click();
    await expect(panel.locator('.canvas-agent__messages li')).toHaveCount(64);
    const measure=()=>panel.evaluate(node=>{const p=node.getBoundingClientRect(),c=node.querySelector('.canvas-agent__composer').getBoundingClientRect(),t=node.querySelector('.canvas-agent__transcript')||node.querySelector('.canvas-agent__messages');return {panelTop:p.top,panelBottom:p.bottom,composerTop:c.top,composerBottom:c.bottom,transcriptHeight:t.clientHeight,transcriptScroll:t.scrollHeight,viewport:innerHeight};});
    const initial=await measure();await info.attach('chat-viewport-measurement',{contentType:'application/json',body:JSON.stringify(initial)});
    expect(initial.composerBottom).toBeLessThanOrEqual(initial.panelBottom+1);
    expect(initial.panelBottom).toBeLessThanOrEqual(initial.viewport+1);
    expect(initial.transcriptScroll).toBeGreaterThan(initial.transcriptHeight+100);
    const scroll=panel.locator('.canvas-agent__transcript'),messages=panel.locator('.canvas-agent__messages');
    const reload=panel.getByRole('button',{name:de?'Gespräch neu laden':'Reload conversation',exact:true});
    await expect.poll(()=>scroll.evaluate(node=>node.scrollHeight-node.clientHeight-node.scrollTop)).toBeLessThan(3);
    await scroll.evaluate(node=>{node.scrollTop=node.scrollHeight/3;node.dispatchEvent(new Event('scroll'));});
    const reading=await scroll.evaluate(node=>{const top=node.getBoundingClientRect().top,row=[...node.querySelectorAll('li')].find(row=>row.getBoundingClientRect().bottom>top+2);window.canvasReadingNode=row;const text=row.querySelector('p').firstChild;const range=document.createRange();range.setStart(text,0);range.setEnd(text,Math.min(15,text.length));window.getSelection().removeAllRanges();window.getSelection().addRange(range);return{id:row.dataset.messageId,offset:row.getBoundingClientRect().top-top,selected:window.getSelection().toString()};});
    state.conversation.revision++;
    await reload.evaluate(node=>node.click());
    await expect.poll(()=>messages.evaluate((node,id)=>node.querySelector(`[data-message-id="${id}"]`)===window.canvasReadingNode,reading.id)).toBe(true);
    expect(await page.evaluate(()=>window.getSelection().toString())).toBe(reading.selected);
    const offset=()=>scroll.evaluate((node,id)=>node.querySelector(`[data-message-id="${id}"]`).getBoundingClientRect().top-node.getBoundingClientRect().top,reading.id);
    state.conversation.messages.unshift({id:'older',role:'user',text:'An older remembered scene. '.repeat(10),status:'completed'});
    state.conversation.messages.push({id:'newest',role:'assistant',text:'',status:'pending',delivery:{stage:'provider_pending',blocking:true,canObserve:true,source:'system',diagnosticReference:'cr_fixture_pending'}});state.conversation.revision++;
    await reload.evaluate(node=>node.click());await expect(messages.locator('li')).toHaveCount(66);
    expect(Math.abs(await offset()-reading.offset)).toBeLessThan(3);
    const newest=panel.getByRole('button',{name:de?'Neue Nachrichten':'New messages',exact:true});await expect(newest).toBeVisible();
    // A real layout-size change above the reading anchor models delayed media
    // metadata or font reflow; fixed scrollTop alone cannot pass this control.
    await messages.locator('li').first().evaluate(node=>{node.style.paddingBottom='240px';});
    await expect.poll(async()=>Math.abs(await offset()-reading.offset)).toBeLessThan(3);
    await page.setViewportSize({width:de?430:1280,height:560});
    await expect.poll(async()=>Math.abs(await offset()-reading.offset)).toBeLessThan(3);
    const compact=await measure();expect(compact.composerBottom).toBeLessThanOrEqual(compact.viewport+1);expect(compact.transcriptHeight).toBeGreaterThan(40);
    await newest.click();await expect(newest).toBeHidden();await expect.poll(()=>scroll.evaluate(node=>node.scrollHeight-node.clientHeight-node.scrollTop)).toBeLessThan(3);
    await scroll.evaluate(node=>{node.scrollTop=node.scrollHeight/4;node.dispatchEvent(new Event('scroll'));});
    const pendingNode=messages.locator('[data-message-id=newest]');await pendingNode.evaluate(node=>{window.canvasPendingNode=node;});
    state.conversation.messages.at(-1).text='The newest validated reply.';state.conversation.messages.at(-1).status='completed';state.conversation.messages.at(-1).delivery={stage:'completed',blocking:false,canObserve:false,source:'provider'};state.conversation.revision++;
    await reload.evaluate(node=>node.click());await expect(pendingNode).toContainText('The newest validated reply.');
    expect(await pendingNode.evaluate(node=>node===window.canvasPendingNode)).toBe(true);await expect(newest).toBeVisible();
    await newest.click();await expect(newest).toBeHidden();
    // The bounds helper must reject a deliberately unbounded scrolling chain.
    const rejected=await panel.evaluate(node=>{const mount=node.querySelector('.canvas-agent__mount'),before=mount.style.cssText;mount.style.minHeight='4000px';const failed=node.querySelector('.canvas-agent__composer').getBoundingClientRect().bottom>node.getBoundingClientRect().bottom+1;mount.style.cssText=before;return failed;});expect(rejected).toBe(true);
    await panel.getByRole('tab',{name:de?'Projekt & Produktion':'Project & production',exact:true}).click();
    await expect(panel.locator('.canvas-agent__brief')).toContainText(de?'Dauer und Ausgabenfreigabe':'Duration and spending approval');
    await expect(panel.locator('.canvas-agent__brief')).not.toContainText('Choose reasonable defaults');
    expect(state.conversation.brief.fields.delegatedChoices.value).toContain('Choose reasonable defaults');
    await panel.getByRole('tab',{name:de?'Gespräch':'Conversation',exact:true}).click();
    const input=composer.locator('textarea');await input.fill('First line');await input.press('Shift+Enter');await input.type('Second line');expect(await input.inputValue()).toBe('First line\nSecond line');
    const before=state.chatPosts.length;
    await input.evaluate(node=>{node.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));node.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}));node.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));});
    expect(state.chatPosts).toHaveLength(before);await input.press('Enter');await expect.poll(()=>state.chatPosts.length).toBe(before+1);
    expect(state.chatPosts.at(-1).body.text).toBe('First line\nSecond line');
    await panel.screenshot({path:info.outputPath(`canvas-chat-bounded-${locale}.png`)});
};

exports.delivery=async({page,expect,locale,info,mockSharedAuth,createCanvasApiMock})=>{
    const {state,panel,composer,canvas,project}=await fixture({page,locale,mockSharedAuth,createCanvasApiMock}),de=locale==='de';
    const userText=de?'Ein lustiger ungefähr 45 Sekunden langer Film mit Hintergrundmusik: Eine Schnecke auf einem Blatt, Ameisen schneiden das Blatt ab.':'A funny approximately 45 second video with background music: a snail on a leaf, ants cut the leaf.';
    const diagnostic='cr_0123456789abcdef';
    const delivery={stage:'provider_pending',blocking:true,diagnosticReference:diagnostic,canObserve:true,source:'system'};
    Object.assign(state.conversation,{canSend:false,pendingTurnId:null,blockingOperation:{...delivery,turnId:'observed'},allowance:{capCredits:3000,committedCredits:77,chargedCredits:0,reservedCredits:77,remainingCredits:2923,tariffRevision:29},messages:[{id:'observed',role:'user',text:userText,status:'completed'},{id:'observed:reply',role:'assistant',text:'',status:'review_required',delivery}],brief:{...state.conversation.brief,fields:{story:{value:userText,provenance:'user_stated'}},duration:{choice:'explicit',targetDurationSeconds:45,asked:true}}});
    const current=state.conversation;
    await page.reload();await page.locator('#canvasAgentToggle').click();
    const reply=panel.locator('[data-message-id="observed:reply"]');
    await expect(reply).toHaveAttribute('data-kind','system');await expect(reply).toContainText(de?'Einen Moment':'One moment');
    await expect(reply).not.toContainText(de?'Canvas-Assistent':'Canvas assistant');await expect(composer.locator('button[type=submit]')).toBeDisabled();
    await expect(reply.locator('.canvas-agent__bee')).toBeVisible();
    await expect(reply.locator('.canvas-agent__diagnostic')).toBeHidden();
    const inbox=page.locator('#canvasNotificationsPanel');
    const notification=(id,diagnosticRef,code)=>({id,source:'conversation',kind:'conversation',code,severity:'warning',projectId:project,createdAt:new Date().toISOString(),readAt:null,confirmed:true,diagnosticRef});
    canvas.notifications.push(notification('delivery-observed',diagnostic,'canvas_agent_receipt_review_required'));
    await page.locator('#canvasNotificationsToggle').click();await inbox.locator('[data-notification-id="delivery-observed"] summary').click();
    await expect(inbox.locator('code')).toContainText(diagnostic);
    await inbox.getByRole('button',{name:de?'Meldungen schließen':'Close notifications',exact:true}).click();
    await showFinance(panel,locale);const costs=panel.locator('.canvas-agent__briefing-cost');
    await expect(costs).toContainText(de?'Tatsächlich abgerechnet':'Actually charged');
    await expect(costs.locator('dt').filter({hasText:de?'Tatsächlich abgerechnet':'Actually charged'}).locator('xpath=following-sibling::dd[1]')).toHaveText('0');
    await expect(costs.locator('dt').filter({hasText:de?'Im Guthaben reserviert':'Reserved in your wallet'}).locator('xpath=following-sibling::dd[1]')).toHaveText('77');
    await showChat(panel,locale);
    current.messages[1].delivery={...delivery,stage:'dispatch_unknown',recovery:'operator'};current.blockingOperation={...current.messages[1].delivery,turnId:'observed'};current.revision++;
    await panel.getByRole('button',{name:de?'Gespräch neu laden':'Reload conversation',exact:true}).click();
    await expect(reply).toHaveCount(0);
    await expect(composer.locator('button[type=submit]')).toBeDisabled();
    // Late completion must be picked up without clicking Reload or making a
    // second paid POST, even though the old turn status was review_required.
    current.canSend=true;current.blockingOperation=null;current.revision++;
    current.messages[1]={...current.messages[1],text:de?'Wir erzählen die Szene als 45-sekündige Komödie mit passender Musik.':'We can tell this as a 45-second comedy with suitable music.',status:'completed',delivery:{stage:'completed',blocking:false,canObserve:false,source:'provider',diagnosticReference:diagnostic}};
    await expect(reply).toHaveAttribute('data-kind','assistant',{timeout:15000});await expect(reply.locator('.canvas-agent__diagnostic')).toBeHidden();await expect(composer.locator('button[type=submit]')).toBeEnabled();
    expect(current.messages[0].text).toBe(userText);expect(state.chatPosts).toEqual([]);expect(state.posts).toEqual([]);
    current.messages.unshift({id:'old-local-error',role:'assistant',text:'',status:'review_required',delivery:{stage:'preparation_failed',blocking:false,canObserve:false,source:'system',diagnosticReference:'cr_local_preparation'}});current.revision++;
    await panel.getByRole('button',{name:de?'Gespräch neu laden':'Reload conversation',exact:true}).click();
    await expect(composer.locator('button[type=submit]')).toBeEnabled();await expect(panel.locator('[data-message-id=old-local-error]')).toHaveCount(0);
    await panel.screenshot({path:info.outputPath(`canvas-chat-delivery-${locale}.png`)});
    // Exhausted reconciliation is an explicit operator state, not an endless
    // poll or permission for a replacement paid request.
    await page.clock.install();
    const operator={stage:'dispatch_unknown',blocking:true,canObserve:false,recovery:'operator',source:'system',diagnosticReference:'cr_operator_attention'};
    current.canSend=false;current.blockingOperation={...operator,turnId:'operator'};current.messages.push({id:'operator:reply',role:'assistant',status:'review_required',text:'',delivery:operator});current.revision++;
    await panel.getByRole('button',{name:de?'Gespräch neu laden':'Reload conversation',exact:true}).click();
    await expect(panel.locator('[data-message-id="operator:reply"]')).toHaveCount(0);
    canvas.notifications.push(notification('delivery-operator','cr_operator_attention','canvas_agent_receipt_review_required'));
    await page.locator('#canvasNotificationsToggle').click();
    await inbox.locator('[data-notification-id="delivery-operator"] summary').click();await expect(inbox).toContainText('cr_operator_attention');
    await inbox.getByRole('button',{name:de?'Meldungen schließen':'Close notifications',exact:true}).click();
    const reads=state.chatReads;await page.clock.fastForward(20000);expect(state.chatReads).toBe(reads);
    await expect(composer.locator('button[type=submit]')).toBeDisabled();expect(state.chatPosts).toEqual([]);expect(state.posts).toEqual([]);
};

exports.actions=async({page,expect,locale,mockSharedAuth,createCanvasApiMock})=>{
    const {state,panel}=await fixture({page,locale,mockSharedAuth,createCanvasApiMock}),de=locale==='de';
    await expect(panel.locator('.canvas-agent__composer textarea')).toBeEnabled();
    const reload=panel.getByRole('button',{name:de?'Gespräch neu laden':'Reload conversation',exact:true});
    const action={id:'9'.repeat(32),type:'allowance_accept',state:'confirmation_required',text:'<img src=x onerror="window.actionInjected=true">',effect:null,confirmation:{kind:'allowance',expectedRevision:0,expectedBriefRevision:0,capCredits:100,tariffRevision:29}};
    state.conversation.actions=[action];state.conversation.revision++;
    await reload.click();const card=panel.locator('.canvas-agent__action'),accept=card.getByRole('button',{name:de?'Diese Aktion bestätigen':'Confirm this action',exact:true});
    await expect(card).toContainText(action.text);await expect(card.locator('img,script,a')).toHaveCount(0);expect(await page.evaluate(()=>window.actionInjected)).toBeUndefined();
    await expect(accept).toBeEnabled();expect(state.actionPosts).toEqual([]);
    // A missing exact tariff is a broken approval, even when the server-like
    // suggestion text says that it is ready. The same valid control works below.
    delete action.confirmation.tariffRevision;state.conversation.revision++;await reload.click();await expect(accept).toBeDisabled();await accept.evaluate(node=>node.click());expect(state.actionPosts).toEqual([]);
    action.confirmation.tariffRevision=29;state.conversation.revision++;await reload.click();await expect(accept).toBeEnabled();
    state.loseActionResponse=true;await accept.click();const retry=panel.getByRole('button',{name:de?'Nachricht prüfen':'Check message',exact:true});await expect(retry).toBeVisible();
    await expect.poll(()=>state.actionPosts.length).toBe(1);const original=structuredClone(state.actionPosts[0]);await expect(retry).toBeEnabled();await retry.click();await expect(retry).toBeHidden();expect(state.actionPosts).toHaveLength(2);expect(state.actionPosts[1]).toEqual(original);expect(original.body).toEqual({decision:'accept',expectedRevision:0,expectedBriefRevision:0,capCredits:100,tariffRevision:29});
    await expect(card).toHaveCount(0);
    state.conversation.actions.push({id:'8'.repeat(32),type:'export',state:'pending',text:'Export accepted.',effect:null,confirmation:null});state.conversation.revision++;
    await reload.click();const pending=panel.locator('[data-action-id="'+ '8'.repeat(32)+'"]');await expect(pending).toHaveCount(0);
    const reads=state.chatReads;state.conversation.actions[1].state='completed';state.conversation.actions[1].text='Export saved.';state.conversation.revision++;
    await expect.poll(()=>state.chatReads,{timeout:15000}).toBeGreaterThan(reads);await expect(pending).toHaveCount(0);expect(state.actionPosts).toHaveLength(2);expect(state.posts).toEqual([]);
};

exports.pending_controls=async({page,expect,locale,mockSharedAuth,createCanvasApiMock})=>{
    const {state,panel,project,composer}=await fixture({page,locale,mockSharedAuth,createCanvasApiMock}),de=locale==='de';
    state.run={id:'a'.repeat(32),projectId:project,status:'running',phase:'generating',completed:1,total:3,budgetCredits:1000,allowedActions:['pause','cancel','takeover']};
    const delivery={stage:'provider_pending',source:'system',canObserve:true,blocking:true};
    Object.assign(state.conversation,{canSend:false,pendingTurnId:'late',messages:[{id:'late:reply',role:'assistant',text:'',status:'pending',delivery}]});
    await page.reload();await page.locator('#canvasAgentToggle').click();
    const bar=panel.locator('.canvas-agent__chat-run');await expect(bar).toBeVisible();await expect(composer.locator('button[type=submit]')).toBeDisabled();
    await bar.getByRole('button',{name:de?'Pausieren':'Pause',exact:true}).click();await expect.poll(()=>state.run.status).toBe('paused');
    expect(state.controls.map(value=>value.body.action)).toEqual(['pause']);expect(state.chatPosts).toEqual([]);expect(state.conversation.pendingTurnId).toBe('late');
    await bar.getByRole('button',{name:de?'Produktion stoppen':'Stop production',exact:true}).click();await expect.poll(()=>state.run.status).toBe('cancelled');
    expect(state.controls.map(value=>value.body.action)).toEqual(['pause','cancel']);expect(state.chatPosts).toEqual([]);expect(state.posts).toEqual([]);
    await expect(panel.locator('.canvas-agent__thinking')).toBeVisible();
};

exports.media_counts=async({page,expect,locale,mockSharedAuth,createCanvasApiMock})=>{
 const {state,panel}=await fixture({page,locale,mockSharedAuth,createCanvasApiMock});
 state.run={id:'a'.repeat(32),projectId:'1'.repeat(32),status:'running',phase:'generating',completed:2,total:8,budgetCredits:3000,mediaProgress:{waiting:3,generating:2,saved:1,blocked:1}};
 await page.reload();await page.locator('#canvasAgentToggle').click();await showProject(panel,locale);
 const counts=panel.locator('.canvas-agent__counts'),refresh=panel.getByRole('button',{name:locale==='de'?'Status prüfen':'Check status',exact:true});
 await expect(counts).toHaveText(locale==='de'?'3 warten · 2 in Generierung · 1 gespeichert · 1 blockiert':'3 waiting · 2 generating · 1 saved · 1 blocked');
 state.run.mediaProgress.generating=-1;await refresh.click();await expect(counts).toHaveText(locale==='de'?'2 / 8 abgeschlossen':'2 / 8 completed');
 delete state.run.mediaProgress;await refresh.click();await expect(counts).toHaveText(locale==='de'?'2 / 8 abgeschlossen':'2 / 8 completed');
 expect(state.posts).toEqual([]);
};

// Presentation-only interaction coverage reuses the same conversation fixture.
exports.workspace=async({page,expect,locale,info,mockSharedAuth,createCanvasApiMock,scenario})=>{
    const {state,canvas,project,panel,composer}=await fixture({page,locale,mockSharedAuth,createCanvasApiMock}),de=locale==='de',errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.setViewportSize({width:1440,height:820});
    canvas.nodes=[{id:'b'.repeat(32),project_id:project,type:'note',title:'Retained selection',x:380,y:160,width:230,height:140,config:{},content:{text:'Preserve this node'},output:null}];
    state.conversation.allowance={capCredits:3000,committedCredits:0,remainingCredits:3000,tariffRevision:29};
    state.conversation.messages=Array.from({length:40},(_,i)=>({id:'size-'+i,role:i%2?'assistant':'user',text:`${i}. ${'A film scene with the same characters and location. '.repeat(i%4+2)}`,status:'completed'}));
    state.conversation.pendingTurnId='pending-size';
    state.conversation.messages.push({id:'pending-size:reply',role:'assistant',text:'',status:'pending',delivery:{stage:'provider_pending',canObserve:true,source:'system'}});
    await page.reload();await page.locator('#canvasAgentToggle').click();
    const handle=page.locator('#canvasAgentResize'),expand=page.locator('#canvasAgentExpand'),input=composer.locator('textarea'),scroll=panel.locator('.canvas-agent__transcript');
    const width=async()=>Math.round((await panel.boundingBox()).width);
    const graph=page.locator('#canvasViewport');
    await page.locator(`[data-node-id="${'b'.repeat(32)}"]`).press('Enter');
    await page.locator('.canvas-view-controls button').filter({hasText:'−'}).click();
    await graph.evaluate(node=>node.scrollTo(170,110));
    const graphState=()=>graph.evaluate(node=>({x:node.scrollLeft,y:node.scrollTop,transform:document.getElementById('canvasSurface').style.transform,selected:document.querySelector('.canvas-node.is-selected')?.dataset.nodeId}));
    const originalGraph=await graphState();expect(originalGraph.selected).toBe('b'.repeat(32));
    await input.fill('A retained unsent draft');
    await scroll.evaluate(node=>{node.scrollTop=node.scrollHeight/3;node.dispatchEvent(new Event('scroll'));});
    const reading=await scroll.evaluate(node=>{const top=node.getBoundingClientRect().top,row=[...node.querySelectorAll('[data-message-id]')].find(r=>r.getBoundingClientRect().bottom>top+2);window.retainedComposer=document.querySelector('.canvas-agent__composer');return{id:row.dataset.messageId,offset:row.getBoundingClientRect().top-top};});
    const readingOffset=()=>scroll.evaluate((node,id)=>node.querySelector(`[data-message-id="${id}"]`).getBoundingClientRect().top-node.getBoundingClientRect().top,reading.id);
    const writes=()=>canvas.requests.filter(r=>r.method!=='GET'&&!r.pathname.endsWith('/notifications/read'));
    const beforeWrites=writes().length;
    if(scenario==='layout'){
        const start=await width(),box=await handle.boundingBox();
        await page.mouse.move(box.x+5,box.y+100);await page.mouse.down();await page.mouse.move(box.x-180,box.y+100,{steps:12});
        await expect.poll(width).toBeGreaterThan(start+170);await page.mouse.move(box.x-80,box.y+100,{steps:8});await page.mouse.up();
        await expect.poll(width).toBeGreaterThan(start+70);await expect.poll(width).toBeLessThan(start+100);
        expect(await graphState()).toEqual(originalGraph);expect(Math.abs(await readingOffset()-reading.offset)).toBeLessThan(4);
        const chosen=await width();await expect(handle).toHaveAttribute('aria-valuenow',String(chosen));
        await expand.click();await expect(expand).toHaveAccessibleName(de?'Zur Seitenleiste zurück':'Restore sidebar');
        const bounds=await panel.evaluate(node=>{const p=node.getBoundingClientRect(),l=node.parentElement.getBoundingClientRect(),t=document.querySelector('.canvas-topbar').getBoundingClientRect();return{left:p.left,right:p.right,top:p.top,bottom:p.bottom,layoutLeft:l.left,layoutRight:l.right,layoutTop:l.top,layoutBottom:l.bottom,toolbarBottom:t.bottom};});
        expect(bounds.left).toBe(bounds.layoutLeft);expect(bounds.right).toBe(bounds.layoutRight);expect(bounds.top).toBe(bounds.layoutTop);expect(bounds.bottom).toBe(bounds.layoutBottom);expect(bounds.top).toBeGreaterThanOrEqual(bounds.toolbarBottom);
        await expect(page.locator('#canvasProjectsPanel')).toBeHidden();await expect(page.locator('#canvasGraphPanel')).toHaveAttribute('inert','');
        const dialogs=[],onDialog=async dialog=>{dialogs.push(dialog.type());await dialog.dismiss();};page.on('dialog',onDialog);
        await expand.press('Delete');await expand.press('Backspace');expect(dialogs).toEqual([]);
        await page.locator('#canvasNotificationsToggle').press('Delete');expect(dialogs).toEqual([]);
        // The geometry assertion must detect a graph-only rather than full-workspace overlay.
        expect(await panel.evaluate(node=>{node.style.left='220px';const bad=node.getBoundingClientRect().left>node.parentElement.getBoundingClientRect().left;node.style.left='';return bad;})).toBe(true);
        await expect(page.locator('body > header')).toBeVisible();await page.locator('#canvasNotificationsToggle').click();
        const inbox=page.locator('#canvasNotificationsPanel');await expect(inbox).toBeVisible();
        expect(await inbox.evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.left+20,r.top+20));})).toBe(true);
        await inbox.getByRole('button',{name:de?'Meldungen schließen':'Close notifications',exact:true}).click();
        await page.screenshot({path:info.outputPath(`canvas-ai-expanded-${locale}.png`)});
        state.conversation.messages.at(-1).status='completed';state.conversation.messages.at(-1).text='One incoming reply during expansion.';state.conversation.pendingTurnId=null;state.conversation.revision++;
        await expect(panel.locator('[data-message-id="pending-size:reply"]')).toContainText('One incoming reply during expansion.',{timeout:15000});
        await expect(panel.locator('[data-message-id="pending-size:reply"]')).toHaveCount(1);await expect(input).toHaveValue('A retained unsent draft');
        expect(Math.abs(await readingOffset()-reading.offset)).toBeLessThan(4);
        await expand.click();await expect.poll(width).toBe(chosen);expect(await graphState()).toEqual(originalGraph);
        await graph.focus();await graph.press('Delete');expect(dialogs).toEqual(['confirm']);page.off('dialog',onDialog);
        await showProject(panel,locale);await expand.click();await expect(panel.getByRole('tab',{name:de?'Projekt & Produktion':'Project & production',exact:true})).toHaveAttribute('aria-selected','true');
        await page.locator('#canvasInspectorToggle').click();await expect(page.locator('#canvasInspectorPanel')).toBeVisible();expect(Math.round((await page.locator('#canvasInspectorPanel').boundingBox()).width)).toBe(320);
        await page.locator('#canvasAgentToggle').click();await expect.poll(width).toBe(chosen);await showChat(panel,locale);
        for(let i=0;i<4;i++){await expand.click();await expand.click();}
        expect(await composer.evaluate(node=>node===window.retainedComposer)).toBe(true);await expect(input).toHaveValue('A retained unsent draft');
        const c=await composer.boundingBox(),p=await panel.boundingBox();expect(c.y+c.height).toBeLessThanOrEqual(p.y+p.height);
        await expect(panel.locator('.canvas-agent__make-now')).toBeInViewport();
        await expand.click();await page.locator('#canvasProjectsToggle').click();await expect(page.locator('#canvasProjectsPanel')).toBeVisible();await expect(expand).toHaveAttribute('aria-expanded','false');
        await expand.click();await page.locator('#canvasAgentToggle').click();await expect(panel).toBeHidden();await expect(page.locator('#canvasGraphPanel')).not.toHaveAttribute('inert','');
        await page.locator('#canvasAgentToggle').click();await expect.poll(width).toBe(chosen);
    }else{
        await handle.focus();const initial=await width();await handle.press('ArrowLeft');await expect.poll(width).toBe(initial+16);await handle.press('ArrowRight');await expect.poll(width).toBe(initial);
        await handle.press('End');expect(await width()).toBe(Number(await handle.getAttribute('aria-valuemax')));expect((await graph.boundingBox()).width).toBeGreaterThanOrEqual(359);
        await handle.press('Home');await expect.poll(width).toBe(320);await handle.press('Shift+ArrowLeft');await expect.poll(width).toBe(368);
        await input.focus();await input.press('ArrowLeft');await expect.poll(width).toBe(368);
        const cancelBox=await handle.boundingBox();await page.mouse.move(cancelBox.x+5,cancelBox.y+100);await page.mouse.down();await page.mouse.move(cancelBox.x-70,cancelBox.y+100);await expect.poll(width).toBeGreaterThan(420);
        await handle.dispatchEvent('pointercancel');await page.mouse.up();await expect.poll(width).toBe(368);await expect(page.locator('#canvasApp')).not.toHaveClass(/is-agent-resizing/);
        const chosen=await width();await page.reload();await page.locator('#canvasAgentToggle').click();await expect.poll(width).toBe(chosen);
        await page.setViewportSize({width:980,height:620});await expand.click();
        await expect(panel.locator('.canvas-agent__make-now')).toBeInViewport();await expect(page.locator('#canvasNotificationsToggle')).toBeInViewport();
        await page.setViewportSize({width:640,height:720});await expect(panel).toBeVisible();await expect(handle).toBeHidden();await expect(expand).toBeHidden();
        await page.locator('#canvasHistoryToggle').click();await expect(page.locator('#canvasHistoryPanel')).toBeVisible();await page.locator('#canvasAgentToggle').click();
        await page.setViewportSize({width:1440,height:820});await expect.poll(width).toBe(chosen);await expect(handle).toBeVisible();
        const box=await handle.boundingBox();await page.mouse.move(box.x+5,box.y+80);await page.mouse.down();await page.mouse.move(box.x-40,box.y+80);await page.locator('#canvasAgentToggle').evaluate(node=>node.click());await page.mouse.up();
        await expect(page.locator('#canvasApp')).not.toHaveClass(/is-agent-resizing/);await page.locator('#canvasAgentToggle').click();
        await page.evaluate(()=>{document.documentElement.style.zoom='1.25';});await expand.click();
        const r=await panel.boundingBox(),t=await page.locator('.canvas-topbar').boundingBox();expect(r.y).toBeGreaterThanOrEqual(t.y+t.height-1);
        await expect(expand).toBeInViewport();await expand.focus();await page.keyboard.press('Escape');await expect(expand).toHaveAttribute('aria-expanded','false');await expect(expand).toBeFocused();
        await handle.press('End');expect((await graph.boundingBox()).width).toBeGreaterThanOrEqual(449);
        await page.evaluate(()=>{document.documentElement.style.zoom='';localStorage.setItem('bitbi:canvas-agent-width:v1','not-a-number');});
        await page.reload();await page.locator('#canvasAgentToggle').click();await expect.poll(width).toBe(390);
        await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw new DOMException('Storage unavailable','SecurityError');};});
        await handle.focus();await handle.press('ArrowLeft');await expect.poll(width).toBe(406);
    }
    expect(writes()).toHaveLength(beforeWrites);expect(state.chatPosts).toHaveLength(0);expect(state.posts).toHaveLength(0);expect(state.controls).toHaveLength(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);expect(errors).toEqual([]);
    await panel.screenshot({path:info.outputPath(`canvas-ai-workspace-${locale}-${scenario}.png`)});
};
