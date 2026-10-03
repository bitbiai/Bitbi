// Synthetic UI fixtures; no provider calls or provider acceptance claims.
const fs=require('node:fs'),path=require('node:path');
const model='bytedance/seedance-2.5';
exports.snapshot=async()=>({ok:true,revision:1,availability:require('../fixtures/model-availability.json'),rules:(await import('../../js/shared/seedance-25-pricing.mjs')).seedance25InitialTariffRules()});
async function controls(page,expect,root,de=false){
 const select=key=>root.locator(`[data-seedance25-setting="${key}"]`);
 await expect(root).toBeVisible();await expect(select('duration')).toHaveValue('5');
 expect(await select('duration').locator('option').count()).toBe(28);
 await select('duration').selectOption('30');await select('resolution').selectOption('480p');
 await select('output_format').selectOption('mov');await select('generate_audio').selectOption('true');
 await select('use_virtual_avatar').selectOption('true');await select('seed').fill('-42');await select('seed').press('Tab');
 await select('aspect_ratio').selectOption('21:9');
 for(const theme of ['dark','light','soft']){await page.evaluate(v=>document.documentElement.dataset.theme=v,theme);await expect(select('duration')).toBeVisible();}
 await page.setViewportSize({width:page.url().includes('/admin/')?390:1100,height:900});await select('output_format').scrollIntoViewIfNeeded();await select('output_format').focus();await expect(select('output_format')).toBeFocused();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
}
exports.member=async({page,expect,locale,mockGenerateLabMemberSession})=>{
 const de=locale==='de',writes=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 await mockGenerateLabMemberSession(page,{credits:50000});await page.route('**/api/model-pricing',async route=>route.fulfill({json:await exports.snapshot()}));
 const png=fs.readFileSync(path.join(__dirname,'../fixtures/media/member-image.png'));
 await page.route('**/api/ai/images/save',route=>route.fulfill({json:{ok:true,data:{id:'seedance-frame'}}}));
 await page.route('**/api/ai/images/seedance-frame/medium',route=>route.fulfill({contentType:'image/png',body:png}));
 await page.route('**/api/ai/generate-video',route=>{writes.push(route.request().postDataJSON());return route.fulfill({status:409,json:{ok:false,code:'model_area_disabled',error:'Synthetic stale model restriction'}});});
 await page.goto(de?'/de/generate-lab/':'/generate-lab/');await page.getByRole('tab',{name:'Video',exact:true}).click();await page.locator('#labImageModel').selectOption(model);
 const root=page.locator('[data-seedance25-controls]');await controls(page,expect,root,de);
 const refs=root.locator('[data-seedance25-references]');await refs.locator('input[type=file]').setInputFiles({name:'owned-frame.png',mimeType:'image/png',buffer:png});
 await expect(refs.locator('li')).toHaveCount(1);await expect(root.locator('[data-seedance25-setting=aspect_ratio]')).toHaveValue('adaptive');await expect(root.locator('[data-seedance25-setting=aspect_ratio]')).toBeDisabled();
 await expect(page.locator('#labVideoDuration')).toBeHidden();await expect(page.locator('#labGenerate')).toBeEnabled();
 await page.locator('#labGenerate').click();await expect.poll(()=>writes.length).toBe(1);
 expect(writes[0]).toMatchObject({model,prompt:'',duration:30,resolution:'480p',aspect_ratio:'adaptive',output_format:'mov',generate_audio:true,use_virtual_avatar:true,seed:-42,references:[{role:'first_frame',source:{source_type:'saved_asset',asset_id:'seedance-frame'}}]});
 expect(writes[0]).not.toHaveProperty('mode');await expect(refs.locator('li')).toHaveCount(1);expect(errors).toEqual([]);
 await page.setViewportSize({width:390,height:844});await expect(page.getByRole('region',{name:de?'Für Desktop optimiert':'Optimized for desktop'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.setViewportSize({width:1280,height:900});
 await page.reload();await page.getByRole('tab',{name:'Video',exact:true}).click();await page.locator('#labImageModel').selectOption(model);await expect(refs.locator('li')).toHaveCount(1);await expect(root.locator('[data-seedance25-setting=output_format]')).toHaveValue('mov');
};
exports.admin=async({page,expect,mockAdminAiLab,clickAiLabMode})=>{
 const {listAdminAiCatalog}=await import('../../js/shared/admin-ai-contract.mjs');const writes=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 await mockAdminAiLab(page,{catalog:{ok:true,...listAdminAiCatalog({includeCanvas:true})}});
 await page.route('**/api/admin/ai/model-pricing',async route=>route.fulfill({json:await exports.snapshot()}));
 await page.route('**/api/admin/ai/video-jobs',route=>{writes.push(route.request().postDataJSON());return route.fulfill({status:202,json:{ok:true,job:{jobId:'seedance-synthetic',status:'queued',model,statusUrl:'/api/admin/ai/video-jobs/seedance-synthetic'}}});});
 await page.route('**/api/admin/ai/video-jobs/seedance-synthetic',route=>route.fulfill({json:{ok:true,job:{jobId:'seedance-synthetic',status:'provider_pending',model}}}));
 await page.goto('/admin/index.html#ai-lab');await clickAiLabMode(page,'video');await page.locator('#aiVideoModel').selectOption(model);
 const root=page.locator('[data-seedance25-controls]');await controls(page,expect,root);
 await page.reload();await clickAiLabMode(page,'video');await expect(root.locator('[data-seedance25-setting=output_format]')).toHaveValue('mov');await expect(root.locator('[data-seedance25-setting=seed]')).toHaveValue('-42');
 await page.locator('#aiVideoPrompt').fill('Synthetic audio and motion');await page.locator('#aiVideoRun').click();await expect.poll(()=>writes.length).toBe(1);
 expect(writes[0]).toMatchObject({model,duration:30,resolution:'480p',aspect_ratio:'21:9',output_format:'mov',generate_audio:true,seed:-42});expect(writes[0]).not.toHaveProperty('mode');expect(errors).toEqual([]);
};

exports.savedMov=async({page,expect,mockGenerateLabMemberSession})=>{
 await mockGenerateLabMemberSession(page,{credits:50000});const writes=[];
 await page.route('**/api/ai/generate-video',route=>{writes.push(route.request().method());return route.abort();});
 await page.route('**/api/ai/assets?limit=6',route=>route.fulfill({json:{data:{assets:[{id:'seedance-mov',asset_type:'video',source_module:'video',model,title:'Saved Seedance MOV',mime_type:'video/quicktime',file_url:'/api/ai/text-assets/seedance-mov/file',poster_url:'/api/ai/text-assets/seedance-mov/poster'}]}}}));
 await page.route('**/api/ai/text-assets/seedance-mov/file',route=>route.fulfill({contentType:'video/quicktime',body:fs.readFileSync(path.join(__dirname,'../fixtures/media/seedance-output.mov'))}));
 await page.route('**/api/ai/text-assets/seedance-mov/poster',route=>route.fulfill({contentType:'image/png',body:fs.readFileSync(path.join(__dirname,'../fixtures/media/member-image.png'))}));
 await page.goto('/generate-lab/');await page.getByRole('button',{name:'Open Saved Seedance MOV in Generate Lab preview'}).click();
 const video=page.locator('#labResultStage video');await expect(video).toBeVisible();
 await expect.poll(()=>video.evaluate(v=>v.videoWidth>0&&v.currentTime>0.1&&v.error===null)).toBe(true);
 // Observe the media element's actual decoder. WebKit does not promise MOV
 // support in the separate decodeAudioData API, even when its player supports it.
 await video.evaluate(v=>{
   v.pause();v.currentTime=0;v.muted=false;v.volume=1;
   const context=new AudioContext(),analyser=context.createAnalyser(),gain=context.createGain();analyser.fftSize=2048;
   context.createMediaElementSource(v).connect(gain);gain.connect(analyser);analyser.connect(context.destination);
   window.seedanceAudio={context,analyser,gain,video:v};
   document.addEventListener('pointerdown',()=>{context.resume();v.play();},{once:true});
 });
 await page.mouse.click(5,5);
 const decoded=await page.evaluate(async()=>{
   const {context,analyser,gain,video}=window.seedanceAudio,data=new Float32Array(analyser.fftSize);
   const rms=()=>{analyser.getFloatTimeDomainData(data);return Math.sqrt(data.reduce((n,v)=>n+v*v,0)/data.length);};
   let peak=0;for(let i=0;i<15;i++){await new Promise(resolve=>setTimeout(resolve,50));peak=Math.max(peak,rms());}
   gain.gain.value=0;await new Promise(resolve=>setTimeout(resolve,150));const quiet=rms();video.pause();
   await context.close();delete window.seedanceAudio;return {peak,quiet,seconds:video.duration};
 });
 expect(decoded.seconds).toBeCloseTo(4,1);expect(decoded.peak).toBeGreaterThan(0.03);expect(decoded.peak).toBeLessThan(0.2);expect(decoded.quiet).toBeLessThan(0.001);
 expect(writes).toEqual([]);
};
exports.adminRecovery=async({page,expect,mockAdminAiLab,clickAiLabMode})=>{
 const {listAdminAiCatalog}=await import('../../js/shared/admin-ai-contract.mjs');await mockAdminAiLab(page,{catalog:{ok:true,...listAdminAiCatalog({includeCanvas:true})}});
 await page.route('**/api/admin/ai/video-jobs/saved-mov/recover',route=>route.fulfill({json:{ok:true,job:{jobId:'saved-mov',status:'succeeded',model,outputUrl:'/api/admin/ai/video-jobs/saved-mov/output',outputFormat:'mov'}}}));
 await page.route('**/api/admin/ai/video-jobs/saved-mov/output',route=>route.fulfill({contentType:'video/quicktime',body:fs.readFileSync(path.join(__dirname,'../fixtures/media/seedance-output.mov'))}));
 await page.goto('/admin/index.html#ai-lab');await clickAiLabMode(page,'video');
 await page.locator('#aiVideoRecovery summary').click();await page.locator('#aiVideoRecoveryJobId').fill('saved-mov');await page.locator('#aiVideoRecoveryRaw').fill(JSON.stringify({state:'Completed',result:{video:'https://fixture.invalid/output.mov'}}));await page.locator('#aiVideoRecoveryImport').click();
 await expect(page.locator('#aiVideoRecoveryState')).toContainText('Recovered provider video imported and stored.');
 const downloadPromise=page.waitForEvent('download');await page.locator('#aiVideoDownload').click();const download=await downloadPromise;expect(download.suggestedFilename()).toMatch(/\.mov$/);
};
