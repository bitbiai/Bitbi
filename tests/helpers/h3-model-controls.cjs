// Called by auth-admin.spec.js in both selected Canvas/model browser engines.
exports.adminControls=async({page,expect,mockAdminAiLab,clickAiLabMode,lite=false})=>{
    const modelId=lite?'minimax/h3-lite':'minimax/h3',resolution=lite?'768P':'2K',preset=lite?'video_minimax_h3_lite':'video_minimax_h3';
    const {listAdminAiCatalog}=await import('../../js/shared/admin-ai-contract.mjs');
    await mockAdminAiLab(page,{catalog:{ok:true,...listAdminAiCatalog({includeCanvas:true})}});

    await page.route('**/api/ai/assets**',route=>route.fulfill({json:{ok:true,data:{assets:[{id:'h3-owned-image',asset_type:'image',source_module:'image',title:'Owned last frame',mime_type:'image/png',url:'/assets/logo.png'}],has_more:false}}}));
    const requests=[];
    await page.addInitScript(({modelId,resolution,preset})=>localStorage.setItem('bitbi_admin_ai_lab_state_v1',JSON.stringify({forms:{video:{model:modelId,preset,prompt:'Synthetic H3',resolution,duration:6,aspectRatio:'adaptive',h3References:[{role:'first_frame',source:{source_type:'saved_asset',asset_id:'asset_saved_image_1'},title:'Owned frame'}]}}})),{modelId,resolution,preset});
    await page.route('**/api/admin/ai/video-jobs',route=>{requests.push(route.request().postDataJSON());return route.fulfill({status:202,json:{ok:true,job:{jobId:'h3-admin-synthetic',status:'queued',model:modelId,statusUrl:'/api/admin/ai/video-jobs/h3-admin-synthetic'}}});});
    await page.route('**/api/admin/ai/video-jobs/h3-admin-synthetic',route=>route.fulfill({json:{ok:true,job:{jobId:'h3-admin-synthetic',status:'provider_pending',model:modelId}}}));
    await page.goto('/admin/index.html#ai-lab');await clickAiLabMode(page,'video');
    await expect(page.locator('#aiVideoModel')).toBeVisible();
    await expect(page.locator('#aiVideoModel')).toHaveValue(modelId);
    await expect(page.locator('#aiVideoResolution')).toHaveValue(resolution);
    await expect(page.locator('#aiVideoResolution option:not([disabled])')).toHaveText(lite?['768P','480P']:['768P','2K']);
    await expect(page.locator('[data-h3-references]')).toContainText('Owned frame');
    const controls=page.locator('[data-h3-references]');
    await controls.locator('select').selectOption('last_frame');
    await controls.getByRole('button',{name:'Choose saved media'}).click();
    await page.locator('#aiLabAssetsGrid [data-asset-id="h3-owned-image"]').click();
    await page.locator('#aiLabAssetsPickerApply').click();
    await expect(controls).toContainText('Owned last frame');
    await expect(page.locator('#aiLabAssetsPickerActions')).toBeHidden();
    await page.locator('#aiVideoRun').click();await expect.poll(()=>requests.length).toBe(1);
    expect(requests[0]).toMatchObject({model:modelId,duration:6,resolution,aspect_ratio:'adaptive',references:[{role:'first_frame',source:{source_type:'saved_asset',asset_id:'asset_saved_image_1'}},{role:'last_frame',source:{source_type:'saved_asset',asset_id:'h3-owned-image'}}]});
    expect(requests[0]).not.toHaveProperty('callback_url');expect(requests[0]).not.toHaveProperty('h3_callback');
};
