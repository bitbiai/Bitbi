const { test, expect, devices } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const MODELS_OVERLAY_PATHS = [
  '/legal/privacy.html',
  '/legal/imprint.html',
  '/legal/datenschutz.html',
  '/account/profile.html',
  '/account/image-studio.html',
  '/admin/index.html',
];

const STATIC_SHARED_HEADER_PATHS = [
  '/legal/privacy.html',
  '/legal/imprint.html',
  '/legal/datenschutz.html',
  '/admin/index.html',
  '/account/profile.html',
  '/account/image-studio.html',
  '/account/forgot-password.html',
  '/account/reset-password.html',
  '/account/verify-email.html',
];

let expectedHomepageModelCatalog = null;

async function getExpectedHomepageModelCatalog() {
  if (expectedHomepageModelCatalog) return expectedHomepageModelCatalog;

  const contractModule = await import(
    pathToFileURL(path.join(__dirname, '..', 'js/shared/admin-ai-contract.mjs')).href
  );
  const imageModelsModule = await import(
    pathToFileURL(path.join(__dirname, '..', 'js/shared/ai-image-models.mjs')).href
  );
  const { models } = contractModule.listAdminAiCatalog();
  const liveImageModels = Array.isArray(imageModelsModule.AI_IMAGE_MODELS)
    ? imageModelsModule.AI_IMAGE_MODELS
    : [];
  const adminImageModels = Array.isArray(models.image) ? models.image : [];
  const adminImageById = new Map(adminImageModels.map((entry) => [entry.id, entry]));
  const liveImageIds = new Set();

  const imageEntries = liveImageModels.map((entry) => {
    liveImageIds.add(entry.id);
    const adminEntry = adminImageById.get(entry.id);
    return {
      name: entry.label,
      vendor: adminEntry?.vendor || '',
      status: 'Live',
    };
  });

  for (const entry of adminImageModels) {
    if (!entry?.id || liveImageIds.has(entry.id)) continue;
    imageEntries.push({
      name: entry.label,
      vendor: entry.vendor,
      status: 'Coming soon',
    });
  }

  expectedHomepageModelCatalog = [
    {
      category: 'IMAGE GENERATION',
      models: imageEntries,
    },
    {
      category: 'MUSIC GENERATION',
      models: (models.music || []).map((entry) => ({
        name: entry.label,
        vendor: entry.vendor,
        status: 'Coming soon',
      })),
    },
    {
      category: 'VIDEO GENERATION',
      models: (models.video || []).map((entry) => ({
        name: entry.label,
        vendor: entry.vendor,
        status: 'Coming soon',
      })),
    },
  ];

  return expectedHomepageModelCatalog;
}

async function expectPathUnchanged(page, expectedPath) {
  await expect.poll(() => {
    const url = new URL(page.url());
    return `${url.pathname}${url.hash}`;
  }).toBe(expectedPath);
}

async function expectModelsOverlayOpenState(page) {
  const overlay = page.locator('.models-overlay');
  const expectedCatalog = await getExpectedHomepageModelCatalog();

  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveClass(/is-active/);

  const actualCatalog = await overlay.locator('.models-overlay__group').evaluateAll((nodes) => (
    nodes.map((node) => ({
      category: node.querySelector('.models-overlay__category')?.textContent?.trim() || '',
      models: Array.from(node.querySelectorAll('.models-overlay__card')).map((card) => ({
        name: card.querySelector('.models-overlay__name')?.textContent?.trim() || '',
        vendor: card.querySelector('.models-overlay__vendor')?.textContent?.trim() || '',
        status: card.querySelector('.models-overlay__status')?.textContent?.trim() || '',
      })),
    }))
  ));

  expect(actualCatalog).toEqual(expectedCatalog);
}

async function dispatchHorizontalTouchSwipe(page, selector, {
  startXFactor = 0.82,
  endXFactor = 0.18,
  yFactor = 0.5,
} = {}) {
  await page.evaluate(async ({ selector, startXFactor, endXFactor, yFactor }) => {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`Missing swipe target: ${selector}`);

    const rect = element.getBoundingClientRect();
    const startX = rect.left + (rect.width * startXFactor);
    const endX = rect.left + (rect.width * endXFactor);
    const midX = rect.left + (rect.width * 0.5);
    const y = rect.top + (rect.height * yFactor);

    const fire = (type, x, clientY) => {
      const touch = {
        identifier: 1,
        target: element,
        clientX: x,
        clientY,
        pageX: x + window.scrollX,
        pageY: clientY + window.scrollY,
        screenX: x,
        screenY: clientY,
      };
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', {
        value: type === 'touchend' ? [] : [touch],
      });
      Object.defineProperty(event, 'targetTouches', {
        value: type === 'touchend' ? [] : [touch],
      });
      Object.defineProperty(event, 'changedTouches', {
        value: [touch],
      });
      element.dispatchEvent(event);
    };

    fire('touchstart', startX, y);
    fire('touchmove', midX, y);
    fire('touchmove', endX, y);
    fire('touchend', endX, y);

    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, { selector, startXFactor, endXFactor, yFactor });
}

async function expectActiveHomepageCategory(page, expectedCategory) {
  await expect
    .poll(async () => page.locator('#homeCategories').getAttribute('data-active-category'))
    .toBe(expectedCategory);
}

async function waitForHomepageCategoryStage(page) {
  const stage = page.locator('#homeCategories');
  await expect
    .poll(async () => (await stage.getAttribute('class')) || '')
    .not.toContain('is-transitioning');
}

async function readHomepageCategoryStageMetrics(page) {
  return page.evaluate(() => {
    const stage = document.getElementById('homeCategories');
    const navbar = document.getElementById('navbar');
    const prev = stage?.querySelector('[data-category-nav="prev"]:not([hidden])');
    const next = stage?.querySelector('[data-category-nav="next"]:not([hidden])');
    const stageRect = stage?.getBoundingClientRect();
    const navRect = navbar?.getBoundingClientRect();

    const readArrow = (button) => {
      if (!button || !stageRect) return null;
      const rect = button.getBoundingClientRect();
      const iconRect = button.querySelector('svg')?.getBoundingClientRect() || null;
      return {
        width: Math.round(rect.width * 100) / 100,
        height: Math.round(rect.height * 100) / 100,
        centerRatio: Math.round((((rect.top + (rect.height / 2)) - stageRect.top) / stageRect.height) * 1000) / 1000,
        iconWidth: iconRect ? Math.round(iconRect.width * 100) / 100 : 0,
        iconHeight: iconRect ? Math.round(iconRect.height * 100) / 100 : 0,
      };
    };

    return {
      alignmentDelta: Math.round(Math.abs((stageRect?.top || 0) - (navRect?.bottom || 0)) * 100) / 100,
      isTransitioning: stage?.classList.contains('is-transitioning') || false,
      prev: readArrow(prev),
      next: readArrow(next),
    };
  });
}

async function waitForHomepageCategoryAlignment(page) {
  await expect
    .poll(async () => (await readHomepageCategoryStageMetrics(page)).alignmentDelta)
    .toBeLessThanOrEqual(2);
}

async function switchHomepageCategory(page, targetCategory) {
  const stage = page.locator('#homeCategories');
  const desktopCategoryNav = page.locator('#navbar .site-nav__links');
  const targetSelector = {
    gallery: '#gallery',
    video: '#video-creations',
    sound: '#soundlab',
  }[targetCategory];
  const targetLabel = {
    gallery: 'Gallery',
    video: 'Video',
    sound: 'Sound Lab',
  }[targetCategory];

  await expect(stage).toBeVisible();
  await waitForHomepageCategoryStage(page);

  if (!targetSelector || !targetLabel) {
    throw new Error(`Unknown homepage category "${targetCategory}"`);
  }

  if (!(await desktopCategoryNav.isVisible())) {
    await page.locator(targetSelector).scrollIntoViewIfNeeded();
    await expect(page.locator(targetSelector)).toBeVisible();
    return;
  }

  const currentCategory = await stage.getAttribute('data-active-category');
  if (currentCategory === targetCategory) return;

  await desktopCategoryNav.getByRole('link', { name: targetLabel }).click();
  await expectActiveHomepageCategory(page, targetCategory);
  await waitForHomepageCategoryStage(page);
}

async function readHomepageHeaderCategoryGlow(page) {
  return page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('#navbar .site-nav__links [data-category-link]'));
    return Object.fromEntries(links.map((link) => [
      link.dataset.categoryLink,
      {
        active: link.classList.contains('is-active-category'),
        ariaCurrent: link.getAttribute('aria-current') || '',
        boxShadow: window.getComputedStyle(link).boxShadow,
      },
    ]));
  });
}

async function expectHomepageHeaderCategoryGlow(page, expectedCategory) {
  await expect
    .poll(async () => {
      const state = await readHomepageHeaderCategoryGlow(page);
      return Object.entries(state)
        .filter(([, value]) => value.active)
        .map(([key]) => key);
    })
    .toEqual([expectedCategory]);

  const state = await readHomepageHeaderCategoryGlow(page);
  expect(state[expectedCategory].ariaCurrent).toBe('location');
  expect(state[expectedCategory].boxShadow).not.toBe('none');

  for (const category of ['gallery', 'video', 'sound']) {
    if (category === expectedCategory) continue;
    expect(state[category].ariaCurrent).toBe('');
  }
}

// ---------------------------------------------------------------------------
// Homepage
// ---------------------------------------------------------------------------

