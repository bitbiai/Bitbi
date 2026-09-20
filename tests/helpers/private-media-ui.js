// Shared Admin browser check; invoked by the existing tagged Chromium/WebKit case.
module.exports = async ({page,expect,mockAdminControlPlane}) => {
    await mockAdminControlPlane(page);
    let state={backend:'github',thumbnailBackend:'cloudflare',services:{github:{state:'ready'},cloudflare:{state:'ready'}},dispatch:[]};
    const saves=[];
    await page.route('**/api/admin/private-media/service',async route=>{
      if(route.request().method()==='POST'){const body=route.request().postDataJSON();saves.push(body);state={...state,backend:body.backend,thumbnailBackend:body.thumbnailBackend};}
      await route.fulfill({json:{ok:true,data:state}});
    });
    await page.goto('/admin/index.html#operations');
    const assembly=page.getByRole('combobox',{name:'Full-video assembly',exact:true}),thumbnail=page.getByRole('combobox',{name:'Thumbnails and previews',exact:true});
    await expect(assembly).toHaveValue('github');await expect(thumbnail).toHaveValue('cloudflare');
    await thumbnail.selectOption('github');await page.locator('#privateMediaServiceReason').fill('Synthetic explicit alternative');
    page.once('dialog',dialog=>dialog.accept());await page.locator('#privateMediaServiceSave').click();
    await expect.poll(()=>saves.length).toBe(1);
    expect(saves[0]).toEqual({backend:'github',thumbnailBackend:'github',reason:'Synthetic explicit alternative'});
    await expect(thumbnail).toHaveValue('github');await expect(assembly).toHaveValue('github');
    state={...state,services:{...state.services,cloudflare:{state:'ready',thumbnailState:'not_configured'}}};
    await page.locator('#operationsRefresh').click();
    await expect(thumbnail.locator('option[value="cloudflare"]')).toHaveJSProperty('disabled',true);
    await expect(assembly.locator('option[value="cloudflare"]')).toHaveJSProperty('disabled',false);
    await expect(page.locator('#privateMediaServiceStatus')).toContainText('Not configured');
    await page.setViewportSize({width:390,height:844});
    await expect(thumbnail).toBeVisible();
    const layout=await page.locator('#privateMediaServicePanel').evaluate(el=>({width:el.scrollWidth,client:el.clientWidth}));
    expect(layout.width).toBeLessThanOrEqual(layout.client+1);
};
