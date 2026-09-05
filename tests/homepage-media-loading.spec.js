const { test, expect } = require('@playwright/test');
const { routeHomepageMediaFixtures } = require('./helpers/homepage-media-fixtures');

const SURFACES = [
  { category: 'gallery', collection: 'mempics', grid: '#galleryGrid', card: '.gallery-item', image: '.gallery-item__media', dots: '.gal-deck-dot' },
  { category: 'video', collection: 'memvids', grid: '#videoGrid', card: '.video-card', image: '.video-card__preview', dots: '.vid-deck-dot' },
  { category: 'sound', collection: 'memtracks', grid: '#soundLabTracks', card: '.snd-card--memtrack', image: '.snd-hero > img', dots: '.snd-deck-dot' },
];

async function waitForCards(page) {
  for (const surface of SURFACES) {
    await expect(page.locator(`${surface.grid} ${surface.card}`)).toHaveCount(60);
  }
}

async function expectLoaded(image) {
  await expect.poll(() => image.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
}

async function activateCategory(page, category) {
  await page.locator(`#navbar [data-category-link="${category}"]`).click();
  await expect(page.locator('#homeCategories')).toHaveAttribute('data-active-category', category);
  await expect(page.locator('#homeCategories')).not.toHaveClass(/is-transitioning/);
}

for (const locale of ['/', '/de/']) {
  test(`${locale} desktop requests nearby active-category media and preserves warm revisits`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const fixture = await routeHomepageMediaFixtures(page);
    await page.goto(locale);
    await waitForCards(page);
    await expect(page.locator('#homeCategories')).toHaveAttribute('data-stage-mode', 'desktop');
    await activateCategory(page, 'video');
    await expectLoaded(page.locator('#videoGrid .video-card__preview').first());
    expect(fixture.thumbnailRequests('mempics')).toHaveLength(0);
    expect(fixture.thumbnailRequests('memtracks')).toHaveLength(0);
    expect(fixture.avatarRequests('mempics')).toHaveLength(0);
    expect(fixture.avatarRequests('memtracks')).toHaveLength(0);

    for (const surface of SURFACES) {
      await activateCategory(page, surface.category);
      const images = page.locator(`${surface.grid} ${surface.image}`);
      await expectLoaded(images.first());
      const requests = fixture.thumbnailRequests(surface.collection);
      expect(new Set(requests).size).toBeLessThan(30);
      // Initial Chromium column correction can repeat a completed image fetch.
      expect(requests.length).toBeLessThan(40);
      const deferred = await images.evaluateAll((nodes) => nodes.filter((img) => !img.hasAttribute('src')).length);
      expect(deferred).toBeGreaterThan(30);
    }

    for (const surface of SURFACES) {
      await activateCategory(page, surface.category);
      const images = page.locator(`${surface.grid} ${surface.image}`);
      const beforeScroll = fixture.thumbnailRequests(surface.collection).length;
      const last = images.last();
      await last.scrollIntoViewIfNeeded();
      await expectLoaded(last);
      expect(fixture.thumbnailRequests(surface.collection).length).toBeGreaterThan(beforeScroll);
      // Visiting a different category preserves the same cards and loaded URLs.
      await images.first().evaluate((img) => { window.__warmHomepageImage = img; });
      const firstUrl = await images.first().getAttribute('src');
      const warmRequestCount = fixture.requests.filter((url) => url === firstUrl).length;
      await activateCategory(page, surface.category === 'video' ? 'gallery' : 'video');
      await activateCategory(page, surface.category);
      expect(await images.first().evaluate((img) => img === window.__warmHomepageImage)).toBe(true);
      expect(fixture.requests.filter((url) => url === firstUrl)).toHaveLength(warmRequestCount);
    }
  });

  test(`${locale} mobile loads a small deck window, including jumps, swipes and revisits`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const fixture = await routeHomepageMediaFixtures(page);
    await page.goto(locale);
    await waitForCards(page);
    for (const surface of SURFACES) {
      const grid = page.locator(surface.grid);
      const cards = grid.locator(surface.card);
      await grid.scrollIntoViewIfNeeded();
      await expectLoaded(cards.first().locator(surface.image));
      expect(fixture.thumbnailRequests(surface.collection).length).toBeLessThanOrEqual(4);
      expect(fixture.avatarRequests(surface.collection).length).toBeLessThanOrEqual(4);
      await expect(cards.nth(20).locator(surface.image)).not.toHaveAttribute('src');
      const dot = page.locator(surface.dots).nth(4);
      const target = Number(await dot.getAttribute('data-target-index'));
      await dot.click();
      await expectLoaded(cards.nth(target).locator(surface.image));
      await expectLoaded(cards.nth(target + 2).locator(surface.image));
      expect(fixture.thumbnailRequests(surface.collection).length).toBeLessThanOrEqual(9);

      await grid.dispatchEvent('touchstart', { touches: [{ identifier: 1, clientX: 270, clientY: 200 }] });
      await grid.dispatchEvent('touchmove', { touches: [{ identifier: 1, clientX: 120, clientY: 200 }] });
      await grid.dispatchEvent('touchend', { changedTouches: [{ identifier: 1, clientX: 120, clientY: 200 }] });
      await expect(cards.nth(target + 1)).toHaveCSS('opacity', '1');
      await expectLoaded(cards.nth(target + 1).locator(surface.image));
      const requestsBeforeRevisit = fixture.thumbnailRequests(surface.collection).length;
      await page.locator(surface.dots).first().click();
      await expectLoaded(cards.first().locator(surface.image));
      expect(fixture.thumbnailRequests(surface.collection)).toHaveLength(requestsBeforeRevisit);
      const loaded = await cards.locator(surface.image).evaluateAll((images) => images.filter((img) => img.hasAttribute('src')).length);
      expect(loaded).toBeLessThanOrEqual(10);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await activateCategory(page, 'gallery');
    const deferred = page.locator('#galleryGrid .gallery-item__media:not([src])').last();
    await deferred.scrollIntoViewIfNeeded();
    await expectLoaded(page.locator('#galleryGrid .gallery-item__media').last());
  });

  test(`${locale} delayed thumbnail errors preserve the gallery fallback and keyboard preview`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const fixture = await routeHomepageMediaFixtures(page, {
      failImage: '/api/gallery/mempics/loading-mempics-1/thumb',
    });
    await page.goto(locale);
    await waitForCards(page);
    await activateCategory(page, 'gallery');
    const card = page.locator('#galleryGrid .gallery-item').first();
    await expect(card.locator('.gallery-item__media')).toHaveCSS('display', 'none');
    await card.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#galleryModal')).toHaveClass(/active/);
    await expectLoaded(page.locator('#modalImage img'));
    expect(fixture.requests).toContain('/api/gallery/mempics/loading-mempics-1/medium');
    await page.keyboard.press('Escape');
    await expect(page.locator('#galleryModal')).not.toHaveClass(/active/);
    expect(fixture.thumbnailRequests('mempics').filter((url) => url.endsWith('/loading-mempics-1/thumb'))).toHaveLength(1);
  });

  test(`${locale} tablet resize during category preparation releases distant media loading`, async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'WebKit uses instant category switches without a preparation transition.');
    await page.setViewportSize({ width: 820, height: 900 });
    const fixture = await routeHomepageMediaFixtures(page);
    await page.goto(locale);
    await waitForCards(page);
    await expect(page.locator('#homeCategories')).toHaveAttribute('data-stage-mode', 'desktop');
    await page.evaluate(() => {
      document.addEventListener('bitbi:homepage-category-layout-request', (event) => {
        if (event.detail.category !== 'gallery') return;
        event.detail.waitUntil(new Promise(() => {}));
      }, { once: true });
      document.querySelector('[data-category-link="gallery"]').click();
    });
    await expect(page.locator('[data-category-panel="gallery"]')).toHaveClass(/is-layout-preparing/);
    await page.setViewportSize({ width: 820, height: 650 });
    await expect(page.locator('#homeCategories')).toHaveAttribute('data-stage-mode', 'stacked');
    const lastImage = page.locator('#galleryGrid .gallery-item__media').last();
    await lastImage.scrollIntoViewIfNeeded();
    await expectLoaded(lastImage);
    expect(fixture.thumbnailRequests('mempics')).toContain(await lastImage.getAttribute('src'));
  });
}
