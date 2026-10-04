const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

for (const locale of ['en', 'de']) test(`Canvas completion metadata ${locale}: queue, deficient Inspector, appended chain and admission`, async ({ page }, info) => {
  await require('./helpers/canvas-completion-ui.cjs').completionUi({ page, expect, locale, mockSharedAuth, createCanvasApiMock, info });
});

for (const locale of ['en', 'de']) test(`Canvas asset audio ${locale}: typed references, persistent controls and real export`, async ({ page, browserName }, info) => {
  await require('./helpers/canvas-audio-ui.cjs').audioUi({page,expect,locale,browserName,mockSharedAuth,createCanvasApiMock,info});
});

for (const locale of ['en','de']) test(`Canvas legacy audio ${locale}: changed originals require a new timeline without replacing saved media`,async({page},info)=>{
  await page.setViewportSize({width:locale==='de'?390:1440,height:900});await mockSharedAuth(page);
  const state=createCanvasApiMock(page),project='1'.repeat(32),node='2'.repeat(32),run='3'.repeat(32),now=new Date().toISOString();
  const output={kind:'video',runId:run,assetId:'original',sourceVersion:'a'.repeat(64),previewUrl:'/tests/fixtures/media/member-video-poster.webp',asset:{id:'original',file_url:'/api/plain/canvas-preview/video.mp4'}};
  state.projects=[{id:project,title:'Legacy export',locale,created_at:now,updated_at:now}];
  state.nodes=[{id:node,project_id:project,type:'video_generation',title:'Video',x:100,y:100,config:{originalAudio:{enabled:true,gain:.5,fadeIn:0,fadeOut:0}},output,created_at:now,updated_at:now}];
  state.runs=[{id:run,node_id:node,status:'completed',output,created_at:now}];
  const completed={id:'a'.repeat(32),status:'ready',storage:'assets',asset:{file_url:output.asset.file_url+'?saved=1'},recipe:{version:2,videos:[{runId:run,assetId:'original',version:output.sourceVersion}]},preview_base:{file_url:output.asset.file_url}};
  const writes=[];await page.route('**/full-video',route=>{if(route.request().method()!=='GET')writes.push(route.request().method());return route.fulfill({json:{ok:true,data:{eligible:true,current:completed,export:completed}}});});
  await page.goto(locale==='de'?'/de/canvas/':'/canvas/');await page.locator(`[data-node-id="${node}"]`).press('Enter');
  if(locale==='de')await page.locator('#canvasInspectorToggle').click();
  const sound=page.locator('.canvas-sound');await sound.locator('summary').click();
  const button=sound.getByRole('button',{name:locale==='de'?'Toneinstellungen vorhören':'Preview sound settings',exact:true});
  await expect(button).toBeDisabled();await expect(sound.getByRole('status',{name:locale==='de'?'Musikvorschau':'Music preview',exact:true})).toContainText(locale==='de'?'erneut erstellen':'Create this older full video again');
  const gain=sound.getByRole('slider',{name:locale==='de'?'Originalton: Lautstärke':'Original audio: Volume',exact:true});
  await gain.fill('100');await gain.dispatchEvent('input');await expect(button).toBeEnabled();
  await gain.fill('50');await gain.dispatchEvent('input');await expect(button).toBeDisabled();
  await expect(page.locator('.canvas-full-video video')).toHaveAttribute('src',completed.asset.file_url);
  await expect(page.locator('.canvas-full-video a')).toHaveAttribute('href',completed.asset.file_url+'?download=1');
  await sound.scrollIntoViewIfNeeded();await sound.screenshot({path:info.outputPath(`canvas-sound-settings-${locale}.png`)});
  expect(writes).toEqual([]);expect(state.requests.filter(request=>request.pathname.endsWith('/run'))).toEqual([]);
});

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

async function mockSharedAuth(page, loggedIn = true, role = 'user') {
  await page.route('**/api/me', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(loggedIn
      ? { loggedIn: true, user: { id: 'canvas-member', email: 'canvas@example.com', role } }
      : { loggedIn: false, user: null }),
  }));
}

function createCanvasApiMock(page, { authenticated = true, modelPayload = null } = {}) {
  const projectId = '11111111111111111111111111111111';
  const state = { projects: [], nodes: [], edges: [], runs: [], modelRequests: 0, requests: [] };
  const imageModel = {
    id: '@cf/black-forest-labs/flux-1-schnell', label: 'FLUX.1 Schnell', vendor: 'Cloudflare', capability: 'image',
    description: 'Fast image model.', outputType: 'image', canvasEnabled: true, runnable: true, disabledReason: null,
    pricingStatus: 'member_credit_priced', estimatedCredits: 1, controls: { maxPromptLength: 1000 },
  };
  const textModel = { id: '@cf/meta/llama-3.1-8b-instruct', label: 'Llama', capability: 'text', description: 'Text model.', runnable: true, estimatedCredits: 1, pricingStatus: 'fixed_member_credit', controls: { maxPromptLength: 12000, maxTokens: { min: 1, max: 4096, default: 500 } } };
  const videoModel = { id: 'pixverse/v6', label: 'PixVerse V6', capability: 'video', description: 'Video model.', runnable: true, estimatedCredits: 20, pricingStatus: 'member_credit_priced', controls: { maxPromptLength: 5000, supportsImageInput: true, duration: { min: 5, max: 10, default: 5 }, defaultAspectRatio: '16:9' } };
  const fulfill = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(status < 400 ? { ok: true, data } : data) });

  page.route('**/api/account/canvas/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const method = request.method();
    state.requests.push({ method, pathname });
    if (!authenticated) return fulfill(route, { ok: false, error: 'Authentication required.', code: 'unauthorized' }, 401);
    if (pathname.endsWith('/models')) { state.modelRequests += 1; return fulfill(route, modelPayload || { models: [textModel, imageModel, videoModel], organizations: [], selected_organization_id: null, access: { role: 'user', is_admin: false } }); }
    if (pathname === '/api/account/canvas/projects' && method === 'GET') return fulfill(route, { projects: state.projects, applied_limit: 50 });
    if (pathname === '/api/account/canvas/projects' && method === 'POST') {
      const body = request.postDataJSON();
      const now = new Date().toISOString();
      const project = { id: projectId, title: body.title, locale: body.locale, thumbnail_asset_id: null, created_at: now, updated_at: now };
      state.projects = [project];
      return fulfill(route, { project }, 201);
    }
    if (pathname === `/api/account/canvas/projects/${projectId}` && method === 'GET') return fulfill(route, { project: state.projects[0], nodes: state.nodes, edges: state.edges, runs: state.runs });
    if (pathname === `/api/account/canvas/projects/${projectId}` && method === 'PATCH') {
      Object.assign(state.projects[0], request.postDataJSON(), { updated_at: new Date().toISOString() });
      return fulfill(route, { project: state.projects[0] });
    }
    if (pathname === `/api/account/canvas/projects/${projectId}` && method === 'DELETE' && state.projects.some((project) => project.id === projectId)) {
      state.projects = state.projects.filter((project) => project.id !== projectId);
      state.nodes = state.nodes.filter((node) => node.project_id !== projectId);
      state.edges = state.edges.filter((edge) => edge.project_id !== projectId);
      state.runs = state.runs.filter((run) => run.project_id !== projectId);
      return fulfill(route, { id: projectId, deleted: true, assets_deleted: false });
    }
    if (pathname === `/api/account/canvas/projects/${projectId}/nodes` && method === 'POST') {
      const body = request.postDataJSON();
      const node = { id: String(state.nodes.length + 2).repeat(32).slice(0, 32), project_id: projectId, ...body, width: null, height: null, output: null, asset_id: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      state.nodes.push(node);
      return fulfill(route, { node }, 201);
    }
    const nodeMatch = pathname.match(/\/nodes\/([a-f0-9]{32})$/);
    if (nodeMatch && method === 'PATCH') {
      const node = state.nodes.find((item) => item.id === nodeMatch[1]);
      Object.assign(node, request.postDataJSON(), { updated_at: new Date().toISOString() });
      return fulfill(route, { node });
    }
    if (nodeMatch && method === 'DELETE' && pathname === `/api/account/canvas/projects/${projectId}/nodes/${nodeMatch[1]}` && state.nodes.some((node) => node.id === nodeMatch[1] && node.project_id === projectId)) {
      state.nodes = state.nodes.filter((node) => node.id !== nodeMatch[1]);
      state.edges = state.edges.filter((edge) => edge.source_node_id !== nodeMatch[1] && edge.target_node_id !== nodeMatch[1]);
      return fulfill(route, { id: nodeMatch[1], deleted: true, asset_deleted: false });
    }
    if (pathname === `/api/account/canvas/projects/${projectId}/edges` && method === 'POST') {
      const body = request.postDataJSON();
      const edge = { id: String.fromCharCode(101 + state.edges.length).repeat(32), project_id: projectId, ...body, label: null, config: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      state.edges.push(edge);
      return fulfill(route, { edge }, 201);
    }
    const edgeMatch = pathname.match(/\/edges\/([a-f0-9]{32})$/);
    if(edgeMatch && method==='PATCH' && pathname===`/api/account/canvas/projects/${projectId}/edges/${edgeMatch[1]}`) {
      const edge=state.edges.find(item=>item.id===edgeMatch[1] && item.project_id===projectId);
      if(!edge)return fulfill(route,{ok:false,code:'edge_not_found'},404);
      Object.assign(edge,request.postDataJSON(),{updated_at:new Date().toISOString()});
      return fulfill(route,{edge});
    }
    if (edgeMatch && method === 'DELETE' && pathname === `/api/account/canvas/projects/${projectId}/edges/${edgeMatch[1]}` && state.edges.some((edge) => edge.id === edgeMatch[1] && edge.project_id === projectId)) {
      state.edges = state.edges.filter((edge) => edge.id !== edgeMatch[1]);
      return fulfill(route, { id: edgeMatch[1], deleted: true });
    }
    return fulfill(route, { ok: false, error: 'Not mocked', code: 'not_mocked' }, 404);
  });
  page.route('**/api/account/credits-dashboard**', (route) => route.fulfill({ json: { ok: true, dashboard: { balance: { totalCredits: 500 } } } }));
  page.route('**/api/model-pricing',route=>route.fulfill({json:{ok:true,revision:0,rules:{}, availability: require('./fixtures/model-availability.json')}}));
  page.route('**/api/appearance',route=>route.fulfill({json:{ok:true,appearance:{version:1,revision:0,segments:{public:'dark',account:'dark',admin:'dark'},personalEnabled:false}}}));
  return state;
}

for(const locale of ['en','de']) for(const width of [1440,390]) test(`Canvas ElevenLabs editor ${locale} ${width}: complete plan options persist without processing`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await mockSharedAuth(page);
  const {listCanvasModelsForRole}=await import('../js/shared/canvas-model-contract.mjs');
  const state=createCanvasApiMock(page,{modelPayload:{models:listCanvasModelsForRole('user'),organizations:[],selected_organization_id:null,access:{role:'user'}}});
  const now=new Date().toISOString(),pid='1'.repeat(32),nid='2'.repeat(32);
  state.projects=[{id:pid,title:'Music plan',locale,created_at:now,updated_at:now}];
  state.nodes=[{id:nid,project_id:pid,type:'music_generation',title:'ElevenLabs',model_id:'elevenlabs/music-v2',x:0,y:0,config:{},content:{},created_at:now,updated_at:now}];
  await page.goto(`${locale==='de'?'/de':''}/canvas/`);await page.locator(`[data-node-id="${nid}"]`).press('Enter');
  if(width<600)await page.locator('#canvasInspectorToggle').click();
  const editor=page.locator('#canvasInspectorBody .member-music-controls');await expect(editor).toBeVisible();
  await editor.locator('[data-music-option="inputMode"]').selectOption('composition_plan');
  const plan={chunks:[{text:'Synthetic piano',duration_ms:6000,positive_styles:['piano'],negative_styles:['drums'],context_adherence:'high',condition_strength:'xhigh',conditioning_ref:{song_id:'synthetic-song',range:{start_ms:0,end_ms:3000}}}]};
  await editor.locator('textarea').fill(JSON.stringify(plan));await editor.locator('[data-music-option="outputFormat"]').selectOption('opus_48000_128');
  await editor.locator('[data-music-option="storeForInpainting"]').check();
  await editor.locator('[data-music-option="seed"]').fill('4294967295');
  await expect(editor.locator('[data-music-option="signWithC2pa"]')).toBeDisabled();
  await expect.poll(()=>state.nodes[0].config.compositionPlan).toEqual(plan);
  await expect.poll(()=>state.nodes[0].config.seed).toBe(4294967295);
  expect(state.requests.filter(r=>r.pathname.endsWith('/run'))).toEqual([]);
  await page.reload();await page.locator(`[data-node-id="${nid}"]`).press('Enter');
  if(width<600)await page.locator('#canvasInspectorToggle').click();
  await expect(editor.locator('textarea')).toHaveValue(JSON.stringify(plan,null,2));
  await expect(editor.locator('[data-music-option="outputFormat"]')).toHaveValue('opus_48000_128');
  await expect(editor.locator('[data-music-option="storeForInpainting"]')).toBeChecked();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await editor.locator('input,textarea,select').evaluateAll(inputs=>inputs.every(input=>input.labels.length>0))).toBe(true);
  await page.screenshot({path:info.outputPath(`music-editor-${locale}-${width}.png`)});
});

const memberAudioRequests = new WeakMap();
const musicPreviewCase = require('./helpers/canvas-music-preview.cjs');
test('Canvas music decoded input reference rejects missing and attenuated originals',()=>{
  const recorded=require('./fixtures/media/canvas-audition-native-input.json');
  const read=entry=>{const bytes=Buffer.from(entry.float32LE,'base64');return Float32Array.from({length:bytes.length/4},(_,index)=>bytes.readFloatLE(index*4));};
  const source=musicPreviewCase.measureDecodedSignal(read(recorded.input),recorded.input.sampleRate);
  const mixed=musicPreviewCase.measureDecodedSignal(read(recorded.output),recorded.output.sampleRate);
  expect(recorded.input.contextTime).toBe(recorded.output.contextTime);
  expect(source.original).toBeGreaterThan(.07);expect(mixed.original).toBeLessThan(.085);
  expect(mixed.music).toBeGreaterThan(.06);
  expect(musicPreviewCase.preservesOriginalSignal({...mixed,sourceOriginal:source.original})).toBe(true);
  for(const gain of [0,.5,.8,1,1.2]) {
    const samples=Float32Array.from({length:8192},(_,i)=>source.original*gain*Math.sin(2*Math.PI*1000*i/48000)+.084*Math.sin(2*Math.PI*440*i/48000));
    const output=musicPreviewCase.measureDecodedSignal(samples,48000);
    expect(output.music).toBeGreaterThan(.08);
    expect(musicPreviewCase.preservesOriginalSignal({...output,sourceOriginal:source.original}),`original gain ${gain}`).toBe(gain===1);
  }
  for(const sourceOriginal of [0,.001,.03,NaN])expect(musicPreviewCase.preservesOriginalSignal({original:sourceOriginal,sourceOriginal})).toBe(false);
});
for (const locale of ['en','de']) {
  test(`Canvas music audition ${locale}: decoded gain, timeline, selection and no render`,
    musicPreviewCase({expect,mockSharedAuth,createCanvasApiMock},locale));
}
for (const locale of ['en','de']) test(`Canvas music preview ${locale}: metadata arrival preserves the start click and failed-media recovery`,async({page,browserName},info)=>{
  await page.setViewportSize({width:locale==='de'?390:1440,height:900});await mockSharedAuth(page);
  const state=createCanvasApiMock(page),project='1'.repeat(32),node='2'.repeat(32),run='3'.repeat(32),music='4'.repeat(32),now=new Date().toISOString();
  const media=`/api/plain/canvas-preview/video.${browserName==='chromium'?'webm':'mp4'}`;
  const output={kind:'video',runId:run,assetId:'original',previewUrl:'/tests/fixtures/media/member-video-poster.webp',asset:{id:'original',file_url:media}};
  state.projects=[{id:project,title:'Preview metadata',locale,created_at:now,updated_at:now}];
  state.nodes=[{id:node,project_id:project,type:'video_generation',title:'Video',x:100,y:100,config:{backgroundMusic:{enabled:true,gain:1,musicAssetId:music}},output,created_at:now,updated_at:now},
    {id:music,project_id:project,type:'music_generation',title:'Music',x:100,y:400,config:{},output:{kind:'audio',asset:{id:music,asset_type:'music',mime_type:'audio/mpeg',file_url:'/api/plain/music/mp3/file'}},created_at:now,updated_at:now}];
  state.edges=[{id:'5'.repeat(32),project_id:project,source_node_id:music,target_node_id:node,config:{purpose:'export_background_music'},created_at:now}];
  state.runs=[{id:run,node_id:node,status:'completed',output,created_at:now}];
  const completed={id:'a'.repeat(32),status:'ready',storage:'canvas',asset:{id:'a'.repeat(32),file_url:media+'?completed=1'},preview_base:{file_url:'/api/plain/canvas-preview/missing.mp4'}};
  const writes=[],missing=[];page.on('request',request=>{if(request.method()!=='GET')writes.push({method:request.method(),path:new URL(request.url()).pathname});});
  await page.route('**/full-video',route=>route.fulfill({json:{ok:true,data:{eligible:true,export:completed,current:completed}}}));
  await page.route('**/api/plain/canvas-preview/missing.mp4',route=>{missing.push(route.request().url());return route.fulfill({status:404,body:''});});
  // Cover both the failed candidate's unavailable fixture poster and a real
  // square poster, whose intrinsic ratio differs from the decoded video.
  await page.route('**/tests/fixtures/media/member-video-poster.webp',route=>route.fulfill(locale==='en'?{status:404,body:''}:{contentType:'image/webp',body:fs.readFileSync(path.join(__dirname,'fixtures/media/member-video-poster.webp'))}));
  let release;const gate=new Promise(resolve=>{release=resolve;});
  await page.route(`**${media}`,async route=>{await gate;await route.continue();});
  try {
    await page.goto(locale==='de'?'/de/canvas/':'/canvas/');await page.locator(`[data-node-id="${node}"]`).press('Enter');
    if(locale==='de')await page.locator('#canvasInspectorToggle').click();
    const block=page.locator('.canvas-full-video'),sound=page.locator('.canvas-sound'),original=page.locator('.canvas-output > video');
    await sound.locator('summary').click();
    const start=sound.getByRole('button',{name:locale==='de'?'Vorschau mit Musik':'Preview with music',exact:true});
    await expect(start).toBeEnabled();await start.scrollIntoViewIfNeeded();
    await expect(original).toHaveJSProperty('videoWidth',0);
    const before=await start.boundingBox();
    await page.mouse.move(before.x+before.width/2,before.y+3);await page.mouse.down();
    release();await expect.poll(()=>original.evaluate(v=>v.videoWidth)).toBeGreaterThan(0);
    const after=await start.boundingBox();await page.mouse.up();
    await info.attach('metadata-pointer-geometry',{contentType:'application/json',body:JSON.stringify({before,after})});
    expect(after.y).toBeCloseTo(before.y,1);
    await expect.poll(()=>missing.length).toBeGreaterThan(0);
    await expect(sound.getByRole('status',{name:locale==='de'?'Musikvorschau':'Music preview',exact:true})).toContainText(locale==='de'?'nicht abgespielt':'could not play');
    await sound.getByRole('button',{name:locale==='de'?'Zurück zum erstellten Video':'Return to completed video'}).click();
    const result=block.locator('video');await expect(result).toHaveAttribute('src',completed.asset.file_url);
    await result.evaluate(v=>v.play());await expect.poll(()=>result.evaluate(v=>v.currentTime)).toBeGreaterThan(.2);
    expect(writes).toEqual([]);expect(state.requests.filter(request=>request.pathname.endsWith('/run'))).toEqual([]);
  } finally {release();}
});
const musicMediaCase = title => title.startsWith('Canvas member music Generate Lab') || title.startsWith('Canvas music native HTTP control');
test.beforeEach(async ({page}, info) => {
  if (!musicMediaCase(info.title)) return;
  const requests=[];memberAudioRequests.set(page,requests);
  page.on('request',request=>{const url=new URL(request.url());if(url.pathname.startsWith('/api/plain/music/'))requests.push({event:'request',path:url.pathname,range:request.headers().range || null});});
  page.on('response',response=>{const url=new URL(response.url());if(url.pathname.startsWith('/api/plain/music/'))requests.push({event:'response',path:url.pathname,status:response.status(),type:response.headers()['content-type'],range:response.headers()['content-range'],transport:response.headers()['x-test-media-transport']});});
  await page.addInitScript(()=>{
    window.memberAudioEvidence=[];
    for(const name of ['loadstart','loadedmetadata','loadeddata','canplay','playing','timeupdate','ended','error','abort','emptied','stalled']) document.addEventListener(name,event=>{
      const a=event.target;if(a.tagName!=='AUDIO')return;
      window.memberAudioEvidence.push({event:name,path:a.currentSrc?new URL(a.currentSrc).pathname:null,duration:String(a.duration),time:a.currentTime,ready:a.readyState,network:a.networkState,error:a.error?{code:a.error.code,message:a.error.message}:null});
    },true);
  });
});
test.afterEach(async ({page}, info) => {
  if (!musicMediaCase(info.title) || page.isClosed()) return;
  await info.attach('native-audio-state', {contentType:'application/json',body:JSON.stringify(await page.evaluate(()=>({
    userAgent:navigator.userAgent, opus:document.createElement('audio').canPlayType('audio/ogg; codecs="opus"'),
    mp3:document.createElement('audio').canPlayType('audio/mpeg'),events:window.memberAudioEvidence || [],
  }))) });
  await info.attach('native-audio-requests',{contentType:'application/json',body:JSON.stringify(memberAudioRequests.get(page))});
});

