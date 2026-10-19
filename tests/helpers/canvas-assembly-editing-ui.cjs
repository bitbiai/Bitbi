const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const {openCanvasSettings}=require('./canvas-inspector-actions.cjs');

function ffmpeg(args){const result=spawnSync('ffmpeg',['-y','-v','error','-nostdin',...args],{maxBuffer:32e6});if(result.status!==0)throw Error(String(result.stderr));return result.stdout;}
function colorAt(file,time){const frame=ffmpeg(['-ss',String(time),'-i',file,'-frames:v','1','-vf','scale=1:1','-pix_fmt','rgb24','-f','rawvideo','-']);return [...frame.subarray(0,3)];}
// Decode before seeking: MP3 input-side seeking can synthesize decoder preroll
// silence and understate the reference amplitude in this bounded sample.
function toneAt(file,time,hz){const pcm=ffmpeg(['-i',file,'-ss',String(time),'-t','0.4','-vn','-ar','48000','-ac','1','-f','f32le','-']);let re=0,im=0;const n=pcm.length/4;for(let i=0;i<n;i++){const value=pcm.readFloatLE(i*4);re+=value*Math.cos(2*Math.PI*hz*i/48000);im+=value*Math.sin(2*Math.PI*hz*i/48000);}return 2*Math.hypot(re,im)/n;}
const blue=rgb=>rgb[2]>180&&rgb[0]<40&&rgb[1]<40;
const yellow=rgb=>rgb[0]>180&&rgb[1]>180&&rgb[2]<40;

