const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {SqliteD1Database,applyAuthMigrations}=require('./sqlite-d1.js');
const {createAuthTestEnv}=require('./auth-worker-harness.js');
exports.smoothUi=async({page,expect,locale,mockSharedAuth,createCanvasApiMock,info,fitAudio=false})=>{
  const {seamFixture}=await import('../../services/homepage-ffmpeg-processor/canvas-seams.test.mjs');
  const {canvasAudioFixture}=await import('./canvas-audio-control.mjs');
  const {processCanvasExports}=await import('../../services/homepage-ffmpeg-processor/canvas-full-video.mjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-smooth-ui-'));
  const files=fitAudio?await (await import('../../services/homepage-ffmpeg-processor/canvas-audio-fit.test.mjs')).fitFixture(dir):await seamFixture(dir);
  const DB=new SqliteD1Database();applyAuthMigrations(DB);
  const media=name=>fs.readFileSync(path.join(__dirname,'../fixtures/media',name)).toString('base64');
  const f=await canvasAudioFixture({...createAuthTestEnv(),DB},{videoBase64:fs.readFileSync(files[0]).toString('base64'),importVideoBase64:fs.readFileSync(files[1]).toString('base64'),musicBase64:media('member-music.mp3'),imageBase64:media('h3-frame.png')});
  const de=locale==='de',writes=[],errors=[];let rendering=Promise.resolve();
  await page.setViewportSize({width:de?390:1440,height:900});await mockSharedAuth(page);createCanvasApiMock(page);
  page.on('pageerror',e=>errors.push(e.message));
  const processor=()=>processCanvasExports({baseUrl:'https://bitbi.ai',limit:1,authHeaders:headers=>({Authorization:'Bearer synthetic-audio-processor',...headers}),
    requestJson:async(url,init={})=>{const response=await f.request(url,init.method||'GET',init.body,{Authorization:'Bearer synthetic-audio-processor',...init.headers});const data=await response.json();expect(response.ok,JSON.stringify(data)).toBe(true);return data;},
    fetchImpl:(url,init)=>f.request(url.pathname+url.search,'GET',null,init.headers)});
  await page.route(/\/api\/(account\/canvas\/|ai\/(generation-jobs\/|text-assets\/|images\/|audio\/))/,async route=>{
    const req=route.request(),url=new URL(req.url()),body=req.postData();
    const response=await f.request(url.pathname+url.search,req.method(),body,{...(req.headers()['idempotency-key']?{'Idempotency-Key':req.headers()['idempotency-key']}:{}),...(req.headers().range?{Range:req.headers().range}:{})});
    const headers=Object.fromEntries(response.headers),bytes=Buffer.from(await response.arrayBuffer());
    await route.fulfill({status:response.status,headers,body:bytes});
    if(req.method()==='POST'&&url.pathname.endsWith('/full-video')&&req.postDataJSON()?.backgroundMusic){writes.push({body:req.postDataJSON(),result:JSON.parse(bytes)});rendering=rendering.then(processor);}
  });
  const open=async()=>{await page.locator(`[data-node-id="${f.last.id}"]`).press('Enter');if(de&&!await page.locator('#canvasInspectorBody').isVisible())await page.locator('#canvasInspectorToggle').click();};
  const inspector=page.locator('#canvasInspectorBody'),smooth=inspector.getByRole('checkbox',{name:de?'Sanft zusammenführen':'Smooth joins',exact:true});
  try {
    await page.goto(de?'/de/canvas/':'/canvas/');await open();await expect(smooth).not.toBeChecked();
    if(fitAudio)await expect(inspector).toContainText(de?'Originalton wird automatisch':'Original audio is automatically');
    await smooth.focus();await page.keyboard.press('Space');await expect(smooth).toBeChecked();
    await expect.poll(async()=>(await f.readProject()).nodes.find(n=>n.id===f.last.id).config.smoothJoins).toBe(true);
    expect(writes).toHaveLength(0);expect(f.calls).toHaveLength(0);
    await page.reload();await open();await expect(smooth).toBeChecked();
    const sequence=inspector.locator('.canvas-clip-sequence');
    await sequence.getByRole('radio',{name:de?'Clips und Reihenfolge auswählen':'Choose clips and order',exact:true}).check();
    await sequence.getByRole('combobox',{name:'Clip 1',exact:true}).selectOption(f.snapshot.nodes.find(n=>n.id===f.nodes[0]).output.runId);
    await expect(sequence.locator('li')).toHaveCount(2);
    await inspector.getByRole('button',{name:de?'Übergang vergleichen':'Compare join',exact:true}).click();
    await expect.poll(()=>writes.length).toBe(1);await rendering;
    expect(writes[0].body).toMatchObject({smoothJoins:true,preview:{seamIndex:0}});
    const preview=inspector.locator('.canvas-smooth-joins video');await expect(preview).toBeVisible();
    await expect(inspector.getByRole('status',{name:de?'Übergangsvorschau':'Join preview',exact:true})).toContainText(fitAudio?(de?'auf die Bilddauer gekürzt':'trimmed to picture duration'):(de?'1 von 1':'1 of 1'));
    await inspector.getByRole('button',{name:de?'Nachher':'After',exact:true}).click();
    await preview.scrollIntoViewIfNeeded();
    await preview.evaluate(v=>v.play());
    await expect.poll(()=>preview.evaluate(v=>({played:v.currentTime>.3,decoded:v.videoWidth>0,error:v.error?.code||0}))).toEqual({played:true,decoded:true,error:0});
    await preview.evaluate(v=>v.pause());
    const full=await f.data(await f.request(f.endpoint));expect(full.export).toBeNull();
    await inspector.getByRole('button',{name:de?'Übergang vergleichen':'Compare join',exact:true}).click();
    await expect.poll(()=>writes.length).toBe(2);await rendering;
    expect(writes[1].result.data.preview.id).toBe(writes[0].result.data.preview.id);
    if(fitAudio&&de){
      const sound=inspector.locator('.canvas-sound');await sound.locator('summary').click();
      await sound.getByRole('checkbox',{name:'Musik als Hintergrund hinzufügen',exact:true}).check();
      await smooth.uncheck();await sequence.getByRole('radio',{name:'Diese Kette zusammenfügen',exact:true}).check();await expect(sequence.locator('li')).toHaveCount(4);}
    await inspector.getByRole('button',{name:de?(fitAudio?'Gesamtes Video mit Hintergrundmusik erstellen':'Gesamtes Video erstellen'):'Create full video',exact:true}).click();
    await expect.poll(()=>writes.length).toBe(3);await rendering;
    const exported=writes[2].result.data.export;expect(exported.recipe.smoothJoins.enabled).toBe(!(fitAudio&&de));expect(exported.recipe.preview).toBeUndefined();
    await inspector.getByRole('button',{name:de?'Status aktualisieren':'Refresh status',exact:true}).click();
    if(fitAudio){expect(exported.recipe.originalAudioPolicy).toBe('fit-picture-v1');await expect(inspector).toContainText(de?'auf die Bilddauer gekürzt':'trimmed to picture duration');}
    const output=inspector.locator('.canvas-full-video > div:last-child > video');
    await expect(output).toHaveAttribute('src',`/api/ai/text-assets/${exported.id}/file`);
    await output.scrollIntoViewIfNeeded();
    await output.evaluate(v=>v.play());await expect.poll(()=>output.evaluate(v=>v.currentTime)).toBeGreaterThan(.3);await output.evaluate(v=>v.pause());
    const download=inspector.getByRole('link',{name:de?'Gesamtvideo herunterladen':'Download full video',exact:true});await expect(download).toHaveAttribute('href',`/api/ai/text-assets/${exported.id}/file?download=1`);
    await inspector.getByRole('button',{name:de?'Gesamtvideo in Assets speichern':'Save full video to Assets',exact:true}).click();
    await expect.poll(async()=>(await f.data(await f.request(f.endpoint))).current.storage).toBe('assets');
    if(fitAudio){
      const state=await f.data(await f.request(f.endpoint));expect(state.current.id).toBe(exported.id);
      const bytes=Buffer.from(await (await f.request(state.current.asset.file_url)).arrayBuffer());
      const downloaded=Buffer.from(await (await f.request(state.current.asset.file_url+'?download=1')).arrayBuffer());expect(downloaded.equals(bytes)).toBe(true);
      expect(state.current.audio_timeline.filter(c=>c.originalAudioFit.trimEnd>0)).toHaveLength(de?2:1);
    }
    const graph=await f.readProject();expect(graph.nodes.length).toBe(f.snapshot.nodes.length);expect(graph.edges.length).toBe(f.snapshot.edges.length);
    await inspector.locator('.canvas-smooth-joins').screenshot({path:info.outputPath(`smooth-joins-${locale}.png`)});
    await smooth.uncheck();await expect(preview).toHaveCount(0);expect(writes).toHaveLength(3);
    expect(errors).toEqual([]);expect(f.calls).toHaveLength(0);
    await info.attach('smooth-joins-real-worker-and-ffmpeg',{contentType:'application/json',body:JSON.stringify({provider:'synthetic',providerCalls:0,previewId:writes[0].result.data.preview.id,exportId:exported.id,mode:exported.recipe.smoothJoins,played:true,saved:true})});
  }finally{await rendering;await page.unrouteAll({behavior:'wait'});DB.close();fs.rmSync(dir,{recursive:true,force:true});}
};