test.describe('Homepage', () => {
  test('loads successfully with correct title', async ({ page }) => {
    const response = await page.goto('/');
    expect(response.status()).toBe(200);
    await expect(page).toHaveTitle(/BITBI/);
  });

  test('refreshing mid-page preserves the current scroll position', async ({ page }) => {
    await page.goto('/');

    const beforeReload = await page.evaluate(() => {
      window.scrollTo(0, 1480);
      return Math.round(window.scrollY);
    });

    await page.reload();

    await expect.poll(async () => {
      const currentScroll = await page.evaluate(() => Math.round(window.scrollY));
      return Math.abs(currentScroll - beforeReload);
    }).toBeLessThanOrEqual(12);
  });

  test('refreshing near the category stage does not auto-jump the stage under the header', async ({ page }) => {
    await page.goto('/');

    const beforeReload = await page.evaluate(() => {
      const stage = document.getElementById('homeCategories');
      const navbar = document.getElementById('navbar');
      const absoluteTop = window.scrollY + stage.getBoundingClientRect().top;
      const targetScroll = Math.max(0, absoluteTop - 260);
      window.scrollTo(0, targetScroll);
      const stageRect = stage.getBoundingClientRect();
      const navRect = navbar.getBoundingClientRect();
      return {
        scrollY: Math.round(window.scrollY),
        alignmentDelta: Math.round(Math.abs(stageRect.top - navRect.bottom)),
      };
    });

    expect(beforeReload.alignmentDelta).toBeGreaterThan(120);

    await page.reload();

    await expect.poll(async () => {
      const currentScroll = await page.evaluate(() => Math.round(window.scrollY));
      return Math.abs(currentScroll - beforeReload.scrollY);
    }).toBeLessThanOrEqual(12);

    const afterReload = await readHomepageCategoryStageMetrics(page);
    expect(afterReload.alignmentDelta).toBeGreaterThan(120);
  });

  test('navigation links are present', async ({ page }) => {
    await page.goto('/');
    const nav = page.locator('#navbar .site-nav__links');

    await expect(nav.getByRole('link', { name: 'Gallery' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Video' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Sound Lab' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Contact' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Models' })).toBeVisible();

    await expect
      .poll(() => nav.locator(':scope > *').evaluateAll((nodes) => nodes.map((node) => node.textContent.trim())))
      .toEqual(['Gallery', 'Video', 'Sound Lab', 'Contact', 'Models']);
  });

  test('cross-page header links land Gallery, Video, and Sound Lab with the same fixed-header-safe alignment', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1200 });

    await page.route(/\/api\/gallery\/mempics(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            items: Array.from({ length: 6 }, (_, index) => ({
              id: `cross-mempic-${index + 1}`,
              slug: `cross-mempic-${index + 1}`,
              title: 'Mempics',
              caption: `Published by Ada Member on 2026-04-${String(index + 10).padStart(2, '0')}.`,
              category: 'mempics',
              publisher: {
                display_name: 'Ada Member',
              },
              thumb: {
                url: `/api/gallery/mempics/cross-mempic-${index + 1}/thumb`,
                w: 320,
                h: 320,
              },
              preview: {
                url: `/api/gallery/mempics/cross-mempic-${index + 1}/medium`,
                w: 1280,
                h: 1280,
              },
              full: {
                url: `/api/gallery/mempics/cross-mempic-${index + 1}/file`,
              },
            })),
            has_more: false,
            next_cursor: null,
          },
        }),
      });
    });

    await page.route(/\/api\/gallery\/mempics\/[^/]+(?:\/[^/]+)?\/(thumb|medium|file)$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==', 'base64'),
      });
    });

    await page.route(/\/api\/gallery\/memvids(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            items: Array.from({ length: 6 }, (_, index) => ({
              id: `cross-memvid-${index + 1}`,
              slug: `cross-memvid-${index + 1}`,
              title: `Launch Cut ${index + 1}`,
              caption: `Published by Ada Member on 2026-04-${String(index + 10).padStart(2, '0')}.`,
              category: 'memvids',
              publisher: {
                display_name: 'Ada Member',
              },
              file: {
                url: `/api/gallery/memvids/cross-memvid-${index + 1}/file`,
              },
              poster: {
                url: `/api/gallery/memvids/cross-memvid-${index + 1}/poster`,
                w: 1280,
                h: 720,
              },
            })),
            has_more: false,
            next_cursor: null,
          },
        }),
      });
    });

    await page.route('**/api/gallery/memvids/**', async (route) => {
      if (route.request().url().endsWith('/avatar')) {
        await route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==', 'base64'),
        });
        return;
      }

      if (route.request().url().endsWith('/poster')) {
        await route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==', 'base64'),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'video/mp4',
        body: Buffer.from('mock-video'),
      });
    });

    const targets = [
      { label: 'Gallery', category: 'gallery' },
      { label: 'Video', category: 'video' },
      { label: 'Sound Lab', category: 'sound' },
    ];

    for (const target of targets) {
      await page.goto('/legal/imprint.html');
      await page.locator('.site-nav__links').getByRole('link', { name: target.label }).click();
      await expect.poll(() => new URL(page.url()).pathname).toBe('/');
      await waitForHomepageCategoryStage(page);
      await expectActiveHomepageCategory(page, target.category);
      await waitForHomepageCategoryAlignment(page);
    }
  });

  test('homepage category carousel defaults to Video Creations and navigates the three staged states safely', async ({ page }) => {
    await page.route(/\/api\/gallery\/mempics(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            items: [
              {
                id: 'stage-mempic',
                slug: 'stage-mempic',
                title: 'Staged Gallery Card',
                caption: 'Gallery panel content.',
                category: 'mempics',
                thumb: {
                  url: '/api/gallery/mempics/stage-mempic/thumb',
                  w: 320,
                  h: 320,
                },
                preview: {
                  url: '/api/gallery/mempics/stage-mempic/medium',
                  w: 1280,
                  h: 1280,
                },
                full: {
                  url: '/api/gallery/mempics/stage-mempic/file',
                },
              },
            ],
          },
        }),
      });
    });

    await page.route(/\/api\/gallery\/mempics\/[^/]+\/(thumb|medium|file)$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==', 'base64'),
      });
    });

    await page.route(/\/api\/gallery\/memvids(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            items: [
              {
                id: 'stage-memvid',
                slug: 'stage-memvid',
                title: 'Staged Video Card',
                caption: 'Video panel content.',
                category: 'memvids',
                file: {
                  url: '/api/gallery/memvids/stage-memvid/file',
                },
                poster: {
                  url: '/api/gallery/memvids/stage-memvid/poster',
                  w: 1280,
                  h: 720,
                },
              },
            ],
          },
        }),
      });
    });

    await page.route('**/api/gallery/memvids/**', async (route) => {
      if (route.request().url().endsWith('/avatar')) {
        await route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==', 'base64'),
        });
        return;
      }

      if (route.request().url().endsWith('/poster')) {
        await route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==', 'base64'),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'video/mp4',
        body: Buffer.from('mock-video'),
      });
    });

    await page.goto('/');

    const stage = page.locator('#homeCategories');
    const prevButton = stage.locator('[data-category-nav="prev"]');
    const nextButton = stage.locator('[data-category-nav="next"]');

    await expect(stage).toHaveAttribute('data-stage-mode', 'desktop');
    await expectActiveHomepageCategory(page, 'video');
    await waitForHomepageCategoryStage(page);
    await expectHomepageHeaderCategoryGlow(page, 'video');
    await expect(prevButton).toBeVisible();
    await expect(nextButton).toBeVisible();
    await expect(page.locator('#videoGrid .video-card').first()).toBeVisible();

    const initialStageMetrics = await readHomepageCategoryStageMetrics(page);
    [initialStageMetrics.prev, initialStageMetrics.next].forEach((arrowMetrics) => {
      expect(arrowMetrics.width).toBeGreaterThan(69);
      expect(arrowMetrics.width).toBeLessThan(72.5);
      expect(arrowMetrics.height).toBeGreaterThan(153);
      expect(arrowMetrics.height).toBeLessThan(157);
      expect(arrowMetrics.centerRatio).toBeGreaterThan(0.16);
      expect(arrowMetrics.centerRatio).toBeLessThan(0.34);
      expect(arrowMetrics.iconWidth).toBeGreaterThan(28);
      expect(arrowMetrics.iconWidth).toBeLessThan(31);
      expect(arrowMetrics.iconHeight).toBeGreaterThan(42);
      expect(arrowMetrics.iconHeight).toBeLessThan(46);
    });

    const idleSparkOpacity = await prevButton.evaluate((button) => (
      Number.parseFloat(window.getComputedStyle(button, '::after').opacity || '0')
    ));
    expect(idleSparkOpacity).toBeLessThan(0.1);

    await prevButton.hover();
    await expect.poll(async () => (
      await prevButton.evaluate((button) => Number.parseFloat(window.getComputedStyle(button, '::after').opacity || '0'))
    )).toBeGreaterThan(0.5);

    await prevButton.click();
    await page.waitForTimeout(160);

    const midTransitionMetrics = {
      ...(await readHomepageCategoryStageMetrics(page)),
      scrollY: await page.evaluate(() => Math.round(window.scrollY * 100) / 100),
    };

    expect(midTransitionMetrics.isTransitioning).toBe(true);
    expect(midTransitionMetrics.alignmentDelta).toBeLessThan(initialStageMetrics.alignmentDelta);

    await expectActiveHomepageCategory(page, 'gallery');
    await waitForHomepageCategoryStage(page);
    await waitForHomepageCategoryAlignment(page);
    await expectHomepageHeaderCategoryGlow(page, 'gallery');
    await expect(prevButton).toBeHidden();
    await expect(nextButton).toBeVisible();
    await expect(page.locator('#galleryGrid .gallery-item').filter({ hasText: 'Staged Gallery Card' })).toBeVisible();

    await nextButton.click();
    await expectActiveHomepageCategory(page, 'video');
    await waitForHomepageCategoryStage(page);
    await waitForHomepageCategoryAlignment(page);
    await expectHomepageHeaderCategoryGlow(page, 'video');
    await expect(prevButton).toBeVisible();
    await expect(nextButton).toBeVisible();

    await nextButton.click();
    await expectActiveHomepageCategory(page, 'sound');
    await waitForHomepageCategoryStage(page);
    await waitForHomepageCategoryAlignment(page);
    await expectHomepageHeaderCategoryGlow(page, 'sound');
    await expect(prevButton).toBeVisible();
    await expect(nextButton).toBeHidden();
    await expect(page.locator('#soundLabTracks .snd-card').first()).toBeVisible();

    await prevButton.click();
    await expectActiveHomepageCategory(page, 'video');
    await waitForHomepageCategoryStage(page);
    await waitForHomepageCategoryAlignment(page);
    await expectHomepageHeaderCategoryGlow(page, 'video');

    await page.locator('#navbar .site-nav__links').getByRole('link', { name: 'Gallery' }).click();
    await page.waitForTimeout(160);

    const midHeaderNavMetrics = {
      ...(await readHomepageCategoryStageMetrics(page)),
      scrollY: await page.evaluate(() => Math.round(window.scrollY * 100) / 100),
    };
    expect(midHeaderNavMetrics.isTransitioning).toBe(true);
    expect(midHeaderNavMetrics.alignmentDelta).toBeLessThanOrEqual(8);
    await expectHomepageHeaderCategoryGlow(page, 'gallery');

    await expectActiveHomepageCategory(page, 'gallery');
    await waitForHomepageCategoryStage(page);
    await waitForHomepageCategoryAlignment(page);
    await expectHomepageHeaderCategoryGlow(page, 'gallery');

    await page.locator('#navbar .site-nav__links').getByRole('link', { name: 'Video' }).click();
    await expectActiveHomepageCategory(page, 'video');
    await waitForHomepageCategoryStage(page);
    await waitForHomepageCategoryAlignment(page);
    await expectHomepageHeaderCategoryGlow(page, 'video');

    await switchHomepageCategory(page, 'sound');
    await waitForHomepageCategoryAlignment(page);
    await expectHomepageHeaderCategoryGlow(page, 'sound');

    await switchHomepageCategory(page, 'video');
    await waitForHomepageCategoryAlignment(page);
    await expectHomepageHeaderCategoryGlow(page, 'video');
  });

  test('mobile homepage categories remain stacked in document flow with no desktop carousel controls', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    const stage = page.locator('#homeCategories');
    await expect(stage).toHaveAttribute('data-stage-mode', 'stacked');
    await expect(stage).not.toHaveClass(/is-ready/);
    await expect(stage.locator('[data-category-nav="prev"]')).toBeHidden();
    await expect(stage.locator('[data-category-nav="next"]')).toBeHidden();

    const layout = await page.evaluate(() => {
      return ['#gallery', '#video-creations', '#soundlab'].map((selector) => {
        const element = document.querySelector(selector);
        const rect = element.getBoundingClientRect();
        const styles = window.getComputedStyle(element);
        return {
          id: element.id,
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
          display: styles.display,
          position: styles.position,
        };
      });
    });

    expect(layout.map((entry) => entry.id)).toEqual(['gallery', 'video-creations', 'soundlab']);
    expect(layout.every((entry) => entry.display !== 'none')).toBe(true);
    expect(layout.every((entry) => entry.position !== 'absolute')).toBe(true);
    expect(layout[0].bottom).toBeLessThanOrEqual(layout[1].top);
    expect(layout[1].bottom).toBeLessThanOrEqual(layout[2].top);
  });

  test('iPad-class touch devices remain stacked with no desktop carousel controls', async ({ browser }) => {
    const context = await browser.newContext({
      ...devices['iPad Pro 11 landscape'],
    });
    const tabletPage = await context.newPage();

    try {
      await tabletPage.goto('/');

      const stage = tabletPage.locator('#homeCategories');
      await expect(stage).toHaveAttribute('data-stage-mode', 'stacked');
      await expect(stage).not.toHaveClass(/is-ready/);
      await expect(stage.locator('[data-category-nav="prev"]')).toBeHidden();
      await expect(stage.locator('[data-category-nav="next"]')).toBeHidden();

      const layout = await tabletPage.evaluate(() => {
        return ['#gallery', '#video-creations', '#soundlab'].map((selector) => {
          const element = document.querySelector(selector);
          const rect = element.getBoundingClientRect();
          const styles = window.getComputedStyle(element);
          return {
            id: element.id,
            top: Math.round(rect.top),
            bottom: Math.round(rect.bottom),
            display: styles.display,
            position: styles.position,
          };
        });
      });

      expect(layout.map((entry) => entry.id)).toEqual(['gallery', 'video-creations', 'soundlab']);
      expect(layout.every((entry) => entry.display !== 'none')).toBe(true);
      expect(layout.every((entry) => entry.position !== 'absolute')).toBe(true);
      expect(layout[0].bottom).toBeLessThanOrEqual(layout[1].top);
      expect(layout[1].bottom).toBeLessThanOrEqual(layout[2].top);
    } finally {
      await context.close();
    }
  });

  test('MODELS opens the homepage models overlay from the top navigation without navigation', async ({ page }) => {
    await page.goto('/');

    const modelsButton = page.locator('#navbar .site-nav__links').getByRole('button', { name: 'Models' });
    await modelsButton.click();

    await expectPathUnchanged(page, '/');
    await expectModelsOverlayOpenState(page);

    await page.getByRole('button', { name: 'Close models' }).click();
    await expect(page.locator('.models-overlay')).not.toHaveClass(/is-active/);
    await expectPathUnchanged(page, '/');
  });

  test('MODELS opens the homepage models overlay from the mobile navigation without navigation', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    await page.getByRole('button', { name: 'Toggle menu' }).click();
    const mobileExplore = page.locator('#mobileNav .mobile-nav__section[aria-label="Explore"]');
    await expect(mobileExplore.getByRole('link', { name: 'Video' })).toBeVisible();
    await expect
      .poll(() => mobileExplore.locator(':scope > .mobile-nav__link').evaluateAll((nodes) => nodes.map((node) => node.textContent.trim())))
      .toEqual(['Gallery', 'Video', 'Sound Lab', 'Models']);

    const modelsButton = page.locator('#mobileNav').getByRole('button', { name: 'Models' });
    await modelsButton.click();

    await expectPathUnchanged(page, '/');
    await expectModelsOverlayOpenState(page);
  });

  test('mobile guest banner appears only for logged-out visitors and keeps the menu CTA behavior', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ loggedIn: false, user: null }),
      });
    });

    await page.goto('/');

    const banner = page.locator('#mobileGuestBanner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Create your BITBI account for free');
    await expect(page.locator('#mobileMenuBtn')).toBeVisible();

    await banner.click();
    await expect(page.locator('#mobileNav')).toHaveClass(/open/);

    await page.locator('#mobileNavClose').click();
    await page.locator('#mobileMenuBtn').click();
    await expect(page.locator('#mobileNav')).toHaveClass(/open/);
  });

  test('mobile guest banner stays hidden for logged-in users', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          loggedIn: true,
          user: {
            id: 'member-banner-user',
            email: 'member@bitbi.ai',
            role: 'user',
          },
        }),
      });
    });

    await page.goto('/');
    await expect(page.locator('#mobileGuestBanner')).toHaveCount(0);
  });

  test('desktop guest banner appears for logged-out visitors and opens the auth modal', async ({ page }) => {
    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ loggedIn: false, user: null }),
      });
    });

    await page.goto('/');
    const banner = page.locator('#mobileGuestBanner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Create your BITBI account for free');
    await expect(banner).toContainText('Sign in or register to start creating');
    await expect(page.locator('#authModal .auth-modal__overlay')).toHaveCount(1);

    await banner.click();
    await expect(page.locator('.auth-modal__overlay.active')).toBeVisible();
    await expect(page.locator('.auth-modal__tab.active')).toHaveText('Create Account');
    await expect(page.locator('#mobileNav')).not.toHaveClass(/open/);
  });

  test('desktop guest banner stays hidden for logged-in users', async ({ page }) => {
    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          loggedIn: true,
          user: {
            id: 'desktop-banner-user',
            email: 'desktop@bitbi.ai',
            role: 'user',
          },
        }),
      });
    });

    await page.goto('/');
    await expect(page.locator('#mobileGuestBanner')).toHaveCount(0);
  });

  test('hero section renders', async ({ page }) => {
    await page.goto('/');
    const hero = page.locator('#hero');
    const heroVideo = hero.locator('[data-hero-video]');
    const teaser = hero.locator('.hero__lab-teaser');

    await expect(hero).toBeVisible();
    await expect(heroVideo).toBeVisible();
    await expect(heroVideo).not.toHaveAttribute('controls', /./);
    await expect(heroVideo).not.toHaveAttribute('poster', /./);
    await expect
      .poll(() => heroVideo.evaluate((el) => el.classList.contains('is-active')))
      .toBe(true);
    await expect(hero.getByText('My Digital Playground')).toHaveCount(0);
    await expect(teaser).toBeVisible();
    await expect(teaser).toContainText('Generate Lab');
    await expect(teaser).toContainText('Coming Soon');
    await expect(hero.locator('.hero__lab-teaser-icon')).toHaveText('⚗️');
    await expect(hero.getByRole('link', { name: /Generate Lab/i })).toHaveCount(0);

    const teaserMetrics = await page.evaluate(() => {
      const teaserEl = document.querySelector('.hero__lab-teaser');
      const submitEl = document.querySelector('#contactForm button[type="submit"]');
      const teaserStyle = teaserEl ? window.getComputedStyle(teaserEl) : null;
      const submitStyle = submitEl ? window.getComputedStyle(submitEl) : null;
      return {
        teaserFontSize: teaserStyle ? parseFloat(teaserStyle.fontSize) : 0,
        baselineFontSize: submitStyle ? parseFloat(submitStyle.fontSize) : 0,
        pointerEvents: teaserStyle?.pointerEvents || '',
      };
    });

    expect(teaserMetrics.baselineFontSize).toBeGreaterThan(0);
    expect(Math.round((teaserMetrics.teaserFontSize / teaserMetrics.baselineFontSize) * 100)).toBe(110);
    expect(teaserMetrics.pointerEvents).toBe('none');
  });

  test('hero falls back cleanly in reduced motion mode', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');

    const hero = page.locator('#hero');
    const heroVideo = hero.locator('[data-hero-video]');
    const teaser = hero.locator('.hero__lab-teaser');

    await expect(hero).toBeVisible();
    await expect(heroVideo).toBeHidden();
    await expect(teaser).toBeVisible();
    await expect(teaser).toContainText('Generate Lab');
    await expect(teaser).toContainText('Coming Soon');
    await expect(hero.getByRole('link', { name: /Generate Lab/i })).toHaveCount(0);
  });

  test('hero uses the mobile background video asset on narrow viewports', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    await expect
      .poll(() => page.locator('[data-hero-video]').evaluate((el) => el.currentSrc))
      .toContain('/assets/images/hero/hero-flow-mobile.mp4');
  });

  test('Contact nav aligns the contact divider flush with the header', async ({ page }) => {
    await page.goto('/');

    await page.locator('#navbar .site-nav__links').getByRole('link', { name: 'Contact' }).click();

    await expect(page.locator('#contactDrawerTrigger')).toBeInViewport();
    await expect.poll(async () => {
      const metrics = await page.evaluate(() => {
        const navEl = document.getElementById('navbar');
        const contactEl = document.getElementById('contact');
        const targetEl = contactEl?.previousElementSibling?.classList.contains('section-divider')
          ? contactEl.previousElementSibling
          : contactEl;
        if (!navEl || !targetEl) return null;
        return Math.abs(targetEl.getBoundingClientRect().top - navEl.getBoundingClientRect().bottom);
      });
      return metrics === null ? null : Math.round(metrics * 100) / 100;
    }).toBeLessThanOrEqual(2);
  });

  test('contact drawer is collapsed by default on desktop and preserves submit behavior when expanded', async ({ page }) => {
    let contactPayload = null;

    await page.route('https://contact.bitbi.ai/', async (route) => {
      contactPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.goto('/');

    const trigger = page.locator('#contactDrawerTrigger');
    const panel = page.locator('#contactDrawerPanel');
    const form = page.locator('#contactForm');
    const submit = form.locator('button[type="submit"]');
    const panelTitle = page.locator('#contactDrawerPanel .contact-drawer__panel-title');

    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toHaveAttribute('aria-hidden', 'true');
    await expect(trigger).toContainText('Contact');
    await expect(trigger).not.toContainText('Say Hello');
    await expect(page.getByText('Open the drawer to collaborate, ask a question, or send a note.')).toHaveCount(0);

    const collapsedState = await page.evaluate(() => {
      const panelEl = document.getElementById('contactDrawerPanel');
      const panelInner = panelEl?.querySelector('.contact-drawer__panel-inner');
      const drawerEl = document.querySelector('.contact-drawer');
      const triggerEl = document.getElementById('contactDrawerTrigger');
      const exploreBtnEl = document.querySelector('#video-creations .video-mode__btn--explore');
      const drawerRect = drawerEl?.getBoundingClientRect();
      const triggerRect = triggerEl?.getBoundingClientRect();
      const exploreBtnRect = exploreBtnEl?.getBoundingClientRect();
      return {
        panelHeight: Math.round((panelEl?.getBoundingClientRect().height || 0) * 100) / 100,
        inert: panelInner?.hasAttribute('inert') || false,
        triggerHeight: Math.round((triggerRect?.height || 0) * 100) / 100,
        exploreBtnHeight: Math.round((exploreBtnRect?.height || 0) * 100) / 100,
        triggerWidthRatio: Math.round((((triggerRect?.width || 0) / (drawerRect?.width || 1)) * 100)) / 100,
        triggerCenterOffset: Math.round(Math.abs(
          ((triggerRect?.left || 0) + ((triggerRect?.width || 0) / 2))
          - ((drawerRect?.left || 0) + ((drawerRect?.width || 0) / 2))
        ) * 100) / 100,
      };
    });

    expect(collapsedState.panelHeight).toBeLessThanOrEqual(2);
    expect(collapsedState.inert).toBe(true);
    expect(collapsedState.triggerHeight).toBeLessThanOrEqual(90);
    expect(Math.abs(collapsedState.triggerHeight - collapsedState.exploreBtnHeight)).toBeLessThanOrEqual(8);
    expect(collapsedState.triggerWidthRatio).toBeLessThan(0.8);
    expect(collapsedState.triggerCenterOffset).toBeLessThanOrEqual(4);

    await trigger.click();

    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toHaveAttribute('aria-hidden', 'false');
    await expect(panelTitle).toHaveText('Say Hello');
    await expect(panelTitle).toBeVisible();
    await expect(form).toBeVisible();
    await expect(form.locator('input[name="name"]')).toBeVisible();
    await expect(form.locator('input[name="email"]')).toBeVisible();
    await expect(form.locator('textarea[name="message"]')).toBeVisible();
    await expect(submit).toBeVisible();

    await form.locator('input[name="name"]').fill('Ada Lovelace');
    await form.locator('input[name="email"]').fill('ada@bitbi.ai');
    await form.locator('input[name="subject"]').fill('Drawer contact test');
    await form.locator('textarea[name="message"]').fill('This verifies the homepage contact drawer keeps the submit flow intact.');
    await submit.click();

    await expect.poll(() => contactPayload).toEqual({
      name: 'Ada Lovelace',
      email: 'ada@bitbi.ai',
      subject: 'Drawer contact test',
      message: 'This verifies the homepage contact drawer keeps the submit flow intact.',
      website: '',
    });
    await expect(submit).toHaveText('Sent!');

    await trigger.click();

    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toHaveAttribute('aria-hidden', 'true');

    await expect.poll(async () => {
      const recollapsedState = await page.evaluate(() => {
        const panelEl = document.getElementById('contactDrawerPanel');
        const panelInner = panelEl?.querySelector('.contact-drawer__panel-inner');
        return {
          panelHeight: Math.round((panelEl?.getBoundingClientRect().height || 0) * 100) / 100,
          inert: panelInner?.hasAttribute('inert') || false,
        };
      });
      expect(recollapsedState.inert).toBe(true);
      return recollapsedState.panelHeight;
    }).toBeLessThanOrEqual(2);
  });

  test('contact drawer stays collapsed by default on mobile and toggles open cleanly', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    const trigger = page.locator('#contactDrawerTrigger');
    const panel = page.locator('#contactDrawerPanel');
    const form = page.locator('#contactForm');
    const panelTitle = page.locator('#contactDrawerPanel .contact-drawer__panel-title');

    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toHaveAttribute('aria-hidden', 'true');
    await expect(trigger).toContainText('Contact');
    await expect(trigger).not.toContainText('Say Hello');
    await expect(page.getByText('Open the drawer to collaborate, ask a question, or send a note.')).toHaveCount(0);

    const mobileCollapsedState = await page.evaluate(() => {
      const panelEl = document.getElementById('contactDrawerPanel');
      const drawerEl = document.querySelector('.contact-drawer');
      const triggerEl = document.getElementById('contactDrawerTrigger');
      const exploreBtnEl = document.querySelector('#video-creations .video-mode__btn--explore');
      const drawerRect = drawerEl?.getBoundingClientRect();
      const triggerRect = triggerEl?.getBoundingClientRect();
      const exploreBtnRect = exploreBtnEl?.getBoundingClientRect();
      return {
        panelHeight: Math.round((panelEl?.getBoundingClientRect().height || 0) * 100) / 100,
        triggerHeight: Math.round((triggerRect?.height || 0) * 100) / 100,
        exploreBtnHeight: Math.round((exploreBtnRect?.height || 0) * 100) / 100,
        triggerCenterOffset: Math.round(Math.abs(
          ((triggerRect?.left || 0) + ((triggerRect?.width || 0) / 2))
          - ((drawerRect?.left || 0) + ((drawerRect?.width || 0) / 2))
        ) * 100) / 100,
      };
    });
    expect(mobileCollapsedState.panelHeight).toBeLessThanOrEqual(2);
    expect(mobileCollapsedState.triggerHeight).toBeLessThanOrEqual(84);
    expect(Math.abs(mobileCollapsedState.triggerHeight - mobileCollapsedState.exploreBtnHeight)).toBeLessThanOrEqual(8);
    expect(mobileCollapsedState.triggerCenterOffset).toBeLessThanOrEqual(4);

    await trigger.click();

    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toHaveAttribute('aria-hidden', 'false');
    await expect(panelTitle).toHaveText('Say Hello');
    await expect(panelTitle).toBeVisible();
    await expect(form).toBeVisible();
    await expect(form.locator('input[name="name"]')).toBeVisible();
    await expect(form.locator('input[name="email"]')).toBeVisible();
    await expect(form.locator('textarea[name="message"]')).toBeVisible();

    await trigger.click();

    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toHaveAttribute('aria-hidden', 'true');
  });

  test('homepage section spacing compacts on desktop only and adds mobile divider accents', async ({ browser }) => {
    const desktopContext = await browser.newContext();
    const mobileContext = await browser.newContext({ ...devices['iPhone 12'] });

    try {
      const desktopPage = await desktopContext.newPage();
      await desktopPage.goto('/');

      const desktopMetrics = await desktopPage.evaluate(() => {
        const section = document.querySelector('#video-creations');
        const header = section?.querySelector('.section__header--sm');
        const before = section ? window.getComputedStyle(section, '::before') : null;
        const sectionRect = section?.getBoundingClientRect();
        const sectionStyle = section ? window.getComputedStyle(section) : null;
        const headerStyle = header ? window.getComputedStyle(header) : null;
        return {
          sectionPaddingTop: sectionStyle ? parseFloat(sectionStyle.paddingTop) : 0,
          headerMarginBottom: headerStyle ? parseFloat(headerStyle.marginBottom) : 0,
          dividerVisible: Boolean(before && before.content !== 'none' && parseFloat(before.width) > 0.5),
          dividerWidth: before ? parseFloat(before.width) : 0,
          sectionWidth: sectionRect?.width || 0,
        };
      });

      expect(desktopMetrics.sectionPaddingTop).toBeGreaterThan(30);
      expect(desktopMetrics.sectionPaddingTop).toBeLessThan(35);
      expect(desktopMetrics.headerMarginBottom).toBeGreaterThan(37);
      expect(desktopMetrics.headerMarginBottom).toBeLessThan(40);
      expect(desktopMetrics.dividerVisible).toBe(false);

      const mobilePage = await mobileContext.newPage();
      await mobilePage.goto('/');

      const mobileMetrics = await mobilePage.evaluate(() => {
        const section = document.querySelector('#video-creations');
        const header = section?.querySelector('.section__header--sm');
        const before = section ? window.getComputedStyle(section, '::before') : null;
        const sectionRect = section?.getBoundingClientRect();
        const sectionStyle = section ? window.getComputedStyle(section) : null;
        const headerStyle = header ? window.getComputedStyle(header) : null;
        return {
          sectionPaddingTop: sectionStyle ? parseFloat(sectionStyle.paddingTop) : 0,
          headerMarginBottom: headerStyle ? parseFloat(headerStyle.marginBottom) : 0,
          dividerVisible: Boolean(before && before.content !== 'none' && parseFloat(before.width) > 0.5),
          dividerWidth: before ? parseFloat(before.width) : 0,
          sectionWidth: sectionRect?.width || 0,
        };
      });

      expect(mobileMetrics.sectionPaddingTop).toBe(48);
      expect(mobileMetrics.headerMarginBottom).toBe(48);
      expect(mobileMetrics.dividerVisible).toBe(true);
      expect(mobileMetrics.dividerWidth).toBeLessThan(mobileMetrics.sectionWidth * 0.7);
    } finally {
      await Promise.all([
        desktopContext.close(),
        mobileContext.close(),
      ]);
    }
  });

  test('gallery has Explore/Create mode toggle', async ({ page }) => {
    await page.goto('/');
    await switchHomepageCategory(page, 'gallery');
    const modeBar = page.locator('.gallery-mode');
    await expect(modeBar).toBeAttached();
    await expect(modeBar.getByRole('tab', { name: 'Explore' })).toBeVisible();
    await expect(modeBar.getByRole('tab', { name: /Create/ })).toBeVisible();
    await expect(page.locator('#galleryExplore')).toBeVisible();
    await expect(page.locator('#galleryStudio')).toBeHidden();
    await expect(page.locator('.filter-btn[data-filter="experimental"]')).toHaveCount(0);
  });

  test('homepage removes the AI Art, AI Video, and Audio labels without leaving header gaps', async ({ page }) => {
    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ loggedIn: false, user: null }),
      });
    });

    await page.route('**/api/favorites', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, favorites: [] }),
      });
    });

    await page.route(/\/api\/gallery\/mempics(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            items: [
              {
                id: 'header-check-mempic',
                slug: 'header-check-mempic',
                title: 'Mempics',
                caption: 'Published by Ada Member on 2026-04-12.',
                category: 'mempics',
                thumb: {
                  url: '/api/gallery/mempics/header-check-mempic/thumb',
                  w: 320,
                  h: 320,
                },
                preview: {
                  url: '/api/gallery/mempics/header-check-mempic/medium',
                  w: 1280,
                  h: 1280,
                },
                full: {
                  url: '/api/gallery/mempics/header-check-mempic/file',
                },
              },
            ],
          },
        }),
      });
    });

    await page.route(/\/api\/gallery\/mempics\/[^/]+\/(thumb|medium|file)$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==', 'base64'),
      });
    });

    await page.route(/\/api\/gallery\/memvids(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            items: [
              {
                id: 'header-check-memvid',
                slug: 'header-check-memvid',
                title: 'Launch Walkthrough',
                caption: 'Published by Ada Member on 2026-04-14.',
                category: 'memvids',
                file: {
                  url: '/api/gallery/memvids/header-check-memvid/file',
                },
                poster: {
                  url: '/api/gallery/memvids/header-check-memvid/poster',
                  w: 1280,
                  h: 720,
                },
              },
            ],
          },
        }),
      });
    });

    await page.route('**/api/gallery/memvids/**', async (route) => {
      if (route.request().url().endsWith('/avatar')) {
        await route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==', 'base64'),
        });
        return;
      }

      if (route.request().url().endsWith('/poster')) {
        await route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==', 'base64'),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'video/mp4',
        body: Buffer.from('mock-video'),
      });
    });

    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto('/');

    await expect(page.locator('#gallery .section__label')).toHaveCount(0);
    await expect(page.locator('#video-creations .section__label')).toHaveCount(0);
    await expect(page.locator('#soundlab .section__label')).toHaveCount(0);

    await expectActiveHomepageCategory(page, 'video');
    await expect(page.locator('#videoGrid .video-card').first()).toBeVisible();
    await switchHomepageCategory(page, 'gallery');
    await expect(page.locator('#galleryGrid .gallery-item:not(.locked-area)').first()).toBeVisible();
    await switchHomepageCategory(page, 'sound');
    await expect(page.locator('#soundLabTracks .snd-card').first()).toBeVisible();

    const desktopHeaderLayout = await page.evaluate(() => (
      ['#gallery', '#video-creations', '#soundlab'].map((selector) => {
        const headerInner = document.querySelector(`${selector} .section__header--sm > div`);
        const title = document.querySelector(`${selector} .section__title`);
        const style = window.getComputedStyle(title);
        return {
          selector,
          marginTop: style.marginTop,
          titleOffset: Math.round((title.getBoundingClientRect().top - headerInner.getBoundingClientRect().top) * 100) / 100,
        };
      })
    ));

    desktopHeaderLayout.forEach(({ marginTop, titleOffset }) => {
      expect(marginTop).toBe('0px');
      expect(titleOffset).toBeLessThanOrEqual(1);
    });

    await page.setViewportSize({ width: 390, height: 844 });

    await expect(page.locator('#gallery .section__label')).toHaveCount(0);
    await expect(page.locator('#video-creations .section__label')).toHaveCount(0);
    await expect(page.locator('#soundlab .section__label')).toHaveCount(0);
    await expectActiveHomepageCategory(page, 'sound');
    await switchHomepageCategory(page, 'gallery');
    await expect(page.locator('#galleryGrid .gallery-item:not(.locked-area)').first()).toBeVisible();
    await switchHomepageCategory(page, 'video');
    await expect(page.locator('#videoGrid .video-card').first()).toBeVisible();
    await switchHomepageCategory(page, 'sound');
    await expect(page.locator('#soundLabTracks .snd-card').first()).toBeVisible();
  });

  test('gallery Explore renders public Mempics without regressing the existing Free gallery filters', async ({ page }) => {
    const mempicVersion = 'vpubmempic';
    const avatarVersion = 'avpubmempic';
    await page.route(/\/api\/gallery\/mempics(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            items: [
              {
                id: 'a1b2c3d4',
                slug: 'mempic-a1b2c3d4',
                title: 'Mempics',
                caption: 'Published by Ada Member on 2026-04-12.',
                category: 'mempics',
                publisher: {
                  display_name: 'Ada Member',
                  avatar: {
                    url: `/api/gallery/mempics/a1b2c3d4/${avatarVersion}/avatar`,
                  },
                },
                thumb: {
                  url: `/api/gallery/mempics/a1b2c3d4/${mempicVersion}/thumb`,
                  w: 320,
                  h: 320,
                },
                preview: {
                  url: `/api/gallery/mempics/a1b2c3d4/${mempicVersion}/medium`,
                  w: 1280,
                  h: 1280,
                },
                full: {
                  url: `/api/gallery/mempics/a1b2c3d4/${mempicVersion}/file`,
                },
              },
            ],
          },
        }),
      });
    });

    await page.route(/\/api\/gallery\/mempics\/[^/]+\/[^/]+\/avatar$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==', 'base64'),
      });
    });

    await page.route(/\/api\/gallery\/mempics\/[^/]+(?:\/[^/]+)?\/(thumb|medium|file)$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==', 'base64'),
      });
    });

    await page.goto('/');
    await switchHomepageCategory(page, 'gallery');

    const mempicsBtn = page.locator('.filter-btn[data-filter="mempics"]');
    await expect(mempicsBtn).toBeVisible();
    await mempicsBtn.click();

    const mempicsCard = page.locator('#galleryGrid .gallery-item:not(.locked-area):visible').first();
    await expect(mempicsCard).toBeVisible();
    await mempicsCard.hover();
    await expect(mempicsCard.locator('.public-media-meta__title')).toHaveText('Ada Member');
    await expect(mempicsCard.locator('.public-media-meta__avatar')).toBeVisible();

    await mempicsCard.click();
    await expect(page.locator('#modalTitle')).toHaveText('Mempics');
    await expect(page.locator('#modalCaption')).toHaveText('Published by Ada Member on 2026-04-12.');
    await expect(page.locator('#modalFullLink')).toHaveAttribute('href', `/api/gallery/mempics/a1b2c3d4/${mempicVersion}/file`);
    await page.locator('.modal-close').click();

    await page.locator('.filter-btn[data-filter="mempics"]').click();
  });

  test('published Memvid cards show the sharer display name and avatar instead of generic category copy', async ({ page }) => {
    await page.route(/\/api\/gallery\/memvids(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            items: [
              {
                id: 'bada55e1',
                slug: 'memvid-bada55e1',
                title: 'Memvids',
                caption: 'Published by Ada Member on 2026-04-14.',
                category: 'memvids',
                publisher: {
                  display_name: 'Ada Member',
                  avatar: {
                    url: '/api/gallery/memvids/bada55e1/avpubmemvid/avatar',
                  },
                },
                file: {
                  url: '/api/gallery/memvids/bada55e1/file',
                },
                poster: {
                  url: '/api/gallery/memvids/bada55e1/poster',
                  w: 1280,
                  h: 720,
                },
              },
            ],
          },
        }),
      });
    });

    await page.route(/\/api\/gallery\/memvids\/[^/]+\/[^/]+\/avatar$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==', 'base64'),
      });
    });

    await page.route('**/api/gallery/memvids/**', async (route) => {
      if (route.request().url().endsWith('/avatar')) {
        await route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==', 'base64'),
        });
        return;
      }

      if (route.request().url().endsWith('/poster')) {
        await route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==', 'base64'),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'video/mp4',
        body: Buffer.from('mock-video'),
      });
    });

    await page.goto('/');
    await switchHomepageCategory(page, 'video');

    const videoCard = page.locator('#videoGrid .video-card').first();
    await expect(videoCard.locator('.video-card__title')).toHaveText('Ada Member');
    await expect(videoCard.locator('.public-media-meta__avatar')).toBeVisible();
    await expect(videoCard.locator('.video-card__caption')).toHaveText('Published by Ada Member on 2026-04-14.');
  });

  test('desktop published Mempics and Memvids start at five items and expand downward on demand without changing mobile behavior', async ({ page }) => {
    const mempicItems = Array.from({ length: 8 }, (_, index) => ({
      id: `mempic-${index + 1}`,
      slug: `mempic-${index + 1}`,
      title: 'Mempics',
      caption: `Published by Ada Member on 2026-04-${String(index + 10).padStart(2, '0')}.`,
      category: 'mempics',
      publisher: {
        display_name: 'Ada Member',
      },
      thumb: {
        url: `/api/gallery/mempics/mempic-${index + 1}/thumb`,
        w: 320,
        h: 320,
      },
      preview: {
        url: `/api/gallery/mempics/mempic-${index + 1}/medium`,
        w: 1280,
        h: 1280,
      },
      full: {
        url: `/api/gallery/mempics/mempic-${index + 1}/file`,
      },
    }));

    const memvidItems = Array.from({ length: 7 }, (_, index) => ({
      id: `memvid-${index + 1}`,
      slug: `memvid-${index + 1}`,
      title: `Launch Cut ${index + 1}`,
      caption: `Published by Ada Member on 2026-04-${String(index + 10).padStart(2, '0')}.`,
      category: 'memvids',
      publisher: {
        display_name: 'Ada Member',
      },
      file: {
        url: `/api/gallery/memvids/memvid-${index + 1}/file`,
      },
      poster: {
        url: `/api/gallery/memvids/memvid-${index + 1}/poster`,
        w: 1280,
        h: 720,
      },
    }));

    await page.route(/\/api\/gallery\/mempics(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            items: mempicItems,
            has_more: false,
            next_cursor: null,
          },
        }),
      });
    });

    await page.route(/\/api\/gallery\/mempics\/[^/]+\/(thumb|medium|file)$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==', 'base64'),
      });
    });

    await page.route(/\/api\/gallery\/memvids(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            items: memvidItems,
            has_more: false,
            next_cursor: null,
          },
        }),
      });
    });

    await page.route('**/api/gallery/memvids/**', async (route) => {
      if (route.request().url().endsWith('/avatar')) {
        await route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==', 'base64'),
        });
        return;
      }

      if (route.request().url().endsWith('/poster')) {
        await route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==', 'base64'),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'video/mp4',
        body: Buffer.from('mock-video'),
      });
    });

    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto('/');
    await switchHomepageCategory(page, 'gallery');

    await expect(page.locator('#galleryPagination .browse-pagination__status')).toHaveText('Showing all 5 Mempics');
    await expect(page.locator('#galleryPagination .browse-pagination__btn')).toBeHidden();
    await expect.poll(() => page.locator('#galleryGrid .gallery-item:visible').count()).toBe(5);

    const galleryToggle = page.locator('#galleryPagination .browse-pagination__toggle');
    await expect(galleryToggle).toHaveAttribute('aria-expanded', 'false');
    await galleryToggle.click();
    await expect(galleryToggle).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(() => page.locator('#galleryGrid .gallery-item:visible').count()).toBe(8);
    await expect(page.locator('#galleryPagination .browse-pagination__status')).toHaveText('Showing all 8 Mempics.');
    await expect(page.locator('#galleryPagination .browse-pagination__btn')).toBeHidden();

    await switchHomepageCategory(page, 'video');
    await expect(page.locator('#videoPagination .browse-pagination__status')).toHaveText('Showing all 5 Memvids');
    await expect(page.locator('#videoPagination .browse-pagination__btn')).toBeHidden();
    await expect.poll(() => page.locator('#videoGrid .video-card:visible').count()).toBe(5);

    const videoToggle = page.locator('#videoPagination .browse-pagination__toggle');
    await expect(videoToggle).toHaveAttribute('aria-expanded', 'false');
    await videoToggle.click();
    await expect(videoToggle).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(() => page.locator('#videoGrid .video-card:visible').count()).toBe(7);
    await expect(page.locator('#videoPagination .browse-pagination__status')).toHaveText('Showing all 7 Memvids.');
    await expect(page.locator('#videoPagination .browse-pagination__btn')).toBeHidden();

    await page.setViewportSize({ width: 390, height: 844 });
    await switchHomepageCategory(page, 'gallery');
    await expect(page.locator('#galleryPagination .browse-pagination__toggle')).toBeHidden();
  });

  test('homepage Gallery fits five cards across on wide desktop while preserving the mobile layout', async ({ page }) => {
    const items = Array.from({ length: 5 }, (_, index) => {
      const id = `mempic-${index + 1}`;
      return {
        id,
        slug: id,
        title: `Mempics ${index + 1}`,
        caption: `Published by Ada Member on 2026-04-${String(index + 10).padStart(2, '0')}.`,
        category: 'mempics',
        thumb: {
          url: `/api/gallery/mempics/${id}/thumb`,
          w: 320,
          h: 320,
        },
        preview: {
          url: `/api/gallery/mempics/${id}/medium`,
          w: 1280,
          h: 1280,
        },
        full: {
          url: `/api/gallery/mempics/${id}/file`,
        },
      };
    });

    await page.route(/\/api\/gallery\/mempics(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: { items },
        }),
      });
    });

    await page.route(/\/api\/gallery\/mempics\/[^/]+\/(thumb|medium|file)$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==', 'base64'),
      });
    });

    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto('/');
    await switchHomepageCategory(page, 'gallery');

    const galleryCards = page.locator('#galleryGrid .gallery-item:not(.locked-area)');
    await expect(galleryCards).toHaveCount(5);
    await expect(galleryCards.first()).toBeVisible();

    const wideLayout = await page.evaluate(() => {
      const grid = document.getElementById('galleryGrid');
      const style = window.getComputedStyle(grid);
      return {
        columns: style.gridTemplateColumns.split(' ').filter(Boolean).length,
        overflow: grid.scrollWidth - grid.clientWidth,
      };
    });

    expect(wideLayout.columns).toBe(5);
    expect(wideLayout.overflow).toBeLessThanOrEqual(2);

    await page.setViewportSize({ width: 390, height: 844 });

    const mobileLayout = await page.evaluate(() => {
      const grid = document.getElementById('galleryGrid');
      const style = window.getComputedStyle(grid);
      return style.gridTemplateColumns.split(' ').filter(Boolean).length;
    });

    expect(mobileLayout).toBe(1);
  });

  test('homepage favorites reuse the shared flow for Mempics cards and video modal cards', async ({ page }) => {
    const favoriteRequests = [];
    const memvidVersion = 'vpubmemvid';

    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          loggedIn: true,
          user: {
            id: 'favorites-home-user',
            email: 'favorites@bitbi.ai',
            role: 'user',
          },
        }),
      });
    });

    await page.route('**/api/favorites', async (route) => {
      const method = route.request().method();
      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, favorites: [] }),
        });
        return;
      }

      favoriteRequests.push({
        method,
        body: route.request().postDataJSON(),
      });

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.route(/\/api\/gallery\/mempics(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            items: [
              {
                id: 'a1b2c3d4',
                slug: 'mempic-a1b2c3d4',
                title: 'Mempics',
                caption: 'Published by Ada Member on 2026-04-12.',
                category: 'mempics',
                thumb: {
                  url: '/api/gallery/mempics/a1b2c3d4/thumb',
                  w: 320,
                  h: 320,
                },
                preview: {
                  url: '/api/gallery/mempics/a1b2c3d4/medium',
                  w: 1280,
                  h: 1280,
                },
                full: {
                  url: '/api/gallery/mempics/a1b2c3d4/file',
                },
              },
            ],
          },
        }),
      });
    });

    await page.route(/\/api\/gallery\/mempics\/[^/]+\/(thumb|medium|file)$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==', 'base64'),
      });
    });

    await page.route(/\/api\/gallery\/memvids(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            items: [
              {
                id: 'bada55e1',
                slug: 'memvid-bada55e1',
                title: 'Launch Walkthrough',
                caption: 'Published by Ada Member on 2026-04-14.',
                category: 'memvids',
                file: {
                  url: '/api/gallery/memvids/bada55e1/file',
                },
                poster: {
                  url: '/api/gallery/memvids/bada55e1/poster',
                  w: 1280,
                  h: 720,
                },
              },
            ],
          },
        }),
      });
    });

    await page.route('**/api/gallery/memvids/**', async (route) => {
      if (route.request().url().endsWith('/avatar')) {
        await route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==', 'base64'),
        });
        return;
      }

      if (route.request().url().endsWith('/poster')) {
        await route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==', 'base64'),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'video/mp4',
        body: Buffer.from('mock-video'),
      });
    });

    await page.goto('/');
    await switchHomepageCategory(page, 'gallery');
    await expect(page.locator('#videoGrid')).not.toHaveClass(/vid-deck/);

    const mempicStar = page.locator('#galleryGrid .gallery-item .fav-star').first();
    await expect(mempicStar).toBeVisible();
    await mempicStar.click();
    await expect(mempicStar).toHaveAttribute('aria-pressed', 'true');
    expect(favoriteRequests.at(-1)).toEqual({
      method: 'POST',
      body: {
        item_type: 'mempics',
        item_id: 'a1b2c3d4',
        title: 'Mempics',
        thumb_url: '/api/gallery/mempics/a1b2c3d4/thumb',
      },
    });

    await mempicStar.click();
    await expect(mempicStar).toHaveAttribute('aria-pressed', 'false');
    expect(favoriteRequests.at(-1)).toEqual({
      method: 'DELETE',
      body: {
        item_type: 'mempics',
        item_id: 'a1b2c3d4',
      },
    });

    await switchHomepageCategory(page, 'video');

    const videoCard = page.locator('#videoGrid .video-card').first();
    const videoCardStar = videoCard.locator('.fav-star');
    await expect(videoCardStar).toBeVisible();

    await videoCard.click();
    const videoModalStar = page.locator('#videoModal .video-modal__fav');
    await expect(videoModalStar).toBeVisible();
    await videoModalStar.click();

    expect(favoriteRequests.at(-1)).toEqual({
      method: 'POST',
      body: {
        item_type: 'video',
        item_id: 'bada55e1',
        title: 'Launch Walkthrough',
        thumb_url: '/api/gallery/memvids/bada55e1/poster',
      },
    });
    await expect(videoCardStar).toHaveAttribute('aria-pressed', 'true');

    await page.locator('.video-modal-close').click();
    await videoCardStar.click();

    expect(favoriteRequests.at(-1)).toEqual({
      method: 'DELETE',
      body: {
        item_type: 'video',
        item_id: 'bada55e1',
      },
    });
    await expect(videoCardStar).toHaveAttribute('aria-pressed', 'false');
  });

  test('mobile Video category uses the same swipe deck interaction pattern as Gallery and Sound Lab', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });
    page.on('pageerror', (error) => {
      consoleErrors.push(error.message);
    });

    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ loggedIn: false, user: null }),
      });
    });

    await page.route('**/api/favorites', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, favorites: [] }),
      });
    });

    await page.route(/\/api\/gallery\/mempics(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: { items: [] },
        }),
      });
    });

    await page.route(/\/api\/gallery\/memvids(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            items: [
              {
                id: 'vid-1',
                slug: 'mobile-video-1',
                title: 'First Orbit',
                caption: 'Swipe card one.',
                category: 'memvids',
                file: { url: '/api/gallery/memvids/vid-1/file' },
                poster: { url: '/api/gallery/memvids/vid-1/poster', w: 1280, h: 720 },
              },
              {
                id: 'vid-2',
                slug: 'mobile-video-2',
                title: 'Second Signal',
                caption: 'Swipe card two.',
                category: 'memvids',
                file: { url: '/api/gallery/memvids/vid-2/file' },
                poster: { url: '/api/gallery/memvids/vid-2/poster', w: 1280, h: 720 },
              },
              {
                id: 'vid-3',
                slug: 'mobile-video-3',
                title: 'Final Cut',
                caption: 'Swipe card three.',
                category: 'memvids',
                file: { url: '/api/gallery/memvids/vid-3/file' },
                poster: { url: '/api/gallery/memvids/vid-3/poster', w: 1280, h: 720 },
              },
            ],
          },
        }),
      });
    });

    await page.route('**/api/gallery/memvids/**', async (route) => {
      if (route.request().url().endsWith('/avatar')) {
        await route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==', 'base64'),
        });
        return;
      }

      if (route.request().url().endsWith('/poster')) {
        await route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==', 'base64'),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'video/mp4',
        body: Buffer.from('mock-video'),
      });
    });

    await page.goto('/');
    await expectActiveHomepageCategory(page, 'video');

    const grid = page.locator('#videoGrid');
    const dots = page.locator('.vid-deck-dots .vid-deck-dot');

    await expect(grid).toHaveClass(/vid-deck/);
    await expect(grid.locator('.video-card')).toHaveCount(3);
    await expect(dots).toHaveCount(3);
    await expect(dots.nth(0)).toHaveClass(/active/);

    const initialActiveIndex = await page.evaluate(() => (
      Array.from(document.querySelectorAll('#videoGrid .video-card')).findIndex((card) => {
        const style = window.getComputedStyle(card);
        return style.pointerEvents !== 'none';
      })
    ));
    expect(initialActiveIndex).toBe(0);

    await dispatchHorizontalTouchSwipe(page, '#videoGrid');
    await expect(dots.nth(1)).toHaveClass(/active/);

    const swipedActiveIndex = await page.evaluate(() => (
      Array.from(document.querySelectorAll('#videoGrid .video-card')).findIndex((card) => {
        const style = window.getComputedStyle(card);
        return style.pointerEvents !== 'none';
      })
    ));
    expect(swipedActiveIndex).toBe(1);

    await grid.locator('.video-card').nth(1).click();
    await grid.locator('.video-card').nth(1).click();
    await expect(page.locator('#videoModal')).toHaveClass(/active/);
    await expect(page.locator('#videoModalTitle')).toHaveText('Second Signal');
    await expect(page.locator('#videoModal video')).toHaveAttribute('src', /\/api\/gallery\/memvids\/vid-2\/file$/);
    await page.locator('.video-modal-close').click();

    await dots.nth(0).click();
    await expect(dots.nth(0)).toHaveClass(/active/);

    const resetActiveIndex = await page.evaluate(() => (
      Array.from(document.querySelectorAll('#videoGrid .video-card')).findIndex((card) => {
        const style = window.getComputedStyle(card);
        return style.pointerEvents !== 'none';
      })
    ));
    expect(resetActiveIndex).toBe(0);
    expect(consoleErrors).toEqual([]);
  });

  test('mobile models overlay keeps the final model fully reachable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    await page.getByRole('button', { name: 'Toggle menu' }).click();
    await page.locator('#mobileNav').getByRole('button', { name: 'Models' }).click();

    const layout = page.locator('.models-overlay__layout');
    const lastCard = page.locator('.models-overlay__card').last();

    await layout.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });

    await expect(lastCard).toBeVisible();

    const metrics = await page.evaluate(() => {
      const layoutEl = document.querySelector('.models-overlay__layout');
      const cards = document.querySelectorAll('.models-overlay__card');
      const lastCardEl = cards[cards.length - 1] || null;
      if (!layoutEl || !lastCardEl) {
        return null;
      }
      const layoutRect = layoutEl.getBoundingClientRect();
      const cardRect = lastCardEl.getBoundingClientRect();
      return {
        layoutTop: layoutRect.top,
        layoutBottom: layoutRect.bottom,
        cardTop: cardRect.top,
        cardBottom: cardRect.bottom,
      };
    });

    expect(metrics).toBeTruthy();
    expect(metrics.cardTop).toBeGreaterThanOrEqual(metrics.layoutTop - 1);
    expect(metrics.cardBottom).toBeLessThanOrEqual(metrics.layoutBottom + 1);
  });

  test('mobile video modal keeps favorite and close controls above the player surface', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    const favoriteRequests = [];
    const memvidVersion = 'vpubmemvid';

    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          loggedIn: true,
          user: {
            id: 'video-modal-user',
            email: 'video-modal@bitbi.ai',
            role: 'user',
          },
        }),
      });
    });

    await page.route('**/api/favorites', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, favorites: [] }),
        });
        return;
      }

      favoriteRequests.push({
        method: route.request().method(),
        body: route.request().postDataJSON(),
      });

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.route(/\/api\/gallery\/mempics(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, data: { items: [] } }),
      });
    });

    await page.route(/\/api\/gallery\/memvids(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            items: [
              {
                id: 'vid-modal-1',
                slug: 'vid-modal-1',
                title: 'Launch Walkthrough',
                caption: 'Player-safe controls.',
                category: 'memvids',
                file: { url: `/api/gallery/memvids/vid-modal-1/${memvidVersion}/file` },
                poster: { url: `/api/gallery/memvids/vid-modal-1/${memvidVersion}/poster`, w: 1280, h: 720 },
              },
            ],
          },
        }),
      });
    });

    await page.route('**/api/gallery/memvids/**', async (route) => {
      if (route.request().url().endsWith('/avatar')) {
        await route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==', 'base64'),
        });
        return;
      }

      if (route.request().url().endsWith('/poster')) {
        await route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==', 'base64'),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'video/mp4',
        body: Buffer.from('mock-video'),
      });
    });

    await page.goto('/');
    await page.locator('#videoGrid .video-card').first().click();

    const favoriteButton = page.locator('#videoModal .video-modal__fav');
    const closeButton = page.locator('#videoModal .video-modal-close');
    const player = page.locator('#videoModal video');

    await expect(favoriteButton).toBeVisible();
    await expect(closeButton).toBeVisible();
    await expect(player).toBeVisible();

    const boxes = await page.evaluate(() => {
      const favoriteEl = document.querySelector('#videoModal .video-modal__fav');
      const closeEl = document.querySelector('#videoModal .video-modal-close');
      const playerEl = document.querySelector('#videoModal video');
      if (!favoriteEl || !closeEl || !playerEl) return null;
      const favoriteRect = favoriteEl.getBoundingClientRect();
      const closeRect = closeEl.getBoundingClientRect();
      const playerRect = playerEl.getBoundingClientRect();
      return {
        favoriteBottom: favoriteRect.bottom,
        closeBottom: closeRect.bottom,
        playerTop: playerRect.top,
      };
    });

    expect(boxes).toBeTruthy();
    expect(boxes.favoriteBottom).toBeLessThanOrEqual(boxes.playerTop + 1);
    expect(boxes.closeBottom).toBeLessThanOrEqual(boxes.playerTop + 1);

    await favoriteButton.click();
    expect(favoriteRequests.at(-1)).toEqual({
      method: 'POST',
      body: {
        item_type: 'video',
        item_id: 'vid-modal-1',
        title: 'Launch Walkthrough',
        thumb_url: `/api/gallery/memvids/vid-modal-1/${memvidVersion}/poster`,
      },
    });

    await closeButton.click();
    await expect(page.locator('#videoModal')).not.toHaveClass(/active/);
  });

  test('Sound Lab expands to five columns on wide desktops and steps down on smaller desktop widths', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto('/');
    await switchHomepageCategory(page, 'sound');
    await expect(page.locator('#soundLabTracks .snd-card').first()).toBeVisible();

    const wideLayout = await page.evaluate(() => {
      const grid = document.getElementById('soundLabTracks');
      const style = window.getComputedStyle(grid);
      return {
        columns: style.gridTemplateColumns.split(' ').filter(Boolean).length,
        overflow: grid.scrollWidth - grid.clientWidth,
      };
    });

    expect(wideLayout.columns).toBe(5);
    expect(wideLayout.overflow).toBeLessThanOrEqual(2);

    await page.setViewportSize({ width: 1100, height: 1200 });
    const laptopLayout = await page.evaluate(() => {
      const grid = document.getElementById('soundLabTracks');
      const style = window.getComputedStyle(grid);
      return style.gridTemplateColumns.split(' ').filter(Boolean).length;
    });

    expect(laptopLayout).toBeLessThanOrEqual(4);
  });

});

