// Synthetic responses establish UI contracts, never paid provider acceptance.
const fs=require('node:fs');
const path=require('node:path');
const model='google/gemini-omni-flash';
async function snapshot(enabled=false){
 const {tariffKey}=await import('../../js/shared/model-tariff.mjs');
 return {ok:true,revision:1,rules:Object.fromEntries(['text','image','reference','frames','edit'].map(operation=>[tariffKey(model,{resolution:'720p',operation}),{rates:{request:operation==='edit'?53:37}}])),omni:{revision:enabled?2:1,adminTestEnabled:enabled,adminTestCredits:29,enabled:Object.fromEntries(['generation','image','frames','reference_images','video_edit','audio_reference','360p','720p','1080p','4k'].map(k=>[k,enabled]))}};
}
exports.snapshot=snapshot;
exports.admin=async({page,expect,mockAdminAiLab,clickAiLabMode})=>{
 const {listAdminAiCatalog}=await import('../../js/shared/admin-ai-contract.mjs');
 await mockAdminAiLab(page,{catalog:{ok:true,...listAdminAiCatalog({includeCanvas:true})}});
 let enabled=false;const writes=[];
 await page.route('**/api/admin/ai/model-pricing',async route=>route.fulfill({json:await snapshot(enabled)}));
 await page.addInitScript(()=>localStorage.setItem('bitbi_admin_ai_lab_state_v1',JSON.stringify({forms:{video:{model:'google/gemini-omni-flash',preset:'video_gemini_omni_flash',prompt:'Synthetic audio and motion',resolution:'720p',aspectRatio:'16:9'}}})));
 await page.route('**/api/admin/ai/video-jobs',route=>{writes.push(route.request().postDataJSON());return route.fulfill({status:202,json:{ok:true,job:{jobId:'omni-synthetic',status:'queued',model,statusUrl:'/api/admin/ai/video-jobs/omni-synthetic'}}});});
 await page.route('**/api/admin/ai/video-jobs/omni-synthetic',route=>route.fulfill({json:{ok:true,job:{jobId:'omni-synthetic',status:'provider_pending',model}}}));
 await page.goto('/admin/index.html#ai-lab');await clickAiLabMode(page,'video');
 await expect(page.locator('#aiVideoModel')).toHaveValue(model);
 await expect(page.locator('#aiVideoRun')).toBeDisabled();await expect(page.locator('#aiVideoDuration')).toBeHidden();
 await expect(page.locator('[data-omni-references] select')).toHaveCount(1);
 expect((await page.locator('#aiVideoResolution option:not([disabled])').allTextContents()).sort()).toEqual(['1080p','360p','4k','720p']);
 enabled=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.locator('#aiVideoRun')).toBeEnabled();await expect(page.locator('#aiVideoRun')).toContainText('29');
 await page.locator('#aiVideoRun').click();await expect.poll(()=>writes.length).toBe(1);
 expect(writes[0]).toMatchObject({model,prompt:'Synthetic audio and motion',resolution:'720p',aspect_ratio:'16:9',references:[]});
 for(const key of ['duration','generate_audio','seed','previous_interaction_id'])expect(writes[0]).not.toHaveProperty(key);
};
exports.member=async({page,expect,locale,mockGenerateLabMemberSession})=>{
 await mockGenerateLabMemberSession(page,{credits:3000});let enabled=false;const writes=[];
 await page.route('**/api/model-pricing',async route=>route.fulfill({json:await snapshot(enabled)}));
 const png=fs.readFileSync(path.join(__dirname,'../fixtures/media/member-image.png'));
 await page.route('**/api/ai/images/save',route=>route.fulfill({json:{ok:true,data:{id:'omni-owned-upload'}}}));
 await page.route('**/api/ai/images/omni-owned-upload/medium',route=>route.fulfill({contentType:'image/png',body:png}));
 await page.route('**/api/ai/generate-video',route=>{writes.push(route.request().postDataJSON());return route.fulfill({status:409,json:{ok:false,code:'omni_capability_disabled',error:'Synthetic capability disabled after quote'}});});
 await page.goto(locale==='de'?'/de/generate-lab/':'/generate-lab/');await page.getByRole('tab',{name:'Video',exact:true}).click();
 await page.locator('#labImageModel').selectOption(model);
 await expect(page.locator('#labGenerate')).toBeDisabled();await expect(page.locator('#labVideoDuration')).toBeHidden();
 const refs=page.locator('[data-omni-references]');await expect(refs).toBeVisible();
 expect(await refs.locator('select option').count()).toBe(5);
 await refs.locator('input[type=file]').setInputFiles({name:'owned-frame.png',mimeType:'image/png',buffer:png});
 await expect(refs.locator('li')).toHaveCount(1);await expect.poll(()=>refs.locator('img').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
 enabled=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await page.locator('#labPrompt').fill('Synthetic frame instruction');await expect(page.locator('#labCost')).toContainText('37');await expect(page.locator('#labGenerate')).toBeEnabled();
 await page.locator('#labGenerate').click();await expect.poll(()=>writes.length).toBe(1);
 expect(writes[0]).toMatchObject({model,resolution:'720p',references:[{role:'first_frame',source:{source_type:'saved_asset',asset_id:'omni-owned-upload'}}]});
 for(const key of ['duration','generate_audio','seed','previous_interaction_id'])expect(writes[0]).not.toHaveProperty(key);
 await expect(page.locator('#labPrompt')).toHaveValue('Synthetic frame instruction');await expect(refs.locator('li')).toHaveCount(1);
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
};

exports.registerAdmin=(register,fixtures)=>{
 register('@canvas-model-ui H3 Admin roles and durable controls',({page})=>require('./h3-model-controls.cjs').adminControls({page,...fixtures}));
 register('@canvas-model-ui Omni Admin budget gate and exact controls',({page})=>exports.admin({page,...fixtures}));
};
