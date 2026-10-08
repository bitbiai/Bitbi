const path=require('node:path');
exports.examples=async options=>{
 const {page,expect,locale,info}=options,de=locale==='de',{TRANSITIONS}=await import('../../js/shared/canvas-transitions.mjs');
 const {fixture}=require('./canvas-inspector-ui.cjs'),{state,visit,inspector,errors}=await fixture.setup(options),{nodeFor,outputFor,id,project}=fixture;
 state.nodes=[nodeFor('video',2),nodeFor('video',3)];state.nodes.forEach((node,i)=>node.output=outputFor('video',i+2));
 state.edges=[{id:id(5),project_id:project,source_node_id:id(2),target_node_id:id(3),label:'Keep connection',config:{}}];
 const requests=[],assets=[];await page.route('**/api/**',route=>{const req=route.request(),url=new URL(req.url());if(!['GET','HEAD'].includes(req.method())&&!(req.method()==='PATCH'&&url.pathname.endsWith('/edges/'+id(5)))){requests.push({method:req.method(),path:url.pathname});return route.abort();}return route.fallback();});
 page.on('request',r=>{if(r.url().includes('/assets/canvas/transition-examples/'))assets.push(new URL(r.url()).pathname);});
 const open=async()=>{await page.locator(`[data-edge-id="${id(5)}"] .canvas-edge-hit`).press('Enter');if(de&&await page.locator('#canvasInspectorToggle').getAttribute('aria-expanded')!=='true')await page.locator('#canvasInspectorToggle').click();};
 await visit();await open();
 const controls=inspector.locator('.canvas-transition-controls'),select=controls.getByRole('combobox',{name:de?'Effekt':'Effect',exact:true}),example=controls.locator('.canvas-transition-example'),image=example.locator('img'),button=example.getByRole('button');
 const shown=async(id,ext='gif')=>{await expect(example.locator('strong')).toHaveText((de?'Beispiel':'Example')+' · '+TRANSITIONS.find(t=>t.id===id)[de?'de':'en']);await expect(image).toHaveAttribute('src',new RegExp('/'+id+'\\.'+ext+'\\?'));await expect(image).toHaveJSProperty('naturalWidth',160);};
 await shown('none');expect(assets).toEqual(['/assets/canvas/transition-examples/none.gif']);
 await expect(example).toContainText(de?'Nicht deine Clips':'Not your clips');await expect(controls.getByRole('button',{name:de?'Übergangsvorschau erstellen':'Preview transition',exact:true})).toBeDisabled();
 // Native macOS headless menus do not commit ArrowDown; type-ahead selects
 // the localized option using the keyboard and the existing change/save handler.
 await select.focus();await select.press(de?'w':'c');await page.keyboard.press('Tab');await expect(select).toHaveValue('fade');await shown('fade');
 const nativeCache=info.project.name==='webkit-canvas';
 const cacheControls=async delayed=>{
 // A delayed old image cannot replace the newly selected illustration.
 let release,delivered;const held=new Promise(r=>release=r),done=new Promise(r=>delivered=r);
 await page.route(`**/assets/canvas/transition-examples/${delayed}.gif?*`,async route=>{await held;await route.fulfill({path:path.join(__dirname,`../../assets/canvas/transition-examples/${delayed}.gif`)});delivered();});
 await select.selectOption(delayed);await expect(select).toHaveValue(delayed);await expect(image).toHaveCount(0);
 await select.selectOption('slideright');await shown('slideright');release();await done;await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await shown('slideright');
 await page.unroute(`**/assets/canvas/transition-examples/${delayed}.gif?*`);
 await page.route('**/assets/canvas/transition-examples/zoomin.gif?*',route=>route.fulfill({status:404,body:'Controlled missing example'}));
 await select.selectOption('zoomin');await expect(example).toContainText(de?'Beispiel nicht verfügbar':'Example unavailable');await expect(image).toHaveCount(0);await expect(select).toBeEnabled();await expect(controls.getByRole('button',{name:de?'Übergangsvorschau erstellen':'Preview transition',exact:true})).toBeEnabled();
 await page.unroute('**/assets/canvas/transition-examples/zoomin.gif?*');await select.selectOption('fade');await shown('fade');
 };
 // WebKit retains decoded GIFs in memory: intercept each failure/delay before
 // its first load. Chromium keeps its already-passed sequence unchanged.
 if(nativeCache)await cacheControls('dissolve');
 for(const effect of TRANSITIONS.filter(t=>!['none','fade'].includes(t.id))){
  await select.selectOption(effect.id);await expect(select).toHaveValue(effect.id);await expect.poll(()=>state.edges[0].config.transition.preset).toBe(effect.id);
  await shown(effect.id,effect.id==='flash'?'png':'gif');
  if(effect.id==='flash'){expect(assets).not.toContain('/assets/canvas/transition-examples/flash.gif');await button.click();await shown('flash');}
 }
 expect(new Set(assets.filter(a=>a.endsWith('.gif')).map(a=>path.basename(a,'.gif')))).toEqual(new Set(TRANSITIONS.map(t=>t.id)));
 const count=assets.length;await controls.getByRole('spinbutton',{name:de?'Überlappung (Sekunden)':'Overlap (seconds)',exact:true}).fill('1.2');await controls.getByRole('spinbutton',{name:de?'Überlappung (Sekunden)':'Overlap (seconds)',exact:true}).press('Tab');await expect.poll(()=>state.edges[0].config.transition.duration).toBe(1.2);expect(assets.length).toBe(count);
 await button.focus();await button.press('Space');await shown('light-wash','png');await button.press('Enter');await shown('light-wash');
 await page.emulateMedia({reducedMotion:'reduce'});await shown('light-wash','png');await select.selectOption('bloom');await shown('bloom','png');await button.click();await shown('bloom');
 await page.emulateMedia({reducedMotion:'no-preference'});
 if(!nativeCache)await cacheControls('fade');
 if(nativeCache){await select.selectOption('fade');await shown('fade');}
 // Failed persistence keeps the actual saved effect and its matching example.
 await page.route('**/edges/'+id(5),route=>route.fulfill({status:503,json:{ok:false,error:'Controlled save failure'}}));
 await select.selectOption('none');await expect(controls.getByRole('status')).toHaveText('Controlled save failure');await expect(select).toHaveValue('fade');await shown('fade');await page.unroute('**/edges/'+id(5));
 await page.reload();await open();await shown('fade');await expect(select).toHaveValue('fade');
 if(de)await page.evaluate(()=>document.documentElement.dataset.theme='light');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await button.evaluate(b=>{const r=b.getBoundingClientRect();return r.height>=38&&r.width>44;})).toBe(true);
 expect(state.nodes).toHaveLength(2);expect(state.edges[0].label).toBe('Keep connection');expect(requests).toEqual([]);expect(state.requests.filter(r=>r.pathname.includes('/full-video')||r.pathname.endsWith('/run'))).toEqual([]);expect(errors).toEqual([]);
 await example.screenshot({path:info.outputPath(`transition-examples-${locale}.png`)});await info.attach('static-example-requests',{contentType:'application/json',body:JSON.stringify({illustrations:14,backendRenderRequests:requests.length,selectedOnlyInitially:true})});
};
