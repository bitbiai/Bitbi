module.exports=async options=>{
  const {page,expect,locale,info}=options,de=locale==='de';
  const {setup,nodeFor,outputFor,id,project,now}=require('./canvas-inspector-ui.cjs').fixture;
  const {state,visit,select,errors,inspector}=await setup(options);
  state.nodes=[nodeFor('video'),nodeFor('video',3)];state.nodes.forEach((n,i)=>{n.output={...outputFor('video',i+2),previewUrl:'/api/plain/canvas-preview/poster.jpg'};});
  state.edges=[{id:id(5),project_id:project,source_node_id:id(2),target_node_id:id(3),config:{}}];
  const clips=state.nodes.map(n=>({nodeId:n.id,runId:n.output.runId,assetId:n.output.assetId,version:n.output.sourceVersion,modelId:n.model_id,createdAt:now}));
  const media='/api/plain/canvas-preview/video.mp4',old={id:id(12),status:'ready',storage:'canvas',asset:{id:id(13),file_url:media},recipe:{videos:clips},audio_timeline:[]};
  const posts=[],accepted=new Map();let latest=old,reads=0,losePost=false,stall=false,delayed=[];
  await page.route(/\/full-video(?:\?.*)?$/,async route=>{
    const req=route.request(),key=req.headers()['idempotency-key'],url=new URL(req.url());
    if(req.method()==='POST'){
      const body=req.postDataJSON();posts.push({key,body});
      if(!body.saveExportId){latest={id:String(posts.length).padStart(32,'0'),status:'processing'};accepted.set(key,latest);}
      if(losePost){losePost=false;return route.abort('failed');}
    }else {reads++;if(stall){delayed.push(route);return;}}
    const lookup=url.searchParams.get('requestKey');
    return route.fulfill({json:{ok:true,data:{eligible:true,availableClips:clips,current:old,export:lookup?accepted.get(lookup)||latest:latest,...(lookup?{submission:{found:accepted.has(lookup)}}:{})}}});
  });
  await visit();await select(3);
  await require('./canvas-inspector-actions.cjs').openCanvasSettings(page,'merge');
  await inspector.getByRole('radio',{name:de?'Diese Kette zusammenfügen':'Merge this chain',exact:true}).check();
  const create=inspector.getByRole('button',{name:de?'Gesamtes Video erneut erstellen':'Create full video again',exact:true});
  const refresh=inspector.getByRole('button',{name:de?'Status aktualisieren':'Refresh status',exact:true});
  const connection=inspector.getByRole('status',{name:de?'Statusverbindung':'Status connection',exact:true});
  const message=inspector.getByRole('status',{name:de?'Exportstatus':'Export status',exact:true});
  const identity=inspector.getByLabel(de?'Angezeigter Export':'Displayed export',{exact:true});
  const displayed=inspector.locator('.canvas-full-video > div:last-child > video');
  await expect(create).toBeEnabled();await page.clock.install();await page.clock.pauseAt(new Date());
  await create.click();await expect.poll(()=>posts.length).toBe(1);await expect(connection).toHaveText('');await expect(create).toBeDisabled();
  await expect(identity).toContainText(de?'Vorherige fertige Version':'Previous completed version');
  await expect(displayed).toHaveAttribute('src',media);
  // Consume the real per-job budget under controlled time. Still processing is
  // not failure: the old implementation stopped silently and never reset it.
  for(let i=1;i<120;i++){
    const before=reads;await page.clock.runFor(5000);
    await expect.poll(()=>reads).toBeGreaterThan(before);
    if(i<119)await expect(connection).toHaveText('');
  }
  await expect(connection).toContainText(de?'pausiert':'paused');await expect(create).toBeDisabled();
  latest={...latest,status:'failed',error_code:'canvas_media_filter_invalid'};
  await refresh.click();await expect(message).toContainText(de?'Dieser Versuch ist beendet':'This attempt has ended');await expect(create).toBeEnabled();
  await create.click();await expect.poll(()=>posts.length).toBe(2);await expect(connection).toHaveText('');
  const before=reads;await page.clock.runFor(5000);await expect.poll(()=>reads).toBeGreaterThan(before);await expect(connection).toHaveText('');
  latest={...latest,status:'failed'};await refresh.click();await expect(create).toBeEnabled();
  // Accepted POST whose response is lost retains its identity through reopen.
  losePost=true;await create.click();await expect.poll(()=>posts.length).toBe(3);
  await expect(connection).toContainText(de?'nicht bestätigt':'not yet confirmed');await expect(create).toBeDisabled();
  await select(2);await select(3);await expect(connection).toHaveText('');await expect(create).toBeDisabled();expect(posts).toHaveLength(3);
  latest={...latest,status:'failed'};await refresh.click();await expect(create).toBeEnabled();
  // A hung read reaches a bounded deadline. Refresh actively reconnects and
  // a late old response cannot overwrite the recovered terminal state.
  stall=true;await refresh.click();await expect.poll(()=>delayed.length).toBe(1);
  await page.clock.runFor(30000);await expect(connection).toContainText(de?'unterbrochen':'interrupted');await expect(create).toBeDisabled();
  stall=false;await refresh.click();await expect(create).toBeEnabled();
  for(const route of delayed)await route.fulfill({json:{ok:true,data:{export:{id:'stale',status:'processing'}}}}).catch(()=>{});
  await expect(create).toBeEnabled();expect(posts).toHaveLength(3);
  // Edits not rendered yet must never relabel an earlier file as their output.
  await require('./canvas-inspector-actions.cjs').openCanvasSettings(page,'merge');
  await inspector.getByRole('checkbox',{name:de?'Sanft zusammenführen':'Smooth joins',exact:true}).check();
  await expect(identity).toContainText(de?'Vorherige fertige Version':'Previous completed version');
  await expect(inspector.getByRole('link',{name:de?'Gesamtvideo herunterladen':'Download full video',exact:true})).toHaveAttribute('href',media+'?download=1');
  await inspector.getByRole('button',{name:de?'Gesamtvideo in Assets speichern':'Save full video to Assets',exact:true}).click();
  await expect.poll(()=>posts.length).toBe(4);expect(posts.at(-1).body.saveExportId).toBe(old.id);
  expect(new Set(posts.slice(0,3).map(p=>p.key)).size).toBe(3);expect(errors).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await info.attach('export-lifecycle',{contentType:'application/json',body:JSON.stringify({provider:'synthetic',boundedReads:120,newJobBudget:true,ambiguousAcceptance:'read-only lookup',posts:3,oldArtifact:old.id,deadlineRecovery:true})});
};