test('Canvas music native HTTP control decodes and plays MP3 and Opus, rejects invalid audio', async ({page}, info) => {
  await page.goto('/plain-video');
  for(const format of ['mp3','opus']) {
    const bytes=fs.readFileSync(path.join(__dirname,`fixtures/media/member-music.${format}`));
    const full=await page.request.get(`/api/plain/music/${format}/file`);
    expect(full.status()).toBe(200);expect(await full.body()).toEqual(bytes);
    const tail=await page.request.get(`/api/plain/music/${format}/file`,{headers:{Range:'bytes=-10'}});
    expect(tail.status()).toBe(206);expect(tail.headers()['content-range']).toBe(`bytes ${bytes.length-10}-${bytes.length-1}/${bytes.length}`);expect(await tail.body()).toEqual(bytes.subarray(-10));
    expect((await page.request.get(`/api/plain/music/${format}/file`,{headers:{Range:`bytes=${bytes.length}-`}})).status()).toBe(416);
  }
  // This shared server must still deliver the unchanged existing video fixture.
  const video=await page.request.get('/api/plain/file',{headers:{Range:'bytes=3-31'}});
  expect(video.status()).toBe(206);expect(video.headers()['content-type']).toBe('video/mp4');
  expect(await video.body()).toEqual(fs.readFileSync(path.join(__dirname,'fixtures/media/test-video.mp4')).subarray(3,32));
  const results=[];
  for(const format of ['mp3','opus','invalid']) {
    const state=await page.evaluate(async format=>{
      const audio=document.createElement('audio');audio.controls=true;document.body.append(audio);
      const events=[];for(const name of ['loadedmetadata','loadeddata','playing','ended','error'])audio.addEventListener(name,()=>events.push({name,duration:String(audio.duration),time:audio.currentTime,error:audio.error?.code}));
      audio.src=`/api/plain/music/${format}/file`;
      try { await audio.play(); } catch (error) { events.push({name:'play-rejected',error:error.name}); }
      await new Promise(resolve=>setTimeout(resolve,700));
      const result={format,duration:audio.duration,time:audio.currentTime,error:audio.error?.code,events};audio.pause();audio.remove();return result;
    },format);
    results.push(state);
  }
  await info.attach('http-audio-control',{contentType:'application/json',body:JSON.stringify(results)});
  for(const state of results.slice(0,2)) {expect(state.error).toBeUndefined();expect(state.duration).toBeGreaterThan(2.9);expect(state.time).toBeGreaterThan(.2);}
  expect(results[2].error).toBe(4);
});

for(const locale of ['en','de']) for(const width of [1440,390]) test(`Canvas member music Generate Lab ${locale} ${width}: ElevenLabs prompt/plan, pricing and MP3/Opus`,async({page},info)=>{
  await page.setViewportSize({width,height:900});const calls=[];
  await page.addInitScript(()=>localStorage.setItem('bitbi_cookie_consent',JSON.stringify({v:'1',necessary:true,analytics:false,marketing:false})));
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/me') return route.fulfill({json:{loggedIn:true,user:{id:'music-browser',email:'music@example.invalid',role:locale==='de'?'admin':'user'}}});
    // Keep provider JSON controlled, but exercise the native HTTP media path.
    if(/^\/api\/plain\/music\/(mp3|opus)\/file$/.test(url.pathname)) return route.continue();
    if(url.pathname==='/api/ai/generate-music') {
      const body=route.request().postDataJSON();calls.push(body);
      const opus=body.outputFormat==='opus_48000_128';
      return route.fulfill({json:{ok:true,data:{model:{id:body.model},audioUrl:`/api/plain/music/${opus?'opus':'mp3'}/file`,mimeType:opus?'audio/ogg':'audio/mpeg',asset:{id:'music-'+calls.length,title:'Synthetic music'}},billing:{balance_after:995}}});
    }
    if(url.pathname==='/api/model-pricing')return route.fulfill({json:{ok:true,revision:0,rules:{}, availability: require('./fixtures/model-availability.json')}});
    if(url.pathname==='/api/appearance')return route.fulfill({json:{ok:true,appearance:{version:1,revision:0,segments:{public:'dark',account:'dark',admin:'dark'},personalEnabled:false}}});
    if(url.pathname==='/api/account/credits-dashboard')return route.fulfill({json:{ok:true,dashboard:{balance:{totalCredits:1000}}}});
    if(['/api/ai/quota','/api/ai/folders','/api/ai/assets'].includes(url.pathname))return route.fulfill({json:{ok:true,data:{creditBalance:1000,folders:[],assets:[],has_more:false}}});
    return route.fulfill({status:404,json:{ok:false,code:'unmocked_request'}});
  });
  await page.goto(`${locale==='de'?'/de':''}/generate-lab/`);
  if(width<600) {
    await expect(page.locator('#labGenerate')).toBeHidden();
    await expect(page.getByRole('heading',{name:locale==='de'?'Für Desktop optimiert':'Optimized for desktop'})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(calls).toEqual([]);return;
  }
  await page.locator('[data-media-type="music"]').click();
  await page.locator('#labImageModel').selectOption('elevenlabs/music-v2');
  const editor=page.locator('.member-music-controls');await expect(editor).toBeVisible();
  await expect(page.locator('#labCost')).toContainText('50');
  await page.locator('#labPrompt').fill('Synthetic piano');await editor.locator('[data-music-option="musicLengthMs"]').fill('3000');
  await editor.locator('[data-music-option="outputFormat"]').selectOption('mp3_48000_192');
  await editor.locator('[data-music-option="signWithC2pa"]').check();await page.locator('#labGenerate').click();
  await expect.poll(()=>calls.length).toBe(1);expect(calls[0]).toMatchObject({model:'elevenlabs/music-v2',prompt:'Synthetic piano',musicLengthMs:3000,signWithC2pa:true});
  expect(calls[0]).not.toHaveProperty('generateLyrics');
  await expect(page.locator('#labGenerate')).toBeEnabled();
  await page.locator('#labResultStage audio').evaluate(a=>a.play());
  await expect.poll(()=>page.locator('#labResultStage audio').evaluate(a=>Number.isFinite(a.duration)&&a.duration>0)).toBe(true);
  await expect.poll(()=>page.locator('#labResultStage audio').evaluate(a=>a.currentTime)).toBeGreaterThan(.2);
  await page.locator('#labPrompt').fill('');await editor.locator('[data-music-option="inputMode"]').selectOption('composition_plan');
  const plan={chunks:[{text:'Piano',duration_ms:6000,positive_styles:['ambient']}]};await editor.locator('textarea').fill(JSON.stringify(plan));
  await editor.locator('[data-music-option="outputFormat"]').selectOption('opus_48000_128');
  await editor.locator('[data-music-option="storeForInpainting"]').check();await page.locator('#labGenerate').click();
  await expect.poll(()=>calls.length).toBe(2);expect(calls[1]).toMatchObject({model:'elevenlabs/music-v2',compositionPlan:plan,storeForInpainting:true});
  expect(calls[1]).not.toHaveProperty('prompt');expect(calls[1]).not.toHaveProperty('musicLengthMs');expect(calls[1].signWithC2pa).not.toBe(true);
  await expect(page.locator('#labGenerate')).toBeEnabled();
  const audio=page.locator('#labResultStage audio');await expect(audio).toHaveCount(1);
  await audio.evaluate(a=>a.play());
  await expect.poll(()=>audio.evaluate(a=>Number.isFinite(a.duration)&&a.duration>0)).toBe(true);
  await expect.poll(()=>audio.evaluate(a=>a.currentTime)).toBeGreaterThan(.2);
  await audio.evaluate(a=>a.pause());
  const audioResponses=memberAudioRequests.get(page).filter(event=>event.event==='response');
  for(const format of ['mp3','opus'])expect(audioResponses.some(event=>event.path===`/api/plain/music/${format}/file`&&event.transport==='http'&&[200,206].includes(event.status))).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath(`member-music-${locale}-${width}.png`)});
});

for(const locale of ['en','de']) test(`Canvas contributors ${locale}: current strand ignores historical ancestry and unrelated references`,async({page},info)=>{
  await page.setViewportSize({width:1600,height:1000});await mockSharedAuth(page);
  const state=createCanvasApiMock(page),pid='1'.repeat(32),now=new Date().toISOString(),run='a'.repeat(32),old='b'.repeat(32);
  const id=n=>String(n).repeat(32),node=(n,type,x,y)=>({id:id(n),project_id:pid,type,title:'Node '+n,model_id:type==='video_generation'?'pixverse/v6':null,x,y,config:{prompt:'Own prompt'},content:{text:'Reference'},created_at:now,updated_at:now});
  state.projects=[{id:pid,title:'Branched strand',locale,created_at:now,updated_at:now}];
  state.nodes=[node(2,'video_generation',10,20),node(3,'video_generation',270,20),node(4,'asset_reference',10,200),node(5,'video_generation',530,100),node(6,'video_generation',270,390)];
  const output={kind:'video',runId:run,assetId:'synthetic',sourceVersion:'a'.repeat(64),fileUrl:'/tests/fixtures/media/test-video-changing.mp4'};state.nodes[3].output=output;
  state.edges=[[2,3],[3,5],[4,5],[3,6]].map(([a,b],i)=>({id:id(i+2),source_node_id:id(a),target_node_id:id(b),config:{}}));
  state.runs=[{id:old,node_id:id(5),status:'completed',output:{...output,runId:old},model_id:'pixverse/v6',updated_at:now}];
  const reads=[];await page.route('**/runs/*/contributors',route=>{reads.push(route.request().url());return route.fulfill({status:500,json:{ok:false}});});
  await page.goto(`${locale==='de'?'/de':''}/canvas/`);await page.locator(`[data-node-id="${id(5)}"]`).press('Enter');
  await expect(page.locator('.canvas-node.is-contributor')).toHaveCount(3);await expect(page.locator('.canvas-edge.is-contributor')).toHaveCount(2);
  for(const n of [4,6])await expect(page.locator(`[data-node-id="${id(n)}"]`)).not.toHaveClass(/is-contributor/);
  await page.screenshot({path:info.outputPath(`contributors-${locale}.png`)});
  await page.locator('#canvasHistoryToggle').click();await page.locator('.canvas-run-item').last().click();
  await expect(page.locator('.canvas-edge.is-contributor')).toHaveCount(2);expect(reads).toEqual([]);
  await page.locator(`[data-node-id="${id(5)}"]`).press('ArrowRight');await expect(page.locator('.canvas-edge.is-contributor')).toHaveCount(2);
  await page.locator(`[data-node-id="${id(4)}"]`).press('Enter');await expect(page.locator('.canvas-edge.is-contributor')).toHaveCount(0);
});

