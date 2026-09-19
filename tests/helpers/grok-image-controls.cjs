// Executed by the existing Admin spec with its authorized synthetic fixture.
exports.image2Controls = async ({page,expect,mockAdminAiLab,clickAiLabMode}) => {
    const {listAdminAiCatalog}=await import('../../js/shared/admin-ai-contract.mjs');
    const imageTestRequests=[];
    await mockAdminAiLab(page,{catalog:{ok:true,...listAdminAiCatalog({includeCanvas:true})},imageTestRequests});
    await page.goto('/admin/index.html#ai-lab');await clickAiLabMode(page,'image');
    await page.selectOption('#aiImageModel','xai/grok-imagine-image-2.0');
    await expect(page.locator('#aiImageQuality option')).toHaveText(['low','medium']);
    await expect(page.locator('#aiImageResolution option')).toHaveText(['1k','2k']);
    await expect(page.locator('#aiImageOutputCount')).toBeHidden();
    await page.locator('#aiImagePrompt').fill('Synthetic image');
    await page.locator('#aiImageQuality').selectOption('medium');await page.locator('#aiImageResolution').selectOption('2k');
    await page.locator('.admin-ai__video-source-card',{hasText:'Mock Image Source'}).click();
    await expect(page.locator('#aiImageSourceSelected')).toContainText('Mock Image Source');
    await page.locator('#aiImageRun').click();await expect(page.locator('#aiImageState')).toContainText('Image response ready.');
    expect(imageTestRequests).toHaveLength(1);expect(imageTestRequests[0]).toMatchObject({model:'xai/grok-imagine-image-2.0',quality:'medium',resolution:'2k',source_image:{source_type:'saved_asset',asset_id:'image-source-mock-1'}});
    expect(imageTestRequests[0]).not.toHaveProperty('n');
    await expect(page.locator('#aiImageGptCostHint')).toContainText('Estimated credits:');
};
