// Real Canvas caller and native decoded Web Audio; only API/owned-media fixtures.
// Register in the owning spec: Playwright reports the test() declaration as
// spec.file, which discovery and candidate evidence use as their identity.
function measureDecodedSignal(samples,sampleRate) {
  // Hann weighting rejects leakage from the loud 1 kHz signal into 440 Hz.
  const magnitude=hz=>{let r=0,i=0,weight=0;for(let n=0;n<samples.length;n++){const w=.5-.5*Math.cos(2*Math.PI*n/(samples.length-1));weight+=w;r+=w*samples[n]*Math.cos(2*Math.PI*hz*n/sampleRate);i+=w*samples[n]*Math.sin(2*Math.PI*hz*n/sampleRate);}return 2*Math.hypot(r,i)/weight;};
  return {original:magnitude(1000),music:magnitude(440),peak:Math.max(...samples.map(Math.abs))};
}
function preservesOriginalSignal({original,sourceOriginal}) {
  // Compare with this video's decoded input, not an assumed decoder amplitude.
  // The source floor independently rejects silence/underflow; the tighter unity
  // bound rejects an original that the mixer drops or attenuates.
  return Number.isFinite(original)&&sourceOriginal>.05&&Math.abs(original/sourceOriginal-1)<.05;
}
module.exports=({expect,mockSharedAuth,createCanvasApiMock},locale)=>async({page,browserName},info)=>{
  await page.setViewportSize({width:locale==='de'?390:1440,height:900});await mockSharedAuth(page);
  await page.addInitScript({content:`window.__canvasAudioMeter=(${measureDecodedSignal});`});
  await page.addInitScript(()=>{
    const Native=window.AudioWorkletNode;window.auditionContexts=[];window.auditionTrace=[];window.auditionSources=[];window.auditionLifecycle=[];
    // Observe the signal actually routed to the audio destination. A parallel
    // worklet tap would still report audio if the speaker route were missing.
    const outputs=new WeakMap(),connect=AudioNode.prototype.connect,disconnect=AudioNode.prototype.disconnect;
    const destinationMeter=context=>{
      if(!outputs.has(context)){
        const meter=context.createAnalyser();meter.fftSize=8192;meter.smoothingTimeConstant=0;
        connect.call(meter,context.destination);outputs.set(context,meter);
      }
      return outputs.get(context);
    };
    AudioNode.prototype.connect=function(target,...args){
      if(target===this.context.destination){connect.call(this,destinationMeter(this.context),...args);return target;}
      return connect.call(this,target,...args);
    };
    AudioNode.prototype.disconnect=function(...args){
      if(args[0]===this.context.destination)args[0]=destinationMeter(this.context);
      return disconnect.apply(this,args);
    };
    for(const type of ['click','play','pause','error','loadedmetadata','emptied']) document.addEventListener(type,event=>{
      const target=event.target,block=target.closest?.('.canvas-full-video');if(!block)return;
      window.auditionLifecycle.push({type,at:performance.now(),tag:target.tagName,text:target.tagName==='BUTTON'?target.textContent:null,
        status:block.querySelector('[aria-label="Music preview"],[aria-label="Musikvorschau"]')?.textContent,
        source:target.currentSrc,error:target.error?.code});
    },true);
    const Audio=window.AudioContext||window.webkitAudioContext,create=Audio.prototype.createMediaElementSource;
    Audio.prototype.createMediaElementSource=function(video){const source=create.call(this,video),connect=source.connect.bind(source),meter=this.createAnalyser();meter.fftSize=8192;source.connect=(target,...args)=>{connect(meter);return connect(target,...args);};window.auditionSources.push({context:this,meter});return source;};
    window.AudioWorkletNode=class extends Native {constructor(context,...args){super(context,...args);const meter=destinationMeter(context);const send=this.port.postMessage.bind(this.port);this.port.postMessage=(data,...rest)=>{window.auditionTrace.push({...data,channels:data.channels?.map(c=>c.length)});return send(data,...rest);};window.auditionContexts.push({context,meter,node:this});}};
  });
  const state=createCanvasApiMock(page),pid='1'.repeat(32),nid='2'.repeat(32),rid='3'.repeat(32),mid='4'.repeat(32),second='5'.repeat(32),now=new Date().toISOString();
  // Existing changing-video imagery, 20 s at 160x90; native H264/AAC and VP8/Opus
  // fixtures add a 1 kHz original. Existing MP3 is 440 Hz; loud WAV is stereo
  // 0.99*sin(2*pi*1000*t), 48 kHz / 1 s. No provider or production media.
  const media=`/api/plain/canvas-preview/video.${browserName==='chromium'?'webm':'mp4'}`;
  const output={kind:'video',runId:rid,assetId:'original',previewUrl:'/tests/fixtures/media/member-video-poster.webp',asset:{id:'original',file_url:media}};
  state.projects=[{id:pid,title:'Audition',locale,created_at:now,updated_at:now}];
  state.nodes=[{id:nid,project_id:pid,type:'video_generation',model_id:'minimax/h3',title:'Video',x:100,y:100,config:{backgroundMusic:{enabled:true,gain:1,musicAssetId:mid}},content:{},output,asset_id:'original',created_at:now,updated_at:now},
    ...[[mid,'Music','/api/plain/music/mp3/file'],[second,'Loud','/api/plain/canvas-preview/loud.wav']].map(([id,title,url])=>({id,project_id:pid,type:'music_generation',title,x:100,y:400,config:{},content:{},output:{kind:'audio',asset:{id,asset_type:'music',mime_type:'audio/wav',file_url:url}},created_at:now,updated_at:now}))];
  state.edges=[mid,second].map((id,i)=>({id:String(i+6).repeat(32),project_id:pid,source_node_id:id,target_node_id:nid,config:{purpose:'export_background_music'},created_at:now}));
  state.runs=[{id:rid,node_id:nid,status:'completed',output,asset_id:'original',created_at:now}];
  let completed={id:'a'.repeat(32),status:'ready',storage:'canvas',asset:{id:'a'.repeat(32),file_url:media+'?completed=1'},preview_base:{export_id:'a'.repeat(32),file_url:media}};
  const writes=[];page.on('request',r=>{if(r.method()==='POST')writes.push({url:new URL(r.url()).pathname,body:r.postDataJSON()});});
  await page.route('**/full-video',route=>route.fulfill({json:{ok:true,data:{eligible:true,export:completed,current:completed}}}));
  const open=async()=>{await page.goto(locale==='de'?'/de/canvas/':'/canvas/');await page.locator(`[data-node-id="${nid}"]`).press('Enter');if(locale==='de')await page.locator('#canvasInspectorToggle').click();};
  await open();const block=page.locator('.canvas-full-video'),video=block.locator('video'),slider=block.getByRole('slider');
  const start=()=>block.getByRole('button',{name:locale==='de'?'Vorschau mit Musik':'Preview with music',exact:true});
  const pause=()=>block.getByRole('button',{name:locale==='de'?'Vorschau pausieren':'Pause preview',exact:true});
  const meter=(original=false,calibration=null)=>page.evaluate(({original,calibration})=>{
    const {context,meter}=(original?window.auditionSources:window.auditionContexts).at(-1),samples=new Float32Array(meter.fftSize);meter.getFloatTimeDomainData(samples);
    if(calibration!==null)for(let n=0;n<samples.length;n++)samples[n]=Math.max(-.95,Math.min(.95,1.11*Math.sin(2*Math.PI*1000*n/context.sampleRate)))+calibration*Math.sin(2*Math.PI*440*n/context.sampleRate);
    const reading=window.__canvasAudioMeter(samples,context.sampleRate);
    if(!original && calibration===null) {
      const input=window.auditionSources.at(-1),sourceSamples=new Float32Array(input.meter.fftSize);
      if(input.context!==context)throw new Error('Foreign original-audio context');
      input.meter.getFloatTimeDomainData(sourceSamples);
      reading.sourceOriginal=window.__canvasAudioMeter(sourceSamples,context.sampleRate).original;
    }
    return reading;
  },{original,calibration});
  await expect(start()).toBeEnabled();await start().focus();await page.keyboard.press('Enter');await expect(pause()).toBeVisible();
  await expect(block.getByRole('status',{name:locale==='de'?'Musikvorschau':'Music preview',exact:true})).toHaveText(locale==='de'?'Vorschau · noch nicht übernommen':'Preview · not exported');
  await expect(pause()).toBeFocused();
  await block.screenshot({path:info.outputPath(`canvas-audition-${locale}.png`)});
  await expect.poll(()=>video.evaluate(v=>v.currentTime)).toBeGreaterThan(.3);
  expect(await video.evaluate(v=>v.videoWidth)).toBeGreaterThan(0);
  await expect(video).toHaveJSProperty('volume',1);
  // WebKit/GStreamer mutes the native sink when Web Audio takes ownership;
  // the actual destination signal below, not HTMLMediaElement.muted, owns sound.
  await expect.poll(async()=>(await meter()).music).toBeGreaterThan(.06);
  try { await expect.poll(async()=>preservesOriginalSignal(await meter())).toBe(true); }
  catch(error) {
    await info.attach('original-audio-waveform',{contentType:'application/json',body:JSON.stringify(await page.evaluate(()=>({
      input:window.auditionSources.map(({context,meter})=>{const samples=new Float32Array(meter.fftSize);meter.getFloatTimeDomainData(samples);return {sampleRate:context.sampleRate,state:context.state,time:context.currentTime,samples:[...samples]};}),
      output:window.auditionContexts.map(({context,meter})=>{const samples=new Float32Array(meter.fftSize);meter.getFloatTimeDomainData(samples);return {sampleRate:context.sampleRate,state:context.state,time:context.currentTime,samples:[...samples]};}),
      video:[...document.querySelectorAll('.canvas-full-video video')].map(v=>({time:v.currentTime,rate:v.playbackRate,ready:v.readyState,paused:v.paused,volume:v.volume,muted:v.muted,source:v.currentSrc,error:v.error?.code})),
    })))});
    throw error;
  }
  const connected=await meter(),native=await video.evaluate(v=>({muted:v.muted,volume:v.volume}));
  await page.evaluate(()=>{const {node,context}=window.auditionContexts.at(-1);node.disconnect(context.destination);});
  await expect.poll(async()=>(await meter()).peak).toBeLessThan(.001);
  const disconnected=await meter();
  await page.evaluate(()=>{const {node,context}=window.auditionContexts.at(-1);node.connect(context.destination);});
  await expect.poll(async()=>(await meter()).music).toBeGreaterThan(.06);
  await expect.poll(async()=>preservesOriginalSignal(await meter())).toBe(true);
  await info.attach('audio-destination-countercontrol',{contentType:'application/json',body:JSON.stringify({native,connected,disconnected,restored:await meter()})});
  const cleanControl=await meter(false,0),overlapControl=await meter(false,.02);
  expect(cleanControl.music).toBeLessThan(.003);
  expect(overlapControl.music).toBeGreaterThan(.019);
  await info.attach('frequency-meter-countercontrols',{body:JSON.stringify({cleanControl,overlapControl}),contentType:'application/json'});
  const full=await meter();expect(full.original).toBeGreaterThan(.05);
  const levels=[];
  for(const percent of [0,30,100]) {
    await slider.fill(String(percent));await slider.dispatchEvent('input');
    await expect.poll(async()=>Math.abs((await meter()).music/full.music-percent/100)).toBeLessThan(.09);
    await expect.poll(async()=>preservesOriginalSignal(await meter())).toBe(true);
    await expect.poll(async()=>Math.abs((await meter()).original/full.original-1)).toBeLessThan(.15);
    const level=await meter();expect(Math.abs(level.original/full.original-1)).toBeLessThan(.15);levels.push(level);
  }
  await pause().click();const at=await video.evaluate(v=>v.currentTime);await expect.poll(()=>video.evaluate(v=>v.paused)).toBe(true);
  const select=block.getByRole('combobox',{name:locale==='de'?'Hintergrundmusik':'Background music',exact:true});
  await select.selectOption(second);expect(await video.evaluate(v=>v.paused)).toBe(true);await select.selectOption(mid);expect(await video.evaluate(v=>v.paused)).toBe(true);
  await video.evaluate(v=>{v.currentTime=3.4;});await start().click();await expect.poll(()=>video.evaluate(v=>v.currentTime)).toBeGreaterThan(3.5);
  try {await expect.poll(async()=>(await meter()).music).toBeGreaterThan(.06);} // past the short-track loop boundary
  catch(error){await info.attach('seek-audio-state',{body:JSON.stringify(await page.evaluate(()=>({trace:window.auditionTrace,video:[...document.querySelectorAll('.canvas-full-video video')].map(v=>({time:v.currentTime,duration:v.duration,ready:v.readyState,seeking:v.seeking,paused:v.paused,rate:v.playbackRate})),context:window.auditionContexts.at(-1).context.state}))),contentType:'application/json'});throw error;}
  await video.evaluate(v=>v.dispatchEvent(new Event('waiting')));await expect.poll(async()=>(await meter()).music).toBeLessThan(.003);
  await video.evaluate(v=>v.dispatchEvent(new Event('playing')));await expect.poll(async()=>(await meter()).music).toBeGreaterThan(.06);
  const beforeSwitch=await video.evaluate(v=>v.currentTime);await select.selectOption(second);await expect(pause()).toBeVisible();
  expect(await video.evaluate(v=>v.currentTime)).toBeGreaterThanOrEqual(beforeSwitch-.1);
  await expect.poll(async()=>(await meter()).music).toBeLessThan(.003);
  await expect.poll(async()=>(await meter()).peak).toBeGreaterThan(.8);
  const loud=await meter();expect(loud.peak).toBeLessThanOrEqual(.951);
  await video.evaluate(v=>{v.currentTime=v.duration-.15;});await expect.poll(()=>video.evaluate(v=>v.ended)).toBe(true);
  await expect.poll(async()=>(await meter()).peak).toBeLessThan(.001);
  await expect(block.getByRole('link')).toHaveAttribute('href',completed.asset.file_url+'?download=1');
  expect(writes).toEqual([]);expect(state.requests.filter(r=>r.pathname.endsWith('/run'))).toEqual([]);
  await block.getByRole('button',{name:locale==='de'?'Zurück zum erstellten Video':'Return to completed video'}).click();await expect(video).toHaveAttribute('src',completed.asset.file_url);
  await video.evaluate(v=>v.play());await expect.poll(async()=>preservesOriginalSignal(await meter())).toBe(true);
  expect((await meter()).music).toBeLessThan(.003);await video.evaluate(v=>v.pause());
  await block.getByRole('button',{name:locale==='de'?'Gesamtvideo in Assets speichern':'Save full video to Assets'}).click();
  expect(writes[0].body).toEqual({saveExportId:completed.id});
  await block.getByRole('button',{name:locale==='de'?'Gesamtes Video mit Hintergrundmusik erstellen':'Create full video with background music',exact:true}).click();
  await expect.poll(()=>writes.length).toBe(2);expect(writes[1].body).toEqual({backgroundMusic:{enabled:true,gain:1,musicAssetId:second}});
  await start().click();await expect(pause()).toBeVisible();
  if(locale==='de')await page.locator('#canvasInspectorToggle').click();await page.locator(`[data-node-id="${mid}"]`).press('Enter');
  await expect.poll(()=>page.evaluate(()=>window.auditionContexts[0].context.state)).toBe('closed');
  expect(writes).toHaveLength(2);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await info.attach('decoded-audition',{body:JSON.stringify({full,levels,loud,pausePosition:at}),contentType:'application/json'});
  completed={...completed,preview_base:null};await open();await expect(start()).toBeDisabled();await expect(block.getByRole('status',{name:locale==='de'?'Musikvorschau':'Music preview',exact:true})).toContainText(locale==='de'?'nicht verfügbar':'unavailable');
  completed={...completed,preview_base:{file_url:media}};await open();await select.selectOption(mid);await page.route('**/api/plain/music/mp3/file',r=>r.fulfill({contentType:'audio/mpeg',body:'invalid'}));await start().click();
  await expect(block.getByRole('status',{name:locale==='de'?'Musikvorschau':'Music preview',exact:true})).toContainText(locale==='de'?'nicht abgespielt':'could not play');
  await page.unroute('**/api/plain/music/mp3/file');
  // A delayed old read must never play over a newer track selection.
  await open();await select.selectOption(mid);let release,requested=false;
  const gate=new Promise(resolve=>{release=resolve;});
  await page.route('**/api/plain/music/mp3/file',async route=>{requested=true;await gate;await route.continue().catch(()=>{});});
  await start().click();await expect.poll(()=>requested).toBe(true);await select.selectOption(second);release();await expect(pause()).toBeVisible();
  await expect.poll(async()=>(await meter()).music).toBeLessThan(.003);await expect.poll(async()=>(await meter()).peak).toBeGreaterThan(.8);
  await page.unroute('**/api/plain/music/mp3/file');
  completed={...completed,preview_base:{file_url:'/api/plain/canvas-preview/missing.mp4'}};await open();
  await page.route('**/api/plain/canvas-preview/missing.mp4',route=>route.fulfill({status:404,body:''}));await start().click();
  try {await expect(block.getByRole('status',{name:locale==='de'?'Musikvorschau':'Music preview',exact:true})).toContainText(locale==='de'?'nicht abgespielt':'could not play');}
  catch(error) {
    await info.attach('missing-preview-lifecycle',{contentType:'application/json',body:JSON.stringify(await page.evaluate(()=>({
      events:window.auditionLifecycle,trace:window.auditionTrace,contexts:window.auditionContexts.map(({context})=>context.state),
      video:[...document.querySelectorAll('.canvas-full-video video')].map(v=>({src:v.getAttribute('src'),time:v.currentTime,ready:v.readyState,paused:v.paused,error:v.error?.code})),
    })))});throw error;
  }
  await block.getByRole('button',{name:locale==='de'?'Zurück zum erstellten Video':'Return to completed video'}).click();await expect(video).toHaveAttribute('src',completed.asset.file_url);
  expect(writes).toHaveLength(2);
};
module.exports.measureDecodedSignal=measureDecodedSignal;
module.exports.preservesOriginalSignal=preservesOriginalSignal;