test.describe('BITBI Canvas static and protected workspace', () => {
  test('English and German pages keep noindex, canonical, hreflang, and navigation parity', () => {
    const en = source('canvas/index.html');
    const de = source('de/canvas/index.html');
    expect(en).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(de).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(en).toContain('<link rel="canonical" href="https://bitbi.ai/canvas/">');
    expect(de).toContain('<link rel="canonical" href="https://bitbi.ai/de/canvas/">');
    for (const html of [en, de]) {
      expect(html).toContain('hreflang="en" href="https://bitbi.ai/canvas/"');
      expect(html).toContain('hreflang="de" href="https://bitbi.ai/de/canvas/"');
      const generateHref = html.includes('href="/de/generate-lab/"') ? 'href="/de/generate-lab/"' : 'href="/generate-lab/"';
      const canvasHref = html.includes('href="/de/canvas/" class="mobile-nav') ? 'href="/de/canvas/" class="mobile-nav' : 'href="/canvas/" class="mobile-nav';
      expect(html.indexOf(generateHref)).toBeLessThan(html.indexOf(canvasHref));
      expect(html).not.toContain('/api/admin/');
    }
    expect(source('index.html')).toContain('href="/canvas/" class="hero__canvas-teaser"');
    expect(source('de/index.html')).toContain('href="/de/canvas/" class="hero__canvas-teaser"');
  });

  test('logged-out Canvas reveals only the login-required gate and never requests models', async ({ page }) => {
    await mockSharedAuth(page, false);
    const state = createCanvasApiMock(page, { authenticated: false });
    await page.goto('/canvas/');
    await expect(page.getByRole('heading', { name: 'Sign in to use Canvas' })).toBeVisible();
    await expect(page.locator('#canvasApp')).toBeHidden();
    await expect(page.locator('#canvasProjectList')).toBeHidden();
    expect(state.modelRequests).toBe(0);
  });

  test('authenticated member can create a project, add nodes, connect them, and reload persisted graph state', async ({ page }) => {
    await mockSharedAuth(page, true);
    const state = createCanvasApiMock(page);
    await page.goto('/canvas/');
    await expect(page.locator('#canvasApp')).toBeVisible();
    await expect(page.locator('header .site-nav__links').getByRole('link', { name: 'Generate Lab' })).toHaveAttribute('href', '/generate-lab/');
    await expect(page.locator('header .site-nav__links').getByText('Canvas', { exact: true })).toHaveAttribute('aria-current', 'page');
    page.once('dialog', (dialog) => dialog.accept('Campaign workflow'));
    await page.locator('#canvasNewProject').click();
    await expect(page.locator('#canvasProjectTitle')).toHaveValue('Campaign workflow');

    await page.locator('#canvasNodeType').selectOption('text_prompt');
    await page.locator('#canvasAddNode').click();
    await page.locator('#canvasNodeType').selectOption('image_generation');
    await page.locator('#canvasAddNode').click();
    await expect(page.locator('.canvas-node')).toHaveCount(2);
    await expect(page.locator('#canvasEmpty')).toBeHidden();

    await page.locator('.canvas-node').nth(0).locator('[data-port="out"]').click();
    await page.locator('.canvas-node').nth(1).locator('[data-port="in"]').click();
    await expect.poll(() => state.edges.length).toBe(1);
    await expect(page.locator('.canvas-edge')).toHaveCount(1);
    await expect(page.locator('#canvasNodes')).toHaveCSS('pointer-events', 'none');
    await expect(page.locator('.canvas-node').first()).toHaveCSS('pointer-events', 'auto');

    const sourceId = state.nodes[0].id;
    const start = { x: state.nodes[0].x, y: state.nodes[0].y };
    const pathBefore = await page.locator('.canvas-edge').getAttribute('d');
    const dragHead = page.locator(`[data-node-id="${sourceId}"] .canvas-node__head`);
    const box = await dragHead.boundingBox();
    await page.mouse.move(box.x + 30, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 150, box.y + 95, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => state.nodes[0].x).toBeGreaterThan(start.x + 100);
    await expect.poll(() => state.nodes[0].y).toBeGreaterThan(start.y + 60);
    await expect.poll(async () => page.locator('.canvas-edge').getAttribute('d')).not.toBe(pathBefore);
    const persisted = { x: state.nodes[0].x, y: state.nodes[0].y };

    await page.reload();
    await expect(page.locator('.canvas-node')).toHaveCount(2);
    await expect(page.locator('.canvas-edge')).toHaveCount(1);
    await expect(page.locator(`[data-node-id="${sourceId}"]`)).toHaveCSS('transform', `matrix(1, 0, 0, 1, ${persisted.x}, ${persisted.y})`);

    page.once('dialog', (dialog) => dialog.accept('Renamed campaign'));
    await page.getByRole('button', { name: 'Rename Canvas: Campaign workflow', exact: true }).click();
    await expect(page.locator('#canvasProjectTitle')).toHaveValue('Renamed campaign');
    await expect.poll(() => state.projects[0].title).toBe('Renamed campaign');
    await expect(page.getByRole('button', { name: 'Rename Canvas: Renamed campaign', exact: true })).toBeVisible();

    await page.locator(`[data-node-id="${sourceId}"]`).press('Enter');
    const nodeTitle = page.getByLabel('Title', { exact: true });
    const originalTitle = await nodeTitle.inputValue();
    let unexpectedConfirmations = 0;
    const dismissUnexpected = (dialog) => { unexpectedConfirmations += 1; return dialog.dismiss(); };
    page.on('dialog', dismissUnexpected);
    await nodeTitle.focus();
    await nodeTitle.press('Home');
    await nodeTitle.press('Delete');
    await nodeTitle.press('End');
    await nodeTitle.press('Backspace');
    page.off('dialog', dismissUnexpected);
    expect(unexpectedConfirmations).toBe(0);
    expect(state.requests.filter((request) => request.method === 'DELETE')).toEqual([]);
    await expect(page.locator('.canvas-node')).toHaveCount(2);
    await expect(page.locator('.canvas-edge')).toHaveCount(1);
    await nodeTitle.fill(originalTitle);
    await nodeTitle.blur();
    await expect(page.locator('#canvasSaveState')).toHaveAttribute('data-state', 'saved');

    const edgeId = state.edges[0].id;
    await page.locator('.canvas-edge-hit').press('Enter');
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.locator('#canvasDeleteSelection').click();
    await expect(page.locator('.canvas-edge')).toHaveCount(1);
    expect(state.requests.filter((request) => request.method === 'DELETE')).toEqual([]);
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#canvasDeleteSelection').click();
    await expect(page.locator('.canvas-edge')).toHaveCount(0);
    expect(state.edges).toEqual([]);

    await page.locator(`[data-node-id="${sourceId}"]`).press('Enter');
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#canvasDeleteSelection').click();
    await expect(page.locator('.canvas-node')).toHaveCount(1);
    expect(state.nodes.some((node) => node.id === sourceId)).toBe(false);

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Delete Canvas: Renamed campaign', exact: true }).click();
    await expect(page.locator('.canvas-project-item')).toHaveCount(0);
    await expect(page.locator('.canvas-node')).toHaveCount(0);
    expect(state.projects).toEqual([]);
    expect(state.nodes).toEqual([]);
    expect(state.requests.filter((request) => request.method === 'DELETE').map((request) => request.pathname)).toEqual([
      `/api/account/canvas/projects/11111111111111111111111111111111/edges/${edgeId}`,
      `/api/account/canvas/projects/11111111111111111111111111111111/nodes/${sourceId}`,
      '/api/account/canvas/projects/11111111111111111111111111111111',
    ]);
  });

  test('mobile Canvas opens the actual project controls and returns to the graph without overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockSharedAuth(page, true);
    const state = createCanvasApiMock(page);
    await page.goto('/de/canvas/');
    await expect(page.locator('#canvasApp')).toBeVisible();
    await expect(page.locator('#canvasProjectsPanel')).toBeHidden();
    await expect(page.locator('#canvasViewport')).toBeVisible();
    await page.locator('#canvasProjectsToggle').focus();
    await page.locator('#canvasProjectsToggle').press('Enter');
    await expect(page.locator('#canvasProjectsPanel')).toBeVisible();
    await expect(page.locator('#canvasNewProject')).toBeVisible();
    await expect(page.locator('#canvasViewport')).toBeHidden();
    await page.locator('#canvasGraphToggle').focus();
    await page.locator('#canvasGraphToggle').press('Enter');
    await expect(page.locator('#canvasProjectsPanel')).toBeHidden();
    await expect(page.locator('#canvasViewport')).toBeVisible();
    await expect(page.locator('#canvasGraphToggle')).toBeFocused();
    const metrics = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, viewport: window.innerWidth, viewportHeight: innerHeight, appVisible: !document.getElementById('canvasApp').hidden }));
    expect(metrics.appVisible).toBe(true);
    expect(metrics.width).toBeLessThanOrEqual(metrics.viewport + 1);
    expect(metrics.height).toBeLessThanOrEqual(metrics.viewportHeight + 1);
    expect(state.requests.filter((request) => request.method !== 'GET')).toEqual([]);
  });

  for (const locale of ['en', 'de']) {
    test(`Canvas ${locale}: viewport filling, centered empty graph and reversible desktop panels`, async ({ page }) => {
      await mockSharedAuth(page, true);
      const state = createCanvasApiMock(page);
      await page.goto(locale === 'de' ? '/de/canvas/' : '/canvas/');
      await expect(page.locator('#canvasCredits')).toContainText('500');
      const initialRequests = state.requests.length;
      for (const viewport of [{ width: 1440, height: 900 }, { width: 2560, height: 1440 }, { width: 1280, height: 600 }]) {
        await page.setViewportSize(viewport);
        await expect(page.locator('#canvasProjectsPanel')).toBeVisible();
        await expect(page.locator('#canvasInspectorPanel')).toBeVisible();
        const geometry = await page.evaluate(() => {
          const bounds = (selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
          return { docWidth: document.documentElement.scrollWidth, docHeight: document.documentElement.scrollHeight, width: innerWidth, height: innerHeight,
            header: bounds('header'), app: bounds('#canvasApp'), graph: bounds('#canvasViewport'), empty: bounds('#canvasEmpty') };
        });
        expect(geometry.docWidth).toBeLessThanOrEqual(geometry.width + 1);
        expect(geometry.docHeight).toBeLessThanOrEqual(geometry.height + 1);
        expect(Math.abs(geometry.app.y - geometry.header.bottom)).toBeLessThanOrEqual(1);
        expect(Math.abs(geometry.app.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(geometry.app.right - geometry.width)).toBeLessThanOrEqual(1);
        expect(Math.abs(geometry.app.bottom - geometry.height)).toBeLessThanOrEqual(1);
        expect(geometry.graph.bottom).toBeLessThanOrEqual(geometry.height + 1);
        expect(geometry.graph.height).toBeGreaterThan(geometry.height * .55);
        expect(Math.abs(geometry.empty.x + geometry.empty.width / 2 - geometry.graph.x - geometry.graph.width / 2)).toBeLessThanOrEqual(2);
        expect(Math.abs(geometry.empty.y + geometry.empty.height / 2 - geometry.graph.y - geometry.graph.height / 2)).toBeLessThanOrEqual(2);
      }
      await page.locator('#canvasHistoryToggle').click();
      await expect(page.locator('#canvasHistoryPanel')).toBeVisible();
      await expect(page.locator('#canvasInspectorPanel')).toBeHidden();
      await expect(page.locator('#canvasRunHistory')).toContainText(locale === 'de' ? 'Verlauf' : 'history');
      await page.locator('#canvasInspectorToggle').click();
      await expect(page.locator('#canvasInspectorPanel')).toBeVisible();
      await expect(page.locator('#canvasHistoryPanel')).toBeHidden();
      await page.locator('#canvasProjectsToggle').click();
      await expect(page.locator('#canvasProjectsPanel')).toBeHidden();
      await page.locator('#canvasProjectsToggle').press('Enter');
      await expect(page.locator('#canvasProjectsPanel')).toBeVisible();
      expect(state.requests.length).toBe(initialRequests);
      expect(state.requests.filter((request) => request.method !== 'GET')).toEqual([]);
    });
  }

  test('Canvas connection endpoints match the visible node ports in graph coordinates', async ({ page }) => {
    await mockSharedAuth(page, true);
    const state = createCanvasApiMock(page);
    const projectId = '1'.repeat(32), sourceId = '2'.repeat(32), targetId = '3'.repeat(32);
    state.projects.push({ id: projectId, title: 'Port geometry', locale: 'en', created_at: '2026-09-15T10:00:00.000Z', updated_at: '2026-09-15T10:00:00.000Z' });
    state.nodes.push(...[[sourceId, 40, 50], [targetId, 350, 240]].map(([id, x, y]) => ({ id, project_id: projectId, type: 'text_prompt', title: 'Prompt', x, y, model_id: null, config: {}, content: { prompt: 'Synthetic prompt' }, output: null, asset_id: null })));
    state.edges.push({ id: 'e'.repeat(32), project_id: projectId, source_node_id: sourceId, target_node_id: targetId, config: {} });
    await page.goto('/canvas/');
    await expect(page.locator('.canvas-edge')).toHaveCount(1);
    const assertPorts = async () => {
      const geometry = await page.evaluate(({ sourceId, targetId }) => {
        const card = (id) => document.querySelector(`.canvas-node[data-node-id="${id}"]`);
        const center = (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
        const edge = document.querySelector('.canvas-edge');
        const point = (distance) => { const p = edge.getPointAtLength(distance).matrixTransform(edge.getScreenCTM()); return { x: p.x, y: p.y }; };
        return { sourceWidth: card(sourceId).getBoundingClientRect().width, sourceY: card(sourceId).getBoundingClientRect().y,
          start: point(0), end: point(edge.getTotalLength()), out: center(card(sourceId).querySelector('[data-port="out"]')), in: center(card(targetId).querySelector('[data-port="in"]')) };
      }, { sourceId, targetId });
      expect(geometry.sourceWidth).toBe(230);
      expect(Math.abs(geometry.out.y - geometry.sourceY - 59)).toBeLessThanOrEqual(1);
      for (const axis of ['x', 'y']) {
        expect(Math.abs(geometry.start[axis] - geometry.out[axis])).toBeLessThanOrEqual(2);
        expect(Math.abs(geometry.end[axis] - geometry.in[axis])).toBeLessThanOrEqual(2);
      }
    };
    const positions = state.nodes.map(({ id, x, y }) => ({ id, x, y }));
    await assertPorts();
    await page.locator('#canvasViewport').evaluate((viewport) => viewport.scrollTo({ left: 120, top: 90, behavior: 'instant' }));
    await expect(page.locator('#canvasViewport')).toHaveJSProperty('scrollLeft', 120);
    await expect(page.locator('#canvasViewport')).toHaveJSProperty('scrollTop', 90);
    await assertPorts();
    await page.setViewportSize({ width: 2560, height: 1440 });
    await page.locator('#canvasProjectsToggle').click();
    await page.locator('#canvasInspectorToggle').click();
    await expect(page.locator('#canvasProjectsPanel')).toBeHidden();
    await expect(page.locator('#canvasInspectorPanel')).toBeHidden();
    await assertPorts();
    expect(state.nodes.map(({ id, x, y }) => ({ id, x, y }))).toEqual(positions);
    expect(state.requests.filter((request) => request.method !== 'GET')).toEqual([]);
    await page.locator(`.canvas-node[data-node-id="${sourceId}"]`).press('ArrowRight');
    await expect.poll(() => state.nodes.find((node) => node.id === sourceId).x).toBe(50);
    await expect(page.locator('#canvasSaveState')).toHaveAttribute('data-state', 'saved');
    await assertPorts();
    expect(state.nodes.find((node) => node.id === sourceId).y).toBe(50);
    expect(state.requests.filter((request) => request.method !== 'GET')).toEqual([{ method: 'PATCH', pathname: `/api/account/canvas/projects/${projectId}/nodes/${sourceId}` }]);
  });

  for (const locale of ['en', 'de']) {
    test(`Canvas ${locale}: unavailable reads stay distinct from confirmed access denial`, async ({ page }) => {
      await mockSharedAuth(page, true);
      const state = createCanvasApiMock(page);
      for (const status of [401, 403, 503, 'network']) {
        await page.route('**/api/account/canvas/projects', (route) => status === 'network' ? route.abort('failed') : route.fulfill({ status, json: { ok: false, code: status === 503 ? 'unavailable' : 'unauthorized', error: 'Synthetic read failure' } }));
        await page.goto(locale === 'de' ? '/de/canvas/' : '/canvas/');
        await expect(page.locator(status === 401 || status === 403 ? '#canvasDenied' : '#canvasUnavailable')).toBeVisible();
        await expect(page.locator(status === 401 || status === 403 ? '#canvasUnavailable' : '#canvasDenied')).toBeHidden();
        await expect(page.locator('#canvasApp')).toBeHidden();
        expect(state.modelRequests).toBe(0);
        await page.unroute('**/api/account/canvas/projects');
      }
    });
  }

  test('quick workflow creates a connected Text to Image to Video graph with typed readiness', async ({ page }) => {
    await mockSharedAuth(page, true);
    const state = createCanvasApiMock(page);
    await page.goto('/canvas/');
    page.once('dialog', (dialog) => dialog.accept('Quick workflow'));
    await page.locator('#canvasNewProject').click();
    await page.locator('#canvasQuickTextImageVideo').click();
    await expect(page.locator('.canvas-node')).toHaveCount(3);
    await expect(page.locator('.canvas-edge')).toHaveCount(2);
    expect(state.nodes.map((node) => node.type)).toEqual(['text_generation', 'image_generation', 'video_generation']);
    expect(state.edges.map((edge) => [edge.source_node_id, edge.target_node_id])).toEqual([
      [state.nodes[0].id, state.nodes[1].id],
      [state.nodes[1].id, state.nodes[2].id],
    ]);
    await page.locator(`[data-node-id="${state.nodes[1].id}"]`).click();
    await expect(page.locator('.canvas-input-context')).toContainText('Run the upstream node first');
    await expect(page.locator('#canvasInspectorBody').getByRole('button', { name: 'Run', exact: true })).toBeDisabled();
  });

  test('inspector resolves generated text into an image prompt and Output displays latest upstream result', async ({ page }) => {
    await mockSharedAuth(page, true);
    const state = createCanvasApiMock(page);
    const now = new Date().toISOString();
    const project = { id: '11111111111111111111111111111111', title: 'Resolved flow', locale: 'en', thumbnail_asset_id: null, created_at: now, updated_at: now };
    const textId = '22222222222222222222222222222222';
    const imageId = '33333333333333333333333333333333';
    const outputId = '44444444444444444444444444444444';
    state.projects.push(project);
    state.nodes.push(
      { id: textId, project_id: project.id, type: 'text_generation', title: 'Prompt writer', x: 50, y: 50, model_id: '@cf/meta/llama-3.1-8b-instruct', config: { prompt: 'Improve it' }, content: {}, output: { kind: 'text', text: 'A cinematic glass city at blue hour.' }, asset_id: null, created_at: now, updated_at: now },
      { id: imageId, project_id: project.id, type: 'image_generation', title: 'Image', x: 350, y: 50, model_id: '@cf/black-forest-labs/flux-1-schnell', config: { prompt: '' }, content: {}, output: null, asset_id: null, created_at: now, updated_at: now },
      { id: outputId, project_id: project.id, type: 'output_result', title: 'Output', x: 650, y: 50, model_id: null, config: {}, content: {}, output: null, asset_id: null, created_at: now, updated_at: now },
    );
    state.edges.push(
      { id: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', project_id: project.id, source_node_id: textId, target_node_id: imageId, label: null, config: {}, created_at: now, updated_at: now },
      { id: 'ffffffffffffffffffffffffffffffff', project_id: project.id, source_node_id: textId, target_node_id: outputId, label: null, config: {}, created_at: now, updated_at: now },
    );
    await page.goto('/canvas/');
    await page.locator(`[data-node-id="${imageId}"]`).click();
    await expect(page.locator('.canvas-input-context')).toContainText('Connected input');
    await expect(page.locator('.canvas-input-context')).toContainText('A cinematic glass city at blue hour.');
    await expect(page.locator('#canvasInspectorBody').getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
    await page.locator(`[data-node-id="${outputId}"]`).click();
    await expect(page.locator('.canvas-output pre')).toHaveText('A cinematic glass city at blue hour.');
  });
});

for (const locale of ['en', 'de']) test(`${locale}: Canvas dimension dropdowns normalize restored values and preserve outputs`, async ({ page }) => {
  const { listCanvasModelsForRole } = await import('../js/shared/canvas-model-contract.mjs');
  const { sortGenerationModels } = await import('../js/shared/generation-model-order.mjs');
  const models = listCanvasModelsForRole('user');
  await mockSharedAuth(page);
  const state = createCanvasApiMock(page, { modelPayload: { models, organizations: [], access: { role: 'user' } } });
  const project = { id: '1'.repeat(32), title: 'Dimension fixture', locale };
  state.projects.push(project);
  state.nodes.push({ id: '2'.repeat(32), project_id: project.id, type: 'image_generation', title: 'Retained image', x: 30, y: 30,
    model_id: '@cf/black-forest-labs/flux-2-klein-9b', config: { prompt: 'Keep this prompt', width: 2048, height: 257 }, content: {}, output: { kind: 'image', url: '/assets/logo.png' } });
  const originalOutput = structuredClone(state.nodes[0].output);
  await page.goto(`${locale === 'de' ? '/de' : ''}/canvas/`);
  await page.locator('[data-node-id="'+state.nodes[0].id+'"]').click();
  const inspector = page.locator('#canvasInspectorBody');
  const model = inspector.getByRole('combobox', { name: locale === 'de' ? 'Modell' : 'Model', exact: true });
  // Public availability excludes the retired Flux 2 Dev and original Grok Image.
  // Verify membership independently, including missing/duplicate/substitution controls.
  await require('./helpers/generation-selectors.cjs').assertModelOptions(model, expect, [
    '@cf/black-forest-labs/flux-1-schnell', '@cf/black-forest-labs/flux-2-klein-9b',
    'black-forest-labs/flux-2-max', 'openai/gpt-image-2', 'openai/gpt-image-2.5-flare',
    'openai/gpt-image-2.5-sunburst', 'xai/grok-imagine-image-2.0',
  ]);
  const width = inspector.getByRole('combobox', { name: locale === 'de' ? 'Breite' : 'Width', exact: true });
  const height = inspector.getByRole('combobox', { name: locale === 'de' ? 'Höhe' : 'Height', exact: true });
  await expect(width.locator('option')).toHaveText(['256','512','768','1024']);
  await expect(width).toHaveValue('1024'); await expect(height).toHaveValue('1024');
  await width.selectOption('768'); await height.selectOption('512');
  await expect.poll(() => state.nodes[0].config).toMatchObject({ width: 768, height: 512, prompt: 'Keep this prompt' });
  await page.reload(); await page.locator('[data-node-id="'+state.nodes[0].id+'"]').click();
  await expect(width).toHaveValue('768'); await expect(height).toHaveValue('512');
  expect(state.nodes[0].output).toEqual(originalOutput);
  expect(state.runs).toEqual([]);
});

for (const locale of ['en', 'de']) test(`${locale}: admin Canvas uses registry options and clean estimates; token defaults preserve explicit edits and save retries keep identity`, async ({ page }, testInfo) => {
  const { listCanvasModelsForRole,estimateCanvasTextCredits,getCanvasTextInstructions } = await import('../js/shared/canvas-model-contract.mjs');
  const models = listCanvasModelsForRole('admin');
  const org = 'org_'+'a'.repeat(32);
  await mockSharedAuth(page, true, 'admin');
  const state = createCanvasApiMock(page, { modelPayload: { models, organizations: [{ id: org, name: 'Synthetic organization', role: 'owner' }], selected_organization_id: org, access: { role: 'admin', is_admin: true } } });
  const now = new Date().toISOString(), project = { id: '1'.repeat(32), title: 'Admin contract fixture', locale, created_at: now, updated_at: now };
  state.projects.push(project);
  const text = models.find(m => m.capability === 'text');
  state.nodes.push({ id: '2'.repeat(32), project_id: project.id, type: 'text_generation', title: 'Text', x: 30, y: 30, model_id: text.id, config: { prompt: 'Synthetic prompt', maxTokens: text.controls.maxTokens.default }, content: {}, output: null });
  await page.goto(locale === 'de' ? '/de/canvas/' : '/canvas/');
  await page.locator('[data-node-id="'+state.nodes[0].id+'"]').click();
  const inspector = page.locator('#canvasInspectorBody');
  const modelSelect = inspector.getByRole('combobox', { name: locale === 'de' ? 'Modell' : 'Model', exact: true });
  const tokens = inspector.getByLabel(locale === 'de' ? 'Max. Tokens' : 'Max tokens', { exact: true });
  await expect(inspector.locator('.canvas-cost-note')).toHaveText(`${locale === 'de' ? 'Geschätzte Credits' : 'Estimated credits'}: ${estimateCanvasTextCredits(text.id,{...state.nodes[0].config,systemPrompt:getCanvasTextInstructions(state.nodes[0].config)})}`);
  await expect(modelSelect.locator('option')).toHaveCount(models.filter(m => m.capability === 'text').length);
  await modelSelect.selectOption('@cf/openai/gpt-oss-120b');
  await expect(tokens).toHaveValue('500');
  await tokens.fill('777'); await tokens.press('Tab');
  await modelSelect.selectOption('@cf/google/gemma-4-26b-a4b-it');
  await expect(tokens).toHaveValue('777');
  await page.locator('#canvasNodeType').selectOption('image_generation');
  await page.locator('#canvasAddNode').click();
  const imageNode = state.nodes.at(-1);
  await expect(inspector.locator('.canvas-cost-note')).toHaveText(new RegExp(`^${locale === 'de' ? 'Geschätzte Credits' : 'Estimated credits'}: [0-9]+$`));
  await expect(inspector.getByLabel(locale === 'de' ? 'Schritte' : 'Steps', { exact: true })).toBeVisible();
  await expect(inspector.getByLabel(locale === 'de' ? 'Breite' : 'Width', { exact: true })).toHaveCount(0);
  await modelSelect.selectOption('openai/gpt-image-2');
  await expect(inspector.getByRole('combobox', { name: locale === 'de' ? 'Qualität' : 'Quality', exact: true })).toBeVisible();
  await expect(inspector.getByLabel(locale === 'de' ? 'Schritte' : 'Steps', { exact: true })).toHaveCount(0);
  await inspector.locator('.canvas-additional-prompt > summary').click();
  await inspector.getByLabel(locale==='de'?'Zusätzlicher Prompt':'Additional prompt', { exact: true }).fill('Synthetic image prompt');
  const calls = [];
  await page.route('**/nodes/*/run', async route => {
    calls.push({ key: route.request().headers()['idempotency-key'], body: route.request().postDataJSON() });
    const run = { id: '3'.repeat(32), node_id: imageNode.id, status: 'failed', error_code: 'canvas_image_save_pending', retry_key: calls[0].key, created_at: now };
    state.runs = [run];
    await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ ok: false, code: run.error_code, data: { run } }) });
  });
  const runButton = inspector.getByRole('button', { name: locale === 'de' ? 'Ausführen' : 'Run', exact: true });
  await runButton.click();
  await expect(page.locator('#canvasToast')).toContainText(locale === 'de' ? 'Speichern ausstehend' : 'saving is pending');
  await page.reload(); await page.locator('[data-node-id="'+imageNode.id+'"]').click();
  await runButton.click(); await expect.poll(() => calls.length).toBe(2);
  expect(calls[1]).toEqual(calls[0]); expect(calls[0].body.organization_id).toBe(org);
  await page.screenshot({ path: testInfo.outputPath(`admin-canvas-${locale}.png`) });
});