// ---------------------------------------------------------------------------
// Legal pages
// ---------------------------------------------------------------------------

test.describe('Legal pages', () => {
  test('privacy page loads', async ({ page }) => {
    const response = await page.goto('/legal/privacy.html');
    expect(response.status()).toBe(200);
  });

  test('imprint page loads', async ({ page }) => {
    const response = await page.goto('/legal/imprint.html');
    expect(response.status()).toBe(200);
  });

  test('datenschutz page loads', async ({ page }) => {
    const response = await page.goto('/legal/datenschutz.html');
    expect(response.status()).toBe(200);
  });
});

test.describe('Shared MODELS overlay', () => {
  test('shared subpage header exposes the Video link', async ({ page }) => {
    await page.goto('/legal/imprint.html');

    const nav = page.locator('.site-nav__links');
    const videoLink = nav.getByRole('link', { name: 'Video' });
    await expect(videoLink).toBeVisible();
    await expect(videoLink).toHaveAttribute('href', /\/#video-creations$/);
    await expect
      .poll(() => nav.locator(':scope > *').evaluateAll((nodes) => nodes.map((node) => node.textContent.trim())))
      .toEqual(['Gallery', 'Video', 'Sound Lab', 'Contact', 'Models']);
    await expect(page.locator('a[aria-label="YouTube"]')).toHaveCount(0);
  });

  test('profile page uses the full shared header navigation instead of the logo-only fallback', async ({ page }) => {
    await page.goto('/account/profile.html');

    const nav = page.locator('.site-nav__links');
    await expect(nav.getByRole('link', { name: 'Video' })).toBeVisible();
    await expect
      .poll(() => nav.locator(':scope > *').evaluateAll((nodes) => nodes.map((node) => node.textContent.trim())))
      .toEqual(['Gallery', 'Video', 'Sound Lab', 'Contact', 'Models']);
    await expect(page.locator('a[aria-label="YouTube"]')).toHaveCount(0);
  });

  test('shared-header subpages ship the full static header shell before JS enhancement', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    try {
      for (const pathname of STATIC_SHARED_HEADER_PATHS) {
        await page.goto(pathname);

        const nav = page.locator('.site-nav__links');
        await expect(nav.getByRole('link', { name: 'Video' })).toBeVisible();
        await expect(page.locator('#mobileMenuBtn')).toHaveCount(1);
        await expect(page.locator('#mobileNav')).toHaveCount(1);
        await expect
          .poll(() => nav.locator(':scope > *').evaluateAll((nodes) => nodes.map((node) => node.textContent.trim())))
          .toEqual(['Gallery', 'Video', 'Sound Lab', 'Contact', 'Models']);
        await expect(page.locator('a[aria-label="YouTube"]')).toHaveCount(0);
      }
    } finally {
      await context.close();
    }
  });

  test('shared subpage mobile menu keeps Video before Sound Lab', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/legal/imprint.html');

    await page.getByRole('button', { name: 'Toggle menu' }).click();
    const mobileExplore = page.locator('#mobileNav .mobile-nav__section[aria-label="Explore"]');
    await expect
      .poll(() => mobileExplore.locator(':scope > .mobile-nav__link').evaluateAll((nodes) => nodes.map((node) => node.textContent.trim())))
      .toEqual(['Gallery', 'Video', 'Sound Lab', 'Models']);
  });

  for (const pathname of MODELS_OVERLAY_PATHS) {
    test(`${pathname} opens the local MODELS overlay without navigation`, async ({ page }) => {
      await page.goto(pathname);
      const currentUrl = new URL(page.url());
      const currentPath = `${currentUrl.pathname}${currentUrl.hash}`;

      const modelsButton = page.locator('.site-nav__links').getByRole('button', { name: 'Models' });
      await modelsButton.click();

      await expectPathUnchanged(page, currentPath);
      await expectModelsOverlayOpenState(page);

      await page.getByRole('button', { name: 'Close models' }).click();
      await expect(page.locator('.models-overlay')).not.toHaveClass(/is-active/);
      await expectPathUnchanged(page, currentPath);
    });
  }
});

// ---------------------------------------------------------------------------
// Static assets
// ---------------------------------------------------------------------------

test.describe('Static assets', () => {
  test('homepage CSS and JS assets load without errors', async ({ page }) => {
    const assetResponses = [];

    page.on('response', (response) => {
      const url = response.url();
      if (
        url.startsWith('http://localhost') &&
        /\.(css|js)(\?|$)/.test(url)
      ) {
        assetResponses.push({ url, status: response.status() });
      }
    });

    await page.goto('/');

    // At least one CSS and one JS asset should have loaded
    const css = assetResponses.filter((a) => /\.css(\?|$)/.test(a.url));
    const js = assetResponses.filter((a) => /\.js(\?|$)/.test(a.url));
    expect(css.length).toBeGreaterThan(0);
    expect(js.length).toBeGreaterThan(0);

    // None should return an error status
    const failed = assetResponses.filter((a) => a.status >= 400);
    expect(failed).toEqual([]);
  });
});
