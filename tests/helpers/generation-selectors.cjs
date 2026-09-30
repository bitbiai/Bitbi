exports.readHomepageImageCapabilities = page => page.locator('#galleryStudio').evaluate(studio => {
  const steps = studio.querySelector('#galStudioSteps');
  const seed = studio.querySelector('#galStudioSeed');
  const randomize = studio.querySelector('#galStudioRandomize');
  return {
    stepsDisabled: steps.disabled,
    stepsHidden: steps.closest('.creator-create__field').hidden,
    seedDisabled: seed.disabled,
    seedHidden: seed.closest('.creator-create__field').hidden,
    randomizeDisabled: randomize.disabled,
  };
});

exports.memberDimensions = async ({ page, expect, mockSession, locale }) => {
  await mockSession(page, { credits: 1000 });
  const requests = [];
  await page.route('**/api/ai/generate-image', route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true, data: { ...requests.at(-1), mimeType: 'image/png', imageBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0uUAAAAASUVORK5CYII=' }, billing: { balance_after: 990 } } });
  });
  await page.goto(`${locale === 'de' ? '/de' : ''}/generate-lab/`);
  const model = page.locator('#labImageModel');
  await expect(model).toHaveValue('@cf/black-forest-labs/flux-1-schnell');
  await model.selectOption('black-forest-labs/flux-2-max');
  await page.locator('#labImageWidth').selectOption('2048');
  await model.selectOption('@cf/black-forest-labs/flux-2-klein-9b');
  await expect(page.locator('#labImageWidth option')).toHaveText(['256', '512', '768', '1024']);
  await expect(page.locator('#labImageWidth')).toHaveValue('1024');
  await page.locator('#labImageWidth').selectOption('768');
  await page.locator('#labImageHeight').selectOption('512');
  await page.locator('#labPrompt').fill('Retain this dimension test prompt');
  await page.locator('#labGenerate').click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({ model: '@cf/black-forest-labs/flux-2-klein-9b', width: 768, height: 512 });
  await expect(model).toBeEnabled();
  const result = page.locator('#labResultStage img');
  await expect(result).toBeVisible();
  await model.selectOption('xai/grok-imagine-image-2.0');
  await expect(result).toBeVisible();
  await expect(page.locator('#labImageAspect option')).toHaveCount(14);
  await page.locator('#labImageAspect').selectOption('9:16');
  await page.locator('#labImageSize').selectOption('2k');
  await page.locator('#labGenerate').click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]).toMatchObject({ model: 'xai/grok-imagine-image-2.0', aspectRatio: '9:16', size: '2k' });
  expect(requests[1]).not.toHaveProperty('width');
  await expect(model).toBeEnabled();
  await page.locator('[data-media-type="video"]').click();
  await expect(model).toHaveValue('minimax/h3');
  expect(await model.locator('option').evaluateAll(options => options.map(o => o.value))).toEqual([
    'alibaba/hh1-t2v', 'bytedance/seedance-2.0-fast', 'minimax/h3', 'pixverse/v6', 'xai/grok-imagine-video', 'xai/grok-imagine-video-1.5-preview',
  ]);
  await model.selectOption('alibaba/hh1-t2v');
  await expect(page.locator('#labVideoQuality option')).toHaveText(['720P', '1080P']);
  await page.locator('#labVideoQuality').selectOption('1080P');
  await model.selectOption('bytedance/seedance-2.0-fast');
  await expect(page.locator('#labVideoQuality option')).toHaveText(['480p', '720p']);
  await expect(page.locator('#labVideoQuality')).toHaveValue('720p');
  await page.locator('[data-media-type="music"]').click();
  await expect(model).toHaveValue('minimax/music-2.6');
  await expect(page.locator('#labImageWidth')).toBeHidden();
  await expect(page.locator('#labVideoQuality')).toBeHidden();
  await expect(page.locator('#labPrompt')).toHaveValue('Retain this dimension test prompt');
  expect(requests).toHaveLength(2);
};