test('Canvas video continuation methods follow connected adapters, role and changed source identity', async () => {
  const {resolveCanvasVideoInput}=await import('../js/shared/canvas-video-input.mjs');
  const {getCanvasModelForRole}=await import('../js/shared/canvas-model-contract.mjs');
  const source={kind:'video_asset',assetId:'owned-video',runId:'run-1'};
  const {applyCanvasVideoInput}=await import('../workers/auth/src/lib/canvas-video-input.js');
  const frame={imageId:'owned-frame',version:'original-version',previewUrl:'/api/ai/images/owned-frame/file'};
  for (const role of ['user','admin']) for (const id of ['pixverse/v6','xai/grok-imagine-video','xai/grok-imagine-video-1.5-preview']) {
    const model=getCanvasModelForRole(id,role);
    expect(model.runnable).toBe(true);
    if(id.startsWith('xai/')) expect(model.controls.availableOperations).toEqual(['generate']);
    expect(resolveCanvasVideoInput(model,source)).toMatchObject({methods:['last_frame'],method:'last_frame',invalidMethod:false,frame:null,sourceVersion:null});
    for (const method of ['edit','extend']) {
      const saved={videoInput:{modelId:id,assetId:source.assetId,runId:source.runId,method,frame,sourceVersion:'original-version'}};
      expect(resolveCanvasVideoInput(model,source,saved)).toMatchObject({methods:['last_frame'],method:null,invalidMethod:true,frame:null});
      expect(saved.videoInput).toEqual({modelId:id,assetId:source.assetId,runId:source.runId,method,frame,sourceVersion:'original-version'});
      await expect(applyCanvasVideoInput({},'owner',{videoReferences:[{...source,videoInput:resolveCanvasVideoInput(model,source,saved)}]}, {model:id},()=>{throw new Error('Unexpected image load');})).rejects.toMatchObject({code:'video_method_invalid'});
    }
    const saved={videoInput:{modelId:id,assetId:source.assetId,runId:source.runId,method:'last_frame',frame,sourceVersion:'original-version'}};
    expect(resolveCanvasVideoInput(model,source,saved)).toMatchObject({method:'last_frame',invalidMethod:false,frame,sourceVersion:'original-version'});
    for(const next of [{model,source:{...source,runId:'run-2'}},{model,source:{...source,assetId:'other-video'}},{model:{...model,id:'different-adapter'},source}]) {
      expect(resolveCanvasVideoInput(next.model,next.source,saved)).toMatchObject({method:'last_frame',invalidMethod:false,frame:null,sourceVersion:null});
    }
    expect(resolveCanvasVideoInput({...model,runnable:false},source).methods).toEqual([]);
    expect(resolveCanvasVideoInput({...model,controls:{}},source).methods).toEqual([]);
  }
  const h3=getCanvasModelForRole('minimax/h3','user');
  expect(resolveCanvasVideoInput(h3,source)).toMatchObject({methods:['reference_video','last_frame'],method:'reference_video',frame:null});
  const selected={videoInput:{modelId:h3.id,assetId:source.assetId,runId:source.runId,method:'last_frame',frame,sourceVersion:'original-version'}};
  expect(resolveCanvasVideoInput(h3,source,selected)).toMatchObject({method:'last_frame',frame});
  for(const replacement of [{...source,runId:'new-run'},{...source,assetId:'new-original'}])
    expect(resolveCanvasVideoInput(h3,replacement,selected)).toMatchObject({method:'last_frame',frame:null,sourceVersion:null});
  // Explicit synthetic verified capabilities exercise the multi-method branch;
  // real Grok catalogs above remain Generate-only pending billing evidence.
  const verified={id:'synthetic-verified-adapter',capability:'video',runnable:true,controls:{supportsImageInput:true,nativeVideoInput:true,supportsVideoInput:true,supportedOperations:['generate','edit','extend'],availableOperations:['generate','edit','extend']}};
  expect(resolveCanvasVideoInput(verified,source)).toMatchObject({methods:['last_frame','edit','extend'],method:null,invalidMethod:false});
  for(const method of ['edit','extend']) {
    const saved={videoInput:{modelId:verified.id,assetId:source.assetId,runId:source.runId,method,sourceVersion:'original-version',frame}};
    expect(resolveCanvasVideoInput(verified,source,saved)).toMatchObject({method,sourceVersion:'original-version',frame:null});
    for(const changed of [{...source,runId:'new-run'},{...source,assetId:'new-asset'}]) expect(resolveCanvasVideoInput(verified,changed,saved)).toMatchObject({method:null,sourceVersion:null,frame:null});
    expect(resolveCanvasVideoInput({...verified,id:'other-adapter'},source,saved)).toMatchObject({method:null,sourceVersion:null,frame:null});
  }
});

test('Canvas video continuation decodes the actual short last frame; rejects errors, timeout and foreign URL', async ({page},testInfo) => {
  await mockSharedAuth(page,false);
  createCanvasApiMock(page,{authenticated:false});
  const video=fs.readFileSync(path.join(__dirname,'fixtures/media/canvas-end-frame.mp4'));
  await page.route('**/api/ai/text-assets/fixture/file',route=>route.fulfill({status:200,contentType:'video/mp4',body:video}));
  await page.route('**/api/ai/text-assets/broken/file',route=>route.fulfill({status:200,contentType:'video/mp4',body:'not a video'}));
  await page.goto('/canvas/');
  const result=await page.evaluate(async()=>{
    const {extractCanvasLastFrame}=await import('/js/pages/canvas/video-frame.js');
    const frame=await extractCanvasLastFrame('/api/ai/text-assets/fixture/file');
    const image=new Image();image.src=frame.imageData;await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    canvas.getContext('2d').drawImage(image,0,0);
    const pixel=Array.from(canvas.getContext('2d').getImageData(32,24,1,1).data);
    const failures=[];
    for(const [url,options] of [['/api/ai/text-assets/broken/file',{}],['https://foreign.invalid/private.mp4',{}],['/api/ai/text-assets/fixture/file',{timeoutMs:1}]]) {
      try{await extractCanvasLastFrame(url,options);failures.push('unexpected-success');}catch(e){failures.push(e.message);}
    }
    return {pixel,width:frame.width,height:frame.height,duration:frame.duration,failures,remaining:document.querySelectorAll('video[aria-hidden="true"]').length};
  });
  expect(result.width).toBe(64);expect(result.height).toBe(48);expect(result.duration).toBeCloseTo(.4,2);
  expect(result.pixel[2]).toBeGreaterThan(230);expect(result.pixel[2] - result.pixel[0]).toBeGreaterThan(180);
  expect(result.failures).toEqual(['video_frame_decode_failed','video_source_unavailable','video_frame_cancelled_or_timeout']);
  expect(result.remaining).toBe(0);
  await testInfo.attach('decoded-last-frame',{body:JSON.stringify(result),contentType:'application/json'});
});

for(const locale of ['en','de']) for(const family of ['pixverse','h3']) test(`Canvas video continuation ${locale} ${family}: last frame, real decoded frame, reload and one run`,async({page},testInfo)=>{
  await mockSharedAuth(page,true);
  const h3=family==='h3', model=h3?'minimax/h3':'pixverse/v6';
  const { listCanvasModelsForRole } = await import('../js/shared/canvas-model-contract.mjs');
  const state=createCanvasApiMock(page,{modelPayload:{models:listCanvasModelsForRole(locale==='de'?'admin':'user'),organizations:[],access:{role:locale==='de'?'admin':'user'}}}),projectId='1'.repeat(32),src='a'.repeat(32),dest='b'.repeat(32),edgeId='c'.repeat(32),now=new Date().toISOString();
  state.projects.push({id:projectId,title:'Video continuation',locale,created_at:now,updated_at:now});
  state.nodes.push({id:src,project_id:projectId,type:'video_generation',title:'Source clip',x:30,y:30,model_id:'pixverse/v6',config:{},content:{},asset_id:'fixture',output:{kind:'video',runId:'source-run',asset:{id:'fixture',asset_type:'video',mime_type:'video/mp4',file_url:'/api/ai/text-assets/fixture/file'}}},
    {id:dest,project_id:projectId,type:'video_generation',title:'Next clip',x:350,y:30,model_id:model,config:{prompt:'Continue the scene',...(h3?{duration:4,resolution:'768P'}:{duration:2,quality:'720p',generateAudio:false})},content:{}});
  state.edges.push({id:edgeId,project_id:projectId,source_node_id:src,target_node_id:dest,config:{}});
  await page.route('**/api/ai/text-assets/fixture/file',route=>route.fulfill({status:200,contentType:'video/mp4',body:fs.readFileSync(path.join(__dirname,'fixtures/media/canvas-end-frame.mp4'))}));
  let uploads=0,generated=0,attachments=0,reads=0,lastImage;
  await page.route(`**/api/account/canvas/projects/${projectId}/edges/${edgeId}`,async route=>{
    const body=route.request().postDataJSON();state.edges[0].config=body.config;
    if(body.frame_image) expect(body.config.videoInput.sourceVersion).toBe('synthetic-version');
    state.edges[0].config.videoInput.sourceVersion='synthetic-version';
    if(body.frame_image){uploads++;lastImage=body.frame_image;state.edges[0].config.videoInput.frame={imageId:'frame',version:'synthetic-version',previewUrl:'/api/ai/images/frame/file'};}
    await route.fulfill({json:{ok:true,data:{edge:state.edges[0]}}});
  });
  await page.route('**/api/ai/images/frame/file',route=>route.fulfill({status:200,contentType:'image/png',body:Buffer.from(lastImage.split(',')[1],'base64')}));
  await page.route(`**/api/account/canvas/projects/${projectId}/nodes/${dest}/run`,async route=>{
    expect(state.edges[0].config.videoInput.method).toBe('last_frame');
    if (!generated) {
      generated++;
      state.runs.push({id:'d'.repeat(32),project_id:projectId,node_id:dest,status:'running',error_code:'canvas_video_pending',retry_key:route.request().headers()['idempotency-key'],video_job_id:'fixture-job',model_id:'pixverse/v6',created_at:now,updated_at:now});
      return route.fulfill({status:202,json:{ok:false,code:'canvas_video_pending',data:{video_job_id:'fixture-job',run:state.runs[0]}}});
    }
    attachments++;
    expect(reads).toBe(1);
    await route.fulfill({json:{ok:true,data:{run:{id:'d'.repeat(32),node_id:dest,status:'completed',asset_id:'new-video',output:{kind:'video',assetId:'new-video'},created_at:now}}}});
  });
  await page.route('**/api/ai/generation-jobs/fixture-job', async route => {
    expect(route.request().method()).toBe('GET'); reads++;
    await route.fulfill({json:{ok:true,data:{job:{id:'fixture-job',status:'preview_pending'}}}});
  });
  await page.goto(locale==='de'?'/de/canvas/':'/canvas/');
  await page.locator(`[data-node-id="${dest}"]`).first().click();
  const inspector=page.locator('#canvasInspectorBody');
  const selector=inspector.getByRole('combobox',{name:locale==='de'?'Video weiterverwenden':'Reuse video'});
  const method=h3?selector:inspector.locator('strong').filter({hasText:locale==='de'?'Letztes Frame als Startbild':'Last frame as start image'});
  if(h3) {
    await expect(selector).toHaveValue('reference_video');expect(uploads).toBe(0);
    expect(await selector.locator('option').evaluateAll(items=>items.map(item=>item.value))).toEqual(['','reference_video','last_frame']);
    await page.reload();await page.locator(`[data-node-id="${dest}"]`).first().click();await expect(selector).toHaveValue('reference_video');
    await selector.selectOption('last_frame');
    await expect.poll(()=>state.nodes.find(n=>n.id===dest).config.aspectRatio).toBe('adaptive');
  }
  const run=inspector.getByRole('button',{name:locale==='de'?'Ausführen':'Run',exact:true});
  await expect(method).toBeVisible();
  await expect(selector).toHaveCount(h3?1:0);
  const {calculateAiVideoCreditCost}=await import('../js/shared/ai-model-pricing.mjs');
  await expect(inspector.locator('.canvas-cost-note')).toContainText(String(h3?calculateAiVideoCreditCost(model,{duration:4,resolution:'768P'}).credits:56));
  await expect(inspector.locator('img[alt]')).toHaveAttribute('src','/api/ai/images/frame/file');
  await expect(run).toBeEnabled();expect(uploads).toBe(1);
  if(h3) { await expect(selector).toBeEnabled(); await expect(selector).toBeFocused(); }
  const pixel=await page.evaluate(async data=>{const i=new Image();i.src=data;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;c.getContext('2d').drawImage(i,0,0);return Array.from(c.getContext('2d').getImageData(32,24,1,1).data);},lastImage);
  expect(pixel[2]).toBeGreaterThan(230);
  await page.reload();await page.locator(`[data-node-id="${dest}"]`).first().click();await expect(method).toBeVisible();expect(uploads).toBe(1);
  await run.click();await expect.poll(()=>generated).toBe(1);
  await expect(run).toBeDisabled();
  await page.locator(`[data-node-id="${src}"]`).first().click();
  await page.locator(`[data-node-id="${dest}"]`).first().click();
  await expect(run).toBeDisabled();
  await expect(page.locator('#canvasNodeRunStatus')).not.toBeEmpty();
  await page.reload();
  await page.locator(`[data-node-id="${dest}"]`).first().click();
  await expect(run).toBeDisabled();
  await expect.poll(()=>attachments,{timeout:10000}).toBe(1);
  expect(generated).toBe(1);expect(reads).toBe(1);expect(uploads).toBe(1);
  await page.locator(`[data-node-id="${dest}"]`).first().click();
  await expect(method).toBeVisible();
  await run.focus();await expect(run).toBeFocused();
  await inspector.getByRole('img',{name:locale==='de'?'Letztes Frame als Startbild':'Last frame as start image'}).scrollIntoViewIfNeeded();
  await page.screenshot({path:testInfo.outputPath(`video-continuation-${family}-${locale}.png`)});
  await page.setViewportSize({width:390,height:844});
  await page.locator('#canvasInspectorToggle').click();
  await expect(method).toBeVisible();
  await inspector.getByRole('img',{name:locale==='de'?'Letztes Frame als Startbild':'Last frame as start image'}).scrollIntoViewIfNeeded();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath(`video-continuation-${family}-${locale}-mobile.png`)});
});

for (const locale of ['en', 'de']) test(`Canvas durable video status ${locale}: pending observation, unknown and failure survive selection and reload`, async ({ page }, testInfo) => {
  await mockSharedAuth(page);
  const state = createCanvasApiMock(page), projectId = '1'.repeat(32), nodeId = 'b'.repeat(32), now = new Date().toISOString();
  state.projects.push({ id: projectId, title: 'Durable video', locale, created_at: now, updated_at: now });
  state.nodes.push({ id: nodeId, project_id: projectId, type: 'video_generation', title: 'Accepted clip', x: 30, y: 30, model_id: 'pixverse/v6', config: { prompt: 'Synthetic clip' }, content: {} });
  const run = { id: 'd'.repeat(32), project_id: projectId, node_id: nodeId, status: 'running', error_code: 'canvas_video_pending', video_job_status: 'processing', video_job_id: 'status-job', retry_key: 'accepted-identity', model_id: 'pixverse/v6', created_at: now, updated_at: now };
  state.runs.push(run);
  let jobStatus = 'processing', reads = 0, attachments = 0;
  await page.route('**/api/ai/generation-jobs/status-job', async route => {
    reads++;
    await route.fulfill({ json: { ok: true, data: { job: { id: 'status-job', status: jobStatus } } } });
  });
  await page.route(`**/nodes/${nodeId}/run`, async route => {
    attachments++;
    expect(route.request().headers()['idempotency-key']).toBe('accepted-identity');
    expect(['outcome_unknown', 'failed']).toContain(jobStatus);
    Object.assign(run, { status: 'failed', error_code: 'canvas_video_review_required', video_job_status: jobStatus });
    await route.fulfill({ status: 409, json: { ok: false, code: run.error_code, data: { run } } });
  });
  await page.clock.install();
  await page.goto(locale === 'de' ? '/de/canvas/' : '/canvas/');
  const card = page.locator(`[data-node-id="${nodeId}"]`).first();
  await card.click();
  const button = page.locator('#canvasInspectorBody').getByRole('button', { name: locale === 'de' ? 'Ausführen' : 'Run', exact: true });
  await expect(button).toBeDisabled();
  await expect(page.locator('#canvasNodeRunStatus')).toContainText(locale === 'de' ? 'erzeugt' : 'Generating');
  const prompt = page.locator('#canvasInspectorBody textarea').first();
  await prompt.fill('Retained draft');
  // Advance only the test clock; no real ten-minute wait or new provider call.
  for (let i = 0; i < 120; i++) {
    jobStatus = i % 2 ? 'ingesting' : 'processing';
    await page.clock.runFor(5000);
    await expect.poll(() => reads).toBe(i + 1);
    await expect(prompt).toHaveValue('Retained draft');
    await expect(prompt).toBeFocused();
  }
  await expect(page.locator('#canvasNodeRunStatus')).toContainText(locale === 'de' ? 'Statusabruf beendet' : 'observation ended');
  await expect(button).toBeDisabled(); expect(attachments).toBe(0);
  await page.reload(); await card.click();
  await expect(button).toBeDisabled();
  jobStatus = 'outcome_unknown';
  await page.clock.runFor(5000);
  await expect.poll(() => attachments).toBe(1);
  await expect(page.locator('#canvasNodeRunStatus')).toContainText(locale === 'de' ? 'ungeklärt' : 'unresolved');
  await expect(button).toBeDisabled();
  await page.reload(); await card.click();
  await expect(page.locator('#canvasNodeRunStatus')).toContainText(locale === 'de' ? 'ungeklärt' : 'unresolved');
  await expect(button).toBeDisabled(); expect(attachments).toBe(1);
  await expect(card.locator('.canvas-node__status')).toHaveText(locale === 'de' ? 'Prüfung erforderlich' : 'Review required');
  await page.locator('#canvasNodeRunStatus').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath(`durable-${locale}-desktop.png`) });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#canvasInspectorToggle').click();
  await expect(button).toBeDisabled();
  await page.locator('#canvasNodeRunStatus').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath(`durable-${locale}-mobile.png`) });
  await page.setViewportSize({ width: 1440, height: 900 });
  Object.assign(run, { video_job_status: 'failed', error_message: 'Synthetic terminal provider failure' });
  await page.reload(); await card.click();
  await expect(page.locator('#canvasNodeRunStatus')).toContainText(locale === 'de' ? 'Videoverarbeitung fehlgeschlagen' : 'Video processing failed');
  await expect(button).toBeDisabled(); expect(attachments).toBe(1);
  Object.assign(run, { error_code: 'canvas_video_rejected', video_job_status: 'failed', video_job_id: null, retry_key: null, error_message: null });
  await page.reload(); await card.click();
  await expect(page.locator('#canvasNodeRunStatus')).toContainText(locale === 'de' ? 'reservierten Credits wurden freigegeben' : 'Reserved credits were released');
  await expect(button).toBeEnabled(); expect(attachments).toBe(1);
});

