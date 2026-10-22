module.exports=async options=>{
  const {page,expect,locale,info,mockSharedAuth,createCanvasApiMock}=options,de=locale==='de';
  const clockStart=Date.now();await page.clock.install({time:clockStart});await page.clock.pauseAt(clockStart+1000);
  const readVisible=async()=>{
    await page.clock.resume();
    await expect(page.locator('#canvasNotificationsPanel').getByRole('button',{name:de?'Aktualisieren':'Refresh',exact:true})).toBeEnabled();
    await page.evaluate(()=>new Promise(resolve=>{const list=document.querySelector('.canvas-notifications__list');const io=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){io.disconnect();resolve();}},{root:list});for(const row of list.children)io.observe(row);}));
    await page.waitForTimeout(750);
    await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now())+50));
  };
  await mockSharedAuth(page);await page.setViewportSize({width:de?390:1440,height:900});
  // Historical rows must precede new arrivals in the browser's actual clock.
  // A fixed future date otherwise sorts the "late" row below the viewport.
  const state=createCanvasApiMock(page),project='1'.repeat(32),now=new Date(await page.evaluate(()=>Date.now())-60000).toISOString();
  state.projects=[{id:project,title:'Editable original',locale,created_at:now,updated_at:now}];
  state.notifications=Array.from({length:42},(_,index)=>({id:`fixture:${String(index).padStart(3,'0')}`,source:'export',kind:'export',severity:index?'info':'error',code:index?'canvas_export_ready':'canvas_trim_outside_source',projectId:index?null:project,projectTitle:index?'Another owned project':'<img src=x onerror=alert(1)> '+('long title '.repeat(12)),createdAt:new Date(Date.parse(now)-index*1000).toISOString(),readAt:null,diagnosticRef:`diagnostic-${index}`,confirmed:true}));
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const inbox=page.locator('#canvasNotificationsPanel'),toggle=page.locator('#canvasNotificationsToggle'),badge=toggle.locator('.canvas-notifications__badge');
  const read=inbox.getByRole('button',{name:de?'Alle als gelesen markieren':'Mark all as read',exact:true});
  await page.goto(de?'/de/canvas/':'/canvas/');await expect(badge).toBeVisible();
  expect(await toggle.evaluate(button=>button.previousElementSibling.id)).toBe('canvasAgentToggle');
  await toggle.focus();await page.keyboard.press('Enter');await expect(inbox).toBeVisible();
  await expect(inbox.getByRole('button',{name:de?'Meldungen schließen':'Close notifications'})).toBeFocused();
  await expect(inbox.locator('li')).toHaveCount(40);expect(state.notificationReads).toEqual([]);
  await expect(inbox.locator('[data-notification-id="fixture:039"]')).not.toBeInViewport();
  await expect(inbox).toContainText(de?'tatsächliche Quelldauer':'actual source duration');
  await expect(inbox.locator('img')).toHaveCount(0);await expect(inbox).toContainText('<img src=x onerror=alert(1)>');
  await expect(read).toBeEnabled();await inbox.getByRole('button',{name:de?'Alle Meldungen löschen':'Delete all notifications',exact:true}).click();let release;
  await page.route('**/api/account/canvas/notifications/read',async route=>{
    const {ids}=route.request().postDataJSON();state.notificationReads.push(ids);
    await new Promise(resolve=>{release=resolve;});
    for(const item of state.notifications)if(ids.includes(item.id))item.readAt=new Date(await page.evaluate(()=>Date.now())).toISOString();
    await route.fulfill({json:{ok:true,data:{viewerId:'canvas-member',readIds:ids,unreadCount:state.notifications.filter(item=>!item.readAt).length}}});
  });
  await readVisible();await expect.poll(()=>state.notificationReads.length).toBe(1);
  expect(state.notificationReads[0].length).toBeGreaterThan(0);expect(state.notificationReads[0].length).toBeLessThan(40);
  expect(state.notificationReads[0]).not.toContain('fixture:039');
  // A delayed automatic read must visibly gate deletion instead of swallowing a click.
  const firstDelete=inbox.locator('[data-notification-id="fixture:000"]').getByRole('button',{name:de?'Meldung löschen':'Delete notification',exact:true});
  await expect(firstDelete).toBeDisabled();await expect(inbox.getByRole('group',{name:de?'Alle Meldungen löschen':'Delete all notifications',exact:true}).getByRole('button',{name:de?'Alle Meldungen löschen':'Delete all notifications',exact:true})).toBeDisabled();
  const late={id:'fixture:late',source:'lifecycle',kind:'lifecycle',severity:'success',code:'canvas_project_deleted',projectId:null,projectDeleted:true,createdAt:new Date(await page.evaluate(()=>Date.now())).toISOString(),readAt:null,confirmed:true};state.notifications.unshift(late);
  expect(Date.parse(late.createdAt)).toBeGreaterThan(Date.parse(now));
  await inbox.getByRole('button',{name:de?'Aktualisieren':'Refresh',exact:true}).click();await expect(inbox.locator('[data-notification-id="fixture:late"]')).toBeInViewport();
  release();await expect(read).toBeEnabled();await page.unroute('**/api/account/canvas/notifications/read');await expect(badge).toBeVisible();await expect(firstDelete).toBeEnabled();await inbox.getByRole('button',{name:de?'Abbrechen':'Cancel',exact:true}).click();
  expect(state.notificationReads[0]).not.toContain(late.id);await expect(inbox.locator('[data-notification-id="fixture:late"]')).toHaveAttribute('data-unread','true');
  await expect(inbox.locator('[data-notification-id="fixture:039"]')).toHaveAttribute('data-unread','true');
  await inbox.getByRole('button',{name:de?'Ältere Meldungen laden':'Load older notifications'}).click();await expect(inbox.locator('li')).toHaveCount(43);
  const list=inbox.locator('ol');await list.evaluate(node=>node.scrollTop=node.scrollHeight);const scroll=await list.evaluate(node=>node.scrollTop);
  await inbox.getByRole('button',{name:de?'Aktualisieren':'Refresh',exact:true}).click();await expect.poll(()=>list.evaluate(node=>node.scrollTop)).toBeGreaterThan(scroll-10);
  // Keep closing available after focus leaves the non-modal panel (including
  // disabled acknowledgement/refresh controls in WebKit). The old panel-only
  // listener leaves the menu open under this explicit broken-case control.
  await toggle.focus();await page.keyboard.press('Escape');await expect(inbox).toBeHidden();await expect(toggle).toBeFocused();
  await page.keyboard.press('Escape');await expect(inbox).toBeHidden();
  expect(state.notificationReads).toHaveLength(1);await page.reload();await toggle.click();
  const readId=state.notificationReads[0][0];await expect(inbox.locator(`[data-notification-id="${readId}"]`)).toHaveAttribute('data-unread','false');
  expect(state.notificationClients).toEqual([]);expect(state.requests.filter(request=>request.pathname.endsWith('/run'))).toEqual([]);
  // Clearing a failed conversation can retire a source without deleting its
  // project. A foreign read response is no evidence; owner-scoped successful
  // readback retires only the requested vanished identity.
  const vanished={id:'turn:cleared:failed',source:'conversation',kind:'conversation',code:'canvas_conversation_failed',projectId:project,createdAt:new Date(await page.evaluate(()=>Date.now())).toISOString(),readAt:null,confirmed:true,details:{turnId:'cleared-turn'}};
  state.notifications.unshift(vanished);await inbox.getByRole('button',{name:de?'Aktualisieren':'Refresh',exact:true}).click();await list.evaluate(node=>node.scrollTop=0);
  const vanishedRow=inbox.locator(`[data-notification-id="${vanished.id}"]`);await expect(vanishedRow).toBeInViewport();await expect(read).toBeEnabled();
  state.notifications=state.notifications.filter(item=>item.id!==vanished.id);
  await page.route('**/api/account/canvas/notifications/read',async route=>route.fulfill({json:{ok:true,data:{viewerId:'different-member',readIds:[],unreadCount:0}}}));
  await readVisible();await expect(inbox).toContainText(de?'Gelesen-Markierung noch nicht bestätigt':'Read acknowledgement is not confirmed');await expect(read).toBeEnabled();await expect(vanishedRow).toHaveAttribute('data-unread','true');
  await page.unroute('**/api/account/canvas/notifications/read');await inbox.getByRole('button',{name:de?'Aktualisieren':'Refresh',exact:true}).click();await expect(vanishedRow).toBeInViewport();await readVisible();await expect(vanishedRow).toHaveCount(0);expect(state.notificationReads.at(-1)).toContain(vanished.id);
  // Another device may acknowledge the existing inbox. New client storage
  // must keep the badge visible even if its preceding GET returned zero.
  for(const item of state.notifications)item.readAt=new Date(await page.evaluate(()=>Date.now())).toISOString();
  await inbox.getByRole('button',{name:de?'Aktualisieren':'Refresh',exact:true}).click();await expect(badge).toBeHidden();
  // Equal wording is not an identity. Only the same explicit operation key
  // coalesces; separate operations and separate unkeyed notices all survive.
  await page.evaluate(async()=>{const source=document.querySelector('script[src*="/js/pages/canvas/main.js"]').src.replace('/main.js','/notifications.js');const {canvasNotice}=await import(source);for(const key of ['operation-a','operation-a','operation-b',null,null])canvasNotice('Same wording',{code:'canvas_node_added',...(key?{key}:{})});});
  await expect.poll(()=>state.notificationClients.length).toBe(4);await expect(badge).toBeVisible();expect(new Set(state.notificationClients.map(body=>body.requestId)).size).toBe(4);
  const queued={id:'export:operation:queued',source:'export',kind:'export',code:'canvas_export_waiting',projectId:null,createdAt:new Date(await page.evaluate(()=>Date.now())).toISOString(),readAt:null,confirmed:true,details:{exportId:'operation'}};
  const immutable={...queued,id:'event:operation:1',source:'event',code:'exporting'};state.notifications.unshift(queued,immutable);
  await inbox.getByRole('button',{name:de?'Aktualisieren':'Refresh',exact:true}).click();await expect(inbox.locator('[data-notification-id="export:operation:queued"]')).toHaveCount(1);
  state.notifications=state.notifications.filter(item=>item.id!==queued.id);state.notifications.unshift({...queued,id:'export:operation:ready',code:'canvas_export_ready'});
  await inbox.getByRole('button',{name:de?'Aktualisieren':'Refresh',exact:true}).click();await expect(inbox.locator('[data-notification-id="export:operation:queued"]')).toHaveCount(0);
  await expect(inbox.locator('[data-notification-id="export:operation:ready"]')).toHaveAttribute('data-unread','true');await expect(inbox.locator('[data-notification-id="event:operation:1"]')).toHaveCount(1);
  for(const [source,field] of [['decision','decisionId'],['immediate','intentId']]){
    const first={id:`${source}:operation:first`,source,kind:source,code:'canvas_action_completed',projectId:project,createdAt:new Date(await page.evaluate(()=>Date.now())).toISOString(),readAt:null,confirmed:true,details:{[field]:`${source}-operation`}};
    state.notifications.unshift(first);await inbox.getByRole('button',{name:de?'Aktualisieren':'Refresh',exact:true}).click();await expect(inbox.locator(`[data-notification-id="${first.id}"]`)).toHaveCount(1);
    state.notifications=state.notifications.filter(item=>item.id!==first.id);state.notifications.unshift({...first,id:`${source}:operation:next`});
    await inbox.getByRole('button',{name:de?'Aktualisieren':'Refresh',exact:true}).click();await expect(inbox.locator(`[data-notification-id="${first.id}"]`)).toHaveCount(0);await expect(inbox.locator(`[data-notification-id="${source}:operation:next"]`)).toHaveAttribute('data-unread','true');
  }
  // Offline delivery remains in the same panel and retries one immutable identity.
  let offline=true;const sent=[];await page.route('**/api/account/canvas/notifications/client',async route=>{sent.push(route.request().postDataJSON());if(offline)return route.abort('failed');return route.fallback();});
  await page.evaluate(async()=>{const source=document.querySelector('script[src*="/js/pages/canvas/main.js"]').src.replace('/main.js','/notifications.js');const {canvasNotice}=await import(source);canvasNotice('Local save receipt is unknown',{code:'canvas_save_failed',errorCode:'synthetic_storage_rejected',diagnosticRef:'safe-reference',status:503});});
  await expect(inbox).toContainText('Local save receipt is unknown');await expect.poll(()=>sent.length).toBe(1);
  await expect(inbox).toContainText(de?'Speicherung noch nicht bestätigt':'storage not yet confirmed');
  await page.keyboard.press('Escape');await toggle.click();await list.evaluate(node=>node.scrollTop=0);await inbox.locator('[data-notification-id^="local:"]').filter({hasText:'Local save receipt is unknown'}).scrollIntoViewIfNeeded();await expect(inbox.locator('[data-notification-id^="local:"]').filter({hasText:'Local save receipt is unknown'})).toBeInViewport();await expect(read).toBeEnabled();await readVisible();
  await expect(inbox.locator('[data-notification-id^="local:"]').filter({hasText:'Local save receipt is unknown'})).toHaveAttribute('data-unread','false');
  const beforeTransfer=state.notificationReads.length;
  offline=false;await page.evaluate(()=>window.dispatchEvent(new Event('online')));await expect.poll(()=>state.notificationClients.length).toBe(5);
  await expect(inbox).not.toContainText(de?'Speicherung noch nicht bestätigt':'storage not yet confirmed');
  const storedId=`client:${sent[0].requestId}`;await expect(inbox.locator(`[data-notification-id="${storedId}"]`)).toHaveAttribute('data-unread','false');expect(state.notificationReads.slice(beforeTransfer)).toEqual([[storedId]]);
  expect(new Set(sent.map(body=>body.requestId)).size).toBe(1);expect(sent.every(body=>!Object.hasOwn(body,'text'))).toBe(true);await expect(inbox.locator(`[data-notification-id="${storedId}"] code`)).toContainText('synthetic_storage_rejected');
  const readsBeforeLifecycle=state.notificationReads.length;
  // A list transport outage is visible even while the inbox is closed. The
  // local warning is coalesced and never recursively sent to its failing API.
  await page.keyboard.press('Escape');let unavailable=true,failedLists=0;const clientBeforeOutage=state.notificationClients.length;
  await page.route('**/api/account/canvas/notifications?*',async route=>{if(unavailable){failedLists++;return route.abort('failed');}return route.fallback();});
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));await expect.poll(()=>failedLists).toBe(1);await expect(badge).toBeVisible();
  await toggle.click();await expect(inbox.locator('[data-code="canvas_connection_interrupted"]')).toHaveCount(1);
  await expect(inbox.getByRole('button',{name:de?'Aktualisieren':'Refresh',exact:true})).toBeEnabled();
  await inbox.getByRole('button',{name:de?'Aktualisieren':'Refresh',exact:true}).click();await expect.poll(()=>failedLists).toBeGreaterThan(1);
  await expect(inbox.locator('[data-code="canvas_connection_interrupted"]')).toHaveCount(1);expect(state.notificationClients).toHaveLength(clientBeforeOutage);
  unavailable=false;await page.evaluate(()=>window.dispatchEvent(new Event('online')));await expect(inbox.getByRole('button',{name:de?'Aktualisieren':'Refresh',exact:true})).toBeEnabled();
  // BFCache restoration observes the inbox; it does not acknowledge or execute.
  const before=state.requests.filter(request=>request.pathname==='/api/account/canvas/notifications').length;
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));await page.clock.runFor(60000);
  expect(state.requests.filter(request=>request.pathname==='/api/account/canvas/notifications').length).toBe(before);
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));await expect.poll(()=>state.requests.filter(request=>request.pathname==='/api/account/canvas/notifications').length).toBeGreaterThan(before);
  expect(state.notificationReads).toHaveLength(readsBeforeLifecycle);
  // An unknown auth probe suspends edits, preserving the current user's draft.
  await page.keyboard.press('Escape');const title=page.locator('#canvasProjectTitle');await title.fill('Unsaved same-user draft');
  await page.evaluate(()=>document.dispatchEvent(new CustomEvent('bitbi:auth-change',{detail:{sessionConfirmed:false,loggedIn:false,user:null}})));await page.clock.runFor(1000);
  await expect(title).toHaveValue('Unsaved same-user draft');await expect(title).toBeDisabled();
  await page.evaluate(()=>document.dispatchEvent(new CustomEvent('bitbi:auth-change',{detail:{sessionConfirmed:true,loggedIn:true,user:{id:'canvas-member',role:'user'}}})));await expect(title).toBeEnabled();await expect(title).toHaveValue('Unsaved same-user draft');
  // A lost deletion response is reconciled by owned reads, never by an
  // automatic second DELETE. Unknown reads preserve the editable graph.
  // Load older, unread operational rows before the tombstone exists. Their
  // exact source IDs disappear server-side on deletion and must not linger.
  const obsolete=['lifecycle','event','action','export','run','conversation','decision','immediate'].map((source,index)=>({id:`obsolete:${source}`,source,kind:source,code:source==='lifecycle'?'canvas_project_created':'canvas_action_completed',projectId:project,createdAt:new Date(Date.parse(now)-600000-index*1000).toISOString(),readAt:null,confirmed:true}));
  state.notifications.push(...obsolete);await toggle.click();await inbox.getByRole('button',{name:de?'Ältere Meldungen laden':'Load older notifications'}).click();
  for(const item of obsolete)await expect(inbox.locator(`[data-notification-id="${item.id}"]`)).toHaveCount(1);
  await page.keyboard.press('Escape');
  let deletion='unknown',deleteCalls=0;
  await page.route(`**/api/account/canvas/projects/${project}`,async route=>{
    if(route.request().method()==='DELETE'){deleteCalls++;if(deletion==='committed'){state.projects=[];state.notifications=state.notifications.filter(item=>item.projectId!==project||item.source==='client');state.notifications.unshift({id:'project:deleted',source:'lifecycle',kind:'deleted',code:'canvas_project_deleted',projectId:project,projectTitle:'Editable original',projectDeleted:true,createdAt:new Date(await page.evaluate(()=>Date.now())).toISOString(),readAt:null,confirmed:true});}return route.abort('failed');}
    if(route.request().method()==='GET')return deletion==='committed'?route.fulfill({status:404,json:{ok:false,code:'project_not_found'}}):route.abort('failed');
    return route.fallback();
  });
  const approve=dialog=>dialog.accept();page.on('dialog',approve);
  if(de)await page.locator('#canvasProjectsToggle').click();
  const remove=page.locator('.canvas-project-item__menu--danger');await remove.click();
  await expect.poll(()=>deleteCalls).toBe(1);await expect(page.locator('#canvasApp')).not.toHaveAttribute('inert','');
  await expect(remove).toHaveCount(1);await expect(title).toHaveValue('Unsaved same-user draft');
  await expect.poll(()=>state.notificationClients.find(body=>body.code==='canvas_project_delete_unconfirmed')).toMatchObject({projectId:project,errorCode:'network_error',status:0});
  await toggle.click();await expect(inbox.locator('[data-code="canvas_project_delete_unconfirmed"]')).toContainText(de?'Die Projektlöschung konnte nicht bestätigt werden':'Project removal could not be confirmed');await page.keyboard.press('Escape');
  deletion='committed';await remove.click();await expect.poll(()=>deleteCalls).toBe(2);await expect(remove).toHaveCount(0);
  await toggle.click();await expect(inbox.locator('[data-notification-id="project:deleted"]')).toBeVisible();
  await expect(inbox.locator('[data-notification-id="project:deleted"]').getByRole('button',{name:de?'Projekt öffnen':'Open project',exact:true})).toHaveCount(0);
  for(const item of obsolete)await expect(inbox.locator(`[data-notification-id="${item.id}"]`)).toHaveCount(0);
  await expect(inbox.locator('[data-notification-id="fixture:000"]')).toHaveCount(0);
  for(const source of ['decision','immediate'])await expect(inbox.locator(`[data-notification-id="${source}:operation:next"]`)).toHaveCount(0);
  await expect(inbox.locator(`[data-notification-id="${storedId}"]`)).toHaveCount(1);
  await list.evaluate(node=>node.scrollTop=0);await expect(inbox.locator('[data-notification-id="project:deleted"]')).toBeInViewport();await expect(read).toBeEnabled();await readVisible();
  await expect(inbox.locator('[data-notification-id="project:deleted"]')).toHaveAttribute('data-unread','false');
  expect(state.notificationReads.at(-1).filter(id=>obsolete.some(item=>item.id===id))).toEqual([]);await page.keyboard.press('Escape');
  page.off('dialog',approve);expect(deleteCalls).toBe(2);
  // A committed deletion with deferred reclamation remains a successful
  // deletion; only its cleanup notice retains the old project reference.
  const second='2'.repeat(32);state.projects=[{id:second,title:'Cleanup project',locale,created_at:now,updated_at:now}];
  await page.route(`**/api/account/canvas/projects/${second}`,async route=>{
    if(route.request().method()==='GET')return route.fulfill({json:{ok:true,data:{project:state.projects[0],nodes:[],edges:[],runs:[]}}});
    if(route.request().method()==='DELETE'){state.projects=[];state.notifications.unshift({id:'project:cleanup:deleted',source:'lifecycle',code:'canvas_project_deleted',projectId:second,projectTitle:'Cleanup project',projectDeleted:true,createdAt:new Date(await page.evaluate(()=>Date.now())).toISOString(),readAt:null,confirmed:true});return route.fulfill({json:{ok:true,data:{id:second,deleted:true,cleanupPending:true,diagnosticRef:'cleanup-diagnostic'}}});}
    return route.fallback();
  });
  await page.reload();page.on('dialog',approve);if(de)await page.locator('#canvasProjectsToggle').click();
  await page.locator('.canvas-project-item__menu--danger').click();await expect(page.locator('.canvas-project-item__menu--danger')).toHaveCount(0);page.off('dialog',approve);
  await toggle.click();await expect(inbox.locator('[data-code="canvas_cleanup_pending"]')).toBeVisible();
  await expect.poll(()=>state.notificationClients.some(body=>body.code==='canvas_cleanup_pending'&&body.projectId===second&&body.diagnosticRef==='cleanup-diagnostic')).toBe(true);
  await page.keyboard.press('Escape');
  // A prior actor's undelivered local report must not be uploaded under the
  // next actor, even when it is awaiting its first successful storage reply.
  offline=true;const deliveredBeforeActor=state.notificationClients.length;let initialOutageReads=0;
  await page.route('**/api/account/canvas/notifications?*',async route=>{initialOutageReads++;return route.abort('failed');});
  await page.reload();await expect.poll(()=>initialOutageReads).toBeGreaterThan(0);await expect(page.locator('#canvasApp')).toBeVisible();
  await page.evaluate(()=>document.dispatchEvent(new CustomEvent('bitbi:auth-change',{detail:{sessionConfirmed:true,loggedIn:true,user:{id:'canvas-member',role:'user'}}})));
  await expect(badge).toBeVisible();
  await page.evaluate(async()=>{const source=document.querySelector('script[src*="/js/pages/canvas/main.js"]').src.replace('/main.js','/notifications.js');const {canvasNotice}=await import(source);canvasNotice('Private previous account notice',{code:'canvas_save_failed'});});
  await toggle.click();await expect(inbox).toContainText('Private previous account notice');await page.keyboard.press('Escape');
  // A confirmed different account clears the workspace before another request.
  state.projects=[];state.notifications=[];
  await page.route('**/api/me',async route=>route.fulfill({json:{loggedIn:true,user:{id:'second-member',role:'user'}}}));
  await page.route('**/api/account/canvas/notifications?*',async route=>route.fulfill({json:{ok:true,data:{items:[],nextCursor:null,unreadCount:0,viewerId:'second-member'}}}));
  const mutations=state.requests.filter(request=>request.method!=='GET').length;
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.evaluate(()=>document.dispatchEvent(new CustomEvent('bitbi:auth-change',{detail:{sessionConfirmed:true,loggedIn:true,user:{id:'second-member',role:'user'}}})))]);
  await expect(page.locator('#canvasProjectList')).not.toContainText('Editable original');await toggle.click();await expect(inbox.locator('li')).toHaveCount(0);await expect(badge).toBeHidden();
  expect(state.requests.filter(request=>request.method!=='GET').length).toBe(mutations);expect(state.notificationClients).toHaveLength(deliveredBeforeActor);
  expect(errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.emulateMedia({reducedMotion:'reduce'});await inbox.screenshot({path:info.outputPath(`notifications-${locale}.png`)});
};