module.exports=async({page,expect,locale,info,mockSharedAuth,createCanvasApiMock})=>{
    const {SqliteD1Database,applyAuthMigrations}=require('./sqlite-d1.js'),{createAuthTestEnv}=require('./auth-worker-harness.js');
    const {canvasAudioFixture}=await import('./canvas-audio-control.mjs');
    const {processCanvasExports,inspectClip}=await import('../../services/homepage-ffmpeg-processor/canvas-full-video.mjs');
    const {processCanvasInspections}=await import('../../services/homepage-ffmpeg-processor/canvas-media-inspection.mjs');
    const {getModelTariff}=await import('../../workers/auth/src/lib/model-tariffs.js');
    const {finishCanvasAgentFixture}=await import('./canvas-agent-control.mjs');
    const {attachCanvasConversation}=await import('./canvas-agent-conversation-control.mjs');
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-editable-film-')),DB=new SqliteD1Database();applyAuthMigrations(DB);
    const files={};
    for(const [color,hz] of [['red',440],['blue',880],['yellow',660]]){
        files[color]=path.join(dir,color+'.mp4');
        ffmpeg(['-f','lavfi','-i',`color=c=${color}:size=320x180:rate=24:duration=4`,'-f','lavfi','-i',`sine=frequency=${hz}:sample_rate=48000:duration=4`,'-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-c:a','aac',files[color]]);
    }
    const music=path.join(dir,'music.mp3');ffmpeg(['-f','lavfi','-i','sine=frequency=1000:sample_rate=48000:duration=2','-c:a','libmp3lame',music]);
    const media=name=>fs.readFileSync(path.join(__dirname,'../fixtures/media',name)).toString('base64');
    const f=await canvasAudioFixture({...createAuthTestEnv(),DB},{scope:'assembly-browser-'+locale,videoBase64:fs.readFileSync(files.red).toString('base64'),importVideoBase64:fs.readFileSync(files.blue).toString('base64'),musicBase64:fs.readFileSync(music).toString('base64'),imageBase64:media('h3-frame.png')});
    const endpoint=f.endpoint,de=locale==='de',requests=[],errors=[];let rendering=Promise.resolve(),disconnectExportRead=false,disconnectedReads=0;
    const processorOptions={baseUrl:'https://bitbi.ai',limit:1,authHeaders:headers=>({Authorization:'Bearer synthetic-audio-processor',...headers}),
        requestJson:async(url,init={})=>{const response=await f.request(url,init.method||'GET',init.body,{Authorization:'Bearer synthetic-audio-processor',...init.headers});const payload=await response.json();expect(response.ok,JSON.stringify(payload)).toBe(true);return payload;},fetchImpl:(url,init)=>f.request(url.pathname+url.search,'GET',null,init.headers)};
    const processor=async()=>{await processCanvasInspections(processorOptions);await processCanvasExports(processorOptions);};
    const conversation=await attachCanvasConversation(f,{scope:'editable-film-'+locale,locale});
    await conversation.approve(3000);
    let brief=await conversation.exchange('Create a warm film about builders finishing a house beside a pool with ducks, then welcoming visitors.',{
        text:'We can follow the house construction through to the celebration.',fields:{story:'Builders finish the same house beside its duck pool and welcome visitors.',style:'warm realistic film'}});
    expect(brief.brief.duration.asked).toBe(true);expect(brief.brief.duration.choice).toBeNull();
    brief=await conversation.exchange(locale==='de'?'Der Film soll 16 Sekunden dauern.':'The film should be 16 seconds long.',{
        text:locale==='de'?'Die Projektidee ist für ungefähr 16 Sekunden bereit.':'The project brief is ready for about 16 seconds.',intent:'ready'});
    expect(brief.brief.duration.targetDurationSeconds).toBe(16);
    const immediate=await conversation.data(await conversation.post('/immediate',{text:locale==='de'?'Mach mir den Film jetzt, keine weiteren Fragen.':'Make my film now, no more questions.',locale,delegateCreative:true,
        expectedConversationRevision:brief.revision,expectedBriefRevision:brief.briefRevision,expectedRevision:(await f.readProject()).project.revision}));
    const intent=immediate.conversation.immediateIntent;
    expect(intent.state).toBe('approval_required');expect(intent.quote.scope.targetDurationSeconds).toBe(16);
    const admitted=await conversation.data(await conversation.post('/immediate/approve',{intentId:intent.id,intentRevision:intent.revision,
        capCredits:intent.quote.proposedCapCredits,authorized:true,expectedRevision:intent.expectedRevision,expectedBriefRevision:intent.expectedBriefRevision}));
    expect(admitted.conversation.immediateIntent.state).toBe('started');
    expect(conversation.calls).toHaveLength(2);conversation.restore();
    const production=await finishCanvasAgentFixture({f,processor,targetSeconds:16,order:f.order,generate:true,admittedRunId:admitted.run.id,budgetCredits:intent.quote.proposedCapCredits});
    const initialProject=await f.readProject(),original=production.output;
    const providerBaseline=f.calls.length;expect(providerBaseline).toBe(1);
    expect(production.evaluationCalls).toBe(1);
    expect(original.storage).toBe('assets');expect(original.duration).toBe(16);expect(original.recipe.videos).toHaveLength(4);
    const originalBytes=Buffer.from(await(await f.request(original.asset.file_url)).arrayBuffer());
    const originalFile=path.join(dir,'original.mp4');fs.writeFileSync(originalFile,originalBytes);
    // The one intentional rerun returns visibly different synthetic pixels.
    const fetchBefore=f.env.__TEST_FETCH;
    f.env.__TEST_FETCH=(url,init)=>url==='https://fixture.invalid/completion.mp4'?Promise.resolve(new Response(fs.readFileSync(files.yellow),{headers:{'Content-Type':'video/mp4'}})):fetchBefore(url,init);
    await page.setViewportSize({width:de?390:1440,height:1000});await mockSharedAuth(page);createCanvasApiMock(page);page.on('pageerror',error=>errors.push(error.message));
    await page.route(/\/api\/(account\/canvas\/|ai\/(generation-jobs\/|text-assets\/|images\/|audio\/)|model-pricing)/,async route=>{
        const req=route.request(),url=new URL(req.url()),body=req.postData();requests.push({path:url.pathname,method:req.method(),body:body?JSON.parse(body):null});
        if(disconnectExportRead&&req.method()==='GET'&&url.pathname.endsWith('/full-video')&&!url.searchParams.has('seamPreview')&&!url.searchParams.has('previewBase')){
            disconnectExportRead=false;disconnectedReads++;return route.abort('internetdisconnected');
        }
        const response=await f.request(url.pathname+url.search,req.method(),body,{...(req.headers()['idempotency-key']?{'Idempotency-Key':req.headers()['idempotency-key']}:{}),'X-Bitbi-Tariff-Revision':String((await getModelTariff(f.env)).revision),...(req.headers().range?{Range:req.headers().range}:{})});
        const bytes=Buffer.from(await response.arrayBuffer());await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:bytes});
        if(req.method()==='POST'&&url.pathname.endsWith('/run')){const payload=JSON.parse(bytes);if(payload.code==='canvas_video_pending')rendering=rendering.then(()=>f.deliver());}
        if(req.method()==='POST'&&url.pathname.endsWith('/full-video')&&req.postDataJSON()?.assemblyRevision!==undefined)rendering=rendering.then(processor);
    });
    const inspector=page.locator('#canvasInspectorBody'),editor=inspector.locator('.canvas-assembly');
    const select=async id=>{if(de&&await page.locator('#canvasGraphToggle').getAttribute('aria-pressed')!=='true')await page.locator('#canvasGraphToggle').click();await page.locator(`[data-node-id="${id}"]`).press('Enter');if(de)await page.locator('#canvasInspectorToggle').click();};
    const open=async()=>{await select(f.last.id);await openCanvasSettings(page,'merge');await expect(editor).toBeVisible();};
    try{
        await page.goto(de?'/de/canvas/':'/canvas/');
        // Reopen a loaded project, not a document whose bootstrap requests are
        // still in flight (WebKit reports those navigation aborts as CORS errors).
        await expect(page.locator(`[data-node-id="${f.last.id}"]`)).toBeVisible();
        await expect(page.locator('#canvasCredits')).toContainText('500');
        await page.reload();await open();
        await expect(editor.locator('ol > li')).toHaveCount(4);
        const oldIdentity=inspector.getByLabel(de?'Angezeigter Export':'Displayed export',{exact:true});
        await expect(oldIdentity).toHaveAttribute('data-export-id',original.id);
        const targetMode=editor.getByRole('combobox',{name:de?'Umgang mit der Zieldauer':'Target duration mode',exact:true});
        await targetMode.selectOption('exact');
        await expect.poll(async()=>(await f.readProject()).project.assembly.target).toEqual({seconds:16,toleranceSeconds:.5});
        await targetMode.selectOption('creative');
        await expect.poll(async()=>(await f.readProject()).project.assembly.target).toEqual({seconds:16,mode:'creative'});
        await page.reload();await open();await expect(targetMode).toHaveValue('creative');
        await expect(oldIdentity).toHaveAttribute('data-export-id',original.id);
        expect(f.calls).toHaveLength(providerBaseline);
        await select(f.nodes[0]);await openCanvasSettings(page,'generation');
        const freshness=inspector.getByRole('status',{name:de?'Stand der Generierung':'Generation freshness',exact:true,includeHidden:true});
        await expect(freshness).toHaveAttribute('data-state','unchanged');
        await inspector.getByRole('textbox',{name:de?'Titel':'Title',exact:true}).fill('Retained source, renamed only');
        await expect(freshness).toHaveAttribute('data-state','unchanged');
        const shotDuration=inspector.getByRole('spinbutton',{name:de?'Dauer (Sek.)':'Duration (seconds)',exact:true});
        const previousDuration=await shotDuration.inputValue();await shotDuration.fill('5');
        await expect(freshness).toHaveAttribute('data-state','changed');
        await shotDuration.fill(previousDuration);await expect(freshness).toHaveAttribute('data-state','unchanged');
        const prompt=inspector.getByLabel('Prompt',{exact:true});
        await expect(prompt).toHaveValue(initialProject.nodes.find(node=>node.id===f.nodes[0]).config.prompt);
        await prompt.fill('');
        await expect(inspector.getByRole('button',{name:de?'Ausführen':'Run',exact:true})).toBeDisabled();
        await expect(freshness).toHaveAttribute('data-state','changed');
        await prompt.fill('A yellow house in sunshine; intentional revised shot.');
        await expect(freshness).toHaveAttribute('data-state','changed');
        await expect.poll(async()=>(await f.readProject()).nodes.find(node=>node.id===f.nodes[0]).config.prompt).toContain('yellow house');
        expect(f.calls).toHaveLength(providerBaseline);
        await inspector.getByRole('button',{name:de?'Ausführen':'Run',exact:true}).click();
        await expect.poll(()=>f.calls.length).toBe(providerBaseline+1);await rendering;
        await expect.poll(async()=>(await f.readProject()).nodes.find(node=>node.id===f.nodes[0]).output.assetId).not.toBe(initialProject.nodes.find(node=>node.id===f.nodes[0]).output.assetId);
        await page.reload();await open();
        await expect(oldIdentity).toContainText(de?'Vorherige fertige Version':'Previous completed version');
        await editor.getByRole('button',{name:de?'Entfernen: Clip 3':'Remove: Clip 3',exact:true}).click();
        await expect.poll(async()=>(await f.readProject()).project.assembly.clips.length).toBe(3);
        await select(f.nodes[1]);
        if(de)await page.locator('#canvasGraphToggle').click();
        page.once('dialog',dialog=>dialog.accept());await page.locator('#canvasDeleteSelection').click();
        await expect.poll(async()=>(await f.readProject()).nodes.some(node=>node.id===f.nodes[1])).toBe(false);
        await expect(page.locator(`[data-node-id="${f.nodes[1]}"]`)).toHaveCount(0);
        await open();
        // Playback order must not select a different export identity. Move the
        // original export anchor into the middle, reopen, then keep editing.
        await editor.getByRole('button',{name:de?'Nach oben: Clip 3':'Move up: Clip 3',exact:true}).click();
        await expect.poll(async()=>(await f.readProject()).project.assembly.clips.map(clip=>clip.nodeId)).toEqual([f.nodes[0],f.last.id,f.first.id]);
        await page.reload();await open();
        await expect(oldIdentity).toHaveAttribute('data-export-id',original.id);
        expect((await f.readProject()).project.assembly.anchorNodeId).toBe(f.last.id);
        await editor.getByRole('button',{name:de?'Nach unten: Clip 2':'Move down: Clip 2',exact:true}).click();
        await expect.poll(async()=>(await f.readProject()).project.assembly.clips.map(clip=>clip.nodeId)).toEqual([f.nodes[0],f.first.id,f.last.id]);
        await editor.getByRole('button',{name:de?'Nach oben: Clip 2':'Move up: Clip 2',exact:true}).click();
        await expect.poll(async()=>(await f.readProject()).project.assembly.clips.map(clip=>clip.nodeId)).toEqual([f.first.id,f.nodes[0],f.last.id]);
        const first=editor.locator('ol > li').first();
        await first.getByRole('combobox',{name:de?'Übergang zum nächsten Clip':'Transition to next clip',exact:true}).selectOption('fade');
        await first.getByRole('spinbutton',{name:de?'Überlappung (s)':'Overlap (s)',exact:true}).fill('0.5');await first.getByRole('spinbutton',{name:de?'Überlappung (s)':'Overlap (s)',exact:true}).blur();
        await editor.getByRole('spinbutton',{name:de?'Zieldauer (Sekunden, optional)':'Target duration (seconds, optional)',exact:true}).fill('11.5');await editor.getByRole('spinbutton',{name:de?'Zieldauer (Sekunden, optional)':'Target duration (seconds, optional)',exact:true}).blur();
        const sound=inspector.locator('.canvas-sound');if(!(await sound.evaluate(node=>node.open)))await sound.locator('summary').click();
        await sound.getByRole('checkbox',{name:de?'Musik als Hintergrund hinzufügen':'Add music as background',exact:true}).check();
        const gain=sound.getByRole('slider',{name:de?'Hintergrundmusik: Lautstärke':'Background music: Volume',exact:true});await gain.fill('25');await gain.dispatchEvent('input');
        await expect.poll(async()=>(await f.readProject()).project.assembly.backgroundMusic?.gain).toBe(.25);
        expect(f.calls).toHaveLength(providerBaseline+1);
        disconnectExportRead=true;
        await inspector.getByRole('button',{name:de?'Gesamtes Video mit Hintergrundmusik erstellen':'Create full video with background music',exact:true}).click();
        await expect.poll(()=>requests.filter(request=>request.method==='POST'&&request.path.endsWith('/full-video')).length).toBe(1);await rendering;
        const current=(await f.data(await f.request(endpoint))).current;
        expect(current.id).not.toBe(original.id);expect(current.storage).toBe('assets');expect(current.duration).toBe(11.5);
        const revisedRun=(await f.readProject()).nodes.find(node=>node.id===f.nodes[0]).output.runId;
        expect(current.recipe.videos.map(clip=>clip.runId||clip.nodeId)).toEqual([f.first.id,revisedRun,f.last.id]);
        expect(current.recipe.assembly.clips.map(clip=>clip.nodeId)).toEqual([f.first.id,f.nodes[0],f.last.id]);
        expect(current.recipe.transitions.map(transition=>transition.preset)).toEqual(['fade','none']);
        expect(current.recipe.backgroundMusic).toMatchObject({enabled:true,gain:.25});
        const rendered=path.join(dir,'edited.mp4');fs.writeFileSync(rendered,Buffer.from(await(await f.request(current.asset.file_url)).arrayBuffer()));
        expect((await inspectClip(rendered)).video.width).toBe(320);
        expect(blue(colorAt(files.blue,1))).toBe(true);expect(blue(colorAt(files.red,1))).toBe(false);
        expect(yellow(colorAt(files.yellow,1))).toBe(true);expect(yellow(colorAt(files.red,1))).toBe(false);
        expect(blue(colorAt(rendered,1))).toBe(true);expect(yellow(colorAt(rendered,5))).toBe(true);expect(blue(colorAt(rendered,9))).toBe(true);
        expect(colorAt(rendered,3.75).every(value=>value>80&&value<180)).toBe(true);
        const sourceTone=toneAt(music,.5,1000),originalTone=toneAt(originalFile,.5,1000),mixedTone=toneAt(rendered,.5,1000);
        expect(sourceTone).toBeGreaterThan(.1);expect(originalTone).toBeLessThan(sourceTone*.01);
        expect(mixedTone/sourceTone).toBeGreaterThan(.22);expect(mixedTone/sourceTone).toBeLessThan(.28);
        expect(Buffer.from(await(await f.request(original.asset.file_url)).arrayBuffer()).equals(originalBytes)).toBe(true);
        // Actual Worker admission, processor completion and saved bytes must
        // arrive automatically after a dropped observation, without a new POST.
        const video=inspector.locator('.canvas-full-video > div:last-child > video');await expect(video).toHaveAttribute('src',current.asset.file_url,{timeout:20000});
        expect(disconnectedReads).toBe(1);expect(requests.filter(request=>request.method==='POST'&&request.path.endsWith('/full-video'))).toHaveLength(1);
        await video.evaluate(async node=>{node.muted=true;await node.play();});await expect.poll(()=>video.evaluate(node=>node.currentTime)).toBeGreaterThan(.1);await video.evaluate(node=>node.pause());
        await page.reload();await open();await expect(editor.locator('ol > li')).toHaveCount(3);
        const final=await f.readProject();expect(final.project.assembly.clips.map(clip=>clip.nodeId)).toEqual([f.first.id,f.nodes[0],f.last.id]);expect(final.project.assembly.backgroundMusic.gain).toBe(.25);
        expect(f.calls).toHaveLength(providerBaseline+1);expect(requests.filter(request=>request.path.includes('/agent'))).toEqual([]);expect(errors).toEqual([]);
        await info.attach('editable-production-real-media',{contentType:'application/json',body:JSON.stringify({initialProduction:'persisted conversation, duration clarification, immediate-start intent, explicit quoted cap, existing queue/planner/generation/frame-extraction/export with owned references',provider:'synthetic',conversationTurns:conversation.calls.length,briefRevision:brief.briefRevision,agentRun:production.runId,plannerCalls:production.plannerCalls,evaluationCalls:production.evaluationCalls,agentGenerations:providerBaseline,manualGenerations:1,original:original.id,revised:current.id,duration:current.duration,order:current.recipe.assembly.clips.map(clip=>clip.nodeId),originalPreserved:true,played:true,saved:true})});
        // Only after proving the entire revision works without the assistant,
        // ask it to locate the current manually exported film. The historical
        // agent result remains immutable and must not become this navigation's
        // stale source of truth.
        const followup=await attachCanvasConversation(f,{scope:'edited-film-result-'+locale,locale});
        try{
            await followup.approve(3000);await select(f.nodes[0]);
            await page.locator('#canvasAgentToggle').click();
            const panel=page.locator('#canvasAgentPanel'),composer=panel.locator('.canvas-agent__composer');
            await composer.locator('textarea').fill(de?'Zeig mir bitte das fertige Video dieses aktuell bearbeiteten Projekts.':'Please show the finished video of this currently edited project.');
            const acknowledged=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/conversation/messages')&&response.request().method()==='POST');
            await composer.locator('button[type=submit]').click();expect((await acknowledged).status()).toBe(202);
            await followup.deliver();
            await followup.complete({text:de?'Ich öffne den aktuellen Export.':'I will open the current export.',actions:[{type:'show_result',targetId:null,value:null,number:null,secondaryNumber:null,ids:[],revision:(await f.readProject()).project.revision}]});
            await followup.deliver();
            await expect(panel).toBeHidden({timeout:12000});
            await expect(oldIdentity).toHaveAttribute('data-export-id',current.id);
            await expect(inspector.locator('.canvas-full-video > div:last-child > video')).toHaveAttribute('src',current.asset.file_url);
            expect(followup.calls).toHaveLength(1);expect(f.calls).toHaveLength(providerBaseline+1);
            expect(Buffer.from(await(await f.request(original.asset.file_url)).arrayBuffer()).equals(originalBytes)).toBe(true);
        }finally{followup.restore();}
    }finally{await rendering;await page.unrouteAll({behavior:'wait'});DB.close();fs.rmSync(dir,{recursive:true,force:true});}
};