function currentMergeFixture(state, nodeId, now) {
  const endpoint=state.nodes.find(node=>node.id===nodeId),source={...structuredClone(endpoint),id:'c'.repeat(32),title:'Earlier clip',x:400,output:{...endpoint.output,runId:'b'.repeat(32),assetId:'earlier',sourceVersion:'b'.repeat(64),asset:{id:'earlier',file_url:'/api/ai/text-assets/earlier/file'}},asset_id:'earlier'};
  endpoint.output.sourceVersion='a'.repeat(64);state.nodes.push(source);
  state.edges.push({id:'d'.repeat(32),project_id:endpoint.project_id,source_node_id:source.id,target_node_id:endpoint.id,config:{}});
  const availableClips=[source,endpoint].map(node=>({nodeId:node.id,title:node.title,runId:node.output.runId,assetId:node.output.assetId,version:node.output.sourceVersion,modelId:node.model_id,createdAt:now}));
  return {availableClips,orderedClips:availableClips.map(({runId,assetId,version})=>({runId,assetId,version}))};
}

for (const locale of ['en','de']) test(`Canvas full video ${locale}: durable export, private poster and reload`, async ({page},testInfo) => {
  await page.setViewportSize(locale==='de'?{width:390,height:844}:{width:1440,height:900});
  await mockSharedAuth(page);
  const state=createCanvasApiMock(page), projectId='1'.repeat(32),nodeId='2'.repeat(32),runId='3'.repeat(32),now=new Date().toISOString();
  const output={kind:'video',runId,assetId:'original',asset:{id:'original',file_url:'/api/ai/text-assets/original/file'},posterStatus:'pending'};
  state.projects=[{id:projectId,title:'Private synthetic chain',locale,created_at:now,updated_at:now}];
  state.nodes=[{id:nodeId,project_id:projectId,type:'video_generation',model_id:'pixverse/v6',title:'Clip 2',x:100,y:100,config:{prompt:'Synthetic clip'},content:{},output,asset_id:'original',created_at:now,updated_at:now}];
  state.runs=[{id:runId,node_id:nodeId,project_id:projectId,status:'completed',output,asset_id:'original',created_at:now,updated_at:now}];
  const merge=currentMergeFixture(state,nodeId,now);
  let posts=0, task=null;
  await page.route('**/api/account/canvas/**/full-video',route=>{
    if(route.request().method()==='POST'){posts++;expect(route.request().postDataJSON()).toEqual({backgroundMusic:{enabled:false,gain:1,fadeIn:0,fadeOut:0},orderedClips:merge.orderedClips,mergeMode:'chain'});expect(route.request().headers()['idempotency-key']).toBeTruthy();task={id:'export',status:'queued'};}
    return route.fulfill({json:{ok:true,data:{eligible:true,export:task,availableClips:merge.availableClips}}});
  });
  await page.route('**/api/ai/text-assets/*/file',route=>route.fulfill({contentType:'video/mp4',body:fs.readFileSync(path.join(__dirname,'fixtures/media/canvas-end-frame.mp4'))}));
  await page.route('**/api/ai/text-assets/*/poster',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#314760"/></svg>'}));
  const open=async()=>{await page.goto(locale==='de'?'/de/canvas/':'/canvas/');await page.locator(`[data-node-id="${nodeId}"]`).first().click();if(locale==='de')await page.locator('#canvasInspectorToggle').click();};
  await open();const inspector=page.locator('#canvasInspectorBody');
  const create=inspector.getByRole('button',{name:locale==='de'?'Gesamtes Video erstellen':'Create full video',exact:true});
  await expect(create).toBeVisible();await create.focus();await page.keyboard.press('Enter');
  await expect(inspector.locator('.canvas-full-video').getByRole('status', { name: locale === 'de' ? 'Exportstatus' : 'Export status', exact: true })).toContainText(locale==='de'?'wartet':'queued');expect(posts).toBe(1);
  task={id:'export',status:'preview_pending',asset:{id:'full',file_url:'/api/ai/text-assets/full/file',poster_url:null}};
  output.previewUrl='/api/ai/text-assets/original/poster';output.posterStatus='ready';
  await inspector.getByRole('button',{name:locale==='de'?'Status aktualisieren':'Refresh status',exact:true}).click();
  await expect(inspector.locator('video')).toHaveCount(2);await expect(inspector.locator('video').first()).toHaveAttribute('poster',output.previewUrl);
  const full=inspector.locator('video').nth(1);await expect(full).toHaveAttribute('src',task.asset.file_url);
  const identity=await full.evaluate(el=>{el.dataset.identity='retained';return el.dataset.identity;});
  await inspector.getByRole('button',{name:locale==='de'?'Status aktualisieren':'Refresh status',exact:true}).click();
  await expect(full).toHaveAttribute('data-identity',identity);
  task.status='ready';task.asset.poster_url='/api/ai/text-assets/full/poster';
  await open();await expect(inspector.locator('video').nth(1)).toHaveAttribute('poster',task.asset.poster_url);
  await expect(inspector.getByRole('link',{name:locale==='de'?'Gesamtvideo herunterladen':'Download full video'})).toHaveAttribute('href',task.asset.file_url+'?download=1');
  expect(posts).toBe(1);expect(state.requests.filter(r=>r.method!=='GET')).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await inspector.locator('.canvas-full-video').scrollIntoViewIfNeeded();
  await page.screenshot({path:testInfo.outputPath(`canvas-full-video-${locale}.png`)});
});

for(const locale of ['en','de']) test(`Canvas full video ordered clips ${locale}: existing reference-only Seedance, failure, keyboard and reload`,async({page},testInfo)=>{
  const de=locale==='de';await page.setViewportSize(de?{width:390,height:844}:{width:1440,height:900});await mockSharedAuth(page);
  const state=createCanvasApiMock(page),projectId='1'.repeat(32),nodeId='2'.repeat(32),runId='3'.repeat(32),priorId='4'.repeat(32),now=new Date().toISOString();
  const output={kind:'video',runId,assetId:'original',sourceVersion:'a'.repeat(64),previewUrl:'/api/ai/text-assets/original/poster',asset:{id:'original',file_url:'/api/ai/text-assets/original/file'}};
  state.projects=[{id:projectId,title:'Existing clips',locale,created_at:now,updated_at:now}];
  state.nodes=[{id:nodeId,project_id:projectId,type:'video_generation',model_id:'bytedance/seedance-2.5',title:'Seedance result',x:100,y:100,config:{prompt:'Synthetic retained draft'},content:{},output,asset_id:'original',created_at:now,updated_at:now}];
  state.runs=[{id:runId,node_id:nodeId,project_id:projectId,status:'completed',input:{used_sources:[{runId:priorId}],generation:{references:[{role:'reference_video'}]}},output,asset_id:'original',created_at:now,updated_at:now}];
  const availableClips=[{nodeId,title:'Seedance result',runId,assetId:'original',version:'a'.repeat(64),modelId:'bytedance/seedance-2.5',createdAt:now},{nodeId:'5'.repeat(32),title:'Forest',runId:priorId,assetId:'h3',version:'b'.repeat(64),modelId:'minimax/h3',createdAt:now}];
  state.nodes.push({...structuredClone(state.nodes[0]),id:'5'.repeat(32),title:'Forest',model_id:'minimax/h3',x:400,asset_id:'h3',output:{...output,runId:priorId,assetId:'h3',sourceVersion:'b'.repeat(64),asset:{id:'h3',file_url:'/api/ai/text-assets/h3/file'}}});
  const originalState=JSON.stringify([state.nodes,state.edges,state.runs]);let reject=true,posts=0,task=null;
  await page.route('**/api/account/canvas/**/full-video',route=>{
    if(route.request().method()==='POST'){
      posts++;const body=route.request().postDataJSON();expect(body).toEqual({backgroundMusic:{enabled:false,gain:1,fadeIn:0,fadeOut:0},orderedClips:[1,0].map(i=>{const{runId,assetId,version}=availableClips[i];return{runId,assetId,version};})});expect(route.request().headers()['idempotency-key']).toBeTruthy();
      if(reject)return route.fulfill({status:409,json:{ok:false,code:'video_source_changed'}});
      task={id:'export',status:'queued',recipe:{version:2,spatialPolicy:'center-crop-v1',sequence:'explicit',videos:body.orderedClips}};
    }
    return route.fulfill({json:{ok:true,data:{eligible:Boolean(task),clips:1,availableClips,export:task}}});
  });
  await page.route('**/api/ai/text-assets/*/file',route=>route.fulfill({contentType:'video/mp4',body:fs.readFileSync(path.join(__dirname,'fixtures/media/canvas-end-frame.mp4'))}));
  await page.route('**/api/ai/text-assets/*/poster',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"/>'}));
  const open=async()=>{await page.goto(de?'/de/canvas/':'/canvas/');await page.locator(`[data-node-id="${nodeId}"]`).first().press('Enter');if(de)await page.locator('#canvasInspectorToggle').click();};
  await open();const block=page.locator('.canvas-full-video'),sequence=block.getByRole('group',{name:de?'Clips zusammenfügen':'Merge clips'}),create=block.getByRole('button',{name:de?'Gesamtes Video erstellen':'Create full video',exact:true});
  await expect(sequence).toBeVisible();await expect(create).toBeDisabled();expect(posts).toBe(0);
  await sequence.getByLabel('Clip 1',{exact:true}).selectOption(priorId);await expect(create).toBeEnabled();
  await sequence.getByRole('button',{name:de?'Nach unten: Clip 1':'Move down: Clip 1',exact:true}).focus();await page.keyboard.press('Enter');
  await expect(sequence.getByLabel('Clip 1',{exact:true})).toHaveValue(runId);
  await sequence.getByRole('button',{name:de?'Nach oben: Clip 2':'Move up: Clip 2',exact:true}).click();
  await create.focus();await page.keyboard.press('Enter');await expect(block.getByRole('status',{name:de?'Exportstatus':'Export status',exact:true})).toContainText('video_source_changed');expect(posts).toBe(1);
  await expect(sequence.getByLabel('Clip 1',{exact:true})).toHaveValue('');await expect(create).toBeDisabled();reject=false;
  await block.locator('..').getByRole('button',{name:de?'Status aktualisieren':'Refresh status',exact:true}).click();
  await sequence.getByLabel('Clip 1',{exact:true}).selectOption(priorId);await sequence.getByLabel('Clip 2',{exact:true}).selectOption(runId);await create.click();
  await expect(block.getByRole('status',{name:de?'Exportstatus':'Export status',exact:true})).toContainText(de?'wartet':'queued');await expect(create).toBeDisabled();expect(posts).toBe(2);
  await open();await expect(sequence.getByLabel('Clip 1',{exact:true})).toHaveValue(priorId);await expect(sequence.getByLabel('Clip 2',{exact:true})).toHaveValue(runId);
  expect(JSON.stringify([state.nodes,state.edges,state.runs])).toBe(originalState);expect(state.requests.filter(r=>r.method!=='GET')).toEqual([]);expect(posts).toBe(2);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await sequence.scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath(`ordered-clips-${locale}.png`)});
});

for (const locale of ['en','de']) test(`Canvas merge selection ${locale}: current strand, live titles, deletion and stale refresh`,async({page},testInfo)=>{
  const de=locale==='de';await mockSharedAuth(page);await page.setViewportSize(de?{width:390,height:844}:{width:1440,height:960});
  const state=createCanvasApiMock(page),pid='1'.repeat(32),now='2026-10-03T12:30:00.000Z',id=n=>String(n).repeat(32);
  state.projects=[{id:pid,title:'Current project',locale,created_at:now,updated_at:now}];
  state.nodes=[2,3,4,5,6,7].map((n,i)=>({id:id(n),project_id:pid,type:'video_generation',model_id:'pixverse/v6',title:i<2?'Same title':i===2?'':'Clip '+n,x:50+i*110,y:50,config:{},content:{},asset_id:'asset-'+n,output:{kind:'video',runId:id(n),assetId:'asset-'+n,sourceVersion:String(n).repeat(64),previewUrl:'/tests/fixtures/media/test-image.png',asset:{id:'asset-'+n,file_url:'/tests/fixtures/media/canvas-end-frame.mp4'}},created_at:now,updated_at:now}));
  state.nodes.push({id:id(8),project_id:pid,type:'image_generation',title:'Image',x:50,y:300,config:{},content:{},output:{kind:'image',asset:{id:'image'}},created_at:now,updated_at:now});
  state.edges=[[2,3],[3,4],[3,5],[6,7],[8,4]].map(([from,to],i)=>({id:(i+10).toString(16).repeat(32),project_id:pid,source_node_id:id(from),target_node_id:id(to),config:{}}));
  const choices=()=>state.nodes.filter(n=>n.output?.kind==='video').map(n=>({nodeId:n.id,title:n.title,runId:n.output.runId,assetId:n.output.assetId,version:n.output.sourceVersion,modelId:n.model_id,createdAt:now}));
  let posts=[],task=null,stale=null,releaseRead=null;
  await page.route('**/api/account/canvas/**/full-video',async route=>{
    const availableClips=stale||choices();
    if(releaseRead){const wait=releaseRead;releaseRead=null;await wait;}
    if(route.request().method()==='POST'){
      posts.push(route.request().postDataJSON());task={id:'merge',status:'ready',storage:'canvas',asset:{id:'merged',file_url:'/tests/fixtures/media/canvas-end-frame.mp4'},recipe:{version:2,sequence:'explicit',mergeMode:'chain',videos:posts.at(-1).orderedClips}};
    }
    return route.fulfill({json:{ok:true,data:{eligible:true,availableClips,export:task}}});
  });
  const open=async()=>{await page.goto(de?'/de/canvas/':'/canvas/');await page.locator(`[data-node-id="${id(4)}"]`).press('Enter');if(de)await page.locator('#canvasInspectorToggle').click();};
  await open();const block=page.locator('.canvas-full-video'),group=block.getByRole('group'),manual=group.getByRole('radio',{name:de?'Clips und Reihenfolge auswählen':'Choose clips and order'}),chain=group.getByRole('radio',{name:de?'Diese Kette zusammenfügen':'Merge this chain'});
  const create=block.getByRole('button',{name:de?'Gesamtes Video erstellen':'Create full video',exact:true});
  await expect(chain).toBeChecked();await expect(group.locator('li')).toHaveCount(3);expect(posts).toEqual([]);
  await expect(group.locator('li').nth(0)).toContainText('Same title · PixVerse V6');
  await expect(group.locator('li').nth(2)).toContainText(de?'Videogenerierung':'Video generation');
  await expect(page.locator('.canvas-node.is-contributor')).toHaveCount(3);await expect(page.locator('.canvas-edge.is-contributor')).toHaveCount(2);
  await manual.check();await group.getByLabel('Clip 1',{exact:true}).selectOption(id(3));
  const options=await group.getByLabel('Clip 1',{exact:true}).locator('option').allTextContents();
  expect(options.filter(label=>label.includes('Same title'))).toHaveLength(2);expect(new Set(options).size).toBe(options.length);
  await page.getByRole('textbox',{name:de?'Titel':'Title',exact:true}).fill('Flucht aus dem Wald');
  await expect(group.getByLabel('Clip 2',{exact:true}).locator('option:checked')).toContainText('Flucht aus dem Wald · PixVerse V6');
  await chain.check();await expect(group.locator('li')).toHaveCount(3);
  await manual.check();await expect(group.getByLabel('Clip 1',{exact:true})).toHaveValue(id(3));await chain.check();
  await create.focus();await page.keyboard.press('Enter');
  await expect.poll(()=>posts.length).toBe(1);
  expect(posts[0].mergeMode).toBe('chain');expect(posts[0].orderedClips.map(c=>c.runId)).toEqual([id(2),id(3),id(4)]);
  expect(state.edges.map(e=>[e.source_node_id,e.target_node_id])).toEqual([[2,3],[3,4],[3,5],[6,7],[8,4]].map(pair=>pair.map(id)));
  // Delete B through the real UI. No automatic substitution on returning to C.
  stale=choices();if(de)await page.locator('#canvasInspectorToggle').click();
  await page.locator(`[data-node-id="${id(3)}"]`).press('Enter');page.once('dialog',dialog=>dialog.accept());
  await page.locator('#canvasDeleteSelection').click();
  // Deletion is an asynchronous project transition that clears selection on
  // completion. Observe that boundary before selecting the surviving endpoint.
  await expect(page.locator(`[data-node-id="${id(3)}"]`)).toHaveCount(0);
  await page.locator(`[data-node-id="${id(4)}"]`).press('Enter');if(de)await page.locator('#canvasInspectorToggle').click();
  await manual.check();await expect(group.getByLabel('Clip 1',{exact:true})).toHaveValue('');
  await expect(group.getByLabel('Clip 1',{exact:true}).locator(`option[value="${id(3)}"]`)).toHaveCount(0);
  await expect(block.getByRole('button',{name:de?'Gesamtes Video erneut erstellen':'Create full video again',exact:true})).toBeDisabled();
  await open();await manual.check();await expect(group.getByLabel('Clip 1',{exact:true}).locator(`option[value="${id(3)}"]`)).toHaveCount(0);expect(posts).toHaveLength(1);
  // A delayed response from the previous Inspector cannot fill a different one.
  let release;releaseRead=new Promise(resolve=>{release=resolve;});
  await block.locator('..').getByRole('button',{name:de?'Status aktualisieren':'Refresh status',exact:true}).click();
  if(de)await page.locator('#canvasInspectorToggle').click();await page.locator(`[data-node-id="${id(7)}"]`).press('Enter');if(de)await page.locator('#canvasInspectorToggle').click();release();
  await expect(group.locator('li')).toHaveCount(2);await expect(group.locator('li').last()).toContainText('Clip 7');
  expect(posts).toHaveLength(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await group.scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath(`current-merge-${locale}.png`)});
});

