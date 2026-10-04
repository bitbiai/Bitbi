const id = n => n.toString(16).repeat(32);
const project = id(1), now = '2026-10-04T12:00:00.000Z';
const image = '/tests/fixtures/media/test-image.png', video = '/tests/fixtures/media/canvas-end-frame.mp4', audio = '/tests/fixtures/media/member-music.mp3';
const outputFor = (media, n = 2) => ({kind: media === 'music' ? 'audio' : media, runId: id(n + 6), assetId: 'asset-' + n, sourceVersion: 'a'.repeat(64), storage: 'canvas',
  asset: {id: 'asset-' + n, ...(media === 'image' ? {preview_url: image} : {file_url: media === 'video' ? video : audio})}});
const nodeFor = (media, n = 2) => ({id:id(n), project_id:project, type:media + '_generation', title:media, x:50 + (n-2)*250, y:50,
  model_id: media === 'image' ? '@cf/black-forest-labs/flux-1-schnell' : media === 'video' ? 'pixverse/v6' : 'minimax/music-2.6',
  config:{prompt:'Controlled sample'}, content:{}, created_at:now, updated_at:now});

async function setup({page, locale, mockSharedAuth, createCanvasApiMock}) {
  const {listCanvasModelsForRole} = await import('../../js/shared/canvas-model-contract.mjs');
  await mockSharedAuth(page);
  await page.setViewportSize({width:locale === 'de' ? 390 : 1440, height:900});
  const state = createCanvasApiMock(page, {modelPayload:{models:listCanvasModelsForRole('user'), organizations:[], access:{role:'user'}}});
  state.projects=[{id:project, title:'Inspector fixture', locale, created_at:now, updated_at:now}];
  const errors=[]; page.on('pageerror', error=>errors.push(error.message));
  const visit=()=>page.goto(locale === 'de' ? '/de/canvas/' : '/canvas/');
  const select=async n=>{
    const toggle=page.locator('#canvasInspectorToggle');
    if (locale === 'de' && await toggle.getAttribute('aria-expanded') === 'true') await toggle.click();
    await page.locator(`[data-node-id="${id(n)}"]`).press('Enter');
    if (locale === 'de') await toggle.click();
  };
  return {state, visit, select, errors, inspector:page.locator('#canvasInspectorBody')};
}

