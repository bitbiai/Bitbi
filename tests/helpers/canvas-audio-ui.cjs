const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const {SqliteD1Database,applyAuthMigrations}=require('./sqlite-d1.js');
const {createAuthTestEnv}=require('./auth-worker-harness.js');
exports.audioUi=async({page,expect,locale,browserName,mockSharedAuth,createCanvasApiMock,info})=>{
  const {canvasAudioFixture}=await import('./canvas-audio-control.mjs');
  const {processCanvasExports}=await import('../../services/homepage-ffmpeg-processor/canvas-full-video.mjs');
  const DB=new SqliteD1Database();applyAuthMigrations(DB);
  const media=name=>fs.readFileSync(path.join(__dirname,'../fixtures/media',name)).toString('base64');
  const fixtureDir=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-audio-ui-')),importFile=path.join(fixtureDir,'import.mp4');
  const command=args=>{const result=spawnSync('ffmpeg',['-v','error','-nostdin',...args],{maxBuffer:40_000_000});expect(result.status,String(result.stderr)).toBe(0);return result.stdout;};
  command(['-i',path.join(__dirname,'../fixtures/media/canvas-preview.mp4'),'-vf','negate','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-c:a','copy',importFile]);
  const f=await canvasAudioFixture({...createAuthTestEnv(),DB},{videoBase64:media('canvas-preview.mp4'),importVideoBase64:fs.readFileSync(importFile).toString('base64'),musicBase64:media('member-music.mp3'),imageBase64:media('h3-frame.png')});
  const de=locale==='de',errors=[],consoleErrors=[],exports=[];let rendering=Promise.resolve();
  await page.setViewportSize({width:de?390:1440,height:900});await mockSharedAuth(page);createCanvasApiMock(page);
  await page.addInitScript(()=>{
    window.canvasAudioMeters=[];
    const connect=AudioNode.prototype.connect,create=AudioContext.prototype.createMediaElementSource,outputs=new WeakMap();
    AudioNode.prototype.connect=function(target,...args){
      if(target===this.context.destination){let meter=outputs.get(this.context);if(!meter){meter=this.context.createAnalyser();meter.fftSize=8192;outputs.set(this.context,meter);connect.call(meter,target);window.canvasAudioMeters.push({context:this.context,output:meter});}connect.call(this,meter,...args);return target;}
      return connect.call(this,target,...args);
    };
    const disconnect=AudioNode.prototype.disconnect;AudioNode.prototype.disconnect=function(...args){if(args[0]===this.context.destination)args[0]=outputs.get(this.context)||args[0];return disconnect.apply(this,args);};
    AudioContext.prototype.createMediaElementSource=function(video){const source=create.call(this,video),input=this.createAnalyser();input.fftSize=8192;const link=source.connect.bind(source);source.connect=(target,...args)=>{connect.call(source,input);return link(target,...args);};window.canvasAudioMeters.push({context:this,input,video});return source;};
  });
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',msg=>{if(msg.type()==='error')consoleErrors.push(msg.text());});
  const processor=async()=>processCanvasExports({baseUrl:'https://bitbi.ai',limit:1,authHeaders:headers=>({Authorization:'Bearer synthetic-audio-processor',...headers}),
    requestJson:async(url,init={})=>{const response=await f.request(url,init.method||'GET',init.body,{Authorization:'Bearer synthetic-audio-processor',...init.headers});const body=await response.json();expect(response.ok,JSON.stringify(body)).toBe(true);return body;},
    fetchImpl:(url,init)=>f.request(url.pathname+url.search,'GET',null,init.headers)});
  await page.route(/\/api\/(account\/canvas\/|ai\/(generation-jobs\/|text-assets\/|images\/|audio\/))/,async route=>{
    const req=route.request(),url=new URL(req.url()),method=req.method();
    const response=await f.request(url.pathname+url.search,method,req.postData(),{
      ...(req.headers()['idempotency-key']?{'Idempotency-Key':req.headers()['idempotency-key']}:{}),...(req.headers().range?{Range:req.headers().range}:{})});
    const headers=Object.fromEntries(response.headers),status=response.status;
    if(url.pathname.endsWith('/full-video')&&method==='POST'&&req.postDataJSON()?.backgroundMusic){
      const body=await response.json();expect(response.ok,JSON.stringify(body)).toBe(true);exports.push(body.data.export);
      await route.fulfill({status,headers,body:JSON.stringify(body)});rendering=rendering.then(processor);return;
    }
    const bytes=Buffer.from(await response.arrayBuffer());
    if(url.searchParams.has('previewBase')&&headers['content-range'])expect(Number(headers['content-range'].split('/')[1])).toBeGreaterThan(10000);
    await route.fulfill({status,headers,body:bytes});
  });
  const open=async id=>{
    if(de&&await page.locator('#canvasInspectorToggle').getAttribute('aria-expanded')==='true')await page.locator('#canvasInspectorToggle').click();
    await page.locator(`[data-node-id="${id}"]`).press('Enter');
    if(de&&!(await page.locator('#canvasInspectorBody').isVisible()))await page.locator('#canvasInspectorToggle').click();
  };
  const inspector=page.locator('#canvasInspectorBody'),sound=inspector.locator('.canvas-sound');
  const expand=async()=>{const summary=sound.locator('summary');await summary.focus();await page.keyboard.press('Enter');await expect(sound).toHaveAttribute('open','');};
  const gain=()=>sound.getByRole('slider',{name:de?'Originalton: Lautstärke':'Original audio: Volume',exact:true});
  const originalOn=()=>sound.getByRole('checkbox',{name:de?'Originalton aktiv':'Original audio enabled',exact:true});
  const musicOn=()=>sound.getByRole('checkbox',{name:de?'Musik als Hintergrund hinzufügen':'Add music as background',exact:true});
  const nodeVideo=()=>inspector.locator('.canvas-output > video');
  const signal=()=>page.evaluate(()=>{
    const source=window.canvasAudioMeters.filter(x=>x.input&&x.context.state==='running').at(-1),dest=window.canvasAudioMeters.find(x=>x.context===source?.context&&x.output);
    if(!source||!dest)return {input:0,original:0,music:0};
    const amp=(meter,hz)=>{const pcm=new Float32Array(meter.fftSize);meter.getFloatTimeDomainData(pcm);let r=0,im=0,w=0;for(let i=0;i<pcm.length;i++){const a=.5-.5*Math.cos(2*Math.PI*i/(pcm.length-1));r+=pcm[i]*a*Math.cos(2*Math.PI*hz*i/source.context.sampleRate);im+=pcm[i]*a*Math.sin(2*Math.PI*hz*i/source.context.sampleRate);w+=a;}return 2*Math.hypot(r,im)/w;};
    return {input:amp(source.input,1000),original:amp(dest.output,1000),music:amp(dest.output,440),time:source.video.currentTime};
  });
  try {
    await page.goto(de?'/de/canvas/':'/canvas/');await open(f.first.id);
    await expect(inspector.locator('.canvas-asset-type')).toHaveText(de?'Video':'Video');
    await expect(sound).not.toHaveAttribute('open');await expect(originalOn()).toBeHidden();await expand();
    await gain().fill('30');await gain().dispatchEvent('input');
    await expect.poll(async()=>(await f.readProject()).nodes.find(n=>n.id===f.first.id).config.originalAudio?.gain).toBe(.3);
    await expect(sound.getByRole('spinbutton',{name:de?'Originalton: Lautstärke (%)':'Original audio: Volume (%)'})).toHaveValue('30');
    if(browserName==='webkit') {
      await nodeVideo().evaluate(v=>{void v.play().catch(error=>{if(error.name!=='AbortError')throw error;});});await expect.poll(async()=>(await signal()).input).toBeGreaterThan(.05);
      await expect.poll(async()=>{const a=await signal();return a.original/a.input;}).toBeGreaterThan(.24);
      expect((await signal()).original/(await signal()).input).toBeLessThan(.36);
      await originalOn().uncheck();await expect.poll(async()=>(await signal()).original).toBeLessThan(.005);
      await originalOn().check();await expect.poll(async()=>(await signal()).original).toBeGreaterThan(.02);
      await nodeVideo().evaluate(v=>v.pause());
    }
    await open(f.last.id);await expect(sound).not.toHaveAttribute('open');await expand();await expect(gain()).toHaveValue('100');
    await gain().fill('60');await gain().dispatchEvent('input');
    const fade=sound.getByRole('spinbutton',{name:de?'Originalton: Einblenden (Sekunden)':'Original audio: Fade in (seconds)',exact:true});
    await fade.fill('1.25');await nodeVideo().evaluate(v=>v.dispatchEvent(new Event('loadedmetadata')));
    await expect(fade).toHaveValue('1.25');await fade.press('Tab');await expect(sound.getByRole('slider',{name:de?'Originalton: Einblenden':'Original audio: Fade in',exact:true})).toHaveValue('1.25');
    await expect.poll(async()=>(await f.readProject()).nodes.find(n=>n.id===f.last.id).config.originalAudio?.fadeIn).toBe(1.25);
    await page.reload();await open(f.last.id);await expand();await expect(gain()).toHaveValue('60');await expect(fade).toHaveValue('1.25');
    const group=inspector.locator('.canvas-clip-sequence');await expect(group.locator('li')).toHaveCount(4);await expect(group.locator('li').nth(1)).toContainText('Imported first');await expect(group.locator('li').last()).toContainText('Imported last');
    expect(await page.locator('.canvas-node.is-contributor').count()).toBe(4);
    for(const name of [de?'Hintergrundmusik: Einblenden (Sekunden)':'Background music: Fade in (seconds)',de?'Hintergrundmusik: Ausblenden (Sekunden)':'Background music: Fade out (seconds)']){const field=sound.getByRole('spinbutton',{name,exact:true});await field.fill('2.5');await field.press('Tab');}
    for(const enabled of [false,true]) {
      await musicOn().setChecked(enabled);const musicGain=sound.getByRole('slider',{name:de?'Hintergrundmusik: Lautstärke':'Background music: Volume',exact:true});await musicGain.fill('50');await musicGain.dispatchEvent('input');
      const button=inspector.getByRole('button',{name:enabled?(de?'Gesamtes Video mit Hintergrundmusik erstellen':'Create full video with background music'):(exports.length?(de?'Gesamtes Video erneut erstellen':'Create full video again'):(de?'Gesamtes Video erstellen':'Create full video')),exact:true});
      await button.click();await expect.poll(()=>exports.length).toBe(enabled?2:1);await rendering;
      await inspector.getByRole('button',{name:de?'Status aktualisieren':'Refresh status',exact:true}).click();
      const result=inspector.locator('.canvas-full-video video');await expect(result).toHaveAttribute('src',`/api/ai/text-assets/${exports.at(-1).id}/file`);
      const file=path.join(fixtureDir,`export-${enabled}.mp4`);
      fs.writeFileSync(file,Buffer.from(await (await f.request(`/api/ai/text-assets/${exports.at(-1).id}/file`)).arrayBuffer()));
      const pixel=(file,time)=>[...command(['-ss',String(time),'-i',file,'-frames:v','1','-vf','crop=2:2:80:44','-f','rawvideo','-pix_fmt','rgb24','-'])];
      for(const [index,time] of [5,25,45,65].entries()){
        const actual=pixel(file,time),source=pixel(index%2?importFile:path.join(__dirname,'../fixtures/media/canvas-preview.mp4'),5);
        expect(Math.max(...actual.map((v,i)=>Math.abs(v-source[i])))).toBeLessThan(15);
      }
      const pcm=command(['-i',file,'-map','0:a:0','-ac','1','-ar','48000','-f','f32le','-']);
      const amplitude=(hz,time)=>{const offset=Math.round(time*48000),n=4800;let re=0,im=0,w=0;for(let i=0;i<n;i++){const a=.5-.5*Math.cos(2*Math.PI*i/(n-1)),v=pcm.readFloatLE((offset+i)*4);re+=a*v*Math.cos(2*Math.PI*hz*i/48000);im+=a*v*Math.sin(2*Math.PI*hz*i/48000);w+=a;}return 2*Math.hypot(re,im)/w;};
      const unity=amplitude(1000,5);expect(unity).toBeGreaterThan(.05);
      expect(amplitude(1000,25)/unity).toBeCloseTo(.3,1);expect(amplitude(1000,65)/unity).toBeCloseTo(.6,1);
      expect(amplitude(1000,60.2)/unity).toBeLessThan(.2);
      if(enabled){for(const time of [5,25,65])expect(amplitude(440,time)).toBeGreaterThan(.04);expect(amplitude(440,.1)/amplitude(440,5)).toBeLessThan(.12);}
      else expect(amplitude(440,25)).toBeLessThan(.002);
      // Fixture raster is 160×90 with SAR 9:16: WebKit exposes its 90×90
      // display size. The unchanged crop preserves that aspect ratio.
      if(browserName==='webkit'){await result.evaluate(v=>v.play());await expect.poll(()=>result.evaluate(v=>v.currentTime)).toBeGreaterThan(.3);expect(await result.evaluate(v=>[v.videoWidth,v.videoHeight])).toEqual([90,90]);await result.evaluate(v=>v.pause());}
      if(browserName==='webkit'&&!enabled){
        await sound.getByRole('button',{name:de?'Toneinstellungen vorhören':'Preview sound settings',exact:true}).click();
        await result.evaluate(v=>{v.currentTime=21;});
        await expect.poll(async()=>{const a=await signal();return a.original/a.input;}).toBeGreaterThan(.24);
        expect((await signal()).original/(await signal()).input).toBeLessThan(.36);
        await result.evaluate(v=>{v.currentTime=62;});
        await expect.poll(async()=>{const a=await signal();return a.original/a.input;}).toBeGreaterThan(.52);
        expect((await signal()).original/(await signal()).input).toBeLessThan(.68);
        await result.evaluate(v=>{v.currentTime=60;v.playbackRate=.1;});
        await expect.poll(async()=>{const a=await signal();return a.time>=60&&a.time<60.6&&a.original/a.input<.3;}).toBe(true);
        await result.evaluate(v=>{v.playbackRate=1;v.currentTime=65;});
        await originalOn().uncheck();await musicOn().check();
        await expect.poll(async()=>(await signal()).music).toBeGreaterThan(.035);
        await expect.poll(async()=>(await signal()).original).toBeLessThan(.005);
        await originalOn().check();await musicOn().uncheck();
        await sound.getByRole('button',{name:de?'Zurück zum erstellten Video':'Return to completed video',exact:true}).click();
        expect(exports).toHaveLength(1);
      }
      const saved=inspector.getByRole('button',{name:de?'Gesamtvideo in Assets speichern':'Save full video to Assets',exact:true});await saved.click();await expect(saved).toHaveCount(0);
      expect(exports.at(-1).recipe.videos[1]).toMatchObject({nodeId:f.first.id,assetId:f.asset.id,originalAudio:{gain:.3}});
      expect(exports.at(-1).recipe.videos[3]).toMatchObject({nodeId:f.last.id,assetId:f.asset.id,originalAudio:{gain:.6,fadeIn:1.25}});
      expect(exports.at(-1).recipe.videos.filter(c=>c.nodeId).every(c=>!c.runId)).toBe(true);
    }
    await page.screenshot({path:info.outputPath(`canvas-sound-controls-${locale}.png`)});
    if(browserName==='webkit'){
      await nodeVideo().evaluate(v=>{void v.play().catch(error=>{if(error.name!=='AbortError')throw error;});});
      await expect.poll(async()=>(await signal()).input).toBeGreaterThan(.05);
      await nodeVideo().evaluate(v=>{v.currentTime=5;});
      await expect.poll(async()=>(await signal()).music).toBeGreaterThan(.035);
      await originalOn().uncheck();await expect.poll(async()=>(await signal()).original).toBeLessThan(.005);
      expect((await signal()).music).toBeGreaterThan(.035);await nodeVideo().evaluate(v=>v.pause());await originalOn().check();
    }
    await open(f.first.id);
    await inspector.locator('input[type=file]').setInputFiles(path.join(__dirname,'../fixtures/media/h3-frame.png'));
    await expect(inspector.locator('.canvas-asset-type')).toHaveText(de?'Bild':'Image');await expect(sound).toHaveCount(0);
    await expect(inspector.locator('.canvas-output img')).toBeVisible();
    await page.reload();await open(f.first.id);await expect(inspector.locator('.canvas-asset-type')).toHaveText(de?'Bild':'Image');
    await inspector.locator('input[type=file]').setInputFiles(path.join(__dirname,'../fixtures/media/member-music.mp3'));
    await expect(inspector.locator('.canvas-asset-type')).toHaveText(de?'Musik':'Music');await expect(sound).toHaveCount(0);
    await expect(inspector.locator('.canvas-output audio')).toBeVisible();
    expect(f.calls).toHaveLength(0);expect(errors).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath(`canvas-audio-${locale}.png`)});
  } catch(error) {console.log(JSON.stringify(await page.evaluate(()=>({videos:[...document.querySelectorAll('video')].map(v=>({src:v.getAttribute('src'),time:v.currentTime,paused:v.paused,ready:v.readyState,error:v.error?.code,tracks:v.audioTracks?.length,decoded:v.webkitAudioDecodedByteCount})),contexts:window.canvasAudioMeters.map(m=>({state:m.context.state,input:!!m.input,output:!!m.output})),status:[...document.querySelectorAll('.canvas-sound [role=status]')].map(e=>e.textContent)}))));console.log(JSON.stringify({errors,consoleErrors}));throw error;} finally {await rendering;await page.unrouteAll({behavior:'wait'});DB.close();fs.rmSync(fixtureDir,{recursive:true,force:true});}
};