test('Canvas merge drafts: output replacement, undo and late project response keep stable versions',async({page})=>{
  await mockSharedAuth(page);createCanvasApiMock(page);await page.goto('/canvas/');
  const result=await page.evaluate(async()=>{
    const {clipSequence}=await import('/js/pages/canvas/merge-clips.js');
    const controls=document.createElement('div');document.body.append(controls);
    const clip=(id)=>({nodeId:id,runId:id,assetId:id,version:id.repeat(64),title:'Same',modelId:'model',createdAt:'2026-10-03T12:30:00Z'});
    const choices=[clip('a'),clip('b')],nodes=choices.map(c=>({id:c.nodeId,type:'video_generation',title:'Same',output:{kind:'video',runId:c.runId,assetId:c.assetId,sourceVersion:c.version}}));
    const graph={projectId:'first',nodes,edges:[],models:[]};const abort=new AbortController();
    const sequence=clipSequence(controls,'b',false,abort.signal,()=>{},()=>graph);
    sequence.update({availableClips:choices});
    const select=controls.querySelector('select');select.value='a';select.dispatchEvent(new Event('change'));
    const before=sequence.valid;
    graph.nodes=nodes.map(n=>n.id==='a'?{...n,output:{...n.output,sourceVersion:'c'.repeat(64)}}:n);
    document.dispatchEvent(new Event('canvas:merge-state'));
    sequence.update({availableClips:choices}); // A late old refresh cannot restore it.
    const replaced={valid:sequence.valid,value:controls.querySelector('select').value};
    graph.nodes=nodes;document.dispatchEvent(new Event('canvas:merge-state'));
    const undo=controls.querySelector('select').value; // Restored nodes do not silently select a clip.
    controls.querySelector('select').value='a';controls.querySelector('select').dispatchEvent(new Event('change'));
    graph.projectId='second';graph.nodes=[];document.dispatchEvent(new Event('canvas:merge-state'));
    sequence.update({availableClips:choices});
    const switched={valid:sequence.valid,options:controls.querySelectorAll('select option[value="a"]').length};
    abort.abort();controls.remove();return{before,replaced,undo,switched};
  });
  expect(result).toEqual({before:true,replaced:{valid:false,value:''},undo:'',switched:{valid:false,options:0}});
});

for (const locale of ['en','de']) for(const delayedMetadata of [false,true]) test(`Canvas full video music ${locale}: explicit versions, persisted gain and saved preview${delayedMetadata?' during metadata arrival':''}`,async({page,browserName},testInfo)=>{
  await page.setViewportSize(locale==='de'?{width:390,height:844}:{width:1024,height:768});
  await mockSharedAuth(page);
  const state=createCanvasApiMock(page),projectId='1'.repeat(32),nodeId='2'.repeat(32),runId='3'.repeat(32),musicId='4'.repeat(32),now=new Date().toISOString();
  const output={kind:'video',runId,assetId:'original',sourceVersion:'a'.repeat(64),previewUrl:'/api/ai/text-assets/original/poster',asset:{id:'original',file_url:'/api/ai/text-assets/original/file'}};
  state.projects=[{id:projectId,title:'Synthetic music export',locale,created_at:now,updated_at:now}];
  state.nodes=[{id:nodeId,project_id:projectId,type:'video_generation',model_id:'minimax/h3',title:'Clip 2',x:100,y:100,config:{prompt:'Synthetic clip'},content:{},output,asset_id:'original',created_at:now,updated_at:now},
    {id:musicId,project_id:projectId,type:'music_generation',title:'Music',x:100,y:400,config:{},content:{},output:{kind:'audio',asset:{id:'music',asset_type:'music',mime_type:'audio/wav',file_url:'/api/ai/text-assets/music/file'}},created_at:now,updated_at:now}];
  state.edges=[{id:'5'.repeat(32),project_id:projectId,source_node_id:musicId,target_node_id:nodeId,config:{},created_at:now}];
  state.runs=[{id:runId,node_id:nodeId,project_id:projectId,status:'completed',output,asset_id:'original',created_at:now,updated_at:now}];
  const merge=currentMergeFixture(state,nodeId,now);
  let task=null,current=null;const exports=[],saved=[];
  await page.route('**/api/account/canvas/**/full-video',route=>{
    if(route.request().method()==='POST') {
      const body=route.request().postDataJSON();
      if(body.saveExportId){saved.push(body.saveExportId);current.storage='assets';return route.fulfill({json:{ok:true,data:{asset_id:body.saveExportId,storage:'assets'}}});}
      exports.push({body,key:route.request().headers()['idempotency-key']});task={id:`version-${exports.length}`,status:'queued',storage:'canvas'};
    }
    return route.fulfill({json:{ok:true,data:{eligible:true,export:task,current,availableClips:merge.availableClips}}});
  });
  let releaseMetadata;const metadataGate=new Promise(resolve=>{releaseMetadata=resolve;});
  // Open-codec 4:3 fixture for Linux Chromium metadata (its bundled H264 is
  // unavailable). Generated: lavfi color=blue:s=160x120:r=10:d=0.2, libvpx/webm.
  // WebKit and all ordinary-click cases retain the incident's MP4 fixture.
  const vp8=Buffer.from('GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwH/////////EU2bdKtNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHNTbuMU6uEElTDZ1OsggEa7AEAAAAAAABoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmpyrXsYMPQkBNgI1MYXZmNjIuMTIuMTAxV0GNTGF2ZjYyLjEyLjEwMRZUrmvIrgEAAAAAAAA/14EBc8WIANGfhggE13icgQAitZyDdW5kiIEAhoVWX1ZQOIOBASPjg4QF9eEA4JCwgaC6gXiagQJVsIRVuYEBElTDZ9hzc6BjwIBnyJpFo4dFTkNPREVSRIeNTGF2ZjYyLjEyLjEwMXNzsmPAi2PFiADRn4YIBNd4Z8ihRaOHRU5DT0RFUkSHlExhdmM2Mi4yOC4xMDEgbGlidnB4H0O2df3ngQCj3oEAAIDwBgCdASqgAHgAAEcIhYWIhYSIAgICdaoD+AIGk48FEJxS0qE4paVCcUtKhOKWlQnFLSoTilpUJxS0qE4paVCbAP7/TRL//FhX8WFfxYV/8WFf/PzO7cX85gCjmIEAZAARAgAFEKwAGAAYWC/0AAiAgQywAA==','base64');
  await page.route('**/api/ai/text-assets/*/file',async route=>{
    if(delayedMetadata && route.request().url().includes('/version-1/'))await metadataGate;
    return route.fulfill(delayedMetadata && browserName==='chromium'?{contentType:'video/webm',body:vp8}:{contentType:'video/mp4',body:fs.readFileSync(path.join(__dirname,'fixtures/media/canvas-end-frame.mp4'))});
  });
  await page.route('**/api/ai/text-assets/*/poster',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'}));
  const open=async()=>{await page.goto(locale==='de'?'/de/canvas/':'/canvas/');await page.locator(`[data-node-id="${nodeId}"]`).first().click();if(locale==='de')await page.locator('#canvasInspectorToggle').click();};
  await open();const block=page.locator('.canvas-full-video'),inspector=page.locator('#canvasInspectorBody');
  await expect(block.getByRole('checkbox')).toHaveCount(0);
  if(locale==='de')await page.locator('#canvasInspectorToggle').click();
  await page.locator(`[data-edge-id="${'5'.repeat(32)}"] .canvas-edge-hit`).press('Enter');
  if(locale==='de')await page.locator('#canvasInspectorToggle').click();
  const connectionPurpose=page.getByRole('combobox',{name:locale==='de'?'Verbindungszweck':'Connection purpose',exact:true});
  await expect(connectionPurpose).toHaveValue('');
  await connectionPurpose.selectOption('export_background_music');
  await expect.poll(()=>state.edges[0].config.purpose).toBe('export_background_music');
  await expect(connectionPurpose).toBeEnabled();
  await expect(connectionPurpose).toBeFocused();
  if(locale==='de')await page.locator('#canvasInspectorToggle').click();
  await page.locator(`[data-node-id="${nodeId}"]`).first().click();
  if(locale==='de')await page.locator('#canvasInspectorToggle').click();
  const sound=inspector.locator('.canvas-sound');await sound.locator('summary').click();
  const check=sound.getByRole('checkbox',{name:locale==='de'?'Musik als Hintergrund hinzufügen':'Add music as background'});
  await check.check();const slider=sound.getByRole('slider',{name:locale==='de'?'Hintergrundmusik: Lautstärke':'Background music: Volume',exact:true});await slider.focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');
  await expect(sound.getByRole('spinbutton',{name:locale==='de'?'Hintergrundmusik: Lautstärke (%)':'Background music: Volume (%)'})).toHaveValue('1');
  await slider.fill('50');await slider.dispatchEvent('input');await expect(sound.getByRole('spinbutton',{name:locale==='de'?'Hintergrundmusik: Lautstärke (%)':'Background music: Volume (%)'})).toHaveValue('50');
  expect(exports).toHaveLength(0);
  await block.getByRole('button',{name:locale==='de'?'Gesamtes Video mit Hintergrundmusik erstellen':'Create full video with background music',exact:true}).click();
  await expect.poll(()=>exports.length).toBe(1);
  expect(exports[0].body).toEqual({backgroundMusic:{enabled:true,gain:0.5,fadeIn:0,fadeOut:0},orderedClips:merge.orderedClips,mergeMode:'chain'});expect(exports[0].key).toBeTruthy();
  await expect.poll(()=>state.nodes[0].config.backgroundMusic).toEqual({enabled:true,gain:0.5,fadeIn:0,fadeOut:0});
  current={...task,status:'ready',asset:{id:task.id,file_url:'/api/ai/text-assets/version-1/file'}};task=current;
  await page.evaluate(()=>{
    const records=window.canvasSaveTrace=[],ids=new WeakMap();let sequence=0;
    const describe=element=>{if(!(element instanceof Element))return null;if(!ids.has(element))ids.set(element,++sequence);const r=element.getBoundingClientRect();return {id:ids.get(element),tag:element.tagName,text:element.tagName==='BUTTON'?element.textContent:null,connected:element.isConnected,rect:[r.x,r.y,r.width,r.height]};};
    for(const type of ['pointerdown','pointerup','mousedown','mouseup','click','loadedmetadata','resize','abort','emptied'])document.addEventListener(type,event=>{if(event.target.closest?.('.canvas-output'))records.push({type,time:performance.now(),target:describe(event.target),save:describe(document.querySelector('.canvas-full-video video')?.parentElement.querySelector('button'))});},true);
    new MutationObserver(changes=>{for(const change of changes)if(change.type==='childList')records.push({type:'mutation',time:performance.now(),removed:[...change.removedNodes].map(describe),added:[...change.addedNodes].map(describe)});}).observe(document.querySelector('.canvas-full-video'),{subtree:true,childList:true});
  });
  await inspector.getByRole('button',{name:locale==='de'?'Status aktualisieren':'Refresh status'}).click();
  await expect(block.locator('video')).toHaveAttribute('src',current.asset.file_url);
  try {
    const save=block.getByRole('button',{name:locale==='de'?'Gesamtvideo in Assets speichern':'Save full video to Assets'});
    if(delayedMetadata) {
      await save.scrollIntoViewIfNeeded();const box=await save.boundingBox();
      await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
      releaseMetadata();await expect.poll(()=>block.locator('video').evaluate(v=>v.videoWidth)).toBeGreaterThan(0);
      await page.mouse.up();
    } else await save.click();
    await expect.poll(()=>saved).toEqual(['version-1']);
  }
  finally {releaseMetadata();await testInfo.attach('aggregate-save-interaction',{body:JSON.stringify({events:await page.evaluate(()=>window.canvasSaveTrace),saved}),contentType:'application/json'});}
  const interaction=await page.evaluate(()=>window.canvasSaveTrace);
  const down=interaction.find(event=>event.type==='pointerdown' && event.target?.text=== (locale==='de'?'Gesamtvideo in Assets speichern':'Save full video to Assets'));
  const up=interaction.find(event=>event.type==='pointerup' && event.time>=down.time);
  expect(up.target.id).toBe(down.target.id);
  expect(Math.abs(up.save.rect[1]-down.save.rect[1])).toBeLessThan(1);
  await expect(block.getByRole('status',{name:locale==='de'?'Exportstatus':'Export status',exact:true})).toContainText(locale==='de'?'Diese Version ist in Assets gespeichert.':'This version is saved to Assets.');
  await expect(block.getByRole('button',{name:locale==='de'?'Gesamtvideo in Assets speichern':'Save full video to Assets'})).toHaveCount(0);
  await open();await sound.locator('summary').click();await expect(slider).toHaveValue('50');await expect(check).toBeChecked();
  await slider.fill('100');await slider.dispatchEvent('input');expect(exports).toHaveLength(1);
  await block.getByRole('button',{name:locale==='de'?'Gesamtes Video mit Hintergrundmusik erstellen':'Create full video with background music'}).click();
  await expect.poll(()=>exports.length).toBe(2);
  expect(exports[1].body.backgroundMusic.gain).toBe(1);expect(exports[1].key).not.toBe(exports[0].key);
  await expect(block.locator('video')).toHaveAttribute('src','/api/ai/text-assets/version-1/file');
  task.status='failed';await inspector.getByRole('button',{name:locale==='de'?'Status aktualisieren':'Refresh status'}).click();
  await expect(block.getByRole('status',{name:locale==='de'?'Exportstatus':'Export status',exact:true})).toContainText(locale==='de'?'fehlgeschlagen':'failed');
  await expect(block.locator('video')).toHaveAttribute('src','/api/ai/text-assets/version-1/file');
  expect(saved).toEqual(['version-1']);expect(exports).toHaveLength(2);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  // Actual frontend analyzer: export-only music is absent; ordinary H3 audio
  // remains intentional provider input and is never silently reclassified.
  const analysis=await page.evaluate(async({nodes,edges})=>{
    const {analyzeNodeInputs}=await import('/js/pages/canvas/workflow.js');
    const model={id:'minimax/h3',capability:'video',runnable:true,controls:{supportsAudioInput:true}};
    const excluded=analyzeNodeInputs(nodes[0],nodes,edges,[model],{});
    const ordinary=analyzeNodeInputs(nodes[0],nodes,edges.map(e=>({...e,config:{}})),[model],{});
    return {excludedMusic:excluded.sources.some(s=>s.edgeId==='5'.repeat(32)),ordinaryMusic:ordinary.sources.filter(s=>s.edgeId==='5'.repeat(32)).map(s=>s.h3Role),retainedVideo:excluded.sources.some(s=>s.edgeId==='d'.repeat(32))};
  },{nodes:state.nodes,edges:state.edges});
  expect(analysis).toEqual({excludedMusic:false,ordinaryMusic:['reference_audio'],retainedVideo:true});
});

for (const locale of ['en', 'de']) for (const mobile of [false, true]) for(const role of ['user','admin']) {
  test(`Canvas Grok ${role} ${locale} ${mobile ? 'mobile' : 'desktop'} persists reasoning and shows matching credit estimate`, async ({ page }, testInfo) => {
    const { listCanvasModelsForRole, estimateCanvasTextCredits, getCanvasTextInstructions } = await import('../js/shared/canvas-model-contract.mjs');
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
    await mockSharedAuth(page,true,role);
    const state = createCanvasApiMock(page, { modelPayload: { models: listCanvasModelsForRole(role), organizations: [], access: { role, is_admin:role==='admin' } } });
    const project = '11111111111111111111111111111111', node = '33333333333333333333333333333333';
    state.projects.push({ id: project, title: 'Grok fixture', locale, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    state.nodes.push({ id: node, project_id: project, type: 'text_generation', title: 'Grok text', x: 40, y: 40, model_id: 'xai/grok-4.6', config: { prompt: 'Synthetic prompt', systemPrompt: 'Concise.' }, content: {} });
    await page.goto(locale === 'de' ? '/de/canvas/' : '/canvas/');
    await expect(page.locator('#canvasProjectTitle')).toHaveValue('Grok fixture');
    await expect(page.locator('#canvasApp')).not.toHaveAttribute('inert', '');
    if (mobile) await page.locator('#canvasGraphToggle').click();
    await page.locator(`[data-node-id="${node}"]`).press('Enter');
    if (mobile) await page.locator('#canvasInspectorToggle').click();
    const effort = page.getByRole('combobox', { name: locale === 'de' ? 'Denkaufwand' : 'Reasoning effort', exact: true });
    await expect(effort).toHaveValue('medium');
    await expect(page.locator('.canvas-model-note')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: locale === 'de' ? 'System-Prompt' : 'System prompt', exact: true })).toHaveCount(0);
    await expect(page.locator('.canvas-input-context')).not.toContainText(/Effective prompt|Effektiver Prompt/);
    const purpose = page.getByRole('combobox', { name: locale === 'de' ? 'Verwendungszweck' : 'Purpose', exact: true });
    await expect(purpose).toHaveValue('image_prompt');
    await expect(purpose.locator('option')).toHaveCount(3);
    await purpose.focus(); await expect(purpose).toBeFocused(); await purpose.press('Tab');
    await purpose.selectOption('video_prompt');
    await expect.poll(() => state.nodes[0].config.textPurpose).toBe('video_prompt');
    await purpose.selectOption('song_lyrics');
    await expect.poll(() => state.nodes[0].config.textPurpose).toBe('song_lyrics');
    await effort.selectOption('high');
    await expect.poll(() => state.nodes[0].config.reasoningEffort).toBe('high');
    await expect(page.locator('.canvas-cost-note')).toHaveText(`${locale === 'de' ? 'Geschätzte Credits' : 'Estimated credits'}: ${estimateCanvasTextCredits('xai/grok-4.6', { ...state.nodes[0].config, systemPrompt: getCanvasTextInstructions(state.nodes[0].config) })}`);
    await page.reload();
    await expect(page.locator('#canvasProjectTitle')).toHaveValue('Grok fixture');
    await expect(page.locator('#canvasApp')).not.toHaveAttribute('inert', '');
    if (mobile) await page.locator('#canvasGraphToggle').click();
    await page.locator(`[data-node-id="${node}"]`).press('Enter');
    if (mobile) await page.locator('#canvasInspectorToggle').click();
    await expect(effort).toHaveValue('high');
    await expect(purpose).toHaveValue('song_lyrics');
    expect(state.nodes[0].config.systemPrompt).toBe('Concise.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await testInfo.attach('canvas-purpose', { body: await page.screenshot(), contentType: 'image/png' });
    await page.locator('#bitbiHelpTrigger').click();
    const help = page.locator('[data-help-section="canvas"]');
    await expect(help).toBeVisible();
    if (!(await help.evaluate(el => el.open))) await help.locator(':scope > summary').click();
    await expect(help).toContainText(locale === 'de' ? 'Textzwecke' : 'Text purposes');
    await page.keyboard.press('Escape');
    await expect(page.locator('#bitbiHelpPanel')).not.toBeVisible();
    await page.goto(locale === 'de' ? '/de/pricing.html' : '/pricing.html');
    await page.locator('#bitbiHelpTrigger').click();
    await expect(page.locator('[data-help-section="canvas"]')).toHaveCount(0);
    await expect(page.locator('[data-help-section="credits"]')).toBeVisible();
  });
}

test.describe('Canvas private media controls',()=>{
  test.use({hasTouch:true});
  for(const locale of ['en','de']) for(const family of ['grok','pixverse']) test(`${locale}: ${family} saved unavailable video method requires explicit last-frame recovery`,async({page},testInfo)=>{
    const {listCanvasModelsForRole}=await import('../js/shared/canvas-model-contract.mjs');
    const mobile=locale==='de',model=family==='pixverse'?'pixverse/v6':mobile?'xai/grok-imagine-video-1.5-preview':'xai/grok-imagine-video';
    const savedMethod=family==='pixverse'?'extend':'edit';
    await page.setViewportSize(mobile?{width:390,height:844}:{width:1440,height:900});await mockSharedAuth(page);
    const state=createCanvasApiMock(page,{modelPayload:{models:listCanvasModelsForRole('user'),organizations:[],access:{role:'user'}}});
    const project='1'.repeat(32),src='a'.repeat(32),dest='b'.repeat(32),edge='c'.repeat(32);
    state.projects.push({id:project,title:'Video input recovery',locale});
    state.nodes.push({id:src,project_id:project,type:'video_generation',title:'Original',x:20,y:20,model_id:'pixverse/v6',config:{},content:{},output:{kind:'video',runId:'source-run',asset:{id:'source',asset_type:'video',file_url:'/api/ai/text-assets/source/file'}}},
      {id:dest,project_id:project,type:'video_generation',title:'Continue clip',x:290,y:20,model_id:model,config:{prompt:'Continue motion',duration:3,resolution:'480p'},content:{}});
    state.edges.push({id:edge,project_id:project,source_node_id:src,target_node_id:dest,config:{videoInput:{modelId:model,assetId:'source',runId:'source-run',method:savedMethod}}});
    const changes=[],uploads=[],runs=[];
    await page.route(`**/api/account/canvas/projects/${project}/edges/${edge}`,route=>{
      expect(route.request().method()).toBe('PATCH');const body=route.request().postDataJSON();changes.push(body);
      expect(body.config.videoInput).toEqual({modelId:model,assetId:'source',runId:'source-run',method:'last_frame',...(body.frame_image?{sourceVersion:'verified-original'}:{})});
      state.edges[0].config=structuredClone(body.config);state.edges[0].config.videoInput.sourceVersion='verified-original';
      if(body.frame_image){uploads.push(body.frame_image);state.edges[0].config.videoInput.frame={imageId:'recovered-frame',version:'verified-original',previewUrl:'/api/ai/images/recovered-frame/file'};}
      return route.fulfill({json:{ok:true,data:{edge:state.edges[0]}}});
    });
    await page.route('**/api/ai/text-assets/source/file',route=>route.fulfill({contentType:'video/mp4',body:fs.readFileSync(path.join(__dirname,'fixtures/media/canvas-end-frame.mp4'))}));
    await page.route('**/api/ai/images/recovered-frame/file',route=>route.fulfill({contentType:'image/png',body:Buffer.from(uploads[0].split(',')[1],'base64')}));
    await page.route(`**/nodes/${dest}/run`,route=>{
      expect(state.edges[0].config.videoInput.frame.version).toBe('verified-original');runs.push(route.request().postDataJSON());
      const run={id:'d'.repeat(32),node_id:dest,status:'completed',asset_id:'new-video',output:{kind:'video',assetId:'new-video'}};state.runs=[run];
      return route.fulfill({json:{ok:true,data:{run}}});
    });
    const select=async()=>{await page.locator(`[data-node-id="${dest}"]`).first().press('Enter');if(mobile)await page.locator('#canvasInspectorToggle').tap();};
    await page.goto(mobile?'/de/canvas/':'/canvas/');await select();
    const inspector=page.locator('#canvasInspectorBody'),method=inspector.getByRole('combobox',{name:mobile?'Video weiterverwenden':'Reuse video'});
    const run=inspector.getByRole('button',{name:mobile?'Ausführen':'Run',exact:true});
    await expect(method).toHaveValue('');await expect(run).toBeDisabled();
    expect(await method.locator('option').evaluateAll(options=>options.map(option=>option.value))).toEqual(['','last_frame']);
    await expect(method.locator('option[value=edit]')).toHaveCount(0);
    await expect(method.locator('option[value=extend]')).toHaveCount(0);
    await expect(inspector.getByRole('status').filter({hasText:mobile?'gespeicherte Vorgang':'saved operation'})).toContainText(mobile?'aktuellen Modell':'current model');
    expect(changes).toHaveLength(0);expect(uploads).toHaveLength(0);expect(runs).toHaveLength(0);
    if(family==='grok'){
      await inspector.getByRole('combobox',{name:mobile?'Größe':'Size',exact:true}).selectOption('848x480');
      await expect.poll(()=>state.nodes[1].config.size).toBe('848x480');
    }
    await page.reload();await select();await expect(method).toHaveValue('');await expect(run).toBeDisabled();
    if(family==='grok')await expect(inspector.getByRole('combobox',{name:mobile?'Größe':'Size',exact:true})).toHaveValue('848x480');
    expect(state.edges[0].config.videoInput.method).toBe(savedMethod);expect(changes).toHaveLength(0);expect(uploads).toHaveLength(0);expect(runs).toHaveLength(0);
    await method.scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath(`video-held-${family}-${locale}.png`)});
    await method.focus();await expect(method).toBeFocused();await method.selectOption('last_frame');
    const image=inspector.getByRole('img',{name:mobile?'Letztes Frame als Startbild':'Last frame as start image'});
    await expect(image).toHaveAttribute('src','/api/ai/images/recovered-frame/file');await expect(run).toBeEnabled();
    expect(changes).toHaveLength(2);expect(uploads).toHaveLength(1);expect(runs).toHaveLength(0);
    await expect(method).toHaveCount(0);
    await page.reload();await select();await expect(image).toBeVisible();await expect(run).toBeEnabled();
    expect(changes).toHaveLength(2);expect(uploads).toHaveLength(1);
    if(mobile)await run.tap();else await run.press('Enter');
    await expect.poll(()=>runs.length).toBe(1);await expect(run).toBeEnabled();
    expect(changes).toHaveLength(2);expect(uploads).toHaveLength(1);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await image.scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath(`video-recovery-${family}-${locale}.png`)});
  });
  for(const locale of ['en','de']) test(`${locale}: additional prompt, image controls, video resolution and explicit saves survive reload`,async({page},testInfo)=>{
    const {listCanvasModelsForRole}=await import('../js/shared/canvas-model-contract.mjs');
    const {calculateAiImageCreditCost}=await import('../js/shared/ai-model-pricing.mjs');
    const mobile=locale==='de';await page.setViewportSize(mobile?{width:390,height:844}:{width:1440,height:900});
    await mockSharedAuth(page);
    const state=createCanvasApiMock(page,{modelPayload:{models:listCanvasModelsForRole('user'),organizations:[],access:{role:'user'}}});
    const project='1'.repeat(32),ids=['2','3','4'].map(x=>x.repeat(32));
    state.projects.push({id:project,title:'Private Canvas outputs',locale});
    for(const [i,kind] of ['image','video','audio'].entries())state.nodes.push({id:ids[i],project_id:project,type:['image_generation','video_generation','music_generation'][i],title:['Image','Video','Music'][i],x:20+i*280,y:30,model_id:['xai/grok-imagine-image-2.0','pixverse/v6','minimax/music-2.6'][i],config:{prompt:'Soft morning light',duration:2,quality:i===0?'low':'720p',generateAudio:false},content:{},asset_id:ids[i],output:{kind,storage:'canvas',runId:ids[i],asset:{id:ids[i],preview_url:kind==='image'?'/tests/fixtures/media/member-image.png':null,file_url:`/api/ai/text-assets/${ids[i]}/file`}}});
    await page.route('**/tests/fixtures/media/member-image.png',route=>route.fulfill({contentType:'image/png',body:fs.readFileSync(path.join(__dirname,'fixtures/media/member-image.png'))}));
    const saved=[];
    await page.route('**/runs/*/save-asset',async route=>{
      const runId=new URL(route.request().url()).pathname.split('/').at(-2);saved.push(runId);
      state.nodes.find(n=>n.output.runId===runId).output.storage='assets';
      await route.fulfill({json:{ok:true,data:{asset_id:runId,storage:'assets'}}});
    });
    await page.route('**/runs/*/full-video',route=>route.fulfill({json:{ok:true,data:{eligible:false}}}));
    await page.route('**/api/ai/text-assets/*/file',route=>route.fulfill({contentType:'video/mp4',body:fs.readFileSync(path.join(__dirname,'fixtures/media/canvas-end-frame.mp4'))}));
    const select=async id=>{
      if(mobile && !await page.locator('#canvasGraph').isVisible())await page.locator('#canvasGraphToggle').click();
      await page.locator(`[data-node-id="${id}"]`).first().press('Enter');
      if(mobile)await page.locator('#canvasInspectorToggle').click();
    };
    await page.goto(locale==='de'?'/de/canvas/':'/canvas/');await expect(page.locator('#canvasProjectTitle')).toHaveValue('Private Canvas outputs');
    await select(ids[0]);const inspector=page.locator('#canvasInspectorBody'),label=locale==='de'?'Zusätzlicher Prompt':'Additional prompt';
    await expect(inspector.getByLabel(label,{exact:true})).toBeHidden();
    await inspector.locator('.canvas-additional-prompt summary').focus();await page.keyboard.press('Enter');
    await inspector.getByLabel(label,{exact:true}).fill('Preserved extra light');
    const quality=inspector.getByRole('combobox',{name:locale==='de'?'Qualität':'Quality',exact:true});
    await expect(quality.locator('option')).toHaveText(['low','medium']);await quality.selectOption('medium');
    await inspector.getByRole('combobox',{name:locale==='de'?'Auflösung':'Resolution',exact:true}).selectOption('2k');
    await expect(inspector.locator('.canvas-cost-note')).toHaveText(`${locale==='de'?'Geschätzte Credits':'Estimated credits'}: ${calculateAiImageCreditCost('xai/grok-imagine-image-2.0',{quality:'medium',resolution:'2k'}).credits}`);
    const save=()=>inspector.getByRole('button',{name:locale==='de'?'In Assets speichern':'Save to Assets',exact:true});
    await save().tap();await expect(inspector.getByRole('button',{name:locale==='de'?'In Assets gespeichert':'Saved to Assets',exact:true})).toBeDisabled();
    await select(ids[1]);const resolution=inspector.getByRole('combobox',{name:locale==='de'?'Auflösung':'Resolution',exact:true});
    await expect(resolution.locator('option')).toHaveText(['360p','540p','720p','1080p']);
    const cost=await inspector.locator('.canvas-cost-note').textContent();await resolution.selectOption('1080p');await expect(inspector.locator('.canvas-cost-note')).not.toHaveText(cost);
    await save().focus();await page.keyboard.press('Enter');await expect.poll(()=>saved.length).toBe(2);
    await select(ids[2]);await save().tap();await expect.poll(()=>saved.length).toBe(3);
    await expect.poll(()=>state.nodes[0].config.prompt).toBe('Preserved extra light');
    await expect.poll(()=>state.nodes[1].config.quality).toBe('1080p');
    await page.reload();await expect(page.locator('#canvasProjectTitle')).toHaveValue('Private Canvas outputs');await select(ids[0]);
    await expect(save()).toHaveCount(0);await inspector.locator('.canvas-additional-prompt summary').tap();await expect(inspector.getByLabel(label,{exact:true})).toHaveValue('Preserved extra light');
    expect(state.nodes[1].config.quality).toBe('1080p');expect(saved).toEqual(ids);
    expect(state.requests.filter(r=>r.pathname.endsWith('/run'))).toHaveLength(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:testInfo.outputPath(`canvas-private-${locale}.png`)});
  });
});