exports.generation = async options => {
  const {page, expect, locale, media, info}=options, de=locale==='de';
  const {state, visit, select, errors, inspector}=await setup(options);
  const node=nodeFor(media); state.nodes=[node, {...nodeFor('image',3), type:'note', title:'Other', config:{}, content:{text:'Unchanged'}}];
  if(media==='video') {
    state.nodes.push({...nodeFor('image',4),type:'asset_reference',title:'Reference image',asset_id:'reference',content:{asset:{id:'reference',asset_type:'image',preview_url:image,file_url:image}}});
    state.edges=[{id:id(5),project_id:project,source_node_id:id(4),target_node_id:node.id,config:{}}];
  }
  const output=outputFor(media), settings=inspector.locator('.canvas-generation-settings'), status=inspector.locator('#canvasNodeRunStatus');
  const runButton=inspector.getByRole('button',{name:de?'Ausführen':'Run',exact:true});
  const mediaElement=inspector.locator('.canvas-output > '+({image:'img',video:'video',music:'audio'}[media]));
  const calls=[]; let pending;
  await page.route('**/nodes/*/run', async route=>{
    calls.push(route.request().postDataJSON());
    const reply=await new Promise(resolve=>{pending=resolve;});
    if(reply==='network-error')return route.fulfill({status:503,json:{ok:false,code:'service_unavailable',error:'Controlled unavailable'}});
    const run={id:id(8), node_id:node.id, project_id:project, status:reply?'completed':'failed', created_at:now, ...(reply?{output}:{error_message:'Controlled failure',error_code:'generation_failed'})};
    state.runs=[run]; if(reply)node.output=output;
    await route.fulfill({status:reply?200:502,json:{ok:reply,...(!reply?{code:'generation_failed',error:'Controlled failure'}:{}),data:{run}}});
  });
  await page.route('**/full-video',route=>route.fulfill({json:{ok:true,data:{eligible:false,availableClips:[]}}}));
  // A restored cancelled/failed/queued first attempt is never completion.
  for(const phase of ['cancelled','failed','queued']) {
    state.runs=[{id:id(8),node_id:node.id,status:phase,created_at:now}];
    await visit();await select(2);await expect(settings).toHaveCount(0);await expect(runButton).toBeVisible();
  }
  await runButton.click();await expect.poll(()=>calls.length).toBe(1);
  await expect(settings).toHaveCount(0);await expect(status).toHaveText(de?'Wird ausgeführt':'Running');pending(false);
  await expect(status).toHaveText('Controlled failure');await expect(settings).toHaveCount(0);
  await runButton.click();await expect.poll(()=>calls.length).toBe(2);pending(true);
  await expect(settings).toHaveJSProperty('open',false);await expect(runButton).toBeHidden();await expect(mediaElement).toBeVisible();
  await expect(inspector.getByRole('button',{name:de?'In Assets speichern':'Save to Assets',exact:true})).toBeVisible();
  const summary=settings.locator(':scope > summary');await summary.focus();await page.keyboard.press('Enter');await expect(settings).toHaveJSProperty('open',true);
  if(media==='image')await inspector.locator('.canvas-additional-prompt > summary').click();
  const prompt=inspector.getByLabel(media==='image'?(de?'Zusätzlicher Prompt':'Additional prompt'):'Prompt',{exact:true});
  await prompt.fill('Retained draft');
  await inspector.getByRole('textbox',{name:de?'Titel':'Title',exact:true}).fill('Renamed result');
  await expect.poll(()=>node.config.prompt).toBe('Retained draft');
  await select(3);await select(2);await expect(settings).toHaveJSProperty('open',true);
  if(media==='video')await expect(inspector.getByRole('img',{name:'Reference image',exact:true})).toBeVisible();
  // Reopened nested prompt and its draft survive a complete Inspector rebuild.
  await expect(prompt).toHaveValue('Retained draft');await expect(inspector.getByRole('textbox',{name:de?'Titel':'Title',exact:true})).toHaveValue('Renamed result');
  await runButton.click();await expect.poll(()=>calls.length).toBe(3);
  await summary.click();await expect(settings).toHaveJSProperty('open',false);await expect(status).toBeVisible();await expect(status).toHaveText(de?'Wird ausgeführt':'Running');
  pending(false);await expect(status).toHaveText('Controlled failure');await expect(settings).toHaveJSProperty('open',false);await expect(mediaElement).toBeVisible();
  expect(node.output).toEqual(output);
  await page.reload();await select(2);await expect(settings).toHaveJSProperty('open',false);await expect(mediaElement).toBeVisible();await expect(status).toHaveText('Controlled failure');
  await summary.focus();await page.keyboard.press('Space');await expect(settings).toHaveJSProperty('open',true);await expect(prompt).toHaveValue('Retained draft');
  await runButton.click();await expect.poll(()=>calls.length).toBe(4);pending('network-error');
  await expect(status).toHaveText('Controlled unavailable');await summary.click();await expect(status).toBeVisible();await expect(mediaElement).toBeVisible();
  expect(calls).toHaveLength(4);expect(errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(de)await page.evaluate(()=>document.documentElement.dataset.theme='light');
  await inspector.screenshot({path:info.outputPath(`generation-${media}-${locale}.png`)});
};

exports.merge = async options => {
  const {page, expect, locale, info}=options,de=locale==='de';
  const {state,visit,select,errors,inspector}=await setup(options);
  state.nodes=[nodeFor('video'),nodeFor('video',3)];state.nodes.forEach((node,index)=>{node.output=outputFor('video',index+2);});
  state.edges=[{id:id(5),project_id:project,source_node_id:id(2),target_node_id:id(3),config:{}}];
  const graph=JSON.stringify(state.edges),posts=[];let phase='ready';
  const clips=state.nodes.map(node=>({nodeId:node.id,runId:node.output.runId,assetId:node.output.assetId,version:node.output.sourceVersion,modelId:node.model_id,createdAt:now}));
  const completed={id:id(12),status:'ready',storage:'canvas',asset:{id:id(13),file_url:video},preview_base:{file_url:video},recipe:{videos:clips},audio_timeline:[]};
  await page.route('**/full-video',route=>{
    if(route.request().method()==='POST')posts.push(route.request().postDataJSON());
    return route.fulfill({json:{ok:true,data:{eligible:true,availableClips:clips,current:completed,export:{...completed,status:phase}}}});
  });
  await visit();await select(3);
  const settings=inspector.locator('.canvas-merge-settings'),summary=settings.locator(':scope > summary'),group=settings.locator('.canvas-clip-sequence');
  const create=inspector.getByRole('button',{name:de?'Gesamtes Video erneut erstellen':'Create full video again',exact:true});
  await expect(settings).toHaveJSProperty('open',false);await expect(create).toBeVisible();await expect(create).toBeEnabled();
  await expect(inspector.getByRole('status',{name:de?'Exportstatus':'Export status',exact:true})).toBeVisible();
  const result=inspector.locator('.canvas-full-video > div:last-child > video');await expect(result).toBeVisible();
  await summary.focus();await page.keyboard.press('Enter');await expect(group.locator('li')).toHaveCount(2);
  await group.getByRole('radio',{name:de?'Clips und Reihenfolge auswählen':'Choose clips and order'}).check();
  await group.getByLabel('Clip 1',{exact:true}).selectOption(id(8));
  await group.getByRole('button',{name:de?'Nach unten: Clip 1':'Move down: Clip 1',exact:true}).click();
  const smooth=settings.getByRole('checkbox',{name:de?'Sanft zusammenführen':'Smooth joins',exact:true});await smooth.check();
  await summary.click();await expect(settings).toHaveJSProperty('open',false);await expect(create).toBeVisible();expect(posts).toEqual([]);
  await summary.click();await expect(group.getByLabel('Clip 1',{exact:true})).toHaveValue(id(9));await expect(smooth).toBeChecked();
  await select(2);await select(3);await expect(settings).toHaveJSProperty('open',true);await expect(smooth).toBeChecked();
  await expect(group.getByLabel('Clip 1',{exact:true})).toHaveValue(id(9));
  await summary.click();phase='failed';await inspector.getByRole('button',{name:de?'Status aktualisieren':'Refresh status',exact:true}).click();
  await expect(inspector.getByRole('status',{name:de?'Exportstatus':'Export status',exact:true})).toContainText(de?'fehlgeschlagen':'failed');
  await expect(settings).toHaveJSProperty('open',false);await create.click();await expect.poll(()=>posts.length).toBe(1);
  expect(posts[0].orderedClips.map(clip=>clip.runId)).toEqual([id(9),id(8)]);expect(posts[0].smoothJoins).toBe(true);
  await result.evaluate(v=>v.play());await expect.poll(()=>result.evaluate(v=>v.currentTime)).toBeGreaterThan(.1);await result.evaluate(v=>v.pause());
  await expect(inspector.getByRole('link',{name:de?'Gesamtvideo herunterladen':'Download full video'})).toHaveAttribute('href',video+'?download=1');
  await inspector.getByRole('button',{name:de?'Gesamtvideo in Assets speichern':'Save full video to Assets',exact:true}).click();await expect.poll(()=>posts.length).toBe(2);expect(posts[1].saveExportId).toBe(completed.id);
  expect(JSON.stringify(state.edges)).toBe(graph);expect(state.requests.filter(r=>r.pathname.endsWith('/run'))).toEqual([]);expect(errors).toEqual([]);
  await inspector.screenshot({path:info.outputPath(`merge-${locale}.png`)});
};

exports.icons = async options => {
  const {page,expect,locale,info}=options;
  const {state,visit,select,errors}=await setup(options);
  state.nodes=[nodeFor('image'),nodeFor('video',3),nodeFor('music',4),{...nodeFor('image',5),type:'asset_reference',asset_id:'selected',content:{}},{...nodeFor('image',6),type:'note'}];
  await visit();
  for(const [n,kind] of [[2,'image'],[3,'video'],[4,'audio'],[5,'asset']]) await expect(page.locator(`[data-node-id="${id(n)}"] [data-media-icon]`)).toHaveAttribute('data-media-icon',kind);
  await expect(page.locator(`[data-node-id="${id(6)}"] .canvas-node__mark`)).toHaveCount(1);
  const measure=()=>page.locator(`[data-node-id="${id(5)}"]`).evaluate(card=>{
    const icon=card.querySelector('svg'),title=card.querySelector('.canvas-node__type > span'),style=getComputedStyle(card),port=card.querySelector('[data-port="out"]');
    return {width:parseFloat(style.width),height:card.offsetHeight,font:parseFloat(getComputedStyle(title).fontSize),icon:parseFloat(getComputedStyle(icon).width),portTop:port.offsetTop,portRight:parseFloat(getComputedStyle(port).right)};
  });
  const before=await measure();expect(before.width).toBe(230);expect(before.icon/before.font).toBeCloseTo(1.2,2);expect(before.portTop).toBe(46);expect(before.portRight).toBe(-13);
  // Reload the same reference identity with actual server media metadata. Model,
  // title and filename deliberately disagree with the resolved type.
  for(const [assetType,kind] of [['video','video'],['image','image'],['music','audio'],['file','asset']]) {
    state.nodes[3].content={asset:{id:'selected',asset_type:assetType,title:'Misleading music.mp3'}};
    await page.reload();await expect(page.locator(`[data-node-id="${id(5)}"] [data-media-icon]`)).toHaveAttribute('data-media-icon',kind);
    expect(await measure()).toEqual(before);
  }
  await select(2);const card=page.locator(`[data-node-id="${id(2)}"]`);await card.press('ArrowRight');await expect.poll(()=>state.nodes[0].x).toBe(60);
  expect(errors).toEqual([]);expect(state.requests.filter(r=>r.pathname.endsWith('/run'))).toEqual([]);
  // Also exercise the existing picker/assignment API without a page reload.
  const picker=await options.prepareCanvasAssetPicker(page,{locale});
  for(const [index,kind] of [[0,'image'],[1,'video'],[2,'audio'],[3,'asset']]) {
    await page.locator('#canvasAssetChoose').click();await page.locator('#canvasAssetsFilter').selectOption(picker.folderId);
    await page.locator(`#canvasAssetsGrid [data-asset-id="${picker.assets[index].id}"]`).click();
    await page.locator('#canvasAssetsPickerApply').click();
    await expect(page.locator(`[data-node-id="${picker.nodeId}"] [data-media-icon]`)).toHaveAttribute('data-media-icon',kind);
  }
  expect(picker.assignments).toHaveLength(4);expect(errors).toEqual([]);
  await page.screenshot({path:info.outputPath(`icons-${locale}.png`)});
};
