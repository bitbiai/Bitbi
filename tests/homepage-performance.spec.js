const { test, expect, home, openAuth } = require('./helpers/remediation-ui-fixtures');

for (const locale of ['en', 'de']) {
  for (const width of [390, 1440]) {
    test(`${locale} ${width}: homepage lossless images retain PNG fallbacks and dimensions`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const images = [];
      page.on('request', request => {
        if (request.resourceType() === 'image') images.push(new URL(request.url()).pathname);
      });
      const state = await home(page, locale);
      for (const [selector, webp, original, size] of [
        ['.hero__title-img', '/assets/images/bitbi-title-lossless.webp', '/assets/images/1.png', [600, 391]],
        ['.watermark__img', '/assets/images/bitbi-watermark-lossless.webp', '/assets/favicons/android-chrome-512x512.png', [512, 512]],
      ]) {
        const image = page.locator(selector);
        await expect.poll(() => image.evaluate(img => img.complete && img.naturalWidth > 0 && new URL(img.currentSrc).pathname)).toBe(webp);
        expect(images).not.toContain(original);
        const before = await image.boundingBox();
        expect(await image.evaluate(img => [img.naturalWidth, img.naturalHeight])).toEqual(size);
        await image.evaluate(img => img.parentElement.querySelector('source').remove());
        await expect.poll(() => image.evaluate(img => img.complete && img.naturalWidth > 0 && new URL(img.currentSrc).pathname)).toBe(original);
        const after = await image.boundingBox();
        expect(after.width).toBeCloseTo(before.width, 1);
        expect(after.height).toBeCloseTo(before.height, 1);
      }
      expect(state.errors).toEqual([]);
      expect(state.mutations).toEqual([]);
    });
  }

  test(`${locale}: initial homepage and auth overlay use one versioned auth API module`, async ({ page }) => {
    const urls = new Set();
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname === '/js/shared/auth-api.js') urls.add(url.pathname + url.search);
    });
    const state = await home(page, locale);
    await openAuth(page);
    await page.locator('.auth-modal__tab[data-tab="register"]').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.auth-modal__overlay')).not.toHaveClass(/active/);
    expect([...urls]).toHaveLength(1);
    expect([...urls][0]).toMatch(/^\/js\/shared\/auth-api\.js\?v=.+/);
    expect(state.errors).toEqual([]);
    expect(state.mutations).toEqual([]);
  });
}