for(const locale of ['en','de']) test(`Canvas H3 ${locale}: connected input roles, estimates and persisted settings`,async({page},testInfo)=>{
  await mockSharedAuth(page);
  const {listCanvasModelsForRole}=await import('../js/shared/canvas-model-contract.mjs');
  const state=createCanvasApiMock(page,{modelPayload:{models:listCanvasModelsForRole('user'),organizations:[],access:{role:'user'}}});
  const project='1'.repeat(32),node='a'.repeat(32),now=new Date().toISOString();
  state.projects.push({id:project,title:'H3 inputs',locale,created_at:now,updated_at:now});
  state.nodes.push({id:node,project_id:project,type:'video_generation',title:'H3 target',model_id:'minimax/h3',x:30,y:30,config:{prompt:'Synthetic motion',duration:5,resolution:'768P'},content:{}});
  for(const [i,kind] of ['image','video','audio'].entries()) {
    const id=String(i+2).repeat(32);state.nodes.push({id,project_id:project,type:'asset_reference',title:kind,x:340,y:30+i*160,content:{asset:{id:'reference-'+kind,asset_type:kind,mime_type:kind==='image'?'image/png':kind==='video'?'video/mp4':'audio/wav'}},config:{}});
    state.edges.push({id:String(i+4).repeat(32),project_id:project,source_node_id:id,target_node_id:node,config:{}});
  }
  const open=async()=>{await page.goto(locale==='de'?'/de/canvas/':'/canvas/');await page.locator(`[data-node-id="${node}"]`).first().click();};
  await open();const inspector=page.locator('#canvasInspectorBody');
  const roles=inspector.getByRole('combobox',{name:locale==='de'?'Eingaberolle':'Input role',exact:true});
  await expect(roles).toHaveCount(2);
  await expect(inspector.getByRole('combobox',{name:locale==='de'?'Video weiterverwenden':'Reuse video'})).toHaveValue('reference_video');
  expect(await roles.evaluateAll(list=>list.map(s=>s.value))).toEqual(['reference_image','reference_audio']);
  const cost=await inspector.locator('.canvas-cost-note').textContent();
  await inspector.getByRole('combobox',{name:locale==='de'?'Auflösung':'Resolution',exact:true}).selectOption('2K');
  await expect(inspector.locator('.canvas-cost-note')).not.toHaveText(cost);
  await roles.first().selectOption('first_frame');
  await expect(roles.first()).toBeFocused();
  await expect(inspector.getByRole('button',{name:locale==='de'?'Ausführen':'Run',exact:true})).toBeDisabled();
  await expect.poll(()=>state.nodes[0].config.h3Roles?.[state.edges[0].id]).toBe('first_frame');
  await page.reload();await page.locator(`[data-node-id="${node}"]`).first().click();await expect(roles.first()).toHaveValue('first_frame');
  await roles.first().selectOption('reference_image');await expect.poll(()=>state.nodes[0].config.h3Roles?.[state.edges[0].id]).toBe('reference_image');
  await expect(inspector.getByRole('button',{name:locale==='de'?'Ausführen':'Run',exact:true})).toBeEnabled();
  await page.screenshot({path:testInfo.outputPath(`h3-canvas-${locale}.png`)});
  await page.setViewportSize({width:390,height:844});await page.locator('#canvasInspectorToggle').click();await roles.first().scrollIntoViewIfNeeded();await expect(roles.first()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath(`h3-canvas-${locale}-mobile.png`)});
  let code='h3_reference_file_duration',calls=0;
  await page.route(`**/nodes/${node}/run`,route=>{calls++;return route.fulfill({status:400,json:{ok:false,code,error:'Specific reference error'}});});
  const run=inspector.getByRole('button',{name:locale==='de'?'Ausführen':'Run',exact:true});
  await run.click();await expect(page.locator('#canvasToast')).toContainText(locale==='de'?'zwischen 2 und 15 Sekunden':'between 2 and 15 seconds');
  code='h3_reference_total_duration';await run.click();await expect(page.locator('#canvasToast')).toContainText(locale==='de'?'zusammen je Medienart':'per media type');
  expect(calls).toBe(2);await expect(inspector.getByRole('combobox',{name:locale==='de'?'Video weiterverwenden':'Reuse video'})).toHaveValue('reference_video');
});

// The existing Canvas caller and shared Assets caller both execute these cases.
async function prepareCanvasAssetPicker(page, { locale = 'en', foldersReady = null } = {}) {
  const projectId = '1'.repeat(32), nodeId = '2'.repeat(32), otherId = '3'.repeat(32), folderId = 'f'.repeat(32);
  const assets = [
    { id: 'a'.repeat(32), asset_type: 'image', title: 'A saved mountain study', mime_type: 'image/png' },
    { id: 'b'.repeat(32), asset_type: 'video', title: 'The original motion study', mime_type: 'video/mp4' },
    { id: 'c'.repeat(32), asset_type: 'sound', title: 'A saved sound sketch', mime_type: 'audio/wav' },
    { id: 'd'.repeat(32), asset_type: 'text', title: 'Saved creative notes', mime_type: 'text/plain', preview_text: 'A quiet mountain at sunrise.' },
    { id: 'e'.repeat(32), asset_type: 'embedding', title: 'Saved structured data', mime_type: 'application/json', preview_text: '{"dimensions": 3}' },
  ].map(asset => ({ ...asset, folder_id: folderId, visibility: 'private', poster_status: 'ready',
    file_url: `/api/ai/${asset.asset_type === 'image' ? 'images' : 'text-assets'}/${asset.id}/file`,
    thumb_url: `/api/ai/images/${asset.id}/thumb`, poster_url: `/api/ai/text-assets/${asset.id}/poster`,
  }));
  const requests = [], assignments = [];
  await page.addInitScript(() => localStorage.setItem('bitbi_cookie_consent', JSON.stringify({v:'1',ts:Date.now(),necessary:true,analytics:false,marketing:false})));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    requests.push({ path: url.pathname, search: url.search, method: route.request().method() });
    if (/\/(thumb|medium|poster)$/.test(url.pathname)) return route.fulfill({status:200,contentType:'image/png',body:fs.readFileSync(path.join(__dirname,'fixtures/media/member-image.png'))});
    if (url.pathname.endsWith('/file')) {
      const asset = assets.find(item => url.pathname.includes(item.id));
      if (asset?.asset_type === 'video') return route.fulfill({status:200,contentType:asset.mime_type,body:fs.readFileSync(path.join(__dirname,'fixtures/media/test-video-changing.mp4'))});
      return route.fulfill({status:200,contentType:asset?.mime_type || 'text/plain',body:asset?.preview_text || ''});
    }
    if (url.pathname === '/api/ai/folders') {
      if (foldersReady) await foldersReady;
      return route.fulfill({json:{ok:true,data:{folders:[{id:folderId,name:'Studio references'}],counts:{[folderId]:assets.length},unfolderedCount:0}}});
    }
    if (url.pathname === '/api/ai/assets') return route.fulfill({json:{ok:true,data:{assets,has_more:false,next_cursor:null,applied_limit:60}}});
    if (url.pathname === '/api/ai/generation-jobs') return route.fulfill({json:{ok:true,data:{jobs:[]}}});
    return route.fulfill({json:{ok:true,data:{}}});
  });
  await mockSharedAuth(page);
  const state = createCanvasApiMock(page);
  state.projects = [{id:projectId,title:'Reference workspace',locale}];
  state.nodes = [nodeId,otherId].map((id,i) => ({id,project_id:projectId,type:'asset_reference',title:i?'Other reference':'Reference',x:80+i*300,y:80,config:{},content:{},asset_id:null,output:null}));
  state.assignmentStatus = 200;
  await page.route('**/api/account/canvas/**/asset-reference', async route => {
    const body = route.request().postDataJSON();
    assignments.push({path:new URL(route.request().url()).pathname,body});
    if (state.assignmentGate) await state.assignmentGate;
    if (state.assignmentStatus !== 200) return route.fulfill({status:state.assignmentStatus,json:{ok:false,code:'asset_not_found',error:'Asset unavailable'}});
    const asset = assets.find(item => item.id === body.asset_id);
    const id = new URL(route.request().url()).pathname.split('/').at(-2);
    const reference = {id:asset.id,asset_type:asset.asset_type === 'image'?'image':asset.asset_type === 'sound'?'audio':asset.asset_type === 'video'?'video':'file',mime_type:asset.mime_type,file_url:asset.file_url,preview_url:asset.asset_type==='image'?`/api/ai/images/${asset.id}/medium`:asset.poster_url};
    const node = state.nodes.find(item => item.id === id);
    node.asset_id=asset.id;node.content={asset:reference};
    return route.fulfill({json:{ok:true,data:{node_id:id,asset:reference}}});
  });
  await page.goto(`${locale==='de'?'/de':''}/canvas/`);
  await page.locator(`[data-node-id="${nodeId}"]`).press('Enter');
  if (page.viewportSize().width < 760) await page.locator('#canvasInspectorToggle').click();
  return {state,assets,requests,assignments,nodeId,otherId,folderId};
}

