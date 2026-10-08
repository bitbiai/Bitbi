const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
exports.workspace=async({page,expect,locale,mockSharedAuth,createCanvasApiMock,info})=>{
  const de=locale==='de',id=n=>String(n).repeat(32),now=new Date().toISOString();
  await page.setViewportSize({width:de?390:1440,height:950});await mockSharedAuth(page);
  const state=createCanvasApiMock(page),errors=[],sizes=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.method()==='PATCH'&&new URL(r.url()).pathname.endsWith('/projects/'+id(1)))sizes.push(r.postDataJSON());});
  state.projects=[{id:id(1),title:'Workspace bounds',locale,created_at:now,updated_at:now}];
  state.nodes=[{id:id(2),project_id:id(1),type:'note',title:'Origin',x:100,y:80,config:{},content:{text:'Near'},created_at:now,updated_at:now},
    {id:id(3),project_id:id(1),type:'note',title:'Far node with a longer visible title',x:2076,y:1750,config:{},content:{text:'Actual full card geometry'},created_at:now,updated_at:now}];
  const other={id:id(9),title:'Other workspace',locale,workspace_width:700,workspace_height:450,created_at:now,updated_at:now};state.projects.push(other);
  await page.route(`**/api/account/canvas/projects/${other.id}`,route=>route.fulfill({json:{ok:true,data:{project:other,nodes:[],edges:[],runs:[]}}}));
  await page.goto(de?'/de/canvas/':'/canvas/');
  const controls=page.locator('.canvas-view-controls'),width=controls.getByRole('spinbutton',{name:de?'Breite':'Width',exact:true}),height=controls.getByRole('spinbutton',{name:de?'Höhe':'Height',exact:true});
  const fit=controls.getByRole('button',{name:de?'Gesamten Graph einpassen':'Fit the whole graph',exact:true});
  const near=page.locator(`[data-node-id="${id(2)}"]`),far=page.locator(`[data-node-id="${id(3)}"]`);
  await expect(width).toHaveValue('2400');await expect.poll(()=>height.inputValue().then(Number)).toBeGreaterThan(1750);
  await fit.click();const positions=state.nodes.map(n=>[n.x,n.y]);
  const zoom=await page.locator('#canvasSurface').evaluate(s=>new DOMMatrix(getComputedStyle(s).transform).a);expect(zoom).toBeLessThan(1);
  const viewport=await page.locator('#canvasViewport').boundingBox();for(const node of [near,far]){const b=await node.boundingBox();expect(b.x).toBeGreaterThanOrEqual(viewport.x-1);expect(b.y+b.height).toBeLessThanOrEqual(viewport.y+viewport.height+1);}
  expect(state.nodes.map(n=>[n.x,n.y])).toEqual(positions);
  await near.focus();await near.press('ArrowRight');await expect.poll(()=>state.nodes[0].x).toBe(110);
  // Native WebKit delivers integer CSS pointer coordinates. Assert the requested
  // integer screen displacement in Canvas coordinates; unscaled dragging fails.
  const box=await near.locator('.canvas-node__head').boundingBox(),start={x:Math.round(box.x+box.width/2),y:Math.round(box.y+box.height/2)},delta={x:Math.round(40*zoom),y:Math.round(20*zoom)};
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(start.x+delta.x,start.y+delta.y,{steps:4});await page.mouse.up();
  await expect.poll(()=>state.nodes[0].x).toBeCloseTo(110+delta.x/zoom,1);await expect.poll(()=>state.nodes[0].y).toBeCloseTo(80+delta.y/zoom,1);
  await width.fill('4000');await width.press('Enter');await expect.poll(()=>state.projects[0].workspace_width).toBe(4000);await expect(width).toBeEnabled();
  await height.fill('3000');await height.press('Enter');await expect.poll(()=>state.projects[0].workspace_height).toBe(3000);await expect(height).toBeEnabled();expect(sizes).toHaveLength(2);
  await width.fill('2076');await width.press('Enter');await expect(width).toHaveValue('4000');await expect(controls.locator('.canvas-workspace-minimum')).toContainText('2319');
  const minH=await height.getAttribute('min');expect(Number(minH)).toBeGreaterThan(1750);expect(Number(minH)).toBeLessThan(2300);
  await height.fill('1750');await height.press('Enter');await expect(height).toHaveValue('3000');expect(state.projects[0].workspace_height).toBe(3000);
  await page.reload();await expect(width).toHaveValue('4000');await expect(height).toHaveValue('3000');await fit.click();
  page.once('dialog',dialog=>dialog.accept());await far.press('Enter');await far.press('Delete');
  await expect(far).toHaveCount(0);await expect.poll(async()=>Number(await width.getAttribute('min'))).toBeLessThan(500);
  await width.fill('500');await width.press('Enter');await expect.poll(()=>state.projects[0].workspace_width).toBe(500);
  await height.fill('400');await height.press('Enter');await expect.poll(()=>state.projects[0].workspace_height).toBe(400);
  const projects=page.locator('#canvasProjectsToggle');
  if(de&&await projects.getAttribute('aria-expanded')!=='true')await projects.click();
  await page.locator('.canvas-project-item__open').filter({hasText:'Other workspace'}).click();if(de)await page.locator('#canvasGraphToggle').click();await expect(width).toHaveValue('700');await expect(height).toHaveValue('450');
  if(de&&await projects.getAttribute('aria-expanded')!=='true')await projects.click();
  await page.locator('.canvas-project-item__open').filter({hasText:'Workspace bounds'}).click();if(de)await page.locator('#canvasGraphToggle').click();await expect(width).toHaveValue('500');await expect(height).toHaveValue('400');
  let rejectSave=true;await page.route(`**/api/account/canvas/projects/${id(1)}`,route=>route.request().method()==='PATCH'&&rejectSave?route.fulfill({status:503,json:{ok:false,error:'Controlled save failure'}}):route.fallback());
  await width.fill('600');await width.press('Enter');await expect(controls.locator('.canvas-workspace-minimum')).toContainText(de?'nicht gespeichert':'not saved');await expect(width).toHaveValue('500');expect(state.projects[0].workspace_width).toBe(500);rejectSave=false;
  await page.reload();await expect(width).toHaveValue('500');await expect(height).toHaveValue('400');
  await page.locator('#canvasNodeType').selectOption('note');await page.locator('#canvasAddNode').click();await expect.poll(()=>state.nodes.length).toBe(2);
  const added=state.nodes.at(-1);expect(added.x).toBeGreaterThanOrEqual(13);expect(added.x).toBeLessThanOrEqual(257);expect(added.y).toBeLessThanOrEqual(274);
  expect(await controls.locator('input').evaluateAll(inputs=>inputs.every(i=>i.labels.length))).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
  await controls.screenshot({path:info.outputPath(`workspace-${locale}.png`)});
};
exports.transitions=async({page,expect,locale,mockSharedAuth,createCanvasApiMock,info})=>{
  const {SqliteD1Database,applyAuthMigrations}=require('./sqlite-d1.js'),{createAuthTestEnv}=require('./auth-worker-harness.js');
  const {canvasAudioFixture}=await import('./canvas-audio-control.mjs'),{transitionFixture}=await import('../../services/homepage-ffmpeg-processor/canvas-transitions.test.mjs');
  const {processCanvasExports}=await import('../../services/homepage-ffmpeg-processor/canvas-full-video.mjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-transitions-ui-')),files=await transitionFixture(dir),DB=new SqliteD1Database();applyAuthMigrations(DB);
  const media=name=>fs.readFileSync(path.join(__dirname,'../fixtures/media',name)).toString('base64');
  const f=await canvasAudioFixture({...createAuthTestEnv(),DB},{videoBase64:fs.readFileSync(files[0]).toString('base64'),importVideoBase64:fs.readFileSync(files[1]).toString('base64'),musicBase64:media('member-music.mp3'),imageBase64:media('h3-frame.png')});
  // A real nine-video directed chain, with generated outputs, imported
  // references and a late transition followed by an independent hard cut.
  const prefix=[];
  for(let i=0;i<5;i++){
    const node=(await f.data(await f.request(f.projectPath+'/nodes','POST',{type:'asset_reference',title:'Earlier '+i,x:60,y:500+i*30}))).node;
    await f.data(await f.request(`${f.projectPath}/nodes/${node.id}/asset-reference`,'POST',{asset_id:f.asset.id}));prefix.push(node.id);
  }
  const order=[...prefix,...f.order];
  for(let i=0;i<5;i++)await f.data(await f.request(f.projectPath+'/edges','POST',{source_node_id:order[i],target_node_id:order[i+1]}));
  await f.data(await f.request(`${f.projectPath}/nodes/${f.last.id}`,'PATCH',{config:{backgroundMusic:{enabled:locale==='de',gain:.2,musicAssetId:f.musicId,fadeIn:.2,fadeOut:.3}}}));
  f.snapshot=await f.readProject();
  const de=locale==='de',errors=[],posts=[];let rendering=Promise.resolve();
  await page.setViewportSize({width:de?390:1440,height:1000});await mockSharedAuth(page);createCanvasApiMock(page);page.on('pageerror',e=>errors.push(e.message));
  const processor=()=>processCanvasExports({baseUrl:'https://bitbi.ai',limit:1,authHeaders:headers=>({Authorization:'Bearer synthetic-audio-processor',...headers}),
    requestJson:async(url,init={})=>{const response=await f.request(url,init.method||'GET',init.body,{Authorization:'Bearer synthetic-audio-processor',...init.headers});const data=await response.json();expect(response.ok,JSON.stringify(data)).toBe(true);return data;},fetchImpl:(url,init)=>f.request(url.pathname+url.search,'GET',null,init.headers)});
  await page.route(/\/api\/(account\/canvas\/|ai\/(generation-jobs\/|text-assets\/|images\/|audio\/))/,async route=>{
    const req=route.request(),url=new URL(req.url()),response=await f.request(url.pathname+url.search,req.method(),req.postData(),{...(req.headers()['idempotency-key']?{'Idempotency-Key':req.headers()['idempotency-key']}:{}),...(req.headers().range?{Range:req.headers().range}:{})});
    const bytes=Buffer.from(await response.arrayBuffer());await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:bytes});
    if(req.method()==='POST'&&url.pathname.endsWith('/full-video')&&req.postDataJSON()?.backgroundMusic){posts.push({endpoint:url.pathname,body:req.postDataJSON(),result:JSON.parse(bytes)});rendering=rendering.then(processor);}
  });
  const toggle=page.locator('#canvasInspectorToggle'),inspector=page.locator('#canvasInspectorBody');
  const reveal=async()=>{if(de&&await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();};
  const selectEdge=async()=>{if(de&&await toggle.getAttribute('aria-expanded')==='true')await toggle.click();await page.locator(`[data-edge-id="${f.edges[1].id}"] .canvas-edge-hit`).press('Enter');await reveal();};
  try{
    await page.goto(de?'/de/canvas/':'/canvas/');await selectEdge();
    const control=inspector.locator('.canvas-transition-controls'),select=control.getByRole('combobox',{name:de?'Effekt':'Effect',exact:true});
    await expect(select).toHaveValue('none');await expect(select.locator('option')).toHaveCount(14);await expect(control.getByRole('spinbutton')).toHaveCount(0);
    await select.selectOption('flash');await expect(control.getByRole('status')).toHaveText(de?'Gespeichert':'Saved');
    await expect.poll(async()=>(await f.readProject()).edges.find(e=>e.id===f.edges[1].id).config.transition.preset).toBe('flash');expect(posts).toHaveLength(0);
    await page.reload();await selectEdge();await expect(select).toHaveValue('flash');
    await control.getByRole('button',{name:de?'Übergangsvorschau erstellen':'Preview transition',exact:true}).click();await expect.poll(()=>posts.length).toBe(1);await rendering;
    const preview=control.locator('video');await expect(preview).toBeVisible();await preview.scrollIntoViewIfNeeded();await preview.evaluate(v=>v.play());await expect.poll(()=>preview.evaluate(v=>({time:v.currentTime>.25,decoded:v.videoWidth===320,error:v.error?.code||0}))).toEqual({time:true,decoded:true,error:0});await preview.evaluate(v=>v.pause());
    expect(posts[0].result.data.preview.recipe.version).toBe(6);expect(posts[0].body.orderedClips).toHaveLength(2);
    await control.screenshot({path:info.outputPath(`transition-${locale}.png`)});
    if(de)await toggle.click();await page.locator(`[data-node-id="${f.last.id}"]`).press('Enter');await reveal();
    await require('./canvas-inspector-actions.cjs').openCanvasSettings(page,'merge');
    const sequence=inspector.locator('.canvas-clip-sequence');
    await sequence.getByRole('radio',{name:de?'Diese Kette zusammenfügen':'Merge this chain',exact:true}).check();
    await expect(sequence.locator('li')).toHaveCount(9);
    if(!de){ // Manual and automatic admission feed the same renderer.
      await sequence.getByRole('radio',{name:'Choose clips and order',exact:true}).check();
      const view=await f.data(await f.request(f.endpoint));
      for(let i=0;i<9;i++){
        if(i>=2)await sequence.getByRole('button',{name:'Add clip',exact:true}).click();
        const clip=view.availableClips.find(c=>c.nodeId===order[i]);
        await sequence.getByRole('combobox',{name:`Clip ${i+1}`,exact:true}).selectOption(clip.runId||'node:'+clip.nodeId);
      }
    }
    await inspector.getByRole('button',{name:de?'Gesamtes Video mit Hintergrundmusik erstellen':'Create full video',exact:true}).click();await expect.poll(()=>posts.length).toBe(2);await rendering;
    await inspector.getByRole('button',{name:de?'Status aktualisieren':'Refresh status',exact:true}).click();
    const current=(await f.data(await f.request(f.endpoint))).current;expect(current.recipe.version).toBe(6);expect(current.duration).toBe(13);expect(current.recipe.videos).toHaveLength(9);expect(current.recipe.transitions.map(t=>t.preset)).toEqual([...Array(6).fill('none'),'flash','none']);expect(current.recipe.originalAudioPolicy).toBe('fit-picture-v1');expect(current.recipe.backgroundMusic.enabled).toBe(de);
    const identity=inspector.getByLabel(de?'Angezeigter Export':'Displayed export',{exact:true});await expect(identity).toHaveAttribute('data-export-id',current.id);await expect(identity).not.toContainText(de?'Vorherige':'Previous');
    const video=inspector.locator('.canvas-full-video > div:last-child > video');await expect(video).toHaveAttribute('src',current.asset.file_url);await video.scrollIntoViewIfNeeded();await video.evaluate(v=>v.play());await expect.poll(()=>video.evaluate(v=>v.currentTime)).toBeGreaterThan(.25);await video.evaluate(v=>v.pause());
    const data=Buffer.from(await (await f.request(current.asset.file_url)).arrayBuffer()),download=Buffer.from(await (await f.request(current.asset.file_url+'?download=1')).arrayBuffer());expect(data.equals(download)).toBe(true);
    // A pair preview belongs to its transition target, not the later export endpoint.
    // Cross-subject lookup must remain rejected even for the same owner/project.
    const wrongSubject=await f.request(`${f.endpoint}?seamPreview=${posts[0].result.data.preview.id}`);
    expect(wrongSubject.status).toBe(404);expect((await wrongSubject.json()).code).toBe('canvas_preview_unavailable');
    const comparison=await f.data(await f.request(`${posts[0].endpoint}?seamPreview=${posts[0].result.data.preview.id}`));
    expect(comparison.preview.id).toBe(posts[0].result.data.preview.id);
    expect(comparison.preview.duration).toBe(2.5);
    await expect(inspector.getByRole('link',{name:de?'Gesamtvideo herunterladen':'Download full video',exact:true})).toHaveAttribute('href',current.asset.file_url+'?download=1');
    await inspector.getByRole('button',{name:de?'Gesamtvideo in Assets speichern':'Save full video to Assets',exact:true}).click();await expect.poll(async()=>(await f.data(await f.request(f.endpoint))).current.storage).toBe('assets');
    const graph=await f.readProject();expect(graph.nodes.length).toBe(f.snapshot.nodes.length);expect(graph.edges.length).toBe(f.snapshot.edges.length);expect(errors).toEqual([]);expect(f.calls).toHaveLength(0);
    await info.attach('transition-real-worker-ffmpeg',{contentType:'application/json',body:JSON.stringify({provider:'synthetic',providerCalls:0,preview:posts[0].result.data.preview.id,export:current.id,seconds:current.duration,downloadBytes:data.length,saved:true,played:true})});
  }finally{await rendering;await page.unrouteAll({behavior:'wait'});DB.close();fs.rmSync(dir,{recursive:true,force:true});}
};
