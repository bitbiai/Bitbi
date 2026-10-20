module.exports=async options=>{
  const {page,expect,locale,info}=options,de=locale==='de';
  const {setup,nodeFor,outputFor,id,project,now}=require('./canvas-inspector-ui.cjs').fixture;
  const {state,visit,select,errors,inspector}=await setup(options);
  state.nodes=[nodeFor('video'),nodeFor('video',3)];state.nodes.forEach((n,i)=>{n.output={...outputFor('video',i+2),previewUrl:'/api/plain/canvas-preview/poster.jpg'};});
  state.edges=[{id:id(5),project_id:project,source_node_id:id(2),target_node_id:id(3),config:{}}];
  const clips=state.nodes.map(n=>({nodeId:n.id,runId:n.output.runId,assetId:n.output.assetId,version:n.output.sourceVersion,modelId:n.model_id,createdAt:now}));
  const media='/api/plain/canvas-preview/video.mp4',old={id:id(12),status:'ready',storage:'canvas',asset:{id:id(13),file_url:media},recipe:{videos:clips},audio_timeline:[]};
  const posts=[],accepted=new Map();let latest=old,reads=0,losePost=false,stall=false,denied=false,delayed=[];
  function projectNotice(){const code=latest.status==='queued'&&latest.processing?.blocked?'media_delivery_exhausted':latest.status==='failed'&&!latest.asset?latest.error_code||'canvas_export_failed':latest.asset?'canvas_export_ready':'canvas_export_processing';const notificationId=`export:${latest.id}:${code}`;state.notifications=state.notifications.filter(item=>item.source!=='export'||item.details?.exportId!==latest.id||item.id===notificationId);if(!state.notifications.some(item=>item.id===notificationId))state.notifications.unshift({id:notificationId,source:'export',kind:'export',code,projectId:project,createdAt:new Date().toISOString(),readAt:null,confirmed:true,diagnosticRef:latest.id,details:{exportId:latest.id}});}
  await page.route(/\/full-video(?:\?.*)?$/,async route=>{
    const req=route.request(),key=req.headers()['idempotency-key'],url=new URL(req.url());
    if(req.method()==='POST'){
      const body=req.postDataJSON();posts.push({key,body});
      if(!body.saveExportId){latest={id:String(posts.length).padStart(32,'0'),status:'processing'};accepted.set(key,latest);}
      if(losePost){losePost=false;return route.abort('failed');}
    }else {reads++;if(denied)return route.fulfill({status:403,json:{ok:false,code:'permission_denied'}});if(stall){delayed.push(route);return;}}
    const lookup=url.searchParams.get('requestKey');
    projectNotice();
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
  const inbox=page.locator('#canvasNotificationsPanel'),inboxToggle=page.locator('#canvasNotificationsToggle');
  const checkNotice=async(code,text)=>{await inboxToggle.click();const item=inbox.locator(`[data-code="${code}"]`).first();await expect(item).toBeVisible();if(text)await expect(item).toContainText(text);await inbox.getByRole('button',{name:de?'Meldungen schließen':'Close notifications'}).click();};
  await expect(create).toBeEnabled();await page.clock.install();await page.clock.pauseAt(new Date());
  await create.click();await expect.poll(()=>posts.length).toBe(1);await expect(connection).toHaveText('');await expect(create).toBeDisabled();
  await expect(identity).toContainText(de?'Vorherige fertige Version':'Previous completed version');
  await expect(displayed).toHaveAttribute('src',media);
  // Exercise the former 120-read cutoff through real timers. Pending work
  // continues at the slower cadence after ten minutes, without another POST.
  for(let i=1;i<124;i++){
    const before=reads;await page.clock.runFor(i<120?5000:30000);
    await expect.poll(()=>reads).toBeGreaterThan(before);
    await expect(connection).toHaveText('');
  }
  await expect(create).toBeDisabled();expect(posts).toHaveLength(1);
  latest={...latest,status:'queued',processing:{stage:'waiting_for_media',blocked:true,errorCode:'media_delivery_exhausted',diagnosticRef:latest.id}};
  await page.clock.runFor(30000);await checkNotice('media_delivery_exhausted',latest.id);await expect(message).toHaveText('');
  await expect(create).toBeDisabled();expect(posts).toHaveLength(1);
  latest={...latest,status:'failed',error_code:'canvas_media_filter_invalid'};
  await page.clock.runFor(30000);await checkNotice('canvas_media_filter_invalid');await expect(message).toHaveText('');await expect(create).toBeEnabled();
  const terminalReads=reads;await page.clock.runFor(60000);expect(reads).toBe(terminalReads);
  latest={...latest,asset:old.asset,error_code:'canvas_poster_failed'};
  await refresh.click();await expect(message).toContainText(de?'Gesamtvideo bereit':'Full video ready');
  await expect(message).not.toContainText(de?'Verarbeitung fehlgeschlagen':'Processing failed');await expect(displayed).toHaveAttribute('src',media);
  await create.click();await expect.poll(()=>posts.length).toBe(2);await expect(connection).toHaveText('');
  const before=reads;await page.clock.runFor(5000);await expect.poll(()=>reads).toBeGreaterThan(before);await expect(connection).toHaveText('');
  latest={...latest,status:'failed'};await refresh.click();await expect(create).toBeEnabled();
  // Accepted POST whose response is lost reconnects by its original key,
  // never by automatic POST. Reopening retains the accepted server identity.
  losePost=true;await create.click();await expect.poll(()=>posts.length).toBe(3);
  await checkNotice('canvas_connection_interrupted');await expect(connection).toHaveText('');await expect(create).toBeDisabled();
  await page.clock.runFor(5000);await expect(connection).toHaveText('');expect(posts).toHaveLength(3);
  await select(2);await select(3);await expect(connection).toHaveText('');await expect(create).toBeDisabled();expect(posts).toHaveLength(3);
  // Browsers can freeze hidden/BFCache pages. Neither transition replays POST;
  // returning to a visible page immediately observes the still-current job.
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
  const hiddenReads=reads;await page.clock.runFor(60000);expect(reads).toBe(hiddenReads);
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'));});
  await expect.poll(()=>reads).toBeGreaterThan(hiddenReads);await expect(connection).toHaveText('');
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
  const frozenReads=reads;await page.clock.runFor(60000);expect(reads).toBe(frozenReads);
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
  await expect.poll(()=>reads).toBeGreaterThan(frozenReads);await expect(connection).toHaveText('');expect(posts).toHaveLength(3);
  latest={...latest,status:'failed'};await refresh.click();await expect(create).toBeEnabled();
  // A hung read reaches a bounded deadline. A read-only retry reconnects and
  // a late old response cannot overwrite the recovered terminal state.
  stall=true;await refresh.click();await expect.poll(()=>delayed.length).toBe(1);
  await page.clock.runFor(30000);await checkNotice('canvas_connection_interrupted');await expect(connection).toHaveText('');await expect(create).toBeDisabled();
  stall=false;await page.clock.runFor(5000);await expect(create).toBeEnabled();
  for(const route of delayed)await route.fulfill({json:{ok:true,data:{export:{id:'stale',status:'processing'}}}}).catch(()=>{});
  await expect(create).toBeEnabled();expect(posts).toHaveLength(3);
  // Permanent access denial is not a transient outage: stop automated reads
  // and block another render until an explicit successful access check.
  denied=true;await refresh.click();await checkNotice('canvas_connection_interrupted');await expect(connection).toHaveText('');await expect(create).toBeDisabled();
  const deniedReads=reads;await page.clock.runFor(60000);await page.evaluate(()=>window.dispatchEvent(new Event('online')));expect(reads).toBe(deniedReads);
  denied=false;await refresh.click();await expect(create).toBeEnabled();
  // Edits not rendered yet must never relabel an earlier file as their output.
  await require('./canvas-inspector-actions.cjs').openCanvasSettings(page,'merge');
  await inspector.getByRole('checkbox',{name:de?'Sanft zusammenführen':'Smooth joins',exact:true}).check();
  await expect(identity).toContainText(de?'Vorherige fertige Version':'Previous completed version');
  await expect(inspector.getByRole('link',{name:de?'Gesamtvideo herunterladen':'Download full video',exact:true})).toHaveAttribute('href',media+'?download=1');
  await inspector.getByRole('button',{name:de?'Gesamtvideo in Assets speichern':'Save full video to Assets',exact:true}).click();
  await expect.poll(()=>posts.length).toBe(4);expect(posts.at(-1).body.saveExportId).toBe(old.id);
  await expect(connection).toHaveText('');
  // A real document exit still tears down observation. A subsequent synthetic
  // pageshow/online event must not revive its detached Inspector or submit work.
  latest={id:id(19),status:'processing'};await refresh.click();
  await expect(message).toHaveText(de?'Gesamtvideo wird verarbeitet.':'Processing full video.');await expect(connection).toHaveText('');
  await expect(create).toBeDisabled();
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false})));
  const exitedReads=reads;await page.clock.runFor(60000);
  await page.evaluate(()=>{window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));window.dispatchEvent(new Event('online'));});
  await page.clock.runFor(60000);expect(reads).toBe(exitedReads);expect(posts).toHaveLength(4);
  expect(new Set(posts.slice(0,3).map(p=>p.key)).size).toBe(3);expect(errors).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await info.attach('export-lifecycle',{contentType:'application/json',body:JSON.stringify({provider:'synthetic',automaticReadsBeyond:120,longPendingPollMs:30000,ambiguousAcceptance:'automatic read-only lookup',posts:3,oldArtifact:old.id,deadlineRecovery:true,terminalStops:true,bfcacheResumes:true,documentExitStops:true})});
};