for (const locale of ['en','de']) test.describe(`Canvas asset picker ${locale}`, () => {
  test.use({viewport:{width:locale==='de'?390:1440,height:900},hasTouch:locale==='de'});
  test('folders first, explicit single selection, cancellation and persisted preview', async ({page}, testInfo) => {
    const fixture = await prepareCanvasAssetPicker(page,{locale});
    const {assets,state,requests,assignments,folderId,nodeId}=fixture;
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const choose=page.locator('#canvasAssetChoose'), dialog=page.locator('#canvasAssetsOverlay');
    await choose.click();
    await expect(dialog).toBeVisible();
    await expect(page.locator('#canvasAssetsFolderGrid .studio__folder-card')).toHaveCount(3);
    await expect(page.locator('#canvasAssetsGrid')).toBeHidden();
    expect(requests.filter(r=>r.path==='/api/ai/assets')).toHaveLength(0);
    await expect(page.locator('main')).toHaveAttribute('inert','');
    await page.screenshot({path:testInfo.outputPath(`canvas-assets-${locale}-folders.png`)});
    await page.locator('#canvasAssetsFilter').selectOption(folderId);
    const image=page.locator(`#canvasAssetsGrid [data-asset-id="${assets[0].id}"]`);
    await expect(image.locator('img')).toBeVisible();
    if(locale==='de') await image.tap(); else await image.press('Enter');
    await expect(image).toHaveAttribute('data-reference-picker-order','1');
    await expect(page.locator('#canvasAssetsPickerCount')).toHaveText(/1 \/ 1/);
    expect(assignments).toHaveLength(0);
    await page.keyboard.press('Delete');
    expect(state.nodes).toHaveLength(2);
    await page.locator('#canvasAssetsPickerCancel').click();
    await expect(dialog).toBeHidden();await expect(choose).toBeFocused();
    expect(state.nodes[0].asset_id).toBeNull();expect(assignments).toHaveLength(0);
    await choose.click();
    await expect(page.locator('#canvasAssetsFolderGrid')).toBeVisible();
    await page.locator('#canvasAssetsFilter').selectOption(folderId);
    await image.click();
    await page.screenshot({path:testInfo.outputPath(`canvas-assets-${locale}-selection.png`)});
    const bounds=await dialog.evaluate(el=>{const shell=el.querySelector('.generate-lab-assets-overlay__shell').getBoundingClientRect();return {x:shell.x,right:shell.right,bottom:shell.bottom,width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth-innerWidth};});
    expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.right).toBeLessThanOrEqual(bounds.width);expect(bounds.bottom).toBeLessThanOrEqual(bounds.height+1);expect(bounds.overflow).toBeLessThanOrEqual(1);
    await page.locator('#canvasAssetsPickerApply').click();
    await expect(dialog).toBeHidden();
    expect(assignments).toEqual([{path:`/api/account/canvas/projects/${state.projects[0].id}/nodes/${nodeId}/asset-reference`,body:{asset_id:assets[0].id}}]);
    await expect(page.locator('.canvas-asset-name')).toHaveText(assets[0].title);
    await expect(page.locator('#canvasInspectorBody .canvas-output img')).toHaveAttribute('src',`/api/ai/images/${assets[0].id}/medium`);
    await page.reload();await page.locator(`[data-node-id="${nodeId}"]`).press('Enter');
    if (locale==='de') await page.locator('#canvasInspectorToggle').click();
    await expect(page.locator('.canvas-asset-name')).toHaveText(assets[0].title);
    await expect(page.locator('#canvasInspectorBody .canvas-output img')).toBeVisible();
    await page.screenshot({path:testInfo.outputPath(`canvas-assets-${locale}-inspector.png`)});
    expect(requests.filter(r=>r.method!=='GET')).toEqual([]);
    expect(errors).toEqual([]);
  });
});

test('Canvas asset picker retains all media types and rejects failed or stale assignment', async ({page})=>{
  const {state,assets,assignments,folderId,nodeId,otherId}=await prepareCanvasAssetPicker(page);
  const dialog=page.locator('#canvasAssetsOverlay');
  for (const asset of assets.slice(1)) {
    await page.locator('#canvasAssetChoose').click();
    await page.locator('#canvasAssetsFilter').selectOption(folderId);
    const card=page.locator(`#canvasAssetsGrid [data-asset-id="${asset.id}"]`);
    await card.click();
    await expect(page.locator('#canvasAssetsPickerApply')).toBeEnabled();
    if(asset===assets[1]) {
      state.assignmentStatus=403;
      await page.locator('#canvasAssetsPickerApply').click();
      await expect(page.locator('#canvasAssetsMessage')).toContainText('could not be assigned');
      await expect(dialog).toBeVisible();expect(state.nodes[0].asset_id).toBeNull();
      state.assignmentStatus=200;
    }
    await page.locator('#canvasAssetsPickerApply').click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('.canvas-asset-name')).toHaveText(asset.title);
    if(asset.asset_type==='video'||asset.asset_type==='sound') await expect(page.locator(`#canvasInspectorBody ${asset.asset_type==='video'?'video':'audio'}`)).toHaveAttribute('src',asset.file_url);
    else {await expect(page.locator('#canvasInspectorBody .canvas-output pre')).toHaveText(asset.preview_text);await expect(page.getByRole('link',{name:'Open file',exact:true})).toHaveAttribute('href',asset.file_url);}
  }
  const previous=structuredClone(state.nodes[0]);
  await page.locator('#canvasAssetChoose').click();
  await page.locator('#canvasAssetsFilter').selectOption(folderId);
  await page.locator(`#canvasAssetsGrid [data-asset-id="${assets[0].id}"]`).click();
  const count=assignments.length;
  // A queued selection event may arrive after the modal opens. It must revoke
  // its original target rather than assign to the newly selected node.
  await page.locator(`[data-node-id="${otherId}"]`).dispatchEvent('click');
  await expect(dialog).toBeHidden();
  expect(assignments).toHaveLength(count);expect(state.nodes[0]).toEqual(previous);expect(state.nodes[1].asset_id).toBeNull();
  await page.locator(`[data-node-id="${nodeId}"]`).press('Enter');
  await expect(page.locator('.canvas-asset-name')).toHaveText(assets[4].title);
});

test('Canvas asset picker cancelled during loading stays closed and late assignment cannot update another node',async({page})=>{
  let releaseFolders;const foldersReady=new Promise(resolve=>{releaseFolders=resolve;});
  const {state,assets,nodeId,otherId,assignments}=await prepareCanvasAssetPicker(page,{foldersReady});
  await page.locator('#canvasAssetChoose').click();
  await expect(page.locator('#canvasAssetsMessage')).toContainText('Loading');
  await page.keyboard.press('Escape');releaseFolders();
  await expect(page.locator('#canvasAssetsOverlay')).toBeHidden();
  await expect(page.locator('#canvasAssetChoose')).toBeFocused();
  await page.locator('#canvasAssetChoose').click();
  await expect(page.locator('#canvasAssetsFolderGrid .studio__folder-card')).toHaveCount(3);
  await page.locator('#canvasAssetsFolderGrid .studio__folder-card').first().press('Enter');
  await page.locator(`#canvasAssetsGrid [data-asset-id="${assets[0].id}"]`).click();
  let releaseAssignment;state.assignmentGate=new Promise(resolve=>{releaseAssignment=resolve;});
  await page.locator('#canvasAssetsPickerApply').click();
  await expect.poll(()=>assignments.length).toBe(1);
  await expect(page.locator('#canvasAssetsClose')).toBeDisabled();
  await page.locator(`[data-node-id="${otherId}"]`).dispatchEvent('click');
  await expect(page.locator('#canvasAssetsOverlay')).toBeHidden();
  releaseAssignment();
  await expect.poll(()=>state.nodes[0].asset_id).toBe(assets[0].id);
  await expect(page.locator('#canvasInspectorTitle')).toHaveText('Other reference');
  await expect(page.locator('.canvas-asset-name')).toHaveCount(0);
  expect(state.nodes[1].asset_id).toBeNull();
  expect(state.requests.filter(r=>r.method==='PATCH')).toEqual([]);
  expect(assignments[0].path).toContain(`/nodes/${nodeId}/`);
});

test('Canvas asset picker preserves legacy references and cancels on a project change',async({page})=>{
  const {state,assets,nodeId,assignments}=await prepareCanvasAssetPicker(page);
  const original=assets[0];
  state.nodes[0].asset_id=original.id;
  state.nodes[0].content={asset:{id:original.id,asset_type:'image',mime_type:'image/png',file_url:original.file_url,preview_url:original.thumb_url}};
  await page.reload();await page.locator(`[data-node-id="${nodeId}"]`).press('Enter');
  await expect(page.locator('.canvas-asset-name')).toHaveText(original.title);
  await expect(page.locator('#canvasInspectorBody .canvas-output img')).toHaveAttribute('src',original.thumb_url);
  await page.locator('#canvasAssetChoose').click();
  await page.locator('#canvasAssetsFolderGrid .studio__folder-card').first().click();
  await page.locator(`#canvasAssetsGrid [data-asset-id="${assets[1].id}"]`).click();
  await page.keyboard.press('Escape');
  expect(state.nodes[0].asset_id).toBe(original.id);expect(assignments).toEqual([]);
  expect(state.requests.filter(r=>r.method==='PATCH')).toEqual([]);
  await page.locator('#canvasAssetChoose').click();
  // A project navigation already queued before the modal is another stale
  // target. Exercise the existing project action, not a private test hook.
  page.once('dialog',dialog=>dialog.accept('Another project'));
  await page.locator('#canvasNewProject').dispatchEvent('click');
  await expect(page.locator('#canvasProjectTitle')).toHaveValue('Another project');
  await expect(page.locator('#canvasAssetsOverlay')).toBeHidden();
  expect(assignments).toEqual([]);
});

for (const locale of ['en', 'de']) test(`Canvas GPT Image 2.5 ${locale} sixteen reference persistence`, ({ page }) => require('./helpers/gpt-image25-ui.cjs').canvas({ page, expect, locale, mockSharedAuth, createCanvasApiMock }));

test('Canvas GPT Image 2.5 complete enum mapping, connected order and truthful edit gate', ({ page }) => require('./helpers/gpt-image25-ui.cjs').contract({ page, expect }));

test('Canvas GPT Image 2.5 delayed uploads never assign after model or reference selection changes', ({ page }) => require('./helpers/gpt-image25-ui.cjs').canvasLateUpload({ page, expect, mockSharedAuth, createCanvasApiMock }));

for(const locale of ['en','de']) test(`Canvas Omni ${locale}: connected roles, fixed operation price and activation`,async({page},testInfo)=>{
  await mockSharedAuth(page);
  let enabled=false;
  const {listCanvasModelsForRole}=await import('../js/shared/canvas-model-contract.mjs');
  const state=createCanvasApiMock(page,{modelPayload:{models:listCanvasModelsForRole('user'),organizations:[],access:{role:'user'}}});
  await page.route('**/api/model-pricing',async route=>route.fulfill({json:await require('./helpers/omni-model-controls.cjs').snapshot(enabled)}));
  const project='1'.repeat(32),node='a'.repeat(32),now=new Date().toISOString();
  state.projects.push({id:project,title:'Omni inputs',locale,created_at:now,updated_at:now});
  state.nodes.push({id:node,project_id:project,type:'video_generation',title:'Omni target',model_id:'google/gemini-omni-flash',x:30,y:30,config:{prompt:'Synthetic motion',resolution:'720p',aspectRatio:'16:9'},content:{}});
  for(const [i,kind] of ['image','video','audio'].entries()) {
    const id=String(i+2).repeat(32);state.nodes.push({id,project_id:project,type:'asset_reference',title:kind,x:340,y:30+i*160,content:{asset:{id:'reference-'+kind,asset_type:kind,mime_type:kind==='image'?'image/png':kind==='video'?'video/mp4':'audio/wav'}},config:{}});
    state.edges.push({id:String(i+4).repeat(32),project_id:project,source_node_id:id,target_node_id:node,config:{}});
  }
  await page.goto(locale==='de'?'/de/canvas/':'/canvas/');await page.locator(`[data-node-id="${node}"]`).first().click();
  const inspector=page.locator('#canvasInspectorBody'),roles=inspector.getByRole('combobox',{name:locale==='de'?'Eingaberolle':'Input role',exact:true}),run=inspector.locator('.canvas-button--primary');
  await expect(roles).toHaveCount(3);expect(await roles.evaluateAll(list=>list.map(s=>s.value))).toEqual(['reference_image','reference_video','reference_audio']);
  await expect(inspector.getByLabel(locale==='de'?'Dauer':'Duration',{exact:true})).toHaveCount(0);
  await expect(run).toBeDisabled();await expect(inspector.locator('.canvas-cost-note')).toContainText('53');
  enabled=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(run).toBeEnabled();
  await roles.first().selectOption('first_frame');await expect.poll(()=>state.nodes[0].config.omniRoles?.[state.edges[0].id]).toBe('first_frame');
  await inspector.getByRole('button',{name:locale==='de'?'Nach oben':'Move up',exact:true}).last().click();
  await expect.poll(()=>state.nodes[0].config.omniOrder).toEqual([state.edges[0].id,state.edges[2].id,state.edges[1].id]);
  await page.reload();await page.locator(`[data-node-id="${node}"]`).first().click();await expect(roles.first()).toHaveValue('first_frame');
  expect(await roles.evaluateAll(list=>list.map(s=>s.value))).toEqual(['first_frame','reference_audio','reference_video']);
  await page.setViewportSize({width:390,height:844});await page.locator('#canvasInspectorToggle').click();await roles.first().scrollIntoViewIfNeeded();await expect(roles.first()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath(`omni-canvas-${locale}-mobile.png`)});
  enabled=false;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(run).toBeDisabled();
});

for(const locale of ['en','de'])test(`Canvas Seedance 2.5 ${locale} ordered references and independent settings persist`,async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await mockSharedAuth(page);
 const {listCanvasModelsForRole}=await import('../js/shared/canvas-model-contract.mjs');
 const state=createCanvasApiMock(page,{modelPayload:{models:listCanvasModelsForRole('user'),organizations:[],access:{role:'user'}}});
 await page.route('**/api/model-pricing',async route=>route.fulfill({json:await require('./helpers/seedance25-model-controls.cjs').snapshot()}));
 const project='1'.repeat(32),node='a'.repeat(32),now=new Date().toISOString(),de=locale==='de';
 state.projects.push({id:project,title:'Seedance inputs',locale,created_at:now,updated_at:now});
 state.nodes.push({id:node,project_id:project,type:'video_generation',title:'Seedance target',model_id:'bytedance/seedance-2.5',x:30,y:30,config:{prompt:'Synthetic motion'},content:{}});
 for(const [i,kind] of ['image','video','audio'].entries()){
  const id=String(i+2).repeat(32);state.nodes.push({id,project_id:project,type:'asset_reference',title:kind,x:340,y:30+i*160,content:{asset:{id:'reference-'+kind,asset_type:kind,mime_type:kind==='image'?'image/png':kind==='video'?'video/mp4':'audio/wav'}},config:{}});
  state.edges.push({id:String(i+4).repeat(32),project_id:project,source_node_id:id,target_node_id:node,config:{}});
 }
 await page.goto(de?'/de/canvas/':'/canvas/');await page.locator(`[data-node-id="${node}"]`).first().press('Enter');
 const inspector=page.locator('#canvasInspectorBody'),root=inspector.locator('[data-seedance25-controls]'),roles=inspector.getByRole('combobox',{name:de?'Eingaberolle':'Input role',exact:true});
 await expect(roles).toHaveCount(3);await expect(root).toBeVisible();await root.locator('[data-seedance25-setting=workflow]').selectOption('edit');await expect(root.locator('[data-seedance25-setting=duration]')).toHaveValue('-1');await expect(root.locator('[data-seedance25-setting=duration]')).toBeDisabled();
 await roles.first().selectOption('first_frame');await expect(root.locator('[data-seedance25-setting=aspect_ratio]')).toHaveValue('adaptive');
 await root.locator('[data-seedance25-setting=output_format]').selectOption('mov');await expect.poll(()=>state.nodes[0].config.seedance25?.output_format).toBe('mov');
 await inspector.getByRole('button',{name:de?'Nach oben':'Move up',exact:true}).last().click();await expect.poll(()=>state.nodes[0].config.seedance25Order).toEqual([state.edges[0].id,state.edges[2].id,state.edges[1].id]);
 await page.reload();await page.locator(`[data-node-id="${node}"]`).first().press('Enter');await expect(root.locator('[data-seedance25-setting=workflow]')).toHaveValue('edit');expect(await roles.evaluateAll(list=>list.map(s=>s.value))).toEqual(['first_frame','reference_audio','reference_video']);
 await page.setViewportSize({width:390,height:844});await page.locator('#canvasInspectorToggle').click();await expect(root).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(state.requests.filter(r=>r.pathname.endsWith('/run'))).toEqual([]);expect(errors).toEqual([]);
});