module.exports.inbox=async({page,expect,locale,mockSharedAuth,createCanvasApiMock})=>{
  const de=locale==='de';
  const {canvas:state,project}=await require('./canvas-agent-ui.cjs').fixture({page,locale,mockSharedAuth,createCanvasApiMock});
  await page.setViewportSize({width:1440,height:950});const now=Date.now();
  state.projects=[{id:project,title:'Kept project',locale,created_at:new Date(now).toISOString(),updated_at:new Date(now).toISOString()}];
  const notice=(id,index=0)=>({id,source:'client',code:'network_error',projectId:index%2?project:null,projectTitle:index%2?'Kept project':'Other project',createdAt:new Date(now-index*1000).toISOString(),readAt:null,confirmed:false});
  state.notifications=Array.from({length:90},(_,i)=>notice(`client:old-${i}`,i));
  const clockStart=Date.now();await page.clock.install({time:clockStart});await page.clock.pauseAt(clockStart+1000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(de?'/de/canvas/':'/canvas/');
  const ai=page.locator('#canvasAgentToggle'),panel=page.locator('#canvasAgentPanel'),toggle=page.locator('#canvasNotificationsToggle'),inbox=page.locator('#canvasNotificationsPanel'),badge=toggle.locator('.canvas-notifications__badge');
  const button=(name)=>inbox.getByRole('button',{name,exact:true}),refresh=button(de?'Aktualisieren':'Refresh'),mark=button(de?'Alle als gelesen markieren':'Mark all as read'),clear=button(de?'Alle Meldungen löschen':'Delete all notifications');
  const color=locator=>locator.evaluate(node=>getComputedStyle(node).backgroundColor);
  await page.mouse.move(0,0);const neutral=await color(page.locator('#canvasHistoryToggle'));expect(await color(ai)).toBe(neutral);await expect(toggle).toHaveAttribute('aria-expanded','false');expect(await color(toggle)).toBe(neutral);await ai.focus();expect(await color(ai)).toBe(neutral);await expect(ai).toHaveAttribute('aria-expanded','false');
  await page.keyboard.press('Enter');await expect(panel).toBeVisible();await expect(page.locator('#canvasAgentResize')).toBeVisible();const active=await color(ai);expect(active).not.toBe(neutral);expect(await color(page.locator('#canvasAddNode'))).not.toBe(neutral);
  await ai.click();await page.mouse.move(0,0);await expect(panel).toBeHidden();expect(await color(ai)).toBe(neutral);
  await ai.click();
  // Use the existing accessible toggle, not an independent duplicate workspace.
  const workspace=panel.getByRole('button',{name:de?'Arbeitsfläche ausfüllen':'Expand workspace',exact:true});
  await workspace.click();await expect(page.locator('#canvasApp')).toHaveAttribute('data-agent-expanded','true');expect(await color(ai)).toBe(active);
  await expect(page.locator('#canvasProjectsToggle')).toHaveAttribute('aria-expanded','false');
  await page.locator('#canvasInspectorToggle').click();await expect(panel).toBeHidden();expect(await color(ai)).toBe(neutral);
  await ai.click();await panel.getByRole('button',{name:de?'Arbeitsfläche ausfüllen':'Expand workspace',exact:true}).click();
  await toggle.click();await expect(inbox).toBeVisible();await expect(toggle).toHaveAttribute('aria-expanded','true');await expect(badge).toBeVisible();
  await expect(inbox.locator('li')).toHaveCount(40);await expect(inbox.locator('[data-notification-id="client:old-39"]')).not.toBeInViewport();
  await page.clock.runFor(700);await expect.poll(()=>state.notificationReads.length).toBe(1);
  expect(state.notificationReads[0].length).toBeGreaterThan(0);expect(state.notificationReads[0]).not.toContain('client:old-39');
  expect(state.notifications.find(item=>item.id==='client:old-89').readAt).toBeNull();
  await mark.click();await expect(badge).toBeHidden();expect(state.notifications.every(item=>item.readAt)).toBe(true);expect(state.notifications).toHaveLength(90);
  const single=inbox.locator('[data-notification-id="client:old-0"]');await single.getByRole('button',{name:de?'Meldung löschen':'Delete notification',exact:true}).click();await expect(single).toHaveCount(0);
  await clear.click();await expect(inbox.getByRole('group',{name:de?'Alle Meldungen löschen':'Delete all notifications',exact:true})).toContainText(de?'Projekte, Medien':'Projects, media');await button(de?'Abbrechen':'Cancel').click();expect(state.notifications).toHaveLength(89);
  await clear.click();await inbox.getByRole('group',{name:de?'Alle Meldungen löschen':'Delete all notifications',exact:true}).getByRole('button',{name:de?'Alle Meldungen löschen':'Delete all notifications',exact:true}).click();
  await expect(inbox.locator('li')).toHaveCount(0);await expect(badge).toBeHidden();expect(state.notifications).toHaveLength(0);expect(state.projects).toHaveLength(1);
  await page.reload();await toggle.click();await expect(inbox.locator('li')).toHaveCount(0);await expect(badge).toBeHidden();
  // A stale GET cannot reinsert removed rows or restore their unread badge.
  state.notifications=[notice('client:race')];await refresh.click();await expect(inbox.locator('li')).toHaveCount(1);
  let release,held;await page.route('**/api/account/canvas/notifications?*',async route=>{
    held={items:structuredClone(state.notifications),viewerId:'canvas-member',inboxRevision:state.notificationRevision,totalCount:1,unreadCount:1,nextCursor:null};
    await new Promise(resolve=>release=resolve);await route.fulfill({json:{ok:true,data:held}});
  });
  await refresh.click();await expect.poll(()=>Boolean(release)).toBe(true);
  await inbox.locator('li').getByRole('button',{name:de?'Meldung löschen':'Delete notification',exact:true}).click();await expect(inbox.locator('li')).toHaveCount(0);
  await page.unroute('**/api/account/canvas/notifications?*');release();await expect(refresh).toBeEnabled();await expect(inbox.locator('li')).toHaveCount(0);await expect(badge).toBeHidden();
  // Deletion commits before an arrival; a lost response must reuse its identity.
  state.notifications=[notice('client:before-bulk')];await refresh.click();let first=true,bulkKey,releaseReplay,replayWaiting=false;
  await page.route('**/api/account/canvas/notifications/delete',async route=>{
    const body=route.request().postDataJSON();if(first){first=false;bulkKey=body.requestId;state.notificationMutations.set(bulkKey,state.notifications.map(item=>item.id));for(const item of state.notifications)state.notificationTombstones.add(item.id);state.notifications=[notice('client:after-bulk')];state.notificationRevision++;return route.abort('failed');}expect(body.requestId).toBe(bulkKey);replayWaiting=true;await new Promise(resolve=>releaseReplay=resolve);return route.fallback();
  });
  await clear.click();await inbox.getByRole('group',{name:de?'Alle Meldungen löschen':'Delete all notifications',exact:true}).getByRole('button',{name:de?'Alle Meldungen löschen':'Delete all notifications',exact:true}).click();await expect(inbox).toContainText(de?'noch nicht bestätigt':'not yet confirmed');
  const readsBeforeReplay=state.requests.filter(item=>item.pathname==='/api/account/canvas/notifications').length;
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));await expect.poll(()=>replayWaiting).toBe(true);
  await page.evaluate(()=>{window.dispatchEvent(new Event('online'));window.dispatchEvent(new Event('online'));});
  await page.waitForTimeout(100);expect(state.requests.filter(item=>item.pathname==='/api/account/canvas/notifications')).toHaveLength(readsBeforeReplay);
  releaseReplay();await expect(inbox.locator('[data-notification-id="client:after-bulk"]')).toBeVisible();await expect(badge).toBeVisible();await page.unroute('**/api/account/canvas/notifications/delete');
  await page.clock.resume();await expect(badge).toBeHidden();await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now())+50));
  // Offline client delivery is deleted by its request identity before retry.
  let offline=true,delivery;await page.route('**/api/account/canvas/notifications/client',route=>{delivery=route.request().postDataJSON();return offline?route.abort('failed'):route.fallback();});
  await page.evaluate(async()=>{const source=document.querySelector('script[src*="/js/pages/canvas/main.js"]').src.replace('/main.js','/notifications.js');(await import(source)).canvasNotice('Pending local notice',{code:'canvas_save_failed'});});
  const local=inbox.locator('[data-notification-id^="local:"]').filter({hasText:'Pending local notice'});await expect(local).toBeVisible();await expect.poll(()=>Boolean(delivery)).toBe(true);
  await local.getByRole('button',{name:de?'Meldung löschen':'Delete notification',exact:true}).click();offline=false;await page.evaluate(()=>window.dispatchEvent(new Event('online')));await expect.poll(()=>state.notificationTombstones.has(`client:${delivery.requestId}`)).toBe(true);await expect(refresh).toBeEnabled();await page.reload();await toggle.click();await expect(inbox).not.toContainText('Pending local notice');expect(state.notificationTombstones.has(`client:${delivery.requestId}`)).toBe(true);
  // A second real tab uses the same viewer's server state. Broadcast refresh
  // retires a loaded item without a click or polling timeout in the first tab.
  await clear.click();await inbox.getByRole('group',{name:de?'Alle Meldungen löschen':'Delete all notifications',exact:true}).getByRole('button',{name:de?'Alle Meldungen löschen':'Delete all notifications',exact:true}).click();await expect(inbox.locator('li')).toHaveCount(0);
  state.notifications.push(notice('client:second-tab'));await refresh.click();await expect(inbox.locator('li')).toHaveCount(1);
  const other=await page.context().newPage();await mockSharedAuth(other);const otherState=createCanvasApiMock(other);
  for(const key of ['notifications','notificationRevision','notificationTombstones','notificationMutations'])Object.defineProperty(otherState,key,{get:()=>state[key],set:value=>{state[key]=value;}});
  await other.goto(de?'/de/canvas/':'/canvas/');await other.locator('#canvasNotificationsToggle').click();
  await other.locator('#canvasNotificationsPanel li').getByRole('button',{name:de?'Meldung löschen':'Delete notification',exact:true}).click();
  await expect(inbox.locator('li')).toHaveCount(0);await expect(badge).toBeHidden();await other.close();
  state.notifications=[notice('client:hidden-arrival')];await refresh.click();
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
  await page.clock.runFor(1000);expect(state.notifications[0].readAt).toBeNull();await expect(badge).toBeVisible();
  await page.evaluate(()=>{delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));});await expect(refresh).toBeEnabled();
  // Server-side changes from another device retire previously loaded history.
  state.notifications=[];state.notificationRevision++;await refresh.click();await expect(inbox.locator('li')).toHaveCount(0);await expect(badge).toBeHidden();
  await toggle.click();await page.setViewportSize({width:390,height:800});await ai.click();await expect(panel).toBeVisible();await expect(ai).toHaveAttribute('aria-expanded','true');await ai.click();await expect(panel).toBeHidden();await expect(ai).toHaveAttribute('aria-expanded','false');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
  expect(state.requests.filter(item=>item.method!=='GET'&&!item.pathname.startsWith('/api/account/canvas/notifications/'))).toEqual([]);
};
